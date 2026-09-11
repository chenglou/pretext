import { createHash } from 'node:crypto'
import type { Assessment, BrowserReport, CaseResult, MetricResult } from './types.ts'

export const METRICS = ['height', 'lineCount', 'breaks', 'source', 'whitespace', 'widths', 'hyphen', 'api', 'richHeight'] as const
type Metric = typeof METRICS[number]
type Counts = { pass: number; fail: number; unobserved: number; 'not-applicable': number }
type Change = { id: string; family: string; scope: 'supported' | 'research'; metric: Metric; before: MetricResult; after: MetricResult }
type CompactCandidate = { name: string; assessment: Assessment; contracts?: string[]; passedContracts?: string[] } | { name: string; error: string }
export type CompactRow = { input: Pick<CaseResult['input'], 'id' | 'family' | 'scope' | 'required'>; predictions: CompactCandidate[] }
type RichFailure = { font: string; letterSpacing: number; contract: string; detail: string }
type Total = {
  name: string
  supported: Record<Metric, Counts>
  research: Record<Metric, Counts>
  errors: number
  richFailures: RichFailure[]
  requiredFailures: Array<{ id: string; family: string; metric: Metric; result: MetricResult }>
}
type ApiChange = { id: string; family: string; scope: 'supported' | 'research'; contract: string }
type Comparison = {
  baseline: string
  candidate: string
  fixed: Change[]
  lost: Change[]
  changedFailures: Change[]
  observationChanges: Change[]
  richLost: RichFailure[]
  apiNew: ApiChange[]
  apiUnobserved: ApiChange[]
  richUnobserved: RichFailure[]
}
export type Summary = { rows: number; totals: Total[]; comparisons: Comparison[] }

function assessment(result: CompactCandidate): Assessment {
  if ('assessment' in result) return result.assessment
  if (result.error.length === 0) throw new Error(`Empty candidate error for ${result.name}`)
  // Preserve the exception and stack only in raw NDJSON. Repeating it across
  // all six axes and every comparison would dominate the compact index.
  const fingerprint = createHash('sha256').update(result.error).digest('hex').slice(0, 12)
  const failure: MetricResult = { status: 'fail', detail: `Candidate error ${fingerprint}; see the raw case report.` }
  return { height: failure, lineCount: failure, breaks: failure, source: failure, whitespace: failure, widths: failure, hyphen: failure, api: failure, richHeight: failure }
}

function counts(): Counts {
  return { pass: 0, fail: 0, unobserved: 0, 'not-applicable': 0 }
}

function metricCounts(): Record<Metric, Counts> {
  return { height: counts(), lineCount: counts(), breaks: counts(), source: counts(), whitespace: counts(), widths: counts(), hyphen: counts(), api: counts(), richHeight: counts() }
}

function validateContracts(failed: string[], passed: string[], kind: 'API' | 'rich'): void {
  if (failed.some(contract => contract.length === 0) || new Set(failed).size !== failed.length) throw new Error(`Empty or duplicate ${kind} contract`)
  if (passed.some(contract => contract.length === 0 || failed.includes(contract)) || new Set(passed).size !== passed.length) throw new Error(`Invalid passed ${kind} contract`)
}

export function createSummary(names: string[], preserve: readonly string[] = ['main']): {
  addRows: (rows: CompactRow[]) => void
  finish: (richContracts: BrowserReport['richContracts']) => Summary
} {
  if (names.length === 0 || names.some(name => name.length === 0) || new Set(names).size !== names.length) {
    throw new Error('Empty report or duplicate candidate names')
  }
  if (preserve.some(name => !names.includes(name)) || new Set(preserve).size !== preserve.length) throw new Error('Unknown or duplicate preserved candidate')
  // Candidate order is fixed for this run; callers may reuse their input array.
  names = [...names]
  const totals: Total[] = names.map(name => ({ name, supported: metricCounts(), research: metricCounts(), errors: 0, richFailures: [], requiredFailures: [] }))
  const comparisons: Comparison[] = []
  for (const baseline of preserve) for (const candidate of names) {
    if (baseline !== candidate) comparisons.push({ baseline, candidate, fixed: [], lost: [], changedFailures: [], observationChanges: [], richLost: [], apiNew: [], apiUnobserved: [], richUnobserved: [] })
  }
  const ids = new Set<string>()
  let state: 'open' | 'finished' | 'invalid' = 'open'

  function requireOpen(): void {
    if (state !== 'open') throw new Error(`Summary is ${state}`)
  }

  function addRows(rows: CompactRow[]): void {
    requireOpen()
    try {
      for (const row of rows) {
        if (row.input.id.length === 0) throw new Error('Empty case ID')
        if (ids.has(row.input.id)) throw new Error(`Duplicate case ${row.input.id}`)
        ids.add(row.input.id)
        if (row.predictions.length !== names.length) throw new Error(`Incomplete candidates for ${row.input.id}`)
        const results: Array<{ metrics: Assessment; contracts: string[]; passedContracts: string[] } | undefined> = Array.from({ length: names.length })
        for (const result of row.predictions) {
          const index = names.indexOf(result.name)
          if (index === -1) throw new Error(`Unknown candidate ${result.name} for ${row.input.id}`)
          if (results[index] !== undefined) throw new Error(`Missing or repeated ${result.name} for ${row.input.id}`)
          const current = assessment(result)
          const contracts = 'assessment' in result ? result.contracts ?? [] : []
          const passedContracts = 'assessment' in result ? result.passedContracts ?? [] : []
          validateContracts(contracts, passedContracts, 'API')
          if (contracts.length > 0 && current.api.status !== 'fail') throw new Error(`Failed API contracts without a failed API metric for ${result.name}: ${row.input.id}`)
          results[index] = { metrics: current, contracts, passedContracts }
          const total = totals[index]!
          if ('error' in result) total.errors++
          for (const metric of METRICS) total[row.input.scope][metric][current[metric].status]++
          for (const metric of row.input.required ?? []) {
            if (current[metric].status !== 'pass') total.requiredFailures.push({ id: row.input.id, family: row.input.family, metric, result: current[metric] })
          }
        }
        for (const pair of comparisons) {
          const before = results[names.indexOf(pair.baseline)]!
          const after = results[names.indexOf(pair.candidate)]!
          // Absence from the failure list is not a pass. A group may have
          // thrown before this check ran, or a branch may never call it.
          for (const contract of after.contracts) {
            if (before.contracts.includes(contract)) continue
            const change = { id: row.input.id, family: row.input.family, scope: row.input.scope, contract }
            if (before.passedContracts.includes(contract)) pair.apiNew.push(change)
            else pair.apiUnobserved.push(change)
          }
          for (const metric of METRICS) {
            const a = before.metrics[metric]
            const b = after.metrics[metric]
            let changes: Change[]
            if (a.status === 'pass' && b.status !== 'pass') changes = pair.lost
            else if (a.status === 'fail' && b.status === 'pass') changes = pair.fixed
            else if (a.status !== b.status) changes = pair.observationChanges
            else if (a.status === 'fail' && b.status === 'fail' && a.detail !== b.detail) changes = pair.changedFailures
            else continue
            changes.push({ id: row.input.id, family: row.input.family, scope: row.input.scope, metric, before: a, after: b })
          }
        }
      }
    } catch (error) {
      state = 'invalid'
      throw error
    }
  }

  function finish(richContracts: BrowserReport['richContracts']): Summary {
    requireOpen()
    try {
      if (ids.size === 0) throw new Error('Empty report')
      const contexts: Array<{ font: string; letterSpacing: number; results: Array<BrowserReport['richContracts'][number] | undefined> }> = []
      for (const row of richContracts) {
        const index = names.indexOf(row.name)
        if (index === -1) throw new Error(`Unknown rich candidate ${row.name}`)
        if (row.font.length === 0 || !Number.isFinite(row.letterSpacing)) throw new Error(`Invalid rich context for ${row.name}`)
        let context = contexts.find(value => value.font === row.font && value.letterSpacing === row.letterSpacing)
        if (context === undefined) {
          context = { font: row.font, letterSpacing: row.letterSpacing, results: Array.from({ length: names.length }) }
          contexts.push(context)
        }
        if (context.results[index] !== undefined) throw new Error(`Duplicate rich context for ${row.name}: ${row.font}, ${row.letterSpacing}`)
        context.results[index] = row
        validateContracts(row.failures.map(failure => failure.contract), row.passedContracts, 'rich')
        for (const failure of row.failures) totals[index]!.richFailures.push({ font: row.font, letterSpacing: row.letterSpacing, ...failure })
      }
      for (const context of contexts) {
        for (let index = 0; index < names.length; index++) {
          if (context.results[index] === undefined) throw new Error(`Missing rich candidate ${names[index]}: ${context.font}, ${context.letterSpacing}`)
        }
        for (const pair of comparisons) {
          const beforeIndex = names.indexOf(pair.baseline)
          const afterIndex = names.indexOf(pair.candidate)
          const before = context.results[beforeIndex]!
          const after = context.results[afterIndex]!
          for (const failure of after.failures) {
            if (!before.failures.some(value => value.contract === failure.contract)) {
              const changes = before.passedContracts.includes(failure.contract) ? pair.richLost : pair.richUnobserved
              changes.push({ font: context.font, letterSpacing: context.letterSpacing, ...failure })
            }
          }
        }
      }
      state = 'finished'
      const rows = ids.size
      ids.clear()
      return { rows, totals, comparisons }
    } catch (error) {
      state = 'invalid'
      throw error
    }
  }
  return { addRows, finish }
}

export function regressionCount(summary: Summary, preserve: readonly string[]): number {
  let count = 0
  for (const pair of summary.comparisons) {
    if (!preserve.includes(pair.baseline) || preserve.includes(pair.candidate)) continue
    const apiCases = new Set([...pair.apiNew, ...pair.apiUnobserved].map(change => change.id))
    count += pair.apiNew.length + pair.richLost.length
    for (const change of pair.lost) {
      if (change.metric === 'api' && apiCases.has(change.id)) continue
      if (change.scope === 'supported' || change.metric === 'api') count++
    }
  }
  return count
}

export function printSummary(summary: Summary): void {
  console.log(`${summary.rows} cases; metrics are independent, unobserved is not a pass`)
  for (const total of summary.totals) {
    const fields = METRICS.map(metric => {
      const count = total.supported[metric]
      return `${metric} ${count.pass} pass/${count.fail} fail/${count.unobserved} unknown`
    })
    console.log(`${total.name}: ${fields.join(' | ')} | rich failures ${total.richFailures.length}`)
  }
  for (const pair of summary.comparisons) {
    if (pair.baseline !== 'main') continue
    console.log(`${pair.candidate} vs ${pair.baseline}: ${pair.fixed.filter(change => change.scope === 'supported').length} fixed metrics, ${pair.lost.filter(change => change.scope === 'supported').length} lost successes, ${pair.apiNew.length} new API contract failures, ${pair.richLost.length} new rich failures; ${pair.apiUnobserved.length} API/${pair.richUnobserved.length} rich failures without a previously observed pass`)
  }
}
