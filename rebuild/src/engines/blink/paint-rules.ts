// What a line painted alone needs in Blink (Chrome 153) that the painter's shared forms don't give (paint.ts PaintRules;
// DESIGN.md §7): the forms that follow how the paragraph shaped the line's end, and Blink's limits. The painter hands a
// line's BlinkPaintFacts back to these rules unread.
import { styleUnder } from '../../content.js'
import type { TextStyle } from '../../model.js'
import type { HangingForm, LineEdges, PaintLine, PaintRules, PaintedContent, PainterLimit } from '../../paint.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { blinkBidiData, blinkGraphemeRules } from './data.js'
import type { BlinkPaintFacts } from './pieces.js'
import { USCRIPT_LATIN } from './props.js'
import { scriptsPerUnit } from './script.js'

// Character::MaybeHanKerningOpenOrCloseFast's ranges (character.h:138-141), at a string's start and end.
const HAN_KERNING_CANDIDATE_START = /^[\u2018-\u301f\uff08-\uff60]/
const HAN_KERNING_CANDIDATE_END = /[\u2018-\u301f\uff08-\uff60]$/
const WIDE = /[^\u0000-\u00ff]/

// How the line's hanging spaces are painted after text of the same leaf. They are an item result of their own,
// rounded up alone (HandleTrailingSpaces, line_breaker.cc:2418-2534), and the text before them either keeps its pair
// adjustment with the first space or lost it when the paragraph reshaped its end. ShapeLine reshapes the end of an
// item's part unless the break sits after a space and the line needs no accurate end position
// (dont_reshape_end_if_at_space_, shaping_line_breaker.cc:481-488, line_breaker.cc:1655-1659). The break before
// hanging spaces sits after them (non_hangable_run_end moves the part's end back to the text, :492-497), except where
// the text overflowed and HandleOverflow's retry broke it at a character (override_break_anywhere_,
// line_breaker.cc:4258-4265, :4612-4623): that break sits at the text's end.
// - 'own-node': the text kept the adjustment. Spaces in a text node of their own are an item of their own, still
//   shaped with the text before them (ShapeText, inline_node.cc:1636-1673), and the text's end is its item's end,
//   which ShapeLine never reshapes (:466-473). In one node a line that fits is one item result, rounded once (:283-299).
// - 'same-node': the overflow break reshaped the text. In one node the painted line overflows and breaks the same way,
//   so the text is reshaped and the spaces keep their part of a split pair adjustment, as in the paragraph.
// - 'own-group': the line needs an accurate end position, so the text was reshaped whatever the break. A length
//   vertical-align on a span around the spaces ends the shaping group (inline_node.cc:494-527), and the text is shaped
//   without them. The spaces lose their part of a pair adjustment that HarfBuzz splits (FontFacts.pairKerning).
function hangingFormAfterText(line: PaintLine<BlinkPaintFacts>, style: TextStyle): HangingForm {
  const breaksAnywhere = style.overflowWrap !== 'normal' || style.wordBreak === 'break-word' || style.lineBreak === 'anywhere'
  if (breaksAnywhere && line.pieces.overflows) return 'same-node'
  return line.pieces.facts.needsAccurateEndPosition ? 'own-group' : 'own-node'
}

// Whether shaping can tie the characters around a line edge together in a way Blink's edge reshape doesn't undo: a
// letter of a script whose HarfBuzz shaper joins or reorders letters, or a font whose pair adjustments may move the
// second glyph. DEFAULT_SHAPER_SCRIPTS lists the larger scripts of HarfBuzz's default, Hangul, Hebrew and Thai shapers
// (hb_ot_shaper_categorize, hb-ot-shaper.hh:176-220); a script it leaves out counts as one that joins or reorders.
const DEFAULT_SHAPER_SCRIPTS = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Lao}\p{Script=Common}\p{Script=Inherited}]*$/u
function shapesAcross(content: PaintedContent, run: number, around: string): boolean {
  return !DEFAULT_SHAPER_SCRIPTS.test(around) || styleUnder(content.paragraph, content.index, content.index.leaves[run]!.parent).font.facts.pairKerning !== 'first-advance'
}

// Blink's limits (paint.ts PainterLimitName has each condition's source reading).
function limits(content: PaintedContent, line: PaintLine<BlinkPaintFacts>, edges: LineEdges): PainterLimit[] {
  const { first, last, before, after, startInLeaf, endInLeaf, startInWord, endInWord, softEnd, leadingScript } = edges
  const out: PainterLimit[] = []
  // Blink reshapes an edge that isn't safe to break, which leaves each side as the painted line shapes it, unless the
  // letters at the cut belong to a script whose shaper joins or reorders them (the Arabic, Indic, Khmer, Myanmar and
  // universal shapers do; the default, Hangul, Hebrew and Thai shapers don't, hb_ot_shaper_categorize,
  // hb-ot-shaper.hh:176-220), or the font's pair adjustments aren't known to sit on the first glyph: the kern and
  // kerx machine moves the second glyph too (FontFacts.pairKerning), and an edge after a chosen soft hyphen isn't
  // reshaped.
  let cutMatters = edges.joinsPreviousLine || line.pieces.joinsNextLine
  if (!cutMatters && startInWord && before !== null) cutMatters = shapesAcross(content, before.run, before.painted.slice(-2) + first.painted.slice(0, 2))
  if (!cutMatters && endInWord && after !== null) cutMatters = shapesAcross(content, last.run, last.painted.slice(-2) + after.painted.slice(0, 2))
  if ((startInWord || endInWord) && cutMatters) {
    out.push({ limit: 'edge-inside-shaped-text', detail: `the line ${startInWord ? (endInWord ? 'starts and ends' : 'starts') : 'ends'} between two characters of one leaf that aren't white space` })
  }
  if (leadingScript !== null || edges.scriptMarkUnpainted) {
    out.push({ limit: 'script-at-line-start', detail: `characters of the line continued a script run of the text before it${leadingScript === null ? '' : ` (${leadingScript})`}` })
  }
  if (endInLeaf && softEnd && (last.kind === 'hanging' || (last.kind === 'text' && /\s$/u.test(last.painted)))) {
    out.push({ limit: 'space-shaped-with-next-line', detail: "the line's last space was shaped with the next line's first character" })
  }
  if ((startInLeaf && HAN_KERNING_CANDIDATE_START.test(first.painted)) || (endInLeaf && HAN_KERNING_CANDIDATE_END.test(last.painted))) {
    out.push({ limit: 'han-kerning-at-edge', detail: 'a character HanKerning may trim sits at a line edge inside its leaf' })
  }
  if (last.kind === 'hanging') {
    const fragments = line.pieces.fragments
    let f = edges.lastAt
    while (f > 0 && fragments[f - 1]!.kind === 'hanging') f--
    const text = f > 0 ? fragments[f - 1]! : null
    const style = styleUnder(content.paragraph, content.index, content.index.leaves[last.run]!.parent)
    if (text !== null && text.kind === 'text' && text.run === last.run && hangingFormAfterText(line, style) === 'own-group' && style.font.facts.pairKerning !== 'first-advance') {
      out.push({ limit: 'hanging-space-kern-share', detail: "the hanging spaces are shaped apart from the text before them, and the font's pair adjustments aren't known to sit on the first glyph" })
    }
  }
  return out
}

export const blinkPaintRules: PaintRules<BlinkPaintFacts> = {
  bidi: blinkBidiData,
  graphemes: blinkGraphemeRules,
  // Blink shapes the hyphen alone, without spacing (hyphen_result.cc:12-16). A length vertical-align ends the shaping
  // group at the box edge (inline_node.cc:494-527) without moving the baseline.
  hyphenSpan: 'ends-shaping-group',
  textNodesKeepLeafStorage: false,
  // Blink builds its own text from the node's, where a collapsible tab or newline is a space already.
  paintsSourceWhiteSpace: false,
  // Items split where the level changes, and a shaping group ends where the direction does (ShouldBreakShapingBeforeText,
  // inline_node.cc:470-490); the fragments' levels come after Blink's line-end rule, which moves trailing spaces to the
  // base level (paint.ts planLine's spaceJoinsText).
  resolvesTrailingSpaceDirection: true,
  // The paragraph shaped the text with the trimmed space after it and trimmed the space afterwards
  // (line_breaker.cc:255-268), while a block's end removes the space from the text before shaping (ExitBlock,
  // inline_items_builder.cc:1622-1629), so the line takes the soft wrap box. Where the end is reshaped
  // (needsAccurateEndPosition), the paragraph shaped the text without the space, as the block's end does.
  trimmedSpaceAtEnd: { takesBox: 'by-rule', rule: facts => !facts.needsAccurateEndPosition },
  // Blink breaks before the box by UAX #14, which allows no break after U+200D (LB8a) or a word joiner (LB11; ICU
  // line.txt), so the box would take the character to the second line with it (c-abda075f770468f9).
  noBreakBeforeBoxAfter: /[\u200d\u2060\ufeff]$/,
  // After trailing spaces the line is in its trailing state, which ends at the first item that can't trail, whatever
  // that item's own wrapping (BreakLine, line_breaker.cc:1100-1107; c-1a3fdb57af71a97c), so a wrapping span's trimmed
  // space ends a line in a nowrap block.
  lineEndWrapping: 'last-character-box',
  // Hanging spaces after anything but text of their leaf are an item of their own and get a node of their own.
  hangingForm: (line, before, hanging, style) => before.kind === 'text' && before.run === hanging.run ? hangingFormAfterText(line, style) : 'own-node',
  spacingAfterRunEnd: false,
  // The port's ScriptRunIterator (script.ts) over a text laid out alone: an 8-bit text is one Latin segment
  // (harfbuzz_shaper.cc:1072-1077), unless its block is RTL. An RTL block enables bidi (is_bidi_enabled_,
  // inline_items_builder.cc:1744-1746), and SegmentScriptRuns then runs over 8-bit text too (inline_node.cc:1256-1290;
  // index.ts prepare's `segmented`), so a painted line of brackets that were Latin after Latin letters in the paragraph is
  // Common there (c-0aaf6ad5c7daf6da: 13 brackets in Amiri wrap after 8 when painted alone). Blink resolves levels with ICU.
  lineStartScript: {
    form: 'arabic-letter-mark',
    scriptsOf: (text, sixteenBit, direction) => sixteenBit || direction === 'rtl' || WIDE.test(text) ? scriptsPerUnit(text) : new Uint8Array(text.length).fill(USCRIPT_LATIN),
    levelsOf: (text, direction) => resolveIcuBidi(text, direction, blinkBidiData).levels,
  },
  // ShapeLine trims a character HanKerning may trim only while it breaks lines (shaping_line_breaker.cc:344-376).
  trimsAtLineEnd: HAN_KERNING_CANDIDATE_END,
  controlsBetweenPieces: { limit: 'controls-between-pieces', detail: "two pieces of one direction sit in different override spans, whose bidi controls end Blink's shaping group between them" },
  limits,
}
