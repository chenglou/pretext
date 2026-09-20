// Lab driver: serves the page bundle, opens one background browser session, streams rows to NDJSON.
// Always run under the shared browser lock (this script doesn't take it):
//   python3 .artifacts/session/with-browser-lock.py lab-chrome -- bun rebuild/lab/run.ts --browser=chrome --cases=<file> --out=<dir>
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundleString, CHROME_PIN_ARGS, FIREFOX_PIN_PREFS, labApp, readBuild, userAgentMatches } from './browser-build.ts'
import { createRng } from './cases/prng.ts'
import { CHROME_LANGUAGES, derivedLanguages, FIREFOX_LANGUAGE_PREFS, rendererLanguage, webkitLanguageCheck, type ChromeLanguages } from './languages.ts'
import type { CaseMeasurements } from './record.ts'
import type { BrowserKind, Case, FontDecl, LabRow, ProcessLanguages } from './types.ts'

const LAB_DIR = import.meta.dir
const PROFILES_DIR = resolve(LAB_DIR, '../../.artifacts/profiles')
const FONTS_DIR = resolve(LAB_DIR, '../../tests/wrapping/fonts')

function fail(text: string): never {
  console.error(`[lab] ${text}`)
  process.exit(1)
}

function message(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error)
}

// ---- Arguments ----

const KNOWN = ['browser', 'cases', 'out', 'limit', 'family', 'chunk', 'predictor', 'stall-ms', 'order', 'chrome-apple-languages', 'chrome-accept-languages', 'part-ms', 'part-cases', 'parts-from']
const USAGE = 'Usage: bun rebuild/lab/run.ts --browser=chrome|safari|firefox|webkit-host --cases=<cases.ndjson> --out=<dir> [--limit=N] [--family=substr] [--chunk=N] [--predictor=<file>] [--stall-ms=N] [--order=file|reverse|shuffle:<seed>] [--part-ms=N] [--part-cases=N] [--parts-from=<run.json>] [--record-measurements] [--measure-first] [--allow-safari-frontmost] [--predict-only] [--chrome-apple-languages=<tag>[,<tag>...] --chrome-accept-languages=<list>]'
const args = new Map<string, string>()
// Opens the Safari lab window without waiting for Safari to leave the front (see launchSafari).
let allowSafariFrontmost = false
// Records predictions (and painted lines) without observing native layout: each row's native is { skipped }. score.ts
// --native-rows scores such rows against another run's native observations of the same cases.
let predictOnly = false
// Stores every Canvas measureText call and dictionary segmentation of every case beside the rows (record.ts), for offline
// checks of another library build against the same browser answers (measurements.ts).
let recordMeasurements = false
// Measure first (lab README "Measure first"): per document, every case is predicted before the document's first native
// layout, then the cases are observed in the same order. An application measures before any DOM text exists; the usual
// protocol lays a case out natively and then predicts it.
let measureFirst = false
for (const raw of process.argv.slice(2)) {
  if (raw === '--allow-safari-frontmost') {
    allowSafariFrontmost = true
    continue
  }
  if (raw === '--predict-only') {
    predictOnly = true
    continue
  }
  if (raw === '--record-measurements') {
    recordMeasurements = true
    continue
  }
  if (raw === '--measure-first') {
    measureFirst = true
    continue
  }
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null || !KNOWN.includes(match[1]!)) fail(`Unknown argument ${raw}. ${USAGE}`)
  args.set(match[1]!, match[2]!)
}
const browserArg = args.get('browser')
if (browserArg !== 'chrome' && browserArg !== 'safari' && browserArg !== 'firefox' && browserArg !== 'webkit-host') fail('--browser must be chrome, safari, firefox or webkit-host')
const browser: BrowserKind = browserArg
if (allowSafariFrontmost && browser !== 'safari') fail('--allow-safari-frontmost applies only to --browser=safari')
// A record's phases are per case, and a measure-first case predicts and observes in two passes; without native layout there
// is nothing to measure before.
if (measureFirst && (recordMeasurements || predictOnly)) fail('--measure-first goes with neither --record-measurements nor --predict-only')
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
// Parts: a run's cases go through one browser process after another, each a fresh one (see "Parts" below). A part ends after
// --part-cases cases, or once it has run for --part-ms less the run's longest chunk. Installed Safari gets 5-minute parts
// unless told otherwise: WebKit stops a hidden page's process once its CPU use, averaged over 8 minutes, passes the limit.
// --parts-from=<run.json> starts parts at the rows where that run of the same cases did, so two browsers see every case
// after the same history (installed Safari's timed parts, repeated in webkit-host).
const partCases = positiveInteger('part-cases', Number.MAX_SAFE_INTEGER)
const partsFrom = args.get('parts-from')
const partMs = positiveInteger('part-ms', browser === 'safari' && partsFrom === undefined ? 300_000 : Number.MAX_SAFE_INTEGER)
const familyFilter = args.get('family')
const predictorPath = resolve(args.get('predictor') ?? join(LAB_DIR, 'predictor.ts'))
// The order the selected cases run in: the file's, reversed, or shuffled by a seeded generator. It applies before cases
// are grouped by page context, so it changes which cases share a document and which ran before each one.
const order = args.get('order') ?? 'file'
if (order !== 'file' && order !== 'reverse' && !/^shuffle:.+$/s.test(order)) fail('--order must be file, reverse or shuffle:<seed>')

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
  if (c.inline !== undefined && (typeof c.inline !== 'object' || c.inline === null || !Array.isArray(c.inline.content) || !Array.isArray(c.inline.lineSlots))) {
    return 'inline.content and inline.lineSlots must be arrays'
  }
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

// Cases grouped by page context, stable in order of first appearance after --order, so the page reloads once per context
// (a fresh document, so Canvas contexts start under the new language) and installed-font cases never share a document
// with web fonts.
const casesByContext = new Map<string, Case[]>()
{
  const lines = readFileSync(casesPath, 'utf8').split('\n')
  const ids = new Set<string>()
  const selected: Case[] = []
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
    if (selected.length >= limit) continue
    selected.push(c)
  }
  if (order === 'reverse') selected.reverse()
  if (order.startsWith('shuffle:')) {
    const rng = createRng(order.slice('shuffle:'.length))
    for (let i = selected.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      const swap = selected[i]!
      selected[i] = selected[j]!
      selected[j] = swap
    }
  }
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i]!
    const key = contextKey(c.pageLang, fixtureFamilies(c))
    if (!casesByContext.has(key)) casesByContext.set(key, [])
    casesByContext.get(key)!.push(c)
  }
}
const cases: Case[] = [...casesByContext.values()].flat()
if (cases.length === 0) fail('No cases selected')
// Rows at which --parts-from's run started its parts.
const givenPartStarts: number[] = []
if (partsFrom !== undefined) {
  const other = JSON.parse(readFileSync(resolve(partsFrom), 'utf8')) as { order: string; totals: { selected: number }; parts?: Array<{ firstRow: number }> }
  if (other.totals.selected !== cases.length || other.order !== order || other.parts === undefined) fail(`${partsFrom} ran ${other.totals.selected} cases in order ${other.order}${other.parts === undefined ? ' without recording parts' : ''}; this run has ${cases.length} in order ${order}`)
  for (let i = 0; i < other.parts.length; i++) if (other.parts[i]!.firstRow > 0) givenPartStarts.push(other.parts[i]!.firstRow)
}
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

// A text node's storage width (8-bit or 16-bit) follows its string's provenance, and WebKit and Blink have rules that
// apply only to 16-bit text (specs/webkit-gaps.md, blink-gaps.md). JSON parsed from a body holding any raw non-Latin-1
// character yields 16-bit strings even for ASCII values (specs/probes-safari.md, cross-check), so one CJK case in a chunk
// would change how every ASCII case in it lays out. Escaping everything above U+007E keeps the body ASCII: each string
// then parses 8-bit unless its own characters need 16 bits, what a typical page's Latin-1 text gets.
function asciiJsonResponse(value: unknown): Response {
  const body = JSON.stringify(value).replace(/[-￿]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } })
}

// The app the run launches and the build it observes, from the app bundles, before launch (browser-build.ts). Chrome and
// Firefox are the lab's pinned copies, never the installed apps.
let app: ReturnType<typeof labApp>
try {
  app = labApp(browser)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const build = readBuild(browser)

// The browser process's languages (languages.ts): launch arguments and prefs, the OS settings read before launch, and the
// given facts the page passes to predict(). Chrome's application locale is read from its renderers at the first step.
// Chrome may launch under other languages than this Mac's (languages.ts ChromeLanguages); both options go together.
const chromeAppleLanguages = args.get('chrome-apple-languages')
const chromeAcceptLanguages = args.get('chrome-accept-languages')
if ((chromeAppleLanguages === undefined) !== (chromeAcceptLanguages === undefined)) fail('--chrome-apple-languages and --chrome-accept-languages go together')
if (chromeAppleLanguages !== undefined && browser !== 'chrome') fail('--chrome-apple-languages applies only to --browser=chrome')
const chromeLanguages: ChromeLanguages = chromeAppleLanguages === undefined || chromeAcceptLanguages === undefined
  ? CHROME_LANGUAGES
  : { appleLanguages: chromeAppleLanguages.split(',').filter(tag => tag !== ''), acceptLanguages: chromeAcceptLanguages }
if (chromeLanguages.appleLanguages.length === 0 || chromeLanguages.appleLanguages.some(tag => !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag))) fail('--chrome-apple-languages must list language tags')
const languages: ProcessLanguages = derivedLanguages(browser, undefined, chromeLanguages)

// ---- Browser sessions ----

// expectExit: the page is about to finish (a 'retire' or 'done' title ends webkit-host), so an exit is no failure.
type Session = { pid: number | null; close: () => Promise<void>; expectExit?: () => void }

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

function processTable(): Array<{ pid: number; ppid: number; command: string }> {
  const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
  const out: Array<{ pid: number; ppid: number; command: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+)\s+(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null) out.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! })
  }
  return out
}

function findPid(executable: string, marker: string): number | null {
  const table = processTable()
  for (let i = 0; i < table.length; i++) {
    const entry = table[i]!
    if (entry.command.startsWith(`${executable} `) && entry.command.includes(marker)) return entry.pid
  }
  return null
}

// Chrome's application locale as its renderers received it (languages.ts rendererLanguage).
function chromeUiLanguage(browserPid: number): { value: string; renderers: number } {
  return rendererLanguage(processTable(), browserPid)
}

function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    console.error(`[lab] could not remove ${path}: ${message(error)}`)
  }
}

// Chrome and Firefox start through LaunchServices without activation (`open -g`), each in its own profile under
// .artifacts/profiles so the session watchdog sees them. macOS 27 blocks shell-spawned Firefox from its data folders.
// One attempt only: a failed launch can show the user a dialog. `open` gets a minute: on a machine at a load of 100 it
// took more than 15 s to return, which is a slow launch and not a failed one (a tier 2 job was lost to it on 2026-09-20).
async function launchApp(app: string, executable: string, marker: string, profile: string, appArgs: string[]): Promise<Session> {
  execFileSync('open', ['-n', '-g', '-a', app, '--args', ...appArgs], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 60_000 })
  let pid: number | null = null
  for (let i = 0; i < 100 && pid === null; i++) {
    pid = findPid(executable, marker)
    if (pid === null) await Bun.sleep(100)
  }
  if (pid === null) throw new Error(`Could not find the launched ${app} process`)
  const owned = pid
  return {
    pid: owned,
    async close() {
      await stopProcess(owned)
      // Helpers can hold the profile for a moment after the main process exits.
      await Bun.sleep(1_000)
      remove(profile)
    },
  }
}

// Chrome activates itself whenever it shows a browser window the normal way (NativeWidgetNSWindowBridge calls
// activateIgnoringOtherApps), `open -g` or not: a startup window took focus for about half a second. So Chrome starts
// with no window, and the lab opens its one window through the DevTools protocol with Target.createTarget { newWindow,
// background }, which Chrome shows inactive (NavigateParams kShowWindowInactive). The protocol is used for nothing
// else; the page drives itself as in the other browsers.
async function launchChrome(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `lab-chrome-${partTag()}`)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  // Profile prefs Chrome reads at startup: the accept languages (types.ts ProcessLanguages.launch).
  const prefs = languages.launch!.prefs
  writeFileSync(join(profile, 'Default', 'Preferences'), JSON.stringify({ intl: { accept_languages: prefs['intl.accept_languages'], selected_languages: prefs['intl.selected_languages'] } }))
  const session = await launchApp(app!.path, `${app!.path}/Contents/MacOS/${bundleString(app!.path, 'CFBundleExecutable')}`, `--user-data-dir=${profile}`, profile, [
    `--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--window-size=1200,900', '--no-startup-window', '--remote-debugging-port=0',
    ...languages.launch!.arguments,
  ])
  // Known before the window opens, so the page's first step can read the renderers (chromeUiLanguage).
  chromePid = session.pid
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

function launchFirefox(url: string): Promise<Session> {
  const profile = join(PROFILES_DIR, `lab-firefox-${partTag()}`)
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
    ...FIREFOX_PIN_PREFS, ...FIREFOX_LANGUAGE_PREFS,
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  return launchApp(app!.path, `${app!.path}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile,
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
// back afterwards doesn't undo that. So the lab window is only created while Safari is in the background, unless
// --allow-safari-frontmost is given: approved by the maintainer on 2026-09-16, it skips the wait and opens the window
// over the user's windows while they use Safari. The default still waits.
async function launchSafari(url: string, baseUrl: string): Promise<Session> {
  if (allowSafariFrontmost) console.log(`[lab] safari: --allow-safari-frontmost; not waiting (frontmost app: ${frontmostApp() ?? 'unknown'})`)
  const waitStart = Date.now()
  for (let announced = false; !allowSafariFrontmost && frontmostApp() === 'Safari';) {
    if (Date.now() - waitStart > 10 * 60_000) throw new Error('Safari stayed the frontmost app for 10 minutes; not opening the lab window over the user\'s windows')
    if (!announced) console.log('[lab] safari: waiting until Safari is no longer the frontmost app')
    announced = true
    await Bun.sleep(2_000)
  }
  const marker = `about:blank#pretext-lab-${partTag()}`
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
    pid: null,
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
    pid: host.pid,
    expectExit() {
      closing = true
    },
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

type PageRow = Omit<LabRow, 'family' | 'browser' | 'build' | 'languages' | 'case'>
// phase: under --measure-first a document's cases go out twice, to be predicted and then to be observed; rows come back
// from 'observe' chunks only, which is the one phase of the usual protocol.
type Pending = { seq: number; start: number; end: number; sends: number; sentAt: number; phase: 'predict' | 'observe' }
// One part of the run: the rows one browser process observed.
type Part = { index: number; reason: 'start' | 'cases' | 'time' | 'given'; firstRow: number; rows: number; startedAt: string; ms: number }

const runId = randomUUID()
const startedAt = new Date()
mkdirSync(outDir, { recursive: true })
const rowsPath = join(outDir, `${browser}-rows.ndjson`)
const runPath = join(outDir, `${browser}-run.json`)
const errors: string[] = []
const totals = { selected: cases.length, rows: 0, chunks: 0, navigations: 0, resends: 0, nativeErrors: 0, predictionErrors: 0, painterErrors: 0, rejectedStyleRows: 0, missingFontRows: 0, skippedNativeRows: 0 }
const missingFontCounts = new Map<string, number>()
const envs = new Map<string, number>()
const visibility = new Map<string, number>()
// The browser's languages as pages report them, next to the given facts (types.ts PageEnv.navigatorLanguages).
const pageLanguages = new Map<string, number>()
let firstEnv: PageRow['env'] | null = null
let next = 0
let seqCounter = 0
let pending: Pending | null = null
// --measure-first: the document being served, rows [start, end) of one page context inside one part. Its cases are predicted
// in chunks up to `predicted` before any of them is observed; `next` then runs through them. null between documents.
let documentRange: { start: number; end: number; predicted: number } | null = null
const measureFirstTotals = { documents: [] as Array<{ firstRow: number; rows: number }>, predictChunks: 0 }
let navigationsWithoutProgress = 0
let lastActivity = Date.now()
// When the page first asked for work, so launch time and case throughput can be told apart.
let firstStepAt: number | null = null
// Parts finished so far, and the one running.
const parts: Part[] = []
let part: { reason: Part['reason']; firstRow: number; startedAt: number; firstStep: boolean } = { reason: 'start', firstRow: 0, startedAt: Date.now(), firstStep: true }
let longestChunkMs = 0
let baseUrl = ''
// Names the running part's profile or Safari tab.
function partTag(): string {
  return `${runId}-p${parts.length}`
}
const measurementTotals = { cases: 0, contexts: 0, calls: 0, segmentations: 0 }
let settle: { resolve: () => void; reject: (error: Error) => void } | null = null
const completion = new Promise<void>((resolve, reject) => { settle = { resolve, reject } })
completion.catch(() => {})
const rowsFd = openSync(rowsPath, 'w')
let session: Session | null = null
// Chrome's browser process, set by launchChrome as soon as it runs.
let chromePid: number | null = null

function stopRun(error: Error): void {
  settle?.reject(error)
}

function writeRows(rows: PageRow[], start: number): void {
  let text = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const c = cases[start + i]!
    if (row.id !== c.id) throw new Error(`Row ${i} of the chunk is ${row.id}; expected ${c.id}`)
    if (!userAgentMatches(browser, build, row.env.userAgent)) throw new Error(`Row ${c.id}: user agent ${row.env.userAgent} doesn't name the build read before launch (${JSON.stringify(build)})`)
    const full: LabRow = { id: c.id, family: c.family, browser, build, languages, case: c, env: row.env, native: row.native, prediction: row.prediction, painter: row.painter, timings: row.timings }
    text += JSON.stringify(full) + '\n'
    if ('skipped' in row.native) totals.skippedNativeRows++
    else if ('error' in row.native) totals.nativeErrors++
    else if (row.native.rejectedStyles.length > 0) totals.rejectedStyleRows++
    if (!('error' in row.native) && !('skipped' in row.native) && (row.native.missingFonts ?? []).length > 0) {
      totals.missingFontRows++
      for (const family of row.native.missingFonts!) missingFontCounts.set(family, (missingFontCounts.get(family) ?? 0) + 1)
    }
    if ('error' in row.prediction) totals.predictionErrors++
    if (row.painter !== null && 'error' in row.painter) totals.painterErrors++
    const key = JSON.stringify({ userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, visualViewportScale: row.env.visualViewportScale })
    envs.set(key, (envs.get(key) ?? 0) + 1)
    visibility.set(row.env.visibilityState, (visibility.get(row.env.visibilityState) ?? 0) + 1)
    const reported = JSON.stringify({ navigatorLanguages: row.env.navigatorLanguages ?? null, intlLocale: row.env.intlLocale ?? null })
    pageLanguages.set(reported, (pageLanguages.get(reported) ?? 0) + 1)
    firstEnv ??= row.env
  }
  writeSync(rowsFd, text)
  totals.rows += rows.length
}

async function step(request: Request): Promise<Response> {
  const body = await request.json() as { runId: string; pageLang: string; fonts: string[]; navigatorLanguages?: string[]; seq: number | null; rows: PageRow[]; measurements?: CaseMeasurements[]; predicted?: number }
  if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
  // The first step of every part checks the browser process's languages; the run's first step records them.
  if (part.firstStep) {
    part.firstStep = false
    const first = firstStepAt === null
    firstStepAt ??= Date.now()
    // A renderer runs now; its --lang is Chrome's application locale.
    if (browser === 'chrome') {
      if (chromePid === null) throw new Error('Chrome asked for work before its process was known')
      const read = chromeUiLanguage(chromePid)
      if (!first && (languages.given.engine !== 'blink' || languages.given.uiLanguage !== read.value)) throw new Error(`Part ${parts.length}: Chrome's renderers run under --lang=${read.value}; the run's first part read ${JSON.stringify(languages.given)}`)
      languages.given = { engine: 'blink', uiLanguage: read.value }
      if (first) languages.derivation.push(`read --lang=${read.value} from ${read.renderers} renderer process${read.renderers === 1 ? '' : 'es'}`)
    }
    // WebKit's process languages were derived before launch; the first page only checks them (languages.ts webkitLanguageCheck).
    if ((browser === 'safari' || browser === 'webkit-host') && languages.given.engine === 'webkit') {
      const shown = body.navigatorLanguages ?? []
      const problem = webkitLanguageCheck(languages.given.preferredLanguages, shown)
      if (problem !== null) throw new Error(problem)
      if (first) languages.derivation.push(`checked: navigator.languages ${JSON.stringify(shown)} shows the first given entry`)
    }
  }
  // A measure-first document holds its predictions in the page, so a page that starts again inside one can't go on.
  if (measureFirst && body.seq === null && documentRange !== null) throw new Error(`The page started again inside the measure-first document of rows ${documentRange.start} to ${documentRange.end}; its held predictions are gone`)
  if (body.seq !== null && pending !== null && body.seq === pending.seq && pending.phase === 'predict') {
    if (body.predicted !== pending.end - pending.start || !Array.isArray(body.rows) || body.rows.length !== 0) throw new Error(`Predict chunk ${pending.seq} reported ${body.predicted} predictions and ${body.rows?.length} rows; expected ${pending.end - pending.start} and none`)
    documentRange!.predicted = pending.end
    longestChunkMs = Math.max(longestChunkMs, Date.now() - pending.sentAt)
    measureFirstTotals.predictChunks++
    pending = null
  } else if (body.seq !== null) {
    if (pending === null || body.seq !== pending.seq) throw new Error(`Page acknowledged chunk ${body.seq}; pending is ${pending?.seq ?? 'none'}`)
    if (!Array.isArray(body.rows) || body.rows.length !== pending.end - pending.start) throw new Error(`Chunk ${pending.seq} returned ${body.rows?.length} rows; expected ${pending.end - pending.start}`)
    if (recordMeasurements && (!Array.isArray(body.measurements) || body.measurements.length !== body.rows.length)) throw new Error(`Chunk ${pending.seq} returned ${body.measurements?.length} measurement records for ${body.rows.length} rows`)
    writeRows(body.rows, pending.start)
    if (recordMeasurements) await writeMeasurements(body.measurements!, pending.start)
    longestChunkMs = Math.max(longestChunkMs, Date.now() - pending.sentAt)
    totals.chunks++
    next = pending.end
    pending = null
    navigationsWithoutProgress = 0
    if (documentRange !== null && next >= documentRange.end) {
      measureFirstTotals.documents.push({ firstRow: documentRange.start, rows: documentRange.end - documentRange.start })
      documentRange = null
    }
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
  // A part ends only on an acknowledged chunk, so every part makes progress; under --measure-first only where a document
  // ends, since a document's predictions live in its page (a timed part waits for that).
  if (body.seq !== null && pending === null && documentRange === null) {
    const reason = givenPartStarts.includes(next) ? 'given' : next - part.firstRow >= partCases ? 'cases' : Date.now() - part.startedAt + longestChunkMs > partMs ? 'time' : null
    if (reason !== null) {
      session?.expectExit?.()
      setTimeout(() => { nextPart(reason).catch(stopRun) }, 0)
      return Response.json({ kind: 'retire' })
    }
  }
  const start = pending?.start ?? (documentRange !== null && documentRange.predicted < documentRange.end ? documentRange.predicted : next)
  const lang = cases[start]!.pageLang
  const fonts = fixtureFamilies(cases[start]!)
  const key = contextKey(lang, fonts)
  if (key !== contextKey(body.pageLang, body.fonts)) {
    if (++navigationsWithoutProgress > 3) throw new Error(`Page kept reporting context ${contextKey(body.pageLang, body.fonts)}; needed ${key}`)
    totals.navigations++
    return Response.json({ kind: 'navigate', lang, fonts })
  }
  if (pending === null) {
    // A chunk never runs past its part's --part-cases or the next --parts-from start, and the same bounds end a document.
    const bound = Math.min(cases.length, part.firstRow + partCases, ...givenPartStarts.filter(row => row > start))
    if (measureFirst && documentRange === null) {
      let documentEnd = start
      while (documentEnd < bound && contextKey(cases[documentEnd]!.pageLang, fixtureFamilies(cases[documentEnd]!)) === key) documentEnd++
      documentRange = { start, end: documentEnd, predicted: start }
    }
    let end = start
    const size = Math.min(chunkSize, (documentRange?.end ?? bound) - start)
    while (end < cases.length && end - start < size && contextKey(cases[end]!.pageLang, fixtureFamilies(cases[end]!)) === key) end++
    pending = { seq: seqCounter++, start, end, sends: 0, sentAt: Date.now(), phase: documentRange !== null && documentRange.predicted < documentRange.end ? 'predict' : 'observe' }
  }
  pending.sends++
  return asciiJsonResponse({ kind: 'chunk', seq: pending.seq, browser, build: build.engine, languages: languages.given, ...(predictOnly ? { predictOnly: true } : {}), ...(recordMeasurements ? { recordMeasurements: true } : {}), ...(measureFirst ? { measureFirst: pending.phase } : {}), cases: cases.slice(pending.start, pending.end) })
}

// ---- Measurements ----

// run.ts --record-measurements: one line per case, in row order, streamed through zstd so neither the driver nor the disk
// holds them uncompressed (read with `zstd -dc`, or measurements.ts readMeasurements).
const measurementsPath = join(outDir, `${browser}-measurements.ndjson.zst`)
const zstd = recordMeasurements ? Bun.spawn(['zstd', '-q', '-f', '-3', '-o', measurementsPath], { stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' }) : null

async function writeMeasurements(records: CaseMeasurements[], start: number): Promise<void> {
  let text = ''
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.id !== cases[start + i]!.id) throw new Error(`Measurement record ${i} of the chunk is ${record.id}; expected ${cases[start + i]!.id}`)
    text += JSON.stringify(record) + '\n'
    measurementTotals.cases++
    measurementTotals.contexts += record.contexts.length
    measurementTotals.calls += record.calls.length
    measurementTotals.segmentations += record.segmentations.length
  }
  zstd!.stdin.write(text)
  await zstd!.stdin.flush()
}

// ---- Parts ----

// A part is a fresh browser process. Chrome and Firefox relaunch in a new profile and webkit-host is spawned again, after
// the part before them closed, so a job never runs two instances. Installed Safari gets a new single-tab window, opened
// before the old tab closes. A new tab's first load is about:blank, which has no site, so WebKit gives the tab a prewarmed
// or new WebContent process, never a cached one (WebProcessPool.cpp processForSite :1271-1296), and the lab URL then stays
// in it ("Navigation is treated as same-site", processForNavigationInternal). Checked with cases whose layout depends on
// the process's history (lab README, "Parts"): right after a part boundary they lay out as in a fresh process, in installed
// Safari as in webkit-host. ps can't show it: WebContent processes don't name their client, and other jobs' webkit-host
// processes run beside Safari's. The page learns that its part is over from a 'retire' reply to its last chunk.
function finishPart(): void {
  parts.push({ index: parts.length, reason: part.reason, firstRow: part.firstRow, rows: totals.rows - part.firstRow, startedAt: new Date(part.startedAt).toISOString(), ms: Date.now() - part.startedAt })
}

function labUrl(c: Case): string {
  return `${baseUrl}/lab?run=${runId}&lang=${encodeURIComponent(c.pageLang)}&fonts=${encodeURIComponent(fixtureFamilies(c).join('|'))}`
}

function launch(url: string): Promise<Session> {
  switch (browser) {
    case 'chrome': return launchChrome(url)
    case 'firefox': return launchFirefox(url)
    case 'safari': return launchSafari(url, baseUrl)
    case 'webkit-host': return launchWebKitHost(url)
  }
}

async function nextPart(reason: Part['reason']): Promise<void> {
  finishPart()
  part = { reason, firstRow: totals.rows, startedAt: Date.now(), firstStep: true }
  const old = session
  if (browser === 'safari') {
    session = await launch(labUrl(cases[next]!))
    await old?.close()
  } else {
    session = null
    await old?.close()
    session = await launch(labUrl(cases[next]!))
  }
  lastActivity = Date.now()
  console.log(`[lab] ${browser}: part ${parts.length} from row ${totals.rows} (${reason})`)
}

// Installed Safari keeps each lab document runnable while its window is hidden. The lab window opens behind the frontmost
// app's windows, so WebKit sees it occluded and hides the page (PageClientImpl::isViewVisible, PageClientImplMac.mm), and
// the UI process drops the page's foreground activity (WebPageProxy::updateThrottleState, WebPageProxy.cpp:3733-3742). With
// no activity left, the ProcessThrottler moves the WebContent process to suspended after PrepareToSuspend
// (ProcessThrottler.cpp:240-249, :360-395, processSuspensionTimeout 20 s), and the page stops posting rows: round 1's
// installed Safari run stopped at 1,585 rows with every row hidden. Two activities keep a hidden page runnable, and the
// page takes them in turn, never activating anything:
// 1. While the page loads. NavigationState::didChangeIsLoading holds a background activity while the page is loading and
//    releases it 3 s after (NavigationState.mm:1630-1656), and a frame stays loading while a request it started before
//    its load event is pending (DocumentLoader::isLoadingInAPISense, DocumentLoader.cpp:1701-1723). So Safari's lab markup
//    holds a hidden image whose response the server leaves open.
// 2. Once the page updates its title. A main-frame title change without user action more than 5 s after the committed
//    load takes a background activity until the next commit (WebPageProxy::didReceiveTitleForFrame, WebPageProxy.cpp:9250-
//    9270, cleared at :8517). The page asks the server when HOLD_READY_MS have passed since the document was served
//    (/api/hold-ready), changes its title, then releases the image (/api/hold-release).
// The load has to end before the page measures anything: document.fonts.ready resolves only after the load event
// (FontFaceSet::documentDidFinishLoading, FontFaceSet.cpp:269-280, called from Document::implicitClose, Document.cpp:4399-
// 4402), which the held image would otherwise block. The other browsers get no hold: Chrome runs with
// --disable-renderer-backgrounding and --disable-backgrounding-occluded-windows, Firefox has no such suspension, and
// webkit-host's window reports itself visible.
const HOLD_READY_MS = 6_000
const holds = new Map<number, { servedAt: number; controller: ReadableStreamDefaultController<Uint8Array> | null }>()
let holdCount = 0

function pageHtml(lang: string, families: string[]): string {
  const escaped = lang.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
  const fixtures = FONT_FIXTURES.filter(fixture => families.includes(fixture.family)).map(fixture => ({ family: fixture.family, weight: fixture.weight, url: `/fonts/${fixture.file}` }))
  let hold = ''
  if (browser === 'safari') {
    const n = holdCount++
    holds.set(n, { servedAt: Date.now(), controller: null })
    hold = `<img hidden alt="" data-lab-hold="${n}" src="/api/hold?run=${runId}&amp;n=${n}">`
  }
  return `<!doctype html><html lang="${escaped}"><head><meta charset="utf-8"><title>pretext-rebuild lab</title>`
    + '<style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>'
    + hold
    + `<script id="lab-fonts" type="application/json">${JSON.stringify(fixtures).replace(/</g, '\\u003c')}</script>`
    + '<script type="module" src="/page.js"></script></body></html>'
}

let server: ReturnType<typeof Bun.serve> | null = null
// The library bundle the pages ran, by content: rows of two runs come from the same library when these agree.
let bundleSha256: string | null = null
let bundleBytes = 0
process.on('SIGINT', () => stopRun(new Error('Interrupted')))
process.on('SIGTERM', () => stopRun(new Error('Terminated')))
try {
  const bundle = await buildBundle()
  bundleBytes = bundle.length
  bundleSha256 = new Bun.CryptoHasher('sha256').update(bundle).digest('hex')
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
        case '/api/hold': {
          if (url.searchParams.get('run') !== runId) return new Response('Inactive run', { status: 409 })
          const entry = holds.get(Number(url.searchParams.get('n')))
          if (entry === undefined) return new Response('Unknown hold', { status: 404 })
          // Headers go out at once; the body ends when the page releases the hold, or the document goes away.
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              entry.controller = controller
            },
            cancel() {
              entry.controller = null
            },
          })
          return new Response(body, { headers: { ...noStore, 'content-type': 'image/png' } })
        }
        case '/api/hold-ready': {
          if (request.method !== 'POST') return new Response('POST required', { status: 405 })
          const body = await request.json() as { runId: string; n: number }
          if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
          const entry = holds.get(body.n)
          if (entry === undefined) return new Response('Unknown hold', { status: 404 })
          const wait = entry.servedAt + HOLD_READY_MS - Date.now()
          if (wait > 0) await Bun.sleep(wait)
          return Response.json({ ok: true })
        }
        case '/api/hold-release': {
          if (request.method !== 'POST') return new Response('POST required', { status: 405 })
          const body = await request.json() as { runId: string; n: number }
          if (body.runId !== runId) return new Response('Inactive run', { status: 409 })
          const entry = holds.get(body.n)
          if (entry === undefined) return new Response('Unknown hold', { status: 404 })
          try { entry.controller?.close() } catch { /* the document already went away */ }
          holds.delete(body.n)
          return Response.json({ ok: true })
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
      // A step posts whole rows. Bun.serve refuses bodies over 128 MiB by default, which the page sees as a NetworkError:
      // Firefox's row for the 269,747-unit held-out corpus paragraph passed that limit once stage 5 geometry landed.
      // idleTimeout 0: Bun closes a connection after 10 s without bytes by default, which would end Safari's held image.
      server = Bun.serve({ hostname: '127.0.0.1', port, fetch: fetchHandler, maxRequestBodySize: 1024 * 1024 * 1024, idleTimeout: 0 })
    } catch {
      // Taken between the check and the bind.
    }
  }
  if (server === null) throw new Error('No free port in 3002-3099')
  baseUrl = `http://127.0.0.1:${server.port}`
  console.log(`[lab] ${browser}: ${cases.length} cases, ${casesByContext.size} page contexts${predictOnly ? ', predictions only' : ''}${recordMeasurements ? ', recording measurements' : ''}${measureFirst ? ', measure first' : ''}; serving ${baseUrl}`)
  part = { reason: 'start', firstRow: 0, startedAt: Date.now(), firstStep: true }
  session = await launch(labUrl(cases[0]!))
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
  if (predictOnly ? totals.skippedNativeRows !== totals.rows : totals.skippedNativeRows > 0) errors.push(`${totals.skippedNativeRows} of ${totals.rows} rows skipped native observation${predictOnly ? '; --predict-only expects all' : ''}`)
  if (envs.size > 1) errors.push(`The environment changed during the run: ${[...envs.keys()].join(' | ')}`)
  if (pageLanguages.size > 1) errors.push(`The languages pages report changed during the run: ${[...pageLanguages.keys()].join(' | ')}`)
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
  finishPart()
  if (zstd !== null) {
    zstd.stdin.end()
    const code = await zstd.exited
    if (code !== 0) errors.push(`zstd exited with code ${code} writing ${measurementsPath}`)
    if (measurementTotals.cases !== totals.rows) errors.push(`Wrote ${measurementTotals.cases} measurement records for ${totals.rows} rows`)
  }
  const finishedAt = new Date()
  writeFileSync(runPath, JSON.stringify({
    status: errors.length === 0 ? 'ok' : 'error',
    errors,
    browser, app, build, languages, runId, casesFile: resolve(casesPath), rowsFile: rowsPath, predictor: predictorPath,
    family: familyFilter ?? null, limit: limit === Number.MAX_SAFE_INTEGER ? null : limit, order, chunkSize, bundleSha256, bundleBytes, allowSafariFrontmost,
    predictOnly,
    // --measure-first: the documents, each predicted whole before its first native layout; null under the usual protocol.
    measureFirst: measureFirst ? measureFirstTotals : null,
    // Parts: the fresh browser processes the run went through, and what ends one (null: nothing but the run's end).
    partCases: partCases === Number.MAX_SAFE_INTEGER ? null : partCases, partMs: partMs === Number.MAX_SAFE_INTEGER ? null : partMs, partsFrom: partsFrom === undefined ? null : resolve(partsFrom), parts,
    // run.ts --record-measurements.
    measurements: recordMeasurements ? { file: measurementsPath, ...measurementTotals } : null,
    startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt.getTime() - startedAt.getTime(),
    // From the start to the page's first request (bundle, launch, page load), then from there to the end.
    launchMs: firstStepAt === null ? null : firstStepAt - startedAt.getTime(),
    casesMs: firstStepAt === null ? null : finishedAt.getTime() - firstStepAt,
    totals,
    missingFonts: Object.fromEntries(missingFontCounts),
    pageContexts: [...casesByContext].map(([key, list]) => ({ context: JSON.parse(key) as [string, string[]], cases: list.length })),
    env: firstEnv,
    envs: [...envs].map(([key, rows]) => ({ ...JSON.parse(key) as object, rows })),
    pageLanguages: [...pageLanguages].map(([key, rows]) => ({ ...JSON.parse(key) as object, rows })),
    visibility: Object.fromEntries(visibility),
  }, null, 2) + '\n')
  console.log(`[lab] ${browser}: ${errors.length === 0 ? 'ok' : 'error'}; ${totals.rows} rows; ${runPath}`)
  if (totals.missingFontRows > 0) console.log(`[lab] ${browser}: ${totals.missingFontRows} rows name families the page couldn't resolve: ${[...missingFontCounts].map(([family, rows]) => `${family} (${rows})`).join(', ')}`)
  for (let i = 0; i < errors.length; i++) console.error(`[lab] ${errors[i]}`)
}
process.exit(errors.length === 0 ? 0 : 1)
