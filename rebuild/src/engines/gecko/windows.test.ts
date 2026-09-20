// A long shaping unit's windows (advance.ts windowsOf): a cut that a kerned pair crosses and a cut inside a ligature as
// wide as its parts don't hold, the windows add up to the unit, and the lines are the glyph records' lines, plain and
// inspected, at every width of a sweep.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { prepareGecko } from './prepare.js'

// 16px: a letter's advance goes by its code, each glyph rounded on its own. `A` before `V` is 41 au narrower, all on
// the `A` (GPOS). `ff` is one ligature glyph as wide as two `f`, where ligatures are on; its ink box shows it.
const advanceOf = (c: string): number => c === 'A' ? 600.4 : c === 'V' ? 590.2 : c === 'f' ? 576.2 : 500.3 + 7 * (c.charCodeAt(0) % 13)
const glyph = (text: string, i: number): number => Math.floor(advanceOf(text[i]!) - (text[i] === 'A' && text[i + 1] === 'V' ? 41 : 0) + 0.5)

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
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
  const prepared = prepareGecko(paragraphOf(text), env, inspect, [])
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
