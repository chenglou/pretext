import { findGraphemeEnds } from './graphemes.js'
import { HARD_BREAK, KIND_BITS, SOFT_HYPHEN, ZERO_WIDTH_BREAK, ZERO_WIDTH_GLUE } from './analysis.js'
import { isDiscretionaryLineEnd, type PreparedLineBreakData } from './line-break.js'
import { getEngineProfile } from './measurement.js'

// A handle with each segment's text, which line text is built from: prepareWithSegments()'s, or
// a rich-inline paragraph's.
export type PreparedSegments = PreparedLineBreakData & { segments: string[] }

// Per handle, the grapheme ends of each segment a line has started or ended inside.
const graphemeEndCaches = new WeakMap<PreparedSegments, Map<number, Int32Array>>()

// The offsets in a segment's text where its graphemes end, in order, then zeros.
export function getGraphemeEnds(prepared: PreparedSegments, segmentIndex: number): Int32Array {
  let cache = graphemeEndCaches.get(prepared)
  if (cache === undefined) {
    cache = new Map<number, Int32Array>()
    graphemeEndCaches.set(prepared, cache)
  }
  let ends = cache.get(segmentIndex)
  if (ends === undefined) {
    const segment = prepared.segments[segmentIndex]!
    ends = new Int32Array(segment.length)
    findGraphemeEnds(getEngineProfile().graphemeTable, segment, 0, segment.length, ends)
    cache.set(segmentIndex, ends)
  }
  return ends
}

// Where grapheme `graphemeIndex` of a segment starts in its text.
function getGraphemeStart(prepared: PreparedSegments, segmentIndex: number, graphemeIndex: number): number {
  return graphemeIndex === 0 ? 0 : getGraphemeEnds(prepared, segmentIndex)[graphemeIndex - 1]!
}

// The text of a range of `prepared`'s segments: a line's, with a hyphen where it ends at a soft hyphen, whose width
// counted it, or with `endsLine` false that of a rich-inline fragment its line goes on after.
export function buildLineTextFromRange(
  prepared: PreparedSegments,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
  endsLine = true,
): string {
  const { segmentFlags } = prepared
  // A range kept from a longer text, such as one prepared again since, can end
  // past this one, up to segment Infinity: its text stops at this text's end.
  const segmentCount = prepared.segments.length
  const segmentEnd = endSegmentIndex < segmentCount ? endSegmentIndex : segmentCount
  let text = ''
  for (let i = startSegmentIndex; i < segmentEnd; i++) {
    // A soft hyphen shows only as the hyphen of a line that ends at it, and one the
    // Gecko scan takes as a zero-width break never does.
    const kind = segmentFlags[i]! & KIND_BITS
    if (
      kind === SOFT_HYPHEN || kind === HARD_BREAK ||
      ((kind === ZERO_WIDTH_GLUE || kind === ZERO_WIDTH_BREAK) && prepared.segments[i]!.charCodeAt(0) === 0x00AD)
    ) continue
    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      text += prepared.segments[i]!.slice(getGraphemeStart(prepared, i, startGraphemeIndex))
    } else {
      text += prepared.segments[i]!
    }
  }

  if (endGraphemeIndex > 0 && endSegmentIndex < segmentCount) {
    text += prepared.segments[endSegmentIndex]!.slice(
      getGraphemeStart(prepared, endSegmentIndex, startSegmentIndex === endSegmentIndex ? startGraphemeIndex : 0),
      getGraphemeStart(prepared, endSegmentIndex, endGraphemeIndex),
    )
  }

  return endsLine && isDiscretionaryLineEnd(segmentFlags, endSegmentIndex, endGraphemeIndex) ? text + '-' : text
}
