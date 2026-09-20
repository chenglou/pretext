// Browser side of the realism study (realism-run.ts): the bench's headline and nothing else. Every set's messages are laid
// out from scratch in count mode, as page.ts scratchChat does (prepare() with its font checks and new Canvas contexts,
// then fillLine over every line at the plan's width, nothing kept across messages), once a pass, the sets taking turns,
// after an untimed warm-up of each set's first 500 messages.
// After the timed passes a counting pass wraps measureText and getContext and runs every set once more: calls, the UTF-16
// units of the strings sent, contexts and lines, in all and by label (a chat message's kind, a text's language). Only fetch promises and MessageChannel tasks
// drive it, so background timer throttling can't stall it.
import { detectEnvironment, fillLine, firstLine, prepare, type EngineName, type Environment, type GivenFacts } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'
import type { BrowserKind, ChatPart, ScriptStyle } from './protocol.ts'
import type { CssFont } from '../src/model.ts'

// A message and what the counting pass files it under: a chat set's message kind, or a text's language.
export type RealismMessage = { label: string; parts: ChatPart[] }

export type RealismPlan = {
  runId: string
  browser: BrowserKind
  engineBuild: string
  style: ScriptStyle
  codeFont: CssFont
  codePadding: number
  width: number
  passes: number
  // Whether the counting pass runs after the timed passes (a timed sitting whose counts are known leaves it out).
  counts: boolean
  sets: { id: string; messages: RealismMessage[] }[]
}

// `ms` is timed in the counting pass, with its wrappers on and two timer reads a message: for the labels beside each other.
export type RealismLabelCount = { label: string; messages: number; units: number; measureTextCalls: number; unitsSent: number; contexts: number; lines: number; ms: number }

export type RealismSetResult = {
  id: string
  messages: number
  // UTF-16 units of the messages' text.
  units: number
  // One entry per pass: the whole set from scratch, in ms.
  scratchMs: number[]
  lines: number
  measureTextCalls: number
  // UTF-16 units of every string given to measureText.
  unitsSent: number
  contexts: number
  // Every line's source range of the counting pass, hashed in order (0 without the pass).
  lineRangesHash: number
  byLabel: RealismLabelCount[]
}

export type RealismResult = {
  runId: string
  userAgent: string
  devicePixelRatio: number
  crossOriginIsolated: boolean
  visibility: string
  hardwareConcurrency: number
  // page.ts spin(): a fixed loop of integer arithmetic, in ms, before the first pass and after the last.
  spinMs: { start: number; end: number }
  sets: RealismSetResult[]
}

const runId = new URLSearchParams(location.search).get('run') ?? ''
let sink = 0

const channel = new MessageChannel()
function yieldTask(): Promise<void> {
  return new Promise(resolve => {
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
}

function spin(): number {
  const start = performance.now()
  let x = 1
  for (let i = 0; i < 20_000_000; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
  }
  sink += x & 1
  return performance.now() - start
}

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'firefox': return 'gecko'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
  }
}

function givenFacts(engine: EngineName, build: string): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build, contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build, contentLanguage: null, regionalPrefsLocale: null }
  }
}

// page.ts chatInputs: a message as the rebuild takes it, no font facts supplied.
function paragraphsOf(plan: RealismPlan, messages: readonly RealismMessage[]): Paragraph[] {
  const s = plan.style
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { ...plan.codeFont, facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: plan.codePadding }
  const out: Paragraph[] = []
  for (let i = 0; i < messages.length; i++) {
    const parts = messages[i]!.parts
    const content: InlineNode[] = []
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]!
      if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
      else content.push({ kind: 'text', text: part.text })
    }
    out.push({ ...text, font, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' })
  }
  return out
}

// One message from scratch in count mode; returns its line boxes.
function scratch(paragraph: Paragraph, env: Environment, width: number): number {
  const prepared = prepare(paragraph, env, false)
  let lineBoxes = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lineBoxes++
    start = filled.next
  }
  return lineBoxes
}

// The same in the counting pass, where every line's source range also goes into `rangeHash` (FNV-1a over the numbers), so
// two trees, or two ratios, can be held against each other line by line.
let rangeHash = 0x811c9dc5
function scratchCounted(paragraph: Paragraph, env: Environment, width: number): number {
  const prepared = prepare(paragraph, env, false)
  let lineBoxes = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    rangeHash = Math.imul(rangeHash ^ filled.start, 0x01000193)
    rangeHash = Math.imul(rangeHash ^ filled.end, 0x01000193)
    if (filled.hasLineBox) lineBoxes++
    start = filled.next
  }
  return lineBoxes
}

const canvasWork = { measureTextCalls: 0, unitsSent: 0, contexts: 0 }
// Messages of every set laid out before the first timed pass.
const WARM_UP = 500

function wrapCanvas(): void {
  const context = OffscreenCanvasRenderingContext2D.prototype
  const measureText = context.measureText
  context.measureText = function (this: OffscreenCanvasRenderingContext2D, text: string): TextMetrics {
    canvasWork.measureTextCalls++
    canvasWork.unitsSent += text.length
    return measureText.call(this, text)
  }
  const canvas = OffscreenCanvas.prototype as unknown as { getContext: (this: unknown, ...rest: unknown[]) => unknown }
  const getContext = canvas.getContext
  canvas.getContext = function (this: unknown, ...rest: unknown[]): unknown {
    canvasWork.contexts++
    return getContext.apply(this, rest)
  }
}

async function main(): Promise<void> {
  const response = await fetch(`/api/plan?run=${encodeURIComponent(runId)}`)
  if (!response.ok) throw new Error(`/api/plan: ${response.status} ${await response.text()}`)
  const plan = await response.json() as RealismPlan
  const detected = detectEnvironment(givenFacts(engineOf(plan.browser), plan.engineBuild))
  if (detected.kind === 'unsupported') throw new Error(`Unsupported browser: ${detected.reason} (${detected.userAgent})`)
  const env = detected.env
  const paragraphs: Paragraph[][] = []
  const results: RealismSetResult[] = []
  for (let s = 0; s < plan.sets.length; s++) {
    const set = plan.sets[s]!
    paragraphs.push(paragraphsOf(plan, set.messages))
    results.push({ id: set.id, messages: set.messages.length, units: 0, scratchMs: [], lines: 0, measureTextCalls: 0, unitsSent: 0, contexts: 0, lineRangesHash: 0, byLabel: [] })
  }
  // Untimed, so every timed pass is of compiled code, as the bench's headline passes are after its timed rows.
  for (let s = 0; s < paragraphs.length; s++) for (let i = 0; i < Math.min(WARM_UP, paragraphs[s]!.length); i++) sink += scratch(paragraphs[s]![i]!, env, plan.width)
  spin()
  const spinStart = spin()
  for (let pass = 0; pass < plan.passes; pass++) {
    for (let turn = 0; turn < plan.sets.length; turn++) {
      const s = (turn + pass) % plan.sets.length
      document.title = `realism pass ${pass + 1}/${plan.passes} ${plan.sets[s]!.id}`
      const list = paragraphs[s]!
      let lines = 0
      const start = performance.now()
      for (let i = 0; i < list.length; i++) lines += scratch(list[i]!, env, plan.width)
      results[s]!.scratchMs.push(performance.now() - start)
      results[s]!.lines = lines
      sink += lines
      await yieldTask()
    }
  }
  const spinEnd = spin()
  if (plan.counts) wrapCanvas()
  for (let s = 0; s < plan.sets.length && plan.counts; s++) {
    document.title = `realism counting ${plan.sets[s]!.id}`
    const messages = plan.sets[s]!.messages
    const list = paragraphs[s]!
    const result = results[s]!
    rangeHash = 0x811c9dc5
    for (let i = 0; i < list.length; i++) {
      const before = { ...canvasWork }
      const start = performance.now()
      const lines = scratchCounted(list[i]!, env, plan.width)
      const ms = performance.now() - start
      const label = messages[i]!.label
      let entry = result.byLabel.find(item => item.label === label)
      if (entry === undefined) {
        entry = { label, messages: 0, units: 0, measureTextCalls: 0, unitsSent: 0, contexts: 0, lines: 0, ms: 0 }
        result.byLabel.push(entry)
      }
      entry.ms += ms
      let units = 0
      for (let k = 0; k < messages[i]!.parts.length; k++) units += messages[i]!.parts[k]!.text.length
      entry.messages++
      entry.units += units
      entry.measureTextCalls += canvasWork.measureTextCalls - before.measureTextCalls
      entry.unitsSent += canvasWork.unitsSent - before.unitsSent
      entry.contexts += canvasWork.contexts - before.contexts
      entry.lines += lines
      result.units += units
      result.measureTextCalls += canvasWork.measureTextCalls - before.measureTextCalls
      result.unitsSent += canvasWork.unitsSent - before.unitsSent
      result.contexts += canvasWork.contexts - before.contexts
    }
    results[s]!.lineRangesHash = rangeHash >>> 0
    await yieldTask()
  }
  const result: RealismResult = {
    runId, userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: window.crossOriginIsolated,
    visibility: document.visibilityState, hardwareConcurrency: navigator.hardwareConcurrency, spinMs: { start: spinStart, end: spinEnd }, sets: results,
  }
  const posted = await fetch('/api/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) })
  if (!posted.ok) throw new Error(`/api/result: ${posted.status}`)
  document.body.dataset['sink'] = String(sink)
  document.title = 'bench done'
}

function reportFatal(error: unknown): void {
  document.title = 'bench failed'
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  void fetch('/api/fatal', { method: 'POST', body: JSON.stringify({ runId, message: text }) })
}

window.addEventListener('error', event => reportFatal(event.error ?? event.message))
window.addEventListener('unhandledrejection', event => reportFatal(event.reason))
main().catch(reportFatal)
