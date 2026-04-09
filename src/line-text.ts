import type { SegmentBreakKind } from './analysis.js'
import type { PreparedTextWithSegments } from './layout.js'

let sharedGraphemeSegmenter: Intl.Segmenter | null = null
let sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()

function getSharedGraphemeSegmenter(): Intl.Segmenter {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return sharedGraphemeSegmenter
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

function appendSegmentGraphemeRange(
  text: string,
  graphemes: string[],
  startGraphemeIndex: number,
  endGraphemeIndex: number,
): string {
  for (let i = startGraphemeIndex; i < endGraphemeIndex; i++) {
    text += graphemes[i]!
  }
  return text
}

export function getLineTextCache(prepared: PreparedTextWithSegments): Map<number, string[]> {
  let cache = sharedLineTextCaches.get(prepared)
  if (cache !== undefined) return cache

  cache = new Map<number, string[]>()
  sharedLineTextCaches.set(prepared, cache)
  return cache
}

export function buildLineTextFromRange(
  prepared: PreparedTextWithSegments,
  cache: Map<number, string[]>,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): string {
  let text = ''
  const endsWithDiscretionaryHyphen = lineHasDiscretionaryHyphen(
    prepared.kinds,
    startSegmentIndex,
    startGraphemeIndex,
    endSegmentIndex,
  )

  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    if (prepared.kinds[i] === 'soft-hyphen' || prepared.kinds[i] === 'hard-break') continue
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      const graphemes = getSegmentGraphemes(i, prepared.segments, cache)
      text = appendSegmentGraphemeRange(text, graphemes, startGraphemeIndex, graphemes.length)
    } else {
      text += prepared.segments[i]!
    }
  }

  if (endGraphemeIndex > 0) {
    if (endsWithDiscretionaryHyphen) text += '-'
    const graphemes = getSegmentGraphemes(endSegmentIndex, prepared.segments, cache)
    text = appendSegmentGraphemeRange(
      text,
      graphemes,
      startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0,
      endGraphemeIndex,
    )
  } else if (endsWithDiscretionaryHyphen) {
    text += '-'
  }

  return text
}

export function clearLineTextCaches(): void {
  sharedGraphemeSegmenter = null
  sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>()
}
