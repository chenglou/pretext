// Prepare text with Intl segmentation and cached Canvas measurements, then
// lay it out with arithmetic. Emoji calibration may perform a cached DOM read
// during preparation; layout itself does no measurement or string work.
// Rich APIs add source cursors, text materialization and approximate bidi metadata.
// Browser measurement limitations are documented in README.md and PLATFORM_BUGS.md.
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

import { computeSegmentLevels } from './bidi.js'
import { observeSegmentEntries, type SegmentEntryGeometry } from './entry-geometry.js'
import {
  analyzeText,
  clearAnalysisCaches,
  getBreakablePreferredBreaks,
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
  clearMeasurementCaches,
  createEntryMeasurement,
  entryMeasurementProfilesMatch,
  getCorrectedSegmentWidth,
  getEntryMeasurementProfile,
  getSegmentBreakableFitAdvances,
  getEngineProfile,
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
  clearLineTextCaches,
  getLineTextCache,
} from './line-text.js'

// --- Public types ---

declare const preparedTextBrand: unique symbol

type PreparedCore = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  lineEndFitAdvances: number[] // Width contribution when a line ends after this segment
  lineEndPaintAdvances: number[] // Painted contribution before terminal line-end letter-spacing
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  simpleLineWalkFastPath: boolean // Normal text can use the simpler old line walker across all layout APIs
  segLevels: Int8Array | null // Rich-path bidi metadata for custom rendering; layout() never reads it
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  breakablePreferredBreaks: (number[] | null)[] // Preferred grapheme break ends inside breakable segments, else null
  letterSpacing: number // Extra advance between rendered graphemes on the same line
  spacingGraphemeCounts: number[] // Rendered grapheme counts for letter-spacing gaps; empty when letterSpacing is 0
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
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
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}

export type LayoutLineRange = {
  width: number // Measured width of this line, e.g. 87.5
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
      lineEndFitAdvances: [],
      lineEndPaintAdvances: [],
      kinds: [],
      simpleLineWalkFastPath: true,
      segLevels: null,
      breakableFitAdvances: [],
      breakablePreferredBreaks: [],
      entryGeometry: null,
      letterSpacing: 0,
      spacingGraphemeCounts: [],
      discretionaryHyphenWidth: 0,
      tabStopAdvance: 0,
      chunks: [],
      segments: [],
    } as unknown as PreparedTextWithSegments
  }
  return {
    widths: [],
    lineEndFitAdvances: [],
    lineEndPaintAdvances: [],
    kinds: [],
    simpleLineWalkFastPath: true,
    segLevels: null,
    breakableFitAdvances: [],
    breakablePreferredBreaks: [],
    entryGeometry: null,
    letterSpacing: 0,
    spacingGraphemeCounts: [],
    discretionaryHyphenWidth: 0,
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

function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  wordBreak: WordBreakMode,
  letterSpacing: number,
): InternalPreparedText | PreparedTextWithSegments {
  const engineProfile = getEngineProfile()
  const { cache, emojiCorrection } = getFontMeasurementState(
    font,
    textMayContainEmoji(analysis.normalized),
  )
  const discretionaryHyphenWidth =
    getCorrectedSegmentWidth('-', getSegmentMetrics('-', cache), emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * 2)
  const spaceWidth = getCorrectedSegmentWidth(' ', getSegmentMetrics(' ', cache), emojiCorrection)
  const tabStopAdvance = spaceWidth * 8
  const hasLetterSpacing = letterSpacing !== 0

  if (analysis.len === 0) return createEmptyPrepared(includeSegments)

  const widths: number[] = []
  const lineEndFitAdvances: number[] = []
  const lineEndPaintAdvances: number[] = []
  const kinds: SegmentBreakKind[] = []
  let simpleLineWalkFastPath = !hasLetterSpacing
  const segStarts = includeSegments ? [] as number[] : null
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
    lineEndFitAdvance: number,
    lineEndPaintAdvance: number,
    kind: SegmentBreakKind,
    start: number,
    breakableFitAdvance: number[] | null,
    breakablePreferredBreak: number[] | null,
    spacingGraphemeCount: number,
    entry: SegmentEntryGeometry | null = null,
  ): void {
    if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') {
      simpleLineWalkFastPath = false
    }
    widths.push(width)
    lineEndFitAdvances.push(lineEndFitAdvance)
    lineEndPaintAdvances.push(lineEndPaintAdvance)
    kinds.push(kind)
    segStarts?.push(start)
    breakableFitAdvances.push(breakableFitAdvance)
    breakablePreferredBreaks.push(breakablePreferredBreak)
    if (entry !== null && entryGeometry === null) {
      entryGeometry = Array.from({ length: widths.length - 1 }, () => null)
      simpleLineWalkFastPath = false
    }
    entryGeometry?.push(entry)
    if (hasLetterSpacing) spacingGraphemeCounts.push(spacingGraphemeCount)
    if (segments !== null) segments.push(text)
  }

  function pushMeasuredTextSegment(
    text: string,
    textMetrics: SegmentMetrics,
    kind: SegmentBreakKind,
    start: number,
    allowOverflowBreaks: boolean,
  ): void {
    const spacingGraphemeCount = hasLetterSpacing
      ? countRenderedSpacingGraphemes(text, kind)
      : 0
    const width = addInternalLetterSpacing(
      getCorrectedSegmentWidth(text, textMetrics, emojiCorrection),
      spacingGraphemeCount,
      letterSpacing,
    )
    const baseLineEndFitAdvance =
      kind === 'space' || kind === 'preserved-space' || kind === 'zero-width-break'
        ? 0
        : width
    const lineEndFitAdvance =
      baseLineEndFitAdvance === 0
        ? 0
        : baseLineEndFitAdvance + (spacingGraphemeCount > 0 ? letterSpacing : 0)
    const lineEndPaintAdvance =
      kind === 'space' || kind === 'zero-width-break'
        ? 0
        : width

    if (allowOverflowBreaks && text.length > 1) {
      let fitMode: BreakableFitMode = 'sum-graphemes'
      if (letterSpacing !== 0) {
        fitMode = 'segment-prefixes'
      } else if (isNumericRunSegment(text)) {
        fitMode = 'pair-context'
      } else if (engineProfile.preferPrefixWidthsForBreakableRuns) {
        fitMode = 'segment-prefixes'
      }
      const fitAdvances = getSegmentBreakableFitAdvances(
        text,
        textMetrics,
        cache,
        emojiCorrection,
        fitMode,
      )
      const preferredBreaks =
        fitAdvances === null || wordBreak === 'keep-all'
          ? null
          : getBreakablePreferredBreaks(text)
      pushMeasuredSegment(
        text,
        width,
        lineEndFitAdvance,
        lineEndPaintAdvance,
        kind,
        start,
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
      lineEndFitAdvance,
      lineEndPaintAdvance,
      kind,
      start,
      null,
      null,
      spacingGraphemeCount,
    )
  }

  for (let mi = 0; mi < analysis.len; mi++) {
    const segText = analysis.texts[mi]!
    const segKind = analysis.kinds[mi]!
    const segStart = analysis.starts[mi]!

    if (segKind === 'soft-hyphen') {
      pushMeasuredSegment(
        segText,
        0,
        discretionaryHyphenWidth,
        discretionaryHyphenWidth,
        segKind,
        segStart,
        null,
        null,
        0,
      )
      continue
    }

    if (segKind === 'hard-break') {
      const endSegmentIndex = widths.length
      pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null, null, 0)
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
        0,
        0,
        segKind,
        segStart,
        null,
        null,
        hasLetterSpacing ? countRenderedSpacingGraphemes(segText, segKind) : 0,
      )
      continue
    }

    // Measure CJK text only after its final line-break units are known.
    if (segKind === 'text' && isCJK(segText)) {
      const measuredUnits = getCjkTextUnits(segText, engineProfile, wordBreak)

      for (let i = 0; i < measuredUnits.length; i++) {
        const unit = measuredUnits[i]!
        const unitMetrics = getSegmentMetrics(unit.text, cache)
        pushMeasuredTextSegment(
          unit.text,
          unitMetrics,
          'text',
          segStart + unit.start,
          unit.overflow === 'grapheme' || (analysis.isWordLike[mi]! && (wordBreak === 'keep-all' || unit.overflow === 'word-like')),
        )
      }
      continue
    }

    pushMeasuredTextSegment(segText, getSegmentMetrics(segText, cache), segKind, segStart,
      segKind === 'text' && (analysis.isWordLike[mi]! || isIndependentSymbolRun(segText)))
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
  const segLevels = segStarts === null ? null : computeSegmentLevels(analysis.normalized, segStarts)
  if (segments !== null) {
    return {
      widths,
      lineEndFitAdvances,
      lineEndPaintAdvances,
      kinds,
      simpleLineWalkFastPath,
      segLevels,
      breakableFitAdvances,
      breakablePreferredBreaks,
      entryGeometry,
      letterSpacing,
      spacingGraphemeCounts,
      discretionaryHyphenWidth,
      tabStopAdvance,
      chunks,
      segments,
    } as unknown as PreparedTextWithSegments
  }
  return {
    widths,
    lineEndFitAdvances,
    lineEndPaintAdvances,
    kinds,
    simpleLineWalkFastPath,
    segLevels,
    breakableFitAdvances,
    breakablePreferredBreaks,
    entryGeometry,
    letterSpacing,
    spacingGraphemeCounts,
    discretionaryHyphenWidth,
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
  const analysis = analyzeText(text, getEngineProfile(), options?.whiteSpace, wordBreak)
  return measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing)
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
//   8. Optionally compute rich-path bidi metadata for custom renderers
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
    width,
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
    width,
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
  let maxWidth = 0
  walkPreparedLinesRaw(getInternalPrepared(prepared), Number.POSITIVE_INFINITY, width => {
    if (width > maxWidth) maxWidth = width
  })
  return maxWidth
}

export function layoutNextLine(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLine | null {
  const internal = getInternalPrepared(prepared)
  const end = {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const chunkIndex = normalizePreparedLineStart(internal, end)
  if (chunkIndex < 0) return null

  const lineStartSegmentIndex = end.segmentIndex
  const lineStartGraphemeIndex = end.graphemeIndex
  const width = stepPreparedLineGeometryFromChunk(internal, end, chunkIndex, maxWidth)
  if (width === null) return null

  return createLayoutLine(
    prepared,
    getLineTextCache(prepared),
    width,
    lineStartSegmentIndex,
    lineStartGraphemeIndex,
    end.segmentIndex,
    end.graphemeIndex,
  )
}

export function layoutNextLineRange(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLineRange | null {
  const internal = getInternalPrepared(prepared)
  const end = {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const chunkIndex = normalizePreparedLineStart(internal, end)
  if (chunkIndex < 0) return null

  const lineStartSegmentIndex = end.segmentIndex
  const lineStartGraphemeIndex = end.graphemeIndex
  const width = stepPreparedLineGeometryFromChunk(internal, end, chunkIndex, maxWidth)
  if (width === null) return null

  return createLayoutLineRange(
    width,
    lineStartSegmentIndex,
    lineStartGraphemeIndex,
    end.segmentIndex,
    end.graphemeIndex,
  )
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
  clearLineTextCaches()
  clearMeasurementCaches()
}

export function setLocale(locale?: string): void {
  setAnalysisLocale(locale)
  clearCache()
}
