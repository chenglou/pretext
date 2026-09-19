// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - content.ts: renderers, boxes, font facts, items, bidi splits, stored widths, builder choice, gaps (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, word spacing, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker, the line builders and the display boxes of each line (specs/webkit-lines.md §4-§9).
// The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import type { FillResultOf, Gap, LineInspectionOf, LinePieces, LineSlot } from '../../model.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { webkitNextLine } from './lines.js'
import type { WebKitLine, WebKitPrepared } from './types.js'

export { prepareWebKit as prepare } from './content.js'

// InlineFormattingContext lays out lines whenever the block has inline items, contentful or not; a block whose text
// nodes all lack renderers has none (RenderTreeUpdater.cpp:536-595).
export function firstLine(p: WebKitPrepared): WebKitLineStart | null {
  if (p.items.length === 0) return null
  return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true, hasFloats: false }
}

// The decided line: for now what webkitNextLine returns, which computes the line's pieces, display boxes and gaps while it
// fills, so linePieces and inspectLine only read; and the start it was filled from, whose carried width the painter reads.
export type WebKitFilledLine = { engine: 'webkit'; kind: 'line'; from: WebKitLineStart; line: WebKitLine }
export type WebKitRefusedSlot = { engine: 'webkit'; kind: 'below-floats'; gaps: Gap[] }
export type WebKitFillResult = FillResultOf<WebKitLineStart, WebKitFilledLine, WebKitRefusedSlot>
// What WebKit's painting rules read beside the pieces: the width the breaker carried into the line's first text, which
// the painted line measures again, and whether the line holds an RTL run WebKit shaped across inline boxes.
export type WebKitPaintFacts = { carriedWidth: number | null; shapedAcrossBoxes: boolean }

export function fillLine(p: WebKitPrepared, start: WebKitLineStart, slot: LineSlot): WebKitFillResult {
  const result = webkitNextLine(p, start, slot, p.measurer)
  switch (result.kind) {
    case 'line': return { kind: 'line', line: { engine: 'webkit', kind: 'line', from: start, line: result.line }, start: result.line.start, end: result.line.end, next: result.line.next, hasLineBox: result.line.hasLineBox }
    // The refused build placed the slot floats, so the next slot starts from another state (lines.ts buildLine).
    case 'below-floats': return { kind: 'below-floats', line: { engine: 'webkit', kind: 'below-floats', gaps: result.gaps }, next: result.next ?? start }
  }
}

export function linePieces(_p: WebKitPrepared, filled: WebKitFilledLine): LinePieces<WebKitPaintFacts> {
  const { from, line } = filled
  const g = line.geometry
  let shapedAcrossBoxes = false
  for (let k = 0; k < g.boxes.length; k++) {
    const box = g.boxes[k]!
    if ((box.kind === 'text' || box.kind === 'soft-line-break') && box.shapedAcrossBoxes) shapedAcrossBoxes = true
  }
  return {
    fragments: line.fragments, joinsNextLine: line.joinsNextLine, indented: line.indented, align: line.align,
    overflows: g.contentWidth - g.hangingWidth - g.lineBoxWidth > 0,
    facts: { carriedWidth: from.offset > 0 && from.previousLine !== null ? from.previousLine.carriedWidth : null, shapedAcrossBoxes },
  }
}

function inspected(p: WebKitPrepared, what: string): void {
  if (!p.inspect) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
}

export function inspectLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): LineInspectionOf<WebKitLineGeometry> {
  inspected(p, 'inspectLine')
  switch (decided.kind) {
    case 'line': return { geometry: decided.line.geometry, gaps: decided.line.gaps }
    case 'below-floats': return { geometry: null, gaps: decided.gaps }
  }
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: WebKitPrepared): Gap[] {
  inspected(p, 'paragraphGaps')
  return p.gaps
}
