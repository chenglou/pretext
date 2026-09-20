// A second look at tools/js-profile.ts's timings: every measurement in a page of its own, which holds one checkout alone,
// and the Canvas share of a pass by two methods that tool doesn't use.
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- bun rebuild/tools/js-profile-fresh.ts \
//     --trees=<label>=<checkout>[,...] --out=<dir> [--rounds=12] [--relayout-rounds=6] [--split=<label>[,<label>]] \
//     [--sets=mix,latin] [--messages=10000]
//
// A checkout is a folder that holds rebuild/src; the page side is js-profile-entry.ts, bundled once per checkout as
// js-profile.ts bundles it. One pinned Chrome runs the whole schedule, and every page is a new window that is closed
// when it has posted its result, so no page holds another checkout's code, objects or compiled functions.
//
// A scratch page: the first 1,000 messages of every set once (compiled code), then one timed pass per set (every message
// prepared and filled at 320 px, one list of contexts a pass). `--rounds` rounds; a round opens a page per checkout, and
// the next round starts one checkout later. A relayout page: the same start, then per set the messages prepared, filled
// and kept (timed: a pass that keeps what it prepares) and filled at 260, 380 and 440 px (timed).
//
// A split page (--split names its checkouts), per set, after the same start:
//   wall       a pass on the real Canvas;
//   stopwatch  a pass with a timer read before and after every measureText call, summed: the Canvas time where it is
//              spent, between the port's own work. The timer costs time too, so the same two reads around a call that
//              answers from an array (free answers) are summed as well: that is what the two reads add;
//   free       a pass with free answers: the port's own JavaScript;
//   alone      the pass's questions asked again without the port: the same strings (the objects the port built) in the
//              same order on new contexts with the same settings, made in the order the pass made them.
// wall is about free plus alone when the two kinds of work don't slow each other, and the stopwatch says what Canvas
// costs in its place.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { join, resolve } from 'node:path'
import { buildChat, CHAT_RESIZE_WIDTHS, CHAT_WIDTH } from '../bench/cases.ts'
import { CHROME_PIN_ARGS, labApp, readBuild } from '../lab/browser-build.ts'

const REPO = resolve(import.meta.dir, '../..')
const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2]!)
}
const trees = (args.get('trees') ?? '').split(',').filter(entry => entry !== '').map(entry => ({ label: entry.slice(0, entry.indexOf('=')), path: resolve(entry.slice(entry.indexOf('=') + 1)) }))
if (trees.length === 0) throw new Error('--trees=<label>=<checkout>[,...]')
if (!args.has('out')) throw new Error('--out=<dir>')
const outDir = resolve(args.get('out')!)
const sets = (args.get('sets') ?? 'mix,latin').split(',') as Array<'mix' | 'latin'>
const rounds = Number(args.get('rounds') ?? 12)
const relayoutRounds = Number(args.get('relayout-rounds') ?? 6)
const splitLabels = (args.get('split') ?? '').split(',').filter(label => label !== '')
const messages = Number(args.get('messages') ?? 10000)
mkdirSync(outDir, { recursive: true })

const bundles: string[] = []
for (let t = 0; t < trees.length; t++) {
  const src = join(trees[t]!.path, 'rebuild/src')
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'js-profile-entry.ts')], target: 'browser', format: 'iife', minify: false,
    plugins: [{ name: 'studied-tree', setup(build) { build.onResolve({ filter: /^\.\.\/src\// }, found => found.importer.endsWith('js-profile-entry.ts') ? { path: join(src, found.path.slice(7)) } : undefined) } }],
  })
  if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.map(String).join('\n')}`)
  bundles.push(await built.outputs[0]!.text())
}

const PAGE = String.raw`
const query = new URLSearchParams(location.search)
const kind = query.get('kind')
const config = await (await fetch('/api/config')).json()
const SETS = await (await fetch('/api/sets')).json()
const sets = Object.keys(SETS)
const lib = globalThis.jsProfileLib
const env = lib.environment()
const paragraphs = {}
for (const set of sets) paragraphs[set] = SETS[set].map(message => lib.paragraphOf(message.parts))
const channel = new MessageChannel()
const pause = () => new Promise(resolve => { channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null) })
const proto = OffscreenCanvasRenderingContext2D.prototype
const real = proto.measureText
const timed = run => { const start = performance.now(); const result = run(); return { ms: performance.now() - start, ...result } }

for (const set of sets) {
  const first = paragraphs[set].slice(0, 1000)
  lib.scratch(first, env, config.width)
  lib.relayout(lib.prepareAll(first, env, config.width), config.widths)
}
const cells = []
for (const set of sets) {
  const list = paragraphs[set]
  await pause()
  if (kind === 'scratch') cells.push({ set, scratch: timed(() => lib.scratch(list, env, config.width)) })
  if (kind === 'relayout') {
    let kept = null
    const keep = timed(() => { kept = lib.prepareAll(list, env, config.width); return {} })
    await pause()
    cells.push({ set, keepMs: keep.ms, relayout: timed(() => lib.relayout(kept, config.widths)) })
  }
  if (kind === 'split') {
    const wall = timed(() => lib.scratch(list, env, config.width))
    await pause()
    // The pass's questions: every string as the port built it, the context it was asked on, and every context's settings.
    const strings = []
    const asked = []
    const answers = []
    const settings = []
    const ids = new Map()
    proto.measureText = function (text) {
      let id = ids.get(this)
      if (id === undefined) {
        id = ids.size
        ids.set(this, id)
        settings.push({ lang: this.lang, font: this.font, letterSpacing: this.letterSpacing, wordSpacing: this.wordSpacing, fontKerning: this.fontKerning, textRendering: this.textRendering, direction: this.direction })
      }
      strings.push(text)
      asked.push(id)
      const metrics = real.call(this, text)
      answers.push(metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight)
      return metrics
    }
    lib.scratch(list, env, config.width)
    proto.measureText = real
    const recorded = Float64Array.from(answers)
    await pause()
    let sum = 0
    proto.measureText = function (text) {
      const start = performance.now()
      const metrics = real.call(this, text)
      sum += performance.now() - start
      return metrics
    }
    const stopwatch = timed(() => lib.scratch(list, env, config.width))
    const stopwatchSumMs = sum
    proto.measureText = real
    await pause()
    const answer = { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
    let n = 0
    const stub = function () {
      answer.width = recorded[n]
      answer.actualBoundingBoxLeft = recorded[n + 1]
      answer.actualBoundingBoxRight = recorded[n + 2]
      n += 3
      return answer
    }
    proto.measureText = stub
    const free = timed(() => lib.scratch(list, env, config.width))
    await pause()
    n = 0
    sum = 0
    proto.measureText = function (text) {
      const start = performance.now()
      const metrics = stub.call(this, text)
      sum += performance.now() - start
      return metrics
    }
    const freeStopwatch = timed(() => lib.scratch(list, env, config.width))
    const timerSumMs = sum
    proto.measureText = real
    await pause()
    const alone = []
    for (let pass = 0; pass < 3; pass++) {
      const start = performance.now()
      const contexts = []
      let total = 0
      for (let i = 0; i < strings.length; i++) {
        const id = asked[i]
        if (id === contexts.length) {
          const s = settings[id]
          const ctx = new OffscreenCanvas(1, 1).getContext('2d')
          ctx.lang = s.lang
          ctx.font = s.font
          ctx.letterSpacing = s.letterSpacing
          ctx.wordSpacing = s.wordSpacing
          ctx.fontKerning = s.fontKerning
          ctx.textRendering = s.textRendering
          ctx.direction = s.direction
          contexts.push(ctx)
        }
        total += contexts[id].measureText(strings[i]).width
      }
      alone.push({ ms: performance.now() - start, total })
      await pause()
    }
    let answered = 0
    for (let i = 0; i < recorded.length; i += 3) answered += recorded[i]
    // After every timing, since a string used as a key is stored again: how many of the questions are a context's first
    // of that string. Chrome answers a repeat from what the canvas has shaped.
    const seen = settings.map(() => new Set())
    let distinct = 0
    for (let i = 0; i < strings.length; i++) {
      if (seen[asked[i]].has(strings[i])) continue
      seen[asked[i]].add(strings[i])
      distinct++
    }
    cells.push({ set, calls: strings.length, distinct, contexts: settings.length, answered, wall, stopwatch, stopwatchSumMs, free, freeStopwatch, timerSumMs, alone })
  }
}
await fetch('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: window.crossOriginIsolated, cells }) })
document.title = 'done'
`

type Timed = { ms: number; lines: number; hash: number }
type Cell = {
  set: string; scratch?: Timed; keepMs?: number; relayout?: Timed
  calls?: number; distinct?: number; contexts?: number; answered?: number; wall?: Timed; stopwatch?: Timed; stopwatchSumMs?: number; free?: Timed; freeStopwatch?: Timed; timerSumMs?: number
  alone?: Array<{ ms: number; total: number }>
}
type PageResult = { userAgent: string; devicePixelRatio: number; crossOriginIsolated: boolean; cells: Cell[] }

// run.ts asciiJsonResponse: every character above U+007E escaped, so a string is 8-bit in the page where its characters allow.
const ABOVE_ASCII = new RegExp(`[${String.fromCharCode(0x7f)}-${String.fromCharCode(0xffff)}]`, 'g')
const setsBody = JSON.stringify(Object.fromEntries(sets.map(set => [set, buildChat(set, messages)]))).replace(ABOVE_ASCII, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' }
const FATAL = 'const fatal = error => fetch("/api/fatal", { method: "POST", body: String(error && error.stack || error) });\nwindow.addEventListener("error", event => fatal(event.error ?? event.message));\nwindow.addEventListener("unhandledrejection", event => fatal(event.reason));\n'

let settle: { resolve: (result: PageResult) => void; reject: (error: Error) => void } | null = null

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  switch (url.pathname) {
    case '/': return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>js profile, fresh pages</title></head><body><p>Pretext JS profile, fresh pages.</p><script src="/lib.js?tree=${url.searchParams.get('tree')}"></script><script type="module" src="/page.js"></script></body></html>`, { headers: { ...ISOLATION, 'content-type': 'text/html; charset=utf-8' } })
    case '/lib.js': return new Response(bundles[Number(url.searchParams.get('tree'))]!, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
    case '/page.js': return new Response(FATAL + PAGE, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
    case '/api/config': return Response.json({ width: CHAT_WIDTH, widths: CHAT_RESIZE_WIDTHS })
    case '/api/sets': return new Response(setsBody, { headers: { 'content-type': 'application/json; charset=utf-8' } })
    case '/api/result': settle!.resolve(await request.json() as PageResult); return new Response('ok')
    case '/api/fatal': settle!.reject(new Error(`Page error: ${await request.text()}`)); return new Response('ok')
    default: return new Response(null, { status: 404 })
  }
}

let server: ReturnType<typeof Bun.serve> | null = null
for (let port = 3002; port < 3100 && server === null; port++) {
  if (Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0) continue
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port, fetch: handle, maxRequestBodySize: 256 * 1024 * 1024, idleTimeout: 0 })
  } catch {
    // Taken between the check and the bind.
  }
}
if (server === null) throw new Error('No free port in 3002-3099')

// Pinned Chrome in the background, as js-profile.ts launches it.
const runId = randomUUID()
const profile = join(REPO, '.artifacts/profiles', `js-profile-fresh-${runId}`)
mkdirSync(profile, { recursive: true })
const app = labApp('chrome')!.path
execFileSync('open', ['-n', '-g', '-a', app, '--args',
  `--user-data-dir=${profile}`, ...CHROME_PIN_ARGS, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
  '--disable-component-update', '--enable-precise-memory-info', '--window-size=1200,900', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-startup-window', '--remote-debugging-port=0',
], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 60_000 })
let pid: number | null = null
let endpoint: string | null = null
for (let i = 0; i < 300 && (pid === null || endpoint === null); i++) {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  for (let l = 0; l < lines.length && pid === null; l++) {
    const match = /^\s*(\d+) (.*)$/.exec(lines[l]!)
    if (match !== null && match[2]!.startsWith(`${app}/Contents/MacOS/Google Chrome `) && match[2]!.includes(`--user-data-dir=${profile}`)) pid = Number(match[1])
  }
  try {
    const match = /^(\d+)\n(\/devtools\/browser\/[0-9a-f-]+)\n?$/.exec(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8'))
    if (match !== null) endpoint = `ws://127.0.0.1:${match[1]}${match[2]}`
  } catch {
    // Not written yet.
  }
  if (pid === null || endpoint === null) await Bun.sleep(100)
}
if (pid === null || endpoint === null) throw new Error('Chrome did not start with a DevTools port')
console.log(`[js-profile-fresh] Chrome pid ${pid}, ${readBuild('chrome').appVersion}; ${trees.map(tree => tree.label).join(', ')}; load ${loadavg()[0]!.toFixed(1)}`)

const socket = new WebSocket(endpoint)
await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve()
  socket.onerror = () => reject(new Error('DevTools socket error'))
})
let nextId = 1
function command(method: string, params: object, sessionId: string | null): Promise<Record<string, unknown>> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent): void => {
      const reply = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: Record<string, unknown> }
      if (reply.id !== id) return
      socket.removeEventListener('message', onMessage)
      if (reply.error === undefined) resolve(reply.result ?? {})
      else reject(new Error(`${method}: ${reply.error.message}`))
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify(sessionId === null ? { id, method, params } : { id, method, params, sessionId }))
  })
}

// One page: a new window, the result it posts, the window closed.
async function page(tree: number, kind: 'scratch' | 'relayout' | 'split'): Promise<PageResult> {
  const posted = new Promise<PageResult>((resolve, reject) => { settle = { resolve, reject } })
  const target = await command('Target.createTarget', { url: 'about:blank', newWindow: true, background: true }, null)
  const attached = await command('Target.attachToTarget', { targetId: target['targetId'], flatten: true }, null)
  await command('Page.navigate', { url: `http://127.0.0.1:${server!.port}/?tree=${tree}&kind=${kind}` }, String(attached['sessionId']))
  const stall = setTimeout(() => settle!.reject(new Error(`No result from a ${kind} page in 5 minutes`)), 5 * 60_000)
  const result = await posted
  clearTimeout(stall)
  await command('Target.closeTarget', { targetId: target['targetId'] }, null)
  return result
}

type Row = Array<{ label: string; load: number; page: PageResult }>
const startedAt = new Date()
const loadStart = loadavg()[0]!
const scratchRows: Row[] = []
const relayoutRows: Row[] = []
const splits: Row = []
let failure: string | null = null
try {
  for (let round = 0; round < rounds; round++) {
    const row: Row = []
    for (let k = 0; k < trees.length; k++) {
      const t = (k + round) % trees.length
      row.push({ label: trees[t]!.label, load: loadavg()[0]!, page: await page(t, 'scratch') })
    }
    scratchRows.push(row)
    console.log(`[js-profile-fresh] scratch round ${round + 1}/${rounds}: ${row.map(cell => `${cell.label} ${cell.page.cells.map(c => c.scratch!.ms.toFixed(0)).join('|')}`).join(', ')}`)
  }
  for (let round = 0; round < relayoutRounds; round++) {
    const row: Row = []
    for (let k = 0; k < trees.length; k++) {
      const t = (k + round) % trees.length
      row.push({ label: trees[t]!.label, load: loadavg()[0]!, page: await page(t, 'relayout') })
    }
    relayoutRows.push(row)
    console.log(`[js-profile-fresh] relayout round ${round + 1}/${relayoutRounds}: ${row.map(cell => `${cell.label} ${cell.page.cells.map(c => `${c.keepMs!.toFixed(0)}+${c.relayout!.ms.toFixed(0)}`).join('|')}`).join(', ')}`)
  }
  for (let s = 0; s < splitLabels.length; s++) {
    const t = trees.findIndex(tree => tree.label === splitLabels[s])
    splits.push({ label: trees[t]!.label, load: loadavg()[0]!, page: await page(t, 'split') })
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
}
socket.close()
process.kill(pid, 'SIGTERM')
for (let i = 0; i < 80; i++) {
  try { process.kill(pid, 0) } catch { break }
  if (i === 40) process.kill(pid, 'SIGKILL')
  await Bun.sleep(100)
}
await Bun.sleep(1_000)
execFileSync('trash', [profile], { stdio: 'ignore', timeout: 60_000 })
await server.stop(true)

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

// Per set: every checkout's median, and its differences round by round from the first checkout and from the one before it.
function summarize(title: string, rows: Row[], read: (cell: Cell) => Timed | { ms: number }): string[] {
  const lines: string[] = []
  if (rows.length === 0) return lines
  for (let s = 0; s < sets.length; s++) {
    const of = (label: string): number[] => rows.map(row => read(row.find(cell => cell.label === label)!.page.cells[s]!).ms)
    const against = (ms: number[], other: number[], name: string): string => {
      const diffs = ms.map((value, r) => value - other[r]!).sort((a, b) => a - b)
      return `; minus ${name}: median ${median(diffs).toFixed(1)} ms, quartiles ${diffs[Math.floor(diffs.length / 4)]!.toFixed(1)} to ${diffs[Math.floor(diffs.length * 3 / 4)]!.toFixed(1)}, range ${diffs[0]!.toFixed(1)} to ${diffs[diffs.length - 1]!.toFixed(1)}, ${diffs.filter(diff => diff < 0).length} of ${diffs.length} rounds under 0`
    }
    for (let t = 0; t < trees.length; t++) {
      const ms = of(trees[t]!.label)
      let line = `${title} ${sets[s]} ${trees[t]!.label}: median ${median(ms).toFixed(1)} ms (${Math.min(...ms).toFixed(1)} to ${Math.max(...ms).toFixed(1)}; ${rows.length} rounds)`
      if (t > 0) line += against(ms, of(trees[0]!.label), trees[0]!.label)
      if (t > 1) line += against(ms, of(trees[t - 1]!.label), trees[t - 1]!.label)
      lines.push(line)
    }
  }
  return lines
}

const summary: string[] = [`load ${loadStart.toFixed(1)} to ${loadavg()[0]!.toFixed(1)}; ${execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).split('\n').slice(0, 2).join(' ')}`]
summary.push(...summarize('scratch', scratchRows, cell => cell.scratch!), ...summarize('prepared and kept', relayoutRows, cell => ({ ms: cell.keepMs! })), ...summarize('relayout', relayoutRows, cell => cell.relayout!))
const hashes = new Set<string>()
for (const row of scratchRows) for (const entry of row) for (const cell of entry.page.cells) hashes.add(`${cell.set} ${cell.scratch!.lines} lines, hash ${cell.scratch!.hash}`)
for (const row of relayoutRows) for (const entry of row) for (const cell of entry.page.cells) hashes.add(`${cell.set} relayout ${cell.relayout!.lines} lines, hash ${cell.relayout!.hash}`)
summary.push(`lines and hashes seen over all pages: ${[...hashes].join('; ')}`)
for (let i = 0; i < splits.length; i++) {
  for (const c of splits[i]!.page.cells) {
    const alone = median(c.alone!.map(pass => pass.ms))
    const inPlace = c.stopwatchSumMs! - c.timerSumMs!
    summary.push(`split ${splits[i]!.label} ${c.set}: ${c.calls} questions on ${c.contexts} contexts, ${c.distinct} of them a context's first of that string; wall ${c.wall!.ms.toFixed(1)} ms; free answers ${c.free!.ms.toFixed(1)} ms (${(100 * c.free!.ms / c.wall!.ms).toFixed(1)}% of wall); questions alone ${alone.toFixed(1)} ms (${c.alone!.map(pass => pass.ms.toFixed(0)).join(', ')}; ${(100 * alone / c.wall!.ms).toFixed(1)}% of wall), the same sum of widths as the pass: ${c.alone!.every(pass => pass.total === c.answered)}; free plus alone ${(c.free!.ms + alone).toFixed(1)} ms; stopwatch pass ${c.stopwatch!.ms.toFixed(1)} ms with ${c.stopwatchSumMs!.toFixed(1)} ms inside measureText, the two timer reads around a free answer ${c.timerSumMs!.toFixed(1)} ms (that pass ${c.freeStopwatch!.ms.toFixed(1)} ms), so Canvas in place ${inPlace.toFixed(1)} ms (${(100 * inPlace / c.wall!.ms).toFixed(1)}% of wall)`)
  }
}
const report = {
  schema: 'rebuild-js-profile-fresh-1', status: failure === null ? 'ok' : 'error', failure, build: readBuild('chrome'), startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(),
  load: { start: loadStart, end: loadavg()[0]! }, trees, messages, scratchRows, relayoutRows, splits,
}
writeFileSync(join(outDir, 'fresh-result.json'), `${JSON.stringify(report, null, 1)}\n`)
writeFileSync(join(outDir, 'fresh-summary.txt'), `${summary.join('\n')}\n`)
console.log(summary.join('\n'))
if (failure !== null) console.error(`[js-profile-fresh] ${failure}`)
process.exit(failure === null ? 0 : 1)
