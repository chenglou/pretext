import { describe, expect, test } from 'bun:test'
import type { BlinkEnvironment, GeckoEnvironment, WebKitEnvironment } from '../src/env.ts'
import type { BlinkLineGeometry, BlinkLine, Expected, ExpectedObservation, ExpectedRect, GeckoLine, GeckoLineGeometry, WebKitLine, WebKitLineGeometry } from '../src/model.ts'
import { encodeEdges } from './observe/gecko.ts'
import { environmentKey, nativeDifference, nativeLines, nativeView, scoreRow } from './score.ts'
import type { BrowserKind, CodePointObservation, FontDecl, LabRow, NativeObservation, PainterLine, Paragraph, Rect, RecordedLayout, TextRun } from './types.ts'

const f32 = Math.fround
const arial: FontDecl = { family: 'Arial', size: 16, weight: 400, style: 'normal' }

function paragraph(runs: Array<[text: string, node: TextRun['node']]>, overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font: arial, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font: arial, letterSpacing: 0, wordSpacing: 0, width: 200, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

// A native rect on line `line` (lines are 20px tall).
const at = (x: number, width: number, line = 0): Rect => ({ x, y: line * 20, width, height: 20 })
const predicted = (value: number): Expected => ({ state: 'predicted', value })
// An expected rect of engine line `line`, both values predicted unless given.
const expect32 = (line: number, x: number | Expected, width: number | Expected): ExpectedRect => ({
  line, x: typeof x === 'number' ? predicted(x) : x, width: typeof width === 'number' ? predicted(width) : width,
})

function points(text: string, rects: Rect[][]): CodePointObservation[] {
  const out: CodePointObservation[] = []
  for (let offset = 0; offset < text.length;) {
    const length = text.codePointAt(offset)! > 0xffff ? 2 : 1
    out.push({ offset, length, rects: rects[out.length]! })
    offset += length
  }
  if (out.length !== rects.length) throw new Error(`${rects.length} rect lists for ${out.length} code points`)
  return out
}

function native(p: Paragraph, rects: Rect[][], runRects: Rect[][]): NativeObservation {
  return { fontsStatusBefore: 'loaded', fontsStatusAfter: 'loaded', rejectedStyles: [], height: 0, width: p.width, points: points(p.runs.map(run => run.text).join(''), rects), runRects }
}

function observation(p: Paragraph, rects: ExpectedRect[][], nodes: ExpectedRect[][], unobservable: ExpectedObservation['unobservable'] = []): ExpectedObservation {
  const text = p.runs.map(run => run.text).join('')
  const codePoints = points(text, rects.map(() => [])).map((point, i) => ({ offset: point.offset, length: point.length, rects: rects[i]! }))
  return { codePoints, nodes, unobservable }
}

const blinkEnv: BlinkEnvironment = { engine: 'blink', build: '153.0.8010.48', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: null, dictionaryBreaks: { kind: 'unavailable' } }
const webkitEnv: WebKitEnvironment = { engine: 'webkit', build: '22625.1.29.11.27', devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: null, icuDefaultLocale: null, dictionaryBreaks: { kind: 'unavailable' } }
const geckoEnv: GeckoEnvironment = { engine: 'gecko', build: '156.0', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: null, dictionaryBreaks: { kind: 'unavailable' } }

function engineLine<Geometry>(start: number, end: number, geometry: Geometry, hasLineBox = true): { start: number; end: number; fragments: []; hasLineBox: boolean; joinsNextLine: false; geometry: Geometry; gaps: []; next: null } {
  return { start, end, fragments: [], hasLineBox, joinsNextLine: false, geometry, gaps: [], next: null }
}

// Blink lines by [start, end, width in raw LayoutUnits, hasLineBox], at layout zoom 2.
function blink(lines: Array<[number, number, number, boolean?]>): RecordedLayout {
  const out: BlinkLine[] = lines.map(([start, end, width, hasLineBox]) => engineLine<BlinkLineGeometry>(start, end, { layoutZoom: 2, availableWidth: 0, width, hangWidth: 0, mapping: [], items: [] }, hasLineBox ?? true))
  return { engine: 'blink', env: blinkEnv, lines: out, gaps: [] }
}

function webkit(lines: Array<[number, number, number]>): RecordedLayout {
  const out: WebKitLine[] = lines.map(([start, end, contentWidth]) => engineLine<WebKitLineGeometry>(start, end, { lineBoxWidth: 0, contentWidth, hangingWidth: 0, contentLogicalRight: contentWidth, boxes: [] }))
  return { engine: 'webkit', env: webkitEnv, lines: out, gaps: [] }
}

function gecko(lines: Array<[number, number, number]>): RecordedLayout {
  const out: GeckoLine[] = lines.map(([start, end, width]) => engineLine<GeckoLineGeometry>(start, end, { appUnitsPerDevPixel: 30, availableWidth: 0, width, hang: 0, frames: [] }))
  return { engine: 'gecko', env: geckoEnv, lines: out, gaps: [] }
}

function row(browser: BrowserKind, p: Paragraph, observed: NativeObservation, layout: RecordedLayout, expected: ExpectedObservation | { error: string }, painted: PainterLine[] | null = null): LabRow {
  return {
    id: 'c-test', family: 'test', browser,
    case: { id: 'c-test', family: 'test', origin: 'test', pageLang: 'en', paragraph: p },
    env: { userAgent: 'test', devicePixelRatio: 2, visualViewportScale: 1, pageLang: 'en', fontFixtures: [], innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0, visibilityState: 'visible', hasFocus: false },
    native: observed,
    prediction: { layout, measure: { contexts: 0, calls: 0, memoHits: 0 }, observation: expected },
    painter: painted === null ? null : { lines: painted },
    timings: { nativeMs: 0, predictMs: 0, observeMs: 0, paintMs: 0, painterObserveMs: 0 },
  }
}

// `ab cd` in one text node, broken after the space at DPR 2: `a` 1024 raw, `b` 976, the trimmed space a zero-width
// boundary rect at the item end, `c` 896, `d` 904.
const abcd = paragraph([['ab cd', 'text']])
const abcdNative = native(abcd,
  [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0)], [at(0, 7, 1)], [at(7, 7.0625, 1)]],
  [[at(0, 15.625), at(0, 14.0625, 1)]])
const abcdExpected = observation(abcd,
  [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 0)], [expect32(1, 0, 7)], [expect32(1, 7, 7.0625)]],
  [[expect32(0, 0, 15.625), expect32(1, 0, 14.0625)]])
const abcdLayout = blink([[0, 3, 2000], [3, 5, 1800]])

describe('native lines group rects by vertical centre', () => {
  test('zero-width rects are placed, rects without height are not', () => {
    const p = paragraph([['ab', 'text']])
    const lines = nativeLines(native(p, [[at(0, 8), { x: 8, y: 30, width: 0, height: 0 }], [at(0, 0, 1)]], [[at(0, 8), at(0, 0, 1)]]), 20)
    expect(lines).toEqual({ count: 2, points: [[0, -1], [1]], nodes: [[0, 1]], unplaced: 1 })
  })

  test('centres of one line differ by font metrics, less than half a line height', () => {
    const p = paragraph([['ab', 'span'], ['c', 'span']])
    const lines = nativeLines(native(p, [[at(0, 8)], [at(8, 8)], [{ x: 16, y: -3.5, width: 7, height: 25 }]], [[at(0, 16)], [{ x: 16, y: -3.5, width: 7, height: 25 }]]), 20)
    expect(lines.count).toBe(1)
  })
})

describe('rects compare exactly, and the metrics follow from the comparisons', () => {
  test('equal rects: every metric passes and every value is a predicted equal', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, abcdLayout, abcdExpected))
    expect(score.metrics).toEqual({ lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: { status: 'pass' }, painter: { status: 'not-applicable', reason: 'paint returned null' } })
    expect(score.facts).toMatchObject({ counts: { equal: 6, differ: 0 }, predicted: { equal: 14, differ: 0 }, lines: { equal: 7, differ: 0 } })
    expect(score.firstDifference).toBeNull()
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
    const oneLine = observation(abcd, [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 4)], [expect32(0, 19.625, 7)], [expect32(0, 26.625, 7.0625)]], [[expect32(0, 0, 33.6875)]])
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 5, 4312]]), oneLine))
    expect(score.metrics.lineCount).toEqual({ status: 'fail', reason: 'line count differs', detail: 'native 2, predicted 1' })
    expect(score.metrics.breaks.reason).toBe('line count differs')
  })

  test('a line box no Range reports leaves the line count unobserved', () => {
    const score = scoreRow(row('chrome', abcd, abcdNative, blink([[0, 3, 2000], [3, 3, 0], [3, 5, 1800]]),
      observation(abcd, abcdExpected.codePoints.map(point => point.rects.map(rect => ({ ...rect, line: rect.line === 1 ? 2 : 0 }))),
        [[expect32(0, 0, 15.625), expect32(2, 0, 14.0625)]])))
    expect(score.metrics.lineCount).toEqual({ status: 'unobserved', reason: 'a line box no Range reports', detail: 'engine line 1' })
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

describe('a prediction without an engine layout', () => {
  test('only the line count is compared', () => {
    const lines: LabRow = { ...row('chrome', abcd, abcdNative, abcdLayout, abcdExpected), prediction: { lines: [{ start: 0, end: 3, width: 15.625 }, { start: 3, end: 5, width: 14.0625 }] } }
    expect(scoreRow(lines).metrics).toEqual({
      lineCount: { status: 'pass' },
      breaks: { status: 'unobserved', reason: 'the prediction has no engine layout' },
      widths: { status: 'not-applicable', reason: 'breaks unobserved' },
      painter: { status: 'not-applicable', reason: 'paint returned null' },
    })
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

  test('environments key on the recorded build', () => {
    const base = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)
    expect(environmentKey(base)).toBe('chrome: build not recorded, test; DPR 2, scale 1; scorer 2')
    expect(environmentKey({ ...base, build: { app: 'Google Chrome', appVersion: '153.0.8010.48', engine: '153.0.8010.48', os: '26A428' } }))
      .toBe('chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; scorer 2')
  })
})
