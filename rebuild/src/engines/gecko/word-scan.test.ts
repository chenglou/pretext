// The word scan (lines.ts wordScan) on a constructed Canvas. It passes over the break candidates inside a word whose end
// fits, on a premise about fonts: no tail of a shaped word has a negative advance. An inspected paragraph runs the engine's
// loop beside it over the same advances and reports negative-word-tail where the two decide a scan differently; both
// modes give the word scan's lines. Where the font keeps the premise the inspected paragraph must report nothing, at every
// width, and a plain fill whose words fit must ask Canvas nothing. The fonts that break the premise are made up here to
// pin what the word scan gets wrong on them: no installed face has shown one (DESIGN.md §4.6, "Gecko's word scan").
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type FontFacts, type OverflowWrap, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { prepareGecko } from './prepare.js'

const NBSP = String.fromCharCode(0xa0)
const ZWJ = String.fromCharCode(0x200d)
const ZWNJ = String.fromCharCode(0x200c)
const ACUTE = String.fromCharCode(0x301)

// 16px, in au: a letter 576, `i` and the point 200, a space and U+00A0 240, the join controls nothing. Three shapes break
// the premise: `q` takes 300 au back, U+0301 after `i` 300 au, and `V.` 500 au, which the kern pair machine halves between
// the pair's glyphs (hb-kern.hh:102-106), so the point's advance in a word is -50 where the pair kerning fact says split.
// Other sizes scale; letter spacing of 2px, the context that counts ligature groups, adds 120 au a character.
function au(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === ACUTE) total += text[i - 1] === 'i' ? -300 : 0
    else if (ch !== ZWJ && ch !== ZWNJ) total += ch === ' ' || ch === NBSP ? 240 : ch === 'q' ? -300 : ch === 'i' || ch === '.' ? 200 : 576
    if (ch === '.' && text[i - 1] === 'V') total -= 500
  }
  return total
}

let asked = 0

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      asked++
      const width = (au(s) * Number(/(\d+(?:\.\d+)?)px/.exec(this.font)![1]) / 16 + (this.letterSpacing === '2px' ? 120 * s.length : 0)) / 60
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const FACTS: FontFacts = { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false }

type Laid = { ranges: string; asked: number; gaps: string[] }
type Options = { overflowWrap?: OverflowWrap; wordSpacing?: number; facts?: FontFacts }

// The lines' ranges at a width in au, the Canvas questions the fills asked, and the negative-word-tail gaps they raised.
function lines(text: string, widthAu: number, inspect: boolean, options: Options = {}): Laid {
  const p: Paragraph = {
    font: { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: options.facts ?? FACTS }, letterSpacing: 0,
    wordSpacing: options.wordSpacing ?? 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: options.overflowWrap ?? 'break-word',
    lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
  }
  const prepared = prepareGecko(p, env, inspect, createContextPool())
  const before = asked
  const out: [number, number][] = []
  const gaps: string[] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    out.push([filled.start, filled.end])
    for (const gap of filled.line.inspect?.gaps ?? []) if (gap.gap === 'negative-word-tail') gaps.push(gap.detail)
    start = filled.next
  }
  return { ranges: JSON.stringify(out), asked: asked - before, gaps }
}

test("where no word has a negative tail, the engine's loop decides every scan as the word scan does, at every width", () => {
  const text = 'aaa bbbb cc well-known dddd a b supercalifragilistic e  f'
  const wraps: OverflowWrap[] = ['normal', 'break-word', 'anywhere']
  for (let w = 0; w < wraps.length; w++) {
    const overflowWrap = wraps[w]!
    for (let a = 200; a <= 9000; a += 37) {
      const inspected = lines(text, a, true, { overflowWrap })
      expect(inspected.gaps).toEqual([])
      expect(lines(text, a, false, { overflowWrap }).ranges).toBe(inspected.ranges)
    }
  }
})

test("a plain fill whose words fit asks Canvas nothing, where the engine's loop asks about every cluster of each line's first word", () => {
  const text = 'aaa bbbb cc dddd a b'
  expect(lines(text, 3000, false)).toEqual({ ranges: '[[0,4],[4,9],[9,12],[12,17],[17,20]]', asked: 0, gaps: [] })
  expect(lines(text, 3000, true).asked).toBeGreaterThan(0)
})

// Each font breaks the premise in one way, at a width where the word fits and its prefix doesn't: the engine's loop breaks
// after the first letter, and the word scan keeps the word whole. That is the wrong line, pinned, in both modes.
// - `before-last`: the glyph before the last takes back more than the last gives: `xqi` is 476 au and its prefix `x` 576.
// - `mark`: a mark takes back more than its base gives: `aai` and U+0301 is 1052 au and its prefix `aa` 1152.
// - `pair`: `aV.` is 852 au, and the advance before its point 902, `a` and `V` less its half of the pair. Every string
//   Canvas can be asked is wider than nothing, the point alone too, so no guard over measured suffixes would see it.
// - `last`: the last glyph's advance is negative: `xq` is 276 au and its prefix 576.
const SHAPES = [
  { name: 'before-last', text: 'xqi i', widthAu: 500, facts: FACTS, lines: '[[0,4],[4,5]]' },
  { name: 'mark', text: `aai${ACUTE} i`, widthAu: 1100, facts: FACTS, lines: '[[0,5],[5,6]]' },
  { name: 'pair', text: 'aV. i', widthAu: 860, facts: { ...FACTS, pairKerning: 'split' as const }, lines: '[[0,4],[4,5]]' },
  { name: 'last', text: 'xq i', widthAu: 300, facts: FACTS, lines: '[[0,3],[3,4]]' },
]
describe("a made-up font that breaks the premise: the word scan's wrong line, and the gap that names it", () => {
  for (let s = 0; s < SHAPES.length; s++) {
    const shape = SHAPES[s]!
    test(shape.name, () => {
      const inspected = lines(shape.text, shape.widthAu, true, { facts: shape.facts })
      expect(lines(shape.text, shape.widthAu, false, { facts: shape.facts }).ranges).toBe(shape.lines)
      expect(inspected.ranges).toBe(shape.lines)
      expect(inspected.gaps.length).toBe(1)
      expect(inspected.gaps[0]).toStartWith("from offset 0, the engine's loop fits the text to offset 1 ")
    })
  }
})

test('without the pair kerning fact the port puts the whole adjustment on the first glyph, and the scans agree', () => {
  // The constructed pair tells Canvas nothing of its placement (an even adjustment divides the same either way), so the
  // advance before the point is the word less the point, 652 au, in both scans: the engine's -50 au point is a gap of the
  // port's numbers, not of the word scan.
  for (let a = 200; a <= 1600; a += 20) expect(lines('aV. i', a, true).gaps).toEqual([])
})

test("negative word spacing on a no-break space inside a word leaves the scan to the engine's loop", () => {
  // U+00A0 before a join control is no boundary (IsBoundarySpace, gfxFont.cpp:3317-3323: a join control is a cluster
  // extender), so `aaaa`, U+00A0, U+200D, `bb` is one shaped word. The U+00A0 takes word spacing (IsCSSWordSpacingSpace,
  // nsTextFrame.cpp:879-898: a join control is no combining sequence tail) and isn't trimmable. Under -30px of word
  // spacing the word is 3696 - 1800 = 1896 au and its prefix `aaaa` 2304 au: at 2100 au the engine's loop breaks after
  // `aaa`. Firefox 156 does what the loop does: of 84 lab cases of this shape in 16px Arial and "Times New Roman" the
  // inspected path passed 84, and a word scan that passed over this word failed 10, each "native 2 lines, predicted 1".
  const joiners = [ZWJ, ZWNJ]
  for (let j = 0; j < joiners.length; j++) {
    const text = `aaaa${NBSP}${joiners[j]!}bb cc`
    expect(lines(text, 2100, false, { wordSpacing: -30 }).ranges).toBe('[[0,3],[3,11]]')
    for (let a = 600; a <= 4200; a += 60) expect(lines(text, a, true, { wordSpacing: -30 }).gaps).toEqual([])
  }
  for (let a = 600; a <= 9000; a += 60) expect(lines(`aaaa${NBSP}${ZWJ}bb cc`, a, true, { wordSpacing: 30 }).gaps).toEqual([])
})
