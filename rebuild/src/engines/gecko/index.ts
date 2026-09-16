// Gecko (Firefox 156.0, ICU4X icu_segmenter 2.1.2 with Firefox's baked data).
// - prepare.ts: frames, bidi splits, text runs, TransformText, glyph flags, nsLineBreaker breaks, spacing and unit
//   advances (specs/gecko-text.md, specs/gecko-canvas.md §2-§3).
// - linebreak.ts: nsLineBreaker and the ICU4X line iterator (specs/gecko-text.md §8-§10).
// - lines.ts: the line loop with one redo, trimming and fragments (specs/gecko-lines.md §4-§6).
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import { firstGeckoLine, nextGeckoLine } from './lines.js'
import { prepareGecko } from './prepare.js'
import type { GeckoLineStart, GeckoPrepared } from './types.js'

export const geckoEngine: EngineImplementation<GeckoPrepared, GeckoLineStart> = {
  prepare(paragraph: Paragraph, env: Environment, measurer: Measurer): GeckoPrepared {
    return prepareGecko(paragraph, env, measurer)
  },

  firstLine(prepared: GeckoPrepared): GeckoLineStart | null {
    return firstGeckoLine(prepared)
  },

  nextLine(prepared: GeckoPrepared, start: GeckoLineStart, availableWidth: number, measurer: Measurer): LineOf<GeckoLineStart> {
    return nextGeckoLine(prepared, start, availableWidth, measurer)
  },

  gaps(prepared: GeckoPrepared): Gap[] {
    return prepared.gaps
  },
}
