// Knockouts that ask only questions a recording holds, judged offline on the adversarial tier corpus: every forward row
// of a recorded tier run (browser-sets.ts --record: native observation, predictions and every Canvas answer) is laid out
// again by the plain path under the replay of its answers, with each knockout's switches on and off, and a case whose
// lines differ is scored against the row's own native observation. Needs the scratch tree (tools/audit/knockouts.patch).
// A case whose knockout asks a question the record lacks is counted as unreplayable, not judged.
//   bun rebuild/tools/audit/tier-replay.ts --run=<browser-sets run dir> --browser=<b> --ko=<a>[+<b>],<c>... [--json=<out>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installReplay, NewQuestion, type PageFacts } from '../../lab/measurements.ts'
import type { CaseMeasurements } from '../../lab/record.ts'
import { scoreRow } from '../../lab/score.ts'
import type { Case, LabRow, LinesPrediction } from '../../lab/types.ts'
import { predict } from './count-predictor.ts'

const arg = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const run = arg('run')!, browser = arg('browser')!
const knockouts = arg('ko')!.split(',')
const g = globalThis as { __auditKO?: Record<string, boolean> }

function lines(path: string): string[] {
  const bytes = path.endsWith('.zst') ? Bun.spawnSync(['zstd', '-dc', path], { stdout: 'pipe', maxBuffer: 2 ** 33 }).stdout : readFileSync(path)
  return new TextDecoder().decode(bytes).split('\n').filter(l => l !== '')
}

type Lines = { start: number; end: number }[]
function layout(row: LabRow, record: CaseMeasurements, flags: Record<string, boolean>): Lines | null {
  g.__auditKO = flags
  const env: PageFacts = { userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, pageLang: row.env.pageLang }
  const replay = installReplay(record, env, 'predict')
  try {
    const result = predict(row.case as Case, { browser: row.browser, build: row.build!.engine, languages: row.languages!.given })
    return 'error' in result ? null : result.lines
  } catch (error) {
    if (error instanceof NewQuestion) return null
    throw error
  } finally {
    replay.restore()
  }
}

function right(row: LabRow, predicted: Lines): boolean | null {
  const s = scoreRow({ ...row, prediction: { lines: predicted } as LinesPrediction as never, painter: null })
  if (s.metrics.lineCount.status === 'unobserved') return null
  return s.metrics.lineCount.status === 'pass' && s.diagnostics?.visibleBreaks?.status === 'pass'
}

type Tally = { n: number; unreplayable: number; changed: number; lost: number; gained: number; moved: number; lostIds: string[] }
const tallies = new Map<string, Map<string, Tally>>()
const tally = (ko: string, bucket: string): Tally => {
  let m = tallies.get(ko)
  if (m === undefined) { m = new Map(); tallies.set(ko, m) }
  let t = m.get(bucket)
  if (t === undefined) { t = { n: 0, unreplayable: 0, changed: 0, lost: 0, gained: 0, moved: 0, lostIds: [] }; m.set(bucket, t) }
  return t
}
let baseN = 0, baseUnreplayable = 0, baseWrong = 0
const sets = readdirSync(join(run, 'runs'))
for (const set of sets) {
  if (set === 'features-en-US') continue
  const forward = join(run, 'runs', set, 'forward')
  for (const part of readdirSync(forward)) {
    const dir = join(forward, part)
    const rowsPath = join(dir, `${browser}-rows.ndjson`)
    const rows = lines(existsSync(rowsPath) ? rowsPath : `${rowsPath}.zst`)
    const records = lines(join(dir, `${browser}-measurements.ndjson.zst`))
    for (let i = 0; i < rows.length; i++) {
      const row = JSON.parse(rows[i]!) as LabRow
      const record = JSON.parse(records[i]!) as CaseMeasurements
      if (record.id !== row.id) throw new Error(`record ${record.id} for row ${row.id}`)
      if ('skipped' in (row.native as object) || 'error' in (row.native as object)) continue
      const base = layout(row, record, {})
      baseN++
      if (base === null) { baseUnreplayable++; continue }
      const baseRight = right(row, base)
      if (baseRight === false) baseWrong++
      const bucket = row.case.paragraph.width < 80 ? 'under 80px' : '80px or more'
      for (const ko of knockouts) {
        const flags: Record<string, boolean> = {}
        for (const name of ko.split('+')) flags[name] = true
        const knocked = layout(row, record, flags)
        for (const b of ['all', bucket]) {
          const t = tally(ko, b)
          t.n++
          if (knocked === null) { t.unreplayable++; continue }
          if (JSON.stringify(knocked) === JSON.stringify(base)) continue
          t.changed++
          const koRight = right(row, knocked)
          if (baseRight === true && koRight === false) { t.lost++; if (b === 'all' && t.lostIds.length < 200) t.lostIds.push(`${set}/${row.id}`) }
          else if (baseRight === false && koRight === true) t.gained++
          else if (baseRight === false && koRight === false) t.moved++
        }
      }
    }
    console.error(`[tier-replay] ${set}/${part}: ${rows.length} rows`)
  }
}
console.log(`${browser}: ${baseN} forward rows with a native observation; the plain path replays ${baseN - baseUnreplayable} of them and gets ${baseWrong} wrong`)
const out: Record<string, unknown> = { baseN, baseUnreplayable, baseWrong }
for (const [ko, m] of tallies) {
  for (const [b, t] of m) console.log(`${ko.padEnd(28)} ${b.padEnd(13)} ${t.n} cases, unreplayable ${t.unreplayable}, lines changed ${t.changed}: lost ${t.lost}, gained ${t.gained}, moved ${t.moved}`)
  out[ko] = Object.fromEntries(m)
}
if (arg('json') !== undefined) writeFileSync(arg('json')!, JSON.stringify(out, null, 1))
