// A window inside a long shaping unit is measured alone, but the DOM shapes the unit in one buffer, and HarfBuzz looks
// through that whole buffer when it decides whether to shape a right-to-left script in a left-to-right run reversed: a
// buffer with digits and no letter stays left to right, one with a letter is reversed (advance.ts shapedReversed;
// hb-ot-shape.cc:588-645). A window of digits alone would be shaped the other way round than the unit, so such a unit
// has no windows (advance.ts windowsOf) and its offsets are measured as the reversed unit's.
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../../model.js'
import { advanceBefore } from './advance.js'
import { prepareGecko } from './prepare.js'

// `1` before `7` is 41 au narrower; U+202D has no advance.
const advanceOf = (c: string): number => c === '1' ? 600.4 : c === '7' ? 590.2 : 500.3 + 7 * (c.charCodeAt(0) % 13)
const glyph = (text: string, i: number): number => Math.floor(advanceOf(text[i]!) - (text[i] === '1' && text[i + 1] === '7' ? 41 : 0) + 0.5)

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      let au = 0
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) !== 0x202d) au += glyph(s, i) + (this.letterSpacing === '2px' ? 120 : 0)
      const width = Math.fround(au / 60)
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
})

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }

test('a right-to-left script in a left-to-right run has no windows, and its offsets are measured as in the reversed unit', () => {
  // Under U+202D everything is at level 2: six Hebrew letters, sixty digits and three letters are one unit of a
  // right-to-left script in a left-to-right run. Cuts would fall between `7` and `1`, which don't kern, and hold.
  let digits = ''
  for (let i = 0; i < 30; i++) digits += '17'
  const text = String.fromCodePoint(0x202d) + 'אבגדהו' + digits + 'אבג'
  const paragraph: Paragraph = {
    font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto',
    tabSize: 8, direction: 'rtl', lang: 'he', textIndent: 0, textAlign: 'start', content: [{ kind: 'text', text }],
  }
  const p = prepareGecko(paragraph, env, false, [])
  const run = p.textRuns[p.textRuns.length - 1]!
  expect(run.level).toBe(2)
  const unit = p.units[p.unitOf[run.tStart]!]!
  expect(unit.tEnd - unit.tStart).toBe(69)
  let kerned = 0
  for (let t = unit.tStart + 1; t < unit.tEnd; t++) {
    const reason = advanceBefore(p, run, t).standIn
    if (reason === null) continue
    expect(reason.kind).toBe('sides')
    // A reversed unit's sides are measured apart; the cluster form is for a unit shaped in its own direction.
    if (reason.kind === 'sides') expect(reason.sides).toBe('apart')
    kerned++
  }
  expect(kerned).toBe(30)
  expect(unit.inWord!.windows).toEqual([])
})
