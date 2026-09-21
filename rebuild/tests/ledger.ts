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
// - `history-dependent`: the scorer observed other native layouts for the case. Never a pass or a fail. A newly
//   history-dependent case cannot silently retire a reference pass or an exact-value obligation.
// - `prediction-order-dependent`: equal native layouts gave different metric statuses or exact-value results. This is
//   unstable prediction evidence, distinct from native history, and newly acquiring it blocks the gate.
// - `protocol row`: the page doesn't describe the case's declared input (score.ts slotProtocol). Never a pass or a fail.
// - `unobserved`: the scorer's unobserved and not-applicable, which are never passes.
//
// Beside the four metrics, and part of none, every case has an exact-value status (LedgerEntry.exact): whether every value
// the observation port reports as predicted equals the browser's. The values are the scorer's per-case `facts`: the rect
// count of every code point, node and element, predicted by definition, and the x and width of every rect in the predicted
// state (lab README, "Scoring"); limited values are stand-ins and never count. A metric can pass while a predicted value is
// wrong (a width inside a line whose sum holds, an x that moves no break), so without this status a change that makes
// predicted values wrong moves nothing in a ledger. Its closed set:
// - `exact`: every rect count and every predicted value compared equals the browser's, none included.
// - `not exact (values <n>, rect counts <m>)`: n predicted x or width values and m rect counts differ; `differing` holds
//   the two numbers.
// - `history-dependent`, `prediction-order-dependent`, `protocol row`: as for the metrics.
// - `unobserved`: the scorer compared no value (no prediction, or no native observation).
// Limited values are no part of it, but an entry keeps how many of them differ (`limitedDiffering`), and `transitions`
// prints the sum before and after with the cases where it rose, without blocking: with no supplied facts most values are
// limited (Firefox reports `optical-size` on nearly every line), so a change that makes values wrong shows there only as
// stand-ins that stopped agreeing, and in the facts configuration as predicted values that differ. Tier 2 runs both.
//
// History dependence needs both orders. A ledger built from the forward order alone takes the history-dependent cases of
// another ledger (--carry-history-from, the reference): their statuses there replace the forward run's, marked
// `historyCarried`, so a forward-only iteration never reports a known history-dependent case as a regression. A ledger built
// from both orders keeps its own finding unless --carry-history-from is given, which then adds the other ledger's
// history-dependent cases to its own (what is known to depend on history stays known until a ledger is built without it). A case that
// is history-dependent and unknown to the reference can still show as a transition in a forward-only run: run both orders,
// or the isolation protocol (lab README, "Sharded runs and isolation"), before calling it a regression.
//
// `transitions` compares like with like. It refuses (exit 2) two ledgers of different browsers, browser builds, process
// languages, scorers, configurations or set protocols, each by name; --allow=<name> accepts one difference knowingly
// (build, languages, scorer, config, protocol). Exit 1 when a pass or exact case loses its obligation (including newly
// observed native history), a case wasn't exact and holds more differing values, prediction order dependence appears,
// or a complete selected set omits a reference case. Focused subset comparisons don't require the omitted cases.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { MetricAttribution, MetricName, ResidualMembership, GapFiring } from '../lab/score.ts'
import type { BrowserBuild } from '../lab/types.ts'
import { itemsOf, readKnownTail, type KnownTailItem } from './known-tail.ts'
import { REPO, SETS, type Config, type SetProtocol, type TierBrowser } from './sets.ts'

// Format 3 separates native history from prediction order dependence. Format 2 discarded that distinction, so it must
// be rebuilt from both orders' per-case files before its history exclusions can be carried.
export const LEDGER_FORMAT = 'pretext-ledger/3'
export const METRIC_NAMES: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
// What a transition is on: a metric, or the exact-value status.
export type LedgerKey = MetricName | 'exact'
export const LEDGER_KEYS: readonly LedgerKey[] = [...METRIC_NAMES, 'exact']
const PREDICTION_METRICS: readonly MetricName[] = ['lineCount', 'breaks', 'widths']

export type LedgerStatus = string
export type LedgerEntry = {
  set: string
  id: string
  family: string
  status: Record<MetricName, LedgerStatus>
  // The exact-value status, beside the metrics, and the differing values of a case that isn't exact.
  exact: LedgerStatus
  differing?: Differing
  // The actual per-order evidence behind an unstable prediction; never substituted for native-history evidence.
  predictionOrderDependent?: Partial<Record<MetricName, OrderStatuses>> & { exact?: OrderStatuses & { differing: OrderDiffering } }
  // Limited x and width values that differ from the browser's, when any: stand-ins, reported and never gated on.
  limitedDiffering?: number
  // The scorer's reason category per metric that isn't a pass.
  reason?: Partial<Record<MetricName, string>>
  // The entry's history-dependent statuses come from another ledger (a forward-only run).
  historyCarried?: true
}

// Predicted x and width values, and rect counts, that differ from the browser's.
export type Differing = { values: number; rectCounts: number }

// One order of one part: the run's record and what score.ts wrote for it, as repo-relative paths.
export type EvidenceRun = { part: number; order: 'forward' | 'reverse'; run: string; perCase: string; summary: string; runId: string | null; bundleSha256: string | null; startedAt: string | null }
// `environments`: score.ts environment keys of the set's evidence runs (a set can run under launch arguments of its own, as
// Chrome's `features-en-US` does under its second locale).
export type LedgerSet = { protocol: SetProtocol; subset: boolean; cases: number; environments: string[]; evidence: EvidenceRun[] }
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
  // The commit the runs were started at, and the files under rebuild/src and rebuild/lab that differed from it then.
  library: { commit: string; dirty: string[] } | null
  orders: 'both' | 'forward'
  historyCarriedFrom: string | null
  sets: Record<string, LedgerSet>
  counts: Record<MetricName, Record<string, number>>
  // The exact-value statuses by kind, and over the exact and not exact cases the values behind them: the rect counts and
  // predicted values the scorer compared, and how many of each differ. `passingWithDifferingValues` and
  // `passingWithDifferingRectCounts`: the not exact cases none of whose lineCount, breaks and widths fails, which no metric
  // shows (REPORT.md's "passing cases with a wrong predicted value", and the same for rect counts).
  exact: { counts: Record<string, number>; rectCounts: number; rectCountsDiffering: number; predictedValues: number; predictedValuesDiffering: number; passingWithDifferingValues: number; passingWithDifferingRectCounts: number }
}

export type PerCase = {
  id: string
  family: string
  lineCount: { status: string; reason?: string }
  breaks: { status: string; reason?: string }
  widths: { status: string; reason?: string }
  painter: { status: string; reason?: string }
  // score.ts compactFacts, [equal, differ] pairs: rect counts, and the x and width of rects in the predicted state.
  facts?: { counts: [number, number]; predicted: [number, number]; limited?: Record<string, [number, number]> }
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

export function exactOf(per: PerCase): { exact: LedgerStatus; differing?: Differing } {
  if (per.historyDependent !== undefined) return { exact: 'history-dependent' }
  if (per.protocol !== undefined) return { exact: 'protocol row' }
  if (per.facts === undefined) return { exact: 'unobserved' }
  const differing = { values: per.facts.predicted[1], rectCounts: per.facts.counts[1] }
  if (differing.values === 0 && differing.rectCounts === 0) return { exact: 'exact' }
  return { exact: `not exact (values ${differing.values}, rect counts ${differing.rectCounts})`, differing }
}

// One case's entry from its forward row and, when both orders ran, its reverse row.
export function entryOf(set: string, forward: PerCase, reverse: PerCase | null): LedgerEntry {
  const status = {} as Record<MetricName, LedgerStatus>
  const reason: Partial<Record<MetricName, string>> = {}
  const predictionOrderDependent: NonNullable<LedgerEntry['predictionOrderDependent']> = {}
  // Native history applies to the whole case. Either scored order can carry the native-comparison finding.
  const nativeHistory = forward.historyDependent !== undefined || reverse?.historyDependent !== undefined
  for (const metric of METRIC_NAMES) {
    let value = nativeHistory ? 'history-dependent' : statusOf(forward, metric)
    // Two failures under different conditions keep the forward conditions; changing the kind of result on the same
    // native layout is prediction instability, never a native-history exclusion.
    if (reverse !== null && !nativeHistory && statusKind(statusOf(reverse, metric)) !== statusKind(value)) {
      predictionOrderDependent[metric] = { forward: value, reverse: statusOf(reverse, metric) }
      value = 'prediction-order-dependent'
    }
    status[metric] = value
    if (value !== 'pass' && forward[metric].reason !== undefined) reason[metric] = forward[metric].reason
  }
  let exact = nativeHistory ? { exact: 'history-dependent' } : exactOf(forward)
  if (reverse !== null && !nativeHistory) {
    const other = exactOf(reverse)
    // Keep both observed tallies when they disagree, including two not-exact orders with different numbers. A single
    // tally would hide the worse order, and a made-up maximum would no longer describe either observation.
    if (exact.exact !== other.exact) {
      predictionOrderDependent.exact = { forward: exact.exact, reverse: other.exact, differing: { forward: exact.differing ?? null, reverse: other.differing ?? null } }
      exact = { exact: 'prediction-order-dependent' }
    }
  }
  let limitedDiffering = 0
  if (exact.exact === 'exact' || exact.exact === 'prediction-order-dependent' || exact.differing !== undefined) for (const tally of Object.values(forward.facts?.limited ?? {})) limitedDiffering += tally[1]
  return { set, id: forward.id, family: forward.family, status, ...exact, ...(Object.keys(predictionOrderDependent).length === 0 ? {} : { predictionOrderDependent }), ...(limitedDiffering === 0 ? {} : { limitedDiffering }), ...(Object.keys(reason).length === 0 ? {} : { reason }) }
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
  if (header.format !== LEDGER_FORMAT) throw new Error(`${headerPath}: format ${JSON.stringify(header.format)}, expected ${LEDGER_FORMAT}; build it again from its runs (ledger.ts build --runs=<the run's folder>), whose per-case files hold what the format added`)
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

// A status without its conditions, class or numbers: the closed set's member.
export function statusKind(status: LedgerStatus): string {
  if (status.startsWith('fail covered by ')) return 'fail covered'
  if (status.startsWith('residual ')) return 'residual'
  if (status.startsWith('not exact ')) return 'not exact'
  return status
}

// Exact-value statuses by kind; `perCases` are the forward rows of the entries, for the values behind them.
export function countExact(entries: readonly LedgerEntry[], perCases: ReadonlyMap<string, PerCase>): LedgerHeader['exact'] {
  const out: LedgerHeader['exact'] = { counts: {}, rectCounts: 0, rectCountsDiffering: 0, predictedValues: 0, predictedValuesDiffering: 0, passingWithDifferingValues: 0, passingWithDifferingRectCounts: 0 }
  const fails = (status: LedgerStatus): boolean => ['fail covered', 'fail open', 'residual'].includes(statusKind(status))
  for (const entry of entries) {
    const kind = statusKind(entry.exact)
    out.counts[kind] = (out.counts[kind] ?? 0) + 1
    if (entry.differing !== undefined && !PREDICTION_METRICS.some(metric => fails(entry.status[metric]))) {
      if (entry.differing.values > 0) out.passingWithDifferingValues++
      if (entry.differing.rectCounts > 0) out.passingWithDifferingRectCounts++
    }
    const facts = perCases.get(`${entry.set}\n${entry.id}`)?.facts
    if (facts === undefined || (kind !== 'exact' && kind !== 'not exact')) continue
    out.rectCounts += facts.counts[0] + facts.counts[1]
    out.rectCountsDiffering += facts.counts[1]
    out.predictedValues += facts.predicted[0] + facts.predicted[1]
    out.predictedValuesDiffering += facts.predicted[1]
  }
  return out
}

// The history-dependent entries of `from` replace the same cases' entries. A ledger built from one order needs it, since
// one order can't see history dependence. A ledger built from both orders takes it only when asked (build
// --carry-history-from): a browser process with two states (Firefox's fallback-font state, known tail
// gecko/process-font-fallback-state) can land both orders in one state, so a case known to depend on history would read
// as a stable pass in that recording and as a regression in the next (correctness round 5's critic, 2026-09-19).
export function carryHistory(entries: LedgerEntry[], from: readonly LedgerEntry[]): number {
  const known = new Map<string, LedgerEntry>()
  for (const entry of from) if (entry.exact === 'history-dependent' || METRIC_NAMES.some(metric => entry.status[metric] === 'history-dependent')) known.set(`${entry.set}\n${entry.id}`, entry)
  let carried = 0
  for (const entry of entries) {
    const before = known.get(`${entry.set}\n${entry.id}`)
    if (before === undefined) continue
    for (const metric of METRIC_NAMES) if (before.status[metric] === 'history-dependent') entry.status[metric] = 'history-dependent'
    if (before.exact === 'history-dependent') {
      entry.exact = 'history-dependent'
      delete entry.differing
      delete entry.limitedDiffering
    }
    entry.historyCarried = true
    carried++
  }
  return carried
}

// ---- Transitions ----

// knownTail: the known-tail items (known-tail.ts) the case belongs to by its status before or after, when any.
// `metric` is a metric, or `exact` for the exact-value status.
type OrderDiffering = { forward: Differing | null; reverse: Differing | null }
type OrderStatuses = { forward: LedgerStatus; reverse: LedgerStatus; differing?: OrderDiffering }
export type Transition = { set: string; id: string; family: string; metric: LedgerKey; before: LedgerStatus; after: LedgerStatus; orders?: { before: OrderStatuses; after: OrderStatuses }; knownTail?: string[] }
export type TransitionReport = {
  comparable: string[]
  allowed: string[]
  compared: number
  onlyBefore: number
  onlyAfter: number
  // A lost pass or newly order-dependent prediction; known native-history exclusions remain distinct.
  blocking: number
  // The same gate on the exact-value status: exact to anything but a protocol row, newly order-dependent results, and a case that
  // wasn't exact holding more differing values or rect counts than before. `differingBefore` and `differingAfter` sum the
  // differing predicted values and rect counts of the cases compared.
  exactBlocking: number
  differingBefore: Differing
  differingAfter: Differing
  // Limited values that differ, summed over the cases compared, and the cases (`<set>/<id>`) that hold more than before.
  // Stand-ins: reported, never blocking.
  limitedDiffering: { before: number; after: number; rose: string[] }
  transitions: Transition[]
  // Per metric and for `exact`, per `before -> after`, per family: the case ids.
  grouped: Record<LedgerKey, Record<string, Record<string, string[]>>>
  // Per known-tail item, per `metric: before -> after`: the case ids. A change that moves a class left open on purpose shows
  // here by the item's name, whether it left the class, entered it or moved inside it.
  knownTail: Record<string, Record<string, string[]>>
}

// Why two ledgers don't compare like with like, by name, or an empty list.
export function incomparable(before: LedgerHeader, after: LedgerHeader): Array<{ name: string; detail: string }> {
  const out: Array<{ name: string; detail: string }> = []
  if (before.browser !== after.browser) out.push({ name: 'browser', detail: `${before.browser} against ${after.browser}` })
  if (JSON.stringify(before.build) !== JSON.stringify(after.build)) out.push({ name: 'build', detail: `${JSON.stringify(before.build)} against ${JSON.stringify(after.build)}: a browser or OS build moved; pin it and seed a reference for the new build (rebuild/TESTS.md §12)` })
  if (before.scorer !== after.scorer) out.push({ name: 'scorer', detail: `scorer ${before.scorer} against ${after.scorer}: re-score the older runs` })
  if (before.config !== after.config) out.push({ name: 'config', detail: `${before.config} against ${after.config}` })
  // Per set, since a set can run under process languages of its own: the given languages of its environment keys.
  const languages = (set: LedgerSet): string => [...new Set(set.environments.map(key => key.split('; ').slice(2, -1).join('; ')))].sort().join(' | ')
  for (const [name, set] of Object.entries(after.sets)) {
    const other = before.sets[name]
    if (other === undefined) continue
    if (languages(other) !== languages(set)) out.push({ name: 'languages', detail: `set ${name}: process languages ${languages(other)} against ${languages(set)}` })
    // A run of some cases (--ids-file) keeps the parts' order but not their history, which its `subset` mark says.
    if (set.subset || other.subset) continue
    if (JSON.stringify(other.protocol) !== JSON.stringify(set.protocol)) out.push({ name: 'protocol', detail: `set ${name} ran under another protocol (parts, case files, cases per round trip or run arguments): its history-dependent cases can differ` })
  }
  return out
}

export function statusAt(entry: LedgerEntry, key: LedgerKey): LedgerStatus {
  return key === 'exact' ? entry.exact : entry.status[key]
}

// Both weren't exact, and the newer holds more differing values or more differing rect counts.
function moreDiffers(was: Differing | undefined, now: Differing | undefined): boolean {
  return was !== undefined && now !== undefined && (now.values > was.values || now.rectCounts > was.rectCounts)
}

// An unstable reference still protects each observed order's successes and error counts. Becoming consistently wrong
// must not look like an improvement merely because the two orders now agree.
function orderStatuses(entry: LedgerEntry, metric: LedgerKey): OrderStatuses {
  if (metric === 'exact') return entry.predictionOrderDependent?.exact ?? { forward: entry.exact, reverse: entry.exact, differing: { forward: entry.differing ?? null, reverse: entry.differing ?? null } }
  return entry.predictionOrderDependent?.[metric] ?? { forward: entry.status[metric], reverse: entry.status[metric] }
}

function orderWorsened(before: OrderStatuses, after: OrderStatuses, metric: LedgerKey): boolean {
  for (const order of ['forward', 'reverse'] as const) {
    const a = before[order], b = after[order]
    if (a === b || b === 'protocol row') continue
    if (a === 'pass' || a === 'exact') return true
    if (metric !== 'exact') continue
    const oldCounts = before.differing?.[order]
    const newCounts = after.differing?.[order]
    if (oldCounts != null && newCounts != null && moreDiffers(oldCounts, newCounts)) return true
  }
  return false
}

export function transitionsBetween(before: Ledger, after: Ledger, allowed: readonly string[], tail: readonly KnownTailItem[] = []): TransitionReport {
  const problems = incomparable(before.header, after.header)
  const report: TransitionReport = {
    comparable: problems.filter(problem => !allowed.includes(problem.name)).map(problem => `${problem.name}: ${problem.detail}`),
    allowed: problems.filter(problem => allowed.includes(problem.name)).map(problem => `${problem.name}: ${problem.detail}`),
    compared: 0, onlyBefore: 0, onlyAfter: 0, blocking: 0, exactBlocking: 0, differingBefore: { values: 0, rectCounts: 0 }, differingAfter: { values: 0, rectCounts: 0 },
    limitedDiffering: { before: 0, after: 0, rose: [] }, transitions: [], grouped: { lineCount: {}, breaks: {}, widths: {}, painter: {}, exact: {} }, knownTail: {},
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
    report.differingBefore.values += was.differing?.values ?? 0
    report.differingBefore.rectCounts += was.differing?.rectCounts ?? 0
    report.differingAfter.values += entry.differing?.values ?? 0
    report.differingAfter.rectCounts += entry.differing?.rectCounts ?? 0
    report.limitedDiffering.before += was.limitedDiffering ?? 0
    report.limitedDiffering.after += entry.limitedDiffering ?? 0
    if ((entry.limitedDiffering ?? 0) > (was.limitedDiffering ?? 0) && statusKind(was.exact) === statusKind(entry.exact)) report.limitedDiffering.rose.push(`${entry.set}/${entry.id}`)
    for (const metric of LEDGER_KEYS) {
      const transition: Transition = { set: entry.set, id: entry.id, family: entry.family, metric, before: statusAt(was, metric), after: statusAt(entry, metric) }
      const hasOrderEvidence = was.predictionOrderDependent?.[metric] !== undefined || entry.predictionOrderDependent?.[metric] !== undefined
      const orders = hasOrderEvidence ? { before: orderStatuses(was, metric), after: orderStatuses(entry, metric) } : undefined
      const ordersChanged = orders !== undefined && (orders.before.forward !== orders.after.forward || orders.before.reverse !== orders.after.reverse)
      if (transition.before === transition.after && !ordersChanged) continue
      if (ordersChanged && orders !== undefined) transition.orders = orders
      const worseOrder = ordersChanged && orders !== undefined && orderWorsened(orders.before, orders.after, metric)
      const newlyUnstable = transition.before !== 'prediction-order-dependent' && transition.after === 'prediction-order-dependent'
      if (tail.length > 0) {
        const items = [...new Set([...itemsOf(tail, before.header.browser, before.header.config, was, metric, transition.before), ...itemsOf(tail, after.header.browser, after.header.config, entry, metric, transition.after)])]
        if (items.length > 0) transition.knownTail = items
        for (const item of items) ((report.knownTail[item] ??= {})[`${metric}: ${transition.before} -> ${transition.after}`] ??= []).push(entry.id)
      }
      report.transitions.push(transition)
      if (transition.after !== 'protocol row') {
        if (metric === 'exact') {
          if (transition.before === 'exact' || newlyUnstable || worseOrder || moreDiffers(was.differing, entry.differing)) report.exactBlocking++
        } else if (transition.before === 'pass' || newlyUnstable || worseOrder) report.blocking++
      }
      const families = (report.grouped[metric][`${transition.before} -> ${transition.after}`] ??= {})
      ;(families[entry.family] ??= []).push(entry.id)
    }
  }
  // Only the sets the newer ledger ran count as missing from it: a run of some sets says nothing about the others.
  for (const [key, entry] of old) if (!seen.has(key) && after.header.sets[entry.set] !== undefined && !after.header.sets[entry.set]!.subset) report.onlyBefore++
  return report
}

// onlyBefore includes missing cases only within selected complete sets; focused subsets and other sets are excluded.
export function transitionExitCode(report: TransitionReport): 0 | 1 | 2 {
  if (report.comparable.length > 0) return 2
  return report.blocking > 0 || report.exactBlocking > 0 || report.onlyBefore > 0 ? 1 : 0
}

export function printTransitions(report: TransitionReport, limit = 12): void {
  // One line per kind of difference: a protocol that differs does so for every set.
  const allowedKinds = new Map<string, string[]>()
  for (const line of report.allowed) allowedKinds.set(line.split(':')[0]!, [...(allowedKinds.get(line.split(':')[0]!) ?? []), line])
  for (const lines of allowedKinds.values()) console.log(`allowed difference: ${lines[0]}${lines.length > 1 ? ` (and ${lines.length - 1} more of this kind)` : ''}`)
  if (report.comparable.length > 0) {
    for (const line of report.comparable) console.log(`not comparable: ${line}`)
    return
  }
  console.log(`${report.compared} cases compared; ${report.onlyBefore} only in the older ledger, ${report.onlyAfter} only in the newer; ${report.transitions.length} status transitions, ${report.blocking} blocking metric obligations or newly unstable predictions`)
  console.log(`exact values: ${report.exactBlocking} blocking transitions (lost exact obligations, more differing values or newly unstable predictions); differing predicted values ${report.differingBefore.values} -> ${report.differingAfter.values}, differing rect counts ${report.differingBefore.rectCounts} -> ${report.differingAfter.rectCounts}`)
  console.log(`limited values (stand-ins, never blocking): differing ${report.limitedDiffering.before} -> ${report.limitedDiffering.after}; ${report.limitedDiffering.rose.length} cases hold more than before${report.limitedDiffering.rose.length === 0 ? '' : `: ${report.limitedDiffering.rose.slice(0, 6).join(' ')}${report.limitedDiffering.rose.length > 6 ? ' …' : ''}`}`)
  for (const metric of LEDGER_KEYS) {
    const kinds = Object.entries(report.grouped[metric]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    for (const [kind, families] of kinds) {
      const total = Object.values(families).reduce((sum, ids) => sum + ids.length, 0)
      console.log(`  ${metric}: ${kind}: ${total}`)
      const rows = Object.entries(families).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      for (const [family, ids] of rows.slice(0, limit)) console.log(`      ${String(ids.length).padStart(5)}  ${family}  ${ids.slice(0, 3).join(' ')}${ids.length > 3 ? ' …' : ''}`)
      if (rows.length > limit) console.log(`      … ${rows.length - limit} more families`)
    }
  }
  const items = Object.entries(report.knownTail).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  if (items.length > 0) console.log('on known-tail items (rebuild/tests/known-tail.json):')
  for (const [item, kinds] of items) {
    console.log(`  ${item}`)
    for (const [kind, ids] of Object.entries(kinds).sort((a, b) => b[1].length - a[1].length)) console.log(`      ${String(ids.length).padStart(5)}  ${kind}  ${ids.slice(0, 3).join(' ')}${ids.length > 3 ? ' …' : ''}`)
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
  library?: { commit: string; dirty: string[] }
  sets: Array<{ name: string; protocol: SetProtocol; subset: boolean; parts: Array<{ part: number; forward: string; reverse: string | null }> }>
}

export function buildLedger(runDir: string, carryFrom: string | null): Ledger {
  const run = JSON.parse(readFileSync(join(runDir, 'sets-run.json'), 'utf8')) as SetsRun
  const entries: LedgerEntry[] = []
  const environments = new Set<string>()
  const bundles = new Set<string>()
  const scorers = new Set<number>()
  const sets: Record<string, LedgerSet> = {}
  const forwardRows = new Map<string, PerCase>()
  for (const set of run.sets) {
    const evidence: EvidenceRun[] = []
    const setEnvironments = new Set<string>()
    let cases = 0
    for (const part of set.parts) {
      const read = (dir: string, order: 'forward' | 'reverse'): PerCase[] => {
        const folder = resolve(REPO, dir)
        const record = JSON.parse(readFileSync(join(folder, `${run.browser}-run.json`), 'utf8')) as { runId?: string; bundleSha256?: string | null; startedAt?: string }
        const summary = JSON.parse(readFileSync(join(folder, `${run.browser}-summary.json`), 'utf8')) as { scorer: number; browsers: Record<string, { environments: Record<string, number> }> }
        scorers.add(summary.scorer)
        for (const browser of Object.values(summary.browsers)) for (const key of Object.keys(browser.environments)) {
          environments.add(key)
          setEnvironments.add(key)
        }
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
        forwardRows.set(`${set.name}\n${per.id}`, per)
        cases++
      }
    }
    sets[set.name] = { protocol: set.protocol, subset: set.subset, cases, environments: [...setEnvironments].sort(), evidence }
  }
  if (scorers.size !== 1) throw new Error(`The runs were scored by ${scorers.size} scorers (${[...scorers].join(', ')}): score them with one`)
  let carried: string | null = null
  if (carryFrom !== null) {
    carryHistory(entries, readLedger(carryFrom).entries)
    carried = relative(REPO, resolve(carryFrom))
  }
  const header: LedgerHeader = {
    format: LEDGER_FORMAT, browser: run.browser, config: run.config, predictor: run.predictor, build: run.build, environments: [...environments].sort(), scorer: [...scorers][0]!,
    bundles: [...bundles].sort(), library: run.library ?? null, orders: run.orders, historyCarriedFrom: carried, sets, counts: countStatuses(entries), exact: countExact(entries, forwardRows),
  }
  return { header, entries }
}

// A ledger's statuses by kind, the four metrics and then the exact-value status with the values behind it.
export function printCounts(header: LedgerHeader): void {
  const kinds = (counts: Record<string, number>): string => Object.entries(counts).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, n]) => `${kind} ${n}`).join(', ')
  for (const metric of METRIC_NAMES) console.log(`  ${metric.padEnd(9)} ${kinds(header.counts[metric])}`)
  console.log(`  ${'exact'.padEnd(9)} ${kinds(header.exact.counts)}; ${header.exact.predictedValuesDiffering} of ${header.exact.predictedValues} predicted values and ${header.exact.rectCountsDiffering} of ${header.exact.rectCounts} rect counts differ; cases without a failing lineCount, breaks or widths that hold a differing predicted value ${header.exact.passingWithDifferingValues}, a differing rect count ${header.exact.passingWithDifferingRectCounts}`)
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
      printCounts(ledger.header)
      return 0
    }
    case 'transitions': {
      if (positional.length !== 2) throw new Error('Usage: bun rebuild/tests/ledger.ts transitions <before ledger dir> <after ledger dir> [--out=<report.json>] [--allow=<difference>[,...]]')
      const report = transitionsBetween(readLedger(resolve(positional[0]!)), readLedger(resolve(positional[1]!)), (options.get('allow') ?? '').split(',').filter(name => name !== ''), readKnownTail().items)
      if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), `${JSON.stringify(report, null, 2)}\n`)
      printTransitions(report)
      return transitionExitCode(report)
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
