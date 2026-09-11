import { expect, test } from 'bun:test'
import { createSummary, regressionCount, type CompactRow } from './report.ts'
import type { Assessment, BrowserReport, MetricResult } from './types.ts'

function summarize(report: Pick<BrowserReport, 'richContracts'> & { rows: CompactRow[] }) {
  const collector = createSummary(report.rows[0]?.predictions.map(result => result.name) ?? [])
  collector.addRows(report.rows)
  return collector.finish(report.richContracts)
}

const pass: MetricResult = { status: 'pass' }
const fail: MetricResult = { status: 'fail', detail: 'Wrong native line' }
const unknown: MetricResult = { status: 'unobserved', reason: 'Source rectangles overlap' }
function metrics(source: MetricResult): Assessment {
  return { height: pass, lineCount: pass, breaks: pass, source, whitespace: pass, widths: pass, hyphen: pass, api: pass, richHeight: pass }
}
function row(id: string, before: MetricResult, after: MetricResult, scope: 'supported' | 'research' = 'supported'): CompactRow {
  return { input: { id, family: 'controls', scope }, predictions: [
    { name: 'main', assessment: metrics(before) },
    { name: 'candidate', assessment: metrics(after) },
  ] }
}

test('net improvements cannot hide a lost success', () => {
  const summary = summarize({ rows: [row('a', fail, pass), row('b', fail, pass), row('c', pass, fail)], richContracts: [] })
  expect(summary.comparisons[0]!.fixed).toHaveLength(2)
  expect(summary.comparisons[0]!.lost).toHaveLength(1)
  expect(regressionCount(summary, ['main'])).toBe(1)
})

test('losing observable source coverage is a regression, not a pass', () => {
  const summary = summarize({ rows: [row('a', pass, unknown)], richContracts: [] })
  expect(summary.totals[1]!.supported.source.unobserved).toBe(1)
  expect(regressionCount(summary, ['main'])).toBe(1)
})

test('research losses remain visible independently of the supported contract gate', () => {
  const summary = summarize({ rows: [row('a', pass, fail, 'research')], richContracts: [] })
  expect(summary.comparisons[0]!.lost).toHaveLength(1)
  expect(summary.totals[1]!.research.source.fail).toBe(1)
  expect(regressionCount(summary, ['main'])).toBe(0)
})

test('incomplete comparisons and duplicated input IDs cannot count as a run', () => {
  const good = row('a', pass, pass)
  expect(() => summarize({ rows: [good, good], richContracts: [] })).toThrow('Duplicate case')
  expect(() => summarize({ rows: [good, { ...row('b', pass, pass), predictions: [good.predictions[0]!] }], richContracts: [] })).toThrow('Incomplete candidates')
})

test('streamed batches preserve totals and transitions', () => {
  const rows = [row('a', fail, pass), row('b', pass, unknown), row('c', unknown, fail)]
  const collector = createSummary(['main', 'candidate'])
  collector.addRows(rows.slice(0, 1))
  collector.addRows(rows.slice(1))
  const summary = collector.finish([])
  expect(summary).toEqual(summarize({ rows, richContracts: [] }))
  expect(summary.comparisons[0]!.observationChanges).toHaveLength(1)
  expect(() => collector.finish([])).toThrow('finished')
  expect(() => collector.addRows([])).toThrow('finished')
})

test('batch identity failures invalidate the collector, including duplicates across batches', () => {
  const collector = createSummary(['main', 'candidate'])
  collector.addRows([row('a', pass, pass)])
  expect(() => collector.addRows([row('a', pass, pass)])).toThrow('Duplicate case')
  expect(() => collector.finish([])).toThrow('invalid')
  const repeated = row('b', pass, pass)
  repeated.predictions[1] = repeated.predictions[0]!
  expect(() => createSummary(['main', 'candidate']).addRows([repeated])).toThrow('repeated main')
  const unexpected = row('c', pass, pass)
  unexpected.predictions[1] = { name: 'unknown', assessment: metrics(pass) }
  expect(() => createSummary(['main', 'candidate']).addRows([unexpected])).toThrow('Unknown candidate')
  expect(() => createSummary(['main', 'main'])).toThrow('duplicate candidate names')
})

test('candidate exceptions fail every axis without copying raw stacks into compact output', () => {
  const input = row('a', pass, pass)
  input.predictions[1] = { name: 'candidate', error: 'Sensitive long stack\n/private/experimental/file.ts:123' }
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.totals[1]!.errors).toBe(1)
  expect(summary.comparisons[0]!.lost).toHaveLength(9)
  expect(JSON.stringify(summary)).not.toContain('/private/experimental/file.ts')
  const twoErrors = row('b', pass, pass)
  twoErrors.predictions = [{ name: 'main', error: 'First failure' }, { name: 'candidate', error: 'Different failure' }]
  const changed = summarize({ rows: [twoErrors], richContracts: [] })
  expect(changed.comparisons[0]!.changedFailures).toHaveLength(9)
  expect(changed.totals[0]!.errors).toBe(1)
})

test('rich contexts must cover every candidate exactly once, with unique failed contracts', () => {
  const rows = [row('a', pass, pass)]
  const main = { name: 'main', font: '16px Arial', letterSpacing: 0, failures: [], passedContracts: ['cursor'] }
  const candidate = { ...main, name: 'candidate', passedContracts: [], failures: [{ contract: 'cursor', detail: 'Wrong item coordinate' }] }
  expect(() => summarize({ rows, richContracts: [main] })).toThrow('Missing rich candidate candidate')
  expect(() => summarize({ rows, richContracts: [main, main, candidate] })).toThrow('Duplicate rich context')
  expect(() => summarize({ rows, richContracts: [main, { ...candidate, font: '18px Arial' }] })).toThrow('Missing rich candidate')
  expect(() => summarize({ rows, richContracts: [main, { ...candidate, name: 'unknown' }] })).toThrow('Unknown rich candidate')
  expect(() => summarize({ rows, richContracts: [main, { ...candidate, failures: [...candidate.failures, ...candidate.failures] }] })).toThrow('duplicate rich contract')
  const summary = summarize({ rows, richContracts: [candidate, main] })
  expect(summary.totals[1]!.richFailures).toHaveLength(1)
  expect(summary.comparisons[0]!.richLost).toHaveLength(1)
  expect(regressionCount(summary, ['main'])).toBe(1)
})

test('API contract losses gate research cases as well as supported cases', () => {
  const input = row('a', pass, pass, 'research')
  input.predictions[1] = { name: 'candidate', assessment: { ...metrics(pass), api: fail } }
  expect(regressionCount(summarize({ rows: [input], richContracts: [] }), ['main'])).toBe(1)
})

test('a newly broken API contract gates a case already failing another API contract', () => {
  const input = row('a', pass, pass, 'research')
  input.predictions = [
    { name: 'main', assessment: { ...metrics(pass), api: fail }, contracts: ['old-contract'], passedContracts: ['new-contract'] },
    { name: 'candidate', assessment: { ...metrics(pass), api: fail }, contracts: ['old-contract', 'new-contract'] },
  ]
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.comparisons[0]!.lost).toHaveLength(0)
  expect(summary.comparisons[0]!.apiNew).toEqual([{ id: 'a', family: 'controls', scope: 'research', contract: 'new-contract' }])
  expect(regressionCount(summary, ['main'])).toBe(1)
})

test('individual API failures are not double-counted with the aggregate API loss', () => {
  const input = row('a', pass, pass)
  input.predictions[0] = { name: 'main', assessment: metrics(pass), passedContracts: ['first', 'second'] }
  input.predictions[1] = { name: 'candidate', assessment: { ...metrics(pass), api: fail }, contracts: ['first', 'second'] }
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.comparisons[0]!.lost).toHaveLength(1)
  expect(summary.comparisons[0]!.apiNew).toHaveLength(2)
  expect(regressionCount(summary, ['main'])).toBe(2)
})

test('exceptions and unindexed legacy API failures do not establish per-contract passes', () => {
  const input = row('a', pass, pass)
  input.predictions = [
    { name: 'main', error: 'Preparation failed before contracts were checked' },
    { name: 'candidate', assessment: { ...metrics(pass), api: fail }, contracts: ['new-contract'] },
  ]
  expect(summarize({ rows: [input], richContracts: [] }).comparisons[0]!.apiNew).toHaveLength(0)
  input.predictions[0] = { name: 'main', assessment: { ...metrics(pass), api: fail } }
  expect(summarize({ rows: [input], richContracts: [] }).comparisons[0]!.apiNew).toHaveLength(0)
  input.predictions[0] = { name: 'main', assessment: { ...metrics(pass), api: fail }, contracts: ['same', 'same'] }
  expect(() => summarize({ rows: [input], richContracts: [] })).toThrow('duplicate API contract')
})

test('a skipped API subcheck is unobserved even when the aggregate API metric passed', () => {
  const input = row('a', pass, pass)
  input.predictions = [
    { name: 'main', assessment: metrics(pass), contracts: [], passedContracts: ['other/completion'] },
    { name: 'candidate', assessment: { ...metrics(pass), api: fail }, contracts: ['branch/source'], passedContracts: ['other/completion'] },
  ]
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.comparisons[0]!.apiNew).toHaveLength(0)
  expect(summary.comparisons[0]!.apiUnobserved).toEqual([{ id: 'a', family: 'controls', scope: 'supported', contract: 'branch/source' }])
  expect(regressionCount(summary, ['main'])).toBe(0)
})

test('a recovered group exception does not manufacture earlier passes for its subchecks', () => {
  const input = row('a', pass, pass)
  input.predictions = [
    { name: 'main', assessment: { ...metrics(pass), api: fail }, contracts: ['stream/completion'], passedContracts: [] },
    { name: 'candidate', assessment: { ...metrics(pass), api: fail }, contracts: ['stream/source'], passedContracts: ['stream/completion'] },
  ]
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.comparisons[0]!.apiNew).toHaveLength(0)
  expect(summary.comparisons[0]!.apiUnobserved).toHaveLength(1)
  expect(regressionCount(summary, ['main'])).toBe(0)
})

test('global rich failures need an observed earlier pass, rather than merely no earlier failure', () => {
  const rows = [row('a', pass, pass)]
  const context = { font: '16px Arial', letterSpacing: 0 }
  const summary = summarize({ rows, richContracts: [
    { ...context, name: 'main', failures: [{ contract: 'rich/completion', detail: 'Earlier exception' }], passedContracts: [] },
    { ...context, name: 'candidate', failures: [{ contract: 'rich/source', detail: 'Newly observed mismatch' }], passedContracts: ['rich/completion'] },
  ] })
  expect(summary.comparisons[0]!.richLost).toHaveLength(0)
  expect(summary.comparisons[0]!.richUnobserved).toHaveLength(1)
  expect(regressionCount(summary, ['main'])).toBe(0)
})


test('only requested preserved references create comparisons', () => {
  const collector = createSummary(['main', 'original', 'candidate'], ['main', 'original'])
  const input = row('a', pass, pass)
  input.predictions.push({ name: 'original', assessment: metrics(pass) })
  collector.addRows([input])
  expect(collector.finish([]).comparisons.map(pair => [pair.baseline, pair.candidate])).toEqual([
    ['main', 'original'], ['main', 'candidate'], ['original', 'main'], ['original', 'candidate'],
  ])
})

test('maintained required metrics need an observed absolute pass on each implementation', () => {
  const input = row('a', fail, fail)
  input.input.required = ['source']
  const summary = summarize({ rows: [input], richContracts: [] })
  expect(summary.comparisons[0]!.lost).toHaveLength(0)
  expect(summary.totals[1]!.requiredFailures).toEqual([{ id: 'a', family: 'controls', metric: 'source', result: fail }])
  input.predictions[1] = { name: 'candidate', assessment: metrics(unknown) }
  expect(summarize({ rows: [input], richContracts: [] }).totals[1]!.requiredFailures[0]!.result.status).toBe('unobserved')
})
