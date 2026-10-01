import {
  CONTROL,
  HARD_BREAK,
  KIND_BITS,
  PRESERVED_SPACE,
  RETURNABLE,
  SOFT_HYPHEN,
  SPACE,
  SPACED,
  TAB,
  TEXT,
  UNBROKEN,
  ZERO_WIDTH_BREAK,
  ZERO_WIDTH_GLUE,
} from './analysis.js'
import type { LayoutCursor, LineStats } from './layout.js'
import { getEngineProfile, type EngineProfile } from './measurement.js'
import { getFreshLineEnd, getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'

const BREAK_AFTER_KINDS = 1 << SPACE | 1 << ZERO_WIDTH_BREAK | 1 << SOFT_HYPHEN | 1 << PRESERVED_SPACE | 1 << TAB

// The prepared handle's line-break data: parallel arrays per segment.
export type PreparedLineBreakData = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  // Per segment, its flags byte, e.g. [TEXT, SPACE, TEXT]. A JSON copy of the handle turns it into an
  // object with no length, on which the walkers never finish (RESEARCH.md, Decisions Log)
  segmentFlags: Uint8Array
  // Normal text can use the simple line stepper across all layout APIs, and layout()
  // counts it with one numeric loop where it has no overflow trims
  simpleLineWalkFastPath: boolean
  // Normal text, or text of its kinds where the scan gives no break at some segment
  // boundary, which layout() counts with the simple stepper
  simpleLineCountFastPath: boolean
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  entryGeometry: (SegmentEntryGeometry | null)[] | null // Per segment, how its tails fit on a fresh line; null without any
  // Per segment with breakable fit advances, the graphemes that can't start a line, which
  // a line holding only an overflowing first grapheme keeps. Null without any.
  lineStartProhibitions: (number[] | null)[] | null
  // Per segment, width a line that starts with it adds back, which its width leaves out
  // after the text before it, as Blink's halt of an opening mark (src/han-kerning.ts).
  // Null without any.
  lineStartExtras: number[] | null
  // Per segment, width it drops where a line ends after it and it doesn't fit otherwise,
  // as Blink's line-end halt of a closing mark. Null without any.
  lineEndTrims: number[] | null
  // Per segment, width it drops in place of that where it overflows a line that has no break
  // before it and the line ends after it: Blink retries such a line with a break after every
  // grapheme, so it halts a closing mark before a hard break or a space too. Null without any.
  overflowLineEndTrims: number[] | null
  letterSpacing: number // Extra advance between rendered graphemes on the same line
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
  // Per segment, how much narrower a soft hyphen's neighboring text measures
  // joined than apart, else 0. Null when the text has no soft hyphen or the engine
  // keeps an unfit hyphen.
  discretionaryHyphenContexts: number[] | null
  tabStopAdvance: number // Absolute advance between tab stops for pre-wrap tab segments
}

// A rich-inline item's line (src/rich-inline.ts). In: whether the walk continues a line
// with content, whether that line can end before the item and a return from an unfit
// soft hyphen can too, per segment, the graphemes inside it that the text the items
// join breaks before, else null, and where the item's text starts on the line, which its
// tab stops count from. Out, where the walk takes the item's end: the line's latest break
// (segment -1 without one) and the width a line ending there paints. In and out,
// `hangWidth`: the width of the run of preserved spaces and tabs that ends the line
// before the item, which goes on into the item's own and hangs with them. Out, it and
// `breakHangWidth` give what the rich line hangs (stepRichInlineLine) where the walk and
// the latest break end: where the walk takes the item's end or a hard break, the whole run
// it ends with, which its width includes; where it or the break ends right after a run that
// goes on from before the item, the run's part before the item, which the width, 0 there,
// leaves out, as the item's own part hangs; else 0.
export type ItemLine = {
  continues: boolean
  breakBefore: boolean
  fitsBreakBefore: boolean
  innerBreaks: (number[] | null)[] | null
  lineOffset: number
  breakSegmentIndex: number
  breakGraphemeIndex: number
  breakWidth: number
  breakHangWidth: number
  hangWidth: number
}

type InternalLineVisitor = (
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
) => void

export function breaksAfterKind(kind: number): boolean {
  return (1 << kind & BREAK_AFTER_KINDS) !== 0
}

// Whether a line can end between two segments, from the kind before, the kind
// after and whether the scan gives no break there, as before NEL (UAX #14 LB6).
export function endsLineBefore(previousKind: number, kind: number, unbroken: boolean): boolean {
  return (breaksAfterKind(previousKind) || !breaksAfterKind(kind)) && !unbroken
}

// End cursors consume source. A terminal SHY is not a selected wrap, even
// though it is the final consumed segment. Rendering derives that distinction
// from the endpoint instead of treating every consumed SHY as visible.
export function isDiscretionaryLineEnd(
  segmentFlags: Uint8Array,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): boolean {
  return endGraphemeIndex === 0 && endSegmentIndex > 0 && endSegmentIndex < segmentFlags.length &&
    (segmentFlags[endSegmentIndex - 1]! & KIND_BITS) === SOFT_HYPHEN
}

// At a paragraph or hard-break start, ZWSP is real source: it establishes the
// line and offers a break after it. UAX #14 forbids an ordinary break before
// ZWSP. After a forced overflow break browsers can still give ZWSP its own line;
// that start is consumed here, as before.
function consumesAtLineStart(kind: number, atChunkStart: boolean): boolean {
  return kind === SPACE || kind === SOFT_HYPHEN || (kind === ZERO_WIDTH_BREAK && !atChunkStart)
}

function getTabAdvance(lineWidth: number, tabStopAdvance: number, minimumAdvance: number): number {
  if (tabStopAdvance <= 0) return 0

  const remainder = lineWidth % tabStopAdvance
  if (Math.abs(remainder) <= 1e-6) return tabStopAdvance
  const advance = tabStopAdvance - remainder
  return advance < minimumAdvance ? advance + tabStopAdvance : advance
}

// Where a line that holds only an overflowing grapheme ends: after that grapheme and
// the graphemes after it that can't start a line, up to `endGraphemeIndex`.
function getOverflowingFirstGraphemeEnd(
  prepared: PreparedLineBreakData,
  segmentIndex: number,
  graphemeIndex: number,
  endGraphemeIndex: number,
): number {
  const prohibitions = prepared.lineStartProhibitions?.[segmentIndex] ?? null
  let end = graphemeIndex + 1
  while (prohibitions !== null && end < endGraphemeIndex && prohibitions.includes(end)) end++
  return end
}

// The advance of a segment's first `count` graphemes after the gap `spacing`, with the
// letter spacing between them.
function getGraphemesAdvance(fitAdvances: readonly number[], count: number, spacing: number, letterSpacing: number): number {
  let advance = spacing
  for (let g = 0; g < count; g++) advance += fitAdvances[g]! + (g > 0 ? letterSpacing : 0)
  return advance
}

function getTerminalLetterSpacing(
  prepared: PreparedLineBreakData,
  hangingKinds: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): number {
  const { letterSpacing, segmentFlags } = prepared
  if (letterSpacing === 0) return 0

  if (endGraphemeIndex > 0) return (segmentFlags[endSegmentIndex]! & SPACED) !== 0 ? letterSpacing : 0

  if (isDiscretionaryLineEnd(segmentFlags, endSegmentIndex, endGraphemeIndex)) return 0
  // A run of preserved spaces and tabs that hangs where the line wraps already
  // charged the gap after the glyph before it. Gecko doesn't hang tabs.
  if (endSegmentIndex > startSegmentIndex && endSegmentIndex < segmentFlags.length && (segmentFlags[endSegmentIndex]! & KIND_BITS) !== HARD_BREAK &&
    (1 << (segmentFlags[endSegmentIndex - 1]! & KIND_BITS) & hangingKinds) !== 0) return 0

  for (let i = endSegmentIndex - 1; i >= startSegmentIndex; i--) {
    const flags = segmentFlags[i]!
    const kind = flags & KIND_BITS
    // Segments that take no letter spacing, such as zero-width glue or marks
    // shaped on the grapheme before them, leave that grapheme's gap last.
    if (kind === SPACE || (kind !== CONTROL && (flags & SPACED) === 0)) continue

    if (i === startSegmentIndex && startGraphemeIndex > 0) return letterSpacing

    return (flags & SPACED) !== 0 ? letterSpacing : 0
  }

  return 0
}

// Mutates `cursor` to the next renderable line start. False when no line remains.
// A chunk runs to a hard break or the end of the text, and the hard break ends a
// line however little the chunk holds: a chunk holding only its hard break, or only
// source a line start consumes before it, such as soft hyphens, is an empty line,
// which starts at its hard break. The rest of a chunk after a line that wrapped
// inside it is no line of its own when a line start consumes all of it.
export function normalizePreparedLineStart(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
): boolean {
  const { segmentFlags } = prepared
  const segmentCount = segmentFlags.length
  let segmentIndex = cursor.segmentIndex
  if (segmentIndex >= segmentCount) return false
  if (cursor.graphemeIndex > 0) return true

  let atChunkStart = segmentIndex === 0 || (segmentFlags[segmentIndex - 1]! & KIND_BITS) === HARD_BREAK
  while (true) {
    const kind = segmentFlags[segmentIndex]! & KIND_BITS
    if (kind === HARD_BREAK) {
      if (atChunkStart) {
        cursor.segmentIndex = segmentIndex
        cursor.graphemeIndex = 0
        return true
      }
      if (++segmentIndex >= segmentCount) return false
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      atChunkStart = true
    } else if (consumesAtLineStart(kind, atChunkStart)) {
      if (++segmentIndex >= segmentCount) return false
    } else {
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      return true
    }
  }
}

// Walks every line of the text into `stats`, visiting each, and returns the line count.
export function walkPreparedLinesRaw(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: InternalLineVisitor,
  stats: LineStats = { lineCount: 0, maxLineWidth: 0 },
): number {
  const cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  if (!prepared.simpleLineWalkFastPath) {
    if (normalizePreparedLineStart(prepared, cursor)) walkPreparedComplexLines(prepared, cursor, maxWidth, onLine, stats)
    return stats.lineCount
  }
  // A fast-path handle is one chunk of text, spaces and ZWSPs, so each line steps
  // from where the last one ended, past what a line can't start with. One loop for
  // both walkers, normalizing each line start and stepping through
  // stepPreparedLineGeometryFromStart(), walked chat 6 to 32% slower in Chrome and
  // Firefox (RESEARCH.md, Keeping Work Bounded).
  const { segmentFlags } = prepared
  const segmentCount = segmentFlags.length
  while (true) {
    let startSegmentIndex = cursor.segmentIndex
    const atTextStart = startSegmentIndex === 0
    while (startSegmentIndex < segmentCount && consumesAtLineStart(segmentFlags[startSegmentIndex]! & KIND_BITS, atTextStart)) {
      startSegmentIndex++
    }
    if (startSegmentIndex >= segmentCount) return stats.lineCount
    const startGraphemeIndex = cursor.graphemeIndex
    cursor.segmentIndex = startSegmentIndex
    const width = stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
    stats.lineCount++
    if (width > stats.maxLineWidth) stats.maxLineWidth = width
    onLine?.(width, startSegmentIndex, startGraphemeIndex, cursor.segmentIndex, cursor.graphemeIndex)
  }
}

// layout()'s count: the simple stepper's lines as one numeric loop, with no
// cursor and no per-line call. Every segment boundary of a fast-path handle is
// a break, so an overflowing space or ZWSP ends its line and any other segment
// starts the next one. The full walker costs three to five times as much per
// segment, so one walker for all text was rejected (RESEARCH.md, Decisions Log).
// Counting with the simple stepper itself would leave one copy of these fit
// rules. Offline it counts a text at a width it wasn't laid out at before a
// quarter to a half slower than this loop, and long breakable runs twice as
// slow; no browser has timed it (RESEARCH.md, Keeping Work Bounded, The
// Walkers' Shapes).
export function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  // The loop takes no overflow trims, which the stepper takes for a line's first segment.
  if (!prepared.simpleLineWalkFastPath || prepared.overflowLineEndTrims !== null) {
    return prepared.simpleLineCountFastPath ? countSteppedLines(prepared, maxWidth) : walkPreparedLinesRaw(prepared, maxWidth)
  }
  const { widths, segmentFlags, breakableFitAdvances, entryGeometry, lineStartProhibitions, lineStartExtras, lineEndTrims } = prepared
  const fitLimit = Math.max(0, maxWidth) + getEngineProfile().lineFitEpsilon
  const segmentCount = widths.length
  let count = 0
  // Every line starts at 0 and adds its content's widths. Firefox runs this loop
  // about 1.6 times as long when a line's width is set from a segment's width
  // instead (RESEARCH.md, Keeping Work Bounded).
  let lineW = 0
  let hasContent = false

  // A ZWSP at the start of the text starts the first line.
  for (let i = 0; i < segmentCount; i++) {
    const kind = segmentFlags[i]! & KIND_BITS
    const w = widths[i]!
    const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!
    if (hasContent) {
      // A segment that fits only by its line-end trim ends the line, as the full
      // width it adds leaves no room after it.
      if (lineW + w - endTrim <= fitLimit) {
        lineW += w
        continue
      }
      count++
      lineW = 0
      hasContent = false
      if (kind !== TEXT) continue
    } else if (kind === SPACE || (kind === ZERO_WIDTH_BREAK && i > 0)) {
      continue
    }

    const startW = lineStartExtras === null ? w : w + lineStartExtras[i]!
    const advances = breakableFitAdvances[i] as number[] | null
    if (startW - endTrim <= fitLimit || advances === null) {
      lineW += startW
      hasContent = true
      continue
    }
    // An overflowing breakable segment fills lines grapheme by grapheme. A line
    // holding only an overflowing grapheme keeps the graphemes after it that
    // can't start a line. A line that starts inside it where it has fresh-line
    // geometry takes the tail or its fresh prefixes.
    const prohibitions = lineStartProhibitions?.[i] ?? null
    const entry = entryGeometry === null ? null : entryGeometry[i]!
    let g = 0
    while (g < advances.length) {
      if (g > 0 && entry !== null && entry.entries[g] !== null) {
        const end = getFreshLineEnd(entry, g, advances.length, fitLimit)
        if (end > advances.length) {
          lineW += getSegmentEntryWidth(entry, g, advances.length)!
          hasContent = true
          break
        }
        count++
        g = end
        continue
      }
      lineW += advances[g++]!
      if (prohibitions !== null && lineW > fitLimit) {
        const kept = g
        while (g < advances.length && prohibitions.includes(g)) lineW += advances[g++]!
        if (g > kept) {
          count++
          lineW = 0
          continue
        }
      }
      while (g < advances.length && lineW + advances[g]! <= fitLimit) lineW += advances[g++]!
      if (g < advances.length) {
        count++
        lineW = 0
      } else {
        hasContent = true
      }
    }
  }
  return count + (hasContent ? 1 : 0)
}

// layout()'s count of text of the simple walkers' kinds where the scan gives no
// break at some segment boundary, as before NEL: the simple stepper's lines, except
// that the full walker steps a line again where the stepper ended it at such a
// boundary, before the segment or after the space before it, returning the line to
// its last break. Checking for that inside the counter's loop slowed Firefox's and
// Chrome's count of all other text once the check had ever held, and the line APIs
// keep the full walker for this text, since the stepper's widths can differ from
// its in the last bits (RESEARCH.md, Keeping Work Bounded).
function countSteppedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  const { segmentFlags } = prepared
  const cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let count = 0
  while (normalizePreparedLineStart(prepared, cursor)) {
    const startSegmentIndex = cursor.segmentIndex
    const startGraphemeIndex = cursor.graphemeIndex
    stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
    if (cursor.graphemeIndex === 0 && cursor.segmentIndex < segmentFlags.length && (segmentFlags[cursor.segmentIndex]! & UNBROKEN) !== 0) {
      cursor.segmentIndex = startSegmentIndex
      cursor.graphemeIndex = startGraphemeIndex
      walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true)
    }
    count++
  }
  return count
}

// Whether a line that would end at the break before `breakSegmentIndex`, painting
// `breakWidth`, returns to the earlier opportunity `targetSegmentIndex`: where it
// ends at a selected discretionary hyphen that doesn't fit. A return needs an
// overflow that isolated widths can show and a target that really is the latest
// opportunity. The soft hyphens on the line may measure narrower joined than apart by
// less than the overflow, and nothing after the target may be text after text, which
// can hold an opportunity that segment kinds don't mark. The target can be a segment
// start that follows a break outside the prepared text, such as a rich-inline item
// boundary.
function returnsFromUnfitHyphen(
  prepared: PreparedLineBreakData,
  unfitHyphenRetreat: EngineProfile['unfitHyphenRetreat'],
  lineStartSegmentIndex: number,
  targetSegmentIndex: number,
  breakSegmentIndex: number,
  breakWidth: number,
  fitLimit: number,
): boolean {
  const { discretionaryHyphenContexts, segmentFlags } = prepared
  const softHyphenIndex = breakSegmentIndex - 1
  if (softHyphenIndex < lineStartSegmentIndex || (segmentFlags[softHyphenIndex]! & KIND_BITS) !== SOFT_HYPHEN || breakWidth <= fitLimit) return false
  if (unfitHyphenRetreat === 'none') {
    // Where the engine keeps an unfit hyphen, as WebKit does, a rich-inline item's line
    // returns only to its break before a run that continues from the previous item,
    // with no break between, as the whole run moves to the next line (ItemLine).
    for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
      if (breaksAfterKind(segmentFlags[i]! & KIND_BITS) || (i > targetSegmentIndex && (segmentFlags[i]! & RETURNABLE) !== 0)) return false
    }
    return true
  }
  const overflow = breakWidth - fitLimit
  let narrowing = 0
  if (discretionaryHyphenContexts !== null) for (let i = lineStartSegmentIndex; i <= softHyphenIndex; i++) narrowing += discretionaryHyphenContexts[i]!
  if (narrowing >= overflow) return false
  for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
    if (breaksAfterKind(segmentFlags[i]! & KIND_BITS)) continue
    if (i > targetSegmentIndex && !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS)) return false
  }
  return true
}

// The full walker, for text the simple walkers don't cover: from a normalized line
// start, every line into `stats`, or with `singleLine` one line, whose width it
// returns (null without one). Every line state is a local of this one function,
// with no closure over it: V8 boxes a captured number, so each write to one cost
// 12-14ns there against about 1ns for a local. It keeps its own loop over lines:
// stepping one line per call, it read the handle and the profile and derived its
// limits again for every line, and short lines laid out 7 to 40% slower in all
// three browsers (RESEARCH.md, Keeping Work Bounded).
function walkPreparedComplexLines(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
  onLine: InternalLineVisitor | undefined,
  stats: LineStats | null,
  singleLine = false,
  // A rich-inline item's one line (ItemLine).
  item: ItemLine | null = null,
): number | null {
  const {
    widths,
    segmentFlags,
    breakableFitAdvances,
    entryGeometry,
    discretionaryHyphenWidth,
    letterSpacing,
    lineStartExtras,
    lineEndTrims,
    overflowLineEndTrims,
    tabStopAdvance,
  } = prepared
  const segmentCount = segmentFlags.length
  const engineProfile = getEngineProfile()
  // Preserved spaces and tabs at the end of a line hang past it (CSS Text 3
  // §4.1.2), so they take no room when fitting and don't size the line (§8.2).
  // Gecko doesn't hang tabs.
  const hangingKinds = 1 << PRESERVED_SPACE | (engineProfile.hangTabs ? 1 << TAB : 0)
  const zeroWidthGlueTakesLine = engineProfile.zeroWidthGlueTakesLine
  // Tab stops are eight spaces apart, so half a space is a sixteenth of one.
  const minimumTabAdvance = engineProfile.skipNarrowTabStops ? tabStopAdvance / 16 : 0
  // A rich item's line starts after the line's content before the item, which can
  // leave it a negative width, and its break before the item is the line's pending
  // break (ItemLine). Any other negative width lays out as 0, as in the simple stepper.
  const continues = item !== null && item.continues
  const availableWidth = continues ? maxWidth : Math.max(0, maxWidth)
  const fitLimit = availableWidth + engineProfile.lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the engine retreats
  // and the text has a soft hyphen.
  const retreatsFromUnfitHyphen = prepared.discretionaryHyphenContexts !== null
  // Blink's retry leaves room for the hyphen at every earlier opportunity. Gecko
  // returns to any opportunity whose line fits, such as a break between text segments.
  const retreatsAtFullWidth = retreatsFromUnfitHyphen && engineProfile.unfitHyphenRetreat === 'full-width'
  const reservedHyphenWidth = retreatsAtFullWidth ? 0 : discretionaryHyphenWidth
  const breakBeforeSegmentIndex = item !== null && item.breakBefore ? cursor.segmentIndex : -1
  const fitBreakBefore = item !== null && item.fitsBreakBefore ? cursor.segmentIndex : -1
  const innerBreaks = item === null ? null : item.innerBreaks
  // Tab stops count from the line's start, in every engine, never from a rich item's
  // (Blink's line_breaker.cc:2963-2971, WebKit's pen position, Gecko's CalcTabWidths,
  // nsTextFrame.cpp:4298-4378).
  const lineOffset = item === null ? 0 : item.lineOffset

  let lastLineWidth: number | null = null
  while (true) {
    const lineStartSegmentIndex = cursor.segmentIndex
    const lineStartGraphemeIndex = cursor.graphemeIndex
    let lineW = 0
    let hasContent = continues
    let lineEndSegmentIndex = lineStartSegmentIndex
    let lineEndGraphemeIndex = lineStartGraphemeIndex
    let pendingBreakSegmentIndex = breakBeforeSegmentIndex
    // A line that ends at the pending break both fits and paints this width.
    let pendingBreakWidth = 0
    // The latest opportunity whose line leaves room for the hyphen, which Blink's
    // retry against the width minus the hyphen returns to when a selected
    // discretionary hyphen does not fit, with that line's painted width.
    let fitBreakSegmentIndex = fitBreakBefore
    let fitBreakPaintWidth = 0
    // The latest break inside a segment, from innerBreaks: its segment (-1 without
    // one), the grapheme it falls before and the width a line ending there paints.
    let innerBreakSegmentIndex = -1
    let innerBreakGraphemeIndex = 0
    let innerBreakWidth = 0
    // The latest run of preserved spaces and tabs: the segment after it, and the
    // line's width before it, less the line-end trim of the text it follows, with
    // the gap after the glyph before it. A rich item's walk starts inside the run
    // that ends the line before it, where there is one (ItemLine).
    let hangEndSegmentIndex = -1
    let hangStartWidth = 0
    let hangsFromBefore = false
    if (item !== null && item.hangWidth > 0) {
      hangEndSegmentIndex = lineStartSegmentIndex
      hangStartWidth = -item.hangWidth
      hangsFromBefore = true
    }
    // The line-end trim of the last whole segment, where only that trim let it fit, kept
    // past segments after it that take no room at the line end, as spaces. Every later
    // segment that takes room overflows, so the line ends before it and paints that much less.
    let lineEndTrimmed = 0
    // Retained line-start ZWSP establishes the line without owning a spacing gap.
    let zeroWidthPrefix = true
    let afterUnspacedControl = false
    // Where the line ends and the width it paints there, once decided: -1 ends it at
    // the line's current end. With returnsFromHyphen, a line that ends at a selected
    // discretionary hyphen that doesn't fit returns to the recorded earlier opportunity.
    let endSegmentIndex = -1
    let endGraphemeIndex = 0
    let endWidth = 0
    let returnsFromHyphen = false

    let lineWidth: number | null = null
    if ((segmentFlags[lineStartSegmentIndex]! & KIND_BITS) === HARD_BREAK) {
      // A line that starts at a hard break is an empty chunk's (normalizePreparedLineStart).
      cursor.segmentIndex = lineStartSegmentIndex + 1
      cursor.graphemeIndex = 0
      lineWidth = 0
    } else {
      decided: {
        // Where the line ends when its source runs out: after the chunk's hard
        // break, or at the end of the text.
        let consumedEndSegmentIndex: number
        for (let i = lineStartSegmentIndex; ; i++) {
          if (i >= segmentCount) {
            consumedEndSegmentIndex = segmentCount
            break
          }
          // The graphemes of segment i from fillStart go on the line one by one, after
          // the gap fillSpacing.
          let fillStart: number
          let fillSpacing = 0
          const flags = segmentFlags[i]!
          const kind = flags & KIND_BITS
          if (kind === HARD_BREAK) {
            consumedEndSegmentIndex = i + 1
            break
          }
          const spaced = (flags & SPACED) !== 0
          const breakAfter = (1 << kind & BREAK_AFTER_KINDS) !== 0
          const startGraphemeIndex = i === lineStartSegmentIndex ? lineStartGraphemeIndex : 0
          // The gap before a segment belongs to the grapheme before it. A control
          // that takes no letter spacing still follows that gap but adds none
          // after itself; other segments that take none leave it as it was.
          const gap = letterSpacing !== 0 && hasContent && !zeroWidthPrefix && !afterUnspacedControl ? letterSpacing : 0
          let leadingSpacing = 0
          if (letterSpacing !== 0 && (spaced || kind === CONTROL)) {
            leadingSpacing = gap
            afterUnspacedControl = !spaced
          }
          if (kind !== ZERO_WIDTH_BREAK && kind !== ZERO_WIDTH_GLUE) zeroWidthPrefix = false
          const w = kind === TAB
            ? getTabAdvance(lineOffset + lineW + leadingSpacing, tabStopAdvance, minimumTabAdvance)
            : widths[i]!
          const advance = leadingSpacing + w
          const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!
          // The graphemes inside the segment before which the line can end, else null.
          const segmentInner = innerBreaks === null ? null : innerBreaks[i]!

          if (kind === SOFT_HYPHEN && startGraphemeIndex === 0) {
            if (hasContent) {
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              if (i + 1 < segmentCount && (segmentFlags[i + 1]! & KIND_BITS) !== HARD_BREAK) {
                pendingBreakSegmentIndex = i + 1
                pendingBreakWidth = lineW + discretionaryHyphenWidth
                // A soft hyphen's fit already includes its own hyphen.
                if (retreatsFromUnfitHyphen && pendingBreakWidth <= fitLimit) {
                  fitBreakSegmentIndex = pendingBreakSegmentIndex
                  fitBreakPaintWidth = pendingBreakWidth
                }
              }
            }
            continue
          }

          // A line that ends after a whole segment charges its advance and the letter
          // spacing gap after it. Spaces and zero-width breaks hang, and zero-width
          // text owns no gap, though NEL does. Text that takes no letter spacing, such
          // as zero-width glue, fits like the line that still ends with the gap before it.
          let fitAdvance = 0
          if (letterSpacing !== 0 && !spaced && !breakAfter && kind !== CONTROL) {
            fitAdvance = gap + w
          } else if (breakAfter ? kind === TAB : w !== 0 || kind === CONTROL) {
            const contribution = w + (spaced ? letterSpacing : 0)
            if (contribution !== 0) fitAdvance = leadingSpacing + contribution
          }
          const hangs = (1 << kind & hangingKinds) !== 0
          if (hangs) {
            if (hangEndSegmentIndex !== i) {
              hangStartWidth = lineW - lineEndTrimmed + leadingSpacing
              hangsFromBefore = false
            }
            hangEndSegmentIndex = i + 1
          }
          // Where glue can't hold a line, glue at a line start isn't the line's content:
          // the segment after it starts the line, however wide.
          if (!hasContent && kind === ZERO_WIDTH_GLUE && !zeroWidthGlueTakesLine) {
            lineEndSegmentIndex = i + 1
            lineEndGraphemeIndex = 0
            continue
          }

          // A fresh line and a line with content admit a whole segment apart, each
          // with its own copy of what follows admission. One path for both, testing
          // at each step whether the line has content, laid out short lines 3 to 17%
          // slower in all three browsers (RESEARCH.md, Keeping Work Bounded).
          if (!hasContent) {
            if (startGraphemeIndex > 0) {
              fillStart = startGraphemeIndex
            } else {
              const startExtra = lineStartExtras === null ? 0 : lineStartExtras[i]!
              // With no break before it on the line, an overflowing segment is laid out
              // by Blink's retry between graphemes, which halts where that lets it fit.
              const startTrim = overflowLineEndTrims !== null && fitAdvance + startExtra - overflowLineEndTrims[i]! <= fitLimit
                ? overflowLineEndTrims[i]!
                : endTrim
              if (fitAdvance + startExtra - startTrim > fitLimit && breakableFitAdvances[i] !== null) {
                fillStart = 0
              } else {
                hasContent = true
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                lineW = w + startExtra
                lineEndTrimmed = fitAdvance + startExtra > fitLimit ? startTrim : 0
                if (segmentInner !== null) {
                  innerBreakSegmentIndex = i
                  innerBreakGraphemeIndex = segmentInner[segmentInner.length - 1]!
                  innerBreakWidth = getGraphemesAdvance(breakableFitAdvances[i]!, innerBreakGraphemeIndex, 0, letterSpacing)
                }
                // The break segment hangs with the gap before it, a run of preserved
                // spaces and tabs hangs whole, and a tab that doesn't hang counts whole.
                if (breakAfter && (i + 1 === segmentCount || (segmentFlags[i + 1]! & UNBROKEN) === 0)) {
                  pendingBreakSegmentIndex = i + 1
                  pendingBreakWidth = hangs ? hangStartWidth : kind === TAB ? lineW : lineW - advance
                }
                if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + reservedHyphenWidth <= fitLimit) {
                  fitBreakSegmentIndex = pendingBreakSegmentIndex
                  fitBreakPaintWidth = pendingBreakWidth
                }
                continue
              }
            }
          } else {
            // A run of preserved spaces and tabs fits where the text before it fits. Rich
            // inline's firstSegmentOverflows() repeats this fit for an item's first segment.
            const newFitW = hangs ? hangStartWidth : lineW + fitAdvance
            if (newFitW - endTrim > fitLimit) {
              // A break segment hangs with the gap before it, after the content before
              // it, which fits without its line-end trim. A collapsible space or ZWSP
              // hangs even after overflowing content that started the line, as the
              // simple stepper does; a preserved space there starts the next line.
              const contentW = lineW - lineEndTrimmed
              if (breakAfter && (contentW <= fitLimit ||
                (pendingBreakSegmentIndex < 0 && (kind === SPACE || kind === ZERO_WIDTH_BREAK)))) {
                endWidth = hangs ? hangStartWidth : kind === TAB ? lineW + advance : contentW
                lineW += advance
                endSegmentIndex = i + 1
                endGraphemeIndex = 0
                break decided
              }

              // The line ends at the latest break inside the segment that fits, else,
              // where the scan gives no break before the segment, as before NEL (UAX #14
              // LB6), it returns to its last break. Without one, Blink and WebKit retry
              // between graphemes, so the segment's graphemes fill it.
              if (segmentInner !== null) {
                const fitAdvances = breakableFitAdvances[i]!
                let innerAdvance = leadingSpacing
                for (let g = 0, k = 0; k < segmentInner.length; g++) {
                  innerAdvance += fitAdvances[g]! + (g > 0 ? letterSpacing : 0)
                  if (lineW + innerAdvance + letterSpacing > fitLimit) break
                  if (g + 1 === segmentInner[k]) {
                    innerBreakSegmentIndex = i
                    innerBreakGraphemeIndex = g + 1
                    innerBreakWidth = lineW + innerAdvance
                    k++
                  }
                }
              }
              const unbroken = (flags & UNBROKEN) !== 0
              if (innerBreakSegmentIndex >= 0 && (innerBreakSegmentIndex === i || (unbroken && innerBreakSegmentIndex >= pendingBreakSegmentIndex))) {
                endSegmentIndex = innerBreakSegmentIndex
                endGraphemeIndex = innerBreakGraphemeIndex
                endWidth = innerBreakWidth
                break decided
              }
              if (unbroken && pendingBreakSegmentIndex >= 0) {
                lineEndSegmentIndex = pendingBreakSegmentIndex
                lineEndGraphemeIndex = 0
              }
              if (!unbroken || pendingBreakSegmentIndex >= 0) {
                returnsFromHyphen = true
                break decided
              }
              // Blink's retry halts the segment where that lets it fit, and the line ends after it.
              if (overflowLineEndTrims !== null && newFitW - overflowLineEndTrims[i]! <= fitLimit) {
                lineW += advance
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                lineEndTrimmed = overflowLineEndTrims[i]!
                continue
              }
              if (breakableFitAdvances[i] === null) {
                returnsFromHyphen = true
                break decided
              }
              fillStart = 0
              fillSpacing = leadingSpacing
            } else {
              // A break the scan gives before text is one the line can return to.
              if ((flags & RETURNABLE) !== 0 && !breakAfter && pendingBreakSegmentIndex !== i) {
                pendingBreakSegmentIndex = i
                pendingBreakWidth = lineW
              }
              if (retreatsAtFullWidth && !breakAfter && (flags & UNBROKEN) === 0 && i > lineStartSegmentIndex && !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS)) {
                fitBreakSegmentIndex = i
                fitBreakPaintWidth = lineW
              }
              // The last break inside the segment is the line's latest.
              if (segmentInner !== null) {
                innerBreakSegmentIndex = i
                innerBreakGraphemeIndex = segmentInner[segmentInner.length - 1]!
                innerBreakWidth = lineW + getGraphemesAdvance(breakableFitAdvances[i]!, innerBreakGraphemeIndex, leadingSpacing, letterSpacing)
              }
              lineW += advance
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              // A segment that takes no room at the line end, as a space, leaves the glyph
              // before it last on the line, with its trim.
              if (fitAdvance !== 0 && !hangs) lineEndTrimmed = newFitW > fitLimit ? endTrim : 0
              if (breakAfter && (i + 1 === segmentCount || (segmentFlags[i + 1]! & UNBROKEN) === 0)) {
                pendingBreakSegmentIndex = i + 1
                pendingBreakWidth = hangs ? hangStartWidth : kind === TAB ? lineW : lineW - advance - lineEndTrimmed
              }
              if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + reservedHyphenWidth <= fitLimit) {
                fitBreakSegmentIndex = pendingBreakSegmentIndex
                fitBreakPaintWidth = pendingBreakWidth
              }
              continue
            }
          }

          // A grapheme fits with the letter spacing after it.
          const fitAdvances = breakableFitAdvances[i]!
          const fitCount = fitAdvances.length
          const entry = entryGeometry === null ? null : entryGeometry[i]!
          // Entry geometry describes whole segment tails on a fresh line.
          const freshWhole = hasContent ? null : getSegmentEntryWidth(entry, fillStart, fitCount)
          if (freshWhole !== null) {
            // Admission, ordered emergency prefixes and continuing pen are distinct.
            // The first real grapheme is mandatory source progress, even when unfit.
            const end = getFreshLineEnd(entry!, fillStart, fitCount, fitLimit)
            hasContent = true
            if (end <= fitCount) {
              lineEndSegmentIndex = i
              lineEndGraphemeIndex = end
              lineW = getSegmentEntryWidth(entry, fillStart, end)! - letterSpacing
              // Exhausting an emergency fragment consumes the measured segment and
              // ends this line. Only intact admission above continues into other source.
              if (end === fitCount) {
                endSegmentIndex = i + 1
                endGraphemeIndex = 0
                endWidth = lineW - lineEndTrimmed
              }
              break decided
            }
            lineEndSegmentIndex = i + 1
            lineEndGraphemeIndex = 0
            lineW = freshWhole - letterSpacing
          } else {
            // The first of the segment's inner breaks after the fill's start.
            let nextInner = 0
            while (segmentInner !== null && nextInner < segmentInner.length && segmentInner[nextInner]! <= fillStart) nextInner++
            for (let g = fillStart; g < fitCount; g++) {
              const baseGw = fitAdvances[g]!
              if (!hasContent) {
                hasContent = true
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
                lineW = baseGw
                // A line that holds only this grapheme, overflowing, keeps the graphemes after
                // it that can't start a line, and ends.
                const end = baseGw + letterSpacing > fitLimit
                  ? getOverflowingFirstGraphemeEnd(prepared, i, g, fitCount)
                  : g + 1
                if (end > g + 1) {
                  for (let k = g + 1; k < end; k++) lineW += fitAdvances[k]! + letterSpacing
                  endSegmentIndex = end === fitCount ? i + 1 : i
                  endGraphemeIndex = end === fitCount ? 0 : end
                  endWidth = lineW - lineEndTrimmed
                  break decided
                }
              } else {
                const candidatePaintWidth = lineW + (baseGw + (g > fillStart ? letterSpacing : fillSpacing))
                if (candidatePaintWidth + letterSpacing > fitLimit) {
                  // The line returns to its latest break inside a segment, as there is
                  // no other break to return to where graphemes fill it.
                  if (innerBreakSegmentIndex >= 0) {
                    endSegmentIndex = innerBreakSegmentIndex
                    endGraphemeIndex = innerBreakGraphemeIndex
                    endWidth = innerBreakWidth
                  }
                  break decided
                }
                lineW = candidatePaintWidth
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
              }
              if (segmentInner !== null && nextInner < segmentInner.length && segmentInner[nextInner] === g + 1) {
                innerBreakSegmentIndex = i
                innerBreakGraphemeIndex = g + 1
                innerBreakWidth = lineW
                nextInner++
              }
            }
          }
          if (hasContent && lineEndSegmentIndex === i && lineEndGraphemeIndex === fitCount) {
            lineEndSegmentIndex = i + 1
            lineEndGraphemeIndex = 0
          }
        }

        // A line that ends where its source runs out at an unfit selected hyphen
        // returns as well.
        endSegmentIndex = consumedEndSegmentIndex
        endGraphemeIndex = 0
        if (pendingBreakSegmentIndex === consumedEndSegmentIndex && lineEndGraphemeIndex === 0) {
          endWidth = pendingBreakWidth
          returnsFromHyphen = true
        } else {
          endWidth = lineW - lineEndTrimmed
        }
      }

      if (hasContent) {
        if (
          returnsFromHyphen &&
          fitBreakSegmentIndex >= 0 &&
          pendingBreakSegmentIndex === lineEndSegmentIndex &&
          lineEndGraphemeIndex === 0 &&
          returnsFromUnfitHyphen(prepared, engineProfile.unfitHyphenRetreat, lineStartSegmentIndex, fitBreakSegmentIndex, lineEndSegmentIndex, pendingBreakWidth, fitLimit)
        ) {
          endSegmentIndex = fitBreakSegmentIndex
          endGraphemeIndex = 0
          endWidth = fitBreakPaintWidth
        } else if (endSegmentIndex < 0) {
          // A line that ends at its pending break paints the pending width.
          endSegmentIndex = lineEndSegmentIndex
          endGraphemeIndex = lineEndGraphemeIndex
          endWidth = pendingBreakSegmentIndex === lineEndSegmentIndex && lineEndGraphemeIndex === 0
            ? pendingBreakWidth
            : lineW - lineEndTrimmed
        }
        cursor.segmentIndex = endSegmentIndex
        cursor.graphemeIndex = endGraphemeIndex
        // Preserved spaces and tabs before a hard break or the end of the text
        // hang only where they don't fit (CSS Text 3 §8.2).
        const hangsWhereUnfit =
          endGraphemeIndex === 0 &&
          hangEndSegmentIndex >= 0 &&
          (endSegmentIndex === hangEndSegmentIndex || endSegmentIndex === hangEndSegmentIndex + 1) &&
          (hangEndSegmentIndex === segmentCount || (segmentFlags[hangEndSegmentIndex]! & KIND_BITS) === HARD_BREAK)
        const paintWidth = (hangsWhereUnfit ? lineW - lineEndTrimmed : endWidth) +
          getTerminalLetterSpacing(prepared, hangingKinds, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex)
        lineWidth = hangsWhereUnfit && item === null ? Math.max(hangStartWidth, Math.min(paintWidth, availableWidth)) : paintWidth
        if (item !== null) {
          // Where the line wraps right after a run that goes on from before the item, the
          // width there is that run's start, before the item.
          const wrapsAfterRunFromBefore = !hangsWhereUnfit && hangsFromBefore && endGraphemeIndex === 0 && endSegmentIndex === hangEndSegmentIndex && endSegmentIndex > lineStartSegmentIndex
          item.hangWidth = hangsWhereUnfit ? paintWidth - hangStartWidth : wrapsAfterRunFromBefore ? -hangStartWidth : 0
          if (wrapsAfterRunFromBefore) lineWidth = 0
          // The line's latest break, as a line that returns to it ends: inside a segment,
          // at a segment start or before the item, or where that is a soft hyphen that
          // doesn't fit, the opportunity the line returns to from it.
          let breakSegmentIndex = pendingBreakSegmentIndex
          let breakGraphemeIndex = 0
          let breakWidth = pendingBreakWidth
          if (innerBreakSegmentIndex >= 0 && innerBreakSegmentIndex >= pendingBreakSegmentIndex) {
            breakSegmentIndex = innerBreakSegmentIndex
            breakGraphemeIndex = innerBreakGraphemeIndex
            breakWidth = innerBreakWidth
          } else if (fitBreakSegmentIndex >= 0 && returnsFromUnfitHyphen(prepared, engineProfile.unfitHyphenRetreat, lineStartSegmentIndex, fitBreakSegmentIndex, breakSegmentIndex, breakWidth, fitLimit)) {
            breakSegmentIndex = fitBreakSegmentIndex
            breakWidth = fitBreakPaintWidth
          }
          item.breakHangWidth = 0
          if (hangsFromBefore && breakGraphemeIndex === 0 && breakSegmentIndex === hangEndSegmentIndex && breakSegmentIndex > lineStartSegmentIndex) {
            item.breakHangWidth = -hangStartWidth
            breakWidth = 0
          }
          item.breakSegmentIndex = breakSegmentIndex
          item.breakGraphemeIndex = breakGraphemeIndex
          item.breakWidth = breakWidth + getTerminalLetterSpacing(prepared, hangingKinds, lineStartSegmentIndex, lineStartGraphemeIndex, breakSegmentIndex, breakGraphemeIndex)
        }
      }
    }
    if (lineWidth === null) break
    lastLineWidth = lineWidth
    if (stats !== null) {
      stats.lineCount++
      if (lineWidth > stats.maxLineWidth) stats.maxLineWidth = lineWidth
    }
    onLine?.(lineWidth, lineStartSegmentIndex, lineStartGraphemeIndex, cursor.segmentIndex, cursor.graphemeIndex)
    // A single-line caller owns normalization of the following line.
    if (singleLine || !normalizePreparedLineStart(prepared, cursor)) break
  }
  return lastLineWidth
}

// Steps one line of a fast-path handle from a normalized line start.
function stepPreparedSimpleLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
): number {
  const { widths, segmentFlags, breakableFitAdvances, entryGeometry, lineStartExtras, lineEndTrims, overflowLineEndTrims } = prepared
  // A negative width lays out as 0, as in the complex walker.
  const fitLimit = Math.max(0, maxWidth) + getEngineProfile().lineFitEpsilon
  const start = cursor.segmentIndex

  // The first segment of the line, or the rest of one a line ended inside. One that
  // overflows and can break fills the line grapheme by grapheme.
  const startAdvances = breakableFitAdvances[start]
  const startW = lineStartExtras === null ? widths[start]! : widths[start]! + lineStartExtras[start]!
  const startEndTrim = lineEndTrims === null ? 0 : lineEndTrims[start]!
  // Blink's retry between graphemes halts an overflowing first segment where that lets it fit.
  const startTrim = overflowLineEndTrims !== null && startW - overflowLineEndTrims[start]! <= fitLimit
    ? overflowLineEndTrims[start]!
    : startEndTrim
  // A line that starts inside a segment where it has fresh-line geometry takes the
  // tail, and goes on, or its fresh prefixes.
  const entry = cursor.graphemeIndex > 0 && entryGeometry !== null ? entryGeometry[start]! : null
  let lineW: number
  // The line-end trim of the last segment, where only that trim let it fit. Every
  // later segment overflows, so the line ends after it and paints that much less.
  let endTrimmed = 0
  if (entry !== null && entry.entries[cursor.graphemeIndex] !== null) {
    const segmentEnd = startAdvances!.length
    const end = getFreshLineEnd(entry, cursor.graphemeIndex, segmentEnd, fitLimit)
    lineW = getSegmentEntryWidth(entry, cursor.graphemeIndex, Math.min(end, segmentEnd))!
    if (end <= segmentEnd) {
      cursor.segmentIndex = end === segmentEnd ? start + 1 : start
      cursor.graphemeIndex = end === segmentEnd ? 0 : end
      return lineW
    }
  } else if (cursor.graphemeIndex > 0 || (startW - startTrim > fitLimit && startAdvances !== null)) {
    const fitAdvances = startAdvances!
    let g = cursor.graphemeIndex + 1
    lineW = fitAdvances[g - 1]!
    // A line that holds only an overflowing grapheme keeps the graphemes after it
    // that can't start a line, and ends.
    const overflowEnd = lineW > fitLimit ? getOverflowingFirstGraphemeEnd(prepared, start, g - 1, fitAdvances.length) : g
    if (overflowEnd > g) {
      for (; g < overflowEnd; g++) lineW += fitAdvances[g]!
      cursor.segmentIndex = g === fitAdvances.length ? start + 1 : start
      cursor.graphemeIndex = g === fitAdvances.length ? 0 : g
      return lineW
    }
    for (; g < fitAdvances.length; g++) {
      if (lineW + fitAdvances[g]! > fitLimit) {
        cursor.graphemeIndex = g
        return lineW
      }
      lineW += fitAdvances[g]!
    }
  } else {
    lineW = startW
    if (startW > fitLimit) endTrimmed = startTrim
  }

  // Every boundary of a fast-path handle is a break, so the line takes whole
  // segments until one overflows. An overflowing space or ZWSP hangs and ends the
  // line; before other text, the line leaves out a space or ZWSP it ends with.
  for (let i = start + 1; i < widths.length; i++) {
    const w = widths[i]!
    const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!
    if (lineW + w - endTrim > fitLimit) {
      const hangs = breaksAfterKind(segmentFlags[i]! & KIND_BITS)
      cursor.segmentIndex = hangs ? i + 1 : i
      cursor.graphemeIndex = 0
      return !hangs && breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS) ? lineW - widths[i - 1]! : lineW - endTrimmed
    }
    lineW += w
    endTrimmed = lineW > fitLimit ? endTrim : 0
  }
  cursor.segmentIndex = widths.length
  cursor.graphemeIndex = 0
  return lineW - endTrimmed
}

// Steps one line from a normalized line start, or a rich-inline item's line (ItemLine),
// which the full walker continues from the item's start. A cursor inside a segment
// needs that segment's breakable fit advances. A handle rich-inline gives the full
// walker leaves the line's latest break in `item`.
export function stepPreparedLineGeometryFromStart(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
  item: ItemLine | null = null,
): number | null {
  if (prepared.simpleLineWalkFastPath && (item === null || !item.continues)) return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  return walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true, item)
}
