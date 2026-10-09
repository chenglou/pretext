// Fresh-line geometry, or entry geometry: the widths a line takes where it starts inside a
// segment cut between graphemes, at or inside a stretch of it that holds a default-ignorable code
// point (a ZWNJ, a word joiner, a bidi mark). Shaping looks past such a character, so the text
// after the cut, shaped afresh at the line's start, can measure otherwise than the segment's own
// advances give (RESEARCH.md, Widths After A Line Break). For each such start, preparation
// measures the text from the start through the first whole grapheme past that stretch, the
// anchor, in at most three prefixes (the entry's head); past the anchor the widths go on by the
// segment's advances. The walkers (src/line-break.ts) ask an entry whether the segment's whole
// tail fits the line (admissionFit), which Blink reads from the tail as measured afresh and Gecko
// from the whole segment's width less the prefixes already placed (the profile's entryFitBasis),
// and, where it doesn't fit, how many graphemes do by the fresh prefixes. Only the desktop Blink
// and Gecko profiles observe entries, the browsers they were checked in, and a segment of more
// than 96 graphemes takes none (RESEARCH.md, Keeping Work Bounded).
import { findGraphemeEnds } from './graphemes.js'
import { getEngineProfile } from './measurement.js'

const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u
const MAX_GRAPHEMES = 96
const MAX_HEAD_ENDPOINTS = 3

// Whether a text holds a default-ignorable code point, without which no segment of it has entry
// geometry (observeSegmentEntries).
export function textMayHaveEntryGeometry(text: string): boolean {
  return defaultIgnorable.test(text)
}

type FreshEntry = { head: number[]; admissionFit: number }
export type SegmentEntryGeometry = {
  terminalPrefixes: number[]
  entries: (FreshEntry | null)[]
}

type Part = { start: number; end: number; observe: boolean }

// The stretches of a segment that a default-ignorable affects, as intervals of the source text.
// The text without its default-ignorables (the projection) is cut into grapheme clusters, and the
// segment's own graphemes that one such cluster spans are joined into one interval. An interval
// is observed where it holds a default-ignorable, and leading default-ignorables join the first
// visible interval. The projection only picks the intervals: what is measured is the source text,
// and the segment's grapheme boundaries and breaks stay its own.
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
  const visible = projected.join('')
  const ends = new Int32Array(visible.length)
  const count = findGraphemeEnds(getEngineProfile().graphemeTable, visible, 0, visible.length, ends)
  let boundaryIndex = 1
  for (let i = 0, projectedEnd = 0; i < count; i++) {
    const start = sourceOffset(projectedEnd)
    projectedEnd = ends[i]!
    const end = sourceOffset(projectedEnd - 1) + 1
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
  if (!defaultIgnorable.test(text) || advances.length > MAX_GRAPHEMES) return null
  const ends = new Int32Array(text.length)
  const count = findGraphemeEnds(getEngineProfile().graphemeTable, text, 0, text.length, ends)
  if (count > MAX_GRAPHEMES) return null
  const endpoints = [0]
  for (let i = 0; i < count; i++) endpoints.push(ends[i]!)
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
    // A start is observed inside an affected interval. The anchor, the first whole grapheme
    // past that interval, is measured after it as its right context, and a line that starts
    // at the anchor takes an entry only where the anchor's own interval is affected.
    if (part === undefined || !part.observe || sourceStart < part.start) continue
    let anchor = start + 1
    while (anchor < advances.length && endpoints[anchor]! <= part.end) anchor++
    // An entry needs that whole grapheme. An interval that ends the segment has none, so
    // its starts take no entry: what a line start measures with nothing after it hasn't
    // been checked against a browser. Nor does a start whose head would take more than
    // three prefixes.
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

// Where a fresh line that starts at grapheme `start` of a segment ends, by the entry observed
// there: past the segment's end (end + 1) where the whole tail is admitted and the line goes on
// with the text after it, else after the last fresh prefix that fits, keeping the first grapheme.
// `end` then means the prefixes ran out, and the line ends with the segment.
export function getFreshLineEnd(geometry: SegmentEntryGeometry, start: number, end: number, fitLimit: number): number {
  if (geometry.entries[start]!.admissionFit <= fitLimit) return end + 1
  let g = start + 1
  while (g < end && getSegmentEntryWidth(geometry, start, g + 1)! <= fitLimit) g++
  return g
}

// The width of a segment's graphemes from `start` to `end` on a fresh line that starts at
// `start`, with the letter spacing after the last of them. Null where no entry was observed,
// as at the segment's own start; an observed 0 is a width, and the prefixes needn't grow.
export function getSegmentEntryWidth(
  geometry: SegmentEntryGeometry | null,
  start: number,
  end: number,
): number | null {
  if (geometry === null) return null
  const entry = geometry.entries[start] as FreshEntry | null
  if (entry === null) return null
  if (end === start) return 0
  const anchor = start + entry.head.length
  if (end <= anchor) return entry.head[end - start - 1]!
  return entry.head[entry.head.length - 1]! +
    (geometry.terminalPrefixes[end]! - geometry.terminalPrefixes[anchor]!)
}
