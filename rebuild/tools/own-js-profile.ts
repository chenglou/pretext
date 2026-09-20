// The port's own JavaScript, with Canvas taken out: the chat benchmark's messages (bench/cases.ts buildChat) laid out
// under a Canvas that answers every question it has met from a Map, so what is left of a pass is the library's code.
// It is the floor no removal of Canvas questions can beat, and under `bun --cpu-prof` it is the profile of that code
// (bun runs JavaScriptCore, as WebKit does; Chrome's and Firefox's ports run here too, for their shares, not for their
// engines' times).
//
//   bun rebuild/tools/own-js-profile.ts [--engine=webkit|blink|gecko] [--set=mix|latin] [--task=scratch|relayout|phases]
//     [--messages=10000] [--passes=7]
//   bun --cpu-prof --cpu-prof-md --cpu-prof-dir=<dir> --cpu-prof-interval=200 rebuild/tools/own-js-profile.ts ...
//
// The first pass fills the Map from tools/stand-in-canvas.ts and is left out; every later pass is timed. A pass makes one
// list of contexts, as a page does (src/index.ts prepare). `scratch` prepares every message and fills its lines at
// 320px; `relayout` fills kept messages at 260, 380 and 440px; `phases` splits `scratch` with a timer around the font
// checks, the engine's prepare and the fill. The Map's own cost is printed beside the passes: the calls of a pass,
// asked again of the Map alone. `questionsDigest` is one number for a pass's contexts and questions in order, and
// `distinctQuestions` counts the pairs of a context's settings and a string the passes asked.
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import { geckoFontChecks } from '../src/engines/gecko/checks.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { webkitFontChecks } from '../src/engines/webkit/checks.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import { PINNED_BUILDS, type Environment } from '../src/env.ts'
import { fillLine, firstLine, prepare, UNKNOWN_FONT_FACTS, type BoxEdge, type Context, type FontDecl, type InlineNode, type Paragraph, type Prepared } from '../src/index.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { buildChat, CHAT_CODE_FONT, CHAT_CODE_PADDING, CHAT_RESIZE_WIDTHS, CHAT_STYLE, CHAT_WIDTH } from '../bench/cases.ts'
import type { ChatSetId } from '../bench/protocol.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const ENGINE = options.get('engine') ?? 'webkit'
const SET = (options.get('set') ?? 'mix') as ChatSetId
const TASK = options.get('task') ?? 'scratch'
const MESSAGES = Number(options.get('messages') ?? 10000)
const PASSES = Number(options.get('passes') ?? 7)

const PAGES: Record<string, { userAgent: string; env: Environment }> = {
  webkit: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
    env: { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: null, icuDefaultLocale: null, dictionaryBreaks: { kind: 'intl-segmenter-word' } },
  },
  blink: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    env: { engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: null, dictionaryBreaks: { kind: 'unavailable' } },
  },
  gecko: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
    env: { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: null, dictionaryBreaks: { kind: 'intl-segmenter-word' } },
  },
}
const page = PAGES[ENGINE]
if (page === undefined) throw new Error(`--engine must be webkit, blink or gecko`)
const env = page.env
installStandInCanvas({ userAgent: page.userAgent, devicePixelRatio: 2, pageLang: 'en' })

// The Canvas that answers from a Map. A context's answers are found by its settings, so a new pass's contexts meet the
// answers an earlier pass's contexts got.
type Inner = { measureText(text: string): unknown } & Record<string, unknown>
const StandIn = (globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Inner } }).OffscreenCanvas
const answersBySettings = new Map<string, Map<string, unknown>>()
const work = { calls: 0, contexts: 0 }
let asked: Array<{ answers: Map<string, unknown>; text: string }> | null = null
// The same pass as the digest reads it: a line per context made and per question, in order.
let sequence: string[] | null = null
const ATTRIBUTES = ['lang', 'font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']
class MapContext {
  inner: Inner = new StandIn(1, 1).getContext('2d')
  answers: Map<string, unknown> | null = null
  settings = ''
  constructor() {
    work.contexts++
    if (sequence !== null) sequence.push('a context made')
  }
  measureText(text: string): unknown {
    work.calls++
    if (this.answers === null) {
      const key = ATTRIBUTES.map(name => String(this.inner[name])).join('|')
      let answers = answersBySettings.get(key)
      if (answers === undefined) {
        answers = new Map()
        answersBySettings.set(key, answers)
      }
      this.answers = answers
      this.settings = key
    }
    if (asked !== null) asked.push({ answers: this.answers, text })
    if (sequence !== null) sequence.push(`${this.settings}\n${text}`)
    let answer = this.answers.get(text)
    if (answer === undefined) {
      answer = this.inner.measureText(text)
      this.answers.set(text, answer)
    }
    return answer
  }
}
for (const name of ATTRIBUTES) {
  Object.defineProperty(MapContext.prototype, name, {
    get(this: MapContext): unknown { return this.inner[name] },
    set(this: MapContext, value: unknown): void {
      this.inner[name] = value
      this.answers = null
    },
  })
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: class { getContext(): MapContext { return new MapContext() } }, configurable: true, writable: true })

// bench/page.ts chatInputs: one declaration for every message, a code span in its own font, no font facts supplied.
function paragraphOf(parts: readonly { code: boolean; text: string }[]): Paragraph {
  const font: FontDecl = { ...CHAT_STYLE.font, facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { ...CHAT_CODE_FONT, facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: CHAT_CODE_PADDING }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: CHAT_STYLE.lineHeight, direction: CHAT_STYLE.direction, lang: CHAT_STYLE.lang, textIndent: 0, textAlign: 'start' }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

function scratch(paragraphs: readonly Paragraph[]): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(prepare(paragraphs[i]!, env, false, contexts), CHAT_WIDTH)
  return lines
}

function prepareAll(paragraphs: readonly Paragraph[]): Prepared[] {
  const contexts: Context[] = []
  const out: Prepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepare(paragraphs[i]!, env, false, contexts))
    fillAll(out[i]!, CHAT_WIDTH)
  }
  return out
}

function relayout(prepared: readonly Prepared[]): number {
  let lines = 0
  for (let w = 0; w < CHAT_RESIZE_WIDTHS.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, CHAT_RESIZE_WIDTHS[w]!)
  return lines
}

// prepare() as the two halves src/index.ts joins, with a timer around each and around the fill (bench/page.ts chatPhases).
const phase = { checks: 0, prepare: 0, fill: 0 }
function scratchPhases(paragraphs: readonly Paragraph[]): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const t0 = performance.now()
    let prepared: Prepared
    let t1: number
    switch (env.engine) {
      case 'blink': {
        const checked = withLearnedFontFacts(paragraphs[i]!, blinkFontChecks(env), contexts)
        t1 = performance.now()
        prepared = { engine: 'blink', state: blink.prepare(checked, env, false, contexts) }
        break
      }
      case 'webkit': {
        const checked = withLearnedFontFacts(paragraphs[i]!, webkitFontChecks, contexts)
        t1 = performance.now()
        prepared = { engine: 'webkit', state: webkit.prepare(checked, env, false, contexts) }
        break
      }
      case 'gecko': {
        const checked = withLearnedFontFacts(paragraphs[i]!, geckoFontChecks, contexts)
        t1 = performance.now()
        prepared = { engine: 'gecko', state: gecko.prepare(checked, env, false, contexts) }
        break
      }
    }
    const t2 = performance.now()
    lines += fillAll(prepared, CHAT_WIDTH)
    const t3 = performance.now()
    phase.checks += t1 - t0
    phase.prepare += t2 - t1
    phase.fill += t3 - t2
  }
  return lines
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 === 1 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}

const messages = buildChat(SET, MESSAGES)
const paragraphs: Paragraph[] = []
for (let i = 0; i < messages.length; i++) paragraphs.push(paragraphOf(messages[i]!.parts))

function pass(): number {
  switch (TASK) {
    case 'scratch': return scratch(paragraphs)
    case 'phases': return scratchPhases(paragraphs)
    case 'relayout': return relayout(kept)
    default: throw new Error('--task must be scratch, relayout or phases')
  }
}

// The Map's first pass, untimed; a relayout's kept paragraphs have been filled at every width by then, as the bench's
// "resize again" rows have.
const kept: Prepared[] = TASK === 'relayout' ? prepareAll(paragraphs) : []
const lines = pass()
// One pass's questions, to price the Map alone afterwards.
asked = []
sequence = []
work.calls = 0
work.contexts = 0
pass()
const questions = asked
const asksAndContexts = sequence
const calls = work.calls
const contexts = work.contexts
asked = null
sequence = null

const times: number[] = []
const phases: Array<typeof phase> = []
for (let p = 0; p < PASSES; p++) {
  phase.checks = 0
  phase.prepare = 0
  phase.fill = 0
  const t0 = performance.now()
  const got = pass()
  times.push(performance.now() - t0)
  phases.push({ ...phase })
  if (got !== lines) throw new Error(`a pass gave ${got} lines where the first gave ${lines}`)
}
const mapTimes: number[] = []
for (let p = 0; p < PASSES; p++) {
  const t0 = performance.now()
  let sum = 0
  for (let i = 0; i < questions.length; i++) sum += (questions[i]!.answers.get(questions[i]!.text) as { width: number }).width
  mapTimes.push(performance.now() - t0)
  if (sum < 0) throw new Error('unreachable')
}

// The pass's contexts and questions in order, each question with its context's settings, as one number: two trees that
// print the same number made their contexts at the same points and asked Canvas the same strings of the same contexts in
// the same order (FNV-1a over UTF-16 units). A quick look before tier 1, which is the proof.
let digest = 0x811c9dc5
for (let i = 0; i < asksAndContexts.length; i++) {
  const line = asksAndContexts[i]!
  for (let k = 0; k < line.length; k++) digest = Math.imul(digest ^ line.charCodeAt(k), 0x01000193)
  digest = Math.imul(digest ^ 0xff, 0x01000193)
}

let distinct = 0
for (const answers of answersBySettings.values()) distinct += answers.size

const layouts = TASK === 'relayout' ? MESSAGES * CHAT_RESIZE_WIDTHS.length : MESSAGES
const out = {
  engine: ENGINE, set: SET, task: TASK, messages: MESSAGES, layouts, lines,
  callsAPass: calls, distinctQuestions: distinct, contextsAPass: contexts, questionsDigest: (digest >>> 0).toString(16),
  passMs: times.map(ms => Math.round(ms * 10) / 10), medianMs: Math.round(median(times) * 10) / 10,
  mapAloneMs: Math.round(median(mapTimes) * 10) / 10,
  ownJsMicrosecondsALayout: Math.round((median(times) - median(mapTimes)) / layouts * 1000 * 100) / 100,
  phasesMs: TASK === 'phases' ? { checks: Math.round(median(phases.map(one => one.checks))), prepare: Math.round(median(phases.map(one => one.prepare))), fill: Math.round(median(phases.map(one => one.fill))) } : null,
}
console.log(JSON.stringify(out))
