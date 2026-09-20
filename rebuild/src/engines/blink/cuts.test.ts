// The cut of a shaping group of 256 zoomed px or more (shape.ts addPieces, measureGroups; gaps.ts unsafeCut) on a stand-in
// Canvas where every code point is 10px wide at 16px. TEXT is 38 units and 380px, so it is cut once; its middle, offset
// 19, is after a space and before `V`. Family `Kern` kerns a space with `V` by -4px; family `Context` takes 2px more off
// where `x` stands before that space, which a window of one cluster on each side doesn't show; family `Every` kerns every
// two code points by -1px; family `Mono` adjusts nothing. IN_WORD has its middle inside a word, BEFORE_SPACE before a
// space. Measured strings carry U+2028 for U+0020 (shape.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, paragraphGaps, prepare } from './index.js'

const TEXT = 'xxxx xxxx xxxx xxx Vxxx xxxx xxxx xxxx'
const IN_WORD = 'xxxxxxx xxxxxxx xxxxxxx xxxxxxx xxxxxx'
const BEFORE_SPACE = 'xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx'
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
    const kern = this.font.includes('Mono') ? 0 : this.font.includes('Every') ? Math.max(0, text.length - 1)
      : 4 * count(text, `${LS}V`) + (this.font.includes('Context') ? 2 * count(text, `x${LS}V`) : 0)
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

function paragraphIn(family: string, text: string = TEXT): Paragraph {
  return {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
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
  test('the pieces add up to the group: the cut moves off an offset where the two sides change each other', () => {
    expect(lineCount('Mono', 380)).toBe(1)
    expect(lineCount('Mono', 378)).toBe(2)
    expect(lineCount('Kern', 376)).toBe(1)
    expect(lineCount('Kern', 374)).toBe(2)
    expect(lineCount('Context', 374)).toBe(1)
    expect(lineCount('Context', 372)).toBe(2)
  })

  test('the search asks about no offset inside a word while an offset beside a space passes', () => {
    asked = []
    prepare(paragraphIn('Mono', IN_WORD), env, false, [])
    expect(asked.includes('xx')).toBe(false)
    asked = []
    prepare(paragraphIn('Every', IN_WORD), env, false, [])
    expect(asked.includes('xx')).toBe(true)
  })

  test('a cut that passed asks nothing after its pieces: the adjustment a position takes there is the 0 the search measured', () => {
    // After a space the pair window's; before one the wide window's, which between two pieces is the search's own window.
    asked = []
    prepare(paragraphIn('Mono'), env, false, [])
    expect(asked[asked.length - 1]).toBe(TEXT.slice(19).replaceAll(' ', LS))
    asked = []
    prepare(paragraphIn('Mono', BEFORE_SPACE), env, false, [])
    expect(asked[asked.length - 1]).toBe(BEFORE_SPACE.slice(19).replaceAll(' ', LS))
    asked = []
    prepare(paragraphIn('Every'), env, false, [])
    expect(asked[asked.length - 1]).not.toBe(TEXT.slice(19).replaceAll(' ', LS))
  })

  test('an inspected paragraph reports the cut of a group where no offset passes', () => {
    expect(cutGaps('Mono')).toEqual([])
    expect(cutGaps('Kern')).toEqual([])
    expect(cutGaps('Context')).toEqual([])
    expect(cutGaps('Every')).toEqual([{ start: 19, end: 19 }])
  })
})
