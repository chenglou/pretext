// Two tier 2 runs of the same sets, case by case (rebuild/lab/README.md, "Measure first"): per part, lab/compare-rows.ts over
// the two runs' rows, so every case whose native observation, prediction or painted lines differ is listed with what differs
// first. Its uses: a measure-first run against a usual one (the prediction asked of Canvas before or after the document's
// native layout), and two usual runs of one library as the control that says how much two runs differ by themselves.
//
//   bun rebuild/tests/compare-sets.ts <tier 2 out dir> <other out dir> [--out=<report.json>] [--orders=forward[,reverse]]
//     [--prediction=line-ranges]
//
// Both folders are browser-sets.ts --out folders of the same browser and configuration. The report lists, per set and part,
// the counts and every differing case; the printed table has the counts and, per set, the families of the cases whose
// prediction or native lines moved. Exit 1 when anything differs, 2 when the runs don't hold the same sets.
//
// --prediction=line-ranges is the third use (research/ARCHITECTURE-PLAN-2.md §8, X1's gate): the first folder is a run of a
// predictor that returns line ranges alone (browser-sets.ts --predictor=rebuild/lab/baselines/plain-predictor.ts), the
// second a usual run, and the predictions are compared as line ranges (lab/compare-rows.ts says how). Exit 1 when a row is
// missing or ranges differ, 3 when only native observations do: those are read one by one, as history effects of the
// plain path's smaller set of Canvas questions, and go to the ledger as such.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compareRowFiles, comparisonExit, type PredictionView, type RowComparison } from '../lab/compare-rows.ts'
import { existingRows } from '../lab/rows.ts'
import type { SetsRun } from './ledger.ts'
import { REPO } from './sets.ts'

const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const option = (name: string): string | undefined => process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
if (positional.length !== 2) {
  console.error('Usage: bun rebuild/tests/compare-sets.ts <tier 2 out dir> <other out dir> [--out=<report.json>] [--orders=forward[,reverse]] [--prediction=line-ranges]')
  process.exit(2)
}
const dirs = positional.map(dir => resolve(dir))
const records = dirs.map(dir => {
  const path = join(dir, 'sets-run.json')
  if (!existsSync(path)) {
    console.error(`[compare-sets] ${path}: not a browser-sets.ts --out folder`)
    process.exit(2)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SetsRun
})
const [first, second] = records as [SetsRun, SetsRun]
if (first.browser !== second.browser || first.config !== second.config) {
  console.error(`[compare-sets] ${first.browser} ${first.config} against ${second.browser} ${second.config}: compare runs of one browser and configuration`)
  process.exit(2)
}
const view: PredictionView = option('prediction') === 'line-ranges' ? 'line-ranges' : 'whole'
const orders = (option('orders') ?? 'forward').split(',').filter(order => order === 'forward' || order === 'reverse') as Array<'forward' | 'reverse'>

type PartReport = { set: string; part: number; order: 'forward' | 'reverse'; comparison: RowComparison }
const parts: PartReport[] = []
const absent: string[] = []
for (const set of first.sets) {
  const other = second.sets.find(candidate => candidate.name === set.name)
  if (other === undefined) {
    absent.push(set.name)
    continue
  }
  for (const part of set.parts) {
    const otherPart = other.parts.find(candidate => candidate.part === part.part)
    for (const order of orders) {
      const dir = part[order]
      const otherDir = otherPart?.[order] ?? null
      if (dir === null) continue
      if (otherDir === null) {
        absent.push(`${set.name} part ${part.part} ${order}`)
        continue
      }
      const rows = existingRows(join(REPO, dir, `${first.browser}-rows.ndjson`))
      const otherRows = existingRows(join(REPO, otherDir, `${first.browser}-rows.ndjson`))
      if (rows === null || otherRows === null) {
        absent.push(`${set.name} part ${part.part} ${order} (no rows)`)
        continue
      }
      parts.push({ set: set.name, part: part.part, order, comparison: await compareRowFiles(rows, otherRows, null, view) })
    }
  }
}

const protocolOf = (run: SetsRun): string => [...new Set(run.sets.flatMap(set => set.protocol.runArgs))].join(' ') || 'usual'
console.log(`${first.browser} ${first.config}: ${dirs[0]} (${protocolOf(first)}) against ${dirs[1]} (${protocolOf(second)})`)
console.log(`set | part | order | rows | native differs (in what the scorer compares) | ${view === 'whole' ? 'prediction differs | painted lines differ' : 'line ranges differ | painted lines (not compared)'}`)
const totals = { rows: 0, native: 0, nativeScorerView: 0, prediction: 0, painter: 0, missing: 0 }
for (const { set, part, order, comparison } of parts) {
  console.log(`${set} | ${part} | ${order} | ${comparison.rows} | ${comparison.native} (${comparison.nativeScorerView}) | ${comparison.prediction} | ${comparison.painter}${comparison.missing.length === 0 ? '' : ` | ${comparison.missing.length} missing`}`)
  totals.rows += comparison.rows
  totals.native += comparison.native
  totals.nativeScorerView += comparison.nativeScorerView
  totals.prediction += comparison.prediction
  totals.painter += comparison.painter
  totals.missing += comparison.missing.length
}
console.log(`all | | | ${totals.rows} | ${totals.native} (${totals.nativeScorerView}) | ${totals.prediction} | ${totals.painter}${totals.missing === 0 ? '' : ` | ${totals.missing} missing`}`)
// The cases that matter most: a prediction that differs, or native lines that do, by family.
const families = new Map<string, { prediction: number; native: number; ids: string[] }>()
for (const { comparison } of parts) {
  for (const difference of comparison.differences) {
    const nativeMoved = difference.native !== undefined && difference.native.scorerView !== null
    if (difference.prediction === undefined && !nativeMoved) continue
    const entry = families.get(difference.family) ?? { prediction: 0, native: 0, ids: [] }
    if (difference.prediction !== undefined) entry.prediction++
    if (nativeMoved) entry.native++
    if (entry.ids.length < 3) entry.ids.push(difference.id)
    families.set(difference.family, entry)
  }
}
for (const [family, entry] of [...families].sort((a, b) => b[1].prediction + b[1].native - a[1].prediction - a[1].native)) {
  console.log(`  ${family}: prediction ${entry.prediction}, native ${entry.native}; ${entry.ids.join(', ')}`)
}
for (const name of absent) console.log(`not compared: ${name}`)
const out = option('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify({ browser: first.browser, config: first.config, runs: dirs, protocols: records.map(protocolOf), orders, totals, absent, parts }, null, 2)}\n`)
process.exit(absent.length > 0 ? 2 : comparisonExit(totals, view))
