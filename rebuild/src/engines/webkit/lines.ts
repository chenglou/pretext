// WebKit line filling (Safari 27.0): Line bookkeeping, InlineContentBreaker with breakWord and the carried remainder, the
// line builders, TextOnlySimpleLineBuilder (also run inside RangeBasedLineBuilder) and LineBuilder
// (specs/webkit-lines.md §1, §4-§9), the line rect from floats and text-indent, alignment, and the line's output from the
// closed Line::Run list: display boxes (InlineDisplayContentBuilder) and fragments. Cited at WebKit-7625.1.29.11.27 under
// Source/WebCore/layout/formattingContexts/inline/: IL = InlineLine.cpp, ICB = InlineContentBreaker.cpp,
// TOS = TextOnlySimpleLineBuilder.cpp, ILB = InlineLineBuilder.cpp, IFU = InlineFormattingUtils.cpp,
// ALB = AbstractLineBuilder.cpp, IDCB = display/InlineDisplayContentBuilder.cpp, IDLB = display/InlineDisplayLineBuilder.cpp,
// LBB = InlineLineBoxBuilder.cpp.
import type { Measurer } from '../../measure/canvas.js'
import type { Fragment, Gap, GapName, LineResultOf, LineSlot, TextAlign, WebKitDisplayBox, WebKitLineGeometry } from '../../model.js'
import { canBreakBefore, findNextBreakablePosition, hasDictionaryCharacter, inBetweenRangeStartingWithMark, makeFactory, mayBreakInBetween } from './breaks.js'
import { applyTextAlignJustify, type ExpandableRun, type ExpansionBehavior } from './expansion.js'
import { DEFAULT_BIDI_LEVEL, familyDraws, hasLanguageDependentFallback } from './content.js'
import { isDelimiterQuote, isPunctuation, lineRules, localeScript } from './data.js'
import { hasEmojiPresentation } from './fonts.js'
import { joinsAcross } from './joining.js'
import { measureText } from '../../measure/canvas.js'
import { boxWidth, breakWord, canvasString, controlsMeasureExactly, firstUserPerceivedCharacterLength, fixedPitchShortcutWidth, forwardOneCodePoint, hyphenGlyphsDiffer, hyphenWidth, itemWidth, measuredEnd, mergedGlyphs } from './measure.js'
import { collapsesWhiteSpace, endEdgeWidth, layoutUnit, preservesSpacesAndTabs, startEdgeWidth, tabsAllowed, trailingWhitespaceHangs } from './style.js'
import type { WebKitBox, WebKitBoxEdges, WebKitHistoryWorld, WebKitItem, WebKitLineStart, WebKitPrepared, WebKitStyle, WebKitTextItem } from './types.js'

const f32 = Math.fround
const F32_MAX = 3.4028234663852886e38
const OPAQUE_BIDI_LEVEL = 255

// `lineWidth` is m_lineLogicalRect.width(); `gaps` collects the gaps this line's filling decides. `measuredEnd` is the item
// index past the last item the builder read a width or a break opportunity of: the line's content and the candidate content
// that ended the line. `reverted` says the builder rebuilt the line back to an earlier wrap opportunity, so every wrap
// opportunity of the line took part in its break decision. `decisionStart` is the item index where the last candidate content
// the builder formed begins: from there to `measuredEnd` is the content whose fit ended the line. `overflowStart` is the
// `decisionStart` of the last candidate that didn't fit (InlineContentBreaker ran on it), or null.
// `shapedCarry` says the width carried to the next line comes from a candidate shaped across inline boxes.
type Layout = { p: WebKitPrepared; m: Measurer; lineWidth: number; contentEdgeOffset: number; constrainedByFloat: boolean; gaps: Gap[]; measuredEnd: number; reverted: boolean; decisionStart: number; overflowStart: number | null; shapedCarry: boolean }
type SoftLineBreakItem = Extract<WebKitItem, { kind: 'soft-line-break' }>
type HardLineBreakItem = Extract<WebKitItem, { kind: 'hard-line-break' }>
type LineBreakItem = SoftLineBreakItem | HardLineBreakItem
type WordBreakOpportunityItem = Extract<WebKitItem, { kind: 'word-break-opportunity' }>
type InlineBoxItem = Extract<WebKitItem, { kind: 'inline-box-start' | 'inline-box-end' }>
type AtomicItem = Extract<WebKitItem, { kind: 'atomic' }>
type ContentItem = WebKitTextItem | InlineBoxItem | AtomicItem
type Position = { index: number; offset: number }

// ---- Styles and layout boxes ----

// The span's box edges, or none for a text leaf's parent that is the block.
function spanEdges(p: WebKitPrepared, element: number): WebKitBoxEdges {
  const e = p.elements[element]!
  if (e.kind !== 'span') throw new Error(`element ${element} is ${e.kind}, not an inline box`)
  return e.edges
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

// TextUtil::hyphenWidth, read while filling a line. Where FontFacts.mapsHyphen isn't given and U+2010 and U+002D measure
// differently, the fact decides this line's fit, so the line reports hyphen-glyph.
function lineHyphenWidth(L: Layout, box: WebKitBox): number {
  if (box.hyphenUnknown && hyphenGlyphsDiffer(L.m, box) && !L.gaps.some(g => g.gap === 'hyphen-glyph' && g.run === box.run)) {
    L.gaps.push({ gap: 'hyphen-glyph', run: box.run, detail: `whether ${box.primaryFamily} maps U+2010 isn't given; laid out with U+2010, which measures differently from "-" here` })
  }
  return hyphenWidth(L.m, box)
}

// ---- Line (IL, InlineLine.h) ----

type TrailingWhitespace = 'not-applicable' | 'not-collapsible' | 'collapsible' | 'collapsed'

type LineRun = {
  kind: 'text' | 'soft-line-break' | 'hard-line-break' | 'word-break-opportunity' | 'atomic' | 'inline-box-start' | 'inline-box-end' | 'spanning-inline-box-start'
  isWordSeparator: boolean
  // The text box for text and soft line break runs, -1 for the others.
  box: number
  // The element for inline box, atomic, hard line break and word break opportunity runs, -1 for text.
  element: number
  left: number
  width: number
  level: number
  textStart: number
  textLength: number
  // Line::Run::Text::needsHyphen (InlineLine.h:388-393): the hyphen width is inside `width`.
  needsHyphen: boolean
  trailing: TrailingWhitespace
  trailingLength: number
  trailingWidth: number
  lastNonWhitespaceContentStart: number | null
  // Line::Run::setExpansion (InlineContentAligner.cpp:230-266): the justification expansion inside `width`, and its behavior.
  expansion: number
  expansionBehavior: ExpansionBehavior
  // Line::ShapingBoundary (InlineLine.h:52, :165-168): the run's text was shaped with its neighbours across inline boxes.
  shapingBoundary: ShapingBoundary | null
}

type ShapingBoundary = 'start' | 'inside' | 'end'

type Line = {
  runs: LineRun[]
  contentLogicalWidth: number
  // TrimmableTrailingContent
  trimRunIndex: number | null
  trimHasFully: boolean
  trimOffset: number
  trimWidth: number
  // The unit TrimmableTrailingContent::remove took out of its run (IL:963-987): still in the box's content, in no run.
  trimmedUnit: { box: number; offset: number; level: number } | null
  // HangingContent's trailing white space (IsConditional::WhenFollowedByForcedLineBreak).
  hanging: { length: number; width: number } | null
  trailingSoftHyphenWidth: number | null
  hasNonDefaultBidiLevelRun: boolean
  // m_inlineBoxLogicalLeftStack (IL:307-309, :331-336).
  inlineBoxLogicalLeftStack: number[]
}

// Line::initialize (IL:48-78): a line starting inside spans begins with their spanning inline box starts, outermost first,
// at the opaque bidi level, without widths (box-decoration-break: slice).
function newLine(spanning: readonly number[]): Line {
  const line: Line = {
    runs: [], contentLogicalWidth: 0, trimRunIndex: null, trimHasFully: false, trimOffset: 0, trimWidth: 0, trimmedUnit: null,
    hanging: null, trailingSoftHyphenWidth: null, hasNonDefaultBidiLevelRun: false, inlineBoxLogicalLeftStack: [],
  }
  for (let i = 0; i < spanning.length; i++) line.runs.push(boxRun('spanning-inline-box-start', spanning[i]!, 0, 0, OPAQUE_BIDI_LEVEL))
  return line
}

function boxRun(kind: LineRun['kind'], element: number, left: number, width: number, level: number): LineRun {
  return { kind, isWordSeparator: false, box: -1, element, left, width, level, textStart: 0, textLength: 0, needsHyphen: false, trailing: 'not-applicable', trailingLength: 0, trailingWidth: 0, lastNonWhitespaceContentStart: null, expansion: 0, expansionBehavior: { left: 'allow', right: 'allow' }, shapingBoundary: null }
}

function lastRunLogicalRight(line: Line): number {
  const last = line.runs[line.runs.length - 1]
  return last === undefined ? 0 : f32(last.left + last.width)
}

function resetTrimmable(line: Line): void {
  line.trimRunIndex = null
  line.trimHasFully = false
  line.trimOffset = 0
  line.trimWidth = 0
}

// Line::resetTrailingContent (IL:80-85).
function resetTrailingContent(line: Line): void {
  resetTrimmable(line)
  line.hanging = null
  line.trailingSoftHyphenWidth = null
}

// Line::Run::isContentful (InlineLine.h:129), and Line::hasContent (InlineLine.h:338-348).
function isContentfulRun(run: LineRun): boolean {
  return (run.kind === 'text' && run.textLength > 0) || run.kind === 'soft-line-break' || run.kind === 'hard-line-break' || run.kind === 'atomic'
}

function hasContent(line: Line): boolean {
  for (let i = line.runs.length - 1; i >= 0; i--) if (isContentfulRun(line.runs[i]!)) return true
  return false
}

// Line::Run::isContentfulOrHasDecoration (IL:989-1008) with box-decoration-break: slice.
function isContentfulOrHasDecorationRun(p: WebKitPrepared, run: LineRun): boolean {
  if (isContentfulRun(run)) return true
  switch (run.kind) {
    case 'inline-box-start': {
      if (run.width !== 0) return true
      const e = spanEdges(p, run.element)
      return e.marginStart !== 0 || e.borderStart !== 0 || e.paddingStart !== 0
    }
    case 'inline-box-end': {
      if (run.width !== 0) return true
      const e = spanEdges(p, run.element)
      return e.marginEnd !== 0 || e.borderEnd !== 0 || e.paddingEnd !== 0
    }
    default:
      return false
  }
}

// Line::lineHasVisuallyNonEmptyContent (IL:621-629), the isContentful of Line::close.
function lineHasVisuallyNonEmptyContent(p: WebKitPrepared, line: Line): boolean {
  for (let i = line.runs.length - 1; i >= 0; i--) if (isContentfulOrHasDecorationRun(p, line.runs[i]!)) return true
  return false
}

function trailingWhitespaceType(p: WebKitPrepared, item: WebKitTextItem): TrailingWhitespace {
  if (!item.isWhitespace) return 'not-applicable'
  if (preservesSpacesAndTabs(p.boxes[item.box]!.style)) return 'not-collapsible'
  return item.end - item.start === 1 ? 'collapsible' : 'collapsed'
}

function isZeroWidthSpaceSeparator(p: WebKitPrepared, item: WebKitTextItem): boolean {
  const length = item.end - item.start
  return length === 0 || (length === 1 && p.boxes[item.box]!.text.charCodeAt(item.start) === 0x200b)
}

function textRun(p: WebKitPrepared, item: WebKitTextItem, left: number, width: number): LineRun {
  const type = trailingWhitespaceType(p, item)
  const length = type === 'collapsed' ? 1 : item.end - item.start
  return {
    kind: 'text', isWordSeparator: item.isWordSeparator, box: item.box, element: -1, left, width, level: item.level, textStart: item.start,
    textLength: length, needsHyphen: false, trailing: type, trailingLength: type === 'not-applicable' ? 0 : length,
    trailingWidth: type === 'not-applicable' ? 0 : width, lastNonWhitespaceContentStart: null, expansion: 0, expansionBehavior: { left: 'allow', right: 'allow' },
    shapingBoundary: null,
  }
}

// Line::Run::expand (IL:891-916)
function expandRun(p: WebKitPrepared, run: LineRun, item: WebKitTextItem, width: number): void {
  run.width = f32(run.width + width)
  const type = trailingWhitespaceType(p, item)
  if (type === 'not-applicable') {
    run.trailing = 'not-applicable'
    run.trailingLength = 0
    run.trailingWidth = 0
    run.textLength += item.end - item.start
    run.lastNonWhitespaceContentStart = item.start
    return
  }
  const whitespaceWidth = run.trailing === 'not-applicable' ? width : f32(run.trailingWidth + width)
  const length = type === 'collapsed' ? 1 : item.end - item.start
  run.trailing = type
  run.trailingLength = length
  run.trailingWidth = whitespaceWidth
  run.textLength += length
}

function updateTrailingContent(L: Layout, line: Line, item: WebKitTextItem, width: number, oldContentLogicalWidth: number): void {
  line.trailingSoftHyphenWidth = null
  const style = L.p.boxes[item.box]!.style
  const isTrimmable = item.isWhitespace && !preservesSpacesAndTabs(style)
  if (isTrimmable) {
    // TrimmableTrailingContent::addFullyTrimmableContent (IL:723-732)
    const offset = f32(f32(line.contentLogicalWidth - oldContentLogicalWidth) - width)
    line.trimWidth = f32(offset + width)
    line.trimOffset = offset
    line.trimHasFully = true
    line.trimRunIndex ??= line.runs.length - 1
  } else {
    resetTrimmable(line)
  }
  line.hanging = !isTrimmable && item.isWhitespace && trailingWhitespaceHangs(style) ? { length: item.end - item.start, width } : null
  if (item.hasTrailingSoftHyphen) line.trailingSoftHyphenWidth = lineHyphenWidth(L, L.p.boxes[item.box]!)
}

// Line::appendText (IL:346-481), LineBuilder's variant.
function appendText(L: Layout, line: Line, item: WebKitTextItem, width: number, shapingBoundary: ShapingBoundary | null = null): void {
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
      willCollapseCompletely = run.trailing === 'collapsible' || run.trailing === 'collapsed'
      break
    }
  }
  if (willCollapseCompletely) return
  const last = line.runs[line.runs.length - 1]
  const needsNewRun = last === undefined || last.kind !== 'text' || last.box !== item.box || last.level !== item.level
    || last.trailing === 'collapsed'
    || (box.wordSpacing !== 0 && (item.isWordSeparator || (last.isWordSeparator && last.level !== DEFAULT_BIDI_LEVEL)))
    || isZeroWidthSpaceSeparator(p, item)
    || (box.style.rtl && preserve && item.isWhitespace !== (last.trailing !== 'not-applicable' && last.trailingLength === last.textLength))
    || shapingBoundary !== null || last.shapingBoundary !== null
  const oldContentLogicalWidth = line.contentLogicalWidth
  let contentLogicalRight: number
  if (needsNewRun) {
    const left = f32(lastRunLogicalRight(line) + (item.isWordSeparator ? box.wordSpacing : 0))
    const run = textRun(p, item, left, width)
    run.shapingBoundary = shapingBoundary
    line.runs.push(run)
    contentLogicalRight = f32(left + width)
  } else if (box.letterSpacing >= 0) {
    expandRun(p, last, item, width)
    contentLogicalRight = f32(last.left + last.width)
  } else {
    let withoutLastTextRun: number
    if (box.wordSpacing >= 0) {
      withoutLastTextRun = f32(line.contentLogicalWidth - Math.max(0, last.width))
    } else {
      let rightMost = 0
      for (let i = line.runs.length - 1; i >= 0; i--) rightMost = Math.max(rightMost, f32(line.runs[i]!.left + line.runs[i]!.width))
      withoutLastTextRun = Math.max(0, rightMost)
    }
    const lastRight = f32(last.left + last.width)
    expandRun(p, last, item, width)
    contentLogicalRight = Math.max(withoutLastTextRun, f32(lastRight + width))
  }
  line.contentLogicalWidth = Math.max(oldContentLogicalWidth, contentLogicalRight)
  updateTrailingContent(L, line, item, width, oldContentLogicalWidth)
}

// Line::appendTextFast (IL:483-556), the simple builder's variant.
function appendTextFast(L: Layout, line: Line, item: WebKitTextItem, width: number): void {
  const p = L.p
  const box = p.boxes[item.box]!
  const last = line.runs[line.runs.length - 1]
  const willCollapseCompletely = item.isWhitespace && !preservesSpacesAndTabs(box.style)
    && (last === undefined || last.trailing === 'collapsible' || last.trailing === 'collapsed')
  if (willCollapseCompletely) return
  const needsNewRun = last === undefined || last.trailing === 'collapsed' || last.box !== item.box || isZeroWidthSpaceSeparator(p, item)
  const oldContentLogicalWidth = line.contentLogicalWidth
  if (needsNewRun) {
    const left = lastRunLogicalRight(line)
    line.runs.push(textRun(p, item, left, width))
    line.contentLogicalWidth = f32(left + width)
  } else if (box.letterSpacing >= 0) {
    expandRun(p, last, item, width)
    line.contentLogicalWidth = f32(last.left + last.width)
  } else {
    const withoutLastTextRun = f32(line.contentLogicalWidth - Math.max(0, last.width))
    const lastRight = f32(last.left + last.width)
    expandRun(p, last, item, width)
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
  line.runs.push(boxRun('inline-box-start', item.element, left, logicalWidth, item.level))
}

// Line::appendInlineBoxEnd (IL:317-344). Partially trimmable trailing content comes from text-spacing trim, which the model
// doesn't have, so there is no trailing letter spacing to remove.
function appendInlineBoxEnd(p: WebKitPrepared, line: Line, item: InlineBoxItem, width: number): void {
  const edges = spanEdges(p, item.element)
  if (endEdgeWidth(edges) !== 0) line.hanging = null
  let left = lastRunLogicalRight(line)
  if (inlineBoxLetterSpacing(p, item.element) < 0) left = Math.max(left, line.inlineBoxLogicalLeftStack.length === 0 ? 0 : line.inlineBoxLogicalLeftStack.pop()!)
  line.runs.push(boxRun('inline-box-end', item.element, left, width, item.level))
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
  const e = p.elements[item.element]!
  if (e.kind !== 'atomic') throw new Error(`element ${item.element} isn't atomic`)
  if (e.marginStart >= 0) {
    line.runs.push(boxRun('atomic', item.element, lastRunLogicalRight(line), marginBoxWidth, item.level))
    return
  }
  line.runs.push(boxRun('atomic', item.element, f32(lastRunLogicalRight(line) + e.marginStart), f32(marginBoxWidth - e.marginStart), item.level))
}

// Line::appendLineBreak (IL:588-597): a soft line break run holds its one unit, { position, 1 } (IL:856-865); a hard line
// break run is the <br>'s box.
function appendLineBreak(line: Line, item: LineBreakItem): void {
  line.trailingSoftHyphenWidth = null
  if (item.kind === 'hard-line-break') {
    line.runs.push(boxRun('hard-line-break', item.element, lastRunLogicalRight(line), 0, item.level))
    return
  }
  const run = boxRun('soft-line-break', -1, lastRunLogicalRight(line), 0, item.level)
  run.box = item.box
  run.textStart = item.start
  run.textLength = 1
  line.runs.push(run)
}

// Line::appendWordBreakOpportunity (IL:599-602).
function appendWordBreakOpportunity(line: Line, item: WordBreakOpportunityItem): void {
  line.runs.push(boxRun('word-break-opportunity', item.element, lastRunLogicalRight(line), 0, item.level))
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
  if (line.trimRunIndex === null || line.runs.length === 0) return
  const index = line.trimRunIndex
  const run = line.runs[index]!
  let trimmed = line.trimOffset
  if (line.trimHasFully) {
    let whitespaceWidth = run.trailingWidth
    if (run.lastNonWhitespaceContentStart !== null && L.p.style.rtl) {
      const box = L.p.boxes[run.box]!
      const start = run.lastNonWhitespaceContentStart
      const end = run.textStart + run.textLength
      // TextUtil::trailingWhitespaceWidth (TextUtil.cpp:124-130)
      if (box.text.charCodeAt(end - 1) === 0x20) {
        whitespaceWidth = f32(boxWidth(L.p, L.m, box, start, end, 0, true) - boxWidth(L.p, L.m, box, start, end - 1, 0, false))
      }
    }
    line.trimmedUnit = { box: run.box, offset: run.textStart + run.textLength - 1, level: run.level }
    run.textLength -= 1
    run.trailing = 'not-applicable'
    run.trailingLength = 0
    run.trailingWidth = 0
    run.width = f32(run.width - whitespaceWidth)
    trimmed = f32(trimmed + whitespaceWidth)
  }
  for (let i = index + 1; i < line.runs.length; i++) line.runs[i]!.left = f32(line.runs[i]!.left - trimmed)
  if (run.textLength === 0) line.runs.splice(index, 1)
  resetTrimmable(line)
  line.contentLogicalWidth = f32(line.contentLogicalWidth - trimmed)
}

// Line::resetBidiLevelForTrailingWhitespace (IL:243-287), after trimming and hanging: trailing white-space-only runs take
// the root level where their parity differs, and the trailing white space of the last content run with the other parity
// is detached into its own run at the root level (Line::Run::detachTrailingWhitespace, IL:919-941).
function resetBidiLevelForTrailingWhitespace(L: Layout, line: Line): void {
  if (!line.hasNonDefaultBidiLevelRun) return
  const rootLevel = L.p.style.rtl ? 1 : 0
  const runs = line.runs
  let detach: number | null = null
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.kind === 'atomic' || run.kind === 'soft-line-break' || run.kind === 'hard-line-break' || (run.kind === 'text' && run.trailing === 'not-applicable')) break
    if (run.trailing === 'not-applicable') continue
    const sameInlineDirection = run.level % 2 === rootLevel % 2
    if (run.trailingLength !== run.textLength) {
      detach = sameInlineDirection ? null : i
      break
    }
    if (!sameInlineDirection) run.level = rootLevel
  }
  if (detach === null) return
  const run = runs[detach]!
  const leadingLength = run.textLength - run.trailingLength
  const detached: LineRun = {
    ...run, textStart: run.textStart + leadingLength, textLength: run.trailingLength, width: run.trailingWidth,
    left: f32(f32(run.left + run.width) - run.trailingWidth), level: rootLevel, needsHyphen: false, trailing: 'not-applicable',
    trailingLength: 0, trailingWidth: 0, lastNonWhitespaceContentStart: null, expansionBehavior: { ...run.expansionBehavior },
  }
  run.width = f32(run.width - run.trailingWidth)
  run.textLength = leadingLength
  run.trailing = 'not-applicable'
  run.trailingLength = 0
  run.trailingWidth = 0
  runs.splice(detach + 1, 0, detached)
}

// Line::handleTrailingHangingContent (IL:198-233), outside intrinsic sizing: a conditional hang that fits stops hanging.
// It changes no width, only alignment.
function handleTrailingHangingContent(line: Line, lineWidth: number, isLastFormattedLine: boolean): void {
  if (line.hanging === null || line.hanging.width === 0) return
  const last = line.runs[line.runs.length - 1]
  const endsWithForcedBreak = isLastFormattedLine || (last !== undefined && (last.kind === 'soft-line-break' || last.kind === 'hard-line-break'))
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
  isTextOnlyContent: boolean
  isFullyTrimmable: boolean
  hasTrailingWordSeparator: boolean
  hasTrailingSoftHyphen: boolean
  hasShapedContent: boolean
  // LineCandidate::InlineContent's shaping candidacy (ILB:256-288): text next to an inline box start or end.
  lastTextRunIndex: number | null
  lastInlineBoxIndex: number | null
  hasTextContentSpanningBoxes: boolean
}

function newContent(): Content {
  return {
    runs: [], logicalWidth: 0, leadingTrimmableWidth: 0, trailingTrimmableWidth: 0, hangingContentWidth: null, hasTextContent: false, isTextOnlyContent: true,
    isFullyTrimmable: false, hasTrailingWordSeparator: false, hasTrailingSoftHyphen: false, hasShapedContent: false, lastTextRunIndex: null, lastInlineBoxIndex: null,
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
  c.isTextOnlyContent = false
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
  const wordSpacing = box.wordSpacing
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

type PartialRun = { length: number; logicalWidth: number; hyphenWidth: number | null }
type PartialTrailingContent = { trailingRunIndex: number; partialRun: PartialRun | null; hyphenWidth: number | null }
type BreakAction = 'keep' | 'wrap' | 'wrap-with-hyphen' | 'break' | 'revert-to-last-wrap-opportunity' | 'revert-to-last-non-overflowing-wrap-opportunity'
type BreakResult = { action: BreakAction; isEndOfLine: boolean; partialTrailingContent: PartialTrailingContent | null }
type LineStatus = {
  contentLogicalRight: number
  availableWidth: number
  trimmableOrHangingWidth: number
  trailingSoftHyphenWidth: number | null
  hasFullyTrimmableTrailingContent: boolean
  hasContent: boolean
  hasWrapOpportunityAtPreviousPosition: boolean
}
type TrailingContent = { overflows: boolean; partialRun: PartialRun | null; hyphenWidth: number | null }
type BreakingPosition = { runIndex: number; trailingContent: TrailingContent | null }

function result(action: BreakAction, isEndOfLine: boolean, partialTrailingContent: PartialTrailingContent | null = null): BreakResult {
  return { action, isEndOfLine, partialTrailingContent }
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
  const firstWidth = itemWidth(L.p, L.m, item, item.start, item.start + firstLength, contentLogicalRight)
  const box = L.p.boxes[item.box]!
  if (box.is8Bit) {
    // Storage decides what this break keeps at the line start: one code unit in 8-bit text, the first character and every
    // following one that can't start a line in 16-bit text (:143-157). Latin-1 text is assumed 8-bit (specs/webkit-gaps.md
    // §7.5), so where the unit after the first can't start a line, the 16-bit answer differs.
    if (item.start + firstLength < item.end && !canBreakBefore(box.text.charCodeAt(item.start + firstLength), box.style.lineBreak) && !L.gaps.some(g => g.gap === 'string-storage' && g.run === box.run)) {
      L.gaps.push({ gap: 'string-storage', run: box.run, detail: 'an emergency break keeps one code unit of 8-bit text at the line start, where 16-bit text keeps the following characters that can\'t start a line; Latin-1 text assumed 8-bit', at: { start: box.sourceStart + item.start, end: box.sourceStart + item.start + firstLength + 1 } })
    }
    return { length: firstLength, logicalWidth: firstWidth, hyphenWidth: null }
  }
  let breakPosition = firstLength
  let breakWidth = firstWidth
  while (item.start + breakPosition < item.end) {
    if (canBreakBefore(box.text.charCodeAt(item.start + breakPosition), box.style.lineBreak)) break
    const next = forwardOneCodePoint(box.text, breakPosition, item.end - item.start)
    breakWidth = itemWidth(L.p, L.m, item, item.start, item.start + next, contentLogicalRight)
    breakPosition = next
  }
  return { length: breakPosition, logicalWidth: breakWidth, hyphenWidth: null }
}

// U16_SET_CP_START
function codePointStart(text: string, start: number, index: number): number {
  if (index > start && (text.charCodeAt(index) & 0xfc00) === 0xdc00 && (text.charCodeAt(index - 1) & 0xfc00) === 0xd800) return index - 1
  return index
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
  const wb = breakWord(L.p, L.m, item, spaceRequired(run), availableWidth, logicalLeft)
  if (!wb.length || wb.length === item.end - item.start) return null
  const lineBreak = L.p.boxes[item.box]!.style.lineBreak
  if (canBreakBefore(text.charCodeAt(item.start + wb.length), lineBreak)) return { length: wb.length, logicalWidth: wb.logicalWidth, hyphenWidth: null }
  let right = item.start + wb.length
  for (; right > item.start; right--) {
    right = codePointStart(text, item.start, right)
    if (canBreakBefore(text.charCodeAt(right), lineBreak)) break
  }
  if (right === item.start) return null
  return { length: right - item.start, logicalWidth: itemWidth(L.p, L.m, item, item.start, right, logicalLeft), hyphenWidth: null }
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
        if (canBreakBefore(text.charCodeAt(item.start), lineBreak)) return { length: 0, logicalWidth: 0, hyphenWidth: null }
        // firstBreakablePosition (:542-558): U16_FWD_1 with the item length as its limit, as in the source.
        if (st.hasContent) return null
        let right = item.start
        while (right < item.end) {
          right = forwardOneCodePoint(text, right, length)
          if (canBreakBefore(text.charCodeAt(right), lineBreak)) {
            if (right === item.end) return null
            return { length: right - item.start, logicalWidth: itemWidth(L.p, L.m, item, item.start, right, logicalLeft), hyphenWidth: null }
          }
        }
        return null
      }
      const position = lastValidBreakingPosition(L, runs, index)
      if (position === null) return null
      return { length: position - item.start, logicalWidth: itemWidth(L.p, L.m, item, item.start, position, logicalLeft), hyphenWidth: null }
    }
    case 'arbitrary': {
      if (length === 0) return null
      if (!isOverflowingRun) {
        if (nextTextRunIndex(runs, index) !== null) return { length, logicalWidth: itemWidth(L.p, L.m, item, item.start, item.end, logicalLeft), hyphenWidth: null }
        if (length > 1) return { length: length - 1, logicalWidth: itemWidth(L.p, L.m, item, item.start, item.end - 1, logicalLeft), hyphenWidth: null }
        return null
      }
      if (!lineHasRoomForContent) return { length: 0, logicalWidth: 0, hyphenWidth: null }
      const wb = breakWord(L.p, L.m, item, spaceRequired(run), availableWidth, logicalLeft)
      return { length: wb.length, logicalWidth: wb.logicalWidth, hyphenWidth: null }
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
      if (partial.length) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: overflowingRunIndex, trailingContent: { overflows: false, partialRun: partial, hyphenWidth: null } } }
      const trailing = findTrailingRunIndexBeforeBreakableRun(runs, overflowingRunIndex)
      if (trailing !== null) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailing, trailingContent: { overflows: false, partialRun: null, hyphenWidth: null } } }
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
      return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailingInlineBoxEnd ?? index, trailingContent: { overflows: false, partialRun: null, hyphenWidth: null } } }
    }
    return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: index, trailingContent: { overflows: false, partialRun: partial, hyphenWidth: null } } }
  }

  // tryHyphenationAcrossOverflowingInlineTextItems (:737-811) needs hyphens: auto.

  // tryBreakingNextOverflowingRuns (:704-735)
  let nextContentWidth = f32(nonOverflowing + spaceRequired(overflowingRun))
  for (let index = overflowingRunIndex + 1; index < runs.length; index++) {
    const run = runs[index]!
    if (isBreakableRun(L, run)) {
      const partial = tryBreakingTextRun(L, runs, index, true, f32(st.contentLogicalRight + nextContentWidth), 0, st)
      if (partial !== null) {
        if (partial.length) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: index, trailingContent: { overflows: true, partialRun: partial, hyphenWidth: null } } }
        const trailing = findTrailingRunIndexBeforeBreakableRun(runs, index)
        if (trailing !== null) return { runIndex: overflowingRunIndex, breakingPosition: { runIndex: trailing, trailingContent: { overflows: true, partialRun: null, hyphenWidth: null } } }
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
          if (partial.length < item.end - item.start) return result('break', true, { trailingRunIndex: leadingTextRunIndex, partialRun: partial, hyphenWidth: null })
        }
        if (leadingTextRunIndex !== c.runs.length - 1) {
          for (let k = leadingTextRunIndex + 1; k < c.runs.length; k++) {
            if (c.runs[k]!.item.kind !== 'inline-box-end') return result('break', true, { trailingRunIndex: k - 1, partialRun: null, hyphenWidth: null })
          }
        }
        return result('keep', true)
      }
      if (trailing.overflows && st.hasContent) return result('wrap', true)
      return result('break', true, { trailingRunIndex: position.runIndex, partialRun: trailing.partialRun, hyphenWidth: trailing.hyphenWidth })
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
  L.overflowStart = L.decisionStart
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
  else if (r.action === 'break' && r.partialTrailingContent !== null) index = r.partialTrailingContent.trailingRunIndex
  else return null
  const run = runs[index]!
  const item = run.item
  if (item.kind !== 'text') return null
  if (item.isWhitespace && item.width === null) return null
  if (r.action === 'wrap') return run.contentWidth
  if (r.action === 'break' && r.partialTrailingContent!.partialRun !== null) return f32(run.contentWidth - r.partialTrailingContent!.partialRun.logicalWidth)
  return null
}

// InlineTextItem::left (InlineTextItem.cpp:57-63)
function leftPart(item: WebKitTextItem, length: number): WebKitTextItem {
  return { ...item, end: item.start + length, hasTrailingSoftHyphen: false, width: null }
}

function lineStatus(line: Line, availableWidth: number, lineHasContent: boolean, hasWrapOpportunity: boolean): LineStatus {
  return {
    contentLogicalRight: lastRunLogicalRight(line), availableWidth, trimmableOrHangingWidth: line.trimWidth,
    trailingSoftHyphenWidth: line.trailingSoftHyphenWidth, hasFullyTrimmableTrailingContent: line.trimHasFully,
    hasContent: lineHasContent, hasWrapOpportunityAtPreviousPosition: hasWrapOpportunity,
  }
}

// ---- TextOnlySimpleLineBuilder (TOS) ----

type Builder = {
  L: Layout
  rangeStart: number
  rangeEnd: number
  partialLeadingTextItem: WebKitTextItem | null
  wrapOpportunityList: ContentItem[]
  line: Line
  spanningInlineBoxes: number[]
  isFirstFormattedLine: boolean
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
  if (!item.isWhitespace || preservesSpacesAndTabs(L.p.boxes[item.box]!.style)) return itemWidth(L.p, L.m, item, item.start, item.end, left)
  return itemWidth(L.p, L.m, item, item.start, item.start + 1, left)
}

function revertToTrailingItem(b: Builder, target: ContentItem): number {
  b.L.reverted = true
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
      const t = r.partialTrailingContent!
      for (let i = 0; i < t.trailingRunIndex; i++) appendTextFast(L, b.line, c.runs[i]!.item as WebKitTextItem, c.runs[i]!.contentWidth)
      const committed = t.trailingRunIndex + 1
      const trailing = c.runs[t.trailingRunIndex]!
      const item = trailing.item as WebKitTextItem
      if (t.partialRun === null) {
        appendTextFast(L, b.line, item, trailing.contentWidth)
        if (t.hyphenWidth !== null) addTrailingHyphen(b.line, t.hyphenWidth)
        return simpleResult(true, committed)
      }
      appendTextFast(L, b.line, leftPart(item, t.partialRun.length), t.partialRun.logicalWidth)
      if (t.partialRun.hyphenWidth !== null) addTrailingHyphen(b.line, t.partialRun.hyphenWidth)
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
    L.decisionStart = candidateStart
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
    L.measuredEnd = Math.max(L.measuredEnd, nextIndex)
    if (isAtSoftWrapOpportunityOrContentEnd(b.partialLeadingTextItem)) isEndOfLine = process()
  }
  while (!isEndOfLine && nextIndex < b.rangeEnd) {
    const item = items[nextIndex++]!
    L.measuredEnd = Math.max(L.measuredEnd, nextIndex)
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
  L.decisionStart = b.rangeStart
  while (!isEndOfLine) {
    const item = items[nextIndex]!
    if (item.kind === 'text') {
      candidateWidth = f32(candidateWidth + measuredItemWidth(L, item, candidateWidth))
      candidateEnd++
    } else {
      trailingLineBreakIndex = nextIndex
    }
    nextIndex++
    L.measuredEnd = Math.max(L.measuredEnd, nextIndex)
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

// rule webkit/gap/dictionary-stand-in-between-boxes
// TextUtil::mayBreakInBetween between two boxes, reporting dictionary-breaks-stand-in on the line that asks where the
// iterator's text starts a dictionary range with a combining mark (breaks.ts inBetweenRangeStartingWithMark).
function breakInBetween(L: Layout, prevBox: WebKitBox, nextBox: WebKitBox): boolean {
  if (L.p.env.dictionaryBreaks.kind === 'intl-segmenter-word') {
    const end = inBetweenRangeStartingWithMark(prevBox.text, nextBox.text, nextBox.locale, nextBox.style.lineBreakMode, L.p.icuDefaultLocale)
    if (end !== null) {
      const at = { start: nextBox.sourceStart - Math.min(2, prevBox.text.length), end: nextBox.sourceStart + end }
      if (!L.gaps.some(g => g.gap === 'dictionary-breaks-stand-in' && g.at !== undefined && g.at.start === at.start && g.at.end === at.end)) {
        L.gaps.push({ gap: 'dictionary-breaks-stand-in', run: nextBox.run, detail: "the break test between two text boxes starts a dictionary range with a combining mark from the previous box's last two units, where the line engine resynchronizes from its dictionary and the word segmenter breaks after the mark", at })
      }
    }
  }
  return mayBreakInBetween(prevBox.text, prevBox.is8Bit, nextBox.text, nextBox.is8Bit, nextBox.locale, nextBox.style, L.p.icuDefaultLocale, L.p.env.dictionaryBreaks)
}

// nearestCommonAncestor (IFU:357-383) of two layout boxes by their parents.
function nearestCommonAncestor(p: WebKitPrepared, firstParent: number, secondParent: number): number {
  const ancestors = new Set<number>()
  for (let e = firstParent; e >= 0; e = p.elements[e]!.parent) ancestors.add(e)
  for (let e = secondParent; e >= 0; e = p.elements[e]!.parent) if (ancestors.has(e)) return e
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
  const e = p.elements[item.element]!
  switch (item.kind) {
    case 'inline-box-start': return startEdgeWidth(spanEdges(p, item.element))
    case 'inline-box-end': return endEdgeWidth(spanEdges(p, item.element))
    case 'atomic':
      if (e.kind !== 'atomic') throw new Error(`element ${item.element} isn't atomic`)
      return e.marginBoxWidth
  }
}

// LineBuilder::candidateContentForLine (ILB:1030-1170). Shaping across inline boxes (:780-1028) isn't ported; the
// paragraph reports rtl-shaping-across-inline-boxes.
function candidateContentForLine(b: Builder, startIndex: number, endIndex: number, currentLogicalRight: number): Candidate {
  const L = b.L
  const items = L.p.items
  const candidate: Candidate = { content: newContent(), trailingLineBreak: null, trailingWordBreakOpportunity: null, hasTrailingSoftWrapOpportunity: false }
  L.measuredEnd = Math.max(L.measuredEnd, endIndex)
  L.decisionStart = startIndex
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
        right = f32(right + f32(w + (item.isWordSeparator ? L.p.boxes[item.box]!.wordSpacing : 0)))
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
      candidate.content.logicalWidth = f32(candidate.content.logicalWidth + lineHyphenWidth(L, L.p.boxes[shy.box]!))
      candidate.content.hasTrailingSoftHyphen = true
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
  let lastFont = -1
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
        // FontCascade equality: the box's Canvas settings (font, letter spacing) and word spacing and locale.
        const font = box.context * 1000003 + box.wordSpacing
        if (leading === null) {
          if (isEligibleText) leading = entry.index
          lastFont = font
        } else if (hasBoundaryBetween) {
          if (isEligibleText && font === lastFont && p.boxes[(runs[leading]!.item as WebKitTextItem).box]!.locale === box.locale) trailing = entry.index
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
// totals (probe webkit-round4 R10: the DOM's boxes add up to the Canvas total of the joined text in 35 of 36 run lists in each
// of 10 fonts, and carry no letter spacing). The 36th isn't shaped at all: Core Text returns several glyph runs for a font's
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
    const total = measureText(L.m, firstBox.plainContext, canvasString((joins ? '\u200d' : '') + text + suffix))
    let share = f32(total - following)
    if (suffix !== '') {
      // The difference of two float32 totals isn't the float32 sum of the run's own advances, which the run alone in its
      // joining context is where nothing but joining crosses its edges. The two agree within the rounding of the three totals,
      // half a unit in the last place of the largest for every addition, where that holds: then the run alone stands.
      const alone = measureText(L.m, firstBox.plainContext, canvasString((joins ? '\u200d' : '') + text + (followingJoins ? '\u200d' : '')))
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
  const firstItem = runs[indices[0]!]!.item as WebKitTextItem
  const lastItem = runs[indices[indices.length - 1]!]!.item as WebKitTextItem
  const at = { start: L.p.boxes[firstItem.box]!.sourceStart + firstItem.start, end: L.p.boxes[lastItem.box]!.sourceStart + lastItem.end }
  const known = L.gaps.find(g => g.gap === 'rtl-shaping-across-inline-boxes' && g.at !== undefined && g.at.start <= at.end && g.at.end >= at.start)
  if (known !== undefined) known.at = { start: Math.min(known.at!.start, at.start), end: Math.max(known.at!.end, at.end) }
  else L.gaps.push({ gap: 'rtl-shaping-across-inline-boxes', run: firstBox.run, detail: 'RTL text shaped across inline boxes as one run: each run is a difference of Canvas totals of the joined text, where WebKit sums CoreText base advances per character', at })
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
function commitCandidateContent(b: Builder, candidate: Candidate, partial: PartialTrailingContent | null): void {
  const L = b.L
  const runs = candidate.content.runs
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
  if (partial !== null && candidate.content.hasShapedContent) shapePartialLineCandidate(L, candidate.content, partial.trailingRunIndex)
  const endOfNonPartialContent = partial !== null ? Math.min(partial.trailingRunIndex, runs.length) : runs.length
  for (let i = 0; i < endOfNonPartialContent; i++) appendRun(runs[i]!, i)
  if (partial === null) return
  const trailing = runs[partial.trailingRunIndex]!
  if (partial.partialRun !== null) {
    const item = trailing.item as WebKitTextItem
    appendText(L, b.line, leftPart(item, partial.partialRun.length), partial.partialRun.logicalWidth, shapingBoundaryStart !== null ? 'end' : null)
    if (item.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
    if (partial.partialRun.hyphenWidth !== null) addTrailingHyphen(b.line, partial.partialRun.hyphenWidth)
  } else {
    appendRun(trailing, partial.trailingRunIndex)
    if (partial.hyphenWidth !== null) addTrailingHyphen(b.line, partial.hyphenWidth)
  }
}

// LineBuilder::rebuildLineWithInlineContent (ILB:1813-1858)
function rebuildLineWithInlineContent(b: Builder, lastItem: ContentItem): number {
  b.L.reverted = true
  b.line = newLine(b.spanningInlineBoxes)
  if (b.partialLeadingTextItem !== null && b.partialLeadingTextItem === lastItem) {
    const candidate: Candidate = { content: newContent(), trailingLineBreak: null, trailingWordBreakOpportunity: null, hasTrailingSoftWrapOpportunity: false }
    appendTextContent(b.L, candidate.content, b.partialLeadingTextItem, measuredItemWidth(b.L, b.partialLeadingTextItem, 0))
    commitCandidateContent(b, candidate, null)
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
      commitCandidateContent(b, candidate, r.partialTrailingContent)
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
      const needsRevert = b.line.trimWidth !== 0 && lastRun !== undefined && lastRun.kind === 'inline-box-start'
      if (needsRevert && b.wrapOpportunityList.length > 1) {
        b.wrapOpportunityList.pop()
        return lineBuilderResult(true, rebuildLineWithInlineContent(b, b.wrapOpportunityList[b.wrapOpportunityList.length - 1]!), true)
      }
      b.L.shapedCarry = candidate.content.hasShapedContent
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
      const t = r.partialTrailingContent!
      commitCandidateContent(b, candidate, t)
      const committed = t.trailingRunIndex + 1
      if (t.partialRun === null) return lineBuilderResult(true, committed)
      const item = runs[t.trailingRunIndex]!.item as WebKitTextItem
      b.L.shapedCarry = candidate.content.hasShapedContent
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
    for (let i = end.index; i < b.rangeEnd; i++) if (isContentfulItem(L.p, L.p.items[i]!)) isLastInlineContent = false
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
  const p = L.p
  const last = line.runs[line.runs.length - 1]!
  const endsWithLineBreak = last.kind === 'soft-line-break' || last.kind === 'hard-line-break'
  if (isLastInlineContent || endsWithLineBreak || p.style.textAlign !== 'justify') return
  const hangingLength = line.hanging === null ? 0 : line.hanging.length
  const spaceToDistribute = f32(f32(L.lineWidth - line.contentLogicalWidth) + (hangingLength > 0 ? line.hanging!.width : 0))
  if (hangingLength > 0 && last.kind === 'text' && last.trailing !== 'not-applicable' && last.trailingLength !== last.textLength) {
    const leadingLength = last.textLength - last.trailingLength
    const detached: LineRun = {
      ...last, textStart: last.textStart + leadingLength, textLength: last.trailingLength, width: last.trailingWidth,
      left: f32(f32(last.left + last.width) - last.trailingWidth), trailing: 'not-applicable', trailingLength: 0, trailingWidth: 0,
      lastNonWhitespaceContentStart: null, expansionBehavior: { ...last.expansionBehavior },
    }
    last.width = f32(last.width - detached.width)
    last.textLength = leadingLength
    last.trailing = 'not-applicable'
    last.trailingLength = 0
    last.trailingWidth = 0
    line.runs.push(detached)
  }
  let lastTextRun = -1
  for (let i = 0; i < line.runs.length; i++) if (line.runs[i]!.kind === 'text') lastTextRun = i
  const expandable: ExpandableRun[] = []
  for (let i = 0; i < line.runs.length; i++) {
    const run = line.runs[i]!
    let text = ''
    if (run.kind === 'text') {
      const length = i === lastTextRun ? Math.max(0, run.textLength - hangingLength) : run.textLength
      text = p.boxes[run.box]!.text.slice(run.textStart, run.textStart + length)
    }
    expandable.push({ kind: run.kind, text, rtl: run.level % 2 === 1 && run.level <= 125, left: run.left, width: run.width, expansion: 0, expansionBehavior: run.expansionBehavior })
  }
  const additional = applyTextAlignJustify(expandable, spaceToDistribute)
  for (let i = 0; i < line.runs.length; i++) {
    const run = line.runs[i]!
    run.left = expandable[i]!.left
    run.width = expandable[i]!.width
    run.expansion = expandable[i]!.expansion
    run.expansionBehavior = expandable[i]!.expansionBehavior
  }
  line.contentLogicalWidth = f32(line.contentLogicalWidth + additional)
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

// ---- Output: display boxes and fragments from the closed Line::Run list ----

function sourceOffset(p: WebKitPrepared, position: Position): number {
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
      return elementSourceOffset(p, position.index)
  }
}

// Elements hold no source units: an element item sits at the source offset of the next text content after it.
function elementSourceOffset(p: WebKitPrepared, index: number): number {
  for (let i = index + 1; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.kind === 'text' || item.kind === 'soft-line-break') return p.boxes[item.box]!.sourceStart + item.start
  }
  return p.runStarts[p.runStarts.length - 1]!
}

function runAt(p: WebKitPrepared, offset: number): number {
  let run = 0
  while (run + 1 < p.runTexts.length && p.runStarts[run + 1]! <= offset) run++
  return run
}

// ubidi_reorderVisual (ICU 78.2 ubidiln.cpp:709-744, 812-867): L2 over one level per run; indexMap[visual] = logical.
function reorderVisual(levels: number[]): number[] {
  const indexMap: number[] = []
  let minLevel = 126
  let maxLevel = 0
  for (let i = 0; i < levels.length; i++) {
    indexMap.push(i)
    minLevel = Math.min(minLevel, levels[i]!)
    maxLevel = Math.max(maxLevel, levels[i]!)
  }
  if (minLevel === maxLevel && (minLevel & 1) === 0) return indexMap
  minLevel |= 1
  for (; maxLevel >= minLevel; maxLevel--) {
    let start = 0
    for (;;) {
      while (start < levels.length && levels[start]! < maxLevel) start++
      if (start >= levels.length) break
      let limit = start + 1
      while (limit < levels.length && levels[limit]! >= maxLevel) limit++
      for (let a = start, z = limit - 1; a < z; a++, z--) {
        const t = indexMap[a]!
        indexMap[a] = indexMap[z]!
        indexMap[z] = t
      }
      if (limit === levels.length) break
      start = limit + 1
    }
  }
  return indexMap
}

// computedVisualOrder (ILB:93-138): opaque runs are left out and the others reordered by level.
function visualOrder(runs: LineRun[]): number[] {
  const levels: number[] = []
  const offsets: number[] = []
  let accumulated = 0
  for (let i = 0; i < runs.length; i++) {
    const level = runs[i]!.level
    if (level === OPAQUE_BIDI_LEVEL) {
      accumulated++
      continue
    }
    if (level > 126) continue
    levels.push(level)
    offsets.push(accumulated)
  }
  const order = reorderVisual(levels)
  for (let i = 0; i < order.length; i++) order[i] = order[i]! + offsets[order[i]!]!
  return order
}

function textDisplayBox(p: WebKitPrepared, run: LineRun, x: number): WebKitDisplayBox {
  const box = p.boxes[run.box]!
  return {
    kind: run.kind === 'soft-line-break' ? 'soft-line-break' : 'text', run: box.run, start: run.textStart, end: run.textStart + run.textLength,
    level: run.level, isWordSeparator: run.isWordSeparator, x, width: run.kind === 'soft-line-break' ? 0 : run.width,
    hyphen: run.needsHyphen ? box.hyphen : null, expansion: run.expansion,
    expansionBehavior: { left: run.expansionBehavior.left, right: run.expansionBehavior.right }, shapedAcrossBoxes: run.shapingBoundary !== null,
  }
}

// InlineDisplayContentBuilder::build (IDCB:100-117) for a line with content. x is from the content box: m_displayLine's left
// (the line rect's left after floats and text-indent, mirrored in an RTL block, IDLB:124-129) plus the root inline box's
// left, the alignment offset (LBB:63).
// - Without bidi reordering (processNonBidiContent :504-645): a text box at root left + run left
//   (LineBox::logicalRectForTextRun, InlineLineBox.cpp:58-73); an inline box's border box from root left + run left +
//   max(0, margin start), as wide as the root inline box's right minus its left unless its end run is on the line, then to
//   the end run's right less the end margin (LBB:482-521); an atomic box at root left + run left + max(0, margin start), its
//   border box wide (LBB:474-481); a <br> at root left + run left, zero wide (LBB:465-473).
// - With reordering (processBidiContent :851-1088): boxes follow in visual order from the content's left edge, each at the
//   edge plus its word spacing margin, the edge advancing by f32(width + margin). An RTL line's edge is
//   f32(line box width - contentLogicalRightIncludingNegativeMargin) (IDLB:136-138): the alignment offset plus
//   Line::contentLogicalRight(), the last run's logical right (InlineLine.h:71). Spans, atomic inlines and <br> on such a
//   line take the display box tree walk of :1031-1070, which isn't ported.
function displayBoxes(L: Layout, line: Line, lineLeft: number, alignmentOffset: number, hasContentfulInFlowContent: boolean): WebKitDisplayBox[] {
  const p = L.p
  const runs = line.runs
  const out: WebKitDisplayBox[] = []
  const hanging = line.hanging === null ? 0 : line.hanging.width
  if (!line.hasNonDefaultBidiLevelRun) {
    // The root inline box: left at the alignment offset, width the content width less hanging content in LTR (LBB:51-63),
    // which the initial width of an inline box adds back (LBB:488-495).
    const contentLogicalWidth = p.style.rtl ? line.contentLogicalWidth : f32(line.contentLogicalWidth - hanging)
    const rootRight = f32(alignmentOffset + contentLogicalWidth)
    const openBoxes = new Map<number, number>()
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!
      switch (run.kind) {
        case 'text':
        case 'soft-line-break':
          out.push(textDisplayBox(p, run, f32(lineLeft + f32(alignmentOffset + run.left))))
          break
        case 'hard-line-break':
          out.push({ kind: 'line-break', element: run.element, x: f32(lineLeft + f32(alignmentOffset + run.left)), width: 0 })
          break
        case 'atomic': {
          const e = p.elements[run.element]!
          if (e.kind !== 'atomic') throw new Error(`element ${run.element} isn't atomic`)
          const left = f32(f32(alignmentOffset + run.left) + Math.max(0, e.marginStart))
          out.push({ kind: 'atomic', element: run.element, level: run.level === DEFAULT_BIDI_LEVEL || run.level === OPAQUE_BIDI_LEVEL ? (p.style.rtl ? 1 : 0) : run.level, x: f32(lineLeft + left), width: e.borderBoxWidth })
          break
        }
        case 'inline-box-start':
        case 'spanning-inline-box-start': {
          // Line-spanning boxes on a line whose content floats pushed away get no display box (IDCB:603-609).
          if (run.kind === 'spanning-inline-box-start' && !hasContentfulInFlowContent && L.constrainedByFloat) break
          const marginStart = run.kind === 'inline-box-start' ? spanEdges(p, run.element).marginStart : 0
          // Inline box runs are margin boxes: the border box starts past a positive margin, while a negative margin start
          // already moved the run left (IL:300-305) and stays in the box (LBB:482-487).
          const left = f32(f32(alignmentOffset + run.left) + Math.max(0, marginStart))
          let width = Math.max(0, f32(rootRight - left))
          if (!p.style.rtl) width = Math.max(0, f32(f32(rootRight + hanging) - left))
          openBoxes.set(run.element, out.length)
          out.push({ kind: 'inline-box', element: run.element, x: f32(lineLeft + left), width, hasStartEdge: run.kind === 'inline-box-start', hasEndEdge: false })
          break
        }
        case 'inline-box-end': {
          const index = openBoxes.get(run.element)
          if (index === undefined) break
          const boxOut = out[index]! as Extract<WebKitDisplayBox, { kind: 'inline-box' }>
          const marginEnd = spanEdges(p, run.element).marginEnd
          const right = f32(f32(alignmentOffset + run.left) + f32(run.width - marginEnd))
          boxOut.width = Math.max(0, f32(right - f32(boxOut.x - lineLeft)))
          boxOut.hasEndEdge = true
          break
        }
        case 'word-break-opportunity':
          break
      }
    }
    return out
  }
  return bidiDisplayBoxes(L, line, lineLeft, alignmentOffset, hasContentfulInFlowContent)
}

// InlineDisplayContentBuilder::processBidiContent (IDCB:851-1088) for a line that needs visual reordering.
// - A line without contentful in-flow content takes processNonBidiContent, and in an RTL block its inline boxes sit at the
//   line box's right edge (processBidiLinesWithNoContent, :826-849).
// - createDisplayBoxesInVisualOrder (:871-1028): runs in visual order, wbr and inline box ends skipped. Every run's container
//   gets a display box when first reached (ensureDisplayBoxForContainer, :713-721); an inline box start whose box has no
//   content on the line gets one at its own position (:971-998). Text runs sit at the running edge plus their word spacing
//   margin, the edge advancing by f32(width + margin); a line break at the edge; an atomic inline past its line-left margin,
//   the edge advancing by its margin box.
// - handleInlineBoxes (:1031-1070): with inline boxes, adjustVisualGeometryForDisplayBox walks the display box tree from the
//   same edge again and places everything, adding an inline box's line-left margin, border and padding on its first box in
//   LTR (last in RTL) and its line-right ones on its last box in LTR (first in RTL) (:728-824).
// - closeInlineBoxes (:1073-1087): trailing inline box starts at the opaque level get a zero-width box at the line's right.
// The model's spans inherit the block's direction.
function bidiDisplayBoxes(L: Layout, line: Line, lineLeft: number, alignmentOffset: number, hasContentfulInFlowContent: boolean): WebKitDisplayBox[] {
  const p = L.p
  const runs = line.runs
  const rtlBlock = p.style.rtl
  if (!hasContentfulInFlowContent) {
    const saved = line.hasNonDefaultBidiLevelRun
    line.hasNonDefaultBidiLevelRun = false
    const out = displayBoxes(L, line, lineLeft, alignmentOffset, hasContentfulInFlowContent)
    line.hasNonDefaultBidiLevelRun = saved
    if (rtlBlock) for (let i = 0; i < out.length; i++) if (out[i]!.kind === 'inline-box') out[i]!.x = f32(lineLeft + L.lineWidth)
    return out
  }
  const rootLevel = rtlBlock ? 1 : 0
  const contentLineLeftEdge = rtlBlock ? f32(L.lineWidth - f32(alignmentOffset + lastRunLogicalRight(line))) : alignmentOffset
  // Which spans have content on this line (InlineLineBoxBuilder.cpp:448-472: text, soft and hard line breaks set their parent
  // inline box's content), and which have their first and last box here.
  const hasContentOnLine = new Set<number>()
  const firstBox = new Set<number>()
  const lastBox = new Set<number>()
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if (run.kind === 'text' || run.kind === 'soft-line-break') hasContentOnLine.add(p.boxes[run.box]!.parent)
    else if (run.kind === 'hard-line-break') hasContentOnLine.add(p.elements[run.element]!.parent)
    else if (run.kind === 'inline-box-start') firstBox.add(run.element)
    else if (run.kind === 'inline-box-end') lastBox.add(run.element)
  }
  type Node = { box: number; element: number; children: number[] }
  const out: WebKitDisplayBox[] = []
  const nodes: Node[] = [{ box: -1, element: -1, children: [] }]
  // The ancestor stack: display box tree nodes of the containers from the root inward.
  const stack: { element: number; node: number }[] = [{ element: -1, node: 0 }]
  const ensureContainer = (element: number): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.element !== element) continue
      stack.length = k + 1
      return stack[k]!.node
    }
    const parentNode = ensureContainer(p.elements[element]!.parent)
    out.push({ kind: 'inline-box', element, x: 0, width: 0, hasStartEdge: firstBox.has(element), hasEndEdge: lastBox.has(element) })
    nodes.push({ box: out.length - 1, element, children: [] })
    nodes[parentNode]!.children.push(nodes.length - 1)
    stack.push({ element, node: nodes.length - 1 })
    return nodes.length - 1
  }
  const addLeaf = (parentNode: number, box: WebKitDisplayBox) => {
    out.push(box)
    nodes.push({ box: out.length - 1, element: -1, children: [] })
    nodes[parentNode]!.children.push(nodes.length - 1)
  }
  let edge = contentLineLeftEdge
  let hasInlineBox = false
  const order = visualOrder(runs)
  for (let k = 0; k < order.length; k++) {
    const run = runs[order[k]!]!
    if (run.kind === 'word-break-opportunity' || run.kind === 'inline-box-end') continue
    const parent = run.kind === 'text' || run.kind === 'soft-line-break' ? p.boxes[run.box]!.parent
      : run.kind === 'inline-box-start' || run.kind === 'spanning-inline-box-start' ? p.elements[run.element]!.parent : p.elements[run.element]!.parent
    const parentNode = ensureContainer(parent)
    hasInlineBox ||= parentNode !== 0 || run.kind === 'inline-box-start' || run.kind === 'spanning-inline-box-start'
    switch (run.kind) {
      case 'text': {
        const margin = run.isWordSeparator ? p.boxes[run.box]!.wordSpacing : 0
        addLeaf(parentNode, textDisplayBox(p, run, f32(lineLeft + f32(edge + margin))))
        edge = f32(edge + f32(run.width + margin))
        break
      }
      case 'soft-line-break':
        addLeaf(parentNode, textDisplayBox(p, run, f32(lineLeft + edge)))
        break
      case 'hard-line-break':
        addLeaf(parentNode, { kind: 'line-break', element: run.element, x: f32(lineLeft + edge), width: 0 })
        break
      case 'atomic': {
        const e = p.elements[run.element]!
        if (e.kind !== 'atomic') throw new Error(`element ${run.element} isn't atomic`)
        const marginLeft = rtlBlock ? e.marginEnd : e.marginStart
        const marginRight = rtlBlock ? e.marginStart : e.marginEnd
        addLeaf(parentNode, { kind: 'atomic', element: run.element, level: run.level, x: f32(lineLeft + f32(edge + marginLeft)), width: e.borderBoxWidth })
        edge = f32(f32(f32(edge + marginLeft) + e.borderBoxWidth) + marginRight)
        break
      }
      case 'inline-box-start':
      case 'spanning-inline-box-start':
        if (!hasContentOnLine.has(run.element)) {
          out.push({ kind: 'inline-box', element: run.element, x: 0, width: 0, hasStartEdge: firstBox.has(run.element), hasEndEdge: lastBox.has(run.element) })
          nodes.push({ box: out.length - 1, element: run.element, children: [] })
          nodes[parentNode]!.children.push(nodes.length - 1)
          stack.push({ element: run.element, node: nodes.length - 1 })
        }
        break
    }
  }
  if (hasInlineBox) {
    // adjustVisualGeometryForDisplayBox (:728-824).
    let right = contentLineLeftEdge
    const adjust = (index: number) => {
      const node = nodes[index]!
      const box = out[node.box]!
      if (box.kind !== 'inline-box') {
        if (box.kind === 'atomic') {
          const e = p.elements[box.element]!
          if (e.kind !== 'atomic') throw new Error(`element ${box.element} isn't atomic`)
          const marginLeft = rtlBlock ? e.marginEnd : e.marginStart
          box.x = f32(f32(lineLeft + right) + marginLeft)
          right = f32(right + e.marginBoxWidth)
          return
        }
        const margin = box.kind === 'text' && box.isWordSeparator ? p.boxes[boxOfRun(p, box.run)]!.wordSpacing : 0
        const width = box.width
        box.x = f32(lineLeft + f32(right + margin))
        right = f32(right + f32(width + margin))
        return
      }
      const e = spanEdges(p, node.element)
      const ltr = !rtlBlock
      const isFirst = box.hasStartEdge
      const isLast = box.hasEndEdge
      const marginLeft = ltr ? e.marginStart : e.marginEnd
      const borderPaddingLeft = ltr ? f32(e.borderStart + e.paddingStart) : f32(e.borderEnd + e.paddingEnd)
      const marginRight = ltr ? e.marginEnd : e.marginStart
      const borderPaddingRight = ltr ? f32(e.borderEnd + e.paddingEnd) : f32(e.borderStart + e.paddingStart)
      const applyLeft = (ltr && isFirst) || (!ltr && isLast)
      if (applyLeft) right = f32(right + marginLeft)
      const left = right
      if (applyLeft) right = f32(right + borderPaddingLeft)
      for (let c = 0; c < node.children.length; c++) adjust(node.children[c]!)
      const applyRight = (ltr && isLast) || (!ltr && isFirst)
      if (applyRight) right = f32(right + borderPaddingRight)
      box.x = f32(lineLeft + left)
      box.width = f32(right - left)
      if (applyRight) right = f32(right + marginRight)
    }
    for (let c = 0; c < nodes[0]!.children.length; c++) adjust(nodes[0]!.children[c]!)
  }
  // closeInlineBoxes (:1073-1087).
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.kind !== 'inline-box-start' || run.level !== OPAQUE_BIDI_LEVEL) break
    if (out.some(b => b.kind === 'inline-box' && b.element === run.element)) continue
    out.push({ kind: 'inline-box', element: run.element, x: f32(lineLeft + L.lineWidth), width: 0, hasStartEdge: firstBox.has(run.element), hasEndEdge: lastBox.has(run.element) })
  }
  void rootLevel
  return out
}

function boxOfRun(p: WebKitPrepared, run: number): number {
  for (let b = 0; b < p.boxes.length; b++) if (p.boxes[b]!.run === run) return b
  throw new Error(`run ${run} has no text box`)
}

// The line's fragments in logical order, from the closed run list. Units inside a text run are laid out: `hanging` for
// HangingContent's trailing white space, else `text`. A soft line break run is the `forced-break`. The unit trimming took
// out of its run is `trimmed`. Every other unit of [start, end) is in no run: white space that collapsed completely or
// into earlier white space, a text node without a renderer (`collapsed`). A run with needsHyphen is followed by the
// `hyphen`. Inline box start runs are `box-start` (spanning starts carry no edge), end runs `box-end`, and atomic, hard line
// break and word break opportunity runs their elements. Levels are the runs' levels after resetBidiLevelForTrailingWhitespace;
// UBIDI_DEFAULT_LTR is the root level.
function lineFragments(p: WebKitPrepared, line: Line, start: number, end: number): Fragment[] {
  const rootLevel = p.style.rtl ? 1 : 0
  const levelOf = (level: number) => level === DEFAULT_BIDI_LEVEL || level === OPAQUE_BIDI_LEVEL ? rootLevel : level
  // Collapsible white space is laid out as a space (a newline or TAB in normal is a space).
  const painted = (box: WebKitBox, from: number, to: number): string => {
    const text = box.text.slice(from, to)
    if (!collapsesWhiteSpace(box.style)) return text
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      out += c === 0x09 || c === 0x0a ? ' ' : text[i]!
    }
    return out
  }
  const runs = line.runs
  let lastTextRun = -1
  for (let i = 0; i < runs.length; i++) if (runs[i]!.kind === 'text') lastTextRun = i
  // Each piece with the source offset it sits at; elements sit before the text that follows them.
  const pieces: { at: number; fragment: Fragment }[] = []
  let cursor = start
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    switch (run.kind) {
      case 'text': {
        const box = p.boxes[run.box]!
        const from = run.textStart
        const to = run.textStart + run.textLength
        const hangFrom = i === lastTextRun && line.hanging !== null ? Math.max(from, to - line.hanging.length) : to
        const level = levelOf(run.level)
        if (hangFrom > from) pieces.push({ at: box.sourceStart + from, fragment: { kind: 'text', run: box.run, start: box.sourceStart + from, end: box.sourceStart + hangFrom, painted: painted(box, from, hangFrom), level } })
        if (to > hangFrom) pieces.push({ at: box.sourceStart + hangFrom, fragment: { kind: 'hanging', run: box.run, start: box.sourceStart + hangFrom, end: box.sourceStart + to, painted: painted(box, hangFrom, to), level } })
        if (run.needsHyphen) pieces.push({ at: box.sourceStart + to, fragment: { kind: 'hyphen', run: box.run, at: box.sourceStart + to, painted: box.hyphen, letterSpacing: box.cssLetterSpacing, level } })
        cursor = box.sourceStart + to
        break
      }
      case 'soft-line-break': {
        const box = p.boxes[run.box]!
        pieces.push({ at: box.sourceStart + run.textStart, fragment: { kind: 'forced-break', run: box.run, start: box.sourceStart + run.textStart, end: box.sourceStart + run.textStart + 1 } })
        cursor = box.sourceStart + run.textStart + 1
        break
      }
      case 'inline-box-start':
        pieces.push({ at: elementOffsetOnLine(p, run.element, 'open', cursor), fragment: { kind: 'box-start', element: run.element } })
        break
      case 'inline-box-end':
        pieces.push({ at: elementOffsetOnLine(p, run.element, 'close', cursor), fragment: { kind: 'box-end', element: run.element } })
        break
      case 'atomic':
        pieces.push({ at: elementOffsetOnLine(p, run.element, 'open', cursor), fragment: { kind: 'atomic', element: run.element, level: levelOf(run.level) } })
        break
      case 'hard-line-break':
        pieces.push({ at: elementOffsetOnLine(p, run.element, 'open', cursor), fragment: { kind: 'br', element: run.element } })
        break
      case 'word-break-opportunity':
        pieces.push({ at: elementOffsetOnLine(p, run.element, 'open', cursor), fragment: { kind: 'wbr', element: run.element } })
        break
      case 'spanning-inline-box-start':
        break
    }
  }
  if (line.trimmedUnit !== null) {
    const box = p.boxes[line.trimmedUnit.box]!
    const s = box.sourceStart + line.trimmedUnit.offset
    let index = pieces.length
    while (index > 0 && pieces[index - 1]!.at > s) index--
    pieces.splice(index, 0, { at: s, fragment: { kind: 'trimmed', run: box.run, start: s, end: s + 1, painted: ' ', level: levelOf(line.trimmedUnit.level) } })
  }
  const fragments: Fragment[] = []
  let covered = start
  const collapse = (to: number) => {
    while (covered < to) {
      const run = runAt(p, covered)
      const runEnd = Math.min(to, p.runStarts[run + 1]!)
      fragments.push({ kind: 'collapsed', run, start: covered, end: runEnd })
      covered = runEnd
    }
  }
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    const fragment = piece.fragment
    switch (fragment.kind) {
      case 'text':
      case 'hanging':
      case 'trimmed':
      case 'forced-break':
        collapse(fragment.start)
        fragments.push(fragment)
        covered = fragment.end
        break
      case 'hyphen':
        fragments.push(fragment)
        break
      case 'box-start':
      case 'box-end':
      case 'atomic':
      case 'br':
      case 'wbr':
        collapse(Math.min(piece.at, end))
        fragments.push(fragment)
        break
      case 'collapsed':
        break
    }
  }
  collapse(end)
  return fragments
}

// Where an element event sits in source offsets: the leaf start of the first text leaf at or after the event in document
// order, clamped to the line's cursor so fragments stay in logical order.
function elementOffsetOnLine(p: WebKitPrepared, element: number, event: 'open' | 'close', cursor: number): number {
  let index = -1
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if ('element' in item && item.element === element && (event === 'open' ? item.kind !== 'inline-box-end' : item.kind === 'inline-box-end')) {
      index = i
      break
    }
  }
  return Math.max(cursor, index < 0 ? cursor : elementSourceOffset(p, index))
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
function lineRect(p: WebKitPrepared, slot: LineSlot, indent: number, placesSlotFloats: boolean): { left: number; width: number; contentEdgeOffset: number; constrainedByFloat: boolean } {
  const containerWidth = layoutUnit(f32(f32(p.paragraph.width) * f32(p.zoom)))
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

// The used alignment of a line (horizontalAlignmentOffset's computedHorizontalAlignment, IFU:221-247), as the model reports it.
function usedAlignment(textAlign: TextAlign, isLastLineOrLineEndsWithForcedLineBreak: boolean): TextAlign {
  if (isLastLineOrLineEndsWithForcedLineBreak && textAlign === 'justify') return 'start'
  return textAlign
}

// InlineFormattingUtils::horizontalAlignmentOffset (IFU:198-276) with text-align-last: auto.
function horizontalAlignmentOffset(s: WebKitStyle, contentLogicalRightIn: number, lineLogicalWidth: number, hangingTrailingWidth: number, isLastLineOrLineEndsWithForcedLineBreak: boolean): number {
  let contentLogicalRight = contentLogicalRightIn
  if (hangingTrailingWidth) {
    if (isLastLineOrLineEndsWithForcedLineBreak) contentLogicalRight = Math.min(contentLogicalRight, lineLogicalWidth)
    else contentLogicalRight = f32(contentLogicalRight - hangingTrailingWidth)
  }
  const horizontalAvailableSpace = f32(lineLogicalWidth - contentLogicalRight)
  if (horizontalAvailableSpace <= 0) return 0
  const ltr = !s.rtl
  switch (usedAlignment(s.textAlign, isLastLineOrLineEndsWithForcedLineBreak)) {
    case 'left': return ltr ? 0 : horizontalAvailableSpace
    case 'start': return 0
    case 'right': return ltr ? horizontalAvailableSpace : 0
    case 'end': return horizontalAvailableSpace
    case 'center': return f32(horizontalAvailableSpace / 2)
    case 'justify': return 0
  }
}

// ---- The gaps a line's filling decides (DESIGN.md §2.8, §5) ----

// Every condition of the characters this line's filling measured: the items from the line start to the end of the last
// candidate content the builder formed, placed or not, so the content whose width ended the line counts. Each gap names the
// characters its condition concerns (`at`): one entry per gap, text leaf and stretch of concerned characters, since a gap
// covers a failure only where its range touches what differs (lab scorer 5). Ranges of one gap and leaf that touch are one
// entry.
function lineGaps(L: Layout, start: WebKitLineStart): void {
  const p = L.p
  const env = p.env
  const add = (gap: GapName, box: WebKitBox, from: number, to: number, detail: string): void => {
    const at = { start: box.sourceStart + from, end: box.sourceStart + to }
    for (let k = L.gaps.length - 1; k >= 0; k--) {
      const known = L.gaps[k]!
      if (known.gap !== gap || known.run !== box.run || known.at === undefined || at.start > known.at.end || at.end < known.at.start) continue
      known.at = { start: Math.min(known.at.start, at.start), end: Math.max(known.at.end, at.end) }
      return
    }
    L.gaps.push({ gap, run: box.run, detail, at })
  }
  const end = Math.min(L.measuredEnd, p.items.length)
  for (let index = start.itemIndex; index < end; index++) {
    const item = p.items[index]!
    if (item.kind !== 'text') continue
    const lineFrom = index === start.itemIndex ? item.start + start.offset : item.start
    if (lineFrom >= item.end) continue
    itemGaps(item, lineFrom, item.end, add)
    // rule webkit/gap/carried-width-conditions
    // A line that starts inside an item with a carried width lays out the whole item's width less what the lines before it
    // took (overflowWidthAsLeadingForNextLine, ALB:54-98; InlineTextItem::right, InlineTextItem.cpp:65-71), so what concerns
    // the whole item's measurement concerns the width of the rest (triage c-0033f34a9d6b3f85: `ty` after `affini` is
    // 9.439998626708984px natively, 9.44000244140625px from a whole that leaves out a pair adjustment; suite
    // c-790a15d5d04b7c3a: FF after `A` is 11.1171875px, the whole with `A` kerned as before a space, less `A` alone).
    if (index === start.itemIndex && start.offset > 0 && start.previousLine !== null && start.previousLine.carriedWidth !== null) {
      itemGaps(item, item.start, item.end, (gap, box, _from, _to, detail) => add(gap, box, lineFrom, item.end, `${detail}; in the whole item, which the carried width of the rest comes from`))
      if (start.previousLine.carriedFromShaping) add('rtl-shaping-across-inline-boxes', p.boxes[item.box]!, lineFrom, item.end, 'the carried width of the rest comes from a run shaped across inline boxes, a difference of Canvas totals of the joined text')
    }
  }

  function itemGaps(item: WebKitTextItem, from: number, to: number, add: (gap: GapName, box: WebKitBox, from: number, to: number, detail: string) => void): void {
    const box = p.boxes[item.box]!
    const style = box.style
    const text = box.text
    // A collapsible white space item, or a lone preserved space, measures one space alone (TextUtil.cpp:111-122).
    const singleSpace = item.isWhitespace && (!preservesSpacesAndTabs(style) || (to - from === 1 && text.charCodeAt(from) === 0x20))
    // The string TextUtil::width measures for the item: with the U+0020 that follows a text item (TextUtil.cpp:72-76).
    const measured = text.slice(from, measuredEnd(box, to, !item.isWhitespace))
    // VT, FF and CR (measure.ts, "VT, FF and CR"): the stand-in is the DOM's sum unless Canvas shows a pair adjustment around
    // the control, or text follows a CR in the measured string. The complex text controller gives VT and FF .notdef's advance
    // and CR none (ComplexTextController.cpp:773-782): its kerning around VT and FF wasn't probed, so they report there.
    let controlsExact: boolean | null = null
    for (let i = from; i < to; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x0b || c === 0x0c || (c === 0x0d && box.simpleFontCodePath)) {
        controlsExact ??= box.simpleFontCodePath && controlsMeasureExactly(L.m, box.spacedContext, measured)
        if (!controlsExact) add('control-character-width', box, i, i + 1, box.simpleFontCodePath
          ? 'Core Text kerns the letter before VT, FF or CR as before a space and keeps an adjustment on CR itself; Canvas shapes another string, so the width is pieced together outside the DOM\'s float32 order'
          : 'VT, FF and CR on the complex path are measured as U+0001 and U+0000, which Core Text shapes otherwise than the control')
      }
      // FontCascade::tabWidth counts stops from the primary font's spaceWidth() (FontCascadeInlines.h:76-94), taken from Canvas
      // W(' '), and letter spacing after a TAB follows WidthIterator; neither is probed (webkit audit E3).
      if (c === 0x09 && tabsAllowed(style)) add('tab-stops', box, i, i + 1, "tab stops count from Canvas W(' ') for the primary font's spaceWidth()")
      // Storage decides keep-all's punctuation breaks: after punctuation in 16-bit text only (BreakablePositions.h:257-274,
      // :292-299). Latin-1 text is assumed 8-bit (specs/webkit-gaps.md §7.5).
      if (box.is8Bit && style.wordBreak === 'keep-all' && isPunctuation(c) && i + 1 < text.length) add('string-storage', box, i, i + 1, 'keep-all breaks after punctuation in 16-bit text only; Latin-1 text assumed 8-bit')
    }
    // Letter spacing and ligatures (measure.ts mergedGlyphs): the gap sits where Canvas shows merged glyphs in the measured
    // string. On the simple path the string is measured with the merged pairs separated, which leaves what shaping does
    // across each pair with liga, clig, dlig and hlig off, a pair adjustment, unmeasured; on the complex path, or where
    // separating leaves glyphs merged, the string is measured as Canvas shapes it, and a merge the DOM keeps too (a
    // required ligature) can't be told from one it turns off.
    if (box.letterSpacing !== 0 && !singleSpace) {
      const merge = mergedGlyphs(L.m, box, measured)
      if (merge.separated !== null) {
        for (let k = 0; k < merge.pairs.length; k++) add('letter-spacing-ligatures', box, from + merge.pairs[k]![0], Math.min(to, from + merge.pairs[k]![1]), 'Canvas merges this pair under liga, clig, dlig or hlig, which the DOM turns off under letter-spacing; measured with U+200C between the two, which leaves out a pair adjustment between them')
      } else if (merge.merged) {
        add('letter-spacing-ligatures', box, from, to, merge.counted
          ? 'Canvas shows fewer spacing-bearing glyphs than characters here, and the DOM turns off liga, clig, dlig and hlig under letter-spacing; OffscreenCanvas keeps them'
          : "the string is too long to count its spacing-bearing glyphs exactly from two float32 totals, so Canvas can't show whether liga, clig, dlig or hlig, which the DOM turns off under letter-spacing, merged glyphs in it")
      }
    }
    // OffscreenCanvas has a null locale (specs/webkit-canvas.md §1.3): collectBoxFacts in content.ts. A control is measured as
    // another character (canvasString) and draws no font's glyph of its own.
    const localeChooses = box.localeChoosesFonts
    if (localeChooses !== null) {
      for (let i = from; i < to; i++) {
        const cp = text.codePointAt(i)!
        const length = cp > 0xffff ? 2 : 1
        if (cp > 0x1f && !(cp >= 0x7f && cp <= 0x9f)) {
          if ((localeChooses.unknownFamily || (localeChooses.namedGeneric && hasEmojiPresentation(cp))) && !familyDraws(L.m, box, box.namedContext, cp)) {
            add('canvas-language', box, i, i + length, localeChooses.unknownFamily
              ? `no named family before the one locale ${box.locale} resolves draws this character; OffscreenCanvas has no locale`
              : `a character with default emoji presentation that no family before the generic one draws: the DOM skips the generic family's outline glyph, and Canvas measures the family locale ${box.locale} resolves it to by name`)
          } else if (localeChooses.fallback && hasLanguageDependentFallback(cp, box.locale, localeScript(box.locale)) && !familyDraws(L.m, box, box.listContext, cp)) {
            add('canvas-language', box, i, i + length, `no family of the list draws this character, and locale ${box.locale} chooses its system fallback font; OffscreenCanvas has no locale`)
          }
        }
        i += length - 1
      }
    }
    if (box.hanLocaleUnknown) add('ui-language', box, from, to, "the Han locale becomes the first preferred language starting with zh-, and the preferred languages aren't given; laid out as zh-hans")
    if (box.quoteLocaleUnknown) {
      for (let i = from; i < to; i++) {
        if (isDelimiterQuote(text.charCodeAt(i))) add('ui-language', box, i, i + 1, `ICU has no delimiter data for ${box.locale}, so the quote overrides follow the WebContent process's default locale, which isn't given; laid out as en_US_POSIX`)
      }
    }
    if (box.fixedPitchFastMeasuring && box.unverifiedCoverage.length > 0) {
      for (let i = from; i < to; i++) {
        const cp = text.codePointAt(i)!
        const length = cp > 0xffff ? 2 : 1
        if (box.unverifiedCoverage.includes(cp)) add('font-fallback', box, i, i + length, "a code point measures as wide as LastResort's box, so the Canvas coverage test can't tell whether the primary font maps it, which decides the fixed-pitch width shortcut")
        i += length - 1
      }
    }
    // Test T1 of specs/webkit-gaps.md §2.5: where the width shortcut of a fixed-pitch primary font gives another width than
    // the advances, the monospace trait decides it, and so does whether the realized family is Courier New
    // (FontCoreText.cpp:776-782), which the first listed family stands in for.
    if (box.simplifiedMeasuring && !singleSpace && (box.monospaceUnknown || (box.fixedPitch && box.primaryFamilyUnknown))) {
      if (boxWidth(p, L.m, box, from, to, 0, !item.isWhitespace, false) !== fixedPitchShortcutWidth(p, L.m, box, from, to, !item.isWhitespace)) {
        add('fixed-pitch-path', box, from, to, box.monospaceUnknown
          ? `whether ${box.primaryFamily} has the monospace trait isn't given, and the width shortcut of a fixed-pitch font gives this item another width (test T1)`
          : "the primary family isn't given, and whether it is Courier New decides the width shortcut, which gives this item another width (test T1)")
      }
    }
    // rule webkit/gap/simplified-measuring-space-advance
    // The DOM's simplified path sums the shaped advances of the primary font's glyphs in one float32 loop
    // (FontCascade::widthForSimpleTextSlow, FontCascade.cpp:381-412). Canvas runs WidthIterator: the unshaped sum U, plus the
    // shaped sum S less U, after it puts every character treated as a space back to its unshaped advance
    // (applyFontTransforms, WidthIterator.cpp:84-120): the total is f32(U + f32(S - U)). Where U / 2 <= S <= 2 * U, S - U is
    // exact in float32 (Sterbenz) and the total is S. Rounding is monotonic and U / 2 and 2 * U are float32 numbers, so an S
    // below U / 2 gives a total of at most U / 2 and an S above 2 * U one of at least 2 * U: a total strictly between them
    // says S is in range, and the two paths agree to the bit unless shaping changed a space's own advance, which Canvas can't
    // show (probe webkit-round3 R1: 162 of 162 strings without a space, kerned and ligated ones included, measure the same in
    // the DOM and in Canvas).
    // - A U+0020 before the string's last unit is the first glyph of a pair, where CoreText puts a pair adjustment: a
    //   preserved run of spaces.
    // - The U+0020 a text item is measured with is the string's last glyph, a pair's second glyph. CoreText puts the pair
    //   adjustment of kern, kerx and first-glyph GPOS value records on the letter (probe webkit-round3 R2: 2,350 of 2,350
    //   pre boxes `x` U+0020 in 25 fonts, 47 of them with an adjustment, equal the Canvas recipe). A GPOS value record for
    //   the pair's second glyph would move the space itself, and FontFacts.pairKerning says the font has none.
    if (box.simplifiedMeasuring && !box.fixedPitchFastMeasuring && !singleSpace) {
      const space = measured.indexOf(' ')
      let moved = space >= 0 && (space < measured.length - 1 || box.pairKerningUnknown)
      if (!moved) {
        let unshaped = 0
        for (let i = 0; i < measured.length; i++) {
          const cp = measured.codePointAt(i)!
          unshaped = f32(unshaped + measureText(L.m, box.context, canvasString(String.fromCodePoint(cp))))
          if (cp > 0xffff) i++
        }
        const total = measureText(L.m, box.context, canvasString(measured))
        moved = total !== unshaped && !(total > unshaped / 2 && total < 2 * unshaped)
      }
      if (moved) add('simplified-measuring', box, from, to, "the DOM keeps a space's shaped advance on the simplified path, where Canvas puts it back to the unshaped one")
    }
    if (env.dictionaryBreaks.kind === 'unavailable' && hasDictionaryCharacter(lineRules(box.locale, style.lineBreakMode, p.icuDefaultLocale).rules, text, from, to)) {
      add('dictionary-breaks-unavailable', box, from, to, 'Thai, Lao, Khmer or Myanmar text gets no dictionary boundaries')
    }
    for (let k = 0; k < box.dictionaryRangesStartingWithMark.length; k++) {
      const [rangeStart, rangeEnd] = box.dictionaryRangesStartingWithMark[k]!
      if (rangeStart < to && rangeEnd > from) add('dictionary-breaks-stand-in', box, rangeStart, rangeEnd, 'a dictionary range starts with a combining mark, where the line engine resynchronizes from its dictionary and the word segmenter breaks after the mark')
    }
  }
}

// ---- Page history (content.ts, "Page history") ----
// rule webkit/gap/page-history-worlds

type WebKitLineResult = LineResultOf<WebKitLineStart, WebKitLineGeometry>

// Where a line of the paragraph and the same line in a history world differ, as a source range, or null where they agree in
// everything the observation port reads: the line's range, its line box and its display boxes.
function lineDifference(p: WebKitPrepared, own: WebKitLineResult, world: WebKitLineResult): { start: number; end: number } | null {
  if (own.kind !== 'line' || world.kind !== 'line') return own.kind === world.kind ? null : own.kind === 'line' ? { start: own.line.start, end: own.line.end } : { start: 0, end: 0 }
  const a = own.line
  const b = world.line
  let start = Infinity
  let end = -Infinity
  const mark = (from: number, to: number): void => {
    start = Math.min(start, from)
    end = Math.max(end, to)
  }
  // Another break: the text between the two breaks. What else differs on the line follows from the break.
  if (a.end !== b.end) return { start: Math.min(a.end, b.end), end: Math.max(a.end, b.end) }
  const ga = a.geometry
  const gb = b.geometry
  for (let k = 0; k < ga.boxes.length && k < gb.boxes.length; k++) {
    const x = ga.boxes[k]!
    const y = gb.boxes[k]!
    let same = x.kind === y.kind && x.x === y.x && x.width === y.width
    if (same && (x.kind === 'text' || x.kind === 'soft-line-break') && (y.kind === 'text' || y.kind === 'soft-line-break')) {
      same = x.run === y.run && x.start === y.start && x.end === y.end && x.level === y.level && x.hyphen === y.hyphen && x.expansion === y.expansion
    }
    if (same) continue
    if (x.kind === 'text' || x.kind === 'soft-line-break') mark(p.runStarts[x.run]! + x.start, p.runStarts[x.run]! + x.end)
    else mark(a.start, a.end)
  }
  // The line's own sums alone: no box says where.
  if (start === Infinity && (a.hasLineBox !== b.hasLineBox || ga.contentWidth !== gb.contentWidth || ga.hangingWidth !== gb.hangingWidth || ga.contentLogicalRight !== gb.contentLogicalRight || ga.alignmentOffset !== gb.alignmentOffset || ga.boxes.length !== gb.boxes.length)) mark(a.start, a.end)
  return start === Infinity ? null : { start, end }
}

// The line start in a history world that stands where `start` stands, or null where the world can't be at that start: the
// line begins inside an item with a width carried from the lines before it (overflowWidthAsLeadingForNextLine, ALB:54-98;
// InlineTextItem::right, InlineTextItem.cpp:65-71), and the world's item there isn't the own one, so its rest started from
// another whole (triage c-66ae4ab7d56cb0ae: line 6 keeps `ببب` at 16.27px, the rest of `بببب` alone, where the rest of
// `((بببب` is 26.02px); or the world has no item boundary at a line start between two of the own items.
function worldLineStart(p: WebKitPrepared, world: WebKitHistoryWorld, start: WebKitLineStart): WebKitLineStart | null {
  if (start.itemIndex >= p.items.length) return { ...start, itemIndex: world.prepared.items.length }
  const own = p.items[start.itemIndex]!
  let index = world.itemIndex[start.itemIndex]!
  if (own.kind !== 'text') return { ...start, itemIndex: index }
  const position = own.start + start.offset
  const items = world.prepared.items
  let first = items[index] as WebKitTextItem
  if (first.start > own.start) return null
  while (first.end <= position) {
    const following = items[index + 1]
    if (following === undefined || following.kind !== 'text' || following.box !== own.box || following.start !== first.end) return null
    first = following
    index++
  }
  if (start.offset === 0) return first.start === position ? { ...start, itemIndex: index } : null
  // A carried width is the whole item's less what the lines before took, so it stands in the world only where the world's
  // item is the own one (suite c-19ccdb6bbbc8089c: `ببب((` broken after its first letter carries 22.4px for `بب((`, where a
  // world that ends an item before `((` carries 10.416px for `بب`, which fits with nothing after it).
  if (start.previousLine !== null && start.previousLine.carriedWidth !== null) return first.start === own.start && first.end === own.end ? { ...start, itemIndex: index } : null
  if (first.start === own.start) return { ...start, itemIndex: index }
  return { ...start, itemIndex: index, offset: position - first.start }
}

const PAGE_HISTORY_DETAIL = "the break position cache keys a box by its text and wrapping styles, not by its paragraph's direction, neighbouring content, white-space or word spacing, so a box of the same text laid out earlier in the process can hand this box other item ends, and with them this line differs here"

function pageHistoryGaps(p: WebKitPrepared, start: WebKitLineStart, slot: LineSlot, m: Measurer, measuredEnd: number, result: WebKitLineResult): void {
  const gaps = result.kind === 'line' ? result.line.gaps : result.gaps
  const readEnd = Math.min(Math.max(measuredEnd, start.itemIndex + 1), p.items.length)
  for (let w = 0; w < p.historyWorlds.length; w++) {
    const world = p.historyWorlds[w]!
    let reads = false
    for (let i = start.itemIndex; i < readEnd && !reads; i++) reads = world.changed[i]!
    if (!reads) continue
    const worldStart = worldLineStart(p, world, start)
    let at: { start: number; end: number } | null
    if (worldStart === null) {
      const from = start.itemIndex === 0 && start.offset === 0 ? 0 : sourceOffset(p, { index: start.itemIndex, offset: start.offset })
      const own = p.items[start.itemIndex]!
      at = { start: from, end: own.kind === 'text' ? p.boxes[own.box]!.sourceStart + own.end : from }
    } else {
      at = lineDifference(p, result, buildLine(world.prepared, worldStart, slot, m).result)
    }
    if (at === null) continue
    const run = p.boxes[world.box]!.run
    let known = false
    for (let k = 0; k < gaps.length && !known; k++) {
      const gap = gaps[k]!
      if (gap.gap !== 'page-history' || gap.run !== run || gap.at === undefined) continue
      gap.at = { start: Math.min(gap.at.start, at.start), end: Math.max(gap.at.end, at.end) }
      known = true
    }
    if (!known) gaps.push({ gap: 'page-history', run, detail: PAGE_HISTORY_DETAIL, at })
  }
}

// One line (InlineFormattingContext::lineLayout), and page-history where a history world lays it out otherwise.
export function webkitNextLine(p: WebKitPrepared, start: WebKitLineStart, slot: LineSlot, m: Measurer): WebKitLineResult {
  const built = buildLine(p, start, slot, m)
  if (p.historyWorlds.length > 0) pageHistoryGaps(p, start, slot, m, built.measuredEnd, built.result)
  return built.result
}

// One line of InlineFormattingContext::lineLayout (InlineFormattingContext.cpp:293-360) with the builder the paragraph
// chose, then leadingInlineItemPositionForNextLine (IFU:278-298).
function buildLine(p: WebKitPrepared, start: WebKitLineStart, slot: LineSlot, m: Measurer): { result: WebKitLineResult; measuredEnd: number } {
  if (slot.left < 0 || slot.right < 0) throw new Error(`a line slot's insets are float widths and can't be negative (${slot.left}, ${slot.right})`)
  const hasFloats = start.hasFloats || slot.left > 0 || slot.right > 0
  // computedTextIndent (IFU:143-179): the first formatted line of a non-anonymous block, the fixed amount in px at zoom.
  const indent = start.isFirstFormattedLine ? f32(f32(p.style.textIndent) * f32(p.zoom)) : 0
  const builder = hasFloats ? 'line-builder' : p.builder
  // The simple builders take the initial line rect: no floats and no text-indent (TOS:136-162), since text-indent makes the
  // content ineligible for them.
  // The paragraph's first build places the slot floats; a refused first build hands its start on with hasFloats set.
  const placesSlotFloats = start.previousLine === null && !start.hasFloats
  const rect = lineRect(p, builder === 'line-builder' ? slot : { left: 0, right: 0 }, builder === 'line-builder' ? indent : 0, placesSlotFloats)
  const L: Layout = { p, m, lineWidth: rect.width, contentEdgeOffset: rect.contentEdgeOffset, constrainedByFloat: rect.constrainedByFloat, gaps: [], measuredEnd: start.itemIndex, reverted: false, decisionStart: start.itemIndex, overflowStart: null, shapedCarry: false }
  const items = p.items
  const itemsEnd: Position = { index: items.length, offset: 0 }
  const partialLeading = (index: number): WebKitTextItem | null => {
    if (start.previousLine === null || start.offset === 0) return null
    const item = items[index] as WebKitTextItem
    // InlineTextItem::right (InlineTextItem.cpp:65-71) keeps the carried width as the stored width.
    return { ...item, start: item.start + start.offset, width: start.previousLine.carriedWidth }
  }
  let b: Builder
  let lineContentEnd: Position
  let overflowLogicalWidth: number | null
  let isLastLineOrLineEndsWithForcedLineBreak: boolean
  switch (builder) {
    case 'text-only-simple':
    case 'range-based': {
      // RangeBasedLineBuilder (RangeBasedLineBuilder.cpp:70-124) runs the simple builder inside the span.
      const rangeBased = builder === 'range-based'
      const rangeStart = rangeBased && start.isFirstFormattedLine ? start.itemIndex + 1 : start.itemIndex
      const rangeEnd = rangeBased ? items.length - 1 : items.length
      b = { L, rangeStart, rangeEnd, partialLeadingTextItem: partialLeading(start.itemIndex), wrapOpportunityList: [], line: newLine([]), spanningInlineBoxes: [], isFirstFormattedLine: start.isFirstFormattedLine }
      const single = items[0]
      if (rangeBased && items.every(item => item.kind === 'inline-box-start' || item.kind === 'inline-box-end')) {
        // hasInlineBoxesOnly (RangeBasedLineBuilder.cpp:51-78): one line of the inline box runs, no content, eligible spans
        // have no decoration.
        for (let i = 0; i < items.length; i++) {
          const item = items[i] as InlineBoxItem
          b.line.runs.push(boxRun(item.kind, item.element, 0, 0, item.level))
        }
        lineContentEnd = itemsEnd
        overflowLogicalWidth = null
        isLastLineOrLineEndsWithForcedLineBreak = true
      } else if (!rangeBased && items.length === 1 && single !== undefined && single.kind === 'text' && single.end - single.start <= 1 && !single.isWhitespace) {
        // placeSingleCharacterContentIfApplicable (TOS:164-196): one line, the stored width, no fit test.
        L.measuredEnd = 1
        L.decisionStart = 0
        appendTextFast(L, b.line, single, single.width ?? 0)
        lineContentEnd = itemsEnd
        overflowLogicalWidth = null
        isLastLineOrLineEndsWithForcedLineBreak = true
      } else {
        const placed = p.style.wrap ? placeInlineTextContent(b) : placeNonWrappingInlineTextContent(b)
        lineContentEnd = rangeBased && placed.end.index === rangeEnd && placed.end.offset === 0 ? itemsEnd : placed.end
        overflowLogicalWidth = placed.overflowLogicalWidth
        if (rangeBased) {
          // insertLeadingInlineBoxRun and appendTrailingInlineBoxRunIfNeeded (RangeBasedLineBuilder.cpp:106-126): the span's
          // start run on the first formatted line, a spanning start on later ones, and its end run at the content width on
          // the line that places the last content.
          const leading = items[0] as InlineBoxItem
          b.line.runs.unshift(boxRun(start.isFirstFormattedLine ? 'inline-box-start' : 'spanning-inline-box-start', leading.element, 0, 0, start.isFirstFormattedLine ? leading.level : OPAQUE_BIDI_LEVEL))
          if (placed.end.index === rangeEnd && placed.end.offset === 0) {
            const trailing = items[items.length - 1] as InlineBoxItem
            b.line.runs.push(boxRun('inline-box-end', trailing.element, b.line.contentLogicalWidth, 0, trailing.level))
          }
        }
        // TOS:113-117: the placed content reaches the range end, or the line ends with a line break.
        const last = b.line.runs[b.line.runs.length - 1]
        isLastLineOrLineEndsWithForcedLineBreak = (placed.end.index === rangeEnd && placed.end.offset === 0) || (last !== undefined && (last.kind === 'soft-line-break' || last.kind === 'hard-line-break'))
      }
      break
    }
    case 'line-builder': {
      const spanning = lineSpanningInlineBoxes(p, start.itemIndex)
      b = { L, rangeStart: start.itemIndex, rangeEnd: items.length, partialLeadingTextItem: partialLeading(start.itemIndex), wrapOpportunityList: [], line: newLine(spanning), spanningInlineBoxes: spanning, isFirstFormattedLine: start.isFirstFormattedLine }
      const placed = placeInlineAndFloatContent(b, { index: start.itemIndex, offset: start.offset })
      lineContentEnd = placed.end
      overflowLogicalWidth = placed.overflowLogicalWidth
      // ILB:355-362: the last line with inline content, the end of the layout range, or a trailing forced line break.
      const last = b.line.runs[b.line.runs.length - 1]
      isLastLineOrLineEndsWithForcedLineBreak = placed.isLastInlineContent || (placed.end.index === items.length && placed.end.offset === 0) || (last !== undefined && (last.kind === 'soft-line-break' || last.kind === 'hard-line-break'))
      break
    }
  }
  const line = b.line
  lineGaps(L, start)
  // Floats kept every content from the line: the next line box moves below them (IFU:54-103, :286-289).
  const placedNothing = lineContentEnd.index === start.itemIndex && lineContentEnd.offset === start.offset
  if (placedNothing && L.constrainedByFloat && !(lineContentEnd.index === itemsEnd.index && lineContentEnd.offset === 0)) {
    // The refused build placed the slot floats, so the next build finds them in the formatting context.
    return { result: { kind: 'below-floats', gaps: L.gaps, next: { ...start, hasFloats: true } }, measuredEnd: L.measuredEnd }
  }
  let next: Position = lineContentEnd
  if (start.previousLine !== null) {
    const previousEnd = { index: start.itemIndex, offset: start.offset }
    const advanced = previousEnd.index < lineContentEnd.index || (previousEnd.index === lineContentEnd.index && previousEnd.offset < lineContentEnd.offset)
    if (!advanced && !(lineContentEnd.index === itemsEnd.index && lineContentEnd.offset === 0)) {
      next = { index: Math.min(lineContentEnd.index + 1, itemsEnd.index), offset: 0 }
    }
  }
  const isEnd = next.index === itemsEnd.index && next.offset === 0
  const lineStart = start.itemIndex === 0 && start.offset === 0 ? 0 : sourceOffset(p, { index: start.itemIndex, offset: start.offset })
  const lineEnd = isEnd ? p.runStarts[p.runStarts.length - 1]! : sourceOffset(p, next)
  const lastRun = line.runs[line.runs.length - 1]
  const hangingWidth = line.hanging === null ? 0 : line.hanging.width
  const contentLogicalRight = lastRunLogicalRight(line)
  const hasContentfulInFlowContent = lineHasVisuallyNonEmptyContent(p, line)
  const alignmentOffset = line.runs.length > 0 ? horizontalAlignmentOffset(p.style, contentLogicalRight, rect.width, hangingWidth, isLastLineOrLineEndsWithForcedLineBreak) : 0
  // The display line's left edge (IDLB:124-129): the line rect's left, mirrored across the container in an RTL block.
  const containerWidth = f32(layoutUnit(f32(f32(p.paragraph.width) * f32(p.zoom))))
  const lineLeft = p.style.rtl ? f32(containerWidth - f32(rect.left + rect.width)) : rect.left
  const result: WebKitLineResult = {
    kind: 'line',
    line: {
      start: lineStart,
      end: lineEnd,
      fragments: lineFragments(p, line, lineStart, lineEnd),
      // Line::close's isContentful (IL:87-110, 621-629): a run with content, or an inline box with decoration; undecorated
      // spans aren't contentful, so a line of collapsed white space and span edges has no line box (LineLayoutResult.h:94-105).
      hasLineBox: hasContentfulInFlowContent,
      joinsNextLine: false,
      slot,
      indented: start.isFirstFormattedLine && builder === 'line-builder',
      align: usedAlignment(p.style.textAlign, isLastLineOrLineEndsWithForcedLineBreak),
      geometry: {
        lineLeft: p.style.rtl ? f32(containerWidth - f32(rect.left + rect.width)) : f32(rect.left - indent),
        contentEdgeOffset: rect.contentEdgeOffset,
        lineBoxWidth: rect.width,
        contentWidth: line.contentLogicalWidth,
        hangingWidth,
        contentLogicalRight,
        alignmentOffset,
        boxes: displayBoxes(L, line, lineLeft, alignmentOffset, hasContentfulInFlowContent),
      },
      gaps: L.gaps,
      next: isEnd ? null : {
        engine: 'webkit', itemIndex: next.index, offset: next.offset,
        previousLine: { carriedWidth: overflowLogicalWidth, endsWithLineBreak: lastRun !== undefined && (lastRun.kind === 'soft-line-break' || lastRun.kind === 'hard-line-break'), carriedFromShaping: overflowLogicalWidth !== null && L.shapedCarry },
        isFirstFormattedLine: start.isFirstFormattedLine && !hasContentfulInFlowContent,
        hasFloats,
      },
    },
  }
  return { result, measuredEnd: L.measuredEnd }
}
