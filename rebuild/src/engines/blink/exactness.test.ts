// Whether a total is exact is judged on Canvas's answers, before the port adds spacing (shape.ts measureTotal16), on a
// stand-in Canvas that answers as Chrome's does: the float32 of a total of 16.16 units, so a total of 256 px or more
// rounds to an even number of units. Every code point is 10px and one unit wide at 16px, at a device pixel ratio of 1.
// TEXT is two words, 14 and 13 code points: together they are 270px and 27 units, which Canvas rounds to 28 units, and
// under word spacing of -20px the port brings them to 250px and 27 units, below 256px, so the rounded answer looks exact.
// It is near (within the unit Canvas rounded): the words' test doesn't take it, and the group is one piece a unit off.
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
    // `Far`: 12px and a unit a code point, and a string that holds both `Q` and `Z` 2px narrower, a context no window of
    // 256 px that splits them shows.
    if (this.font.includes('Far')) return { width: Math.fround(text.length * (12 + UNIT) - (text.includes('Q') && text.includes('Z') ? 2 : 0)), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
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

function paragraph(wordSpacing: number, family: string = 'Mono', text: string = TEXT): Paragraph {
  return {
    font: { family, size: family === 'Far' ? 80 : 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

describe('blink exactness of a total', () => {
  test('a total that word spacing brings below 256 zoomed px is near where Canvas rounded it: no word cut, one piece', () => {
    // The group's advances: 27 code points of 10px and a unit each, less the word spacing on the one space.
    const exact = 27 * (10 * 65536 + 1) - 20 * 65536
    for (const inspect of [false, true]) {
      const p = prepare(paragraph(-20), env, inspect, createContextPool())
      const group = p.groups[0]!
      expect(group.cuts).toEqual([0, 27])
      expect(Math.abs(group.prefixAtCut[1]! - exact)).toBeLessThanOrEqual(1)
      if (inspect) expect(paragraphGaps(p).map(gap => gap.gap)).toEqual(['float32-precision'])
    }
  })

  test('a near window vetoes the zero of the exact window inside it where its adjustment is past its rounding', () => {
    // At 80px words first is off. The group, 420px less 2 for Q and Z and 60 of word spacing, is 358px, no near total. At
    // the first space the exact windows split Q from Z and show nothing, and the near window [0, 23), 276px less 30 of word
    // spacing and rounded by a unit, shows the 2px: the offset isn't a cut, and the near piece [0, 23) holds the context.
    const text = 'Qxxxxxxxxxx xxxxxxxxxxZ yyyyyyyyyyy'
    const p = prepare(paragraph(-30, 'Far', text), env, false, createContextPool())
    const group = p.groups[0]!
    expect(group.cuts).toEqual([0, 23, 35])
    expect(Math.abs(group.prefixAtCut[1]! - (23 * (12 * 65536 + 1) - 2 * 65536 - 30 * 65536))).toBeLessThanOrEqual(1)
    // Without word spacing no window is near, and the cut search splits Q from Z as before: a context past 256 px.
    expect(prepare(paragraph(0, 'Far', text), env, false, createContextPool()).groups[0]!.cuts).toEqual([0, 12, 23, 35])
  })

  test('without spacing the same total is 256 zoomed px or more and is cut beside the space', () => {
    const p = prepare(paragraph(0), env, false, createContextPool())
    const group = p.groups[0]!
    expect(group.cuts).toEqual([0, 13, 27])
    expect(group.prefixAtCut[2]).toBe(27 * (10 * 65536 + 1))
  })
})
