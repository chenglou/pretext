// The known-status ledger's rules (ledger.ts): the closed set of statuses, history dependence, like with like, and lift
// over prediction failures alone.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GapFiring, MetricAttribution } from '../lab/score.ts'
import { buildLedger, carryHistory, conditionsOf, entryOf, incomparable, statusOf, transitionsBetween, type Ledger, type LedgerEntry, type LedgerHeader, type PerCase, type SetsRun } from './ledger.ts'
import type { SetProtocol } from './sets.ts'

const pass = { status: 'pass' }
const fail = { status: 'fail', reason: 'width differs' }
const per = (id: string, over: Partial<PerCase> = {}): PerCase => ({ id, family: 'test/family', lineCount: pass, breaks: pass, widths: pass, painter: pass, ...over })
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
    expect(entryOf('runs', per('c-1', { widths: fail }), null)).toEqual({ set: 'runs', id: 'c-1', family: 'test/family', status: { lineCount: 'pass', breaks: 'pass', widths: 'fail open', painter: 'pass' }, reason: { widths: 'width differs' } })
  })
})

const protocol: SetProtocol = { set: 'runs', parts: [{ casesFile: 'runs.ndjson', casesSha256: 'abc' }], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }
const header = (over: Partial<LedgerHeader> = {}): LedgerHeader => ({
  format: 'pretext-ledger/1', browser: 'chrome', config: 'no-facts', predictor: 'p.ts', build: { app: 'Google Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: '26A428' },
  environments: ['chrome: Google Chrome 153.0.8010.50, engine build 153.0.8010.50, macOS 26A428; DPR 2, scale 1; uiLanguage zh-CN; scorer 6'], scorer: 6, bundles: ['b1'], orders: 'both',
  historyCarriedFrom: null, sets: { runs: { protocol, subset: false, cases: 2, evidence: [] } }, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} }, ...over,
})
const entry = (id: string, widths: string, family = 'test/family'): LedgerEntry => ({ set: 'runs', id, family, status: { lineCount: 'pass', breaks: 'pass', widths, painter: 'pass' } })
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

  test('another browser build, scorer, configuration or protocol is refused by name, and allowed only knowingly', () => {
    const other = { app: 'Google Chrome', appVersion: '154.0.1.2', engine: '154.0.1.2', os: '26A428' }
    expect(incomparable(header(), header({ build: other })).map(problem => problem.name)).toEqual(['build'])
    expect(incomparable(header(), header({ scorer: 7 })).map(problem => problem.name)).toEqual(['scorer'])
    expect(incomparable(header(), header({ config: 'facts' })).map(problem => problem.name)).toEqual(['config'])
    const otherLanguages = header({ environments: [header().environments[0]!.replace('zh-CN', 'en-US')] })
    expect(incomparable(header(), otherLanguages).map(problem => problem.name)).toEqual(['languages'])
    // The run protocol: another cut into parts, other case files or cases per round trip move history-dependent cases.
    const recut = header({ sets: { runs: { protocol: { ...protocol, casesPerRoundTrip: 1 }, subset: false, cases: 2, evidence: [] } } })
    expect(incomparable(header(), recut).map(problem => problem.name)).toEqual(['protocol'])
    const refused = transitionsBetween(ledger([entry('c-1', 'pass')]), ledger([entry('c-1', 'fail open')], { build: other }), [])
    expect([refused.comparable.length, refused.transitions.length]).toEqual([1, 0])
    expect(transitionsBetween(ledger([entry('c-1', 'pass')]), ledger([entry('c-1', 'fail open')], { build: other }), ['build']).transitions.length).toBe(1)
  })

  test('a run of some cases isn\'t missing the others', () => {
    const subset = header({ sets: { runs: { protocol, subset: true, cases: 1, evidence: [] } } })
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
        writeFileSync(join(folder, 'chrome-per-case.ndjson'), `${JSON.stringify(per(`c-${k}`, { widths }))}\n`)
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

  test('jobs that ran two library bundles show in the header: the rows describe no single library', () => {
    expect(buildLedger(runFolder(['b1', 'b2']), null).header.bundles).toEqual(['b1', 'b2'])
  })
})
