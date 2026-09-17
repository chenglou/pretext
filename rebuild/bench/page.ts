// Browser side of the bench. run.ts serves this bundle inside a document whose <html lang> is the context's language. The
// page fetches its context's plan, times every row with the two libraries interleaved, posts each row, then counts
// measureText calls for every variant (the counting wrappers go on only after all timing in this document) and asks for
// the next context.
//
// Only fetch promises and MessageChannel tasks drive the loop (no timers), so background timer throttling can't stall it.
import { clearCache, layout, layoutWithLines, prepare, prepareWithSegments } from '../../src/layout.ts'
import { clearMeasurementCaches } from '../../src/measurement.ts'
import { fontFactsFor } from '../lab/font-facts.ts'
import { blinkEngine } from '../src/engines/blink/index.ts'
import type { EngineImplementation } from '../src/engines/engine.ts'
import { geckoEngine } from '../src/engines/gecko/index.ts'
import { webkitEngine } from '../src/engines/webkit/index.ts'
import { detectEnvironment, layoutParagraph, type EngineName, type Environment, type GivenFacts } from '../src/index.ts'
import { createMeasurer, type Measurer } from '../src/measure/canvas.ts'
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

// The rebuild's measure logs of the repetitions run while `trackLogs` is set (the counting pass only).
let trackLogs = false
const logTotals = { contexts: 0, calls: 0 }

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

// ---- The rebuild's engine loop, as rebuild/src/index.ts fillLines runs it, over several widths with one measurer ----

function prepareAndFill<Env, Prepared, Start, Geometry>(
  engine: EngineImplementation<Env, Prepared, Start, Geometry>, paragraph: Paragraph, env: Env, widths: readonly number[], measurer: Measurer,
  ranges: number[] | null,
): number {
  const prepared = engine.prepare(paragraph, env, measurer)
  let lines = 0
  for (let w = 0; w < widths.length; w++) {
    for (let start = engine.firstLine(prepared); start !== null;) {
      const line = engine.nextLine(prepared, start, widths[w]!, measurer)
      if (ranges !== null) ranges.push(line.start, line.end)
      lines++
      start = line.next
    }
  }
  engine.gaps(prepared)
  return lines
}

function internalPrepareAndFill(paragraph: Paragraph, env: Environment, widths: readonly number[], measurer: Measurer, ranges: number[] | null): number {
  switch (env.engine) {
    case 'blink': return prepareAndFill(blinkEngine, paragraph, env, widths, measurer, ranges)
    case 'webkit': return prepareAndFill(webkitEngine, paragraph, env, widths, measurer, ranges)
    case 'gecko': return prepareAndFill(geckoEngine, paragraph, env, widths, measurer, ranges)
  }
}

function internalPrepareOnly(paragraph: Paragraph, env: Environment, measurer: Measurer): void {
  switch (env.engine) {
    case 'blink': blinkEngine.prepare(paragraph, env, measurer); break
    case 'webkit': webkitEngine.prepare(paragraph, env, measurer); break
    case 'gecko': geckoEngine.prepare(paragraph, env, measurer); break
  }
}

function track(measurer: Measurer): void {
  if (!trackLogs) return
  logTotals.contexts += measurer.log.contexts.length
  logTotals.calls += measurer.log.calls.length
}

function rebuildLayout(paragraph: Paragraph, env: Environment, ranges: number[] | null): number {
  const result = layoutParagraph(paragraph, env)
  if (trackLogs) {
    logTotals.contexts += result.measure.contexts.length
    logTotals.calls += result.measure.calls.length
  }
  if (ranges !== null) {
    for (let i = 0; i < result.lines.length; i++) ranges.push(result.lines[i]!.start, result.lines[i]!.end)
  }
  return result.lines.length
}

// ---- Variants ----

type Context = { plan: ContextPlan; env: Environment; font: FontDecl }

function paragraphOf(c: Context, text: string, width: number): Paragraph {
  const s = c.plan.style
  return {
    runs: [{ text, node: 'text', font: c.font, letterSpacing: 0, wordSpacing: 0, lang: null }],
    font: c.font, letterSpacing: 0, wordSpacing: 0, width, lineHeight: s.lineHeight, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: s.direction, lang: s.lang,
  }
}

function variantsFor(row: RowSpec, c: Context): Variant[] {
  const font = c.plan.style.mainFont
  const lineHeight = c.plan.style.lineHeight
  const env = c.env
  switch (row.kind) {
    case 'cold': {
      const text = row.text
      const width = row.width
      const paragraph = paragraphOf(c, text, width)
      return [
        {
          name: 'main prepare+layout', library: 'main', baseline: null, desc: 'clearCache(); prepare(); layout()',
          run: () => {
            clearCache()
            return layout(prepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepare+layout, segmenters kept', library: 'main', baseline: null,
          desc: 'clearMeasurementCaches(), which keeps the Intl.Segmenter objects clearCache() drops; prepare(); layout()',
          run: () => {
            clearMeasurementCaches()
            return layout(prepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepareWithSegments+layoutWithLines', library: 'main', baseline: null, desc: 'clearCache(); prepareWithSegments(); layoutWithLines()',
          run: () => {
            clearCache()
            return layoutWithLines(prepareWithSegments(text, font), width, lineHeight).lines.length
          },
        },
        {
          name: 'rebuild layoutParagraph', library: 'rebuild', baseline: 'main prepare+layout', desc: 'layoutParagraph(), which creates a fresh measurer',
          run: () => rebuildLayout(paragraph, env, null),
        },
      ]
    }
    case 'sweep': {
      const text = row.text
      const widths = row.widths
      const paragraphs: Paragraph[] = []
      for (let i = 0; i < widths.length; i++) paragraphs.push(paragraphOf(c, text, widths[i]!))
      const base = paragraphs[0]!
      clearCache()
      const prepared = prepare(text, font)
      const n = widths.length
      return [
        {
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, desc: `clearCache(); prepare() once; layout() at ${n} widths`,
          run: () => {
            clearCache()
            const handle = prepare(text, font)
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(handle, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        {
          name: `main layout×${n}`, library: 'main', baseline: null, desc: `layout() at ${n} widths on a handle prepared outside the timing`,
          run: () => {
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(prepared, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        {
          name: `rebuild layoutParagraph×${n}`, library: 'rebuild', baseline: `main prepare+layout×${n}`,
          desc: `layoutParagraph() at ${n} widths, each with a fresh measurer (the public API has no reusable preparation)`,
          run: () => {
            let lines = 0
            for (let i = 0; i < n; i++) lines += rebuildLayout(paragraphs[i]!, env, null)
            return lines
          },
        },
        {
          name: `rebuild internal prepare+nextLine×${n}`, library: 'rebuild', baseline: `main prepare+layout×${n}`,
          desc: `engine prepare() once with a fresh measurer, then the firstLine/nextLine loop at ${n} widths with the same measurer`,
          run: () => {
            const measurer = createMeasurer()
            const lines = internalPrepareAndFill(base, env, widths, measurer, null)
            track(measurer)
            return lines
          },
        },
        {
          name: 'rebuild internal prepare', library: 'rebuild', baseline: null, desc: 'engine prepare() alone with a fresh measurer',
          run: () => {
            const measurer = createMeasurer()
            internalPrepareOnly(base, env, measurer)
            track(measurer)
            return 0
          },
        },
      ]
    }
    case 'many': {
      const messages = row.messages
      const width = row.width
      const paragraphs: Paragraph[] = []
      for (let i = 0; i < messages.length; i++) paragraphs.push(paragraphOf(c, messages[i]!, width))
      const n = messages.length
      const widths = [width]
      return [
        {
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, desc: `clearCache() once; prepare() and layout() for each of ${n} messages`,
          run: () => {
            clearCache()
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(prepare(messages[i]!, font), width, lineHeight).lineCount
            return lines
          },
        },
        {
          name: `rebuild layoutParagraph×${n}`, library: 'rebuild', baseline: `main prepare+layout×${n}`,
          desc: `layoutParagraph() for each of ${n} messages; the library keeps no measurement cache across calls`,
          run: () => {
            let lines = 0
            for (let i = 0; i < n; i++) lines += rebuildLayout(paragraphs[i]!, env, null)
            return lines
          },
        },
        {
          name: `rebuild internal shared measurer×${n}`, library: 'rebuild', baseline: `main prepare+layout×${n}`,
          desc: `experiment: engine prepare() and the nextLine loop for each of ${n} messages with one measurer, so Canvas contexts and the memo carry across messages; the count pass checks its lines against layoutParagraph()`,
          run: () => {
            const measurer = createMeasurer()
            let lines = 0
            for (let i = 0; i < n; i++) lines += internalPrepareAndFill(paragraphs[i]!, env, widths, measurer, null)
            track(measurer)
            return lines
          },
        },
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

function countMeasureText(proto: { measureText(text: string): TextMetrics } | undefined): void {
  if (proto === undefined) return
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    measureTextCalls++
    return original.call(this, text)
  }
}

function countRow(row: RowSpec, c: Context): RowCount {
  const variants = variantsFor(row, c)
  const counts: VariantCount[] = []
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!
    measureTextCalls = 0
    logTotals.contexts = 0
    logTotals.calls = 0
    trackLogs = true
    const lines = variant.run()
    trackLogs = false
    const rebuild = variant.library === 'rebuild'
    counts.push({ variant: variant.name, measureTextCalls, logContexts: rebuild ? logTotals.contexts : null, logCalls: rebuild ? logTotals.calls : null, lines })
    sink += lines
  }
  let same: boolean | null = null
  if (row.kind === 'many') {
    const publicRanges: number[] = []
    const sharedRanges: number[] = []
    const measurer = createMeasurer()
    for (let i = 0; i < row.messages.length; i++) {
      const paragraph = paragraphOf(c, row.messages[i]!, row.width)
      rebuildLayout(paragraph, c.env, publicRanges)
      internalPrepareAndFill(paragraph, c.env, [row.width], measurer, sharedRanges)
    }
    same = publicRanges.length === sharedRanges.length && publicRanges.every((value, i) => value === sharedRanges[i])
  }
  return { id: row.id, variants: counts, sharedMeasurerSameLines: same }
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
