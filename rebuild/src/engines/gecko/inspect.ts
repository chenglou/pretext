// The inspection of a decided line for Gecko (Firefox 156.0): the frames Gecko placed on it, with their boxes after
// TextAlignLine and nsBidiPresUtils::ReorderFrames and their characters' advances (DESIGN.md §2.5; specs/gecko-lines.md
// §5-§6), and the gaps its breaks rest on (gaps.ts lineGaps). Only an inspected paragraph answers, and only here are the
// characters measured: a line's fill and its pieces ask Canvas nothing for them. A pure function of the prepared paragraph
// and the decided line.
import type { LineInspectionOf } from '../../model.js'
import { advanceBefore } from './advance.js'
import { lineGaps } from './gaps.js'
import type { GeckoCharacter, GeckoFrameGeometry, GeckoLineGeometry } from './geometry.js'
import { computeJustification, rangeAdvance, spacingIn, type Band, type FrameResult, type GeckoFilledLine, type GeckoRefusedSlot, type Provider } from './lines.js'
import { lineEndT } from './pieces.js'
import { consume, placeLine, textFramesOf, type ApplicationState, type Placed, type PlacedLeaf, type PlacedLine, type PlacedSpan, type PlacedSpanData, type PlacedText } from './placement.js'
import { isTrimmableChar } from './prepare.js'
import { objectAt, spanAt, type GeckoPrepared } from './types.js'

// Per source unit from the frame's measured start: what GetAdvanceWidth adds for it (gfxTextRun.cpp:1214-1256,
// nsTextFrame.cpp:4089-4295): a cluster's glyph advance on its first character, the spacing after a character on that
// character, a tab's width on the tab. Skipped characters add nothing. `justification` is justificationSpacing's.
function characters(p: GeckoPrepared, r: FrameResult, prov: Provider, justification: number[] | null): { characters: GeckoCharacter[]; standInAtEnd: boolean } {
  const out: GeckoCharacter[] = []
  let before = advanceBefore(p, prov.run, prov.startT)
  // Every position after a stand-in tab sums its width (computeTabs).
  let afterStandInTab = false
  // The frame's next tab at or after the character: both run in text order.
  let tab = 0
  for (let s = r.offset; s < r.contentStart + r.contentLength; s++) {
    const t = p.sourceT[s]!
    if (t === -1) {
      out.push({ skipped: true, clusterStart: false, unitStart: false, advance: 0, standInBefore: false })
      continue
    }
    while (tab < prov.tabs.length && prov.tabs[tab]!.t < t) tab++
    const here = tab < prov.tabs.length && prov.tabs[tab]!.t === t ? prov.tabs[tab]! : null
    const after = advanceBefore(p, prov.run, t + 1)
    out.push({
      skipped: false, clusterStart: p.clusterStart[t] === 1, unitStart: p.units[p.unitOf[t]!]!.tStart === t,
      advance: after.au - before.au + spacingIn(p, prov, t, t + 1) + (here === null ? 0 : here.width) + (justification === null ? 0 : justification[t - prov.startT] ?? 0),
      standInBefore: before.standIn !== null || afterStandInTab,
    })
    before = after
    if (here !== null && here.standIn !== null) afterStandInTab = true
  }
  return { characters: out, standInAtEnd: before.standIn !== null || afterStandInTab }
}

// The frames' visual order: UAX #9 L2 over their levels, as nsBidiPresUtils::ReorderFrames orders a line
// (nsBidiPresUtils.cpp:1494-1533, Bidi::ReorderVisual through unicode-bidi).
function visualOrder(levels: number[]): number[] {
  const order: number[] = []
  let maxLevel = 0
  let minLevel = 255
  for (let k = 0; k < levels.length; k++) {
    order.push(k)
    maxLevel = Math.max(maxLevel, levels[k]!)
    minLevel = Math.min(minLevel, levels[k]!)
  }
  const lowestOdd = (minLevel & 1) === 1 ? minLevel : minLevel + 1
  for (let level = maxLevel; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length;) {
      if (levels[order[i]!]! < level) { i++; continue }
      let j = i
      while (j < order.length && levels[order[j]!]! >= level) j++
      const reversed = order.slice(i, j).reverse()
      for (let q = 0; q < reversed.length; q++) order[i + q] = reversed[q]!
      i = j
    }
  }
  return order
}

// PropertyProvider::SetupJustificationSpacing after reflow (nsTextFrame.cpp:4503-4560): the frame's extra width over its
// natural width, spread over its justifiable characters' gaps: per transformed character from the frame's measured start,
// as far as its trimmed content goes.
function justificationSpacing(p: GeckoPrepared, pf: PlacedText): number[] | null {
  const r = pf.r
  if (p.paragraph.textAlign !== 'justify' || r.prov === null) return null
  const f = p.frames[r.frame]!
  const leaf = p.leaves[f.run]!
  // GetTrimmedOffsets with default flags: the end is trimmed on a frame at the end of the line (:3287-3330).
  let end = r.contentStart + r.contentLength
  if (!leaf.style.whiteSpaceIsSignificant && pf.endOfLine) while (end > r.offset && isTrimmableChar(p.text, end - 1, f.end, leaf.is8bit)) end--
  const { info, assignments } = computeJustification(p, r.frame, r.offset, end)
  const totalGaps = info.inner * 2 + pf.assign.start + pf.assign.end
  if (totalGaps === 0 || assignments.length === 0) return null
  let natural = rangeAdvance(p, r.prov, Math.min(p.nextT[r.offset]!, f.tEnd), Math.min(p.nextT[end]!, f.tEnd), null)
  if (r.usedHyphenation) natural += p.textRuns[f.textRun]!.hyphenAu + r.prov.letterSpacingAu // GetHyphenWidth (:4388-4399)
  const totalSpacing = pf.iSize - natural
  if (totalSpacing <= 0) return null
  assignments[0]!.start = pf.assign.start
  assignments[assignments.length - 1]!.end = pf.assign.end
  const state: ApplicationState = { count: totalGaps, handled: 0, available: totalSpacing, consumed: 0 }
  const out: number[] = []
  for (let i = 0; i < assignments.length; i++) out.push(consume(state, assignments[i]!.start) + consume(state, assignments[i]!.end))
  return out
}

// A placed frame with the geometry made for it, and a span's with its children's: what ReorderFrames walks. `relative` is
// the frame's left edge from its container's.
type Box =
  | { kind: 'span'; placed: PlacedSpan; geometry: Extract<GeckoFrameGeometry, { kind: 'inline' }>; children: Box[]; relative: number }
  | { kind: 'leaf'; placed: PlacedText | PlacedLeaf; geometry: GeckoFrameGeometry; relative: number }

// The placed line's frames in logical order, an inline frame before the frames of its children, with their boxes, and a text
// frame's characters.
function frameGeometry(p: GeckoPrepared, band: Band, placed: PlacedLine): GeckoFrameGeometry[] {
  const { root, indented, dx } = placed
  const rtl = p.paragraph.direction === 'rtl'
  // Positions. Without bidi, frames keep their logical places plus dx (:3654-3668). With bidi, ReorderFrames repositions the
  // line's frames from psd->mIStart + mTextIndent + dx (:3646-3652; nsBidiPresUtils.cpp:1494-1533). x is the physical left edge
  // from the content box.
  const frames: GeckoFrameGeometry[] = []
  // By span element: its frames on this line, the part of its continuation chain IsFirstOrLast counts, in logical order,
  // and how many of them the repositioning hasn't met yet. Gecko keeps the same by frame (nsContinuationStates).
  const chains = new Map<number, { spans: PlacedSpan[]; unplaced: number }>()
  const collect = (psd: PlacedSpanData, origin: number): Box[] => {
    const boxes: Box[] = []
    for (let k = 0; k < psd.frames.length; k++) {
      const pf = psd.frames[k]!
      const logical = origin + pf.iStart
      let geometry: GeckoFrameGeometry
      switch (pf.kind) {
        case 'text': {
          const r = pf.r
          const f = p.frames[r.frame]!
          geometry = {
            kind: 'text', run: f.run, contentStart: r.contentStart, contentEnd: r.contentStart + r.contentLength, measuredStart: r.offset,
            level: f.level, x: logical, width: pf.iSize, hasHeight: r.nonEmpty, usedHyphen: r.usedHyphenation,
            ...(r.prov === null ? { characters: [], standInAtEnd: false } : characters(p, r, r.prov, justificationSpacing(p, pf))),
            advancesStandIn: r.prov === null ? null : r.prov.run.advancesStandIn,
          }
          break
        }
        case 'span': {
          const inline: Extract<GeckoFrameGeometry, { kind: 'inline' }> = { kind: 'inline', element: pf.element, x: logical, width: pf.iSize, hasStartEdge: pf.hasStartEdge, hasEndEdge: pf.hasEndEdge }
          frames.push(inline)
          const chain = chains.get(pf.element)
          if (chain === undefined) chains.set(pf.element, { spans: [pf], unplaced: 1 })
          else { chain.spans.push(pf); chain.unplaced++ }
          boxes.push({ kind: 'span', placed: pf, geometry: inline, children: collect(pf.span, logical), relative: 0 })
          continue
        }
        case 'atomic':
          geometry = { kind: 'atomic', element: pf.element, level: objectAt(p.elements, pf.element).level, x: logical, width: pf.iSize }
          break
        case 'br':
          geometry = { kind: 'br', element: pf.element, x: logical, width: 0 }
          break
        case 'wbr':
          // A WBRFrame is 0 × 0 where it was placed; Firefox reports that box through getClientRects (feature family rows,
          // round 1: `c-00370d538345f01b` reports x 3558 au, width 0, height 0 after a 3558 au frame).
          geometry = { kind: 'wbr', element: pf.element, level: objectAt(p.elements, pf.element).level, x: logical, width: 0 }
          break
      }
      frames.push(geometry)
      boxes.push({ kind: 'leaf', placed: pf, geometry, relative: 0 })
    }
    return boxes
  }
  const boxes = collect(root, 0)
  if (!p.bidi) {
    for (let k = 0; k < frames.length; k++) frames[k]!.x += dx
  } else {
    // BidiLineData orders the line's frames by the levels of their first leaves (GetFrameBidiData, nsBidiPresUtils.cpp:1545-1547),
    // and RepositionInlineFrames walks that order from the line's start edge (:1882-1905). RepositionFrame (:1769-1868) gives a
    // span its edges and margins by visual order (IsFirstOrLast :1561-1671) and walks its children left to right at an even
    // level and right to left at an odd one; a frame's start margin comes first in its container's walk. Every container
    // takes the block's direction. Places come out relative to the containing frame, then add up.
    const paragraphLevel = rtl ? 1 : 0
    const levelOf = (pf: Placed): number => {
      switch (pf.kind) {
        case 'text': return p.frames[pf.r.frame]!.level
        case 'span': return pf.span.frames.length > 0 ? levelOf(pf.span.frames[0]!) : paragraphLevel
        default: return objectAt(p.elements, pf.element).level
      }
    }
    const place = (box: Box, isEven: boolean, startOrEnd: number, containerReverse: boolean, containerWidth: number): number => {
      let icoord = box.placed.iSize
      let marginStart = box.placed.kind === 'atomic' ? box.placed.startMargin : 0
      let marginEnd = box.placed.kind === 'atomic' ? box.placed.endMargin : 0
      if (box.kind === 'span') {
        const pf = box.placed
        const el = spanAt(p.elements, pf.element)
        const chain = chains.get(pf.element)!
        const isFirst = chain.unplaced === chain.spans.length && chain.spans[0]!.hasStartEdge
        const isLast = chain.unplaced === 1 && chain.spans[chain.spans.length - 1]!.hasEndEdge
        chain.unplaced--
        const startBP = isFirst ? el.edges.startBorderPadding : 0
        const endBP = isLast ? el.edges.endBorderPadding : 0
        marginStart = isFirst ? el.edges.startMargin : 0
        marginEnd = isLast ? el.edges.endMargin : 0
        // The reflowed size less the edges applied in continuation order, plus the visual ones (:1806-1826).
        const width = pf.iSize - (pf.hasStartEdge ? el.edges.startBorderPadding : 0) - (pf.hasEndEdge ? el.edges.endBorderPadding : 0) + startBP + endBP
        const reverseDir = isEven === rtl
        icoord = reverseDir ? endBP : startBP
        for (let k = 0; k < box.children.length; k++) icoord += place(box.children[k]!, isEven, icoord, reverseDir, width)
        icoord += reverseDir ? startBP : endBP
        box.geometry.width = icoord
        box.geometry.hasStartEdge = isFirst
        box.geometry.hasEndEdge = isLast
      }
      const frameStartOrEnd = startOrEnd + (containerReverse ? marginEnd : marginStart)
      const iStartInContainer = containerReverse ? containerWidth - frameStartOrEnd - icoord : frameStartOrEnd
      box.relative = rtl ? containerWidth - iStartInContainer - icoord : iStartInContainer
      return icoord + marginStart + marginEnd
    }
    const levels = root.frames.map(levelOf)
    const order = visualOrder(levels)
    let acc = root.iStart + (indented ? p.textIndentAu : 0) + dx
    for (let v = 0; v < order.length; v++) {
      const index = rtl ? order[order.length - 1 - v]! : order[v]!
      acc += place(boxes[index]!, (levels[index]! & 1) === 0, acc, false, band.containerWidth)
    }
    const settle = (list: Box[], origin: number): void => {
      for (let k = 0; k < list.length; k++) {
        const box = list[k]!
        box.geometry.x = origin + box.relative
        if (box.kind === 'span') settle(box.children, box.geometry.x)
      }
    }
    settle(boxes, 0)
  }
  return frames
}

// The line as Gecko places it: TrimTrailingWhiteSpaceIn and TextAlignLine (placement.ts), then ReorderFrames, give the
// frames' boxes and positions. The characters are measured before the in-word report, which reads them and asks for the
// positions it needs. A refused slot has the gaps its passes raised and no geometry.
export function inspectLine(p: GeckoPrepared, decided: GeckoFilledLine | GeckoRefusedSlot): LineInspectionOf<GeckoLineGeometry> {
  const plain = (): Error => new Error('inspectLine reads an inspected paragraph, and this one was prepared plain')
  switch (decided.kind) {
    case 'below-floats':
      if (decided.gaps === null) throw plain()
      return { geometry: null, gaps: decided.gaps }
    case 'line': {
      if (decided.inspect === null) throw plain()
      const band = decided.band
      const placed = placeLine(p, decided)
      const frames = frameGeometry(p, band, placed)
      const texts = textFramesOf(placed.root)
      return {
        geometry: {
          appUnitsPerDevPixel: p.appUnitsPerDevPixel, lineLeft: band.left, availableWidth: band.iSize, impactedByFloats: band.impactedByFloats,
          textIndent: placed.indented ? p.textIndentAu : 0, width: placed.lineISize + placed.expansion, hang: placed.hang, alignOffset: placed.dx, frames,
        },
        gaps: lineGaps(p, decided.start, decided.inspect, frames, texts, lineEndT(p, texts)),
      }
    }
  }
}
