// What Firefox 156.0 reports through Range.getClientRects() and Element.getClientRects() for a Gecko layout: for each code
// point of the concatenated leaf text, the rects of a Range over it in its leaf's text node; for each leaf the rects of a
// Range over the whole node; for each element its client rects (research/observe-gecko.md, DESIGN.md §9). The rules port
// GetPartialTextRect and ExtractRectFromOffset (dom/base/AbstractRange.cpp:715-831), nsTextFrame::GetPointFromOffset
// (layout/generic/nsTextFrame.cpp:8667-8752), nsLayoutUtils::GetAllInFlowRects (nsLayoutUtils.cpp:3477-3505, 3661-3667) and
// DOMRect::SetLayoutRect (dom/base/DOMRect.cpp:152-164) over the frames the engine placed. Types only from
// rebuild/src/model.ts: no expected value comes from the library's logic, and the tree is walked here, not through
// src/content.ts (DESIGN.md §8.1).
import type {
  Expected, ExpectedObservation, ExpectedRect, GeckoFrameGeometry, GeckoLayout, GeckoTextFrame, InlineNode, ObservationPort, Paragraph,
  UnobservableFact,
} from '../../src/model.ts'

// DOMRect::SetLayoutRect rounds each app-unit edge to 1/65536 px, and SetRect narrows each field to float32 on its own
// (DOMRect.cpp:152-164, DOMRect.h:122-127). TransformFrameRectToAncestor's float32 round trip returns integer au below
// 2^23 au (nsLayoutUtils.cpp:2517-2537), so the edges are the frames' own.
const R = (au: number): number => Math.floor(au * (65536 / 60) + 0.5) / 65536

export function encodeEdges(a0: number, a1: number): { x: number; width: number } {
  return { x: Math.fround(R(a0)), width: Math.fround(R(a1) - R(a0)) }
}

// An inline position in au and whether it rests on a Canvas stand-in for glyph records.
type Edge = { au: number; limited: boolean }

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

  // Whether the advance before source offset s in frame f rests on the in-word stand-in: s is inside the frame's measured
  // content and the first kept character from s doesn't begin a shaping unit. The DOM's glyph records inside a unit come
  // from one shaping of the unit, which Canvas can't show, so the layout's characters there are W(unit) − W(suffix)
  // (DESIGN.md §5, `in-word-prefix`). The frame's edges and box are engine output and predicted.
  const inWord = (f: GeckoTextFrame, s: number): boolean => {
    for (let c = s - f.measuredStart; c < f.characters.length; c++) {
      const ch = f.characters[c]!
      if (!ch.skipped) return !ch.unitStart
    }
    return false
  }

  // nsTextFrame::GetPointFromOffset in frame-local au (nsTextFrame.cpp:8667-8752): clamp to the content and the trimmed
  // start (GetTrimmedOffsets without trimming the end, :3287-3330), snap back to the cluster start (FindClusterStart,
  // :3549-3558), sum the advances from the trimmed start, and count from the box's right edge in an RTL text run. The sum
  // rests on the stand-in where either end of it is inside a shaping unit.
  const point = (pf: PlacedFrame, offset: number): Edge => {
    const f = pf.frame
    let o = Math.max(f.contentStart, Math.min(f.contentEnd, offset))
    o = Math.max(f.measuredStart, Math.min(f.contentEnd, o))
    const at = (s: number) => f.characters[s - f.measuredStart]!
    if (o < f.contentEnd && !at(o).skipped && !at(o).clusterStart) {
      while (o > f.measuredStart && !at(o).skipped && !at(o).clusterStart) o--
    }
    const iSize = pf.prefix[o - f.measuredStart]!
    const limited = o > f.measuredStart && o < f.contentEnd && (inWord(f, f.measuredStart) || inWord(f, o))
    return pf.rtl ? { au: f.width - iSize, limited } : { au: iSize, limited }
  }
  // nsRect::ClampPoint into the rect as already cut (gfx/2d/BaseRect.h:701-705).
  const clamp = (p: Edge, lo: Edge, hi: Edge): Edge => {
    if (p.au <= lo.au) return { au: lo.au, limited: p.limited || lo.limited }
    if (p.au >= hi.au) return { au: hi.au, limited: p.limited || hi.limited }
    return p
  }
  const expected = (value: number, limited: boolean): Expected =>
    limited ? { state: 'limited', gap: 'in-word-prefix', value } : { state: 'predicted', value }
  const rect = (pf: PlacedFrame, x0: Edge, x1: Edge): ExpectedRect => {
    const encoded = encodeEdges(pf.frame.x + x0.au, pf.frame.x + x1.au)
    return { line: pf.line, x: expected(encoded.x, x0.limited), width: expected(encoded.width, x0.limited || x1.limited) }
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
        let x0: Edge = { au: 0, limited: false }
        let x1: Edge = { au: f.width, limited: false }
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
    nodes.push(framesOfRun[r]!.map(pf => rect(pf, { au: 0, limited: false }, { au: pf.frame.width, limited: false })))
  }

  // Element.getClientRects: GetAllInFlowRects walks an element's primary frame and its continuations, one border box each
  // (nsLayoutUtils.cpp:3477-3505, :3661-3667): a span's inline frame on each line, an inline-block's box, a BRFrame's box,
  // a WBRFrame's 0 × 0 box.
  const elements: ExpectedRect[][] = elementKinds.map(() => [])
  for (let e = 0; e < elementFrames.length; e++) {
    const { line, frame } = elementFrames[e]!
    const encoded = encodeEdges(frame.x, frame.x + frame.width)
    elements[frame.element]!.push({ line, x: expected(encoded.x, false), width: expected(encoded.width, false) })
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
