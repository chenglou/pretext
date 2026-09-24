// Whether a total is exact is judged on Canvas's answers, before the port adds spacing (shape.ts measureTotal16), on a
// stand-in Canvas that answers as Chrome's does: the float32 of a total of 16.16 units, so a total of 256 px or more
// rounds to an even number of units. Every code point is 10px and one unit wide at 16px, at a device pixel ratio of 1.
// TEXT is two words, 14 and 13 code points: together they are 270px and 27 units, which Canvas rounds to 28 units, and
// under word spacing of -20px the port brings them to 250px and 27 units, below 256px, so the rounded answer looked exact.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { paragraphGaps, prepare } from './index.js'

const TEXT = `${'x'.repeat(13)} ${'x'.repeat(13)}`
const UNIT = 1 / 65536

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    return { width: Math.fround(text.length * (10 + UNIT)), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraph(wordSpacing: number): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: TEXT }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

describe('blink exactness of a total', () => {
  test('a total that word spacing brings below 256 zoomed px is exact only where Canvas answered it below 256', () => {
    // The group's advances: 27 code points of 10px and a unit each, less the word spacing on the one space.
    const exact = 27 * (10 * 65536 + 1) - 20 * 65536
    for (const inspect of [false, true]) {
      const p = prepare(paragraph(-20), env, inspect, createContextPool())
      const group = p.groups[0]!
      expect(group.prefixAtCut[group.prefixAtCut.length - 1]).toBe(exact)
      if (inspect) expect(paragraphGaps(p)).toEqual([])
    }
  })

  test('without spacing the same total is 256 zoomed px or more and is cut beside the space', () => {
    const p = prepare(paragraph(0), env, false, createContextPool())
    const group = p.groups[0]!
    expect(group.cuts).toEqual([0, 13, 27])
    expect(group.prefixAtCut[2]).toBe(27 * (10 * 65536 + 1))
  })
})
