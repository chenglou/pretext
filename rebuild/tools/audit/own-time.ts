// Own code with free answers, in bun: the plain path over a recording's cases (replayed answers, lab/measurements.ts),
// with and without a knockout that asks a subset of the recorded questions, alternating. A JavaScriptCore number, not a
// browser's: it says how much of a knockout's saving is the library's own work, not Canvas's.
//   bun rebuild/tools/audit/own-time.ts --run=<recording dir> --browser=<b> --ko=<name>[+<name>] [--rounds=5]
// A knockout that asks a question the recording lacks throws (lab/measurements.ts NewQuestion): it can't be timed here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installReplay, type PageFacts } from '../../lab/measurements.ts'
import type { CaseMeasurements } from '../../lab/record.ts'
import type { Case, LabRow } from '../../lab/types.ts'
import { predict } from './count-predictor.ts'

const arg = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const run = arg('run')!, browser = arg('browser')!, ko = arg('ko')!, rounds = Number(arg('rounds') ?? 5)
const lines = (path: string): string[] => new TextDecoder().decode(path.endsWith('.zst') ? Bun.spawnSync(['zstd', '-dc', path], { stdout: 'pipe', maxBuffer: 2 ** 32 }).stdout : readFileSync(path)).split('\n').filter(l => l !== '')
const rows = lines(join(run, `${browser}-rows.ndjson`)).map(l => JSON.parse(l) as LabRow)
const records = lines(join(run, `${browser}-measurements.ndjson.zst`)).map(l => JSON.parse(l) as CaseMeasurements)
const flags: Record<string, boolean> = {}
for (const name of ko.split('+')) flags[name] = true
const g = globalThis as { __auditKO?: Record<string, boolean> }

function pass(on: boolean): number {
  g.__auditKO = on ? flags : {}
  let total = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const env: PageFacts = { userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, pageLang: row.env.pageLang }
    const replay = installReplay(records[i]!, env, 'predict')
    const t0 = performance.now()
    try { predict(row.case as Case, { browser: row.browser, build: row.build!.engine, languages: row.languages!.given }) } finally { total += performance.now() - t0; replay.restore() }
  }
  return total
}
pass(false); pass(true)
const base: number[] = [], knocked: number[] = []
for (let r = 0; r < rounds; r++) { base.push(pass(false)); knocked.push(pass(true)) }
const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[xs.length >> 1]!
console.log(`${browser} ${ko}: ${rows.length} cases; own code with free answers, median of ${rounds}: ${(1000 * median(base) / rows.length).toFixed(1)} → ${(1000 * median(knocked) / rows.length).toFixed(1)} µs a case (${(100 * (1 - median(knocked) / median(base))).toFixed(0)}% less)`)
