// Blink's observation port (DESIGN.md §9, research/observe-blink.md): what Chrome 153's Range.getClientRects() reports
// for a Range over one code point and over a whole text node, and what Element.getClientRects() reports for each element,
// derived from a Blink layout's own geometry by porting LayoutText::AbsoluteQuadsForRange (layout_text.cc:556-648),
// LayoutInline::QuadsForSelfInternal (layout_inline.cc:428-490) and the code they call. It imports types from
// src/model.ts only and walks the inline tree itself, so no expected value comes from engine logic
// (research/TEST-ARCHITECTURE.md §0 rule 1).
//
// States (DESIGN.md §9). A rect edge is an item's x plus a position inside the item, and the port reports it as predicted
// only where the layout says it knows both:
// - a position inside an item is limited where the layout marks the cluster boundary it rests on as a Canvas stand-in
//   (`BlinkGlyphCluster.startLimit`, the item's `sizeLimit`), and where a gap the layout reports (a gap of the line, or a
//   paragraph gap with a range) meets a character whose advance the position sums: the advances from the item's start in
//   an even-level item, from its end in an odd-level one;
// - an item's size is limited by its `sizeLimit` or by such a gap on any of its characters, and then the x of everything
//   to its right on the line is too (every x on the line where the line's offset depends on its width: an RTL block, or
//   an alignment other than left), since item sizes are ceiled one by one.
// Facts no rect reflects are listed as unobservable with their rule. Vertical placement is outside the contract.
import type {
  BlinkGlyphCluster, BlinkItem, BlinkLayout, BlinkMappingUnit, CanvasMeasure, Expected, ExpectedObservation, ExpectedRect, GapName, InlineNode, ObservationPort,
  Paragraph, UnobservableFact,
} from '../../src/model.ts'

const f32 = Math.fround

// A quad in raw LayoutUnits from the content box's left edge, with the condition each edge is limited by, if any.
type Limit = GapName | null
type Quad = { line: number; left: number; right: number; leftLimit: Limit; rightLimit: Limit }

type TextItem = Extract<BlinkItem, { kind: 'text' | 'tab' }>
type RunItem = Extract<BlinkItem, { kind: 'text' | 'tab' | 'forced-break' | 'hyphen' }>

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

function expected(value: number, limit: Limit): Expected {
  return limit === null ? predicted(value) : { state: 'limited', gap: limit, value }
}

// The layout's paragraph gaps with source ranges, by 64-unit blocks of the offsets they cover: a range [start, end) sits
// in the blocks of units start to end − 1, and an empty range in the block of its offset. A paragraph can report
// thousands of ranged gaps (5,317 `script-context` ranges in a 256,837-unit Arabic suite paragraph), and every code
// point asks for one, so a scan of all of them per code point never finished a held-out suite part.
const GAP_BLOCK = 64
type GapIndex = { gaps: BlinkLayout['gaps']; blocks: Map<number, number[]> }

function gapIndex(layout: BlinkLayout): GapIndex {
  const blocks = new Map<number, number[]>()
  for (let i = 0; i < layout.gaps.length; i++) {
    const at = layout.gaps[i]!.at
    if (at === undefined) continue
    const last = Math.floor((at.start === at.end ? at.start : at.end - 1) / GAP_BLOCK)
    for (let b = Math.floor(at.start / GAP_BLOCK); b <= last; b++) {
      const list = blocks.get(b)
      if (list === undefined) blocks.set(b, [i])
      else list.push(i)
    }
  }
  return { gaps: layout.gaps, blocks }
}

function meets(at: { start: number; end: number } | undefined, s: number, e: number): boolean {
  return at === undefined || (at.start === at.end ? at.start >= s && at.start <= e : at.start < e && at.end > s)
}

// The first gap the layout reports concerning source range [s, e) on a line: a gap of the line, or the first paragraph gap
// whose range meets it (a break offset at either end counts). A range meeting [s, e) covers a unit of it, or unit s when
// s = e, or is empty at an offset in [s, e], so its blocks include one of s's to e's.
function gapConcerning(layout: BlinkLayout, index: GapIndex, line: number, s: number, e: number): GapName | null {
  const lineGaps = line >= 0 && line < layout.lines.length ? layout.lines[line]!.gaps : []
  for (let i = 0; i < lineGaps.length; i++) if (meets(lineGaps[i]!.at, s, e)) return lineGaps[i]!.gap
  let first = -1
  const last = Math.floor(e / GAP_BLOCK)
  for (let b = Math.floor(s / GAP_BLOCK); b <= last; b++) {
    const list = index.blocks.get(b)
    if (list === undefined) continue
    for (let j = 0; j < list.length; j++) {
      const i = list[j]!
      if ((first === -1 || i < first) && meets(index.gaps[i]!.at, s, e)) first = i
    }
  }
  return first === -1 ? null : index.gaps[first]!.gap
}

// DOMRect::FromRectF(quad.BoundingBox()): x is the left edge, width the float difference of the edges. An item of negative
// size (a hanging space under negative spacing: HandleTrailingSpaces doesn't clamp it, line_breaker.cc:2409-2416) reports
// its whole rect from its origin with no width: LocalRectToAbsoluteQuad makes a gfx::RectF of it (layout_text.cc:634-637,
// physical_rect.h:173-175), whose size clamps a negative width to 0 (ui/gfx/geometry/size_f.h:30-31, :108, read in the
// chromium-152 checkout: ui/gfx isn't in the 153 one).
function rectOf(q: Quad, zoom: number): ExpectedRect {
  const left = css(q.left, zoom)
  const width = q.right < q.left ? 0 : f32(css(q.right, zoom) - left)
  return { line: q.line, x: expected(left, q.leftLimit), width: expected(width, q.leftLimit ?? q.rightLimit) }
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

// Per text item, the limit of each cluster boundary's position from the item's left edge: boundary j is the start of
// cluster j, boundary n the item's end. An even-level item sums the advances before the boundary and an odd-level one
// those after it, so a gap on a character carries to every boundary past it in that direction; the layout's own marks
// say which boundaries and whether the item's size are stand-ins.
type ItemLimits = { boundaries: Limit[]; size: Limit }

// The runs of an item's shape in visual order, each with the exact 16.16 sum of its clusters' advances. A tab item's shape
// is one run.
type Run = { textStart: number; textEnd: number; fontsKnown: boolean; first: number; last: number; width16: number }

function runsOf(item: TextItem): Run[] {
  const given = item.kind === 'text' ? item.runs : [{ textStart: item.textStart, textEnd: item.textEnd, fontsKnown: true }]
  const runs: Run[] = []
  let c = 0
  for (let r = 0; r < given.length; r++) {
    const run: Run = { textStart: given[r]!.textStart, textEnd: given[r]!.textEnd, fontsKnown: given[r]!.fontsKnown, first: c, last: c, width16: 0 }
    while (c < item.clusters.length && item.clusters[c]!.textStart < run.textEnd) run.width16 += item.clusters[c++]!.advance
    run.last = c
    runs.push(run)
  }
  return (item.level & 1) === 1 ? runs.reverse() : runs
}

// A float32 sum past 256 px rounds at every addition, by where the runs are. Where the layout doesn't know the runs (a
// font the facts don't name may draw any cluster in a run of its own; Blink's view may have other parts,
// BlinkGlyphCluster.graphemesLimit), each run edge it can't place moves the sum by at most half a float32 step at that
// size, and a value whose LayoutUnit edges that can change is limited.
//
// A float32 holds 24 bits, so sums of multiples of 2^g units of 16.16 are exact below 2^(24 + g) units, wherever the runs
// are: a 2048-unit font at a whole zoomed size of 32 px has advances in multiples of 1024 units, exact below 2^18 px.
function floatLimit(item: TextItem, value: number, unknownEdges: number): Limit {
  if (unknownEdges === 0 || value < 256) return null
  let bits = 0
  for (let c = 0; c < item.clusters.length; c++) {
    const cluster = item.clusters[c]!
    bits |= cluster.advance
    // A caret inside a cluster adds shares of its advance.
    if (cluster.graphemeStarts.length > 1) bits |= Math.trunc(cluster.advance / cluster.graphemeStarts.length)
  }
  const granularity = bits === 0 ? 2 ** 31 : bits & -bits
  if (value * 65536 < 2 ** 24 * granularity) return null
  const slack = unknownEdges * 2 ** (Math.floor(Math.log2(value)) - 23) / 2
  const low = (value - slack) * 64
  const high = (value + slack) * 64
  return Math.floor(low) !== Math.floor(high) || Math.ceil(low) !== Math.ceil(high) ? 'float32-precision' : null
}

// ShapeResult::CaretPositionForOffset (shape_result.cc:735-741) for the ShapeResult the item's view is copied into:
// PositionForOffset (:696-733) adds the widths of the runs visually before the caret's run as floats, each the float of the
// run's exact sum, and XPositionForOffset (:228-349) the position inside the run, exact until it is returned as a float.
// Float32 zoomed px from the item's left edge, and the limit of the boundaries it rests on.
function caret(item: TextItem, limits: ItemLimits, offset: number, adjust: 'start' | 'end'): { value: number; limit: Limit } {
  const rtl = (item.level & 1) === 1
  const clusters = item.clusters
  const runs = runsOf(item)
  const partEdges = item.kind === 'text' && !item.partsKnown ? 2 : 0
  if (offset === item.textEnd) {
    if (rtl) return { value: 0, limit: null }
    let width = 0
    let unknown = partEdges
    for (let r = 0; r < runs.length; r++) {
      width = f32(width + f32(runs[r]!.width16 / 65536))
      if (!runs[r]!.fontsKnown) unknown += runs[r]!.last - runs[r]!.first
    }
    return { value: width, limit: limits.size ?? floatLimit(item, width, unknown) }
  }
  // The runs visually before the one that counts the character as its own.
  let x = 0
  let unknown = partEdges
  let at = 0
  while (at < runs.length && !(runs[at]!.textStart <= offset && offset < runs[at]!.textEnd)) {
    x = f32(x + f32(runs[at]!.width16 / 65536))
    if (!runs[at]!.fontsKnown) unknown += runs[at]!.last - runs[at]!.first
    at++
  }
  // A character no run counts as its own: PositionForOffset walks past every run and returns 0 (:726-732).
  if (at === runs.length) return { value: 0, limit: null }
  const run = runs[at]!
  if (!run.fontsKnown) unknown += run.last - run.first
  let index = run.first
  while (!(clusters[index]!.textStart <= offset && offset < clusters[index]!.textEnd)) index++
  const cluster: BlinkGlyphCluster = clusters[index]!
  // The advances of the run's glyph clusters to its left in visual order.
  let accumulated = 0
  if (rtl) for (let c = index + 1; c < run.last; c++) accumulated += clusters[c]!.advance
  else for (let c = run.first; c < index; c++) accumulated += clusters[c]!.advance
  let advance = cluster.advance
  let atStart = offset === cluster.textStart
  const graphemes = cluster.graphemeStarts.length
  // How many shares of the cluster's advance the position adds to the advances left of the cluster: the graphemes before
  // the offset, one more for an end edge past a grapheme's start, counted from the right in RTL (:296-349).
  let shares = 0
  if (graphemes > 1) {
    const next = offset + 1
    const toOffset = numGraphemes(item, cluster.textStart, next) - 1
    if (offset > run.textStart) atStart = numGraphemes(item, offset - 1, next) !== 1
    advance = Math.trunc(advance / graphemes)
    shares = rtl ? graphemes - toOffset - 1 : toOffset
  }
  if (!atStart && adjust === 'end') shares += rtl ? -1 : 1
  if (rtl) shares += 1
  accumulated += advance * shares
  // Without a share the value rests on the cluster's left boundary alone; with the whole advance of a one-grapheme
  // cluster on its right boundary alone; otherwise on both. A share also rests on how many graphemes Blink counts.
  const left = limits.boundaries[rtl ? index + 1 : index]!
  const right = limits.boundaries[rtl ? index : index + 1]!
  const counted = cluster.graphemesLimit !== undefined && (rtl || offset > cluster.textStart) ? cluster.graphemesLimit : null
  const limit = (shares === 0 ? left : graphemes === 1 ? right : left ?? right) ?? counted
  const value = f32(f32(accumulated / 65536) + x)
  return { value, limit: limit ?? floatLimit(item, value, unknown) }
}

// FragmentItem::LocalRect with LineLeftAndRightForOffsets (fragment_item.cc:1201-1235, 1132-1199), relative to the item.
function localRect(item: RunItem, limits: ItemLimits | null, a: number, b: number, rtlStyle: boolean): { left: number; right: number; leftLimit: Limit; rightLimit: Limit } {
  switch (item.kind) {
    case 'hyphen':
      return { left: 0, right: item.inlineSize, leftLimit: null, rightLimit: null }
    case 'forced-break': {
      if (a === item.textStart && b === item.textEnd) return { left: 0, right: item.inlineSize, leftLimit: null, rightLimit: null }
      // Flow control without a shape result: 0 or the item's size, 0 in an RTL style.
      const s = a === item.textStart || rtlStyle ? 0 : item.inlineSize
      const e = b === item.textStart || rtlStyle ? 0 : item.inlineSize
      return { left: Math.min(s, e), right: Math.max(s, e), leftLimit: null, rightLimit: null }
    }
    case 'text': case 'tab': {
      const size = limits === null ? null : limits.size
      if (a === item.textStart && b === item.textEnd) return { left: 0, right: item.inlineSize, leftLimit: null, rightLimit: size }
      const none: ItemLimits = { boundaries: new Array<Limit>(item.clusters.length + 1).fill(null), size: null }
      const cs = caret(item, limits ?? none, a, 'start')
      const ce = caret(item, limits ?? none, b, 'end')
      const fs = cs.value
      const fe = ce.value
      // LayoutUnit::FromFloatEncompassRound (layout_unit.h:164-184).
      let s: number
      let e: number
      if (fs < fe) { s = floor64(fs); e = ceil64(fe) } else if (fs > fe) { s = ceil64(fs); e = floor64(fe) } else { s = floor64(fs); e = s }
      // Which caret is the rect's left edge follows their order. Where the carets run against the item's direction (a
      // negative advance) and one of them is a stand-in, the order itself rests on it, so both edges do: the advance the port
      // gives a letter a listed ligature may cover can come out negative (Geeza Pro lam before meem, c-38536c357f3a1dc7).
      const rtl = (item.level & 1) === 1
      const against = rtl ? fs < fe : fs > fe
      const either = cs.limit ?? ce.limit
      if (against && either !== null) return s <= e ? { left: s, right: e, leftLimit: either, rightLimit: either } : { left: e, right: s, leftLimit: either, rightLimit: either }
      // Where the carets meet, the left edge is the one the item's direction puts left, the end caret in an RTL item: the
      // port gives Courier New's lam before alef no advance, natively the lam is half the ligature wide, and its left edge
      // is the stand-in caret between the letters (c-82fdb6df09ca942f).
      const startIsLeft = s < e || (s === e && !rtl)
      return startIsLeft ? { left: s, right: e, leftLimit: cs.limit, rightLimit: ce.limit } : { left: e, right: s, leftLimit: ce.limit, rightLimit: cs.limit }
    }
  }
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

// An item of a run with the limits of the positions inside it (text and tab items) and the line's x limit.
type ItemRef = { line: number; index: number; item: RunItem; limits: ItemLimits | null; xLimit: (x: number) => Limit }

// The source range of text_content [t0, t1) of a run on a line, from the line's mapping units; null when no source unit maps
// there (a unit Blink generated).
function sourceRangeOf(mapping: BlinkMappingUnit[], run: number, t0: number, t1: number): [number, number] | null {
  let s = Infinity
  let e = -Infinity
  for (let i = 0; i < mapping.length; i++) {
    const u = mapping[i]!
    if (u.run !== run || u.collapsed || u.textEnd <= t0 || u.textStart >= t1 || u.start === u.end) continue
    s = Math.min(s, u.start + (Math.max(t0, u.textStart) - u.textStart))
    e = Math.max(e, u.start + (Math.min(t1, u.textEnd) - u.textStart))
  }
  return s < e ? [s, e] : null
}

function itemLimits(layout: BlinkLayout, index: GapIndex, line: number, item: TextItem, mapping: BlinkMappingUnit[]): ItemLimits {
  const clusters = item.clusters
  const n = clusters.length
  const rtl = (item.level & 1) === 1
  // The gap the layout reports on each cluster's characters.
  const gapOf: Limit[] = []
  for (let c = 0; c < n; c++) {
    const range = sourceRangeOf(mapping, item.run, clusters[c]!.textStart, clusters[c]!.textEnd)
    gapOf.push(range === null ? null : gapConcerning(layout, index, line, range[0], range[1]))
  }
  const structural = (j: number): Limit => (j < n ? clusters[j]!.startLimit : item.kind === 'text' ? item.sizeLimit : undefined) ?? null
  const boundaries = new Array<Limit>(n + 1).fill(null)
  let carried: Limit = null
  if (!rtl) {
    for (let j = 1; j <= n; j++) {
      carried = carried ?? gapOf[j - 1]!
      boundaries[j] = carried ?? structural(j)
    }
  } else {
    // total − pos(j): the clusters from j on, the boundary itself and the item's end.
    for (let j = n - 1; j >= 0; j--) {
      carried = carried ?? gapOf[j]!
      boundaries[j] = carried ?? structural(j) ?? structural(n)
    }
  }
  let size: Limit = structural(n)
  for (let c = 0; c < n && size === null; c++) size = gapOf[c]!
  return { boundaries, size }
}

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
    const { line, item, limits, xLimit } = items[i]!
    let rect: { left: number; right: number; leftLimit: Limit; rightLimit: Limit }
    let isBoundary: boolean
    switch (item.kind) {
      case 'hyphen':
        // "Hyphens. Include if the last end was included." (:616-621)
        if (!lastEndIncluded) continue
        rect = localRect(item, null, 0, 0, rtlStyle)
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
        rect = localRect(item, limits, a, b, rtlStyle)
        isBoundary = a >= b
        break
      }
    }
    // Every edge also rests on the item's x: the sizes of the items to its left on the line.
    const atItem = xLimit(item.x)
    const quad: Quad = { line, left: item.x + rect.left, right: item.x + rect.right, leftLimit: atItem ?? rect.leftLimit, rightLimit: atItem ?? rect.rightLimit }
    if (isBoundary) boundary.push(quad)
    else out.push(quad)
  }
  return out.length > 0 ? out : boundary
}

// The paragraph's tree in document order: every text leaf with its source offset and the span holding it, and every
// element with its parent span, as DESIGN.md §1.1 indexes them.
type Leaf = { text: string; start: number; parent: number; rank: number }
type Element = { node: Exclude<InlineNode, { kind: 'text' }>; parent: number; rank: number }

function walk(paragraph: Paragraph): { leaves: Leaf[]; elements: Element[]; text: number } {
  const leaves: Leaf[] = []
  const elements: Element[] = []
  let offset = 0
  let rank = 0
  const visit = (nodes: readonly InlineNode[], parent: number): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      if (node.kind === 'text') {
        leaves.push({ text: node.text, start: offset, parent, rank: rank++ })
        offset += node.text.length
        continue
      }
      const index = elements.length
      elements.push({ node, parent, rank: rank++ })
      if (node.kind === 'span') visit(node.children, index)
    }
  }
  visit(paragraph.content, -1)
  return { leaves, elements, text: offset }
}

export const observeBlink: ObservationPort<BlinkLayout> = (paragraph: Paragraph, layout: BlinkLayout, _measure: CanvasMeasure): ExpectedObservation => {
  const zoom = layout.env.devicePixelRatio
  const rtlStyle = paragraph.direction === 'rtl'
  const tree = walk(paragraph)
  const runCount = tree.leaves.length
  // Per run, its mapping units and its fragment items: lines in order, items in visual order (InlineCursor).
  const units: BlinkMappingUnit[][] = []
  const items: ItemRef[][] = []
  for (let r = 0; r < runCount; r++) { units.push([]); items.push([]) }
  // Per element, its own items (inline boxes, atomic inlines, <br>) in line order.
  const elementItems: { line: number; item: BlinkItem }[][] = tree.elements.map(() => [])
  const unobservable: UnobservableFact[] = []
  const paragraphGaps = gapIndex(layout)
  const xLimits: ((x: number) => Limit)[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    const g = line.geometry
    for (let i = 0; i < g.mapping.length; i++) units[g.mapping[i]!.run]!.push(g.mapping[i]!)
    // The limits of every text item's positions and size, then the line's: x values right of the first item of limited
    // size rest on it; every x does where the line's offset depends on the line's width (ApplyTextAlign and the RTL line
    // offset, inline_layout_algorithm.cc:943-970, length_utils.cc:1607-1655).
    const limitsOf = new Map<BlinkItem, ItemLimits>()
    let from = Infinity
    let lineLimit: Limit = null
    for (let i = 0; i < g.items.length; i++) {
      const item = g.items[i]!
      if (item.kind !== 'text' && item.kind !== 'tab') continue
      const limits = itemLimits(layout, paragraphGaps, l, item, g.mapping)
      limitsOf.set(item, limits)
      if (limits.size !== null && item.x < from) { from = item.x; lineLimit = limits.size }
    }
    const leftAnchored = !rtlStyle && (line.align === 'start' || line.align === 'left')
    const limit = lineLimit
    const threshold = from
    const xLimit = (x: number): Limit => limit !== null && (!leftAnchored || x > threshold) ? limit : null
    xLimits.push(xLimit)
    for (let i = 0; i < g.items.length; i++) {
      const item = g.items[i]!
      switch (item.kind) {
        case 'text': case 'tab': case 'forced-break': case 'hyphen':
          items[item.run]!.push({ line: l, index: i, item, limits: limitsOf.get(item) ?? null, xLimit })
          break
        case 'inline-box': case 'atomic': case 'br':
          elementItems[item.element]!.push({ line: l, item })
          break
      }
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
    if (!rtlStyle && g.hangWidth !== 0 && (line.align === 'start' || line.align === 'left')) {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.hangWidth`, rule: 'an LTR line starts at its line left whatever hangs: AdjustLineOffsetForHanging returns 0 and text-align start or left adds no offset (inline_layout_algorithm.cc:303-311, length_utils.cc:1607-1640)' })
    }
  }
  for (let b = 0; b < layout.belowFloats.length; b++) {
    unobservable.push({ line: -1, fact: `belowFloats[${b}]`, rule: 'a refused slot moves the line box down past the floats; only vertical positions show it, which are outside the contract (inline_layout_algorithm.cc:1341-1367)' })
  }
  const nodes: ExpectedRect[][] = []
  const includedHyphens = new Set<BlinkItem>()
  for (let r = 0; r < runCount; r++) {
    const leaf = tree.leaves[r]!
    const quads = leaf.text.length === 0 ? [] : quadsForRange(units[r]!, items[r]!, leaf.start, leaf.start + leaf.text.length, rtlStyle, includedHyphens)
    nodes.push(quads.map(q => rectOf(q, zoom)))
  }
  const codePoints: ExpectedObservation['codePoints'] = []
  for (let r = 0; r < runCount; r++) {
    const leaf = tree.leaves[r]!
    for (let k = 0; k < leaf.text.length;) {
      const length = leaf.text.codePointAt(k)! > 0xffff ? 2 : 1
      const offset = leaf.start + k
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
  // Element.getClientRects(): LayoutInline::QuadsForSelfInternal walks the element's fragment items including a culled
  // inline's (InlineCursor::MoveToIncludingCulledInline, layout_inline.cc:428-490): a span with a box fragment reports its
  // border box per line; a culled span the items of the layout objects inside it, object by object in tree order and each
  // object's items in line order, not descending into a child that has a box fragment (inline_cursor.cc:1626-1654). An
  // atomic inline reports its border box and a <br> its forced-break item. An element with no items reports one empty rect
  // (found_quad false, :485-492), which sits on no line.
  const zeroQuad = (): ExpectedRect => ({ line: -1, x: predicted(0), width: predicted(0) })
  const elements: ExpectedRect[][] = []
  for (let e = 0; e < tree.elements.length; e++) {
    const element = tree.elements[e]!
    const own = elementItems[e]!
    const rects: ExpectedRect[] = []
    // An element's rect edges are item and box edges: they rest on the sizes of the items to their left on the line.
    const push = (line: number, left: number, right: number): void => {
      const xLimit = xLimits[line]!
      rects.push(rectOf({ line, left, right, leftLimit: xLimit(left), rightLimit: xLimit(right) }, zoom))
    }
    switch (element.node.kind) {
      case 'atomic': case 'br':
        for (let i = 0; i < own.length; i++) push(own[i]!.line, own[i]!.item.x, own[i]!.item.x + own[i]!.item.inlineSize)
        break
      case 'wbr':
        // Unsettled: a <wbr>'s flow-control item may or may not produce a fragment item (DESIGN.md §9, to settle by probe).
        break
      case 'span': {
        if (own.length > 0) {
          for (let i = 0; i < own.length; i++) push(own[i]!.line, own[i]!.item.x, own[i]!.item.x + own[i]!.item.inlineSize)
          break
        }
        // A culled span: its descendants' layout objects in tree order (text leaves and elements, skipping the insides of
        // children that report a box fragment of their own).
        const visitObjects = (parent: number): void => {
          const children: ({ kind: 'leaf'; index: number } | { kind: 'element'; index: number })[] = []
          for (let r = 0; r < runCount; r++) if (tree.leaves[r]!.parent === parent) children.push({ kind: 'leaf', index: r })
          for (let x = 0; x < tree.elements.length; x++) if (tree.elements[x]!.parent === parent) children.push({ kind: 'element', index: x })
          const rankOf = (n: { kind: 'leaf' | 'element'; index: number }): number => n.kind === 'leaf' ? tree.leaves[n.index]!.rank : tree.elements[n.index]!.rank
          children.sort((a, b) => rankOf(a) - rankOf(b))
          for (let c = 0; c < children.length; c++) {
            const child = children[c]!
            if (child.kind === 'leaf') {
              const refs = items[child.index]!
              for (let i = 0; i < refs.length; i++) push(refs[i]!.line, refs[i]!.item.x, refs[i]!.item.x + refs[i]!.item.inlineSize)
              continue
            }
            const childItems = elementItems[child.index]!
            if (childItems.length > 0) {
              for (let i = 0; i < childItems.length; i++) push(childItems[i]!.line, childItems[i]!.item.x, childItems[i]!.item.x + childItems[i]!.item.inlineSize)
              continue
            }
            if (tree.elements[child.index]!.node.kind === 'span') visitObjects(child.index)
          }
        }
        visitObjects(e)
        break
      }
    }
    if (rects.length === 0 && element.node.kind !== 'wbr') rects.push(zeroQuad())
    elements.push(rects)
  }
  return { codePoints, nodes, elements, unobservable }
}
