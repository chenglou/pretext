// Text measurement for browser environments using canvas measureText.
//
// Problem: DOM-based text measurement (getBoundingClientRect, offsetHeight)
// forces synchronous layout reflow. When components independently measure text,
// each measurement triggers a reflow of the entire document. This creates
// read/write interleaving that can cost 30ms+ per frame for 500 text blocks.
//
// Solution: two-phase measurement centered around canvas measureText.
//   prepare(text, font) — segments text via Intl.Segmenter, measures each word
//     via canvas, caches widths, and does one cached DOM calibration read per
//     font when emoji correction is needed. Call once when text first appears.
//   layout(prepared, maxWidth, lineHeight) — walks cached word widths with pure
//     arithmetic to count lines and compute height. Call on every resize.
//     ~0.0002ms per text.
//
// i18n: Intl.Segmenter handles CJK (per-character breaking), Thai, Arabic, etc.
//   Bidi: simplified rich-path metadata for mixed LTR/RTL custom rendering.
//   Punctuation merging: "better." measured as one unit (matches CSS behavior).
//   Trailing whitespace: hangs past line edge without triggering breaks (CSS behavior).
//   overflow-wrap: pre-measured grapheme widths enable character-level word breaking.
//
// Emoji correction: Chrome/Firefox canvas measures emoji wider than DOM at font
//   sizes <24px on macOS (Apple Color Emoji). The inflation is constant per emoji
//   grapheme at a given size, font-independent. Auto-detected by comparing canvas
//   vs actual DOM emoji width (one cached DOM read per font). Safari canvas and
//   DOM agree (both wider than fontSize), so correction = 0 there.
//
// Limitations:
//   - system-ui font: canvas resolves to different optical variants than DOM on macOS.
//     Use named fonts (Helvetica, Inter, etc.) for guaranteed accuracy.
//     See RESEARCH.md "Discovery: system-ui font resolution mismatch".
//
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

import { computeSegmentLevels } from './bidi.js'
import {
  analyzeText,
  canContinueKeepAllTextRun,
  clearAnalysisCaches,
  endsWithClosingQuote,
  isCJK,
  isNumericRunSegment,
  kinsokuEnd,
  kinsokuStart,
  leftStickyPunctuation,
  setAnalysisLocale,
  type AnalysisChunk,
  type SegmentBreakKind,
  type TextAnalysis,
  type WhiteSpaceMode,
  type WordBreakMode as AnalysisWordBreakMode,
} from './analysis.js'
import {
  type BreakableFitMode,
  clearMeasurementCaches,
  getCorrectedSegmentWidth,
  getSegmentBreakableFitAdvances,
  getEngineProfile,
  getFontMeasurementState,
  getSegmentMetrics,
  textMayContainEmoji,
} from './measurement.js'
import {
  countPreparedLines,
  layoutNextLineRange as stepPreparedLineRange,
  measurePreparedLineGeometry,
  walkPreparedLines,
  type InternalLayoutLine,
} from './line-break.js'

let sharedGraphemeSegmenter: Intl.Segmenter | null = null
// Rich-path only. Reuses grapheme splits while materializing multiple lines
// from the same prepared handle, without pushing that cache into the API.
let sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()

function getSharedGraphemeSegmenter(): Intl.Segmenter {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return sharedGraphemeSegmenter
}

// --- Public types ---

declare const preparedTextBrand: unique symbol

type PreparedCore = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  lineEndFitAdvances: number[] // Width contribution when a line ends after this segment
  lineEndPaintAdvances: number[] // Painted width contribution when a line ends after this segment
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  simpleLineWalkFastPath: boolean // Normal text can use the simpler old line walker across all layout APIs
  segLevels: Int8Array | null // Rich-path bidi metadata for custom rendering; layout() never reads it
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
  tabStopAdvance: number // Absolute advance between tab stops for pre-wrap tab segments
  chunks: PreparedLineChunk[] // Precompiled hard-break chunks for line walking
}

// Keep the main prepared handle opaque so the public API does not accidentally
// calcify around the current parallel-array representation.
export type PreparedText = {
  readonly [preparedTextBrand]: true
}

type InternalPreparedText = PreparedText & PreparedCore

// Rich/diagnostic variant that still exposes the structural segment data.
// Treat this as the unstable escape hatch for experiments and custom rendering.
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
    discretionaryHyphenWidth: 0,
    tabStopAdvance: 0,
    chunks: [],
  } as unknown as InternalPreparedText
}

type MeasuredTextUnit = {
  text: string
  start: number
}

function buildBaseCjkUnits(
  segText: string,
  engineProfile: ReturnType<typeof getEngineProfile>,
): MeasuredTextUnit[] {
  const units: MeasuredTextUnit[] = []
  let unitParts: string[] = []
  let unitStart = 0
  let unitContainsCJK = false
  let unitEndsWithClosingQuote = false
  let unitIsSingleKinsokuEnd = false

  function pushUnit(): void {
    if (unitParts.length === 0) return
    units.push({
      text: unitParts.length === 1 ? unitParts[0]! : unitParts.join(''),
      start: unitStart,
    })
    unitParts = []
    unitContainsCJK = false
    unitEndsWithClosingQuote = false
    unitIsSingleKinsokuEnd = false
  }

  function startUnit(grapheme: string, start: number, graphemeContainsCJK: boolean): void {
    unitParts = [grapheme]
    unitStart = start
    unitContainsCJK = graphemeContainsCJK
    unitEndsWithClosingQuote = endsWithClosingQuote(grapheme)
    unitIsSingleKinsokuEnd = kinsokuEnd.has(grapheme)
  }

  function appendToUnit(grapheme: string, graphemeContainsCJK: boolean): void {
    unitParts.push(grapheme)
    unitContainsCJK = unitContainsCJK || graphemeContainsCJK
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

    if (unitParts.length === 0) {
      startUnit(grapheme, gs.index, graphemeContainsCJK)
      continue
    }

    if (
      unitIsSingleKinsokuEnd ||
      kinsokuStart.has(grapheme) ||
      leftStickyPunctuation.has(grapheme) ||
      (engineProfile.carryCJKAfterClosingQuote &&
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

function mergeKeepAllTextUnits(units: MeasuredTextUnit[]): MeasuredTextUnit[] {
  if (units.length <= 1) return units

  const merged: MeasuredTextUnit[] = []
  let currentTextParts = [units[0]!.text]
  let currentStart = units[0]!.start
  let currentContainsCJK = isCJK(units[0]!.text)
  let currentCanContinue = canContinueKeepAllTextRun(units[0]!.text)

  function flushCurrent(): void {
    merged.push({
      text: currentTextParts.length === 1 ? currentTextParts[0]! : currentTextParts.join(''),
      start: currentStart,
    })
  }

  for (let i = 1; i < units.length; i++) {
    const next = units[i]!
    const nextContainsCJK = isCJK(next.text)
    const nextCanContinue = canContinueKeepAllTextRun(next.text)

    if (currentContainsCJK && currentCanContinue) {
      currentTextParts.push(next.text)
      currentContainsCJK = currentContainsCJK || nextContainsCJK
      currentCanContinue = nextCanContinue
      continue
    }

    flushCurrent()
    currentTextParts = [next.text]
    currentStart = next.start
    currentContainsCJK = nextContainsCJK
    currentCanContinue = nextCanContinue
  }

  flushCurrent()
  return merged
}

function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  wordBreak: WordBreakMode,
): InternalPreparedText | PreparedTextWithSegments {
  const engineProfile = getEngineProfile()
  const { cache, emojiCorrection } = getFontMeasurementState(
    font,
    textMayContainEmoji(analysis.normalized),
  )
  const discretionaryHyphenWidth = getCorrectedSegmentWidth('-', getSegmentMetrics('-', cache), emojiCorrection)
  const spaceWidth = getCorrectedSegmentWidth(' ', getSegmentMetrics(' ', cache), emojiCorrection)
  const tabStopAdvance = spaceWidth * 8

  if (analysis.len === 0) return createEmptyPrepared(includeSegments)

  const widths: number[] = []
  const lineEndFitAdvances: number[] = []
  const lineEndPaintAdvances: number[] = []
  const kinds: SegmentBreakKind[] = []
  let simpleLineWalkFastPath = analysis.chunks.length <= 1
  const segStarts = includeSegments ? [] as number[] : null
  const breakableFitAdvances: (number[] | null)[] = []
  const segments = includeSegments ? [] as string[] : null
  const preparedStartByAnalysisIndex = Array.from<number>({ length: analysis.len })

  function pushMeasuredSegment(
    text: string,
    width: number,
    lineEndFitAdvance: number,
    lineEndPaintAdvance: number,
    kind: SegmentBreakKind,
    start: number,
    breakableFitAdvance: number[] | null,
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
    if (segments !== null) segments.push(text)
  }

  function pushMeasuredTextSegment(
    text: string,
    kind: SegmentBreakKind,
    start: number,
    wordLike: boolean,
    allowOverflowBreaks: boolean,
  ): void {
    const textMetrics = getSegmentMetrics(text, cache)
    const width = getCorrectedSegmentWidth(text, textMetrics, emojiCorrection)
    const lineEndFitAdvance =
      kind === 'space' || kind === 'preserved-space' || kind === 'zero-width-break'
        ? 0
        : width
    const lineEndPaintAdvance =
      kind === 'space' || kind === 'zero-width-break'
        ? 0
        : width

    if (allowOverflowBreaks && wordLike && text.length > 1) {
      let fitMode: BreakableFitMode = 'sum-graphemes'
      if (isNumericRunSegment(text)) {
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
      pushMeasuredSegment(
        text,
        width,
        lineEndFitAdvance,
        lineEndPaintAdvance,
        kind,
        start,
        fitAdvances,
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
    )
  }

  for (let mi = 0; mi < analysis.len; mi++) {
    preparedStartByAnalysisIndex[mi] = widths.length
    const segText = analysis.texts[mi]!
    const segWordLike = analysis.isWordLike[mi]!
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
      )
      continue
    }

    if (segKind === 'hard-break') {
      pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null)
      continue
    }

    if (segKind === 'tab') {
      pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null)
      continue
    }

    const segMetrics = getSegmentMetrics(segText, cache)

    if (segKind === 'text' && segMetrics.containsCJK) {
      const baseUnits = buildBaseCjkUnits(segText, engineProfile)
      const measuredUnits = wordBreak === 'keep-all'
        ? mergeKeepAllTextUnits(baseUnits)
        : baseUnits

      for (let i = 0; i < measuredUnits.length; i++) {
        const unit = measuredUnits[i]!
        pushMeasuredTextSegment(
          unit.text,
          'text',
          segStart + unit.start,
          segWordLike,
          wordBreak === 'keep-all' || !isCJK(unit.text),
        )
      }
      continue
    }

    pushMeasuredTextSegment(segText, segKind, segStart, segWordLike, true)
  }

  const chunks = mapAnalysisChunksToPreparedChunks(analysis.chunks, preparedStartByAnalysisIndex, widths.length)
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
    discretionaryHyphenWidth,
    tabStopAdvance,
    chunks,
  } as unknown as InternalPreparedText
}

function mapAnalysisChunksToPreparedChunks(
  chunks: AnalysisChunk[],
  preparedStartByAnalysisIndex: number[],
  preparedEndSegmentIndex: number,
): PreparedLineChunk[] {
  const preparedChunks: PreparedLineChunk[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const startSegmentIndex =
      chunk.startSegmentIndex < preparedStartByAnalysisIndex.length
        ? preparedStartByAnalysisIndex[chunk.startSegmentIndex]!
        : preparedEndSegmentIndex
    const endSegmentIndex =
      chunk.endSegmentIndex < preparedStartByAnalysisIndex.length
        ? preparedStartByAnalysisIndex[chunk.endSegmentIndex]!
        : preparedEndSegmentIndex
    const consumedEndSegmentIndex =
      chunk.consumedEndSegmentIndex < preparedStartByAnalysisIndex.length
        ? preparedStartByAnalysisIndex[chunk.consumedEndSegmentIndex]!
        : preparedEndSegmentIndex

    preparedChunks.push({
      startSegmentIndex,
      endSegmentIndex,
      consumedEndSegmentIndex,
    })
  }
  return preparedChunks
}

function prepareInternal(
  text: string,
  font: string,
  includeSegments: boolean,
  options?: PrepareOptions,
): InternalPreparedText | PreparedTextWithSegments {
  const wordBreak = options?.wordBreak ?? 'normal'
  const analysis = analyzeText(text, getEngineProfile(), options?.whiteSpace, wordBreak)
  return measureAnalysis(analysis, font, includeSegments, wordBreak)
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
// operations, no allocations.
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

function getSegmentGraphemes(
  segmentIndex: number,
  segments: string[],
  cache: Map<number, string[]>,
): string[] {
  let graphemes = cache.get(segmentIndex)
  if (graphemes !== undefined) return graphemes

  graphemes = []
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const gs of graphemeSegmenter.segment(segments[segmentIndex]!)) {
    graphemes.push(gs.segment)
  }
  cache.set(segmentIndex, graphemes)
  return graphemes
}

function getLineTextCache(prepared: PreparedTextWithSegments): Map<number, string[]> {
  let cache = sharedLineTextCaches.get(prepared)
  if (cache !== undefined) return cache

  cache = new Map<number, string[]>()
  sharedLineTextCaches.set(prepared, cache)
  return cache
}

function lineHasDiscretionaryHyphen(
  kinds: SegmentBreakKind[],
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
): boolean {
  return (
    endSegmentIndex > 0 &&
    kinds[endSegmentIndex - 1] === 'soft-hyphen' &&
    !(startSegmentIndex === endSegmentIndex && startGraphemeIndex > 0)
  )
}

function buildLineTextFromRange(
  segments: string[],
  kinds: SegmentBreakKind[],
  cache: Map<number, string[]>,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): string {
  let text = ''
  const endsWithDiscretionaryHyphen = lineHasDiscretionaryHyphen(
    kinds,
    startSegmentIndex,
    startGraphemeIndex,
    endSegmentIndex,
  )

  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    if (kinds[i] === 'soft-hyphen' || kinds[i] === 'hard-break') continue
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      text += getSegmentGraphemes(i, segments, cache).slice(startGraphemeIndex).join('')
    } else {
      text += segments[i]!
    }
  }

  if (endGraphemeIndex > 0) {
    if (endsWithDiscretionaryHyphen) text += '-'
    text += getSegmentGraphemes(endSegmentIndex, segments, cache).slice(
      startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0,
      endGraphemeIndex,
    ).join('')
  } else if (endsWithDiscretionaryHyphen) {
    text += '-'
  }

  return text
}

function createLayoutLine(
  prepared: PreparedTextWithSegments,
  cache: Map<number, string[]>,
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): LayoutLine {
  return {
    text: buildLineTextFromRange(
      prepared.segments,
      prepared.kinds,
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

function materializeLayoutLine(
  prepared: PreparedTextWithSegments,
  cache: Map<number, string[]>,
  line: InternalLayoutLine,
): LayoutLine {
  return createLayoutLine(
    prepared,
    cache,
    line.width,
    line.startSegmentIndex,
    line.startGraphemeIndex,
    line.endSegmentIndex,
    line.endGraphemeIndex,
  )
}

function toLayoutLineRange(line: InternalLayoutLine): LayoutLineRange {
  return {
    width: line.width,
    start: {
      segmentIndex: line.startSegmentIndex,
      graphemeIndex: line.startGraphemeIndex,
    },
    end: {
      segmentIndex: line.endSegmentIndex,
      graphemeIndex: line.endGraphemeIndex,
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

  return walkPreparedLines(getInternalPrepared(prepared), maxWidth, line => {
    onLine(toLayoutLineRange(line))
  })
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
  walkLineRanges(prepared, Number.POSITIVE_INFINITY, line => {
    if (line.width > maxWidth) maxWidth = line.width
  })
  return maxWidth
}

export function layoutNextLine(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLine | null {
  const line = layoutNextLineRange(prepared, start, maxWidth)
  if (line === null) return null
  return materializeLineRange(prepared, line)
}

export function layoutNextLineRange(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  maxWidth: number,
): LayoutLineRange | null {
  const line = stepPreparedLineRange(prepared, start, maxWidth)
  if (line === null) return null
  return toLayoutLineRange(line)
}

// Rich layout API for callers that want the actual line contents and widths.
// Caller still supplies lineHeight at layout time. Mirrors layout()'s break
// decisions, but keeps extra per-line bookkeeping so it should stay off the
// resize hot path.
export function layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): LayoutLinesResult {
  const lines: LayoutLine[] = []
  if (prepared.widths.length === 0) return { lineCount: 0, height: 0, lines }

  const graphemeCache = getLineTextCache(prepared)
  const lineCount = walkPreparedLines(getInternalPrepared(prepared), maxWidth, line => {
    lines.push(materializeLayoutLine(prepared, graphemeCache, line))
  })

  return { lineCount, height: lineCount * lineHeight, lines }
}

export function clearCache(): void {
  clearAnalysisCaches()
  sharedGraphemeSegmenter = null
  sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()
  clearMeasurementCaches()
}

export function setLocale(locale?: string): void {
  setAnalysisLocale(locale)
  clearCache()
}
