import { getSharedGraphemeSegmenter } from './analysis.js'

const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u
const MAX_GRAPHEMES = 96
const MAX_HEAD_ENDPOINTS = 3

type FreshEntry = { head: number[]; admissionFit: number }
export type SegmentEntryGeometry = {
  terminalPrefixes: number[]
  entries: (FreshEntry | null)[]
}

type Part = { start: number; end: number; observe: boolean }

// Projection selects original source intervals, never measurement text or break
// permission. Preserve original boundaries except where projection reunites them.
function affectedIntervals(text: string, endpoints: readonly number[]): Part[] {
  const spans: { start: number; end: number }[] = []
  const projected: string[] = []
  const visibleRuns = /[^\p{Default_Ignorable_Code_Point}]+/gu
  for (let match; (match = visibleRuns.exec(text)) !== null;) {
    spans.push({ start: match.index, end: match.index + match[0].length })
    projected.push(match[0])
  }
  // Map only the projected grapheme endpoints through retained source views.
  // The last code unit maps before an ignored gap; the next start maps after it.
  let spanIndex = 0
  let projectedStart = 0
  function sourceOffset(offset: number): number {
    let span = spans[spanIndex]!
    while (offset >= projectedStart + span.end - span.start) {
      projectedStart += span.end - span.start
      span = spans[++spanIndex]!
    }
    return span.start + offset - projectedStart
  }
  const joined = new Uint8Array(endpoints.length)
  let boundaryIndex = 1
  for (const part of getSharedGraphemeSegmenter().segment(projected.join(''))) {
    const start = sourceOffset(part.index)
    const end = sourceOffset(part.index + part.segment.length - 1) + 1
    while (boundaryIndex < endpoints.length && endpoints[boundaryIndex]! <= start) boundaryIndex++
    while (boundaryIndex < endpoints.length && endpoints[boundaryIndex]! < end) joined[boundaryIndex++] = 1
  }
  const parts: Part[] = []
  let start = 0
  for (let index = 1; index < endpoints.length; index++) {
    if (joined[index] === 1) continue
    const end = endpoints[index]!
    parts.push({ start, end, observe: defaultIgnorable.test(text.slice(start, end)) })
    start = end
  }
  const leadingEnd = spans.length === 0 ? text.length : spans[0]!.start
  if (leadingEnd > 0 && leadingEnd < text.length) {
    let firstVisiblePart = 0
    while (parts[firstVisiblePart]!.end <= leadingEnd) firstVisiblePart++
    parts.splice(0, firstVisiblePart + 1, { start: 0, end: parts[firstVisiblePart]!.end, observe: true })
  }
  return parts
}

// At most 96 original graphemes and three exact head queries per covered entry.
// Each source grapheme enters at most 3 + 2 + 1 measured prefixes across all
// starts, so submitted UTF-16 stays at most six times the source length.
// Preparation retains only numeric geometry for subsequent line walking.
export function observeSegmentEntries(
  text: string,
  advances: readonly number[],
  letterSpacing: number,
  wholeWidth: number,
  fitBasis: 'fresh' | 'original',
  measure: (text: string) => number | null,
): SegmentEntryGeometry | null {
  if (!defaultIgnorable.test(text) || advances.length > MAX_GRAPHEMES || !Number.isFinite(letterSpacing)) return null
  const endpoints = [0]
  for (const part of getSharedGraphemeSegmenter().segment(text)) {
    endpoints.push(part.index + part.segment.length)
    if (endpoints.length > MAX_GRAPHEMES + 1) {
      return null
    }
  }
  if (endpoints.length !== advances.length + 1) throw new Error('Entry and release grapheme cursors differ')
  const parts = affectedIntervals(text, endpoints)
  const terminalPrefixes = [0]
  for (const advance of advances) terminalPrefixes.push(terminalPrefixes[terminalPrefixes.length - 1]! + advance + letterSpacing)
  const entries: (FreshEntry | null)[] = Array.from({ length: advances.length }, () => null)
  let partIndex = 0
  let hasEntries = false
  for (let start = 1; start < advances.length; start++) {
    const sourceStart = endpoints[start]!
    while (partIndex < parts.length && parts[partIndex]!.end <= sourceStart) partIndex++
    const part = parts[partIndex]
    // An anchor supplies right context for the preceding affected interval;
    // its own resume cursor does not thereby belong to that interval.
    if (part === undefined || !part.observe || sourceStart < part.start) continue
    let anchor = start + 1
    while (anchor < advances.length && endpoints[anchor]! <= part.end) anchor++
    // Coverage requires one complete original right grapheme beyond the
    // affected interval. A clipped/terminal view cannot supply that anchor;
    // measuring its isolated end is a different, unverified observation.
    if (endpoints[anchor]! <= part.end || anchor - start > MAX_HEAD_ENDPOINTS) continue
    const head: number[] = []
    let complete = true
    for (let end = start + 1; end <= anchor; end++) {
      const query = text.slice(sourceStart, endpoints[end])
      const width = measure(query)
      if (width === null || !Number.isFinite(width)) { complete = false; break }
      head.push(width)
    }
    if (!complete) continue
    let admissionFit: number
    switch (fitBasis) {
      case 'fresh':
        admissionFit = head[head.length - 1]! +
          (terminalPrefixes[advances.length]! - terminalPrefixes[anchor]!)
        break
      case 'original':
        admissionFit = wholeWidth + letterSpacing - terminalPrefixes[start]!
        break
    }
    entries[start] = { head, admissionFit }
    hasEntries = true
  }
  return hasEntries ? { terminalPrefixes, entries } : null
}

// Fresh terminal-inclusive width. Null means unobserved, including entry zero;
// an observed zero is a real value, and negative increments remain ordered.
export function getSegmentEntryWidth(
  geometry: SegmentEntryGeometry | null | undefined,
  start: number,
  end: number,
): number | null {
  const entry = geometry?.entries[start]
  if (entry == null) return null
  if (end === start) return 0
  const anchor = start + entry.head.length
  if (end <= anchor) return entry.head[end - start - 1]!
  return entry.head[entry.head.length - 1]! +
    (geometry!.terminalPrefixes[end]! - geometry!.terminalPrefixes[anchor]!)
}
