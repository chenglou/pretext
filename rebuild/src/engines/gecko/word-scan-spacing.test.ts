// The word scan (lines.ts wordScan) where a word holds spacing: on a constructed Canvas whose every glyph advance is
// positive, negative word spacing on a no-break space inside a word makes the word narrower than its prefix, and a plain
// paragraph must still give the engine loop's lines (an inspected paragraph's).
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../../model.js'
import { fillLine, firstLine } from './index.js'
import { prepareGecko } from './prepare.js'

const NBSP = String.fromCharCode(0xa0)
const ZWJ = String.fromCharCode(0x200d)
const ZWNJ = String.fromCharCode(0x200c)

// 16px: every character 600 au, a space and U+00A0 240, the join controls nothing.
function au(text: string): number {
  let total = 0
  for (let i = 0; i < text.length; i++) total += text[i] === ' ' || text[i] === NBSP ? 240 : text[i] === ZWJ || text[i] === ZWNJ ? 0 : 600
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

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }

function lines(text: string, wordSpacing: number, width: number, inspect: boolean): string {
  const p: Paragraph = {
    font, letterSpacing: 0, wordSpacing, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto',
    tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
  }
  const prepared = prepareGecko(p, env, inspect, [])
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
  // U+00A0 before a join control is no boundary (IsBoundarySpace, gfxFont.cpp:3317-3323: a join control is a cluster
  // extender), so `aaaa`, U+00A0, U+200D, `bb` is one shaped word. The U+00A0 takes word spacing (IsCSSWordSpacingSpace,
  // nsTextFrame.cpp:879-898: a join control is no combining sequence tail) and isn't trimmable. Under -30px of word
  // spacing the word is 3840 - 1800 = 2040 au and its prefix `aaaa` 2400 au: at 2100 au the engine's loop breaks after
  // `aaa`. Firefox 156 does what the loop does: of 84 lab cases of this shape in 16px Arial and "Times New Roman" the
  // inspected path passes 84, and a word scan that passed over this word failed 10, each "native 2 lines, predicted 1".
  const joiners = [ZWJ, ZWNJ]
  for (let j = 0; j < joiners.length; j++) {
    const text = `aaaa${NBSP}${joiners[j]!}bb cc`
    expect(lines(text, -30, 2100 / 60, true)).toBe('[[0,3],[3,11]]')
    for (let a = 600; a <= 4200; a += 60) expect(lines(text, -30, a / 60, false)).toBe(lines(text, -30, a / 60, true))
  }
})

test('positive word spacing on a no-break space inside a word', () => {
  const text = `aaaa${NBSP}${ZWJ}bb cc`
  for (let a = 600; a <= 9000; a += 60) expect(lines(text, 30, a / 60, false)).toBe(lines(text, 30, a / 60, true))
})
