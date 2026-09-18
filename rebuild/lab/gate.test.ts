import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRuns, diffBaselines, environmentParts, environmentProblem, formatBaseline, parseBaseline, parsePerCase, pruneProtocol, readRun, runProblems, seedBaseline, seedRecord, stagedPath, type Baseline, type CaseResult, type Coverage, type Run, type SeedRecord } from './gate.ts'
import type { Metric, MetricName, Status } from './score.ts'
import type { BrowserKind } from './types.ts'

const CODES: Record<string, Status> = { P: 'pass', F: 'fail', U: 'unobserved', N: 'not-applicable' }
const NAMES: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
const CHROME = 'chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 4'

// `codes` gives lineCount, breaks, widths and painter, each P, F, U or N.
function result(id: string, codes: string, options: { browser?: BrowserKind; historyDependent?: string; protocol?: string; coverage?: Coverage; residual?: string } = {}): CaseResult {
  const metrics = {} as Record<MetricName, Metric>
  for (let i = 0; i < NAMES.length; i++) {
    const status = CODES[codes[i]!]
    if (status === undefined) throw new Error(`bad codes ${codes}`)
    metrics[NAMES[i]!] = status === 'pass' ? { status } : { status, reason: `${status} here` }
  }
  return { id, family: 'test/family', browser: options.browser ?? 'chrome', metrics, historyDependent: options.historyDependent ?? null, protocol: options.protocol ?? null, coverage: options.coverage ?? {}, residual: options.residual ?? null }
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

describe('protocol rows', () => {
  const dropped = 'row 0\'s right float (inset 40) is at y 32, height 32; the row is at y 0'

  test('seeding lists a protocol row apart, never as a pass, and the gate never fails on one', () => {
    const baseline = seed([run('forward', [result('c-1', 'UUUU', { protocol: dropped }), result('c-2', 'PPPP')]), run('reverse', [result('c-1', 'PPPP'), result('c-2', 'PPPP')])])
    expect(baseline.protocol).toEqual({ 'c-1': dropped })
    expect(baseline.passes).toEqual({ lbwp: ['c-2'] })
    expect(baseline.counts.protocolCases).toBe(1)
    const report = checkRuns(baseline, [run('b', [result('c-1', 'FFFF'), result('c-2', 'PPPP')])], unchecked)
    expect(report.ok).toBe(true)
    expect(report.protocol).toEqual([{ id: 'c-1', family: 'test/family', now: null, inBaseline: true, baselinePasses: '' }])
    expect(report.newPasses).toEqual([])
  })

  test('a baseline pass that a current run marks as a protocol row isn\'t a loss', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    const report = checkRuns(baseline, [run('b', [result('c-1', 'UUUU', { protocol: dropped })])], unchecked)
    expect([report.ok, report.counts.protocolCases, report.protocol[0]!.baselinePasses]).toEqual([true, 1, 'lbwp'])
  })

  test('pruning moves protocol rows out of passes, cases without passes and unstable pairs, and names every removed pair', () => {
    const before = seed([run('forward', [result('c-1', 'PPPP'), result('c-2', 'FFNN'), result('c-3', 'PPPP')]), run('reverse', [result('c-1', 'PPFP'), result('c-2', 'FFNN'), result('c-3', 'PPPP')])])
    const { baseline, removed } = pruneProtocol(before, new Map([['c-1', dropped], ['c-2', dropped], ['c-9', dropped]]))
    expect(removed.map(value => [value.id, value.metric])).toEqual([['c-1', 'lineCount'], ['c-1', 'breaks'], ['c-1', 'painter']])
    expect(baseline.passes).toEqual({ lbwp: ['c-3'] })
    expect([baseline.withoutPasses, baseline.unstable, Object.keys(baseline.protocol!)]).toEqual([[], {}, ['c-1', 'c-2']])
    expect(baseline.counts).toMatchObject({ passPairs: { lineCount: 1, breaks: 1, widths: 1, painter: 1 }, withoutPassesCases: 0, unstablePairs: 0, protocolCases: 2 })
    expect(parseBaseline(formatBaseline(baseline), 'test')).toEqual(baseline)
    expect(() => parseBaseline(JSON.stringify({ ...baseline, protocol: { 'c-3': dropped } }), 'test')).toThrow('listed elsewhere')
  })
})

describe('runs the gate refuses', () => {
  test('another environment, another engine, or no history comparison', () => {
    const baseline = seed([run('a', [result('c-1', 'PPPP')])])
    const problems = runProblems('blink', [
      run('newer', [result('c-1', 'PPPP')], { environments: [CHROME.replace('153.0.8010.48', '154.0.0.1')] }),
      run('foreign', [result('c-2', 'PPPP', { browser: 'firefox' })]),
      run('single', [result('c-3', 'PPPP')], { compared: false }),
    ], { allowUncompared: false, environments: baseline.environments })
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('browser build or device not in the baseline')
    expect(problems[1]).toContain('rows from firefox, not blink')
    expect(problems[2]).toContain('not scored with --native-compare')
    expect(runProblems('blink', [run('single', [result('c-3', 'PPPP')], { compared: false })], { allowUncompared: true, environments: baseline.environments })).toEqual([])
  })

  test('environments compare part by part: process languages must match the baseline\'s recorded languages', () => {
    expect(environmentParts(CHROME)).toEqual({ build: 'chrome: Google Chrome 153.0.8010.48, engine build 153.0.8010.48, macOS 26A428', device: 'DPR 2, scale 1', languages: 'uiLanguage zh-CN', scorer: 'scorer 4' })
    expect(environmentParts('DPR 2, scale 1, Chrome/153.0.0.0')).toEqual({ build: 'DPR 2, scale 1, Chrome/153.0.0.0', device: '', languages: null, scorer: null })
    expect(environmentProblem(CHROME, [CHROME])).toBeNull()
    expect(environmentProblem(CHROME.replace('zh-CN', 'en-US'), [CHROME])).toContain('process languages uiLanguage en-US don\'t match the baseline\'s recorded languages (uiLanguage zh-CN)')
    // A baseline seeded from rows that recorded no languages accepts no run that does.
    expect(environmentProblem(CHROME, [CHROME.replace('; uiLanguage zh-CN', '')])).toContain('(none recorded)')
    expect(environmentProblem(CHROME.replace('scorer 4', 'scorer 3'), [CHROME])).toContain('scorer 3 against the baseline\'s scorer 4: re-score')
  })

  test('seeding refuses runs whose environment records no process languages', () => {
    const problems = runProblems('blink', [run('old', [result('c-1', 'PPPP')], { environments: [CHROME.replace('; uiLanguage zh-CN', '')] })], { allowUncompared: false, environments: null })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('records no process languages')
  })

  test('seeding refuses runs scored by different scorers', () => {
    const runs = [run('forward', [result('c-1', 'PPPP')]), run('reverse', [result('c-1', 'PPPP')], { environments: [CHROME.replace('scorer 4', 'scorer 5')] })]
    expect(runProblems('blink', runs, { allowUncompared: false, environments: null })).toEqual(['the seeding runs were scored by different scorers (scorer 4, scorer 5): re-score them with one'])
  })

  test('webkit-host and installed Safari runs share one WebKit baseline', () => {
    const safari = 'safari: Safari 27.0, engine build 22625.1.29.11.27, macOS 26A428; DPR 2, scale 1; preferredLanguages zh-CN,zh-Hans, icuDefaultLocale en_US_POSIX; scorer 4'
    const host = safari.replace('safari: Safari 27.0', 'webkit-host: webkit-host 27.0')
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
    expect(baseline.counts).toEqual({ cases: 4, passPairs: { lineCount: 3, breaks: 2, widths: 2, painter: 2 }, historyDependentCases: 0, withoutPassesCases: 1, unstablePairs: 0, protocolCases: 0 })
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

  test('a new seed names the pairs it loses and gains, leaving out history-dependent, protocol and one-sided cases', () => {
    const before = seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'PPPP'), result('c-3', 'FFNN'), result('c-5', 'PPPP')])])
    const after = seed([run('b', [result('c-1', 'PPFP'), result('c-2', 'FFFF', { historyDependent: 'x' }), result('c-3', 'PPPP'), result('c-4', 'PPPP'), result('c-5', 'UUUU', { protocol: 'y' })])])
    const diff = diffBaselines(before, after)
    expect(diff.lost).toEqual([['c-1', 'widths']])
    expect(diff.gained).toEqual([['c-3', 'lineCount'], ['c-3', 'breaks'], ['c-3', 'widths'], ['c-3', 'painter']])
    expect([diff.casesOnlyBefore, diff.casesOnlyAfter]).toEqual([0, 1])
    // The passes of c-2 and c-5 aren't lost, and they no longer gate: they are listed apart.
    expect(diff.leftThroughHistory).toEqual([['c-2', 'lineCount'], ['c-2', 'breaks'], ['c-2', 'widths'], ['c-2', 'painter']])
    expect(diff.leftThroughProtocol).toEqual([['c-5', 'lineCount'], ['c-5', 'breaks'], ['c-5', 'widths'], ['c-5', 'painter']])
  })

  test('the seed record lists every lost pair with its covering gaps, and the pairs that leave through new history dependence', () => {
    const before = seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'PPPP'), result('c-3', 'PPPP'), result('c-4', 'PPFP', { historyDependent: 'was already' })])])
    const runs = [
      run('forward', [
        result('c-1', 'PPFP', { coverage: { widths: { covered: true, gaps: ['in-word-prefix'] } } }),
        result('c-2', 'PPPP', { historyDependent: 'code point 3: [x, width, line] [0,8,1] vs [0,8,2]' }),
        result('c-3', 'PPFF', { coverage: { widths: { covered: false, gaps: [] } }, residual: 'gecko/one-shaping-unit-one-app-unit (signature)' }),
        result('c-4', 'PPPP', { historyDependent: 'still' }),
      ]),
      run('reverse', [result('c-1', 'PPPP'), result('c-2', 'PPFP'), result('c-3', 'PPFF'), result('c-4', 'PPPP')]),
    ]
    const record = seedRecord(before, seed(runs), runs, { staged: 'staged/gate.json', against: 'baselines/gate.json' })
    expect(record.lost).toEqual([
      { id: 'c-1', family: 'test/family', metric: 'widths', status: 'fail', reason: 'fail here', detail: null, run: expect.stringContaining('forward-per-case.ndjson'), covered: true, coveringGaps: ['in-word-prefix'], residual: null, attribution: null },
      { id: 'c-3', family: 'test/family', metric: 'widths', status: 'fail', reason: 'fail here', detail: null, run: expect.stringContaining('forward-per-case.ndjson'), covered: false, coveringGaps: [], residual: 'gecko/one-shaping-unit-one-app-unit (signature)', attribution: null },
      { id: 'c-3', family: 'test/family', metric: 'painter', status: 'fail', reason: 'fail here', detail: null, run: expect.stringContaining('forward-per-case.ndjson'), covered: false, coveringGaps: [], residual: 'gecko/one-shaping-unit-one-app-unit (signature)', attribution: null },
    ])
    // c-2 is history-dependent only now: its four baseline passes leave without failing; widths doesn't pass in every run.
    expect(record.leftThroughHistory.map(value => [value.id, value.metric, value.passesNow])).toEqual([['c-2', 'lineCount', true], ['c-2', 'breaks', true], ['c-2', 'widths', false], ['c-2', 'painter', true]])
    expect(record.leftThroughHistory[0]!.difference).toBe('code point 3: [x, width, line] [0,8,1] vs [0,8,2]')
    expect(seedRecord(null, seed(runs), runs, { staged: 'staged/gate.json', against: null })).toMatchObject({ against: null, lost: [], leftThroughHistory: [] })
    // A check against the old baseline counts those pairs too.
    expect(checkRuns(before, runs, unchecked).counts.leftThroughHistoryPairs).toBe(4)
  })

  test('a seed goes to a staging folder, never over the baseline', () => {
    expect(() => stagedPath('/repo/baselines/gate-chrome.json', undefined)).toThrow('--staging=<dir> is required')
    expect(() => stagedPath('/repo/baselines/gate-chrome.json', '/repo/baselines')).toThrow('the folder the baseline is in')
    expect(stagedPath('/repo/baselines/gate-chrome.json', '/repo/baselines/staged-round3')).toBe('/repo/baselines/staged-round3/gate-chrome.json')
    // The command line: the adopted baseline stays as it is, and the staged seed comes with its record.
    const dir = mkdtempSync(join(tmpdir(), 'lab-gate-seed-'))
    const row = (id: string, widths: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
      id, family: 'f', browser: 'chrome', lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: { status: widths }, painter: { status: 'pass' }, ...extra,
    })
    const perCase = join(dir, 'chrome-per-case.ndjson')
    writeFileSync(perCase, `${row('c-1', 'fail', { lineGaps: { widths: { lines: [{ nativeLine: 0, engineLine: 0, gaps: [{ gap: 'script-context', scope: 'line', touch: 'unit' }] }], covered: true, paragraphGaps: [] } } })}\n${row('c-2', 'pass', { historyDependent: '2 native lines vs 1' })}\n`)
    writeFileSync(join(dir, 'chrome-summary.json'), JSON.stringify({ casesFile: '/cases.ndjson', nativeCompareFile: '/other-rows.ndjson', browsers: { chrome: { rows: 2, environments: { [CHROME]: 2 }, historyDependent: { compared: 2 } } } }))
    const adopted = join(dir, 'gate-chrome.json')
    const adoptedText = formatBaseline(seed([run('a', [result('c-1', 'PPPP'), result('c-2', 'PPPP')])]))
    writeFileSync(adopted, adoptedText)
    const script = join(import.meta.dir, 'gate.ts')
    const common = ['--seed', '--engine=blink', '--engine-version=Chrome 153', `--baseline=${adopted}`, `--runs=${perCase}`]
    expect(Bun.spawnSync(['bun', script, ...common]).exitCode).toBe(2)
    expect(Bun.spawnSync(['bun', script, ...common, `--staging=${dir}`]).exitCode).toBe(2)
    const staging = join(dir, 'staged')
    const seeded = Bun.spawnSync(['bun', script, ...common, `--staging=${staging}`])
    expect(seeded.exitCode).toBe(0)
    expect(readFileSync(adopted, 'utf8')).toBe(adoptedText)
    expect(parseBaseline(readFileSync(join(staging, 'gate-chrome.json'), 'utf8'), 'staged').passes).toEqual({ lbp: ['c-1'] })
    const record = JSON.parse(readFileSync(join(staging, 'gate-chrome.seed-record.json'), 'utf8')) as SeedRecord
    expect(record.lost.map(value => [value.id, value.metric, value.covered, value.coveringGaps])).toEqual([['c-1', 'widths', true, ['script-context']]])
    expect(record.leftThroughHistory.map(value => `${value.id} ${value.metric}`)).toEqual(['c-2 lineCount', 'c-2 breaks', 'c-2 widths', 'c-2 painter'])
    expect(existsSync(join(dir, 'gate-chrome.seed-record.json'))).toBe(false)
  })

  test('a per-case file needs its own summary, unique ids and the same row count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-gate-test-'))
    const perCase = join(dir, 'chrome-per-case.ndjson')
    const row = (id: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
      id, family: 'f', browser: 'chrome', lineCount: { status: 'pass' }, breaks: { status: 'pass' }, widths: { status: 'unobserved', reason: 'r' }, painter: { status: 'pass' }, ...extra,
    })
    writeFileSync(perCase, `${row('c-1')}\n${row('c-2', { historyDependent: '2 derived lines vs 1' })}\n${row('c-3', { protocol: 'row 0 float' })}\n`)
    expect(() => readRun(perCase)).toThrow('no summary')
    const summary = (rows: number, compared: boolean): string => JSON.stringify({
      casesFile: '/cases.ndjson', nativeCompareFile: compared ? '/other-rows.ndjson' : null,
      browsers: { chrome: { rows, environments: { [CHROME]: rows }, historyDependent: { compared: compared ? rows : 0 } } },
    })
    writeFileSync(join(dir, 'chrome-summary.json'), summary(3, true))
    const value = readRun(perCase)
    expect(value.environments).toEqual([CHROME])
    expect(value.compared).toBe(true)
    expect(value.cases.map(entry => [entry.id, entry.metrics.widths.status, entry.historyDependent, entry.protocol])).toEqual([['c-1', 'unobserved', null, null], ['c-2', 'unobserved', '2 derived lines vs 1', null], ['c-3', 'unobserved', null, 'row 0 float']])
    writeFileSync(join(dir, 'chrome-summary.json'), summary(3, false))
    expect(readRun(perCase).compared).toBe(false)
    writeFileSync(join(dir, 'chrome-summary.json'), summary(4, true))
    expect(() => readRun(perCase)).toThrow('scored 4')
    expect(() => parsePerCase(`${row('c-1')}\n${row('c-1')}\n`, 'test')).toThrow('appears twice')
    expect(() => parsePerCase(row('c-1', { widths: { status: 'skipped' } }), 'test')).toThrow('unknown status')
  })
})
