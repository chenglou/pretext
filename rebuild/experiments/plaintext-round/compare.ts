// Independent two-tree proof. No browser, timing claim or production source transform.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Environment, EngineName, FillResult, GivenFacts, Prepared, RangeFillResult } from '../../src/index.js'
import { installStandInCanvas, type PageFacts } from '../../tools/stand-in-canvas.ts'
import { cases } from './cases.ts'

type Lib = Pick<typeof import('../../src/index.js'), 'prepare' | 'firstLine' | 'fillLine' | 'linePieces' | 'inspectLine' | 'paragraphGaps'> & Partial<Pick<typeof import('../../src/index.js'), 'fillLineRange'>>
type Read = 'pieces-first' | 'inspection-first' | 'all-pieces-first'
type Output = { width: number; lines: unknown[]; gaps: unknown }
type Run = { outputs: Output[]; raw: unknown[]; events: unknown[]; contexts: number; calls: number; submittedUtf16: number }
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontVariantCaps', 'fontStretch', 'textAlign', 'textBaseline'] as const
const METRICS = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent'] as const
const UAS: Record<EngineName, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
}
const facts = {
  blink: { engine: 'blink', build: '153.0.8010.50', contentLanguage: null, uiLanguage: 'en-US' },
  gecko: { engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: 'en-US' },
  webkit: { engine: 'webkit', build: '22625.1.29.11.27', contentLanguage: null, pageZoom: 1, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX' },
} as const satisfies Record<EngineName, GivenFacts>
function environment(engine: EngineName, pageLang: string): Environment {
  const shared = { devicePixelRatio: 2, pageLang }
  switch (engine) {
    case 'blink': return { ...facts.blink, ...shared, dictionaryBreaks: { kind: 'v8-break-iterator' } }
    case 'gecko': return { ...facts.gecko, ...shared, dictionaryBreaks: { kind: 'intl-segmenter-word' } }
    case 'webkit': return { ...facts.webkit, ...shared, dictionaryBreaks: { kind: 'intl-segmenter-word' } }
  }
}
const options = new Map<string, string>()
let strictRaw = false, captureRaw = false, progress = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--strict-raw') { strictRaw = true; captureRaw = true; continue }
  if (arg === '--raw') { captureRaw = true; continue }
  if (arg === '--progress') { progress = true; continue }
  const match = /^--(base|head|engines|cases|growth|out|read)=(.*)$/s.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  options.set(match[1]!, match[2]!)
}
const base = resolve(options.get('base') ?? '/private/tmp/pretext-stateless-baseline-20260921')
const head = resolve(options.get('head') ?? join(import.meta.dir, '../../..'))
const engines = (options.get('engines') ?? 'blink,gecko,webkit').split(',')
for (const engine of engines) if (!(engine in UAS)) throw new Error(`Unknown engine ${engine}`)
const mode = options.get('read') ?? 'full'
if (mode !== 'full' && mode !== 'count' && mode !== 'range') throw new Error('--read must be full, count or range')
if (mode === 'range' && captureRaw) throw new Error('Raw decided-line records require --read=full or count')
const growth = (options.get('growth') ?? '64,128,256').split(',').filter(n => n !== '').map(Number)
for (const n of growth) if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid growth size ${n}`)
const selected = cases(growth).filter(c => options.get('cases') === undefined || new RegExp(options.get('cases')!).test(c.id))
if (selected.length === 0) throw new Error('No cases selected')
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown
function seal(tree: string): string {
  const chunks: string[] = []
  function visit(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (name.endsWith('.ts')) chunks.push(path.slice(tree.length), hash(readFileSync(path, 'utf8')))
      else if (!name.includes('.')) visit(path)
    }
  }
  visit(join(tree, 'rebuild/src'))
  return hash(JSON.stringify(chunks))
}
function difference(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`.slice(0, 400)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = difference(a[i], b[i], `${path}[${i}]`); if (d !== null) return d }
    return null
  }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = difference(x[key], y[key], `${path}.${key}`); if (d !== null) return d }
  return null
}
function capture(env: PageFacts, work: (run: Run) => void): Run {
  const standIn = installStandInCanvas(env)
  const run: Run = { outputs: [], raw: [], events: [], contexts: 0, calls: 0, submittedUtf16: 0 }
  type Context = Record<string, unknown> & { measureText(text: string): Record<string, number> }
  const globals = globalThis as unknown as { OffscreenCanvas: new () => { getContext(): Context } }
  const Canvas = globals.OffscreenCanvas
  globals.OffscreenCanvas = class {
    inner = new Canvas()
    getContext(): Context {
      const context = this.inner.getContext(), id = run.contexts++
      run.events.push(['context', id])
      return new Proxy(context, {
        set(target, key, value) { target[String(key)] = value; run.events.push(['set', id, String(key), value]); return true },
        get(target, key) {
          if (key === 'measureText') return (text: string): Record<string, number> => {
            const result = target.measureText(text)
            run.calls++; run.submittedUtf16 += text.length
            run.events.push(['canvas', id, text, SETTINGS.map(p => target[p]), METRICS.map(p => result[p])])
            return result
          }
          const value = target[String(key)]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
  }
  try { work(run); return run } finally { standIn.restore() }
}
function layout(lib: Lib, p: Prepared, width: number, inspect: boolean, read: Read, run: Run, c: typeof selected[number], useRange: boolean): Output {
  const filled: FillResult[] = [], observable: unknown[] = [], raw: unknown[] = [], pieces: unknown[] = [], inspections: unknown[] = []
  for (let start = lib.firstLine(p); start !== null;) {
    if (observable.length > 100000) throw new Error('Line iteration did not finish')
    const inset = c.insets?.[observable.length] ?? { left: 0, right: 0 }
    const slot = { width, ...inset }
    const full = useRange && lib.fillLineRange !== undefined ? null : lib.fillLine(p, start, slot)
    const result: FillResult | RangeFillResult = full ?? lib.fillLineRange!(p, start, slot)
    if (captureRaw && mode !== 'range' && full !== null) raw.push(clone(full.line))
    observable.push(result.kind === 'below-floats' ? { kind: result.kind, next: clone(result.next) } : { kind: result.kind, start: result.start, end: result.end, next: clone(result.next), hasLineBox: result.hasLineBox })
    if (mode === 'full') {
      if (full === null) throw new Error('Full fill returned no decided-line record')
      filled.push(full)
      if (full.kind === 'below-floats') {
        pieces.push(null)
        if (inspect) inspections.push(clone(lib.inspectLine(p, full.line)))
      } else if (read !== 'all-pieces-first') {
        if (inspect && read === 'inspection-first') inspections.push(clone(lib.inspectLine(p, full.line)))
        pieces.push(clone(lib.linePieces(p, full.line)))
        if (inspect && read === 'pieces-first') inspections.push(clone(lib.inspectLine(p, full.line)))
      }
    }
    start = result.next
  }
  if (mode === 'full' && read === 'all-pieces-first') {
    pieces.length = 0; inspections.length = 0
    for (const result of filled) pieces.push(result.kind === 'line' ? clone(lib.linePieces(p, result.line)) : null)
    if (inspect) for (const result of filled) inspections.push(clone(lib.inspectLine(p, result.line)))
  }
  run.raw.push({ width, lines: raw })
  return { width, lines: observable.map((fill, i) => ({ fill, pieces: pieces[i] ?? null, inspection: inspections[i] ?? null })), gaps: inspect ? clone(lib.paragraphGaps(p)) : null }
}
function execute(lib: Lib, c: typeof selected[number], engine: EngineName, inspect: boolean, widths: readonly number[], read: Read, useRange: boolean): Run {
  return capture({ userAgent: UAS[engine], devicePixelRatio: 2, pageLang: c.paragraph.lang }, run => {
    const env = environment(engine, c.paragraph.lang)
    const p = lib.prepare(structuredClone(c.paragraph), env, inspect)
    for (const width of widths) run.outputs.push(layout(lib, p, width, inspect, read, run, c, useRange))
  })
}
const toolSeal = (): string => hash(JSON.stringify([import.meta.filename, join(import.meta.dir, 'cases.ts'), join(import.meta.dir, '../../tools/stand-in-canvas.ts')].map(path => [path, hash(readFileSync(path, 'utf8'))])))
const before = { base: seal(base), head: seal(head), cases: hash(JSON.stringify(selected)), tool: toolSeal() }
const libs = await Promise.all([import(join(base, 'rebuild/src/index.ts')), import(join(head, 'rebuild/src/index.ts'))]) as [Lib, Lib]
if (mode === 'range' && libs[1].fillLineRange === undefined) throw new Error('Candidate has no fillLineRange API')
const rows: unknown[] = [], failures: unknown[] = []
let rawChangedRows = 0, layouts = 0, canvasCalls = 0, lines = 0
for (const engineName of engines) {
  const engine = engineName as EngineName
  for (const c of selected) for (const inspect of [false, true]) {
    if (progress) console.log(JSON.stringify({ engine, case: c.id, inspect, rows: rows.length, stage: 'starting' }))
    const fresh = new Map<number, Output>()
    const compare = (name: string, widths: readonly number[], read: Read, retained: boolean): void => {
      const a = execute(libs[0], c, engine, inspect, widths, read, false), b = execute(libs[1], c, engine, inspect, widths, read, mode === 'range')
      const output = difference(a.outputs, b.outputs), questions = difference(a.events, b.events), raw = difference(a.raw, b.raw)
      let independence: string | null = null
      if (retained) for (const item of a.outputs) { const d = difference(fresh.get(item.width), item); if (d !== null) { independence = d; break } }
      else fresh.set(widths[0]!, a.outputs[0]!)
      const row = { engine, id: c.id, growth: c.growth, units: c.paragraph.content.reduce((n, node) => n + (node.kind === 'text' ? node.text.length : 0), 0), inspect, scenario: name,
        layouts: widths.length, lines: a.outputs.reduce((n, o) => n + o.lines.length, 0), calls: a.calls, submittedUtf16: a.submittedUtf16,
        output, questions, independence, rawChanged: raw !== null, outputSha256: hash(JSON.stringify(a.outputs)), questionsSha256: hash(JSON.stringify(a.events)) }
      rows.push(row); layouts += widths.length; canvasCalls += a.calls; lines += row.lines
      if (raw !== null) rawChangedRows++
      if (output !== null || questions !== null || independence !== null || (strictRaw && raw !== null)) failures.push({ ...row, raw: strictRaw ? raw : null })
    }
    for (const width of c.widths) compare(`fresh/${width}`, [width], 'pieces-first', false)
    const ascending = [...c.widths].sort((a, b) => a - b), descending = [...ascending].reverse()
    const interleaved = [...ascending.filter((_, i) => i % 2 === 1).reverse(), ...ascending.filter((_, i) => i % 2 === 0)]
    for (const [name, widths, read] of [['ascending', ascending, 'pieces-first'], ['descending', descending, 'inspection-first'], ['interleaved', interleaved, 'all-pieces-first']] as const) {
      compare(`${name}/first-and-repeated`, [...widths, ...widths], read, true)
    }
  }
  console.log(JSON.stringify({ engine, cases: selected.length, rows: rows.length, failures: failures.length }))
}
const after = { base: seal(base), head: seal(head), cases: hash(JSON.stringify(selected)), tool: toolSeal() }
const stable = JSON.stringify(before) === JSON.stringify(after)
const report = { schema: 'plaintext-two-tree-proof/1', nativeBrowserEvidence: false, performanceEvidence: false,
  backend: 'existing rebuild/tools/stand-in-canvas.ts; native accuracy and real Canvas-history effects require browser validation',
  scope: 'complete observable source ranges/next states/line flags, pieces, geometry/gaps and ordered context creation/settings/Canvas questions/answers; raw decided-line records optionally strict',
  base, head, bunVersion: Bun.version, before, after, stable, mode, strictRaw, rawCaptured: captureRaw, engines, cases: selected.length, rows: rows.length, layouts, lines, canvasCalls, rawChangedRows, failures, observations: rows }
const out = options.get('out')
if (out !== undefined) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`) }
console.log(JSON.stringify({ stable, cases: selected.length, rows: rows.length, layouts, lines, canvasCalls, rawChangedRows, failures: failures.length, out: out ?? null }))
if (!stable || failures.length > 0) process.exit(1)
