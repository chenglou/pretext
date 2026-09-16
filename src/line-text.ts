import { getSharedGraphemeSegmenter } from './analysis.js'
import { isDiscretionaryLineEnd } from './line-break.js'
import type { PreparedTextWithSegments } from './layout.js'

const sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, number[]>>()

function getSegmentGraphemeOffsets(
  segmentIndex: number,
  segments: string[],
  cache: Map<number, number[]>,
): number[] {
  let offsets = cache.get(segmentIndex)
  if (offsets !== undefined) return offsets

  offsets = [0]
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const gs of graphemeSegmenter.segment(segments[segmentIndex]!)) {
    offsets.push(gs.index + gs.segment.length)
  }
  cache.set(segmentIndex, offsets)
  return offsets
}

export function getLineTextCache(prepared: PreparedTextWithSegments): Map<number, number[]> {
  let cache = sharedLineTextCaches.get(prepared)
  if (cache !== undefined) return cache

  cache = new Map<number, number[]>()
  sharedLineTextCaches.set(prepared, cache)
  return cache
}

export function buildLineTextFromRange(
  prepared: PreparedTextWithSegments,
  cache: Map<number, number[]>,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): string {
  let text = ''
  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    // A soft hyphen shows only as the hyphen of a line that ends at it.
    const kind = prepared.kinds[i]
    if (kind === 'soft-hyphen' || kind === 'hard-break' || (kind === 'zero-width-glue' && prepared.segments[i]!.charCodeAt(0) === 0x00AD)) continue
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      const offsets = getSegmentGraphemeOffsets(i, prepared.segments, cache)
      text += prepared.segments[i]!.slice(offsets[startGraphemeIndex]!)
    } else {
      text += prepared.segments[i]!
    }
  }

  if (endGraphemeIndex > 0) {
    const offsets = getSegmentGraphemeOffsets(endSegmentIndex, prepared.segments, cache)
    text += prepared.segments[endSegmentIndex]!.slice(
      offsets[startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0]!,
      offsets[endGraphemeIndex]!,
    )
  }

  return isDiscretionaryLineEnd(prepared.kinds, endSegmentIndex, endGraphemeIndex) ? text + '-' : text
}
