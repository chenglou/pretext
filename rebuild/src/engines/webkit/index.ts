// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - content.ts: renderers, boxes, font facts, items, bidi splits, stored widths, builder choice (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, word spacing, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker, the line builders, and the decided line (specs/webkit-lines.md §4-§9).
// - output.ts: what is read from a decided line: the pieces a painter takes, and the geometry with the display boxes.
// - gaps.ts: every gap, and what an inspected paragraph keeps for them: box facts and history worlds (DESIGN.md §5).
// The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import type { LineInspectionOf } from '../../model.js'
import { lineGaps } from './gaps.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { sourceOffset, type WebKitFilledLine, type WebKitRefusedSlot } from './lines.js'
import { lineGeometry } from './output.js'
import type { WebKitPrepared } from './types.js'

export { prepareWebKit as prepare } from './content.js'
export { paragraphGaps } from './gaps.js'
export { fillLine, type WebKitFillResult, type WebKitFilledLine, type WebKitRefusedSlot } from './lines.js'
export { linePieces, type WebKitPaintFacts } from './output.js'

// InlineFormattingContext lays out lines whenever the block has inline items, contentful or not; a block whose text
// nodes all lack renderers has none (RenderTreeUpdater.cpp:536-595).
export function firstLine(p: WebKitPrepared): WebKitLineStart | null {
  if (p.items.length === 0) return null
  return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true, hasFloats: false }
}

// The line's gaps, then its display boxes: the order in which the port has asked Canvas since the rows were first recorded
// (the display boxes ask nothing). A refused slot has gaps and no geometry. It throws on a paragraph prepared plain.
export function inspectLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): LineInspectionOf<WebKitLineGeometry> {
  const gaps = lineGaps(p, decided)
  switch (decided.kind) {
    case 'line': return { geometry: lineGeometry(p, decided), gaps }
    case 'below-floats': return { geometry: null, gaps }
  }
}

// ---- research/capability-check: two tiny exports that prove a point, unmerged ----

// The width a line's alignment uses, in CSS px (DESIGN.md §2.6): Line::contentLogicalWidth less the hanging white space,
// float32 px at page zoom. It asks Canvas nothing.
export function lineWidth(p: WebKitPrepared, filled: WebKitFilledLine): number {
  return (filled.line.contentLogicalWidth - (filled.line.hanging === null ? 0 : filled.line.hanging.width)) / p.zoom
}

// A line start made from a source offset: the item holding it and the offset inside the item, with no previous line's
// carried width, so the rest of a split item is measured fresh.
export function lineStartAt(p: WebKitPrepared, source: number): WebKitLineStart | null {
  if (source === 0) return firstLine(p)
  for (let index = p.items.length - 1; index >= 0; index--) {
    if (sourceOffset(p, { index, offset: 0 }) > source) continue
    const item = p.items[index]!
    let offset = 0
    if (item.kind === 'text') while (offset < item.end - item.start && sourceOffset(p, { index, offset }) < source) offset++
    const position = item.kind === 'text' && offset === item.end - item.start ? { index: index + 1, offset: 0 } : { index, offset }
    if (position.index === p.items.length) return null
    const before = position.index > 0 ? p.items[position.index - 1]! : null
    const endsWithLineBreak = position.offset === 0 && before !== null && (before.kind === 'soft-line-break' || before.kind === 'hard-line-break')
    return { engine: 'webkit', itemIndex: position.index, offset: position.offset, previousLine: { carriedWidth: null, endsWithLineBreak, carriedFromShaping: false }, isFirstFormattedLine: false, hasFloats: false }
  }
  return null
}
