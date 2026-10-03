// Preparation's measurement phase: each segment of a text analysis measured in a font, with
// the facts the line walkers read at a line's edges. layout.ts and rich-inline.ts prepare
// through it, as they walk through line-break.ts.

import { observeSegmentEntries, textMayHaveEntryGeometry, type SegmentEntryGeometry } from './entry-geometry.js'
import { getHanKerningTrims, textMayHanKern, type HanKerningTrims } from './han-kerning.js'
import { findGraphemeEnds, type GraphemeTable } from './graphemes.js'
import { lazyRegExp } from './line-breaks.js'
import {
  CONTROL,
  HARD_BREAK,
  KIND_BITS,
  ONE_CLUSTER,
  PRESERVED_SPACE,
  SOFT_HYPHEN,
  SPACE,
  SPACED,
  TAB,
  TEXT,
  UNBROKEN,
  ZERO_WIDTH_BREAK,
  ZERO_WIDTH_GLUE,
  type SegmentKindCode,
  type TextAnalysis,
} from './analysis.js'
import {
  type BreakableFitMode,
  type EngineProfile,
  type FontMeasurement,
  getCorrectedSegmentWidth,
  getEmojiCorrection,
  getFollowingSpaceMetrics,
  getFontMeasurement,
  getHyphenText,
  getSegmentFit,
  getSegmentMetrics,
  getTextWidth,
  measureWithLetterSpacing,
  textMayContainEmoji,
  type SegmentFit,
  type SegmentMetrics,
  zeros,
} from './measurement.js'
import type { PreparedText } from './layout.js'
import type { PreparedLineBreakData } from './line-break.js'
import type { PreparedSegments } from './line-text.js'

// Text and spaces take letter spacing after each grapheme; a ZWSP takes none.
function countRenderedSpacingGraphemes(text: string, kind: SegmentKindCode, graphemeTable: GraphemeTable): number {
  return kind === ZERO_WIDTH_BREAK ? 0 : findGraphemeEnds(graphemeTable, text, 0, text.length, null)
}

function addInternalLetterSpacing(width: number, graphemeCount: number, letterSpacing: number): number {
  return graphemeCount > 1 ? width + (graphemeCount - 1) * letterSpacing : width
}

// The scripts whose letters join, Arabic, Syriac, N'Ko, Mandaic, Mongolian, Phags-pa and
// Hanifi Rohingya, take no letter spacing in Blink and Gecko, which name the same seven
// (IsCursiveScript, shape_result.cc:977-990; UnicodeProperties.h:350-355). Gecko asks the
// script of a cluster's first character (GetSpacingInternal, nsTextFrame.cpp:4202-4213), so
// digits and punctuation among the letters keep their spacing. Blink asks the script of the
// shaping run the cluster is in and spaces only its spaces (ComputeSpacing,
// shape_result_spacing.cc:103-131, behind the runtime flag
// IgnoreLetterSpacingInCursiveScripts): a run takes in the characters of no script after
// it, the ones that start the text, and the punctuation its script shares
// (script_run_iterator.cc), so of an Arabic word, a space and `123.` only the space is
// spaced. That is Chrome since 149; 138 to 148 don't space the run's spaces either, and
// before 138 every letter is spaced, which no version check here follows
// (ENGINE_FOLLOWUPS.md, Letter spacing). WebKit spaces every glyph with an advance.
// Chrome 154, Firefox 156 and webkit-host lay 64 strings out so (2026-10-01). The
// profile's unspacedCursive names the engine's rule, and the scripts and script
// extensions are the JavaScript engine's (RESEARCH.md, Tables Against Canvas).
const cursiveScriptRe = lazyRegExp(String.raw`[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mandaic}\p{Script=Mongolian}\p{Script=Phags_Pa}\p{Script=Hanifi_Rohingya}]`, 'uy')
// What starts or goes on with a cursive run in Blink: the letters; the Common characters
// and marks whose scripts include Arabic, such as U+060C, U+0640 and the vowel signs,
// since a shared character's run starts with the lowest code of its scripts, Latin aside
// for a Common one (ICUScriptData::GetScripts, :118-215), and Arabic's is the lowest;
// Mongolian's comma, full stop and four dots, whose scripts are Mongolian and Phags-pa;
// and U+1DFA, a mark whose one script is Syriac. Gap: Blink starts such a run with all the
// character's scripts, which the next character that has a script narrows, and goes on
// with the run before it where that run's script is one of them (MergeSets, :491-565). So
// next to Thaana it spaces U+060C, and next to Mongolian it doesn't space the CJK
// punctuation Mongolian shares, nor U+202F outside Latin (ENGINE_FOLLOWUPS.md, Letter
// spacing).
const cursiveRunSource = String.raw`[\p{scx=Arabic}\p{Script=Syriac}\u1DFA\p{Script=Nko}\p{Script=Mandaic}\p{Script=Mongolian}\p{Script=Phags_Pa}\p{Script=Hanifi_Rohingya}\u1802\u1803\u1805]`
const cursiveRunRe = lazyRegExp(cursiveRunSource, 'uy')
const mayBeCursiveRe = lazyRegExp(cursiveRunSource, 'u')
// Characters that stay in the run before them in Blink: Common ones that no script lists,
// and marks, which inherit. Gap: so does a Common character that one script lists, such as
// the circled ideographs, which here ends a cursive run (ENGINE_FOLLOWUPS.md, Letter
// spacing).
const scriptNeutralRe = lazyRegExp(String.raw`[\p{scx=Common}\p{Script=Inherited}]`, 'uy')
// A Common character right before a mark that has script extensions, as the Arabic vowel
// signs do, doesn't stay: it takes the mark's scripts (FetchNextCharacter,
// script_run_iterator.cc:624-635), so a digit or a dotted circle that carries a fatha
// starts an Arabic run. A match ends where the mark starts; the mark is the first group.
const markedCommonSource = '\\p{scx=Common}(?=((?=\\p{Script=Inherited})\\P{scx=Inherited}))'
const markedCommonRe = lazyRegExp(markedCommonSource, 'uy')
// The opening brackets of no script that Blink makes Han, those whose East Asian Width is
// wide, fullwidth or halfwidth (FixScriptsByEastAsianWidth, script_run_iterator.cc:83-110).
// Regular expressions have no property for that width, so these are listed: of Unicode
// 17's 64 opening brackets, the eight of that width whose script extensions are Common
// alone. U+3008-U+301A and U+FF62, of that width too, list their scripts. A bracket
// under such a mark has the mark's scripts by then, so it isn't made Han.
const wideOpeningBrackets = '\u2329\uFE59\uFE5B\uFE5D\uFF08\uFF3B\uFF5B\uFF5F'
// What gives a text's first run its script: a character that has one, the mark a Common
// character takes its scripts from, or a wide opening bracket.
const firstScriptRe = lazyRegExp(`[^\\p{scx=Common}\\p{Script=Inherited}]|${markedCommonSource}|[${wideOpeningBrackets}]`, 'u')

// Unicode 15's bracket pairs, each an opening bracket and then its closing one (BidiBrackets.txt,
// as servo/unicode-bidi ca612daf lists them, src/char_data/tables.rs:519-535).
const bracketPairs = '()[]{}\u0F3A\u0F3B\u0F3C\u0F3D\u169B\u169C\u2045\u2046\u207D\u207E\u208D\u208E\u2308\u2309\u230A\u230B' +
  '\u2329\u232A\u2768\u2769\u276A\u276B\u276C\u276D\u276E\u276F\u2770\u2771\u2772\u2773\u2774\u2775\u27C5\u27C6' +
  '\u27E6\u27E7\u27E8\u27E9\u27EA\u27EB\u27EC\u27ED\u27EE\u27EF\u2983\u2984\u2985\u2986\u2987\u2988\u2989\u298A' +
  '\u298B\u298C\u298D\u2990\u298F\u298E\u2991\u2992\u2993\u2994\u2995\u2996\u2997\u2998\u29D8\u29D9\u29DA\u29DB' +
  '\u29FC\u29FD\u2E22\u2E23\u2E24\u2E25\u2E26\u2E27\u2E28\u2E29\u2E55\u2E56\u2E57\u2E58\u2E59\u2E5A\u2E5B\u2E5C' +
  '\u3008\u3009\u300A\u300B\u300C\u300D\u300E\u300F\u3010\u3011\u3014\u3015\u3016\u3017\u3018\u3019\u301A\u301B' +
  '\uFE59\uFE5A\uFE5B\uFE5C\uFE5D\uFE5E\uFF08\uFF09\uFF3B\uFF3D\uFF5B\uFF5D\uFF5F\uFF60\uFF62\uFF63'
// Each of those brackets to its pair's opening bracket << 1, | 1 for an opening bracket. U+2329
// and U+232A read as U+3008 and U+3009, their canonical equivalents, as that table folds them.
let brackets: Map<number, number> | null = null
function getBrackets(): Map<number, number> {
  if (brackets !== null) return brackets
  brackets = new Map()
  for (let k = 0; k < bracketPairs.length; k += 2) {
    const first = bracketPairs.charCodeAt(k)
    const opening = first === 0x2329 ? 0x3008 : first
    brackets.set(first, opening << 1 | 1)
    brackets.set(bracketPairs.charCodeAt(k + 1), opening << 1)
  }
  return brackets
}

// Blink's script run as preparation follows it through a text's segments, in order:
// whether it is cursive, and each bracket it has open, as its opening character and then
// 1 where that bracket's run is cursive, else 0.
type ScriptRun = { cursive: boolean; openBrackets: number[] }

// The run a text starts in: that of its first character that has a script, which takes in
// the characters of no script before it.
function startScriptRun(text: string): ScriptRun {
  const first = firstScriptRe().exec(text)
  return { cursive: first !== null && mayBeCursiveRe().test(first[1] ?? first[0]), openBrackets: [] }
}

// Takes the code point c at text[i] into the run. A closing bracket goes back to its
// opening bracket's run, among the last 32 opened, and closes the ones opened since; its
// own stays open, so a second closing bracket goes back to that run too (OpenBracket and
// CloseBracket, script_run_iterator.cc:431-481). A wide opening bracket starts a Han run.
// The pairs are Unicode 15's (bracketPairs), with U+2329 and U+232A folded into U+3008
// and U+3009, which ICU pairs only with each other (ENGINE_FOLLOWUPS.md, Letter spacing).
function enterScriptRun(run: ScriptRun, text: string, i: number, c: number): void {
  const { openBrackets } = run
  const bracket = getBrackets().get(c)
  // No bracket's code is the 0 or 1 that tells its run.
  const opened = bracket !== undefined && (bracket & 1) === 0 ? openBrackets.lastIndexOf(bracket >> 1) : -1
  if (opened >= 0) {
    run.cursive = openBrackets[opened + 1] === 1
    openBrackets.length = opened + 2
    return
  }
  markedCommonRe().lastIndex = scriptNeutralRe().lastIndex = i
  const marked = markedCommonRe().test(text)
  if (marked || !scriptNeutralRe().test(text)) {
    cursiveRunRe().lastIndex = marked ? markedCommonRe().lastIndex : i
    run.cursive = cursiveRunRe().test(text)
  }
  if (bracket === undefined || (bracket & 1) === 0) return
  if (!marked && wideOpeningBrackets.includes(text.charAt(i))) run.cursive = false
  if (openBrackets.length === 64) openBrackets.splice(0, 2)
  openBrackets.push(bracket >> 1, run.cursive ? 1 : 0)
}

// Which graphemes of a text segment take no letter spacing, as ascending indices, or null
// without any: in Gecko, which has no run here, those whose first character is of a
// cursive script; in Blink those whose first character is in a cursive run and isn't a
// no-break space. A rich item's text starts a run of its own (ENGINE_FOLLOWUPS.md, Letter
// spacing).
function getUnspacedGraphemes(text: string, graphemeTable: GraphemeTable, run: ScriptRun | null): number[] | null {
  const ends = new Int32Array(text.length)
  const count = findGraphemeEnds(graphemeTable, text, 0, text.length, ends)
  let unspaced: number[] | null = null
  for (let g = 0, start = 0; g < count; start = ends[g++]!) {
    let joins = false
    if (run === null) {
      cursiveScriptRe().lastIndex = start
      joins = cursiveScriptRe().test(text)
    } else {
      for (let i = start; i < ends[g]!;) {
        const c = text.codePointAt(i)!
        enterScriptRun(run, text, i, c)
        if (i === start) joins = run.cursive && c !== 0xA0
        i += c > 0xFFFF ? 2 : 1
      }
    }
    if (joins) (unspaced ??= []).push(g)
  }
  return unspaced
}

// Code points that WebKit's FontCascade::characterRangeCodePath sends to the
// complex text path, stored as start/end pairs. So does a ZWJ after an emoji.
const complexTextPathRanges = [
  0x02E5, 0x02E9, 0x0300, 0x036F, 0x0591, 0x05BD, 0x05BF, 0x05CF, 0x0600, 0x109F,
  0x1100, 0x11FF, 0x135D, 0x135F, 0x1700, 0x18AF, 0x1900, 0x194F, 0x1980, 0x19DF,
  0x1A00, 0x1CFF, 0x1DC0, 0x1DFF, 0x20D0, 0x20FF, 0x26F9, 0x26F9, 0x2CEF, 0x2CF1,
  0x302A, 0x302F, 0x3099, 0x309C, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA800, 0xABFF,
  0xD7B0, 0xD7FF, 0xFE00, 0xFE0F, 0xFE20, 0xFE2F, 0x10A00, 0x10A5F, 0x11000, 0x110CF,
  0x11100, 0x111DF, 0x11200, 0x1124F, 0x112B0, 0x1137F, 0x11400, 0x114DF, 0x11580, 0x1165F,
  0x11680, 0x116CF, 0x11700, 0x11CBF, 0x16B00, 0x16B8F, 0x1E900, 0x1E95F, 0x1F1E6, 0x1F1FF,
  0x1F3FB, 0x1F3FF, 0xE0000, 0xE007F, 0xE0100, 0xE01EF,
] as const

const extendedPictographicRe = /\p{Extended_Pictographic}/u
const leadingCombiningMarkRe = lazyRegExp(String.raw`^\p{M}`, 'u')
// Decimal digits and the joiners of numbers, times and dates.
const numericRunRe = /^[\p{Nd}:\-/×,.+\u2013\u2014]+$/u
const markRunRe = /^\p{M}+$/u
const nonspacingMarkRunRe = /^\p{Mn}+$/u
const controlOrMarkRunRe = /^(?:[\p{Cc}\u2028\u2029]|\p{M}+)$/u
const controlCharacterRe = /^[\p{Cc}\u2028\u2029]$/u
// The fewest UTF-16 units of a long chain of mark runs that a run's context keeps after
// the grapheme (getMarkContext): measured after the whole chain, a long chain prepared in
// time that grows with the square of its length. Safari gives a run a width that depends
// on how far it sits from the grapheme, up to 61 units in the chains measured
// (RESEARCH.md, Break Opportunities From Engine Data), so a context that keeps fewer
// moves widths there.
const MARK_CHAIN_CONTEXT_UNITS = 96

function needsComplexTextPath(text: string): boolean {
  let previousIsEmoji = false
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i)!
    i += codePoint > 0xFFFF ? 2 : 1
    if (codePoint === 0x200D && previousIsEmoji) return true
    previousIsEmoji = codePoint > 0xFFFF && extendedPictographicRe.test(String.fromCodePoint(codePoint))
    for (let range = 0; range < complexTextPathRanges.length && codePoint >= complexTextPathRanges[range]!; range += 2) {
      if (codePoint <= complexTextPathRanges[range + 1]!) return true
    }
  }
  return false
}

const explicitBidiControlRe = /[\u202A-\u202E\u2066-\u2069]/
// Format characters stand for bidi class BN, except the direction marks LRM,
// RLM and ALM, which are strong characters like letters.
const trailingFormatCharacterRe = /(?![\u200E\u200F\u061C])\p{Cf}$/u
// Letters in the right-to-left blocks have bidi class R or AL, as do RLM and
// ALM. Every other letter except modifier letters has class L, as does LRM.
const rightToLeftLetterRe = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
// The last letter or direction mark before format characters other than a soft
// hyphen, and the first letter, direction mark or ASCII digit after the space,
// past spaces and format characters.
const letterBeforeFormatTailRe = lazyRegExp(String.raw`([\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])\p{M}*(?:(?![\u00AD\u200E\u200F\u061C])\p{Cf})+$`, 'u')
const letterAfterSpacesRe = lazyRegExp(String.raw` (?: |(?![\u200E\u200F\u061C])\p{Cf})*([0-9\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])`, 'uy')

// Bidi class B: the characters that end a bidi paragraph.
function isParagraphSeparatorCode(code: number): boolean {
  return code === 0x0a || code === 0x0d || (code >= 0x1c && code <= 0x1e) || code === 0x85 || code === 0x2029
}

export function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  letterSpacing: number,
  engineProfile: EngineProfile,
  language: string | null,
  // Whether text segments take emergency breaks between graphemes: an atomic rich item,
  // which is only laid out whole, takes none.
  overflowBreaks: boolean,
): (PreparedText & PreparedLineBreakData) | (PreparedText & PreparedSegments) {
  const { normalized, texts, starts, flags } = analysis
  const segmentCount = flags.length
  const hasLetterSpacing = letterSpacing !== 0
  const fontMeasurement = getFontMeasurement(font, language, hasLetterSpacing)
  const emojiCorrection = textMayContainEmoji(normalized) ? getEmojiCorrection(font, fontMeasurement) : 0
  const spaceWidth = getTextWidth(' ', fontMeasurement, emojiCorrection)
  // The advance between tab stops: eight spaces, each with its letter spacing where the
  // engine counts it (EngineProfile's letterSpaceTabStops). Gecko rounds the space and the
  // letter spacing to app units, sixtieths of a pixel, each on its own
  // (ComputeTabWidthAppUnits, nsTextFrame.cpp:3875-3906).
  const tabStopSpacing = engineProfile.letterSpaceTabStops ? letterSpacing : 0
  const tabStopAdvance = engineProfile.tabsInAppUnits
    ? (Math.round(spaceWidth * 60) + Math.round(tabStopSpacing * 60)) * 8 / 60
    : (spaceWidth + tabStopSpacing) * 8
  // The least a tab advances, measured at a text's first tab (EngineProfile's tabMinimumCharacter).
  let minimumTabAdvance = 0
  // Only a segment holding a default-ignorable code point has entry geometry, so text
  // without one doesn't look for it.
  const entryFitBasis = engineProfile.entryFitBasis !== 'disabled' && textMayHaveEntryGeometry(normalized) ? engineProfile.entryFitBasis : 'disabled'

  // A collapsed space's first source character, for engines that look at the
  // source after a text item.
  function getSpaceSourceCode(analysisIndex: number): number {
    const start = starts[analysisIndex]!
    return analysis.spaceSources === null ? normalized.charCodeAt(start) : analysis.spaceSources[start]!
  }

  // A WebKit text item runs to its next break opportunity, so it also owns any
  // zero-width breaks before the space. The item is measured with one following
  // U+0020 minus an unshaped space, which keeps the kerning between the item's
  // end and that space. With letter spacing the same measurement also moves the
  // space's gap onto the item and clamps the item at zero, which the
  // per-grapheme gap model does not represent, so only the unspaced case takes
  // the kerning. A soft hyphen before the space also takes none: on an RTL page
  // WebKit needs about a hyphen's width more to fit such an item, and
  // preparation cannot see the page direction. Returns the zero-width breaks
  // between the text and the space, or null when the text takes no kerning.
  function getFollowingSpaceTail(analysisIndex: number, text: string): string | null {
    if (!engineProfile.measureTextWithFollowingSpace || hasLetterSpacing) return null
    let next = analysisIndex + 1
    while (next < segmentCount && (flags[next]! & KIND_BITS) === ZERO_WIDTH_BREAK) next++
    if (next >= segmentCount) return null
    const nextKind = flags[next]! & KIND_BITS
    if ((nextKind !== SPACE && nextKind !== PRESERVED_SPACE) || getSpaceSourceCode(next) !== 0x20) return null
    const tail = normalized.slice(starts[analysisIndex + 1], starts[next])
    return formatTailStaysWithWord(tail === '' ? text : text + tail, starts[next]!) ? tail : null
  }

  // Text directly before such a space is measured together with the space
  // instead of alone, so its kerned width costs no extra Canvas call. Other
  // occurrences of the same text measure it alone.
  function getTextMetrics(text: string, followingSpaceTail: string | null): SegmentMetrics {
    return followingSpaceTail === '' ? getFollowingSpaceMetrics(text, fontMeasurement) : getSegmentMetrics(text, fontMeasurement)
  }

  // A zero-width break before the space ends the measured item, so only the
  // item's kerning with the space is added to the text's own width.
  function getTailKerning(item: string): number {
    return getFollowingSpaceMetrics(item, fontMeasurement).width - getSegmentMetrics(item, fontMeasurement).width - spaceWidth
  }

  // WebKit splits text items where resolved bidi levels change before it
  // measures them. Format characters between a word and the space resolve with
  // that space, so they stay in the word's item, and the word's last glyph keeps
  // its kerning with the space, only when the space resolves to the word's
  // direction. Without the paragraph direction that is known when the word's last
  // letter or direction mark and the first one after the space have the same
  // direction, with only spaces and format characters between (UAX #9 N1).
  // Explicit embeddings, overrides and isolates end with their paragraph (UAX #9
  // X8), so only controls in the space's own paragraph leave its direction
  // unknown. Spaces arrive in order, so each paragraph is scanned once.
  let hasExplicitBidiControls: boolean | null = null
  let controlParagraphEnd = -1
  let paragraphHasExplicitBidiControls = false
  function spaceParagraphHasExplicitBidiControls(spaceStart: number): boolean {
    hasExplicitBidiControls ??= explicitBidiControlRe.test(normalized)
    if (!hasExplicitBidiControls) return false
    if (spaceStart < controlParagraphEnd) return paragraphHasExplicitBidiControls
    let start = spaceStart
    while (start > 0 && !isParagraphSeparatorCode(normalized.charCodeAt(start - 1))) start--
    let end = spaceStart
    while (end < normalized.length && !isParagraphSeparatorCode(normalized.charCodeAt(end))) end++
    controlParagraphEnd = end
    paragraphHasExplicitBidiControls = explicitBidiControlRe.test(normalized.slice(start, end))
    return paragraphHasExplicitBidiControls
  }
  function formatTailStaysWithWord(item: string, spaceStart: number): boolean {
    if (!trailingFormatCharacterRe.test(item)) return true
    const before = letterBeforeFormatTailRe().exec(item)
    if (before === null) return false
    letterAfterSpacesRe().lastIndex = spaceStart
    const after = letterAfterSpacesRe().exec(normalized)
    if (after === null) return false
    // An ASCII digit takes the direction of the text before it (UAX #9 W7 and N1).
    const next = after[1]!
    return (next.charCodeAt(0) <= 0x39 || rightToLeftLetterRe.test(before[1]!) === rightToLeftLetterRe.test(next)) &&
      !spaceParagraphHasExplicitBidiControls(spaceStart)
  }

  // The source a run of combining marks shapes after when only zero-width glue,
  // controls or other such runs, with no break, separate the run from the grapheme
  // before it: that grapheme and what separates them. Without the separators, Canvas
  // can compose the marks with the grapheme or draw both in another font. A walk that
  // reaches the last run that asked takes that run's answer, so each segment is walked
  // and each grapheme found once, however many runs share it. Once what separates them
  // passes MARK_CHAIN_CONTEXT_UNITS, the context keeps the grapheme and the fewest of the
  // chain's last runs, each with the separators before it, that hold at least that many
  // units: in Chrome, Safari and Firefox, runs of 1 to 400 marks then measure as they do
  // after the whole chain, to 0.002px, and without the grapheme some took 25px less
  // (RESEARCH.md, Break Opportunities From Engine Data).
  let markRunIndex = -1
  let markBaseStart = -1 // where that run's grapheme starts in the normalized text, or -1
  let markChainStart = -1 // the segment after that grapheme
  let markChainKept = -1 // the first segment of the chain the context keeps
  function getMarkContext(analysisIndex: number, text: string): string | null {
    if ((flags[analysisIndex]! & UNBROKEN) === 0 || !markRunRe.test(text)) return null
    let baseStart = -1
    for (let k = analysisIndex - 1; k >= 0; k--) {
      const kind = flags[k]! & KIND_BITS
      const start = starts[k]!
      const end = starts[k + 1]!
      if (kind === ZERO_WIDTH_GLUE || ((kind === TEXT || kind === CONTROL) && controlOrMarkRunRe.test(texts[k]!))) {
        if (k !== markRunIndex) continue
        baseStart = markBaseStart
      } else if (kind === TEXT) {
        const ends = new Int32Array(end - start)
        const count = findGraphemeEnds(engineProfile.graphemeTable, normalized, start, end, ends)
        baseStart = count > 1 ? ends[count - 2]! : start
        markChainStart = markChainKept = k + 1
      }
      break
    }
    markRunIndex = analysisIndex
    markBaseStart = baseStart
    if (baseStart < 0) return null
    const start = starts[analysisIndex]!
    return start - baseStart > MARK_CHAIN_CONTEXT_UNITS ? getLongMarkChainContext(baseStart, start) : normalized.slice(baseStart, start)
  }
  // Apart from getMarkContext(), which prepare() calls for every segment, so that V8
  // still inlines that one there (RESEARCH.md, Keeping Work Bounded). V8 inlines a
  // function only while its bytecode stays under about 460 bytes, whether or not the
  // source is minified: with this loop inside, getMarkContext() took 519 bytes and
  // Chrome 154's prepare() ran 0.4-2.6% slower; without it, 374 (Node 23, V8 12.9). Before
  // growing getMarkContext(), check it with node --print-bytecode and
  // --trace-turbo-inlining, and bench Chrome's prepare() rows against main.
  function getLongMarkChainContext(baseStart: number, start: number): string {
    // The kept part starts after the grapheme or a run of marks, moves only forward and
    // never holds fewer than MARK_CHAIN_CONTEXT_UNITS.
    for (let k = markChainKept + 1; start - starts[k]! >= MARK_CHAIN_CONTEXT_UNITS; k++) {
      if (markRunRe.test(texts[k - 1]!)) markChainKept = k
    }
    if (markChainKept === markChainStart) return normalized.slice(baseStart, start)
    return normalized.slice(baseStart, starts[markChainStart]) + normalized.slice(starts[markChainKept], start)
  }

  // Whether the text may hold graphemes that take no letter spacing in this engine, and
  // Blink's script run over it.
  const cursiveSpacing = hasLetterSpacing && engineProfile.unspacedCursive !== 'none' && mayBeCursiveRe().test(normalized)
  const scriptRun = cursiveSpacing && engineProfile.unspacedCursive === 'run' ? startScriptRun(normalized) : null

  const widths: number[] = []
  // An engine's scan makes one prepared segment per analysis segment, whose flags the
  // walkers, layout()'s count and rich-inline layout read where the scan gives no break.
  const segmentFlags = new Uint8Array(segmentCount)
  // Text of the simple walkers' kinds without letter spacing. They lay it out where
  // the scan breaks at every segment boundary, and layout() counts it with the
  // simple stepper where it doesn't (countPreparedLines).
  let simpleKinds = !hasLetterSpacing
  const breakableFitAdvances: (number[] | null)[] = []
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let lineStartProhibitions: (Uint8Array | null)[] | null = null
  // WebKit's line-start rule applies only in text holding a code unit above U+00FF.
  const keepsLineStartPunctuation = engineProfile.keepsLineStartPunctuation && /[\u0100-\uFFFF]/.test(normalized)
  const segments = includeSegments ? [] as string[] : null
  let discretionaryHyphenContexts: number[] | null = null
  let previousJoinablePiece: string | null = null
  let previousJoinableMetrics: SegmentMetrics | null = null

  // Pieces split by a soft hyphen are measured apart, but Blink and Gecko shape
  // the unbroken text together: cursive joins, marks and kerning across the soft
  // hyphen. Canvas shows how much narrower the neighbors measure joined than
  // apart, which isolated widths can't show when proving that a hyphen overflows.
  // WebKit's return fits each side as measured alone and takes none (unfitHyphenRetreat).
  const returnFitsEachSideAlone = engineProfile.unfitHyphenRetreat === 'full-width-or-first'
  function getJoinedNarrowing(analysisIndex: number, before: string | null, beforeMetrics: SegmentMetrics | null): number {
    if (before === null) return 0
    let next = analysisIndex + 1
    while (next < segmentCount && (flags[next]! & KIND_BITS) === SOFT_HYPHEN) next++
    if (next >= segmentCount || (flags[next]! & KIND_BITS) !== TEXT) return 0
    const after = texts[next]!
    const apart = getCorrectedSegmentWidth(before, beforeMetrics!, fontMeasurement, emojiCorrection) + getTextWidth(after, fontMeasurement, emojiCorrection)
    const together = getTextWidth(before + after, fontMeasurement, emojiCorrection)
    return apart - together > engineProfile.lineFitEpsilon ? apart - together : 0
  }

  function getEntryGeometry(text: string, fit: SegmentFit, width: number, fitBasis: 'fresh' | 'original'): SegmentEntryGeometry | null {
    // The fit fixes the text, font and advances, and Pretext sets no other context state.
    // Only the WebKit profile moves the advances by a following space, and it observes
    // no entries.
    const cached = fit.entryGeometry
    if (cached !== null && cached.letterSpacing === letterSpacing && cached.emojiCorrection === emojiCorrection) return cached.geometry
    const geometry = observeSegmentEntries(text, fit.advances!, letterSpacing, width, fitBasis,
      source => measureWithLetterSpacing(source, letterSpacing, emojiCorrection, fontMeasurement))
    // Replacing this last observation leaves prepared copies intact.
    fit.entryGeometry = { letterSpacing, emojiCorrection, geometry }
    return geometry
  }

  // A text segment's width as measured: alone, or together with the following space less
  // that space, plus the item's kerning with a space that follows zero-width breaks. Apart
  // from the loop below, whose code JavaScriptCore otherwise never optimizes fully on CJK
  // text (RESEARCH.md, Keeping Work Bounded).
  function getTextSegmentWidth(text: string, textMetrics: SegmentMetrics, measuredWithSpace: boolean, followingSpaceKerning: number): number {
    return getCorrectedSegmentWidth(text, textMetrics, fontMeasurement, emojiCorrection) - (measuredWithSpace ? spaceWidth : 0) + followingSpaceKerning
  }

  for (let mi = 0; mi < segmentCount; mi++) {
    const text = texts[mi]!
    const segment = flags[mi]!
    const kind = (segment & KIND_BITS) as SegmentKindCode
    let width = 0
    // Graphemes that take letter spacing after them.
    let spacingGraphemeCount = 0
    let fitAdvances: number[] | null = null
    let entry: SegmentEntryGeometry | null = null
    let prohibitions: Uint8Array | null = null
    switch (kind) {
      case TEXT: {
        // A control the engine hides takes no advance, only letter spacing.
        if (engineProfile.hidesControlCharacters && controlCharacterRe.test(text)) {
          spacingGraphemeCount = 1
          break
        }
        // Such a run of marks adds its context with the marks, minus the context, and
        // takes no letter spacing of its own.
        const markContext = getMarkContext(mi, text)
        if (markContext !== null) {
          width = engineProfile.shapesMarksAcrossSoftHyphen && texts[mi - 1] === '\u00AD' && nonspacingMarkRunRe.test(text)
            ? 0
            : getTextWidth(markContext + text, fontMeasurement, emojiCorrection) - getTextWidth(markContext, fontMeasurement, emojiCorrection)
          break
        }
        // With an empty following-space tail, the text is measured together with the
        // space; with a zero-width tail, the item's kerning is added.
        const followingSpaceTail = getFollowingSpaceTail(mi, text)
        const measuredWithSpace = followingSpaceTail === ''
        const textMetrics = getTextMetrics(text, followingSpaceTail)
        previousJoinablePiece = text
        previousJoinableMetrics = textMetrics
        const followingSpaceKerning = followingSpaceTail === null || measuredWithSpace ? 0 : getTailKerning(text + followingSpaceTail)
        width = getTextSegmentWidth(text, textMetrics, measuredWithSpace, followingSpaceKerning)
        // The walkers put a gap after every grapheme of a spaced segment, so a grapheme
        // the engine gives none takes one back from its advance, here and in the advances
        // a break inside the segment falls by.
        let unspaced: number[] | null = null
        if (hasLetterSpacing) {
          spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
          if (cursiveSpacing) {
            unspaced = getUnspacedGraphemes(text, engineProfile.graphemeTable, scriptRun)
            if (unspaced !== null) width -= unspaced.length * letterSpacing
          }
        }
        // Under break-word, Blink retries an overflowing line with a break allowed between
        // any two graphemes (line_breaker.cc), WebKit searches the word's grapheme prefixes
        // (TextUtil::breakWord) and Gecko may wrap before any cluster (gfxTextRun.cpp:1069-1072),
        // so every text segment takes emergency grapheme breaks, unless it is one Gecko cluster
        // or an atomic item's.
        if (!overflowBreaks || (segment & ONE_CLUSTER) !== 0 || text.length === 1) break
        const fitMode: BreakableFitMode = letterSpacing !== 0 ? 'segment-prefixes'
          : numericRunRe.test(text) ? 'pair-context'
          : textMetrics.width >= engineProfile.prefixFitMinWidth ? 'segment-prefixes'
          : 'sum-graphemes'
        const fit = getSegmentFit(text, textMetrics, fontMeasurement, emojiCorrection, fitMode,
          measuredWithSpace ? spaceWidth : null, engineProfile.keepsLineStartPunctuation)
        fitAdvances = fit.advances
        if (fitAdvances === null) break
        // The cached advances are shared by every occurrence of this text; only
        // the final grapheme touches the following space.
        if (followingSpaceKerning !== 0) {
          fitAdvances = fitAdvances.slice()
          fitAdvances[fitAdvances.length - 1] = fitAdvances[fitAdvances.length - 1]! + followingSpaceKerning
        }
        // Such a segment takes no entry geometry, whose fresh widths Canvas would space
        // by its own rule (ENGINE_FOLLOWUPS.md, Letter spacing).
        if (unspaced !== null) {
          fitAdvances = fitAdvances.slice()
          for (let k = 0; k < unspaced.length; k++) fitAdvances[unspaced[k]!] = fitAdvances[unspaced[k]!]! - letterSpacing
        } else if (entryFitBasis !== 'disabled') {
          entry = getEntryGeometry(text, fit, addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing), entryFitBasis)
        }
        if (keepsLineStartPunctuation) prohibitions = fit.lineStartProhibitions
        break
      }
      case SPACE:
      case PRESERVED_SPACE:
      case ZERO_WIDTH_BREAK:
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        if (hasLetterSpacing) spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
        break
      case TAB:
        if (engineProfile.letterSpaceTabs) spacingGraphemeCount = 1
        if (minimumTabAdvance === 0) minimumTabAdvance = getTextWidth(engineProfile.tabMinimumCharacter, fontMeasurement, emojiCorrection) / 2
        break
      case CONTROL: {
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        // NEL shares a WebKit text item with the text before it and with
        // combining marks after it, and the complex text path spaces it. Complex
        // text shares the item only when its direction matches the page's, which
        // preparation cannot see, so NEL next to complex text keeps its spacing.
        const nextText = mi + 1 < segmentCount ? texts[mi + 1]! : ''
        if (hasLetterSpacing && (
          (mi > 0 && (flags[mi - 1]! & KIND_BITS) === TEXT && needsComplexTextPath(texts[mi - 1]!)) ||
          (leadingCombiningMarkRe().test(nextText) && needsComplexTextPath(nextText))
        )) spacingGraphemeCount = 1
        break
      }
      case SOFT_HYPHEN:
      case ZERO_WIDTH_GLUE:
      case HARD_BREAK:
        break
    }
    if (kind !== TEXT && kind !== SPACE && kind !== ZERO_WIDTH_BREAK) simpleKinds = false
    if (kind !== TEXT && kind !== SOFT_HYPHEN) previousJoinablePiece = null
    segmentFlags[mi] = (segment & ~ONE_CLUSTER) | (hasLetterSpacing && spacingGraphemeCount > 0 ? SPACED : 0)
    widths.push(addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing))
    breakableFitAdvances.push(fitAdvances)
    if (entry !== null && entryGeometry === null) entryGeometry = Array.from({ length: mi }, () => null)
    entryGeometry?.push(entry)
    if (prohibitions !== null && lineStartProhibitions === null) lineStartProhibitions = Array.from({ length: mi }, () => null)
    lineStartProhibitions?.push(prohibitions)
    if (segments !== null) segments.push(text)
    // Contexts for every segment of soft hyphens, whatever its kind here: one that is glue,
    // where this text's scan gives no break after it, as at the start of a Gecko text, can
    // be a soft hyphen in the text rich inline joins (recordJoinedBreaks), where a line ends
    // with the hyphen measured below.
    if (kind !== TEXT && text.charCodeAt(0) === 0xAD) {
      discretionaryHyphenContexts ??= zeros(mi)
      discretionaryHyphenContexts.push(returnFitsEachSideAlone ? 0 : getJoinedNarrowing(mi, previousJoinablePiece, previousJoinableMetrics))
    } else {
      discretionaryHyphenContexts?.push(0)
    }
  }

  // The hyphen a chosen soft hyphen paints, which only a text that holds one asks for, with
  // the gap before it, plus the hyphen's own spacing where the engine letter-spaces it.
  const hyphenText = discretionaryHyphenContexts === null ? '-' : engineProfile.hyphenFromPrimaryFont ? getHyphenText(fontMeasurement) : '\u2010'
  const discretionaryHyphenWidth = getTextWidth(hyphenText, fontMeasurement, emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * (engineProfile.letterSpaceDiscretionaryHyphen ? 2 : 1))

  // A segment's width is its width between the text before and after it; one that starts
  // a line takes back the halt Blink gives its first character there.
  let hanKerning: HanKerningTrims = { widthTrims: null, lineStartExtras: null, lineEndTrims: null, overflowLineEndTrims: null }
  if (engineProfile.hanKerning && textMayHanKern(normalized)) {
    hanKerning = getHanKerningTrims(fontMeasurement, analysis)
    const trims = hanKerning.widthTrims
    if (trims !== null) for (let i = 0; i < trims.length; i++) widths[i] = widths[i]! - trims[i]!
  }
  let lineEndTrims = hanKerning.lineEndTrims
  if (engineProfile.hangsIdeographicSpace && normalized.includes('\u3000')) {
    lineEndTrims = addIdeographicSpaceHangs(lineEndTrims, analysis, fontMeasurement, letterSpacing, discretionaryHyphenWidth)
  }
  const prepared = {
    widths,
    segmentFlags,
    simpleLineWalkFastPath: simpleKinds && !analysis.hasUnbroken,
    simpleLineCountFastPath: simpleKinds,
    breakableFitAdvances,
    entryGeometry,
    letterSpacing,
    discretionaryHyphenWidth,
    discretionaryHyphenContexts,
    lineStartProhibitions,
    lineStartExtras: hanKerning.lineStartExtras,
    lineEndTrims,
    overflowLineEndTrims: hanKerning.overflowLineEndTrims,
    tabStopAdvance,
    minimumTabAdvance,
  } as unknown as PreparedText & PreparedSegments
  if (segments !== null) prepared.segments = segments
  return prepared
}

// Blink (Chrome 153) hangs a run of U+3000 that ends a line, as it hangs spaces: ShapingLineBreaker
// counts U+3000 as a breakable space (IsBreakableSpace, shaping_line_breaker.cc:38-41, with
// Character::IsOtherSpaceSeparator, character.h:156-158), so a line whose width runs out on
// the run ends after it and fits without it (shaping_line_breaker.cc:384-452), and the line
// breaker keeps the run as trailing space (HandleTrailingSpaces, line_breaker.cc:2447-2514),
// in normal and pre-wrap white space alike. A text segment that ends in such a run, where a
// line can end after it or a collapsible space follows, which hangs with it, drops the run
// and its letter spacing at a line end. The line then ends where the run starts
// (shaping_line_breaker.cc:490-493), so after a soft hyphen it ends with a hyphen
// (SetBreakOffset, shaping_line_breaker.cc:212-216), which has to fit. Gecko (Firefox 156)
// marks U+3000 as a space glyph, like SPACE (SetupClusterBoundaries, gfxFont.cpp:749-750), and
// BreakAndMeasureText fits a line without its trailing space glyphs (gfxTextRun.cpp:1152-1160,
// 1175), so Firefox hangs the run too.
function addIdeographicSpaceHangs(
  trims: number[] | null,
  analysis: TextAnalysis,
  measurement: FontMeasurement,
  letterSpacing: number,
  hyphenWidth: number,
): number[] | null {
  const { normalized, starts, flags } = analysis
  for (let i = 0; i < flags.length; i++) {
    const end = i + 1 < flags.length ? starts[i + 1]! : normalized.length
    if ((flags[i]! & KIND_BITS) !== TEXT || normalized.charCodeAt(end - 1) !== 0x3000) continue
    if (i + 1 < flags.length) {
      const next = flags[i + 1]! & KIND_BITS
      if (next !== HARD_BREAK && next !== SPACE && !(next === TEXT && (flags[i + 1]! & UNBROKEN) === 0)) continue
    }
    let start = end - 1
    while (start > starts[i]! && normalized.charCodeAt(start - 1) === 0x3000) start--
    const run = normalized.slice(start, end)
    const afterSoftHyphen = i > 0 && start === starts[i] && normalized.charCodeAt(start - 1) === 0xAD
    const hang = getSegmentMetrics(run, measurement).width + run.length * letterSpacing - (afterSoftHyphen ? hyphenWidth : 0)
    if (hang <= 0) continue
    trims ??= zeros(flags.length)
    trims[i] = trims[i]! + hang
  }
  return trims
}
