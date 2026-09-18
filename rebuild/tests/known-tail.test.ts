// The known-tail file and the rules that read it (known-tail.ts).
import { describe, expect, test } from 'bun:test'
import { itemsOf, knownTailProblems, readKnownTail, statusParts, KNOWN_TAIL_FORMAT, type KnownTail, type KnownTailItem } from './known-tail.ts'
import { transitionsBetween, type Ledger, type LedgerEntry, type LedgerHeader, type LedgerStatus } from './ledger.ts'
import type { SetProtocol } from './sets.ts'

const item = (over: Partial<KnownTailItem>): KnownTailItem => ({ id: 'gecko/test-class', engine: 'gecko', kind: 'open rows', title: 'a class', conditions: [], cases: [], source: 'a report', note: 'a note', ...over })
const entry = (id: string, widths: LedgerStatus, family = 'rule/joining'): LedgerEntry => ({ set: 'families', id, family, status: { lineCount: 'pass', breaks: 'pass', widths, painter: 'pass' } })

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

  test('a transition names the items its case belongs to before or after', () => {
    const protocol: SetProtocol = { set: 'families', parts: [], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }
    const header: LedgerHeader = {
      format: 'pretext-ledger/1', browser: 'firefox', config: 'facts', predictor: 'p', build: { app: 'Firefox', appVersion: '156.0', engine: '156.0', os: '26A428' },
      environments: [], scorer: 7, bundles: [], library: null, orders: 'both', historyCarriedFrom: null, sets: { families: { protocol, subset: false, cases: 2, environments: [], evidence: [] } }, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    } as LedgerHeader
    const ledger = (entries: LedgerEntry[]): Ledger => ({ header, entries })
    const tail = [item({ id: 'gecko/in-word', match: { browsers: ['firefox'], status: 'covered', conditions: ['in-word-prefix'] } })]
    const report = transitionsBetween(
      ledger([entry('c-1', 'fail covered by in-word-prefix'), entry('c-2', 'pass'), entry('c-3', 'pass')]),
      ledger([entry('c-1', 'pass'), entry('c-2', 'fail covered by in-word-prefix'), entry('c-3', 'fail open')]), [], tail)
    expect(report.knownTail).toEqual({ 'gecko/in-word': { 'widths: fail covered by in-word-prefix -> pass': ['c-1'], 'widths: pass -> fail covered by in-word-prefix': ['c-2'] } })
    expect(report.transitions.map(value => [value.id, value.knownTail ?? null])).toEqual([['c-1', ['gecko/in-word']], ['c-2', ['gecko/in-word']], ['c-3', null]])
    // Without the file's items a report names none.
    expect(transitionsBetween(ledger([entry('c-1', 'fail open')]), ledger([entry('c-1', 'pass')]), []).knownTail).toEqual({})
  })
})
