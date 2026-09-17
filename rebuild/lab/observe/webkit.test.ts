// The WebKit observation port on worked examples of research/observe-webkit.md §5-§8, which quote installed Safari 27.0
// rows. Layouts are written by hand in the engine's geometry, and `measure` answers the in-context advances Safari's
// complex text controller had (the Canvas stand-in the port uses), so these check the ported geometry rules, not Canvas.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS } from '../../src/env.ts'
import { UNKNOWN_FONT_FACTS, type CanvasMeasure, type ExpectedRect, type Paragraph, type WebKitDisplayBox, type WebKitLayout, type WebKitLine } from '../../src/model.ts'
import { observeWebKit } from './webkit.ts'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }

function paragraph(texts: string[], overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: texts.map(text => ({ text, node: 'text' as const, font, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font, letterSpacing: 0, wordSpacing: 0, width: 100, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

function line(boxes: WebKitDisplayBox[], lineBoxWidth = 100): WebKitLine {
  return {
    start: 0, end: 0, fragments: [], hasLineBox: true, joinsNextLine: false,
    geometry: { lineBoxWidth, contentWidth: 0, hangingWidth: 0, contentLogicalRight: 0, boxes }, gaps: [], next: null,
  }
}

function box(run: number, start: number, end: number, x: number, width: number, overrides: Partial<WebKitDisplayBox> = {}): WebKitDisplayBox {
  return { kind: 'text', run, start, end, level: 0, isWordSeparator: false, x, width, hyphen: null, ...overrides }
}

function layoutOf(lines: WebKitLine[]): WebKitLayout {
  return {
    engine: 'webkit', lines, gaps: [], measure: { contexts: [], calls: [], memoHits: 0 },
    env: { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: null, icuDefaultLocale: null, dictionaryBreaks: { kind: 'unavailable' } },
  }
}

// Prefix totals from a table of in-context advances per UTF-16 unit.
function advances(units: number[]): CanvasMeasure {
  return (_settings, text) => {
    let w = 0
    for (let i = 0; i < text.length && i < units.length; i++) w += units[i]!
    return w
  }
}

function plain(rects: ExpectedRect[]): Array<[number, number, number]> {
  return rects.map(r => [r.line, r.x.value, r.width.value])
}

describe('code point rects (research/observe-webkit.md §7-§8)', () => {
  test('c-16d2dea18ab3b7f6: abc­ in 16px Arial, box [0, 25.796875]; c shares its glyph with the soft hyphen', () => {
    const p = paragraph(['abc­'])
    const layout = layoutOf([line([box(0, 0, 4, 0, 25.796875)])])
    const observed = observeWebKit(p, layout, advances([8.8984375, 8.8984375, 4, 4]))
    expect(plain(observed.nodes[0]!)).toEqual([[0, 0, 25.796875]])
    expect(observed.codePoints.map(c => plain(c.rects))).toEqual([
      [[0, 0, 9]],
      [[0, 8, 10]],
      [[0, 17, 5]],
      [[0, 21, 4.796875]],
    ])
    // The first code point's x is a box edge; its width comes from in-context advances.
    expect(observed.codePoints[0]!.rects[0]!.x.state).toBe('predicted')
    expect(observed.codePoints[0]!.rects[0]!.width).toEqual({ state: 'limited', gap: 'in-word-prefix', value: 9 })
    expect(observed.codePoints[2]!.rects[0]!.x.state).toBe('limited')
  })

  test('c-1696ae676dfa6699: a code point alone on its line equals its box rect', () => {
    const p = paragraph(['ab'])
    const layout = layoutOf([line([box(0, 0, 1, 0, 8.8984375)]), line([box(0, 1, 2, 0, 8.8984375)])])
    const observed = observeWebKit(p, layout, advances([8.8984375, 8.8984375]))
    expect(observed.codePoints[0]!.rects).toEqual([{ line: 0, x: { state: 'predicted', value: 0 }, width: { state: 'predicted', value: 8.8984375 } }])
  })

  test('a␠␠␠b: first space partial, second a zero-width rect at the glyph end, third none', () => {
    const p = paragraph(['a   b'])
    const layout = layoutOf([line([box(0, 0, 2, 0, 12.4453125), box(0, 4, 5, 12.4453125, 8.8984375)])])
    const observed = observeWebKit(p, layout, advances([8.8984375, 3.546875, 3.546875, 3.546875, 8.8984375]))
    // x floor(trunc64(8.8984375)) = 8; ceil(8.890625 + ceil64(3.546875)) = 13 > 12.4453125, so trunc64(12.4453125 - 8).
    expect(plain(observed.codePoints[1]!.rects)).toEqual([[0, 8, 4.4375]])
    expect(plain(observed.codePoints[2]!.rects)).toEqual([[0, 12, 0]])
    expect(observed.codePoints[3]!.rects).toEqual([])
    expect(plain(observed.codePoints[4]!.rects)).toEqual([[0, 12.4453125, 8.8984375]])
  })

  test('leading collapsible white space clamps to caretMinOffset: a caret rect at the first box start', () => {
    const p = paragraph(['x', ' foo'])
    const layout = layoutOf([line([box(0, 0, 1, 0, 8), box(1, 1, 4, 10.5, 24)])])
    const observed = observeWebKit(p, layout, advances([8, 8, 8]))
    expect(observed.codePoints[1]!.rects).toEqual([{ line: 0, x: { state: 'predicted', value: 10 }, width: { state: 'predicted', value: 0 } }])
  })

  test('a chosen soft hyphen extends the range over the hyphen string, clamped at trunc64 of the box right', () => {
    const p = paragraph(['ab­cd'])
    const layout = layoutOf([line([box(0, 0, 3, 0, 22.4296875, { hyphen: '‐' })]), line([box(0, 3, 5, 0, 16)])])
    const observed = observeWebKit(p, layout, advances([8, 8, 0, 6.4296875]))
    expect(plain(observed.codePoints[2]!.rects)).toEqual([[0, 16, 6.421875]])
  })

  test('RTL partial rects count from the right: total - after', () => {
    const p = paragraph(['אב'], { direction: 'rtl' })
    const layout = layoutOf([line([box(0, 0, 2, 84, 16, { level: 1 })])])
    const observed = observeWebKit(p, layout, advances([7.5, 8.5]))
    // The logical first letter is on the right: x = 84 + trunc64(total - after) = 84 + 8.5; only the logical last letter's
    // x is a box edge.
    expect(plain(observed.codePoints[0]!.rects)).toEqual([[0, 92, 8]])
    expect(observed.codePoints[0]!.rects[0]!.x.state).toBe('limited')
    expect(plain(observed.codePoints[1]!.rects)).toEqual([[0, 84, 9]])
    expect(observed.codePoints[1]!.rects[0]!.x.state).toBe('predicted')
  })

  test('a text node without boxes reports nothing', () => {
    const p = paragraph([' ', 'a'])
    const observed = observeWebKit(p, layoutOf([line([box(1, 0, 1, 0, 8)])]), advances([8]))
    expect(observed.nodes[0]).toEqual([])
    expect(observed.codePoints[0]!.rects).toEqual([])
  })
})

describe('whole-node rects', () => {
  test('width is f32(f32(x + w) - x) (FloatQuad::boundingBox)', () => {
    const p = paragraph(['ab'])
    const observed = observeWebKit(p, layoutOf([line([box(0, 0, 2, 30.469196319580078, 71.9345703125)])]), advances([8, 8]))
    const width = Math.fround(Math.fround(30.469196319580078 + 71.9345703125) - 30.469196319580078)
    expect(observed.nodes[0]![0]!.width).toEqual({ state: 'predicted', value: width })
  })

  test('a box of negative width reports its right corner and a positive width (c-d5867bf0ebda5742)', () => {
    const p = paragraph(['ab'])
    const observed = observeWebKit(p, layoutOf([line([box(0, 0, 2, 0, -11.808002471923828)])]), advances([8, 8]))
    expect(observed.nodes[0]).toEqual([{ line: 0, x: { state: 'predicted', value: -11.808002471923828 }, width: { state: 'predicted', value: 11.808002471923828 } }])
  })

  test('page zoom that is not 1 limits every value', () => {
    const p = paragraph(['a'])
    const layout = layoutOf([line([box(0, 0, 1, 0, 8)])])
    layout.env.pageZoom = null
    expect(observeWebKit(p, layout, advances([8])).nodes[0]![0]!.x).toEqual({ state: 'limited', gap: 'page-zoom', value: 0 })
  })
})
