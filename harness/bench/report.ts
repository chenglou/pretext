// What the bench prints: the builds, then per browser, row and family or operation, base's and the candidate's cost (per
// 1,000 UTF-16 units, or per call for labels), candidate/base as the median over rounds of each round's paired ratio
// with its quartiles and each session's median, control/base the same way, and a verdict (`verdict()`). Then the
// costliest entry per row, the fresh pages and the bundles' sizes.
import type { DocResult, Sample } from './page.ts'

// Each row's noise floor, from a calibration of HEAD against itself (harness/README.md, Bench): the largest deviation
// from base that the candidate or the control held in one direction in all three sessions, rounded up to a whole
// percent. Calibrated 2026-09-26 at 7204cab2, `bun harness bench HEAD --sessions=3` in the foreground, in Chrome 154.0.8037.57,
// Firefox 156.0.1 and Safari 27.0 (22625.1.29.11.27), on an M5 Max (Mac17,7) under macOS 27.0 (26A428), on AC power, at
// device pixel ratio 2. Uncalibrated rows take none. The rich row's kept lines and chat documents (#456) were run against
// its floor on 2026-10-07 at e1c6ed68, in Chrome 154.0.8037.98 and the same Firefox and Safari: main against itself was
// called on none of its entries in eight sessions of the row or in three of every row.
export const FLOORS: Record<string, number> = { new: 0.06, rich: 0.05, seen: 0.01, resize: 0.05, lines: 0.01, worst: 0.02 }

// Firefox 156.0.1's rows that read slower or faster with changes to the bundle their code doesn't run (2026-10-02;
// harness/README.md, Bench, has each). A verdict on one says so, and wants a second change's table before it is blamed
// on the change.
const MOVES_WITH_BUNDLE: Record<string, readonly string[]> = {
  firefox: ['resize | latin layout at new widths', 'worst | controls layout', 'worst | invisible-tails layout'],
}

export type SessionResults = { browser: string; session: number; seed: string; docs: Array<{ row: string; family: string; id: string }>; results: Record<string, DocResult> }

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length === 0 ? NaN : s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const quartile = (xs: readonly number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!

// One session's reading of an entry: the medians over its rounds of candidate/base and control/base.
export type Reading = { candidate: number; control: number }
// A session's band: how far from base the candidate must sit to count as changed there, the larger of how far the
// control, base's own code, sat and the row's floor.
const band = (s: Reading, floor: number): number => Math.max(Math.abs(s.control - 1), floor)

export type Verdict = 'slower' | 'faster' | 'within noise'
// "slower" or "faster" only when candidate/base is outside the session's band in every session.
export function verdict(sessions: readonly Reading[], floor: number): Verdict {
  let slower = true
  let faster = true
  for (const s of sessions) {
    if (!(s.candidate > 1 + band(s, floor))) slower = false
    if (!(s.candidate < 1 - band(s, floor))) faster = false
  }
  return sessions.length > 0 && slower ? 'slower' : sessions.length > 0 && faster ? 'faster' : 'within noise'
}

const cost = (round: readonly Sample[], label: string): number => {
  const s = round.find(x => x.label === label)!
  return s.ms / s.units
}
// Paired ratios: a label's cost over base's in the same round, a ratio a round.
const ratios = (rounds: readonly Sample[][], label: string): number[] => rounds.map(round => cost(round, label) / cost(round, 'base'))
const reading = (rounds: readonly Sample[][]): Reading => ({ candidate: median(ratios(rounds, 'candidate')), control: median(ratios(rounds, 'control')) })

// One browser's entries, a table row each: the operation of a document's family, with its rounds by session in order.
type Entry = { row: string; doc: string; perCall: boolean; sessions: Sample[][][] }
function entriesOf(results: readonly SessionResults[]): Map<string, Entry> {
  const bySession = new Map<string, { entry: Entry; rounds: Map<number, Sample[][]> }>()
  for (const r of results) {
    for (const d of r.docs) {
      const result = r.results[d.id]
      if (result === undefined || 'compileMs' in result) continue
      for (let o = 0; o < result.ops.length; o++) {
        const name = `${d.row} | ${d.family} ${result.ops[o]!.op}${d.row === 'resize' ? (o === 0 ? ' at widths seen before' : ' at new widths') : ''}`
        const e = bySession.get(name) ?? { entry: { row: d.row, doc: d.id, perCall: d.family === 'labels', sessions: [] }, rounds: new Map<number, Sample[][]>() }
        bySession.set(name, e)
        e.rounds.set(r.session, [...(e.rounds.get(r.session) ?? []), ...result.ops[o]!.rounds])
      }
    }
  }
  const out = new Map<string, Entry>()
  for (const [name, e] of bySession) out.set(name, { ...e.entry, sessions: [...e.rounds].sort((a, b) => a[0] - b[0]).map(([, rounds]) => rounds) })
  return out
}

// The documents of one browser's rows that read slower or faster. After two sessions bench() times them in a third,
// and a row keeps its verdict only if that one agrees, which is the verdict three whole sessions give: a row two
// sessions don't call, a third can't.
export function unconfirmed(results: readonly SessionResults[]): string[] {
  const docs = new Set<string>()
  for (const e of entriesOf(results).values()) if (verdict(e.sessions.map(reading), FLOORS[e.row] ?? 0) !== 'within noise') docs.add(e.doc)
  return [...docs]
}

type FreshTimes = { compile: number[]; run: number[]; first: number[]; second: number[] }

const pct = (x: number): string => `${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%`

export function report(all: readonly SessionResults[], o: { builds: string; hypotheses: boolean; sizes: Record<string, { bytes: number; gzipped: number }> }): string {
  const out: string[] = ['', o.builds]
  for (const browser of new Set(all.map(r => r.browser))) {
    const results = all.filter(r => r.browser === browser)
    out.push(`\n## ${browser}`, '| row | family / operation | base | candidate | candidate/base [quartiles] per session | control/base per session | verdict |', '|---|---|---:|---:|---|---|---|')
    const fresh = new Map<string, Map<string, FreshTimes>>()
    const steps: number[] = []
    const dprs = new Set<number>()
    for (const r of results) {
      for (const d of r.docs) {
        const result = r.results[d.id]
        if (result === undefined) continue
        steps.push(result.timerStep)
        dprs.add(result.start.dpr).add(result.end.dpr)
        if (!('compileMs' in result)) continue
        const byLabel = fresh.get(d.family) ?? new Map<string, FreshTimes>()
        fresh.set(d.family, byLabel)
        const e = byLabel.get(result.label) ?? { compile: [], run: [], first: [], second: [] }
        byLabel.set(result.label, e)
        e.compile.push(result.compileMs)
        e.run.push(result.runMs)
        e.first.push(1000 * result.batches[0]!.ms / result.batches[0]!.units)
        e.second.push(1000 * result.batches[1]!.ms / result.batches[1]!.units)
      }
    }
    const costliest = new Map<string, { name: string; cost: number }>()
    for (const [name, e] of entriesOf(results)) {
      const unit = e.perCall ? 'µs/call' : 'µs/1k'
      const rounds = e.sessions.flat()
      const typical = (label: string): number => (e.perCall ? 1000 : 1_000_000) * median(rounds.map(round => cost(round, label)))
      const per = e.sessions.map(reading)
      const cand = ratios(rounds, 'candidate')
      const floor = FLOORS[e.row] ?? 0
      const v = verdict(per, floor)
      // A row without a verdict prints its widest band, the smallest change these sessions could have called: where a
      // copy of base kept another speed for a document, that is the distance between two copies, not the row's floor.
      // A verdict of two sessions waits for the third the floors are fitted to.
      const note = v === 'within noise' ? ` (±${(100 * Math.max(...per.map(s => band(s, floor)))).toFixed(1)}%)`
        : `${per.length === 2 ? ' (unconfirmed)' : ''}${MOVES_WITH_BUNDLE[browser]?.includes(name) === true ? ' (moves with the bundle)' : ''}`
      const hypothesis = o.hypotheses ? ' (hypothesis: background browsers)' : per.length === 1 ? ' (hypothesis: one session)' : ''
      const base = typical('base')
      if (base > (costliest.get(e.row)?.cost ?? -1)) costliest.set(e.row, { name, cost: base })
      out.push(`| ${name} | ${base.toFixed(1)} ${unit} | ${typical('candidate').toFixed(1)} | ${pct(median(cand))} [${pct(quartile(cand, 0.25))}, ${pct(quartile(cand, 0.75))}] ${per.map(p => pct(p.candidate)).join(' ')} | ${per.map(p => pct(p.control)).join(' ')} | ${v}${note}${hypothesis}${FLOORS[e.row] === undefined ? ' (uncalibrated)' : ''} |`)
    }
    out.push('', `timer step ${Math.min(...steps).toFixed(3)}-${Math.max(...steps).toFixed(3)} ms; device pixel ratio ${[...dprs].join(', ')}${dprs.size > 1 ? ' (it changed: the sessions aren\'t comparable)' : ''}`)
    out.push(`costliest per row (base): ${[...costliest].map(([row, c]) => `${row}: ${c.name.split(' | ')[1]} ${c.cost.toFixed(1)}`).join('; ')}`)
    if (fresh.size > 0) {
      out.push('', '| fresh page | library | compile ms | run ms | first batch µs/unit | second batch µs/unit |', '|---|---|---:|---:|---:|---:|')
      for (const [family, byLabel] of fresh) for (const [label, e] of byLabel) out.push(`| ${family} | ${label} | ${median(e.compile).toFixed(2)} | ${median(e.run).toFixed(2)} | ${median(e.first).toFixed(2)} | ${median(e.second).toFixed(2)} |`)
    }
  }
  out.push('', `bundles: ${Object.entries(o.sizes).map(([label, s]) => `${label} ${s.bytes} B minified, ${s.gzipped} B gzipped`).join('; ')}`)
  return out.join('\n')
}
