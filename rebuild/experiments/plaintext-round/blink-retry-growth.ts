// Cheap owned-read growth, not browser accuracy, native timing, or a total shaping bound.
// bun rebuild/experiments/plaintext-round/blink-line-growth.ts --base=/path/to/A6 --out=/private/tmp/growth.json
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../src/env.js'
import { UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../src/model.js'
import { instrumentLineSources, sourceCounts, type SourceCounts } from './blink-source-counter.ts'

type Lib = typeof import('../../src/engines/blink/index.js')
type Modules = { lib: Lib; pool: typeof import('../../src/measure/canvas.js');
  iterator: typeof import('../../src/engines/blink/breaks.js'); breaker: typeof import('../../src/engines/blink/line-breaker.js') }
type Case = { family: 'ascii-word'; size: number; width: number; paragraph: Paragraph }
type Output = { rows: unknown[]; visibleLineBoxes: number; questions: unknown[]; canvasCalls: number; canvasSubmittedUtf16: number; reads: SourceCounts; prefixReads: number }
const options = new Map(process.argv.slice(2).map(arg => {
  const match = /^--(base|head|out|sizes)=(.+)$/s.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  return [match[1]!, match[2]!] as const
}))
const baseRoot = resolve(options.get('base') ?? '/private/tmp/pretext-stateless-round3-baseline-20260922')
const headRoot = resolve(options.get('head') ?? join(import.meta.dir, '../../..'))
const outputPath = resolve(options.get('out') ?? '/private/tmp/pretext-blink-retry-growth.json')
const sizes = (options.get('sizes') ?? '64,128,256,512').split(',').map(Number)
if (sizes.some(n => !Number.isSafeInteger(n) || n < 4 || n > 2048 || n % 4 !== 0)) throw new Error('sizes must be multiples of four in 4..2048')
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
function seal(root: string): string {
  const files: Array<[string, string]> = []
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:js|mjs|cjs|jsx)$/.test(entry.name)) throw new Error(`emitted JS sidecar bypasses the source counter: ${path}`)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push([path.slice(root.length), hash(readFileSync(path, 'utf8'))])
    }
  }
  visit(join(root, 'rebuild/src'))
  return hash(JSON.stringify(files))
}
async function load(root: string): Promise<Modules> {
  return {
    lib: await import(join(root, 'rebuild/src/engines/blink/index.ts')) as Lib,
    pool: await import(join(root, 'rebuild/src/measure/canvas.ts')) as Modules['pool'],
    iterator: await import(join(root, 'rebuild/src/engines/blink/breaks.ts')) as Modules['iterator'],
    breaker: await import(join(root, 'rebuild/src/engines/blink/line-breaker.ts')) as Modules['breaker'],
  }
}
const before = { base: seal(baseRoot), head: seal(headRoot) }
const base = await load(baseRoot), head = await load(headRoot)
const environment: BlinkEnvironment = { engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 2,
  pageLang: 'en', contentLanguage: null, uiLanguage: 'en-US', dictionaryBreaks: { kind: 'unavailable' } }
function paragraph(content: InlineNode[]): Paragraph {
  // Match the native perf input policy and font declaration. This deterministic stand-in is not native Arial.
  return { font: { family: 'Arial', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS },
    content, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word',
    lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}
const cases: Case[] = sizes.flatMap(size => [24, 36, 48].map(width => ({ family: 'ascii-word' as const, size, width,
  paragraph: paragraph([{ kind: 'text', text: 'abcd'.repeat(size / 4) }]) })))
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
function run(modules: Modules, c: Case, inspected: boolean, range: boolean, instrumented: boolean): Output {
  const reads = sourceCounts()
  const questions: unknown[] = []
  let contexts = 0, canvasCalls = 0, canvasSubmittedUtf16 = 0
  class Context {
    constructor(readonly id: number) {}
    font = '16px Arial'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16)
      let width = 0
      for (const ch of text) {
        if (/^[\p{Mark}\p{Default_Ignorable_Code_Point}]$/u.test(ch)) continue
        width += ((8 * 65536 + ch.codePointAt(0)! % 7) / 65536) * size / 16 + Number.parseFloat(this.letterSpacing)
      }
      width = Math.fround(width)
      canvasCalls++; canvasSubmittedUtf16 += text.length
      questions.push(['canvas', this.id, text, SETTINGS.map(key => this[key]), width, 0, width])
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    getContext(): Context {
      const id = contexts++, context = new Context(id)
      questions.push(['context', id])
      return new Proxy(context, {
        set(target, key, value) {
          Reflect.set(target, key, value)
          questions.push(['set', id, String(key), value])
          return true
        },
      })
    }
  } })
  const restore = instrumented ? instrumentLineSources(modules.iterator.LineBreakIterator.prototype, modules.breaker.LineBreaker.prototype, reads) : () => {}
  try {
    const p = modules.lib.prepare(c.paragraph, environment, inspected, modules.pool.createContextPool())
    const layout = () => {
    const rows: unknown[] = []
    let visibleLineBoxes = 0
    for (let start = modules.lib.firstLine(p); start !== null;) {
      if (rows.length > 10000) throw new Error('line iteration did not finish')
      const result = range ? modules.lib.fillLineRange(p, start, { width: c.width, left: 0, right: 0 }) : modules.lib.fillLine(p, start, { width: c.width, left: 0, right: 0 })
      if (result.kind === 'below-floats') throw new Error('unexpected float refusal in a zero-inset growth control')
      if (result.hasLineBox) visibleLineBoxes++
      rows.push({ kind: result.kind, start: result.start, end: result.end, next: result.next, hasLineBox: result.hasLineBox })
      start = result.next
    }
    return { rows, visibleLineBoxes }
    }
    layout() // exactly the same retained width before the observed repeat
    questions.length = 0; canvasCalls = 0; canvasSubmittedUtf16 = 0
    reads.charCodeCalls = { setup: 0, break: 0, finalize: 0 }
    reads.sliceCalls = 0; reads.slicedUtf16 = 0; reads.identitySearchCalls = 0; reads.identityComparisons = 0
    let prefixReads = 0
    const originals = p.groups.map(group => group.prefix16)
    if (instrumented) for (const group of p.groups) {
      const original = group.prefix16
      group.prefix16 = new Proxy(original, {
        get(target, key) {
          if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)) prefixReads++
          return Reflect.get(target, key, target)
        },
        set(target, key, value) { return Reflect.set(target, key, value, target) },
      })
    }
    try { return { ...layout(), questions, canvasCalls, canvasSubmittedUtf16, reads, prefixReads } }
    finally { p.groups.forEach((group, i) => { group.prefix16 = originals[i]! }) }
  } finally {
    restore()
    if (descriptor === undefined) delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    else Object.defineProperty(globalThis, 'OffscreenCanvas', descriptor)
  }
}
function publicDifference(a: Output, b: Output): string | null {
  if (!isDeepStrictEqual(a.rows, b.rows) || a.visibleLineBoxes !== b.visibleLineBoxes) return 'source bounds/continuations/line boxes differ'
  if (!isDeepStrictEqual(a.questions, b.questions)) {
    const i = a.questions.findIndex((value, index) => !isDeepStrictEqual(value, b.questions[index]))
    return `ordered Canvas/settings event ${i < 0 ? a.questions.length : i} differs (${a.questions.length}/${b.questions.length} events)`
  }
  return null
}
function summary(output: Output) {
  return { filledRecords: output.rows.length, visibleLineBoxes: output.visibleLineBoxes, rows: output.rows,
    questionsHash: hash(JSON.stringify(output.questions)), canvasCalls: output.canvasCalls,
    canvasSubmittedUtf16: output.canvasSubmittedUtf16, reads: output.reads, prefixReads: output.prefixReads }
}
const records: unknown[] = []
let failures = 0
for (const c of cases) {
  for (const inspected of [false, true]) {
    const raw = run(base, c, inspected, false, false)
    const reference = run(base, c, inspected, false, true)
    const instrumentation = publicDifference(raw, reference)
    if (c.family === 'ascii-word' && reference.reads.charCodeCalls.break === 0) throw new Error('source observer did not see any break-phase reads')
    if (!inspected && reference.prefixReads === 0) throw new Error('prefix observer did not see prepared positions')
    if (instrumentation !== null) throw new Error(`instrumentation changed ${c.family}/${c.size}/${c.width}/${inspected}: ${instrumentation}`)
    for (const range of [false, true]) {
      const candidate = run(head, c, inspected, range, true)
      const difference = publicDifference(reference, candidate)
      if (difference !== null) failures++
      records.push({ family: c.family, size: c.size, sourceUtf16: c.size,
        leaves: 1, width: c.width, inspected, output: range ? 'range' : 'full',
        instrumentationPreservedOutputAndQuestions: true, difference, base: summary(reference), head: summary(candidate) })
      process.stdout.write(`${c.family} N${c.size} width${c.width} ${inspected ? 'inspected' : 'plain'} ${range ? 'range' : 'full'}: ${difference ?? 'equal'}; prefix reads ${reference.prefixReads}->${candidate.prefixReads}; Canvas ${reference.canvasCalls}->${candidate.canvasCalls}\n`)
    }
  }
}
const after = { base: seal(baseRoot), head: seal(headRoot) }
const stable = isDeepStrictEqual(before, after)
const result = { method: 'Retained-width numeric reads of prepared group.prefix16 via local delegated Proxy, plus immutable iterator-source facade; no global prototypes changed, no timing or browser claim',
  scope: 'Actual perf normal/break-word policy, unknown Arial facts, source abcd repeated N units, widths24/36/48. One unobserved warm fill then one repeat. Numeric prefix reads count accesses, not abstract search calls or native shaping. Complete count/cuts/continuations and ordered Canvas streams are compared for plain/inspected full/range. Baseline instrumentation must preserve its own output/questions; no universal work or performance claim.',
  base: baseRoot, head: headRoot, environment, sizes, cases: cases.length, comparisons: records.length, failures,
  sourceStable: stable, before, after, helperHash: hash(readFileSync(import.meta.path, 'utf8')),
  counterHash: hash(readFileSync(join(import.meta.dir, 'blink-source-counter.ts'), 'utf8')),
  inputHash: hash(JSON.stringify(cases)), records }
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n')
if (!stable || failures > 0) process.exitCode = 1
