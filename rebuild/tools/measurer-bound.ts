// What a page's measurer costs a page with many font declarations (src/measure/font-checks.ts Measurer, "Bounded by"): a
// review's check of research/PROFILING-START.md item 1. The measurer finds a context by comparing settings one by one and
// a font check's answer by comparing (context, string) one by one, so both searches grow with what the page has used.
// This prices the searches alone: under the stand-in Canvas a context costs nothing to make, so a measurer a call is the
// floor and everything one measurer adds over it is list searching.
//
//   bun rebuild/tools/measurer-bound.ts [--prepares=N] [--rounds=N] [--cycles=D[,D...]]
//
// Two questions, Blink's port (it makes the most contexts a declaration), one English sentence, unknown font facts:
// - declarations that never repeat, by what differs: the size (the checks measure at 16px, so their contexts and answers
//   are shared between sizes), the family (the checks' contexts and answers are per family, so both lists grow) and the
//   letter spacing (the engine's contexts alone);
// - declarations that do repeat: a page that cycles through D of them by family (--cycles, which leaves the rows above
//   out), where the measurer holds about 8 D contexts for good and every prepare searches them, until 8 D passes the
//   measurer's 1,024 contexts: from there it starts over in every cycle and the page makes its contexts again and again.
// It prints the most contexts and answers the measurer held, contexts made a prepare, and microseconds a prepare for a
// measurer a call and for one measurer, the two taking turns in every round: the median of the rounds and their range.
// Times depend on the machine's load; the list lengths and the contexts don't.
import { PINNED_BUILDS, type BlinkEnvironment } from '../src/env.ts'
import { newMeasurer, prepare, UNKNOWN_FONT_FACTS, type Paragraph } from '../src/index.ts'
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

type Run = { microseconds: number; contextsMade: number; mostContexts: number; mostAnswers: number }

function run(kind: Kind, distinct: number, shared: boolean): Run {
  const measurer = newMeasurer()
  // A page that repeats its declarations has met them all before the timed prepares.
  if (shared && distinct < PREPARES) for (let i = 0; i < distinct; i++) prepare(paragraph(kind, i, distinct), ENV, false, measurer)
  standIn.reset()
  let mostContexts = 0
  let mostAnswers = 0
  const from = performance.now()
  for (let i = 0; i < PREPARES; i++) {
    if (shared) prepare(paragraph(kind, i, distinct), ENV, false, measurer)
    else prepare(paragraph(kind, i, distinct), ENV, false)
    if (measurer.contexts.length > mostContexts) mostContexts = measurer.contexts.length
    if (measurer.asked.length > mostAnswers) mostAnswers = measurer.asked.length
  }
  return { microseconds: (performance.now() - from) / PREPARES * 1000, contextsMade: standIn.asked().contexts / PREPARES, mostContexts, mostAnswers }
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
  console.log(`${label}: a measurer a call ${median(a).toFixed(0)} us (${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}), ${perCall[0]!.contextsMade.toFixed(2)} contexts a prepare | one measurer ${median(b).toFixed(0)} us (${Math.min(...b).toFixed(0)}-${Math.max(...b).toFixed(0)}), ${last.contextsMade.toFixed(2)} contexts a prepare, at most ${last.mostContexts} contexts and ${last.mostAnswers} answers held | ratio of medians ${(median(b) / median(a)).toFixed(2)}`)
}

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
