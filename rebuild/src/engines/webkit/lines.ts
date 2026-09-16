// WebKit line filling (Safari 27.0): Line bookkeeping, InlineContentBreaker with breakWord and the carried remainder, and
// the line builders, TextOnlySimpleLineBuilder (also run inside RangeBasedLineBuilder) and LineBuilder
// (specs/webkit-lines.md §1, §4-§9). Cited at WebKit-7625.1.29.11.27 under Source/WebCore/layout/formattingContexts/
// inline/: IL = InlineLine.cpp, ICB = InlineContentBreaker.cpp, TOS = TextOnlySimpleLineBuilder.cpp,
// ILB = InlineLineBuilder.cpp, IFU = InlineFormattingUtils.cpp, ALB = AbstractLineBuilder.cpp.
import type { Measurer } from '../../measure/canvas.js'
import type { Fragment, LineOf } from '../../model.js'
import { canBreakBefore, findNextBreakablePosition, makeFactory, mayBreakInBetween } from './breaks.js'
import { DEFAULT_BIDI_LEVEL } from './content.js'
import { boxWidth, breakWord, firstUserPerceivedCharacterLength, forwardOneCodePoint, hyphenWidth, itemWidth } from './measure.js'
import { isDefaultIgnorable } from './data.js'
import { preservesSpacesAndTabs, trailingWhitespaceHangs } from './style.js'
import type { WebKitItem, WebKitLineStart, WebKitPrepared, WebKitTextItem } from './types.js'

const f32 = Math.fround
const F32_MAX = 3.4028234663852886e38

type Layout = { p: WebKitPrepared; m: Measurer; lineWidth: number }
type SoftLineBreakItem = Extract<WebKitItem, { kind: 'soft-line-break' }>
type InlineBoxItem = Extract<WebKitItem, { kind: 'inline-box-start' | 'inline-box-end' }>
type ContentItem = WebKitTextItem | InlineBoxItem
type Position = { index: number; offset: number }

// ---- Line (IL, InlineLine.h) ----

type TrailingWhitespace = 'not-applicable' | 'not-collapsible' | 'collapsible' | 'collapsed'

type LineRun = {
  kind: 'text' | 'soft-line-break' | 'inline-box-start' | 'inline-box-end' | 'spanning-inline-box-start'
  isWordSeparator: boolean
  // The text box for text and soft line break runs, -1 for inline box runs.
  box: number
  left: number
  width: number
  level: number
  textStart: number
  textLength: number
  trailing: TrailingWhitespace
  trailingLength: number
  trailingWidth: number
  lastNonWhitespaceContentStart: number | null
}

// What the line holds in logical order, for fragments: every appended text item or piece of one, soft line breaks, and
// the hyphen.
type Piece =
  | { kind: 'text'; item: WebKitTextItem; width: number; collapsed: boolean; trimmed: boolean }
  | { kind: 'soft-line-break'; item: SoftLineBreakItem }
  | { kind: 'hyphen'; box: number; at: number; width: number; level: number }

type Line = {
  runs: LineRun[]
  contentLogicalWidth: number
  // TrimmableTrailingContent
  trimRunIndex: number | null
  trimHasFully: boolean
  trimOffset: number
  trimWidth: number
  trimPiece: number
  // HangingContent's trailing white space (IsConditional::WhenFollowedByForcedLineBreak).
  hanging: { length: number; width: number } | null
  trailingSoftHyphenWidth: number | null
  hasNonDefaultBidiLevelRun: boolean
  pieces: Piece[]
}

function newLine(spanningInlineBox: boolean): Line {
  const line: Line = {
    runs: [], contentLogicalWidth: 0, trimRunIndex: null, trimHasFully: false, trimOffset: 0, trimWidth: 0, trimPiece: -1,
    hanging: null, trailingSoftHyphenWidth: null, hasNonDefaultBidiLevelRun: false, pieces: [],
  }
  // Line::initialize (IL:48-78): a line starting inside a span begins with its spanning inline box start.
  if (spanningInlineBox) line.runs.push(boxRun('spanning-inline-box-start', 0, 255))
  return line
}

function boxRun(kind: LineRun['kind'], left: number, level: number): LineRun {
  return { kind, isWordSeparator: false, box: -1, left, width: 0, level, textStart: 0, textLength: 0, trailing: 'not-applicable', trailingLength: 0, trailingWidth: 0, lastNonWhitespaceContentStart: null }
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
  line.trimPiece = -1
}

// Line::Run::isContentful (InlineLine.h:129), and Line::hasContent.
function hasContent(line: Line): boolean {
  for (let i = line.runs.length - 1; i >= 0; i--) {
    const run = line.runs[i]!
    if ((run.kind === 'text' && run.textLength > 0) || run.kind === 'soft-line-break') return true
  }
  return false
}

function trailingWhitespaceType(p: WebKitPrepared, item: WebKitTextItem): TrailingWhitespace {
  if (!item.isWhitespace) return 'not-applicable'
  if (preservesSpacesAndTabs(p.style)) return 'not-collapsible'
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
    kind: 'text', isWordSeparator: item.isWordSeparator, box: item.box, left, width, level: item.level, textStart: item.start,
    textLength: length, trailing: type, trailingLength: type === 'not-applicable' ? 0 : length,
    trailingWidth: type === 'not-applicable' ? 0 : width, lastNonWhitespaceContentStart: null,
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

function updateTrailingContent(L: Layout, line: Line, item: WebKitTextItem, width: number, oldContentLogicalWidth: number, pieceIndex: number): void {
  line.trailingSoftHyphenWidth = null
  const isTrimmable = item.isWhitespace && !preservesSpacesAndTabs(L.p.style)
  if (isTrimmable) {
    // TrimmableTrailingContent::addFullyTrimmableContent (IL:723-732)
    const offset = f32(f32(line.contentLogicalWidth - oldContentLogicalWidth) - width)
    line.trimWidth = f32(offset + width)
    line.trimOffset = offset
    line.trimHasFully = true
    line.trimRunIndex ??= line.runs.length - 1
    line.trimPiece = pieceIndex
  } else {
    resetTrimmable(line)
  }
  line.hanging = !isTrimmable && item.isWhitespace && trailingWhitespaceHangs(L.p.style) ? { length: item.end - item.start, width } : null
  if (item.hasTrailingSoftHyphen) line.trailingSoftHyphenWidth = hyphenWidth(L.m, L.p.boxes[item.box]!)
}

// Line::appendText (IL:346-481), LineBuilder's variant.
function appendText(L: Layout, line: Line, item: WebKitTextItem, width: number): void {
  const p = L.p
  const box = p.boxes[item.box]!
  const preserve = preservesSpacesAndTabs(p.style)
  let willCollapseCompletely = false
  if (item.isWhitespace && !preserve) {
    willCollapseCompletely = true
    for (let i = line.runs.length - 1; i >= 0; i--) {
      const run = line.runs[i]!
      if (run.kind !== 'text') continue
      willCollapseCompletely = run.trailing === 'collapsible' || run.trailing === 'collapsed'
      break
    }
  }
  if (willCollapseCompletely) {
    line.pieces.push({ kind: 'text', item, width: 0, collapsed: true, trimmed: false })
    return
  }
  const last = line.runs[line.runs.length - 1]
  const needsNewRun = last === undefined || last.kind !== 'text' || last.box !== item.box || last.level !== item.level
    || last.trailing === 'collapsed'
    || (box.wordSpacing !== 0 && (item.isWordSeparator || (last.isWordSeparator && last.level !== DEFAULT_BIDI_LEVEL)))
    || isZeroWidthSpaceSeparator(p, item)
    || (p.style.rtl && preserve && item.isWhitespace !== (last.trailing !== 'not-applicable' && last.trailingLength === last.textLength))
  const oldContentLogicalWidth = line.contentLogicalWidth
  let contentLogicalRight: number
  if (needsNewRun) {
    const left = f32(lastRunLogicalRight(line) + (item.isWordSeparator ? box.wordSpacing : 0))
    line.runs.push(textRun(p, item, left, width))
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
  const pieceIndex = line.pieces.push({ kind: 'text', item, width, collapsed: false, trimmed: false }) - 1
  updateTrailingContent(L, line, item, width, oldContentLogicalWidth, pieceIndex)
}

// Line::appendTextFast (IL:483-556), the simple builder's variant.
function appendTextFast(L: Layout, line: Line, item: WebKitTextItem, width: number): void {
  const p = L.p
  const box = p.boxes[item.box]!
  const last = line.runs[line.runs.length - 1]
  const willCollapseCompletely = item.isWhitespace && !preservesSpacesAndTabs(p.style)
    && (last === undefined || last.trailing === 'collapsible' || last.trailing === 'collapsed')
  if (willCollapseCompletely) {
    line.pieces.push({ kind: 'text', item, width: 0, collapsed: true, trimmed: false })
    return
  }
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
  const pieceIndex = line.pieces.push({ kind: 'text', item, width, collapsed: false, trimmed: false }) - 1
  updateTrailingContent(L, line, item, width, oldContentLogicalWidth, pieceIndex)
}

// Line::appendInlineBoxStart and appendInlineBoxEnd (IL:289-344) for spans with no margin, border or padding.
function appendInlineBox(line: Line, item: InlineBoxItem): void {
  const left = lastRunLogicalRight(line)
  line.contentLogicalWidth = Math.max(line.contentLogicalWidth, left)
  line.runs.push(boxRun(item.kind, left, item.level))
}

// Line::appendLineBreak (IL:588-597)
function appendLineBreak(line: Line, item: SoftLineBreakItem): void {
  line.trailingSoftHyphenWidth = null
  const run = boxRun('soft-line-break', lastRunLogicalRight(line), item.level)
  run.box = item.box
  run.textStart = item.start
  line.runs.push(run)
  line.pieces.push({ kind: 'soft-line-break', item })
}

// Line::addTrailingHyphen (IL:609-619)
function addTrailingHyphen(L: Layout, line: Line, width: number): void {
  for (let i = line.runs.length - 1; i >= 0; i--) {
    const run = line.runs[i]!
    if (run.kind !== 'text') continue
    run.width = f32(run.width + width)
    line.contentLogicalWidth = f32(line.contentLogicalWidth + width)
    for (let k = line.pieces.length - 1; k >= 0; k--) {
      const piece = line.pieces[k]!
      if (piece.kind !== 'text' || piece.collapsed || piece.item.box !== run.box) continue
      line.pieces.push({ kind: 'hyphen', box: run.box, at: L.p.boxes[run.box]!.sourceStart + piece.item.end, width, level: piece.item.level })
      break
    }
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
    run.textLength -= 1
    run.trailing = 'not-applicable'
    run.trailingLength = 0
    run.trailingWidth = 0
    run.width = f32(run.width - whitespaceWidth)
    trimmed = f32(trimmed + whitespaceWidth)
  }
  for (let i = index + 1; i < line.runs.length; i++) line.runs[i]!.left = f32(line.runs[i]!.left - trimmed)
  if (run.textLength === 0) line.runs.splice(index, 1)
  const piece = line.pieces[line.trimPiece]
  if (piece !== undefined && piece.kind === 'text') piece.trimmed = true
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
    if (run.kind === 'soft-line-break' || (run.kind === 'text' && run.trailing === 'not-applicable')) break
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
    left: f32(f32(run.left + run.width) - run.trailingWidth), level: rootLevel, trailing: 'not-applicable', trailingLength: 0,
    trailingWidth: 0, lastNonWhitespaceContentStart: null,
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
  const endsWithForcedBreak = isLastFormattedLine || line.runs[line.runs.length - 1]?.kind === 'soft-line-break'
  if (endsWithForcedBreak && line.contentLogicalWidth <= lineWidth) line.hanging = null
}

// ---- ContinuousContent (ICB:917-1004, InlineContentBreaker.h:84-147) ----

type ContentRun = { item: ContentItem; offset: number; contentWidth: number }

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
}

function newContent(): Content {
  return { runs: [], logicalWidth: 0, leadingTrimmableWidth: 0, trailingTrimmableWidth: 0, hangingContentWidth: null, hasTextContent: false, isTextOnlyContent: true, isFullyTrimmable: false, hasTrailingWordSeparator: false, hasTrailingSoftHyphen: false }
}

function spaceRequired(run: ContentRun): number {
  return f32(run.offset + run.contentWidth)
}

function appendToRunList(c: Content, item: ContentItem, offset: number, width: number): void {
  c.runs.push({ item, offset, contentWidth: width })
  c.logicalWidth = f32(f32(c.logicalWidth + offset) + width)
}

function resetTrailingTrimmableContent(c: Content): void {
  if (!c.leadingTrimmableWidth) c.leadingTrimmableWidth = c.trailingTrimmableWidth
  c.trailingTrimmableWidth = 0
  c.isFullyTrimmable = false
}

function appendBoxContent(c: Content, item: InlineBoxItem): void {
  c.isTextOnlyContent = false
  appendToRunList(c, item, 0, 0)
}

// ContinuousContent::appendTextContent (ICB:950-988)
function appendTextContent(L: Layout, c: Content, item: WebKitTextItem, width: number): void {
  c.hasTextContent = true
  const isAfterWordSeparator = c.hasTrailingWordSeparator
  c.hasTrailingWordSeparator = item.isWordSeparator
  const hangs = item.isWhitespace && trailingWhitespaceHangs(L.p.style)
  if (hangs) c.hangingContentWidth = width
  const wordSpacing = L.p.boxes[item.box]!.wordSpacing
  // isFullyTrimmable, or isQuirkNonBreakingSpace, which needs -webkit-nbsp-mode: space.
  const trimmable = !hangs && item.isWhitespace && !preservesSpacesAndTabs(L.p.style)
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

function isWhitespaceOnlyContent(c: Content): boolean {
  let hasWhitespace = false
  for (let i = 0; i < c.runs.length; i++) {
    const item = c.runs[i]!.item
    if (item.kind !== 'text') continue
    if (!item.isWhitespace) return false
    hasWhitespace = true
  }
  return hasWhitespace
}

function isNonContentRunsOnly(c: Content): boolean {
  for (let i = 0; i < c.runs.length; i++) if (c.runs[i]!.item.kind === 'text') return false
  return true
}

type WordBreakRule = 'none' | 'arbitrary-within-words' | 'arbitrary'

// InlineContentBreaker::wordBreakBehavior (ICB:877-915) with hyphens: manual (no AtHyphenationOpportunities).
function wordBreakBehavior(L: Layout, hasWrapOpportunityAtPreviousPosition: boolean): WordBreakRule {
  const s = L.p.style
  if (s.lineBreak === 'anywhere') return 'arbitrary'
  if (s.wordBreak === 'break-all') return 'arbitrary-within-words'
  if (s.wordBreak === 'break-word' && !hasWrapOpportunityAtPreviousPosition) return 'arbitrary'
  if ((s.overflowWrap === 'break-word' || s.overflowWrap === 'anywhere') && !hasWrapOpportunityAtPreviousPosition) return 'arbitrary'
  return 'none'
}

// isBreakableRun (ICB:353-362): text whose parent allows wrapping.
function isBreakableRun(L: Layout, run: ContentRun): boolean {
  return run.item.kind === 'text' && L.p.style.wrap
}

// firstCharacterBreakRespectingLineStartProhibitions (ICB:139-158). U16_FWD_1 gets the item length as its limit while the
// index counts from the box start, as in the source.
function firstCharacterBreakRespectingLineStartProhibitions(L: Layout, item: WebKitTextItem, contentLogicalRight: number): PartialRun {
  const firstLength = firstUserPerceivedCharacterLength(L.p, item)
  const firstWidth = itemWidth(L.p, L.m, item, item.start, item.start + firstLength, contentLogicalRight)
  const box = L.p.boxes[item.box]!
  if (box.is8Bit) return { length: firstLength, logicalWidth: firstWidth, hyphenWidth: null }
  let breakPosition = firstLength
  let breakWidth = firstWidth
  while (item.start + breakPosition < item.end) {
    if (canBreakBefore(box.text.charCodeAt(item.start + breakPosition), L.p.style.lineBreak)) break
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
  const lineBreak = L.p.style.lineBreak
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
    const canBreakAtRunBoundary = next.isWhitespace ? L.p.style.collapse !== 'break-spaces' : canBreakBefore(textOf(L, next).charCodeAt(next.start), lineBreak)
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
  const lineBreak = L.p.style.lineBreak
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
  const lineBreak = L.p.style.lineBreak
  switch (wordBreakBehavior(L, st.hasWrapOpportunityAtPreviousPosition)) {
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

  if (c.hasTextContent) {
    const overflowing = processOverflowingContentWithText(L, c, st)
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
  }
  if (!st.hasContent) return result('keep', false)
  // shouldWrapUnbreakableContentToNextLine (:278-293): every box in the model shares the block's text-wrap-mode.
  if (L.p.style.wrap) return result('wrap', true)
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
  spanningInlineBox: boolean
  isFirstFormattedLine: boolean
}

type SimpleResult = { isEndOfLine: boolean; committedCount: number; overflowingContentLength: number; overflowLogicalWidth: number | null; isRevert: boolean }

function simpleResult(isEndOfLine: boolean, committedCount = 0, overflowingContentLength = 0, overflowLogicalWidth: number | null = null, isRevert = false): SimpleResult {
  return { isEndOfLine, committedCount, overflowingContentLength, overflowLogicalWidth, isRevert }
}

// TOS:481-486
function simpleAvailableWidth(b: Builder): number {
  return f32(f32(b.L.lineWidth + 1 / 64) - lastRunLogicalRight(b.line))
}

// measuredInlineTextItem (TOS:57-63) and InlineFormattingUtils::inlineItemWidth (IFU:300-309): collapsible white space is
// measured on its first character.
function measuredItemWidth(L: Layout, item: WebKitTextItem, left: number): number {
  if (item.width !== null) return item.width
  if (!item.isWhitespace || preservesSpacesAndTabs(L.p.style)) return itemWidth(L.p, L.m, item, item.start, item.end, left)
  return itemWidth(L.p, L.m, item, item.start, item.start + 1, left)
}

function revertToTrailingItem(b: Builder, target: ContentItem): number {
  b.line = newLine(false)
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
      if (h !== null) addTrailingHyphen(b.L, b.line, h)
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
      addTrailingHyphen(L, b.line, b.line.trailingSoftHyphenWidth!)
      return simpleResult(true)
    case 'break': {
      const t = r.partialTrailingContent!
      for (let i = 0; i < t.trailingRunIndex; i++) appendTextFast(L, b.line, c.runs[i]!.item as WebKitTextItem, c.runs[i]!.contentWidth)
      const committed = t.trailingRunIndex + 1
      const trailing = c.runs[t.trailingRunIndex]!
      const item = trailing.item as WebKitTextItem
      if (t.partialRun === null) {
        appendTextFast(L, b.line, item, trailing.contentWidth)
        if (t.hyphenWidth !== null) addTrailingHyphen(L, b.line, t.hyphenWidth)
        return simpleResult(true, committed)
      }
      appendTextFast(L, b.line, leftPart(item, t.partialRun.length), t.partialRun.logicalWidth)
      if (t.partialRun.hyphenWidth !== null) addTrailingHyphen(L, b.line, t.partialRun.hyphenWidth)
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
  if (index >= b.rangeEnd || item === undefined || item.kind !== 'soft-line-break') return false
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
    if (nextIndex >= b.rangeEnd || next === undefined || next.kind === 'soft-line-break') return true
    const nextText = next as WebKitTextItem
    if (nextText.isWhitespace) return hasWrapOpportunityBeforeWhitespace
    if (item.box === nextText.box) return true
    const prevBox = L.p.boxes[item.box]!
    const nextBox = L.p.boxes[nextText.box]!
    return mayBreakInBetween(prevBox.text, prevBox.is8Bit, nextBox.text, nextBox.is8Bit, nextBox.locale, style, L.p.env.dictionaryBreaks)
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
    if (isAtSoftWrapOpportunityOrContentEnd(b.partialLeadingTextItem)) isEndOfLine = process()
  }
  while (!isEndOfLine && nextIndex < b.rangeEnd) {
    const item = items[nextIndex++]!
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
    isEndOfLine = nextIndex >= b.rangeEnd || trailingLineBreakIndex !== null
  }
  if (trailingLineBreakIndex !== null && candidateEnd === b.rangeStart) {
    appendLineBreak(b.line, items[trailingLineBreakIndex] as SoftLineBreakItem)
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
  trailingLineBreak: SoftLineBreakItem | null
  hasTrailingSoftWrapOpportunity: boolean
}

type LineBuilderResult = { isEndOfLine: boolean; committedCount: number; isRevert: boolean; partialTrailingContentLength: number; overflowLogicalWidth: number | null }

function lineBuilderResult(isEndOfLine: boolean, committedCount = 0, isRevert = false, partialTrailingContentLength = 0, overflowLogicalWidth: number | null = null): LineBuilderResult {
  return { isEndOfLine, committedCount, isRevert, partialTrailingContentLength, overflowLogicalWidth }
}

function parentIsSpan(L: Layout, item: WebKitTextItem): boolean {
  return L.p.paragraph.runs[L.p.boxes[item.box]!.run]!.node === 'span'
}

// endsWithSoftWrapOpportunity (IFU:336-355)
function endsWithSoftWrapOpportunity(L: Layout, previous: WebKitTextItem, next: WebKitTextItem): boolean {
  if (previous.isWhitespace) return true
  const prevBox = L.p.boxes[previous.box]!
  if (previous.box === next.box) {
    if (previous.level === next.level) return true
    const f = makeFactory(prevBox.text, prevBox.is8Bit, prevBox.locale, L.p.style.lineBreakMode, L.p.env.dictionaryBreaks)
    return findNextBreakablePosition(f, next.start, L.p.style) === next.start
  }
  const nextBox = L.p.boxes[next.box]!
  return mayBreakInBetween(prevBox.text, prevBox.is8Bit, nextBox.text, nextBox.is8Bit, nextBox.locale, L.p.style, L.p.env.dictionaryBreaks)
}

// InlineFormattingUtils::isAtSoftWrapOpportunity (IFU:385-454) for two text items. Every box in the model wraps as the
// block does, so the nearest common ancestor's text-wrap-mode is the block's.
function isAtSoftWrapOpportunity(L: Layout, previous: WebKitTextItem, next: WebKitTextItem): boolean {
  const s = L.p.style
  const sameParent = previous.box === next.box || (!parentIsSpan(L, previous) && !parentIsSpan(L, next))
  if (sameParent && !s.wrap) return false
  if (previous.isWhitespace || next.isWhitespace) {
    if (previous.isWhitespace) return s.wrap
    if (!s.wrap) return false
    return s.collapse !== 'break-spaces'
  }
  if (s.lineBreak === 'anywhere') return true
  if (sameParent && !s.wrap) return false
  if (!endsWithSoftWrapOpportunity(L, previous, next)) return false
  return s.wrap
}

// InlineFormattingUtils::nextWrapOpportunity (IFU:456-544)
function nextWrapOpportunity(b: Builder, startIndex: number): number {
  const items = b.L.p.items
  let previousIndex: number | null = null
  for (let index = startIndex; index < b.rangeEnd; index++) {
    const item = items[index]!
    if (item.kind === 'soft-line-break') {
      for (index++; index < b.rangeEnd && items[index]!.kind === 'inline-box-end'; index++) {}
      return index
    }
    if (item.kind !== 'text') continue
    if (previousIndex === null) {
      previousIndex = index
      continue
    }
    if (isAtSoftWrapOpportunity(b.L, items[previousIndex] as WebKitTextItem, item)) {
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
    case 'soft-line-break':
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

// LineBuilder::candidateContentForLine (ILB:1030-1170). Shaping across inline boxes (:780-1028) isn't ported; the
// paragraph reports rtl-shaping-across-inline-boxes.
function candidateContentForLine(b: Builder, startIndex: number, endIndex: number, currentLogicalRight: number): Candidate {
  const L = b.L
  const items = L.p.items
  const candidate: Candidate = { content: newContent(), trailingLineBreak: null, hasTrailingSoftWrapOpportunity: false }
  let right = currentLogicalRight
  let index = startIndex
  if (index === b.rangeStart && b.partialLeadingTextItem !== null) {
    const w = measuredItemWidth(L, b.partialLeadingTextItem, right)
    appendTextContent(L, candidate.content, b.partialLeadingTextItem, w)
    right = f32(right + w)
    index++
  }
  let trailingSoftHyphenIndex: number | null = null
  for (; index < endIndex; index++) {
    const item = items[index]!
    switch (item.kind) {
      case 'text': {
        const w = measuredItemWidth(L, item, right)
        appendTextContent(L, candidate.content, item, w)
        right = f32(right + f32(w + (item.isWordSeparator ? L.p.boxes[item.box]!.wordSpacing : 0)))
        trailingSoftHyphenIndex = item.hasTrailingSoftHyphen ? index : null
        break
      }
      case 'inline-box-start':
      case 'inline-box-end':
        appendBoxContent(candidate.content, item)
        break
      case 'soft-line-break':
        candidate.trailingLineBreak = item
        break
    }
  }
  // setTrailingSoftHyphenWidth (:1154-1165): the hyphen counts in the fit test when only text follows the soft hyphen.
  if (trailingSoftHyphenIndex !== null) {
    let onlyText = true
    for (let k = trailingSoftHyphenIndex; k < endIndex; k++) if (items[k]!.kind !== 'text') onlyText = false
    if (onlyText) {
      const shy = items[trailingSoftHyphenIndex] as WebKitTextItem
      candidate.content.logicalWidth = f32(candidate.content.logicalWidth + hyphenWidth(L.m, L.p.boxes[shy.box]!))
      candidate.content.hasTrailingSoftHyphen = true
    }
  }
  candidate.hasTrailingSoftWrapOpportunity = hasTrailingSoftWrapOpportunity(b, endIndex)
  return candidate
}

// LineBuilder::commitCandidateContent (ILB:1610-1724)
function commitCandidateContent(b: Builder, candidate: Candidate, partial: PartialTrailingContent | null): void {
  const L = b.L
  const runs = candidate.content.runs
  if (runs.length === 0) return
  const appendRun = (run: ContentRun) => {
    if (run.item.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
    switch (run.item.kind) {
      case 'text': appendText(L, b.line, run.item, run.contentWidth); break
      case 'inline-box-start':
      case 'inline-box-end': appendInlineBox(b.line, run.item); break
    }
  }
  const endOfNonPartialContent = partial !== null ? Math.min(partial.trailingRunIndex, runs.length) : runs.length
  for (let i = 0; i < endOfNonPartialContent; i++) appendRun(runs[i]!)
  if (partial === null) return
  const trailing = runs[partial.trailingRunIndex]!
  if (partial.partialRun !== null) {
    const item = trailing.item as WebKitTextItem
    appendText(L, b.line, leftPart(item, partial.partialRun.length), partial.partialRun.logicalWidth)
    if (item.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
    if (partial.partialRun.hyphenWidth !== null) addTrailingHyphen(L, b.line, partial.partialRun.hyphenWidth)
  } else {
    appendRun(trailing)
    if (partial.hyphenWidth !== null) addTrailingHyphen(L, b.line, partial.hyphenWidth)
  }
}

// LineBuilder::rebuildLineWithInlineContent (ILB:1813-1858)
function rebuildLineWithInlineContent(b: Builder, lastItem: ContentItem): number {
  b.line = newLine(b.spanningInlineBox)
  if (b.partialLeadingTextItem !== null && b.partialLeadingTextItem === lastItem) {
    const candidate: Candidate = { content: newContent(), trailingLineBreak: null, hasTrailingSoftWrapOpportunity: false }
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
      if (h !== null) addTrailingHyphen(b.L, b.line, h)
      return count
    }
  }
  const count = rebuildLineWithInlineContent(b, list[0]!)
  if (b.line.trailingSoftHyphenWidth !== null) addTrailingHyphen(b.L, b.line, b.line.trailingSoftHyphenWidth)
  return count
}

// LineBuilder::processLineBreakingResult (ILB:1726-1811)
function processLineBreakingResult(b: Builder, candidate: Candidate, r: BreakResult): LineBuilderResult {
  const runs = candidate.content.runs
  switch (r.action) {
    case 'keep':
      commitCandidateContent(b, candidate, r.partialTrailingContent)
      if (candidate.hasTrailingSoftWrapOpportunity && hasContent(b.line) && b.L.p.style.wrap) b.wrapOpportunityList.push(runs[runs.length - 1]!.item)
      return lineBuilderResult(r.isEndOfLine, runs.length)
    case 'wrap': {
      const lastRun = b.line.runs[b.line.runs.length - 1]
      const needsRevert = b.line.trimWidth !== 0 && lastRun !== undefined && lastRun.kind === 'inline-box-start'
      if (needsRevert && b.wrapOpportunityList.length > 1) {
        b.wrapOpportunityList.pop()
        return lineBuilderResult(true, rebuildLineWithInlineContent(b, b.wrapOpportunityList[b.wrapOpportunityList.length - 1]!), true)
      }
      return lineBuilderResult(true, 0, false, 0, overflowWidthAsLeadingForNextLine(runs, r))
    }
    case 'wrap-with-hyphen':
      addTrailingHyphen(b.L, b.line, b.line.trailingSoftHyphenWidth!)
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
      return lineBuilderResult(true, committed, false, item.end - item.start - t.partialRun.length, overflowWidthAsLeadingForNextLine(runs, r))
    }
  }
}

// LineBuilder::handleInlineContent (ILB:1432-1481) with no floats, ruby or cloned decorations.
function handleInlineContent(b: Builder, candidate: Candidate): LineBuilderResult {
  const c = candidate.content
  if (c.runs.length === 0) return lineBuilderResult(candidate.trailingLineBreak !== null)
  // availableWidth (ILB:1172-1183)
  let available = f32(f32(b.L.lineWidth + 1 / 64) - lastRunLogicalRight(b.line))
  if (Number.isNaN(available)) available = F32_MAX
  let r = result('keep', false)
  if (c.logicalWidth > available) r = processInlineContent(b.L, c, lineStatus(b.line, available, hasContent(b.line), b.wrapOpportunityList.length > 0))
  return processLineBreakingResult(b, candidate, r)
}

// isContentfulOrHasDecoration (ILB:64-78) for text and soft line breaks; spans have no decoration.
function isContentfulItem(p: WebKitPrepared, item: WebKitItem): boolean {
  switch (item.kind) {
    case 'text':
      return !((item.isWhitespace && !preservesSpacesAndTabs(p.style)) || item.isWordSeparator || isZeroWidthSpaceSeparator(p, item))
    case 'soft-line-break':
      return true
    case 'inline-box-start':
    case 'inline-box-end':
      return false
  }
}

// placeInlineAndFloatContent (ILB:499-710)
function placeInlineAndFloatContent(b: Builder, start: Position): { end: Position; overflowLogicalWidth: number | null } {
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
      if (candidate.content.runs.length === r.committedCount && !r.partialTrailingContentLength && candidate.trailingLineBreak !== null) {
        appendLineBreak(b.line, candidate.trailingLineBreak)
        if (candidate.trailingLineBreak.level !== DEFAULT_BIDI_LEVEL) b.line.hasNonDefaultBidiLevelRun = true
        placed++
        isEndOfLine = true
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
    isLastInlineContent = (start.index === 0 && start.offset === 0) || hasContent(b.line)
  } else {
    isLastInlineContent = true
    for (let i = end.index; i < b.rangeEnd; i++) if (isContentfulItem(L.p, L.p.items[i]!)) isLastInlineContent = false
  }
  handleTrailingTrimmableContent(L, b.line)
  handleTrailingHangingContent(b.line, L.lineWidth, isLastInlineContent)
  resetBidiLevelForTrailingWhitespace(L, b.line)
  return { end, overflowLogicalWidth }
}

// ---- Output ----

function sourceOffset(p: WebKitPrepared, position: Position): number {
  const item = p.items[position.index]
  if (item === undefined) return p.runStarts[p.runStarts.length - 1]!
  switch (item.kind) {
    case 'text': return p.boxes[item.box]!.sourceStart + item.start + position.offset
    case 'soft-line-break': return p.boxes[item.box]!.sourceStart + item.start
    case 'inline-box-start': return p.runStarts[item.run]!
    case 'inline-box-end': return p.runStarts[item.run + 1]!
  }
}

function runAt(p: WebKitPrepared, offset: number): number {
  let run = 0
  while (run + 1 < p.paragraph.runs.length && p.runStarts[run + 1]! <= offset) run++
  return run
}

// Fragments in logical order. Levels are the items' levels, with trailing white space at the root level where its parity
// differs, as Line::resetBidiLevelForTrailingWhitespace does (IL:243-287, specs/bidi.md §6).
function buildFragments(p: WebKitPrepared, line: Line, start: number, end: number): Fragment[] {
  const rootLevel = p.style.rtl ? 1 : 0
  const levels: number[] = []
  const hangs: boolean[] = []
  for (let i = 0; i < line.pieces.length; i++) {
    const piece = line.pieces[i]!
    levels.push(piece.kind === 'hyphen' ? piece.level : piece.item.level === DEFAULT_BIDI_LEVEL ? rootLevel : piece.item.level)
    hangs.push(false)
  }
  // resetBidiLevelForTrailingWhitespace stops at a line break.
  for (let i = line.pieces.length - 1; i >= 0; i--) {
    const piece = line.pieces[i]!
    if (piece.kind !== 'text' || !piece.item.isWhitespace) break
    if (line.hasNonDefaultBidiLevelRun && (levels[i]! & 1) !== (rootLevel & 1)) levels[i] = rootLevel
  }
  // pre-wrap white space before the line end or a forced break hangs (specs/webkit-lines.md §9.1).
  for (let i = line.pieces.length - 1; trailingWhitespaceHangs(p.style) && i >= 0; i--) {
    const piece = line.pieces[i]!
    if (piece.kind === 'soft-line-break') continue
    if (piece.kind !== 'text' || !piece.item.isWhitespace) break
    hangs[i] = true
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
  for (let i = 0; i < line.pieces.length; i++) {
    const piece = line.pieces[i]!
    const level = levels[i]!
    switch (piece.kind) {
      case 'hyphen':
        fragments.push({ kind: 'hyphen', run: p.boxes[piece.box]!.run, at: piece.at, painted: '‐', letterSpacing: p.boxes[piece.box]!.letterSpacing, width: piece.width, level })
        break
      case 'soft-line-break': {
        const box = p.boxes[piece.item.box]!
        const s = box.sourceStart + piece.item.start
        collapse(s)
        fragments.push({ kind: 'forced-break', run: box.run, start: s, end: s + 1 })
        covered = s + 1
        break
      }
      case 'text': {
        const box = p.boxes[piece.item.box]!
        const s = box.sourceStart + piece.item.start
        const e = box.sourceStart + piece.item.end
        collapse(s)
        const painted = box.text.slice(piece.item.start, piece.item.end)
        if (piece.collapsed) {
          fragments.push({ kind: 'collapsed', run: box.run, start: s, end: e })
        } else if (!piece.item.isWhitespace || preservesSpacesAndTabs(p.style)) {
          if (hangs[i]) fragments.push({ kind: 'hanging', run: box.run, start: s, end: e, painted, width: piece.width, level })
          else fragments.push({ kind: 'text', run: box.run, start: s, end: e, painted, width: piece.width, level })
        } else {
          if (piece.trimmed) fragments.push({ kind: 'trimmed', run: box.run, start: s, end: s + 1, painted: ' ', level })
          else fragments.push({ kind: 'text', run: box.run, start: s, end: s + 1, painted: ' ', width: piece.width, level })
          if (e > s + 1) fragments.push({ kind: 'collapsed', run: box.run, start: s + 1, end: e })
        }
        covered = e
        break
      }
    }
  }
  collapse(end)
  return fragments
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
    if (level === 255) {
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

// The painted extent of a line: the display boxes InlineDisplayContentBuilder gives its text runs, over the content the
// lab observes (DESIGN.md §2.1).
// - Without bidi reordering a box sits at the run's logical left (LineBox::logicalRectForTextRun, InlineLineBox.cpp:58-72;
//   buildTextOnlyContent, InlineDisplayContentBuilder.cpp:119-144), with content logical left 0 for text-align start.
// - With reordering boxes follow in visual order from the content's left edge, each at the edge plus its word spacing
//   margin, the edge advancing by f32(width + margin) (processBidiContent :851-1088, adjustVisualGeometryForDisplayBox
//   :728-826). An RTL line's content starts at f32(line width − content logical right) (InlineDisplayLineBuilder.cpp:133-137).
// - A box keeps its run's width after trimming, not the content width: f32(f32(w + space) − space) can differ from
//   f32(w) by a float32 step. A negative width draws the box to the left of its x.
// - Hanging and trailing SPACE or TAB under normal, nowrap, pre-line and pre-wrap, and default-ignorable code points at
//   the line end, aren't in the extent (lab/README.md "Visible code points").
function paintedExtent(L: Layout, line: Line): number {
  const p = L.p
  const runs = line.runs
  const lefts: number[] = new Array(runs.length).fill(0)
  if (!line.hasNonDefaultBidiLevelRun) {
    for (let i = 0; i < runs.length; i++) lefts[i] = runs[i]!.left
  } else {
    let edge = p.style.rtl ? f32(L.lineWidth - lastRunLogicalRight(line)) : 0
    const order = visualOrder(runs)
    for (let k = 0; k < order.length; k++) {
      const run = runs[order[k]!]!
      if (run.kind !== 'text') continue
      const margin = run.isWordSeparator ? p.boxes[run.box]!.wordSpacing : 0
      lefts[order[k]!] = f32(edge + margin)
      edge = f32(edge + f32(run.width + margin))
    }
  }
  // The line's trailing run: SPACE and TAB under normal, nowrap, pre-line and pre-wrap, and default-ignorable code points,
  // back to the last code point that isn't one. Runs made only of it paint nothing; a run ending in it loses its tracked
  // trailing white space width.
  const excludeTrailingSpaces = p.style.collapse !== 'break-spaces' && !(p.style.collapse === 'preserve' && !p.style.wrap)
  // A hyphen ends the line at its soft hyphen and is painted with the last text run (Line::addTrailingHyphen).
  let hyphen = false
  for (let i = 0; i < line.pieces.length; i++) hyphen ||= line.pieces[i]!.kind === 'hyphen'
  let visibleEnd = runs.length
  let trailingCut = 0
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.kind !== 'text') continue
    if (hyphen) {
      visibleEnd = i + 1
      break
    }
    const text = p.boxes[run.box]!.text
    let k = run.textStart + run.textLength
    while (k > run.textStart) {
      const c = text.charCodeAt(k - 1)
      const cp = (c & 0xfc00) === 0xdc00 && k - 2 >= run.textStart ? text.codePointAt(k - 2)! : c
      if (!((excludeTrailingSpaces && (c === 0x20 || c === 0x09)) || isDefaultIgnorable(cp))) break
      k -= cp > 0xffff ? 2 : 1
    }
    if (k === run.textStart) {
      visibleEnd = i
      continue
    }
    if (excludeTrailingSpaces && run.trailing !== 'not-applicable') trailingCut = run.trailingWidth
    visibleEnd = i + 1
    break
  }
  let left = Infinity
  let right = -Infinity
  for (let i = 0; i < visibleEnd; i++) {
    const run = runs[i]!
    if (run.kind !== 'text') continue
    let x = lefts[i]!
    let w = run.width
    if (i === visibleEnd - 1 && trailingCut !== 0) {
      if (run.level !== DEFAULT_BIDI_LEVEL && (run.level & 1) === 1) x = f32(x + trailingCut)
      w = f32(w - trailingCut)
    }
    const end = f32(x + w)
    left = Math.min(left, x, end)
    right = Math.max(right, x, end)
  }
  return left === Infinity ? 0 : f32(right - left)
}

// One line of InlineFormattingContext::lineLayout (InlineFormattingContext.cpp:293-360) with the builder the paragraph
// chose, then leadingInlineItemPositionForNextLine (IFU:278-298).
export function webkitNextLine(p: WebKitPrepared, start: WebKitLineStart, width: number, m: Measurer): LineOf<WebKitLineStart> {
  // The content box width truncates to a LayoutUnit (StylePrimitiveData.h:341-360); a line is that many 64ths.
  const layoutUnits = Math.trunc(f32(f32(width) * f32(p.env.pageZoom)) * 64)
  const L: Layout = { p, m, lineWidth: f32(layoutUnits / 64) }
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
  switch (p.builder) {
    case 'text-only-simple':
    case 'range-based': {
      // RangeBasedLineBuilder (RangeBasedLineBuilder.cpp:70-124) runs the simple builder inside the span.
      const rangeBased = p.builder === 'range-based'
      const rangeStart = rangeBased && start.isFirstFormattedLine ? start.itemIndex + 1 : start.itemIndex
      const rangeEnd = rangeBased ? items.length - 1 : items.length
      b = { L, rangeStart, rangeEnd, partialLeadingTextItem: partialLeading(start.itemIndex), wrapOpportunityList: [], line: newLine(false), spanningInlineBox: false, isFirstFormattedLine: start.isFirstFormattedLine }
      const single = items[0]
      if (!rangeBased && items.length === 1 && single !== undefined && single.kind === 'text' && single.end - single.start <= 1 && !single.isWhitespace) {
        // placeSingleCharacterContentIfApplicable (TOS:164-196): one line, the stored width, no fit test.
        appendTextFast(L, b.line, single, single.width ?? 0)
        lineContentEnd = itemsEnd
        overflowLogicalWidth = null
      } else {
        const placed = p.style.wrap ? placeInlineTextContent(b) : placeNonWrappingInlineTextContent(b)
        lineContentEnd = rangeBased && placed.end.index === rangeEnd && placed.end.offset === 0 ? itemsEnd : placed.end
        overflowLogicalWidth = placed.overflowLogicalWidth
      }
      break
    }
    case 'line-builder': {
      // createLineSpanningInlineBoxes (ILB:385-430): the span the line starts inside, when the model has one.
      const first = items[start.itemIndex]!
      const spanning = first.kind === 'inline-box-end' || ((first.kind === 'text' || first.kind === 'soft-line-break') && p.paragraph.runs[p.boxes[first.box]!.run]!.node === 'span')
      b = { L, rangeStart: start.itemIndex, rangeEnd: items.length, partialLeadingTextItem: partialLeading(start.itemIndex), wrapOpportunityList: [], line: newLine(spanning), spanningInlineBox: spanning, isFirstFormattedLine: start.isFirstFormattedLine }
      const placed = placeInlineAndFloatContent(b, { index: start.itemIndex, offset: start.offset })
      lineContentEnd = placed.end
      overflowLogicalWidth = placed.overflowLogicalWidth
      break
    }
  }
  const line = b.line
  let next: Position = lineContentEnd
  if (start.previousLine !== null) {
    const previousEnd = { index: start.itemIndex, offset: start.offset }
    const advanced = previousEnd.index < lineContentEnd.index || (previousEnd.index === lineContentEnd.index && previousEnd.offset < lineContentEnd.offset)
    if (!advanced && !(lineContentEnd.index === itemsEnd.index && lineContentEnd.offset === 0)) {
      next = { index: Math.min(lineContentEnd.index + 1, itemsEnd.index), offset: 0 }
    }
  }
  // A line whose runs would all be empty (collapsible white space that collapses at the line start, span edges) has no
  // contentful inline content, so it gets no line box height (LineLayoutResult.h:94-105, InlineDisplayLineBuilder.cpp:62).
  // When only such items remain, this line is the last one with a line box.
  let onlyEmptyRunsRemain = next.offset === 0
  for (let i = next.index; onlyEmptyRunsRemain && i < items.length; i++) {
    const item = items[i]!
    onlyEmptyRunsRemain = item.kind === 'inline-box-start' || item.kind === 'inline-box-end' || (item.kind === 'text' && item.isWhitespace && !preservesSpacesAndTabs(p.style))
  }
  if (onlyEmptyRunsRemain) next = itemsEnd
  const isEnd = next.index === itemsEnd.index && next.offset === 0
  const lineStart = sourceOffset(p, { index: start.itemIndex, offset: start.offset })
  const lineEnd = isEnd ? p.runStarts[p.runStarts.length - 1]! : sourceOffset(p, next)
  const fragments = buildFragments(p, line, start.itemIndex === 0 && start.offset === 0 ? 0 : lineStart, lineEnd)
  const zoom = f32(p.env.pageZoom)
  const lastRun = line.runs[line.runs.length - 1]
  return {
    start: start.itemIndex === 0 && start.offset === 0 ? 0 : lineStart,
    end: lineEnd,
    width: f32(paintedExtent(L, line) / zoom),
    engineWidth: { unit: 'webkit-float32-px', value: line.contentLogicalWidth },
    fragments,
    joinsNextLine: false,
    next: isEnd ? null : {
      engine: 'webkit', itemIndex: next.index, offset: next.offset,
      previousLine: { carriedWidth: overflowLogicalWidth, endsWithLineBreak: lastRun !== undefined && lastRun.kind === 'soft-line-break' },
      isFirstFormattedLine: start.isFirstFormattedLine && !hasContent(line),
    },
  }
}
