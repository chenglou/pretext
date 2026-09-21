// Reclassify stored both-order observations into a staged format-3 ledger. No browser, carry from legacy ledgers,
// seed adoption, reference overwrite or pin changes. Evidence paths are resolved against their producer checkout.
//
// bun rebuild/tests/migrate-ledger.ts --from=<old ledger dir> --source-root=<recording checkout root>
//   --out=<new staging dir> --native=full [--sets=<set names>] [--carry-native-from=<reviewed format-3 ledger>] [--plan]
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { existingRows } from '../lab/rows.ts'
import { SCORER_VERSION } from '../lab/score.ts'
import { buildLedger, LEDGER_KEYS, readLedger, statusAt, writeLedger, type LedgerEntry, type LedgerHeader, type SetsRun } from './ledger.ts'

type Part = { set: string; part: number; forward: string; reverse: string; forwardRows: string; reverseRows: string }
export type MigrationOptions = { from: string; sourceRoot: string; out: string; native: 'full'; sets?: readonly string[]; carryNativeFrom?: string; plan?: boolean }
type Changed = { set: string; id: string; metric: string; before: string; after: string }

function hash(bytes: string | Buffer): string { return createHash('sha256').update(bytes).digest('hex') }
async function fileHash(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

export async function migrateLedger(options: MigrationOptions): Promise<{ reviewRequired: boolean; changes: Changed[]; nativeHistoryAdded: Changed[]; predictionOrderDependent: Changed[]; cases: number; elapsedMs: number }> {
  const started = Date.now()
  const from = resolve(options.from)
  const sourceRoot = resolve(options.sourceRoot)
  const out = resolve(options.out)
  if (options.native !== 'full') throw new Error('--native=full is required; old native-history classifications are not trusted')
  if (existsSync(out)) throw new Error(`${out}: staging output already exists; choose a new folder`)
  const headerBytes = readFileSync(join(from, 'ledger.json'))
  const entriesBytes = readFileSync(join(from, 'entries.ndjson'))
  const source = JSON.parse(headerBytes.toString()) as LedgerHeader
  if (!['pretext-ledger/1', 'pretext-ledger/2', 'pretext-ledger/3'].includes(source.format)) throw new Error(`${from}: unsupported source ledger format`)
  if (source.orders !== 'both') throw new Error('migration needs both recorded orders; a forward-only ledger cannot prove native history')
  if (options.carryNativeFrom !== undefined) readLedger(resolve(options.carryNativeFrom)) // Refuses legacy exclusions before any output.
  const selected = options.sets === undefined ? Object.keys(source.sets) : [...options.sets]
  if (new Set(selected).size !== selected.length) throw new Error('each selected set must be named once')
  const run: SetsRun = { browser: source.browser, config: source.config, predictor: source.predictor, build: source.build, orders: 'both', ...(source.library == null ? {} : { library: source.library }), sets: [] }
  const parts: Part[] = []
  let sourceBytes = 0
  for (const name of selected) {
    const set = source.sets[name]
    if (set === undefined) throw new Error(`${name}: not a set in the source ledger`)
    const newParts: SetsRun['sets'][number]['parts'] = []
    const indices = [...new Set(set.evidence.map(evidence => evidence.part))]
    for (const index of indices) {
      const forward = set.evidence.filter(evidence => evidence.part === index && evidence.order === 'forward')
      const reverse = set.evidence.filter(evidence => evidence.part === index && evidence.order === 'reverse')
      if (forward.length !== 1 || reverse.length !== 1) throw new Error(`${name} part ${index}: expected one recorded run in each order`)
      const a = resolve(sourceRoot, forward[0]!.run)
      const b = resolve(sourceRoot, reverse[0]!.run)
      const rowsA = existingRows(join(dirname(a), `${source.browser}-rows.ndjson`))
      const rowsB = existingRows(join(dirname(b), `${source.browser}-rows.ndjson`))
      if (rowsA === null || rowsB === null) throw new Error(`${name} part ${index}: stored native rows missing; check --source-root`)
      for (const path of [a, b]) {
        const record = JSON.parse(readFileSync(path, 'utf8')) as { status?: string; predictOnly?: boolean }
        if (record.status !== 'ok' || record.predictOnly === true) throw new Error(`${path}: requires a successful native observation run`)
      }
      parts.push({ set: name, part: index, forward: a, reverse: b, forwardRows: rowsA, reverseRows: rowsB })
      sourceBytes += statSync(rowsA).size + statSync(rowsB).size
      newParts.push({ part: index, forward: join(out, 'runs', name, 'forward', `part${index}`), reverse: join(out, 'runs', name, 'reverse', `part${index}`) })
    }
    run.sets.push({ name, protocol: set.protocol, subset: set.subset, parts: newParts })
  }
  if (parts.length === 0) throw new Error('no recorded parts selected')
  if (options.plan) {
    console.log(JSON.stringify({ source: from, sourceRoot, browser: source.browser, config: source.config, sourceFormat: source.format, sourceScorer: source.scorer, targetScorer: SCORER_VERSION, parts, sourceBytes, scoringJobs: parts.length * 2, browserJobs: 0 }, null, 2))
    return { reviewRequired: false, changes: [], nativeHistoryAdded: [], predictionOrderDependent: [], cases: 0, elapsedMs: Date.now() - started }
  }
  mkdirSync(out, { recursive: true })
  const evidence: Array<{ set: string; part: number; order: string; run: string; runSha256: string; rows: string; rowsSha256: string; nativeCompare: string }> = []
  for (const part of parts) {
    const target = run.sets.find(set => set.name === part.set)!.parts.find(value => value.part === part.part)!
    for (const order of ['forward', 'reverse'] as const) {
      const folder = order === 'forward' ? target.forward : target.reverse!
      const recordPath = part[order]
      const rows = order === 'forward' ? part.forwardRows : part.reverseRows
      const otherRows = order === 'forward' ? part.reverseRows : part.forwardRows
      const recordBytes = readFileSync(recordPath)
      const sourceStamp = [statSync(rows).size, statSync(rows).mtimeMs, statSync(otherRows).size, statSync(otherRows).mtimeMs]
      const rowsSha256 = await fileHash(rows)
      mkdirSync(folder, { recursive: true })
      const child = spawnSync(process.execPath, [join(import.meta.dir, '../lab/score.ts'), `--rows=${rows}`, `--native-compare=${otherRows}`, `--out=${join(folder, `${source.browser}-summary.json`)}`, `--per-case=${join(folder, `${source.browser}-per-case.ndjson`)}`, '--examples=0'], { encoding: 'utf8' })
      if (child.status !== 0) throw new Error(`${part.set} part ${part.part} ${order}: re-scoring failed\n${child.stderr}`)
      const afterStamp = [statSync(rows).size, statSync(rows).mtimeMs, statSync(otherRows).size, statSync(otherRows).mtimeMs]
      if (sourceStamp.some((value, i) => value !== afterStamp[i])) throw new Error(`${rows}: source observations changed during migration`)
      writeFileSync(join(folder, `${source.browser}-run.json`), recordBytes)
      evidence.push({ set: part.set, part: part.part, order, run: recordPath, runSha256: hash(recordBytes), rows, rowsSha256, nativeCompare: otherRows })
      console.log(`[migrate-ledger] ${part.set} part ${part.part} ${order}; ${Math.round((Date.now() - started) / 1000)}s elapsed`)
    }
  }
  writeFileSync(join(out, 'sets-run.json'), JSON.stringify(run, null, 2) + '\n')
  const migrated = buildLedger(out, options.carryNativeFrom === undefined ? null : resolve(options.carryNativeFrom))
  for (const name of selected) if (migrated.header.sets[name]!.cases !== source.sets[name]!.cases) throw new Error(`${name}: migration changed the recorded case population`)
  writeLedger(join(out, 'ledger'), migrated)
  const old = new Map<string, LedgerEntry>()
  for (const line of entriesBytes.toString().split('\n')) if (line.trim() !== '') {
    const entry = JSON.parse(line) as LedgerEntry
    old.set(`${entry.set}\n${entry.id}`, entry)
  }
  const changes: Changed[] = []
  const nativeHistoryAdded: Changed[] = []
  const predictionOrderDependent: Changed[] = []
  let obligationObscured = false
  for (const entry of migrated.entries) {
    const before = old.get(`${entry.set}\n${entry.id}`)
    if (before === undefined) throw new Error(`${entry.set}/${entry.id}: re-scoring introduced an unrecorded case`)
    for (const metric of LEDGER_KEYS) {
      const was = statusAt(before, metric) ?? 'unobserved'
      const now = statusAt(entry, metric)
      const change = { set: entry.set, id: entry.id, metric, before: was, after: now }
      if (was !== now) changes.push(change)
      if (now === 'history-dependent' && was !== now) nativeHistoryAdded.push(change)
      if (now === 'prediction-order-dependent') predictionOrderDependent.push(change)
      if ((was === 'pass' || was === 'exact') && now !== was) obligationObscured = true
    }
  }
  const result = { reviewRequired: nativeHistoryAdded.length > 0 || predictionOrderDependent.length > 0 || obligationObscured, changes, nativeHistoryAdded, predictionOrderDependent, cases: migrated.entries.length, elapsedMs: Date.now() - started }
  writeFileSync(join(out, 'migration.json'), JSON.stringify({ ...result, from, sourceRoot, sourceFormat: source.format, sourceScorer: source.scorer, targetScorer: SCORER_VERSION, nativeComparison: 'full-scorer-view-v8', sourceHeaderSha256: hash(headerBytes), sourceEntriesSha256: hash(entriesBytes), scorerSha256: hash(readFileSync(join(import.meta.dir, '../lab/score.ts'))), carryNativeFrom: options.carryNativeFrom ?? null, selected, evidence, pinsChanged: false, seedsAdopted: false }, null, 2) + '\n')
  return result
}

if (import.meta.main) {
  try {
    const options = new Map<string, string>()
    let plan = false
    for (const arg of process.argv.slice(2)) {
      if (arg === '--plan') { plan = true; continue }
      const match = /^--(from|source-root|out|native|sets|carry-native-from)=(.+)$/s.exec(arg)
      if (match === null) throw new Error(`unknown argument ${arg}`)
      options.set(match[1]!, match[2]!)
    }
    for (const required of ['from', 'source-root', 'out', 'native']) if (!options.has(required)) throw new Error(`--${required} is required`)
    if (options.get('native') !== 'full') throw new Error('--native=full is required')
    const result = await migrateLedger({ from: options.get('from')!, sourceRoot: options.get('source-root')!, out: options.get('out')!, native: 'full', plan, ...(options.has('sets') ? { sets: options.get('sets')!.split(',') } : {}), ...(options.has('carry-native-from') ? { carryNativeFrom: options.get('carry-native-from')! } : {}) })
    console.log(`${plan ? 'plan only' : 'migration staged'}: ${result.cases} cases, ${result.nativeHistoryAdded.length} newly native-history statuses, ${result.predictionOrderDependent.length} unstable prediction statuses; ${result.elapsedMs}ms; ${result.reviewRequired ? 'review required (nothing adopted)' : 'nothing adopted'}`)
    process.exit(result.reviewRequired ? 1 : 0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
