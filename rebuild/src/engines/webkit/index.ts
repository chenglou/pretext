// WebKit (Safari 27.0, WebKit 7625.1.29.11.27, macOS 27 libicucore 78.1). TODO bodies name the spec sections to port.
// Shared pieces to use:
// - breaks/tables.ts webkitBreakRules() and webkitLinePairs(); breaks/rbbi.ts RuleBreakIterator with Apple's quote
//   overrides (CategoryOverrides from the locale's CLDR delimiters, specs/webkit-canvas.md §2.6; src/breaks/rbbi.test.ts
//   derives them the same way) over prior context + box content.
// - unicode/ubidi.ts resolveIcuBidi(paragraphText, direction, bidiDataFor('webkit')) over buildBidiParagraph's text, where
//   CR, VT, FF, U+001C-U+001F and NEL stay literal in collapse modes (so CR and U+001C-U+001E split ICU paragraphs) and a
//   root `unicode-bidi: plaintext` wraps each paragraph in FSI … PDI (specs/bidi.md §3.2).
// - unicode/grapheme.ts graphemeRulesFor('webkit') for firstUserPerceivedCharacterLength on the complex path.
// - measure/canvas.ts contexts with lang '', direction 'ltr' (DOM items measure LTR unless unicode-bidi overrides),
//   ctx.letterSpacing = the run's letter spacing (same WidthIterator rule), wordSpacing '0px'.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Gap, LineOf, Paragraph } from '../../model.js'
import type { EngineImplementation } from '../engine.js'
import type { WebKitLineStart, WebKitPrepared } from './types.js'

export const webkitEngine: EngineImplementation<WebKitPrepared, WebKitLineStart> = {
  prepare(_paragraph: Paragraph, _env: Environment, _measurer: Measurer): WebKitPrepared {
    // 1. Content: textRendererIsNeeded (specs/webkit-text.md §2), text box content and text-transform (§3), the locale
    //    per box with the Han swap (§4.1-§4.2).
    // 2. Items per box: handleTextContent with scanWhitespace and moveToNextBreakablePosition (§5.2), per-character
    //    handling (§5.3), the verbatim BreakablePositions scan with its stale fast-forward state, classify() and the pair
    //    table (§5.4), keep-all nextBreakableSpace, ICU with prior context (§5.5).
    // 3. Bidi paragraph text and item splits at level changes (§6).
    // 4. Which builder runs (specs/webkit-lines.md §2) and stored widths with the following-space rule (§3.2-§3.3;
    //    specs/webkit-canvas.md §(e) recipe).
    throw new Error('TODO(webkit): prepare, specs/webkit-text.md §2-§6 and specs/webkit-lines.md §2-§3')
  },

  firstLine(_prepared: WebKitPrepared): WebKitLineStart | null {
    // No renderer or no items means no line box (specs/webkit-text.md §2; CRITIC.md W7).
    throw new Error('TODO(webkit): firstLine, specs/webkit-lines.md §5 line loop driver')
  },

  nextLine(_prepared: WebKitPrepared, _start: WebKitLineStart, _availableWidth: number, _measurer: Measurer): LineOf<WebKitLineStart> {
    // 1. Available width: LayoutUnit truncation of width × zoom, float32 lineWidth + 1/64 (specs/webkit-lines.md §1.2, §1.4).
    // 2. The chosen builder: TextOnlySimpleLineBuilder (§5) or LineBuilder with nextWrapOpportunity, candidate collection
    //    and processLineBreakingResult (§6); soft wrap opportunities between items and boxes (specs/webkit-text.md §7).
    // 3. InlineContentBreaker (§7), breakWord probes measured now, the carried remainder (§8.1-§8.2), soft hyphens (§8.3).
    // 4. Line bookkeeping and float32 grouping of runs (§1.5, §4), trimming and hanging (§9.1), reported width (§9.2).
    //    Fragments carry levels after resetBidiLevelForTrailingWhitespace, which compares parity (specs/bidi.md §6);
    //    trimmed trailing white space is a 'trimmed' fragment; joinsNextLine is always false (specs/painter.md §3.2 c).
    throw new Error('TODO(webkit): nextLine, specs/webkit-lines.md §1, §4-§9')
  },

  gaps(_prepared: WebKitPrepared): Gap[] {
    // Report where DESIGN.md §5 applies: control-character-width (CR's glyph advance, FF/VT .notdef), hyphen-glyph,
    // letter-spacing-ligatures, canvas-language, fixed-pitch-path, simplified-measuring, rtl-shaping-across-inline-boxes,
    // page-zoom, font-fallback, dictionary-breaks-unavailable.
    throw new Error('TODO(webkit): gaps, DESIGN.md §5')
  },
}
