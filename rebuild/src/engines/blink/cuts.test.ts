import { createContextPool } from '../../measure/canvas.js'
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
    if (this.font.includes('ExactPieces')) {
      const d = this.font.includes('One') ? 1 : 7
      const width = (text.length * (2 ** 20 - d) + Math.max(0, text.length - 1) * d + (text.includes('Y') ? d : 0)) / 65536
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
    }
    const kern = this.font.includes('Mono') ? 0 : this.font.includes('LongContext') ? 6 * count(text, `x${LS}V`) : this.font.includes('Every') ? Math.max(0, text.length - 1)
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
  const prepared = prepare(paragraphIn(family), env, false, createContextPool())
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
  const gaps = paragraphGaps(prepare(paragraphIn(family), env, true, createContextPool()))
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
    prepare(paragraphIn('Mono', IN_WORD), env, false, createContextPool())
    expect(asked.includes('xx')).toBe(false)
    asked = []
    prepare(paragraphIn('Every', IN_WORD), env, false, createContextPool())
    expect(asked.includes('xx')).toBe(true)
  })

  test('a cut that passed asks nothing after its pieces: the adjustment a position takes there is the 0 the search measured', () => {
    // After a space the pair window's; before one the wide window's, which between two pieces is the search's own window.
    asked = []
    prepare(paragraphIn('Mono'), env, false, createContextPool())
    expect(asked[asked.length - 1]).toBe(TEXT.slice(19).replaceAll(' ', LS))
    asked = []
    prepare(paragraphIn('Mono', BEFORE_SPACE), env, false, createContextPool())
    expect(asked[asked.length - 1]).toBe(BEFORE_SPACE.slice(19).replaceAll(' ', LS))
    asked = []
    const unsafe = prepare(paragraphIn('Every'), env, false, createContextPool())
    expect(unsafe.groups[0]!.prefixAtCut).toEqual([0, 171 * 65536, 343 * 65536])
  })

  test('an inspected paragraph reports the cut of a group where no offset passes', () => {
    expect(cutGaps('Mono')).toEqual([])
    expect(cutGaps('Kern')).toEqual([])
    expect(cutGaps('Context')).toEqual([])
    expect(cutGaps('Every')).toEqual([{ start: 19, end: 19 }])
  })
})

test('an unsafe pair rules out the candidate without shaping wide windows', () => {
  const text = 'x'.repeat(1024)
  asked = []
  const prepared = prepare(paragraphIn('Every', text), env, false, createContextPool())
  expect(prepared.groups[0]!.cuts).toEqual(Array.from({ length: 65 }, (_, i) => i * 16))
  expect(asked.length).toBeLessThan(4000)
  expect(asked.reduce((n, text) => n + text.length, 0)).toBeLessThan(20000)
  const inspected = prepare(paragraphIn('Every', text), env, true, createContextPool())
  const unsafe = paragraphGaps(inspected).filter(g => g.gap === 'unsafe-to-break' && g.detail.startsWith('a shaping group'))
  expect(unsafe.length).toBe(63)
  expect(unsafe.map(g => g.at!.start).sort((a,b) => a-b)).toEqual(Array.from({ length: 63 }, (_, i) => (i+1) * 16))
})

test('a safe pair still reads the wider context and recovers at another safe edge', () => {
  asked = []
  const prepared = prepare(paragraphIn('LongContext'), env, false, createContextPool())
  const wide = asked.filter(s => s.includes(`x${LS}V`) && s.length > 2)
  expect(prepared.groups[0]!.cuts).toEqual([0, 15, 38])
  expect(asked).toContain(`${LS}V`)
  expect(wide.length).toBeGreaterThan(0)
  expect(prepared.groups[0]!.cuts).not.toContain(19)
  expect(prepared.groups[0]!.cuts).not.toContain(18)
  expect(prepared.groups[0]!.cuts.length).toBe(3)
  expect(cutGaps('LongContext')).toEqual([])
})


test('corrected pieces carry their advance in logical order at a fractional-scale ceiling', () => {
  // Every adjacent pair kerns by d/65536 px; the last glyph adds d/65536 back. The total before scale is therefore
  // exactly 16384 * 16px. At this optical-size/DPR combination, the effective float32 scale is 2.371054172515869.
  // Mutating every later prefix used to drift above the exact 1024-unit boundary for both d=1 and d=7, adding a LayoutUnit.
  for (const family of ['ExactPiecesOne', 'ExactPiecesSeven']) {
    const input = paragraphIn(family, 'x'.repeat(16383) + 'Y')
    input.font = { ...input.font, size: 16.8, facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: true } }
    const prepared = prepare(input, { ...env, devicePixelRatio: 2.37 }, false, createContextPool())
    const group = prepared.groups[0]!
    expect(group.cuts.length).toBe(4097)
    expect(group.prefixAtCut[group.prefixAtCut.length - 1]).toBe(40734400512)
    expect(Math.ceil(group.prefixAtCut[group.prefixAtCut.length - 1]! / 1024)).toBe(39779688)
  }
})
