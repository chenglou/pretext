import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser as PlaywrightBrowser, BrowserContext as PlaywrightBrowserContext, Page as PlaywrightPage } from 'playwright-core'
import { readNavigationPhaseState, readNavigationReportText, type NavigationPhase } from '../shared/navigation-state.ts'

export type BrowserKind = 'chrome' | 'safari' | 'firefox'
export type AutomationBrowserKind = BrowserKind

type MaybePromise<T> = T | Promise<T>

export type BrowserSession = {
  navigate: (url: string) => MaybePromise<void>
  readLocationUrl: () => MaybePromise<string>
  close: () => void
}

export type BrowserSessionOptions = {
  foreground?: boolean
}

export type PageServer = {
  baseUrl: string
  process: ChildProcess | null
}

export type BrowserAutomationLock = {
  release: () => void
}

type ChromeAutomationDriver = 'apple-script' | 'playwright'

type PlaywrightChromeSessionState = {
  browser: PlaywrightBrowser
  context: PlaywrightBrowserContext
  page: PlaywrightPage
}

const PLAYWRIGHT_CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PLAYWRIGHT_CHROME_VIEWPORT = { width: 1512, height: 762 } as const
const PLAYWRIGHT_CHROME_SCREEN = { width: 1512, height: 982 } as const
const PLAYWRIGHT_CHROME_DEVICE_SCALE_FACTOR = 2
const PLAYWRIGHT_CHROME_SCREEN_INFO = '--screen-info={3024x1964 devicePixelRatio=2}'

function runAppleScript(lines: string[]): string {
  return execFileSync(
    'osascript',
    lines.flatMap(line => ['-e', line]),
    { encoding: 'utf8' },
  ).trim()
}

function getFrontmostApplicationName(): string | null {
  try {
    return runAppleScript([
      'tell application "System Events"',
      'return name of first application process whose frontmost is true',
      'end tell',
    ])
  } catch {
    return null
  }
}

function restoreFrontmostApplication(name: string | null): void {
  if (name === null || name.length === 0) return
  try {
    runAppleScript([`tell application ${JSON.stringify(name)} to activate`])
  } catch {
    // Best effort restore only.
  }
}

function runBackgroundAppleScript(lines: string[]): string {
  const frontmost = getFrontmostApplicationName()
  try {
    return runAppleScript(lines)
  } finally {
    restoreFrontmostApplication(frontmost)
  }
}

function getChromeAutomationDriver(options: BrowserSessionOptions): ChromeAutomationDriver {
  const raw = (process.env['CHROME_AUTOMATION_DRIVER'] ?? 'apple-script').trim().toLowerCase()

  if (raw === '' || raw === 'apple-script') {
    return 'apple-script'
  }

  if (raw === 'playwright') {
    if (options.foreground === true) {
      throw new Error('CHROME_AUTOMATION_DRIVER=playwright does not support foreground runs; use AppleScript for benchmarks')
    }
    return 'playwright'
  }

  throw new Error(`Unsupported CHROME_AUTOMATION_DRIVER=${raw}; expected apple-script or playwright`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForPort(port: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const open = await new Promise<boolean>(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port })
      let settled = false

      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }

      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
    })
    if (open) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for local port ${port}`)
}

export async function getAvailablePort(requestedPort: number | null = null): Promise<number> {
  if (requestedPort !== null && Number.isFinite(requestedPort) && requestedPort > 0) {
    return requestedPort
  }

  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Failed to allocate a free port'))
        return
      }

      const { port } = address
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

const LOCK_DIR = join(process.env['TMPDIR'] ?? '/tmp', 'pretext-browser-automation-locks')

type LockMetadata = {
  pid: number
  startedAt: number
}

function readLockMetadata(lockPath: string): LockMetadata | null {
  try {
    const raw = readFileSync(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LockMetadata>
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.startedAt !== 'number'
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EPERM'
    ) {
      return true
    }
    return false
  }
}

export async function acquireBrowserAutomationLock(
  browser: AutomationBrowserKind,
  timeoutMs = 120_000,
): Promise<BrowserAutomationLock> {
  mkdirSync(LOCK_DIR, { recursive: true })
  const lockPath = join(LOCK_DIR, `${browser}.lock`)
  const start = Date.now()

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
      }))
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try {
            closeSync(fd)
          } catch {
            // Ignore close races during teardown.
          }
          try {
            rmSync(lockPath)
          } catch {
            // Best effort cleanup.
          }
        },
      }
    } catch (error) {
      if (!(error instanceof Error) || !String(error).includes('EEXIST')) throw error
      const metadata = readLockMetadata(lockPath)
      if (metadata !== null && !isProcessAlive(metadata.pid)) {
        try {
          rmSync(lockPath)
          continue
        } catch {
          // Another process may have replaced or removed it. Retry normally.
        }
      }
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out waiting for ${browser} automation lock`)
      }
      await sleep(250)
    }
  }
}

async function canReachUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

const LOOPBACK_BASES = [
  'http://127.0.0.1',
  'http://localhost',
  'http://[::1]',
]

async function resolveBaseUrl(port: number, pathname: string): Promise<string | null> {
  for (const base of LOOPBACK_BASES) {
    const url = `${base}:${port}${pathname}`
    if (await canReachUrl(url)) {
      return `${base}:${port}`
    }
  }
  return null
}

function formatObservedLocation(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`
  }
}

function getTimeoutMessage(
  browser: BrowserKind,
  target: 'report' | 'posted report',
  lastPhase: NavigationPhase | null,
  observedUrl: string | null = null,
): string {
  if (lastPhase === null) {
    const locationLabel = observedUrl === null ? '' : `; last URL: ${observedUrl}`
    return `Timed out waiting for ${target} from ${browser} (no navigation feedback${locationLabel})`
  }
  return `Timed out waiting for ${target} from ${browser} (last phase: ${lastPhase})`
}

async function readLastNavigationPhase(
  session: BrowserSession,
  expectedRequestId: string,
): Promise<NavigationPhase | null> {
  const currentUrl = await session.readLocationUrl()
  const phaseState = readNavigationPhaseState(currentUrl)
  if (phaseState === null) return null
  if (phaseState.requestId !== undefined && phaseState.requestId !== expectedRequestId) {
    return null
  }
  return phaseState.phase
}

type BidiResponse = {
  id: number
  result?: unknown
  error?: string
  message?: string
  type?: string
}

type FirefoxBidiClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<BidiResponse>
  close: () => void
}

type FirefoxSessionState = {
  bidi: FirefoxBidiClient
  context: string
  firefoxProcess: ChildProcess
  profileDir: string
}

async function connectFirefoxBidi(port: number): Promise<FirefoxBidiClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`)
  const pending = new Map<number, (message: BidiResponse) => void>()
  let nextId = 1

  ws.onmessage = event => {
    const message = JSON.parse(String(event.data)) as BidiResponse
    if (message.id === undefined) return
    const resolve = pending.get(message.id)
    if (resolve !== undefined) {
      pending.delete(message.id)
      resolve(message)
    }
  }

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = event => reject(new Error(String((event as ErrorEvent).message ?? 'Firefox WebSocket error')))
  })

  return {
    async send(method: string, params: Record<string, unknown> = {}): Promise<BidiResponse> {
      const id = nextId++
      ws.send(JSON.stringify({ id, method, params }))
      return await new Promise<BidiResponse>(resolve => pending.set(id, resolve))
    },
    close() {
      ws.close()
    },
  }
}

function getBidiStringValue(response: BidiResponse): string {
  const remoteResult = response.result as {
    type?: string
    result?: {
      type?: string
      value?: unknown
    }
  } | undefined

  const value = remoteResult?.result?.value
  return typeof value === 'string' ? value : ''
}

function closeFirefoxSessionState(state: FirefoxSessionState): void {
  state.bidi.close()
  try {
    state.firefoxProcess.kill('SIGTERM')
  } catch {
    // Best effort cleanup.
  }
  rmSync(state.profileDir, { recursive: true, force: true })
}

async function initializeFirefoxSession(): Promise<FirefoxSessionState> {
  const bidiPort = await getAvailablePort()
  const profileDir = mkdtempSync(join(tmpdir(), 'pretext-firefox-'))
  const firefoxProcess = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', [
    '--headless',
    '--new-instance',
    '--profile',
    profileDir,
    '--remote-debugging-port',
    String(bidiPort),
    'about:blank',
  ], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })

  let bidi: FirefoxBidiClient | null = null

  try {
    await waitForPort(bidiPort)
    bidi = await connectFirefoxBidi(bidiPort)

    const session = await bidi.send('session.new', { capabilities: { alwaysMatch: {} } })
    if (session.error !== undefined) {
      throw new Error(session.message ?? session.error)
    }

    const tree = await bidi.send('browsingContext.getTree', {})
    if (tree.error !== undefined) {
      throw new Error(tree.message ?? tree.error)
    }

    const contexts = (tree.result as { contexts: Array<{ context: string }> }).contexts
    const context = contexts[0]?.context
    if (context === undefined) {
      throw new Error('Firefox BiDi returned no browsing context')
    }

    return {
      bidi,
      context,
      firefoxProcess,
      profileDir,
    }
  } catch (error) {
    bidi?.close()
    try {
      firefoxProcess.kill('SIGTERM')
    } catch {
      // Best effort cleanup.
    }
    rmSync(profileDir, { recursive: true, force: true })
    throw error
  }
}

async function loadPlaywrightChromium(): Promise<{
  launch: (options: {
    headless: boolean
    executablePath: string
    args: string[]
  }) => Promise<PlaywrightBrowser>
}> {
  try {
    const module = await import('playwright-core')
    return module.chromium
  } catch (error) {
    throw new Error(
      `CHROME_AUTOMATION_DRIVER=playwright requires playwright-core to be installed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

type PlaywrightChromeEnvironment = {
  innerWidth: number
  innerHeight: number
  screenWidth: number
  screenHeight: number
  dpr: number
}

async function readPlaywrightChromeEnvironment(page: PlaywrightPage): Promise<PlaywrightChromeEnvironment> {
  return await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    dpr: window.devicePixelRatio,
  }))
}

function formatPlaywrightChromeEnvironment(env: PlaywrightChromeEnvironment): string {
  return `${env.innerWidth}x${env.innerHeight} screen=${env.screenWidth}x${env.screenHeight} dpr=${env.dpr}`
}

async function assertPlaywrightChromeEnvironment(page: PlaywrightPage): Promise<void> {
  const env = await readPlaywrightChromeEnvironment(page)
  const matches =
    env.innerWidth === PLAYWRIGHT_CHROME_VIEWPORT.width &&
    env.innerHeight === PLAYWRIGHT_CHROME_VIEWPORT.height &&
    env.screenWidth === PLAYWRIGHT_CHROME_SCREEN.width &&
    env.screenHeight === PLAYWRIGHT_CHROME_SCREEN.height &&
    env.dpr === PLAYWRIGHT_CHROME_DEVICE_SCALE_FACTOR

  if (matches) return

  throw new Error(
    `Pinned Playwright Chrome environment mismatch: expected ${PLAYWRIGHT_CHROME_VIEWPORT.width}x${PLAYWRIGHT_CHROME_VIEWPORT.height} screen=${PLAYWRIGHT_CHROME_SCREEN.width}x${PLAYWRIGHT_CHROME_SCREEN.height} dpr=${PLAYWRIGHT_CHROME_DEVICE_SCALE_FACTOR}, got ${formatPlaywrightChromeEnvironment(env)}`,
  )
}

async function initializePlaywrightChromeSession(): Promise<PlaywrightChromeSessionState> {
  const chromium = await loadPlaywrightChromium()
  const browser = await chromium.launch({
    headless: true,
    executablePath: PLAYWRIGHT_CHROME_EXECUTABLE,
    args: [PLAYWRIGHT_CHROME_SCREEN_INFO],
  })

  try {
    const context = await browser.newContext({
      viewport: PLAYWRIGHT_CHROME_VIEWPORT,
      screen: PLAYWRIGHT_CHROME_SCREEN,
      deviceScaleFactor: PLAYWRIGHT_CHROME_DEVICE_SCALE_FACTOR,
    })
    const page = await context.newPage()
    return { browser, context, page }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

function closePlaywrightChromeSessionState(state: PlaywrightChromeSessionState): void {
  void state.context.close().catch(() => {})
  void state.browser.close().catch(() => {})
}

function createPlaywrightChromeSession(): BrowserSession {
  let statePromise: Promise<PlaywrightChromeSessionState> | null = null
  let closed = false

  function ensureState(): Promise<PlaywrightChromeSessionState> {
    if (closed) {
      return Promise.reject(new Error('Playwright Chrome automation session already closed'))
    }
    statePromise ??= initializePlaywrightChromeSession()
    return statePromise
  }

  return {
    async navigate(url) {
      const state = await ensureState()
      await state.page.goto(url, { waitUntil: 'load' })
      await assertPlaywrightChromeEnvironment(state.page)
    },
    async readLocationUrl() {
      try {
        const state = await ensureState()
        return state.page.url()
      } catch {
        return ''
      }
    },
    close() {
      if (closed) return
      closed = true
      if (statePromise === null) return
      void statePromise.then(closePlaywrightChromeSessionState, () => {})
    },
  }
}

function createSafariSession(options: BrowserSessionOptions): BrowserSession {
  const scriptLines = ['tell application "Safari"']

  if (options.foreground === true) {
    scriptLines.unshift('tell application "Safari" to activate')
  }

  scriptLines.push('set targetDocument to make new document with properties {URL:"about:blank"}')
  if (options.foreground === true) {
    scriptLines.push('set targetWindow to front window')
    scriptLines.push('set index of targetWindow to 1')
  }
  scriptLines.push('return id of front window as string')
  scriptLines.push('end tell')

  const windowIdRaw = options.foreground === true ? runAppleScript(scriptLines) : runBackgroundAppleScript(scriptLines)

  const windowId = Number.parseInt(windowIdRaw, 10)
  if (!Number.isFinite(windowId)) {
    throw new Error(`Failed to create Safari automation window: ${windowIdRaw}`)
  }

  return {
    navigate(url) {
      const navigateLines = [
        'tell application "Safari"',
        `set targetWindow to first window whose id is ${windowId}`,
      ]
      if (options.foreground === true) {
        navigateLines.unshift('tell application "Safari" to activate')
        navigateLines.push('set index of targetWindow to 1')
      }
      navigateLines.push(`set URL of current tab of targetWindow to ${JSON.stringify(url)}`)
      navigateLines.push('end tell')
      if (options.foreground === true) {
        runAppleScript(navigateLines)
      } else {
        runBackgroundAppleScript(navigateLines)
      }
    },
    readLocationUrl() {
      try {
        return runAppleScript([
          'tell application "Safari"',
          `return URL of current tab of (first window whose id is ${windowId})`,
          'end tell',
        ])
      } catch {
        return ''
      }
    },
    close() {
      try {
        runAppleScript([
          'tell application "Safari"',
          `close (first window whose id is ${windowId})`,
          'end tell',
        ])
      } catch {
        // Ignore cleanup failures if the user already closed the window.
      }
    },
  }
}

function createChromeSession(options: BrowserSessionOptions): BrowserSession {
  if (getChromeAutomationDriver(options) === 'playwright') {
    return createPlaywrightChromeSession()
  }

  const scriptLines = [
    'tell application "Google Chrome"',
    'if (count of windows) = 0 then make new window',
    'set targetWindow to front window',
    'set targetTab to make new tab at end of tabs of targetWindow with properties {URL:"about:blank"}',
  ]

  if (options.foreground === true) {
    scriptLines.splice(1, 0, 'activate')
    scriptLines.push('set active tab index of targetWindow to (count of tabs of targetWindow)')
  }

  scriptLines.push('return (id of targetWindow as string) & "," & (id of targetTab as string)')
  scriptLines.push('end tell')

  const identifiers = options.foreground === true ? runAppleScript(scriptLines) : runBackgroundAppleScript(scriptLines)

  const [windowIdRaw, tabIdRaw] = identifiers.split(',')
  const windowId = Number.parseInt(windowIdRaw ?? '', 10)
  const tabId = Number.parseInt(tabIdRaw ?? '', 10)
  if (!Number.isFinite(windowId) || !Number.isFinite(tabId)) {
    throw new Error(`Failed to create Chrome automation tab: ${identifiers}`)
  }

  return {
    navigate(url) {
      const navigateLines = [
        'tell application "Google Chrome"',
        `set targetWindow to first window whose id is ${windowId}`,
        `set URL of (first tab of targetWindow whose id is ${tabId}) to ${JSON.stringify(url)}`,
        'end tell',
      ]
      if (options.foreground === true) {
        runAppleScript(navigateLines)
      } else {
        runBackgroundAppleScript(navigateLines)
      }
    },
    readLocationUrl() {
      try {
        return runAppleScript([
          'tell application "Google Chrome"',
          `set targetWindow to first window whose id is ${windowId}`,
          `return URL of (first tab of targetWindow whose id is ${tabId})`,
          'end tell',
        ])
      } catch {
        return ''
      }
    },
    close() {
      try {
        runAppleScript([
          'tell application "Google Chrome"',
          `set targetWindow to first window whose id is ${windowId}`,
          `close (first tab of targetWindow whose id is ${tabId})`,
          'end tell',
        ])
      } catch {
        // Ignore cleanup failures if the user already closed the tab/window.
      }
    },
  }
}

function createFirefoxSession(_options: BrowserSessionOptions): BrowserSession {
  let statePromise: Promise<FirefoxSessionState> | null = null
  let closed = false

  function ensureState(): Promise<FirefoxSessionState> {
    if (closed) {
      return Promise.reject(new Error('Firefox automation session already closed'))
    }
    statePromise ??= initializeFirefoxSession()
    return statePromise
  }

  return {
    async navigate(url) {
      const state = await ensureState()
      const navigate = await state.bidi.send('browsingContext.navigate', {
        context: state.context,
        url,
        wait: 'none',
      })
      if (navigate.error !== undefined) {
        throw new Error(navigate.message ?? navigate.error)
      }
    },
    async readLocationUrl() {
      try {
        const state = await ensureState()
        const evaluation = await state.bidi.send('script.evaluate', {
          expression: 'location.href',
          target: { context: state.context },
          awaitPromise: true,
          resultOwnership: 'none',
        })
        if (evaluation.error !== undefined) {
          return ''
        }
        return getBidiStringValue(evaluation)
      } catch {
        return ''
      }
    },
    close() {
      if (closed) return
      closed = true
      if (statePromise === null) return
      void statePromise.then(closeFirefoxSessionState, () => {})
    },
  }
}

export function createBrowserSession(
  browser: BrowserKind,
  options: BrowserSessionOptions = {},
): BrowserSession {
  if (browser === 'safari') return createSafariSession(options)
  if (browser === 'firefox') return createFirefoxSession(options)
  return createChromeSession(options)
}

export async function ensurePageServer(
  port: number,
  pathname: string,
  cwd: string,
): Promise<PageServer> {
  const existingBaseUrl = await resolveBaseUrl(port, pathname)
  if (existingBaseUrl !== null) {
    return { baseUrl: existingBaseUrl, process: null }
  }

  const serverProcess = spawn('/bin/zsh', ['-lc', `bun --port=${port} --no-hmr pages/*.html`], {
    cwd,
    stdio: 'ignore',
  })

  const start = Date.now()
  while (Date.now() - start < 20_000) {
    const baseUrl = await resolveBaseUrl(port, pathname)
    if (baseUrl !== null) {
      return { baseUrl, process: serverProcess }
    }
    await sleep(100)
  }

  throw new Error(`Timed out waiting for local Bun server on port ${port}${pathname}`)
}

export async function loadHashReport<T extends { requestId?: string }>(
  session: BrowserSession,
  url: string,
  expectedRequestId: string,
  browser: BrowserKind,
  timeoutMs = 60_000,
): Promise<T> {
  await session.navigate(url)

  const attempts = Math.max(1, Math.ceil(timeoutMs / 100))
  let lastPhase: NavigationPhase | null = null
  for (let i = 0; i < attempts; i++) {
    await sleep(100)
    const currentUrl = await session.readLocationUrl()
    const phase = readNavigationPhaseState(currentUrl)
    if (
      phase !== null &&
      (phase.requestId === undefined || phase.requestId === expectedRequestId)
    ) {
      lastPhase = phase.phase
    }
    const reportJson = readNavigationReportText(currentUrl)
    if (reportJson === '' || reportJson === 'null') continue

    const report = JSON.parse(reportJson) as T
    if (report.requestId === expectedRequestId) {
      return report
    }
  }

  if (lastPhase === null) {
    lastPhase = await readLastNavigationPhase(session, expectedRequestId)
  }
  const observedUrl = formatObservedLocation(await session.readLocationUrl())
  throw new Error(getTimeoutMessage(browser, 'report', lastPhase, observedUrl))
}

export async function loadPostedReport<T extends { requestId?: string }>(
  session: BrowserSession,
  url: string,
  waitForReport: () => Promise<T>,
  expectedRequestId: string,
  browser: BrowserKind,
  timeoutMs = 60_000,
): Promise<T> {
  await session.navigate(url)

  let resolvedReport: T | null = null
  let reportError: unknown = null

  void waitForReport().then(
    value => {
      resolvedReport = value
    },
    error => {
      reportError = error
    },
  )

  const attempts = Math.max(1, Math.ceil(timeoutMs / 100))
  let lastPhase: NavigationPhase | null = null
  for (let i = 0; i < attempts; i++) {
    await sleep(100)
    if (resolvedReport !== null) {
      return resolvedReport
    }
    if (reportError !== null) {
      throw reportError
    }

    const phase = await readLastNavigationPhase(session, expectedRequestId)
    if (phase !== null) {
      lastPhase = phase
    }
  }

  if (resolvedReport !== null) {
    return resolvedReport
  }
  if (reportError !== null) {
    throw reportError
  }

  const observedUrl = formatObservedLocation(await session.readLocationUrl())
  throw new Error(getTimeoutMessage(browser, 'posted report', lastPhase, observedUrl))
}
