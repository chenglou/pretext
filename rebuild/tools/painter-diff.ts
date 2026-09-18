// The painter differential (research/ARCHITECTURE-PLAN-2.md §7, check 7). Tier 1 compares predictions and the painter's
// limits and never runs the painter, so a change to src/paint.ts passes it silently (lab README, "What the line doesn't
// hold"; known tail lab/replay-blind-spots). This check holds the painter's DOM to the correctness line offline:
// - the frozen side is the line's own predictor, bundled into one file, so it keeps working while the tree it came from
//   is taken apart. It paints each case of a frozen reference from the reference's layout;
// - the working side replays the case with the working tree's predictor and paints its prediction with the working
//   tree's painter, through the lab's hook (lab/predictor-core.ts predict and paint), as lab/page.ts does;
// - both paint into a recording document (recording-document.ts), and the two serializations must be byte-equal.
// The painter's limits stay tier 1's. What the browsers make of the DOM stays tier 2's.
//
//   bun rebuild/tools/painter-diff.ts check --browser=<b>|all [--config=no-facts|facts|all] [--sets=a,b] [--tree=<checkout>]
//     [--jobs=N] [--out=<report.json>]
//   bun rebuild/tools/painter-diff.ts bundle --at=<commit> [--force]
//
// `check` exits 0 when every painted case is the same, 1 when a painting differs (each case named with the first
// difference, grouped by where it is), and 3 when none differs but cases weren't painted because their prediction
// changed or asks a question the record lacks: those are tier 1's to settle first. A case whose reference holds a
// prediction error has nothing to paint. `--tree` names another checkout as the working side.
//
// `bundle` builds .artifacts/tests/painter-frozen/<config>.js from a commit's rebuild/src and rebuild/lab with `bun build`
// and pins the two files by hash in painter-frozen.json beside this file. The frozen predictor also gives the frozen side
// its input: a reference row holds the layout but not the paragraph the painter reads beside it (the fonts with their
// facts, the content tree), so the frozen predictor replays the case, its layout must equal the reference's (or the case
// is reported `frozen differs`, a broken bundle or replay), and its paragraph is painted with the reference's layout.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { installReplay, NewQuestion } from '../lab/measurements.ts'
import type { Predictor } from '../lab/predictor-core.ts'
import type { LayoutPrediction } from '../lab/types.ts'
import { firstDifference, type InputCase, type ReferenceCase } from '../tests/replay.ts'
import { CONFIGS, PREDICTORS, TIER_BROWSERS, selectSets, type Config, type TierBrowser } from '../tests/sets.ts'
import { RecordingDocument, UnmodelledDom, recordedPainting } from './recording-document.ts'

const REPO = resolve(import.meta.dir, '../..')
const FROZEN_DIR = join(REPO, '.artifacts/tests/painter-frozen')
const PIN_PATH = join(import.meta.dir, 'painter-frozen.json')
type Pin = { format: 'pretext-painter-frozen/1'; commit: string; bun: string; bundles: Record<Config, { sha256: string; bytes: number }> }

const options = new Map<string, string>()
const flags = new Set<string>()

function fail(text: string): never {
  console.error(`[painter-diff] ${text}`)
  process.exit(2)
}

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function readShard<T>(path: string): T[] {
  const text = new TextDecoder().decode(Bun.zstdDecompressSync(readFileSync(path)))
  const out: T[] = []
  for (const line of text.split('\n')) if (line !== '') out.push(JSON.parse(line) as T)
  return out
}

// ---- bundle ----

async function bundle(): Promise<number> {
  const at = options.get('at') ?? fail('bundle takes --at=<commit>: the frozen painter is a commit\'s')
  const commit = execFileSync('git', ['rev-parse', at], { cwd: REPO, encoding: 'utf8' }).trim()
  // A pinned painter is built again only to the same bytes (a bundle that went missing); --force pins another.
  const pinned = existsSync(PIN_PATH) && !flags.has('force') ? JSON.parse(readFileSync(PIN_PATH, 'utf8')) as Pin : null
  if (pinned !== null && pinned.commit !== commit) fail(`${relative(REPO, PIN_PATH)} pins the painter of ${pinned.commit.slice(0, 12)}, not ${commit.slice(0, 12)}: --force pins another`)
  const tree = mkdtempSync(join(tmpdir(), 'painter-frozen-'))
  execFileSync('tar', ['-x', '-C', tree], { input: execFileSync('git', ['archive', commit, 'rebuild/src', 'rebuild/lab'], { cwd: REPO, maxBuffer: 1 << 30 }) })
  const pin: Pin = { format: 'pretext-painter-frozen/1', commit, bun: Bun.version, bundles: { 'no-facts': { sha256: '', bytes: 0 }, facts: { sha256: '', bytes: 0 } } }
  const texts: Record<Config, string> = { 'no-facts': '', facts: '' }
  for (const config of CONFIGS) {
    const built = await Bun.build({ entrypoints: [join(tree, PREDICTORS[config])], target: 'bun', format: 'esm' })
    if (!built.success || built.outputs.length !== 1) fail(`bun build failed for ${PREDICTORS[config]} of ${commit.slice(0, 12)}: ${built.logs.map(log => log.message).join('; ')}`)
    // The scratch folder's name is in the bundle's comments; without it the same commit gives the same bytes.
    texts[config] = (await built.outputs[0]!.text()).replaceAll(tree, '<frozen>')
    pin.bundles[config] = { sha256: sha256(texts[config]), bytes: Buffer.byteLength(texts[config]) }
  }
  execFileSync('trash', [tree])
  if (pinned !== null && CONFIGS.some(config => pinned.bundles[config].sha256 !== pin.bundles[config].sha256)) {
    fail(`${commit.slice(0, 12)} built with bun ${Bun.version} isn't the pinned bundle (built with bun ${pinned.bun}): --force pins this one`)
  }
  mkdirSync(FROZEN_DIR, { recursive: true })
  for (const config of CONFIGS) writeFileSync(join(FROZEN_DIR, `${config}.js`), texts[config])
  writeFileSync(PIN_PATH, `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`[painter-diff] bundled the predictors of ${commit.slice(0, 12)} into ${relative(REPO, FROZEN_DIR)} (${CONFIGS.map(config => `${config} ${pin.bundles[config].bytes} bytes`).join(', ')}); pinned in ${relative(REPO, PIN_PATH)}`)
  return 0
}

function frozenBundle(config: Config): string {
  if (!existsSync(PIN_PATH)) fail(`${relative(REPO, PIN_PATH)} doesn't exist: bundle the correctness line's painter first`)
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8')) as Pin
  const path = join(FROZEN_DIR, `${config}.js`)
  if (!existsSync(path)) fail(`${relative(REPO, path)} is missing: bun rebuild/tools/painter-diff.ts bundle --at=${pin.commit.slice(0, 12)} builds it again`)
  if (sha256(readFileSync(path)) !== pin.bundles[config].sha256) fail(`${relative(REPO, path)} isn't the bundle ${relative(REPO, PIN_PATH)} pins (sha256 differs)`)
  return path
}

// ---- One shard (hidden command `work`) ----

type Outcome =
  | { id: string; family: string; kind: 'painting'; first: { path: string; before: string; after: string } }
  | { id: string; family: string; kind: 'prediction-changed' | 'new-question' | 'frozen-differs'; detail: string }
// `refused`: cases both painters refuse with the same error, by error.
type ShardResult = { cases: number; painted: number; same: number; nothingToPaint: number; refused: Record<string, number>; outcomes: Outcome[] }

type Painted = { elements: ReturnType<typeof recordedPainting> } | { error: string }

function painted(predictor: Predictor, input: InputCase, prediction: LayoutPrediction): Painted {
  const doc = new RecordingDocument()
  try {
    return { elements: recordedPainting(predictor.paint(input.case, prediction, doc.createElement('div') as unknown as HTMLElement)) }
  } catch (error) {
    // A painter's own refusal (negative slot insets) is part of what it does; a DOM the recording document lacks isn't.
    if (error instanceof UnmodelledDom) throw error
    return { error: message(error) }
  }
}

// The predictor's prediction under the case's recorded answers.
function predicted(predictor: Predictor, input: InputCase): LayoutPrediction | { error: string } | { newQuestion: string } {
  const replay = installReplay(input.record, input.env, 'predict')
  try {
    return predictor.predict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
  } catch (error) {
    return error instanceof NewQuestion ? { newQuestion: error.message } : { error: message(error) }
  } finally {
    replay.restore()
  }
}

// The layout as a row keeps it: without the call log, while the library still has one.
function rowLayout(layout: LayoutPrediction['layout']): string {
  const { measure: _measure, ...rest } = layout as LayoutPrediction['layout'] & { measure?: unknown }
  return JSON.stringify(rest)
}

async function work(): Promise<void> {
  const inputs = readShard<InputCase>(options.get('inputs')!)
  const reference = readShard<ReferenceCase>(options.get('reference')!)
  if (reference.length !== inputs.length) throw new Error(`${options.get('reference')} holds ${reference.length} cases for ${inputs.length} inputs`)
  const working = await import(options.get('working')!) as Predictor
  const frozen = await import(options.get('frozen')!) as Predictor
  const result: ShardResult = { cases: inputs.length, painted: 0, same: 0, nothingToPaint: 0, refused: {}, outcomes: [] }
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!
    const expected = reference[i]!
    if (expected.id !== input.id) throw new Error(`${options.get('reference')}: case ${i} is ${expected.id}, the inputs hold ${input.id}`)
    const where = { id: input.id, family: input.family }
    if ('error' in expected.prediction) {
      result.nothingToPaint++
      continue
    }
    const referenceLayout = JSON.stringify(expected.prediction.layout)
    const line = predicted(frozen, input)
    if (!('layout' in line) || rowLayout(line.layout) !== referenceLayout) {
      result.outcomes.push({ ...where, kind: 'frozen-differs', detail: 'layout' in line ? 'the frozen predictor\'s layout isn\'t the reference\'s' : JSON.stringify(line).slice(0, 300) })
      continue
    }
    const now = predicted(working, input)
    if ('newQuestion' in now) {
      result.outcomes.push({ ...where, kind: 'new-question', detail: now.newQuestion.slice(0, 300) })
      continue
    }
    if (!('layout' in now) || rowLayout(now.layout) !== referenceLayout) {
      const first = 'layout' in now ? firstDifference(expected.prediction.layout, JSON.parse(rowLayout(now.layout)), 'layout') : null
      result.outcomes.push({ ...where, kind: 'prediction-changed', detail: first === null ? JSON.stringify(now).slice(0, 300) : `${first.path}: ${first.before} -> ${first.after}` })
      continue
    }
    result.painted++
    const before = painted(frozen, input, { paragraph: line.paragraph, layout: expected.prediction.layout as LayoutPrediction['layout'] })
    const after = painted(working, input, now)
    if (JSON.stringify(before) === JSON.stringify(after)) {
      result.same++
      if ('error' in before) result.refused[before.error] = (result.refused[before.error] ?? 0) + 1
    } else result.outcomes.push({ ...where, kind: 'painting', first: firstDifference(before, after, '')! })
  }
  writeFileSync(options.get('result')!, JSON.stringify(result))
}

// ---- check ----

type Shard = { file: string; cases: number; calls?: number; sha256: string }
type Manifest = { sets: Record<string, Array<Shard> | { shards: Shard[] }>; commit?: string }

type Report = {
  format: 'pretext-painter-diff/1'
  browser: TierBrowser
  config: Config
  frozen: { commit: string; sha256: string }
  working: string
  sets: string[]
  counts: { cases: number; painted: number; same: number; paintingDiffers: number; nothingToPaint: number; predictionChanged: number; newQuestion: number; frozenDiffers: number }
  // Per first differing field, indices left out: the cases by family.
  byField: Record<string, { cases: number; families: Record<string, number> }>
  paintingDiffers: Array<{ set: string; id: string; family: string; first: { path: string; before: string; after: string } }>
  // Cases both painters refuse to paint with the same error: counted as the same, and named here.
  refused: Record<string, number>
  notPainted: Array<{ set: string; id: string; family: string; kind: string; detail: string }>
}

async function pool<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(width, items.length); w++) workers.push((async () => { while (next < items.length) await run(items[next++]!) })())
  await Promise.all(workers)
}

async function check(browser: TierBrowser, config: Config): Promise<number> {
  const dir = join(REPO, `.artifacts/tests/reference/${browser}-${config}`)
  const inputs = JSON.parse(readFileSync(join(dir, 'inputs/manifest.json'), 'utf8')) as Manifest
  const reference = JSON.parse(readFileSync(join(dir, 'reference/manifest.json'), 'utf8')) as Manifest
  const frozen = frozenBundle(config)
  const tree = resolve(options.get('tree') ?? REPO)
  const working = join(tree, PREDICTORS[config])
  if (!existsSync(working)) fail(`${working} doesn't exist`)
  const sets = selectSets(browser, options.get('sets'), undefined).map(set => set.name).filter(name => inputs.sets[name] !== undefined)
  const scratch = mkdtempSync(join(tmpdir(), 'painter-diff-'))
  type Job = { set: string; inputs: string; reference: string; result: string; calls: number }
  const jobs: Job[] = []
  for (const name of sets) {
    const shards = (inputs.sets[name] as { shards: Shard[] }).shards
    const frozenShards = reference.sets[name] as Shard[]
    for (let k = 0; k < shards.length; k++) {
      if (frozenShards[k]?.cases !== shards[k]!.cases) fail(`reference/manifest.json doesn't hold shard ${k} of ${name} as the inputs do`)
      jobs.push({ set: name, inputs: join(dir, 'inputs', shards[k]!.file), reference: join(dir, 'reference', frozenShards[k]!.file), result: join(scratch, `${jobs.length}.json`), calls: shards[k]!.calls ?? 0 })
    }
  }
  const started = Date.now()
  const failures: string[] = []
  // Largest first, so the last shards to finish are small.
  const order = [...jobs].sort((a, b) => b.calls - a.calls)
  await pool(order, Math.max(1, Number(options.get('jobs') ?? Math.max(1, cpus().length - 2))), async job => {
    const proc = Bun.spawn(['bun', import.meta.path, 'work', `--inputs=${job.inputs}`, `--reference=${job.reference}`, `--working=${working}`, `--frozen=${frozen}`, `--result=${job.result}`], { cwd: REPO, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
    if (await proc.exited !== 0) failures.push(job.inputs)
  })
  if (failures.length > 0) fail(`the differential failed on ${failures.sort().join(', ')}`)
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8')) as Pin
  const report: Report = {
    format: 'pretext-painter-diff/1', browser, config, frozen: { commit: pin.commit, sha256: pin.bundles[config].sha256 }, working: relative(REPO, working) || working, sets,
    counts: { cases: 0, painted: 0, same: 0, paintingDiffers: 0, nothingToPaint: 0, predictionChanged: 0, newQuestion: 0, frozenDiffers: 0 }, byField: {}, paintingDiffers: [], refused: {}, notPainted: [],
  }
  for (const job of jobs) {
    const result = JSON.parse(readFileSync(job.result, 'utf8')) as ShardResult
    report.counts.cases += result.cases
    report.counts.painted += result.painted
    report.counts.same += result.same
    report.counts.nothingToPaint += result.nothingToPaint
    for (const [error, n] of Object.entries(result.refused)) report.refused[error] = (report.refused[error] ?? 0) + n
    for (const outcome of result.outcomes) {
      switch (outcome.kind) {
        case 'painting': {
          report.paintingDiffers.push({ set: job.set, id: outcome.id, family: outcome.family, first: outcome.first })
          const field = (report.byField[outcome.first.path.replace(/\[\d+\]/g, '[]')] ??= { cases: 0, families: {} })
          field.cases++
          field.families[outcome.family] = (field.families[outcome.family] ?? 0) + 1
          break
        }
        case 'prediction-changed': report.counts.predictionChanged++; report.notPainted.push({ set: job.set, ...outcome }); break
        case 'new-question': report.counts.newQuestion++; report.notPainted.push({ set: job.set, ...outcome }); break
        case 'frozen-differs': report.counts.frozenDiffers++; report.notPainted.push({ set: job.set, ...outcome }); break
      }
    }
  }
  report.counts.paintingDiffers = report.paintingDiffers.length
  execFileSync('trash', [scratch])
  const out = resolve(options.get('out') ?? join(REPO, `.artifacts/tests/painter-diff/${basename(REPO)}/${browser}-${config}.json`))
  mkdirSync(resolve(out, '..'), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`)
  const c = report.counts
  console.log(`[painter-diff] ${browser} ${config}: ${c.cases} cases against the painter of ${pin.commit.slice(0, 12)}: ${c.painted} painted on both sides, ${c.same} the same, ${c.paintingDiffers} differ; not painted: ${c.nothingToPaint} prediction errors in the reference, ${c.predictionChanged} predictions changed, ${c.newQuestion} ask a question the record lacks, ${c.frozenDiffers} where the frozen predictor doesn't give the reference (${Math.round((Date.now() - started) / 100) / 10} s)`)
  for (const [error, n] of Object.entries(report.refused)) console.log(`  ${String(n).padStart(6)}  cases both painters refuse: ${error.slice(0, 200)}`)
  const fields = Object.entries(report.byField).sort((a, b) => b[1].cases - a[1].cases || (a[0] < b[0] ? -1 : 1))
  for (const [field, value] of fields.slice(0, 20)) {
    const families = Object.entries(value.families).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    console.log(`  ${String(value.cases).padStart(6)}  ${field}   ${families.slice(0, 4).map(([family, n]) => `${family} ${n}`).join(', ')}${families.length > 4 ? `, +${families.length - 4} families` : ''}`)
  }
  for (const value of report.paintingDiffers.slice(0, 5)) console.log(`    ${value.set} ${value.id}: ${value.first.path}: ${value.first.before} -> ${value.first.after}`)
  for (const value of report.notPainted.filter(entry => entry.kind === 'frozen-differs').slice(0, 5)) console.log(`    frozen differs, ${value.set} ${value.id}: ${value.detail}`)
  console.log(`  report: ${relative(REPO, out)}`)
  return c.paintingDiffers + c.frozenDiffers > 0 ? 1 : c.predictionChanged + c.newQuestion > 0 ? 3 : 0
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  for (const raw of rest) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    if (match[2] === undefined) flags.add(match[1]!)
    else options.set(match[1]!, match[2])
  }
  switch (command) {
    case 'bundle': process.exit(await bundle())
    case 'work': await work(); process.exit(0)
    case 'check': {
      const browsers = options.get('browser') === 'all' ? [...TIER_BROWSERS] : [options.get('browser') as TierBrowser]
      const configs = options.get('config') === 'all' ? [...CONFIGS] : [(options.get('config') ?? 'no-facts') as Config]
      if (browsers.some(browser => !TIER_BROWSERS.includes(browser))) fail('--browser must be chrome, firefox, webkit-host or all')
      if (configs.some(config => !CONFIGS.includes(config))) fail('--config must be no-facts, facts or all')
      if (options.has('out') && browsers.length * configs.length > 1) fail('--out names one report; leave it out with --browser=all or --config=all')
      let worst = 0
      for (const browser of browsers) for (const config of configs) {
        if (!existsSync(join(REPO, `.artifacts/tests/reference/${browser}-${config}/reference/manifest.json`))) fail(`no frozen reference for ${browser} ${config}`)
        const code = await check(browser, config)
        worst = worst === 1 || code === 1 ? 1 : Math.max(worst, code)
      }
      process.exit(worst)
    }
    default: fail('Usage: bun rebuild/tools/painter-diff.ts check --browser=<browser>|all [--config=...] | bundle --at=<commit>')
  }
}
