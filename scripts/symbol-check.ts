import { type ChildProcess } from 'node:child_process'
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
import { SYMBOL_ORACLE_CASES, type ProbeOracleCase } from '../src/test-data.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  browserLineMethod?: 'range' | 'span'
  width?: number
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

function printCaseResult(browser: AutomationBrowserKind, testCase: ProbeOracleCase, report: ProbeReport): void {
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
    report.predictedHeight === report.actualHeight &&
    report.firstBreakMismatch === null
  )
}

function caseRunsInBrowser(testCase: ProbeOracleCase, browser: AutomationBrowserKind): boolean {
  return testCase.browsers === undefined || testCase.browsers.includes(browser)
}

async function runBrowser(browser: AutomationBrowserKind, port: number): Promise<boolean> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  const session = reportBrowser === null ? null : createBrowserSession(reportBrowser)
  let serverProcess: ChildProcess | null = null
  let ok = true

  try {
    if (session === null || reportBrowser === null) {
      throw new Error('Firefox is not currently supported for symbol oracle checks')
    }

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process
    const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const reportServer = await startPostedReportServer<ProbeBatchReport>(requestId)

    try {
      const url =
        `${pageServer.baseUrl}/probe?batch=symbol-runs` +
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
        throw new Error(batchReport.message ?? 'symbol batch failed')
      }

      const batchResults = batchReport.results ?? []
      const reportsByLabel = new Map(batchResults.map(result => [result.label, result.report]))
      for (const testCase of SYMBOL_ORACLE_CASES) {
        if (!caseRunsInBrowser(testCase, browser)) continue
        const report = reportsByLabel.get(testCase.label)
        if (report === undefined) {
          throw new Error(`Missing symbol result for ${testCase.label}`)
        }
        printCaseResult(browser, testCase, report)
        if (!reportIsExact(report)) ok = false
      }
    } finally {
      reportServer.close()
    }
  } finally {
    session?.close()
    serverProcess?.kill()
    lock.release()
  }

  return ok
}

const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
let overallOk = true
for (const browser of browsers) {
  const browserOk = await runBrowser(browser, port)
  if (!browserOk) overallOk = false
}

if (!overallOk) process.exitCode = 1
