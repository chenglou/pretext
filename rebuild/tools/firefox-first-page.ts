// Opens one standalone HTML page as the FIRST page of a Firefox that has just started, and writes down what the page
// reports. For reproductions that only show in a new browser process, such as a canvas font that stays on the fallback
// when it was first measured before Firefox had read the fonts' localized family names (research/CONTEXTS-HEAL.md).
// The probe runner can't do this: it starts Firefox on about:blank and navigates afterwards, inside its own page.
//
// The page is served as it is from 127.0.0.1 and gets `?report=<url>`; it POSTs one JSON body there when it is done.
// Firefox is the lab's pinned copy, headed and in the background through LaunchServices, in a profile of its own that
// is removed afterwards. Only the process this tool started is stopped.
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=firefox -- \
//     bun rebuild/tools/firefox-first-page.ts --page=<file.html> --out=<report.json> [--wait-s=30] [--query=<a=b&c=d>]
//
// `--query`: more query parameters for the page, for example a wait before it starts (the control: the same page in a
// browser that has been up for a while).

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FIREFOX_PIN_PREFS, labApp, readBuild } from '../lab/browser-build.ts'

function arg(name: string, fallback: string | null): string | null {
  const prefix = `--${name}=`
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i]!.startsWith(prefix)) return process.argv[i]!.slice(prefix.length)
  }
  return fallback
}
const pagePath = arg('page', null)
const outPath = arg('out', null)
if (pagePath === null || outPath === null) throw new Error('usage: --page=<file.html> --out=<report.json> [--wait-s=30] [--query=<a=b>]')
const waitS = Number(arg('wait-s', '30'))
const query = arg('query', '')!
const html = readFileSync(pagePath)
const app = labApp('firefox')!

let reported: unknown = null
let reportedAt = 0
let servedAt = 0
let server: ReturnType<typeof Bun.serve> | null = null
for (let port = 3002; port < 3100 && server === null; port++) {
  try {
    server = Bun.serve({
      port,
      hostname: '127.0.0.1',
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/page.html') {
          servedAt = Date.now()
          return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
        }
        if (url.pathname === '/report' && request.method === 'POST') {
          reported = JSON.parse(await request.text())
          reportedAt = Date.now()
          return new Response('ok', { headers: { 'access-control-allow-origin': '*' } })
        }
        return new Response('not found', { status: 404 })
      },
    })
  } catch {
    server = null
  }
}
if (server === null) throw new Error('no free port from 3002')
const origin = `http://127.0.0.1:${server.port}`
const pageUrl = `${origin}/page.html?report=${encodeURIComponent(`${origin}/report`)}${query === '' ? '' : `&${query}`}`

const id = `${Date.now().toString(36)}-${process.pid}`
const profile = resolve(import.meta.dir, '../../.artifacts/profiles', `first-page-firefox-${id}`)
mkdirSync(profile, { recursive: true })
const prefs: Array<[string, boolean | string | number]> = [
  ['browser.shell.checkDefaultBrowser', false], ['browser.aboutwelcome.enabled', false],
  ['browser.startup.homepage_override.mstone', 'ignore'], ['startup.homepage_welcome_url', ''],
  ['startup.homepage_welcome_url.additional', ''], ['datareporting.policy.firstRunURL', ''],
  ['datareporting.policy.dataSubmissionPolicyBypassNotification', true], ['toolkit.telemetry.reportingpolicy.firstRun', false],
  ['browser.sessionstore.resume_from_crash', false], ['dom.timeout.enable_budget_timer_throttling', false],
  ...FIREFOX_PIN_PREFS,
]
writeFileSync(join(profile, 'user.js'), prefs.map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`).join(''))

function open(url: string): void {
  execFileSync('open', ['-n', '-g', '-a', app.path, '--args', '--new-instance', '--profile', profile, url], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 15_000 })
}
function findPid(): number | null {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[i]!)
    if (match !== null && match[2]!.startsWith(`${app.path}/Contents/MacOS/firefox `) && match[2]!.includes(` --profile ${profile} `)) return Number(match[1])
  }
  return null
}
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

const launchedAt = Date.now()
open(pageUrl)
let pid: number | null = null
for (let i = 0; i < 100 && pid === null; i++) {
  pid = findPid()
  if (pid === null) await Bun.sleep(100)
}
let error: string | null = null
if (pid === null) error = 'could not find the launched Firefox process'
else {
  console.log(`[first-page] firefox pid ${pid}, profile ${profile}`)
  const deadline = Date.now() + waitS * 1000
  while (reported === null && Date.now() < deadline && isAlive(pid)) await Bun.sleep(200)
  if (reported === null) error = servedAt === 0 ? 'the page was never asked for' : 'the page did not report in time'
  try { process.kill(pid, 'SIGTERM') } catch { /* gone */ }
  const stopBy = Date.now() + 8_000
  while (isAlive(pid) && Date.now() < stopBy) await Bun.sleep(100)
  if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
  await Bun.sleep(1_000)
}
rmSync(profile, { recursive: true, force: true })
server.stop(true)
writeFileSync(outPath, `${JSON.stringify({ build: readBuild('firefox'), query, msLaunchToServed: servedAt === 0 ? null : servedAt - launchedAt, msLaunchToReport: reportedAt === 0 ? null : reportedAt - launchedAt, error, report: reported }, null, 2)}\n`)
console.log(`[first-page] ${error ?? 'ok'}; ${outPath}`)
process.exit(error === null ? 0 : 1)
