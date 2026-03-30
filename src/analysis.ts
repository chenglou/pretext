export type WhiteSpaceMode = 'normal' | 'pre-wrap'

export type SegmentBreakKind =
  | 'text'
  | 'space'
  | 'preserved-space'
  | 'tab'
  | 'glue'
  | 'zero-width-break'
  | 'soft-hyphen'
  | 'hard-break'

export type MergedSegmentation = {
  len: number
  texts: string[]
  isWordLike: boolean[]
  kinds: SegmentBreakKind[]
  starts: number[]
}

export type AnalysisChunk = {
  startSegmentIndex: number
  endSegmentIndex: number
  consumedEndSegmentIndex: number
}

export type TextAnalysis = { normalized: string, chunks: AnalysisChunk[] } & MergedSegmentation

export type AnalysisProfile = {
  carryCJKAfterClosingQuote: boolean
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

type WhiteSpaceProfile = {
  mode: WhiteSpaceMode
  preserveOrdinarySpaces: boolean
  preserveHardBreaks: boolean
}

// Pre-cached profiles — avoids allocating a new object per analyzeText() call.
const WS_PROFILE_NORMAL: WhiteSpaceProfile = { mode: 'normal', preserveOrdinarySpaces: false, preserveHardBreaks: false }
const WS_PROFILE_PRE_WRAP: WhiteSpaceProfile = { mode: 'pre-wrap', preserveOrdinarySpaces: true, preserveHardBreaks: true }

function getWhiteSpaceProfile(whiteSpace?: WhiteSpaceMode): WhiteSpaceProfile {
  return (whiteSpace ?? 'normal') === 'pre-wrap' ? WS_PROFILE_PRE_WRAP : WS_PROFILE_NORMAL
}

export function normalizeWhitespaceNormal(text: string): string {
  if (!needsWhitespaceNormalizationRe.test(text)) return text

  let normalized = text.replace(collapsibleWhitespaceRunRe, ' ')
  if (normalized.charCodeAt(0) === 0x20) {
    normalized = normalized.slice(1)
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 0x20) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function normalizeWhitespacePreWrap(text: string): string {
  if (!/[\r\f]/.test(text)) return text.replace(/\r\n/g, '\n')
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\r\f]/g, '\n')
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
  sharedWordSegmenter = null
}

export function setAnalysisLocale(locale?: string): void {
  const nextLocale = locale && locale.length > 0 ? locale : undefined
  if (segmenterLocale === nextLocale) return
  segmenterLocale = nextLocale
  sharedWordSegmenter = null
}

const combiningMarkRe = /\p{M}/u
const decimalDigitRe = /\p{Nd}/u

// Fast charCode-based test for Arabic script characters.
// Covers the main Arabic BMP blocks; avoids regex for common text.
function isArabicScriptCharCode(c: number): boolean {
  return (c >= 0x0600 && c <= 0x06FF) || // Arabic
    (c >= 0x0750 && c <= 0x077F) || // Arabic Supplement
    (c >= 0x08A0 && c <= 0x08FF) || // Arabic Extended-A
    (c >= 0xFB50 && c <= 0xFDFF) || // Arabic Presentation Forms-A
    (c >= 0xFE70 && c <= 0xFEFF) // Arabic Presentation Forms-B
}

function containsArabicScript(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isArabicScriptCharCode(text.charCodeAt(i))) return true
  }
  return false
}

// Fast charCode-based test for combining marks.
// Covers the most common BMP combining mark ranges used in
// Arabic, Devanagari, Thai, Myanmar, and Latin text.
function isCombiningMark(ch: string): boolean {
  const c = ch.charCodeAt(0)
  // Fast path: most common combining mark ranges
  if ((c >= 0x0300 && c <= 0x036F) || // Combining Diacritical Marks
      (c >= 0x0610 && c <= 0x061A) || // Arabic combining above
      (c >= 0x064B && c <= 0x065F) || // Arabic tashkeel
      c === 0x0670 ||                  // Arabic superscript alef
      (c >= 0x06D6 && c <= 0x06ED) || // Arabic extended combining
      (c >= 0x0900 && c <= 0x0903) || // Devanagari combining
      (c >= 0x093A && c <= 0x094F) || // Devanagari vowel signs
      (c >= 0x0951 && c <= 0x0957) || // Devanagari stress marks
      c === 0x0962 || c === 0x0963 || // Devanagari vowel sign vocalic
      c === 0x0E31 ||                  // Thai combining
      (c >= 0x0E34 && c <= 0x0E3A) || // Thai combining vowels
      (c >= 0x0E47 && c <= 0x0E4E) || // Thai combining marks
      c === 0x1039 || c === 0x103A || // Myanmar virama
      (c >= 0x103B && c <= 0x103E) || // Myanmar medials
      (c >= 0xFE20 && c <= 0xFE2F)) { // Combining Half Marks
    return true
  }
  // Fallback to regex for rare/extended combining marks
  return combiningMarkRe.test(ch)
}

export function isCJK(s: string): boolean {
  const len = s.length
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i)
    // BMP CJK ranges (most common)
    if ((c >= 0x4E00 && c <= 0x9FFF) ||
        (c >= 0x3400 && c <= 0x4DBF) ||
        (c >= 0x3000 && c <= 0x303F) ||
        (c >= 0x3040 && c <= 0x309F) ||
        (c >= 0x30A0 && c <= 0x30FF) ||
        (c >= 0xAC00 && c <= 0xD7AF) ||
        (c >= 0xFF00 && c <= 0xFFEF) ||
        (c >= 0xF900 && c <= 0xFAFF)) {
      return true
    }
    // Surrogate pair → decode astral code point
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < len) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        const cp = ((c - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
        if ((cp >= 0x20000 && cp <= 0x2A6DF) ||
            (cp >= 0x2A700 && cp <= 0x2B73F) ||
            (cp >= 0x2B740 && cp <= 0x2B81F) ||
            (cp >= 0x2B820 && cp <= 0x2CEAF) ||
            (cp >= 0x2CEB0 && cp <= 0x2EBEF) ||
            (cp >= 0x30000 && cp <= 0x3134F) ||
            (cp >= 0x2F800 && cp <= 0x2FA1F)) {
          return true
        }
        i++ // skip low surrogate
      }
    }
  }
  return false
}

export const kinsokuStart = new Set([
  '\uFF0C',
  '\uFF0E',
  '\uFF01',
  '\uFF1A',
  '\uFF1B',
  '\uFF1F',
  '\u3001',
  '\u3002',
  '\u30FB',
  '\uFF09',
  '\u3015',
  '\u3009',
  '\u300B',
  '\u300D',
  '\u300F',
  '\u3011',
  '\u3017',
  '\u3019',
  '\u301B',
  '\u30FC',
  '\u3005',
  '\u303B',
  '\u309D',
  '\u309E',
  '\u30FD',
  '\u30FE',
])

export const kinsokuEnd = new Set([
  '"',
  '(', '[', '{',
  '“', '‘', '«', '‹',
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

const arabicNoSpaceTrailingPunctuation = new Set([
  ':',
  '.',
  '\u060C',
  '\u061B',
])



const closingQuoteChars = new Set([
  '”', '’', '»', '›',
  '\u300D',
  '\u300F',
  '\u3011',
  '\u300B',
  '\u3009',
  '\u3015',
  '\uFF09',
])

function isLeftStickyPunctuationSegment(segment: string): boolean {
  // Fast path: single-char punctuation (most common case)
  if (segment.length === 1) return leftStickyPunctuation.has(segment)
  if (segment.length === 0) return false
  // Check for escaped quote cluster pattern
  if (isEscapedQuoteClusterSegment(segment)) return true
  // Multi-char: all chars must be punctuation or combining marks after punctuation
  let sawPunctuation = false
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (leftStickyPunctuation.has(ch)) {
      sawPunctuation = true
      continue
    }
    if (sawPunctuation && isCombiningMark(ch)) continue
    return false
  }
  return sawPunctuation
}

function isCJKLineStartProhibitedSegment(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (!kinsokuStart.has(ch) && !leftStickyPunctuation.has(ch)) return false
  }
  return segment.length > 0
}

function isForwardStickyClusterSegment(segment: string): boolean {
  if (segment.length === 0) return false
  // Fast path: single-char segments
  if (segment.length === 1) {
    return kinsokuEnd.has(segment) || forwardStickyGlue.has(segment)
  }
  if (isEscapedQuoteClusterSegment(segment)) return true
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (!kinsokuEnd.has(ch) && !forwardStickyGlue.has(ch) && !isCombiningMark(ch)) return false
  }
  return true
}

function isEscapedQuoteClusterSegment(segment: string): boolean {
  if (segment.length === 0) return false
  // Quick reject: first char must be \ or a quote/bracket character
  const first = segment[0]!
  if (first !== '\\' && !kinsokuEnd.has(first) && !leftStickyPunctuation.has(first) && !forwardStickyGlue.has(first)) {
    return false
  }
  let sawQuote = false
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (ch === '\\' || isCombiningMark(ch)) continue
    if (kinsokuEnd.has(ch) || leftStickyPunctuation.has(ch) || forwardStickyGlue.has(ch)) {
      sawQuote = true
      continue
    }
    return false
  }
  return sawQuote
}

function splitTrailingForwardStickyCluster(text: string): { head: string, tail: string } | null {
  let splitIndex = text.length

  while (splitIndex > 0) {
    const code = text.charCodeAt(splitIndex - 1)
    // Skip low surrogates — if previous char is a high surrogate, skip both
    if (code >= 0xDC00 && code <= 0xDFFF && splitIndex >= 2) {
      const hi = text.charCodeAt(splitIndex - 2)
      if (hi >= 0xD800 && hi <= 0xDBFF) {
        // This is an astral character — not a combining mark or kinsoku/glue char
        break
      }
    }
    const ch = text[splitIndex - 1]!
    if (isCombiningMark(ch)) {
      splitIndex--
      continue
    }
    if (kinsokuEnd.has(ch) || forwardStickyGlue.has(ch)) {
      splitIndex--
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

function isRepeatedSingleCharRun(segment: string, ch: string): boolean {
  if (segment.length === 0) return false
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] !== ch) return false
  }
  return true
}

function endsWithArabicNoSpacePunctuation(segment: string): boolean {
  if (segment.length === 0) return false
  // Check cheap trailing-char condition first, before the full Arabic scan
  if (!arabicNoSpaceTrailingPunctuation.has(segment[segment.length - 1]!)) return false
  return containsArabicScript(segment)
}


function splitLeadingSpaceAndMarks(segment: string): { space: string, marks: string } | null {
  if (segment.length < 2 || segment[0] !== ' ') return null
  const marks = segment.slice(1)
  // Check all characters are combining marks using fast isCombiningMark
  let allMarks = true
  for (let i = 0; i < marks.length; i++) {
    if (!isCombiningMark(marks[i]!)) {
      allMarks = false
      break
    }
  }
  if (allMarks) {
    return { space: ' ', marks }
  }
  return null
}

export function endsWithClosingQuote(text: string): boolean {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!
    if (closingQuoteChars.has(ch)) return true
    if (!leftStickyPunctuation.has(ch)) return false
  }
  return false
}

function classifySegmentBreakCharCode(code: number, whiteSpaceProfile: WhiteSpaceProfile): SegmentBreakKind {
  if (code === 0x20) { // space
    return whiteSpaceProfile.preserveOrdinarySpaces ? 'preserved-space' : 'space'
  }
  if (code === 0x09) { // tab
    return whiteSpaceProfile.preserveOrdinarySpaces ? 'tab' : 'text'
  }
  if (code === 0x0A) { // newline
    return whiteSpaceProfile.preserveHardBreaks ? 'hard-break' : 'text'
  }
  if (code === 0x00A0 || code === 0x202F || code === 0x2060 || code === 0xFEFF) {
    return 'glue'
  }
  if (code === 0x200B) return 'zero-width-break'
  if (code === 0x00AD) return 'soft-hyphen'
  return 'text'
}

// Fast check: does this segment contain any break-kind special characters?
// If not, the whole segment is a single 'text' piece and forEachBreakKindPiece can be skipped.
function segmentNeedsSplitting(segment: string): boolean {
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0A ||  // space, tab, newline
        c === 0x00A0 || c === 0x202F || c === 0x2060 || c === 0xFEFF ||  // NBSP, NNBSP, WJ, BOM
        c === 0x200B || c === 0x00AD) {  // ZWSP, SHY
      return true
    }
  }
  return false
}

// Segment splitting — emits pieces directly to a MergeBuilder.
// Avoids allocating a pieces array + piece objects and function-call overhead for callbacks.
function forEachBreakKindPiece(
  segment: string,
  start: number,
  whiteSpaceProfile: WhiteSpaceProfile,
  builder: MergeBuilder,
): void {
  let currentKind: SegmentBreakKind | null = null
  let runStart = 0
  let currentStart = start
  let currentWordLike = false
  const len = segment.length

  for (let i = 0; i < len; i++) {
    let code = segment.charCodeAt(i)
    let charLen = 1
    // Handle surrogate pairs — astral chars are always 'text'
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < len) {
      const lo = segment.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        code = 0x10000 // sentinel: any astral char → 'text'
        charLen = 2
      }
    }

    const kind = classifySegmentBreakCharCode(code, whiteSpaceProfile)
    const wordLike = kind === 'text' && builder.lastWordLike

    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike) {
      i += charLen - 1 // skip low surrogate if pair
      continue
    }

    if (currentKind !== null) {
      builder.addPiece(segment.slice(runStart, i), currentWordLike, currentKind, currentStart)
    }

    currentKind = kind
    runStart = i
    currentStart = start + i
    currentWordLike = wordLike
    i += charLen - 1 // skip low surrogate if pair
  }

  if (currentKind !== null) {
    builder.addPiece(segment.slice(runStart), currentWordLike, currentKind!, currentStart)
  }
}

function isTextRunBoundary(kind: SegmentBreakKind): boolean {
  return (
    kind === 'space' ||
    kind === 'preserved-space' ||
    kind === 'zero-width-break' ||
    kind === 'hard-break'
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

function mergeUrlLikeRunsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  let len = seg.len

  for (let i = 0; i < len; i++) {
    if (kinds[i] !== 'text' || !isUrlLikeRunStart(seg, i)) continue

    let j = i + 1
    while (j < len && !isTextRunBoundary(kinds[j]!)) {
      texts[i] += texts[j]!
      isWordLike[i] = true
      const endsQueryPrefix = texts[j]!.includes('?')
      texts[j] = ''
      j++
      if (endsQueryPrefix) break
    }
  }

  // Compact out empty entries
  let compactLen = 0
  for (let read = 0; read < len; read++) {
    const text = texts[read]!
    if (text.length === 0) continue
    if (compactLen !== read) {
      texts[compactLen] = text
      isWordLike[compactLen] = isWordLike[read]!
      kinds[compactLen] = kinds[read]!
      starts[compactLen] = starts[read]!
    }
    compactLen++
  }

  texts.length = compactLen
  isWordLike.length = compactLen
  kinds.length = compactLen
  starts.length = compactLen
  seg.len = compactLen
}

function mergeUrlQueryRunsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  let len = seg.len

  // We scan for URL query boundaries and merge subsequent runs.
  // Since merging can only reduce segments (or insert one merged query),
  // we can use a read/write cursor on the same arrays.
  // However, query merging could in theory need insertion. But actually
  // each query merge consumes N input segments and produces 1 output segment,
  // so write <= read always holds. We can do this in-place with a compacting pass.

  let write = 0
  for (let i = 0; i < len; i++) {
    const text = texts[i]!

    if (isUrlQueryBoundarySegment(text)) {
      // Copy current segment
      if (write !== i) {
        texts[write] = text
        isWordLike[write] = isWordLike[i]!
        kinds[write] = kinds[i]!
        starts[write] = starts[i]!
      }
      write++

      const nextIndex = i + 1
      if (
        nextIndex >= len ||
        isTextRunBoundary(kinds[nextIndex]!)
      ) {
        continue
      }

      // Merge subsequent non-boundary segments into one query segment
      let queryText = ''
      const queryStart = starts[nextIndex]!
      let j = nextIndex
      while (j < len && !isTextRunBoundary(kinds[j]!)) {
        queryText += texts[j]!
        j++
      }

      if (queryText.length > 0) {
        texts[write] = queryText
        isWordLike[write] = true
        kinds[write] = 'text'
        starts[write] = queryStart
        write++
        i = j - 1
      }
    } else {
      if (write !== i) {
        texts[write] = text
        isWordLike[write] = isWordLike[i]!
        kinds[write] = kinds[i]!
        starts[write] = starts[i]!
      }
      write++
    }
  }

  texts.length = write
  isWordLike.length = write
  kinds.length = write
  starts.length = write
  seg.len = write
}

const asciiPunctuationChainSegmentRe = /^[A-Za-z0-9_]+[,:;]*$/
const asciiPunctuationChainTrailingJoinersRe = /[,:;]+$/

function segmentContainsDecimalDigit(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // ASCII digits 0-9
    if (c >= 0x30 && c <= 0x39) return true
    // Common non-ASCII decimal digit ranges (Arabic-Indic, Devanagari, etc.)
    if (c >= 0x0660 && decimalDigitRe.test(text[i]!)) return true
  }
  return false
}

function isNumericRunSegment(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // ASCII digits
    if (c >= 0x30 && c <= 0x39) continue
    // Numeric joiner chars by charCode
    if (c === 0x3A || c === 0x2D || c === 0x2F || c === 0xD7 || // : - / ×
        c === 0x2C || c === 0x2E || c === 0x2B || // , . +
        c === 0x2013 || c === 0x2014) continue // en-dash, em-dash
    // Non-ASCII decimal digits
    if (c >= 0x0660 && decimalDigitRe.test(text[i]!)) continue
    return false
  }
  return true
}

function mergeNumericRunsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  const len = seg.len

  let write = 0
  for (let i = 0; i < len; i++) {
    const text = texts[i]!
    const kind = kinds[i]!

    if (kind === 'text' && isNumericRunSegment(text) && segmentContainsDecimalDigit(text)) {
      let mergedText = text
      let j = i + 1
      while (
        j < len &&
        kinds[j] === 'text' &&
        isNumericRunSegment(texts[j]!)
      ) {
        mergedText += texts[j]!
        j++
      }

      texts[write] = mergedText
      isWordLike[write] = true
      kinds[write] = 'text'
      starts[write] = starts[i]!
      write++
      i = j - 1
      continue
    }

    if (write !== i) {
      texts[write] = text
      isWordLike[write] = isWordLike[i]!
      kinds[write] = kind
      starts[write] = starts[i]!
    }
    write++
  }

  texts.length = write
  isWordLike.length = write
  kinds.length = write
  starts.length = write
  seg.len = write
}

function mergeAsciiPunctuationChainsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  const len = seg.len

  let write = 0
  for (let i = 0; i < len; i++) {
    const text = texts[i]!
    const kind = kinds[i]!
    const wordLike = isWordLike[i]!

    if (kind === 'text' && wordLike && asciiPunctuationChainSegmentRe.test(text)) {
      let mergedText = text
      let j = i + 1

      while (
        asciiPunctuationChainTrailingJoinersRe.test(mergedText) &&
        j < len &&
        kinds[j] === 'text' &&
        isWordLike[j] &&
        asciiPunctuationChainSegmentRe.test(texts[j]!)
      ) {
        mergedText += texts[j]!
        j++
      }

      texts[write] = mergedText
      isWordLike[write] = true
      kinds[write] = 'text'
      starts[write] = starts[i]!
      write++
      i = j - 1
      continue
    }

    if (write !== i) {
      texts[write] = text
      isWordLike[write] = wordLike
      kinds[write] = kind
      starts[write] = starts[i]!
    }
    write++
  }

  texts.length = write
  isWordLike.length = write
  kinds.length = write
  starts.length = write
  seg.len = write
}

function splitHyphenatedNumericRunsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  const len = seg.len

  // First pass: check if any splits are needed at all
  let needsSplit = false
  for (let i = 0; i < len; i++) {
    if (kinds[i] === 'text' && texts[i]!.includes('-')) {
      const text = texts[i]!
      const parts = text.split('-')
      if (parts.length > 1) {
        let allNumeric = true
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j]!
          if (part.length === 0 || !segmentContainsDecimalDigit(part) || !isNumericRunSegment(part)) {
            allNumeric = false
            break
          }
        }
        if (allNumeric) {
          needsSplit = true
          break
        }
      }
    }
  }

  if (!needsSplit) return

  // Slow path: allocate new arrays only when splits exist
  const newTexts: string[] = []
  const newWordLike: boolean[] = []
  const newKinds: SegmentBreakKind[] = []
  const newStarts: number[] = []

  for (let i = 0; i < len; i++) {
    const text = texts[i]!
    if (kinds[i] === 'text' && text.includes('-')) {
      const parts = text.split('-')
      let shouldSplit = parts.length > 1
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j]!
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
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j]!
          const splitText = j < parts.length - 1 ? `${part}-` : part
          newTexts.push(splitText)
          newWordLike.push(true)
          newKinds.push('text')
          newStarts.push(starts[i]! + offset)
          offset += splitText.length
        }
        continue
      }
    }

    newTexts.push(text)
    newWordLike.push(isWordLike[i]!)
    newKinds.push(kinds[i]!)
    newStarts.push(starts[i]!)
  }

  // Replace the arrays in the segmentation
  seg.texts = newTexts
  seg.isWordLike = newWordLike
  seg.kinds = newKinds
  seg.starts = newStarts
  seg.len = newTexts.length
}

function mergeGlueConnectedTextRunsInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const isWordLike = seg.isWordLike
  const kinds = seg.kinds
  const starts = seg.starts
  const len = seg.len

  let write = 0
  let read = 0
  while (read < len) {
    let text = texts[read]!
    let wordLike = isWordLike[read]!
    let kind = kinds[read]!
    let start = starts[read]!

    if (kind === 'glue') {
      let glueText = text
      const glueStart = start
      read++
      while (read < len && kinds[read] === 'glue') {
        glueText += texts[read]!
        read++
      }

      if (read < len && kinds[read] === 'text') {
        text = glueText + texts[read]!
        wordLike = isWordLike[read]!
        kind = 'text'
        start = glueStart
        read++
      } else {
        texts[write] = glueText
        isWordLike[write] = false
        kinds[write] = 'glue'
        starts[write] = glueStart
        write++
        continue
      }
    } else {
      read++
    }

    if (kind === 'text') {
      while (read < len && kinds[read] === 'glue') {
        let glueText = ''
        while (read < len && kinds[read] === 'glue') {
          glueText += texts[read]!
          read++
        }

        if (read < len && kinds[read] === 'text') {
          text += glueText + texts[read]!
          wordLike = wordLike || isWordLike[read]!
          read++
          continue
        }

        text += glueText
      }
    }

    texts[write] = text
    isWordLike[write] = wordLike
    kinds[write] = kind
    starts[write] = start
    write++
  }

  texts.length = write
  isWordLike.length = write
  kinds.length = write
  starts.length = write
  seg.len = write
}

function carryTrailingForwardStickyAcrossCJKBoundaryInPlace(seg: MergedSegmentation): void {
  const texts = seg.texts
  const kinds = seg.kinds
  const starts = seg.starts

  for (let i = 0; i < seg.len - 1; i++) {
    if (kinds[i] !== 'text' || kinds[i + 1] !== 'text') continue
    if (!isCJK(texts[i]!) || !isCJK(texts[i + 1]!)) continue

    const split = splitTrailingForwardStickyCluster(texts[i]!)
    if (split === null) continue

    texts[i] = split.head
    texts[i + 1] = split.tail + texts[i + 1]!
    starts[i + 1] = starts[i]! + split.head.length
  }
}

// Reusable builder avoids closure allocation per buildMergedSegmentation call.
// V8 sees a stable hidden class for the method dispatch.
// Content-presence flags allow skipping post-merge passes that can't fire.
class MergeBuilder {
  texts: string[] = []
  isWordLike: boolean[] = []
  kinds: SegmentBreakKind[] = []
  starts: number[] = []
  len = 0
  carryCJK = false
  lastWordLike = false
  // Content-presence flags — set during addPiece, used to skip post-merge passes
  hasGlue = false
  hasCJK = false
  hasArabicSpace = false
  // Set when a non-word text segment is pushed that could be an escaped-quote or forward-sticky cluster.
  // When false, the escaped-quote/forward-sticky/compact post-passes can be skipped entirely.
  hasNonWordTextSegment = false

  reset(carryCJK: boolean): void {
    // Create fresh arrays — previous arrays are owned by the returned MergedSegmentation
    this.texts = []
    this.isWordLike = []
    this.kinds = []
    this.starts = []
    this.len = 0
    this.carryCJK = carryCJK
    this.hasGlue = false
    this.hasCJK = false
    this.hasArabicSpace = false
    this.hasNonWordTextSegment = false
  }

  addPiece(pieceText: string, pieceWordLike: boolean, pieceKind: SegmentBreakKind, pieceStart: number): void {
    const len = this.len

    // Track content presence for post-merge pass skipping
    if (pieceKind === 'glue') {
      this.hasGlue = true
    } else if (pieceKind === 'space' || pieceKind === 'preserved-space') {
      // Track if we have space + following Arabic pattern
      this.hasArabicSpace = true
    }

    // Fast path: try to merge into previous text segment
    if (pieceKind === 'text' && len > 0 && this.kinds[len - 1] === 'text') {
      const prevText = this.texts[len - 1]!

      if (pieceWordLike) {
        // Word-like text piece — check Arabic no-space punctuation merge
        if (
          containsArabicScript(pieceText) &&
          endsWithArabicNoSpacePunctuation(prevText)
        ) {
          this.texts[len - 1] += pieceText
          this.isWordLike[len - 1] = true
          return
        }
      } else {
        // Non-word-like text piece — check left-sticky punctuation, repeated chars
        if (
          isLeftStickyPunctuationSegment(pieceText) ||
          (pieceText === '-' && this.isWordLike[len - 1]!)
        ) {
          this.texts[len - 1] += pieceText
          return
        }
        if (
          pieceText.length === 1 &&
          pieceText !== '-' &&
          pieceText !== '\u2014' &&
          isRepeatedSingleCharRun(prevText, pieceText)
        ) {
          this.texts[len - 1] += pieceText
          return
        }
      }

      // CJK kinsoku: line-start prohibited merge
      if (
        isCJKLineStartProhibitedSegment(pieceText) &&
        isCJK(prevText)
      ) {
        this.texts[len - 1] += pieceText
        this.isWordLike[len - 1] = this.isWordLike[len - 1]! || pieceWordLike
        this.hasCJK = true
        return
      }

      // CJK after closing quote (Chromium profile only)
      if (
        this.carryCJK &&
        isCJK(pieceText) &&
        isCJK(prevText) &&
        endsWithClosingQuote(prevText)
      ) {
        this.texts[len - 1] += pieceText
        this.isWordLike[len - 1] = this.isWordLike[len - 1]! || pieceWordLike
        this.hasCJK = true
        return
      }

      // Myanmar medial glue — check last char code directly
      if (prevText.charCodeAt(prevText.length - 1) === 0x104F) {
        this.texts[len - 1] += pieceText
        this.isWordLike[len - 1] = this.isWordLike[len - 1]! || pieceWordLike
        return
      }
    }

    // Track non-word text segments that survive the merge loop —
    // only these can trigger the escaped-quote/forward-sticky post-passes
    if (pieceKind === 'text' && !pieceWordLike) {
      this.hasNonWordTextSegment = true
    }

    // No merge — push new segment
    this.texts[len] = pieceText
    this.isWordLike[len] = pieceWordLike
    this.kinds[len] = pieceKind
    this.starts[len] = pieceStart
    this.len = len + 1
  }
}

// Module-level singleton — reused across calls.
const mergeBuilder = new MergeBuilder()

function buildMergedSegmentation(
  normalized: string,
  profile: AnalysisProfile,
  whiteSpaceProfile: WhiteSpaceProfile,
): MergedSegmentation {
  const wordSegmenter = getSharedWordSegmenter()
  const builder = mergeBuilder
  builder.reset(profile.carryCJKAfterClosingQuote)

  const segments = wordSegmenter.segment(normalized)
  const iter = segments[Symbol.iterator]()

  // Pre-scan normalized text for content-presence flags.
  // These are cheap string searches that allow skipping entire post-merge passes.
  let hasUrlLikeContent = false
  let hasDigit = false
  let hasAsciiChainJoiner = false
  for (let si = 0; si < normalized.length; si++) {
    const c = normalized.charCodeAt(si)
    if (!hasDigit && c >= 0x30 && c <= 0x39) hasDigit = true
    if (!hasAsciiChainJoiner && (c === 0x3B || c === 0x2C) && si > 0) hasAsciiChainJoiner = true // ; or , (not leading)
    if (!hasUrlLikeContent && c === 0x3A && si + 2 < normalized.length && // ':'
        normalized.charCodeAt(si + 1) === 0x2F && normalized.charCodeAt(si + 2) === 0x2F) { // '://'
      hasUrlLikeContent = true
    }
    if (hasDigit && hasAsciiChainJoiner && hasUrlLikeContent) break
  }
  // Also check for 'www.' prefix which doesn't need '://'
  if (!hasUrlLikeContent && normalized.length >= 4) {
    // Check if 'www.' appears at start or after a space
    if (normalized.charCodeAt(0) === 0x77 && normalized.charCodeAt(1) === 0x77 &&
        normalized.charCodeAt(2) === 0x77 && normalized.charCodeAt(3) === 0x2E) {
      hasUrlLikeContent = true
    } else {
      for (let si = 1; si < normalized.length - 4; si++) {
        if (normalized.charCodeAt(si) === 0x20 && // space before 'www.'
            normalized.charCodeAt(si + 1) === 0x77 && normalized.charCodeAt(si + 2) === 0x77 &&
            normalized.charCodeAt(si + 3) === 0x77 && normalized.charCodeAt(si + 4) === 0x2E) {
          hasUrlLikeContent = true
          break
        }
      }
    }
  }
  // Check for non-ASCII digits if no ASCII digit found
  if (!hasDigit) {
    for (let si = 0; si < normalized.length; si++) {
      const c = normalized.charCodeAt(si)
      if (c >= 0x0660 && c <= 0x0669) { hasDigit = true; break } // Arabic-Indic
      if (c >= 0x0966 && c <= 0x096F) { hasDigit = true; break } // Devanagari
      if (c >= 0x09E6 && c <= 0x09EF) { hasDigit = true; break } // Bengali
    }
  }

  for (let r = iter.next(); !r.done; r = iter.next()) {
    const s = r.value
    const seg = s.segment
    const wordLike = s.isWordLike === true
    // Fast path: if segment has no special chars, emit as single 'text' piece
    if (!segmentNeedsSplitting(seg)) {
      builder.addPiece(seg, wordLike, 'text', s.index)
    } else {
      builder.lastWordLike = wordLike
      forEachBreakKindPiece(seg, s.index, whiteSpaceProfile, builder)
    }
  }

  const mergedTexts = builder.texts
  const mergedWordLike = builder.isWordLike
  const mergedKinds = builder.kinds
  const mergedStarts = builder.starts
  let mergedLen = builder.len

  // Escaped-quote backward merge + forward-sticky carry + compact pass:
  // Only needed when non-word text segments survived the initial merge loop.
  if (builder.hasNonWordTextSegment) {
    for (let i = 1; i < mergedLen; i++) {
      if (
        mergedKinds[i] === 'text' &&
        !mergedWordLike[i]! &&
        isEscapedQuoteClusterSegment(mergedTexts[i]!) &&
        mergedKinds[i - 1] === 'text'
      ) {
        mergedTexts[i - 1] += mergedTexts[i]!
        mergedWordLike[i - 1] = mergedWordLike[i - 1]! || mergedWordLike[i]!
        mergedTexts[i] = ''
      }
    }

    for (let i = mergedLen - 2; i >= 0; i--) {
      if (mergedKinds[i] === 'text' && !mergedWordLike[i]! && isForwardStickyClusterSegment(mergedTexts[i]!)) {
        let j = i + 1
        while (j < mergedLen && mergedTexts[j] === '') j++
        if (j < mergedLen && mergedKinds[j] === 'text') {
          mergedTexts[j] = mergedTexts[i]! + mergedTexts[j]!
          mergedStarts[j] = mergedStarts[i]!
          mergedTexts[i] = ''
        }
      }
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
    mergedLen = compactLen
  }

  // Truncate builder arrays to final length — ownership transfers to the MergedSegmentation.
  // The next reset() call will create fresh arrays for the builder.
  mergedTexts.length = mergedLen
  mergedWordLike.length = mergedLen
  mergedKinds.length = mergedLen
  mergedStarts.length = mergedLen

  const seg: MergedSegmentation = {
    len: mergedLen,
    texts: mergedTexts,
    isWordLike: mergedWordLike,
    kinds: mergedKinds,
    starts: mergedStarts,
  }

  // Skip post-merge passes that can't fire based on content-presence flags.
  if (builder.hasGlue) mergeGlueConnectedTextRunsInPlace(seg)
  if (hasUrlLikeContent) {
    mergeUrlLikeRunsInPlace(seg)
    mergeUrlQueryRunsInPlace(seg)
  }
  if (hasDigit) {
    mergeNumericRunsInPlace(seg)
    splitHyphenatedNumericRunsInPlace(seg)
  }
  if (hasAsciiChainJoiner) mergeAsciiPunctuationChainsInPlace(seg)
  if (builder.hasCJK) carryTrailingForwardStickyAcrossCJKBoundaryInPlace(seg)

  if (builder.hasArabicSpace) {
    for (let i = 0; i < seg.len - 1; i++) {
      const split = splitLeadingSpaceAndMarks(seg.texts[i]!)
      if (split === null) continue
      if (
        (seg.kinds[i] !== 'space' && seg.kinds[i] !== 'preserved-space') ||
        seg.kinds[i + 1] !== 'text' ||
        !containsArabicScript(seg.texts[i + 1]!)
      ) {
        continue
      }

      seg.texts[i] = split.space
      seg.isWordLike[i] = false
      seg.kinds[i] = seg.kinds[i] === 'preserved-space' ? 'preserved-space' : 'space'
      seg.texts[i + 1] = split.marks + seg.texts[i + 1]!
      seg.starts[i + 1] = seg.starts[i]! + split.space.length
    }
  }

  return seg
}

function compileAnalysisChunks(segmentation: MergedSegmentation, whiteSpaceProfile: WhiteSpaceProfile): AnalysisChunk[] {
  if (segmentation.len === 0) return []
  if (!whiteSpaceProfile.preserveHardBreaks) {
    return [{
      startSegmentIndex: 0,
      endSegmentIndex: segmentation.len,
      consumedEndSegmentIndex: segmentation.len,
    }]
  }

  const chunks: AnalysisChunk[] = []
  let startSegmentIndex = 0

  for (let i = 0; i < segmentation.len; i++) {
    if (segmentation.kinds[i] !== 'hard-break') continue

    chunks.push({
      startSegmentIndex,
      endSegmentIndex: i,
      consumedEndSegmentIndex: i + 1,
    })
    startSegmentIndex = i + 1
  }

  if (startSegmentIndex < segmentation.len) {
    chunks.push({
      startSegmentIndex,
      endSegmentIndex: segmentation.len,
      consumedEndSegmentIndex: segmentation.len,
    })
  }

  return chunks
}

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
): TextAnalysis {
  const whiteSpaceProfile = getWhiteSpaceProfile(whiteSpace)
  const normalized = whiteSpaceProfile.mode === 'pre-wrap'
    ? normalizeWhitespacePreWrap(text)
    : normalizeWhitespaceNormal(text)
  if (normalized.length === 0) {
    return {
      normalized,
      chunks: [],
      len: 0,
      texts: [],
      isWordLike: [],
      kinds: [],
      starts: [],
    }
  }
  const segmentation = buildMergedSegmentation(normalized, profile, whiteSpaceProfile)
  return {
    normalized,
    chunks: compileAnalysisChunks(segmentation, whiteSpaceProfile),
    len: segmentation.len,
    texts: segmentation.texts,
    isWordLike: segmentation.isWordLike,
    kinds: segmentation.kinds,
    starts: segmentation.starts,
  }
}
