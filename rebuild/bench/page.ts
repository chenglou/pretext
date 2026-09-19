// Browser side of the bench. run.ts serves this bundle inside a document whose <html lang> is the context's language. The
// page fetches its context's plan, times every row with the two libraries interleaved, posts each row, then counts
// measureText calls and Canvas contexts for every variant (the counting wrappers go on only after all timing in this
// document) and asks for the next context.
//
// Only fetch promises and MessageChannel tasks drive the loop (no timers), so background timer throttling can't stall it.
import { clearCache, layout, layoutWithLines, prepare as mainPrepare, prepareWithSegments } from '../../src/layout.ts'
import { clearMeasurementCaches } from '../../src/measurement.ts'
import { fontFactsFor } from '../lab/font-facts.ts'
import {
  detectEnvironment, fillLine, firstLine, inspectLine, linePieces, paragraphGaps, prepare, type EngineName, type Environment, type GivenFacts, type Prepared,
} from '../src/index.ts'
import type { FontDecl, Paragraph } from '../src/model.ts'
import type {
  BrowserKind, ContextDonePost, ContextPlan, Library, PageEnvironment, PageSnapshot, RowCount, RowPost, RowSpec, RowTiming,
  VariantCount, VariantResult,
} from './protocol.ts'
import { summarize } from './stats.ts'

type Variant = {
  name: string
  library: Library
  desc: string
  baseline: string | null
  // One repetition. Returns the lines it produced.
  run: () => number
}

const params = new URLSearchParams(location.search)
const runId = params.get('run') ?? ''
const contextIndex = Number(params.get('context') ?? '-1')

// Everything a repetition returns is summed here, so no engine can drop the work as unused.
let sink = 0

function message(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return await response.json() as T
}

function reportFatal(error: unknown): void {
  document.title = 'bench failed'
  void fetch('/api/fatal', { method: 'POST', body: JSON.stringify({ runId, message: message(error) }) })
}

// A macrotask boundary between sampling rounds, so the browser can run its own tasks (and idle-time collection) outside
// the timed regions. MessageChannel tasks aren't throttled in background windows.
const channel = new MessageChannel()
function yieldTask(): Promise<void> {
  return new Promise(resolve => {
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
}

function snapshot(): PageSnapshot {
  return {
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }
}

type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number } }

function heapBytes(): number | null {
  const memory = (performance as PerformanceWithMemory).memory
  return memory === undefined ? null : memory.usedJSHeapSize
}

// The smallest nonzero step between successive performance.now() readings, over at most 1,000 steps or 250 ms.
function timerResolution(): { ms: number; steps: number } {
  let last = performance.now()
  const deadline = last + 250
  let min = Number.POSITIVE_INFINITY
  let steps = 0
  while (steps < 1000) {
    const now = performance.now()
    if (now === last) continue
    min = Math.min(min, now - last)
    steps++
    last = now
    if (now > deadline) break
  }
  return { ms: min, steps }
}

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'firefox': return 'gecko'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
  }
}

// As rebuild/lab/predictor.ts: no Content-Language, page zoom 1, browser-process languages unknown.
function givenFacts(engine: EngineName, build: string): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build, contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build, contentLanguage: null, regionalPrefsLocale: null }
  }
}

// ---- The rebuild: one prepared paragraph, filled at any width (rebuild/src/index.ts) ----

// What a repetition reads of every line, from the least to the most. `count` fills the lines of a plain paragraph and
// reads nothing more, which is what a height takes; `pieces` also reads what a painter takes of each line; `inspect`
// prepares the paragraph for inspection and reads each line's geometry and gaps before its pieces, then the paragraph's
// gaps, which is the lab's path (rebuild/lab/predictor-core.ts).
type Mode = 'count' | 'pieces' | 'inspect'
const MODES: readonly Mode[] = ['count', 'pieces', 'inspect']

// Every line at `width`; returns the line boxes. `ranges` takes every line's source range.
function fillAll(prepared: Prepared, width: number, mode: Mode, ranges: number[] | null): number {
  let lineBoxes = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    switch (mode) {
      case 'count': break
      case 'pieces': sink += linePieces(prepared, filled.line).fragments.length; break
      case 'inspect':
        sink += inspectLine(prepared, filled.line).gaps.length
        sink += linePieces(prepared, filled.line).fragments.length
        break
    }
    if (ranges !== null) ranges.push(filled.start, filled.end)
    if (filled.hasLineBox) lineBoxes++
    start = filled.next
  }
  return lineBoxes
}

function prepareAndFill(paragraph: Paragraph, env: Environment, widths: readonly number[], mode: Mode, ranges: number[] | null): number {
  const prepared = prepare(paragraph, env, mode === 'inspect')
  let lineBoxes = 0
  for (let w = 0; w < widths.length; w++) lineBoxes += fillAll(prepared, widths[w]!, mode, ranges)
  if (mode === 'inspect') sink += paragraphGaps(prepared).length
  return lineBoxes
}

// ---- Variants ----

type Context = { plan: ContextPlan; env: Environment; font: FontDecl }

function paragraphOf(c: Context, text: string): Paragraph {
  const s = c.plan.style
  return {
    content: [{ kind: 'text', text }], font: c.font, letterSpacing: 0, wordSpacing: 0, lineHeight: s.lineHeight, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start',
  }
}

// What each of the rebuild's modes is compared with in the table: main's line count for `count`, main's materialized
// lines for `pieces` where a row has them, nothing for the lab's path.
function rebuildVariants(label: string, what: string, baselines: Record<Mode, string | null>, run: (mode: Mode) => number): Variant[] {
  const out: Variant[] = []
  for (let i = 0; i < MODES.length; i++) {
    const mode = MODES[i]!
    out.push({ name: `rebuild ${label}, ${mode}`, library: 'rebuild', baseline: baselines[mode], desc: `${what}; ${mode} mode`, run: () => run(mode) })
  }
  return out
}

function variantsFor(row: RowSpec, c: Context): Variant[] {
  const font = c.plan.style.mainFont
  const lineHeight = c.plan.style.lineHeight
  const env = c.env
  switch (row.kind) {
    case 'cold': {
      const text = row.text
      const width = row.width
      const paragraph = paragraphOf(c, text)
      const widths = [width]
      return [
        {
          name: 'main prepare+layout', library: 'main', baseline: null, desc: 'clearCache(); prepare(); layout()',
          run: () => {
            clearCache()
            return layout(mainPrepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepare+layout, segmenters kept', library: 'main', baseline: null,
          desc: 'clearMeasurementCaches(), which keeps the Intl.Segmenter objects clearCache() drops; prepare(); layout()',
          run: () => {
            clearMeasurementCaches()
            return layout(mainPrepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepareWithSegments+layoutWithLines', library: 'main', baseline: null, desc: 'clearCache(); prepareWithSegments(); layoutWithLines()',
          run: () => {
            clearCache()
            return layoutWithLines(prepareWithSegments(text, font), width, lineHeight).lines.length
          },
        },
        ...rebuildVariants('prepare+fill', 'prepare(), which makes new Canvas contexts, then every line', {
          count: 'main prepare+layout', pieces: 'main prepareWithSegments+layoutWithLines', inspect: null,
        }, mode => prepareAndFill(paragraph, env, widths, mode, null)),
      ]
    }
    case 'sweep': {
      const text = row.text
      const widths = row.widths
      const paragraph = paragraphOf(c, text)
      clearCache()
      const handle = mainPrepare(text, font)
      const prepared = prepare(paragraph, env, false)
      const n = widths.length
      return [
        {
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, desc: `clearCache(); prepare() once; layout() at ${n} widths`,
          run: () => {
            clearCache()
            const fresh = mainPrepare(text, font)
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(fresh, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        {
          name: `main layout×${n}`, library: 'main', baseline: null, desc: `layout() at ${n} widths on a handle prepared outside the timing`,
          run: () => {
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(handle, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        ...rebuildVariants(`prepare+fill×${n}`, `prepare() once, then every line at ${n} widths`, {
          count: `main prepare+layout×${n}`, pieces: null, inspect: null,
        }, mode => prepareAndFill(paragraph, env, widths, mode, null)),
        {
          name: `rebuild fill×${n}, count`, library: 'rebuild', baseline: `main layout×${n}`,
          desc: `every line at ${n} widths of a plain paragraph prepared outside the timing, which has met every width by the first sample`,
          run: () => {
            let lineBoxes = 0
            for (let i = 0; i < n; i++) lineBoxes += fillAll(prepared, widths[i]!, 'count', null)
            return lineBoxes
          },
        },
        {
          name: 'rebuild prepare', library: 'rebuild', baseline: null, desc: 'prepare() of a plain paragraph alone',
          run: () => {
            prepare(paragraph, env, false)
            return 0
          },
        },
      ]
    }
    case 'many': {
      const messages = row.messages
      const width = row.width
      const paragraphs: Paragraph[] = []
      for (let i = 0; i < messages.length; i++) paragraphs.push(paragraphOf(c, messages[i]!))
      const n = messages.length
      const widths = [width]
      return [
        {
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, desc: `clearCache() once; prepare() and layout() for each of ${n} messages`,
          run: () => {
            clearCache()
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(mainPrepare(messages[i]!, font), width, lineHeight).lineCount
            return lines
          },
        },
        ...rebuildVariants(`prepare+fill×${n}`, `prepare() and every line for each of ${n} messages; the library keeps nothing across paragraphs`, {
          count: `main prepare+layout×${n}`, pieces: null, inspect: null,
        }, mode => {
          let lineBoxes = 0
          for (let i = 0; i < n; i++) lineBoxes += prepareAndFill(paragraphs[i]!, env, widths, mode, null)
          return lineBoxes
        }),
      ]
    }
  }
}

// ---- Sampling ----

function runReps(variant: Variant, reps: number): number {
  const start = performance.now()
  for (let r = 0; r < reps; r++) sink += variant.run()
  return performance.now() - start
}

// Repetitions per sample: doubled, or scaled from the last elapsed time, until a sample spans minSampleMs.
function calibrate(variant: Variant, minSampleMs: number): number {
  let reps = 1
  for (;;) {
    const elapsed = runReps(variant, reps)
    if (elapsed >= minSampleMs || reps >= 1 << 24) return reps
    reps = elapsed > 0 ? Math.min(reps * 16, Math.max(reps * 2, Math.ceil(reps * 1.2 * minSampleMs / elapsed))) : reps * 16
  }
}

async function timeRow(row: RowSpec, rowIndex: number, c: Context, timerMs: number): Promise<RowTiming> {
  const settings = c.plan.settings
  const variants = variantsFor(row, c)
  const start = snapshot()
  const t0 = performance.now()
  // The first repetition of every variant, one library's variants first, alternating by row.
  const firstLibrary: Library = rowIndex % 2 === 0 ? 'main' : 'rebuild'
  const firstMs = new Map<string, number>()
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]!
      if ((variant.library === firstLibrary) !== (pass === 0)) continue
      firstMs.set(variant.name, runReps(variant, 1))
    }
  }
  const minSampleMs = Math.max(settings.minSampleMs, 20 * timerMs)
  const reps: number[] = []
  for (let i = 0; i < variants.length; i++) reps.push(calibrate(variants[i]!, minSampleMs))
  await yieldTask()
  // Warm-up rounds are discarded. Past the first, they stop once a quarter of the budget is spent.
  for (let round = 0; round < settings.warmup && (round === 0 || performance.now() - t0 < settings.budgetMs / 4); round++) {
    for (let i = 0; i < variants.length; i++) runReps(variants[i]!, reps[i]!)
    await yieldTask()
  }
  const samples: number[][] = variants.map(() => [])
  const drops: boolean[][] = variants.map(() => [])
  const heapApi = heapBytes() !== null
  for (let round = 0; round < settings.samples; round++) {
    if (round >= settings.minSamples && performance.now() - t0 > settings.budgetMs) break
    // Interleaved: forward order on even rounds, reverse on odd ones.
    for (let k = 0; k < variants.length; k++) {
      const i = round % 2 === 0 ? k : variants.length - 1 - k
      const before = heapBytes()
      const elapsed = runReps(variants[i]!, reps[i]!)
      const after = heapBytes()
      samples[i]!.push(elapsed / reps[i]!)
      if (before !== null && after !== null) drops[i]!.push(after < before)
    }
    await yieldTask()
  }
  const results: VariantResult[] = []
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!
    const heapDrops = heapApi ? drops[i]! : null
    results.push({
      variant: variant.name, library: variant.library, desc: variant.desc, baseline: variant.baseline, firstMs: firstMs.get(variant.name)!,
      samplesMs: samples[i]!, heapDrops, stats: summarize(samples[i]!, reps[i]!, heapDrops),
    })
  }
  let units = 0
  if (row.kind === 'many') for (let i = 0; i < row.messages.length; i++) units += row.messages[i]!.length
  else units = row.text.length
  return {
    id: row.id, kind: row.kind, size: row.kind === 'many' ? null : row.size, units, messages: row.kind === 'many' ? row.messages.length : null,
    widths: row.kind === 'sweep' ? row.widths : [row.width], firstLibrary, minSampleMs, elapsedMs: performance.now() - t0, start, end: snapshot(),
    variants: results,
  }
}

// ---- Counting ----

let measureTextCalls = 0
let contextsMade = 0

function countMeasureText(proto: { measureText(text: string): TextMetrics } | undefined): void {
  if (proto === undefined) return
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    measureTextCalls++
    return original.call(this, text)
  }
}

function countContexts(proto: { getContext: (...rest: never[]) => unknown } | undefined): void {
  if (proto === undefined) return
  const original = proto.getContext as (this: unknown, ...rest: unknown[]) => unknown
  ;(proto as { getContext: unknown }).getContext = function (this: unknown, ...rest: unknown[]): unknown {
    contextsMade++
    return original.apply(this, rest)
  }
}

// The rebuild's line ranges of the row in one mode: every paragraph, every width.
function rebuildRanges(row: RowSpec, c: Context, mode: Mode): number[] {
  const ranges: number[] = []
  switch (row.kind) {
    case 'cold': prepareAndFill(paragraphOf(c, row.text), c.env, [row.width], mode, ranges); break
    case 'sweep': prepareAndFill(paragraphOf(c, row.text), c.env, row.widths, mode, ranges); break
    case 'many':
      for (let i = 0; i < row.messages.length; i++) prepareAndFill(paragraphOf(c, row.messages[i]!), c.env, [row.width], mode, ranges)
      break
  }
  return ranges
}

function countRow(row: RowSpec, c: Context): RowCount {
  const variants = variantsFor(row, c)
  const counts: VariantCount[] = []
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!
    measureTextCalls = 0
    contextsMade = 0
    const lines = variant.run()
    counts.push({ variant: variant.name, measureTextCalls, contexts: contextsMade, lines })
    sink += lines
  }
  const counted = rebuildRanges(row, c, 'count')
  let same = true
  for (let m = 1; m < MODES.length && same; m++) {
    const ranges = rebuildRanges(row, c, MODES[m]!)
    same = ranges.length === counted.length && ranges.every((value, i) => value === counted[i])
  }
  return { id: row.id, variants: counts, rebuildModesSameLines: same }
}

// ---- Main ----

async function main(): Promise<void> {
  const planResponse = await fetch(`/api/plan?run=${encodeURIComponent(runId)}&context=${contextIndex}`)
  if (!planResponse.ok) throw new Error(`/api/plan: ${planResponse.status} ${await planResponse.text()}`)
  const plan = await planResponse.json() as ContextPlan
  if (document.documentElement.lang !== plan.style.lang) throw new Error(`Page lang ${document.documentElement.lang}; the plan needs ${plan.style.lang}`)
  const engine = engineOf(plan.browser)
  const detected = detectEnvironment(givenFacts(engine, plan.engineBuild))
  if (detected.kind === 'unsupported') throw new Error(`Unsupported browser: ${detected.reason} (${detected.userAgent})`)
  const c: Context = { plan, env: detected.env, font: { ...plan.style.font, facts: fontFactsFor(plan.style.font, engine, []) } }
  const timer = timerResolution()
  const environment: PageEnvironment = {
    userAgent: navigator.userAgent, pageLang: document.documentElement.lang, crossOriginIsolated: window.crossOriginIsolated,
    timerResolutionMs: timer.ms, timerSteps: timer.steps, heapApi: heapBytes() !== null, hardwareConcurrency: navigator.hardwareConcurrency,
    screen: { width: screen.width, height: screen.height },
  }
  for (let i = 0; i < plan.rows.length; i++) {
    const row = plan.rows[i]!
    document.title = `bench ${plan.index + 1}/${plan.count}: ${row.id}`
    const timing = await timeRow(row, i, c, timer.ms)
    await post<{ kind: 'ok' }>('/api/row', { runId, context: plan.index, row: timing } satisfies RowPost)
  }
  // Counting wrappers go on after every timed repetition in this document and stay until it unloads.
  countMeasureText(typeof OffscreenCanvasRenderingContext2D === 'undefined' ? undefined : OffscreenCanvasRenderingContext2D.prototype)
  countMeasureText(typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D.prototype)
  countContexts(typeof OffscreenCanvas === 'undefined' ? undefined : OffscreenCanvas.prototype)
  countContexts(typeof HTMLCanvasElement === 'undefined' ? undefined : HTMLCanvasElement.prototype)
  const counts: RowCount[] = []
  for (let i = 0; i < plan.rows.length; i++) counts.push(countRow(plan.rows[i]!, c))
  const reply = await post<{ kind: 'navigate'; url: string } | { kind: 'done' }>('/api/context-done', { runId, context: plan.index, environment, counts } satisfies ContextDonePost)
  if (reply.kind === 'navigate') {
    location.replace(reply.url)
    return
  }
  document.body.dataset['sink'] = String(sink)
  document.title = 'bench done'
}

window.addEventListener('error', event => reportFatal(event.error ?? event.message))
window.addEventListener('unhandledrejection', event => reportFatal(event.reason))
main().catch(reportFatal)
