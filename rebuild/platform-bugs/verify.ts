#!/usr/bin/env bun
// Opens the standalone repro pages of rebuild/platform-bugs/pages in one lab browser and records what each page printed.
// Every page gets a fresh browser process and profile, because several of the bugs are process-wide state.
//
//   python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py bugs-chrome -- \
//     bun rebuild/platform-bugs/verify.ts --browser=chrome --pages=chrome-canvas-element-letter-spacing.html
//
// --browser=chrome|firefox|webkit-host   the lab's pinned Chrome and Firefox copies (rebuild/lab/browser-build.ts) and the
//                                        WKWebView host on the system WebKit, launched as rebuild/probes/runner.ts does:
//                                        background windows, never activated, one attempt.
// --pages=a.html,b.html?x=1              page files under pages/, each with an optional query string. Default: every page
//                                        listed for the browser in pages/index.json, with each of its listed queries.
// --out=<dir>                            default rebuild/platform-bugs/results
// --work=<dir>                           profiles; default $TMPDIR. The profile folder's name holds "pretext-rebuild" so the
//                                        session watchdog owns the browser.
//
// The pages don't know about this driver. The server appends a reporter script to each page as it serves it: when the
// page sets document.title to a verdict ("BUG ...", "NO BUG ...", "ERROR ...") the reporter posts the title, the text of
// #log, the user agent and devicePixelRatio. A page contract, so that a hidden window can't stall a page: pages finish from
// promises and script order, never from timers or animation frames.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild } from '../lab/browser-build.ts'

type Browser = 'chrome' | 'firefox' | 'webkit-host'
type Report = { title: string; log: string; userAgent: string; devicePixelRatio: number; visibility: string; languages: string[] }
type PageIndex = Array<{ page: string; browsers: Browser[]; queries?: string[] }>

const HERE = import.meta.dir
const WEBKIT_HOST = join(homedir(), 'github/pretext-rebuild/.artifacts/webkit-host/webkit-host')
const PAGE_TIMEOUT_MS = 90_000

function fail(text: string): never {
  console.error(`[bugs] ${text}`)
  process.exit(1)
}

const args = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/.exec(arg)
  if (match === null) fail(`Unknown argument ${arg}`)
  args.set(match[1]!, match[2]!)
}
const browser = args.get('browser') as Browser | undefined
if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'webkit-host') fail('--browser=chrome|firefox|webkit-host is required')
// --dir=<dir>: serve another folder of pages (scratch pages while reducing a candidate).
const PAGES = resolve(args.get('dir') ?? join(HERE, 'pages'))
const outDir = resolve(args.get('out') ?? join(HERE, 'results'))
const workDir = resolve(args.get('work') ?? tmpdir())
const index = existsSync(join(PAGES, 'index.json')) ? JSON.parse(readFileSync(join(PAGES, 'index.json'), 'utf8')) as PageIndex : []
const targets: string[] = []
if (args.has('pages')) {
  targets.push(...args.get('pages')!.split(',').filter(Boolean))
} else {
  for (let i = 0; i < index.length; i++) {
    const entry = index[i]!
    if (!entry.browsers.includes(browser)) continue
    const queries = entry.queries ?? ['']
    for (let q = 0; q < queries.length; q++) targets.push(entry.page + queries[q]!)
  }
}
if (targets.length === 0) fail('No pages selected')
for (let i = 0; i < targets.length; i++) {
  const file = join(PAGES, targets[i]!.split('?')[0]!)
  if (!existsSync(file)) fail(`${file} doesn't exist`)
}

// ---- Server ----

const REPORTER = `
<script>
// Appended by rebuild/platform-bugs/verify.ts while serving; not part of the repro page.
(() => {
  let sent = false
  const send = () => {
    if (sent || !/^(BUG|NO BUG|ERROR)/.test(document.title)) return
    sent = true
    const log = document.getElementById('log')
    fetch('/report' + location.search, { method: 'POST', body: JSON.stringify({
      title: document.title, log: log === null ? '' : log.textContent, userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio, visibility: document.visibilityState, languages: [...navigator.languages],
    }) }).then(() => { document.title = 'bugs page reported' })
  }
  new MutationObserver(send).observe(document.head, { subtree: true, childList: true, characterData: true })
  addEventListener('error', event => { if (!sent) document.title = 'ERROR ' + event.message })
  addEventListener('unhandledrejection', event => { if (!sent) document.title = 'ERROR ' + String(event.reason) })
  send()
})()
</script>
`

let waiting: { resolve: (report: Report) => void } | null = null
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/report' && request.method === 'POST') {
      const report = await request.json() as Report
      waiting?.resolve(report)
      return new Response('ok')
    }
    const name = decodeURIComponent(url.pathname.slice(1))
    if (!/^[a-z0-9-]+\.html$/.test(name) || !existsSync(join(PAGES, name))) return new Response('not found', { status: 404 })
    // The file's bytes, then the reporter after </html>: the parser puts a late script at the end of body.
    return new Response(readFileSync(join(PAGES, name), 'utf8') + REPORTER, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  },
})

// ---- Browser sessions (as rebuild/probes/runner.ts) ----

type Session = { close: () => Promise<void> }

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

async function stopProcess(pid: number): Promise<void> {
  const signal = (name: NodeJS.Signals): void => {
    try { process.kill(pid, name) } catch { /* already gone */ }
  }
  signal('SIGTERM')
  const start = Date.now()
  let killed = false
  while (isAlive(pid)) {
    if (Date.now() - start > 8_000) throw new Error(`Browser process ${pid} did not exit`)
    if (!killed && Date.now() - start > 4_000) {
      killed = true
      signal('SIGKILL')
    }
    await Bun.sleep(100)
  }
}

function findPid(executable: string, marker: string): number | null {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null && match[2]!.startsWith(`${executable} `) && match[2]!.includes(marker)) return Number(match[1])
  }
  return null
}

async function waitForPid(executable: string, marker: string): Promise<number | null> {
  for (let i = 0; i < 100; i++) {
    const pid = findPid(executable, marker)
    if (pid !== null) return pid
    await Bun.sleep(100)
  }
  return null
}

function trash(path: string): void {
  try {
    execFileSync('trash', [path], { stdio: 'ignore', timeout: 60_000 })
  } catch (error) {
    console.error(`[bugs] could not trash ${path}: ${String(error)}`)
  }
}

function openApp(app: string, appArgs: string[]): void {
  execFileSync('open', ['-n', '-g', '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
}

async function closeLaunched(pid: number, profile: string): Promise<void> {
  await stopProcess(pid)
  await Bun.sleep(1_000)
  trash(profile)
}

async function launchChrome(url: string, runId: string): Promise<Session> {
  const app = labApp('chrome')!.path
  const profile = join(workDir, `pretext-rebuild-bugs-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  openApp(app, [
    `--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--window-size=1200,900', '--no-startup-window', '--remote-debugging-port=0',
  ])
  const pid = await waitForPid(`${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`)
  if (pid === null) {
    trash(profile)
    throw new Error('Could not find the launched Chrome process')
  }
  const session: Session = { close: () => closeLaunched(pid, profile) }
  try {
    const portFile = join(profile, 'DevToolsActivePort')
    let endpoint: string | null = null
    for (let i = 0; i < 150 && endpoint === null; i++) {
      if (!isAlive(pid)) throw new Error('Chrome exited during startup')
      try {
        const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(portFile, 'utf8'))
        if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
      } catch { /* not written yet */ }
      if (endpoint === null) await Bun.sleep(100)
    }
    if (endpoint === null) throw new Error('Chrome did not write DevToolsActivePort')
    const ws = new WebSocket(endpoint)
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools')), 10_000)
      ws.onopen = () => { clearTimeout(timer); done() }
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Chrome DevTools connection failed')) }
    })
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Target.createTarget')), 15_000)
      ws.onmessage = event => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } }
        if (reply.id !== 1) return
        clearTimeout(timer)
        if (reply.error !== undefined) reject(new Error(reply.error.message))
        else done()
      }
      ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: true } }))
    })
    ws.close()
    return session
  } catch (error) {
    await session.close()
    throw error
  }
}

async function freePort(): Promise<number> {
  return await new Promise((done, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') return reject(new Error('no port'))
      probe.close(() => done(address.port))
    })
  })
}

async function launchFirefox(url: string, runId: string): Promise<Session> {
  const app = labApp('firefox')!.path
  const profile = join(workDir, `pretext-rebuild-bugs-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string | number]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
    ...FIREFOX_PIN_PREFS,
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  const port = await freePort()
  openApp(app, ['--new-instance', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'])
  const pid = await waitForPid(`${app}/Contents/MacOS/firefox`, ` --profile ${profile} `)
  if (pid === null) {
    trash(profile)
    throw new Error('Could not find the launched Firefox process')
  }
  const session: Session = { close: () => closeLaunched(pid, profile) }
  try {
    let open = false
    for (let i = 0; i < 200 && !open; i++) {
      if (!isAlive(pid)) throw new Error('Firefox exited during startup')
      open = await new Promise<boolean>(done => {
        const socket = createConnection({ host: '127.0.0.1', port })
        socket.once('connect', () => { socket.destroy(); done(true) })
        socket.once('error', () => { socket.destroy(); done(false) })
      })
      if (!open) await Bun.sleep(100)
    }
    if (!open) throw new Error(`Timed out waiting for Firefox's remote debugging port ${port}`)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/session`)
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Firefox BiDi')), 10_000)
      ws.onopen = () => { clearTimeout(timer); done() }
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Firefox BiDi connection failed')) }
    })
    let nextId = 1
    const call = (method: string, params: Record<string, unknown>): Promise<unknown> => new Promise((done, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for Firefox BiDi ${method}`)), 10_000)
      const listener = (event: MessageEvent): void => {
        const response = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: string; message?: string }
        if (response.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener('message', listener)
        if (response.error !== undefined) reject(new Error(`Firefox BiDi ${method}: ${response.message ?? response.error}`))
        else done(response.result)
      }
      ws.addEventListener('message', listener)
      ws.send(JSON.stringify({ id, method, params }))
    })
    await call('session.new', { capabilities: { alwaysMatch: {} } })
    const tree = await call('browsingContext.getTree', {}) as { contexts: Array<{ context: string }> }
    const context = tree.contexts[0]?.context
    if (context === undefined) throw new Error('Firefox BiDi returned no browsing context')
    await call('browsingContext.navigate', { context, url, wait: 'none' })
    ws.close()
    return session
  } catch (error) {
    await session.close()
    throw error
  }
}

async function launchWebKitHost(url: string): Promise<Session> {
  if (!existsSync(WEBKIT_HOST)) throw new Error(`${WEBKIT_HOST} is missing; build it with rebuild/tools/webkit-host/build.sh`)
  const host = Bun.spawn([WEBKIT_HOST, `--url=${url}`, '--width=1200', '--height=900', '--exit-title=bugs page reported'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
  const exited = (ms: number): Promise<boolean> => Promise.race([host.exited.then(() => true), Bun.sleep(ms).then(() => false)])
  return {
    async close() {
      if (await exited(2_000)) return
      host.kill('SIGTERM')
      if (await exited(4_000)) return
      host.kill('SIGKILL')
      if (!await exited(4_000)) throw new Error(`webkit-host ${host.pid} did not exit`)
    },
  }
}

// ---- Run ----

const build = readBuild(browser)
mkdirSync(join(outDir, browser), { recursive: true })
let failures = 0
for (let i = 0; i < targets.length; i++) {
  const target = targets[i]!
  const runId = randomUUID().slice(0, 8)
  const url = `http://127.0.0.1:${server.port}/${target}`
  const started = new Date().toISOString()
  const reported = new Promise<Report>(done => { waiting = { resolve: done } })
  let session: Session | null = null
  let report: Report | null = null
  let error: string | null = null
  try {
    session = browser === 'chrome' ? await launchChrome(url, runId) : browser === 'firefox' ? await launchFirefox(url, runId) : await launchWebKitHost(url)
    report = await Promise.race([reported, Bun.sleep(PAGE_TIMEOUT_MS).then(() => null)])
    if (report === null) error = `No report within ${PAGE_TIMEOUT_MS} ms`
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  waiting = null
  try {
    await session?.close()
  } catch (caught) {
    error = `${error === null ? '' : `${error}; `}${caught instanceof Error ? caught.message : String(caught)}`
  }
  const name = target.replace(/\.html/, '').replace(/[?&=]/g, '_')
  writeFileSync(join(outDir, browser, `${name}.json`), `${JSON.stringify({ page: target, browser, build, started, error, report }, null, 2)}\n`)
  if (error !== null) failures++
  console.log(`[bugs] ${browser} ${target}: ${error ?? report!.title}`)
  if (report !== null) console.log(report.log.split('\n').map(line => `    ${line}`).join('\n'))
}
server.stop(true)
process.exit(failures === 0 ? 0 : 1)
