// A cut before white space beside a side that was cut again (shape.ts addPieces, measureGroups) on a stand-in Canvas where
// `W` is 20px wide at 16px and every other code point 10px. The search takes the adjustment across an offset in the widest
// exact window inside the range it cuts; the adjustment a position takes at a cut before white space is taken in the
// widest exact window between the cuts around it (adjust16). The two are one window only where both sides of the cut are
// one piece, and only there does the 0 the search measured stand for the adjustment. Each text below has a cut before a
// space whose window between the cuts holds a `Q` that the search's window doesn't, and its family takes 2px off the `x`
// before that space in a string that holds `far`, the text from the `Q` to the space or from the `x` to the `Q`. So the
// search measures 0 at the cut and the adjustment there is -2px:
// - BOTH, 790px: cut at 39, its sides at 19 and 59; the search's window is [30, 49), the cuts' [29, 49);
// - LEFT, 450px: cut at 28, its left side at 12; [14, 36) and [12, 36);
// - RIGHT, 480px: cut at 20, its right side at 31; [10, 30) and [10, 31).
// A port that kept the search's 0 at such a cut would give each text 2px too many.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { fillLine, firstLine, prepare } from './index.js'
import { adjust16 } from './shape.js'

const LS = String.fromCodePoint(0x2028)

type Sample = { family: string; text: string; far: string; width: number; pieces: readonly number[]; window: readonly [number, number] }

const BOTH: Sample = {
  family: 'Both', text: 'xxxx xxxx xxxx xxxx xxxx xxxxQxxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx', far: `Qxxxx${LS}xxxx${LS}`, width: 790,
  pieces: [0, 19, 39, 59, 79], window: [29, 49],
}
const LEFT: Sample = {
  family: 'Left', text: 'xxxx x xxxx xQxxxxxxxxxxxxxx xxxx xxx xxxxxxx', far: `Qxxxxxxxxxxxxxx${LS}`, width: 450, pieces: [0, 12, 28, 45], window: [12, 36],
}
const RIGHT: Sample = {
  family: 'Right', text: 'WxxxxWxxxx x xx xxxx xxxxWWxxxQ W xWxWWx', far: `x${LS}xxxxWWxxxQ`, width: 480, pieces: [0, 20, 31, 40], window: [10, 31],
}
const SAMPLES: readonly Sample[] = [BOTH, LEFT, RIGHT]

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
    let width = 0
    for (let i = 0; i < text.length; i++) width += text[i] === 'W' ? 20 : 10
    for (let i = 0; i < SAMPLES.length; i++) if (this.font.includes(SAMPLES[i]!.family) && text.includes(SAMPLES[i]!.far)) width -= 2
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

function paragraphIn(family: string, text: string): Paragraph {
  return {
    font: { family, size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr',
    lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function lineCount(family: string, text: string, width: number): number {
  const prepared = prepare(paragraphIn(family, text), env, false, createContextPool())
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

describe('blink cuts of a wide group: a cut before white space beside a side cut again', () => {
  test('the pieces are the ones named, and the window between the cuts around the cut is asked after them', () => {
    for (let s = 0; s < SAMPLES.length; s++) {
      const sample = SAMPLES[s]!
      asked = []
      prepare(paragraphIn('Mono', sample.text), env, false, createContextPool())
      // Every piece is asked first while the text is cut; the window's sides can be pieces asked again.
      let lastPiece = -1
      for (let i = 1; i < sample.pieces.length; i++) {
        const at = asked.indexOf(sample.text.slice(sample.pieces[i - 1]!, sample.pieces[i]!).replaceAll(' ', LS))
        expect(at).toBeGreaterThan(-1)
        lastPiece = Math.max(lastPiece, at)
      }
      expect(asked.lastIndexOf(sample.text.slice(sample.window[0], sample.window[1]).replaceAll(' ', LS))).toBeGreaterThan(lastPiece)
    }
  })

  test('the adjustment at the cut is the one its own window shows, not the 0 of the search', () => {
    for (let s = 0; s < SAMPLES.length; s++) {
      const sample = SAMPLES[s]!
      expect(lineCount('Mono', sample.text, sample.width)).toBe(1)
      expect(lineCount('Mono', sample.text, sample.width - 2)).toBe(2)
      expect(lineCount(sample.family, sample.text, sample.width - 2)).toBe(1)
      expect(lineCount(sample.family, sample.text, sample.width - 4)).toBe(2)
    }
  })
})

// Direct adjustment reads at cuts use both adjacent pieces; reads inside a piece use that piece alone.
// Ask in both directions so a previous query cannot make the lookup depend on traversal order.
test('adjustment windows at, between and around many shaping cuts', () => {
  const text = 'abcdefghijklmnop'.repeat(32)
  const prepared = prepare(paragraphIn('Mono', text), env, false, createContextPool())
  expect(prepared.groups[0]!.cuts).toEqual(Array.from({ length: 33 }, (_, i) => i * 16))
  const samples: readonly [number, number, number][] = [
    [1, 0, 16], [16, 0, 32], [17, 16, 32], [31, 16, 32], [32, 16, 48], [33, 32, 48], [511, 496, 512],
  ]
  for (const order of [samples, [...samples].reverse()]) {
    for (const [offset, from, to] of order) {
      prepared.groups[0]!.wide16.fill(NaN)
      asked = []
      expect(adjust16({ p: prepared, gaps: null }, 0, offset, 0, text.length)).toBe(0)
      expect(asked[0]).toBe(text.slice(from, to))
    }
  }
  asked = []
  expect(adjust16({ p: prepared, gaps: null }, 0, 0, 0, text.length)).toBe(0)
  expect(adjust16({ p: prepared, gaps: null }, 0, text.length, 0, text.length)).toBe(0)
  expect(asked).toEqual([])
})
