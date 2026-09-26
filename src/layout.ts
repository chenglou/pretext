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
import {
  analyzeText,
  clearAnalysisCaches,
  type SegmentBreakKind,
  type TextAnalysis,
  type WhiteSpaceMode,
  type WordBreakMode as AnalysisWordBreakMode,
} from './analysis.js'
import {
  type BreakableFitMode,
  type EngineProfile,
  clearMeasurementCaches,
  getCorrectedSegmentWidth,
  getDocumentLanguage,
  getSegmentBreakableFitAdvances,
  getEngineProfile,
  getEmojiCorrection,
  getFollowingSpaceMetrics,
  getFontMeasurement,
  getSegmentMetrics,
  measureWithLetterSpacing,
  textMayContainEmoji,
  type SegmentMetrics,
} from './measurement.js'
import {
  countPreparedLines,
  getKindCode,
  measurePreparedLineGeometry,
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
  documentLanguage: string | null,
): InternalPreparedText | PreparedTextWithSegments {
  const fontMeasurement = getFontMeasurement(font, documentLanguage)
  const cache = fontMeasurement.metrics
  const emojiCorrection = textMayContainEmoji(analysis.normalized) ? getEmojiCorrection(font, fontMeasurement) : 0
  // The gap before the hyphen, plus the hyphen's own spacing where the engine
  // letter-spaces it.
  const discretionaryHyphenWidth =
    getCorrectedSegmentWidth('-', getSegmentMetrics('-', cache), emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * (engineProfile.letterSpaceDiscretionaryHyphen ? 2 : 1))
  const spaceWidth = getCorrectedSegmentWidth(' ', getSegmentMetrics(' ', cache), emojiCorrection)
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
    if (followingSpaceTail !== '') return getSegmentMetrics(text, cache)
    return getFollowingSpaceMetrics(text, fontMeasurement.followingSpaceMetrics)
  }

  // A zero-width break before the space ends the measured item, so only the
  // item's kerning with the space is added to the text's own width.
  function getTailKerning(item: string): number {
    return getFollowingSpaceMetrics(item, fontMeasurement.followingSpaceMetrics).width - getSegmentMetrics(item, cache).width - spaceWidth
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
  // and each grapheme found once, however many runs share it.
  let markRunIndex = -1
  let markBaseStart = -1 // where that run's grapheme starts in the normalized text, or -1
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
      }
      break
    }
    markRunIndex = analysisIndex
    markBaseStart = baseStart
    return baseStart < 0 ? null : analysis.normalized.slice(baseStart, analysis.starts[analysisIndex]!)
  }

  const widths: number[] = []
  // An engine's scan makes one prepared segment per analysis segment.
  const breaksBefore = analysis.breaksBefore
  const segmentFlags = new Uint8Array(analysis.kinds.length)
  let simpleLineWalkFastPath = !hasLetterSpacing && breaksBefore === null
  const breakableFitAdvances: (number[] | null)[] = []
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let lineStartProhibitions: (number[] | null)[] | null = null
  // When not even the first character of an overflowing word fits an empty line,
  // WebKit keeps the punctuation, NBSP, U+2010 and U+2013 after that character on the
  // line, in text holding a code unit above U+00FF (InlineContentBreaker.cpp:124-158,
  // 222-233), by its scan's line-start table. Blink and Gecko end the line after the
  // first grapheme.
  const keepsLineStartPunctuation = engineProfile.lineBreakScan === 'webkit' && /[\u0100-\uFFFF]/.test(analysis.source)
  const segments = includeSegments ? [] as string[] : null
  const retreatsFromUnfitHyphen = engineProfile.unfitHyphenRetreat !== 'none'
  let discretionaryHyphenContexts: number[] | null = null
  let previousJoinablePiece: string | null = null
  let previousJoinableMetrics: SegmentMetrics | null = null

  // Pieces split by a soft hyphen are measured apart, but Blink and Gecko shape
  // the unbroken text together: cursive joins, marks and kerning across the soft
  // hyphen. Canvas shows how much narrower the neighbors measure joined than
  // apart, which isolated widths can't show when proving that a hyphen overflows.
  function getJoinedNarrowing(analysisIndex: number): number {
    const before = previousJoinablePiece
    if (before === null) return 0
    let next = analysisIndex + 1
    while (next < analysis.kinds.length && analysis.kinds[next] === 'soft-hyphen') next++
    if (next >= analysis.kinds.length) return 0
    const nextKind = analysis.kinds[next]!
    if (nextKind !== 'text') return 0
    const after = analysis.texts[next]!
    const joined = before + after
    const apart =
      getCorrectedSegmentWidth(before, previousJoinableMetrics!, emojiCorrection) +
      getCorrectedSegmentWidth(after, getSegmentMetrics(after, cache), emojiCorrection)
    const together = getCorrectedSegmentWidth(joined, getSegmentMetrics(joined, cache), emojiCorrection)
    return apart - together > engineProfile.lineFitEpsilon ? apart - together : 0
  }

  function getEntryGeometry(
    text: string,
    metrics: SegmentMetrics,
    advances: number[],
    width: number,
    fitBasis: 'fresh' | 'original',
  ): SegmentEntryGeometry | null {
    // The cache owner fixes the text and font, and Pretext sets no other context state.
    const cached = metrics.entryGeometry
    if (cached !== undefined && cached.letterSpacing === letterSpacing &&
      cached.advances === advances && cached.emojiCorrection === emojiCorrection) return cached.geometry
    let complete = true
    const geometry = observeSegmentEntries(text, advances, letterSpacing, width, fitBasis, source => {
      const measured = measureWithLetterSpacing(source, letterSpacing, emojiCorrection)
      if (measured === null) complete = false
      return measured
    })
    // Replacing this last successful observation leaves prepared copies intact.
    if (geometry !== null && complete) metrics.entryGeometry = { letterSpacing, advances, emojiCorrection, geometry }
    return geometry
  }

  function pushMeasuredSegment(
    text: string,
    width: number,
    kind: SegmentBreakKind,
    breakableFitAdvance: number[] | null,
    spacingGraphemeCount: number,
    entry: SegmentEntryGeometry | null = null,
    prohibitions: number[] | null = null,
  ): void {
    if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') {
      simpleLineWalkFastPath = false
    }
    // Only the full walker and rich-inline layout read where the scan gives no break.
    const index = widths.length
    segmentFlags[index] = getKindCode(kind) | (hasLetterSpacing && spacingGraphemeCount > 0 ? SPACED : 0) |
      (breaksBefore === null ? 0 : breaksBefore[index] ? RETURNABLE : UNBROKEN)
    widths.push(width)
    breakableFitAdvances.push(breakableFitAdvance)
    if (entry !== null && entryGeometry === null) {
      entryGeometry = Array.from({ length: widths.length - 1 }, () => null)
    }
    entryGeometry?.push(entry)
    if (prohibitions !== null && lineStartProhibitions === null) {
      lineStartProhibitions = Array.from({ length: widths.length - 1 }, () => null)
    }
    lineStartProhibitions?.push(prohibitions)
    if (segments !== null) segments.push(text)
    discretionaryHyphenContexts?.push(0)
    if (kind !== 'text' && kind !== 'soft-hyphen') previousJoinablePiece = null
  }

  // With an empty following-space tail, textMetrics measured the text together
  // with the space; with a zero-width tail, the item's kerning is added.
  function pushMeasuredTextSegment(
    text: string,
    textMetrics: SegmentMetrics,
    kind: SegmentBreakKind,
    allowOverflowBreaks: boolean,
    followingSpaceTail: string | null,
  ): void {
    if (kind === 'text') {
      previousJoinablePiece = text
      previousJoinableMetrics = textMetrics
    }
    const spacingGraphemeCount = hasLetterSpacing
      ? countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
      : 0
    const measuredWithSpace = followingSpaceTail === ''
    const followingSpaceKerning = followingSpaceTail === null || measuredWithSpace
      ? 0
      : getTailKerning(text + followingSpaceTail)
    const width = addInternalLetterSpacing(
      getCorrectedSegmentWidth(text, textMetrics, emojiCorrection) - (measuredWithSpace ? spaceWidth : 0) + followingSpaceKerning,
      spacingGraphemeCount,
      letterSpacing,
    )

    if (allowOverflowBreaks && text.length > 1) {
      let fitMode: BreakableFitMode = 'sum-graphemes'
      if (letterSpacing !== 0) {
        fitMode = 'segment-prefixes'
      } else if (numericRunRe.test(text)) {
        fitMode = 'pair-context'
      } else if (textMetrics.width >= engineProfile.prefixFitMinWidth) {
        fitMode = 'segment-prefixes'
      }
      let fitAdvances = getSegmentBreakableFitAdvances(
        text,
        textMetrics,
        cache,
        emojiCorrection,
        fitMode,
        measuredWithSpace ? spaceWidth : null,
        engineProfile.lineBreakScan === 'webkit',
      )
      // The cached advances are shared by every occurrence of this text; only
      // the final grapheme touches the following space.
      if (followingSpaceKerning !== 0 && fitAdvances !== null) {
        fitAdvances = fitAdvances.slice()
        fitAdvances[fitAdvances.length - 1] = fitAdvances[fitAdvances.length - 1]! + followingSpaceKerning
      }
      pushMeasuredSegment(
        text,
        width,
        kind,
        fitAdvances,
        spacingGraphemeCount,
        engineProfile.entryFitBasis !== 'disabled' && kind === 'text' && fitAdvances !== null
          ? getEntryGeometry(text, textMetrics, fitAdvances, width, engineProfile.entryFitBasis) : null,
        keepsLineStartPunctuation && fitAdvances !== null ? textMetrics.lineStartProhibitions! : null,
      )
      return
    }

    pushMeasuredSegment(
      text,
      width,
      kind,
      null,
      spacingGraphemeCount,
    )
  }

  for (let mi = 0; mi < analysis.kinds.length; mi++) {
    const segText = analysis.texts[mi]!
    const segKind = analysis.kinds[mi]!

    if (segKind === 'soft-hyphen') {
      const narrowing = retreatsFromUnfitHyphen ? getJoinedNarrowing(mi) : 0
      pushMeasuredSegment(
        segText,
        0,
        segKind,
        null,
        0,
      )
      if (retreatsFromUnfitHyphen) {
        discretionaryHyphenContexts ??= Array.from({ length: widths.length }, () => 0)
        discretionaryHyphenContexts[widths.length - 1] = narrowing
      }
      continue
    }

    if (segKind === 'zero-width-glue') {
      pushMeasuredSegment(segText, 0, segKind, null, 0)
      continue
    }

    if (segKind === 'hard-break') {
      pushMeasuredSegment(segText, 0, segKind, null, 0)
      continue
    }

    if (segKind === 'tab') {
      pushMeasuredSegment(segText, 0, segKind, null, hasLetterSpacing ? 1 : 0)
      continue
    }

    if (segKind === 'control') {
      const width = getCorrectedSegmentWidth(segText, getSegmentMetrics(segText, cache), emojiCorrection)
      // NEL shares a WebKit text item with the text before it and with
      // combining marks after it, and the complex text path spaces it. Complex
      // text shares the item only when its direction matches the page's, which
      // preparation cannot see, so NEL next to complex text keeps its spacing.
      const previousKind = mi > 0 ? analysis.kinds[mi - 1] : undefined
      const nextText = mi + 1 < analysis.kinds.length ? analysis.texts[mi + 1]! : ''
      const takesLetterSpacing = hasLetterSpacing && (
        (previousKind === 'text' && needsComplexTextPath(analysis.texts[mi - 1]!)) ||
        (leadingCombiningMarkRe.test(nextText) && needsComplexTextPath(nextText))
      )
      pushMeasuredSegment(segText, width, segKind, null, takesLetterSpacing ? 1 : 0)
      continue
    }

    // A control the engine hides takes no advance, only letter spacing.
    if (engineProfile.hidesControlCharacters && controlCharacterRe.test(segText)) {
      pushMeasuredSegment(segText, 0, segKind, null, hasLetterSpacing ? 1 : 0)
      continue
    }

    // Such a run of marks adds its context with the marks, minus the context, and
    // takes no letter spacing of its own.
    const markContext = getMarkContext(mi)
    if (markContext !== null) {
      const joined = markContext + segText
      const width = engineProfile.shapesMarksAcrossSoftHyphen && analysis.texts[mi - 1] === '\u00AD' && nonspacingMarkRunRe.test(segText)
        ? 0
        : getCorrectedSegmentWidth(joined, getSegmentMetrics(joined, cache), emojiCorrection) -
          getCorrectedSegmentWidth(markContext, getSegmentMetrics(markContext, cache), emojiCorrection)
      pushMeasuredSegment(segText, width, segKind, null, 0)
      continue
    }

    const followingSpaceTail = segKind === 'text' ? getFollowingSpaceTail(mi, segText) : null
    // Under break-word, Blink retries an overflowing line with a break allowed between
    // any two graphemes (line_breaker.cc), WebKit searches the word's grapheme prefixes
    // (TextUtil::breakWord) and Gecko may wrap before any cluster (gfxTextRun.cpp:1069-1072),
    // so every text segment takes emergency grapheme breaks, unless it is one Gecko cluster.
    const allowOverflowBreaks = segKind === 'text' && analysis.clusterSplits?.[mi] !== false
    pushMeasuredTextSegment(segText, getTextMetrics(segText, followingSpaceTail), segKind, allowOverflowBreaks, followingSpaceTail)
  }

  // A segment's width is its width between the text before and after it; one that starts
  // a line takes back the halt Blink gives its first character there.
  let hanKerning: HanKerningTrims = { widthTrims: null, lineStartExtras: null, lineEndTrims: null }
  if (engineProfile.hanKerning && textMayHanKern(analysis.normalized)) {
    hanKerning = getHanKerningTrims(
      fontMeasurement,
      analysis.texts,
      i => analysis.kinds[i] === 'text',
      i => i === 0 ? -1 : analysis.normalized.charCodeAt(analysis.starts[i]! - 1),
      i => i + 1 === analysis.kinds.length ? -1 : analysis.normalized.charCodeAt(analysis.starts[i + 1]!),
      // A break directly after the segment: text after a break, or the end of the text.
      i => i + 1 === analysis.kinds.length || (analysis.kinds[i + 1] === 'text' && breaksBefore?.[i + 1] !== false),
    )
    const trims = hanKerning.widthTrims
    if (trims !== null) for (let i = 0; i < trims.length; i++) widths[i] = widths[i]! - trims[i]!
  }
  let lineEndTrims = hanKerning.lineEndTrims
  if (engineProfile.hangsIdeographicSpace && analysis.normalized.includes('\u3000')) {
    lineEndTrims = addIdeographicSpaceHangs(lineEndTrims, analysis.texts, analysis.kinds, breaksBefore, cache, letterSpacing, discretionaryHyphenWidth)
  }
  const prepared = {
    widths,
    segmentFlags,
    simpleLineWalkFastPath,
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
  cache: Map<string, SegmentMetrics>,
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
    const hang = getSegmentMetrics(run, cache).width + run.length * letterSpacing - (afterSoftHyphen ? hyphenWidth : 0)
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
  const letterSpacing = options?.letterSpacing ?? 0
  // One page-language read: break rules and measurement both follow it.
  const documentLanguage = getDocumentLanguage()
  const engineProfile = getEngineProfile()
  const analysis = analyzeText(text, engineProfile, options?.whiteSpace, wordBreak, documentLanguage)
  return measureAnalysis(analysis, font, includeSegments, letterSpacing, engineProfile, documentLanguage)
}

// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth and lineHeight via layout().
//
// Steps:
//   1. Normalize collapsible whitespace (CSS white-space: normal behavior)
//   2. Find break opportunities with the engine's own line-break scan
//   3. Split the text into segments between them ("better." as one unit)
//   4. Measure each segment via canvas measureText, cache by (segment, font)
//   5. Pre-measure graphemes of long words (for overflow-wrap: break-word)
//   6. Correct emoji canvas inflation (auto-detected per font size)
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
// operations, and no per-line allocations.
// ~0.0002ms per text block. Call on every resize.
//
// Line breaking rules (matching CSS white-space: normal + overflow-wrap: break-word):
//   - Break before any non-space segment that would overflow the line
//   - Trailing whitespace hangs past the line edge (doesn't trigger breaks)
//   - Segments wider than maxWidth are broken at grapheme boundaries
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
  return measurePreparedLineGeometry(getInternalPrepared(prepared), maxWidth)
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
  clearAnalysisCaches()
  clearMeasurementCaches()
}

// Kept for compatibility. Line breaking follows the page language, which
// preparation reads from `<html lang>`, so this only clears the caches. Removing
// it or making it a language input is decided later (RESEARCH.md, Decisions Log).
export function setLocale(_locale?: string): void {
  clearCache()
}
