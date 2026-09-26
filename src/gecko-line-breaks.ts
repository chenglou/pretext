// Break opportunities as Firefox finds them: a port of how Gecko transforms a text node's
// white space, sets up its text run and breaks its words with nsLineBreaker over ICU4X's
// line iterator, with Firefox's baked line data and the Unicode properties Gecko reads,
// which scripts/generate-engine-break-data.ts writes to src/generated/engine-break-data.ts.
//
// Sources, cited as file:line:
// - Gecko in mozilla-firefox at Firefox 156.0 (3bf8f4682).
// - icu_segmenter 2.1.2 src/line.rs, byte-identical to Firefox's third_party/rust copy, and
//   icu_collections 2.1.1 src/codepointtrie/cptrie.rs.
//
// Deliberate differences:
// - Grapheme clusters come from the profile's ICU character rules (src/graphemes.ts), Chrome's,
//   which give the clusters of icu_segmenter's GraphemeClusterSegmenter over Firefox's data, and
//   Unicode properties from RegExp \p{...} and generated tables.
// - Text runs don't split where the script changes (gfxScriptItemizer.cpp). Such a split only
//   adds a cluster start. The port was removed on purpose (RESEARCH.md, Decisions Log).
// - Inside runs of Thai, Lao, Khmer and Myanmar letters, Intl.Segmenter word boundaries stand
//   in for ICU4X's LSTM models (line.rs:445-451, complex/mod.rs:135-156). Firefox's own
//   Intl.Segmenter answers as those models there once breaks inside grapheme clusters are
//   dropped, which setPotentialLineBreaks does.
// - The paragraph is left-to-right, since Pretext takes no direction, and word-break is
//   normal or keep-all under Strict line breaking, which line-break: auto selects
//   (intl/lwbrk/LineBreaker.cpp:26-31).

import {
  geckoEastAsianWidthRangesPacked,
  geckoLineBreakStatesPacked,
  geckoLineEotProperty,
  geckoLineLastCodepointProperty,
  geckoLinePropertyCount,
  geckoLineTrieDataPacked,
  geckoLineTrieHighStart,
  geckoLineTrieIndexPacked,
  type CharTable,
} from './generated/engine-break-data.js'
import { getParagraphLevels } from './gecko-bidi-levels.js'
import { findGraphemeEnds } from './graphemes.js'
import { BREAK as OPPORTUNITY, CLUSTER_START, SOFT_HYPHEN_BREAK, getBreakLanguage, getSmallTrieValue, getWordSegmenter, unpackTable, unpackUint32Table } from './line-breaks.js'

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
const isDefaultIgnorable = codePointFlag(/^\p{Default_Ignorable_Code_Point}$/u)
const isEmoji = codePointFlag(/^\p{Emoji}$/u)
const isHangul = codePointFlag(/^\p{sc=Hangul}$/u)

let eawStarts: number[] | null = null
let eawEnds: number[] = []
let eawValues: number[] = []

// East_Asian_Width H (2), F (3) or W (5), and 0 for any other value.
function getEastAsianWidth(cp: number): number {
  if (eawStarts === null) {
    const geckoEastAsianWidthRanges = unpackUint32Table(geckoEastAsianWidthRangesPacked)
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

type Transformed = { text: string, orig: Int32Array, skipped: Uint8Array }

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

// aLangIsJapaneseOrChinese, nsTextFrameUtils.cpp:273-285, which takes only `-` after the subtag.
export function isJapaneseOrChinese(language: string | null): boolean {
  const breakLanguage = getBreakLanguage(language)
  return (breakLanguage === 'ja' || breakLanguage === 'zh') && language!.charCodeAt(2) !== 0x5f
}

// Gecko's East Asian test for the white-space run [start, end) (TransformWhiteSpaces,
// nsTextFrameUtils.cpp:120-150): the code points before and after it, past default-ignorable
// ones, both segment-break skip characters, or on a `ja` or `zh` page either one East Asian
// punctuation. Only an interior run qualifies.
export function isEastAsianSegmentBreak(text: string, start: number, end: number, japaneseOrChinese: boolean): boolean {
  if (start === 0 || end >= text.length) return false
  let before: number
  let pos = start
  do {
    const low = text.charCodeAt(pos - 1)
    const high = pos > 1 ? text.charCodeAt(pos - 2) : 0
    if (isSurrogatePair(high, low)) { before = combine(high, low); pos -= 2 } else { before = low; pos-- }
  } while (isDefaultIgnorable(before) && pos > 0)
  let after: number
  pos = end
  do {
    after = text.codePointAt(pos)!
    pos += after > 0xffff ? 2 : 1
  } while (isDefaultIgnorable(after) && pos < text.length)
  return (isSegmentBreakSkipChar(before) && isSegmentBreakSkipChar(after)) ||
    (japaneseOrChinese && (isEastAsianPunctuation(before) || isEastAsianPunctuation(after)))
}

function transformText(input: string, is8bit: boolean, preserveWhiteSpace: boolean): Transformed {
  const len = input.length
  const orig = new Int32Array(len)
  const skipped = new Uint8Array(len)
  let n = 0
  // The transformed string is built from input slices: input[sliceStart, sliceEnd) is kept unchanged so far.
  let text = ''
  let sliceStart = 0
  let sliceEnd = 0
  const keep = (i: number, ch: number) => {
    orig[n] = i
    n++
    if (ch !== input.charCodeAt(i)) {
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
      const ch = input.charCodeAt(i)
      if (isDiscardable(ch, is8bit)) skipped[i] = 1
      else keep(i, ch)
    }
  } else {
    // COMPRESS_WHITESPACE_NEWLINE, :272-387
    let inWhitespace = false
    // TransformWhiteSpaces, :84-209. The runs it deletes whole, next to a ZWSP or between East
    // Asian characters (:120-150), are gone already (removeSkippableSegmentBreaks in
    // src/analysis.ts), so a run keeps one space.
    const transformWhiteSpaces = (begin: number, end: number, hasSegmentBreak: boolean) => {
      for (let i = begin; i < end; i++) {
        const ch = input.charCodeAt(i)
        if (isDiscardable(ch, is8bit)) { skipped[i] = 1; continue }
        // A space or tab in a run with a segment break goes (:152-162), and the run's first
        // segment break stays as a space (:181-193).
        if (inWhitespace || (hasSegmentBreak && isSpaceOrTab(ch))) { skipped[i] = 1; continue }
        keep(i, 0x20)
        inWhitespace = true
      }
    }
    let i = 0
    while (i < len) {
      const ch = input.charCodeAt(i)
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
        while (j < len && (isSpaceOrTabOrSegmentBreak(input.charCodeAt(j)) || isDiscardable(input.charCodeAt(j), is8bit))) {
          if (input.charCodeAt(j) === 0x0a) hasSegmentBreak = true
          j++
        }
        while (isDiscardable(input.charCodeAt(j - 1), is8bit)) { j--; trailingDiscardables++ } // :334-336
        if (!is8bit && input.charCodeAt(j - 1) === 0x20 && j < len && isSpaceCombiningSequenceTail(input, j)) { keepLastSpace = true; j-- } // :339-345
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
  return { text, orig: orig.subarray(0, n), skipped }
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
function getBidiRunStarts(source: string, preserveWhiteSpace: boolean): number[] {
  const starts: number[] = []
  let requires = false
  for (let i = 0; i < source.length && !requires; i++) requires = isUtf16CodeUnitBidi(source.charCodeAt(i))
  if (!requires) return starts
  // Pre-wrap text resolves one line at a time, each ending after its LF (:1262-1357, :1089-1098).
  for (let start = 0; start < source.length;) {
    let end = preserveWhiteSpace ? source.indexOf('\n', start) + 1 : source.length
    if (end === 0) end = source.length
    if (start > 0) starts.push(start)
    const paragraph = new Uint16Array(end - start)
    for (let i = 0; i < paragraph.length; i++) paragraph[i] = replaceSeparator(source.charCodeAt(start + i))
    const levels = getParagraphLevels(paragraph)
    for (let i = 1; i < paragraph.length; i++) if (levels[i] !== levels[i - 1]) starts.push(start + i)
    start = end
  }
  return starts
}

// --- 3. Text-run glyph records (gfxTextRun.cpp, gfxFont.cpp) ---
//
// Only the facts SetPotentialLineBreaks reads are recorded: which positions start a cluster and
// which are spaces. Every position belongs to one shaped word, space or invalid character.

type Glyphs = { clusterStart: Uint8Array, isSpace: Uint8Array }

// CompressedGlyph::MakeComplex(false, true), gfxFont.cpp:716
function extendCluster(g: Glyphs, i: number): void {
  g.clusterStart[i] = 0
  g.isSpace[i] = 0
}

// gfxShapedText::SetupClusterBoundaries(uint32_t, const char16_t*, uint32_t), gfxFont.cpp:708-769,
// for one shaped word, without the emergency wraps after hyphens. GraphemeClusterBreakIteratorUtf16
// reads the word alone (intl/lwbrk/Segmenter.cpp:174-187). Below U+0300 only CR and LF share a
// cluster, which the generator checks, and words hold neither, so a word of such units has a
// cluster at every unit. `ends` has room for the word's clusters.
function setupClusterBoundaries(g: Glyphs, text: string, from: number, to: number, graphemeTable: CharTable, ends: Int32Array): void {
  let ch0 = text.charCodeAt(from)
  if (to - from > 1 && isSurrogatePair(ch0, text.charCodeAt(from + 1))) ch0 = combine(ch0, text.charCodeAt(from + 1))
  if (isClusterExtender(ch0)) extendCluster(g, from)
  let low = from
  while (low < to && text.charCodeAt(low) < 0x300) low++
  const count = low === to ? 0 : findGraphemeEnds(graphemeTable, text, from, to, ends)
  for (let k = 0, pos = from; pos < to; k++) {
    const ch = text.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x3000) g.isSpace[pos] = 1
    else if (ch === 0x09af && pos > from && text.charCodeAt(pos - 1) === 0x09cd) extendCluster(g, pos) // BENGALI_YA after BENGALI_VIRAMA
    const end = count === 0 ? pos + 1 : ends[k]!
    for (pos++; pos < end; pos++) extendCluster(g, pos)
  }
}

// gfxFont::SplitAndInitTextRun, gfxFont.cpp:3707-3900: sets up the shaped words of one text run. A
// space glyph (SetSpaceGlyphIfSimple, gfxTextRun.cpp:1612-1619) only sets isSpace, and an invalid
// character (:3877-3892) keeps a zero record. Below U+0100, IsBoundarySpace (:3317-3330) and
// SetupClusterBoundaries(uint8_t) (gfxFont.cpp:771-795) answer as the char16_t versions, so 8-bit
// text and 8-bit words take the char16_t path, at any word length (:3569-3577, :3817-3821).
function splitAndInitTextRun(g: Glyphs, text: string, start: number, end: number, graphemeTable: CharTable, ends: Int32Array): void {
  let wordStart = start
  for (let i = start; i < end; i++) {
    const ch = text.charCodeAt(i)
    const boundary = (ch === 0x20 || ch === 0xa0) && !(i + 1 < end && isClusterExtender(text.charCodeAt(i + 1)))
    if (!boundary && !isInvalidChar(ch)) continue
    if (i > wordStart) setupClusterBoundaries(g, text, wordStart, i, graphemeTable, ends)
    if (ch === 0x20) g.isSpace[i] = 1
    wordStart = i + 1
  }
  if (end > wordStart) setupClusterBoundaries(g, text, wordStart, end, graphemeTable, ends)
}

// --- 4. ICU4X 2.1.2's line iterator for one word (icu_segmenter src/line.rs) ---

let lineTrieIndex: Uint16Array | null = null
let lineTrieData: Uint8Array
let lineBreakStates: Uint8Array

// Little-endian data, read on a little-endian platform.
function unpackU16(packed: string): Uint16Array {
  const bytes = unpackTable(packed)
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length >> 1)
}

// The Line_Break value, with error value 0 above U+10FFFF.
function getLineBreakClass(c: number): number {
  if (lineTrieIndex === null) {
    lineTrieIndex = unpackU16(geckoLineTrieIndexPacked)
    lineTrieData = unpackTable(geckoLineTrieDataPacked)
    lineBreakStates = unpackTable(geckoLineBreakStatesPacked)
  }
  return c > 0x10ffff ? 0 : getSmallTrieValue(lineTrieIndex, lineTrieData, geckoLineTrieHighStart, c)
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
function segmentComplex(units: number[]): number[] {
  const result: number[] = []
  for (let i = 0; i < units.length;) {
    const language = getComplexLanguage(units[i]!)
    let j = i + 1
    while (j < units.length && getComplexLanguage(units[j]!) === language) j++
    if (language !== 0) {
      let slice = ''
      for (let k = i; k < j; k += 4096) slice += String.fromCharCode(...units.slice(k, Math.min(j, k + 4096)))
      for (const part of getWordSegmenter().segment(slice)) if (part.index > 0) result.push(i + part.index)
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
type LineBreakIterator = {
  readonly text: string
  readonly base: number
  len: number
  readonly keepAll: boolean
  // Utf16Indices front_offset and current_pos_data (line.rs:821-823).
  front: number
  curPos: number
  curCp: number
  // Break points cached by a complex-script run, each less `cacheOffset`, from `cacheAt`.
  cache: number[]
  cacheAt: number
  cacheOffset: number
}

function createLineBreakIterator(text: string, start: number, end: number, keepAll: boolean): LineBreakIterator {
  return { text, base: start, len: end - start, keepAll, front: 0, curPos: -1, curCp: 0, cache: [], cacheAt: 0, cacheOffset: 0 }
}

// advance_iter (line.rs:1077-1079), Utf16Indices::next (indices.rs:58-83).
function advanceLineIterator(it: LineBreakIterator): void {
  const offset = it.front
  if (offset >= it.len) { it.curPos = -1; return }
  let c = it.text.charCodeAt(it.base + offset)
  it.front = offset + 1
  if ((c & 0xfc00) === 0xd800 && offset + 1 < it.len) {
    const next = it.text.charCodeAt(it.base + offset + 1)
    if ((next & 0xfc00) === 0xdc00) { c = ((c & 0x3ff) << 10) + (next & 0x3ff) + 0x10000; it.front = offset + 2 }
  }
  it.curPos = offset
  it.curCp = c
}

// Iterator::next (line.rs:833-1067). Returns -1 for None.
function nextLineBreak(it: LineBreakIterator): number {
  // check_eof (:1086-1105)
  if (it.curPos < 0) {
    advanceLineIterator(it)
    if (it.curPos < 0) {
      if (it.len === 0) { it.len = 1; return 0 }
      return -1
    }
    return 0
  }

  // Break points cached by a complex-script run (:840-855).
  if (it.cacheAt < it.cache.length) {
    const firstPos = it.cache[it.cacheAt]! - it.cacheOffset
    let i = 0
    for (;;) {
      if (i === firstPos) {
        it.cacheAt++
        it.cacheOffset += i
        return it.curPos
      }
      i += it.curCp >= 0x10000 ? 2 : 1 // Utf16::char_len (rule_segmenter.rs:335-341)
      advanceLineIterator(it)
      if (it.curPos < 0) { it.cacheAt = it.cache.length; return it.len }
    }
  }

  let lb9Left = -1 // (:858)
  let lb8aAfterLb9 = false // (:861)

  outer: for (;;) {
    if (it.curPos < 0) return -1
    const leftCodepoint = it.curCp
    const leftProp = lb9Left >= 0 ? lb9Left : getLineBreakClass(leftCodepoint)
    const afterZwj = lb8aAfterLb9 || (lb9Left < 0 && leftProp === ZWJ)
    advanceLineIterator(it)
    if (it.curPos < 0) return it.len
    const rightCodepoint = it.curCp
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
    if (it.keepAll && isKeepAllLetter(leftProp) && isKeepAllLetter(rightProp)) continue

    // Complex scripts (:941-950)
    if (getLineBreakClass(leftCodepoint) === SA && rightProp === SA) {
      const result = handleComplexLanguage(it, leftCodepoint)
      if (result >= 0) return result
    }

    const state = lineBreakStates[leftProp * geckoLinePropertyCount + rightProp]! // (:702-706, 953)
    if (state === BREAK || state === NO_MATCH) {
      if (afterZwj) continue
      return it.curPos
    }
    if (state === KEEP) continue

    let index = state >= INTERMEDIATE ? state - INTERMEDIATE : state
    let prevFront = it.front
    let prevPos = it.curPos
    let prevCp = it.curCp
    let previousIsAfterZwj = afterZwj
    let leftPropPreLb9 = rightProp
    const isIntermediateRuleNoMatch = lb8aAfterLb9 ? true : index > geckoLineLastCodepointProperty // (:976-981)

    for (;;) {
      advanceLineIterator(it)
      const innerAfterZwj = leftPropPreLb9 === ZWJ
      const previousBreakStateIsCpProp = index <= geckoLineLastCodepointProperty

      if (it.curPos < 0) { // (:990-1007)
        if (lineBreakStates[index * geckoLinePropertyCount + geckoLineEotProperty] === NO_MATCH) {
          it.front = prevFront; it.curPos = prevPos; it.curCp = prevCp
          if (previousIsAfterZwj) continue outer
          return it.curPos
        }
        return it.len
      }
      const prop = getLineBreakClass(it.curCp)

      if ((prop === CM || prop === ZWJ) && leftPropPreLb9 !== BK && leftPropPreLb9 !== CR && leftPropPreLb9 !== LF &&
        leftPropPreLb9 !== NL && leftPropPreLb9 !== SP && leftPropPreLb9 !== ZW) { // (:1009-1019)
        leftPropPreLb9 = prop
        continue
      }

      const next = lineBreakStates[index * geckoLinePropertyCount + prop]! // (:1021-1061)
      if (next === KEEP) continue outer
      if (next === NO_MATCH) {
        it.front = prevFront; it.curPos = prevPos; it.curCp = prevCp
        if (innerAfterZwj) {
          if (isIntermediateRuleNoMatch && !previousIsAfterZwj) return it.curPos
          continue outer
        }
        if (previousIsAfterZwj) continue outer
        return it.curPos
      }
      if (next === BREAK) {
        if (innerAfterZwj) continue outer
        return it.curPos
      }
      if (next >= INTERMEDIATE) {
        index = next - INTERMEDIATE
        prevFront = it.front; prevPos = it.curPos; prevCp = it.curCp
        previousIsAfterZwj = innerAfterZwj
      } else {
        index = next
        if (previousBreakStateIsCpProp) {
          prevFront = it.front; prevPos = it.curPos; prevCp = it.curCp
          previousIsAfterZwj = innerAfterZwj
        }
      }
      leftPropPreLb9 = prop
    }
  }
}

// Utf16 line_handle_complex_language (line.rs:1263-1316). Code points are truncated to u16 there.
function handleComplexLanguage(it: LineBreakIterator, leftCodepoint: number): number {
  const startFront = it.front, startPos = it.curPos, startCp = it.curCp
  const units = [leftCodepoint & 0xffff]
  for (;;) {
    if (it.curPos < 0) return -1
    units.push(it.curCp & 0xffff)
    advanceLineIterator(it)
    if (it.curPos < 0 || getLineBreakClass(it.curCp) !== SA) break
  }
  it.front = startFront; it.curPos = startPos; it.curCp = startCp
  it.cache = segmentComplex(units)
  it.cacheAt = 0
  it.cacheOffset = 0
  if (it.cache.length === 0) return -1
  const firstPos = it.cache[0]!
  let i = 1
  for (;;) {
    if (i === firstPos) {
      it.cacheAt = 1
      it.cacheOffset = i
      return it.curPos
    }
    i += 1
    advanceLineIterator(it)
    if (it.curPos < 0) { it.cacheAt = it.cache.length; return it.len }
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
function getBreakStates(text: string, is8bit: boolean, afterLeadingWhitespace: boolean, keepAll: boolean): Uint8Array {
  const len = text.length
  const state = new Uint8Array(len)
  let afterBreakableSpace = afterLeadingWhitespace
  let wordStart = 0
  let wordMightBeBreakable = false
  for (let offset = 0; offset <= len; offset++) {
    const ch = offset < len ? text.charCodeAt(offset) : -1
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
      const iterator = createLineBreakIterator(text, wordStart, offset, keepAll)
      for (let pos = nextLineBreak(iterator); pos >= 0 && pos < offset - wordStart; pos = nextLineBreak(iterator)) state[wordStart + pos] = 1
      state[wordStart] = saved
    }
    wordMightBeBreakable = false
    wordStart = offset + 1
  }
  return state
}

// Where a line may start in a text node's source, after the segment break transformation that
// removeSkippableSegmentBreaks applies: flags[i] = 1 for 0 < i < source.length, at a
// normal break (FLAG_BREAK_TYPE_NORMAL) or after a soft hyphen. gfxTextRun::SetPotentialLineBreaks
// (gfxTextRun.cpp:210-236) keeps a break only at a cluster start or after a space. flags[i] = 3 at a
// normal break right after a soft hyphen: BreakAndMeasureText takes it as
// the normal break, which neither fits nor draws a hyphen (gfxTextRun.cpp:1053-1063). flags[i] = 2 where a cluster starts
// without a break, where only break-word can wrap (gfxTextRun.cpp:1068-1074).
export function getGeckoLineBreaks(
  source: string,
  preserveWhiteSpace: boolean,
  keepAll: boolean,
  graphemeTable: CharTable,
): Uint8Array {
  const len = source.length
  const flags = new Uint8Array(len + 1)
  if (len === 0) return flags
  let is8bit = true
  for (let i = 0; i < len && is8bit; i++) is8bit = source.charCodeAt(i) < 0x100
  // CharacterDataBuffer::SetTo stores 1b text when every unit is below 256 (CharacterDataBuffer.cpp:235-286).
  const tr = transformText(source, is8bit, preserveWhiteSpace)
  const n = tr.text.length
  if (n === 0) return flags

  // The text run is built before the break sinks are set up (nsTextFrame.cpp:2860-2864).
  const runStarts = [0]
  const bidiRunStarts = is8bit ? [] : getBidiRunStarts(source, preserveWhiteSpace)
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
  const ends = new Int32Array(n)
  for (let k = 0; k < runStarts.length; k++) splitAndInitTextRun(g, tr.text, runStarts[k]!, k + 1 < runStarts.length ? runStarts[k + 1]! : n, graphemeTable, ends)
  for (let k = 0; k < runStarts.length; k++) g.clusterStart[runStarts[k]!] = 1 // gfxTextRun.cpp:2828-2835

  const state = getBreakStates(tr.text, is8bit, hasCompressedLeadingWhitespace(source, tr.skipped, is8bit, preserveWhiteSpace), keepAll)
  for (let t = 1; t < n; t++) {
    const rawPos = tr.orig[t]!
    const normal = state[t] === 1 && (g.clusterStart[t] === 1 || g.isSpace[t - 1] === 1)
    const afterSoftHyphen = tr.skipped[rawPos - 1] === 1 && source.charCodeAt(rawPos - 1) === CH_SHY
    if (normal || afterSoftHyphen) {
      flags[rawPos] = normal && afterSoftHyphen ? OPPORTUNITY | SOFT_HYPHEN_BREAK : OPPORTUNITY
    } else if (g.clusterStart[t] === 1) {
      flags[rawPos] = CLUSTER_START
    }
  }
  return flags
}
