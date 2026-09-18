// The WebKit observation port (DESIGN.md §9, research/observe-webkit.md): the rects Safari 27.0 reports for a Range over
// each code point of a text leaf's node, over each whole node, and for Element.getClientRects() of each element, derived from
// the engine's display boxes by porting WebKit 7625.1.29.11.27's geometry code:
// - RenderText::absoluteQuadsForRange (rendering/RenderText.cpp:761-832): clamp to caretMin/caretMax, whole-box rects,
//   partial rects;
// - selectionRectForTextBox (:352-396) with TextBoxSelectableRange::clamp (rendering/TextBoxSelectableRange.h:40-54),
//   FontCascade::adjustSelectionRectForComplexText (platform/graphics/FontCascade.cpp:1668-1681) and snappedSelectionRect
//   (rendering/LegacyInlineTextBox.cpp:146-160, platform/graphics/LayoutRect.cpp:206-213);
// - FloatQuad::boundingBox for whole-box widths (platform/graphics/FloatQuad.cpp:90-99);
// - RenderInline::absoluteQuads (rendering/RenderInline.cpp:237-241) over the span's inline boxes, one per line, and
//   RenderLineBreak::absoluteQuads (rendering/RenderLineBreak.cpp:97-105) over the <br>'s line break box; an atomic inline's
//   border box. A <wbr> has no display box (InlineDisplayContentBuilder.cpp:527-528), so boxFor finds none and it reports
//   nothing.
// It imports types from rebuild/src/model.ts only, so no expected value comes from the library (TEST-ARCHITECTURE.md §0
// rule 1, DESIGN.md §8.1), and walks the inline tree itself. y and height are outside the contract (DESIGN.md §9).
//
// States (DESIGN.md §9). A value is reported as predicted only where no gap the layout reports can move it, and a gap moves
// more than the characters it names:
// - a line's break rests on every width the line measured, its own content and the content that ended it
//   (LineBuilder::placeInlineAndFloatContent, InlineLineBuilder.cpp; lines.ts lineGaps reports both on the line), so on a
//   line that reports a gap, which text each box holds rests on a stand-in, and so does every width and x on it: a box sits
//   at the line's left plus the alignment offset plus the widths of the runs before it (Line::appendText,
//   InlineLine.cpp:346-440; processNonBidiContent, InlineDisplayContentBuilder.cpp:504-645; a running edge in visual order
//   on a reordered line, :871-1028), an RTL line's left edge and an alignment offset come from the content width
//   (InlineDisplayLineBuilder.cpp:136-138, InlineFormattingUtils.cpp:198-276), a justified line shares out what its content
//   leaves (InlineContentAligner.cpp:230-266), and a reported width is f32(f32(x + width) - x) (FloatQuad::boundingBox);
// - the next line starts where the line ended (leadingInlineItemPositionForNextLine, InlineFormattingUtils.cpp:278-298), so
//   the lines after such a line are limited by the same gap, up to a forced break, after which a line starts at the same
//   item whatever came before. With line slots the rows shift with the line count, so nothing starts over there, and a slot
//   the engine refused on a gap (BelowFloats.gaps) moves every line after it;
// - a paragraph gap concerns the lines its range meets, and every line without a range.
// The width of a soft line break's box and of a <br>'s stays predicted: it is 0 by rule, wherever the box sits.
import type { GapName, InlineNode, Paragraph, TextStyle, WebKitDisplayBox, WebKitTextBox } from '../../src/model.ts'
import type { WebKitLayout } from '../types.ts'
import type { CanvasMeasure, CanvasSettings, Expected, ExpectedObservation, ExpectedRect, ObservationPort, UnobservableFact } from './contract.ts'

const f32 = Math.fround

type Limit = GapName | null

// A text display box with its engine line and the gap that limits the line's values, if any.
type OwnBox = { box: WebKitTextBox; line: number; limit: Limit }

// LayoutUnit(float) (platform/LayoutUnit.h:83-88): the value times 64 in float, truncated toward zero. In 64ths.
function toLayoutUnit(v: number): number {
  return Math.trunc(f32(v * 64))
}

// LayoutUnit::fromFloatCeil (platform/LayoutUnit.h:93-96). In 64ths.
function toLayoutUnitCeil(v: number): number {
  return Math.ceil(f32(v * 64))
}

// What the port knows about a leaf: the Canvas settings of its box and the white-space facts the complex text controller
// reads, from the style the leaf takes from its parent.
type LeafCanvas = { text: string; context: CanvasSettings; plain: CanvasSettings; letterSpacing: number; wordSpacing: number; allowTabs: boolean; tabSize: number }
type Port = {
  paragraph: Paragraph
  measure: CanvasMeasure
  leaves: LeafCanvas[]
  // Page zoom other than 1, or not given: inverseFrameScale isn't ported (research/observe-webkit.md U8).
  zoomGap: boolean
}

// The inline tree in document order: each text leaf with its parent's style, and each element's kind.
function walkTree(paragraph: Paragraph): { leaves: { text: string; style: TextStyle }[]; elements: InlineNode['kind'][] } {
  const leaves: { text: string; style: TextStyle }[] = []
  const elements: InlineNode['kind'][] = []
  const visit = (nodes: readonly InlineNode[], style: TextStyle) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      switch (node.kind) {
        case 'text':
          leaves.push({ text: node.text, style })
          break
        case 'span':
          elements.push('span')
          visit(node.children, node)
          break
        case 'atomic':
        case 'br':
        case 'wbr':
          elements.push(node.kind)
          break
      }
    }
  }
  visit(paragraph.content, paragraph)
  return { leaves, elements }
}

// The Canvas stand-in for a box's in-context shaping: the same OffscreenCanvas settings layout measures with (font at the
// CSS size times page zoom, letter spacing, no locale, no word spacing). `family` is the list the layout measured the leaf's
// boxes with (WebKitTextBox.canvasFamily), which names the families the locale resolves generic keywords to.
function leafCanvas(text: string, style: TextStyle, family: string, zoom: number): LeafCanvas {
  const size = f32(f32(style.font.size) * f32(zoom))
  const letterSpacing = f32(f32(style.letterSpacing) * f32(zoom))
  const context: CanvasSettings = {
    font: `${style.font.style} ${style.font.weight} ${String(size)}px ${family}`, lang: '', letterSpacing: `${letterSpacing}px`,
    wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '',
  }
  return {
    text, context, plain: { ...context, letterSpacing: '0px' }, letterSpacing, wordSpacing: f32(f32(style.wordSpacing) * f32(zoom)),
    // TextRun::setTabSize(!collapseWhiteSpace && tabSize != 0) (TextUtil.cpp:91-92).
    allowTabs: style.whiteSpace !== 'normal' && style.whiteSpace !== 'nowrap' && style.whiteSpace !== 'pre-line' && style.tabSize !== 0,
    tabSize: style.tabSize,
  }
}

// Canvas turns U+0009-U+000D into spaces; the complex text controller gives VT, FF and other Cc the .notdef advance, which
// Canvas gives for U+0001, and CR none, which Canvas gives for U+0000 (ComplexTextController.cpp:773-782,
// FontCascadeInlines.h:160-175; probes-safari webkit-canvas H8, H10).
function canvasText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out += c === 0x0d ? String.fromCharCode(0) : c === 0x0b || c === 0x0c ? String.fromCharCode(1) : text[i]!
  }
  return out
}

// FontCascade::treatAsSpace (platform/graphics/FontCascadeInlines.h:140-143).
function treatAsSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0
}

// FontCascade::isCJKIdeographOrSymbol (platform/graphics/FontCascade.cpp:974-1196), canExpandAroundIdeographsInComplexText being
// true on Cocoa (cocoa/FontCascadeCocoaInlines.h:34-37).
const CJK_SYMBOLS = new Set([
  0x2c7, 0x2ca, 0x2cb, 0x2d9, 0x2ea, 0x2eb, 0x2020, 0x2021, 0x2030, 0x203b, 0x203c, 0x2042, 0x2047, 0x2048, 0x2049, 0x2051, 0x20dd,
  0x20de, 0x2100, 0x2103, 0x2105, 0x2109, 0x210a, 0x2113, 0x2116, 0x2121, 0x212b, 0x213b, 0x2150, 0x2151, 0x2152, 0x217f, 0x2189,
  0x2307, 0x2312, 0x23be, 0x23bf, 0x23ce, 0x2423, 0x25a0, 0x25a1, 0x25a2, 0x25aa, 0x25ab, 0x25b1, 0x25b2, 0x25b3, 0x25b6, 0x25b7,
  0x25bc, 0x25bd, 0x25c0, 0x25c1, 0x25c6, 0x25c7, 0x25c9, 0x25cb, 0x25cc, 0x25ef, 0x2605, 0x2606, 0x260e, 0x2616, 0x2617, 0x2640,
  0x2642, 0x26a0, 0x26bd, 0x26be, 0x2713, 0x271a, 0x273f, 0x2740, 0x2756, 0x2b1a, 0xfe10, 0xfe11, 0xfe12, 0xfe19, 0x1f100,
])
function isCJKIdeographOrSymbol(c: number): boolean {
  if (CJK_SYMBOLS.has(c)) return true
  if ((c >= 0x2156 && c <= 0x215a) || (c >= 0x2160 && c <= 0x216b) || (c >= 0x2170 && c <= 0x217b) || (c >= 0x23c0 && c <= 0x23cc)) return true
  if ((c >= 0x2460 && c <= 0x2492) || (c >= 0x249c && c <= 0x24ff) || (c >= 0x25ce && c <= 0x25d3) || (c >= 0x25e2 && c <= 0x25e6)) return true
  if ((c >= 0x2600 && c <= 0x2603) || (c >= 0x2660 && c <= 0x266f) || (c >= 0x2672 && c <= 0x267d) || (c >= 0x2776 && c <= 0x277f)) return true
  if ((c >= 0x2ff0 && c <= 0x2fff) || (c >= 0x3000 && c < 0x3030) || (c > 0x3030 && c <= 0x303f)) return true
  if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff) || (c >= 0x3100 && c <= 0x312f) || (c >= 0x3190 && c <= 0x319f) || (c >= 0x31a0 && c <= 0x31bf)) return true
  if ((c >= 0x3200 && c <= 0x32ff) || (c >= 0x3300 && c <= 0x33ff) || (c >= 0xf860 && c <= 0xf862) || (c >= 0xfe30 && c <= 0xfe4f)) return true
  if (c === 0xff0d || c === 0xff1b || c === 0xff1c || c === 0xff1e) return false
  if (c >= 0xff00 && c <= 0xffef) return true
  if ((c >= 0x1f110 && c <= 0x1f129) || (c >= 0x1f130 && c <= 0x1f149) || (c >= 0x1f150 && c <= 0x1f169) || (c >= 0x1f170 && c <= 0x1f189) || (c >= 0x1f200 && c <= 0x1f6c5)) return true
  return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x2e80 && c <= 0x2eff) || (c >= 0x2f00 && c <= 0x2fdf)
    || (c >= 0x31c0 && c <= 0x31ef) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2a6df) || (c >= 0x2a700 && c <= 0x2b73f)
    || (c >= 0x2b740 && c <= 0x2b81f) || (c >= 0x2b820 && c <= 0x2ceaf) || (c >= 0x2ceb0 && c <= 0x2ebef) || (c >= 0x2ebf0 && c <= 0x2ee5f)
    || (c >= 0x2f800 && c <= 0x2fa1f) || (c >= 0x30000 && c <= 0x3134f) || (c >= 0x31350 && c <= 0x323af)
}

// The expansion each code point's advance holds in a justified box: ComplexTextController::computeExpansionOpportunity
// recounts opportunities over the box's rendered text with its expansion behavior (ComplexTextController.cpp:107-118,
// FontCascade.cpp:1198-1292), and adjustGlyphsAndAdvances hands one share to each side expansionLocation chooses, visiting
// glyphs in visual order, the left side growing the glyph visited before (:673-696, :800-845). One glyph per code point is
// assumed; where a font's glyphs cover several code points the position rests on Canvas anyway (gap in-word-prefix).
function expansionShares(rendered: string, rtl: boolean, box: WebKitTextBox): number[] {
  const shares: number[] = new Array<number>(rendered.length).fill(0)
  if (box.expansion === 0) return shares
  const starts: number[] = []
  for (let i = 0; i < rendered.length; i++) {
    starts.push(i)
    if (rendered.codePointAt(i)! > 0xffff) i++
  }
  // expansionOpportunityCountInternal
  let count = 0
  let isAfterExpansion = box.expansionBehavior.left === 'forbid'
  const logical = rtl ? [...starts].reverse() : starts
  for (let k = 0; k < logical.length; k++) {
    const c = rendered.codePointAt(logical[k]!)!
    if (treatAsSpace(c)) {
      count++
      isAfterExpansion = true
    } else if (isCJKIdeographOrSymbol(c)) {
      if (!isAfterExpansion) count++
      count++
      isAfterExpansion = true
    } else {
      isAfterExpansion = false
    }
  }
  if (isAfterExpansion && box.expansionBehavior.right === 'forbid' && count > 0) count--
  if (count === 0) return shares
  const per = f32(box.expansion / count)
  let afterExpansion = box.expansionBehavior.left === 'forbid'
  let previous: number | null = null
  for (let k = 0; k < logical.length; k++) {
    const i = logical[k]!
    const c = rendered.codePointAt(i)!
    const isFirstCharacter = i === 0
    const isLastCharacter = i + (c > 0xffff ? 2 : 1) === rendered.length
    const forbidLeft = box.expansionBehavior.left === 'forbid' && (rtl ? isLastCharacter : isFirstCharacter)
    const forbidRight = box.expansionBehavior.right === 'forbid' && (rtl ? isFirstCharacter : isLastCharacter)
    const space = treatAsSpace(c)
    const ideograph = isCJKIdeographOrSymbol(c)
    if (space || ideograph) {
      let expandLeft = ideograph
      let expandRight = ideograph
      if (space) {
        if (rtl) expandLeft = true
        else expandRight = true
      }
      if (afterExpansion) expandLeft = false
      if (forbidLeft) expandLeft = false
      if (forbidRight) expandRight = false
      if (expandLeft) shares[previous ?? i] = f32(shares[previous ?? i]! + per)
      if (expandRight) {
        shares[i] = f32(shares[i]! + per)
        afterExpansion = true
      }
    } else {
      afterExpansion = false
    }
    previous = i
  }
  return shares
}

// ComplexTextController::advance(offset)'s runWidthSoFar over the box's rendered text (ComplexTextController.cpp:577-668,
// 740-800), from Canvas: prefix totals, a TAB's tab stop from the TextRun's xPos plus the advance so far
// (FontCascade::tabWidth, FontCascadeInlines.h:76-94) with letter spacing after it, and word spacing after SPACE, LF and
// NBSP past index 0. Canvas measures the prefix alone, where the controller shapes the box once (gap in-word-prefix).
function advanceTo(port: Port, canvas: LeafCanvas, rendered: string, offset: number, xPos: number, shares: number[]): number {
  let width = 0
  let segmentStart = 0
  for (let i = 0; i <= offset; i++) {
    if (i < offset && !(canvas.allowTabs && rendered.charCodeAt(i) === 0x09)) continue
    if (i > segmentStart) width = f32(width + port.measure(canvas.context, canvasText(rendered.slice(segmentStart, i))))
    if (i < offset) {
      const space = port.measure(canvas.plain, ' ')
      const base = f32(canvas.tabSize * space)
      let tab: number
      if (base === 0) {
        tab = canvas.letterSpacing
      } else {
        let remainder = f32(f32(xPos + width) % base)
        if (remainder < 0) remainder = f32(remainder + base)
        tab = f32(base - remainder)
        if (tab < f32(space / 2)) tab = f32(tab + base)
      }
      width = f32(width + tab)
      if (canvas.letterSpacing !== 0) width = f32(width + canvas.letterSpacing)
    }
    segmentStart = i + 1
  }
  if (canvas.wordSpacing !== 0) {
    for (let i = 0; i < offset; i++) {
      const c = rendered.charCodeAt(i)
      const asSpace = c === 0x20 || c === 0x0a || c === 0xa0 || (c === 0x09 && !canvas.allowTabs)
      if (asSpace && (i > 0 || c === 0xa0)) width = f32(width + canvas.wordSpacing)
    }
  }
  for (let i = 0; i < offset && i < shares.length; i++) if (shares[i] !== 0) width = f32(width + shares[i]!)
  return width
}

function predicted(port: Port, value: number): Expected {
  return port.zoomGap ? { state: 'limited', gap: 'page-zoom', value } : { state: 'predicted', value }
}

function limited(port: Port, gap: GapName, value: number): Expected {
  return port.zoomGap ? { state: 'limited', gap: 'page-zoom', value } : { state: 'limited', gap, value }
}

// localToAbsoluteQuad then FloatQuad::boundingBox (platform/graphics/FloatQuad.cpp:90-99): the corners' min and max in
// float, so a rect of negative width (negative letter spacing, glyphs drawn backwards) reports its right corner as x and a
// positive width.
function boundingBox(x: number, width: number): { x: number; width: number } {
  const right = f32(x + width)
  const left = Math.min(x, right)
  return { x: left, width: f32(Math.max(x, right) - left) }
}

function expected(port: Port, limit: Limit, value: number): Expected {
  return limit === null ? predicted(port, value) : limited(port, limit, value)
}

// The whole-box branch (RenderText.cpp:815-831), and any element's display box: its float rect. A soft line break's box and
// a <br>'s are 0 wide by rule (InlineDisplayContentBuilder.cpp:305-341), which no x moves; a text box that measures 0 isn't.
function boxRect(port: Port, line: number, box: { kind?: WebKitDisplayBox['kind']; x: number; width: number }, limit: Limit): ExpectedRect {
  const rect = boundingBox(box.x, box.width)
  const zeroByRule = box.kind === 'soft-line-break' || box.kind === 'line-break'
  return { line, x: expected(port, limit, rect.x), width: expected(port, zeroByRule ? null : limit, rect.width) }
}

// selectionRectForTextBox (RenderText.cpp:352-396) followed by snappedSelectionRect (LegacyInlineTextBox.cpp:146-160) and
// localQuadForTextBox's keep (:722-739). null where the box reports nothing for the range.
function partialRect(port: Port, layout: WebKitLayout, own: OwnBox, next: OwnBox | null, isLast: boolean, start: number, end: number): ExpectedRect | null {
  const b = own.box
  const length = b.end - b.start
  const extra = b.hyphen === null ? 0 : b.hyphen.length
  const clampOffset = (offset: number) => {
    const c = Math.min(Math.max(offset, b.start), b.start + length) - b.start
    return c === length ? c + extra : c
  }
  const clampedStart = clampOffset(start)
  const clampedEnd = clampOffset(end)
  if (clampedStart >= clampedEnd) {
    if (start === end) {
      const withinBox = start >= b.start && start < b.end
      const withinLastBox = start >= b.start && start <= b.end
      if ((isLast && !withinLastBox) || (!isLast && !withinBox)) return null
    } else {
      let withinBox = start >= b.start && start < b.end
      if (!withinBox && start === b.end) withinBox = next !== null && next.box.start > b.end
      if (!withinBox) return null
    }
  }
  const renderedLength = length + extra
  // LayoutRect { 0, y, logicalWidth, height }, in 64ths.
  let x64 = 0
  let width64 = toLayoutUnit(b.width)
  let xKnown = true
  let widthKnown = true
  let gap: GapName = 'in-word-prefix'
  if (clampedStart !== 0 || clampedEnd !== renderedLength) {
    // Partial ranges take the complex path under the lab's font-kerning: auto and text-rendering: auto
    // (FontCascade.cpp:673-731, research/observe-webkit.md §7).
    const geometry = layout.lines[own.line]!.geometry
    const canvas = port.leaves[b.run]!
    const rendered = canvas.text.slice(b.start, b.end) + (b.hyphen ?? '')
    const rtl = b.level % 2 === 1
    // BoxModernPath::textRun (layout/integration/inline/InlineIteratorBoxModernPathInlines.h:38-60): xPos is the box's position
    // from the content box (from its right edge in RTL, against RenderBox::contentBoxWidth, a LayoutUnit) less the display
    // line's contentLogicalLeft, the root inline box's left inside the line box (InlineDisplayLineBuilder.cpp:134-160,
    // InlineLineBoxBuilder.cpp:63, :100): the alignment offset. Tab stops count from the content box edge, past slot insets and
    // text-indent.
    const contentBoxWidth = toLayoutUnit(f32(f32(port.paragraph.width) * f32(layout.env.pageZoom ?? 1))) / 64
    const xPos = rtl ? f32(f32(contentBoxWidth - f32(b.x + b.width)) - geometry.alignmentOffset) : f32(b.x - geometry.alignmentOffset)
    const shares = expansionShares(rendered, rtl, b)
    const before = advanceTo(port, canvas, rendered, clampedStart, xPos, shares)
    const after = advanceTo(port, canvas, rendered, clampedEnd, xPos, shares)
    if (rtl) {
      const total = advanceTo(port, canvas, rendered, renderedLength, xPos, shares)
      x64 += toLayoutUnit(f32(total - after))
      xKnown = clampedEnd === renderedLength
    } else {
      x64 += toLayoutUnit(before)
      xKnown = clampedStart === 0
    }
    // In-context advances are glyph advances with letter and word spacing and justification expansion added
    // (ComplexTextController.cpp:740-845), so a range's advance is at least 0 unless spacing is negative. A Canvas stand-in
    // below 0 (a joining form or fallback font measured on its own) is the stand-in's error, never a rect moved left.
    const leafSpacing = port.leaves[b.run]!
    const standIn = f32(after - before)
    width64 = toLayoutUnitCeil(standIn < 0 && leafSpacing.letterSpacing >= 0 && leafSpacing.wordSpacing >= 0 ? 0 : standIn)
    widthKnown = clampedStart === clampedEnd
    // A range whose Canvas advance is 0: whether the code point has a glyph of its own decides its rect (U3).
    if (clampedEnd > clampedStart && after === before) gap = 'glyph-clusters'
  }
  // selectionRect.move(logicalLeftIgnoringInlineDirection, 0): LayoutUnit arithmetic.
  x64 += toLayoutUnit(b.x)
  // enclosingIntRect: floor the location, ceil the max edge unless the width is 0.
  const snappedX = Math.floor(x64 / 64)
  const snappedMaxX = width64 !== 0 ? Math.ceil((x64 + width64) / 64) : snappedX
  const logicalRight = f32(b.x + b.width)
  let snappedWidth: number
  if (snappedX > logicalRight) snappedWidth = 0
  else if (snappedMaxX > logicalRight) snappedWidth = toLayoutUnit(f32(logicalRight - snappedX)) / 64
  else snappedWidth = snappedMaxX - snappedX
  const rect = boundingBox(snappedX, snappedWidth)
  // The bounding box moves x only for a negative width. In-context advances are glyph advances plus letter and word spacing
  // (ComplexTextController.cpp:740-800), so an unknown width can be negative only under negative spacing.
  const canvas = port.leaves[b.run]!
  const xOnBoxEdge = xKnown && (widthKnown || (canvas.letterSpacing >= 0 && canvas.wordSpacing >= 0))
  // A rect on the box's edge sits where the box does, and a caret is 0 wide, as long as the box holds the text the layout
  // gave it: page-history hands a box other item ends, and a range over a whole box reports the box's float rect, not a
  // snapped one (suite c-4c58dcad97d2cfb6); a collapsed space reports a caret only while it ends its line (runs
  // c-a749f1e7bd879df8, 6px wide natively where the line goes on).
  return {
    line: own.line,
    x: xOnBoxEdge ? expected(port, own.limit, rect.x) : limited(port, gap, rect.x),
    width: xKnown && widthKnown ? expected(port, own.limit, rect.width) : limited(port, gap, rect.width),
  }
}

// RenderText::absoluteQuadsForRange (RenderText.cpp:761-832) without behaviour flags.
function rangeRects(port: Port, layout: WebKitLayout, own: OwnBox[], start: number, end: number): ExpectedRect[] {
  if (own.length === 0) return []
  let caretMin = own[0]!.box.start
  let caretMax = own[0]!.box.end
  for (let k = 1; k < own.length; k++) {
    caretMin = Math.min(caretMin, own[k]!.box.start)
    caretMax = Math.max(caretMax, own[k]!.box.end)
  }
  const s = Math.min(Math.max(caretMin, start), caretMax)
  const e = Math.min(Math.max(caretMin, end), caretMax)
  const rects: ExpectedRect[] = []
  for (let k = 0; k < own.length; k++) {
    const b = own[k]!
    if (s <= b.box.start && b.box.end <= e) {
      rects.push(boxRect(port, b.line, b.box, b.limit))
      continue
    }
    const rect = partialRect(port, layout, b, k + 1 < own.length ? own[k + 1]! : null, k === own.length - 1, s, e)
    if (rect !== null) rects.push(rect)
  }
  return rects
}

function isTextBox(box: WebKitDisplayBox): box is WebKitTextBox {
  return box.kind === 'text' || box.kind === 'soft-line-break'
}

// rule lab/observe/webkit/limited-lines
// Per line, the gap that limits every value on it, or null (the rules are in the file's header).
function lineLimits(layout: WebKitLayout): Limit[] {
  let everywhere: Limit = null
  for (let g = 0; g < layout.gaps.length && everywhere === null; g++) if (layout.gaps[g]!.at === undefined) everywhere = layout.gaps[g]!.gap
  let slotted = layout.belowFloats.length > 0
  for (let l = 0; l < layout.lines.length && !slotted; l++) slotted = layout.lines[l]!.slot.left !== 0 || layout.lines[l]!.slot.right !== 0
  const limits: Limit[] = []
  let moved = everywhere
  // Rows as the library's fillLines counts them: a line box takes one, and so does a refused slot.
  let row = 0
  let refused = 0
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    for (; refused < layout.belowFloats.length && layout.belowFloats[refused]!.row === row; refused++, row++) {
      if (layout.belowFloats[refused]!.gaps.length > 0) moved ??= layout.belowFloats[refused]!.gaps[0]!.gap
    }
    let limit = moved
    if (limit === null && line.gaps.length > 0) limit = line.gaps[0]!.gap
    for (let g = 0; g < layout.gaps.length && limit === null; g++) {
      const at = layout.gaps[g]!.at
      if (at !== undefined && at.start <= line.end && at.end >= line.start) limit = layout.gaps[g]!.gap
    }
    limits.push(limit)
    if (line.hasLineBox) row++
    let forced = false
    for (let f = 0; f < line.fragments.length && !forced; f++) forced = line.fragments[f]!.kind === 'forced-break' || line.fragments[f]!.kind === 'br'
    moved = forced && !slotted ? everywhere : limit
  }
  return limits
}

export const observeWebKit: ObservationPort<WebKitLayout> = (paragraph, layout, measure) => {
  const zoom = layout.env.pageZoom ?? 1
  const tree = walkTree(paragraph)
  const port: Port = { paragraph, measure, leaves: [], zoomGap: layout.env.pageZoom !== 1 }
  // InlineIterator::textBoxesFor: a node's boxes in box index order, line then visual order
  // (LayoutIntegrationLineLayout.cpp:1048-1059, InlineIteratorTextBox.cpp:71-102); inlineBoxesFor likewise for an element.
  const own: OwnBox[][] = []
  for (let r = 0; r < tree.leaves.length; r++) own.push([])
  const elements: ExpectedRect[][] = []
  for (let e = 0; e < tree.elements.length; e++) elements.push([])
  const limits = lineLimits(layout)
  for (let l = 0; l < layout.lines.length; l++) {
    const boxes = layout.lines[l]!.geometry.boxes
    for (let k = 0; k < boxes.length; k++) {
      const box = boxes[k]!
      if (isTextBox(box)) own[box.run]!.push({ box, line: l, limit: limits[l]! })
      // An atomic inline reports its renderer's frame (RenderBox::absoluteQuads, rendering/RenderBox.cpp:694-701), whose
      // location InlineDisplayContentBuilder set from the display box through toLayoutPoint, truncating to a LayoutUnit
      // (InlineDisplayContentBuilder.cpp:632-640, platform/LayoutUnit.h:76-78); its border box width is a LayoutUnit already.
      else if (box.kind === 'atomic') elements[box.element]!.push(boxRect(port, l, { x: toLayoutUnit(box.x) / 64, width: box.width }, limits[l]!))
      else elements[box.element]!.push(boxRect(port, l, box, limits[l]!))
    }
  }
  // A leaf measures with the family list its boxes were measured with; a leaf without a box measures nothing.
  for (let r = 0; r < tree.leaves.length; r++) {
    const leaf = tree.leaves[r]!
    port.leaves.push(leafCanvas(leaf.text, leaf.style, own[r]!.length === 0 ? leaf.style.font.family : own[r]![0]!.box.canvasFamily, zoom))
  }
  const nodes: ExpectedRect[][] = []
  const codePoints: ExpectedObservation['codePoints'] = []
  let runStart = 0
  for (let r = 0; r < tree.leaves.length; r++) {
    const text = tree.leaves[r]!.text
    const boxes = own[r]!
    const nodeRects: ExpectedRect[] = []
    for (let k = 0; k < boxes.length; k++) nodeRects.push(boxRect(port, boxes[k]!.line, boxes[k]!.box, boxes[k]!.limit))
    nodes.push(nodeRects)
    for (let i = 0; i < text.length;) {
      const length = text.codePointAt(i)! > 0xffff ? 2 : 1
      codePoints.push({ offset: runStart + i, length, rects: rangeRects(port, layout, boxes, i, i + length) })
      i += length
    }
    runStart += text.length
  }
  const unobservable: UnobservableFact[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    if (line.geometry.hangingWidth !== 0 && line.align === 'start') {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.hangingWidth`, rule: 'under text-align: start the alignment offset is 0 whatever hangs (InlineFormattingUtils.cpp:198-270), and hanging white space stays inside its box (InlineLine.cpp:198-233)' })
    }
    if (paragraph.direction === 'ltr') {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.contentLogicalRight`, rule: 'only an RTL line reads it, for its content edge (InlineDisplayLineBuilder.cpp:136-138)' })
    }
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'hyphen': {
          const canvas = port.leaves[fragment.run]!
          if (measure(canvas.context, '‐') === measure(canvas.context, '-')) {
            unobservable.push({ line: l, fact: `lines[${l}].fragments[${f}].painted`, rule: 'a box with needsHyphen reports its rendered text through its width and additionalLengthAtEnd (InlineIteratorBoxModernPath.h:76-97); U+2010 and U+002D have equal advances here' })
          }
          break
        }
        case 'collapsed': {
          // A collapsed unit whose Range reports no rect: which line holds it shows nowhere (research/observe-webkit.md U7).
          let reports = false
          for (let c = 0; c < codePoints.length && !reports; c++) {
            const point = codePoints[c]!
            if (point.offset >= fragment.start && point.offset < fragment.end && point.rects.length > 0) reports = true
          }
          if (!reports) {
            unobservable.push({ line: l, fact: `lines[${l}].fragments[${f}]`, rule: 'a Range over a collapsed unit clamps to caretMinOffset and caretMaxOffset and reports only at a box start or after a box end followed by a later box (RenderText.cpp:357-380, 777-783, 2105-2127)' })
          }
          break
        }
        case 'wbr':
          unobservable.push({ line: l, fact: `lines[${l}].fragments[${f}]`, rule: 'a word break opportunity run makes no display box (InlineDisplayContentBuilder.cpp:527-528), so RenderLineBreak::absoluteQuads finds no box (RenderLineBreak.cpp:97-105) and only breaks show the line it sits on' })
          break
        case 'text':
        case 'trimmed':
        case 'hanging':
        case 'forced-break':
        case 'box-start':
        case 'box-end':
        case 'atomic':
        case 'br':
          break
      }
    }
    for (let k = 0; k < line.geometry.boxes.length; k++) {
      const box = line.geometry.boxes[k]!
      if (box.kind !== 'atomic') continue
      unobservable.push({ line: l, fact: `lines[${l}].geometry.boxes[${k}] margins`, rule: 'an atomic inline reports its border box (InlineDisplayContentBuilder.cpp:344-371); its margins show only in its neighbours\' positions' })
    }
  }
  return { codePoints, nodes, elements, unobservable }
}
