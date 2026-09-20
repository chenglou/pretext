// A wide group whose Canvas total is exact by the grain of its font's values (shape.ts exactBelow16): with unitsPerEm
// given for the family that draws every cluster, a power of two, at a size whose 16.16 scale ends in enough zero bits, the
// group is measured in one question and never cut. The stand-in Canvas is cuts.test.ts's: every code point 10px at 16px.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const LS = String.fromCodePoint(0x2028)

let asked: string[] = []

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked.push(text)
    const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
    const spacing = parseFloat(this.letterSpacing)
    return { width: text.length * 10 * size / 16 + text.length * spacing, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphIn(unitsPerEm: number | null, size: number, letterSpacing: number, text: string = TEXT): Paragraph {
  const fonts = [{ family: 'Mono', realizes: true, coverage: [0x20, 0x7e], ligatures: null, scriptLookups: null, unitsPerEm }]
  return {
    font: { family: 'Mono', size, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, fonts } }, letterSpacing, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function lineCount(paragraph: Paragraph, width: number): number {
  const prepared = prepare(paragraph, env, false, [])
  let lines = 0
  let start = firstLine(prepared)
  while (start !== null) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    lines++
    start = filled.next
  }
  return lines
}

const FIRST_PIECE = TEXT.slice(0, 19).replaceAll(' ', LS)

describe('blink wide groups exact by their grain', () => {
  test('2048 units at 16px: one question for the group, no piece, the same lines', () => {
    asked = []
    prepare(paragraphIn(2048, 16, 0), env, false, [])
    expect(asked.includes(TEXT.replaceAll(' ', LS))).toBe(true)
    expect(asked.includes(FIRST_PIECE)).toBe(false)
    expect(lineCount(paragraphIn(2048, 16, 0), 380)).toBe(1)
    expect(lineCount(paragraphIn(2048, 16, 0), 378)).toBe(lineCount(paragraphIn(null, 16, 0), 378))
    expect(lineCount(paragraphIn(2048, 16, 0), 200)).toBe(lineCount(paragraphIn(null, 16, 0), 200))
  })

  test('no grain, so the group is cut: no unitsPerEm, 1000 units, a size whose scale ends in too few zero bits, a letter spacing of an odd number of units', () => {
    const cut: Paragraph[] = [paragraphIn(null, 16, 0), paragraphIn(1000, 16, 0), paragraphIn(2048, 16.01, 0), paragraphIn(2048, 16, 16385 / 65536)]
    for (let i = 0; i < cut.length; i++) {
      asked = []
      prepare(cut[i]!, env, false, [])
      expect(asked.includes(FIRST_PIECE)).toBe(true)
    }
  })

  test('a letter spacing with the grain keeps the group whole', () => {
    asked = []
    prepare(paragraphIn(2048, 16, 0.5), env, false, [])
    expect(asked.includes(FIRST_PIECE)).toBe(false)
  })

  test('the grain only reaches so far: 2048 units at 16px is exact below 2^33 units', () => {
    // 16.5px leaves 2^15 / 2048 = 16 units of grain, exact below 2^28 units, 4,096 px; 450 code points are 4,640 px.
    const long = 'xxxx '.repeat(90).trimEnd()
    asked = []
    prepare(paragraphIn(2048, 16.5, 0, long), env, false, [])
    expect(asked.some(s => s.length < long.length && s.length > 100)).toBe(true)
  })
})
