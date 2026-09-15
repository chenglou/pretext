// Prepare text with Intl segmentation and cached Canvas measurements, then
// lay it out with arithmetic. Emoji calibration may perform a cached DOM read
// during preparation; layout itself does no measurement or string work.
// Rich APIs add source cursors and text materialization.
// Browser measurement limitations are documented in README.md and PLATFORM_BUGS.md.
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

import { observeSegmentEntries, type SegmentEntryGeometry } from './entry-geometry.js'
import {
  analyzeText,
  clearAnalysisCaches,
  getBreakablePreferredBreaks,
  getBreakLanguage,
  getCjkTextUnits,
  getSharedGraphemeSegmenter,
  isCJK,
  isNumericRunSegment,
  isIndependentSymbolRun,
  setAnalysisLocale,
  type SegmentBreakKind,
  type TextAnalysis,
  type WhiteSpaceMode,
  type WordBreakMode as AnalysisWordBreakMode,
} from './analysis.js'
import {
  type BreakableFitMode,
  type EngineProfile,
  clearMeasurementCaches,
  createEntryMeasurement,
  entryMeasurementProfilesMatch,
  getCorrectedSegmentWidth,
  getDocumentLanguage,
  getEntryMeasurementProfile,
  getSegmentBreakableFitAdvances,
  getEngineProfile,
  getFollowingSpaceMetricCache,
  getFollowingSpaceMetrics,
  getFontMeasurementState,
  getSegmentMetrics,
  textMayContainEmoji,
  type SegmentMetrics,
} from './measurement.js'
import {
  countPreparedLines,
  measurePreparedLineGeometry,
  normalizePreparedLineStart,
  stepPreparedLineGeometryFromChunk,
  walkPreparedLinesRaw,
} from './line-break.js'
import {
  buildLineTextFromRange,
  getLineTextCache,
} from './line-text.js'

// --- Public types ---

declare const preparedTextBrand: unique symbol

type PreparedCore = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  simpleLineWalkFastPath: boolean // Normal text can use the simpler old line walker across all layout APIs
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  breakablePreferredBreaks: (number[] | null)[] // Preferred grapheme break ends inside breakable segments, else null
  letterSpacing: number // Extra advance between rendered graphemes on the same line
  spacingGraphemeCounts: number[] // Rendered grapheme counts for letter-spacing gaps; empty when letterSpacing is 0
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
  // Per segment, true for a soft hyphen whose neighboring text measures narrower
  // joined than apart. Null when the text has no soft hyphen or the engine keeps
  // an unfit hyphen.
  discretionaryHyphenContexts: boolean[] | null
  tabStopAdvance: number // Absolute advance between tab stops for pre-wrap tab segments
  chunks: PreparedLineChunk[] // Precompiled hard-break chunks for line walking
}

// Keep the compact height-prediction handle opaque so the public API does not accidentally
// calcify around the current parallel-array representation.
export type PreparedText = {
  readonly [preparedTextBrand]: true
}

type InternalPreparedText = PreparedText & PreparedCore

// Manual-layout handle that exposes the structural segment data used by
// range/cursor APIs and custom rendering.
export type PreparedTextWithSegments = InternalPreparedText & {
  segments: string[] // Segment text aligned with the parallel arrays, e.g. ['hello', ' ', 'world']
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

// Internal hard-break chunk hint for the line walker. Not public because
// callers should not depend on the current chunking representation.
type PreparedLineChunk = {
  startSegmentIndex: number
  endSegmentIndex: number
  consumedEndSegmentIndex: number
}

// --- Public API ---

function createEmptyPrepared(includeSegments: boolean): InternalPreparedText | PreparedTextWithSegments {
  if (includeSegments) {
    return {
      widths: [],
      kinds: [],
      simpleLineWalkFastPath: true,
      breakableFitAdvances: [],
      breakablePreferredBreaks: [],
      entryGeometry: null,
      letterSpacing: 0,
      spacingGraphemeCounts: [],
      discretionaryHyphenWidth: 0,
      discretionaryHyphenContexts: null,
      tabStopAdvance: 0,
      chunks: [],
      segments: [],
    } as unknown as PreparedTextWithSegments
  }
  return {
    widths: [],
    kinds: [],
    simpleLineWalkFastPath: true,
    breakableFitAdvances: [],
    breakablePreferredBreaks: [],
    entryGeometry: null,
    letterSpacing: 0,
    spacingGraphemeCounts: [],
    discretionaryHyphenWidth: 0,
    discretionaryHyphenContexts: null,
    tabStopAdvance: 0,
    chunks: [],
  } as unknown as InternalPreparedText
}

function countRenderedSpacingGraphemes(
  text: string,
  kind: SegmentBreakKind,
): number {
  if (
    kind === 'zero-width-break' ||
    kind === 'soft-hyphen' ||
    kind === 'hard-break'
  ) {
    return 0
  }

  if (kind === 'tab') return 1

  let count = 0
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const _ of graphemeSegmenter.segment(text)) count++
  return count
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

function isCollapsibleWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c
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
  wordBreak: WordBreakMode,
  letterSpacing: number,
  engineProfile: EngineProfile,
  documentLanguage: string | null,
): InternalPreparedText | PreparedTextWithSegments {
  const { cache, emojiCorrection } = getFontMeasurementState(
    font,
    textMayContainEmoji(analysis.normalized),
    documentLanguage,
  )
  // The gap before the hyphen, plus the hyphen's own spacing where the engine
  // letter-spaces it.
  const discretionaryHyphenWidth =
    getCorrectedSegmentWidth('-', getSegmentMetrics('-', cache), emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * (engineProfile.letterSpaceDiscretionaryHyphen ? 2 : 1))
  const spaceWidth = getCorrectedSegmentWidth(' ', getSegmentMetrics(' ', cache), emojiCorrection)
  const tabStopAdvance = spaceWidth * 8
  const hasLetterSpacing = letterSpacing !== 0

  if (analysis.len === 0) return createEmptyPrepared(includeSegments)

  // Collapsible runs keep their first source character for engines that look
  // at the source after a text item. Built only when normalization changed it.
  let collapsedRunSources: Uint16Array | null = null
  function getSpaceSourceCode(analysisIndex: number): number {
    const start = analysis.starts[analysisIndex]!
    if (analysis.kinds[analysisIndex] !== 'space' || analysis.source === analysis.normalized) {
      return analysis.normalized.charCodeAt(start)
    }
    if (collapsedRunSources === null) {
      const { source, normalized } = analysis
      collapsedRunSources = new Uint16Array(normalized.length)
      let sourceIndex = 0
      while (sourceIndex < source.length && isCollapsibleWhitespaceCode(source.charCodeAt(sourceIndex))) sourceIndex++
      for (let normalizedIndex = 0; normalizedIndex < normalized.length; normalizedIndex++) {
        const code = source.charCodeAt(sourceIndex)
        collapsedRunSources[normalizedIndex] = code
        if (!isCollapsibleWhitespaceCode(code)) {
          sourceIndex++
          continue
        }
        while (sourceIndex < source.length && isCollapsibleWhitespaceCode(source.charCodeAt(sourceIndex))) sourceIndex++
      }
    }
    return collapsedRunSources[start]!
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
    while (next < analysis.len && analysis.kinds[next] === 'zero-width-break') {
      tail += analysis.texts[next]!
      next++
    }
    if (next >= analysis.len) return null
    const nextKind = analysis.kinds[next]!
    if ((nextKind !== 'space' && nextKind !== 'preserved-space') || getSpaceSourceCode(next) !== 0x20) return null
    return formatTailStaysWithWord(tail === '' ? text : text + tail, analysis.starts[next]!) ? tail : null
  }

  // Text directly before such a space is measured together with the space
  // instead of alone, so its kerned width costs no extra Canvas call. Other
  // occurrences of the same text measure it alone.
  let followingSpaceCache: Map<string, SegmentMetrics> | null = null
  function getTextMetrics(text: string, followingSpaceTail: string | null): SegmentMetrics {
    if (followingSpaceTail !== '') return getSegmentMetrics(text, cache)
    followingSpaceCache ??= getFollowingSpaceMetricCache(font)
    return getFollowingSpaceMetrics(text, followingSpaceCache)
  }

  // A zero-width break before the space ends the measured item, so only the
  // item's kerning with the space is added to the text's own width.
  function getTailKerning(item: string): number {
    followingSpaceCache ??= getFollowingSpaceMetricCache(font)
    return getFollowingSpaceMetrics(item, followingSpaceCache).width - getSegmentMetrics(item, cache).width - spaceWidth
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

  const widths: number[] = []
  const kinds: SegmentBreakKind[] = []
  let simpleLineWalkFastPath = !hasLetterSpacing
  const breakableFitAdvances: (number[] | null)[] = []
  const breakablePreferredBreaks: (number[] | null)[] = []
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let entryProfile: ReturnType<typeof getEntryMeasurementProfile> | undefined
  let measureEntry: ReturnType<typeof createEntryMeasurement> | undefined
  const getEntryProfile = () => {
    if (entryProfile === undefined) entryProfile = getEntryMeasurementProfile()
    return entryProfile
  }
  const getEntryMeasurement = () => {
    if (measureEntry === undefined) measureEntry = createEntryMeasurement(letterSpacing, emojiCorrection, getEntryProfile())
    return measureEntry
  }
  const spacingGraphemeCounts: number[] = []
  const segments = includeSegments ? [] as string[] : null
  const chunks: PreparedLineChunk[] = []
  let chunkStartSegmentIndex = 0
  const retreatsFromUnfitHyphen = engineProfile.unfitHyphenRetreat !== 'none'
  let discretionaryHyphenContexts: boolean[] | null = null
  let previousJoinablePiece: string | null = null
  let previousJoinableMetrics: SegmentMetrics | null = null

  // Pieces split by a soft hyphen are measured apart, but Blink shapes the
  // unbroken text together: cursive joins, marks and kerning across the soft
  // hyphen. Canvas shows whether the neighbors measure narrower joined than
  // apart, where isolated widths cannot prove that the hyphen overflows.
  function shapesAcrossSoftHyphen(analysisIndex: number): boolean {
    const before = previousJoinablePiece
    if (before === null) return false
    let next = analysisIndex + 1
    while (next < analysis.len && analysis.kinds[next] === 'soft-hyphen') next++
    if (next >= analysis.len) return false
    const nextKind = analysis.kinds[next]!
    if (nextKind !== 'text' && nextKind !== 'glue') return false
    const after = analysis.texts[next]!
    const joined = before + after
    const apart =
      getCorrectedSegmentWidth(before, previousJoinableMetrics!, emojiCorrection) +
      getCorrectedSegmentWidth(after, getSegmentMetrics(after, cache), emojiCorrection)
    const together = getCorrectedSegmentWidth(joined, getSegmentMetrics(joined, cache), emojiCorrection)
    return apart - together > engineProfile.lineFitEpsilon
  }

  function getEntryGeometry(
    text: string,
    metrics: SegmentMetrics,
    advances: number[],
    width: number,
    fitBasis: 'fresh' | 'original',
  ): SegmentEntryGeometry | null {
    const cached = metrics.entryGeometry
    if (cached !== undefined && cached.letterSpacing === letterSpacing &&
      cached.advances === advances && cached.emojiCorrection === emojiCorrection) {
      const profile = getEntryProfile()
      if (profile === null) return null
      if (entryMeasurementProfilesMatch(cached.profile, profile)) return cached.geometry
    }
    let complete = true
    const geometry = observeSegmentEntries(text, advances, letterSpacing, width, fitBasis, source => {
      const measurement = getEntryMeasurement()
      const measured = measurement === null ? null : measurement.measure(source)
      if (measured === null) complete = false
      return measured
    })
    // The cache owner fixes the text/font, and the engine's basis is fixed.
    // Replacing this last successful observation leaves prepared copies intact.
    if (geometry !== null && complete) {
      metrics.entryGeometry = { letterSpacing, advances, emojiCorrection,
        profile: getEntryMeasurement()!.profile, geometry }
    }
    return geometry
  }

  function pushMeasuredSegment(
    text: string,
    width: number,
    kind: SegmentBreakKind,
    breakableFitAdvance: number[] | null,
    breakablePreferredBreak: number[] | null,
    spacingGraphemeCount: number,
    entry: SegmentEntryGeometry | null = null,
  ): void {
    if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') {
      simpleLineWalkFastPath = false
    }
    widths.push(width)
    kinds.push(kind)
    breakableFitAdvances.push(breakableFitAdvance)
    breakablePreferredBreaks.push(breakablePreferredBreak)
    if (entry !== null && entryGeometry === null) {
      entryGeometry = Array.from({ length: widths.length - 1 }, () => null)
      simpleLineWalkFastPath = false
    }
    entryGeometry?.push(entry)
    if (hasLetterSpacing) spacingGraphemeCounts.push(spacingGraphemeCount)
    if (segments !== null) segments.push(text)
    discretionaryHyphenContexts?.push(false)
    if (kind !== 'text' && kind !== 'glue' && kind !== 'soft-hyphen') previousJoinablePiece = null
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
    if (kind === 'text' || kind === 'glue') {
      previousJoinablePiece = text
      previousJoinableMetrics = textMetrics
    }
    const spacingGraphemeCount = hasLetterSpacing
      ? countRenderedSpacingGraphemes(text, kind)
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
      } else if (isNumericRunSegment(text)) {
        fitMode = 'pair-context'
      } else if (engineProfile.preferPrefixWidthsForBreakableRuns) {
        fitMode = 'segment-prefixes'
      }
      let fitAdvances = getSegmentBreakableFitAdvances(
        text,
        textMetrics,
        cache,
        emojiCorrection,
        fitMode,
        measuredWithSpace ? spaceWidth : null,
      )
      // The cached advances are shared by every occurrence of this text; only
      // the final grapheme touches the following space.
      if (followingSpaceKerning !== 0 && fitAdvances !== null) {
        fitAdvances = fitAdvances.slice()
        fitAdvances[fitAdvances.length - 1] = fitAdvances[fitAdvances.length - 1]! + followingSpaceKerning
      }
      const preferredBreaks =
        fitAdvances === null || wordBreak === 'keep-all'
          ? null
          : getBreakablePreferredBreaks(text, engineProfile)
      pushMeasuredSegment(
        text,
        width,
        kind,
        fitAdvances,
        preferredBreaks,
        spacingGraphemeCount,
        engineProfile.entryFitBasis !== 'disabled' && kind === 'text' && fitAdvances !== null
          ? getEntryGeometry(text, textMetrics, fitAdvances, width, engineProfile.entryFitBasis) : null,
      )
      return
    }

    pushMeasuredSegment(
      text,
      width,
      kind,
      null,
      null,
      spacingGraphemeCount,
    )
  }

  for (let mi = 0; mi < analysis.len; mi++) {
    const segText = analysis.texts[mi]!
    const segKind = analysis.kinds[mi]!

    if (segKind === 'soft-hyphen') {
      const shapesAcross = retreatsFromUnfitHyphen && shapesAcrossSoftHyphen(mi)
      pushMeasuredSegment(
        segText,
        0,
        segKind,
        null,
        null,
        0,
      )
      if (retreatsFromUnfitHyphen) {
        discretionaryHyphenContexts ??= Array.from({ length: widths.length }, () => false)
        if (shapesAcross) discretionaryHyphenContexts[widths.length - 1] = true
      }
      continue
    }

    if (segKind === 'hard-break') {
      const endSegmentIndex = widths.length
      pushMeasuredSegment(segText, 0, segKind, null, null, 0)
      chunks.push({
        startSegmentIndex: chunkStartSegmentIndex,
        endSegmentIndex,
        consumedEndSegmentIndex: widths.length,
      })
      chunkStartSegmentIndex = widths.length
      continue
    }

    if (segKind === 'tab') {
      pushMeasuredSegment(
        segText,
        0,
        segKind,
        null,
        null,
        hasLetterSpacing ? countRenderedSpacingGraphemes(segText, segKind) : 0,
      )
      continue
    }

    if (segKind === 'control') {
      const width = getCorrectedSegmentWidth(segText, getSegmentMetrics(segText, cache), emojiCorrection)
      // NEL shares a WebKit text item with the text or glue before it and with
      // combining marks after it, and the complex text path spaces it. Complex
      // text shares the item only when its direction matches the page's, which
      // preparation cannot see, so NEL next to complex text keeps its spacing.
      const previousKind = mi > 0 ? analysis.kinds[mi - 1] : undefined
      const nextText = mi + 1 < analysis.len ? analysis.texts[mi + 1]! : ''
      const takesLetterSpacing = hasLetterSpacing && (
        ((previousKind === 'text' || previousKind === 'glue') && needsComplexTextPath(analysis.texts[mi - 1]!)) ||
        (leadingCombiningMarkRe.test(nextText) && needsComplexTextPath(nextText))
      )
      pushMeasuredSegment(segText, width, segKind, null, null, takesLetterSpacing ? 1 : 0)
      continue
    }

    // Measure CJK text only after its final line-break units are known.
    if (segKind === 'text' && isCJK(segText)) {
      const measuredUnits = getCjkTextUnits(segText, engineProfile, wordBreak)

      for (let i = 0; i < measuredUnits.length; i++) {
        const unit = measuredUnits[i]!
        const followingSpaceTail = i === measuredUnits.length - 1 ? getFollowingSpaceTail(mi, unit.text) : null
        pushMeasuredTextSegment(
          unit.text,
          getTextMetrics(unit.text, followingSpaceTail),
          'text',
          unit.overflow === 'grapheme' || analysis.isWordLike[mi]!,
          followingSpaceTail,
        )
      }
      continue
    }

    const followingSpaceTail = segKind === 'text' || segKind === 'glue' ? getFollowingSpaceTail(mi, segText) : null
    pushMeasuredTextSegment(segText, getTextMetrics(segText, followingSpaceTail), segKind,
      segKind === 'text' && (analysis.isWordLike[mi]! || isIndependentSymbolRun(segText)),
      followingSpaceTail)
  }

  if (chunkStartSegmentIndex < widths.length) {
    // A whole ZWSP-only paragraph has a line but no rendered advance. Keep
    // its source in the consumed range, like an existing empty hard line.
    // Normalization can erase other line-producing source, such as form feed.
    const onlyZeroWidthBreaks = chunkStartSegmentIndex === 0 &&
      analysis.kinds.every(kind => kind === 'zero-width-break') &&
      analysis.source === analysis.normalized
    if (onlyZeroWidthBreaks) simpleLineWalkFastPath = false
    chunks.push({
      startSegmentIndex: chunkStartSegmentIndex,
      endSegmentIndex: onlyZeroWidthBreaks ? 0 : widths.length,
      consumedEndSegmentIndex: widths.length,
    })
  }
  if (segments !== null) {
    return {
      widths,
      kinds,
      simpleLineWalkFastPath,
      breakableFitAdvances,
      breakablePreferredBreaks,
      entryGeometry,
      letterSpacing,
      spacingGraphemeCounts,
      discretionaryHyphenWidth,
      discretionaryHyphenContexts,
      tabStopAdvance,
      chunks,
      segments,
    } as unknown as PreparedTextWithSegments
  }
  return {
    widths,
    kinds,
    simpleLineWalkFastPath,
    breakableFitAdvances,
    breakablePreferredBreaks,
    entryGeometry,
    letterSpacing,
    spacingGraphemeCounts,
    discretionaryHyphenWidth,
    discretionaryHyphenContexts,
    tabStopAdvance,
    chunks,
  } as unknown as InternalPreparedText
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
  const engineProfile = getEngineProfile(getBreakLanguage(documentLanguage))
  const analysis = analyzeText(text, engineProfile, options?.whiteSpace, wordBreak)
  return measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing, engineProfile, documentLanguage)
}

// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth and lineHeight via layout().
//
// Steps:
//   1. Normalize collapsible whitespace (CSS white-space: normal behavior)
//   2. Segment via Intl.Segmenter (handles CJK, Thai, etc.)
//   3. Merge punctuation into preceding word ("better." as one unit)
//   4. Split CJK words into individual graphemes (per-character line breaks)
//   5. Measure each segment via canvas measureText, cache by (segment, font)
//   6. Pre-measure graphemes of long words (for overflow-wrap: break-word)
//   7. Correct emoji canvas inflation (auto-detected per font size)
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
  // Keep the resize hot path specialized. `layoutWithLines()` shares the same
  // break semantics but also tracks line ranges; the extra bookkeeping is too
  // expensive to pay on every hot-path `layout()` call.
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
  if (prepared.widths.length === 0) return 0

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
  const chunkIndex = normalizePreparedLineStart(internal, lineEnd)
  if (chunkIndex < 0) return null

  lineStart.segmentIndex = lineEnd.segmentIndex
  lineStart.graphemeIndex = lineEnd.graphemeIndex
  const width = stepPreparedLineGeometryFromChunk(internal, lineEnd, chunkIndex, maxWidth)
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
  if (prepared.widths.length === 0) return { lineCount: 0, height: 0, lines }

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

export function setLocale(locale?: string): void {
  setAnalysisLocale(locale)
  clearCache()
}
