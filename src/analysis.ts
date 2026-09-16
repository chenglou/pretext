import { getGeckoLineBreaks } from './gecko-line-breaks.js'
import { canWebKitLineStartWith, getBlinkLineBreaks, getWebKitLineBreaks } from './line-breaks.js'

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
  // A ZWSP or soft hyphen the engine's scan doesn't break after: zero width, no
  // letter spacing, no break on either side, unlike glue measured with its text.
  | 'zero-width-glue'
  | 'hard-break'
  | 'control'

// `breaksBefore` is false where the engine's scan gives no break before text, glue,
// zero-width glue or a control, other than at a line start. Null where it always does.
// `clusterSplits` is false for a segment the engine's clusters don't split, which no
// emergency break splits either. Null where the scan has no clusters of its own.
export type Segmentation = {
  len: number
  texts: string[]
  kinds: SegmentBreakKind[]
  starts: number[]
  breaksBefore: boolean[] | null
  clusterSplits: boolean[] | null
}

export type TextAnalysis = { source: string; normalized: string } & Segmentation

export type AnalysisProfile = {
  lineBreakScan: 'blink' | 'webkit' | 'gecko'
  segmentBreakRemovalRun: SegmentBreakRemovalRun
  breakOnlyAfterNextLine: boolean
}

// The collapsible run that a ZWSP removes under the CSS segment break
// transformation, per engine. WebKit never removes one.
export type SegmentBreakRemovalRun = 'none' | 'blink' | 'gecko'

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

export function getSharedWordSegmenter(): Intl.Segmenter {
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

const combiningMarkRe = /\p{M}/u
const decimalDigitRe = /\p{Nd}/u

function classifySegmentBreakCode(code: number, whiteSpace: WhiteSpaceMode, breakOnlyAfterNextLine: boolean): SegmentBreakKind {
  if (whiteSpace === 'pre-wrap') {
    if (code === 0x20) return 'preserved-space'
    if (code === 0x09) return 'tab'
    if (code === 0x0A) return 'hard-break'
  }
  if (code === 0x20) return 'space'
  if (code === 0x00A0 || code === 0x2007 || code === 0x202F || code === 0x2060 || code === 0xFEFF) {
    return 'glue'
  }
  if (code === 0x200B) return 'zero-width-break'
  if (code === 0x00AD) return 'soft-hyphen'
  // UAX #14 NL: visible content with a break after it and none before it.
  if (code === 0x0085 && breakOnlyAfterNextLine) return 'control'
  return 'text'
}

const numericJoinerChars = new Set([
  ':', '-', '/', '×', ',', '.', '+',
  '\u2013',
  '\u2014',
])

export function isNumericRunSegment(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) {
    if (decimalDigitRe.test(ch) || numericJoinerChars.has(ch)) continue
    return false
  }
  return true
}

// The graphemes after the first that WebKit doesn't start a line with when a line
// holds only an overflowing first character, by their first code unit, as ascending
// grapheme indices. Null without any.
export function getLineStartProhibitions(text: string): number[] | null {
  let any = false
  for (let i = 1; i < text.length && !any; i++) any = !canWebKitLineStartWith(text.charCodeAt(i))
  if (!any) return null
  const prohibitions: number[] = []
  let graphemeIndex = 0
  for (const gs of getSharedGraphemeSegmenter().segment(text)) {
    if (graphemeIndex > 0 && !canWebKitLineStartWith(gs.segment.charCodeAt(0))) prohibitions.push(graphemeIndex)
    graphemeIndex++
  }
  return prohibitions.length === 0 ? null : prohibitions
}

function isCollapsibleSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D || code === 0x0C
}

// WebKit and Gecko scan a text node's source, where normalization collapsed white space: in
// normal white space each run of SPACE, TAB, LF, CR and FF became one space, or nothing
// at either end, and in pre-wrap CRLF became LF. A break before a run's first unit is a
// break before what the run became. A break before a later unit, as before a CR after a
// space, follows white space, so it is a break after what the run became. A 2 goes with
// its unit: Gecko's cluster start without a break, which only a unit that stays text
// reads, and WebKit's forced break after a separator, which keeps its 2 at the end too.
function mapSourceLineBreaks(source: string, normalizedLength: number, sourceBreaks: Uint8Array, whiteSpace: WhiteSpaceMode): Uint8Array {
  const breaks = new Uint8Array(normalizedLength + 1)
  let normalizedIndex = 0
  if (whiteSpace === 'pre-wrap') {
    for (let i = 0; i < source.length; i++, normalizedIndex++) {
      breaks[normalizedIndex] = sourceBreaks[i]!
      if (source.charCodeAt(i) === 0x0D && source.charCodeAt(i + 1) === 0x0A) {
        i++
        if (sourceBreaks[i] === 1) breaks[normalizedIndex] = 1
      }
    }
    breaks[normalizedLength] = sourceBreaks[source.length]!
    return breaks
  }
  let i = 0
  while (i < source.length && isCollapsibleSpaceCode(source.charCodeAt(i))) i++
  while (i < source.length) {
    let end = i + 1
    if (isCollapsibleSpaceCode(source.charCodeAt(i))) {
      while (end < source.length && isCollapsibleSpaceCode(source.charCodeAt(end))) end++
      if (end === source.length) break
    }
    if (sourceBreaks[i] === 2 && breaks[normalizedIndex] === 0) breaks[normalizedIndex] = 2
    const start = i
    for (; i < end; i++) {
      if (sourceBreaks[i] === 1) breaks[i === start ? normalizedIndex : normalizedIndex + 1] = 1
    }
    normalizedIndex++
  }
  if (sourceBreaks[i] === 2) breaks[normalizedLength] = 2
  return breaks
}

function isTextLikeKind(kind: SegmentBreakKind): boolean {
  return kind === 'text' || kind === 'glue'
}

// Characters of these kinds share a segment when no break falls between them. Each
// tab, hard break, ZWSP and NEL control stays its own segment.
function gathersKind(kind: SegmentBreakKind): boolean {
  return kind === 'text' || kind === 'glue' || kind === 'space' || kind === 'preserved-space' || kind === 'soft-hyphen'
}

// A control character that stays its own text segment, measured alone: the C0 and C1
// controls that white-space normalization leaves as text, and the line and paragraph
// separators where they don't end a line.
function isControlSegmentCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029
}

// Segments are the text between an engine's break opportunities, split where the
// break kind changes; text and glue share a segment, and a control stays alone. A ZWSP
// or soft hyphen that the scan doesn't break after, as at the start of a WebKit scan,
// before a combining mark or a closing bracket, or under keep-all, is zero-width glue:
// it stays its own zero-width segment, takes no letter spacing and doesn't end a line.
// Combining marks right after it, or after a control, stay apart from the text after
// them, since they shape on the grapheme before it (measureAnalysis). Where the Gecko
// scan marks cluster starts (2), a segment records whether one falls inside it.
function segmentAtLineBreaks(normalized: string, breaks: Uint8Array, whiteSpace: WhiteSpaceMode, breakOnlyAfterNextLine: boolean, scan: AnalysisProfile['lineBreakScan']): Segmentation {
  // The WebKit scan's 2 after U+2028 or U+2029 makes the separator a hard break in every white-space mode.
  const classify = (code: number, i: number): SegmentBreakKind => scan === 'webkit' && breaks[i + 1] === 2 && (code === 0x2028 || code === 0x2029)
    ? 'hard-break'
    : classifySegmentBreakCode(code, whiteSpace, breakOnlyAfterNextLine)
  const starts = [0]
  const kinds = [classify(normalized.charCodeAt(0), 0)]
  const clusterSplits = scan === 'gecko' ? [false] : null
  let lastAlone = kinds[0] === 'text' && isControlSegmentCode(normalized.charCodeAt(0))
  let markRun = false
  for (let i = 1; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    const kind = classify(code, i)
    const alone = kind === 'text' && isControlSegmentCode(code)
    const last = kinds.length - 1
    if (
      breaks[i] !== 1 && !alone && !lastAlone && !(markRun && !combiningMarkRe.test(normalized[i]!)) &&
      (kind === kinds[last] ? gathersKind(kind) : isTextLikeKind(kind) && isTextLikeKind(kinds[last]!))
    ) {
      if (kind === 'text') kinds[last] = 'text'
      if (clusterSplits !== null && breaks[i] === 2) clusterSplits[last] = true
      continue
    }
    markRun = breaks[i] !== 1 && kind === 'text' && combiningMarkRe.test(normalized[i]!) &&
      (lastAlone || kinds[last] === 'zero-width-break' || kinds[last] === 'soft-hyphen' || kinds[last] === 'control')
    starts.push(i)
    kinds.push(kind)
    clusterSplits?.push(false)
    lastAlone = alone
  }
  // A line ends only where the scan breaks, so the walkers learn where it doesn't:
  // before text, glue, zero-width glue or a control, other than at a line start. A
  // ZWSP or soft hyphen there is zero-width glue. Before a space, tab or hard break
  // the scan has no break either, but the line can still end there, so it keeps its kind.
  const len = kinds.length
  let breaksBefore: boolean[] | null = null
  for (let j = len - 2; j >= 0; j--) {
    const kind = kinds[j]!
    const next = kinds[j + 1]!
    if (breaks[starts[j + 1]!] === 1 || kind === 'hard-break' || !(isTextLikeKind(next) || next === 'zero-width-glue' || next === 'control')) continue
    if (kind === 'zero-width-break' || kind === 'soft-hyphen') kinds[j] = 'zero-width-glue'
    breaksBefore ??= Array.from({ length: len }, () => true)
    breaksBefore[j + 1] = false
  }
  const texts: string[] = []
  for (let j = 0; j < len; j++) texts.push(normalized.slice(starts[j]!, j + 1 < len ? starts[j + 1]! : normalized.length))
  return { len, texts, kinds, starts, breaksBefore, clusterSplits }
}

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
  wordBreak: WordBreakMode = 'normal',
  // The page language, which picks WebKit's line table and quotation remap and
  // Gecko's rule for newlines next to East Asian punctuation.
  language: string | null = null,
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
      kinds: [],
      starts: [],
      breaksBefore: null,
      clusterSplits: null,
    }
  }
  const keepAll = wordBreak === 'keep-all'
  let breaks: Uint8Array
  if (profile.lineBreakScan === 'blink') {
    breaks = getBlinkLineBreaks(normalized, keepAll, getSharedWordSegmenter())
  } else {
    // WebKit and Gecko scan a text node's source. Gecko's scan transforms its white space
    // as Firefox does, which removes the segment breaks next to a ZWSP that normalization
    // removed first.
    const preserve = whiteSpace === 'pre-wrap'
    const source = preserve ? text : removeSegmentBreaksNextToZeroWidthSpace(text, profile)
    const sourceBreaks = profile.lineBreakScan === 'webkit'
      ? getWebKitLineBreaks(source, preserve, keepAll, language, getSharedWordSegmenter())
      : getGeckoLineBreaks(source, preserve, keepAll, language, getSharedGraphemeSegmenter(), getSharedWordSegmenter())
    breaks = source === normalized ? sourceBreaks : mapSourceLineBreaks(source, normalized.length, sourceBreaks, whiteSpace)
  }
  return {
    source: text,
    normalized,
    ...segmentAtLineBreaks(normalized, breaks, whiteSpace, profile.breakOnlyAfterNextLine, profile.lineBreakScan),
  }
}
