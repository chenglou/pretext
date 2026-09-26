// Prepare text with engine segmentation rules and cached Canvas measurements, then
// lay it out with arithmetic. Emoji calibration may perform a cached DOM read
// during preparation; layout itself does no measurement or string work.
// Rich APIs add source cursors and text materialization.
// Browser measurement limitations are documented in README.md and PLATFORM_BUGS.md.
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

import { observeSegmentEntries, type SegmentEntryGeometry } from './entry-geometry.js'
import { getHanKerningTrims, textMayHanKern, type HanKerningTrims } from './han-kerning.js'
import { findGraphemeEnds } from './graphemes.js'
import type { CharTable } from './generated/engine-break-data.js'
import { clearWordSegmenter } from './line-breaks.js'
import {
  analyzeText,
  type SegmentBreakKind,
  type TextAnalysis,
  type WhiteSpaceMode,
  type WordBreakMode as AnalysisWordBreakMode,
} from './analysis.js'
import {
  type BreakableFitMode,
  type EngineProfile,
  type FontMeasurement,
  clearMeasurementCaches,
  getCorrectedSegmentWidth,
  getEngineProfile,
  getEmojiCorrection as probeFontEmojiCorrection,
  getFollowingSpaceMetrics,
  getFontMeasurement,
  getPreparationLanguage,
  getSegmentFit,
  getSegmentMetrics,
  getTextWidth,
  measureWithLetterSpacing,
  readEmojiCorrection,
  readLetterSpacing,
  setLocaleLanguage,
  textMayContainEmoji,
  writeEmojiCorrection,
  type SegmentFit,
  type SegmentMetrics,
} from './measurement.js'
import {
  countPreparedLines,
  getKindCode,
  normalizePreparedLineStart,
  RETURNABLE,
  SPACED,
  stepPreparedLineGeometryFromStart,
  UNBROKEN,
  walkPreparedLinesRaw,
  type PreparedLineBreakData,
} from './line-break.js'
import {
  buildLineTextFromRange,
  getLineTextCache,
} from './line-text.js'

// --- Public types ---

declare const preparedTextBrand: unique symbol

// Keep the compact height-prediction handle opaque so the public API does not accidentally
// calcify around the current parallel-array representation.
export type PreparedText = {
  readonly [preparedTextBrand]: true
}

type InternalPreparedText = PreparedText & PreparedLineBreakData

// Manual-layout handle that exposes the structural segment data used by
// range/cursor APIs and custom rendering.
export type PreparedTextWithSegments = InternalPreparedText & {
  segments: string[] // Segment text aligned with the parallel arrays, e.g. ['hello', ' ', 'world']
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
}

export type LayoutCursor = {
  segmentIndex: number // Segment index in `segments`
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}

export type LayoutResult = {
  lineCount: number // Number of wrapped lines, e.g. 3
  height: number // Total block height, e.g. lineCount * lineHeight = 57
}

export type LineStats = {
  lineCount: number
  maxLineWidth: number
}

export type LayoutLine = {
  text: string // Full text content of this line, e.g. 'hello world'
  width: number // Measured width of this line, e.g. 87.5, leaving out spaces and tabs that hang past its end
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}

export type LayoutLineRange = {
  width: number // Measured width of this line, e.g. 87.5, leaving out spaces and tabs that hang past its end
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}

export type LayoutLinesResult = LayoutResult & {
  lines: LayoutLine[] // Per-line text/width pairs for custom rendering
}

export type WordBreakMode = AnalysisWordBreakMode

export type PrepareOptions = {
  whiteSpace?: WhiteSpaceMode
  wordBreak?: WordBreakMode
  letterSpacing?: number
}

// --- Public API ---

// Text and spaces take letter spacing after each grapheme; a ZWSP takes none.
function countRenderedSpacingGraphemes(text: string, kind: SegmentBreakKind, graphemeTable: CharTable): number {
  return kind === 'zero-width-break' ? 0 : findGraphemeEnds(graphemeTable, text, 0, text.length, null)
}

function addInternalLetterSpacing(width: number, graphemeCount: number, letterSpacing: number): number {
  return graphemeCount > 1 ? width + (graphemeCount - 1) * letterSpacing : width
}

// Code points that WebKit's FontCascade::characterRangeCodePath sends to the
// complex text path, stored as start/end pairs. So does a ZWJ after an emoji.
const complexTextPathRanges = [
  0x02E5, 0x02E9, 0x0300, 0x036F, 0x0591, 0x05BD, 0x05BF, 0x05CF, 0x0600, 0x109F,
  0x1100, 0x11FF, 0x135D, 0x135F, 0x1700, 0x18AF, 0x1900, 0x194F, 0x1980, 0x19DF,
  0x1A00, 0x1CFF, 0x1DC0, 0x1DFF, 0x20D0, 0x20FF, 0x26F9, 0x26F9, 0x2CEF, 0x2CF1,
  0x302A, 0x302F, 0x3099, 0x309C, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA800, 0xABFF,
  0xD7B0, 0xD7FF, 0xFE00, 0xFE0F, 0xFE20, 0xFE2F, 0x10A00, 0x10A5F, 0x11000, 0x110CF,
  0x11100, 0x111DF, 0x11200, 0x1124F, 0x112B0, 0x1137F, 0x11400, 0x114DF, 0x11580, 0x1165F,
  0x11680, 0x116CF, 0x11700, 0x11CBF, 0x16B00, 0x16B8F, 0x1E900, 0x1E95F, 0x1F1E6, 0x1F1FF,
  0x1F3FB, 0x1F3FF, 0xE0000, 0xE007F, 0xE0100, 0xE01EF,
] as const

const extendedPictographicRe = /\p{Extended_Pictographic}/u
const leadingCombiningMarkRe = /^\p{M}/u
// Decimal digits and the joiners of numbers, times and dates.
const numericRunRe = /^[\p{Nd}:\-/×,.+\u2013\u2014]+$/u
const markRunRe = /^\p{M}+$/u
const nonspacingMarkRunRe = /^\p{Mn}+$/u
const controlOrMarkRunRe = /^(?:[\p{Cc}\u2028\u2029]|\p{M}+)$/u
const controlCharacterRe = /^[\p{Cc}\u2028\u2029]$/u
// The fewest UTF-16 units of a long chain of mark runs that a run's context keeps after
// the grapheme (getMarkContext): measured after the whole chain, a long chain prepared in
// time that grows with the square of its length. Safari gives a run a width that depends
// on how far it sits from the grapheme, up to 61 units in the chains measured
// (RESEARCH.md), so a context that keeps fewer moves widths there.
const MARK_CHAIN_CONTEXT_UNITS = 96

function needsComplexTextPath(text: string): boolean {
  let previousIsEmoji = false
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i)!
    i += codePoint > 0xFFFF ? 2 : 1
    if (codePoint === 0x200D && previousIsEmoji) return true
    previousIsEmoji = codePoint > 0xFFFF && extendedPictographicRe.test(String.fromCodePoint(codePoint))
    for (let range = 0; range < complexTextPathRanges.length && codePoint >= complexTextPathRanges[range]!; range += 2) {
      if (codePoint <= complexTextPathRanges[range + 1]!) return true
    }
  }
  return false
}

const explicitBidiControlRe = /[\u202A-\u202E\u2066-\u2069]/
// Format characters stand for bidi class BN, except the direction marks LRM,
// RLM and ALM, which are strong characters like letters.
const trailingFormatCharacterRe = /(?![\u200E\u200F\u061C])\p{Cf}$/u
// Letters in the right-to-left blocks have bidi class R or AL, as do RLM and
// ALM. Every other letter except modifier letters has class L, as does LRM.
const rightToLeftLetterRe = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
// The last letter or direction mark before format characters other than a soft
// hyphen, and the first letter, direction mark or ASCII digit after the space,
// past spaces and format characters.
const letterBeforeFormatTailRe = /([\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])\p{M}*(?:(?![\u00AD\u200E\u200F\u061C])\p{Cf})+$/u
const letterAfterSpacesRe = / (?: |(?![\u200E\u200F\u061C])\p{Cf})*([0-9\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])/uy

// Bidi class B: the characters that end a bidi paragraph.
function isParagraphSeparatorCode(code: number): boolean {
  return code === 0x0a || code === 0x0d || (code >= 0x1c && code <= 0x1e) || code === 0x85 || code === 0x2029
}

function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  letterSpacing: number,
  engineProfile: EngineProfile,
  language: string | null,
): InternalPreparedText | PreparedTextWithSegments {
  const fontMeasurement = getFontMeasurement(font, language)
  const emojiCorrection = textMayContainEmoji(analysis.normalized) ? probeFontEmojiCorrection(font, fontMeasurement) : 0
  // The gap before the hyphen, plus the hyphen's own spacing where the engine
  // letter-spaces it.
  const discretionaryHyphenWidth = getTextWidth('-', fontMeasurement, emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * (engineProfile.letterSpaceDiscretionaryHyphen ? 2 : 1))
  const spaceWidth = getTextWidth(' ', fontMeasurement, emojiCorrection)
  const tabStopAdvance = spaceWidth * 8
  const hasLetterSpacing = letterSpacing !== 0

  // A collapsed space's first source character, for engines that look at the
  // source after a text item.
  function getSpaceSourceCode(analysisIndex: number): number {
    const start = analysis.starts[analysisIndex]!
    return analysis.spaceSources === null ? analysis.normalized.charCodeAt(start) : analysis.spaceSources[start]!
  }

  // A WebKit text item runs to its next break opportunity, so it also owns any
  // zero-width breaks before the space. The item is measured with one following
  // U+0020 minus an unshaped space, which keeps the kerning between the item's
  // end and that space. With letter spacing the same measurement also moves the
  // space's gap onto the item and clamps the item at zero, which the
  // per-grapheme gap model does not represent, so only the unspaced case takes
  // the kerning. A soft hyphen before the space also takes none: on an RTL page
  // WebKit needs about a hyphen's width more to fit such an item, and
  // preparation cannot see the page direction. Returns the zero-width breaks
  // between the text and the space, or null when the text takes no kerning.
  function getFollowingSpaceTail(analysisIndex: number, text: string): string | null {
    if (!engineProfile.measureTextWithFollowingSpace || hasLetterSpacing) return null
    let tail = ''
    let next = analysisIndex + 1
    while (next < analysis.kinds.length && analysis.kinds[next] === 'zero-width-break') {
      tail += analysis.texts[next]!
      next++
    }
    if (next >= analysis.kinds.length) return null
    const nextKind = analysis.kinds[next]!
    if ((nextKind !== 'space' && nextKind !== 'preserved-space') || getSpaceSourceCode(next) !== 0x20) return null
    return formatTailStaysWithWord(tail === '' ? text : text + tail, analysis.starts[next]!) ? tail : null
  }

  // Text directly before such a space is measured together with the space
  // instead of alone, so its kerned width costs no extra Canvas call. Other
  // occurrences of the same text measure it alone.
  function getTextMetrics(text: string, followingSpaceTail: string | null): SegmentMetrics {
    return followingSpaceTail === '' ? getFollowingSpaceMetrics(text, fontMeasurement) : getSegmentMetrics(text, fontMeasurement)
  }

  // A zero-width break before the space ends the measured item, so only the
  // item's kerning with the space is added to the text's own width.
  function getTailKerning(item: string): number {
    return getFollowingSpaceMetrics(item, fontMeasurement).width - getSegmentMetrics(item, fontMeasurement).width - spaceWidth
  }

  // WebKit splits text items where resolved bidi levels change before it
  // measures them. Format characters between a word and the space resolve with
  // that space, so they stay in the word's item, and the word's last glyph keeps
  // its kerning with the space, only when the space resolves to the word's
  // direction. Without the paragraph direction that is known when the word's last
  // letter or direction mark and the first one after the space have the same
  // direction, with only spaces and format characters between (UAX #9 N1).
  // Explicit embeddings, overrides and isolates end with their paragraph (UAX #9
  // X8), so only controls in the space's own paragraph leave its direction
  // unknown. Spaces arrive in order, so each paragraph is scanned once.
  let hasExplicitBidiControls: boolean | null = null
  let controlParagraphEnd = -1
  let paragraphHasExplicitBidiControls = false
  function spaceParagraphHasExplicitBidiControls(spaceStart: number): boolean {
    hasExplicitBidiControls ??= explicitBidiControlRe.test(analysis.normalized)
    if (!hasExplicitBidiControls) return false
    if (spaceStart < controlParagraphEnd) return paragraphHasExplicitBidiControls
    const text = analysis.normalized
    let start = spaceStart
    while (start > 0 && !isParagraphSeparatorCode(text.charCodeAt(start - 1))) start--
    let end = spaceStart
    while (end < text.length && !isParagraphSeparatorCode(text.charCodeAt(end))) end++
    controlParagraphEnd = end
    paragraphHasExplicitBidiControls = explicitBidiControlRe.test(text.slice(start, end))
    return paragraphHasExplicitBidiControls
  }
  function formatTailStaysWithWord(item: string, spaceStart: number): boolean {
    if (!trailingFormatCharacterRe.test(item)) return true
    const before = letterBeforeFormatTailRe.exec(item)
    if (before === null) return false
    letterAfterSpacesRe.lastIndex = spaceStart
    const after = letterAfterSpacesRe.exec(analysis.normalized)
    if (after === null) return false
    // An ASCII digit takes the direction of the text before it (UAX #9 W7 and N1).
    const next = after[1]!
    return (next.charCodeAt(0) <= 0x39 || rightToLeftLetterRe.test(before[1]!) === rightToLeftLetterRe.test(next)) &&
      !spaceParagraphHasExplicitBidiControls(spaceStart)
  }

  // The source a run of combining marks shapes after when only zero-width glue,
  // controls or other such runs, with no break, separate the run from the grapheme
  // before it: that grapheme and what separates them. Without the separators, Canvas
  // can compose the marks with the grapheme or draw both in another font. A walk that
  // reaches the last run that asked takes that run's answer, so each segment is walked
  // and each grapheme found once, however many runs share it. Once what separates them
  // passes MARK_CHAIN_CONTEXT_UNITS, the context keeps the grapheme and the fewest of the
  // chain's last runs, each with the separators before it, that hold at least that many
  // units: in Chrome, Safari and Firefox, runs of 1 to 400 marks then measure as they do
  // after the whole chain, to 0.002px, and without the grapheme some took 25px less
  // (RESEARCH.md).
  let markRunIndex = -1
  let markBaseStart = -1 // where that run's grapheme starts in the normalized text, or -1
  let markChainStart = -1 // the segment after that grapheme
  let markChainKept = -1 // the first segment of the chain the context keeps
  function getMarkContext(analysisIndex: number): string | null {
    if (analysis.breaksBefore?.[analysisIndex] !== false || !markRunRe.test(analysis.texts[analysisIndex]!)) return null
    let baseStart = -1
    for (let k = analysisIndex - 1; k >= 0; k--) {
      const kind = analysis.kinds[k]!
      const text = analysis.texts[k]!
      if (kind === 'zero-width-glue' || ((kind === 'text' || kind === 'control') && controlOrMarkRunRe.test(text))) {
        if (k !== markRunIndex) continue
        baseStart = markBaseStart
      } else if (kind === 'text') {
        const ends = new Int32Array(text.length)
        const count = findGraphemeEnds(engineProfile.graphemeTable, text, 0, text.length, ends)
        baseStart = analysis.starts[k]! + (count > 1 ? ends[count - 2]! : 0)
        markChainStart = markChainKept = k + 1
      }
      break
    }
    markRunIndex = analysisIndex
    markBaseStart = baseStart
    if (baseStart < 0) return null
    const start = analysis.starts[analysisIndex]!
    return start - baseStart > MARK_CHAIN_CONTEXT_UNITS ? getLongMarkChainContext(baseStart, start) : analysis.normalized.slice(baseStart, start)
  }
  // Apart from getMarkContext(), which prepare() calls for every segment, so that V8
  // still inlines that one there (RESEARCH.md, Keeping Work Bounded). V8 inlines a
  // function only while its bytecode stays under about 460 bytes, whether or not the
  // source is minified: with this loop inside, getMarkContext() took 519 bytes and
  // Chrome 154's prepare() ran 1-3% slower; without it, 376 (Node 23, V8 12.9). Before
  // growing getMarkContext(), check it with node --print-bytecode and
  // --trace-turbo-inlining, and bench Chrome's prepare() rows against main.
  function getLongMarkChainContext(baseStart: number, start: number): string {
    // The kept part starts after the grapheme or a run of marks, moves only forward and
    // never holds fewer than MARK_CHAIN_CONTEXT_UNITS.
    for (let k = markChainKept + 1; start - analysis.starts[k]! >= MARK_CHAIN_CONTEXT_UNITS; k++) {
      if (markRunRe.test(analysis.texts[k - 1]!)) markChainKept = k
    }
    if (markChainKept === markChainStart) return analysis.normalized.slice(baseStart, start)
    return analysis.normalized.slice(baseStart, analysis.starts[markChainStart]!) + analysis.normalized.slice(analysis.starts[markChainKept]!, start)
  }

  const widths: number[] = []
  // An engine's scan makes one prepared segment per analysis segment.
  const breaksBefore = analysis.breaksBefore
  const segmentFlags = new Uint8Array(analysis.kinds.length)
  // Text of the simple walkers' kinds without letter spacing. They lay it out where
  // the scan breaks at every segment boundary, and layout() counts it with the
  // simple stepper where it doesn't (countPreparedLines).
  let simpleKinds = !hasLetterSpacing
  const breakableFitAdvances: (number[] | null)[] = []
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let lineStartProhibitions: (number[] | null)[] | null = null
  // When not even the first character of an overflowing word fits an empty line,
  // WebKit keeps the punctuation, NBSP, U+2010 and U+2013 after that character on the
  // line, in text holding a code unit above U+00FF (InlineContentBreaker.cpp:124-158,
  // 222-233), by its scan's line-start table. Blink and Gecko end the line after the
  // first grapheme.
  const keepsLineStartPunctuation = engineProfile.lineBreakScan === 'webkit' && /[\u0100-\uFFFF]/.test(analysis.normalized)
  const segments = includeSegments ? [] as string[] : null
  const retreatsFromUnfitHyphen = engineProfile.unfitHyphenRetreat !== 'none'
  let discretionaryHyphenContexts: number[] | null = null
  let previousJoinablePiece: string | null = null
  let previousJoinableMetrics: SegmentMetrics | null = null

  // Pieces split by a soft hyphen are measured apart, but Blink and Gecko shape
  // the unbroken text together: cursive joins, marks and kerning across the soft
  // hyphen. Canvas shows how much narrower the neighbors measure joined than
  // apart, which isolated widths can't show when proving that a hyphen overflows.
  function getJoinedNarrowing(analysisIndex: number, before: string | null, beforeMetrics: SegmentMetrics | null): number {
    if (before === null) return 0
    let next = analysisIndex + 1
    while (next < analysis.kinds.length && analysis.kinds[next] === 'soft-hyphen') next++
    if (next >= analysis.kinds.length || analysis.kinds[next] !== 'text') return 0
    const after = analysis.texts[next]!
    const apart = getCorrectedSegmentWidth(before, beforeMetrics!, emojiCorrection) + getTextWidth(after, fontMeasurement, emojiCorrection)
    const together = getTextWidth(before + after, fontMeasurement, emojiCorrection)
    return apart - together > engineProfile.lineFitEpsilon ? apart - together : 0
  }

  function getEntryGeometry(text: string, fit: SegmentFit, width: number, fitBasis: 'fresh' | 'original'): SegmentEntryGeometry | null {
    // The fit fixes the text, font and advances, and Pretext sets no other context state.
    // Only the WebKit profile moves the advances by a following space, and it observes
    // no entries.
    const cached = fit.entryGeometry
    if (cached !== null && cached.letterSpacing === letterSpacing && cached.emojiCorrection === emojiCorrection) return cached.geometry
    const geometry = observeSegmentEntries(text, fit.advances!, letterSpacing, width, fitBasis,
      source => measureWithLetterSpacing(source, letterSpacing, emojiCorrection, fontMeasurement))
    // Replacing this last observation leaves prepared copies intact.
    if (geometry !== null) fit.entryGeometry = { letterSpacing, emojiCorrection, geometry }
    return geometry
  }

  // A text segment's width as measured: alone, or together with the following space less
  // that space, plus the item's kerning with a space that follows zero-width breaks. Apart
  // from the loop below, whose code JavaScriptCore otherwise never optimizes fully on CJK
  // text (RESEARCH.md, Keeping Work Bounded).
  function getTextSegmentWidth(text: string, textMetrics: SegmentMetrics, measuredWithSpace: boolean, followingSpaceKerning: number): number {
    return getCorrectedSegmentWidth(text, textMetrics, emojiCorrection) - (measuredWithSpace ? spaceWidth : 0) + followingSpaceKerning
  }

  for (let mi = 0; mi < analysis.kinds.length; mi++) {
    const text = analysis.texts[mi]!
    const kind = analysis.kinds[mi]!
    let width = 0
    // Graphemes that take letter spacing after them.
    let spacingGraphemeCount = 0
    let fitAdvances: number[] | null = null
    let entry: SegmentEntryGeometry | null = null
    let prohibitions: number[] | null = null
    switch (kind) {
      case 'text': {
        // A control the engine hides takes no advance, only letter spacing.
        if (engineProfile.hidesControlCharacters && controlCharacterRe.test(text)) {
          spacingGraphemeCount = 1
          break
        }
        // Such a run of marks adds its context with the marks, minus the context, and
        // takes no letter spacing of its own.
        const markContext = getMarkContext(mi)
        if (markContext !== null) {
          width = engineProfile.shapesMarksAcrossSoftHyphen && analysis.texts[mi - 1] === '\u00AD' && nonspacingMarkRunRe.test(text)
            ? 0
            : getTextWidth(markContext + text, fontMeasurement, emojiCorrection) - getTextWidth(markContext, fontMeasurement, emojiCorrection)
          break
        }
        // With an empty following-space tail, the text is measured together with the
        // space; with a zero-width tail, the item's kerning is added.
        const followingSpaceTail = getFollowingSpaceTail(mi, text)
        const measuredWithSpace = followingSpaceTail === ''
        const textMetrics = getTextMetrics(text, followingSpaceTail)
        previousJoinablePiece = text
        previousJoinableMetrics = textMetrics
        if (hasLetterSpacing) spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
        const followingSpaceKerning = followingSpaceTail === null || measuredWithSpace ? 0 : getTailKerning(text + followingSpaceTail)
        width = getTextSegmentWidth(text, textMetrics, measuredWithSpace, followingSpaceKerning)
        // Under break-word, Blink retries an overflowing line with a break allowed between
        // any two graphemes (line_breaker.cc), WebKit searches the word's grapheme prefixes
        // (TextUtil::breakWord) and Gecko may wrap before any cluster (gfxTextRun.cpp:1069-1072),
        // so every text segment takes emergency grapheme breaks, unless it is one Gecko cluster.
        if (analysis.clusterSplits?.[mi] === false || text.length === 1) break
        const fitMode: BreakableFitMode = letterSpacing !== 0 ? 'segment-prefixes'
          : numericRunRe.test(text) ? 'pair-context'
          : textMetrics.width >= engineProfile.prefixFitMinWidth ? 'segment-prefixes'
          : 'sum-graphemes'
        const fit = getSegmentFit(text, textMetrics, fontMeasurement, emojiCorrection, fitMode,
          measuredWithSpace ? spaceWidth : null, engineProfile.lineBreakScan === 'webkit')
        fitAdvances = fit.advances
        if (fitAdvances === null) break
        // The cached advances are shared by every occurrence of this text; only
        // the final grapheme touches the following space.
        if (followingSpaceKerning !== 0) {
          fitAdvances = fitAdvances.slice()
          fitAdvances[fitAdvances.length - 1] = fitAdvances[fitAdvances.length - 1]! + followingSpaceKerning
        }
        if (engineProfile.entryFitBasis !== 'disabled') {
          entry = getEntryGeometry(text, fit, addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing), engineProfile.entryFitBasis)
        }
        if (keepsLineStartPunctuation) prohibitions = fit.lineStartProhibitions
        break
      }
      case 'space':
      case 'preserved-space':
      case 'zero-width-break':
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        if (hasLetterSpacing) spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
        break
      case 'tab':
        spacingGraphemeCount = 1
        break
      case 'control': {
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        // NEL shares a WebKit text item with the text before it and with
        // combining marks after it, and the complex text path spaces it. Complex
        // text shares the item only when its direction matches the page's, which
        // preparation cannot see, so NEL next to complex text keeps its spacing.
        const nextText = mi + 1 < analysis.kinds.length ? analysis.texts[mi + 1]! : ''
        if (hasLetterSpacing && (
          (mi > 0 && analysis.kinds[mi - 1] === 'text' && needsComplexTextPath(analysis.texts[mi - 1]!)) ||
          (leadingCombiningMarkRe.test(nextText) && needsComplexTextPath(nextText))
        )) spacingGraphemeCount = 1
        break
      }
      case 'soft-hyphen':
      case 'zero-width-glue':
      case 'hard-break':
        break
    }
    if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') simpleKinds = false
    if (kind !== 'text' && kind !== 'soft-hyphen') previousJoinablePiece = null
    // The full walker, layout()'s count and rich-inline layout read where the scan
    // gives no break.
    segmentFlags[mi] = getKindCode(kind) | (hasLetterSpacing && spacingGraphemeCount > 0 ? SPACED : 0) |
      (breaksBefore === null ? 0 : breaksBefore[mi] ? RETURNABLE : UNBROKEN)
    widths.push(addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing))
    breakableFitAdvances.push(fitAdvances)
    if (entry !== null && entryGeometry === null) entryGeometry = Array.from({ length: mi }, () => null)
    entryGeometry?.push(entry)
    if (prohibitions !== null && lineStartProhibitions === null) lineStartProhibitions = Array.from({ length: mi }, () => null)
    lineStartProhibitions?.push(prohibitions)
    if (segments !== null) segments.push(text)
    if (kind === 'soft-hyphen' && retreatsFromUnfitHyphen) {
      discretionaryHyphenContexts ??= Array.from({ length: mi }, () => 0)
      discretionaryHyphenContexts.push(getJoinedNarrowing(mi, previousJoinablePiece, previousJoinableMetrics))
    } else {
      discretionaryHyphenContexts?.push(0)
    }
  }

  // A segment's width is its width between the text before and after it; one that starts
  // a line takes back the halt Blink gives its first character there.
  let hanKerning: HanKerningTrims = { widthTrims: null, lineStartExtras: null, lineEndTrims: null }
  if (engineProfile.hanKerning && textMayHanKern(analysis.normalized)) {
    hanKerning = getHanKerningTrims(fontMeasurement, analysis)
    const trims = hanKerning.widthTrims
    if (trims !== null) for (let i = 0; i < trims.length; i++) widths[i] = widths[i]! - trims[i]!
  }
  let lineEndTrims = hanKerning.lineEndTrims
  if (engineProfile.hangsIdeographicSpace && analysis.normalized.includes('\u3000')) {
    lineEndTrims = addIdeographicSpaceHangs(lineEndTrims, analysis.texts, analysis.kinds, breaksBefore, fontMeasurement, letterSpacing, discretionaryHyphenWidth)
  }
  const prepared = {
    widths,
    segmentFlags,
    simpleLineWalkFastPath: simpleKinds && breaksBefore === null,
    simpleLineCountFastPath: simpleKinds,
    breakableFitAdvances,
    entryGeometry,
    letterSpacing,
    discretionaryHyphenWidth,
    discretionaryHyphenContexts,
    lineStartProhibitions,
    lineStartExtras: hanKerning.lineStartExtras,
    lineEndTrims,
    tabStopAdvance,
  } as unknown as PreparedTextWithSegments
  if (segments !== null) {
    prepared.segments = segments
    prepared.kinds = analysis.kinds
  }
  return prepared
}

// Blink (Chrome 153) hangs a run of U+3000 that ends a line, as it hangs spaces: ShapingLineBreaker
// counts U+3000 as a breakable space (IsBreakableSpace, shaping_line_breaker.cc:38-41, with
// Character::IsOtherSpaceSeparator, character.h:156-158), so a line whose width runs out on
// the run ends after it and fits without it (shaping_line_breaker.cc:384-452), and the line
// breaker keeps the run as trailing space (HandleTrailingSpaces, line_breaker.cc:2447-2514),
// in normal and pre-wrap white space alike. A text segment that ends in such a run, where a
// line can end after it or a collapsible space follows, which hangs with it, drops the run
// and its letter spacing at a line end. The line then ends where the run starts
// (shaping_line_breaker.cc:490-493), so after a soft hyphen it ends with a hyphen
// (SetBreakOffset, shaping_line_breaker.cc:212-216), which has to fit. Gecko (Firefox 156)
// marks U+3000 as a space glyph, like SPACE (SetupClusterBoundaries, gfxFont.cpp:749-750), and
// BreakAndMeasureText fits a line without its trailing space glyphs (gfxTextRun.cpp:1152-1160,
// 1175), so Firefox hangs the run too.
function addIdeographicSpaceHangs(
  trims: number[] | null,
  texts: readonly string[],
  kinds: readonly SegmentBreakKind[],
  breaksBefore: readonly boolean[] | null,
  measurement: FontMeasurement,
  letterSpacing: number,
  hyphenWidth: number,
): number[] | null {
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!
    if (kinds[i] !== 'text' || text.charCodeAt(text.length - 1) !== 0x3000) continue
    const next = i + 1 < kinds.length ? kinds[i + 1]! : null
    if (next !== null && next !== 'hard-break' && next !== 'space' && !(next === 'text' && breaksBefore?.[i + 1] !== false)) continue
    let start = text.length - 1
    while (start > 0 && text.charCodeAt(start - 1) === 0x3000) start--
    const run = text.slice(start)
    const previous = i > 0 ? texts[i - 1]! : ''
    const afterSoftHyphen = start === 0 && previous.charCodeAt(previous.length - 1) === 0xAD
    const hang = getSegmentMetrics(run, measurement).width + run.length * letterSpacing - (afterSoftHyphen ? hyphenWidth : 0)
    if (hang <= 0) continue
    trims ??= Array.from({ length: texts.length }, () => 0)
    trims[i] = trims[i]! + hang
  }
  return trims
}

function prepareInternal(
  text: string,
  font: string,
  includeSegments: boolean,
  options?: PrepareOptions,
): InternalPreparedText | PreparedTextWithSegments {
  const wordBreak = options?.wordBreak ?? 'normal'
  const letterSpacing = readLetterSpacing(options?.letterSpacing)
  const engineProfile = getEngineProfile()
  // One language read: break rules and measurement both follow it.
  const language = getPreparationLanguage(engineProfile)
  const analysis = analyzeText(text, engineProfile, options?.whiteSpace, wordBreak, language)
  return measureAnalysis(analysis, font, includeSegments, letterSpacing, engineProfile, language)
}

// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth and lineHeight via layout().
//
// Steps:
//   1. Normalize white space as white-space: normal or pre-wrap does
//   2. Find break opportunities with the engine's own line-break scan
//   3. Split the text into segments between them ("better." as one unit)
//   4. Measure each segment via canvas measureText, cache by (segment, font).
//      A run of combining marks that glue or a control separates from its grapheme
//      measures after that grapheme, and WebKit measures a word with the space after it
//   5. Measure where each text segment of two or more graphemes can break under
//      overflow-wrap: break-word: by graphemes, pairs or prefixes, per engine
//   6. Correct emoji canvas inflation (probed once per font)
//   7. Record what changes at a line's edges: Blink's halts of CJK punctuation,
//      U+3000 hangs, how much narrower a soft hyphen's neighbors measure joined,
//      fresh-line widths inside segments with invisible characters, and the
//      characters WebKit keeps after an overflowing first one
export function prepare(text: string, font: string, options?: PrepareOptions): PreparedText {
  return prepareInternal(text, font, false, options) as PreparedText
}

// Rich variant used by callers that need enough information to render the
// laid-out lines themselves.
export function prepareWithSegments(text: string, font: string, options?: PrepareOptions): PreparedTextWithSegments {
  return prepareInternal(text, font, true, options) as PreparedTextWithSegments
}

function getInternalPrepared(prepared: PreparedText): InternalPreparedText {
  return prepared as InternalPreparedText
}

// Layout prepared text at a given max width and caller-provided lineHeight.
// Pure arithmetic on cached widths — no canvas calls, no DOM reads, no string
// operations, and no per-line allocations. Call on every resize. Lines break
// where the engine's page breaks them, under the CSS that README.md's Caveats
// list.
export function layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult {
  // The resize hot path counts the same lines as `layoutWithLines()` without
  // building line ranges or text.
  const lineCount = countPreparedLines(getInternalPrepared(prepared), maxWidth)
  return { lineCount, height: lineCount * lineHeight }
}

// Reported widths are clamped at zero wherever a line is built. A line's
// advance can be negative: the rest of a word after an emergency break can
// hold only invisible characters and the word's kerning with a following
// space, and letter spacing can be strongly negative. Line breaking keeps the
// signed advance.
function createLayoutLine(
  prepared: PreparedTextWithSegments,
  cache: ReturnType<typeof getLineTextCache>,
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): LayoutLine {
  return {
    text: buildLineTextFromRange(
      prepared,
      cache,
      startSegmentIndex,
      startGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
    ),
    width: Math.max(0, width),
    start: {
      segmentIndex: startSegmentIndex,
      graphemeIndex: startGraphemeIndex,
    },
    end: {
      segmentIndex: endSegmentIndex,
      graphemeIndex: endGraphemeIndex,
    },
  }
}

function createLayoutLineRange(
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): LayoutLineRange {
  return {
    width: Math.max(0, width),
    start: {
      segmentIndex: startSegmentIndex,
      graphemeIndex: startGraphemeIndex,
    },
    end: {
      segmentIndex: endSegmentIndex,
      graphemeIndex: endGraphemeIndex,
    },
  }
}

export function materializeLineRange(
  prepared: PreparedTextWithSegments,
  line: LayoutLineRange,
): LayoutLine {
  return createLayoutLine(
    prepared,
    getLineTextCache(prepared),
    line.width,
    line.start.segmentIndex,
    line.start.graphemeIndex,
    line.end.segmentIndex,
    line.end.graphemeIndex,
  )
}

// Batch low-level line-range pass. This is the non-materializing counterpart
// to layoutWithLines(), useful for shrinkwrap and other aggregate stats work.
export function walkLineRanges(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  onLine: (line: LayoutLineRange) => void,
): number {
  return walkPreparedLinesRaw(
    getInternalPrepared(prepared),
    maxWidth,
    (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
      onLine(createLayoutLineRange(
        width,
        startSegmentIndex,
        startGraphemeIndex,
        endSegmentIndex,
        endGraphemeIndex,
      ))
    },
  )
}

export function measureLineStats(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
): LineStats {
  const stats = { lineCount: 0, maxLineWidth: 0 }
  walkPreparedLinesRaw(getInternalPrepared(prepared), maxWidth, undefined, stats)
  return stats
}

// Intrinsic-width helper for rich/userland layout work. This asks "how wide is
// the prepared text when container width is not the thing forcing wraps?".
// Explicit hard breaks still count, so this returns the widest forced line.
export function measureNaturalWidth(prepared: PreparedTextWithSegments): number {
  return measureLineStats(prepared, Number.POSITIVE_INFINITY).maxLineWidth
}

// Steps one streamed line from `start` into the result's cursors: the
// normalized line start and the line end. Returns the reported width, or null
// after the last line.
function stepNextLine(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
  lineStart: LayoutCursor,
  lineEnd: LayoutCursor,
): number | null {
  const internal = getInternalPrepared(prepared)
  lineEnd.segmentIndex = start.segmentIndex
  lineEnd.graphemeIndex = start.graphemeIndex
  if (!normalizePreparedLineStart(internal, lineEnd)) return null

  lineStart.segmentIndex = lineEnd.segmentIndex
  lineStart.graphemeIndex = lineEnd.graphemeIndex
  const width = stepPreparedLineGeometryFromStart(internal, lineEnd, maxWidth)
  return width === null ? null : Math.max(0, width)
}

export function layoutNextLine(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLine | null {
  const lineStart = { segmentIndex: 0, graphemeIndex: 0 }
  const end = { segmentIndex: 0, graphemeIndex: 0 }
  const width = stepNextLine(prepared, start, maxWidth, lineStart, end)
  if (width === null) return null

  const text = buildLineTextFromRange(
    prepared,
    getLineTextCache(prepared),
    lineStart.segmentIndex,
    lineStart.graphemeIndex,
    end.segmentIndex,
    end.graphemeIndex,
  )
  return { text, width, start: lineStart, end }
}

export function layoutNextLineRange(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLineRange | null {
  const lineStart = { segmentIndex: 0, graphemeIndex: 0 }
  const end = { segmentIndex: 0, graphemeIndex: 0 }
  const width = stepNextLine(prepared, start, maxWidth, lineStart, end)
  return width === null ? null : { width, start: lineStart, end }
}

// Rich layout API for callers that want the actual line contents and widths.
// Caller still supplies lineHeight at layout time. Mirrors layout()'s break
// decisions, but keeps extra per-line bookkeeping so it should stay off the
// resize hot path.
export function layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult {
  const lines: LayoutLine[] = []
  const graphemeCache = getLineTextCache(prepared)
  const lineCount = walkPreparedLinesRaw(
    getInternalPrepared(prepared),
    maxWidth,
    (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
      lines.push(createLayoutLine(
        prepared,
        graphemeCache,
        width,
        startSegmentIndex,
        startGraphemeIndex,
        endSegmentIndex,
        endGraphemeIndex,
      ))
    },
  )

  return { lineCount, height: lineCount * lineHeight, lines }
}

export function clearCache(): void {
  clearWordSegmenter()
  clearMeasurementCaches()
}

// Sets the language later preparation breaks and measures under in place of
// `<html lang>`, which a worker doesn't have; an empty one is a page's without a
// language. Without a locale, preparation reads `<html lang>` again. Prepared
// handles keep theirs (RESEARCH.md, Decisions Log).
export function setLocale(locale?: string): void {
  setLocaleLanguage(locale)
  clearCache()
}

// The per-font emoji correction prepare() probes for: the pixels to subtract
// from each emoji grapheme's canvas width, or 0 on platforms and font sizes
// without the canvas inflation. The probe needs a document, so this reads 0
// inside a Web Worker even where the page's own canvas is inflated.
export function getEmojiCorrection(font: string): number {
  return readEmojiCorrection(font)
}

// Applies a page's measured correction in a document-less worker. Read the
// value with getEmojiCorrection(font) on the main thread, postMessage the
// number, and call this there with the same font string before preparing
// emoji text (#292). The value is pixels, so only a same-renderer handoff is
// exact; a worker primed with another GPU's number inherits that GPU's gap.
export function setEmojiCorrection(font: string, correction: number): void {
  writeEmojiCorrection(font, correction)
}
