// The study's default for the boundaries no ligature fact settles (ligatures.ts `study`), on a stand-in Canvas where every
// base character is 10px wide at 16px and U+200D and combining marks are 0: a font whose lam-alef is as wide as its parts.
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'
import { study } from './ligatures.js'

const ZWJ = String.fromCodePoint(0x200d)
const KASRA = String.fromCodePoint(0x650)
const BEH = String.fromCodePoint(0x628)
const LAM = String.fromCodePoint(0x644)
const ALEF = String.fromCodePoint(0x627)
const HEH = String.fromCodePoint(0x647)

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
    const bases = text.split(ZWJ).join('').split(KASRA).join('')
    return { width: bases.length * 10 * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

afterEach(() => {
  study.clusterDefault = 'letters'
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'ar', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function linesOf(text: string, width: number): [number, number][] {
  const paragraph: Paragraph = {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'rtl',
    lang: 'ar', textIndent: 0, textAlign: 'start',
  }
  const prepared = prepare(paragraph, env, false, [])
  const lines: [number, number][] = []
  let start = firstLine(prepared)
  while (start !== null) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    lines.push([filled.start, filled.end])
    start = filled.next
  }
  return lines
}

describe('blink cluster default', () => {
  // beh, lam, alef, beh at 25px: two letters fit. With every letter its own cluster the line ends after lam; with lam-alef
  // one cluster the offset before alef has lam's position, so the line ends before lam (shape_result.cc:2113-2200).
  test('letters: a line can end between lam and alef', () => {
    expect(linesOf(BEH + LAM + ALEF + BEH, 25)).toEqual([[0, 2], [2, 4]])
  })

  test('lam-alef: it ends before lam, with a mark between them too', () => {
    study.clusterDefault = 'lam-alef'
    expect(linesOf(BEH + LAM + ALEF + BEH, 25)).toEqual([[0, 1], [1, 3], [3, 4]])
    expect(linesOf(BEH + LAM + KASRA + ALEF + BEH, 25)).toEqual([[0, 1], [1, 4], [4, 5]])
  })

  // The stand-in Canvas measures lam, U+200D, alef as lam, alef, so the Canvas test says no ligature.
  test('canvas-lam-alef: falls back to letters where U+200D changes nothing', () => {
    study.clusterDefault = 'canvas-lam-alef'
    expect(linesOf(BEH + LAM + ALEF + BEH, 25)).toEqual([[0, 2], [2, 4]])
  })

  // beh, lam, lam, heh at 25px. One cluster of three letters never fits, so the line after beh overflows: Blink then takes the
  // next break opportunity, a grapheme boundary inside the glyph (is_overflow, shaping_line_breaker.cc:402-409).
  test('encoded-ligatures: lam lam heh is one cluster', () => {
    study.clusterDefault = 'encoded-ligatures'
    expect(linesOf(BEH + LAM + LAM + HEH, 25)).toEqual([[0, 1], [1, 2], [2, 4]])
  })
})
