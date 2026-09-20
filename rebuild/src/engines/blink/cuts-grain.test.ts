// A wide group whose Canvas totals are exact by the grain of its font's values (shape.ts exactBelow16): with unitsPerEm
// given for the family that draws every cluster, a power of two, at a size whose 16.16 scale ends in enough zero bits, a
// window around an offset measures whole, without shrinking under 256 zoomed px, so the cut search's wide window is the
// range being cut. The pieces stay below 256 zoomed px. The stand-in Canvas is cuts.test.ts's: every code point 10px at
// 16px, and family `Kern` kerns a space with `V` by -4px.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const LS = String.fromCodePoint(0x2028)

let asked: string[] = []

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

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
    const kern = this.font.includes('Kern') ? 4 * count(text, `${LS}V`) : 0
    return { width: (text.length * 10 - kern) * size / 16 + text.length * parseFloat(this.letterSpacing), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphIn(family: string, unitsPerEm: number | null, size: number, letterSpacing: number): Paragraph {
  const fonts = [{ family, realizes: true, coverage: [0x20, 0x7e], ligatures: null, scriptLookups: null, unitsPerEm }]
  return {
    font: { family, size, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, fonts } }, letterSpacing, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: TEXT }], lineHeight: 20, direction: 'ltr',
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

function questions(paragraph: Paragraph): string[] {
  asked = []
  prepare(paragraph, env, false, [])
  return asked
}

const FIRST_PIECE = TEXT.slice(0, 19).replaceAll(' ', LS)
// What the search's window shrinks to without the grain: the group less its first half-distance, below 256px.
const isShrunkWindow = (s: string): boolean => s.length > 19 && s.length < 38

describe('blink wide groups exact by their grain', () => {
  test('2048 units at 16px: the same cut and lines, and no window shrunk under 256px', () => {
    const plain = questions(paragraphIn('Mono', null, 16, 0))
    const grain = questions(paragraphIn('Mono', 2048, 16, 0))
    expect(plain.includes(FIRST_PIECE)).toBe(true)
    expect(grain.includes(FIRST_PIECE)).toBe(true)
    expect(plain.some(isShrunkWindow)).toBe(true)
    expect(grain.some(isShrunkWindow)).toBe(false)
    expect(grain.length).toBeLessThan(plain.length)
    const widths = [380, 378, 200, 97]
    for (let i = 0; i < widths.length; i++) expect(lineCount(paragraphIn('Mono', 2048, 16, 0), widths[i]!)).toBe(lineCount(paragraphIn('Mono', null, 16, 0), widths[i]!))
  })

  test('the whole range as the window still moves the cut off an offset where the two sides change each other', () => {
    expect(lineCount(paragraphIn('Kern', 2048, 16, 0), 376)).toBe(1)
    expect(lineCount(paragraphIn('Kern', 2048, 16, 0), 374)).toBe(2)
  })

  test('no grain, so windows shrink: 1000 units, a size whose scale ends in too few zero bits, a letter spacing of an odd number of units', () => {
    const none: Paragraph[] = [paragraphIn('Mono', 1000, 16, 0), paragraphIn('Mono', 2048, 16.01, 0), paragraphIn('Mono', 2048, 16, 16385 / 65536)]
    for (let i = 0; i < none.length; i++) expect(questions(none[i]!).some(isShrunkWindow)).toBe(true)
  })

  test('a letter spacing with the grain keeps it', () => {
    expect(questions(paragraphIn('Mono', 2048, 16, 0.5)).some(isShrunkWindow)).toBe(false)
  })
})
