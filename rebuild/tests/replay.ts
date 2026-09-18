// Tier 1: offline replay (rebuild/lab/README.md, "Test tiers"). The library runs in bun, with no browser, against the
// Canvas answers a browser gave when the sets were recorded (browser-sets.ts --record; lab/record.ts), in parallel across
// cores, and every case's full prediction is compared with a frozen reference.
//
//   bun rebuild/tests/replay.ts pack   --browser=<b> [--config=no-facts|facts] --runs=<browser-sets out dir> [--dir=<replay dir>]
//   bun rebuild/tests/replay.ts freeze --browser=<b> [--config=...] [--dir=...] [--force --reason=<text>] [--questions-only] [--allow-dirty]
//   bun rebuild/tests/replay.ts check  --browser=<b>|all [--config=...|all] [--dir=...] [--against=reference|browser] [--sets=a,b]
//     [--groups=...] [--out=<report.json>] [--jobs=N] [--sites]
//
// `check --browser=all --config=all` is the whole tier: every frozen reference there is, one after another (each check uses
// every core), with the worst exit code.
//
// The replay folder, by default .artifacts/tests/reference/<browser>-<config>:
// - inputs/: what a replay reads. Per case its Case, the page facts the library reads (user agent, DPR, <html lang>), the
//   build and the given process languages, and the record's predict and observe phases: every measureText call with its
//   context's assigned settings and its answer, and every dictionary segmentation. Shards of about equal numbers of calls,
//   zstd NDJSON, with manifest.json (hashes, the recording's bundle, the sets' protocols).
// - browser/: the predictions the browser itself recorded for those cases, in the reference's format. `pack` writes it and
//   checks the working tree against it: a case where the replay doesn't give what the browser's own run of the same library
//   gave is `unfaithful` (listed in inputs/manifest.json), and the replay can't stand in for the browser on it.
// - reference/: the frozen reference, the replay's output at one commit, with manifest.json; `freeze` also copies the
//   manifest to rebuild/tests/reference/<browser>-<config>.json, so the repository pins the reference by hash. A reference
//   is never overwritten without --force and --reason, and the manifest keeps the record of what it replaced.
// - ledger/: the known-status ledger of the recorded runs (ledger.ts), beside the reference. `pack` copies it from the run,
//   so the inputs, the browser's predictions and the statuses come from one recording; `freeze` pins its hash too.
// `check` only reads that folder. The shards' results and, by default, the report go to rebuild/tests/.check/<browser>-<config>
// in the working tree (untracked), so owners in several worktrees who share one .artifacts check one reference at once.
//
// The full prediction of a case is what the row of a browser run keeps of it (lab/types.ts EnginePrediction): the layout
// (every line with its geometry, fragments, gaps and limits, the slots below floats, the paragraph's gaps, the environment),
// the observation port's expected rects with their predicted and limited values, and the painter's limits per line; or the
// prediction error. `check` compares it as JSON with the reference, and reports per changed case the first field that
// differs. Beside it, the questions: which recorded calls answered the library's measureText calls, in order, and how many
// contexts the library made, which the replay counts itself. Outcomes per case:
// - same;
// - prediction changed: named with the first differing field, grouped by field and family, with the case's statuses in the
//   ledger when there is one;
// - questions changed: the same prediction from other questions. Canvas answers can depend on what a context measured
//   before (Blink caches shaped words per canvas), so such a case is verified offline only up to that assumption, and goes
//   to tier 2. A question is a context and a string, and each changed case is one of (research/ARCHITECTURE-PLAN-2.md §7):
//   - repeats only: the same set of questions, each context's first occurrences in the reference's order, so only the
//     number of times a question is asked again moved. Measuring the same text again on a context returns the same bits
//     in all three engines, and a repeat can't reorder two different strings;
//   - dropped only: a subset of the reference's questions, the first occurrences that remain in the reference's order,
//     and no more contexts. A step accepts it only where it names what it drops;
//   - other questions: first occurrences in another order within a context, a recorded question the reference didn't ask,
//     or another number of contexts. No step accepts it;
// - new question: the library asked Canvas, or a dictionary segmenter, something the record doesn't hold: a changed
//   measuring recipe. Nothing offline can answer it, the case isn't compared, and it goes to tier 2. No step accepts it.
// `check` writes <out>.needs-browser.ids beside the report: new questions, questions changed and unfaithful cases, for
// browser-sets.ts --ids-file. Exit 0 when every case is the same; 1 when a prediction changed; 3 when none did and every
// case whose questions changed is repeats only or dropped only (or the string storage rule below sends cases to tier 2);
// 4 when none did but a case asks other questions or a new one.
//
// The report also counts, over the cases that replayed, the questions asked and the distinct ones (a context and a string
// asked once or more), per phase: asked over distinct is the ask ratio, 1 when nothing is asked twice. `--sites` adds asks
// and repeats by library call site, read from the stack inside the replay's context (lab/measurements.ts SiteTally), so
// nothing in rebuild/src counts anything.
//
// `freeze --force --questions-only` is how the questions are frozen again after a step that changed only them passed its
// browser runs: it refuses unless every case's prediction is byte for byte the replaced reference's and no case asks a new
// question, so predictions are never frozen again and the latest reference still holds the first one's predictions
// (the manifest's `predictionsFrom`).
//
// Deterministic by construction: every shard runs in a process of its own, cases in recorded order, so no result depends
// on the number of cores or on what ran before; the report lists cases in the sets' order and holds no time. What a
// replay can't cover, and where it goes instead:
// - the painter (the DOM paints and measures it) and everything native: tier 2;
// - questions the record doesn't hold, and answers that depend on the order of questions: by the rule above, tier 2;
// - what the library reads from its host outside Canvas and the segmenters: regular expressions with Unicode properties
//   (src/paint.ts reads scripts that way), String.prototype.normalize, case mapping and Intl run on bun's Unicode tables,
//   not the browser's. `pack`'s check against the browser's own predictions finds the cases where that shows, under the
//   recorded library; they are the `unfaithful` ones;
// - dictionary-segmenter scripts (Thai, Lao, Khmer, Myanmar; Intl.Segmenter, Intl.v8BreakIterator) replay from the recorded
//   segmentations as long as the library segments the same strings; another string is a new question;
// - string storage: Blink's Canvas answers depend on whether V8 stores a string in 8 or 16 bits (harfbuzz_shaper.cc:1072-1101,
//   to_blink_string.cc:216-227), which no record shows and bun doesn't have: the Blink port makes a Latin-1-only string of
//   13 code units or more 16-bit by slicing it out of a 16-bit string (engines/blink/shape.ts canvasString), and a library
//   that built the same characters another way would replay the same and measure another width in Chrome. So `pack` lists
//   Chrome's storage-sensitive cases (inputs/storage-sensitive.ids: a Latin-1-only question of 13 units or more), and
//   `check` sends them to tier 2 whenever a file that builds the strings Canvas measures differs from the reference's
//   commit (STORAGE_PATHS);
// - a library that keeps Canvas answers across paragraphs would ask less in a browser document than in a replayed case;
//   it shows as new questions. Today every measurer is per paragraph;
// - two of the library's contexts with equal assigned settings (its partitions) are told apart only by order
//   (lab/measurements.ts), so questions that moved between them replay the same; the count of contexts shows a merge or a split;
// - giants (paragraphs over 50,000 units) are in no recorded set.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import type { ExpectedObservation, ParagraphLayout } from '../src/model.ts'
import { installReplay, newSiteTally, NewQuestion, readMeasurements, type SiteCount, type SiteTally } from '../lab/measurements.ts'
import { observeBlink } from '../lab/observe/blink.ts'
import { observeGecko } from '../lab/observe/gecko.ts'
import { observeWebKit } from '../lab/observe/webkit.ts'
import { createPortMeasure } from '../lab/port-measure.ts'
import type { CaseMeasurements, RecordedCall } from '../lab/record.ts'
import { readLines } from '../lab/rows.ts'
import type { BrowserBuild, BrowserKind, Case, LabRow, LayoutPrediction, LinesPrediction, PainterLimits, ProcessLanguages, RecordedLayout } from '../lab/types.ts'
import { readLedger, type LedgerEntry, type SetsRun } from './ledger.ts'
import { CONFIGS, PREDICTORS, REPO, TIER_BROWSERS, selectSets, type Config, type SetProtocol, type TierBrowser } from './sets.ts'

const INPUTS_FORMAT = 'pretext-replay-inputs/1'
// Format 1 references also hold the library's memo hits per case, which nothing reads any more; `freeze` writes format 2.
const REFERENCE_FORMAT = 'pretext-replay-reference/2'
const REFERENCE_FORMATS: readonly string[] = ['pretext-replay-reference/1', REFERENCE_FORMAT]
// A shard ends once it holds this many recorded calls (a case weighs its calls plus a constant), so shards take about
// equal time and the longest is a few seconds.
const SHARD_CALLS = 120_000
const CASE_WEIGHT = 40

// ---- Shapes ----

type PageFacts = { userAgent: string; devicePixelRatio: number; pageLang: string }
export type InputCase = { id: string; family: string; case: Case; browser: BrowserKind; env: PageFacts; build: BrowserBuild; languages: ProcessLanguages['given'] | null; record: CaseMeasurements }
export type FullPrediction =
  | { layout: RecordedLayout; observation: ExpectedObservation | { error: string }; painterLimits: PainterLimits | { error: string } | null }
  | { error: string }
// 'all': the phase's recorded calls, each once and in order. Otherwise the indices of the answering calls within the phase.
export type Asked = 'all' | number[]
// `contexts`: the Canvas contexts the prediction made, as the replay counts them (lab/measurements.ts Replay).
export type Questions = { predict: Asked; observe: Asked; contexts: number }
export type ReferenceCase = { id: string; prediction: FullPrediction; questions: Questions | null }
// Questions asked and distinct ones (lab/measurements.ts Replay), per phase.
type AskCounts = { predict: { asked: number; distinct: number }; observe: { asked: number; distinct: number } }

type Shard = { file: string; cases: number; calls: number; sha256: string }
type InputsManifest = {
  format: typeof INPUTS_FORMAT
  browser: TierBrowser
  config: Config
  predictor: string
  build: BrowserBuild
  bundles: string[]
  recordedFrom: string
  sets: Record<string, { protocol: SetProtocol; shards: Shard[] }>
  cases: number
  calls: number
  // Cases where the library's own call log and the recorder disagree (record.ts `library.agrees`): the record may not
  // hold what the library asked.
  logDisagrees: string[]
}
// inputs/unfaithful.json, written by `pack` after the manifest: per `<set>/<case id>`, how the replay under the recorded
// library differs from the browser's own prediction.
type Unfaithful = { checkedAt: string; commit: string; dirty: string[]; cases: Record<string, string> }
type ReferenceManifest = {
  format: string
  kind: 'browser' | 'replay'
  browser: TierBrowser
  config: Config
  inputsSha256: string
  commit: string
  dirty: string[]
  createdAt: string
  reason: string
  // The records of the references this one replaced, oldest first.
  replaced: Array<{ commit: string; createdAt: string; reason: string; cases: number }>
  // Set by `freeze --questions-only`: the commit of the earliest reference in the chain whose predictions this one holds
  // byte for byte.
  predictionsFrom?: string
  sets: Record<string, Array<{ file: string; cases: number; sha256: string }>>
  cases: number
  // The ledger beside the reference, by the hashes of its two files; null when the recording left none.
  ledger: { headerSha256: string; entriesSha256: string } | null
}

function ledgerHashes(dir: string): ReferenceManifest['ledger'] {
  const header = join(dir, 'ledger/ledger.json')
  const entries = join(dir, 'ledger/entries.ndjson')
  return existsSync(header) && existsSync(entries) ? { headerSha256: sha256(readFileSync(header)), entriesSha256: sha256(readFileSync(entries)) } : null
}

// ---- Small tools ----

function fail(text: string): never {
  console.error(`[replay] ${text}`)
  process.exit(2)
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

function readShard<T>(path: string): T[] {
  const text = new TextDecoder().decode(Bun.zstdDecompressSync(readFileSync(path)))
  const out: T[] = []
  for (const line of text.split('\n')) if (line !== '') out.push(JSON.parse(line) as T)
  return out
}

function writeShard(path: string, lines: readonly string[]): { sha256: string } {
  mkdirSync(dirname(path), { recursive: true })
  const bytes = Bun.zstdCompressSync(new TextEncoder().encode(lines.join('\n') + '\n'), { level: 6 })
  writeFileSync(path, bytes)
  return { sha256: sha256(bytes) }
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
}

// The files under the given paths that differ from HEAD or aren't tracked. `git status --porcelain` lines are two status
// columns, a space and the path; the first column can be a space, so the output isn't trimmed.
export function dirtyFiles(paths: readonly string[]): string[] {
  const out = execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: REPO, encoding: 'utf8' })
  return out.split('\n').filter(line => line.length > 3).map(line => line.slice(3))
}

// The files that build the strings Canvas measures and hand them to Canvas. A change there can change a string's V8
// storage without changing its characters, which only Chrome shows (the file comment, "string storage").
const STORAGE_PATHS = ['rebuild/src/measure', 'rebuild/src/engines/blink/shape.ts']
// V8 copies a shorter Latin-1-only substring into a one-byte string, so only longer ones keep their parent's storage
// (SlicedString::kMinLength, v8 string.h:1181).
const STORAGE_SENSITIVE_UNITS = 13

// Which of STORAGE_PATHS differ between a commit and the working tree; every path when the commit isn't known here.
function storageFilesChangedSince(commit: string): string[] {
  try {
    const changed = git('diff', '--name-only', commit, '--', ...STORAGE_PATHS).split('\n').filter(line => line !== '')
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...STORAGE_PATHS).split('\n').filter(line => line !== '')
    return [...new Set([...changed, ...untracked])].sort()
  } catch {
    return [...STORAGE_PATHS]
  }
}

// Where a command keeps its shards' results while it runs, and where `check` writes its report by default: in the working
// tree, never in the replay folder, which worktrees share through .artifacts.
const checkDir = (browser: TierBrowser, config: Config): string => join(REPO, 'rebuild/tests/.check', `${browser}-${config}`)

// What a prediction depends on in the working tree: the library, the predictors with their font facts, and the ports.
const LIBRARY_PATHS = ['rebuild/src', 'rebuild/lab/predictor.ts', 'rebuild/lab/predictor-core.ts', 'rebuild/lab/baselines/no-facts-predictor.ts', 'rebuild/lab/font-facts.ts', 'rebuild/lab/font-facts.json', 'rebuild/lab/observe', 'rebuild/lab/port-measure.ts']
function dirtyLibraryFiles(): string[] {
  return dirtyFiles(LIBRARY_PATHS)
}

// The first field that differs between two JSON values, in key order, with both values cut short.
export function firstDifference(before: unknown, after: unknown, path = ''): { path: string; before: string; after: string } | null {
  if (before === after) return null
  const show = (value: unknown): string => {
    const text = value === undefined ? 'absent' : JSON.stringify(value)
    return text.length > 160 ? `${text.slice(0, 157)}...` : text
  }
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null || Array.isArray(before) !== Array.isArray(after)) return { path, before: show(before), after: show(after) }
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      const found = firstDifference(before[i], after[i], `${path}[${i}]`)
      if (found !== null) return found
    }
    return before.length === after.length ? null : { path: `${path}.length`, before: String(before.length), after: String(after.length) }
  }
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDifference(a[key], b[key], path === '' ? key : `${path}.${key}`)
    if (found !== null) return found
  }
  return null
}

// A field path without its indices, for grouping: layout.lines[].geometry.width.
const fieldOf = (path: string): string => path.replace(/\[\d+\]/g, '[]')

// ---- One case ----

type Predictor = {
  predict: (c: Case, env: { browser: BrowserKind; build: string; languages: ProcessLanguages['given'] | null }) => LayoutPrediction | LinesPrediction | { error: string }
  limits?: (prediction: LayoutPrediction) => PainterLimits
}

function recordedLayout(layout: ParagraphLayout): RecordedLayout {
  const { measure: _measure, ...rest } = layout
  return rest as RecordedLayout
}

function observe(prediction: LayoutPrediction): ExpectedObservation {
  const layout = prediction.layout
  const measure = createPortMeasure()
  switch (layout.engine) {
    case 'blink': return observeBlink(prediction.paragraph, layout, measure)
    case 'webkit': return observeWebKit(prediction.paragraph, layout, measure)
    case 'gecko': return observeGecko(prediction.paragraph, layout, measure)
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function askedOf(answeredBy: readonly number[], phase: [number, number]): Asked {
  const out: number[] = []
  let all = answeredBy.length === phase[1] - phase[0]
  for (let i = 0; i < answeredBy.length; i++) {
    out.push(answeredBy[i]! - phase[0])
    if (out[i] !== i) all = false
  }
  return all ? 'all' : out
}

export type Replayed = { kind: 'done'; value: ReferenceCase; counts: AskCounts } | { kind: 'new-question'; phase: 'predict' | 'observe'; question: string }

// The library's full prediction of one case from its recorded answers, as page.ts would have recorded it. With `sites`,
// the predict phase's questions are counted under their call sites.
export function replayCase(input: InputCase, predictor: Predictor, sites: SiteTally | null = null): Replayed {
  let replay = installReplay(input.record, input.env, 'predict', sites)
  let hook: LayoutPrediction | LinesPrediction | { error: string }
  try {
    hook = predictor.predict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
  } catch (error) {
    if (error instanceof NewQuestion) return { kind: 'new-question', phase: 'predict', question: error.message }
    hook = { error: message(error) }
  } finally {
    replay.restore()
  }
  const predicted = replay
  if ('error' in hook) return { kind: 'done', value: { id: input.id, prediction: { error: hook.error }, questions: null }, counts: { predict: { asked: predicted.asked, distinct: predicted.distinct }, observe: { asked: 0, distinct: 0 } } }
  if (!('layout' in hook)) throw new Error(`The predictor returned line ranges alone for ${input.id}: the replay compares engine layouts`)
  replay = installReplay(input.record, input.env, 'observe')
  let observation: ExpectedObservation | { error: string }
  try {
    observation = observe(hook)
  } catch (error) {
    if (error instanceof NewQuestion) return { kind: 'new-question', phase: 'observe', question: error.message }
    observation = { error: message(error) }
  } finally {
    replay.restore()
  }
  const questions: Questions = { predict: askedOf(predicted.answeredBy, input.record.phases.predict), observe: askedOf(replay.answeredBy, input.record.phases.observe), contexts: predicted.contexts }
  let painterLimits: PainterLimits | { error: string } | null = null
  if (predictor.limits !== undefined) {
    try {
      painterLimits = predictor.limits(hook)
    } catch (error) {
      painterLimits = { error: message(error) }
    }
  }
  return {
    kind: 'done', value: { id: input.id, prediction: { layout: recordedLayout(hook.layout), observation, painterLimits }, questions },
    counts: { predict: { asked: predicted.asked, distinct: predicted.distinct }, observe: { asked: replay.asked, distinct: replay.distinct } },
  }
}

// What the browser's own run recorded for the case, in the reference's shape.
function browserCase(row: LabRow): ReferenceCase {
  const prediction = row.prediction
  if ('error' in prediction) return { id: row.id, prediction: { error: prediction.error }, questions: null }
  if (!('layout' in prediction)) throw new Error(`Row ${row.id} holds line ranges alone: the replay compares engine layouts`)
  // The browser asked exactly the recorded calls; the row counts the contexts the prediction made.
  return { id: row.id, prediction: { layout: prediction.layout, observation: prediction.observation, painterLimits: prediction.painterLimits ?? null }, questions: { predict: 'all', observe: 'all', contexts: prediction.measure.contexts } }
}

// ---- Arguments ----

// Filled from the command line when this file is run; importing it (the tests do) parses nothing.
const options = new Map<string, string>()
const flags = new Set<string>()
function parseArguments(rest: readonly string[]): void {
  for (const raw of rest) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    if (match[2] === undefined) flags.add(match[1]!)
    else options.set(match[1]!, match[2])
  }
}

function replayDir(): { browser: TierBrowser; config: Config; dir: string } {
  const browser = options.get('browser') as TierBrowser | undefined
  if (browser === undefined || !TIER_BROWSERS.includes(browser)) fail('--browser must be chrome, firefox or webkit-host')
  const config = (options.get('config') ?? 'no-facts') as Config
  if (!CONFIGS.includes(config)) fail('--config must be no-facts or facts')
  return { browser, config, dir: resolve(options.get('dir') ?? join(REPO, `.artifacts/tests/reference/${browser}-${config}`)) }
}

function readInputs(dir: string): InputsManifest {
  const path = join(dir, 'inputs/manifest.json')
  if (!existsSync(path)) fail(`${relative(REPO, dir)} holds no inputs; record the sets (browser-sets.ts --record) and pack them`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as InputsManifest
  if (manifest.format !== INPUTS_FORMAT) fail(`${path}: format ${JSON.stringify(manifest.format)}`)
  return manifest
}

async function pool<T>(items: readonly T[], width: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(width, items.length); w++) workers.push((async () => { while (next < items.length) { const index = next++; await work(items[index]!, index) } })())
  await Promise.all(workers)
}

const jobsWidth = (): number => Math.max(1, Number(options.get('jobs') ?? Math.max(1, cpus().length - 2)))

// Runs this file as a child with a hidden command; resolves with its exit code.
async function child(args: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', import.meta.path, ...args], { cwd: REPO, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
  return await proc.exited
}

// ---- pack ----

// One recorded part: rows and records in step, into shards. Hidden command `pack-part`.
async function packPart(): Promise<void> {
  const rowsPath = options.get('rows')!
  const measurementsPath = options.get('measurements')!
  const outPrefix = options.get('out-prefix')!
  const browserPrefix = options.get('browser-prefix')!
  const records = readMeasurements(measurementsPath)
  const shards: Shard[] = []
  const browserShards: Array<{ file: string; cases: number; sha256: string }> = []
  const logDisagrees: string[] = []
  const storageSensitive: string[] = []
  let inputs: string[] = []
  let browserLines: string[] = []
  let weight = 0
  let calls = 0
  const flush = (): void => {
    if (inputs.length === 0) return
    const name = `${String(shards.length).padStart(3, '0')}.ndjson.zst`
    shards.push({ file: `${outPrefix}-${name}`, cases: inputs.length, calls, ...writeShard(`${outPrefix}-${name}`, inputs) })
    browserShards.push({ file: `${browserPrefix}-${name}`, cases: browserLines.length, ...writeShard(`${browserPrefix}-${name}`, browserLines) })
    inputs = []
    browserLines = []
    weight = 0
    calls = 0
  }
  for await (const line of readLines(rowsPath)) {
    const row = JSON.parse(line) as LabRow
    const next = await records.next()
    if (next.done === true) throw new Error(`${measurementsPath} ends before row ${row.id}`)
    const record = next.value
    if (record.id !== row.id) throw new Error(`Record ${record.id} doesn't belong to row ${row.id}: the files come from different runs`)
    if (row.build === undefined) throw new Error(`Row ${row.id} records no build`)
    if (record.library !== null && !record.library.agrees) logDisagrees.push(row.id)
    if (row.browser === 'chrome') {
      for (let i = record.phases.predict[0]; i < record.phases.predict[1]; i++) {
        const asked = record.calls[i]![1]
        if (asked.length < STORAGE_SENSITIVE_UNITS || !/^[\x00-\xff]*$/.test(asked)) continue
        storageSensitive.push(row.id)
        break
      }
    }
    // The replay reads the predict and observe phases; the lab's own font probe and the painter's calls stay out.
    const predict = record.calls.slice(record.phases.predict[0], record.phases.predict[1])
    const observed = record.calls.slice(record.phases.observe[0], record.phases.observe[1])
    const trimmed: CaseMeasurements = {
      id: record.id, contexts: record.contexts, calls: [...predict, ...observed], segmentations: record.segmentations, library: record.library,
      phases: { native: [0, 0], predict: [0, predict.length], observe: [predict.length, predict.length + observed.length], paint: [predict.length + observed.length, predict.length + observed.length] },
    }
    const input: InputCase = { id: row.id, family: row.family, case: row.case, browser: row.browser, env: { userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, pageLang: row.env.pageLang }, build: row.build, languages: row.languages?.given ?? null, record: trimmed }
    inputs.push(JSON.stringify(input))
    browserLines.push(JSON.stringify(browserCase(row)))
    weight += trimmed.calls.length + CASE_WEIGHT
    calls += trimmed.calls.length
    if (weight >= SHARD_CALLS) flush()
  }
  flush()
  await records.return(undefined)
  writeFileSync(options.get('result')!, JSON.stringify({ shards, browserShards, logDisagrees, storageSensitive }))
}

async function pack(): Promise<number> {
  const { browser, config, dir } = replayDir()
  const runsDir = resolve(options.get('runs') ?? fail('--runs=<browser-sets out dir> is required'))
  const run = JSON.parse(readFileSync(join(runsDir, 'sets-run.json'), 'utf8')) as SetsRun
  if (run.browser !== browser || run.config !== config) fail(`${relative(REPO, runsDir)} ran ${run.browser} ${run.config}, not ${browser} ${config}`)
  if (run.sets.some(set => set.subset)) fail('A run of --ids-file subsets can\'t be packed: the inputs hold whole sets')
  if (existsSync(join(dir, 'inputs/manifest.json')) && !flags.has('force')) fail(`${relative(REPO, dir)}/inputs exists; --force replaces it (and makes the frozen reference stale: freeze again)`)
  const started = Date.now()
  for (const name of ['inputs', 'browser', 'ledger']) if (existsSync(join(dir, name))) execFileSync('trash', [join(dir, name)])
  mkdirSync(join(dir, 'inputs'), { recursive: true })
  // The run's ledger goes beside the inputs: the statuses of the recording the inputs come from.
  if (existsSync(join(runsDir, 'ledger/ledger.json'))) {
    mkdirSync(join(dir, 'ledger'))
    for (const name of ['ledger.json', 'entries.ndjson']) writeFileSync(join(dir, 'ledger', name), readFileSync(join(runsDir, 'ledger', name)))
  }
  type Part = { set: string; part: number; rows: string; measurements: string; record: { bundleSha256: string | null } }
  const parts: Part[] = []
  for (const set of run.sets) for (const part of set.parts) {
    const folder = resolve(REPO, part.forward)
    const measurements = join(folder, `${browser}-measurements.ndjson.zst`)
    if (!existsSync(measurements)) fail(`${part.forward} holds no measurement record: run browser-sets.ts with --record`)
    parts.push({ set: set.name, part: part.part, rows: join(folder, `${browser}-rows.ndjson`), measurements, record: JSON.parse(readFileSync(join(folder, `${browser}-run.json`), 'utf8')) as { bundleSha256: string | null } })
  }
  const results: Array<{ shards: Shard[]; browserShards: Array<{ file: string; cases: number; sha256: string }>; logDisagrees: string[]; storageSensitive: string[] }> = []
  const failures: string[] = []
  await pool(parts, jobsWidth(), async (part, index) => {
    const result = join(dir, 'inputs', `.part-${index}.json`)
    const code = await child(['pack-part', `--rows=${part.rows}`, `--measurements=${part.measurements}`, `--out-prefix=${join(dir, 'inputs', part.set, `part${part.part}`)}`, `--browser-prefix=${join(dir, 'browser', part.set, `part${part.part}`)}`, `--result=${result}`])
    if (code !== 0) failures.push(`${part.set} part ${part.part}`)
    else results[index] = JSON.parse(readFileSync(result, 'utf8')) as typeof results[number]
  })
  if (failures.length > 0) fail(`packing failed for ${failures.join(', ')}`)
  for (let i = 0; i < parts.length; i++) execFileSync('trash', [join(dir, 'inputs', `.part-${i}.json`)])
  const manifest: InputsManifest = {
    format: INPUTS_FORMAT, browser, config, predictor: PREDICTORS[config], build: run.build, bundles: [...new Set(parts.map(part => part.record.bundleSha256 ?? 'not recorded'))].sort(),
    recordedFrom: relative(REPO, runsDir), sets: {}, cases: 0, calls: 0, logDisagrees: [],
  }
  const browserSets: ReferenceManifest['sets'] = {}
  const storageSensitive: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const set = (manifest.sets[part.set] ??= { protocol: run.sets.find(value => value.name === part.set)!.protocol, shards: [] })
    for (const shard of results[i]!.shards) {
      set.shards.push({ ...shard, file: relative(join(dir, 'inputs'), shard.file) })
      manifest.cases += shard.cases
      manifest.calls += shard.calls
    }
    for (const shard of results[i]!.browserShards) (browserSets[part.set] ??= []).push({ ...shard, file: relative(join(dir, 'browser'), shard.file) })
    manifest.logDisagrees.push(...results[i]!.logDisagrees)
    storageSensitive.push(...results[i]!.storageSensitive)
  }
  // Chrome only: the cases `check` sends to tier 2 when the code that builds Canvas strings changed (STORAGE_PATHS).
  writeFileSync(join(dir, 'inputs/storage-sensitive.ids'), [...new Set(storageSensitive)].sort().map(id => `${id}\n`).join(''))
  if (manifest.bundles.length !== 1) fail(`The recorded jobs ran ${manifest.bundles.length} library bundles: record again with one library`)
  writeFileSync(join(dir, 'inputs/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const browserManifest: ReferenceManifest = {
    format: REFERENCE_FORMAT, kind: 'browser', browser, config, inputsSha256: sha256(readFileSync(join(dir, 'inputs/manifest.json'))), commit: git('rev-parse', 'HEAD'), dirty: dirtyLibraryFiles(),
    createdAt: new Date().toISOString(), reason: `the predictions the browser recorded in ${relative(REPO, runsDir)}`, replaced: [], sets: browserSets, cases: manifest.cases, ledger: ledgerHashes(dir),
  }
  writeFileSync(join(dir, 'browser/manifest.json'), `${JSON.stringify(browserManifest, null, 2)}\n`)
  console.log(`[replay] packed ${manifest.cases} cases, ${manifest.calls} recorded calls, ${Object.values(manifest.sets).reduce((sum, set) => sum + set.shards.length, 0)} shards into ${relative(REPO, dir)}/inputs in ${Math.round((Date.now() - started) / 1000)} s; ${manifest.logDisagrees.length} cases where the library's call log and the recorder disagree`)
  // Fidelity: the working tree's replay against the browser's own predictions.
  const report = await compare(dir, manifest, 'browser', selectSets(browser, undefined, undefined).map(set => set.name), null)
  const unfaithful: Unfaithful = { checkedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), dirty: dirtyLibraryFiles(), cases: {} }
  for (const value of report.predictionChanged) unfaithful.cases[`${value.set}/${value.id}`] = `${value.first.path}: ${value.first.before} -> ${value.first.after}`
  for (const value of report.newQuestions) unfaithful.cases[`${value.set}/${value.id}`] = `new question (${value.phase}): ${value.question}`
  for (const value of report.questionsChanged) unfaithful.cases[`${value.set}/${value.id}`] ??= `questions changed (${value.change}: ${value.detail})`
  writeFileSync(join(dir, 'inputs/unfaithful.json'), `${JSON.stringify(unfaithful, null, 2)}\n`)
  console.log(`[replay] fidelity, the working tree's replay against the browser's own predictions: ${report.counts.same} of ${report.counts.cases} cases replay exactly; ${Object.keys(unfaithful.cases).length} unfaithful (${report.counts.predictionChanged} predictions differ, ${report.counts.questionsChanged} ask other questions, ${report.counts.newQuestion} ask new ones); ${Math.round((Date.now() - started) / 1000)} s in all`)
  printByField(report)
  return 0
}

// ---- freeze and check: one shard per child process ----

// How a case's questions differ from the reference's, from the least change to the most (the file comment).
const QUESTION_CHANGES = ['same', 'repeats only', 'dropped only', 'other questions'] as const
export type QuestionsChange = typeof QUESTION_CHANGES[number]

type CaseOutcome =
  | { id: string; family: string; kind: 'prediction'; first: { path: string; before: string; after: string } }
  | { id: string; family: string; kind: 'questions'; change: Exclude<QuestionsChange, 'same'>; detail: string }
  | { id: string; family: string; kind: 'new-question'; phase: 'predict' | 'observe'; question: string }
type SiteRow = SiteCount & { site: string }
type ShardResult = { cases: number; same: number; counts: AskCounts; sites: { sites: SiteRow[]; under: SiteRow[] } | null; outcomes: CaseOutcome[]; emitted: { cases: number; sha256: string } | null }

// One phase's questions against the reference's. Both lists index the phase's recorded calls; a question is the context
// and the string of the call that answered it, so two recorded calls of one string on one context are one question.
export function classifyAsked(calls: readonly RecordedCall[], phase: [number, number], before: Asked, after: Asked): { change: QuestionsChange; detail: string } {
  if (JSON.stringify(before) === JSON.stringify(after)) return { change: 'same', detail: '' }
  const recorded = phase[1] - phase[0]
  // Per recorded call of the phase, its question: the first call of the same context and string.
  const question: number[] = []
  const firstCall = new Map<number, Map<string, number>>()
  for (let i = 0; i < recorded; i++) {
    const call = calls[phase[0] + i]!
    let strings = firstCall.get(call[0])
    if (strings === undefined) {
      strings = new Map()
      firstCall.set(call[0], strings)
    }
    const first = strings.get(call[1])
    if (first === undefined) strings.set(call[1], i)
    question.push(first ?? i)
  }
  // A list's questions in the order of their first occurrence.
  const firsts = (asked: Asked): number[] => {
    const out: number[] = []
    const seen = new Set<number>()
    const length = asked === 'all' ? recorded : asked.length
    for (let k = 0; k < length; k++) {
      const q = question[asked === 'all' ? k : asked[k]!]!
      if (seen.has(q)) continue
      seen.add(q)
      out.push(q)
    }
    return out
  }
  const was = firsts(before)
  const is = firsts(after)
  // The reference's order within each context, as a rank per question.
  const rank = new Map<number, number>()
  for (let k = 0; k < was.length; k++) rank.set(was[k]!, k)
  const lastRank = new Map<number, number>()
  let lastOfAll = -1
  let added = 0
  let reordered = 0
  let turnsMoved = false
  for (let k = 0; k < is.length; k++) {
    const r = rank.get(is[k]!)
    if (r === undefined) {
      added++
      continue
    }
    const context = calls[phase[0] + is[k]!]![0]
    if (r < (lastRank.get(context) ?? -1)) reordered++
    else lastRank.set(context, r)
    if (r < lastOfAll) turnsMoved = true
    else lastOfAll = r
  }
  const dropped = was.length - (is.length - added)
  const lengthOf = (asked: Asked): number => (asked === 'all' ? recorded : asked.length)
  const change: QuestionsChange = added > 0 || reordered > 0 ? 'other questions' : dropped > 0 ? 'dropped only' : 'repeats only'
  const parts = [`${lengthOf(before)} -> ${lengthOf(after)} asked, ${was.length} -> ${is.length} distinct`]
  if (dropped > 0) parts.push(`${dropped} dropped`)
  if (added > 0) parts.push(`${added} recorded questions the reference didn't ask`)
  if (reordered > 0) parts.push(`${reordered} first asked before an earlier question of their context`)
  if (change !== 'other questions' && turnsMoved) parts.push('contexts take turns in another order')
  return { change, detail: parts.join(', ') }
}

// A case's questions against the reference's: the worse of its two phases, and the contexts. Fewer contexts go with
// dropped questions only; any other change of their number is no step's to make.
export function classifyQuestions(record: CaseMeasurements, before: Questions, after: Questions): { change: QuestionsChange; detail: string } {
  const predict = classifyAsked(record.calls, record.phases.predict, before.predict, after.predict)
  const observe = classifyAsked(record.calls, record.phases.observe, before.observe, after.observe)
  let change = QUESTION_CHANGES[Math.max(QUESTION_CHANGES.indexOf(predict.change), QUESTION_CHANGES.indexOf(observe.change))]!
  const parts: string[] = []
  if (predict.change !== 'same') parts.push(predict.detail)
  if (observe.change !== 'same') parts.push(`the observation port: ${observe.detail}`)
  if (before.contexts !== after.contexts) {
    parts.push(`contexts ${before.contexts} -> ${after.contexts}`)
    if (!(change === 'dropped only' && after.contexts < before.contexts)) change = 'other questions'
  }
  return { change, detail: parts.join('; ') }
}

const rowsOf = (counts: Map<string, SiteCount>): SiteRow[] => [...counts].map(([site, value]) => ({ site, ...value }))

// Hidden command `work`: replays one shard, and either writes its reference shard or compares with one.
async function work(): Promise<void> {
  const inputs = readShard<InputCase>(options.get('inputs')!)
  const predictor = await import(resolve(REPO, options.get('predictor')!)) as Predictor
  const reference = options.get('reference') === undefined ? null : readShard<ReferenceCase>(options.get('reference')!)
  if (reference !== null && reference.length !== inputs.length) throw new Error(`${options.get('reference')} holds ${reference.length} cases for ${inputs.length} inputs`)
  const tally = flags.has('sites') ? newSiteTally() : null
  // The stack of a question under the line breaker is deeper than the default ten frames.
  if (tally !== null) Error.stackTraceLimit = 200
  const result: ShardResult = { cases: inputs.length, same: 0, counts: { predict: { asked: 0, distinct: 0 }, observe: { asked: 0, distinct: 0 } }, sites: null, outcomes: [], emitted: null }
  const emit = options.get('emit')
  const lines: string[] = []
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!
    const replayed = replayCase(input, predictor, tally)
    if (replayed.kind === 'new-question') {
      result.outcomes.push({ id: input.id, family: input.family, kind: 'new-question', phase: replayed.phase, question: replayed.question })
      // A frozen reference keeps the case's place; nothing can be compared with it.
      if (emit !== undefined) lines.push(JSON.stringify({ id: input.id, prediction: { error: `not replayable: ${replayed.question}` }, questions: null } satisfies ReferenceCase))
      continue
    }
    result.counts.predict.asked += replayed.counts.predict.asked
    result.counts.predict.distinct += replayed.counts.predict.distinct
    result.counts.observe.asked += replayed.counts.observe.asked
    result.counts.observe.distinct += replayed.counts.observe.distinct
    if (emit !== undefined) lines.push(JSON.stringify(replayed.value))
    if (reference === null) continue
    const expected = reference[i]!
    if (expected.id !== input.id) throw new Error(`${options.get('reference')}: case ${i} is ${expected.id}, the inputs hold ${input.id}`)
    const first = JSON.stringify(expected.prediction) === JSON.stringify(replayed.value.prediction) ? null : firstDifference(expected.prediction, replayed.value.prediction, '')
    if (first !== null) {
      result.outcomes.push({ id: input.id, family: input.family, kind: 'prediction', first })
      continue
    }
    const before = expected.questions
    const after = replayed.value.questions
    if (before === null && after === null) {
      result.same++
      continue
    }
    if (before === null || after === null) {
      result.outcomes.push({ id: input.id, family: input.family, kind: 'questions', change: 'other questions', detail: 'questions absent on one side' })
      continue
    }
    const questions = classifyQuestions(input.record, before, after)
    if (questions.change === 'same') result.same++
    else result.outcomes.push({ id: input.id, family: input.family, kind: 'questions', change: questions.change, detail: questions.detail })
  }
  if (tally !== null) result.sites = { sites: rowsOf(tally.sites), under: rowsOf(tally.under) }
  if (emit !== undefined) result.emitted = { cases: lines.length, ...writeShard(emit, lines) }
  writeFileSync(options.get('result')!, JSON.stringify(result))
}

type ChangedCase = { set: string; id: string; family: string }
type CheckReport = {
  format: 'pretext-replay-check/2'
  browser: TierBrowser
  config: Config
  against: { kind: string; commit: string; createdAt: string; reason: string }
  library: { commit: string; dirty: string[] }
  sets: string[]
  counts: { cases: number; same: number; predictionChanged: number; questionsChanged: number; repeatsOnly: number; droppedOnly: number; otherQuestions: number; newQuestion: number; unfaithful: number }
  // Over the cases that replayed: questions asked and distinct ones, per phase.
  asked: AskCounts
  predictionChanged: Array<ChangedCase & { first: { path: string; before: string; after: string }; ledger: (LedgerEntry['status'] & { exact: LedgerEntry['exact'] }) | null; unfaithful: boolean }>
  questionsChanged: Array<ChangedCase & { change: Exclude<QuestionsChange, 'same'>; detail: string }>
  newQuestions: Array<ChangedCase & { phase: string; question: string }>
  // Per first differing field: the changed cases by family.
  byField: Record<string, { cases: number; families: Record<string, number> }>
  // Changed predictions by what the ledger says of the case's lineCount, breaks and widths, and of its exact values.
  byLedgerStatus: Record<string, number> | null
  // Set when files that build Canvas strings differ from the reference's commit: Chrome's storage-sensitive cases are in
  // `needsBrowser` by rule.
  storage?: { changedFiles: string[]; cases: number }
  // --sites: the predict phase's asks and repeats by call site and by library function on the stack, most repeats first.
  sites?: { sites: SiteRow[]; under: SiteRow[] }
  needsBrowser: string[]
}

function readReference(dir: string, against: 'reference' | 'browser', inputsSha256: string): ReferenceManifest {
  const path = join(dir, against, 'manifest.json')
  if (!existsSync(path)) fail(`${relative(REPO, join(dir, against))} holds no reference${against === 'reference' ? '; freeze one' : ''}`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ReferenceManifest
  if (!REFERENCE_FORMATS.includes(manifest.format)) fail(`${path}: format ${JSON.stringify(manifest.format)}`)
  if (against === 'reference' && manifest.inputsSha256 !== inputsSha256) fail(`${relative(REPO, path)} was frozen from other inputs than ${relative(REPO, dir)}/inputs holds now: freeze again (--force --reason=...)`)
  return manifest
}

// Replays the chosen sets and compares with a reference; with `emitTo`, writes the replay's output there as well.
async function compare(dir: string, inputs: InputsManifest, against: 'reference' | 'browser' | null, sets: readonly string[], emitTo: string | null): Promise<CheckReport & { emitted: ReferenceManifest['sets'] }> {
  const inputsSha256 = sha256(readFileSync(join(dir, 'inputs/manifest.json')))
  const reference = against === null ? null : readReference(dir, against, inputsSha256)
  type Job = { set: string; index: number; shard: Shard; reference: string | null; emit: string | null; result: string }
  const jobs: Job[] = []
  const scratch = join(checkDir(inputs.browser, inputs.config), `work-${process.pid}`)
  mkdirSync(scratch, { recursive: true })
  for (const name of sets) {
    const set = inputs.sets[name]
    if (set === undefined) continue
    for (let k = 0; k < set.shards.length; k++) {
      const shard = set.shards[k]!
      let referencePath: string | null = null
      if (reference !== null) {
        const entry = reference.sets[name]?.[k]
        if (entry === undefined || entry.cases !== shard.cases) fail(`${against}/manifest.json doesn't hold shard ${k} of ${name} as the inputs do`)
        referencePath = join(dir, against!, entry.file)
        if (sha256(readFileSync(referencePath)) !== entry.sha256) fail(`${relative(REPO, referencePath)} isn't the file its manifest names (sha256 differs)`)
      }
      if (sha256(readFileSync(join(dir, 'inputs', shard.file))) !== shard.sha256) fail(`inputs/${shard.file} isn't the file its manifest names (sha256 differs)`)
      jobs.push({ set: name, index: k, shard, reference: referencePath, emit: emitTo === null ? null : join(emitTo, shard.file), result: join(scratch, `${jobs.length}.json`) })
    }
  }
  // Largest first, so the last shards to finish are small.
  const order = jobs.map((_, i) => i).sort((a, b) => jobs[b]!.shard.calls - jobs[a]!.shard.calls)
  const failures: string[] = []
  await pool(order, jobsWidth(), async i => {
    const job = jobs[i]!
    const code = await child(['work', `--inputs=${join(dir, 'inputs', job.shard.file)}`, `--predictor=${inputs.predictor}`, `--result=${job.result}`, ...(job.reference === null ? [] : [`--reference=${job.reference}`]), ...(job.emit === null ? [] : [`--emit=${job.emit}`]), ...(flags.has('sites') ? ['--sites'] : [])])
    if (code !== 0) failures.push(`${job.set} shard ${job.index}`)
  })
  if (failures.length > 0) fail(`the replay failed on ${failures.sort().join(', ')}`)
  // The ledger beside the reference says what each changed case's statuses were. Against a frozen reference it must be
  // the ledger the reference pinned: another one describes another recording.
  let ledger: Map<string, LedgerEntry> | null = null
  if (existsSync(join(dir, 'ledger/ledger.json'))) {
    if (reference !== null && reference.kind === 'replay' && JSON.stringify(reference.ledger) !== JSON.stringify(ledgerHashes(dir))) {
      console.error(`[replay] ${relative(REPO, join(dir, 'ledger'))} isn't the ledger the reference pinned (its hashes differ): changed cases are listed without their statuses. Pack and freeze again to pin it`)
    } else {
      ledger = new Map()
      for (const entry of readLedger(join(dir, 'ledger')).entries) ledger.set(`${entry.set}/${entry.id}`, entry)
    }
  }
  const unfaithfulPath = join(dir, 'inputs/unfaithful.json')
  const unfaithful = against === 'browser' || !existsSync(unfaithfulPath) ? {} : (JSON.parse(readFileSync(unfaithfulPath, 'utf8')) as Unfaithful).cases
  const report: CheckReport & { emitted: ReferenceManifest['sets'] } = {
    format: 'pretext-replay-check/2', browser: inputs.browser, config: inputs.config,
    against: reference === null ? { kind: 'none', commit: '', createdAt: '', reason: '' } : { kind: reference.kind, commit: reference.commit, createdAt: reference.createdAt, reason: reference.reason },
    library: { commit: git('rev-parse', 'HEAD'), dirty: dirtyLibraryFiles() }, sets: [...sets].filter(name => inputs.sets[name] !== undefined),
    counts: { cases: 0, same: 0, predictionChanged: 0, questionsChanged: 0, repeatsOnly: 0, droppedOnly: 0, otherQuestions: 0, newQuestion: 0, unfaithful: 0 },
    asked: { predict: { asked: 0, distinct: 0 }, observe: { asked: 0, distinct: 0 } },
    predictionChanged: [], questionsChanged: [], newQuestions: [], byField: {}, byLedgerStatus: ledger === null ? null : {}, needsBrowser: [], emitted: {},
  }
  const needs = new Set<string>()
  const sites = new Map<string, SiteCount>()
  const under = new Map<string, SiteCount>()
  const addRows = (into: Map<string, SiteCount>, rows: readonly SiteRow[]): void => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      const sum = into.get(row.site)
      if (sum === undefined) into.set(row.site, { asks: row.asks, repeats: row.repeats, repeatChars: row.repeatChars })
      else {
        sum.asks += row.asks
        sum.repeats += row.repeats
        sum.repeatChars += row.repeatChars
      }
    }
  }
  for (const job of jobs) {
    const result = JSON.parse(readFileSync(job.result, 'utf8')) as ShardResult
    report.counts.cases += result.cases
    report.counts.same += result.same
    report.asked.predict.asked += result.counts.predict.asked
    report.asked.predict.distinct += result.counts.predict.distinct
    report.asked.observe.asked += result.counts.observe.asked
    report.asked.observe.distinct += result.counts.observe.distinct
    if (result.sites !== null) {
      addRows(sites, result.sites.sites)
      addRows(under, result.sites.under)
    }
    if (result.emitted !== null) (report.emitted[job.set] ??= []).push({ file: job.shard.file, ...result.emitted })
    for (const outcome of result.outcomes) {
      const where = { set: job.set, id: outcome.id, family: outcome.family }
      switch (outcome.kind) {
        case 'prediction': {
          const entry = ledger?.get(`${job.set}/${outcome.id}`) ?? null
          report.predictionChanged.push({ ...where, first: outcome.first, ledger: entry === null ? null : { ...entry.status, exact: entry.exact }, unfaithful: `${job.set}/${outcome.id}` in unfaithful })
          const field = (report.byField[fieldOf(outcome.first.path)] ??= { cases: 0, families: {} })
          field.cases++
          field.families[outcome.family] = (field.families[outcome.family] ?? 0) + 1
          if (report.byLedgerStatus !== null) {
            const key = entry === null ? 'not in the ledger' : `lineCount ${entry.status.lineCount} | breaks ${entry.status.breaks} | widths ${entry.status.widths} | ${entry.exact}`
            report.byLedgerStatus[key] = (report.byLedgerStatus[key] ?? 0) + 1
          }
          break
        }
        case 'questions':
          report.questionsChanged.push({ ...where, change: outcome.change, detail: outcome.detail })
          switch (outcome.change) {
            case 'repeats only': report.counts.repeatsOnly++; break
            case 'dropped only': report.counts.droppedOnly++; break
            case 'other questions': report.counts.otherQuestions++; break
          }
          needs.add(outcome.id)
          break
        case 'new-question':
          report.newQuestions.push({ ...where, phase: outcome.phase, question: outcome.question })
          needs.add(outcome.id)
          break
      }
    }
  }
  // The replay can't stand in for the browser on an unfaithful case, whatever it says of it.
  for (const key of Object.keys(unfaithful)) {
    const [set, id] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)]
    if (!report.sets.includes(set)) continue
    report.counts.unfaithful++
    needs.add(id)
  }
  // String storage, by rule: when the code that builds Canvas strings differs from the reference's commit, Chrome's
  // storage-sensitive cases go to tier 2 although their replay can't differ.
  const sensitivePath = join(dir, 'inputs/storage-sensitive.ids')
  if (against === 'reference' && reference !== null && inputs.browser === 'chrome' && existsSync(sensitivePath)) {
    const changed = storageFilesChangedSince(reference.commit)
    if (changed.length > 0) {
      const ids = readFileSync(sensitivePath, 'utf8').split('\n').filter(id => id !== '')
      for (const id of ids) needs.add(id)
      report.storage = { changedFiles: changed, cases: ids.length }
    }
  }
  report.counts.predictionChanged = report.predictionChanged.length
  report.counts.questionsChanged = report.questionsChanged.length
  report.counts.newQuestion = report.newQuestions.length
  report.needsBrowser = [...needs].sort()
  if (flags.has('sites')) {
    const sorted = (counts: Map<string, SiteCount>): SiteRow[] => rowsOf(counts).sort((a, b) => b.repeats - a.repeats || b.asks - a.asks || (a.site < b.site ? -1 : 1))
    report.sites = { sites: sorted(sites), under: sorted(under) }
  }
  execFileSync('trash', [scratch])
  return report
}

// 0: every case the same. 1: a prediction changed. 4: none did, but a case asks a new question or other questions, which
// no step accepts. 3: none did, and every case whose questions changed is repeats only or dropped only, or the string
// storage rule sends cases to tier 2.
function exitCode(report: CheckReport): number {
  const c = report.counts
  if (c.predictionChanged > 0) return 1
  if (c.otherQuestions + c.newQuestion > 0) return 4
  return c.questionsChanged > 0 || report.storage !== undefined ? 3 : 0
}

function printByField(report: CheckReport): void {
  const fields = Object.entries(report.byField).sort((a, b) => b[1].cases - a[1].cases || (a[0] < b[0] ? -1 : 1))
  for (const [field, value] of fields.slice(0, 25)) {
    const families = Object.entries(value.families).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    console.log(`  ${String(value.cases).padStart(6)}  ${field || '(the whole prediction)'}   ${families.slice(0, 4).map(([family, n]) => `${family} ${n}`).join(', ')}${families.length > 4 ? `, +${families.length - 4} families` : ''}`)
  }
  if (fields.length > 25) console.log(`          … ${fields.length - 25} more fields in the report`)
}

async function freeze(): Promise<number> {
  const { browser, config, dir } = replayDir()
  const inputs = readInputs(dir)
  const manifestPath = join(dir, 'reference/manifest.json')
  const before = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as ReferenceManifest : null
  const reason = options.get('reason') ?? ''
  if (before !== null && (!flags.has('force') || reason === '')) fail(`${relative(REPO, manifestPath)} holds the reference of commit ${before.commit.slice(0, 12)} (${before.createdAt}). A reference is never overwritten silently: pass --force and --reason=<why the predictions may change>`)
  const dirty = dirtyLibraryFiles()
  if (dirty.length > 0 && !flags.has('allow-dirty')) fail(`A reference is frozen for a commit, and these files differ from HEAD: ${dirty.join(', ')}. Commit them, or pass --allow-dirty (the manifest lists them)`)
  // Questions only: the new reference must hold the replaced one's predictions byte for byte.
  const questionsOnly = flags.has('questions-only')
  if (questionsOnly && before === null) fail('--questions-only freezes the questions of an existing reference again; there is none')
  const started = Date.now()
  const staging = join(dir, '.reference-new')
  if (existsSync(staging)) execFileSync('trash', [staging])
  const report = await compare(dir, inputs, questionsOnly ? 'reference' : null, Object.keys(inputs.sets), staging)
  if (questionsOnly && report.counts.predictionChanged + report.counts.newQuestion > 0) {
    execFileSync('trash', [staging])
    console.error(`[replay] not frozen: ${report.counts.predictionChanged} predictions differ from the reference of ${before!.commit.slice(0, 12)} and ${report.counts.newQuestion} cases ask a question the record lacks. --questions-only never freezes a prediction again; \`check\` names the cases`)
    return 1
  }
  const manifest: ReferenceManifest = {
    format: REFERENCE_FORMAT, kind: 'replay', browser, config, inputsSha256: sha256(readFileSync(join(dir, 'inputs/manifest.json'))), commit: git('rev-parse', 'HEAD'), dirty,
    createdAt: new Date().toISOString(), reason: reason === '' ? 'first reference' : reason,
    replaced: before === null ? [] : [...before.replaced, { commit: before.commit, createdAt: before.createdAt, reason: before.reason, cases: before.cases }],
    ...(questionsOnly ? { predictionsFrom: before!.predictionsFrom ?? before!.commit } : {}),
    sets: report.emitted, cases: report.counts.cases, ledger: ledgerHashes(dir),
  }
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (before !== null) execFileSync('trash', [join(dir, 'reference')])
  execFileSync('mv', [staging, join(dir, 'reference')])
  // The repository pins the reference of the default folder only; a trial folder (--dir) pins nothing.
  const pinned = join(REPO, `rebuild/tests/reference/${browser}-${config}.json`)
  const pins = options.get('dir') === undefined
  if (pins) {
    mkdirSync(dirname(pinned), { recursive: true })
    writeFileSync(pinned, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  console.log(`[replay] froze ${manifest.cases} cases at ${manifest.commit.slice(0, 12)}${dirty.length === 0 ? '' : ' (dirty)'} into ${relative(REPO, join(dir, 'reference'))} in ${Math.round((Date.now() - started) / 1000)} s; ${report.counts.newQuestion} cases ask a question the record lacks${questionsOnly ? `; the questions of ${report.counts.questionsChanged} cases changed (${report.counts.repeatsOnly} repeats only, ${report.counts.droppedOnly} dropped only, ${report.counts.otherQuestions} other questions) and every prediction is the one frozen at ${manifest.predictionsFrom!.slice(0, 12)}` : ''}${pins ? `; pinned in ${relative(REPO, pinned)}` : ''}`)
  return 0
}

const ratio = (counts: { asked: number; distinct: number }): string => (counts.distinct === 0 ? 'none' : (counts.asked / counts.distinct).toFixed(2))

async function check(): Promise<number> {
  const { browser, config, dir } = replayDir()
  const inputs = readInputs(dir)
  const against = (options.get('against') ?? 'reference') as 'reference' | 'browser'
  if (against !== 'reference' && against !== 'browser') fail('--against must be reference or browser')
  const sets = selectSets(browser, options.get('sets'), options.get('groups')).map(set => set.name)
  const started = Date.now()
  const { emitted: _emitted, ...report } = await compare(dir, inputs, against, sets, null)
  const out = resolve(options.get('out') ?? join(checkDir(browser, config), 'check-report.json'))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(out.replace(/\.json$/, '') + '.needs-browser.ids', report.needsBrowser.join('\n') + (report.needsBrowser.length === 0 ? '' : '\n'))
  const c = report.counts
  console.log(`[replay] ${browser} ${inputs.config}: ${c.cases} cases in ${report.sets.length} sets against the ${report.against.kind} reference of ${report.against.commit.slice(0, 12)}: ${c.same} the same, ${c.predictionChanged} predictions changed, ${c.questionsChanged} ask other questions with the same prediction (${c.repeatsOnly} repeats only, ${c.droppedOnly} dropped only, ${c.otherQuestions} other questions), ${c.newQuestion} ask a question the record lacks; ${c.unfaithful} unfaithful cases always need the browser (${Math.round((Date.now() - started) / 100) / 10} s)`)
  console.log(`  Canvas questions of the cases that replayed: ${report.asked.predict.asked} asked, ${report.asked.predict.distinct} distinct, ask ratio ${ratio(report.asked.predict)}; the observation port: ${report.asked.observe.asked} asked, ${report.asked.observe.distinct} distinct`)
  if (c.predictionChanged > 0) {
    console.log('  changed predictions by first differing field:')
    printByField(report)
    if (report.byLedgerStatus !== null) {
      console.log('  changed predictions by the ledger\'s status of the case:')
      for (const [status, n] of Object.entries(report.byLedgerStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${status}`)
    }
    for (const value of report.predictionChanged.slice(0, 8)) console.log(`    ${value.set} ${value.id} ${value.family}: ${value.first.path}: ${value.first.before} -> ${value.first.after}`)
  }
  if (report.storage !== undefined) console.log(`  string storage: ${report.storage.changedFiles.join(', ')} differ${report.storage.changedFiles.length === 1 ? 's' : ''} from the reference's commit and build${report.storage.changedFiles.length === 1 ? 's' : ''} the strings Canvas measures; Chrome stores a string in 8 or 16 bits by how it was built, which a replay can't see, so the ${report.storage.cases} storage-sensitive cases go to tier 2`)
  for (const value of report.newQuestions.slice(0, 5)) console.log(`    new question, ${value.set} ${value.id}: ${value.question.slice(0, 200)}`)
  // The changes no step accepts first.
  const shown = [...report.questionsChanged.filter(value => value.change === 'other questions'), ...report.questionsChanged.filter(value => value.change !== 'other questions')]
  for (const value of shown.slice(0, 5)) console.log(`    ${value.change}, ${value.set} ${value.id}: ${value.detail}`)
  if (report.sites !== undefined) {
    console.log('  asks and repeats by call site (innermost library frames first), most repeats first:')
    for (const row of report.sites.sites.slice(0, 12)) console.log(`  ${String(row.asks).padStart(9)} asks ${String(row.repeats).padStart(9)} repeats  ${row.site}`)
    if (report.sites.sites.length > 12) console.log(`            … ${report.sites.sites.length - 12} more sites, and the counts under each library function, in the report`)
  }
  console.log(`  report: ${relative(REPO, out)}; cases for tier 2: ${relative(REPO, out.replace(/\.json$/, '') + '.needs-browser.ids')} (${report.needsBrowser.length})`)
  return exitCode(report)
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  parseArguments(rest)
  try {
    switch (command) {
      case 'pack': process.exit(await pack())
      case 'pack-part': await packPart(); process.exit(0)
      case 'freeze': process.exit(await freeze())
      case 'check': {
        // Every browser and configuration asked for that has a frozen reference; one named outright must have one.
        const browsers = options.get('browser') === 'all' ? [...TIER_BROWSERS] : [options.get('browser')]
        const configs = options.get('config') === 'all' ? [...CONFIGS] : [options.get('config')]
        const several = browsers.length > 1 || configs.length > 1
        if (several && (options.has('dir') || options.has('out'))) fail('--dir and --out name one reference; leave them out with --browser=all or --config=all')
        let worst = 0
        let checked = 0
        for (const browser of browsers) for (const config of configs) {
          if (browser === undefined) options.delete('browser')
          else options.set('browser', browser)
          if (config === undefined) options.delete('config')
          else options.set('config', config)
          if (several && !existsSync(join(replayDir().dir, 'reference/manifest.json'))) continue
          const code = await check()
          checked++
          // The worst of 1 (a prediction changed), 4 (questions no step accepts), 3 and 0, in that order.
          worst = worst === 1 || code === 1 ? 1 : Math.max(worst, code)
        }
        if (checked === 0) fail('No frozen reference to check against')
        process.exit(worst)
      }
      case 'work': await work(); process.exit(0)
      default: fail('Usage: bun rebuild/tests/replay.ts pack|freeze|check --browser=<browser> [--config=no-facts|facts] ...')
    }
  } catch (error) {
    console.error(`[replay] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(2)
  }
}
