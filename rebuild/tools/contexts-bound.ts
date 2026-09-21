// What a page's list of Canvas contexts costs a page with many font declarations (src/index.ts prepare, "Bounded by"): a
// review's check of research/PROFILING-START.md item 1, and what prepare's bound was decided from. The current pool finds a context
// by an ordered settings lookup; the original cap study used a linear array.
//
//   bun rebuild/tools/contexts-bound.ts [--prepares=N] [--rounds=N] [--cycles=D[,D...]]
//
// The search alone, first: current ContextPool lookup over 16 to 4,096 contexts whose settings are strings built at
// run time. Every context is looked up in creation order; report nanoseconds per lookup, the best of seven passes.
// The 2026-09-19 study used a linear array and reported nanoseconds per settings comparison. Its comparison counts and
// cap tradeoff are historical (research/PROFILING-START.md), not denominators for the current logarithmic lookup.
//
// Then prepares under the stand-in Canvas, Blink's port (it makes the most contexts a declaration), one English
// sentence, unknown font facts. There a context costs nothing to make, so a list a call is the floor:
// - declarations that never repeat, by what differs: the size (the checks measure at 16px, so their contexts are shared
//   between sizes), the family (the checks' contexts are per family) and the letter spacing (the engine's contexts alone);
// - declarations that do repeat: a page that cycles through D of them by family (--cycles, which leaves the rows above
//   out), where the list holds about 8 D contexts for good and every prepare searches them, until 8 D passes prepare's
//   bound: from there the list is emptied in every cycle and the page makes its contexts again and again.
// It prints the most contexts the list held, contexts made a prepare, and microseconds a prepare for a list a call and
// for one list, the two taking turns in every round: the median of the rounds and their range. Times depend on the
// machine's load, and the stand-in's own work is most of them; the list's length and the contexts made don't.
import { PINNED_BUILDS, type BlinkEnvironment } from '../src/env.ts'
import { prepare, UNKNOWN_FONT_FACTS, createContextPool, type Paragraph } from '../src/index.ts'
import { contextFor, type CanvasSettings } from '../src/measure/canvas.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const PREPARES = Number(options.get('prepares') ?? 3000)
const ROUNDS = Number(options.get('rounds') ?? 5)

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const ENV: BlinkEnvironment = { engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: 'en-US', dictionaryBreaks: { kind: 'unavailable' } }
const TEXT = 'The quick brown fox jumps over the lazy dog, and then it does so again for good measure.'

type Kind = 'size' | 'family' | 'letter-spacing'

// The i-th declaration of a kind; `distinct` is how many there are before they repeat.
function paragraph(kind: Kind, i: number, distinct: number): Paragraph {
  const k = i % distinct
  const font = { family: kind === 'family' ? `"Review Family ${k}", sans-serif` : '"Helvetica Neue", sans-serif', size: kind === 'size' ? 10 + k / 1000 : 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }
  return {
    font, letterSpacing: kind === 'letter-spacing' ? k / 1000 : 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text: TEXT }], lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start',
  }
}

const standIn = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: 'en' })

type Run = { microseconds: number; contextsMade: number; mostContexts: number }

function run(kind: Kind, distinct: number, shared: boolean): Run {
  const contexts = createContextPool()
  // A page that repeats its declarations has met them all before the timed prepares.
  if (shared && distinct < PREPARES) for (let i = 0; i < distinct; i++) prepare(paragraph(kind, i, distinct), ENV, false, contexts)
  standIn.reset()
  let mostContexts = 0
  const from = performance.now()
  for (let i = 0; i < PREPARES; i++) {
    if (shared) prepare(paragraph(kind, i, distinct), ENV, false, contexts)
    else prepare(paragraph(kind, i, distinct), ENV, false)
    if (contexts.size > mostContexts) mostContexts = contexts.size
  }
  return { microseconds: (performance.now() - from) / PREPARES * 1000, contextsMade: standIn.asked().contexts / PREPARES, mostContexts }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]!
}

function row(label: string, kind: Kind, distinct: number): void {
  const perCall: Run[] = []
  const one: Run[] = []
  for (let round = 0; round < ROUNDS; round++) {
    if (round % 2 === 0) { perCall.push(run(kind, distinct, false)); one.push(run(kind, distinct, true)) }
    else { one.push(run(kind, distinct, true)); perCall.push(run(kind, distinct, false)) }
  }
  const a = perCall.map(r => r.microseconds)
  const b = one.map(r => r.microseconds)
  const last = one[one.length - 1]!
  console.log(`${label}: a list a call ${median(a).toFixed(0)} us (${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}), ${perCall[0]!.contextsMade.toFixed(2)} contexts a prepare | one list ${median(b).toFixed(0)} us (${Math.min(...b).toFixed(0)}-${Math.max(...b).toFixed(0)}), ${last.contextsMade.toFixed(2)} contexts a prepare, at most ${last.mostContexts} contexts held | ratio of medians ${(median(b) / median(a)).toFixed(2)}`)
}

// The k-th declaration's part-th context of eight, as a port's settings look.
const PARTITIONS = ['8bit', '8bit-no-liga', '16bit', 'font-checks']

function settingsOf(k: number, part: number): CanvasSettings {
  return {
    font: `normal 400 16px ${['"Review Family ', String(k), '", sans-serif'].join('')}`, lang: 'en', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto',
    textRendering: 'optimizeLegibility', direction: part % 2 === 0 ? 'ltr' : 'rtl', partition: PARTITIONS[part >> 1]!,
  }
}

function searchAlone(length: number): void {
  const list = createContextPool()
  const asks: CanvasSettings[] = []
  for (let i = 0; i < length; i++) {
    contextFor(list, settingsOf(i >> 3, i & 7))
    asks.push(settingsOf(i >> 3, i & 7))
  }
  const rounds = Math.max(3, Math.floor(4_000_000 / (length * length)))
  let best = Infinity
  let found = 0
  for (let pass = 0; pass < 7; pass++) {
    const from = performance.now()
    for (let r = 0; r < rounds; r++) for (let i = 0; i < length; i++) if (contextFor(list, asks[i]!) === list.entries[i]) found++
    best = Math.min(best, (performance.now() - from) / (rounds * length))
  }
  if (found !== 7 * rounds * length) throw new Error('a lookup made a context')
  console.log(`search alone, ${length} contexts: ${(best * 1e6).toFixed(1)} ns a lookup, ${(best * 1000).toFixed(2)} us a lookup`)
}

const lengths = [16, 64, 256, 512, 1024, 4096]
for (let i = 0; i < lengths.length; i++) searchAlone(lengths[i]!)
run('family', 50, true)
run('family', 50, false)
console.log(`${PREPARES} Blink prepares a run, ${ROUNDS} rounds taking turns, stand-in Canvas`)
const given = options.get('cycles')
if (given === undefined) {
  row('never repeats, by size', 'size', PREPARES)
  row('never repeats, by family', 'family', PREPARES)
  row('never repeats, by letter spacing', 'letter-spacing', PREPARES)
}
const cycles = given === undefined ? [1, 10, 30, 60, 100] : given.split(',').map(Number)
for (let i = 0; i < cycles.length; i++) row(`repeats, ${cycles[i]!} families`, 'family', cycles[i]!)
standIn.restore()
