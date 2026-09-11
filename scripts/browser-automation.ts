import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  close: () => Promise<void>
}

export type BrowserSessionOptions = {
  foreground?: boolean
  headless?: boolean
}

export type PageServer = {
  baseUrl: string
  process: ChildProcess
}

export type BrowserAutomationLock = {
  release: () => void
}

function runAppleScript(lines: string[]): string {
  return execFileSync(
    'osascript',
    lines.flatMap(line => ['-e', line]),
    { encoding: 'utf8', timeout: 15_000 },
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

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
  let launchError: Error | null = null
  const onError = (error: Error): void => { launchError = error }
  child.on('error', onError)
  try {
    for (let i = 0; i < 200; i++) {
      if (launchError !== null) throw launchError
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Browser process exited during startup')
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
  } finally {
    child.off('error', onError)
  }
}

export async function getAvailablePort(requestedPort: number | null = null): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(requestedPort ?? 0, '127.0.0.1', () => {
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

function sameNavigationUrl(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual)
    const expectedUrl = new URL(expected)
    actualUrl.hash = ''
    expectedUrl.hash = ''
    return actualUrl.href === expectedUrl.href
  } catch {
    return false
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
  const pending = new Map<number, { resolve: (message: BidiResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let nextId = 1

  ws.onmessage = event => {
    const message = JSON.parse(String(event.data)) as BidiResponse
    if (message.id === undefined) return
    const request = pending.get(message.id)
    if (request !== undefined) {
      pending.delete(message.id)
      clearTimeout(request.timer)
      request.resolve(message)
    }
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      ws.onopen = null
      ws.onerror = null
      ws.onclose = null
      if (error === undefined) resolve()
      else {
        reject(error)
        ws.close()
      }
    }
    const timer = setTimeout(() => finish(new Error('Timed out connecting to Firefox BiDi')), 10_000)
    ws.onopen = () => finish()
    ws.onerror = () => finish(new Error('Firefox BiDi connection failed'))
    ws.onclose = () => finish(new Error('Firefox BiDi closed during connection'))
  })

  function rejectPending(): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Firefox BiDi connection closed'))
    }
    pending.clear()
  }
  ws.onclose = rejectPending
  ws.onerror = rejectPending

  return {
    async send(method: string, params: Record<string, unknown> = {}): Promise<BidiResponse> {
      const id = nextId++
      return await new Promise<BidiResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out waiting for Firefox BiDi ${method}`))
        }, 10_000)
        pending.set(id, { resolve, reject, timer })
        try {
          ws.send(JSON.stringify({ id, method, params }))
        } catch (error) {
          clearTimeout(timer)
          pending.delete(id)
          reject(error)
        }
      })
    },
    close() {
      rejectPending()
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

async function stopFirefoxProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(killTimer)
      clearTimeout(deadline)
      child.off('exit', onExit)
      child.off('error', finish)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onExit = (): void => finish()
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
    const deadline = setTimeout(() => finish(new Error('Firefox process did not exit during teardown')), 5_000)
    child.once('exit', onExit)
    child.once('error', finish)
    child.kill('SIGTERM')
  })
}

async function closeFirefoxSessionState(state: FirefoxSessionState): Promise<void> {
  state.bidi.close()
  await stopFirefoxProcess(state.firefoxProcess)
  rmSync(state.profileDir, { recursive: true, force: true })
}

async function initializeFirefoxSession(options: BrowserSessionOptions): Promise<FirefoxSessionState> {
  const bidiPort = await getAvailablePort()
  const profileDir = mkdtempSync(join(tmpdir(), 'pretext-firefox-'))
  // The startup default-browser dialog takes focus from the owned page.
  // Disable that prompt only in this disposable automation profile.
  writeFileSync(join(profileDir, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\n')
  const firefoxProcess = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', [
    ...(options.headless === false || options.foreground === true ? [] : ['--headless']),
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
    await waitForPort(bidiPort, firefoxProcess)
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
    await stopFirefoxProcess(firefoxProcess)
    rmSync(profileDir, { recursive: true, force: true })
    throw error
  }
}

function createSafariSession(options: BrowserSessionOptions): BrowserSession {
  // Safari exposes no stable tab ID. Own a dedicated single-tab window and
  // verify its URL before using it; a changed selection must not redirect us.
  const initialUrl = `about:blank#pretext-automation-${randomUUID()}`
  const scriptLines = ['tell application "Safari"']
  if (options.foreground === true) scriptLines.push('activate')
  scriptLines.push(`make new document with properties {URL:${JSON.stringify(initialUrl)}}`)
  scriptLines.push('return id of front window as string', 'end tell')
  const windowIdRaw = options.foreground === true ? runAppleScript(scriptLines) : runBackgroundAppleScript(scriptLines)
  const windowId = Number.parseInt(windowIdRaw, 10)
  if (!Number.isFinite(windowId)) throw new Error(`Failed to create Safari automation window: ${windowIdRaw}`)

  let expectedUrl = initialUrl
  let previousUrl: string | null = null
  let closed = false

  function ownsUrl(url: string): boolean {
    return url === initialUrl || (expectedUrl !== initialUrl && sameNavigationUrl(url, expectedUrl)) ||
      (previousUrl !== null && previousUrl !== initialUrl && sameNavigationUrl(url, previousUrl))
  }

  function readOwnedTab(): string {
    if (closed) throw new Error('Safari automation session already closed')
    const current = runAppleScript([
      'tell application "Safari"',
      `set targetWindow to first window whose id is ${windowId}`,
      'if (count of tabs of targetWindow) is not 1 then error "Safari automation window no longer contains its single owned tab"',
      'return URL of tab 1 of targetWindow',
      'end tell',
    ])
    if (!ownsUrl(current)) throw new Error(`Safari automation tab navigated elsewhere: ${formatObservedLocation(current)}`)
    if (sameNavigationUrl(current, expectedUrl)) previousUrl = null
    return current
  }

  return {
    navigate(url) {
      const current = readOwnedTab()
      const navigateLines = [
        'tell application "Safari"',
        `set targetWindow to first window whose id is ${windowId}`,
        'if (count of tabs of targetWindow) is not 1 then error "Safari automation window no longer contains its single owned tab"',
        `if URL of tab 1 of targetWindow is not ${JSON.stringify(current)} then error "Safari automation tab changed before navigation"`,
      ]
      if (options.foreground === true) navigateLines.push('activate', 'set index of targetWindow to 1')
      navigateLines.push(`set URL of tab 1 of targetWindow to ${JSON.stringify(url)}`, 'end tell')
      if (options.foreground === true) runAppleScript(navigateLines)
      else runBackgroundAppleScript(navigateLines)
      previousUrl = expectedUrl
      expectedUrl = url
    },
    readLocationUrl: readOwnedTab,
    async close() {
      if (closed) return
      closed = true
      try {
        // The user may have added tabs after our last check. Close only a
        // uniquely identifiable owned URL, never the entire changed window.
        const urls = runAppleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          'set tabURLs to {}',
          'repeat with targetTab in tabs of targetWindow',
          'set end of tabURLs to URL of targetTab',
          'end repeat',
          "set AppleScript's text item delimiters to linefeed",
          'return tabURLs as string',
          'end tell',
        ]).split('\n')
        const owned = urls.filter(ownsUrl)
        if (owned.length !== 1) return
        runAppleScript([
          'tell application "Safari"',
          `set targetWindow to first window whose id is ${windowId}`,
          `set ownedTabs to tabs of targetWindow whose URL is ${JSON.stringify(owned[0])}`,
          'if (count of ownedTabs) is 1 then close item 1 of ownedTabs',
          'end tell',
        ])
      } catch {
        // The owned tab/window may already be closed. Do not fall back to a
        // current tab or another window during teardown.
      }
    },
  }
}

function createChromeSession(options: BrowserSessionOptions): BrowserSession {
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
        `set targetTab to first tab of targetWindow whose id is ${tabId}`,
      ]
      if (options.foreground === true) {
        navigateLines.push('activate', 'set index of targetWindow to 1',
          'repeat with tabIndex from 1 to count of tabs of targetWindow',
          `if (id of tab tabIndex of targetWindow as string) is ${JSON.stringify(String(tabId))} then`,
          'set active tab index of targetWindow to tabIndex', 'exit repeat', 'end if', 'end repeat')
      }
      navigateLines.push(`set URL of targetTab to ${JSON.stringify(url)}`, 'end tell')
      if (options.foreground === true) {
        runAppleScript(navigateLines)
      } else {
        runBackgroundAppleScript(navigateLines)
      }
    },
    readLocationUrl() {
      return runAppleScript([
        'tell application "Google Chrome"',
        `set targetWindow to first window whose id is ${windowId}`,
        `return URL of (first tab of targetWindow whose id is ${tabId})`,
        'end tell',
      ])
    },
    async close() {
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

function createFirefoxSession(options: BrowserSessionOptions): BrowserSession {
  let statePromise: Promise<FirefoxSessionState> | null = null
  let closePromise: Promise<void> | null = null
  let closed = false

  function ensureState(): Promise<FirefoxSessionState> {
    if (closed) {
      return Promise.reject(new Error('Firefox automation session already closed'))
    }
    statePromise ??= initializeFirefoxSession(options)
    return statePromise
  }

  return {
    async navigate(url) {
      const state = await ensureState()
      if (options.foreground === true) {
        const activated = await state.bidi.send('browsingContext.activate', { context: state.context })
        if (activated.error !== undefined) throw new Error(activated.message ?? activated.error)
        const pid = state.firefoxProcess.pid
        if (pid === undefined) throw new Error('The owned Firefox process has no PID')
        runAppleScript([
          'tell application "System Events"',
          `set frontmost of (first application process whose unix id is ${pid}) to true`,
          'end tell',
        ])
      }
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
      const state = await ensureState()
      const evaluation = await state.bidi.send('script.evaluate', {
        expression: 'location.href',
        target: { context: state.context },
        awaitPromise: true,
        resultOwnership: 'none',
      })
      if (evaluation.error !== undefined) throw new Error(evaluation.message ?? evaluation.error)
      return getBidiStringValue(evaluation)
    },
    close() {
      closed = true
      closePromise ??= statePromise === null ? Promise.resolve() : statePromise.then(closeFirefoxSessionState, () => {})
      return closePromise
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
    throw new Error(`Refusing to reuse the server at ${existingBaseUrl}${pathname}; choose an unused port for this checkout`)
  }

  const entrypoints = Array.from(new Bun.Glob('pages/**/*.html').scanSync({ cwd })).sort()
  const serverProcess = spawn(process.execPath, [`--port=${port}`, '--no-hmr', ...entrypoints], {
    cwd,
    stdio: 'ignore',
  })

  try {
    const start = Date.now()
    while (Date.now() - start < 20_000) {
      if (serverProcess.exitCode !== null) throw new Error(`Bun page server exited with code ${serverProcess.exitCode}`)
      const baseUrl = await resolveBaseUrl(port, pathname)
      if (baseUrl !== null) {
        return { baseUrl, process: serverProcess }
      }
      await sleep(100)
    }
    throw new Error(`Timed out waiting for local Bun server on port ${port}${pathname}`)
  } catch (error) {
    serverProcess.kill()
    throw error
  }
}

export async function loadHashReport<T extends { requestId?: string }>(
  session: BrowserSession,
  url: string,
  expectedRequestId: string,
  browser: BrowserKind,
  timeoutMs = 60_000,
): Promise<T> {
  await session.navigate(url)

  const deadline = Date.now() + timeoutMs
  let lastPhase: NavigationPhase | null = null
  while (Date.now() < deadline) {
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
      if (!sameNavigationUrl(currentUrl, url)) throw new Error(`Hash report arrived from an unexpected ${browser} URL: ${formatObservedLocation(currentUrl)}`)
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
  const timedOut = Symbol('posted-report-timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  // Subscribe before navigating: startup failure must not leave the report
  // server's pending rejection unobserved during teardown.
  const reportPromise = Promise.resolve().then(waitForReport)
  const completion = Promise.all([reportPromise, Promise.resolve().then(() => session.navigate(url))]).then(async ([report]) => {
    if (report.requestId !== expectedRequestId) throw new Error(`Unexpected posted report request from ${browser}`)
    const currentUrl = await session.readLocationUrl()
    if (!sameNavigationUrl(currentUrl, url)) {
      throw new Error(`Posted report arrived after ${browser} left its target URL: ${formatObservedLocation(currentUrl)}`)
    }
    return report
  })
  try {
    const result = await Promise.race([
      completion,
      new Promise<typeof timedOut>(resolve => { timer = setTimeout(() => resolve(timedOut), timeoutMs) }),
    ])
    if (result !== timedOut) return result
    // Successful POST runs need no repeated AppleScript polling. Read one
    // bounded diagnostic only after the deadline has already invalidated it.
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined
    let diagnostic: string
    try {
      diagnostic = await Promise.race([
        Promise.resolve().then(() => session.readLocationUrl()).catch(() => ''),
        new Promise<string>(resolve => { diagnosticTimer = setTimeout(() => resolve(''), 1_000) }),
      ])
    } finally {
      if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer)
    }
    const phase = readNavigationPhaseState(diagnostic)
    const lastPhase = phase?.requestId === expectedRequestId ? phase.phase : null
    throw new Error(getTimeoutMessage(browser, 'posted report', lastPhase, formatObservedLocation(diagnostic)))
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
