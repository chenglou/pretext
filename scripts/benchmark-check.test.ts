import { expect, test } from 'bun:test'
import { medianReport, parseBenchmarkRun } from './benchmark-check.ts'
import type { BenchmarkRun } from '../shared/benchmark-report.ts'
import type { BrowserEnvironmentSnapshot } from '../shared/browser-environment.ts'

const state: BrowserEnvironmentSnapshot = {
  dpr: 2, visualViewportScale: 1, innerWidth: 1200, innerHeight: 800, outerWidth: 1200, outerHeight: 900,
  screenX: 0, screenY: 0, screenWidth: 2560, screenHeight: 1440, screenAvailWidth: 2560, screenAvailHeight: 1400,
  visibility: 'visible', focused: true, language: 'en', direction: 'ltr',
}
function report(requestId: string, ms: number, snapshot = state): BenchmarkRun {
  const rows = [{ label: 'prepare', ms, desc: 'cold batch' }]
  return {
    status: 'ready', requestId, environment: { userAgent: 'test', start: snapshot, end: snapshot, changes: [] },
    results: rows, richResults: rows, richInlineResults: rows, richPreWrapResults: rows, richLongResults: rows,
    corpusResults: [{ id: 'corpus', label: 'prose', font: '16px Arial', chars: 12, analysisSegments: 3, segments: 3,
      breakableSegments: 1, width: 100, lineCount: 1, analysisMs: ms, measureMs: ms, prepareMs: ms, layoutMs: ms }],
  }
}
function run(requestId: string, ms: number, snapshot = state): BenchmarkRun {
  return parseBenchmarkRun(report(requestId, ms, snapshot), requestId)
}

test('benchmark medians retain full measurements and identity of every validated run', () => {
  const result = medianReport([run('a', 1), run('b', 8), run('c', 3)])
  expect(result.results[0]!.ms).toBe(3)
  expect(result.corpusResults[0]!.prepareMs).toBe(3)
  expect(result.runs.map(run => [run.requestId, run.results[0]!.ms])).toEqual([['a', 1], ['b', 8], ['c', 3]])
})

test('unstable measurements and incompatible runs cannot silently become one benchmark', () => {
  expect(() => medianReport([run('a', 1), run('b', 2, { ...state, dpr: 1 })])).toThrow('environment.dpr')
  expect(() => medianReport([run('a', 1), run('b', 2, { ...state, screenX: 2560 })])).toThrow('environment.screenX')
  const interrupted = report('b', 2)
  interrupted.environment.changes.push({ field: 'focused', value: false, evidence: 'snapshot' })
  expect(() => parseBenchmarkRun(interrupted, 'b')).toThrow('focused')
  const different = run('b', 2)
  different.corpusResults[0]!.lineCount = 2
  expect(() => medianReport([run('a', 1), different])).toThrow('corpusResults[0].lineCount')
})

test('missing, failed or repeated report evidence cannot produce a benchmark snapshot', () => {
  const value = report('a', 1)
  expect(() => parseBenchmarkRun({ ...value, corpusResults: undefined }, 'a')).toThrow('missing corpusResults')
  expect(() => parseBenchmarkRun({ ...value, environment: undefined }, 'a')).toThrow('browser environment')
  expect(() => parseBenchmarkRun(value, 'other')).toThrow('wrong request identity')
  expect(() => parseBenchmarkRun({ status: 'error', message: 'Pending benchmark run' }, 'a')).toThrow('Pending benchmark run')
  expect(() => medianReport([run('a', 1), run('a', 2)])).toThrow('Duplicate benchmark request')
})

test('null, missing and nonfinite timings are rejected at the browser boundary', () => {
  const value = report('a', 1)
  for (const ms of [null, undefined, NaN, Infinity, -1]) {
    expect(() => parseBenchmarkRun({ ...value, results: [{ ...value.results[0], ms }] }, 'a')).toThrow('results.ms')
    expect(() => parseBenchmarkRun({ ...value, corpusResults: [{ ...value.corpusResults[0], layoutMs: ms }] }, 'a')).toThrow('corpusResults.layoutMs')
  }
  expect(run('a', 0).results[0]!.ms).toBe(0)
})

test('otherwise valid timings cannot hide incomplete or nonfinite environment evidence', () => {
  const value = report('a', 1)
  const environment = value.environment
  expect(() => parseBenchmarkRun({ ...value, environment: { ...environment, start: { ...state, screenX: undefined } } }, 'a')).toThrow('start.screenX')
  expect(() => parseBenchmarkRun({ ...value, environment: { ...environment, end: { ...state, screenWidth: NaN } } }, 'a')).toThrow('end.screenWidth')
})
