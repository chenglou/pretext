import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type BrowserKind,
  type BrowserSession,
} from './browser-automation.ts'

import { environmentFailure, parseBrowserEnvironmentReport } from '../shared/browser-environment.ts'
import type { BenchmarkResult, CorpusBenchmarkResult, BenchmarkRun, BenchmarkSummary, BenchmarkResults } from '../shared/benchmark-report.ts'

const BENCHMARK_RESULT_KEYS = [
  'results',
  'richResults',
  'richInlineResults',
  'richPreWrapResults',
  'richLongResults',
] as const

const CORPUS_TIMING_KEYS = [
  'analysisMs',
  'measureMs',
  'prepareMs',
  'layoutMs',
] as const

const CORPUS_METADATA_KEYS = [
  'id',
  'label',
  'font',
  'chars',
  'analysisSegments',
  'segments',
  'breakableSegments',
  'width',
  'lineCount',
] as const

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for --${name}: ${raw}`)
  }
  return parsed
}

function parseBrowser(value: string | null): BrowserKind {
  const browser = (value ?? process.env['BENCHMARK_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
  if (browser !== 'chrome' && browser !== 'safari') {
    throw new Error(`Unsupported browser ${browser}; expected chrome or safari`)
  }
  return browser
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function assertSame<T>(actual: T, expected: T, context: string): void {
  if (actual === expected) return
  throw new Error(
    `Benchmark runs disagree for ${context}: expected ${String(expected)}, got ${String(actual)}`,
  )
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Missing ${context}`)
  return value as Record<string, unknown>
}

function text(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${context}`)
  return value
}

function nonnegative(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${context}: expected a finite nonnegative number`)
  return value
}

function rows(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Incomplete benchmark report: missing ${context}`)
  return value
}

function benchmarkRows(value: unknown, context: string): BenchmarkResult[] {
  return rows(value, context).map((value, index) => {
    const row = record(value, `${context}[${index}]`)
    return { label: text(row['label'], `${context}.label`), desc: text(row['desc'], `${context}.desc`), ms: nonnegative(row['ms'], `${context}.ms`) }
  })
}

// The browser is the report boundary. Everything after this function receives
// complete runs, so aggregation never needs a second optional-section protocol.
export function parseBenchmarkRun(value: unknown, expectedRequestId: string): BenchmarkRun {
  const report = record(value, 'benchmark report')
  if (report['status'] === 'error') throw new Error(text(report['message'], 'benchmark error message'))
  if (report['status'] !== 'ready') throw new Error('Benchmark report is not ready')
  if (report['requestId'] !== expectedRequestId || expectedRequestId.length === 0) throw new Error('Benchmark report has the wrong request identity')
  const environment = parseBrowserEnvironmentReport(report['environment'])
  const failure = environmentFailure(environment, 'benchmark')
  if (failure !== null) throw new Error(failure)
  const corpusResults = rows(report['corpusResults'], 'corpusResults').map((value, index) => {
    const row = record(value, `corpusResults[${index}]`)
    return {
      id: text(row['id'], 'corpusResults.id'), label: text(row['label'], 'corpusResults.label'), font: text(row['font'], 'corpusResults.font'),
      chars: nonnegative(row['chars'], 'corpusResults.chars'), analysisSegments: nonnegative(row['analysisSegments'], 'corpusResults.analysisSegments'),
      segments: nonnegative(row['segments'], 'corpusResults.segments'), breakableSegments: nonnegative(row['breakableSegments'], 'corpusResults.breakableSegments'),
      width: nonnegative(row['width'], 'corpusResults.width'), lineCount: nonnegative(row['lineCount'], 'corpusResults.lineCount'),
      analysisMs: nonnegative(row['analysisMs'], 'corpusResults.analysisMs'), measureMs: nonnegative(row['measureMs'], 'corpusResults.measureMs'),
      prepareMs: nonnegative(row['prepareMs'], 'corpusResults.prepareMs'), layoutMs: nonnegative(row['layoutMs'], 'corpusResults.layoutMs'),
    }
  })
  return {
    status: 'ready', requestId: expectedRequestId, environment, corpusResults,
    results: benchmarkRows(report['results'], 'results'), richResults: benchmarkRows(report['richResults'], 'richResults'),
    richInlineResults: benchmarkRows(report['richInlineResults'], 'richInlineResults'), richPreWrapResults: benchmarkRows(report['richPreWrapResults'], 'richPreWrapResults'),
    richLongResults: benchmarkRows(report['richLongResults'], 'richLongResults'),
  }
}

function medianBenchmarkResults(reports: BenchmarkRun[], key: typeof BENCHMARK_RESULT_KEYS[number]): BenchmarkResult[] {
  const firstRows = reports[0]![key]
  for (const report of reports) assertSame(report[key].length, firstRows.length, `${key}.length`)
  return firstRows.map((firstRow, rowIndex) => {
    const values: number[] = []
    for (const report of reports) {
      const row = report[key][rowIndex]!
      assertSame(row.label, firstRow.label, `${key}[${rowIndex}].label`)
      assertSame(row.desc, firstRow.desc, `${key}[${rowIndex}].desc`)
      values.push(row.ms)
    }
    return { ...firstRow, ms: median(values) }
  })
}

function medianCorpusResults(reports: BenchmarkRun[]): CorpusBenchmarkResult[] {
  const firstRows = reports[0]!.corpusResults
  for (const report of reports) assertSame(report.corpusResults.length, firstRows.length, 'corpusResults.length')
  return firstRows.map((firstRow, rowIndex) => {
    const result: CorpusBenchmarkResult = { ...firstRow }
    for (const report of reports) {
      const row = report.corpusResults[rowIndex]!
      for (const key of CORPUS_METADATA_KEYS) assertSame(row[key], firstRow[key], `corpusResults[${rowIndex}].${key}`)
    }
    for (const key of CORPUS_TIMING_KEYS) result[key] = median(reports.map(report => report.corpusResults[rowIndex]![key]))
    return result
  })
}

export function medianReport(reports: BenchmarkRun[]): BenchmarkSummary {
  const first = reports[0]
  if (first === undefined) throw new Error('Cannot summarize zero benchmark runs')
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index]!
    if (reports.slice(0, index).some(previous => previous.requestId === report.requestId)) throw new Error(`Duplicate benchmark request ${report.requestId}`)
    assertSame(report.environment.userAgent, first.environment.userAgent, 'environment.userAgent')
    for (const key of Object.keys(first.environment.start) as Array<keyof typeof first.environment.start>) {
      assertSame(report.environment.start[key], first.environment.start[key], `environment.${key}`)
    }
  }
  return {
    status: 'ready', runs: reports,
    results: medianBenchmarkResults(reports, 'results'), richResults: medianBenchmarkResults(reports, 'richResults'),
    richInlineResults: medianBenchmarkResults(reports, 'richInlineResults'), richPreWrapResults: medianBenchmarkResults(reports, 'richPreWrapResults'),
    richLongResults: medianBenchmarkResults(reports, 'richLongResults'), corpusResults: medianCorpusResults(reports),
  }
}

function printReport(report: BenchmarkResults): void {

  console.log('Top-level batch benchmark:')
  for (const result of report.results) {
    console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
  }

  if (report.richResults.length > 0) {
    console.log('Rich line APIs (shared corpus):')
    for (const result of report.richResults) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if (report.richInlineResults.length > 0) {
    console.log('Rich-inline APIs (mixed inline shared corpus):')
    for (const result of report.richInlineResults) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if (report.richPreWrapResults.length > 0) {
    console.log('Rich line APIs (pre-wrap chunk stress):')
    for (const result of report.richPreWrapResults) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if (report.richLongResults.length > 0) {
    console.log('Rich line APIs (Arabic long-form stress):')
    for (const result of report.richLongResults) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if (report.corpusResults.length > 0) {
    console.log('Long-form corpus stress:')
    for (const corpus of report.corpusResults) {
      console.log(
        `  ${corpus.label}: analyze ${corpus.analysisMs.toFixed(2)}ms | measure ${corpus.measureMs.toFixed(2)}ms | prepare ${corpus.prepareMs.toFixed(2)}ms | layout ${corpus.layoutMs < 0.01 ? '<0.01' : corpus.layoutMs.toFixed(2)}ms | ${corpus.analysisSegments.toLocaleString()}→${corpus.segments.toLocaleString()} segs | ${corpus.lineCount} lines @ ${corpus.width}px`,
      )
    }
  }
}

function saveFailure(output: string | null, browser: BrowserKind, requestId: string, error: unknown, report: unknown, runs: BenchmarkRun[]): void {
  const file = output === null ? join('.artifacts', 'benchmarks', `${browser}-${requestId}.failed.json`) : `${output}.failed.json`
  const failure = { status: 'error', message: error instanceof Error ? error.stack ?? error.message : String(error), requestId, report, runs }
  const environment = typeof report === 'object' && report !== null && 'environment' in report ? report.environment : runs.map(run => run.environment)
  console.log(`Failed benchmark environment: ${JSON.stringify(environment)}`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(failure, null, 2) + '\n')
  console.log(`Failed benchmark report: ${file}`)
}

async function main(): Promise<void> {
  const browser = parseBrowser(parseStringFlag('browser'))
  const requestedPort = parseNumberFlag('port', Number.parseInt(process.env['BENCHMARK_CHECK_PORT'] ?? '0', 10))
  const runs = parseNumberFlag('runs', Number.parseInt(process.env['BENCHMARK_CHECK_RUNS'] ?? '3', 10))
  const output = parseStringFlag('output')

  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`Invalid value for --runs: ${runs}; expected an integer >= 1`)
  }

  let serverProcess: ChildProcess | null = null
  const lock = await acquireBrowserAutomationLock(browser)
  let session: BrowserSession | null = null

  try {
    session = createBrowserSession(browser, { foreground: true })
    const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
    const pageServer = await ensurePageServer(port, '/benchmark', process.cwd())
    serverProcess = pageServer.process
    const baseUrl = `${pageServer.baseUrl}/benchmark`

    const reports: BenchmarkRun[] = []
    for (let runIndex = 0; runIndex < runs; runIndex++) {
      const requestId = `${Date.now()}-${runIndex}-${Math.random().toString(36).slice(2)}`
      const url =
        `${baseUrl}?report=1` +
        `&requestId=${encodeURIComponent(requestId)}`

      if (runs > 1) {
        console.log(`Benchmark run ${runIndex + 1}/${runs}:`)
      }
      let raw: unknown = null
      let report: BenchmarkRun
      try {
        raw = await loadHashReport<{ requestId?: string }>(session, url, requestId, browser)
        report = parseBenchmarkRun(raw, requestId)
      } catch (error) {
        saveFailure(output, browser, requestId, error, raw, reports)
        throw error
      }
      const state = report.environment.start
      console.log(`Environment: DPR ${state.dpr}; screen ${state.screenWidth}×${state.screenHeight}; viewport ${state.innerWidth}×${state.innerHeight}; visible and focused`)
      reports.push(report)
      if (runs > 1) {
        printReport(report)
      }
    }

    let report: BenchmarkSummary
    try { report = medianReport(reports) } catch (error) {
      saveFailure(output, browser, `${reports[0]!.requestId}-aggregate`, error, null, reports)
      throw error
    }
    if (runs > 1) {
      console.log(`Median across ${runs} benchmark runs:`)
    }
    printReport(report)

    if (output !== null) {
      writeFileSync(output, JSON.stringify(report, null, 2))
      console.log(`wrote ${output}`)
    }

  } finally {
    try {
      await session?.close()
    } finally {
      serverProcess?.kill()
      lock.release()
    }
  }
}

if (import.meta.main) await main()
