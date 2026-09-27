import { createContextPool } from '../../measure/canvas.js'
// HanKerning at the paragraph's script edges (shape.ts hanKerningAtScriptEdges), with a stand-in Canvas that halts as
// Blink's HanKerning does inside the one string it shapes (bun has no OffscreenCanvas; the lab measures in Chrome): CJK
// characters 16px and the rest 8px at 16px, a close mark before a close or a narrow close mark halved, and an open mark
// after an open, a close or a narrow open mark halved (han_kerning.h:162-172). Its ink boxes put the dots and the colons
// at the start of their advance, which makes them close marks (han_kerning.cc:37-63).
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { everyLine, type Sized } from '../../test-lines.js'
import { fillLine, firstLine, inspectLine, linePieces, paragraphGaps, prepare } from './index.js'

const CLOSE = new Set([...'」）。、，．：；'])
const CLOSE_NARROW = new Set([...')]}'])
const OPEN = new Set([...'「（'])
const OPEN_NARROW = new Set([...'([{'])

function advance(c: string): number {
  return c.charCodeAt(0) >= 0x3000 ? 16 : 8
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
    const chars = [...text].filter(c => c !== '⁠' && c !== '‭' && c !== '‬')
    let width = 0
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!
      const before = chars[i - 1]
      const after = chars[i + 1]
      let w = advance(c)
      if (CLOSE.has(c) && after !== undefined && (CLOSE.has(after) || CLOSE_NARROW.has(after))) w /= 2
      else if (OPEN.has(c) && before !== undefined && (OPEN.has(before) || CLOSE.has(before) || OPEN_NARROW.has(before))) w /= 2
      width += w
    }
    const ink = chars.length === 1 && CLOSE.has(chars[0]!) ? [-1, 6] : [0, width]
    return { width, actualBoundingBoxLeft: ink[0]!, actualBoundingBoxRight: ink[1]! }
  }
}

beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'zh-CN', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraph(text: string, width: number): Sized {
  return {
    font: { family: 'Mock', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], width, lineHeight: 20, direction: 'ltr', lang: 'zh-CN', textIndent: 0, textAlign: 'start',
  } satisfies Paragraph & Sized
}

function lines(text: string, width: number): { widths: number[]; gaps: string[] } {
  const p = paragraph(text, width)
  const prepared = prepare(p, env, true, createContextPool())
  const layout = everyLine({
    first: firstLine(prepared), fill: (start, slot) => fillLine(prepared, start, slot), inspect: line => inspectLine(prepared, line), pieces: line => linePieces(prepared, line),
  }, p.width, [])
  return { widths: layout.lines.map(l => l.geometry.width / 64), gaps: paragraphGaps(prepared).map(g => g.gap) }
}

describe('HanKerning at script edges', () => {
  test('a stop before a `}` that pairs with a `{` after Latin is halted: the `}` is Latin, so the edge reads it', () => {
    // a { 你 好 。 } 你 好: 8 + 8 + 16 + 16 + 8 + 8 + 16 + 16. Measured by segments alone, the stop was 16.
    expect(lines('a{你好。}你好', 200).widths).toEqual([96])
    expect(lines('a{你好。}你好', 96).widths).toEqual([96])
    expect(lines('a{你好。}你好', 200).gaps).toContain('han-kerning')
    // After Han the brackets are Han and Canvas halts the stop inside the one string.
    expect(lines('中{你好。}你好', 200).widths).toEqual([104])
  })

  test('a close mark before a `)` that pairs with a `(` after Latin, and an open mark after such a `(`', () => {
    // a ( 你 好 」 ) b: the corner bracket before the Latin `)` is halted.
    expect(lines('a(你好」)b', 200).widths).toEqual([72])
    // a ( 「 你 」 ) b: the corner bracket after the Latin `(` is halted too (the start context).
    expect(lines('a(「你」)b', 200).widths).toEqual([64])
  })
})
