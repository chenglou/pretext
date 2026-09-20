// Browser side of the store prototype's measurements (realism-run.ts --page=store): what a page with one list of Canvas
// contexts asks of Canvas, with whatever the tree's measure/canvas.ts keeps on a context. The same page runs on the tree
// without the store and on the tree with it, so the two are held against each other by their results.
// Timed part (plan.passes > 0): every set from scratch in count mode, one list a pass, the sets taking turns, after an
// untimed warm-up; then, once a set, every message prepared, filled at the plan's width and kept, and then filled at
// the three other widths twice (page.ts's resize case).
// Counting part (plan.counts): measureText and getContext wrapped, every set once more from scratch with one list, the
// calls that reach Canvas counted up to each checkpoint, then the kept paragraphs' two resizes, every line's source range
// hashed. The wrapper also plays a store of each size in STORE_BOUNDS over the questions it sees, keyed per context
// object, which is exact on the tree without the store (there every question reaches Canvas) and says what another bound
// would let through. It keys `'|' + text`, never the text: in Chrome a keyed use of the text itself changes the storage
// of a forced slice before Canvas sees it (measure/canvas.ts).
import { detectEnvironment, fillLine, firstLine, prepare, type Context, type EngineName, type Environment, type GivenFacts, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'
import type { BrowserKind } from './protocol.ts'
import type { RealismMessage, RealismPlan } from './realism-page.ts'

const RESIZE_WIDTHS = [260, 380, 440]
const CHECKPOINTS = [100, 1000, 9000, 10000]
// 0 is a store without a bound.
const STORE_BOUNDS = [0, 262144, 65536, 32768, 16384, 4096]

// Calls that reached Canvas and the UTF-16 units they sent, and what a played store of each bound would have let through.
type Work = { calls: number; units: number; played: number[] }

export type StoreSetResult = {
  id: string
  messages: number
  scratchMs: number[]
  // Once a run: prepare and fill at the plan's width, all kept; the three other widths; the three other widths again.
  keepMs: number
  resizeMs: number
  resizeAgainMs: number
  lines: number
  // Counting part. `upTo[i]` is the work of the messages before CHECKPOINTS[i], cumulative.
  upTo: Work[]
  scratch: Work
  resize: Work
  resizeAgain: Work
  contexts: number
  contextsHeld: number
  scratchRangesHash: number
  resizeRangesHash: number
  // What the list's contexts hold at the end of the counting part, where the tree's contexts hold anything.
  stored: { widths: number; inkBoxes: number; units: number; unitsAboveLatin1: number; largestContext: number }
}

export type StoreResult = {
  runId: string
  userAgent: string
  devicePixelRatio: number
  crossOriginIsolated: boolean
  visibility: string
  hardwareConcurrency: number
  spinMs: { start: number; end: number }
  bounds: number[]
  checkpoints: number[]
  sets: StoreSetResult[]
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

// realism-page.ts paragraphsOf: a message as the rebuild takes it, no font facts supplied.
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

let rangeHash = 0x811c9dc5
// Every line of a prepared paragraph at a width; returns its line boxes and hashes every line's source range.
function fill(prepared: Prepared, width: number): number {
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

const work: Work = { calls: 0, units: 0, played: STORE_BOUNDS.map(() => 0) }
let contextsMade = 0
let playedStores = new Map<object, Map<string, true>[]>()

function wrapCanvas(): void {
  const context = OffscreenCanvasRenderingContext2D.prototype
  const measureText = context.measureText
  context.measureText = function (this: OffscreenCanvasRenderingContext2D, text: string): TextMetrics {
    work.calls++
    work.units += text.length
    let stores = playedStores.get(this)
    if (stores === undefined) {
      stores = STORE_BOUNDS.map(() => new Map<string, true>())
      playedStores.set(this, stores)
    }
    const key = '|' + text
    for (let b = 0; b < STORE_BOUNDS.length; b++) {
      const store = stores[b]!
      if (store.has(key)) continue
      if (STORE_BOUNDS[b]! !== 0 && store.size >= STORE_BOUNDS[b]!) store.clear()
      store.set(key, true)
      work.played[b]!++
    }
    return measureText.call(this, text)
  }
  const canvas = OffscreenCanvas.prototype as unknown as { getContext: (this: unknown, ...rest: unknown[]) => unknown }
  const getContext = canvas.getContext
  canvas.getContext = function (this: unknown, ...rest: unknown[]): unknown {
    contextsMade++
    return getContext.apply(this, rest)
  }
}

function workNow(): Work {
  return { calls: work.calls, units: work.units, played: [...work.played] }
}

function workSince(before: Work): Work {
  return { calls: work.calls - before.calls, units: work.units - before.units, played: work.played.map((n, b) => n - before.played[b]!) }
}

type StoringContext = Context & { widths?: Map<string, number>; inkBoxes?: Map<string, unknown> }

function storedIn(contexts: Context[]): StoreSetResult['stored'] {
  const stored = { widths: 0, inkBoxes: 0, units: 0, unitsAboveLatin1: 0, largestContext: 0 }
  for (let i = 0; i < contexts.length; i++) {
    const context = contexts[i]! as StoringContext
    if (context.widths === undefined || context.inkBoxes === undefined) continue
    stored.widths += context.widths.size
    stored.inkBoxes += context.inkBoxes.size
    stored.largestContext = Math.max(stored.largestContext, context.widths.size + context.inkBoxes.size)
    const maps: Map<string, unknown>[] = [context.widths, context.inkBoxes]
    for (let m = 0; m < maps.length; m++) {
      for (const key of maps[m]!.keys()) {
        let above = false
        for (let u = 0; u < key.length && !above; u++) above = key.charCodeAt(u) > 0xff
        if (above) stored.unitsAboveLatin1 += key.length
        else stored.units += key.length
      }
    }
  }
  return stored
}

async function main(): Promise<void> {
  const response = await fetch(`/api/plan?run=${encodeURIComponent(runId)}`)
  if (!response.ok) throw new Error(`/api/plan: ${response.status} ${await response.text()}`)
  const plan = await response.json() as RealismPlan
  const detected = detectEnvironment(givenFacts(engineOf(plan.browser), plan.engineBuild))
  if (detected.kind === 'unsupported') throw new Error(`Unsupported browser: ${detected.reason} (${detected.userAgent})`)
  const env: Environment = detected.env
  const paragraphs: Paragraph[][] = []
  const results: StoreSetResult[] = []
  for (let s = 0; s < plan.sets.length; s++) {
    const set = plan.sets[s]!
    paragraphs.push(paragraphsOf(plan, set.messages))
    const none: Work = { calls: 0, units: 0, played: [] }
    results.push({
      id: set.id, messages: set.messages.length, scratchMs: [], keepMs: 0, resizeMs: 0, resizeAgainMs: 0, lines: 0, upTo: [], scratch: none, resize: none, resizeAgain: none,
      contexts: 0, contextsHeld: 0, scratchRangesHash: 0, resizeRangesHash: 0, stored: { widths: 0, inkBoxes: 0, units: 0, unitsAboveLatin1: 0, largestContext: 0 },
    })
  }
  let spinStart = 0
  let spinEnd = 0
  if (plan.passes > 0) {
    for (let s = 0; s < paragraphs.length; s++) {
      const contexts: Context[] = []
      for (let i = 0; i < Math.min(500, paragraphs[s]!.length); i++) sink += fill(prepare(paragraphs[s]![i]!, env, false, contexts), plan.width)
    }
    spin()
    spinStart = spin()
    for (let pass = 0; pass < plan.passes; pass++) {
      for (let turn = 0; turn < plan.sets.length; turn++) {
        const s = (turn + pass) % plan.sets.length
        document.title = `store pass ${pass + 1}/${plan.passes} ${plan.sets[s]!.id}`
        const list = paragraphs[s]!
        const contexts: Context[] = []
        let lines = 0
        const start = performance.now()
        for (let i = 0; i < list.length; i++) lines += fill(prepare(list[i]!, env, false, contexts), plan.width)
        results[s]!.scratchMs.push(performance.now() - start)
        results[s]!.lines = lines
        sink += lines
        await yieldTask()
      }
    }
    for (let s = 0; s < plan.sets.length; s++) {
      document.title = `store kept ${plan.sets[s]!.id}`
      const list = paragraphs[s]!
      const contexts: Context[] = []
      const kept: Prepared[] = []
      let start = performance.now()
      for (let i = 0; i < list.length; i++) {
        const prepared = prepare(list[i]!, env, false, contexts)
        sink += fill(prepared, plan.width)
        kept.push(prepared)
      }
      results[s]!.keepMs = performance.now() - start
      await yieldTask()
      start = performance.now()
      for (let w = 0; w < RESIZE_WIDTHS.length; w++) for (let i = 0; i < kept.length; i++) sink += fill(kept[i]!, RESIZE_WIDTHS[w]!)
      results[s]!.resizeMs = performance.now() - start
      await yieldTask()
      start = performance.now()
      for (let w = 0; w < RESIZE_WIDTHS.length; w++) for (let i = 0; i < kept.length; i++) sink += fill(kept[i]!, RESIZE_WIDTHS[w]!)
      results[s]!.resizeAgainMs = performance.now() - start
      await yieldTask()
    }
    spinEnd = spin()
  }
  if (plan.counts) {
    wrapCanvas()
    for (let s = 0; s < plan.sets.length; s++) {
      document.title = `store counting ${plan.sets[s]!.id}`
      const list = paragraphs[s]!
      const result = results[s]!
      const contexts: Context[] = []
      const kept: Prepared[] = []
      playedStores = new Map()
      const before = workNow()
      const contextsBefore = contextsMade
      rangeHash = 0x811c9dc5
      let lines = 0
      for (let i = 0, next = 0; i < list.length; i++) {
        if (next < CHECKPOINTS.length && i === CHECKPOINTS[next]!) {
          result.upTo.push(workSince(before))
          next++
        }
        const prepared = prepare(list[i]!, env, false, contexts)
        lines += fill(prepared, plan.width)
        kept.push(prepared)
      }
      result.upTo.push(workSince(before))
      result.scratch = workSince(before)
      result.lines = lines
      result.contexts = contextsMade - contextsBefore
      result.scratchRangesHash = rangeHash >>> 0
      await yieldTask()
      rangeHash = 0x811c9dc5
      const beforeResize = workNow()
      for (let w = 0; w < RESIZE_WIDTHS.length; w++) for (let i = 0; i < kept.length; i++) sink += fill(kept[i]!, RESIZE_WIDTHS[w]!)
      result.resize = workSince(beforeResize)
      result.resizeRangesHash = rangeHash >>> 0
      await yieldTask()
      const beforeAgain = workNow()
      for (let w = 0; w < RESIZE_WIDTHS.length; w++) for (let i = 0; i < kept.length; i++) sink += fill(kept[i]!, RESIZE_WIDTHS[w]!)
      result.resizeAgain = workSince(beforeAgain)
      result.contextsHeld = contexts.length
      result.stored = storedIn(contexts)
      await yieldTask()
    }
  }
  const result: StoreResult = {
    runId, userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: window.crossOriginIsolated,
    visibility: document.visibilityState, hardwareConcurrency: navigator.hardwareConcurrency, spinMs: { start: spinStart, end: spinEnd },
    bounds: STORE_BOUNDS, checkpoints: CHECKPOINTS, sets: results,
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
