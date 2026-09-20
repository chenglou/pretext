// tools/measuretext-cost-probe.ts's page in a Chromium that isn't a pinned browser: a Content Shell built from source,
// which probes/runner.ts can't drive (it looks for Chrome's executable and opens its window over the DevTools
// protocol). It serves one standalone page, cross-origin isolated for the fine timer, starts the app bundle in the
// background through LaunchServices with a profile of its own, waits for the page to post its results, writes
// <out>/shell-<part>.json and ends the process it started, by its process id. With --sample=N the page spins one
// workload after its samples and the driver runs macOS `sample` on the renderer for N seconds meanwhile
// (<out>/shell-<part>.sample.txt).
//
//   bun rebuild/tools/measuretext-cost-shell.ts --app=<Content Shell.app> --out=<dir> [--part=micro|replay]
//     [--sample=N] [--spin-class=<a class id of M1; R1's stream when absent>] [--spin-variant=0|1] [--args=<switches>]
//
// A timed run takes the exclusive browser lock like any timed loop, so nothing else's browser runs beside it.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { costParams, costScripts } from './measuretext-cost-probe.ts'

const options = new Map<string, string>()
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/.exec(arg)
  if (match === null) throw new Error(`unknown argument ${arg}`)
  options.set(match[1]!, match[2]!)
}
const app = options.get('app')
const out = options.get('out')
if (app === undefined || out === undefined) throw new Error('--app=<bundle> and --out=<dir> are required')
const part = options.get('part') ?? 'micro'
if (part !== 'micro' && part !== 'replay') throw new Error('--part is micro or replay')
const sampleSeconds = Number(options.get('sample') ?? 0)
const spinClass = options.get('spin-class') ?? ''
const spinVariant = options.get('spin-variant') === '1' ? 1 : 0
const extraArgs = (options.get('args') ?? '').split(' ').filter(a => a !== '')

const params = { ...costParams(), spinMs: sampleSeconds > 0 ? (sampleSeconds + 4) * 1000 : 0, spinClass: part === 'micro' ? spinClass : '', spinVariant } as const
if (sampleSeconds > 0 && part === 'micro' && spinClass === '') throw new Error('--sample with --part=micro needs --spin-class')
const scripts = await costScripts(params)
const source = part === 'micro' ? scripts.micro : scripts.replay
const pageHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>measureText cost</title><body><script>
(async () => {
  try {
    const result = await (async () => {\n${source.replace(/<\/script/gi, '<\\/script')}\n})();
    await fetch('/result', { method: 'POST', body: JSON.stringify(result) });
  } catch (error) {
    await fetch('/result', { method: 'POST', body: JSON.stringify({ error: String(error && error.stack || error) }) });
  }
})();
</script></body></html>`

mkdirSync(out, { recursive: true })
let finish: (value: string) => void = () => {}
const posted = new Promise<string>(done => { finish = done })
let rendererSampled: Promise<void> = Promise.resolve()
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
let browserPid: number | null = null

function processes(): Array<{ pid: number; ppid: number; command: string }> {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const rows: Array<{ pid: number; ppid: number; command: string }> = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! })
  }
  return rows
}

function sampleRenderer(): Promise<void> {
  return new Promise(done => {
    const renderer = processes().find(p => p.ppid === browserPid && p.command.includes('--type=renderer'))
    if (renderer === undefined) { console.error('[shell] no renderer process found to sample'); done(); return }
    const file = join(out!, `shell-${part}.sample.txt`)
    console.log(`[shell] sampling renderer ${renderer.pid} for ${sampleSeconds}s -> ${file}`)
    const child = Bun.spawn(['sample', String(renderer.pid), String(sampleSeconds), '-file', file], { stdout: 'ignore', stderr: 'inherit' })
    void child.exited.then(() => done())
  })
}

let port = 3010
let server: ReturnType<typeof Bun.serve> | null = null
for (; port < 3100; port++) {
  if (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).status === 0) continue
  try {
    server = Bun.serve({
      port, hostname: '127.0.0.1',
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/') return new Response(pageHtml, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
        if (url.pathname === '/spinning') { if (sampleSeconds > 0) rendererSampled = sampleRenderer(); return new Response('ok', { headers }) }
        if (url.pathname === '/result') { finish(await request.text()); return new Response('ok', { headers }) }
        return new Response('not found', { status: 404, headers })
      },
    })
    break
  } catch {
    // Taken between the check and the bind: the next one.
  }
}
if (server === null) throw new Error('no free port from 3010')

const profile = mkdtempSync(join(tmpdir(), 'measuretext-cost-shell-'))
const marker = `--user-data-dir=${profile}`
const bundle = resolve(app)
execFileSync('open', ['-n', '-g', '-a', bundle, '--args', marker, '--disable-gpu', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extraArgs, `http://127.0.0.1:${port}/`], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 30_000 })
for (let i = 0; i < 150 && browserPid === null; i++) {
  const found = processes().find(p => p.command.includes(marker) && !p.command.includes('--type='))
  if (found !== undefined) browserPid = found.pid
  else await Bun.sleep(100)
}
if (browserPid === null) throw new Error('the launched process was not found')
console.log(`[shell] started pid ${browserPid}; page http://127.0.0.1:${port}/ ; part ${part}`)

let exitCode = 0
try {
  const limitMs = 20 * 60 * 1000
  const result = await Promise.race([posted, Bun.sleep(limitMs).then(() => null)])
  await rendererSampled
  if (result === null) { console.error('[shell] no result within the limit'); exitCode = 1 }
  else {
    const value = JSON.parse(result) as { error?: string }
    writeFileSync(join(out, `shell-${part}.json`), JSON.stringify({ app: bundle.split('/').slice(-1)[0], args: extraArgs, params, startedPid: browserPid, result: value }, null, 1))
    if (value.error !== undefined) { console.error(`[shell] the page failed: ${value.error}`); exitCode = 1 }
    else console.log(`[shell] wrote ${join(out, `shell-${part}.json`)}`)
  }
} finally {
  try { process.kill(browserPid, 'SIGTERM') } catch { /* already gone */ }
  await Bun.sleep(1500)
  try { process.kill(browserPid, 0); process.kill(browserPid, 'SIGKILL') } catch { /* gone */ }
  server.stop(true)
  if (profile.includes('measuretext-cost-shell-')) rmSync(profile, { recursive: true, force: true })
}
process.exit(exitCode)
