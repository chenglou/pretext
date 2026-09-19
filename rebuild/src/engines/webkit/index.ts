// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - types.ts: the prepared paragraph, its boxes and items, and a decided line with its runs.
// - content.ts: renderers, boxes, font facts, builder choice; items.ts: the items, bidi splits and stored widths
//   (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, word spacing, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker, the line builders, and the decided line (specs/webkit-lines.md §4-§9).
// - output.ts: what is read from a decided line: the pieces a painter takes, and the geometry with the display boxes.
// - gaps.ts: every gap's condition, prose and merge rule, and the box facts an inspected paragraph keeps for them
//   (DESIGN.md §5); history.ts: its history worlds, and a decided line laid out in them.
// Imports run one way: types, data and breaks, measure, gaps, then items and lines, output, history, content (which collects
// the history worlds as it prepares), and this file. The exports are the function set index.ts dispatches to
// (DESIGN.md §2.9).
import type { LineInspectionOf } from '../../model.js'
import { lineGaps } from './gaps.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { pageHistoryGaps } from './history.js'
import { lineGeometry } from './output.js'
import type { WebKitFilledLine, WebKitPrepared, WebKitRefusedSlot } from './types.js'

export { prepareWebKit as prepare } from './content.js'
export { paragraphGaps } from './gaps.js'
export { fillLine } from './lines.js'
export { linePieces, type WebKitPaintFacts } from './output.js'
export type { WebKitFillResult, WebKitFilledLine, WebKitRefusedSlot } from './types.js'

// InlineFormattingContext lays out lines whenever the block has inline items, contentful or not; a block whose text
// nodes all lack renderers has none (RenderTreeUpdater.cpp:536-595).
export function firstLine(p: WebKitPrepared): WebKitLineStart | null {
  if (p.items.length === 0) return null
  return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true, hasFloats: false }
}

// The line's gaps, what its filling raised and measured and then page-history from the history worlds, then its display
// boxes: the order in which the port has asked Canvas since the rows were first recorded (the display boxes ask nothing). A
// refused slot has gaps and no geometry. It throws on a paragraph prepared plain.
export function inspectLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): LineInspectionOf<WebKitLineGeometry> {
  const gaps = lineGaps(p, decided)
  pageHistoryGaps(p, decided, gaps)
  switch (decided.kind) {
    case 'line': return { geometry: lineGeometry(p, decided), gaps }
    case 'below-floats': return { geometry: null, gaps }
  }
}
