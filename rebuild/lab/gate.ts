// No-regression gate over scored lab runs.
//
//   bun rebuild/lab/gate.ts --baseline=rebuild/lab/baselines/gate-chrome.json --runs=<per-case file or dir>[,...]
//     [--complete] [--allow-uncompared] [--out=<report.json>]
//   bun rebuild/lab/gate.ts --seed --engine=blink|webkit|gecko --engine-version=<label> [--note=<text>]
//     --baseline=<file> --runs=<per-case file or dir>[,...] [--allow-uncompared] [--out=<diff.json>]
//
// A run is a per-case file written by `score.ts --per-case`, next to the summary the same call wrote (`<name>-per-case.ndjson`
// and `<name>-summary.json`). `--runs` takes files or directories (every `*-per-case.ndjson` directly inside) and can be
// repeated. A baseline describes one engine version: the (case id, metric) pairs that passed in every seeding run that
// observed the case, and the environments those runs reported (DPR, visual-viewport scale and user agent).
//
// Checking a run against a baseline:
// - Every run's environments must be ones the baseline recorded. Anything else means the browser changed (a new version, a
//   different DPR): re-observe with the same library, seed a new baseline and review the seed's diff. Exit 2.
// - Every run must have been scored with --native-compare against the same case file in the other order, so history-
//   dependent cases are known. --allow-uncompared accepts single-order runs. Exit 2.
// - A baseline pass that isn't a pass in a run observing the case is a lost pass. unobserved and not-applicable are never
//   passes, and gains elsewhere don't offset a loss. Exit 1.
// - A case that any current run marks history-dependent, or that the baseline lists as history-dependent, never fails the
//   gate. Its baseline passes and current statuses are reported apart. So are pairs that were unstable when the baseline
//   was seeded: passing in some seeding runs and not in others with no history-dependent mark (float32 noise at a WebKit
//   line edge, or installed Safari against webkit-host).
// - A pair that passes in every current run observing the case, and isn't a baseline pass, is a new pass (reported).
// - A baseline case that no current run observes is missing. It fails the gate only with --complete, and only when the
//   case holds baseline passes (exit 1).
//
// Seeding writes the baseline and, when the file already exists, reports the pairs the new seed loses or gains against it.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { Metric, MetricName, Status } from './score.ts'
import type { BrowserKind } from './types.ts'

export const GATE_FORMAT = 'pretext-lab-gate/1'
const REPO = resolve(import.meta.dir, '../..')
const METRIC_ORDER: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
const LETTER: Record<MetricName, string> = { lineCount: 'l', breaks: 'b', widths: 'w', painter: 'p' }
const STATUSES = new Set<Status>(['pass', 'fail', 'unobserved', 'not-applicable'])
const BROWSERS = new Set<BrowserKind>(['chrome', 'safari', 'firefox', 'webkit-host'])

export type Engine = 'blink' | 'webkit' | 'gecko'
export const ENGINE_BROWSERS: Record<Engine, readonly BrowserKind[]> = { blink: ['chrome'], webkit: ['safari', 'webkit-host'], gecko: ['firefox'] }

export type CaseResult = { id: string; family: string; browser: BrowserKind; metrics: Record<MetricName, Metric>; historyDependent: string | null }
export type Run = { path: string; environments: string[]; compared: boolean; casesFile: string | null; cases: CaseResult[] }

export type Baseline = {
  format: typeof GATE_FORMAT
  engine: Engine
  engineVersion: string
  note: string
  environments: string[]
  seededFrom: Array<{ perCase: string; casesFile: string | null; cases: number; historyDependent: number }>
  counts: { cases: number; passPairs: Record<MetricName, number>; historyDependentCases: number; withoutPassesCases: number; unstablePairs: number }
  // Cases a seeding run marked history-dependent.
  historyDependent: string[]
  // Cases observed outside history dependence that pass no metric in every seeding run observing them.
  withoutPasses: string[]
  // Per case, the metrics that passed in some seeding runs and not in others (letters l, b, w, p).
  unstable: Record<string, string>
  // Case ids by the letters of the metrics they pass, one list per combination.
  passes: Record<string, string[]>
}

export type LostPass = { id: string; family: string; metric: MetricName; status: Status; reason: string | null; detail: string | null; run: string }
export type GateReport = {
  ok: boolean
  engine: Engine
  engineVersion: string
  runs: Array<{ perCase: string; cases: number; historyDependent: number; compared: boolean }>
  counts: {
    baselineCases: number
    observedCases: number
    lostPairs: number
    newPairs: number
    historyDependentCases: number
    unstablePairs: number
    missingCases: number
    missingPairs: number
  }
  lost: LostPass[]
  newPasses: Array<{ id: string; family: string; metric: MetricName }>
  // Cases history-dependent now or in the baseline: never a gate failure.
  historyDependent: Array<{ id: string; family: string; now: string | null; inBaseline: boolean; baselinePasses: string; currentPasses: string }>
  // Pairs unstable at seeding, with whether every current run passes them.
  unstable: Array<{ id: string; family: string; metric: MetricName; passesNow: boolean }>
  missing: { cases: number; pairs: number; ids: string[] }
}

function fail(message: string): never {
  throw new Error(message)
}

function parseMetric(value: unknown, where: string): Metric {
  if (typeof value !== 'object' || value === null) fail(`${where}: metric must be an object`)
  const record = value as Record<string, unknown>
  const status = record['status']
  if (typeof status !== 'string' || !STATUSES.has(status as Status)) fail(`${where}: unknown status ${JSON.stringify(status)}`)
  const metric: Metric = { status: status as Status }
  if (typeof record['reason'] === 'string') metric.reason = record['reason']
  if (typeof record['detail'] === 'string') metric.detail = record['detail']
  return metric
}

// The rows of a per-case file. Split on LF only: JSON strings can hold U+2028.
export function parsePerCase(text: string, path: string): CaseResult[] {
  const out: CaseResult[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    const where = `${path}:${i + 1}`
    const record = JSON.parse(line) as Record<string, unknown>
    const id = record['id']
    const family = record['family']
    const browser = record['browser']
    if (typeof id !== 'string' || id === '') fail(`${where}: missing case id`)
    if (typeof family !== 'string') fail(`${where}: missing family`)
    if (typeof browser !== 'string' || !BROWSERS.has(browser as BrowserKind)) fail(`${where}: unknown browser ${JSON.stringify(browser)}`)
    if (seen.has(id)) fail(`${where}: case ${id} appears twice in one run`)
    seen.add(id)
    const history = record['historyDependent']
    if (history !== undefined && typeof history !== 'string') fail(`${where}: historyDependent must be a string`)
    out.push({
      id, family, browser: browser as BrowserKind,
      metrics: { lineCount: parseMetric(record['lineCount'], where), breaks: parseMetric(record['breaks'], where), widths: parseMetric(record['widths'], where), painter: parseMetric(record['painter'], where) },
      historyDependent: history ?? null,
    })
  }
  return out
}

const PER_CASE = '-per-case.ndjson'

export function readRun(perCasePath: string): Run {
  if (!perCasePath.endsWith(PER_CASE)) fail(`${perCasePath}: a run is a *${PER_CASE} file`)
  const summaryPath = `${perCasePath.slice(0, -PER_CASE.length)}-summary.json`
  if (!existsSync(summaryPath)) fail(`${perCasePath}: no summary ${summaryPath} next to it`)
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
    casesFile?: unknown
    nativeCompareFile?: unknown
    browsers?: Record<string, { rows?: unknown; environments?: Record<string, unknown>; historyDependent?: { compared?: unknown } }>
  }
  const cases = parsePerCase(readFileSync(perCasePath, 'utf8'), perCasePath)
  const environments = new Set<string>()
  let rows = 0
  let compared = typeof summary.nativeCompareFile === 'string'
  for (const browser of Object.values(summary.browsers ?? {})) {
    rows += typeof browser.rows === 'number' ? browser.rows : 0
    for (const environment of Object.keys(browser.environments ?? {})) environments.add(environment)
    if (typeof browser.historyDependent?.compared !== 'number' || browser.historyDependent.compared === 0) compared = false
  }
  if (rows !== cases.length) fail(`${perCasePath}: ${cases.length} per-case rows, but its summary scored ${rows}; write both with one score.ts call`)
  return { path: perCasePath, environments: [...environments].sort(), compared, casesFile: typeof summary.casesFile === 'string' ? summary.casesFile : null, cases }
}

// Per-case files named by --runs values: files, or directories holding them.
export function runPaths(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    for (const part of value.split(',')) {
      if (part === '') continue
      const path = resolve(part)
      if (!existsSync(path)) fail(`--runs: ${part} doesn't exist`)
      if (statSync(path).isDirectory()) {
        const names = readdirSync(path).filter(name => name.endsWith(PER_CASE)).sort()
        if (names.length === 0) fail(`--runs: ${part} holds no *${PER_CASE} file`)
        for (const name of names) out.push(resolve(path, name))
      } else {
        out.push(path)
      }
    }
  }
  if (out.length === 0) fail('--runs names no per-case file')
  if (new Set(out).size !== out.length) fail('--runs names a per-case file twice')
  return out
}

type Observed = { family: string; historyDependent: string | null; results: Array<{ run: number; metrics: Record<MetricName, Metric> }> }

function observe(runs: readonly Run[]): Map<string, Observed> {
  const byId = new Map<string, Observed>()
  for (let r = 0; r < runs.length; r++) {
    const cases = runs[r]!.cases
    for (let i = 0; i < cases.length; i++) {
      const value = cases[i]!
      let entry = byId.get(value.id)
      if (entry === undefined) byId.set(value.id, (entry = { family: value.family, historyDependent: null, results: [] }))
      entry.historyDependent ??= value.historyDependent
      entry.results.push({ run: r, metrics: value.metrics })
    }
  }
  return byId
}

function letters(metrics: ReadonlySet<MetricName>): string {
  return METRIC_ORDER.filter(metric => metrics.has(metric)).map(metric => LETTER[metric]).join('')
}

function metricsOf(value: string, where: string): Set<MetricName> {
  const out = new Set<MetricName>()
  for (const ch of value) {
    const metric = METRIC_ORDER.find(name => LETTER[name] === ch)
    if (metric === undefined) fail(`${where}: unknown metric letter ${JSON.stringify(ch)}`)
    out.add(metric)
  }
  return out
}

// Problems that make runs unusable with this engine (or baseline): browsers of another engine, environments the baseline
// didn't record, runs without a history comparison.
export function runProblems(engine: Engine, runs: readonly Run[], options: { allowUncompared: boolean; environments: readonly string[] | null }): string[] {
  const problems: string[] = []
  for (const run of runs) {
    const name = relative(REPO, run.path)
    const foreign = [...new Set(run.cases.map(value => value.browser))].filter(browser => !ENGINE_BROWSERS[engine].includes(browser))
    if (foreign.length > 0) problems.push(`${name}: rows from ${foreign.join(', ')}, not ${engine}`)
    if (run.environments.length === 0) problems.push(`${name}: its summary records no environment`)
    if (options.environments !== null) {
      for (const environment of run.environments) {
        if (!options.environments.includes(environment)) problems.push(`${name}: environment not in the baseline (browser changed; re-observe and seed a new baseline): ${environment}`)
      }
    }
    if (!run.compared && !options.allowUncompared) problems.push(`${name}: not scored with --native-compare, so history-dependent cases are unknown`)
  }
  return problems
}

export function seedBaseline(runs: readonly Run[], options: { engine: Engine; engineVersion: string; note: string }): Baseline {
  if (options.engineVersion === '') fail('--engine-version must name the browser build')
  const passes = new Map<string, string[]>()
  const unstable: Record<string, string> = {}
  const historyDependent: string[] = []
  const withoutPasses: string[] = []
  const passPairs: Record<MetricName, number> = { lineCount: 0, breaks: 0, widths: 0, painter: 0 }
  let unstablePairs = 0
  const observed = observe(runs)
  const ids = [...observed.keys()].sort()
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const entry = observed.get(id)!
    if (entry.historyDependent !== null) {
      historyDependent.push(id)
      continue
    }
    const always = new Set<MetricName>()
    const sometimes = new Set<MetricName>()
    for (const metric of METRIC_ORDER) {
      let all = true
      let any = false
      for (const result of entry.results) {
        if (result.metrics[metric].status === 'pass') any = true
        else all = false
      }
      if (all) {
        always.add(metric)
        passPairs[metric]++
      } else if (any) {
        sometimes.add(metric)
        unstablePairs++
      }
    }
    if (always.size > 0) {
      const key = letters(always)
      let list = passes.get(key)
      if (list === undefined) passes.set(key, (list = []))
      list.push(id)
    } else {
      withoutPasses.push(id)
    }
    if (sometimes.size > 0) unstable[id] = letters(sometimes)
  }
  const environments = [...new Set(runs.flatMap(run => run.environments))].sort()
  return {
    format: GATE_FORMAT, engine: options.engine, engineVersion: options.engineVersion, note: options.note, environments,
    seededFrom: runs.map(run => ({ perCase: relative(REPO, run.path), casesFile: run.casesFile === null ? null : relative(REPO, run.casesFile), cases: run.cases.length, historyDependent: run.cases.filter(value => value.historyDependent !== null).length })),
    counts: { cases: observed.size, passPairs, historyDependentCases: historyDependent.length, withoutPassesCases: withoutPasses.length, unstablePairs },
    historyDependent, withoutPasses, unstable,
    passes: Object.fromEntries([...passes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))),
  }
}

export function parseBaseline(text: string, where: string): Baseline {
  const value = JSON.parse(text) as Baseline
  if (value.format !== GATE_FORMAT) fail(`${where}: format ${JSON.stringify(value.format)}, expected ${GATE_FORMAT}`)
  if (!(value.engine in ENGINE_BROWSERS)) fail(`${where}: unknown engine ${JSON.stringify(value.engine)}`)
  if (!Array.isArray(value.environments) || !Array.isArray(value.historyDependent) || !Array.isArray(value.withoutPasses) || typeof value.passes !== 'object' || typeof value.unstable !== 'object') {
    fail(`${where}: malformed baseline`)
  }
  const seen = new Set<string>()
  for (const [key, ids] of Object.entries(value.passes)) {
    metricsOf(key, where)
    for (const id of ids) {
      if (seen.has(id)) fail(`${where}: case ${id} listed under two metric combinations`)
      seen.add(id)
    }
  }
  const history = new Set(value.historyDependent)
  for (const id of history) if (seen.has(id)) fail(`${where}: case ${id} is both history-dependent and a pass`)
  for (const id of value.withoutPasses) if (seen.has(id) || history.has(id)) fail(`${where}: case ${id} is listed without passes and elsewhere`)
  for (const [id, key] of Object.entries(value.unstable)) metricsOf(key, `${where} unstable ${id}`)
  return value
}

// JSON with every list entry and object key on its own line, so a diff names cases.
export function formatBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`
}

function passMap(baseline: Baseline): Map<string, Set<MetricName>> {
  const map = new Map<string, Set<MetricName>>()
  for (const [key, ids] of Object.entries(baseline.passes)) {
    const metrics = metricsOf(key, 'baseline')
    for (let i = 0; i < ids.length; i++) map.set(ids[i]!, metrics)
  }
  return map
}

function baselineCases(baseline: Baseline): Set<string> {
  const ids = new Set<string>(baseline.historyDependent)
  for (const list of Object.values(baseline.passes)) for (let i = 0; i < list.length; i++) ids.add(list[i]!)
  for (let i = 0; i < baseline.withoutPasses.length; i++) ids.add(baseline.withoutPasses[i]!)
  return ids
}

export function checkRuns(baseline: Baseline, runs: readonly Run[], options: { complete: boolean }): GateReport {
  const passes = passMap(baseline)
  const baselineHistory = new Set(baseline.historyDependent)
  const observed = observe(runs)
  const report: GateReport = {
    ok: true, engine: baseline.engine, engineVersion: baseline.engineVersion,
    runs: runs.map(run => ({ perCase: relative(REPO, run.path), cases: run.cases.length, historyDependent: run.cases.filter(value => value.historyDependent !== null).length, compared: run.compared })),
    counts: { baselineCases: 0, observedCases: observed.size, lostPairs: 0, newPairs: 0, historyDependentCases: 0, unstablePairs: 0, missingCases: 0, missingPairs: 0 },
    lost: [], newPasses: [], historyDependent: [], unstable: [], missing: { cases: 0, pairs: 0, ids: [] },
  }
  const ids = [...observed.keys()].sort()
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!
    const entry = observed.get(id)!
    const baselinePasses = passes.get(id) ?? new Set<MetricName>()
    const passingNow = new Set<MetricName>()
    for (const metric of METRIC_ORDER) if (entry.results.every(result => result.metrics[metric].status === 'pass')) passingNow.add(metric)
    if (entry.historyDependent !== null || baselineHistory.has(id)) {
      report.historyDependent.push({ id, family: entry.family, now: entry.historyDependent, inBaseline: baselineHistory.has(id), baselinePasses: letters(baselinePasses), currentPasses: letters(passingNow) })
      continue
    }
    const unstable = baseline.unstable[id] === undefined ? new Set<MetricName>() : metricsOf(baseline.unstable[id]!, `baseline unstable ${id}`)
    for (const metric of METRIC_ORDER) {
      if (baselinePasses.has(metric)) {
        for (const result of entry.results) {
          const value = result.metrics[metric]
          if (value.status === 'pass') continue
          report.lost.push({ id, family: entry.family, metric, status: value.status, reason: value.reason ?? null, detail: value.detail ?? null, run: relative(REPO, runs[result.run]!.path) })
          break
        }
      } else if (unstable.has(metric)) {
        report.unstable.push({ id, family: entry.family, metric, passesNow: passingNow.has(metric) })
      } else if (passingNow.has(metric)) {
        report.newPasses.push({ id, family: entry.family, metric })
      }
    }
  }
  const known = baselineCases(baseline)
  report.counts.baselineCases = known.size
  for (const id of [...known].sort()) {
    if (observed.has(id)) continue
    report.missing.cases++
    report.missing.pairs += passes.get(id)?.size ?? 0
    if (report.missing.ids.length < 50) report.missing.ids.push(id)
  }
  report.counts.lostPairs = report.lost.length
  report.counts.newPairs = report.newPasses.length
  report.counts.historyDependentCases = report.historyDependent.length
  report.counts.unstablePairs = report.unstable.length
  report.counts.missingCases = report.missing.cases
  report.counts.missingPairs = report.missing.pairs
  report.ok = report.lost.length === 0 && (!options.complete || report.missing.pairs === 0)
  return report
}

// Pairs a new seed loses or gains against the existing baseline, over cases both observed outside history dependence.
export function diffBaselines(before: Baseline, after: Baseline): { lost: Array<[string, MetricName]>; gained: Array<[string, MetricName]>; casesOnlyBefore: number; casesOnlyAfter: number } {
  const a = passMap(before)
  const b = passMap(after)
  const observedBefore = baselineCases(before)
  const observedAfter = baselineCases(after)
  const history = new Set([...before.historyDependent, ...after.historyDependent])
  const lost: Array<[string, MetricName]> = []
  const gained: Array<[string, MetricName]> = []
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (history.has(id) || !observedBefore.has(id) || !observedAfter.has(id)) continue
    for (const metric of METRIC_ORDER) {
      const was = a.get(id)?.has(metric) === true
      const is = b.get(id)?.has(metric) === true
      if (was && !is) lost.push([id, metric])
      else if (!was && is) gained.push([id, metric])
    }
  }
  return {
    lost, gained,
    casesOnlyBefore: [...observedBefore].filter(id => !observedAfter.has(id)).length,
    casesOnlyAfter: [...observedAfter].filter(id => !observedBefore.has(id)).length,
  }
}

function describeLost(value: LostPass): string {
  return `  ${value.id} ${value.family} ${value.metric}: ${value.status}${value.reason === null ? '' : ` (${value.reason})`}${value.detail === null ? '' : `: ${value.detail}`} [${value.run}]`
}

async function main(): Promise<number> {
  const USAGE = 'Usage: bun rebuild/lab/gate.ts --baseline=<file> --runs=<per-case file or dir>[,...] [--complete] [--allow-uncompared] [--out=<file>]\n' +
    '       bun rebuild/lab/gate.ts --seed --engine=blink|webkit|gecko --engine-version=<label> [--note=<text>] --baseline=<file> --runs=... [--allow-uncompared] [--out=<file>]'
  const values = new Map<string, string>()
  const runValues: string[] = []
  const switches = new Set<string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
    const name = match?.[1]
    if (match === null || name === undefined) fail(`Unknown argument ${raw}\n${USAGE}`)
    if (['seed', 'complete', 'allow-uncompared'].includes(name)) {
      if (match[2] !== undefined) fail(`--${name} takes no value`)
      switches.add(name)
    } else if (['baseline', 'runs', 'engine', 'engine-version', 'note', 'out'].includes(name)) {
      if (match[2] === undefined) fail(`--${name} needs a value`)
      if (name === 'runs') runValues.push(match[2])
      else values.set(name, match[2])
    } else {
      fail(`Unknown argument ${raw}\n${USAGE}`)
    }
  }
  const baselinePath = values.get('baseline')
  if (baselinePath === undefined || runValues.length === 0) fail(`--baseline and --runs are required\n${USAGE}`)
  const paths = runPaths(runValues)
  const runs = paths.map(readRun)
  const allowUncompared = switches.has('allow-uncompared')
  const outPath = values.get('out')

  if (switches.has('seed')) {
    const engine = values.get('engine') as Engine | undefined
    if (engine === undefined || !(engine in ENGINE_BROWSERS)) fail('--seed needs --engine=blink|webkit|gecko')
    const problems = runProblems(engine, runs, { allowUncompared, environments: null })
    if (problems.length > 0) {
      console.error(problems.join('\n'))
      return 2
    }
    const baseline = seedBaseline(runs, { engine, engineVersion: values.get('engine-version') ?? '', note: values.get('note') ?? '' })
    const resolved = resolve(baselinePath)
    let diff: ReturnType<typeof diffBaselines> | null = null
    if (existsSync(resolved)) diff = diffBaselines(parseBaseline(readFileSync(resolved, 'utf8'), resolved), baseline)
    writeFileSync(resolved, formatBaseline(baseline))
    const pairs = Object.values(baseline.counts.passPairs).reduce((sum, n) => sum + n, 0)
    console.log(`seeded ${relative(REPO, resolved)}: ${baseline.engineVersion}, ${runs.length} runs, ${baseline.counts.cases} cases, ${pairs} pass pairs (${METRIC_ORDER.map(metric => `${metric} ${baseline.counts.passPairs[metric]}`).join(', ')}), ${baseline.counts.historyDependentCases} history-dependent cases, ${baseline.counts.withoutPassesCases} cases without passes, ${baseline.counts.unstablePairs} unstable pairs`)
    if (diff !== null) {
      console.log(`against the previous baseline: ${diff.lost.length} pairs lost, ${diff.gained.length} gained, ${diff.casesOnlyBefore} cases only before, ${diff.casesOnlyAfter} only now`)
      for (const [id, metric] of diff.lost.slice(0, 20)) console.log(`  lost ${id} ${metric}`)
    }
    if (outPath !== undefined) writeFileSync(resolve(outPath), `${JSON.stringify({ baseline: relative(REPO, resolved), counts: baseline.counts, diff }, null, 2)}\n`)
    return 0
  }

  const baseline = parseBaseline(readFileSync(resolve(baselinePath), 'utf8'), baselinePath)
  const problems = runProblems(baseline.engine, runs, { allowUncompared, environments: baseline.environments })
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    return 2
  }
  const report = checkRuns(baseline, runs, { complete: switches.has('complete') })
  if (outPath !== undefined) writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`)
  const c = report.counts
  console.log(`gate ${baseline.engine} (${baseline.engineVersion}): ${runs.length} runs, ${c.observedCases} cases observed; the baseline has ${c.baselineCases}`)
  console.log(`  lost passes ${c.lostPairs}; new passes ${c.newPairs}; history-dependent cases ${c.historyDependentCases} (never gate); unstable pairs ${c.unstablePairs} (never gate); missing cases ${c.missingCases} (${c.missingPairs} pass pairs${switches.has('complete') ? ', gating' : ', not gating without --complete'})`)
  for (const value of report.lost.slice(0, 30)) console.log(describeLost(value))
  if (report.lost.length > 30) console.log(`  ... ${report.lost.length - 30} more${outPath === undefined ? '; --out writes them all' : ''}`)
  console.log(report.ok ? 'gate: pass' : 'gate: FAIL')
  return report.ok ? 0 : 1
}

if (import.meta.main) {
  try {
    process.exit(await main())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
