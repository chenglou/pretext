// The WebKit observation port (DESIGN.md §9, research/observe-webkit.md): the rects Safari 27.0 reports for a Range over
// each code point of a run's text node and over each whole node, derived from the engine's display boxes by porting
// WebKit 7625.1.29.11.27's geometry code:
// - RenderText::absoluteQuadsForRange (rendering/RenderText.cpp:761-832): clamp to caretMin/caretMax, whole-box rects,
//   partial rects;
// - selectionRectForTextBox (:352-396) with TextBoxSelectableRange::clamp (rendering/TextBoxSelectableRange.h:40-54),
//   FontCascade::adjustSelectionRectForComplexText (platform/graphics/FontCascade.cpp:1668-1681) and snappedSelectionRect
//   (rendering/LegacyInlineTextBox.cpp:146-160, platform/graphics/LayoutRect.cpp:206-213);
// - FloatQuad::boundingBox for whole-box widths (platform/graphics/FloatQuad.cpp:90-99).
// It imports types from rebuild/src/model.ts only, so no expected value comes from the library (TEST-ARCHITECTURE.md §0
// rule 1, DESIGN.md §8.1). y and height are outside the contract (DESIGN.md §9).
import type {
  CanvasMeasure, Expected, ExpectedObservation, ExpectedRect, GapName, ObservationPort, Paragraph, UnobservableFact, WebKitDisplayBox,
  WebKitLayout,
} from '../../src/model.ts'

const f32 = Math.fround

type Settings = Parameters<CanvasMeasure>[0]

// A display box with its engine line.
type OwnBox = { box: WebKitDisplayBox; line: number }

// LayoutUnit(float) (platform/LayoutUnit.h:83-88): the value times 64 in float, truncated toward zero. In 64ths.
function toLayoutUnit(v: number): number {
  return Math.trunc(f32(v * 64))
}

// LayoutUnit::fromFloatCeil (platform/LayoutUnit.h:93-96). In 64ths.
function toLayoutUnitCeil(v: number): number {
  return Math.ceil(f32(v * 64))
}

// What the port knows about a paragraph: the Canvas settings of each run's box and the white-space facts the complex text
// controller reads.
type RunCanvas = { context: Settings; plain: Settings; letterSpacing: number; wordSpacing: number }
type Port = {
  paragraph: Paragraph
  measure: CanvasMeasure
  runs: RunCanvas[]
  allowTabs: boolean
  tabSize: number
  // Page zoom other than 1, or not given: inverseFrameScale isn't ported (research/observe-webkit.md U8).
  zoomGap: boolean
}

// The Canvas stand-in for a box's in-context shaping: the same OffscreenCanvas settings layout measures with (font at the
// CSS size times page zoom, letter spacing, no locale, no word spacing).
function runCanvas(paragraph: Paragraph, run: number, zoom: number): RunCanvas {
  const r = paragraph.runs[run]!
  const size = f32(f32(r.font.size) * f32(zoom))
  const letterSpacing = f32(f32(r.letterSpacing) * f32(zoom))
  const context: Settings = {
    font: `${r.font.style} ${r.font.weight} ${String(size)}px ${r.font.family}`, lang: '', letterSpacing: `${letterSpacing}px`,
    wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '',
  }
  return { context, plain: { ...context, letterSpacing: '0px' }, letterSpacing, wordSpacing: f32(f32(r.wordSpacing) * f32(zoom)) }
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

// ComplexTextController::advance(offset)'s runWidthSoFar over the box's rendered text (ComplexTextController.cpp:577-668,
// 740-800), from Canvas: prefix totals, a TAB's tab stop from the TextRun's xPos plus the advance so far
// (FontCascade::tabWidth, FontCascadeInlines.h:76-94) with letter spacing after it, and word spacing after SPACE, LF and
// NBSP past index 0. Canvas measures the prefix alone, where the controller shapes the box once (gap in-word-prefix).
function advanceTo(port: Port, canvas: RunCanvas, rendered: string, offset: number, xPos: number): number {
  let width = 0
  let segmentStart = 0
  for (let i = 0; i <= offset; i++) {
    if (i < offset && !(port.allowTabs && rendered.charCodeAt(i) === 0x09)) continue
    if (i > segmentStart) width = f32(width + port.measure(canvas.context, canvasText(rendered.slice(segmentStart, i))))
    if (i < offset) {
      const space = port.measure(canvas.plain, ' ')
      const base = f32(port.tabSize * space)
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
      const treatAsSpace = c === 0x20 || c === 0x0a || c === 0xa0 || (c === 0x09 && !port.allowTabs)
      if (treatAsSpace && (i > 0 || c === 0xa0)) width = f32(width + canvas.wordSpacing)
    }
  }
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

// The whole-box branch (RenderText.cpp:815-831): the display box's float rect.
function wholeBoxRect(port: Port, own: OwnBox): ExpectedRect {
  const rect = boundingBox(own.box.x, own.box.width)
  return { line: own.line, x: predicted(port, rect.x), width: predicted(port, rect.width) }
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
    const text = layout.lines[own.line]!.geometry
    const canvas = port.runs[b.run]!
    const rendered = port.paragraph.runs[b.run]!.text.slice(b.start, b.end) + (b.hyphen ?? '')
    const rtl = b.level % 2 === 1
    // InlineIteratorBoxModernPathInlines.h:38-66: xPos from the content box edge, with the alignment offset (0) removed.
    const xPos = rtl ? f32(text.lineBoxWidth - f32(b.x + b.width)) : b.x
    const before = advanceTo(port, canvas, rendered, clampedStart, xPos)
    const after = advanceTo(port, canvas, rendered, clampedEnd, xPos)
    if (rtl) {
      const total = advanceTo(port, canvas, rendered, renderedLength, xPos)
      x64 += toLayoutUnit(f32(total - after))
      xKnown = clampedEnd === renderedLength
    } else {
      x64 += toLayoutUnit(before)
      xKnown = clampedStart === 0
    }
    width64 = toLayoutUnitCeil(f32(after - before))
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
  const canvas = port.runs[b.run]!
  const xOnBoxEdge = xKnown && (widthKnown || (canvas.letterSpacing >= 0 && canvas.wordSpacing >= 0))
  return {
    line: own.line,
    x: xOnBoxEdge ? predicted(port, rect.x) : limited(port, gap, rect.x),
    width: xKnown && widthKnown ? predicted(port, rect.width) : limited(port, gap, rect.width),
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
      rects.push(wholeBoxRect(port, b))
      continue
    }
    const rect = partialRect(port, layout, b, k + 1 < own.length ? own[k + 1]! : null, k === own.length - 1, s, e)
    if (rect !== null) rects.push(rect)
  }
  return rects
}

export const observeWebKit: ObservationPort<WebKitLayout> = (paragraph, layout, measure) => {
  const zoom = layout.env.pageZoom ?? 1
  const port: Port = {
    paragraph, measure, runs: [],
    allowTabs: paragraph.whiteSpace !== 'normal' && paragraph.whiteSpace !== 'nowrap' && paragraph.whiteSpace !== 'pre-line' && paragraph.tabSize !== 0,
    tabSize: paragraph.tabSize,
    zoomGap: layout.env.pageZoom !== 1,
  }
  for (let r = 0; r < paragraph.runs.length; r++) port.runs.push(runCanvas(paragraph, r, zoom))
  // InlineIterator::textBoxesFor: a node's boxes in box index order, line then visual order
  // (LayoutIntegrationLineLayout.cpp:1048-1059, InlineIteratorTextBox.cpp:71-102).
  const own: OwnBox[][] = []
  for (let r = 0; r < paragraph.runs.length; r++) own.push([])
  for (let l = 0; l < layout.lines.length; l++) {
    const boxes = layout.lines[l]!.geometry.boxes
    for (let k = 0; k < boxes.length; k++) own[boxes[k]!.run]!.push({ box: boxes[k]!, line: l })
  }
  const nodes: ExpectedRect[][] = []
  const codePoints: ExpectedObservation['codePoints'] = []
  let runStart = 0
  for (let r = 0; r < paragraph.runs.length; r++) {
    const text = paragraph.runs[r]!.text
    const boxes = own[r]!
    const nodeRects: ExpectedRect[] = []
    for (let k = 0; k < boxes.length; k++) nodeRects.push(wholeBoxRect(port, boxes[k]!))
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
    if (line.geometry.hangingWidth !== 0) {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.hangingWidth`, rule: 'under text-align: start the alignment offset is 0 whatever hangs (InlineFormattingUtils.cpp:198-270), and hanging white space stays inside its box (InlineLine.cpp:198-233)' })
    }
    if (paragraph.direction === 'ltr') {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.contentLogicalRight`, rule: 'only an RTL line reads it, for its content edge (InlineDisplayLineBuilder.cpp:136-138)' })
    }
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'hyphen': {
          const canvas = port.runs[fragment.run]!
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
        case 'text':
        case 'trimmed':
        case 'hanging':
        case 'forced-break':
          break
      }
    }
  }
  return { codePoints, nodes, unobservable }
}
