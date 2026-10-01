import type { LayoutCursor, WordBreakMode } from './layout.js'
import {
  analyzeText,
  CONTROL,
  getTrailingCollapsibleStart,
  HARD_BREAK,
  isCollapsibleSpaceCode,
  KIND_BITS,
  PRESERVED_SPACE,
  removeSkippableSegmentBreaks,
  RETURNABLE,
  SOFT_HYPHEN,
  SPACE,
  SPACED,
  TAB,
  TEXT,
  UNBROKEN,
  ZERO_WIDTH_BREAK,
  ZERO_WIDTH_GLUE,
  type TextAnalysis,
  type WhiteSpaceMode,
} from './analysis.js'
import { getGeckoParagraphLevels, isDiscardable } from './gecko-line-breaks.js'
import { getHaltAcrossRuns } from './han-kerning.js'
import { getWebKitBreakBetweenItems } from './line-breaks.js'
import { buildLineTextFromRange, getGraphemeEnds, type PreparedSegments } from './line-text.js'
import {
  breaksAfterKind,
  endsLineBefore,
  isDiscretionaryLineEnd,
  normalizePreparedLineStart,
  stepPreparedLineGeometryFromStart,
  walkPreparedLinesRaw,
  type ItemLine,
} from './line-break.js'
import { getEngineProfile, getFontMeasurement, getPreparationLanguage, getSegmentMetrics, readLetterSpacing, zeros, type EngineProfile } from './measurement.js'
import { measureAnalysis } from './prepare.js'

// Helper for rich-text inline flow under `white-space: normal` or `pre-wrap`.
// It keeps the core layout API low-level while taking over the boring shared
// work that rich inline demos kept reimplementing in userland:
// - collapsed boundary whitespace across item boundaries, and under pre-wrap preserved
//   spaces that hang across them, tab stops counted from the line's start, and hard breaks
// - atomic inline boxes like pills, and boxes the app sizes and paints, such as images
// - per-item extra horizontal chrome such as padding/borders
// - break opportunities across item boundaries as the engine finds them: from the
//   text the items join in Blink and Gecko, and in WebKit from each item's own text
//   and the previous item's last two characters, under the paragraph's word-break
// - runs that continue across items without a break, which wrap together

declare const preparedRichInlineBrand: unique symbol

export type RichInlineItem = {
  text: string // Raw author text, including any leading/trailing collapsible spaces
  font: string // Canvas font shorthand used to prepare and measure this item
  letterSpacing?: number // Extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a pill or mention chip
  extraWidth?: number // Caller-owned horizontal chrome, e.g. padding + border width
  width?: never // A RichInlineBox's
}

// An object inside a line that the app sizes and paints, such as an image, a custom emoji, a formula
// or a badge: an atomic inline with no text, as an <img> or an empty inline-block is, which a line
// can break before and after. An item without text is one.
export type RichInlineBox = {
  width: number // The room it takes on the line, in CSS px, at least 0 and final: its element's margin box
  text?: never
}

// How the paragraph the items make wraps, one setting for all of them, as CSS on the
// element that holds the spans sets it.
export type RichInlineOptions = {
  whiteSpace?: WhiteSpaceMode // `pre-wrap`: CSS `white-space: pre-wrap`, as prepare() takes it
  wordBreak?: WordBreakMode // `keep-all`: CSS `word-break: keep-all`, as prepare() takes it
}

export type PreparedRichInline = {
  readonly [preparedRichInlineBrand]: true
}

export type RichInlineCursor = {
  itemIndex: number // Index into the items prepareRichInline() took
  segmentIndex: number
  graphemeIndex: number
}

export type RichInlineFragment = {
  itemIndex: number // Index into the items prepareRichInline() took
  text: string // Text slice for this fragment
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  gapItemIndex: number // Item whose collapsed whitespace made gapBefore, or -1 when no gap precedes this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type RichInlineFragmentRange = {
  itemIndex: number // Index into the items prepareRichInline() took
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  gapItemIndex: number // Item whose collapsed whitespace made gapBefore, or -1 when no gap precedes this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type RichInlineLine = {
  fragments: RichInlineFragment[]
  width: number
  end: RichInlineCursor
}

export type RichInlineLineRange = {
  fragments: RichInlineFragmentRange[]
  width: number
  end: RichInlineCursor
}

export type RichInlineStats = {
  lineCount: number
  maxLineWidth: number
}

type InternalPreparedRichInline = PreparedRichInline & {
  items: Array<PreparedRichInlineItem | undefined>
  // The paragraph's item where it is the only one and lays out as its text alone
  // (prepareRichInline()), which the line functions walk with the text walkers; else null.
  onlyItem: PreparedRichInlineItem | null
}

type PreparedRichInlineItem = {
  break: 'normal' | 'never'
  // An ordinary break at the boundary before this item: collapsed whitespace,
  // or a break the joined text offers there.
  breakBefore: boolean
  // The next item continues this item's last run without a break.
  continued: boolean
  // A line walks the item even where it fits whole: where the item is continued and
  // breaks inside, the walk leaves the line's latest break, which the line returns to
  // where the continuing run doesn't fit, a hard break inside it ends the line, and
  // where it starts with source a line start consumes, as a soft hyphen and a space,
  // its whole width leaves out what a line with content before it keeps, unless that
  // source goes on from the item's leading white space, as in Gecko (whitespaceRunOpen).
  walked: boolean
  establishesLine: boolean
  extraWidth: number
  gapBefore: number
  // The item whose collapsed whitespace made gapBefore, or -1 without one.
  gapItemIndex: number
  // Where the item before ends with a soft hyphen, the hyphen a line ending at the break
  // before this item paints in the flat text, which rich-inline leaves out
  // (ENGINE_FOLLOWUPS.md); else 0.
  hyphenBefore: number
  // Per segment, the graphemes inside it before which the joined text breaks, in
  // order. Null without any.
  innerBreaks: (number[] | null)[] | null
  // The item's width on a line of its own, or, for one a line start consumes, the width it
  // takes after content (0 unless it is walked).
  naturalWidth: number
  // The width of the preserved spaces that end the item and hang where a line wraps after
  // it (ItemLine); 0 without them.
  hangWidth: number
  // Whether the item ends with a run of U+3000 that hangs where a line ends after it
  // (addIdeographicSpaceHangs in src/prepare.ts): the line-end trim of its last segment is
  // that run's, where another is a closing mark's halt (stepRichInlineLine).
  endHangs: boolean
  // Where the item starts with a line feed after a carriage return that ends the item
  // before, which make one hard break, as CRLF in one text does (normalizeWhitespacePreWrap).
  lineFeedAfterReturn: boolean
  // The part of the item's extraWidth a line with content fits where it takes the white space or
  // hard break that starts the item and no more of it, its opening (paddedOpeningFit): 0 where it
  // fits none, as without padding, or -1 where the ordinary fit takes the whole extraWidth.
  openingEdge: number
  // The item's own handle, which its fragments' cursors follow.
  prepared: PreparedSegments
  // What the line walkers take: `prepared`, or its copy for the full walker
  // (getWalkedHandle). A fragment's text is the item's own, with the hyphen of a soft
  // hyphen of this copy's that its line ends at, as the line's width counts it.
  lineData: PreparedSegments
}

// An item's text inside a joined window: the whole item, or its text before
// its first collapsible space or after its last one.
type JoinedPortion = {
  item: PreparedRichInlineItem
  itemIndex: number
  start: number // Offset in the window text, set when the window has a boundary
  startSegmentIndex: number // Item segment where the portion starts
  // Segment after the collapsible space that ends the portion, or -1 when the
  // portion ends with the item.
  spaceEndSegmentIndex: number
}

const EMPTY_LAYOUT_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
const RICH_INLINE_START_CURSOR: RichInlineCursor = {
  itemIndex: 0,
  segmentIndex: 0,
  graphemeIndex: 0,
}

function getInternalPreparedRichInline(prepared: PreparedRichInline): InternalPreparedRichInline {
  return prepared as InternalPreparedRichInline
}

function cloneCursor(cursor: LayoutCursor): LayoutCursor {
  return {
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  }
}

function isLineStartCursor(cursor: LayoutCursor): boolean {
  return cursor.segmentIndex === 0 && cursor.graphemeIndex === 0
}

function getCollapsedSpaceWidth(font: string, letterSpacing: number, language: string | null): number {
  return getSegmentMetrics(' ', getFontMeasurement(font, language)).width + letterSpacing
}

// A zero-width break the Gecko profile makes of a soft hyphen after white space, which
// Firefox drops from its text (IsDiscardable, nsTextFrameUtils.cpp:32-49).
function isDiscardedBreak(data: PreparedSegments, segmentIndex: number): boolean {
  return (data.segmentFlags[segmentIndex]! & KIND_BITS) === ZERO_WIDTH_BREAK && data.segments[segmentIndex]!.charCodeAt(0) === 0x00AD
}

// Each item's text after the segment break transformation, and a box's, which is empty. Where the
// engine transforms segment breaks in the text of the whole paragraph, in which an atomic inline is
// U+FFFC (EngineProfile), a collapsible run with a newline next to a ZWSP in another item goes too.
// Where an item holds a newline, the paragraph's text is transformed once, and each item that isn't
// atomic takes its part of the result, which can only remove more than the item's own text does, at
// its ends.
function getItemTexts(items: Array<RichInlineItem | RichInlineBox>, profile: EngineProfile, language: string | null): string[] {
  const texts: string[] = []
  if (!profile.transformsSegmentBreaksAcrossItems || !items.some(item => item.text?.includes('\n') === true)) {
    for (let index = 0; index < items.length; index++) texts.push(removeSkippableSegmentBreaks(items[index]!.text ?? '', profile, language))
    return texts
  }
  let source = ''
  const sourceEnds: number[] = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    source += item.text === undefined || item.break === 'never' ? '\uFFFC' : item.text
    sourceEnds.push(source.length)
  }
  const removed: number[] = []
  const transformed = removeSkippableSegmentBreaks(source, profile, language, removed)
  for (let index = 0, r = 0, transformedStart = 0; index < items.length; index++) {
    while (r < removed.length && removed[r]! < sourceEnds[index]!) r++
    const transformedEnd = sourceEnds[index]! - r
    const item = items[index]!
    texts.push(item.text === undefined ? '' : item.break === 'never' ? removeSkippableSegmentBreaks(item.text, profile, language) : transformed.slice(transformedStart, transformedEnd))
    transformedStart = transformedEnd
  }
  return texts
}

// The bidi levels Firefox resolves over the paragraph the items make (getGeckoParagraphLevels), each
// item's text (getItemTexts) and an atomic one as U+FFFC (nsBidiPresUtils.cpp:1385-1396), or null
// where it resolves none. `starts` takes each item's offset in that text.
function getItemLevels(items: Array<RichInlineItem | RichInlineBox>, texts: string[], starts: number[]): Uint8Array | null {
  let source = ''
  for (let index = 0; index < items.length; index++) {
    starts.push(source.length)
    const item = items[index]!
    source += item.text === undefined || item.break === 'never' ? '\uFFFC' : texts[index]!
  }
  return getGeckoParagraphLevels(source)
}

// Moves `start` past what a rich line start consumes: what normalizePreparedLineStart()
// consumes, and a discarded break (isDiscardedBreak), where normalization stops only at a
// chunk's start. The Gecko analysis makes one only of the last soft hyphen of white space and
// soft hyphens, before other source, so a ZWSP or a hard break after it still holds the line.
// False where that is all of the item.
function normalizeItemLineStart(data: PreparedSegments, start: LayoutCursor): boolean {
  if (!normalizePreparedLineStart(data, start)) return false
  return !(isDiscardedBreak(data, start.segmentIndex) && ++start.segmentIndex === data.segmentFlags.length)
}

function createItemLine(continues: boolean): ItemLine {
  return { continues, breakBefore: false, fitsBreakBefore: false, innerBreaks: null, lineOffset: 0, breakSegmentIndex: -1, breakGraphemeIndex: 0, breakWidth: 0, breakHangWidth: 0, hangWidth: 0, endTrim: 0 }
}

// The item's width on a line of its own, from `start`, which it moves past what a line
// start consumes; null where that is all of it. `line`, where given, takes the width of the
// preserved spaces that end it (ItemLine).
function measureWholeItem(prepared: PreparedSegments, start: LayoutCursor, line: ItemLine | null): number | null {
  return normalizeItemLineStart(prepared, start) ? stepPreparedLineGeometryFromStart(prepared, cloneCursor(start), Number.POSITIVE_INFINITY, line) : null
}

// The width of an item a line start consumes on a line with content before it.
function measureAfterContent(prepared: PreparedSegments): number {
  return stepPreparedLineGeometryFromStart(prepared, { segmentIndex: 0, graphemeIndex: 0 }, Number.POSITIVE_INFINITY, createItemLine(true))!
}

// Whether a line can end before segment `index` of an analysis or a handle, as the line
// walker reads their flags.
function breaksBefore(flags: ArrayLike<number>, index: number): boolean {
  return endsLineBefore(flags[index - 1]! & KIND_BITS, flags[index]! & KIND_BITS, (flags[index]! & UNBROKEN) !== 0)
}

// Marks a segment unbroken, as preparation marks one before which the scan gives no
// break: a ZWSP or soft hyphen before it becomes zero-width glue, which is unbroken
// too after a segment that doesn't break after itself, as the scan doesn't break
// before a ZWSP or soft hyphen there. `before` holds the flags of the segment before
// it at `beforeIndex`.
function markUnbroken(flags: Uint8Array, index: number, before: Uint8Array, beforeIndex: number): void {
  flags[index] = flags[index]! & ~RETURNABLE | UNBROKEN
  const kind = before[beforeIndex]! & KIND_BITS
  if (kind !== ZERO_WIDTH_BREAK && kind !== SOFT_HYPHEN) return
  let glue = before[beforeIndex]! & ~KIND_BITS | ZERO_WIDTH_GLUE
  if (beforeIndex > 0 && !breaksAfterKind(before[beforeIndex - 1]! & KIND_BITS)) glue = glue & ~RETURNABLE | UNBROKEN
  before[beforeIndex] = glue
}

// Gives an item the joined text's breaks inside a portion, which its own segments can
// disagree with, in a copy of its flags where they differ (`walkedFlags`,
// getWalkedHandle): a ZWSP or soft hyphen takes the kind of the last of the joined
// text's segments that start inside it, which ends where it ends and which the text
// around it decides, as at the item's start, where the item's own analysis sees the
// start of a text, or where it joins soft hyphens that the joined text splits. That
// kind decides the break after the segment and the hyphen a line that ends there
// paints. After the portion start, a segment that starts where one of the joined
// text's does starts unbroken where that one does, and text that starts inside one of
// the joined text's segments starts unbroken. The joined text's breaks inside the
// item's segments become graphemes there, where the line walker can end a line
// (innerBreaks). The joined text's segments from `startIndex` start at or after the
// portion start.
function recordJoinedBreaks(
  portion: JoinedPortion,
  joined: TextAnalysis,
  startIndex: number,
  portionEnd: number,
  walkedFlags: Array<Uint8Array | undefined>,
): void {
  const { item, itemIndex } = portion
  const { breakableFitAdvances, entryGeometry, segmentFlags, segments } = item.prepared
  const { flags: joinedFlags, starts } = joined
  let j = startIndex
  let segmentStart = portion.start
  for (let i = portion.startSegmentIndex; i < segments.length && segmentStart < portionEnd; i++) {
    const own = segmentFlags[i]!
    const kind = own & KIND_BITS
    let flags = own
    const firstInside = j
    if (starts[j] === segmentStart) {
      if (i > portion.startSegmentIndex) flags = flags & ~UNBROKEN | (joinedFlags[j]! & UNBROKEN)
      j++
    } else if (i > portion.startSegmentIndex && (kind === TEXT || kind === CONTROL)) {
      flags |= UNBROKEN
    }
    const segmentEnd = segmentStart + segments[i]!.length
    for (; j < starts.length && starts[j]! < segmentEnd; j++) {
      // A line ends inside a segment only between graphemes it has fit advances for,
      // and not in one with fresh-line geometry. Grapheme k + 1 starts where k ends.
      if (!breaksBefore(joinedFlags, j) || breakableFitAdvances[i] === null || (entryGeometry !== null && entryGeometry[i] !== null)) continue
      const grapheme = getGraphemeEnds(item.prepared, i).indexOf(starts[j]! - segmentStart) + 1
      if (grapheme > 0) ((item.innerBreaks ??= Array.from({ length: segments.length }, () => null))[i] ??= []).push(grapheme)
    }
    if (j > firstInside && (kind === ZERO_WIDTH_BREAK || kind === SOFT_HYPHEN || kind === ZERO_WIDTH_GLUE)) flags = flags & ~KIND_BITS | (joinedFlags[j - 1]! & KIND_BITS)
    if (flags !== own) (walkedFlags[itemIndex] ??= segmentFlags.slice())[i] = flags & ~RETURNABLE
    segmentStart = segmentEnd
  }
}

// The handle an item walks on where its lines can continue into the next item or
// come from the previous one without a break, or its segments disagree with the
// joined text: a copy that only the full walker takes, whose flags mark every break
// returnable, as preparation marks text with an unbroken boundary, so a line returns
// to its latest break, which the walker leaves where the line takes the item's end
// (ItemLine).
function getWalkedHandle(prepared: PreparedSegments, flags: Uint8Array): PreparedSegments {
  for (let i = 0; i < flags.length; i++) if ((flags[i]! & UNBROKEN) === 0) flags[i] = flags[i]! | RETURNABLE
  return { ...prepared, segmentFlags: flags, simpleLineWalkFastPath: false }
}

// A box's handle, which every box shares, as nothing writes to a handle: one empty segment, which its
// fragment spans, so that a line starting at the box doesn't take that start for its end
// (stepRichInlineLine).
const BOX_HANDLE: PreparedSegments = {
  segments: [''], widths: [0], segmentFlags: Uint8Array.of(TEXT), simpleLineWalkFastPath: false, simpleLineCountFastPath: false,
  breakableFitAdvances: [null], entryGeometry: null, lineStartProhibitions: null, lineStartExtras: null, lineEndTrims: null,
  overflowLineEndTrims: null, letterSpacing: 0, discretionaryHyphenWidth: 0, discretionaryHyphenContexts: null, tabStopAdvance: 0,
}

export function prepareRichInline(items: Array<RichInlineItem | RichInlineBox>, options?: RichInlineOptions): PreparedRichInline {
  const whiteSpace = options?.whiteSpace ?? 'normal'
  const wordBreak = options?.wordBreak ?? 'normal'
  // Under pre-wrap nothing collapses: an item's spaces, tabs and newlines are its content,
  // and the items' text joins as it is, as one text node's does.
  const preserve = whiteSpace === 'pre-wrap'
  const preparedItems = Array.from<PreparedRichInlineItem | undefined>({ length: items.length })
  // One language read for every item, the joined analysis and the boundary spaces.
  const profile = getEngineProfile()
  const language = getPreparationLanguage(profile)
  const texts = preserve ? items.map(item => item.text ?? '') : getItemTexts(items, profile, language)
  // Only preserved spaces hang at an item's end.
  const wholeLine = preserve ? createItemLine(false) : null
  // A collapsed SPACE can have zero or negative advance. Its existence and
  // ordinary break opportunity must survive independently of that number.
  let pendingGapWidth: number | null = null
  let pendingGapItemIndex = -1
  // Whether white space at the item's start collapses into a run of white space before it: after
  // white space that ends the item before, and, where Gecko collapses white space across soft
  // hyphens (EngineProfile), where the run goes on past them. TransformText drops soft hyphens and bidi
  // controls (IsDiscardable), collapses a run of white space with those after it, and
  // carries the run on from one text frame to the next (INCOMING_WHITESPACE), so white space
  // that starts the next frame collapses into it, whichever frame holds it; one of those
  // characters that follows no white space in its frame ends the run
  // (nsTextFrameUtils.cpp:286-386), and so does an atomic inline
  // (BuildTextRunsScanner::ScanFrame). In 16px Arial at 56px, Firefox fits `see this` of items
  // `see`, ` \u00AD`, ` this word` on a 55.15px line, and not of `see `, `\u00AD `, `this word`,
  // whose text in one node it fits. Bidi resolution splits text frames where the embedding level
  // changes, and a text run doesn't go on across that split (ContinueTextRunAcrossFrames,
  // nsTextFrame.cpp:2023-2030), so one of those characters at another level than the white space
  // before it starts a text run, where it follows no white space, and ends the run: Firefox's
  // first line of items `see \u200F\u00AD`, ` this more` at 60px is 59.60px, two spaces wide, as
  // U+200F is right-to-left there, and of `\u05E9\u05DC\u05D5\u05DD \u200F\u00AD`, ` this more`
  // at 62px 61.40px, one space wide, as U+200F takes the level of the space between Hebrew letters.
  let whitespaceRunOpen = false
  // The paragraph's bidi levels (getItemLevels), made where a run first goes on past such
  // characters (RESEARCH.md, Keeping Work Bounded), and each item's offset there.
  let levels: Uint8Array | null | undefined
  const levelStarts: number[] = []
  // Whether the characters Gecko drops among text[from, to), item `index`'s text, keep the level
  // of the one at `at`. White space among them collapses into the run at any level, as the run goes
  // on into the next text run (INCOMING_WHITESPACE, FlushFrames, nsTextFrame.cpp:1800-1804).
  function keepsLevel(index: number, at: number, from: number, to: number): boolean {
    if (from === to) return true
    if (levels === undefined) levels = getItemLevels(items, texts, levelStarts)
    if (levels === null) return true
    const offset = levelStarts[index]!
    const text = texts[index]!
    for (let i = from; i < to; i++) if (levels[offset + i] !== levels[offset + at] && isDiscardable(text.charCodeAt(i), false)) return false
    return true
  }
  let previousItem: PreparedRichInlineItem | null = null
  // The previous item's source text and break, which a line feed that starts this item can
  // follow a carriage return in.
  let previousText = ''
  let previousBreak: PreparedRichInlineItem['break'] | null = null
  // Where the next item follows an atomic item with only items of preserved spaces and tabs that
  // hang between them, padded or not, the first item after the atomic item; else -1. A line keeps
  // such white space after the break after the atomic item, padded where the engine fits its
  // opening (openingEdge).
  let whiteSpaceStart = -1
  // Collapsible spaces always break and atomic items always allow a break on
  // both sides, under keep-all too: Blink breaks after an atomic inline and before one
  // (CanBreakAfterAtomicInline and CanBreakAfter, line_breaker.cc:1168-1263 in
  // core/layout/inline), WebKit finds a soft wrap opportunity on either side of one
  // (InlineFormattingUtils.cpp:445-449), and Gecko records a break after one and breaks
  // before one that doesn't fit (nsLineLayout.cpp:1057-1068, 1339-1340). Only the text
  // between them joins across item boundaries.
  const joinedPortions: JoinedPortion[] = []
  // Whether the window starts after collapsible white space, and after content, which a
  // soft hyphen at its start follows in the paragraph.
  let joinedAfterSpace = false
  let joinedAfterContent = false
  // Per item, a copy of its flags where they differ from the joined text's breaks.
  const walkedFlags: Array<Uint8Array | undefined> = []
  // An item's last two source characters, read as prior context at the next
  // boundary where breaks come from each item's own text.
  const boundaryContexts: string[] = []

  // Blink's text-spacing-trim halts a pair of marks that two items split between them, as it
  // does in one text node, whatever the fonts or the padding between them (getHaltAcrossRuns):
  // in 16px Hiragino Sans, Chrome 154 lays out `文字」` and a span `。文字`, bold or padded or
  // neither, 88px wide plus the padding, as their text in one node, where the two measured
  // apart take 96px. `joined` is the text the items join, `after`'s starting at its `start`.
  // A closing mark halted before the next item's first character is halted wherever the line
  // ends, so it has no line-end halt left to take, and an opening mark halted after the item
  // before takes its halt back where it starts a line, so a line walks its item
  // (lineStartExtras), whose whole width is its width at a line's start.
  function haltAcrossItems(before: JoinedPortion, after: JoinedPortion, joined: string): void {
    const closing = getHaltAcrossRuns(joined, after.start, -1, (items[before.itemIndex] as RichInlineItem).font, language)
    if (closing > 0) {
      const { widths, lineEndTrims } = before.item.prepared
      widths[widths.length - 1] = widths[widths.length - 1]! - closing
      if (lineEndTrims !== null) lineEndTrims[widths.length - 1] = 0
      before.item.naturalWidth -= closing
    }
    const opening = getHaltAcrossRuns(joined, after.start, 1, (items[after.itemIndex] as RichInlineItem).font, language)
    if (opening > 0) {
      const { prepared } = after.item
      prepared.widths[0] = prepared.widths[0]! - opening
      ;(prepared.lineStartExtras ??= zeros(prepared.widths.length))[0] = opening
      after.item.walked = true
    }
  }

  function finishJoinedText(): void {
    if (joinedPortions.length > 1) {
      // Only a window with an item boundary needs its text.
      let joinedText = ''
      for (let i = 0; i < joinedPortions.length; i++) {
        const portion = joinedPortions[i]!
        const { segments } = portion.item.prepared
        const endSegmentIndex = portion.spaceEndSegmentIndex < 0 ? segments.length : portion.spaceEndSegmentIndex - 1
        portion.start = joinedText.length
        for (let s = portion.startSegmentIndex; s < endSegmentIndex; s++) joinedText += segments[s]!
      }
      if (profile.breaksFromItemText) {
        // Inside each item, breaks come from its own text, which made its segments, and at
        // a boundary from the scan over the next item's text with the previous item's
        // last two characters as prior context (TextUtil.cpp:374-396), which finds none
        // before a hard break.
        for (let i = 1; i < joinedPortions.length; i++) {
          const portion = joinedPortions[i]!
          const end = i + 1 < joinedPortions.length ? joinedPortions[i + 1]!.start : joinedText.length
          portion.item.breakBefore = getWebKitBreakBetweenItems(boundaryContexts[joinedPortions[i - 1]!.itemIndex]!, joinedText.slice(portion.start, end), wordBreak === 'keep-all', language)
        }
      } else {
        // Browsers find ordinary break opportunities in the text their inline items
        // join; the item boundary itself is not one. The joined text is analyzed like
        // prepare()'s, after the collapsible space before the window, which Gecko's scan
        // reads in the source, as it reads an item's leading space, and Blink's normalized
        // text drops, and after the content before it (RESEARCH.md, Rich Inline Boundaries).
        const joined = analyzeText(joinedAfterSpace && profile.lineBreakScan === 'gecko' ? ' ' + joinedText : joinedText, profile, whiteSpace, wordBreak, language, joinedAfterContent)
        // A line ends after a hard break, and no break comes before one (UAX #14 LB6).
        for (let i = 0, j = 0; i < joinedPortions.length; i++) {
          const portion = joinedPortions[i]!
          while (j < joined.starts.length && joined.starts[j]! < portion.start) j++
          if (i > 0) {
            portion.item.breakBefore = joined.starts[j] === portion.start && breaksBefore(joined.flags, j) && (joined.flags[j]! & KIND_BITS) !== HARD_BREAK
            // A run of U+3000 that goes on in this item doesn't end with the item before.
            const before = joinedPortions[i - 1]!
            if (joinedText.charCodeAt(portion.start) === 0x3000) before.item.endHangs = false
            if (profile.hanKerning) haltAcrossItems(before, portion, joinedText)
          }
          recordJoinedBreaks(portion, joined, j, i + 1 < joinedPortions.length ? joinedPortions[i + 1]!.start : joinedText.length, walkedFlags)
        }
      }
    }
    joinedPortions.length = 0
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (item.text === undefined) {
      // A box: an atomic item with no text, and so no white space of its own, which takes the gap
      // before it, breaks on both sides and keeps white space after it on its line as an atomic item
      // does (below), whose updates at the item's end this repeats; the test that a box lays out as the
      // atomic NBSP it replaces keeps the two alike (src/layout.test.ts). All its width is extraWidth,
      // which a line never hangs (hangTrailingFragments). A width that isn't finite would give lines of
      // width NaN or Infinity, and Chrome breaks lines around a negative one otherwise than a negative
      // extraWidth does (RESEARCH.md, Objects Inside A Line), so Pretext refuses both.
      if (!Number.isFinite(item.width) || item.width < 0) throw new RangeError(`Item ${index} has no text, so it's a box, whose width must be a finite number of CSS px, at least 0, not ${item.width}`)
      finishJoinedText()
      const box: PreparedRichInlineItem = {
        break: 'never', breakBefore: pendingGapWidth !== null || previousItem !== null, continued: false, walked: false,
        establishesLine: true, extraWidth: item.width, gapBefore: pendingGapWidth ?? 0, gapItemIndex: pendingGapWidth === null ? -1 : pendingGapItemIndex,
        hyphenBefore: 0, innerBreaks: null, naturalWidth: 0, hangWidth: 0, endHangs: false, lineFeedAfterReturn: false, openingEdge: -1, prepared: BOX_HANDLE, lineData: BOX_HANDLE,
      }
      preparedItems[index] = previousItem = box
      previousBreak = 'never'
      whiteSpaceStart = index + 1
      pendingGapWidth = null
      whitespaceRunOpen = false
      continue
    }
    const letterSpacing = readLetterSpacing(item.letterSpacing)
    const text = texts[index]!
    let start = 0
    while (!preserve && start < text.length && isCollapsibleSpaceCode(text.charCodeAt(start))) start++

    if (start === text.length) {
      if (start > 0 && (pendingGapWidth === null || !whitespaceRunOpen)) {
        pendingGapWidth = whitespaceRunOpen ? 0 : getCollapsedSpaceWidth(item.font, letterSpacing, language)
        pendingGapItemIndex = index
        whitespaceRunOpen = true
      }
      continue
    }

    // Scan from the ends once. A trailing-whitespace regex retries every
    // position in a long internal space run when later content prevents a match.
    // The trailing white space is what the item's analysis leaves out.
    const end = preserve ? text.length : getTrailingCollapsibleStart(text, start, profile)
    const hasLeadingWhitespace = start > 0
    const hasTrailingWhitespace = end < text.length
    const whitespaceBefore: boolean = pendingGapWidth !== null || hasLeadingWhitespace
    if (profile.breaksFromItemText) boundaryContexts[index] = text.slice(Math.max(0, end - 2), end)

    // Leading white space collapses into a run left open before it. An atomic item's own white
    // space makes no gap: its inline-block lays its text out as a paragraph of its own, whose
    // lines drop white space at their start and end. Blink puts the box in the outer paragraph as
    // one U+FFFC (inline_node.cc:408-422) and removes its own paragraph's leading and trailing
    // spaces (inline_items_builder.cc:869-871, ExitBlock at 1622-1629); WebKit's atomic inline
    // box is one item of the outer line (InlineItemsBuilder.cpp:1073-1074), and its own lines
    // collapse leading white space (Line::appendText, InlineLine.cpp:348-373) and remove
    // trailing (InlineLineBuilder.cpp:646); Gecko's text run stops at the box
    // (BuildTextRunsScanner::ScanFrame, nsTextFrame.cpp:2248-2254), and its own lines skip
    // leading white space (nsTextFrame.cpp:10935-10944) and trim trailing (nsBlockFrame.cpp:5844).
    const ownsWhiteSpace = item.break !== 'never'
    const takesOwnSpace = hasLeadingWhitespace && !whitespaceRunOpen && ownsWhiteSpace
    let gapBefore = takesOwnSpace ? getCollapsedSpaceWidth(item.font, letterSpacing, language) : pendingGapWidth ?? 0
    let gapItemIndex = takesOwnSpace ? index : pendingGapWidth !== null ? pendingGapItemIndex : hasLeadingWhitespace && ownsWhiteSpace ? index : -1
    // Normalization already drops boundary whitespace, so the item's own text
    // yields the same segments while analysis keeps the source before them:
    // a leading SPACE or TAB is break context inside the item's text node.
    // Fragment cursors then index the same segments and graphemes as
    // prepareWithSegments(item.text) under the same white-space and word-break. An atomic
    // item, which is only laid out whole, is prepared without emergency breaks, and in
    // normal white space, as a chip's box with `white-space: nowrap` collapses its own:
    // all three browsers lay out a pre-wrap paragraph of 15px Helvetica Neue with the 12px
    // chip ` @bob ` 6.6px narrower than the chip's text with its spaces.
    const itemBreak = item.break ?? 'normal'
    const analysis = analyzeText(item.text, profile, itemBreak === 'never' ? 'normal' : whiteSpace, wordBreak, language)
    const prepared = measureAnalysis(analysis, item.font, true, letterSpacing, profile, language, itemBreak !== 'never') as PreparedSegments
    const { segmentFlags } = prepared
    // A collapsible space before a hard break goes with the line's end (CSS Text 3
    // §4.1.2), so an item that starts with one has no gap before it.
    if ((segmentFlags[0]! & KIND_BITS) === HARD_BREAK) {
      gapBefore = 0
      gapItemIndex = -1
    }
    // The flat walker consumes spaces and soft hyphens at a line start, so an
    // item of only those has no whole width. Its result is a measurement
    // observation, not the rich item's identity or source end.
    const wholeStart: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
    if (wholeLine !== null) wholeLine.hangWidth = 0
    const wholeWidth = measureWholeItem(prepared, wholeStart, wholeLine)
    // The item's first and last collapsed space, whether it holds a zero-width break, a
    // hard break and a tab, and whether it holds only preserved spaces.
    let firstSpace = -1
    let lastSpace = -1
    let holdsZeroWidthBreak = false
    let holdsHardBreak = false
    let holdsTab = false
    let onlyPreservedSpace = true
    for (let i = 0; i < segmentFlags.length; i++) {
      const kind = segmentFlags[i]! & KIND_BITS
      if (kind === SPACE && firstSpace < 0) firstSpace = i
      if (kind === SPACE) lastSpace = i
      holdsZeroWidthBreak ||= kind === ZERO_WIDTH_BREAK
      holdsHardBreak ||= kind === HARD_BREAK
      holdsTab ||= kind === TAB
      onlyPreservedSpace &&= kind === PRESERVED_SPACE
    }
    const establishesLine = wholeWidth !== null || holdsZeroWidthBreak
    // Such an item can hold white space between its soft hyphens, which follows a soft
    // hyphen instead of the collapsed space before the item, so after content it takes
    // room and the line can end at the soft hyphens around it, as in one text: the item
    // is walked there, as one that starts with a soft hyphen and a space. Gecko discards
    // soft hyphens before it collapses white space (whitespaceRunOpen), so there white space
    // and soft hyphens after the item's leading white space are one run with it: where the
    // item starts with white space, what a line start consumes at its start takes no room
    // after content either, and only an item that starts with a soft hyphen is walked.
    const collapsesIntoLeading = profile.collapsesSpaceAcrossSoftHyphens && hasLeadingWhitespace
    const walksConsumed = !establishesLine && firstSpace >= 0 && firstSpace < segmentFlags.length - 1 && !collapsesIntoLeading

    const lineFeedAfterReturn = preserve && itemBreak !== 'never' && previousBreak === 'normal' &&
      text.charCodeAt(0) === 0x0A && previousText.charCodeAt(previousText.length - 1) === 0x0D
    // A break comes after an atomic item, but not in WebKit before a hard break, as the content it
    // places runs on from the atomic item to the line break (breaksFromItemText).
    const firstKind = segmentFlags[0]! & KIND_BITS
    const afterAtomic = previousBreak === 'never' && itemBreak !== 'never'
    const breaksAfterAtomic = !(afterAtomic && profile.breaksFromItemText && firstKind === HARD_BREAK)
    // The line keeps the white space or hard break that starts an item, where it takes no more of
    // the item, as the engine fits the item's padding there (paddedOpeningFit). Without padding,
    // preserved spaces, tabs that hang and a hard break after an atomic item stay on its line
    // however far it overflows, as no break comes before them in the text (UAX #14 LB6, LB7), and
    // so do they after items of only such white space after it, whatever items it spans: Blink
    // takes them as trailing items after the break after an atomic inline (HandleTrailingSpaces,
    // line_breaker.cc:2426-2534), trailing on into the next item where an item's spaces reach its
    // end (:2518-2533), and its return to that break keeps each item after it that starts with
    // trailable spaces (RewindOverflow, :4355-4370), though not a span that goes on past them,
    // whose open tag it doesn't trail (:4383-4394, :4414-4420), where rich inline takes an item as
    // the paragraph's own text (ENGINE_FOLLOWUPS.md); WebKit gives a soft wrap opportunity after
    // each white-space item (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:408-413) and keeps
    // each as content that hangs (InlineContentBreaker.cpp:181-182); and Gecko lets an empty frame
    // past the line's end (CanPlaceFrame). All three browsers keep a line feed, and two spaces, on
    // the line of a chip wider than the line (Chrome, though, gives a line feed after such spaces a
    // line of its own; ENGINE_FOLLOWUPS.md). But Gecko breaks only after a run of spaces and tabs
    // (nsLineBreaker.cpp:323, :586) and doesn't hang a tab, so where that white space runs into a
    // tab, whatever items it spans, the run doesn't fit: Firefox moves all of it to the next line
    // with the tab, and the line keeps none of it (runsIntoTab). Where the engine fits the item's
    // start edge, the line keeps them where that edge fits, after an atomic item and at a hard
    // break that starts the item anywhere, and in Blink at white space that starts it anywhere too,
    // but Blink keeps an item of only white space however far the line overflows, after any
    // content, and WebKit fits the end edge too of an item whose opening is all of it; else the
    // ordinary fit takes the item's whole extraWidth.
    const extraWidth = item.extraWidth ?? 0
    const opensWithWhiteSpace = firstKind === PRESERVED_SPACE || (firstKind === TAB && profile.hangTabs)
    let openingSpaceEnd = 0
    while (openingSpaceEnd < segmentFlags.length && (segmentFlags[openingSpaceEnd]! & KIND_BITS) === PRESERVED_SPACE) openingSpaceEnd++
    const runsIntoTab = !profile.hangTabs && openingSpaceEnd < segmentFlags.length && (segmentFlags[openingSpaceEnd]! & KIND_BITS) === TAB
    if (runsIntoTab && whiteSpaceStart >= 0) for (let k = whiteSpaceStart; k < index; k++) if (preparedItems[k] !== undefined) preparedItems[k]!.openingEdge = -1
    let openingEdge = -1
    if (extraWidth <= 0) {
      if (preserve && whiteSpaceStart >= 0 && !runsIntoTab && (opensWithWhiteSpace || firstKind === HARD_BREAK)) openingEdge = 0
    } else if (profile.paddedOpeningFit === 'start') {
      if (opensWithWhiteSpace || firstKind === HARD_BREAK) openingEdge = getWhiteSpaceEnd(segmentFlags) === segmentFlags.length ? 0 : extraWidth / 2
    } else if (profile.paddedOpeningFit === 'placed' && ((afterAtomic && opensWithWhiteSpace) || firstKind === HARD_BREAK)) {
      const whiteSpaceEnd = getWhiteSpaceEnd(segmentFlags)
      const onlyOpening = whiteSpaceEnd === segmentFlags.length ||
        (whiteSpaceEnd === segmentFlags.length - 1 && (segmentFlags[whiteSpaceEnd]! & KIND_BITS) === HARD_BREAK)
      openingEdge = onlyOpening ? extraWidth : extraWidth / 2
    }
    // The full walker tells a line that it left the run out (ItemLine), so the item walks on
    // a handle of its own (getWalkedHandle).
    const endTrims = prepared.lineEndTrims
    const endHangs = itemBreak !== 'never' && endTrims !== null && endTrims[endTrims.length - 1]! > 0 && text.charCodeAt(end - 1) === 0x3000
    if (endHangs) walkedFlags[index] = segmentFlags.slice()
    // A tab's advance depends on where it lands on the line, and the preserved spaces of an
    // item that holds nothing else go on the run of them the line ends with, so a line walks
    // such an item.
    const preparedItem = {
      break: itemBreak,
      breakBefore: whitespaceBefore,
      continued: false,
      walked: holdsHardBreak || holdsTab || onlyPreservedSpace || (wholeWidth !== null && wholeStart.segmentIndex > 0 && !collapsesIntoLeading) || walksConsumed,
      establishesLine,
      extraWidth,
      gapBefore,
      gapItemIndex,
      hyphenBefore: 0,
      innerBreaks: null,
      naturalWidth: wholeWidth ?? (walksConsumed ? measureAfterContent(prepared) : 0),
      hangWidth: wholeLine === null ? 0 : wholeLine.hangWidth,
      endHangs,
      lineFeedAfterReturn,
      openingEdge,
      prepared,
      lineData: prepared,
    } satisfies PreparedRichInlineItem
    preparedItems[index] = preparedItem

    if (previousItem === null || whitespaceBefore || preparedItem.break === 'never' || previousItem.break === 'never') {
      finishJoinedText()
      preparedItem.breakBefore = whitespaceBefore || (previousItem !== null && breaksAfterAtomic)
    }
    if (preparedItem.break === 'never') {
      finishJoinedText()
    } else {
      // Normal-mode segments hold single collapsed spaces. Text beyond the
      // first and last of them cannot reach a neighboring item's boundary. Pre-wrap
      // text has none, so a window runs from one atomic item to the next.
      if (joinedPortions.length === 0) {
        joinedAfterSpace = whitespaceBefore
        joinedAfterContent = previousItem !== null
      }
      joinedPortions.push({
        item: preparedItem,
        itemIndex: index,
        start: 0,
        startSegmentIndex: 0,
        spaceEndSegmentIndex: firstSpace < 0 ? -1 : firstSpace + 1,
      })
      if (firstSpace >= 0) {
        finishJoinedText()
        joinedAfterSpace = true
        joinedAfterContent = true
        joinedPortions.push({
          item: preparedItem,
          itemIndex: index,
          start: 0,
          startSegmentIndex: lastSpace + 1,
          spaceEndSegmentIndex: -1,
        })
      }
    }
    previousItem = preparedItem
    previousText = item.text
    previousBreak = itemBreak
    whiteSpaceStart = itemBreak === 'never' ? index + 1
      : whiteSpaceStart >= 0 && !runsIntoTab && getWhiteSpaceEnd(segmentFlags) === segmentFlags.length ? whiteSpaceStart : -1
    // Nothing collapses under pre-wrap, so no run of white space goes on past the item.
    if (preserve) continue

    // The run goes on past the item where its text before the trailing white space ends in white
    // space and then characters Gecko drops, and those and the bidi controls among the trailing
    // white space keep that white space's bidi level. The characters hold a soft hyphen unless
    // that white space is the item's leading white space, since the trailing white space reads
    // through bidi controls. The trailing white space then collapses into the run, as a gap that
    // takes no room where a line still breaks. The item's analysis leaves the trailing white space
    // out as one run, whatever the levels of the controls in it, so where the run doesn't go on,
    // the gap after the item stands for it and the next item's white space collapses into that
    // (ENGINE_FOLLOWUPS.md). Bidi controls after the last white space of a run that goes on leave
    // it open only at that white space's level.
    let runEnd = end
    while (runEnd > 0 && isDiscardable(text.charCodeAt(runEnd - 1), false)) runEnd--
    let spaceEnd = text.length
    while (spaceEnd > end && !isCollapsibleSpaceCode(text.charCodeAt(spaceEnd - 1))) spaceEnd--
    const levelsSplitRun = profile.collapsesSpaceAcrossSoftHyphens && itemBreak !== 'never'
    const runGoesOn = levelsSplitRun && runEnd > 0 && isCollapsibleSpaceCode(text.charCodeAt(runEnd - 1)) && keepsLevel(index, runEnd - 1, runEnd, spaceEnd)
    const gapsTrailingWhitespace = hasTrailingWhitespace && ownsWhiteSpace
    pendingGapWidth = !gapsTrailingWhitespace
      ? null
      : runGoesOn ? 0 : getCollapsedSpaceWidth(item.font, letterSpacing, language)
    pendingGapItemIndex = gapsTrailingWhitespace ? index : -1
    whitespaceRunOpen = runGoesOn ? keepsLevel(index, spaceEnd - 1, spaceEnd, text.length) : gapsTrailingWhitespace
  }

  finishJoinedText()

  // Without a break at the next boundary, the previous item's last run continues
  // into the item, whose start is unbroken for the line walker. Where a break comes
  // before an item a line start consumes between them, as one holding only a soft
  // hyphen, the run starts at that break instead, which a line can end at. Where the
  // item right before ends with a soft hyphen, a break before this item is that hyphen's.
  let previousIndex = -1
  // The latest item a line start consumes since the previous item, where a break comes before it.
  let consumedBreakIndex = -1
  for (let index = 0; index < preparedItems.length; index++) {
    const item = preparedItems[index]
    if (item === undefined) continue
    if (item.establishesLine && previousIndex >= 0 && !item.breakBefore) {
      const runIndex = consumedBreakIndex >= 0 ? consumedBreakIndex : previousIndex
      preparedItems[runIndex]!.continued = true
      const before = walkedFlags[runIndex] ??= preparedItems[runIndex]!.prepared.segmentFlags.slice()
      markUnbroken(walkedFlags[index] ??= item.prepared.segmentFlags.slice(), 0, before, before.length - 1)
    }
    const itemBefore = index > 0 ? preparedItems[index - 1] : undefined
    if (itemBefore !== undefined && itemBefore.break === 'normal' && item.gapItemIndex < 0) {
      const flags = walkedFlags[index - 1] ?? itemBefore.prepared.segmentFlags
      if ((flags[flags.length - 1]! & KIND_BITS) === SOFT_HYPHEN) item.hyphenBefore = itemBefore.prepared.discretionaryHyphenWidth
    }
    if (item.establishesLine) {
      previousIndex = index
      consumedBreakIndex = -1
    } else if (item.breakBefore) {
      consumedBreakIndex = index
    }
  }
  for (let index = 0; index < preparedItems.length; index++) {
    const item = preparedItems[index]
    if (item === undefined || (item.innerBreaks === null && walkedFlags[index] === undefined)) continue
    item.lineData = getWalkedHandle(item.prepared, walkedFlags[index] ?? item.prepared.segmentFlags.slice())
    // A continued item that breaks inside is walked, which leaves the line's latest break.
    // One a line start consumes is walked only where it holds white space (above).
    if (!item.continued || !item.establishesLine) continue
    const { segmentFlags } = item.lineData
    let breaks = item.innerBreaks !== null
    for (let i = 1; !breaks && i < segmentFlags.length; i++) breaks = breaksBefore(segmentFlags, i)
    item.walked ||= breaks
  }

  // An item alone has no joined text, gap or continued run, and stepRichInlineLine() lays
  // it out as the text walkers lay out its handle, but for its whole fit at its start:
  // where it has no extraWidth, isn't atomic and isn't walked, which leaves out hard breaks,
  // and where its lines start as a text's do, with no source a line start consumes at its
  // start (normalizeItemLineStart()). A paragraph of one styled run is the most common one.
  const only = items.length === 1 ? preparedItems[0] : undefined
  const onlyStart: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const onlyItem = only !== undefined && only.break === 'normal' && only.extraWidth === 0 && !only.walked &&
    normalizeItemLineStart(only.prepared, onlyStart) && onlyStart.segmentIndex === 0 ? only : null

  return {
    items: preparedItems,
    onlyItem,
  } as InternalPreparedRichInline
}

// Emits a fragment covering an item from `start` to its source end.
function collectItemRest(
  fragments: RichInlineFragmentRange[] | null,
  itemIndex: number,
  item: PreparedRichInlineItem,
  start: LayoutCursor,
  gapBefore: number,
  gapItemIndex: number,
  occupiedWidth: number,
): void {
  fragments?.push({
    itemIndex,
    gapBefore,
    gapItemIndex,
    occupiedWidth,
    start: cloneCursor(start),
    end: { segmentIndex: item.prepared.segments.length, graphemeIndex: 0 },
  })
}

// The room a line that ends at a break without a hyphen leaves for the item's hyphen,
// for a return from an unfit soft hyphen to it: Blink's retry leaves room for it.
function getHyphenRoom(item: PreparedRichInlineItem, unfitHyphenRetreat: EngineProfile['unfitHyphenRetreat']): number {
  return unfitHyphenRetreat === 'reduced-width' ? item.prepared.discretionaryHyphenWidth : 0
}

// Whether a line that ends at the break before the item fits, with the hyphen it paints there or room for one.
function fitsBreakBefore(item: PreparedRichInlineItem, lineWidth: number, fitLimit: number, unfitHyphenRetreat: EngineProfile['unfitHyphenRetreat']): boolean {
  return lineWidth + (item.hyphenBefore > 0 ? item.hyphenBefore : getHyphenRoom(item, unfitHyphenRetreat)) <= fitLimit
}

// Whether the full walker, continuing a line with content from the item's start, ends the
// line before the item at its first segment (walkPreparedComplexLines): text or a control
// that a break comes before, with no break inside it, whose advance with the letter spacing
// after it, less its line-end trim, overflows `fitLimit`.
function firstSegmentOverflows(item: PreparedRichInlineItem, fitLimit: number): boolean {
  const { lineData, innerBreaks } = item
  const flags = lineData.segmentFlags[0]!
  const kind = flags & KIND_BITS
  if ((kind !== TEXT && kind !== CONTROL) || (flags & UNBROKEN) !== 0 || (innerBreaks !== null && innerBreaks[0] !== null)) return false
  const w = lineData.widths[0]!
  const fitAdvance = w === 0 && kind !== CONTROL ? 0 : w + ((flags & SPACED) !== 0 ? lineData.letterSpacing : 0)
  return fitAdvance - (lineData.lineEndTrims === null ? 0 : lineData.lineEndTrims[0]!) > fitLimit
}

// Where WebKit and Gecko end a line before the end of the text an item ends with, which the line
// holds from (startSegmentIndex, startGraphemeIndex) to the item's end (hardBreakItemRetreat):
// before its last grapheme, or, in WebKit, where it ends with preserved spaces and the line
// overflows by `overflow`, after the spaces that fit. That position goes in `at`, and the width
// the line gives up there, with the letter spacing after it, or null where the item is atomic or
// doesn't end with text or preserved spaces, or that position is the line's start or the item's.
// Where the last grapheme is all of the item, the line ends before the item (retreatsBefore),
// and here only that grapheme starting the line is left.
function getEndRetreat(item: PreparedRichInlineItem, startSegmentIndex: number, startGraphemeIndex: number, overflow: number, keepsFit: boolean, at: LayoutCursor): number | null {
  const { breakableFitAdvances, letterSpacing, segmentFlags, segments, widths } = item.lineData
  const s = segmentFlags.length - 1
  const kind = segmentFlags[s]! & KIND_BITS
  if (item.break === 'never' || (kind !== TEXT && kind !== PRESERVED_SPACE)) return null
  let retreat: number
  at.segmentIndex = s
  if (kind === TEXT) {
    const advances = breakableFitAdvances[s] ?? null
    at.graphemeIndex = advances === null ? 0 : advances.length - 1
    retreat = (advances === null ? widths[s]! : advances[at.graphemeIndex]!) + ((segmentFlags[s]! & SPACED) !== 0 ? letterSpacing : 0)
  } else {
    const count = segments[s]!.length
    const advance = getSpaceAdvance(item.lineData, s)
    const given = keepsFit && overflow > 0 ? Math.min(count, Math.ceil(overflow / advance)) : 1
    at.graphemeIndex = count - given
    retreat = given * advance
  }
  if (s < startSegmentIndex || (s === startSegmentIndex && at.graphemeIndex <= startGraphemeIndex)) return null
  return retreat
}

// The first of an item's segments that isn't a preserved space or a tab, or their count.
function getWhiteSpaceEnd(segmentFlags: Uint8Array): number {
  let i = 0
  while (i < segmentFlags.length && ((segmentFlags[i]! & KIND_BITS) === PRESERVED_SPACE || (segmentFlags[i]! & KIND_BITS) === TAB)) i++
  return i
}

// Whether a line `lineWidth` wide, which ends with `hangWidth` of preserved spaces and tabs that
// hang, keeps the opening of item `itemIndex`, as it fits the edges the engine fits there
// (openingEdge, paddedOpeningFit). WebKit leaves the white space that hangs out of the fit
// (hangingContentWidth). Blink's line trails after that white space, taking the opening with no
// edge where the content before it fits, once the white space overflows or where it follows
// text in one item, which Blink's return breaks before it; after spaces that start at an item's
// start, where no break comes before them (UAX #14 LB7), the start edge fits with them. The
// stepper asks only where the line can't take the item's padding, and before a walk, so text
// without such openings pays nothing for them on every item.
function fitsOpening(
  flow: InternalPreparedRichInline,
  itemIndex: number,
  lineWidth: number,
  hangWidth: number,
  fitLimit: number,
  fit: EngineProfile['paddedOpeningFit'],
  startItemIndex: number,
  startSegmentIndex: number,
): boolean {
  const edge = flow.items[itemIndex]!.openingEdge
  if (edge <= 0) return edge === 0
  if (fit === 'placed') return lineWidth - hangWidth + edge <= fitLimit
  if (hangWidth > 0 && (lineWidth > fitLimit || spacesFollowText(flow, itemIndex, startItemIndex, startSegmentIndex))) return lineWidth - hangWidth <= fitLimit
  return lineWidth + edge <= fitLimit
}

// Whether the preserved spaces a line ends with before item `itemIndex` follow text in one item on
// the line, from (startItemIndex, startSegmentIndex). Blink gives every run of preserved tabs a
// control item of its own (inline_items_builder.cc:1098-1110), so a tab, and spaces after one,
// follow no text.
function spacesFollowText(flow: InternalPreparedRichInline, itemIndex: number, startItemIndex: number, startSegmentIndex: number): boolean {
  for (let k = itemIndex - 1; k >= startItemIndex; k--) {
    const item = flow.items[k]
    if (item === undefined) continue
    if (item.break === 'never') return false
    const { segmentFlags } = item.lineData
    const from = k === startItemIndex ? startSegmentIndex : 0
    let s = segmentFlags.length - 1
    while (s >= from && (segmentFlags[s]! & KIND_BITS) === PRESERVED_SPACE) s--
    if (s >= from) return s < segmentFlags.length - 1 && (segmentFlags[s]! & KIND_BITS) !== TAB
  }
  return false
}

// The advance of one space of preserved-space segment `s`, with the letter spacing after it: its
// spaces, U+0020 each, are one grapheme and one advance each.
function getSpaceAdvance(data: PreparedSegments, s: number): number {
  const count = data.segments[s]!.length
  const spacing = (data.segmentFlags[s]! & SPACED) !== 0 ? data.letterSpacing : 0
  return (data.widths[s]! - (count - 1) * spacing) / count + spacing
}

// Whether a line that can't fit the padding of the next item, which starts with a hard break
// with no break before it, ends before item `itemIndex`, where WebKit and Gecko end it before the
// last grapheme of the text before that item (hardBreakItemRetreat): where the item's text is one
// grapheme, as getEndRetreat reads its last grapheme, a preserved space too. A line keeps an
// unpadded one, so it never returns to that break.
function retreatsBefore(flow: InternalPreparedRichInline, itemIndex: number): boolean {
  const item = flow.items[itemIndex]!
  let nextIndex = itemIndex + 1
  while (nextIndex < flow.items.length && flow.items[nextIndex] === undefined) nextIndex++
  const next = flow.items[nextIndex]
  if (next === undefined || next.breakBefore || (next.prepared.segmentFlags[0]! & KIND_BITS) !== HARD_BREAK) return false
  const { breakableFitAdvances, segmentFlags, segments } = item.prepared
  if (segmentFlags.length !== 1) return false
  const kind = segmentFlags[0]! & KIND_BITS
  const advances = breakableFitAdvances[0] ?? null
  return (kind === TEXT && (advances === null || advances.length === 1)) || (kind === PRESERVED_SPACE && segments[0]!.length === 1)
}

// The line state a walked item takes and leaves, one for every walk.
const itemLine: ItemLine = createItemLine(false)

// Takes `hang`, the white space that hangs at a line's end, out of the text widths of the
// line's last fragments, never their extraWidth.
function hangTrailingFragments(flow: InternalPreparedRichInline, fragments: RichInlineFragmentRange[], hang: number): void {
  for (let k = fragments.length - 1; k >= 0 && hang > 0; k--) {
    const fragment = fragments[k]!
    const textWidth = fragment.occupiedWidth - flow.items[fragment.itemIndex]!.extraWidth
    if (textWidth <= 0) continue
    const part = Math.min(hang, textWidth)
    fragment.occupiedWidth -= part
    hang -= part
  }
}

function stepRichInlineLine(
  flow: InternalPreparedRichInline,
  maxWidth: number,
  cursor: RichInlineCursor,
  // The line's fragments go here, unless it is null.
  fragments: RichInlineFragmentRange[] | null,
): number | null {
  const safeWidth = Math.max(1, maxWidth)
  const { hangTabs, hardBreakItemRetreat, lineFitEpsilon, paddedOpeningFit, spaceBeforeSoftHyphenHangs, unfitHyphenRetreat } = getEngineProfile()
  let hasContent = false
  let lineWidth = 0
  let remainingWidth = safeWidth
  // The width of the run of preserved spaces and tabs the line ends with, which hangs past
  // its end (ItemLine).
  let lineHangWidth = 0
  // Whether the line ends at a hard break.
  let endsAtHardBreak = false
  // The width of the run of U+3000 that ends the line's last item, where the item fits only
  // without it, so its walk left it out (endHangs). Blink and Gecko take such a run as the
  // line's trailing white space, which takes its room before whatever follows: Blink's line
  // is then trailing, and ends before the next item that isn't white space (HandleTrailingSpaces,
  // line_breaker.cc:2447-2456 and 2518-2533, and :1099-1105 before an atomic inline, Chromium
  // 153), and Gecko trims a text frame's trailing white space from its width only where the
  // frame itself breaks, so the next frame starts after it (nsTextFrame.cpp:11202-11214,
  // Firefox 156). So where the line goes on to another item, the run counts, as white space
  // the line ends with, which hangs (lineHangWidth): in 16px Hiragino Sans, Chrome 154 and
  // Firefox 156 end the first line of `文字\u3000` and a span `i` after the run at 36-47px,
  // where `i` would fit after `文字`. At the paragraph's end it stays out, as in one text.
  // Chrome ends that line whatever the next item starts with, where a line here returns to its
  // latest break if no break comes before that item (ENGINE_FOLLOWUPS.md). A closing mark
  // Blink halts at an item's end stays halted, and the line goes on from there: Chrome lays
  // out `文字」` and a span `i` in one 43.81px line at 44-47px, where one text node takes two.
  let endHang = 0
  let itemIndex = cursor.itemIndex
  // The line's latest break before the item where no break comes before the item, where
  // a line that can't take the item's start ends, as the flat walker returns to its last
  // break: the item it falls in (-1 without one), where in that item, the line's width
  // there, the fragments the line keeps and the last one's occupied width, and whether
  // a return from an unfit soft hyphen can end the line there. Where a break comes before
  // the item, the line ends there.
  let breakItemIndex = -1
  let breakSegmentIndex = 0
  let breakGraphemeIndex = 0
  let breakLineWidth = 0
  let breakFragmentCount = 0
  let breakOccupiedWidth = 0
  let breakHangWidth = 0
  let breakFits = false
  let returnsToBreak = false
  // Whether an item a line start consumes followed content on the line (below).
  let consumedAfterContent = false
  // Where the walk of an item ends its part of the line (below), one for every walk.
  const lineEnd: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

  // A line that starts at an item's end, as after a hard break that ends it, starts at the next item.
  const firstItem = flow.items[itemIndex]
  if (firstItem !== undefined && cursor.segmentIndex === firstItem.prepared.segments.length && cursor.graphemeIndex === 0) {
    itemIndex++
    cursor.segmentIndex = 0
  }
  // Where the line starts, which a return to the last grapheme of its text can't pass.
  const startItemIndex = itemIndex
  const startSegmentIndex = cursor.segmentIndex
  const startGraphemeIndex = cursor.graphemeIndex
  // A line that starts inside the preserved spaces that end an item, after those the line before
  // kept (getEndRetreat), takes the rest of them, which hang, and goes on at the next item.
  if (firstItem !== undefined && cursor.graphemeIndex > 0 && cursor.segmentIndex === firstItem.lineData.segmentFlags.length - 1 &&
    (firstItem.lineData.segmentFlags[cursor.segmentIndex]! & KIND_BITS) === PRESERVED_SPACE) {
    const rest = (firstItem.prepared.segments[cursor.segmentIndex]!.length - cursor.graphemeIndex) * getSpaceAdvance(firstItem.lineData, cursor.segmentIndex)
    collectItemRest(fragments, itemIndex, firstItem, cursor, 0, -1, rest + firstItem.extraWidth)
    hasContent = true
    lineWidth = rest + firstItem.extraWidth
    remainingWidth = safeWidth - lineWidth
    lineHangWidth = rest
    itemIndex++
    cursor.segmentIndex = 0
    cursor.graphemeIndex = 0
  }
  // Every `continue` moves on to the start of the next item.
  for (; itemIndex < flow.items.length; itemIndex++, cursor.segmentIndex = 0, cursor.graphemeIndex = 0) {
    const item = flow.items[itemIndex]
    if (item === undefined) continue
    // The run takes its room (endHang) before an item that takes part in the line, or that the
    // line can end before (below), in its own item's fragment: the last one of an item that
    // isn't one a line start consumes.
    if (endHang > 0 && (item.establishesLine || item.walked || item.continued)) {
      lineWidth += endHang
      remainingWidth = safeWidth - lineWidth
      lineHangWidth = endHang
      if (fragments !== null) {
        let k = fragments.length - 1
        while (!flow.items[fragments[k]!.itemIndex]!.establishesLine) k--
        fragments[k]!.occupiedWidth += endHang
      }
      endHang = 0
    }

    // The line can end before a continued item that follows a break, as the run the next
    // item continues can move to the next line, and, where it has no break yet, before one that
    // a line that can't fit the next item's padding ends before (retreatsBefore).
    if (item.continued && hasContent && (item.breakBefore || (breakItemIndex < 0 && hardBreakItemRetreat !== 'item' && retreatsBefore(flow, itemIndex)))) {
      breakItemIndex = itemIndex
      breakSegmentIndex = 0
      breakGraphemeIndex = 0
      breakLineWidth = lineWidth
      breakHangWidth = lineHangWidth
      breakFragmentCount = fragments === null ? 0 : fragments.length
      breakFits = fitsBreakBefore(item, lineWidth - lineHangWidth, safeWidth + lineFitEpsilon, unfitHyphenRetreat)
    }

    const gapBefore = hasContent ? item.gapBefore : 0
    const gapItemIndex = hasContent ? item.gapItemIndex : -1

    // Retain inactive source items in the original coordinate space without
    // turning their mere presence into a line. A following line can still
    // expose their consumed source. After content, the line keeps the collapsed
    // space before such an item, as the flat text keeps a space before a soft
    // hyphen: content after it on the line pays for it, a line that ends after the
    // item can hang it (below), and it ends no line, as the item takes no room after it.
    // One that holds white space between its soft hyphens is walked there (below).
    if (!item.establishesLine && !(hasContent && item.walked)) {
      collectItemRest(fragments, itemIndex, item, cursor, gapBefore, gapItemIndex, 0)
      if (hasContent) consumedAfterContent = true
      lineWidth += gapBefore
      remainingWidth = safeWidth - lineWidth
      lineHangWidth = 0
      continue
    }
    const atItemStart = isLineStartCursor(cursor)

    if (item.break === 'never') {
      if (!atItemStart) continue

      const occupiedWidth = item.naturalWidth + item.extraWidth
      const totalWidth = gapBefore + occupiedWidth
      // Gecko places an empty frame wherever it falls (CanPlaceFrame, which 'both' ports), where
      // Blink and WebKit move an atomic item of width 0 to the next line as any other.
      if (hasContent && totalWidth > remainingWidth + lineFitEpsilon && !(paddedOpeningFit === 'both' && occupiedWidth === 0)) break

      collectItemRest(fragments, itemIndex, item, EMPTY_LAYOUT_CURSOR, gapBefore, gapItemIndex, occupiedWidth)
      hasContent = true
      lineWidth += totalWidth
      remainingWidth = safeWidth - lineWidth
      lineHangWidth = 0
      continue
    }

    // Every fit check here, including the line walker's, allows its fit epsilon. The line
    // ends before an item whose reserved width doesn't fit, even where it reserves none
    // after a line that overflows, but for an item a line start consumes: its soft hyphen
    // follows the line's content, where the walk ends the line, as in one text. Firefox
    // ends the third line of items `see`, `\u00AD \u00AD`, `this word` in 16px Arial at
    // 1px after `e` and the first soft hyphen's hyphen. No break comes right before a hard
    // break (UAX #14 LB6), so where none comes before the item either, as after collapsed
    // white space, a line keeps an item that starts with one where it reserves nothing for
    // it. Where the item's padding doesn't fit, as the engine fits it there (fitsOpening), the
    // line returns to its latest break, as the three engines do, else it ends before the item
    // in Blink and before the end of the text before it in WebKit and Gecko, which keep the item
    // on a line that end starts (hardBreakItemRetreat, getEndRetreat): the line records a break
    // before an item that is one grapheme (retreatsBefore, above), and an atomic item is one
    // whole, before which the line's break is its own. Preserved spaces or tabs that hang go on
    // the run the line ends with, so the reserved width of an item that starts with them fits
    // where the line's content before that run fits, as WebKit fits a box's edge
    // (InlineContentBreaker, hangingContentWidth), though WebKit leaves out only the last
    // white-space item's (ENGINE_FOLLOWUPS.md).
    const reservedWidth = gapBefore + item.extraWidth
    if (hasContent && reservedWidth > remainingWidth + lineFitEpsilon && (item.establishesLine || reservedWidth > 0) &&
      !fitsOpening(flow, itemIndex, lineWidth, lineHangWidth, safeWidth + lineFitEpsilon, paddedOpeningFit, startItemIndex, startSegmentIndex)) {
      const firstKind = item.lineData.segmentFlags[0]! & KIND_BITS
      let keepsHardBreak = firstKind === HARD_BREAK && !item.breakBefore && reservedWidth <= 0
      if (firstKind === HARD_BREAK && !item.breakBefore && !keepsHardBreak && breakItemIndex < 0 && hardBreakItemRetreat !== 'item') {
        // The line's text ends with the item before, which the line takes to its end.
        let contentItemIndex = itemIndex - 1
        while (flow.items[contentItemIndex] === undefined) contentItemIndex--
        const contentItem = flow.items[contentItemIndex]!
        const fromLineStart = contentItemIndex === startItemIndex
        const retreat = contentItem.establishesLine
          ? getEndRetreat(contentItem, fromLineStart ? startSegmentIndex : 0, fromLineStart ? startGraphemeIndex : 0, lineWidth - safeWidth - lineFitEpsilon, hardBreakItemRetreat === 'fit', lineEnd)
          : null
        if (retreat === null) {
          keepsHardBreak = true
        } else {
          // The spaces the line keeps at its end hang.
          breakItemIndex = contentItemIndex
          breakSegmentIndex = lineEnd.segmentIndex
          breakGraphemeIndex = lineEnd.graphemeIndex
          breakLineWidth = lineWidth - retreat
          breakHangWidth = Math.max(0, lineHangWidth - retreat)
          breakFragmentCount = fragments === null ? 0 : fragments.length
          breakOccupiedWidth = fragments === null ? 0 : fragments[breakFragmentCount - 1]!.occupiedWidth - retreat
        }
      }
      const hangs = (firstKind === PRESERVED_SPACE || (firstKind === TAB && hangTabs)) && reservedWidth <= remainingWidth + lineHangWidth + lineFitEpsilon
      if (!keepsHardBreak && !hangs) {
        returnsToBreak = !item.breakBefore
        break
      }
    }

    if (atItemStart && !item.walked) {
      const totalWidth = reservedWidth + item.naturalWidth
      if (totalWidth <= remainingWidth + lineFitEpsilon) {
        collectItemRest(fragments, itemIndex, item, EMPTY_LAYOUT_CURSOR, gapBefore, gapItemIndex, item.naturalWidth + item.extraWidth)
        hasContent = true
        lineWidth += totalWidth
        remainingWidth = safeWidth - lineWidth
        lineHangWidth = item.hangWidth
        continue
      }
    }

    // The walk continues the line's content, where it has some, and ends before the
    // item where it can't take the item's start and the line has a break there or
    // earlier. A return from an unfit soft hyphen ends the line at the break before the
    // item where that line fits, with room for the hyphen in Blink's retry, or with the
    // hyphen where the break follows one. A walk after content that can't take the
    // item's first segment ends the line before the item (firstSegmentOverflows), so that
    // line ends here without one.
    if (hasContent && firstSegmentOverflows(item, remainingWidth - reservedWidth + lineFitEpsilon)) {
      returnsToBreak = !item.breakBefore
      break
    }
    lineEnd.segmentIndex = cursor.segmentIndex
    lineEnd.graphemeIndex = cursor.graphemeIndex
    // A line start consumes the rest of the item, such as a soft hyphen, and a line
    // that starts at zero-width glue keeps it without taking it as content. A ZWSP that
    // the joined text breaks after at the item's start, where the item's own text doesn't,
    // follows text, so a line start consumes it too, where the item's own ZWSP there holds
    // the line. A soft hyphen that the joined text makes a discarded break there is one
    // Firefox drops, which the line start goes on past (normalizeItemLineStart). A line feed
    // after the carriage return that ended the line, in the item before, is that line's end.
    // The line's first fragment starts after what the start consumes, as a flat line does:
    // the browsers remove collapsible spaces at a line's start, whichever line takes them
    // (CSS Text 3 §4.1.2; Blink's line_breaker.cc:1337-1352, Chromium 153), as where the
    // line before ended before its space under negative letter spacing (ENGINE_FOLLOWUPS.md).
    if (!hasContent) {
      if (atItemStart && (item.lineFeedAfterReturn || (
        (item.lineData.segmentFlags[0]! & KIND_BITS) === ZERO_WIDTH_BREAK && (item.prepared.segmentFlags[0]! & KIND_BITS) !== ZERO_WIDTH_BREAK && !isDiscardedBreak(item.lineData, 0)
      ))) lineEnd.segmentIndex = 1
      if (!normalizeItemLineStart(item.lineData, lineEnd)) continue
      cursor.segmentIndex = lineEnd.segmentIndex
      cursor.graphemeIndex = lineEnd.graphemeIndex
    }
    itemLine.continues = hasContent
    itemLine.breakBefore = hasContent && (item.breakBefore || breakItemIndex >= 0)
    // An engine that keeps an unfit hyphen returns only to a break before a run that
    // continues from an earlier item.
    itemLine.fitsBreakBefore = hasContent && (item.breakBefore
      ? unfitHyphenRetreat !== 'none' && fitsBreakBefore(item, lineWidth - lineHangWidth, safeWidth + lineFitEpsilon, unfitHyphenRetreat)
      : breakFits)
    itemLine.innerBreaks = item.innerBreaks
    // The item's text starts after its gap and its start edge, which every fragment paints, as
    // its extraWidth counts on each (box-decoration-break: clone): half its extraWidth, which
    // isn't split by side (ENGINE_FOLLOWUPS.md).
    itemLine.lineOffset = lineWidth + gapBefore + item.extraWidth / 2
    itemLine.breakSegmentIndex = -1
    itemLine.breakGraphemeIndex = 0
    itemLine.hangWidth = lineHangWidth
    // An opening the line keeps (fitsOpening) goes on however far the line overflows: its white
    // space hangs and its hard break ends the line.
    const availableWidth = !hasContent ? Math.max(1, remainingWidth - reservedWidth)
      : fitsOpening(flow, itemIndex, lineWidth, lineHangWidth, safeWidth + lineFitEpsilon, paddedOpeningFit, startItemIndex, startSegmentIndex)
        ? Math.max(0, remainingWidth - reservedWidth) : remainingWidth - reservedWidth
    const lineWidthForItem = stepPreparedLineGeometryFromStart(item.lineData, lineEnd, availableWidth, itemLine)
    if (lineWidthForItem === null) {
      collectItemRest(fragments, itemIndex, item, cursor, 0, -1, 0)
      continue
    }
    if (
      cursor.segmentIndex === lineEnd.segmentIndex &&
      cursor.graphemeIndex === lineEnd.graphemeIndex
    ) {
      if (!hasContent) continue
      returnsToBreak = !item.breakBefore
      break
    }

    const itemOccupiedWidth = lineWidthForItem + item.extraWidth
    const lineWidthBefore = lineWidth
    if (!item.establishesLine) consumedAfterContent = true
    fragments?.push({
      itemIndex,
      gapBefore,
      gapItemIndex,
      occupiedWidth: itemOccupiedWidth,
      start: cloneCursor(cursor),
      end: { segmentIndex: lineEnd.segmentIndex, graphemeIndex: lineEnd.graphemeIndex },
    })
    hasContent = true
    lineWidth += gapBefore + itemOccupiedWidth
    remainingWidth = safeWidth - lineWidth
    lineHangWidth = itemLine.hangWidth

    // A line that takes the item's end goes on, unless a hard break ends it there,
    // from the latest break the walk leaves, whose width leaves out what hangs there. A break
    // the walk leaves at the item's end, after its preserved spaces, is the next item's, which
    // the text the items join gives or not (breakBefore).
    const segmentCount = item.prepared.segments.length
    const endsAfterHardBreak = lineEnd.graphemeIndex === 0 && lineEnd.segmentIndex > 0 &&
      (item.prepared.segmentFlags[lineEnd.segmentIndex - 1]! & KIND_BITS) === HARD_BREAK
    if (lineEnd.segmentIndex === segmentCount && lineEnd.graphemeIndex === 0 && !endsAfterHardBreak) {
      if ((itemLine.breakSegmentIndex > cursor.segmentIndex || itemLine.breakGraphemeIndex > 0) && itemLine.breakSegmentIndex < segmentCount) {
        breakItemIndex = itemIndex
        breakSegmentIndex = itemLine.breakSegmentIndex
        breakGraphemeIndex = itemLine.breakGraphemeIndex
        breakOccupiedWidth = itemLine.breakWidth + item.extraWidth
        breakLineWidth = lineWidthBefore + (gapBefore + breakOccupiedWidth)
        breakHangWidth = itemLine.breakHangWidth
        breakFragmentCount = fragments === null ? 0 : fragments.length
        breakFits = breakLineWidth - breakHangWidth + (
          isDiscretionaryLineEnd(item.lineData.segmentFlags, breakSegmentIndex, breakGraphemeIndex) ? 0 : getHyphenRoom(item, unfitHyphenRetreat)
        ) <= safeWidth + lineFitEpsilon
      }
      if (item.endHangs) endHang = itemLine.endTrim
      continue
    }

    endsAtHardBreak = endsAfterHardBreak
    cursor.segmentIndex = lineEnd.segmentIndex
    cursor.graphemeIndex = lineEnd.graphemeIndex
    break
  }

  if (returnsToBreak && breakItemIndex >= 0) {
    itemIndex = breakItemIndex
    lineWidth = breakLineWidth
    lineHangWidth = breakHangWidth
    cursor.segmentIndex = breakSegmentIndex
    cursor.graphemeIndex = breakGraphemeIndex
    if (fragments !== null) {
      fragments.length = breakFragmentCount
      if (breakSegmentIndex > 0 || breakGraphemeIndex > 0) {
        const fragment = fragments[breakFragmentCount - 1]!
        fragment.occupiedWidth = breakOccupiedWidth
        fragment.end = { segmentIndex: breakSegmentIndex, graphemeIndex: breakGraphemeIndex }
      }
    }
  }
  if (!hasContent) return null

  // The run of preserved spaces and tabs the line ends with hangs past its end, across its
  // items, as white space in one text does (CSS Text 3 §4.1.2): all of it where the line
  // wraps, and before a hard break or at the paragraph's end only what doesn't fit (§8.2).
  // Blink walks back over item results for it (ComputeTrailingSpaceWidth, line_info.cc:
  // 289-415), WebKit exempts each white-space item's hanging width from the fit
  // (InlineContentBreaker) and Gecko each frame's trailing white space past the available
  // width (nsTextFrame.cpp:11214-11229). The line's fragments leave out what hangs.
  if (lineHangWidth > 0) {
    const hangStart = lineWidth - lineHangWidth
    const width = endsAtHardBreak || itemIndex >= flow.items.length ? Math.max(hangStart, Math.min(lineWidth, safeWidth)) : hangStart
    if (fragments !== null) hangTrailingFragments(flow, fragments, lineWidth - width)
    lineWidth = width
  }

  // A line that ends after items a line start consumes, after its content, can end at the
  // collapsed spaces before them, which then hang, as white space that ends a line does
  // (CSS Text 3 §4.1.2): the browsers break at a space before a soft hyphen and move the
  // soft hyphen to the next line. Where the engine keeps the soft hyphen on the line
  // (EngineProfile), the spaces take room, and so they do where the line ends at the soft
  // hyphen with its hyphen: where the item after it breaks before it and would paint a
  // hyphen that fits, which rich-inline leaves out (ENGINE_FOLLOWUPS.md).
  if (consumedAfterContent && cursor.segmentIndex === 0 && cursor.graphemeIndex === 0) {
    const next = flow.items[itemIndex]
    if (spaceBeforeSoftHyphenHangs === 'line-end' || (
      next !== undefined &&
      (spaceBeforeSoftHyphenHangs === 'break' || next.gapItemIndex < 0) &&
      !(next.breakBefore && next.hyphenBefore > 0 && lineWidth + next.hyphenBefore <= safeWidth + lineFitEpsilon)
    )) {
      let fragmentCount = fragments === null ? 0 : fragments.length
      for (let i = itemIndex - 1; i >= 0; i--) {
        const item = flow.items[i]
        if (item === undefined) continue
        if (item.establishesLine) break
        // WebKit keeps the soft hyphen before white space in the item, and the space
        // before that soft hyphen, so only that white space hangs.
        const keepsGap = spaceBeforeSoftHyphenHangs === 'own-break' && item.walked
        lineWidth -= (keepsGap ? 0 : item.gapBefore) + item.naturalWidth
        if (fragments !== null) {
          const fragment = fragments[--fragmentCount]!
          if (!keepsGap) {
            fragment.gapBefore = 0
            fragment.gapItemIndex = -1
          }
          fragment.occupiedWidth -= item.naturalWidth
        }
      }
    }
  }

  cursor.itemIndex = itemIndex
  return lineWidth
}

// A line of the paragraph's only item (onlyItem) as stepRichInlineLine() gives it, from
// the text walkers' line: one fragment, and the cursor after the item where the line
// ends with it.
function createOnlyItemLine(
  item: PreparedRichInlineItem,
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): RichInlineLineRange {
  const ended = endSegmentIndex === item.prepared.segments.length
  return {
    fragments: [{
      itemIndex: 0,
      gapBefore: 0,
      gapItemIndex: -1,
      occupiedWidth: width,
      start: { segmentIndex: startSegmentIndex, graphemeIndex: startGraphemeIndex },
      end: { segmentIndex: endSegmentIndex, graphemeIndex: endGraphemeIndex },
    }],
    width: Math.max(0, width),
    end: { itemIndex: ended ? 1 : 0, segmentIndex: ended ? 0 : endSegmentIndex, graphemeIndex: endGraphemeIndex },
  }
}

// Whether a line from the only item's start takes all of it, as stepRichInlineLine()
// takes an item that fits whole: Blink takes a text item whole where its shaped width
// fits (ShapingLineBreaker::ShapeLine, shaping_line_breaker.cc:281-297, Chromium 153),
// even where negative advances bring the width back under the line's after a break
// that overflows, where the text walkers end the line. WebKit fits each run between
// breaks in turn (TextOnlySimpleLineBuilder.cpp:318, InlineLineBuilder.cpp:1585), and
// ends the line there (ENGINE_FOLLOWUPS.md).
function onlyItemFits(item: PreparedRichInlineItem, safeWidth: number): boolean {
  return item.naturalWidth <= safeWidth + getEngineProfile().lineFitEpsilon
}

export function layoutNextRichInlineLineRange(
  prepared: PreparedRichInline,
  maxWidth: number,
  start: RichInlineCursor = RICH_INLINE_START_CURSOR,
): RichInlineLineRange | null {
  const flow = getInternalPreparedRichInline(prepared)
  const only = flow.onlyItem
  if (only !== null && start.itemIndex === 0) {
    const safeWidth = Math.max(1, maxWidth)
    if (isLineStartCursor(start) && onlyItemFits(only, safeWidth)) return createOnlyItemLine(only, only.naturalWidth, 0, 0, only.prepared.segments.length, 0)
    const lineEnd = { segmentIndex: start.segmentIndex, graphemeIndex: start.graphemeIndex }
    if (!normalizePreparedLineStart(only.prepared, lineEnd)) return null
    const startSegmentIndex = lineEnd.segmentIndex
    const startGraphemeIndex = lineEnd.graphemeIndex
    const width = stepPreparedLineGeometryFromStart(only.prepared, lineEnd, safeWidth)
    return width === null ? null : createOnlyItemLine(only, width, startSegmentIndex, startGraphemeIndex, lineEnd.segmentIndex, lineEnd.graphemeIndex)
  }
  const end: RichInlineCursor = {
    itemIndex: start.itemIndex,
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const fragments: RichInlineFragmentRange[] = []
  const width = stepRichInlineLine(flow, maxWidth, end, fragments)
  if (width === null) return null

  // As in the text line APIs, only the reported width is clamped at zero;
  // fitting keeps each item's signed advance.
  return {
    fragments,
    width: Math.max(0, width),
    end,
  }
}

function materializeFragmentText(
  item: PreparedRichInlineItem,
  fragment: RichInlineFragmentRange,
): string {
  return buildLineTextFromRange(
    item.prepared,
    fragment.start.segmentIndex,
    fragment.start.graphemeIndex,
    fragment.end.segmentIndex,
    fragment.end.graphemeIndex,
    item.lineData.segmentFlags,
  )
}

// Bridge from cheap range walking to full fragment text. Lets callers do
// shrinkwrap/virtualization/probing work first, then only pay for text on the
// lines they actually render.
export function materializeRichInlineLineRange(
  prepared: PreparedRichInline,
  line: RichInlineLineRange,
): RichInlineLine {
  const flow = getInternalPreparedRichInline(prepared)
  const fragments: RichInlineFragment[] = []

  for (let i = 0; i < line.fragments.length; i++) {
    const fragment = line.fragments[i]!
    const item = flow.items[fragment.itemIndex]
    if (item === undefined) throw new Error('Missing rich-text inline item for fragment')
    fragments.push({
      itemIndex: fragment.itemIndex,
      text: materializeFragmentText(item, fragment),
      gapBefore: fragment.gapBefore,
      gapItemIndex: fragment.gapItemIndex,
      occupiedWidth: fragment.occupiedWidth,
      start: fragment.start,
      end: fragment.end,
    })
  }

  return {
    fragments,
    width: line.width,
    end: line.end,
  }
}

export function walkRichInlineLineRanges(
  prepared: PreparedRichInline,
  maxWidth: number,
  onLine: (line: RichInlineLineRange) => void,
): number {
  const only = getInternalPreparedRichInline(prepared).onlyItem
  if (only !== null) {
    const safeWidth = Math.max(1, maxWidth)
    if (onlyItemFits(only, safeWidth)) {
      onLine(createOnlyItemLine(only, only.naturalWidth, 0, 0, only.prepared.segments.length, 0))
      return 1
    }
    return walkPreparedLinesRaw(only.prepared, safeWidth, (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
      onLine(createOnlyItemLine(only, width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex))
    })
  }
  let lineCount = 0
  const cursor = { ...RICH_INLINE_START_CURSOR }

  while (true) {
    const line = layoutNextRichInlineLineRange(prepared, maxWidth, cursor)
    if (line === null) return lineCount
    cursor.itemIndex = line.end.itemIndex
    cursor.segmentIndex = line.end.segmentIndex
    cursor.graphemeIndex = line.end.graphemeIndex
    onLine(line)
    lineCount++
  }
}

export function measureRichInlineStats(
  prepared: PreparedRichInline,
  maxWidth: number,
): RichInlineStats {
  const flow = getInternalPreparedRichInline(prepared)
  const only = flow.onlyItem
  if (only !== null) {
    const safeWidth = Math.max(1, maxWidth)
    if (onlyItemFits(only, safeWidth)) return { lineCount: 1, maxLineWidth: Math.max(0, only.naturalWidth) }
    const stats = { lineCount: 0, maxLineWidth: 0 }
    walkPreparedLinesRaw(only.prepared, safeWidth, undefined, stats)
    return stats
  }
  let lineCount = 0
  let maxLineWidth = 0
  const cursor: RichInlineCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  }

  while (true) {
    const lineWidth = stepRichInlineLine(flow, maxWidth, cursor, null)
    if (lineWidth === null) {
      return {
        lineCount,
        maxLineWidth,
      }
    }
    lineCount++
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
  }
}
