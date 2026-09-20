// The word scan's premise (lines.ts wordScan: no suffix of a shaped word has a negative advance) against a constructed
// font that breaks it four ways, and against the two Canvas guards argued for it. The library holds no guard, so each
// shape is written down with what the library does: an inspected paragraph's lines are the engine loop's, a plain
// paragraph's the word scan's, and where they differ nothing says so (a plain paragraph carries no gaps).
// - `before-last`: the glyph before the last takes back more than the last gives (advances 576, -300, 200).
// - `mark`: a mark takes back more than its base gives (`i` 200, U+0301 after it -300), the word's last cluster.
// - `pair`: the kern pair machine halves an adjustment between the pair's two glyphs (hb-kern.hh:102-106), and `V.`
//   takes back 500 au where the point is 200: the point's advance in the word is -50. Every string Canvas can be asked
//   is wider than nothing, the point alone too.
// - `last`: the last glyph's advance is negative (word-scan.test.ts holds the same shape).
// A guard is a set of Canvas questions that must refuse the word before the word scan passes it:
// - `every suffix`: W(suffix) < 0 at some cluster start inside the word;
// - `last cluster`: W(the last cluster) < 0.
// Neither sees `pair`, since the port's advance there is the word less the suffix less the half the suffix's first
// glyph holds in the word (advance.ts pairKernedShare), and that half is in no suffix measured alone. `last cluster`
// doesn't see `before-last`. So a guard over measured suffixes proves the premise only where every advance is the word
// less a suffix, and a guard over some suffixes proves nothing.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type FontFacts, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { prepareGecko } from './prepare.js'

const ACUTE = String.fromCharCode(0x301)

// 16px, in au: a letter 576, `i` and the point 200, a space 240, `q` -300, U+0301 -300 after `i` and nothing elsewhere,
// and `V.` -500 in halves on its two glyphs. Other sizes scale.
function au(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === ACUTE) total += text[i - 1] === 'i' ? -300 : 0
    else total += ch === ' ' ? 240 : ch === 'q' ? -300 : ch === 'i' || ch === '.' ? 200 : 576
    if (ch === '.' && text[i - 1] === 'V') total -= 500
  }
  return total
}

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      const width = au(s) * Number(/(\d+(?:\.\d+)?)px/.exec(this.font)![1]) / 16 / 60
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}

function lines(text: string, facts: FontFacts, widthAu: number, inspect: boolean): string {
  const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts }
  const p: Paragraph = {
    font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto',
    tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
  }
  const prepared = prepareGecko(p, env, inspect, [])
  const out: [number, number][] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    out.push([filled.start, filled.end])
    start = filled.next
  }
  return JSON.stringify(out)
}

// The two guards over a text's first word, whose clusters start at `starts` (the word's own start left out).
const everySuffix = (word: string, starts: readonly number[]): boolean => starts.some(t => au(word.slice(t)) < 0)
const lastCluster = (word: string, starts: readonly number[]): boolean => au(word.slice(starts[starts.length - 1]!)) < 0

const facts = { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false }
const SHAPES = [
  // `xqi` is 476 au and its prefix `x` 576.
  { name: 'before-last', text: 'xqi i', word: 'xqi', starts: [1, 2], facts, widthAu: 500, loop: '[[0,1],[1,5]]', plain: '[[0,4],[4,5]]', everySuffix: true, lastCluster: false },
  // `aai` and U+0301 is 1052 au and its prefix `aa` 1152.
  { name: 'mark', text: `aai${ACUTE} i`, word: `aai${ACUTE}`, starts: [1, 2], facts, widthAu: 1100, loop: '[[0,1],[1,6]]', plain: '[[0,5],[5,6]]', everySuffix: true, lastCluster: true },
  // `aV.` is 852 au, and the advance before its point 902: `a`, and `V` less its half of the pair.
  { name: 'pair', text: 'aV. i', word: 'aV.', starts: [1, 2], facts: { ...facts, pairKerning: 'split' as const }, widthAu: 860, loop: '[[0,1],[1,5]]', plain: '[[0,4],[4,5]]', everySuffix: false, lastCluster: false },
  { name: 'last', text: 'xq i', word: 'xq', starts: [1], facts, widthAu: 300, loop: '[[0,1],[1,4]]', plain: '[[0,3],[3,4]]', everySuffix: true, lastCluster: true },
]

for (let s = 0; s < SHAPES.length; s++) {
  const shape = SHAPES[s]!
  test(`a font that breaks the premise, ${shape.name}: the engine's loop, the word scan, and what each guard sees`, () => {
    expect(lines(shape.text, shape.facts, shape.widthAu, true)).toBe(shape.loop)
    expect(lines(shape.text, shape.facts, shape.widthAu, false)).toBe(shape.plain)
    expect(everySuffix(shape.word, shape.starts)).toBe(shape.everySuffix)
    expect(lastCluster(shape.word, shape.starts)).toBe(shape.lastCluster)
  })
}

test('without the pair kerning fact the port puts the whole adjustment on the first glyph, and both scans agree', () => {
  // The constructed pair tells Canvas nothing of its placement (an even adjustment divides the same either way), so
  // the advance before the point is the word less the point, 652 au, in both scans: the engine's -50 au point is a
  // gap of the port's numbers, not of the word scan.
  for (let a = 200; a <= 1600; a += 20) expect(lines('aV. i', facts, a, false)).toBe(lines('aV. i', facts, a, true))
})
