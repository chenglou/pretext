// Verdicts for the Firefox gecko probes. Reads the main run and the app-unit runs, and writes verdicts.json plus a
// markdown table under .artifacts/probes/gecko/. A probe is confirmed when every check holds in every run it took part
// in, refuted when a check failed, inconclusive when a precondition failed or the probe errored.
//   bun rebuild/probes/gecko-verdicts.ts [--dump]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProbeOutput } from './types.ts'

const OUT = resolve(import.meta.dir, '../../.artifacts/probes/gecko')
const RUNS: Array<{ name: string; dir: string; label: string }> = [
  { name: 'main', dir: 'main', label: 'DPR 2 (apd 30)' },
  { name: 'apd60', dir: 'apd60', label: 'devPixelsPerPx 1.0 (apd 60, DPR 1)' },
  { name: 'apd40', dir: 'apd40', label: 'devPixelsPerPx 1.5 (apd 40)' },
  { name: 'apd27', dir: 'apd27', label: 'devPixelsPerPx 2.2222222 (apd 27, as 110% zoom at DPR 2)' },
  { name: 'apd23', dir: 'apd23', label: 'devPixelsPerPx 2.6086957 (apd 23, as 133% zoom at DPR 2)' },
  { name: 'followup', dir: 'followup', label: 'DPR 2 follow-up (probes added after the main run)' },
]
const dump = process.argv.includes('--dump')

type Check = { name: string; measured: unknown; expected: unknown; ok: boolean }
type ScriptValue = { checks: Check[]; pre: Check[]; raw: Record<string, unknown>; stable: boolean; env: { dpr: number } }
type RunVerdict = { run: string; verdict: 'confirmed' | 'refuted' | 'inconclusive'; failed: Check[]; failedPre: Check[]; checks: Check[]; stable: boolean | null; error: string | null; raw: Record<string, unknown> | null; dpr: number | null }

function compact(value: unknown, max = 260): string {
  const text = JSON.stringify(value, (_, v: unknown) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v) ?? 'undefined'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function verdictOf(run: string, result: ProbeOutput['results'][number]['result']): RunVerdict {
  const base = { run, failed: [], failedPre: [], checks: [], stable: null, raw: null, dpr: null }
  if (result === null) return { ...base, verdict: 'inconclusive', error: 'no result' }
  if (result.errors.length > 0) return { ...base, verdict: 'inconclusive', error: result.errors.join('; ') }
  const script = result.observations.find(o => o.kind === 'script') as { kind: 'script'; value?: ScriptValue; error?: string } | undefined
  if (script === undefined || script.error !== undefined || script.value === undefined) return { ...base, verdict: 'inconclusive', error: script?.error ?? 'no script observation' }
  const value = script.value
  const failedPre = value.pre.filter(c => !c.ok)
  const failed = value.checks.filter(c => !c.ok)
  const verdict = failedPre.length > 0 ? 'inconclusive' : failed.length > 0 ? 'refuted' : 'confirmed'
  return { run, verdict, failed, failedPre, checks: value.checks, stable: value.stable, error: null, raw: value.raw, dpr: value.env?.dpr ?? null }
}

const outputs = new Map<string, ProbeOutput>()
for (let i = 0; i < RUNS.length; i++) {
  const path = join(OUT, RUNS[i]!.dir, 'firefox-probes.json')
  if (existsSync(path)) outputs.set(RUNS[i]!.name, JSON.parse(readFileSync(path, 'utf8')) as ProbeOutput)
}
const main = outputs.get('main')
if (main === undefined) throw new Error('No main run')

type Row = { id: string; spec: string; expected: string; verdict: string; measured: string; runs: RunVerdict[] }
const rows: Row[] = []
// Probes of the main run in order, then probes that only a follow-up run has.
const entries = [...main.results]
for (const [name, output] of outputs) {
  if (name === 'main') continue
  for (let i = 0; i < output.results.length; i++) if (!entries.some(e => e.id === output.results[i]!.id)) entries.push(output.results[i]!)
}
for (let i = 0; i < entries.length; i++) {
  const entry = entries[i]!
  const runs: RunVerdict[] = []
  for (const [name, output] of outputs) {
    const other = output.results.find(r => r.id === entry.id)
    if (other !== undefined) runs.push(verdictOf(name, other.result))
  }
  // gecko-canvas H21: OffscreenCanvas widths must not change with apd.
  if (entry.id === 'gecko-canvas H21') {
    const mainOc = (runs.find(r => r.run === 'main')?.raw?.['oc'] ?? null) as number[] | null
    for (let k = 0; k < runs.length; k++) {
      const run = runs[k]!
      if (run.run === 'main' || run.raw === null || mainOc === null) continue
      const oc = run.raw['oc'] as number[]
      const same = oc.every((w, j) => Math.round(w * 60) === Math.round(mainOc[j]! * 60))
      const check: Check = { name: 'OC widths unchanged from the DPR 2 run', measured: { oc, main: mainOc }, expected: 'equal', ok: same }
      run.checks.push(check)
      if (!same) { run.failed.push(check); if (run.verdict === 'confirmed') run.verdict = 'refuted' }
    }
  }
  const verdict = runs.some(r => r.verdict === 'refuted') ? 'refuted' : runs.every(r => r.verdict === 'confirmed') ? 'confirmed' : 'inconclusive'
  const parts: string[] = []
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k]!
    const prefix = runs.length > 1 ? `[${run.run}] ` : ''
    if (run.error !== null) parts.push(`${prefix}error: ${run.error.slice(0, 200)}`)
    else if (run.failedPre.length > 0) parts.push(prefix + run.failedPre.map(c => `precondition ${c.name}: ${compact(c.measured)}`).join('; '))
    else if (run.failed.length > 0) parts.push(prefix + run.failed.map(c => `${c.name}: ${compact(c.measured)}`).join('; '))
    else {
      const text = run.checks.map(c => `${c.name}: ${compact(c.measured, 90)}`).join('; ')
      parts.push(prefix + (text.length > 460 ? `${text.slice(0, 460)}…` : text))
    }
    if (run.stable === false) parts.push(`${prefix}(first pass differed; second pass used)`)
  }
  rows.push({ id: entry.id, spec: entry.spec, expected: entry.probe.note ?? '', verdict, measured: parts.join(' | '), runs })
}

writeFileSync(join(OUT, 'verdicts.json'), JSON.stringify({ runs: [...outputs.keys()], rows }, null, 2) + '\n')
const escape = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const table = ['| id | verdict | measured | expected |', '|---|---|---|---|', ...rows.map(r => `| ${escape(r.id)} | ${r.verdict} | ${escape(r.measured)} | ${escape(r.expected)} |`)].join('\n')
writeFileSync(join(OUT, 'verdicts-table.md'), table + '\n')
const counts: Record<string, number> = {}
for (let i = 0; i < rows.length; i++) counts[rows[i]!.verdict] = (counts[rows[i]!.verdict] ?? 0) + 1
console.log(`runs: ${[...outputs.keys()].join(', ')}; ${rows.length} probes; ${JSON.stringify(counts)}`)
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]!
  if (dump || row.verdict !== 'confirmed') console.log(`\n${row.id}: ${row.verdict}\n  ${row.measured}`)
}
