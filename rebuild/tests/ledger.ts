// The known-status ledger: for every case of the tiers' sets and every metric, one status from a closed set, with the run
// that is its evidence. A change to the library, the lab or a browser then shows as status transitions, and failures that
// were never in scope (covered, residual, history-dependent) are visible when they move too.
//
//   bun rebuild/tests/ledger.ts build --runs=<browser-sets out dir> --out=<ledger dir> [--carry-history-from=<ledger dir>]
//   bun rebuild/tests/ledger.ts transitions <before ledger dir> <after ledger dir> [--out=<report.json>] [--allow=<difference>[,...]]
//   bun rebuild/tests/ledger.ts conditions <ledger dir> [--groups=development,...] [--out=<report.json>]
//
// A ledger is a folder: `ledger.json`, the header, and `entries.ndjson`, one line per set and case in the sets' order.
//
// Statuses (LedgerStatus):
// - `pass`.
// - `fail covered by <conditions>`: the scorer found a covered explanation on every failing line (lab README, "Covered
//   failures"). The conditions are the covering gaps' names, and for the painter also the library's painter limits as
//   `limit:<name>`, sorted and joined with `+`.
// - `fail open`: a failure without a covered explanation. For lineCount, breaks and widths these are the open model bugs.
// - `residual <class>`: a lineCount, breaks or widths failure without a covered explanation on a row the scorer matched to
//   a residual class (score.ts RESIDUAL_CLASSES), with `(probed)` or `(signature)`.
// - `history-dependent`: the two orders observed other native layouts for the case (every metric), or gave this metric
//   another kind of status on equal native layouts (the prediction's Canvas answers depended on page history). Never a pass
//   or a fail.
// - `protocol row`: the page doesn't describe the case's declared input (score.ts slotProtocol). Never a pass or a fail.
// - `unobserved`: the scorer's unobserved and not-applicable, which are never passes.
//
// History dependence needs both orders. A ledger built from the forward order alone takes the history-dependent cases of
// another ledger (--carry-history-from, the reference): their statuses there replace the forward run's, marked
// `historyCarried`, so a forward-only iteration never reports a known history-dependent case as a regression. A case that
// is history-dependent and unknown to the reference can still show as a transition in a forward-only run: run both orders,
// or the isolation protocol (lab README, "Sharded runs and isolation"), before calling it a regression.
//
// `transitions` compares like with like. It refuses (exit 2) two ledgers of different browsers, browser builds, process
// languages, scorers, configurations or set protocols, each by name; --allow=<name> accepts one difference knowingly
// (build, languages, scorer, config, protocol). Exit 1 when a pass became anything but history-dependent or a protocol row.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { MetricAttribution, MetricName, ResidualMembership, GapFiring } from '../lab/score.ts'
import type { BrowserBuild } from '../lab/types.ts'
import { REPO, SETS, type Config, type SetProtocol, type TierBrowser } from './sets.ts'

export const LEDGER_FORMAT = 'pretext-ledger/1'
export const METRIC_NAMES: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
const PREDICTION_METRICS: readonly MetricName[] = ['lineCount', 'breaks', 'widths']

export type LedgerStatus = string
export type LedgerEntry = {
  set: string
  id: string
  family: string
  status: Record<MetricName, LedgerStatus>
  // The scorer's reason category per metric that isn't a pass.
  reason?: Partial<Record<MetricName, string>>
  // The entry's history-dependent statuses come from another ledger (a forward-only run).
  historyCarried?: true
}

// One order of one part: the run's record and what score.ts wrote for it, as repo-relative paths.
export type EvidenceRun = { part: number; order: 'forward' | 'reverse'; run: string; perCase: string; summary: string; runId: string | null; bundleSha256: string | null; startedAt: string | null }
export type LedgerSet = { protocol: SetProtocol; subset: boolean; cases: number; evidence: EvidenceRun[] }
export type LedgerHeader = {
  format: typeof LEDGER_FORMAT
  browser: TierBrowser
  config: Config
  predictor: string
  build: BrowserBuild
  // score.ts environment keys of the evidence runs: build, device, given process languages and scorer.
  environments: string[]
  scorer: number
  // The library bundles the evidence runs ran (run.json bundleSha256): one, unless the library changed between jobs.
  bundles: string[]
  orders: 'both' | 'forward'
  historyCarriedFrom: string | null
  sets: Record<string, LedgerSet>
  counts: Record<MetricName, Record<string, number>>
}

export type PerCase = {
  id: string
  family: string
  lineCount: { status: string; reason?: string }
  breaks: { status: string; reason?: string }
  widths: { status: string; reason?: string }
  painter: { status: string; reason?: string }
  lineGaps?: Partial<Record<MetricName, MetricAttribution>>
  residual?: ResidualMembership
  firing?: GapFiring
  protocol?: string
  historyDependent?: string
}

// The conditions that cover a failing metric: the covering gaps of its failing lines, and the painter limits.
export function coveringConditions(attribution: MetricAttribution): string[] {
  const names = new Set<string>()
  for (const line of attribution.lines) {
    for (const gap of line.gaps) names.add(gap.gap)
    for (const limit of line.limits ?? []) names.add(`limit:${limit}`)
  }
  return [...names].sort()
}

export function statusOf(per: PerCase, metric: MetricName): LedgerStatus {
  if (per.historyDependent !== undefined) return 'history-dependent'
  if (per.protocol !== undefined) return 'protocol row'
  const value = per[metric]
  switch (value.status) {
    case 'pass': return 'pass'
    case 'fail': {
      const attribution = per.lineGaps?.[metric]
      if (attribution !== undefined && attribution.covered) return `fail covered by ${coveringConditions(attribution).join('+')}`
      if (metric !== 'painter' && per.residual !== undefined) return `residual ${per.residual.name} (${per.residual.membership})`
      return 'fail open'
    }
    default: return 'unobserved'
  }
}

// One case's entry from its forward row and, when both orders ran, its reverse row.
export function entryOf(set: string, forward: PerCase, reverse: PerCase | null): LedgerEntry {
  const status = {} as Record<MetricName, LedgerStatus>
  const reason: Partial<Record<MetricName, string>> = {}
  for (const metric of METRIC_NAMES) {
    let value = statusOf(forward, metric)
    // Equal native layouts scored differently: the prediction depended on the order. Other conditions on a failure that
    // both orders have keep the forward order's, which is what a forward-only run sees.
    if (reverse !== null && value !== 'history-dependent' && statusKind(statusOf(reverse, metric)) !== statusKind(value)) value = 'history-dependent'
    status[metric] = value
    if (value !== 'pass' && forward[metric].reason !== undefined) reason[metric] = forward[metric].reason
  }
  return { set, id: forward.id, family: forward.family, status, ...(Object.keys(reason).length === 0 ? {} : { reason }) }
}

export function readPerCase(path: string): PerCase[] {
  const out: PerCase[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) if (line.trim() !== '') out.push(JSON.parse(line) as PerCase)
  return out
}

export type Ledger = { header: LedgerHeader; entries: LedgerEntry[] }

export function readLedger(dir: string): Ledger {
  const headerPath = join(dir, 'ledger.json')
  if (!existsSync(headerPath)) throw new Error(`${dir}: no ledger.json`)
  const header = JSON.parse(readFileSync(headerPath, 'utf8')) as LedgerHeader
  if (header.format !== LEDGER_FORMAT) throw new Error(`${headerPath}: format ${JSON.stringify(header.format)}, expected ${LEDGER_FORMAT}`)
  const entries: LedgerEntry[] = []
  for (const line of readFileSync(join(dir, 'entries.ndjson'), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as LedgerEntry)
  return { header, entries }
}

export function writeLedger(dir: string, ledger: Ledger): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ledger.json'), `${JSON.stringify(ledger.header, null, 2)}\n`)
  writeFileSync(join(dir, 'entries.ndjson'), ledger.entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
}

export function countStatuses(entries: readonly LedgerEntry[]): LedgerHeader['counts'] {
  const counts = { lineCount: {}, breaks: {}, widths: {}, painter: {} } as LedgerHeader['counts']
  for (const entry of entries) for (const metric of METRIC_NAMES) {
    const kind = statusKind(entry.status[metric])
    counts[metric][kind] = (counts[metric][kind] ?? 0) + 1
  }
  return counts
}

// A status without its conditions or class: the closed set's member.
export function statusKind(status: LedgerStatus): string {
  if (status.startsWith('fail covered by ')) return 'fail covered'
  if (status.startsWith('residual ')) return 'residual'
  return status
}

// The history-dependent entries of `from` replace the same cases' entries in a ledger built from one order.
export function carryHistory(entries: LedgerEntry[], from: readonly LedgerEntry[]): number {
  const known = new Map<string, LedgerEntry>()
  for (const entry of from) if (METRIC_NAMES.some(metric => entry.status[metric] === 'history-dependent')) known.set(`${entry.set}\n${entry.id}`, entry)
  let carried = 0
  for (const entry of entries) {
    const before = known.get(`${entry.set}\n${entry.id}`)
    if (before === undefined) continue
    for (const metric of METRIC_NAMES) if (before.status[metric] === 'history-dependent') entry.status[metric] = 'history-dependent'
    entry.historyCarried = true
    carried++
  }
  return carried
}

// ---- Transitions ----

export type Transition = { set: string; id: string; family: string; metric: MetricName; before: LedgerStatus; after: LedgerStatus }
export type TransitionReport = {
  comparable: string[]
  allowed: string[]
  compared: number
  onlyBefore: number
  onlyAfter: number
  // Pass to anything but history-dependent or a protocol row: what a regression gate blocks on.
  blocking: number
  transitions: Transition[]
  // Per metric, per `before -> after`, per family: the case ids.
  grouped: Record<MetricName, Record<string, Record<string, string[]>>>
}

// Why two ledgers don't compare like with like, by name, or an empty list.
export function incomparable(before: LedgerHeader, after: LedgerHeader): Array<{ name: string; detail: string }> {
  const out: Array<{ name: string; detail: string }> = []
  if (before.browser !== after.browser) out.push({ name: 'browser', detail: `${before.browser} against ${after.browser}` })
  if (JSON.stringify(before.build) !== JSON.stringify(after.build)) out.push({ name: 'build', detail: `${JSON.stringify(before.build)} against ${JSON.stringify(after.build)}: a browser or OS build moved; pin it and seed a reference for the new build (rebuild/TESTS.md §12)` })
  if (before.scorer !== after.scorer) out.push({ name: 'scorer', detail: `scorer ${before.scorer} against ${after.scorer}: re-score the older runs` })
  if (before.config !== after.config) out.push({ name: 'config', detail: `${before.config} against ${after.config}` })
  const languages = (header: LedgerHeader): string => [...new Set(header.environments.map(key => key.split('; ').slice(2, -1).join('; ')))].sort().join(' | ')
  if (before.scorer === after.scorer && before.browser === after.browser && JSON.stringify(before.build) === JSON.stringify(after.build) && languages(before) !== languages(after)) {
    out.push({ name: 'languages', detail: `process languages ${languages(before)} against ${languages(after)}` })
  }
  for (const [name, set] of Object.entries(after.sets)) {
    const other = before.sets[name]
    if (other === undefined || set.subset || other.subset) continue
    if (JSON.stringify(other.protocol) !== JSON.stringify(set.protocol)) out.push({ name: 'protocol', detail: `set ${name} ran under another protocol (parts, case files, cases per round trip or run arguments): its history-dependent cases can differ` })
  }
  return out
}

export function transitionsBetween(before: Ledger, after: Ledger, allowed: readonly string[]): TransitionReport {
  const problems = incomparable(before.header, after.header)
  const report: TransitionReport = {
    comparable: problems.filter(problem => !allowed.includes(problem.name)).map(problem => `${problem.name}: ${problem.detail}`),
    allowed: problems.filter(problem => allowed.includes(problem.name)).map(problem => `${problem.name}: ${problem.detail}`),
    compared: 0, onlyBefore: 0, onlyAfter: 0, blocking: 0, transitions: [], grouped: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
  }
  if (report.comparable.length > 0) return report
  const old = new Map<string, LedgerEntry>()
  for (const entry of before.entries) old.set(`${entry.set}\n${entry.id}`, entry)
  const seen = new Set<string>()
  for (const entry of after.entries) {
    const key = `${entry.set}\n${entry.id}`
    seen.add(key)
    const was = old.get(key)
    if (was === undefined) {
      report.onlyAfter++
      continue
    }
    report.compared++
    for (const metric of METRIC_NAMES) {
      if (was.status[metric] === entry.status[metric]) continue
      const transition: Transition = { set: entry.set, id: entry.id, family: entry.family, metric, before: was.status[metric], after: entry.status[metric] }
      report.transitions.push(transition)
      if (transition.before === 'pass' && transition.after !== 'history-dependent' && transition.after !== 'protocol row') report.blocking++
      const families = (report.grouped[metric][`${transition.before} -> ${transition.after}`] ??= {})
      ;(families[entry.family] ??= []).push(entry.id)
    }
  }
  // Only the sets the newer ledger ran count as missing from it: a run of some sets says nothing about the others.
  for (const [key, entry] of old) if (!seen.has(key) && after.header.sets[entry.set] !== undefined && !after.header.sets[entry.set]!.subset) report.onlyBefore++
  return report
}

export function printTransitions(report: TransitionReport, limit = 12): void {
  for (const line of report.allowed) console.log(`allowed difference: ${line}`)
  if (report.comparable.length > 0) {
    for (const line of report.comparable) console.log(`not comparable: ${line}`)
    return
  }
  console.log(`${report.compared} cases compared; ${report.onlyBefore} only in the older ledger, ${report.onlyAfter} only in the newer; ${report.transitions.length} status transitions, ${report.blocking} of them from pass to a failure or unobserved`)
  for (const metric of METRIC_NAMES) {
    const kinds = Object.entries(report.grouped[metric]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    for (const [kind, families] of kinds) {
      const total = Object.values(families).reduce((sum, ids) => sum + ids.length, 0)
      console.log(`  ${metric}: ${kind}: ${total}`)
      const rows = Object.entries(families).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      for (const [family, ids] of rows.slice(0, limit)) console.log(`      ${String(ids.length).padStart(5)}  ${family}  ${ids.slice(0, 3).join(' ')}${ids.length > 3 ? ' …' : ''}`)
      if (rows.length > limit) console.log(`      … ${rows.length - limit} more families`)
    }
  }
}

// ---- Conditions: firing, lift and weak coverage ----

// Lift is counted over prediction failures alone (score.ts GapFiring): a condition's share of the failing lines of
// lineCount, breaks and widths failures against its share of the line boxes of cases whose three prediction metrics pass.
// Painter-only failures are reported beside it and never enter it. A failure is weakly covered when every condition that
// covers it has a lift below 2, or none (it fires on no passing line or no failing line can be counted).
export type ConditionRow = { condition: string; passingLines: number; passingLineRate: number; failingLines: number; failingLineRate: number; lift: number | null; painterOnlyFailingLines: number; coveredFailures: number; weaklyCoveredOnly: number }
export type ConditionsReport = { sets: string[]; passingCases: number; passingLines: number; failingLines: number; painterOnlyFailingLines: number; predictionFailures: number; coveredPredictionFailures: number; weaklyCoveredPredictionFailures: number; painterOnlyFailures: number; conditions: ConditionRow[] }

export function conditionsOf(perCases: readonly PerCase[], sets: string[]): ConditionsReport {
  const fired = new Map<string, { passingLines: number; failingLines: number; painterOnlyFailingLines: number; coveredFailures: number; weaklyCoveredOnly: number }>()
  const bucket = (name: string) => {
    let value = fired.get(name)
    if (value === undefined) fired.set(name, (value = { passingLines: 0, failingLines: 0, painterOnlyFailingLines: 0, coveredFailures: 0, weaklyCoveredOnly: 0 }))
    return value
  }
  const report: ConditionsReport = { sets, passingCases: 0, passingLines: 0, failingLines: 0, painterOnlyFailingLines: 0, predictionFailures: 0, coveredPredictionFailures: 0, weaklyCoveredPredictionFailures: 0, painterOnlyFailures: 0, conditions: [] }
  const covered: string[][] = []
  for (const per of perCases) {
    if (per.historyDependent !== undefined || per.protocol !== undefined) continue
    const failing = PREDICTION_METRICS.filter(metric => per[metric].status === 'fail')
    const attributed = (metrics: readonly MetricName[]): Map<number, readonly string[]> => {
      const lines = new Map<number, readonly string[]>()
      for (const metric of metrics) for (const line of per.lineGaps?.[metric]?.lines ?? []) if (line.engineLine !== null) lines.set(line.engineLine, line.fires ?? [])
      return lines
    }
    if (failing.length > 0) {
      report.predictionFailures++
      for (const fires of attributed(failing).values()) {
        report.failingLines++
        for (const gap of fires) bucket(gap).failingLines++
      }
      if (failing.every(metric => per.lineGaps?.[metric]?.covered === true)) {
        report.coveredPredictionFailures++
        const names = new Set<string>()
        for (const metric of failing) for (const name of coveringConditions(per.lineGaps![metric]!)) names.add(name)
        covered.push([...names])
        for (const name of names) bucket(name).coveredFailures++
      }
      continue
    }
    if (per.firing === undefined || !PREDICTION_METRICS.every(metric => per[metric].status === 'pass')) continue
    report.passingCases++
    report.passingLines += per.firing.lines
    for (const [gap, lines] of Object.entries(per.firing.gaps)) bucket(gap).passingLines += lines
    if (per.painter.status === 'fail') {
      report.painterOnlyFailures++
      for (const fires of attributed(['painter']).values()) {
        report.painterOnlyFailingLines++
        for (const gap of fires) bucket(gap).painterOnlyFailingLines++
      }
    }
  }
  const rate = (n: number, of: number): number => (of === 0 ? 0 : n / of)
  const lifts = new Map<string, number | null>()
  for (const [name, value] of fired) lifts.set(name, value.passingLines === 0 || report.failingLines === 0 || report.passingLines === 0 ? null : rate(value.failingLines, report.failingLines) / rate(value.passingLines, report.passingLines))
  for (const names of covered) {
    // A condition that fires on no passing line has no lift to be weak by.
    const weak = names.every(name => { const lift = lifts.get(name); return lift !== null && lift !== undefined && lift < 2 })
    if (!weak) continue
    report.weaklyCoveredPredictionFailures++
    for (const name of names) bucket(name).weaklyCoveredOnly++
  }
  const round = (value: number): number => Math.round(value * 10000) / 10000
  report.conditions = [...fired].map(([condition, value]) => ({
    condition, passingLines: value.passingLines, passingLineRate: round(rate(value.passingLines, report.passingLines)), failingLines: value.failingLines,
    failingLineRate: round(rate(value.failingLines, report.failingLines)), lift: lifts.get(condition) === null || lifts.get(condition) === undefined ? null : Math.round(lifts.get(condition)! * 100) / 100,
    painterOnlyFailingLines: value.painterOnlyFailingLines, coveredFailures: value.coveredFailures, weaklyCoveredOnly: value.weaklyCoveredOnly,
  })).sort((a, b) => b.passingLines - a.passingLines || (a.condition < b.condition ? -1 : 1))
  return report
}

// ---- Building a ledger from a browser-sets run ----

// What browser-sets.ts leaves in its out folder (browser-sets.ts writes it; this file only reads it).
export type SetsRun = {
  browser: TierBrowser
  config: Config
  predictor: string
  build: BrowserBuild
  orders: 'both' | 'forward'
  sets: Array<{ name: string; protocol: SetProtocol; subset: boolean; parts: Array<{ part: number; forward: string; reverse: string | null }> }>
}

export function buildLedger(runDir: string, carryFrom: string | null): Ledger {
  const run = JSON.parse(readFileSync(join(runDir, 'sets-run.json'), 'utf8')) as SetsRun
  const entries: LedgerEntry[] = []
  const environments = new Set<string>()
  const bundles = new Set<string>()
  const scorers = new Set<number>()
  const sets: Record<string, LedgerSet> = {}
  for (const set of run.sets) {
    const evidence: EvidenceRun[] = []
    let cases = 0
    for (const part of set.parts) {
      const read = (dir: string, order: 'forward' | 'reverse'): PerCase[] => {
        const folder = resolve(REPO, dir)
        const record = JSON.parse(readFileSync(join(folder, `${run.browser}-run.json`), 'utf8')) as { runId?: string; bundleSha256?: string | null; startedAt?: string }
        const summary = JSON.parse(readFileSync(join(folder, `${run.browser}-summary.json`), 'utf8')) as { scorer: number; browsers: Record<string, { environments: Record<string, number> }> }
        scorers.add(summary.scorer)
        for (const browser of Object.values(summary.browsers)) for (const key of Object.keys(browser.environments)) environments.add(key)
        if (typeof record.bundleSha256 === 'string') bundles.add(record.bundleSha256)
        evidence.push({ part: part.part, order, run: join(dir, `${run.browser}-run.json`), perCase: join(dir, `${run.browser}-per-case.ndjson`), summary: join(dir, `${run.browser}-summary.json`), runId: record.runId ?? null, bundleSha256: record.bundleSha256 ?? null, startedAt: record.startedAt ?? null })
        return readPerCase(join(folder, `${run.browser}-per-case.ndjson`))
      }
      const forward = read(part.forward, 'forward')
      const reverse = part.reverse === null ? null : new Map(read(part.reverse, 'reverse').map(per => [per.id, per]))
      for (const per of forward) {
        const other = reverse === null ? null : reverse.get(per.id) ?? null
        if (reverse !== null && other === null) throw new Error(`${part.reverse}: no row for ${per.id}, which ${part.forward} observed`)
        entries.push(entryOf(set.name, per, other))
        cases++
      }
    }
    sets[set.name] = { protocol: set.protocol, subset: set.subset, cases, evidence }
  }
  if (scorers.size !== 1) throw new Error(`The runs were scored by ${scorers.size} scorers (${[...scorers].join(', ')}): score them with one`)
  let carried: string | null = null
  if (carryFrom !== null && run.orders === 'forward') {
    carryHistory(entries, readLedger(carryFrom).entries)
    carried = relative(REPO, resolve(carryFrom))
  }
  const header: LedgerHeader = {
    format: LEDGER_FORMAT, browser: run.browser, config: run.config, predictor: run.predictor, build: run.build, environments: [...environments].sort(), scorer: [...scorers][0]!,
    bundles: [...bundles].sort(), orders: run.orders, historyCarriedFrom: carried, sets, counts: countStatuses(entries),
  }
  return { header, entries }
}

function main(): number {
  const [command, ...rest] = process.argv.slice(2)
  const positional = rest.filter(arg => !arg.startsWith('--'))
  const options = new Map<string, string>()
  for (const arg of rest) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (arg.startsWith('--') && match === null) throw new Error(`Unknown argument ${arg}`)
    if (match !== null) options.set(match[1]!, match[2]!)
  }
  switch (command) {
    case 'build': {
      const runs = options.get('runs')
      const out = options.get('out')
      if (runs === undefined || out === undefined) throw new Error('Usage: bun rebuild/tests/ledger.ts build --runs=<browser-sets out dir> --out=<ledger dir> [--carry-history-from=<ledger dir>]')
      const ledger = buildLedger(resolve(runs), options.get('carry-history-from') === undefined ? null : resolve(options.get('carry-history-from')!))
      writeLedger(resolve(out), ledger)
      console.log(`ledger ${relative(REPO, resolve(out))}: ${ledger.entries.length} cases in ${Object.keys(ledger.header.sets).length} sets, ${ledger.header.orders} orders, scorer ${ledger.header.scorer}`)
      for (const metric of METRIC_NAMES) console.log(`  ${metric.padEnd(9)} ${Object.entries(ledger.header.counts[metric]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, n]) => `${kind} ${n}`).join(', ')}`)
      return 0
    }
    case 'transitions': {
      if (positional.length !== 2) throw new Error('Usage: bun rebuild/tests/ledger.ts transitions <before ledger dir> <after ledger dir> [--out=<report.json>] [--allow=<difference>[,...]]')
      const report = transitionsBetween(readLedger(resolve(positional[0]!)), readLedger(resolve(positional[1]!)), (options.get('allow') ?? '').split(',').filter(name => name !== ''))
      if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), `${JSON.stringify(report, null, 2)}\n`)
      printTransitions(report)
      return report.comparable.length > 0 ? 2 : report.blocking > 0 ? 1 : 0
    }
    case 'conditions': {
      if (positional.length !== 1) throw new Error('Usage: bun rebuild/tests/ledger.ts conditions <ledger dir> [--groups=development,...] [--out=<report.json>]')
      const ledger = readLedger(resolve(positional[0]!))
      const groups = options.get('groups') === undefined ? null : new Set(options.get('groups')!.split(','))
      const names = Object.keys(ledger.header.sets).filter(name => groups === null || groups.has(SETS.find(set => set.name === name)?.group ?? ''))
      const perCases: PerCase[] = []
      for (const name of names) for (const evidence of ledger.header.sets[name]!.evidence) if (evidence.order === 'forward') perCases.push(...readPerCase(resolve(REPO, evidence.perCase)))
      const report = conditionsOf(perCases, names)
      if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), `${JSON.stringify(report, null, 2)}\n`)
      console.log(`${names.join(', ')}: ${report.passingLines} passing lines in ${report.passingCases} cases, ${report.failingLines} failing lines in ${report.predictionFailures} prediction failures (${report.coveredPredictionFailures} covered, ${report.weaklyCoveredPredictionFailures} of them only by conditions with a lift below 2); ${report.painterOnlyFailures} painter-only failures (${report.painterOnlyFailingLines} lines), counted apart`)
      console.log('  condition                          passing lines   rate   failing lines   rate    lift   painter-only lines   covers   weak only')
      for (const row of report.conditions) console.log(`  ${row.condition.padEnd(34)} ${String(row.passingLines).padStart(13)} ${(row.passingLineRate * 100).toFixed(2).padStart(6)}% ${String(row.failingLines).padStart(14)} ${(row.failingLineRate * 100).toFixed(2).padStart(6)}% ${(row.lift === null ? '-' : row.lift.toFixed(2)).padStart(7)} ${String(row.painterOnlyFailingLines).padStart(20)} ${String(row.coveredFailures).padStart(8)} ${String(row.weaklyCoveredOnly).padStart(11)}`)
      return 0
    }
    default:
      throw new Error('Usage: bun rebuild/tests/ledger.ts build|transitions|conditions ...')
  }
}

if (import.meta.main) {
  try {
    process.exit(main())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
