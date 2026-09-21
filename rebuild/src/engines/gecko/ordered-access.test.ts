import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { createContextPool, type CanvasSettings, type Context } from '../../measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, linePieces } from './index.js'
import { rangeAdvance } from './lines.js'
import { rangeAu, runContextsFor } from './measure.js'
import { prepareGecko } from './prepare.js'
import { advanceBefore } from './advance.js'
import type { RunContexts } from './types.js'

beforeAll(() => {
  class Context {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string) {
      let au = 0
      const spacing = Math.round(Number.parseFloat(this.letterSpacing) * 60)
      for (const ch of text) if (!/^[\p{M}\p{Default_Ignorable_Code_Point}]$/u.test(ch)) au += 600 + spacing
      const width = Math.fround(au / 60)
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
})
const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null,
  regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false, pairKerning: 'first-advance' } }
const paragraph = (text: string, extra: Partial<Paragraph> = {}): Paragraph => ({
  font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'pre-wrap', wordBreak: 'normal', overflowWrap: 'anywhere',
  lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }], ...extra,
})

// Count actual indexed metadata reads, without changing any answer or relying on host timing.
function counted<T>(values: T[]): { values: T[]; reads: () => number } {
  let reads = 0
  return { values: new Proxy(values, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, receiver)
  } }), reads: () => reads }
}

test('short tab ranges visit their ordered interval rather than every tab of a long decided line', () => {
  const p = prepareGecko(paragraph('a\t'.repeat(4096), { overflowWrap: 'normal' }), env, false, createContextPool())
  const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  const frame = filled.line.root.frames[0]!
  if (frame.kind !== 'text' || frame.r.prov === null) throw new Error('missing text provider')
  const actual = frame.r.prov
  const tabs = counted([...actual.tabs]), prov = { ...actual, tabs: tabs.values }
  let ranges = 0
  // Non-monotone queries: geometry consumers need arbitrary intervals, not just a forward cursor.
  for (let k = 4095; k >= 0; k -= 37) {
    const tab = actual.tabs[k]!
    expect(rangeAdvance(p, prov, tab.t, tab.t + 1, null)).toBe(tab.width)
    expect(rangeAdvance(p, prov, tab.t - 1, tab.t, null)).toBe(600)
    ranges += 2
  }
  expect(tabs.reads()).toBeLessThan(40 * ranges)
})

test('one long mixed-script text run answers arbitrary later ranges without rescanning earlier script runs', () => {
  const p = prepareGecko(paragraph('a漢'.repeat(2048), { whiteSpace: 'normal' }), env, false, createContextPool())
  const run = p.textRuns[0]!, scripts = counted(run.scriptRuns)
  expect(run.scriptRuns.length).toBe(4096)
  const queried = { ...run, scriptRuns: scripts.values }
  let ranges = 0
  for (let t = 4095; t >= 0; t -= 31) {
    expect(rangeAu(run.contexts.own, queried, p.tUnits, t, t + 1)).toBe(600)
    ranges++
  }
  expect(scripts.reads()).toBeLessThan(20 * ranges)
})

test('one span with many bidi continuations finds each sorted close without revisiting all earlier closes', () => {
  const text = 'aא'.repeat(1024), block = paragraph(text, { whiteSpace: 'normal', overflowWrap: 'normal' })
  const span: InlineNode = {
    kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text }],
  }
  const p = prepareGecko({ ...block, content: [span] }, env, false, createContextPool())
  const element = p.elements[0]!
  if (element.kind !== 'span') throw new Error('missing span')
  const closes = counted(element.closes)
  element.closes = closes.values
  const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  expect([filled.start, filled.end, filled.next]).toEqual([0, text.length, null])
  expect(linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')).toBe(text)
  expect(element.closes.length).toBeGreaterThan(1024)
  expect(closes.reads()).toBeLessThan(20 * element.closes.length)
})

test('compiled source LF boundaries respect leaf ends, bidi splits, and retained widths', () => {
  const p = prepareGecko(paragraph('', { content: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'ב\nc' }, { kind: 'text', text: '\nd' }] }), env, true, createContextPool())
  expect(p.text).toBe('aב\nc\nd')
  expect(p.lineFeeds).toEqual([2, 4])
  for (const width of [10, 320, 10]) {
    const ends: number[] = []
    for (let start = firstLine(p); start !== null;) {
      const filled = fillLine(p, start, { width, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('unexpected refusal')
      ends.push(filled.end)
      inspectLine(p, filled.line)
      start = filled.next
    }
    expect(ends).toContain(3)
    expect(ends).toContain(5)
    expect(ends.at(-1)).toBe(6)
  }
  const noLf = prepareGecko(paragraph('a'.repeat(512)), env, false, createContextPool())
  expect(noLf.lineFeeds).toEqual([])
  let lines = 0
  for (let start = firstLine(noLf); start !== null;) {
    const filled = fillLine(noLf, start, { width: 10, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect(filled.end - filled.start).toBe(1)
    lines++; start = filled.next
  }
  expect(lines).toBe(512)
})

test('a narrow tab-rich fill materializes a linear number of visited tab records over all lines', () => {
  const text = 'a\t'.repeat(1024)
  const p = prepareGecko(paragraph(text, { overflowWrap: 'normal' }), env, false, createContextPool())
  let records = 0, lines = 0, end = 0
  for (let start = firstLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 20, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect(filled.start).toBe(end)
    end = filled.end
    for (const frame of filled.line.root.frames) if (frame.kind === 'text') records += frame.r.prov?.tabs.length ?? 0
    lines++; start = filled.next
  }
  expect(end).toBe(text.length)
  expect(lines).toBeGreaterThan(512)
  expect(records).toBeLessThan(4 * text.length)
})

test('tab materialization keeps real break uncertainty and omits later unvisited tab origins', () => {
  const p = prepareGecko(paragraph(('a\t\u0301AV').repeat(4)), env, true, createContextPool())
  let early = 0, consumedWarning = false
  for (let start = firstLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 19.5, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    const warnings = inspectLine(p, filled.line).gaps.filter(g => g.gap === 'in-word-prefix')
    if (filled.end <= 5) {
      // The next repeated tab's origin is offset 8. A scan through the first AVa has not visited that tab.
      expect(warnings.every(g => g.at === undefined || g.at.start < 8)).toBe(true)
      early++
    }
    if (warnings.some(g => g.at !== undefined && g.at.start >= filled.start && g.at.start <= filled.end)) consumedWarning = true
    start = filled.next
  }
  expect(early).toBeGreaterThan(1)
  expect(consumedWarning).toBe(true)
})

// A typed array's length getter needs its real receiver; consumers here only ask for indexed source/flag values.
function countedUnits<T extends Uint8Array | Uint16Array>(values: T): { values: T; reads: () => number } {
  let reads = 0
  return { values: new Proxy(values, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, target)
  } }), reads: () => reads }
}

test('short Common pieces use the same script witness without walking a growing neutral prefix', () => {
  const p = prepareGecko(paragraph('漢 ' + '7 '.repeat(1024), { whiteSpace: 'normal' }), env, false, createContextPool())
  const run = p.textRuns[0]!, units = countedUnits(p.tUnits)
  expect(run.scriptRuns.length).toBe(1)
  expect(Array.from(run.scriptRuns[0]!.contextGaps)).toEqual([1, p.tUnits.length])
  let queried = 0
  // Arbitrary access exercises both ends of the same sparse nonmatching-script interval.
  for (let t = p.tUnits.length - 2; t >= 2; t -= 14) {
    expect(rangeAu(run.contexts.own, run, units.values, t, t + 1)).toBe(600)
    queried++
  }
  expect(units.reads()).toBeLessThan(16 * queried)
  const latin = prepareGecko(paragraph('a'.repeat(4096), { whiteSpace: 'normal' }), env, false, createContextPool())
  expect(latin.textRuns.every(r => r.scriptRuns.every(sr => sr.contextGaps.length === 0))).toBe(true)
})

test('every range edge of one long grapheme finds its end without repeatedly walking the remaining marks', () => {
  const text = 'a' + '\u0301'.repeat(1024)
  const p = prepareGecko(paragraph(text, { whiteSpace: 'normal' }), env, false, createContextPool())
  const run = p.textRuns[0]!, flags = countedUnits(p.clusterStart)
  expect(Array.from(p.clusterContinuations)).toEqual([1, text.length])
  p.clusterStart = flags.values
  let queried = 0
  for (let t = text.length - 1; t > 0; t -= 13) {
    expect(advanceBefore(p, run, t)).toEqual({ au: 600, standIn: { kind: 'inside-cluster', at: t, betweenMarks: t > 1 } })
    queried++
  }
  // A first interior query may compile the unit's shaping windows in one linear pass.
  expect(flags.reads()).toBeLessThan(2 * text.length + 8 * queried)
  const latin = prepareGecko(paragraph('a'.repeat(4096), { whiteSpace: 'normal' }), env, false, createContextPool())
  expect(latin.clusterContinuations.length).toBe(0)
})

test('distinct text-run contexts have one canonical record without scanning all earlier records', () => {
  class Records extends Map<Context, RunContexts> {
    reads = 0
    override get(own: Context): RunContexts | undefined { this.reads++; return super.get(own) }
    override values() { this.reads += this.size; return super.values() }
    override entries() { this.reads += this.size; return super.entries() }
    override [Symbol.iterator]() { this.reads += this.size; return super[Symbol.iterator]() }
  }
  const records = new Records(), pool = createContextPool(), made: RunContexts[] = []
  const settings: CanvasSettings = {
    font: '16px Optima', lang: 'en', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto',
    textRendering: 'auto', direction: 'ltr', partition: '',
  }
  for (let i = 0; i < 1024; i++) made.push(runContextsFor(records, pool, { ...settings, font: `16px "Font ${i}"` }))
  expect(records.size).toBe(1024)
  expect(pool.size).toBe(1024)
  // Reusing a record must preserve recipe facts already filled by a previous text run.
  made[0]!.noLigatures = made[0]!.own
  for (let i = 1023; i >= 0; i -= 7) expect(runContextsFor(records, pool, { ...settings, font: `16px "Font ${i}"` })).toBe(made[i]!)
  expect(runContextsFor(records, pool, { ...settings, font: '16px "Font 0"' }).noLigatures).toBe(made[0]!.own)
  expect(records.reads).toBeLessThan(4 * made.length)
})
