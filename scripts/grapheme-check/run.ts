// Runs the grapheme check's page (build.ts) in one of the harness's browsers (harness/browsers.ts: pinned Chrome,
// pinned Firefox or webkit-host, in the background) and writes what it posts to .artifacts/grapheme-check/<browser>.json.
// Like any harness job, run one at a time per browser.
//   bun scripts/grapheme-check/run.ts --browser=chrome|firefox|webkit-host [--fuzz=200000]
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from '../../harness/browsers.ts'

const flag = (name: string): string | null => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const browser = flag('browser')
if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'webkit-host') throw new Error('--browser=chrome|firefox|webkit-host')
const out = join(import.meta.dir, '../../.artifacts/grapheme-check')
const pageDir = join(out, 'page')
if (!existsSync(join(pageDir, 'check.js'))) throw new Error('Run bun scripts/grapheme-check/build.ts first')

const requestId = randomUUID()
let resolveReport: (text: string) => void = () => {}
let failReport: (error: Error) => void = () => {}
const report = new Promise<string>((resolve, reject) => {
  resolveReport = resolve
  failReport = reject
})
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/report') {
      const text = await request.text()
      if ((JSON.parse(text) as { requestId?: string }).requestId === requestId) resolveReport(text)
      return new Response('ok')
    }
    const name = url.pathname.slice(1)
    if (!/^[\w.-]+$/.test(name) || !existsSync(join(pageDir, name))) return new Response('not found', { status: 404 })
    const type = name.endsWith('.html') ? 'text/html' : name.endsWith('.json') ? 'application/json' : 'text/javascript'
    return new Response(readFileSync(join(pageDir, name)), { headers: { 'Content-Type': `${type}; charset=utf-8` } })
  },
})
const query = new URLSearchParams({ requestId, fuzz: flag('fuzz') ?? '200000' })
const base = `http://127.0.0.1:${server.port}`
// Chrome takes 4.6 GB for this page, past the 4 GB a harness job gets.
const session = await launch(browser, `${base}/index.html?${query}`, requestId, tabUrl => tabUrl.startsWith(base), failReport, false, 6144)
try {
  const text = await Promise.race([report, Bun.sleep(60 * 60_000).then(() => { throw new Error(`${browser}: no report in an hour`) })])
  const parsed = JSON.parse(text) as { status: string; message?: string }
  if (parsed.status !== 'ready') throw new Error(`${browser}: ${parsed.message}`)
  writeFileSync(join(out, `${browser}.json`), text)
  console.log(`${browser}: wrote ${join(out, `${browser}.json`)}`)
} finally {
  await session.close()
  await server.stop(true)
}
process.exit(0)
