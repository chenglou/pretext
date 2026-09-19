// Three checks of the library against itself, over the function set of the re-architecture
// (research/ARCHITECTURE-PLAN-2.md §5.6, §7 checks 1 to 3): a paragraph is prepared plain or inspected, a line is filled in
// a slot that carries its width, and its pieces and its inspection are read from the decided line.
//
//   bun rebuild/tests/function-set.ts plain --browser=<b>|all [--config=no-facts|facts|all] [--sets=a,b] [--groups=...] [--jobs=N] [--library=<module>]
//   bun rebuild/tests/function-set.ts pure  ...
//   bun rebuild/tests/function-set.ts sweep ...
//
// - plain: plain equals inspected. Per recorded case, under the replay of its record (replay.ts): every line's fill result
//   (its kind, `next` and `hasLineBox`) and linePieces from a plain paragraph equal the inspected paragraph's; the plain
//   path asks no question the lab's path didn't (a question is a context and a string: replay.ts classifyAsked) and
//   makes no more contexts; inspectLine throws on a plain paragraph. It reports the plain path's questions asked and
//   distinct, their ratio, and the cases whose first asks come in another order than the lab's. The order isn't a failure
//   here as it is in tier 1: the lab's path asks inspection's questions between two fills, and a later fill asks some of
//   them again, where the memo answers; a plain path first asks those when that fill needs them, after questions the
//   lab's path asked later, so no path that asks less can keep the lab's order (all three ports' X1, 2026-09-18). What a
//   canvas makes of the plain path's order no offline check can say: the plain predictor's browser run does
//   (browser-sets.ts --predictor=rebuild/lab/baselines/plain-predictor.ts, compared with compare-sets.ts
//   --prediction=line-ranges), and it belongs to every milestone that changes the plain path's questions.
// - pure: linePieces and inspectLine give the same result twice and in either order. Per recorded case under replay, on an
//   inspected paragraph: each line's pieces, inspection, pieces again and inspection again; then a second paragraph whose
//   lines are inspected before their pieces are read, which must give the first one's results. A function that writes into
//   the decided line shows here (Blink's justification wrote its sizes into the item results it then read).
// - sweep: one prepared paragraph filled at several widths equals fresh prepares. Another width asks questions no record
//   holds, so this runs on the stand-in Canvas (stand-in-canvas.ts), over the recorded cases' paragraphs: a paragraph is
//   prepared once and filled at half, three quarters and one and a half times the case's width and then at the case's own,
//   and each must equal a paragraph prepared for that width alone, plain and inspected.
// The paragraph and the environment of a case are the ones the lab's predictor gave the library: each check lays the case
// out once through the predictor (the lab's path) and reads them from its prediction; the width and the slots' insets come
// from the case. A refused slot has no pieces, only an inspection.
//
// The functions are read from rebuild/src/index.ts by name. Until step 1's S3 exports them the checks can't run: the
// command says which names are missing and exits 5, never 0. --library names another module that exports the set.
// Exit 0 when every case passes, 1 when a case fails, 2 on a failure of the tool, 5 when the function set isn't there.
//
// It reads the replay folders' inputs and nothing else of them, and keeps its shards' results and its report in
// rebuild/tests/.check/<browser>-<config>, as replay.ts does.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { installReplay, NewQuestion, type PageFacts } from '../lab/measurements.ts'
import type { LayoutPrediction } from '../lab/types.ts'
import { GROUP_SHARDS, askedOf, checkDir, classifyAsked, defaultJobs, firstDifference, readInputs, readShard, readShardGroup, referenceDir, runShardGroups, shardJobs, type InputCase, type Predictor } from './replay.ts'
import { CONFIGS, REPO, TIER_BROWSERS, selectSets, type Config, type TierBrowser } from './sets.ts'
import { installStandIn } from './stand-in-canvas.ts'

// The function set, as far as these checks read it. The library's own types aren't there yet, and the checks compare
// results as JSON, so everything the library owns is opaque here.
type FillResult = { kind: 'line'; line: unknown; next: unknown; hasLineBox: boolean } | { kind: 'below-floats'; line: unknown; next: unknown }
export type FunctionSet = {
  prepare: (paragraph: unknown, env: unknown, inspect: boolean) => unknown
  firstLine: (prepared: unknown) => unknown
  fillLine: (prepared: unknown, start: unknown, slot: { width: number; left: number; right: number }) => FillResult
  linePieces: (prepared: unknown, line: unknown) => unknown
  inspectLine: (prepared: unknown, line: unknown) => unknown
}
const FUNCTIONS = ['prepare', 'firstLine', 'fillLine', 'linePieces', 'inspectLine'] as const

export function functionSetOf(module: Record<string, unknown>): FunctionSet | { missing: string[] } {
  const missing = FUNCTIONS.filter(name => typeof module[name] !== 'function')
  return missing.length > 0 ? { missing } : module as FunctionSet
}

export const CHECKS = ['plain', 'pure', 'sweep'] as const
export type Check = typeof CHECKS[number]

// A case's outcome: null when it passes; `skipped` when the lab's path gives no layout to read a paragraph from.
export type Problem = { kind: 'problem' | 'skipped'; detail: string }
export type CaseResult = { problem: Problem | null; asked: number; distinct: number; otherOrder?: boolean }

// ---- One case ----

type Slots = { width: number; insets: ReadonlyArray<{ left: number; right: number }> }

// Every line of a prepared paragraph, as index.ts fills them today: the k-th line box goes in the k-th slot, a refused
// slot takes no line, and a line without a line box takes no slot. `read` gives what a check keeps of a fill result, which
// is kept as JSON at once: a result can share its arrays with the decided line, and a later call could write into them.
function walk(lib: FunctionSet, prepared: unknown, slots: Slots, read: (result: FillResult) => unknown): string[] {
  const out: string[] = []
  let row = 0
  for (let start = lib.firstLine(prepared); start !== null;) {
    const inset = row < slots.insets.length ? slots.insets[row]! : { left: 0, right: 0 }
    const result = lib.fillLine(prepared, start, { width: slots.width, left: inset.left, right: inset.right })
    out.push(JSON.stringify(read(result)))
    switch (result.kind) {
      case 'below-floats':
        row++
        break
      case 'line':
        if (result.hasLineBox) row++
        break
    }
    start = result.next
  }
  return out
}

const fillOf = (result: FillResult): unknown => (result.kind === 'line' ? { kind: result.kind, next: result.next, hasLineBox: result.hasLineBox } : { kind: result.kind, next: result.next })

// Two lists of lines as JSON, or two results as JSON, that differ: the first field that does.
function describe(what: string, before: string | readonly string[], after: string | readonly string[]): string {
  const parse = (value: string | readonly string[]): unknown => (typeof value === 'string' ? JSON.parse(value) : value.map(line => JSON.parse(line) as unknown))
  const first = firstDifference(parse(before), parse(after))!
  return `${what}: ${first.path}: ${first.before} -> ${first.after}`
}

const same = (before: readonly string[], after: readonly string[]): boolean => before.length === after.length && before.every((line, i) => line === after[i])

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The lab's path, for the paragraph and the environment the predictor gave the library.
type LabPath = { paragraph: unknown; env: unknown; slots: Slots; answeredBy: number[]; contexts: number }

function labPath(input: InputCase, predictor: Predictor, page: (env: PageFacts) => { answeredBy: number[]; contexts: number; restore: () => void }): LabPath | Problem {
  const installed = page(input.env)
  let hook: ReturnType<Predictor['predict']>
  try {
    hook = predictor.predict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
  } catch (error) {
    return { kind: 'skipped', detail: `the lab's path threw: ${message(error)}` }
  } finally {
    installed.restore()
  }
  if (!('layout' in hook)) return { kind: 'skipped', detail: 'the lab\'s path gave no layout' }
  const prediction: LayoutPrediction = hook
  return { paragraph: prediction.paragraph, env: prediction.layout.env, slots: { width: input.case.paragraph.width, insets: input.case.inline?.lineSlots ?? [] }, answeredBy: installed.answeredBy, contexts: installed.contexts }
}

const replayPage = (input: InputCase) => (env: PageFacts) => installReplay(input.record, env, 'predict')

export function plainEqualsInspected(lib: FunctionSet, input: InputCase, predictor: Predictor): CaseResult {
  const lab = labPath(input, predictor, replayPage(input))
  if ('kind' in lab) return { problem: lab, asked: 0, distinct: 0 }
  const read = (prepared: unknown) => (result: FillResult): unknown => ({ fill: fillOf(result), pieces: result.kind === 'line' ? lib.linePieces(prepared, result.line) : null })
  let replay = installReplay(input.record, input.env, 'predict')
  let inspected: string[]
  try {
    const prepared = lib.prepare(lab.paragraph, lab.env, true)
    inspected = walk(lib, prepared, lab.slots, read(prepared))
  } catch (error) {
    return { problem: { kind: 'problem', detail: `the inspected paragraph threw: ${message(error)}` }, asked: 0, distinct: 0 }
  } finally {
    replay.restore()
  }
  replay = installReplay(input.record, input.env, 'predict')
  let plain: string[]
  let counts = { asked: 0, distinct: 0 }
  let answered: number[] = []
  let answersOnPlain = false
  try {
    const prepared = lib.prepare(lab.paragraph, lab.env, false)
    const filled: FillResult[] = []
    plain = walk(lib, prepared, lab.slots, result => {
      filled.push(result)
      return read(prepared)(result)
    })
    counts = { asked: replay.asked, distinct: replay.distinct }
    answered = replay.answeredBy.slice()
    // Inspection is what a plain paragraph doesn't hold. Asked last, so whatever it asks or breaks touches no comparison.
    if (filled.length > 0) {
      try {
        lib.inspectLine(prepared, filled[filled.length - 1]!.line)
        answersOnPlain = true
      } catch {}
    }
  } catch (error) {
    if (error instanceof NewQuestion) return { problem: { kind: 'problem', detail: `the plain path asks a question the record lacks: ${error.message}` }, asked: replay.asked, distinct: replay.distinct }
    return { problem: { kind: 'problem', detail: `the plain paragraph threw: ${message(error)}` }, asked: replay.asked, distinct: replay.distinct }
  } finally {
    replay.restore()
  }
  if (!same(inspected, plain)) return { problem: { kind: 'problem', detail: describe('plain differs from inspected, line', inspected, plain) }, ...counts }
  const phase = input.record.phases.predict
  const questions = classifyAsked(input.record.calls, phase, askedOf(lab.answeredBy, phase), askedOf(answered, phase))
  if (questions.added > 0) return { problem: { kind: 'problem', detail: `the plain path asks questions the lab's path didn't: ${questions.detail}` }, ...counts }
  if (replay.contexts > lab.contexts) return { problem: { kind: 'problem', detail: `the plain path makes ${replay.contexts} contexts, the lab's path ${lab.contexts}` }, ...counts }
  if (answersOnPlain) return { problem: { kind: 'problem', detail: 'inspectLine answers on a plain paragraph; it throws there (§5.2)' }, ...counts }
  return { problem: null, ...counts, otherOrder: questions.reordered > 0 }
}

export function pure(lib: FunctionSet, input: InputCase, predictor: Predictor): CaseResult {
  const lab = labPath(input, predictor, replayPage(input))
  if ('kind' in lab) return { problem: lab, asked: 0, distinct: 0 }
  let problem: string | null = null
  const pieces = (prepared: unknown, result: FillResult): string => JSON.stringify(result.kind === 'line' ? lib.linePieces(prepared, result.line) : null)
  const inspection = (prepared: unknown, result: FillResult): string => JSON.stringify(lib.inspectLine(prepared, result.line))
  const twice = (prepared: unknown) => (result: FillResult): unknown => {
    const p = pieces(prepared, result)
    const i = inspection(prepared, result)
    const pAgain = pieces(prepared, result)
    const iAgain = inspection(prepared, result)
    if (problem === null && p !== pAgain) problem = describe('linePieces gives another result the second time', p, pAgain)
    if (problem === null && i !== iAgain) problem = describe('inspectLine gives another result the second time', i, iAgain)
    return { pieces: JSON.parse(p) as unknown, inspection: JSON.parse(i) as unknown }
  }
  const inspectionFirst = (prepared: unknown) => (result: FillResult): unknown => {
    const i = inspection(prepared, result)
    return { pieces: JSON.parse(pieces(prepared, result)) as unknown, inspection: JSON.parse(i) as unknown }
  }
  const orders = [twice, inspectionFirst]
  const results: string[][] = []
  for (let k = 0; k < orders.length; k++) {
    const replay = installReplay(input.record, input.env, 'predict')
    try {
      const prepared = lib.prepare(lab.paragraph, lab.env, true)
      results.push(walk(lib, prepared, lab.slots, orders[k]!(prepared)))
    } catch (error) {
      return { problem: { kind: 'problem', detail: `${error instanceof NewQuestion ? 'reading a line again asks a question the record lacks' : 'the inspected paragraph threw'}: ${message(error)}` }, asked: 0, distinct: 0 }
    } finally {
      replay.restore()
    }
  }
  if (problem === null && !same(results[0]!, results[1]!)) problem = describe('inspectLine before linePieces gives other results than after it, line', results[0]!, results[1]!)
  return { problem: problem === null ? null : { kind: 'problem', detail: problem }, asked: 0, distinct: 0 }
}

export const sweepWidths = (width: number): number[] => [width * 0.5, width * 0.75, width * 1.5, width]

export function sweep(lib: FunctionSet, input: InputCase, predictor: Predictor): CaseResult {
  const lab = labPath(input, predictor, env => ({ answeredBy: [], ...installStandIn(env) }))
  if ('kind' in lab) return { problem: lab, asked: 0, distinct: 0 }
  const standIn = installStandIn(input.env)
  try {
    const widths = sweepWidths(lab.slots.width)
    for (const inspect of [true, false]) {
      const read = (prepared: unknown) => (result: FillResult): unknown => ({
        fill: fillOf(result), pieces: result.kind === 'line' ? lib.linePieces(prepared, result.line) : null, inspection: inspect ? lib.inspectLine(prepared, result.line) : null,
      })
      const shared = lib.prepare(lab.paragraph, lab.env, inspect)
      for (let i = 0; i < widths.length; i++) {
        const slots = { width: widths[i]!, insets: lab.slots.insets }
        const filled = walk(lib, shared, slots, read(shared))
        const alone = lib.prepare(lab.paragraph, lab.env, inspect)
        const fresh = walk(lib, alone, slots, read(alone))
        if (!same(fresh, filled)) {
          return { problem: { kind: 'problem', detail: describe(`${inspect ? 'an inspected' : 'a plain'} paragraph filled at ${widths.slice(0, i).join(', ') || 'no other width'} before ${widths[i]!} differs from one prepared for ${widths[i]!} alone, line`, fresh, filled) }, asked: standIn.asked, distinct: 0 }
        }
      }
    }
  } catch (error) {
    return { problem: { kind: 'problem', detail: `the sweep threw: ${message(error)}` }, asked: standIn.asked, distinct: 0 }
  } finally {
    standIn.restore()
  }
  return { problem: null, asked: standIn.asked, distinct: 0 }
}

export function runCheck(check: Check, lib: FunctionSet, input: InputCase, predictor: Predictor): CaseResult {
  switch (check) {
    case 'plain': return plainEqualsInspected(lib, input, predictor)
    case 'pure': return pure(lib, input, predictor)
    case 'sweep': return sweep(lib, input, predictor)
  }
}

// ---- The command ----

type ShardResult = { cases: number; passed: number; asked: number; distinct: number; otherOrder: number; failures: Array<{ id: string; family: string; kind: Problem['kind']; detail: string }> }
type Report = {
  format: 'pretext-function-set-check/1'
  check: Check
  browser: TierBrowser
  config: Config
  library: string
  sets: string[]
  counts: { cases: number; passed: number; problems: number; skipped: number }
  // plain: the plain path's questions under replay. sweep: the stand-in's calls. pure: nothing.
  asked: { asked: number; distinct: number }
  // plain: passing cases whose first asks come in another order than the lab's path's (the header says why that passes).
  otherOrder: number
  problems: Array<{ set: string; id: string; family: string; detail: string }>
  skipped: Array<{ set: string; id: string; family: string; detail: string }>
}

function fail(text: string): never {
  console.error(`[function-set] ${text}`)
  process.exit(2)
}

const LIBRARY = 'rebuild/src/index.ts'

async function work(options: Map<string, string>): Promise<void> {
  const check = options.get('check') as Check
  const lib = functionSetOf(await import(resolve(REPO, options.get('library')!)) as Record<string, unknown>)
  if ('missing' in lib) throw new Error(`${options.get('library')} lacks ${lib.missing.join(', ')}`)
  const predictor = await import(resolve(REPO, options.get('predictor')!)) as Predictor
  // A group of shards a process, as replay.ts runs them (shardGroups).
  const group = readShardGroup(options.get('group')!)
  for (let k = 0; k < group.length; k++) {
    const inputs = readShard<InputCase>(group[k]!.inputs)
    const result: ShardResult = { cases: inputs.length, passed: 0, asked: 0, distinct: 0, otherOrder: 0, failures: [] }
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      const outcome = runCheck(check, lib, input, predictor)
      result.asked += outcome.asked
      result.distinct += outcome.distinct
      if (outcome.otherOrder === true) result.otherOrder++
      if (outcome.problem === null) result.passed++
      else result.failures.push({ id: input.id, family: input.family, kind: outcome.problem.kind, detail: outcome.problem.detail })
    }
    writeFileSync(group[k]!.result, JSON.stringify(result))
  }
}

async function run(check: Check, browser: TierBrowser, config: Config, options: Map<string, string>): Promise<number> {
  const dir = referenceDir(browser, config)
  const inputs = readInputs(dir)
  const library = options.get('library') ?? LIBRARY
  const sets = selectSets(browser, options.get('sets'), options.get('groups')).map(set => set.name)
  const started = Date.now()
  const scratch = join(checkDir(browser, config), `${check}-work-${process.pid}`)
  const jobs = shardJobs(dir, inputs, null, sets, scratch)
  // The sweep lays a case out eighteen times, so a shard takes 4 to 20 s and a process a shard loses little.
  await runShardGroups(jobs, check === 'sweep' ? 1 : GROUP_SHARDS, Math.max(1, Number(options.get('jobs') ?? defaultJobs())), groupFile => [import.meta.path, 'work', `--check=${check}`, `--library=${library}`, `--predictor=${inputs.predictor}`, `--group=${groupFile}`])
  const report: Report = {
    format: 'pretext-function-set-check/1', check, browser, config, library, sets: sets.filter(name => inputs.sets[name] !== undefined),
    counts: { cases: 0, passed: 0, problems: 0, skipped: 0 }, asked: { asked: 0, distinct: 0 }, otherOrder: 0, problems: [], skipped: [],
  }
  for (const job of jobs) {
    const result = JSON.parse(readFileSync(job.result, 'utf8')) as ShardResult
    report.counts.cases += result.cases
    report.counts.passed += result.passed
    report.asked.asked += result.asked
    report.asked.distinct += result.distinct
    report.otherOrder += result.otherOrder
    for (const failure of result.failures) (failure.kind === 'problem' ? report.problems : report.skipped).push({ set: job.set, id: failure.id, family: failure.family, detail: failure.detail })
  }
  report.counts.problems = report.problems.length
  report.counts.skipped = report.skipped.length
  Bun.spawnSync(['trash', scratch])
  const out = join(checkDir(browser, config), `${check}-report.json`)
  mkdirSync(checkDir(browser, config), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  const c = report.counts
  const asked = check === 'plain'
    ? `; the plain path asked ${report.asked.asked} questions, ${report.asked.distinct} distinct, ask ratio ${report.asked.distinct === 0 ? 'none' : (report.asked.asked / report.asked.distinct).toFixed(2)}; ${report.otherOrder} cases first ask in another order than the lab's path`
    : check === 'sweep' ? `; the stand-in Canvas answered ${report.asked.asked} questions` : ''
  console.log(`[function-set] ${check}, ${browser} ${config}: ${c.cases} cases in ${report.sets.length} sets: ${c.passed} pass, ${c.problems} fail, ${c.skipped} skipped (the lab's path gave no layout)${asked} (${Math.round((Date.now() - started) / 100) / 10} s)`)
  for (const value of report.problems.slice(0, 8)) console.log(`    ${value.set} ${value.id} ${value.family}: ${value.detail.slice(0, 400)}`)
  console.log(`  report: ${relative(REPO, out)}`)
  return c.problems > 0 ? 1 : 0
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const options = new Map<string, string>()
  for (const raw of rest) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    options.set(match[1]!, match[2]!)
  }
  try {
    if (command === 'work') {
      await work(options)
      process.exit(0)
    }
    const check = CHECKS.find(name => name === command)
    if (check === undefined) fail('Usage: bun rebuild/tests/function-set.ts plain|pure|sweep --browser=<browser>|all [--config=no-facts|facts|all] [--sets=a,b] [--groups=...] [--jobs=N] [--library=<module>]')
    const library = options.get('library') ?? LIBRARY
    const lib = functionSetOf(await import(resolve(REPO, library)) as Record<string, unknown>)
    if ('missing' in lib) {
      console.log(`[function-set] ${check} skipped, nothing checked: ${library} doesn't export ${lib.missing.join(', ')}. The re-architecture's function set (research/ARCHITECTURE-PLAN-2.md §5.6: prepare, firstLine, fillLine, linePieces, inspectLine) arrives with step 1's S3; until then this check can't run. Exit 5`)
      process.exit(5)
    }
    const browsers = options.get('browser') === 'all' ? [...TIER_BROWSERS] : TIER_BROWSERS.filter(name => name === options.get('browser'))
    const configs = options.get('config') === 'all' ? [...CONFIGS] : CONFIGS.filter(name => name === (options.get('config') ?? 'no-facts'))
    if (browsers.length === 0 || configs.length === 0) fail('--browser must be chrome, firefox, webkit-host or all, and --config no-facts, facts or all')
    let worst = 0
    for (const browser of browsers) for (const config of configs) worst = Math.max(worst, await run(check, browser, config, options))
    process.exit(worst)
  } catch (error) {
    console.error(`[function-set] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(2)
  }
}
