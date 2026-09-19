// Bench driver: builds and serves the page bundle, opens one browser session, collects rows, and writes
// <out>/<browser>-bench.json and <out>/<browser>-bench.md. It doesn't take the browser lock; run it under the wrapper:
//   python3 .artifacts/session/with-browser-lock.py bench-chrome -- bun rebuild/bench/run.ts --browser=chrome --foreground
// Real numbers need --foreground: a visible, focused page on an idle Mac on power (README.md). Background runs, and every
// --smoke run, only validate the harness, and the report says so.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild, userAgentMatches } from '../lab/browser-build.ts'
import { buildContexts, SCENARIOS, SCRIPTS, SIZES, type ContextSpec } from './cases.ts'
import type { BrowserKind, ContextDonePost, ContextPlan, RowPost, Scenario, Script, Settings, SizeClass } from './protocol.ts'
import { formatMs, renderMarkdown, type BenchReport, type ContextReport, type LockState, type MachineSnapshot } from './report.ts'

const BENCH_DIR = import.meta.dir
const REPO = resolve(BENCH_DIR, '../..')
const PROFILES_DIR = join(REPO, '.artifacts/profiles')
// The locks of .artifacts/session/with-browser-lock.py: the exclusive one, and the slots a browser's jobs take one of.
const LOCK_ROOT = '/private/tmp/pretext-eng-20260912'
const LOCK_SLOTS = 3
// The bench launches the apps the lab launches (lab/browser-build.ts LAB_APPS): the pinned copies of Chrome and Firefox,
// whose build readBuild reads. The installed browsers update themselves, so launching them would run one build under
// another build's name (Chrome's user agent names the major version only).
const CHROME_APP = (): string => labApp('chrome')!.path
const FIREFOX_APP = (): string => labApp('firefox')!.path
const WEBKIT_HOST = join(REPO, '.artifacts/webkit-host/webkit-host')

function fail(text: string): never {
  console.error(`[bench] ${text}`)
  process.exit(1)
}

function message(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

// ---- Arguments ----

const USAGE = 'Usage: bun rebuild/bench/run.ts --browser=chrome|firefox|safari|webkit-host [--foreground] [--smoke] [--out=<dir>] '
  + '[--scripts=latin,cjk,arabic,mixed] [--sizes=tiny,sentence,paragraph,long,corpus] [--scenarios=cold,sweep,many] [--samples=N] '
  + '[--min-samples=N] [--warmup=N] [--min-sample-ms=N] [--budget-ms=N] [--messages=N] [--stall-ms=N] [--allow-battery] [--allow-no-lock]'
const FLAGS = ['foreground', 'smoke', 'allow-battery', 'allow-no-lock']
const VALUES = ['browser', 'out', 'scripts', 'sizes', 'scenarios', 'samples', 'min-samples', 'warmup', 'min-sample-ms', 'budget-ms', 'messages', 'stall-ms']
const flags = new Set<string>()
const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const flag = /^--([a-z-]+)$/.exec(raw)
  if (flag !== null && FLAGS.includes(flag[1]!)) {
    flags.add(flag[1]!)
    continue
  }
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null || !VALUES.includes(match[1]!)) fail(`Unknown argument ${raw}. ${USAGE}`)
  args.set(match[1]!, match[2]!)
}
const browserArg = args.get('browser')
if (browserArg !== 'chrome' && browserArg !== 'firefox' && browserArg !== 'safari' && browserArg !== 'webkit-host') fail(`--browser is required. ${USAGE}`)
const browser: BrowserKind = browserArg
const foreground = flags.has('foreground')
const smoke = flags.has('smoke')
if (browser === 'safari' && !foreground) fail('--browser=safari runs only with --foreground; background WebKit runs use --browser=webkit-host')
if (browser === 'webkit-host' && foreground) fail('webkit-host never takes focus; foreground WebKit runs use --browser=safari')

function list<T extends string>(name: string, known: readonly T[]): T[] {
  const raw = args.get(name)
  if (raw === undefined) return known.slice()
  const items = raw.split(',').filter(item => item !== '')
  for (let i = 0; i < items.length; i++) if (!known.includes(items[i] as T)) fail(`--${name}: unknown ${items[i]}; known: ${known.join(', ')}`)
  return items as T[]
}

function positiveInteger(name: string, fallback: number): number {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) fail(`--${name} must be a positive integer`)
  return value
}

const scripts: Script[] = list('scripts', SCRIPTS)
const sizes: SizeClass[] = list('sizes', SIZES)
const scenarios: Scenario[] = list('scenarios', SCENARIOS)
const settings: Settings = {
  samples: positiveInteger('samples', smoke ? 3 : 40),
  minSamples: positiveInteger('min-samples', smoke ? 2 : 10),
  warmup: positiveInteger('warmup', smoke ? 1 : 3),
  minSampleMs: positiveInteger('min-sample-ms', smoke ? 2 : 10),
  budgetMs: positiveInteger('budget-ms', smoke ? 1500 : 20_000),
  foreground,
  smoke,
}
if (settings.minSamples > settings.samples) fail('--min-samples must not exceed --samples')
const messageCount = positiveInteger('messages', smoke ? 200 : 1000)
const stallMs = positiveInteger('stall-ms', 20 * 60_000)
const runId = randomUUID()
const startedAt = new Date()
const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
const outDir = resolve(args.get('out') ?? join(REPO, '.artifacts/bench', `${stamp}-${browser}${smoke ? '-smoke' : ''}`))

// ---- Environment ----

function sh(command: string, commandArgs: string[]): string {
  try {
    return execFileSync(command, commandArgs, { encoding: 'utf8', timeout: 15_000 }).trim()
  } catch (error) {
    return `(${command} failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)})`
  }
}

// The lock this run sits under: the first of the browser's slots or the exclusive lock whose owner is this driver's
// parent, the wrapper; else the exclusive lock's state, ours or not.
function readLock(): LockState {
  const files = [`${LOCK_ROOT}/browser-lock.owner`]
  for (let k = 0; k < LOCK_SLOTS; k++) files.push(`${LOCK_ROOT}/browser-lock-${browser}-${k}.owner`)
  let found: LockState = { ownerFile: files[0]!, owner: null, ours: false }
  for (let i = 0; i < files.length && !found.ours; i++) {
    let owner: unknown = null
    try {
      owner = JSON.parse(readFileSync(files[i]!, 'utf8'))
    } catch {
      // No owner file: nobody holds this lock.
    }
    const pid = typeof owner === 'object' && owner !== null && 'pid' in owner ? Number((owner as { pid: unknown }).pid) : null
    if (i === 0 || pid === process.ppid) found = { ownerFile: files[i]!, owner, ours: pid !== null && pid === process.ppid }
  }
  return found
}

// This driver and the processes that started it (the lock wrapper, shells), whose command lines name this script too.
function ownChain(): Set<number> {
  const parents = new Map<number, number>()
  const lines = sh('ps', ['-axo', 'pid=,ppid=']).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(lines[i]!)
    if (match !== null) parents.set(Number(match[1]), Number(match[2]))
  }
  const chain = new Set<number>()
  for (let pid = process.pid; pid > 1 && !chain.has(pid); pid = parents.get(pid) ?? 0) chain.add(pid)
  return chain
}

// Browser automation that isn't this run: lab or bench profiles, webkit-host, the lab and bench drivers, the wrapping
// suite, main's benchmark checker. This run's browsers carry its run id in their profile path or URL.
function otherJobs(): string[] {
  const own = ownChain()
  const lines = sh('ps', ['-axo', 'pid=,command=']).split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.includes(runId) || own.has(Number(/^\d+/.exec(line)?.[0] ?? '0'))) continue
    if (/\.artifacts\/profiles\/|webkit-host --url|rebuild\/lab\/run\.ts|test:wrapping|benchmark-check|rebuild\/bench\/run\.ts/.test(line)) {
      out.push(line.length > 200 ? `${line.slice(0, 197)}...` : line)
    }
  }
  return out
}

function machineSnapshot(): MachineSnapshot {
  const powerMode = sh('pmset', ['-g']).split('\n').filter(line => /lowpowermode|powermode/.test(line)).map(line => line.trim()).join('; ')
  return {
    at: new Date().toISOString(),
    power: sh('pmset', ['-g', 'batt']).split('\n').slice(0, 2).join('\n'),
    powerMode,
    loadAverage: sh('sysctl', ['-n', 'vm.loadavg']),
    topProcesses: sh('ps', ['-Ao', 'pcpu=,pid=,comm=', '-r']).split('\n').slice(0, 8).map(line => line.trim()),
    otherJobs: otherJobs(),
  }
}

function treeHash(dir: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  const files = (readdirSync(dir, { recursive: true }) as string[]).map(String).sort()
  for (let i = 0; i < files.length; i++) {
    const path = join(dir, files[i]!)
    if (!statSync(path).isFile()) continue
    hasher.update(relative(REPO, path))
    hasher.update('\0')
    hasher.update(readFileSync(path))
    hasher.update('\0')
  }
  return hasher.digest('hex')
}

const build = readBuild(browser)
const machineStart = machineSnapshot()
const lockStart = readLock()
if (!lockStart.ours && !flags.has('allow-no-lock')) fail(`Run under python3 .artifacts/session/with-browser-lock.py; the lock owner is ${JSON.stringify(lockStart.owner)} (use --allow-no-lock to override)`)
if (foreground && !machineStart.power.includes("'AC Power'") && !flags.has('allow-battery')) fail(`Foreground benchmarks need AC power: ${machineStart.power.split('\n')[0]}`)
if (foreground && machineStart.otherJobs.length > 0) console.warn(`[bench] other browser jobs are running: ${machineStart.otherJobs.join('; ')}`)
if (foreground) console.warn(`[bench] load average ${machineStart.loadAverage}; the page must stay visible and focused until the report is written`)

// ---- Plan ----

const contexts: ContextSpec[] = buildContexts({ scripts, sizes, scenarios, messages: messageCount })
if (contexts.length === 0) fail('No rows selected')
const totalRows = contexts.reduce((sum, context) => sum + context.rows.length, 0)
const reports: ContextReport[] = contexts.map(context => ({ script: context.style.script, style: context.style, environment: null, rows: [] }))
const errors: string[] = []
const violations: string[] = []
let rowsDone = 0
let lastActivity = Date.now()
let settle: { resolve: () => void; reject: (error: Error) => void } | null = null
const completion = new Promise<void>((resolve, reject) => { settle = { resolve, reject } })
completion.catch(() => {})

function stopRun(error: Error): void {
  settle?.reject(error)
}

function plan(index: number): ContextPlan {
  const context = contexts[index]!
  return { runId, index, count: contexts.length, browser, engineBuild: build.engine, style: context.style, settings, rows: context.rows }
}

// A string's storage width (8-bit or 16-bit) follows its provenance, and the rebuild's WebKit and Blink ports have rules
// for 16-bit text only; JSON parsed from a body with any raw non-Latin-1 character yields 16-bit strings even for ASCII
// values. As in rebuild/lab/run.ts, escaping everything above U+007E keeps each string 8-bit unless it needs 16 bits.
function asciiJsonResponse(value: unknown): Response {
  const body = JSON.stringify(value).replace(/[-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

// Cross-origin isolation gives the finest performance.now() the browser offers. Everything is same-origin.
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' }

function pageUrl(baseUrl: string, index: number): string {
  return `${baseUrl}/bench?run=${runId}&context=${index}`
}

function pageHtml(lang: string): string {
  const escaped = lang.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
  return `<!doctype html><html lang="${escaped}"><head><meta charset="utf-8"><title>pretext rebuild bench</title>`
    + '<style>html,body{margin:0;padding:0;background:#fff;color:#000;font:14px -apple-system,sans-serif}body{padding:16px}</style></head>'
    + '<body><p>Pretext rebuild bench. Keep this window visible and focused until it says done.</p><script type="module" src="/page.js"></script></body></html>'
}

function progressLine(post: RowPost): string {
  const row = post.row
  const parts: string[] = []
  for (let i = 0; i < row.variants.length; i++) {
    const variant = row.variants[i]!
    const base = variant.baseline === null ? undefined : row.variants.find(entry => entry.variant === variant.baseline)
    parts.push(`${variant.variant} ${formatMs(variant.stats.medianMs)}${base === undefined ? '' : ` (×${(variant.stats.medianMs / base.stats.medianMs).toPrecision(3)})`}`)
  }
  return `[bench] ${browser} ${rowsDone}/${totalRows} ${row.id} ${formatMs(row.elapsedMs)}: ${parts.join(' | ')}`
}

function checkSnapshot(id: string, when: string, snap: { visibility: string; focused: boolean }): void {
  if (foreground && (snap.visibility !== 'visible' || !snap.focused)) violations.push(`${id} ${when}: visibility ${snap.visibility}, focused ${snap.focused}`)
}

let baseUrl = ''
let firstSnapshot: { devicePixelRatio: number; innerWidth: number; innerHeight: number } | null = null

async function handle(request: Request): Promise<Response> {
  lastActivity = Date.now()
  const url = new URL(request.url)
  switch (url.pathname) {
    case '/bench': {
      const index = Number(url.searchParams.get('context'))
      if (url.searchParams.get('run') !== runId || !Number.isInteger(index) || contexts[index] === undefined) return new Response('Inactive run', { status: 409 })
      return new Response(pageHtml(contexts[index]!.style.lang), { headers: { ...ISOLATION, 'content-type': 'text/html; charset=utf-8' } })
    }
    case '/page.js':
      return new Response(bundle, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
    case '/api/plan': {
      const index = Number(url.searchParams.get('context'))
      if (url.searchParams.get('run') !== runId || contexts[index] === undefined) return new Response('Inactive run', { status: 409 })
      return asciiJsonResponse(plan(index))
    }
    case '/api/row': {
      const body = await request.json() as RowPost
      if (body.runId !== runId || reports[body.context] === undefined) return new Response('Inactive run', { status: 409 })
      const row = body.row
      reports[body.context]!.rows.push({ ...row, counts: null })
      rowsDone++
      checkSnapshot(row.id, 'start', row.start)
      checkSnapshot(row.id, 'end', row.end)
      firstSnapshot ??= row.start
      const snaps = [row.start, row.end]
      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i]!
        if (snap.devicePixelRatio !== firstSnapshot.devicePixelRatio || snap.innerWidth !== firstSnapshot.innerWidth || snap.innerHeight !== firstSnapshot.innerHeight) {
          violations.push(`${row.id}: DPR or viewport changed to ${snap.devicePixelRatio}, ${snap.innerWidth}×${snap.innerHeight}`)
        }
      }
      console.log(progressLine(body))
      return Response.json({ kind: 'ok' })
    }
    case '/api/context-done': {
      const body = await request.json() as ContextDonePost
      if (body.runId !== runId || reports[body.context] === undefined) return new Response('Inactive run', { status: 409 })
      const report = reports[body.context]!
      report.environment = body.environment
      if (!userAgentMatches(browser, build, body.environment.userAgent)) errors.push(`User agent ${body.environment.userAgent} doesn't name the build read before launch (${JSON.stringify(build)})`)
      for (let i = 0; i < body.counts.length; i++) {
        const count = body.counts[i]!
        const row = report.rows.find(entry => entry.id === count.id)
        if (row === undefined) errors.push(`Counts for unknown row ${count.id}`)
        else row.counts = count
      }
      if (report.rows.length !== contexts[body.context]!.rows.length) errors.push(`Context ${report.script} posted ${report.rows.length} rows; expected ${contexts[body.context]!.rows.length}`)
      const next = body.context + 1
      if (next < contexts.length) return Response.json({ kind: 'navigate', url: pageUrl(baseUrl, next) })
      settle?.resolve()
      return Response.json({ kind: 'done' })
    }
    case '/api/fatal': {
      const body = await request.json() as { runId: string; message: string }
      if (body.runId === runId) stopRun(new Error(`Page error: ${body.message}`))
      return new Response('ok')
    }
    case '/favicon.ico':
      return new Response(null, { status: 204 })
    default:
      return new Response('Not found', { status: 404 })
  }
}

// ---- Browser sessions ----

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

function trash(path: string): void {
  try {
    execFileSync('trash', [path], { stdio: 'ignore', timeout: 60_000 })
  } catch (error) {
    console.error(`[bench] could not trash ${path}: ${message(error)}`)
  }
}

// Chrome and Firefox start through LaunchServices, each in its own profile under .artifacts/profiles (macOS 27 blocks
// shell-spawned Firefox from its data folders). Background sessions pass -g and never activate; foreground ones activate.
// One attempt only: a failed launch can show the user a dialog.
async function launchApp(app: string, executable: string, marker: string, profile: string, appArgs: string[]): Promise<Session> {
  execFileSync('open', ['-n', ...(foreground ? [] : ['-g']), '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
  let pid: number | null = null
  for (let i = 0; i < 100 && pid === null; i++) {
    pid = findPid(executable, marker)
    if (pid === null) await Bun.sleep(100)
  }
  if (pid === null) throw new Error(`Could not find the launched ${app} process`)
  const owned = pid
  return {
    async close() {
      await stopProcess(owned)
      await Bun.sleep(1_000)
      trash(profile)
    },
  }
}

// Foreground: a normal startup window at the page, which activates Chrome. Background: no startup window, and one inactive
// window opened through the DevTools protocol, as rebuild/lab/run.ts does (Chrome activates itself for normal windows).
// --enable-precise-memory-info makes performance.memory exact, so heap drops across samples show collections.
async function launchChrome(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  const app = CHROME_APP()
  // CHROME_PIN_ARGS keeps the copy out of Chrome's updater (lab README, "Pinned browsers").
  const common = [`--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--enable-precise-memory-info', '--window-size=1200,900']
  if (foreground) return await launchApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [...common, '--new-window', url])
  const session = await launchApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    ...common, '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--no-startup-window', '--remote-debugging-port=0',
  ])
  try {
    await openBackgroundChromeWindow(profile, url)
  } catch (error) {
    await session.close()
    throw error
  }
  return session
}

async function openBackgroundChromeWindow(profile: string, url: string): Promise<void> {
  const portFile = join(profile, 'DevToolsActivePort')
  let endpoint: string | null = null
  for (let i = 0; i < 150 && endpoint === null; i++) {
    try {
      const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(portFile, 'utf8'))
      if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
    } catch {
      // Not written yet.
    }
    if (endpoint === null) await Bun.sleep(100)
  }
  if (endpoint === null) throw new Error('Chrome did not write DevToolsActivePort')
  const socket = new WebSocket(endpoint)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Target.createTarget did not answer in 15s')), 15_000)
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('DevTools socket error'))
      }
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: true } }))
      socket.onmessage = event => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } }
        if (reply.id !== 1) return
        clearTimeout(timer)
        if (reply.error === undefined) resolve()
        else reject(new Error(`Target.createTarget: ${reply.error.message}`))
      }
    })
  } finally {
    socket.close()
  }
}

// dom.max_script_run_time 0: the page runs long synchronous rounds, and Firefox's slow-script warning would otherwise
// interrupt them.
function launchFirefox(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `bench-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string | number]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false], ['dom.max_script_run_time', 0],
    // Firefox updates the bundle it runs from; these keep the pinned copy at its build.
    ...FIREFOX_PIN_PREFS,
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  const app = FIREFOX_APP()
  return launchApp(app, `${app}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile, ['--new-instance', '--profile', profile, url])
}

function appleScript(lines: string[]): string {
  return execFileSync('osascript', lines.flatMap(line => ['-e', line]), { encoding: 'utf8', timeout: 15_000 }).trim()
}

// Foreground only: the user's Safari, activated, with one new window at the page. Closing closes that window's tab only
// when it still shows this run's page.
function launchSafari(url: string): Session {
  const windowId = Number.parseInt(appleScript([
    'tell application "Safari"',
    'activate',
    `make new document with properties {URL:${JSON.stringify(url)}}`,
    'return id of front window as string',
    'end tell',
  ]), 10)
  if (!Number.isFinite(windowId)) throw new Error('Could not find the Safari bench window')
  return {
    async close() {
      try {
        appleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          `set ownedTabs to tabs of targetWindow whose URL starts with ${JSON.stringify(`${baseUrl}/bench?run=${runId}`)}`,
          'if (count of ownedTabs) is 1 then close item 1 of ownedTabs',
          'end tell',
        ])
      } catch {
        // The window may already be gone.
      }
    },
  }
}

// The system WebKit.framework in a background WKWebView app that never activates (rebuild/lab/README.md, "Browser
// sessions"). It exits when the page's title is 'bench done'.
async function launchWebKitHost(url: string): Promise<Session> {
  if (!await Bun.file(WEBKIT_HOST).exists()) throw new Error(`${WEBKIT_HOST} is missing; build it with rebuild/tools/webkit-host/build.sh`)
  const host = Bun.spawn([WEBKIT_HOST, `--url=${url}`, '--width=1440', '--height=900', '--exit-title=bench done'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
  let closing = false
  void host.exited.then(code => {
    if (!closing) stopRun(new Error(`webkit-host exited with code ${code} before the run finished`))
  })
  const exited = (ms: number): Promise<boolean> => Promise.race([host.exited.then(() => true), Bun.sleep(ms).then(() => false)])
  return {
    async close() {
      closing = true
      if (await exited(2_000)) return
      host.kill('SIGTERM')
      if (await exited(4_000)) return
      host.kill('SIGKILL')
      if (!await exited(4_000)) throw new Error(`webkit-host ${host.pid} did not exit`)
    },
  }
}

// ---- Run ----

function portInUse(port: number): boolean {
  return Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0
}

let bundle = ''
let session: Session | null = null
let server: ReturnType<typeof Bun.serve> | null = null
process.on('SIGINT', () => stopRun(new Error('Interrupted')))
process.on('SIGTERM', () => stopRun(new Error('Terminated')))
try {
  const built = await Bun.build({ entrypoints: [join(BENCH_DIR, 'page.ts')], target: 'browser', format: 'esm', minify: false })
  if (!built.success) throw new Error(built.logs.map(String).join('\n'))
  bundle = await built.outputs[0]!.text()
  const fetchHandler = async (request: Request): Promise<Response> => {
    try {
      return await handle(request)
    } catch (error) {
      stopRun(error instanceof Error ? error : new Error(String(error)))
      return new Response(message(error), { status: 400 })
    }
  }
  for (let port = 3002; port < 3100 && server === null; port++) {
    if (portInUse(port)) continue
    try {
      server = Bun.serve({ hostname: '127.0.0.1', port, fetch: fetchHandler, maxRequestBodySize: 512 * 1024 * 1024 })
    } catch {
      // Taken between the check and the bind.
    }
  }
  if (server === null) throw new Error('No free port in 3002-3099')
  baseUrl = `http://127.0.0.1:${server.port}`
  console.log(`[bench] ${browser} ${build.appVersion} (engine ${build.engine}), ${foreground ? 'foreground' : 'background'}${smoke ? ', smoke' : ''}: ${totalRows} rows in ${contexts.length} contexts; serving ${baseUrl}; out ${outDir}`)
  const url = pageUrl(baseUrl, 0)
  switch (browser) {
    case 'chrome': session = await launchChrome(url); break
    case 'firefox': session = await launchFirefox(url); break
    case 'safari': session = launchSafari(url); break
    case 'webkit-host': session = await launchWebKitHost(url); break
  }
  lastActivity = Date.now()
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > stallMs) stopRun(new Error(`No page activity for ${stallMs} ms; ${rowsDone}/${totalRows} rows`))
  }, 1_000)
  try {
    await completion
  } finally {
    clearInterval(watchdog)
  }
  if (rowsDone !== totalRows) errors.push(`Received ${rowsDone} rows; expected ${totalRows}`)
  if (foreground && violations.length > 0) errors.push(`${violations.length} environment violations: the page wasn't visible and focused throughout`)
} catch (error) {
  errors.push(message(error))
} finally {
  if (session !== null) {
    try {
      await session.close()
    } catch (error) {
      errors.push(`Closing the browser: ${message(error)}`)
    }
  }
  server?.stop(true)
  const finishedAt = new Date()
  const report: BenchReport = {
    schema: 'rebuild-bench-1',
    status: errors.length === 0 ? 'ok' : 'error',
    errors,
    mode: foreground ? 'foreground' : 'background',
    smoke,
    browser,
    build,
    // The bundle launched, whether it is a pinned copy, and the copy's tree hash (null for webkit-host).
    app: labApp(browser),
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    settings: { ...settings, scripts, sizes, scenarios, messages: messageCount },
    machine: { cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), memoryBytes: Number(sh('sysctl', ['-n', 'hw.memsize'])), start: machineStart, end: machineSnapshot() },
    lock: { start: lockStart, end: readLock() },
    source: {
      head: sh('git', ['-C', REPO, 'rev-parse', 'HEAD']),
      status: sh('git', ['-C', REPO, 'status', '--short', '--', 'src', 'rebuild/src', 'rebuild/bench', 'rebuild/lab/font-facts.ts', 'rebuild/lab/font-facts.json']).split('\n').filter(line => line !== ''),
      srcSha256: treeHash(join(REPO, 'src')),
      rebuildSrcSha256: treeHash(join(REPO, 'rebuild/src')),
    },
    bundleBytes: bundle.length,
    environmentViolations: violations,
    contexts: reports,
  }
  mkdirSync(outDir, { recursive: true })
  const jsonPath = join(outDir, `${browser}-bench.json`)
  const mdPath = join(outDir, `${browser}-bench.md`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 1) + '\n')
  writeFileSync(mdPath, renderMarkdown(report))
  console.log(`[bench] ${browser}: ${report.status}; ${rowsDone}/${totalRows} rows; ${jsonPath}; ${mdPath}`)
  for (let i = 0; i < errors.length; i++) console.error(`[bench] ${errors[i]}`)
}
process.exit(errors.length === 0 ? 0 : 1)
