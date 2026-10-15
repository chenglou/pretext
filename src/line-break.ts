import {
  CONTROL,
  DROPPED,
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
import { getEngineProfile } from './measurement.js'

const BREAK_AFTER_KINDS = 1 << SPACE | 1 << ZERO_WIDTH_BREAK | 1 << SOFT_HYPHEN | 1 << PRESERVED_SPACE | 1 << TAB

// The prepared handle's line-break data: parallel arrays per segment.
export type PreparedLineBreakData = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  // Per segment, its flags byte, e.g. [TEXT, SPACE, TEXT]. A JSON copy of the handle turns it into an
  // object with no length, so the walkers take the segment count from `widths` and read this by
  // index, which the copy answers the same (RESEARCH.md, Decisions Log, 2026-09-24)
  segmentFlags: Uint8Array
  // Normal text can use the simple line stepper across all layout APIs, and layout()
  // counts it with one numeric loop where it has no overflow trims
  simpleLineWalkFastPath: boolean
  // Normal text, or text of its kinds where the scan gives no break at some segment
  // boundary, which layout() counts with the simple stepper
  simpleLineCountFastPath: boolean
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  // Per segment with breakable fit advances, per grapheme, width a line that starts with that
  // grapheme adds to its advance, as Blink shapes the start of a line inside a word again
  // (getSegmentFit in src/measurement.ts). Null without any.
  breakableLineStartExtras: (number[] | null)[] | null
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
  // joined than apart, else 0. Null when the text has no soft hyphen.
  discretionaryHyphenContexts: number[] | null
  tabStopAdvance: number // Advance between tab stops for pre-wrap tab segments
  minimumTabAdvance: number // The least a tab advances: one nearer its stop takes the stop after
}

// What the line walkers lay out: a text's handle, or the handle of a rich-inline paragraph that
// isn't one text's handle (src/rich-inline.ts), which also holds what its segments have of their
// own. A text's handle has no `items`, so its type, PreparedLineBreakData, doesn't name it.
export type PreparedLineData = PreparedLineBreakData & { items?: ParagraphSegmentData }

// What a rich-inline paragraph's items give its segments, per segment: `segmentItems`, each
// segment's item, by which a line's fragments are cut (createLine in src/rich-inline.ts) and a
// walk tells whether two segments are one text frame's, and these lists, each null where no
// segment has a value of its own:
// - `hyphenWidths`, `tabStopAdvances`, `minimumTabAdvances`: the hyphen a soft hyphen paints, the
//   advance between a tab's stops and the least a tab advances, in the item's font, where two
//   items differ in one. A walk reads them, and the handle's own three, at a soft hyphen, under
//   soft-hyphen contexts and at a tab, so a paragraph whose text holds no soft hyphen and no
//   preserved tab has none, and its handle's own three are 0;
// - `hyphenRooms`: the room a line that ends at the break before the segment leaves for a hyphen,
//   where it returns there from a soft hyphen whose hyphen doesn't fit, in a paragraph with a soft
//   hyphen under a profile that leaves such room (getHyphenRooms in src/rich-inline.ts), with one
//   more entry for the break at the paragraph's end;
// - `itemEndHalts`: the line-end trim of a segment that ends its item with a closing mark Blink
//   halts at a line's end, or the trim its retry between graphemes gives one (overflowLineEndTrims),
//   which the mark keeps where the line goes on after it (prepareRichInline() in
//   src/rich-inline.ts);
// - `insideExtras`, `fillExtras`: the item's extraWidth where a line that starts inside the
//   segment pays it, or starts at it and fills it grapheme by grapheme, as a line that starts
//   with the whole segment pays lineStartExtras;
// - `openingEdges`: the width of a segment that is the start edge of a padded item's opening
//   (getOpeningFit in src/rich-inline.ts), which a line that takes it paints whole, whatever of
//   it the line fitted: an object's line-end trim is the part its line doesn't fit, and an edge
//   the engine fits none of is a preserved space, which takes no room in the run of preserved
//   spaces and tabs it is in;
// - `emptyObjectSpaces`, `emptyObjectReturns`: where the engine places an object of width 0
//   though it sticks out of the line, for each such object what a line reads of the text around
//   it (setEmptyObjectFacts in src/rich-inline.ts): the width of the white space that ends the
//   text before it as its last text frame's own, 0 where that text ends in other white space
//   and -1 where it ends in none, and 1 where a line with a break before the object goes back
//   to it, as what follows the object would stick out too.
export type ParagraphSegmentData = {
  segmentItems: Int32Array
  hyphenWidths: number[] | null
  tabStopAdvances: number[] | null
  minimumTabAdvances: number[] | null
  hyphenRooms: number[] | null
  itemEndHalts: number[] | null
  insideExtras: number[] | null
  fillExtras: number[] | null
  openingEdges: number[] | null
  emptyObjectSpaces: number[] | null
  emptyObjectReturns: Uint8Array | null
}

type InternalLineVisitor = (
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
) => void

function breaksAfterKind(kind: number): boolean {
  return (1 << kind & BREAK_AFTER_KINDS) !== 0
}

// A line ends at a chosen soft hyphen, and paints its hyphen, where the line's end
// cursor is the start of the segment after one. A soft hyphen that ends the text is
// consumed with its line and chosen by no wrap, so the cursor at the text's end
// paints none.
export function isDiscretionaryLineEnd(
  segmentFlags: Uint8Array,
  segmentCount: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): boolean {
  return endGraphemeIndex === 0 && endSegmentIndex > 0 && endSegmentIndex < segmentCount &&
    (segmentFlags[endSegmentIndex - 1]! & KIND_BITS) === SOFT_HYPHEN
}

// What a line's start leaves out, by a segment's flags: a collapsible space, a soft hyphen, and a
// soft hyphen that is a zero-width break (DROPPED). A zero-width space stays, at a chunk's start
// and after a wrap alike: every engine lays it out as text of no width, never as white space.
// Blink trails only U+0020 and U+0009 past a line's end and skips only a collapsible space at its
// start (IsBreakableSpace, line_breaker.cc:186-188; HandleTrailingSpaces, :2426-2534; HandleText,
// :1336-1353, Chromium 153); WebKit's white-space items are spaces, tabs and line feeds, and a
// text run of any length is content (InlineItemsBuilder.cpp:54-73; Line::Run::isContentful,
// InlineLine.h:129); Gecko trims and skips the characters of IsTrimmableSpace alone
// (nsTextFrame.cpp:904-942, 10935-10951). So the line a zero-width space starts is a line, a line
// tall, though nothing else is on it: where nothing follows it, where a hard break does, and
// where the word after it doesn't fit beside it and goes down whole, as from any line that has a
// break (walkPreparedComplexLines has where a line ends before one).
function consumesAtLineStart(flags: number): boolean {
  const kind = flags & KIND_BITS
  return kind === SPACE || kind === SOFT_HYPHEN || (flags & DROPPED) !== 0
}

// A tab's advance from `position` on the line: to the next stop, or to the one after where
// the next is under the minimum away. A tab on a stop is a whole stop from the next, so each
// tab of a run takes one. Stops no wider than 0, under a letter spacing of minus a space or
// less, leave a tab no advance: Gecko gives tabs no width there (GetSpacingInternal,
// nsTextFrame.cpp:4262-4264), and Blink's, negative by Font::TabWidth, is clamped to 0 where
// the tab's item is placed (ClampNegativeToZero, line_breaker.cc:1486, 1703). Gecko counts in
// whole app units (EngineProfile's tabsInAppUnits), so a tab exactly the minimum from its
// stop takes it, as many do: in Arial and Helvetica a space is half a `0`. Canvas sums come
// within float error of such a tie.
function getTabAdvance(position: number, tabStopAdvance: number, minimumAdvance: number, appUnits: boolean): number {
  if (appUnits) {
    const stop = Math.round(tabStopAdvance * 60)
    if (stop <= 0) return 0
    const x = Math.round(position * 60)
    return (Math.ceil((x + Math.round(minimumAdvance * 120) / 2) / stop) * stop - x) / 60
  }
  if (tabStopAdvance <= 0) return 0

  // How far the tab is past the stop before it, by a division and a floor, which counts back
  // from a negative position too. `%` gives the same, within float error, but on numbers that
  // aren't whole it is a call to the C library's fmod, which was nearly all a tab's arithmetic
  // cost (RESEARCH.md, JavaScript Engines).
  const pastStop = position - Math.floor(position / tabStopAdvance) * tabStopAdvance
  const advance = tabStopAdvance - pastStop
  return advance < minimumAdvance ? advance + tabStopAdvance : advance
}

// The advance of tab segment `index` of a rich-inline paragraph, which the line reaches at
// `lineWidth`: to the next stop of its item's font. Tab stops count from the line's start in
// every engine, never from an item's (Blink's line_breaker.cc:2963-2971, WebKit's pen position,
// Gecko's CalcTabWidths, nsTextFrame.cpp:4298-4378). A padded item's text starts after its start
// edge, half its extraWidth, all of which `lineWidth` counts, for a tab that starts the line too
// (lineStartExtras): the other half is the end edge, which follows the item's text on the line.
// Where the paragraph's items differ in letter spacing, a tab's width holds the gap after it, as
// every segment's holds its own (src/rich-inline.ts); else it is 0.
export function getItemTabAdvance(prepared: PreparedLineData, items: ParagraphSegmentData, index: number, lineWidth: number, appUnits: boolean): number {
  const stopAdvance = items.tabStopAdvances === null ? prepared.tabStopAdvance : items.tabStopAdvances[index]!
  const minimumAdvance = items.minimumTabAdvances === null ? prepared.minimumTabAdvance : items.minimumTabAdvances[index]!
  const endEdge = items.insideExtras === null ? 0 : items.insideExtras[index]! / 2
  return getTabAdvance(lineWidth - endEdge, stopAdvance, minimumAdvance, appUnits) + prepared.widths[index]!
}

function getTerminalLetterSpacing(
  prepared: PreparedLineData,
  openingEdges: number[] | null,
  hangingKinds: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): number {
  const { letterSpacing, segmentFlags } = prepared
  if (letterSpacing === 0) return 0

  if (endGraphemeIndex > 0) return (segmentFlags[endSegmentIndex]! & SPACED) !== 0 ? letterSpacing : 0

  const segmentCount = prepared.widths.length
  if (isDiscretionaryLineEnd(segmentFlags, segmentCount, endSegmentIndex, endGraphemeIndex)) return 0
  // A run of preserved spaces and tabs that hangs where the line wraps already
  // charged the gap after the glyph before it. Gecko doesn't hang tabs.
  if (endSegmentIndex > startSegmentIndex && endSegmentIndex < segmentCount && (segmentFlags[endSegmentIndex]! & KIND_BITS) !== HARD_BREAK &&
    (1 << (segmentFlags[endSegmentIndex - 1]! & KIND_BITS) & hangingKinds) !== 0) return 0

  for (let i = endSegmentIndex - 1; i >= startSegmentIndex; i--) {
    const flags = segmentFlags[i]!
    const kind = flags & KIND_BITS
    // Segments that take no letter spacing, such as zero-width glue or marks
    // shaped on the grapheme before them, leave that grapheme's gap last. A tab
    // that takes none follows that gap, which its stop counts from. An object
    // leaves none after itself, nor does the edge of a padded opening.
    if (kind === SPACE || (kind !== CONTROL && kind !== TAB && (flags & SPACED) === 0 && kind !== OBJECT && (openingEdges === null || openingEdges[i]! === 0))) continue

    if (i === startSegmentIndex && startGraphemeIndex > 0) return letterSpacing

    return (flags & SPACED) !== 0 ? letterSpacing : 0
  }

  return 0
}

// The width a paragraph is laid out at: `NaN`, which a typed caller can pass, is unbounded.
// Every comparison fails at `NaN`, and the line loops ask some whether a segment fits and
// others whether it overflows, so the line APIs called once for a paragraph pass their width
// through here and the loops stay written for numbers. The streams, called once for each
// line, take their width as given (RESEARCH.md, Decisions Log, 2026-10-02).
export function normalizeMaxWidth(maxWidth: number): number {
  return maxWidth <= Infinity ? maxWidth : Infinity
}

// Mutates `cursor` to the next renderable line start. False when no line remains.
// A chunk runs to a hard break or the end of the text, and the hard break ends a
// line however little the chunk holds: a chunk holding only its hard break, or only
// source a line start consumes before it, such as soft hyphens, is an empty line,
// which starts at its hard break. The rest of a chunk after a line that wrapped
// inside it is no line of its own when a line start consumes all of it.
export function normalizePreparedLineStart(
  prepared: PreparedLineData,
  cursor: LayoutCursor,
): boolean {
  const { segmentFlags } = prepared
  const segmentCount = prepared.widths.length
  let segmentIndex = cursor.segmentIndex
  if (segmentIndex >= segmentCount) return false
  if (cursor.graphemeIndex > 0) return true

  let atChunkStart = segmentIndex === 0 || (segmentFlags[segmentIndex - 1]! & KIND_BITS) === HARD_BREAK
  while (true) {
    const flags = segmentFlags[segmentIndex]!
    if ((flags & KIND_BITS) === HARD_BREAK) {
      if (atChunkStart) {
        cursor.segmentIndex = segmentIndex
        cursor.graphemeIndex = 0
        return true
      }
      if (++segmentIndex >= segmentCount) return false
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      atChunkStart = true
    } else if (consumesAtLineStart(flags)) {
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
  prepared: PreparedLineData,
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
  const segmentCount = prepared.widths.length
  while (true) {
    let startSegmentIndex = cursor.segmentIndex
    while (startSegmentIndex < segmentCount && consumesAtLineStart(segmentFlags[startSegmentIndex]!)) {
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
// a break, so an overflowing space ends its line, which it hangs on, and any other
// segment starts the next one, a zero-width space too (stepPreparedSimpleLineGeometry).
// The full walker costs three to five times as much per segment, so one walker for
// all text was rejected (RESEARCH.md, Decisions Log, 2026-09-24).
export function countPreparedLines(prepared: PreparedLineData, maxWidth: number): number {
  // The loop takes no overflow trims, which the stepper takes for a line's first segment.
  if (!prepared.simpleLineWalkFastPath || prepared.overflowLineEndTrims !== null) {
    return prepared.simpleLineCountFastPath ? countSteppedLines(prepared, maxWidth) : walkPreparedLinesRaw(prepared, maxWidth)
  }
  const { widths, segmentFlags, breakableFitAdvances, breakableLineStartExtras, lineStartExtras, lineEndTrims } = prepared
  const fitLimit = Math.max(0, maxWidth) + getEngineProfile().lineFitEpsilon
  const segmentCount = widths.length
  let count = 0
  // Every line starts at 0 and adds its content's widths. Firefox runs this loop
  // about 1.6 times as long when a line's width is set from a segment's width
  // instead (RESEARCH.md, Keeping Work Bounded).
  let lineW = 0
  let hasContent = false

  for (let i = 0; i < segmentCount; i++) {
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
    }
    // A space starts no line: one that overflows hangs on the line it ends.
    if ((segmentFlags[i]! & KIND_BITS) === SPACE) continue

    const startW = lineStartExtras === null ? w : w + lineStartExtras[i]!
    const advances = breakableFitAdvances[i] as number[] | null
    if (startW - endTrim <= fitLimit || advances === null) {
      lineW += startW
      hasContent = true
      continue
    }
    // An overflowing breakable segment fills lines grapheme by grapheme.
    const startExtras = breakableLineStartExtras?.[i] ?? null
    let g = 0
    while (g < advances.length) {
      if (startExtras !== null) lineW += startExtras[g]!
      lineW += advances[g++]!
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
function countSteppedLines(prepared: PreparedLineData, maxWidth: number): number {
  const { segmentFlags } = prepared
  const segmentCount = prepared.widths.length
  const cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let count = 0
  while (normalizePreparedLineStart(prepared, cursor)) {
    const startSegmentIndex = cursor.segmentIndex
    const startGraphemeIndex = cursor.graphemeIndex
    stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
    if (cursor.graphemeIndex === 0 && cursor.segmentIndex < segmentCount && (segmentFlags[cursor.segmentIndex]! & UNBROKEN) !== 0) {
      cursor.segmentIndex = startSegmentIndex
      cursor.graphemeIndex = startGraphemeIndex
      walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true)
    }
    count++
  }
  return count
}

// Whether the run of preserved spaces and tabs that hang, which starts at segment `start` right
// after an object on its line, an atomic rich-inline item or a box (OBJECT), stays there however
// far the line overflows, as no break comes before it in the text (UAX #14 LB7). Blink takes it
// as trailing items after the break after an atomic inline (HandleTrailingSpaces,
// line_breaker.cc:2426-2534), trailing on into the next item where an item's spaces reach its end
// (:2518-2533); WebKit gives a soft wrap opportunity after each white-space item
// (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:408-413) and keeps each as content that hangs
// (InlineContentBreaker.cpp:181-182); and Gecko lets an empty frame past the line's end
// (CanPlaceFrame, nsLineLayout.cpp:1217-1270). After text that overflows, the engine's retry
// between graphemes breaks before the white space instead. But Gecko breaks only after a run of
// spaces and tabs (nsLineBreaker.cpp:323, :586) and doesn't hang a tab, so where the white space
// runs into a tab, Firefox moves all of it to the next line with the tab. The walker asks once
// per run, so a long run costs one pass.
function staysAfterObject(segmentFlags: Uint8Array, segmentCount: number, start: number, hangingKinds: number): boolean {
  let after = start + 1
  while (after < segmentCount && (1 << (segmentFlags[after]! & KIND_BITS) & hangingKinds) !== 0) after++
  return after === segmentCount || (segmentFlags[after]! & KIND_BITS) !== TAB
}

// Whether a line that would end at the break before `breakSegmentIndex`, painting
// `breakWidth`, returns to an earlier opportunity: where it ends at a selected
// discretionary hyphen that doesn't fit. A return needs an overflow that isolated
// widths can show: the soft hyphens on the line may measure narrower joined than apart
// by less than the overflow. Those are the soft hyphens the line passes, whose text the
// engine shapes whole, and with `endKeepsJoin` the one the line ends at too
// (EngineProfile, unfitHyphenRetreat).
function returnsFromUnfitHyphen(
  prepared: PreparedLineData,
  lineStartSegmentIndex: number,
  breakSegmentIndex: number,
  breakWidth: number,
  fitLimit: number,
  endKeepsJoin: boolean,
): boolean {
  const { discretionaryHyphenContexts, segmentFlags } = prepared
  const softHyphenIndex = breakSegmentIndex - 1
  if (softHyphenIndex < lineStartSegmentIndex || (segmentFlags[softHyphenIndex]! & KIND_BITS) !== SOFT_HYPHEN || breakWidth <= fitLimit) return false
  const overflow = breakWidth - fitLimit
  let narrowing = 0
  const last = endKeepsJoin ? softHyphenIndex : softHyphenIndex - 1
  if (discretionaryHyphenContexts !== null) for (let i = lineStartSegmentIndex; i <= last; i++) narrowing += discretionaryHyphenContexts[i]!
  return narrowing < overflow
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
  prepared: PreparedLineData,
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
    discretionaryHyphenWidth,
    letterSpacing,
    lineStartExtras,
    lineEndTrims,
    overflowLineEndTrims,
    tabStopAdvance,
    minimumTabAdvance,
  } = prepared
  const segmentCount = widths.length
  const items = prepared.items
  const hyphenWidths = items === undefined ? null : items.hyphenWidths
  const hyphenRooms = items === undefined ? null : items.hyphenRooms
  const itemEndHalts = items === undefined ? null : items.itemEndHalts
  const insideExtras = items === undefined ? null : items.insideExtras
  const fillExtras = items === undefined ? null : items.fillExtras
  const openingEdges = items === undefined ? null : items.openingEdges
  const emptyObjectSpaces = items === undefined ? null : items.emptyObjectSpaces
  const emptyObjectReturns = items === undefined ? null : items.emptyObjectReturns
  const engineProfile = getEngineProfile()
  // Preserved spaces and tabs at the end of a line hang past it (CSS Text 3
  // §4.1.2), so they take no room when fitting and don't size the line (§8.2).
  // Gecko doesn't hang tabs.
  const hangingKinds = 1 << PRESERVED_SPACE | (engineProfile.hangTabs ? 1 << TAB : 0)
  // In Gecko a text frame's width leaves out its trailing spaces that overflow the line and
  // keeps those that fit, whatever follows the frame (EngineProfile, hangsSpacesPerTextFrame),
  // so in a rich-inline paragraph the run of preserved spaces that hang goes on, with what
  // overflows, past a segment that takes no room: an object of width 0, a soft hyphen, the
  // zero-width break the Gecko scan makes of a soft hyphen after white space (DROPPED), and a
  // zero-width space that starts an item, where the content before the run fits. The frame
  // after the spaces' own then starts at the line's end, where a zero-width space fits; where
  // that content is past the line's end, as a box wider than the line, the zero-width space
  // starts the next line, as a break comes before it after white space
  // (nsLineBreaker.cpp:321-330), and so does one right after the spaces in their own item, which
  // ends their run: they count in full once it follows them in their frame (BreakAndMeasureText,
  // gfxTextRun.cpp:1152-1160).
  const hangGoesOnPastEmpty = items !== undefined && engineProfile.hangsSpacesPerTextFrame
  const testsHyphenBeforeAtomic = engineProfile.testsHyphenBeforeAtomic
  const zeroWidthGlueTakesLine = engineProfile.zeroWidthGlueTakesLine
  const tabsInAppUnits = engineProfile.tabsInAppUnits
  const paddedOpeningFit = engineProfile.paddedOpeningFit
  const hardBreakItemRetreat = engineProfile.hardBreakItemRetreat
  // A negative width lays out as 0, as in the simple stepper.
  const availableWidth = Math.max(0, maxWidth)
  const fitLimit = availableWidth + engineProfile.lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the text has a soft hyphen.
  const retreatsFromUnfitHyphen = prepared.discretionaryHyphenContexts !== null
  // Blink's retry leaves room for the hyphen at every earlier opportunity. Gecko and
  // WebKit return to any opportunity whose line fits. A rich-inline paragraph has that room per
  // break (ParagraphSegmentData, hyphenRooms).
  const reservesHyphenWidth = engineProfile.unfitHyphenRetreat === 'reduced-width'
  const reservedHyphenWidth = reservesHyphenWidth ? discretionaryHyphenWidth : 0
  // WebKit's return stops at the line's first opportunity, whatever its hyphen overflows:
  // the soft hyphen the line reaches before any of its opportunities has fit, since one
  // without a hyphen fits where the text before it did.
  const keepsFirstBreak = retreatsFromUnfitHyphen && engineProfile.unfitHyphenRetreat === 'full-width-or-first'
  // Gecko's line keeps what the letters on the two sides of the soft hyphen it ends at
  // measure narrower joined. Blink shapes the line's end again, without it.
  const hyphenEndKeepsJoin = engineProfile.unfitHyphenRetreat === 'full-width'

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
    // The opportunity the line returns to when a selected discretionary hyphen does
    // not fit, with that line's painted width: the latest whose line leaves room for
    // the hyphen, which Blink's retry against the width minus the hyphen finds, or
    // in Gecko and WebKit the latest that fits at the full width (reservedHyphenWidth).
    // Under keepsFirstBreak it is the line's first soft hyphen, whatever its hyphen
    // overflows, until a later opportunity fits.
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
      // A line that starts at a hard break is an empty chunk's (normalizePreparedLineStart),
      // as wide as what a line pays where it starts there: inside a padded rich-inline item,
      // its extraWidth.
      cursor.segmentIndex = lineStartSegmentIndex + 1
      cursor.graphemeIndex = 0
      lineWidth = lineStartExtras === null ? 0 : lineStartExtras[lineStartSegmentIndex]!
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
          // The gap before a segment belongs to the grapheme before it. A control or
          // a tab that takes no letter spacing still follows that gap but adds none
          // after itself, and so does an object, which is no character (CSS Text 3,
          // letter-spacing), as is the edge of a padded opening that hangs as white
          // space; other segments that take none leave it as it was.
          const gap = letterSpacing !== 0 && hasContent && !zeroWidthPrefix && !afterUnspacedControl ? letterSpacing : 0
          let leadingSpacing = 0
          if (letterSpacing !== 0 && (spaced || kind === CONTROL || kind === TAB || kind === OBJECT || (openingEdges !== null && openingEdges[i]! !== 0))) {
            leadingSpacing = gap
            afterUnspacedControl = !spaced
          }
          if (kind !== ZERO_WIDTH_BREAK && kind !== ZERO_WIDTH_GLUE) zeroWidthPrefix = false
          const w = kind !== TAB ? widths[i]!
            : items === undefined ? getTabAdvance(lineW + leadingSpacing, tabStopAdvance, minimumTabAdvance, tabsInAppUnits)
            : getItemTabAdvance(prepared, items, i, hasContent ? lineW + leadingSpacing : lineStartExtras === null ? 0 : lineStartExtras[i]!, tabsInAppUnits)
          const advance = leadingSpacing + w
          const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!

          if (kind === SOFT_HYPHEN && startGraphemeIndex === 0) {
            if (hasContent) {
              // The hyphen a line that ends here paints, and whether it has to fit. What only a
              // rich-inline paragraph has is under one test, which is all a text's soft hyphen
              // pays for it (RESEARCH.md, Keeping Work Bounded).
              let hyphenWidth = discretionaryHyphenWidth
              let fitsHyphen = true
              if (items !== undefined) {
                // A break comes after an object, so a line returns to it from a soft hyphen right
                // after the object whose hyphen doesn't fit: Chrome, Firefox and Safari break
                // there with the hyphen where it fits, and else after the object.
                if (retreatsFromUnfitHyphen && i > lineStartSegmentIndex && (segmentFlags[i - 1]! & KIND_BITS) === OBJECT) {
                  fitBreakSegmentIndex = i
                  fitBreakPaintWidth = lineW
                }
                if (hangGoesOnPastEmpty && hangEndSegmentIndex === i) {
                  hangEndSegmentIndex = i + 1
                  hangStartWidth = Math.max(hangStartWidth, Math.min(lineW, availableWidth))
                }
                if (hyphenWidths !== null) hyphenWidth = hyphenWidths[i]!
                // A soft hyphen's fit includes its own hyphen, but for one right before an atomic
                // item where the engine never tests that hyphen (EngineProfile).
                fitsHyphen = testsHyphenBeforeAtomic || i + 1 === segmentCount || (segmentFlags[i + 1]! & KIND_BITS) !== OBJECT || (openingEdges !== null && openingEdges[i + 1]! !== 0)
              }
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              if (i + 1 < segmentCount && (segmentFlags[i + 1]! & KIND_BITS) !== HARD_BREAK) {
                pendingBreakSegmentIndex = i + 1
                pendingBreakWidth = lineW + hyphenWidth
                if (retreatsFromUnfitHyphen && ((fitsHyphen ? pendingBreakWidth : lineW) <= fitLimit || (keepsFirstBreak && fitBreakSegmentIndex < 0))) {
                  fitBreakSegmentIndex = pendingBreakSegmentIndex
                  fitBreakPaintWidth = pendingBreakWidth
                }
              }
            }
            continue
          }

          // A line that ends after a whole segment charges its advance and the letter
          // spacing gap after it. Spaces hang, and zero-width text owns no gap, though NEL
          // does. Text that takes no letter spacing, such as zero-width glue or a zero-width
          // space, fits like the line that still ends with the gap before it.
          let fitAdvance = 0
          if (letterSpacing !== 0 && !spaced && (!breakAfter || (kind === ZERO_WIDTH_BREAK && (flags & DROPPED) === 0)) && kind !== CONTROL) {
            fitAdvance = gap + w
          } else if (breakAfter ? kind === TAB : w !== 0 || kind === CONTROL) {
            const contribution = w + (spaced ? letterSpacing : 0)
            if (contribution !== 0) fitAdvance = leadingSpacing + contribution
          }
          // Two statements, for how the engines compile them: with them Safari 27 laid pre-wrap text
          // out 4.3% faster than with the same tests as one `||` and Chrome 154 letter-spaced CJK
          // text 2.8%, and Firefox 156 read within 1.5% either way (RESEARCH.md, Keeping Work
          // Bounded, Work Done Only Where A Rule Applies; Decisions Log, 2026-10-08).
          let hangs = (1 << kind & hangingKinds) !== 0
          if (hangGoesOnPastEmpty && kind === ZERO_WIDTH_BREAK && hangEndSegmentIndex === i &&
            ((flags & DROPPED) !== 0 || (hangStartWidth - hangEdgesWidth <= fitLimit &&
              !((segmentFlags[i - 1]! & KIND_BITS) === PRESERVED_SPACE && items.segmentItems[i] === items.segmentItems[i - 1])))) hangs = true
          if (hangs) {
            if (hangEndSegmentIndex !== i) {
              hangStartWidth = lineW - lineEndTrimmed + leadingSpacing
              hangStays = false
              if (items !== undefined && i > lineStartSegmentIndex && (segmentFlags[i - 1]! & KIND_BITS) === OBJECT) {
                hangStays = staysAfterObject(segmentFlags, segmentCount, i, hangingKinds)
                // A run that goes down with its tab leaves from the break after the object.
                if (!hangStays) {
                  pendingBreakSegmentIndex = i
                  pendingBreakWidth = lineW - lineEndTrimmed
                }
              }
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
              // Preserved spaces hang whole, with the advances rich inline gives them too
              // (hardBreakItemRetreat).
              if (fitAdvance + startExtra - startTrim > fitLimit && breakableFitAdvances[i] !== null && !hangs) {
                fillStart = 0
              } else {
                hasContent = true
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                lineW = w + startExtra
                // What the line pays at its start stays where the white space it starts with hangs.
                if (hangs) hangStartWidth += startExtra
                lineEndTrimmed = fitAdvance + startExtra > fitLimit && kind !== OBJECT ? startTrim : 0
                // A mark halted at its item's end stays halted where the line goes on (below).
                if (itemEndHalts !== null && lineEndTrimmed !== 0 && itemEndHalts[i]! !== 0) {
                  lineW -= lineEndTrimmed
                  lineEndTrimmed = 0
                }
                // The break segment hangs with the gap before it, a run of preserved
                // spaces and tabs hangs whole, and a tab that doesn't hang counts whole.
                if (breakAfter && (i + 1 === segmentCount || (segmentFlags[i + 1]! & UNBROKEN) === 0)) {
                  pendingBreakSegmentIndex = i + 1
                  pendingBreakWidth = hangs ? hangStartWidth : kind === TAB ? lineW : lineW - advance
                }
                if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + (hyphenRooms === null || pendingBreakSegmentIndex < 0 ? reservedHyphenWidth : hyphenRooms[pendingBreakSegmentIndex]!) <= fitLimit) {
                  fitBreakSegmentIndex = pendingBreakSegmentIndex
                  fitBreakPaintWidth = pendingBreakWidth
                }
                continue
              }
            }
          } else {
            // A run of preserved spaces and tabs fits where the text before it fits, and after an
            // object however far the line overflows (staysAfterObject).
            const newFitW = hangs ? hangStartWidth - hangEdgesWidth : lineW + fitAdvance
            // Whether the segment ends the line. What only a rich-inline paragraph has is under one
            // test, as at a soft hyphen (above).
            let overflows = newFitW - endTrim > fitLimit
            if (items !== undefined) {
              // Blink and WebKit move an object of width 0 that doesn't fit to the next line as any
              // other. Gecko places an empty frame though it sticks out of the line (CanPlaceFrame,
              // nsLineLayout.cpp:1264-1269; EngineProfile, emptyAtomicAlwaysFits). It sticks out
              // where the content before it ends past the line's end, with the collapsed space
              // before the object, which a line end trims no more once the object follows it
              // (nsLineLayout.cpp:1017-1020), and without the preserved spaces that hang, which
              // end at the line's end (nsTextFrame.cpp:11216-11229). The line then ends before it
              // where the text before it ends in white space and its last frame ends past the
              // line's end without that frame's own spaces, as the line breaks after the white
              // space (nsTextFrame.cpp:11443-11456), and where a break comes before the object
              // and what follows it sends the line back there (ParagraphSegmentData).
              let placesEmptyObject = false
              if (emptyObjectSpaces !== null && kind === OBJECT && w === 0 && newFitW > fitLimit) {
                const contentW = hangEndSegmentIndex === i ? hangStartWidth : lineW
                const space = emptyObjectSpaces[i]!
                placesEmptyObject = contentW <= fitLimit || !((space >= 0 && contentW - space > fitLimit) || emptyObjectReturns![i] === 1)
              }
              // No engine lets content make a line narrower (findWholeLine in src/rich-inline.ts),
              // so a segment of less than no advance, as a letter under a letter spacing more
              // negative than it is wide, doesn't bring a line that overflows back. A zero-width
              // space has no advance: what it fits with is the gap of the letter before it.
              const narrowsOverflow = fitAdvance < 0 && kind !== ZERO_WIDTH_BREAK && lineW - lineEndTrimmed > fitLimit
              overflows = (overflows || narrowsOverflow) && !(hangs && hangStays) && !placesEmptyObject
              if (hangGoesOnPastEmpty && !overflows && hangEndSegmentIndex === i && kind === OBJECT && w === 0) {
                hangEndSegmentIndex = i + 1
                hangStartWidth = Math.max(hangStartWidth, Math.min(lineW + advance, availableWidth))
              }
            }
            if (overflows) {
              // A break segment hangs with the gap before it, after the content before
              // it, which fits without its line-end trim. A collapsible space hangs even
              // after overflowing content that started the line, as the simple stepper
              // does, and so does the zero-width break Firefox drops (DROPPED), there and
              // after the start edge of its item's opening; a preserved space there starts
              // the next line. A tab that doesn't hang goes to the next line, as text does.
              //
              // A zero-width space is content of no width, so it stays where the content
              // before it fits, with the white space between them, which then ends no line,
              // and with the gap after its last letter. Else the line ends before it and
              // it starts the next (consumesAtLineStart). Blink sends text that follows
              // content past the line's end to HandleOverflow, which ends the line at a
              // break before that text (HandleText, line_breaker.cc:1355-1372; :4079-4305),
              // and a line that trails spaces ends at the first character that is neither
              // U+0020 nor U+0009 (HandleTrailingSpaces, :2447-2456, 2518-2523). WebKit fits
              // it against what is left of the line, which isn't clamped at 0 (availableWidth,
              // InlineLineBuilder.cpp:1172-1183, 1466), and keeps overflowing content only
              // where it trims, hangs or is span tags alone (processOverflowingContent,
              // InlineContentBreaker.cpp:160-199, 275-295). Gecko ends a line at its last
              // break whose content fits, else at its first (BreakAndMeasureText,
              // gfxTextRun.cpp:1091-1109), and a break comes before a zero-width space after
              // white space (nsLineBreaker.cpp:321-330) and, by overflow-wrap, before any
              // cluster on a line with no break yet (gfxTextRun.cpp:1068-1074). The break
              // before it is the one the engine has there: after the white space, after an
              // object, or, after a grapheme wider than its line, the one between graphemes
              // that a line with no other break takes. A line-end trim doesn't keep it: a
              // mark is halted and a U+3000 run hangs where the line ends after them, and
              // with a zero-width space after them on the line they count whole (`字」` and
              // one in 40px Hiragino Sans at 70px are two lines in Chrome 155, the second
              // empty). Two places keep it past the line's end: after the start edge
              // of its own item's opening, which the line took by the part it fits, as the
              // engines keep a span's start with its first text; and right after an object
              // in Gecko (EngineProfile, zeroWidthSpaceStaysAfterAtomic). The zero-width
              // spaces after one that stays stay with it, as no break comes between two
              // (UAX #14 LB7). Premise: widths measured apart. Blink kerns the letters on
              // the two sides of a zero-width space, so a letter wider than its line by
              // less than that kerning fits there, and Chrome keeps the zero-width space
              // on its line (ENGINE_FOLLOWUPS.md, Line edges).
              //
              // Only a break segment can stay, so all of this is under that one test, and
              // the profile's field is read where a zero-width space overflows right after
              // an object: a line that ends at a segment that is no break pays nothing for
              // the rule, and a walk reads nothing for it at its start (RESEARCH.md, Keeping
              // Work Bounded, Work Done Only Where A Rule Applies).
              const contentW = lineW - lineEndTrimmed
              if (breakAfter) {
                const afterObject = kind === ZERO_WIDTH_BREAK && (segmentFlags[i - 1]! & KIND_BITS) === OBJECT
                const stays = kind === ZERO_WIDTH_BREAK && (flags & DROPPED) === 0
                  ? afterObject && (engineProfile.zeroWidthSpaceStaysAfterAtomic || (openingEdges !== null && openingEdges[i - 1]! !== 0))
                  : (hangs || kind !== TAB) && (contentW <= fitLimit || (pendingBreakSegmentIndex < 0 && (kind === SPACE || kind === ZERO_WIDTH_BREAK)) || afterObject)
                if (stays) {
                  endWidth = hangs ? hangStartWidth : contentW
                  lineW += advance
                  endSegmentIndex = i + 1
                  if (kind === ZERO_WIDTH_BREAK) while (endSegmentIndex < segmentCount && (segmentFlags[endSegmentIndex]! & KIND_BITS) === ZERO_WIDTH_BREAK) endSegmentIndex++
                  endGraphemeIndex = 0
                  break decided
                }
              }
              // Gecko's line returns from a tab that doesn't fit to its latest break (below), as
              // BreakAndMeasureText keeps the last break whose line fits (gfxTextRun.cpp:1086-1101).
              // Without one it wraps before the tab, as break-word lets it before any cluster
              // (:1069-1072), and the spaces before the tab hang.
              if (kind === TAB && !hangs && pendingBreakSegmentIndex < 0) {
                endSegmentIndex = i
                endGraphemeIndex = 0
                endWidth = hangEndSegmentIndex === i && i > lineStartSegmentIndex ? hangStartWidth : contentW
                break decided
              }

              const unbroken = (flags & UNBROKEN) !== 0
              // An object with no break before it is the start edge of a padded rich-inline
              // item's opening (src/rich-inline.ts). Blink's line trails once the preserved
              // spaces it ends with overflow: it takes the white space after them, the tags of
              // spans that open among it and a forced break with no fit (HandleTrailingSpaces,
              // line_breaker.cc:2426-2534), so an edge right after such a run joins it, taking
              // no room. The spaces overflow where the content before them fits with the start
              // edges of the spans that open among them, half of each such edge (getOpeningFit),
              // and the spaces after those edges don't; an overflow before the spaces or at a
              // span's end edge returns instead. WebKit fits the content it places without the
              // white space that hangs before it (hangingContentWidth,
              // InlineContentBreaker.cpp:183-186), so there the edge joins the run where it fits
              // after the content before the run.
              if (kind === OBJECT && unbroken && hangEndSegmentIndex === i && (paddedOpeningFit === 'start'
                ? hangStartWidth - hangEdgesWidth / 2 <= fitLimit && lineW - hangEdgesWidth / 2 > fitLimit
                : paddedOpeningFit === 'placed' && hangStartWidth - hangEdgesWidth + w - endTrim <= fitLimit)) {
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
              // Blink's retry halts the segment where that lets it fit, and the line ends after it,
              // but where the segment ends its item, whose mark stays halted while the line goes on.
              if (overflowLineEndTrims !== null && newFitW - overflowLineEndTrims[i]! <= fitLimit) {
                lineW += advance
                lineEndSegmentIndex = i + 1
                lineEndGraphemeIndex = 0
                lineEndTrimmed = overflowLineEndTrims[i]!
                if (itemEndHalts !== null && itemEndHalts[i]! !== 0) {
                  lineW -= lineEndTrimmed
                  lineEndTrimmed = 0
                }
                continue
              }
              // Where the line of such an edge has no break to return to, the line ends before
              // it, but before a hard break only in Blink, whose retry breaks between any two
              // graphemes: WebKit and Gecko end the line before the last grapheme of the text
              // before the edge, and keep the edge on a line that grapheme starts (EngineProfile,
              // hardBreakItemRetreat). Of preserved spaces there, whose advances rich inline
              // gives, Gecko moves the last and WebKit those that don't fit: all of them where a
              // negative letter spacing leaves a space no advance, so that giving one up gives no
              // overflow back. The ones the line keeps hang.
              if (kind === OBJECT && hardBreakItemRetreat !== 'item' && i + 1 < segmentCount && (segmentFlags[i + 1]! & KIND_BITS) === HARD_BREAK) {
                const beforeFlags = segmentFlags[i - 1]!
                const beforeKind = beforeFlags & KIND_BITS
                const spaceAdvances = beforeKind === PRESERVED_SPACE ? breakableFitAdvances[i - 1]! : null
                if (spaceAdvances !== null) {
                  const count = spaceAdvances.length
                  const spaceAdvance = spaceAdvances[0]!
                  const moved = hardBreakItemRetreat !== 'fit' || lineW <= fitLimit ? 1 : spaceAdvance > 0 ? Math.min(count, Math.ceil((lineW - fitLimit) / spaceAdvance)) : count
                  // The start edge of the spaces' own item is no content to leave on the line.
                  const contentStart = openingEdges !== null && openingEdges[lineStartSegmentIndex]! !== 0 ? lineStartSegmentIndex + 1 : lineStartSegmentIndex
                  if (i - 1 > contentStart || count - moved > lineStartGraphemeIndex) {
                    endSegmentIndex = i - 1
                    endGraphemeIndex = count - moved
                    endWidth = hangStartWidth
                    break decided
                  }
                }
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
                if (spaceAdvances !== null || (beforeKind !== PRESERVED_SPACE && beforeKind !== TAB)) {
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
              // A break the scan gives before text is one the line can return to.
              if ((flags & RETURNABLE) !== 0 && !breakAfter && pendingBreakSegmentIndex !== i) {
                pendingBreakSegmentIndex = i
                pendingBreakWidth = lineW
              }
              // A break the scan gives between two text segments, as after `-` or between
              // ideographs, is an opportunity the line returns to like any other. The line up
              // to it fit when its last segment was admitted, with the letter-spacing gap after
              // it that lineW leaves out, so only Blink's room for the hyphen is tested here.
              if (retreatsFromUnfitHyphen && !breakAfter && (flags & UNBROKEN) === 0 && i > lineStartSegmentIndex &&
                !breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS) && (!reservesHyphenWidth || lineW + (hyphenRooms === null ? discretionaryHyphenWidth : hyphenRooms[i]!) <= fitLimit)) {
                fitBreakSegmentIndex = i
                fitBreakPaintWidth = lineW
              }
              lineEndSegmentIndex = i + 1
              lineEndGraphemeIndex = 0
              if (itemEndHalts !== null && newFitW > fitLimit && itemEndHalts[i]! !== 0) {
                // A closing mark that ends its item and fits the line only halted stays halted where
                // the line goes on: the line takes it at its halted width, and what follows fits
                // after that (ParagraphSegmentData, itemEndHalts).
                lineW += advance - endTrim
                lineEndTrimmed = 0
              } else {
                lineW += advance
                // A segment that takes no room at the line end, as a space, leaves the glyph
                // before it last on the line, with its trim.
                if (fitAdvance !== 0 && !hangs) lineEndTrimmed = newFitW > fitLimit && kind !== OBJECT ? endTrim : 0
              }
              if (breakAfter && (i + 1 === segmentCount || (segmentFlags[i + 1]! & UNBROKEN) === 0)) {
                pendingBreakSegmentIndex = i + 1
                pendingBreakWidth = hangs ? hangStartWidth : kind === TAB ? lineW : lineW - advance - lineEndTrimmed
              }
              if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + (hyphenRooms === null || pendingBreakSegmentIndex < 0 ? reservedHyphenWidth : hyphenRooms[pendingBreakSegmentIndex]!) <= fitLimit) {
                fitBreakSegmentIndex = pendingBreakSegmentIndex
                fitBreakPaintWidth = pendingBreakWidth
              }
              continue
            }
          }

          // A grapheme fits with the letter spacing after it.
          const fitAdvances = breakableFitAdvances[i]!
          const fitCount = fitAdvances.length
          for (let g = fillStart; g < fitCount; g++) {
            const baseGw = fitAdvances[g]!
            if (!hasContent) {
              hasContent = true
              lineEndSegmentIndex = i
              lineEndGraphemeIndex = g + 1
              const startExtras = prepared.breakableLineStartExtras?.[i] ?? null
              lineW = startExtras === null ? baseGw : baseGw + startExtras[g]!
              // A line that starts inside a padded rich-inline item, or fills its first
              // segment, pays the item's extraWidth (ParagraphSegmentData).
              if (g > 0 ? insideExtras !== null : fillExtras !== null) lineW += g > 0 ? insideExtras![i]! : fillExtras![i]!
            } else {
              const candidatePaintWidth = lineW + (baseGw + (g > fillStart ? letterSpacing : fillSpacing))
              if (candidatePaintWidth + letterSpacing > fitLimit) break decided
              lineW = candidatePaintWidth
              lineEndSegmentIndex = i
              lineEndGraphemeIndex = g + 1
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
          returnsFromUnfitHyphen(prepared, lineStartSegmentIndex, lineEndSegmentIndex, pendingBreakWidth, fitLimit, hyphenEndKeepsJoin)
        ) {
          endSegmentIndex = fitBreakSegmentIndex
          endGraphemeIndex = 0
          endWidth = fitBreakPaintWidth
        } else if (endSegmentIndex < 0) {
          // A line that ends at its pending break paints the pending width, and one that wraps
          // right after a run of preserved spaces and tabs hangs it, with no break there too.
          endSegmentIndex = lineEndSegmentIndex
          endGraphemeIndex = lineEndGraphemeIndex
          endWidth = pendingBreakSegmentIndex === lineEndSegmentIndex && lineEndGraphemeIndex === 0 ? pendingBreakWidth
            : items !== undefined && hangEndSegmentIndex === lineEndSegmentIndex && lineEndGraphemeIndex === 0 ? hangStartWidth
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
          getTerminalLetterSpacing(prepared, openingEdges, hangingKinds, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex)
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
  prepared: PreparedLineData,
  cursor: LayoutCursor,
  maxWidth: number,
): number {
  const { widths, segmentFlags, breakableFitAdvances, lineStartExtras, lineEndTrims, overflowLineEndTrims } = prepared
  const engineProfile = getEngineProfile()
  // A negative width lays out as 0, as in the complex walker.
  const fitLimit = Math.max(0, maxWidth) + engineProfile.lineFitEpsilon
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
  let lineW: number
  // The line-end trim of the last segment, where only that trim let it fit. Every
  // later segment overflows, so the line ends after it and paints that much less.
  let endTrimmed = 0
  if (cursor.graphemeIndex > 0 || (startW - startTrim > fitLimit && startAdvances !== null)) {
    const fitAdvances = startAdvances!
    const startExtras = prepared.breakableLineStartExtras?.[start] ?? null
    let g = cursor.graphemeIndex + 1
    lineW = startExtras === null ? fitAdvances[g - 1]! : fitAdvances[g - 1]! + startExtras[g - 1]!
    // A line that starts inside a padded rich-inline item, or fills its first segment, pays
    // the item's extraWidth (ParagraphSegmentData).
    const items = prepared.items
    if (items !== undefined && (g > 1 ? items.insideExtras !== null : items.fillExtras !== null)) lineW += g > 1 ? items.insideExtras![start]! : items.fillExtras![start]!
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
  // segments until one overflows. An overflowing space hangs and ends the line. A
  // zero-width space, which is content of no width, overflows where the content
  // before it does, and then starts the next line, but right after an object where
  // the engine keeps it there (walkPreparedComplexLines has the rule). Before
  // other text, the line leaves out a space it ends with.
  for (let i = start + 1; i < widths.length; i++) {
    const w = widths[i]!
    const endTrim = lineEndTrims === null ? 0 : lineEndTrims[i]!
    if (lineW + w - endTrim > fitLimit) {
      const kind = segmentFlags[i]! & KIND_BITS
      let end = i
      if (kind === SPACE) {
        end = i + 1
      } else if (kind === ZERO_WIDTH_BREAK && engineProfile.zeroWidthSpaceStaysAfterAtomic && (segmentFlags[i - 1]! & KIND_BITS) === OBJECT) {
        end = i + 1
        while (end < widths.length && (segmentFlags[end]! & KIND_BITS) === ZERO_WIDTH_BREAK) end++
      }
      cursor.segmentIndex = end
      cursor.graphemeIndex = 0
      return end === i && breaksAfterKind(segmentFlags[i - 1]! & KIND_BITS) ? lineW - widths[i - 1]! : lineW - endTrimmed
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
  prepared: PreparedLineData,
  cursor: LayoutCursor,
  maxWidth: number,
): number | null {
  if (prepared.simpleLineWalkFastPath) return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  return walkPreparedComplexLines(prepared, cursor, maxWidth, undefined, null, true)
}
