// The browsers a job runs in, and the environment key a recording is kept under.
//
// Chrome and Firefox are pinned: private copies of the installed apps, so an update of /Applications can't change the
// build under a recording. Make one with `ditto "/Applications/Google Chrome.app" "<apps>/Google Chrome <version>.app"`
// and bump the version here. Firefox updates the bundle it runs from under any profile but the harness's: macOS
// reopened the 156.0 copy at login after a crash, under the default profile, and Firefox updated it to 156.0.1. A
// release build takes the update policy only from its bundle or the system, so a Firefox copy also gets
// Contents/Resources/distribution/policies.json holding {"policies": {"DisableAppUpdate": true}} before its first
// launch, after which macOS keeps other apps from writing inside it. WebKit runs as webkit-host, the system
// WebKit.framework that installed Safari runs, in a background window (harness/webkit-host/build.sh); installed Safari
// opens one window of its own. None of them takes focus.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { BrowserKind, PageEnv } from './types.ts'

const APPS = process.env['HARNESS_APPS'] ?? join(homedir(), 'github/browser-engines/apps')
export const PINNED = { chrome: 'Google Chrome 154.0.8037.57', firefox: 'Firefox 156.0.1' } as const
const ROOT = resolve(import.meta.dir, '..')
const PROFILES = join(ROOT, '.artifacts/harness-profiles')
export const WEBKIT_HOST = join(ROOT, '.artifacts/webkit-host/webkit-host')
export const FONTS_DIR = join(ROOT, 'harness/fonts')

function command(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 60_000 }).trim()
}

function appPath(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome': return join(APPS, `${PINNED.chrome}.app`)
    case 'firefox': return join(APPS, `${PINNED.firefox}.app`)
    case 'webkit-host':
    case 'safari': return '/Applications/Safari.app'
  }
}

function bundleVersion(bundle: string, key = 'CFBundleShortVersionString'): string {
  return command('plutil', ['-extract', key, 'raw', '-o', '-', bundle])
}

// What a recording depends on besides the case: the browser build (and WebKit's, for the browsers that run the system
// framework), the OS build (fonts, Core Text and ICU move with it), the languages the OS and the page run under, the
// device pixel ratio and the web fonts served. The harness refuses to score a recording under another key.
export type Environment = {
  browser: BrowserKind; version: string; webkit: string | null; os: string; osLanguages: string; pageLanguages: readonly string[]
  devicePixelRatio: number; fonts: string
}

export function keyOf(e: Environment): string {
  return `${e.browser} ${e.version}${e.webkit === null ? '' : ` webkit=${e.webkit}`} os=${e.os} os-languages=${e.osLanguages} page-languages=${e.pageLanguages.join(',')} dpr=${e.devicePixelRatio} fonts=${e.fonts}`
}

// What the page serves: each fixture's family, weight and file bytes, not the manifest's notes on where it came from.
export function fontsKey(dir: string): string {
  const fixtures = JSON.parse(readFileSync(join(dir, 'fonts.json'), 'utf8')) as Array<{ family: string; weight: string; file: string }>
  const hasher = new Bun.CryptoHasher('sha256')
  for (let i = 0; i < fixtures.length; i++) hasher.update(`${fixtures[i]!.family}\t${fixtures[i]!.weight}\t`).update(readFileSync(join(dir, fixtures[i]!.file)))
  return hasher.digest('hex').slice(0, 12)
}

export function environmentKey(browser: BrowserKind, env: PageEnv): string {
  const system = browser === 'webkit-host' || browser === 'safari'
  return keyOf({
    browser,
    version: bundleVersion(join(appPath(browser), 'Contents/Info.plist')),
    webkit: system ? bundleVersion('/System/Library/Frameworks/WebKit.framework/Resources/Info.plist', 'CFBundleVersion') : null,
    os: command('sw_vers', ['-buildVersion']),
    osLanguages: command('defaults', ['read', '-g', 'AppleLanguages']).replace(/[\s"()]/g, ''),
    pageLanguages: env.languages,
    devicePixelRatio: env.devicePixelRatio,
    fonts: fontsKey(FONTS_DIR),
  })
}

export type Session = { close: () => Promise<void> }

function processes(): Array<{ pid: number; command: string }> {
  const out: Array<{ pid: number; command: string }> = []
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null) out.push({ pid: Number(match[1]), command: match[2]! })
  }
  return out
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Stops the one process this job launched, found by its own profile folder, then removes the profile.
async function stop(pid: number, profile: string): Promise<void> {
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 80 && alive(pid); i++) {
    if (i === 40) process.kill(pid, 'SIGKILL')
    await Bun.sleep(100)
  }
  await Bun.sleep(1000)
  rmSync(profile, { recursive: true, force: true })
}

// Chrome and Firefox start through LaunchServices without activation: macOS 27 won't let a shell-spawned Firefox read
// its data folders. One attempt only, since a failed launch can show the user a dialog.
async function openApp(app: string, executable: string, marker: string, profile: string, args: string[]): Promise<Session> {
  execFileSync('open', ['-n', '-g', '-a', app, '--args', ...args], { stdio: 'ignore', timeout: 60_000 })
  for (let i = 0; i < 100; i++) {
    const found = processes().find(entry => entry.command.startsWith(`${executable} `) && entry.command.includes(marker))
    if (found !== undefined) return { close: () => stop(found.pid, profile) }
    await Bun.sleep(100)
  }
  throw new Error(`Could not find the ${app} process just launched`)
}

// Chrome activates itself when it shows a window the usual way, so it starts with none, and the job's one window is
// opened in the background through the DevTools protocol (Target.createTarget { newWindow, background }).
async function launchChrome(url: string, profile: string): Promise<Session> {
  const app = appPath('chrome')
  mkdirSync(join(profile, 'Default'), { recursive: true })
  writeFileSync(join(profile, 'Default/Preferences'), JSON.stringify({ intl: { accept_languages: 'en-US,en', selected_languages: 'en-US,en' } }))
  const session = await openApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    `--user-data-dir=${profile}`, '--disable-updater-scheduler', '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-extensions', '--disable-component-update', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-size=1200,900',
    '--no-startup-window', '--remote-debugging-port=0', '-AppleLanguages', '(en-US)',
  ])
  try {
    let endpoint: string | null = null
    for (let i = 0; i < 150 && endpoint === null; i++) {
      try {
        const match = /^(\d+)\n(\/devtools\/browser\/[\w-]+)/.exec(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8'))
        if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
      } catch {
        // Not written yet.
      }
      if (endpoint === null) await Bun.sleep(100)
    }
    if (endpoint === null) throw new Error('Chrome did not write DevToolsActivePort')
    const socket = new WebSocket(endpoint)
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Target.createTarget did not answer in 15 s')), 15_000)
      socket.onerror = () => fail(new Error('DevTools socket error'))
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: true } }))
      socket.onmessage = event => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } }
        if (reply.id !== 1) return
        clearTimeout(timer)
        if (reply.error === undefined) done()
        else fail(new Error(`Target.createTarget: ${reply.error.message}`))
      }
    }).finally(() => socket.close())
  } catch (error) {
    await session.close()
    throw error
  }
  return session
}

function launchFirefox(url: string, profile: string): Promise<Session> {
  const app = appPath('firefox')
  mkdirSync(profile, { recursive: true })
  const prefs: Array<[string, boolean | string]> = [
    ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
    ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
    ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
    ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
    ['app.update.auto', false], ['app.update.staging.enabled', false],
    ['intl.locale.requested', 'en-US'], ['intl.accept_languages', 'en-US, en'], ['intl.regional_prefs.use_os_locales', false],
  ]
  writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))
  return openApp(app, `${app}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile, ['--new-instance', '--profile', profile, url])
}

async function launchWebKitHost(url: string): Promise<Session> {
  if (!await Bun.file(WEBKIT_HOST).exists()) throw new Error(`${WEBKIT_HOST} is missing; build it with harness/webkit-host/build.sh`)
  const host = Bun.spawn([WEBKIT_HOST, `--url=${url}`, '--exit-title=harness done'], { stdin: 'ignore', stdout: 'inherit', stderr: 'ignore' })
  return {
    async close() {
      host.kill('SIGTERM')
      await host.exited
    },
  }
}

function appleScript(lines: string[]): string {
  return command('osascript', lines.flatMap(line => ['-e', line]))
}

function frontmostApp(): string | null {
  try {
    return appleScript(['tell application "System Events"', 'return name of first application process whose frontmost is true', 'end tell'])
  } catch {
    return null
  }
}

// Installed Safari: one window of the job's own, found by a URL no other window has, never activated. A new document in
// a frontmost Safari opens over the user's windows and takes the keyboard, so the window is made only while another app
// is frontmost, and that app gets the focus back if Safari takes it. WebKit suspends a hidden page, so the window must
// stay uncovered while the job runs.
async function launchSafari(url: string, jobId: string, owns: (tabUrl: string) => boolean): Promise<Session> {
  for (let waited = 0; frontmostApp() === 'Safari'; waited += 2000) {
    if (waited >= 600_000) throw new Error('Safari stayed the frontmost app for 10 minutes; not opening a window over the user\'s')
    await Bun.sleep(2000)
  }
  const marker = JSON.stringify(`about:blank#pretext-harness-${jobId}`)
  const front = frontmostApp()
  const id = appleScript([
    'tell application "Safari"', `make new document with properties {URL:${marker}}`,
    'repeat with w in windows', `if (count of tabs of w) is 1 and URL of tab 1 of w is ${marker} then`,
    `set URL of tab 1 of w to ${JSON.stringify(url)}`, 'return id of w', 'end if', 'end repeat', 'end tell',
  ])
  if (front !== null && frontmostApp() !== front) appleScript([`tell application ${JSON.stringify(front)} to activate`])
  if (!/^\d+$/.test(id)) throw new Error('Could not find the Safari window just made')
  return {
    close() {
      try {
        const tabUrl = appleScript(['tell application "Safari"', `return URL of tab 1 of (first window whose id is ${id})`, 'end tell'])
        if (owns(tabUrl)) appleScript(['tell application "Safari"', `close (first window whose id is ${id})`, 'end tell'])
      } catch {
        // The window is already gone.
      }
      return Promise.resolve()
    },
  }
}

export function launch(browser: BrowserKind, url: string, jobId: string, owns: (tabUrl: string) => boolean): Promise<Session> {
  const profile = join(PROFILES, `${browser}-${jobId}`)
  switch (browser) {
    case 'chrome': return launchChrome(url, profile)
    case 'firefox': return launchFirefox(url, profile)
    case 'webkit-host': return launchWebKitHost(url)
    case 'safari': return launchSafari(url, jobId, owns)
  }
}
