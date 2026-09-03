import { writeFileSync } from 'node:fs'
import { acquireBrowserAutomationLock, createBrowserSession, ensurePageServer, getAvailablePort, loadHashReport, type BrowserKind } from './browser-automation.js'
import type { runPrepareWorkloads } from '../shared/prepare-workloads.js'

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!
}

type WorkloadReport = ReturnType<typeof runPrepareWorkloads> & { status: string, requestId: string, message?: string }
const browser = (process.argv.find(arg => arg.startsWith('--browser='))?.slice(10) ?? 'chrome') as BrowserKind
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
const runs = Number(process.argv.find(arg => arg.startsWith('--runs='))?.slice(7) ?? 3)
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser, { foreground: true })
let server: Awaited<ReturnType<typeof ensurePageServer>> | null = null
try {
  server = await ensurePageServer(await getAvailablePort(), '/prepare-workloads', process.cwd())
  const samples: WorkloadReport[] = []
  for (let i = 0; i < runs; i++) {
    const requestId = `${Date.now()}-${i}`
    const report = await loadHashReport<WorkloadReport>(session, `${server.baseUrl}/prepare-workloads?report=1&requestId=${requestId}`, requestId, browser, 240_000)
    if (report.status !== 'ready') throw new Error(report.message ?? 'Workload failed')
    samples.push(report)
  }
  const report = {
    ...samples[0]!,
    runs,
    methodology: 'Median of independent full page runs. Shared caches clear before each prepare workload. Growing-prefix controls both return rich prepared handles. Latency fields are medians of the per-run summaries.',
    results: samples[0]!.results.map((row, index) => {
      const summary = { ...row, ms: median(samples.map(sample => sample.results[index]!.ms)) }
      if (row.p50Ms !== undefined) {
        summary.p50Ms = median(samples.map(sample => sample.results[index]!.p50Ms!))
        summary.p95Ms = median(samples.map(sample => sample.results[index]!.p95Ms!))
        summary.maxMs = median(samples.map(sample => sample.results[index]!.maxMs!))
      }
      return summary
    }),
    samples,
  }
  console.log(JSON.stringify(report, null, 2))
  if (output !== undefined) writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
} finally {
  session.close()
  server?.process?.kill()
  lock.release()
}
