// The second check of the candidate found from words (line-breaker.ts wordCandidate): a case the study's own checked runs
// never met, pinned as it behaves today. When the behaviour is fixed these expectations turn, and the test says so.
//
// A cut after a space whose first character is default-ignorable (here U+2060 WORD JOINER, which wordCuts doesn't leave
// out; the same happens at one of the port's own cuts of a wide group before SHY or LRM). HarfBuzz's lookups skip the
// ignorable, so the pair window at the cut reaches over it to the letter after it (shape.ts pairAdjust16), and so does the
// pair window at the offset after the ignorable. measureGroups puts the adjustment into the position at the cut, and
// groupPrefix16 adds it again one offset later: the position after the ignorable lies before the cut's. The search over
// every offset can land there, past the cut, while the words' edges put the candidate at the space before the cut. The
// cuts' own positions are sorted, which is all wordCandidateOf asks of them.
//
// The stand-in Canvas is words.test.ts's: every code point 10px wide at 16px, U+2060 none, and a space kerns with a
// following `V` by -4px, across U+2060 too.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, prepare } from './index.js'
import { wordsCheck } from './shape.js'

const LS = String.fromCodePoint(0x2028)
const WJ = String.fromCodePoint(0x2060)
const TEXT = `a beta ${WJ}Vee ggggg delta`

class Context {
  font = '16px x'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    const shown = text.split(WJ).join('')
    const kern = 4 * (shown.split(`${LS}V`).length - 1)
    return { width: shown.length * 10 - kern, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

afterAll(() => {
  wordsCheck.on = false
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

const paragraph: Paragraph = {
  font: { family: 'x', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
  wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text: TEXT }], lineHeight: 20, direction: 'ltr',
  lang: 'en', textIndent: 0, textAlign: 'start',
}

function lineEnds(inspect: boolean, width: number): number[] {
  const prepared = prepare(paragraph, env, inspect, [])
  const ends: number[] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    ends.push(filled.end)
    start = filled.next
  }
  return ends
}

describe('blink word pieces, second check', () => {
  test('the group is cut before the word joiner, and the cut\'s position lies past the next offset\'s', () => {
    const group = prepare(paragraph, env, false, []).groups[0]!
    expect(group.cuts).toEqual([0, 2, 7, 12, 18, 23])
    // `a ` and `beta ` are 70px, less the 4px the space gives up before `V`.
    expect(group.positionAtCut[2]! / 65536).toBe(66)
    expect(group.cutsSorted).toBe(true)
  })

  test('between the two positions the checked run throws: the search lands past the cut, the words stop before it', () => {
    // 62px is the position the port gives the `V` at 8, 66px the cut's at 7. Whether the binary search meets offset 8
    // before offset 7 depends on the item's length, so other texts of the same shape don't throw.
    wordsCheck.on = true
    expect(() => lineEnds(false, 63)).toThrow(/words check: the search finds offset 8 and the words give 6/)
    wordsCheck.on = false
  })

  test('the lines are the inspected paragraph\'s all the same at that width', () => {
    wordsCheck.on = false
    expect(lineEnds(false, 63)).toEqual(lineEnds(true, 63))
  })
})
