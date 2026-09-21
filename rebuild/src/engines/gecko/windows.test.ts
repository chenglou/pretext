// A long shaping unit's windows (advance.ts windowsOf): a cut that a kerned pair crosses and a cut inside a ligature as
// wide as its parts don't hold, the windows add up to the unit, and the lines are the glyph records' lines, plain and
// inspected, at every width of a sweep.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../../model.js'
import { fillLine, firstLine, linePieces, inspectLine } from './index.js'
import { advanceBefore, groupAround } from './advance.js'
import { createContextPool } from '../../measure/canvas.js'
import { prepareGecko } from './prepare.js'

// 16px: a letter's advance goes by its code, each glyph rounded on its own. `A` before `V` is 41 au narrower, all on
// the `A` (GPOS). `ff` is one ligature glyph as wide as two `f`, where ligatures are on; its ink box shows it.
const advanceOf = (c: string): number => c === 'A' ? 600.4 : c === 'V' ? 590.2 : c === 'f' ? 576.2 : 500.3 + 7 * (c.charCodeAt(0) % 13)
const glyph = (text: string, i: number): number => Math.floor(advanceOf(text[i]!) - (text[i] === 'A' && text[i + 1] === 'V' ? 41 : 0) + 0.5)

let questions: string[] = []
let requiredPairSpacing = false

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      questions.push(s)
      let au = this.letterSpacing === '2px' ? 120 * (requiredPairSpacing && /^f+$/.test(s) ? Math.ceil(s.length / 2) : s.length) : 0
      for (let i = 0; i < s.length; i++) au += glyph(s, i)
      const width = Math.fround(au / 60)
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: this.letterSpacing === '0px' && s.includes('ff') ? width + 0.006 : width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false, pairKerning: 'first-advance' } }

// 100 letters, one unit. `pairs` puts `AV` or `ff` at an offset.
function unitText(pairs: [number, string][]): string {
  const letters = 'abcdeghijklmnopqrstuwxyz'
  let text = ''
  for (let i = 0; i < 100; i++) text += letters[(i * 7) % letters.length]!
  for (let k = 0; k < pairs.length; k++) text = text.slice(0, pairs[k]![0]) + pairs[k]![1] + text.slice(pairs[k]![0] + 2)
  return text
}

const paragraphOf = (text: string): Paragraph => ({
  font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
  tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
})

function lines(text: string, width: number, inspect: boolean): { lines: [number, number][]; windows: number[] } {
  const prepared = prepareGecko(paragraphOf(text), env, inspect, createContextPool())
  const out: [number, number][] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    out.push([filled.start, filled.end])
    start = filled.next
  }
  const windows = prepared.units[0]!.inWord!.windows!
  let sum = 0
  for (let k = 0; k < windows.length; k++) sum += windows[k]!.canvasAu
  expect(sum).toBe(prepared.units[0]!.canvasAu)
  return { lines: out, windows: windows.map(w => w.tStart) }
}

test('a kerned pair across a cut keeps its two cells in one window, and the lines are the glyph records', () => {
  const text = unitText([[15, 'AV'], [40, 'AV']])
  for (let a = 600; a <= 30000; a += 147) {
    // Every cluster is a break candidate: a line takes the clusters that fit, and at least one.
    const expected: [number, number][] = []
    for (let start = 0; start < text.length;) {
      let end = start + 1
      let au = glyph(text, start)
      while (end < text.length && au + glyph(text, end) <= a) au += glyph(text, end++)
      expected.push([start, end])
      start = end
    }
    const plain = lines(text, a / 60, false)
    expect(plain.windows).toEqual([0, 32, 48, 64, 80])
    expect(plain.lines).toEqual(expected)
    expect(lines(text, a / 60, true).lines).toEqual(expected)
  }
})

test('a ligature as wide as its parts across a cut keeps its two cells in one window', () => {
  const text = unitText([[15, 'AV'], [31, 'ff']])
  for (let a = 600; a <= 30000; a += 1471) {
    const plain = lines(text, a / 60, false)
    expect(plain.windows).toEqual([0, 48, 64, 80])
    expect(lines(text, a / 60, true).lines).toEqual(plain.lines)
  }
})


test('an original long unit start reads its prepared advance without discovering windows', () => {
  // A normal-wrap long token needs only its two already prepared edges. Windows and their offset arrays are not
  // needed until a real interior offset asks, even when pieces are materialized.
  for (const [text, direction, lang] of [['a'.repeat(4096), 'ltr', 'en'], ['ب'.repeat(4096), 'rtl', 'ar']] as const) {
    const p = { ...paragraphOf(text), direction, lang, overflowWrap: 'normal' as const }
    const prepared = prepareGecko(p, env, false, createContextPool())
    const run = prepared.textRuns[0]!, unit = prepared.units[0]!
    questions = []
    expect(advanceBefore(prepared, run, unit.tStart)).toEqual({ au: unit.startAdvance, standIn: null })
    expect(unit.inWord === null).toBe(true)
    const filled = fillLine(prepared, firstLine(prepared)!, { width: 1_000_000, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected float refusal')
    expect([filled.start, filled.end, filled.next]).toEqual([0, text.length, null])
    expect(linePieces(prepared, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')).toBe(text)
    expect(unit.inWord === null).toBe(true)
    expect(questions).toEqual([])
  }
})

test('failed joining cuts do not repeatedly shape the growing unclosed window', () => {
  for (const n of [512, 1024, 2048]) {
    const text = 'ب'.repeat(n)
    const prepared = prepareGecko({ ...paragraphOf(text), direction: 'rtl', lang: 'ar' }, env, false, createContextPool())
    questions = []
    const filled = fillLine(prepared, firstLine(prepared)!, { width: 10, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected float refusal')
    expect(filled.start).toBe(0)
    expect(filled.end).toBeGreaterThan(0)
    expect(filled.end).toBeLessThan(n)
    expect(prepared.units[0]!.inWord!.windows).toEqual([])
    // An actual interior edge still needs long prefix/suffix questions. The cut-discovery work must be linear in
    // the input, independently of those unavoidable questions. The old growing-window loop violates this budget.
    expect(questions.reduce((sum, s) => sum + s.length, 0)).toBeLessThan(12 * n)
  }
})


test('several failed cuts close with the whole merged width when a later cut holds', () => {
  let text = 'a'.repeat(384)
  for (const [at, pair] of [[15, 'AV'], [31, 'AV'], [47, 'AV'], [127, 'AV'], [143, 'AV'], [255, 'ff'], [271, 'ff']] as const) {
    text = text.slice(0, at) + pair + text.slice(at + pair.length)
  }
  for (const letterSpacing of [-2, 0, 2]) {
    for (const width of [10.25, 64.125, 320]) {
      const prepared = prepareGecko({ ...paragraphOf(text), letterSpacing }, env, true, createContextPool())
      const starts: number[] = [], ends: number[] = [], advances: number[] = []
      for (let start = firstLine(prepared); start !== null;) {
        const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
        if (filled.kind !== 'line') throw new Error('unexpected float refusal')
        starts.push(filled.start); ends.push(filled.end)
        const inspection = inspectLine(prepared, filled.line)
        // Inspecting every source character also requires every merged window's boundary advance.
        if (inspection.geometry === null) throw new Error('missing geometry')
        for (const frame of inspection.geometry.frames) if (frame.kind === 'text') {
          advances.push(...frame.characters.map(c => c.advance))
        }
        linePieces(prepared, filled.line)
        start = filled.next
      }
      expect(starts[0]).toBe(0)
      expect(ends.at(-1)).toBe(text.length)
      expect(starts.slice(1)).toEqual(ends.slice(0, -1))
      const windows = prepared.units[0]!.inWord!.windows!
      expect(windows[0]!.tEnd).toBe(64)
      expect(windows.find(w => w.tStart === 112)!.tEnd).toBe(160)
      expect(windows.reduce((sum, w) => sum + w.canvasAu, 0)).toBe(prepared.units[0]!.canvasAu)
      expect(advances.reduce((sum, au) => sum + au, 0)).toBe(prepared.units[0]!.au + letterSpacing * 60 * text.length)
    }
  }
})

function countedMetadata<T extends Uint8Array | unknown[]>(values: T): { values: T; reads: () => number } {
  let reads = 0
  return { values: new Proxy(values, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, target)
  } }), reads: () => reads }
}

function groupRange(...args: Parameters<typeof groupAround>): { start: number; end: number; unconfirmed: boolean } | null {
  const part = groupAround(...args)
  return part === null ? null : { start: part.start, end: part.end, unconfirmed: part.unconfirmed }
}

test('a long connected optional-ligature row shares its discovered row with arbitrary interior queries', () => {
  // Every ff boundary is a candidate even where actual disjoint ff glyphs would stop. Unknown ligature facts leave
  // one unconfirmed row. Every window cut crosses a candidate, so this tests an input-sized row rather than cells.
  const n = 1024, prepared = prepareGecko(paragraphOf('f'.repeat(n)), env, false, createContextPool())
  const flags = countedMetadata(prepared.clusterStart)
  prepared.clusterStart = flags.values
  const run = prepared.textRuns[0]!, unit = prepared.units[0]!
  expect(groupRange(prepared, run, unit, 1)).toEqual({ start: 0, end: n, unconfirmed: true })
  expect(unit.inWord!.windows).toEqual([])
  questions = []
  for (let k = 0; k < n - 1; k++) {
    const t = 1 + (k * 37) % (n - 1)
    expect(groupRange(prepared, run, unit, t)).toEqual({ start: 0, end: n, unconfirmed: true })
  }
  expect(questions).toEqual([])
  expect(flags.reads()).toBeLessThan(16 * n)
  const offsets = unit.inWord!.offsets, row = offsets[0]!.row!
  for (let t = 1; t < n; t++) expect(offsets[t]!.row).toBe(row)
})

test('a long known optional-ligature row finds strict group interiors from its ordered group edges', () => {
  const n = 2048
  const known: FontDecl = { ...font, facts: { ...font.facts, fonts: [{
    family: font.family, realizes: true, coverage: [0x20, 0x7e], scriptLookups: [],
    ligatures: { complete: true, languageSystems: [], patterns: [{
      positions: [['f'], ['f']], exact: true, everyContext: true, spaced: false, acrossMark: null,
    }] },
  }] } }
  const prepared = prepareGecko({ ...paragraphOf('f'.repeat(n)), font: known }, env, false, createContextPool())
  const run = prepared.textRuns[0]!, unit = prepared.units[0]!
  expect(groupRange(prepared, run, unit, 1)).toEqual({ start: 0, end: 2, unconfirmed: false })
  const row = unit.inWord!.offsets[0]!.row!, parts = countedMetadata(row.parts)
  expect(row.parts.length).toBe(n / 2)
  row.parts = parts.values
  questions = []
  for (let k = 0; k < n - 1; k++) {
    const t = 1 + (k * 37) % (n - 1)
    expect(groupRange(prepared, run, unit, t)).toEqual(t % 2 === 0 ? null : { start: t - 1, end: t + 1, unconfirmed: false })
  }
  expect(questions).toEqual([])
  expect(parts.reads()).toBeLessThan(32 * n)
})

test('required cuts between known group edges agree without changing strict group boundaries', () => {
  const n = 128
  const known: FontDecl = { ...font, facts: { ...font.facts, fonts: [{
    family: font.family, realizes: true, coverage: [0x20, 0x7e], scriptLookups: [],
    ligatures: { complete: true, languageSystems: [], patterns: [{
      positions: [['f'], ['f']], exact: true, everyContext: true, spaced: true, acrossMark: null,
    }] },
  }] } }
  requiredPairSpacing = true
  try {
    const prepared = prepareGecko({ ...paragraphOf('f'.repeat(n)), font: known }, env, false, createContextPool())
    const run = prepared.textRuns[0]!, unit = prepared.units[0]!
    for (let t = 1; t < n; t++) expect(groupRange(prepared, run, unit, t)).toEqual(
      t % 2 === 0 ? null : { start: t - 1, end: t + 1, unconfirmed: false },
    )
    expect(unit.inWord!.windows).toEqual([])
    expect([...unit.inWord!.offsets[0]!.row!.parts.map(part => part.start), n]).toEqual(Array.from({ length: n / 2 + 1 }, (_, i) => i * 2))
  } finally { requiredPairSpacing = false }
})

test('full inspection counts a connected row from its actual source parts instead of rescanning the group at every character', () => {
  const n = 512, p = prepareGecko(paragraphOf('f'.repeat(n)), env, true, createContextPool())
  const flags = countedMetadata(p.clusterStart)
  p.clusterStart = flags.values
  const filled = fillLine(p, firstLine(p)!, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  const geometry = inspectLine(p, filled.line).geometry!
  const advances = geometry.frames.filter(f => f.kind === 'text').flatMap(f => f.characters.map(c => c.advance))
  expect(advances.length).toBe(n)
  expect(advances.reduce((sum, au) => sum + au, 0)).toBe(p.units[0]!.au)
  expect(linePieces(p, filled.line).fragments.filter(f => f.kind === 'text').map(f => f.painted).join('')).toBe('f'.repeat(n))
  expect(flags.reads()).toBeLessThan(64 * n)
  const run = p.textRuns[0]!, unit = p.units[0]!, part = groupAround(p, run, unit, 1)!
  expect(part.clusters).toBe(n)
  expect(part.hasMarks).toBe(false)
  expect(part.unconfirmed).toBe(true)
  for (let k = 1; k < n; k++) expect(groupAround(p, run, unit, 1 + (k * 37) % (n - 1))).toBe(part)
  expect(flags.reads()).toBeLessThan(64 * n)
})
