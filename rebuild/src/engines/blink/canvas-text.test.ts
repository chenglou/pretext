import { createContextPool } from '../../measure/canvas.js'
// Canvas spellings compiled at preparation, against explicit character rules and the general builder as a control.
// Bun can compare text, mappings and requested storage modes; the fresh Chrome gate checks actual V8 encoding/answers.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../model.js'
import { prepare } from './index.js'
import { isSegmentEdge } from './emoji.js'
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
    expect(p.segments).toBeNull()
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
    expect(canvasString(p, 2, 5, false, false, 25, false, false)).toEqual({ s: 'ÿ\u00a0B', units: null, twoByte: false })
    expect(canvasString(p, 5, 9, false, false, 25, false, false)).toEqual({ s: '\u0001\u2028C\u0001', units: null, twoByte: true })
    expect(canvasString(p, 5, 9, false, false, 25, true, false)).toEqual({ s: '\u0001 C\u0001', units: null, twoByte: false })
  })

  test('takes a space-free subrange as one-byte even beside the paragraph\'s widened spaces', () => {
    const p = prepare(paragraph('µ ((((((((((((( café'), env, false, createContextPool())
    expect(canvasString(p, 2, 15, false, false, 25, false, false)).toEqual({ s: '(((((((((((((', units: null, twoByte: false })
    expect(canvasString(p, 1, 15, false, false, 25, false, false)).toEqual({ s: '\u2028(((((((((((((', units: null, twoByte: true })
    expect(canvasString(p, 1, 15, false, false, 25, true, false)).toEqual({ s: ' (((((((((((((', units: null, twoByte: false })
  })

  test('retains general-builder mappings for spacing and skips unusable compiled data', () => {
    for (const spacing of [0.125, -0.125, 1e-12, -1e-12]) {
      const p = prepare(paragraph('aµ\u00a0b c', spacing), env, false, createContextPool())
      expect(p.canvasText).toBeNull()
      expect(canvasString(p, 1, 5, false, false, 25)).toEqual({ s: 'µ\u00a0b\u2028', units: [1, 2, 3, 4], twoByte: true })
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
    // SHY is U+2060 whether or not the string holds a space, so a window and its sides are written alike.
    expect(canvasString(shy, 0, 3, false, false, 25, false, false)).toEqual({ s: 'ab\u2060', units: null, twoByte: true })
    expect(canvasString(shy, 0, 6, false, false, 25, false, false)).toEqual({ s: 'ab\u2060\u2028cd', units: null, twoByte: true })
    const segmented = prepare(paragraph('ب((((((((((((('), env, false, createContextPool())
    expect(segmented.segments).not.toBeNull()
    expect(segmented.canvasText).toBeNull()
    expect(canvasString(segmented, 1, 14, false, false, 2, false, false)).toEqual({ s: '(((((((((((((', units: null, twoByte: true })
    const plain = prepare(paragraph('ABC'), env, false, createContextPool())
    expect(canvasString(plain, 0, 3, true, false, 25, false, false)).toEqual({ s: '\u200dABC', units: null, twoByte: true })
    expect(canvasString(plain, 0, 3, false, true, 25, false, false)).toEqual({ s: 'ABC\u200d', units: null, twoByte: true })
  })
})


function styled(input: Paragraph, children: InlineNode[], spacing: number): InlineNode {
  return { ...input, kind: 'span', font: { ...input.font, family: 'Other' }, letterSpacing: spacing, lang: null,
    inlineStart: { margin: 0, border: 0, padding: 3 }, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children }
}
const atomic: InlineNode = { kind: 'atomic', width: 10, height: 10, marginInlineStart: 0, marginInlineEnd: 0 }

test('known Latin source facts need no segment model for empty, styled, Latin-1 and atomic content', () => {
  const fixtures: Paragraph[] = [paragraph(''), paragraph('Aµÿ\u00a0B'), paragraph('ab\u00ad cd')]
  const noChildren = paragraph(''); noChildren.content = []; fixtures.push(noChildren)
  for (const spacing of [-1.5, 0, 1.5]) {
    const empty = paragraph('', spacing); empty.content = [styled(empty, [], spacing)]; fixtures.push(empty)
    const input = paragraph('Aµ ', spacing)
    input.content.push(styled(input, [{ kind: 'text', text: '((ÿ))' }], -spacing)); fixtures.push(input)
    const boxes = paragraph('', spacing); boxes.content = [atomic]; fixtures.push(boxes)
    const mixed = paragraph('Aµ', spacing)
    mixed.content.push(styled(mixed, [atomic, { kind: 'br' }, { kind: 'text', text: 'ÿ B' }], -spacing)); fixtures.push(mixed)
  }
  for (const input of fixtures) for (const inspect of [false, true]) {
    const p = prepare(input, env, inspect, createContextPool())
    expect(p.segments).toBeNull()
    expect(p.bidiEnabled).toBe(false)
    expect(p.groups.every(group => !group.rtl)).toBe(true)
    expect(Object.hasOwn(p, 'segmented')).toBe(false)
    for (let k = 0; k <= p.text.length; k++) expect(isSegmentEdge(p, k)).toBe(false)
    for (let g = 0; g < p.groups.length; g++) {
      const group = p.groups[g]!
      expect(Number.isFinite(measure16({ p, gaps: null }, g, group.start, group.end, group.start, group.end))).toBe(true)
    }
  }
})

test('literal ORC, bidi and surrogate content retain exact source segmentation', () => {
  const fixtures: Paragraph[] = []
  for (const text of ['\uFFFC', '\u200B', '\u202EAV((123))\u202C', 'ב\uDC00ב', 'A\uD800B', 'A😀B']) fixtures.push(paragraph(text))
  const rtl = paragraph('AV ((123))'); rtl.direction = 'rtl'; fixtures.push(rtl)
  const numericRtl = paragraph('123'); numericRtl.direction = 'rtl'; fixtures.push(numericRtl)
  const literalStyled = paragraph(''); literalStyled.content = [styled(literalStyled, [{ kind: 'text', text: '\uFFFC' }], 1.5)]; fixtures.push(literalStyled)
  const split = paragraph('A\uD83D', -1.5)
  split.content.push(styled(split, [{ kind: 'text', text: '\uDE00B' }], 1.5)); fixtures.push(split)
  const wbr = paragraph('ab'); wbr.content.push({ kind: 'wbr' }, atomic); fixtures.push(wbr)
  for (const input of fixtures) for (const inspect of [false, true]) {
    expect(prepare(input, env, inspect, createContextPool()).segments).not.toBeNull()
  }
})
