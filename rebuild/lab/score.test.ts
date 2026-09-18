import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeEdges } from './observe/gecko.ts'
import {
  abcd, abcdExpected, abcdLayout, abcdNative, abcdOneLine, abcdOneLineExpected, at, blink, expect32, gecko, linesRow, native, observation, paragraph, row, webkit,
} from './row-fixtures.ts'
import type { Gap, GapName } from '../src/model.ts'
import { environmentKey, indexRows, lineLocalGaps, lineRangeDiagnostics, nativeDifference, nativeLines, nativeView, readRowAt, residualMembership, RESIDUAL_CLASSES, scoreRow, slotProtocol, withNativeRow, type CaseScore } from './score.ts'
import type { BrowserKind, LabRow, NativeObservation, PainterLine, Rect, RecordedLayout } from './types.ts'

const f32 = Math.fround

describe('native lines', () => {
  test('zero-width rects are placed, rects without height are not', () => {
    const p = paragraph([['ab', 'text']])
    const lines = nativeLines(native(p, [[at(0, 8), { x: 8, y: 30, width: 0, height: 0 }], [at(0, 0, 1)]], [[at(0, 8), at(0, 0, 1)]]), p, 'chrome')
    expect(lines).toEqual({ count: 2, points: [[0, -1], [1]], nodes: [[0, 1]], elements: [], unplaced: 1, byCentre: 0 })
  })

  test('across nodes, centres of one line differ by font metrics, less than half a line height', () => {
    const p = paragraph([['ab', 'span'], ['c', 'span']])
    const lines = nativeLines(native(p, [[at(0, 8)], [at(8, 8)], [{ x: 16, y: -3.5, width: 7, height: 25 }]], [[at(0, 16)], [{ x: 16, y: -3.5, width: 7, height: 25 }]]), p, 'chrome')
    expect(lines.count).toBe(1)
  })

  test('a code point rect takes its line from the box its own node reports, by each engine\'s rule', () => {
    // A WebKit partial rect: y is the box's y truncated to a LayoutUnit, and the snapped height differs.
    const p = paragraph([['ab', 'text']])
    const box: Rect = { x: 0, y: 10.3, width: 16, height: 20 }
    const partial: Rect = { x: 0, y: Math.trunc(f32(10.3 * 64)) / 64, width: 8, height: 19 }
    const observed = native(p, [[partial], [{ ...partial, x: 8 }]], [[box]])
    expect(nativeLines(observed, p, 'webkit-host')).toMatchObject({ count: 1, points: [[0], [0]], byCentre: 0 })
    // Blink and Gecko cut the box's own rect, so the same rects match no box there and fall back to centres.
    expect(nativeLines(observed, p, 'chrome')).toMatchObject({ count: 1, byCentre: 2 })
    expect(nativeLines(observed, p, 'firefox')).toMatchObject({ count: 1, byCentre: 2 })
  })

  test('rects of one node with equal tops share a line in Blink and WebKit; Gecko sizes each frame by its fonts', () => {
    // Two boxes of one node on one line whose heights differ by more than a line height.
    const p = paragraph([['ab', 'text']])
    const observed = native(p, [[at(0, 8)], [{ x: 8, y: 0, width: 8, height: 60 }]], [[at(0, 8), { x: 8, y: 0, width: 8, height: 60 }]])
    expect(nativeLines(observed, p, 'chrome').count).toBe(1)
    expect(nativeLines(observed, p, 'webkit-host').count).toBe(1)
    expect(nativeLines(observed, p, 'firefox').count).toBe(2)
  })
})

describe('rects compare exactly, and the metrics follow from the comparisons', () => {
  test('equal rects: every metric passes and every value is a predicted equal', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, abcdExpected))
    expect(score.metrics).toEqual({ lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: { status: 'pass' }, painter: { status: 'not-applicable', reason: 'paint returned null' } })
    expect(score.facts).toMatchObject({ counts: { equal: 6, differ: 0 }, predicted: { equal: 14, differ: 0 }, lines: { equal: 7, differ: 0 } })
    expect(score.firstDifference).toBeNull()
    expect(score.diagnostics).toBeNull()
  })

  test('a code point the layout puts on another line fails breaks', () => {
    const moved = observation(abcd,
      [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 0)], [expect32(0, 15.625, 7)], [expect32(1, 0, 7.0625)]],
      [[expect32(0, 0, 22.625), expect32(1, 0, 7.0625)]])
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 4, 2896], [4, 5, 904]]), moved))
    expect(score.metrics.lineCount).toEqual({ status: 'pass' })
    expect(score.metrics.breaks).toEqual({ status: 'fail', reason: 'code point on other lines', detail: 'code point 3 "c": native lines 1; expected 0' })
    expect(score.metrics.widths).toEqual({ status: 'not-applicable', reason: 'breaks differ' })
  })

  test('another line count fails lineCount and breaks', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdOneLine, abcdOneLineExpected))
    expect(score.metrics.lineCount).toEqual({ status: 'fail', reason: 'line count differs', detail: 'native 2, predicted 1' })
    expect(score.metrics.breaks.reason).toBe('line count differs')
  })

  test('a line box no Range reports leaves the line count unobserved', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 3, 2000], [3, 3, 0], [3, 5, 1800]]),
      observation(abcd, abcdExpected.codePoints.map(point => point.rects.map(rect => ({ ...rect, line: rect.line === 1 ? 2 : 0 }))),
        [[expect32(0, 0, 15.625), expect32(2, 0, 14.0625)]])))
    expect(score.metrics.lineCount).toEqual({ status: 'unobserved', reason: 'a line box no Range or element reports', detail: 'engine line 1' })
    expect(score.metrics.breaks.status).toBe('unobserved')
  })

  test('a line without a line box that nothing reports is skipped', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 3, 2000], [3, 3, 0, false], [3, 5, 1800]]),
      observation(abcd, abcdExpected.codePoints.map(point => point.rects.map(rect => ({ ...rect, line: rect.line === 1 ? 2 : 0 }))),
        [[expect32(0, 0, 15.625), expect32(2, 0, 14.0625)]])))
    expect([score.metrics.lineCount.status, score.metrics.breaks.status, score.metrics.widths.status]).toEqual(['pass', 'pass', 'pass'])
  })

  test('expected rects on a line without a line box sit on no native line', () => {
    // Firefox: a trailing space after `ab` in its own frame on a line of block size 0, reported with height 0.
    const p = paragraph([['ab ', 'text']])
    const observed = native(p, [[at(0, 8)], [at(8, 7.625)], [{ x: 15.625, y: 40, width: 0, height: 0 }]], [[at(0, 15.625), { x: 15.625, y: 40, width: 0, height: 0 }]])
    const expected = observation(p, [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(1, 15.625, 0)]], [[expect32(0, 0, 15.625), expect32(1, 15.625, 0)]])
    const score = scoreRow(row('chrome', p, observed, blink([[0, 2, 2000], [2, 3, 0, false]]), expected))
    expect([score.metrics.lineCount.status, score.metrics.breaks.status, score.metrics.widths.status]).toEqual(['pass', 'pass', 'pass'])
    const placedNatively = native(p, [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0, 1)]], [[at(0, 15.625), at(15.625, 0, 1)]])
    expect(scoreRow(row('chrome', p, placedNatively, blink([[0, 2, 2000], [2, 3, 0, false]]), expected)).metrics.lineCount).toEqual({ status: 'fail', reason: 'line count differs', detail: 'native 2, predicted 1' })
  })

  test('limited values are tallied by gap and decide no metric', () => {
    const limited = observation(abcd,
      [[expect32(0, 0, 8)], [expect32(0, { state: 'limited', gap: 'in-word-prefix', value: 8.0078125 }, { state: 'limited', gap: 'in-word-prefix', value: 7.6171875 })], [expect32(0, 15.625, 0)], [expect32(1, 0, 7)], [expect32(1, 7, 7.0625)]],
      abcdExpected.nodes)
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, limited))
    expect(score.facts!.limited).toEqual({ 'in-word-prefix': { equal: 0, differ: 2 } })
    expect(score.facts!.predicted).toEqual({ equal: 12, differ: 0 })
    expect([score.metrics.breaks.status, score.metrics.widths.status]).toEqual(['pass', 'pass'])
    expect(score.firstDifference).toBeNull()
  })

  test('a rect count that differs is a predicted fact, named first', () => {
    const extra = observation(abcd,
      [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 0), expect32(1, 0, 0)], [expect32(1, 0, 7)], [expect32(1, 7, 7.0625)]],
      abcdExpected.nodes)
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, extra))
    expect(score.facts!.counts).toEqual({ equal: 5, differ: 1 })
    expect(score.firstDifference).toBe('code point 2 " ": native 1 rects, expected 2')
    expect(score.metrics.breaks).toEqual({ status: 'fail', reason: 'code point on other lines', detail: 'code point 2 " ": native lines 0; expected 0,1' })
  })

  test('unobservable facts are counted by rule', () => {
    const rule = 'U8: a line that creates no line box has no fragment items'
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, { ...abcdExpected, unobservable: [{ line: 0, fact: 'lines[0]', rule }] }))
    expect(score.facts!.unobservable).toEqual({ [rule]: 1 })
  })

  test('an observation port error leaves every metric unobserved', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, { error: 'boom' }))
    expect(score.metrics.lineCount).toEqual({ status: 'unobserved', reason: 'observation port error', detail: 'boom' })
  })
})

describe('slot protocol rows', () => {
  const slotted = (floats: Rect[] | undefined): LabRow => {
    const base = row('firefox', abcd, abcdNative, gecko([[0, 3, 937], [3, 5, 844]]), abcdExpected)
    const inline = { content: [], textIndent: 10, textAlign: 'start' as const, lineSlots: [{ left: 40, right: 40 }, { left: 40, right: 40 }] }
    return { ...base, case: { ...base.case, inline }, native: floats === undefined ? { ...abcdNative, width: 90 } : { ...abcdNative, width: 90, floats } }
  }

  test('floats in their rows on their sides describe the slots', () => {
    const floats = [{ x: 0, y: 0, width: 40, height: 20 }, { x: 50, y: 0, width: 40, height: 20 }, { x: 0, y: 20, width: 40, height: 20 }, { x: 50, y: 20, width: 40, height: 20 }]
    const value = slotted(floats)
    expect(slotProtocol(value.case, value.native as NativeObservation, 'firefox', 2)).toBeNull()
  })

  test('a float that moved to another row makes a protocol row: every metric unobserved, never a pass', () => {
    // Gecko places row 0's right float below the first line when it doesn't fit beside the indented line.
    const floats = [{ x: 0, y: 0, width: 40, height: 20 }, { x: 50, y: 20, width: 40, height: 20 }, { x: 0, y: 20, width: 40, height: 20 }, { x: 50, y: 40, width: 40, height: 20 }]
    const score = scoreRow(slotted(floats))
    expect(score.protocol).toBe('row 0\'s right float (inset 40) is at y 20, height 20; the row is at y 0')
    expect(new Set(Object.values(score.metrics).map(metric => metric.status))).toEqual(new Set(['unobserved']))
    expect(scoreRow(slotted(undefined)).protocol).toBe('the row recorded no slot floats')
  })

  test('a right float that doesn\'t reach the content box\'s right edge, in app units', () => {
    const floats = [{ x: 0, y: 0, width: 40, height: 20 }, { x: 49.98333, y: 0, width: 40, height: 20 }, { x: 0, y: 20, width: 40, height: 20 }, { x: 50, y: 20, width: 40, height: 20 }]
    expect(scoreRow(slotted(floats)).protocol).toBe('row 0\'s right float (inset 40) ends at x 89.98333; the content box ends at 90')
  })
})

describe('elements: Element.getClientRects() of cases with inline structure', () => {
  // `ab` then an atomic inline alone on line 1, 15px: 1920 raw LayoutUnits at zoom 2.
  const p = paragraph([['ab', 'text']])
  const layout = blink([[0, 2, 2000], [2, 2, 1920]])
  const base = row('chrome', p, native(p, [[at(0, 8)], [at(8, 7.625)]], [[at(0, 15.625)]]), layout,
    { ...observation(p, [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)]], [[expect32(0, 0, 15.625)]]), elements: [[expect32(1, 0, 15)]] })
  const withElements = (elements: Rect[][]): LabRow => ({ ...base, case: { ...base.case, inline: { content: [], textIndent: 0, textAlign: 'start', lineSlots: [] } }, native: { ...(base.native as NativeObservation), elements } })

  test('a line holding only an atomic inline is observed through its element rect', () => {
    const score = scoreRow(withElements([[{ x: 0, y: 26, width: 15, height: 10 }]]))
    expect(score.native!.count).toBe(2)
    expect([score.metrics.lineCount.status, score.metrics.breaks.status, score.metrics.widths.status]).toEqual(['pass', 'pass', 'pass'])
    // A flat case records no elements, so the same layout leaves that line unobserved.
    expect(scoreRow(base).metrics.lineCount.reason).toBe('a line box no Range or element reports')
  })

  test('an element on another line fails breaks, and a wider element rect fails widths', () => {
    expect(scoreRow(withElements([[{ x: 16, y: 5, width: 15, height: 10 }]])).metrics.lineCount).toEqual({ status: 'fail', reason: 'line count differs', detail: 'native 1, predicted 2' })
    const wider = scoreRow(withElements([[{ x: 0, y: 26, width: 15.5, height: 10 }]]))
    expect(wider.metrics.widths).toEqual({ status: 'fail', reason: 'width differs', detail: 'engine line 1: width 1920; native node and element rects span [0, 1984]' })
    expect(wider.facts!.predicted.differ).toBe(1)
  })
})

// Rows for the coverage rules: text nodes laid out left to right from x 0 on each line, from per code point widths in
// engine units natively and as expected (Blink raw LayoutUnits at zoom 2, Gecko app units, WebKit px).
type UnitRow = { browser: BrowserKind; runs: string[]; lines: Array<[number, number]>; native: number[]; expected: number[] }
const encode = (browser: BrowserKind, left: number, right: number): { x: number; width: number } =>
  browser === 'firefox' ? encodeEdges(left, right) : browser === 'chrome' ? { x: left / 128, width: (right - left) / 128 } : { x: left, width: right - left }

function unitRow(value: UnitRow, painted: 'native' | 'expected' | null = null): { row: LabRow; layout: RecordedLayout } {
  const p = paragraph(value.runs.map(text => [text, 'span']))
  const nativePoints: Rect[][] = []
  const expectedPoints: ReturnType<typeof expect32>[][] = []
  const nativeNodes: Rect[][] = value.runs.map(() => [])
  const expectedNodes: ReturnType<typeof expect32>[][] = value.runs.map(() => [])
  const widths: number[] = []
  const paintedLines: PainterLine[] = []
  const runEnds: number[] = []
  for (let r = 0, end = 0; r < value.runs.length; r++) runEnds.push(end += value.runs[r]!.length)
  for (let l = 0; l < value.lines.length; l++) {
    const [start, end] = value.lines[l]!
    let nativeX = 0
    let expectedX = 0
    // Per node on the line: [native left, native right, expected left, expected right].
    const spans = new Map<number, [number, number, number, number]>()
    for (let i = start; i < end; i++) {
      const run = runEnds.findIndex(runEnd => i < runEnd)
      const n = encode(value.browser, nativeX, nativeX + value.native[i]!)
      const e = encode(value.browser, expectedX, expectedX + value.expected[i]!)
      nativePoints.push([{ x: n.x, y: l * 20, width: n.width, height: 20 }])
      expectedPoints.push([expect32(l, e.x, e.width)])
      const span = spans.get(run) ?? [nativeX, nativeX, expectedX, expectedX]
      span[1] = nativeX + value.native[i]!
      span[3] = expectedX + value.expected[i]!
      spans.set(run, span)
      nativeX += value.native[i]!
      expectedX += value.expected[i]!
    }
    for (const [run, span] of spans) {
      const n = encode(value.browser, span[0], span[1])
      const e = encode(value.browser, span[2], span[3])
      nativeNodes[run]!.push({ x: n.x, y: l * 20, width: n.width, height: 20 })
      expectedNodes[run]!.push(expect32(l, e.x, e.width))
    }
    widths.push(expectedX)
    const whole = encode(value.browser, 0, painted === 'native' ? nativeX : expectedX)
    paintedLines.push({ box: at(0, 200), height: 20, rects: [at(whole.x, whole.width)], extent: null, points: [] })
  }
  const lines = value.lines.map(([start, end], l): [number, number, number] => [start, end, widths[l]!])
  const layout = value.browser === 'firefox' ? gecko(lines) : value.browser === 'chrome' ? blink(lines) : webkit(lines)
  return { row: row(value.browser, p, native(p, nativePoints, nativeNodes), layout, observation(p, expectedPoints, expectedNodes), painted === null ? null : paintedLines), layout }
}

describe('covered failures', () => {
  const gap = (name: GapName, at?: { start: number; end: number }): Gap => ({ gap: name, run: 0, detail: 'test', ...(at === undefined ? {} : { at }) })
  // `abcdef` on one Firefox line; natively `c` is 5 au wider.
  const wide = (gaps: Gap[], lineGaps: Gap[] = []): CaseScore => {
    const { row: value, layout } = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 6]], native: [600, 600, 605, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] })
    layout.gaps.push(...gaps)
    layout.lines[0]!.gaps.push(...lineGaps)
    return scoreRow(value)
  }

  test('widths: a gap covers only by touching the unit that differs', () => {
    const elsewhere = wide([gap('script-context', { start: 4, end: 5 })]).lineGaps.widths!
    expect(elsewhere.covered).toBe(false)
    expect(elsewhere.lines[0]).toMatchObject({ gaps: [], elsewhere: [{ gap: 'script-context', scope: 'paragraph-range' }], evidence: { units: 1, runs: 1, deciding: 1, touched: 0, first: { start: 2, end: 3 }, firstText: 'c' } })
    const touching = wide([gap('script-context', { start: 2, end: 3 })]).lineGaps.widths!
    expect(touching.covered).toBe(true)
    expect(touching.lines[0]!.gaps).toEqual([{ gap: 'script-context', scope: 'paragraph-range', touch: 'unit' }])
    // A point touches the units on both sides of its offset, and no other.
    expect(wide([], [gap('in-word-prefix', { start: 3, end: 3 })]).lineGaps.widths!.covered).toBe(true)
    expect(wide([], [gap('in-word-prefix', { start: 2, end: 2 })]).lineGaps.widths!.covered).toBe(true)
    expect(wide([], [gap('in-word-prefix', { start: 4, end: 4 })]).lineGaps.widths!.covered).toBe(false)
  })

  test('a line gap without a range has its whole line, and is marked', () => {
    expect(wide([], [gap('font-fallback')]).lineGaps.widths!.lines[0]!.gaps).toEqual([{ gap: 'font-fallback', scope: 'line', touch: 'unit', unranged: true }])
    const paragraphOnly = wide([gap('engine-build')]).lineGaps.widths!
    expect([paragraphOnly.covered, paragraphOnly.paragraphGaps]).toEqual([false, ['engine-build']])
  })

  test('widths: every run that contributes must be touched; one touched unit at the line edge is not enough', () => {
    // `f` at the line end differs and a gap at the break touches it, but `b` differs too and nothing touches it.
    const { row: value, layout } = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 6]], native: [600, 640, 600, 600, 600, 620], expected: [600, 600, 600, 600, 600, 600] })
    layout.lines[0]!.gaps.push(gap('unsafe-to-break', { start: 6, end: 6 }))
    const partly = scoreRow(value).lineGaps.widths!
    expect(partly.covered).toBe(false)
    expect(partly.lines[0]).toMatchObject({ gaps: [], elsewhere: [{ gap: 'unsafe-to-break', scope: 'line' }], evidence: { runs: 2, deciding: 2, touched: 1, firstText: 'b' } })
    layout.gaps.push(gap('glyph-clusters', { start: 1, end: 2 }))
    expect(scoreRow(value).lineGaps.widths!.covered).toBe(true)
  })

  test('a run whose widths add up to the same needs no gap: Gecko by the sum, Blink by the extent', () => {
    // `bc` move 30 units between them; `e` is wider.
    for (const browser of ['firefox', 'chrome'] as const) {
      const { row: value, layout } = unitRow({ browser, runs: ['abcdef'], lines: [[0, 6]], native: [600, 630, 570, 600, 640, 600], expected: [600, 600, 600, 600, 600, 600] })
      expect(scoreRow(value).lineGaps.widths!.lines[0]!.evidence).toMatchObject({ units: 3, runs: 2, deciding: 1, touched: 0, firstText: 'e' })
      layout.gaps.push(gap('glyph-clusters', { start: 4, end: 5 }))
      expect(scoreRow(value).lineGaps.widths!.covered).toBe(true)
    }
    // When no run contributes (here the node rect is 1 au wider than its code points say), every run must be touched.
    const { row: moved } = unitRow({ browser: 'firefox', runs: ['abc', 'def'], lines: [[0, 6]], native: [600, 630, 570, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] })
    const observed = moved.native as NativeObservation
    observed.runRects[0]![0] = { ...observed.runRects[0]![0]!, width: encodeEdges(0, 1801).width }
    observed.runRects[1]![0] = { ...observed.runRects[1]![0]!, x: encodeEdges(1801, 3601).x, width: encodeEdges(1801, 3601).width }
    expect(scoreRow(moved).lineGaps.widths!.lines[0]!.evidence).toMatchObject({ units: 2, nodeUnits: 0, runs: 1, deciding: 1, touched: 0 })
  })

  test('Blink: an extent one LayoutUnit off whose left edge moved is within the rounding of its carets', () => {
    // `b` is 64 units wider, so `d` moves; natively `d` is also 1 unit wider.
    const { row: value, layout } = unitRow({ browser: 'chrome', runs: ['abcdef'], lines: [[0, 6]], native: [1024, 1088, 1024, 1025, 1024, 1024], expected: [1024, 1024, 1024, 1024, 1024, 1024] })
    layout.gaps.push(gap('script-context', { start: 1, end: 2 }))
    const score = scoreRow(value).lineGaps.widths!
    expect(score.lines[0]!.evidence).toMatchObject({ units: 2, runs: 2, deciding: 1, touched: 1 })
    expect(score.covered).toBe(true)
    // The same unit at an unmoved left edge contributes.
    const { row: still } = unitRow({ browser: 'chrome', runs: ['abcdef'], lines: [[0, 6]], native: [1024, 1025, 1024, 1024, 1024, 1024], expected: [1024, 1024, 1024, 1024, 1024, 1024] })
    expect(scoreRow(still).lineGaps.widths!.lines[0]!.evidence).toMatchObject({ units: 1, deciding: 1 })
  })

  test('a unit is a grapheme cluster with the widthless and default ignorable code points next to it', () => {
    // Gecko reports an RTL letter's advance on the mark after it: the gap at the letter concerns the mark's rect.
    const marked = unitRow({ browser: 'firefox', runs: ['abهِd'], lines: [[0, 5]], native: [600, 600, 0, 300, 600], expected: [600, 600, 0, 420, 600] })
    marked.layout.lines[0]!.gaps.push(gap('in-word-prefix', { start: 2, end: 2 }))
    expect(scoreRow(marked.row).lineGaps.widths!.lines[0]).toMatchObject({ gaps: [{ gap: 'in-word-prefix', touch: 'unit' }], evidence: { first: { start: 2, end: 4 } } })
    // A soft hyphen at the break draws the hyphen, the same on both sides: the gap at the break concerns the letter before it.
    const hyphenated = unitRow({ browser: 'firefox', runs: ['ab­cd'], lines: [[0, 3], [3, 5]], native: [600, 640, 350, 600, 600], expected: [600, 600, 350, 600, 600] })
    hyphenated.layout.lines[0]!.gaps.push(gap('in-word-prefix', { start: 3, end: 3 }))
    expect(scoreRow(hyphenated.row).lineGaps.widths!.lines[0]).toMatchObject({ gaps: [{ gap: 'in-word-prefix', scope: 'line', touch: 'unit' }], evidence: { first: { start: 1, end: 3 } } })
  })

  test('a gap reported on a neighbouring line covers with a range that reaches the unit, not with a point at the shared break', () => {
    const rows = (): ReturnType<typeof unitRow> => unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 3], [3, 6]], native: [600, 600, 640, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] })
    const point = rows()
    point.layout.lines[1]!.gaps.push(gap('unsafe-to-break', { start: 3, end: 3 }))
    expect(scoreRow(point.row).lineGaps.widths!).toMatchObject({ covered: false, lines: [{ gaps: [], elsewhere: [{ gap: 'unsafe-to-break', scope: 'next-line' }] }] })
    const range = rows()
    range.layout.lines[1]!.gaps.push(gap('simplified-measuring', { start: 2, end: 5 }))
    expect(scoreRow(range.row).lineGaps.widths!.lines[0]!.gaps).toEqual([{ gap: 'simplified-measuring', scope: 'next-line', touch: 'unit' }])
    // The same point as a paragraph gap belongs to no line, and touches the units on both sides of it.
    const paragraphPoint = rows()
    paragraphPoint.layout.gaps.push(gap('unsafe-to-break', { start: 3, end: 3 }))
    expect(scoreRow(paragraphPoint.row).lineGaps.widths!.covered).toBe(true)
  })

  test('WebKit: the unit is the differing node\'s part of the line', () => {
    const { row: value, layout } = unitRow({ browser: 'webkit-host', runs: ['abc', 'def'], lines: [[0, 6]], native: [10, 10, 10, 10, 10.5, 10], expected: [10, 10, 10, 10, 10, 10] })
    layout.lines[0]!.gaps.push(gap('canvas-language', { start: 0, end: 2 }))
    const other = scoreRow(value).lineGaps.widths!
    expect(other.covered).toBe(false)
    expect(other.lines[0]!.evidence).toMatchObject({ units: 1, nodeUnits: 1, first: { start: 3, end: 6 } })
    layout.lines[0]!.gaps.push(gap('simplified-measuring', { start: 3, end: 4 }))
    expect(scoreRow(value).lineGaps.widths!.lines[0]!.gaps).toEqual([{ gap: 'simplified-measuring', scope: 'line', touch: 'unit' }])
  })

  test('Blink and Gecko: where only the node rect differs, the unit is the node\'s part of the line', () => {
    const { row: value } = unitRow({ browser: 'firefox', runs: ['abc', 'def'], lines: [[0, 6]], native: [600, 600, 600, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] })
    const observed = value.native as NativeObservation
    const wider = encodeEdges(1800, 3607)
    observed.runRects[1]![0] = { ...observed.runRects[1]![0]!, width: wider.width }
    expect(scoreRow(value).lineGaps.widths!.lines[0]!.evidence).toMatchObject({ units: 1, nodeUnits: 1, first: { start: 3, end: 6 } })
  })

  // abcdOneLine against abcdNative: the prediction keeps `cd` on line 0, so native line 0 is the first to differ and `cd`
  // is the decision text. The space before it is trimmed natively and 4px wide as expected: it runs back from the
  // decision text, so the failure is a pure break decision.
  const failing = (layout: RecordedLayout): CaseScore => scoreRow(row('chrome', abcd, abcdNative, layout, abcdOneLineExpected))

  test('lineCount and breaks: a pure break decision is covered at the decision text', () => {
    const at = failing({ ...abcdOneLine, gaps: [gap('dictionary-breaks-stand-in', { start: 4, end: 4 })] }).lineGaps.lineCount!
    expect(at).toEqual({
      lines: [{ nativeLine: 0, engineLine: 0, gaps: [{ gap: 'dictionary-breaks-stand-in', scope: 'paragraph-range', touch: 'decision' }], evidence: { units: 1, nodeUnits: 0, runs: 1, deciding: 0, touched: 0, first: { start: 2, end: 3 }, firstText: ' ', decision: { start: 3, end: 5 }, decisionText: 'cd', pureDecision: true } }],
      covered: true, paragraphGaps: [],
    })
    expect(failing({ ...abcdOneLine, gaps: [gap('control-character-width', { start: 4, end: 5 })] }).lineGaps.breaks!.covered).toBe(true)
    expect(failing({ ...abcdOneLine, gaps: [gap('control-character-width', { start: 5, end: 5 })] }).lineGaps.breaks!.covered).toBe(true)
    // Elsewhere on the line doesn't cover; the trimmed space, which runs back from the decision text, does.
    const elsewhere = failing({ ...abcdOneLine, gaps: [gap('script-context', { start: 0, end: 1 })] }).lineGaps.breaks!
    expect([elsewhere.covered, elsewhere.lines[0]!.elsewhere]).toEqual([false, [{ gap: 'script-context', scope: 'paragraph-range' }]])
    expect(failing({ ...abcdOneLine, gaps: [gap('script-context', { start: 2, end: 3 })] }).lineGaps.breaks!.lines[0]!.gaps).toEqual([{ gap: 'script-context', scope: 'paragraph-range', touch: 'unit' }])
    // A line gap without a range has its whole line, the decision text included.
    expect(failing({ ...abcdOneLine, lines: abcdOneLine.lines.map(line => ({ ...line, gaps: [gap('unsafe-to-break')] })) } as RecordedLayout).lineGaps.lineCount!.covered).toBe(true)
    expect(failing({ ...abcdOneLine, gaps: [gap('engine-build')] }).lineGaps.breaks).toMatchObject({ covered: false, paragraphGaps: ['engine-build'] })
  })

  test('lineCount and breaks: the line whose end differs is attributed, and its own gap without a range covers its break', () => {
    // `ab cd`: natively the space has a rect on both lines; the prediction keeps it on line 0. Native line 1 is the first
    // whose code points differ, and the decision text is the space at the end of line 0.
    const observed: NativeObservation = { ...abcdNative, points: abcdNative.points.map((point, i) => (i === 2 ? { ...point, rects: [at(15.625, 0), at(0, 0, 1)] } : point)) }
    const score = (layout: RecordedLayout): CaseScore => scoreRow(row('chrome', abcd, observed, layout, abcdExpected))
    const plain = score(abcdLayout)
    expect(plain.metrics.breaks).toEqual({ status: 'fail', reason: 'code point on other lines', detail: 'code point 2 " ": native lines 0,1; expected 0' })
    expect(plain.lineGaps.breaks!.lines[0]).toMatchObject({ nativeLine: 0, engineLine: 0, evidence: { units: 0, decision: { start: 2, end: 3 }, pureDecision: true } })
    // A point at the break reported on line 0 is line 0's own edge; reported on line 1 it is line 1's.
    const own = structuredClone(abcdLayout)
    own.lines[0]!.gaps.push(gap('page-history', { start: 3, end: 3 }))
    expect(score(own).lineGaps.breaks!.lines[0]!.gaps).toEqual([{ gap: 'page-history', scope: 'line', touch: 'decision' }])
    const next = structuredClone(abcdLayout)
    next.lines[1]!.gaps.push(gap('page-history', { start: 3, end: 3 }))
    expect(score(next).lineGaps.breaks!).toMatchObject({ covered: false, lines: [{ elsewhere: [{ gap: 'page-history', scope: 'next-line' }] }] })
    // The prediction ends line 0 at `ab`, natively `c` follows on it: line 0's gap without a range concerns that break.
    const early = observation(abcd, [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 0)], [expect32(1, 0, 7)], [expect32(1, 7, 7.0625)]], [[expect32(0, 0, 15.625), expect32(1, 0, 14.0625)]])
    const later: NativeObservation = { ...abcdNative, points: abcdNative.points.map((point, i) => (i === 3 ? { ...point, rects: [at(15.625, 7)] } : point)) }
    const unranged = structuredClone(abcdLayout)
    unranged.lines[0]!.gaps.push(gap('font-fallback'))
    const value = scoreRow(row('chrome', abcd, later, unranged, early)).lineGaps.breaks!
    expect(value.lines[0]).toMatchObject({ engineLine: 0, gaps: [{ gap: 'font-fallback', scope: 'line', touch: 'decision', unranged: true }], evidence: { decision: { start: 3, end: 4 } } })
  })

  test('the decision text reaches out to the predicted break', () => {
    // The prediction breaks `ab cd` after `a`, and expects `b` to report an empty rect at the end of line 0 too, so `b` is on
    // line 0 on both sides; natively the break is after the space. Only the space sits on line 0 on one side alone.
    const expected = observation(abcd,
      [[expect32(0, 0, 8)], [expect32(0, 8, 0), expect32(1, 0, 7.625)], [expect32(1, 7.625, 4)], [expect32(1, 11.625, 7)], [expect32(1, 18.625, 7.0625)]],
      [[expect32(0, 0, 8), expect32(1, 0, 25.6875)]])
    const layout = blink([[0, 1, 1024], [1, 5, 3288]])
    layout.lines[0]!.gaps.push(gap('page-history', { start: 1, end: 1 }))
    const score = scoreRow(row('chrome', abcd, abcdNative, layout, expected)).lineGaps.breaks!
    expect(score.lines[0]).toMatchObject({ engineLine: 0, gaps: [{ gap: 'page-history', scope: 'line', touch: 'decision' }], evidence: { decision: { start: 1, end: 3 }, decisionText: 'b ' } })
  })

  test('lineCount and breaks: geometry that differs before the decision must be touched', () => {
    // As above, and `a` is wider natively: a gap at the decision text no longer covers.
    const observed: NativeObservation = { ...abcdNative, points: abcdNative.points.map((point, i) => (i === 0 ? { ...point, rects: [at(0, 8.5)] } : point)) }
    const score = (gaps: Gap[]): CaseScore => scoreRow(row('chrome', abcd, observed, { ...abcdOneLine, gaps }, abcdOneLineExpected))
    const decisionOnly = score([gap('dictionary-breaks-stand-in', { start: 3, end: 3 })]).lineGaps.breaks!
    expect(decisionOnly.covered).toBe(false)
    expect(decisionOnly.lines[0]!.evidence).toMatchObject({ units: 2, runs: 2, deciding: 1, touched: 0, pureDecision: false, firstText: 'a' })
    expect(score([gap('script-context', { start: 0, end: 1 })]).lineGaps.breaks!.covered).toBe(true)
  })

  test('WebKit, lineCount and breaks: the node that reaches the decision text is a unit up to it', () => {
    // `abc def` in one node; natively `def` wraps, the prediction keeps it on line 0.
    const p = paragraph([['abc def', 'text']])
    const observed = native(p, [[at(0, 10)], [at(10, 10)], [at(20, 10)], [at(30, 0)], [at(0, 10, 1)], [at(10, 10, 1)], [at(20, 10, 1)]], [[at(0, 30), at(0, 30, 1)]])
    const expected = observation(p, [0, 10, 20, 30, 34, 44, 54].map((x, i) => [expect32(0, x, i === 3 ? 4 : 10)]), [[expect32(0, 0, 64)]])
    const score = (gaps: Gap[]): CaseScore => scoreRow(row('webkit-host', p, observed, { ...webkit([[0, 7, 64]]), gaps }, expected))
    const early = score([gap('canvas-language', { start: 0, end: 1 })]).lineGaps.breaks!
    expect(early.covered).toBe(true)
    expect(early.lines[0]).toMatchObject({ gaps: [{ gap: 'canvas-language', scope: 'paragraph-range', touch: 'unit' }], evidence: { units: 1, nodeUnits: 1, deciding: 0, pureDecision: true, first: { start: 0, end: 4 }, decision: { start: 4, end: 7 } } })
    // The same rects in Chrome compare code point by code point: only the trimmed space differs, and it runs back from
    // the decision text, so a gap at `a` covers nothing.
    const chrome = scoreRow(row('chrome', p, observed, { ...blink([[0, 7, 8192]]), gaps: [gap('script-context', { start: 0, end: 1 })] }, expected)).lineGaps.breaks!
    expect([chrome.covered, chrome.lines[0]!.evidence!.first]).toEqual([false, { start: 3, end: 4 }])
  })

  test('the previous line\'s, the next line\'s and refused slots\' gaps concern a line', () => {
    const layout = blink([[0, 3, 2000], [3, 3, 0, false], [3, 5, 1800]])
    layout.lines[0]!.gaps.push(gap('in-word-prefix'))
    layout.lines[1]!.gaps.push(gap('glyph-clusters'))
    layout.lines[2]!.gaps.push(gap('tab-stops'))
    const withRefusal = { ...layout, belowFloats: [{ row: 1, gaps: [gap('font-fallback')] }, { row: 3, gaps: [gap('tab-stops')] }] }
    // Without evidence (the painter's rule) every gap that concerns the line is listed.
    expect(lineLocalGaps(withRefusal, [0, 2], 1).gaps).toEqual([
      { gap: 'font-fallback', scope: 'below-floats', unranged: true }, { gap: 'glyph-clusters', scope: 'previous-line', unranged: true },
      { gap: 'in-word-prefix', scope: 'previous-line', unranged: true }, { gap: 'tab-stops', scope: 'line', unranged: true },
    ])
    // Native line 0 is engine line 0: its own gaps concern it, and no refusal comes before it. With evidence, the gaps up to
    // the next line box concern it too.
    expect(lineLocalGaps(withRefusal, [0, 2], 0).gaps.map(value => [value.gap, value.scope])).toEqual([['in-word-prefix', 'line']])
    expect(lineLocalGaps(withRefusal, [0, 2], 0, { units: [], decision: null }).elsewhere).toEqual([{ gap: 'glyph-clusters', scope: 'next-line' }, { gap: 'in-word-prefix', scope: 'line' }, { gap: 'tab-stops', scope: 'next-line' }])
  })

  test('a failing width attributes every failing line, and the painter keeps every gap that concerns its line', () => {
    const { row: value, layout } = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 3], [3, 6]], native: [600, 610, 600, 600, 620, 600], expected: [600, 600, 600, 600, 600, 600] }, 'native')
    layout.lines[1]!.gaps.push(gap('in-word-prefix', { start: 4, end: 4 }), gap('script-context', { start: 5, end: 6 }))
    const score = scoreRow(value)
    expect(score.lineGaps.widths!.lines.map(line => [line.nativeLine, line.gaps.map(other => other.gap)])).toEqual([[0, []], [1, ['in-word-prefix']]])
    expect(score.lineGaps.widths!.covered).toBe(false)
    expect(score.metrics.painter.status).toBe('fail')
    expect(score.lineGaps.painter!.lines[1]!.gaps).toEqual([{ gap: 'in-word-prefix', scope: 'line' }, { gap: 'script-context', scope: 'line' }])
  })
})

describe('residual classes', () => {
  // `ab modern cd` in 15px Helvetica Neue: natively `modern` is 1 au narrower, on `o`.
  const font = { family: '"Helvetica Neue", Helvetica, Arial, sans-serif', size: 15, weight: 400, style: 'normal' as const }
  const oneUnit = (text: string, painted: 'native' | 'expected' | null, narrow = 4): LabRow => {
    const widths = [...text].map(() => 500)
    const value = unitRow({ browser: 'firefox', runs: [text], lines: [[0, text.length]], native: widths.map((w, i) => (i === narrow ? w - 1 : w)), expected: widths }, painted).row
    value.case.paragraph.runs[0]!.font = font
    return value
  }

  test('Gecko\'s 1 au class: probed where a probe measured the differing text in the node\'s font', () => {
    const score = scoreRow(oneUnit('ab modern cd', 'native'))
    expect(score.metrics.widths.status).toBe('fail')
    expect(score.lineGaps.widths!.covered).toBe(false)
    expect(score.residual).toEqual({ name: 'gecko/one-shaping-unit-one-app-unit', membership: 'probed', detail: 'node 0 on engine line 0 is -1 au at "o"; probed "modern" (F7; ROUND2-CRITIC item 4)' })
  })

  test('by signature alone where no probe measured the text, or in another font', () => {
    expect(scoreRow(oneUnit('ab modest cd', 'native')).residual).toMatchObject({ membership: 'signature' })
    // The differing code point is outside the probed word.
    expect(scoreRow(oneUnit('ab modern cd', 'native', 0)).residual).toMatchObject({ membership: 'signature' })
    const bold = oneUnit('ab modern cd', 'native')
    bold.case.paragraph.runs[0]!.font = { ...font, weight: 700 }
    expect(scoreRow(bold).residual).toMatchObject({ membership: 'signature' })
  })

  test('no member without the signature: the painter must draw the line at the native width, and one node rect differ by 1 au', () => {
    expect(scoreRow(oneUnit('ab modern cd', 'expected')).residual).toBeNull()
    expect(scoreRow(oneUnit('ab modern cd', null)).residual).toBeNull()
    const two = unitRow({ browser: 'firefox', runs: ['abc', 'def'], lines: [[0, 6]], native: [500, 499, 500, 500, 499, 500], expected: [500, 500, 500, 500, 500, 500] }, 'native').row
    expect(scoreRow(two).residual).toBeNull()
    const twoUnits = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 6]], native: [500, 498, 500, 500, 500, 500], expected: [500, 500, 500, 500, 500, 500] }, 'native').row
    expect(scoreRow(twoUnits).residual).toBeNull()
    expect(residualMembership({ engine: 'blink', metrics: { lineCount: 'pass', breaks: 'pass', widths: 'fail', painter: 'fail' }, nodeWidths: [], paintedAtNativeWidth: true })).toBeNull()
  })

  test('the summary counts residual members apart from open failures, probed apart from signature alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-score-residual-'))
    const named = (value: LabRow, id: string): LabRow => ({ ...value, id, case: { ...value.case, id } })
    const covered = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 6]], native: [600, 600, 605, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] }, 'native')
    covered.layout.gaps.push({ gap: 'glyph-clusters', run: 0, detail: 'test', at: { start: 2, end: 3 } })
    const open = unitRow({ browser: 'firefox', runs: ['abcdef'], lines: [[0, 6]], native: [600, 600, 605, 600, 600, 600], expected: [600, 600, 600, 600, 600, 600] }, 'native')
    const rows = [named(oneUnit('ab modern cd', 'native'), 'c-probed'), named(oneUnit('ab modest cd', 'native'), 'c-signature'), named(covered.row, 'c-covered'), named(open.row, 'c-open'), named(oneUnit('ab modern cd', 'native', 99), 'c-pass')]
    const path = join(dir, 'rows.ndjson')
    writeFileSync(path, rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    const scored = Bun.spawnSync(['bun', join(import.meta.dir, 'score.ts'), `--rows=${path}`, `--out=${join(dir, 'summary.json')}`, `--per-case=${join(dir, 'per-case.ndjson')}`])
    expect(scored.exitCode).toBe(0)
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { scorer: number; browsers: { firefox: { lineLocal: Record<string, unknown> } } }
    expect(summary.scorer).toBe(5)
    expect(summary.browsers.firefox.lineLocal['predictionRows']).toEqual({ failing: 4, withoutCoveredExplanation: 3, residualProbed: 1, residualSignatureOnly: 1, open: 1 })
    expect(summary.browsers.firefox.lineLocal['residual']).toEqual({ 'gecko/one-shaping-unit-one-app-unit': { probed: 1, signatureOnly: 1, coveredProbed: 0, coveredSignatureOnly: 0 } })
    expect(summary.browsers.firefox.lineLocal['withoutLineGap']).toEqual({ lineCount: 0, breaks: 0, widths: 3, painter: 3 })
    const perCase = readFileSync(join(dir, 'per-case.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { id: string; residual?: { membership: string } })
    expect(perCase.map(value => [value.id, value.residual?.membership ?? null])).toEqual([['c-probed', 'probed'], ['c-signature', 'signature'], ['c-covered', null], ['c-open', null], ['c-pass', null]])
  })

  test('every entry names its probes and says whether its mechanism is verified or inferred', () => {
    for (const value of RESIDUAL_CLASSES) {
      expect(value.probes.length).toBeGreaterThan(0)
      expect(['verified', 'inferred']).toContain(value.mechanism.status)
      expect(value.signature.length).toBeGreaterThan(0)
    }
  })
})

describe('indented lines: Blink and Gecko count the text-indent in the engine width', () => {
  test('the rects span the engine width less the indent', () => {
    for (const browser of ['firefox', 'chrome'] as const) {
      const { row: value, layout } = unitRow({ browser, runs: ['abc'], lines: [[0, 3]], native: [640, 640, 640], expected: [640, 640, 640] }, 'expected')
      if (layout.engine === 'webkit') throw new Error('unreachable')
      layout.lines[0]!.geometry.textIndent = -256
      // Before scorer 5 this width was unobserved: the engine width holds the indent and no rect does.
      expect(scoreRow(value).metrics.widths).toEqual({ status: 'unobserved', reason: 'the port\'s node rects on the line don\'t span the engine width', detail: `engine line 0: width 1920 less text-indent -256; expected node rects span [0, 1920]` })
      layout.lines[0]!.geometry.width = 1920 - 256
      expect([scoreRow(value).metrics.widths, scoreRow(value).metrics.painter]).toEqual([{ status: 'pass' }, { status: 'pass' }])
      layout.lines[0]!.geometry.width = 1921 - 256
      expect(scoreRow(value).metrics.widths.status).toBe('unobserved')
    }
    const { row: wider, layout } = unitRow({ browser: 'firefox', runs: ['abc'], lines: [[0, 3]], native: [640, 641, 640], expected: [640, 640, 640] })
    if (layout.engine !== 'gecko') throw new Error('unreachable')
    layout.lines[0]!.geometry.textIndent = 600
    layout.lines[0]!.geometry.width = 1920 + 600
    expect(scoreRow(wider).metrics.widths).toEqual({ status: 'fail', reason: 'width differs', detail: 'engine line 0: width 2520 less text-indent 600; native node rects span [0, 1921]' })
  })
})

describe('widths: the engine width against the union of the line\'s node rects, in engine units', () => {
  test('Blink: a width one LayoutUnit wider fails', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 3, 2001], [3, 5, 1800]]),
      observation(abcd, abcdExpected.codePoints.map(point => point.rects), [[expect32(0, 0, 15.6328125), expect32(1, 0, 14.0625)]])))
    expect(score.metrics.widths).toEqual({ status: 'fail', reason: 'width differs', detail: 'engine line 0: width 2001; native node rects span [0, 2000]' })
    expect(score.widthDiffs).toEqual([1, 0])
  })

  test('Blink: a hyphen no node range reports (U3) makes the width unobservable', () => {
    // The engine width holds a 660 raw hyphen item the port's node rects leave out.
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 3, 2660], [3, 5, 1800]]), abcdExpected))
    expect(score.metrics.widths).toEqual({ status: 'unobserved', reason: 'the port\'s node rects on the line don\'t span the engine width', detail: 'engine line 0: width 2660; expected node rects span [0, 2000]' })
  })

  test('Gecko: app units through DOMRect::SetLayoutRect, and one app unit off fails', () => {
    const p = paragraph([['ab', 'text']])
    const box = encodeEdges(1733, 11760)
    const gone = encodeEdges(1733, 11761)
    const observed = native(p, [[at(box.x, 5)], [at(box.x + 5, box.width - 5)]], [[at(box.x, box.width)]])
    const expected = observation(p, [[expect32(0, box.x, 5)], [expect32(0, box.x + 5, box.width - 5)]], [[expect32(0, box.x, box.width)]])
    expect(scoreRow(row('firefox', p, observed, gecko([[0, 2, 10027]]), expected)).metrics.widths).toEqual({ status: 'pass' })
    const wider = observation(p, expected.codePoints.map(point => point.rects), [[expect32(0, gone.x, gone.width)]])
    expect(scoreRow(row('firefox', p, observed, gecko([[0, 2, 10028]]), wider)).metrics.widths.status).toBe('fail')
  })

  test('WebKit: box edges are float32 sums, and a content width a float32 step off the boxes is unobservable', () => {
    const p = paragraph([['ab', 'span'], ['cd', 'span']])
    const left = f32(30.469196319580078)
    const width = f32(71.9345703125)
    const right = f32(left + width)
    const observed = native(p, [[at(0, 16)], [at(15, f32(left - 15))], [at(left, 36)], [at(66, f32(right - 66))]], [[at(0, left)], [at(left, width)]])
    const expected = observation(p, observed.points.map(point => point.rects.map(rect => expect32(0, rect.x, rect.width))), [[expect32(0, 0, left)], [expect32(0, left, width)]])
    expect(right).toBe(102.40376281738281)
    expect(scoreRow(row('webkit-host', p, observed, webkit([[0, 4, right]]), expected)).metrics.widths).toEqual({ status: 'pass' })
    const stepped = f32(right + 2 ** -17)
    expect(scoreRow(row('webkit-host', p, observed, webkit([[0, 4, stepped]]), expected)).metrics.widths.status).toBe('unobserved')
  })
})

describe('painter: painted lines against the engine width', () => {
  const paintedLine = (rects: Rect[]): PainterLine => ({ box: at(0, 200), height: 20, rects, extent: null, points: [] })

  test('painted node rects that span the engine width pass', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, abcdExpected, [paintedLine([at(0, 15.625)]), paintedLine([at(0, 14.0625)])]))
    expect(score.metrics.painter).toEqual({ status: 'pass' })
  })

  test('a painted line on two lines wraps', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, abcdExpected, [paintedLine([at(0, 8), at(0, 7.625, 1)]), paintedLine([at(0, 14.0625)])]))
    expect(score.metrics.painter).toEqual({ status: 'fail', reason: 'painted line wraps', detail: 'engine line 0 painted on 2 lines' })
  })
})

describe('a prediction of line ranges alone', () => {
  const base = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)

  test('only the line count is a metric', () => {
    expect(scoreRow(linesRow(base, [[0, 3], [3, 5]])).metrics).toEqual({
      lineCount: { status: 'pass' },
      breaks: { status: 'unobserved', reason: 'the prediction has no engine layout' },
      widths: { status: 'not-applicable', reason: 'breaks unobserved' },
      painter: { status: 'not-applicable', reason: 'paint returned null' },
    })
  })

  test('visible breaks: code points with positive-width rects on one native line lie in the predicted line', () => {
    expect(scoreRow(linesRow(base, [[0, 3], [3, 5]])).diagnostics).toEqual({
      visibleBreaks: { status: 'pass' },
      // The only zero-width code point is a space: white space is left out.
      zeroWidthPlacement: { status: 'unobserved', reason: 'no zero-width code point to place' },
    })
    expect(scoreRow(linesRow(base, [[0, 4], [4, 5]])).diagnostics!.visibleBreaks).toEqual({ status: 'fail', reason: 'code point on other lines', detail: 'code point 3 "c": native line 1, predicted line 0' })
    expect(scoreRow(linesRow(base, [[0, 5]])).diagnostics!.visibleBreaks).toEqual({ status: 'unobserved', reason: 'line count differs', detail: 'native 2, predicted 1' })
  })

  test('zero-width placement: a zero-width code point outside white space lies in the predicted line', () => {
    const p = paragraph([['a​b', 'text']])
    const observed = native(p, [[at(0, 8)], [at(0, 0, 1)], [at(0, 8, 1)]], [[at(0, 8), at(0, 8, 1)]])
    const lines = nativeLines(observed, p, 'chrome')
    const text = 'a​b'
    expect(lineRangeDiagnostics(observed, lines, { lines: [{ start: 0, end: 2, width: 0 }, { start: 2, end: 3, width: 0 }] }, text)).toEqual({
      visibleBreaks: { status: 'pass' },
      zeroWidthPlacement: { status: 'fail', reason: 'zero-width code point on other lines', detail: 'code point 1 "​": native line 1, predicted line 0' },
    })
    expect(lineRangeDiagnostics(observed, lines, { lines: [{ start: 0, end: 1, width: 0 }, { start: 1, end: 3, width: 0 }] }, text).zeroWidthPlacement).toEqual({ status: 'pass' })
  })

  test('a code point no predicted line covers is left out, not a failure', () => {
    // Main's line ranges leave out the ZWSP at the line edge: [0, 1) and [2, 3).
    const p = paragraph([['a​b', 'text']])
    const observed = native(p, [[at(0, 8)], [at(8, 0)], [at(0, 8, 1)]], [[at(0, 8), at(0, 8, 1)]])
    const lines = nativeLines(observed, p, 'chrome')
    expect(lineRangeDiagnostics(observed, lines, { lines: [{ start: 0, end: 1, width: 0 }, { start: 2, end: 3, width: 0 }] }, 'a​b')).toEqual({
      visibleBreaks: { status: 'pass' },
      zeroWidthPlacement: { status: 'unobserved', reason: 'no zero-width code point to place' },
    })
  })
})

describe('rows from run.ts --predict-only take native observations from another run', () => {
  const nativeRow = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)
  const predictOnly = linesRow(nativeRow, [[0, 3], [3, 5]], { skipped: 'predict-only' })

  test('without a native row, every metric is unobserved', () => {
    expect(scoreRow(predictOnly).metrics.lineCount).toEqual({ status: 'unobserved', reason: 'native observation skipped', detail: 'predict-only' })
    expect(nativeView(predictOnly).error).toBe('native observation skipped: predict-only')
  })

  test('combined with the native row of the same case in the same environment', () => {
    const combined = withNativeRow(predictOnly, { ...nativeRow, env: { ...nativeRow.env, documentCaseIndex: 7 } })
    expect('error' in combined).toBe(false)
    const value = combined as LabRow
    expect(value.env.documentCaseIndex).toBe(7)
    expect(scoreRow(value).metrics.lineCount).toEqual({ status: 'pass' })
  })

  test('refusals', () => {
    expect(withNativeRow(nativeRow, nativeRow)).toEqual({ error: 'row c-test has its own native observation; --native-rows takes rows from run.ts --predict-only' })
    expect(withNativeRow(predictOnly, predictOnly)).toEqual({ error: 'the native row for c-test has no native observation either' })
    expect(withNativeRow(predictOnly, { ...nativeRow, case: { ...nativeRow.case, pageLang: 'ja' } })).toEqual({ error: 'the native row for c-test observed a different case' })
    const languages = { launch: null, os: { appleLanguages: null, appleLocale: null, launchdEnvironment: {} }, derivation: [] }
    const zh = { ...predictOnly, languages: { ...languages, given: { engine: 'blink' as const, uiLanguage: 'zh-CN' } } }
    const en = { ...nativeRow, languages: { ...languages, given: { engine: 'blink' as const, uiLanguage: 'en-US' } } }
    expect((withNativeRow(zh, en) as { error: string }).error).toBe('the environments differ for c-test: languages "{\\"engine\\":\\"blink\\",\\"uiLanguage\\":\\"zh-CN\\"}" vs "{\\"engine\\":\\"blink\\",\\"uiLanguage\\":\\"en-US\\"}"')
  })

  test('rows index by byte offset past multi-byte text, U+2028 and blank lines, and refuse duplicate ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-score-test-'))
    const first = { ...nativeRow, id: 'c-first', case: { ...nativeRow.case, id: 'c-first', origin: 'suite 文字   line' } }
    const second = { ...nativeRow, id: 'c-second', case: { ...nativeRow.case, id: 'c-second' } }
    const path = join(dir, 'rows.ndjson')
    writeFileSync(path, `${JSON.stringify(first)}\n\n${JSON.stringify(second)}\n`)
    const index = await indexRows(path)
    expect([...index.keys()]).toEqual(['c-first', 'c-second'])
    const fd = (await import('node:fs')).openSync(path, 'r')
    expect(readRowAt(fd, index.get('c-first')!).case.origin).toBe('suite 文字   line')
    const duplicate = join(dir, 'duplicate.ndjson')
    writeFileSync(duplicate, `${JSON.stringify(first)}\n${JSON.stringify(first)}\n`)
    await expect(indexRows(duplicate)).rejects.toThrow('two rows for case c-first')
  })

  test('the command line scores predict-only rows against native rows, and sealed summaries hold counts only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-score-cli-'))
    const rows = join(dir, 'main-rows.ndjson')
    const natives = join(dir, 'native-rows.ndjson')
    writeFileSync(rows, `${JSON.stringify(predictOnly)}\n`)
    writeFileSync(natives, `${JSON.stringify(nativeRow)}\n`)
    const script = join(import.meta.dir, 'score.ts')
    const scored = Bun.spawnSync(['bun', script, `--rows=${rows}`, `--native-rows=${natives}`, `--out=${join(dir, 'summary.json')}`, `--per-case=${join(dir, 'per-case.ndjson')}`])
    expect(scored.exitCode).toBe(0)
    const perCase = JSON.parse(readFileSync(join(dir, 'per-case.ndjson'), 'utf8')) as { lineCount: { status: string }; diagnostics: { visibleBreaks: { status: string } } }
    expect([perCase.lineCount.status, perCase.diagnostics.visibleBreaks.status]).toEqual(['pass', 'pass'])
    expect((JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as { nativeRows: unknown }).nativeRows).toEqual({ used: 1, missing: 0 })
    const refused = Bun.spawnSync(['bun', script, `--rows=${natives}`, `--sealed`, `--out=${join(dir, 'sealed.json')}`, `--per-case=${join(dir, 'sealed-per-case.ndjson')}`])
    expect(refused.exitCode).toBe(1)
    const sealed = Bun.spawnSync(['bun', script, `--rows=${natives}`, '--sealed', `--out=${join(dir, 'sealed.json')}`])
    expect(sealed.exitCode).toBe(0)
    const text = readFileSync(join(dir, 'sealed.json'), 'utf8')
    expect(text.includes('c-test')).toBe(false)
    expect((JSON.parse(text) as { browsers: { chrome: { metrics: { lineCount: { pass: number } } } } }).browsers.chrome.metrics.lineCount.pass).toBe(1)
  })
})

describe('two runs of one case', () => {
  test('rects that differ in x, width or line differ; y alone does not', () => {
    const base = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)
    const shifted = { ...base, native: native(abcd, [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0)], [at(0, 7, 1)], [at(7, 7.0625, 1)]], [[{ x: 0, y: 1, width: 15.625, height: 20 }, at(0, 14.0625, 1)]]) }
    expect(nativeDifference(nativeView(base), nativeView(shifted))).toBeNull()
    const wider = { ...base, native: native(abcd, [[at(0, 8)], [at(8, 7.6328125)], [at(15.625, 0)], [at(0, 7, 1)], [at(7, 7.0625, 1)]], abcdNative.runRects) }
    expect(nativeDifference(nativeView(base), nativeView(wider))).toBe('code point 1: [x, width, line] [8,7.625,0] vs [8,7.6328125,0]')
  })

  test('environments key on the recorded build and the given process languages', () => {
    const base = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)
    expect(environmentKey(base)).toBe('chrome: build not recorded, test; DPR 2, scale 1; scorer 5')
    const built = { ...base, build: { app: 'Google Chrome', appVersion: '153.0.8010.48', engine: '153.0.8010.48', os: '26A428' } }
    expect(environmentKey(built)).toBe('chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; scorer 5')
    const languages = { launch: null, os: { appleLanguages: null, appleLocale: null, launchdEnvironment: {} }, given: { engine: 'blink' as const, uiLanguage: 'zh-CN' }, derivation: [] }
    expect(environmentKey({ ...built, languages })).toBe('chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 5')
  })
})
