import { getGeckoLineBreaks, isDiscardable, isEastAsianSegmentBreak, isJapaneseOrChinese, isSpaceCombiningSequenceTail } from './gecko-line-breaks.js'
import type { CharTable } from './generated/engine-break-data.js'
import { getBlinkLineBreaks, getWebKitLineBreaks } from './line-breaks.js'

export type WhiteSpaceMode = 'normal' | 'pre-wrap'
export type WordBreakMode = 'normal' | 'keep-all'

// No `glue` kind: no-break characters are text and the scans decide their breaks
// (RESEARCH.md, Decisions Log, 2026-09-24).
export type SegmentBreakKind =
  | 'text'
  | 'space'
  | 'preserved-space'
  | 'tab'
  | 'zero-width-break'
  | 'soft-hyphen'
  // A ZWSP or soft hyphen the engine's scan doesn't break after: zero width, no
  // letter spacing, no break on either side.
  | 'zero-width-glue'
  | 'hard-break'
  | 'control'

// `breaksBefore` is false where the engine's scan gives no break before text, zero-width
// glue or a control, other than at a line start. Null where it always does.
// `clusterSplits` is false for a segment the engine's clusters don't split, which no
// emergency break splits either. Null where the scan has no clusters of its own.
export type Segmentation = {
  texts: string[]
  kinds: SegmentBreakKind[]
  starts: number[]
  breaksBefore: boolean[] | null
  clusterSplits: boolean[] | null
}

// `spaceSources` holds, in the WebKit profile where normal white space collapsed, the source
// unit each normalized unit starts from, such as the TAB or LF a space came from. Null otherwise.
export type TextAnalysis = { source: string; normalized: string; spaceSources: Uint16Array | null } & Segmentation

export type AnalysisProfile = {
  lineBreakScan: 'blink' | 'webkit' | 'gecko'
  graphemeTable: CharTable
}

const collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g
const needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/

function isSegmentBreakRunSpace(code: number, scan: AnalysisProfile['lineBreakScan']): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || (code === 0x0D && scan === 'blink')
}

// CSS segment break transformation in normal white space. Blink and Gecko
// delete a collapsible run containing LF when a ZWSP immediately precedes or
// follows the run; WebKit turns it into a space. Gecko also deletes it between two
// East Asian wide characters other than Hangul, and on a `ja` or `zh` page next to
// East Asian punctuation, reading past default-ignorable characters on both sides
// (TransformWhiteSpaces, nsTextFrameUtils.cpp:84-209, with the predicates of
// nsUnicharUtils.cpp:500-527). Each engine collects its own run, and engines Pretext
// doesn't recognize take Blink's, as they take its scan:
// - Blink: SPACE, TAB, LF and CR.
// - Gecko: SPACE, TAB and LF, continuing through the characters Gecko discards
//   (SHY and bidi controls) without ending on one, and leaving out a last SPACE
//   before a combining sequence tail. Text holding a ZWSP is 16-bit in Gecko.
// Characters outside the run, such as FF, keep the ordinary collapse.
export function removeSkippableSegmentBreaks(text: string, profile: AnalysisProfile, language: string | null = null): string {
  const scan = profile.lineBreakScan
  if (scan === 'webkit' || !text.includes('\n')) return text
  const eastAsian = scan === 'gecko' && maybeEastAsianRe.test(text)
  if (!eastAsian && !text.includes('\u200B')) return text
  const japaneseOrChinese = eastAsian && isJapaneseOrChinese(language)
  let result = ''
  let copied = 0
  // Only a run containing LF can be removed. Expand each LF to its run once;
  // the next search starts where this run's scan stopped.
  for (let newline = text.indexOf('\n'); newline !== -1;) {
    let start = newline
    for (let index = newline - 1; index >= 0; index--) {
      const code = text.charCodeAt(index)
      if (isSegmentBreakRunSpace(code, scan)) start = index
      else if (!(scan === 'gecko' && isDiscardable(code, false))) break
    }
    let end = newline + 1
    let index = end
    for (; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (isSegmentBreakRunSpace(code, scan)) end = index + 1
      else if (!(scan === 'gecko' && isDiscardable(code, false))) break
    }
    newline = text.indexOf('\n', index)
    if (scan === 'gecko' && text.charCodeAt(end - 1) === 0x20 && isSpaceCombiningSequenceTail(text, end)) end--
    if (text.charCodeAt(start - 1) !== 0x200B && text.charCodeAt(end) !== 0x200B &&
      !(eastAsian && isEastAsianSegmentBreak(text, start, end, japaneseOrChinese))) continue
    result += text.slice(copied, start)
    for (let member = start; member < end; member++) {
      if (!isSegmentBreakRunSpace(text.charCodeAt(member), scan)) result += text[member]
    }
    copied = end
  }
  return copied === 0 ? text : result + text.slice(copied)
}

// Every East Asian wide, fullwidth or halfwidth character is at or above U+1100.
const maybeEastAsianRe = /[\u1100-\uFFFF]/

// Normal white space after the segment break transformation: each run of SPACE, TAB, LF,
// CR and FF becomes one space, or nothing at either end.
function collapseWhitespaceNormal(text: string): string {
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

// The scans read word boundaries only inside runs of Thai, Lao, Khmer and Myanmar
// letters, where no locale changes them. They ask for the segmenter only when such a
// run shows up (Chrome's and Safari's scans also in Tai Le, New Tai Lue, Tai Tham, Tai
// Viet and Ahom runs), so other text prepares without Intl.Segmenter.
let sharedWordSegmenter: Intl.Segmenter | null = null

export function getSharedWordSegmenter(): Intl.Segmenter {
  if (sharedWordSegmenter === null) {
    sharedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  }
  return sharedWordSegmenter
}

export function clearAnalysisCaches(): void {
  sharedWordSegmenter = null
}

const combiningMarkRe = /\p{M}/u

function classifySegmentBreakCode(code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): SegmentBreakKind {
  if (whiteSpace === 'pre-wrap') {
    if (code === 0x20) return 'preserved-space'
    if (code === 0x09) return 'tab'
    if (code === 0x0A) return 'hard-break'
  }
  if (code === 0x20) return 'space'
  if (code === 0x200B) return 'zero-width-break'
  if (code === 0x00AD) return 'soft-hyphen'
  // NEL (UAX #14 NL) offers a break after itself and no ordinary break before it (LB5, LB6),
  // as the scans find. The WebKit profile gives NEL its own control segment for letter
  // spacing: WebKit's simple text path gives NEL no letter spacing, at either sign, and its
  // complex path spaces it. A NEL control segment takes spacing after text in WebKit's
  // complex ranges, or before such text that starts with a combining mark. Preparation
  // cannot see the page direction, so after complex text whose direction differs from the
  // page's it keeps spacing Safari omits. Blink spaces NEL outside cursive runs, and release
  // Gecko draws NEL with no advance while its Canvas measures a space, so both keep NEL as
  // ordinary text.
  if (code === 0x0085 && scan === 'webkit') return 'control'
  return 'text'
}

export function isCollapsibleSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D || code === 0x0C
}

// WebKit and Gecko scan a text node's source, where normalization collapsed white space: in
// normal white space each run of SPACE, TAB, LF, CR and FF became one space, or nothing
// at either end, and in pre-wrap CRLF became LF. A break before a run's first unit is a
// break before what the run became. A break before a later unit, as before a CR after a
// space, follows white space, so it is a break after what the run became. A 2 goes with
// its unit: Gecko's cluster start without a break, which only a unit that stays text
// reads, and WebKit's forced break after a separator, which keeps its 2 at the end too.
// Fills spaceSources, when given, in normal white space.
function mapSourceLineBreaks(source: string, normalizedLength: number, sourceBreaks: Uint8Array, whiteSpace: WhiteSpaceMode, spaceSources: Uint16Array | null): Uint8Array {
  const breaks = new Uint8Array(normalizedLength + 1)
  let normalizedIndex = 0
  if (whiteSpace === 'pre-wrap') {
    for (let i = 0; i < source.length; i++, normalizedIndex++) {
      breaks[normalizedIndex] = sourceBreaks[i]!
      if (source.charCodeAt(i) === 0x0D && source.charCodeAt(i + 1) === 0x0A) {
        i++
        if ((sourceBreaks[i]! & 1) === 1) breaks[normalizedIndex] = sourceBreaks[i]!
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
    if (spaceSources !== null) spaceSources[normalizedIndex] = source.charCodeAt(i)
    const start = i
    for (; i < end; i++) {
      if ((sourceBreaks[i]! & 1) === 1) breaks[i === start ? normalizedIndex : normalizedIndex + 1] = sourceBreaks[i]!
    }
    normalizedIndex++
  }
  if (sourceBreaks[i] === 2) breaks[normalizedLength] = 2
  return breaks
}

// Characters of these kinds share a segment when no break falls between them. Each
// tab, hard break, ZWSP and NEL control stays its own segment.
function gathersKind(kind: SegmentBreakKind): boolean {
  return kind === 'text' || kind === 'space' || kind === 'preserved-space' || kind === 'soft-hyphen'
}

// A control character that stays its own text segment, measured alone: the C0 and C1
// controls that white-space normalization leaves as text, and the line and paragraph
// separators where they don't end a line.
function isControlSegmentCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029
}

// Segments are the text between an engine's break opportunities, split where the
// break kind changes, and a control stays alone. A ZWSP or soft hyphen that the scan
// doesn't break after, as at the start of a WebKit scan, before a combining mark or a
// closing bracket, or under keep-all, is zero-width glue: it stays its own zero-width
// segment, takes no letter spacing and doesn't end a line.
// Combining marks right after it, or after a control, stay apart from the text after
// them, since they shape on the grapheme before it (measureAnalysis). Where the Gecko
// scan marks cluster starts (2), a segment records whether one falls inside it.
function segmentAtLineBreaks(normalized: string, breaks: Uint8Array, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): Segmentation {
  // A break is an odd value. The WebKit scan's 2 after U+2028 or U+2029 makes the separator a hard
  // break in every white-space mode, and the Gecko scan's 3 after a soft hyphen makes it a zero-width
  // break: the line can end there without a hyphen. One with only soft hyphens before it on its
  // chunk stays a soft hyphen, since a zero-width break there holds a line and Firefox, which drops
  // soft hyphens from its text runs, gives it none.
  const followsChunkContent = (i: number): boolean => {
    let j = i - 1
    while (j >= 0 && normalized.charCodeAt(j) === 0x00AD) j--
    return j >= 0 && normalized.charCodeAt(j) !== 0x0A
  }
  const classify = (code: number, i: number): SegmentBreakKind => scan === 'webkit' && breaks[i + 1] === 2 && (code === 0x2028 || code === 0x2029)
    ? 'hard-break'
    : scan === 'gecko' && breaks[i + 1] === 3 && code === 0x00AD && followsChunkContent(i)
      ? 'zero-width-break'
      : classifySegmentBreakCode(code, whiteSpace, scan)
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
      (breaks[i]! & 1) === 0 && !alone && !lastAlone && !(markRun && !combiningMarkRe.test(normalized[i]!)) &&
      kind === kinds[last] && gathersKind(kind)
    ) {
      if (clusterSplits !== null && breaks[i] === 2) clusterSplits[last] = true
      continue
    }
    markRun = (breaks[i]! & 1) === 0 && kind === 'text' && combiningMarkRe.test(normalized[i]!) &&
      (lastAlone || kinds[last] === 'zero-width-break' || kinds[last] === 'soft-hyphen' || kinds[last] === 'control')
    starts.push(i)
    kinds.push(kind)
    clusterSplits?.push(false)
    lastAlone = alone
  }
  // A line ends only where the scan breaks, so the walkers learn where it doesn't:
  // before text, zero-width glue or a control, other than at a line start. A
  // ZWSP or soft hyphen there is zero-width glue. Before a space, tab or hard break
  // the scan has no break either, but the line can still end there, so it keeps its kind.
  const len = kinds.length
  let breaksBefore: boolean[] | null = null
  for (let j = len - 2; j >= 0; j--) {
    const kind = kinds[j]!
    const next = kinds[j + 1]!
    if ((breaks[starts[j + 1]!]! & 1) === 1 || kind === 'hard-break' || !(next === 'text' || next === 'zero-width-glue' || next === 'control')) continue
    if (kind === 'zero-width-break' || kind === 'soft-hyphen') kinds[j] = 'zero-width-glue'
    breaksBefore ??= Array.from({ length: len }, () => true)
    breaksBefore[j + 1] = false
  }
  const texts: string[] = []
  for (let j = 0; j < len; j++) texts.push(normalized.slice(starts[j]!, j + 1 < len ? starts[j + 1]! : normalized.length))
  return { texts, kinds, starts, breaksBefore, clusterSplits }
}

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
  wordBreak: WordBreakMode = 'normal',
  // The page language, which picks Chrome's and WebKit's line tables, WebKit's
  // quotation remap and Gecko's rule for newlines next to East Asian punctuation.
  language: string | null = null,
): TextAnalysis {
  const preserve = whiteSpace === 'pre-wrap'
  // The source a text node's engine scans, after the segment break transformation.
  const source = preserve ? text : removeSkippableSegmentBreaks(text, profile, language)
  const normalized = preserve ? normalizeWhitespacePreWrap(text) : collapseWhitespaceNormal(source)
  if (normalized.length === 0) {
    return {
      source: text,
      normalized,
      spaceSources: null,
      texts: [],
      kinds: [],
      starts: [],
      breaksBefore: null,
      clusterSplits: null,
    }
  }
  const keepAll = wordBreak === 'keep-all'
  let breaks: Uint8Array
  let spaceSources: Uint16Array | null = null
  if (profile.lineBreakScan === 'blink') {
    breaks = getBlinkLineBreaks(normalized, keepAll, language, getSharedWordSegmenter)
  } else {
    // WebKit and Gecko scan the source. Gecko's scan collapses its white space as Firefox does.
    const sourceBreaks = profile.lineBreakScan === 'webkit'
      ? getWebKitLineBreaks(source, preserve, keepAll, language, getSharedWordSegmenter)
      : getGeckoLineBreaks(source, preserve, keepAll, profile.graphemeTable, getSharedWordSegmenter)
    if (profile.lineBreakScan === 'webkit' && !preserve && source !== normalized) spaceSources = new Uint16Array(normalized.length)
    breaks = source === normalized ? sourceBreaks : mapSourceLineBreaks(source, normalized.length, sourceBreaks, whiteSpace, spaceSources)
  }
  return {
    source: text,
    normalized,
    spaceSources,
    ...segmentAtLineBreaks(normalized, breaks, whiteSpace, profile.lineBreakScan),
  }
}
