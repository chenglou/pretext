// The browser build a run observes, read from the app bundles before launch (research/TEST-ARCHITECTURE.md §4.3), for the
// lab driver and the probe runner. DESIGN.md §1.4 names the engine build per browser.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { BrowserBuild, BrowserKind } from './types.ts'

const CHROME_APP = '/Applications/Google Chrome.app'
const FIREFOX_APP = '/Applications/Firefox.app'
const SAFARI_APP = '/Applications/Safari.app'
// The system WebKit.framework Safari and webkit-host load.
const WEBKIT_FRAMEWORK = '/System/Library/Frameworks/WebKit.framework'

function bundleString(bundle: string, key: string): string {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8', timeout: 15_000 }).trim()
}

function webKitBuild(): string {
  return execFileSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', join(WEBKIT_FRAMEWORK, 'Resources/Info.plist')], { encoding: 'utf8', timeout: 15_000 }).trim()
}

export function readBuild(kind: BrowserKind): BrowserBuild {
  const os = execFileSync('sw_vers', ['-buildVersion'], { encoding: 'utf8', timeout: 15_000 }).trim()
  switch (kind) {
    case 'chrome': {
      const version = bundleString(CHROME_APP, 'CFBundleShortVersionString')
      return { app: 'Google Chrome', appVersion: version, engine: version, os }
    }
    case 'firefox': {
      const version = bundleString(FIREFOX_APP, 'CFBundleShortVersionString')
      return { app: 'Firefox', appVersion: version, engine: version, os }
    }
    case 'safari': return { app: 'Safari', appVersion: bundleString(SAFARI_APP, 'CFBundleShortVersionString'), engine: webKitBuild(), os }
    case 'webkit-host': return { app: 'webkit-host', appVersion: bundleString(SAFARI_APP, 'CFBundleShortVersionString'), engine: webKitBuild(), os }
  }
}

// Whether a page's user agent names the build the driver read: Chrome's reduced user agent keeps the major version only,
// and webkit-host appends the WebKit build it loaded (rebuild/tools/webkit-host/main.swift). A mismatch means the browser
// changed between reading the bundle and launching it.
export function userAgentMatches(kind: BrowserKind, build: BrowserBuild, userAgent: string): boolean {
  switch (kind) {
    case 'chrome': return userAgent.includes(`Chrome/${build.appVersion.split('.')[0]}.`)
    case 'firefox': return userAgent.includes(`Firefox/${build.appVersion}`)
    case 'safari': return userAgent.includes(`Version/${build.appVersion} Safari/`) && !userAgent.includes('webkit-host/')
    case 'webkit-host': return userAgent.includes(`Version/${build.appVersion} Safari/`) && userAgent.endsWith(`webkit-host/${build.engine}`)
  }
}
