// Cheap owned-read growth, not browser accuracy, native timing, or a total shaping bound.
// bun rebuild/experiments/plaintext-round/blink-line-growth.ts --base=/path/to/A6 --out=/private/tmp/growth.json
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../src/env.js'
import { UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../src/model.js'
import { instrumentLineSources, sourceCounts, type SourceCounts } from './blink-source-counter.ts'

type Lib = typeof import('../../src/engines/blink/index.js')
type Modules = { lib: Lib; pool: typeof import('../../src/measure/canvas.js');
  iterator: typeof import('../../src/engines/blink/breaks.js'); breaker: typeof import('../../src/engines/blink/line-breaker.js') }
type Case = { family: 'ascii-word' | 'shy-leaves'; size: number; width: number; paragraph: Paragraph }
type Output = { rows: unknown[]; visibleLineBoxes: number; questions: unknown[]; canvasCalls: number; canvasSubmittedUtf16: number; reads: SourceCounts }
const options = new Map(process.argv.slice(2).map(arg => {
  const match = /^--(base|head|out|sizes)=(.+)$/s.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  return [match[1]!, match[2]!] as const
}))
const baseRoot = resolve(options.get('base') ?? '/private/tmp/pretext-stateless-round2-baseline-20260922')
const headRoot = resolve(options.get('head') ?? join(import.meta.dir, '../../..'))
const outputPath = resolve(options.get('out') ?? '/private/tmp/pretext-blink-line-growth.json')
const sizes = (options.get('sizes') ?? '64,128,256,512').split(',').map(Number)
if (sizes.some(n => !Number.isSafeInteger(n) || n < 1 || n > 2048)) throw new Error('sizes must be integers in 1..2048')
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
function seal(root: string): string {
  const files: Array<[string, string]> = []
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith('.js') && existsSync(path.slice(0, -3) + '.ts')) throw new Error(`emitted JS sidecar bypasses the source counter: ${path}`)
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
  // These complete facts describe the synthetic backend below, not an installed font.
  return { font: { family: 'ReadCounterFont', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS,
      primaryFamily: 'ReadCounterFont', mapsHyphen: true, monospace: false, opticalSizeAxis: false, joining: 'opentype', pairKerning: 'first-advance',
      fonts: [{ family: 'ReadCounterFont', realizes: true, coverage: [0, 0x10ffff],
        ligatures: { patterns: [], complete: true, languageSystems: [] }, spacingInputs: [], scriptLookups: [] }] } },
    content, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
    lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}
const cases: Case[] = sizes.flatMap(size => [
  ...[8, 32].map(width => ({ family: 'ascii-word' as const, size, width, paragraph: paragraph([{ kind: 'text', text: 'a'.repeat(size) }]) })),
  { family: 'shy-leaves' as const, size, width: size * 20 + 64,
    paragraph: paragraph(Array.from({ length: size }, () => ({ kind: 'text' as const, text: 'a\u00ad' }))) },
])
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
function run(modules: Modules, c: Case, inspected: boolean, range: boolean, instrumented: boolean): Output {
  const reads = sourceCounts()
  const questions: unknown[] = []
  let contexts = 0, canvasCalls = 0, canvasSubmittedUtf16 = 0
  class Context {
    constructor(readonly id: number) {}
    font = '16px ReadCounterFont'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
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
    return { rows, visibleLineBoxes, questions, canvasCalls, canvasSubmittedUtf16, reads }
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
    canvasSubmittedUtf16: output.canvasSubmittedUtf16, reads: output.reads }
}
const records: unknown[] = []
let failures = 0
for (const c of cases) {
  for (const inspected of [false, true]) {
    const raw = run(base, c, inspected, false, false)
    const reference = run(base, c, inspected, false, true)
    const instrumentation = publicDifference(raw, reference)
    if (c.family === 'ascii-word' && reference.reads.charCodeCalls.break === 0) throw new Error('source observer did not see any break-phase reads')
    if (c.family === 'shy-leaves' && reference.reads.identitySearchCalls === 0) throw new Error('identity observer did not see the baseline SHY searches')
    if (instrumentation !== null) throw new Error(`instrumentation changed ${c.family}/${c.size}/${c.width}/${inspected}: ${instrumentation}`)
    for (const range of [false, true]) {
      const candidate = run(head, c, inspected, range, true)
      const difference = publicDifference(reference, candidate)
      if (difference !== null) failures++
      records.push({ family: c.family, size: c.size, sourceUtf16: c.family === 'ascii-word' ? c.size : c.size * 2,
        leaves: c.family === 'ascii-word' ? 1 : c.size, width: c.width, inspected, output: range ? 'range' : 'full',
        instrumentationPreservedOutputAndQuestions: true, difference, base: summary(reference), head: summary(candidate) })
      process.stdout.write(`${c.family} N${c.size} width${c.width} ${inspected ? 'inspected' : 'plain'} ${range ? 'range' : 'full'}: ${difference ?? 'equal'}; finalize reads ${reference.reads.charCodeCalls.finalize}->${candidate.reads.charCodeCalls.finalize}; identity comparisons ${reference.reads.identityComparisons}->${candidate.reads.identityComparisons}\n`)
    }
  }
}
const after = { base: seal(baseRoot), head: seal(headRoot) }
const stable = isDeepStrictEqual(before, after)
const result = { method: 'Test-only immutable iterator source facade; own result-array identity-search counter; no timing or browser claim',
  scope: 'charCodeAt calls made directly by LazyLineBreakIterator, split around breakLine. Slice units handed to ICU are reported separately, not counted as ICU reads. Finalize reads isolate decisionEnd look-ahead on these unbroken ASCII cases. Result identity comparisons count Array.indexOf searches in dense owned rows. Canvas counts are not a linear-work claim.',
  base: baseRoot, head: headRoot, environment, sizes, cases: cases.length, comparisons: records.length, failures,
  sourceStable: stable, before, after, helperHash: hash(readFileSync(import.meta.path, 'utf8')),
  counterHash: hash(readFileSync(join(import.meta.dir, 'blink-source-counter.ts'), 'utf8')),
  inputHash: hash(JSON.stringify(cases)), records }
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n')
if (!stable || failures > 0) process.exitCode = 1
