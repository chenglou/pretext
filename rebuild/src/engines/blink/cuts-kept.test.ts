import { createContextPool } from '../../measure/canvas.js'
// For the merge with kept positions (BlinkGroup.wide16): a cut before white space between two pieces, on a stand-in Canvas
// where every code point is 10px wide at 16px. TEXT is 39 units and 390px, cut once at 19, before a space. The search measured
// 0 across 19 in the window the adjustment at the cut is taken in, so a plain paragraph keeps that 0 by offset and a line that
// ends at the cut asks Canvas nothing about it.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'

const TEXT = 'xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx'
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
    return { width: text.length * 10 * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

const paragraph: Paragraph = {
  font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
  wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: TEXT }], lineHeight: 20, direction: 'ltr',
  lang: 'en', textIndent: 0, textAlign: 'start',
}

describe('blink cuts of a wide group: the 0 the search measured is kept by offset', () => {
  test('a line that ends at a cut before white space asks nothing across the cut', () => {
    const prepared = prepare(paragraph, env, false, createContextPool())
    asked = []
    const first = fillLine(prepared, firstLine(prepared)!, { width: 190, left: 0, right: 0 })
    if (first.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    expect(first.end).toBe(20)
    // The search's window around 19 is the whole text's shrunk to [10, 29); its sides are [10, 19) and [19, 29).
    expect(asked.includes(TEXT.slice(10, 29).replaceAll(' ', LS))).toBe(false)
  })
})
