import type { LayoutCursor, WordBreakMode } from './layout.js'
import {
  alignToSource,
  analyzeText,
  isCollapsibleSpaceCode,
  HARD_BREAK,
  KIND_BITS,
  OBJECT,
  PRESERVED_SPACE,
  RETURNABLE,
  SOFT_HYPHEN,
  SPACE,
  SPACED,
  STARTS_ITEM,
  TAB,
  TEXT,
  UNBROKEN,
  type ParagraphItems,
  type TextAnalysis,
  type WhiteSpaceMode,
} from './analysis.js'
import { getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'
import { buildLineTextFromRange, getGraphemeEnds, type PreparedSegments } from './line-text.js'
import {
  getItemTabAdvance,
  normalizePreparedLineStart,
  stepPreparedLineGeometryFromStart,
  walkPreparedLinesRaw,
} from './line-break.js'
import { getEngineProfile, getFontMeasurement, getPreparationLanguage, getTextWidth, readLetterSpacing, zeros, type EngineProfile } from './measurement.js'
import { measureAnalysis } from './prepare.js'

// Helper for rich-text inline flow under `white-space: normal` or `pre-wrap`: one paragraph's text
// broken across its items, as a browser lays out the text of an inline formatting context across
// its spans. The items' texts join into the paragraph's text, an atomic item or a box as one
// U+FFFC, which is analyzed once, as prepare() analyzes a text, with a segment starting wherever an
// item does. Each item's segments are measured in its font, and the text walkers lay the paragraph
// out. So:
// - white space collapses across item boundaries, and under pre-wrap preserved spaces hang
//   across them, tab stops count from the line's start, and hard breaks end lines
// - break opportunities across item boundaries are the engine's: from the text the items join in
//   Blink and Gecko, and in WebKit from each item's own text and the last two characters before
//   it, under the paragraph's word-break; a run that continues across items wraps together
// - atomic inline boxes like pills, and boxes the app sizes and paints, such as images, are one
//   segment each, which a line can break before and after
// - an item's extra horizontal chrome, such as padding and borders, is part of its width on
//   every line the item reaches
// A line's fragments are its segments cut where the item changes.

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

// A place in the paragraph: an item, and a segment and grapheme of that item's part of the
// paragraph's text. What a line or a fragment gives is for passing back; a fragment's place in its
// item's text is its sourceStart and sourceEnd.
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
  start: LayoutCursor // Start cursor within the item's part of the paragraph
  end: LayoutCursor // End cursor within the item's part of the paragraph
  sourceStart: number // Where the fragment starts in its item's `text`, in UTF-16 units
  sourceEnd: number // Where it ends there
}

export type RichInlineFragmentRange = {
  itemIndex: number // Index into the items prepareRichInline() took
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  gapItemIndex: number // Item whose collapsed whitespace made gapBefore, or -1 when no gap precedes this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's part of the paragraph
  end: LayoutCursor // End cursor within the item's part of the paragraph
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
  // The paragraph's handle, which the text walkers lay out. A paragraph of one text item with no
  // extraWidth is that text's own handle, as prepareWithSegments() makes it. Its letterSpacing is
  // the one its text items share, atomic ones aside; where they differ it is 0, and each segment's
  // width and advances hold its item's letter spacing after every grapheme.
  data: PreparedSegments
  // The only item with segments, where it has no extraWidth, so that every line is one fragment
  // of it, as wide as the line; else -1.
  onlyItem: number
  // The paragraph's line where nothing wraps it, which is its only one at any width it fits:
  // its width, null where it has no line or several, as with a hard break, and its start and end
  // segments (findWholeLine).
  wholeWidth: number | null
  wholeStart: number
  wholeEnd: number
  // Per item, its first segment in the paragraph, then the segment count: an item's segments are
  // those up to the next item's first.
  itemSegments: number[]
  // Per segment, where its text starts and ends in its item's text, and, for a segment whose text
  // isn't one stretch of its item's, as where white space inside it was removed, where each of
  // its units is there, else null (null too where no segment has any). A paragraph of one text
  // item finds them when a line is first materialized, from `text`, the item's.
  sourceStarts: number[] | null
  sourceEnds: number[] | null
  sourceUnits: (number[] | null)[] | null
  text: string
}

const RICH_INLINE_START_CURSOR: RichInlineCursor = {
  itemIndex: 0,
  segmentIndex: 0,
  graphemeIndex: 0,
}

function getInternalPreparedRichInline(prepared: PreparedRichInline): InternalPreparedRichInline {
  return prepared as InternalPreparedRichInline
}

// Segments [from, to) of an analysis as an analysis of their own, for an item's measurement: an
// item is measured alone, in its font (RESEARCH.md, Rich Inline Boundaries).
function sliceAnalysis(analysis: TextAnalysis, from: number, to: number): TextAnalysis {
  const count = analysis.flags.length
  if (from === 0 && to === count) return analysis
  const start = analysis.starts[from]!
  const end = to < count ? analysis.starts[to]! : analysis.normalized.length
  const starts: number[] = []
  for (let i = from; i < to; i++) starts.push(analysis.starts[i]! - start)
  return {
    normalized: analysis.normalized.slice(start, end),
    spaceSources: analysis.spaceSources === null ? null : analysis.spaceSources.subarray(start, end),
    texts: analysis.texts.slice(from, to),
    starts,
    flags: analysis.flags.slice(from, to),
    hasUnbroken: analysis.hasUnbroken,
  }
}

// Whether a text holds anything but collapsible white space.
function hasContent(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isCollapsibleSpaceCode(text.charCodeAt(i))) return true
  return false
}

export function prepareRichInline(items: Array<RichInlineItem | RichInlineBox>, options?: RichInlineOptions): PreparedRichInline {
  const whiteSpace = options?.whiteSpace ?? 'normal'
  const wordBreak = options?.wordBreak ?? 'normal'
  const preserve = whiteSpace === 'pre-wrap'
  // One language read for the paragraph's analysis and every item's measurement.
  const profile = getEngineProfile()
  const language = getPreparationLanguage(profile)

  // A paragraph of one styled run is the most common one, and is that run's text: its handle is
  // the one prepareWithSegments() makes, laid out as layout()'s walkers lay it out.
  const only = items.length === 1 ? items[0]! : undefined
  if (only !== undefined && only.text !== undefined && only.break !== 'never' && (only.extraWidth ?? 0) === 0) {
    const analysis = analyzeText(only.text, profile, whiteSpace, wordBreak, language)
    const data = measureAnalysis(analysis, only.font, true, readLetterSpacing(only.letterSpacing), profile, language, true) as PreparedSegments
    return findWholeLine({ data, onlyItem: 0, wholeWidth: null, wholeStart: 0, wholeEnd: 0, itemSegments: [0, data.segmentFlags.length], sourceStarts: null, sourceEnds: null, sourceUnits: null, text: only.text } as InternalPreparedRichInline)
  }

  // The paragraph's text: the items' texts joined, an atomic item or a box as one U+FFFC. An atomic
  // item's own white space is none of the paragraph's: its inline-block lays its text out as a
  // paragraph of its own, whose lines drop white space at their start and end. Blink puts the box in
  // the outer paragraph as one U+FFFC (inline_node.cc:408-422) and removes its own paragraph's
  // leading and trailing spaces (inline_items_builder.cc:869-871, ExitBlock at 1622-1629); WebKit's
  // atomic inline box is one item of the outer line (InlineItemsBuilder.cpp:1073-1074), and its own
  // lines collapse leading white space (Line::appendText, InlineLine.cpp:348-373) and remove
  // trailing (InlineLineBuilder.cpp:646); Gecko's text run stops at the box
  // (BuildTextRunsScanner::ScanFrame, nsTextFrame.cpp:2248-2254), and its own lines skip leading
  // white space (nsTextFrame.cpp:10935-10944) and trim trailing (nsBlockFrame.cpp:5844). An atomic
  // item of only white space is no object: in normal white space it is that white space.
  let source = ''
  const starts: number[] = []
  const atomic: boolean[] = []
  // Whether an item is an object or has extraWidth, so that a line of it alone isn't its text's.
  let paddedOrObject = false
  // The letter spacing the text items that aren't atomic share, and whether two of them differ: the
  // walkers take one for the handle, so where items differ, each segment's width holds its own.
  let sharedSpacing: number | null = null
  let spacingsDiffer = false
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    starts.push(source.length)
    if (item.text === undefined) {
      // A width that isn't finite would give lines of width NaN or Infinity, and Chrome breaks lines
      // around a negative one otherwise than a negative extraWidth does (RESEARCH.md, Objects Inside
      // A Line), so Pretext refuses both.
      if (!Number.isFinite(item.width) || item.width < 0) throw new RangeError(`Item ${index} has no text, so it's a box, whose width must be a finite number of CSS px, at least 0, not ${item.width}`)
      atomic.push(true)
      source += '\uFFFC'
      paddedOrObject = true
      continue
    }
    const isAtomic = item.break === 'never' && hasContent(item.text)
    atomic.push(isAtomic)
    if (isAtomic) {
      source += '\uFFFC'
    } else if (item.break !== 'never' || !preserve) {
      source += item.text
      if (item.text !== '') {
        const letterSpacing = readLetterSpacing(item.letterSpacing)
        if (sharedSpacing !== null && sharedSpacing !== letterSpacing) spacingsDiffer = true
        sharedSpacing ??= letterSpacing
      }
    }
    if (isAtomic || (item.extraWidth ?? 0) !== 0) paddedOrObject = true
  }
  const paragraph: ParagraphItems = { starts, atomic, ownSegmentBreaks: !profile.transformsSegmentBreaksAcrossItems, sourceOffsets: null }
  const analysis = analyzeText(source, profile, whiteSpace, wordBreak, language, paragraph)
  const offsets = paragraph.sourceOffsets!
  const count = analysis.flags.length

  const widths: number[] = []
  const flags: number[] = []
  const segments: string[] = []
  const breakableFitAdvances: (number[] | null)[] = []
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  let sourceUnits: (number[] | null)[] | null = null
  const itemSegments: number[] = []
  // What only some segments have, each made at the first one that does (setAt).
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let lineStartProhibitions: (number[] | null)[] | null = null
  let lineStartExtras: number[] | null = null
  let lineEndTrims: number[] | null = null
  let overflowLineEndTrims: number[] | null = null
  let discretionaryHyphenContexts: number[] | null = null
  // Whether a line returns from a soft hyphen whose hyphen doesn't fit, which the walker does on a
  // handle with soft-hyphen contexts: where an item's measurement made some, and, where the engine
  // keeps an unfit hyphen in one text, where a run can reach a soft hyphen across items, as the
  // line then returns to the break before that run (returnsFromUnfitHyphen in src/line-break.ts).
  let retreatsFromUnfitHyphen = profile.unfitHyphenRetreat === 'none' && source.includes('\u00AD')
  let insideExtras: number[] | null = null
  let fillExtras: number[] | null = null
  // Each text item's hyphen width and tab stop advance, and whether two items differ in one.
  const hyphenWidths: number[] = zeros(items.length)
  const tabStopAdvances: number[] = zeros(items.length)
  let firstTextItem = -1
  let fontsDiffer = false
  let simple = !analysis.hasUnbroken
  // Whether an item's start edge added a segment with no break before it (below), in a paragraph
  // whose analysis found none, so its other segments aren't marked as breaks to return to.
  let marksReturnable = false
  // Where the item at hand starts among the paragraph's segments.
  let itemStart = 0

  for (let from = 0; from < count;) {
    // The item this segment starts in, and the segments that start in it.
    const offset = offsets[analysis.starts[from]!]!
    let index = itemSegments.length === 0 ? 0 : itemSegments.length - 1
    while (index + 1 < starts.length && starts[index + 1]! <= offset) index++
    while (itemSegments.length <= index) itemSegments.push(widths.length)
    const itemEnd = index + 1 < starts.length ? starts[index + 1]! : source.length
    let to = from + 1
    while (to < count && offsets[analysis.starts[to]!]! < itemEnd) to++
    const item = items[index]!
    const previousItemStart = itemStart
    itemStart = widths.length

    if (item.text === undefined || atomic[index]) {
      // One object: a box's width, or the width of the item's text on a line of its own, laid out
      // in normal white space, as a chip's box with `white-space: nowrap` collapses its own, plus
      // its extraWidth. It is prepared without emergency breaks, as it is only laid out whole.
      let width = 0
      let text = ''
      let textStart = 0
      let textEnd = 0
      if (item.text === undefined) {
        width = item.width
      } else {
        const own = measureAnalysis(analyzeText(item.text, profile, 'normal', wordBreak, language), item.font, true, readLetterSpacing(item.letterSpacing), profile, language, false) as PreparedSegments
        const start: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
        if (normalizePreparedLineStart(own, start)) width = stepPreparedLineGeometryFromStart(own, start, Number.POSITIVE_INFINITY)!
        width += item.extraWidth ?? 0
        text = buildLineTextFromRange(own, 0, 0, own.segments.length, 0)
        while (isCollapsibleSpaceCode(item.text.charCodeAt(textStart))) textStart++
        textEnd = item.text.length
        while (isCollapsibleSpaceCode(item.text.charCodeAt(textEnd - 1))) textEnd--
      }
      // Gecko places an object of width 0 otherwise than the simple walker does (walkPreparedComplexLines).
      if (width === 0) simple = false
      widths.push(width)
      flags.push(widths.length > 1 ? OBJECT | STARTS_ITEM : OBJECT)
      segments.push(text)
      breakableFitAdvances.push(null)
      sourceStarts.push(textStart)
      sourceEnds.push(textEnd)
      from = to
      continue
    }

    const letterSpacing = readLetterSpacing(item.letterSpacing)
    if (to === from + 1 && analysis.flags[from] === SPACE && analysis.texts[from] === ' ') {
      // An item of only collapsible white space, as between two styled words: its one space, as measureAnalysis()
      // measures one.
      const at = widths.length
      if (letterSpacing !== 0) simple = false
      widths.push(getTextWidth(' ', getFontMeasurement(item.font, language), 0) + (spacingsDiffer ? letterSpacing : 0))
      flags.push(SPACE | (letterSpacing !== 0 ? SPACED : 0) | (at > 0 ? STARTS_ITEM : 0))
      segments.push(' ')
      breakableFitAdvances.push(null)
      sourceStarts.push(offset - starts[index]!)
      sourceEnds.push(offset + 1 - starts[index]!)
      from = to
      continue
    }
    const sub = measureAnalysis(sliceAnalysis(analysis, from, to), item.font, false, letterSpacing, profile, language, true)
    simple &&= sub.simpleLineCountFastPath
    // The gap before the hyphen is the letter spacing after the grapheme before it.
    hyphenWidths[index] = spacingsDiffer ? sub.discretionaryHyphenWidth - letterSpacing : sub.discretionaryHyphenWidth
    tabStopAdvances[index] = sub.tabStopAdvance
    if (firstTextItem < 0) firstTextItem = index
    else if (hyphenWidths[index] !== hyphenWidths[firstTextItem] || tabStopAdvances[index] !== tabStopAdvances[firstTextItem]) fontsDiffer = true

    // Every line the item reaches pays its extraWidth, as its fragment on that line paints it
    // (box-decoration-break: clone). The first of its segments whose width a line counts, after
    // the collapsed space before its text, holds it for a line that comes into the item or starts
    // with it, and a line that starts later in the item pays it there (ParagraphSegmentData). An
    // item that opens with preserved white space or a hard break, which a line can end with after
    // content that fills it, gets a start edge of its own before them: an empty segment as wide as
    // the extraWidth, which fits by the edges the engine fits where a line takes the item's
    // opening and no more of it (getOpeningFit), and no break comes before it, as none comes
    // before white space or a hard break in the text (UAX #14 LB6, LB7), but after an object in
    // Blink and Gecko.
    const extraWidth = item.extraWidth ?? 0
    let first = to
    if (extraWidth !== 0) {
      first = from
      while (first < to && ((sub.segmentFlags[first - from]! & KIND_BITS) === SOFT_HYPHEN || (first === from && (sub.segmentFlags[0]! & KIND_BITS) === SPACE))) first++
      const firstKind = first < to ? sub.segmentFlags[first - from]! & KIND_BITS : TEXT
      if (firstKind === PRESERVED_SPACE || firstKind === TAB || firstKind === HARD_BREAK) {
        const at = widths.length
        const afterObject = at > 0 && (flags[at - 1]! & KIND_BITS) === OBJECT
        // Whether the item follows preserved spaces that follow text in their own item: Blink gives every run
        // of preserved tabs a control item of its own (inline_items_builder.cc:1098-1110), so a tab, and spaces
        // after one, follow no text.
        const afterTextSpaces = at - 1 > previousItemStart && (flags[at - 1]! & KIND_BITS) === PRESERVED_SPACE && (flags[at - 2]! & KIND_BITS) !== TAB
        const fit = getOpeningFit(sub.segmentFlags, extraWidth, afterObject, afterTextSpaces, profile)
        // WebKit allows wrapping next to a white-space item (InlineFormattingUtils.cpp:406-418), so there a
        // break comes before white space that starts an item, and none before a hard break, after an object
        // too (nextWrapOpportunity, :469-475).
        const breaksBefore = at === 0 || (profile.lineBreakScan === 'webkit' ? firstKind !== HARD_BREAK : afterObject)
        widths.push(extraWidth)
        // An opening no edge of which is fitted hangs with the white space around it. Else it is an object:
        // the white space after it stays on its line, as the line keeps the opening it took.
        flags.push((fit === 0 ? PRESERVED_SPACE : breaksBefore ? OBJECT : OBJECT | UNBROKEN) | (at > 0 ? STARTS_ITEM : 0))
        if (!breaksBefore && !analysis.hasUnbroken) marksReturnable = true
        segments.push('')
        breakableFitAdvances.push(null)
        sourceStarts.push(offsets[analysis.starts[first]!]! - starts[index]!)
        sourceEnds.push(offsets[analysis.starts[first]!]! - starts[index]!)
        if (fit !== 0) lineEndTrims = setAt(lineEndTrims, at, extraWidth - fit, 0)
        first = from - 1
      }
    }
    for (let i = from; i < to; i++) {
      const s = i - from
      const at = widths.length
      let width = sub.widths[s]!
      let advances = sub.breakableFitAdvances[s] ?? null
      const spaced = spacingsDiffer && (sub.segmentFlags[s]! & SPACED) !== 0
      const holdsExtra = i === first
      if (advances !== null && (spaced || holdsExtra)) {
        // The cached advances are shared by every occurrence of this text.
        advances = advances.slice()
        if (spaced) for (let g = 0; g < advances.length; g++) advances[g] = advances[g]! + letterSpacing
        if (holdsExtra) advances[0] = advances[0]! + extraWidth
      }
      if (spaced) width += letterSpacing
      if (holdsExtra) width += extraWidth
      widths.push(width)
      flags.push(i === from && at > 0 && first >= from ? sub.segmentFlags[s]! | STARTS_ITEM : sub.segmentFlags[s]!)
      breakableFitAdvances.push(advances)
      const normalizedStart = analysis.starts[i]!
      const normalizedEnd = i + 1 < count ? analysis.starts[i + 1]! : analysis.normalized.length
      const sourceEnd = offsets[normalizedEnd - 1]! + 1
      // Where the segment's text ends in the normalized text.
      let textEnd = normalizedEnd
      sourceStarts.push(offsets[normalizedStart]! - starts[index]!)
      if (sourceEnd > itemEnd) {
        // The Gecko analysis keeps the soft hyphens and bidi controls Firefox's text run drops with the
        // segment before them, across items: the segment's text here is its own item's part, and the rest,
        // which paints nothing, is in no fragment.
        while (offsets[textEnd - 1]! >= itemEnd) textEnd--
        segments.push(analysis.normalized.slice(normalizedStart, textEnd))
        sourceEnds.push(itemEnd - starts[index]!)
      } else {
        segments.push(analysis.texts[i]!)
        // CRLF is one line feed, which ends with the item where the next item holds the line feed.
        sourceEnds.push((preserve && sourceEnd < itemEnd && source.charCodeAt(sourceEnd - 1) === 0x0D && source.charCodeAt(sourceEnd) === 0x0A ? sourceEnd + 1 : sourceEnd) - starts[index]!)
      }
      sourceUnits = setAt(sourceUnits, at, getSourceUnits(offsets, normalizedStart, textEnd, starts[index]!), null)
      if (sub.entryGeometry !== null) entryGeometry = setAt(entryGeometry, at, sub.entryGeometry[s]!, null)
      if (sub.lineStartProhibitions !== null) lineStartProhibitions = setAt(lineStartProhibitions, at, sub.lineStartProhibitions[s]!, null)
      const startExtra = (sub.lineStartExtras === null ? 0 : sub.lineStartExtras[s]!) + (i > first ? extraWidth : 0)
      if (startExtra !== 0) lineStartExtras = setAt(lineStartExtras, at, startExtra, 0)
      if (sub.lineEndTrims !== null) lineEndTrims = setAt(lineEndTrims, at, sub.lineEndTrims[s]!, 0)
      if (sub.overflowLineEndTrims !== null) overflowLineEndTrims = setAt(overflowLineEndTrims, at, sub.overflowLineEndTrims[s]!, 0)
      if (sub.discretionaryHyphenContexts !== null) {
        retreatsFromUnfitHyphen = true
        discretionaryHyphenContexts = setAt(discretionaryHyphenContexts, at, sub.discretionaryHyphenContexts[s]!, 0)
      }
      if (i >= first && first < to) insideExtras = setAt(insideExtras, at, extraWidth, 0)
      if (i > first && first < to) fillExtras = setAt(fillExtras, at, extraWidth, 0)
    }
    from = to
  }
  const segmentCount = widths.length
  while (itemSegments.length <= items.length) itemSegments.push(segmentCount)
  const segmentFlags = Uint8Array.from(flags)
  // A line returns from an unfit hyphen to a break the scan gives before text too (walkPreparedComplexLines),
  // so a paragraph whose lines return marks each one.
  if (marksReturnable || (retreatsFromUnfitHyphen && !analysis.hasUnbroken)) for (let i = 0; i < segmentCount; i++) if ((segmentFlags[i]! & UNBROKEN) === 0) segmentFlags[i] = segmentFlags[i]! | RETURNABLE
  if (retreatsFromUnfitHyphen) discretionaryHyphenContexts ??= []

  const data = {
    widths,
    segmentFlags,
    simpleLineWalkFastPath: simple,
    simpleLineCountFastPath: false,
    breakableFitAdvances,
    entryGeometry: setAt(entryGeometry, segmentCount, null, null),
    letterSpacing: spacingsDiffer || sharedSpacing === null ? 0 : sharedSpacing,
    discretionaryHyphenWidth: firstTextItem < 0 ? 0 : hyphenWidths[firstTextItem]!,
    discretionaryHyphenContexts: setAt(discretionaryHyphenContexts, segmentCount, 0, 0),
    lineStartProhibitions: setAt(lineStartProhibitions, segmentCount, null, null),
    lineStartExtras: setAt(lineStartExtras, segmentCount, 0, 0),
    lineEndTrims: setAt(lineEndTrims, segmentCount, 0, 0),
    overflowLineEndTrims: setAt(overflowLineEndTrims, segmentCount, 0, 0),
    tabStopAdvance: firstTextItem < 0 ? 0 : tabStopAdvances[firstTextItem]!,
    segments,
  } as PreparedSegments
  let segmentHyphenWidths: number[] | null = null
  let segmentTabStopAdvances: number[] | null = null
  if (fontsDiffer) {
    segmentHyphenWidths = []
    segmentTabStopAdvances = []
    for (let index = 0; index < items.length; index++) {
      for (let i = itemSegments[index]!; i < itemSegments[index + 1]!; i++) {
        segmentHyphenWidths.push(hyphenWidths[index]!)
        segmentTabStopAdvances.push(tabStopAdvances[index]!)
      }
    }
  }
  data.items = { hyphenWidths: segmentHyphenWidths, tabStopAdvances: segmentTabStopAdvances, insideExtras: setAt(insideExtras, segmentCount, 0, 0), fillExtras: setAt(fillExtras, segmentCount, 0, 0) }
  let onlyItem = -1
  for (let index = 0; index < items.length && !paddedOrObject; index++) {
    if (itemSegments[index] === itemSegments[index + 1]) continue
    if (onlyItem >= 0) {
      onlyItem = -1
      break
    }
    onlyItem = index
  }
  return findWholeLine({ data, onlyItem, wholeWidth: null, wholeStart: 0, wholeEnd: 0, itemSegments, sourceStarts, sourceEnds, sourceUnits: setAt(sourceUnits, segmentCount, null, null), text: '' } as InternalPreparedRichInline)
}

// Finds the paragraph's line where nothing wraps it. A paragraph that fits its line whole takes it without a
// walk, as Blink takes a text item whole where its shaped width fits (ShapingLineBreaker::ShapeLine,
// shaping_line_breaker.cc:281-297, Chromium 153), even where negative advances bring the width back under the
// line's after a break that overflows, where the text walkers end the line (ENGINE_FOLLOWUPS.md). Most paragraphs
// of a chat are one line.
function findWholeLine(flow: InternalPreparedRichInline): InternalPreparedRichInline {
  const lineCount = walkPreparedLinesRaw(flow.data, Number.POSITIVE_INFINITY, (width, startSegmentIndex, _startGraphemeIndex, endSegmentIndex) => {
    flow.wholeWidth = width
    flow.wholeStart = startSegmentIndex
    flow.wholeEnd = endSegmentIndex
  })
  if (lineCount !== 1) flow.wholeWidth = null
  return flow
}

// Whether the paragraph's whole line fits `maxWidth`, as the walkers fit a line.
function fitsWhole(flow: InternalPreparedRichInline, maxWidth: number): boolean {
  return flow.wholeWidth !== null && flow.wholeWidth <= Math.max(0, maxWidth) + getEngineProfile().lineFitEpsilon
}

// `list` with `value` at `index`, where the segments before it that set none hold `empty`: a list
// only some segments have a value in is made at the first one that does. Past the last index, it
// only fills the list.
function setAt<T>(list: T[] | null, index: number, value: T, empty: T): T[] | null {
  if (list === null) {
    if (value === empty) return null
    list = []
  }
  while (list.length < index) list.push(empty)
  if (list.length === index && value !== empty) list.push(value)
  return list
}

// How much of a padded item's extraWidth a line fits where it takes the item's opening, the
// white space or hard break that starts it, and no more of it; a line that goes on into the item
// fits all of it. Blink adds a span's start edge to the line when it opens (HandleOpenTag,
// line_breaker.cc:3957-3976), and only a test-only flag narrows the line for its cloned end edge
// (BoxDecorationBreakCloneLineBreaking, :454-461), so it fits half: the extraWidth isn't split by
// side (ENGINE_FOLLOWUPS.md). The items a line takes after the break it returns to stay on it
// where they are all trailable, white space with the tags of spans that open and close among it
// (RewindOverflow, :4332-4424), so Blink fits no edge of a span of only white space. Nor does it
// after preserved spaces that follow text in one item, which its return breaks before
// (HandleOverflow, :4163-4185, at the run's start that ShapingLineBreaker::ShapeLine breaks at,
// shaping_line_breaker.cc:490-495): the line then trails them, taking the open tag and white
// space or a forced break after them with no fit (HandleTrailingSpaces, :2426-2534). WebKit fits
// a box that opens in the content it places without its cloned end edge
// (placedClonedDecorationWidth, InlineLineBuilder.cpp:1501-1523), where a hard break starts it or
// white space does after an object, but that content runs on past the inline box ends after a line
// break or white space (nextWrapOpportunity, InlineFormattingUtils.cpp:470-475, 530-538), so it
// fits the end edge too of an item of white space that ends there. Gecko fits a frame's whole
// width, its cloned end edge too (CanPlaceFrame, nsLineLayout.cpp:1217-1270).
function getOpeningFit(segmentFlags: Uint8Array, extraWidth: number, afterObject: boolean, afterTextSpaces: boolean, profile: EngineProfile): number {
  const fit = profile.paddedOpeningFit
  const firstKind = segmentFlags[0]! & KIND_BITS
  const opensWithWhiteSpace = firstKind === PRESERVED_SPACE || (firstKind === TAB && profile.hangTabs)
  let whiteSpaceEnd = 0
  while (whiteSpaceEnd < segmentFlags.length && ((segmentFlags[whiteSpaceEnd]! & KIND_BITS) === PRESERVED_SPACE || (segmentFlags[whiteSpaceEnd]! & KIND_BITS) === TAB)) whiteSpaceEnd++
  if (fit === 'start' && (opensWithWhiteSpace || firstKind === HARD_BREAK)) return afterTextSpaces || whiteSpaceEnd === segmentFlags.length ? 0 : extraWidth / 2
  if (fit === 'placed' && ((afterObject && opensWithWhiteSpace) || firstKind === HARD_BREAK)) {
    const onlyOpening = whiteSpaceEnd === segmentFlags.length || (whiteSpaceEnd === segmentFlags.length - 1 && (segmentFlags[whiteSpaceEnd]! & KIND_BITS) === HARD_BREAK)
    return onlyOpening ? extraWidth : extraWidth / 2
  }
  return extraWidth
}

// The item a segment of the paragraph is in: the last one that starts at or before it, so an
// item with no segments of its own, as an empty one, is never one's.
function getItemIndex(itemSegments: number[], segmentIndex: number): number {
  let low = 0
  let high = itemSegments.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (itemSegments[middle]! <= segmentIndex) low = middle
    else high = middle - 1
  }
  return low
}

// A line of the paragraph from the text walkers' line: its segments cut into fragments where the
// item changes. A collapsed space at an item's start or end is no fragment's text but the gap
// before the next fragment on the line, as that item's white space made it. Each fragment's width
// is its segments' on this line, and the fragments add up to the line's width: what the line's
// width leaves out at its end comes out of the last fragments and the gaps before them, from the
// line's end back, as white space that hangs there and the edge of a padded item's opening that
// the line kept without fitting (getOpeningFit), and what it adds, the hyphen of a soft hyphen the
// line ends at, goes to the last one.
function createLine(
  flow: InternalPreparedRichInline,
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): RichInlineLineRange {
  const { data, onlyItem, itemSegments } = flow
  const itemCount = itemSegments.length - 1
  const endItemIndex = endSegmentIndex >= itemSegments[itemCount]! ? itemCount : getItemIndex(itemSegments, endSegmentIndex)
  const end: RichInlineCursor = { itemIndex: endItemIndex, segmentIndex: endSegmentIndex - itemSegments[endItemIndex]!, graphemeIndex: endGraphemeIndex }
  if (onlyItem >= 0) {
    const first = itemSegments[onlyItem]!
    return {
      fragments: [{
        itemIndex: onlyItem,
        gapBefore: 0,
        gapItemIndex: -1,
        occupiedWidth: width,
        start: { segmentIndex: startSegmentIndex - first, graphemeIndex: startGraphemeIndex },
        end: { segmentIndex: endSegmentIndex - first, graphemeIndex: endGraphemeIndex },
      }],
      width: Math.max(0, width),
      end,
    }
  }

  const { widths, segmentFlags, segments, breakableFitAdvances, entryGeometry, lineStartExtras, letterSpacing, tabStopAdvance, items } = data
  const skipNarrowTabStops = getEngineProfile().skipNarrowTabStops
  const fragments: RichInlineFragmentRange[] = []
  const lastSegmentIndex = endGraphemeIndex > 0 ? endSegmentIndex : endSegmentIndex - 1
  let itemIndex = getItemIndex(itemSegments, startSegmentIndex)
  let fragment: RichInlineFragmentRange | null = null
  // The line's width so far, and the gap that waits for a fragment.
  let lineW = 0
  let gap = 0
  let gapItemIndex = -1
  for (let i = startSegmentIndex; i <= lastSegmentIndex; i++) {
    while (i >= itemSegments[itemIndex + 1]!) {
      itemIndex++
      fragment = null
    }
    const kind = segmentFlags[i]! & KIND_BITS
    const from = i === startSegmentIndex ? startGraphemeIndex : 0
    const whole = i < endSegmentIndex
    // A segment's width on the line, with the letter spacing after each of its graphemes, as a
    // fragment's width counts it.
    let w: number
    if (from === 0 && whole) {
      w = kind !== TAB ? widths[i]! : getItemTabAdvance(items, i, lineW, tabStopAdvance, skipNarrowTabStops)
      if (i === startSegmentIndex && lineStartExtras !== null) w += lineStartExtras[i]!
      if (letterSpacing !== 0 && (segmentFlags[i]! & SPACED) !== 0) w += letterSpacing
    } else {
      const advances = breakableFitAdvances[i]!
      const to = whole ? advances.length : endGraphemeIndex
      const entry = from > 0 && entryGeometry !== null ? entryGeometry[i]! : null
      const entryWidth = entry === null ? null : getSegmentEntryWidth(entry, from, to)
      if (entryWidth !== null) {
        w = entryWidth
      } else {
        w = 0
        for (let g = from; g < to; g++) w += advances[g]! + letterSpacing
      }
      if (items !== undefined && (from > 0 ? items.insideExtras !== null : items.fillExtras !== null)) w += from > 0 ? items.insideExtras![i]! : items.fillExtras![i]!
    }
    if (kind === SPACE && (i === itemSegments[itemIndex]! || i === itemSegments[itemIndex + 1]! - 1) && segments[i]!.length === 1) {
      gap = w
      gapItemIndex = itemIndex
      fragment = null
      continue
    }
    if (fragment === null) {
      fragment = {
        itemIndex,
        gapBefore: gap,
        gapItemIndex,
        occupiedWidth: 0,
        start: { segmentIndex: i - itemSegments[itemIndex]!, graphemeIndex: from },
        end: { segmentIndex: 0, graphemeIndex: 0 },
      }
      fragments.push(fragment)
      lineW += gap
      gap = 0
      gapItemIndex = -1
    }
    fragment.occupiedWidth += w
    fragment.end.segmentIndex = (whole ? i + 1 : i) - itemSegments[itemIndex]!
    fragment.end.graphemeIndex = whole ? 0 : endGraphemeIndex
    lineW += w
  }

  let rest = lineW - width
  if (rest < 0 && fragments.length > 0) fragments[fragments.length - 1]!.occupiedWidth -= rest
  for (let k = fragments.length - 1; k >= 0 && rest > 0; k--) {
    const last = fragments[k]!
    if (last.occupiedWidth > 0) {
      const part = Math.min(rest, last.occupiedWidth)
      last.occupiedWidth -= part
      rest -= part
    }
    if (rest > 0 && last.gapBefore > 0) {
      const part = Math.min(rest, last.gapBefore)
      last.gapBefore -= part
      rest -= part
      if (last.gapBefore < 1e-9) {
        last.gapBefore = 0
        last.gapItemIndex = -1
      }
    }
  }
  return { fragments, width: Math.max(0, width), end }
}

export function layoutNextRichInlineLineRange(
  prepared: PreparedRichInline,
  maxWidth: number,
  start: RichInlineCursor = RICH_INLINE_START_CURSOR,
): RichInlineLineRange | null {
  const flow = getInternalPreparedRichInline(prepared)
  const { data, itemSegments } = flow
  if (start.itemIndex === 0 && start.segmentIndex === 0 && start.graphemeIndex === 0 && fitsWhole(flow, maxWidth)) return createLine(flow, flow.wholeWidth!, flow.wholeStart, 0, flow.wholeEnd, 0)
  const lineEnd: LayoutCursor = {
    segmentIndex: start.itemIndex < itemSegments.length ? itemSegments[start.itemIndex]! + start.segmentIndex : data.segmentFlags.length,
    graphemeIndex: start.graphemeIndex,
  }
  if (!normalizePreparedLineStart(data, lineEnd)) return null
  const startSegmentIndex = lineEnd.segmentIndex
  const startGraphemeIndex = lineEnd.graphemeIndex
  const width = stepPreparedLineGeometryFromStart(data, lineEnd, maxWidth)
  return width === null ? null : createLine(flow, width, startSegmentIndex, startGraphemeIndex, lineEnd.segmentIndex, lineEnd.graphemeIndex)
}

// Where units [from, to) of a paragraph's normalized text are in the text of the item that starts at `itemStart`,
// from the offset in the paragraph's text each unit comes from, where they aren't one stretch of it: Gecko removes a
// line feed between two ideographs, and white space after a bidi control that follows white space. Else null.
function getSourceUnits(offsets: Int32Array, from: number, to: number, itemStart: number): number[] | null {
  if (to <= from || offsets[to - 1]! - offsets[from]! === to - 1 - from) return null
  const units: number[] = []
  for (let unit = from; unit < to; unit++) units.push(offsets[unit]! - itemStart)
  return units
}

// Per segment of a paragraph of one text item, where its text starts and ends in the item's.
function findSegmentSources(flow: InternalPreparedRichInline): void {
  const { segments } = flow.data
  const offsets = alignToSource(flow.text, segments.join(''))
  const sourceStarts: number[] = []
  const sourceEnds: number[] = []
  const sourceUnits: (number[] | null)[] = []
  for (let i = 0, at = 0; i < segments.length; at += segments[i++]!.length) {
    const end = offsets[at + segments[i]!.length - 1]! + 1
    sourceStarts.push(offsets[at]!)
    sourceEnds.push(flow.text.charCodeAt(end - 1) === 0x0D && flow.text.charCodeAt(end) === 0x0A && segments[i] === '\n' ? end + 1 : end)
    sourceUnits.push(getSourceUnits(offsets, at, at + segments[i]!.length, 0))
  }
  flow.sourceStarts = sourceStarts
  flow.sourceEnds = sourceEnds
  flow.sourceUnits = sourceUnits
}

// Where unit `unit` of a segment's text is in its item's text.
function getSourceOffset(flow: InternalPreparedRichInline, segmentIndex: number, unit: number): number {
  const units = flow.sourceUnits === null ? null : flow.sourceUnits[segmentIndex]!
  return units === null ? flow.sourceStarts![segmentIndex]! + unit : units[unit]!
}

// Bridge from cheap range walking to full fragment text. Lets callers do
// shrinkwrap/virtualization/probing work first, then only pay for text on the
// lines they actually render.
export function materializeRichInlineLineRange(
  prepared: PreparedRichInline,
  line: RichInlineLineRange,
): RichInlineLine {
  const flow = getInternalPreparedRichInline(prepared)
  const { data, itemSegments } = flow
  if (flow.sourceStarts === null) findSegmentSources(flow)
  const sourceStarts = flow.sourceStarts!
  const sourceEnds = flow.sourceEnds!
  const lineEndSegmentIndex = line.end.itemIndex < itemSegments.length ? itemSegments[line.end.itemIndex]! + line.end.segmentIndex : data.segmentFlags.length
  const fragments: RichInlineFragment[] = []

  for (let i = 0; i < line.fragments.length; i++) {
    const fragment = line.fragments[i]!
    const first = itemSegments[fragment.itemIndex]
    if (first === undefined || fragment.itemIndex + 1 >= itemSegments.length) throw new Error('Missing rich-text inline item for fragment')
    // A range kept from a longer paragraph can end past its item in this one: its text stops at the item's end.
    const itemEnd = itemSegments[fragment.itemIndex + 1]!
    const startSegmentIndex = Math.min(first + fragment.start.segmentIndex, itemEnd)
    const startGraphemeIndex = fragment.start.graphemeIndex
    const endSegmentIndex = Math.min(first + fragment.end.segmentIndex, itemEnd)
    const endGraphemeIndex = endSegmentIndex < itemEnd ? fragment.end.graphemeIndex : 0
    // Only the fragment a line ends with shows the hyphen of a soft hyphen it ends at.
    const endsLine = i === line.fragments.length - 1 && endSegmentIndex === lineEndSegmentIndex && endGraphemeIndex === line.end.graphemeIndex
    let sourceStart = startSegmentIndex < itemEnd ? sourceStarts[startSegmentIndex]! : startSegmentIndex > first ? sourceEnds[startSegmentIndex - 1]! : 0
    if (startGraphemeIndex > 0 && startSegmentIndex < itemEnd) sourceStart = getSourceOffset(flow, startSegmentIndex, getGraphemeEnds(data, startSegmentIndex)[startGraphemeIndex - 1]!)
    let sourceEnd = sourceStart
    if (endGraphemeIndex > 0) sourceEnd = getSourceOffset(flow, endSegmentIndex, getGraphemeEnds(data, endSegmentIndex)[endGraphemeIndex - 1]! - 1) + 1
    else if (endSegmentIndex > startSegmentIndex) sourceEnd = sourceEnds[endSegmentIndex - 1]!
    fragments.push({
      itemIndex: fragment.itemIndex,
      text: buildLineTextFromRange(data, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex, endsLine),
      gapBefore: fragment.gapBefore,
      gapItemIndex: fragment.gapItemIndex,
      occupiedWidth: fragment.occupiedWidth,
      start: fragment.start,
      end: fragment.end,
      sourceStart,
      sourceEnd,
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
  const flow = getInternalPreparedRichInline(prepared)
  if (fitsWhole(flow, maxWidth)) {
    onLine(createLine(flow, flow.wholeWidth!, flow.wholeStart, 0, flow.wholeEnd, 0))
    return 1
  }
  return walkPreparedLinesRaw(flow.data, maxWidth, (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
    onLine(createLine(flow, width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex))
  })
}

export function measureRichInlineStats(
  prepared: PreparedRichInline,
  maxWidth: number,
): RichInlineStats {
  const flow = getInternalPreparedRichInline(prepared)
  if (fitsWhole(flow, maxWidth)) return { lineCount: 1, maxLineWidth: Math.max(0, flow.wholeWidth!) }
  const stats = { lineCount: 0, maxLineWidth: 0 }
  walkPreparedLinesRaw(flow.data, maxWidth, undefined, stats)
  return stats
}
