// The word scan (lines.ts wordScan) attacked on a constructed Canvas whose every glyph advance is positive: a shape where
// its lines leave the engine loop's though no suffix of a word has a negative advance, so its premise as stated doesn't
// cover it. The test asserts that the two differ and that the checked mode throws; it is here to fail once the word scan
// refuses the shape (tools/word-scan-attack.ts found it and looks for others).
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type OverflowWrap, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { wordScanState } from './lines.js'
import { prepareGecko } from './prepare.js'

const NBSP = String.fromCharCode(0xa0)
const ZWJ = String.fromCharCode(0x200d)

// 16px: every character 600 au, a space and U+00A0 240, U+200D nothing.
function au(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) total += text[i] === ' ' || text[i] === NBSP ? 240 : text[i] === ZWJ ? 0 : 600
  return total
}

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      const width = au(s) / 60
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

function lines(text: string, overflowWrap: OverflowWrap, wordSpacing: number, width: number, mode: typeof wordScanState.mode, checked: boolean): string {
  wordScanState.mode = mode
  wordScanState.checked = checked
  const p: Paragraph = {
    font, letterSpacing: 0, wordSpacing, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap, lineBreak: 'auto',
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

test('negative word spacing on a no-break space inside a word', () => {
  // U+00A0 before U+200D is no boundary (IsBoundarySpace, gfxFont.cpp:3317-3323: U+200D is a cluster extender), so `aaaa`,
  // U+00A0, U+200D, `bb` is one shaped word. The U+00A0 takes word spacing (IsCSSWordSpacingSpace, nsTextFrame.cpp:880-898:
  // U+200D is no combining sequence tail) and isn't trimmable, so the unit holds no trimmable space and the word scan
  // passes over it where its end fits. Under -30px of word spacing the word is 3840 - 1800 = 2040 au and its prefix `aaaa`
  // 2400 au: at 2100 au the engine's loop breaks after `aaa`, and the word scan keeps the paragraph on one line.
  // Firefox 156 does what the engine's loop does: of 84 lab cases of this shape in 16px Arial and "Times New Roman" the
  // inspected path passes 84 and the plain predictor in mode 'premise' fails 10, each "native 2 lines, predicted 1".
  const text = `aaaa${NBSP}${ZWJ}bb cc`
  expect(lines(text, 'break-word', -30, 2100 / 60, 'exact', false)).toBe('[[0,3],[3,11]]')
  expect(lines(text, 'break-word', -30, 2100 / 60, 'proven', false)).toBe('[[0,3],[3,11]]')
  expect(lines(text, 'break-word', -30, 2100 / 60, 'premise', false)).toBe('[[0,11]]')
  expect(() => lines(text, 'break-word', -30, 2100 / 60, 'premise', true)).toThrow('the word scan differs')
})
