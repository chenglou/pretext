// The known-status ledger's rules (ledger.ts): the closed set of statuses, history dependence, like with like, and lift
// over prediction failures alone.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GapFiring, MetricAttribution } from '../lab/score.ts'
import { buildLedger, carryHistory, conditionsOf, entryOf, exactOf, incomparable, readLedger, statusOf, transitionsBetween, writeLedger, LEDGER_FORMAT, type Differing, type Ledger, type LedgerEntry, type LedgerHeader, type PerCase, type SetsRun } from './ledger.ts'
import type { SetProtocol } from './sets.ts'

const pass = { status: 'pass' }
const fail = { status: 'fail', reason: 'width differs' }
// A row whose compared values all equal the browser's, unless `over` says otherwise: 4 rect counts, 8 predicted values.
const per = (id: string, over: Partial<PerCase> = {}): PerCase => ({ id, family: 'test/family', lineCount: pass, breaks: pass, widths: pass, painter: pass, facts: { counts: [4, 0], predicted: [8, 0] }, ...over })
const facts = (values: number, rectCounts = 0): NonNullable<PerCase['facts']> => ({ counts: [4 - rectCounts, rectCounts], predicted: [8 - values, values] })
const attribution = (covered: boolean, gaps: string[], engineLine = 0, limits: string[] = [], fires: string[] = gaps): MetricAttribution => ({
  covered, paragraphGaps: [],
  lines: [{ nativeLine: engineLine, engineLine, gaps: gaps.map(gap => ({ gap, scope: 'line' })), ...(limits.length === 0 ? {} : { limits }), fires }] as MetricAttribution['lines'],
})

describe('one status from a closed set', () => {
  test('pass, covered, open, residual, unobserved', () => {
    expect(statusOf(per('c-1'), 'widths')).toBe('pass')
    expect(statusOf(per('c-1', { widths: fail, lineGaps: { widths: attribution(true, ['in-word-prefix', 'font-fallback']) } }), 'widths')).toBe('fail covered by font-fallback+in-word-prefix')
    expect(statusOf(per('c-1', { widths: fail, lineGaps: { widths: attribution(false, []) } }), 'widths')).toBe('fail open')
    expect(statusOf(per('c-1', { widths: fail }), 'widths')).toBe('fail open')
    const residual = { name: 'gecko/one-shaping-unit-one-app-unit', membership: 'probed' as const, detail: '' }
    expect(statusOf(per('c-1', { widths: fail, residual, lineGaps: { widths: attribution(false, []) } }), 'widths')).toBe('residual gecko/one-shaping-unit-one-app-unit (probed)')
    // A covered failure of a residual member is covered; the painter is never a residual member.
    expect(statusOf(per('c-1', { widths: fail, residual, lineGaps: { widths: attribution(true, ['in-word-prefix']) } }), 'widths')).toBe('fail covered by in-word-prefix')
    expect(statusOf(per('c-1', { painter: fail, residual }), 'painter')).toBe('fail open')
    expect(statusOf(per('c-1', { widths: { status: 'unobserved' } }), 'widths')).toBe('unobserved')
    expect(statusOf(per('c-1', { widths: { status: 'not-applicable' } }), 'widths')).toBe('unobserved')
  })

  test('a painter limit is a condition of the painter\'s', () => {
    expect(statusOf(per('c-1', { painter: fail, lineGaps: { painter: attribution(true, ['script-context'], 0, ['edge-inside-shaped-text']) } }), 'painter')).toBe('fail covered by limit:edge-inside-shaped-text+script-context')
  })

  test('history-dependent cases and protocol rows are neither passes nor failures, on every metric', () => {
    const history = per('c-1', { widths: fail, historyDependent: '2 native lines vs 3' })
    expect(entryOf('runs', history, history).status).toEqual({ lineCount: 'history-dependent', breaks: 'history-dependent', widths: 'history-dependent', painter: 'history-dependent' })
    expect(statusOf(per('c-1', { protocol: 'a float moved' }), 'lineCount')).toBe('protocol row')
  })

  test('a metric the two orders score differently on equal native layouts depends on history too', () => {
    const entry = entryOf('runs', per('c-1'), per('c-1', { widths: fail, lineGaps: { widths: attribution(false, []) } }))
    expect(entry.status).toEqual({ lineCount: 'pass', breaks: 'pass', widths: 'history-dependent', painter: 'pass' })
    // A failure both orders have, under other conditions, keeps the forward order's conditions.
    const covered = (gaps: string[]): PerCase => per('c-1', { widths: fail, lineGaps: { widths: attribution(true, gaps) } })
    expect(entryOf('runs', covered(['in-word-prefix']), covered(['in-word-prefix', 'page-history'])).status.widths).toBe('fail covered by in-word-prefix')
  })

  test('a failure keeps the scorer\'s reason', () => {
    expect(entryOf('runs', per('c-1', { widths: fail }), null)).toEqual({ set: 'runs', id: 'c-1', family: 'test/family', status: { lineCount: 'pass', breaks: 'pass', widths: 'fail open', painter: 'pass' }, exact: 'exact', reason: { widths: 'width differs' } })
  })
})

describe('the exact-value status, beside the metrics', () => {
  test('exact, not exact with its numbers, unobserved; history-dependent cases and protocol rows as for the metrics', () => {
    expect(exactOf(per('c-1'))).toEqual({ exact: 'exact' })
    expect(exactOf(per('c-1', { facts: facts(2) }))).toEqual({ exact: 'not exact (values 2, rect counts 0)', differing: { values: 2, rectCounts: 0 } })
    expect(exactOf(per('c-1', { facts: facts(0, 1) }))).toEqual({ exact: 'not exact (values 0, rect counts 1)', differing: { values: 0, rectCounts: 1 } })
    // The scorer compared nothing: no prediction, or no native observation.
    const { facts: _compared, ...uncompared } = per('c-1')
    expect(exactOf(uncompared)).toEqual({ exact: 'unobserved' })
    expect(exactOf(per('c-1', { facts: facts(2), historyDependent: 'moved' }))).toEqual({ exact: 'history-dependent' })
    expect(exactOf(per('c-1', { facts: facts(2), protocol: 'a float moved' }))).toEqual({ exact: 'protocol row' })
  })

  test('it is no part of a metric: a case can pass every metric and hold a wrong predicted value, and fail one and be exact', () => {
    const passing = entryOf('runs', per('c-1', { facts: facts(3) }), per('c-1', { facts: facts(3) }))
    expect(passing.status).toEqual({ lineCount: 'pass', breaks: 'pass', widths: 'pass', painter: 'pass' })
    expect([passing.exact, passing.differing]).toEqual(['not exact (values 3, rect counts 0)', { values: 3, rectCounts: 0 }])
    const failing = entryOf('runs', per('c-2', { widths: fail }), null)
    expect([failing.status.widths, failing.exact, failing.differing]).toEqual(['fail open', 'exact', undefined])
  })

  test('two orders that disagree on exactness over equal native layouts depend on history; two that both aren\'t exact keep the forward numbers', () => {
    expect(entryOf('runs', per('c-1'), per('c-1', { facts: facts(1) })).exact).toBe('history-dependent')
    expect(entryOf('runs', per('c-1', { facts: facts(1) }), per('c-1')).differing).toBeUndefined()
    expect(entryOf('runs', per('c-1', { facts: facts(1) }), per('c-1', { facts: facts(2) }))).toMatchObject({ exact: 'not exact (values 1, rect counts 0)', differing: { values: 1, rectCounts: 0 } })
  })
})

const protocol: SetProtocol = { set: 'runs', parts: [{ casesFile: 'runs.ndjson', casesSha256: 'abc' }], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }
const ENVIRONMENT = 'chrome: Google Chrome 153.0.8010.50, engine build 153.0.8010.50, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 6'
const header = (over: Partial<LedgerHeader> = {}): LedgerHeader => ({
  format: LEDGER_FORMAT, browser: 'chrome', config: 'no-facts', predictor: 'p.ts', build: { app: 'Google Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: '26A428' },
  environments: [ENVIRONMENT], scorer: 6, bundles: ['b1'], library: null, orders: 'both',
  historyCarriedFrom: null, sets: { runs: { protocol, subset: false, cases: 2, environments: [ENVIRONMENT], evidence: [] } }, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
  exact: { counts: {}, rectCounts: 0, rectCountsDiffering: 0, predictedValues: 0, predictedValuesDiffering: 0, passingWithDifferingValues: 0, passingWithDifferingRectCounts: 0 }, ...over,
})
const entry = (id: string, widths: string, family = 'test/family'): LedgerEntry => ({ set: 'runs', id, family, status: { lineCount: 'pass', breaks: 'pass', widths, painter: 'pass' }, exact: 'exact' })
// An entry that passes every metric, with an exact-value status.
const valued = (id: string, exact: string, differing?: Differing): LedgerEntry => ({ ...entry(id, 'pass'), exact, ...(differing === undefined ? {} : { differing }) })
const notExact = (id: string, values: number, rectCounts = 0): LedgerEntry => valued(id, `not exact (values ${values}, rect counts ${rectCounts})`, { values, rectCounts })
const ledger = (entries: LedgerEntry[], over: Partial<LedgerHeader> = {}): Ledger => ({ header: header(over), entries })

describe('transitions', () => {
  test('every change of status is a transition, grouped by metric, kind and family; a lost pass blocks', () => {
    const report = transitionsBetween(
      ledger([entry('c-1', 'pass'), entry('c-2', 'fail covered by in-word-prefix'), entry('c-3', 'fail open', 'other/family'), entry('c-4', 'pass')]),
      ledger([entry('c-1', 'fail open'), entry('c-2', 'fail open'), entry('c-3', 'pass', 'other/family'), entry('c-4', 'pass')]), [])
    expect(report.comparable).toEqual([])
    expect([report.compared, report.transitions.length, report.blocking]).toEqual([4, 3, 1])
    expect(report.grouped.widths).toEqual({
      'pass -> fail open': { 'test/family': ['c-1'] },
      // A failure that was never in scope is visible when it moves.
      'fail covered by in-word-prefix -> fail open': { 'test/family': ['c-2'] },
      'fail open -> pass': { 'other/family': ['c-3'] },
    })
  })

  test('a pass that turns history-dependent or into a protocol row doesn\'t block', () => {
    const report = transitionsBetween(ledger([entry('c-1', 'pass'), entry('c-2', 'pass')]), ledger([entry('c-1', 'history-dependent'), entry('c-2', 'protocol row')]), [])
    expect([report.transitions.length, report.blocking]).toEqual([2, 0])
  })

  test('a case that goes from exact to not exact is a transition of its own and blocks, while every metric still passes', () => {
    const report = transitionsBetween(
      ledger([valued('c-1', 'exact'), valued('c-2', 'exact'), notExact('c-3', 2), notExact('c-4', 2, 1), notExact('c-5', 2), valued('c-6', 'exact'), valued('c-7', 'unobserved'), valued('c-8', 'exact')]),
      ledger([notExact('c-1', 3), valued('c-2', 'exact'), notExact('c-3', 5), notExact('c-4', 1, 1), valued('c-5', 'exact'), valued('c-6', 'history-dependent'), notExact('c-7', 1), valued('c-8', 'unobserved')]), [])
    // No metric moved, so nothing blocks by the metrics' rule.
    expect([report.blocking, report.transitions.every(value => value.metric === 'exact')]).toEqual([0, true])
    expect(report.grouped.exact).toEqual({
      'exact -> not exact (values 3, rect counts 0)': { 'test/family': ['c-1'] },
      // More differing values in a case that wasn't exact blocks too; fewer, or none, don't.
      'not exact (values 2, rect counts 0) -> not exact (values 5, rect counts 0)': { 'test/family': ['c-3'] },
      'not exact (values 2, rect counts 1) -> not exact (values 1, rect counts 1)': { 'test/family': ['c-4'] },
      'not exact (values 2, rect counts 0) -> exact': { 'test/family': ['c-5'] },
      // As for a pass: history dependence doesn't block, and nothing left to compare does.
      'exact -> history-dependent': { 'test/family': ['c-6'] },
      'unobserved -> not exact (values 1, rect counts 0)': { 'test/family': ['c-7'] },
      'exact -> unobserved': { 'test/family': ['c-8'] },
    })
    expect(report.exactBlocking).toBe(3)
    expect([report.differingBefore, report.differingAfter]).toEqual([{ values: 6, rectCounts: 1 }, { values: 10, rectCounts: 1 }])
  })

  test('limited values that stop agreeing are reported and never block: without facts most values are limited', () => {
    const limited = (id: string, n: number): LedgerEntry => ({ ...valued(id, 'exact'), ...(n === 0 ? {} : { limitedDiffering: n }) })
    const report = transitionsBetween(ledger([limited('c-1', 0), limited('c-2', 3), limited('c-3', 4)]), ledger([limited('c-1', 5), limited('c-2', 3), limited('c-3', 1)]), [])
    expect(report.limitedDiffering).toEqual({ before: 7, after: 9, rose: ['runs/c-1'] })
    expect([report.transitions.length, report.blocking, report.exactBlocking]).toEqual([0, 0, 0])
    // An entry keeps the forward order's count of differing limited values, under whatever gaps.
    expect(entryOf('runs', per('c-1', { facts: { counts: [4, 0], predicted: [8, 0], limited: { 'optical-size': [10, 2], 'in-word-prefix': [0, 1] } } }), null)).toMatchObject({ exact: 'exact', limitedDiffering: 3 })
    expect(entryOf('runs', per('c-1'), null).limitedDiffering).toBeUndefined()
  })

  test('more differing rect counts block like more differing values', () => {
    expect(transitionsBetween(ledger([notExact('c-1', 2, 1)]), ledger([notExact('c-1', 1, 2)]), []).exactBlocking).toBe(1)
  })

  test('another browser build, scorer, configuration or protocol is refused by name, and allowed only knowingly', () => {
    const other = { app: 'Google Chrome', appVersion: '154.0.1.2', engine: '154.0.1.2', os: '26A428' }
    expect(incomparable(header(), header({ build: other })).map(problem => problem.name)).toEqual(['build'])
    expect(incomparable(header(), header({ scorer: 7 })).map(problem => problem.name)).toEqual(['scorer'])
    expect(incomparable(header(), header({ config: 'facts' })).map(problem => problem.name)).toEqual(['config'])
    // Process languages compare set by set: a set can run under a locale of its own, and a run of other sets says nothing of it.
    const otherLanguages = header({ sets: { runs: { protocol, subset: false, cases: 2, environments: [ENVIRONMENT.replace('zh-CN', 'en-US')], evidence: [] } } })
    expect(incomparable(header(), otherLanguages).map(problem => problem.name)).toEqual(['languages'])
    const moreSets = header({ sets: { ...header().sets, 'features-en-US': { protocol, subset: false, cases: 1, environments: [ENVIRONMENT.replace('zh-CN', 'en-US')], evidence: [] } } })
    expect(incomparable(moreSets, header())).toEqual([])
    // The run protocol: another cut into parts, other case files or cases per round trip move history-dependent cases.
    const recut = header({ sets: { runs: { protocol: { ...protocol, casesPerRoundTrip: 1 }, subset: false, cases: 2, environments: [ENVIRONMENT], evidence: [] } } })
    expect(incomparable(header(), recut).map(problem => problem.name)).toEqual(['protocol'])
    const refused = transitionsBetween(ledger([entry('c-1', 'pass')]), ledger([entry('c-1', 'fail open')], { build: other }), [])
    expect([refused.comparable.length, refused.transitions.length]).toEqual([1, 0])
    expect(transitionsBetween(ledger([entry('c-1', 'pass')]), ledger([entry('c-1', 'fail open')], { build: other }), ['build']).transitions.length).toBe(1)
  })

  test('a run of some cases isn\'t missing the others', () => {
    const subset = header({ sets: { runs: { protocol, subset: true, cases: 1, environments: [ENVIRONMENT], evidence: [] } } })
    const report = transitionsBetween(ledger([entry('c-1', 'pass'), entry('c-2', 'pass')]), { header: subset, entries: [entry('c-1', 'pass')] }, [])
    expect([report.comparable, report.onlyBefore]).toEqual([[], 0])
    expect(transitionsBetween(ledger([entry('c-1', 'pass'), entry('c-2', 'pass')]), ledger([entry('c-1', 'pass')]), []).onlyBefore).toBe(1)
  })
})

describe('history dependence carried into a forward-only ledger', () => {
  test('the reference\'s history-dependent statuses replace the forward run\'s, and are marked', () => {
    const forward = [entry('c-1', 'fail open'), entry('c-2', 'fail open')]
    const carried = carryHistory(forward, [entry('c-1', 'history-dependent'), entry('c-2', 'pass')])
    expect(carried).toBe(1)
    expect(forward[0]).toMatchObject({ status: { widths: 'history-dependent' }, historyCarried: true })
    expect(forward[1]!.status.widths).toBe('fail open')
    // The exact-value status is carried the same way, without the forward run's numbers.
    const values = [notExact('c-1', 2), notExact('c-2', 2)]
    expect(carryHistory(values, [valued('c-1', 'history-dependent'), valued('c-2', 'exact')])).toBe(1)
    expect([values[0]!.exact, values[0]!.differing, values[0]!.historyCarried, values[1]!.exact]).toEqual(['history-dependent', undefined, true, 'not exact (values 2, rect counts 0)'])
    // So a known history-dependent case never shows as a regression of a forward-only run.
    expect(transitionsBetween(ledger([entry('c-1', 'history-dependent'), entry('c-2', 'pass')]), ledger(forward), []).transitions.map(value => value.id)).toEqual(['c-2'])
  })
})

describe('conditions', () => {
  test('lift is over prediction failures alone; painter-only failures are counted apart; weak coverage follows', () => {
    const firing = (gaps: Record<string, number>): GapFiring => ({ lines: 10, gaps })
    const cases: PerCase[] = [
      // 30 passing lines: `broad` fires on 20 of them, `narrow` on 1.
      per('c-1', { firing: firing({ broad: 10, narrow: 1 }) }),
      per('c-2', { firing: firing({ broad: 10 }) }),
      // A painter-only failure: its passing lines count, its failing line doesn't enter the lift.
      per('c-3', { painter: fail, firing: firing({}), lineGaps: { painter: attribution(true, ['broad']) } }),
      // Two prediction failures, one line each: one covered only by `broad`, one by `narrow`.
      per('c-4', { widths: fail, firing: firing({}), lineGaps: { widths: attribution(true, ['broad']) } }),
      per('c-5', { widths: fail, firing: firing({}), lineGaps: { widths: attribution(true, ['narrow']) } }),
      // History-dependent cases and protocol rows are outside.
      per('c-6', { widths: fail, historyDependent: 'moved' }),
    ]
    const report = conditionsOf(cases, ['runs'])
    expect([report.passingCases, report.passingLines, report.failingLines, report.painterOnlyFailingLines, report.predictionFailures, report.painterOnlyFailures]).toEqual([3, 30, 2, 1, 2, 1])
    const broad = report.conditions.find(row => row.condition === 'broad')!
    const narrow = report.conditions.find(row => row.condition === 'narrow')!
    // broad: half of the failing lines over two thirds of the passing lines; narrow: half over a thirtieth.
    expect([broad.lift, broad.painterOnlyFailingLines, narrow.lift]).toEqual([0.75, 1, 15])
    expect([report.coveredPredictionFailures, report.weaklyCoveredPredictionFailures, broad.weaklyCoveredOnly, narrow.weaklyCoveredOnly]).toEqual([2, 1, 1, 0])
  })
})

describe('a ledger from a browser-sets run', () => {
  // One set of two parts, both orders, as browser-sets.ts leaves them; `bundles` are the parts' library bundles.
  function runFolder(bundles: [string, string]): string {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-run-'))
    const environment = header().environments[0]!
    const parts: SetsRun['sets'][number]['parts'] = []
    for (let k = 0; k < 2; k++) {
      for (const order of ['forward', 'reverse']) {
        const folder = join(dir, 'runs/runs', order, `part${k}`)
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, 'chrome-run.json'), JSON.stringify({ status: 'ok', runId: `${order}-${k}`, bundleSha256: bundles[k], startedAt: '2026-09-18T00:00:00.000Z' }))
        writeFileSync(join(folder, 'chrome-summary.json'), JSON.stringify({ scorer: 6, browsers: { chrome: { environments: { [environment]: 1 } } } }))
        // Part 1's case fails widths in the reverse order only, on the same native layout.
        const widths = k === 1 && order === 'reverse' ? fail : pass
        // Part 0's case passes every metric and holds two wrong predicted values, in both orders.
        writeFileSync(join(folder, 'chrome-per-case.ndjson'), `${JSON.stringify(per(`c-${k}`, { widths, ...(k === 0 ? { facts: facts(2) } : {}) }))}\n`)
      }
      parts.push({ part: k, forward: join(dir, 'runs/runs/forward', `part${k}`), reverse: join(dir, 'runs/runs/reverse', `part${k}`) })
    }
    const run: SetsRun = { browser: 'chrome', config: 'no-facts', predictor: 'p.ts', build: header().build, orders: 'both', sets: [{ name: 'runs', protocol, subset: false, parts }] }
    writeFileSync(join(dir, 'sets-run.json'), JSON.stringify(run))
    return dir
  }

  test('every case gets its statuses, and every part\'s runs are the evidence', () => {
    const built = buildLedger(runFolder(['b1', 'b1']), null)
    expect(built.entries.map(value => [value.id, value.status.widths])).toEqual([['c-0', 'pass'], ['c-1', 'history-dependent']])
    expect(built.header).toMatchObject({ scorer: 6, orders: 'both', bundles: ['b1'], counts: { widths: { pass: 1, 'history-dependent': 1 } } })
    expect(built.header.sets['runs']!.evidence.map(value => [value.part, value.order, value.runId])).toEqual([[0, 'forward', 'forward-0'], [0, 'reverse', 'reverse-0'], [1, 'forward', 'forward-1'], [1, 'reverse', 'reverse-1']])
  })

  test('the exact-value statuses and the values behind them are in the entries and the header, and survive the files', () => {
    const built = buildLedger(runFolder(['b1', 'b1']), null)
    expect(built.entries.map(value => [value.id, value.exact, value.differing ?? null])).toEqual([['c-0', 'not exact (values 2, rect counts 0)', { values: 2, rectCounts: 0 }], ['c-1', 'exact', null]])
    expect(built.header.exact).toEqual({ counts: { exact: 1, 'not exact': 1 }, rectCounts: 8, rectCountsDiffering: 0, predictedValues: 16, predictedValuesDiffering: 2, passingWithDifferingValues: 1, passingWithDifferingRectCounts: 0 })
    const dir = mkdtempSync(join(tmpdir(), 'ledger-files-'))
    writeLedger(dir, built)
    expect(readLedger(dir)).toEqual(built)
  })

  test('a ledger of the format without the exact-value status is refused, with how to build it again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-old-'))
    writeLedger(dir, { header: { ...header(), format: 'pretext-ledger/1' as typeof LEDGER_FORMAT }, entries: [] })
    expect(() => readLedger(dir)).toThrow('build it again from its runs')
  })

  test('jobs that ran two library bundles show in the header: the rows describe no single library', () => {
    expect(buildLedger(runFolder(['b1', 'b2']), null).header.bundles).toEqual(['b1', 'b2'])
  })
})
