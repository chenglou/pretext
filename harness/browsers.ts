// The browsers a job runs in, and the environment key a recording is kept under.
//
// Chrome and Firefox are pinned: private copies of the installed apps, so an update of /Applications can't change the
// build under a recording. `bun harness repin chrome|firefox` makes one (pinInstalled) and, with --write, bumps the
// version here. Firefox updates the bundle it runs from under any profile but the harness's: macOS
// reopened the 156.0 copy at login after a crash, under the default profile, and Firefox updated it to 156.0.1. A
// release build takes the update policy only from its bundle or the system, so a Firefox copy also gets
// Contents/Resources/distribution/policies.json holding {"policies": {"DisableAppUpdate": true}} before its first
// launch, after which macOS keeps other apps from writing inside it. WebKit runs as webkit-host, the system
// WebKit.framework that installed Safari runs, in a background window (harness/webkit-host/build.sh); installed Safari
// opens one window of its own. None of them takes focus, but the bench's foreground runs, where Chrome, Firefox
// and Safari come to the front.
import { dlopen, FFIType } from 'bun:ffi'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { BrowserKind, PageEnv } from './types.ts'

const APPS = process.env['HARNESS_APPS'] ?? join(homedir(), 'github/browser-engines/apps')
export const PINNED = { chrome: 'Google Chrome 154.0.8037.57', firefox: 'Firefox 156.0.1' } as const
// The copies this process runs: PINNED, unless `repin` pointed one at a new copy.
export const pins: Record<keyof typeof PINNED, string> = { ...PINNED }
const ROOT = resolve(import.meta.dir, '..')
const PROFILES = join(ROOT, '.artifacts/harness-profiles')
export const WEBKIT_HOST = join(ROOT, '.artifacts/webkit-host/webkit-host')
export const FONTS_DIR = join(ROOT, 'harness/fonts')

function command(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 60_000 }).trim()
}

export function appPath(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome': return join(APPS, `${pins.chrome}.app`)
    case 'firefox': return join(APPS, `${pins.firefox}.app`)
    case 'webkit-host':
    case 'safari': return '/Applications/Safari.app'
  }
}

function bundleVersion(bundle: string, key = 'CFBundleShortVersionString'): string {
  return command('plutil', ['-extract', key, 'raw', '-o', '-', bundle])
}

const POLICY_FILE = 'Contents/Resources/distribution/policies.json'
const POLICY = '{"policies": {"DisableAppUpdate": true}}\n'

// A tree's hash as rebuild/lab/pin-browser.sh takes it: every file's path and sha256 and every link's target, the paths
// sorted bytewise (LC_ALL=C; under a UTF-8 locale the same tree hashes otherwise), leaving out the file `skip` names.
function treeHash(dir: string, skip = ''): string {
  const script = 'set -o pipefail; cd "$1" && { find . -type f ! -path "./$2" -print0 | sort -z | xargs -0 shasum -a 256; '
    + 'find . -type l -print0 | sort -z | while IFS= read -r -d "" link; do printf "link %s -> %s\\n" "$link" "$(readlink "$link")"; done; } | shasum -a 256 | cut -d" " -f1'
  return execFileSync('bash', ['-c', script, 'tree-hash', dir, skip], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, timeout: 600_000 }).trim()
}

// The installed app as a pinned copy named by its version, made as pin-browser.sh makes one: ditto clones the files on
// APFS, the copy must hash as the installed tree does, a Firefox copy gets the update policy before its first launch,
// and the copy's tree hash goes beside it. Returns the copy's name.
export function pinInstalled(browser: keyof typeof PINNED): string {
  const label = browser === 'chrome' ? 'Google Chrome' : 'Firefox'
  const installed = `/Applications/${label}.app`
  const name = `${label} ${bundleVersion(join(installed, 'Contents/Info.plist'))}`
  const copy = join(APPS, `${name}.app`)
  mkdirSync(APPS, { recursive: true })
  if (!existsSync(copy)) execFileSync('ditto', [installed, copy], { timeout: 600_000 })
  const want = treeHash(installed)
  let hash = treeHash(copy, POLICY_FILE)
  if (hash !== want) throw new Error(`${copy} (${hash}) differs from ${installed} (${want})`)
  if (browser === 'firefox') {
    if (!existsSync(join(copy, POLICY_FILE)) || readFileSync(join(copy, POLICY_FILE), 'utf8') !== POLICY) {
      mkdirSync(dirname(join(copy, POLICY_FILE)), { recursive: true })
      writeFileSync(join(copy, POLICY_FILE), POLICY)
    }
    hash = treeHash(copy)
  }
  writeFileSync(`${copy}.tree-sha256`, `${hash}\n`)
  return name
}

// `repin --write`: PINNED in this file names the copy.
export function writePin(browser: keyof typeof PINNED, name: string): void {
  const text = readFileSync(import.meta.path, 'utf8')
  const next = text.replace(`${browser}: '${PINNED[browser]}'`, `${browser}: '${name}'`)
  if (next === text) throw new Error(`No ${browser} pin in ${import.meta.path}`)
  writeFileSync(import.meta.path, next)
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

// A browser the process launched. While it's open, the harness sums the memory footprint of its processes every 100 ms:
// the one it started, their descendants and, for webkit-host, the web content process launchd starts for it, which the
// host names. A page that allocates without end grows a content process by 1-2 GB a second in Chrome and Firefox and
// by 3 GB or more in WebKit, and neither Firefox nor WebKit stops it (Chrome's renderer stops at V8's heap limit, near
// 4.4 GB), until the machine stalls. So past its bound, 4 GB unless the launcher asks for more, the harness kills
// those processes and fails the job, as it does when the browser quits before its job ends. A check takes up to 2.3 GB.
// RSS would count the pages the processes share once in each and leave out those macOS compresses; the footprint,
// which Activity Monitor shows, does neither. Chrome and Firefox start through LaunchServices, outside the job's
// process group, so the process kills every browser it still has open when it exits, on an interrupt, SIGTERM or
// hang-up too.
export type Session = { close: () => Promise<void> }

// What the harness keeps of a browser it launched: `roots` finds its own processes in a `ps` table, or says why they're
// gone; `stop` closes it; `cleanup` removes what it leaves once killed; `moved` asks for the processes to be found again.
type Launched = { pid?: number; roots: (rows: readonly Row[]) => Row[] | string; stop: () => Promise<void>; cleanup: () => void; moved?: boolean }
type Row = { pid: number; ppid: number; command: string }

function processes(): Row[] {
  const out: Row[] = []
  const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 10_000 }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+)\s+(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null) out.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! })
  }
  return out
}

// A process's physical footprint in KB (proc_pid_rusage's RUSAGE_INFO_V2: after the 16-byte UUID, the eighth counter),
// without starting a process; 0 for one that's gone. libproc opens with the first browser.
const openLibproc = () => dlopen('/usr/lib/libSystem.B.dylib', { proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 } }).symbols
let libproc: ReturnType<typeof openLibproc> | null = null
const usage = new BigUint64Array(32)
function footprintKb(pid: number): number {
  libproc ??= openLibproc()
  return libproc.proc_pid_rusage(pid, 2, usage) === 0 ? Number(usage[9]! / 1024n) : 0
}

// The roots and every process started from them, in one table. Never pid 0 or launchd, whose descendants are all.
function descendants(rows: readonly Row[], roots: readonly Row[]): Row[] {
  const out = roots.filter(row => row.pid > 1)
  for (let i = 0; i < out.length; i++) for (let k = 0; k < rows.length; k++) if (rows[k]!.ppid === out[i]!.pid) out.push(rows[k]!)
  return out
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch (error) {
    // Gone already.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// The browsers the process has open, which it kills when it exits, as a signal makes it do. The handlers come with the
// first browser, so a process that launches none keeps the default ones.
const open = new Set<Launched>()
let handling = false
function own<T extends Launched>(launched: T): T {
  open.add(launched)
  if (!handling) {
    handling = true
    process.on('exit', () => {
      for (const each of open) {
        try {
          kill(each)
        } catch {
          // The others still go.
        }
      }
    })
    for (const [name, number] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]] as const) process.on(name, () => process.exit(128 + number))
  }
  return launched
}

async function release(launched: Launched): Promise<void> {
  await launched.stop()
  open.delete(launched)
}

function kill(launched: Launched): void {
  const rows = processes()
  const roots = launched.roots(rows)
  const tree = typeof roots === 'string' ? [] : descendants(rows, roots)
  for (let i = 0; i < tree.length; i++) signal(tree[i]!.pid, 'SIGKILL')
  launched.cleanup()
}

// The processes are found again from `ps` each second, and whenever the browser says they moved.
function watch(browser: BrowserKind, launched: Launched, fail: (error: Error) => void, boundMb: number): Session {
  let tree: Row[] = []
  let ticks = 0
  const timer = setInterval(() => {
    if (ticks++ % 10 === 0 || launched.moved === true) {
      launched.moved = false
      const rows = processes()
      const roots = launched.roots(rows)
      if (typeof roots === 'string') {
        clearInterval(timer)
        fail(new Error(`${browser} ${roots} before its job ended`))
        return
      }
      tree = descendants(rows, roots)
    }
    let kb = 0
    for (let i = 0; i < tree.length; i++) kb += footprintKb(tree[i]!.pid)
    if (kb <= boundMb * 1024) return
    clearInterval(timer)
    kill(launched)
    fail(new Error(`${browser}: its ${tree.length} processes held ${Math.round(kb / 1024)} MB, past the harness's ${boundMb} MB bound, so the job killed them`))
  }, 100)
  return {
    close() {
      clearInterval(timer)
      return release(launched)
    },
  }
}

// Stops the one process this job launched, found by its own profile folder, and the processes it started, which its
// end hands to launchd, then removes the profile. A process is itself while it has the pid and command it had.
async function stop(main: Row, profile: string): Promise<void> {
  const same = (rows: readonly Row[], p: Row): boolean => rows.some(row => row.pid === p.pid && row.command === p.command)
  const rows = processes()
  const tree = same(rows, main) ? descendants(rows, [main]) : []
  if (tree.length > 0) signal(main.pid, 'SIGTERM')
  for (let i = 0; i < 40 && tree.length > 0 && alive(main.pid); i++) await Bun.sleep(100)
  const now = processes()
  for (let i = 0; i < tree.length; i++) if (same(now, tree[i]!)) signal(tree[i]!.pid, 'SIGKILL')
  await Bun.sleep(1000)
  rmSync(profile, { recursive: true, force: true })
}

// Chrome and Firefox start through LaunchServices without activation: macOS 27 won't let a shell-spawned Firefox read
// its data folders. One attempt only, since a failed launch can show the user a dialog.
async function openApp(app: string, executable: string, marker: string, profile: string, args: string[], foreground: boolean): Promise<Launched> {
  execFileSync('open', ['-n', ...(foreground ? [] : ['-g']), '-a', app, '--args', ...args], { stdio: 'ignore', timeout: 60_000 })
  for (let i = 0; i < 100; i++) {
    const found = processes().find(entry => entry.command.startsWith(`${executable} `) && entry.command.includes(marker))
    if (found !== undefined) {
      return own({
        pid: found.pid,
        roots: rows => {
          const main = rows.find(row => row.pid === found.pid && row.command === found.command)
          return main === undefined ? 'quit' : [main]
        },
        stop: () => stop(found, profile),
        cleanup: () => rmSync(profile, { recursive: true, force: true }),
      })
    }
    await Bun.sleep(100)
  }
  throw new Error(`Could not find the ${app} process just launched`)
}

// Chrome activates itself when it shows a window the usual way, so it starts with none, and the job's one window is
// opened in the background through the DevTools protocol (Target.createTarget { newWindow, background }).
async function launchChrome(url: string, profile: string, foreground: boolean): Promise<Launched> {
  const app = appPath('chrome')
  mkdirSync(join(profile, 'Default'), { recursive: true })
  writeFileSync(join(profile, 'Default/Preferences'), JSON.stringify({ intl: { accept_languages: 'en-US,en', selected_languages: 'en-US,en' } }))
  const launched = await openApp(app, `${app}/Contents/MacOS/Google Chrome`, `--user-data-dir=${profile}`, profile, [
    `--user-data-dir=${profile}`, '--disable-updater-scheduler', '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-extensions', '--disable-component-update', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-size=1200,900',
    '--no-startup-window', '--remote-debugging-port=0', '-AppleLanguages', '(en-US)',
  ], foreground)
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
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true, background: !foreground } }))
      socket.onmessage = event => {
        const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string } }
        if (reply.id !== 1) return
        clearTimeout(timer)
        if (reply.error === undefined) done()
        else fail(new Error(`Target.createTarget: ${reply.error.message}`))
      }
    }).finally(() => socket.close())
  } catch (error) {
    await release(launched)
    throw error
  }
  return launched
}

function launchFirefox(url: string, profile: string, foreground: boolean): Promise<Launched> {
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
  return openApp(app, `${app}/Contents/MacOS/firefox`, ` --profile ${profile} `, profile, ['--new-instance', '--profile', profile, url], foreground)
}

// The host names its web content process on its stdout whenever a navigation commits in another one. build.sh keeps
// the hash of the source it built from, so a host built before this protocol, or from other source, isn't run.
async function launchWebKitHost(url: string): Promise<Launched> {
  const source = new Bun.CryptoHasher('sha256').update(readFileSync(join(ROOT, 'harness/webkit-host/main.swift'))).digest('hex')
  const built = await Bun.file(`${WEBKIT_HOST}.source-sha256`).text().catch(() => '')
  if (!await Bun.file(WEBKIT_HOST).exists() || built.trim() !== source) throw new Error(`${WEBKIT_HOST} is missing or wasn't built from harness/webkit-host/main.swift as it is; build it with harness/webkit-host/build.sh`)
  const host = Bun.spawn([WEBKIT_HOST, `--url=${url}`, '--exit-title=harness done'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  let webContent = 0
  const launched = own<Launched>({
    // Exit status 0 is the job's end (--exit-title).
    roots: rows => host.exitCode === 0 ? [] : host.exitCode !== null || host.signalCode !== null ? `exited with ${host.exitCode ?? host.signalCode}`
      : rows.filter(row => row.pid === host.pid || (row.pid === webContent && row.command.endsWith('/com.apple.WebKit.WebContent'))),
    async stop() {
      host.kill('SIGTERM')
      if (await Promise.race([host.exited.then(() => false), Bun.sleep(4000).then(() => true)])) host.kill('SIGKILL')
      await host.exited
    },
    cleanup() {},
  })
  void (async () => {
    let text = ''
    for await (const chunk of host.stdout) {
      const lines = (text + Buffer.from(chunk).toString()).split('\n')
      text = lines.pop()!
      for (let i = 0; i < lines.length; i++) {
        const pid = /^web content process (\d+)$/.exec(lines[i]!)?.[1]
        if (pid === undefined) continue
        webContent = Number(pid)
        launched.moved = true
      }
    }
  })()
  return launched
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
async function launchSafari(url: string, jobId: string, owns: (tabUrl: string) => boolean, foreground: boolean): Promise<Launched> {
  for (let waited = 0; !foreground && frontmostApp() === 'Safari'; waited += 2000) {
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
  if (!/^\d+$/.test(id)) throw new Error('Could not find the Safari window just made')
  if (foreground) appleScript(['tell application "Safari"', 'activate', `set index of (first window whose id is ${id}) to 1`, 'end tell'])
  else if (front !== null && frontmostApp() !== front) appleScript([`tell application ${JSON.stringify(front)} to activate`])
  const close = (): void => {
    try {
      const tabUrl = appleScript(['tell application "Safari"', `return URL of tab 1 of (first window whose id is ${id})`, 'end tell'])
      if (owns(tabUrl)) appleScript(['tell application "Safari"', `close (first window whose id is ${id})`, 'end tell'])
    } catch {
      // The window is already gone.
    }
  }
  // The user's Safari runs the window, so none of its processes is the job's to bound or kill.
  return own({ roots: () => [], stop: () => Promise.resolve(close()), cleanup: close })
}

// `fail` hears why the browser went before its job ended (past `boundMb`, or a quit). `foreground` (the bench's timed
// runs) brings Chrome, Firefox or Safari to the front; webkit-host stays below.
export async function launch(browser: BrowserKind, url: string, jobId: string, owns: (tabUrl: string) => boolean, fail: (error: Error) => void, foreground = false, boundMb = 4096): Promise<Session> {
  const profile = join(PROFILES, `${browser}-${jobId}`)
  switch (browser) {
    case 'chrome':
    case 'firefox': {
      const launched = await (browser === 'chrome' ? launchChrome(url, profile, foreground) : launchFirefox(url, profile, foreground))
      if (foreground) appleScript(['tell application "System Events"', `set frontmost of (first application process whose unix id is ${launched.pid}) to true`, 'end tell'])
      return watch(browser, launched, fail, boundMb)
    }
    case 'webkit-host': return watch(browser, await launchWebKitHost(url), fail, boundMb)
    case 'safari': return watch(browser, await launchSafari(url, jobId, owns, foreground), fail, boundMb)
  }
}
