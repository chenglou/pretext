// Break opportunities as Firefox finds them: a port of how Gecko transforms a text node's
// white space, sets up its text run and breaks its words with nsLineBreaker over ICU4X's
// line iterator, with Firefox's baked line data and the Unicode properties Gecko reads,
// which scripts/generate-engine-break-data.ts writes to src/generated/engine-break-data.ts.
//
// Sources, cited as file:line:
// - Gecko in mozilla-firefox at FIREFOX_155_0_1_RELEASE (fb95137a). Firefox 156.0 ships the
//   same line and Bidi_Class data.
// - icu_segmenter 2.1.2 src/line.rs, byte-identical to Firefox's third_party/rust copy, and
//   icu_collections 2.1.1 src/codepointtrie/cptrie.rs.
//
// Deliberate differences:
// - Grapheme clusters come from Intl.Segmenter instead of icu_segmenter's
//   GraphemeClusterSegmenter, and Unicode properties from RegExp \p{...} and generated tables.
// - Inside runs of Thai, Lao, Khmer and Myanmar letters, Intl.Segmenter word boundaries stand
//   in for ICU4X's LSTM models (line.rs:445-451, complex/mod.rs:135-156). Firefox's own
//   Intl.Segmenter answers as those models there once breaks inside grapheme clusters are
//   dropped, which setPotentialLineBreaks does.
// - The paragraph is left-to-right, since Pretext takes no direction, and word-break is
//   normal or keep-all under Strict line breaking, which line-break: auto selects
//   (intl/lwbrk/LineBreaker.cpp:26-31).

import {
  geckoBidiPairs,
  geckoEastAsianWidthRanges,
  geckoLineBreakStatesBase64,
  geckoLineEotProperty,
  geckoLineLastCodepointProperty,
  geckoLinePropertyCount,
  geckoLineTrieDataBase64,
  geckoLineTrieHighStart,
  geckoLineTrieIndexBase64,
  geckoScriptNames,
} from './generated/engine-break-data.js'
import { getParagraphLevels } from './gecko-bidi-levels.js'
import { decodeBase64 } from './line-breaks.js'

const CH_SHY = 0x00ad

const isSurrogatePair = (a: number, b: number) => (a & 0xfc00) === 0xd800 && (b & 0xfc00) === 0xdc00
const combine = (a: number, b: number) => 0x10000 + ((a - 0xd800) << 10) + (b - 0xdc00)

// --- Unicode properties, each filled on first use ---

function codePointFlag(pattern: RegExp): (cp: number) => boolean {
  let bmp: Int8Array | null = null
  const astral = new Map<number, boolean>()
  return (cp: number) => {
    if (cp < 0x10000) {
      bmp ??= new Int8Array(0x10000).fill(-1)
      let value = bmp[cp]!
      if (value < 0) bmp[cp] = value = pattern.test(String.fromCharCode(cp)) ? 1 : 0
      return value === 1
    }
    let result = astral.get(cp)
    if (result === undefined) astral.set(cp, result = pattern.test(String.fromCodePoint(cp)))
    return result
  }
}

const isMark = codePointFlag(/^\p{M}$/u)
const isPunctuation = codePointFlag(/^\p{P}$/u)
const isOpenPunctuation = codePointFlag(/^\p{Ps}$/u)
const isClosePunctuation = codePointFlag(/^\p{Pe}$/u)
const isDefaultIgnorable = codePointFlag(/^\p{Default_Ignorable_Code_Point}$/u)
const isEmoji = codePointFlag(/^\p{Emoji}$/u)
const isBidiMirrored = codePointFlag(/^\p{Bidi_Mirrored}$/u)
const isHangul = codePointFlag(/^\p{sc=Hang}$/u)

let eawStarts: number[] | null = null
let eawEnds: number[] = []
let eawValues: number[] = []

// East_Asian_Width H (2), F (3) or W (5), and 0 for any other value.
function getEastAsianWidth(cp: number): number {
  if (eawStarts === null) {
    eawStarts = []
    let previousEnd = -1
    for (let i = 0; i < geckoEastAsianWidthRanges.length; i += 3) {
      const start = previousEnd + 1 + geckoEastAsianWidthRanges[i]!
      previousEnd = start + geckoEastAsianWidthRanges[i + 1]!
      eawStarts.push(start)
      eawEnds.push(previousEnd)
      eawValues.push(geckoEastAsianWidthRanges[i + 2]!)
    }
  }
  let lo = 0
  let hi = eawStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < eawStarts[mid]!) hi = mid - 1
    else if (cp > eawEnds[mid]!) lo = mid + 1
    else return eawValues[mid]!
  }
  return 0
}

// u_charMirror of an Open_Punctuation code point at or above U+0F3A, or the code point when it
// has none. Those with a mirror are exactly the opening brackets of unicode-bidi's table, with
// the mirror as the closing bracket, which the generator checks.
function getOpenPunctuationMirror(cp: number): number {
  for (let k = 0; k < geckoBidiPairs.length; k += 3) if (geckoBidiPairs[k] === cp) return geckoBidiPairs[k + 1]!
  return cp
}

// Script short names; a code point's script is its index here.
let scriptNames: string[] | null = null
let scriptRe: RegExp
let scriptOfGroup: number[]
let scriptCache: Int16Array
const astralScriptCache = new Map<number, number>()
const extensionRes: (RegExp | null)[] = []
const extensionCache = new Map<number, boolean>()
let SCRIPT_COMMON: number
let SCRIPT_INHERITED: number
let SCRIPT_UNKNOWN: number
let SCRIPT_LATIN: number
let SCRIPT_HIRAGANA: number
let SCRIPT_KATAKANA: number

function initScripts(): void {
  if (scriptNames !== null) return
  const names = scriptNames = geckoScriptNames.split(' ')
  // A name this RegExp engine rejects can't match, so its code points read as Unknown.
  const alternatives: string[] = []
  scriptOfGroup = []
  for (let i = 0; i < names.length; i++) {
    try {
      new RegExp(`\\p{sc=${names[i]}}`, 'u')
    } catch {
      continue
    }
    alternatives.push(`(\\p{sc=${names[i]}})`)
    scriptOfGroup.push(i)
  }
  scriptRe = new RegExp(`^(?:${alternatives.join('|')})$`, 'u')
  scriptCache = new Int16Array(0x10000).fill(-1)
  SCRIPT_COMMON = names.indexOf('Zyyy')
  SCRIPT_INHERITED = names.indexOf('Zinh')
  SCRIPT_UNKNOWN = names.indexOf('Zzzz')
  SCRIPT_LATIN = names.indexOf('Latn')
  SCRIPT_HIRAGANA = names.indexOf('Hira')
  SCRIPT_KATAKANA = names.indexOf('Kana')
}

// uscript_getScript.
function getScript(cp: number): number {
  let script = cp < 0x10000 ? scriptCache[cp]! : astralScriptCache.get(cp) ?? -1
  if (script >= 0) return script
  script = SCRIPT_UNKNOWN
  const match = scriptRe.exec(String.fromCodePoint(cp))
  if (match !== null) {
    for (let g = 1; g < match.length; g++) if (match[g] !== undefined) { script = scriptOfGroup[g - 1]!; break }
  }
  if (cp < 0x10000) scriptCache[cp] = script
  else astralScriptCache.set(cp, script)
  return script
}

// uscript_hasScript: `script` is in the code point's Script_Extensions.
function hasScript(cp: number, script: number): boolean {
  const key = cp * 256 + script
  let result = extensionCache.get(key)
  if (result !== undefined) return result
  let re = extensionRes[script]
  if (re === undefined) {
    try { re = new RegExp(`^\\p{scx=${scriptNames![script]}}$`, 'u') } catch { re = null }
    extensionRes[script] = re
  }
  extensionCache.set(key, result = re !== null && re.test(String.fromCodePoint(cp)))
  return result
}

// --- Character classes ---

// nsUnicodeProperties.h:202-207, nsUnicodeProperties.cpp:130-138
function isClusterExtender(cp: number): boolean {
  return cp >= 0x0300 && (isMark(cp) || cp === 0x200c || cp === 0x200d || (cp >= 0xff9e && cp <= 0xff9f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f))
}

// nsUnicodeProperties.h:211-214, nsUnicodeProperties.cpp:140-147
function isClusterExtenderExcludingJoiners(cp: number): boolean {
  return cp >= 0x0300 && (isMark(cp) || (cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f))
}

// nsBidiUtils.h:84-90
function isBidiControl(cp: number): boolean {
  return ((cp & 0xff00) === 0x2000 && ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || (cp & ~1) === 0x200e)) ||
    cp === 0x061c
}

// UnicodeProperties.h:205-218
function isEastAsianWidthFHWExcludingEmoji(cp: number): boolean {
  const width = getEastAsianWidth(cp)
  return width === 2 || width === 3 || (width === 5 && !isEmoji(cp))
}

// nsUnicharUtils.cpp:500-504
function isSegmentBreakSkipChar(cp: number): boolean {
  return isEastAsianWidthFHWExcludingEmoji(cp) && !isHangul(cp) && cp !== 0x20a9
}

// nsUnicharUtils.cpp:506-527, with UnicodeProperties.h:187-199
function isEastAsianPunctuation(cp: number): boolean {
  return getEastAsianWidth(cp) !== 0 && ((isPunctuation(cp) && cp !== 0x20a9) || cp === 0xff5e || cp === 0x3000)
}

// gfxFontGroup::IsInvalidChar(char16_t), gfxTextRun.h:975-992. Below U+0100 it answers as
// IsInvalidChar(uint8_t), gfxTextRun.h:971-973.
function isInvalidChar(ch: number): boolean {
  if (ch >= 0x20 && ch < 0x7f) return false
  if (ch <= 0x9f) return true
  return ((ch & 0xff00) === 0x2000 && (ch === 0x200b || ch === 0x2028 || ch === 0x2029 || ch === 0x2060)) ||
    ch === 0xfeff || isBidiControl(ch)
}

// --- 1. TransformText (nsTextFrameUtils.cpp:84-401) ---

type Transformed = { text: string, units: Uint16Array, orig: Int32Array, skipped: Uint8Array }

// IsDiscardable, nsTextFrameUtils.cpp:32-49
export function isDiscardable(ch: number, is8bit: boolean): boolean {
  return ch === CH_SHY || (!is8bit && isBidiControl(ch))
}
const isSpaceOrTab = (ch: number) => ch === 0x20 || ch === 0x09
const isSpaceOrTabOrSegmentBreak = (ch: number) => ch === 0x20 || ch === 0x09 || ch === 0x0a

// IsSpaceCombiningSequenceTail(const char16_t*, int32_t), nsTextFrameUtils.cpp:24-30, on code units.
export function isSpaceCombiningSequenceTail(text: string, from: number): boolean {
  for (let i = from; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (isClusterExtenderExcludingJoiners(ch)) return true
    if (!isBidiControl(ch)) return false
  }
  return false
}

// aLangIsJapaneseOrChinese, nsTextFrameUtils.cpp:273-285
function isJapaneseOrChinese(language: string | null): boolean {
  if (language === null || language.length < 2 || (language.length > 2 && language.charCodeAt(2) !== 0x2d)) return false
  const first = language.charCodeAt(0) | 0x20
  const second = language.charCodeAt(1) | 0x20
  return (first === 0x6a && second === 0x61) || (first === 0x7a && second === 0x68)
}

function transformText(input: string, raw: Uint16Array, is8bit: boolean, preserveWhiteSpace: boolean, japaneseOrChinese: boolean): Transformed {
  const len = raw.length
  const units = new Uint16Array(len)
  const orig = new Int32Array(len)
  const skipped = new Uint8Array(len)
  let n = 0
  // The transformed string is built from input slices: input[sliceStart, sliceEnd) is kept unchanged so far.
  let text = ''
  let sliceStart = 0
  let sliceEnd = 0
  const keep = (i: number, ch: number) => {
    units[n] = ch
    orig[n] = i
    n++
    if (ch !== raw[i]) {
      text += input.slice(sliceStart, sliceEnd) + ' '
      sliceStart = sliceEnd = i + 1
    } else if (i !== sliceEnd) {
      text += input.slice(sliceStart, sliceEnd)
      sliceStart = i
      sliceEnd = i + 1
    } else {
      sliceEnd++
    }
  }

  if (preserveWhiteSpace) {
    // COMPRESS_NONE, nsTextFrameUtils.cpp:222-271
    for (let i = 0; i < len; i++) {
      const ch = raw[i]!
      if (isDiscardable(ch, is8bit)) skipped[i] = 1
      else keep(i, ch)
    }
  } else {
    // COMPRESS_WHITESPACE_NEWLINE, :272-387
    let inWhitespace = false
    // TransformWhiteSpaces, :84-209
    const transformWhiteSpaces = (begin: number, end: number, hasSegmentBreak: boolean) => {
      let segmentBreakSkippable = false
      if (!is8bit) {
        if ((begin > 0 && raw[begin - 1] === 0x200b) || (end < len && raw[end] === 0x200b)) {
          segmentBreakSkippable = true
        } else if (begin > 0 && end < len) {
          let before: number
          let pos = begin
          for (;;) {
            if (pos > 1 && isSurrogatePair(raw[pos - 2]!, raw[pos - 1]!)) { before = combine(raw[pos - 2]!, raw[pos - 1]!); pos -= 2 }
            else { before = raw[pos - 1]!; pos -= 1 }
            if (!(isDefaultIgnorable(before) && pos > 0)) break
          }
          let after: number
          pos = end
          for (;;) {
            if (pos + 1 < len && isSurrogatePair(raw[pos]!, raw[pos + 1]!)) { after = combine(raw[pos]!, raw[pos + 1]!); pos += 2 }
            else { after = raw[pos]!; pos += 1 }
            if (!(isDefaultIgnorable(after) && pos < len)) break
          }
          segmentBreakSkippable = (isSegmentBreakSkipChar(before) && isSegmentBreakSkipChar(after)) ||
            (japaneseOrChinese && (isEastAsianPunctuation(before) || isEastAsianPunctuation(after)))
        }
      }
      for (let i = begin; i < end; i++) {
        const ch = raw[i]!
        if (isDiscardable(ch, is8bit)) { skipped[i] = 1; continue }
        if (isSpaceOrTab(ch)) {
          if (hasSegmentBreak || inWhitespace) { skipped[i] = 1; continue } // :152-162
          keep(i, 0x20)
          inWhitespace = true
        } else {
          if (segmentBreakSkippable || inWhitespace) { skipped[i] = 1; continue } // :181-193
          segmentBreakSkippable = true
          keep(i, 0x20)
          inWhitespace = true
        }
      }
    }
    let i = 0
    while (i < len) {
      const ch = raw[i]!
      if (!isSpaceOrTabOrSegmentBreak(ch) && !isDiscardable(ch, is8bit)) {
        keep(i, ch)
        inWhitespace = false
        i++
        continue
      }
      if (isSpaceOrTabOrSegmentBreak(ch)) {
        let keepLastSpace = false
        let hasSegmentBreak = ch === 0x0a
        let trailingDiscardables = 0
        let j = i + 1
        while (j < len && (isSpaceOrTabOrSegmentBreak(raw[j]!) || isDiscardable(raw[j]!, is8bit))) {
          if (raw[j] === 0x0a) hasSegmentBreak = true
          j++
        }
        while (isDiscardable(raw[j - 1]!, is8bit)) { j--; trailingDiscardables++ } // :334-336
        if (!is8bit && raw[j - 1] === 0x20 && j < len && isSpaceCombiningSequenceTail(input, j)) { keepLastSpace = true; j-- } // :339-345
        if (j > i) transformWhiteSpaces(i, j, hasSegmentBreak)
        if (keepLastSpace) { keep(j, 0x20); j++ }
        for (let k = 0; k < trailingDiscardables; k++) { skipped[j] = 1; j++ }
        i = j
        continue
      }
      skipped[i] = 1 // :370-379
      inWhitespace = false
      i++
    }
  }
  text += input.slice(sliceStart, sliceEnd)
  return { text, units: units.subarray(0, n), orig: orig.subarray(0, n), skipped }
}

// IsTrimmableSpace, nsTextFrame.cpp:921-942, in normal white space.
function isTrimmableSpace(source: string, pos: number, is8bit: boolean): boolean {
  switch (source.charCodeAt(pos)) {
    case 0x20: case 0x1680: return is8bit || !isSpaceCombiningSequenceTail(source, pos + 1)
    case 0x0a: case 0x09: case 0x0d: case 0x0c: return true
    default: return false
  }
}

// HasCompressedLeadingWhitespace, nsTextFrame.cpp:2869-2887
function hasCompressedLeadingWhitespace(source: string, skipped: Uint8Array, is8bit: boolean, preserveWhiteSpace: boolean): boolean {
  if (preserveWhiteSpace || skipped[0] === 0) return false
  for (let k = 0; k < source.length && skipped[k] === 1; k++) if (isTrimmableSpace(source, k, is8bit)) return true
  return false
}

// --- 2. Bidi text-run splits (nsBidiPresUtils.cpp) ---

// encoding_rs::mem::is_utf16_code_unit_bidi (mem.rs:1392-1422), used by HasRTLChars (nsBidiUtils.h:107-111).
function isUtf16CodeUnitBidi(u: number): boolean {
  if (u < 0x0590) return false
  if (u >= 0x0900 && u < 0xd802) {
    if (u >= 0x200f && u <= 0x2067) return u === 0x200f || u === 0x202b || u === 0x202e || u === 0x2067
    return false
  }
  if (u >= 0xd83c && u < 0xfb1d) return false
  if (u >= 0xd804 && u < 0xd83a) return false
  if (u > 0xfefe) return false
  if (u >= 0xfe00 && u < 0xfe70) return false
  return true
}

// ReplaceSeparators, nsBidiPresUtils.cpp:861-875
function replaceSeparator(u: number): number {
  return u === 0x09 || u === 0x0a || u === 0x0b || u === 0x0d || (u >= 0x1c && u <= 0x1f) || u === 0x85 || u === 0x2029 ? 0x20 : u
}

// Raw indices where a logical level run starts (ResolveParagraph :877-1110, EnsureBidiContinuation
// :1043-1053, Bidi::GetLogicalRun intl/components/src/Bidi.cpp:165-183). A left-to-right block
// resolves bidi only for 16-bit text with right-to-left characters (Resolve :790-854,
// ChildListMayRequireBidi :1467-1475).
function getBidiRunStarts(raw: Uint16Array, preserveWhiteSpace: boolean): number[] {
  const starts: number[] = []
  let requires = false
  for (let i = 0; i < raw.length && !requires; i++) requires = isUtf16CodeUnitBidi(raw[i]!)
  if (!requires) return starts
  // Pre-wrap text resolves one line at a time, each ending after its LF (:1262-1357, :1089-1098).
  for (let start = 0; start < raw.length;) {
    let end = preserveWhiteSpace ? raw.indexOf(0x0a, start) + 1 : raw.length
    if (end === 0) end = raw.length
    if (start > 0) starts.push(start)
    const paragraph = new Uint16Array(end - start)
    for (let i = 0; i < paragraph.length; i++) paragraph[i] = replaceSeparator(raw[start + i]!)
    const levels = getParagraphLevels(paragraph)
    for (let i = 1; i < paragraph.length; i++) if (levels[i] !== levels[i - 1]) starts.push(start + i)
    start = end
  }
  return starts
}

// --- 3. Text-run glyph records (gfxTextRun.cpp, gfxFont.cpp, gfxScriptItemizer.cpp) ---
//
// Only the facts SetPotentialLineBreaks reads are recorded: which positions start a cluster and
// which are spaces. Every position belongs to one shaped word, space or invalid character. The
// shaped words of every text run are collected first and set up afterwards, so that one
// Intl.Segmenter pass covers them all (markGraphemes).

type Glyphs = { clusterStart: Uint8Array, isSpace: Uint8Array }

// CompressedGlyph::MakeComplex(false, true), gfxFont.cpp:716
function extendCluster(g: Glyphs, i: number): void {
  g.clusterStart[i] = 0
  g.isSpace[i] = 0
}

// Cluster starts inside shaped words, as GraphemeClusterBreakIteratorUtf16 gives them per word in
// SetupClusterBoundaries (gfxFont.cpp:708-769, intl/lwbrk/Segmenter.cpp:174-187). A word with every
// unit below U+0300 has a cluster at every unit. The other words are joined, each followed by LF,
// and segmented once: LF is a cluster on its own (UAX #29 GB4, GB5) and the segmenter continues from
// each boundary without looking back, so every word gets the boundaries it gets alone. Clears
// clusterStart where a unit continues a cluster.
function markGraphemes(g: Glyphs, text: string, units: Uint16Array, words: number[], graphemeSegmenter: Intl.Segmenter): void {
  let joined = ''
  const joinedWords: number[] = []
  for (let k = 0; k < words.length; k += 2) {
    const from = words[k]!, to = words[k + 1]!
    let i = from
    while (i < to && units[i]! < 0x300) i++
    if (i === to) continue
    g.clusterStart.fill(0, from + 1, to)
    joined += text.slice(from, to) + '\n'
    joinedWords.push(from, to)
  }
  if (joinedWords.length === 0) return
  let k = 0
  let delta = joinedWords[0]! // text index minus joined index inside word k
  let end = joinedWords[1]! - joinedWords[0]! // joined index of the LF after word k
  for (const part of graphemeSegmenter.segment(joined)) {
    if (part.index > end) {
      k += 2
      delta = joinedWords[k]! - (end + 1)
      end += 1 + joinedWords[k + 1]! - joinedWords[k]!
    }
    if (part.index < end) g.clusterStart[part.index + delta] = 1
  }
}

// gfxShapedText::SetupClusterBoundaries(uint32_t, const char16_t*, uint32_t), gfxFont.cpp:708-769,
// over cluster starts from markGraphemes, without the emergency wraps after hyphens.
function setupClusterBoundaries(g: Glyphs, units: Uint16Array, from: number, to: number): void {
  let ch0 = units[from]!
  if (to - from > 1 && isSurrogatePair(ch0, units[from + 1]!)) ch0 = combine(ch0, units[from + 1]!)
  if (isClusterExtender(ch0)) extendCluster(g, from)
  for (let pos = from; pos < to; pos++) {
    if (pos > from && g.clusterStart[pos] === 0) continue // a cluster continuation keeps its record
    const ch = units[pos]!
    if (ch === 0x20 || ch === 0x3000) g.isSpace[pos] = 1
    else if (ch === 0x09af && pos > from && units[pos - 1] === 0x09cd) extendCluster(g, pos) // BENGALI_YA after BENGALI_VIRAMA
  }
}

// gfxFont::SplitAndInitTextRun, gfxFont.cpp:3707-3900: appends the shaped words of one script run to
// `words` as [start, end) pairs. A space glyph (SetSpaceGlyphIfSimple, gfxTextRun.cpp:1612-1619) only
// sets isSpace, and an invalid character (:3877-3892) keeps a zero record. Below U+0100, IsBoundarySpace
// (:3317-3330) and SetupClusterBoundaries(uint8_t) (gfxFont.cpp:771-795) answer as the char16_t
// versions, so 8-bit text and 8-bit words take the char16_t path, at any word length (:3569-3577,
// :3817-3821).
function splitAndInitTextRun(g: Glyphs, units: Uint16Array, start: number, end: number, words: number[]): void {
  let wordStart = start
  for (let i = start; i < end; i++) {
    const ch = units[i]!
    const boundary = (ch === 0x20 || ch === 0xa0) && !(i + 1 < end && isClusterExtender(units[i + 1]!))
    if (!boundary && !isInvalidChar(ch)) continue
    if (i > wordStart) words.push(wordStart, i)
    if (ch === 0x20) g.isSpace[i] = 1
    wordStart = i + 1
  }
  if (end > wordStart) words.push(wordStart, end)
}

const PAREN_STACK_DEPTH = 32 // gfxScriptItemizer.h:58

// gfxScriptItemizer::Next and helpers (gfxScriptItemizer.cpp:60-243). Only run boundaries matter,
// so the Script_Extensions fallback (:211-222) is not ported.
class ScriptItemizer {
  private readonly units: Uint16Array
  private readonly end: number
  private scriptLimit: number
  private scriptCode = 0
  private readonly parenChar = new Int32Array(PAREN_STACK_DEPTH)
  private readonly parenScript = new Int32Array(PAREN_STACK_DEPTH)
  private parenSp = -1
  private pushCount = 0
  private fixupCount = 0

  constructor(units: Uint16Array, start: number, end: number) {
    initScripts()
    this.units = units
    this.end = end
    this.scriptLimit = start
  }

  done(): boolean { return this.scriptLimit >= this.end }

  private push(endPairChar: number, script: number): void {
    this.pushCount = this.pushCount < PAREN_STACK_DEPTH ? this.pushCount + 1 : PAREN_STACK_DEPTH
    this.fixupCount = this.fixupCount < PAREN_STACK_DEPTH ? this.fixupCount + 1 : PAREN_STACK_DEPTH
    this.parenSp = (this.parenSp + 1) % PAREN_STACK_DEPTH
    this.parenChar[this.parenSp] = endPairChar
    this.parenScript[this.parenSp] = script
  }

  private pop(): void {
    if (this.pushCount === 0) return
    if (this.fixupCount > 0) this.fixupCount--
    this.pushCount--
    this.parenSp = (this.parenSp + PAREN_STACK_DEPTH - 1) % PAREN_STACK_DEPTH
    if (this.pushCount === 0) this.parenSp = -1
  }

  private fixup(script: number): void {
    let fixupSp = (this.parenSp + PAREN_STACK_DEPTH - this.fixupCount) % PAREN_STACK_DEPTH
    for (; this.fixupCount > 0; this.fixupCount--) {
      fixupSp = (fixupSp + 1) % PAREN_STACK_DEPTH
      this.parenScript[fixupSp] = script
    }
    this.fixupCount = 0xffffffff // `while (fixupCount-- > 0)` on a uint32_t (gfxScriptItemizer.h:134-135)
  }

  // Returns the run limit; the run starts at the previous limit.
  next(): number {
    const units = this.units
    this.fixupCount = 0
    this.scriptCode = SCRIPT_COMMON
    while (this.scriptLimit < this.end) {
      const startOfChar = this.scriptLimit
      let ch = units[this.scriptLimit]!
      let sc: number
      if (ch < 0x02ea) {
        sc = getFastScript(ch)
      } else {
        if (this.scriptLimit < this.end - 1 && isSurrogatePair(ch, units[this.scriptLimit + 1]!)) {
          this.scriptLimit++
          ch = combine(units[startOfChar]!, units[this.scriptLimit]!)
        }
        sc = getScript(ch)
      }
      let pair = 0 // 1 open, 2 close
      if (sc === SCRIPT_COMMON) {
        if (ch < 0x0f3a) {
          if (ch === 0x28 || ch === 0x5b || ch === 0x7b) pair = 1
          else if (ch === 0x29 || ch === 0x5d || ch === 0x7d) pair = 2
        } else if (isOpenPunctuation(ch)) {
          pair = 1
        } else if (isClosePunctuation(ch)) {
          pair = 2
        }
        if (pair === 1) {
          const endPairChar = ch < 0x0f3a ? (ch === 0x28 ? 0x29 : ch === 0x5b ? 0x5d : 0x7d) : getOpenPunctuationMirror(ch)
          if (endPairChar !== ch) this.push(endPairChar, this.scriptCode)
        } else if (pair === 2 && isBidiMirrored(ch)) {
          while (this.pushCount > 0 && this.parenChar[this.parenSp] !== ch) this.pop()
          if (this.pushCount > 0) sc = this.parenScript[this.parenSp]!
        }
      }
      if (sc === SCRIPT_HIRAGANA) sc = SCRIPT_KATAKANA
      if (isSameScript(this.scriptCode, sc, ch)) {
        if (this.scriptCode === SCRIPT_COMMON && !canMergeWithContext(sc)) {
          this.scriptCode = sc
          this.fixup(sc)
        }
        if (pair === 2 && isBidiMirrored(ch)) this.pop()
      } else {
        this.scriptLimit = startOfChar
        break
      }
      this.scriptLimit++
    }
    return this.scriptLimit
  }
}

// gfxScriptItemizer.h:96-107
function getFastScript(ch: number): number {
  const latin = ((ch & ~0x20) >= 0x41 && (ch & ~0x20) <= 0x5a) || (ch >= 0xc0 && ch <= 0xd6) || (ch >= 0xd8 && ch <= 0xf6) ||
    (ch >= 0xf8 && ch <= 0x2b8) || (ch & ~0x10) === 0xaa || (ch >= 0x2e0 && ch <= 0x2e4)
  return latin ? SCRIPT_LATIN : SCRIPT_COMMON
}

// CanMergeWithContext, gfxScriptItemizer.cpp:110-112
function canMergeWithContext(script: number): boolean {
  return script === SCRIPT_COMMON || script === SCRIPT_INHERITED || script === SCRIPT_UNKNOWN
}

// SameScript, gfxScriptItemizer.cpp:117-123
function isSameScript(run: number, current: number, ch: number): boolean {
  return canMergeWithContext(run) || canMergeWithContext(current) || current === run || isClusterExtender(ch) || hasScript(ch, run)
}

// gfxFontGroup::InitTextRun, gfxTextRun.cpp:2673-2831. 8-bit text (:2731-2779) is all Latin and
// Common, so it takes the single-run branch.
function initTextRun(g: Glyphs, units: Uint16Array, start: number, end: number, words: number[]): void {
  let allCommonOrLatin = true
  for (let i = start; i < end && allCommonOrLatin; i++) allCommonOrLatin = units[i]! < 0x02ea
  if (allCommonOrLatin) {
    splitAndInitTextRun(g, units, start, end, words)
    return
  }
  const items = new ScriptItemizer(units, start, end)
  let runStart = start
  while (!items.done()) {
    const limit = items.next()
    splitAndInitTextRun(g, units, runStart, limit, words)
    runStart = limit
  }
}

// --- 4. ICU4X 2.1.2's line iterator for one word (icu_segmenter src/line.rs) ---

let lineTrieIndex: Uint16Array | null = null
let lineTrieData: Uint8Array
let lineBreakStates: Uint8Array

// CodePointTrie::get32 for TrieType::Small with u8 values and error value 0 (cptrie.rs:648-656).
function getLineBreakClass(c: number): number {
  if (lineTrieIndex === null) {
    const indexBytes = decodeBase64(geckoLineTrieIndexBase64)
    lineTrieIndex = new Uint16Array(indexBytes.length >> 1)
    for (let i = 0; i < lineTrieIndex.length; i++) lineTrieIndex[i] = indexBytes[2 * i]! | (indexBytes[2 * i + 1]! << 8)
    lineTrieData = decodeBase64(geckoLineTrieDataBase64)
    lineBreakStates = decodeBase64(geckoLineBreakStatesBase64)
  }
  const index = lineTrieIndex
  if (c <= 0xfff) return lineTrieData[index[c >> 6]! + (c & 0x3f)]! // get32_assuming_fast_index, :568-600
  if (c > 0x10ffff) return 0 // error_value
  if (c >= geckoLineTrieHighStart) return lineTrieData[lineTrieData.length - 2]! // small_index, :503-509
  // internal_small_index, :433-500. SHIFT_1 14, SMALL_INDEX_LENGTH 64, SHIFT_2 9, INDEX_2_MASK 31,
  // SHIFT_3 4, INDEX_3_MASK 31, SMALL_DATA_MASK 15 (impl_const.rs).
  let i3Block = index[index[(c >> 14) + 64]! + ((c >> 9) & 0x1f)]!
  let i3 = (c >> 4) & 0x1f
  let dataBlock: number
  if ((i3Block & 0x8000) === 0) {
    dataBlock = index[i3Block + i3]!
  } else {
    i3Block = (i3Block & 0x7fff) + (i3 & ~7) + (i3 >> 3)
    i3 &= 7
    dataBlock = (index[i3Block]! << (2 + 2 * i3)) & 0x30000
    dataBlock |= index[i3Block + 1 + i3]!
  }
  return lineTrieData[dataBlock + (c & 0xf)]!
}

// Line_Break property values of the data (line.rs:18-128).
const AI = 1, AL = 3, BK = 10, CJ = 12, CM = 14, CR = 16, H2 = 21, H3 = 22, HY = 24, ID = 25, JL = 29,
  JT = 30, JV = 31, LF = 32, NL = 33, NU = 35, SA = 46, SP = 47, ZW = 53, ZWJ = 54
// BreakState bytes (provider/mod.rs:288-310).
const BREAK = 253, NO_MATCH = 254, KEEP = 255, INTERMEDIATE = 120

// LanguageIteratorUtf16 (complex/language.rs:17-45, 78-102) reads single code units: Thai, Lao,
// Burmese, Khmer, or 0 for Unknown, and Chinese and Japanese, for which the LSTM segmenter has no
// model (complex/mod.rs:161-180).
function getComplexLanguage(u: number): number {
  if (u >= 0xe01 && u <= 0xe7f) return 1
  if (u >= 0xe80 && u <= 0xeff) return 2
  if ((u >= 0x1000 && u <= 0x109f) || (u >= 0xa9e0 && u <= 0xa9ff) || (u >= 0xaa60 && u <= 0xaa7f)) return 3
  if ((u >= 0x1780 && u <= 0x17ff) || (u >= 0x19e0 && u <= 0x19ff)) return 4
  return 0
}

// complex_language_segment_utf16 (complex/mod.rs:135-156): splits a run of SA code units by
// language, and Intl.Segmenter words supply boundaries inside each Thai, Lao, Burmese and Khmer
// slice. Every slice reports its end; other languages report nothing else (:149-151).
function segmentComplex(units: number[], wordSegmenter: Intl.Segmenter): number[] {
  const result: number[] = []
  for (let i = 0; i < units.length;) {
    const language = getComplexLanguage(units[i]!)
    let j = i + 1
    while (j < units.length && getComplexLanguage(units[j]!) === language) j++
    if (language !== 0) {
      let slice = ''
      for (let k = i; k < j; k += 4096) slice += String.fromCharCode(...units.slice(k, Math.min(j, k + 4096)))
      for (const part of wordSegmenter.segment(slice)) if (part.index > 0) result.push(i + part.index)
    }
    result.push(j)
    i = j
  }
  return result
}

// KeepAll pairs (line.rs:901-907).
function isKeepAllLetter(p: number): boolean {
  return p === AI || p === AL || p === ID || p === NU || p === HY || p === H2 || p === H3 || p === JL ||
    p === JV || p === JT || p === CJ
}

// LineBreakIterator (line.rs:820-1130) over text[start, end), yielding positions relative to start.
// Unpaired surrogates are looked up as code points, as Utf16Indices does (indices.rs:58-83).
class LineBreakIterator {
  private readonly text: string
  private readonly base: number
  private len: number
  private readonly keepAll: boolean
  private readonly wordSegmenter: Intl.Segmenter
  // Utf16Indices front_offset and current_pos_data (line.rs:821-823).
  private front = 0
  private curPos = -1
  private curCp = 0
  private cache: number[] = []

  constructor(text: string, start: number, end: number, keepAll: boolean, wordSegmenter: Intl.Segmenter) {
    this.text = text
    this.base = start
    this.len = end - start
    this.keepAll = keepAll
    this.wordSegmenter = wordSegmenter
  }

  // advance_iter (line.rs:1077-1079), Utf16Indices::next (indices.rs:58-83).
  private advance(): void {
    const offset = this.front
    if (offset >= this.len) { this.curPos = -1; return }
    let c = this.text.charCodeAt(this.base + offset)
    this.front = offset + 1
    if ((c & 0xfc00) === 0xd800 && offset + 1 < this.len) {
      const next = this.text.charCodeAt(this.base + offset + 1)
      if ((next & 0xfc00) === 0xdc00) { c = ((c & 0x3ff) << 10) + (next & 0x3ff) + 0x10000; this.front = offset + 2 }
    }
    this.curPos = offset
    this.curCp = c
  }

  // Iterator::next (line.rs:833-1067). Returns -1 for None.
  next(): number {
    // check_eof (:1086-1105)
    if (this.curPos < 0) {
      this.advance()
      if (this.curPos < 0) {
        if (this.len === 0) { this.len = 1; return 0 }
        return -1
      }
      return 0
    }

    // Break points cached by a complex-script run (:840-855).
    if (this.cache.length > 0) {
      const firstPos = this.cache[0]!
      let i = 0
      for (;;) {
        if (i === firstPos) {
          const rest: number[] = []
          for (let k = 1; k < this.cache.length; k++) rest.push(this.cache[k]! - i)
          this.cache = rest
          return this.curPos
        }
        i += this.curCp >= 0x10000 ? 2 : 1 // Utf16::char_len (rule_segmenter.rs:335-341)
        this.advance()
        if (this.curPos < 0) { this.cache = []; return this.len }
      }
    }

    let lb9Left = -1 // (:858)
    let lb8aAfterLb9 = false // (:861)

    outer: for (;;) {
      if (this.curPos < 0) return -1
      const leftCodepoint = this.curCp
      const leftProp = lb9Left >= 0 ? lb9Left : getLineBreakClass(leftCodepoint)
      const afterZwj = lb8aAfterLb9 || (lb9Left < 0 && leftProp === ZWJ)
      this.advance()
      if (this.curPos < 0) return this.len
      const rightCodepoint = this.curCp
      const rightProp = getLineBreakClass(rightCodepoint)

      // LB9 (:878-893)
      if ((rightProp === CM || rightProp === ZWJ) && leftProp !== BK && leftProp !== CR && leftProp !== LF &&
        leftProp !== NL && leftProp !== SP && leftProp !== ZW) {
        lb9Left = leftProp
        lb8aAfterLb9 = rightProp === ZWJ
        continue
      }
      lb9Left = -1
      lb8aAfterLb9 = false

      // CSS word-break (:896-909)
      if (this.keepAll && isKeepAllLetter(leftProp) && isKeepAllLetter(rightProp)) continue

      // Complex scripts (:941-950)
      if (getLineBreakClass(leftCodepoint) === SA && rightProp === SA) {
        const result = this.handleComplexLanguage(leftCodepoint)
        if (result >= 0) return result
      }

      const state = lineBreakStates[leftProp * geckoLinePropertyCount + rightProp]! // (:702-706, 953)
      if (state === BREAK || state === NO_MATCH) {
        if (afterZwj) continue
        return this.curPos
      }
      if (state === KEEP) continue

      let index = state >= INTERMEDIATE ? state - INTERMEDIATE : state
      let prevFront = this.front
      let prevPos = this.curPos
      let prevCp = this.curCp
      let previousIsAfterZwj = afterZwj
      let leftPropPreLb9 = rightProp
      const isIntermediateRuleNoMatch = lb8aAfterLb9 ? true : index > geckoLineLastCodepointProperty // (:976-981)

      for (;;) {
        this.advance()
        const innerAfterZwj = leftPropPreLb9 === ZWJ
        const previousBreakStateIsCpProp = index <= geckoLineLastCodepointProperty

        if (this.curPos < 0) { // (:990-1007)
          if (lineBreakStates[index * geckoLinePropertyCount + geckoLineEotProperty] === NO_MATCH) {
            this.front = prevFront; this.curPos = prevPos; this.curCp = prevCp
            if (previousIsAfterZwj) continue outer
            return this.curPos
          }
          return this.len
        }
        const prop = getLineBreakClass(this.curCp)

        if ((prop === CM || prop === ZWJ) && leftPropPreLb9 !== BK && leftPropPreLb9 !== CR && leftPropPreLb9 !== LF &&
          leftPropPreLb9 !== NL && leftPropPreLb9 !== SP && leftPropPreLb9 !== ZW) { // (:1009-1019)
          leftPropPreLb9 = prop
          continue
        }

        const next = lineBreakStates[index * geckoLinePropertyCount + prop]! // (:1021-1061)
        if (next === KEEP) continue outer
        if (next === NO_MATCH) {
          this.front = prevFront; this.curPos = prevPos; this.curCp = prevCp
          if (innerAfterZwj) {
            if (isIntermediateRuleNoMatch && !previousIsAfterZwj) return this.curPos
            continue outer
          }
          if (previousIsAfterZwj) continue outer
          return this.curPos
        }
        if (next === BREAK) {
          if (innerAfterZwj) continue outer
          return this.curPos
        }
        if (next >= INTERMEDIATE) {
          index = next - INTERMEDIATE
          prevFront = this.front; prevPos = this.curPos; prevCp = this.curCp
          previousIsAfterZwj = innerAfterZwj
        } else {
          index = next
          if (previousBreakStateIsCpProp) {
            prevFront = this.front; prevPos = this.curPos; prevCp = this.curCp
            previousIsAfterZwj = innerAfterZwj
          }
        }
        leftPropPreLb9 = prop
      }
    }
  }

  // Utf16 line_handle_complex_language (line.rs:1263-1316). Code points are truncated to u16 there.
  private handleComplexLanguage(leftCodepoint: number): number {
    const startFront = this.front, startPos = this.curPos, startCp = this.curCp
    const units = [leftCodepoint & 0xffff]
    for (;;) {
      if (this.curPos < 0) return -1
      units.push(this.curCp & 0xffff)
      this.advance()
      if (this.curPos < 0 || getLineBreakClass(this.curCp) !== SA) break
    }
    this.front = startFront; this.curPos = startPos; this.curCp = startCp
    this.cache = segmentComplex(units, this.wordSegmenter)
    if (this.cache.length === 0) return -1
    const firstPos = this.cache[0]!
    let i = 1
    for (;;) {
      if (i === firstPos) {
        const rest: number[] = []
        for (let k = 1; k < this.cache.length; k++) rest.push(this.cache[k]! - i)
        this.cache = rest
        return this.curPos
      }
      i += 1
      this.advance()
      if (this.curPos < 0) { this.cache = []; return this.len }
    }
  }
}

// --- 5. nsLineBreaker (dom/base/nsLineBreaker.cpp) ---

// kNonBreakableASCII, nsLineBreaker.cpp:33-48
const NON_BREAKABLE_ASCII = new Uint8Array([
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0,
])

// The break states of one text node: nsLineBreaker::AppendText with flags 0 while no word is
// buffered (16-bit :235-400, 8-bit :505-650), after AppendInvisibleWhitespace when leading white
// space was compressed (nsTextFrame.cpp:2978-2981, nsLineBreaker.cpp:695-708), then the last
// word's FlushCurrentWord from Reset (nsLineBreaker.cpp:134-226, 710-720). Each word of more than
// ASCII letters goes to LineBreaker::ComputeBreakPositions (intl/lwbrk/LineBreaker.cpp:112-194),
// which keeps the state before its first unit (AutoRestore, :342, :604; skipSet = 1, :200-206).
function getBreakStates(text: string, units: Uint16Array, is8bit: boolean, afterLeadingWhitespace: boolean, keepAll: boolean, wordSegmenter: Intl.Segmenter): Uint8Array {
  const len = units.length
  const state = new Uint8Array(len)
  let afterBreakableSpace = afterLeadingWhitespace
  let wordStart = 0
  let wordMightBeBreakable = false
  for (let offset = 0; offset <= len; offset++) {
    const ch = offset < len ? units[offset]! : -1
    // nsLineBreaker::IsSegmentSpace, nsLineBreaker.h:260-264
    const isSpace = ch === 0x20 || ch === 0x09 || ch === 0x0d
    if (afterBreakableSpace && !isSpace && ch >= 0) state[offset] = 1
    afterBreakableSpace = isSpace
    if (ch >= 0 && !isSpace && (is8bit || ch !== 0x0a)) { // :332, :595
      // IsNonBreakableChar, nsLineBreaker.cpp:50-56
      if (!(ch >= 0x20 && ch <= 0x7f && NON_BREAKABLE_ASCII[ch - 0x20] === 1)) wordMightBeBreakable = true
      continue
    }
    if (offset > wordStart && wordMightBeBreakable) {
      const saved = state[wordStart]!
      const iterator = new LineBreakIterator(text, wordStart, offset, keepAll, wordSegmenter)
      for (let pos = iterator.next(); pos >= 0 && pos < offset - wordStart; pos = iterator.next()) state[wordStart + pos] = 1
      state[wordStart] = saved
    }
    wordMightBeBreakable = false
    wordStart = offset + 1
  }
  return state
}

// Where a line may start in a text node's source: flags[i] = 1 for 0 < i < source.length, at a
// normal break (FLAG_BREAK_TYPE_NORMAL) or after a soft hyphen. gfxTextRun::SetPotentialLineBreaks
// (gfxTextRun.cpp:210-236) keeps a break only at a cluster start or after a space. flags[i] = 2 where
// a cluster starts without a break, where only break-word can wrap (gfxTextRun.cpp:1068-1074).
export function getGeckoLineBreaks(
  source: string,
  preserveWhiteSpace: boolean,
  keepAll: boolean,
  language: string | null,
  graphemeSegmenter: Intl.Segmenter,
  wordSegmenter: Intl.Segmenter,
): Uint8Array {
  const len = source.length
  const flags = new Uint8Array(len + 1)
  if (len === 0) return flags
  const raw = new Uint16Array(len)
  let is8bit = true
  for (let i = 0; i < len; i++) {
    const u = source.charCodeAt(i)
    raw[i] = u
    if (u >= 0x100) is8bit = false
  }
  // CharacterDataBuffer::SetTo stores 1b text when every unit is below 256 (CharacterDataBuffer.cpp:235-286).
  const tr = transformText(source, raw, is8bit, preserveWhiteSpace, isJapaneseOrChinese(language))
  const n = tr.units.length
  if (n === 0) return flags

  // The text run is built before the break sinks are set up (nsTextFrame.cpp:2860-2864).
  const runStarts = [0]
  const bidiRunStarts = is8bit ? [] : getBidiRunStarts(raw, preserveWhiteSpace)
  for (let k = 0; k < bidiRunStarts.length; k++) {
    let lo = 0, hi = n // partition_point(orig < start)
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tr.orig[mid]! < bidiRunStarts[k]!) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && lo < n && runStarts[runStarts.length - 1] !== lo) runStarts.push(lo)
  }
  const g: Glyphs = { clusterStart: new Uint8Array(n).fill(1), isSpace: new Uint8Array(n) }
  const words: number[] = []
  for (let k = 0; k < runStarts.length; k++) initTextRun(g, tr.units, runStarts[k]!, k + 1 < runStarts.length ? runStarts[k + 1]! : n, words)
  markGraphemes(g, tr.text, tr.units, words, graphemeSegmenter)
  for (let k = 0; k < words.length; k += 2) setupClusterBoundaries(g, tr.units, words[k]!, words[k + 1]!)
  for (let k = 0; k < runStarts.length; k++) g.clusterStart[runStarts[k]!] = 1 // gfxTextRun.cpp:2824-2831

  const state = getBreakStates(tr.text, tr.units, is8bit, hasCompressedLeadingWhitespace(source, tr.skipped, is8bit, preserveWhiteSpace), keepAll, wordSegmenter)
  for (let t = 1; t < n; t++) {
    const rawPos = tr.orig[t]!
    if ((state[t] === 1 && (g.clusterStart[t] === 1 || g.isSpace[t - 1] === 1)) || (tr.skipped[rawPos - 1] === 1 && raw[rawPos - 1] === CH_SHY)) {
      flags[rawPos] = 1
    } else if (g.clusterStart[t] === 1) {
      flags[rawPos] = 2
    }
  }
  return flags
}
