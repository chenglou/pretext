// Lab driver: serves the page bundle, opens one background browser session, streams rows to NDJSON.
// Always run under the shared browser lock (this script doesn't take it):
//   python3 .artifacts/session/with-browser-lock.py lab-chrome -- bun rebuild/lab/run.ts --browser=chrome --cases=<file> --out=<dir>
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserKind, Case, FontDecl, LabRow } from './types.ts'

const LAB_DIR = import.meta.dir
const PROFILES_DIR = resolve(LAB_DIR, '../../.artifacts/profiles')
const FONTS_DIR = resolve(LAB_DIR, '../../tests/wrapping/fonts')
const CHROME_APP = '/Applications/Google Chrome.app'
const FIREFOX_APP = '/Applications/Firefox.app'

function fail(text: string): never {
  console.error(`[lab] ${text}`)
  process.exit(1)
}

function message(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

// ---- Arguments ----

const KNOWN = ['browser', 'cases', 'out', 'limit', 'family', 'chunk', 'predictor', 'stall-ms']
const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null || !KNOWN.includes(match[1]!)) fail(`Unknown argument ${raw}. Usage: bun rebuild/lab/run.ts --browser=chrome|safari|firefox|webkit-host --cases=<cases.ndjson> --out=<dir> [--limit=N] [--family=substr] [--chunk=N] [--predictor=<file>] [--stall-ms=N]`)
  args.set(match[1]!, match[2]!)
}
const browserArg = args.get('browser')
if (browserArg !== 'chrome' && browserArg !== 'safari' && browserArg !== 'firefox' && browserArg !== 'webkit-host') fail('--browser must be chrome, safari, firefox or webkit-host')
const browser: BrowserKind = browserArg
// webkit-host runs installed Safari's engine, so it takes Safari's cases.
const caseBrowser: BrowserKind = browser === 'webkit-host' ? 'safari' : browser
const casesPath = args.get('cases') ?? fail('--cases is required')
const outDir = resolve(args.get('out') ?? fail('--out is required'))
function positiveInteger(name: string, fallback: number): number {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) fail(`--${name} must be a positive integer`)
  return value
}
const limit = positiveInteger('limit', Number.MAX_SAFE_INTEGER)
const chunkSize = positiveInteger('chunk', 25)
const stallMs = positiveInteger('stall-ms', 120_000)
const familyFilter = args.get('family')
const predictorPath = resolve(args.get('predictor') ?? join(LAB_DIR, 'predictor.ts'))

// ---- Cases ----

type FontFixture = { family: string; weight: string; file: string; sha256: string }
const FONT_FIXTURES = JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8')) as FontFixture[]

function sameFont(a: FontDecl, b: FontDecl): boolean {
  return a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
}

function caseProblem(c: Case): string | null {
  if (typeof c.id !== 'string' || c.id === '') return 'id must be a non-empty string'
  if (typeof c.family !== 'string') return 'family must be a string'
  if (typeof c.pageLang !== 'string' || c.pageLang === '') return 'pageLang must be a non-empty string'
  if (c.fontFixtures !== undefined) {
    if (!Array.isArray(c.fontFixtures)) return 'fontFixtures must be an array'
    for (let i = 0; i < c.fontFixtures.length; i++) {
      if (!FONT_FIXTURES.some(fixture => fixture.family === c.fontFixtures![i])) return `unknown font fixture ${c.fontFixtures[i]}`
    }
  }
  const p = c.paragraph
  if (typeof p !== 'object' || p === null || !Array.isArray(p.runs)) return 'paragraph.runs must be an array'
  // An empty lang is a real case: lang="" marks the paragraph's language as unknown instead of inheriting <html lang>.
  if (typeof p.lang !== 'string') return 'paragraph.lang must be a string'
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    if (typeof run.text !== 'string') return `run ${i} text must be a string`
    if (run.node !== 'span' && run.node !== 'text') return `run ${i} node must be span or text`
    if (run.node === 'text' && (!sameFont(run.font, p.font) || run.letterSpacing !== p.letterSpacing
      || run.wordSpacing !== p.wordSpacing || (run.lang !== null && run.lang !== p.lang))) {
      return `bare text run ${i} must carry the paragraph's font, spacing and lang`
    }
  }
  return null
}

function fixtureFamilies(c: Case): string[] {
  return [...new Set(c.fontFixtures ?? [])].sort()
}

// A page context is a page language plus the fixture web fonts the page loads before measuring anything.
function contextKey(lang: string, families: string[]): string {
  return JSON.stringify([lang, families])
}

// Cases grouped by page context, stable in order of first appearance, so the page reloads once per context (a fresh
// document, so Canvas contexts start under the new language) and installed-font cases never share a document with
// web fonts.
const casesByContext = new Map<string, Case[]>()
{
  const lines = readFileSync(casesPath, 'utf8').split('\n')
  const ids = new Set<string>()
  let selected = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue
    let c: Case
    try {
      c = JSON.parse(lines[i]!) as Case
    } catch (error) {
      fail(`${casesPath}:${i + 1}: ${message(error)}`)
    }
    const problem = caseProblem(c)
    if (problem !== null) fail(`${casesPath}:${i + 1}: ${problem}`)
    if (ids.has(c.id)) fail(`${casesPath}:${i + 1}: duplicate id ${c.id}`)
    ids.add(c.id)
    if (c.browsers !== undefined && !c.browsers.includes(caseBrowser)) continue
    if (familyFilter !== undefined && !c.family.includes(familyFilter)) continue
    if (selected >= limit) continue
    selected++
    const key = contextKey(c.pageLang, fixtureFamilies(c))
    if (!casesByContext.has(key)) casesByContext.set(key, [])
    casesByContext.get(key)!.push(c)
  }
}
const cases: Case[] = [...casesByContext.values()].flat()
if (cases.length === 0) fail('No cases selected')
{
  // Fixture bytes are checked once here; the page loads them as FontFace objects.
  const used = new Set(cases.flatMap(fixtureFamilies))
  for (let i = 0; i < FONT_FIXTURES.length; i++) {
    const fixture = FONT_FIXTURES[i]!
    if (!used.has(fixture.family)) continue
    const digest = new Bun.CryptoHasher('sha256').update(readFileSync(join(FONTS_DIR, fixture.file))).digest('hex')
    if (digest !== fixture.sha256) fail(`Font fixture ${fixture.file} changed`)
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
    console.error(`[lab] could not trash ${path}: ${message(error)}`)
  }
}

// Chrome and Firefox start through LaunchServices without activation (`open -g`), each in its own profile under
// .artifacts/profiles so the session watchdog sees them. macOS 27 blocks shell-spawned Firefox from its data folders.
// One attempt only: a failed launch can show the user a dialog.
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
      await stopProcess(owned)
      // Helpers can hold the profile for a moment after the main process exits.
      await Bun.sleep(1_000)
      trash(profile)
    },
  }
}

// Chrome activates itself whenever it shows a browser window the normal way (NativeWidgetNSWindowBridge calls
// activateIgnoringOtherApps), `open -g` or not: a startup window took focus for about half a second. So Chrome starts
// with no window, and the lab opens its one window through the DevTools protocol with Target.createTarget { newWindow,
// background }, which Chrome shows inactive (NavigateParams kShowWindowInactive). The protocol is used for nothing
// else; the page drives itself as in the other browsers.
async function launchChrome(url: string, runId: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `lab-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  const session = await launchApp(CHROME_APP, `${CHROME_APP}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--window-size=1200,900', '--no-startup-window', '--remote-debugging-port=0',
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
  // Chrome writes the chosen port and the browser endpoint's path here once DevTools listens.
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

function launchFirefox(url: string, runId: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `lab-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  return launchApp(FIREFOX_APP, `${FIREFOX_APP}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile,
    ['--new-instance', '--profile', profile, url])
}

function appleScript(lines: string[]): string {
  return execFileSync('osascript', lines.flatMap(line => ['-e', line]), { encoding: 'utf8', timeout: 15_000 }).trim()
}

function frontmostApp(): string | null {
  try {
    return appleScript(['tell application "System Events"', 'return name of first application process whose frontmost is true', 'end tell'])
  } catch {
    return null
  }
}

// Safari has no disposable-profile route on macOS 27 (safaridriver doesn't work), so the lab owns one single-tab
// window in the user's Safari through AppleScript, never activating it; if Safari takes focus anyway, give it back.
function backgroundAppleScript(lines: string[]): string {
  const front = frontmostApp()
  try {
    return appleScript(lines)
  } finally {
    if (front !== null && frontmostApp() !== front) {
      try { appleScript([`tell application ${JSON.stringify(front)} to activate`]) } catch { /* best effort */ }
    }
  }
}

// A new document in a frontmost Safari opens over the user's windows and takes keyboard focus there, and handing focus
// back afterwards doesn't undo that. So the lab window is only created while Safari is in the background.
async function launchSafari(url: string, runId: string, baseUrl: string): Promise<Session> {
  const waitStart = Date.now()
  for (let announced = false; frontmostApp() === 'Safari';) {
    if (Date.now() - waitStart > 10 * 60_000) throw new Error('Safari stayed the frontmost app for 10 minutes; not opening the lab window over the user\'s windows')
    if (!announced) console.log('[lab] safari: waiting until Safari is no longer the frontmost app')
    announced = true
    await Bun.sleep(2_000)
  }
  const marker = `about:blank#pretext-lab-${runId}`
  const windowId = Number.parseInt(backgroundAppleScript([
    'tell application "Safari"',
    `make new document with properties {URL:${JSON.stringify(marker)}}`,
    'repeat with targetWindow in windows',
    `if (count of tabs of targetWindow) is 1 and URL of tab 1 of targetWindow is ${JSON.stringify(marker)} then return id of targetWindow as string`,
    'end repeat',
    'end tell',
  ]), 10)
  if (!Number.isFinite(windowId)) throw new Error('Could not find the Safari lab window')
  backgroundAppleScript([
    'tell application "Safari"',
    `set targetWindow to first window whose id is ${windowId}`,
    `set URL of tab 1 of targetWindow to ${JSON.stringify(url)}`,
    'end tell',
  ])
  const owns = (tabUrl: string): boolean => tabUrl === marker || tabUrl.startsWith(`${baseUrl}/lab?run=${runId}`)
  return {
    async close() {
      try {
        const urls = appleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          'set tabURLs to {}',
          'repeat with targetTab in tabs of targetWindow',
          'set end of tabURLs to URL of targetTab',
          'end repeat',
          "set AppleScript's text item delimiters to linefeed",
          'return tabURLs as string',
          'end tell',
        ]).split('\n').filter(owns)
        // Close only a uniquely identifiable owned tab, never a window the user changed.
        if (urls.length !== 1) return
        appleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          `set ownedTabs to tabs of targetWindow whose URL is ${JSON.stringify(urls[0])}`,
          'if (count of ownedTabs) is 1 then close item 1 of ownedTabs',
          'end tell',
        ])
      } catch {
        // The owned window may already be gone.
      }
    },
  }
}

// The system WebKit.framework, the engine installed Safari runs, in a background WKWebView app built by
// rebuild/tools/webkit-host/build.sh. The driver spawns it directly. It never activates, keeps its window behind every
// normal window, and exits when the page's title is 'lab done' or when the driver exits. One attempt only.
async function launchWebKitHost(url: string): Promise<Session> {
  const executable = resolve(LAB_DIR, '../../.artifacts/webkit-host/webkit-host')
  if (!await Bun.file(executable).exists()) throw new Error(`${executable} is missing; build it with rebuild/tools/webkit-host/build.sh`)
  const host = Bun.spawn([executable, `--url=${url}`, '--width=1440', '--height=900', '--exit-title=lab done'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
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

// ---- Server ----

async function buildBundle(): Promise<string> {
  const build = await Bun.build({
    entrypoints: [join(LAB_DIR, 'page.ts')],
    target: 'browser',
    format: 'esm',
    plugins: [{
      name: 'lab-predictor',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/predictor\.ts$/ }, () => ({ path: predictorPath }))
      },
    }],
  })
  if (!build.success) throw new Error(build.logs.map(String).join('\n'))
  return await build.outputs[0]!.text()
}

function portInUse(port: number): boolean {
  return Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0
}

type PageRow = Omit<LabRow, 'family' | 'browser' | 'case'>
type Pending = { seq: number; start: number; end: number; sends: number }

const runId = randomUUID()
const startedAt = new Date()
mkdirSync(outDir, { recursive: true })
const rowsPath = join(outDir, `${browser}-rows.ndjson`)
const runPath = join(outDir, `${browser}-run.json`)
const errors: string[] = []
const totals = { selected: cases.length, rows: 0, chunks: 0, navigations: 0, resends: 0, nativeErrors: 0, predictionErrors: 0, painterErrors: 0, rejectedStyleRows: 0, missingFontRows: 0 }
const missingFontCounts = new Map<string, number>()
const envs = new Map<string, number>()
const visibility = new Map<string, number>()
let firstEnv: PageRow['env'] | null = null
let next = 0
let seqCounter = 0
let pending: Pending | null = null
let navigationsWithoutProgress = 0
let lastActivity = Date.now()
// When the page first asked for work, so launch time and case throughput can be told apart.
let firstStepAt: number | null = null
let settle: { resolve: () => void; reject: (error: Error) => void } | null = null
const completion = new Promise<void>((resolve, reject) => { settle = { resolve, reject } })
completion.catch(() => {})
const rowsFd = openSync(rowsPath, 'w')

function stopRun(error: Error): void {
  settle?.reject(error)
}

function writeRows(rows: PageRow[], start: number): void {
  let text = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const c = cases[start + i]!
    if (row.id !== c.id) throw new Error(`Row ${i} of the chunk is ${row.id}; expected ${c.id}`)
    const full: LabRow = { id: c.id, family: c.family, browser, case: c, env: row.env, native: row.native, prediction: row.prediction, painter: row.painter, timings: row.timings }
    text += JSON.stringify(full) + '\n'
    if ('error' in row.native) totals.nativeErrors++
    else if (row.native.rejectedStyles.length > 0) totals.rejectedStyleRows++
    if (!('error' in row.native) && (row.native.missingFonts ?? []).length > 0) {
      totals.missingFontRows++
      for (const family of row.native.missingFonts!) missingFontCounts.set(family, (missingFontCounts.get(family) ?? 0) + 1)
    }
    if ('error' in row.prediction) totals.predictionErrors++
    if (row.painter !== null && 'error' in row.painter) totals.painterErrors++
    const key = JSON.stringify({ userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, visualViewportScale: row.env.visualViewportScale })
    envs.set(key, (envs.get(key) ?? 0) + 1)
    visibility.set(row.env.visibilityState, (visibility.get(row.env.visibilityState) ?? 0) + 1)
    firstEnv ??= row.env
  }
  writeSync(rowsFd, text)
  totals.rows += rows.length
}

async function step(request: Request): Promise<Response> {
  const body = await request.json() as { runId: string; pageLang: string; fonts: string[]; seq: number | null; rows: PageRow[] }
  if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
  firstStepAt ??= Date.now()
  if (body.seq !== null) {
    if (pending === null || body.seq !== pending.seq) throw new Error(`Page acknowledged chunk ${body.seq}; pending is ${pending?.seq ?? 'none'}`)
    if (!Array.isArray(body.rows) || body.rows.length !== pending.end - pending.start) throw new Error(`Chunk ${pending.seq} returned ${body.rows?.length} rows; expected ${pending.end - pending.start}`)
    writeRows(body.rows, pending.start)
    totals.chunks++
    next = pending.end
    pending = null
    navigationsWithoutProgress = 0
    if (cases.length <= 1000 || Math.floor(next / 1000) !== Math.floor((next - body.rows.length) / 1000) || next === cases.length) {
      console.log(`[lab] ${browser}: ${next}/${cases.length} rows`)
    }
  } else if (pending !== null) {
    // The page restarted before acknowledging its chunk; send it again, a bounded number of times.
    if (pending.sends >= 3) throw new Error(`Chunk ${pending.seq} was sent 3 times without an acknowledgement`)
    totals.resends++
  }
  if (pending === null && next >= cases.length) {
    settle?.resolve()
    return Response.json({ kind: 'done' })
  }
  const start = pending?.start ?? next
  const lang = cases[start]!.pageLang
  const fonts = fixtureFamilies(cases[start]!)
  const key = contextKey(lang, fonts)
  if (key !== contextKey(body.pageLang, body.fonts)) {
    if (++navigationsWithoutProgress > 3) throw new Error(`Page kept reporting context ${contextKey(body.pageLang, body.fonts)}; needed ${key}`)
    totals.navigations++
    return Response.json({ kind: 'navigate', lang, fonts })
  }
  if (pending === null) {
    let end = start
    while (end < cases.length && end - start < chunkSize && contextKey(cases[end]!.pageLang, fixtureFamilies(cases[end]!)) === key) end++
    pending = { seq: seqCounter++, start, end, sends: 0 }
  }
  pending.sends++
  return Response.json({ kind: 'chunk', seq: pending.seq, browser, cases: cases.slice(pending.start, pending.end) })
}

function pageHtml(lang: string, families: string[]): string {
  const escaped = lang.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
  const fixtures = FONT_FIXTURES.filter(fixture => families.includes(fixture.family)).map(fixture => ({ family: fixture.family, weight: fixture.weight, url: `/fonts/${fixture.file}` }))
  return `<!doctype html><html lang="${escaped}"><head><meta charset="utf-8"><title>pretext-rebuild lab</title>`
    + '<style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>'
    + `<script id="lab-fonts" type="application/json">${JSON.stringify(fixtures).replace(/</g, '\\u003c')}</script>`
    + '<script type="module" src="/page.js"></script></body></html>'
}

let session: Session | null = null
let server: ReturnType<typeof Bun.serve> | null = null
let bundleBytes = 0
process.on('SIGINT', () => stopRun(new Error('Interrupted')))
process.on('SIGTERM', () => stopRun(new Error('Terminated')))
try {
  const bundle = await buildBundle()
  bundleBytes = bundle.length
  const noStore = { 'cache-control': 'no-store' }
  const fetchHandler = async (request: Request): Promise<Response> => {
    lastActivity = Date.now()
    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case '/lab': {
          if (url.searchParams.get('run') !== runId) return new Response('Inactive run', { status: 409 })
          const families = (url.searchParams.get('fonts') ?? '').split('|').filter(family => family !== '').sort()
          if (families.some(family => !FONT_FIXTURES.some(fixture => fixture.family === family))) return new Response('Unknown font fixture', { status: 400 })
          return new Response(pageHtml(url.searchParams.get('lang') ?? '', families), { headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } })
        }
        case '/page.js':
          return new Response(bundle, { headers: { ...noStore, 'content-type': 'text/javascript; charset=utf-8' } })
        case '/api/step':
          if (request.method !== 'POST') return new Response('POST required', { status: 405 })
          return await step(request)
        case '/api/fatal': {
          const body = await request.json() as { runId: string; message: string }
          if (body.runId === runId) stopRun(new Error(`Page error: ${body.message}`))
          return new Response('ok')
        }
        case '/favicon.ico':
          return new Response(null, { status: 204 })
        default: {
          const fixture = FONT_FIXTURES.find(font => url.pathname === `/fonts/${font.file}`)
          return fixture === undefined
            ? new Response('Not found', { status: 404 })
            : new Response(Bun.file(join(FONTS_DIR, fixture.file)), { headers: { 'content-type': 'font/ttf' } })
        }
      }
    } catch (error) {
      stopRun(error instanceof Error ? error : new Error(String(error)))
      return new Response(message(error), { status: 400 })
    }
  }
  for (let port = 3002; port < 3100 && server === null; port++) {
    if (portInUse(port)) continue
    try {
      server = Bun.serve({ hostname: '127.0.0.1', port, fetch: fetchHandler })
    } catch {
      // Taken between the check and the bind.
    }
  }
  if (server === null) throw new Error('No free port in 3002-3099')
  const baseUrl = `http://127.0.0.1:${server.port}`
  const first = cases[0]!
  const url = `${baseUrl}/lab?run=${runId}&lang=${encodeURIComponent(first.pageLang)}&fonts=${encodeURIComponent(fixtureFamilies(first).join('|'))}`
  console.log(`[lab] ${browser}: ${cases.length} cases, ${casesByContext.size} page contexts; serving ${baseUrl}`)
  switch (browser) {
    case 'chrome': session = await launchChrome(url, runId); break
    case 'firefox': session = await launchFirefox(url, runId); break
    case 'safari': session = await launchSafari(url, runId, baseUrl); break
    case 'webkit-host': session = await launchWebKitHost(url); break
  }
  lastActivity = Date.now()
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > stallMs) stopRun(new Error(`No page activity for ${stallMs}ms; ${totals.rows}/${cases.length} rows written`))
  }, 1_000)
  try {
    await completion
  } finally {
    clearInterval(watchdog)
  }
  if (totals.rows !== cases.length) errors.push(`Wrote ${totals.rows} rows for ${cases.length} cases`)
  if (totals.nativeErrors > 0) errors.push(`${totals.nativeErrors} native observation errors`)
  if (envs.size > 1) errors.push(`The environment changed during the run: ${[...envs.keys()].join(' | ')}`)
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
  closeSync(rowsFd)
  const finishedAt = new Date()
  writeFileSync(runPath, JSON.stringify({
    status: errors.length === 0 ? 'ok' : 'error',
    errors,
    browser, runId, casesFile: resolve(casesPath), rowsFile: rowsPath, predictor: predictorPath,
    family: familyFilter ?? null, limit: limit === Number.MAX_SAFE_INTEGER ? null : limit, chunkSize, bundleBytes,
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime(),
    // From the start to the page's first request (bundle, launch, page load), then from there to the end.
    launchMs: firstStepAt === null ? null : firstStepAt - startedAt.getTime(),
    casesMs: firstStepAt === null ? null : finishedAt.getTime() - firstStepAt,
    totals,
    missingFonts: Object.fromEntries(missingFontCounts),
    pageContexts: [...casesByContext].map(([key, list]) => ({ context: JSON.parse(key) as [string, string[]], cases: list.length })),
    env: firstEnv,
    envs: [...envs].map(([key, rows]) => ({ ...JSON.parse(key) as object, rows })),
    visibility: Object.fromEntries(visibility),
  }, null, 2) + '\n')
  console.log(`[lab] ${browser}: ${errors.length === 0 ? 'ok' : 'error'}; ${totals.rows} rows; ${runPath}`)
  if (totals.missingFontRows > 0) console.log(`[lab] ${browser}: ${totals.missingFontRows} rows name families the page couldn't resolve: ${[...missingFontCounts].map(([family, rows]) => `${family} (${rows})`).join(', ')}`)
  for (let i = 0; i < errors.length; i++) console.error(`[lab] ${errors[i]}`)
}
process.exit(errors.length === 0 ? 0 : 1)
