// Runs one case file as several run.ts jobs at the same time, each under the browser lock in its own browser instance, and
// puts their rows together. The lock gives a browser a few slots (.artifacts/session/with-browser-lock.py), so this tool
// isn't run under the lock itself.
//
//   bun rebuild/lab/sharded.ts --browser=<browser> --cases=<cases.ndjson> --out=<dir> [--shards=N] [--ids=<id>[,<id>...]]
//     [--ids-file=<file>] [--isolate] [--job=<lock job name>] [-- <more run.ts arguments>]
//
// - The selected cases (the browser's, and with --ids or --ids-file only those) are cut into N runs of neighbours in file
//   order with about equal text length, so a shard's cases keep the neighbours they have in the file. N defaults to the
//   browser's slots: 3, and 1 for installed Safari.
// - --isolate is the isolation protocol for page-history questions (research/TEST-ARCHITECTURE.md §6.5): every case runs
//   alone in a fresh browser process (run.ts --part-cases=1 --chunk=1), so its row shows the case without any document or
//   process history. Compare such rows with a run of the whole set through score.ts --native-compare.
// - Each shard writes <out>/shards/<k>/ like any run. When every shard is ok, the rows are joined in shard order into
//   <out>/<browser>-rows.ndjson (and the measurement records of --record-measurements into
//   <out>/<browser>-measurements.ndjson.zst; zstd frames join by concatenation), the shards' rows are removed, and
//   <out>/<browser>-run.json sums the shards' records. It refuses shards that ran another build, other given languages or
//   another library bundle. A failed shard fails the whole run and nothing is joined or run again.
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserKind, Case } from './types.ts'

const REPO = resolve(import.meta.dir, '../..')
const LOCK = join(REPO, '.artifacts/session/with-browser-lock.py')
const SLOTS: Record<BrowserKind, number> = { chrome: 3, firefox: 3, 'webkit-host': 3, safari: 1 }

function fail(text: string): never {
  console.error(`[sharded] ${text}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
const own = split === -1 ? argv : argv.slice(0, split)
const extra = split === -1 ? [] : argv.slice(split + 1)
const args = new Map<string, string>()
let isolate = false
for (const raw of own) {
  if (raw === '--isolate') {
    isolate = true
    continue
  }
  const match = /^--(browser|cases|out|shards|ids|ids-file|job)=(.*)$/s.exec(raw)
  if (match === null) fail(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2]!)
}
const browserArg = args.get('browser')
if (browserArg !== 'chrome' && browserArg !== 'safari' && browserArg !== 'firefox' && browserArg !== 'webkit-host') fail('--browser must be chrome, safari, firefox or webkit-host')
const browser: BrowserKind = browserArg
const casesPath = resolve(args.get('cases') ?? fail('--cases is required'))
const outDir = resolve(args.get('out') ?? fail('--out is required'))
const shardCount = Number(args.get('shards') ?? SLOTS[browser])
if (!Number.isSafeInteger(shardCount) || shardCount <= 0) fail('--shards must be a positive integer')
const job = args.get('job') ?? `lab-sharded-${browser}`
if (extra.some(arg => /^--(browser|cases|out)=/.test(arg))) fail('run.ts takes --browser, --cases and --out from this tool')
const runArgs = isolate ? ['--part-cases=1', '--chunk=1', ...extra] : extra

let wanted: Set<string> | null = null
if (args.has('ids') || args.has('ids-file')) {
  const text = `${args.get('ids') ?? ''}\n${args.has('ids-file') ? readFileSync(resolve(args.get('ids-file')!), 'utf8') : ''}`
  wanted = new Set(text.split(/[\s,]+/).filter(id => id !== ''))
}

// The selected cases as their lines in the file, each with a weight: its text length, plus a constant for the case itself.
const caseBrowser: BrowserKind = browser === 'webkit-host' ? 'safari' : browser
const lines: string[] = []
const weights: number[] = []
{
  const found = new Set<string>()
  const all = readFileSync(casesPath, 'utf8').split('\n')
  for (let i = 0; i < all.length; i++) {
    if (all[i]!.trim() === '') continue
    const c = JSON.parse(all[i]!) as Case
    if (c.browsers !== undefined && !c.browsers.includes(caseBrowser)) continue
    if (wanted !== null && !wanted.has(c.id)) continue
    found.add(c.id)
    let length = 200
    for (let r = 0; r < c.paragraph.runs.length; r++) length += c.paragraph.runs[r]!.text.length
    lines.push(all[i]!)
    weights.push(length)
  }
  if (wanted !== null) for (const id of wanted) if (!found.has(id)) fail(`${casesPath} has no case ${id} for ${browser}`)
}
if (lines.length === 0) fail('No cases selected')

// Runs of neighbours with about equal weight: shard k ends once the running weight passes k + 1 shares.
const shards: string[][] = []
{
  const count = Math.min(shardCount, lines.length)
  let total = 0
  for (let i = 0; i < weights.length; i++) total += weights[i]!
  let running = 0
  let current: string[] = []
  for (let i = 0; i < lines.length; i++) {
    current.push(lines[i]!)
    running += weights[i]!
    const left = lines.length - i - 1
    if (shards.length < count - 1 && (running >= (total * (shards.length + 1)) / count || left === count - 1 - shards.length)) {
      shards.push(current)
      current = []
    }
  }
  shards.push(current)
}

const shardsDir = join(outDir, 'shards')
mkdirSync(shardsDir, { recursive: true })
const startedAt = new Date()
console.log(`[sharded] ${browser}: ${lines.length} cases in ${shards.length} shards${isolate ? ', every case in a fresh browser process' : ''}`)
const exits = await Promise.all(shards.map(async (shard, k) => {
  const cases = join(shardsDir, `cases-${k}.ndjson`)
  writeFileSync(cases, shard.join('\n') + '\n')
  const log = openSync(join(shardsDir, `${k}.log`), 'w')
  try {
    const child = Bun.spawn(['python3', LOCK, `${job}-${k}`, '--max-wait-min=240', '--', 'bun', join(REPO, 'rebuild/lab/run.ts'), `--browser=${browser}`, `--cases=${cases}`, `--out=${join(shardsDir, String(k))}`, ...runArgs], { cwd: REPO, stdin: 'ignore', stdout: log, stderr: log })
    return await child.exited
  } finally {
    closeSync(log)
  }
}))
const failed = exits.flatMap((code, k) => code === 0 ? [] : [k])
if (failed.length > 0) fail(`shard${failed.length === 1 ? '' : 's'} ${failed.join(', ')} failed; see ${shardsDir}/<k>.log. Nothing was joined, and nothing runs again`)

type RunRecord = {
  status: string; build: unknown; app: unknown; languages: { given: unknown }; bundleSha256: string | null; predictor: string; order: string; chunkSize: number
  predictOnly: boolean; totals: Record<string, number>; missingFonts: Record<string, number>; visibility: Record<string, number>; env: unknown; durationMs: number
  parts: unknown[]; measurements: ({ file: string } & Record<string, number | string>) | null
}
const records = shards.map((_, k) => JSON.parse(readFileSync(join(shardsDir, String(k), `${browser}-run.json`), 'utf8')) as RunRecord)
const first = records[0]!
for (let k = 1; k < records.length; k++) {
  const record = records[k]!
  const same = (name: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`shard ${k} ran under another ${name} than shard 0: ${JSON.stringify(b)} against ${JSON.stringify(a)}`)
  }
  same('browser build', first.build, record.build)
  same('app', first.app, record.app)
  same('given languages', first.languages.given, record.languages.given)
  same('library bundle', first.bundleSha256, record.bundleSha256)
}

// Streams the sources into the target one after another.
async function concatenate(target: string, sources: string[]): Promise<void> {
  const fd = openSync(target, 'w')
  try {
    for (const source of sources) for await (const bytes of createReadStream(source)) writeSync(fd, bytes as Buffer)
  } finally {
    closeSync(fd)
  }
}
const rowFiles = shards.map((_, k) => join(shardsDir, String(k), `${browser}-rows.ndjson`))
const rowsPath = join(outDir, `${browser}-rows.ndjson`)
await concatenate(rowsPath, rowFiles)
const recordFiles = records.flatMap(record => record.measurements === null ? [] : [record.measurements.file])
const measurementsPath = join(outDir, `${browser}-measurements.ndjson.zst`)
if (recordFiles.length > 0) await concatenate(measurementsPath, recordFiles)
for (const file of [...rowFiles, ...recordFiles]) rmSync(file)

const sum = (pick: (record: RunRecord) => Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const record of records) for (const [name, value] of Object.entries(pick(record))) out[name] = (out[name] ?? 0) + value
  return out
}
const finishedAt = new Date()
writeFileSync(join(outDir, `${browser}-run.json`), JSON.stringify({
  status: 'ok', errors: [], browser, app: first.app, build: first.build, languages: first.languages, casesFile: casesPath, rowsFile: rowsPath,
  predictor: first.predictor, order: first.order, chunkSize: first.chunkSize, bundleSha256: first.bundleSha256, predictOnly: first.predictOnly,
  selectedIds: wanted === null ? null : wanted.size, isolate, runArguments: runArgs,
  startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime(),
  totals: sum(record => record.totals), missingFonts: sum(record => record.missingFonts), visibility: sum(record => record.visibility), env: first.env,
  measurements: recordFiles.length === 0 ? null : { file: measurementsPath, ...sum(record => Object.fromEntries(Object.entries(record.measurements!).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))) },
  // Each shard's own record stays in shards/<k>/; its rows were joined into rowsFile.
  shards: records.map((record, k) => ({ cases: join(shardsDir, `cases-${k}.ndjson`), run: join(shardsDir, String(k), `${browser}-run.json`), rows: record.totals['rows'], durationMs: record.durationMs, parts: record.parts.length })),
}, null, 2) + '\n')
console.log(`[sharded] ${browser}: ok; ${sum(record => record.totals)['rows']} rows in ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)} s; ${join(outDir, `${browser}-run.json`)}`)
