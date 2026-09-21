// A long shaping unit's windows (advance.ts windowsOf): a cut that a kerned pair crosses and a cut inside a ligature as
// wide as its parts don't hold, the windows add up to the unit, and the lines are the glyph records' lines, plain and
// inspected, at every width of a sweep.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../../model.js'
import { fillLine, firstLine, linePieces, inspectLine } from './index.js'
import { advanceBefore } from './advance.js'
import { createContextPool } from '../../measure/canvas.js'
import { prepareGecko } from './prepare.js'

// 16px: a letter's advance goes by its code, each glyph rounded on its own. `A` before `V` is 41 au narrower, all on
// the `A` (GPOS). `ff` is one ligature glyph as wide as two `f`, where ligatures are on; its ink box shows it.
const advanceOf = (c: string): number => c === 'A' ? 600.4 : c === 'V' ? 590.2 : c === 'f' ? 576.2 : 500.3 + 7 * (c.charCodeAt(0) % 13)
const glyph = (text: string, i: number): number => Math.floor(advanceOf(text[i]!) - (text[i] === 'A' && text[i + 1] === 'V' ? 41 : 0) + 0.5)

let questions: string[] = []

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      questions.push(s)
      let au = this.letterSpacing === '2px' ? 120 * s.length : 0
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
