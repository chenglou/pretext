// Blink (Chrome 153.0.8010.48). TODO bodies name the spec sections to port, in order. Shared pieces to use:
// - breaks/tables.ts blinkBreakRules() and blinkLinePairs(); breaks/rbbi.ts RuleBreakIterator (restart at every line
//   start: the ICU text is text_content from the line start, specs/blink-text.md §2.F.1).
// - unicode/ubidi.ts resolveIcuBidi(textContent, direction, bidiDataFor('blink')): ICU's levels, with paragraphs split at
//   class B, and its direction. Bidi is off when the result isn't mixed and the base direction is LTR
//   (specs/blink-text.md §2.D, specs/bidi.md §4, §5.1).
// - unicode/grapheme.ts graphemeRulesFor('blink') for 16-bit kBreakCharacter; 8-bit text uses Blink's own rule.
// - measure/canvas.ts contexts with lang = the run's locale, textRendering 'optimizeLegibility' (whole-run shaping for
//   fonts whose GPOS/GSUB involve the space glyph, specs/blink-canvas.md §1.3, H6), partition '8bit' | '16bit'.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import type { BlinkLineStart, BlinkPrepared } from './types.js'

export const blinkEngine: EngineImplementation<BlinkPrepared, BlinkLineStart> = {
  prepare(_paragraph: Paragraph, _env: Environment, _measurer: Measurer): BlinkPrepared {
    // 1. Content: text nodes that get a LayoutText (specs/blink-text.md §2.A), per-LayoutText strings (§2.B), and
    //    InlineItemsBuilder white-space processing into text_content and items (§2.C.1-§2.C.9), with ExitBlock's
    //    trailing-space removal (§2.C.7).
    // 2. Bidi: is_bidi_enabled_ and SegmentBidiRuns splitting items at level changes (§2.D).
    // 3. Script runs and shaping groups: SegmentScriptRuns (§2.D) and InlineNode::ShapeText grouping (§2.E).
    // 4. Break opportunities: LazyLineBreakIterator settings per style (§2.F.2), locale to rule file (§2.F.3,
    //    specs/blink-canvas.md §2.3 table), NextBreakablePosition with the pair table, break-all, keep-all and soft
    //    hyphens (§2.F.4-§2.F.5), SA segments from env.dictionaryBreaks (DESIGN.md §6).
    // 5. Widths known before filling: shaping group widths in 16.16 at the layout-zoomed size (specs/blink-lines.md
    //    §1.3, §2.3, §3.2; specs/blink-canvas.md §1.5 and §(e)), letter spacing through ctx.letterSpacing, word spacing
    //    added in 16.16 per specs/blink-text.md §2.E.
    throw new Error('TODO(blink): prepare, specs/blink-text.md §2.A-§2.F and specs/blink-lines.md §1-§3')
  },

  firstLine(_prepared: BlinkPrepared): BlinkLineStart | null {
    // An empty paragraph has no line box (CRITIC.md W7 for the WebKit equivalent; Blink: LayoutBlockFlow with no items).
    throw new Error('TODO(blink): firstLine, specs/blink-lines.md §4.1 PrepareNextLine')
  },

  nextLine(_prepared: BlinkPrepared, _start: BlinkLineStart, _availableWidth: number, _measurer: Measurer): LineOf<BlinkLineStart> {
    // 1. Available width: trunc64(width × zoom) and the +1 raw fit bound (specs/blink-lines.md §1.5, §2.2).
    // 2. NextLine and BreakLine over items (§4.1-§4.3); HandleText and BreakText (§5); ShapingLineBreaker::ShapeLine with
    //    line-start and line-end reshapes measured now (§6); item-edge opportunities (§7).
    // 3. Trailing white space (§8.2-§8.3), overflow walk-back and whole-line retries (§9), word-break/overflow-wrap/
    //    line-break modes (§10), soft hyphens and the hyphen retry (§11), tabs at their position (§12), bidi trailing
    //    spaces (§14; HandleForcedLineBreak and HandleBidiControlItem are not ported in the spec, CRITIC.md §5 item 7).
    // 4. Output: LineInfo width in LayoutUnits (§17) converted to CSS px, next break token, and fragments with painted
    //    text and levels after SplitTrailingBidiPreservedSpace (specs/bidi.md §6). The trailing space removed after the
    //    break is a 'trimmed' fragment (§8.3); joinsNextLine is true where HarfBuzz's context joined letters across the
    //    break (specs/painter.md §3.1 a).
    throw new Error('TODO(blink): nextLine, specs/blink-lines.md §4-§17')
  },

  gaps(_prepared: BlinkPrepared): Gap[] {
    // Report where DESIGN.md §5 applies: control-character-width (FF, VT, C0 in collapse modes), soft-hyphen-shaping,
    // hyphen-glyph, unsafe-to-break, script-context, space-in-shaping (legacy kern across spaces), optical-size and
    // bitmap-emoji-size at layout zoom ≠ 1, float32-precision (a Canvas word ≥ 256 zoomed px), font-fallback,
    // dictionary-breaks-unavailable, ui-language (no lang anywhere).
    throw new Error('TODO(blink): gaps, DESIGN.md §5')
  },
}
