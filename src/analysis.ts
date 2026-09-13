import { getLineBreakClass, LineBreakClass } from './generated/line-break-data.js'

export type WhiteSpaceMode = 'normal' | 'pre-wrap'
export type WordBreakMode = 'normal' | 'keep-all'

export type SegmentBreakKind =
  | 'text'
  | 'space'
  | 'preserved-space'
  | 'tab'
  | 'glue'
  | 'zero-width-break'
  | 'soft-hyphen'
  | 'hard-break'
  | 'control'

type SegmentationPiece = {
  text: string
  isWordLike: boolean
  kind: SegmentBreakKind
  start: number
}

export type MergedSegmentation = {
  len: number
  texts: string[]
  isWordLike: boolean[]
  kinds: SegmentBreakKind[]
  starts: number[]
}

export type TextAnalysis = { source: string; normalized: string } & MergedSegmentation

export type AnalysisProfile = {
  geckoAsciiLineBreaks: boolean
  carryCJKAfterClosingQuote: boolean
  keepAllPairModel: KeepAllPairModel
  keepZeroWidthSpaceMarkAtScanStart: boolean
  breakBeforeConditionalJapaneseStarter: boolean
  breakAroundEastAsianQuotes: boolean
  wordInitialHyphenLetters: 'none' | 'alphabetic' | 'alphabetic-and-hebrew'
  breakHyphenAfterCollapsedTab: boolean
  segmentBreakRemovalRun: SegmentBreakRemovalRun
  breakOnlyAfterNextLine: boolean
}

// Which pairs `word-break: keep-all` keeps. Blink keeps letters and numbers by
// general category, Gecko's ICU4X keeps pairs by line-break class, and WebKit
// breaks only at spaces.
export type KeepAllPairModel = 'blink-general-category' | 'icu4x-classes' | 'webkit-spaces'

// The collapsible run that a ZWSP removes under the CSS segment break
// transformation, per engine. WebKit never removes one.
export type SegmentBreakRemovalRun = 'none' | 'blink' | 'gecko'

// Page languages whose line-break rules differ in some engine. Every other
// language, an empty or missing one, and no document read as root.
export type BreakLanguage = 'root' | 'ja' | 'ko' | 'zh'

// The primary language subtag, ASCII case-insensitively, up to `-`, `_` or the
// end. No allocation: preparation calls this once per text.
export function getBreakLanguage(tag: string | null): BreakLanguage {
  if (tag === null || tag.length < 2) return 'root'
  if (tag.length > 2 && tag.charCodeAt(2) !== 0x2D && tag.charCodeAt(2) !== 0x5F) return 'root'
  const first = tag.charCodeAt(0) | 0x20
  const second = tag.charCodeAt(1) | 0x20
  if (first === 0x6A && second === 0x61) return 'ja'
  if (first === 0x6B && second === 0x6F) return 'ko'
  if (first === 0x7A && second === 0x68) return 'zh'
  return 'root'
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

function isSegmentBreakRunSpace(code: number, run: SegmentBreakRemovalRun): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || (code === 0x0D && run === 'blink')
}

function isGeckoBidiControl(code: number): boolean {
  return code === 0x061C || code === 0x200E || code === 0x200F ||
    (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069)
}

// A character a run continues through but never starts or ends on.
function isSegmentBreakRunDiscardable(code: number, run: SegmentBreakRemovalRun): boolean {
  return run === 'gecko' && (code === 0x00AD || isGeckoBidiControl(code))
}

// Gecko's combining sequence tail: bidi controls, then a cluster extender
// other than ZWJ/ZWNJ, read as UTF-16 units.
function startsGeckoSpaceCombiningSequenceTail(text: string, index: number): boolean {
  for (; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (isGeckoBidiControl(code)) continue
    return code === 0xFF9E || code === 0xFF9F || (code >= 0x0300 && combiningMarkRe.test(text[index]!))
  }
  return false
}

// CSS segment break transformation in normal white space. Blink and Gecko
// delete a collapsible run containing LF when a ZWSP immediately precedes or
// follows the run. Each engine collects its own run:
// - Blink: SPACE, TAB, LF and CR.
// - Gecko: SPACE, TAB and LF, continuing through SHY and bidi controls without
//   ending on one, and leaving out a last SPACE before a combining sequence tail.
// Characters outside the run, such as FF, keep the ordinary collapse.
export function removeSegmentBreaksNextToZeroWidthSpace(text: string, profile: AnalysisProfile): string {
  const run = profile.segmentBreakRemovalRun
  if (run === 'none' || !text.includes('\u200B')) return text
  let result = ''
  let copied = 0
  // Only a run containing LF can be removed. Expand each LF to its run once;
  // the next search starts where this run's scan stopped.
  for (let newline = text.indexOf('\n'); newline !== -1;) {
    let start = newline
    for (let index = newline - 1; index >= 0; index--) {
      const code = text.charCodeAt(index)
      if (isSegmentBreakRunSpace(code, run)) start = index
      else if (!isSegmentBreakRunDiscardable(code, run)) break
    }
    let end = newline + 1
    let index = end
    for (; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (isSegmentBreakRunSpace(code, run)) end = index + 1
      else if (!isSegmentBreakRunDiscardable(code, run)) break
    }
    newline = text.indexOf('\n', index)
    if (run === 'gecko' && text.charCodeAt(end - 1) === 0x20 && startsGeckoSpaceCombiningSequenceTail(text, end)) end--
    if (text.charCodeAt(start - 1) !== 0x200B && text.charCodeAt(end) !== 0x200B) continue
    result += text.slice(copied, start)
    for (let member = start; member < end; member++) {
      if (!isSegmentBreakRunSpace(text.charCodeAt(member), run)) result += text[member]
    }
    copied = end
  }
  return copied === 0 ? text : result + text.slice(copied)
}

export function normalizeWhitespaceNormal(text: string, profile: AnalysisProfile): string {
  if (!needsWhitespaceNormalizationRe.test(text)) return text

  let normalized = removeSegmentBreaksNextToZeroWidthSpace(text, profile).replace(collapsibleWhitespaceRunRe, ' ')
  if (normalized.charCodeAt(0) === 0x20) {
    normalized = normalized.slice(1)
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 0x20) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function normalizeWhitespacePreWrap(text: string): string {
  if (!/[\r\f]/.test(text)) return text
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\r\f]/g, '\n')
}

let sharedGraphemeSegmenter: Intl.Segmenter | null = null

export function getSharedGraphemeSegmenter(): Intl.Segmenter {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return sharedGraphemeSegmenter
}

let sharedWordSegmenter: Intl.Segmenter | null = null
let segmenterLocale: string | undefined

function getSharedWordSegmenter(): Intl.Segmenter {
  if (sharedWordSegmenter === null) {
    sharedWordSegmenter = new Intl.Segmenter(segmenterLocale, { granularity: 'word' })
  }
  return sharedWordSegmenter
}

export function clearAnalysisCaches(): void {
  sharedGraphemeSegmenter = null
  sharedWordSegmenter = null
}

export function setAnalysisLocale(locale?: string): void {
  const nextLocale = locale && locale.length > 0 ? locale : undefined
  if (segmenterLocale === nextLocale) return
  segmenterLocale = nextLocale
  sharedWordSegmenter = null
}

const arabicScriptRe = /\p{Script=Arabic}/u
const combiningMarkRe = /\p{M}/u
const decimalDigitRe = /\p{Nd}/u

function containsArabicScript(text: string): boolean {
  return arabicScriptRe.test(text)
}

// CJK ranges used by the wrapping policy, including supplementary ideographs.
const cjkRe = /[\u3000-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u{20000}-\u{2A6DF}\u{2A700}-\u{2EE5D}\u{2F800}-\u{2FA1F}\u{30000}-\u{33479}]/u

export function isCJK(s: string): boolean {
  return cjkRe.test(s)
}

function endsWithLineStartProhibitedText(text: string, profile: AnalysisProfile): boolean {
  const last = getLastCodePoint(text)
  return last !== null && (prohibitsCJKLineStart(last, profile) || leftStickyPunctuation.has(last))
}

const keepAllGlueChars = new Set([
  '\u00A0',
  '\u202F',
  '\u2060',
  '\uFEFF',
])

const keepAllDashBreakChars = new Set([
  '-',
  '\u2010',
  '\u2013',
  '\u2014',
])

function endsWithKeepAllGlueText(text: string): boolean {
  const last = getLastCodePoint(text)
  return last !== null && keepAllGlueChars.has(last)
}

function endsWithKeepAllDashBreakText(text: string): boolean {
  const last = getLastCodePoint(text)
  return last !== null && keepAllDashBreakChars.has(last)
}

const letterOrNumberRe = /[\p{L}\p{N}]/u
const letterOrNumberAtRe = /[\p{L}\p{N}]/uy

// Keep-all suppresses breaks between letters. Blink keeps any pair of letters
// or numbers by general category, so a letter that cannot start a line, such as
// U+3005 or U+30FC, does not end a run. ICU4X in Gecko keeps pairs by UAX #14
// class instead (AI, AL, ID, NU, HY, H2, H3, JL, JV, JT and CJ, with a CM taking
// its base's class): after an ideograph it keeps U+30FC (CJ) and U+3035 (CM),
// but it still breaks after an NS letter such as U+3005.
function endsWithKeepAllLetter(text: string, profile: AnalysisProfile): boolean {
  const last = getLastCodePoint(text)
  if (last === null || !letterOrNumberRe.test(last)) return false
  return profile.keepAllPairModel !== 'icu4x-classes' || getCJKLineStartClass(last) !== LineBreakClass.NS
}

// Ideographs, kana and Hangul syllables, which every keep-all pair model keeps.
function isPlainKeepAllLetterCode(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0xAC00 && code <= 0xD7A3) ||
    (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x3041 && code <= 0x3096) ||
    (code >= 0x30A1 && code <= 0x30FA)
  )
}

// A UTF-16 code unit that Blink's keep-all rule keeps: a letter or number by
// general category whose line-break class is not SA. A surrogate is neither.
function isBlinkKeepAllLetterUnit(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  if (!(code < 0xD800 || code > 0xDFFF)) return false
  letterOrNumberAtRe.lastIndex = index
  return letterOrNumberAtRe.test(text) && getLineBreakClass(code) !== LineBreakClass.SA
}

// Blink keeps a pair when the code unit after the boundary keeps, and so does
// the one before it, or the one before that when it is a mark.
function blinkKeepsKeepAllPair(text: string, boundary: number): boolean {
  let before = boundary - 1
  const code = text.charCodeAt(before)
  if (code >= 0x0300 && (code < 0xD800 || code > 0xDFFF)) {
    combiningMarkAtRe.lastIndex = before
    if (combiningMarkAtRe.test(text)) before--
  }
  return isBlinkKeepAllLetterUnit(text, before) && isBlinkKeepAllLetterUnit(text, boundary)
}

// The projected classes ICU4X keeps under keep-all. The table reads AI, XX and
// CB as AL and Hangul classes as ID; ICU4X does not keep XX or CB.
const icu4xKeepAllClasses =
  (1 << LineBreakClass.AL) | (1 << LineBreakClass.ID) | (1 << LineBreakClass.NU) |
  (1 << LineBreakClass.HY) | (1 << LineBreakClass.CJ)

// Classes that UAX #14 never lets start a line inside a run of text: CM and
// ZWJ (LB9), WJ (LB11), GL (LB12a), CL, CP, EX and SY (LB13), IS (LB15d), QU
// (LB19), BA, HH, HY and NS (LB21), IN (LB22) and EM (LB30b), and the spaces and
// breaks a run never holds.
const noBreakBeforeRunClasses =
  (1 << LineBreakClass.CM) | (1 << LineBreakClass.WJ) | (1 << LineBreakClass.GL) | (1 << LineBreakClass.CL) |
  (1 << LineBreakClass.CP) | (1 << LineBreakClass.EX) | (1 << LineBreakClass.SY) | (1 << LineBreakClass.IS) |
  (1 << LineBreakClass.QU) | (1 << LineBreakClass.BA) | (1 << LineBreakClass.HH) | (1 << LineBreakClass.HY) |
  (1 << LineBreakClass.NS) | (1 << LineBreakClass.IN) | (1 << LineBreakClass.EM) | (1 << LineBreakClass.BK) |
  (1 << LineBreakClass.SP) | (1 << LineBreakClass.ZW)

// Classes that UAX #14 never lets end a line inside a run of text: WJ and GL
// (LB11, LB12), OP (LB14), QU (LB19) and BB (LB21). HY and HH keep a letter at a
// word start (LB20a) and after a Hebrew letter (LB21a), so they count too.
const noBreakAfterRunClasses =
  (1 << LineBreakClass.WJ) | (1 << LineBreakClass.GL) | (1 << LineBreakClass.OP) | (1 << LineBreakClass.QU) |
  (1 << LineBreakClass.BB) | (1 << LineBreakClass.HY) | (1 << LineBreakClass.HH) | (1 << LineBreakClass.BK) |
  (1 << LineBreakClass.SP) | (1 << LineBreakClass.ZW)

const alphabeticOrNumericClasses = (1 << LineBreakClass.AL) | (1 << LineBreakClass.HL) | (1 << LineBreakClass.NU)
const ideographicClasses = (1 << LineBreakClass.ID) | (1 << LineBreakClass.EB) | (1 << LineBreakClass.EM)

// OP code points with East Asian Width F, W or H (EastAsianWidth.txt, Unicode
// 17), which LB30 does not keep after letters or numbers. No CP code point is
// East Asian.
function isEastAsianOpeningPunctuationCode(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x303F) || (code >= 0xFE10 && code <= 0xFE6F) ||
    (code >= 0xFF00 && code <= 0xFFEF) || code === 0x2329
  )
}

// Whether UAX #14 allows a break between two classes inside a run of text,
// where no space intervenes. It follows the Unicode 17 rules and keeps every
// pair that one of them keeps in some context, so a break it allows holds in
// every context under those rules. Engines on older rules can keep more:
// ICU4X's LB21a also keeps what follows a Hebrew letter and BA, which the
// caller checks. `before` is the class of the base before any trailing marks
// (LB9), and neither class is SA or CJ.
function lineBreakClassesBreak(before: number, after: number, afterCodePoint: number): boolean {
  if (((1 << after) & noBreakBeforeRunClasses) !== 0 || ((1 << before) & noBreakAfterRunClasses) !== 0) return false
  const afterClass = 1 << after
  switch (before) {
    case LineBreakClass.AL:
    case LineBreakClass.HL:
      // LB23, LB24 and LB28, a dotted circle in LB28a, and LB30.
      if (after === LineBreakClass.OP) return isEastAsianOpeningPunctuationCode(afterCodePoint)
      return (afterClass & (alphabeticOrNumericClasses | numericAffixClasses | (1 << LineBreakClass.AK))) === 0
    case LineBreakClass.NU:
      // LB23, LB25 and LB30.
      if (after === LineBreakClass.OP) return isEastAsianOpeningPunctuationCode(afterCodePoint)
      return (afterClass & (alphabeticOrNumericClasses | numericAffixClasses)) === 0
    case LineBreakClass.PR:
      // LB23a, LB24 and LB25.
      return (afterClass & (alphabeticOrNumericClasses | ideographicClasses | (1 << LineBreakClass.OP))) === 0
    case LineBreakClass.PO:
      // LB24 and LB25.
      return (afterClass & (alphabeticOrNumericClasses | (1 << LineBreakClass.OP))) === 0
    case LineBreakClass.ID:
    case LineBreakClass.EB:
    case LineBreakClass.EM:
      // LB23a.
      return after !== LineBreakClass.PO
    case LineBreakClass.CL:
      // LB25 after a number.
      return (afterClass & numericAffixClasses) === 0
    case LineBreakClass.CP:
      // LB25 and LB30.
      return (afterClass & (numericAffixClasses | alphabeticOrNumericClasses)) === 0
    case LineBreakClass.SY:
      // LB21b and LB25.
      return after !== LineBreakClass.HL && after !== LineBreakClass.NU
    case LineBreakClass.IS:
      // LB25 and LB29.
      return (afterClass & alphabeticOrNumericClasses) === 0
    case LineBreakClass.B2:
      // LB17. Pieces of text never split a pair of regional indicators, so
      // LB30a keeps nothing here.
      return after !== LineBreakClass.B2
    case LineBreakClass.AK:
      // LB28a.
      return after !== LineBreakClass.AK && after !== LineBreakClass.AL
    default:
      return true
  }
}

// The start of the base before `end`, past any trailing marks, which take its
// class (LB9), or -1 when the marks have no base.
function lineBreakBaseBefore(text: string, end: number): number {
  while (end > 0) {
    const start = previousCodePointStart(text, end)
    if (getLineBreakClass(text.codePointAt(start)!) !== LineBreakClass.CM) return start
    end = start
  }
  return -1
}

const openingQuoteAtRe = /\p{Pi}/uy
const closingQuoteAtRe = /\p{Pf}/uy
const cjkAtRe = new RegExp(cjkRe.source, 'uy')

const emojiPresentationAtRe = /\p{Emoji_Presentation}/uy

// Pretext's CJK ranges and emoji-presentation characters stand in for East
// Asian Width F, W and H here. Every assigned code point in them is East Asian
// except U+303F and the regional indicators.
function isEastAsianCodePointAt(text: string, index: number): boolean {
  cjkAtRe.lastIndex = index
  if (cjkAtRe.test(text)) return text.charCodeAt(index) !== 0x303F
  emojiPresentationAtRe.lastIndex = index
  return emojiPresentationAtRe.test(text) && getLineBreakClass(text.codePointAt(index)!) !== LineBreakClass.RI
}

// ICU 77 and 78 break before an opening quotation mark (QU and \p{Pi})
// between East Asian characters, looking past marks on either side (LB19a).
function breaksBeforeEastAsianOpeningQuote(text: string, boundary: number, base: number, baseClass: number): boolean {
  if (baseClass === LineBreakClass.OP || baseClass === LineBreakClass.GL) return false
  openingQuoteAtRe.lastIndex = boundary
  if (!openingQuoteAtRe.test(text) || !isEastAsianCodePointAt(text, base)) return false
  let next = openingQuoteAtRe.lastIndex
  for (let codePoint = text.codePointAt(next); codePoint !== undefined && getLineBreakClass(codePoint) === LineBreakClass.CM;) {
    next += codePoint > 0xFFFF ? 2 : 1
    codePoint = text.codePointAt(next)
  }
  return next < text.length && isEastAsianCodePointAt(text, next)
}

// Classes that LB19a still keeps after a closing quotation mark.
const noBreakAfterEastAsianQuoteClasses =
  (1 << LineBreakClass.NS) | (1 << LineBreakClass.BA) | (1 << LineBreakClass.EX) | (1 << LineBreakClass.CL) |
  (1 << LineBreakClass.IN) | (1 << LineBreakClass.IS) | (1 << LineBreakClass.GL) | (1 << LineBreakClass.CM)

// ICU 77 and 78 break after a closing quotation mark (QU and \p{Pf}) between
// East Asian characters, unless the next character keeps it (LB19a).
function breaksAfterEastAsianClosingQuote(text: string, boundary: number, profile: AnalysisProfile): boolean {
  if (!profile.breakAroundEastAsianQuotes || boundary >= text.length) return false
  const quote = lineBreakBaseBefore(text, boundary)
  if (quote < 0 || getLineBreakClass(text.codePointAt(quote)!) !== LineBreakClass.QU) return false
  closingQuoteAtRe.lastIndex = quote
  if (!closingQuoteAtRe.test(text)) return false
  const base = lineBreakBaseBefore(text, quote)
  return (
    base >= 0 && isEastAsianCodePointAt(text, base) && isEastAsianCodePointAt(text, boundary) &&
    ((1 << getLineBreakClass(text.codePointAt(boundary)!)) & noBreakAfterEastAsianQuoteClasses) === 0
  )
}

// Where the engine does not keep a pair, its ordinary rules decide, so a run
// ends where those rules allow a break. Chromium and WebKit decide pairs of
// code units up to U+00FF from their own tables before any keep-all rule, and
// Gecko decides ASCII pairs from its own model, so those stay with the
// punctuation rules below. No break follows ZWJ (LB8a). U+3000 is BA, but
// engines hang or trim it at a line edge, which needs its own model, so a run
// does not end next to it.
function endsKeepAllRunAtPair(text: string, boundary: number, profile: AnalysisProfile): boolean {
  const beforeCode = text.charCodeAt(boundary - 1)
  const afterCode = text.charCodeAt(boundary)
  if ((beforeCode <= 0xFF && afterCode <= 0xFF) || beforeCode === 0x200D || beforeCode === 0x3000 || afterCode === 0x3000) return false
  if (profile.keepAllPairModel === 'blink-general-category' && blinkKeepsKeepAllPair(text, boundary)) return false
  // Marks at the start of a segment's text have their base in the text before
  // it, which this check cannot see.
  const base = lineBreakBaseBefore(text, boundary)
  if (base < 0) return false
  const afterCodePoint = text.codePointAt(boundary)!
  let after = getLineBreakClass(afterCodePoint)
  let before = getLineBreakClass(text.codePointAt(base)!)
  if (profile.keepAllPairModel === 'icu4x-classes') {
    if (((1 << before) & icu4xKeepAllClasses) !== 0 && ((1 << after) & icu4xKeepAllClasses) !== 0) return false
    // ICU4X's Unicode 15.0 rules keep any character after a Hebrew letter and HY
    // or BA, past marks on either side (LB21a). ICU 78 replaced BA there with HH.
    // The pair rules below never break after HY or HH, and runs never end next to
    // U+3000, the one East Asian BA, so only BA needs this check. The dash and
    // line-start punctuation ends in getKeepAllRunEnd still end a run after a
    // Hebrew letter and `-`, U+2010, U+2013, U+0964, U+0965, U+104A or U+104B,
    // where both engines keep the next character.
    if (before === LineBreakClass.BA) {
      const letter = lineBreakBaseBefore(text, base)
      if (letter >= 0 && getLineBreakClass(text.codePointAt(letter)!) === LineBreakClass.HL) return false
    }
  }
  if (after === LineBreakClass.QU) {
    return profile.breakAroundEastAsianQuotes && breaksBeforeEastAsianOpeningQuote(text, boundary, base, before)
  }
  // SA letters read as AL (LB1), except against each other, where a dictionary
  // decides. CJ is ID under ICU's normal rules and NS under strict rules; before
  // the boundary ID keeps more pairs, so it stands for both.
  if (before === LineBreakClass.SA) {
    if (after === LineBreakClass.SA) return false
    before = LineBreakClass.AL
  } else if (after === LineBreakClass.SA) {
    after = LineBreakClass.AL
  }
  if (before === LineBreakClass.CJ) before = LineBreakClass.ID
  if (after === LineBreakClass.CJ) after = profile.breakBeforeConditionalJapaneseStarter ? LineBreakClass.ID : LineBreakClass.NS
  return lineBreakClassesBreak(before, after, afterCodePoint)
}

// Whether a keep-all run ends before the piece of text at `boundary`: 'end'
// after glue, listed punctuation or a dash, which also ends its keep-all group,
// or 'split' where the engine's pair rule and ordinary rules allow a break,
// which splits the group into runs.
function getKeepAllRunEnd(text: string, boundary: number, previousText: string, profile: AnalysisProfile): 'end' | 'split' | null {
  if (isPlainKeepAllLetterCode(text.charCodeAt(boundary - 1)) && isPlainKeepAllLetterCode(text.charCodeAt(boundary))) return null
  if (endsWithKeepAllGlueText(previousText)) return 'end'
  if (profile.keepAllPairModel === 'webkit-spaces') return null
  if (
    endsWithLineStartProhibitedText(previousText, profile)
      ? !endsWithKeepAllLetter(previousText, profile)
      : endsWithKeepAllDashBreakText(previousText)
  ) {
    return 'end'
  }
  return endsKeepAllRunAtPair(text, boundary, profile) ? 'split' : null
}

// In Unicode 17, Pretext's CJK ranges above hold no CP, IS, SY or IN code
// points, and U+3000 is their only BA: a space that engines hang or trim at a
// line end, which needs its own model. So by UAX #14 class, the code points in
// them that cannot start a line after other text are CL and EX (LB13), NS (LB21)
// and the CM U+3035, which does not extend a grapheme (LB9). Each of those CL, EX
// and NS code points is one code unit in U+3000-U+30FF or U+FF00-U+FFEF. Returns
// the class of a one-code-unit text in those blocks, or -1.
function getCJKLineStartClass(text: string): number {
  if (text.length !== 1) return -1
  const code = text.charCodeAt(0)
  return (code >= 0x3000 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF) ? getLineBreakClass(code) : -1
}

// Small kana and U+30FC are UAX #14 CJ, which the profile resolves: ID may start
// a line and NS may not.
function keepsConditionalJapaneseStarter(text: string, profile: AnalysisProfile): boolean {
  return !profile.breakBeforeConditionalJapaneseStarter && getLineBreakClass(text.codePointAt(0)!) === LineBreakClass.CJ
}

// Whether a grapheme or a code point cannot start a line after CJK text.
function prohibitsCJKLineStart(text: string, profile: AnalysisProfile): boolean {
  const lineBreakClass = getCJKLineStartClass(text)
  return lineBreakClass === LineBreakClass.CL || lineBreakClass === LineBreakClass.EX || lineBreakClass === LineBreakClass.NS ||
    text === '\u3035' || keepsConditionalJapaneseStarter(text, profile)
}

export const kinsokuEnd = new Set([
  '"',
  '(', '[', '{',
  '¡', '¿',
  '“', '‘', '‚', '„', '«', '‹',
  '\u2E18',
  '\uFF08',
  '\u3014',
  '\u3008',
  '\u300A',
  '\u300C',
  '\u300E',
  '\u3010',
  '\u3016',
  '\u3018',
  '\u301A',
])

const forwardStickyGlue = new Set([
  "'", '’',
])

export const leftStickyPunctuation = new Set([
  '.', ',', '!', '?', ':', ';',
  '\u060C',
  '\u061B',
  '\u061F',
  '\u0964',
  '\u0965',
  '\u104A',
  '\u104B',
  '\u104C',
  '\u104D',
  '\u104F',
  ')', ']', '}',
  '%',
  '"',
  '”', '’', '»', '›',
  '…',
])

// UAX #14 IS punctuation, which keeps a following letter (LB29). U+061B is EX.
const arabicNoSpaceTrailingPunctuation = new Set([
  ':',
  '.',
  '\u060C',
])

const myanmarMedialGlue = new Set([
  '\u104F',
])

// Closing quotes (UAX #14 QU) after which the Chromium profile carries CJK text.
// A fullwidth closing bracket such as U+300D or U+FF09 is CL instead, and Chromium
// breaks between it and a following ideograph.
const closingQuoteChars = new Set([
  '”', '’', '»', '›',
])

function isLeftStickyPunctuationSegment(segment: string): boolean {
  if (isPunctuationGlueCluster(segment)) return true
  let sawPunctuation = false
  for (const ch of segment) {
    if (leftStickyPunctuation.has(ch) || isLineBreakNumericAffix(ch)) {
      sawPunctuation = true
      continue
    }
    if (sawPunctuation && combiningMarkRe.test(ch)) continue
    return false
  }
  return sawPunctuation
}

// Whether a segmenter piece cannot start a line after CJK text: its first code
// point cannot, or it holds only such characters and left-sticky punctuation.
// Intl.Segmenter can join a nonstarter such as U+309B or U+30FD, or small kana,
// with the kana after it, so the first code point decides. Each code point is
// classified once.
function isCJKLineStartProhibitedSegment(segment: string, profile: AnalysisProfile): boolean {
  let first = true
  for (const ch of segment) {
    if (prohibitsCJKLineStart(ch, profile)) {
      if (first) return true
    } else if (!leftStickyPunctuation.has(ch)) {
      return false
    }
    first = false
  }
  return !first
}

function isForwardStickyClusterSegment(segment: string): boolean {
  if (isPunctuationGlueCluster(segment)) return true
  for (const ch of segment) {
    if (
      !kinsokuEnd.has(ch) &&
      !forwardStickyGlue.has(ch) &&
      !combiningMarkRe.test(ch) &&
      !isLineBreakNumericAffix(ch)
    ) {
      return false
    }
  }
  return segment.length > 0
}

function isPunctuationGlueCluster(segment: string): boolean {
  let sawPunctuation = false
  for (const ch of segment) {
    if (ch === '\\' || combiningMarkRe.test(ch)) continue
    if (kinsokuEnd.has(ch) || leftStickyPunctuation.has(ch) || forwardStickyGlue.has(ch)) {
      sawPunctuation = true
      continue
    }
    return false
  }
  return sawPunctuation
}

function previousCodePointStart(text: string, end: number): number {
  const last = end - 1
  if (last <= 0) return Math.max(last, 0)

  const lastCodeUnit = text.charCodeAt(last)
  if (lastCodeUnit < 0xDC00 || lastCodeUnit > 0xDFFF) return last

  const maybeHigh = last - 1
  if (maybeHigh < 0) return last

  const highCodeUnit = text.charCodeAt(maybeHigh)
  return highCodeUnit >= 0xD800 && highCodeUnit <= 0xDBFF ? maybeHigh : last
}

function getLastCodePoint(text: string): string | null {
  if (text.length === 0) return null
  const start = previousCodePointStart(text, text.length)
  return text.slice(start)
}

function getFirstSignificantCodePoint(text: string): string | null {
  for (const ch of text) {
    if (!combiningMarkRe.test(ch)) return ch
  }
  return null
}

function getLastSignificantCodePoint(text: string, end = text.length): string | null {
  for (; end > 0;) {
    const start = previousCodePointStart(text, end)
    const ch = text.slice(start, end)
    if (!combiningMarkRe.test(ch)) return ch
    end = start
  }
  return null
}

// UAX #14 PR and PO.
const numericAffixClasses = (1 << LineBreakClass.PR) | (1 << LineBreakClass.PO)

function isLineBreakNumericAffixCode(codePoint: number): boolean {
  return ((1 << getLineBreakClass(codePoint)) & numericAffixClasses) !== 0
}

function isLineBreakNumericAffix(ch: string): boolean {
  const codePoint = ch.codePointAt(0)
  return codePoint !== undefined && isLineBreakNumericAffixCode(codePoint)
}

function endsWithLineBreakNumericAffix(text: string): boolean {
  const last = getLastSignificantCodePoint(text)
  return last !== null && isLineBreakNumericAffix(last)
}

function startsWithDecimalDigit(text: string): boolean {
  const first = getFirstSignificantCodePoint(text)
  return first !== null && decimalDigitRe.test(first)
}

function splitTrailingForwardStickyCluster(text: string): { head: string, tail: string } | null {
  let splitIndex = text.length

  while (splitIndex > 0) {
    const start = previousCodePointStart(text, splitIndex)
    const ch = text.slice(start, splitIndex)
    if (combiningMarkRe.test(ch) || kinsokuEnd.has(ch) || forwardStickyGlue.has(ch)) {
      splitIndex = start
      continue
    }
    break
  }

  if (splitIndex <= 0 || splitIndex === text.length) return null
  return {
    head: text.slice(0, splitIndex),
    tail: text.slice(splitIndex),
  }
}

function getRepeatableSingleCharRunChar(
  text: string,
  isWordLike: boolean,
  kind: SegmentBreakKind,
): string | null {
  return kind === 'text' && !isWordLike && text.length === 1 && text !== '-' && text !== '—'
    ? text
    : null
}

function hasArabicNoSpacePunctuation(
  containsArabic: boolean,
  lastCodePoint: string | null,
): boolean {
  return containsArabic && lastCodePoint !== null && arabicNoSpaceTrailingPunctuation.has(lastCodePoint)
}

function endsWithMyanmarMedialGlue(segment: string): boolean {
  const lastCodePoint = getLastCodePoint(segment)
  return lastCodePoint !== null && myanmarMedialGlue.has(lastCodePoint)
}

function splitLeadingSpaceAndMarks(segment: string): { space: string, marks: string } | null {
  if (segment.length < 2 || segment[0] !== ' ') return null
  const marks = segment.slice(1)
  if (/^\p{M}+$/u.test(marks)) {
    return { space: ' ', marks }
  }
  return null
}

export function endsWithClosingQuote(text: string): boolean {
  let end = text.length
  while (end > 0) {
    const start = previousCodePointStart(text, end)
    const ch = text.slice(start, end)
    if (closingQuoteChars.has(ch)) return true
    if (!leftStickyPunctuation.has(ch)) return false
    end = start
  }
  return false
}

function classifySegmentBreakChar(ch: string, whiteSpace: WhiteSpaceMode, breakOnlyAfterNextLine: boolean): SegmentBreakKind {
  if (whiteSpace === 'pre-wrap') {
    if (ch === ' ') return 'preserved-space'
    if (ch === '\t') return 'tab'
    if (ch === '\n') return 'hard-break'
  }
  if (ch === ' ') return 'space'
  if (ch === '\u00A0' || ch === '\u2007' || ch === '\u202F' || ch === '\u2060' || ch === '\uFEFF') {
    return 'glue'
  }
  if (ch === '\u200B') return 'zero-width-break'
  if (ch === '\u00AD') return 'soft-hyphen'
  // UAX #14 NL: visible content with a break after it and none before it.
  if (ch === '\u0085' && breakOnlyAfterNextLine) return 'control'
  return 'text'
}

// All characters that classifySegmentBreakChar maps to a non-'text' kind.
const breakCharRe = /[\x20\t\n\x85\xA0\xAD\u2007\u200B\u202F\u2060\uFEFF]/

// The combining marks WebKit's pair scan classifies without ICU. That scan
// never breaks before them (BreakablePositions.h, `after.type == kCM`).
function isBasicCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036F && code !== 0x034F && (code < 0x035C || code > 0x0362)) ||
    (code >= 0x0483 && code <= 0x0489) ||
    (code >= 0x0591 && code <= 0x05BD) ||
    code === 0x05BF || code === 0x05C1 || code === 0x05C2 ||
    code === 0x05C4 || code === 0x05C5 || code === 0x05C7
  )
}

// UAX #14 BK, CR, LF and NL, which the class table reads as BK. LB7 forbids every
// other break before a ZWSP.
function isMandatoryBreakCode(code: number): boolean {
  return getLineBreakClass(code) === LineBreakClass.BK
}

// WebKit reports ZWSP|mark (LB8) only from an ICU lookup that starts before the
// ZWSP. A scan that starts at a text node's leading ZWSP makes no such lookup,
// and after a mandatory break ICU reports the earlier boundary, so the basic
// mark rule wins. Other source before the ZWSP, including a collapsible SPACE,
// is prior context. Normalization neither adds nor removes ZWSPs, so the nth
// normalized ZWSP is the nth source ZWSP. Returns normalized offsets.
function getMarkKeepingZeroWidthSpaces(source: string, normalized: string, profile: AnalysisProfile): Set<number> | null {
  if (!profile.keepZeroWidthSpaceMarkAtScanStart) return null
  let kept: Set<number> | null = null
  let sourceIndex = -1
  for (let index = normalized.indexOf('\u200B'); index >= 0; index = normalized.indexOf('\u200B', index + 1)) {
    sourceIndex = source.indexOf('\u200B', sourceIndex + 1)
    if (!isBasicCombiningMark(normalized.charCodeAt(index + 1))) continue
    if (sourceIndex > 0 && !isMandatoryBreakCode(source.charCodeAt(sourceIndex - 1))) continue
    if (kept === null) kept = new Set()
    kept.add(index)
  }
  return kept
}

// U+002D and the HH dashes that can still break after a collapsed TAB. The
// other Unicode 17 HH dashes already join the next text in every profile: the
// word segmenter keeps U+058A with its letters, and symbol chains join U+05BE,
// U+1400, U+2E17, U+2E40, U+2E5D, U+10D6E and U+10EAD. WebKit breaks after them
// there too, a documented gap.
const tabBeforeHyphenRe = /\t[-\u2010\u2012\u2013]/
const hyphenCharRe = /[-\u2010\u2012\u2013]/g

// Normal mode collapses a TAB before a hyphen to a space, but WebKit's scan
// reads the source text, where a TAB is UAX #14 BA and not a LB20a context.
// Normalization neither adds nor removes hyphens, so the nth normalized hyphen
// is the nth source hyphen. Text with a TAB always normalizes to a new string.
// Returns normalized offsets.
function getHyphensAfterSourceTab(
  source: string,
  normalized: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode,
): Set<number> | null {
  if (
    !profile.breakHyphenAfterCollapsedTab ||
    whiteSpace !== 'normal' ||
    source === normalized ||
    !tabBeforeHyphenRe.test(source)
  ) return null
  const hyphens = new Set<number>()
  const sourceHyphens = source.matchAll(hyphenCharRe)
  for (const match of normalized.matchAll(hyphenCharRe)) {
    if (source.charCodeAt(sourceHyphens.next().value!.index - 1) === 0x09) hyphens.add(match.index)
  }
  return hyphens
}

function joinTextParts(parts: string[]): string {
  return parts.length === 1 ? parts[0]! : parts.join('')
}

function joinReversedPrefixParts(prefixParts: string[], tail: string): string {
  const parts: string[] = []
  for (let i = prefixParts.length - 1; i >= 0; i--) {
    parts.push(prefixParts[i]!)
  }
  parts.push(tail)
  return joinTextParts(parts)
}

// Intl.Segmenter keeps a full-width comma, stop or semicolon between digits in
// one numeric word (UAX #29 MidNum and MidNumLet). UAX #14 classes them CL or
// NS, which allow a break after them before a digit, as in `00，2025`. Safari
// marks digit strings non-word, so the split doesn't depend on word-likeness.
// Text without any of them skips the per-segment scan.
const numericWordPunctuationCharRe = /[\uFE50\uFE52\uFE54\uFF0C\uFF0E\uFF1B]/

function getNumericWordPunctuationSplits(segment: string): number[] | null {
  let splits: number[] | null = null
  for (let i = 1; i < segment.length - 1; i++) {
    const code = segment.charCodeAt(i)
    if (code !== 0xFE50 && code !== 0xFE52 && code !== 0xFE54 && code !== 0xFF0C && code !== 0xFF0E && code !== 0xFF1B) continue
    if (decimalDigitRe.test(segment[i - 1]!) && decimalDigitRe.test(segment[i + 1]!)) {
      if (splits === null) splits = []
      splits.push(i + 1)
    }
  }
  return splits
}

function splitSegmentByBreakKind(
  segment: string,
  isWordLike: boolean,
  start: number,
  whiteSpace: WhiteSpaceMode,
  breakOnlyAfterNextLine: boolean,
  mayContainNumericWordPunctuation: boolean,
): SegmentationPiece[] {
  const numericSplits = mayContainNumericWordPunctuation ? getNumericWordPunctuationSplits(segment) : null
  if (numericSplits === null) return splitTextByBreakKind(segment, isWordLike, start, whiteSpace, breakOnlyAfterNextLine)
  const pieces: SegmentationPiece[] = []
  let pieceStart = 0
  for (let i = 0; i <= numericSplits.length; i++) {
    const pieceEnd = i < numericSplits.length ? numericSplits[i]! : segment.length
    const split = splitTextByBreakKind(segment.slice(pieceStart, pieceEnd), isWordLike, start + pieceStart, whiteSpace, breakOnlyAfterNextLine)
    for (let j = 0; j < split.length; j++) pieces.push(split[j]!)
    pieceStart = pieceEnd
  }
  return pieces
}

function splitTextByBreakKind(
  segment: string,
  isWordLike: boolean,
  start: number,
  whiteSpace: WhiteSpaceMode,
  breakOnlyAfterNextLine: boolean,
): SegmentationPiece[] {
  if (!breakCharRe.test(segment)) {
    return [{ text: segment, isWordLike, kind: 'text', start }]
  }

  const pieces: SegmentationPiece[] = []
  let currentKind: SegmentBreakKind | null = null
  let currentStart = 0
  let currentWordLike = false
  let offset = 0

  for (const ch of segment) {
    const kind = classifySegmentBreakChar(ch, whiteSpace, breakOnlyAfterNextLine)
    const wordLike = kind === 'text' && isWordLike

    // Each NEL offers its own break after it.
    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike && kind !== 'control') {
      offset += ch.length
      continue
    }

    if (currentKind !== null) {
      pieces.push({
        text: segment.slice(currentStart, offset),
        isWordLike: currentWordLike,
        kind: currentKind,
        start: start + currentStart,
      })
    }

    currentKind = kind
    currentStart = offset
    currentWordLike = wordLike
    offset += ch.length
  }

  if (currentKind !== null) {
    pieces.push({
      text: segment.slice(currentStart),
      isWordLike: currentWordLike,
      kind: currentKind,
      start: start + currentStart,
    })
  }

  return pieces
}

function isTextRunBoundary(kind: SegmentBreakKind): boolean {
  return (
    kind === 'space' ||
    kind === 'preserved-space' ||
    kind === 'zero-width-break' ||
    kind === 'hard-break' ||
    kind === 'control'
  )
}

const urlSchemeSegmentRe = /^[A-Za-z][A-Za-z0-9+.-]*:$/

function isUrlLikeRunStart(segmentation: MergedSegmentation, index: number): boolean {
  const text = segmentation.texts[index]!
  if (text.startsWith('www.')) return true
  return (
    urlSchemeSegmentRe.test(text) &&
    index + 1 < segmentation.len &&
    segmentation.kinds[index + 1] === 'text' &&
    segmentation.texts[index + 1] === '//'
  )
}

function isUrlQueryBoundarySegment(text: string): boolean {
  return text.includes('?') && (text.includes('://') || text.startsWith('www.'))
}

function mergeUrlRuns(segmentation: MergedSegmentation, normalized: string, profile: AnalysisProfile): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  for (let i = 0; i < segmentation.len; i++) {
    const start = segmentation.starts[i]!
    let text = segmentation.texts[i]!
    let wordLike = segmentation.isWordLike[i]!
    const kind = segmentation.kinds[i]!

    if (kind === 'text' && isUrlLikeRunStart(segmentation, i)) {
      const urlParts = [text]
      let j = i + 1
      while (
        j < segmentation.len &&
        !isTextRunBoundary(segmentation.kinds[j]!) &&
        numericAffixBoundary(normalized, segmentation.starts[j]!, profile) !== false
      ) {
        const nextText = segmentation.texts[j]!
        urlParts.push(nextText)
        wordLike = true
        j++
        if (nextText.includes('?')) break
      }
      text = joinTextParts(urlParts)
      i = j - 1
    }
    texts.push(text)
    isWordLike.push(wordLike)
    kinds.push(kind)
    starts.push(start)

    if (!isUrlQueryBoundarySegment(text)) continue

    const nextIndex = i + 1
    if (
      nextIndex >= segmentation.len ||
      isTextRunBoundary(segmentation.kinds[nextIndex]!)
    ) {
      continue
    }

    const queryParts: string[] = []
    const queryStart = segmentation.starts[nextIndex]!
    let j = nextIndex
    while (
      j < segmentation.len &&
      !isTextRunBoundary(segmentation.kinds[j]!) &&
      numericAffixBoundary(normalized, segmentation.starts[j]!, profile) !== false
    ) {
      queryParts.push(segmentation.texts[j]!)
      j++
    }

    if (queryParts.length > 0) {
      texts.push(joinTextParts(queryParts))
      isWordLike.push(true)
      kinds.push('text')
      starts.push(queryStart)
      i = j - 1
    }
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

const numericJoinerChars = new Set([
  ':', '-', '/', '×', ',', '.', '+',
  '\u2013',
  '\u2014',
])

const wordInternalSymbolRe = /[\p{P}\p{S}\p{Co}]/u
const emojiPresentationRe = /\p{Emoji_Presentation}/u

const noSpaceWordBreakAfterChars = new Set([
  '?',
  '\u058A',
  '-',
  '\u2010',
  '\u2012',
  '\u2013',
  '\u2014',
  '\u2026',
  '\u203C',
  '\u203D',
  '\u2049',
])

function isAsciiWordInternalSymbolCode(code: number): boolean {
  return (
    (code >= 0x21 && code <= 0x2F && code !== 0x2D) ||
    (code >= 0x3A && code <= 0x40 && code !== 0x3F) ||
    (code >= 0x5B && code <= 0x60) ||
    (code >= 0x7B && code <= 0x7E)
  )
}

function isNoSpaceWordInternalSymbol(ch: string): boolean {
  const code = ch.charCodeAt(0)
  if (code < 0x80) return isAsciiWordInternalSymbolCode(code)

  return (
    !noSpaceWordBreakAfterChars.has(ch) &&
    !emojiPresentationRe.test(ch) &&
    wordInternalSymbolRe.test(ch)
  )
}

function isNoSpaceWordInternalSymbolSegment(text: string): boolean {
  let sawSymbol = false
  for (const ch of text) {
    if (combiningMarkRe.test(ch)) continue
    if (!isNoSpaceWordInternalSymbol(ch)) return false
    sawSymbol = true
  }
  return sawSymbol
}

function endsWithNoSpaceWordJoiner(text: string): boolean {
  for (let end = text.length; end > 0;) {
    const start = previousCodePointStart(text, end)
    const ch = text.slice(start, end)
    if (combiningMarkRe.test(ch)) {
      end = start
      continue
    }
    return isNoSpaceWordInternalSymbol(ch) || isLineBreakNumericAffix(ch)
  }
  return false
}

// Letters, numbers and symbols above U+00FF whose UAX #14 class forbids a break
// before them: BA, CL, CM, EX, IN, IS, NS or QU, such as the iteration marks
// U+3005 and U+309D.
const noBreakBeforeLetterClasses =
  (1 << LineBreakClass.BA) | (1 << LineBreakClass.CL) | (1 << LineBreakClass.CM) | (1 << LineBreakClass.EX) |
  (1 << LineBreakClass.IN) | (1 << LineBreakClass.IS) | (1 << LineBreakClass.NS) | (1 << LineBreakClass.QU)

// Up to U+00FF, the UAX #14 classes that forbid a break before them are CM
// (controls), BA, CL, CP, EX, GL, HY, IS, QU and SY, besides spaces and line
// breaks.
const latin1NoBreakBeforeClasses =
  (1 << LineBreakClass.CM) | (1 << LineBreakClass.BA) | (1 << LineBreakClass.CL) | (1 << LineBreakClass.CP) |
  (1 << LineBreakClass.EX) | (1 << LineBreakClass.GL) | (1 << LineBreakClass.HY) | (1 << LineBreakClass.IS) |
  (1 << LineBreakClass.QU) | (1 << LineBreakClass.SY) | (1 << LineBreakClass.SP) | (1 << LineBreakClass.BK)

function isLatin1NoBreakBeforeCode(code: number): boolean {
  return ((1 << getLineBreakClass(code)) & latin1NoBreakBeforeClasses) !== 0
}

const exclamationFollowerAtRe = /[\p{L}\p{N}\p{S}\p{Ps}]/uy
const combiningMarkAtRe = /\p{M}/uy

// UAX #14 breaks after EX unless the following class forbids a break before it
// (LB31). Gecko's nsLineBreaker ASCII shortcut skips only words of AL/IS/NU/QU
// characters, so any word containing EX reaches ICU4X. Chromium and WebKit
// first look up code-unit pairs up to U+00FF in a table that follows ICU,
// except for printable ASCII: there '?' also breaks before '-' and '|', while
// '!' breaks only before '(', '<', '[' and '{'. Above U+00FF, letters, numbers,
// symbols and opening punctuation break unless their line-break class forbids
// it, numeric affixes break, and other punctuation is not classified. CJ breaks
// only under ICU's normal rules, which Chromium uses for line-break: auto, and
// WebKit on Japanese and Korean pages.
// Every merge that would join across the boundary asks here.
// The last-code-unit screen keeps ordinary word boundaries allocation-free.
function breaksAfterExclamation(
  source: string,
  boundary: number,
  profile: AnalysisProfile,
  wordBreak: WordBreakMode,
): boolean {
  if (boundary <= 0 || boundary >= source.length) return false
  const lastCode = source.charCodeAt(boundary - 1)
  if (lastCode < 0x0300 && lastCode !== 0x21 && lastCode !== 0x3F) return false
  // WebKit's keep-all breaks only at spaces, even after punctuation.
  if (wordBreak === 'keep-all' && profile.keepAllPairModel === 'webkit-spaces') return false
  for (let end = boundary; end > 0;) {
    const start = previousCodePointStart(source, end)
    const codePoint = source.codePointAt(start)!
    if (getLineBreakClass(codePoint) === LineBreakClass.EX) {
      const next = source.codePointAt(boundary)!
      if (next > 0xFF) {
        exclamationFollowerAtRe.lastIndex = boundary
        if (!exclamationFollowerAtRe.test(source)) return isLineBreakNumericAffixCode(next)
        const nextClass = getLineBreakClass(next)
        // Strict rules treat CJ as NS; ICU's normal rules treat it as ID.
        if (nextClass === LineBreakClass.CJ) return profile.breakBeforeConditionalJapaneseStarter
        return ((1 << nextClass) & noBreakBeforeLetterClasses) === 0
      }
      // The pair table sees the code unit before the boundary, not a mark's base.
      if (!profile.geckoAsciiLineBreaks && end === boundary && codePoint <= 0xFF && next < 0x80) {
        return codePoint === 0x3F
          ? next === 0x2D || next === 0x7C || !isLatin1NoBreakBeforeCode(next)
          : next === 0x28 || next === 0x3C || next === 0x5B || next === 0x7B
      }
      return !isLatin1NoBreakBeforeCode(next)
    }
    combiningMarkAtRe.lastIndex = start
    if (codePoint < 0x0300 || !combiningMarkAtRe.test(source)) return false
    end = start
  }
  return false
}

const hyphenWithMarksRe = /^.\p{M}+$/u
const letterAtRe = /\p{L}/uy

// A hyphen (UAX #14 HY or HH) alone or followed only by combining marks. The
// astral HH dashes are two code units.
function isHyphenPiece(text: string): boolean {
  const code = text.codePointAt(0)!
  const lineBreakClass = getLineBreakClass(code)
  return (lineBreakClass === LineBreakClass.HY || lineBreakClass === LineBreakClass.HH) &&
    (text.length === (code > 0xFFFF ? 2 : 1) || hyphenWithMarksRe.test(text))
}

// UAX #14 LB20a keeps a hyphen (HY or HH) after a space, ZWSP, hard break or
// the text start with a following AL or HL letter. Chromium and WebKit reach
// ICU for every HH dash, and for U+002D before a code point above U+00FF. Below
// that their pair tables break U+002D before most letters, but Chromium defers
// every non-ASCII follower to ICU, which keeps a Latin-1 letter too, and WebKit
// keeps U+00AA (not modeled). ICU 77 counts only U+2010 as HH and keeps only AL
// letters. ICU 78 adds HL and the other Unicode 17 HH dashes such as U+2012 and
// U+2013, and Chrome and Safari keep each one observed. Normal white space can
// collapse a TAB before the hyphen; WebKit's scan still reads UAX #14 BA there,
// not a space. Firefox's ICU4X 2.1 rules predate LB20a.
function keepsWordInitialHyphen(source: string, hyphenStart: number, letterStart: number, profile: AnalysisProfile): boolean {
  if (profile.wordInitialHyphenLetters === 'none') return false
  const letter = source.codePointAt(letterStart)!
  if (source.charCodeAt(hyphenStart) === 0x2D && letter <= 0xFF) return false
  letterAtRe.lastIndex = letterStart
  if (!letterAtRe.test(source)) return false
  // SA letters are AL here (LB1).
  const letterClass = getLineBreakClass(letter)
  return letterClass === LineBreakClass.AL || letterClass === LineBreakClass.SA ||
    (letterClass === LineBreakClass.HL && profile.wordInitialHyphenLetters === 'alphabetic-and-hebrew')
}

const asciiAlphabeticBoundaryRe = /[A-Za-z#&*<=>@^_`~]/

function isAsciiBoundary(left: string, right: string): boolean {
  return left.charCodeAt(0) < 0x80 && right.charCodeAt(0) < 0x80
}

// The observed Gecko ASCII model owns directional PR/PO seams and ordinary
// opener attachment. Unicode neighbors retain the existing compatibility tier.
function numericAffixBoundary(source: string, boundary: number, profile: AnalysisProfile): boolean | null {
  if (!profile.geckoAsciiLineBreaks || boundary <= 0 || boundary >= source.length) return null
  const left = getLastSignificantCodePoint(source, boundary)
  const right = String.fromCodePoint(source.codePointAt(boundary)!)
  if (left === null || !isAsciiBoundary(left, right)) return null
  const leftAffix = isLineBreakNumericAffix(left)
  const rightAffix = isLineBreakNumericAffix(right)
  if (!leftAffix && !rightAffix) return null
  if (right === ')' || right === ']' || right === '}' || '!,.:;?/'.includes(right)) return true
  if ('([{'.includes(left) || left === '"' || left === "'" || right === '"' || right === "'") return true
  if (right === '|' || right === '-') return true
  if (leftAffix && asciiAlphabeticBoundaryRe.test(right) || asciiAlphabeticBoundaryRe.test(left) && rightAffix) return true
  if (rightAffix && (')]}'.includes(left) || /[0-9]/.test(left))) return true
  if (leftAffix && ('([{'.includes(right) || /[0-9]/.test(right))) return true
  return false
}

// Browser line breakers tailor ASCII opener boundaries beyond Unicode classes.
// Preserve that boundary before symbol-chain compaction can erase it.
function openingPunctuationJoinsPrevious(left: string, right: string, profile: AnalysisProfile, leftEnd = left.length): boolean | null {
  const first = right[0]
  if (first === undefined || !'([{'.includes(first)) return null
  const last = getLastSignificantCodePoint(left, leftEnd)
  if (last === null) return null
  if (profile.geckoAsciiLineBreaks && isAsciiBoundary(last, first)) {
    return asciiAlphabeticBoundaryRe.test(last) || decimalDigitRe.test(last) ||
      '"\'([{'.includes(last) || isLineBreakNumericAffix(last)
  }
  if (last.charCodeAt(0) >= 0x80) {
    // Non-CJK letters and numbers retain alphabetic opener attachment (LB30).
    return !isCJK(last) && /[\p{L}\p{N}]/u.test(last) ? true : null
  }
  return /[A-Za-z0-9]/.test(last) || "$'(/<@[^_`{".includes(last)
}

function canJoinNoSpaceWordBoundary(
  source: string,
  boundary: number,
  leftText: string,
  leftWordLike: boolean,
  rightText: string,
  rightWordLike: boolean,
  profile: AnalysisProfile,
  wordBreak: WordBreakMode,
): boolean {
  // The forward-sticky pass joins a sign to its numeric suffix. Preserve its
  // CJK left edge so final unit construction can place the ordinary boundary.
  if (rightText[0] === '-' && isCJK(leftText)) return true
  // CJK-leading mixed runs retain their own annotation/kinsoku boundaries,
  // even when the last scalar before an opener is an ASCII letter.
  if (isCJK(leftText) || isCJK(rightText)) return false

  const openingJoin = openingPunctuationJoinsPrevious(leftText, rightText, profile)
  if (openingJoin !== null) return openingJoin
  if (breaksAfterExclamation(source, boundary, profile, wordBreak)) return false

  const leftSymbol = !leftWordLike && isNoSpaceWordInternalSymbolSegment(leftText)
  const rightSymbol = !rightWordLike && isNoSpaceWordInternalSymbolSegment(rightText)
  const leftAffix = endsWithLineBreakNumericAffix(leftText)
  const leftEndsJoiner = (leftWordLike || leftAffix) && endsWithNoSpaceWordJoiner(leftText)

  if (!leftSymbol && !rightSymbol && !leftEndsJoiner) return false

  return (leftWordLike || leftSymbol || leftAffix) && (rightWordLike || rightSymbol)
}

function segmentContainsDecimalDigit(text: string): boolean {
  for (const ch of text) {
    if (decimalDigitRe.test(ch)) return true
  }
  return false
}

export function isNumericRunSegment(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) {
    if (decimalDigitRe.test(ch) || numericJoinerChars.has(ch)) continue
    return false
  }
  return true
}

// A numeric run can end in closing punctuation, as in `00:00:00，` (LB25's CL
// or CP suffix, and LB13 for EX). Returns where that suffix starts in the
// segment after the run: 0 when the segment is only closing punctuation, after
// its numeric continuation otherwise, or -1 when it is neither.
function getNumericClosingSuffixStart(text: string): number {
  let start = text.length
  while (start > 0) {
    const lineBreakClass = getLineBreakClass(text.charCodeAt(start - 1))
    if (lineBreakClass !== LineBreakClass.CL && lineBreakClass !== LineBreakClass.CP && lineBreakClass !== LineBreakClass.EX) break
    start--
  }
  if (start === text.length) return -1
  if (start === 0) return 0
  const body = text.slice(0, start)
  return isNumericRunSegment(body) && segmentContainsDecimalDigit(body) ? start : -1
}

function mergeNumericRuns(segmentation: MergedSegmentation, normalized: string, profile: AnalysisProfile): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  function pushNumericRun(text: string, start: number, suffixLength: number): void {
    if (text.includes('-')) {
      const suffix = text.slice(text.length - suffixLength)
      const parts = text.slice(0, text.length - suffixLength).split('-')
      let shouldSplit = parts.length > 1
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        if (!shouldSplit) break
        if (
          part.length === 0 ||
          !segmentContainsDecimalDigit(part) ||
          !isNumericRunSegment(part)
        ) {
          shouldSplit = false
        }
      }

      if (shouldSplit) {
        let offset = 0
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!
          const splitText = i < parts.length - 1 ? `${part}-` : part + suffix
          texts.push(splitText)
          isWordLike.push(true)
          kinds.push('text')
          starts.push(start + offset)
          offset += splitText.length
        }
        return
      }
    }

    texts.push(text)
    isWordLike.push(true)
    kinds.push('text')
    starts.push(start)
  }

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    const kind = segmentation.kinds[i]!

    if (kind === 'text' && isNumericRunSegment(text) && segmentContainsDecimalDigit(text)) {
      const mergedParts = [text]
      let j = i + 1
      while (
        j < segmentation.len &&
        segmentation.kinds[j] === 'text' &&
        isNumericRunSegment(segmentation.texts[j]!) &&
        numericAffixBoundary(normalized, segmentation.starts[j]!, profile) !== false
      ) {
        mergedParts.push(segmentation.texts[j]!)
        j++
      }

      let suffixLength = 0
      if (
        j < segmentation.len &&
        segmentation.kinds[j] === 'text' &&
        numericAffixBoundary(normalized, segmentation.starts[j]!, profile) !== false
      ) {
        const finalText = segmentation.texts[j]!
        const suffixStart = getNumericClosingSuffixStart(finalText)
        if (suffixStart >= 0) {
          mergedParts.push(finalText)
          suffixLength = finalText.length - suffixStart
          j++
        }
      }

      pushNumericRun(joinTextParts(mergedParts), segmentation.starts[i]!, suffixLength)
      i = j - 1
      continue
    }

    texts.push(text)
    isWordLike.push(segmentation.isWordLike[i]!)
    kinds.push(kind)
    starts.push(segmentation.starts[i]!)
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function mergeNoSpaceWordChains(
  segmentation: MergedSegmentation,
  normalized: string,
  profile: AnalysisProfile,
  wordBreak: WordBreakMode,
): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  let i = 0
  while (i < segmentation.len) {
    const text = segmentation.texts[i]!
    const kind = segmentation.kinds[i]!
    const wordLike = segmentation.isWordLike[i]!

    if (kind === 'text') {
      const mergedParts = [text]
      let j = i + 1
      let mergedWordLike = wordLike

      while (
        j < segmentation.len &&
        segmentation.kinds[j] === 'text' &&
        (numericAffixBoundary(normalized, segmentation.starts[j]!, profile) ?? canJoinNoSpaceWordBoundary(
          normalized,
          segmentation.starts[j]!,
          segmentation.texts[j - 1]!,
          segmentation.isWordLike[j - 1]!,
          segmentation.texts[j]!,
          segmentation.isWordLike[j]!,
          profile,
          wordBreak,
        ))
      ) {
        const nextText = segmentation.texts[j]!
        mergedParts.push(nextText)
        mergedWordLike = mergedWordLike || segmentation.isWordLike[j]!
        j++
      }

      if (j > i + 1) {
        texts.push(joinTextParts(mergedParts))
        isWordLike.push(mergedWordLike)
        kinds.push('text')
        starts.push(segmentation.starts[i]!)
        i = j
        continue
      }
    }

    texts.push(text)
    isWordLike.push(wordLike)
    kinds.push(kind)
    starts.push(segmentation.starts[i]!)
    i++
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function mergeGlueConnectedTextRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  let read = 0
  while (read < segmentation.len) {
    const textParts = [segmentation.texts[read]!]
    let wordLike = segmentation.isWordLike[read]!
    let kind = segmentation.kinds[read]!
    let start = segmentation.starts[read]!

    if (kind === 'glue') {
      const glueParts = [textParts[0]!]
      const glueStart = start
      read++
      while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
        glueParts.push(segmentation.texts[read]!)
        read++
      }
      const glueText = joinTextParts(glueParts)

      if (read < segmentation.len && segmentation.kinds[read] === 'text') {
        textParts[0] = glueText
        textParts.push(segmentation.texts[read]!)
        wordLike = segmentation.isWordLike[read]!
        kind = 'text'
        start = glueStart
        read++
      } else {
        texts.push(glueText)
        isWordLike.push(false)
        kinds.push('glue')
        starts.push(glueStart)
        continue
      }
    } else {
      read++
    }

    if (kind === 'text') {
      while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
        const glueParts: string[] = []
        while (read < segmentation.len && segmentation.kinds[read] === 'glue') {
          glueParts.push(segmentation.texts[read]!)
          read++
        }
        const glueText = joinTextParts(glueParts)

        if (read < segmentation.len && segmentation.kinds[read] === 'text') {
          textParts.push(glueText, segmentation.texts[read]!)
          wordLike = wordLike || segmentation.isWordLike[read]!
          read++
          continue
        }

        textParts.push(glueText)
      }
    }

    texts.push(joinTextParts(textParts))
    isWordLike.push(wordLike)
    kinds.push(kind)
    starts.push(start)
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function carryTrailingForwardStickyAcrossCJKBoundary(segmentation: MergedSegmentation): void {
  const { texts, kinds, starts } = segmentation

  for (let i = 0; i < texts.length - 1; i++) {
    if (kinds[i] !== 'text' || kinds[i + 1] !== 'text') continue
    if (!isCJK(texts[i]!) || !isCJK(texts[i + 1]!)) continue

    const split = splitTrailingForwardStickyCluster(texts[i]!)
    if (split === null) continue

    texts[i] = split.head
    texts[i + 1] = split.tail + texts[i + 1]!
    starts[i + 1] = starts[i]! + split.head.length
  }
}

// Whether the code point at `start` joins the SPACE before it into one grapheme
// cluster. No grapheme rule looks back past a SPACE, so these two code points
// decide it (GB9, GB9a) without segmenting the rest of the text. Read the first
// segment instead of calling `containing()`: JavaScriptCore returns the wrong
// segment for an index just before a surrogate pair.
function extendsPrecedingSpace(text: string, start: number): boolean {
  const end = start + (text.codePointAt(start)! > 0xFFFF ? 2 : 1)
  const pair = text.slice(start - 1, end)
  return getSharedGraphemeSegmenter().segment(pair)[Symbol.iterator]().next().value!.segment.length === pair.length
}

function buildMergedSegmentation(
  source: string,
  normalized: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode,
  wordBreak: WordBreakMode,
): MergedSegmentation {
  const markKeepingZeroWidthSpaces = getMarkKeepingZeroWidthSpaces(source, normalized, profile)
  const hyphensAfterSourceTab = getHyphensAfterSourceTab(source, normalized, profile, whiteSpace)
  const wordSegmenter = getSharedWordSegmenter()
  const mayContainNumericWordPunctuation = numericWordPunctuationCharRe.test(normalized)
  let mergedLen = 0
  const mergedTexts: string[] = []
  const mergedWordLike: boolean[] = []
  const mergedKinds: SegmentBreakKind[] = []
  const mergedStarts: number[] = []

  // First-pass merges only extend the immediately adjacent text run. Keep that
  // live tail as a source range, then materialize it once at the next boundary.
  let hasTail = false
  let tailStart = 0
  let tailEnd = 0
  let tailWordLike = false
  let tailKind: SegmentBreakKind = 'text'
  let tailSingleCharRunChar: string | null = null
  let tailContainsCJK = false
  let tailContainsArabicScript = false
  let tailEndsWithClosingQuote = false
  let tailEndsWithMyanmarMedialGlue = false
  let tailHasArabicNoSpacePunctuation = false
  let tailEndsWithZeroWidthJoiner = false
  let tailIsWordInitialHyphen = false

  for (const s of wordSegmenter.segment(normalized)) {
    for (const piece of splitSegmentByBreakKind(s.segment, s.isWordLike ?? false, s.index, whiteSpace, profile.breakOnlyAfterNextLine, mayContainNumericWordPunctuation)) {
      if (
        piece.kind === 'zero-width-break' &&
        piece.text.length === 1 &&
        markKeepingZeroWidthSpaces !== null &&
        markKeepingZeroWidthSpaces.has(piece.start)
      ) {
        // No break before it (LB7) or after it: glue joins the marked word.
        piece.kind = 'glue'
      }
      const isText = piece.kind === 'text'
      const repeatableSingleCharRunChar = getRepeatableSingleCharRunChar(piece.text, piece.isWordLike, piece.kind)
      const pieceContainsCJK = isCJK(piece.text)
      const pieceContainsArabicScript = containsArabicScript(piece.text)
      const pieceLastCodePoint = getLastCodePoint(piece.text)
      const pieceEndsWithClosingQuote = endsWithClosingQuote(piece.text)
      const pieceEndsWithMyanmarMedialGlue = endsWithMyanmarMedialGlue(piece.text)
      const pieceEnd = piece.start + piece.text.length
      const pieceEndsWithZeroWidthJoiner = piece.text.charCodeAt(piece.text.length - 1) === 0x200D
      const boundaryJoin = numericAffixBoundary(normalized, piece.start, profile) ??
        (tailContainsCJK || pieceContainsCJK ? null :
          openingPunctuationJoinsPrevious(normalized, piece.text, profile, piece.start))
      let appendToTail = false

      // First-pass keeps: no-space script-specific joins and punctuation glue
      // that depend on the immediately preceding text run.
      if (isText && hasTail && tailKind === 'text' && tailEndsWithZeroWidthJoiner) {
        // UAX #14 LB8a: no break after ZWJ.
        appendToTail = true
      } else if (
        isText &&
        hasTail &&
        tailKind === 'text' &&
        tailIsWordInitialHyphen &&
        keepsWordInitialHyphen(normalized, tailStart, piece.start, profile)
      ) {
        appendToTail = true
      } else if (
        profile.carryCJKAfterClosingQuote &&
        isText &&
        hasTail &&
        tailKind === 'text' &&
        pieceContainsCJK &&
        tailContainsCJK &&
        tailEndsWithClosingQuote
      ) {
        appendToTail = true
      } else if (
        isText &&
        hasTail &&
        tailKind === 'text' &&
        tailContainsCJK &&
        isCJKLineStartProhibitedSegment(piece.text, profile)
      ) {
        appendToTail = true
      } else if (
        isText &&
        hasTail &&
        tailKind === 'text' &&
        tailEndsWithMyanmarMedialGlue
      ) {
        appendToTail = true
      } else if (
        isText &&
        hasTail &&
        tailKind === 'text' &&
        piece.isWordLike &&
        pieceContainsArabicScript &&
        tailHasArabicNoSpacePunctuation
      ) {
        appendToTail = true
      } else if (
        repeatableSingleCharRunChar !== null &&
        hasTail &&
        tailKind === 'text' &&
        tailSingleCharRunChar === repeatableSingleCharRunChar &&
        boundaryJoin !== false
      ) {
        tailEnd = pieceEnd
        tailIsWordInitialHyphen = false
        continue
      } else if (
        isText &&
        !piece.isWordLike &&
        hasTail &&
        tailKind === 'text' &&
        !tailContainsCJK &&
        (
          isLeftStickyPunctuationSegment(piece.text) ||
          (piece.text === '-' && tailWordLike)
        )
      ) {
        appendToTail = true
      }

      if (isText && hasTail && tailKind === 'text' && boundaryJoin !== null) appendToTail = boundaryJoin
      if (appendToTail && breaksAfterExclamation(normalized, piece.start, profile, wordBreak)) appendToTail = false

      if (appendToTail) {
        tailEnd = pieceEnd
        tailWordLike = tailWordLike || piece.isWordLike
        tailSingleCharRunChar = null
        tailContainsCJK = tailContainsCJK || pieceContainsCJK
        tailContainsArabicScript = tailContainsArabicScript || pieceContainsArabicScript
        tailEndsWithClosingQuote = pieceEndsWithClosingQuote
        tailEndsWithMyanmarMedialGlue = pieceEndsWithMyanmarMedialGlue
        tailHasArabicNoSpacePunctuation = hasArabicNoSpacePunctuation(
          tailContainsArabicScript,
          pieceLastCodePoint,
        )
        tailEndsWithZeroWidthJoiner = pieceEndsWithZeroWidthJoiner
        tailIsWordInitialHyphen = false
      } else {
        // LB20a looks back past the hyphen to a break boundary or the text start.
        tailIsWordInitialHyphen =
          isText &&
          isHyphenPiece(piece.text) &&
          (!hasTail || isTextRunBoundary(tailKind)) &&
          (hyphensAfterSourceTab === null || !hyphensAfterSourceTab.has(piece.start))
        // A ZWJ run after a space belongs to that space's grapheme cluster.
        // Browsers break before it (LB9 skips SP) and keep the next character
        // (LB8a), but that line start splits the cluster, so these boundaries
        // stay as they were.
        const joinerExtendsSpace =
          pieceEndsWithZeroWidthJoiner &&
          hasTail &&
          (tailKind === 'space' || tailKind === 'preserved-space') &&
          extendsPrecedingSpace(normalized, piece.start)
        if (hasTail) {
          mergedTexts[mergedLen] = normalized.slice(tailStart, tailEnd)
          mergedWordLike[mergedLen] = tailWordLike
          mergedKinds[mergedLen] = tailKind
          mergedStarts[mergedLen] = tailStart
          mergedLen++
        }

        hasTail = true
        tailStart = piece.start
        tailEnd = pieceEnd
        tailWordLike = piece.isWordLike
        tailKind = piece.kind
        tailSingleCharRunChar = repeatableSingleCharRunChar
        tailContainsCJK = pieceContainsCJK
        tailContainsArabicScript = pieceContainsArabicScript
        tailEndsWithClosingQuote = pieceEndsWithClosingQuote
        tailEndsWithMyanmarMedialGlue = pieceEndsWithMyanmarMedialGlue
        tailHasArabicNoSpacePunctuation = hasArabicNoSpacePunctuation(
          pieceContainsArabicScript,
          pieceLastCodePoint,
        )
        tailEndsWithZeroWidthJoiner = pieceEndsWithZeroWidthJoiner && !joinerExtendsSpace
      }
    }
  }

  if (hasTail) {
    mergedTexts[mergedLen] = normalized.slice(tailStart, tailEnd)
    mergedWordLike[mergedLen] = tailWordLike
    mergedKinds[mergedLen] = tailKind
    mergedStarts[mergedLen] = tailStart
    mergedLen++
  }

  // Later passes operate on the merged text stream itself: contextual escaped
  // quote glue, forward-sticky carry, compaction, then the broader URL/numeric
  // and Arabic-leading-mark fixes.
  for (let i = 1; i < mergedLen; i++) {
    if (
      mergedKinds[i] === 'text' &&
      !mergedWordLike[i]! &&
      isPunctuationGlueCluster(mergedTexts[i]!) &&
      mergedKinds[i - 1] === 'text' &&
      !isCJK(mergedTexts[i - 1]!) &&
      (numericAffixBoundary(normalized, mergedStarts[i]!, profile) ??
        openingPunctuationJoinsPrevious(normalized, mergedTexts[i]!, profile, mergedStarts[i]!)) !== false &&
      !breaksAfterExclamation(normalized, mergedStarts[i]!, profile, wordBreak)
    ) {
      mergedTexts[i - 1] += mergedTexts[i]!
      mergedWordLike[i - 1] = mergedWordLike[i - 1]! || mergedWordLike[i]!
      mergedTexts[i] = ''
    }
  }

  let nextLiveIndex = -1
  let forwardStickyPrefixParts: string[] | null = null

  for (let i = mergedLen - 1; i >= 0; i--) {
    const text = mergedTexts[i]!
    if (text.length === 0) continue
    const nextText = forwardStickyPrefixParts?.at(-1) ?? (nextLiveIndex >= 0 ? mergedTexts[nextLiveIndex]! : null)

    if (
      mergedKinds[i] === 'text' &&
      !mergedWordLike[i]! &&
      nextText !== null &&
      mergedKinds[nextLiveIndex] === 'text' &&
      (
        (numericAffixBoundary(normalized, mergedStarts[i]! + text.length, profile) ??
          // A cluster with no text before it must not erase the break
          // browsers keep after it, such as '?' before a word.
          (isForwardStickyClusterSegment(text) &&
            !breaksAfterExclamation(normalized, mergedStarts[i]! + text.length, profile, wordBreak) &&
            openingPunctuationJoinsPrevious(text, nextText, profile) !== false)) ||
        (text === '-' && startsWithDecimalDigit(nextText))
      )
    ) {
      if (forwardStickyPrefixParts === null) forwardStickyPrefixParts = []
      forwardStickyPrefixParts.push(text)
      mergedStarts[nextLiveIndex] = mergedStarts[i]!
      mergedTexts[i] = ''
      continue
    }

    if (forwardStickyPrefixParts !== null) {
      mergedTexts[nextLiveIndex] = joinReversedPrefixParts(
        forwardStickyPrefixParts,
        mergedTexts[nextLiveIndex]!,
      )
      forwardStickyPrefixParts = null
    }
    nextLiveIndex = i
  }

  if (forwardStickyPrefixParts !== null) {
    mergedTexts[nextLiveIndex] = joinReversedPrefixParts(
      forwardStickyPrefixParts,
      mergedTexts[nextLiveIndex]!,
    )
  }

  let compactLen = 0
  for (let read = 0; read < mergedLen; read++) {
    const text = mergedTexts[read]!
    if (text.length === 0) continue
    if (compactLen !== read) {
      mergedTexts[compactLen] = text
      mergedWordLike[compactLen] = mergedWordLike[read]!
      mergedKinds[compactLen] = mergedKinds[read]!
      mergedStarts[compactLen] = mergedStarts[read]!
    }
    compactLen++
  }

  mergedTexts.length = compactLen
  mergedWordLike.length = compactLen
  mergedKinds.length = compactLen
  mergedStarts.length = compactLen

  const compacted = mergeGlueConnectedTextRuns({
    len: compactLen,
    texts: mergedTexts,
    isWordLike: mergedWordLike,
    kinds: mergedKinds,
    starts: mergedStarts,
  })
  const mergedRuns = mergeNoSpaceWordChains(
    mergeNumericRuns(mergeUrlRuns(compacted, normalized, profile), normalized, profile),
    normalized,
    profile,
    wordBreak,
  )
  carryTrailingForwardStickyAcrossCJKBoundary(mergedRuns)

  for (let i = 0; i < mergedRuns.len - 1; i++) {
    const split = splitLeadingSpaceAndMarks(mergedRuns.texts[i]!)
    if (split === null) continue
    if (
      (mergedRuns.kinds[i] !== 'space' && mergedRuns.kinds[i] !== 'preserved-space') ||
      mergedRuns.kinds[i + 1] !== 'text' ||
      !containsArabicScript(mergedRuns.texts[i + 1]!)
    ) {
      continue
    }

    mergedRuns.texts[i] = split.space
    mergedRuns.isWordLike[i] = false
    mergedRuns.kinds[i] = mergedRuns.kinds[i] === 'preserved-space' ? 'preserved-space' : 'space'
    mergedRuns.texts[i + 1] = split.marks + mergedRuns.texts[i + 1]!
    mergedRuns.starts[i + 1] = mergedRuns.starts[i]! + split.space.length
  }

  return mergedRuns
}

function mergeKeepAllTextSegments(
  normalized: string,
  segmentation: MergedSegmentation,
  profile: AnalysisProfile,
): MergedSegmentation {
  if (segmentation.len <= 1) return segmentation

  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  let groupStart = -1
  let groupContainsCJK = false
  let groupWordLike = false
  // Where the current keep-all group splits into runs.
  let splits: number[] | null = null

  function pushOriginalText(index: number): void {
    texts.push(segmentation.texts[index]!)
    isWordLike.push(segmentation.isWordLike[index]!)
    kinds.push(segmentation.kinds[index]!)
    starts.push(segmentation.starts[index]!)
  }

  // Under keep-all, a word-like segment takes emergency grapheme breaks. A
  // keep-all group takes them when any of its pieces is a word, and every run it
  // splits into keeps them, as U+300C U+2605 does between ideographs.
  function pushKeepAllRun(start: number, end: number): void {
    const sourceStart = segmentation.starts[start]!
    const sourceEnd = end < segmentation.len ? segmentation.starts[end]! : normalized.length
    texts.push(start + 1 === end ? segmentation.texts[start]! : normalized.slice(sourceStart, sourceEnd))
    isWordLike.push(groupWordLike)
    kinds.push('text')
    starts.push(sourceStart)
  }

  // A group with CJK text becomes keep-all runs. Every such run stays a keep-all
  // run even when its own pieces hold no CJK text, such as U+2768 U+1F60A U+2769
  // between ideographs.
  function flushGroup(end: number): void {
    if (groupStart < 0) return

    if (groupContainsCJK) {
      let start = groupStart
      for (let k = 0; splits !== null && k < splits.length; k++) {
        pushKeepAllRun(start, splits[k]!)
        start = splits[k]!
      }
      pushKeepAllRun(start, end)
    } else {
      for (let i = groupStart; i < end; i++) pushOriginalText(i)
    }

    groupStart = -1
    groupContainsCJK = false
    groupWordLike = false
    splits = null
  }

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    const kind = segmentation.kinds[i]!

    // No ordinary break precedes NEL, so it continues the run before it, glue
    // included. A CJK run merges across NEL as it did across NEL text; other
    // runs keep their pieces, and NEL stays a control segment there.
    if (kind === 'text' || kind === 'control' || (kind === 'glue' && segmentation.kinds[i + 1] === 'control')) {
      if (groupStart >= 0 && kind !== 'control') {
        const start = segmentation.starts[i]!
        const runEnd = getKeepAllRunEnd(normalized, start, segmentation.texts[i - 1]!, profile)
        if (runEnd === 'end' || numericAffixBoundary(normalized, start, profile) === false) {
          flushGroup(i)
        } else if (runEnd === 'split') {
          (splits ??= []).push(i)
        }
      }
      if (groupStart < 0) groupStart = i
      groupContainsCJK = groupContainsCJK || isCJK(text)
      groupWordLike = groupWordLike || segmentation.isWordLike[i]!
      continue
    }

    flushGroup(i)
    texts.push(text)
    isWordLike.push(segmentation.isWordLike[i]!)
    kinds.push(kind)
    starts.push(segmentation.starts[i]!)
  }

  flushGroup(segmentation.len)

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

// A numeric sign stays with its number. Latin letter/number hyphens remain
// preferred boundaries; CJK-adjacent signs also stay attached on their left.
function isNumericHyphen(text: string, index: number): boolean {
  const next = text.charCodeAt(index + 1)
  if (next < 0x80) {
    if (next < 0x30 || next > 0x39) return false
  } else {
    const codePoint = text.codePointAt(index + 1)
    if (codePoint === undefined || !decimalDigitRe.test(String.fromCodePoint(codePoint))) return false
  }
  for (let end = index; end > 0;) {
    const start = previousCodePointStart(text, end)
    const previous = text.slice(start, end)
    if (!combiningMarkRe.test(previous)) return isCJK(previous) || !/[\p{L}\p{N}]/u.test(previous)
    end = start
  }
  return true
}

type TextBreakUnit = {
  text: string
  start: number
  overflow: 'none' | 'word-like' | 'grapheme'
}

function buildBaseCjkUnits(
  segText: string,
  profile: AnalysisProfile,
  wordBreak: WordBreakMode,
): TextBreakUnit[] {
  const units: TextBreakUnit[] = []
  let unitStart = 0
  let unitEnd = 0
  let unitContainsCJK = false
  let unitEndsWithClosingQuote = false
  let unitIsSingleKinsokuEnd = false
  let unitHasHyphen = false
  let unitHasNumericHyphen = false

  function pushUnit(): void {
    if (unitEnd === unitStart) return
    units.push({
      text: segText.slice(unitStart, unitEnd),
      start: unitStart,
      overflow: unitContainsCJK ? (unitHasHyphen ? 'grapheme' : 'none') : 'word-like',
    })
    unitStart = unitEnd
    unitContainsCJK = false
    unitEndsWithClosingQuote = false
    unitIsSingleKinsokuEnd = false
    unitHasHyphen = false
    unitHasNumericHyphen = false
  }

  function startUnit(grapheme: string, start: number, graphemeContainsCJK: boolean): void {
    unitStart = start
    unitEnd = start + grapheme.length
    unitContainsCJK = graphemeContainsCJK
    unitHasHyphen = grapheme === '-'
    unitEndsWithClosingQuote = endsWithClosingQuote(grapheme)
    unitIsSingleKinsokuEnd = kinsokuEnd.has(grapheme)
  }

  function appendToUnit(grapheme: string, graphemeContainsCJK: boolean): void {
    unitEnd += grapheme.length
    unitContainsCJK = unitContainsCJK || graphemeContainsCJK
    unitHasHyphen = unitHasHyphen || grapheme === '-'
    const graphemeEndsWithClosingQuote = endsWithClosingQuote(grapheme)
    if (grapheme.length === 1 && leftStickyPunctuation.has(grapheme)) {
      unitEndsWithClosingQuote = unitEndsWithClosingQuote || graphemeEndsWithClosingQuote
    } else {
      unitEndsWithClosingQuote = graphemeEndsWithClosingQuote
    }
    unitIsSingleKinsokuEnd = false
  }

  for (const gs of getSharedGraphemeSegmenter().segment(segText)) {
    const grapheme = gs.segment
    const graphemeContainsCJK = isCJK(grapheme)

    if (unitEnd === unitStart) {
      startUnit(grapheme, gs.index, graphemeContainsCJK)
      continue
    }

    const attachHyphen = grapheme === '-' && unitContainsCJK
    if (attachHyphen && isNumericHyphen(segText, gs.index)) unitHasNumericHyphen = true

    if (
      unitIsSingleKinsokuEnd ||
      prohibitsCJKLineStart(grapheme, profile) ||
      leftStickyPunctuation.has(grapheme) ||
      attachHyphen ||
      (unitHasNumericHyphen && !graphemeContainsCJK) ||
      (profile.carryCJKAfterClosingQuote &&
        graphemeContainsCJK &&
        unitEndsWithClosingQuote &&
        !(wordBreak === 'keep-all' && breaksAfterEastAsianClosingQuote(segText, gs.index, profile)))
    ) {
      appendToUnit(grapheme, graphemeContainsCJK)
      continue
    }

    if (!unitContainsCJK && !graphemeContainsCJK) {
      appendToUnit(grapheme, graphemeContainsCJK)
      continue
    }

    pushUnit()
    startUnit(grapheme, gs.index, graphemeContainsCJK)
  }

  pushUnit()
  return units
}

function mergeKeepAllTextUnits(
  segText: string,
  units: TextBreakUnit[],
  profile: AnalysisProfile,
): TextBreakUnit[] {
  if (units.length <= 1) return units

  const merged: TextBreakUnit[] = []
  let groupStart = -1
  let groupContainsCJK = false
  let splits: number[] | null = null

  function pushRun(start: number, end: number): void {
    if (start + 1 === end) {
      merged.push(units[start]!)
      return
    }
    const sourceStart = units[start]!.start
    const sourceEnd = end < units.length ? units[end]!.start : segText.length

    merged.push({
      text: segText.slice(sourceStart, sourceEnd),
      start: sourceStart,
      overflow: 'word-like',
    })
  }

  function flushGroup(end: number): void {
    if (groupStart < 0) return

    if (groupContainsCJK) {
      let start = groupStart
      for (let k = 0; splits !== null && k < splits.length; k++) {
        pushRun(start, splits[k]!)
        start = splits[k]!
      }
      pushRun(start, end)
    } else {
      for (let i = groupStart; i < end; i++) merged.push(units[i]!)
    }

    groupStart = -1
    groupContainsCJK = false
    splits = null
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    if (groupStart >= 0) {
      const runEnd = getKeepAllRunEnd(segText, unit.start, units[i - 1]!.text, profile)
      if (runEnd === 'end' || numericAffixBoundary(segText, unit.start, profile) === false) {
        flushGroup(i)
      } else if (runEnd === 'split') {
        (splits ??= []).push(i)
      }
    }
    if (groupStart < 0) groupStart = i
    groupContainsCJK = groupContainsCJK || isCJK(unit.text)
  }

  flushGroup(units.length)
  return merged
}

// Text of plain keep-all letters is one keep-all run, and each of its code units
// is a grapheme, so it needs no grapheme segmentation.
function isPlainKeepAllLetterText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isPlainKeepAllLetterCode(text.charCodeAt(i))) return false
  }
  return true
}

// Ordinary CJK boundaries and emergency overflow permission are separate facts.
// Keep these decisions in preprocessing; measurement only observes their units.
export function getCjkTextUnits(text: string, profile: AnalysisProfile, wordBreak: WordBreakMode): TextBreakUnit[] {
  if (wordBreak === 'keep-all' && isPlainKeepAllLetterText(text)) return [{ text, start: 0, overflow: 'word-like' }]
  const units = buildBaseCjkUnits(text, profile, wordBreak)
  return wordBreak === 'keep-all'
    ? mergeKeepAllTextUnits(text, units, profile)
    : units
}

function isPreferredBreakGrapheme(grapheme: string): boolean {
  return (
    grapheme === '-' ||
    grapheme === '\u058A' ||
    grapheme === '\u2010' ||
    grapheme === '\u2012' ||
    grapheme === '\u2013' ||
    grapheme === '\u2014'
  )
}

// Intl word-likeness is not overflow permission: independent punctuation and
// symbol graphemes can also break. Emoji retain their separate ordinary
// boundary policy, like no-space compaction above. Control-bearing fragments
// and standalone extenders also retain their existing source-shaping policy.
export function isIndependentSymbolRun(text: string): boolean {
  if (text.length === 0 || /\p{Cf}/u.test(text)) return false
  // The first grapheme starts with the first code point, which can refuse the
  // run before any segmentation.
  const first = String.fromCodePoint(text.codePointAt(0)!)
  if (!/[\p{P}\p{S}]/u.test(first) || emojiPresentationRe.test(first) || /\p{Emoji_Modifier}/u.test(first)) return false
  for (const { segment } of getSharedGraphemeSegmenter().segment(text)) {
    const base = String.fromCodePoint(segment.codePointAt(0)!)
    if (!/[\p{P}\p{S}]/u.test(base) || emojiPresentationRe.test(base) || segment.includes('\uFE0F') || /\p{Emoji_Modifier}/u.test(base)) return false
  }
  return true
}

export function getBreakablePreferredBreaks(text: string, profile: AnalysisProfile): number[] | null {
  if (!/[-\u058A\u2010\u2012\u2013\u2014]/u.test(text)) return null

  const breaks: number[] = []
  let graphemeIndex = 0
  for (const gs of getSharedGraphemeSegmenter().segment(text)) {
    graphemeIndex++
    const numericSign = gs.segment === '-' && isNumericHyphen(text, gs.index)
    // A segment that starts with a hyphen kept with its letter (LB20a) offers
    // no break after it, so an overflowing word fills graphemes there.
    const wordInitial = gs.index === 0 && isHyphenPiece(gs.segment) && keepsWordInitialHyphen(text, 0, gs.segment.length, profile)
    if (isPreferredBreakGrapheme(gs.segment) && !numericSign && !wordInitial) breaks.push(graphemeIndex)
  }

  return breaks.length === 0 ? null : breaks
}

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
  wordBreak: WordBreakMode = 'normal',
): TextAnalysis {
  const normalized = whiteSpace === 'pre-wrap'
    ? normalizeWhitespacePreWrap(text)
    : normalizeWhitespaceNormal(text, profile)
  if (normalized.length === 0) {
    return {
      source: text,
      normalized,
      len: 0,
      texts: [],
      isWordLike: [],
      kinds: [],
      starts: [],
    }
  }
  const mergedSegmentation = buildMergedSegmentation(text, normalized, profile, whiteSpace, wordBreak)
  const segmentation = wordBreak === 'keep-all'
    ? mergeKeepAllTextSegments(normalized, mergedSegmentation, profile)
    : mergedSegmentation
  return {
    source: text,
    normalized,
    ...segmentation,
  }
}
