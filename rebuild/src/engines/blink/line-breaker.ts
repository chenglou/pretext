// LineBreaker::NextLine for one line (line_breaker.cc at Chrome 153; specs/blink-lines.md §4-§14 and the handlers of
// specs/blink-gaps.md §4), with ShapingLineBreaker::ShapeLine (shaping_line_breaker.cc:256-612). Positions and widths
// are LayoutUnits: integers counting 1/64 of a zoomed px.
import type { LineSlot } from '../../model.js'
import { WS, bidiClassOf, bidiDataFor } from '../../unicode/bidi.js'
import { LineBreakIterator } from './breaks.js'
import { collapsesWhiteSpace, hasBorder, lengthLU, mayHaveMargin, mayHavePadding, wrapsLines } from './content.js'
import { maybeHanKerningClose } from './hankerning.js'
import {
  isStartSafeToBreak, itemShapeResult, luCeil, nextSafeToBreak, offsetForPosition, positionForOffset,
  previousSafeToBreak, reshape, reshapeHanKerningEnd, shapeHyphen, snappedWidth, tabShapeResult, truncateView, viewOf, widthOf16,
  viewFromSegments, WHOLE, type ReshapePart, type Segment, type ShapeResult, type Shaper, type View,
} from './shape.js'
import type { BlinkLineStart, BlinkStyle, InlineItem } from './types.js'

const ONE_PX = 64 // LayoutUnit ± int adds whole px (layout_unit.h:653-655, 684-686)

type State = 'continue' | 'overflow' | 'trailing' | 'done'
type Whitespace = 'leading' | 'none' | 'unknown' | 'collapsible' | 'collapsed' | 'preserved'

export type ItemResult = {
  itemIndex: number
  start: number
  end: number
  inlineSize: number
  shape: View | null
  canBreakAfter: boolean
  mayBreakInside: boolean
  hasOnlyPreWrapTrailingSpaces: boolean
  hasOnlyBidiTrailingSpaces: boolean
  breakAnywhereIfOverflow: boolean
  shouldCreateLineBox: boolean
  hyphen: { text: string; inlineSize: number } | null
  isHyphenated: boolean
  // The end before RemoveTrailingCollapsibleSpace removed a space, or -1.
  trimmedEnd: number
  // An atomic inline's inline margins (ComputeLineMarginsForVisualContainer, line_breaker.cc:3073-3075), raw.
  marginStart: number
  marginEnd: number
  // What JustifyResults added to glyph clusters, by cluster start, 16.16 (justification_utils.cc:115-178); absent otherwise.
  justification?: { start: number; add16: number }[]
}

export type LineInfo = {
  results: ItemResult[]
  // LineLayoutOpportunity's line offsets from the content box's left edge, raw (layout_opportunity.cc:164-189).
  lineLeft: number
  lineRight: number
  // LineInfo::AvailableWidth: lineRight − lineLeft.
  availableWidth: number
  // LineInfo::TextIndent(): the applied text-indent, raw (line_breaker.cc:846-857, 878-879, 4225-4248).
  textIndent: number
  // LineInfo::Width(): position after trailing spaces were removed, hanging spaces included, clamped at 0; and unclamped.
  width: number
  unclampedWidth: number
  token: BlinkLineStart | null
  hasForcedBreak: boolean
  // SetIsLastLine: the line ended at the paragraph's end or in a forced break (line_breaker.cc:1038, 2938, 4428).
  isLastLine: boolean
  // SetHasTrailingSpaces: the line ends in preserved white space (line_breaker.cc:976-981).
  hasTrailingSpaces: boolean
  shouldCreateLineBox: boolean
  // SetHasOverflow (line_breaker.cc:4268, 3084).
  hasOverflow: boolean
  // LineInfo::NeedsAccurateEndPosition (line_info.cc:127-175).
  needsAccurateEndPosition: boolean
  // Not Blink's: the end of the content the break decision measured, the next break opportunity after the line's end under
  // the current style's own break type, before any break-character override (at least one unit past it), for the gaps the
  // decision rests on.
  decisionEnd: number
}

// line_breaker.cc:186-188
function isSpaceLB(c: number): boolean {
  return c === 0x20 || c === 0x09
}

// shaping_line_breaker.cc:38-41: SP, TAB, LF and U+3000.
function isSpaceSLB(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x3000
}

function isSpaceOrOtherSeparator(c: number): boolean {
  return isSpaceLB(c) || c === 0x3000
}

// ComputedStyle::ShouldPreserveWhiteSpaces: white-space-collapse preserve or break-spaces.
function preservesSpaces(style: BlinkStyle): boolean {
  return !collapsesWhiteSpace(style.whiteSpace)
}

// NeedsAccurateEndPosition(const InlineItem&) (line_breaker.cc:260-266): the line end item's style has a box decoration
// background or applied text decorations. Text nodes share their parent's style, so a border on the span holding the text
// makes it true; the model has no backgrounds or decorations otherwise.
function itemNeedsAccurateEndPosition(style: BlinkStyle): boolean {
  return hasBorder(style)
}

type BreakOpportunity = { offset: number; nonHangableRunEnd: number | null }
type ShapeLineResult = { breakOffset: number; isOverflow: boolean; isHyphenated: boolean; hasTrailingSpaces: boolean }

export class LineBreaker {
  readonly sh: Shaper
  readonly text: string
  readonly items: InlineItem[]
  readonly iterator: LineBreakIterator
  readonly availableWidth: number
  readonly lineLeft: number
  readonly lineRight: number
  // ComputeFloatOffset (line_breaker.cc:674-693): how far floats moved the line start.
  readonly floatOffset: number
  readonly token: BlinkLineStart
  readonly isFirstFormattedLine: boolean
  // Leading floats of the inline formatting context: the lab protocol places the slot floats before the content, so a
  // slot with an inset has them (inline_layout_algorithm.cc PositionLeadingFloats).
  readonly hasLeadingFloats: boolean
  results: ItemResult[] = []
  current: { itemIndex: number; textOffset: number }
  position = 0
  appliedTextIndent = 0
  state: State = 'continue'
  trailingWhitespace: Whitespace = 'leading'
  currentStyle = -1
  autoWrap = false
  breakAnywhereIfOverflow = false
  overrideBreakAnywhere = false
  hyphenIndex: number | null = null
  hasAnyHyphens = false
  isForcedBreak = false
  isLastLine = false
  hasOverflow = false
  readonly previousLineHadForcedBreak: boolean
  readonly shapeResults = new Map<number, ShapeResult>()

  constructor(sh: Shaper, token: BlinkLineStart, slot: LineSlot) {
    const p = sh.p
    this.sh = sh
    this.text = p.text
    this.items = p.items
    this.token = token
    // The container's inline size as a LayoutUnit: CSS length × zoom as float, truncated (specs/blink-lines.md §2.2,
    // DESIGN.md §4.4). A slot's floats take their margin boxes off each side, each resolved to LayoutUnits on its own
    // (DESIGN.md §2.9), and ComputeLineLayoutOpportunity clamps the non-dominant side (layout_opportunity.cc:164-189).
    const zoom = p.layoutZoom
    const containerWidth = lengthLU(p.paragraph.width, zoom)
    let left = slot.left > 0 ? lengthLU(slot.left, zoom) : 0
    let right = containerWidth - (slot.right > 0 ? lengthLU(slot.right, zoom) : 0)
    if (p.baseLevel === 0) right = Math.max(Math.min(right, containerWidth), left)
    else left = Math.min(Math.max(left, 0), right)
    this.lineLeft = left
    this.lineRight = right
    this.availableWidth = right - left
    this.floatOffset = p.baseLevel === 0 ? Math.max(0, left) : Math.max(0, containerWidth - right)
    this.hasLeadingFloats = (slot.left > 0 || slot.right > 0) && !token.afterLeadingFloats
    this.iterator = new LineBreakIterator(p.text, p.is8Bit, p.settings[0]!, p.env.uiLanguage, p.env.dictionaryBreaks)
    this.current = { itemIndex: token.itemIndex, textOffset: token.textOffset }
    this.previousLineHadForcedBreak = token.afterForcedBreak
    this.isFirstFormattedLine = !token.isPastFirstFormattedLine
    // ShouldApplyTextIndent (line_breaker.cc:45-56): a non-zero text-indent on the first formatted line (no each-line or
    // hanging in the model). PrepareNextLine starts the position at it, so tab stops align whatever the indent (:846-879).
    if (p.paragraph.textIndent !== 0 && this.isFirstFormattedLine) this.appliedTextIndent = lengthLU(p.paragraph.textIndent, zoom)
    this.position = this.appliedTextIndent
    // The break token's style, reset for this line (line_breaker.cc:548-553, 869).
    this.setCurrentStyleForce(token.style)
    this.iterator.setStartOffset(token.textOffset)
  }

  style(index: number): BlinkStyle {
    return this.sh.p.styles[index]!
  }

  char(i: number): number {
    return i < this.text.length ? this.text.charCodeAt(i) : 0
  }

  shapeResultOf(itemIndex: number): ShapeResult {
    let sr = this.shapeResults.get(itemIndex)
    if (sr === undefined) {
      sr = itemShapeResult(this.sh, itemIndex)
      this.shapeResults.set(itemIndex, sr)
    }
    return sr
  }

  // SetCurrentStyleForce (line_breaker.cc:4557-4643) from the style's own properties.
  setCurrentStyleForce(style: number): void {
    this.currentStyle = style
    const settings = this.sh.p.settings[style]!
    this.autoWrap = settings.autoWrap
    if (!this.autoWrap) return
    this.iterator.locale = this.style(style).locale
    this.iterator.settings = settings
    this.breakAnywhereIfOverflow = settings.breakAnywhereIfOverflow
    this.iterator.breakType = this.breakAnywhereIfOverflow && this.overrideBreakAnywhere ? 'break-character' : settings.breakType
  }

  setCurrentStyle(style: number): void {
    if (style !== this.currentStyle) this.setCurrentStyleForce(style)
  }

  // NeedsAccurateEndPosition(line_info, line_end_item) (line_breaker.cc:268-271).
  needsAccurateEndPosition(item: InlineItem): boolean {
    return this.sh.p.needsAccurateEndPosition || itemNeedsAccurateEndPosition(this.style(item.style))
  }

  // The state after calls that change it (TypeScript would keep a narrowed `this.state`).
  stateNow(): State {
    return this.state
  }

  atEnd(): boolean {
    return this.current.itemIndex >= this.items.length
  }

  canFitOnLine(): boolean {
    return this.position <= this.availableWidth + 1
  }

  remainingAvailableWidth(): number {
    return this.availableWidth + 1 - this.position
  }

  lastResult(): ItemResult | null {
    return this.results.length > 0 ? this.results[this.results.length - 1]! : null
  }

  // AddItem (line_breaker.cc:575-598).
  addItem(endOffset: number): ItemResult {
    const last = this.lastResult()
    const r: ItemResult = {
      itemIndex: this.current.itemIndex, start: this.current.textOffset, end: endOffset, inlineSize: 0, shape: null,
      canBreakAfter: false, mayBreakInside: false, hasOnlyPreWrapTrailingSpaces: false, hasOnlyBidiTrailingSpaces: false,
      breakAnywhereIfOverflow: this.breakAnywhereIfOverflow, shouldCreateLineBox: last !== null && last.shouldCreateLineBox,
      hyphen: null, isHyphenated: false, trimmedEnd: -1, marginStart: 0, marginEnd: 0,
    }
    this.results.push(r)
    return r
  }

  // AddEmptyItem (line_breaker.cc:600-616).
  addEmptyItem(): ItemResult {
    const r = this.addItem(this.current.textOffset)
    if (this.results.length >= 2) {
      const last = this.results[this.results.length - 2]!
      if (last.canBreakAfter) {
        last.canBreakAfter = false
        r.canBreakAfter = true
      }
    }
    return r
  }

  moveToNextOfItem(): void {
    this.current = { itemIndex: this.current.itemIndex + 1, textOffset: this.items[this.current.itemIndex]!.end }
  }

  moveToNextOfResult(r: ItemResult): void {
    this.current = { itemIndex: r.itemIndex, textOffset: r.end }
    if (r.end === this.items[r.itemIndex]!.end) this.current.itemIndex++
  }

  computeCanBreakAfter(r: ItemResult): void {
    r.canBreakAfter = this.autoWrap && this.iterator.isBreakable(r.end)
  }

  hasHyphen(): boolean {
    return this.hyphenIndex !== null
  }

  // AddHyphen / RemoveHyphen / RestoreLastHyphen (line_breaker.cc:728-807).
  addHyphen(index: number): number {
    this.hyphenIndex = index
    const r = this.results[index]!
    if (r.hyphen === null) {
      r.hyphen = shapeHyphen(this.sh, this.items[r.itemIndex]!.style)
      this.hasAnyHyphens = true
    }
    r.inlineSize += r.hyphen.inlineSize
    return r.hyphen.inlineSize
  }

  removeHyphen(): number {
    const r = this.results[this.hyphenIndex!]!
    const size = r.hyphen!.inlineSize
    r.inlineSize -= size
    this.hyphenIndex = null
    return size
  }

  restoreLastHyphen(): void {
    for (let i = this.results.length - 1; i >= 0; i--) {
      const r = this.results[i]!
      if (r.hyphen !== null) {
        this.addHyphen(i)
        return
      }
      if (this.items[r.itemIndex]!.type === 'text') return
    }
  }

  // LineInfo::ComputeWidth: the item results' sizes and the applied text-indent (line_info.cc).
  computeWidth(): number {
    let w = this.appliedTextIndent
    for (let i = 0; i < this.results.length; i++) w += this.results[i]!.inlineSize
    return w
  }

  handleOverflowIfNeeded(): boolean {
    if (this.state === 'continue' && !this.canFitOnLine()) {
      this.handleOverflow()
      return true
    }
    return false
  }

  // NextLine (line_breaker.cc:893-1007).
  nextLine(): LineInfo {
    this.breakLine()
    if (this.hasHyphen()) this.results[this.hyphenIndex!]!.isHyphenated = true
    this.removeTrailingCollapsibleSpace()
    this.splitTrailingBidiPreservedSpace()
    let shouldCreateLineBox = false
    for (let i = 0; i < this.results.length; i++) if (this.results[i]!.shouldCreateLineBox) shouldCreateLineBox = true
    // CreateBreakToken (line_breaker.cc:4723-4744): past the first formatted line once a line isn't empty.
    const isPastFirstFormattedLine = !this.isFirstFormattedLine || shouldCreateLineBox
    const contentEnd = this.atEnd() ? this.text.length : this.current.textOffset
    // The first ShapeLine pass reads positions up to its candidate under the style's own break type, before an overflow
    // switches to break-character (RetryAfterOverflow), so the look-ahead is the next opportunity under that type.
    const breakType = this.iterator.breakType
    this.iterator.breakType = this.iterator.settings.breakType
    const decisionEnd = contentEnd >= this.text.length ? contentEnd : Math.max(contentEnd + 1, Math.min(this.text.length, this.iterator.nextBreakOpportunity(contentEnd + 1)))
    this.iterator.breakType = breakType
    return {
      decisionEnd,
      results: this.results,
      lineLeft: this.lineLeft,
      lineRight: this.lineRight,
      availableWidth: this.availableWidth,
      textIndent: this.appliedTextIndent,
      width: Math.max(0, this.position),
      unclampedWidth: this.position,
      token: this.atEnd() ? null : {
        engine: 'blink', itemIndex: this.current.itemIndex, textOffset: this.current.textOffset, style: this.currentStyle,
        afterForcedBreak: this.isForcedBreak, isPastFirstFormattedLine, afterLeadingFloats: true,
      },
      hasForcedBreak: this.isForcedBreak,
      isLastLine: this.isLastLine,
      hasTrailingSpaces: this.trailingWhitespace === 'preserved',
      shouldCreateLineBox,
      hasOverflow: this.hasOverflow,
      needsAccurateEndPosition: this.sh.p.needsAccurateEndPosition,
    }
  }

  // BreakLine (line_breaker.cc:1009-1147).
  breakLine(): void {
    this.state = 'continue'
    this.trailingWhitespace = 'leading'
    while (this.stateNow() !== 'done') {
      if (this.atEnd()) {
        if (this.handleOverflowIfNeeded() && !this.atEnd()) continue
        if (this.hasHyphen()) this.position -= this.removeHyphen()
        this.isLastLine = true
        return
      }
      const last = this.lastResult()
      if (this.stateNow() === 'overflow' && last !== null && last.canBreakAfter) this.state = 'trailing'
      const item = this.items[this.current.itemIndex]!
      switch (item.type) {
        case 'text':
          if (item.end > item.start) this.handleText(item, this.shapeResultOf(this.current.itemIndex))
          else this.handleEmptyText()
          break
        case 'open-tag': this.handleOpenTag(item); break
        case 'close-tag': this.handleCloseTag(item); break
        case 'control': this.handleControlItem(item); break
        case 'atomic':
          // Items after this point are not trailable: break before them while trailing (:1097-1103).
          if (this.stateNow() === 'trailing') return
          this.handleAtomicInline(item)
          break
      }
    }
  }

  // HandleText (line_breaker.cc:1322-1504).
  handleText(item: InlineItem, sr: ShapeResult): void {
    if (this.state === 'trailing') {
      this.handleTrailingSpaces(item, sr)
      return
    }
    if (this.trailingWhitespace === 'leading') {
      if (collapsesWhiteSpace(this.style(item.style).whiteSpace) && this.char(this.current.textOffset) === 0x20) {
        this.current.textOffset++
        if (this.current.textOffset === item.end) {
          this.handleEmptyText()
          return
        }
      }
    }
    if (this.state === 'continue' && !this.canFitOnLine()) {
      if (this.autoWrap && isSpaceLB(this.char(this.current.textOffset))) {
        this.handleTrailingSpaces(item, sr)
        if (this.stateNow() !== 'done') {
          this.state = 'continue'
          return
        }
      }
      this.handleOverflow()
      return
    }
    if (this.hasHyphen()) this.position -= this.removeHyphen()
    const r = this.addItem(item.end)
    r.shouldCreateLineBox = true
    if (this.autoWrap) {
      const available = this.remainingAvailableWidth()
      const result = this.breakText(r, item, sr, available, available)
      this.position += r.inlineSize
      this.moveToNextOfResult(r)
      if (result === 'success') {
        if (r.end < item.end) this.handleTrailingSpaces(item, sr)
        return
      }
      if (r.shape === null) {
        this.handleOverflow()
        return
      }
      if (r.hasOnlyPreWrapTrailingSpaces) {
        this.state = 'trailing'
        if (preservesSpaces(this.style(item.style)) && isSpaceLB(this.char(r.end - 1))) this.rewind(this.results.indexOf(r))
        return
      }
      if (this.stateNow() === 'overflow') {
        if (r.canBreakAfter) this.state = 'trailing'
        return
      }
      if (this.allSpacesLB(r.start, r.end)) return
      this.handleOverflow()
      return
    }
    if (r.start === item.start) {
      r.inlineSize = Math.max(0, snappedWidth(sr))
      r.shape = viewOf(this.sh, sr)
    } else {
      r.shape = viewOf(this.sh, sr, r.start, r.end)
      r.inlineSize = Math.max(0, luCeil(r.shape.width))
    }
    this.trailingWhitespace = 'unknown'
    this.position += r.inlineSize
    this.moveToNextOfItem()
  }

  allSpacesLB(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (!isSpaceLB(this.char(i))) return false
    return true
  }

  // BreakText (line_breaker.cc:1603-1759).
  breakText(r: ItemResult, item: InlineItem, sr: ShapeResult, availableWidth: number, availableWidthWithHyphens: number): 'success' | 'overflow' {
    const noResultIfOverflow = this.breakAnywhereIfOverflow && !this.overrideBreakAnywhere
    // SetDontReshapeEndIfAtSpace unless the line needs an accurate end position (:1655-1659).
    const dontReshapeEndIfAtSpace = !this.needsAccurateEndPosition(item)
    let inlineSize: number
    let out: ShapeLineResult
    for (;;) {
      out = { breakOffset: 0, isOverflow: false, isHyphenated: false, hasTrailingSpaces: false }
      const view = this.shapeLine(item, sr, r.start, Math.max(0, availableWidth), noResultIfOverflow, dontReshapeEndIfAtSpace, out)
      if (view === null) {
        r.inlineSize = availableWidthWithHyphens + 1
        r.end = item.end
        return 'overflow'
      }
      inlineSize = Math.max(0, luCeil(view.width))
      r.inlineSize = inlineSize
      if (out.isHyphenated) {
        const hyphenInlineSize = this.addHyphen(this.results.indexOf(r))
        if (!out.isOverflow && inlineSize <= availableWidth) {
          const spaceForHyphen = availableWidthWithHyphens - inlineSize
          if (spaceForHyphen >= 0 && hyphenInlineSize > spaceForHyphen) {
            availableWidth -= hyphenInlineSize
            this.removeHyphen()
            continue
          }
        }
        inlineSize = r.inlineSize
      }
      r.end = out.breakOffset
      r.hasOnlyPreWrapTrailingSpaces = out.hasTrailingSpaces
      r.hasOnlyBidiTrailingSpaces = out.hasTrailingSpaces
      r.shape = view
      break
    }
    if (r.end < item.end) {
      r.canBreakAfter = true
      this.trailingWhitespace = this.iterator.breakType === 'break-character' ? 'unknown' : 'none'
    } else {
      r.canBreakAfter = this.canBreakAfter(item)
      this.trailingWhitespace = 'unknown'
    }
    r.mayBreakInside = !out.isOverflow
    return inlineSize <= availableWidthWithHyphens ? 'success' : 'overflow'
  }

  // CanBreakAfter (line_breaker.cc:1210-1267): a text item followed by an atomic inline can always break after.
  canBreakAfter(item: InlineItem): boolean {
    const canBreakAfter = this.iterator.isBreakable(item.end)
    if (item.type !== 'text') return canBreakAfter
    // TryGetAtomicInlineItemAfter (:1284-1305).
    if (item.end < this.text.length && this.char(item.end) === 0xfffc) {
      for (let i = this.items.indexOf(item) + 1; i < this.items.length; i++) {
        const next = this.items[i]!
        if (next.type === 'atomic') return true
        if (next.end > item.end) break
      }
    }
    return canBreakAfter
  }

  previousBO(offset: number, start: number): BreakOpportunity {
    const b = this.iterator.previousBreakOpportunity(offset, start)
    return isSpaceSLB(this.char(b - 1)) ? { offset: b, nonHangableRunEnd: this.findNonHangableEnd(b - 1) } : { offset: b, nonHangableRunEnd: null }
  }

  nextBO(offset: number, len: number): BreakOpportunity {
    const b = this.iterator.nextBreakOpportunity(offset, len)
    return isSpaceSLB(this.char(b - 1)) ? { offset: b, nonHangableRunEnd: this.findNonHangableEnd(b - 1) } : { offset: b, nonHangableRunEnd: null }
  }

  // FindNonHangableEnd (shaping_line_breaker.cc:72-83).
  findNonHangableEnd(candidate: number): number {
    let end = candidate
    while (end > 0) {
      if (!isSpaceSLB(this.char(--end))) return end + 1
    }
    return end
  }

  setBreakOffset(out: ShapeLineResult, offset: number): void {
    out.breakOffset = offset
    out.isHyphenated = this.char(offset - 1) === 0xad
  }

  // ShapingLineBreaker::ShapeLine (shaping_line_breaker.cc:256-612), without hyphenation dictionaries (hyphens: manual),
  // auto-spacing (text-autospace: no-autospace) and HanKerning at wrapped line starts, which text-spacing-trim: normal
  // doesn't trim (text_spacing_trim.h:31-34). The HanKerning line-end reshape (:344-363) is taken.
  shapeLine(item: InlineItem, sr: ShapeResult, start: number, availableSpace: number, noResultIfOverflow: boolean, dontReshapeEndIfAtSpace: boolean, out: ShapeLineResult): View | null {
    const sh = this.sh
    const rangeStart = sr.start
    const rangeEnd = sr.end
    const rtl = sr.rtl
    const flip = (v: number): number => rtl ? -v : v
    const lineStart = this.token.textOffset
    const isStartOfWrappedLine = start !== 0 && start === lineStart && !this.previousLineHadForcedBreak
    if (start === rangeStart && availableSpace >= snappedWidth(sr) && isStartSafeToBreak(sh, sr)) {
      this.setBreakOffset(out, rangeEnd)
      return viewOf(sh, sr)
    }
    const startPosition = positionForOffset(sh, sr, start)
    let lineStartResult: ReshapePart | null = null
    const firstSafe = isStartOfWrappedLine ? nextSafeToBreak(sh, sr, start) : start
    if (firstSafe !== start) {
      const firstSafePosition = positionForOffset(sh, sr, firstSafe)
      lineStartResult = reshape(sh, item.group, start, firstSafe, true)
      const oldWidth = flip(firstSafePosition - startPosition)
      const diff = oldWidth - luCeil(widthOf16(lineStartResult.call.width16))
      if (diff !== 0) availableSpace = Math.max(availableSpace + diff, 0)
    }
    const endPosition = startPosition + flip(availableSpace)
    let candidate = offsetForPosition(sh, sr, endPosition)
    // ShapeToEnd (shaping_line_breaker.cc:640-670).
    const shapeToEnd = (): View => {
      if (lineStartResult === null) return start === rangeStart ? viewOf(sh, sr) : viewOf(sh, sr, start, rangeEnd)
      if (firstSafe >= rangeEnd) return viewFromSegments(sh, rtl, [{ kind: 'reshape', call: lineStartResult.call, start, end: rangeEnd }])
      return viewFromSegments(sh, rtl, [{ kind: 'reshape', call: lineStartResult.call, start: 0, end: WHOLE }, { kind: 'result', sr, start: firstSafe, end: rangeEnd }])
    }
    // ConcatShapeResults (shaping_line_breaker.cc:613-636).
    const concat = (lastSafe: number, lineEnd: ReshapePart | null): View => {
      const segments: Segment[] = []
      if (lineStartResult !== null) segments.push({ kind: 'reshape', call: lineStartResult.call, start: 0, end: WHOLE })
      if (lastSafe > firstSafe) segments.push({ kind: 'result', sr, start: firstSafe, end: lastSafe })
      if (lineEnd !== null) segments.push({ kind: 'reshape', call: lineEnd.call, start: lastSafe, end: WHOLE })
      return viewFromSegments(sh, rtl, segments)
    }
    // Extend the candidate when the next character fits after HanKerning trims it at the line end (:344-363).
    let lastSafe = 0
    let lineEndResult: ReshapePart | null = null
    if (candidate < rangeEnd && maybeHanKerningClose(this.char(candidate)) && this.iterator.isBreakable(candidate + 1)) {
      lastSafe = previousSafeToBreak(sh, sr, candidate)
      lineEndResult = reshapeHanKerningEnd(sh, item.group, lastSafe, candidate + 1)
      const widthToLastSafe = flip(positionForOffset(sh, sr, lastSafe) - startPosition)
      if (Math.fround(Math.fround(widthToLastSafe / 64) + widthOf16(lineEndResult.call.width16)) <= Math.fround(availableSpace / 64)) candidate++
      else lineEndResult = null
    }
    if (candidate >= rangeEnd) {
      this.setBreakOffset(out, rangeEnd)
      if (lineEndResult !== null) return concat(lastSafe, lineEndResult) // LineBreakerHanKerningEnd, stable
      return shapeToEnd()
    }
    candidate = Math.max(candidate, start)
    const afterEverySpace = this.iterator.settings.breakSpace === 'after-every-space'
    let bo: BreakOpportunity
    if (!isSpaceSLB(this.char(candidate)) || afterEverySpace) {
      bo = this.previousBO(candidate, start)
      out.isOverflow = bo.offset <= start
      if (out.isOverflow) {
        if (noResultIfOverflow) return null
        bo = this.nextBO(Math.max(candidate, start + 1), rangeEnd)
      }
    } else {
      bo = this.nextBO(Math.max(candidate, start + 1), rangeEnd)
      if (bo.offset > candidate && (bo.nonHangableRunEnd === null || bo.nonHangableRunEnd > candidate)) {
        const previous = this.previousBO(candidate, start)
        if (previous.offset > start) {
          bo = previous
        } else {
          out.isOverflow = true
          if (noResultIfOverflow) return null
        }
      }
      if (bo.nonHangableRunEnd !== null && bo.nonHangableRunEnd <= start) {
        out.hasTrailingSpaces = true
        out.breakOffset = Math.min(rangeEnd, bo.offset)
        out.isHyphenated = false
        return viewOf(sh, sr, start, out.breakOffset)
      }
    }
    let reshapeLineEnd = lineEndResult === null
    if (bo.offset >= rangeEnd) {
      this.setBreakOffset(out, rangeEnd)
      if (out.isOverflow) return shapeToEnd()
      bo.offset = rangeEnd
      reshapeLineEnd = false
      if (bo.nonHangableRunEnd !== null && rangeEnd < bo.nonHangableRunEnd) bo.nonHangableRunEnd = null
      if (isSpaceSLB(this.char(rangeEnd - 1))) bo.nonHangableRunEnd = this.findNonHangableEnd(rangeEnd - 1)
    }
    // dont_reshape_end_if_at_space_ (:481-488): the end isn't reshaped before a space unless the line needs an accurate end
    // position.
    if (dontReshapeEndIfAtSpace && reshapeLineEnd) reshapeLineEnd = !isSpaceSLB(this.char(bo.offset - 1))
    if (!afterEverySpace && bo.nonHangableRunEnd !== null) bo.offset = Math.max(start + 1, bo.nonHangableRunEnd)
    if (firstSafe >= bo.offset) {
      this.setBreakOffset(out, bo.offset)
      return viewFromSegments(sh, rtl, [{ kind: 'reshape', call: reshape(sh, item.group, start, bo.offset, true).call, start: 0, end: WHOLE }])
    }
    if (reshapeLineEnd) {
      for (;;) {
        if (!afterEverySpace && bo.nonHangableRunEnd !== null) bo.offset = Math.max(start + 1, bo.nonHangableRunEnd)
        lastSafe = previousSafeToBreak(sh, sr, bo.offset)
        if (lastSafe === bo.offset) break
        if (lastSafe < firstSafe) {
          lastSafe = start
          lineStartResult = null
        }
        if (out.isOverflow) {
          lineEndResult = reshape(sh, item.group, lastSafe, bo.offset)
          break
        }
        const safePosition = positionForOffset(sh, sr, lastSafe)
        lineEndResult = reshape(sh, item.group, lastSafe, bo.offset)
        if (widthOf16(lineEndResult.call.width16) <= Math.fround(flip(endPosition - safePosition) / 64)) break
        lineEndResult = null
        bo = this.previousBO(bo.offset - 1, start)
        if (bo.offset > start) continue
        out.isOverflow = true
        bo = this.previousBO(candidate, start)
        if (bo.offset <= start) {
          bo = this.nextBO(Math.max(candidate, start + 1), rangeEnd)
          if (bo.offset >= rangeEnd) {
            this.setBreakOffset(out, rangeEnd)
            return shapeToEnd()
          }
        }
      }
    }
    if (lineEndResult === null) lastSafe = bo.offset
    this.setBreakOffset(out, bo.offset)
    return concat(lastSafe, lineEndResult)
  }

  // HandleTrailingSpaces (line_breaker.cc:2418-2534).
  handleTrailingSpaces(item: InlineItem, sr: ShapeResult | null): void {
    if (!this.autoWrap) {
      this.state = 'done'
      return
    }
    const style = this.style(item.style)
    const c = this.char(this.current.textOffset)
    if (collapsesWhiteSpace(style.whiteSpace) && c !== 0x3000) {
      if (c !== 0x20) {
        if (this.current.textOffset > 0 && isSpaceLB(this.char(this.current.textOffset - 1))) this.trailingWhitespace = 'collapsible'
        this.state = 'done'
        return
      }
      this.current.textOffset++
      if (this.trailingWhitespace !== 'preserved') this.trailingWhitespace = 'collapsed'
      this.results[this.results.length - 1]!.canBreakAfter = true
    } else if (style.whiteSpace !== 'break-spaces') {
      let end = this.current.textOffset
      while (end < item.end && isSpaceOrOtherSeparator(this.char(end))) end++
      if (end === this.current.textOffset) {
        if (isSpaceOrOtherSeparator(this.char(end - 1))) this.trailingWhitespace = 'preserved'
        this.state = 'done'
        return
      }
      const r = this.addItem(end)
      r.shouldCreateLineBox = true
      r.hasOnlyPreWrapTrailingSpaces = true
      r.hasOnlyBidiTrailingSpaces = true
      const result = sr!
      if (r.start === item.start && r.end === item.end) {
        r.shape = viewOf(this.sh, result)
        r.inlineSize = snappedWidth(result)
      } else {
        r.shape = viewOf(this.sh, result, r.start, r.end)
        r.inlineSize = luCeil(r.shape.width)
      }
      this.position += r.inlineSize
      r.canBreakAfter = end < this.text.length && !isSpaceOrOtherSeparator(this.char(end))
      this.current.textOffset = end
      this.trailingWhitespace = 'preserved'
    }
    if (this.current.textOffset < item.end) {
      this.state = 'done'
      return
    }
    const last = this.lastResult()
    if (last === null || last.itemIndex !== this.current.itemIndex) this.addEmptyItem()
    this.current.itemIndex++
    this.state = 'trailing'
  }

  // HandleEmptyText (line_breaker.cc:2034-2042).
  handleEmptyText(): void {
    this.addEmptyItem()
    this.moveToNextOfItem()
  }

  // HandleControlItem (line_breaker.cc:2944-2999).
  handleControlItem(item: InlineItem): void {
    switch (item.control) {
      case 'forced-break':
        this.handleForcedLineBreak()
        return
      case 'tab': {
        // The item's tab-size with the block's font and spacing (TabSizeAncestor), from position_ + ComputeFloatOffset()
        // (TabAlignmentWithFloats, stable; :2960-2972).
        const sr = tabShapeResult(this.sh, item.start, item.end, (item.bidiLevel & 1) === 1, this.position + this.floatOffset, item.run, item.style)
        this.handleText(item, sr)
        return
      }
      case 'generated-zwsp': case 'wbr': {
        // <wbr> creates a break opportunity regardless of auto_wrap; a generated one makes no line box (:2976-2987).
        const r = this.addItem(item.end)
        if (item.control === 'wbr') r.shouldCreateLineBox = true
        r.canBreakAfter = true
        this.moveToNextOfItem()
        return
      }
      case 'cr-ff':
        this.handleEmptyText()
        return
      case 'none':
        throw new Error('control item without a control kind')
    }
  }

  // HandleForcedLineBreak (line_breaker.cc:2856-2940, specs/blink-gaps.md §4.4).
  handleForcedLineBreak(): void {
    if (this.handleOverflowIfNeeded()) return
    const r = this.addItem(this.items[this.current.itemIndex]!.end)
    r.shouldCreateLineBox = true
    r.hasOnlyPreWrapTrailingSpaces = true
    r.hasOnlyBidiTrailingSpaces = true
    r.canBreakAfter = true
    this.moveToNextOfItem()
    while (!this.atEnd()) {
      const next = this.items[this.current.itemIndex]!
      if (next.type === 'close-tag') { this.handleCloseTag(next); continue }
      if (next.type === 'text' && next.start === next.end) { this.handleEmptyText(); continue }
      break
    }
    if (this.hasHyphen()) this.position -= this.removeHyphen()
    this.isForcedBreak = true
    this.isLastLine = true
    this.state = 'done'
  }

  // HandleAtomicInline (line_breaker.cc:3043-3165) for an atomic inline of declared size, in content mode.
  handleAtomicInline(item: InlineItem): void {
    const p = this.sh.p
    const node = p.index.elements[item.element]!.node
    if (node.kind !== 'atomic') throw new Error(`atomic item of a ${node.kind} element`)
    const remainingWidth = this.remainingAvailableWidth()
    let ignoreOverflowIfNegativeMargin = false
    if (this.state === 'continue' && remainingWidth < 0) {
      const itemIndex = this.current.itemIndex
      this.handleOverflow()
      if (!this.hasOverflow || itemIndex !== this.current.itemIndex) return
      ignoreOverflowIfNegativeMargin = true
    }
    const r = this.addItem(item.end)
    r.marginStart = lengthLU(node.marginInlineStart, p.layoutZoom)
    r.marginEnd = lengthLU(node.marginInlineEnd, p.layoutZoom)
    const inlineMargins = r.marginStart + r.marginEnd
    if (ignoreOverflowIfNegativeMargin) {
      if (inlineMargins >= remainingWidth) {
        this.results.pop() // RemoveLastItem
        return
      }
      this.state = 'continue'
      this.hasOverflow = false
    }
    if (this.hasHyphen()) this.position -= this.removeHyphen()
    // The border box's inline size (box-sizing: border-box, a fixed width) plus the margins (:3121-3137).
    r.inlineSize = lengthLU(node.width, p.layoutZoom) + inlineMargins
    r.shouldCreateLineBox = true
    // CanBreakAfterAtomicInline (:1168-1186): any atomic inline in a wrapping style.
    r.canBreakAfter = this.autoWrap
    this.position += r.inlineSize
    this.trailingWhitespace = 'none'
    this.moveToNextOfItem()
  }

  // ComputeOpenTagResult and HandleOpenTag (line_breaker.cc:3937-4008).
  handleOpenTag(item: InlineItem): void {
    const r = this.addItem(item.end)
    const style = this.style(item.style)
    if (item.shouldCreateBoxFragment && (hasBorder(style) || mayHavePadding(style) || mayHaveMargin(style))) {
      r.inlineSize = style.start.margin + style.start.border + style.start.padding
      // Negative margins on open tags may bring the position back (:3968-3976).
      if (r.inlineSize < 0 && this.state === 'trailing') {
        const availableWidth = this.availableWidth + 1
        if (this.position > availableWidth && this.position + r.inlineSize <= availableWidth) this.state = 'continue'
      }
      this.position += r.inlineSize
      if (!r.shouldCreateLineBox && !item.isEmptyItem) r.shouldCreateLineBox = true
    }
    this.setCurrentStyle(item.style)
    this.moveToNextOfItem()
    // The nowrap-to-wrap recomputation (:4001-4007) checks the item before current_, which after MoveToNextOf is this open
    // tag, never a text item, so it doesn't run.
  }

  // HandleCloseTag (line_breaker.cc:4010-4074).
  handleCloseTag(item: InlineItem): void {
    const r = this.addItem(item.end)
    const style = this.style(item.style)
    // ComputeInlineEndSize (:250-258): margin, border and padding at the inline end, whatever the box fragment.
    r.inlineSize = style.end.margin + style.end.border + style.end.padding
    this.position += r.inlineSize
    if (!r.shouldCreateLineBox && !item.isEmptyItem) r.shouldCreateLineBox = true
    const wasAutoWrap = this.autoWrap
    this.setCurrentStyle(style.parent)
    this.moveToNextOfItem()
    if (this.results.length >= 2) {
      const last = this.results[this.results.length - 2]!
      if (last.canBreakAfter) {
        r.canBreakAfter = true
        last.canBreakAfter = false
        return
      }
      if (wasAutoWrap) {
        const precededByBreakableSpace = r.end > 0 && isSpaceLB(this.char(r.end - 1))
        const current = this.style(this.currentStyle)
        // ShouldBreakOnlyAfterWhiteSpace: preserved spaces that wrap (pre-wrap, break-spaces).
        const onlyAfterWhiteSpace = preservesSpaces(current) && wrapsLines(current.whiteSpace)
        const nextIsOpenTag = !this.atEnd() && this.items[this.current.itemIndex]!.type === 'open-tag'
        r.canBreakAfter = isSpaceLB(this.char(r.end)) && (!onlyAfterWhiteSpace || precededByBreakableSpace) && !nextIsOpenTag
        return
      }
      if (this.autoWrap && !isSpaceLB(this.char(r.end - 1))) this.computeCanBreakAfter(r)
    }
  }

  // HandleOverflow (line_breaker.cc:4076-4305).
  handleOverflow(): void {
    const availableWidth = this.availableWidth + 1
    const hyphenIndexBefore = this.hyphenIndex
    if (this.hasHyphen()) this.position -= this.removeHyphen()
    let widthToRewind = this.position - availableWidth
    let breakBefore = 0
    let hasBreakAnywhereIfOverflow = this.breakAnywhereIfOverflow
    for (let i = this.results.length; i > 0;) {
      const r = this.results[--i]!
      hasBreakAnywhereIfOverflow ||= r.breakAnywhereIfOverflow
      if (i < this.results.length - 1 && r.canBreakAfter) {
        if (widthToRewind <= 0) {
          this.position = availableWidth + widthToRewind
          this.rewindOverflow(i + 1)
          return
        }
        breakBefore = i + 1
      }
      widthToRewind -= r.inlineSize
      if (widthToRewind > 0) continue
      const item = this.items[r.itemIndex]!
      if (item.type !== 'text') continue
      if (r.end === r.start) continue
      if (widthToRewind < 0 && r.mayBreakInside) {
        const itemAvailableWidth = -widthToRewind
        const minAvailableWidth = r.inlineSize - ONE_PX
        if (minAvailableWidth <= 0) {
          if (this.breakTextAtPreviousBreakOpportunity(i)) {
            this.rewindOverflow(i + 1)
            return
          }
          continue
        }
        const wasCurrentStyle = this.currentStyle
        this.setCurrentStyle(item.style)
        const before = { ...r }
        this.breakText(r, item, this.shapeResultOf(r.itemIndex), Math.min(itemAvailableWidth, minAvailableWidth), itemAvailableWidth)
        if (r.canBreakAfter && r.inlineSize <= itemAvailableWidth && r.end < before.end) {
          const newEnd = i + 1
          if (newEnd === this.results.length) {
            this.position = availableWidth + widthToRewind + r.inlineSize
            this.current = { itemIndex: r.itemIndex, textOffset: r.end }
            this.handleTrailingSpaces(item, this.shapeResultOf(r.itemIndex))
            return
          }
          this.state = 'trailing'
          this.rewind(newEnd)
          return
        }
        if (this.hasHyphen()) this.removeHyphen()
        this.results[i] = before
        this.setCurrentStyle(wasCurrentStyle)
      }
    }
    // Text-indent alone doesn't contribute to overflow on a first formatted line with leading floats (:4225-4248).
    if (this.appliedTextIndent !== 0 && widthToRewind > 0 && this.isFirstFormattedLine && this.hasLeadingFloats) {
      this.position -= this.appliedTextIndent
      widthToRewind -= this.appliedTextIndent
      this.appliedTextIndent = 0
      if (widthToRewind <= 0) {
        this.state = 'done'
        return
      }
    }
    if (!this.overrideBreakAnywhere && hasBreakAnywhereIfOverflow) {
      this.overrideBreakAnywhere = true
      this.retryAfterOverflow()
      return
    }
    // Let this line overflow (:4267-4268).
    this.hasOverflow = true
    if (hyphenIndexBefore !== null && hyphenIndexBefore < this.results.length) this.position += this.addHyphen(hyphenIndexBefore)
    if (breakBefore !== 0) {
      this.rewindOverflow(breakBefore)
      return
    }
    const last = this.lastResult()
    if (last !== null && last.canBreakAfter) {
      this.state = 'trailing'
      return
    }
    this.state = 'overflow'
  }

  // BreakTextAtPreviousBreakOpportunity (line_breaker.cc:1797-1829).
  breakTextAtPreviousBreakOpportunity(index: number): boolean {
    const r = this.results[index]!
    const b = this.iterator.previousBreakOpportunity(r.end - 1, r.start)
    if (b <= r.start) return false
    r.end = b
    r.shape = viewOf(this.sh, this.shapeResultOf(r.itemIndex), r.start, b)
    r.inlineSize = Math.max(0, luCeil(r.shape.width))
    r.canBreakAfter = true
    return true
  }

  // RetryAfterOverflow (line_breaker.cc:4307-4329).
  retryAfterOverflow(): void {
    this.state = 'continue'
    if (this.results.length > 0) {
      this.setCurrentStyleForce(this.computeCurrentStyle(0))
      this.rewind(0)
    } else {
      this.setCurrentStyleForce(this.currentStyle)
    }
  }

  // RewindOverflow (line_breaker.cc:4333-4420).
  rewindOverflow(newEnd: number): void {
    let openTagCount = 0
    for (let index = newEnd; index < this.results.length; index++) {
      const r = this.results[index]!
      const item = this.items[r.itemIndex]!
      const style = this.style(item.style)
      switch (item.type) {
        case 'text':
          if (r.end === r.start) continue
          if (r.shape !== null || (this.breakAnywhereIfOverflow && !this.overrideBreakAnywhere)) {
            if (wrapsLines(style.whiteSpace) && style.whiteSpace !== 'break-spaces' && isSpaceLB(this.char(r.start))) {
              if (r.shape !== null && this.allSpacesLB(r.start + 1, r.end)) continue
              this.state = 'trailing'
              this.rewind(index)
              return
            }
          }
          break
        case 'control':
          if (wrapsLines(style.whiteSpace) && style.whiteSpace !== 'break-spaces') continue
          break
        case 'open-tag':
          if (openTagCount === 0) newEnd = index
          openTagCount++
          continue
        case 'close-tag':
          if (openTagCount > 0) openTagCount--
          continue
        case 'atomic':
          break
      }
      if (openTagCount > 0) index = newEnd
      this.state = 'done'
      this.rewind(index)
      return
    }
    if (openTagCount > 0) {
      this.state = 'done'
      this.rewind(newEnd)
      return
    }
    this.trailingWhitespace = 'unknown'
    this.position = this.computeWidth()
    this.state = 'done'
    if (this.atEnd()) this.isLastLine = true
  }

  // Rewind (line_breaker.cc:4422-4497).
  rewind(newEnd: number): void {
    if (newEnd > 0) {
      this.moveToNextOfResult(this.results[newEnd - 1]!)
      this.trailingWhitespace = 'unknown'
      while (!this.atEnd() && this.items[this.current.itemIndex]!.type === 'text' && this.items[this.current.itemIndex]!.start === this.items[this.current.itemIndex]!.end) {
        this.handleEmptyText()
      }
    } else {
      this.current = { itemIndex: this.token.itemIndex, textOffset: this.token.textOffset }
      this.trailingWhitespace = 'leading'
    }
    this.setCurrentStyle(this.computeCurrentStyle(newEnd))
    this.results.length = newEnd
    if (this.hyphenIndex !== null && this.hyphenIndex >= newEnd) this.hyphenIndex = null
    if (this.hyphenIndex === null && this.hasAnyHyphens) this.restoreLastHyphen()
    this.position = this.computeWidth()
  }

  // ComputeCurrentStyle (line_breaker.cc:4502-4533).
  computeCurrentStyle(index: number): number {
    if (index < this.results.length) {
      const item = this.items[this.results[index]!.itemIndex]!
      if (item.type === 'text' || item.type === 'close-tag') return item.style
    }
    while (index > 0) {
      const item = this.items[this.results[--index]!.itemIndex]!
      if (item.type === 'text' || item.type === 'open-tag') return item.style
      if (item.type === 'close-tag') return this.style(item.style).parent
    }
    return this.token.style
  }

  // TruncateLineEndResult (line_breaker.cc:2371-2405): the end is reshaped when the line needs an accurate end position
  // and the offset isn't safe to break.
  truncateLineEndResult(r: ItemResult, endOffset: number): View {
    const item = this.items[r.itemIndex]!
    const view = r.shape!
    if (!this.needsAccurateEndPosition(item)) return truncateView(this.sh, view, r.start, endOffset)
    const sr = this.shapeResultOf(r.itemIndex)
    const lastSafe = previousSafeToBreak(this.sh, sr, endOffset)
    if (lastSafe === endOffset || lastSafe <= r.start) return truncateView(this.sh, view, r.start, endOffset)
    const endResult = reshape(this.sh, item.group, Math.max(lastSafe, r.start), endOffset)
    return viewFromSegments(this.sh, view.rtl, [{ kind: 'view', view, start: r.start, end: lastSafe }, { kind: 'reshape', call: endResult.call, start: 0, end: endOffset }])
  }

  // RemoveTrailingCollapsibleSpace with ComputeTrailingCollapsibleSpaceHelper (line_breaker.cc:2562-2747,
  // specs/blink-gaps.md §4.5).
  removeTrailingCollapsibleSpace(): void {
    if (!this.isForcedBreak) this.rewindTrailingOpenTags()
    switch (this.trailingWhitespace) {
      case 'leading': case 'none': case 'collapsed': case 'preserved': return
      case 'unknown': case 'collapsible': break
    }
    this.trailingWhitespace = 'none'
    for (let i = this.results.length - 1; i >= 0; i--) {
      const r = this.results[i]!
      const item = this.items[r.itemIndex]!
      if (item.endCollapseType === 'opaque-to-collapsing') continue
      switch (item.type) {
        case 'text': {
          if (r.end === r.start) continue
          const last = this.char(r.end - 1)
          if (last === 0x3000) { this.trailingWhitespace = 'preserved'; return }
          if (!isSpaceLB(last)) return
          if (preservesSpaces(this.style(item.style))) { this.trailingWhitespace = 'preserved'; return }
          if (r.shape === null) return
          this.position -= r.inlineSize
          r.trimmedEnd = r.end
          if (r.end - 1 > r.start) {
            r.shape = this.truncateLineEndResult(r, r.end - 1)
            r.end--
            r.inlineSize = luCeil(r.shape.width)
          } else {
            r.end = r.start
            r.shape = null
            r.inlineSize = 0
          }
          this.position += r.inlineSize
          this.trailingWhitespace = 'collapsed'
          return
        }
        case 'control':
          if (item.control === 'forced-break') continue
          this.trailingWhitespace = 'preserved'
          return
        case 'open-tag': case 'close-tag': case 'atomic':
          return
      }
    }
  }

  // RewindTrailingOpenTags (line_breaker.cc:2536-2560).
  rewindTrailingOpenTags(): void {
    for (let i = this.results.length - 1; i >= 0; i--) {
      if (this.items[this.results[i]!.itemIndex]!.type !== 'open-tag') {
        if (i + 1 < this.results.length) {
          const end = this.results[i + 1]!
          const index = { itemIndex: end.itemIndex, textOffset: end.start }
          this.rewind(i + 1)
          this.current = index
        }
        return
      }
    }
  }

  // SplitTrailingBidiPreservedSpace (line_breaker.cc:2749-2853, specs/blink-gaps.md §4.7).
  splitTrailingBidiPreservedSpace(): void {
    if (this.trailingWhitespace !== 'collapsed' && this.trailingWhitespace !== 'preserved') return
    const p = this.sh.p
    if (!p.bidiEnabled) return
    for (let index = this.results.length - 1; index >= 0; index--) {
      const r = this.results[index]!
      const item = this.items[r.itemIndex]!
      if (r.hasOnlyBidiTrailingSpaces || item.endCollapseType === 'opaque-to-collapsing' || item.control === 'forced-break') continue
      if (item.type !== 'text' && item.type !== 'control') return
      if (r.end === r.start) { r.hasOnlyBidiTrailingSpaces = true; continue }
      let i = r.end
      while (i > r.start && (isSpaceLB(this.char(i - 1)) || isBidiWhiteSpace(this.char(i - 1)))) i--
      if (i === r.start) { r.hasOnlyBidiTrailingSpaces = true; continue }
      if (i === r.end) return
      if (item.bidiLevel !== p.baseLevel) {
        const previousSize = r.inlineSize
        const view = r.shape!
        const end = r.end
        r.end = i
        r.shape = truncateView(this.sh, view, r.start, i)
        r.inlineSize = luCeil(r.shape.width)
        const spaces: ItemResult = {
          ...r, start: i, end, shape: truncateView(this.sh, view, i, end),
          inlineSize: previousSize - r.inlineSize, hasOnlyBidiTrailingSpaces: true, canBreakAfter: false, hyphen: null, isHyphenated: false, trimmedEnd: -1,
        }
        this.results.splice(index + 1, 0, spaces)
      }
      return
    }
  }
}

// u_charDirection(c) == U_WHITE_SPACE_NEUTRAL (line_breaker.cc:202-204), per code unit.
function isBidiWhiteSpace(c: number): boolean {
  return bidiClassOf(bidiDataFor('blink'), c) === WS
}
