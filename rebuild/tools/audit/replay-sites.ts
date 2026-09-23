// Where the plain path's Canvas questions come from, over the answers a browser gave (a run of count-predictor.ts with
// --record-measurements): every case is predicted again offline under the replay of its record (lab/measurements.ts
// installReplay), every measureText call's stack is read, and the call is put under the mechanism that asked it
// (mechanisms.ts). The line ranges must equal the row's, or the case is reported and left out.
//
//   bun rebuild/tools/audit/replay-sites.ts --run=<run dir> --browser=<b> [--json=<out.json>] [--chains=<n>] [--ko=<name>[+<name>]]
// With --ko, the knockout switches of the audit's scratch tree are set (tools/audit/knockouts.patch applied), and a case
// whose knockout asks a question the record doesn't hold is counted as unreplayable.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installReplay, NewQuestion, type PageFacts } from '../../lab/measurements.ts'
import type { CaseMeasurements } from '../../lab/record.ts'
import type { Case, LabRow } from '../../lab/types.ts'
import { predict } from './count-predictor.ts'
import { groupOf } from './counts.ts'
import { mechanismOf } from './mechanisms.ts'

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))
const run = args.get('run')!
const browser = args.get('browser')!
const chainsTop = Number(args.get('chains') ?? 0)
const ko = args.get('ko')
if (ko !== undefined && ko !== '') {
  const flags: Record<string, true> = {}
  for (const name of ko.split('+')) flags[name] = true
  ;(globalThis as { __auditKO?: Record<string, true> }).__auditKO = flags
}

function readLines(path: string): string[] {
  const bytes = path.endsWith('.zst') ? Bun.spawnSync(['zstd', '-dc', path], { stdout: 'pipe', maxBuffer: 2 ** 32 }).stdout : readFileSync(path)
  return new TextDecoder().decode(bytes).split('\n').filter(l => l !== '')
}

const rows = readLines(join(run, `${browser}-rows.ndjson`))
const records = readLines(join(run, `${browser}-measurements.ndjson.zst`))
if (rows.length !== records.length) throw new Error(`${rows.length} rows, ${records.length} records`)

Error.stackTraceLimit = 200
type Tally = { calls: number; chars: number; repeats: number }
type Group = { n: number; units: number; calls: number; chars: number; byMechanism: Map<string, Tally>; unreplayable: number; changed: number; changedIds: string[] }
const groups = new Map<string, Group>()
const chains = new Map<string, Tally>()
let current: { g: Group[]; seen: Map<object, Set<string>> } | null = null

function tally(g: Group, key: string, chars: number, repeat: boolean): void {
  const t = g.byMechanism.get(key) ?? { calls: 0, chars: 0, repeats: 0 }
  t.calls++
  t.chars += chars
  if (repeat) t.repeats++
  g.byMechanism.set(key, t)
}

const stackCache = new Map<string, { mechanism: string; chain: string }>()
function readStack(stack: string): { mechanism: string; chain: string } {
  let read = stackCache.get(stack)
  if (read !== undefined) return read
  const names: string[] = []
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.includes('/rebuild/src/')) continue
    const m = /at (?:async )?([^\s(]+)/.exec(line)
    const file = /\/rebuild\/src\/([^:]+)/.exec(line)?.[1] ?? '?'
    const name = `${m?.[1] ?? '?'}@${file.replace(/^engines\//, '').replace(/\.ts$/, '')}`
    if (names[names.length - 1] !== name) names.push(name)
  }
  read = { mechanism: mechanismOf(browser, names), chain: names.slice(0, 7).join(' < ') }
  stackCache.set(stack, read)
  return read
}

for (let i = 0; i < rows.length; i++) {
  const row = JSON.parse(rows[i]!) as LabRow & { prediction: { lines?: { start: number; end: number }[] } }
  const record = JSON.parse(records[i]!) as CaseMeasurements
  if (record.id !== row.id) throw new Error(`record ${record.id} for row ${row.id}`)
  const c = row.case as Case
  let units = 0
  for (const r of c.paragraph.runs) units += r.text.length
  const keys = [groupOf(row.family), row.family.startsWith('chat/') ? 'chat (all)' : 'real (all)']
  const gs: Group[] = []
  for (const key of keys) {
    let g = groups.get(key)
    if (g === undefined) { g = { n: 0, units: 0, calls: 0, chars: 0, byMechanism: new Map(), unreplayable: 0, changed: 0, changedIds: [] }; groups.set(key, g) }
    gs.push(g)
  }
  const env: PageFacts = { userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, pageLang: row.env.pageLang }
  const replay = installReplay(record, env, 'predict')
  const probe = new OffscreenCanvas(1, 1).getContext('2d') as unknown as object
  const proto = Object.getPrototypeOf(probe) as { measureText: (this: object, s: string) => unknown }
  const original = proto.measureText
  const seen = new Map<object, Set<string>>()
  current = { g: gs, seen }
  proto.measureText = function (this: object, s: string) {
    const answer = original.call(this, s)
    let set = seen.get(this)
    if (set === undefined) { set = new Set(); seen.set(this, set) }
    const repeat = set.has(s)
    set.add(s)
    const read = readStack(new Error().stack ?? '')
    for (const g of gs) { g.calls++; g.chars += s.length; tally(g, read.mechanism, s.length, repeat) }
    if (chainsTop > 0) {
      const t = chains.get(`${read.mechanism} :: ${read.chain}`) ?? { calls: 0, chars: 0, repeats: 0 }
      t.calls++; t.chars += s.length; if (repeat) t.repeats++
      chains.set(`${read.mechanism} :: ${read.chain}`, t)
    }
    return answer
  }
  // The replay's context class is made per case; the probe context above is one of its instances and asks nothing.
  let result: ReturnType<typeof predict>
  try {
    result = predict(c, { browser: row.browser, build: row.build!.engine, languages: row.languages!.given })
  } catch (error) {
    if (!(error instanceof NewQuestion)) throw error
    result = { error: 'new question' }
  } finally {
    replay.restore()
  }
  for (const g of gs) { g.n++; g.units += units }
  if ('error' in result) {
    for (const g of gs) g.unreplayable++
    continue
  }
  const same = JSON.stringify(result.lines) === JSON.stringify(row.prediction.lines)
  if (!same) for (const g of gs) { g.changed++; if (g.changedIds.length < 50) g.changedIds.push(row.id) }
}
void current

const out: Record<string, unknown> = {}
for (const [key, g] of [...groups.entries()].sort()) {
  const mech = [...g.byMechanism.entries()].sort((a, b) => b[1].chars - a[1].chars)
  console.log(`\n== ${browser} ${key}: ${g.n} paragraphs, ${(g.units / g.n).toFixed(0)} units a paragraph; ${(g.calls / g.n).toFixed(1)} calls, ${(g.chars / g.n).toFixed(0)} characters a paragraph; unreplayable ${g.unreplayable}, lines changed ${g.changed}`)
  for (const [m, t] of mech) {
    console.log(`  ${m.padEnd(46)} ${(t.calls / g.n).toFixed(2).padStart(8)} calls ${(100 * t.calls / g.calls).toFixed(1).padStart(5)}%  ${(t.chars / g.n).toFixed(1).padStart(9)} chars ${(100 * t.chars / g.chars).toFixed(1).padStart(5)}%  repeats ${(100 * t.repeats / Math.max(1, t.calls)).toFixed(0)}%`)
  }
  out[key] = { n: g.n, units: g.units, calls: g.calls, chars: g.chars, unreplayable: g.unreplayable, changed: g.changed, changedIds: g.changedIds, byMechanism: Object.fromEntries(mech) }
}
if (chainsTop > 0) {
  console.log('\nchains:')
  for (const [k, t] of [...chains.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, chainsTop)) console.log(`${String(t.calls).padStart(8)} ${String(t.chars).padStart(9)}  ${k}`)
}
if (args.has('json')) writeFileSync(args.get('json')!, JSON.stringify(out, null, 1))
