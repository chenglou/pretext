import {
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'

export type DemoControls = {
  colWidth: number
  showMetrics: boolean
  showBadness: boolean
  showFitness: boolean
}

export type DemoResources = {
  preparedParagraphs: PreparedTextWithSegments[]
  normalSpaceWidth: number
  hyphenWidth: number
}

type FitnessClass = 'tight' | 'decent' | 'loose' | 'very-loose'

type BreakKind = 'start' | 'space' | 'soft-hyphen' | 'end'

interface BreakCandidate {
  segIndex: number
  kind: BreakKind
}

interface LineStats {
  wordWidth: number
  spaceCount: number
  naturalWidth: number
  trailingMarker: 'none' | 'soft-hyphen'
  justifiedSpace: number
  fitness: FitnessClass
  badness: number
}

interface BreakAnalysis {
  candidates: BreakCandidate[]
  lineStats: LineStats[]
  totalBadness: number
  breakIndices: number[]
}

const HUGE_BADNESS = 1e9
const SOFT_HYPHEN = '\u00AD'
const RIVER_THRESHOLD = 1.5
const INFEASIBLE_SPACE_RATIO = 0.4
const TIGHT_SPACE_RATIO = 0.65
const LOOSE_SPACE_RATIO = 1.5
const HYPHEN_PENALTY = 50

export type LineSegment =
  | { kind: 'text'; text: string; width: number }
  | { kind: 'space'; width: number }

export type MeasuredLine = {
  segments: LineSegment[]
  wordWidth: number
  spaceCount: number
  naturalWidth: number
  ending: 'paragraph-end' | 'wrap'
  trailingMarker: 'none' | 'soft-hyphen'
  badness: number
  fitness: FitnessClass
  justifiedSpace: number
  breakKind: BreakKind
}

function isSpaceText(text: string): boolean {
  return text.trim().length === 0
}

function identifyBreakCandidates(segments: string[]): BreakCandidate[] {
  const candidates: BreakCandidate[] = [{ segIndex: 0, kind: 'start' }]
  const n = segments.length

  for (let i = 0; i < n; i++) {
    const text = segments[i]!
    if (text === SOFT_HYPHEN) {
      if (i + 1 < n) {
        candidates.push({ segIndex: i + 1, kind: 'soft-hyphen' })
      }
      continue
    }
    if (isSpaceText(text) && i + 1 < n) {
      candidates.push({ segIndex: i + 1, kind: 'space' })
    }
  }

  candidates.push({ segIndex: n, kind: 'end' })
  return candidates
}

function computeLineStats(
  segments: string[],
  widths: number[],
  candidates: BreakCandidate[],
  fromIdx: number,
  toIdx: number,
  normalSpaceWidth: number
): LineStats {
  const from = candidates[fromIdx]!.segIndex
  const to = candidates[toIdx]!.segIndex
  const trailingMarker: 'none' | 'soft-hyphen' =
    candidates[toIdx]!.kind === 'soft-hyphen' ? 'soft-hyphen' : 'none'
  const isLastLine = candidates[toIdx]!.kind === 'end'

  let wordWidth = 0
  let spaceCount = 0

  for (let i = from; i < to; i++) {
    const text = segments[i]!
    if (text === SOFT_HYPHEN) continue
    if (isSpaceText(text)) {
      spaceCount++
      continue
    }
    wordWidth += widths[i]!
  }

  if (to > from && isSpaceText(segments[to - 1]!)) {
    spaceCount--
  }

  const naturalWidth = wordWidth + spaceCount * normalSpaceWidth

  let justifiedSpace = normalSpaceWidth
  let fitness: FitnessClass = 'decent'
  let badness = 0

  if (isLastLine) {
    badness = wordWidth > candidates[toIdx]!.segIndex ? HUGE_BADNESS : 0
  } else if (spaceCount <= 0) {
    const slack = naturalWidth - wordWidth
    badness = slack < 0 ? HUGE_BADNESS : slack * slack * 10
  } else {
    justifiedSpace = (naturalWidth - wordWidth + spaceCount * normalSpaceWidth - wordWidth) / spaceCount

    if (justifiedSpace < normalSpaceWidth * INFEASIBLE_SPACE_RATIO) {
      badness = HUGE_BADNESS
    } else {
      const ratio = (justifiedSpace - normalSpaceWidth) / normalSpaceWidth
      const absRatio = Math.abs(ratio)
      badness = absRatio * absRatio * absRatio * 1000

      const riverExcess = justifiedSpace / normalSpaceWidth - RIVER_THRESHOLD
      if (riverExcess > 0) badness += 5000 + riverExcess * riverExcess * 10000

      const tightThreshold = normalSpaceWidth * TIGHT_SPACE_RATIO
      if (justifiedSpace < tightThreshold) {
        badness += 3000 + (tightThreshold - justifiedSpace) * (tightThreshold - justifiedSpace) * 10000
      }

      if (trailingMarker === 'soft-hyphen') badness += HYPHEN_PENALTY
    }

    const ratio = justifiedSpace / normalSpaceWidth
    if (ratio < TIGHT_SPACE_RATIO) fitness = 'tight'
    else if (ratio > LOOSE_SPACE_RATIO) fitness = 'very-loose'
    else if (ratio > 1.0) fitness = 'loose'
  }

  return { wordWidth, spaceCount, naturalWidth, trailingMarker, justifiedSpace, fitness, badness }
}

export function analyzeParagraphOptimal(
  prepared: PreparedTextWithSegments,
  maxWidth: number
): BreakAnalysis {
  const segments = prepared.segments as unknown as string[]
  const widths = prepared.widths as unknown as number[]
  const n = segments.length

  if (n === 0) return { candidates: [], lineStats: [], totalBadness: 0, breakIndices: [] }

  const normalSpaceWidth = (() => {
    for (let i = 0; i < n; i++) {
      if (isSpaceText(segments[i]!)) return widths[i]!
    }
    return 8
  })()

  const candidates = identifyBreakCandidates(segments)
  const m = candidates.length

  const dp: number[] = new Array(m).fill(Infinity)
  const previous: number[] = new Array(m).fill(-1)
  dp[0] = 0

  for (let toCandidate = 1; toCandidate < m; toCandidate++) {
    for (let fromCandidate = toCandidate - 1; fromCandidate >= 0; fromCandidate--) {
      if (dp[fromCandidate] === Infinity) continue

      const lineStats = computeLineStats(
        segments,
        widths,
        candidates,
        fromCandidate,
        toCandidate,
        normalSpaceWidth
      )

      if (lineStats.naturalWidth > maxWidth * 2) break

      const totalBadness = dp[fromCandidate]! + lineStats.badness
      if (totalBadness < dp[toCandidate]!) {
        dp[toCandidate] = totalBadness
        previous[toCandidate] = fromCandidate
      }
    }
  }

  const lineStats: LineStats[] = []
  const breakIndices: number[] = []

  if (dp[m - 1] !== Infinity) {
    let current = m - 1
    while (current > 0) {
      if (previous[current] !== -1) {
        breakIndices.push(current)
        const stats = computeLineStats(
          segments,
          widths,
          candidates,
          previous[current]!,
          current,
          normalSpaceWidth
        )
        lineStats.unshift(stats)
      }
      current = previous[current]!
      if (current === -1) break
    }
    breakIndices.reverse()
  }

  return {
    candidates,
    lineStats,
    totalBadness: dp[m - 1] === Infinity ? Infinity : dp[m - 1]!,
    breakIndices
  }
}

export function layoutParagraphOptimal(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  normalSpaceWidth: number
): MeasuredLine[] {
  const segments = prepared.segments as unknown as string[]
  const widths = prepared.widths as unknown as number[]
  const n = segments.length

  if (n === 0) return []

  const analysis = analyzeParagraphOptimal(prepared, maxWidth)
  if (analysis.breakIndices.length === 0) return []

  const lines: MeasuredLine[] = []
  let fromCandidate = 0

  for (let i = 0; i < analysis.breakIndices.length; i++) {
    const toCandidate = analysis.breakIndices[i]!
    const from = analysis.candidates[fromCandidate]!.segIndex
    const to = analysis.candidates[toCandidate]!.segIndex
    const ending: 'paragraph-end' | 'wrap' = analysis.candidates[toCandidate]!.kind === 'end' ? 'paragraph-end' : 'wrap'
    const trailingMarker: 'none' | 'soft-hyphen' = analysis.candidates[toCandidate]!.kind === 'soft-hyphen' ? 'soft-hyphen' : 'none'

    const lineSegments: LineSegment[] = []
    for (let j = from; j < to; j++) {
      const text = segments[j]!
      if (text === SOFT_HYPHEN) continue
      if (isSpaceText(text)) {
        lineSegments.push({ kind: 'space', width: widths[j]! })
      } else {
        lineSegments.push({ kind: 'text', text, width: widths[j]! })
      }
    }

    if (trailingMarker === 'soft-hyphen' && ending === 'wrap') {
      lineSegments.push({ kind: 'text', text: '-', width: normalSpaceWidth * 0.4 })
    }

    while (lineSegments.length > 0 && lineSegments[lineSegments.length - 1]!.kind === 'space') {
      lineSegments.pop()
    }

    const stats = analysis.lineStats[i]!

    lines.push({
      segments: lineSegments,
      wordWidth: stats.wordWidth,
      spaceCount: stats.spaceCount,
      naturalWidth: stats.naturalWidth,
      ending,
      trailingMarker,
      badness: stats.badness,
      fitness: stats.fitness,
      justifiedSpace: stats.justifiedSpace,
      breakKind: analysis.candidates[toCandidate]!.kind
    })

    fromCandidate = toCandidate
  }

  return lines
}

export function createDemoResources(): DemoResources {
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (measureCtx === null) throw new Error('2D canvas context is required for the demo')
  measureCtx.font = '16px Georgia, "Times New Roman", serif'

  const paragraphs = [
    `The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet at least once, making it a perfect pangram for testing typography.`,
    `In the beginning God created the heavens and the earth. Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters.`,
    `Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.`,
    `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.`,
  ]

  return {
    preparedParagraphs: paragraphs.map(p => prepareWithSegments(p, '16px Georgia, "Times New Roman", serif')),
    normalSpaceWidth: measureCtx.measureText(' ').width,
    hyphenWidth: measureCtx.measureText('-').width,
  }
}
