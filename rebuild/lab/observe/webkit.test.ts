// The WebKit observation port on worked examples of research/observe-webkit.md §5-§8, which quote installed Safari 27.0
// rows. Layouts are written by hand in the engine's geometry, and `measure` answers the in-context advances Safari's
// complex text controller had (the Canvas stand-in the port uses), so these check the ported geometry rules, not Canvas.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS } from '../../src/env.ts'
import type { WebKitDisplayBox, WebKitTextBox } from '../../src/engines/webkit/geometry.ts'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../src/model.ts'
import type { WebKitLayout, WebKitLine } from '../types.ts'
import type { CanvasMeasure, ExpectedRect } from './contract.ts'
import { observeWebKit } from './webkit.ts'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }

function paragraph(texts: string[], overrides: Partial<Paragraph> = {}): Paragraph {
  return treeParagraph(texts.map(text => ({ kind: 'text' as const, text })), overrides)
}

function treeParagraph(content: InlineNode[], overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    content, font, letterSpacing: 0, wordSpacing: 0, width: 100, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', ...overrides,
  }
}

function line(boxes: WebKitDisplayBox[], lineBoxWidth = 100): WebKitLine {
  return {
    start: 0, end: 0, fragments: [], hasLineBox: true, joinsNextLine: false, slot: { left: 0, right: 0 }, indented: false, align: 'start',
    geometry: { lineLeft: 0, contentEdgeOffset: 0, lineBoxWidth, contentWidth: 0, hangingWidth: 0, contentLogicalRight: 0, alignmentOffset: 0, boxes }, gaps: [], next: null,
  }
}

function box(run: number, start: number, end: number, x: number, width: number, overrides: Partial<WebKitTextBox> = {}): WebKitDisplayBox {
  return { kind: 'text', run, start, end, level: 0, isWordSeparator: false, x, width, hyphen: null, expansion: 0, expansionBehavior: { left: 'allow', right: 'allow' }, shapedAcrossBoxes: false, canvasFamily: 'Arial', ...overrides }
}

function layoutOf(lines: WebKitLine[]): WebKitLayout {
  return {
    engine: 'webkit', lines, belowFloats: [], gaps: [], measure: { contexts: [], calls: [], memoHits: 0 },
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

  test('a TAB inside a box counts its stop from the content box edge, past slot insets and text-indent', () => {
    const p = paragraph(['a\tb'], { whiteSpace: 'pre-wrap', tabSize: 4 })
    const l = line([box(0, 0, 3, 20, 20)])
    l.geometry.lineLeft = 20
    l.geometry.contentEdgeOffset = 20
    // Every unit 8, so W(' ') is 8 and stops fall every 32px: xPos 20 + 8 reaches the stop at 32 with a 4px tab.
    const observed = observeWebKit(p, layoutOf([l]), advances([8, 8, 8]))
    expect(plain(observed.codePoints[2]!.rects)).toEqual([[0, 32, 8]])
  })

  test('page zoom that is not 1 limits every value', () => {
    const p = paragraph(['a'])
    const layout = layoutOf([line([box(0, 0, 1, 0, 8)])])
    layout.env.pageZoom = null
    expect(observeWebKit(p, layout, advances([8])).nodes[0]![0]!.x).toEqual({ state: 'limited', gap: 'page-zoom', value: 0 })
  })
})

describe('element rects (DESIGN.md §9, stage 5)', () => {
  test('a span reports its inline box per line; an atomic inline its border box; a <br> its line break box; a <wbr> nothing', () => {
    const spanNode: InlineNode = {
      kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
      lang: null, inlineStart: { margin: 0, border: 0, padding: 7 }, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'ab' }],
    }
    const p = treeParagraph([spanNode, { kind: 'atomic', width: 20, height: 10, marginInlineStart: 0, marginInlineEnd: 0 }, { kind: 'br' }, { kind: 'wbr' }, { kind: 'text', text: 'c' }])
    const layout = layoutOf([
      line([{ kind: 'inline-box', element: 0, x: 0, width: 23, hasStartEdge: true, hasEndEdge: true }, box(0, 0, 2, 7, 16), { kind: 'atomic', element: 1, level: 0, x: 23, width: 20 }, { kind: 'line-break', element: 2, x: 43, width: 0 }]),
      line([box(1, 0, 1, 0, 8)]),
    ])
    const observed = observeWebKit(p, layout, advances([8, 8]))
    expect(observed.elements.map(plain)).toEqual([[[0, 0, 23]], [[0, 23, 20]], [[0, 43, 0]], []])
    expect(plain(observed.nodes[0]!)).toEqual([[0, 7, 16]])
    expect(plain(observed.nodes[1]!)).toEqual([[1, 0, 8]])
  })
})

describe('states: what a reported gap can move (the file header of webkit.ts)', () => {
  const states = (rects: ExpectedRect[]): string[] => rects.map(r => `${r.x.state === 'limited' ? r.x.gap : 'predicted'}/${r.width.state === 'limited' ? r.width.gap : 'predicted'}`)
  const lineOf = (boxes: WebKitDisplayBox[], start: number, end: number, overrides: Partial<WebKitLine> = {}): WebKitLine => ({ ...line(boxes), start, end, ...overrides })

  test('a gap limits its whole line and the lines after it, up to a forced break', () => {
    const p = paragraph(['aa bb cc dd\nee'], { whiteSpace: 'pre-line' })
    const layout = layoutOf([
      lineOf([box(0, 0, 2, 0, 16)], 0, 3),
      // The gap names `bb` alone; the break after it rests on it, and so does where `cc dd` starts.
      lineOf([box(0, 3, 5, 0, 16)], 3, 6, { gaps: [{ gap: 'canvas-language', run: 0, detail: '', at: { start: 3, end: 5 } }] }),
      lineOf([box(0, 6, 11, 0, 40), box(0, 11, 12, 40, 0, { kind: 'soft-line-break' })], 6, 12, { fragments: [{ kind: 'forced-break', run: 0, start: 11, end: 12 }] }),
      lineOf([box(0, 12, 14, 0, 16)], 12, 14),
    ])
    const observed = observeWebKit(p, layout, advances(new Array<number>(14).fill(8)))
    expect(states(observed.nodes[0]!)).toEqual(['predicted/predicted', 'canvas-language/canvas-language', 'canvas-language/canvas-language', 'canvas-language/predicted', 'predicted/predicted'])
    // A code point on a box edge sits where its box does.
    expect(observed.codePoints[0]!.rects[0]!.x.state).toBe('predicted')
    expect(observed.codePoints[3]!.rects[0]!.x).toEqual({ state: 'limited', gap: 'canvas-language', value: 0 })
    expect(observed.codePoints[6]!.rects[0]!.x).toEqual({ state: 'limited', gap: 'canvas-language', value: 0 })
    expect(observed.codePoints[12]!.rects[0]!.x.state).toBe('predicted')
  })

  test('with line slots a forced break starts nothing over: the rows shift with the line count', () => {
    const p = paragraph(['aa\nbb'], { whiteSpace: 'pre-line' })
    const slot = { left: 10, right: 0 }
    const layout = layoutOf([
      lineOf([box(0, 0, 2, 10, 16), box(0, 2, 3, 26, 0, { kind: 'soft-line-break' })], 0, 3, { slot, gaps: [{ gap: 'tab-stops', run: 0, detail: '', at: { start: 0, end: 1 } }], fragments: [{ kind: 'forced-break', run: 0, start: 2, end: 3 }] }),
      lineOf([box(0, 3, 5, 0, 16)], 3, 5),
    ])
    const observed = observeWebKit(p, layout, advances([8, 8, 0, 8, 8]))
    expect(states(observed.nodes[0]!)).toEqual(['tab-stops/tab-stops', 'tab-stops/predicted', 'tab-stops/tab-stops'])
  })

  test('a slot refused on a gap limits the lines after it; a paragraph gap limits the lines its range meets', () => {
    const p = paragraph(['aa bb'])
    const refused = layoutOf([lineOf([box(0, 0, 2, 0, 16)], 0, 3), lineOf([box(0, 3, 5, 0, 16)], 3, 5)])
    refused.belowFloats = [{ row: 1, gaps: [{ gap: 'simplified-measuring', run: 0, detail: '' }] }]
    expect(states(observeWebKit(p, refused, advances([8, 8, 8, 8, 8])).nodes[0]!)).toEqual(['predicted/predicted', 'simplified-measuring/simplified-measuring'])
    const ranged = layoutOf([lineOf([box(0, 0, 2, 0, 16)], 0, 3), lineOf([box(0, 3, 5, 0, 16)], 3, 5)])
    ranged.gaps = [{ gap: 'string-storage', run: 0, detail: '', at: { start: 4, end: 5 } }]
    expect(states(observeWebKit(p, ranged, advances([8, 8, 8, 8, 8])).nodes[0]!)).toEqual(['predicted/predicted', 'string-storage/string-storage'])
  })

  test('element rects follow their line, and a text box that measures 0 under a gap is limited', () => {
    const spanNode: InlineNode = {
      kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
      lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'ab' }],
    }
    const p = treeParagraph([spanNode, { kind: 'br' }])
    const layout = layoutOf([lineOf([{ kind: 'inline-box', element: 0, x: 0, width: 0, hasStartEdge: true, hasEndEdge: true }, box(0, 0, 2, 0, 0), { kind: 'line-break', element: 1, x: 0, width: 0 }], 0, 2, { gaps: [{ gap: 'rtl-shaping-across-inline-boxes', run: 0, detail: '', at: { start: 0, end: 2 } }] })])
    const observed = observeWebKit(p, layout, advances([0, 0]))
    expect(observed.elements.map(states)).toEqual([['rtl-shaping-across-inline-boxes/rtl-shaping-across-inline-boxes'], ['rtl-shaping-across-inline-boxes/predicted']])
    expect(states(observed.nodes[0]!)).toEqual(['rtl-shaping-across-inline-boxes/rtl-shaping-across-inline-boxes'])
  })
})

describe('the Canvas family (WebKitTextBox.canvasFamily)', () => {
  test('in-box stand-ins are measured with the list the layout measured the box with', () => {
    const p = paragraph(['ab'], { font: { ...font, family: 'monospace' } })
    const fonts = new Set<string>()
    const measure: CanvasMeasure = (settings, text) => {
      fonts.add(settings.font)
      return 8 * text.length
    }
    observeWebKit(p, layoutOf([line([box(0, 0, 2, 0, 16, { canvasFamily: '"Menlo"' })])]), measure)
    expect([...fonts]).toEqual(['normal 400 16px "Menlo"'])
  })
})
