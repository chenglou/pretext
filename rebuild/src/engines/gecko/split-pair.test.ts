import { createContextPool } from '../../measure/canvas.js'
// A surrogate pair that a node boundary cuts, where the second node has another font: the first text run ends with the
// high surrogate, a lone surrogate to the DOM's itemizer as to Canvas, and its script run is Han by the character before
// it. Asked alone, the lone surrogate has no script, so the piece itemizes to Common and needs a character of the run's
// script before it (measure.ts scriptContextFor). The transformed text of every text run is one array, where the low
// surrogate follows: the piece's own script must be read from the piece, never past its end (measure.ts scriptAt).
import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph, type TextStyle } from '../../model.js'
import { fillLine, firstGeckoLine } from './lines.js'
import { prepareGecko } from './prepare.js'

const asked: string[] = []

beforeAll(() => {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(s: string) {
      asked.push(s)
      const width = s.length * 10
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
const otherFont: FontDecl = { family: 'Menlo', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
const style: TextStyle = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'break-all', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 }

test('a lone high surrogate that ends a text run is measured behind a character of the run\'s script, whatever follows it in the next run', () => {
  const han = String.fromCharCode(0x6f22)
  const high = String.fromCharCode(0xd840)
  const low = String.fromCharCode(0xdc00)
  const paragraph: Paragraph = {
    ...style, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
    content: [
      { kind: 'text', text: han + high },
      { ...style, font: otherFont, kind: 'span', lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: low + String.fromCharCode(0x5b57) }] },
    ],
  }
  const p = prepareGecko(paragraph, env, false, createContextPool())
  // A text run a font: the first ends inside the pair and is Han by its first character.
  expect(p.textRuns.length).toBe(2)
  expect(p.textRuns[0]!.scriptRuns).toEqual([{ limit: 2, script: 'Hani' }])
  for (let start = firstGeckoLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 1, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    start = filled.next
  }
  expect(asked).toContain(han + ' ' + high)
  expect(asked).not.toContain(high)
})
