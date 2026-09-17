// Blink's observation port (DESIGN.md §9, research/observe-blink.md): what Chrome 153's Range.getClientRects() reports
// for a Range over one code point and over a whole text node, derived from a Blink layout's own geometry by porting
// LayoutText::AbsoluteQuadsForRange (layout_text.cc:556-648) and the code it calls. It imports types from src/model.ts
// only, so no expected value comes from engine logic (research/TEST-ARCHITECTURE.md §0 rule 1).
//
// States (DESIGN.md §9): an edge that is an item edge, a whole item's size, a hyphen's size or a boundary at an item edge
// is predicted. An edge from a caret position inside an item rests on the cluster advances the library took from Canvas
// prefix widths, so it is limited by in-word-prefix. Facts no rect reflects are listed as unobservable with their rule.
// Vertical placement is outside the contract.
import type {
  BlinkGlyphCluster, BlinkItem, BlinkLayout, BlinkMappingUnit, CanvasMeasure, Expected, ExpectedObservation, ExpectedRect, ObservationPort,
  Paragraph, UnobservableFact,
} from '../../src/model.ts'

const f32 = Math.fround

// A quad in raw LayoutUnits from the content box's left edge, with whether each edge comes from an item edge.
type Quad = { line: number; left: number; right: number; leftExact: boolean; rightExact: boolean }

type TextItem = Extract<BlinkItem, { kind: 'text' | 'tab' }>

// LayoutUnit::FromFloatFloor and FromFloatCeil of a float32 zoomed px value (layout_unit.h:134-142).
function floor64(v: number): number {
  return Math.floor(f32(f32(v) * 64))
}

function ceil64(v: number): number {
  return Math.ceil(f32(f32(v) * 64))
}

// The reported CSS px of a raw LayoutUnit edge: LayoutUnit::ToFloat, then Document::AdjustQuadsForScrollAndAbsoluteZoom
// scales by 1 / LayoutZoomFactor as a float (layout_unit.h:244-246, adjust_for_absolute_zoom.h:109-115).
function css(raw: number, zoom: number): number {
  return f32(f32(raw / 64) * f32(1 / zoom))
}

function predicted(value: number): Expected {
  return { state: 'predicted', value }
}

function limited(value: number): Expected {
  return { state: 'limited', gap: 'in-word-prefix', value }
}

// DOMRect::FromRectF(quad.BoundingBox()): x is the left edge, width the float difference of the edges.
function rectOf(q: Quad, zoom: number): ExpectedRect {
  const left = css(q.left, zoom)
  const width = f32(css(q.right, zoom) - left)
  return {
    line: q.line,
    x: q.leftExact ? predicted(left) : limited(left),
    width: q.leftExact && q.rightExact ? predicted(width) : limited(width),
  }
}

// The grapheme index of text_content offset x inside an item: CharacterBreakIterator's cluster list over the run
// (ShapeResult::EnsureGraphemes, shape_result.cc:196-224), from the clusters' grapheme starts.
function graphemeIndex(item: TextItem, x: number): number {
  let index = -1
  for (let c = 0; c < item.clusters.length; c++) {
    const starts = item.clusters[c]!.graphemeStarts
    for (let i = 0; i < starts.length; i++) {
      if (starts[i]! > x) return index
      index++
    }
  }
  return index
}

// ShapeResultRun::NumGraphemes (shape_result.cc:176-185) over [start, end).
function numGraphemes(item: TextItem, start: number, end: number): number {
  return graphemeIndex(item, end - 1) - graphemeIndex(item, start) + 1
}

// ShapeResult::CaretPositionForOffset (shape_result.cc:735-741, 696-733, 228-349) for an item's shape result as one run:
// float32 zoomed px from the item's left edge.
function caret(item: TextItem, offset: number, adjust: 'start' | 'end'): number {
  const rtl = (item.level & 1) === 1
  const clusters = item.clusters
  let total = 0
  for (let c = 0; c < clusters.length; c++) total += clusters[c]!.advance
  if (offset === item.textEnd) return rtl ? 0 : f32(total / 65536)
  let index = 0
  while (!(clusters[index]!.textStart <= offset && offset < clusters[index]!.textEnd)) index++
  const cluster: BlinkGlyphCluster = clusters[index]!
  // The advances of the glyph clusters to its left in visual order.
  let accumulated = 0
  if (rtl) for (let c = index + 1; c < clusters.length; c++) accumulated += clusters[c]!.advance
  else for (let c = 0; c < index; c++) accumulated += clusters[c]!.advance
  let advance = cluster.advance
  let atStart = offset === cluster.textStart
  const graphemes = cluster.graphemeStarts.length
  if (graphemes > 1) {
    const next = offset + 1
    const toOffset = numGraphemes(item, cluster.textStart, next) - 1
    if (offset > item.textStart) atStart = numGraphemes(item, offset - 1, next) !== 1
    advance = Math.trunc(advance / graphemes)
    accumulated += advance * (rtl ? graphemes - toOffset - 1 : toOffset)
  }
  if (!atStart && adjust === 'end') accumulated += rtl ? -advance : advance
  if (rtl) accumulated += advance
  return f32(accumulated / 65536)
}

// FragmentItem::LocalRect with LineLeftAndRightForOffsets (fragment_item.cc:1201-1235, 1132-1199), relative to the item.
function localRect(item: BlinkItem, a: number, b: number, rtlStyle: boolean): { left: number; right: number; leftExact: boolean; rightExact: boolean } {
  switch (item.kind) {
    case 'hyphen':
      return { left: 0, right: item.inlineSize, leftExact: true, rightExact: true }
    case 'forced-break': {
      if (a === item.textStart && b === item.textEnd) return { left: 0, right: item.inlineSize, leftExact: true, rightExact: true }
      // Flow control without a shape result: 0 or the item's size, 0 in an RTL style.
      const s = a === item.textStart || rtlStyle ? 0 : item.inlineSize
      const e = b === item.textStart || rtlStyle ? 0 : item.inlineSize
      return { left: Math.min(s, e), right: Math.max(s, e), leftExact: true, rightExact: true }
    }
    case 'text': case 'tab': {
      if (a === item.textStart && b === item.textEnd) return { left: 0, right: item.inlineSize, leftExact: true, rightExact: true }
      const fs = caret(item, a, 'start')
      const fe = caret(item, b, 'end')
      // LayoutUnit::FromFloatEncompassRound (layout_unit.h:164-184).
      let s: number
      let e: number
      let sCeil: boolean
      let eCeil: boolean
      if (fs < fe) { s = floor64(fs); e = ceil64(fe); sCeil = false; eCeil = true } else if (fs > fe) { s = ceil64(fs); e = floor64(fe); sCeil = true; eCeil = false } else { s = floor64(fs); e = s; sCeil = false; eCeil = false }
      const sExact = edgeExact(item, a, sCeil)
      const eExact = edgeExact(item, b, eCeil)
      return s <= e ? { left: s, right: e, leftExact: sExact, rightExact: eExact } : { left: e, right: s, leftExact: eExact, rightExact: sExact }
    }
  }
}

// Whether a rounded caret edge is an edge of the item's box, whatever the Canvas advances inside: a caret of 0 (the LTR
// start, the RTL end), or the caret at the other end, the shape result's float width, when it is rounded up to the item's
// size (SnappedWidth, shape_result_view.h:124). Floored, that float edge rests on the advances the library summed
// (the lam-alef ligature a font merges in c-0f4d71d14a32dd6c; float32 sums past 256 zoomed px in c-828626c7b8dcd332).
function edgeExact(item: TextItem, offset: number, ceiled: boolean): boolean {
  const rtl = (item.level & 1) === 1
  const zero = rtl ? offset === item.textEnd : offset === item.textStart
  const full = rtl ? offset === item.textStart : offset === item.textEnd
  return zero || (full && ceiled)
}

// OffsetMapping lookups over one text node's units in DOM order (offset_mapping.cc:278-299, 405-459).
function unitAt(units: BlinkMappingUnit[], o: number): number {
  let found = -1
  for (let i = 0; i < units.length; i++) if (units[i]!.start <= o && units[i]!.end >= o) found = i
  return found
}

function startOfNextNonCollapsed(units: BlinkMappingUnit[], o: number): number | null {
  const from = unitAt(units, o)
  if (from < 0) return null
  for (let i = from; i < units.length; i++) {
    const u = units[i]!
    if (u.end > o && !u.collapsed) return Math.max(o, u.start)
  }
  return null
}

function endOfLastNonCollapsed(units: BlinkMappingUnit[], o: number): number | null {
  const from = unitAt(units, o)
  if (from < 0) return null
  for (let i = from; i >= 0; i--) {
    const u = units[i]!
    if (u.start < o && !u.collapsed) return Math.min(o, u.end)
  }
  return null
}

function textContentOffset(units: BlinkMappingUnit[], o: number): number {
  const u = units[unitAt(units, o)]!
  return u.collapsed ? u.textStart : u.textStart + (o - u.start)
}

// LayoutText::MapDOMOffsetToTextContentOffset (layout_text.cc:511-554).
function mapRange(units: BlinkMappingUnit[], s: number, e: number): [number, number] | null {
  const p = startOfNextNonCollapsed(units, s) ?? endOfLastNonCollapsed(units, s)
  if (p === null) return null
  const ts = textContentOffset(units, p)
  const q = endOfLastNonCollapsed(units, e)
  return [ts, q === null || q <= p ? ts : textContentOffset(units, q)]
}

type ItemRef = { line: number; index: number; item: BlinkItem }

// LayoutText::AbsoluteQuadsForRange (layout_text.cc:556-648) over source offsets [s, e) of one run. `included` collects the
// hyphen items the range reports.
function quadsForRange(units: BlinkMappingUnit[], items: ItemRef[], s: number, e: number, rtlStyle: boolean, included: Set<BlinkItem> | null): Quad[] {
  const mapped = mapRange(units, s, e)
  if (mapped === null) return []
  const [ts, te] = mapped
  const out: Quad[] = []
  const boundary: Quad[] = []
  let lastEndIncluded = false
  for (let i = 0; i < items.length; i++) {
    const { line, item } = items[i]!
    let rect: { left: number; right: number; leftExact: boolean; rightExact: boolean }
    let isBoundary: boolean
    switch (item.kind) {
      case 'hyphen':
        // "Hyphens. Include if the last end was included." (:616-621)
        if (!lastEndIncluded) continue
        rect = localRect(item, 0, 0, rtlStyle)
        isBoundary = false
        if (included !== null) included.add(item)
        break
      case 'text': case 'tab': case 'forced-break': {
        if (ts > item.textEnd || te < item.textStart || (item.kind === 'forced-break' && ts === te)) {
          lastEndIncluded = false
          continue
        }
        lastEndIncluded = item.textEnd <= te
        const a = Math.max(ts, item.textStart)
        const b = Math.min(te, item.textEnd)
        rect = localRect(item, a, b, rtlStyle)
        isBoundary = a >= b
        break
      }
    }
    const quad: Quad = { line, left: item.x + rect.left, right: item.x + rect.right, leftExact: rect.leftExact, rightExact: rect.rightExact }
    if (isBoundary) boundary.push(quad)
    else out.push(quad)
  }
  return out.length > 0 ? out : boundary
}

export const observeBlink: ObservationPort<BlinkLayout> = (paragraph: Paragraph, layout: BlinkLayout, _measure: CanvasMeasure): ExpectedObservation => {
  const zoom = layout.env.devicePixelRatio
  const rtlStyle = paragraph.direction === 'rtl'
  const runCount = paragraph.runs.length
  const runStarts: number[] = []
  for (let r = 0, s = 0; r <= runCount; r++) {
    runStarts.push(s)
    if (r < runCount) s += paragraph.runs[r]!.text.length
  }
  // Per run, its mapping units and its fragment items: lines in order, items in visual order (InlineCursor).
  const units: BlinkMappingUnit[][] = []
  const items: ItemRef[][] = []
  for (let r = 0; r < runCount; r++) { units.push([]); items.push([]) }
  const unobservable: UnobservableFact[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    const g = line.geometry
    for (let i = 0; i < g.mapping.length; i++) units[g.mapping[i]!.run]!.push(g.mapping[i]!)
    for (let i = 0; i < g.items.length; i++) {
      const item = g.items[i]!
      items[item.run]!.push({ line: l, index: i, item })
      if (item.kind === 'text' || item.kind === 'tab') {
        for (let c = 0; c < item.clusters.length; c++) {
          const cluster = item.clusters[c]!
          if (cluster.textEnd - cluster.textStart > cluster.graphemeStarts.length) {
            unobservable.push({ line: l, fact: `lines[${l}].geometry.items[${i}].clusters[${c}].advance`, rule: 'U2: every code point of a grapheme reports its glyph cluster\'s rect or share; how the advance divides among them isn\'t reported (shape_result.cc:228-349)' })
          }
        }
      }
    }
    if (!line.hasLineBox) {
      unobservable.push({ line: l, fact: `lines[${l}]`, rule: 'U8: a line that creates no line box has no fragment items, so no Range reports it (line_breaker.cc:945-975)' })
    }
    if (!rtlStyle && g.hangWidth !== 0) {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.hangWidth`, rule: 'an LTR line starts at 0 whatever hangs: AdjustLineOffsetForHanging returns 0 and text-align: start adds no offset (inline_layout_algorithm.cc:303-311, length_utils.cc:1607-1640)' })
    }
  }
  const nodes: ExpectedRect[][] = []
  const includedHyphens = new Set<BlinkItem>()
  for (let r = 0; r < runCount; r++) {
    const quads = paragraph.runs[r]!.text.length === 0 ? [] : quadsForRange(units[r]!, items[r]!, runStarts[r]!, runStarts[r + 1]!, rtlStyle, includedHyphens)
    nodes.push(quads.map(q => rectOf(q, zoom)))
  }
  const codePoints: ExpectedObservation['codePoints'] = []
  for (let r = 0; r < runCount; r++) {
    const text = paragraph.runs[r]!.text
    for (let k = 0; k < text.length;) {
      const length = text.codePointAt(k)! > 0xffff ? 2 : 1
      const offset = runStarts[r]! + k
      codePoints.push({ offset, length, rects: quadsForRange(units[r]!, items[r]!, offset, offset + length, rtlStyle, includedHyphens).map(q => rectOf(q, zoom)) })
      k += length
    }
  }
  for (let r = 0; r < runCount; r++) {
    for (let i = 0; i < items[r]!.length; i++) {
      const { line, index, item } = items[r]![i]!
      if (item.kind === 'hyphen' && !includedHyphens.has(item)) {
        unobservable.push({ line, fact: `lines[${line}].geometry.items[${index}].inlineSize`, rule: 'U3: a hyphen item is reported only after an included item end of its node, so an odd-level hyphen before its node\'s first item on a line is in no rect (layout_text.cc:616-621)' })
      }
    }
  }
  return { codePoints, nodes, unobservable }
}
