// The plain paragraph's lazy break scan must give the inspected paragraph's lines when a ligature group that reaches past
// the frame's end starts at a kerned cut the scan read rough (found by correctness round 5's critic: before the scan kept
// what it read at its pending offset, a constructed paragraph differed at 22 of 901 widths).
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { prepareGecko } from './prepare.js'

// 16px: every letter 576.0 au, `f` 576.2. `A` before `f` kerns by -44.8 au in halves, each glyph rounded on its own.
// `ff` is one ligature glyph of 1140.2 au, taken from the start of a row; its ink box shows it (as the port's stub does).
function au(font: string, text: string): number {
  const size = Number(/([\d.]+)px/.exec(font)![1])
  const r = (w: number): number => Math.floor(w * size / 16 + 0.5)
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const kernedAfterA = i > 0 && text[i - 1] === 'A' && c === 'f'
    if (c === 'A') { total += r(576.0 - (text[i + 1] === 'f' ? 22.4 : 0)); continue }
    if (c === 'f' && text[i + 1] === 'f') { total += r(1140.2 - (kernedAfterA ? 22.4 : 0)); i++; continue }
    if (c === 'f') { total += r(576.2 - (kernedAfterA ? 22.4 : 0)); continue }
    total += r(576.0)
  }
  return total
}

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      const spacing = this.letterSpacing === '2px' ? 120 * s.length : 0
      const width = Math.fround((au(this.font, s) + spacing) / 60)
      const right = s === 'ff' && this.letterSpacing !== '0px' ? width + 0.006 : width
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: right }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }

function lines(width: number, inspect: boolean): [number, number][] {
  const span: InlineNode = {
    kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
    tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'f' }],
  }
  const p: Paragraph = {
    font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
    tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text: 'Aff' }, span],
  }
  const prepared = prepareGecko(p, env, inspect, [])
  const out: [number, number][] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    out.push([filled.start, filled.end])
    start = filled.next
  }
  return out
}

test('plain and inspected lines over a sweep of widths', () => {
  const differing: { width: number; plain: string; inspected: string }[] = []
  for (let a = 500; a <= 2300; a += 2) {
    const width = a / 60
    const plain = JSON.stringify(lines(width, false))
    const inspected = JSON.stringify(lines(width, true))
    if (plain !== inspected) differing.push({ width: a, plain, inspected })
  }
  console.log(JSON.stringify({ count: differing.length, first: differing.slice(0, 3), last: differing.slice(-1) }))
  expect(differing).toEqual([])
})
