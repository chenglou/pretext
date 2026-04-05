import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type BrowserKind,
} from './browser-automation.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
  browserLineMethod?: 'range' | 'span'
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    oursStart: number
    browserStart: number
    oursEnd: number
    browserEnd: number
    oursText: string
    browserText: string
    oursRenderedText: string
    browserRenderedText: string
    oursContext: string
    browserContext: string
    deltaText: string
    reasonGuess: string
    oursSumWidth: number
    oursDomWidth: number
    oursFullWidth: number
    browserDomWidth: number
    browserFullWidth: number
  } | null
  alternateBrowserLineMethod?: 'range' | 'span'
  alternateBrowserLineCount?: number
  alternateFirstBreakMismatch?: object | null
  extractorSensitivity?: string | null
  breakTrace?: {
    line: number
    lineStart: number
    contentWidth: number
    entries: {
      label: string
      start: number
      end: number
      text: string
      kind: string
      unitWidth: number
      lineFitWidth: number
      marker: 'ours' | 'browser' | 'ours+browser' | null
    }[]
  } | null
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

function parseBrowser(value: string | null): BrowserKind {
  const browser = (value ?? process.env['PROBE_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
  if (browser !== 'chrome' && browser !== 'safari') {
    throw new Error(`Unsupported browser ${browser}; expected chrome or safari`)
  }
  return browser
}

function requireFlag(name: string): string {
  const value = parseStringFlag(name)
  if (value === null || value.length === 0) throw new Error(`Missing --${name}=...`)
  return value
}

function printReport(report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  console.log(
    `width ${report.width}: diff ${report.diffPx}px | lines ${report.predictedLineCount}/${report.browserLineCount} | height ${report.predictedHeight}/${report.actualHeight}`,
  )
  if (report.browserLineMethod !== undefined) {
    console.log(`  browser line method: ${report.browserLineMethod}`)
  }
  if (report.extractorSensitivity !== null && report.extractorSensitivity !== undefined) {
    console.log(`  extractor sensitivity: ${report.extractorSensitivity}`)
  }
  if (
    report.alternateBrowserLineMethod !== undefined &&
    report.alternateBrowserLineCount !== undefined
  ) {
    console.log(
      `  alternate method: ${report.alternateBrowserLineMethod} (${report.predictedLineCount}/${report.alternateBrowserLineCount} lines)` +
      (report.alternateFirstBreakMismatch === null ? ' exact' : ''),
    )
  }
  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    const mismatch = report.firstBreakMismatch
    console.log(`  break L${mismatch.line}: ${mismatch.reasonGuess}`)
    console.log(`  offsets: ours ${mismatch.oursStart}-${mismatch.oursEnd} | browser ${mismatch.browserStart}-${mismatch.browserEnd}`)
    console.log(`  delta: ${JSON.stringify(mismatch.deltaText)}`)
    console.log(`  ours text:    ${JSON.stringify(mismatch.oursText)}`)
    console.log(`  browser text: ${JSON.stringify(mismatch.browserText)}`)
    console.log(`  ours rendered:    ${JSON.stringify(mismatch.oursRenderedText)}`)
    console.log(`  browser rendered: ${JSON.stringify(mismatch.browserRenderedText)}`)
    console.log(`  ours:    ${mismatch.oursContext}`)
    console.log(`  browser: ${mismatch.browserContext}`)
    console.log(
      `  widths: ours sum/dom/full ${mismatch.oursSumWidth.toFixed(3)}/${mismatch.oursDomWidth.toFixed(3)}/${mismatch.oursFullWidth.toFixed(3)} | browser dom/full ${mismatch.browserDomWidth.toFixed(3)}/${mismatch.browserFullWidth.toFixed(3)}`,
    )
    if (report.breakTrace !== null && report.breakTrace !== undefined && report.breakTrace.entries.length > 0) {
      console.log(`  trace L${report.breakTrace.line} from offset ${report.breakTrace.lineStart} (content width ${report.breakTrace.contentWidth}px):`)
      for (const entry of report.breakTrace.entries) {
        console.log(
          `    ${entry.label.padEnd(7)} ${String(entry.start).padStart(4)}-${String(entry.end).padEnd(4)} ` +
          `${JSON.stringify(entry.text).padEnd(12)} kind=${entry.kind.padEnd(15)} ` +
          `unit=${entry.unitWidth.toFixed(3).padStart(7)} fit=${entry.lineFitWidth.toFixed(3).padStart(8)}` +
          (entry.marker === null ? '' : ` [${entry.marker}]`),
        )
      }
    }
  }
}

const browser = parseBrowser(parseStringFlag('browser'))
const requestedPort = parseNumberFlag('port', Number.parseInt(process.env['PROBE_CHECK_PORT'] ?? '0', 10))
const text = requireFlag('text')
const width = parseNumberFlag('width', 600)
const font = parseStringFlag('font') ?? '18px serif'
const lineHeight = parseNumberFlag('lineHeight', 32)
const dir = parseStringFlag('dir') ?? 'ltr'
const lang = parseStringFlag('lang') ?? (dir === 'rtl' ? 'ar' : 'en')
const method = parseStringFlag('method')
const whiteSpace = parseStringFlag('whiteSpace') === 'pre-wrap' ? 'pre-wrap' : 'normal'
const wordBreak = parseStringFlag('wordBreak') === 'keep-all' ? 'keep-all' : 'normal'

let serverProcess: ChildProcess | null = null
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser)

try {
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  const pageServer = await ensurePageServer(port, '/probe', process.cwd())
  serverProcess = pageServer.process
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const url =
    `${pageServer.baseUrl}/probe?text=${encodeURIComponent(text)}` +
    `&width=${width}` +
    `&font=${encodeURIComponent(font)}` +
    `&lineHeight=${lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(lang)}` +
    `&whiteSpace=${encodeURIComponent(whiteSpace)}` +
    `&wordBreak=${encodeURIComponent(wordBreak)}` +
    (method === null ? '' : `&method=${encodeURIComponent(method)}`) +
    `&requestId=${encodeURIComponent(requestId)}`
  const report = await loadHashReport<ProbeReport>(session, url, requestId, browser)
  printReport(report)
} finally {
  session.close()
  serverProcess?.kill()
  lock.release()
}
