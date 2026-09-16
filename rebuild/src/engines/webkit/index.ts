// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1).
// - content.ts: renderers, boxes, items, bidi splits, stored widths, builder choice, gaps (specs/webkit-text.md §2-§6).
// - breaks.ts and data.ts: BreakablePositions, libicucore line tables with Apple's quote overrides (§5, §7.4).
// - measure.ts: TextUtil::width from Canvas totals, tab stops, breakWord (specs/webkit-lines.md §3.3, §8.1).
// - lines.ts: Line, InlineContentBreaker and the line builders (specs/webkit-lines.md §4-§9).
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import { prepareWebKit } from './content.js'
import { webkitNextLine } from './lines.js'
import type { WebKitLineStart, WebKitPrepared } from './types.js'

export const webkitEngine: EngineImplementation<WebKitPrepared, WebKitLineStart> = {
  prepare(paragraph: Paragraph, env: Environment, measurer: Measurer): WebKitPrepared {
    return prepareWebKit(paragraph, env, measurer)
  },

  // A block whose items can't produce a contentful run has no line box: no renderer, only span edges, or only collapsible
  // white space, which collapses at the line start (CRITIC.md W7; probes-safari webkit-lines H13; LineLayoutResult.h:94-105).
  firstLine(prepared: WebKitPrepared): WebKitLineStart | null {
    const collapses = prepared.style.collapse === 'collapse' || prepared.style.collapse === 'preserve-breaks'
    for (let i = 0; i < prepared.items.length; i++) {
      const item = prepared.items[i]!
      if (item.kind === 'soft-line-break' || (item.kind === 'text' && !(item.isWhitespace && collapses))) {
        return { engine: 'webkit', itemIndex: 0, offset: 0, previousLine: null, isFirstFormattedLine: true }
      }
    }
    return null
  },

  nextLine(prepared: WebKitPrepared, start: WebKitLineStart, availableWidth: number, measurer: Measurer): LineOf<WebKitLineStart> {
    return webkitNextLine(prepared, start, availableWidth, measurer)
  },

  gaps(prepared: WebKitPrepared): Gap[] {
    return prepared.gaps
  },
}
