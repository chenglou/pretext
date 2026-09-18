// What Firefox 156.0 reports through Range.getClientRects() and Element.getClientRects() for a Gecko layout: for each code
// point of the concatenated leaf text, the rects of a Range over it in its leaf's text node; for each leaf the rects of a
// Range over the whole node; for each element its client rects (research/observe-gecko.md, DESIGN.md §9). The rules port
// GetPartialTextRect and ExtractRectFromOffset (dom/base/AbstractRange.cpp:715-831), nsTextFrame::GetPointFromOffset
// (layout/generic/nsTextFrame.cpp:8667-8752), nsLayoutUtils::GetAllInFlowRects (nsLayoutUtils.cpp:3477-3505, 3661-3667) and
// DOMRect::SetLayoutRect (dom/base/DOMRect.cpp:152-164) over the frames the engine placed. Types only from
// rebuild/src/model.ts: no expected value comes from the library's logic, and the tree is walked here, not through
// src/content.ts (DESIGN.md §8.1).
import type {
  Expected, ExpectedObservation, ExpectedRect, GapName, GeckoFrameGeometry, GeckoLayout, GeckoTextFrame, InlineNode, ObservationPort,
  Paragraph, UnobservableFact,
} from '../../src/model.ts'

// DOMRect::SetLayoutRect rounds each app-unit edge to 1/65536 px, and SetRect narrows each field to float32 on its own
// (DOMRect.cpp:152-164, DOMRect.h:122-127). Before that, TransformFrameRectToAncestor takes the rect through float32 device
// pixels: the edges become floats (au over the page's app units per device pixel), the transform to the ancestor adds in
// float32, and the result is scaled and rounded back to app units (nsLayoutUtils.cpp:2517-2537). Each float32 operation is off
// by at most half a step, and the port counts up to eight of them on an edge (conversion, the right edge's sum, the
// transform's product and sum for each corner, the bounds' difference, the scaling back). The edge comes back as the frame's
// own while that adds up to less than half an app unit: 8 × step / 2 × apd < 1/2, a step below 1 / (8 × apd) device px, which
// holds for magnitudes below 2^k with 2^k the first power of two at or above 2^20 / apd (a float32 step is 2^−23 of its
// power of two): 2^16 device px at 30 au per device px, 2^15 at 60. From there on an edge can come back 1 au off (probe
// gecko-port F6 at apd 30: x 1459.688 au where the frame's is 1459, 100000px from the origin): `float32-precision`.
const R = (au: number): number => Math.floor(au * (65536 / 60) + 0.5) / 65536

export function encodeEdges(a0: number, a1: number): { x: number; width: number } {
  return { x: Math.fround(R(a0)), width: Math.fround(R(a1) - R(a0)) }
}

// An inline position in au, and the condition under which it rests on a Canvas stand-in, or null.
type Edge = { au: number; limited: GapName | null }

type PlacedFrame = {
  line: number
  index: number
  frame: GeckoTextFrame
  // The text run's direction: the frame's level is odd (nsTextFrame.cpp:8712-8716).
  rtl: boolean
  // prefix[k]: the advance of characters [measuredStart, measuredStart + k).
  prefix: number[]
}

// The paragraph's text leaves and element kinds in document order, as the page builds its DOM.
function walkContent(paragraph: Paragraph): { texts: string[]; elementKinds: Array<'span' | 'atomic' | 'br' | 'wbr'> } {
  const texts: string[] = []
  const elementKinds: Array<'span' | 'atomic' | 'br' | 'wbr'> = []
  const stack: { nodes: readonly InlineNode[]; next: number }[] = [{ nodes: paragraph.content, next: 0 }]
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!
    if (top.next === top.nodes.length) {
      stack.pop()
      continue
    }
    const node = top.nodes[top.next++]!
    switch (node.kind) {
      case 'text':
        texts.push(node.text)
        break
      case 'span':
        elementKinds.push('span')
        stack.push({ nodes: node.children, next: 0 })
        break
      default:
        elementKinds.push(node.kind)
    }
  }
  return { texts, elementKinds }
}

export const observeGecko: ObservationPort<GeckoLayout> = (paragraph, layout) => {
  const { texts, elementKinds } = walkContent(paragraph)
  let text = ''
  const runStarts: number[] = []
  for (let r = 0; r < texts.length; r++) {
    runStarts.push(text.length)
    text += texts[r]!
  }
  runStarts.push(text.length)

  const framesOfRun: PlacedFrame[][] = texts.map(() => [])
  const elementFrames: Array<{ line: number; index: number; frame: Exclude<GeckoFrameGeometry, GeckoTextFrame> }> = []
  const unobservable: UnobservableFact[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    for (let k = 0; k < line.geometry.frames.length; k++) {
      const frame = line.geometry.frames[k]!
      if (frame.kind !== 'text') {
        elementFrames.push({ line: l, index: k, frame })
        continue
      }
      const prefix = [0]
      for (let c = 0; c < frame.characters.length; c++) prefix.push(prefix[c]! + frame.characters[c]!.advance)
      framesOfRun[frame.run]!.push({ line: l, index: k, frame, rtl: (frame.level & 1) === 1, prefix })
    }
  }
  for (let r = 0; r < framesOfRun.length; r++) framesOfRun[r]!.sort((a, b) => a.frame.contentStart - b.frame.contentStart)

  // A paragraph gap with a range names text whose advances are Canvas stand-ins under its condition (DESIGN.md §2.8): a
  // cluster whose font follows the process's history, a cursive cluster whose letter spacing the font facts don't settle, a
  // bitmap emoji at a size Canvas can't set. A sum of advances over such text is a stand-in too. `dictionary-breaks-
  // unavailable` names breaks, not advances. rangeGap(a, b): the condition of a ranged gap meeting source [a, b), or null.
  const ranged = layout.gaps.filter(g => g.at !== undefined && g.at.end > g.at.start && g.gap !== 'dictionary-breaks-unavailable')
    .map(g => ({ start: g.at!.start, end: g.at!.end, gap: g.gap })).sort((a, b) => a.start - b.start)
  // furthest[i]: the gap among the first i + 1 that reaches furthest.
  const furthest: number[] = []
  for (let i = 0; i < ranged.length; i++) furthest.push(i > 0 && ranged[furthest[i - 1]!]!.end >= ranged[i]!.end ? furthest[i - 1]! : i)
  const rangeGap = (a: number, b: number): GapName | null => {
    if (b <= a || ranged.length === 0) return null
    let lo = 0
    let hi = ranged.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ranged[mid]!.start < b) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return null
    const reach = ranged[furthest[lo - 1]!]!
    return reach.end > a ? reach.gap : null
  }

  // The condition under which the position before source offset s in frame f is a stand-in, or null. Every advance of a
  // frame whose Canvas widths are stand-ins is one (GeckoTextFrame.advancesStandIn). Otherwise the layout says so per unit,
  // where the position lies inside a shaping unit and Canvas couldn't confirm it (GeckoCharacter.standInBefore,
  // `in-word-prefix`; the DOM's glyph records inside a unit come from one shaping of the unit, DESIGN.md §5). A skipped
  // unit holds no position of its own: the next kept one's counts, or the frame's end.
  const standIn = (f: GeckoTextFrame, s: number): GapName | null => {
    if (f.advancesStandIn !== null) return f.advancesStandIn
    for (let c = s - f.measuredStart; c < f.characters.length; c++) {
      const ch = f.characters[c]!
      if (!ch.skipped) return ch.standInBefore ? 'in-word-prefix' : null
    }
    return f.standInAtEnd ? 'in-word-prefix' : null
  }
  // A frame's box is the advance between its two ends (nsTextFrame.cpp:11268-11273): a stand-in where either end is one.
  const widthLimited = (f: GeckoTextFrame): GapName | null =>
    f.advancesStandIn ?? standIn(f, f.measuredStart) ?? (f.standInAtEnd ? 'in-word-prefix' : null) ?? rangeGap(f.measuredStart, f.contentEnd)

  // A frame's place on its line. TextAlignLine and ReorderFrames put frames one after another from the line's start edge,
  // after an offset that start alignment takes from the hang alone and every other alignment from the line's remaining
  // inline size (nsLineLayout.cpp:3482-3670; nsBidiPresUtils.cpp:1882-1905). So the edge a frame is placed by (its left
  // edge when frames go left to right, else its right one) is a stand-in where a text frame placed before it has a
  // stand-in width, and on a line that isn't start-aligned where any text frame has one.
  const leftToRight = paragraph.direction !== 'rtl'
  const placedByLimited = layout.lines.map(line => {
    const frames = line.geometry.frames
    const startAligned = line.align === 'start' || (line.align === 'left' && leftToRight) || (line.align === 'right' && !leftToRight)
    const limitedText: Array<{ k: number; gap: GapName }> = []
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k]!
      const gap = f.kind === 'text' ? widthLimited(f) : null
      if (gap !== null) limitedText.push({ k, gap })
    }
    return frames.map((f, k): GapName | null => {
      if (limitedText.length === 0) return null
      if (!startAligned) return limitedText[0]!.gap
      const edge = leftToRight ? f.x : f.x + f.width
      for (const { k: j, gap } of limitedText) {
        if (j === k) continue
        const other = frames[j]!
        const otherEdge = leftToRight ? other.x : other.x + other.width
        if (leftToRight ? (otherEdge < edge || (otherEdge === edge && j < k)) : (otherEdge > edge || (otherEdge === edge && j < k))) return gap
      }
      return null
    })
  })
  // The left edge and the width of a frame's box as stand-ins. An inline frame's width is its children's: a stand-in where a
  // text frame inside it has one.
  const boxLimited = (l: number, k: number): { x: GapName | null; width: GapName | null } => {
    const frames = layout.lines[l]!.geometry.frames
    const f = frames[k]!
    let width = f.kind === 'text' ? widthLimited(f) : null
    if (f.kind === 'inline') {
      for (let j = 0; j < frames.length && width === null; j++) {
        const other = frames[j]!
        if (other.kind === 'text' && other.x >= f.x && other.x + other.width <= f.x + f.width) width = widthLimited(other)
      }
    }
    const placed = placedByLimited[l]![k]!
    return { x: leftToRight ? placed : placed ?? width, width }
  }
  // An edge this many device px or more from the origin can come back 1 au off (see R above).
  const apd = layout.lines.length === 0 ? 60 : layout.lines[0]!.geometry.appUnitsPerDevPixel
  let farBound = 1
  while (farBound < 2 ** 20 / apd) farBound *= 2
  const farEdge = (au: number): GapName | null => Math.abs(au) / apd >= farBound ? 'float32-precision' : null

  // nsTextFrame::GetPointFromOffset in frame-local au (nsTextFrame.cpp:8667-8752): clamp to the content and the trimmed
  // start (GetTrimmedOffsets without trimming the end, :3287-3330), snap back to the cluster start (FindClusterStart,
  // :3549-3558), sum the advances from the trimmed start, and count from the box's right edge in an RTL text run. The sum
  // is a stand-in where either end of it is one: the frame's start and the offset, or in an RTL text run, where the point is
  // the box's width less the sum, the offset and the frame's end. It is one too where it sums text a ranged paragraph gap
  // names (rangeGap); in an RTL text run the box's width stands for that.
  const point = (pf: PlacedFrame, offset: number): Edge => {
    const f = pf.frame
    let o = Math.max(f.contentStart, Math.min(f.contentEnd, offset))
    o = Math.max(f.measuredStart, Math.min(f.contentEnd, o))
    const at = (s: number) => f.characters[s - f.measuredStart]!
    if (o < f.contentEnd && !at(o).skipped && !at(o).clusterStart) {
      while (o > f.measuredStart && !at(o).skipped && !at(o).clusterStart) o--
    }
    const iSize = pf.prefix[o - f.measuredStart]!
    // No kept unit before the offset, or none from it on: the point is the frame's own start or end.
    let keptBefore = false
    for (let c = 0; c < o - f.measuredStart && !keptBefore; c++) keptBefore = !f.characters[c]!.skipped
    let keptFrom = false
    for (let c = o - f.measuredStart; c < f.characters.length && !keptFrom; c++) keptFrom = !f.characters[c]!.skipped
    if (pf.rtl) return { au: f.width - iSize, limited: keptFrom ? standIn(f, o) ?? widthLimited(f) : null }
    return { au: iSize, limited: keptBefore ? standIn(f, f.measuredStart) ?? standIn(f, o) ?? rangeGap(f.measuredStart, o) : null }
  }
  // nsRect::ClampPoint into the rect as already cut (gfx/2d/BaseRect.h:701-705).
  const clamp = (p: Edge, lo: Edge, hi: Edge): Edge => {
    if (p.au <= lo.au) return { au: lo.au, limited: p.limited ?? lo.limited }
    if (p.au >= hi.au) return { au: hi.au, limited: p.limited ?? hi.limited }
    return p
  }
  const expected = (value: number, limited: GapName | null): Expected =>
    limited !== null ? { state: 'limited', gap: limited, value } : { state: 'predicted', value }
  const rect = (pf: PlacedFrame, x0: Edge, x1: Edge): ExpectedRect => {
    const encoded = encodeEdges(pf.frame.x + x0.au, pf.frame.x + x1.au)
    // Both edges count from the frame's left edge, which is a stand-in where the frame's place is. The width is the float32
    // difference of the two encoded edges (DOMRect.cpp:152-164), so it can move a float32 step with them.
    const placed = boxLimited(pf.line, pf.index).x
    const x = placed ?? x0.limited ?? farEdge(pf.frame.x + x0.au)
    return { line: pf.line, x: expected(encoded.x, x), width: expected(encoded.width, x ?? x1.limited ?? farEdge(pf.frame.x + x1.au)) }
  }

  // GetPartialTextRect over one code point [i, i + length) of leaf r: every continuation overlapping the range, its box cut
  // at the offsets inside it, flush to the origin edge in RTL (AbstractRange.cpp:771-831, :715-765). A node without a
  // frame reports nothing (:775-778).
  const codePoints: ExpectedObservation['codePoints'] = []
  for (let r = 0; r < texts.length; r++) {
    const frames = framesOfRun[r]!
    let k = 0
    for (let i = runStarts[r]!; i < runStarts[r + 1]!;) {
      const length = text.codePointAt(i)! > 0xffff ? 2 : 1
      const rects: ExpectedRect[] = []
      while (k < frames.length && frames[k]!.frame.contentEnd <= i) k++
      for (let j = k; j < frames.length; j++) {
        const pf = frames[j]!
        const f = pf.frame
        if (f.contentStart >= i + length) break
        let x0: Edge = { au: 0, limited: null }
        let x1: Edge = { au: f.width, limited: widthLimited(f) }
        if (f.contentStart < i) {
          const p = clamp(point(pf, i), x0, x1)
          if (pf.rtl) x1 = p
          else x0 = p
        }
        if (f.contentEnd > i + length) {
          const p = clamp(point(pf, i + length), x0, x1)
          if (pf.rtl) x0 = p
          else x1 = p
        }
        rects.push(rect(pf, x0, x1))
      }
      codePoints.push({ offset: i, length, rects })
      i += length
    }
  }

  // selectNodeContents takes the same path over [0, length): each continuation's whole box.
  const nodes: ExpectedRect[][] = []
  for (let r = 0; r < texts.length; r++) {
    nodes.push(framesOfRun[r]!.map(pf => rect(pf, { au: 0, limited: null }, { au: pf.frame.width, limited: widthLimited(pf.frame) })))
  }

  // Element.getClientRects: GetAllInFlowRects walks an element's primary frame and its continuations, one border box each
  // (nsLayoutUtils.cpp:3477-3505, :3661-3667): a span's inline frame on each line, an inline-block's box, a BRFrame's box,
  // a WBRFrame's 0 × 0 box.
  const elements: ExpectedRect[][] = elementKinds.map(() => [])
  for (let e = 0; e < elementFrames.length; e++) {
    const { line, index, frame } = elementFrames[e]!
    const encoded = encodeEdges(frame.x, frame.x + frame.width)
    const limited = boxLimited(line, index)
    const x = limited.x ?? farEdge(frame.x)
    elements[frame.element]!.push({ line, x: expected(encoded.x, x), width: expected(encoded.width, x ?? limited.width ?? farEdge(frame.x + frame.width)) })
  }

  // Engine facts no rect reflects, whatever their value (observe-gecko.md §8).
  for (let r = 0; r < framesOfRun.length; r++) {
    for (const pf of framesOfRun[r]!) {
      const f = pf.frame
      const path = `lines[${pf.line}].geometry.frames[${pf.index}]`
      let beyond = -1
      const within: number[] = []
      const skipped: number[] = []
      for (let c = 0; c < f.characters.length; c++) {
        const ch = f.characters[c]!
        if (ch.skipped) skipped.push(c)
        else if (!ch.clusterStart) within.push(c)
        if (beyond < 0 && pf.prefix[c]! >= f.width && ch.advance !== 0) beyond = c
      }
      if (beyond >= 0) {
        unobservable.push({ line: pf.line, fact: `${path}.characters[${beyond}..${f.characters.length - 1}].advance`, rule: 'points past the box clamp to its edge: white space trimmed at a break or by TrimTrailingWhiteSpace, and hanging white space past the available width (AbstractRange.cpp:741-743; nsTextFrame.cpp:11203-11240, :11540-11628)' })
      }
      if (within.length > 0) {
        unobservable.push({ line: pf.line, fact: `${path}.characters[${within.join(',')}].advance`, rule: 'an offset inside a cluster snaps to the cluster start, so only a cluster\'s total shows (nsTextFrame.cpp:3549-3558, :8685-8689)' })
      }
      if (skipped.length > 0) {
        unobservable.push({ line: pf.line, fact: `${path}.characters[${skipped.join(',')}]`, rule: 'skipped characters have no advance; their ranges report width 0 at a point (nsTextFrame.cpp:8667-8690)' })
      }
      if (f.usedHyphen) {
        const fragments = layout.lines[pf.line]!.fragments
        for (let n = 0; n < fragments.length; n++) {
          const fragment = fragments[n]!
          if (fragment.kind === 'hyphen' && fragment.at === f.contentEnd) {
            unobservable.push({ line: pf.line, fact: `lines[${pf.line}].fragments[${n}].painted`, rule: 'only the hyphen run\'s advance shows inside the box, not which glyph drew it (nsTextFrame.cpp:6829-6845)' })
          }
        }
      }
    }
  }
  for (let l = 0; l < layout.lines.length; l++) {
    const geometry = layout.lines[l]!.geometry
    if (geometry.impactedByFloats) {
      unobservable.push({ line: l, fact: `lines[${l}].geometry.impactedByFloats`, rule: 'only breaks show whether floats narrowed the band: a first frame that overflows breaks before instead of being placed (nsLineLayout.cpp:785)' })
    }
  }

  return { codePoints, nodes, elements, unobservable }
}
