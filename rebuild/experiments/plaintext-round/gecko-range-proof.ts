// Exact Gecko output-boundary proof. A controlled backend tests equivalence, not browser accuracy.
// bun rebuild/experiments/plaintext-round/gecko-range-proof.ts /absolute/baseline/rebuild/src [--timing]
import { isDeepStrictEqual } from 'node:util'
import { performance } from 'node:perf_hooks'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../src/env.js'
import { createContextPool } from '../../src/measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type InlineElement, type Paragraph } from '../../src/model.js'
import * as current from '../../src/engines/gecko/index.js'
import { fillLineRange, type GeckoRangeFillResult, type SpanData } from '../../src/engines/gecko/lines.js'

const baselineRoot = process.argv[2]
if (baselineRoot === undefined) throw new Error('supply the frozen baseline src directory')
const baseline: typeof current = await import(`${baselineRoot}/engines/gecko/index.ts`)
const baselineCanvas: { createContextPool: typeof createContextPool } = await import(`${baselineRoot}/measure/canvas.ts`)
let queries: unknown[] = []
class Context {
  font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string) {
    queries.push({ text, font: this.font, lang: this.lang, letterSpacing: this.letterSpacing, wordSpacing: this.wordSpacing,
      fontKerning: this.fontKerning, textRendering: this.textRendering, direction: this.direction })
    const cps = [...text]
    let width = 0
    for (let i = 0; i < cps.length; i++) {
      const ch = cps[i]!
      if (/^[\p{M}\p{Default_Ignorable_Code_Point}]$/u.test(ch)) continue
      width += 10 + Number.parseFloat(this.letterSpacing)
      if (ch === ' ') width += Number.parseFloat(this.wordSpacing)
      if (ch === 'A' && cps[i + 1] === 'V') width -= 1
      if (ch === 'f' && cps[i + 1] === 'f') width -= 2
      if (ch === 'ب') width -= (cps[i - 1] === 'ب' ? 0.5 : 0) + (cps[i + 1] === 'ب' ? 0.5 : 0)
    }
    width = Math.fround(width)
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
const env: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null,
  regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' } }
const font = { family: 'Optima', size: 16, weight: 400, style: 'normal' as const,
  facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false, pairKerning: 'first-advance' as const } }
function paragraph(content: InlineNode[], extra: Partial<Paragraph> = {}): Paragraph {
  return { font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
    lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content, ...extra }
}
function span(children: InlineNode[], extra: Partial<InlineElement> = {}): InlineElement {
  return { kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
    lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children, ...extra }
}
const text = (value: string): InlineNode => ({ kind: 'text', text: value })
function nested(depth: number, children: InlineNode[]): InlineNode[] {
  for (let i = 0; i < depth; i++) children = [span(children)]
  return children
}
type Case = { name: string; paragraph: Paragraph; floats?: boolean }
const cases: Case[] = [
  { name: 'empty', paragraph: paragraph([]) },
  { name: 'empty-span', paragraph: paragraph([span([])]) },
  { name: 'nested-empty-with-edges', paragraph: paragraph([span([span([])], { inlineStart: { margin: -2, border: 1, padding: 3 }, inlineEnd: { margin: 4, border: 2, padding: 5 } }), text('a b')]) },
  { name: 'empty-text-and-controls', paragraph: paragraph([span([text(''), text('\u200e\u202a\u202c')]), text('a b')]) },
  { name: 'br-wbr', paragraph: paragraph([span([{ kind: 'wbr' }, { kind: 'br' }]), text('a'), { kind: 'br' }, { kind: 'wbr' }, text('bc')]) },
  { name: 'empty-span-before-pushed-object', paragraph: paragraph([text('ab '), span([]), span([{ kind: 'atomic', width: 45, height: 12, marginInlineStart: -3, marginInlineEnd: 4 }]), text('c')]) },
  { name: 'nested-retry', paragraph: paragraph([span([text('abc '), span([text('de fghi')], { inlineStart: { margin: 2, border: 1, padding: 3 }, inlineEnd: { margin: 2, border: 1, padding: 4 } })]), text(' jk')]) },
  { name: 'float-refusal', floats: true, paragraph: paragraph([span([text('abc def')]), { kind: 'atomic', width: 45, height: 12, marginInlineStart: 0, marginInlineEnd: 0 }]) },
  { name: 'tabs-after-span', paragraph: paragraph([span([text('ab')], { whiteSpace: 'pre-wrap' }), text('\tAV\t\u0301x')], { whiteSpace: 'pre-wrap' }) },
  { name: 'bidi-span-continuations', paragraph: paragraph([span([text('aא bב cג')]), text(' אבג')], { direction: 'rtl' }) },
]
for (const whiteSpace of ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces'] as const) {
  for (const textAlign of ['start', 'justify'] as const) cases.push({ name: `${whiteSpace}-${textAlign}`,
    paragraph: paragraph([text('  AV office\t x\n y\u00adz  ')], { whiteSpace, textAlign }) })
}
for (const n of [32, 128, 512]) {
  cases.push({ name: `latin-${n}`, paragraph: paragraph([text('a b c '.repeat(n))]) })
  cases.push({ name: `latin-justified-${n}`, paragraph: paragraph([text('a b c '.repeat(n))], { textAlign: 'justify' }) })
  cases.push({ name: `longword-${n}`, paragraph: paragraph([text('AVff'.repeat(n))], { letterSpacing: -1.25, wordBreak: 'break-all' }) })
  cases.push({ name: `joining-${n}`, paragraph: paragraph([text('ب'.repeat(n))], { letterSpacing: -2.5 }) })
  cases.push({ name: `alternating-${n}`, paragraph: paragraph([text('aא漢'.repeat(n))]) })
  cases.push({ name: `nested-${n}`, paragraph: paragraph(nested(n, [text('a b c')])) })
}
const widths = [1, 10, 19.999, 20, 37, 320, 1_000_000, 37]
function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`equivalence failed: ${label}`)
}
function frameData(root: SpanData): { rows: unknown[]; records: number } {
  const rows: unknown[] = []
  const stack: SpanData[] = [root]
  let records = 0
  while (stack.length > 0) {
    const s = stack.pop()!
    rows.push({ span: s.element, iStart: s.iStart, iCoord: s.iCoord, iEnd: s.iEnd, noWrap: s.noWrap, hasNonemptyContent: s.hasNonemptyContent, parent: s.parent?.element ?? null })
    for (const f of s.frames) {
      records++
      if (f.kind === 'span') { const { span: child, ...rest } = f; rows.push(rest); stack.push(child) }
      else if (f.kind === 'text') {
        const { prov, ...r } = f.r
        rows.push({ ...f, r: { ...r, prov: prov === null ? null : { frame: prov.frame, start: prov.start, length: prov.length,
          startT: prov.startT, startOfLine: prov.startOfLine, letterSpacingAu: prov.letterSpacingAu, tabs: prov.tabs } } })
      } else rows.push(f)
    }
  }
  return { rows, records }
}
function hasFullRecord(result: GeckoRangeFillResult | current.GeckoFillResult): result is current.GeckoFillResult {
  return 'line' in result
}
function run(c: Case, inspected: boolean, variant: 'baseline' | 'full' | 'range') {
  const api = variant === 'baseline' ? baseline : current
  queries = []
  const p = api.prepare(c.paragraph, env, inspected, variant === 'baseline' ? baselineCanvas.createContextPool() : createContextPool())
  const prepQueries = queries
  const layouts: { ranges: GeckoRangeFillResult[]; outputs: unknown[] }[] = []
  const fillQueries: unknown[] = []
  const outputQueries: unknown[] = []
  let records = 0, lines = 0, refusals = 0
  for (const width of widths) {
    const ranges: GeckoRangeFillResult[] = [], outputs: unknown[] = []
    let start = api.firstLine(p), first = true, steps = 0
    while (start !== null) {
      if (++steps > 100_000) throw new Error('nontermination')
      const slot = { width, left: c.floats && first ? width : 0, right: 0 }
      queries = []
      const filled = variant === 'range' ? fillLineRange(p, start, slot) : api.fillLine(p, start, slot)
      fillQueries.push(queries)
      const { kind, next } = filled
      const range: GeckoRangeFillResult = kind === 'below-floats' ? { kind, next } : { kind, next, start: filled.start, end: filled.end, hasLineBox: filled.hasLineBox }
      ranges.push(range)
      if (kind === 'below-floats') refusals++
      else lines++
      if (hasFullRecord(filled)) {
        queries = []
        if (filled.kind === 'line') {
          const framed = frameData(filled.line.root)
          records += framed.records
          outputs.push({ frames: framed.rows, lineEndsInBR: filled.line.lineEndsInBR, lineWrapped: filled.line.lineWrapped,
            pieces: api.linePieces(p, filled.line), inspection: inspected ? api.inspectLine(p, filled.line) : null })
        } else outputs.push(inspected ? api.inspectLine(p, filled.line) : null)
        outputQueries.push(queries)
      }
      start = next; first = false
    }
    layouts.push({ ranges, outputs })
  }
  return { prepQueries, fillQueries, outputQueries, layouts, records, lines, refusals }
}
let compared = 0, fullRecords = 0, lines = 0, refusals = 0, submittedUnits = 0
for (const c of cases) for (const inspected of [false, true]) {
  const old = run(c, inspected, 'baseline'), full = run(c, inspected, 'full'), range = run(c, inspected, 'range')
  const label = `${c.name} inspected=${inspected}`
  equal(full, old, `${label} complete full outputs + all ordered queries`)
  equal(range.prepQueries, full.prepQueries, `${label} range preparation queries`)
  equal(range.fillQueries, full.fillQueries, `${label} range break queries`)
  equal(range.layouts.map(x => x.ranges), full.layouts.map(x => x.ranges), `${label} exact range/cursor/box decisions`)
  compared += widths.length
  if (!inspected) fullRecords += full.records
  lines += full.lines; refusals += full.refusals
  for (const qs of full.fillQueries as { text: string }[][]) for (const q of qs) submittedUnits += q.text.length
}
console.log(JSON.stringify({ cases: cases.length, inspectedAndPlainWidthLayouts: compared, completeFullOutputsEqual: true,
  orderedPreparationAndBreakQueriesEqual: true, rangeDecisionsEqual: true, plainRetainedFrameRecordsOmitted: fullRecords,
  linesCompared: lines, floatRefusalsCompared: refusals, breakSubmittedUnits: submittedUnits }, null, 2))
if (process.argv.includes('--timing')) {
  // Controlled JavaScript evidence only: warm engine measurement caches before timing repeated width fills.
  const timingCases = cases.filter(c => ['latin-128', 'latin-justified-128', 'longword-128', 'joining-128', 'alternating-128', 'nested-128'].includes(c.name))
  const rows = []
  for (const c of timingCases) {
    const p = current.prepare(c.paragraph, env, false, createContextPool())
    function fill(rangeOnly: boolean) {
      let count = 0
      for (let start = current.firstLine(p); start !== null;) {
        const filled = rangeOnly ? fillLineRange(p, start, { width: 37, left: 0, right: 0 }) : current.fillLine(p, start, { width: 37, left: 0, right: 0 })
        if (filled.kind !== 'line') throw new Error('unexpected refusal')
        count++; start = filled.next
      }
      return count
    }
    fill(false); fill(true)
    const samples = { full: [] as number[], range: [] as number[] }
    for (let sample = 0; sample < 12; sample++) for (const rangeOnly of sample % 2 === 0 ? [false, true] : [true, false]) {
      const begin = performance.now()
      for (let repeat = 0; repeat < 20; repeat++) fill(rangeOnly)
      samples[rangeOnly ? 'range' : 'full'].push((performance.now() - begin) / 20)
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >>> 1]!
    rows.push({ case: c.name, fullMs: median(samples.full), rangeMs: median(samples.range), rangeOverFull: median(samples.range) / median(samples.full), lineCount: fill(true) })
  }
  console.log(JSON.stringify({ controlledBackendRepeatedWidthTimings: rows }, null, 2))
}
