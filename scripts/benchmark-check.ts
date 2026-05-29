import { writeFileSync } from 'node:fs'
import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type BrowserKind,
} from './browser-automation.ts'

type BenchmarkResult = {
  label: string
  ms: number
  desc: string
}

type CorpusBenchmarkResult = {
  id: string
  label: string
  font: string
  chars: number
  analysisSegments: number
  segments: number
  breakableSegments: number
  width: number
  lineCount: number
  analysisMs: number
  measureMs: number
  prepareMs: number
  layoutMs: number
}

type BenchmarkReport = {
  status: 'ready' | 'error'
  requestId?: string
  results?: BenchmarkResult[]
  richResults?: BenchmarkResult[]
  richInlineResults?: BenchmarkResult[]
  richPreWrapResults?: BenchmarkResult[]
  richLongResults?: BenchmarkResult[]
  corpusResults?: CorpusBenchmarkResult[]
  message?: string
}

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

function medianBenchmarkResults(
  reports: BenchmarkReport[],
  key: typeof BENCHMARK_RESULT_KEYS[number],
): BenchmarkResult[] | undefined {
  const firstRows = reports[0]?.[key]
  if (firstRows === undefined) {
    for (let reportIndex = 1; reportIndex < reports.length; reportIndex++) {
      assertSame(reports[reportIndex]![key], undefined, `${key}`)
    }
    return undefined
  }
  for (let reportIndex = 1; reportIndex < reports.length; reportIndex++) {
    assertSame(reports[reportIndex]![key]?.length, firstRows.length, `${key}.length`)
  }

  return firstRows.map((firstRow, rowIndex) => {
    const values: number[] = []
    for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
      const row = reports[reportIndex]![key]?.[rowIndex]
      if (row === undefined) {
        throw new Error(`Benchmark run ${reportIndex + 1} is missing ${key}[${rowIndex}]`)
      }
      assertSame(row.label, firstRow.label, `${key}[${rowIndex}].label`)
      assertSame(row.desc, firstRow.desc, `${key}[${rowIndex}].desc`)
      values.push(row.ms)
    }
    return {
      ...firstRow,
      ms: median(values),
    }
  })
}

function medianCorpusResults(reports: BenchmarkReport[]): CorpusBenchmarkResult[] | undefined {
  const firstRows = reports[0]?.corpusResults
  if (firstRows === undefined) {
    for (let reportIndex = 1; reportIndex < reports.length; reportIndex++) {
      assertSame(reports[reportIndex]!.corpusResults, undefined, 'corpusResults')
    }
    return undefined
  }
  for (let reportIndex = 1; reportIndex < reports.length; reportIndex++) {
    assertSame(reports[reportIndex]!.corpusResults?.length, firstRows.length, 'corpusResults.length')
  }

  return firstRows.map((firstRow, rowIndex) => {
    const result: CorpusBenchmarkResult = { ...firstRow }
    for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
      const row = reports[reportIndex]!.corpusResults?.[rowIndex]
      if (row === undefined) {
        throw new Error(`Benchmark run ${reportIndex + 1} is missing corpusResults[${rowIndex}]`)
      }
      for (const metadataKey of CORPUS_METADATA_KEYS) {
        assertSame(
          row[metadataKey],
          firstRow[metadataKey],
          `corpusResults[${rowIndex}].${metadataKey}`,
        )
      }
    }

    for (const timingKey of CORPUS_TIMING_KEYS) {
      result[timingKey] = median(reports.map(report => report.corpusResults![rowIndex]![timingKey]))
    }

    return result
  })
}

function medianReport(reports: BenchmarkReport[]): BenchmarkReport {
  if (reports.length === 0) {
    throw new Error('Cannot summarize zero benchmark runs')
  }

  for (const [index, report] of reports.entries()) {
    if (report.status === 'error') {
      throw new Error(`Benchmark run ${index + 1} failed: ${report.message ?? 'unknown error'}`)
    }
  }

  const report: BenchmarkReport = { status: 'ready' }

  for (const key of BENCHMARK_RESULT_KEYS) {
    const rows = medianBenchmarkResults(reports, key)
    if (rows !== undefined) report[key] = rows
  }

  const corpusResults = medianCorpusResults(reports)
  if (corpusResults !== undefined) report.corpusResults = corpusResults

  return report
}

function printReport(report: BenchmarkReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  console.log('Top-level batch benchmark:')
  for (const result of report.results ?? []) {
    console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
  }

  if ((report.richResults ?? []).length > 0) {
    console.log('Rich line APIs (shared corpus):')
    for (const result of report.richResults ?? []) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if ((report.richInlineResults ?? []).length > 0) {
    console.log('Rich-inline APIs (mixed inline shared corpus):')
    for (const result of report.richInlineResults ?? []) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if ((report.richPreWrapResults ?? []).length > 0) {
    console.log('Rich line APIs (pre-wrap chunk stress):')
    for (const result of report.richPreWrapResults ?? []) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if ((report.richLongResults ?? []).length > 0) {
    console.log('Rich line APIs (Arabic long-form stress):')
    for (const result of report.richLongResults ?? []) {
      console.log(`  ${result.label}: ${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}ms`)
    }
  }

  if ((report.corpusResults ?? []).length > 0) {
    console.log('Long-form corpus stress:')
    for (const corpus of report.corpusResults!) {
      console.log(
        `  ${corpus.label}: analyze ${corpus.analysisMs.toFixed(2)}ms | measure ${corpus.measureMs.toFixed(2)}ms | prepare ${corpus.prepareMs.toFixed(2)}ms | layout ${corpus.layoutMs < 0.01 ? '<0.01' : corpus.layoutMs.toFixed(2)}ms | ${corpus.analysisSegments.toLocaleString()}→${corpus.segments.toLocaleString()} segs | ${corpus.lineCount} lines @ ${corpus.width}px`,
      )
    }
  }
}

const browser = parseBrowser(parseStringFlag('browser'))
const requestedPort = parseNumberFlag('port', Number.parseInt(process.env['BENCHMARK_CHECK_PORT'] ?? '0', 10))
const runs = parseNumberFlag('runs', Number.parseInt(process.env['BENCHMARK_CHECK_RUNS'] ?? '3', 10))
const output = parseStringFlag('output')

if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`Invalid value for --runs: ${runs}; expected an integer >= 1`)
}

let serverProcess: ChildProcess | null = null
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser, { foreground: true })

try {
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  const pageServer = await ensurePageServer(port, '/benchmark', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/benchmark`

  const reports: BenchmarkReport[] = []
  for (let runIndex = 0; runIndex < runs; runIndex++) {
    const requestId = `${Date.now()}-${runIndex}-${Math.random().toString(36).slice(2)}`
    const url =
      `${baseUrl}?report=1` +
      `&requestId=${encodeURIComponent(requestId)}`

    if (runs > 1) {
      console.log(`Benchmark run ${runIndex + 1}/${runs}:`)
    }
    const report = await loadHashReport<BenchmarkReport>(session, url, requestId, browser)
    reports.push(report)
    if (runs > 1) {
      printReport(report)
    }
  }

  const report = medianReport(reports)
  if (runs > 1) {
    console.log(`Median across ${runs} benchmark runs:`)
  }
  printReport(report)

  if (output !== null) {
    writeFileSync(output, JSON.stringify(report, null, 2))
    console.log(`wrote ${output}`)
  }

  if (report.status === 'error') {
    process.exitCode = 1
  }
} finally {
  session.close()
  serverProcess?.kill()
  lock.release()
}
