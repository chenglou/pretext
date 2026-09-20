// The word scan (lines.ts wordScan) against the engine's loop on a constructed Canvas: the same lines at every width in
// each of its modes, its checked mode silent, and the one shape where its premise fails, written down as a test so that
// nobody takes the premise for a proof: a glyph with a negative advance makes a word's prefix wider than the word.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type OverflowWrap, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { wordScanState } from './lines.js'
import { prepareGecko } from './prepare.js'

// 16px: every character 576 au, `i` 200, a space 240, and `q` takes 300 au back: an advance of -300.
function au(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) total += text[i] === ' ' ? 240 : text[i] === 'q' ? -300 : text[i] === 'i' ? 200 : 576
  return total
}

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      const width = (au(s) + (this.letterSpacing === '2px' ? 120 * s.length : 0)) / 60
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

afterAll(() => {
  wordScanState.mode = 'premise'
  wordScanState.checked = false
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }

function lines(text: string, overflowWrap: OverflowWrap, width: number, mode: typeof wordScanState.mode, checked: boolean): string {
  wordScanState.mode = mode
  wordScanState.checked = checked
  const p: Paragraph = {
    font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap, lineBreak: 'auto',
    tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
  }
  const prepared = prepareGecko(p, env, false, [])
  const out: [number, number][] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('refused')
    out.push([filled.start, filled.end])
    start = filled.next
  }
  return JSON.stringify(out)
}

test('the word scan gives the engine loop\'s lines at every width, in each mode', () => {
  const text = 'aaa bbbb cc well-known dddd a b supercalifragilistic e  f'
  const wraps: OverflowWrap[] = ['normal', 'break-word', 'anywhere']
  let decided = 0
  for (let w = 0; w < wraps.length; w++) {
    for (let a = 200; a <= 9000; a += 37) {
      const exact = lines(text, wraps[w]!, a / 60, 'exact', false)
      const before = wordScanState.proven + wordScanState.premise
      expect(lines(text, wraps[w]!, a / 60, 'proven', true)).toBe(exact)
      expect(lines(text, wraps[w]!, a / 60, 'premise', true)).toBe(exact)
      decided += wordScanState.proven + wordScanState.premise - before
    }
  }
  expect(decided).toBeGreaterThan(1000)
})

test('the premise\'s hole: a negative advance makes a prefix wider than its word', () => {
  // `xq` is 276 au and its prefix `x` 576. At 300 au the word fits and its prefix doesn't: the engine's loop breaks after
  // `x`, and `q i`, 140 au, is the second line; the word scan, which passes over a word's inner candidates where the
  // word's end fits, keeps `xq` whole.
  expect(lines('xq i', 'break-word', 300 / 60, 'exact', false)).toBe('[[0,1],[1,4]]')
  expect(lines('xq i', 'break-word', 300 / 60, 'proven', false)).toBe('[[0,1],[1,4]]')
  expect(lines('xq i', 'break-word', 300 / 60, 'premise', false)).toBe('[[0,3],[3,4]]')
  expect(() => lines('xq i', 'break-word', 300 / 60, 'premise', true)).toThrow('the word scan differs')
})
