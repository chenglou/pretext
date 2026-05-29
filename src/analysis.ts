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

export type AnalysisChunk = {
  startSegmentIndex: number
  endSegmentIndex: number
  consumedEndSegmentIndex: number
}

export type TextAnalysis = { normalized: string, chunks: AnalysisChunk[] } & MergedSegmentation

export type AnalysisProfile = {
  carryCJKAfterClosingQuote: boolean
  breakKeepAllAfterPunctuation: boolean
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

type WhiteSpaceProfile = {
  mode: WhiteSpaceMode
  preserveOrdinarySpaces: boolean
  preserveHardBreaks: boolean
}

function getWhiteSpaceProfile(whiteSpace?: WhiteSpaceMode): WhiteSpaceProfile {
  const mode = whiteSpace ?? 'normal'
  return mode === 'pre-wrap'
    ? { mode, preserveOrdinarySpaces: true, preserveHardBreaks: true }
    : { mode, preserveOrdinarySpaces: false, preserveHardBreaks: false }
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
  if (!/[\r\f]/.test(text)) return text
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

const arabicScriptRe = /\p{Script=Arabic}/u
const combiningMarkRe = /\p{M}/u
const decimalDigitRe = /\p{Nd}/u

function containsArabicScript(text: string): boolean {
  return arabicScriptRe.test(text)
}

function isCJKCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
    (codePoint >= 0x20000 && codePoint <= 0x2A6DF) ||
    (codePoint >= 0x2A700 && codePoint <= 0x2B73F) ||
    (codePoint >= 0x2B740 && codePoint <= 0x2B81F) ||
    (codePoint >= 0x2B820 && codePoint <= 0x2CEAF) ||
    (codePoint >= 0x2CEB0 && codePoint <= 0x2EBEF) ||
    (codePoint >= 0x2EBF0 && codePoint <= 0x2EE5D) ||
    (codePoint >= 0x2F800 && codePoint <= 0x2FA1F) ||
    (codePoint >= 0x30000 && codePoint <= 0x3134F) ||
    (codePoint >= 0x31350 && codePoint <= 0x323AF) ||
    (codePoint >= 0x323B0 && codePoint <= 0x33479) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0x3000 && codePoint <= 0x303F) ||
    (codePoint >= 0x3040 && codePoint <= 0x309F) ||
    (codePoint >= 0x30A0 && codePoint <= 0x30FF) ||
    (codePoint >= 0x3130 && codePoint <= 0x318F) ||
    (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||
    (codePoint >= 0xFF00 && codePoint <= 0xFFEF)
  )
}

export function isCJK(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const first = s.charCodeAt(i)
    if (first < 0x3000) continue

    if (first >= 0xD800 && first <= 0xDBFF && i + 1 < s.length) {
      const second = s.charCodeAt(i + 1)
      if (second >= 0xDC00 && second <= 0xDFFF) {
        const codePoint = ((first - 0xD800) << 10) + (second - 0xDC00) + 0x10000
        if (isCJKCodePoint(codePoint)) return true
        i++
        continue
      }
    }

    if (isCJKCodePoint(first)) return true
  }
  return false
}

function endsWithLineStartProhibitedText(text: string): boolean {
  const last = getLastCodePoint(text)
  return last !== null && (kinsokuStart.has(last) || leftStickyPunctuation.has(last))
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

export function canContinueKeepAllTextRun(previousText: string, breakAfterPunctuation: boolean): boolean {
  if (endsWithKeepAllGlueText(previousText)) return false
  if (!breakAfterPunctuation) return true
  if (endsWithLineStartProhibitedText(previousText)) return false
  if (endsWithKeepAllDashBreakText(previousText)) return false
  return true
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

const arabicNoSpaceTrailingPunctuation = new Set([
  ':',
  '.',
  '\u060C',
  '\u061B',
])

const myanmarMedialGlue = new Set([
  '\u104F',
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
  if (isEscapedQuoteClusterSegment(segment)) return true
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

function isCJKLineStartProhibitedSegment(segment: string): boolean {
  for (const ch of segment) {
    if (!kinsokuStart.has(ch) && !leftStickyPunctuation.has(ch)) return false
  }
  return segment.length > 0
}

function isForwardStickyClusterSegment(segment: string): boolean {
  if (isEscapedQuoteClusterSegment(segment)) return true
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

function isEscapedQuoteClusterSegment(segment: string): boolean {
  let sawQuote = false
  for (const ch of segment) {
    if (ch === '\\' || combiningMarkRe.test(ch)) continue
    if (kinsokuEnd.has(ch) || leftStickyPunctuation.has(ch) || forwardStickyGlue.has(ch)) {
      sawQuote = true
      continue
    }
    return false
  }
  return sawQuote
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

function getLastSignificantCodePoint(text: string): string | null {
  for (let end = text.length; end > 0;) {
    const start = previousCodePointStart(text, end)
    const ch = text.slice(start, end)
    if (!combiningMarkRe.test(ch)) return ch
    end = start
  }
  return null
}

// Unicode line-break PR/PO classes from UAX #14, stored as start/end pairs.
const lineBreakNumericAffixRanges = [
  0x0024, 0x0025, 0x002B, 0x002B, 0x005C, 0x005C, 0x00A2, 0x00A5, 0x00B0, 0x00B1,
  0x058F, 0x058F, 0x0609, 0x060B, 0x066A, 0x066A, 0x07FE, 0x07FF, 0x09F2, 0x09F3,
  0x09F9, 0x09FB, 0x0AF1, 0x0AF1, 0x0BF9, 0x0BF9, 0x0D79, 0x0D79, 0x0E3F, 0x0E3F,
  0x17DB, 0x17DB, 0x2030, 0x2037, 0x2057, 0x2057, 0x20A0, 0x20CF, 0x2103, 0x2103,
  0x2109, 0x2109, 0x2116, 0x2116, 0x2212, 0x2213, 0xA838, 0xA838, 0xFDFC, 0xFDFC,
  0xFE69, 0xFE6A, 0xFF04, 0xFF05, 0xFFE0, 0xFFE1, 0xFFE5, 0xFFE6,
  0x11FDD, 0x11FE0, 0x1E2FF, 0x1E2FF, 0x1ECAC, 0x1ECAC, 0x1ECB0, 0x1ECB0,
] as const

function isCodePointInRanges(codePoint: number, ranges: readonly number[]): boolean {
  for (let i = 0; i < ranges.length; i += 2) {
    if (codePoint >= ranges[i]! && codePoint <= ranges[i + 1]!) return true
  }
  return false
}

function isLineBreakNumericAffix(ch: string): boolean {
  const codePoint = ch.codePointAt(0)
  return codePoint !== undefined && isCodePointInRanges(codePoint, lineBreakNumericAffixRanges)
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
  const chars = Array.from(text)
  let splitIndex = chars.length

  while (splitIndex > 0) {
    const ch = chars[splitIndex - 1]!
    if (combiningMarkRe.test(ch)) {
      splitIndex--
      continue
    }
    if (kinsokuEnd.has(ch) || forwardStickyGlue.has(ch)) {
      splitIndex--
      continue
    }
    break
  }

  if (splitIndex <= 0 || splitIndex === chars.length) return null
  return {
    head: chars.slice(0, splitIndex).join(''),
    tail: chars.slice(splitIndex).join(''),
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

function materializeDeferredSingleCharRun(
  texts: string[],
  chars: (string | null)[],
  lengths: number[],
  index: number,
): string {
  const ch = chars[index]
  const text = texts[index]!
  if (ch == null) return text

  const length = lengths[index]!
  if (text.length === length) return text

  const materialized = ch.repeat(length)
  texts[index] = materialized
  return materialized
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

function classifySegmentBreakChar(ch: string, whiteSpaceProfile: WhiteSpaceProfile): SegmentBreakKind {
  if (whiteSpaceProfile.preserveOrdinarySpaces || whiteSpaceProfile.preserveHardBreaks) {
    if (ch === ' ') return 'preserved-space'
    if (ch === '\t') return 'tab'
    if (whiteSpaceProfile.preserveHardBreaks && ch === '\n') return 'hard-break'
  }
  if (ch === ' ') return 'space'
  if (ch === '\u00A0' || ch === '\u202F' || ch === '\u2060' || ch === '\uFEFF') {
    return 'glue'
  }
  if (ch === '\u200B') return 'zero-width-break'
  if (ch === '\u00AD') return 'soft-hyphen'
  return 'text'
}

// All characters that classifySegmentBreakChar maps to a non-'text' kind.
const breakCharRe = /[\x20\t\n\xA0\xAD\u200B\u202F\u2060\uFEFF]/

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

function splitSegmentByBreakKind(
  segment: string,
  isWordLike: boolean,
  start: number,
  whiteSpaceProfile: WhiteSpaceProfile,
): SegmentationPiece[] {
  if (!breakCharRe.test(segment)) {
    return [{ text: segment, isWordLike, kind: 'text', start }]
  }

  const pieces: SegmentationPiece[] = []
  let currentKind: SegmentBreakKind | null = null
  let currentTextParts: string[] = []
  let currentStart = start
  let currentWordLike = false
  let offset = 0

  for (const ch of segment) {
    const kind = classifySegmentBreakChar(ch, whiteSpaceProfile)
    const wordLike = kind === 'text' && isWordLike

    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike) {
      currentTextParts.push(ch)
      offset += ch.length
      continue
    }

    if (currentKind !== null) {
      pieces.push({
        text: joinTextParts(currentTextParts),
        isWordLike: currentWordLike,
        kind: currentKind,
        start: currentStart,
      })
    }

    currentKind = kind
    currentTextParts = [ch]
    currentStart = start + offset
    currentWordLike = wordLike
    offset += ch.length
  }

  if (currentKind !== null) {
    pieces.push({
      text: joinTextParts(currentTextParts),
      isWordLike: currentWordLike,
      kind: currentKind,
      start: currentStart,
    })
  }

  return pieces
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

function mergeUrlLikeRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts = segmentation.texts.slice()
  const isWordLike = segmentation.isWordLike.slice()
  const kinds = segmentation.kinds.slice()
  const starts = segmentation.starts.slice()

  for (let i = 0; i < segmentation.len; i++) {
    if (kinds[i] !== 'text' || !isUrlLikeRunStart(segmentation, i)) continue

    const mergedParts = [texts[i]!]
    let j = i + 1
    while (j < segmentation.len && !isTextRunBoundary(kinds[j]!)) {
      mergedParts.push(texts[j]!)
      isWordLike[i] = true
      const endsQueryPrefix = texts[j]!.includes('?')
      kinds[j] = 'text'
      texts[j] = ''
      j++
      if (endsQueryPrefix) break
    }
    texts[i] = joinTextParts(mergedParts)
  }

  let compactLen = 0
  for (let read = 0; read < texts.length; read++) {
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

  return {
    len: compactLen,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function mergeUrlQueryRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    texts.push(text)
    isWordLike.push(segmentation.isWordLike[i]!)
    kinds.push(segmentation.kinds[i]!)
    starts.push(segmentation.starts[i]!)

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
    while (j < segmentation.len && !isTextRunBoundary(segmentation.kinds[j]!)) {
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

function canJoinNoSpaceWordBoundary(
  leftText: string,
  leftWordLike: boolean,
  rightText: string,
  rightWordLike: boolean,
): boolean {
  const leftSymbol = !leftWordLike && isNoSpaceWordInternalSymbolSegment(leftText)
  const rightSymbol = !rightWordLike && isNoSpaceWordInternalSymbolSegment(rightText)
  const leftAffix = endsWithLineBreakNumericAffix(leftText)
  const leftEndsJoiner = (leftWordLike || leftAffix) && endsWithNoSpaceWordJoiner(leftText)

  if (!leftSymbol && !rightSymbol && !leftEndsJoiner) return false
  if (isCJK(leftText) || isCJK(rightText)) return false

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

function mergeNumericRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    const kind = segmentation.kinds[i]!

    if (kind === 'text' && isNumericRunSegment(text) && segmentContainsDecimalDigit(text)) {
      const mergedParts = [text]
      let j = i + 1
      while (
        j < segmentation.len &&
        segmentation.kinds[j] === 'text' &&
        isNumericRunSegment(segmentation.texts[j]!)
      ) {
        mergedParts.push(segmentation.texts[j]!)
        j++
      }

      texts.push(joinTextParts(mergedParts))
      isWordLike.push(true)
      kinds.push('text')
      starts.push(segmentation.starts[i]!)
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

function mergeNoSpaceWordChains(segmentation: MergedSegmentation): MergedSegmentation {
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
        canJoinNoSpaceWordBoundary(
          segmentation.texts[j - 1]!,
          segmentation.isWordLike[j - 1]!,
          segmentation.texts[j]!,
          segmentation.isWordLike[j]!,
        )
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

function splitHyphenatedNumericRuns(segmentation: MergedSegmentation): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    if (segmentation.kinds[i] === 'text' && text.includes('-')) {
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
          texts.push(splitText)
          isWordLike.push(true)
          kinds.push('text')
          starts.push(segmentation.starts[i]! + offset)
          offset += splitText.length
        }
        continue
      }
    }

    texts.push(text)
    isWordLike.push(segmentation.isWordLike[i]!)
    kinds.push(segmentation.kinds[i]!)
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

function carryTrailingForwardStickyAcrossCJKBoundary(segmentation: MergedSegmentation): MergedSegmentation {
  const texts = segmentation.texts.slice()
  const isWordLike = segmentation.isWordLike.slice()
  const kinds = segmentation.kinds.slice()
  const starts = segmentation.starts.slice()

  for (let i = 0; i < texts.length - 1; i++) {
    if (kinds[i] !== 'text' || kinds[i + 1] !== 'text') continue
    if (!isCJK(texts[i]!) || !isCJK(texts[i + 1]!)) continue

    const split = splitTrailingForwardStickyCluster(texts[i]!)
    if (split === null) continue

    texts[i] = split.head
    texts[i + 1] = split.tail + texts[i + 1]!
    starts[i + 1] = starts[i]! + split.head.length
  }

  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts,
  }
}

function buildMergedSegmentation(
  normalized: string,
  profile: AnalysisProfile,
  whiteSpaceProfile: WhiteSpaceProfile,
): MergedSegmentation {
  const wordSegmenter = getSharedWordSegmenter()
  let mergedLen = 0
  const mergedTexts: string[] = []
  const mergedTextParts: string[][] = []
  const mergedWordLike: boolean[] = []
  const mergedKinds: SegmentBreakKind[] = []
  const mergedStarts: number[] = []
  // Track repeatable single-char punctuation runs structurally so identical
  // merges stay O(1) instead of re-scanning the accumulated segment each time.
  const mergedSingleCharRunChars: (string | null)[] = []
  const mergedSingleCharRunLengths: number[] = []
  const mergedContainsCJK: boolean[] = []
  const mergedContainsArabicScript: boolean[] = []
  const mergedEndsWithClosingQuote: boolean[] = []
  const mergedEndsWithMyanmarMedialGlue: boolean[] = []
  const mergedHasArabicNoSpacePunctuation: boolean[] = []

  for (const s of wordSegmenter.segment(normalized)) {
    for (const piece of splitSegmentByBreakKind(s.segment, s.isWordLike ?? false, s.index, whiteSpaceProfile)) {
      const isText = piece.kind === 'text'
      const repeatableSingleCharRunChar = getRepeatableSingleCharRunChar(piece.text, piece.isWordLike, piece.kind)
      const pieceContainsCJK = isCJK(piece.text)
      const pieceContainsArabicScript = containsArabicScript(piece.text)
      const pieceLastCodePoint = getLastCodePoint(piece.text)
      const pieceEndsWithClosingQuote = endsWithClosingQuote(piece.text)
      const pieceEndsWithMyanmarMedialGlue = endsWithMyanmarMedialGlue(piece.text)
      const prevIndex = mergedLen - 1

      function appendPieceToPrevious(): void {
        if (mergedSingleCharRunChars[prevIndex] !== null) {
          mergedTextParts[prevIndex] = [
            materializeDeferredSingleCharRun(
              mergedTexts,
              mergedSingleCharRunChars,
              mergedSingleCharRunLengths,
              prevIndex,
            ),
          ]
          mergedSingleCharRunChars[prevIndex] = null
        }
        mergedTextParts[prevIndex]!.push(piece.text)
        mergedWordLike[prevIndex] = mergedWordLike[prevIndex]! || piece.isWordLike
        mergedContainsCJK[prevIndex] = mergedContainsCJK[prevIndex]! || pieceContainsCJK
        mergedContainsArabicScript[prevIndex] =
          mergedContainsArabicScript[prevIndex]! || pieceContainsArabicScript
        mergedEndsWithClosingQuote[prevIndex] = pieceEndsWithClosingQuote
        mergedEndsWithMyanmarMedialGlue[prevIndex] = pieceEndsWithMyanmarMedialGlue
        mergedHasArabicNoSpacePunctuation[prevIndex] = hasArabicNoSpacePunctuation(
          mergedContainsArabicScript[prevIndex]!,
          pieceLastCodePoint,
        )
      }

      // First-pass keeps: no-space script-specific joins and punctuation glue
      // that depend on the immediately preceding text run.
      if (
        profile.carryCJKAfterClosingQuote &&
        isText &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        pieceContainsCJK &&
        mergedContainsCJK[prevIndex] &&
        mergedEndsWithClosingQuote[prevIndex]!
      ) {
        appendPieceToPrevious()
      } else if (
        isText &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        isCJKLineStartProhibitedSegment(piece.text) &&
        mergedContainsCJK[prevIndex]
      ) {
        appendPieceToPrevious()
      } else if (
        isText &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        mergedEndsWithMyanmarMedialGlue[prevIndex]
      ) {
        appendPieceToPrevious()
      } else if (
        isText &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        piece.isWordLike &&
        pieceContainsArabicScript &&
        mergedHasArabicNoSpacePunctuation[prevIndex]
      ) {
        appendPieceToPrevious()
        mergedWordLike[prevIndex] = true
      } else if (
        repeatableSingleCharRunChar !== null &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        mergedSingleCharRunChars[prevIndex] === repeatableSingleCharRunChar
      ) {
        mergedSingleCharRunLengths[prevIndex] = (mergedSingleCharRunLengths[prevIndex] ?? 1) + 1
      } else if (
        isText &&
        !piece.isWordLike &&
        mergedLen > 0 &&
        mergedKinds[prevIndex] === 'text' &&
        !mergedContainsCJK[prevIndex] &&
        (
          isLeftStickyPunctuationSegment(piece.text) ||
          (piece.text === '-' && mergedWordLike[prevIndex]!)
        )
      ) {
        appendPieceToPrevious()
      } else {
        mergedTexts[mergedLen] = piece.text
        mergedTextParts[mergedLen] = [piece.text]
        mergedWordLike[mergedLen] = piece.isWordLike
        mergedKinds[mergedLen] = piece.kind
        mergedStarts[mergedLen] = piece.start
        mergedSingleCharRunChars[mergedLen] = repeatableSingleCharRunChar
        mergedSingleCharRunLengths[mergedLen] = repeatableSingleCharRunChar === null ? 0 : 1
        mergedContainsCJK[mergedLen] = pieceContainsCJK
        mergedContainsArabicScript[mergedLen] = pieceContainsArabicScript
        mergedEndsWithClosingQuote[mergedLen] = pieceEndsWithClosingQuote
        mergedEndsWithMyanmarMedialGlue[mergedLen] = pieceEndsWithMyanmarMedialGlue
        mergedHasArabicNoSpacePunctuation[mergedLen] = hasArabicNoSpacePunctuation(
          pieceContainsArabicScript,
          pieceLastCodePoint,
        )
        mergedLen++
      }
    }
  }

  for (let i = 0; i < mergedLen; i++) {
    if (mergedSingleCharRunChars[i] !== null) {
      mergedTexts[i] = materializeDeferredSingleCharRun(
        mergedTexts,
        mergedSingleCharRunChars,
        mergedSingleCharRunLengths,
        i,
      )
      continue
    }
    mergedTexts[i] = joinTextParts(mergedTextParts[i]!)
  }

  // Later passes operate on the merged text stream itself: contextual escaped
  // quote glue, forward-sticky carry, compaction, then the broader URL/numeric
  // and Arabic-leading-mark fixes.
  for (let i = 1; i < mergedLen; i++) {
    if (
      mergedKinds[i] === 'text' &&
      !mergedWordLike[i]! &&
      isEscapedQuoteClusterSegment(mergedTexts[i]!) &&
      mergedKinds[i - 1] === 'text' &&
      !mergedContainsCJK[i - 1]
    ) {
      mergedTexts[i - 1] += mergedTexts[i]!
      mergedWordLike[i - 1] = mergedWordLike[i - 1]! || mergedWordLike[i]!
      mergedTexts[i] = ''
    }
  }

  const forwardStickyPrefixParts: (string[] | null)[] = Array.from({ length: mergedLen }, () => null)
  let nextLiveIndex = -1

  for (let i = mergedLen - 1; i >= 0; i--) {
    const text = mergedTexts[i]!
    if (text.length === 0) continue

    if (
      mergedKinds[i] === 'text' &&
      !mergedWordLike[i]! &&
      nextLiveIndex >= 0 &&
      mergedKinds[nextLiveIndex] === 'text' &&
      (
        isForwardStickyClusterSegment(text) ||
        (text === '-' && startsWithDecimalDigit(mergedTexts[nextLiveIndex]!))
      )
    ) {
      const prefixParts = forwardStickyPrefixParts[nextLiveIndex] ?? []
      prefixParts.push(text)
      forwardStickyPrefixParts[nextLiveIndex] = prefixParts
      mergedStarts[nextLiveIndex] = mergedStarts[i]!
      mergedTexts[i] = ''
      continue
    }

    nextLiveIndex = i
  }

  for (let i = 0; i < mergedLen; i++) {
    const prefixParts = forwardStickyPrefixParts[i]
    if (prefixParts == null) continue
    mergedTexts[i] = joinReversedPrefixParts(prefixParts, mergedTexts[i]!)
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
  const withMergedUrls = carryTrailingForwardStickyAcrossCJKBoundary(
    mergeNoSpaceWordChains(
      splitHyphenatedNumericRuns(mergeNumericRuns(mergeUrlQueryRuns(mergeUrlLikeRuns(compacted)))),
    ),
  )

  for (let i = 0; i < withMergedUrls.len - 1; i++) {
    const split = splitLeadingSpaceAndMarks(withMergedUrls.texts[i]!)
    if (split === null) continue
    if (
      (withMergedUrls.kinds[i] !== 'space' && withMergedUrls.kinds[i] !== 'preserved-space') ||
      withMergedUrls.kinds[i + 1] !== 'text' ||
      !containsArabicScript(withMergedUrls.texts[i + 1]!)
    ) {
      continue
    }

    withMergedUrls.texts[i] = split.space
    withMergedUrls.isWordLike[i] = false
    withMergedUrls.kinds[i] = withMergedUrls.kinds[i] === 'preserved-space' ? 'preserved-space' : 'space'
    withMergedUrls.texts[i + 1] = split.marks + withMergedUrls.texts[i + 1]!
    withMergedUrls.starts[i + 1] = withMergedUrls.starts[i]! + split.space.length
  }

  return withMergedUrls
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

function mergeKeepAllTextSegments(
  normalized: string,
  segmentation: MergedSegmentation,
  breakAfterPunctuation: boolean,
): MergedSegmentation {
  if (segmentation.len <= 1) return segmentation

  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  let groupStart = -1
  let groupContainsCJK = false

  function pushOriginalText(index: number): void {
    texts.push(segmentation.texts[index]!)
    isWordLike.push(segmentation.isWordLike[index]!)
    kinds.push('text')
    starts.push(segmentation.starts[index]!)
  }

  function pushMergedText(start: number, end: number): void {
    let wordLike = false

    for (let i = start; i < end; i++) {
      wordLike = wordLike || segmentation.isWordLike[i]!
    }

    const sourceStart = segmentation.starts[start]!
    const sourceEnd = end < segmentation.len ? segmentation.starts[end]! : normalized.length
    texts.push(normalized.slice(sourceStart, sourceEnd))
    isWordLike.push(wordLike)
    kinds.push('text')
    starts.push(sourceStart)
  }

  function flushGroup(end: number): void {
    if (groupStart < 0) return

    if (groupContainsCJK) {
      if (groupStart + 1 === end) {
        pushOriginalText(groupStart)
      } else {
        pushMergedText(groupStart, end)
      }
    } else {
      for (let i = groupStart; i < end; i++) pushOriginalText(i)
    }

    groupStart = -1
    groupContainsCJK = false
  }

  for (let i = 0; i < segmentation.len; i++) {
    const text = segmentation.texts[i]!
    const kind = segmentation.kinds[i]!

    if (kind === 'text') {
      if (
        groupStart >= 0 &&
        !canContinueKeepAllTextRun(segmentation.texts[i - 1]!, breakAfterPunctuation)
      ) {
        flushGroup(i)
      }
      if (groupStart < 0) groupStart = i
      groupContainsCJK = groupContainsCJK || isCJK(text)
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

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
  wordBreak: WordBreakMode = 'normal',
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
  const mergedSegmentation = buildMergedSegmentation(normalized, profile, whiteSpaceProfile)
  const segmentation = wordBreak === 'keep-all'
    ? mergeKeepAllTextSegments(normalized, mergedSegmentation, profile.breakKeepAllAfterPunctuation)
    : mergedSegmentation
  return {
    normalized,
    chunks: compileAnalysisChunks(segmentation, whiteSpaceProfile),
    ...segmentation,
  }
}
