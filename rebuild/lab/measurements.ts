// The offline side of run.ts --record-measurements (record.ts). It reads a run's measurement records and checks a library
// build against them with no browser running: the build must ask Canvas the same questions or fewer and get the same lines.
//
//   bun rebuild/lab/measurements.ts --rows=<rows.ndjson> --measurements=<measurements.ndjson.zst> [--predictor=<file>]
//     [--limit=N] [--out=<report.json>]
//
// Rows and records are read in step, one case at a time. For each case the tool installs the row's page facts (user agent,
// DPR, <html lang>) and a replay of the record as the globals a layout reads (OffscreenCanvas, Intl.Segmenter,
// Intl.v8BreakIterator), runs the predictor's predict() and compares:
// - lines: the layout as a row keeps it (lines, slots below floats, gaps, environment) equals the row's, as JSON;
// - questions: the measureText calls made, and whether the record's predict phase held each one. A question the record
//   doesn't hold can't be answered offline: the case is reported under `newQuestions` and its lines aren't compared.
// A question is a context and a string, and a context is found by the settings its caller assigned, spelled the same way
// (record.ts RecordedContext.assigned). Two recorded contexts with equal assigned settings (the library's partitions) are
// told apart by order: a replayed context takes the earliest one no other context took that holds its first question.
// Exit 1 when any case differs or asks a new question.
import { resolve } from 'node:path'
import type { CaseMeasurements, RecordedCall, RecordedContext, RecordedSegmentation } from './record.ts'
import { readLines } from './rows.ts'
import type { BrowserKind, Case, LabRow, LayoutPrediction, LinesPrediction, ProcessLanguages } from './types.ts'

export async function* readMeasurements(path: string): AsyncGenerator<CaseMeasurements> {
  const zstd = Bun.spawn(['zstd', '-dc', path], { stdout: 'pipe', stderr: 'inherit' })
  const decoder = new TextDecoder()
  let rest = ''
  for await (const bytes of zstd.stdout) {
    rest += decoder.decode(bytes, { stream: true })
    for (let end = rest.indexOf('\n'); end !== -1; end = rest.indexOf('\n')) {
      const line = rest.slice(0, end)
      rest = rest.slice(end + 1)
      if (line !== '') yield JSON.parse(line) as CaseMeasurements
    }
  }
  if (rest.trim() !== '') yield JSON.parse(rest) as CaseMeasurements
  if (await zstd.exited !== 0) throw new Error(`zstd -dc ${path} failed`)
}

export class NewQuestion extends Error {}

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'] as const

type SettingName = typeof SETTINGS[number]

function assignedKey(assigned: RecordedContext['assigned'], names: readonly SettingName[]): string {
  return JSON.stringify(names.map(name => assigned[name] ?? null))
}

// `answeredBy`: per question asked, in order, the index in `record.calls` of the recorded call that answered it. A library
// that measures as the recorded one did asks the phase's calls in order. `distinct` counts the questions a context wasn't
// asked before in the phase, so `asked - distinct` are repeats and `asked / distinct` is the ask ratio. `contexts` counts
// the contexts the phase made, asked or not: the replay's own count, which needs no call log from the library.
export type Replay = { asked: number; distinct: number; contexts: number; fromAnotherContext: number; answeredBy: number[]; restore: () => void }

// Asks and repeats by library call site (rebuild/tests/replay.ts check --sites). A site is the innermost three library
// frames of the stack at a measureText call, innermost first, as `function@file:line < ...` with the file relative to
// rebuild/src; src/measure/canvas.ts is left out, since every call passes through it. `under` counts a call once for every
// library function on its stack, so "how much sits under lineGaps" is one lookup. JavaScriptCore drops the frame of a
// function that returns a call directly (a tail call), so a site can lack such a caller.
export type SiteCount = { asks: number; repeats: number; repeatChars: number }
// `stacks`: stacks repeat, so each is read once.
export type SiteTally = { sites: Map<string, SiteCount>; under: Map<string, SiteCount>; stacks: Map<string, { site: string; under: string[] }> }

export const newSiteTally = (): SiteTally => ({ sites: new Map(), under: new Map(), stacks: new Map() })

const LIBRARY = '/rebuild/src/'
const PASS_THROUGH = '/rebuild/src/measure/canvas.ts'
const SITE_FRAMES = 3

// A stack's site and the library functions on it. bun prints V8's form: `at name (file:line:column)`, or `at file:line:column`
// for a function without a name.
export function siteOf(stack: string): { site: string; under: string[] } {
  const frames: string[] = []
  const under: string[] = []
  const lines = stack.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const match = /^\s*at (?:(.*?) \()?(.*?):(\d+):\d+\)?$/.exec(lines[i]!)
    if (match === null) continue
    const at = match[2]!.indexOf(LIBRARY)
    if (at === -1 || match[2]!.endsWith(PASS_THROUGH)) continue
    const file = match[2]!.slice(at + LIBRARY.length)
    const name = match[1] ?? '(anonymous)'
    if (frames.length < SITE_FRAMES) frames.push(`${name}@${file}:${match[3]!}`)
    const owner = `${name}@${file}`
    if (!under.includes(owner)) under.push(owner)
  }
  return { site: frames.length === 0 ? '(outside rebuild/src)' : frames.join(' < '), under }
}

function count(counts: Map<string, SiteCount>, key: string, repeat: boolean, chars: number): void {
  let entry = counts.get(key)
  if (entry === undefined) {
    entry = { asks: 0, repeats: 0, repeatChars: 0 }
    counts.set(key, entry)
  }
  entry.asks++
  if (repeat) {
    entry.repeats++
    entry.repeatChars += chars
  }
}

export type PageFacts = { userAgent: string; devicePixelRatio: number; pageLang: string }

// The page a layout reads, as globals: the page facts, and `Canvas` as OffscreenCanvas and as a detached <canvas>
// (src/measure/canvas.ts makes its contexts from either). Returns what puts the old globals back. The replay below and the
// stand-in Canvas of rebuild/tests/stand-in-canvas.ts are the two pages there are.
export function installPage(env: PageFacts, Canvas: new () => { getContext(): object }): () => void {
  const globals = globalThis as Record<string, unknown>
  const names = ['OffscreenCanvas', 'navigator', 'window', 'document']
  const before = names.map(name => Object.getOwnPropertyDescriptor(globals, name))
  const define = (name: string, value: unknown): void => { Object.defineProperty(globals, name, { value, configurable: true, writable: true }) }
  define('OffscreenCanvas', Canvas)
  define('navigator', { userAgent: env.userAgent })
  define('window', { devicePixelRatio: env.devicePixelRatio })
  define('document', {
    documentElement: { lang: env.pageLang },
    createElement(name: string): unknown {
      if (name !== 'canvas') throw new Error(`This page has no <${name}> element`)
      return new Canvas()
    },
  })
  return () => {
    for (let i = 0; i < names.length; i++) {
      const descriptor = before[i]
      if (descriptor === undefined) delete globals[names[i]!]
      else Object.defineProperty(globals, names[i]!, descriptor)
    }
  }
}

// Installs one phase of the record (the predict phase, or the observe phase, where the WebKit observation port measures) as
// the browser globals a layout reads. restore() puts the old globals back. With `tally`, every question is counted under its
// call site.
export function installReplay(record: CaseMeasurements, env: PageFacts, phase: 'predict' | 'observe' = 'predict', tally: SiteTally | null = null): Replay {
  const replay: Replay = { asked: 0, distinct: 0, contexts: 0, fromAnotherContext: 0, answeredBy: [], restore: () => {} }
  // Per recorded context: string -> the answers in call order, as indices into record.calls.
  const answers: Array<Map<string, number[]>> = record.contexts.map(() => new Map())
  for (let i = record.phases[phase][0]; i < record.phases[phase][1]; i++) {
    const call = record.calls[i]!
    const list = answers[call[0]]!.get(call[1])
    if (list === undefined) answers[call[0]]!.set(call[1], [i])
    else list.push(i)
  }
  // A setting the recorded browser's contexts don't have (WebKit: lang, textRendering) is an ordinary property there, which
  // the recorder can't see assigned, so the replay ignores it too.
  const names = SETTINGS.filter(name => record.contexts.some(context => context.settings[name] !== null))
  const byAssigned = new Map<string, number[]>()
  for (let i = 0; i < record.contexts.length; i++) {
    if (answers[i]!.size === 0) continue
    const key = assignedKey(record.contexts[i]!.assigned, names)
    byAssigned.set(key, [...(byAssigned.get(key) ?? []), i])
  }
  const taken = new Set<number>()

  class ReplayContext {
    assigned: RecordedContext['assigned'] = {}
    // The key of `assigned`, made when a question needs it and dropped when a setting is assigned: a paragraph asks a
    // context hundreds of questions between two assignments.
    key: string | null = null
    bound: number | null = null
    served = new Map<string, number>()
    measureText(text: string): Partial<TextMetrics> {
      replay.asked++
      if (this.key === null) this.key = assignedKey(this.assigned, names)
      const candidates = byAssigned.get(this.key) ?? []
      if (this.bound === null || !answers[this.bound]!.has(text)) {
        const holding = candidates.filter(index => answers[index]!.has(text))
        if (holding.length === 0) throw new NewQuestion(`measureText(${JSON.stringify(text)}) under ${JSON.stringify(this.assigned)} is not in the record`)
        if (this.bound === null) {
          this.bound = holding.find(index => !taken.has(index)) ?? holding[0]!
          taken.add(this.bound)
        } else {
          replay.fromAnotherContext++
        }
      }
      const from = answers[this.bound]!.has(text) ? this.bound : candidates.find(index => answers[index]!.has(text))!
      const list = answers[from]!.get(text)!
      const nth = this.served.get(text) ?? 0
      this.served.set(text, nth + 1)
      if (nth === 0) replay.distinct++
      if (tally !== null) {
        const stack = new Error().stack ?? ''
        let read = tally.stacks.get(stack)
        if (read === undefined) {
          read = siteOf(stack)
          tally.stacks.set(stack, read)
        }
        count(tally.sites, read.site, nth > 0, text.length)
        for (let i = 0; i < read.under.length; i++) count(tally.under, read.under[i]!, nth > 0, text.length)
      }
      const index = list[Math.min(nth, list.length - 1)]!
      replay.answeredBy.push(index)
      const call: RecordedCall = record.calls[index]!
      const fontBox = record.contexts[from]!.fontBox
      return { width: call[2], actualBoundingBoxLeft: call[3], actualBoundingBoxRight: call[4], actualBoundingBoxAscent: call[5], actualBoundingBoxDescent: call[6], fontBoundingBoxAscent: fontBox[0], fontBoundingBoxDescent: fontBox[1] }
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(ReplayContext.prototype, name, {
      get(this: ReplayContext): string { return this.assigned[name] ?? '' },
      set(this: ReplayContext, value: unknown): void {
        this.assigned[name] = String(value)
        this.key = null
      },
    })
  }

  const segmentation = (api: RecordedSegmentation['api'], text: string): RecordedSegmentation => {
    const found = record.segmentations.find(entry => entry.api === api && entry.text === text)
    if (found === undefined) throw new NewQuestion(`${api} over ${JSON.stringify(text)} is not in the record`)
    return found
  }
  const intl = Intl as unknown as Record<string, unknown>
  const segment = Intl.Segmenter.prototype.segment
  const v8 = Object.getOwnPropertyDescriptor(intl, 'v8BreakIterator')
  const restorePage = installPage(env, class {
    getContext(): ReplayContext {
      replay.contexts++
      return new ReplayContext()
    }
  })
  Intl.Segmenter.prototype.segment = function (this: Intl.Segmenter, text: string): Intl.Segments {
    const found = segmentation('segmenter', text) as Extract<RecordedSegmentation, { api: 'segmenter' }>
    return found.starts.map((index, k) => ({ segment: text.slice(index, found.starts[k + 1] ?? text.length), index, input: text, isWordLike: found.wordLike?.[k] })) as unknown as Intl.Segments
  }
  // Chrome alone has Intl.v8BreakIterator, and the library asks whether it exists.
  if (/\bChrome\//.test(env.userAgent)) {
    intl['v8BreakIterator'] = class {
      breaks: number[] = []
      at = 0
      adoptText(text: string): void {
        this.breaks = (segmentation('v8-break-iterator', text) as Extract<RecordedSegmentation, { api: 'v8-break-iterator' }>).breaks
        this.at = 0
      }
      first(): number { return 0 }
      next(): number { return this.breaks[this.at++] ?? -1 }
    }
  } else {
    delete intl['v8BreakIterator']
  }
  replay.restore = () => {
    restorePage()
    Intl.Segmenter.prototype.segment = segment
    if (v8 === undefined) delete intl['v8BreakIterator']
    else Object.defineProperty(intl, 'v8BreakIterator', v8)
  }
  return replay
}

type Predictor = { predict: (c: Case, env: { browser: BrowserKind; build: string; languages: ProcessLanguages['given'] | null }) => LayoutPrediction | LinesPrediction | { error: string } }
type CaseReport = { id: string; outcome: 'same' | 'different' | 'new-question' | 'not-compared'; detail: string | null; asked: number; recorded: number }

// The layout as page.ts records it: without its call log.
function recorded(layout: LayoutPrediction['layout']): unknown {
  const { measure: _measure, ...rest } = layout
  return rest
}

export function verifyCase(row: LabRow, record: CaseMeasurements, predictor: Predictor): CaseReport {
  const recordedCalls = record.phases.predict[1] - record.phases.predict[0]
  const base = { id: row.id, asked: 0, recorded: recordedCalls }
  if (row.build === undefined || !('layout' in row.prediction)) return { ...base, outcome: 'not-compared', detail: 'the row has no engine layout or no build' }
  const replay = installReplay(record, row.env)
  try {
    const result = predictor.predict(row.case, { browser: row.browser, build: row.build.engine, languages: row.languages?.given ?? null })
    if (!('layout' in result)) return { ...base, asked: replay.asked, outcome: 'different', detail: `the predictor returned no layout: ${JSON.stringify(result).slice(0, 300)}` }
    const same = JSON.stringify(recorded(result.layout)) === JSON.stringify(row.prediction.layout)
    return { ...base, asked: replay.asked, outcome: same ? 'same' : 'different', detail: same ? null : 'the layout differs from the row\'s' }
  } catch (error) {
    if (error instanceof NewQuestion) return { ...base, asked: replay.asked, outcome: 'new-question', detail: error.message }
    return { ...base, asked: replay.asked, outcome: 'different', detail: `predict threw: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    replay.restore()
  }
}

if (import.meta.main) {
  const args = new Map(process.argv.slice(2).map(arg => {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1]!, match[2]!] as const
  }))
  const rowsPath = args.get('rows')
  const measurementsPath = args.get('measurements')
  if (rowsPath === undefined || measurementsPath === undefined) throw new Error('Usage: bun rebuild/lab/measurements.ts --rows=<rows.ndjson> --measurements=<measurements.ndjson.zst> [--predictor=<file>] [--limit=N] [--out=<report.json>]')
  const predictor = await import(resolve(args.get('predictor') ?? `${import.meta.dir}/predictor.ts`)) as Predictor
  const limit = Number(args.get('limit') ?? Infinity)
  const records = readMeasurements(resolve(measurementsPath))
  const counts: Record<CaseReport['outcome'], number> = { same: 0, different: 0, 'new-question': 0, 'not-compared': 0 }
  const totals = { cases: 0, asked: 0, recorded: 0, casesAskingMore: 0 }
  const examples: CaseReport[] = []
  for await (const line of readLines(resolve(rowsPath))) {
    if (totals.cases >= limit) break
    const row = JSON.parse(line) as LabRow
    const next = await records.next()
    if (next.done === true) throw new Error(`${measurementsPath} ends before row ${row.id}`)
    if (next.value.id !== row.id) throw new Error(`Record ${next.value.id} doesn't belong to row ${row.id}: the files come from different runs`)
    const report = verifyCase(row, next.value, predictor)
    counts[report.outcome]++
    totals.cases++
    if (report.outcome === 'same' || report.outcome === 'different') {
      totals.asked += report.asked
      totals.recorded += report.recorded
      if (report.asked > report.recorded) totals.casesAskingMore++
    }
    if (report.outcome !== 'same' && examples.length < 50) examples.push(report)
  }
  await records.return(undefined)
  const summary = { rows: resolve(rowsPath), measurements: resolve(measurementsPath), predictor: resolve(args.get('predictor') ?? `${import.meta.dir}/predictor.ts`), counts, totals, examples }
  if (args.get('out') !== undefined) await Bun.write(resolve(args.get('out')!), `${JSON.stringify(summary, null, 1)}\n`)
  console.log(`${totals.cases} cases: ${counts.same} same lines, ${counts.different} different, ${counts['new-question']} with a question the record lacks, ${counts['not-compared']} not compared; measureText calls ${totals.asked} against ${totals.recorded} recorded, ${totals.casesAskingMore} cases asking more`)
  for (let i = 0; i < Math.min(examples.length, 5); i++) console.log(`  ${examples[i]!.id}: ${examples[i]!.outcome}: ${examples[i]!.detail}`)
  process.exit(counts.different + counts['new-question'] === 0 ? 0 : 1)
}
