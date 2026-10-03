// Break opportunities as Firefox finds them: a port of how Gecko transforms a text node's
// white space, sets up its text run and breaks its words with nsLineBreaker over ICU4X's
// line iterator, with Firefox's baked line data and the Unicode properties Gecko reads,
// which scripts/generate-engine-break-data.ts writes to src/generated/engine-break-data.ts.
//
// Sources, cited as file:line:
// - Gecko in mozilla-firefox at Firefox 156.0 (3bf8f4682).
// - icu_segmenter 2.1.2 src/line.rs, byte-identical to Firefox's third_party/rust copy.
//
// Deliberate differences:
// - Grapheme clusters come from the profile's ICU character rules (src/graphemes.ts), Chrome's,
//   which give the clusters of icu_segmenter's GraphemeClusterSegmenter over Firefox's data, and
//   Unicode properties from RegExp \p{...} and generated tables.
// - Text runs don't split where the script changes (gfxScriptItemizer.cpp), nor where the bidi
//   level does: bidi resolution makes a text frame of each level run (nsBidiPresUtils.cpp:
//   1037-1053), and a text run doesn't go on across two (ContinueTextRunAcrossFrames,
//   nsTextFrame.cpp:2023-2030). Such a split only adds a cluster start, restarts clusters within
//   its word and ends a word after a space before a cluster extender, so a level split is missed
//   only inside a cluster, or after a space inside one: for example at a vowel killer of a
//   left-to-right script after an Arabic letter, or at a ZWJ that ends the paragraph after a
//   Hebrew letter, which rule L1 puts at the paragraph's level. Both ports were removed on
//   purpose (RESEARCH.md, Decisions Log; ENGINE_FOLLOWUPS.md, Bidi levels, direction and script
//   runs).
// - Inside runs of Thai, Lao, Khmer and Myanmar letters, Intl.Segmenter word boundaries stand
//   in for ICU4X's LSTM models (line.rs:445-451, complex/mod.rs:135-156). Firefox's own
//   Intl.Segmenter answers as those models there once breaks inside grapheme clusters are
//   dropped, which setPotentialLineBreaks does.
// - The paragraph is left-to-right, since Pretext takes no direction, and word-break is
//   normal or keep-all under Strict line breaking, which line-break: auto selects
//   (intl/lwbrk/LineBreaker.cpp:26-31).

import {
  geckoLineBreakStatesPacked,
  geckoLineEotProperty,
  geckoLineLastCodepointProperty,
  geckoLinePropertyCount,
} from './generated/engine-break-data.js'
import { findGraphemeEnds, isBidiControl, type GraphemeTable } from './graphemes.js'
import {
  BREAK as OPPORTUNITY,
  CLUSTER_START,
  DEFAULT_IGNORABLE,
  EMOJI,
  HANGUL,
  MARK,
  PUNCTUATION,
  SOFT_HYPHEN_BREAK,
  getBreakLanguage,
  getClass,
  getWordSegmenter,
  hasProperty,
  unpackClasses,
  unpackTable,
  type ClassTable,
} from './line-breaks.js'

const CH_SHY = 0x00ad

const isSurrogatePair = (a: number, b: number) => (a & 0xfc00) === 0xd800 && (b & 0xfc00) === 0xdc00
const combine = (a: number, b: number) => 0x10000 + ((a - 0xd800) << 10) + (b - 0xdc00)

// East_Asian_Width H (2), F (3) or W (5), and 0 for any other value, which the first East Asian
// segment break test unpacks (isEastAsianSegmentBreak).
let eastAsianWidths: ClassTable | null = null

// --- Character classes ---

// nsUnicodeProperties.h:202-207, nsUnicodeProperties.cpp:130-138
function isClusterExtender(cp: number): boolean {
  return cp >= 0x0300 && (hasProperty(cp, MARK) || cp === 0x200c || cp === 0x200d || (cp >= 0xff9e && cp <= 0xff9f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f))
}

// nsUnicodeProperties.h:211-214, nsUnicodeProperties.cpp:140-147
function isClusterExtenderExcludingJoiners(cp: number): boolean {
  return cp >= 0x0300 && (hasProperty(cp, MARK) || (cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f))
}

// UnicodeProperties.h:205-218
function isEastAsianWidthFHWExcludingEmoji(widths: ClassTable, cp: number): boolean {
  const width = getClass(widths, cp)
  return width === 2 || width === 3 || (width === 5 && !hasProperty(cp, EMOJI))
}

// nsUnicharUtils.cpp:500-504
function isSegmentBreakSkipChar(widths: ClassTable, cp: number): boolean {
  return isEastAsianWidthFHWExcludingEmoji(widths, cp) && !hasProperty(cp, HANGUL) && cp !== 0x20a9
}

// nsUnicharUtils.cpp:506-527, with UnicodeProperties.h:187-199
function isEastAsianPunctuation(widths: ClassTable, cp: number): boolean {
  return getClass(widths, cp) !== 0 && ((hasProperty(cp, PUNCTUATION) && cp !== 0x20a9) || cp === 0xff5e || cp === 0x3000)
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

// Whether the text run leaves out a bidi control, which only 16-bit text does (IsDiscardable), is
// noted as it leaves them out, as IsDiscardable notes a soft hyphen (HasShy): testing the text for
// one before the scan costs every text a pass (RESEARCH.md, Keeping Work Bounded). `leftOut` is
// GeckoLineBreaks'.
type Transformed = { text: string, orig: Int32Array, skipped: Uint8Array, leftOut: Uint8Array | null, dropsBidiControl: boolean }

// IsDiscardable, nsTextFrameUtils.cpp:32-49
export function isDiscardable(ch: number, is8bit: boolean): boolean {
  return ch === CH_SHY || (!is8bit && isBidiControl(ch))
}
const isSpaceOrTab = (ch: number) => ch === 0x20 || ch === 0x09
// IsSpaceOrTabOrSegmentBreak, nsTextFrameUtils.cpp:51-57: a white-space run's white space, which a CR or FF isn't.
export const isSpaceOrTabOrSegmentBreak = (ch: number) => ch === 0x20 || ch === 0x09 || ch === 0x0a

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
  const widths = eastAsianWidths ??= unpackClasses('gecko/east_asian_width')
  let before: number
  let pos = start
  do {
    const low = text.charCodeAt(pos - 1)
    const high = pos > 1 ? text.charCodeAt(pos - 2) : 0
    if (isSurrogatePair(high, low)) { before = combine(high, low); pos -= 2 } else { before = low; pos-- }
  } while (hasProperty(before, DEFAULT_IGNORABLE) && pos > 0)
  let after: number
  pos = end
  do {
    after = text.codePointAt(pos)!
    pos += after > 0xffff ? 2 : 1
  } while (hasProperty(after, DEFAULT_IGNORABLE) && pos < text.length)
  return (isSegmentBreakSkipChar(widths, before) && isSegmentBreakSkipChar(widths, after)) ||
    (japaneseOrChinese && (isEastAsianPunctuation(widths, before) || isEastAsianPunctuation(widths, after)))
}

// The scan transforms a text node's text as one text frame's. Firefox transforms a frame at a
// time, each from the white-space state the frame before it left (mNextRunContextInfo,
// nsTextFrame.cpp:2515-2518), and bidi resolution splits a text node into a frame for each level
// run (nsBidiPresUtils.cpp:1037-1053). A frame that starts at a character the text run drops ends
// the white-space run there (nsTextFrameUtils.cpp:370-379), and a line's start trims the white
// space a frame starts with while the line holds nothing (nsTextFrame.cpp:10904-10944). A
// dropped character starts a frame only where it is a bidi control that starts a level run, and
// whether one does turns on the paragraph's direction, which Pretext doesn't take: after a
// space, U+200F between Latin words starts one in a left-to-right paragraph and none in a
// right-to-left one, and U+200E between Hebrew words the other way around. So a white-space run
// reads through every character the text run drops. That is Firefox's run wherever the control
// keeps the level of the white space before it, as a mark of the paragraph's own direction does
// outside an embedding or isolate; ENGINE_FOLLOWUPS.md, White space and controls, has the rest.
function transformText(input: string, is8bit: boolean, preserveWhiteSpace: boolean): Transformed {
  const len = input.length
  // The source index of each kept unit.
  const orig = new Int32Array(len)
  const skipped = new Uint8Array(len)
  let leftOut: Uint8Array | null = null
  let n = 0
  let dropsBidiControl = false
  if (preserveWhiteSpace) {
    // COMPRESS_NONE, nsTextFrameUtils.cpp:222-271
    for (let i = 0; i < len; i++) {
      const ch = input.charCodeAt(i)
      if (!isDiscardable(ch, is8bit)) {
        orig[n++] = i
      } else {
        skipped[i] = 1
        dropsBidiControl ||= ch !== CH_SHY
      }
    }
  } else {
    // COMPRESS_WHITESPACE_NEWLINE, :272-387
    let inWhitespace = false
    let i = 0
    while (i < len) {
      const ch = input.charCodeAt(i)
      if (!isSpaceOrTabOrSegmentBreak(ch) && !isDiscardable(ch, is8bit)) {
        // A CR or FF is no white space to TransformText (:51-57), so it ends a white-space run and
        // stays in the text run, which gives it no glyph and no advance: it skips a control
        // character it doesn't draw as a hexbox, which is never CR and, in release and beta builds,
        // no other one either (gfxFont::SplitAndInitTextRun, gfxFont.cpp:3620-3627 and :3874-3892;
        // layout.css.control-characters.visible, StaticPrefList.yaml:10926-10929). Every Canvas
        // measures it as a space (Firefox's: CanvasRenderingContext2D.cpp:4634-4637), so a layout
        // of the source leaves it out. Kept as a control of no advance, as the profile keeps the
        // other controls Firefox hides (hidesControlCharacters), it is text at a line's edges,
        // where Firefox trims it, and takes text with CRLF off the simple line walk (RESEARCH.md,
        // Dead Ends). A CR right before a line feed needs no mark: the run that starts there keeps
        // that line feed, and the CR, a breakable space to the scan too, collapses into it.
        if (ch === 0x0c || (ch === 0x0d && input.charCodeAt(i + 1) !== 0x0a)) (leftOut ??= new Uint8Array(len))[i] = 1
        orig[n++] = i
        inWhitespace = false
        i++
        continue
      }
      if (isSpaceOrTabOrSegmentBreak(ch)) {
        let keepLastSpace = false
        let hasSegmentBreak = ch === 0x0a
        let trailingDiscardables = 0
        // How many characters the run holds that the text run drops.
        let dropped = 0
        let j = i + 1
        for (; j < len; j++) {
          const c = input.charCodeAt(j)
          if (c === 0x0a) hasSegmentBreak = true
          else if (isDiscardable(c, is8bit)) dropped++
          else if (!isSpaceOrTab(c)) break
        }
        while (isDiscardable(input.charCodeAt(j - 1), is8bit)) { j--; trailingDiscardables++ } // :334-336
        if (!is8bit && input.charCodeAt(j - 1) === 0x20 && j < len && isSpaceCombiningSequenceTail(input, j)) { keepLastSpace = true; j-- } // :339-345
        // TransformWhiteSpaces over [i, j), :84-209. The runs it deletes whole, next to a ZWSP or
        // between East Asian characters (:120-150), are gone already (removeSkippableSegmentBreaks in
        // src/analysis.ts), so a run keeps one space. A space or tab in a run with a segment break
        // goes (:152-162), and the run's first segment break stays as a space (:181-193).
        for (let k = i; k < j; k++) {
          const c = input.charCodeAt(k)
          if (isDiscardable(c, is8bit)) {
            skipped[k] = 1
            dropsBidiControl ||= c !== CH_SHY
          } else if (inWhitespace || (hasSegmentBreak && isSpaceOrTab(c))) {
            skipped[k] = 1
            // Where the run reads through a dropped character, white space it leaves out may not
            // touch the unit it keeps, so collapsing adjacent white space wouldn't drop it.
            if (dropped > trailingDiscardables) (leftOut ??= new Uint8Array(len))[k] = 1
          } else {
            orig[n++] = k
            inWhitespace = true
          }
        }
        if (keepLastSpace) orig[n++] = j++
        for (let k = 0; k < trailingDiscardables; k++) {
          dropsBidiControl ||= input.charCodeAt(j) !== CH_SHY
          skipped[j++] = 1
        }
        i = j
        continue
      }
      skipped[i] = 1 // :370-379
      dropsBidiControl ||= ch !== CH_SHY
      inWhitespace = false
      i++
    }
  }
  // The kept units, as slices of the input where they run unchanged: in collapsed white space, a kept
  // tab or segment break becomes a space.
  let text = ''
  let sliceStart = 0
  let sliceEnd = 0
  for (let k = 0; k < n; k++) {
    const i = orig[k]!
    const ch = input.charCodeAt(i)
    if (!preserveWhiteSpace && (ch === 0x09 || ch === 0x0a)) {
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
  text += input.slice(sliceStart, sliceEnd)
  return { text, orig: orig.subarray(0, n), skipped, leftOut, dropsBidiControl }
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

// --- 2. Text-run glyph records (gfxTextRun.cpp, gfxFont.cpp) ---
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
function setupClusterBoundaries(g: Glyphs, text: string, from: number, to: number, graphemeTable: GraphemeTable, ends: Int32Array): void {
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

// gfxFont::SplitAndInitTextRun, gfxFont.cpp:3707-3900: sets up the shaped words of the text run. A
// word ends at a space or NBSP before no cluster extender (IsBoundarySpace, :3317-3330) or at an
// invalid character (:3778-3790). A space glyph (SetSpaceGlyphIfSimple, gfxTextRun.cpp:1612-1619)
// only sets isSpace, and an invalid character (:3877-3892) keeps a zero record. Below U+0100,
// IsBoundarySpace and SetupClusterBoundaries(uint8_t) (gfxFont.cpp:771-795) answer as the char16_t
// versions, so 8-bit text and 8-bit words take the char16_t path, at any word length (:3569-3577,
// :3817-3821).
function splitAndInitTextRun(g: Glyphs, text: string, graphemeTable: GraphemeTable, ends: Int32Array): void {
  const end = text.length
  let wordStart = 0
  for (let i = 0; i < end; i++) {
    const ch = text.charCodeAt(i)
    const boundary = (ch === 0x20 || ch === 0xa0) && !(i + 1 < end && isClusterExtender(text.charCodeAt(i + 1)))
    if (!boundary && !isInvalidChar(ch)) continue
    if (i > wordStart) setupClusterBoundaries(g, text, wordStart, i, graphemeTable, ends)
    if (ch === 0x20) g.isSpace[i] = 1
    wordStart = i + 1
  }
  if (end > wordStart) setupClusterBoundaries(g, text, wordStart, end, graphemeTable, ends)
}

// --- 3. ICU4X 2.1.2's line iterator for one word (icu_segmenter src/line.rs) ---

// Firefox's line data, which the first scan unpacks (getGeckoLineBreaks).
type LineData = { readonly classes: ClassTable, readonly states: Uint8Array }
let lineData: LineData | null = null

// The Line_Break value, with error value 0 above U+10FFFF.
function getLineBreakClass(line: LineData, c: number): number {
  return c > 0x10ffff ? 0 : getClass(line.classes, c)
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

// Utf16Indices::next (indices.rs:58-83): the code point at text[i], in a pair that ends before `end`,
// or an unpaired surrogate as a code point of its own.
function readCodePoint(text: string, i: number, end: number): number {
  const c = text.charCodeAt(i)
  if ((c & 0xfc00) === 0xd800 && i + 1 < end) {
    const next = text.charCodeAt(i + 1)
    if ((next & 0xfc00) === 0xdc00) return ((c & 0x3ff) << 10) + (next & 0x3ff) + 0x10000
  }
  return c
}

// LineBreakIterator (line.rs:820-1130) over the word text[start, end), drained: state[start + p] = 1
// at each break p inside the word that Iterator::next returns (:833-1067), which starts at the
// word's first code point after the break at 0 and stops at the word's end. The position is
// Utf16Indices' front_offset and current_pos_data (:821-823): `pos` is the current code point's
// offset in the word, `cp` its code point and `front` the next one's offset, and `pos` reaches
// the word's length past its end.
function markWordBreaks(line: LineData, text: string, start: number, end: number, keepAll: boolean, state: Uint8Array): void {
  const len = end - start
  const states = line.states
  let pos = 0
  let cp = readCodePoint(text, start, end)
  let front = cp > 0xffff ? 2 : 1
  // Break points cached by a complex-script run, each less `cacheOffset`, from `cacheAt`.
  let cache: number[] = []
  let cacheAt = 0
  let cacheOffset = 0

  for (;;) {
    // Break points cached by a complex-script run (:840-855).
    if (cacheAt < cache.length) {
      const firstPos = cache[cacheAt++]! - cacheOffset
      let i = 0
      while (i !== firstPos) {
        i += cp > 0xffff ? 2 : 1 // Utf16::char_len (rule_segmenter.rs:335-341)
        pos = front
        if (pos >= len) return
        cp = readCodePoint(text, start + pos, end)
        front += cp > 0xffff ? 2 : 1
      }
      cacheOffset += i
      state[start + pos] = 1
      continue
    }

    let lb9Left = -1 // (:858)
    let lb8aAfterLb9 = false // (:861)
    outer: for (;;) {
      const leftCodepoint = cp
      const leftProp = lb9Left >= 0 ? lb9Left : getLineBreakClass(line, leftCodepoint)
      const afterZwj = lb8aAfterLb9 || (lb9Left < 0 && leftProp === ZWJ)
      pos = front
      if (pos >= len) return
      cp = readCodePoint(text, start + pos, end)
      front += cp > 0xffff ? 2 : 1
      const rightProp = getLineBreakClass(line, cp)

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
      if (keepAll && isKeepAllLetter(leftProp) && isKeepAllLetter(rightProp)) continue

      // Complex scripts (:941-950), Utf16 line_handle_complex_language (:1263-1316), which counts
      // code points one unit each: they are truncated to u16 there.
      if (getLineBreakClass(line, leftCodepoint) === SA && rightProp === SA) {
        const units = [leftCodepoint & 0xffff]
        for (let p = pos, c = cp; ;) {
          units.push(c & 0xffff)
          p += c > 0xffff ? 2 : 1
          if (p >= len) break
          c = readCodePoint(text, start + p, end)
          if (getLineBreakClass(line, c) !== SA) break
        }
        cache = segmentComplex(units)
        cacheAt = 1
        let i = 1
        while (i !== cache[0]) {
          i++
          pos = front
          if (pos >= len) return
          cp = readCodePoint(text, start + pos, end)
          front += cp > 0xffff ? 2 : 1
        }
        cacheOffset = i
        break
      }

      const breakState = states[leftProp * geckoLinePropertyCount + rightProp]! // (:702-706, 953)
      if (breakState === BREAK || breakState === NO_MATCH) {
        if (afterZwj) continue
        break
      }
      if (breakState === KEEP) continue

      let index = breakState >= INTERMEDIATE ? breakState - INTERMEDIATE : breakState
      let prevFront = front
      let prevPos = pos
      let prevCp = cp
      let previousIsAfterZwj = afterZwj
      let leftPropPreLb9 = rightProp
      // (:976-981), where lb8a_after_lb9 is false once LB9 has passed.
      const isIntermediateRuleNoMatch = index > geckoLineLastCodepointProperty

      for (;;) {
        const innerAfterZwj = leftPropPreLb9 === ZWJ
        const previousBreakStateIsCpProp = index <= geckoLineLastCodepointProperty
        pos = front
        if (pos >= len) { // (:990-1007)
          if (states[index * geckoLinePropertyCount + geckoLineEotProperty] !== NO_MATCH) return
          front = prevFront; pos = prevPos; cp = prevCp
          if (previousIsAfterZwj) continue outer
          break outer
        }
        cp = readCodePoint(text, start + pos, end)
        front += cp > 0xffff ? 2 : 1
        const prop = getLineBreakClass(line, cp)

        if ((prop === CM || prop === ZWJ) && leftPropPreLb9 !== BK && leftPropPreLb9 !== CR && leftPropPreLb9 !== LF &&
          leftPropPreLb9 !== NL && leftPropPreLb9 !== SP && leftPropPreLb9 !== ZW) { // (:1009-1019)
          leftPropPreLb9 = prop
          continue
        }

        const next = states[index * geckoLinePropertyCount + prop]! // (:1021-1061)
        if (next === KEEP) continue outer
        if (next === NO_MATCH) {
          front = prevFront; pos = prevPos; cp = prevCp
          if (innerAfterZwj) {
            if (isIntermediateRuleNoMatch && !previousIsAfterZwj) break outer
            continue outer
          }
          if (previousIsAfterZwj) continue outer
          break outer
        }
        if (next === BREAK) {
          if (innerAfterZwj) continue outer
          break outer
        }
        if (next >= INTERMEDIATE) {
          index = next - INTERMEDIATE
          prevFront = front; prevPos = pos; prevCp = cp
          previousIsAfterZwj = innerAfterZwj
        } else {
          index = next
          if (previousBreakStateIsCpProp) {
            prevFront = front; prevPos = pos; prevCp = cp
            previousIsAfterZwj = innerAfterZwj
          }
        }
        leftPropPreLb9 = prop
      }
    }
    state[start + pos] = 1
  }
}

// --- 4. nsLineBreaker (dom/base/nsLineBreaker.cpp) ---

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
function getBreakStates(line: LineData, text: string, is8bit: boolean, afterLeadingWhitespace: boolean, keepAll: boolean): Uint8Array {
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
    if (offset > wordStart && wordMightBeBreakable) markWordBreaks(line, text, wordStart, offset, keepAll, state)
    wordMightBeBreakable = false
    wordStart = offset + 1
  }
  return state
}

// Where a line may start in a text node's source, after the segment break transformation that
// removeSkippableSegmentBreaks applies: a BREAK at flags[i] for 0 < i < source.length, at a normal
// break (FLAG_BREAK_TYPE_NORMAL) or after a soft hyphen. gfxTextRun::SetPotentialLineBreaks
// (gfxTextRun.cpp:210-236) keeps a break only at a cluster start or after a space. A normal break
// right after a soft hyphen adds SOFT_HYPHEN_BREAK: BreakAndMeasureText takes it as the normal
// break, which neither fits nor draws a hyphen (gfxTextRun.cpp:1053-1063). A CLUSTER_START marks
// where a cluster starts without a break, where only break-word can wrap (gfxTextRun.cpp:1068-1074).
// The breaks, whether the text run left out a bidi control, and 1 at each unit that a layout of
// the source leaves out where collapsing each run of adjacent white space wouldn't, or null where
// there is none: white space the text run collapsed in a run that read past a character it drops,
// and, in normal white space, an FF or a CR that no line feed follows, which the text run keeps
// with no advance (transformText).
export type GeckoLineBreaks = { breaks: Uint8Array, leftOut: Uint8Array | null, dropsBidiControl: boolean }

export function getGeckoLineBreaks(
  source: string,
  preserveWhiteSpace: boolean,
  keepAll: boolean,
  graphemeTable: GraphemeTable,
): GeckoLineBreaks {
  const len = source.length
  const flags = new Uint8Array(len + 1)
  if (len === 0) return { breaks: flags, leftOut: null, dropsBidiControl: false }
  let is8bit = true
  for (let i = 0; i < len && is8bit; i++) is8bit = source.charCodeAt(i) < 0x100
  // CharacterDataBuffer::SetTo stores 1b text when every unit is below 256 (CharacterDataBuffer.cpp:235-286).
  const tr = transformText(source, is8bit, preserveWhiteSpace)
  const n = tr.text.length
  if (n === 0) return { breaks: flags, leftOut: null, dropsBidiControl: tr.dropsBidiControl }

  // The text run is built before the break sinks are set up (nsTextFrame.cpp:2860-2864), in one
  // piece: Firefox splits it where the bidi level changes, which the scan leaves out (above).
  const g: Glyphs = { clusterStart: new Uint8Array(n).fill(1), isSpace: new Uint8Array(n) }
  splitAndInitTextRun(g, tr.text, graphemeTable, new Int32Array(n))

  const line = lineData ??= { classes: unpackClasses('gecko/line'), states: unpackTable(geckoLineBreakStatesPacked) }
  const state = getBreakStates(line, tr.text, is8bit, hasCompressedLeadingWhitespace(source, tr.skipped, is8bit, preserveWhiteSpace), keepAll)
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
  return { breaks: flags, leftOut: tr.leftOut, dropsBidiControl: tr.dropsBidiControl }
}
