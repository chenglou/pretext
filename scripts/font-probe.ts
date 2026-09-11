import { writeFileSync } from 'node:fs'
import {
  acquireBrowserAutomationLock, createBrowserSession, ensurePageServer, getAvailablePort, loadPostedReport,
  type BrowserKind, type BrowserSession, type PageServer,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'
import type { FontProbeReport } from '../pages/font-probe.ts'

const browserFlag = process.argv.find(arg => arg.startsWith('--browser='))?.slice('--browser='.length) ?? 'chrome'
if (browserFlag !== 'chrome' && browserFlag !== 'safari' && browserFlag !== 'firefox') throw new Error(`Unsupported browser ${browserFlag}`)
const browser: BrowserKind = browserFlag
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length)
const lock = await acquireBrowserAutomationLock(browser)
let session: BrowserSession | null = null
let pageServer: PageServer | null = null

function sameBreaks(actual: number[], expected: number[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

try {
  session = createBrowserSession(browser, { foreground: false, headless: false })
  pageServer = await ensurePageServer(await getAvailablePort(), '/font-probe', process.cwd())
  const requestId = `font-probe-${Date.now()}`
  const reports = await startPostedReportServer<FontProbeReport>(requestId)
  try {
    const report = await loadPostedReport(session, `${pageServer.baseUrl}/font-probe?requestId=${requestId}&reportEndpoint=${encodeURIComponent(reports.endpoint)}`, () => reports.waitForReport(null), requestId, browser, 120_000)
    if (output !== undefined) writeFileSync(output, JSON.stringify(report, null, 2))
    if (report.status === 'error') throw new Error(report.message)
    const rows = report.rows.map(row => ({
      label: row.label,
      domLines: row.domLines.map(line => line.length),
      pretextLines: row.pretextLines.map(line => line.length),
      canvasLines: row.canvasLines.map(line => line.length),
      domWidth: row.domWidth,
      canvasWidth: row.canvasWidth,
      isolatedWidth: row.isolatedWidth,
      languageCanvasWidth: row.languageCanvasWidth,
      boundaryCases: row.widths.length,
      coreBoundaryMatches: row.widths.filter(probe => sameBreaks(probe.dom, probe.pretext)).length,
      resetBoundaryMatches: row.widths.filter(probe => sameBreaks(probe.dom, probe.prefixReset)).length,
      lookaheadBoundaryMatches: row.widths.filter(probe => sameBreaks(probe.dom, probe.lookahead)).length,
    }))
    console.log(JSON.stringify({ environment: report.environment, rows }, null, 2))
  } finally { await reports.close() }
} finally {
  try {
    await session?.close()
  } finally {
    pageServer?.process?.kill()
    lock.release()
  }
}
