// No-regression gate over scored lab runs.
//
//   bun rebuild/lab/gate.ts --baseline=rebuild/lab/baselines/gate-chrome.json --runs=<per-case file or dir>[,...]
//     [--complete] [--allow-uncompared] [--out=<report.json>]
//   bun rebuild/lab/gate.ts --seed --staging=<dir> --engine=blink|webkit|gecko --engine-version=<label> [--note=<text>]
//     --baseline=<file> --runs=<per-case file or dir>[,...] [--allow-uncompared] [--out=<record.json>]
//   bun rebuild/lab/gate.ts --prune-protocol --staging=<dir> --baseline=<lab gate file or tests gate file> [--out=<report.json>]
//
// A run is a per-case file written by `score.ts --per-case`, next to the summary the same call wrote (`<name>-per-case.ndjson`
// and `<name>-summary.json`). `--runs` takes files or directories (every `*-per-case.ndjson` directly inside) and can be
// repeated. A baseline describes one engine version: the (case id, metric) pairs that passed in every seeding run that
// observed the case, and the environments those runs reported: the browser build the driver read from the app bundle, the
// OS build, DPR, visual-viewport scale, the browser process's given languages and the scorer version (score.ts
// environmentKey).
//
// Checking a run against a baseline:
// - Every run's environments must be ones the baseline recorded: the same browser build and device, the same given process
//   languages, and the same scorer. Each part is compared on its own, so a refusal names what differs. A new browser build
//   or DPR means re-observing; other process languages are another environment, since unlabeled content breaks by them
//   (DESIGN.md §1.4); another scorer means re-scoring the seeding runs. Then seed a new baseline and review the seed's diff.
//   Exit 2.
// - Every run must have been scored with --native-compare against the same case file in the other order, so history-
//   dependent cases are known. --allow-uncompared accepts single-order runs. Exit 2.
// - A baseline pass that isn't a pass in a run observing the case is a lost pass. unobserved and not-applicable are never
//   passes, and gains elsewhere don't offset a loss. Exit 1.
// - A case that any current run marks history-dependent, or that the baseline lists as history-dependent, never fails the
//   gate. Its baseline passes and current statuses are reported apart. So are pairs that were unstable when the baseline
//   was seeded: passing in some seeding runs and not in others with no history-dependent mark (float32 noise at a WebKit
//   line edge, or installed Safari against webkit-host).
// - A protocol row (score.ts slotProtocol: its page doesn't describe the declared input) is never a pass: seeding lists it
//   apart, and a case that a current run or the baseline marks as one never fails the gate and is reported apart.
// - A pair that passes in every current run observing the case, and isn't a baseline pass, is a new pass (reported).
// - A baseline case that no current run observes is missing. It fails the gate only with --complete, and only when the
//   case holds baseline passes (exit 1).
//
// Seeding never writes the baseline it names. `--baseline` is the adopted seed, the file a later check reads; the new seed
// goes to `<staging>/<the baseline's file name>`, with its record next to it (`<name>.seed-record.json`), and is adopted by
// whoever copies it over the baseline after review. The staging folder is required and can't be the folder the baseline
// is in. The record compares the new seed with the adopted one, when that exists:
// - every pair the new seed loses, with its status, reason and detail in the first seeding run that doesn't pass it, the
//   gaps that cover it there (score.ts lineGaps) or that it has no covered explanation, its residual class if any, and an
//   empty `attribution` for the source reading a person adds;
// - the pairs that leave through new history dependence: passes of the adopted seed whose case a seeding run now marks
//   history-dependent. They stop gating without failing, so they are listed with the difference the two orders showed and
//   the metrics the case passes now;
// - the pairs that leave because their row is a protocol row now; pairs gained; cases only one of the two observed.
// Seeding refuses runs whose environment records no process languages, since no run could then match the baseline's
// languages, and runs scored by different scorers, since a check could then never match them all.
//
// Pruning (--prune-protocol) applies score.ts slotProtocol to the rows of every seeding run a baseline names (the
// `<browser>-rows.ndjson` next to each per-case file) and moves each protocol row out of the baseline's passes, cases
// without passes and unstable pairs into `protocol`, with the rule's reason. It lists every pair it removes. Nothing else
// changes, so a baseline seeded before scorer 4 loses the passes its protocol rows recorded by accident. The pruned file
// goes to the staging folder too.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { existingRows, readLines } from './rows.ts'
import { slotProtocol, type Metric, type MetricName, type Status } from './score.ts'
import type { BrowserKind, LabRow } from './types.ts'

export const GATE_FORMAT = 'pretext-lab-gate/1'
const REPO = resolve(import.meta.dir, '../..')
const METRIC_ORDER: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']
const LETTER: Record<MetricName, string> = { lineCount: 'l', breaks: 'b', widths: 'w', painter: 'p' }
const STATUSES = new Set<Status>(['pass', 'fail', 'unobserved', 'not-applicable'])
const BROWSERS = new Set<BrowserKind>(['chrome', 'safari', 'firefox', 'webkit-host'])

export type Engine = 'blink' | 'webkit' | 'gecko'
export const ENGINE_BROWSERS: Record<Engine, readonly BrowserKind[]> = { blink: ['chrome'], webkit: ['safari', 'webkit-host'], gecko: ['firefox'] }

// Per failing metric, whether the scorer found a covered explanation and the gaps that cover it (score.ts lineGaps).
export type Coverage = Partial<Record<MetricName, { covered: boolean; gaps: string[] }>>
export type CaseResult = {
  id: string; family: string; browser: BrowserKind; metrics: Record<MetricName, Metric>; historyDependent: string | null; protocol: string | null
  // Absent in results built by hand; parsePerCase always sets them.
  coverage?: Coverage
  residual?: string | null
}
export type Run = { path: string; environments: string[]; compared: boolean; casesFile: string | null; cases: CaseResult[] }

export type Baseline = {
  format: typeof GATE_FORMAT
  engine: Engine
  engineVersion: string
  note: string
  environments: string[]
  seededFrom: Array<{ perCase: string; casesFile: string | null; cases: number; historyDependent: number }>
  counts: { cases: number; passPairs: Record<MetricName, number>; historyDependentCases: number; withoutPassesCases: number; unstablePairs: number; protocolCases?: number }
  // Cases a seeding run marked history-dependent.
  historyDependent: string[]
  // Cases observed outside history dependence that pass no metric in every seeding run observing them.
  withoutPasses: string[]
  // Per case, the metrics that passed in some seeding runs and not in others (letters l, b, w, p).
  unstable: Record<string, string>
  // Case ids by the letters of the metrics they pass, one list per combination.
  passes: Record<string, string[]>
  // Protocol rows by case id, with why the page doesn't describe the declared input. Absent in baselines from before 2026-09-17.
  protocol?: Record<string, string>
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
    // Baseline passes of cases that are history-dependent now and weren't when the baseline was seeded: they stopped gating.
    // checkRuns always sets it; optional so reports built by hand before it existed still type-check.
    leftThroughHistoryPairs?: number
    unstablePairs: number
    missingCases: number
    missingPairs: number
    protocolCases: number
  }
  lost: LostPass[]
  newPasses: Array<{ id: string; family: string; metric: MetricName }>
  // Cases history-dependent now or in the baseline: never a gate failure.
  historyDependent: Array<{ id: string; family: string; now: string | null; inBaseline: boolean; baselinePasses: string; currentPasses: string }>
  // Protocol rows now or in the baseline: never a gate failure.
  protocol: Array<{ id: string; family: string; now: string | null; inBaseline: boolean; baselinePasses: string }>
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
    const protocol = record['protocol']
    if (protocol !== undefined && typeof protocol !== 'string') fail(`${where}: protocol must be a string`)
    const coverage: Coverage = {}
    const lineGaps = record['lineGaps'] as Record<string, { covered?: unknown; lines?: Array<{ gaps?: Array<{ gap?: unknown }> }> }> | undefined
    if (typeof lineGaps === 'object' && lineGaps !== null) {
      for (const metric of METRIC_ORDER) {
        const value = lineGaps[metric]
        if (value === undefined) continue
        const gaps = new Set<string>()
        for (const line of value.lines ?? []) for (const gap of line.gaps ?? []) if (typeof gap.gap === 'string') gaps.add(gap.gap)
        coverage[metric] = { covered: value.covered === true, gaps: [...gaps].sort() }
      }
    }
    const residual = record['residual'] as { name?: unknown; membership?: unknown } | undefined
    out.push({
      id, family, browser: browser as BrowserKind,
      metrics: { lineCount: parseMetric(record['lineCount'], where), breaks: parseMetric(record['breaks'], where), widths: parseMetric(record['widths'], where), painter: parseMetric(record['painter'], where) },
      historyDependent: history ?? null, protocol: protocol ?? null, coverage,
      residual: typeof residual?.name === 'string' ? `${residual.name} (${String(residual.membership)})` : null,
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

type Observed = { family: string; historyDependent: string | null; protocol: string | null; results: Array<{ run: number; metrics: Record<MetricName, Metric>; coverage: Coverage; residual: string | null }> }

function observe(runs: readonly Run[]): Map<string, Observed> {
  const byId = new Map<string, Observed>()
  for (let r = 0; r < runs.length; r++) {
    const cases = runs[r]!.cases
    for (let i = 0; i < cases.length; i++) {
      const value = cases[i]!
      let entry = byId.get(value.id)
      if (entry === undefined) byId.set(value.id, (entry = { family: value.family, historyDependent: null, protocol: null, results: [] }))
      entry.historyDependent ??= value.historyDependent
      entry.protocol ??= value.protocol
      entry.results.push({ run: r, metrics: value.metrics, coverage: value.coverage ?? {}, residual: value.residual ?? null })
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

// The parts of an environment key (score.ts environmentKey): `<browser>: <build>; DPR <d>, scale <s>[; <languages>]; scorer
// <n>`. Keys from before the driver recorded builds (`DPR <d>, scale <s>, <user agent>`) have neither languages nor scorer.
export type EnvironmentParts = { build: string; device: string; languages: string | null; scorer: string | null }

export function environmentParts(key: string): EnvironmentParts {
  const parts = key.split('; ')
  if (parts.length < 3 || !parts[parts.length - 1]!.startsWith('scorer ')) return { build: key, device: '', languages: null, scorer: null }
  return { build: parts[0]!, device: parts[1]!, languages: parts.length > 3 ? parts.slice(2, -1).join('; ') : null, scorer: parts[parts.length - 1]! }
}

// Why a run's environment isn't one the baseline recorded, part by part, or null when it is.
export function environmentProblem(environment: string, recorded: readonly string[]): string | null {
  if (recorded.includes(environment)) return null
  const run = environmentParts(environment)
  const candidates = recorded.map(environmentParts).filter(value => value.build === run.build && value.device === run.device)
  if (candidates.length === 0) return `browser build or device not in the baseline (re-observe and seed a new baseline): ${environment}`
  const differences: string[] = []
  if (run.languages === null) differences.push('the run records no process languages')
  else if (!candidates.some(value => value.languages === run.languages)) {
    const known = [...new Set(candidates.map(value => value.languages ?? 'none recorded'))].join(' | ')
    differences.push(`process languages ${run.languages} don't match the baseline's recorded languages (${known}): another environment; seed a baseline for it`)
  }
  if (!candidates.some(value => value.scorer === run.scorer)) {
    differences.push(`${run.scorer ?? 'no scorer recorded'} against the baseline's ${[...new Set(candidates.map(value => value.scorer ?? 'none'))].join(' | ')}: re-score the seeding runs and seed a new baseline`)
  }
  if (differences.length === 0) differences.push('the languages and the scorer each appear in the baseline, but not together')
  return `${differences.join('; ')}: ${environment}`
}

// Problems that make runs unusable with this engine (or baseline): browsers of another engine, environments the baseline
// didn't record, runs without a history comparison. Seeding (environments null) refuses runs without recorded languages.
export function runProblems(engine: Engine, runs: readonly Run[], options: { allowUncompared: boolean; environments: readonly string[] | null }): string[] {
  const problems: string[] = []
  for (const run of runs) {
    const name = relative(REPO, run.path)
    const foreign = [...new Set(run.cases.map(value => value.browser))].filter(browser => !ENGINE_BROWSERS[engine].includes(browser))
    if (foreign.length > 0) problems.push(`${name}: rows from ${foreign.join(', ')}, not ${engine}`)
    if (run.environments.length === 0) problems.push(`${name}: its summary records no environment`)
    for (const environment of run.environments) {
      if (options.environments !== null) {
        const problem = environmentProblem(environment, options.environments)
        if (problem !== null) problems.push(`${name}: ${problem}`)
      } else if (environmentParts(environment).languages === null) {
        problems.push(`${name}: its environment records no process languages, so no run could match the baseline's: ${environment}`)
      }
    }
    if (!run.compared && !options.allowUncompared) problems.push(`${name}: not scored with --native-compare, so history-dependent cases are unknown`)
  }
  if (options.environments === null) {
    const scorers = new Set(runs.flatMap(run => run.environments.map(environment => environmentParts(environment).scorer ?? 'no scorer recorded')))
    if (scorers.size > 1) problems.push(`the seeding runs were scored by different scorers (${[...scorers].sort().join(', ')}): re-score them with one`)
  }
  return problems
}

export function seedBaseline(runs: readonly Run[], options: { engine: Engine; engineVersion: string; note: string }): Baseline {
  if (options.engineVersion === '') fail('--engine-version must name the browser build')
  const passes = new Map<string, string[]>()
  const unstable: Record<string, string> = {}
  const historyDependent: string[] = []
  const withoutPasses: string[] = []
  const protocol: Record<string, string> = {}
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
    if (entry.protocol !== null) {
      protocol[id] = entry.protocol
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
    counts: { cases: observed.size, passPairs, historyDependentCases: historyDependent.length, withoutPassesCases: withoutPasses.length, unstablePairs, protocolCases: Object.keys(protocol).length },
    historyDependent, withoutPasses, unstable,
    passes: Object.fromEntries([...passes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))),
    protocol,
  }
}

export function parseBaseline(text: string, where: string): Baseline {
  const value = JSON.parse(text) as Baseline
  if (value.format !== GATE_FORMAT) fail(`${where}: format ${JSON.stringify(value.format)}, expected ${GATE_FORMAT}`)
  if (!(value.engine in ENGINE_BROWSERS)) fail(`${where}: unknown engine ${JSON.stringify(value.engine)}`)
  if (!Array.isArray(value.environments) || !Array.isArray(value.historyDependent) || !Array.isArray(value.withoutPasses) || typeof value.passes !== 'object' || typeof value.unstable !== 'object') {
    fail(`${where}: malformed baseline`)
  }
  if (value.protocol !== undefined && (typeof value.protocol !== 'object' || value.protocol === null)) fail(`${where}: malformed protocol list`)
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
  for (const id of Object.keys(value.protocol ?? {})) if (seen.has(id) || value.withoutPasses.includes(id) || id in value.unstable) fail(`${where}: protocol row ${id} is listed elsewhere`)
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
  for (const id of Object.keys(baseline.protocol ?? {})) ids.add(id)
  return ids
}

export function checkRuns(baseline: Baseline, runs: readonly Run[], options: { complete: boolean }): GateReport {
  const passes = passMap(baseline)
  const baselineHistory = new Set(baseline.historyDependent)
  const baselineProtocol = baseline.protocol ?? {}
  const observed = observe(runs)
  const report: GateReport = {
    ok: true, engine: baseline.engine, engineVersion: baseline.engineVersion,
    runs: runs.map(run => ({ perCase: relative(REPO, run.path), cases: run.cases.length, historyDependent: run.cases.filter(value => value.historyDependent !== null).length, compared: run.compared })),
    counts: { baselineCases: 0, observedCases: observed.size, lostPairs: 0, newPairs: 0, historyDependentCases: 0, leftThroughHistoryPairs: 0, unstablePairs: 0, missingCases: 0, missingPairs: 0, protocolCases: 0 },
    lost: [], newPasses: [], historyDependent: [], protocol: [], unstable: [], missing: { cases: 0, pairs: 0, ids: [] },
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
    if (entry.protocol !== null || id in baselineProtocol) {
      report.protocol.push({ id, family: entry.family, now: entry.protocol, inBaseline: id in baselineProtocol, baselinePasses: letters(baselinePasses) })
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
  let leftThroughHistory = 0
  for (const value of report.historyDependent) if (!value.inBaseline) leftThroughHistory += value.baselinePasses.length
  report.counts.leftThroughHistoryPairs = leftThroughHistory
  report.counts.protocolCases = report.protocol.length
  report.counts.unstablePairs = report.unstable.length
  report.counts.missingCases = report.missing.cases
  report.counts.missingPairs = report.missing.pairs
  report.ok = report.lost.length === 0 && (!options.complete || report.missing.pairs === 0)
  return report
}

// Pairs a new seed loses or gains against the existing baseline, over cases both observed outside history dependence and
// outside protocol rows; and the passes of the existing baseline that leave without being lost: their case is history-
// dependent in the new seed and wasn't before, or is a protocol row in the new seed and wasn't before.
export type BaselineDiff = {
  lost: Array<[string, MetricName]>
  gained: Array<[string, MetricName]>
  leftThroughHistory: Array<[string, MetricName]>
  leftThroughProtocol: Array<[string, MetricName]>
  casesOnlyBefore: number
  casesOnlyAfter: number
}

export function diffBaselines(before: Baseline, after: Baseline): BaselineDiff {
  const a = passMap(before)
  const b = passMap(after)
  const observedBefore = baselineCases(before)
  const observedAfter = baselineCases(after)
  const excluded = new Set([...before.historyDependent, ...after.historyDependent, ...Object.keys(before.protocol ?? {}), ...Object.keys(after.protocol ?? {})])
  const lost: Array<[string, MetricName]> = []
  const gained: Array<[string, MetricName]> = []
  const leftThroughHistory: Array<[string, MetricName]> = []
  const leftThroughProtocol: Array<[string, MetricName]> = []
  const historyBefore = new Set(before.historyDependent)
  const protocolBefore = before.protocol ?? {}
  for (const id of [...after.historyDependent].sort()) {
    if (historyBefore.has(id)) continue
    for (const metric of METRIC_ORDER) if (a.get(id)?.has(metric) === true) leftThroughHistory.push([id, metric])
  }
  for (const id of Object.keys(after.protocol ?? {}).sort()) {
    if (id in protocolBefore || after.historyDependent.includes(id)) continue
    for (const metric of METRIC_ORDER) if (a.get(id)?.has(metric) === true) leftThroughProtocol.push([id, metric])
  }
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (excluded.has(id) || !observedBefore.has(id) || !observedAfter.has(id)) continue
    for (const metric of METRIC_ORDER) {
      const was = a.get(id)?.has(metric) === true
      const is = b.get(id)?.has(metric) === true
      if (was && !is) lost.push([id, metric])
      else if (!was && is) gained.push([id, metric])
    }
  }
  return {
    lost, gained, leftThroughHistory, leftThroughProtocol,
    casesOnlyBefore: [...observedBefore].filter(id => !observedAfter.has(id)).length,
    casesOnlyAfter: [...observedAfter].filter(id => !observedBefore.has(id)).length,
  }
}

// The record a re-seed is reviewed by (see the file comment): the diff against the adopted baseline with what the seeding
// runs say about each pair that is lost or leaves.
export type SeedRecord = {
  staged: string
  against: string | null
  counts: Baseline['counts']
  lost: Array<{ id: string; family: string; metric: MetricName; status: Status; reason: string | null; detail: string | null; run: string; covered: boolean; coveringGaps: string[]; residual: string | null; attribution: string | null }>
  leftThroughHistory: Array<{ id: string; family: string; metric: MetricName; difference: string; passesNow: boolean }>
  leftThroughProtocol: Array<{ id: string; family: string; metric: MetricName; protocol: string }>
  gained: Array<[string, MetricName]>
  casesOnlyBefore: number
  casesOnlyAfter: number
}

export function seedRecord(before: Baseline | null, after: Baseline, runs: readonly Run[], paths: { staged: string; against: string | null }): SeedRecord {
  const record: SeedRecord = { staged: paths.staged, against: before === null ? null : paths.against, counts: after.counts, lost: [], leftThroughHistory: [], leftThroughProtocol: [], gained: [], casesOnlyBefore: 0, casesOnlyAfter: 0 }
  if (before === null) return record
  const diff = diffBaselines(before, after)
  const observed = observe(runs)
  for (const [id, metric] of diff.lost) {
    const entry = observed.get(id)!
    // The first seeding run that doesn't pass the pair.
    const result = entry.results.find(value => value.metrics[metric].status !== 'pass') ?? entry.results[0]!
    const value = result.metrics[metric]
    const coverage = result.coverage[metric]
    record.lost.push({
      id, family: entry.family, metric, status: value.status, reason: value.reason ?? null, detail: value.detail ?? null, run: relative(REPO, runs[result.run]!.path),
      covered: coverage?.covered ?? false, coveringGaps: coverage?.gaps ?? [], residual: result.residual, attribution: null,
    })
  }
  for (const [id, metric] of diff.leftThroughHistory) {
    const entry = observed.get(id)!
    record.leftThroughHistory.push({ id, family: entry.family, metric, difference: entry.historyDependent ?? '', passesNow: entry.results.every(value => value.metrics[metric].status === 'pass') })
  }
  for (const [id, metric] of diff.leftThroughProtocol) {
    const entry = observed.get(id)!
    record.leftThroughProtocol.push({ id, family: entry.family, metric, protocol: entry.protocol ?? '' })
  }
  record.gained = diff.gained
  record.casesOnlyBefore = diff.casesOnlyBefore
  record.casesOnlyAfter = diff.casesOnlyAfter
  return record
}

// Where a seed for `baselinePath` is staged. Seeds are never written over the baseline they replace: the staging folder
// must be given, and can't be the folder the baseline is in.
export function stagedPath(baselinePath: string, staging: string | undefined): string {
  if (staging === undefined || staging === '') fail('--staging=<dir> is required: a seed is written to a staging folder and adopted after review, never over the baseline')
  const folder = resolve(staging)
  if (folder === dirname(resolve(baselinePath))) fail(`--staging=${staging} is the folder the baseline is in; name another folder`)
  return join(folder, basename(baselinePath))
}

// Moves the given protocol rows out of a baseline's passes, cases without passes and unstable pairs (--prune-protocol),
// and returns the pairs that stop being passes.
export function pruneProtocol(baseline: Baseline, protocol: ReadonlyMap<string, string>): { baseline: Baseline; removed: Array<{ id: string; metric: MetricName; reason: string }> } {
  const removed: Array<{ id: string; metric: MetricName; reason: string }> = []
  const passes: Record<string, string[]> = {}
  const passPairs: Record<MetricName, number> = { ...baseline.counts.passPairs }
  for (const [key, ids] of Object.entries(baseline.passes)) {
    const metrics = metricsOf(key, 'baseline')
    const kept: string[] = []
    for (const id of ids) {
      const reason = protocol.get(id)
      if (reason === undefined) {
        kept.push(id)
        continue
      }
      for (const metric of METRIC_ORDER) {
        if (!metrics.has(metric)) continue
        removed.push({ id, metric, reason })
        passPairs[metric]--
      }
    }
    if (kept.length > 0) passes[key] = kept
  }
  const unstable: Record<string, string> = {}
  let unstablePairs = baseline.counts.unstablePairs
  for (const [id, key] of Object.entries(baseline.unstable)) {
    if (protocol.has(id)) unstablePairs -= key.length
    else unstable[id] = key
  }
  const withoutPasses = baseline.withoutPasses.filter(id => !protocol.has(id))
  const known = baselineCases(baseline)
  const own: Record<string, string> = { ...(baseline.protocol ?? {}) }
  for (const [id, reason] of [...protocol].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (known.has(id) && !baseline.historyDependent.includes(id)) own[id] = reason
  return {
    baseline: {
      ...baseline, passes, unstable, withoutPasses, protocol: own,
      counts: { ...baseline.counts, passPairs, withoutPassesCases: withoutPasses.length, unstablePairs, protocolCases: Object.keys(own).length },
    },
    removed,
  }
}

// Protocol rows of the rows files next to a baseline's seeding per-case files, by score.ts slotProtocol.
export async function protocolRowsOf(baseline: Baseline): Promise<{ rows: number; files: string[]; protocol: Map<string, string> }> {
  const protocol = new Map<string, string>()
  const files: string[] = []
  let rows = 0
  for (const seed of baseline.seededFrom) {
    const perCase = resolve(REPO, seed.perCase)
    const browser = perCase.slice(dirname(perCase).length + 1, -PER_CASE.length)
    const rowsPath = existingRows(join(dirname(perCase), `${browser}-rows.ndjson`))
    if (rowsPath === null) fail(`${seed.perCase}: no rows file ${browser}-rows.ndjson (plain or .zst) next to it, so the protocol rule can't run`)
    files.push(relative(REPO, rowsPath))
    for await (const line of readLines(rowsPath)) {
      rows++
      // Only rows with line slots can be protocol rows; the rest aren't parsed.
      if (!line.includes('"lineSlots":[{')) continue
      const row = JSON.parse(line) as LabRow
      if ('error' in row.native || 'skipped' in row.native) continue
      const reason = slotProtocol(row.case, row.native, row.browser, row.env.devicePixelRatio)
      if (reason !== null && !protocol.has(row.id)) protocol.set(row.id, `${relative(REPO, rowsPath)}: ${reason}`)
    }
  }
  return { rows, files, protocol }
}

function describeLost(value: LostPass): string {
  return `  ${value.id} ${value.family} ${value.metric}: ${value.status}${value.reason === null ? '' : ` (${value.reason})`}${value.detail === null ? '' : `: ${value.detail}`} [${value.run}]`
}

async function main(): Promise<number> {
  const USAGE = 'Usage: bun rebuild/lab/gate.ts --baseline=<file> --runs=<per-case file or dir>[,...] [--complete] [--allow-uncompared] [--out=<file>]\n' +
    '       bun rebuild/lab/gate.ts --seed --staging=<dir> --engine=blink|webkit|gecko --engine-version=<label> [--note=<text>] --baseline=<file> --runs=... [--allow-uncompared] [--out=<file>]\n' +
    '       bun rebuild/lab/gate.ts --prune-protocol --staging=<dir> --baseline=<lab gate file or tests gate file> [--out=<file>]'
  const values = new Map<string, string>()
  const runValues: string[] = []
  const switches = new Set<string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
    const name = match?.[1]
    if (match === null || name === undefined) fail(`Unknown argument ${raw}\n${USAGE}`)
    if (['seed', 'complete', 'allow-uncompared', 'prune-protocol'].includes(name)) {
      if (match[2] !== undefined) fail(`--${name} takes no value`)
      switches.add(name)
    } else if (['baseline', 'runs', 'engine', 'engine-version', 'note', 'out', 'staging'].includes(name)) {
      if (match[2] === undefined) fail(`--${name} needs a value`)
      if (name === 'runs') runValues.push(match[2])
      else values.set(name, match[2])
    } else {
      fail(`Unknown argument ${raw}\n${USAGE}`)
    }
  }
  const baselinePath = values.get('baseline')
  const outPath = values.get('out')
  if (baselinePath === undefined) fail(`--baseline is required\n${USAGE}`)

  if (switches.has('prune-protocol')) {
    const resolved = resolve(baselinePath)
    const raw = JSON.parse(readFileSync(resolved, 'utf8')) as { format?: string; families?: { baseline: unknown } }
    const tests = raw.format === 'pretext-tests-gate/1'
    const baseline = parseBaseline(JSON.stringify(tests ? raw.families!.baseline : raw), resolved)
    const found = await protocolRowsOf(baseline)
    const { baseline: pruned, removed } = pruneProtocol(baseline, found.protocol)
    const written = tests ? { ...raw, families: { ...raw.families!, baseline: pruned } } : pruned
    const staged = stagedPath(resolved, values.get('staging'))
    mkdirSync(dirname(staged), { recursive: true })
    writeFileSync(staged, `${JSON.stringify(written, null, 2)}\n`)
    console.log(`pruned ${relative(REPO, resolved)} into ${relative(REPO, staged)}: ${found.rows} seeding rows in ${found.files.length} files, ${found.protocol.size} protocol rows, ${removed.length} pairs removed`)
    for (const value of removed) console.log(`  removed ${value.id} ${value.metric}: protocol row (${value.reason})`)
    if (outPath !== undefined) writeFileSync(resolve(outPath), `${JSON.stringify({ baseline: relative(REPO, resolved), staged: relative(REPO, staged), rows: found.rows, files: found.files, protocol: Object.fromEntries(found.protocol), removed }, null, 2)}\n`)
    return 0
  }

  if (runValues.length === 0) fail(`--runs is required\n${USAGE}`)
  const paths = runPaths(runValues)
  const runs = paths.map(readRun)
  const allowUncompared = switches.has('allow-uncompared')

  if (switches.has('seed')) {
    const engine = values.get('engine') as Engine | undefined
    if (engine === undefined || !(engine in ENGINE_BROWSERS)) fail('--seed needs --engine=blink|webkit|gecko')
    const problems = runProblems(engine, runs, { allowUncompared, environments: null })
    if (problems.length > 0) {
      console.error(problems.join('\n'))
      return 2
    }
    const resolved = resolve(baselinePath)
    const staged = stagedPath(resolved, values.get('staging'))
    const baseline = seedBaseline(runs, { engine, engineVersion: values.get('engine-version') ?? '', note: values.get('note') ?? '' })
    const before = existsSync(resolved) ? parseBaseline(readFileSync(resolved, 'utf8'), resolved) : null
    const record = seedRecord(before, baseline, runs, { staged: relative(REPO, staged), against: relative(REPO, resolved) })
    mkdirSync(dirname(staged), { recursive: true })
    writeFileSync(staged, formatBaseline(baseline))
    const recordPath = `${staged.replace(/\.json$/, '')}.seed-record.json`
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
    const pairs = Object.values(baseline.counts.passPairs).reduce((sum, n) => sum + n, 0)
    console.log(`staged ${relative(REPO, staged)} (not adopted; the baseline ${relative(REPO, resolved)} is unchanged): ${baseline.engineVersion}, ${runs.length} runs, ${baseline.counts.cases} cases, ${pairs} pass pairs (${METRIC_ORDER.map(metric => `${metric} ${baseline.counts.passPairs[metric]}`).join(', ')}), ${baseline.counts.historyDependentCases} history-dependent cases, ${baseline.counts.protocolCases ?? 0} protocol rows, ${baseline.counts.withoutPassesCases} cases without passes, ${baseline.counts.unstablePairs} unstable pairs`)
    if (before === null) {
      console.log(`no baseline at ${relative(REPO, resolved)} to compare with`)
    } else {
      const uncovered = record.lost.filter(value => !value.covered).length
      console.log(`against ${relative(REPO, resolved)}: ${record.lost.length} pairs lost (${uncovered} without a covered explanation), ${record.leftThroughHistory.length} leave through new history dependence (${record.leftThroughHistory.filter(value => value.passesNow).length} of them pass now), ${record.leftThroughProtocol.length} leave as protocol rows, ${record.gained.length} gained, ${record.casesOnlyBefore} cases only before, ${record.casesOnlyAfter} only now`)
      for (const value of record.lost.slice(0, 20)) console.log(`  lost ${value.id} ${value.metric}: ${value.status}${value.covered ? ` (covered by ${value.coveringGaps.join(', ')})` : ' (no covered explanation)'}${value.residual === null ? '' : ` [${value.residual}]`}`)
      for (const value of record.leftThroughHistory.slice(0, 20)) console.log(`  left through history dependence ${value.id} ${value.metric}${value.passesNow ? ' (passes now)' : ''}`)
    }
    console.log(`record: ${relative(REPO, recordPath)}`)
    if (outPath !== undefined) writeFileSync(resolve(outPath), `${JSON.stringify(record, null, 2)}\n`)
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
  console.log(`  lost passes ${c.lostPairs}; new passes ${c.newPairs}; history-dependent cases ${c.historyDependentCases} (never gate; ${c.leftThroughHistoryPairs ?? 0} baseline passes left through new history dependence); protocol rows ${c.protocolCases} (never gate); unstable pairs ${c.unstablePairs} (never gate); missing cases ${c.missingCases} (${c.missingPairs} pass pairs${switches.has('complete') ? ', gating' : ', not gating without --complete'})`)
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
