import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRuns, diffBaselines, formatBaseline, parseBaseline, parsePerCase, readRun, runProblems, seedBaseline, type Baseline, type CaseResult, type Run } from './gate.ts'
import type { Metric, MetricName, Status } from './score.ts'
import type { BrowserKind } from './types.ts'

const CODES: Record<string, Status> = { P: 'pass', F: 'fail', U: 'unobserved', N: 'not-applicable' }
const NAMES: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
const CHROME = 'DPR 2, scale 1, Chrome/153.0.0.0'

// `codes` gives lineCount, breaks, widths and painter, each P, F, U or N.
function result(id: string, codes: string, options: { browser?: BrowserKind; historyDependent?: string } = {}): CaseResult {
  const metrics = {} as Record<MetricName, Metric>
  for (let i = 0; i < NAMES.length; i++) {
    const status = CODES[codes[i]!]
    if (status === undefined) throw new Error(`bad codes ${codes}`)
    metrics[NAMES[i]!] = status === 'pass' ? { status } : { status, reason: `${status} here` }
  }
  return { id, family: 'test/family', browser: options.browser ?? 'chrome', metrics, historyDependent: options.historyDependent ?? null }
}

function run(name: string, cases: CaseResult[], options: { environments?: string[]; compared?: boolean } = {}): Run {
  return { path: `/runs/${name}-per-case.ndjson`, environments: options.environments ?? [CHROME], compared: options.compared ?? true, casesFile: null, cases }
}

const seed = (runs: Run[]): Baseline => seedBaseline(runs, { engine: 'blink', engineVersion: 'Chrome 153.0.8010.48', note: 'test' })
const unchecked = { complete: false }

describe('losses', () => {
  test('a lost pass fails the gate even when other cases gain passes', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'FNPN')])])
    const report = checkRuns(baseline, [run('b', [result('c-1', 'PPFP'), result('c-2', 'PPPP')])], unchecked)
    expect(report.ok).toBe(false)
    expect(report.lost.map(value => [value.id, value.metric, value.status, value.reason])).toEqual([['c-1', 'widths', 'fail', 'fail here']])
    expect(report.newPasses.map(value => [value.id, value.metric])).toEqual([['c-2', 'lineCount'], ['c-2', 'breaks'], ['c-2', 'painter']])
  })

  test('unobserved and not-applicable are never passes, so replacing a pass with them is a loss', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    const report = checkRuns(baseline, [run('b', [result('c-1', 'PUNP')])], unchecked)
    expect(report.ok).toBe(false)
    expect(report.lost.map(value => [value.metric, value.status])).toEqual([['breaks', 'unobserved'], ['widths', 'not-applicable']])
  })

  test('a pass lost in one order counts, although the other order still passes', () => {
    const baseline = seed([run('forward', [result('c-1', 'PPPP')]), run('reverse', [result('c-1', 'PPPP')])])
    const report = checkRuns(baseline, [run('forward', [result('c-1', 'PPPP')]), run('reverse', [result('c-1', 'PPFP')])], unchecked)
    expect(report.lost).toHaveLength(1)
    expect(report.lost[0]!.run.endsWith('reverse-per-case.ndjson')).toBe(true)
  })

  test('a missing baseline case is reported, and fails the gate only with --complete when it holds passes', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'PFNN'), result('c-3', 'FFNN')])])
    const partial = [run('b', [result('c-1', 'PPPP')])]
    const report = checkRuns(baseline, partial, unchecked)
    expect(report.ok).toBe(true)
    expect(report.missing).toEqual({ cases: 2, pairs: 1, ids: ['c-2', 'c-3'] })
    expect(checkRuns(baseline, partial, { complete: true }).ok).toBe(false)
    const withoutPasses = seed([run('a', [result('c-1', 'PPPP'), result('c-3', 'FFNN')])])
    expect(checkRuns(withoutPasses, partial, { complete: true }).ok).toBe(true)
  })
})

describe('history dependence and unstable pairs', () => {
  test('a case history-dependent in a current run never fails the gate, and keeps its baseline passes in the report', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    const report = checkRuns(baseline, [run('b', [result('c-1', 'FFNN', { historyDependent: '2 derived lines vs 1' })])], unchecked)
    expect(report.ok).toBe(true)
    expect(report.lost).toEqual([])
    expect(report.historyDependent).toEqual([{ id: 'c-1', family: 'test/family', now: '2 derived lines vs 1', inBaseline: false, baselinePasses: 'lbwp', currentPasses: '' }])
  })

  test('a case history-dependent when seeded holds no passes and never fails the gate', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP', { historyDependent: 'line 0: width 16px vs 13px' }), result('c-2', 'PPPP')])])
    expect(baseline.historyDependent).toEqual(['c-1'])
    expect(baseline.passes).toEqual({ lbwp: ['c-2'] })
    const report = checkRuns(baseline, [run('b', [result('c-1', 'FFFF'), result('c-2', 'PPPP')])], unchecked)
    expect(report.ok).toBe(true)
    expect(report.historyDependent.map(value => [value.id, value.inBaseline, value.now])).toEqual([['c-1', true, null]])
  })

  test('seeding keeps pairs that pass in every run; a pair passing in only some runs is unstable and never gates', () => {
    const baseline = seed([run('forward', [result('c-1', 'PPPP')]), run('reverse', [result('c-1', 'PPFP')])])
    expect(baseline.passes).toEqual({ lbp: ['c-1'] })
    expect(baseline.unstable).toEqual({ 'c-1': 'w' })
    expect(baseline.counts.unstablePairs).toBe(1)
    const failing = checkRuns(baseline, [run('b', [result('c-1', 'PPFP')])], unchecked)
    expect(failing.ok).toBe(true)
    expect(failing.unstable).toEqual([{ id: 'c-1', family: 'test/family', metric: 'widths', passesNow: false }])
    const passing = checkRuns(baseline, [run('b', [result('c-1', 'PPPP')])], unchecked)
    expect(passing.unstable.map(value => value.passesNow)).toEqual([true])
    expect(passing.newPasses).toEqual([])
  })

  test('a new pass needs every current run that observes the case to pass it', () => {
    const baseline = seed([run('a', [result('c-1', 'FFNF')])])
    const report = checkRuns(baseline, [run('forward', [result('c-1', 'PPPP')]), run('reverse', [result('c-1', 'PFNP')])], unchecked)
    expect(report.newPasses.map(value => value.metric)).toEqual(['lineCount', 'painter'])
  })
})

describe('runs the gate refuses', () => {
  test('another environment, another engine, or no history comparison', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    const problems = runProblems('blink', [
      run('newer', [result('c-1', 'PPPP')], { environments: ['DPR 2, scale 1, Chrome/154.0.0.0'] }),
      run('foreign', [result('c-2', 'PPPP', { browser: 'firefox' })]),
      run('single', [result('c-3', 'PPPP')], { compared: false }),
    ], { allowUncompared: false, environments: baseline.environments })
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('environment not in the baseline')
    expect(problems[1]).toContain('rows from firefox, not blink')
    expect(problems[2]).toContain('not scored with --native-compare')
    expect(runProblems('blink', [run('single', [result('c-3', 'PPPP')], { compared: false })], { allowUncompared: true, environments: baseline.environments })).toEqual([])
  })

  test('webkit-host and installed Safari runs share one WebKit baseline', () => {
    const safari = 'DPR 2, scale 1, Version/27.0 Safari/605.1.15'
    const host = `${safari} webkit-host/22625.1.29.11.27`
    const runs = [
      run('host', [result('c-1', 'PPPP', { browser: 'webkit-host' }), result('c-2', 'PPPP', { browser: 'webkit-host' })], { environments: [host] }),
      run('safari', [result('c-1', 'PPPP', { browser: 'safari' }), result('c-2', 'PPFP', { browser: 'safari' })], { environments: [safari] }),
    ]
    expect(runProblems('webkit', runs, { allowUncompared: false, environments: null })).toEqual([])
    expect(runProblems('blink', runs, { allowUncompared: false, environments: null })).toHaveLength(2)
    const baseline = seedBaseline(runs, { engine: 'webkit', engineVersion: 'Safari 27.0', note: '' })
    expect(baseline.environments).toEqual([safari, host])
    expect(baseline.passes).toEqual({ lbp: ['c-2'], lbwp: ['c-1'] })
    expect(baseline.unstable).toEqual({ 'c-2': 'w' })
  })
})

describe('files', () => {
  test('the baseline round-trips, with one case per line in sorted order', () => {
    const baseline = seed([run('a', [result('c-b', 'PPPP'), result('c-a', 'PPPP'), result('c-c', 'PFNN'), result('c-d', 'FFNU')])])
    expect(baseline.passes).toEqual({ l: ['c-c'], lbwp: ['c-a', 'c-b'] })
    expect(baseline.withoutPasses).toEqual(['c-d'])
    expect(baseline.counts).toEqual({ cases: 4, passPairs: { lineCount: 3, breaks: 2, widths: 2, painter: 2 }, historyDependentCases: 0, withoutPassesCases: 1, unstablePairs: 0 })
    const text = formatBaseline(baseline)
    expect(parseBaseline(text, 'test')).toEqual(baseline)
    expect(text.split('\n').filter(line => /^ {6}"c-[abc]",?$/.test(line))).toHaveLength(3)
  })

  test('a malformed baseline is rejected', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    expect(() => parseBaseline(JSON.stringify({ ...baseline, passes: { l: ['c-1'], lbwp: ['c-1'] } }), 'test')).toThrow('two metric combinations')
    expect(() => parseBaseline(JSON.stringify({ ...baseline, historyDependent: ['c-1'] }), 'test')).toThrow('both history-dependent and a pass')
    expect(() => parseBaseline(JSON.stringify({ ...baseline, withoutPasses: ['c-1'] }), 'test')).toThrow('listed without passes and elsewhere')
    expect(() => parseBaseline(JSON.stringify({ ...baseline, format: 'other' }), 'test')).toThrow('format')
    expect(() => parseBaseline(JSON.stringify({ ...baseline, passes: { lx: ['c-1'] } }), 'test')).toThrow('unknown metric letter')
  })

  test('a new seed names the pairs it loses and gains, leaving out history-dependent and one-sided cases', () => {
    const before = seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'PPPP'), result('c-3', 'FFNN')])])
    const after = seed([run('b', [result('c-1', 'PPFP'), result('c-2', 'FFFF', { historyDependent: 'x' }), result('c-3', 'PPPP'), result('c-4', 'PPPP')])])
    const diff = diffBaselines(before, after)
    expect(diff.lost).toEqual([['c-1', 'widths']])
    expect(diff.gained).toEqual([['c-3', 'lineCount'], ['c-3', 'breaks'], ['c-3', 'widths'], ['c-3', 'painter']])
    expect([diff.casesOnlyBefore, diff.casesOnlyAfter]).toEqual([0, 1])
  })

  test('a per-case file needs its own summary, unique ids and the same row count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-gate-test-'))
    const perCase = join(dir, 'chrome-per-case.ndjson')
    const row = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
      id, family: 'f', browser: 'chrome', lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: { status: 'unobserved', reason: 'r' }, painter: { status: 'pass' }, ...extra,
    })
    writeFileSync(perCase, `${row('c-1')}\n${row('c-2', { historyDependent: '2 derived lines vs 1' })}\n`)
    expect(() => readRun(perCase)).toThrow('no summary')
    const summary = (rows: number, compared: boolean): string => JSON.stringify({
      casesFile: '/cases.ndjson', nativeCompareFile: compared ? '/other-rows.ndjson' : null,
      browsers: { chrome: { rows, environments: { [CHROME]: rows }, historyDependent: { compared: compared ? rows : 0 } } },
    })
    writeFileSync(join(dir, 'chrome-summary.json'), summary(2, true))
    const value = readRun(perCase)
    expect(value.environments).toEqual([CHROME])
    expect(value.compared).toBe(true)
    expect(value.cases.map(entry => [entry.id, entry.metrics.widths.status, entry.historyDependent])).toEqual([['c-1', 'unobserved', null], ['c-2', 'unobserved', '2 derived lines vs 1']])
    writeFileSync(join(dir, 'chrome-summary.json'), summary(2, false))
    expect(readRun(perCase).compared).toBe(false)
    writeFileSync(join(dir, 'chrome-summary.json'), summary(3, true))
    expect(() => readRun(perCase)).toThrow('scored 3')
    expect(() => parsePerCase(`${row('c-1')}\n${row('c-1')}\n`, 'test')).toThrow('appears twice')
    expect(() => parsePerCase(row('c-1', { widths: { status: 'skipped' } }), 'test')).toThrow('unknown status')
  })
})
