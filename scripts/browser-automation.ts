import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const LOCK_DIR = join(process.env['TMPDIR'] ?? tmpdir(), 'pretext-browser-automation-locks')

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

type ChromeCdpResponse = {
  id: number
  result?: unknown
  error?: {
    message?: string
  }
}

type ChromeCdpClient = {
  send: (method: string, params?: Record<string, unknown>) => Promise<ChromeCdpResponse>
  close: () => void
}

type ChromeCdpSessionState = {
  cdp: ChromeCdpClient
  chromeProcess: ChildProcess
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

async function connectChromeCdp(webSocketDebuggerUrl: string): Promise<ChromeCdpClient> {
  const ws = new WebSocket(webSocketDebuggerUrl)
  const pending = new Map<number, (message: ChromeCdpResponse) => void>()
  let nextId = 1

  ws.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ChromeCdpResponse
    if (message.id === undefined) return
    const resolve = pending.get(message.id)
    if (resolve !== undefined) {
      pending.delete(message.id)
      resolve(message)
    }
  }

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = event => reject(new Error(String((event as ErrorEvent).message ?? 'Chrome WebSocket error')))
  })

  return {
    async send(method: string, params: Record<string, unknown> = {}): Promise<ChromeCdpResponse> {
      const id = nextId++
      ws.send(JSON.stringify({ id, method, params }))
      return await new Promise<ChromeCdpResponse>(resolve => pending.set(id, resolve))
    },
    close() {
      ws.close()
    },
  }
}

function getChromeExecutable(): string {
  const explicit = process.env['CHROME_BIN'] ?? process.env['CHROME_PATH']
  if (explicit !== undefined && explicit.length > 0) {
    return explicit
  }

  const candidates = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    ]
    : [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ]

  const executable = candidates.find(candidate => candidate.length > 0 && existsSync(candidate))
  if (executable !== undefined) return executable

  throw new Error('Could not find Chrome. Set CHROME_BIN or CHROME_PATH to the Chrome executable.')
}

async function getChromePageWebSocketUrl(port: number): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json() as Array<{
        type?: string
        webSocketDebuggerUrl?: string
      }>
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl !== undefined)
      if (page?.webSocketDebuggerUrl !== undefined) {
        return page.webSocketDebuggerUrl
      }
    } catch {
      // Chrome may not have finished exposing the target list yet.
    }
    await sleep(100)
  }

  throw new Error('Timed out waiting for Chrome DevTools page target')
}

function getCdpStringValue(response: ChromeCdpResponse): string {
  const remoteResult = response.result as {
    result?: {
      value?: unknown
    }
  } | undefined

  const value = remoteResult?.result?.value
  return typeof value === 'string' ? value : ''
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

function killProcessTree(childProcess: ChildProcess): void {
  if (childProcess.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(childProcess.pid), '/t', '/f'], { stdio: 'ignore' })
    } catch {
      // Best effort cleanup.
    }
    return
  }

  try {
    childProcess.kill('SIGTERM')
  } catch {
    // Best effort cleanup.
  }
}

async function closeChromeCdpSessionState(state: ChromeCdpSessionState): Promise<void> {
  state.cdp.close()
  killProcessTree(state.chromeProcess)

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(state.profileDir, { recursive: true, force: true })
      return
    } catch {
      // Windows can keep the profile locked briefly after Chrome exits.
      await sleep(100)
    }
  }
}

async function initializeChromeCdpSession(): Promise<ChromeCdpSessionState> {
  const debuggingPort = await getAvailablePort()
  const profileDir = mkdtempSync(join(tmpdir(), 'pretext-chrome-'))
  const chromeProcess = spawn(getChromeExecutable(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
    'about:blank',
  ], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })

  let cdp: ChromeCdpClient | null = null

  try {
    await waitForPort(debuggingPort)
    const webSocketDebuggerUrl = await getChromePageWebSocketUrl(debuggingPort)
    cdp = await connectChromeCdp(webSocketDebuggerUrl)
    const page = await cdp.send('Page.enable')
    if (page.error !== undefined) {
      throw new Error(page.error.message ?? 'Failed to enable Chrome page domain')
    }

    return {
      cdp,
      chromeProcess,
      profileDir,
    }
  } catch (error) {
    cdp?.close()
    try {
      chromeProcess.kill('SIGTERM')
    } catch {
      // Best effort cleanup.
    }
    rmSync(profileDir, { recursive: true, force: true })
    throw error
  }
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
  if (process.platform !== 'darwin') {
    let statePromise: Promise<ChromeCdpSessionState> | null = null
    let closed = false

    function ensureState(): Promise<ChromeCdpSessionState> {
      if (closed) {
        return Promise.reject(new Error('Chrome automation session already closed'))
      }
      statePromise ??= initializeChromeCdpSession()
      return statePromise
    }

    return {
      async navigate(url) {
        const state = await ensureState()
        const navigate = await state.cdp.send('Page.navigate', { url })
        if (navigate.error !== undefined) {
          throw new Error(navigate.error.message ?? 'Chrome navigation failed')
        }
      },
      async readLocationUrl() {
        try {
          const state = await ensureState()
          const evaluation = await state.cdp.send('Runtime.evaluate', {
            expression: 'location.href',
            returnByValue: true,
          })
          if (evaluation.error !== undefined) {
            return ''
          }
          return getCdpStringValue(evaluation)
        } catch {
          return ''
        }
      },
      close() {
        if (closed) return
        closed = true
        if (statePromise === null) return
        void statePromise.then(closeChromeCdpSessionState, () => {})
      },
    }
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

  const serverProcess = spawn(process.execPath, [`--port=${port}`, '--no-hmr', 'pages/*.html'], {
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
