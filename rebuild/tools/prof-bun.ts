// The Gecko port's own JavaScript under bun's CPU profiler: the chat benchmark's loops (tools/prof-entry.ts) over a
// stand-in Canvas that answers from a recording made in Firefox (tools/prof-probe.ts, section `export`), so the port takes
// the branches it takes in the browser and the profile holds no shaping. JavaScriptCore is not SpiderMonkey: what this
// names is a suspect, and a suspect is proven in Firefox (prof-probe.ts with two checkouts).
//
// Without --recording the answers are recorded here from tools/stand-in-canvas.ts, whose fonts kern and ligate by a
// hash, not as Firefox's do: a first look without a browser.
//
//   bun --cpu-prof --cpu-prof-md --cpu-prof-dir=<dir> rebuild/tools/prof-bun.ts --recording=<dir>/firefox-probes.json \
//     --set=mix|latin --scenario=scratch|resize [--passes=20]
import { readFileSync } from 'node:fs'
import { buildChat } from '../bench/cases.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

type Answers = { length: Uint32Array; width: Float64Array; left: Float64Array; right: Float64Array }
type Exported = { env: unknown; messages: number; sets: Record<string, { mark: number; length: number[]; width: number[]; left: number[]; right: number[] }> }
type Prof = {
  environment: () => unknown
  paragraphOf: (parts: unknown) => unknown
  scratch: (paragraphs: unknown[], env: unknown, width: number) => number
  prepareAll: (paragraphs: unknown[], env: unknown, width: number) => unknown[]
  relayout: (prepared: unknown[], widths: number[]) => number
  standInCanvas: (answers: Answers, checked: boolean) => void
  newRecording: (texts: boolean) => { context: number[] }
  recordingCanvas: (recording: unknown) => void
  answersOf: (recording: unknown) => Answers
}

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  args.set(match[1]!, match[2]!)
}
const set = args.get('set') ?? 'mix'
const scenario = args.get('scenario') ?? 'scratch'
const passes = Number(args.get('passes') ?? '20')
const recording = args.get('recording')
// The entry keeps the Canvas it finds when it loads as the real one.
if (recording === undefined) installStandInCanvas({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0', devicePixelRatio: 2, pageLang: 'en' })
await import('./prof-entry.ts')
const prof = (globalThis as unknown as { prof: Prof }).prof
let env: unknown
let messages = 1000
let answers: Answers
let described: string
if (recording === undefined) {
  env = prof.environment()
  const made = prof.newRecording(false)
  prof.recordingCanvas(made)
  const paragraphs = buildChat(set as 'mix' | 'latin', messages).map(message => prof.paragraphOf(message.parts))
  prof.relayout(prof.prepareAll(paragraphs, env, 320), [260, 380, 440])
  answers = prof.answersOf(made)
  described = `${made.context.length} calls recorded from the hashed stand-in Canvas`
} else {
  const output = JSON.parse(readFileSync(recording, 'utf8')) as { results: Array<{ result: { observations: Array<{ kind: string; value?: { exported: Exported } }> } }> }
  const exported = output.results[0]!.result.observations.find(o => o.kind === 'script')!.value!.exported
  const recorded = exported.sets[set]!
  env = exported.env
  messages = exported.messages
  answers = { length: Uint32Array.from(recorded.length), width: Float64Array.from(recorded.width), left: Float64Array.from(recorded.left), right: Float64Array.from(recorded.right) }
  described = `${recorded.length.length} recorded calls (${recorded.mark} before the resize)`
}
const paragraphs = buildChat(set as 'mix' | 'latin', messages).map(message => prof.paragraphOf(message.parts))

// The checked stand-in first: the port asks under bun what it asked when it was recorded.
prof.standInCanvas(answers, true)
prof.relayout(prof.prepareAll(paragraphs, env, 320), [260, 380, 440])

let lines = 0
const t0 = performance.now()
for (let pass = 0; pass < passes; pass++) {
  prof.standInCanvas(answers, false)
  if (scenario === 'scratch') lines += prof.scratch(paragraphs, env, 320)
  else lines += prof.relayout(prof.prepareAll(paragraphs, env, 320), [260, 380, 440])
}
const ms = performance.now() - t0
console.log(`${set} ${scenario}: ${passes} passes of ${messages} messages, ${(ms / passes).toFixed(1)} ms a pass, ${(ms * 1000 / passes / messages).toFixed(1)} µs a message, ${lines / passes} lines a pass, ${described}`)
