import { expect, test } from 'bun:test'
import { getAvailablePort, loadHashReport, loadPostedReport, type BrowserSession } from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'

const target = 'http://127.0.0.1:1234/probe?requestId=current'
function session(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return { navigate() {}, readLocationUrl: () => target, async close() {}, ...overrides }
}

test('a posted report subscribes before navigation and validates its owned URL once', async () => {
  let subscribed = false
  let reads = 0
  const report = { requestId: 'current', status: 'ready' }
  const result = await loadPostedReport(session({
    navigate(url) { expect(subscribed).toBe(true); expect(url).toBe(target) },
    readLocationUrl() { reads++; return target + '#phase=posting&requestId=current' },
  }), target, () => { subscribed = true; return Promise.resolve(report) }, 'current', 'chrome')
  expect(result).toBe(report)
  expect(reads).toBe(1)
})

test('posted reports reject another request or a navigated-away tab', async () => {
  await expect(loadPostedReport(session(), target, () => Promise.resolve({ requestId: 'old' }), 'current', 'chrome')).rejects.toThrow('Unexpected posted report request')
  await expect(loadPostedReport(session({ readLocationUrl: () => 'http://127.0.0.1:1234/other' }), target, () => Promise.resolve({ requestId: 'current' }), 'current', 'chrome')).rejects.toThrow('left its target URL')
})

test('navigation failure observes the report cancellation during teardown', async () => {
  let rejectReport!: (error: Error) => void
  const pending = new Promise<{ requestId: string }>((_, reject) => { rejectReport = reject })
  await expect(loadPostedReport(session({ navigate() { throw new Error('Owned tab missing') } }), target, () => pending, 'current', 'safari')).rejects.toThrow('Owned tab missing')
  rejectReport(new Error('Report server closed'))
  await Promise.resolve()
})

test('the posted deadline also bounds a navigation that never completes', async () => {
  const pending = new Promise<never>(() => {})
  await expect(loadPostedReport(session({ navigate: () => pending }), target, () => Promise.resolve({ requestId: 'current' }), 'current', 'safari', 10)).rejects.toThrow('Timed out waiting for posted report')
})

test('hash report identity cannot substitute for the expected page URL', async () => {
  const wrongUrl = 'http://127.0.0.1:1234/other#report=' + encodeURIComponent(JSON.stringify({ requestId: 'current' }))
  await expect(loadHashReport(session({ readLocationUrl: () => wrongUrl }), target, 'current', 'chrome', 500)).rejects.toThrow('unexpected chrome URL')
})

test('the report server rejects stale requests and shuts down idempotently', async () => {
  const server = await startPostedReportServer<{ requestId: string; value: number }>('current')
  try {
    await expect(getAvailablePort(Number(new URL(server.endpoint).port))).rejects.toThrow()
    const stale = await fetch(server.endpoint, { method: 'POST', body: JSON.stringify({ requestId: 'old', value: 1 }) })
    expect(stale.status).toBe(409)
    const current = await fetch(server.endpoint, { method: 'POST', body: JSON.stringify({ requestId: 'current', value: 2 }) })
    expect(current.status).toBe(204)
    expect(await server.waitForReport(null)).toEqual({ requestId: 'current', value: 2 })
  } finally {
    await server.close()
    await server.close()
  }
})

test('closing a report server before subscribing retains the cancellation error', async () => {
  const server = await startPostedReportServer('current')
  await server.close()
  await expect(server.waitForReport(null)).rejects.toThrow('Report server closed')
})
