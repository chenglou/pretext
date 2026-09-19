// Gecko (Firefox 156.0, ICU4X icu_segmenter 2.1.2 with Firefox's baked data, bundled ICU 78.3).
// - prepare.ts: frames, element items, bidi splits, text runs, TransformText, glyph flags, nsLineBreaker breaks, spacing
//   and unit advances (specs/gecko-text.md, specs/gecko-canvas.md §2-§3).
// - linebreak.ts: nsLineBreaker and the ICU4X line iterator (specs/gecko-text.md §8-§10); likely.ts: the language test.
// - fonts.ts: family lists, the text-run font equality and the font facts.
// - measure.ts: the Canvas au of a range of transformed text in the script the paragraph gives it; advance.ts: the glyph
//   advance before an offset inside a shaping unit, and why Canvas can't confirm it where it can't, kept per offset on the
//   prepared paragraph. Every Canvas question goes to a context the paragraph holds (measure/canvas.ts); nothing is looked
//   up by string.
// - lines.ts: a fill, the line loop over per-span line data with one redo in the band a slot gives, and the decided line it
//   leaves (specs/gecko-lines.md §4).
// - placement.ts: trimming, hanging, alignment and justification of a decided line; pieces.ts: its fragments; inspect.ts:
//   its placed frames with their positions and characters (specs/gecko-lines.md §5-§6).
// - gaps.ts: every gap, with the measuring only a gap needs. A plain paragraph computes none of it.
// The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
export { prepareGecko as prepare } from './prepare.js'
export { fillLine, firstGeckoLine as firstLine, type GeckoFillResult, type GeckoFilledLine, type GeckoRefusedSlot } from './lines.js'
export { linePieces, type GeckoPaintFacts } from './pieces.js'
export { inspectLine } from './inspect.js'
export { paragraphGaps } from './gaps.js'
