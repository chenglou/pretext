// What the bench prints: per browser, row and family or operation, base's and the candidate's cost (per 1,000 UTF-16
// units, or per call for labels), candidate/base as the median over rounds of each round's paired ratio with its
// quartiles and each session's median, control/base the same way, and a verdict. A session's band is 1 ± the larger of
// its |control/base - 1| and the row's floor; the verdict is "slower" or "faster" only when candidate/base is outside
// the band in every session. Then the costliest entry per row, the fresh pages and the bundles' sizes.
import type { DocResult, Sample } from './page.ts'

// Each row's noise floor, from a calibration of HEAD against itself (README, Bench): the largest deviation from base
// that the candidate or the control held in one direction in all three sessions, rounded up to a whole percent.
// Calibrated 2026-09-26 at 7204cab2, `bun harness bench HEAD --sessions=3` in the foreground, in Chrome 154.0.8037.57,
// Firefox 156.0.1 and Safari 27.0 (22625.1.29.11.27), on an M5 Max (Mac17,7) under macOS 27.0 (26A428), on AC power, at
// device pixel ratio 2. Uncalibrated rows take none.
export const FLOORS: Record<string, number> = { new: 0.06, rich: 0.05, seen: 0.01, resize: 0.05, lines: 0.01, worst: 0.02 }

export type SessionResults = { browser: string; session: number; seed: string; docs: Array<{ row: string; family: string; id: string }>; results: Record<string, DocResult> }

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length === 0 ? NaN : s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const quartile = (xs: readonly number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!

// Paired ratios of one round: each label's cost over base's in the same round.
function ratios(round: readonly Sample[]): Record<string, number> {
  const cost = (s: Sample): number => s.ms / s.units
  const base = round.find(s => s.label === 'base')!
  return Object.fromEntries(round.map(s => [s.label, cost(s) / cost(base)]))
}

export type Verdict = 'slower' | 'faster' | 'within noise'
// Per session, candidate/base's and control/base's medians.
export function verdict(sessions: ReadonlyArray<{ candidate: number; control: number }>, floor: number): Verdict {
  let slower = true
  let faster = true
  for (const s of sessions) {
    const band = Math.max(Math.abs(s.control - 1), floor)
    if (!(s.candidate > 1 + band)) slower = false
    if (!(s.candidate < 1 - band)) faster = false
  }
  return sessions.length > 0 && slower ? 'slower' : sessions.length > 0 && faster ? 'faster' : 'within noise'
}

const pct = (x: number): string => `${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%`

export function report(all: readonly SessionResults[], o: { hypotheses: boolean; sizes: Record<string, { bytes: number; gzipped: number }> }): string {
  const out: string[] = []
  for (const browser of new Set(all.map(r => r.browser))) {
    const sessions = new Set(all.filter(r => r.browser === browser).map(r => r.session)).size
    const hypothesis = o.hypotheses || sessions === 1 ? ` (hypothesis: ${o.hypotheses ? 'background browsers' : 'one session'})` : ''
    out.push(`\n## ${browser}`, '| row | family / operation | base | candidate | candidate/base [quartiles] per session | control/base per session | verdict |', '|---|---|---:|---:|---|---|---|')
    // key -> session -> rounds
    const entries = new Map<string, { row: string; perCall: boolean; bySession: Map<number, Sample[][]> }>()
    const fresh = new Map<string, Map<string, { compile: number[]; run: number[]; first: number[]; second: number[] }>>()
    const steps: number[] = []
    const dprs = new Set<number>()
    for (const r of all.filter(x => x.browser === browser)) {
      for (const d of r.docs) {
        const result = r.results[d.id]
        if (result === undefined) continue
        steps.push(result.timerStep)
        dprs.add(result.start.dpr).add(result.end.dpr)
        if ('compileMs' in result) {
          const byLabel = fresh.get(d.family) ?? new Map()
          fresh.set(d.family, byLabel)
          const e = byLabel.get(result.label) ?? { compile: [], run: [], first: [], second: [] }
          byLabel.set(result.label, e)
          e.compile.push(result.compileMs)
          e.run.push(result.runMs)
          e.first.push(1000 * result.batches[0]!.ms / result.batches[0]!.units)
          e.second.push(1000 * result.batches[1]!.ms / result.batches[1]!.units)
          continue
        }
        for (let o2 = 0; o2 < result.ops.length; o2++) {
          const key = `${d.row}\t${d.family} ${result.ops[o2]!.op}${d.row === 'resize' ? (o2 === 0 ? ' at widths seen before' : ' at new widths') : ''}`
          const e = entries.get(key) ?? { row: d.row, perCall: d.family === 'labels', bySession: new Map() }
          entries.set(key, e)
          e.bySession.set(r.session, [...(e.bySession.get(r.session) ?? []), ...result.ops[o2]!.rounds])
        }
      }
    }
    const costliest = new Map<string, { key: string; cost: number }>()
    for (const [key, e] of entries) {
      const rounds = [...e.bySession.values()].flat()
      const cost = (label: string): number => median(rounds.map(round => { const s = round.find(x => x.label === label)!; return (e.perCall ? 1000 : 1_000_000) * s.ms / s.units }))
      const unit = e.perCall ? 'µs/call' : 'µs/1k'
      const per = [...e.bySession].sort((a, b) => a[0] - b[0]).map(([, rs]) => ({ candidate: median(rs.map(x => ratios(x)['candidate']!)), control: median(rs.map(x => ratios(x)['control']!)) }))
      const all2 = rounds.map(x => ratios(x))
      const cand = all2.map(x => x['candidate']!)
      const v = verdict(per, FLOORS[e.row] ?? 0)
      const base = cost('base')
      if (base > (costliest.get(e.row)?.cost ?? -1)) costliest.set(e.row, { key, cost: base })
      out.push(`| ${key.replace('\t', ' | ')} | ${base.toFixed(1)} ${unit} | ${cost('candidate').toFixed(1)} | ${pct(median(cand))} [${pct(quartile(cand, 0.25))}, ${pct(quartile(cand, 0.75))}] ${per.map(p => pct(p.candidate)).join(' ')} | ${per.map(p => pct(p.control)).join(' ')} | ${v}${hypothesis}${FLOORS[e.row] === undefined ? ' (uncalibrated)' : ''} |`)
    }
    out.push('', `timer step ${Math.min(...steps).toFixed(3)}-${Math.max(...steps).toFixed(3)} ms; device pixel ratio ${[...dprs].join(', ')}${dprs.size > 1 ? ' (it changed: the sessions aren\'t comparable)' : ''}`)
    out.push(`costliest per row (base): ${[...costliest].map(([row, c]) => `${row}: ${c.key.split('\t')[1]} ${c.cost.toFixed(1)}`).join('; ')}`)
    if (fresh.size > 0) {
      out.push('', '| fresh page | library | compile ms | run ms | first batch µs/unit | second batch µs/unit |', '|---|---|---:|---:|---:|---:|')
      for (const [family, byLabel] of fresh) for (const [label, e] of byLabel) out.push(`| ${family} | ${label} | ${median(e.compile).toFixed(2)} | ${median(e.run).toFixed(2)} | ${median(e.first).toFixed(2)} | ${median(e.second).toFixed(2)} |`)
    }
  }
  out.push('', `bundles: ${Object.entries(o.sizes).map(([label, s]) => `${label} ${s.bytes} B minified, ${s.gzipped} B gzipped`).join('; ')}`)
  return out.join('\n')
}
