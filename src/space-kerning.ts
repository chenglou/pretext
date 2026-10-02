// Blink's kerning between a word and the spaces beside it (Chromium 153). Its layout shapes
// each run of one script and direction in one call, spaces included (HarfBuzzShaper::Shape,
// harfbuzz_shaper.cc:1063-1104), so in a font whose kerning names the space glyph a word kerns
// with the space after it and a space with the word after it. Its Canvas cuts a string at each
// U+0020 (PlainTextNode::SegmentWord, plain_text_node.cc:365-399) and reports neither, but it
// draws U+2028 with the space glyph (HarfBuzzGetGlyph, harfbuzz_face.cc:103-113) without a cut.
// So after the segments are measured, each space takes what Canvas shows between U+2028 and the
// characters on its two sides, asked once per character, side and font.
//
// Premises, with their gaps and what was measured in RESEARCH.md, Kerning At Line Edges:
// - A font that kerns no printable ASCII character with the space kerns nothing with it
//   (getFontData), so most fonts are asked one question and none of their words is looked at.
// - A word's last and first character stand for the word, past default ignorables, which
//   HarfBuzz's lookups pass over. A first character with a combining mark after it takes none.
// - A line that ends at the space after a word keeps the word's share of their kerning, as Blink
//   keeps it for start-aligned text without a decoration (DontReshapeEndIfAtSpace,
//   line_breaker.cc:1655-1659). Otherwise Blink shapes the line's end again without the space,
//   and where the kerning tightens the two, the line's last word is narrower here than there.
// - A space's kerning with the word after it goes on the space: a line that breaks between the
//   two is shaped again without it (shaping_line_breaker.cc:307-324).
// - Blink shapes nothing across a change of direction (ShouldBreakShapingBeforeText,
//   inline_node.cc:472-490), and which spaces share a word's direction depends on the
//   paragraph's, which preparation can't see, so text with a right-to-left letter or an explicit
//   bidi control takes none.
import { HARD_BREAK, KIND_BITS, PRESERVED_SPACE, SPACE, TEXT, type TextAnalysis } from './analysis.js'
import { DEFAULT_IGNORABLE, hasProperty, MARK } from './line-breaks.js'
import { getSegmentMetrics, type FontMeasurement } from './measurement.js'

// What preparation keeps of a font that kerns with the space glyph.
export type SpaceKerningFontData = {
  // A character's kerning with a space glyph after it, and with one before it, by code unit,
  // once a word has the character at that edge beside a space.
  after: Map<number, number>
  before: Map<number, number>
  // Whether a pair's kerning sits half on each glyph, once a character kerned with a space
  // after it (splitsKerning).
  splits: boolean | null
}

// A right-to-left letter (bidi class R or AL, with RLM and ALM) or an explicit bidi control.
const mixedDirectionRe = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}\u202A-\u202E\u2066-\u2069]/u

// U+2028 before, between and after the printable ASCII characters.
let fontProbe = '\u2028'
for (let code = 0x21; code <= 0x7e; code++) fontProbe += String.fromCharCode(code) + '\u2028'

// What is kept of the font's kerning with the space glyph, with the measure context set to the
// font; null for a font that has none: one whose probe is as wide with kerning off.
// `fontKerning = 'none'` turns the `kern` feature off (FontFeatureRange::FromFontDescription,
// font_features.cc:39-47), and with it HarfBuzz's kerning from GPOS, `kern` and `kerx`
// (hb-ot-shape.cc:127-131, hb-ot-kern-table.hh:67).
function getFontData(measurement: FontMeasurement): SpaceKerningFontData | null {
  if (measurement.spaceKerning === undefined) {
    const context = measurement.state.context
    const kerned = context.measureText(fontProbe).width
    context.fontKerning = 'none'
    const unkerned = context.measureText(fontProbe).width
    context.fontKerning = 'auto'
    // Where U+2028 alone doesn't measure as the space, it doesn't stand for it.
    measurement.spaceKerning = kerned !== unkerned && context.measureText('\u2028').width === getSegmentMetrics(' ', measurement).width ? { after: new Map(), before: new Map(), splits: null } : null
  }
  return measurement.spaceKerning
}

// Whether a character takes no kerning with a space, and Canvas isn't asked.
function takesNoKerning(code: number): boolean {
  // A combining mark or half of a surrogate pair is part of a longer cluster.
  return hasProperty(code, MARK) || (code & 0xf800) === 0xd800 ||
    // Canvas shapes each ideograph and kana as a word of its own, so it shows no kerning beside
    // one (NextWordEndIndex, plain_text_node.cc:92-153, over kIsCjkIdeographOrSymbolRanges,
    // character_property_data.h:40-80, of which these are the letters).
    (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa) ||
    (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) ||
    // Premise: no font kerns a Hangul syllable with the space.
    (code >= 0xac00 && code <= 0xd7a3)
}

// A character's kerning with a space glyph after it, or before it: the two in one string, with
// U+2028 for the space, less each alone.
function getKerning(code: number, spaceFirst: boolean, measurement: FontMeasurement, data: SpaceKerningFontData): number {
  const kernings = spaceFirst ? data.before : data.after
  let kerning = kernings.get(code)
  if (kerning === undefined) {
    kerning = 0
    if (!takesNoKerning(code)) {
      const character = String.fromCharCode(code)
      const pairWidth = measurement.state.context.measureText(spaceFirst ? '\u2028' + character : character + '\u2028').width
      kerning = pairWidth - getSegmentMetrics(character, measurement).width - getSegmentMetrics(' ', measurement).width
      // Blink keeps a run's width as a float32 (shape_result.cc:1539-1576), so up to the pair's
      // width / 2^22 is rounding, not kerning.
      if (Math.abs(kerning) <= pairWidth / 0x400000) kerning = 0
    }
    kernings.set(code, kerning)
  }
  return kerning
}

// Whether the font's kerning with the space sits half on each glyph of a pair, as HarfBuzz puts
// it from the legacy `kern` table (hb_kern_machine_t::kern, hb-kern.hh:100-107), where GPOS puts
// it on the first. Under `fontKerning = 'normal'` Canvas shapes a string whole, its U+0020
// included, only where the font's GPOS covers the space glyph (font_fallback_list.cc:264-277), so
// a font in which that shows none of a kerning that U+2028 shows has it from `kern`. Asked once
// per font, of its first character that kerns with a space after it.
function splitsKerning(code: number, kerning: number, measurement: FontMeasurement, data: SpaceKerningFontData): boolean {
  if (data.splits === null) {
    const context = measurement.state.context
    const character = String.fromCharCode(code)
    context.fontKerning = 'normal'
    const shown = context.measureText(character + ' ').width - getSegmentMetrics(character, measurement).width - getSegmentMetrics(' ', measurement).width
    context.fontKerning = 'auto'
    data.splits = Math.abs(shown) < Math.abs(kerning) / 2
  }
  return data.splits
}

// The scripts a character can be in, as bits: Cyrillic, Greek, Latin, and one bit for a character
// in none of them; a character of any script has all four. The three are in Blink's order for a
// Common character's extensions, by ICU script code with Latin last (GetScripts,
// script_run_iterator.cc:191-198), so a run's lowest bit is the script it resolves to.
const OTHER_SCRIPT = 1
const CYRILLIC_SCRIPT = 2
const GREEK_SCRIPT = 4
const LATIN_SCRIPT = 8
const ANY_SCRIPT = 15
// By Script_Extensions, as Blink reads a character's scripts (:120-216): an Inherited character,
// or a Common one without extensions, joins any run. Half of a surrogate pair counts with them
// (ENGINE_FOLLOWUPS.md, Kerning with spaces, has where these four bits depart from Blink).
const anyScriptRe = /[\p{sc=Zinh}\p{scx=Zyyy}\p{Cs}]/u
const latinScriptRe = /\p{scx=Latn}/u
const cyrillicScriptRe = /\p{scx=Cyrl}/u
const greekScriptRe = /\p{scx=Grek}/u
// General categories Ps and Pe hold every paired bracket and a few characters more.
const openingBracketRe = /\p{Ps}/u
const closingBracketRe = /\p{Pe}/u

function getScripts(character: string): number {
  // ASCII letters are Latin and the rest of ASCII is Common.
  const code = character.charCodeAt(0)
  if (code < 0x80) return (code | 0x20) >= 0x61 && (code | 0x20) <= 0x7a ? LATIN_SCRIPT : ANY_SCRIPT
  // A Common opening bracket that is East Asian wide is in the Han scripts
  // (FixScriptsByEastAsianWidth, :83-110, from OpenBracket, :431-441): those from U+FE17 up.
  if (anyScriptRe.test(character)) return code >= 0xfe17 && openingBracketRe.test(character) ? OTHER_SCRIPT : ANY_SCRIPT
  return (latinScriptRe.test(character) ? LATIN_SCRIPT : 0) | (cyrillicScriptRe.test(character) ? CYRILLIC_SCRIPT : 0) |
    (greekScriptRe.test(character) ? GREEK_SCRIPT : 0) || OTHER_SCRIPT
}

// How far a text's script runs were read, the scripts the run there can be in, and the script of
// the run the last opening bracket is in: 0 before a bracket, -1 while its run goes on.
type ScriptRuns = { read: number, scripts: number, bracket: number }

// Whether the space before text[at], the character it kerns with, is in that character's script
// run. Blink shapes each script run apart, and a space joins the run of the text before it
// (ScriptRunIterator::MergeSets, :490-510). The search back ends at the nearest character with
// one script; a closing bracket, or a character of several scripts, takes its script from the
// runs before it (readScriptRuns).
function spaceSharesScriptRun(text: string, at: number, runs: ScriptRuns): boolean {
  const scripts = getScripts(text[at]!)
  if (scripts === ANY_SCRIPT) return true
  for (let i = at - 1; i >= 0; i--) {
    const character = text[i]!
    const before = getScripts(character)
    if (before === ANY_SCRIPT) {
      if (character === ' ' || !closingBracketRe.test(character)) continue
    } else if ((before & (before - 1)) === 0) {
      return (before & scripts) !== 0
    }
    return (readScriptRuns(text, at, runs) & scripts) !== 0
  }
  return true
}

// The scripts of the run that ends before text[to], read on from the last call as
// ScriptRunIterator::Consume reads them (:325-429): a run keeps the scripts its characters share
// and ends before one that shares none. A closing bracket takes the script of the run its opening
// bracket is in, once that run has ended (CloseBracket, :443-489); any opening bracket pairs
// with any closing one here, and only the last one opened is remembered.
function readScriptRuns(text: string, to: number, runs: ScriptRuns): number {
  for (; runs.read < to; runs.read++) {
    const character = text[runs.read]!
    let scripts = getScripts(character)
    // Brackets are Common or, with extensions, East Asian.
    const opens = (scripts & OTHER_SCRIPT) !== 0 && openingBracketRe.test(character)
    if (!opens && runs.bracket > 0 && (scripts & OTHER_SCRIPT) !== 0 && closingBracketRe.test(character)) scripts = runs.bracket
    if ((runs.scripts & scripts) !== 0) {
      runs.scripts &= scripts
    } else {
      // The run that ends resolves to its first script (ResolveCurrentScript, :639-642).
      if (runs.bracket === -1) runs.bracket = runs.scripts & -runs.scripts
      runs.scripts = scripts
    }
    if (opens) runs.bracket = -1
  }
  return runs.scripts
}

// Adds to the measured widths of an analysis' segments the kerning of each space with the text
// segments beside it, and to a word's last fit advance its kerning with the space after it.
export function addSpaceKerning(measurement: FontMeasurement, analysis: TextAnalysis, widths: number[], fitAdvances: (number[] | null)[]): void {
  const { flags, starts, normalized } = analysis
  if (!normalized.includes(' ')) return
  const data = getFontData(measurement)
  if (data === null || mixedDirectionRe.test(normalized)) return
  const count = flags.length
  const runs: ScriptRuns = { read: 0, scripts: ANY_SCRIPT, bracket: 0 }
  for (let i = 0; i < count; i++) {
    const kind = flags[i]! & KIND_BITS
    if (kind !== SPACE && kind !== PRESERVED_SPACE) continue
    // The text's start counts as a forced break.
    const kindBefore = i > 0 ? flags[i - 1]! & KIND_BITS : HARD_BREAK
    if (kindBefore === TEXT) {
      let last = starts[i]! - 1
      while (last > starts[i - 1]! && hasProperty(normalized.charCodeAt(last), DEFAULT_IGNORABLE)) last--
      const code = normalized.charCodeAt(last)
      const kerning = getKerning(code, false, measurement, data)
      if (kerning !== 0) {
        // The word keeps its share where the line ends at the space, and the space takes the rest.
        const spaceShare = splitsKerning(code, kerning, measurement, data) ? kerning / 2 : 0
        widths[i - 1] = widths[i - 1]! + (kerning - spaceShare)
        widths[i] = widths[i]! + spaceShare
        // The cached advances are shared by every occurrence of the word.
        const advances = fitAdvances[i - 1] as number[] | null
        if (advances !== null) {
          const kerned = fitAdvances[i - 1] = advances.slice()
          kerned[kerned.length - 1] = kerned[kerned.length - 1]! + (kerning - spaceShare)
        }
      }
    }
    // Preserved spaces that start the text or follow a forced break are a Blink item of their
    // own (inline_items_builder.cc:988-1034), which kerns with nothing.
    if (i + 1 === count || (flags[i + 1]! & KIND_BITS) !== TEXT || (kind === PRESERVED_SPACE && kindBefore === HARD_BREAK)) continue
    const end = i + 2 < count ? starts[i + 2]! : normalized.length
    let first = starts[i + 1]!
    while (first + 1 < end && hasProperty(normalized.charCodeAt(first), DEFAULT_IGNORABLE)) first++
    if (first + 1 < end && hasProperty(normalized.charCodeAt(first + 1), MARK)) continue
    const kerning = getKerning(normalized.charCodeAt(first), true, measurement, data)
    // The space takes its kerning with the word, and takes it along where it hangs.
    if (kerning !== 0 && spaceSharesScriptRun(normalized, first, runs)) widths[i] = widths[i]! + kerning
  }
}
