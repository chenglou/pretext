import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type BrowserKind,
} from './browser-automation.ts'

type GatsbyLineMismatch = {
  line: number
  ours: string
  browser: string
}

type GatsbyReport = {
  status: 'ready' | 'error'
  requestId?: string
  width?: number
  contentWidth?: number
  predictedHeight?: number
  actualHeight?: number
  diagnosticHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  mismatchCount?: number
  firstMismatch?: GatsbyLineMismatch | null
  firstBreakMismatch?: GatsbyBreakMismatch | null
  message?: string
}

type GatsbyBreakMismatch = {
  line: number
  start: number
  oursEnd: number
  browserEnd: number
  oursRawEnd: number
  browserRawEnd: number
  deltaText: string
  oursContext: string
  browserContext: string
  contentWidth: number
  oursText: string
  browserText: string
  oursSumWidth: number
  oursFullWidth: number
  oursRawWidth: number
  browserDomWidth: number
  browserFullWidth: number
  browserRawDomWidth: number
  browserRawWidth: number
  reasonGuess: string
  oursBoundary: GatsbyBoundary
  browserBoundary: GatsbyBoundary
  segmentWindow: GatsbyBreakSegment[]
}

type GatsbyBoundary = {
  offset: number
  description: string
}

type GatsbyBreakSegment = {
  index: number
  start: number
  end: number
  text: string
  width: number
  isSpace: boolean
  breakable: boolean
  oursAtStart: boolean
  oursAtEnd: boolean
  oursInside: boolean
  browserAtStart: boolean
  browserAtEnd: boolean
  browserInside: boolean
}

const widths = process.argv.slice(2)
  .map(arg => Number.parseInt(arg, 10))
  .filter(width => Number.isFinite(width))

const targetWidths = widths.length > 0 ? widths : [300, 400, 600, 800]
const requestedPort = Number.parseInt(process.env['GATSBY_CHECK_PORT'] ?? '0', 10)
const browser = (process.env['GATSBY_CHECK_BROWSER'] ?? 'chrome').toLowerCase() as BrowserKind
const diagnosticMode = browser === 'safari' ? 'light' : 'full'

function formatWidth(width: number | undefined): string {
  if (width === undefined || !Number.isFinite(width)) return '?'
  return width.toFixed(3).replace(/\.?0+$/, '')
}

function formatSegmentMarkers(segment: GatsbyBreakSegment): string {
  const markers: string[] = []
  if (segment.oursAtStart) markers.push('ours@start')
  if (segment.oursInside) markers.push('ours@inside')
  if (segment.oursAtEnd) markers.push('ours@end')
  if (segment.browserAtStart) markers.push('browser@start')
  if (segment.browserInside) markers.push('browser@inside')
  if (segment.browserAtEnd) markers.push('browser@end')
  return markers.length > 0 ? ` [${markers.join(', ')}]` : ''
}

function printReport(report: GatsbyReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  const width = report.width ?? 0
  const diff = report.diffPx ?? 0
  const predicted = Math.round(report.predictedHeight ?? 0)
  const actual = Math.round(report.actualHeight ?? 0)
  const lines = report.predictedLineCount !== undefined && report.browserLineCount !== undefined
    ? `${report.predictedLineCount}/${report.browserLineCount}`
    : '-'

  console.log(`width ${width}: diff ${diff > 0 ? '+' : ''}${Math.round(diff)}px | height ${predicted}/${actual} | lines ${lines}`)
  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    const mismatch = report.firstBreakMismatch
    console.log(`  break L${mismatch.line} | ours ${mismatch.oursEnd} | browser ${mismatch.browserEnd}`)
    console.log(`  reason: ${mismatch.reasonGuess}`)
    console.log(`  delta:  ${JSON.stringify(mismatch.deltaText)}`)
    console.log(
      `  widths: max ${formatWidth(mismatch.contentWidth)} | ours sum/content/raw ${formatWidth(mismatch.oursSumWidth)}/${formatWidth(mismatch.oursFullWidth)}/${formatWidth(mismatch.oursRawWidth)} | browser content-dom/content/raw-dom/raw ${formatWidth(mismatch.browserDomWidth)}/${formatWidth(mismatch.browserFullWidth)}/${formatWidth(mismatch.browserRawDomWidth)}/${formatWidth(mismatch.browserRawWidth)}`,
    )
    console.log(`  ours boundary:    ${mismatch.oursBoundary?.description ?? '?'}`)
    console.log(`  browser boundary: ${mismatch.browserBoundary?.description ?? '?'}`)
    console.log(`  ours:    ${mismatch.oursContext ?? '?'}`)
    console.log(`  browser: ${mismatch.browserContext ?? '?'}`)
    if ((mismatch.segmentWindow?.length ?? 0) > 0) {
      console.log('  segments:')
      for (const segment of mismatch.segmentWindow!) {
        const kind = [
          segment.isSpace ? 'space' : 'text',
          segment.breakable ? 'breakable' : 'fixed',
        ].join(', ')
        console.log(
          `    #${segment.index} ${segment.start}-${segment.end} w=${formatWidth(segment.width)} ${kind}${formatSegmentMarkers(segment)} ${JSON.stringify(segment.text)}`,
        )
      }
    }
  } else if (report.firstMismatch !== null && report.firstMismatch !== undefined) {
    console.log(`  first mismatch L${report.firstMismatch.line}`)
    console.log(`  ours:    ${JSON.stringify(report.firstMismatch.ours.slice(0, 120))}`)
    console.log(`  browser: ${JSON.stringify(report.firstMismatch.browser.slice(0, 120))}`)
  }
}

let serverProcess: ChildProcess | null = null
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser)

try {
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  const pageServer = await ensurePageServer(port, '/gatsby', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/gatsby`

  for (const width of targetWidths) {
    const requestId = `${Date.now()}-${width}-${Math.random().toString(36).slice(2, 8)}`
    const url = `${baseUrl}?report=1&diagnostic=${diagnosticMode}&width=${width}&requestId=${requestId}`
    const report = await loadHashReport<GatsbyReport>(session, url, requestId, browser)
    printReport(report)
  }
} finally {
  session.close()
  serverProcess?.kill('SIGTERM')
  lock.release()
}
