// A fresh round: new cases nobody iterated on, run in parts at the same time, scored, and reported by failure signature.
// Round 2's lesson is that fresh generated cases find classes that iterated and sealed sets don't, so the ceiling is measured
// on sets this tool makes (lab/README.md, "Fresh rounds").
//
//   bun rebuild/lab/fresh.ts --browser=chrome|firefox|webkit-host|safari --seed=<name> [--both-orders]
//     [--kinds=runs,ws,policy,suite,family-widths] [--repeat=N] [--suite-sample=N] [--widths-per-paragraph=N]
//     [--family-dirs=<dir>[,<dir>...]] [--parts=N] [--giants=skip|run] [--chunk=N] [--stall-ms=N] [--predictor=<file>]
//     [--run-args="<more run.ts arguments>"] [--max-wait-min=N] [--examples=N] [--max-groups=N]
//     [--generate-only] [--report-only] [--rescore] [--rerun-failed]
//   bun rebuild/lab/fresh.ts report --browser=<browser> --runs=<scored run dir>[,<dir>...] [--out=<report.json>] [--examples=N]
//
// It doesn't take the browser lock itself: every browser job it starts runs under .artifacts/session/with-browser-lock.py,
// so start it without the lock. Steps, each skipped when its output exists (a second call resumes):
// 1. Generate, under the generation lock (cases/used-ids.ts), without any case id used so far: styled runs, white space and
//    policy from the seed (--repeat=N adds the seeds <seed>#2..N), a suite sample of unused suite cases by one quota per
//    family, and the rule and feature family paragraphs at seeded widths (cases/family-widths.ts). A seed names one set of
//    flat cases: a second browser asking for the same seed copies the first one's runs, ws, policy and suite files, so
//    browsers compare on the same cases; family widths are per browser. Giants (cases/parts.ts) go to cases/giants.ndjson.
// 2. Split this browser's cases into --parts contiguous parts in file order (default 3, installed Safari 1).
// 3. Run every part at the same time, each as its own job under the lock, in file order, and with --both-orders also
//    reversed. A failed job is never run again: its folder keeps the log, the round reports it, and --rerun-failed runs
//    it once more after the cause is fixed (the failed folder is renamed, not removed). Giants run only with
//    --giants=run, after the parts, as one exclusive job with --chunk=1.
// 4. Score every finished part with score.ts (forward against reverse under --both-orders). A part is scored again when
//    score.ts is newer than its summary, or with --rescore.
// 5. Report: failures without a covered explanation (score.ts per-case `lineGaps[metric].covered`) grouped by signature,
//    residual classes (score.ts RESIDUAL_CLASSES, read from the per-case files' `residual`) counted apart with probed members
//    apart from signature-only ones, and gap firing rates on passing lines. Written to <out>/report.json and printed.
//
// Output: .artifacts/lab/fresh/<browser>/<seed>/ with cases/, parts/, runs/part-NN-<order>/, report.json and round.json.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { Generator } from './cases/build.ts'
import { mergeCases, sortByCaseOrder, sortCases } from './cases/case.ts'
import { defaultFamilyDirs, familyWidthCases } from './cases/family-widths.ts'
import { appliesTo, contiguousParts, isGiant, readCaseLines, writeCaseLines, type CaseLine } from './cases/parts.ts'
import { POLICY_GENERATORS } from './cases/policy.ts'
import { RUN_GENERATORS } from './cases/runs.ts'
import { stratifiedSample } from './cases/sample.ts'
import { streamRowInputs, SuiteImport, suiteRowFiles } from './cases/suite.ts'
import { collectUsedIds, generationLock } from './cases/used-ids.ts'
import { WS_GENERATORS } from './cases/ws.ts'
import { existingRows as existingRowsFile, readLines } from './rows.ts'
import { nativeLines, RESIDUAL_CLASSES, rowText, type GapFiring, type MetricAttribution, type MetricName, type ResidualMembership } from './score.ts'
import type { BrowserKind, Case, LabRow, TextRun } from './types.ts'

const REPO = resolve(import.meta.dir, '../..')
const ARTIFACTS = join(REPO, '.artifacts')
const LOCK_TOOL = join(ARTIFACTS, 'session/with-browser-lock.py')
const FRESH = join(ARTIFACTS, 'lab/fresh')
const BROWSERS: readonly BrowserKind[] = ['chrome', 'firefox', 'webkit-host', 'safari']
const FLAT_KINDS = ['runs', 'ws', 'policy', 'suite'] as const
const KINDS = [...FLAT_KINDS, 'family-widths'] as const
type Kind = (typeof KINDS)[number]
const PREDICTION: readonly MetricName[] = ['lineCount', 'breaks', 'widths']

function fail(text: string): never {
  console.error(`[fresh] ${text}`)
  process.exit(1)
}

function log(text: string): void {
  console.log(`[fresh] ${text}`)
}

// ---- Arguments ----

const FLAGS = new Set(['both-orders', 'generate-only', 'report-only', 'rescore', 'rerun-failed'])
const OPTIONS = new Set(['browser', 'seed', 'kinds', 'repeat', 'suite-sample', 'widths-per-paragraph', 'family-dirs', 'parts', 'giants', 'chunk', 'stall-ms', 'predictor', 'run-args', 'max-wait-min', 'examples', 'max-groups', 'runs', 'out'])
const argv = process.argv.slice(2)
const reportMode = argv[0] === 'report'
const options = new Map<string, string>()
const flags = new Set<string>()
for (const raw of reportMode ? argv.slice(1) : argv) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) fail(`Unknown argument ${raw}`)
  const name = match[1]!
  if (match[2] === undefined) {
    if (!FLAGS.has(name)) fail(`Unknown flag --${name}`)
    flags.add(name)
  } else {
    if (!OPTIONS.has(name)) fail(`Unknown option --${name}`)
    options.set(name, match[2])
  }
}
const browser = options.get('browser') as BrowserKind | undefined
if (browser === undefined || !BROWSERS.includes(browser)) fail(`--browser must be one of ${BROWSERS.join(', ')}`)

function positive(name: string, fallback: number): number {
  const raw = options.get(name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) fail(`--${name} must be a positive integer`)
  return n
}

const examples = positive('examples', 3)

// ---- Small file helpers ----

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function existingRows(dir: string, name: BrowserKind): string | null {
  return existingRowsFile(join(dir, `${name}-rows.ndjson`))
}

// ---- Generation ----

type KindRecord = { file: string; cases: number; families: Record<string, number>; removedUsed: number; copiedFrom?: string; detail?: unknown }
type Manifest = {
  format: 'pretext-lab-fresh/1'
  seed: string
  browser: BrowserKind
  createdAt: string
  repeat: number
  kinds: Partial<Record<Kind, KindRecord>>
  giants: { file: string; cases: number; ids: string[] } | null
  used: { ids: number; sources: number; missing: string[]; notExcluded: number }
  generatorSources: Array<{ path: string; sha256: string }>
}

function familyCounts(cases: readonly Case[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < cases.length; i++) counts.set(cases[i]!.family, (counts.get(cases[i]!.family) ?? 0) + 1)
  return Object.fromEntries([...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
}

function writeCases(path: string, cases: readonly Case[]): void {
  const out = createWriteStreamSync(path)
  for (let i = 0; i < cases.length; i++) out.write(`${JSON.stringify(cases[i])}\n`)
  out.close()
}

// A small synchronous appender, so a big set never sits in one string.
function createWriteStreamSync(path: string): { write(text: string): void; close(): void } {
  let buffer = ''
  writeFileSync(path, '')
  const flush = (): void => {
    if (buffer !== '') writeFileSync(path, buffer, { flag: 'a' })
    buffer = ''
  }
  return {
    write(text) {
      buffer += text
      if (buffer.length > 1 << 22) flush()
    },
    close: flush,
  }
}

function generatedKind(generators: readonly Generator[], seed: string, repeat: number): Case[] {
  const cases: Case[] = []
  for (let r = 1; r <= repeat; r++) {
    const s = r === 1 ? seed : `${seed}#${r}`
    for (const generator of generators) cases.push(...generator.generate(s))
  }
  return sortCases(mergeCases(cases))
}

async function suiteSample(seed: string, size: number, used: ReadonlySet<string>): Promise<{ cases: Case[]; detail: unknown }> {
  const rowsDir = join(ARTIFACTS, 'rows-20260916')
  const { files, skipped } = suiteRowFiles(rowsDir)
  if (files.length === 0) throw new Error(`No finished suite row files under ${rowsDir} (${skipped.join('; ')})`)
  const suite = new SuiteImport()
  for (const file of files) await streamRowInputs(file.rows, input => suite.add(input))
  const all = suite.entries()
  const unused = all.filter(entry => !used.has(entry.id))
  // One quota per family: no family kept whole, none of main's required cases favoured (as cases/seal.ts samples).
  const result = stratifiedSample(unused, size, `${seed}/suite-sample`, { family: entry => entry.family, id: entry => entry.id, keepFamiliesUpTo: 0 })
  const cases = sortByCaseOrder(result.selected.slice()).map(entry => suite.materialize(entry.id))
  return { cases, detail: { suiteCases: all.length, unusedSuiteCases: unused.length, sampleSize: size, quotaPerFamily: result.quota, skippedRows: skipped } }
}

async function generate(outDir: string, seed: string, kinds: readonly Kind[]): Promise<Manifest> {
  const casesDir = join(outDir, 'cases')
  const manifestPath = join(casesDir, 'manifest.json')
  if (existsSync(manifestPath)) {
    const manifest = readJson<Manifest>(manifestPath)
    const missing = kinds.filter(kind => manifest.kinds[kind] === undefined)
    if (missing.length > 0) log(`the set exists without ${missing.join(', ')}; a set is generated once, so they stay out`)
    log(`reusing ${relative(REPO, casesDir)} (generated ${manifest.createdAt})`)
    return manifest
  }
  return generationLock(`fresh ${browser} ${seed}`, async () => {
    // Another call for this browser and seed may have generated the set while this one waited for the lock.
    if (existsSync(manifestPath)) return readJson<Manifest>(manifestPath)
    mkdirSync(casesDir, { recursive: true })
    const started = Date.now()
    const collected = collectUsedIds({ skip: outDir, failOnMissing: false })
    const used = collected.ids
    for (const file of collected.missing) log(`warning: a run names ${file}, which is gone; its ids can't be excluded`)
    log(`${used.size} used case ids from ${collected.sources.length} files (${Date.now() - started} ms)`)
    const repeat = positive('repeat', 1)
    const manifest: Manifest = {
      format: 'pretext-lab-fresh/1', seed, browser: browser!, createdAt: new Date().toISOString(), repeat, kinds: {}, giants: null,
      used: { ids: used.size, sources: collected.sources.length, missing: collected.missing, notExcluded: collected.notExcluded.length },
      generatorSources: readdirSync(join(REPO, 'rebuild/lab/cases')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort()
        .map(name => ({ path: `rebuild/lab/cases/${name}`, sha256: sha256File(join(REPO, 'rebuild/lab/cases', name)) })),
    }
    // Another browser's set for the same seed holds this seed's flat cases already.
    const siblings: Array<{ dir: string; manifest: Manifest }> = []
    for (const other of BROWSERS) {
      const path = join(FRESH, other, seed, 'cases/manifest.json')
      if (other !== browser && existsSync(path)) siblings.push({ dir: join(FRESH, other, seed, 'cases'), manifest: readJson<Manifest>(path) })
    }
    const giants: CaseLine[] = []
    const giantFiles = new Set<string>()
    for (const kind of kinds) {
      const file = join(casesDir, `${kind}.ndjson`)
      const sibling = kind === 'family-widths' ? undefined : siblings.find(value => value.manifest.kinds[kind] !== undefined)
      if (sibling !== undefined) {
        copyFileSync(join(sibling.dir, `${kind}.ndjson`), file)
        const record = sibling.manifest.kinds[kind]!
        manifest.kinds[kind] = { ...record, file: relative(REPO, file), copiedFrom: relative(REPO, join(sibling.dir, `${kind}.ndjson`)) }
        if (sibling.manifest.giants !== null) giantFiles.add(join(sibling.dir, 'giants.ndjson'))
        log(`${kind}: copied ${record.cases} cases from ${relative(REPO, sibling.dir)}`)
        continue
      }
      let cases: Case[]
      let detail: unknown
      if (kind === 'suite') ({ cases, detail } = await suiteSample(seed, positive('suite-sample', 3000), used))
      else if (kind === 'family-widths') {
        const dirs = options.get('family-dirs')?.split(',').map(dir => resolve(dir)) ?? defaultFamilyDirs(browser!)
        const result = familyWidthCases(seed, dirs, positive('widths-per-paragraph', 1), used)
        cases = result.cases
        detail = { paragraphs: result.paragraphs, sources: result.sources.map(source => ({ ...source, file: relative(REPO, source.file) })) }
      } else cases = generatedKind(kind === 'runs' ? RUN_GENERATORS : kind === 'ws' ? WS_GENERATORS : POLICY_GENERATORS, seed, repeat)
      const kept = cases.filter(value => !used.has(value.id))
      for (let i = 0; i < kept.length; i++) used.add(kept[i]!.id)
      writeCases(file, kept)
      // Giants leave the kind's file for giants.ndjson; they keep their ids and lines.
      const lines = readCaseLines(file)
      const big = lines.filter(isGiant)
      if (big.length > 0) {
        giants.push(...big)
        writeCaseLines(file, lines.filter(line => !isGiant(line)))
      }
      const routine = kept.filter(value => !big.some(line => line.id === value.id))
      manifest.kinds[kind] = { file: relative(REPO, file), cases: routine.length, families: familyCounts(routine), removedUsed: cases.length - kept.length, ...(detail === undefined ? {} : { detail }) }
      log(`${kind}: ${routine.length} cases in ${Object.keys(familyCounts(routine)).length} families (${cases.length - kept.length} used ids left out${big.length === 0 ? '' : `, ${big.length} giants apart`})`)
    }
    for (const path of giantFiles) if (existsSync(path)) for (const line of readCaseLines(path)) if (!giants.some(value => value.id === line.id)) giants.push(line)
    if (giants.length > 0) {
      const file = join(casesDir, 'giants.ndjson')
      writeCaseLines(file, giants)
      manifest.giants = { file: relative(REPO, file), cases: giants.length, ids: giants.map(line => line.id) }
    }
    writeJson(manifestPath, manifest)
    return manifest
  })
}

// ---- Parts ----

type PartsRecord = { parts: Array<{ name: string; file: string; cases: number; units: number }>; giants: { file: string; cases: number } | null }

function makeParts(outDir: string, manifest: Manifest, count: number): PartsRecord {
  const partsDir = join(outDir, 'parts')
  const recordPath = join(partsDir, 'parts.json')
  if (existsSync(recordPath)) {
    const record = readJson<PartsRecord>(recordPath)
    if (record.parts.length !== count) log(`keeping the ${record.parts.length} parts made earlier (--parts=${count} ignored)`)
    return record
  }
  mkdirSync(partsDir, { recursive: true })
  const lines: CaseLine[] = []
  for (const kind of KINDS) {
    const record = manifest.kinds[kind]
    if (record === undefined) continue
    for (const line of readCaseLines(join(REPO, record.file))) if (appliesTo(line, browser!)) lines.push(line)
  }
  const record: PartsRecord = { parts: [], giants: null }
  const parts = contiguousParts(lines, count)
  for (let p = 0; p < parts.length; p++) {
    const name = `part-${String(p + 1).padStart(2, '0')}`
    const file = join(partsDir, `${name}.ndjson`)
    writeCaseLines(file, parts[p]!)
    let units = 0
    for (const line of parts[p]!) units += line.units
    record.parts.push({ name, file: relative(REPO, file), cases: parts[p]!.length, units })
  }
  if (manifest.giants !== null) {
    const giants = readCaseLines(join(REPO, manifest.giants.file)).filter(line => appliesTo(line, browser!))
    if (giants.length > 0) {
      const file = join(partsDir, 'giants.ndjson')
      writeCaseLines(file, giants)
      record.giants = { file: relative(REPO, file), cases: giants.length }
    }
  }
  writeJson(recordPath, record)
  return record
}

// ---- Browser jobs ----

type Order = 'forward' | 'reverse'
type Job = { name: string; part: string; order: Order; cases: string; dir: string; giants: boolean }
type JobState = 'ok' | 'failed' | 'absent'

function jobState(job: Job): JobState {
  const runJson = join(job.dir, `${browser}-run.json`)
  if (existsSync(runJson)) {
    try {
      if (readJson<{ status?: string }>(runJson).status === 'ok') return 'ok'
    } catch {
      // An unreadable run.json is a failed job.
    }
    return 'failed'
  }
  return existsSync(join(job.dir, 'run.log')) ? 'failed' : 'absent'
}

function runJob(job: Job, seed: string): Promise<number> {
  mkdirSync(job.dir, { recursive: true })
  const lockArgs = [LOCK_TOOL, `fresh-${browser}-${seed}-${job.name}`, `--max-wait-min=${positive('max-wait-min', 240)}`]
  // No browser named to the lock means every slot: nothing runs beside a giants job.
  if (job.giants) lockArgs.push('--browser=all')
  const runArgs = ['bun', 'rebuild/lab/run.ts', `--browser=${browser}`, `--cases=${job.cases}`, `--out=${job.dir}`, `--order=${job.order === 'forward' ? 'file' : 'reverse'}`,
    `--chunk=${job.giants ? 1 : positive('chunk', 25)}`, `--stall-ms=${job.giants ? positive('stall-ms', 1800000) : positive('stall-ms', 120000)}`]
  if (options.has('predictor')) runArgs.push(`--predictor=${resolve(options.get('predictor')!)}`)
  const extra = (options.get('run-args') ?? '').split(/\s+/).filter(value => value !== '')
  const out = createWriteStream(join(job.dir, 'run.log'))
  return new Promise(done => {
    const child = spawn('python3', [...lockArgs, '--', ...runArgs, ...extra], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', code => {
      out.end()
      done(code ?? 1)
    })
  })
}

function logTail(path: string, lines: number): string {
  if (!existsSync(path)) return '(no log)'
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-lines).map(line => `    ${line}`).join('\n')
}

// ---- Scoring ----

// score.ts reads rows plain or compressed (rows.ts), so a part that compress-rows.sh compressed scores like any other.
function scoreJob(job: Job, other: Job | null): Promise<number> {
  const rows = join(job.dir, `${browser}-rows.ndjson`)
  const args = ['-n', '10', 'bun', 'rebuild/lab/score.ts', `--rows=${rows}`, `--cases=${job.cases}`, `--out=${join(job.dir, `${browser}-summary.json`)}`,
    `--per-case=${join(job.dir, `${browser}-per-case.ndjson`)}`, '--examples=10']
  if (other !== null) args.push(`--native-compare=${join(other.dir, `${browser}-rows.ndjson`)}`)
  const out = createWriteStream(join(job.dir, 'score.log'))
  return new Promise(done => {
    const child = spawn('nice', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', code => {
      out.end()
      done(code ?? 1)
    })
  })
}

// What a part was last scored with: the other order it was compared against, if any.
type ScoreState = { comparedWith: string | null }

function needsScore(job: Job, other: Job | null): boolean {
  const summary = join(job.dir, `${browser}-summary.json`)
  const perCase = join(job.dir, `${browser}-per-case.ndjson`)
  const state = join(job.dir, 'score-state.json')
  const rows = existingRows(job.dir, browser!)
  if (rows === null) fail(`${relative(REPO, job.dir)} holds no ${browser}-rows.ndjson, plain or .zst`)
  const scoredBefore = existsSync(summary) && existsSync(perCase) && existsSync(state)
  if (flags.has('rescore') || !scoredBefore) return true
  const scored = statSync(summary).mtimeMs
  // Compressing rows doesn't change them, so only plain rows newer than the summary ask for another score.
  if (statSync(join(REPO, 'rebuild/lab/score.ts')).mtimeMs > scored || (!rows.endsWith('.zst') && statSync(rows).mtimeMs > scored)) return true
  // A summary scored without the other order is stale once the other order's rows exist.
  return readJson<ScoreState>(state).comparedWith !== (other?.name ?? null)
}

async function pool<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(width, items.length); w++) {
    workers.push((async () => {
      while (next < items.length) await work(items[next++]!)
    })())
  }
  await Promise.all(workers)
}

// ---- Report ----

type PerCase = {
  id: string
  family: string
  lineCount: { status: string; reason?: string; detail?: string }
  breaks: { status: string; reason?: string; detail?: string }
  widths: { status: string; reason?: string; detail?: string }
  painter: { status: string; reason?: string; detail?: string }
  gaps?: string[]
  lineGaps?: Partial<Record<MetricName, MetricAttribution>>
  // The residual class score.ts matched the row against (score.ts RESIDUAL_CLASSES, the one registry).
  residual?: ResidualMembership
  // Where the case's gaps fire (score.ts GapFiring). Absent in files scored before scorer 6.
  firing?: GapFiring
  protocol?: string
  historyDependent?: string
}

type ScoredRun = { name: string; rows: string; perCase: string }

type OpenFailure = {
  id: string
  run: string
  family: string
  metric: MetricName
  reason: string
  detail: string
  signature: string
  // Without the family, the styles and the named characters: what is left when one cause shows up across families.
  coarse: string
  fonts: string[]
  excerpt: string
  largestUnits: number | null
}

const SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u], ['Arabic', /\p{Script=Arabic}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u], ['Hangul', /\p{Script=Hangul}/u], ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u], ['Bengali', /\p{Script=Bengali}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u],
  ['Khmer', /\p{Script=Khmer}/u], ['Myanmar', /\p{Script=Myanmar}/u], ['Emoji', /\p{Extended_Pictographic}|\p{Regional_Indicator}/u],
  ['Digit', /\p{Nd}/u], ['Mark', /\p{M}/u],
]
// Characters worth naming in a signature: spaces other than U+0020, format characters and controls.
const NOTABLE: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], [0x7f, 0xa0], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x1680, 0x1680], [0x180e, 0x180e], [0x2000, 0x200f], [0x2028, 0x202f],
  [0x205f, 0x2064], [0x2066, 0x2069], [0x20e3, 0x20e3], [0x3000, 0x3000], [0xfe0e, 0xfe0f], [0xfeff, 0xfeff], [0xfffc, 0xfffd],
]

function notable(codePoint: number): boolean {
  for (let i = 0; i < NOTABLE.length; i++) if (codePoint >= NOTABLE[i]![0] && codePoint <= NOTABLE[i]![1]) return true
  return false
}

function codeName(char: string): string {
  return `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
}

function scriptNames(text: string): string[] {
  const out: string[] = []
  for (const [name, pattern] of SCRIPTS) if (pattern.test(text)) out.push(name)
  return out
}

function scriptsOf(text: string): string[] {
  const out = scriptNames(text)
  const named = new Set<string>()
  for (const char of text) if (notable(char.codePointAt(0)!)) named.add(codeName(char))
  return [...out, ...[...named].sort()]
}

function firstFamily(family: string): string {
  return family.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
}

function unitBucket(units: number): string {
  const size = Math.abs(units)
  if (size < 0.01) return '<0.01'
  const sign = units > 0 ? '+' : '-'
  const edges = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
  for (let i = 0; i < edges.length; i++) if (size <= edges[i]! + 0.01) return `${sign}${i === 0 ? '≤1' : i === 1 ? '2' : `${edges[i - 1]! + 1}-${edges[i]}`}`
  return `${sign}>1024`
}

// Engine units per CSS px: LayoutUnits of zoomed px in Chrome, app units in Firefox, 1/64 px in WebKit (README, "Scoring").
function unitsPerPx(row: LabRow): number {
  return row.browser === 'chrome' ? 64 * row.env.devicePixelRatio : row.browser === 'firefox' ? 60 : 64
}

type RunSpan = { run: TextRun; start: number; end: number; index: number }

function runSpans(c: Case): RunSpan[] {
  const out: RunSpan[] = []
  let at = 0
  for (let i = 0; i < c.paragraph.runs.length; i++) {
    const run = c.paragraph.runs[i]!
    out.push({ run, start: at, end: at + run.text.length, index: i })
    at += run.text.length
  }
  return out
}

function stylesOf(c: Case, involved: readonly RunSpan[], metric: MetricName): string[] {
  const p = c.paragraph
  const out = new Set<string>()
  for (const { run } of involved) {
    if (run.letterSpacing < 0) out.add('letter-spacing<0')
    if (run.letterSpacing > 0) out.add('letter-spacing>0')
    if (run.wordSpacing !== 0) out.add('word-spacing')
    if (run.font.weight !== 400) out.add(`weight-${run.font.weight}`)
    if (run.font.style !== 'normal') out.add('italic')
    if (run.lang !== null) out.add('span-lang')
  }
  if (involved.length > 1) out.add('node-edge')
  if (p.whiteSpace !== 'normal') out.add(p.whiteSpace)
  if (p.wordBreak !== 'normal') out.add(`word-break:${p.wordBreak}`)
  if (p.lineBreak !== 'auto') out.add(`line-break:${p.lineBreak}`)
  if (metric !== 'widths' && p.overflowWrap !== 'normal') out.add(`overflow-wrap:${p.overflowWrap}`)
  if (p.direction === 'rtl') out.add('rtl')
  if (c.fontFixtures !== undefined) out.add('web-font')
  if (c.inline !== undefined) {
    if (c.inline.textIndent !== 0) out.add('text-indent')
    if (c.inline.textAlign !== 'start') out.add(`text-align:${c.inline.textAlign}`)
    if (c.inline.lineSlots.length > 0) out.add('line-slots')
    const json = JSON.stringify(c.inline.content)
    for (const [kind, label] of [['"kind":"atomic"', 'atomic'], ['"kind":"br"', 'br'], ['"kind":"wbr"', 'wbr']] as const) if (json.includes(kind)) out.add(label)
    if (/"(margin|border|padding)":-?[1-9.]/.test(json) || /"(margin|border|padding)":-?0\.\d*[1-9]/.test(json)) out.add('box-edges')
  }
  return [...out].sort()
}

type NodeDifference = { run: number; rect: number; line: number; units: number }

// Native whole-node rects against the observation port's, in engine units: widths that differ by 0.01 unit or more.
function nodeDifferences(row: LabRow): { differences: NodeDifference[]; countsDiffer: boolean } {
  const out: NodeDifference[] = []
  let countsDiffer = false
  if (!('runRects' in row.native) || !('observation' in row.prediction) || 'error' in row.prediction.observation) return { differences: out, countsDiffer: true }
  const unit = unitsPerPx(row)
  const nodes = row.prediction.observation.nodes
  for (let r = 0; r < Math.max(nodes.length, row.native.runRects.length); r++) {
    const native = row.native.runRects[r] ?? []
    const expected = nodes[r] ?? []
    if (native.length !== expected.length) {
      countsDiffer = true
      continue
    }
    for (let k = 0; k < native.length; k++) {
      const units = Math.round((native[k]!.width - expected[k]!.width.value) * unit * 100) / 100
      if (Math.abs(units) >= 0.01) out.push({ run: r, rect: k, line: expected[k]!.line, units })
    }
  }
  return { differences: out, countsDiffer }
}

function excerptOf(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 12)
  const to = Math.min(text.length, Math.max(end, start + 1) + 12)
  return JSON.stringify(`${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`).slice(0, 160)
}

function describeOpen(row: LabRow, per: PerCase, metric: MetricName, run: string): OpenFailure {
  const c = row.case
  const text = rowText(c)
  const spans = runSpans(c)
  const attribution = per.lineGaps?.[metric]
  const layout = 'layout' in row.prediction ? row.prediction.layout : null
  const { differences } = nodeDifferences(row)
  let start = 0
  let end = text.length
  let size = 'no-line'
  let largest: number | null = null
  let involved: RunSpan[] = spans
  const failingLines = (attribution?.lines ?? []).filter(line => line.engineLine !== null).map(line => line.engineLine!)
  if (metric === 'painter') {
    // The painter draws the predicted lines, so the failing lines' runs are involved, and the size is the painted extent
    // less the engine width as the scorer's detail gives them.
    if (layout !== null && failingLines.length > 0) {
      start = Math.min(...failingLines.map(l => layout.lines[l]!.start))
      end = Math.max(...failingLines.map(l => layout.lines[l]!.end))
      involved = spans.filter(span => span.start < end && span.end > start)
      if (involved.length === 0) involved = spans
    }
    const extent = /width (-?[\d.]+); painted [a-z ]+ span \[(-?[\d.]+), (-?[\d.]+)\]/.exec(per.painter.detail ?? '')
    if (extent !== null) {
      // Chrome and Firefox details are in engine units already; WebKit's are CSS px.
      largest = Math.round((Number(extent[3]) - Number(extent[2]) - Number(extent[1])) * (row.browser === 'chrome' || row.browser === 'firefox' ? 1 : 64) * 100) / 100
      size = `${unitBucket(largest)}u`
    } else size = (per.painter.reason ?? 'painter').replace(/ /g, '-')
  } else if (metric === 'widths' && layout !== null && failingLines.length > 0) {
    const onLines = differences.filter(value => failingLines.includes(value.line))
    start = Math.min(...failingLines.map(l => layout.lines[l]!.start))
    end = Math.max(...failingLines.map(l => layout.lines[l]!.end))
    if (onLines.length > 0) {
      involved = spans.filter(span => onLines.some(value => value.run === span.index))
      for (const value of onLines) if (largest === null || Math.abs(value.units) > Math.abs(largest)) largest = value.units
      size = `${unitBucket(largest!)}u×${onLines.length}`
      // The differing nodes' text on the failing lines.
      const lo = Math.max(start, Math.min(...involved.map(span => span.start)))
      const hi = Math.min(end, Math.max(...involved.map(span => span.end)))
      if (lo < hi) {
        start = lo
        end = hi
      }
    } else {
      involved = spans.filter(span => span.start < end && span.end > start)
      size = 'no-node-differs'
    }
  } else if (metric !== 'widths' && layout !== null && attribution !== undefined && attribution.lines.length > 0 && 'points' in row.native) {
    // The text between the predicted break and the native one, at the first line where they disagree.
    const first = attribution.lines[0]!
    const lines = nativeLines(row.native, c.paragraph, row.browser)
    let nativeStart = Infinity
    let nativeEnd = -1
    for (let i = 0; i < row.native.points.length; i++) {
      const point = row.native.points[i]!
      if (!lines.points[i]!.includes(first.nativeLine)) continue
      nativeStart = Math.min(nativeStart, point.offset)
      nativeEnd = Math.max(nativeEnd, point.offset + point.length)
    }
    const predicted = first.engineLine === null ? null : layout.lines[first.engineLine]!
    if (predicted !== null && nativeEnd >= 0) {
      start = Math.min(predicted.end, nativeEnd)
      end = Math.max(predicted.end, nativeEnd)
      if (start === end) {
        // The ends agree, so the starts differ.
        start = Math.min(predicted.start, nativeStart)
        end = Math.max(predicted.start, nativeStart)
      }
    } else if (nativeEnd >= 0) {
      start = nativeStart
      end = nativeEnd
    } else if (predicted !== null) {
      start = predicted.start
      end = predicted.end
    }
    const boxes = layout.lines.filter(line => line.hasLineBox).length
    const delta = lines.count - boxes
    size = `lines${delta === 0 ? '=' : delta > 0 ? `+${delta}` : String(delta)} moved${end - start <= 1 ? '≤1' : end - start <= 4 ? '2-4' : end - start <= 16 ? '5-16' : '>16'}cu`
    involved = spans.filter(span => span.start < Math.min(text.length, end + 1) && span.end > Math.max(0, start - 1))
    if (involved.length === 0) involved = spans
  } else if ('error' in row.prediction) {
    size = 'prediction-error'
  }
  const fonts = [...new Set(involved.map(span => firstFamily(span.run.font.family)))].sort()
  const scripts = scriptsOf(text.slice(Math.max(0, start - 1), Math.min(text.length, end + 1)))
  // Painter signatures keep only the styles the painter's markup depends on, so one painter rule doesn't scatter.
  const styles = metric === 'painter' ? stylesOf(c, involved, metric).filter(style => !style.startsWith('weight-') && !style.startsWith('overflow-wrap') && style !== 'italic' && style !== 'span-lang') : stylesOf(c, involved, metric)
  const decls = [...new Set(involved.map(span => `${span.run.font.style === 'normal' ? '' : 'italic '}${span.run.font.weight} ${span.run.font.size}px ${firstFamily(span.run.font.family)}`))].sort()
  return {
    id: row.id, run, family: row.family, metric, reason: per[metric].reason ?? '', detail: per[metric].detail ?? '',
    signature: `${row.family} | ${metric} | ${fonts.join('+')} | ${scripts.join('+') || 'none'} | ${styles.join(' ') || 'plain'} | ${size}`,
    coarse: `${metric}${metric === 'painter' ? ` | ${per.painter.reason ?? ''}` : ''} | ${fonts.join('+')} | ${scriptNames(text.slice(Math.max(0, start - 1), Math.min(text.length, end + 1))).join('+') || 'none'} | ${size}`,
    fonts: decls, excerpt: excerptOf(text, start, end), largestUnits: largest,
  }
}

type Firing = { passingLines: number; passingCases: number; failingLines: number }

async function report(runs: readonly ScoredRun[], reverse: readonly ScoredRun[], outPath: string, header: Record<string, unknown>): Promise<void> {
  // Residual classes are the scorer's: score.ts matches every failing row against RESIDUAL_CLASSES and the per-case file
  // carries the result, so this report only reads it.
  const engine = browser === 'chrome' ? 'blink' : browser === 'firefox' ? 'gecko' : 'webkit'
  const classes = RESIDUAL_CLASSES.filter(value => value.engine === engine)
  const totals = {
    cases: 0, historyDependent: 0, protocolRows: 0, predictionFailures: 0, coveredPredictionFailures: 0, openPredictionFailures: 0, residual: 0,
    metrics: {} as Record<string, Record<string, number>>, open: { lineCount: 0, breaks: 0, widths: 0, painter: 0 } as Record<MetricName, number>,
    painterFailures: 0, openPainterOnly: 0,
  }
  const open: OpenFailure[] = []
  const painterOpen: OpenFailure[] = []
  const residual = new Map<string, { probed: string[]; signatureOnly: string[] }>()
  const firing = new Map<string, Firing>()
  const fire = (gap: string): Firing => {
    let value = firing.get(gap)
    if (value === undefined) firing.set(gap, (value = { passingLines: 0, passingCases: 0, failingLines: 0 }))
    return value
  }
  let passingLines = 0
  let passingCases = 0
  let failingLines = 0
  for (const run of runs) {
    const perCase = new Map<string, PerCase>()
    for (const line of readFileSync(run.perCase, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const per = JSON.parse(line) as PerCase
      perCase.set(per.id, per)
    }
    for await (const line of readLines(run.rows)) {
      const id = /"id":"(c-[0-9a-f]{16})"/.exec(line.slice(0, 200))?.[1]
      const per = id === undefined ? undefined : perCase.get(id)
      if (per === undefined) continue
      totals.cases++
      if (per.historyDependent !== undefined) {
        totals.historyDependent++
        continue
      }
      if (per.protocol !== undefined) {
        totals.protocolRows++
        continue
      }
      for (const metric of ['lineCount', 'breaks', 'widths', 'painter'] as const) {
        const counts = totals.metrics[metric] ??= {}
        counts[per[metric].status] = (counts[per[metric].status] ?? 0) + 1
      }
      const failing = PREDICTION.filter(metric => per[metric].status === 'fail')
      const uncovered = failing.filter(metric => per.lineGaps?.[metric]?.covered !== true)
      const painterOpenHere = per.painter.status === 'fail' && per.lineGaps?.painter?.covered !== true
      // Gap firing, from the scorer's per-case record (score.ts GapFiring): on the line boxes of cases whose three
      // prediction metrics pass, and on the failing lines of prediction failures. Painter-only failures don't enter the lift.
      if (per.firing !== undefined) {
        if (failing.length === 0 && PREDICTION.every(metric => per[metric].status === 'pass')) {
          passingCases++
          passingLines += per.firing.lines
          for (const [gap, lines] of Object.entries(per.firing.gaps)) {
            fire(gap).passingLines += lines
            fire(gap).passingCases++
          }
        } else if (failing.length > 0) {
          const engineLines = new Map<number, readonly string[]>()
          for (const metric of failing) for (const value of per.lineGaps?.[metric]?.lines ?? []) if (value.engineLine !== null) engineLines.set(value.engineLine, value.fires ?? [])
          for (const fires of engineLines.values()) {
            failingLines++
            for (const gap of fires) fire(gap).failingLines++
          }
        }
      }
      // Only a failure that gets described needs its row.
      const row = uncovered.length > 0 || (painterOpenHere && failing.length === 0) ? JSON.parse(line) as LabRow : null
      if (per.painter.status === 'fail') totals.painterFailures++
      if (failing.length > 0) {
        totals.predictionFailures++
        if (uncovered.length === 0) totals.coveredPredictionFailures++
      }
      if (uncovered.length > 0) {
        const match = per.residual
        if (match !== undefined) {
          totals.residual++
          let members = residual.get(match.name)
          if (members === undefined) residual.set(match.name, (members = { probed: [], signatureOnly: [] }))
          ;(match.membership === 'probed' ? members.probed : members.signatureOnly).push(per.id)
        } else {
          totals.openPredictionFailures++
          for (const metric of uncovered) totals.open[metric]++
          open.push(describeOpen(row!, per, uncovered[0]!, run.name))
        }
      } else if (painterOpenHere && failing.length === 0) {
        totals.openPainterOnly++
        totals.open.painter++
        painterOpen.push(describeOpen(row!, per, 'painter', run.name))
      }
    }
  }
  // The reverse order's open failures, by id only: what the forward order doesn't show.
  let reverseOpen: string[] | null = null
  if (reverse.length > 0) {
    // Residual members are known in the forward order too; the reverse order's aren't matched again (that needs its rows).
    const forward = new Set(open.map(value => value.id))
    for (const members of residual.values()) for (const id of [...members.probed, ...members.signatureOnly]) forward.add(id)
    reverseOpen = []
    for (const run of reverse) {
      for (const line of readFileSync(run.perCase, 'utf8').split('\n')) {
        if (line.trim() === '') continue
        const per = JSON.parse(line) as PerCase
        if (per.historyDependent !== undefined || per.protocol !== undefined) continue
        if (PREDICTION.some(metric => per[metric].status === 'fail' && per.lineGaps?.[metric]?.covered !== true) && !forward.has(per.id)) reverseOpen.push(per.id)
      }
    }
  }
  const group = (list: readonly OpenFailure[], key: 'signature' | 'coarse' = 'signature'): Array<{ signature: string; cases: number; ids: string[]; examples: OpenFailure[] }> => {
    const groups = new Map<string, OpenFailure[]>()
    for (const value of list) {
      let members = groups.get(value[key])
      if (members === undefined) groups.set(value[key], (members = []))
      members.push(value)
    }
    return [...groups].map(([signature, members]) => ({ signature, cases: members.length, ids: members.map(value => value.id), examples: members.slice(0, examples) }))
      .sort((a, b) => b.cases - a.cases || (a.signature < b.signature ? -1 : 1))
  }
  const rate = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 10000) / 10000)
  const firingRates = [...firing].map(([gap, value]) => ({
    gap, passingLines: value.passingLines, passingLineRate: rate(value.passingLines, passingLines), passingCases: value.passingCases,
    passingCaseRate: rate(value.passingCases, passingCases), failingLines: value.failingLines, failingLineRate: rate(value.failingLines, failingLines),
    lift: value.passingLines === 0 || failingLines === 0 ? null : Math.round((value.failingLines / failingLines / (value.passingLines / passingLines)) * 100) / 100,
  })).sort((a, b) => b.passingLines - a.passingLines)
  const result = {
    format: 'pretext-lab-fresh-report/1', generatedAt: new Date().toISOString(), ...header,
    definition: 'open: a lineCount, breaks or widths failure whose per-case lineGaps[metric].covered isn\'t true (score.ts decides coverage), outside history-dependent cases, protocol rows and residual classes; painter-only: the painter fails uncovered while the three prediction metrics pass',
    historyDependence: reverse.length > 0 ? 'forward scored against reverse' : 'not checked: one order only',
    totals: { ...totals, passingCases, passingLines, failingLines },
    openCoarse: group(open, 'coarse').map(value => ({ signature: value.signature, cases: value.cases, families: [...new Set(value.examples.concat(open.filter(item => item.coarse === value.signature)).map(item => item.family))].sort(), ids: value.ids })),
    open: group(open),
    openPainterOnlyCoarse: group(painterOpen, 'coarse').map(value => ({ signature: value.signature, cases: value.cases, ids: value.ids })),
    openPainterOnly: group(painterOpen),
    residualClasses: classes.map(value => ({
      id: value.name, difference: value.description, mechanism: `${value.mechanism.status}: ${value.mechanism.reading}`,
      probed: residual.get(value.name)?.probed ?? [], signatureOnly: residual.get(value.name)?.signatureOnly ?? [],
    })),
    reverseOnlyOpen: reverseOpen,
    gapFiring: { note: 'score.ts GapFiring: a gap fires on a line when the line\'s own gaps hold it or a ranged paragraph gap meets the line\'s source range; passing lines are the line boxes of cases whose lineCount, breaks and widths pass; failing lines are the engine lines score.ts attributes to lineCount, breaks and widths failures; painter-only failures are in neither, so the lift is over prediction failures alone', rates: firingRates },
  }
  writeJson(outPath, result)

  // ---- Text ----
  const print = (text: string): void => console.log(text)
  print('')
  print(`== Fresh round report: ${browser}${header['seed'] === undefined ? '' : `, seed ${String(header['seed'])}`} ==`)
  print(`cases ${totals.cases} (history-dependent ${totals.historyDependent}, protocol rows ${totals.protocolRows}; history dependence ${result.historyDependence})`)
  for (const metric of ['lineCount', 'breaks', 'widths', 'painter']) print(`  ${metric.padEnd(9)} ${Object.entries(totals.metrics[metric] ?? {}).map(([status, n]) => `${status} ${n}`).join(', ')}`)
  print(`prediction failures ${totals.predictionFailures}: covered ${totals.coveredPredictionFailures}, residual ${totals.residual}, open ${totals.openPredictionFailures} (lineCount ${totals.open.lineCount}, breaks ${totals.open.breaks}, widths ${totals.open.widths})`)
  print(`painter failures ${totals.painterFailures}; painter-only without a covered explanation ${totals.openPainterOnly}`)
  const printCoarse = (title: string, groups: ReadonlyArray<{ signature: string; cases: number; ids: string[]; families?: string[] }>, limit: number, shape = 'metric | fonts | scripts | size'): void => {
    print('')
    print(`-- ${title}: ${groups.reduce((sum, value) => sum + value.cases, 0)} cases in ${groups.length} coarse signatures (${shape}) --`)
    for (const value of groups.slice(0, limit)) print(`${String(value.cases).padStart(4)}  ${value.signature}   ${value.ids.slice(0, 2).join(' ')}${value.families === undefined ? '' : `   [${value.families.slice(0, 4).join(', ')}${value.families.length > 4 ? `, +${value.families.length - 4}` : ''}]`}`)
    if (groups.length > limit) print(`      … ${groups.length - limit} more in report.json`)
  }
  const printGroups = (title: string, groups: ReturnType<typeof group>, limit: number): void => {
    print('')
    print(`-- ${title}: ${groups.reduce((sum, value) => sum + value.cases, 0)} cases in ${groups.length} signatures (family | metric | fonts | scripts and named characters | styles | size in engine units × differing nodes) --`)
    for (const value of groups.slice(0, limit)) {
      print(`${String(value.cases).padStart(4)}  ${value.signature}`)
      for (const example of value.examples) print(`        ${example.id} ${example.run} [${example.fonts.join('; ')}] ${example.excerpt}${example.detail === '' ? '' : `\n          ${example.reason}: ${example.detail.slice(0, 200)}`}`)
    }
    if (groups.length > limit) print(`      … ${groups.length - limit} more signatures in report.json`)
  }
  const maxGroups = positive('max-groups', 40)
  printCoarse('Open prediction failures', result.openCoarse, 60)
  printGroups('Open prediction failures', result.open, maxGroups)
  if (result.openPainterOnly.length > 0) printCoarse('Painter-only failures without a covered explanation', result.openPainterOnlyCoarse, 30, 'painter | reason | fonts | scripts | size')
  print('')
  print('-- Residual classes --')
  for (const value of result.residualClasses) print(`  ${value.id}: probed ${value.probed.length}, signature only ${value.signatureOnly.length}${value.signatureOnly.length === 0 ? '' : ` (${value.signatureOnly.slice(0, 8).join(', ')})`}\n    ${value.mechanism}`)
  if (result.residualClasses.length === 0) print('  none registered for this engine (score.ts RESIDUAL_CLASSES)')
  if (reverseOpen !== null) print(`\nreverse order: ${reverseOpen.length} open cases the forward order doesn't have${reverseOpen.length === 0 ? '' : `: ${reverseOpen.slice(0, 12).join(', ')}`}`)
  print('')
  print(`-- Gap firing on ${passingLines} passing lines (${passingCases} cases) and ${failingLines} failing lines --`)
  print('  gap                               passing lines   rate    cases rate   failing lines  rate    lift')
  for (const value of firingRates) {
    print(`  ${value.gap.padEnd(32)} ${String(value.passingLines).padStart(13)}  ${(value.passingLineRate * 100).toFixed(2).padStart(6)}%  ${(value.passingCaseRate * 100).toFixed(2).padStart(9)}%  ${String(value.failingLines).padStart(13)}  ${(value.failingLineRate * 100).toFixed(2).padStart(6)}%  ${value.lift === null ? '   -' : value.lift.toFixed(2).padStart(6)}`)
  }
  print('')
  print(`report: ${relative(REPO, outPath)}`)
}

// ---- Main ----

async function main(): Promise<void> {
  if (reportMode) {
    const dirs = (options.get('runs') ?? fail('report needs --runs=<dir>[,<dir>...]')).split(',').map(dir => resolve(dir))
    const runs: ScoredRun[] = []
    for (const dir of dirs) {
      const rows = existingRows(dir, browser!)
      const perCase = join(dir, `${browser}-per-case.ndjson`)
      if (rows === null || !existsSync(perCase)) fail(`${dir} holds no ${browser}-rows.ndjson(.zst) with a ${browser}-per-case.ndjson`)
      runs.push({ name: basename(dir), rows, perCase })
    }
    await report(runs, [], resolve(options.get('out') ?? join(dirs[0]!, `${browser}-fresh-report.json`)), { browser, runs: dirs.map(dir => relative(REPO, dir)) })
    return
  }

  const seed = options.get('seed') ?? fail('--seed is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seed)) fail('--seed may hold letters, digits, dots, dashes and underscores')
  const kinds = (options.get('kinds') ?? KINDS.join(',')).split(',') as Kind[]
  for (const kind of kinds) if (!KINDS.includes(kind)) fail(`Unknown kind ${kind}; expected ${KINDS.join(', ')}`)
  const giantsMode = options.get('giants') ?? 'skip'
  if (giantsMode !== 'skip' && giantsMode !== 'run') fail('--giants must be skip or run')
  const outDir = join(FRESH, browser!, seed)
  mkdirSync(outDir, { recursive: true })

  const manifest = await generate(outDir, seed, KINDS.filter(kind => kinds.includes(kind)))
  const parts = makeParts(outDir, manifest, positive('parts', browser === 'safari' ? 1 : 3))
  log(`${parts.parts.length} parts: ${parts.parts.map(part => `${part.name} ${part.cases}`).join(', ')}${parts.giants === null ? '' : `; giants ${parts.giants.cases} (${giantsMode === 'run' ? 'run exclusively after the parts' : 'skipped; --giants=run runs them'})`}`)
  if (flags.has('generate-only')) return

  const orders: Order[] = flags.has('both-orders') ? ['forward', 'reverse'] : ['forward']
  const jobs: Job[] = []
  for (const part of parts.parts) for (const order of orders) jobs.push({ name: `${part.name}-${order}`, part: part.name, order, cases: join(REPO, part.file), dir: join(outDir, 'runs', `${part.name}-${order}`), giants: false })
  const giantJobs: Job[] = []
  if (parts.giants !== null && giantsMode === 'run') for (const order of orders) giantJobs.push({ name: `giants-${order}`, part: 'giants', order, cases: join(REPO, parts.giants.file), dir: join(outDir, 'runs', `giants-${order}`), giants: true })

  const failed: Array<{ job: string; code: number | null; log: string }> = []
  if (!flags.has('report-only')) {
    const launch = async (job: Job): Promise<void> => {
      let state = jobState(job)
      if (state === 'failed' && flags.has('rerun-failed')) {
        renameSync(job.dir, `${job.dir}.failed-${new Date().toISOString().replace(/[:.]/g, '')}`)
        state = 'absent'
      }
      if (state === 'ok') return
      if (state === 'failed') {
        failed.push({ job: job.name, code: null, log: relative(REPO, join(job.dir, 'run.log')) })
        return
      }
      const started = Date.now()
      const code = await runJob(job, seed)
      if (code === 0 && jobState(job) === 'ok') log(`${job.name}: ok in ${Math.round((Date.now() - started) / 1000)} s (lock wait included)`)
      else failed.push({ job: job.name, code, log: relative(REPO, join(job.dir, 'run.log')) })
    }
    // Every part at once: the lock gives each browser its slots and queues the rest.
    await Promise.all(jobs.map(launch))
    for (const job of giantJobs) await launch(job)
    for (const value of failed) {
      log(`FAILED ${value.job}${value.code === null ? ' (in an earlier call)' : ` (exit ${value.code})`}: not run again. Diagnose from ${value.log}, fix the cause, then pass --rerun-failed once.`)
      console.log(logTail(join(REPO, value.log), 12))
    }
  }

  const finished = [...jobs, ...giantJobs].filter(job => jobState(job) === 'ok')
  const otherOrder = (job: Job): Job | null => finished.find(value => value.part === job.part && value.order !== job.order) ?? null
  const scoreFailures: string[] = []
  await pool(finished.filter(job => needsScore(job, otherOrder(job))), 4, async job => {
    const code = await scoreJob(job, otherOrder(job))
    if (code === 0) writeJson(join(job.dir, 'score-state.json'), { comparedWith: otherOrder(job)?.name ?? null } satisfies ScoreState)
    if (code !== 0) {
      scoreFailures.push(job.name)
      log(`score.ts failed on ${job.name} (exit ${code}):`)
      console.log(logTail(join(job.dir, 'score.log'), 8))
    }
  })

  const scored = (order: Order): ScoredRun[] => finished.filter(job => job.order === order && !scoreFailures.includes(job.name) && existsSync(join(job.dir, `${browser}-per-case.ndjson`)))
    .map(job => ({ name: job.name, rows: existingRows(job.dir, browser!) ?? join(job.dir, `${browser}-rows.ndjson`), perCase: join(job.dir, `${browser}-per-case.ndjson`) }))
  const round = {
    format: 'pretext-lab-fresh-round/1', browser, seed, updatedAt: new Date().toISOString(), orders, cases: relative(REPO, join(outDir, 'cases')),
    jobs: [...jobs, ...giantJobs].map(job => ({ name: job.name, state: jobState(job), scored: !scoreFailures.includes(job.name) && existsSync(join(job.dir, `${browser}-summary.json`)) })),
    failedJobs: failed, scoreFailures,
  }
  writeJson(join(outDir, 'round.json'), round)
  if (scored('forward').length === 0) fail('no scored forward part to report on')
  await report(scored('forward'), scored('reverse'), join(outDir, 'report.json'), { browser, seed, parts: scored('forward').map(run => run.name), missingParts: jobs.filter(job => job.order === 'forward' && !scored('forward').some(run => run.name === job.name)).map(job => job.name) })
  if (failed.length > 0 || scoreFailures.length > 0) process.exit(2)
}

await main()
