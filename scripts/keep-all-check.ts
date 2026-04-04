import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type AutomationBrowserKind,
  type BrowserKind,
} from './browser-automation.ts'

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

type OracleCase = {
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  lang: string
  dir?: 'ltr' | 'rtl'
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

const ORACLE_CASES: OracleCase[] = [
  {
    label: 'mixed latin plus cjk',
    text: 'A 中文测试',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    lang: 'zh',
  },
  {
    label: 'cjk punctuation boundary',
    text: '中文，测试。下一句。',
    width: 190,
    font: '18px serif',
    lineHeight: 32,
    lang: 'zh',
  },
  {
    label: 'korean no-space word',
    text: '한국어테스트 테스트입니다',
    width: 220,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'mixed no-space cjk plus latin run',
    text: '日本語foo-bar',
    width: 110,
    font: '18px serif',
    lineHeight: 32,
    lang: 'ja',
  },
]

const requestedPort = parseNumberFlag('port', 0)
const browsers = parseBrowsers(parseStringFlag('browser'))
const timeoutMs = parseNumberFlag('timeout', 60_000)

function buildProbeUrl(baseUrl: string, requestId: string, testCase: OracleCase): string {
  const dir = testCase.dir ?? 'ltr'
  return (
    `${baseUrl}/probe?text=${encodeURIComponent(testCase.text)}` +
    `&width=${testCase.width}` +
    `&font=${encodeURIComponent(testCase.font)}` +
    `&lineHeight=${testCase.lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(testCase.lang)}` +
    `&wordBreak=keep-all` +
    `&method=span` +
    `&requestId=${encodeURIComponent(requestId)}`
  )
}

function printCaseResult(browser: AutomationBrowserKind, testCase: OracleCase, report: ProbeReport): void {
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

async function runBrowser(browser: AutomationBrowserKind, port: number): Promise<boolean> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  const session = reportBrowser === null ? null : createBrowserSession(reportBrowser)
  let serverProcess: ChildProcess | null = null
  let ok = true

  try {
    if (session === null || reportBrowser === null) {
      throw new Error('Firefox is not currently supported for keep-all oracle checks')
    }

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process

    for (const testCase of ORACLE_CASES) {
      const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const url = buildProbeUrl(pageServer.baseUrl, requestId, testCase)
      const report = await loadHashReport<ProbeReport>(session, url, requestId, reportBrowser, timeoutMs)
      printCaseResult(browser, testCase, report)
      if (!reportIsExact(report)) ok = false
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
