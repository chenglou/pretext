// Where the Blink port's own JavaScript spends its time on the chat benchmark's messages, in pinned Chrome: a JS CPU
// profile through the DevTools Profiler domain, timings of several checkouts taking turns in one page, and the same with
// every Canvas answer free.
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=chrome -- bun rebuild/tools/js-profile.ts \
//     --mode=profile|pairs|classes --trees=<label>=<checkout>[,<label>=<checkout>...] --out=<dir> \
//     [--replay=yes] [--sets=mix,latin] [--messages=10000] [--rounds=12] [--relayout-rounds=6] [--phases=yes]
//
// A checkout is a folder that holds rebuild/src; the page side (js-profile-entry.ts) is this tree's, bundled once per
// checkout with `../src/` pointed at it. A pass is bench/README.md's E: every message of a set prepared and filled at
// 320 px from scratch, one list of Canvas contexts a pass. A relayout is the headline's resize: the set's messages
// prepared, filled at 320 px and kept, then filled at 260, 380 and 440 px.
//
// --mode=profile: per checkout and set, one untimed pass, one timed pass, then a pass inside console.profile and
//   console.profileEnd, which the Profiler domain (enabled over DevTools, 100 µs samples) answers with a profile; then the
//   relayout the same way. Every profile is written as <out>/<name>.cpuprofile, and js-profile-report.ts reads one.
// --mode=pairs: `--rounds` rounds; in a round every checkout runs every set once, and the next round starts one checkout
//   later, so whatever the machine does in a round it does to every checkout. Then `--relayout-rounds` rounds of the
//   relayout. --phases=yes adds a pass a round with a timer read around the font checks, the engine's prepare and the
//   line loop of every message. A timed run takes the exclusive lock (--browser=all --exclusive).
// --mode=classes: the first checkout's messages by the line boxes they make (1, 2, 3, 4 to 5, 6 and more): how many they
//   are, their text, their measureText calls, and their time in three passes on the real Canvas and three with free
//   answers, each message timed by itself (two timer reads a message, so read the classes beside each other).
// --replay=yes: every Canvas answer is free. The first checkout's pass is recorded once (what measureText answered, in
//   order, with a hash of every string asked and of the context it was asked on), every checkout must ask the same, and
//   the timed and profiled passes get the recorded answers back in order from an array. The code runs the path it runs
//   on the real Canvas, so what is left is the port's own JavaScript: the number no removal of Canvas questions can beat.
//   Contexts are still made (about 24 a pass).
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
const mode = args.get('mode')
if (mode !== 'profile' && mode !== 'pairs' && mode !== 'classes') throw new Error('--mode=profile|pairs|classes')
const trees = (args.get('trees') ?? '').split(',').filter(entry => entry !== '').map(entry => ({ label: entry.slice(0, entry.indexOf('=')), path: resolve(entry.slice(entry.indexOf('=') + 1)) }))
if (trees.length === 0) throw new Error('--trees=<label>=<checkout>[,...]')
const outDir = resolve(args.get('out') ?? '')
if (!args.has('out')) throw new Error('--out=<dir>')
const sets = (args.get('sets') ?? 'mix,latin').split(',') as Array<'mix' | 'latin'>
const config = {
  mode, replay: args.get('replay') === 'yes', phases: args.get('phases') === 'yes', rounds: Number(args.get('rounds') ?? 12),
  relayoutRounds: Number(args.get('relayout-rounds') ?? 6), width: CHAT_WIDTH, widths: CHAT_RESIZE_WIDTHS, labels: trees.map(tree => tree.label),
}
const runId = randomUUID()
mkdirSync(outDir, { recursive: true })

const bundles: string[] = []
for (let t = 0; t < trees.length; t++) {
  const src = join(trees[t]!.path, 'rebuild/src')
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'js-profile-entry.ts')], target: 'browser', format: 'iife', minify: false,
    plugins: [{ name: 'studied-tree', setup(build) { build.onResolve({ filter: /^\.\.\/src\// }, found => found.importer.endsWith('js-profile-entry.ts') ? { path: join(src, found.path.slice(7)) } : undefined) } }],
  })
  if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.map(String).join('\n')}`)
  bundles.push(`${await built.outputs[0]!.text()}\n(globalThis.jsProfileLibs ??= []).push(globalThis.jsProfileLib);\n`)
  writeFileSync(join(outDir, `lib-${trees[t]!.label}.js`), bundles[t]!)
}

const PAGE = String.raw`
const config = await (await fetch('/api/config')).json()
const SETS = await (await fetch('/api/sets')).json()
const sets = Object.keys(SETS)
const libs = globalThis.jsProfileLibs.map((lib, k) => ({ label: config.labels[k], lib, env: lib.environment(), paragraphs: {}, recorded: {} }))
for (const entry of libs) for (const set of sets) entry.paragraphs[set] = SETS[set].map(message => entry.lib.paragraphOf(message.parts))
const channel = new MessageChannel()
const pause = () => new Promise(resolve => { channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null) })
const proto = OffscreenCanvasRenderingContext2D.prototype
const real = proto.measureText

// What measureText answered during run(), in order, with a hash of every string asked and of the context asked.
function record(run) {
  const answers = []
  const ids = new Map()
  let hash = 0x811c9dc5
  proto.measureText = function (text) {
    const metrics = real.call(this, text)
    answers.push(metrics.width, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxRight)
    let id = ids.get(this)
    if (id === undefined) { id = ids.size; ids.set(this, id) }
    hash = Math.imul(hash ^ id, 0x01000193)
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
    hash = Math.imul(hash ^ 0xffff, 0x01000193)
    return metrics
  }
  try { run() } finally { proto.measureText = real }
  return { answers: Float64Array.from(answers), calls: answers.length / 3, hash: hash >>> 0 }
}

// run() with the recorded answers handed back in order.
function replaying(recorded, run) {
  const answers = recorded.answers
  const answer = { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  let n = 0
  proto.measureText = function () {
    answer.width = answers[n]
    answer.actualBoundingBoxLeft = answers[n + 1]
    answer.actualBoundingBoxRight = answers[n + 2]
    n += 3
    return answer
  }
  let result
  try { result = run() } finally { proto.measureText = real }
  if (n !== answers.length) throw new Error('a replayed pass asked ' + n / 3 + ' questions where the record holds ' + answers.length / 3)
  return result
}

const out = { classes: [], runId: config.runId, userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: window.crossOriginIsolated, config, recorded: [], stretches: [], rounds: [], relayoutRounds: [] }
const through = (entry, set, stage, run) => config.replay ? replaying(entry.recorded[set][stage], run) : run()

// Compiled code first: every checkout over the first 1,000 messages of every set, scratch and relayout.
for (const entry of libs) for (const set of sets) {
  const first = entry.paragraphs[set].slice(0, 1000)
  entry.lib.scratch(first, entry.env, config.width)
  entry.lib.relayout(entry.lib.prepareAll(first, entry.env, config.width), config.widths)
}
if (config.replay) {
  for (const entry of libs) for (const set of sets) {
    const list = entry.paragraphs[set]
    document.title = 'recording ' + entry.label + ' ' + set
    const scratch = record(() => entry.lib.scratch(list, entry.env, config.width))
    let kept = null
    const prepareAll = record(() => { kept = entry.lib.prepareAll(list, entry.env, config.width) })
    const relayout = record(() => entry.lib.relayout(kept, config.widths))
    entry.recorded[set] = { scratch, prepareAll, relayout }
    out.recorded.push({ label: entry.label, set, scratch: { calls: scratch.calls, hash: scratch.hash }, prepareAll: { calls: prepareAll.calls, hash: prepareAll.hash }, relayout: { calls: relayout.calls, hash: relayout.hash } })
    await pause()
  }
}

if (config.mode === 'profile') {
  for (const entry of libs) for (const set of sets) {
    const list = entry.paragraphs[set]
    const stretch = (name, run) => {
      console.profile(name)
      const start = performance.now()
      const result = run()
      const ms = performance.now() - start
      console.profileEnd(name)
      return { name, ms, ...result }
    }
    const timed = run => { const start = performance.now(); const result = run(); return { ms: performance.now() - start, ...result } }
    document.title = 'profile ' + entry.label + ' ' + set
    through(entry, set, 'scratch', () => entry.lib.scratch(list, entry.env, config.width))
    await pause()
    const plain = timed(() => through(entry, set, 'scratch', () => entry.lib.scratch(list, entry.env, config.width)))
    await pause()
    const name = (config.replay ? 'replay-' : '') + 'scratch-' + set + '-' + entry.label
    out.stretches.push({ ...stretch(name, () => through(entry, set, 'scratch', () => entry.lib.scratch(list, entry.env, config.width))), unprofiledMs: plain.ms })
    await pause()
    let kept = null
    through(entry, set, 'prepareAll', () => { kept = entry.lib.prepareAll(list, entry.env, config.width) })
    const plainRelayout = timed(() => through(entry, set, 'relayout', () => entry.lib.relayout(kept, config.widths)))
    kept = null
    await pause()
    through(entry, set, 'prepareAll', () => { kept = entry.lib.prepareAll(list, entry.env, config.width) })
    await pause()
    out.stretches.push({ ...stretch((config.replay ? 'replay-' : '') + 'relayout-' + set + '-' + entry.label, () => through(entry, set, 'relayout', () => entry.lib.relayout(kept, config.widths))), unprofiledMs: plainRelayout.ms })
    kept = null
    await pause()
  }
}

if (config.mode === 'classes') {
  const entry = libs[0]
  for (const set of sets) {
    const list = entry.paragraphs[set]
    const n = list.length
    const lineBoxes = new Int32Array(n)
    const calls = new Int32Array(n)
    const real = new Float64Array(n)
    const free = new Float64Array(n)
    const ms = new Float64Array(n)
    document.title = 'classes ' + set
    const recorded = record(() => entry.lib.scratch(list, entry.env, config.width))
    let asked = 0
    let before = 0
    const counting = proto.measureText
    proto.measureText = function (text) { asked++; return counting.call(this, text) }
    entry.lib.each(list, entry.env, config.width, ms, lineBoxes, i => { calls[i] = asked - before; before = asked })
    proto.measureText = counting
    for (let pass = 0; pass < 3; pass++) {
      entry.lib.each(list, entry.env, config.width, ms, lineBoxes, () => {})
      for (let i = 0; i < n; i++) real[i] += ms[i] / 3
      await pause()
      replaying(recorded, () => entry.lib.each(list, entry.env, config.width, ms, lineBoxes, () => {}))
      for (let i = 0; i < n; i++) free[i] += ms[i] / 3
      await pause()
    }
    const rows = ['1', '2', '3', '4 to 5', '6 and more'].map(lines => ({ set, lines, messages: 0, units: 0, calls: 0, realMs: 0, freeMs: 0 }))
    for (let i = 0; i < n; i++) {
      const row = rows[lineBoxes[i] <= 3 ? Math.max(lineBoxes[i], 1) - 1 : lineBoxes[i] <= 5 ? 3 : 4]
      row.messages++
      for (const part of SETS[set][i].parts) row.units += part.text.length
      row.calls += calls[i]
      row.realMs += real[i]
      row.freeMs += free[i]
    }
    out.classes.push(...rows)
  }
}

if (config.mode === 'pairs') {
  for (let round = 0; round < config.rounds; round++) {
    const row = []
    for (let k = 0; k < libs.length; k++) {
      const entry = libs[(k + round) % libs.length]
      for (const set of sets) {
        const list = entry.paragraphs[set]
        document.title = 'round ' + (round + 1) + '/' + config.rounds + ' ' + entry.label + ' ' + set
        await pause()
        const start = performance.now()
        const result = through(entry, set, 'scratch', () => entry.lib.scratch(list, entry.env, config.width))
        const cell = { label: entry.label, set, ms: performance.now() - start, lines: result.lines, hash: result.hash, phases: null }
        if (config.phases) {
          await pause()
          cell.phases = through(entry, set, 'scratch', () => entry.lib.phases(list, entry.env, config.width))
        }
        row.push(cell)
      }
    }
    out.rounds.push(row)
  }
  for (let round = 0; round < config.relayoutRounds; round++) {
    const row = []
    for (let k = 0; k < libs.length; k++) {
      const entry = libs[(k + round) % libs.length]
      for (const set of sets) {
        document.title = 'relayout round ' + (round + 1) + '/' + config.relayoutRounds + ' ' + entry.label + ' ' + set
        let kept = null
        through(entry, set, 'prepareAll', () => { kept = entry.lib.prepareAll(entry.paragraphs[set], entry.env, config.width) })
        await pause()
        const start = performance.now()
        const result = through(entry, set, 'relayout', () => entry.lib.relayout(kept, config.widths))
        row.push({ label: entry.label, set, ms: performance.now() - start, lines: result.lines, hash: result.hash })
        kept = null
        await pause()
      }
    }
    out.relayoutRounds.push(row)
  }
}
await fetch('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out) })
document.title = 'done'
`

type Cell = { label: string; set: string; ms: number; lines: number; hash: number; phases?: { checksMs: number; prepareMs: number; fillMs: number } | null }
type Result = {
  runId: string; userAgent: string; devicePixelRatio: number
  recorded: Array<{ label: string; set: string; scratch: { calls: number; hash: number }; prepareAll: { calls: number; hash: number }; relayout: { calls: number; hash: number } }>
  stretches: Array<{ name: string; ms: number; unprofiledMs: number; lines: number; hash: number }>
  rounds: Cell[][]; relayoutRounds: Cell[][]
  classes: Array<{ set: string; lines: string; messages: number; units: number; calls: number; realMs: number; freeMs: number }>
}

// run.ts asciiJsonResponse: every character above U+007E escaped, so a string is 8-bit in the page where its characters allow.
const ABOVE_ASCII = new RegExp(`[${String.fromCharCode(0x7f)}-${String.fromCharCode(0xffff)}]`, 'g')
const messages = Number(args.get('messages') ?? 10000)
const setsBody = JSON.stringify(Object.fromEntries(sets.map(set => [set, buildChat(set, messages)]))).replace(ABOVE_ASCII, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' }
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>js profile</title></head><body><p>Pretext JS profile.</p>${trees.map((_, t) => `<script src="/lib-${t}.js"></script>`).join('')}<script type="module" src="/page.js"></script></body></html>`

let settle: { resolve: (result: Result) => void; reject: (error: Error) => void } | null = null
const completion = new Promise<Result>((resolve, reject) => { settle = { resolve, reject } })
const FATAL = 'const fatal = error => fetch("/api/fatal", { method: "POST", body: String(error && error.stack || error) });\nwindow.addEventListener("error", event => fatal(event.error ?? event.message));\nwindow.addEventListener("unhandledrejection", event => fatal(event.reason));\n'

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  const lib = /^\/lib-(\d+)\.js$/.exec(path)
  if (lib !== null) return new Response(bundles[Number(lib[1])]!, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
  switch (path) {
    case '/': return new Response(HTML, { headers: { ...ISOLATION, 'content-type': 'text/html; charset=utf-8' } })
    case '/page.js': return new Response(FATAL + PAGE, { headers: { ...ISOLATION, 'content-type': 'text/javascript; charset=utf-8' } })
    case '/api/config': return Response.json({ ...config, runId })
    case '/api/sets': return new Response(setsBody, { headers: { 'content-type': 'application/json; charset=utf-8' } })
    case '/api/result': settle!.resolve(await request.json() as Result); return new Response('ok')
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

// ---- Pinned Chrome in the background, as bench/realism-run.ts launches it, with a DevTools session that stays attached ----

const profile = join(REPO, '.artifacts/profiles', `js-profile-${runId}`)
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
console.log(`[js-profile] Chrome pid ${pid}, ${readBuild('chrome').appVersion}; ${mode}${config.replay ? ', replay' : ''}; ${trees.map(tree => tree.label).join(', ')}; load ${loadavg()[0]!.toFixed(1)}`)

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
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data)) as { method?: string; params?: { title?: string; profile?: unknown } }
  if (message.method !== 'Profiler.consoleProfileFinished') return
  const file = join(outDir, `${message.params!.title}.cpuprofile`)
  writeFileSync(file, JSON.stringify(message.params!.profile))
  console.log(`[js-profile] ${file}`)
})

const startedAt = new Date()
const loadStart = loadavg()[0]!
let result: Result | null = null
let failure: string | null = null
try {
  const target = await command('Target.createTarget', { url: 'about:blank', newWindow: true, background: true }, null)
  const attached = await command('Target.attachToTarget', { targetId: target['targetId'], flatten: true }, null)
  const sessionId = String(attached['sessionId'])
  if (mode === 'profile') {
    await command('Profiler.enable', {}, sessionId)
    await command('Profiler.setSamplingInterval', { interval: 100 }, sessionId)
  }
  await command('Page.navigate', { url: `http://127.0.0.1:${server.port}/` }, sessionId)
  const stall = setTimeout(() => settle!.reject(new Error('No result in 40 minutes')), 40 * 60_000)
  result = await completion
  clearTimeout(stall)
  // The last profile's event can follow the page's post.
  await Bun.sleep(3_000)
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

// Per set: every checkout's median, and the differences from the first checkout round by round.
function summarize(title: string, rounds: Cell[][]): string[] {
  const lines: string[] = []
  if (rounds.length === 0) return lines
  for (let s = 0; s < sets.length; s++) {
    const of = (label: string): Cell[] => rounds.map(row => row.find(cell => cell.label === label && cell.set === sets[s])!)
    const base = of(trees[0]!.label)
    for (let t = 0; t < trees.length; t++) {
      const cells = of(trees[t]!.label)
      const ms = cells.map(cell => cell.ms)
      let line = `${title} ${sets[s]} ${trees[t]!.label}: median ${median(ms).toFixed(1)} ms (${Math.min(...ms).toFixed(1)} to ${Math.max(...ms).toFixed(1)}; ${rounds.length} rounds), ${cells[0]!.lines} lines, hash ${cells[0]!.hash}`
      if (t > 0) {
        const diffs = cells.map((cell, r) => cell.ms - base[r]!.ms).sort((a, b) => a - b)
        line += `; minus ${trees[0]!.label}: median ${median(diffs).toFixed(1)} ms, quartiles ${diffs[Math.floor(diffs.length / 4)]!.toFixed(1)} to ${diffs[Math.floor(diffs.length * 3 / 4)]!.toFixed(1)}, range ${diffs[0]!.toFixed(1)} to ${diffs[diffs.length - 1]!.toFixed(1)}, ${diffs.filter(diff => diff < 0).length} of ${diffs.length} rounds under 0`
      }
      lines.push(line)
      if (cells[0]!.phases != null) lines.push(`${title} ${sets[s]} ${trees[t]!.label} phases, medians: checks ${median(cells.map(cell => cell.phases!.checksMs)).toFixed(1)} ms, prepare ${median(cells.map(cell => cell.phases!.prepareMs)).toFixed(1)} ms, fill ${median(cells.map(cell => cell.phases!.fillMs)).toFixed(1)} ms`)
    }
  }
  return lines
}

// A checkout's commit, or null for a folder exported from one (git archive), which holds no repository.
function headOf(path: string): string | null {
  const found = Bun.spawnSync(['git', '-C', path, 'rev-parse', '--show-toplevel', 'HEAD'])
  const lines = found.stdout.toString().trim().split('\n')
  return found.exitCode === 0 && lines[0] === path ? lines[1]! : null
}

const report = {
  schema: 'rebuild-js-profile-1', status: failure === null ? 'ok' : 'error', failure, build: readBuild('chrome'), startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(),
  load: { start: loadStart, end: loadavg()[0]! }, power: execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).split('\n').slice(0, 2).join(' '),
  trees: trees.map(tree => ({ ...tree, head: headOf(tree.path) })), messages, result,
}
writeFileSync(join(outDir, `${mode}${config.replay ? '-replay' : ''}-result.json`), `${JSON.stringify(report, null, 1)}\n`)
const summary: string[] = [`load ${loadStart.toFixed(1)} to ${loadavg()[0]!.toFixed(1)}; ${report.power}`]
if (result !== null) {
  for (let i = 0; i < result.recorded.length; i++) {
    const r = result.recorded[i]!
    summary.push(`recorded ${r.label} ${r.set}: scratch ${r.scratch.calls} calls hash ${r.scratch.hash}; prepare and keep ${r.prepareAll.calls} calls hash ${r.prepareAll.hash}; relayout ${r.relayout.calls} calls hash ${r.relayout.hash}`)
  }
  for (let i = 0; i < result.stretches.length; i++) {
    const s = result.stretches[i]!
    summary.push(`${s.name}: ${s.ms.toFixed(1)} ms profiled, ${s.unprofiledMs.toFixed(1)} ms without the profiler, ${s.lines} lines, hash ${s.hash}`)
  }
  summary.push(...summarize('scratch', result.rounds), ...summarize('relayout', result.relayoutRounds))
  for (let i = 0; i < result.classes.length; i++) {
    const c = result.classes[i]!
    summary.push(`${c.set}, ${c.lines} line boxes: ${c.messages} messages, ${(c.units / c.messages).toFixed(0)} units and ${(c.calls / c.messages).toFixed(1)} calls a message, ${(c.realMs * 1000 / c.messages).toFixed(1)} µs a message on the real Canvas and ${(c.freeMs * 1000 / c.messages).toFixed(1)} µs with free answers; ${(c.realMs).toFixed(0)} ms and ${c.calls} calls of the set`)
  }
}
writeFileSync(join(outDir, `${mode}${config.replay ? '-replay' : ''}-summary.txt`), `${summary.join('\n')}\n`)
console.log(summary.join('\n'))
if (failure !== null) console.error(`[js-profile] ${failure}`)
process.exit(failure === null ? 0 : 1)
