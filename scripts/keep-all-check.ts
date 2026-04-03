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
  extractorSensitivity?: string | null
  firstBreakMismatch?: { oursText: string; browserText: string; line: number } | null
  message?: string
}

type OracleCase = {
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  dir?: 'ltr' | 'rtl'
  lang?: string
  whiteSpace?: 'pre-wrap'
  expectedFirstBreakMismatch?: {
    browser: AutomationBrowserKind // only this browser gets the exemption
    line: number // 1-based line number of the first differing line (later-line divergences are not caught)
    oursText: string // our engine's text for that line
    browserText: string // the browser's text for that line
  }
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
    if (browser === 'firefox') {
      throw new Error('Firefox is not supported for keep-all oracle checks')
    }
  }

  return browsers as AutomationBrowserKind[]
}

const ORACLE_CASES: OracleCase[] = [
  {
    label: 'korean spaces',
    text: '이것은 텍스트 레이아웃 라이브러리의 테스트입니다',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'korean narrow',
    text: '안녕하세요 세계입니다',
    width: 160,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'korean two words',
    text: '안녕하세요 세계',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'korean mixed english',
    text: '한국어 English 텍스트 test',
    width: 180,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'korean punctuation',
    text: '안녕하세요, 세계입니다. 반갑습니다!',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'chinese no spaces',
    text: '这是一段中文文本用于测试',
    width: 160,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'chinese with spaces',
    text: '你好 世界 测试',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'japanese',
    text: 'これはテストです',
    width: 120,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'japanese mixed',
    text: '日本語とEnglishの混合テスト',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'cjk punctuation',
    text: '世界。新しい',
    width: 180,
    font: '18px serif',
    lineHeight: 32,
    // Chrome-aligned: keep-all spec only keeps CJK letters together; 。 allows a break after it.
    // Safari keeps the whole run and grapheme-fallback splits it differently.
    expectedFirstBreakMismatch: { browser: 'safari', line: 1, oursText: '世界。', browserText: '世界。新し' },
  },
  {
    label: 'latin unchanged',
    text: 'The quick brown fox jumps over the lazy dog',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'cjk hyphen latin',
    text: '日本語foo-bar',
    width: 180,
    font: '18px serif',
    lineHeight: 32,
    // Chrome-aligned: keep-all spec allows Latin word breaks; Chrome correctly breaks at foo-|bar.
    // Safari breaks inside the Latin word (foo-b|ar).
    expectedFirstBreakMismatch: { browser: 'safari', line: 1, oursText: '日本語foo-', browserText: '日本語foo-b' },
  },
  {
    label: 'latin hyphen cjk height',
    text: 'foo-bar日本語',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'cjk em-dash cjk',
    text: '日本語—テスト',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    // Chrome-aligned: em-dash is non-word-like and is a break opportunity between CJK runs.
    // Safari keeps the whole run and grapheme-fallback splits it differently.
    expectedFirstBreakMismatch: { browser: 'safari', line: 2, oursText: '—', browserText: '—テス' },
  },
  {
    label: 'kinsoku opening bracket',
    text: '」「テスト」「です',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
  },
  {
    label: 'kinsoku period',
    text: '日本語。世界。テスト',
    width: 140,
    font: '18px serif',
    lineHeight: 32,
    // Same divergence as cjk punctuation: Chrome allows breaks after CJK 。; Safari does not.
    expectedFirstBreakMismatch: { browser: 'safari', line: 2, oursText: '。', browserText: '。世界' },
  },
  {
    label: 'korean pre-wrap compose',
    text: '안녕\n세계입니다',
    width: 200,
    font: '18px serif',
    lineHeight: 32,
    whiteSpace: 'pre-wrap',
  },
]

const requestedPort = parseNumberFlag('port', 0)
const browsers = parseBrowsers(parseStringFlag('browser'))
const timeoutMs = parseNumberFlag('timeout', 60_000)

function buildProbeUrl(
  baseUrl: string,
  requestId: string,
  testCase: OracleCase,
  browser: AutomationBrowserKind,
): string {
  const dir = testCase.dir ?? 'ltr'
  const lang = testCase.lang ?? (dir === 'rtl' ? 'ar' : 'en')
  // Safari Range extraction over-advances on CJK keep-all text; use span there.
  const method = testCase.whiteSpace === 'pre-wrap' || browser === 'safari' ? 'span' : 'range'
  let url =
    `${baseUrl}/probe?text=${encodeURIComponent(testCase.text)}` +
    `&width=${testCase.width}` +
    `&font=${encodeURIComponent(testCase.font)}` +
    `&lineHeight=${testCase.lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(lang)}` +
    `&wordBreak=keep-all` +
    `&method=${method}` +
    `&requestId=${encodeURIComponent(requestId)}`
  if (testCase.whiteSpace === 'pre-wrap') {
    url += `&whiteSpace=pre-wrap`
  }
  return url
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

  const breakMismatch =
    report.firstBreakMismatch != null
      ? ` | break mismatch line ${report.firstBreakMismatch.line}: "${report.firstBreakMismatch.oursText}" vs "${report.firstBreakMismatch.browserText}"`
      : ''

  console.log(
    `${browser} | ${testCase.label}: diff ${report.diffPx}px | lines ${report.predictedLineCount}/${report.browserLineCount} | height ${report.predictedHeight}/${report.actualHeight}${sensitivity}${breakMismatch}`,
  )
}

function reportIsExact(testCase: OracleCase, currentBrowser: AutomationBrowserKind, report: ProbeReport): boolean {
  const ebm = testCase.expectedFirstBreakMismatch
  if (ebm !== undefined && ebm.browser === currentBrowser) {
    // Expect exactly this mismatch. Fail if absent (divergence resolved) or wrong shape.
    return (
      report.status === 'ready' &&
      report.diffPx === 0 &&
      report.predictedLineCount === report.browserLineCount &&
      report.predictedHeight === report.actualHeight &&
      report.firstBreakMismatch != null &&
      report.firstBreakMismatch.line === ebm.line &&
      report.firstBreakMismatch.oursText === ebm.oursText &&
      report.firstBreakMismatch.browserText === ebm.browserText
    )
  }
  // Normal strict check: no break mismatch allowed.
  return (
    report.status === 'ready' &&
    report.diffPx === 0 &&
    report.predictedLineCount === report.browserLineCount &&
    report.predictedHeight === report.actualHeight &&
    report.firstBreakMismatch == null
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
      const url = buildProbeUrl(pageServer.baseUrl, requestId, testCase, browser)
      const report = await loadHashReport<ProbeReport>(session, url, requestId, reportBrowser, timeoutMs)
      printCaseResult(browser, testCase, report)
      if (!reportIsExact(testCase, browser, report)) ok = false
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
