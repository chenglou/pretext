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

export type TextAnalysis = { source: string; normalized: string } & MergedSegmentation

export type AnalysisProfile = {
  geckoAsciiLineBreaks: boolean
  carryCJKAfterClosingQuote: boolean
  breakKeepAllAfterPunctuation: boolean
  keepZeroWidthSpaceMarkAtScanStart: boolean
  breakBeforeConditionalJapaneseStarter: boolean
  wordInitialHyphenLetters: 'none' | 'alphabetic' | 'alphabetic-and-hebrew'
  breakHyphenAfterCollapsedTab: boolean
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

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

// UAX #14 IS punctuation, which keeps a following letter (LB29). U+061B is EX.
const arabicNoSpaceTrailingPunctuation = new Set([
  ':',
  '.',
  '\u060C',
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

function isCJKLineStartProhibitedSegment(segment: string): boolean {
  for (const ch of segment) {
    if (!kinsokuStart.has(ch) && !leftStickyPunctuation.has(ch)) return false
  }
  return segment.length > 0
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

function classifySegmentBreakChar(ch: string, whiteSpace: WhiteSpaceMode): SegmentBreakKind {
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
  return 'text'
}

// All characters that classifySegmentBreakChar maps to a non-'text' kind.
const breakCharRe = /[\x20\t\n\xA0\xAD\u2007\u200B\u202F\u2060\uFEFF]/

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

// UAX #14 BK, CR, LF and NL. LB7 forbids every other break before a ZWSP.
function isMandatoryBreakCode(code: number): boolean {
  return (code >= 0x0A && code <= 0x0D) || code === 0x85 || code === 0x2028 || code === 0x2029
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

function splitSegmentByBreakKind(
  segment: string,
  isWordLike: boolean,
  start: number,
  whiteSpace: WhiteSpaceMode,
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
    const kind = classifySegmentBreakChar(ch, whiteSpace)
    const wordLike = kind === 'text' && isWordLike

    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike) {
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
    let queryStartOverride = -1

    if (kind === 'text' && isUrlLikeRunStart(segmentation, i)) {
      const urlParts = [text]
      let j = i + 1
      while (
        j < segmentation.len &&
        !isTextRunBoundary(segmentation.kinds[j]!) &&
        numericAffixBoundary(normalized, segmentation.starts[j]!, profile) !== false
      ) {
        if (queryStartOverride < 0 && isUrlLikeRunStart(segmentation, j)) {
          queryStartOverride = segmentation.starts[j]!
        }
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
    const queryStart = queryStartOverride < 0
      ? segmentation.starts[nextIndex]!
      : queryStartOverride
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

// UAX #14 EX from LineBreak.txt (Unicode 17), stored as start/end pairs.
const exclamationLineBreakRanges = [
  0x0021, 0x0021, 0x003F, 0x003F, 0x05C6, 0x05C6, 0x061B, 0x061B, 0x061D, 0x061F,
  0x06D4, 0x06D4, 0x07F9, 0x07F9, 0x0F0D, 0x0F11, 0x0F14, 0x0F14, 0x1802, 0x1803,
  0x1808, 0x1809, 0x1944, 0x1945, 0x2762, 0x2763, 0x2CF9, 0x2CF9, 0x2CFE, 0x2CFE,
  0x2E2E, 0x2E2E, 0x2E53, 0x2E54, 0xA60E, 0xA60E, 0xA876, 0xA877, 0xFE15, 0xFE16,
  0xFE56, 0xFE57, 0xFF01, 0xFF01, 0xFF1F, 0xFF1F, 0x115C4, 0x115C5, 0x11C71, 0x11C71,
] as const

// Letters, numbers and symbols above U+00FF whose UAX #14 class forbids a break
// before them (BA, CL, CM, EX, IN, IS, NS or QU in LineBreak.txt, Unicode 17),
// such as the iteration marks U+3005 and U+309D. Stored as start/end pairs.
const noBreakBeforeRanges = [
  0x0F34, 0x0F34, 0x0FBE, 0x0FBF, 0x2044, 0x2044, 0x22EF, 0x22EF, 0x275B, 0x2760,
  0x2762, 0x2763, 0x2800, 0x2800, 0x3005, 0x3005, 0x3035, 0x3035, 0x303B, 0x303C,
  0x309B, 0x309E, 0x30FD, 0x30FE, 0xA015, 0xA015, 0xA9CF, 0xA9CF, 0xAA40, 0xAA42,
  0xAA44, 0xAA4B, 0xFF9E, 0xFF9F, 0x1133D, 0x1133D, 0x1135D, 0x1135D, 0x11EF2, 0x11EF2,
  0x1325B, 0x1325D, 0x13282, 0x13282, 0x13287, 0x13287, 0x13289, 0x13289, 0x1337A, 0x1337B,
  0x145CF, 0x145CF, 0x16FE0, 0x16FE1, 0x16FE3, 0x16FE3, 0x16FF2, 0x16FF3, 0x1F676, 0x1F67B,
] as const

// UAX #14 CJ from LineBreak.txt (Unicode 17): small kana and prolonged sound
// marks. Strict rules treat CJ as NS; ICU's normal rules treat it as ID.
const conditionalJapaneseStarterRanges = [
  0x3041, 0x3041, 0x3043, 0x3043, 0x3045, 0x3045, 0x3047, 0x3047, 0x3049, 0x3049,
  0x3063, 0x3063, 0x3083, 0x3083, 0x3085, 0x3085, 0x3087, 0x3087, 0x308E, 0x308E,
  0x3095, 0x3096, 0x30A1, 0x30A1, 0x30A3, 0x30A3, 0x30A5, 0x30A5, 0x30A7, 0x30A7,
  0x30A9, 0x30A9, 0x30C3, 0x30C3, 0x30E3, 0x30E3, 0x30E5, 0x30E5, 0x30E7, 0x30E7,
  0x30EE, 0x30EE, 0x30F5, 0x30F6, 0x30FC, 0x30FC, 0x31F0, 0x31FF, 0xFF67, 0xFF70,
  0x1B132, 0x1B132, 0x1B150, 0x1B152, 0x1B155, 0x1B155, 0x1B164, 0x1B167,
] as const

// Up to U+00FF, the UAX #14 classes that forbid a break before them are CM
// (controls), BA, CL, CP, EX, GL, HY, IS, QU and SY.
function isLatin1NoBreakBeforeCode(code: number): boolean {
  switch (code) {
    case 0x21: case 0x22: case 0x27: case 0x29: case 0x2C: case 0x2D: case 0x2E: case 0x2F:
    case 0x3A: case 0x3B: case 0x3F: case 0x5D: case 0x7C: case 0x7D: case 0xAB: case 0xAD: case 0xBB:
      return true
  }
  return code < 0x21 || (code >= 0x7F && code <= 0xA0)
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
// only under ICU's normal rules, which Chromium uses for line-break: auto.
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
  // Safari's keep-all breaks only at spaces, even after punctuation.
  if (wordBreak === 'keep-all' && !profile.breakKeepAllAfterPunctuation) return false
  for (let end = boundary; end > 0;) {
    const start = previousCodePointStart(source, end)
    const codePoint = source.codePointAt(start)!
    if (isCodePointInRanges(codePoint, exclamationLineBreakRanges)) {
      const next = source.codePointAt(boundary)!
      if (next > 0xFF) {
        exclamationFollowerAtRe.lastIndex = boundary
        if (!exclamationFollowerAtRe.test(source)) return isCodePointInRanges(next, lineBreakNumericAffixRanges)
        if (isCodePointInRanges(next, conditionalJapaneseStarterRanges)) return profile.breakBeforeConditionalJapaneseStarter
        return !isCodePointInRanges(next, noBreakBeforeRanges)
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

// Letters above U+00FF whose UAX #14 class is not AL, AI, SA, SG, XX or HL in
// LineBreak.txt (Unicode 17): ideographs, kana, Hangul, Bopomofo, Yi, Brahmic
// AK/AS/AP letters, BB modifier letters and NS/BA/CL/OP/CM letters. Stored as
// start/end pairs.
const nonAlphabeticLetterRanges = [
  0x02C8, 0x02C8, 0x02CC, 0x02CC, 0x1100, 0x11FF, 0x1B05, 0x1B33, 0x1B45, 0x1B4C,
  0x1BC0, 0x1BE5, 0x3005, 0x3006, 0x3031, 0x3035, 0x303B, 0x303C, 0x3041, 0x3096,
  0x309D, 0x309F, 0x30A1, 0x30FA, 0x30FC, 0x30FF, 0x3105, 0x312F, 0x3131, 0x318E,
  0x31A0, 0x31BF, 0x31F0, 0x31FF, 0x3400, 0x4DBF, 0x4E00, 0xA48C, 0xA960, 0xA97C,
  0xA984, 0xA9B2, 0xA9CF, 0xA9CF, 0xAA00, 0xAA28, 0xAA40, 0xAA42, 0xAA44, 0xAA4B,
  0xAC00, 0xD7A3, 0xD7B0, 0xD7C6, 0xD7CB, 0xD7FB, 0xF900, 0xFA6D, 0xFA70, 0xFAD9,
  0xFF21, 0xFF3A, 0xFF41, 0xFF5A, 0xFF66, 0xFFBE, 0xFFC2, 0xFFC7, 0xFFCA, 0xFFCF,
  0xFFD2, 0xFFD7, 0xFFDA, 0xFFDC, 0x11003, 0x11037, 0x11071, 0x11072, 0x11075, 0x11075,
  0x11305, 0x1130C, 0x1130F, 0x11310, 0x11313, 0x11328, 0x1132A, 0x11330, 0x11332, 0x11333,
  0x11335, 0x11339, 0x1133D, 0x1133D, 0x11350, 0x11350, 0x1135D, 0x11361, 0x11380, 0x11389,
  0x1138B, 0x1138B, 0x1138E, 0x1138E, 0x11390, 0x113B5, 0x113B7, 0x113B7, 0x113D1, 0x113D1,
  0x113D3, 0x113D3, 0x11900, 0x11906, 0x11909, 0x11909, 0x1190C, 0x11913, 0x11915, 0x11916,
  0x11918, 0x1192F, 0x1193F, 0x1193F, 0x11941, 0x11941, 0x11EE0, 0x11EF2, 0x11F02, 0x11F02,
  0x11F04, 0x11F10, 0x11F12, 0x11F33, 0x13258, 0x1325D, 0x13282, 0x13282, 0x13286, 0x13289,
  0x13379, 0x1337B, 0x1342F, 0x1342F, 0x145CE, 0x145CF, 0x16100, 0x1611D, 0x16FE0, 0x16FE1,
  0x16FE3, 0x16FE3, 0x16FF2, 0x16FF3, 0x17000, 0x18AFF, 0x18D00, 0x18D1E, 0x18D80, 0x18DF2,
  0x1B000, 0x1B122, 0x1B132, 0x1B132, 0x1B150, 0x1B152, 0x1B155, 0x1B155, 0x1B164, 0x1B167,
  0x1B170, 0x1B2FB, 0x20000, 0x2A6DF, 0x2A700, 0x2B81D, 0x2B820, 0x2CEAD, 0x2CEB0, 0x2EBE0,
  0x2EBF0, 0x2EE5D, 0x2F800, 0x2FA1D, 0x30000, 0x3134A, 0x31350, 0x33479,
] as const

// UAX #14 HL from LineBreak.txt (Unicode 17), stored as start/end pairs.
const hebrewLetterRanges = [
  0x05D0, 0x05EA, 0x05EF, 0x05F2, 0xFB1D, 0xFB1D, 0xFB1F, 0xFB28, 0xFB2A, 0xFB36,
  0xFB38, 0xFB3C, 0xFB3E, 0xFB3E, 0xFB40, 0xFB41, 0xFB43, 0xFB44, 0xFB46, 0xFB4F,
] as const

const hyphenWithMarksRe = /^.\p{M}+$/u
const letterAtRe = /\p{L}/uy

// A hyphen alone or followed only by combining marks. The astral HH dashes are
// two code units.
function isHyphenPiece(text: string): boolean {
  const code = text.codePointAt(0)!
  switch (code) {
    case 0x2D: case 0x058A: case 0x05BE: case 0x1400: case 0x2010: case 0x2012:
    case 0x2013: case 0x2E17: case 0x2E40: case 0x2E5D: case 0x10D6E: case 0x10EAD:
      return text.length === (code > 0xFFFF ? 2 : 1) || hyphenWithMarksRe.test(text)
  }
  return false
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
  if (!letterAtRe.test(source) || isCodePointInRanges(letter, nonAlphabeticLetterRanges)) return false
  return profile.wordInitialHyphenLetters === 'alphabetic-and-hebrew' || !isCodePointInRanges(letter, hebrewLetterRanges)
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

function mergeNumericRuns(segmentation: MergedSegmentation, normalized: string, profile: AnalysisProfile): MergedSegmentation {
  const texts: string[] = []
  const isWordLike: boolean[] = []
  const kinds: SegmentBreakKind[] = []
  const starts: number[] = []

  function pushNumericRun(text: string, start: number): void {
    if (text.includes('-')) {
      const parts = text.split('-')
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
          const splitText = i < parts.length - 1 ? `${part}-` : part
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

      pushNumericRun(joinTextParts(mergedParts), segmentation.starts[i]!)
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
    for (const piece of splitSegmentByBreakKind(s.segment, s.isWordLike ?? false, s.index, whiteSpace)) {
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
        isCJKLineStartProhibitedSegment(piece.text) &&
        tailContainsCJK
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
        (!canContinueKeepAllTextRun(segmentation.texts[i - 1]!, profile.breakKeepAllAfterPunctuation) ||
          numericAffixBoundary(normalized, segmentation.starts[i]!, profile) === false)
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
      kinsokuStart.has(grapheme) ||
      leftStickyPunctuation.has(grapheme) ||
      attachHyphen ||
      (unitHasNumericHyphen && !graphemeContainsCJK) ||
      (profile.carryCJKAfterClosingQuote &&
        graphemeContainsCJK &&
        unitEndsWithClosingQuote)
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

  function pushMergedUnit(start: number, end: number): void {
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
      if (groupStart + 1 === end) {
        merged.push(units[groupStart]!)
      } else {
        pushMergedUnit(groupStart, end)
      }
    } else {
      for (let i = groupStart; i < end; i++) merged.push(units[i]!)
    }

    groupStart = -1
    groupContainsCJK = false
  }

  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!
    if (
      groupStart >= 0 &&
      (!canContinueKeepAllTextRun(units[i - 1]!.text, profile.breakKeepAllAfterPunctuation) ||
        numericAffixBoundary(segText, unit.start, profile) === false)
    ) {
      flushGroup(i)
    }
    if (groupStart < 0) groupStart = i
    groupContainsCJK = groupContainsCJK || isCJK(unit.text)
  }

  flushGroup(units.length)
  return merged
}

// Ordinary CJK boundaries and emergency overflow permission are separate facts.
// Keep these decisions in preprocessing; measurement only observes their units.
export function getCjkTextUnits(text: string, profile: AnalysisProfile, wordBreak: WordBreakMode): TextBreakUnit[] {
  const units = buildBaseCjkUnits(text, profile)
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
    : normalizeWhitespaceNormal(text)
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
