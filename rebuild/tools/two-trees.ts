// Two trees on the same cases under the stand-in Canvas (research/ARCHITECTURE-PLAN-2.md §2 item 3). The replay holds the
// working tree to the recorded cases at their recorded widths; this driver runs any case file, at any widths, through the
// predictors of two checkouts in one process with stand-in-canvas.ts answering both, and compares what they predict: the
// layout as a row keeps it, then the painter's limits, then the painting in a recording document. Where a predictor
// returns line ranges alone (a plain predictor), the ranges are compared with the other side's lines. It also counts what
// each tree asks of Canvas: calls, distinct (context, string) pairs and their ratio, per paragraph.
//
//   bun rebuild/tools/two-trees.ts --a=<checkout or commit> [--b=<checkout or commit>] --cases=<cases.ndjson>[,<more>]
//     [--browser=chrome|firefox|webkit-host|all] [--config=no-facts|facts] [--predictor-a=<path in the tree>] [--predictor-b=...]
//     [--widths=60,150,400] [--dpr=2] [--limit=N] [--jobs=N] [--out=<report.json>]
//
// `--b` is this checkout when left out; a commit is read with `git archive` into a scratch folder that goes to the Trash
// at the end. `--widths` lays every case out at each of those widths instead of its own. Exit 0 when every case is the
// same in both trees, 1 when one differs; each differing case is named with its first differing field, grouped by field.
// The answers are the stand-in's, so a difference says the two trees don't compute the same thing from the same answers,
// and equality says nothing about a browser: that stays tier 1's and tier 2's.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { Case, LayoutPrediction, LinesPrediction, PainterLimits } from '../lab/types.ts'
import { firstDifference } from '../tests/replay.ts'
import { CONFIGS, PREDICTORS, TIER_BROWSERS, type Config, type TierBrowser } from '../tests/sets.ts'
import { RecordingDocument, UnmodelledDom, recordedPainting } from './recording-document.ts'
import { installStandInCanvas, type Asked } from './stand-in-canvas.ts'

const REPO = resolve(import.meta.dir, '../..')

// The page and process facts of the lab's Mac, as the frozen references recorded them.
const PAGES: Record<TierBrowser, { userAgent: string; env: PredictEnv }> = {
  chrome: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', env: { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } } },
  firefox: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0', env: { browser: 'firefox', build: '156.0', languages: { engine: 'gecko', regionalPrefsLocale: 'zh-hans-us' } } },
  'webkit-host': { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15 webkit-host/22625.1.29.11.27', env: { browser: 'webkit-host', build: '22625.1.29.11.27', languages: { engine: 'webkit', preferredLanguages: ['zh-CN', 'zh-Hans'], icuDefaultLocale: 'en_US_POSIX' } } },
}

type Prediction = LayoutPrediction | LinesPrediction | { error: string }
type Predictor = {
  predict: (c: Case, env: PredictEnv) => Prediction
  paint?: (c: Case, prediction: LayoutPrediction, host: HTMLElement) => HTMLElement[] | null
  limits?: (prediction: LayoutPrediction) => PainterLimits
}

const options = new Map<string, string>()
const scratch: string[] = []

function finish(code: number): never {
  if (scratch.length > 0) execFileSync('trash', scratch)
  process.exit(code)
}

function fail(text: string): never {
  console.error(`[two-trees] ${text}`)
  finish(2)
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// A checkout as it is, or a commit's rebuild/src and rebuild/lab under a scratch folder.
function treeOf(value: string): string {
  if (existsSync(value) && statSync(value).isDirectory()) return resolve(value)
  const commit = execFileSync('git', ['rev-parse', '--verify', `${value}^{commit}`], { cwd: REPO, encoding: 'utf8' }).trim()
  const dir = mkdtempSync(join(tmpdir(), `two-trees-${commit.slice(0, 12)}-`))
  scratch.push(dir)
  execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', commit, 'rebuild/src', 'rebuild/lab'], { cwd: REPO, maxBuffer: 1 << 30 }) })
  return dir
}

function readCases(files: readonly string[]): Case[] {
  const out: Case[] = []
  for (const file of files) for (const line of readFileSync(resolve(file), 'utf8').split('\n')) if (line !== '') out.push(JSON.parse(line) as Case)
  return out
}

// ---- One slice of the cases (hidden command `work`) ----

type Side = { prediction: Prediction; asked: Asked }
type Difference = { id: string; family: string; width: number; part: 'prediction' | 'limits' | 'painting' | 'lines'; first: { path: string; before: string; after: string } }
// `errors`: what tree b's predictor refused or threw, by message: the same error in both trees counts as the same.
type SliceResult = { layouts: number; same: number; errors: Record<string, number>; differences: Difference[]; asked: { a: Asked; b: Asked } }

// The layout as a row keeps it: without the call log, while a tree's library still has one.
function rowLayout(layout: LayoutPrediction['layout']): unknown {
  const { measure: _measure, ...rest } = layout as LayoutPrediction['layout'] & { measure?: unknown }
  return rest
}

const rangesOf = (prediction: LayoutPrediction | LinesPrediction): Array<[number, number]> => ('layout' in prediction ? prediction.layout.lines : prediction.lines).map(line => [line.start, line.end])

function attempt<T>(run: () => T): T | { error: string } {
  try {
    return run()
  } catch (error) {
    if (error instanceof UnmodelledDom) throw error
    return { error: message(error) }
  }
}

function painting(predictor: Predictor, c: Case, prediction: LayoutPrediction): unknown {
  if (predictor.paint === undefined) return null
  const paint = predictor.paint
  return attempt(() => recordedPainting(paint(c, prediction, new RecordingDocument().createElement('div') as unknown as HTMLElement)))
}

function compare(c: Case, a: Predictor, b: Predictor, before: Prediction, after: Prediction): Pick<Difference, 'part' | 'first'> | null {
  if ('error' in before || 'error' in after) {
    const first = firstDifference(before, after, '')
    return first === null ? null : { part: 'prediction', first }
  }
  if (!('layout' in before) || !('layout' in after)) {
    const first = firstDifference(rangesOf(before), rangesOf(after), 'lines')
    return first === null ? null : { part: 'lines', first }
  }
  const layout = firstDifference(rowLayout(before.layout), rowLayout(after.layout), 'layout')
  if (layout !== null) return { part: 'prediction', first: layout }
  const limits = firstDifference(a.limits === undefined ? null : attempt(() => a.limits!(before)), b.limits === undefined ? null : attempt(() => b.limits!(after)), 'painterLimits')
  if (limits !== null) return { part: 'limits', first: limits }
  const painted = firstDifference(painting(a, c, before), painting(b, c, after), 'painting')
  return painted === null ? null : { part: 'painting', first: painted }
}

const noQuestions = (): Asked => ({ calls: 0, distinct: 0, contexts: 0, characters: 0 })
function add(total: Asked, asked: Asked): void {
  total.calls += asked.calls
  total.distinct += asked.distinct
  total.contexts += asked.contexts
  total.characters += asked.characters
}

async function work(): Promise<void> {
  const browser = options.get('browser') as TierBrowser
  const a = await import(options.get('predictor-a')!) as Predictor
  const b = await import(options.get('predictor-b')!) as Predictor
  const cases = readCases(options.get('cases')!.split(',')).slice(Number(options.get('from')), Number(options.get('to')))
  const widths = options.get('widths') === undefined ? null : options.get('widths')!.split(',').map(Number)
  const page = PAGES[browser]
  const result: SliceResult = { layouts: 0, same: 0, errors: {}, differences: [], asked: { a: noQuestions(), b: noQuestions() } }
  for (let i = 0; i < cases.length; i++) {
    const given = cases[i]!
    const at = widths ?? [given.paragraph.width]
    for (let w = 0; w < at.length; w++) {
      const c: Case = { ...given, paragraph: { ...given.paragraph, width: at[w]! } }
      const standIn = installStandInCanvas({ userAgent: page.userAgent, devicePixelRatio: Number(options.get('dpr') ?? 2), pageLang: c.pageLang })
      const sides: Side[] = []
      for (const predictor of [a, b]) {
        standIn.reset()
        sides.push({ prediction: attempt(() => predictor.predict(c, page.env)), asked: standIn.asked() })
      }
      standIn.restore()
      add(result.asked.a, sides[0]!.asked)
      add(result.asked.b, sides[1]!.asked)
      result.layouts++
      const after = sides[1]!.prediction
      if ('error' in after) result.errors[after.error] = (result.errors[after.error] ?? 0) + 1
      const difference = compare(c, a, b, sides[0]!.prediction, sides[1]!.prediction)
      if (difference === null) result.same++
      else result.differences.push({ id: c.id, family: c.family, width: at[w]!, ...difference })
    }
  }
  writeFileSync(options.get('result')!, JSON.stringify(result))
}

// ---- The run ----

type Report = {
  format: 'pretext-two-trees/1'
  a: { tree: string; predictor: string }
  b: { tree: string; predictor: string }
  cases: string[]
  widths: number[] | null
  browsers: Record<string, { layouts: number; same: number; differ: number; errors: Record<string, number>; asked: { a: Asked; b: Asked }; byField: Record<string, { cases: number; families: Record<string, number> }>; differences: Difference[] }>
}

const ratio = (asked: Asked): string => (asked.distinct === 0 ? '-' : (asked.calls / asked.distinct).toFixed(2))

async function run(): Promise<number> {
  const config = (options.get('config') ?? 'no-facts') as Config
  if (!CONFIGS.includes(config)) fail('--config must be no-facts or facts')
  const browsers = options.get('browser') === undefined || options.get('browser') === 'all' ? [...TIER_BROWSERS] : [options.get('browser') as TierBrowser]
  if (browsers.some(browser => !TIER_BROWSERS.includes(browser))) fail('--browser must be chrome, firefox, webkit-host or all')
  const files = (options.get('cases') ?? fail('--cases=<cases.ndjson>[,<more>] is required')).split(',').map(file => resolve(file))
  const a = { tree: treeOf(options.get('a') ?? fail('--a=<checkout or commit> is required')), predictor: options.get('predictor-a') ?? PREDICTORS[config] }
  const b = { tree: treeOf(options.get('b') ?? REPO), predictor: options.get('predictor-b') ?? PREDICTORS[config] }
  for (const side of [a, b]) if (!existsSync(join(side.tree, side.predictor))) fail(`${join(side.tree, side.predictor)} doesn't exist`)
  const count = Math.min(readCases(files).length, Number(options.get('limit') ?? Infinity))
  const jobs = Math.max(1, Number(options.get('jobs') ?? Math.max(1, cpus().length - 2)))
  const work = mkdtempSync(join(tmpdir(), 'two-trees-work-'))
  scratch.push(work)
  const report: Report = { format: 'pretext-two-trees/1', a: { tree: options.get('a')!, predictor: a.predictor }, b: { tree: options.get('b') ?? REPO, predictor: b.predictor }, cases: files, widths: options.get('widths') === undefined ? null : options.get('widths')!.split(',').map(Number), browsers: {} }
  let differ = 0
  for (const browser of browsers) {
    const started = Date.now()
    // Slices of about equal numbers of cases, several a core so a slow slice doesn't hold the rest.
    const size = Math.max(1, Math.ceil(count / (jobs * 4)))
    const slices: Array<{ from: number; to: number; result: string }> = []
    for (let from = 0; from < count; from += size) slices.push({ from, to: Math.min(count, from + size), result: join(work, `${browser}-${slices.length}.json`) })
    let next = 0
    const failures: number[] = []
    await Promise.all(Array.from({ length: Math.min(jobs, slices.length) }, async () => {
      while (next < slices.length) {
        const slice = slices[next++]!
        const args = ['work', `--browser=${browser}`, `--predictor-a=${join(a.tree, a.predictor)}`, `--predictor-b=${join(b.tree, b.predictor)}`, `--cases=${files.join(',')}`, `--from=${slice.from}`, `--to=${slice.to}`, `--result=${slice.result}`]
        for (const name of ['widths', 'dpr']) if (options.has(name)) args.push(`--${name}=${options.get(name)!}`)
        const proc = Bun.spawn(['bun', import.meta.path, ...args], { cwd: REPO, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
        if (await proc.exited !== 0) failures.push(slice.from)
      }
    }))
    if (failures.length > 0) fail(`${browser}: the slices starting at cases ${failures.sort((x, y) => x - y).join(', ')} failed`)
    const total: Report['browsers'][string] = { layouts: 0, same: 0, differ: 0, errors: {}, asked: { a: noQuestions(), b: noQuestions() }, byField: {}, differences: [] }
    for (const slice of slices) {
      const result = JSON.parse(readFileSync(slice.result, 'utf8')) as SliceResult
      total.layouts += result.layouts
      total.same += result.same
      add(total.asked.a, result.asked.a)
      add(total.asked.b, result.asked.b)
      for (const [error, n] of Object.entries(result.errors)) total.errors[error] = (total.errors[error] ?? 0) + n
      for (const difference of result.differences) {
        total.differences.push(difference)
        const field = (total.byField[`${difference.part}: ${difference.first.path.replace(/\[\d+\]/g, '[]')}`] ??= { cases: 0, families: {} })
        field.cases++
        field.families[difference.family] = (field.families[difference.family] ?? 0) + 1
      }
    }
    total.differ = total.differences.length
    differ += total.differ
    report.browsers[browser] = total
    const per = (asked: Asked): string => `${(asked.calls / Math.max(1, total.layouts)).toFixed(1)} calls a paragraph, ${(asked.distinct / Math.max(1, total.layouts)).toFixed(1)} distinct, ratio ${ratio(asked)}, ${(asked.contexts / Math.max(1, total.layouts)).toFixed(1)} contexts`
    console.log(`[two-trees] ${browser}: ${total.layouts} layouts of ${count} cases: ${total.same} the same in both trees, ${total.differ} differ (${Math.round((Date.now() - started) / 100) / 10} s)`)
    console.log(`  a asks ${per(total.asked.a)}`)
    console.log(`  b asks ${per(total.asked.b)}`)
    for (const [error, n] of Object.entries(total.errors).sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log(`  ${String(n).padStart(6)}  predictions of b are this error: ${error.slice(0, 200)}`)
    const fields = Object.entries(total.byField).sort((x, y) => y[1].cases - x[1].cases || (x[0] < y[0] ? -1 : 1))
    for (const [field, value] of fields.slice(0, 20)) {
      const families = Object.entries(value.families).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      console.log(`  ${String(value.cases).padStart(6)}  ${field}   ${families.slice(0, 4).map(([family, n]) => `${family} ${n}`).join(', ')}${families.length > 4 ? `, +${families.length - 4} families` : ''}`)
    }
    for (const difference of total.differences.slice(0, 5)) console.log(`    ${difference.id} at ${difference.width}px: ${difference.first.path}: ${difference.first.before} -> ${difference.first.after}`)
  }
  const out = options.get('out')
  if (out !== undefined) {
    mkdirSync(resolve(out, '..'), { recursive: true })
    writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`)
  }
  return differ > 0 ? 1 : 0
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2)
  const args = first === 'work' ? rest : process.argv.slice(2)
  for (const raw of args) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    options.set(match[1]!, match[2]!)
  }
  if (first === 'work') {
    await work()
    process.exit(0)
  }
  finish(await run())
}
