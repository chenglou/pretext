// Summarizes the Chrome runs of blink-probes.ts for rebuild/specs/probes-chrome.md. Per hypothesis: the checks that apply
// to each run (a check with dpr 1 or 2 counts only in a run at that devicePixelRatio), failures with expected and measured
// values, and the cross-run comparisons: blink-canvas H10 across DPRs, blink-lines H2 and CRITIC W8 at DPR 1 vs DPR 2, and
// blink-lines H3 in the emulated run only. The automatic verdict uses the native DPR 2 run plus the DPR 1 checks of the
// forced DPR 1 run. Checks named 'supplementary: ...' are extra measurements for the explanation; they are printed but
// don't decide the verdict. The fresh-browser system-ui runs (sysui-dpr2, sysui-dpr1) decide the cache-order probe.
// usage: bun rebuild/probes/blink-verdicts.ts [--dir=.artifacts/probes/blink] [--json=<file>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

type Check = { name: string; ok: boolean; expected: unknown; measured: unknown; dpr: number | null }
type ScriptValue = { dpr: number; visualViewportScale: number | null; checks: Check[]; value: unknown }
type Observation = { kind: string; value?: unknown; error?: string }
type Output = {
  status: string
  errors: string[]
  envs: Array<{ devicePixelRatio: number; visualViewportScale: number | null; hasFocus: boolean; visibilityState: string }>
  results: Array<{ id: string; spec: string; result: { observations: Observation[]; errors: string[] } | null }>
}
type Entry = { dpr: number | null; script: ScriptValue | null; error: string | null }
type Summary = { run: string; dpr: number | null; applicable: number; passed: number; failures: Check[]; supplementary: Check[]; error: string | null }
type Rows = Array<{ k128: number; z1: number; z2: number; actual: number }>

const args = new Map(process.argv.slice(2).map(arg => {
  const match = /^--([a-z]+)=(.*)$/.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  return [match[1]!, match[2]!] as const
}))
const dir = resolve(args.get('dir') ?? '.artifacts/probes/blink')
const RUNS = ['dpr2', 'dpr1', 'dsf3.5', 'emulated', 'sysui-dpr2', 'sysui-dpr1']

const runs = new Map<string, { output: Output; byId: Map<string, Entry> }>()
for (let i = 0; i < RUNS.length; i++) {
  const path = join(dir, RUNS[i]!, 'chrome-probes.json')
  if (!existsSync(path)) continue
  const output = JSON.parse(readFileSync(path, 'utf8')) as Output
  const byId = new Map<string, Entry>()
  for (let k = 0; k < output.results.length; k++) {
    const row = output.results[k]!
    if (row.result === null) {
      byId.set(row.id, { dpr: null, script: null, error: 'not observed' })
      continue
    }
    const observation = row.result.observations[0]
    if (observation === undefined || observation.error !== undefined) {
      byId.set(row.id, { dpr: null, script: null, error: observation?.error ?? row.result.errors.join('; ') })
      continue
    }
    const script = observation.value as ScriptValue
    byId.set(row.id, { dpr: script.dpr, script, error: row.result.errors.length > 0 ? row.result.errors.join('; ') : null })
  }
  runs.set(RUNS[i]!, { output, byId })
}

function short(value: unknown, limit = 400): string {
  const text = JSON.stringify(value)
  if (text === undefined) return 'undefined'
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

const isSupplementary = (check: Check): boolean => check.name.startsWith('supplementary')

function summarize(run: string, entry: Entry | undefined, filter: (check: Check, dpr: number) => boolean): Summary | null {
  if (entry === undefined) return null
  if (entry.script === null) return { run, dpr: entry.dpr, applicable: 0, passed: 0, failures: [], supplementary: [], error: entry.error }
  const dpr = entry.script.dpr
  const applicable = entry.script.checks.filter(check => filter(check, dpr))
  const decisive = applicable.filter(check => !isSupplementary(check))
  return {
    run, dpr, applicable: decisive.length, passed: decisive.filter(check => check.ok).length, failures: decisive.filter(check => !check.ok),
    supplementary: applicable.filter(isSupplementary), error: entry.error,
  }
}

const applies = (check: Check, dpr: number): boolean => check.dpr === null || check.dpr === dpr

type Row = { id: string; verdict: string; summaries: Summary[]; notes: string[] }
const rows: Row[] = []
const main = runs.get('dpr2') ?? runs.values().next().value
if (main === undefined) throw new Error(`No run outputs under ${dir}`)

function crossRunRows(label: string, a: Rows | undefined, b: Rows | undefined, summaries: Summary[], notes: string[]): void {
  if (a === undefined || b === undefined) return
  const differing = b.filter(row => {
    const other = a.find(candidate => candidate.k128 === row.k128)
    return other !== undefined && other.actual !== row.actual
  })
  const asPredicted = differing.every(row => row.actual === row.z2 && a.find(candidate => candidate.k128 === row.k128)!.actual === row.z1)
  const predictedDiffering = b.filter(row => row.z1 !== row.z2).map(row => row.k128)
  const ok = asPredicted && short(differing.map(row => row.k128)) === short(predictedDiffering)
  summaries.push({
    run: `dpr1 vs dpr2 (${label})`, dpr: null, applicable: 1, passed: ok ? 1 : 0,
    failures: ok ? [] : [{ name: `${label}: the DPR 1 and DPR 2 runs differ exactly where the formulas differ`, ok: false, expected: predictedDiffering, measured: differing.map(row => row.k128), dpr: null }],
    supplementary: [], error: null,
  })
  notes.push(`${label}: widths (k/128) where the runs differ ${differing.map(row => row.k128).join(', ') || 'none'}; formulas differ at ${predictedDiffering.join(', ') || 'none'}`)
}

for (let i = 0; i < main.output.results.length; i++) {
  const id = main.output.results[i]!.id
  const notes: string[] = []
  const summaries: Summary[] = []
  if (id === 'blink-lines H3') {
    const emulated = summarize('emulated', runs.get('emulated')?.byId.get(id), applies)
    if (emulated !== null) summaries.push(emulated)
  } else if (id === 'cross X5 (system-ui cache order)') {
    for (const run of ['sysui-dpr2', 'sysui-dpr1']) {
      const summary = summarize(run, runs.get(run)?.byId.get(id), applies)
      if (summary !== null) summaries.push(summary)
    }
    const other = summarize('dpr2 (not first in its browser)', runs.get('dpr2')?.byId.get(id), applies)
    if (other !== null) notes.push(`main DPR 2 run: ${other.passed}/${other.applicable}`)
  } else if (id === 'blink-canvas H10') {
    const widths: string[] = []
    const values = new Set<number>()
    for (const [run, data] of runs) {
      const entry = data.byId.get(id)
      if (entry === undefined || entry.script === null) continue
      const width = (entry.script.value as { width: number }).width
      values.add(width)
      widths.push(`${run} (DPR ${entry.script.dpr}): ${width}`)
    }
    summaries.push({ run: 'all', dpr: null, applicable: 1, passed: values.size === 1 ? 1 : 0, failures: values.size === 1 ? [] : [{ name: 'identical W across runs', ok: false, expected: 'one value', measured: widths, dpr: null }], supplementary: [], error: null })
    notes.push(widths.join('; '))
  } else {
    const dpr2 = summarize('dpr2', runs.get('dpr2')?.byId.get(id), applies)
    if (dpr2 !== null) summaries.push(dpr2)
    const dpr1 = summarize('dpr1 (DPR 1 checks)', runs.get('dpr1')?.byId.get(id), check => check.dpr === 1)
    if (dpr1 !== null && (dpr1.applicable > 0 || dpr1.supplementary.length > 0)) summaries.push(dpr1)
    const dpr1Other = summarize('dpr1 (other checks)', runs.get('dpr1')?.byId.get(id), check => check.dpr === null)
    if (dpr1Other !== null && dpr1Other.failures.length > 0) notes.push(`forced DPR 1 run, DPR-independent checks failing: ${dpr1Other.failures.map(check => `${check.name} expected ${short(check.expected, 160)} measured ${short(check.measured, 160)}`).join(' | ')}`)
    for (const run of ['dsf3.5', 'emulated', 'sysui-dpr2', 'sysui-dpr1']) {
      const other = summarize(run, runs.get(run)?.byId.get(id), check => check.dpr === null)
      if (other !== null && other.applicable > 0) notes.push(`${run}: ${other.passed}/${other.applicable} DPR-independent checks pass${other.failures.length > 0 ? `; failing: ${other.failures.map(check => `${check.name} expected ${short(check.expected, 160)} measured ${short(check.measured, 160)}`).join(' | ')}` : ''}`)
    }
    if (id === 'blink-lines H2' || id === 'CRITIC W8') {
      const a = runs.get('dpr1')?.byId.get(id)?.script?.value as { rows: Rows; extra: Array<{ text: string; rows: Rows }> } | undefined
      const b = runs.get('dpr2')?.byId.get(id)?.script?.value as { rows: Rows; extra: Array<{ text: string; rows: Rows }> } | undefined
      crossRunRows('nnnnn nnnnn', a?.rows, b?.rows, summaries, notes)
      if (a !== undefined && b !== undefined) {
        for (let k = 0; k < b.extra.length; k++) {
          const other = a.extra.find(candidate => candidate.text === b.extra[k]!.text)
          crossRunRows(`supplementary ${b.extra[k]!.text}`, other?.rows, b.extra[k]!.rows, [], notes)
        }
      }
    }
  }
  let verdict = 'not-run'
  if (summaries.length > 0) {
    if (summaries.some(summary => summary.error !== null && summary.applicable === 0)) verdict = 'inconclusive'
    else if (summaries.some(summary => summary.failures.length > 0)) verdict = 'refuted'
    else if (summaries.every(summary => summary.applicable === 0)) verdict = 'inconclusive'
    else verdict = 'confirmed'
  }
  rows.push({ id, verdict, summaries, notes })
}

for (const [run, data] of runs) {
  console.log(`# run ${run}: status ${data.output.status}${data.output.errors.length > 0 ? ` errors ${short(data.output.errors)}` : ''}; envs ${short(data.output.envs)}`)
}
for (let i = 0; i < rows.length; i++) {
  const row = rows[i]!
  console.log(`\n## ${row.id}: ${row.verdict}`)
  for (let k = 0; k < row.summaries.length; k++) {
    const summary = row.summaries[k]!
    console.log(`  ${summary.run}${summary.dpr === null ? '' : ` DPR ${summary.dpr}`}: ${summary.passed}/${summary.applicable}${summary.error === null ? '' : ` ERROR ${short(summary.error, 300)}`}`)
    for (let f = 0; f < summary.failures.length; f++) {
      const failure = summary.failures[f]!
      console.log(`    FAIL ${failure.name}\n      expected ${short(failure.expected)}\n      measured ${short(failure.measured)}`)
    }
    for (let f = 0; f < summary.supplementary.length; f++) {
      const extra = summary.supplementary[f]!
      console.log(`    ${extra.ok ? 'supp ok' : 'SUPP FAIL'} ${extra.name}${extra.ok ? '' : `\n      expected ${short(extra.expected)}\n      measured ${short(extra.measured)}`}`)
    }
  }
  for (let k = 0; k < row.notes.length; k++) console.log(`  note: ${row.notes[k]}`)
}
const counts = new Map<string, number>()
for (let i = 0; i < rows.length; i++) counts.set(rows[i]!.verdict, (counts.get(rows[i]!.verdict) ?? 0) + 1)
console.log(`\n# totals ${short(Object.fromEntries(counts))}`)
const jsonPath = args.get('json')
if (jsonPath !== undefined) writeFileSync(resolve(jsonPath), JSON.stringify(rows, null, 1) + '\n')
