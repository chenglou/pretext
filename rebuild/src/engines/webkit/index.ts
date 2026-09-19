// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - content.ts: renderers, boxes, font facts, items, bidi splits, stored widths, builder choice, gaps (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, word spacing, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker, the line builders and the display boxes of each line (specs/webkit-lines.md §4-§9).
// The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import type { Gap, LineInspectionOf } from '../../model.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { lineGaps, lineGeometry, type WebKitFilledLine, type WebKitRefusedSlot } from './lines.js'
import type { WebKitPrepared } from './types.js'

export { prepareWebKit as prepare } from './content.js'
export { fillLine, linePieces, type WebKitFillResult, type WebKitFilledLine, type WebKitPaintFacts, type WebKitRefusedSlot } from './lines.js'

// InlineFormattingContext lays out lines whenever the block has inline items, contentful or not; a block whose text
// nodes all lack renderers has none (RenderTreeUpdater.cpp:536-595).
export function firstLine(p: WebKitPrepared): WebKitLineStart | null {
  if (p.items.length === 0) return null
  return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true, hasFloats: false }
}

function inspected(p: WebKitPrepared, what: string): void {
  if (!p.inspect) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
}

// The line's gaps, then its display boxes: the order in which the port has asked Canvas since the rows were first recorded
// (the display boxes ask nothing). A refused slot has gaps and no geometry.
export function inspectLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): LineInspectionOf<WebKitLineGeometry> {
  inspected(p, 'inspectLine')
  const gaps = lineGaps(p, decided)
  switch (decided.kind) {
    case 'line': return { geometry: lineGeometry(p, decided), gaps }
    case 'below-floats': return { geometry: null, gaps }
  }
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: WebKitPrepared): Gap[] {
  inspected(p, 'paragraphGaps')
  return p.gaps
}
