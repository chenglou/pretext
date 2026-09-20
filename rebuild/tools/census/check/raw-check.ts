// A check of the census's per-case records against the rows they were made from, for one chunk of one browser.
//   bun rebuild/tools/census/check/raw-check.ts <browser> <chunk> [<case file>] [--out=<census folder>]
// For every row of the chunk's native run it asks, without census.ts's code path for main (withNativeRow + scoreRow):
// - is the case the row ran the case of the case file, and is main's row for that id the same case, run without a native
//   observation of its own (--predict-only), in the same browser build at the same devicePixelRatio;
// - does "main passes" in the record equal research/MAIN-TRIAGE.md's definition computed here: the number of main's line
//   ranges equals the number of native lines of THIS row (nativeLines, the scorer's one observer assumption);
// - are the record's rebuild statuses, covered flags and native key the lab scorer's for this row.
// It prints counts and the first few differences, and writes nothing.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readLines } from '../../../lab/rows.ts'
import { nativeLines, nativeView, scoreRow } from '../../../lab/score.ts'
import type { LabRow } from '../../../lab/types.ts'

const args = process.argv.slice(2)
const outArg = args.find(a => a.startsWith('--out='))
const OUT = outArg === undefined ? '.artifacts/census-20260919' : outArg.slice('--out='.length)
const [browser, chunk, caseFile] = args.filter(a => !a.startsWith('--'))
if (browser === undefined || chunk === undefined) throw new Error('Usage: bun rebuild/tools/census/check/raw-check.ts <browser> <chunk> [<case file>]')
const dir = join(OUT, browser, chunk)
const sha = (text: string): string => createHash('sha1').update(text).digest('hex')

const fileCases = new Map<string, string>()
for await (const line of readLines(caseFile ?? `.artifacts/research-20260916/census/cases/chunks/${chunk}.ndjson`)) {
  const c = JSON.parse(line) as { id: string }
  fileCases.set(c.id, sha(JSON.stringify(c)))
}

type MainFact = { lines: number; caseSha: string; ownNative: boolean; env: string }
const envOf = (row: LabRow): string => JSON.stringify([row.browser, row.build ?? null, row.env.devicePixelRatio, row.env.visualViewportScale, row.env.pageLang, row.env.userAgent])
const mainFacts = new Map<string, MainFact>()
for await (const line of readLines(join(dir, 'main', `${browser}-rows.ndjson`))) {
  const row = JSON.parse(line) as LabRow
  if (mainFacts.has(row.id)) throw new Error(`two main rows for ${row.id}`)
  mainFacts.set(row.id, { lines: 'lines' in row.prediction ? row.prediction.lines.length : -1, caseSha: sha(JSON.stringify(row.case)), ownNative: !('skipped' in row.native), env: envOf(row) })
}

type Rec = { id: string; rebuild: Record<string, string>; covered: Record<string, boolean>; main: { lineCount: string }; native: { lines: number; key: string } }
const records = new Map<string, Rec>()
for await (const line of readLines(join(dir, 'cases.ndjson'))) {
  const r = JSON.parse(line) as Rec
  if (records.has(r.id)) throw new Error(`two records for ${r.id}`)
  records.set(r.id, r)
}

const counts = { rows: 0, noRecord: 0, noMainRow: 0, caseNotInFile: 0, caseDiffersFromFile: 0, mainCaseDiffers: 0, mainHasOwnNative: 0, mainEnvDiffers: 0, mainError: 0, nativeUnobserved: 0, mainPassDiffers: 0, rebuildStatusDiffers: 0, coveredDiffers: 0, nativeKeyDiffers: 0, mainPass: 0 }
const examples: string[] = []
const note = (key: keyof typeof counts, text: string): void => {
  counts[key]++
  if (examples.length < 8) examples.push(`${key}: ${text}`)
}
for await (const line of readLines(join(dir, 'rebuild', `${browser}-rows.ndjson`))) {
  const row = JSON.parse(line) as LabRow
  counts.rows++
  const record = records.get(row.id)
  const main = mainFacts.get(row.id)
  if (record === undefined) { note('noRecord', row.id); continue }
  if (main === undefined) { note('noMainRow', row.id); continue }
  const caseSha = sha(JSON.stringify(row.case))
  const inFile = fileCases.get(row.id)
  if (inFile === undefined) note('caseNotInFile', row.id)
  else if (inFile !== caseSha) note('caseDiffersFromFile', row.id)
  if (main.caseSha !== caseSha) note('mainCaseDiffers', row.id)
  if (main.ownNative) note('mainHasOwnNative', row.id)
  if (main.env !== envOf(row)) note('mainEnvDiffers', `${row.id}: ${main.env} vs ${envOf(row)}`)
  if (main.lines < 0) counts.mainError++
  if ('skipped' in row.native || 'error' in row.native) { counts.nativeUnobserved++; continue }
  const native = nativeLines(row.native, row.case.paragraph, row.browser)
  const mainPasses = main.lines === native.count
  if (mainPasses) counts.mainPass++
  if (mainPasses !== (record.main.lineCount === 'pass')) note('mainPassDiffers', `${row.id}: main ${main.lines} lines, native ${native.count}, record ${record.main.lineCount}`)
  const score = scoreRow(row)
  const names = ['lineCount', 'breaks', 'widths', 'painter'] as const
  for (let m = 0; m < names.length; m++) {
    if (score.metrics[names[m]!].status !== record.rebuild[names[m]!]) note('rebuildStatusDiffers', `${row.id} ${names[m]}: scorer ${score.metrics[names[m]!].status}, record ${record.rebuild[names[m]!]}`)
  }
  for (let m = 0; m < 3; m++) {
    const attribution = score.lineGaps[names[m]!]
    const covered = score.metrics[names[m]!].status === 'fail' && attribution !== undefined ? attribution.covered : undefined
    if (covered !== record.covered[names[m]!]) note('coveredDiffers', `${row.id} ${names[m]}`)
  }
  const view = nativeView(row)
  const key = createHash('sha1').update(JSON.stringify([view.points, view.nodes])).digest('hex').slice(0, 16)
  if (key !== record.native.key || native.count !== record.native.lines) note('nativeKeyDiffers', row.id)
}
console.log(`${browser} ${chunk}: ${JSON.stringify(counts)}; records ${records.size}, main rows ${mainFacts.size}, cases in the file ${fileCases.size}`)
for (let i = 0; i < examples.length; i++) console.log(`  ${examples[i]}`)
