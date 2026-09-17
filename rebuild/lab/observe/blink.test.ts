// The Blink observation port on research/observe-blink.md's worked examples. Layouts are written by hand in Blink's
// geometry, so every expected value comes from the observation model and the recorded rows it cites, not from the
// library.
import { describe, expect, test } from 'bun:test'
import type { BlinkItem, BlinkLayout, BlinkLine, BlinkMappingUnit, CssFont, ExpectedRect, Paragraph } from '../../src/model.ts'
import { observeBlink } from './blink.ts'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }
const facts = { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null }

function paragraph(texts: string[], direction: Paragraph['direction'] = 'ltr'): Paragraph {
  const decl = { ...(font as CssFont), facts }
  return {
    runs: texts.map(text => ({ text, node: 'span' as const, font: decl, letterSpacing: 0, wordSpacing: 0, lang: null })), font: decl,
    letterSpacing: 0, wordSpacing: 0, width: 100, lineHeight: 20, whiteSpace: 'pre-wrap', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, direction, lang: 'en',
  }
}

function line(items: BlinkItem[], mapping: BlinkMappingUnit[], hangWidth: number = 0): BlinkLine {
  return {
    start: 0, end: 0, fragments: [], hasLineBox: true, joinsNextLine: false, gaps: [], next: null,
    geometry: { layoutZoom: 2, availableWidth: 12800, width: 0, hangWidth, mapping, items },
  }
}

function layout(lines: BlinkLine[]): BlinkLayout {
  return {
    engine: 'blink', lines, gaps: [], measure: { contexts: [], calls: [], memoHits: 0 },
    env: { engine: 'blink', build: '153.0.8010.48', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: null, dictionaryBreaks: { kind: 'unavailable' } },
  }
}

// One cluster per code unit with the given raw LayoutUnit advances (16.16 = raw × 1024).
function text(run: number, textStart: number, x: number, advances: number[], level: number = 0, inlineSize: number | null = null): BlinkItem {
  let sum = 0
  const clusters = advances.map((a, i) => {
    sum += a
    return { textStart: textStart + i, textEnd: textStart + i + 1, graphemeStarts: [textStart + i], advance: Math.round(a * 1024) }
  })
  return { kind: 'text', run, textStart, textEnd: textStart + advances.length, level, x, inlineSize: inlineSize ?? Math.ceil(sum), clusters }
}

function identity(run: number, start: number, end: number): BlinkMappingUnit {
  return { run, start, end, textStart: start, textEnd: end, collapsed: false }
}

// [line, x raw, width raw, both fields predicted] at zoom 2, where a rect value times 128 is raw.
function raw(rects: ExpectedRect[]): [number, number, number, boolean][] {
  return rects.map(r => [r.line, r.x.value * 128, r.width.value * 128, r.x.state === 'predicted' && r.width.state === 'predicted'])
}

const unused = (): number => { throw new Error('the Blink port measures nothing') }

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
    // The end boundary floors the float width: it rests on the summed advances, so it is limited.
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 17629, 0, false], [1, 0, 0, true]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 0, 17630, true], [1, 0, 640, true]])
  })

  test('§5 item 4: a collapsed space maps to the start of the node\'s next content', () => {
    // `a  b`: the second space collapses to text_content offset 2.
    const p = paragraph(['a  b'])
    const mapping = [identity(0, 0, 2), { run: 0, start: 2, end: 3, textStart: 2, textEnd: 2, collapsed: true }, { run: 0, start: 3, end: 4, textStart: 2, textEnd: 3, collapsed: false }]
    const l = layout([line([text(0, 0, 0, [640, 320, 640])], mapping)])
    const o = observeBlink(p, l, unused)
    // The boundary sits at a caret inside the item, floor64 of a Canvas prefix: limited.
    expect(raw(o.codePoints[2]!.rects)).toEqual([[0, 960, 0, false]])
    expect(raw(o.codePoints[3]!.rects)).toEqual([[0, 960, 640, false]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 0, 1600, true]])
  })

  test('§5 item 2, c-26eedff255c8f6b5: a glyph cluster over two graphemes splits its advance equally', () => {
    // Thai `ย` ZWSP `ั`: the mark merges into the ZWSP's cluster, and ICU puts a grapheme break after the ZWSP.
    const p = paragraph(['ย​ั'])
    const item: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 3, level: 0, x: 0, inlineSize: 37245,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 35945 * 1024 }, { textStart: 1, textEnd: 3, graphemeStarts: [1, 2], advance: 1300 * 1024 }],
    }
    const o = observeBlink(p, layout([line([item], [identity(0, 0, 3)])]), unused)
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 35945, 650, false]])
    expect(raw(o.codePoints[2]!.rects)).toEqual([[0, 36595, 650, false]])
    // Inner edges rest on Canvas advances: limited by in-word-prefix.
    expect(o.codePoints[1]!.rects[0]!.x).toEqual({ state: 'limited', gap: 'in-word-prefix', value: 35945 / 128 })
  })

  test('§5 item 11: an even-level hyphen copies onto the code point after the soft hyphen', () => {
    const p = paragraph(['super­cali'])
    const hyphen: BlinkItem = { kind: 'hyphen', run: 0, level: 0, x: 3200, inlineSize: 682 }
    const l = layout([line([text(0, 0, 0, [640, 640, 640, 640, 640, 0]), hyphen], [identity(0, 0, 6)]), line([text(0, 6, 0, [640, 640, 640, 640])], [identity(0, 6, 10)])])
    const o = observeBlink(p, l, unused)
    expect(raw(o.codePoints[6]!.rects)).toEqual([[0, 3200, 682, true], [1, 0, 640, false]])
    expect(raw(o.codePoints[5]!.rects)).toEqual([[0, 3200, 0, false], [0, 3200, 682, true]])
  })

  test('c-0f4d71d14a32dd6c: a floored caret at an RTL item\'s start is limited', () => {
    // `لا` in an RTL item whose Canvas advances put nothing on ل (Courier New's lam-alef ligature splits it in Chrome).
    const p = paragraph(['لا'])
    const item: BlinkItem = {
      kind: 'text', run: 0, textStart: 0, textEnd: 2, level: 1, x: 0, inlineSize: 1538,
      clusters: [{ textStart: 0, textEnd: 1, graphemeStarts: [0], advance: 0 }, { textStart: 1, textEnd: 2, graphemeStarts: [1], advance: Math.round(1537.5 * 1024) }],
    }
    const o = observeBlink(p, layout([line([item], [identity(0, 0, 2)])]), unused)
    const rects = o.codePoints[0]!.rects
    expect(rects.map(r => [r.x.state, r.width.state])).toEqual([['limited', 'limited']])
    // ا: its left edge is the RTL end's caret 0, predicted; its right edge is a caret inside the item, limited.
    expect(o.codePoints[1]!.rects.map(r => [r.x.state, r.width.state])).toEqual([['predicted', 'limited']])
  })

  test('§4.2: an RTL item\'s code point rects run from its right edge', () => {
    const p = paragraph(['אב'], 'rtl')
    const o = observeBlink(p, layout([line([text(0, 0, 11520, [640, 640], 1)], [identity(0, 0, 2)])]), unused)
    expect(raw(o.codePoints[0]!.rects)).toEqual([[0, 12160, 640, false]])
    expect(raw(o.codePoints[1]!.rects)).toEqual([[0, 11520, 640, false]])
    expect(raw(o.nodes[0]!)).toEqual([[0, 11520, 1280, true]])
  })
})
