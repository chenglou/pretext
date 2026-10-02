import { getGeckoLineBreaks, isClusterExtender, isDiscardable, isEastAsianSegmentBreak, isJapaneseOrChinese, isSpaceCombiningSequenceTail, isSpaceOrTabOrSegmentBreak } from './gecko-line-breaks.js'
import { isBidiControl, type GraphemeTable } from './graphemes.js'
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
  // letter spacing, no break on either side.
  | 'zero-width-glue'
  | 'hard-break'
  | 'control'

// A segment's flags byte holds its kind's code in the low four bits, then what else the
// walkers read of it. Const enums, so that the built code holds each use as its number:
// as `const`s they were variables of the module, and Firefox 156 ran layout()'s counting
// loop up to 16% slower or faster by the names a minifier gave them (RESEARCH.md,
// JavaScript Engines).
export const enum SegmentKind {
  Text = 0,
  Space = 1,
  ZeroWidthBreak = 2,
  SoftHyphen = 3,
  PreservedSpace = 4,
  Tab = 5,
  ZeroWidthGlue = 6,
  Control = 7,
  // Ends its chunk: a line's walk stops there, and the next line starts after it.
  HardBreak = 8,
}
export const enum SegmentFlag {
  KindBits = 0x0F,
  // The segment takes letter spacing after its graphemes. Set by measurement.
  Spaced = 0x10,
  // The engine's scan gives no break before the segment, so no line ends there.
  Unbroken = 0x20,
  // The scan gives a break before the segment, in text that also has unbroken
  // boundaries, where a line that overflows at one returns to the latest such break.
  Returnable = 0x40,
  // The engine's clusters don't split the segment, so no emergency break splits it
  // either. Measurement clears it.
  OneCluster = 0x80,
}
// Sets of kinds, a bit per code. In this file, not beside its uses in src/line-break.ts:
// Bun's bundler writes a member as its number only where one file gives its value.
export const enum SegmentKindSet {
  // A line can end after a segment of these kinds.
  BreakAfter = 1 << SegmentKind.Space | 1 << SegmentKind.ZeroWidthBreak | 1 << SegmentKind.SoftHyphen | 1 << SegmentKind.PreservedSpace | 1 << SegmentKind.Tab,
}
// Each kind's name by its code, as prepareWithSegments() gives them.
export const SEGMENT_KINDS: readonly SegmentBreakKind[] = [
  'text', 'space', 'zero-width-break', 'soft-hyphen', 'preserved-space', 'tab', 'zero-width-glue', 'control', 'hard-break',
]

// `spaceSources` holds, in the WebKit profile where normal white space collapsed, the source
// unit each normalized unit starts from, such as the TAB or LF a space came from. Null otherwise.
// `texts` holds each segment's text, `starts` where it starts in `normalized`, and `flags` its
// flags byte: its kind, Unbroken where the engine's scan gives no break before text, zero-width
// glue or a control, other than at a line start, and where tabs don't hang before a tab or
// the spaces after one, Returnable at the other segments of text with such a boundary, which
// `hasUnbroken` tells, and OneCluster where the scan has clusters of its own.
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
  hangTabs: boolean
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
// Characters outside the run, such as FF, keep the ordinary collapse, or take no room in the
// Gecko profile (analyzeText). `removed`, when given, takes the index of each unit removed, in
// order.
export function removeSkippableSegmentBreaks(text: string, profile: AnalysisProfile, language: string | null = null, removed: number[] | null = null): string {
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
      else removed?.push(member)
    }
    copied = end
  }
  return copied === 0 ? text : result + text.slice(copied)
}

// Where the collapsible white space that ends text[from, text.length) starts, which the analysis
// leaves out and a line end trims, or the text's length where none ends it. Gecko's white-space
// run reads through the bidi controls in it and after it (TransformText, nsTextFrameUtils.cpp:
// 319-345), so there it is the first white space after the last character that is neither, and
// the controls stay.
export function getTrailingCollapsibleStart(text: string, from: number, profile: AnalysisProfile): number {
  let start = text.length
  for (let i = text.length - 1; i >= from; i--) {
    const code = text.charCodeAt(i)
    if (isCollapsibleSpaceCode(code)) start = i
    else if (!(profile.lineBreakScan === 'gecko' && isBidiControl(code))) break
  }
  return start
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

function classifySegmentBreakCode(code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan']): SegmentKind {
  if (whiteSpace === 'pre-wrap') {
    if (code === 0x20) return SegmentKind.PreservedSpace
    if (code === 0x09) return SegmentKind.Tab
    if (code === 0x0A) return SegmentKind.HardBreak
  }
  if (code === 0x20) return SegmentKind.Space
  if (code === 0x200B) return SegmentKind.ZeroWidthBreak
  if (code === 0x00AD) return SegmentKind.SoftHyphen
  // NEL (UAX #14 NL) offers a break after itself and no ordinary break before it (LB5, LB6),
  // as the scans find. The WebKit profile gives NEL its own control segment for letter
  // spacing: WebKit's simple text path gives NEL no letter spacing, at either sign, and its
  // complex path spaces it. A NEL control segment takes spacing after text in WebKit's
  // complex ranges, or before such text that starts with a combining mark. Preparation
  // cannot see the page direction, so after complex text whose direction differs from the
  // page's it keeps spacing Safari omits. Blink spaces NEL outside cursive runs, and release
  // Gecko draws NEL with no advance while its Canvas measures a space, so both keep NEL as
  // ordinary text.
  if (code === 0x0085 && scan === 'webkit') return SegmentKind.Control
  return SegmentKind.Text
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
// gives it none. Text that continues a line with content before it, as a rich-inline window
// after a collapsible space does, has content before its start.
function classifySegmentUnit(normalized: string, breaks: Uint8Array, i: number, code: number, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan'], afterContent: boolean): SegmentKind {
  if ((code === 0x2028 || code === 0x2029) && (breaks[i + 1]! & FORCED_BREAK) !== 0) return SegmentKind.HardBreak
  if (code === 0x00AD && (breaks[i + 1]! & SOFT_HYPHEN_BREAK) !== 0 && followsChunkContent(normalized, i, afterContent)) return SegmentKind.ZeroWidthBreak
  return classifySegmentBreakCode(code, whiteSpace, scan)
}

function followsChunkContent(normalized: string, i: number, afterContent: boolean): boolean {
  let j = i - 1
  while (j >= 0 && normalized.charCodeAt(j) === 0x00AD) j--
  return j >= 0 ? normalized.charCodeAt(j) !== 0x0A : afterContent
}

// Characters of these kinds share a segment when no break falls between them. Each
// tab, hard break, ZWSP and NEL control stays its own segment.
function gathersKind(kind: number): boolean {
  return kind === SegmentKind.Text || kind === SegmentKind.Space || kind === SegmentKind.PreservedSpace || kind === SegmentKind.SoftHyphen
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
// scan marks cluster starts, a segment is OneCluster unless one falls inside it.
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
function segmentAtLineBreaks(normalized: string, spaceSources: Uint16Array | null, breaks: Uint8Array, whiteSpace: WhiteSpaceMode, scan: AnalysisProfile['lineBreakScan'], hangTabs: boolean, afterContent: boolean, dropsBidiControl: boolean): TextAnalysis {
  const oneCluster = scan === 'gecko' ? SegmentFlag.OneCluster : 0
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
    if (dropsBidiControl && isDiscardable(code, false) && (i === 0 || !isDiscardable(normalized.charCodeAt(i - 1), false))) {
      // The run of what the text run drops from here, and where its last bidi control ends.
      let j = i
      let controlEnd = -1
      for (; j < normalized.length && isDiscardable(normalized.charCodeAt(j), false); j++) if (isBidiControl(normalized.charCodeAt(j))) controlEnd = j + 1
      if (controlEnd > 0) {
        const chunkStart = lastKind < 0 || lastKind === SegmentKind.HardBreak
        if (chunkStart) {
          const endsChunk = j === normalized.length || classifySegmentUnit(normalized, breaks, j, normalized.charCodeAt(j), whiteSpace, scan, afterContent) === SegmentKind.HardBreak
          if (!endsChunk) breaks[j] = breaks[j]! & ~(BREAK | SOFT_HYPHEN_BREAK)
          droppedEnd = j
          if (endsChunk && lastKind >= 0) continue
        } else {
          droppedEnd = controlEnd
        }
        if (chunkStart || lastAlone || markRun) {
          starts.push(i)
          flags.push(SegmentKind.Text | oneCluster)
          lastKind = SegmentKind.Text
          lastAlone = false
          markRun = false
        }
        continue
      }
    }
    const kind = classifySegmentUnit(normalized, breaks, i, code, whiteSpace, scan, afterContent)
    const alone = kind === SegmentKind.Text && isControlSegmentCode(code)
    const unbroken = (breaks[i]! & BREAK) === 0
    const levelRunExtender = dropsBidiControl && i === droppedEnd && (breaks[i]! & CLUSTER_START) !== 0 && isBidiControl(normalized.charCodeAt(i - 1)) &&
      isClusterExtender(normalized.codePointAt(i)!)
    if (
      unbroken && !alone && !lastAlone && !(markRun && !combiningMarkRe.test(normalized[i]!)) &&
      !levelRunExtender && kind === lastKind && gathersKind(kind)
    ) {
      if ((breaks[i]! & CLUSTER_START) !== 0) flags[flags.length - 1] = flags[flags.length - 1]! & ~SegmentFlag.OneCluster
      continue
    }
    markRun = unbroken && kind === SegmentKind.Text && combiningMarkRe.test(normalized[i]!) &&
      (lastAlone || lastKind === SegmentKind.ZeroWidthBreak || lastKind === SegmentKind.SoftHyphen || lastKind === SegmentKind.Control)
    starts.push(i)
    flags.push(kind | oneCluster)
    lastKind = kind
    lastAlone = alone
  }
  // A line ends only where the scan breaks, so the walkers learn where it doesn't:
  // before text, zero-width glue or a control, other than at a line start. A
  // ZWSP or soft hyphen there is zero-width glue. Before a space, tab or hard break
  // the scan has no break either, but the line can still end there, as they hang or
  // end it, so it keeps its kind. A tab that doesn't hang (EngineProfile's hangTabs) ends
  // no line before itself, nor do the spaces after it, which hang only where the run of
  // white space ends the line: Gecko breaks only after the whole run (nsLineBreaker.cpp:
  // 318-330). A soft hyphen before the tab keeps its break (GetHyphenationBreaks,
  // nsTextFrame.cpp:4409-4457).
  let hasUnbroken = false
  const count = flags.length
  for (let j = count - 2; j >= 0; j--) {
    const kind = flags[j]! & SegmentFlag.KindBits
    const next = flags[j + 1]! & SegmentFlag.KindBits
    if ((breaks[starts[j + 1]!]! & BREAK) !== 0 || kind === SegmentKind.HardBreak) continue
    if (!hangTabs && (next === SegmentKind.Tab || (next === SegmentKind.PreservedSpace && kind === SegmentKind.Tab))) {
      if (kind === SegmentKind.SoftHyphen) continue
    } else if (next === SegmentKind.Text || next === SegmentKind.ZeroWidthGlue || next === SegmentKind.Control) {
      if (kind === SegmentKind.ZeroWidthBreak || kind === SegmentKind.SoftHyphen) flags[j] = flags[j]! & ~SegmentFlag.KindBits | SegmentKind.ZeroWidthGlue
    } else {
      continue
    }
    flags[j + 1] = flags[j + 1]! | SegmentFlag.Unbroken
    hasUnbroken = true
  }
  if (hasUnbroken) for (let j = 0; j < count; j++) if ((flags[j]! & SegmentFlag.Unbroken) === 0) flags[j] = flags[j]! | SegmentFlag.Returnable
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
  // Whether the text continues a line that has content before it (classifySegmentUnit).
  afterContent = false,
): TextAnalysis {
  const preserve = whiteSpace === 'pre-wrap'
  // The source a text node's engine scans, after the segment break transformation.
  let source = preserve ? text : removeSkippableSegmentBreaks(text, profile, language)
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
      sourceBreaks = getWebKitLineBreaks(source, preserve, keepAll, language)
    } else {
      const gecko = getGeckoLineBreaks(source, preserve, keepAll, profile.graphemeTable)
      dropsBidiControl = gecko.dropsBidiControl
      sourceBreaks = gecko.breaks
      // Gecko's white-space run reads through the soft hyphens and bidi controls in it, which its
      // text run drops, and keeps its segment break if it holds one, or else its first white space
      // (TransformWhiteSpaces, nsTextFrameUtils.cpp:151-193); the scan takes the text as one text
      // frame (transformText in src/gecko-line-breaks.ts). The white space the scan's text run left
      // out of such a run leaves the source too, and so does white space before only bidi controls
      // at the end, which the line end trims, and a CR or FF, which ends a run and takes no room
      // (the CR of a CRLF stays, to collapse into the line feed's space); white space on its two
      // sides then touches and is one space, where Firefox keeps two.
      // The other units keep their breaks: none is at white space, and the unit after a CR or FF
      // has its own, as a CR is one of nsLineBreaker's breakable spaces, whose run gives the unit
      // after it a break (IsSegmentSpace, nsLineBreaker.h:260-264; nsLineBreaker.cpp:318-327), and
      // an FF is UAX #14's BK, which the word breaker breaks after. Only a combining mark there has
      // none, since a break inside a cluster holds only after a space (SetPotentialLineBreaks,
      // gfxTextRun.cpp:219-226), so the break Firefox has before the CR is lost (ENGINE_FOLLOWUPS.md).
      // Where the white space right after a soft hyphen leaves, the break after it stays that white
      // space's, which draws no hyphen (SOFT_HYPHEN_BREAK): Gecko hyphenates only at a soft hyphen
      // that ends what its text run left out (GetHyphenationBreaks, nsTextFrame.cpp:4436-4443).
      const leftOut = gecko.leftOut
      const trailing = !preserve && (dropsBidiControl || leftOut !== null) ? getTrailingCollapsibleStart(source, 0, profile) : source.length
      if (leftOut !== null || trailing < source.length) {
        // A run that goes on into that trailing white space and keeps its one white space there, as
        // a segment break after a soft hyphen, keeps its first white space instead: the text before
        // the trailing white space holds the run's space, as rich inline takes an item's to
        // (whitespaceRunOpen in src/rich-inline.ts).
        let runSpace = -1
        if (leftOut !== null && trailing < source.length) {
          for (let i = trailing - 1; i >= 0; i--) {
            const code = source.charCodeAt(i)
            if (!isSpaceOrTabOrSegmentBreak(code) && !isDiscardable(code, false)) break
            if (isSpaceOrTabOrSegmentBreak(code) && leftOut[i] !== 1) {
              runSpace = -1
              break
            }
            if (isSpaceOrTabOrSegmentBreak(code)) runSpace = i
          }
        }
        // Only the units from the first one that leaves move.
        const from = leftOut === null ? trailing : 0
        let kept = ''
        let copied = 0
        let count = from
        let last = from - 1
        for (let i = from; i < source.length; i++) {
          if (i < trailing ? leftOut !== null && leftOut[i] === 1 && i !== runSpace : isCollapsibleSpaceCode(source.charCodeAt(i))) {
            kept += source.slice(copied, i)
            copied = i + 1
            continue
          }
          const breakBefore = sourceBreaks[i]!
          sourceBreaks[count++] = last >= 0 && last < i - 1 && (breakBefore & BREAK) !== 0 && source.charCodeAt(last) === 0x00AD ? breakBefore | SOFT_HYPHEN_BREAK : breakBefore
          last = i
        }
        sourceBreaks[count] = sourceBreaks[source.length]!
        source = kept + source.slice(copied)
        normalized = collapseWhitespaceNormal(source)
      }
    }
    if (profile.lineBreakScan === 'webkit' && !preserve && source !== normalized) spaceSources = new Uint16Array(normalized.length)
    breaks = source === normalized ? sourceBreaks : mapSourceLineBreaks(source, normalized.length, sourceBreaks, whiteSpace, spaceSources)
  }
  return segmentAtLineBreaks(normalized, spaceSources, breaks, whiteSpace, profile.lineBreakScan, profile.hangTabs, afterContent, dropsBidiControl)
}
