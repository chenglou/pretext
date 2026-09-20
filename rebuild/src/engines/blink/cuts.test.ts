// The cut of a shaping group of 256 zoomed px or more (shape.ts addPieces, measureGroups; gaps.ts cutAdjustment) on a
// stand-in Canvas where every code point is 10px wide at 16px. The text is 38 units and 380px, so it is cut once, at the
// offset nearest its middle beside a space: 19, after the space and before `V`. Family `Kern` kerns a space with `V` by
// -4px; family `Context` takes 2px more off where `x` stands before that space, which a window of one cluster on each
// side doesn't show; family `Mono` adjusts nothing. Measured strings carry U+2028 for U+0020 (shape.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, paragraphGaps, prepare } from './index.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const LS = String.fromCodePoint(0x2028)

let asked = 0

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
    asked++
    const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
    const kern = this.font.includes('Mono') ? 0 : 4 * count(text, `${LS}V`) + (this.font.includes('Context') ? 2 * count(text, `x${LS}V`) : 0)
    return { width: (text.length * 10 - kern) * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphIn(family: string): Paragraph {
  return {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: TEXT }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function lineCount(family: string, width: number): number {
  const prepared = prepare(paragraphIn(family), env, false, [])
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

function cutGaps(family: string): { start: number; end: number }[] {
  const gaps = paragraphGaps(prepare(paragraphIn(family), env, true, []))
  const at: { start: number; end: number }[] = []
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i]!
    if (gap.gap === 'unsafe-to-break' && gap.detail.startsWith('a shaping group of 256 zoomed px or more') && gap.at !== undefined) at.push(gap.at)
  }
  return at
}

describe('blink cuts of a wide group', () => {
  test('the pieces and the adjustment at a cut that kerns add up to the group', () => {
    expect(lineCount('Mono', 380)).toBe(1)
    expect(lineCount('Mono', 378)).toBe(2)
    expect(lineCount('Kern', 376)).toBe(1)
    expect(lineCount('Kern', 374)).toBe(2)
  })

  test('the search asks Canvas nothing: a font that adjusts beside the cut is asked what one that adjusts nothing is', () => {
    asked = 0
    prepare(paragraphIn('Mono'), env, false, [])
    const mono = asked
    asked = 0
    prepare(paragraphIn('Kern'), env, false, [])
    expect(asked).toBe(mono)
  })

  test('an inspected paragraph reports the cut whose wide window shows another adjustment than the one added', () => {
    expect(cutGaps('Mono')).toEqual([])
    expect(cutGaps('Kern')).toEqual([])
    expect(cutGaps('Context')).toEqual([{ start: 19, end: 19 }])
  })
})
