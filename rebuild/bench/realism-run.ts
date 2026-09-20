// Driver of the realism study: how far the bench's headline (README.md, "Chat") carries to another device pixel ratio,
// other text and a slower processor. It serves realism-page.ts, which lays every set's messages out from scratch once a
// pass and then counts what they asked of Canvas, in one browser session, and writes one JSON result. A run is short, so
// runs at several settings can take turns inside one exclusive stretch.
//   python3 .artifacts/session/with-browser-lock.py realism-chrome -- bun rebuild/bench/realism-run.ts --browser=chrome
//     [--sets=mix,latin,real] [--messages=10000] [--passes=3] [--counts=no] [--device-scale-factor=N] [--cpu-throttle=N] --out=<file.json>
// --device-scale-factor: Chrome's --force-device-scale-factor=N at launch. A forced ratio is a real one: Blink lays out at
//   it, where a DevTools-emulated one lays out at zoom 1 (rebuild/probes/blink-probes.ts). In Firefox the profile's
//   layout.css.devPixelsPerPx, which sets the app units of a device pixel as a screen's ratio does.
// --cpu-throttle (Chrome): Emulation.setCPUThrottlingRate over a DevTools session that stays attached for the whole run,
//   set before the page loads. With the option the window is made blank, throttled, then sent to the page; a rate of 1
//   takes the same path, so rates compare like for like.
// Background windows only, the pinned copies and webkit-host, as run.ts launches them. It doesn't take the browser lock.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild } from '../lab/browser-build.ts'
import { buildChat, CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_STYLE, CHAT_WIDTH, describeChat } from './cases.ts'
import type { ChatSetId } from './protocol.ts'
import type { RealismPlan, RealismResult } from './realism-page.ts'

const BENCH_DIR = import.meta.dir
const REPO = resolve(BENCH_DIR, '../..')
const PROFILES_DIR = join(REPO, '.artifacts/profiles')
const WEBKIT_HOST = join(REPO, '.artifacts/webkit-host/webkit-host')
const SETS: readonly ChatSetId[] = ['mix', 'latin', 'real']

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2]!)
}
const browser = args.get('browser')
if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'webkit-host') throw new Error('--browser=chrome|firefox|webkit-host')
const sets = (args.get('sets') ?? 'mix,latin,real').split(',') as ChatSetId[]
for (let i = 0; i < sets.length; i++) if (!SETS.includes(sets[i]!)) throw new Error(`Unknown set ${sets[i]}`)
const messages = Number(args.get('messages') ?? 10000)
const passes = Number(args.get('passes') ?? 3)
const scaleFactor = args.get('device-scale-factor') ?? null
const throttle = args.has('cpu-throttle') ? Number(args.get('cpu-throttle')) : null
if (browser !== 'chrome' && throttle !== null) throw new Error('--cpu-throttle is Chrome\'s')
if (browser === 'webkit-host' && scaleFactor !== null) throw new Error('webkit-host has the screen\'s ratio')
const outPath = resolve(args.get('out') ?? join(REPO, '.artifacts/bench', `realism-${browser}-${Date.now()}.json`))
const runId = randomUUID()
const build = readBuild(browser)

const plan: RealismPlan = {
  runId, browser, engineBuild: build.engine, style: CHAT_STYLE, codeFont: CHAT_CODE_FONT, codePadding: CHAT_CODE_PADDING, width: CHAT_WIDTH, passes, counts: args.get('counts') !== 'no',
  sets: sets.map(id => ({ id, messages: buildChat(id, messages) })),
}

// run.ts asciiJsonResponse: every character above U+007E escaped, so a string is 8-bit in the page where its characters allow.
const ABOVE_ASCII = new RegExp(`[${String.fromCharCode(0x7f)}-${String.fromCharCode(0xffff)}]`, 'g')
const planBody = JSON.stringify(plan).replace(ABOVE_ASCII, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' }
const HTML = `<!doctype html><html lang="${CHAT_STYLE.lang}"><head><meta charset="utf-8"><title>pretext realism study</title></head>`
  + '<body><p>Pretext realism study.</p><script type="module" src="/page.js"></script></body></html>'

let settle: { resolve: (result: RealismResult) => void; reject: (error: Error) => void } | null = null
const completion = new Promise<RealismResult>((resolve, reject) => { settle = { resolve, reject } })

const built = await Bun.build({ entrypoints: [join(BENCH_DIR, 'realism-page.ts')], target: 'browser', format: 'esm', minify: false })
if (!built.success) throw new Error(built.logs.map(String).join('\n'))
const bundle = await built.outputs[0]!.text()

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  switch (url.pathname) {
    case '/realism': return new Response(HTML, { headers: { ...ISOLATION, 'content-type': 'text/html; charset=utf-8' } })
    case '/page.js': return new Response(bundle, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
    case '/api/plan': return new Response(planBody, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
    case '/api/result': {
      const result = await request.json() as RealismResult
      if (result.runId === runId) settle!.resolve(result)
      return new Response('ok')
    }
    case '/api/fatal': {
      const body = await request.json() as { runId: string; message: string }
      if (body.runId === runId) settle!.reject(new Error(`Page error: ${body.message}`))
      return new Response('ok')
    }
    default: return new Response(null, { status: 404 })
  }
}

let server: ReturnType<typeof Bun.serve> | null = null
for (let port = 3002; port < 3100 && server === null; port++) {
  if (Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0) continue
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port, fetch: handle, maxRequestBodySize: 64 * 1024 * 1024 })
  } catch {
    // Taken between the check and the bind.
  }
}
if (server === null) throw new Error('No free port in 3002-3099')
const pageUrl = `http://127.0.0.1:${server.port}/realism?run=${runId}`

// ---- Browser sessions (run.ts's launches, background only) ----

type Session = { close: () => Promise<void> }

function findPid(executable: string, marker: string): number | null {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null && match[2]!.startsWith(`${executable} `) && match[2]!.includes(marker)) return Number(match[1])
  }
  return null
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function launchApp(app: string, executable: string, marker: string, profile: string, appArgs: string[]): Promise<Session> {
  execFileSync('open', ['-n', '-g', '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
  let pid: number | null = null
  for (let i = 0; i < 100 && pid === null; i++) {
    pid = findPid(executable, marker)
    if (pid === null) await Bun.sleep(100)
  }
  if (pid === null) throw new Error(`Could not find the launched ${app} process`)
  const owned = pid
  return {
    async close() {
      process.kill(owned, 'SIGTERM')
      for (let i = 0; i < 80 && isAlive(owned); i++) {
        if (i === 40) process.kill(owned, 'SIGKILL')
        await Bun.sleep(100)
      }
      await Bun.sleep(1_000)
      execFileSync('trash', [profile], { stdio: 'ignore', timeout: 60_000 })
    },
  }
}

// One DevTools command over the browser's socket; `sessionId` sends it to an attached target.
let nextId = 1
function command(socket: WebSocket, method: string, params: object, sessionId: string | null): Promise<Record<string, unknown>> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} did not answer in 15s`)), 15_000)
    const onMessage = (event: MessageEvent): void => {
      const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: Record<string, unknown> }
      if (reply.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      if (reply.error === undefined) resolve(reply.result ?? {})
      else reject(new Error(`${method}: ${reply.error.message}`))
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify(sessionId === null ? { id, method, params } : { id, method, params, sessionId }))
  })
}

async function launchChrome(): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  const app = labApp('chrome')!.path
  const session = await launchApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    `--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--enable-precise-memory-info', '--window-size=1200,900', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-startup-window', '--remote-debugging-port=0',
    ...(scaleFactor === null ? [] : [`--force-device-scale-factor=${scaleFactor}`]),
  ])
  let endpoint: string | null = null
  for (let i = 0; i < 150 && endpoint === null; i++) {
    try {
      const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8'))
      if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
    } catch {
      // Not written yet.
    }
    if (endpoint === null) await Bun.sleep(100)
  }
  if (endpoint === null) {
    await session.close()
    throw new Error('Chrome did not write DevToolsActivePort')
  }
  const socket = new WebSocket(endpoint)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('DevTools socket error'))
  })
  if (throttle === null) {
    await command(socket, 'Target.createTarget', { url: pageUrl, newWindow: true, background: true }, null)
    socket.close()
    return session
  }
  const target = await command(socket, 'Target.createTarget', { url: 'about:blank', newWindow: true, background: true }, null)
  const attached = await command(socket, 'Target.attachToTarget', { targetId: target['targetId'], flatten: true }, null)
  const sessionId = String(attached['sessionId'])
  await command(socket, 'Emulation.setCPUThrottlingRate', { rate: throttle }, sessionId)
  await command(socket, 'Page.navigate', { url: pageUrl }, sessionId)
  return {
    async close() {
      socket.close()
      await session.close()
    },
  }
}

function launchFirefox(): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string | number]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false], ['dom.max_script_run_time', 0],
    ...FIREFOX_PIN_PREFS,
  ]
  if (scaleFactor !== null) prefs.push(['layout.css.devPixelsPerPx', scaleFactor])
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  const app = labApp('firefox')!.path
  return launchApp(app, `${app}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile, ['--new-instance', '--profile', profile, pageUrl])
}

function launchWebKitHost(): Session {
  const host = Bun.spawn([WEBKIT_HOST, `--url=${pageUrl}`, '--width=1440', '--height=900', '--exit-title=bench done'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
  return {
    async close() {
      const exited = await Promise.race([host.exited.then(() => true), Bun.sleep(3_000).then(() => false)])
      if (!exited) host.kill('SIGKILL')
    },
  }
}

// ---- Run ----

const loadStart = loadavg()[0]!
const startedAt = new Date()
console.log(`[realism] ${browser} ${build.appVersion}: ${sets.join(', ')}, ${messages} messages, ${passes} passes, device scale factor ${scaleFactor ?? 'as it is'}, cpu throttle ${throttle ?? 'none'}; load ${loadStart.toFixed(1)}`)
let session: Session
switch (browser) {
  case 'chrome': session = await launchChrome(); break
  case 'firefox': session = await launchFirefox(); break
  case 'webkit-host': session = launchWebKitHost(); break
}
const stall = setTimeout(() => settle!.reject(new Error('No result in 20 minutes')), 20 * 60_000)
let result: RealismResult | null = null
let failure: string | null = null
try {
  result = await completion
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
}
clearTimeout(stall)
await session.close()
server.stop(true)
const report = {
  schema: 'rebuild-bench-realism-1', status: failure === null ? 'ok' : 'error', failure, browser, build, app: labApp(browser), startedAt: startedAt.toISOString(),
  durationMs: Date.now() - startedAt.getTime(), deviceScaleFactor: scaleFactor, cpuThrottle: throttle, passes,
  load: { start: loadStart, end: loadavg()[0]! }, power: execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).split('\n').slice(0, 2).join(' '),
  head: execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sets: plan.sets.map(set => ({ id: set.id, holds: describeChat(set.messages) })), result,
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`)
if (result !== null) {
  for (let s = 0; s < result.sets.length; s++) {
    const set = result.sets[s]!
    console.log(`[realism] ${browser} dpr ${result.devicePixelRatio} ${set.id}: ${set.scratchMs.map(ms => (ms / 1000).toFixed(3)).join(', ')} s; a message ${(set.measureTextCalls / set.messages).toFixed(1)} calls, ${(set.unitsSent / set.messages).toFixed(0)} units sent, ${(set.contexts / set.messages).toFixed(1)} contexts; ${set.lines} lines`)
  }
  console.log(`[realism] spin ${result.spinMs.start.toFixed(1)} / ${result.spinMs.end.toFixed(1)} ms; load ${loadStart.toFixed(1)} to ${loadavg()[0]!.toFixed(1)}; ${outPath}`)
}
if (failure !== null) console.error(`[realism] ${failure}`)
process.exit(failure === null ? 0 : 1)
