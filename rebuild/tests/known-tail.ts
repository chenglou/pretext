// The known tail (rebuild/lab/README.md, "The known tail"): the classes deliberately left open when the correctness line is
// frozen, in one file beside the ledger, rebuild/tests/known-tail.json. Each item names what is left, the condition its rows
// sit under today, the cases that show it and where it was found and read. The ledger's transitions name the items a moved
// case belongs to, so a later change that moves one shows up as a transition on a known item, in scope or not.
//
//   bun rebuild/tests/known-tail.ts status <ledger dir> [--item=<id>] [--all]   # where every item's cases stand in a ledger
//   bun rebuild/tests/known-tail.ts add --from=<items.json>               # validate and append items (an array, or one item)
//   bun rebuild/tests/known-tail.ts check                                 # validate the file
//
// To append by hand, add an item to the file's `items` and run `check` (rebuild/tests/known-tail.test.ts runs it too). An
// item's members are its named `cases`, in whatever set they were found (a fresh set's cases are in no ledger and only
// document the class), and, in a tier 2 ledger, the entries its `match` rule describes: a browser, a status kind, the
// conditions a covered failure lists (every one named must be among them), family prefixes and metrics (without `metrics` a
// rule reads lineCount, breaks and widths, never the painter). A rule over `not exact` reads the ledger's exact-value status
// instead of a metric: cases that hold a differing predicted value or rect count, whatever their metrics say. Rules keep a
// class of thousands of rows to one item; write one only where the condition and family say what the class is.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LEDGER_KEYS, METRIC_NAMES, readLedger, statusAt, type LedgerEntry, type LedgerKey, type LedgerStatus } from './ledger.ts'
import { REPO, TIER_BROWSERS, type TierBrowser } from './sets.ts'
import type { MetricName } from '../lab/score.ts'

export const KNOWN_TAIL_PATH = join(REPO, 'rebuild/tests/known-tail.json')
export const KNOWN_TAIL_FORMAT = 'pretext-known-tail/1'
export const KNOWN_TAIL_KINDS = [
  // A failure class under a gap that a source reading says could become a prediction, not tried.
  'convertible class',
  // A condition that fires and decides nothing, or covers more than it explains.
  'diagnosing condition',
  // Failing rows with a traced cause the port can't settle from Canvas, or not traced.
  'open rows',
  // A registered residual class (lab/score.ts RESIDUAL_CLASSES).
  'residual class',
  // Native layout or Canvas answers that depend on what the process or document saw before.
  'history dependence',
  // A rule chosen by counts or a probe verdict without a source reading (CHARTER.md known deviations).
  'heuristic',
  'painter',
  // A browser bug the port names and doesn't predict (rebuild/platform-bugs).
  'browser bug',
  // Scripts and fonts outside the lab's coverage.
  'rare script',
  // The lab, the scorer or the tests themselves.
  'lab',
  // Waits for the maintainer.
  'decision',
] as const
export type KnownTailKind = typeof KNOWN_TAIL_KINDS[number]
export type StatusKind = 'covered' | 'open' | 'residual' | 'history-dependent' | 'unobserved' | 'not exact'
const STATUS_KINDS: readonly StatusKind[] = ['covered', 'open', 'residual', 'history-dependent', 'unobserved', 'not exact']

export type KnownTailItem = {
  // '<engine or area>/<short name>', unique.
  id: string
  engine: 'blink' | 'webkit' | 'gecko' | 'shared'
  kind: KnownTailKind
  title: string
  // What its rows sit under today: gap names, `limit:<painter limit>`, a residual class name; empty when nothing names it.
  conditions: string[]
  // Named members: the case, the browser it fails in and where it was found (a tier set, a fresh seed, `triage`).
  cases: Array<{ id: string; browser: TierBrowser | 'safari'; where: string }>
  // Members by rule in a tier 2 ledger of one of `browsers`.
  match?: { browsers: TierBrowser[]; status: StatusKind; conditions?: string[]; families?: string[]; metrics?: MetricName[]; configs?: Array<'facts' | 'no-facts'> }
  // Where it was found and what was read: documents, probes, source lines.
  source: string
  // What it is, and what would convert or reopen it.
  note: string
}
export type KnownTail = { format: typeof KNOWN_TAIL_FORMAT; note: string; items: KnownTailItem[] }

export function knownTailProblems(tail: KnownTail): string[] {
  const problems: string[] = []
  if (tail.format !== KNOWN_TAIL_FORMAT) problems.push(`format must be ${KNOWN_TAIL_FORMAT}`)
  const ids = new Set<string>()
  for (let i = 0; i < tail.items.length; i++) {
    const item = tail.items[i]!
    const where = `item ${i} (${item.id})`
    if (typeof item.id !== 'string' || !/^[a-z-]+\/[a-z0-9-]+$/.test(item.id)) problems.push(`${where}: id must read <area>/<short-name> in lower case`)
    if (ids.has(item.id)) problems.push(`${where}: id appears twice`)
    ids.add(item.id)
    if (!['blink', 'webkit', 'gecko', 'shared'].includes(item.engine)) problems.push(`${where}: engine must be blink, webkit, gecko or shared`)
    if (!KNOWN_TAIL_KINDS.includes(item.kind)) problems.push(`${where}: kind must be one of ${KNOWN_TAIL_KINDS.join(', ')}`)
    for (const field of ['title', 'source', 'note'] as const) if (typeof item[field] !== 'string' || item[field].trim() === '') problems.push(`${where}: ${field} is empty`)
    if (!Array.isArray(item.conditions) || !Array.isArray(item.cases)) problems.push(`${where}: conditions and cases must be arrays`)
    for (const value of item.cases ?? []) {
      if (typeof value.id !== 'string' || value.id === '' || typeof value.where !== 'string' || value.where === '') problems.push(`${where}: a case needs an id and where it was found`)
      if (![...TIER_BROWSERS, 'safari'].includes(value.browser)) problems.push(`${where}: case ${value.id} names no browser`)
    }
    if (item.match !== undefined) {
      if (!Array.isArray(item.match.browsers) || item.match.browsers.length === 0 || item.match.browsers.some(browser => !TIER_BROWSERS.includes(browser))) problems.push(`${where}: match.browsers must name tier browsers`)
      if (!STATUS_KINDS.includes(item.match.status)) problems.push(`${where}: match.status must be one of ${STATUS_KINDS.join(', ')}`)
      if (item.match.status === 'not exact' && (item.match.metrics !== undefined || (item.match.conditions ?? []).length > 0)) problems.push(`${where}: a rule over not exact cases reads the exact-value status, which has no metrics or conditions`)
      if (item.match.status === 'not exact' && (item.match.families ?? []).length === 0) problems.push(`${where}: a rule over not exact cases needs families`)
      if ((item.match.status === 'covered' || item.match.status === 'residual') && (item.match.conditions ?? []).length === 0 && (item.match.families ?? []).length === 0 && (item.match.metrics ?? []).length === 0) problems.push(`${where}: a rule over ${item.match.status} rows needs conditions, families or metrics`)
      for (const metric of item.match.metrics ?? []) if (!METRIC_NAMES.includes(metric)) problems.push(`${where}: unknown metric ${metric}`)
    }
  }
  return problems
}

export function readKnownTail(path = KNOWN_TAIL_PATH): KnownTail {
  if (!existsSync(path)) return { format: KNOWN_TAIL_FORMAT, note: '', items: [] }
  const tail = JSON.parse(readFileSync(path, 'utf8')) as KnownTail
  const problems = knownTailProblems(tail)
  if (problems.length > 0) throw new Error(`${path}:\n${problems.join('\n')}`)
  return tail
}

// A ledger status as a rule reads it: its kind and, for a covered failure or a residual member, the names it lists.
export function statusParts(status: LedgerStatus): { kind: StatusKind | 'pass' | 'protocol row'; names: string[] } {
  if (status.startsWith('fail covered by ')) return { kind: 'covered', names: status.slice('fail covered by '.length).split('+') }
  if (status.startsWith('residual ')) return { kind: 'residual', names: [status.slice('residual '.length).replace(/ \((probed|signature)\)$/, '')] }
  if (status === 'fail open') return { kind: 'open', names: [] }
  if (status.startsWith('not exact ')) return { kind: 'not exact', names: [] }
  // An exact case is to the exact-value status what a pass is to a metric.
  if (status === 'exact') return { kind: 'pass', names: [] }
  if (status === 'history-dependent' || status === 'unobserved' || status === 'pass' || status === 'protocol row') return { kind: status, names: [] }
  return { kind: 'open', names: [] }
}

// The items a ledger entry's status under one metric, or its exact-value status, belongs to: by name, or by rule.
export function itemsOf(tail: readonly KnownTailItem[], browser: TierBrowser, config: 'facts' | 'no-facts', entry: Pick<LedgerEntry, 'id' | 'family'>, metric: LedgerKey, status: LedgerStatus): string[] {
  const out: string[] = []
  const parts = statusParts(status)
  for (let i = 0; i < tail.length; i++) {
    const item = tail[i]!
    let member = parts.kind !== 'pass' && item.cases.some(value => value.id === entry.id && (value.browser === browser || (value.browser === 'safari' && browser === 'webkit-host')))
    const rule = item.match
    if (!member && rule !== undefined && rule.browsers.includes(browser) && rule.status === parts.kind) {
      member = (rule.configs === undefined || rule.configs.includes(config))
        && (metric === 'exact' ? rule.status === 'not exact' : rule.metrics === undefined ? metric !== 'painter' : rule.metrics.includes(metric))
        && (rule.conditions ?? []).every(name => parts.names.includes(name))
        && (rule.families === undefined || rule.families.some(prefix => entry.family.startsWith(prefix)))
    }
    if (member) out.push(item.id)
  }
  return out
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name: string): string | undefined => rest.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  switch (command) {
    case 'check': {
      const tail = readKnownTail()
      console.log(`${KNOWN_TAIL_PATH}: ${tail.items.length} items, ${tail.items.reduce((sum, item) => sum + item.cases.length, 0)} named cases, ${tail.items.filter(item => item.match !== undefined).length} rules`)
      break
    }
    case 'add': {
      const from = option('from')
      if (from === undefined) throw new Error('Usage: bun rebuild/tests/known-tail.ts add --from=<items.json>')
      const given = JSON.parse(readFileSync(resolve(from), 'utf8')) as KnownTailItem | KnownTailItem[]
      const tail = readKnownTail()
      const next: KnownTail = { ...tail, items: [...tail.items, ...(Array.isArray(given) ? given : [given])] }
      const problems = knownTailProblems(next)
      if (problems.length > 0) throw new Error(`Nothing was added:\n${problems.join('\n')}`)
      writeFileSync(KNOWN_TAIL_PATH, `${JSON.stringify(next, null, 2)}\n`)
      console.log(`${KNOWN_TAIL_PATH}: ${next.items.length} items (${next.items.length - tail.items.length} added)`)
      break
    }
    case 'status': {
      const dir = rest.find(arg => !arg.startsWith('--'))
      if (dir === undefined) throw new Error('Usage: bun rebuild/tests/known-tail.ts status <ledger dir> [--item=<id>]')
      const ledger = readLedger(resolve(dir))
      const tail = readKnownTail().items.filter(item => option('item') === undefined || item.id === option('item'))
      const browser = ledger.header.browser
      const counts = new Map<string, Map<string, string[]>>()
      for (const entry of ledger.entries) {
        for (const metric of LEDGER_KEYS) {
          const ids = itemsOf(tail, browser, ledger.header.config, entry, metric, statusAt(entry, metric))
          for (const id of ids) {
            const byStatus = counts.get(id) ?? new Map<string, string[]>()
            const key = `${metric}: ${statusAt(entry, metric)}`
            byStatus.set(key, [...(byStatus.get(key) ?? []), entry.id])
            counts.set(id, byStatus)
          }
        }
      }
      console.log(`${browser} ${ledger.header.config}, ${ledger.entries.length} cases: ${counts.size} of ${tail.length} items have members in this ledger`)
      for (const item of tail) {
        const byStatus = counts.get(item.id)
        const named = item.cases.filter(value => value.browser === browser || (value.browser === 'safari' && browser === 'webkit-host'))
        const passing = named.filter(value => ledger.entries.some(entry => entry.id === value.id) && ![...(byStatus?.values() ?? [])].some(ids => ids.includes(value.id)))
        if (byStatus === undefined && named.length === 0) continue
        console.log(`${item.id} (${item.kind}): ${item.title}`)
        const rows = [...(byStatus ?? new Map<string, string[]>())].sort((a, b) => b[1].length - a[1].length)
        const shown = rest.includes('--all') ? rows.length : 6
        for (const [key, ids] of rows.slice(0, shown)) console.log(`    ${String(ids.length).padStart(5)}  ${key}  ${ids.slice(0, 3).join(' ')}${ids.length > 3 ? ' …' : ''}`)
        if (rows.length > shown) console.log(`           … ${rows.length - shown} more statuses (--all)`)
        if (passing.length > 0) console.log(`    named cases that pass every metric and are exact here: ${passing.map(value => value.id).join(' ')}`)
        const outside = named.filter(value => !ledger.entries.some(entry => entry.id === value.id))
        if (outside.length > 0) console.log(`    named cases in no set of this ledger: ${outside.length} (${[...new Set(outside.map(value => value.where))].join(', ')})`)
      }
      break
    }
    default:
      throw new Error('Usage: bun rebuild/tests/known-tail.ts status <ledger dir> [--item=<id>] | add --from=<items.json> | check')
  }
}
