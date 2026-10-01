import { getGeckoLineBreaks, isClusterExtender, isDiscardable, isEastAsianSegmentBreak, isJapaneseOrChinese, isSpaceCombiningSequenceTail } from './gecko-line-breaks.js'
import { isBidiControl, type GraphemeTable } from './graphemes.js'
import { BREAK, CLUSTER_START, FORCED_BREAK, ITEM_START, SOFT_HYPHEN_BREAK, getBlinkLineBreaks, getWebKitBreakBetweenItems, getWebKitLineBreaks } from './line-breaks.js'

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
// In a rich-inline paragraph's handle (src/rich-inline.ts), an atomic item or a box: one object, with a break on both
// sides and none inside, which lays out as text does otherwise. No analysis makes one. The start edge of a padded item
// that opens with white space or a hard break is one too, with no break before it where the text has none there.
export const OBJECT = 9
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
// In a rich-inline paragraph's handle, whose flags measurement has cleared ONE_CLUSTER from, the same bit marks the
// segment each item after the first starts at (src/rich-inline.ts).
export const STARTS_ITEM = 0x80
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
  graphemeTable: GraphemeTable
}

// The items of a rich-inline paragraph in its text (src/rich-inline.ts): where each starts there, whether it is atomic,
// one U+FFFC in the text, as Blink and Gecko put an atomic inline in a paragraph's text (inline_node.cc:408-422,
// nsBidiPresUtils.cpp:1385-1396), and whether the engine transforms segment breaks in each item's text apart
// (EngineProfile, transformsSegmentBreaksAcrossItems). Every item starts a segment, and an atomic item is a segment with
// a break on both sides. The analysis leaves in `sourceOffsets` the offset in the text that each unit of its
// normalized text comes from.
export type ParagraphItems = {
  starts: number[]
  atomic: boolean[]
  ownSegmentBreaks: boolean
  sourceOffsets: Int32Array | null
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

// Gecko's white-space run reads through the bidi controls in it, which its text run drops, and
// keeps its segment break if it holds one, or else its first white space (TransformWhiteSpaces,
// nsTextFrameUtils.cpp:151-193), and a last space before a combining sequence tail as the tail's
// base (TransformText, nsTextFrameUtils.cpp:319-345). So the run's other white space goes, and so
// does white space before only bidi controls at the end, which the line end trims.
const whiteSpaceThroughBidiControlsRe = /(?<![ \t\n\r\f])[ \t\n\r\f]+(?:[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+[ \t\n\r\f]*)+/g
// The same run through soft hyphens too, which Gecko's text run drops as it drops bidi controls (IsDiscardable,
// nsTextFrameUtils.cpp:32-49): Firefox lays out `ab`, ` \u00AD \u00AD`, `cd` in 16px Arial in one 39.15px line at 40px.
// A rich-inline paragraph's analysis takes it; a text's doesn't yet (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
const whiteSpaceThroughDroppedRe = /(?<![ \t\n\r\f])[ \t\n\r\f]+(?:[\u00AD\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+[ \t\n\r\f]*)+/g
// `itemStarts`, for a rich-inline paragraph, has where each item starts in the text: the run goes on from one text
// frame to the next (INCOMING_WHITESPACE), so white space that starts an item collapses into it, but one of the dropped
// characters that follows no white space in its own frame ends it (nsTextFrameUtils.cpp:286-386). Firefox fits
// `see this` of items `see`, ` \u00AD`, ` this word` in 16px Arial at 56px on a 55.15px line, and not of `see `,
// `\u00AD `, `this word`.
function collapseWhiteSpaceThroughBidiControls(text: string, re: RegExp, itemStarts: number[] | null): string {
  return text.replace(re, (run: string, at: number) => collapseWhiteSpaceRun(text, re, run, at, itemStarts))
}

function collapseWhiteSpaceRun(text: string, re: RegExp, run: string, at: number, itemStarts: number[] | null): string {
  if (itemStarts !== null) {
    for (let k = 1; k < run.length; k++) {
      if (isCollapsibleSpaceCode(run.charCodeAt(k)) || !itemStarts.includes(at + k)) continue
      const head = run.slice(0, k)
      const tail = run.slice(k).replace(re, (rest: string, restAt: number) => collapseWhiteSpaceRun(text, re, rest, at + k + restAt, itemStarts))
      return (head.trim() === '' ? head : collapseWhiteSpaceRun(text, re, head, at, null)) + tail
    }
  }
  if (at + run.length === text.length) return run.replace(collapsibleWhitespaceRunRe, '')
  let last = run.length - 1
  while (!isCollapsibleSpaceCode(run.charCodeAt(last))) last--
  const base = last > 0 && run.charCodeAt(last) === 0x20 && isSpaceCombiningSequenceTail(text, at + last + 1)
  const kept = Math.max(run.indexOf('\n'), 0)
  const end = base ? last : run.length
  return run.slice(0, kept).replace(collapsibleWhitespaceRunRe, '') + run[kept] + run.slice(kept + 1, end).replace(collapsibleWhitespaceRunRe, '') + (base ? run.slice(last) : '')
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
// without a hyphen. One with only soft hyphens before it on its chunk stays a soft hyphen, since
// a zero-width break there holds a line and Firefox, which drops soft hyphens from its text runs,
// gives it none.
function classifySegmentUnit(normalized: string, breaks: Uint8Array, i: number, code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): SegmentKindCode {
  if ((code === 0x2028 || code === 0x2029) && (breaks[i + 1]! & FORCED_BREAK) !== 0) return HARD_BREAK
  if (code === 0x00AD && (breaks[i + 1]! & SOFT_HYPHEN_BREAK) !== 0 && followsChunkContent(normalized, i)) return ZERO_WIDTH_BREAK
  return classifySegmentBreakCode(code, whiteSpace, scan)
}

function followsChunkContent(normalized: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && normalized.charCodeAt(j) === 0x00AD) j--
  return j >= 0 && normalized.charCodeAt(j) !== 0x0A
}

// Characters of these kinds share a segment when no break falls between them. Each
// tab, hard break, ZWSP and NEL control stays its own segment.
function gathersKind(kind: number): boolean {
  return kind === TEXT || kind === SPACE || kind === PRESERVED_SPACE || kind === SOFT_HYPHEN
}

// A control character that stays its own text segment, measured alone: the C0 and C1
// controls that white-space normalization leaves as text, and the line and paragraph
// separators where they don't end a line.
function isControlSegmentCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029
}

// Segments are the text between an engine's break opportunities, split where the
// break kind changes and where a rich-inline paragraph's item starts, and a control stays alone.
// A run of what Gecko's text run drops (below) isn't split where an item starts inside it. A ZWSP or soft hyphen that the scan
// doesn't break after, as at the start of a WebKit scan, before a combining mark or a
// closing bracket, or under keep-all, is zero-width glue: it stays its own zero-width
// segment, takes no letter spacing and doesn't end a line.
// Combining marks right after it, or after a control, stay apart from the text after
// them, since they shape on the grapheme before it (measureAnalysis). Where the Gecko
// scan marks cluster starts, a segment is ONE_CLUSTER unless one falls inside it.
//
// Firefox leaves soft hyphens and bidi controls out of the text run it breaks and maps a line end
// past the characters it left out (IsDiscardable, nsTextFrameUtils.cpp:32-49; nsTextFrame.cpp:
// 11161-11170), so a line ends after a run of them, never before one, and none starts with one
// after a wrap. Where the Gecko scan's text run left out a bidi control, a run of such characters
// with a control in it goes with the segment before it up to its last control: the scan finds no
// break inside the run and gives the one after it after the run. A soft hyphen after the last
// control keeps its break, and one before it offers none (GetHyphenationBreaks,
// nsTextFrame.cpp:4436-4442). A run that starts a chunk is a text segment that starts its line,
// with the text after it: Firefox trims no leading space there, since the content doesn't start
// with one (nsTextFrame.cpp:10935-10950), and the break the scan gives after the run, after a hard
// break or collapsed leading white space, can't end a line that holds nothing yet. A chunk of only
// such a run is no content of its own, so the hard break before it takes it (nsTextFrame.cpp:
// 11421-11429). After a control or marks that stay alone, the run starts a text segment. The
// profile's graphemes look past these characters (src/graphemes.ts), so a cluster extender after
// them joins the cluster before, unless a bidi level run starts at it, where the scan starts a
// cluster (gfxTextRun.cpp:2828-2835) and the extender starts a segment.
function segmentAtLineBreaks(normalized: string, spaceSources: Uint16Array | null, breaks: Uint8Array, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan'], dropsBidiControl: boolean): TextAnalysis {
  const oneCluster = scan === 'gecko' ? ONE_CLUSTER : 0
  const starts: number[] = []
  // A plain array, which measurement copies into the prepared handle's bytes: a Uint8Array for
  // each text slowed short texts' preparation (RESEARCH.md, Keeping Work Bounded).
  const flags: number[] = []
  let lastAlone = false
  let markRun = false
  // Where the last run of what the text run drops, handled at its start, ends.
  let droppedEnd = -1
  // The last segment's kind, -1 before the first unit, which starts one.
  let lastKind = -1
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    if (dropsBidiControl && i < droppedEnd) continue
    if (dropsBidiControl && isDiscardable(code, false) && (i === 0 || (breaks[i]! & ITEM_START) !== 0 || !isDiscardable(normalized.charCodeAt(i - 1), false))) {
      // The run of what the text run drops from here, up to where a rich-inline item starts inside it, and
      // where its last bidi control ends.
      let j = i
      let controlEnd = -1
      for (; j < normalized.length && isDiscardable(normalized.charCodeAt(j), false) && (j === i || (breaks[j]! & ITEM_START) === 0); j++) if (isBidiControl(normalized.charCodeAt(j))) controlEnd = j + 1
      if (controlEnd > 0) {
        // A rich-inline item that starts with the run starts a text segment with the text after it, as a
        // chunk does, so its fragments keep the controls it starts with, after the break the scan gives
        // at the run.
        const startsItem = lastKind >= 0 && lastKind !== HARD_BREAK && (breaks[i]! & ITEM_START) !== 0
        const chunkStart = lastKind < 0 || lastKind === HARD_BREAK || startsItem
        if (chunkStart) {
          const endsChunk = j === normalized.length || classifySegmentUnit(normalized, breaks, j, normalized.charCodeAt(j), whiteSpace, scan) === HARD_BREAK
          if (!endsChunk) {
            if (startsItem) breaks[i] = breaks[i]! | (breaks[j]! & BREAK)
            breaks[j] = breaks[j]! & ~(BREAK | SOFT_HYPHEN_BREAK)
          }
          droppedEnd = j
          if (endsChunk && lastKind >= 0) continue
        } else {
          droppedEnd = controlEnd
        }
        if (chunkStart || lastAlone || markRun) {
          starts.push(i)
          flags.push(TEXT | oneCluster)
          lastKind = TEXT
          lastAlone = false
          markRun = false
        }
        continue
      }
    }
    const kind = classifySegmentUnit(normalized, breaks, i, code, whiteSpace, scan)
    const alone = kind === TEXT && isControlSegmentCode(code)
    const unbroken = (breaks[i]! & BREAK) === 0
    const levelRunExtender = dropsBidiControl && i === droppedEnd && (breaks[i]! & CLUSTER_START) !== 0 && isBidiControl(normalized.charCodeAt(i - 1)) &&
      isClusterExtender(normalized.codePointAt(i)!)
    if (
      (breaks[i]! & (BREAK | ITEM_START)) === 0 && !alone && !lastAlone && !(markRun && !combiningMarkRe.test(normalized[i]!)) &&
      !levelRunExtender && kind === lastKind && gathersKind(kind)
    ) {
      if ((breaks[i]! & CLUSTER_START) !== 0) flags[flags.length - 1] = flags[flags.length - 1]! & ~ONE_CLUSTER
      continue
    }
    markRun = unbroken && kind === TEXT && combiningMarkRe.test(normalized[i]!) &&
      (lastAlone || lastKind === ZERO_WIDTH_BREAK || lastKind === SOFT_HYPHEN || lastKind === CONTROL)
    starts.push(i)
    flags.push(kind | oneCluster)
    lastKind = kind
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
  // The items of the rich-inline paragraph whose text this is, else null.
  paragraph: ParagraphItems | null = null,
): TextAnalysis {
  const preserve = whiteSpace === 'pre-wrap'
  // The source a text node's engine scans, after the segment break transformation.
  // Where each of a paragraph's items starts in that source.
  const scanStarts: number[] | null = paragraph === null ? null : []
  let source = preserve ? text
    : paragraph !== null && paragraph.ownSegmentBreaks ? removeItemsSkippableSegmentBreaks(text, paragraph.starts, profile, language, scanStarts!)
    : removeSkippableSegmentBreaks(text, profile, language)
  let normalized = preserve ? normalizeWhitespacePreWrap(text) : collapseWhitespaceNormal(source)
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
      sourceBreaks = paragraph === null ? getWebKitLineBreaks(source, preserve, keepAll, language) : getWebKitParagraphBreaks(source, paragraph, preserve, keepAll, language)
    } else {
      let gecko = getGeckoLineBreaks(source, preserve, keepAll, profile.graphemeTable)
      dropsBidiControl = gecko.dropsBidiControl
      // Where that collapse drops white space, the scan runs again: its text run is the same, but
      // its offsets move.
      const collapsed = preserve ? source
        : paragraph !== null && (dropsBidiControl || source.includes('\u00AD')) ? collapseWhiteSpaceThroughBidiControls(source, whiteSpaceThroughDroppedRe, scanStarts)
        : dropsBidiControl ? collapseWhiteSpaceThroughBidiControls(source, whiteSpaceThroughBidiControlsRe, null)
        : source
      if (collapsed !== source) {
        source = collapsed
        normalized = collapseWhitespaceNormal(source)
        gecko = getGeckoLineBreaks(source, preserve, keepAll, profile.graphemeTable)
      }
      sourceBreaks = gecko.breaks
    }
    if (profile.lineBreakScan === 'webkit' && !preserve && source !== normalized) spaceSources = new Uint16Array(normalized.length)
    breaks = source === normalized ? sourceBreaks : mapSourceLineBreaks(source, normalized.length, sourceBreaks, whiteSpace, spaceSources)
  }
  if (paragraph !== null) markItemStarts(text, normalized, breaks, paragraph)
  return segmentAtLineBreaks(normalized, spaceSources, breaks, whiteSpace, profile.lineBreakScan, dropsBidiControl)
}

// A paragraph's text after each item's own segment break transformation, where the engine transforms segment breaks in
// each text frame's text apart (ParagraphItems), and where each item starts in it.
function removeItemsSkippableSegmentBreaks(text: string, starts: number[], profile: AnalysisProfile, language: string | null, resultStarts: number[]): string {
  if (profile.lineBreakScan === 'webkit' || !text.includes('\n')) {
    for (let k = 0; k < starts.length; k++) resultStarts.push(starts[k]!)
    return text
  }
  let result = ''
  for (let k = 0; k < starts.length; k++) {
    resultStarts.push(result.length)
    result += removeSkippableSegmentBreaks(text.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : text.length), profile, language)
  }
  return result
}

// The offset in `source` that each unit of `normalized` comes from. Normalization only removes collapsible white space,
// turns a run of it into one space, which comes from the run's first unit, and turns CR, CRLF and FF into LF, so a
// greedy walk aligns the two.
export function alignToSource(source: string, normalized: string): Int32Array {
  const offsets = new Int32Array(normalized.length)
  let i = 0
  for (let j = 0; j < normalized.length; j++) {
    const unit = normalized.charCodeAt(j)
    while (i < source.length) {
      const code = source.charCodeAt(i)
      if (code === unit || (isCollapsibleSpaceCode(code) && (unit === 0x20 || unit === 0x0A))) break
      i++
    }
    offsets[j] = i++
    // CRLF became one LF.
    if (unit === 0x0A && source.charCodeAt(i - 1) === 0x0D && source.charCodeAt(i) === 0x0A) i++
  }
  return offsets
}

// Marks where each item of a paragraph starts in its normalized text (ITEM_START), at the first unit that comes from
// the item or from one after it, and a break on both sides of an atomic item, under keep-all too: Blink breaks after an
// atomic inline and before one (CanBreakAfterAtomicInline and CanBreakAfter, line_breaker.cc:1168-1263 in
// core/layout/inline), WebKit finds a soft wrap opportunity on either side of one (InlineFormattingUtils.cpp:445-449),
// and Gecko records a break after one and breaks before one that doesn't fit (nsLineLayout.cpp:1057-1068, 1339-1340).
function markItemStarts(text: string, normalized: string, breaks: Uint8Array, paragraph: ParagraphItems): void {
  const offsets = paragraph.sourceOffsets = alignToSource(text, normalized)
  const { starts, atomic } = paragraph
  for (let k = 0, j = 0; k < starts.length; k++) {
    while (j < normalized.length && offsets[j]! < starts[k]!) j++
    if (j === normalized.length) break
    breaks[j] = breaks[j]! | ITEM_START
    if (atomic[k] && offsets[j] === starts[k]) {
      breaks[j] = breaks[j]! | BREAK
      breaks[j + 1] = breaks[j + 1]! | BREAK | ITEM_START
    }
  }
}

// Where a line may start in a paragraph's source, in WebKit: it finds breaks inside each inline box from that box's own
// text, and at a boundary between boxes from the scan over the next box's text with the last two characters before it
// as prior context (TextUtil.cpp:374-396), so a paragraph's breaks are each item's own scan, joined by that check
// (getWebKitBreakBetweenItems). Collapsible white space on either side of a boundary breaks there, as inside a text.
function getWebKitParagraphBreaks(source: string, paragraph: ParagraphItems, preserve: boolean, keepAll: boolean, language: string | null): Uint8Array {
  const { starts, atomic } = paragraph
  const breaks = new Uint8Array(source.length + 1)
  let previous = -1
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k]!
    const end = k + 1 < starts.length ? starts[k + 1]! : source.length
    if (start === end) continue
    const itemText = source.slice(start, end)
    const itemBreaks = getWebKitLineBreaks(itemText, preserve, keepAll, language)
    for (let i = 1; i <= end - start; i++) breaks[start + i] = itemBreaks[i]!
    if (previous >= 0 && !atomic[k] && !atomic[previous]) {
      const collapses = !preserve && (isCollapsibleSpaceCode(source.charCodeAt(start)) || isCollapsibleSpaceCode(source.charCodeAt(start - 1)))
      if (collapses || getWebKitBreakBetweenItems(source.slice(Math.max(starts[previous]!, start - 2), start), itemText, keepAll, language)) breaks[start] = breaks[start]! | BREAK
    }
    previous = k
  }
  return breaks
}
