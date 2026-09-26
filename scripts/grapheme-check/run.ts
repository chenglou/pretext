// Runs the grapheme check's page (build.ts) in an installed browser, in the background, and
// writes what it posts to .artifacts/grapheme-check/<browser>.json. It is a correctness run.
//   bun scripts/grapheme-check/run.ts --browser=chrome|safari|firefox [--fuzz=200000]
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireBrowserAutomationLock, createBrowserSession, getAvailablePort, type BrowserKind } from '../browser-automation.ts'

const flag = (name: string): string | null => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const browser = flag('browser') as BrowserKind | null
if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox') throw new Error('--browser=chrome|safari|firefox')
const out = join(import.meta.dir, '../../.artifacts/grapheme-check')
const pageDir = join(out, 'page')
if (!existsSync(join(pageDir, 'check.js'))) throw new Error('Run bun scripts/grapheme-check/build.ts first')

const requestId = randomUUID()
let resolveReport: (text: string) => void = () => {}
const report = new Promise<string>(resolve => { resolveReport = resolve })
const server = Bun.serve({
  port: await getAvailablePort(null),
  hostname: '127.0.0.1',
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
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser, { foreground: false })
try {
  const query = new URLSearchParams({ requestId, fuzz: flag('fuzz') ?? '200000' })
  await session.navigate(`http://127.0.0.1:${server.port}/index.html?${query}`)
  const text = await Promise.race([report, Bun.sleep(60 * 60_000).then(() => { throw new Error(`${browser}: no report in an hour`) })])
  const parsed = JSON.parse(text) as { status: string; message?: string }
  if (parsed.status !== 'ready') throw new Error(`${browser}: ${parsed.message}`)
  writeFileSync(join(out, `${browser}.json`), text)
  console.log(`${browser}: wrote ${join(out, `${browser}.json`)}`)
} finally {
  await session.close()
  await server.stop(true)
  lock.release()
}
process.exit(0)
