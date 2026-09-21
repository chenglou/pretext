import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { fillLine, firstLine, linePieces, prepare } from './index.js'
import { pairAdjust16 } from './shape.js'

const WJ = '\u2060'
let asked: string[] = []
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked.push(text)
    return { width: text.replaceAll(WJ, '').length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(text: string): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'anywhere', tabSize: 8,
    content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

test('a pair crosses the entire independent no-base run to the glyph on both sides', () => {
  const text = 'a' + WJ.repeat(2048) + 'b'
  const p = prepare(paragraph(text), env, false, createContextPool())
  const group = p.groups[0]!
  for (const k of [1, 1025, 2049]) {
    asked = []
    expect(pairAdjust16({ p, gaps: null }, 0, k, group.start, group.end)).toBe(0)
    expect(asked).toEqual([text, text.slice(0, k), text.slice(k)])
  }
})

test('a tiny-width fill carries the zero-advance run without adding lines or losing its source text', () => {
  const text = 'a' + WJ.repeat(2048) + 'b'
  const p = prepare(paragraph(text), env, false, createContextPool())
  let start = firstLine(p), lines = 0, painted = ''
  while (start !== null) {
    const filled = fillLine(p, start, { width: 8, left: 0, right: 0 })
    if (filled.kind !== 'line') throw Error('a slot without insets gives a line')
    const pieces = linePieces(p, filled.line)
    for (const fragment of pieces.fragments) if (fragment.kind === 'text') painted += fragment.painted
    lines++
    start = filled.next
  }
  expect(lines).toBe(2)
  expect(painted).toBe(text)
})

test('local UTF16 cuts and surrogate-split call bounds keep the original pair windows', () => {
  const marks = String.fromCodePoint(0x1d167).repeat(64)
  const text = 'a' + marks + WJ.repeat(64) + 'b'
  const p = prepare(paragraph(text), env, false, createContextPool())
  // Offset 2 starts at the low surrogate of the first mark. It cannot itself certify a no-base span.
  const samples: readonly [number, number, number, number, number][] = [
    [2, 0, text.length, 0, 129], [165, 2, text.length, 2, text.length], [1, 0, 2, 0, 2],
  ]
  for (const [k, lo, hi, from, to] of samples) {
    asked = []
    expect(pairAdjust16({ p, gaps: null }, 0, k, lo, hi)).toBe(0)
    expect(asked).toEqual([text.slice(from, to), text.slice(from, k), text.slice(k, to)])
  }
})
