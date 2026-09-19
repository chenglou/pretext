// Placing a decided line for Gecko (Firefox 156.0): nsLineLayout::TrimTrailingWhiteSpaceIn, then TextAlignLine with the
// hang of a wrapped line and justification (ComputeFrameJustification, ApplyFrameJustification). specs/gecko-lines.md §5.
// Gecko writes all of it into the frames' line data. A decided line isn't written after its fill (lines.ts), so placeLine
// makes its own records from the line's spans, writes those and returns them: the line's pieces and its inspection each
// place the line for themselves, and nothing placed is kept on the line.
import type { TextAlign } from '../../model.js'
import { NO_JUSTIFICATION, rangeAdvance, type Assignment, type FrameResult, type GeckoFilledLine, type Justification, type SpanData } from './lines.js'
import { isTrimmableChar } from './prepare.js'
import { spanAt, type GeckoPrepared } from './types.js'

// A frame of the line as placement has it: reflow's inline start and size (lines.ts Reflowed), which trimming and
// justification move, and what they record. A frame's reflow result is shared: nothing writes it.
export type PlacedText = {
  kind: 'text'; item: number; r: FrameResult; iStart: number; iSize: number
  // Where the frame's content ends once TrimTrailingWhiteSpace took its trailing white space.
  trimmedEnd: number
  // TEXT_END_OF_LINE: TrimTrailingWhiteSpace ran on the frame (nsTextFrame.cpp:11549); the justification info after
  // CancelOpportunityForTrimmedSpace (nsLineLayout.cpp:2943); the gaps the line assigned to its sides.
  endOfLine: boolean; justification: Justification; assign: Assignment
}
export type PlacedSpan = { kind: 'span'; element: number; span: PlacedSpanData; iStart: number; iSize: number; hasStartEdge: boolean; hasEndEdge: boolean }
export type PlacedLeaf = { kind: 'atomic' | 'br' | 'wbr'; element: number; iStart: number; iSize: number; startMargin: number; endMargin: number; assign: Assignment }
export type Placed = PlacedText | PlacedSpan | PlacedLeaf
// What placement reads and writes of a span's line data (nsLineLayout::PerSpanData).
export type PlacedSpanData = { iStart: number; iCoord: number; iEnd: number; frames: Placed[]; hasNonemptyContent: boolean }

function placedFrom(psd: SpanData): PlacedSpanData {
  const frames: Placed[] = []
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    switch (pf.kind) {
      case 'text':
        frames.push({ ...pf, trimmedEnd: pf.r.contentStart + pf.r.contentLength, endOfLine: false, justification: { ...pf.r.justification }, assign: { start: 0, end: 0 } })
        break
      case 'span': frames.push({ ...pf, span: placedFrom(pf.span) }); break
      case 'atomic': case 'br': case 'wbr': frames.push({ ...pf, assign: { start: 0, end: 0 } }); break
    }
  }
  return { iStart: psd.iStart, iCoord: psd.iCoord, iEnd: psd.iEnd, frames, hasNonemptyContent: psd.hasNonemptyContent }
}

// nsLineLayout::TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985) over one span: from the last frame back, a child span
// is searched first, a frame that isn't text and isn't skipped when trimming (anything but a <br>) ends the search, and a
// text frame not already trimmed at its break loses the floored advance of its trailing IsTrimmableSpace characters,
// unclamped (nsTextFrame.cpp:11540-11628). Frames after a trimmed one slide back.
function trimTrailingWhiteSpaceIn(p: GeckoPrepared, psd: PlacedSpanData): { handled: boolean; delta: number } {
  for (let k = psd.frames.length - 1; k >= 0; k--) {
    const pf = psd.frames[k]!
    let delta = 0
    let handled = false
    if (pf.kind === 'span') {
      const inner = trimTrailingWhiteSpaceIn(p, pf.span)
      if (!inner.handled) continue
      delta = inner.delta
      handled = true
    } else if (pf.kind !== 'text') {
      if (pf.kind === 'br') continue
      return { handled: true, delta: 0 }
    } else {
      const r = pf.r
      const f = p.frames[r.frame]!
      const leaf = p.leaves[f.run]!
      const contentEnd = r.contentStart + r.contentLength
      pf.endOfLine = true
      let changed = false
      if (!leaf.style.whiteSpaceIsSignificant && !r.trimmedTrailingWhitespace && r.prov !== null) {
        let end = contentEnd
        while (end > r.offset && isTrimmableChar(p.text, end - 1, f.end, leaf.is8bit)) end--
        pf.trimmedEnd = end
        const tA = Math.min(p.nextT[end]!, f.tEnd)
        const tB = Math.min(p.nextT[contentEnd]!, f.tEnd)
        if (tA < tB) {
          delta = Math.floor(rangeAdvance(p, r.prov, tA, tB, null))
          changed = true
        }
      }
      handled = r.nonEmpty || changed
    }
    if (delta !== 0) {
      if (pf.kind === 'text') {
        // JustificationInfo::CancelOpportunityForTrimmedSpace (JustificationUtils.h).
        if (pf.justification.inner > 0) pf.justification.inner--
        else pf.justification = { ...pf.justification, startJustifiable: false, endJustifiable: false }
      }
      pf.iSize -= delta
      psd.iCoord -= delta
      for (let j = k + 1; j < psd.frames.length; j++) psd.frames[j]!.iStart -= delta
    }
    if (handled) return { handled: true, delta }
  }
  return { handled: false, delta: 0 }
}

// The frame nsLineLayout::GetTrimFrom and nsLineLayout::GetHangFrom read (nsLineLayout.cpp:3452-3478, :3416-3450): the
// line's last frame, inside the span the line ends with, frames skipped when trimming (<br>) passed over; null where that
// isn't a text frame.
function lastTextFrame(psd: PlacedSpanData): PlacedText | null {
  for (let k = psd.frames.length - 1; k >= 0; k--) {
    const pf = psd.frames[k]!
    if (pf.kind === 'span') return lastTextFrame(pf.span)
    if (pf.kind === 'text') return pf
    if (pf.kind !== 'br') return null
  }
  return null
}

// nsLineLayout::PerFrameData::ParticipatesInJustification (nsLineLayout.cpp:2993-3004): not empty, not skipped when trimming
// (<br>), and not a white-space-only text node's frame at the end of the line.
function participatesInJustification(p: GeckoPrepared, pf: Placed): boolean {
  switch (pf.kind) {
    case 'br': return false
    case 'span': return pf.span.hasNonemptyContent || !spanAt(p.elements, pf.element).selfEmpty
    case 'atomic': case 'wbr': return true
    case 'text': {
      if (!pf.r.nonEmpty) return false
      if (!pf.endOfLine) return true
      // TextIsOnlyWhitespace of the node (CharacterData.cpp:486-510).
      const leaf = p.leaves[p.frames[pf.r.frame]!.run]!
      for (let s = leaf.start; s < leaf.end; s++) {
        const u = p.text.charCodeAt(s)
        if (u !== 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d) return true
      }
      return false
    }
  }
}

type ComputationState = { last: PlacedText | PlacedLeaf | null }
const justificationOf = (pf: PlacedText | PlacedLeaf): Justification => pf.kind === 'text' ? pf.justification : NO_JUSTIFICATION

// nsLineLayout::AssignInterframeJustificationGaps (nsLineLayout.cpp:3031-3080), without ruby.
function assignInterframeGaps(pf: PlacedText | PlacedLeaf, state: ComputationState): number {
  const prev = state.last!
  const info = justificationOf(pf)
  const prevInfo = justificationOf(prev)
  if (!info.startJustifiable && !prevInfo.endJustifiable) return 0
  if (!info.startJustifiable) {
    prev.assign.end = 2
    pf.assign.start = 0
  } else if (!prevInfo.endJustifiable) {
    prev.assign.end = 0
    pf.assign.start = 2
  } else {
    prev.assign.end = 1
    pf.assign.start = 1
  }
  return 1
}

// nsLineLayout::ComputeFrameJustification (nsLineLayout.cpp:3084-3150): the span's inner opportunities into `inner`, and
// the opportunities before its first participant returned.
function computeFrameJustification(p: GeckoPrepared, psd: PlacedSpanData, state: ComputationState, inner: { count: number }): number {
  let firstChild = true
  let outer = 0
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    if (!participatesInJustification(p, pf)) continue
    let extra = 0
    if (pf.kind === 'span') {
      const spanInner = { count: 0 }
      extra = computeFrameJustification(p, pf.span, state, spanInner)
      inner.count += spanInner.count
    } else {
      if (pf.kind === 'text') inner.count += pf.justification.inner
      if (state.last !== null) extra = assignInterframeGaps(pf, state)
      state.last = pf
    }
    if (firstChild) {
      outer = extra
      firstChild = false
    } else {
      inner.count += extra
    }
  }
  return outer
}

// JustificationApplicationState (JustificationUtils.h).
export type ApplicationState = { count: number; handled: number; available: number; consumed: number }
export function consume(state: ApplicationState, gaps: number): number {
  state.handled += gaps
  const allocated = Math.trunc((state.available * state.handled) / state.count)
  const delta = allocated - state.consumed
  state.consumed = allocated
  return delta
}

// nsLineLayout::ApplyFrameJustification (nsLineLayout.cpp:3220-3275), without annotations: each participant takes its gaps'
// share of the remaining width, frames after it move, and a leaf that isn't text takes its gaps as margins.
function applyFrameJustification(p: GeckoPrepared, psd: PlacedSpanData, state: ApplicationState): number {
  let deltaICoord = 0
  const justifiable = state.count > 0 && state.available > 0
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    let dw = 0
    if (participatesInJustification(p, pf)) {
      if (pf.kind === 'text') {
        if (justifiable) dw = consume(state, pf.justification.inner * 2 + pf.assign.start + pf.assign.end)
        else pf.assign = { start: 0, end: 0 }
      } else if (pf.kind === 'span') {
        dw = applyFrameJustification(p, pf.span, state)
      }
    }
    pf.iSize += dw
    let gapsAtEnd = 0
    if (pf.kind !== 'text' && pf.kind !== 'span' && pf.assign.start + pf.assign.end > 0) {
      deltaICoord += consume(state, pf.assign.start)
      gapsAtEnd = consume(state, pf.assign.end)
      dw += gapsAtEnd
    }
    pf.iStart += deltaICoord
    deltaICoord += dw
  }
  return deltaICoord
}

// A decided line placed: its spans after trimming and alignment, and what TextAlignLine computed on the way.
export type PlacedLine = {
  root: PlacedSpanData
  // The engine applied the paragraph's text-indent to the line.
  indented: boolean
  // The alignment TextAlignLine used: text-align, or start for the last line and a line ending in <br> under justify.
  align: TextAlign
  // psd->mICoord from the root span's start after trimming, and what justification added to it.
  lineISize: number
  expansion: number
  // GetHangFrom, or GetTrimFrom's advance under justify; 0 on a line that isn't wrapped.
  hang: number
  // The inline offset alignment gives the line's frames.
  dx: number
}

// The text frames of a line's spans in logical order.
export function textFramesOf(psd: PlacedSpanData, out: PlacedText[] = []): PlacedText[] {
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    if (pf.kind === 'text') out.push(pf)
    else if (pf.kind === 'span') textFramesOf(pf.span, out)
  }
  return out
}

export function placeLine(p: GeckoPrepared, line: GeckoFilledLine): PlacedLine {
  const root = placedFrom(line.root)
  trimTrailingWhiteSpaceIn(p, root)
  const rtl = p.paragraph.direction === 'rtl'
  const indented = line.start.isFirstLine && p.textIndentAu !== 0

  // TextAlignLine (nsLineLayout.cpp:3482-3670): the remaining inline size and, on a wrapped line, the hang.
  const availISize = root.iEnd - root.iStart
  const lineISize = root.iCoord - root.iStart
  const remaining = availISize - lineISize
  // TextAlignForLastLine: text-align-last auto gives the last line and a line ending in <br> start under justify
  // (nsBlockFrame.cpp:5966-5976). On a wrapped line justify reads GetTrimFrom's white space, other alignments the hang
  // (:3505-3516).
  const isLastLine = line.next.item >= p.items.length
  const align: TextAlign = p.paragraph.textAlign === 'justify' && (line.lineEndsInBR || isLastLine) ? 'start' : p.paragraph.textAlign
  // GetTrimFrom gives that frame's TrimmableWS and GetHangFrom its hangable white space, negated when its text run's direction
  // is against the line's.
  let hang = 0
  let trimCount = 0
  const last = line.lineWrapped ? lastTextFrame(root) : null
  if (last !== null) {
    const against = ((p.frames[last.r.frame]!.level & 1) === 1) !== rtl
    if (align === 'justify') {
      const ws = last.r.trimmableWS
      if (ws !== null) {
        hang = against ? -ws.advance : ws.advance
        trimCount = ws.count
      }
    } else if (last.r.hangableISize !== 0) {
      hang = against ? -last.r.hangableISize : last.r.hangableISize
    }
  }
  let dx = 0
  let expansion = 0
  if (remaining > 0 || hang !== 0) {
    switch (align) {
      case 'justify': {
        const inner = { count: 0 }
        computeFrameJustification(p, root, { last: null }, inner)
        const opportunities = inner.count - (hang !== 0 ? trimCount : 0)
        if (opportunities > 0) {
          const available = remaining + Math.abs(hang)
          expansion = applyFrameJustification(p, root, { count: opportunities * 2, handled: 0, available, consumed: 0 })
          if (hang < 0) dx = hang - Math.trunc((trimCount * available) / opportunities)
          break
        }
        if (hang < 0) dx = hang
        break
      }
      case 'start': if (hang < 0) dx = hang; break
      case 'left': dx = rtl ? remaining + Math.max(hang, 0) : hang < 0 ? hang : 0; break
      case 'right': dx = !rtl ? remaining + Math.max(hang, 0) : hang < 0 ? hang : 0; break
      case 'end': dx = remaining + Math.max(hang, 0); break
      case 'center': dx = Math.trunc((remaining + hang) / 2); break
    }
  }
  return { root, indented, align, lineISize, expansion, hang, dx }
}
