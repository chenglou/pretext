import type { SegmentBreakKind } from './analysis.js'
import type { LayoutCursor, LineStats } from './layout.js'
import { getEngineProfile } from './measurement.js'
import { getFreshLineEnd, getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'

// A segment's flags byte: its kind's code in the low four bits, then what else
// the walkers read of it.
export const TEXT = 0
export const SPACE = 1
export const ZERO_WIDTH_BREAK = 2
export const SOFT_HYPHEN = 3
export const PRESERVED_SPACE = 4
export const TAB = 5
export const ZERO_WIDTH_GLUE = 6
export const CONTROL = 7
// Ends its chunk: a line's walk stops there, and the next line starts after it.
export const HARD_BREAK = 8
export const KIND_BITS = 0x0F
// The segment takes letter spacing after its graphemes.
export const SPACED = 0x10
// The engine's scan gives no break before the segment, so no line ends there.
export const UNBROKEN = 0x20
// The scan gives a break before the segment, in text that also has unbroken
// boundaries, where a line that overflows at one returns to the latest such break.
export const RETURNABLE = 0x40
const BREAK_AFTER_KINDS = 1 << SPACE | 1 << ZERO_WIDTH_BREAK | 1 << SOFT_HYPHEN | 1 << PRESERVED_SPACE | 1 << TAB

export function getKindCode(kind: SegmentBreakKind): number {
  switch (kind) {
    case 'text': return TEXT
    case 'space': return SPACE
    case 'zero-width-break': return ZERO_WIDTH_BREAK
    case 'soft-hyphen': return SOFT_HYPHEN
    case 'preserved-space': return PRESERVED_SPACE
    case 'tab': return TAB
    case 'zero-width-glue': return ZERO_WIDTH_GLUE
    case 'control': return CONTROL
    case 'hard-break': return HARD_BREAK
  }
}

// The prepared handle's line-break data: parallel arrays per segment.
export type PreparedLineBreakData = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  segmentFlags: Uint8Array // Per segment, its flags byte, e.g. [TEXT, SPACE, TEXT]
  simpleLineWalkFastPath: boolean // Normal text can use the simple line stepper across all layout APIs
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
  letterSpacing: number // Extra advance between rendered graphemes on the same line
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
  // Per segment, how much narrower a soft hyphen's neighboring text measures
  // joined than apart, else 0. Null when the text has no soft hyphen or the engine
  // keeps an unfit hyphen.
  discretionaryHyphenContexts: number[] | null
  tabStopAdvance: number // Absolute advance between tab stops for pre-wrap tab segments
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
  if (endSegmentIndex < segmentFlags.length && (segmentFlags[endSegmentIndex]! & KIND_BITS) !== HARD_BREAK &&
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
  // from where the last one ended, past what a line can't start with.
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
export function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  if (!prepared.simpleLineWalkFastPath) {
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

  // Fast-path handles never start with a space, so this skip never runs, but
  // without it Firefox 156 counted Latin chat messages at new widths in 1.10 to
  // 1.15 of main's time (RESEARCH.md, Decisions Log). To re-check it, remove the
  // skip and run `bun harness bench main --browser=firefox --rows=resize
  // --sessions=2`. A ZWSP at `first` starts the first line.
  let first = 0
  while (first < segmentCount && (segmentFlags[first]! & KIND_BITS) === SPACE) first++
  for (let i = first; i < segmentCount; i++) {
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
    } else if (kind === SPACE || (kind === ZERO_WIDTH_BREAK && i !== first)) {
      continue
    }

    const startW = lineStartExtras === null ? w : w + lineStartExtras[i]!
    const advances = breakableFitAdvances[i]!
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

// A return from an unfit discretionary hyphen needs an overflow that isolated
// widths can show and a target that really is the latest opportunity. The soft
// hyphens on the line may measure narrower joined than apart by less than the
// overflow, and nothing after the target may be text after text, which can hold
// an opportunity that segment kinds don't mark. Checked only on a line that would
// end at an unfit hyphen. The target can be a segment start that follows a break
// outside the prepared text, such as a rich-inline item boundary.
export function canReturnFromUnfitHyphen(
  prepared: PreparedLineBreakData,
  lineStartSegmentIndex: number,
  targetSegmentIndex: number,
  softHyphenIndex: number,
  overflow: number,
): boolean {
  const { discretionaryHyphenContexts, segmentFlags } = prepared
  if (discretionaryHyphenContexts === null) return false
  let narrowing = 0
  for (let i = lineStartSegmentIndex; i <= softHyphenIndex; i++) narrowing += discretionaryHyphenContexts[i]!
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
// 12-14ns there against about 1ns for a local.
function walkPreparedComplexLines(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
  onLine: InternalLineVisitor | undefined,
  stats: LineStats | null,
  singleLine = false,
  // A single-line caller can end stepping at an ordinary break before this
  // cursor, as if the text continued past it. JavaScriptCore walked letter-spaced
  // and pre-wrap text 30-65% slower with an infinite default here, which it types
  // as a double.
  endSegmentLimit = prepared.segmentFlags.length,
  endGraphemeLimit = 0,
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
    tabStopAdvance,
  } = prepared
  const segmentCount = segmentFlags.length
  const segmentStop = endSegmentLimit < segmentCount ? endSegmentLimit : segmentCount
  const engineProfile = getEngineProfile()
  // Preserved spaces and tabs at the end of a line hang past it (CSS Text 3
  // §4.1.2), so they take no room when fitting and don't size the line (§8.2).
  // Gecko doesn't hang tabs.
  const hangingKinds = 1 << PRESERVED_SPACE | (engineProfile.hangTabs ? 1 << TAB : 0)
  const zeroWidthGlueTakesLine = engineProfile.zeroWidthGlueTakesLine
  // Tab stops are eight spaces apart, so half a space is a sixteenth of one.
  const minimumTabAdvance = engineProfile.skipNarrowTabStops ? tabStopAdvance / 16 : 0
  // A negative width lays out as 0, as in the simple stepper.
  const availableWidth = Math.max(0, maxWidth)
  const fitLimit = availableWidth + engineProfile.lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the engine retreats
  // and the text has a soft hyphen. The profile test changes no result, but
  // without it Chrome counted letter-spaced CJK and pre-wrap text 3-7% slower
  // (RESEARCH.md, Keeping Work Bounded).
  const retreatsFromUnfitHyphen = prepared.discretionaryHyphenContexts !== null && engineProfile.unfitHyphenRetreat !== 'none'
  // Blink's retry leaves room for the hyphen at every earlier opportunity. Gecko
  // returns to any opportunity whose line fits, such as a break between text segments.
  const retreatsAtFullWidth = retreatsFromUnfitHyphen && engineProfile.unfitHyphenRetreat === 'full-width'
  const reservedHyphenWidth = retreatsAtFullWidth ? 0 : discretionaryHyphenWidth

  let lastLineWidth: number | null = null
  while (true) {
    const lineStartSegmentIndex = cursor.segmentIndex
    const lineStartGraphemeIndex = cursor.graphemeIndex
    let lineW = 0
    let hasContent = false
    let lineEndSegmentIndex = lineStartSegmentIndex
    let lineEndGraphemeIndex = lineStartGraphemeIndex
    let pendingBreakSegmentIndex = -1
    // A line that ends at the pending break both fits and paints this width.
    let pendingBreakWidth = 0
    // The latest opportunity whose line leaves room for the hyphen, which Blink's
    // retry against the width minus the hyphen returns to when a selected
    // discretionary hyphen does not fit, with that line's painted width.
    let fitBreakSegmentIndex = -1
    let fitBreakPaintWidth = 0
    // The latest run of preserved spaces and tabs: the segment after it, and the
    // line's width before it, with the gap after the glyph before it.
    let hangEndSegmentIndex = -1
    let hangStartWidth = 0
    // The line-end trim of the last whole segment, where only that trim let it fit.
    // Every later segment overflows, so the line ends after it and paints that much less.
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
        // break, at the end of the text, or at a caller's limit.
        let consumedEndSegmentIndex: number
        for (let i = lineStartSegmentIndex; ; i++) {
          // The graphemes of segment i from fillStart to fillEnd go on the line one by
          // one, after the gap fillSpacing.
          let fillStart: number
          let fillEnd: number
          let fillSpacing = 0
          if (i >= segmentStop) {
            if (i >= segmentCount) {
              consumedEndSegmentIndex = segmentCount
              break
            }
            if (i === endSegmentLimit && (segmentFlags[i]! & KIND_BITS) === HARD_BREAK) {
              consumedEndSegmentIndex = i + 1
              break
            }
            // A limit before the chunk end is an ordinary break before later text.
            consumedEndSegmentIndex = endSegmentLimit
            if (endGraphemeLimit === 0) break
            // A limit inside a breakable text segment walks its leading graphemes as
            // the last unit of the line.
            i = endSegmentLimit
            if (hasContent) {
              const fitAdvances = breakableFitAdvances[i]!
              let advance = letterSpacing !== 0 && (segmentFlags[i]! & SPACED) !== 0 && !zeroWidthPrefix && !afterUnspacedControl
                ? letterSpacing
                : 0
              for (let g = 0; g < endGraphemeLimit; g++) {
                advance += fitAdvances[g]! + (g > 0 ? letterSpacing : 0)
              }
              if (lineW + advance + letterSpacing <= fitLimit) {
                lineW += advance
                endSegmentIndex = i
                endGraphemeIndex = endGraphemeLimit
                endWidth = lineW
              } else {
                returnsFromHyphen = true
              }
              break decided
            }
            fillStart = i === lineStartSegmentIndex ? lineStartGraphemeIndex : 0
            fillEnd = endGraphemeLimit
          } else {
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
              ? getTabAdvance(lineW + leadingSpacing, tabStopAdvance, minimumTabAdvance)
              : widths[i]!
            const advance = leadingSpacing + w
            const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!

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
              if (hangEndSegmentIndex !== i) hangStartWidth = lineW + leadingSpacing
              hangEndSegmentIndex = i + 1
            }
            // Where glue can't hold a line, glue at a line start isn't the line's content:
            // the segment after it starts the line, however wide.
            if (!hasContent && kind === ZERO_WIDTH_GLUE && !zeroWidthGlueTakesLine) {
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              continue
            }

            if (!hasContent) {
              if (startGraphemeIndex > 0) {
                fillStart = startGraphemeIndex
                fillEnd = breakableFitAdvances[i]!.length
              } else {
                const startExtra = lineStartExtras === null ? 0 : lineStartExtras[i]!
                if (fitAdvance + startExtra - endTrim > fitLimit && breakableFitAdvances[i] !== null) {
                  fillStart = 0
                  fillEnd = breakableFitAdvances[i]!.length
                } else {
                  hasContent = true
                  lineEndSegmentIndex = i + 1
                  lineEndGraphemeIndex = 0
                  lineW = w + startExtra
                  lineEndTrimmed = fitAdvance + startExtra > fitLimit ? endTrim : 0
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
              // A run of preserved spaces and tabs fits where the text before it fits.
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

                // Where the scan gives no break before the segment, as before NEL (UAX
                // #14 LB6), the line returns to its last break. Without one, Blink and
                // WebKit retry between graphemes, so the segment's graphemes fill it.
                const unbroken = (flags & UNBROKEN) !== 0
                if (unbroken && pendingBreakSegmentIndex >= 0) {
                  lineEndSegmentIndex = pendingBreakSegmentIndex
                  lineEndGraphemeIndex = 0
                }
                if (!unbroken || pendingBreakSegmentIndex >= 0 || breakableFitAdvances[i] === null) {
                  returnsFromHyphen = true
                  break decided
                }
                fillStart = 0
                fillEnd = breakableFitAdvances[i]!.length
                fillSpacing = leadingSpacing
              } else {
                // A break the scan gives before text is one the line can return to.
                if ((flags & RETURNABLE) !== 0 && !breakAfter && pendingBreakSegmentIndex !== i) {
                  pendingBreakSegmentIndex = i
                  pendingBreakWidth = lineW
                }
                if (retreatsAtFullWidth && !breakAfter && (flags & UNBROKEN) === 0 && !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS)) {
                  fitBreakSegmentIndex = i
                  fitBreakPaintWidth = lineW
                }
                lineW += advance
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                lineEndTrimmed = newFitW > fitLimit ? endTrim : 0
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
          }

          // A grapheme fits with the letter spacing after it.
          const fitAdvances = breakableFitAdvances[i]!
          const fitCount = fitAdvances.length
          const entry = entryGeometry === null ? null : entryGeometry[i]!
          // Entry geometry describes whole segment tails on a fresh line, not a
          // caller's grapheme limit.
          const freshWhole = !hasContent && fillEnd === fitCount
            ? getSegmentEntryWidth(entry, fillStart, fitCount)
            : null
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
            for (let g = fillStart; g < fillEnd; g++) {
              const baseGw = fitAdvances[g]!
              if (!hasContent) {
                hasContent = true
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
                lineW = baseGw
                // A line that holds only this grapheme, overflowing, keeps the graphemes after
                // it that can't start a line, and ends.
                const end = baseGw + letterSpacing > fitLimit
                  ? getOverflowingFirstGraphemeEnd(prepared, i, g, fillEnd)
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
                if (candidatePaintWidth + letterSpacing > fitLimit) break decided
                lineW = candidatePaintWidth
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
              }
            }
          }
          if (i === endSegmentLimit) {
            endSegmentIndex = i
            endGraphemeIndex = endGraphemeLimit
            endWidth = lineW
            break decided
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
          (segmentFlags[lineEndSegmentIndex - 1]! & KIND_BITS) === SOFT_HYPHEN &&
          !(pendingBreakWidth <= fitLimit) &&
          canReturnFromUnfitHyphen(prepared, lineStartSegmentIndex, fitBreakSegmentIndex, lineEndSegmentIndex - 1, pendingBreakWidth - fitLimit)
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
        const paintWidth = (hangsWhereUnfit ? lineW : endWidth) +
          getTerminalLetterSpacing(prepared, hangingKinds, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex)
        lineWidth = hangsWhereUnfit ? Math.max(hangStartWidth, Math.min(paintWidth, availableWidth)) : paintWidth
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
  const { widths, segmentFlags, breakableFitAdvances, entryGeometry, lineStartExtras, lineEndTrims } = prepared
  // A negative width lays out as 0, as in the complex walker.
  const fitLimit = Math.max(0, maxWidth) + getEngineProfile().lineFitEpsilon
  const start = cursor.segmentIndex

  // The first segment of the line, or the rest of one a line ended inside. One that
  // overflows and can break fills the line grapheme by grapheme.
  const startAdvances = breakableFitAdvances[start]
  const startW = lineStartExtras === null ? widths[start]! : widths[start]! + lineStartExtras[start]!
  const startTrim = lineEndTrims === null ? 0 : lineEndTrims[start]!
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

// Steps one line from a normalized line start. An end cursor stops stepping at
// an ordinary break there, as if the text continued past it, and returns the
// paint width of a line that ends there. A cursor inside a segment needs that
// segment's breakable fit advances.
export function stepPreparedLineGeometryFromStart(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
  endSegmentIndex = prepared.widths.length,
  endGraphemeIndex = 0,
): number | null {
  if (prepared.simpleLineWalkFastPath && endSegmentIndex === prepared.widths.length) {
    return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  }

  return walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true, endSegmentIndex, endGraphemeIndex)
}

export function stepPreparedLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
  endSegmentIndex = prepared.widths.length,
  endGraphemeIndex = 0,
): number | null {
  if (!normalizePreparedLineStart(prepared, cursor)) return null
  return stepPreparedLineGeometryFromStart(prepared, cursor, maxWidth, endSegmentIndex, endGraphemeIndex)
}
