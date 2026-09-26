// The browser build a run observes, read from the app bundles before launch (research/TEST-ARCHITECTURE.md §4.3), for the
// lab driver and the probe runner. DESIGN.md §1.4 names the engine build per browser.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserBuild, BrowserKind } from './types.ts'

// The apps the lab and the probe runner launch. Chrome and Firefox are private byte-identical copies of the installed
// bundles, made and checked by pin-browser.sh: each browser's updater replaces the bundle it runs from or the path
// registered with it, /Applications, so a copy keeps its build while the installed browser updates itself (Chrome went
// from 153.0.8010.48 to .50 during ceiling round 2). Both drivers pass CHROME_PIN_ARGS, and their Firefox profiles set
// FIREFOX_PIN_PREFS. A new release gets a new copy and a new path here (TESTS.md §12).
const PINNED_APPS = join(homedir(), 'github/browser-engines/apps')
// LAB_CHROME_APP and LAB_FIREFOX_APP name another bundle for one command, to try a new release before moving the pin.
export const LAB_APPS = {
  chrome: process.env['LAB_CHROME_APP'] ?? join(PINNED_APPS, 'Google Chrome 153.0.8010.50.app'),
  firefox: process.env['LAB_FIREFOX_APP'] ?? join(PINNED_APPS, 'Firefox 156.0.app'),
  safari: '/Applications/Safari.app',
} as const
// Chrome's updater keeps one path per app id, and a Chrome started from another path registers that path 19 s after
// startup (chrome_browser_main.cc PreCreateMainMessageLoop, browser_updater_client_util_mac.mm EnsureUpdater and
// browser_updater_client_mac.mm AppMatches at Chromium 152; 153.0.8010.50's framework binary holds the switch). With this
// switch Chrome never schedules that, so the installed Chrome stays the registered one.
export const CHROME_PIN_ARGS: readonly string[] = ['--disable-updater-scheduler']
// Firefox updates the bundle it runs from. A release build ignores app.update.disabledForTesting outside automation and
// takes the appUpdate policy only from the bundle or the system (UpdateServiceStub.sys.mjs updateDisabled, Firefox 156), so
// the lab's profiles turn automatic download and install off; on macOS app.update.auto is an ordinary pref
// (UpdateUtils.sys.mjs PER_INSTALLATION_PREFS_PLATFORMS). A fresh profile's first update check is hours away in any case.
// A launch under another profile isn't covered (macOS reopened the 156.0 copy at login after a crash on 2026-09-25, and
// Firefox updated it to 156.0.1), so pin-browser.sh also puts the DisableAppUpdate policy in the copy's bundle.
export const FIREFOX_PIN_PREFS: ReadonlyArray<[string, boolean]> = [['app.update.auto', false], ['app.update.staging.enabled', false]]
// The system WebKit.framework Safari and webkit-host load.
const WEBKIT_FRAMEWORK = '/System/Library/Frameworks/WebKit.framework'

// The app a run launches, for its run record: the bundle path, whether it is a pinned copy, and the tree hash
// pin-browser.sh wrote beside a copy it checked against the installed bundle. webkit-host has no app bundle.
export type LabApp = { path: string; pinned: boolean; treeSha256: string | null }

export function labApp(kind: BrowserKind): LabApp | null {
  if (kind === 'webkit-host') return null
  const path = LAB_APPS[kind]
  if (!existsSync(path)) throw new Error(`${path} is missing; make the pinned copy with rebuild/lab/pin-browser.sh`)
  const hashFile = `${path}.tree-sha256`
  return { path, pinned: !path.startsWith('/Applications/'), treeSha256: existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : null }
}

export function bundleString(bundle: string, key: string): string {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 15_000 }).trim()
}

function webKitBuild(): string {
  return execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', join(WEBKIT_FRAMEWORK, 'Resources/Info.plist')], { encoding: 'utf8', timeout: 15_000 }).trim()
}

export function readBuild(kind: BrowserKind): BrowserBuild {
  const os = execFileSync('sw_vers', ['-buildVersion'], { encoding: 'utf8', timeout: 15_000 }).trim()
  switch (kind) {
    case 'chrome': {
      // The executable's name tells Google Chrome from Google Chrome for Testing (LAB_CHROME_APP).
      const version = bundleString(labApp('chrome')!.path, 'CFBundleShortVersionString')
      return { app: bundleString(labApp('chrome')!.path, 'CFBundleExecutable'), appVersion: version, engine: version, os }
    }
    case 'firefox': {
      const version = bundleString(labApp('firefox')!.path, 'CFBundleShortVersionString')
      return { app: 'Firefox', appVersion: version, engine: version, os }
    }
    case 'safari': return { app: 'Safari', appVersion: bundleString(LAB_APPS.safari, 'CFBundleShortVersionString'), engine: webKitBuild(), os }
    case 'webkit-host': return { app: 'webkit-host', appVersion: bundleString(LAB_APPS.safari, 'CFBundleShortVersionString'), engine: webKitBuild(), os }
  }
}

// Whether a page's user agent names the build the driver read: Chrome's reduced user agent keeps the major version only,
// Firefox's says `<major>.0` for every build of a major version (140.16.0esr says Firefox/140.0), and webkit-host appends
// the WebKit build it loaded (rebuild/tools/webkit-host/main.swift). A mismatch means the browser changed between reading
// the bundle and launching it.
export function userAgentMatches(kind: BrowserKind, build: BrowserBuild, userAgent: string): boolean {
  switch (kind) {
    case 'chrome': return userAgent.includes(`Chrome/${build.appVersion.split('.')[0]}.`)
    case 'firefox': return new RegExp(`Firefox/${build.appVersion.split('.')[0]}\\.0$`).test(userAgent)
    case 'safari': return userAgent.includes(`Version/${build.appVersion} Safari/`) && !userAgent.includes('webkit-host/')
    case 'webkit-host': return userAgent.includes(`Version/${build.appVersion} Safari/`) && userAgent.endsWith(`webkit-host/${build.engine}`)
  }
}
