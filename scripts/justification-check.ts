import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadPostedReport,
  type BrowserKind,
  type BrowserSession,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'

type JustificationReport = {
  status: 'ready'
  requestId: string
  userAgent: string
  dpr: number
  testedWidths: number
  testedLines: number
  failures: object[]
}

const browserFlag = process.argv.find(arg => arg.startsWith('--browser='))?.slice(10) ?? 'chrome'
if (browserFlag !== 'chrome' && browserFlag !== 'safari') throw new Error('Expected --browser=chrome or safari')
const browser: BrowserKind = browserFlag
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const lock = await acquireBrowserAutomationLock(browser)
let session: BrowserSession | null = null
let serverProcess: ChildProcess | null = null
try {
  session = createBrowserSession(browser, { foreground: false, headless: false })
  const server = await ensurePageServer(await getAvailablePort(), '/justification-check', process.cwd())
  serverProcess = server.process
  const requestId = `${browser}-${Date.now()}`
  const reportServer = await startPostedReportServer<JustificationReport>(requestId)
  try {
    const url = new URL('/justification-check', server.baseUrl)
    url.searchParams.set('requestId', requestId)
    url.searchParams.set('reportEndpoint', reportServer.endpoint)
    if (process.argv.includes('--full')) url.searchParams.set('full', '1')
    const report = await loadPostedReport(session, url.href, () => reportServer.waitForReport(null), requestId, browser, 60000)
    if (output !== undefined) await Bun.write(output, JSON.stringify(report, null, 2) + '\n')
    console.log(`${browser}: ${report.testedWidths} widths, ${report.testedLines} lines, ${report.failures.length} failures (DPR ${report.dpr})`)
    for (const failure of report.failures.slice(0, 10)) console.log(JSON.stringify(failure))
    if (report.failures.length > 0) process.exitCode = 1
  } finally {
    await reportServer.close()
  }
} finally {
  try {
    await session?.close()
  } finally {
    serverProcess?.kill()
    lock.release()
  }
}
