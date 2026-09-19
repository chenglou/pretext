// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - content.ts: renderers, boxes, font facts, items, bidi splits, stored widths, builder choice, gaps (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, word spacing, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker, the line builders and the display boxes of each line (specs/webkit-lines.md §4-§9).
import { prepareWebKit } from './content.js'
import type { WebKitLineStart } from './geometry.js'
import { webkitNextLine } from './lines.js'
import type { WebKitPrepared } from './types.js'

export const webkitEngine = {
  prepare: prepareWebKit,

  // InlineFormattingContext lays out lines whenever the block has inline items, contentful or not; a block whose text
  // nodes all lack renderers has none (RenderTreeUpdater.cpp:536-595).
  firstLine(prepared: WebKitPrepared): WebKitLineStart | null {
    if (prepared.items.length === 0) return null
    return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true, hasFloats: false }
  },

  nextLine: webkitNextLine,

  gaps(prepared: WebKitPrepared) {
    return prepared.gaps
  },
}
