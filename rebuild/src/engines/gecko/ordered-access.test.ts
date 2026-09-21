import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { createContextPool, type CanvasSettings, type Context } from '../../measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, linePieces } from './index.js'
import { rangeAdvance } from './lines.js'
import { rangeAu, runContextsFor } from './measure.js'
import { prepareGecko } from './prepare.js'
import { advanceBefore } from './advance.js'
import { createFontDeclarations, fontTableOf, listedFontOf, extenderFontOf, opticalSizeAxisOf, sameFontForTextRun } from './fonts.js'
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

test('many equivalent font flows validate each declaration once and compare canonical parsed families', () => {
  const names = Array.from({ length: 128 }, (_, i) => `Family ${i}`)
  let sourceReads = 0
  const countedFont = (family: string): FontDecl => new Proxy({ ...font, family }, { get(target, key, receiver) {
    if (key === 'family') sourceReads++
    return Reflect.get(target, key, receiver)
  } })
  const a = countedFont(names.map(n => `"${n}"`).join(',')), b = countedFont(names.map(n => `'${n}'`).join(' , '))
  const content: InlineNode[] = []
  for (let i = 0; i < 1024; i++) content.push({
    kind: 'span', font: i % 2 === 0 ? a : b, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto', tabSize: 8, lang: null,
    inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'a' }],
  })
  const block = paragraph('', { whiteSpace: 'normal', content })
  for (let repeat = 0; repeat < 2; repeat++) {
    const previous = sourceReads
    const p = prepareGecko(block, env, false, createContextPool())
    expect(p.leaves.length).toBe(1024)
    expect(p.textRuns.length).toBe(1)
    // The two syntactically different quoted lists denote the same parsed families. A/B continuity must neither
    // reparse both source lists nor compare all 128 names at every frame. A new preparation still validates both.
    expect(sourceReads - previous).toBeLessThan(12)
    expect(sourceReads - previous).toBeGreaterThanOrEqual(2)
    const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect([filled.start, filled.end, filled.next]).toEqual([0, 1024, null])
  }
})

test('compiled families preserve malformed-list validation and scalar/fact short circuits', () => {
  const declarations = createFontDeclarations(), invalid = { ...font, family: '' }
  expect(sameFontForTextRun(invalid, { ...invalid, style: 'italic' }, declarations)).toBe(false)
  expect(sameFontForTextRun(invalid, { ...invalid, size: 18 }, declarations)).toBe(false)
  expect(() => sameFontForTextRun(invalid, invalid, declarations)).toThrow()
  expect(() => sameFontForTextRun(font, invalid, declarations)).toThrow()
  expect(opticalSizeAxisOf(invalid, declarations)).toBe(false)
  const defaultOptical = { ...invalid, facts: { ...UNKNOWN_FONT_FACTS, primaryFamily: 'Arial' } }
  expect(opticalSizeAxisOf(defaultOptical, declarations)).toBe(false)
  expect(() => opticalSizeAxisOf({ ...invalid, facts: UNKNOWN_FONT_FACTS }, declarations)).toThrow()
  expect(sameFontForTextRun({ ...font, family: 'Arial' }, { ...font, family: '"Arial"' }, declarations)).toBe(false)
  expect(sameFontForTextRun({ ...font, family: 'Serif' }, { ...font, family: 'serif' }, declarations)).toBe(true)
  expect(opticalSizeAxisOf({ ...font, family: 'system-ui', facts: UNKNOWN_FONT_FACTS }, declarations)).toBe(true)
  expect(opticalSizeAxisOf({ ...font, family: '"system-ui"', facts: UNKNOWN_FONT_FACTS }, declarations)).toBe(false)
})

test('many stable tab frames inspect each earlier completed frame once in a speculative pass', () => {
  const n = 512, p = prepareGecko({ ...paragraph(''), content: Array.from({ length: n }, () => ({ kind: 'text' as const, text: 'a\t' })) }, env, true, createContextPool())
  let reads = 0
  p.textRuns = p.textRuns.map(run => new Proxy(run, { get(target, key, receiver) {
    if (key === 'advancesStandIn') reads++
    return Reflect.get(target, key, receiver)
  } }))
  const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  expect([filled.start, filled.end, filled.next]).toEqual([0, 2 * n, null])
  expect(linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')).toBe('a\t'.repeat(n))
  expect(inspectLine(p, filled.line).gaps).toEqual([])
  expect(reads).toBeLessThan(16 * n)
})

test('a known unavailable font prefix is source analysis rather than a fresh search at every Greek interior', () => {
  const n = 512
  const facts: NonNullable<FontDecl['facts']['fonts']>[number][] = Array.from({ length: n }, (_, i) => ({
    family: `Absent ${i}`, realizes: false, coverage: null, ligatures: null, scriptLookups: null,
  }))
  facts.push({ family: font.family, realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: [['Latn', 'Grek', 'Cyrl']] })
  const fonts = counted(facts)
  const p = prepareGecko(paragraph('αβ'.repeat(n / 2), { whiteSpace: 'normal', font: { ...font, family: facts.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: fonts.values } } }), env, true, createContextPool())
  let lines = 0
  for (let start = firstLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 15, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect(filled.end - filled.start).toBe(1)
    expect(inspectLine(p, filled.line).gaps).toEqual([])
    linePieces(p, filled.line)
    lines++; start = filled.next
  }
  expect(lines).toBe(n)
  expect(fonts.reads()).toBeLessThan(8 * n)
})


test('distinct declarations sharing one source font table do not multiply its primary-font search', () => {
  const n = 256
  const facts: NonNullable<FontDecl['facts']['fonts']>[number][] = Array.from({ length: n }, (_, i) => ({
    family: `Absent ${i}`, realizes: false, coverage: null, ligatures: null, scriptLookups: null,
  }))
  facts.push({ family: font.family, realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: [['Latn', 'Grek']] })
  const fonts = counted(facts), block = paragraph('')
  block.content = Array.from({ length: n }, (_, i) => ({
    kind: 'span', font: { ...font, family: facts.map(f => JSON.stringify(f.family)).join(','), size: 16 + i / 8, facts: { ...font.facts, fonts: fonts.values } }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto', tabSize: 8, lang: null,
    inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'α' }],
  }))
  const p = prepareGecko(block, env, false, createContextPool())
  const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  expect([filled.start, filled.end, filled.next]).toEqual([0, n, null])
  expect(p.textRuns.length).toBe(n)
  expect(p.textRuns.every(run => run.fontTable === p.textRuns[0]!.fontTable)).toBe(true)
  expect(fonts.reads()).toBeLessThan(8 * n)
})


test('deciding many hyphen fallback breaks searches their published source points without a growing prefix', () => {
  const n = 512, text = 'a-a-'.repeat(n) + 'a'
  const p = prepareGecko(paragraph(text, { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'normal' }), env, true, createContextPool())
  const original = p.inspect!.emergencyUnconfirmed
  expect(original).toEqual([...original].sort((a, b) => a - b))
  const points = counted(original)
  p.inspect!.emergencyUnconfirmed = points.values
  let lines = 0, painted = '', uncertain = 0
  for (let start = firstLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 35, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    painted += linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')
    uncertain += inspectLine(p, filled.line).gaps.filter(g => g.gap === 'font-fallback' && g.detail.includes('emergency break')).length
    lines++; start = filled.next
  }
  expect([lines, painted, uncertain]).toEqual([2 * n, text, 2 * n - 1])
  expect(points.reads()).toBeLessThan(64 * n)
})

test('hyphen coverage keeps original indices without rewalking unavailable source families for each point', () => {
  const n = 512, text = 'a-a-'.repeat(n) + 'a'
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = Array.from({ length: n }, (_, i) => ({
    family: `Absent ${i}`, realizes: false, coverage: null, ligatures: null, scriptLookups: null,
  }))
  raw.push({ family: font.family, realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: [['Latn', 'Grek']] })
  for (const inspect of [false, true]) {
    const fonts = counted(raw)
    const p = prepareGecko(paragraph(text, { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'normal', font: {
      ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: fonts.values },
    } }), env, inspect, createContextPool())
    let lines = 0, painted = ''
    for (let start = firstLine(p); start !== null;) {
      const filled = fillLine(p, start, { width: 35, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('unexpected refusal')
      painted += linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')
      if (inspect) expect(inspectLine(p, filled.line).gaps).toEqual([])
      lines++; start = filled.next
    }
    expect([lines, painted]).toEqual([2 * n, text])
    expect(fonts.reads()).toBeLessThan(16 * n)
    expect(listedFontOf(p.textRuns[0]!.fontTable, 0x61)).toBe(n)
  }
})

test('pruned coverage preserves unknown barriers, source indices, hyphen substitution and previous-font extenders', () => {
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = [
    { family: 'Absent', realizes: false, coverage: null, ligatures: null, scriptLookups: null },
    { family: 'First', realizes: true, coverage: [0x2d, 0x2d, 0x61, 0x61], ligatures: null, scriptLookups: [] },
    { family: 'Unknown', realizes: null, coverage: null, ligatures: null, scriptLookups: null },
    { family: 'Last', realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: [['Latn']] },
  ]
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const declarations = createFontDeclarations(), table = fontTableOf(f, declarations)
  if (table.coverage.kind !== 'source') throw new Error('premature coverage compilation')
  expect(table.coverage.entries.map(e => e.index)).toEqual([1, 2, 3])
  expect(listedFontOf(table, 0x61)).toBe(1)
  expect(listedFontOf(table, 0x2010)).toBe(1)
  expect(listedFontOf(table, 0x2011)).toBe(1)
  expect(listedFontOf(table, 0x62)).toBe(null)
  expect(extenderFontOf(f, table, 1, 0x301)).toBe(null)
  expect(extenderFontOf(f, table, null, 0x301)).toBe(null)
  const known = { ...f, facts: { ...f.facts, fonts: raw.map((fact, i) => i === 2 ? { ...fact, realizes: false as const } : fact) } }
  const knownTable = fontTableOf(known, declarations), base = listedFontOf(knownTable, 0x62)
  expect(base).toBe(3)
  expect(extenderFontOf(known, knownTable, base, 0x301)).toBe(3)
  expect(fontTableOf({ ...f, size: 17 }, declarations)).toBe(table)
  const empty = fontTableOf({ ...font, facts: { ...font.facts, fonts: [] } }, declarations)
  expect(listedFontOf(empty, 0x61)).toBe(-1)
  expect(listedFontOf(fontTableOf(font, declarations), 0x61)).toBe(null)
})

test('one Common run resolves its unchanged long source language before interior pair queries', () => {
  const n = 256, text = '²'.repeat(n), tag = 'en-x-' + Array(n).fill('aaaa').join('-')
  const p = prepareGecko(paragraph(text, { whiteSpace: 'normal', lang: tag }), env, true, createContextPool())
  const run = p.textRuns[0]!, own = run.contexts.own
  let reads = 0
  run.contexts = { ...run.contexts, own: { ...own, settings: new Proxy(own.settings, { get(target, key, receiver) {
    if (key === 'lang') reads++
    return Reflect.get(target, key, receiver)
  } }) } }
  for (const width of [15, 64.125, 320]) {
    let painted = ''
    for (let start = firstLine(p); start !== null;) {
      const filled = fillLine(p, start, { width, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('unexpected refusal')
      painted += linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')
      inspectLine(p, filled.line)
      start = filled.next
    }
    expect(painted).toBe(text)
  }
  expect(reads).toBeLessThan(32)
  expect(run.commonPairKerning).toBe(true)
})

test('inherited leaves share their actual source language policy while an explicit empty tag has its own locale', () => {
  const block = paragraph('', { lang: 'EL-x-aaaa' })
  const child: InlineNode = { ...block, kind: 'span', lang: '', inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: '²' }] }
  block.content = [{ kind: 'text', text: '²' }, { kind: 'text', text: '²' }, child, { kind: 'text', text: '²' }]
  const p = prepareGecko(block, { ...env, regionalPrefsLocale: 'he' }, false, createContextPool())
  expect(p.leaves.map(l => l.language.tag)).toEqual(['el-x-aaaa', 'el-x-aaaa', '', 'el-x-aaaa'])
  expect(p.leaves[0]!.language).toBe(p.leaves[1]!.language)
  expect(p.leaves[0]!.language).toBe(p.leaves[3]!.language)
  expect(p.leaves[2]!.language.commonScript).toBe('Hebr')
  expect(p.textRuns.every(run => run.commonPairKerning === false)).toBe(true)
})
test('many realized source families are matched once through their coverage intervals rather than at every hyphen', () => {
  const n = 512, text = 'a-a-'.repeat(n) + 'a'
  for (const inspect of [false, true]) {
    let reads = 0
    const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = Array.from({ length: n }, (_, i) => ({
      family: `Present ${i}`, realizes: true, coverage: [0x1000 + i, 0x1000 + i], ligatures: null, scriptLookups: [['Latn']],
    }))
    raw.push({ family: font.family, realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: [['Latn']] })
    const fonts = raw.map(fact => new Proxy(fact, { get(target, key, receiver) {
      if (key === 'coverage') reads++
      return Reflect.get(target, key, receiver)
    } }))
    const p = prepareGecko(paragraph(text, { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'normal', font: {
      ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts },
    } }), env, inspect, createContextPool())
    let lines = 0, painted = ''
    for (let start = firstLine(p); start !== null;) {
      const filled = fillLine(p, start, { width: 35, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('unexpected refusal')
      painted += linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')
      if (inspect) expect(inspectLine(p, filled.line).gaps).toEqual([])
      lines++; start = filled.next
    }
    expect([lines, painted]).toEqual([2 * n, text])
    expect(reads).toBeLessThan(16 * n)
  }
})

test('one effective known cmap keeps arbitrary binary access without first walking all its ranges', () => {
  const rawRanges = [0x2d, 0x2d]
  for (let i = 0; i < 4096; i++) rawRanges.push(0x1000 + 3 * i, 0x1001 + 3 * i)
  const ranges = counted(rawRanges)
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = [
    { family: 'Empty', realizes: true, coverage: [], ligatures: null, scriptLookups: [] },
    { family: 'Mapped', realizes: true, coverage: ranges.values, ligatures: null, scriptLookups: [] },
    { family: 'Unknown', realizes: null, coverage: null, ligatures: null, scriptLookups: null },
    { family: 'Hidden', realizes: true, get coverage(): readonly number[] { throw new Error('coverage beyond unknown barrier') }, ligatures: null, scriptLookups: [] },
  ]
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const table = fontTableOf(f, createFontDeclarations()), last = 0x1000 + 3 * 4095
  for (const cp of [last + 1, 0x2d, 0x1001, last, 0x2010, 0x1000, 0x2011]) expect(listedFontOf(table, cp)).toBe(1)
  for (const cp of [last + 2, 0, 0x1002, 0x10ffff]) expect(listedFontOf(table, cp)).toBe(null)
  expect(ranges.reads()).toBeLessThan(512)
  expect(table.coverage.kind).toBe('single')
})

test('small actual font demand does not walk huge later realized cmaps', () => {
  const rawRanges = [0, 0x80]
  for (let i = 0; i < 4096; i++) rawRanges.push(0x1000 + 3 * i, 0x1001 + 3 * i)
  for (const firstCovers of [false, true]) for (const inspect of [false, true]) {
    const first = counted([...rawRanges]), later = counted([...rawRanges]), unused = counted([...rawRanges])
    const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = [
      { family: 'First', realizes: true, coverage: firstCovers ? first.values : [0x100, 0x100], ligatures: null, scriptLookups: [['Latn']] },
      { family: 'Later', realizes: true, coverage: later.values, ligatures: null, scriptLookups: [['Latn']] },
      { family: 'Unused', realizes: true, coverage: unused.values, ligatures: null, scriptLookups: [['Latn']] },
    ]
    const p = prepareGecko(paragraph('a-a', { whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'normal', font: {
      ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw },
    } }), env, inspect, createContextPool())
    const filled = fillLine(p, firstLine(p)!, { width: 35, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    expect([filled.start, filled.end, filled.next]).toEqual([0, 3, null])
    expect(linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')).toBe('a-a')
    if (inspect) inspectLine(p, filled.line)
    expect(first.reads() + later.reads()).toBeLessThan(128)
    expect(unused.reads()).toBe(0)
  }
})

test('many distinct source cells finish one bounded partition instead of repeating the whole family list', () => {
  const n = 256
  const rangeInputs = Array.from({ length: n }, (_, i) => counted([0x4000 + 2 * i, 0x4000 + 2 * i]))
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = rangeInputs.map((ranges, i) => ({
    family: `Present ${i}`, realizes: true, coverage: ranges.values, ligatures: null, scriptLookups: [],
  }))
  const fallback = counted([0, 0x10ffff])
  raw.push({ family: 'Mapped', realizes: true, coverage: fallback.values, ligatures: null, scriptLookups: [] })
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const table = fontTableOf(f, createFontDeclarations())
  for (let i = 0; i < n; i++) {
    const ordinal = (73 * i) % n
    expect(listedFontOf(table, 0x4001 + 2 * ordinal)).toBe(n)
    expect(listedFontOf(table, 0x4000 + 2 * ordinal)).toBe(ordinal)
  }
  expect(rangeInputs.reduce((sum, input) => sum + input.reads(), fallback.reads())).toBeLessThan(128 * n)
  expect(table.coverage.kind).toBe('partition')
})

test('families sharing one immutable cmap retain its first source index without multiplying range work', () => {
  const n = 512, rawRanges: number[] = []
  for (let i = 0; i < 4096; i++) rawRanges.push(0x1000 + 3 * i, 0x1001 + 3 * i)
  const ranges = counted(rawRanges)
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = Array.from({ length: n }, (_, i) => ({
    family: `Present ${i}`, realizes: true, coverage: ranges.values, ligatures: null, scriptLookups: [],
  }))
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const table = fontTableOf(f, createFontDeclarations())
  expect(listedFontOf(table, 0x1000)).toBe(0)
  expect(listedFontOf(table, 0)).toBe(-1)
  expect(listedFontOf(table, 0x1002)).toBe(-1)
  expect(listedFontOf(table, 0x10ffff)).toBe(-1)
  expect(ranges.reads()).toBeLessThan(128)
})

test('first demanded cmap errors propagate without publishing an unproved source cell', () => {
  const needed = new Proxy([0x61, 0x61], { get(target, key, receiver) {
    if (key === '0') throw new Error('source cmap unavailable')
    return Reflect.get(target, key, receiver)
  } })
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = [
    { family: 'First', realizes: true, coverage: [0x2d, 0x2d], ligatures: null, scriptLookups: [] },
    { family: 'Needed', realizes: true, coverage: needed, ligatures: null, scriptLookups: [] },
  ]
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const table = fontTableOf(f, createFontDeclarations())
  expect(listedFontOf(table, 0x2d)).toBe(0)
  expect(() => listedFontOf(table, 0x61)).toThrow('source cmap unavailable')
  expect(() => listedFontOf(table, 0x61)).toThrow('source cmap unavailable')
  expect(listedFontOf(table, 0x2d)).toBe(0)
})

test('coverage publication preserves earliest overlapping fonts, unknown misses and the previous font of a mark', () => {
  const raw: NonNullable<FontDecl['facts']['fonts']>[number][] = [
    { family: 'Early', realizes: true, coverage: [0x2d, 0x2d, 0x61, 0x61, 0x301, 0x301], ligatures: null, scriptLookups: [['Latn']] },
    { family: 'Later', realizes: true, coverage: [0x62, 0x62, 0x301, 0x301, 0x2010, 0x2011], ligatures: null, scriptLookups: [['Latn']] },
    { family: 'Unknown', realizes: true, coverage: null, ligatures: null, scriptLookups: null },
    { family: 'Hidden', realizes: true, coverage: [0, 0x10ffff], ligatures: null, scriptLookups: null },
  ]
  const f = { ...font, family: raw.map(f => JSON.stringify(f.family)).join(','), facts: { ...font.facts, fonts: raw } }
  const table = fontTableOf(f, createFontDeclarations())
  expect(table.coverage.kind).toBe('source')
  expect(listedFontOf(table, 0x61)).toBe(0)
  expect(table.coverage.kind).not.toBe('source')
  expect(listedFontOf(table, 0x62)).toBe(1)
  expect(listedFontOf(table, 0x301)).toBe(0)
  expect(extenderFontOf(f, table, listedFontOf(table, 0x62), 0x301)).toBe(1)
  expect(listedFontOf(table, 0x2010)).toBe(0)
  expect(listedFontOf(table, 0x2011)).toBe(0)
  expect(listedFontOf(table, 0x63)).toBe(null)
  expect(listedFontOf(table, 0x10ffff)).toBe(null)
})
