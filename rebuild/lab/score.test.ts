import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeEdges } from './observe/gecko.ts'
import {
  abcd, abcdExpected, abcdLayout, abcdNative, abcdOneLine, abcdOneLineExpected, at, blink, expect32, gecko, linesRow, native, observation, paragraph, row, webkit,
} from './row-fixtures.ts'
import { environmentKey, indexRows, lineRangeDiagnostics, nativeDifference, nativeLines, nativeView, readRowAt, scoreRow, withNativeRow } from './score.ts'
import type { LabRow, PainterLine, Rect } from './types.ts'

const f32 = Math.fround

describe('native lines', () => {
  test('zero-width rects are placed, rects without height are not', () => {
    const p = paragraph([['ab', 'text']])
    const lines = nativeLines(native(p, [[at(0, 8), { x: 8, y: 30, width: 0, height: 0 }], [at(0, 0, 1)]], [[at(0, 8), at(0, 0, 1)]]), p, 'chrome')
    expect(lines).toEqual({ count: 2, points: [[0, -1], [1]], nodes: [[0, 1]], unplaced: 1, byCentre: 0 })
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
    expect(environmentKey(base)).toBe('chrome: build not recorded, test; DPR 2, scale 1; scorer 3')
    const built = { ...base, build: { app: 'Google Chrome', appVersion: '153.0.8010.48', engine: '153.0.8010.48', os: '26A428' } }
    expect(environmentKey(built)).toBe('chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; scorer 3')
    const languages = { launch: null, os: { appleLanguages: null, appleLocale: null, launchdEnvironment: {} }, given: { engine: 'blink' as const, uiLanguage: 'zh-CN' }, derivation: [] }
    expect(environmentKey({ ...built, languages })).toBe('chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 3')
  })
})
