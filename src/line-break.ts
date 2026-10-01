import {
  CONTROL,
  HARD_BREAK,
  KIND_BITS,
  OBJECT,
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
  // as Blink's line-end halt of a closing mark; an object's is width its line doesn't fit
  // there and still paints (ParagraphSegmentData). Null without any.
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
  // What the segments of a rich-inline paragraph of several items have of their own (src/rich-inline.ts); a text's
  // handle has none.
  items?: ParagraphSegmentData
}

// What a rich-inline paragraph's items give its segments. `itemSegments` has each item's first segment, then the
// segment count. The rest is per segment, each null where no item differs: the hyphen a soft hyphen paints and the
// advance between a tab's stops, in the item's font; the item's extraWidth where a line that starts inside the segment
// pays it (`insideExtras`), or starts at it and fills it grapheme by grapheme (`fillExtras`), as a line that starts
// with the whole segment pays lineStartExtras; and the width of a segment that is the start edge of a padded item's
// opening (getOpeningFit in src/rich-inline.ts), which a line that takes it paints whole, whatever of it the line
// fitted: an object's line-end trim is the part its line doesn't fit, and an edge the engine fits none of is a
// preserved space, which takes no room in the run of preserved spaces and tabs it is in (`openingEdges`).
export type ParagraphSegmentData = {
  itemSegments: number[]
  hyphenWidths: number[] | null
  tabStopAdvances: number[] | null
  insideExtras: number[] | null
  fillExtras: number[] | null
  openingEdges: number[] | null
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

// The item a segment of a rich-inline paragraph is in: the last one that starts at or before it, so an item with no
// segments of its own, as an empty one, is never one's.
export function getItemIndex(itemSegments: number[], segmentIndex: number): number {
  let low = 0
  let high = itemSegments.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (itemSegments[middle]! <= segmentIndex) low = middle
    else high = middle - 1
  }
  return low
}

// The advance of tab segment `index` of a rich-inline paragraph, which the line reaches at `lineWidth`: to the next
// stop of its item's font. Tab stops count from the line's start in every engine, never from an item's (Blink's
// line_breaker.cc:2963-2971, WebKit's pen position, Gecko's CalcTabWidths, nsTextFrame.cpp:4298-4378). A padded item's
// text starts after its start edge, half its extraWidth, all of which the line has counted by then: the other half is
// the end edge, which follows the item's text on the line.
export function getItemTabAdvance(items: ParagraphSegmentData | undefined, index: number, lineWidth: number, tabStopAdvance: number, skipNarrowTabStops: boolean): number {
  const stopAdvance = items === undefined || items.tabStopAdvances === null ? tabStopAdvance : items.tabStopAdvances[index]!
  const endEdge = items === undefined || items.insideExtras === null ? 0 : items.insideExtras[index]! / 2
  // Tab stops are eight spaces apart, so half a space is a sixteenth of one.
  return getTabAdvance(lineWidth - endEdge, stopAdvance, skipNarrowTabStops ? stopAdvance / 16 : 0)
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
  if (endSegmentIndex > startSegmentIndex && endSegmentIndex < segmentFlags.length && (segmentFlags[endSegmentIndex]! & KIND_BITS) !== HARD_BREAK &&
    (1 << (segmentFlags[endSegmentIndex - 1]! & KIND_BITS) & hangingKinds) !== 0) return 0

  for (let i = endSegmentIndex - 1; i >= startSegmentIndex; i--) {
    const flags = segmentFlags[i]!
    const kind = flags & KIND_BITS
    // Segments that take no letter spacing, such as zero-width glue or marks
    // shaped on the grapheme before them, leave that grapheme's gap last. An
    // object leaves none after itself.
    if (kind === SPACE || (kind !== CONTROL && kind !== OBJECT && (flags & SPACED) === 0)) continue

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

// Whether the run of preserved spaces and tabs that hang, which starts at segment `start` right after an object on
// its line, an atomic rich-inline item or a box (OBJECT), stays there however far the line overflows, as no break comes
// before it in the text (UAX #14 LB7). Blink takes it as trailing items after the break after an atomic inline
// (HandleTrailingSpaces, line_breaker.cc:2426-2534), trailing on into the next item where an item's spaces reach its end
// (:2518-2533); WebKit gives a soft wrap opportunity after each white-space item (isAtSoftWrapOpportunity,
// InlineFormattingUtils.cpp:408-413) and keeps each as content that hangs (InlineContentBreaker.cpp:181-182); and
// Gecko lets an empty frame past the line's end (CanPlaceFrame, nsLineLayout.cpp:1217-1270). After text that
// overflows, the engine's retry between graphemes breaks before the white space instead. But Gecko breaks only after a
// run of spaces and tabs (nsLineBreaker.cpp:323, :586) and doesn't hang a tab, so where the white space runs into a
// tab, Firefox moves all of it to the next line with the tab. The walker asks once per run, so a long run costs one
// pass.
function staysAfterObject(segmentFlags: Uint8Array, start: number, hangingKinds: number): boolean {
  let after = start + 1
  while (after < segmentFlags.length && (1 << (segmentFlags[after]! & KIND_BITS) & hangingKinds) !== 0) after++
  return after === segmentFlags.length || (segmentFlags[after]! & KIND_BITS) !== TAB
}

// Whether a line that would end at the break before `breakSegmentIndex`, painting
// `breakWidth`, returns to the earlier opportunity `targetSegmentIndex`: where it
// ends at a selected discretionary hyphen that doesn't fit. A return needs an
// overflow that isolated widths can show and a target that really is the latest
// opportunity. The soft hyphens on the line may measure narrower joined than apart by
// less than the overflow, and nothing after the target may be text after text, which
// can hold an opportunity that segment kinds don't mark. A rich-inline paragraph marks
// every break the scan gives before text (src/rich-inline.ts), so its target is the
// latest opportunity that leaves the room.
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
    // WebKit keeps an unfit hyphen in one text, but moves a run that continues across inline boxes to the next
    // line whole where its first break is a soft hyphen whose hyphen doesn't fit: Safari 27 lays out the spans
    // `the `, `inter`, `na\u00ADtion\u00ADal` in 16px Arial at 84px as `the` / `interna-tion-` / `al`. So the
    // line returns only to the break before a run that reaches the soft hyphen past the start of a rich-inline
    // item, with no break between (src/rich-inline.ts gives such a paragraph its contexts).
    for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
      if (breaksAfterKind(segmentFlags[i]! & KIND_BITS) || (i > targetSegmentIndex && (segmentFlags[i]! & UNBROKEN) === 0)) return false
    }
    const itemSegments = prepared.items === undefined ? null : prepared.items.itemSegments
    return itemSegments !== null && itemSegments[getItemIndex(itemSegments, softHyphenIndex)]! > targetSegmentIndex
  }
  const overflow = breakWidth - fitLimit
  let narrowing = 0
  if (discretionaryHyphenContexts !== null) for (let i = lineStartSegmentIndex; i <= softHyphenIndex; i++) narrowing += discretionaryHyphenContexts[i]!
  if (narrowing >= overflow) return false
  for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
    if (breaksAfterKind(segmentFlags[i]! & KIND_BITS)) continue
    if (i > targetSegmentIndex && !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS) && prepared.items === undefined) return false
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
  const items = prepared.items
  const hyphenWidths = items === undefined ? null : items.hyphenWidths
  const insideExtras = items === undefined ? null : items.insideExtras
  const fillExtras = items === undefined ? null : items.fillExtras
  const openingEdges = items === undefined ? null : items.openingEdges
  const engineProfile = getEngineProfile()
  // Preserved spaces and tabs at the end of a line hang past it (CSS Text 3
  // §4.1.2), so they take no room when fitting and don't size the line (§8.2).
  // Gecko doesn't hang tabs.
  const hangingKinds = 1 << PRESERVED_SPACE | (engineProfile.hangTabs ? 1 << TAB : 0)
  const zeroWidthGlueTakesLine = engineProfile.zeroWidthGlueTakesLine
  // Tab stops are eight spaces apart, so half a space is a sixteenth of one.
  const skipNarrowTabStops = engineProfile.skipNarrowTabStops
  const minimumTabAdvance = skipNarrowTabStops ? tabStopAdvance / 16 : 0
  // A negative width lays out as 0, as in the simple stepper.
  const availableWidth = Math.max(0, maxWidth)
  const fitLimit = availableWidth + engineProfile.lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the engine retreats
  // and the text has a soft hyphen.
  const retreatsFromUnfitHyphen = prepared.discretionaryHyphenContexts !== null
  // Blink's retry leaves room for the hyphen at every earlier opportunity. Gecko
  // returns to any opportunity whose line fits, such as a break between text segments.
  const retreatsAtFullWidth = retreatsFromUnfitHyphen && engineProfile.unfitHyphenRetreat === 'full-width'
  const reservedHyphenWidth = engineProfile.unfitHyphenRetreat === 'reduced-width' ? discretionaryHyphenWidth : 0

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
    // line's width before it, less the line-end trim of the text it follows, with
    // the gap after the glyph before it. In a rich-inline paragraph, the run can
    // stay on its line after an object however far it overflows (staysAfterObject),
    // and that width also has the edges in the run that a line ending in it paints,
    // which are hangEdgesWidth wide (ParagraphSegmentData).
    let hangEndSegmentIndex = -1
    let hangStartWidth = 0
    let hangStays = false
    let hangEdgesWidth = 0
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
          // after itself, and so does an object, which is no character (CSS Text 3,
          // letter-spacing); other segments that take none leave it as it was.
          const gap = letterSpacing !== 0 && hasContent && !zeroWidthPrefix && !afterUnspacedControl ? letterSpacing : 0
          let leadingSpacing = 0
          if (letterSpacing !== 0 && (spaced || kind === CONTROL || kind === OBJECT)) {
            leadingSpacing = gap
            afterUnspacedControl = !spaced
          }
          if (kind !== ZERO_WIDTH_BREAK && kind !== ZERO_WIDTH_GLUE) zeroWidthPrefix = false
          const w = kind !== TAB ? widths[i]!
            : items === undefined ? getTabAdvance(lineW + leadingSpacing, tabStopAdvance, minimumTabAdvance)
            : getItemTabAdvance(items, i, lineW + leadingSpacing, tabStopAdvance, skipNarrowTabStops)
          const advance = leadingSpacing + w
          const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!

          if (kind === SOFT_HYPHEN && startGraphemeIndex === 0) {
            if (hasContent) {
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              if (i + 1 < segmentCount && (segmentFlags[i + 1]! & KIND_BITS) !== HARD_BREAK) {
                pendingBreakSegmentIndex = i + 1
                pendingBreakWidth = lineW + (hyphenWidths === null ? discretionaryHyphenWidth : hyphenWidths[i]!)
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
              hangStays = items !== undefined && i > lineStartSegmentIndex && (segmentFlags[i - 1]! & KIND_BITS) === OBJECT && staysAfterObject(segmentFlags, i, hangingKinds)
              hangEdgesWidth = 0
            }
            hangEndSegmentIndex = i + 1
            if (openingEdges !== null) {
              hangStartWidth += openingEdges[i]!
              hangEdgesWidth += openingEdges[i]!
            }
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
                lineEndTrimmed = fitAdvance + startExtra > fitLimit && kind !== OBJECT ? startTrim : 0
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
            // A run of preserved spaces and tabs fits where the text before it fits, and after an
            // object however far the line overflows (staysAfterObject). Gecko places a frame by
            // CanPlaceFrame, which fits a frame's whole width (EngineProfile, paddedOpeningFit) and
            // lets an empty one stay wherever it falls (nsLineLayout.cpp:1264-1269), so there an
            // object of width 0 stays on a line that already overflows, where Blink and WebKit move
            // it to the next line as any other.
            const newFitW = hangs ? hangStartWidth - hangEdgesWidth : lineW + fitAdvance
            if (
              newFitW - endTrim > fitLimit &&
              !(hangs && hangStays) &&
              !(kind === OBJECT && w === 0 && engineProfile.paddedOpeningFit === 'both')
            ) {
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

              const unbroken = (flags & UNBROKEN) !== 0
              // An object with no break before it is the start edge of a padded rich-inline item's opening
              // (src/rich-inline.ts). Blink's line trails once the preserved spaces it ends with overflow: it
              // takes the white space after them, the tags of spans that open among it and a forced break
              // with no fit (HandleTrailingSpaces, line_breaker.cc:2426-2534), so an edge right after such a
              // run joins it, taking no room.
              if (kind === OBJECT && unbroken && hangEndSegmentIndex === i && lineW > fitLimit && engineProfile.paddedOpeningFit === 'start') {
                hangEndSegmentIndex = i + 1
                hangStartWidth += w
                hangEdgesWidth += w
                lineW += advance
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                continue
              }
              // Where the scan gives no break before the segment, as before NEL (UAX #14
              // LB6), the line returns to its last break. Without one, Blink and WebKit retry
              // between graphemes, so the segment's graphemes fill it.
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
              // Where the line of such an edge has no break to return to, the line ends before it, but
              // before a hard break only in Blink, whose retry breaks between any two graphemes: WebKit and
              // Gecko end the line before the last grapheme of the text before the edge, and keep the edge on
              // a line that grapheme starts (EngineProfile, hardBreakItemRetreat).
              if (kind === OBJECT && engineProfile.hardBreakItemRetreat !== 'item' && (segmentFlags[i + 1]! & KIND_BITS) === HARD_BREAK) {
                const beforeFlags = segmentFlags[i - 1]!
                const beforeKind = beforeFlags & KIND_BITS
                const beforeAdvances = beforeKind === TEXT || beforeKind === CONTROL ? breakableFitAdvances[i - 1]! : null
                const spacing = (beforeFlags & SPACED) !== 0 ? letterSpacing : 0
                if (beforeAdvances !== null && (i - 1 > lineStartSegmentIndex || beforeAdvances.length - 1 > lineStartGraphemeIndex)) {
                  endSegmentIndex = i - 1
                  endGraphemeIndex = beforeAdvances.length - 1
                  endWidth = lineW - beforeAdvances[endGraphemeIndex]! - spacing
                  break decided
                }
                if (beforeAdvances === null && (beforeKind === TEXT || beforeKind === CONTROL) && i - 1 > lineStartSegmentIndex) {
                  endSegmentIndex = i - 1
                  endGraphemeIndex = 0
                  endWidth = lineW - widths[i - 1]! - spacing
                  break decided
                }
                if (beforeKind !== PRESERVED_SPACE && beforeKind !== TAB) {
                  lineW += advance
                  lineEndSegmentIndex = i + 1
                  lineEndGraphemeIndex = 0
                  lineEndTrimmed = 0
                  continue
                }
              }
              if (breakableFitAdvances[i] === null) {
                returnsFromHyphen = true
                break decided
              }
              fillStart = 0
              fillSpacing = leadingSpacing
            } else {
              // A break the scan gives before text is one the line can return to. A rich-inline
              // paragraph's line returns to it from an unfit hyphen too, where it leaves the room the
              // engine's return needs: Chrome lays out the spans `\u6F22\u5B57`, `\u00ADab`, `cd` in 16px
              // Arial at 34.7px as `\u6F22` / `\u5B57-` / `abcd`. A text's line doesn't yet
              // (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
              if ((flags & RETURNABLE) !== 0 && !breakAfter && pendingBreakSegmentIndex !== i) {
                pendingBreakSegmentIndex = i
                pendingBreakWidth = lineW
                if (items !== undefined && retreatsFromUnfitHyphen && lineW + reservedHyphenWidth <= fitLimit) {
                  fitBreakSegmentIndex = i
                  fitBreakPaintWidth = lineW
                }
              }
              if (retreatsAtFullWidth && !breakAfter && (flags & UNBROKEN) === 0 && i > lineStartSegmentIndex && !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS)) {
                fitBreakSegmentIndex = i
                fitBreakPaintWidth = lineW
              }
              lineW += advance
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              // A segment that takes no room at the line end, as a space, leaves the glyph
              // before it last on the line, with its trim.
              if (fitAdvance !== 0 && !hangs) lineEndTrimmed = newFitW > fitLimit && kind !== OBJECT ? endTrim : 0
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
            for (let g = fillStart; g < fitCount; g++) {
              const baseGw = fitAdvances[g]!
              if (!hasContent) {
                hasContent = true
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
                lineW = baseGw
                if (g > 0 ? insideExtras !== null : fillExtras !== null) lineW += g > 0 ? insideExtras![i]! : fillExtras![i]!
                // A line that holds only this grapheme, overflowing, keeps the graphemes after
                // it that can't start a line, and ends.
                const end = lineW + letterSpacing > fitLimit
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
                if (candidatePaintWidth + letterSpacing > fitLimit) break decided
                lineW = candidatePaintWidth
                lineEndSegmentIndex = i
                lineEndGraphemeIndex = g + 1
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
          // A line that wraps right after a run of preserved spaces and tabs hangs it, with no break there too.
          endWidth = pendingBreakSegmentIndex === lineEndSegmentIndex && lineEndGraphemeIndex === 0 ? pendingBreakWidth
            : hangEndSegmentIndex === lineEndSegmentIndex && lineEndGraphemeIndex === 0 ? hangStartWidth
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
    // A line that starts inside a padded rich-inline item pays its extraWidth (ParagraphSegmentData).
    const items = prepared.items
    if (items !== undefined && (g > 1 ? items.insideExtras !== null : items.fillExtras !== null)) lineW += g > 1 ? items.insideExtras![start]! : items.fillExtras![start]!
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

// Steps one line from a normalized line start. A cursor inside a segment needs that segment's
// breakable fit advances.
export function stepPreparedLineGeometryFromStart(
  prepared: PreparedLineBreakData,
  cursor: LayoutCursor,
  maxWidth: number,
): number | null {
  if (prepared.simpleLineWalkFastPath) return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  return walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true)
}
