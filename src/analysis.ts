import { getGeckoLineBreaks, isBidiControl, isDiscardable, isEastAsianSegmentBreak, isJapaneseOrChinese, isSpaceCombiningSequenceTail } from './gecko-line-breaks.js'
import type { CharTable } from './generated/engine-break-data.js'
import { BREAK, CLUSTER_START, FORCED_BREAK, SOFT_HYPHEN_BREAK, getBlinkLineBreaks, getWebKitLineBreaks } from './line-breaks.js'

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
  // letter spacing, no break on either side. A run of bidi controls is glue in Gecko,
  // with the breaks its scan gives around it.
  | 'zero-width-glue'
  | 'hard-break'
  | 'control'

// A segment's flags byte: its kind's code in the low four bits, then what else the
// walkers read of it.
export const TEXT = 0
export const SPACE = 1
export const ZERO_WIDTH_BREAK = 2
export const SOFT_HYPHEN = 3
export const PRESERVED_SPACE = 4
export const TAB = 5
export const ZERO_WIDTH_GLUE = 6
export const CONTROL = 7
// Ends its chunk: a line's walk stops there, and the next line starts after it.
export const HARD_BREAK = 8
export const KIND_BITS = 0x0F
// The segment takes letter spacing after its graphemes. Set by measurement.
export const SPACED = 0x10
// The engine's scan gives no break before the segment, so no line ends there.
export const UNBROKEN = 0x20
// The scan gives a break before the segment, in text that also has unbroken
// boundaries, where a line that overflows at one returns to the latest such break.
export const RETURNABLE = 0x40
// The engine's clusters don't split the segment, so no emergency break splits it
// either. Measurement clears it.
export const ONE_CLUSTER = 0x80
export type SegmentKindCode = typeof TEXT | typeof SPACE | typeof ZERO_WIDTH_BREAK | typeof SOFT_HYPHEN |
  typeof PRESERVED_SPACE | typeof TAB | typeof ZERO_WIDTH_GLUE | typeof CONTROL | typeof HARD_BREAK
// Each kind's name by its code, as prepareWithSegments() gives them.
export const SEGMENT_KINDS: readonly SegmentBreakKind[] = [
  'text', 'space', 'zero-width-break', 'soft-hyphen', 'preserved-space', 'tab', 'zero-width-glue', 'control', 'hard-break',
]

// `spaceSources` holds, in the WebKit profile where normal white space collapsed, the source
// unit each normalized unit starts from, such as the TAB or LF a space came from. Null otherwise.
// `texts` holds each segment's text, `starts` where it starts in `normalized`, and `flags` its
// flags byte: its kind, UNBROKEN where the engine's scan gives no break before text, zero-width
// glue or a control, other than at a line start, RETURNABLE at the other segments of text with
// such a boundary, which `hasUnbroken` tells, and ONE_CLUSTER where the scan has clusters of
// its own.
export type TextAnalysis = {
  normalized: string
  spaceSources: Uint16Array | null
  texts: string[]
  starts: number[]
  flags: number[]
  hasUnbroken: boolean
}

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

const combiningMarkRe = /\p{M}/u

function classifySegmentBreakCode(code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): SegmentKindCode {
  if (whiteSpace === 'pre-wrap') {
    if (code === 0x20) return PRESERVED_SPACE
    if (code === 0x09) return TAB
    if (code === 0x0A) return HARD_BREAK
  }
  if (code === 0x20) return SPACE
  if (code === 0x200B) return ZERO_WIDTH_BREAK
  if (code === 0x00AD) return SOFT_HYPHEN
  // NEL (UAX #14 NL) offers a break after itself and no ordinary break before it (LB5, LB6),
  // as the scans find. The WebKit profile gives NEL its own control segment for letter
  // spacing: WebKit's simple text path gives NEL no letter spacing, at either sign, and its
  // complex path spaces it. A NEL control segment takes spacing after text in WebKit's
  // complex ranges, or before such text that starts with a combining mark. Preparation
  // cannot see the page direction, so after complex text whose direction differs from the
  // page's it keeps spacing Safari omits. Blink spaces NEL outside cursive runs, and release
  // Gecko draws NEL with no advance while its Canvas measures a space, so both keep NEL as
  // ordinary text.
  if (code === 0x0085 && scan === 'webkit') return CONTROL
  return TEXT
}

export function isCollapsibleSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D || code === 0x0C
}

// WebKit and Gecko scan a text node's source, where normalization collapsed white space: in
// normal white space each run of SPACE, TAB, LF, CR and FF became one space, or nothing
// at either end, and in pre-wrap CRLF became LF. A break before a run's first unit is a
// break before what the run became. A break before a later unit, as before a CR after a
// space, follows white space, so it is a break after what the run became. A mark without a
// break goes with its unit: Gecko's cluster start, which only a unit that stays text reads,
// and WebKit's forced break after a separator, which keeps its mark at the end too.
// Fills spaceSources, when given, in normal white space.
function mapSourceLineBreaks(source: string, normalizedLength: number, sourceBreaks: Uint8Array, whiteSpace: WhiteSpaceMode, spaceSources: Uint16Array | null): Uint8Array {
  const breaks = new Uint8Array(normalizedLength + 1)
  let normalizedIndex = 0
  if (whiteSpace === 'pre-wrap') {
    for (let i = 0; i < source.length; i++, normalizedIndex++) {
      breaks[normalizedIndex] = sourceBreaks[i]!
      if (source.charCodeAt(i) === 0x0D && source.charCodeAt(i + 1) === 0x0A) {
        i++
        if ((sourceBreaks[i]! & BREAK) !== 0) breaks[normalizedIndex] = sourceBreaks[i]!
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
    if ((sourceBreaks[i]! & BREAK) === 0 && breaks[normalizedIndex] === 0) breaks[normalizedIndex] = sourceBreaks[i]!
    if (spaceSources !== null) spaceSources[normalizedIndex] = source.charCodeAt(i)
    const start = i
    for (; i < end; i++) {
      if ((sourceBreaks[i]! & BREAK) !== 0) breaks[i === start ? normalizedIndex : normalizedIndex + 1] = sourceBreaks[i]!
    }
    normalizedIndex++
  }
  if ((sourceBreaks[i]! & BREAK) === 0) breaks[normalizedLength] = sourceBreaks[i]!
  return breaks
}

// A FORCED_BREAK after U+2028 or U+2029 makes the separator a hard break in every white-space
// mode, and a SOFT_HYPHEN_BREAK makes a soft hyphen a zero-width break: the line can end there
// without a hyphen. One with only soft hyphens and bidi controls before it on its chunk stays a
// soft hyphen, since a zero-width break there holds a line and Firefox, which drops both from its
// text runs, gives it none.
function classifySegmentUnit(normalized: string, breaks: Uint8Array, i: number, code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): SegmentKindCode {
  if ((code === 0x2028 || code === 0x2029) && (breaks[i + 1]! & FORCED_BREAK) !== 0) return HARD_BREAK
  if (code === 0x00AD && (breaks[i + 1]! & SOFT_HYPHEN_BREAK) !== 0 && followsChunkContent(normalized, i)) return ZERO_WIDTH_BREAK
  return classifySegmentBreakCode(code, whiteSpace, scan)
}

function followsChunkContent(normalized: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && isDiscardable(normalized.charCodeAt(j), false)) j--
  return j >= 0 && normalized.charCodeAt(j) !== 0x0A
}

// Characters of these kinds share a segment when no break falls between them. Each
// tab, hard break, ZWSP and NEL control stays its own segment.
function gathersKind(kind: number): boolean {
  return kind === TEXT || kind === SPACE || kind === PRESERVED_SPACE || kind === SOFT_HYPHEN || kind === ZERO_WIDTH_GLUE
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
// scan marks cluster starts, a segment is ONE_CLUSTER unless one falls inside it.
function segmentAtLineBreaks(normalized: string, spaceSources: Uint16Array | null, breaks: Uint8Array, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan'], dropsBidiControl: boolean): TextAnalysis {
  const oneCluster = scan === 'gecko' ? ONE_CLUSTER : 0
  const starts: number[] = []
  // A plain array, which measurement copies into the prepared handle's bytes: a Uint8Array for
  // each text slowed short texts' preparation (RESEARCH.md, Keeping Work Bounded).
  const flags: number[] = []
  let lastAlone = false
  let markRun = false
  // Gecko drops bidi controls from its text run, as it drops soft hyphens (IsDiscardable,
  // nsTextFrameUtils.cpp:32-49), so it finds no cluster or break at one, gives it no letter
  // spacing, and a line can't hold only such characters: where its scan's text run dropped
  // one, a run of them is zero-width glue.
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    const kind = dropsBidiControl && isBidiControl(code) ? ZERO_WIDTH_GLUE : classifySegmentUnit(normalized, breaks, i, code, whiteSpace, scan)
    const alone = kind === TEXT && isControlSegmentCode(code)
    const last = flags.length - 1
    // The first unit has no segment before it to join, so it starts one.
    const lastKind = last < 0 ? -1 : flags[last]! & KIND_BITS
    const unbroken = (breaks[i]! & BREAK) === 0
    if (
      unbroken && !alone && !lastAlone && !(markRun && !combiningMarkRe.test(normalized[i]!)) &&
      kind === lastKind && gathersKind(kind)
    ) {
      if ((breaks[i]! & CLUSTER_START) !== 0) flags[last] = flags[last]! & ~ONE_CLUSTER
      continue
    }
    markRun = unbroken && kind === TEXT && combiningMarkRe.test(normalized[i]!) &&
      (lastAlone || lastKind === ZERO_WIDTH_BREAK || lastKind === SOFT_HYPHEN || lastKind === CONTROL)
    starts.push(i)
    flags.push(kind | oneCluster)
    lastAlone = alone
  }
  // A line ends only where the scan breaks, so the walkers learn where it doesn't:
  // before text, zero-width glue or a control, other than at a line start. A
  // ZWSP or soft hyphen there is zero-width glue. Before a space, tab or hard break
  // the scan has no break either, but the line can still end there, so it keeps its kind.
  let hasUnbroken = false
  const count = flags.length
  for (let j = count - 2; j >= 0; j--) {
    const kind = flags[j]! & KIND_BITS
    const next = flags[j + 1]! & KIND_BITS
    if ((breaks[starts[j + 1]!]! & BREAK) !== 0 || kind === HARD_BREAK || !(next === TEXT || next === ZERO_WIDTH_GLUE || next === CONTROL)) continue
    // Gecko's line breaker doesn't see a run of bidi controls, the only glue here before the
    // loop reaches it: the boundary before one is the boundary after it, which the loop has
    // passed, and text after one that starts a chunk starts its line.
    if (scan === 'gecko' && (
      (kind === ZERO_WIDTH_GLUE && (j === 0 || (flags[j - 1]! & KIND_BITS) === HARD_BREAK)) ||
      (next === ZERO_WIDTH_GLUE && isBidiControl(normalized.charCodeAt(starts[j + 1]!)) && (j + 2 === count || (flags[j + 2]! & UNBROKEN) === 0))
    )) continue
    if (kind === ZERO_WIDTH_BREAK || kind === SOFT_HYPHEN) flags[j] = flags[j]! & ~KIND_BITS | ZERO_WIDTH_GLUE
    flags[j + 1] = flags[j + 1]! | UNBROKEN
    hasUnbroken = true
  }
  if (hasUnbroken) for (let j = 0; j < count; j++) if ((flags[j]! & UNBROKEN) === 0) flags[j] = flags[j]! | RETURNABLE
  // Each segment's text, sliced once here for measurement and the neighbours it reads: sliced
  // where measurement reads it, Firefox's rich-inline preparation ran 11-19% slower (RESEARCH.md,
  // Keeping Work Bounded).
  const texts: string[] = []
  for (let j = 0; j < count; j++) texts.push(normalized.slice(starts[j], j + 1 < count ? starts[j + 1] : normalized.length))
  return { normalized, spaceSources, texts, starts, flags, hasUnbroken }
}

export function analyzeText(
  text: string,
  profile: AnalysisProfile,
  whiteSpace: WhiteSpaceMode = 'normal',
  wordBreak: WordBreakMode = 'normal',
  // Preparation's language (getPreparationLanguage), which picks Chrome's and WebKit's
  // line tables, WebKit's quotation remap and Gecko's rule for newlines next to East
  // Asian punctuation.
  language: string | null = null,
): TextAnalysis {
  const preserve = whiteSpace === 'pre-wrap'
  // The source a text node's engine scans, after the segment break transformation.
  const source = preserve ? text : removeSkippableSegmentBreaks(text, profile, language)
  const normalized = preserve ? normalizeWhitespacePreWrap(text) : collapseWhitespaceNormal(source)
  const keepAll = wordBreak === 'keep-all'
  let breaks: Uint8Array
  let spaceSources: Uint16Array | null = null
  let dropsBidiControl = false
  if (profile.lineBreakScan === 'blink') {
    breaks = getBlinkLineBreaks(normalized, keepAll, language)
  } else {
    // WebKit and Gecko scan the source. Gecko's scan collapses its white space as Firefox does.
    let sourceBreaks: Uint8Array
    if (profile.lineBreakScan === 'webkit') {
      sourceBreaks = getWebKitLineBreaks(source, preserve, keepAll, language)
    } else {
      const gecko = getGeckoLineBreaks(source, preserve, keepAll, profile.graphemeTable)
      sourceBreaks = gecko.breaks
      dropsBidiControl = gecko.dropsBidiControl
    }
    if (profile.lineBreakScan === 'webkit' && !preserve && source !== normalized) spaceSources = new Uint16Array(normalized.length)
    breaks = source === normalized ? sourceBreaks : mapSourceLineBreaks(source, normalized.length, sourceBreaks, whiteSpace, spaceSources)
  }
  return segmentAtLineBreaks(normalized, spaceSources, breaks, whiteSpace, profile.lineBreakScan, dropsBidiControl)
}
