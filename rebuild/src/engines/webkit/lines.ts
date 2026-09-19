// WebKit line filling (Safari 27.0): Line bookkeeping, InlineContentBreaker with breakWord and the carried remainder, the
// line builders, TextOnlySimpleLineBuilder (also run inside RangeBasedLineBuilder) and LineBuilder
// (specs/webkit-lines.md §1, §4-§9), the line rect from floats and text-indent, run-based alignment, and the decided line
// (types.ts): the closed Line::Run list with what it was filled from, which output.ts, gaps.ts and history.ts read. Cited at
// WebKit-7625.1.29.11.27 under Source/WebCore/layout/formattingContexts/inline/: IL = InlineLine.cpp,
// ICB = InlineContentBreaker.cpp, TOS = TextOnlySimpleLineBuilder.cpp, ILB = InlineLineBuilder.cpp,
// IFU = InlineFormattingUtils.cpp, ALB = AbstractLineBuilder.cpp, IDCB = display/InlineDisplayContentBuilder.cpp,
// IDLB = display/InlineDisplayLineBuilder.cpp, LBB = InlineLineBoxBuilder.cpp.
import { width as canvasWidth } from '../../measure/canvas.js'
import type { LineSlot } from '../../model.js'
import { canBreakBefore, findNextBreakablePosition, makeFactory, mayBreakInBetween } from './breaks.js'
import { applyTextAlignJustify } from './expansion.js'
import { breakTestBetweenBoxes, emergencyBreakIn8BitText, hyphenWidthRead, shapedAcrossInlineBoxes, type GapSink } from './gaps.js'
import type { WebKitLineStart } from './geometry.js'
import { joinsAcross } from './joining.js'
import { boxWidth, breakWord, canvasString, codePointStart, firstUserPerceivedCharacterLength, forwardOneCodePoint, itemWidth } from './measure.js'
import { endEdgeWidth, layoutUnit, preservesSpacesAndTabs, startEdgeWidth, trailingWhitespaceHangs } from './style.js'
import {
  DEFAULT_BIDI_LEVEL, OPAQUE_BIDI_LEVEL, type Line, type LineLogicalRect, type LineRun, type ShapingBoundary, type TextRun, type TrailingWhitespace, type WebKitBox,
  type WebKitBoxEdges, type WebKitElement, type WebKitFillResult, type WebKitItem, type WebKitPrepared, type WebKitStyle, type WebKitTextItem,
} from './types.js'

const f32 = Math.fround
const F32_MAX = 3.4028234663852886e38

// What filling one line reads. `lineWidth` is m_lineLogicalRect.width(); `gaps` collects the gaps this line's filling
// decides, on an inspected paragraph (gaps.ts GapSink).
type Layout = { p: WebKitPrepared; lineWidth: number; contentEdgeOffset: number; constrainedByFloat: boolean; gaps: GapSink }
type SoftLineBreakItem = Extract<WebKitItem, { kind: 'soft-line-break' }>
type HardLineBreakItem = Extract<WebKitItem, { kind: 'hard-line-break' }>
type LineBreakItem = SoftLineBreakItem | HardLineBreakItem
type WordBreakOpportunityItem = Extract<WebKitItem, { kind: 'word-break-opportunity' }>
type InlineBoxItem = Extract<WebKitItem, { kind: 'inline-box-start' | 'inline-box-end' }>
type AtomicItem = Extract<WebKitItem, { kind: 'atomic' }>
type ElementItem = InlineBoxItem | AtomicItem | HardLineBreakItem | WordBreakOpportunityItem
type ContentItem = WebKitTextItem | InlineBoxItem | AtomicItem
type Position = { index: number; offset: number }

// ---- Styles and layout boxes ----

// The span's box edges, or none for a text leaf's parent that is the block.
export function spanEdges(p: WebKitPrepared, element: number): WebKitBoxEdges {
  const e = p.elements[element]!
  if (e.kind !== 'span') throw new Error(`element ${element} is ${e.kind}, not an inline box`)
  return e.edges
}

// The atomic inline an item or a run stands for.
export function atomicElement(p: WebKitPrepared, element: number): Extract<WebKitElement, { kind: 'atomic' }> {
  const e = p.elements[element]!
  if (e.kind !== 'atomic') throw new Error(`element ${element} isn't atomic`)
  return e
}

function styleOfElement(p: WebKitPrepared, element: number): WebKitStyle {
  if (element < 0) return p.style
  const e = p.elements[element]!
  if (e.kind !== 'span') throw new Error(`element ${element} is ${e.kind}, which holds no content`)
  return e.style
}

// The layout box's parent: a text box's span or block, an inline box's or atomic box's parent element (-1 is the block).
function parentOf(p: WebKitPrepared, item: WebKitItem): number {
  switch (item.kind) {
    case 'text':
    case 'soft-line-break':
      return p.boxes[item.box]!.parent
    case 'inline-box-start':
    case 'inline-box-end':
    case 'atomic':
    case 'hard-line-break':
    case 'word-break-opportunity':
      return p.elements[item.element]!.parent
  }
}

// InlineItem::style(): a text item's is its text box's (inherited from the parent), an inline box's its own, an atomic
// inline's, <br>'s and <wbr>'s their parent's in the model, which gives those elements no wrapping styles of their own.
function itemStyle(p: WebKitPrepared, item: WebKitItem): WebKitStyle {
  switch (item.kind) {
    case 'text':
    case 'soft-line-break':
      return p.boxes[item.box]!.style
    case 'inline-box-start':
    case 'inline-box-end':
      return styleOfElement(p, item.element)
    case 'atomic':
    case 'hard-line-break':
    case 'word-break-opportunity':
      return styleOfElement(p, p.elements[item.element]!.parent)
  }
}

// TextUtil::hyphenWidth (TextUtil.cpp:621-624), read while filling a line: the hyphen string measured through the cascade.
// gaps.ts gets the total, which it holds the other hyphen's against (gap hyphen-glyph).
function lineHyphenWidth(L: Layout, boxIndex: number): number {
  const box = L.p.boxes[boxIndex]!
  const total = canvasWidth(box.context, box.hyphen)
  hyphenWidthRead(L.gaps, L.p, boxIndex, total)
  return Math.max(0, total)
}

// ---- Line (IL, InlineLine.h) ----

// Line::initialize (IL:48-78): a line starting inside spans begins with their spanning inline box starts, outermost first,
// at the opaque bidi level, without widths (box-decoration-break: slice).
function newLine(spanning: readonly number[]): Line {
  const line: Line = { runs: [], contentLogicalWidth: 0, trimmable: null, trimmedUnit: null, hanging: null, trailingSoftHyphenWidth: null, hasNonDefaultBidiLevelRun: false, inlineBoxLogicalLeftStack: [] }
  for (let i = 0; i < spanning.length; i++) line.runs.push({ kind: 'spanning-inline-box-start', element: spanning[i]!, left: 0, width: 0, level: OPAQUE_BIDI_LEVEL })
  return line
}

// The run of an element's item.
function elementRun(item: ElementItem, left: number, width: number): LineRun {
  return { kind: item.kind, element: item.element, sourceOffset: item.sourceOffset, left, width, level: item.level }
}

export function lastRunLogicalRight(line: Line): number {
  const last = line.runs[line.runs.length - 1]
  return last === undefined ? 0 : f32(last.left + last.width)
}

// Line::resetTrailingContent (IL:80-85).
function resetTrailingContent(line: Line): void {
  line.trimmable = null
  line.hanging = null
  line.trailingSoftHyphenWidth = null
}

// Line::Run::isLineBreak (InlineLine.h:118).
function isLineBreakRun(run: LineRun | undefined): boolean {
  return run !== undefined && (run.kind === 'soft-line-break' || run.kind === 'hard-line-break')
}

// Line::Run::isContentful (InlineLine.h:129), and Line::hasContent (InlineLine.h:338-348).
function isContentfulRun(run: LineRun): boolean {
  return (run.kind === 'text' && run.textLength > 0) || isLineBreakRun(run) || run.kind === 'atomic'
}

function hasContent(line: Line): boolean {
  for (let i = line.runs.length - 1; i >= 0; i--) if (isContentfulRun(line.runs[i]!)) return true
  return false
}

// Line::Run::isContentfulOrHasDecoration (IL:989-1008) with box-decoration-break: slice.
function isContentfulOrHasDecorationRun(p: WebKitPrepared, run: LineRun): boolean {
  if (isContentfulRun(run)) return true
  switch (run.kind) {
    case 'inline-box-start': return run.width !== 0 || hasNonZeroStartEdge(spanEdges(p, run.element))
    case 'inline-box-end': return run.width !== 0 || hasNonZeroEndEdge(spanEdges(p, run.element))
    case 'text':
    case 'soft-line-break':
    case 'hard-line-break':
    case 'word-break-opportunity':
    case 'atomic':
    case 'spanning-inline-box-start':
      return false
  }
}

// Line::lineHasVisuallyNonEmptyContent (IL:621-629), the isContentful of Line::close.
export function lineHasVisuallyNonEmptyContent(p: WebKitPrepared, line: Line): boolean {
  for (let i = line.runs.length - 1; i >= 0; i--) if (isContentfulOrHasDecorationRun(p, line.runs[i]!)) return true
  return false
}

// Line::Run::trailingWhitespaceType (IL:813-822).
function trailingWhitespaceType(p: WebKitPrepared, item: WebKitTextItem): TrailingWhitespace['type'] | null {
  if (!item.isWhitespace) return null
  if (preservesSpacesAndTabs(p.boxes[item.box]!.style)) return 'not-collapsible'
  return item.end - item.start === 1 ? 'collapsible' : 'collapsed'
}

// Line::Run::hasCollapsibleTrailingWhitespace and hasCollapsedTrailingWhitespace (InlineLine.h:202-203).
function hasCollapsibleTrailingWhitespace(run: TextRun): boolean {
  return run.trailingWhitespace !== null && run.trailingWhitespace.type !== 'not-collapsible'
}

function hasCollapsedTrailingWhitespace(run: TextRun): boolean {
  return run.trailingWhitespace !== null && run.trailingWhitespace.type === 'collapsed'
}

function isZeroWidthSpaceSeparator(p: WebKitPrepared, item: WebKitTextItem): boolean {
  const length = item.end - item.start
  return length === 0 || (length === 1 && p.boxes[item.box]!.text.charCodeAt(item.start) === 0x200b)
}

function textRun(p: WebKitPrepared, item: WebKitTextItem, left: number, width: number, shapingBoundary: ShapingBoundary | null): TextRun {
  const type = trailingWhitespaceType(p, item)
  const length = type === 'collapsed' ? 1 : item.end - item.start
  return {
    kind: 'text', box: item.box, isWordSeparator: item.isWordSeparator, left, width, level: item.level, textStart: item.start, textLength: length, needsHyphen: false,
    trailingWhitespace: type === null ? null : { type, length, width }, lastNonWhitespaceContentStart: null, expansion: 0, expansionBehavior: { left: 'allow', right: 'allow' },
    shapingBoundary,
  }
}

// Line::Run::expand (IL:891-916)
function expandRun(p: WebKitPrepared, run: TextRun, item: WebKitTextItem, width: number): void {
  run.width = f32(run.width + width)
  const type = trailingWhitespaceType(p, item)
  if (type === null) {
    run.trailingWhitespace = null
    run.textLength += item.end - item.start
    run.lastNonWhitespaceContentStart = item.start
    return
  }
  const whitespaceWidth = run.trailingWhitespace === null ? width : f32(run.trailingWhitespace.width + width)
  const length = type === 'collapsed' ? 1 : item.end - item.start
  run.trailingWhitespace = { type, length, width: whitespaceWidth }
  run.textLength += length
}

function updateTrailingContent(L: Layout, line: Line, item: WebKitTextItem, width: number, oldContentLogicalWidth: number): void {
  line.trailingSoftHyphenWidth = null
  const style = L.p.boxes[item.box]!.style
  const isTrimmable = item.isWhitespace && !preservesSpacesAndTabs(style)
  if (isTrimmable) {
    // TrimmableTrailingContent::addFullyTrimmableContent (IL:723-732)
    const offset = f32(f32(line.contentLogicalWidth - oldContentLogicalWidth) - width)
    line.trimmable = { runIndex: line.trimmable === null ? line.runs.length - 1 : line.trimmable.runIndex, offset, width: f32(offset + width) }
  } else {
    line.trimmable = null
  }
  line.hanging = !isTrimmable && item.isWhitespace && trailingWhitespaceHangs(style) ? { length: item.end - item.start, width } : null
  if (item.hasTrailingSoftHyphen) line.trailingSoftHyphenWidth = lineHyphenWidth(L, item.box)
}

// Line::appendText (IL:346-481), LineBuilder's variant.
function appendText(L: Layout, line: Line, item: WebKitTextItem, width: number, shapingBoundary: ShapingBoundary | null): void {
  const p = L.p
  const box = p.boxes[item.box]!
  const preserve = preservesSpacesAndTabs(box.style)
  let willCollapseCompletely = false
  if (item.isWhitespace && !preserve) {
    willCollapseCompletely = true
    for (let i = line.runs.length - 1; i >= 0; i--) {
      const run = line.runs[i]!
      if (run.kind === 'atomic') {
        willCollapseCompletely = false
        break
      }
      if (run.kind !== 'text') continue
      willCollapseCompletely = hasCollapsibleTrailingWhitespace(run)
      break
    }
  }
  if (willCollapseCompletely) return
  const last = line.runs[line.runs.length - 1]
  // The run the item expands, or null where it needs a run of its own.
  const expanded = last === undefined || last.kind !== 'text' || last.box !== item.box || last.level !== item.level
    || hasCollapsedTrailingWhitespace(last)
    || (box.style.wordSpacing !== 0 && (item.isWordSeparator || (last.isWordSeparator && last.level !== DEFAULT_BIDI_LEVEL)))
    || isZeroWidthSpaceSeparator(p, item)
    || (box.style.rtl && preserve && item.isWhitespace !== (last.trailingWhitespace !== null && last.trailingWhitespace.length === last.textLength))
    || shapingBoundary !== null || last.shapingBoundary !== null ? null : last
  const oldContentLogicalWidth = line.contentLogicalWidth
  let contentLogicalRight: number
  if (expanded === null) {
    const left = f32(lastRunLogicalRight(line) + (item.isWordSeparator ? box.style.wordSpacing : 0))
    line.runs.push(textRun(p, item, left, width, shapingBoundary))
    contentLogicalRight = f32(left + width)
  } else if (box.letterSpacing >= 0) {
    expandRun(p, expanded, item, width)
    contentLogicalRight = f32(expanded.left + expanded.width)
  } else {
    let withoutLastTextRun: number
    if (box.style.wordSpacing >= 0) {
      withoutLastTextRun = f32(line.contentLogicalWidth - Math.max(0, expanded.width))
    } else {
      let rightMost = 0
      for (let i = line.runs.length - 1; i >= 0; i--) rightMost = Math.max(rightMost, f32(line.runs[i]!.left + line.runs[i]!.width))
      withoutLastTextRun = Math.max(0, rightMost)
    }
    const lastRight = f32(expanded.left + expanded.width)
    expandRun(p, expanded, item, width)
    contentLogicalRight = Math.max(withoutLastTextRun, f32(lastRight + width))
  }
  line.contentLogicalWidth = Math.max(oldContentLogicalWidth, contentLogicalRight)
  updateTrailingContent(L, line, item, width, oldContentLogicalWidth)
}

// Line::appendTextFast (IL:483-556), the simple builder's variant: its line holds text runs alone while it is filled.
function appendTextFast(L: Layout, line: Line, item: WebKitTextItem, width: number): void {
  const p = L.p
  const box = p.boxes[item.box]!
  const last = line.runs[line.runs.length - 1] as TextRun | undefined
  const willCollapseCompletely = item.isWhitespace && !preservesSpacesAndTabs(box.style) && (last === undefined || hasCollapsibleTrailingWhitespace(last))
  if (willCollapseCompletely) return
  // The run the item expands, or null where it needs a run of its own.
  const expanded = last === undefined || hasCollapsedTrailingWhitespace(last) || last.box !== item.box || isZeroWidthSpaceSeparator(p, item) ? null : last
  const oldContentLogicalWidth = line.contentLogicalWidth
  if (expanded === null) {
    const left = lastRunLogicalRight(line)
    line.runs.push(textRun(p, item, left, width, null))
    line.contentLogicalWidth = f32(left + width)
  } else if (box.letterSpacing >= 0) {
    expandRun(p, expanded, item, width)
    line.contentLogicalWidth = f32(expanded.left + expanded.width)
  } else {
    const withoutLastTextRun = f32(line.contentLogicalWidth - Math.max(0, expanded.width))
    const lastRight = f32(expanded.left + expanded.width)
    expandRun(p, expanded, item, width)
    line.contentLogicalWidth = Math.max(withoutLastTextRun, f32(lastRight + width))
  }
  updateTrailingContent(L, line, item, width, oldContentLogicalWidth)
}

// Line::appendInlineBoxStart (IL:289-315).
function appendInlineBoxStart(p: WebKitPrepared, line: Line, item: InlineBoxItem, width: number): void {
  const edges = spanEdges(p, item.element)
  if (startEdgeWidth(edges) !== 0) line.hanging = null
  let left = lastRunLogicalRight(line)
  let logicalWidth = width
  // Do not let negative margin make the content shorter than it already is.
  line.contentLogicalWidth = Math.max(line.contentLogicalWidth, f32(left + logicalWidth))
  if (edges.marginStart < 0) {
    left = f32(left + edges.marginStart)
    logicalWidth = f32(logicalWidth - edges.marginStart)
  }
  // usedLetterSpacing of the inline box: its CSS letter spacing, which spans carry in the model.
  if (inlineBoxLetterSpacing(p, item.element) < 0) line.inlineBoxLogicalLeftStack.push(left)
  line.runs.push(elementRun(item, left, logicalWidth))
}

// Line::appendInlineBoxEnd (IL:317-344). Partially trimmable trailing content comes from text-spacing trim, which the model
// doesn't have, so there is no trailing letter spacing to remove.
function appendInlineBoxEnd(p: WebKitPrepared, line: Line, item: InlineBoxItem, width: number): void {
  const edges = spanEdges(p, item.element)
  if (endEdgeWidth(edges) !== 0) line.hanging = null
  let left = lastRunLogicalRight(line)
  if (inlineBoxLetterSpacing(p, item.element) < 0) left = Math.max(left, line.inlineBoxLogicalLeftStack.length === 0 ? 0 : line.inlineBoxLogicalLeftStack.pop()!)
  line.runs.push(elementRun(item, left, width))
  line.contentLogicalWidth = Math.max(line.contentLogicalWidth, f32(left + width))
}

function inlineBoxLetterSpacing(p: WebKitPrepared, element: number): number {
  const e = p.elements[element]!
  return e.kind === 'span' ? e.letterSpacing : 0
}

// Line::appendAtomicInlineBox (IL:558-574).
function appendAtomicInlineBox(p: WebKitPrepared, line: Line, item: AtomicItem, marginBoxWidth: number): void {
  resetTrailingContent(line)
  line.contentLogicalWidth = Math.max(line.contentLogicalWidth, f32(lastRunLogicalRight(line) + marginBoxWidth))
  const e = atomicElement(p, item.element)
  if (e.marginStart >= 0) {
    line.runs.push(elementRun(item, lastRunLogicalRight(line), marginBoxWidth))
    return
  }
  line.runs.push(elementRun(item, f32(lastRunLogicalRight(line) + e.marginStart), f32(marginBoxWidth - e.marginStart)))
}

// Line::appendLineBreak (IL:588-597): a soft line break run holds its one unit, { position, 1 } (IL:856-865); a hard line
// break run is the <br>'s box.
function appendLineBreak(line: Line, item: LineBreakItem): void {
  line.trailingSoftHyphenWidth = null
  switch (item.kind) {
    case 'hard-line-break': line.runs.push(elementRun(item, lastRunLogicalRight(line), 0)); break
    case 'soft-line-break': line.runs.push({ kind: 'soft-line-break', box: item.box, textStart: item.start, left: lastRunLogicalRight(line), width: 0, level: item.level }); break
  }
}

// Line::appendWordBreakOpportunity (IL:599-602).
function appendWordBreakOpportunity(line: Line, item: WordBreakOpportunityItem): void {
  line.runs.push(elementRun(item, lastRunLogicalRight(line), 0))
}

// Line::addTrailingHyphen (IL:609-619) with Line::Run::setNeedsHyphen (InlineLine.h:388-393).
function addTrailingHyphen(line: Line, width: number): void {
  for (let i = line.runs.length - 1; i >= 0; i--) {
    const run = line.runs[i]!
    if (run.kind !== 'text') continue
    run.needsHyphen = true
    run.width = f32(run.width + width)
    line.contentLogicalWidth = f32(line.contentLogicalWidth + width)
    return
  }
}

// Line::handleTrailingTrimmableContent(Remove) with TrimmableTrailingContent::remove (IL:112-125, 745-778) and
// Line::Run::removeTrailingWhitespace (IL:963-987).
function handleTrailingTrimmableContent(L: Layout, line: Line): void {
  if (line.trimmable === null || line.runs.length === 0) return
  const index = line.trimmable.runIndex
  // The trimmable run is text that ends with the trimmable white space (IL:753, :965).
  const run = line.runs[index] as TextRun
  let whitespaceWidth = run.trailingWhitespace!.width
  if (run.lastNonWhitespaceContentStart !== null && L.p.style.rtl) {
    const box = L.p.boxes[run.box]!
    const start = run.lastNonWhitespaceContentStart
    const end = run.textStart + run.textLength
    // TextUtil::trailingWhitespaceWidth (TextUtil.cpp:124-130)
    if (box.text.charCodeAt(end - 1) === 0x20) {
      whitespaceWidth = f32(boxWidth(box, start, end, 0, true) - boxWidth(box, start, end - 1, 0, false))
    }
  }
  line.trimmedUnit = { box: run.box, offset: run.textStart + run.textLength - 1, level: run.level }
  run.textLength -= 1
  run.trailingWhitespace = null
  run.width = f32(run.width - whitespaceWidth)
  const trimmed = f32(line.trimmable.offset + whitespaceWidth)
  for (let i = index + 1; i < line.runs.length; i++) line.runs[i]!.left = f32(line.runs[i]!.left - trimmed)
  if (run.textLength === 0) line.runs.splice(index, 1)
  line.trimmable = null
  line.contentLogicalWidth = f32(line.contentLogicalWidth - trimmed)
}

// Line::Run::detachTrailingWhitespace (IL:918-941): the run's trailing white space as a run of its own.
function detachTrailingWhitespace(run: TextRun, whitespace: TrailingWhitespace): TextRun {
  const leadingLength = run.textLength - whitespace.length
  const detached: TextRun = {
    ...run, textStart: run.textStart + leadingLength, textLength: whitespace.length, needsHyphen: false, width: whitespace.width,
    left: f32(f32(run.left + run.width) - whitespace.width), trailingWhitespace: null, lastNonWhitespaceContentStart: null, expansionBehavior: { ...run.expansionBehavior },
  }
  run.width = f32(run.width - whitespace.width)
  run.textLength = leadingLength
  run.trailingWhitespace = null
  return detached
}

// Line::resetBidiLevelForTrailingWhitespace (IL:243-287), after trimming and hanging: trailing white-space-only runs take
// the root level where their parity differs, and the trailing white space of the last content run with the other parity
// is detached into its own run at the root level.
function resetBidiLevelForTrailingWhitespace(L: Layout, line: Line): void {
  if (!line.hasNonDefaultBidiLevelRun) return
  const rootLevel = L.p.style.rtl ? 1 : 0
  const runs = line.runs
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.kind === 'atomic' || isLineBreakRun(run)) return
    if (run.kind !== 'text') continue
    const whitespace = run.trailingWhitespace
    if (whitespace === null) return
    const sameInlineDirection = run.level % 2 === rootLevel % 2
    if (whitespace.length !== run.textLength) {
      if (sameInlineDirection) return
      const detached = detachTrailingWhitespace(run, whitespace)
      detached.level = rootLevel
      runs.splice(i + 1, 0, detached)
      return
    }
    if (!sameInlineDirection) run.level = rootLevel
  }
}

// Line::handleTrailingHangingContent (IL:198-233), outside intrinsic sizing: a conditional hang that fits stops hanging.
// It changes no width, only alignment.
function handleTrailingHangingContent(line: Line, lineWidth: number, isLastFormattedLine: boolean): void {
  if (line.hanging === null || line.hanging.width === 0) return
  const endsWithForcedBreak = isLastFormattedLine || isLineBreakRun(line.runs[line.runs.length - 1])
  if (endsWithForcedBreak && line.contentLogicalWidth <= lineWidth) line.hanging = null
}

// ---- ContinuousContent (ICB:917-1004, InlineContentBreaker.h:84-147) ----

type ContentRun = { item: ContentItem; offset: number; contentWidth: number; shapingBoundary: 'start' | 'end' | null }

type Content = {
  runs: ContentRun[]
  logicalWidth: number
  leadingTrimmableWidth: number
  trailingTrimmableWidth: number
  hangingContentWidth: number | null
  hasTextContent: boolean
  isFullyTrimmable: boolean
  hasTrailingWordSeparator: boolean
  hasShapedContent: boolean
  // LineCandidate::InlineContent's shaping candidacy (ILB:256-288): text next to an inline box start or end.
  lastTextRunIndex: number | null
  lastInlineBoxIndex: number | null
  hasTextContentSpanningBoxes: boolean
}

function newContent(): Content {
  return {
    runs: [], logicalWidth: 0, leadingTrimmableWidth: 0, trailingTrimmableWidth: 0, hangingContentWidth: null, hasTextContent: false,
    isFullyTrimmable: false, hasTrailingWordSeparator: false, hasShapedContent: false, lastTextRunIndex: null, lastInlineBoxIndex: null,
    hasTextContentSpanningBoxes: false,
  }
}

function spaceRequired(run: ContentRun): number {
  return f32(run.offset + run.contentWidth)
}

function appendToRunList(c: Content, item: ContentItem, offset: number, width: number): void {
  c.runs.push({ item, offset, contentWidth: width, shapingBoundary: null })
  c.logicalWidth = f32(f32(c.logicalWidth + offset) + width)
}

function resetTrailingTrimmableContent(c: Content): void {
  if (!c.leadingTrimmableWidth) c.leadingTrimmableWidth = c.trailingTrimmableWidth
  c.trailingTrimmableWidth = 0
  c.isFullyTrimmable = false
}

// ContinuousContent::append (ICB:950-961): inline box starts and ends and atomic inlines.
function appendBoxContent(c: Content, item: InlineBoxItem | AtomicItem, width: number): void {
  if (item.kind !== 'atomic') {
    const numberOfRuns = c.runs.length
    c.hasTextContentSpanningBoxes ||= c.lastTextRunIndex !== null && c.lastTextRunIndex === numberOfRuns - 1
    c.lastInlineBoxIndex = numberOfRuns
  }
  c.hasTrailingWordSeparator = c.hasTrailingWordSeparator && item.kind !== 'atomic'
  appendToRunList(c, item, 0, width)
  if (item.kind === 'atomic') resetTrailingTrimmableContent(c)
}

// ContinuousContent::appendTextContent (ICB:963-1001), over the text box's style.
function appendTextContent(L: Layout, c: Content, item: WebKitTextItem, width: number): void {
  const numberOfRuns = c.runs.length
  c.lastTextRunIndex = numberOfRuns
  c.hasTextContentSpanningBoxes ||= c.lastInlineBoxIndex !== null && c.lastInlineBoxIndex === numberOfRuns - 1
  c.hasTextContent = true
  const isAfterWordSeparator = c.hasTrailingWordSeparator
  c.hasTrailingWordSeparator = item.isWordSeparator
  const box = L.p.boxes[item.box]!
  const hangs = item.isWhitespace && trailingWhitespaceHangs(box.style)
  if (hangs) c.hangingContentWidth = width
  const wordSpacing = box.style.wordSpacing
  // isFullyTrimmable, or isQuirkNonBreakingSpace, which needs -webkit-nbsp-mode: space.
  const trimmable = !hangs && item.isWhitespace && !preservesSpacesAndTabs(box.style)
  if (!trimmable) {
    const offset = isAfterWordSeparator ? wordSpacing : 0
    appendToRunList(c, item, offset, width)
    if (offset && c.isFullyTrimmable) c.leadingTrimmableWidth = f32(c.leadingTrimmableWidth + offset)
    resetTrailingTrimmableContent(c)
    return
  }
  c.isFullyTrimmable = c.isFullyTrimmable || c.runs.length === 0
  const isLeadingTrimmable = !c.logicalWidth || c.isFullyTrimmable
  appendToRunList(c, item, isAfterWordSeparator ? wordSpacing : 0, width)
  if (isLeadingTrimmable) {
    c.leadingTrimmableWidth = f32(c.leadingTrimmableWidth + width)
    return
  }
  c.trailingTrimmableWidth = f32(c.trailingTrimmableWidth + width)
}

// ---- InlineContentBreaker (ICB) ----

// InlineContentBreaker::PartialRun and Result (InlineContentBreaker.h:45-72). A hyphen width comes with hyphens: auto, which
// the model doesn't have; the trailing soft hyphen's is the line's (Line::trailingSoftHyphenWidth).
type PartialRun = { length: number; logicalWidth: number }
type PartialTrailingContent = { trailingRunIndex: number; partialRun: PartialRun | null }
type BreakResult =
  | { action: 'keep' | 'wrap' | 'wrap-with-hyphen' | 'revert-to-last-wrap-opportunity' | 'revert-to-last-non-overflowing-wrap-opportunity'; isEndOfLine: boolean }
  | { action: 'break'; isEndOfLine: true; partialTrailingContent: PartialTrailingContent }
type LineStatus = {
  contentLogicalRight: number
  availableWidth: number
  trimmableOrHangingWidth: number
  trailingSoftHyphenWidth: number | null
  hasFullyTrimmableTrailingContent: boolean
  hasContent: boolean
  hasWrapOpportunityAtPreviousPosition: boolean
}
type TrailingContent = { overflows: boolean; partialRun: PartialRun | null }
type BreakingPosition = { runIndex: number; trailingContent: TrailingContent | null }

function result(action: Exclude<BreakResult['action'], 'break'>, isEndOfLine: boolean): BreakResult {
  return { action, isEndOfLine }
}

function breakAt(trailingRunIndex: number, partialRun: PartialRun | null): BreakResult {
  return { action: 'break', isEndOfLine: true, partialTrailingContent: { trailingRunIndex, partialRun } }
}

function textOf(L: Layout, item: WebKitTextItem): string {
  return L.p.boxes[item.box]!.text
}

function hasLeadingTextContent(c: Content): boolean {
  for (let i = 0; i < c.runs.length; i++) {
    const kind = c.runs[i]!.item.kind
    if (kind === 'inline-box-start' || kind === 'inline-box-end') continue
    return kind === 'text'
  }
  return false
}

function nextTextRunIndex(runs: ContentRun[], start: number): number | null {
  for (let i = start + 1; i < runs.length; i++) if (runs[i]!.item.kind === 'text') return i
  return null
}

function firstTextRunIndex(runs: ContentRun[]): number | null {
  for (let i = 0; i < runs.length; i++) if (runs[i]!.item.kind === 'text') return i
  return null
}

// isWhitespaceOnlyContent (ICB:61-80)
function isWhitespaceOnlyContent(c: Content): boolean {
  let hasWhitespace = false
  for (let i = 0; i < c.runs.length; i++) {
    const item = c.runs[i]!.item
    if (item.kind === 'inline-box-start' || item.kind === 'inline-box-end') continue
    if (item.kind !== 'text' || !item.isWhitespace) return false
    hasWhitespace = true
  }
  return hasWhitespace
}

// isNonContentRunsOnly (ICB:82-95)
function isNonContentRunsOnly(c: Content): boolean {
  for (let i = 0; i < c.runs.length; i++) {
    const item = c.runs[i]!.item
    if (item.kind === 'inline-box-start' || item.kind === 'inline-box-end') continue
    if (item.kind === 'text' && item.end === item.start) continue
    return false
  }
  return true
}

type WordBreakRule = 'none' | 'arbitrary-within-words' | 'arbitrary'

// InlineContentBreaker::wordBreakBehavior (ICB:877-915) over the run's style, with hyphens: manual (no
// AtHyphenationOpportunities).
function wordBreakBehavior(s: WebKitStyle, hasWrapOpportunityAtPreviousPosition: boolean): WordBreakRule {
  if (s.lineBreak === 'anywhere') return 'arbitrary'
  if (s.wordBreak === 'break-all') return 'arbitrary-within-words'
  if (s.wordBreak === 'break-word' && !hasWrapOpportunityAtPreviousPosition) return 'arbitrary'
  if ((s.overflowWrap === 'break-word' || s.overflowWrap === 'anywhere') && !hasWrapOpportunityAtPreviousPosition) return 'arbitrary'
  return 'none'
}

// isBreakableRun (ICB:353-362): text whose own style allows wrapping.
function isBreakableRun(L: Layout, run: ContentRun): boolean {
  return run.item.kind === 'text' && L.p.boxes[run.item.box]!.style.wrap
}

// firstCharacterBreakRespectingLineStartProhibitions (ICB:139-158). U16_FWD_1 gets the item length as its limit while the
// index counts from the box start, as in the source.
function firstCharacterBreakRespectingLineStartProhibitions(L: Layout, item: WebKitTextItem, contentLogicalRight: number): PartialRun {
  const firstLength = firstUserPerceivedCharacterLength(L.p, item)
  const firstWidth = itemWidth(L.p, item, item.start, item.start + firstLength, contentLogicalRight)
  const box = L.p.boxes[item.box]!
  if (box.is8Bit) {
    // One code unit of 8-bit text (:143-157; gap string-storage).
    emergencyBreakIn8BitText(L.gaps, box, item, firstLength)
    return { length: firstLength, logicalWidth: firstWidth }
  }
  let breakPosition = firstLength
  let breakWidth = firstWidth
  while (item.start + breakPosition < item.end) {
    if (canBreakBefore(box.text.charCodeAt(item.start + breakPosition), box.style.lineBreak)) break
    const next = forwardOneCodePoint(box.text, breakPosition, item.end - item.start)
    breakWidth = itemWidth(L.p, item, item.start, item.start + next, contentLogicalRight)
    breakPosition = next
  }
  return { length: breakPosition, logicalWidth: breakWidth }
}

// lastValidBreakingPosition (ICB:364-403)
function lastValidBreakingPosition(L: Layout, runs: ContentRun[], index: number): number | null {
  const item = runs[index]!.item as WebKitTextItem
  const text = textOf(L, item)
  const lineBreak = L.p.boxes[item.box]!.style.lineBreak
  const inside = (): number | null => {
    for (let i = item.end - 1; i > item.start; i--) {
      i = codePointStart(text, item.start, i)
      if (canBreakBefore(text.charCodeAt(i), lineBreak)) return i === item.start ? null : i
    }
    return null
  }
  const nextIndex = nextTextRunIndex(runs, index)
  if (nextIndex !== null) {
    const next = runs[nextIndex]!.item as WebKitTextItem
    const canBreakAtRunBoundary = next.isWhitespace ? L.p.boxes[next.box]!.style.collapse !== 'break-spaces' : canBreakBefore(textOf(L, next).charCodeAt(next.start), lineBreak)
    return canBreakAtRunBoundary ? item.end : inside()
  }
  if (index === runs.length - 1) return item.end
  const following = runs[index + 1]!.item.kind
  if (following !== 'inline-box-start' && following !== 'inline-box-end') return item.end
  return inside()
}

// midWordBreak (ICB:405-430)
function midWordBreak(L: Layout, run: ContentRun, logicalLeft: number, availableWidth: number): PartialRun | null {
  const item = run.item as WebKitTextItem
  const text = textOf(L, item)
  const wb = breakWord(L.p, item, spaceRequired(run), availableWidth, logicalLeft)
  if (!wb.length || wb.length === item.end - item.start) return null
  const lineBreak = L.p.boxes[item.box]!.style.lineBreak
  if (canBreakBefore(text.charCodeAt(item.start + wb.length), lineBreak)) return { length: wb.length, logicalWidth: wb.logicalWidth }
  let right = item.start + wb.length
  for (; right > item.start; right--) {
    right = codePointStart(text, item.start, right)
    if (canBreakBefore(text.charCodeAt(right), lineBreak)) break
  }
  if (right === item.start) return null
  return { length: right - item.start, logicalWidth: itemWidth(L.p, item, item.start, right, logicalLeft) }
}

// InlineContentBreaker::tryBreakingTextRun (ICB:502-641)
function tryBreakingTextRun(L: Layout, runs: ContentRun[], index: number, isOverflowingRun: boolean, logicalLeft: number, availableWidth: number, st: LineStatus): PartialRun | null {
  const run = runs[index]!
  const item = run.item as WebKitTextItem
  const length = item.end - item.start
  const lineHasRoomForContent = availableWidth > 0
  const style = L.p.boxes[item.box]!.style
  const lineBreak = style.lineBreak
  switch (wordBreakBehavior(style, st.hasWrapOpportunityAtPreviousPosition)) {
    case 'none':
      return null
    case 'arbitrary-within-words': {
      if (item.isWhitespace || length === 0) return null
      const text = textOf(L, item)
      if (isOverflowingRun) {
        if (lineHasRoomForContent) {
          const wb = midWordBreak(L, run, logicalLeft, availableWidth)
          if (wb !== null) return wb
        }
        if (canBreakBefore(text.charCodeAt(item.start), lineBreak)) return { length: 0, logicalWidth: 0 }
        // firstBreakablePosition (:542-558): U16_FWD_1 with the item length as its limit, as in the source.
        if (st.hasContent) return null
        let right = item.start
        while (right < item.end) {
          right = forwardOneCodePoint(text, right, length)
          if (canBreakBefore(text.charCodeAt(right), lineBreak)) {
            if (right === item.end) return null
            return { length: right - item.start, logicalWidth: itemWidth(L.p, item, item.start, right, logicalLeft) }
          }
        }
        return null
      }
      const position = lastValidBreakingPosition(L, runs, index)
      if (position === null) return null
      return { length: position - item.start, logicalWidth: itemWidth(L.p, item, item.start, position, logicalLeft) }
    }
    case 'arbitrary': {
      if (length === 0) return null
      if (!isOverflowingRun) {
        if (nextTextRunIndex(runs, index) !== null) return { length, logicalWidth: itemWidth(L.p, item, item.start, item.end, logicalLeft) }
        if (length > 1) return { length: length - 1, logicalWidth: itemWidth(L.p, item, item.start, item.end - 1, logicalLeft) }
        return null
      }
      if (!lineHasRoomForContent) return { length: 0, logicalWidth: 0 }
      const wb = breakWord(L.p, item, spaceRequired(run), availableWidth, logicalLeft)
      return { length: wb.length, logicalWidth: wb.logicalWidth }
    }
  }
}

// findTrailingRunIndexBeforeBreakableRun (ICB:330-351)
function findTrailingRunIndexBeforeBreakableRun(runs: ContentRun[], breakableRunIndex: number): number | null {
  for (let i = breakableRunIndex - 1; i >= 0; i--) {
    if (runs[i]!.item.kind !== 'inline-box-start') return i
  }
  return null
}

function processOverflowingContentWithText(L: Layout, c: Content, st: LineStatus): { runIndex: number; breakingPosition: BreakingPosition | null } {
  const runs = c.runs
  let nonOverflowing = 0
  let overflowingRunIndex = runs.length
  for (let i = 0; i < runs.length; i++) {
    const w = spaceRequired(runs[i]!)
    if (f32(nonOverflowing + w) > st.availableWidth) {
      overflowingRunIndex = i
      break
    }
    nonOverflowing = f32(nonOverflowing + w)
  }
  // Only the trailing soft hyphen overflowed (:835-838).
  if (overflowingRunIndex === runs.length) return { runIndex: runs.length - 1, breakingPosition: null }

  // tryBreakingOverflowingRun (:643-662)
  const overflowingRun = runs[overflowingRunIndex]!
  if (isBreakableRun(L, overflowingRun)) {
    const available = Math.max(0, f32(st.availableWidth - nonOverflowing))
    const partial = tryBreakingTextRun(L, runs, overflowingRunIndex, true, f32(st.contentLogicalRight + nonOverflowing), available, st)
    if (partial !== null) {
      if (partial.length) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: overflowingRunIndex, trailingContent: { overflows: false, partialRun: partial } } }
      const trailing = findTrailingRunIndexBeforeBreakableRun(runs, overflowingRunIndex)
      if (trailing !== null) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailing, trailingContent: { overflows: false, partialRun: null } } }
      return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: 0, trailingContent: null } }
    }
  }

  // tryBreakingPreviousNonOverflowingRuns (:664-702). line-break: after-white-space isn't in the model, so breaking before
  // the overflowing run is allowed (:851-856).
  let previousContentWidth = nonOverflowing
  for (let index = overflowingRunIndex - 1; index >= 0; index--) {
    const run = runs[index]!
    previousContentWidth = f32(previousContentWidth - spaceRequired(run))
    if (!isBreakableRun(L, run)) continue
    const available = Math.max(0, f32(st.availableWidth - previousContentWidth))
    const partial = tryBreakingTextRun(L, runs, index, false, f32(st.contentLogicalRight + previousContentWidth), available, st)
    if (partial === null) continue
    const item = run.item as WebKitTextItem
    if (partial.length === item.end - item.start) {
      let trailingInlineBoxEnd: number | null = null
      for (let k = index + 1; k <= overflowingRunIndex; k++) {
        const kind = runs[k]!.item.kind
        if (kind === 'inline-box-end') trailingInlineBoxEnd = k
        if (kind !== 'inline-box-start' && kind !== 'inline-box-end') break
      }
      return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailingInlineBoxEnd ?? index, trailingContent: { overflows: false, partialRun: null } } }
    }
    return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: index, trailingContent: { overflows: false, partialRun: partial } } }
  }

  // tryHyphenationAcrossOverflowingInlineTextItems (:737-811) needs hyphens: auto.

  // tryBreakingNextOverflowingRuns (:704-735)
  let nextContentWidth = f32(nonOverflowing + spaceRequired(overflowingRun))
  for (let index = overflowingRunIndex + 1; index < runs.length; index++) {
    const run = runs[index]!
    if (isBreakableRun(L, run)) {
      const partial = tryBreakingTextRun(L, runs, index, true, f32(st.contentLogicalRight + nextContentWidth), 0, st)
      if (partial !== null) {
        if (partial.length) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: index, trailingContent: { overflows: true, partialRun: partial } } }
        const trailing = findTrailingRunIndexBeforeBreakableRun(runs, index)
        if (trailing !== null) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailing, trailingContent: { overflows: true, partialRun: null } } }
        return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: overflowingRunIndex, trailingContent: null } }
      }
    }
    nextContentWidth = f32(nextContentWidth + spaceRequired(run))
  }
  return { runIndex: overflowingRunIndex, breakingPosition: null }
}

// InlineContentBreaker::processOverflowingContent (ICB:160-299)
function processOverflowingContent(L: Layout, c: Content, st: LineStatus): BreakResult {
  if (c.isFullyTrimmable) return result('keep', false)
  if (c.trailingTrimmableWidth || c.leadingTrimmableWidth) {
    if (isWhitespaceOnlyContent(c)) return result('keep', false)
    let need = f32(c.logicalWidth - c.trailingTrimmableWidth)
    if (st.hasFullyTrimmableTrailingContent) need = f32(need - c.leadingTrimmableWidth)
    if (need <= st.availableWidth) return result('keep', false)
  }
  if (c.hangingContentWidth !== null && c.hangingContentWidth === c.logicalWidth) return result('keep', false)
  if (c.hangingContentWidth) {
    if (f32(c.logicalWidth - c.hangingContentWidth) <= st.availableWidth) return result('keep', false)
  }
  if (st.trimmableOrHangingWidth && isNonContentRunsOnly(c)) {
    if (c.logicalWidth <= f32(st.availableWidth + st.trimmableOrHangingWidth)) return result('keep', false)
  }

  let overflowingRunIndex = 0
  if (c.hasTextContent) {
    const overflowing = processOverflowingContentWithText(L, c, st)
    overflowingRunIndex = overflowing.runIndex
    const position = overflowing.breakingPosition
    if (position !== null) {
      const trailing = position.trailingContent
      if (trailing === null) {
        // Not even the first glyph fits (:214-251).
        if (st.hasContent) return result('wrap', true)
        const leadingTextRunIndex = firstTextRunIndex(c.runs)!
        const item = c.runs[leadingTextRunIndex]!.item as WebKitTextItem
        const firstLength = firstUserPerceivedCharacterLength(L.p, item)
        if (item.end - item.start > firstLength) {
          const partial = firstCharacterBreakRespectingLineStartProhibitions(L, item, st.contentLogicalRight)
          if (partial.length < item.end - item.start) return breakAt(leadingTextRunIndex, partial)
        }
        if (leadingTextRunIndex !== c.runs.length - 1) {
          for (let k = leadingTextRunIndex + 1; k < c.runs.length; k++) {
            if (c.runs[k]!.item.kind !== 'inline-box-end') return breakAt(k - 1, null)
          }
        }
        return result('keep', true)
      }
      if (trailing.overflows && st.hasContent) return result('wrap', true)
      return breakAt(position.runIndex, trailing.partialRun)
    }
  } else if (c.runs.length > 1) {
    for (let i = 0; i < c.runs.length; i++) {
      if (c.runs[i]!.item.kind === 'atomic') {
        overflowingRunIndex = i
        break
      }
    }
  }
  if (!st.hasContent) return result('keep', false)
  // shouldWrapUnbreakableContentToNextLine (:278-293): the overflowing box's parent style, or its own for an inline box, then
  // the parents of the runs before it.
  const runs = c.runs
  const overflowingItem = runs[overflowingRunIndex]!.item
  const isInlineBox = overflowingItem.kind === 'inline-box-start' || overflowingItem.kind === 'inline-box-end'
  let isWrappingAllowed = (isInlineBox ? itemStyle(L.p, overflowingItem) : styleOfElement(L.p, parentOf(L.p, overflowingItem))).wrap
  for (let index = overflowingRunIndex; !isWrappingAllowed && index-- > 0;) {
    isWrappingAllowed = styleOfElement(L.p, parentOf(L.p, runs[index]!.item)).wrap
  }
  if (isWrappingAllowed) return result('wrap', true)
  if (st.hasWrapOpportunityAtPreviousPosition) return result('revert-to-last-wrap-opportunity', true)
  return result('keep', false)
}

// InlineContentBreaker::processInlineContent (ICB:105-122)
function processInlineContent(L: Layout, c: Content, st: LineStatus): BreakResult {
  const r = processOverflowingContent(L, c, st)
  if (r.action === 'wrap' && st.trailingSoftHyphenWidth !== null && hasLeadingTextContent(c)) {
    return result(st.trailingSoftHyphenWidth > st.availableWidth ? 'revert-to-last-non-overflowing-wrap-opportunity' : 'wrap-with-hyphen', true)
  }
  return r
}

// AbstractLineBuilder::overflowWidthAsLeadingForNextLine (ALB:54-98): the carried remainder. The first-line style check
// never applies without ::first-line.
function overflowWidthAsLeadingForNextLine(runs: ContentRun[], r: BreakResult): number | null {
  let index: number
  if (runs.length === 1) index = 0
  else if (r.action === 'break') index = r.partialTrailingContent.trailingRunIndex
  else return null
  const run = runs[index]!
  const item = run.item
  if (item.kind !== 'text') return null
  if (item.isWhitespace && item.width === null) return null
  if (r.action === 'wrap') return run.contentWidth
  if (r.action === 'break' && r.partialTrailingContent.partialRun !== null) return f32(run.contentWidth - r.partialTrailingContent.partialRun.logicalWidth)
  return null
}

// InlineTextItem::left (InlineTextItem.cpp:57-63)
function leftPart(item: WebKitTextItem, length: number): WebKitTextItem {
  return { ...item, end: item.start + length, hasTrailingSoftHyphen: false, width: null }
}

function lineStatus(line: Line, availableWidth: number, lineHasContent: boolean, hasWrapOpportunity: boolean): LineStatus {
  return {
    contentLogicalRight: lastRunLogicalRight(line), availableWidth, trimmableOrHangingWidth: line.trimmable === null ? 0 : line.trimmable.width,
    trailingSoftHyphenWidth: line.trailingSoftHyphenWidth, hasFullyTrimmableTrailingContent: line.trimmable !== null,
    hasContent: lineHasContent, hasWrapOpportunityAtPreviousPosition: hasWrapOpportunity,
  }
}

// ---- TextOnlySimpleLineBuilder (TOS) ----

// A line builder's state. `measuredEnd` is the item index past the last item the builder read a width or a break opportunity
// of: the line's content and the candidate content that ended the line. `shapedCarry` says the width carried to the next line
// comes from a candidate shaped across inline boxes.
type Builder = {
  L: Layout
  rangeStart: number
  rangeEnd: number
  partialLeadingTextItem: WebKitTextItem | null
  wrapOpportunityList: ContentItem[]
  line: Line
  spanningInlineBoxes: number[]
  measuredEnd: number
  shapedCarry: boolean
}

type SimpleResult = { isEndOfLine: boolean; committedCount: number; overflowingContentLength: number; overflowLogicalWidth: number | null; isRevert: boolean }

function simpleResult(isEndOfLine: boolean, committedCount = 0, overflowingContentLength = 0, overflowLogicalWidth: number | null = null, isRevert = false): SimpleResult {
  return { isEndOfLine, committedCount, overflowingContentLength, overflowLogicalWidth, isRevert }
}

function isLineBreakItem(item: WebKitItem | undefined): item is LineBreakItem {
  return item !== undefined && (item.kind === 'soft-line-break' || item.kind === 'hard-line-break')
}

// TOS:481-486
function simpleAvailableWidth(b: Builder): number {
  return f32(f32(b.L.lineWidth + 1 / 64) - lastRunLogicalRight(b.line))
}

// measuredInlineTextItem (TOS:57-63) and InlineFormattingUtils::inlineItemWidth (IFU:300-309): collapsible white space is
// measured on its first character.
function measuredItemWidth(L: Layout, item: WebKitTextItem, left: number): number {
  if (item.width !== null) return item.width
  if (!item.isWhitespace || preservesSpacesAndTabs(L.p.boxes[item.box]!.style)) return itemWidth(L.p, item, item.start, item.end, left)
  return itemWidth(L.p, item, item.start, item.start + 1, left)
}

function revertToTrailingItem(b: Builder, target: ContentItem): number {
  b.line = newLine([])
  let count = 0
  const append = (item: WebKitTextItem) => {
    appendTextFast(b.L, b.line, item, measuredItemWidth(b.L, item, lastRunLogicalRight(b.line)))
    count++
    return item === target
  }
  if (b.partialLeadingTextItem !== null && append(b.partialLeadingTextItem)) return count
  for (let index = b.rangeStart + count; index < b.rangeEnd; index++) {
    if (append(b.L.p.items[index] as WebKitTextItem)) return count
  }
  return count
}

function revertToLastNonOverflowingItem(b: Builder): number {
  for (let i = b.wrapOpportunityList.length - 1; i >= 0; i--) {
    const count = revertToTrailingItem(b, b.wrapOpportunityList[i]!)
    const h = b.line.trailingSoftHyphenWidth
    if (i === 0 || h === null || h <= simpleAvailableWidth(b)) {
      if (h !== null) addTrailingHyphen(b.line, h)
      return count
    }
  }
  return 0
}

// TOS:343-421
function handleOverflowingTextContent(b: Builder, c: Content): SimpleResult {
  const L = b.L
  const available = simpleAvailableWidth(b)
  let r = result('keep', false)
  if (c.logicalWidth > available) r = processInlineContent(L, c, lineStatus(b.line, available, hasContent(b.line), b.wrapOpportunityList.length > 0))
  switch (r.action) {
    case 'keep':
      for (let i = 0; i < c.runs.length; i++) appendTextFast(L, b.line, c.runs[i]!.item as WebKitTextItem, c.runs[i]!.contentWidth)
      if (hasContent(b.line)) b.wrapOpportunityList.push(c.runs[c.runs.length - 1]!.item)
      return simpleResult(r.isEndOfLine, c.runs.length)
    case 'wrap':
      return simpleResult(true, 0, 0, overflowWidthAsLeadingForNextLine(c.runs, r))
    case 'wrap-with-hyphen':
      addTrailingHyphen(b.line, b.line.trailingSoftHyphenWidth!)
      return simpleResult(true)
    case 'break': {
      const t = r.partialTrailingContent
      for (let i = 0; i < t.trailingRunIndex; i++) appendTextFast(L, b.line, c.runs[i]!.item as WebKitTextItem, c.runs[i]!.contentWidth)
      const committed = t.trailingRunIndex + 1
      const trailing = c.runs[t.trailingRunIndex]!
      const item = trailing.item as WebKitTextItem
      if (t.partialRun === null) {
        appendTextFast(L, b.line, item, trailing.contentWidth)
        return simpleResult(true, committed)
      }
      appendTextFast(L, b.line, leftPart(item, t.partialRun.length), t.partialRun.logicalWidth)
      return simpleResult(true, committed, item.end - item.start - t.partialRun.length, overflowWidthAsLeadingForNextLine(c.runs, r))
    }
    case 'revert-to-last-wrap-opportunity':
      return simpleResult(true, revertToTrailingItem(b, b.wrapOpportunityList[b.wrapOpportunityList.length - 1]!), 0, null, true)
    case 'revert-to-last-non-overflowing-wrap-opportunity':
      return simpleResult(true, revertToLastNonOverflowingItem(b), 0, null, true)
  }
}

// TOS:309-341
function simpleCommitCandidateContent(b: Builder, start: number, end: number, logicalWidth: number): SimpleResult {
  const L = b.L
  const items = L.p.items
  const hasLeadingPartialContent = b.partialLeadingTextItem !== null && start === b.rangeStart
  if (logicalWidth <= simpleAvailableWidth(b) && !hasLeadingPartialContent) {
    for (let index = start; index < end; index++) {
      const item = items[index] as WebKitTextItem
      appendTextFast(L, b.line, item, measuredItemWidth(L, item, lastRunLogicalRight(b.line)))
    }
    if (hasContent(b.line)) b.wrapOpportunityList.push(items[end - 1] as WebKitTextItem)
    return simpleResult(false, end - start)
  }
  const c = newContent()
  let index = start
  if (hasLeadingPartialContent) {
    appendTextContent(L, c, b.partialLeadingTextItem!, measuredItemWidth(L, b.partialLeadingTextItem!, lastRunLogicalRight(b.line)))
    index++
  }
  for (; index < end; index++) {
    const item = items[index] as WebKitTextItem
    appendTextContent(L, c, item, measuredItemWidth(L, item, f32(lastRunLogicalRight(b.line) + c.logicalWidth)))
  }
  return handleOverflowingTextContent(b, c)
}

// consumeTrailingLineBreakIfApplicable (TOS:80-94)
function consumeTrailingLineBreak(b: Builder, r: SimpleResult, index: number): boolean {
  if (r.overflowingContentLength || r.isRevert) return false
  const item = b.L.p.items[index]
  if (index >= b.rangeEnd || !isLineBreakItem(item)) return false
  appendLineBreak(b.line, item)
  return true
}

// placedInlineItemEnd (TOS:65-73)
function placedInlineItemEnd(b: Builder, placedCount: number, overflowingContentLength: number): Position {
  if (!overflowingContentLength) return { index: b.rangeStart + placedCount, offset: 0 }
  const index = b.rangeStart + placedCount - 1
  const item = b.L.p.items[index] as WebKitTextItem
  return { index, offset: item.end - item.start - overflowingContentLength }
}

// TOS:423-435
function simpleHandleLineEnding(b: Builder, placedEnd: Position): void {
  handleTrailingTrimmableContent(b.L, b.line)
  handleTrailingHangingContent(b.line, b.L.lineWidth, placedEnd.index === b.rangeEnd && placedEnd.offset === 0)
}

// placeInlineTextContent (TOS:198-262)
function placeInlineTextContent(b: Builder): { end: Position; overflowLogicalWidth: number | null } {
  const L = b.L
  const items = L.p.items
  const style = L.p.style
  const hasWrapOpportunityBeforeWhitespace = style.collapse !== 'break-spaces'
  let placed = 0
  let r = simpleResult(true)
  let candidateStart = b.rangeStart
  let candidateEnd = b.rangeStart
  let candidateWidth = 0
  let nextIndex = b.rangeStart
  const isAtSoftWrapOpportunityOrContentEnd = (item: WebKitTextItem): boolean => {
    if (item.isWhitespace) return true
    const next = items[nextIndex]
    if (nextIndex >= b.rangeEnd || next === undefined || isLineBreakItem(next)) return true
    const nextText = next as WebKitTextItem
    if (nextText.isWhitespace) return hasWrapOpportunityBeforeWhitespace
    if (item.box === nextText.box) return true
    const prevBox = L.p.boxes[item.box]!
    const nextBox = L.p.boxes[nextText.box]!
    return breakInBetween(L, prevBox, nextBox)
  }
  const process = (): boolean => {
    r = simpleCommitCandidateContent(b, candidateStart, candidateEnd, candidateWidth)
    placed = r.isRevert ? r.committedCount : placed + r.committedCount
    candidateStart = candidateEnd
    candidateWidth = 0
    return r.isEndOfLine
  }
  let isEndOfLine = false
  if (b.partialLeadingTextItem !== null) {
    candidateEnd++
    nextIndex++
    b.measuredEnd = Math.max(b.measuredEnd, nextIndex)
    if (isAtSoftWrapOpportunityOrContentEnd(b.partialLeadingTextItem)) isEndOfLine = process()
  }
  while (!isEndOfLine && nextIndex < b.rangeEnd) {
    const item = items[nextIndex++]!
    b.measuredEnd = Math.max(b.measuredEnd, nextIndex)
    if (item.kind === 'text') {
      candidateWidth = f32(candidateWidth + measuredItemWidth(L, item, f32(lastRunLogicalRight(b.line) + candidateWidth)))
      candidateEnd++
      if (isAtSoftWrapOpportunityOrContentEnd(item)) isEndOfLine = process()
      continue
    }
    isEndOfLine = true
    r = simpleResult(true)
  }
  if (consumeTrailingLineBreak(b, r, b.rangeStart + placed)) placed++
  const end = placedInlineItemEnd(b, placed, r.overflowingContentLength)
  simpleHandleLineEnding(b, end)
  return { end, overflowLogicalWidth: r.overflowLogicalWidth }
}

// placeNonWrappingInlineTextContent (TOS:264-307)
function placeNonWrappingInlineTextContent(b: Builder): { end: Position; overflowLogicalWidth: number | null } {
  const L = b.L
  const items = L.p.items
  let candidateEnd = b.rangeStart
  let candidateWidth = 0
  let trailingLineBreakIndex: number | null = null
  let nextIndex = b.rangeStart
  let isEndOfLine = false
  while (!isEndOfLine) {
    const item = items[nextIndex]!
    if (item.kind === 'text') {
      candidateWidth = f32(candidateWidth + measuredItemWidth(L, item, candidateWidth))
      candidateEnd++
    } else {
      trailingLineBreakIndex = nextIndex
    }
    nextIndex++
    b.measuredEnd = Math.max(b.measuredEnd, nextIndex)
    isEndOfLine = nextIndex >= b.rangeEnd || trailingLineBreakIndex !== null
  }
  if (trailingLineBreakIndex !== null && candidateEnd === b.rangeStart) {
    appendLineBreak(b.line, items[trailingLineBreakIndex] as LineBreakItem)
    const end = { index: trailingLineBreakIndex + 1, offset: 0 }
    return { end, overflowLogicalWidth: null }
  }
  const r = simpleCommitCandidateContent(b, b.rangeStart, candidateEnd, candidateWidth)
  let placed = r.committedCount
  if (consumeTrailingLineBreak(b, r, b.rangeStart + placed)) placed++
  const end = placedInlineItemEnd(b, placed, r.overflowingContentLength)
  simpleHandleLineEnding(b, end)
  return { end, overflowLogicalWidth: null }
}

// ---- LineBuilder (ILB) ----

type Candidate = {
  content: Content
  trailingLineBreak: LineBreakItem | null
  trailingWordBreakOpportunity: WordBreakOpportunityItem | null
  hasTrailingSoftWrapOpportunity: boolean
}

type LineBuilderResult = { isEndOfLine: boolean; committedCount: number; isRevert: boolean; partialTrailingContentLength: number; overflowLogicalWidth: number | null }

function lineBuilderResult(isEndOfLine: boolean, committedCount = 0, isRevert = false, partialTrailingContentLength = 0, overflowLogicalWidth: number | null = null): LineBuilderResult {
  return { isEndOfLine, committedCount, isRevert, partialTrailingContentLength, overflowLogicalWidth }
}

// endsWithSoftWrapOpportunity (IFU:336-355)
function endsWithSoftWrapOpportunity(L: Layout, previous: WebKitTextItem, next: WebKitTextItem): boolean {
  if (previous.isWhitespace) return true
  const prevBox = L.p.boxes[previous.box]!
  if (previous.box === next.box) {
    if (previous.level === next.level) return true
    const f = makeFactory(prevBox.text, prevBox.is8Bit, prevBox.locale, prevBox.style.lineBreakMode, L.p.icuDefaultLocale, L.p.env.dictionaryBreaks)
    return findNextBreakablePosition(f, next.start, prevBox.style) === next.start
  }
  return breakInBetween(L, prevBox, L.p.boxes[next.box]!)
}

// TextUtil::mayBreakInBetween between two boxes (gap dictionary-breaks-stand-in on the line that asks).
function breakInBetween(L: Layout, prevBox: WebKitBox, nextBox: WebKitBox): boolean {
  breakTestBetweenBoxes(L.gaps, L.p, prevBox, nextBox)
  return mayBreakInBetween(prevBox.text, prevBox.is8Bit, nextBox.text, nextBox.is8Bit, nextBox.locale, nextBox.style, L.p.icuDefaultLocale, L.p.env.dictionaryBreaks)
}

// nearestCommonAncestor (IFU:357-383) of two layout boxes by their parents.
function nearestCommonAncestor(p: WebKitPrepared, firstParent: number, secondParent: number): number {
  for (let e = secondParent; e >= 0; e = p.elements[e]!.parent) {
    for (let ancestor = firstParent; ancestor >= 0; ancestor = p.elements[ancestor]!.parent) if (ancestor === e) return e
  }
  return -1
}

// InlineFormattingUtils::isAtSoftWrapOpportunity (IFU:385-454) for text and atomic items.
function isAtSoftWrapOpportunity(L: Layout, previous: WebKitTextItem | AtomicItem, next: WebKitTextItem | AtomicItem): boolean {
  const p = L.p
  const previousParent = parentOf(p, previous)
  const nextParent = parentOf(p, next)
  const mayWrapPrevious = styleOfElement(p, previousParent).wrap
  const mayWrapNext = styleOfElement(p, nextParent).wrap
  if (previousParent === nextParent && !mayWrapPrevious && !mayWrapNext) return false
  if (previous.kind === 'text' && next.kind === 'text') {
    if (previous.isWhitespace || next.isWhitespace) {
      if (previous.isWhitespace) return mayWrapPrevious
      if (!mayWrapNext) return false
      return p.boxes[next.box]!.style.collapse !== 'break-spaces'
    }
    if (p.boxes[previous.box]!.style.lineBreak === 'anywhere' || p.boxes[next.box]!.style.lineBreak === 'anywhere') return true
    if (previousParent === nextParent && !p.boxes[previous.box]!.style.wrap) return false
    if (!endsWithSoftWrapOpportunity(L, previous, next)) return false
    return styleOfElement(p, nearestCommonAncestor(p, previousParent, nextParent)).wrap
  }
  // An atomic inline behaves like an ideographic character (:446-450).
  return true
}

// InlineFormattingUtils::nextWrapOpportunity (IFU:456-544)
function nextWrapOpportunity(b: Builder, startIndex: number): number {
  const items = b.L.p.items
  let previousIndex: number | null = null
  for (let index = startIndex; index < b.rangeEnd; index++) {
    const item = items[index]!
    if (isLineBreakItem(item) || item.kind === 'word-break-opportunity') {
      for (index++; index < b.rangeEnd && items[index]!.kind === 'inline-box-end'; index++) {}
      return index
    }
    if (item.kind === 'inline-box-start' || item.kind === 'inline-box-end') continue
    if (previousIndex === null) {
      previousIndex = index
      continue
    }
    const previous = items[previousIndex] as WebKitTextItem | AtomicItem
    if (isAtSoftWrapOpportunity(b.L, previous, item)) {
      if (previousIndex + 1 === index && (previous.kind !== 'text' || item.kind !== 'text')) return index
      // The opportunity sits at the first inline box start that is still open at `index` (:523-541).
      const stack: number[] = []
      for (let k = previousIndex + 1; k < index; k++) {
        const kind = items[k]!.kind
        if (kind === 'inline-box-start') stack.push(k)
        else if (kind === 'inline-box-end' && stack.length > 0) stack.pop()
      }
      return stack.length === 0 ? index : stack[0]!
    }
    previousIndex = index
  }
  return b.rangeEnd
}

// hasTrailingSoftWrapOpportunity (ILB:141-192)
function hasTrailingSoftWrapOpportunity(b: Builder, softWrapOpportunityIndex: number): boolean {
  if (!softWrapOpportunityIndex || softWrapOpportunityIndex === b.rangeEnd) return false
  const items = b.L.p.items
  const trailing = items[softWrapOpportunityIndex - 1]!
  switch (trailing.kind) {
    case 'atomic':
    case 'soft-line-break':
    case 'hard-line-break':
    case 'word-break-opportunity':
    case 'inline-box-end':
      return true
    case 'inline-box-start':
      return false
    case 'text':
      if (trailing.isWhitespace) return true
      for (let index = softWrapOpportunityIndex; index < b.rangeEnd; index++) {
        const item = items[index]!
        if (item.kind === 'inline-box-start' || item.kind === 'inline-box-end') continue
        return item.kind === 'text' && !item.isWhitespace
      }
      return true
  }
}

// InlineFormattingUtils::inlineItemWidth (IFU:300-334) for inline box starts and ends and atomic inlines.
function boxItemWidth(p: WebKitPrepared, item: InlineBoxItem | AtomicItem): number {
  switch (item.kind) {
    case 'inline-box-start': return startEdgeWidth(spanEdges(p, item.element))
    case 'inline-box-end': return endEdgeWidth(spanEdges(p, item.element))
    case 'atomic': return atomicElement(p, item.element).marginBoxWidth
  }
}

// LineBuilder::candidateContentForLine (ILB:1030-1170), with shaping across inline boxes (:780-1028) at its end; a line that
// holds such a run reports rtl-shaping-across-inline-boxes.
function candidateContentForLine(b: Builder, startIndex: number, endIndex: number, currentLogicalRight: number): Candidate {
  const L = b.L
  const items = L.p.items
  const candidate: Candidate = { content: newContent(), trailingLineBreak: null, trailingWordBreakOpportunity: null, hasTrailingSoftWrapOpportunity: false }
  b.measuredEnd = Math.max(b.measuredEnd, endIndex)
  let right = currentLogicalRight
  let index = startIndex
  if (index === b.rangeStart && b.partialLeadingTextItem !== null) {
    const w = measuredItemWidth(L, b.partialLeadingTextItem, f32(L.contentEdgeOffset + right))
    appendTextContent(L, candidate.content, b.partialLeadingTextItem, w)
    right = f32(right + w)
    index++
  }
  let trailingSoftHyphenIndex: number | null = null
  for (; index < endIndex; index++) {
    const item = items[index]!
    switch (item.kind) {
      case 'text': {
        const w = measuredItemWidth(L, item, f32(L.contentEdgeOffset + right))
        appendTextContent(L, candidate.content, item, w)
        right = f32(right + f32(w + (item.isWordSeparator ? L.p.boxes[item.box]!.style.wordSpacing : 0)))
        trailingSoftHyphenIndex = item.hasTrailingSoftHyphen ? index : null
        break
      }
      case 'inline-box-start':
      case 'inline-box-end':
      case 'atomic': {
        const w = boxItemWidth(L.p, item)
        appendBoxContent(candidate.content, item, w)
        right = f32(right + w)
        break
      }
      case 'soft-line-break':
      case 'hard-line-break':
        candidate.trailingLineBreak = item
        break
      case 'word-break-opportunity':
        candidate.trailingWordBreakOpportunity = item
        break
    }
  }
  // setTrailingSoftHyphenWidth (:1154-1165): the hyphen counts in the fit test when only text follows the soft hyphen.
  if (trailingSoftHyphenIndex !== null) {
    let onlyText = true
    for (let k = trailingSoftHyphenIndex; k < endIndex; k++) if (items[k]!.kind !== 'text') onlyText = false
    if (onlyText) {
      const shy = items[trailingSoftHyphenIndex] as WebKitTextItem
      candidate.content.logicalWidth = f32(candidate.content.logicalWidth + lineHyphenWidth(L, shy.box))
    }
  }
  candidate.hasTrailingSoftWrapOpportunity = hasTrailingSoftWrapOpportunity(b, endIndex)
  applyShapingIfNeeded(L, candidate.content)
  return candidate
}

// LineBuilder::collectShapeRanges (ILB:780-918): ranges of complex RTL text of one font joined across undecorated inline box
// edges. Isolation (unicode-bidi) isn't in the model.
function collectShapeRanges(L: Layout, c: Content): Array<[number, number]> {
  const p = L.p
  const runs = c.runs
  type Entry = { type: 'content' | 'break' | 'keep'; index: number }
  const contentList: Entry[] = []
  for (let index = 0; index < runs.length; index++) {
    const item = runs[index]!.item
    let type: Entry['type']
    switch (item.kind) {
      case 'text': type = item.isWhitespace ? 'break' : 'content'; break
      case 'atomic': type = 'break'; break
      case 'inline-box-start':
      case 'inline-box-end': {
        const e = spanEdges(p, item.element)
        const checkLogicalStart = !styleOfElement(p, item.element).rtl ? item.kind === 'inline-box-end' : item.kind === 'inline-box-start'
        const hasDecoration = checkLogicalStart ? hasNonZeroStartEdge(e) : hasNonZeroEndEdge(e)
        type = hasDecoration ? 'break' : 'keep'
        break
      }
    }
    if (type !== 'content' && (contentList.length === 0 || contentList[contentList.length - 1]!.type === type)) continue
    contentList.push({ type, index })
  }
  while (contentList.length > 0 && contentList[contentList.length - 1]!.type !== 'content') contentList.pop()
  if (contentList.length === 0) return []
  const ranges: Array<[number, number]> = []
  // lastFontCascade (ILB:862): the root style's until a content run gives its own, and nothing compares it before one does.
  let lastFontBox: WebKitBox | null = null
  let leading: number | null = null
  let trailing: number | null = null
  let hasBoundaryBetween = false
  const reset = () => { leading = null; trailing = null; hasBoundaryBetween = false }
  const commit = () => {
    if (leading !== null && trailing !== null && hasBoundaryBetween) ranges.push([leading, trailing])
    reset()
  }
  for (let k = 0; k < contentList.length; k++) {
    const entry = contentList[k]!
    switch (entry.type) {
      case 'break': commit(); break
      case 'keep':
        if (hasBoundaryBetween) break
        if (leading !== null) hasBoundaryBetween = true
        break
      case 'content': {
        const item = runs[entry.index]!.item as WebKitTextItem
        const box = p.boxes[item.box]!
        const isEligibleText = !box.simpleFontCodePath && item.level % 2 === 1 && item.level <= 125
        if (leading === null) {
          if (isEligibleText) leading = entry.index
          lastFontBox = box
        } else if (hasBoundaryBetween) {
          // FontCascade equality: the box's Canvas settings (font, letter spacing), which one context stands for, and word
          // spacing and locale.
          const sameFont = lastFontBox !== null && box.context === lastFontBox.context && box.style.wordSpacing === lastFontBox.style.wordSpacing
          if (isEligibleText && sameFont && p.boxes[(runs[leading]!.item as WebKitTextItem).box]!.locale === box.locale) trailing = entry.index
          else reset()
        } else if (!isEligibleText) {
          reset()
        }
        break
      }
    }
  }
  commit()
  return ranges
}

// rule webkit/lines/shaped-run-in-joining-context
// LineBuilder::applyShapingOnRunRange (ILB:920-967): the range's text shaped as one RTL run, each text run taking the
// CoreText base advances of its own characters, summed per character in logical order, negative ones as 0
// (ComplexTextController::glyphAdvancesForTextRun, ComplexTextController.cpp:186-205, without letter spacing), and the
// candidate's logical width set to their sum. So the runs' shares add up to the advances of the joined text, which Canvas
// totals (probe webkit-round4 R10: the DOM's boxes add up to the Canvas total of the joined text in 35 of 36 run lists in 9
// fonts and all 36 in Courier New, and carry no letter spacing). The other one isn't shaped at all: Core Text returns several glyph runs for a font's
// stretch that holds a shadda with a vowel sign, glyphAdvancesForTextRun counts the stretch's characters once per glyph run
// (ComplexTextController.cpp:190-203, stringLength() is the whole stretch, ComplexTextController.h:112), and the size check
// returns before any width changes (ILB:943-946), so the boxes keep their own widths. Which mark pairs a font composes isn't
// Canvas-observable; the gap covers it (suite c-d03f94e8fb53e7e2). Canvas shows totals only, so a run's share is
// a stand-in: the total of the joined text from the run on, less the total of the text after the run, each with U+200D before
// it where the letters at its first edge join (joining.ts). The differences add up to the joined text's total. What this
// leaves out is whatever the text before a letter does to it beyond joining, which lands on the run before the edge: a pair
// adjustment (R10: in Geeza Pro the DOM has it on the run after the edge), a contextual form, or a ligature across the edge
// (the DOM gives the run that holds its first letter the whole advance); and the float32 order of the per-character sum. The
// line reports the gap. Chosen over the run alone in its joining context (round 3) and over prefix differences by R10's
// counts, 509, 492 and 474 of 770 runs equal to the DOM's: a registered heuristic (CHARTER known deviations).
function applyShapingOnRunRange(L: Layout, c: Content, range: [number, number]): void {
  const runs = c.runs
  const [first, second] = range
  if (first >= second || second >= runs.length) return
  runs[first]!.shapingBoundary = 'start'
  runs[second]!.shapingBoundary = 'end'
  const firstBox = L.p.boxes[(runs[first]!.item as WebKitTextItem).box]!
  const texts: string[] = []
  const indices: number[] = []
  for (let index = first; index <= second; index++) {
    const item = runs[index]!.item
    if (item.kind !== 'text') continue
    texts.push(L.p.boxes[item.box]!.text.slice(item.start, item.end))
    indices.push(index)
  }
  let suffix = ''
  let following = 0
  let followingJoins = false
  for (let k = texts.length - 1; k >= 0; k--) {
    const text = texts[k]!
    const joins = k > 0 && joinsAcross(texts[k - 1]!, text)
    const total = canvasWidth(firstBox.plainContext, canvasString((joins ? '\u200d' : '') + text + suffix))
    let share = f32(total - following)
    if (suffix !== '') {
      // The difference of two float32 totals isn't the float32 sum of the run's own advances, which the run alone in its
      // joining context is where nothing but joining crosses its edges. The two agree within the rounding of the three totals,
      // half a unit in the last place of the largest for every addition, where that holds: then the run alone stands.
      const alone = canvasWidth(firstBox.plainContext, canvasString((joins ? '\u200d' : '') + text + (followingJoins ? '\u200d' : '')))
      const additions = 2 * (text.length + suffix.length) + 5
      if (Math.abs(alone - share) <= additions * 2 ** (Math.floor(Math.log2(total)) - 24)) share = alone
    }
    runs[indices[k]!]!.contentWidth = Math.max(0, share)
    suffix = text + suffix
    following = total
    followingJoins = joins
  }
  let shapedContentWidth = 0
  for (let k = 0; k < indices.length; k++) shapedContentWidth = f32(shapedContentWidth + runs[indices[k]!]!.contentWidth)
  c.logicalWidth = shapedContentWidth
  c.hasShapedContent = true
  shapedAcrossInlineBoxes(L.gaps, L.p, runs[indices[0]!]!.item as WebKitTextItem, runs[indices[indices.length - 1]!]!.item as WebKitTextItem)
}

// LineBuilder::applyShapingIfNeeded (ILB:969-979); TextShapingAcrossInlineBoxes is on by default
// (UnifiedWebPreferences.yaml:8489-8501, InlineFormattingContext.cpp:569-570).
function applyShapingIfNeeded(L: Layout, c: Content): void {
  if (!c.hasTextContentSpanningBoxes) return
  const ranges = collectShapeRanges(L, c)
  for (let k = 0; k < ranges.length; k++) applyShapingOnRunRange(L, c, ranges[k]!)
}

// LineBuilder::shapePartialLineCandidate (ILB:981-1028): before committing a partial trailing run inside a shaping range,
// shape again from the range start to the last text run kept.
function shapePartialLineCandidate(L: Layout, c: Content, trailingRunIndex: number): void {
  const runs = c.runs
  if (trailingRunIndex >= runs.length) return
  for (let index = trailingRunIndex + 1; index < runs.length; index++) {
    const boundary = runs[index]!.shapingBoundary
    if (boundary === null) continue
    if (boundary === 'start') return
    let endPosition: number | null = null
    for (let i = trailingRunIndex + 1; i-- > 0;) {
      const run = runs[i]!
      if (endPosition === null && run.item.kind === 'text') endPosition = i
      if (run.shapingBoundary === 'start') {
        if (endPosition === null) return
        if (endPosition === i) {
          run.shapingBoundary = null
          if (i < trailingRunIndex) run.contentWidth = measuredItemWidth(L, run.item as WebKitTextItem, 0)
          return
        }
        applyShapingOnRunRange(L, c, [i, endPosition])
        return
      }
    }
    return
  }
}

// LineBuilder::commitCandidateContent (ILB:1610-1724)
function commitCandidateContent(b: Builder, content: Content, partial: PartialTrailingContent | null): void {
  const L = b.L
  const runs = content.runs
  if (runs.length === 0) return
  let shapingBoundaryStart: number | null = null
  const boundaryFor = (index: number): ShapingBoundary | null => {
    const run = runs[index]!
    if (shapingBoundaryStart !== null && partial !== null && partial.trailingRunIndex === index) return 'end'
    if (run.shapingBoundary === 'start') {
      shapingBoundaryStart = index
      return 'start'
    }
    if (run.shapingBoundary === 'end') {
      shapingBoundaryStart = null
      return 'end'
    }
    return shapingBoundaryStart !== null ? 'inside' : null
  }
  const appendRun = (run: ContentRun, index: number) => {
    if (run.item.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
    switch (run.item.kind) {
      case 'text': appendText(L, b.line, run.item, run.contentWidth, boundaryFor(index)); break
      case 'inline-box-start': appendInlineBoxStart(L.p, b.line, run.item, run.contentWidth); break
      case 'inline-box-end': appendInlineBoxEnd(L.p, b.line, run.item, run.contentWidth); break
      case 'atomic': appendAtomicInlineBox(L.p, b.line, run.item, run.contentWidth); break
    }
  }
  if (partial !== null && content.hasShapedContent) shapePartialLineCandidate(L, content, partial.trailingRunIndex)
  const endOfNonPartialContent = partial !== null ? Math.min(partial.trailingRunIndex, runs.length) : runs.length
  for (let i = 0; i < endOfNonPartialContent; i++) appendRun(runs[i]!, i)
  if (partial === null) return
  const trailing = runs[partial.trailingRunIndex]!
  if (partial.partialRun !== null) {
    const item = trailing.item as WebKitTextItem
    appendText(L, b.line, leftPart(item, partial.partialRun.length), partial.partialRun.logicalWidth, shapingBoundaryStart !== null ? 'end' : null)
    if (item.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
  } else {
    appendRun(trailing, partial.trailingRunIndex)
  }
}

// LineBuilder::rebuildLineWithInlineContent (ILB:1813-1858)
function rebuildLineWithInlineContent(b: Builder, lastItem: ContentItem): number {
  b.line = newLine(b.spanningInlineBoxes)
  if (b.partialLeadingTextItem !== null && b.partialLeadingTextItem === lastItem) {
    const content = newContent()
    appendTextContent(b.L, content, b.partialLeadingTextItem, measuredItemWidth(b.L, b.partialLeadingTextItem, 0))
    commitCandidateContent(b, content, null)
    return 1
  }
  let end = b.rangeStart
  for (; end < b.rangeEnd; end++) {
    if (b.L.p.items[end] === lastItem) {
      end++
      break
    }
  }
  const candidate = candidateContentForLine(b, b.rangeStart, end, lastRunLogicalRight(b.line))
  return processLineBreakingResult(b, candidate, result('keep', true)).committedCount
}

// LineBuilder::rebuildLineForTrailingSoftHyphen (ILB:1860-1887): no 1/64 epsilon here.
function rebuildLineForTrailingSoftHyphen(b: Builder): number {
  const list = b.wrapOpportunityList
  if (list.length === 0) return 0
  for (let i = list.length - 1; i >= 1; i--) {
    const count = rebuildLineWithInlineContent(b, list[i]!)
    const available = f32(b.L.lineWidth - lastRunLogicalRight(b.line))
    const h = b.line.trailingSoftHyphenWidth
    if (h === null || h <= available) {
      if (h !== null) addTrailingHyphen(b.line, h)
      return count
    }
  }
  const count = rebuildLineWithInlineContent(b, list[0]!)
  if (b.line.trailingSoftHyphenWidth !== null) addTrailingHyphen(b.line, b.line.trailingSoftHyphenWidth)
  return count
}

// LineBuilder::processLineBreakingResult (ILB:1726-1811)
function processLineBreakingResult(b: Builder, candidate: Candidate, r: BreakResult): LineBuilderResult {
  const runs = candidate.content.runs
  switch (r.action) {
    case 'keep': {
      commitCandidateContent(b, candidate.content, null)
      if (candidate.hasTrailingSoftWrapOpportunity && hasContent(b.line)) {
        const trailingItem = runs[runs.length - 1]!.item
        // The parent's style drives wrapping, and an inline box's own style where the parent's doesn't allow it.
        let isWrapOpportunity = styleOfElement(b.L.p, parentOf(b.L.p, trailingItem)).wrap
        if (!isWrapOpportunity && (trailingItem.kind === 'inline-box-start' || trailingItem.kind === 'inline-box-end')) isWrapOpportunity = itemStyle(b.L.p, trailingItem).wrap
        if (isWrapOpportunity) b.wrapOpportunityList.push(trailingItem)
      }
      return lineBuilderResult(r.isEndOfLine, runs.length)
    }
    case 'wrap': {
      const lastRun = b.line.runs[b.line.runs.length - 1]
      const needsRevert = b.line.trimmable !== null && b.line.trimmable.width !== 0 && lastRun !== undefined && lastRun.kind === 'inline-box-start'
      if (needsRevert && b.wrapOpportunityList.length > 1) {
        b.wrapOpportunityList.pop()
        return lineBuilderResult(true, rebuildLineWithInlineContent(b, b.wrapOpportunityList[b.wrapOpportunityList.length - 1]!), true)
      }
      b.shapedCarry = candidate.content.hasShapedContent
      return lineBuilderResult(true, 0, false, 0, overflowWidthAsLeadingForNextLine(runs, r))
    }
    case 'wrap-with-hyphen':
      addTrailingHyphen(b.line, b.line.trailingSoftHyphenWidth!)
      return lineBuilderResult(true)
    case 'revert-to-last-wrap-opportunity':
      return lineBuilderResult(true, rebuildLineWithInlineContent(b, b.wrapOpportunityList[b.wrapOpportunityList.length - 1]!), true)
    case 'revert-to-last-non-overflowing-wrap-opportunity': {
      const count = rebuildLineForTrailingSoftHyphen(b)
      return count ? lineBuilderResult(true, count, true) : lineBuilderResult(true)
    }
    case 'break': {
      const t = r.partialTrailingContent
      commitCandidateContent(b, candidate.content, t)
      const committed = t.trailingRunIndex + 1
      if (t.partialRun === null) return lineBuilderResult(true, committed)
      const item = runs[t.trailingRunIndex]!.item as WebKitTextItem
      b.shapedCarry = candidate.content.hasShapedContent
      return lineBuilderResult(true, committed, false, item.end - item.start - t.partialRun.length, overflowWidthAsLeadingForNextLine(runs, r))
    }
  }
}

// LineBuilder::handleInlineContent (ILB:1432-1481) with no ruby or cloned decorations. A line constrained by a float counts
// as having content, so content that doesn't fit beside the floats wraps (:1454-1455).
function handleInlineContent(b: Builder, candidate: Candidate): LineBuilderResult {
  const c = candidate.content
  if (c.runs.length === 0) return lineBuilderResult(candidate.trailingLineBreak !== null)
  // availableWidth (ILB:1172-1183)
  let available = f32(f32(b.L.lineWidth + 1 / 64) - lastRunLogicalRight(b.line))
  if (Number.isNaN(available)) available = F32_MAX
  const lineHasContent = hasContent(b.line) || b.L.constrainedByFloat
  let r = result('keep', false)
  if (c.logicalWidth > available) r = processInlineContent(b.L, c, lineStatus(b.line, available, lineHasContent, b.wrapOpportunityList.length > 0))
  return processLineBreakingResult(b, candidate, r)
}

// isContentfulOrHasDecoration (ILB:64-78)
function isContentfulItem(p: WebKitPrepared, item: WebKitItem): boolean {
  switch (item.kind) {
    case 'text':
      return !((item.isWhitespace && !preservesSpacesAndTabs(p.boxes[item.box]!.style)) || item.end === item.start || item.isWordSeparator || isZeroWidthSpaceSeparator(p, item))
    case 'soft-line-break':
    case 'hard-line-break':
    case 'atomic':
      return true
    case 'inline-box-start':
      return startEdgeWidth(spanEdges(p, item.element)) !== 0 || hasNonZeroStartEdge(spanEdges(p, item.element))
    case 'inline-box-end':
      return endEdgeWidth(spanEdges(p, item.element)) !== 0 || hasNonZeroEndEdge(spanEdges(p, item.element))
    case 'word-break-opportunity':
      return false
  }
}

function hasNonZeroStartEdge(e: WebKitBoxEdges): boolean {
  return e.marginStart !== 0 || e.borderStart !== 0 || e.paddingStart !== 0
}

function hasNonZeroEndEdge(e: WebKitBoxEdges): boolean {
  return e.marginEnd !== 0 || e.borderEnd !== 0 || e.paddingEnd !== 0
}

// placeInlineAndFloatContent (ILB:499-710) without float items: floats are the slot's insets.
function placeInlineAndFloatContent(b: Builder, start: Position): { end: Position; overflowLogicalWidth: number | null; isLastInlineContent: boolean } {
  const L = b.L
  let placed = 0
  let partialTrailingContentLength = 0
  let overflowLogicalWidth: number | null = null
  let currentIndex = b.rangeStart
  while (currentIndex < b.rangeEnd) {
    const endIndex = nextWrapOpportunity(b, currentIndex)
    const candidate = candidateContentForLine(b, currentIndex, endIndex, lastRunLogicalRight(b.line))
    const r = handleInlineContent(b, candidate)
    let isEndOfLine = r.isEndOfLine
    if (!r.isRevert) {
      placed += r.committedCount
      if (candidate.content.runs.length === r.committedCount && !r.partialTrailingContentLength) {
        if (candidate.trailingWordBreakOpportunity !== null) {
          // <wbr> needs to be on the line as an empty run (:576-580).
          placed++
          appendWordBreakOpportunity(b.line, candidate.trailingWordBreakOpportunity)
        }
        if (candidate.trailingLineBreak !== null) {
          appendLineBreak(b.line, candidate.trailingLineBreak)
          if (candidate.trailingLineBreak.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
          placed++
          isEndOfLine = true
        }
      }
    } else {
      placed = r.committedCount
    }
    if (isEndOfLine) {
      partialTrailingContentLength = r.partialTrailingContentLength
      overflowLogicalWidth = r.overflowLogicalWidth
      break
    }
    currentIndex = b.rangeStart + placed
  }
  let end: Position
  if (!placed) {
    end = start
  } else if (!partialTrailingContentLength) {
    end = { index: b.rangeStart + placed, offset: 0 }
  } else {
    const index = b.rangeStart + placed - 1
    const item = L.p.items[index] as WebKitTextItem
    end = { index, offset: item.end - item.start - partialTrailingContentLength }
  }
  // handleLineEnding (:633-707), isLastLineWithInlineContent (:1889-1916).
  let isLastInlineContent: boolean
  if (partialTrailingContentLength) {
    isLastInlineContent = false
  } else if (end.index === b.rangeEnd) {
    isLastInlineContent = (start.index === 0 && start.offset === 0) || lineHasVisuallyNonEmptyContent(L.p, b.line)
  } else {
    isLastInlineContent = true
    for (let i = end.index; i < b.rangeEnd && isLastInlineContent; i++) isLastInlineContent = !isContentfulItem(L.p, L.p.items[i]!)
  }
  handleTrailingTrimmableContent(L, b.line)
  handleTrailingHangingContent(b.line, L.lineWidth, isLastInlineContent)
  resetBidiLevelForTrailingWhitespace(L, b.line)
  if (hasContent(b.line)) applyRunBasedAlignmentIfApplicable(L, b.line, isLastInlineContent)
  return { end, overflowLogicalWidth, isLastInlineContent }
}

// applyRunBasedAlignmentIfApplicable (ILB:679-704) with text-align-last: auto: the last line and a line ending at a line break
// aren't justified. Hanging trailing white space is detached into its own run first (IL:235-241, Line::Run::
// detachTrailingWhitespace IL:918-941) and counts no opportunity.
function applyRunBasedAlignmentIfApplicable(L: Layout, line: Line, isLastInlineContent: boolean): void {
  const last = line.runs[line.runs.length - 1]!
  if (isLastInlineContent || isLineBreakRun(last) || L.p.style.textAlign !== 'justify') return
  const hangingLength = line.hanging === null ? 0 : line.hanging.length
  const spaceToDistribute = f32(f32(L.lineWidth - line.contentLogicalWidth) + (hangingLength > 0 ? line.hanging!.width : 0))
  if (hangingLength > 0 && last.kind === 'text' && last.trailingWhitespace !== null && last.trailingWhitespace.length !== last.textLength) {
    line.runs.push(detachTrailingWhitespace(last, last.trailingWhitespace))
  }
  line.contentLogicalWidth = f32(line.contentLogicalWidth + applyTextAlignJustify(L.p.boxes, line.runs, hangingLength, spaceToDistribute))
}

// LineBuilder::createLineSpanningInlineBoxes (ILB:385-430): the spans the line starts inside, outermost first; a leading
// inline box end means its span is open at the line start.
function lineSpanningInlineBoxes(p: WebKitPrepared, itemIndex: number): number[] {
  const first = p.items[itemIndex]
  if (first === undefined) return []
  const out: number[] = []
  if (first.kind === 'inline-box-end') out.push(first.element)
  for (let e = parentOf(p, first); e >= 0; e = p.elements[e]!.parent) out.push(e)
  return out.reverse()
}

// ---- Source offsets and the line rect ----

export function sourceOffset(p: WebKitPrepared, position: Position): number {
  const item = p.items[position.index]
  if (item === undefined) return p.runStarts[p.runStarts.length - 1]!
  switch (item.kind) {
    case 'text': return p.boxes[item.box]!.sourceStart + item.start + position.offset
    case 'soft-line-break': return p.boxes[item.box]!.sourceStart + item.start
    case 'inline-box-start':
    case 'inline-box-end':
    case 'atomic':
    case 'hard-line-break':
    case 'word-break-opportunity':
      return item.sourceOffset
  }
}

type LineRect = { left: number; width: number }

// LineBuilder::floatAvoidingRect (ILB:1185-1216) against the start and end float edges beside the line, the floats' margin
// box edges in LayoutUnits (null where no float intersects the line). text-indent acts as a start margin, so the floats are
// tested against the line's margin box. Rect arithmetic is float (FloatRect::shiftXEdgeTo, shiftMaxXEdgeTo,
// FloatRect.h:132-143).
function floatAvoidingRect(rect: LineRect, marginStart: number, startX: number | null, endX: number | null): { rect: LineRect; constrained: boolean } {
  if (startX === null && endX === null) return { rect, constrained: false }
  let left = f32(rect.left - marginStart)
  let width = f32(rect.width + marginStart)
  let constrained = false
  if (startX !== null && startX > left) {
    const delta = f32(startX - left)
    left = startX
    width = Math.max(0, f32(width - delta))
    constrained = true
  }
  if (endX !== null && endX < f32(left + width)) {
    const edge = Math.max(left, endX)
    width = Math.max(0, f32(width + f32(edge - f32(left + width))))
    constrained = true
  }
  return { rect: { left: f32(left + marginStart), width: f32(width - marginStart) }, constrained }
}

// The line rect of LineBuilder::initialize (ILB:432-478): the container's content box as a LayoutUnit width; in an RTL block
// the start float is the right one. Returns logical coordinates from the content box start.
// - Floats already in the formatting context narrow the initial rect (floatAvoidingRect with no margin, :463-471), then
//   text-indent moves and narrows it (:474-477), and m_lineContentEdgeOffset, which tab stops read, is the rect's left (:478).
// - The lab protocol puts the slot floats before the content (DESIGN.md §2.9), so the paragraph's first line build places
//   them itself (placeInlineAndFloatContent, tryPlacingFloatBox, :1329-1400): initialize finds no floats, the offset is the
//   indent alone, and each float then narrows the line with the indent as margin start (:1394-1396), in document order, the
//   left float first.
function lineRect(p: WebKitPrepared, slot: LineSlot, indent: number, placesSlotFloats: boolean): LineLogicalRect {
  const containerWidth = layoutUnit(f32(f32(slot.width) * f32(p.zoom)))
  const startInset = layoutUnit(f32(f32(p.style.rtl ? slot.right : slot.left) * f32(p.zoom)))
  const endInset = layoutUnit(f32(f32(p.style.rtl ? slot.left : slot.right) * f32(p.zoom)))
  const startX = startInset > 0 ? startInset : null
  const endX = endInset > 0 ? f32(containerWidth - endInset) : null
  const initial: LineRect = { left: 0, width: f32(containerWidth) }
  const indented = (r: LineRect): LineRect => ({ left: f32(r.left + indent), width: f32(r.width + -indent) })
  if (!placesSlotFloats) {
    const avoided = floatAvoidingRect(initial, 0, startX, endX)
    const rect = indented(avoided.rect)
    return { left: rect.left, width: rect.width, contentEdgeOffset: rect.left, constrainedByFloat: avoided.constrained }
  }
  let rect = indented(initial)
  const contentEdgeOffset = rect.left
  let constrainedByFloat = false
  const place = (s: number | null, e: number | null) => {
    const avoided = floatAvoidingRect(rect, indent, s, e)
    rect = avoided.rect
    constrainedByFloat = constrainedByFloat || avoided.constrained
  }
  // The physical left float, then the right one with both in the formatting context.
  if (slot.left > 0) place(p.style.rtl ? null : startX, p.style.rtl ? endX : null)
  if (slot.right > 0) place(startX, endX)
  return { left: rect.left, width: rect.width, contentEdgeOffset, constrainedByFloat }
}

// ---- Filling a line ----

// computedTextIndent (IFU:143-179): the first formatted line of a non-anonymous block, the fixed amount in px at zoom.
export function textIndent(p: WebKitPrepared, start: WebKitLineStart): number {
  return start.isFirstFormattedLine ? f32(f32(p.style.textIndent) * f32(p.zoom)) : 0
}

// What a builder placed: the closed line, where its content ends, the width the rest of a split item carries to the next
// line and whether that comes from shaping across inline boxes, what the alignment reads (IFU:198-276), and how far it read.
type Placed = { line: Line; end: Position; overflowLogicalWidth: number | null; carriedFromShaping: boolean; isLastLineOrLineEndsWithForcedLineBreak: boolean; measuredEnd: number }

// The rest of the item the line before split. InlineTextItem::right (InlineTextItem.cpp:65-71) keeps the carried width as the
// stored width.
function partialLeadingTextItem(p: WebKitPrepared, start: WebKitLineStart): WebKitTextItem | null {
  if (start.previousLine === null || start.offset === 0) return null
  const item = p.items[start.itemIndex] as WebKitTextItem
  return { ...item, start: item.start + start.offset, width: start.previousLine.carriedWidth }
}

// hasInlineBoxesOnly (RangeBasedLineBuilder.cpp:51-78): one line of the inline box runs, no content, eligible spans have no
// decoration.
function placeInlineBoxesOnly(p: WebKitPrepared, start: WebKitLineStart): Placed {
  const line = newLine([])
  for (let i = 0; i < p.items.length; i++) line.runs.push(elementRun(p.items[i] as InlineBoxItem, 0, 0))
  return { line, end: { index: p.items.length, offset: 0 }, overflowLogicalWidth: null, carriedFromShaping: false, isLastLineOrLineEndsWithForcedLineBreak: true, measuredEnd: start.itemIndex }
}

// TextOnlySimpleLineBuilder over the whole item list, or inside the span of RangeBasedLineBuilder
// (RangeBasedLineBuilder.cpp:70-124).
function placeWithSimpleBuilder(L: Layout, start: WebKitLineStart, rangeBased: boolean): Placed {
  const items = L.p.items
  const itemsEnd: Position = { index: items.length, offset: 0 }
  const rangeStart = rangeBased && start.isFirstFormattedLine ? start.itemIndex + 1 : start.itemIndex
  const rangeEnd = rangeBased ? items.length - 1 : items.length
  const b: Builder = { L, rangeStart, rangeEnd, partialLeadingTextItem: partialLeadingTextItem(L.p, start), wrapOpportunityList: [], line: newLine([]), spanningInlineBoxes: [], measuredEnd: start.itemIndex, shapedCarry: false }
  const single = items[0]
  if (!rangeBased && items.length === 1 && single !== undefined && single.kind === 'text' && single.end - single.start <= 1 && !single.isWhitespace) {
    // placeSingleCharacterContentIfApplicable (TOS:164-196): one line, the stored width, no fit test.
    appendTextFast(L, b.line, single, single.width ?? 0)
    return { line: b.line, end: itemsEnd, overflowLogicalWidth: null, carriedFromShaping: false, isLastLineOrLineEndsWithForcedLineBreak: true, measuredEnd: 1 }
  }
  const placed = L.p.style.wrap ? placeInlineTextContent(b) : placeNonWrappingInlineTextContent(b)
  const reachesRangeEnd = placed.end.index === rangeEnd && placed.end.offset === 0
  if (rangeBased) {
    // insertLeadingInlineBoxRun and appendTrailingInlineBoxRunIfNeeded (RangeBasedLineBuilder.cpp:106-126): the span's
    // start run on the first formatted line, a spanning start on later ones, and its end run at the content width on
    // the line that places the last content.
    const leading = items[0] as InlineBoxItem
    b.line.runs.unshift(start.isFirstFormattedLine ? elementRun(leading, 0, 0) : { kind: 'spanning-inline-box-start', element: leading.element, left: 0, width: 0, level: OPAQUE_BIDI_LEVEL })
    if (reachesRangeEnd) b.line.runs.push(elementRun(items[items.length - 1] as InlineBoxItem, b.line.contentLogicalWidth, 0))
  }
  // TOS:113-117: the placed content reaches the range end, or the line ends with a line break.
  return {
    line: b.line, end: rangeBased && reachesRangeEnd ? itemsEnd : placed.end, overflowLogicalWidth: placed.overflowLogicalWidth, carriedFromShaping: false,
    isLastLineOrLineEndsWithForcedLineBreak: reachesRangeEnd || isLineBreakRun(b.line.runs[b.line.runs.length - 1]), measuredEnd: b.measuredEnd,
  }
}

function placeWithLineBuilder(L: Layout, start: WebKitLineStart): Placed {
  const items = L.p.items
  const spanning = lineSpanningInlineBoxes(L.p, start.itemIndex)
  const b: Builder = { L, rangeStart: start.itemIndex, rangeEnd: items.length, partialLeadingTextItem: partialLeadingTextItem(L.p, start), wrapOpportunityList: [], line: newLine(spanning), spanningInlineBoxes: spanning, measuredEnd: start.itemIndex, shapedCarry: false }
  const placed = placeInlineAndFloatContent(b, { index: start.itemIndex, offset: start.offset })
  // ILB:355-362: the last line with inline content, the end of the layout range, or a trailing forced line break.
  return {
    line: b.line, end: placed.end, overflowLogicalWidth: placed.overflowLogicalWidth, carriedFromShaping: placed.overflowLogicalWidth !== null && b.shapedCarry,
    isLastLineOrLineEndsWithForcedLineBreak: placed.isLastInlineContent || (placed.end.index === items.length && placed.end.offset === 0) || isLineBreakRun(b.line.runs[b.line.runs.length - 1]),
    measuredEnd: b.measuredEnd,
  }
}

// One line of InlineFormattingContext::lineLayout (InlineFormattingContext.cpp:293-360) with the builder the paragraph
// chose, then leadingInlineItemPositionForNextLine (IFU:278-298). It decides where the line breaks and what the next line
// starts from; the line's fragments, display boxes and gaps are read from the decided line on request.
export function fillLine(p: WebKitPrepared, start: WebKitLineStart, slot: LineSlot): WebKitFillResult {
  if (slot.left < 0 || slot.right < 0) throw new Error(`a line slot's insets are float widths and can't be negative (${slot.left}, ${slot.right})`)
  const hasFloats = start.hasFloats || slot.left > 0 || slot.right > 0
  const builder = hasFloats ? 'line-builder' : p.builder
  // The simple builders take the initial line rect: no floats and no text-indent (TOS:136-162), since text-indent makes the
  // content ineligible for them.
  // The paragraph's first build places the slot floats; a refused first build hands its start on with hasFloats set.
  const placesSlotFloats = start.previousLine === null && !start.hasFloats
  const rect = lineRect(p, builder === 'line-builder' ? slot : { width: slot.width, left: 0, right: 0 }, builder === 'line-builder' ? textIndent(p, start) : 0, placesSlotFloats)
  const L: Layout = { p, lineWidth: rect.width, contentEdgeOffset: rect.contentEdgeOffset, constrainedByFloat: rect.constrainedByFloat, gaps: p.inspect === null ? null : [] }
  let placed: Placed
  switch (builder) {
    case 'inline-boxes-only': placed = placeInlineBoxesOnly(p, start); break
    case 'text-only-simple': placed = placeWithSimpleBuilder(L, start, false); break
    case 'range-based': placed = placeWithSimpleBuilder(L, start, true); break
    case 'line-builder': placed = placeWithLineBuilder(L, start); break
  }
  const { line, end: lineContentEnd, overflowLogicalWidth } = placed
  const itemsEnd = p.items.length
  // Floats kept every content from the line: the next line box moves below them (IFU:54-103, :286-289).
  const placedNothing = lineContentEnd.index === start.itemIndex && lineContentEnd.offset === start.offset
  if (placedNothing && L.constrainedByFloat && !(lineContentEnd.index === itemsEnd && lineContentEnd.offset === 0)) {
    // The refused build placed the slot floats, so the next build finds them in the formatting context.
    return { kind: 'below-floats', line: { engine: 'webkit', kind: 'below-floats', from: start, slot, measuredEnd: placed.measuredEnd, gaps: L.gaps }, next: { ...start, hasFloats: true } }
  }
  let next: Position = lineContentEnd
  if (start.previousLine !== null) {
    const advanced = start.itemIndex < lineContentEnd.index || (start.itemIndex === lineContentEnd.index && start.offset < lineContentEnd.offset)
    if (!advanced && !(lineContentEnd.index === itemsEnd && lineContentEnd.offset === 0)) {
      next = { index: Math.min(lineContentEnd.index + 1, itemsEnd), offset: 0 }
    }
  }
  const isEnd = next.index === itemsEnd && next.offset === 0
  const lineStart = start.itemIndex === 0 && start.offset === 0 ? 0 : sourceOffset(p, { index: start.itemIndex, offset: start.offset })
  const lineEnd = isEnd ? p.runStarts[p.runStarts.length - 1]! : sourceOffset(p, next)
  // Line::close's isContentful (IL:87-110, 621-629): a run with content, or an inline box with decoration; undecorated
  // spans aren't contentful, so a line of collapsed white space and span edges has no line box (LineLayoutResult.h:94-105).
  const hasContentfulInFlowContent = lineHasVisuallyNonEmptyContent(p, line)
  return {
    kind: 'line',
    line: { engine: 'webkit', kind: 'line', from: start, slot, builder, rect, line, start: lineStart, end: lineEnd, isLastLineOrLineEndsWithForcedLineBreak: placed.isLastLineOrLineEndsWithForcedLineBreak, measuredEnd: placed.measuredEnd, gaps: L.gaps },
    start: lineStart,
    end: lineEnd,
    next: isEnd ? null : {
      engine: 'webkit', itemIndex: next.index, offset: next.offset,
      previousLine: { carriedWidth: overflowLogicalWidth, endsWithLineBreak: isLineBreakRun(line.runs[line.runs.length - 1]), carriedFromShaping: placed.carriedFromShaping },
      isFirstFormattedLine: start.isFirstFormattedLine && !hasContentfulInFlowContent,
      hasFloats,
    },
    hasLineBox: hasContentfulInFlowContent,
  }
}
