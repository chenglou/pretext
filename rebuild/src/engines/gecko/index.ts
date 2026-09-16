// Gecko (Firefox 156.0, ICU4X icu_segmenter 2.1.2 with Firefox's baked data). TODO bodies name the spec sections to
// port. Shared pieces to use:
// - breaks/tables.ts geckoLineRules() with breaks/icu4x.ts icu4xProperty() and the BreakState constants; the line
//   iterator itself (LB9, word options, strictness, SA handling) is Gecko's to port from the groundwork's
//   runtime-parity/gecko/src/icu4x-line.ts, adding the Normal, Loose and Anywhere branches (specs/gecko-text.md §9.3).
// - unicode/unicode-bidi.ts resolveUnicodeBidi(paragraphText after ReplaceSeparators, direction, bidiDataFor('gecko')),
//   one call per chunk that nsBidiPresUtils resolves (specs/bidi.md §3.3).
// - unicode/grapheme.ts graphemeRulesFor('gecko') for SetupClusterBoundaries.
// - measure/canvas.ts contexts with lang = the run's language (explicit), letterSpacing '0.001px' when the resolved letter
//   spacing is not 0 au (ligatures off, no spacing added), direction per bidi run.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import type { GeckoLineStart, GeckoPrepared } from './types.js'

export const geckoEngine: EngineImplementation<GeckoPrepared, GeckoLineStart> = {
  prepare(_paragraph: Paragraph, _env: Environment, _measurer: Measurer): GeckoPrepared {
    // 1. Style predicates and compression modes (specs/gecko-text.md §2), frames for text nodes (§3; 8-bit storage only
    //    counts as white space).
    // 2. Bidi frame splits (§4), text runs across frames (§5.2), TransformText per mapped flow (§6).
    // 3. Invalid characters and shaping units (§7.1-§7.2), cluster starts and emergency flags (§7.3).
    // 4. nsLineBreaker word accumulation across flows with ICU4X per word (§8, §9), SA words (§10), soft hyphens (§11).
    // 5. Integer app-unit advances from Canvas unit totals with the quantization gate, emoji at size × DPR, spacing in JS
    //    (specs/gecko-canvas.md §2 A1-A13, §3 E1-E7; specs/gecko-text.md §12).
    throw new Error('TODO(gecko): prepare, specs/gecko-text.md §2-§13 and specs/gecko-canvas.md §2')
  },

  firstLine(_prepared: GeckoPrepared): GeckoLineStart | null {
    // A block whose only text node is white space at a line boundary gets no frame and no line (specs/gecko-text.md §3).
    throw new Error('TODO(gecko): firstLine, specs/gecko-lines.md §4.1')
  },

  nextLine(_prepared: GeckoPrepared, _start: GeckoLineStart, _availableWidth: number, _measurer: Measurer): LineOf<GeckoLineStart> {
    // 1. Available width in au: NSToIntRound(float(px) × 60) (specs/gecko-lines.md §2.2).
    // 2. reflowLine with at most one redo at the saved optional break (§4.1, §4.7), line state and spans (§4.2),
    //    ReflowFrame and CanPlaceFrame (§4.3), ReflowText (§4.4), BreakAndMeasureText (§4.5), spacing, tabs and soft
    //    hyphens (§4.6), the line-wide break priority (§6).
    // 3. TrimTrailingWhiteSpace and the line box width (§4.8). Fragments carry the frames' levels, with no line-end
    //    rule (specs/bidi.md §6); trimmed white space is a 'trimmed' fragment; joinsNextLine is true where a break inside
    //    one shaped word splits a joining connection (specs/painter.md §3.3 b).
    throw new Error('TODO(gecko): nextLine, specs/gecko-lines.md §4-§6')
  },

  gaps(_prepared: GeckoPrepared): Gap[] {
    // Report where DESIGN.md §5 applies: font-size-quantization, optical-size (opsz fonts under font-optical-sizing auto,
    // system-ui), bitmap-emoji-size (sizes not probed), hyphen-glyph, space-in-shaping (SpaceMayParticipateInShaping),
    // in-word-prefix (emergency, break-all and CJK breaks inside a unit; partial ligatures), font-fallback,
    // dictionary-breaks-unavailable, ui-language (no lang: the regional-prefs locale decides the ja/zh newline rule).
    throw new Error('TODO(gecko): gaps, DESIGN.md §5')
  },
}
