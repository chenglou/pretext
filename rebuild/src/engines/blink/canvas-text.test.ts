import { createContextPool } from '../../measure/canvas.js'
// Canvas spellings compiled at preparation, against explicit character rules and the general builder as a control.
// Bun can compare text, mappings and requested storage modes; the fresh Chrome gate checks actual V8 encoding/answers.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { prepare } from './index.js'
import { canvasString, measure16 } from './shape.js'

class Context {
  font = '16px Mono'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    let n = 0
    for (const c of text) if (c !== '\u200d' && c !== '\u200b' && c !== '\u2060') n++
    return { width: n * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}

const globals = globalThis as { OffscreenCanvas?: unknown }
let oldCanvas: unknown
beforeAll(() => {
  oldCanvas = globals.OffscreenCanvas
  globals.OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
afterAll(() => { globals.OffscreenCanvas = oldCanvas })

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(text: string, letterSpacing = 0): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } },
    letterSpacing, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start',
  }
}

describe('blink compiled Canvas text', () => {
  test('keeps offsets and Latin-1/NBSP while normalizing VT/FF and optionally spaces', () => {
    const p = prepare(paragraph('Aµÿ\u00a0B\v C\fD'), env, false, createContextPool())
    expect(p.text).toBe('Aµÿ\u00a0B\v C\fD')
    expect(p.canvasText).toEqual({ narrow: 'Aµÿ\u00a0B\u0001 C\u0001D', spaced: 'Aµÿ\u00a0B\u0001\u2028C\u0001D' })
    // The DOM doesn't segment an eight-bit paragraph by Unicode script: even U+00B5 is shaped in the Latin segment.
    expect([...p.scripts]).toEqual(new Array(p.text.length).fill(25))
    for (let from = 0; from <= p.text.length; from++) {
      for (let to = from; to <= p.text.length; to++) {
        for (const keepSpaces of [false, true]) {
          const control = canvasString(p, from, to, false, false, 25, keepSpaces)
          const compiled = canvasString(p, from, to, false, false, 25, keepSpaces, false)
          expect(compiled).toEqual({ ...control, units: null })
          expect(control.units).toEqual(Array.from({ length: to - from }, (_, i) => from + i))
        }
      }
    }
    expect(canvasString(p, 2, 5, false, false, 25, false, false)).toEqual({ s: 'ÿ\u00a0B', units: null, twoByte: false, leftOut: false })
    expect(canvasString(p, 5, 9, false, false, 25, false, false)).toEqual({ s: '\u0001\u2028C\u0001', units: null, twoByte: true, leftOut: false })
    expect(canvasString(p, 5, 9, false, false, 25, true, false)).toEqual({ s: '\u0001 C\u0001', units: null, twoByte: false, leftOut: false })
  })

  test('takes a space-free subrange as one-byte even beside the paragraph\'s widened spaces', () => {
    const p = prepare(paragraph('µ ((((((((((((( café'), env, false, createContextPool())
    expect(canvasString(p, 2, 15, false, false, 25, false, false)).toEqual({ s: '(((((((((((((', units: null, twoByte: false, leftOut: false })
    expect(canvasString(p, 1, 15, false, false, 25, false, false)).toEqual({ s: '\u2028(((((((((((((', units: null, twoByte: true, leftOut: false })
    expect(canvasString(p, 1, 15, false, false, 25, true, false)).toEqual({ s: ' (((((((((((((', units: null, twoByte: false, leftOut: false })
  })

  test('retains general-builder mappings for spacing and skips unusable compiled data', () => {
    for (const spacing of [0.125, -0.125, 1e-12, -1e-12]) {
      const p = prepare(paragraph('aµ\u00a0b c', spacing), env, false, createContextPool())
      expect(p.canvasText).toBeNull()
      expect(canvasString(p, 1, 5, false, false, 25)).toEqual({ s: 'µ\u00a0b\u2028', units: [1, 2, 3, 4], twoByte: true, leftOut: false })
      // Tiny spacing can truncate to zero and omit its map; nonzero effective spacing must still consume one safely.
      expect(Number.isFinite(measure16({ p, gaps: null }, 0, 0, p.text.length, 0, p.text.length))).toBe(true)
    }
    const input = paragraph('aµ b', 0.125)
    input.content = [{ ...input, kind: 'span', letterSpacing: 0, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
      verticalAlign: 'baseline', children: [{ kind: 'text', text: 'aµ b' }] }]
    expect(prepare(input, env, false, createContextPool()).canvasText).not.toBeNull()
    expect(prepare(paragraph('aµ b'), env, true, createContextPool()).canvasText).toBeNull()
  })

  test('leaves SHY, segmented scripts and artificial ZWJ context on the general builder', () => {
    const shy = prepare(paragraph('ab\u00ad cd'), env, false, createContextPool())
    expect(shy.canvasText).toBeNull()
    expect(canvasString(shy, 0, 3, false, false, 25, false, false)).toEqual({ s: 'ab', units: null, twoByte: false, leftOut: true })
    expect(canvasString(shy, 0, 6, false, false, 25, false, false)).toEqual({ s: 'ab\u2060\u2028cd', units: null, twoByte: true, leftOut: false })
    const segmented = prepare(paragraph('ب((((((((((((('), env, false, createContextPool())
    expect(segmented.segmented).toBe(true)
    expect(segmented.canvasText).toBeNull()
    expect(canvasString(segmented, 1, 14, false, false, 2, false, false)).toEqual({ s: '(((((((((((((', units: null, twoByte: true, leftOut: false })
    const plain = prepare(paragraph('ABC'), env, false, createContextPool())
    expect(canvasString(plain, 0, 3, true, false, 25, false, false)).toEqual({ s: '\u200dABC', units: null, twoByte: true, leftOut: false })
    expect(canvasString(plain, 0, 3, false, true, 25, false, false)).toEqual({ s: 'ABC\u200d', units: null, twoByte: true, leftOut: false })
  })
})
