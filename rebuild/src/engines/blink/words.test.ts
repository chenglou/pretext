// Word pieces and the candidate found from words (shape.ts wordCuts, measureGroups; line-breaker.ts wordCandidate) on a
// stand-in Canvas where every code point is 10px wide at 16px and a space kerns with a following `V` by -4px. Measured
// strings carry U+2028 for U+0020 (shape.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'
import { wordsCheck } from './shape.js'

const LS = String.fromCodePoint(0x2028)
const TEXT = 'alpha beta Vee gamma - delta co-op epsilon Vau zeta eta theta iota kappa'

let asked = 0

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
    const spaces = text.split(LS).length - 1 + (text.split(' ').length - 1)
    const kern = 4 * (text.split(`${LS}V`).length - 1)
    return { width: text.length * 10 - kern + spaces * parseFloat(this.wordSpacing), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

afterAll(() => {
  wordsCheck.on = false
  wordsCheck.log = null
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraphOf(text: string, letterSpacing: number = 0, wordSpacing: number = 0): Paragraph {
  return {
    font: { family: 'x', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing, wordSpacing, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function lineEnds(paragraph: Paragraph, inspect: boolean, widths: readonly number[]): number[][] {
  const prepared = prepare(paragraph, env, inspect, [])
  const out: number[][] = []
  for (let w = 0; w < widths.length; w++) {
    const ends: number[] = []
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width: widths[w]!, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
      ends.push(filled.end)
      start = filled.next
    }
    out.push(ends)
  }
  return out
}

const WIDTHS: number[] = []
for (let width = 30; width <= 760; width += 7) WIDTHS.push(width)

describe('blink word pieces', () => {
  test('a group is cut after every space whose two words hold a script', () => {
    expect(prepare(paragraphOf('ab cd - ef gh'), env, false, []).groups[0]!.cuts).toEqual([0, 3, 11, 13])
  })

  test('letter spacing keeps the group in one piece', () => {
    expect(prepare(paragraphOf('ab cd ef', 1), env, false, []).groups[0]!.cuts).toEqual([0, 8])
  })

  test('a checked run: every candidate found from words is the search\'s, and the plain lines are the inspected ones', () => {
    wordsCheck.on = true
    wordsCheck.log = []
    wordsCheck.lines.clear()
    expect(lineEnds(paragraphOf(TEXT), false, WIDTHS)).toEqual(lineEnds(paragraphOf(TEXT), true, WIDTHS))
    let fromWords = 0
    for (const [key, lines] of wordsCheck.lines) if (key.endsWith('|words')) fromWords += lines
    expect(fromWords).toBeGreaterThan(100)
  })

  test('negative word spacing leaves every candidate to the search', () => {
    wordsCheck.lines.clear()
    expect(lineEnds(paragraphOf(TEXT, 0, -12), false, WIDTHS)).toEqual(lineEnds(paragraphOf(TEXT, 0, -12), true, WIDTHS))
    for (const key of wordsCheck.lines.keys()) expect(key.endsWith('|words')).toBe(false)
  })

  test('a kept plain paragraph asks Canvas nothing at a width it has met', () => {
    wordsCheck.on = false
    const prepared = prepare(paragraphOf('alpha beta gamma delta epsilon zeta eta theta iota kappa'), env, false, [])
    const fill = (): void => {
      for (let start = firstLine(prepared); start !== null;) start = fillLine(prepared, start, { width: 170, left: 0, right: 0 }).next
    }
    fill()
    asked = 0
    fill()
    expect(asked).toBe(0)
  })
})
