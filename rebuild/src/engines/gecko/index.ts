// Gecko (Firefox 156.0, ICU4X icu_segmenter 2.1.2 with Firefox's baked data, bundled ICU 78.3).
// - prepare.ts: frames, element items, bidi splits, text runs, TransformText, glyph flags, nsLineBreaker breaks, spacing
//   and unit advances (specs/gecko-text.md, specs/gecko-canvas.md §2-§3).
// - linebreak.ts: nsLineBreaker and the ICU4X line iterator (specs/gecko-text.md §8-§10); likely.ts: the language test.
// - fonts.ts: family lists, the text-run font equality and the font facts.
// - lines.ts: the line loop over per-span line data with one redo, the band a slot gives, trimming, hanging, alignment,
//   positions and the placed frames (specs/gecko-lines.md §4-§6).
import type { GeckoEnvironment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, GeckoLineGeometry, GeckoLineResult, LineSlot, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import { firstGeckoLine, nextGeckoLine } from './lines.js'
import { prepareGecko } from './prepare.js'
import type { GeckoLineStart, GeckoPrepared } from './types.js'

export const geckoEngine: EngineImplementation<GeckoEnvironment, GeckoPrepared, GeckoLineStart, GeckoLineGeometry> = {
  prepare(paragraph: Paragraph, env: GeckoEnvironment, measurer: Measurer): GeckoPrepared {
    return prepareGecko(paragraph, env, measurer)
  },

  firstLine(prepared: GeckoPrepared): GeckoLineStart | null {
    return firstGeckoLine(prepared)
  },

  nextLine(prepared: GeckoPrepared, start: GeckoLineStart, slot: LineSlot, measurer: Measurer): GeckoLineResult {
    return nextGeckoLine(prepared, start, slot, measurer)
  },

  gaps(prepared: GeckoPrepared): Gap[] {
    return prepared.gaps
  },
}
