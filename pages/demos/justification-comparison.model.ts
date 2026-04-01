import {
  prepareWithSegments,
  layoutNextLine,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import {
  FONT,
  HYPHEN_EXCEPTIONS,
  LINE_HEIGHT,
  PAD,
  PARA_GAP,
  PARAGRAPHS,
  PREFIXES,
  SUFFIXES,
} from './justification-comparison.data.ts'

const HUGE_BADNESS = 1e8
const SOFT_HYPHEN = '\u00AD'
const SHORT_LINE_RATIO = 0.6
const RIVER_THRESHOLD = 1.5
const INFEASIBLE_SPACE_RATIO = 0.4
const OVERFLOW_SPACE_RATIO = 0.2
const TIGHT_SPACE_RATIO = 0.65

export type DemoControls = {
  colWidth: number
  showIndicators: boolean
}

export type DemoResources = {
  basePreparedParagraphs: PreparedTextWithSegments[]
  hyphenatedPreparedParagraphs: PreparedTextWithSegments[]
  normalSpaceWidth: number
  hyphenWidth: number
}

type TrailingMarker = 'none' | 'soft-hyphen'
type LineEnding = 'paragraph-end' | 'wrap'
type BreakCandidateKind = 'start' | 'space' | 'soft-hyphen' | 'end'

export type LineSegment =
  | { kind: 'text'; text: string; width: number }
  | { kind: 'space'; width: number }

export type MeasuredLine = {
  segments: LineSegment[]
  wordWidth: number
  spaceCount: number
  naturalWidth: number
  maxWidth: number
  ending: LineEnding
  trailingMarker: TrailingMarker
}

export type LineSpacing =
  | { kind: 'ragged' }
  | { kind: 'overflow' }
  | { kind: 'justified'; width: number; isRiver: boolean }

export type PositionedLine = MeasuredLine & {
  y: number
  spacing: LineSpacing
}

export type QualityMetrics = {
  avgDeviation: number
  maxDeviation: number
  riverCount: number
  lineCount: number
}

export type CanvasColumnFrame = {
  colWidth: number
  totalHeight: number
  paragraphs: PositionedLine[][]
  metrics: QualityMetrics
}

export type DemoFrame = {
  controls: DemoControls
  css: {
    metrics: QualityMetrics
  }
  hyphen: CanvasColumnFrame
  optimal: CanvasColumnFrame
}

export type RiverIndicator = {
  red: number
  green: number
  blue: number
  alpha: number
}

type BreakCandidate = {
  segIndex: number
  kind: BreakCandidateKind
}

type LineStats = {
  wordWidth: number
  spaceCount: number
  naturalWidth: number
  trailingMarker: TrailingMarker
}

export function createDemoResources(): DemoResources {
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (measureCtx === null) throw new Error('2D canvas context is required for the demo')
  measureCtx.font = FONT

  return {
    basePreparedParagraphs: PARAGRAPHS.map(paragraph => prepareWithSegments(paragraph, FONT)),
    hyphenatedPreparedParagraphs: PARAGRAPHS.map(paragraph => prepareWithSegments(hyphenateParagraphText(paragraph), FONT)),
    normalSpaceWidth: measureCtx.measureText(' ').width,
    hyphenWidth: measureCtx.measureText('-').width,
  }
}

export function buildDemoFrame(resources: DemoResources, controls: DemoControls): DemoFrame {
  const innerWidth = controls.colWidth - PAD * 2

  const cssParagraphs = layoutParagraphsGreedy(resources.basePreparedParagraphs, innerWidth, resources.hyphenWidth)
  const hyphenParagraphs = layoutParagraphsGreedy(resources.hyphenatedPreparedParagraphs, innerWidth, resources.hyphenWidth)
  const optimalParagraphs = layoutParagraphsOptimal(resources.hyphenatedPreparedParagraphs, innerWidth, resources)

  return {
    controls,
    css: {
      metrics: computeMetrics(cssParagraphs, resources.normalSpaceWidth),
    },
    hyphen: buildCanvasColumnFrame(controls.colWidth, hyphenParagraphs, resources.normalSpaceWidth),
    optimal: buildCanvasColumnFrame(controls.colWidth, optimalParagraphs, resources.normalSpaceWidth),
  }
}

export function getRiverIndicator(spaceWidth: number, normalSpaceWidth: number): RiverIndicator | null {
  if (spaceWidth <= normalSpaceWidth * RIVER_THRESHOLD) return null

  const intensity = Math.min(1, (spaceWidth / normalSpaceWidth - RIVER_THRESHOLD) / RIVER_THRESHOLD)
  return {
    red: Math.round(220 + intensity * 35),
    green: Math.round(180 - intensity * 80),
    blue: Math.round(180 - intensity * 80),
    alpha: 0.25 + intensity * 0.35,
  }
}

function hyphenateParagraphText(paragraph: string): string {
  const words = paragraph.split(/(\s+)/)
  let hyphenated = ''
  for (let index = 0; index < words.length; index++) {
    const token = words[index]!
    if (/^\s+$/.test(token)) {
      hyphenated += token
      continue
    }
    const parts = hyphenateWord(token)
    hyphenated += parts.length <= 1 ? token : parts.join(SOFT_HYPHEN)
  }
  return hyphenated
}

function hyphenateWord(word: string): string[] {
  const lower = word.toLowerCase().replace(/[.,;:!?"'—–-]/g, '')
  if (lower.length < 5) return [word]

  const exactMatch = HYPHEN_EXCEPTIONS[lower]
  if (exactMatch !== undefined) {
    const parts: string[] = []
    let position = 0
    for (let index = 0; index < exactMatch.length; index++) {
      const part = exactMatch[index]!
      parts.push(word.slice(position, position + part.length))
      position += part.length
    }
    if (position < word.length) {
      parts[parts.length - 1] += word.slice(position)
    }
    return parts
  }

  for (let index = 0; index < PREFIXES.length; index++) {
    const prefix = PREFIXES[index]!
    if (lower.startsWith(prefix) && lower.length - prefix.length >= 3) {
      return [word.slice(0, prefix.length), word.slice(prefix.length)]
    }
  }

  for (let index = 0; index < SUFFIXES.length; index++) {
    const suffix = SUFFIXES[index]!
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 3) {
      const cut = word.length - suffix.length
      return [word.slice(0, cut), word.slice(cut)]
    }
  }

  return [word]
}

function layoutParagraphsGreedy(
  preparedParagraphs: PreparedTextWithSegments[],
  maxWidth: number,
  hyphenWidth: number,
): MeasuredLine[][] {
  const paragraphs: MeasuredLine[][] = []
  for (let index = 0; index < preparedParagraphs.length; index++) {
    paragraphs.push(layoutParagraphGreedy(preparedParagraphs[index]!, maxWidth, hyphenWidth))
  }
  return paragraphs
}

function layoutParagraphGreedy(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  hyphenWidth: number,
): MeasuredLine[] {
  const lines: MeasuredLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

  while (true) {
    const line = layoutNextLine(prepared, cursor, maxWidth)
    if (line === null) break
    lines.push(buildMeasuredLineFromLayoutResult(prepared, line.start, line.end, maxWidth, hyphenWidth))
    cursor = line.end
  }

  return lines
}

function buildMeasuredLineFromLayoutResult(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  end: LayoutCursor,
  maxWidth: number,
  hyphenWidth: number,
): MeasuredLine {
  const ending: LineEnding = end.segmentIndex >= prepared.segments.length ? 'paragraph-end' : 'wrap'
  let trailingMarker: TrailingMarker = 'none'
  const segments: LineSegment[] = []

  for (let segIndex = start.segmentIndex; segIndex < end.segmentIndex; segIndex++) {
    const text = prepared.segments[segIndex]!
    if (text === SOFT_HYPHEN) {
      if (segIndex === end.segmentIndex - 1) trailingMarker = 'soft-hyphen'
      continue
    }
    segments.push(toLineSegment(text, prepared.widths[segIndex]!))
  }

  if (trailingMarker === 'none' && end.segmentIndex < prepared.segments.length) {
    if (prepared.segments[end.segmentIndex] === SOFT_HYPHEN) trailingMarker = 'soft-hyphen'
  }

  if (trailingMarker === 'soft-hyphen' && ending === 'wrap') {
    segments.push({ kind: 'text', text: '-', width: hyphenWidth })
  }

  trimTrailingSpaces(segments)
  return finalizeMeasuredLine(segments, maxWidth, ending, trailingMarker)
}

function layoutParagraphsOptimal(
  preparedParagraphs: PreparedTextWithSegments[],
  maxWidth: number,
  resources: DemoResources,
): MeasuredLine[][] {
  const paragraphs: MeasuredLine[][] = []
  for (let index = 0; index < preparedParagraphs.length; index++) {
    paragraphs.push(layoutParagraphOptimal(preparedParagraphs[index]!, maxWidth, resources))
  }
  return paragraphs
}

function layoutParagraphOptimal(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  resources: DemoResources,
): MeasuredLine[] {
  const segments = prepared.segments
  const widths = prepared.widths
  const segmentCount = segments.length

  if (segmentCount === 0) return []

  const breakCandidates: BreakCandidate[] = [{ segIndex: 0, kind: 'start' }]
  for (let segIndex = 0; segIndex < segmentCount; segIndex++) {
    const text = segments[segIndex]!
    if (text === SOFT_HYPHEN) {
      if (segIndex + 1 < segmentCount) breakCandidates.push({ segIndex: segIndex + 1, kind: 'soft-hyphen' })
      continue
    }
    if (isSpaceText(text) && segIndex + 1 < segmentCount) {
      breakCandidates.push({ segIndex: segIndex + 1, kind: 'space' })
    }
  }
  breakCandidates.push({ segIndex: segmentCount, kind: 'end' })

  const candidateCount = breakCandidates.length
  const dp: number[] = new Array(candidateCount).fill(Infinity)
  const previous: number[] = new Array(candidateCount).fill(-1)
  dp[0] = 0

  for (let toCandidate = 1; toCandidate < candidateCount; toCandidate++) {
    const isLastLine = breakCandidates[toCandidate]!.kind === 'end'

    for (let fromCandidate = toCandidate - 1; fromCandidate >= 0; fromCandidate--) {
      if (dp[fromCandidate] === Infinity) continue
      const lineStats = getLineStatsFromBreakCandidates(
        segments,
        widths,
        breakCandidates,
        fromCandidate,
        toCandidate,
        resources.hyphenWidth,
        resources.normalSpaceWidth,
      )

      if (lineStats.naturalWidth > maxWidth * 2) break

      const totalBadness = dp[fromCandidate]! + lineBadness(lineStats, maxWidth, resources.normalSpaceWidth, isLastLine)
      if (totalBadness < dp[toCandidate]!) {
        dp[toCandidate] = totalBadness
        previous[toCandidate] = fromCandidate
      }
    }
  }

  const breakIndices: number[] = []
  let current = candidateCount - 1
  while (current > 0) {
    if (previous[current] === -1) {
      current--
      continue
    }
    breakIndices.push(current)
    current = previous[current]!
  }
  breakIndices.reverse()

  const lines: MeasuredLine[] = []
  let fromCandidate = 0
  for (let index = 0; index < breakIndices.length; index++) {
    const toCandidate = breakIndices[index]!
    lines.push(buildMeasuredLineFromCandidateRange(prepared, breakCandidates, fromCandidate, toCandidate, maxWidth, resources.hyphenWidth))
    fromCandidate = toCandidate
  }

  return lines
}

function getLineStatsFromBreakCandidates(
  segments: readonly string[],
  widths: readonly number[],
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
  hyphenWidth: number,
  normalSpaceWidth: number,
): LineStats {
  const from = breakCandidates[fromCandidate]!.segIndex
  const to = breakCandidates[toCandidate]!.segIndex
  const trailingMarker: TrailingMarker = breakCandidates[toCandidate]!.kind === 'soft-hyphen'
    ? 'soft-hyphen'
    : 'none'

  let wordWidth = 0
  let spaceCount = 0
  for (let segIndex = from; segIndex < to; segIndex++) {
    const text = segments[segIndex]!
    if (text === SOFT_HYPHEN) continue
    if (isSpaceText(text)) {
      spaceCount++
      continue
    }
    wordWidth += widths[segIndex]!
  }

  if (to > from && isSpaceText(segments[to - 1]!)) {
    spaceCount--
  }

  if (trailingMarker === 'soft-hyphen') {
    wordWidth += hyphenWidth
  }

  return {
    wordWidth,
    spaceCount,
    naturalWidth: wordWidth + spaceCount * normalSpaceWidth,
    trailingMarker,
  }
}

function lineBadness(
  lineStats: LineStats,
  maxWidth: number,
  normalSpaceWidth: number,
  isLastLine: boolean,
): number {
  if (isLastLine) {
    if (lineStats.wordWidth > maxWidth) return HUGE_BADNESS
    return 0
  }

  if (lineStats.spaceCount <= 0) {
    const slack = maxWidth - lineStats.wordWidth
    if (slack < 0) return HUGE_BADNESS
    return slack * slack * 10
  }

  const justifiedSpace = (maxWidth - lineStats.wordWidth) / lineStats.spaceCount
  if (justifiedSpace < 0) return HUGE_BADNESS
  if (justifiedSpace < normalSpaceWidth * INFEASIBLE_SPACE_RATIO) return HUGE_BADNESS

  const ratio = (justifiedSpace - normalSpaceWidth) / normalSpaceWidth
  const absRatio = Math.abs(ratio)
  const badness = absRatio * absRatio * absRatio * 1000

  const riverExcess = justifiedSpace / normalSpaceWidth - RIVER_THRESHOLD
  const riverPenalty = riverExcess > 0
    ? 5000 + riverExcess * riverExcess * 10000
    : 0

  const tightThreshold = normalSpaceWidth * TIGHT_SPACE_RATIO
  const tightPenalty = justifiedSpace < tightThreshold
    ? 3000 + (tightThreshold - justifiedSpace) * (tightThreshold - justifiedSpace) * 10000
    : 0

  const hyphenPenalty = lineStats.trailingMarker === 'soft-hyphen' ? 50 : 0
  return badness + riverPenalty + tightPenalty + hyphenPenalty
}

function buildMeasuredLineFromCandidateRange(
  prepared: PreparedTextWithSegments,
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
  maxWidth: number,
  hyphenWidth: number,
): MeasuredLine {
  const from = breakCandidates[fromCandidate]!.segIndex
  const to = breakCandidates[toCandidate]!.segIndex
  const ending: LineEnding = breakCandidates[toCandidate]!.kind === 'end' ? 'paragraph-end' : 'wrap'
  const trailingMarker: TrailingMarker = breakCandidates[toCandidate]!.kind === 'soft-hyphen'
    ? 'soft-hyphen'
    : 'none'

  const segments: LineSegment[] = []
  for (let segIndex = from; segIndex < to; segIndex++) {
    const text = prepared.segments[segIndex]!
    if (text === SOFT_HYPHEN) continue
    segments.push(toLineSegment(text, prepared.widths[segIndex]!))
  }

  if (trailingMarker === 'soft-hyphen' && ending === 'wrap') {
    segments.push({ kind: 'text', text: '-', width: hyphenWidth })
  }

  trimTrailingSpaces(segments)
  return finalizeMeasuredLine(segments, maxWidth, ending, trailingMarker)
}

function toLineSegment(text: string, width: number): LineSegment {
  if (isSpaceText(text)) return { kind: 'space', width }
  return { kind: 'text', text, width }
}

function trimTrailingSpaces(segments: LineSegment[]): void {
  while (segments.length > 0 && segments[segments.length - 1]!.kind === 'space') {
    segments.pop()
  }
}

function finalizeMeasuredLine(
  segments: LineSegment[],
  maxWidth: number,
  ending: LineEnding,
  trailingMarker: TrailingMarker,
): MeasuredLine {
  let wordWidth = 0
  let spaceCount = 0
  let naturalWidth = 0

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    naturalWidth += segment.width
    if (segment.kind === 'space') {
      spaceCount++
      continue
    }
    wordWidth += segment.width
  }

  return {
    segments,
    wordWidth,
    spaceCount,
    naturalWidth,
    maxWidth,
    ending,
    trailingMarker,
  }
}

function computeMetrics(
  paragraphs: MeasuredLine[][],
  normalSpaceWidth: number,
): QualityMetrics {
  let totalDeviation = 0
  let maxDeviation = 0
  let deviationCount = 0
  let riverCount = 0
  let lineCount = 0

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const paragraph = paragraphs[paragraphIndex]!
    lineCount += paragraph.length

    for (let lineIndex = 0; lineIndex < paragraph.length; lineIndex++) {
      const line = paragraph[lineIndex]!
      const metricSpaceWidth = getMetricSpaceWidth(line)
      if (metricSpaceWidth === null) continue

      const deviation = Math.abs(metricSpaceWidth - normalSpaceWidth) / normalSpaceWidth
      totalDeviation += deviation
      if (deviation > maxDeviation) maxDeviation = deviation
      deviationCount++

      if (metricSpaceWidth > normalSpaceWidth * RIVER_THRESHOLD) riverCount++
    }
  }

  return {
    avgDeviation: deviationCount > 0 ? totalDeviation / deviationCount : 0,
    maxDeviation,
    riverCount,
    lineCount,
  }
}

function getMetricSpaceWidth(line: MeasuredLine): number | null {
  if (line.ending === 'paragraph-end' || line.spaceCount <= 0) return null
  return (line.maxWidth - line.wordWidth) / line.spaceCount
}

function buildCanvasColumnFrame(
  colWidth: number,
  paragraphs: MeasuredLine[][],
  normalSpaceWidth: number,
): CanvasColumnFrame {
  let y = PAD
  const positionedParagraphs: PositionedLine[][] = []

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const paragraph = paragraphs[paragraphIndex]!
    const positionedLines: PositionedLine[] = []

    for (let lineIndex = 0; lineIndex < paragraph.length; lineIndex++) {
      const line = paragraph[lineIndex]!
      positionedLines.push({
        ...line,
        y,
        spacing: getDisplaySpacing(line, normalSpaceWidth),
      })
      y += LINE_HEIGHT
    }

    positionedParagraphs.push(positionedLines)
    if (paragraphIndex < paragraphs.length - 1) y += PARA_GAP
  }

  return {
    colWidth,
    totalHeight: y + PAD,
    paragraphs: positionedParagraphs,
    metrics: computeMetrics(paragraphs, normalSpaceWidth),
  }
}

function getDisplaySpacing(line: MeasuredLine, normalSpaceWidth: number): LineSpacing {
  if (line.ending === 'paragraph-end') return { kind: 'ragged' }
  if (line.naturalWidth < line.maxWidth * SHORT_LINE_RATIO) return { kind: 'ragged' }
  if (line.spaceCount <= 0) return { kind: 'ragged' }

  const rawJustifiedSpace = (line.maxWidth - line.wordWidth) / line.spaceCount
  if (rawJustifiedSpace < normalSpaceWidth * OVERFLOW_SPACE_RATIO) return { kind: 'overflow' }

  return {
    kind: 'justified',
    width: rawJustifiedSpace,
    isRiver: rawJustifiedSpace > normalSpaceWidth * RIVER_THRESHOLD,
  }
}

function isSpaceText(text: string): boolean {
  return text.trim().length === 0
}
