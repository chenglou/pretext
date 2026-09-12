import {
  prepareWithSegments,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from './layout.js'
import {
  analyzeText,
  getBreakablePreferredBreaks,
  getCjkTextUnits,
  getSharedGraphemeSegmenter,
  isCJK,
  removeSegmentBreaksNextToZeroWidthSpace,
  type AnalysisProfile,
  type SegmentBreakKind,
} from './analysis.js'
import {
  buildLineTextFromRange,
  getLineTextCache,
} from './line-text.js'
import {
  breaksAfter,
  type LineBreakCursor,
  type PreparedLineBreakData,
  stepPreparedLineGeometry,
} from './line-break.js'
import { getEngineProfile, getFontMeasurementState, getSegmentMetrics } from './measurement.js'

// Helper for rich-text inline flow under `white-space: normal`.
// It keeps the core layout API low-level while taking over the boring shared
// work that rich inline demos kept reimplementing in userland:
// - collapsed boundary whitespace across item boundaries
// - atomic inline boxes like pills
// - per-item extra horizontal chrome such as padding/borders

declare const preparedRichInlineBrand: unique symbol

export type RichInlineItem = {
  text: string // Raw author text, including any leading/trailing collapsible spaces
  font: string // Canvas font shorthand used to prepare and measure this item
  letterSpacing?: number // Extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a pill or mention chip
  extraWidth?: number // Caller-owned horizontal chrome, e.g. padding + border width
}

export type PreparedRichInline = {
  readonly [preparedRichInlineBrand]: true
}

export type RichInlineCursor = {
  itemIndex: number // Index into the original RichInlineItem array
  segmentIndex: number
  graphemeIndex: number
}

export type RichInlineFragment = {
  itemIndex: number // Index into the original RichInlineItem array
  text: string // Text slice for this fragment
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type RichInlineFragmentRange = {
  itemIndex: number // Index into the original RichInlineItem array
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
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
}

type PreparedRichInlineItem = {
  break: 'normal' | 'never'
  // An ordinary break at the boundary before this item: collapsed whitespace,
  // or a break the joined text offers there. Where every item boundary breaks,
  // only collapsed whitespace or a trailing ZWSP before the item sets it.
  breakBefore: boolean
  // Following items can continue this item's last unbreakable run. This is
  // the width they add to that run before the next ordinary break.
  carryWidth: number
  establishesLine: boolean
  extraWidth: number
  gapBefore: number
  // Where the last ordinary break inside this item falls; the item start when
  // the last run starts at or before it. Set with a carry.
  lastRunStart: LayoutCursor
  // Where the joined text breaks inside the item, and the item's own segment
  // starts where it does not. Null while the item's segmentation agrees.
  joinedBreaks: LayoutCursor[] | null
  localOnlyBreaks: number[] | null
  naturalWidth: number
  prepared: PreparedTextWithSegments
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

function isBeforeCursor(cursor: LayoutCursor, target: LayoutCursor): boolean {
  return cursor.segmentIndex < target.segmentIndex ||
    (cursor.segmentIndex === target.segmentIndex && cursor.graphemeIndex < target.graphemeIndex)
}

function isCollapsibleBoundaryWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D
}

function getCollapsedSpaceWidth(font: string, letterSpacing: number): number {
  const { cache } = getFontMeasurementState(font, false)
  return getSegmentMetrics(' ', cache).width + letterSpacing
}

function measureWholeItem(prepared: PreparedTextWithSegments): number | null {
  const end: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  return stepPreparedLineGeometry(prepared, end, Number.POSITIVE_INFINITY)
}

function measureItemPrefix(prepared: PreparedTextWithSegments, end: LayoutCursor): number {
  const cursor: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  return stepPreparedLineGeometry(prepared, cursor, Number.POSITIVE_INFINITY, end.segmentIndex, end.graphemeIndex) ?? 0
}

// Maps an offset in an item's text, counted from a segment start, to a cursor
// the line walker can end at: a segment start, or a grapheme inside a segment
// that has fit advances. Null when the walker cannot end a line there.
function getItemCursor(prepared: PreparedTextWithSegments, startSegmentIndex: number, offset: number): LayoutCursor | null {
  const data: PreparedLineBreakData = prepared
  const { segments } = prepared
  let start = 0
  for (let i = startSegmentIndex; i < segments.length; i++) {
    if (offset === start) return { segmentIndex: i, graphemeIndex: 0 }
    const end = start + segments[i]!.length
    if (offset < end) {
      if (data.breakableFitAdvances[i] === null || data.entryGeometry?.[i] != null) return null
      let graphemeIndex = 0
      for (const grapheme of getSharedGraphemeSegmenter().segment(segments[i]!)) {
        if (start + grapheme.index === offset) return { segmentIndex: i, graphemeIndex }
        graphemeIndex++
      }
      return null
    }
    start = end
  }
  return null
}

// Browsers find ordinary break opportunities in the text their inline items
// join; the item boundary itself is not one. This analyzes the joined text like
// prepare(): analysis segments, with CJK text split into its measured units.
// It returns the offsets of the units the line walker could end a line before.
// A leading SPACE keeps the scan-start rules from treating text after a
// collapsed space as the start of its node.
function getJoinedBreakOffsets(text: string, afterWhitespace: boolean, profile: AnalysisProfile): number[] {
  const analysis = analyzeText(afterWhitespace ? ` ${text}` : text, profile)
  const offsets: number[] = []
  let previousKind: SegmentBreakKind | null = null
  for (let i = 0; i < analysis.len; i++) {
    const segText = analysis.texts[i]!
    const kind = analysis.kinds[i]!
    const start = analysis.starts[i]!
    const units = kind === 'text' && isCJK(segText) ? getCjkTextUnits(segText, profile, 'normal') : null
    const unitCount = units === null ? 1 : units.length
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex++) {
      // No ordinary break precedes NEL (UAX #14 LB6).
      if (previousKind !== null && kind !== 'control' && (breaksAfter(previousKind) || !breaksAfter(kind))) {
        offsets.push(units === null ? start : start + units[unitIndex]!.start)
      }
      previousKind = kind
    }
  }
  return offsets
}

// The last joined break inside a portion that ends at a no-break boundary.
// Offsets before `endIndex` precede the boundary. A break the walker cannot
// end at falls back to an earlier one, then to the portion start.
function getLastRunStart(portion: JoinedPortion, breakOffsets: readonly number[], endIndex: number): LayoutCursor {
  for (let i = endIndex - 1; i >= 0 && breakOffsets[i]! > portion.start; i--) {
    const cursor = getItemCursor(portion.item.prepared, portion.startSegmentIndex, breakOffsets[i]! - portion.start)
    if (cursor !== null) return cursor
  }
  return portion.startSegmentIndex === 0
    ? EMPTY_LAYOUT_CURSOR
    : { segmentIndex: portion.startSegmentIndex, graphemeIndex: 0 }
}

// Whether the line walker can end a line before an item's own segment.
function breaksBeforeItemSegment(kinds: readonly SegmentBreakKind[], segmentIndex: number): boolean {
  return kinds[segmentIndex] !== 'control' && (breaksAfter(kinds[segmentIndex - 1]!) || !breaksAfter(kinds[segmentIndex]!))
}

// The item's own last ordinary break inside a portion that ends the item; the
// portion start when there is none.
function getLastItemRunStart(portion: JoinedPortion): LayoutCursor {
  const { kinds } = portion.item.prepared
  for (let i = kinds.length - 1; i > portion.startSegmentIndex; i--) {
    if (breaksBeforeItemSegment(kinds, i)) return { segmentIndex: i, graphemeIndex: 0 }
  }
  return portion.startSegmentIndex === 0
    ? EMPTY_LAYOUT_CURSOR
    : { segmentIndex: portion.startSegmentIndex, graphemeIndex: 0 }
}

// Records breaks that fall inside the first segment of a portion that starts
// the item, as grapheme cursors, so an emergency split of that segment ends at
// one. Offsets are in window coordinates.
function recordFirstSegmentBreaks(portion: JoinedPortion, breakOffsets: readonly number[]): void {
  const { item } = portion
  const segmentEnd = portion.start + item.prepared.segments[0]!.length
  for (let k = 0; k < breakOffsets.length && breakOffsets[k]! < segmentEnd; k++) {
    if (breakOffsets[k]! <= portion.start) continue
    const cursor = getItemCursor(item.prepared, 0, breakOffsets[k]! - portion.start)
    if (cursor === null) continue
    if (item.joinedBreaks === null) item.joinedBreaks = []
    item.joinedBreaks.push(cursor)
  }
}

// Records where the joined text breaks inside a portion, as item cursors, and
// the item's own segment starts inside it where the joined text does not break.
// Offsets from `startIndex` are at or after the portion start.
function recordJoinedBreaks(portion: JoinedPortion, breakOffsets: readonly number[], startIndex: number, portionEnd: number): void {
  const { item } = portion
  const { segments } = item.prepared
  const cursors: LayoutCursor[] = []
  const localOnly: number[] = []
  let agrees = true
  let breakIndex = breakOffsets[startIndex] === portion.start ? startIndex + 1 : startIndex
  // Text after a collapsible space starts at an ordinary break.
  if (portion.startSegmentIndex > 0) cursors.push({ segmentIndex: portion.startSegmentIndex, graphemeIndex: 0 })
  let segmentStart = portion.start
  for (let i = portion.startSegmentIndex; i < segments.length && segmentStart < portionEnd; i++) {
    if (i > portion.startSegmentIndex) {
      if (breakOffsets[breakIndex] === segmentStart) {
        cursors.push({ segmentIndex: i, graphemeIndex: 0 })
        breakIndex++
      } else {
        localOnly.push(i)
        agrees = false
      }
    }
    const segmentEnd = segmentStart + segments[i]!.length
    for (; breakIndex < breakOffsets.length && breakOffsets[breakIndex]! < segmentEnd; breakIndex++) {
      agrees = false
      const cursor = getItemCursor(item.prepared, i, breakOffsets[breakIndex]! - segmentStart)
      if (cursor !== null) cursors.push(cursor)
    }
    segmentStart = segmentEnd
  }
  if (agrees) return
  item.joinedBreaks = item.joinedBreaks === null ? cursors : item.joinedBreaks.concat(cursors)
  item.localOnlyBreaks = item.localOnlyBreaks === null ? localOnly : item.localOnlyBreaks.concat(localOnly)
}

function getLatestJoinedBreak(
  joinedBreaks: readonly LayoutCursor[] | null,
  after: LayoutCursor,
  before: LayoutCursor,
): LayoutCursor | null {
  let joinedBreak: LayoutCursor | null = null
  if (joinedBreaks === null) return joinedBreak
  for (let i = 0; i < joinedBreaks.length && isBeforeCursor(joinedBreaks[i]!, before); i++) {
    if (isBeforeCursor(after, joinedBreaks[i]!)) joinedBreak = joinedBreaks[i]!
  }
  return joinedBreak
}

// Steps an item's line from `start` to an ordinary break at `end`. The line
// end is written only when the step produces a line.
function stepItemToBreak(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  availableWidth: number,
  end: LayoutCursor,
  lineEnd: LineBreakCursor,
): number | null {
  const cursor: LineBreakCursor = { segmentIndex: start.segmentIndex, graphemeIndex: start.graphemeIndex }
  const width = stepPreparedLineGeometry(prepared, cursor, availableWidth, end.segmentIndex, end.graphemeIndex)
  if (width !== null) {
    lineEnd.segmentIndex = cursor.segmentIndex
    lineEnd.graphemeIndex = cursor.graphemeIndex
  }
  return width
}

// The latest end of a preferred break grapheme, such as a hyphen, in
// (start, end]. An emergency split of a word ends there. The walker can end
// a line inside a segment only where that segment has fit advances.
function getLastPreferredBreak(prepared: PreparedTextWithSegments, start: LayoutCursor, end: LayoutCursor): LayoutCursor | null {
  const data: PreparedLineBreakData = prepared
  const { segments } = prepared
  let text = ''
  for (let i = start.segmentIndex; i <= end.segmentIndex; i++) text += segments[i]!
  const preferredBreaks = getBreakablePreferredBreaks(text, getEngineProfile())
  let preferredBreak: LayoutCursor | null = null
  if (preferredBreaks === null) return preferredBreak
  let graphemeEnd = 0
  let breakIndex = 0
  for (let i = start.segmentIndex; i <= end.segmentIndex; i++) {
    const graphemes = Array.from(getSharedGraphemeSegmenter().segment(segments[i]!))
    const walkable = data.breakableFitAdvances[i] !== null && data.entryGeometry?.[i] == null
    for (let g = 1; g <= graphemes.length; g++) {
      graphemeEnd++
      if (preferredBreaks[breakIndex] !== graphemeEnd) continue
      breakIndex++
      const cursor = g === graphemes.length ? { segmentIndex: i + 1, graphemeIndex: 0 } : { segmentIndex: i, graphemeIndex: g }
      if (cursor.graphemeIndex > 0 && !walkable) continue
      if (isBeforeCursor(start, cursor) && !isBeforeCursor(end, cursor)) preferredBreak = cursor
    }
  }
  return preferredBreak
}

// Fills the graphemes of a segment that does not fit, as the line walker does
// for a word that began the line: up to the last grapheme that fits, or back
// to the word's last preferred break. Null when the item's own break before
// the segment is that end, or the segment has no fit advances.
function fillItemSegment(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  availableWidth: number,
  segmentIndex: number,
  lineEnd: LineBreakCursor,
): number | null {
  const data: PreparedLineBreakData = prepared
  const fitAdvances = data.breakableFitAdvances[segmentIndex]
  if (fitAdvances === null || fitAdvances === undefined || data.entryGeometry?.[segmentIndex] != null) return null
  const overflow: LayoutCursor = { segmentIndex, graphemeIndex: 0 }
  const cursor: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  for (let g = 1; g < fitAdvances.length; g++) {
    cursor.segmentIndex = start.segmentIndex
    cursor.graphemeIndex = start.graphemeIndex
    stepPreparedLineGeometry(prepared, cursor, availableWidth, segmentIndex, g)
    if (cursor.segmentIndex !== segmentIndex || cursor.graphemeIndex !== g) break
    overflow.graphemeIndex = g
  }
  const end = getLastPreferredBreak(prepared, start, overflow) ?? overflow
  if (end.segmentIndex === segmentIndex && end.graphemeIndex === 0) return null
  return stepItemToBreak(prepared, start, availableWidth, end, lineEnd)
}

// The joined text's first ordinary break inside a portion that starts at a
// no-break boundary, as an item cursor. Offsets from `startIndex` follow the
// boundary. A break the walker cannot end at falls back to a later one.
function getFirstJoinedRunEnd(
  portion: JoinedPortion,
  breakOffsets: readonly number[],
  startIndex: number,
  portionEnd: number,
): LayoutCursor | null {
  let end: LayoutCursor | null = null
  for (let i = startIndex; end === null && i < breakOffsets.length && breakOffsets[i]! < portionEnd; i++) {
    end = getItemCursor(portion.item.prepared, 0, breakOffsets[i]! - portion.start)
  }
  return end
}

// Width of a leading run in a portion that starts at a no-break boundary: up to
// its first ordinary break `end`, or after the collapsible space that ends the
// portion. Null when the run continues past the item. Breaks after directly
// following SHY, ZWSP or that space end the run too; the cheapest counts, as a
// SHY directly before a ZWSP or SPACE paints no hyphen.
function getLeadingRunWidth(portion: JoinedPortion, end: LayoutCursor | null): number | null {
  const { prepared } = portion.item
  const { spaceEndSegmentIndex } = portion
  if (end === null) {
    if (spaceEndSegmentIndex < 0) return null
    end = { segmentIndex: spaceEndSegmentIndex, graphemeIndex: 0 }
  }
  let width = measureItemPrefix(prepared, end)
  if (end.graphemeIndex > 0) return width
  const { kinds } = prepared
  for (let i = end.segmentIndex; i < kinds.length; i++) {
    const kind = kinds[i]!
    if (kind !== 'soft-hyphen' && kind !== 'zero-width-break' && i !== spaceEndSegmentIndex - 1) break
    width = Math.min(width, measureItemPrefix(prepared, { segmentIndex: i + 1, graphemeIndex: 0 }))
    if (kind === 'space') break
  }
  return width
}

type RichInlineFragmentCollector = (
  itemIndex: number,
  gapBefore: number,
  occupiedWidth: number,
  start: LayoutCursor,
  end: LayoutCursor,
) => void

function endsInsideFirstSegment(segmentIndex: number, graphemeIndex: number): boolean {
  return segmentIndex === 0 && graphemeIndex > 0
}

export function prepareRichInline(items: RichInlineItem[]): PreparedRichInline {
  const preparedItems = Array.from<PreparedRichInlineItem | undefined>({ length: items.length })
  const profile = getEngineProfile()
  const { inlineItemBreaks } = profile
  // A collapsed SPACE can have zero or negative advance. Its existence and
  // ordinary break opportunity must survive independently of that number.
  let pendingGapWidth: number | null = null
  // Where every item boundary breaks, a trailing ZWSP still marks the break
  // before the next item, so the line wraps there before splitting that item.
  let breakAfterPreviousItem = false
  let previousItem: PreparedRichInlineItem | null = null
  // Collapsible spaces always break and atomic items always allow a break on
  // both sides. Only the text between them joins across item boundaries.
  let joinedAfterWhitespace = false
  const joinedPortions: JoinedPortion[] = []
  // Width of an item's leading run when no break precedes the item; null when
  // that run continues past the item.
  const leadingRunWidths: Array<number | null> = []
  // An item's last two source characters, read as prior context at the next
  // boundary where breaks come from each item's own text.
  const boundaryContexts: string[] = []

  function finishJoinedText(afterWhitespace: boolean): void {
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
      if (inlineItemBreaks === 'joined-text') {
        const breakOffsets = getJoinedBreakOffsets(joinedText, joinedAfterWhitespace, profile)
        let breakIndex = 0
        for (let i = 0; i < joinedPortions.length; i++) {
          const portion = joinedPortions[i]!
          const portionEnd = i + 1 < joinedPortions.length ? joinedPortions[i + 1]!.start : joinedText.length
          while (breakIndex < breakOffsets.length && breakOffsets[breakIndex]! < portion.start) breakIndex++
          recordJoinedBreaks(portion, breakOffsets, breakIndex, portionEnd)
          if (i === 0) continue
          portion.item.breakBefore = breakOffsets[breakIndex] === portion.start
          if (portion.item.breakBefore) continue
          joinedPortions[i - 1]!.item.lastRunStart = getLastRunStart(joinedPortions[i - 1]!, breakOffsets, breakIndex)
          leadingRunWidths[portion.itemIndex] = getLeadingRunWidth(portion, getFirstJoinedRunEnd(portion, breakOffsets, breakIndex, portionEnd))
        }
      } else {
        // Breaks inside each item come from its own text. As in WebKit, the
        // boundary reads the previous item's last two characters as prior
        // context. The next item's first run, and breaks inside its first
        // segment, come from that same analysis. That is a proxy: WebKit takes
        // them from an iterator over the next box alone, while analysis of the
        // item alone joins a leading mark, such as a Myanmar vowel sign, to the
        // word after it, where Safari's spans break after the mark.
        for (let i = 1; i < joinedPortions.length; i++) {
          const portion = joinedPortions[i]!
          const portionEnd = i + 1 < joinedPortions.length ? joinedPortions[i + 1]!.start : joinedText.length
          const context = boundaryContexts[joinedPortions[i - 1]!.itemIndex]!
          const leadingSpace = isCollapsibleBoundaryWhitespace(context.charCodeAt(0))
          const priorText = leadingSpace ? context.slice(1) : context
          const contextOffsets = getJoinedBreakOffsets(priorText + joinedText.slice(portion.start, portionEnd), leadingSpace, profile)
          const breakOffsets: number[] = []
          for (let k = 0; k < contextOffsets.length; k++) {
            if (contextOffsets[k]! >= priorText.length) breakOffsets.push(portion.start + contextOffsets[k]! - priorText.length)
          }
          portion.item.breakBefore = breakOffsets[0] === portion.start
          recordFirstSegmentBreaks(portion, breakOffsets)
          if (portion.item.breakBefore) continue
          joinedPortions[i - 1]!.item.lastRunStart = getLastItemRunStart(joinedPortions[i - 1]!)
          leadingRunWidths[portion.itemIndex] = getLeadingRunWidth(portion, getFirstJoinedRunEnd(portion, breakOffsets, 0, portionEnd))
        }
      }
    }
    joinedPortions.length = 0
    joinedAfterWhitespace = afterWhitespace
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const letterSpacing = item.letterSpacing ?? 0
    // The item's own segment break transformation can remove a boundary run.
    // Context from a neighboring item is not modeled.
    const text = removeSegmentBreaksNextToZeroWidthSpace(item.text, profile)
    let start = 0
    while (start < text.length && isCollapsibleBoundaryWhitespace(text.charCodeAt(start))) start++

    if (start === text.length) {
      if (start > 0 && pendingGapWidth === null) {
        pendingGapWidth = getCollapsedSpaceWidth(item.font, letterSpacing)
      }
      continue
    }

    // Scan from the ends once. A trailing-whitespace regex retries every
    // position in a long internal space run when later content prevents a match.
    let end = text.length
    while (end > start && isCollapsibleBoundaryWhitespace(text.charCodeAt(end - 1))) end--
    const hasLeadingWhitespace = start > 0
    const hasTrailingWhitespace = end < text.length
    const whitespaceBefore = pendingGapWidth !== null || hasLeadingWhitespace
    if (inlineItemBreaks === 'item-text') boundaryContexts[index] = text.slice(Math.max(0, end - 2), end)

    const gapBefore = pendingGapWidth ?? (
      hasLeadingWhitespace ? getCollapsedSpaceWidth(item.font, letterSpacing) : 0
    )
    // Normalization already drops boundary whitespace, so the item's own text
    // yields the same segments while analysis keeps the source before them:
    // a leading SPACE or TAB is break context inside the item's text node.
    // Fragment cursors then index the same handle as prepareWithSegments(item.text).
    const prepared = prepareWithSegments(
      item.text,
      item.font,
      letterSpacing === 0 ? undefined : { letterSpacing },
    )
    // The flat walker can omit source controls at line start. Its result is
    // a measurement observation, not the rich item's identity or source end.
    const wholeWidth = measureWholeItem(prepared)
    const establishesLine = wholeWidth !== null || prepared.kinds.includes('zero-width-break')

    const preparedItem = {
      break: item.break ?? 'normal',
      breakBefore: whitespaceBefore || breakAfterPreviousItem,
      carryWidth: 0,
      establishesLine,
      extraWidth: item.extraWidth ?? 0,
      gapBefore,
      lastRunStart: EMPTY_LAYOUT_CURSOR,
      joinedBreaks: null,
      localOnlyBreaks: null,
      naturalWidth: wholeWidth ?? 0,
      prepared,
    } satisfies PreparedRichInlineItem
    preparedItems[index] = preparedItem

    if (inlineItemBreaks === 'item-boundary') {
      if (establishesLine) {
        const lastKind = prepared.kinds.at(-1)
        breakAfterPreviousItem = lastKind === 'zero-width-break' || lastKind === 'control'
      }
    } else {
      if (previousItem === null || whitespaceBefore || preparedItem.break === 'never' || previousItem.break === 'never') {
        finishJoinedText(whitespaceBefore)
        preparedItem.breakBefore = whitespaceBefore || previousItem !== null
      }
      if (preparedItem.break === 'never') {
        finishJoinedText(false)
      } else {
        // Normal-mode segments hold single collapsed spaces. Text beyond the
        // first and last of them cannot reach a neighboring item's boundary.
        const { kinds } = prepared
        const firstSpace = kinds.indexOf('space')
        joinedPortions.push({
          item: preparedItem,
          itemIndex: index,
          start: 0,
          startSegmentIndex: 0,
          spaceEndSegmentIndex: firstSpace < 0 ? -1 : firstSpace + 1,
        })
        if (firstSpace >= 0) {
          finishJoinedText(true)
          joinedPortions.push({
            item: preparedItem,
            itemIndex: index,
            start: 0,
            startSegmentIndex: kinds.lastIndexOf('space') + 1,
            spaceEndSegmentIndex: -1,
          })
        }
      }
      previousItem = preparedItem
    }

    pendingGapWidth = hasTrailingWhitespace
      ? getCollapsedSpaceWidth(item.font, letterSpacing)
      : null
  }

  if (inlineItemBreaks !== 'item-boundary') {
    finishJoinedText(false)

    // Without a break at the next boundary, the next item's leading run stays
    // with this item's last run. A run that spans a whole item continues further.
    let nextItem: PreparedRichInlineItem | null = null
    let nextIndex = -1
    for (let index = preparedItems.length - 1; index >= 0; index--) {
      const item = preparedItems[index]
      if (item === undefined || !item.establishesLine) continue
      if (nextItem !== null && !nextItem.breakBefore) {
        const runWidth = leadingRunWidths[nextIndex] ?? null
        item.carryWidth = nextItem.extraWidth + (
          runWidth === null
            ? nextItem.naturalWidth + nextItem.carryWidth
            : runWidth
        )
      }
      nextItem = item
      nextIndex = index
    }
  }

  return {
    items: preparedItems,
  } as InternalPreparedRichInline
}

function stepRichInlineLine(
  flow: InternalPreparedRichInline,
  maxWidth: number,
  cursor: RichInlineCursor,
  collectFragment?: RichInlineFragmentCollector,
): number | null {
  if (flow.items.length === 0 || cursor.itemIndex >= flow.items.length) return null

  const safeWidth = Math.max(1, maxWidth)
  const lineFitEpsilon = getEngineProfile().lineFitEpsilon
  let hasContent = false
  let lineWidth = 0
  let remainingWidth = safeWidth
  let itemIndex = cursor.itemIndex

  lineLoop:
  while (itemIndex < flow.items.length) {
    const item = flow.items[itemIndex]
    if (item === undefined) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }
    if (
      !isLineStartCursor(cursor) &&
      cursor.segmentIndex === item.prepared.segments.length &&
      cursor.graphemeIndex === 0
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    // Retain inactive source items in the original coordinate space without
    // turning their mere presence into a line. Their prior layout behavior is
    // unchanged; a following line can still expose their consumed source.
    if (!item.establishesLine) {
      collectFragment?.(itemIndex, 0, 0, cloneCursor(EMPTY_LAYOUT_CURSOR), {
        segmentIndex: item.prepared.segments.length,
        graphemeIndex: 0,
      })
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const gapBefore = hasContent ? item.gapBefore : 0
    const atItemStart = isLineStartCursor(cursor)

    if (item.break === 'never') {
      if (!atItemStart) {
        itemIndex++
        cursor.segmentIndex = 0
        cursor.graphemeIndex = 0
        continue
      }

      const occupiedWidth = item.naturalWidth + item.extraWidth
      const totalWidth = gapBefore + occupiedWidth
      if (hasContent && totalWidth > remainingWidth) break lineLoop

      collectFragment?.(
        itemIndex,
        gapBefore,
        occupiedWidth,
        cloneCursor(EMPTY_LAYOUT_CURSOR),
        {
          segmentIndex: item.prepared.segments.length,
          graphemeIndex: 0,
        },
      )
      hasContent = true
      lineWidth += totalWidth
      remainingWidth = safeWidth - lineWidth
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const reservedWidth = gapBefore + item.extraWidth
    if (hasContent && reservedWidth > remainingWidth) break lineLoop

    // When following items continue this item's last run without a break,
    // the run moves to a later line with them if the line already has an
    // earlier ordinary break: inside this item, or at its start boundary.
    // A run that began the line can still take an overflow break later. The
    // carry fits like the line walker's content, within its fit epsilon.
    const carryWidth = item.carryWidth

    if (atItemStart) {
      const totalWidth = reservedWidth + item.naturalWidth
      if (
        totalWidth <= remainingWidth &&
        (
          carryWidth === 0 ||
          totalWidth + carryWidth <= remainingWidth + lineFitEpsilon ||
          (isLineStartCursor(item.lastRunStart) && !(hasContent && item.breakBefore))
        )
      ) {
        collectFragment?.(
          itemIndex,
          gapBefore,
          item.naturalWidth + item.extraWidth,
          cloneCursor(EMPTY_LAYOUT_CURSOR),
          {
            segmentIndex: item.prepared.segments.length,
            graphemeIndex: 0,
          },
        )
        hasContent = true
        lineWidth += totalWidth
        remainingWidth = safeWidth - lineWidth
        itemIndex++
        cursor.segmentIndex = 0
        cursor.graphemeIndex = 0
        continue
      }
    }

    const availableWidth = Math.max(1, remainingWidth - reservedWidth)
    const lineEnd: LineBreakCursor = {
      segmentIndex: cursor.segmentIndex,
      graphemeIndex: cursor.graphemeIndex,
    }
    let lineWidthForItem = stepPreparedLineGeometry(item.prepared, lineEnd, availableWidth)
    if (lineWidthForItem === null) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }
    if (
      cursor.segmentIndex === lineEnd.segmentIndex &&
      cursor.graphemeIndex === lineEnd.graphemeIndex
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    let itemOccupiedWidth = lineWidthForItem + item.extraWidth
    let lineWidthContribution = gapBefore + itemOccupiedWidth

    // The lower-level walker may force one unit to make progress. If that unit
    // only fits on a fresh line, wrap before this rich item instead.
    if (hasContent && atItemStart && lineWidthContribution > remainingWidth) break lineLoop

    // Preserve ordinary breaks before emergency splitting the next word: the
    // last one the joined text offers inside its first segment, else the item
    // boundary. SPACE advance need not be positive; ZWSP has no gap at all.
    if (hasContent && atItemStart && endsInsideFirstSegment(lineEnd.segmentIndex, lineEnd.graphemeIndex)) {
      const leadingBreak = getLatestJoinedBreak(item.joinedBreaks, cursor, {
        segmentIndex: 0,
        graphemeIndex: lineEnd.graphemeIndex + 1,
      })
      const width = leadingBreak === null ? null : stepItemToBreak(item.prepared, cursor, availableWidth, leadingBreak, lineEnd)
      if (width !== null) {
        lineWidthForItem = width
        itemOccupiedWidth = lineWidthForItem + item.extraWidth
        lineWidthContribution = gapBefore + itemOccupiedWidth
      } else if (item.breakBefore) {
        break lineLoop
      }
    } else if (
      item.localOnlyBreaks !== null &&
      lineEnd.graphemeIndex === 0 &&
      item.localOnlyBreaks.includes(lineEnd.segmentIndex)
    ) {
      // The item's own segmentation broke inside a word of the joined text.
      // End at the joined text's latest break before it instead, or fill that
      // word's graphemes when it began the line.
      const joinedBreak = getLatestJoinedBreak(item.joinedBreaks, cursor, lineEnd)
      const width = joinedBreak !== null
        ? stepItemToBreak(item.prepared, cursor, availableWidth, joinedBreak, lineEnd)
        : hasContent ? null : fillItemSegment(item.prepared, cursor, availableWidth, lineEnd.segmentIndex, lineEnd)
      if (width !== null) {
        lineWidthForItem = width
        itemOccupiedWidth = lineWidthForItem + item.extraWidth
        lineWidthContribution = gapBefore + itemOccupiedWidth
      } else if (joinedBreak === null && hasContent && item.breakBefore) {
        break lineLoop
      }
    }

    if (
      carryWidth !== 0 &&
      lineEnd.segmentIndex === item.prepared.segments.length &&
      lineEnd.graphemeIndex === 0 &&
      lineWidthContribution + carryWidth > remainingWidth + lineFitEpsilon
    ) {
      const runStart = item.lastRunStart
      if (isBeforeCursor(cursor, runStart)) {
        const beforeRunWidth = stepItemToBreak(item.prepared, cursor, availableWidth, runStart, lineEnd)
        if (beforeRunWidth !== null) {
          lineWidthForItem = beforeRunWidth
          itemOccupiedWidth = lineWidthForItem + item.extraWidth
          lineWidthContribution = gapBefore + itemOccupiedWidth
        } else if (hasContent && atItemStart) {
          // Only source consumed at a line start, such as SHY, precedes the run.
          break lineLoop
        }
      } else if (hasContent && atItemStart && item.breakBefore) {
        break lineLoop
      }
    }

    collectFragment?.(
      itemIndex,
      gapBefore,
      itemOccupiedWidth,
      cloneCursor(cursor),
      {
        segmentIndex: lineEnd.segmentIndex,
        graphemeIndex: lineEnd.graphemeIndex,
      },
    )
    hasContent = true
    lineWidth += lineWidthContribution
    remainingWidth = safeWidth - lineWidth

    if (
      lineEnd.segmentIndex === item.prepared.segments.length &&
      lineEnd.graphemeIndex === 0
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    cursor.segmentIndex = lineEnd.segmentIndex
    cursor.graphemeIndex = lineEnd.graphemeIndex
    break
  }

  if (!hasContent) return null

  cursor.itemIndex = itemIndex
  return lineWidth
}

export function layoutNextRichInlineLineRange(
  prepared: PreparedRichInline,
  maxWidth: number,
  start: RichInlineCursor = RICH_INLINE_START_CURSOR,
): RichInlineLineRange | null {
  const flow = getInternalPreparedRichInline(prepared)
  const end: RichInlineCursor = {
    itemIndex: start.itemIndex,
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const fragments: RichInlineFragmentRange[] = []
  const width = stepRichInlineLine(flow, maxWidth, end, (itemIndex, gapBefore, occupiedWidth, fragmentStart, fragmentEnd) => {
    fragments.push({
      itemIndex,
      gapBefore,
      occupiedWidth,
      start: fragmentStart,
      end: fragmentEnd,
    })
  })
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
    getLineTextCache(item.prepared),
    fragment.start.segmentIndex,
    fragment.start.graphemeIndex,
    fragment.end.segmentIndex,
    fragment.end.graphemeIndex,
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
  let lineCount = 0
  let maxLineWidth = 0
  const cursor: RichInlineCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  }

  while (true) {
    const lineWidth = stepRichInlineLine(flow, maxWidth, cursor)
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
