// Probe driver: validates a probe file, serves the page bundle, opens one background browser session and writes the raw
// observations to <out>/<browser>-probes.json. Always run it under the shared browser lock (this script doesn't take it):
//   python3 .artifacts/session/with-browser-lock.py probes-chrome -- bun rebuild/probes/runner.ts --browser=chrome --probes=<file>
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { basename, extname, join, resolve } from 'node:path'
import { createBrowserSession, getAvailablePort } from '../../scripts/browser-automation.ts'
import { CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild } from '../lab/browser-build.ts'
import { CANVAS_PROPERTIES } from './types.ts'
import type { BrowserKind, PageEnv, Probe, ProbeOutput, ProbeResult } from './types.ts'

const PROBES_DIR = import.meta.dir
const REPO = resolve(PROBES_DIR, '../..')
const PROFILES_DIR = join(REPO, '.artifacts/profiles')
const FONTS_DIR = join(REPO, 'tests/wrapping/fonts')

function fail(text: string): never {
  console.error(`[probes] ${text}`)
  process.exit(1)
}

function message(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

// ---- Arguments ----

const USAGE = 'Usage: bun rebuild/probes/runner.ts --browser=chrome|safari|firefox|webkit-host --probes=<file.json|module.ts> [--out=<dir>] [--only=<id substring>] [--probe-timeout-ms=N] [--stall-ms=N] [--firefox-prefs=<file.json>] [--chrome-args=<switches>] [--chrome-emulate-dsf=N] [--allow-safari-frontmost] [--dry-run]'
const KNOWN = ['browser', 'probes', 'out', 'only', 'probe-timeout-ms', 'stall-ms', 'firefox-prefs', 'chrome-args', 'chrome-emulate-dsf', 'allow-safari-frontmost', 'dry-run']
const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null || !KNOWN.includes(match[1]!)) fail(`Unknown argument ${raw}. ${USAGE}`)
  args.set(match[1]!, match[2] ?? '')
}
const dryRun = args.has('dry-run')
const browserArg = args.get('browser')
if (browserArg !== 'chrome' && browserArg !== 'safari' && browserArg !== 'firefox' && browserArg !== 'webkit-host') fail(`--browser must be chrome, safari, firefox or webkit-host. ${USAGE}`)
const browser: BrowserKind = browserArg
// webkit-host runs installed Safari's engine, so it takes Safari's probes.
const probeBrowser: BrowserKind = browser === 'webkit-host' ? 'safari' : browser
// The build the run observes, read from the app bundles before launch; the output records it, so facts extracted from it
// name their build (rebuild/tests/facts.ts).
const build = readBuild(browser)
// The app the run launches (lab/browser-build.ts): Chrome and Firefox are the lab's pinned copies, never the installed apps.
const app = labApp(browser)
const probesPath = resolve(args.get('probes') ?? fail(`--probes is required. ${USAGE}`))
const outDir = resolve(args.get('out') ?? join(REPO, '.artifacts/probes', basename(probesPath, extname(probesPath))))
const only = args.get('only') ?? null
function positiveInteger(name: string, fallback: number): number {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) fail(`--${name} must be a positive integer`)
  return value
}
// Opens the Safari probe window without waiting for Safari to leave the front (see launchSafari).
const allowSafariFrontmost = args.has('allow-safari-frontmost')
if (allowSafariFrontmost && args.get('allow-safari-frontmost') !== '') fail('--allow-safari-frontmost takes no value')
if (allowSafariFrontmost && browser !== 'safari') fail('--allow-safari-frontmost applies only to --browser=safari')
const probeTimeoutMs = positiveInteger('probe-timeout-ms', 20_000)
const stallMs = positiveInteger('stall-ms', 90_000)
// Extra Firefox prefs written to the profile's user.js, for example { "layout.css.devPixelsPerPx": "1.0" } to change
// app units per device pixel. Only string, number and boolean values.
const firefoxPrefs: Array<[string, boolean | string | number]> = (() => {
  const path = args.get('firefox-prefs')
  if (path === undefined) return []
  if (browser !== 'firefox') fail('--firefox-prefs applies only to --browser=firefox')
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('--firefox-prefs must be a JSON object')
  const entries = Object.entries(parsed as Record<string, unknown>)
  for (let i = 0; i < entries.length; i++) {
    const value = entries[i]![1]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') fail(`--firefox-prefs: ${entries[i]![0]} must be a string, number or boolean`)
  }
  return entries as Array<[string, boolean | string | number]>
})()
// Extra Chrome command-line switches separated by spaces, for example --force-device-scale-factor=1 to lay out at
// layout zoom 1 on a Retina screen.
const chromeArgs: string[] = (() => {
  const raw = args.get('chrome-args')
  if (raw === undefined) return []
  if (browser !== 'chrome') fail('--chrome-args applies only to --browser=chrome')
  const list = raw.split(/\s+/).filter(arg => arg !== '')
  if (list.some(arg => !arg.startsWith('--'))) fail('--chrome-args must be switches starting with --')
  return list
})()
// DevTools device emulation with this device scale factor, applied before the first navigation and kept for the run. A
// probe's script changes it mid-page with a POST to /api/chrome-dsf, { runId, deviceScaleFactor }, which answers once
// Chrome has applied it; the script puts the run's factor back before it returns, since the run checks that the pages'
// device pixel ratio never moved between probes.
const chromeEmulateDsf: number | null = (() => {
  const raw = args.get('chrome-emulate-dsf')
  if (raw === undefined) return null
  if (browser !== 'chrome') fail('--chrome-emulate-dsf applies only to --browser=chrome')
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) fail('--chrome-emulate-dsf must be a positive number')
  return value
})()

// ---- Probes ----

type FontFixture = { family: string; weight: string; file: string; sha256: string }
const FONT_FIXTURES = JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8')) as FontFixture[]
const BROWSERS = ['chrome', 'safari', 'firefox']
const CANVAS_KINDS = ['offscreen', 'element', 'worker', 'transferred']
const PROBE_KEYS = ['id', 'spec', 'pageLang', 'html', 'setup', 'canvas', 'observe', 'hostWidth', 'fontFixtures', 'browsers', 'document', 'note']
const ENTRY_KEYS = ['kind', 'text', 'context', ...CANVAS_PROPERTIES, 'elementLang', 'elementStyle', 'pageLang', 'frames']
const OBSERVATION_KEYS: Record<string, string[]> = {
  lines: ['kind', 'selector'], boxWidth: ['kind', 'selectors'], rangeWidth: ['kind', 'selector'], canvasWidths: ['kind'],
  env: ['kind', 'families'], script: ['kind', 'source'],
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKey(value: Record<string, unknown>, known: readonly string[]): string | null {
  const keys = Object.keys(value)
  for (let i = 0; i < keys.length; i++) if (!known.includes(keys[i]!)) return keys[i]!
  return null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function probeProblem(p: Record<string, unknown>): string | null {
  const extra = unknownKey(p, PROBE_KEYS)
  if (extra !== null) return `unknown key ${extra}`
  if (typeof p['id'] !== 'string' || p['id'] === '') return 'id must be a non-empty string'
  if (typeof p['spec'] !== 'string' || p['spec'] === '') return 'spec must be a non-empty string'
  if (!('pageLang' in p) || (p['pageLang'] !== null && typeof p['pageLang'] !== 'string')) return 'pageLang must be a string, or null for a page without lang'
  for (const key of ['html', 'setup', 'document', 'note']) {
    if (p[key] !== undefined && typeof p[key] !== 'string') return `${key} must be a string`
  }
  if (p['document'] === '') return 'document must be non-empty'
  if (p['hostWidth'] !== undefined && (typeof p['hostWidth'] !== 'number' || !(p['hostWidth'] > 0) || !Number.isFinite(p['hostWidth']))) return 'hostWidth must be a positive number'
  if (p['fontFixtures'] !== undefined) {
    if (!isStringArray(p['fontFixtures'])) return 'fontFixtures must be an array of strings'
    const unknown = p['fontFixtures'].find(family => !FONT_FIXTURES.some(fixture => fixture.family === family))
    if (unknown !== undefined) return `unknown font fixture ${unknown}`
  }
  if (p['browsers'] !== undefined && (!isStringArray(p['browsers']) || p['browsers'].some(name => !BROWSERS.includes(name)))) return 'browsers must list chrome, safari or firefox'
  const entries = p['canvas']
  if (entries !== undefined) {
    if (!Array.isArray(entries) || entries.length === 0) return 'canvas must be a non-empty array'
    const contextKinds = new Map<string, unknown>()
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as unknown
      if (!isObject(entry)) return `canvas[${i}] must be an object`
      const entryExtra = unknownKey(entry, ENTRY_KEYS)
      if (entryExtra !== null) return `canvas[${i}]: unknown key ${entryExtra}`
      if (!CANVAS_KINDS.includes(entry['kind'] as string)) return `canvas[${i}]: kind must be ${CANVAS_KINDS.join(', ')}`
      if (typeof entry['text'] !== 'string') return `canvas[${i}]: text must be a string`
      for (const key of [...CANVAS_PROPERTIES, 'context', 'elementLang', 'elementStyle']) {
        if (entry[key] !== undefined && typeof entry[key] !== 'string') return `canvas[${i}]: ${key} must be a string`
      }
      if (entry['pageLang'] !== undefined && entry['pageLang'] !== null && typeof entry['pageLang'] !== 'string') return `canvas[${i}]: pageLang must be a string or null`
      const context = entry['context'] as string | undefined
      const first = context === undefined || !contextKinds.has(context)
      if (context !== undefined) {
        if (!first && contextKinds.get(context) !== entry['kind']) return `canvas[${i}]: context ${context} was created as ${String(contextKinds.get(context))}`
        contextKinds.set(context, entry['kind'])
      }
      if (first && entry['font'] === undefined) return `canvas[${i}]: the first entry of a context must set font`
      const elementKind = entry['kind'] === 'element' || entry['kind'] === 'transferred'
      if ((entry['elementLang'] !== undefined || entry['elementStyle'] !== undefined) && (!elementKind || !first)) {
        return `canvas[${i}]: elementLang and elementStyle apply only to the first entry of an element or transferred context`
      }
      if (entry['frames'] !== undefined) {
        if (!Number.isSafeInteger(entry['frames']) || (entry['frames'] as number) < 0) return `canvas[${i}]: frames must be a non-negative integer`
        if (entry['kind'] !== 'offscreen' && entry['kind'] !== 'element') return `canvas[${i}]: frames apply only to offscreen and element contexts`
      }
    }
  }
  const observe = p['observe']
  if (!Array.isArray(observe) || observe.length === 0) return 'observe must be a non-empty array'
  let measuresCanvas = false
  for (let i = 0; i < observe.length; i++) {
    const spec = observe[i] as unknown
    const kind = typeof spec === 'string' ? spec : isObject(spec) ? spec['kind'] : undefined
    if (typeof kind !== 'string' || OBSERVATION_KEYS[kind] === undefined) return `observe[${i}]: unknown observation`
    if (kind === 'script' && typeof spec === 'string') return `observe[${i}]: script needs { kind: 'script', source }`
    if (isObject(spec)) {
      const extra = unknownKey(spec, OBSERVATION_KEYS[kind]!)
      if (extra !== null) return `observe[${i}]: unknown key ${extra}`
      if (spec['selector'] !== undefined && typeof spec['selector'] !== 'string') return `observe[${i}]: selector must be a string`
      if (kind === 'boxWidth' && (!isStringArray(spec['selectors']) || spec['selectors'].length === 0)) return `observe[${i}]: selectors must be a non-empty array of strings`
      if (kind === 'env' && spec['families'] !== undefined && !isStringArray(spec['families'])) return `observe[${i}]: families must be an array of strings`
      if (kind === 'script' && typeof spec['source'] !== 'string') return `observe[${i}]: source must be a string`
    }
    const onElement = (kind === 'lines' || kind === 'rangeWidth') && (typeof spec === 'string' || (spec as Record<string, unknown>)['selector'] === undefined)
    if ((onElement || spec === 'boxWidth') && p['html'] === undefined) return `observe[${i}]: ${kind} on the test element needs html`
    if (kind === 'canvasWidths') {
      if (entries === undefined) return `observe[${i}]: canvasWidths needs canvas entries`
      if (measuresCanvas) return `observe[${i}]: canvasWidths may appear once`
      measuresCanvas = true
    }
  }
  if (entries !== undefined && !measuresCanvas) return 'canvas entries run only through a canvasWidths observation'
  return null
}

async function loadProbeList(): Promise<unknown[]> {
  let loaded: unknown
  if (extname(probesPath) === '.json') {
    loaded = JSON.parse(readFileSync(probesPath, 'utf8'))
  } else {
    const module = await import(probesPath) as { default?: unknown; probes?: unknown }
    loaded = module.default ?? module.probes
    if (typeof loaded === 'function') loaded = await (loaded as () => unknown)()
  }
  if (isObject(loaded) && Array.isArray(loaded['probes'])) loaded = loaded['probes']
  if (!Array.isArray(loaded)) fail(`${probesPath} must provide an array of probes (JSON array or { probes }, or a module's default or probes export)`)
  return loaded
}

type Doc = { key: string; pageLang: string | null; fixtures: string[]; probes: Probe[] }

const docs: Doc[] = []
let selected = 0
{
  const list = await loadProbeList()
  const ids = new Set<string>()
  const byKey = new Map<string, Doc>()
  for (let i = 0; i < list.length; i++) {
    const raw = list[i]
    if (!isObject(raw)) fail(`probe ${i} must be an object`)
    const problem = probeProblem(raw)
    if (problem !== null) fail(`probe ${i}${typeof raw['id'] === 'string' ? ` (${raw['id']})` : ''}: ${problem}`)
    const probe = raw as unknown as Probe
    if (ids.has(probe.id)) fail(`duplicate probe id ${probe.id}`)
    ids.add(probe.id)
    if (probe.browsers !== undefined && !probe.browsers.includes(probeBrowser)) continue
    if (only !== null && !probe.id.includes(only)) continue
    const fixtures = [...new Set(probe.fontFixtures ?? [])].sort()
    const key = probe.document !== undefined ? `document:${probe.document}` : `probe:${probe.id}`
    let doc = byKey.get(key)
    if (doc === undefined) {
      doc = { key, pageLang: probe.pageLang, fixtures, probes: [] }
      byKey.set(key, doc)
      docs.push(doc)
    } else if (doc.pageLang !== probe.pageLang || doc.fixtures.join('|') !== fixtures.join('|')) {
      fail(`probe ${probe.id}: document ${probe.document} already has pageLang ${JSON.stringify(doc.pageLang)} and fixtures [${doc.fixtures.join(', ')}]`)
    }
    doc.probes.push(probe)
    selected++
  }
  if (selected === 0) fail('No probes selected')
  const used = new Set(docs.flatMap(doc => doc.fixtures))
  for (let i = 0; i < FONT_FIXTURES.length; i++) {
    const fixture = FONT_FIXTURES[i]!
    if (!used.has(fixture.family)) continue
    const digest = new Bun.CryptoHasher('sha256').update(readFileSync(join(FONTS_DIR, fixture.file))).digest('hex')
    if (digest !== fixture.sha256) fail(`Font fixture ${fixture.file} changed`)
  }
}

if (dryRun) {
  console.log(`[probes] ${browser}: ${selected} probes valid, ${docs.length} documents; would write ${join(outDir, `${browser}-probes.json`)}`)
  process.exit(0)
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

async function waitForPid(executable: string, marker: string): Promise<number | null> {
  for (let i = 0; i < 100; i++) {
    const pid = findPid(executable, marker)
    if (pid !== null) return pid
    await Bun.sleep(100)
  }
  return null
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`[probes] could not remove ${path}: ${message(error)}`)
  }
}

function openApp(app: string, appArgs: string[]): void {
  execFileSync('open', ['-n', '-g', '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
}

async function closeLaunched(pid: number, profile: string): Promise<void> {
  await stopProcess(pid)
  // Helpers can hold the profile for a moment after the main process exits.
  await Bun.sleep(1_000)
  remove(profile)
}

// The lab's pinned Chrome (lab/browser-build.ts), headed, in its own profile under .artifacts/profiles, started through LaunchServices without
// activation. Headless Chrome can lay out at zoom 1 while reporting DPR 2. One attempt only.
//
// Chrome activates itself whenever it shows a browser window the normal way, `open -g` or not (a startup window takes
// focus for about half a second). So Chrome starts with no window, and the driver opens its one window through the
// DevTools protocol with Target.createTarget { newWindow, background }, which Chrome shows inactive (as in
// rebuild/lab/run.ts). With --chrome-emulate-dsf the driver attaches to that target, applies the device metrics override
// before navigating, and keeps the socket open for the run, because closing the session drops the override.
async function launchChrome(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `probes-chrome-${runId}`)
  mkdirSync(profile, { recursive: true })
  openApp(app!.path, [
    `--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--window-size=1200,900', '--no-startup-window', '--remote-debugging-port=0',
    ...chromeArgs,
  ])
  const pid = await waitForPid(`${app!.path}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`)
  if (pid === null) {
    remove(profile)
    throw new Error('Could not find the launched Chrome process')
  }
  let cdp: Cdp | null = null
  const session: Session = {
    async close() {
      cdp?.close()
      await closeLaunched(pid, profile)
    },
  }
  try {
    cdp = await connectCdp(await devToolsEndpoint(profile, pid))
    if (chromeEmulateDsf === null) {
      await cdp.send('Target.createTarget', { url, newWindow: true, background: true })
      cdp.close()
      cdp = null
    } else {
      const created = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true }) as { targetId: string }
      const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true }) as { sessionId: string }
      const socket = cdp
      overrideChromeDsf = deviceScaleFactor => socket.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor, mobile: false }, attached.sessionId)
      await overrideChromeDsf(chromeEmulateDsf)
      await cdp.send('Page.navigate', { url }, attached.sessionId)
    }
    return session
  } catch (error) {
    await session.close()
    throw error
  }
}

type Cdp = { send: (method: string, params: Record<string, unknown>, sessionId?: string) => Promise<unknown>; close: () => void }

// The device metrics override of the run's page, where the run emulates one (launchChrome).
let overrideChromeDsf: ((deviceScaleFactor: number) => Promise<unknown>) | null = null

// Chrome writes the DevTools port it chose and the browser endpoint's path into the profile once it listens.
async function devToolsEndpoint(profile: string, pid: number): Promise<string> {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 150; i++) {
    if (!isAlive(pid)) throw new Error('Chrome exited during startup')
    try {
      const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(portFile, 'utf8'))
      if (match !== null) return `ws://127.0.0.1:${match[1]}${match[2]}`
    } catch {
      // Not written yet.
    }
    await Bun.sleep(100)
  }
  throw new Error('Chrome did not write DevToolsActivePort')
}

async function connectCdp(endpoint: string): Promise<Cdp> {
  const ws = new WebSocket(endpoint)
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 1
  ws.onmessage = event => {
    const reply = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
    if (reply.id === undefined) return
    const request = pending.get(reply.id)
    if (request === undefined) return
    pending.delete(reply.id)
    if (reply.error !== undefined) request.reject(new Error(reply.error.message))
    else request.resolve(reply.result)
  }
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools')), 10_000)
    ws.onopen = () => { clearTimeout(timer); done() }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Chrome DevTools connection failed')) }
  })
  const rejectAll = (): void => {
    for (const request of pending.values()) request.reject(new Error('Chrome DevTools connection closed'))
    pending.clear()
  }
  ws.onclose = rejectAll
  ws.onerror = rejectAll
  return {
    send(method, params, sessionId) {
      const id = nextId++
      return new Promise<unknown>((done, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for Chrome DevTools ${method}`)) }, 15_000)
        pending.set(id, {
          resolve: value => { clearTimeout(timer); done(value) },
          reject: error => { clearTimeout(timer); reject(new Error(`Chrome DevTools ${method}: ${error.message}`)) },
        })
        ws.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }))
      })
    },
    close() {
      rejectAll()
      ws.close()
    },
  }
}

type BidiResponse = { id?: number; result?: unknown; error?: string; message?: string }
type Bidi = { send: (method: string, params: Record<string, unknown>) => Promise<BidiResponse>; close: () => void }

async function waitForPort(port: number, pid: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!isAlive(pid)) throw new Error('Firefox exited during startup')
    const open = await new Promise<boolean>(done => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); done(true) })
      socket.once('error', () => { socket.destroy(); done(false) })
    })
    if (open) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for Firefox's remote debugging port ${port}`)
}

async function connectBidi(port: number): Promise<Bidi> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`)
  const pending = new Map<number, { resolve: (response: BidiResponse) => void; reject: (error: Error) => void }>()
  let nextId = 1
  ws.onmessage = event => {
    const response = JSON.parse(String(event.data)) as BidiResponse
    if (response.id === undefined) return
    const request = pending.get(response.id)
    if (request === undefined) return
    pending.delete(response.id)
    request.resolve(response)
  }
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Firefox BiDi')), 10_000)
    ws.onopen = () => { clearTimeout(timer); done() }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Firefox BiDi connection failed')) }
  })
  const rejectAll = (): void => {
    for (const request of pending.values()) request.reject(new Error('Firefox BiDi connection closed'))
    pending.clear()
  }
  ws.onclose = rejectAll
  ws.onerror = rejectAll
  return {
    send(method, params) {
      const id = nextId++
      return new Promise<BidiResponse>((done, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for Firefox BiDi ${method}`)) }, 10_000)
        pending.set(id, { resolve: response => { clearTimeout(timer); done(response) }, reject: error => { clearTimeout(timer); reject(error) } })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      rejectAll()
      ws.close()
    },
  }
}

async function bidiCall(bidi: Bidi, method: string, params: Record<string, unknown>): Promise<unknown> {
  const response = await bidi.send(method, params)
  if (response.error !== undefined) throw new Error(`Firefox BiDi ${method}: ${response.message ?? response.error}`)
  return response.result
}

// Headed Firefox in the background through LaunchServices (macOS 27 blocks a shell-spawned Firefox from its data
// folders; headless Firefox draws emoji at odd widths), in its own profile, navigated over WebDriver BiDi. One attempt.
async function launchFirefox(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `probes-firefox-${runId}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string | number]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
    ...FIREFOX_PIN_PREFS, ...firefoxPrefs,
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  const port = await getAvailablePort()
  openApp(app!.path, ['--new-instance', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'])
  const pid = await waitForPid(`${app!.path}/Contents/MacOS/firefox`, ` --profile ${profile} `)
  if (pid === null) {
    remove(profile)
    throw new Error('Could not find the launched Firefox process')
  }
  let bidi: Bidi | null = null
  const session: Session = {
    async close() {
      bidi?.close()
      await closeLaunched(pid, profile)
    },
  }
  try {
    await waitForPort(port, pid)
    bidi = await connectBidi(port)
    await bidiCall(bidi, 'session.new', { capabilities: { alwaysMatch: {} } })
    const tree = await bidiCall(bidi, 'browsingContext.getTree', {}) as { contexts: Array<{ context: string }> }
    const context = tree.contexts[0]?.context
    if (context === undefined) throw new Error('Firefox BiDi returned no browsing context')
    await bidiCall(bidi, 'browsingContext.navigate', { context, url, wait: 'none' })
    return session
  } catch (error) {
    await session.close()
    throw error
  }
}

function frontmostApp(): string | null {
  try {
    return execFileSync('osascript', ['-e', 'tell application "System Events" to return name of first application process whose frontmost is true'], { encoding: 'utf8', timeout: 15_000 }).trim()
  } catch {
    return null
  }
}

// With --allow-safari-frontmost the user may be working in Safari. createBrowserSession's background mode hands focus
// back after every script by calling `activate` on whichever app was frontmost, Safari itself in that case, so this path
// never calls activate: plain AppleScript makes the one-tab window, sets its URL and closes only that uniquely identified
// tab (the window handling of rebuild/lab/run.ts).
function launchSafariWithoutActivate(url: string): Session {
  const script = (lines: string[]): string => execFileSync('osascript', lines.flatMap(line => ['-e', line]), { encoding: 'utf8', timeout: 15_000 }).trim()
  const marker = `about:blank#pretext-probes-${runId}`
  const windowId = Number.parseInt(script([
    'tell application "Safari"',
    `make new document with properties {URL:${JSON.stringify(marker)}}`,
    'repeat with targetWindow in windows',
    `if (count of tabs of targetWindow) is 1 and URL of tab 1 of targetWindow is ${JSON.stringify(marker)} then return id of targetWindow as string`,
    'end repeat',
    'end tell',
  ]), 10)
  if (!Number.isFinite(windowId)) throw new Error('Could not find the Safari probe window')
  script(['tell application "Safari"', `set targetWindow to first window whose id is ${windowId}`, `set URL of tab 1 of targetWindow to ${JSON.stringify(url)}`, 'end tell'])
  const owns = (tabUrl: string): boolean => tabUrl === marker || tabUrl.startsWith(url)
  return {
    async close() {
      try {
        const urls = script([
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
        script([
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

// The repo's AppleScript session: a single-tab window in the user's Safari, never activated (safaridriver doesn't work
// on macOS 27). A new document in a frontmost Safari opens over the user's windows, so wait until Safari is in the
// background, unless --allow-safari-frontmost is given: approved by the maintainer on 2026-09-16, it skips the wait and
// opens the window over the user's windows while they use Safari, with the session above. The default still waits. The
// page reloads itself at the same URL, so the session can always identify and close its tab.
async function launchSafari(url: string): Promise<Session> {
  if (allowSafariFrontmost) {
    console.log(`[probes] safari: --allow-safari-frontmost; not waiting, no activate (frontmost app: ${frontmostApp() ?? 'unknown'})`)
    return launchSafariWithoutActivate(url)
  }
  const start = Date.now()
  for (let announced = false; frontmostApp() === 'Safari';) {
    if (Date.now() - start > 10 * 60_000) throw new Error('Safari stayed the frontmost app for 10 minutes; not opening the probe window over the user\'s windows')
    if (!announced) console.log('[probes] safari: waiting until Safari is no longer the frontmost app')
    announced = true
    await Bun.sleep(2_000)
  }
  const session = createBrowserSession('safari', { foreground: false })
  try {
    await session.navigate(url)
  } catch (error) {
    await session.close()
    throw error
  }
  return { close: () => session.close() }
}

// The system WebKit.framework, the engine installed Safari runs, in a background WKWebView app built by
// rebuild/tools/webkit-host/build.sh (see the lab README). The driver spawns it directly. It never activates, keeps its
// window behind every normal window, and exits when the page's title is 'probes done' or when the driver exits. One
// attempt only.
async function launchWebKitHost(url: string): Promise<Session> {
  const executable = join(REPO, '.artifacts/webkit-host/webkit-host')
  if (!await Bun.file(executable).exists()) throw new Error(`${executable} is missing; build it with rebuild/tools/webkit-host/build.sh`)
  const host = Bun.spawn([executable, `--url=${url}`, '--width=1200', '--height=900', '--exit-title=probes done'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
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
  const build = await Bun.build({ entrypoints: [join(PROBES_DIR, 'page.ts')], target: 'browser', format: 'esm' })
  if (!build.success) throw new Error(build.logs.map(String).join('\n'))
  return await build.outputs[0]!.text()
}

function portInUse(port: number): boolean {
  return Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
}

const runId = randomUUID()
const startedAt = new Date()
const errors: string[] = []
const results: Array<ProbeResult | null> = docs.flatMap(doc => doc.probes.map(() => null))
const docStart: number[] = []
for (let i = 0, offset = 0; i < docs.length; i++) {
  docStart.push(offset)
  offset += docs[i]!.probes.length
}
const totals = { selected, documents: docs.length, results: 0, probesWithErrors: 0, observationErrors: 0, reloads: 0, resends: 0 }
const envs = new Map<string, number>()
let current = 0
let seqCounter = 0
let pending: { seq: number; doc: number; sends: number } | null = null
let reloadsWithoutProgress = 0
let lastActivity = Date.now()
let settle: { resolve: () => void; reject: (error: Error) => void } | null = null
const completion = new Promise<void>((resolve, reject) => { settle = { resolve, reject } })
completion.catch(() => {})

function stopRun(error: Error): void {
  settle?.reject(error)
}

function pageHtml(index: number): string {
  const doc = docs[index]!
  const fixtures = FONT_FIXTURES.filter(fixture => doc.fixtures.includes(fixture.family)).map(fixture => ({ family: fixture.family, weight: fixture.weight, url: `/fonts/${fixture.file}` }))
  const lang = doc.pageLang === null ? '' : ` lang="${escapeAttribute(doc.pageLang)}"`
  const info = JSON.stringify({ runId, doc: index, fixtures }).replace(/</g, '\\u003c')
  return `<!doctype html><html${lang}><head><meta charset="utf-8"><title>pretext-rebuild probes</title>`
    + '<style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>'
    + '<div id="probe-host" style="position:fixed;left:0;top:0;margin:0;padding:0;border:0;width:1000px"></div>'
    + `<script id="probe-doc" type="application/json">${info}</script>`
    + '<script type="module" src="/page.js"></script></body></html>'
}

function recordEnv(env: PageEnv): void {
  const key = JSON.stringify({ userAgent: env.userAgent, devicePixelRatio: env.devicePixelRatio, visualViewportScale: env.visualViewportScale, visibilityState: env.visibilityState, hasFocus: env.hasFocus })
  envs.set(key, (envs.get(key) ?? 0) + 1)
}

type StepBody = { runId: string; doc: number; seq: number | null; env: PageEnv; results: ProbeResult[] }

async function step(request: Request): Promise<Response> {
  const body = await request.json() as StepBody
  if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
  recordEnv(body.env)
  if (body.seq !== null) {
    if (pending === null || body.seq !== pending.seq || body.doc !== pending.doc) throw new Error(`Page acknowledged document ${body.doc} chunk ${body.seq}; pending is ${pending === null ? 'none' : `${pending.doc}/${pending.seq}`}`)
    const doc = docs[pending.doc]!
    if (!Array.isArray(body.results) || body.results.length !== doc.probes.length) throw new Error(`Document ${pending.doc} returned ${body.results?.length} results; expected ${doc.probes.length}`)
    for (let i = 0; i < body.results.length; i++) {
      const result = body.results[i]!
      if (result.id !== doc.probes[i]!.id) throw new Error(`Result ${i} of document ${pending.doc} is ${result.id}; expected ${doc.probes[i]!.id}`)
      results[docStart[pending.doc]! + i] = result
      totals.results++
      if (result.errors.length > 0) totals.probesWithErrors++
      totals.observationErrors += result.observations.filter(observation => 'error' in observation).length
    }
    pending = null
    current++
    reloadsWithoutProgress = 0
    if (docs.length <= 50 || current % 25 === 0 || current === docs.length) console.log(`[probes] ${browser}: ${current}/${docs.length} documents, ${totals.results}/${selected} probes`)
    if (current >= docs.length) {
      settle?.resolve()
      return Response.json({ kind: 'done' })
    }
    totals.reloads++
    return Response.json({ kind: 'reload' })
  }
  if (current >= docs.length) return Response.json({ kind: 'done' })
  if (body.doc !== current) {
    if (++reloadsWithoutProgress > 3) throw new Error(`Page kept loading document ${body.doc}; needed ${current}`)
    totals.reloads++
    return Response.json({ kind: 'reload' })
  }
  if (pending !== null) {
    // The page restarted before acknowledging; send the document's probes again, a bounded number of times.
    if (pending.sends >= 3) throw new Error(`Document ${pending.doc} was sent 3 times without an acknowledgement`)
    totals.resends++
  } else {
    pending = { seq: seqCounter++, doc: current, sends: 0 }
  }
  pending.sends++
  return Response.json({ kind: 'probes', seq: pending.seq, timeoutMs: probeTimeoutMs, probes: docs[current]!.probes })
}

let session: Session | null = null
let server: ReturnType<typeof Bun.serve> | null = null
process.on('SIGINT', () => stopRun(new Error('Interrupted')))
process.on('SIGTERM', () => stopRun(new Error('Terminated')))
try {
  mkdirSync(outDir, { recursive: true })
  const bundle = await buildBundle()
  const noStore = { 'cache-control': 'no-store' }
  const fetchHandler = async (request: Request): Promise<Response> => {
    lastActivity = Date.now()
    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case '/probe':
          if (url.searchParams.get('run') !== runId) return new Response('Inactive run', { status: 409 })
          return new Response(pageHtml(Math.min(current, docs.length - 1)), { headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } })
        case '/page.js':
          return new Response(bundle, { headers: { ...noStore, 'content-type': 'text/javascript; charset=utf-8' } })
        case '/api/step':
          if (request.method !== 'POST') return new Response('POST required', { status: 405 })
          return await step(request)
        case '/api/chrome-dsf': {
          const body = await request.json() as { runId: string; deviceScaleFactor: number }
          if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
          if (overrideChromeDsf === null) throw new Error('A probe asked for another device scale factor in a run without --chrome-emulate-dsf')
          await overrideChromeDsf(body.deviceScaleFactor)
          return new Response('ok')
        }
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
  const url = `http://127.0.0.1:${server.port}/probe?run=${runId}`
  console.log(`[probes] ${browser}: ${selected} probes in ${docs.length} documents; serving ${url}`)
  switch (browser) {
    case 'chrome': session = await launchChrome(url); break
    case 'firefox': session = await launchFirefox(url); break
    case 'safari': session = await launchSafari(url); break
    case 'webkit-host': session = await launchWebKitHost(url); break
  }
  lastActivity = Date.now()
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > stallMs) stopRun(new Error(`No page activity for ${stallMs}ms; ${totals.results}/${selected} probes observed`))
  }, 1_000)
  try {
    await completion
  } finally {
    clearInterval(watchdog)
  }
  if (totals.results !== selected) errors.push(`Observed ${totals.results} probes of ${selected}`)
  const stable = new Set([...envs.keys()].map(key => {
    const env = JSON.parse(key) as PageEnv
    return JSON.stringify([env.userAgent, env.devicePixelRatio, env.visualViewportScale])
  }))
  if (stable.size > 1) errors.push(`The user agent, DPR or visual-viewport scale changed during the run: ${[...stable].join(' | ')}`)
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
  const output: ProbeOutput = {
    status: errors.length === 0 ? 'ok' : 'error',
    errors,
    browser, app, build, runId, probesFile: probesPath, only,
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime(),
    totals,
    envs: [...envs].map(([key, documents]) => ({ ...JSON.parse(key) as PageEnv, documents })),
    results: docs.flatMap((doc, index) => doc.probes.map((probe, i) => ({ id: probe.id, spec: probe.spec, document: index, probe, result: results[docStart[index]! + i] ?? null }))),
  }
  const outPath = join(outDir, `${browser}-probes.json`)
  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n')
  } catch (error) {
    errors.push(`Writing ${outPath}: ${message(error)}`)
  }
  console.log(`[probes] ${browser}: ${errors.length === 0 ? 'ok' : 'error'}; ${totals.results}/${selected} probes, ${totals.probesWithErrors} with probe errors, ${totals.observationErrors} observation errors; ${outPath}`)
  for (let i = 0; i < errors.length; i++) console.error(`[probes] ${errors[i]}`)
}
process.exit(errors.length === 0 ? 0 : 1)
