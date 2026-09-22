// What inspectLine computes of a decided Blink line, which only the lab reads: what LogicalLineBuilder and
// InlineLayoutAlgorithm make of the line's item results, the fragment items in visual order at their LayoutUnit positions
// with glyph clusters, their limits and the offset mapping (DESIGN.md §2.3). Its measuring raises gaps like the line's
// filling does, into the list the inspection returns.
import { addLU, subLU } from './layout-unit.js'
import { applyBoxEdges } from './box-edges.js'
import { reorderBoxes, type BoxData } from './box-reorder.js'
import type { TextAlign } from '../../model.js'
import { pairPlacement, positionInsideGrapheme, runOfSource } from './gaps.js'
import { boxStartEmpty, lengthLU } from './content.js'
import { isSegmentEdge } from './emoji.js'
import type { BlinkGlyphCluster, BlinkItem, BlinkLineGeometry, BlinkLineStart, BlinkMappingUnit, BlinkShapeRun } from './geometry.js'
import { LIGATURE_MERGED } from './ligatures.js'
import { viewPositionLimit } from './limits.js'
import type { LineInfo } from './line-breaker.js'
import { lineSourceRange, trailingSpacesOf, usedTextAlign } from './pieces.js'
import { isCjkIdeographOrSymbol, isDefaultIgnorable } from './props.js'
import { isFontRunEdge, luCeil, partGraphemeStarts, partWidth16, slicePrefix16, viewPartAt, viewPartCount, viewPrefix16, widthOf16, type Shaper, type View } from './shape.js'
import type { BlinkPrepared } from './types.js'

// BidiParagraph::IndicesInVisualOrder, ubidi_reorderVisual (ubidi.cpp): runs at or above each level from the highest down
// to the lowest odd one are reversed.
function indicesInVisualOrder(levels: number[]): number[] {
  const n = levels.length
  const map: number[] = []
  let minLevel = 255
  let maxLevel = 0
  for (let i = 0; i < n; i++) {
    map.push(i)
    minLevel = Math.min(minLevel, levels[i]!)
    maxLevel = Math.max(maxLevel, levels[i]!)
  }
  if (minLevel === maxLevel && (minLevel & 1) === 0) return map
  minLevel |= 1
  for (; maxLevel >= minLevel; maxLevel--) {
    let start = 0
    for (;;) {
      while (start < n && levels[start]! < maxLevel) start++
      if (start >= n) break
      let limit = start
      while (++limit < n && levels[limit]! >= maxLevel) { /* extend the run */ }
      for (let a = start, b = limit - 1; a < b; a++, b--) {
        const t = map[a]!
        map[a] = map[b]!
        map[b] = t
      }
      if (limit === n) break
      start = limit + 1
    }
  }
  return map
}

// A text or tab item's shape as Blink's caret code reads it (FragmentItem::LineLeftAndRightForOffsets,
// fragment_item.cc:1132-1199): the glyph clusters and the runs of the ShapeResult it copies from the result's view, in
// logical order. A cluster starts at every unit HarfBuzz doesn't mark a continuation, and a view's part holds the clusters
// that start in its range (ShapeResultView slices at character indices). Advances are prefix differences inside the part's
// own shaping call, Canvas stand-ins for HarfBuzz's glyph advances.
//
// The caret code finds a character by counting the runs' characters (ShapeResult::PositionForOffset,
// shape_result.cc:696-733), so a part's characters sit where the parts before it end, whatever text its glyphs came from.
// That is the glyphs' own text except in an RTL view cut again after ShapeResultView::Create numbered its parts in visual
// order (viewFromSegments): `نِ` and a trimmed space at a wrapped line start in Geeza Pro keep the space's glyph in the cut
// view, natively the letter reports the letter's and its mark's glyphs, 1640 units, and the mark the space's 959
// (c-8768b30f8733ee4c).
// `added16` is what justification added to the clusters that start at the units of [a, b), by unit from a (Justified); empty
// on a line it didn't apply to.
function shapeOf(sh: Shaper, view: View, a: number, b: number, partsKnown: boolean, rtl: boolean, added16: readonly number[]): { clusters: BlinkGlyphCluster[]; runs: BlinkShapeRun[] } {
  const p = sh.p
  const clusters: BlinkGlyphCluster[] = []
  const runs: BlinkShapeRun[] = []
  // PositionForOffset counts the characters from the item's visual start, the logical end in RTL: where the parts count
  // fewer characters than the item has, the ones left over are the first in RTL and the last in LTR, and no run holds them.
  let counted = 0
  const count = viewPartCount(view)
  for (let n = 0; n < count; n++) counted += Math.max(0, viewPartAt(view, n).length)
  let position = rtl && counted < b - a ? b - counted : a
  let pending = 0
  for (let n = 0; n < count; n++) {
    const part = viewPartAt(view, n)
    const characters = Math.min(part.length, b - position)
    if (characters <= 0) {
      // A part without characters of its own keeps its glyphs: they widen the cluster next to it.
      if (clusters.length > 0) clusters[clusters.length - 1]!.advance += partWidth16(sh, part)
      else pending += partWidth16(sh, part)
      continue
    }
    const listed = partGraphemeStarts(sh, view, part, position)
    const shift = position - part.start
    const group = part.kind === 'reshape' ? part.call.group : part.sr.kind === 'group' ? part.sr.group : -1
    const reshaped = part.kind === 'reshape' ? { textStart: part.call.start, textEnd: part.call.end } : null
    // The shaping call the part's glyphs come from: the reshape, or the paragraph's group.
    const callStart = part.kind === 'reshape' ? part.call.start : group >= 0 ? p.groups[group]!.start : part.start
    const callEnd = part.kind === 'reshape' ? part.call.end : group >= 0 ? p.groups[group]!.end : part.end
    const limit = part.start + characters
    let runStart = part.start
    let fontsKnown = true
    const endRun = (end: number): void => {
      runs.push({ textStart: runStart + shift, textEnd: end + shift, reshaped, fontsKnown })
      runStart = end
      fontsKnown = true
    }
    let start = part.start
    // The advance sum before the part in its shaping call, and the part's own before the cluster being made: a cluster's end
    // is the next one's start, so every edge is measured once.
    const base16 = slicePrefix16(sh, part, part.start)
    let before16 = 0
    for (let k = part.start + 1; k <= limit; k++) {
      if (k < limit && k < part.end && (p.continuations[k] === 1 || p.ligature[k] === LIGATURE_MERGED)) continue
      if (k < limit && k >= part.end) continue
      if (k < limit) positionInsideGrapheme(sh.gaps, p, k)
      const graphemeStarts = [start + shift]
      for (let x = start + 1; x < k; x++) if (listed === null ? p.graphemeStarts[x] === 1 : listed[x - part.start] === 1) graphemeStarts.push(x + shift)
      // The part's last cluster takes every glyph the part still holds (a cluster cut by the part's end goes to the part
      // holding its start).
      const at16 = slicePrefix16(sh, part, k >= limit ? part.end : k) - base16
      const advance = at16 - before16 + (added16[start - a] ?? 0) + pending
      before16 = at16
      pending = 0
      const cluster: BlinkGlyphCluster = { textStart: start + shift, textEnd: k + shift, graphemeStarts, advance }
      const startLimit = shift === 0 && start > a ? viewPositionLimit(sh, view, start) : null
      if (startLimit !== null) cluster.startLimit = startLimit
      // A pair adjustment at either end of the cluster whose side isn't known: the clusters around it are stand-ins.
      if (group >= 0 && shift === 0) {
        pairPlacement(sh.gaps, sh, group, start, callStart, callEnd)
        if (k >= limit) pairPlacement(sh.gaps, sh, group, k, callStart, callEnd)
      }
      let codePoints = 0
      for (let x = start; x < k; x++) if ((p.text.charCodeAt(x) & 0xfc00) !== 0xdc00) codePoints++
      if (rtl && !partsKnown && codePoints > 1) cluster.graphemesLimit = 'in-word-prefix'
      clusters.push(cluster)
      if (group >= 0 && p.fontRun[start]! < 0) fontsKnown = false
      // Another HarfBuzz run starts at k: a script segment, or a stretch another font draws.
      if (k < limit && group >= 0 && (isSegmentEdge(p, k) || isFontRunEdge(p, k, p.groups[group]!.start, p.groups[group]!.end))) endRun(k)
      start = k
    }
    endRun(limit)
    position += characters
  }
  return { clusters, runs }
}

// LineOffsetForTextAlign (length_utils.cc:1607-1655).
function lineOffsetForTextAlign(align: TextAlign, rtl: boolean, space: number): number {
  let used: 'left' | 'right' | 'center'
  switch (align) {
    case 'start': case 'justify': used = rtl ? 'right' : 'left'; break
    case 'end': used = rtl ? 'left' : 'right'; break
    case 'left': used = 'left'; break
    case 'right': used = 'right'; break
    case 'center': used = 'center'; break
  }
  switch (used) {
    case 'left': return rtl ? Math.min(0, space) : 0
    case 'right': return rtl ? space : Math.max(0, space)
    case 'center': return !rtl || space > 0 ? Math.max(0, Math.trunc(space / 2)) : space
  }
}

// JustificationContext::CheckOpportunity with text-justify: auto (justification_opportunity.cc:36-121): expand after a
// space; in 16-bit text also before and after a CJK ideograph or symbol, before only when the previous character didn't
// expand after. Default-ignorable characters are skipped without changing the state.
type JustifyState = { afterOpportunity: boolean }

function checkOpportunity(p: BlinkPrepared, state: JustifyState, c: number): [boolean, boolean] {
  if (isDefaultIgnorable(c)) return [false, false]
  if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0) {
    state.afterOpportunity = true
    return [false, true]
  }
  if (p.is8Bit || !isCjkIdeographOrSymbol(c)) {
    state.afterOpportunity = false
    return [false, false]
  }
  const before = !state.afterOpportunity
  state.afterOpportunity = true
  return [before, true]
}

// An item result as justification leaves it: what JustifyResults added to its glyph clusters, 16.16, by the cluster's start
// as a unit of the item result (justification_utils.cc:115-178), and its new size. Blink writes both into the item result;
// the decided line isn't written to, so they live as long as the geometry being made.
type Justified = { added16: number[]; inlineSize: number }

// ApplyJustification (justification_utils.cc:237-310): SetupJustificationOpportunity counts the opportunities of the item
// results up to EndOffsetForJustify, ExpansionSetup drops the one after the last character and divides the space
// (shape_result_spacing.cc:34-58, 87-100), and JustifyResults adds each expansion to the glyph cluster it belongs to
// (ShapeResult::ApplySpacingOrExpansion, shape_result.cc:993-1046), resizing the item results. Returns what it made of
// each item result, null for one it left alone, or null when it didn't apply. `endOffset` is EndOffsetForJustify, the
// offset trailingSpacesOf's walk stopped at.
function justificationOf(sh: Shaper, info: LineInfo, space: number, endOffset: number): (Justified | null)[] | null {
  const p = sh.p
  if (!info.shouldCreateLineBox || space <= 0) return null
  const lineStart = info.results.length > 0 ? info.results[0]!.start : 0
  if (endOffset === lineStart) return null
  const rtl = p.baseLevel === 1
  const state: JustifyState = { afterOpportunity: true }
  let count = 0
  const countText = (from: number, to: number): void => {
    const starts: number[] = []
    for (let k = from; k < to; k++) if (p.is8Bit || p.graphemeStarts[k] === 1) starts.push(k)
    const order = rtl ? starts.reverse() : starts
    for (let i = 0; i < order.length; i++) {
      const [before, after] = checkOpportunity(p, state, p.text.codePointAt(order[i]!)!)
      count += (before ? 1 : 0) + (after ? 1 : 0)
    }
  }
  const countItem = (r: LineInfo['results'][number]): void => {
    if (r.start >= endOffset || r.hasOnlyPreWrapTrailingSpaces) return
    const item = p.items[r.itemIndex]!
    if (r.shape !== null) countText(r.start, Math.min(r.end, endOffset))
    else if (item.type === 'atomic') {
      const [before, after] = checkOpportunity(p, state, 0xfffc)
      count += (before ? 1 : 0) + (after ? 1 : 0)
    }
  }
  const last = info.results[info.results.length - 1]
  if (rtl) {
    if (last !== undefined && last.hyphen !== null) countText16(p, state, last.hyphen.text, n => { count += n })
    for (let i = info.results.length - 1; i >= 0; i--) countItem(info.results[i]!)
  } else {
    for (let i = 0; i < info.results.length; i++) countItem(info.results[i]!)
    if (last !== undefined && last.hyphen !== null) countText16(p, state, last.hyphen.text, n => { count += n })
  }
  if (state.afterOpportunity && count > 0) count--
  if (count === 0) return null
  // InlineLayoutUnit of the space and the per-opportunity TextRunLayoutUnit, both 16.16 (layout_unit.h:474-475).
  let expansion16 = space * 1024
  const per16 = Math.trunc(expansion16 / count)
  let remaining = count
  const next = (): number => {
    remaining--
    if (remaining === 0) { const rest = expansion16; expansion16 = 0; return rest }
    expansion16 -= per16
    return per16
  }
  const applied: JustifyState = { afterOpportunity: true }
  const justified = new Array<Justified | null>(info.results.length).fill(null)
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    if (r.hasOnlyPreWrapTrailingSpaces) break
    const item = p.items[r.itemIndex]!
    if (r.shape === null) continue
    const added16 = new Array<number>(r.end - r.start).fill(0)
    const starts: number[] = []
    for (let k = r.start; k < r.end; k++) if (k === r.start || p.continuations[k] !== 1 && p.graphemeStarts[k] === 1 && p.ligature[k] !== LIGATURE_MERGED) starts.push(k)
    const order = (item.bidiLevel & 1) === 1 ? starts.slice().reverse() : starts
    let add = 0
    for (let c = 0; c < order.length; c++) {
      const k = order[c]!
      // ComputeExpansion: nothing once no opportunity is left or past the justified text (shape_result_spacing.cc:140-150).
      if (k >= endOffset || remaining === 0) continue
      const [before, after] = checkOpportunity(p, applied, p.text.codePointAt(k)!)
      let spacing = 0
      // FinalizeComputeExpansion (:171-187).
      if (before) spacing += next()
      if (after && remaining > 0) spacing += next()
      add += spacing
      added16[k - r.start] = spacing
    }
    const view = r.shape
    const width16 = viewPrefix16(sh, view, r.end) - viewPrefix16(sh, view, r.start) + add
    justified[i] = { added16, inlineSize: addLU(Math.max(0, luCeil(widthOf16(width16))), r.isHyphenated ? r.hyphen!.inlineSize : 0) }
  }
  return justified
}

// CountOpportunities over a string outside text_content (the hyphen), per code unit.
function countText16(p: BlinkPrepared, state: JustifyState, text: string, add: (n: number) => void): void {
  for (let i = 0; i < text.length; i++) {
    const [before, after] = checkOpportunity(p, state, text.charCodeAt(i))
    add((before ? 1 : 0) + (after ? 1 : 0))
  }
}

// A LogicalLineItem (logical_line_item.h): a leaf fragment item, or the placeholder a box that creates a box fragment adds
// where it opens (InlineLayoutStateStack::AddBoxFragmentPlaceholder, inline_box_state.cc:505-545). `offset` is
// rect.offset.inline_offset, `marginLineLeft` what ComputeInlinePositions stores as margin_line_left, and `box` the 1-based
// BoxData index PrepareForReorder sets.
type LineChild = {
  item: BlinkItem | null
  level: number
  opaque: boolean
  fragment: boolean
  offset: number
  inlineSize: number
  marginLineLeft: number
  box: number
}

// LogicalLineBuilder::HandleItemResults (logical_line_builder.cc:200-464) with the box states of InlineLayoutStateStack
// (OnBeginPlaceItems, OnOpenTag, OnCloseTag, OnEndPlaceItems, AddBoxData; inline_box_state.cc:290-691), BidiReorder
// (logical_line_builder.cc:688-760) with PrepareForReorder and UpdateAfterReorder (inline_box_state.cc:661-848), and
// ComputeInlinePositions (:845-935) from AdjustLineOffsetForHanging; then ApplyTextAlign (inline_layout_algorithm.cc:943-970)
// and the line box at the opportunity's line left plus the alignment offset and, in LTR, the text-indent (:480-492).
// `justified` is what justification made of the item results (justificationOf), null on a line it didn't apply to.
function itemsOf(sh: Shaper, info: LineInfo, justified: readonly (Justified | null)[] | null, hangWidth: number, alignOffset: number): BlinkItem[] {
  const p = sh.p
  const children: LineChild[] = []
  const leaf = (item: BlinkItem, level: number, marginLineLeft: number, inlineSize: number): void => {
    children.push({ item, level, opaque: false, fragment: true, offset: marginLineLeft, inlineSize, marginLineLeft: 0, box: 0 })
  }
  type BoxState = { element: number; style: number; hasStartEdge: boolean; start: number; startEdge: { margin: number; mbp: number } }
  const stack: BoxState[] = []
  let boxes: BoxData[] = []
  const rtlStyle = p.baseLevel === 1 // spans inherit the block's direction in the model
  const placeholder = (): number => {
    children.push({ item: null, level: 0, opaque: true, fragment: false, offset: 0, inlineSize: 0, marginLineLeft: 0, box: 0 })
    return children.length - 1
  }
  // RebuildBoxStates (logical_line_builder.cc:790-813): boxes open at the line start get placeholders and no start edge.
  // They are the spans around the line's first item, outermost first: its style's chain of parents, without the span an
  // open tag opens itself.
  if (info.results.length > 0) {
    const first = p.items[info.results[0]!.itemIndex]!
    const open: number[] = []
    const firstStyle = first.type === 'open-tag' ? p.styles[first.style]!.parent : first.style
    for (let s = p.inspect!.fragmentAncestors[firstStyle]!; s !== 0; s = p.inspect!.fragmentAncestors[p.styles[s]!.parent]!) open.push(s)
    for (let o = open.length - 1; o >= 0; o--) {
      const style = p.styles[open[o]!]!
      const start = children.length
      placeholder()
      stack.push({ element: style.element, style: open[o]!, hasStartEdge: false, start, startEdge: { margin: 0, mbp: 0 } })
    }
  }
  // AddBoxData (inline_box_state.cc:548-630).
  const endBox = (box: BoxState, hasEndEdge: boolean): void => {
    const style = p.styles[box.style]!
    const endMbp = addLU(addLU(style.end.margin, style.end.border), style.end.padding)
    let data: BoxData = {
      element: box.element, start: box.start, end: children.length,
      hasLineLeftEdge: box.hasStartEdge, marginLineLeft: box.hasStartEdge ? box.startEdge.margin : 0, mbpLineLeft: box.hasStartEdge ? box.startEdge.mbp : 0,
      hasLineRightEdge: hasEndEdge, marginLineRight: hasEndEdge ? style.end.margin : 0, mbpLineRight: hasEndEdge ? endMbp : 0,
      parent: 0, fragmentedFrom: 0, rectLeft: 0, rectRight: 0,
    }
    if (rtlStyle) {
      data = {
        ...data, hasLineLeftEdge: data.hasLineRightEdge, hasLineRightEdge: data.hasLineLeftEdge, marginLineLeft: data.marginLineRight,
        marginLineRight: data.marginLineLeft, mbpLineLeft: data.mbpLineRight, mbpLineRight: data.mbpLineLeft,
      }
    }
    if (data.end > data.start + 1) {
      boxes.push(data)
      return
    }
    // An empty inline box is a flat fragment now, never deferred or reordered (:612-630).
    const ph = children[data.start]!
    ph.offset = addLU(ph.offset, data.marginLineLeft)
    ph.inlineSize = addLU(data.mbpLineLeft, data.mbpLineRight)
    ph.fragment = true
    ph.item = { kind: 'inline-box', element: data.element, x: 0, inlineSize: Math.max(0, subLU(subLU(ph.inlineSize, data.marginLineLeft), data.marginLineRight)), hasStartEdge: rtlStyle ? data.hasLineRightEdge : data.hasLineLeftEdge, hasEndEdge: rtlStyle ? data.hasLineLeftEdge : data.hasLineRightEdge }
  }
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    const expanded = justified === null ? null : justified[i]!
    const inlineSize = expanded === null ? r.inlineSize : expanded.inlineSize
    const added16 = expanded === null ? [] : expanded.added16
    // UAX #9 L1 for results holding only trailing spaces (:716-720).
    const level = r.hasOnlyBidiTrailingSpaces ? p.baseLevel : item.bidiLevel
    switch (item.type) {
      case 'text': {
        // Empty or fully collapsed text makes no fragment item (:215-223).
        if (r.end === r.start) break
        const hyphen = r.isHyphenated ? r.hyphen!.inlineSize : 0
        const shape = shapeOf(sh, r.shape!, r.start, r.end, r.partsKnown, (item.bidiLevel & 1) === 1, added16)
        const sizeLimit = viewPositionLimit(sh, r.shape!, r.end)
        const textItem: BlinkItem = sizeLimit === null
          ? { kind: 'text', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: subLU(inlineSize, hyphen), clusters: shape.clusters, runs: shape.runs, partsKnown: r.partsKnown }
          : { kind: 'text', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: subLU(inlineSize, hyphen), clusters: shape.clusters, runs: shape.runs, partsKnown: r.partsKnown, sizeLimit }
        leaf(textItem, level, 0, subLU(inlineSize, hyphen))
        if (r.isHyphenated) leaf({ kind: 'hyphen', run: item.run, level: item.bidiLevel, x: 0, inlineSize: hyphen }, item.bidiLevel, 0, hyphen)
        break
      }
      case 'control':
        // PlaceControlItem (:404-445): a generated break opportunity and an empty result (CR, FF) make no item.
        switch (item.control) {
          case 'tab':
            if (r.end === r.start) break
            leaf({ kind: 'tab', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize, clusters: shapeOf(sh, r.shape!, r.start, r.end, true, (item.bidiLevel & 1) === 1, added16).clusters }, level, 0, inlineSize)
            break
          case 'br':
            if (r.end === r.start) break
            leaf({ kind: 'br', element: item.element, level: item.bidiLevel, x: 0, inlineSize }, level, 0, inlineSize)
            break
          case 'forced-break':
            if (r.end === r.start) break
            leaf({ kind: 'forced-break', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize }, level, 0, inlineSize)
            break
          case 'generated-zwsp': case 'wbr': case 'cr-ff':
            break
        }
        break
      case 'atomic': {
        // The fragment keeps the actual border box; saturated margin-box sums cannot recover it by subtraction.
        const atomic = p.index.elements[item.element]!.node
        if (atomic.kind !== 'atomic') throw new Error('atomic item has no atomic element')
        leaf({ kind: 'atomic', element: item.element, level: item.bidiLevel, x: 0, inlineSize: lengthLU(atomic.width, p.layoutZoom), marginStart: r.marginStart, marginEnd: r.marginEnd }, level, r.marginStart, inlineSize)
        break
      }
      case 'open-tag': {
        const style = p.styles[item.style]!
        if (!style.shouldCreateBoxFragment) break
        const start = children.length
        placeholder()
        const sized = inlineSize !== 0 || (style.shouldCreateBoxFragment && !boxStartEmpty(style))
        stack.push({
          element: item.element, style: item.style, hasStartEdge: true, start,
          startEdge: sized ? { margin: style.start.margin, mbp: addLU(addLU(style.start.margin, style.start.border), style.start.padding) } : { margin: 0, mbp: 0 },
        })
        break
      }
      case 'close-tag': {
        if (!p.styles[item.style]!.shouldCreateBoxFragment) break
        const box = stack.pop()
        if (box !== undefined) endBox(box, true)
        break
      }
    }
  }
  // OnEndPlaceItems (:437-459): boxes still open end without their end edge.
  while (stack.length > 0) endBox(stack.pop()!, false)
  // Opaque children take the level of the next child, the paragraph's at the end (:720-736).
  let lastLevel = p.baseLevel
  for (let c = children.length - 1; c >= 0; c--) {
    if (children[c]!.opaque) children[c]!.level = lastLevel
    else lastLevel = children[c]!.level
  }
  let visual = children
  if (p.bidiEnabled && children.length > 0) {
    const order = indicesInVisualOrder(children.map(c => c.level))
    visual = order.map(i => children[i]!)
    // PrepareForReorder/UpdateAfterReorder: compile the source forest and close/open only the paths that visual
    // ordering leaves/enters. Fragment edge assignment and source output order are unchanged.
    boxes = reorderBoxes(children, visual, boxes)
  }
  // ComputeInlinePositions (:845-935).
  let position = p.baseLevel === 1 ? subLU(0, hangWidth) : 0
  for (let c = 0; c < visual.length; c++) {
    const child = visual[c]!
    child.marginLineLeft = child.offset
    child.offset = addLU(child.offset, position)
    if (child.fragment) position = addLU(position, child.inlineSize)
  }
  applyBoxEdges(visual, boxes)
  const padLeft = new Array<number>(visual.length).fill(0)
  const padRight = new Array<number>(visual.length).fill(0)
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    const startChild = visual[box.start]!
    const lastChild = visual[box.end - 1]!
    let left = subLU(startChild.offset, startChild.marginLineLeft)
    let right = addLU(subLU(lastChild.offset, lastChild.marginLineLeft), lastChild.inlineSize)
    padLeft[box.start] = addLU(padLeft[box.start]!, box.mbpLineLeft)
    padRight[box.end - 1] = addLU(padRight[box.end - 1]!, box.mbpLineRight)
    left = addLU(left, box.marginLineLeft)
    right = subLU(right, box.marginLineRight)
    left = subLU(left, padLeft[box.start]!)
    right = addLU(right, padRight[box.end - 1]!)
    box.rectLeft = left
    box.rectRight = right
  }
  const rtl = p.baseLevel === 1
  const lineBoxLeft = addLU(addLU(info.lineLeft, alignOffset), rtl ? 0 : info.textIndent)
  const out: BlinkItem[] = []
  for (let c = 0; c < visual.length; c++) {
    const child = visual[c]!
    if (child.item === null) continue
    child.item.x = addLU(lineBoxLeft, child.offset)
    out.push(child.item)
  }
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    out.push({
      kind: 'inline-box', element: box.element, x: addLU(lineBoxLeft, box.rectLeft), inlineSize: Math.max(0, subLU(box.rectRight, box.rectLeft)),
      hasStartEdge: rtlStyle ? box.hasLineRightEdge : box.hasLineLeftEdge, hasEndEdge: rtlStyle ? box.hasLineLeftEdge : box.hasLineRightEdge,
    })
  }
  return out
}

// OffsetMapping units over the line's source units (offset_mapping_builder.cc:95-117, offset_mapping.cc:278-299): source
// units kept in text_content map one to one, removed ones to an empty range where they collapsed, and a unit Blink
// generated for a text node (U+200B after leading preserved spaces) has an empty source range before the unit that follows
// it. Elements' units (a <wbr>'s U+200B, a <br>'s LF, an atomic inline's U+FFFC) belong to no text node.
function mappingOf(p: BlinkPrepared, sourceStart: number, sourceEnd: number, start: BlinkLineStart, contentEnd: number): BlinkMappingUnit[] {
  const units: BlinkMappingUnit[] = []
  const push = (unit: BlinkMappingUnit): void => {
    const last = units.length > 0 ? units[units.length - 1]! : null
    if (last !== null && last.run === unit.run && last.collapsed === unit.collapsed && last.end === unit.start && unit.start < unit.end &&
      last.start < last.end && last.textEnd === unit.textStart && (!unit.collapsed || last.textStart === unit.textStart)) {
      last.end = unit.end
      last.textEnd = unit.textEnd
      return
    }
    units.push(unit)
  }
  // The item that holds a unit without a source offset, found from the line's first item as the units go by: a text
  // leaf's generated U+200B is mapped, an element's unit isn't.
  let holder = start.itemIndex
  const generated = (t: number, s: number): void => {
    while (p.items[holder]!.end <= t) holder++
    const item = p.items[holder]!
    if (item.type === 'control' && item.control === 'generated-zwsp') push({ run: item.run, start: s, end: s, textStart: t, textEnd: t + 1, collapsed: false })
  }
  const leaves = p.index.leaves
  let run = sourceStart < sourceEnd ? runOfSource(p, sourceStart) : 0
  // Where a removed source unit's collapsed unit maps to: the length of text_content when it was collapsed
  // (offset_mapping_builder.cc:95-117), the end of the last unit kept before it.
  let before = sourceStart - 1
  if (before >= 0 && p.contentOffsets[before]! < 0) before = p.inspect!.collapsedSourceRuns.start(before) - 1
  let collapsedAt = before < 0 ? 0 : p.contentOffsets[before]! + 1
  let t = start.textOffset
  for (let s = sourceStart; s < sourceEnd; s++) {
    while (run + 1 < leaves.length && leaves[run + 1]!.start <= s) run++
    const c = p.contentOffsets[s]!
    if (c < 0) {
      push({ run, start: s, end: s + 1, textStart: collapsedAt, textEnd: collapsedAt, collapsed: true })
      continue
    }
    for (; t < c; t++) if (p.sourceOffsets[t] === -1) generated(t, s)
    t = c + 1
    collapsedAt = c + 1
    push({ run, start: s, end: s + 1, textStart: c, textEnd: c + 1, collapsed: false })
  }
  for (; t < contentEnd; t++) if (p.sourceOffsets[t] === -1) generated(t, sourceEnd)
  return units
}

// The geometry of the line `info` filled from `start`: the trailing spaces' hang, the alignment or justification, the
// offset mapping and the items. Nothing is written into the decided line: justification's sizes go from justificationOf to
// itemsOf.
export function geometryOf(sh: Shaper, info: LineInfo, start: BlinkLineStart): BlinkLineGeometry {
  const p = sh.p
  const next = info.token
  const range = lineSourceRange(p, start, next)
  const trailingSpaces = trailingSpacesOf(sh, info)
  const hangWidth = trailingSpaces.width
  const align = usedTextAlign(p.paragraph.textAlign, info)
  // ApplyTextAlign's space: AvailableWidth − WidthForAlignment, the unclamped width less the hanging width
  // (inline_layout_algorithm.cc:949-952, line_info.h:157-167). Justification that finds opportunities expands the item
  // results and moves nothing; otherwise the line falls back to start (:955-968).
  const space = subLU(info.availableWidth, subLU(info.unclampedWidth, hangWidth))
  const justified = align === 'justify' ? justificationOf(sh, info, space, trailingSpaces.endOffset) : null
  const alignOffset = justified !== null ? 0 : lineOffsetForTextAlign(align === 'justify' ? 'start' : align, p.baseLevel === 1, space)
  return {
    layoutZoom: p.layoutZoom,
    lineLeft: info.lineLeft,
    lineRight: info.lineRight,
    availableWidth: info.availableWidth,
    textIndent: info.textIndent,
    needsAccurateEndPosition: info.needsAccurateEndPosition,
    width: info.width,
    hangWidth,
    alignOffset,
    mapping: mappingOf(p, range.start, range.end, start, next === null ? p.text.length : next.textOffset),
    items: itemsOf(sh, info, justified, hangWidth, alignOffset),
  }
}
