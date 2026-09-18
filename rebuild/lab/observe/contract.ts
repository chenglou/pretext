// The observation contract (DESIGN.md §9): what rebuild/lab/observe/<engine>.ts derives from a layout by porting each
// engine's Range and element geometry code. The library never computes it.
import type { GapName, Paragraph } from '../../src/model.ts'

// One observed number. There is no third state for a rect field: a reported rect is observable by definition.
export type Expected =
  // The ported geometry rule gives the value exactly from engine output. Compared exactly.
  | { state: 'predicted'; value: number }
  // The value rests on a Canvas stand-in for data the engine had, named by the gap: glyph advances inside a word, which
  // code points a glyph covers. Compared exactly; a mismatch is attributed to the gap, never to an engine rule.
  | { state: 'limited'; gap: GapName; value: number }

export type ExpectedRect = {
  // The engine line of the item, box or frame the rect comes from.
  line: number
  // CSS px relative to the paragraph's content box, as the DOMRect reports them after the engine's rounding.
  x: Expected
  width: Expected
}

// An engine output fact that no rect of any kind reflects, by the cited geometry rule: the rects are the same whatever its
// value. Listed, never compared, and never counted as coverage for the rule that computed it.
export type UnobservableFact = {
  line: number
  // A field path into the layout, e.g. 'lines[2].geometry.items[3].inlineSize'.
  fact: string
  // The geometry rule, with its source citation.
  rule: string
}

export type ExpectedObservation = {
  // Per code point of the concatenated leaf text, in order: the rects of a Range over it in its leaf's text node, in the
  // order the engine reports them.
  codePoints: { offset: number; length: number; rects: ExpectedRect[] }[]
  // Per text leaf: the rects of a Range over its whole text node; empty for a leaf without a DOM node.
  nodes: ExpectedRect[][]
  // Per element in document order: Element.getClientRects(). A span reports one rect per box it has on each line (Blink
  // LayoutInline::QuadsForSelfInternal, layout_inline.cc:428-470; WebKit RenderInline::absoluteQuads, RenderInline.cpp:237-241;
  // Gecko nsLayoutUtils::GetAllInFlowRects over its continuations, nsLayoutUtils.cpp:3477-3505, 3661-3667), an atomic
  // inline its border box, a <br> its line break box; the rules for <wbr> are in DESIGN.md §9.
  elements: ExpectedRect[][]
  unobservable: UnobservableFact[]
}

// The settings of the Canvas context a port measures in, as the library declares its own (src/measure/canvas.ts):
// port-measure.ts assigns them, lang before font. `partition` keeps otherwise equal settings on separate canvases.
export type CanvasSettings = {
  font: string
  lang: string
  letterSpacing: string
  wordSpacing: string
  fontKerning: CanvasFontKerning
  textRendering: CanvasTextRendering
  direction: CanvasDirection
  partition: string
}

// Canvas measureText in a context with these settings: live in the page, or answered from a recorded call log.
export type CanvasMeasure = (settings: CanvasSettings, text: string) => number

// `Layout` is the engine's member of the row's layout (types.ts BlinkLayout, WebKitLayout, GeckoLayout).
export type ObservationPort<Layout> = (paragraph: Paragraph, layout: Layout, measure: CanvasMeasure) => ExpectedObservation
