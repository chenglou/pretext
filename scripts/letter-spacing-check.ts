import { type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadPostedReport,
  type AutomationBrowserKind,
  type BrowserKind,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'
import { LETTER_SPACING_ORACLE_CASES, type LetterSpacingOracleCase } from '../src/test-data.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    deltaText: string
    reasonGuess: string
    oursText: string
    browserText: string
  } | null
  extractorSensitivity?: string | null
  message?: string
}

type OracleResult = {
  browser: AutomationBrowserKind
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  letterSpacing: number
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
  dir: 'ltr' | 'rtl'
  lang: string
  method: 'range' | 'span'
  status: ProbeReport['status']
  predictedHeight: number | null
  actualHeight: number | null
  diffPx: number | null
  predictedLineCount: number | null
  browserLineCount: number | null
  geometryMatches: boolean
  firstBreakMismatch: ProbeReport['firstBreakMismatch']
  extractorSensitivity: string | null
  message: string | null
}

type OracleSnapshot = {
  generatedAt: string
  browsers: AutomationBrowserKind[]
  total: number
  geometryMatchCount: number
  geometryMismatchCount: number
  firstBreakMismatchCount: number
  cases: Array<{
    label: string
    width: number
    font: string
    lineHeight: number
    letterSpacing: number
    whiteSpace: 'normal' | 'pre-wrap'
    wordBreak: 'normal' | 'keep-all'
    dir: 'ltr' | 'rtl'
    lang: string
    method: 'range' | 'span'
  }>
  results: OracleResult[]
}

type ProbeBatchReport = {
  status: 'ready' | 'error'
  requestId?: string
  results?: Array<{
    label: string
    report: ProbeReport
  }>
  message?: string
}

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowsers(value: string | null): AutomationBrowserKind[] {
  const raw = (value ?? 'chrome,safari').trim()
  if (raw.length === 0) return ['chrome', 'safari']

  const browsers = raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

  for (const browser of browsers) {
    if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox') {
      throw new Error(`Unsupported browser ${browser}`)
    }
  }

  return browsers as AutomationBrowserKind[]
}

const requestedPort = parseNumberFlag('port', 0)
const browsers = parseBrowsers(parseStringFlag('browser'))
const timeoutMs = parseNumberFlag('timeout', 60_000)
const output = parseStringFlag('output')

function materializeCase(testCase: LetterSpacingOracleCase): OracleSnapshot['cases'][number] & { text: string } {
  const dir = testCase.dir ?? 'ltr'
  return {
    label: testCase.label,
    text: testCase.text,
    width: testCase.width,
    font: testCase.font,
    lineHeight: testCase.lineHeight,
    letterSpacing: testCase.letterSpacing,
    whiteSpace: testCase.whiteSpace ?? 'normal',
    wordBreak: testCase.wordBreak ?? 'normal',
    dir,
    lang: testCase.lang ?? (dir === 'rtl' ? 'ar' : 'en'),
    method: testCase.method ?? 'range',
  }
}

function printCaseResult(browser: AutomationBrowserKind, testCase: LetterSpacingOracleCase, report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`${browser} | ${testCase.label}: error: ${report.message ?? 'unknown error'}`)
    return
  }

  const sensitivity =
    report.extractorSensitivity === null || report.extractorSensitivity === undefined
      ? ''
      : ` | note: ${report.extractorSensitivity}`

  console.log(
    `${browser} | ${testCase.label}: diff ${report.diffPx}px | lines ${report.predictedLineCount}/${report.browserLineCount} | height ${report.predictedHeight}/${report.actualHeight}${sensitivity}`,
  )

  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    console.log(
      `  break L${report.firstBreakMismatch.line}: ${report.firstBreakMismatch.reasonGuess} | ` +
      `delta ${JSON.stringify(report.firstBreakMismatch.deltaText)} | ` +
      `ours ${JSON.stringify(report.firstBreakMismatch.oursText)} | ` +
      `browser ${JSON.stringify(report.firstBreakMismatch.browserText)}`,
    )
  }
}

function reportIsExact(report: ProbeReport): boolean {
  return (
    report.status === 'ready' &&
    report.diffPx === 0 &&
    report.predictedLineCount === report.browserLineCount &&
    report.predictedHeight === report.actualHeight
  )
}

function toOracleResult(browser: AutomationBrowserKind, testCase: LetterSpacingOracleCase, report: ProbeReport): OracleResult {
  const materialized = materializeCase(testCase)
  const geometryMatches = reportIsExact(report)
  return {
    browser,
    ...materialized,
    status: report.status,
    predictedHeight: report.predictedHeight ?? null,
    actualHeight: report.actualHeight ?? null,
    diffPx: report.diffPx ?? null,
    predictedLineCount: report.predictedLineCount ?? null,
    browserLineCount: report.browserLineCount ?? null,
    geometryMatches,
    firstBreakMismatch: report.firstBreakMismatch ?? null,
    extractorSensitivity: report.extractorSensitivity ?? null,
    message: report.message ?? null,
  }
}

async function runBrowser(browser: AutomationBrowserKind, port: number): Promise<OracleResult[]> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  const session = reportBrowser === null ? null : createBrowserSession(reportBrowser)
  let serverProcess: ChildProcess | null = null
  const results: OracleResult[] = []

  try {
    if (session === null || reportBrowser === null) {
      throw new Error('Firefox is not currently supported for letter-spacing oracle checks')
    }

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process
    const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const reportServer = await startPostedReportServer<ProbeBatchReport>(requestId)

    try {
      const url =
        `${pageServer.baseUrl}/probe?batch=letter-spacing` +
        `&requestId=${encodeURIComponent(requestId)}` +
        `&reportEndpoint=${encodeURIComponent(reportServer.endpoint)}`
      const batchReport = await loadPostedReport(
        session,
        url,
        () => reportServer.waitForReport(null),
        requestId,
        reportBrowser,
        timeoutMs,
      )
      if (batchReport.status === 'error') {
        throw new Error(batchReport.message ?? 'letter-spacing batch failed')
      }

      const batchResults = batchReport.results ?? []
      const reportsByLabel = new Map(batchResults.map(result => [result.label, result.report]))
      for (const testCase of LETTER_SPACING_ORACLE_CASES) {
        const report = reportsByLabel.get(testCase.label)
        if (report === undefined) {
          throw new Error(`Missing letter-spacing result for ${testCase.label}`)
        }
        printCaseResult(browser, testCase, report)
        results.push(toOracleResult(browser, testCase, report))
      }
    } finally {
      reportServer.close()
    }
  } finally {
    session?.close()
    serverProcess?.kill()
    lock.release()
  }

  return results
}

function buildSnapshot(results: OracleResult[]): OracleSnapshot {
  const geometryMatchCount = results.filter(result => result.geometryMatches).length
  const firstBreakMismatchCount = results.filter(result => result.firstBreakMismatch !== null).length
  return {
    generatedAt: new Date().toISOString(),
    browsers,
    total: results.length,
    geometryMatchCount,
    geometryMismatchCount: results.length - geometryMatchCount,
    firstBreakMismatchCount,
    cases: LETTER_SPACING_ORACLE_CASES.map(testCase => {
      const { text: _text, ...rest } = materializeCase(testCase)
      return rest
    }),
    results,
  }
}

const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
const results: OracleResult[] = []
for (const browser of browsers) {
  results.push(...await runBrowser(browser, port))
}

const snapshot = buildSnapshot(results)
if (output !== null) {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`wrote ${output}`)
}

if (snapshot.geometryMismatchCount > 0) process.exitCode = 1
