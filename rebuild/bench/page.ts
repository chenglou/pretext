// Browser side of the bench. run.ts serves this bundle inside a document whose <html lang> is the context's language. The
// page fetches its context's plan, times every row with the two libraries interleaved, posts each row, runs the chat
// context's headline passes, then counts measureText calls and Canvas contexts for every variant and splits the rebuild's
// from-scratch time by phase, and asks for the next context. The counting and timing wrappers go on only after the timed
// rows and passes of the document, and come off before the one timed part that runs after them (chatHeadlineResize).
//
// Only fetch promises and MessageChannel tasks drive the loop (no timers), so background timer throttling can't stall it.
import { clearCache, layout, layoutWithLines, prepare as mainPrepare, prepareWithSegments, type PreparedText } from '../../src/layout.ts'
import { clearMeasurementCaches } from '../../src/measurement.ts'
import { measureRichInlineStats, prepareRichInline, type PreparedRichInline, type RichInlineItem } from '../../src/rich-inline.ts'
import { fontFactsFor } from '../lab/font-facts.ts'
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import { geckoFontChecks } from '../src/engines/gecko/checks.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { webkitFontChecks } from '../src/engines/webkit/checks.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import {
  detectEnvironment, fillLine, firstLine, inspectLine, linePieces, paragraphGaps, prepare, type EngineName, type Environment, type GivenFacts, type Prepared,
} from '../src/index.ts'
import type { Context as CanvasContext } from '../src/measure/canvas.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'
import type {
  BrowserKind, ChatHeadline, ChatHeadlineResize, ChatKind, ChatMessage, ChatPhases, ChatPlan, ChatPost, ContextDonePost, ContextPlan, CountsPost, Kept, Library,
  PageEnvironment, PageSnapshot, PhaseTotals, RowCount, RowPost, RowSpec, RowTiming, VariantCount, VariantResult,
} from './protocol.ts'
import { median, summarize } from './stats.ts'

type Variant = {
  name: string
  library: Library
  desc: string
  baseline: string | null
  // Paragraph layouts one repetition makes, where the report divides by them, else null (protocol.ts VariantResult).
  layouts: number | null
  // Runs before every repetition, outside its timing; null where a repetition needs nothing made for it.
  setup: (() => void) | null
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

// A fixed piece of integer arithmetic, in ms (protocol.ts PageEnvironment.spinMs).
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
const KEPT: readonly Kept[] = ['both', 'checks', 'contexts']

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
function rebuildVariants(label: string, what: string, baselines: Record<Mode, string | null>, layouts: number | null, run: (mode: Mode) => number): Variant[] {
  const out: Variant[] = []
  for (let i = 0; i < MODES.length; i++) {
    const mode = MODES[i]!
    out.push({ name: `rebuild ${label}, ${mode}`, library: 'rebuild', baseline: baselines[mode], layouts, setup: null, desc: `${what}; ${mode} mode`, run: () => run(mode) })
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
          name: 'main prepare+layout', library: 'main', baseline: null, layouts: null, setup: null, desc: 'clearCache(); prepare(); layout()',
          run: () => {
            clearCache()
            return layout(mainPrepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepare+layout, segmenters kept', library: 'main', baseline: null, layouts: null, setup: null,
          desc: 'clearMeasurementCaches(), which keeps the Intl.Segmenter objects clearCache() drops; prepare(); layout()',
          run: () => {
            clearMeasurementCaches()
            return layout(mainPrepare(text, font), width, lineHeight).lineCount
          },
        },
        {
          name: 'main prepareWithSegments+layoutWithLines', library: 'main', baseline: null, layouts: null, setup: null, desc: 'clearCache(); prepareWithSegments(); layoutWithLines()',
          run: () => {
            clearCache()
            return layoutWithLines(prepareWithSegments(text, font), width, lineHeight).lines.length
          },
        },
        ...rebuildVariants('prepare+fill', 'prepare(), which makes new Canvas contexts, then every line', {
          count: 'main prepare+layout', pieces: 'main prepareWithSegments+layoutWithLines', inspect: null,
        }, null, mode => prepareAndFill(paragraph, env, widths, mode, null)),
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
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, layouts: null, setup: null, desc: `clearCache(); prepare() once; layout() at ${n} widths`,
          run: () => {
            clearCache()
            const fresh = mainPrepare(text, font)
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(fresh, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        {
          name: `main layout×${n}`, library: 'main', baseline: null, layouts: null, setup: null, desc: `layout() at ${n} widths on a handle prepared outside the timing`,
          run: () => {
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(handle, widths[i]!, lineHeight).lineCount
            return lines
          },
        },
        ...rebuildVariants(`prepare+fill×${n}`, `prepare() once, then every line at ${n} widths`, {
          count: `main prepare+layout×${n}`, pieces: null, inspect: null,
        }, null, mode => prepareAndFill(paragraph, env, widths, mode, null)),
        {
          name: `rebuild fill×${n}, count`, library: 'rebuild', baseline: `main layout×${n}`, layouts: null, setup: null,
          desc: `every line at ${n} widths of a plain paragraph prepared outside the timing, which has met every width by the first sample`,
          run: () => {
            let lineBoxes = 0
            for (let i = 0; i < n; i++) lineBoxes += fillAll(prepared, widths[i]!, 'count', null)
            return lineBoxes
          },
        },
        {
          name: 'rebuild prepare', library: 'rebuild', baseline: null, layouts: null, setup: null, desc: 'prepare() of a plain paragraph alone',
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
          name: `main prepare+layout×${n}`, library: 'main', baseline: null, layouts: null, setup: null, desc: `clearCache() once; prepare() and layout() for each of ${n} messages`,
          run: () => {
            clearCache()
            let lines = 0
            for (let i = 0; i < n; i++) lines += layout(mainPrepare(messages[i]!, font), width, lineHeight).lineCount
            return lines
          },
        },
        ...rebuildVariants(`prepare+fill×${n}`, `prepare() and every line for each of ${n} messages; the library keeps nothing across paragraphs`, {
          count: `main prepare+layout×${n}`, pieces: null, inspect: null,
        }, null, mode => {
          let lineBoxes = 0
          for (let i = 0; i < n; i++) lineBoxes += prepareAndFill(paragraphs[i]!, env, widths, mode, null)
          return lineBoxes
        }),
      ]
    }
    case 'chat': return chatVariants(c, chatInputs(c, row.set, c.plan.chat!.timed))
  }
}

// ---- Chat (README.md, "Chat") ----

// index.ts prepare() in its two halves, so the bench can time them apart and run the second alone: the runtime font checks
// (measure/font-checks.ts), then the engine's own prepare on the paragraph with the facts Canvas answered.
function withFontChecks(paragraph: Paragraph, env: Environment, contexts: CanvasContext[]): Paragraph {
  switch (env.engine) {
    case 'blink': return withLearnedFontFacts(paragraph, blinkFontChecks(env), contexts)
    case 'webkit': return withLearnedFontFacts(paragraph, webkitFontChecks, contexts)
    case 'gecko': return withLearnedFontFacts(paragraph, geckoFontChecks, contexts)
  }
}

function prepareChecked(checked: Paragraph, env: Environment, inspect: boolean, contexts: CanvasContext[]): Prepared {
  switch (env.engine) {
    case 'blink': return { engine: 'blink', state: blink.prepare(checked, env, inspect, contexts) }
    case 'webkit': return { engine: 'webkit', state: webkit.prepare(checked, env, inspect, contexts) }
    case 'gecko': return { engine: 'gecko', state: gecko.prepare(checked, env, inspect, contexts) }
  }
}

// prepare() with a page's list of contexts for both of its halves, which is prepare() handed the list, or for one half
// while the other gets a call's own list, as both do in a prepare() that is given none (protocol.ts Kept).
function prepareKeeping(paragraph: Paragraph, env: Environment, kept: Kept, page: CanvasContext[]): Prepared {
  switch (kept) {
    case 'both': return prepare(paragraph, env, false, page)
    case 'checks': return prepareChecked(withFontChecks(paragraph, env, page), env, false, [])
    case 'contexts': return prepareChecked(withFontChecks(paragraph, env, []), env, false, page)
  }
}

// A message as main takes it: a plain message is a string for prepare(), a message with a code span is the items of the
// rich-inline helper, the span's padding as extraWidth.
type MainInput = { rich: false; text: string } | { rich: true; items: RichInlineItem[] }
type MainHandle = { rich: false; prepared: PreparedText } | { rich: true; prepared: PreparedRichInline }

// The first `count` messages of a set as both libraries take them, built outside every timing. No font facts are
// supplied: every declaration carries UNKNOWN_FONT_FACTS, so the rebuild's prepare() asks Canvas what it can.
type ChatInputs = { chat: ChatPlan; kinds: ChatKind[]; units: number[]; paragraphs: Paragraph[]; main: MainInput[] }

function chatInputs(c: Context, setId: string, count: number): ChatInputs {
  const chat = c.plan.chat!
  const messages: ChatMessage[] = chat.sets.find(set => set.id === setId)!.messages
  const s = c.plan.style
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { ...chat.codeFont, facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: chat.codePadding }
  const inputs: ChatInputs = { chat, kinds: [], units: [], paragraphs: [], main: [] }
  for (let i = 0; i < count; i++) {
    const parts = messages[i]!.parts
    const content: InlineNode[] = []
    const items: RichInlineItem[] = []
    let whole = ''
    let rich = false
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k]!
      whole += part.text
      if (part.code) {
        rich = true
        content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
        items.push({ text: part.text, font: chat.codeMainFont, extraWidth: 2 * chat.codePadding })
      } else {
        content.push({ kind: 'text', text: part.text })
        items.push({ text: part.text, font: s.mainFont })
      }
    }
    inputs.kinds.push(messages[i]!.kind)
    inputs.units.push(whole.length)
    inputs.paragraphs.push({ ...text, font, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' })
    inputs.main.push(rich ? { rich: true, items } : { rich: false, text: whole })
  }
  return inputs
}

function mainPrepareChat(input: MainInput, font: string): MainHandle {
  return input.rich ? { rich: true, prepared: prepareRichInline(input.items) } : { rich: false, prepared: mainPrepare(input.text, font) }
}

function mainLinesChat(handle: MainHandle, width: number, lineHeight: number): number {
  return handle.rich ? measureRichInlineStats(handle.prepared, width).lineCount : layout(handle.prepared, width, lineHeight).lineCount
}

// main's cold batch, as pages/benchmark.ts times it: clearCache() once, then every message, so main's caches fill across
// the batch.
function mainColdChat(inputs: ChatInputs, font: string, lineHeight: number): number {
  clearCache()
  let lines = 0
  for (let i = 0; i < inputs.main.length; i++) lines += mainLinesChat(mainPrepareChat(inputs.main[i]!, font), inputs.chat.width, lineHeight)
  return lines
}

function scratchChat(inputs: ChatInputs, env: Environment, mode: Mode): number {
  const widths = [inputs.chat.width]
  let lineBoxes = 0
  for (let i = 0; i < inputs.paragraphs.length; i++) lineBoxes += prepareAndFill(inputs.paragraphs[i]!, env, widths, mode, null)
  return lineBoxes
}

// The same in count mode with a list of contexts started here, as a page that lays its messages out from nothing starts
// one first: the contexts are paid for once inside the timing, and nothing of an earlier repetition is left.
function scratchChatKeeping(inputs: ChatInputs, env: Environment, kept: Kept): number {
  const page: CanvasContext[] = []
  let lineBoxes = 0
  for (let i = 0; i < inputs.paragraphs.length; i++) lineBoxes += fillAll(prepareKeeping(inputs.paragraphs[i]!, env, kept, page), inputs.chat.width, 'count', null)
  return lineBoxes
}

// Every message prepared plain and filled at the first width, all of them kept: what an app holds before a resize. With
// `page`, every message is prepared with that one list of contexts; without, each with its own.
function prepareAllChat(inputs: ChatInputs, env: Environment, page: CanvasContext[] | undefined): Prepared[] {
  const prepared: Prepared[] = []
  for (let i = 0; i < inputs.paragraphs.length; i++) {
    prepared.push(prepare(inputs.paragraphs[i]!, env, false, page))
    sink += fillAll(prepared[i]!, inputs.chat.width, 'count', null)
  }
  return prepared
}

function resizeChat(prepared: readonly Prepared[], widths: readonly number[]): number {
  let lineBoxes = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lineBoxes += fillAll(prepared[i]!, widths[w]!, 'count', null)
  return lineBoxes
}

function chatVariants(c: Context, inputs: ChatInputs): Variant[] {
  const env = c.env
  const font = c.plan.style.mainFont
  const lineHeight = c.plan.style.lineHeight
  const n = inputs.paragraphs.length
  const width = inputs.chat.width
  const resizeWidths = inputs.chat.resizeWidths
  const w = resizeWidths.length
  clearCache()
  const handles: MainHandle[] = []
  for (let i = 0; i < n; i++) handles.push(mainPrepareChat(inputs.main[i]!, font))
  // The font checks run here, once a paragraph, outside every timing.
  const checked: Paragraph[] = []
  for (let i = 0; i < n; i++) checked.push(withFontChecks(inputs.paragraphs[i]!, env, []))
  let fresh: Prepared[] = []
  const met = prepareAllChat(inputs, env, undefined)
  sink += resizeChat(met, resizeWidths)
  const metKeeping = prepareAllChat(inputs, env, [])
  sink += resizeChat(metKeeping, resizeWidths)
  const keeping = (kept: Kept, what: string): Variant => ({
    name: `rebuild scratch, count, page keeps ${kept}`, library: 'rebuild', baseline: 'rebuild scratch, count', layouts: n, setup: null,
    desc: `the same in count mode with one list of contexts for the ${n} messages, started inside the timing: ${what}`,
    run: () => scratchChatKeeping(inputs, env, kept),
  })
  return [
    {
      name: 'main cold', library: 'main', baseline: null, layouts: n, setup: null,
      desc: `clearCache() once; for each of ${n} messages prepare() and layout() at ${width}px, or prepareRichInline() and measureRichInlineStats() where the message has a code span`,
      run: () => mainColdChat(inputs, font, lineHeight),
    },
    {
      name: `main resize×${w}`, library: 'main', baseline: null, layouts: n * w, setup: null,
      desc: `layout() or measureRichInlineStats() at ${resizeWidths.join(', ')}px on handles prepared outside the timing`,
      run: () => {
        let lines = 0
        for (let k = 0; k < w; k++) for (let i = 0; i < n; i++) lines += mainLinesChat(handles[i]!, resizeWidths[k]!, lineHeight)
        return lines
      },
    },
    ...rebuildVariants('scratch', `for each of ${n} messages prepare(), with its font checks and new Canvas contexts, then every line at ${width}px; nothing kept across messages`, {
      count: 'main cold', pieces: null, inspect: null,
    }, n, mode => scratchChat(inputs, env, mode)),
    {
      name: 'rebuild scratch, count, checks lifted', library: 'rebuild', baseline: 'rebuild scratch, count', layouts: n, setup: null,
      desc: 'the same, on paragraphs whose font facts were asked of Canvas outside the timing: the engine\'s prepare() alone, then every line; count mode',
      run: () => {
        let lineBoxes = 0
        for (let i = 0; i < n; i++) lineBoxes += fillAll(prepareChecked(checked[i]!, env, false, []), width, 'count', null)
        return lineBoxes
      },
    },
    keeping('both', 'prepare() is handed it, so a context is made once per settings; the font checks ask Canvas again for every message'),
    keeping('checks', 'the font checks\' contexts alone come from it, and the engine makes every paragraph\'s contexts anew'),
    keeping('contexts', 'the engine\'s contexts alone come from it, and the font checks make theirs anew for every paragraph'),
    {
      name: `rebuild first resize×${w}, count`, library: 'rebuild', baseline: `main resize×${w}`, layouts: n * w,
      desc: `every line at ${resizeWidths.join(', ')}px of plain paragraphs that were prepared and filled at ${width}px before each repetition, outside its timing, so every width is new to them`,
      setup: () => { fresh = prepareAllChat(inputs, env, undefined) },
      run: () => resizeChat(fresh, resizeWidths),
    },
    {
      name: `rebuild first resize×${w}, count, page keeps both`, library: 'rebuild', baseline: `rebuild first resize×${w}, count`, layouts: n * w,
      desc: 'the same on paragraphs prepared with one list of contexts, so the messages share their Canvas contexts',
      setup: () => { fresh = prepareAllChat(inputs, env, []) },
      run: () => resizeChat(fresh, resizeWidths),
    },
    {
      name: `rebuild resize×${w} again, count`, library: 'rebuild', baseline: `main resize×${w}`, layouts: n * w, setup: null,
      desc: `every line at ${resizeWidths.join(', ')}px of plain paragraphs prepared once outside the timing that have been filled at every one of these widths before`,
      run: () => resizeChat(met, resizeWidths),
    },
    {
      name: `rebuild resize×${w} again, count, page keeps both`, library: 'rebuild', baseline: `rebuild resize×${w} again, count`, layouts: n * w, setup: null,
      desc: 'the same on paragraphs prepared with one list of contexts, so the messages share their Canvas contexts',
      run: () => resizeChat(metKeeping, resizeWidths),
    },
  ]
}

// ---- Sampling ----

function runReps(variant: Variant, reps: number): number {
  if (variant.setup === null) {
    const start = performance.now()
    for (let r = 0; r < reps; r++) sink += variant.run()
    return performance.now() - start
  }
  let elapsed = 0
  for (let r = 0; r < reps; r++) {
    variant.setup()
    const start = performance.now()
    sink += variant.run()
    elapsed += performance.now() - start
  }
  return elapsed
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
      variant: variant.name, library: variant.library, desc: variant.desc, baseline: variant.baseline, layouts: variant.layouts, firstMs: firstMs.get(variant.name)!,
      samplesMs: samples[i]!, heapDrops, stats: summarize(samples[i]!, reps[i]!, heapDrops),
    })
  }
  let units = 0
  let messages: number | null = null
  let widths: number[]
  switch (row.kind) {
    case 'cold': units = row.text.length; widths = [row.width]; break
    case 'sweep': units = row.text.length; widths = row.widths; break
    case 'many':
      for (let i = 0; i < row.messages.length; i++) units += row.messages[i]!.length
      messages = row.messages.length
      widths = [row.width]
      break
    case 'chat': {
      const chat = c.plan.chat!
      const set = chat.sets.find(entry => entry.id === row.set)!.messages
      for (let i = 0; i < chat.timed; i++) for (let k = 0; k < set[i]!.parts.length; k++) units += set[i]!.parts[k]!.text.length
      messages = chat.timed
      widths = [chat.width, ...chat.resizeWidths]
      break
    }
  }
  return {
    id: row.id, kind: row.kind, size: row.kind === 'cold' || row.kind === 'sweep' ? row.size : null, units, messages, widths, firstLibrary, minSampleMs,
    elapsedMs: performance.now() - t0, start, end: snapshot(), variants: results,
  }
}

// ---- Headline: the whole chat set, once a pass (protocol.ts ChatHeadline) ----

async function chatHeadline(c: Context, chat: ChatPlan): Promise<void> {
  const font = c.plan.style.mainFont
  const lineHeight = c.plan.style.lineHeight
  for (let s = 0; s < chat.sets.length; s++) {
    const inputs = chatInputs(c, chat.sets[s]!.id, chat.headline)
    const result: ChatHeadline = { set: chat.sets[s]!.id, messages: chat.headline, rebuildScratchMs: [], rebuildKeepingMs: [], mainColdMs: [], lines: { rebuild: 0, rebuildKeeping: 0, main: 0 } }
    for (let pass = 0; pass < chat.headlinePasses; pass++) {
      document.title = `bench headline ${result.set} ${pass + 1}/${chat.headlinePasses}`
      // The three take turns, in forward order on even passes and in reverse on odd ones.
      for (let turn = 0; turn < 3; turn++) {
        const start = performance.now()
        switch (pass % 2 === 0 ? turn : 2 - turn) {
          case 0:
            result.lines.rebuild = scratchChat(inputs, c.env, 'count')
            result.rebuildScratchMs.push(performance.now() - start)
            break
          case 1:
            result.lines.rebuildKeeping = scratchChatKeeping(inputs, c.env, 'both')
            result.rebuildKeepingMs.push(performance.now() - start)
            break
          default:
            result.lines.main = mainColdChat(inputs, font, lineHeight)
            result.mainColdMs.push(performance.now() - start)
        }
        await yieldTask()
      }
    }
    sink += result.lines.rebuild + result.lines.rebuildKeeping + result.lines.main
    await post<{ kind: 'ok' }>('/api/chat', { runId, context: c.plan.index, part: { kind: 'headline', result } } satisfies ChatPost)
  }
}

// The resize case on the headline set (protocol.ts ChatHeadlineResize). It holds every prepared paragraph of a set at once,
// with their Canvas contexts, so it runs last in its document: a page that can't hold them has posted everything else.
async function chatHeadlineResize(c: Context, chat: ChatPlan): Promise<void> {
  const font = c.plan.style.mainFont
  const lineHeight = c.plan.style.lineHeight
  // Every set with a page's list of contexts first, whose paragraphs hold a few contexts between them: the paragraphs that each
  // hold their own leave about eleven canvases a message behind, which a later part would pay for collecting.
  const keeping: { prepareAndFillMs: number; resizeMs: number }[] = []
  for (let s = 0; s < chat.sets.length; s++) {
    const inputs = chatInputs(c, chat.sets[s]!.id, chat.headline)
    document.title = `bench headline resize ${chat.sets[s]!.id}, one list of contexts`
    let start = performance.now()
    const prepared = prepareAllChat(inputs, c.env, [])
    const prepareAndFillMs = performance.now() - start
    start = performance.now()
    sink += resizeChat(prepared, chat.resizeWidths)
    keeping.push({ prepareAndFillMs, resizeMs: performance.now() - start })
    await yieldTask()
  }
  for (let s = 0; s < chat.sets.length; s++) {
    const inputs = chatInputs(c, chat.sets[s]!.id, chat.headline)
    document.title = `bench headline resize ${chat.sets[s]!.id}`
    let start = performance.now()
    const prepared = prepareAllChat(inputs, c.env, undefined)
    const rebuildPrepareAndFillMs = performance.now() - start
    start = performance.now()
    sink += resizeChat(prepared, chat.resizeWidths)
    const rebuildResizeMs = performance.now() - start
    await yieldTask()
    start = performance.now()
    clearCache()
    const handles: MainHandle[] = []
    for (let i = 0; i < inputs.main.length; i++) {
      handles.push(mainPrepareChat(inputs.main[i]!, font))
      sink += mainLinesChat(handles[i]!, chat.width, lineHeight)
    }
    const mainPrepareAndLayoutMs = performance.now() - start
    start = performance.now()
    for (let k = 0; k < chat.resizeWidths.length; k++) for (let i = 0; i < handles.length; i++) sink += mainLinesChat(handles[i]!, chat.resizeWidths[k]!, lineHeight)
    const mainResizeMs = performance.now() - start
    const result: ChatHeadlineResize = {
      set: chat.sets[s]!.id, messages: chat.headline, widths: chat.resizeWidths, rebuildPrepareAndFillMs, rebuildResizeMs,
      rebuildKeepingPrepareAndFillMs: keeping[s]!.prepareAndFillMs, rebuildKeepingResizeMs: keeping[s]!.resizeMs, mainPrepareAndLayoutMs, mainResizeMs,
    }
    await post<{ kind: 'ok' }>('/api/chat', { runId, context: c.plan.index, part: { kind: 'headline-resize', result } } satisfies ChatPost)
  }
}

// ---- Counting, and the time inside Canvas ----

// What the wrappers below have seen: measureText calls with the time inside them, and contexts made (getContext calls)
// with the time making them: the OffscreenCanvas constructor, getContext and every assignment to a context's text
// attributes (the font string is parsed and resolved in the assignment).
const canvasWork = { measureTextCalls: 0, measureTextMs: 0, contexts: 0, contextMs: 0 }

type Restore = () => void

function wrapMeasureText(proto: { measureText(text: string): TextMetrics } | undefined): Restore {
  if (proto === undefined) return () => {}
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    canvasWork.measureTextCalls++
    const start = performance.now()
    const metrics = original.call(this, text)
    canvasWork.measureTextMs += performance.now() - start
    return metrics
  }
  return () => { proto.measureText = original }
}

function wrapGetContext(proto: { getContext: (...rest: never[]) => unknown } | undefined): Restore {
  if (proto === undefined) return () => {}
  const original = proto.getContext as (this: unknown, ...rest: unknown[]) => unknown
  ;(proto as { getContext: unknown }).getContext = function (this: unknown, ...rest: unknown[]): unknown {
    canvasWork.contexts++
    const start = performance.now()
    const context = original.apply(this, rest)
    canvasWork.contextMs += performance.now() - start
    return context
  }
  return () => { (proto as { getContext: unknown }).getContext = original }
}

const TEXT_ATTRIBUTES = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']

function wrapTextAttributes(proto: object | undefined): Restore {
  if (proto === undefined) return () => {}
  const restores: Restore[] = []
  for (let i = 0; i < TEXT_ATTRIBUTES.length; i++) {
    const name = TEXT_ATTRIBUTES[i]!
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    // WebKit's context has no lang, fontKerning or textRendering (engines/webkit/checks.ts).
    if (descriptor === undefined || descriptor.set === undefined) continue
    const original = descriptor.set
    Object.defineProperty(proto, name, {
      ...descriptor,
      set(this: unknown, value: unknown): void {
        const start = performance.now()
        original.call(this, value)
        canvasWork.contextMs += performance.now() - start
      },
    })
    restores.push(() => { Object.defineProperty(proto, name, descriptor) })
  }
  return () => { for (let i = 0; i < restores.length; i++) restores[i]!() }
}

function wrapOffscreenCanvasConstructor(): Restore {
  if (typeof OffscreenCanvas === 'undefined') return () => {}
  const original = OffscreenCanvas
  class TimedOffscreenCanvas extends original {
    constructor(width: number, height: number) {
      const start = performance.now()
      super(width, height)
      canvasWork.contextMs += performance.now() - start
    }
  }
  const scope = globalThis as { OffscreenCanvas: typeof OffscreenCanvas }
  scope.OffscreenCanvas = TimedOffscreenCanvas
  return () => { scope.OffscreenCanvas = original }
}

// Puts the counting and timing wrappers on both context classes and both canvas classes; the result takes them off.
function wrapCanvas(): Restore {
  const offscreenContext = typeof OffscreenCanvasRenderingContext2D === 'undefined' ? undefined : OffscreenCanvasRenderingContext2D.prototype
  const canvasContext = typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D.prototype
  const restores = [
    wrapMeasureText(offscreenContext), wrapMeasureText(canvasContext), wrapTextAttributes(offscreenContext), wrapTextAttributes(canvasContext),
    wrapGetContext(typeof OffscreenCanvas === 'undefined' ? undefined : OffscreenCanvas.prototype),
    wrapGetContext(typeof HTMLCanvasElement === 'undefined' ? undefined : HTMLCanvasElement.prototype), wrapOffscreenCanvasConstructor(),
  ]
  return () => { for (let i = 0; i < restores.length; i++) restores[i]!() }
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
    case 'chat': {
      const inputs = chatInputs(c, row.set, c.plan.chat!.timed)
      const widths = [inputs.chat.width, ...inputs.chat.resizeWidths]
      for (let i = 0; i < inputs.paragraphs.length; i++) prepareAndFill(inputs.paragraphs[i]!, c.env, widths, mode, ranges)
      break
    }
  }
  return ranges
}

// The same ranges from the two halves of prepare() run apart, as the 'checks lifted' variant and the phase pass run them.
function checkedRanges(inputs: ChatInputs, env: Environment): number[] {
  const ranges: number[] = []
  const widths = [inputs.chat.width, ...inputs.chat.resizeWidths]
  for (let i = 0; i < inputs.paragraphs.length; i++) {
    const own: CanvasContext[] = []
    const prepared = prepareChecked(withFontChecks(inputs.paragraphs[i]!, env, own), env, false, own)
    for (let w = 0; w < widths.length; w++) fillAll(prepared, widths[w]!, 'count', ranges)
  }
  return ranges
}

// The same ranges from paragraphs prepared with one list of contexts, in each form of protocol.ts Kept.
function keepingRanges(inputs: ChatInputs, env: Environment, kept: Kept): number[] {
  const ranges: number[] = []
  const widths = [inputs.chat.width, ...inputs.chat.resizeWidths]
  const page: CanvasContext[] = []
  for (let i = 0; i < inputs.paragraphs.length; i++) {
    const prepared = prepareKeeping(inputs.paragraphs[i]!, env, kept, page)
    for (let w = 0; w < widths.length; w++) fillAll(prepared, widths[w]!, 'count', ranges)
  }
  return ranges
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function countRow(row: RowSpec, c: Context): RowCount {
  const variants = variantsFor(row, c)
  const counts: VariantCount[] = []
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]!
    variant.setup?.()
    canvasWork.measureTextCalls = 0
    canvasWork.contexts = 0
    const lines = variant.run()
    counts.push({ variant: variant.name, measureTextCalls: canvasWork.measureTextCalls, contexts: canvasWork.contexts, lines })
    sink += lines
  }
  const counted = rebuildRanges(row, c, 'count')
  let same = true
  for (let m = 1; m < MODES.length && same; m++) same = sameNumbers(rebuildRanges(row, c, MODES[m]!), counted)
  if (same && row.kind === 'chat') {
    const inputs = chatInputs(c, row.set, c.plan.chat!.timed)
    same = sameNumbers(checkedRanges(inputs, c.env), counted)
    for (let k = 0; k < KEPT.length && same; k++) same = sameNumbers(keepingRanges(inputs, c.env, KEPT[k]!), counted)
  }
  return { id: row.id, variants: counts, rebuildModesSameLines: same }
}

// ---- Phases: where the rebuild's from-scratch time goes (protocol.ts ChatPhases) ----

function noTotals(): PhaseTotals {
  return { ms: 0, measureTextMs: 0, measureTextCalls: 0, contextMs: 0, contexts: 0 }
}

// Adds what ran since `start` and `work` were taken to `totals`, and returns the time of it.
function addPhase(totals: PhaseTotals, start: number, work: typeof canvasWork): number {
  const ms = performance.now() - start
  totals.ms += ms
  totals.measureTextMs += canvasWork.measureTextMs - work.measureTextMs
  totals.measureTextCalls += canvasWork.measureTextCalls - work.measureTextCalls
  totals.contextMs += canvasWork.contextMs - work.contextMs
  totals.contexts += canvasWork.contexts - work.contexts
  return ms
}

function medianTotals(passes: readonly PhaseTotals[]): PhaseTotals {
  return {
    ms: median(passes.map(pass => pass.ms)), measureTextMs: median(passes.map(pass => pass.measureTextMs)), measureTextCalls: median(passes.map(pass => pass.measureTextCalls)),
    contextMs: median(passes.map(pass => pass.contextMs)), contexts: median(passes.map(pass => pass.contexts)),
  }
}

type KindTotals = ChatPhases['byKind'][number]

// `keeping`: every pass starts one list of contexts for its messages (prepare() handed a page's); otherwise every message its own.
function chatPhases(c: Context, chat: ChatPlan, setIndex: number, keeping: boolean): ChatPhases {
  const inputs = chatInputs(c, chat.sets[setIndex]!.id, chat.timed)
  const env = c.env
  const checks: PhaseTotals[] = []
  const prepares: PhaseTotals[] = []
  const fills: PhaseTotals[] = []
  const kinds: Map<ChatKind, KindTotals>[] = []
  for (let pass = 0; pass < chat.phasePasses; pass++) {
    const check = noTotals()
    const prep = noTotals()
    const fill = noTotals()
    const byKind = new Map<ChatKind, KindTotals>()
    const page: CanvasContext[] = []
    for (let i = 0; i < inputs.paragraphs.length; i++) {
      const callsBefore = canvasWork.measureTextCalls
      const contextsBefore = canvasWork.contexts
      let work = { ...canvasWork }
      let start = performance.now()
      const contexts = keeping ? page : []
      const checked = withFontChecks(inputs.paragraphs[i]!, env, contexts)
      const checksMs = addPhase(check, start, work)
      work = { ...canvasWork }
      start = performance.now()
      const prepared = prepareChecked(checked, env, false, contexts)
      const prepareMs = addPhase(prep, start, work)
      work = { ...canvasWork }
      start = performance.now()
      sink += fillAll(prepared, inputs.chat.width, 'count', null)
      const fillMs = addPhase(fill, start, work)
      const kind = inputs.kinds[i]!
      let entry = byKind.get(kind)
      if (entry === undefined) {
        entry = { kind, messages: 0, units: 0, checksMs: 0, prepareMs: 0, fillMs: 0, measureTextCalls: 0, contexts: 0 }
        byKind.set(kind, entry)
      }
      entry.messages++
      entry.units += inputs.units[i]!
      entry.checksMs += checksMs
      entry.prepareMs += prepareMs
      entry.fillMs += fillMs
      entry.measureTextCalls += canvasWork.measureTextCalls - callsBefore
      entry.contexts += canvasWork.contexts - contextsBefore
    }
    checks.push(check)
    prepares.push(prep)
    fills.push(fill)
    kinds.push(byKind)
  }
  const byKind: KindTotals[] = []
  const kindsMet = [...kinds[0]!.keys()]
  for (let k = 0; k < kindsMet.length; k++) {
    const kind = kindsMet[k]!
    const passes = kinds.map(pass => pass.get(kind)!)
    byKind.push({
      kind, messages: passes[0]!.messages, units: passes[0]!.units, checksMs: median(passes.map(pass => pass.checksMs)), prepareMs: median(passes.map(pass => pass.prepareMs)),
      fillMs: median(passes.map(pass => pass.fillMs)), measureTextCalls: passes[0]!.measureTextCalls, contexts: passes[0]!.contexts,
    })
  }
  const nowCalls = 200_000
  const nowStart = performance.now()
  for (let i = 0; i < nowCalls; i++) sink += performance.now() > 0 ? 1 : 0
  const nowMs = (performance.now() - nowStart) / nowCalls
  return {
    set: chat.sets[setIndex]!.id, keeping, messages: inputs.paragraphs.length, passes: chat.phasePasses, checks: medianTotals(checks), prepare: medianTotals(prepares),
    fill: medianTotals(fills), byKind, nowMs,
  }
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
  // Once untimed, so both timed runs of the loop are of compiled code.
  spin()
  const environment: PageEnvironment = {
    userAgent: navigator.userAgent, pageLang: document.documentElement.lang, crossOriginIsolated: window.crossOriginIsolated,
    timerResolutionMs: timer.ms, timerSteps: timer.steps, heapApi: heapBytes() !== null, hardwareConcurrency: navigator.hardwareConcurrency,
    screen: { width: screen.width, height: screen.height }, spinMs: { start: spin(), end: 0 },
  }
  for (let i = 0; i < plan.rows.length; i++) {
    const row = plan.rows[i]!
    document.title = `bench ${plan.index + 1}/${plan.count}: ${row.id}`
    const timing = await timeRow(row, i, c, timer.ms)
    await post<{ kind: 'ok' }>('/api/row', { runId, context: plan.index, row: timing } satisfies RowPost)
  }
  if (plan.chat !== null && plan.chat.headline > 0) await chatHeadline(c, plan.chat)
  environment.spinMs.end = spin()
  // The wrappers go on after every timed row and headline pass of this document. They come off again before the chat
  // context's last timed part, which runs after them because it is the one most likely to end the page.
  const unwrapCanvas = wrapCanvas()
  const counts: RowCount[] = []
  for (let i = 0; i < plan.rows.length; i++) {
    document.title = `bench ${plan.index + 1}/${plan.count}: counting ${plan.rows[i]!.id}`
    counts.push(countRow(plan.rows[i]!, c))
    await yieldTask()
  }
  await post<{ kind: 'ok' }>('/api/counts', { runId, context: plan.index, counts } satisfies CountsPost)
  if (plan.chat !== null) {
    for (let s = 0; s < plan.chat.sets.length; s++) {
      document.title = `bench ${plan.index + 1}/${plan.count}: phases ${plan.chat.sets[s]!.id}`
      await post<{ kind: 'ok' }>('/api/chat', { runId, context: plan.index, part: { kind: 'phases', result: chatPhases(c, plan.chat, s, false) } } satisfies ChatPost)
      await post<{ kind: 'ok' }>('/api/chat', { runId, context: plan.index, part: { kind: 'phases', result: chatPhases(c, plan.chat, s, true) } } satisfies ChatPost)
    }
  }
  unwrapCanvas()
  if (plan.chat !== null && plan.chat.headline > 0) await chatHeadlineResize(c, plan.chat)
  const reply = await post<{ kind: 'navigate'; url: string } | { kind: 'done' }>('/api/context-done', { runId, context: plan.index, environment } satisfies ContextDonePost)
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
