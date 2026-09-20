// A second pair of eyes on profiling item 2 (research/PROFILING-START.md: a Blink shaping group keeps by offset what its
// own shaping call measured). Offline, under the stand-in Canvas. A check, not a test of the tiers: nothing reads it.
//
//   bun rebuild/tools/positions-attack.ts --base=<a checkout's rebuild folder> --head=<another's> --cases=<cases.ndjson>[,<more>]
//     [--config=no-facts|facts] [--canvas=stand-in|long-context] [--mutate=none|big|spaced] [--every=N] [--limit=N] [--jobs=N] [--out=<report.json>]
//   bun rebuild/tools/positions-attack.ts counts --trees=<name>=<rebuild folder>,... [--count=1000]     (at the file's end)
//
// What function-set.ts sweep leaves out, which this adds:
// - the other tree. The sweep compares the working tree with itself, one prepared paragraph against fresh ones, so a
//   value that is wrong in both passes it. Here every layout of `head` is compared with a paragraph `base` prepared for
//   that width alone: fill results, pieces, and on an inspected paragraph the inspection with its gaps.
// - the order. The sweep fills at 0.5, 0.75, 1.5 and 1 times the case's width, in that order, once. Here one prepared
//   paragraph is filled at eight widths (a quarter of the case's to three times it, and 100,000 px: one line) narrowest
//   first, widest first and in a shuffled order, and then at every width once more, where each width has been met.
// - who reads first. On an inspected paragraph only linePieces reads what is kept (shape.ts keepsByOffset), so the three
//   inspected passes read pieces before inspections, inspections before pieces, and every line's pieces at a width before
//   any inspection there.
// - a Canvas whose adjustments depend on the measured range. The stand-in kerns pairs and ligates neighbours, so its wide
//   window (shape.ts windowAdjust16) shows what its pair window shows, and a kept adjustment read back under another
//   window would pass. `--canvas=long-context` adds to every string a term that reads three characters before and two
//   after each character, in whole 1/64 px, the same in every context: a window's adjustment then depends on where the
//   window ends, as it does in a font with contextual lookups, and the two trees must still agree.
// - `--mutate=big` makes every font three times its size (and the widths with it), so nearly every group is wider than
//   256 zoomed px and is cut into pieces (shape.ts addPieces), where the wide window follows the cuts; `--mutate=spaced`
//   gives every node a letter spacing of 1.5 px.
// `--head` can be a tree whose kept values check themselves (a scratch patch that measures at every read and throws where
// the kept number differs): a throw is reported as a difference.
// Exit 0 when nothing differs, 1 when something does, 2 on a failure of the tool.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Case, LayoutPrediction } from '../lab/types.ts'
import { firstDifference } from '../tests/replay.ts'
import { CONFIGS, PREDICTORS, type Config } from '../tests/sets.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const CHROME = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', env: { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } } } as const

type Slot = { width: number; left: number; right: number }
type FillResult = { kind: 'line'; line: unknown; next: unknown; hasLineBox: boolean } | { kind: 'below-floats'; line: unknown; next: unknown }
type FunctionSet = {
  prepare: (paragraph: unknown, env: unknown, inspect: boolean) => unknown
  firstLine: (prepared: unknown) => unknown
  fillLine: (prepared: unknown, start: unknown, slot: Slot) => FillResult
  linePieces: (prepared: unknown, line: unknown) => unknown
  inspectLine: (prepared: unknown, line: unknown) => unknown
}
type Predictor = { predict: (c: Case, env: unknown) => LayoutPrediction | { lines: unknown } | { error: string } }

const options = new Map<string, string>()

function fail(text: string): never {
  console.error(`[positions-attack] ${text}`)
  process.exit(2)
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// ---- The Canvas whose adjustments depend on the measured range ----

function mix(h: number, value: number): number {
  h = Math.imul(h ^ value, 0x01000193)
  return (h ^ (h >>> 15)) >>> 0
}

// Whole 1/64 px, from the text alone, so two contexts differ by what they differed by before.
function longContext64(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    let h = 0x811c9dc5
    for (let d = -3; d <= 2; d++) h = mix(h, i + d < 0 || i + d >= text.length ? 0 : text.charCodeAt(i + d) + 1)
    if (h % 3 === 0) total += ((h >>> 5) % 7) - 3
  }
  return total
}

function installLongContext(): void {
  type Context = { measureText: (text: string) => { width: number; actualBoundingBoxRight: number } }
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Context } }
  const Inner = globals.OffscreenCanvas
  globals.OffscreenCanvas = class {
    inner = new Inner(1, 1)
    getContext(kind: string): Context {
      const context = this.inner.getContext(kind)
      const measure = context.measureText.bind(context)
      context.measureText = (text: string) => {
        const metrics = measure(text)
        const more = longContext64(text) / 64
        return { ...metrics, width: metrics.width + more, actualBoundingBoxRight: metrics.actualBoundingBoxRight + more }
      }
      return context
    }
  }
}

// ---- One case ----

// Every font `factor` times its size, or every letter spacing 1.5 px, over the library's paragraph (plain data).
function mutated(value: unknown, mutate: string): unknown {
  if (Array.isArray(value)) return value.map(item => mutated(item, mutate))
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (mutate === 'big' && key === 'font' && typeof item === 'object' && item !== null && 'size' in item) out[key] = { ...item, size: (item as { size: number }).size * 3 }
    else if (mutate === 'big' && key === 'lineHeight' && typeof item === 'number') out[key] = item * 3
    else if (mutate === 'spaced' && key === 'letterSpacing') out[key] = 1.5
    else out[key] = mutated(item, mutate)
  }
  return out
}

type Read = 'pieces-first' | 'inspection-first' | 'pieces-of-every-line-first'

// Every line at one width, as JSON per line: the fill result, the pieces, and on an inspected paragraph the inspection.
function layout(lib: FunctionSet, prepared: unknown, width: number, insets: ReadonlyArray<{ left: number; right: number }>, inspect: boolean, read: Read): string[] {
  const filled: FillResult[] = []
  const pieces: unknown[] = []
  const inspections: unknown[] = []
  let row = 0
  for (let start = lib.firstLine(prepared); start !== null;) {
    const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
    const result = lib.fillLine(prepared, start, { width, left: inset.left, right: inset.right })
    filled.push(result)
    if (read !== 'pieces-of-every-line-first') {
      // Kept as JSON at once: a result can share its arrays with the decided line.
      if (inspect && read === 'inspection-first') inspections.push(JSON.parse(JSON.stringify(lib.inspectLine(prepared, result.line))))
      pieces.push(result.kind === 'line' ? JSON.parse(JSON.stringify(lib.linePieces(prepared, result.line))) : null)
      if (inspect && read === 'pieces-first') inspections.push(JSON.parse(JSON.stringify(lib.inspectLine(prepared, result.line))))
    }
    if (result.kind === 'below-floats' || result.hasLineBox) row++
    start = result.next
  }
  if (read === 'pieces-of-every-line-first') {
    for (let i = 0; i < filled.length; i++) pieces.push(filled[i]!.kind === 'line' ? JSON.parse(JSON.stringify(lib.linePieces(prepared, filled[i]!.line))) : null)
    if (inspect) for (let i = 0; i < filled.length; i++) inspections.push(JSON.parse(JSON.stringify(lib.inspectLine(prepared, filled[i]!.line))))
  }
  const out: string[] = []
  for (let i = 0; i < filled.length; i++) {
    const result = filled[i]!
    const fill = result.kind === 'line' ? { kind: result.kind, next: result.next, hasLineBox: result.hasLineBox } : { kind: result.kind, next: result.next }
    out.push(JSON.stringify({ fill, pieces: pieces[i], inspection: inspect ? inspections[i] : null }))
  }
  return out
}

function shuffled(widths: readonly number[], seed: number): number[] {
  const out = widths.slice()
  let h = mix(0x811c9dc5, seed)
  for (let i = out.length - 1; i > 0; i--) {
    h = mix(h, i)
    const j = h % (i + 1)
    const swap = out[i]!
    out[i] = out[j]!
    out[j] = swap
  }
  return out
}

type Difference = { id: string; family: string; pass: string; width: number; first: string }
type SliceResult = { cases: number; skipped: number; layouts: number; differences: Difference[]; calls: { base: number; head: number } }

function attack(c: Case, index: number, base: FunctionSet, head: FunctionSet, predictor: Predictor, result: SliceResult): void {
  const standIn = installStandInCanvas({ userAgent: CHROME.userAgent, devicePixelRatio: Number(options.get('dpr') ?? 2), pageLang: c.pageLang })
  if (options.get('canvas') === 'long-context') installLongContext()
  try {
    let prediction: ReturnType<Predictor['predict']>
    try {
      prediction = predictor.predict(c, CHROME.env)
    } catch {
      result.skipped++
      return
    }
    if (!('layout' in prediction)) {
      result.skipped++
      return
    }
    const mutate = options.get('mutate') ?? 'none'
    const paragraph = mutated(prediction.paragraph, mutate)
    const env = prediction.layout.env
    const insets = c.inline?.lineSlots ?? []
    const w = c.paragraph.width * (mutate === 'big' ? 3 : 1)
    const widths = [w * 0.25, w * 0.5, w * 0.75, w, w * 1.25, w * 1.5, w * 3, 100000]
    result.cases++
    for (const inspect of [false, true]) {
      // What a paragraph prepared by `base` for one width alone gives there.
      const alone = new Map<number, string[]>()
      standIn.reset()
      for (let i = 0; i < widths.length; i++) alone.set(widths[i]!, layout(base, base.prepare(paragraph, env, inspect), widths[i]!, insets, inspect, 'pieces-first'))
      result.calls.base += standIn.asked().calls
      const passes: Array<{ name: string; order: number[]; read: Read }> = [
        { name: 'narrowest first', order: widths, read: 'pieces-first' },
        { name: 'widest first', order: widths.slice().reverse(), read: 'inspection-first' },
        { name: 'shuffled', order: shuffled(widths, index), read: 'pieces-of-every-line-first' },
      ]
      for (let k = 0; k < passes.length; k++) {
        const pass = passes[k]!
        const name = `${inspect ? 'inspected' : 'plain'}, ${pass.name}`
        let at = 0
        let again = false
        try {
          const prepared = head.prepare(paragraph, env, inspect)
          // The widths in the pass's order, then each once more in the order they were first met.
          for (let round = 0; round < 2; round++) {
            again = round === 1
            for (let i = 0; i < pass.order.length; i++) {
              at = pass.order[i]!
              const lines = layout(head, prepared, at, insets, inspect, pass.read)
              result.layouts++
              const expected = alone.get(at)!
              const first = firstDifference(expected.map(line => JSON.parse(line) as unknown), lines.map(line => JSON.parse(line) as unknown), 'lines')
              if (first !== null) {
                result.differences.push({ id: c.id, family: c.family, pass: `${name}${again ? ', a width met before' : ''}`, width: at, first: `${first.path}: ${first.before} -> ${first.after}` })
                return
              }
            }
          }
        } catch (error) {
          result.differences.push({ id: c.id, family: c.family, pass: `${name}${again ? ', a width met before' : ''}`, width: at, first: `threw: ${message(error).slice(0, 300)}` })
          return
        }
      }
      // What the head tree asks for the same eight fresh layouts, for the counts.
      standIn.reset()
      for (let i = 0; i < widths.length; i++) layout(head, head.prepare(paragraph, env, inspect), widths[i]!, insets, inspect, 'pieces-first')
      result.calls.head += standIn.asked().calls
    }
  } catch (error) {
    // `base` threw on a paragraph the predictor laid out: the mutation made it one the library refuses.
    result.cases--
    result.skipped++
    if (options.get('verbose') !== undefined) console.error(`[positions-attack] ${c.id}: ${message(error)}`)
  } finally {
    standIn.restore()
  }
}

function readCases(files: readonly string[]): Case[] {
  const out: Case[] = []
  for (const file of files) for (const line of readFileSync(resolve(file), 'utf8').split('\n')) if (line !== '') out.push(JSON.parse(line) as Case)
  const every = Number(options.get('every') ?? 1)
  return out.filter((c, i) => i % every === 0 && (c.browsers === undefined || c.browsers.includes('chrome')))
}

async function work(): Promise<void> {
  const base = await import(join(options.get('base')!, 'src/index.ts')) as FunctionSet
  const head = await import(join(options.get('head')!, 'src/index.ts')) as FunctionSet
  const predictor = await import(join(options.get('head')!, '..', PREDICTORS[options.get('config') as Config])) as Predictor
  const from = Number(options.get('from'))
  const cases = readCases(options.get('cases')!.split(',')).slice(from, Number(options.get('to')))
  const result: SliceResult = { cases: 0, skipped: 0, layouts: 0, differences: [], calls: { base: 0, head: 0 } }
  for (let i = 0; i < cases.length; i++) attack(cases[i]!, from + i, base, head, predictor, result)
  writeFileSync(options.get('result')!, JSON.stringify(result))
}

async function run(): Promise<number> {
  const config = (options.get('config') ?? 'no-facts') as Config
  if (!CONFIGS.includes(config)) fail('--config must be no-facts or facts')
  options.set('config', config)
  for (const name of ['base', 'head', 'cases']) if (!options.has(name)) fail(`--${name} is required`)
  const count = Math.min(readCases(options.get('cases')!.split(',')).length, Number(options.get('limit') ?? Infinity))
  const jobs = Math.max(1, Number(options.get('jobs') ?? Math.max(1, cpus().length - 2)))
  const dir = mkdtempSync(join(tmpdir(), 'positions-attack-'))
  const size = Math.max(1, Math.ceil(count / (jobs * 6)))
  const slices: Array<{ from: number; to: number; result: string }> = []
  for (let from = 0; from < count; from += size) slices.push({ from, to: Math.min(count, from + size), result: join(dir, `${slices.length}.json`) })
  const started = Date.now()
  let next = 0
  const failures: number[] = []
  await Promise.all(Array.from({ length: Math.min(jobs, slices.length) }, async () => {
    while (next < slices.length) {
      const slice = slices[next++]!
      const args = ['work', `--from=${slice.from}`, `--to=${slice.to}`, `--result=${slice.result}`]
      for (const [name, value] of options) args.push(`--${name}=${value}`)
      const proc = Bun.spawn(['bun', import.meta.path, ...args], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
      if (await proc.exited !== 0) failures.push(slice.from)
    }
  }))
  if (failures.length > 0) fail(`the slices starting at cases ${failures.sort((x, y) => x - y).join(', ')} failed`)
  const total: SliceResult = { cases: 0, skipped: 0, layouts: 0, differences: [], calls: { base: 0, head: 0 } }
  for (const slice of slices) {
    const result = JSON.parse(readFileSync(slice.result, 'utf8')) as SliceResult
    total.cases += result.cases
    total.skipped += result.skipped
    total.layouts += result.layouts
    total.calls.base += result.calls.base
    total.calls.head += result.calls.head
    total.differences.push(...result.differences)
  }
  console.log(`[positions-attack] ${options.get('canvas') ?? 'stand-in'} Canvas, ${config}, mutate ${options.get('mutate') ?? 'none'}: ${total.cases} cases (${total.skipped} skipped), ${total.layouts} layouts of head's kept paragraphs compared with base's fresh ones: ${total.differences.length} cases differ (${Math.round((Date.now() - started) / 100) / 10} s)`)
  console.log(`  eight fresh layouts a case, plain and inspected: base asks ${(total.calls.base / Math.max(1, total.cases)).toFixed(1)} calls a case, head ${(total.calls.head / Math.max(1, total.cases)).toFixed(1)}`)
  const byPass = new Map<string, number>()
  for (const difference of total.differences) byPass.set(difference.pass, (byPass.get(difference.pass) ?? 0) + 1)
  for (const [pass, n] of [...byPass].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(6)}  ${pass}`)
  for (const difference of total.differences.slice(0, 8)) console.log(`    ${difference.id} (${difference.family}) ${difference.pass} at ${difference.width}px: ${difference.first}`)
  const out = options.get('out')
  if (out !== undefined) {
    mkdirSync(resolve(out, '..'), { recursive: true })
    writeFileSync(resolve(out), `${JSON.stringify({ format: 'pretext-positions-attack/1', options: Object.fromEntries(options), ...total }, null, 1)}\n`)
  }
  return total.differences.length > 0 ? 1 : 0
}

// ---- Counts: what each of several trees asks for the bench's chat messages, by a plain counter ----

// `counts --trees=<name>=<rebuild folder>,... [--count=1000]`: each message prepared from scratch and filled at the
// bench's width, then kept and filled at its three resize widths, and at those once more (bench/page.ts chatInputs and its
// resize rows), under the stand-in Canvas. No source transform and no stack: calls only, to check tools/positions-study.ts
// and to price a tree with one of the kept tables taken out.
async function counts(): Promise<void> {
  const trees = (options.get('trees') ?? fail('--trees=<name>=<rebuild folder>,... is required')).split(',')
  const count = Number(options.get('count') ?? 1000)
  for (let t = 0; t < trees.length; t++) {
    const name = trees[t]!.slice(0, trees[t]!.indexOf('='))
    const tree = resolve(trees[t]!.slice(name.length + 1))
    const lib = await import(join(tree, 'src/index.ts'))
    const model = await import(join(tree, 'src/model.ts'))
    const bench = await import(join(tree, 'bench/cases.ts'))
    for (const set of bench.CHAT_SETS as string[]) {
      const standIn = installStandInCanvas({ userAgent: CHROME.userAgent, devicePixelRatio: 2, pageLang: bench.CHAT_STYLE.lang })
      const detected = lib.detectEnvironment({ engine: 'blink', build: CHROME.env.build, contentLanguage: null, uiLanguage: null })
      if (detected.kind === 'unsupported') fail(detected.reason)
      const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 }
      const edge = { margin: 0, border: 0, padding: bench.CHAT_CODE_PADDING }
      const messages = bench.buildChat(set, count) as Array<{ parts: Array<{ code: boolean; text: string }> }>
      const asked = { scratch: 0, prepare: 0, newWidth: 0, metWidth: 0 }
      const fillAll = (prepared: unknown, width: number): void => {
        for (let start = lib.firstLine(prepared); start !== null;) start = lib.fillLine(prepared, start, { width, left: 0, right: 0 }).next
      }
      for (let i = 0; i < messages.length; i++) {
        const content: unknown[] = []
        for (const part of messages[i]!.parts) {
          if (part.code) content.push({ ...text, kind: 'span', font: { ...bench.CHAT_CODE_FONT, facts: model.UNKNOWN_FONT_FACTS }, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
          else content.push({ kind: 'text', text: part.text })
        }
        const s = bench.CHAT_STYLE
        const paragraph = { ...text, font: { ...s.font, facts: model.UNKNOWN_FONT_FACTS }, content, lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start' }
        standIn.reset()
        const prepared = lib.prepare(paragraph, detected.env, false)
        asked.prepare += standIn.asked().calls
        fillAll(prepared, bench.CHAT_WIDTH)
        asked.scratch += standIn.asked().calls
        for (let again = 0; again < 2; again++) {
          standIn.reset()
          for (const width of bench.CHAT_RESIZE_WIDTHS as number[]) fillAll(prepared, width)
          if (again === 0) asked.newWidth += standIn.asked().calls
          else asked.metWidth += standIn.asked().calls
        }
      }
      standIn.restore()
      const widths = (bench.CHAT_RESIZE_WIDTHS as number[]).length
      console.log(`[positions-attack] ${name.padEnd(12)} ${set.padEnd(5)} ${count} messages, calls a message from scratch ${(asked.scratch / count).toFixed(2)} (prepare with its font checks ${(asked.prepare / count).toFixed(2)}, the fill ${((asked.scratch - asked.prepare) / count).toFixed(2)}); a layout at a new width ${(asked.newWidth / count / widths).toFixed(2)}, at a width met before ${(asked.metWidth / count / widths).toFixed(2)}`)
    }
  }
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2)
  for (const raw of first === 'work' || first === 'counts' ? rest : process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null) fail(`Unknown argument ${raw}`)
    options.set(match[1]!, match[2]!)
  }
  if (first === 'work') {
    await work()
    process.exit(0)
  }
  if (first === 'counts') {
    await counts()
    process.exit(0)
  }
  process.exit(await run())
}
