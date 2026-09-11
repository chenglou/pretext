import { expect, test } from 'bun:test'
import { createWrappingTransport } from './wrapping-transport.ts'
import type { BrowserConfig, CaseResult } from '../tests/wrapping/types.ts'

const config: BrowserConfig = { requestId: 'current', context: { kind: 'fixtures' }, browser: 'chrome', schedule: 'ordinary', direction: 'ltr', family: null, caseId: null, fonts: [] }
const url = 'http://localhost:3000/?request=current'
const row: CaseResult = {
  input: { id: 'one', family: 'transport', origins: [], scope: 'supported', text: 'a', font: '16px Arial', lineHeight: 20, width: 10, whiteSpace: 'normal', wordBreak: 'normal', letterSpacing: 0, direction: 'ltr' },
  native: { height: 20, lineCount: 1, points: [], lineRects: [] },
  predictions: [{ name: 'current', error: 'Retained source execution error' }],
}
const post = (path: string, body: unknown) => new Request(`http://localhost:3000${path}`, { method: 'POST', body: JSON.stringify(body) })

test('a stale page cannot fetch current configuration or contribute any transport event', async () => {
  let received = 0
  const page = createWrappingTransport(config, url, async rows => { received += rows.length }, () => {})
  expect((await page.fetch(new Request('http://localhost:3000/config?request=old'))).status).toBe(409)
  expect((await page.fetch(new Request('http://localhost:3000/config?request=current'))).status).toBe(200)
  for (const path of ['/rows', '/progress', '/report']) {
    expect((await page.fetch(post(path, { requestId: 'old', sequence: 0, rows: [row], completed: 0, total: 0, url, report: { status: 'error', message: 'old' } }))).status).toBe(409)
  }
  expect(received).toBe(0)
  expect((await page.fetch(post('/report', { requestId: 'current', url, report: { status: 'error', message: 'current' } }))).status).toBe(200)
  expect((await page.completed).report).toEqual({ status: 'error', message: 'current' })
})

test('batches are sequential and finalization cannot outrun a row write', async () => {
  let release!: () => void
  let entered!: () => void
  const write = new Promise<void>(resolve => { release = resolve })
  const writing = new Promise<void>(resolve => { entered = resolve })
  let received = 0
  const page = createWrappingTransport(config, url, async rows => { entered(); await write; received += rows.length }, () => {})
  const batch = { requestId: 'current', sequence: 0, rows: [row] }
  const pending = page.fetch(post('/rows', batch))
  await writing
  expect((await page.fetch(post('/rows', batch))).status).toBe(409)
  expect((await page.fetch(post('/report', { requestId: 'current', url, report: { status: 'ready', rowCount: 1 } }))).status).toBe(409)
  release()
  expect((await pending).status).toBe(200)
  expect((await page.fetch(post('/rows', batch))).status).toBe(409)
  expect((await page.fetch(post('/rows', { ...batch, sequence: 2 }))).status).toBe(409)
  expect(received).toBe(1)
  expect((await page.fetch(post('/progress', { requestId: 'current', completed: 1, total: 2 }))).status).toBe(200)
  expect((await page.fetch(post('/report', { requestId: 'current', url, report: { status: 'ready', rowCount: 1 } }))).status).toBe(400)
  expect((await page.completed).report.status).toBe('error')
})

test('completion rejects wrong URLs and row-writer errors remain diagnosable', async () => {
  const page = createWrappingTransport(config, url, async () => {}, () => {})
  expect((await page.fetch(post('/report', { requestId: 'current', url: `${url}#other`, report: { status: 'ready', rowCount: 0 } }))).status).toBe(400)
  const wrongUrl = (await page.completed).report
  expect(wrongUrl.status === 'error' && wrongUrl.message.includes('Report URL')).toBe(true)
  const broken = createWrappingTransport(config, url, async () => { throw new Error('Disk unavailable') }, () => {})
  expect((await broken.fetch(post('/rows', { requestId: 'current', sequence: 0, rows: [row] }))).status).toBe(400)
  const failed = (await broken.completed).report
  expect(failed.status === 'error' && failed.message.includes('Disk unavailable')).toBe(true)
  expect((await broken.fetch(new Request('http://localhost:3000/config?request=current'))).status).toBe(409)
})
