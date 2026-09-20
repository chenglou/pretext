// A group cut into words first (shape.ts addWordPieces) and a line's candidate found from the cuts' positions
// (line-breaker.ts wordCandidate), on a stand-in Canvas where every code point is 10px wide at 16px. Family `Mono` adjusts
// nothing. `Kern` kerns a space with `V` by -4px, which the pair window shows. `Context` takes 2px off where `x` stands
// before a space and `V`, which a window of one cluster on each side doesn't show and the two words together do. `Neutral`
// adds 3px to a string that holds no letter, as a string without a script of its own takes another script alone than in
// its run. Measured strings carry U+2028 for U+0020 (shape.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'
import { LineBreaker } from './line-breaker.js'
import { adjust16, wordsCheck } from './shape.js'
import type { BlinkPrepared } from './types.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const LS = String.fromCodePoint(0x2028)
const SHY = String.fromCodePoint(0xad)

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
    let width = text.length * 10
    if (this.font.includes('Kern') || this.font.includes('Context')) width -= 4 * count(text, `${LS}V`)
    if (this.font.includes('Context')) width -= 2 * count(text, `x${LS}V`)
    if (this.font.includes('Neutral') && !/[a-zA-Z]/.test(text) && /\S/.test(text)) width += 3
    return { width: width * size / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function prepared(family: string, text: string = TEXT): BlinkPrepared {
  const paragraph: Paragraph = {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
  return prepare(paragraph, env, false, [])
}

function lineEnds(p: BlinkPrepared, width: number): number[] {
  const ends: number[] = []
  let start = firstLine(p)
  while (start !== null) {
    const filled = fillLine(p, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    ends.push(filled.end)
    start = filled.next
  }
  return ends
}

describe('blink word pieces', () => {
  test('a group is cut after every space that passes, and its positions are sums of words', () => {
    const group = prepared('Mono').groups[0]!
    expect(group.cuts).toEqual([0, 5, 10, 15, 19, 24, 29, 34, 38])
    expect(group.prefixAtCut.map(value => value / 65536)).toEqual([0, 50, 100, 150, 190, 240, 290, 340, 380])
  })

  test('a space whose pair window shows an adjustment is no cut, and neither is one whose two words measure otherwise together', () => {
    const kern = prepared('Kern').groups[0]!
    expect(kern.cuts).toEqual([0, 5, 10, 15, 24, 29, 34, 38])
    expect(kern.prefixAtCut[kern.prefixAtCut.length - 1]! / 65536).toBe(376)
    const context = prepared('Context').groups[0]!
    expect(context.cuts).toEqual([0, 5, 10, 15, 24, 29, 34, 38])
    expect(context.prefixAtCut[context.prefixAtCut.length - 1]! / 65536).toBe(374)
  })

  test('a group of an unsegmented paragraph that holds SHY has no words', () => {
    expect(prepared('Mono', `xxxx xx${SHY}xx xxxx`).groups[0]!.cuts).toEqual([0, 15])
  })

  test('in a segmented paragraph a window side that holds no script of its own takes the next piece in', () => {
    const text = `xxxx, xxxx xxx${String.fromCodePoint(0x3c9)}`
    const p = prepared('Neutral', text)
    expect(p.groups[0]!.cuts).toEqual([0, 6, 11, 15])
    asked = []
    expect(adjust16({ p, gaps: null }, 0, 4, 0, text.length)).toBe(0)
    expect(asked).toContain(`,${LS}xxxx${LS}`)
    expect(asked).not.toContain(`,${LS}`)
  })
})

describe('blink candidate from the cuts', () => {
  test('lines that end between two words are the search\'s lines, in a checked run', () => {
    const fromCuts = LineBreaker.prototype.wordCandidate
    const families = ['Mono', 'Kern', 'Context']
    for (let f = 0; f < families.length; f++) {
      for (let width = 30; width <= 390; width += 7) {
        wordsCheck.on = true
        const withCuts = lineEnds(prepared(families[f]!), width)
        wordsCheck.on = false
        LineBreaker.prototype.wordCandidate = () => -1
        const searched = lineEnds(prepared(families[f]!), width)
        LineBreaker.prototype.wordCandidate = fromCuts
        expect(withCuts).toEqual(searched)
      }
    }
  })

  test('a line between two words asks where the two words around its end end, and a kept paragraph asks nothing at a width it has met', () => {
    const p = prepared('Mono')
    asked = []
    expect(lineEnds(p, 200)).toEqual([19, 38])
    // The position where each of the two words around the break ends (the word with its space, the word, the space, and the
    // word as the prefix), and nothing for the safe test at the second line's start: its window showed 0 when the cut was made.
    expect(asked).toEqual([`Vxxx${LS}`, 'Vxxx', LS, 'Vxxx', `xxx${LS}`, 'xxx', LS, 'xxx'])
    asked = []
    lineEnds(p, 200)
    expect(asked).toEqual([])
  })
})
