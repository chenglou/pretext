import { expect, test } from 'bun:test'
import { getSegmentEntryWidth, observeSegmentEntries } from '../../src/entry-geometry.ts'
import { layout, layoutNextLine, layoutWithLines, materializeLineRange, walkLineRanges, type LayoutLineRange, type PreparedTextWithSegments } from '../../src/layout.ts'

test('entry admission and fresh prefixes have distinct roles; the right anchor does not own a correction', () => {
  const text = 'a\u2060\u0301bXYZ'
  const advances = [8, 0, 0, 8, 11, -2, 3]
  const measure = (source: string) => source.endsWith('b') ? 6 : 0
  const fresh = observeSegmentEntries(text, advances, -4, 4, 'fresh', measure)!
  const original = observeSegmentEntries(text, advances, -4, 4, 'original', measure)!
  expect(getSegmentEntryWidth(fresh, 0, 7)).toBeNull()
  expect(getSegmentEntryWidth(fresh, 3, 7)).toBeNull()
  expect(getSegmentEntryWidth(fresh, 2, 3)).toBe(0)
  expect(getSegmentEntryWidth(fresh, 2, 5)).toBe(13)
  expect(getSegmentEntryWidth(fresh, 2, 6)).toBe(7)
  expect(getSegmentEntryWidth(fresh, 2, 7)).toBe(6)
  expect(getSegmentEntryWidth(original, 2, 7)).toBe(6)
  expect(fresh.entries[2]!.admissionFit).toBe(6)
  expect(original.entries[2]!.admissionFit).toBe(0)
})

test('missing anchors, oversized runs and incomplete observations retain the original entry', () => {
  const queried: string[] = []
  const measure = (source: string) => { queried.push(source); return 0 }
  expect(observeSegmentEntries('a\u2060\u0301', [8, 0, 0], 0, 8, 'fresh', measure)).toBeNull()
  expect(observeSegmentEntries('a'.repeat(94) + '\u2060\u0301b', Array(97).fill(8), 0, 8, 'fresh', measure)).toBeNull()
  expect(queried).toEqual([])
  const geometry = observeSegmentEntries('a\u2060\u0301b', [8, 0, 0, 8], 0, 16, 'fresh', source =>
    source.startsWith('\u2060') ? null : 0)!
  expect(getSegmentEntryWidth(geometry, 1, 4)).toBeNull()
  expect(getSegmentEntryWidth(geometry, 2, 4)).toBe(0)
})

test('fresh entry geometry survives copied public range cursors without layout measurements', () => {
  const advances = [8, 0, 3, 8]
  const entry = observeSegmentEntries('a\u2060\u0301b', advances, 0, 19, 'fresh', source =>
    source.endsWith('b') ? 6 : 0)
  // A numeric fixture keeps this source/cursor invariant independent of a
  // Canvas backend. It is not a claim about native control or mark advances.
  const prepared = {
    widths: [19], lineEndFitAdvances: [19], lineEndPaintAdvances: [19], kinds: ['text'],
    simpleLineWalkFastPath: false, segLevels: null, breakableFitAdvances: [advances],
    breakablePreferredBreaks: [null], entryGeometry: [entry], letterSpacing: 0,
    spacingGraphemeCounts: [], discretionaryHyphenWidth: 4, tabStopAdvance: 32,
    chunks: [{ startSegmentIndex: 0, endSegmentIndex: 1, consumedEndSegmentIndex: 1 }],
    segments: ['a\u2060\u0301b'],
  } as unknown as PreparedTextWithSegments
  const before = JSON.stringify(prepared)
  const result = layoutWithLines(prepared, 1, 20)
  expect(result.lines.map(line => line.text)).toEqual(['a', '\u2060\u0301', 'b'])
  expect(layout(prepared, 1, 20)).toEqual({ lineCount: 3, height: 60 })
  const ranges: LayoutLineRange[] = []
  expect(walkLineRanges(prepared, 1, line => ranges.push(line))).toBe(3)
  expect(ranges.map(range => materializeLineRange(prepared, range))).toEqual(result.lines)
  for (const line of result.lines) {
    expect(layoutNextLine(JSON.parse(before), { ...line.start }, 1)).toEqual(line)
  }
  expect(JSON.stringify(prepared)).toBe(before)
})
