// The Blink observation port on research/observe-blink.md's worked examples. Layouts are written by hand in Blink's
// geometry, so every expected value comes from the observation model and the recorded rows it cites, not from the
// library.
import { describe, expect, test } from 'bun:test'
import type { BlinkItem, BlinkLayout, BlinkLine, BlinkMappingUnit, BlinkShapeRun, CssFont, ExpectedRect, Paragraph } from '../../src/model.ts'
import { observeBlink } from './blink.ts'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }
const facts = { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null, pairKerning: null }

function paragraph(texts: string[], direction: Paragraph['direction'] = 'ltr'): Paragraph {
  const decl = { ...(font as CssFont), facts }
  const style = { font: decl, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'pre-wrap' as const, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8 }
  const edge = { margin: 0, border: 0, padding: 0 }
  return {
    ...style,
    content: texts.map(text => ({ ...style, kind: 'span' as const, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline' as const, children: [{ kind: 'text' as const, text }] })),
    width: 100, lineHeight: 20, direction, lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

function line(items: BlinkItem[], mapping: BlinkMappingUnit[], hangWidth: number = 0): BlinkLine {
  return {
    start: 0, end: 0, fragments: [], hasLineBox: true, joinsNextLine: false, gaps: [], next: null, slot: { left: 0, right: 0 }, indented: false, align: 'start',
    geometry: { layoutZoom: 2, lineLeft: 0, lineRight: 12800, availableWidth: 12800, textIndent: 0, needsAccurateEndPosition: false, width: 0, hangWidth, alignOffset: 0, mapping, items },
  }
}

function layout(lines: BlinkLine[]): BlinkLayout {
  return {
    engine: 'blink', lines, belowFloats: [], gaps: [], measure: { contexts: [], calls: [], memoHits: 0 },
    env: { engine: 'blink', build: '153.0.8010.48', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: null, dictionaryBreaks: { kind: 'unavailable' } },
  }
}

// An item's shape as one run of the paragraph's shape result.
function oneRun(textStart: number, textEnd: number): BlinkShapeRun[] {
  return [{ textStart, textEnd, reshaped: null, fontsKnown: true }]
}

// One cluster per code unit with the given raw LayoutUnit advances (16.16 = raw × 1024).
function text(run: number, textStart: number, x: number, advances: number[], level: number = 0, inlineSize: number | null = null): BlinkItem {
  let sum = 0
  const clusters = advances.map((a, i) => {
    sum += a
    return { textStart: textStart + i, textEnd: textStart + i + 1, graphemeStarts: [textStart + i], advance: Math.round(a * 1024) }
  })
  return { kind: 'text', run, textStart, textEnd: textStart + advances.length, level, x, inlineSize: inlineSize ?? Math.ceil(sum), clusters, runs: oneRun(textStart, textStart + advances.length), partsKnown: true }
}

function identity(run: number, start: number, end: number): BlinkMappingUnit {
  return { run, start, end, textStart: start, textEnd: end, collapsed: false }
}

// [line, x raw, width raw, both fields predicted] at zoom 2, where a rect value times 128 is raw.
function raw(rects: ExpectedRect[]): [number, number, number, boolean][] {
  return rects.map(r => [r.line, r.x.value * 128, r.width.value * 128, r.x.state === 'predicted' && r.width.state === 'predicted'])
}

const unused = (): number => { throw new Error('the Blink port measures nothing') }

describe('blink observation port, element rects', () => {
  test('Element.getClientRects: a box fragment per line, an atomic border box, a <br> item, a culled span its items (layout_inline.cc:428-490)', () => {
    const decl = { ...(font as CssFont), facts }
    const style = { font: decl, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal' as const, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8 }
    const edge = { margin: 0, border: 0, padding: 10 }
    const none = { margin: 0, border: 0, padding: 0 }
    const p: Paragraph = {
      ...style, width: 100, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
      content: [
        { ...style, kind: 'span', lang: null, inlineStart: edge, inlineEnd: none, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'ab' }] },
        { kind: 'atomic', width: 5, height: 5, marginInlineStart: 2, marginInlineEnd: 0 },
        { kind: 'br' },
        { ...style, kind: 'span', lang: null, inlineStart: none, inlineEnd: none, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'c' }] },
      ],
    }
    const l0 = line([
      text(0, 0, 2560, [640, 640]),
      { kind: 'atomic', element: 1, level: 0, x: 4096, inlineSize: 640, marginStart: 256, marginEnd: 0 },
      { kind: 'br', element: 2, level: 0, x: 4736, inlineSize: 0 },
      { kind: 'inline-box', element: 0, x: 0, inlineSize: 3840, hasStartEdge: true, hasEndEdge: true },
    ], [identity(0, 0, 2)])
    const l1 = line([text(1, 2, 0, [640])], [identity(1, 2, 3)])
    const o = observeBlink(p, layout([l0, l1]), unused)
    expect(o.elements.map(rects => raw(rects))).toEqual([
      [[0, 0, 3840, true]],
      [[0, 4096, 640, true]],
      [[0, 4736, 0, true]],
      [[1, 0, 640, true]],
    ])
  })
})

describe('blink observation port', () => {
  test('observe-blink §5 item 11, c-be7f6b754e4527ff: an odd-level hyphen copies onto the letter before and the SHY', () => {
    // `ب­ب` U+001E, LTR block at DPR 2: line 1 [ب 0+564]; line 2 [H 0+660][SHY 660+0]; line 3 the rest.
    const p = paragraph(['ب­ب'])
    const hyphen: BlinkItem = { kind: 'hyphen', run: 0, level: 1, x: 0, inlineSize: 660 }
    const l = layout([
      line([text(0, 0, 0, [564], 1)], [identity(0, 0, 1)]),
      line([hyphen, text(0, 1, 660, [0], 1)], [identity(0, 1, 2)]),
      line([text(0, 2, 0, [564, 300], 1)], [identity(0, 2, 4)]),
    ])
    const o = observeBlink(p, l, unused)
    expect(raw(o.codePoints[0]!.rects)).toEqual([[0, 0, 564, true], [1, 0, 660, true]])
    expect(raw(o.codePoints[1]!.rects)).toEqual([[1, 0, 660, true], [1, 660, 0, true]])
    // The whole node includes the hyphen after line 1's item end.
    expect(raw(o.nodes[0]!)).toEqual([[0, 0, 564, true], [1, 0, 660, true], [1, 660, 0, true], [2, 0, 864, true]])
    expect(o.unobservable).toEqual([])
  })

  test('U3: an odd-level hyphen before its node\'s first item is in no rect', () => {
    const p = paragraph(['ب­ب'])
    const hyphen: BlinkItem = { kind: 'hyphen', run: 0, level: 1, x: 0, inlineSize: 660 }
    const l = layout([line([hyphen, text(0, 0, 660, [564, 0], 1)], [identity(0, 0, 2)]), line([text(0, 2, 0, [564], 1)], [identity(0, 2, 3)])])
    const o = observeBlink(p, l, unused)
    expect(raw(o.nodes[0]!)).toEqual([[0, 660, 564, true], [1, 0, 564, true]])
    expect(o.unobservable.map(u => u.fact)).toEqual(['lines[0].geometry.items[0].inlineSize'])
  })

  test('§5 item 5, c-21177e1cab2c68c9: a space removed at a line end reports two boundary rects', () => {
    // `를` ends line 1 at caret 17629.5 raw (item size 17630); the space is in text_content and in no item.
    const p = paragraph(['를 x'])
    const l = layout([line([text(0, 0, 0, [17629.5])], [identity(0, 0, 2)]), line([text(0, 2, 0, [640])], [identity(0, 2, 3)])])
    const o = observeBlink(p, l, unused)
    // The end boundary floors the float width: it rests on the summed advances, and with no gap concerning it the port
    // states it as predicted.
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 17629, 0, true], [1, 0, 0, true]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 0, 17630, true], [1, 0, 640, true]])
  })

  test('§5 item 4: a collapsed space maps to the start of the node\'s next content', () => {
    // `a  b`: the second space collapses to text_content offset 2.
    const p = paragraph(['a  b'])
    const mapping = [identity(0, 0, 2), { run: 0, start: 2, end: 3, textStart: 2, textEnd: 2, collapsed: true }, { run: 0, start: 3, end: 4, textStart: 2, textEnd: 3, collapsed: false }]
    const l = layout([line([text(0, 0, 0, [640, 320, 640])], mapping)])
    const o = observeBlink(p, l, unused)
    // The boundary sits at a caret inside the item, floor64 of a Canvas prefix; no gap concerns it.
    expect(raw(o.codePoints[2]!.rects)).toEqual([[0, 960, 0, true]])
    expect(raw(o.codePoints[3]!.rects)).toEqual([[0, 960, 640, true]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 0, 1600, true]])
  })

  test('§5 item 2, c-26eedff255c8f6b5: a glyph cluster over two graphemes splits its advance equally', () => {
    // Thai `ย` ZWSP `ั`: the mark merges into the ZWSP's cluster, and ICU puts a grapheme break after the ZWSP.
    const p = paragraph(['ย​ั'])
    const item: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 3, level: 0, x: 0, inlineSize: 37245, runs: oneRun(0, 3), partsKnown: true,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 35945 * 1024 }, { textStart: 1, textEnd: 3, graphemeStarts: [1, 2], advance: 1300 * 1024 }],
    }
    const o = observeBlink(p, layout([line([item], [identity(0, 0, 3)])]), unused)
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 35945, 650, true]])
    expect(raw(o.codePoints[2]!.rects)).toEqual([[0, 36595, 650, true]])
    // A gap over the grapheme limits the positions that sum its characters' advances, and only those: the cluster's start
    // rests on the cluster before it alone.
    const gapped = line([item], [identity(0, 0, 3)])
    gapped.gaps = [{ gap: 'glyph-clusters', run: 0, detail: '', at: { start: 1, end: 3 } }]
    const g = observeBlink(p, layout([gapped]), unused)
    expect(g.codePoints[1]!.rects[0]!.x).toEqual({ state: 'predicted', value: 35945 / 128 })
    expect(g.codePoints[1]!.rects[0]!.width).toEqual({ state: 'limited', gap: 'glyph-clusters', value: 650 / 128 })
    expect(g.codePoints[2]!.rects[0]!.x).toEqual({ state: 'limited', gap: 'glyph-clusters', value: 36595 / 128 })
    expect(g.codePoints[0]!.rects[0]!.width.state).toBe('predicted')
    // A position the layout marks as a Canvas stand-in limits the edges resting on it, not the ones past it; a limited size
    // limits the x of the items after it on the line.
    const marked: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 3, level: 0, x: 0, inlineSize: 1600, sizeLimit: 'glyph-clusters', runs: oneRun(0, 3), partsKnown: true,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 640 * 1024 }, { textStart: 1, textEnd: 2, graphemeStarts: [1], advance: 320 * 1024, startLimit: 'in-word-prefix' }, { textStart: 2, textEnd: 3, graphemeStarts: [2], advance: 640 * 1024 }],
    }
    const after: BlinkItem = { kind: 'text', run: 1, textStart: 3, textEnd: 4, level: 0, x: 1600, inlineSize: 640, runs: oneRun(3, 4), partsKnown: true, clusters: [{ textStart: 3, textEnd: 4, graphemeStarts: [3], advance: 640 * 1024 }] }
    const m = observeBlink(paragraph(['abc', 'd']), layout([line([marked, after], [identity(0, 0, 3), identity(1, 3, 4)])]), unused)
    expect(m.codePoints[0]!.rects[0]!.width).toEqual({ state: 'limited', gap: 'in-word-prefix', value: 5 })
    expect(m.codePoints[1]!.rects[0]!.x).toEqual({ state: 'limited', gap: 'in-word-prefix', value: 5 })
    expect(m.codePoints[2]!.rects[0]!.x).toEqual({ state: 'predicted', value: 7.5 })
    expect(m.codePoints[2]!.rects[0]!.width).toEqual({ state: 'limited', gap: 'glyph-clusters', value: 5 })
    expect(m.nodes[0]![0]!.width).toEqual({ state: 'limited', gap: 'glyph-clusters', value: 12.5 })
    expect(m.nodes[1]![0]!.x).toEqual({ state: 'limited', gap: 'glyph-clusters', value: 12.5 })
  })

  test('§5 item 11: an even-level hyphen copies onto the code point after the soft hyphen', () => {
    const p = paragraph(['super­cali'])
    const hyphen: BlinkItem = { kind: 'hyphen', run: 0, level: 0, x: 3200, inlineSize: 682 }
    const l = layout([line([text(0, 0, 0, [640, 640, 640, 640, 640, 0]), hyphen], [identity(0, 0, 6)]), line([text(0, 6, 0, [640, 640, 640, 640])], [identity(0, 6, 10)])])
    const o = observeBlink(p, l, unused)
    expect(raw(o.codePoints[6]!.rects)).toEqual([[0, 3200, 682, true], [1, 0, 640, true]])
    expect(raw(o.codePoints[5]!.rects)).toEqual([[0, 3200, 0, true], [0, 3200, 682, true]])
  })

  test('c-29aa7f0e45d7c913: a caret past 256 px adds the runs before it as floats', () => {
    // Hiragino Mincho 40 px: 19 clusters from the paragraph's shape result, 49361714 units of 16.16, then a reshaped line end
    // `ウェ`. The caret before `ェ` is float(49361714) + float(2542797) rounded to a float again, a step below 792 px, where
    // the exact sum 51904511 rounds up to 792 px: natively the rect starts at 50687 and the one before it ends at 50688.
    const advances = [2621440, 2621440, 2621440, 2516582, 2621440, 2621440, 2621440, 2621440, 2621440, 2490368, 2621440, 2516582, 2621440, 2621440, 2516582, 2621440, 2621440, 2621440, 2621440, 2542797, 2621440]
    const clusters = advances.map((advance, i) => ({ textStart: i, textEnd: i + 1, graphemeStarts: [i], advance }))
    const p = paragraph(['コンピューター、インターネット、ソフトウェ'])
    const reshapedEnd: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 21, level: 0, x: 0, inlineSize: 53248, clusters, partsKnown: true,
      runs: [{ textStart: 0, textEnd: 19, reshaped: null, fontsKnown: true }, { textStart: 19, textEnd: 21, reshaped: { textStart: 19, textEnd: 21 }, fontsKnown: true }],
    }
    const o = observeBlink(p, layout([line([reshapedEnd], [identity(0, 0, 21)])]), unused)
    expect(raw(o.codePoints[20]!.rects)).toEqual([[0, 50687, 2561, true]])
    expect(raw(o.codePoints[19]!.rects)).toEqual([[0, 48204, 2484, true]])
    const oneCall = observeBlink(p, layout([line([{ ...reshapedEnd, runs: oneRun(0, 21) }], [identity(0, 0, 21)])]), unused)
    expect(raw(oneCall.codePoints[20]!.rects)).toEqual([[0, 50688, 2560, true]])
    // Where the view's parts aren't known the value is limited, since it sits within a float step of a LayoutUnit edge.
    const unknown = observeBlink(p, layout([line([{ ...reshapedEnd, partsKnown: false }], [identity(0, 0, 21)])]), unused)
    expect(unknown.codePoints[20]!.rects[0]!.x.state).toBe('limited')
    expect(unknown.codePoints[1]!.rects[0]!.x.state).toBe('predicted')
  })

  test('c-0f4d71d14a32dd6c: a floored caret at an RTL item\'s start is limited where the layout reports a gap there', () => {
    // `لا` in an RTL item whose Canvas advances put nothing on ل (Courier New's lam-alef ligature splits it in Chrome).
    const p = paragraph(['لا'])
    const item: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 2, level: 1, x: 0, inlineSize: 1538, runs: oneRun(0, 2), partsKnown: true,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 0 }, { textStart: 1, textEnd: 2, graphemeStarts: [1], advance: Math.round(1537.5 * 1024) }],
    }
    const gapped = line([item], [identity(0, 0, 2)])
    gapped.gaps = [{ gap: 'glyph-clusters', run: 0, detail: '', at: { start: 0, end: 2 } }]
    const o = observeBlink(p, layout([gapped]), unused)
    const rects = o.codePoints[0]!.rects
    expect(rects.map(r => [r.x.state, r.width.state])).toEqual([['limited', 'limited']])
    // ا: its left edge is the RTL end's caret 0, predicted; its right edge is a caret inside the item, limited.
    expect(o.codePoints[1]!.rects.map(r => [r.x.state, r.width.state])).toEqual([['predicted', 'limited']])
    // Without the gap both are predicted.
    const plain = observeBlink(p, layout([line([item], [identity(0, 0, 2)])]), unused)
    expect(plain.codePoints[0]!.rects.map(r => [r.x.state, r.width.state])).toEqual([['predicted', 'predicted']])
  })

  test('c-82fdb6df09ca942f: a rect without width beside a stand-in boundary is limited on both edges', () => {
    // `لا` in an RTL item: the port gives ل no advance, and the boundary between the letters is a stand-in. Natively ل is
    // half the ligature wide and its left edge is that boundary's caret, so the x of the zero-width rect rests on it too.
    const p = paragraph(['لا'])
    const item: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 2, level: 1, x: 0, inlineSize: 1229, runs: oneRun(0, 2), partsKnown: true,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 0 }, { textStart: 1, textEnd: 2, graphemeStarts: [1], advance: 1229 * 1024, startLimit: 'glyph-clusters' }],
    }
    const o = observeBlink(p, layout([line([item], [identity(0, 0, 2)])]), unused)
    expect(o.codePoints[0]!.rects.map(r => [r.x.state, r.width.state])).toEqual([['limited', 'limited']])
    expect(o.codePoints[1]!.rects.map(r => [r.x.state, r.width.state])).toEqual([['predicted', 'limited']])
  })

  test('§4.2: an RTL item\'s code point rects run from its right edge', () => {
    const p = paragraph(['אב'], 'rtl')
    const o = observeBlink(p, layout([line([text(0, 0, 11520, [640, 640], 1)], [identity(0, 0, 2)])]), unused)
    expect(raw(o.codePoints[0]!.rects)).toEqual([[0, 12160, 640, true]])
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 11520, 640, true]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 11520, 1280, true]])
  })
})
