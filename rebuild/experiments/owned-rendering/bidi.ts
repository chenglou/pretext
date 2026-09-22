// A shared bidi choice for text whose line breaks and fragment positions we own.
// Resolve the whole paragraph once with the existing ICU port and Unicode 17 data.
// Each chosen line then applies L1 at its end and L2 to its resolved level runs.
// This does not try to reproduce each browser's inline-box rules.
//
// The returned ranges retain logical UTF-16 offsets, including formatting controls.
// A painter keeps each range's text in logical order and uses its direction with an
// isolated bidi override. Do not reverse RTL strings before giving them to the DOM.
// Let the browser mirror glyphs for the chosen direction; manually mirroring and
// also enabling RTL would mirror twice. For Canvas, direction alone is a base
// direction, not an override: explicit LRO/RLO text needs the matching override.
//
// Strip only consumed bidi formatting controls before measuring/painting a range:
// ALM/LRM/RLM, LRE/RLE/LRO/RLO/PDF, LRI/RLI/FSI/PDI. Do not strip every BN:
// ZWJ/ZWNJ and other shaping characters must remain. Replaying paragraph controls
// inside independently resolved ranges can reopen embeddings and reorder again.
//
// Caller-created item boundaries and chosen line boundaries must be grapheme
// boundaries. Pass the already computed boundaries to reconcile ICU's rare level
// changes within one cluster (notably its NSM-after-bracket quirk). The owned
// painter keeps the cluster together at its first non-format-control level.
// This deliberate cluster-preserving choice is not claimed as exact ICU output.
import {
  B, BN, FSI, LRE, LRI, LRO, PDF, PDI, RLE, RLI, RLO, S, WS,
  bidiClassOf, unicode17BidiClasses, type BidiData, type ParagraphDirection,
} from '../../src/unicode/bidi.js'
import { unicode17BracketPairs } from '../../src/unicode/generated/bidi-data.js'
import { resolveIcuBidi } from '../../src/unicode/ubidi.js'

const data: BidiData = { classes: unicode17BidiClasses, brackets: unicode17BracketPairs }

export type BidiRun = {
  start: number
  end: number
  level: number
  direction: 'ltr' | 'rtl'
}

export type PreparedBidi = {
  text: string
  levels: Uint8Array
  originalLevels: Uint8Array
  graphemes: readonly number[] | undefined
  baseLevel: number
  paragraphs: { start: number; end: number; level: number }[]
  classes: Uint8Array
  // Indexes keep repeated layout proportional to returned runs rather than text length.
  runStarts: Uint32Array
  // Pairs of [start, end), containing characters reset by L1.
  whitespaceRanges: Uint32Array
}

function resetByL1(cls: number): boolean {
  return cls === B || cls === S || cls === WS || cls === BN
    || cls === LRE || cls === RLE || cls === LRO || cls === RLO || cls === PDF
    || cls === LRI || cls === RLI || cls === FSI || cls === PDI
}

function isFormattingControl(cp: number): boolean {
  return cp === 0x061c || cp === 0x200e || cp === 0x200f
    || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)
}

export function prepareBidi(text: string, direction: ParagraphDirection = 'auto', graphemes?: readonly number[]): PreparedBidi {
  const resolved = resolveIcuBidi(text, direction, data)
  const paragraphs: PreparedBidi['paragraphs'] = []
  for (let i = 0, start = 0; i < resolved.paragraphs.length; i++) {
    const paragraph = resolved.paragraphs[i]!
    paragraphs.push({ start, end: paragraph.end, level: paragraph.level })
    start = paragraph.end
  }
  const classes = new Uint8Array(text.length)
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!
    const length = cp > 0xffff ? 2 : 1
    classes.fill(bidiClassOf(data, cp), i, i + length)
    i += length
  }
  let levels = resolved.levels
  const whitespace: number[] = []
  let whitespaceStart = -1
  if (graphemes !== undefined) {
    if (graphemes[0] !== 0 || graphemes[graphemes.length - 1] !== text.length) {
      throw new RangeError('Grapheme boundaries must cover the full text')
    }
    for (let g = 0; g + 1 < graphemes.length; g++) {
      const start = graphemes[g]!
      const end = graphemes[g + 1]!
      if (!Number.isInteger(end) || end <= start || end > text.length || !isCodePointBoundary(text, end)) {
        throw new RangeError('Invalid grapheme boundary')
      }
      let base = start
      while (base < end && isFormattingControl(text.codePointAt(base)!)) {
        base += text.codePointAt(base)! > 0xffff ? 2 : 1
      }
      const level = resolved.levels[base < end ? base : start]!
      let reset = true
      for (let i = start; i < end; i++) {
        if (levels[i] !== level) {
          if (levels === resolved.levels) levels = Uint8Array.from(resolved.levels)
          levels[i] = level
        }
        if (!resetByL1(classes[i]!)) reset = false
      }
      // Never detach a trailing joiner or other BN character from its grapheme.
      if (reset) {
        if (whitespaceStart < 0) whitespaceStart = start
      } else if (whitespaceStart >= 0) {
        whitespace.push(whitespaceStart, start)
        whitespaceStart = -1
      }
    }
  } else {
    for (let i = 0; i < text.length; i++) {
      if (resetByL1(classes[i]!)) {
        if (whitespaceStart < 0) whitespaceStart = i
      } else if (whitespaceStart >= 0) {
        whitespace.push(whitespaceStart, i)
        whitespaceStart = -1
      }
    }
  }
  if (whitespaceStart >= 0) whitespace.push(whitespaceStart, text.length)
  const starts: number[] = [0]
  for (let i = 1; i < text.length; i++) {
    if (levels[i] !== levels[i - 1]) starts.push(i)
  }
  if (text.length > 0) starts.push(text.length)
  return {
    text, levels, originalLevels: resolved.levels, graphemes,
    baseLevel: paragraphs[0]?.level ?? (direction === 'rtl' ? 1 : 0),
    paragraphs, classes, runStarts: Uint32Array.from(starts),
    whitespaceRanges: Uint32Array.from(whitespace),
  }
}

function isCodePointBoundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true
  return (text.charCodeAt(offset) & 0xfc00) !== 0xdc00
    || (text.charCodeAt(offset - 1) & 0xfc00) !== 0xd800
}

function isGraphemeBoundary(boundaries: readonly number[], offset: number): boolean {
  let lo = 0
  let hi = boundaries.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const value = boundaries[mid]!
    if (value === offset) return true
    if (value < offset) lo = mid + 1
    else hi = mid - 1
  }
  return false
}

function paragraphAt(p: PreparedBidi, start: number): PreparedBidi['paragraphs'][number] {
  let lo = 0
  let hi = p.paragraphs.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (start < p.paragraphs[mid]!.end) hi = mid
    else lo = mid + 1
  }
  return p.paragraphs[lo]!
}

function trailingWhitespaceStart(p: PreparedBidi, start: number, end: number): number {
  const ranges = p.whitespaceRanges
  let lo = 0
  let hi = ranges.length / 2 - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (ranges[mid * 2]! < end) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found < 0 || ranges[found * 2 + 1]! < end) return end
  return Math.max(start, ranges[found * 2]!)
}

function firstRun(p: PreparedBidi, start: number): number {
  let lo = 0
  let hi = p.runStarts.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (p.runStarts[mid]! <= start) lo = mid
    else hi = mid - 1
  }
  return lo
}

// Runs are in visual left-to-right order, but each range is still logical text.
// A line cannot cross a paragraph separator: auto-direction may change there.
export function visualRuns(p: PreparedBidi, start: number, end: number): BidiRun[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > p.text.length) {
    throw new RangeError('Invalid bidi line range')
  }
  if (!isCodePointBoundary(p.text, start) || !isCodePointBoundary(p.text, end)) {
    throw new RangeError('A bidi line cannot split a code point')
  }
  if (p.graphemes !== undefined && (!isGraphemeBoundary(p.graphemes, start) || !isGraphemeBoundary(p.graphemes, end))) {
    throw new RangeError('A bidi line cannot split a grapheme')
  }
  if (start === end) return []
  const paragraph = paragraphAt(p, start)
  if (end > paragraph.end) throw new RangeError('A bidi line cannot cross a paragraph boundary')
  const trailingStart = trailingWhitespaceStart(p, start, end)
  const runs: BidiRun[] = []
  for (let r = firstRun(p, start); r + 1 < p.runStarts.length; r++) {
    const runStart = Math.max(start, p.runStarts[r]!)
    const runEnd = Math.min(trailingStart, p.runStarts[r + 1]!)
    if (runStart >= trailingStart) break
    const level = p.levels[runStart]!
    runs.push({ start: runStart, end: runEnd, level, direction: (level & 1) === 0 ? 'ltr' : 'rtl' })
  }
  if (trailingStart < end) {
    const last = runs[runs.length - 1]
    if (last?.level === paragraph.level) last.end = end
    else runs.push({ start: trailingStart, end, level: paragraph.level, direction: (paragraph.level & 1) === 0 ? 'ltr' : 'rtl' })
  }
  let minLevel = 126
  let maxLevel = 0
  for (let i = 0; i < runs.length; i++) {
    minLevel = Math.min(minLevel, runs[i]!.level)
    maxLevel = Math.max(maxLevel, runs[i]!.level)
  }
  // L2: reverse contiguous runs at each level, highest through the lowest odd.
  for (let level = maxLevel; level >= (minLevel | 1); level--) {
    for (let i = 0; i < runs.length;) {
      if (runs[i]!.level < level) { i++; continue }
      let limit = i + 1
      while (limit < runs.length && runs[limit]!.level >= level) limit++
      for (let a = i, b = limit - 1; a < b; a++, b--) {
        const t = runs[a]!
        runs[a] = runs[b]!
        runs[b] = t
      }
      i = limit
    }
  }
  return runs
}
