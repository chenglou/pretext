// The known-tail file and the rules that read it (known-tail.ts).
import { describe, expect, test } from 'bun:test'
import { itemsOf, knownTailProblems, readKnownTail, statusParts, KNOWN_TAIL_FORMAT, type KnownTail, type KnownTailItem } from './known-tail.ts'
import { transitionsBetween, LEDGER_FORMAT, type Ledger, type LedgerEntry, type LedgerHeader, type LedgerStatus } from './ledger.ts'
import type { SetProtocol } from './sets.ts'

const item = (over: Partial<KnownTailItem>): KnownTailItem => ({ id: 'gecko/test-class', engine: 'gecko', kind: 'open rows', title: 'a class', conditions: [], cases: [], source: 'a report', note: 'a note', ...over })
const entry = (id: string, widths: LedgerStatus, family = 'rule/joining', exact: LedgerStatus = 'exact'): LedgerEntry => ({ set: 'families', id, family, status: { lineCount: 'pass', breaks: 'pass', widths, painter: 'pass' }, exact })

describe('the known tail', () => {
  test('the repository\'s file is valid, and its ids are unique', () => {
    const tail = readKnownTail()
    expect(knownTailProblems(tail)).toEqual([])
    expect(tail.items.length).toBeGreaterThan(0)
  })

  test('an item without a source, with a bad id, a rule without a browser or a rule over every covered row is refused', () => {
    const tail: KnownTail = { format: KNOWN_TAIL_FORMAT, note: '', items: [
      item({ id: 'Gecko class' }), item({ source: '' }), item({ id: 'gecko/again' }), item({ id: 'gecko/again' }),
      item({ id: 'gecko/rule', match: { browsers: [], status: 'covered' } }),
    ] }
    const problems = knownTailProblems(tail)
    expect(problems.some(problem => problem.includes('id must read'))).toBe(true)
    expect(problems.some(problem => problem.includes('source is empty'))).toBe(true)
    expect(problems.some(problem => problem.includes('id appears twice'))).toBe(true)
    expect(problems.some(problem => problem.includes('match.browsers'))).toBe(true)
    expect(problems.some(problem => problem.includes('needs conditions, families or metrics'))).toBe(true)
  })

  test('a status reads as a kind and the names it lists', () => {
    expect(statusParts('fail covered by in-word-prefix+limit:carried-width')).toEqual({ kind: 'covered', names: ['in-word-prefix', 'limit:carried-width'] })
    expect(statusParts('residual gecko/synthetic-bold-offset (probed)')).toEqual({ kind: 'residual', names: ['gecko/synthetic-bold-offset'] })
    expect(statusParts('fail open')).toEqual({ kind: 'open', names: [] })
    expect(statusParts('prediction-order-dependent')).toEqual({ kind: 'prediction-order-dependent', names: [] })
  })

  test('prediction order dependence cannot inherit an open-failure rule', () => {
    const tail = [item({ id: 'gecko/open', match: { browsers: ['firefox'], status: 'open', families: ['rule/'] } })]
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-1', 'prediction-order-dependent'), 'widths', 'prediction-order-dependent')).toEqual([])
  })

  test('members by name and by rule: browser, status kind, conditions, family prefixes, metrics', () => {
    const tail = [
      item({ id: 'gecko/named', cases: [{ id: 'c-1', browser: 'firefox', where: 'families' }] }),
      item({ id: 'gecko/in-word', match: { browsers: ['firefox'], status: 'covered', conditions: ['in-word-prefix'], families: ['rule/'] } }),
      item({ id: 'painter/limits', engine: 'shared', kind: 'painter', match: { browsers: ['firefox'], status: 'covered', metrics: ['painter'] } }),
    ]
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-1', 'fail open'), 'widths', 'fail open')).toEqual(['gecko/named'])
    // A named case that passes belongs to nothing; another browser's ledger doesn't hold it.
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-1', 'pass'), 'widths', 'pass')).toEqual([])
    expect(itemsOf(tail, 'chrome', 'facts', entry('c-1', 'fail open'), 'widths', 'fail open')).toEqual([])
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-2', 'pass'), 'widths', 'fail covered by font-fallback+in-word-prefix')).toEqual(['gecko/in-word'])
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-2', 'pass', 'suite/joined'), 'widths', 'fail covered by in-word-prefix')).toEqual([])
    // A rule without metrics never reads the painter; the painter's rule reads nothing else.
    expect(itemsOf(tail, 'firefox', 'facts', entry('c-2', 'pass'), 'painter', 'fail covered by in-word-prefix')).toEqual(['painter/limits'])
  })

  test('a rule over not exact cases reads the exact-value status alone, and a named case is a member where it isn\'t exact', () => {
    const tail = [
      item({ id: 'lab/rect-counts', engine: 'shared', kind: 'lab', match: { browsers: ['chrome'], status: 'not exact', families: ['rule/wbr-elements'] } }),
      item({ id: 'gecko/history', kind: 'history dependence', match: { browsers: ['chrome'], status: 'history-dependent' } }),
      item({ id: 'blink/named', engine: 'blink', cases: [{ id: 'c-9', browser: 'chrome', where: 'families' }] }),
    ]
    const wbr = entry('c-1', 'pass', 'rule/wbr-elements', 'not exact (values 0, rect counts 1)')
    expect(itemsOf(tail, 'chrome', 'facts', wbr, 'exact', wbr.exact)).toEqual(['lab/rect-counts'])
    expect(itemsOf(tail, 'chrome', 'facts', wbr, 'widths', 'pass')).toEqual([])
    expect(itemsOf(tail, 'chrome', 'facts', entry('c-2', 'pass', 'rule/joining', 'not exact (values 1, rect counts 0)'), 'exact', 'not exact (values 1, rect counts 0)')).toEqual([])
    expect(itemsOf(tail, 'chrome', 'facts', entry('c-1', 'pass', 'rule/wbr-elements'), 'exact', 'exact')).toEqual([])
    // A rule over a metric's kind never reads the exact-value status, which has the kind too.
    expect(itemsOf(tail, 'chrome', 'facts', wbr, 'exact', 'history-dependent')).toEqual([])
    expect(itemsOf(tail, 'chrome', 'facts', wbr, 'widths', 'history-dependent')).toEqual(['gecko/history'])
    expect(itemsOf(tail, 'chrome', 'facts', entry('c-9', 'pass'), 'exact', 'not exact (values 2, rect counts 0)')).toEqual(['blink/named'])
    expect(itemsOf(tail, 'chrome', 'facts', entry('c-9', 'pass'), 'exact', 'exact')).toEqual([])
    const problems = knownTailProblems({ format: KNOWN_TAIL_FORMAT, note: '', items: [
      item({ id: 'lab/no-families', match: { browsers: ['chrome'], status: 'not exact' } }),
      item({ id: 'lab/with-metrics', match: { browsers: ['chrome'], status: 'not exact', families: ['rule/'], metrics: ['widths'] } }),
    ] })
    expect(problems.some(problem => problem.includes('needs families'))).toBe(true)
    expect(problems.some(problem => problem.includes('has no metrics or conditions'))).toBe(true)
  })

  test('a transition names the items its case belongs to before or after', () => {
    const protocol: SetProtocol = { set: 'families', parts: [], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }
    const header: LedgerHeader = {
      format: LEDGER_FORMAT, browser: 'firefox', config: 'facts', predictor: 'p', build: { app: 'Firefox', appVersion: '156.0', engine: '156.0', os: '26A428' },
      environments: [], scorer: 7, bundles: [], library: null, orders: 'both', historyCarriedFrom: null, sets: { families: { protocol, subset: false, cases: 2, environments: [], evidence: [] } }, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} }, exact: { counts: {}, rectCounts: 0, rectCountsDiffering: 0, predictedValues: 0, predictedValuesDiffering: 0, passingWithDifferingValues: 0, passingWithDifferingRectCounts: 0 },
    }
    const ledger = (entries: LedgerEntry[]): Ledger => ({ header, entries })
    const tail = [item({ id: 'gecko/in-word', match: { browsers: ['firefox'], status: 'covered', conditions: ['in-word-prefix'] } })]
    const report = transitionsBetween(
      ledger([entry('c-1', 'fail covered by in-word-prefix'), entry('c-2', 'pass'), entry('c-3', 'pass')]),
      ledger([entry('c-1', 'pass'), entry('c-2', 'fail covered by in-word-prefix'), entry('c-3', 'fail open')]), [], tail)
    expect(report.knownTail).toEqual({ 'gecko/in-word': { 'widths: fail covered by in-word-prefix -> pass': ['c-1'], 'widths: pass -> fail covered by in-word-prefix': ['c-2'] } })
    expect(report.transitions.map(value => [value.id, value.knownTail ?? null])).toEqual([['c-1', ['gecko/in-word']], ['c-2', ['gecko/in-word']], ['c-3', null]])
    // A case that leaves exactness shows under the item that names it.
    const values = transitionsBetween(ledger([entry('c-4', 'pass')]), ledger([entry('c-4', 'pass', 'rule/joining', 'not exact (values 2, rect counts 0)')]), [], [item({ id: 'gecko/named', cases: [{ id: 'c-4', browser: 'firefox', where: 'families' }] })])
    expect(values.knownTail).toEqual({ 'gecko/named': { 'exact: exact -> not exact (values 2, rect counts 0)': ['c-4'] } })
    // Without the file's items a report names none.
    expect(transitionsBetween(ledger([entry('c-1', 'fail open')]), ledger([entry('c-1', 'pass')]), []).knownTail).toEqual({})
  })
})
