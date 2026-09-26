import { findGraphemeEnds } from './graphemes.js'
import { HARD_BREAK, isDiscretionaryLineEnd, KIND_BITS, SOFT_HYPHEN, ZERO_WIDTH_BREAK, ZERO_WIDTH_GLUE } from './line-break.js'
import { getEngineProfile } from './measurement.js'
import type { PreparedTextWithSegments } from './layout.js'

const sharedLineTextCaches = new WeakMap<PreparedTextWithSegments, Map<number, number[]>>()

function getSegmentGraphemeOffsets(
  segmentIndex: number,
  segments: string[],
  cache: Map<number, number[]>,
): number[] {
  let offsets = cache.get(segmentIndex)
  if (offsets !== undefined) return offsets

  const segment = segments[segmentIndex]!
  const ends = new Int32Array(segment.length)
  const count = findGraphemeEnds(getEngineProfile().graphemeTable, segment, 0, segment.length, ends)
  offsets = [0]
  for (let i = 0; i < count; i++) offsets.push(ends[i]!)
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
  const { segmentFlags } = prepared
  let text = ''
  for (let i = startSegmentIndex; i < endSegmentIndex; i++) {
    // A soft hyphen shows only as the hyphen of a line that ends at it, and one the
    // Gecko scan takes as a zero-width break never does.
    const kind = segmentFlags[i]! & KIND_BITS
    if (
      kind === SOFT_HYPHEN || kind === HARD_BREAK ||
      ((kind === ZERO_WIDTH_GLUE || kind === ZERO_WIDTH_BREAK) && prepared.segments[i]!.charCodeAt(0) === 0x00AD)
    ) continue
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

  return isDiscretionaryLineEnd(segmentFlags, endSegmentIndex, endGraphemeIndex) ? text + '-' : text
}
