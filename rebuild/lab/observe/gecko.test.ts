// The Gecko observation port on worked examples of research/observe-gecko.md, over hand-built layouts: every expected
// value here comes from the observation model's rules and recorded rows, not from the library.
import { describe, expect, test } from 'bun:test'
import { PINNED_BUILDS } from '../../src/env.ts'
import type { CssFont, ExpectedRect, GeckoCharacter, GeckoLayout, GeckoLine, GeckoTextFrame, Paragraph } from '../../src/model.ts'
import { FULL_WIDTH, NO_BOX_EDGE, UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { encodeEdges, observeGecko } from './gecko.ts'

const font: CssFont = { family: '"Courier New"', size: 16, weight: 400, style: 'normal' }
const decl = { ...font, facts: UNKNOWN_FONT_FACTS }

function paragraph(texts: string[], direction: 'ltr' | 'rtl' = 'ltr'): Paragraph {
  return {
    content: texts.map(text => ({
      kind: 'span' as const, font: decl, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal' as const, wordBreak: 'normal' as const,
      overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
      verticalAlign: 'baseline' as const, children: [{ kind: 'text' as const, text }],
    })), font: decl,
    letterSpacing: 0, wordSpacing: 0, width: 500, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, direction, lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

const ch = (advance: number, clusterStart = true): GeckoCharacter => ({ skipped: false, clusterStart, advance })
const skip: GeckoCharacter = { skipped: true, clusterStart: false, advance: 0 }

function frame(run: number, contentStart: number, contentEnd: number, x: number, width: number, characters: GeckoCharacter[], extra: Partial<GeckoTextFrame> = {}): GeckoTextFrame {
  return { kind: 'text', run, contentStart, contentEnd, measuredStart: contentStart, level: 0, x, width, hasHeight: true, usedHyphen: false, characters, ...extra }
}

function line(frames: GeckoTextFrame[], start: number, end: number): GeckoLine {
  return {
    start, end, fragments: [], hasLineBox: true, joinsNextLine: false, slot: FULL_WIDTH, indented: false, align: 'start',
    geometry: { appUnitsPerDevPixel: 30, lineLeft: 0, availableWidth: 30000, impactedByFloats: false, textIndent: 0, width: frames.reduce((n, f) => n + f.width, 0), hang: 0, alignOffset: 0, frames },
    gaps: [], next: null,
  }
}

function layout(lines: GeckoLine[]): GeckoLayout {
  return {
    engine: 'gecko', env: { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: null, dictionaryBreaks: { kind: 'unavailable' } },
    lines, belowFloats: [], measure: { contexts: [], calls: [], memoHits: 0 }, gaps: [],
  }
}

const noMeasure = () => { throw new Error('the Gecko port measures nothing') }
const values = (rects: ExpectedRect[]) => rects.map(r => [r.line, r.x.value, r.width.value])
const states = (rects: ExpectedRect[]) => rects.map(r => [r.x.state, r.width.state])

describe('DOMRect encoding (observe-gecko.md §3)', () => {
  test('encode-examples.txt', () => {
    expect(encodeEdges(2304, 2304)).toEqual({ x: 38.399993896484375, width: 0 })
    expect(encodeEdges(16112, 17150)).toEqual({ x: 268.5333251953125, width: 17.29998779296875 })
    expect(encodeEdges(17150, 18188)).toEqual({ x: 285.83331298828125, width: 17.300003051757812 })
    expect(encodeEdges(0, 3120)).toEqual({ x: 0, width: 52 })
    expect(encodeEdges(0, 1)).toEqual({ x: 0, width: 0.01666259765625 })
  })
})

describe('Range rects over Gecko frames', () => {
  test('aaaa bbbb broken after the space: the trimmed space reports width 0 at the box end', () => {
    const a = ch(576)
    const l = layout([line([frame(0, 0, 5, 0, 2304, [a, a, a, a, a])], 0, 5), line([frame(0, 5, 9, 0, 2304, [a, a, a, a])], 5, 9)])
    const o = observeGecko(paragraph(['aaaa bbbb']), l, noMeasure)
    expect(values(o.codePoints[0]!.rects)).toEqual([[0, 0, 9.600006103515625]])
    expect(values(o.codePoints[4]!.rects)).toEqual([[0, 38.399993896484375, 0]])
    expect(values(o.codePoints[5]!.rects)).toEqual([[1, 0, 9.600006103515625]])
    expect(values(o.nodes[0]!)).toEqual([[0, 0, 38.399993896484375], [1, 0, 38.399993896484375]])
    expect(o.unobservable.some(u => u.fact === 'lines[0].geometry.frames[0].characters[4..4].advance')).toBe(true)
  })

  test('a cluster reports its advance on its last code point (F2)', () => {
    const l = layout([line([frame(0, 0, 2, 0, 600, [ch(600), ch(0, false)])], 0, 2)])
    const o = observeGecko(paragraph(['é']), l, noMeasure)
    expect(values(o.codePoints[0]!.rects)).toEqual([[0, 0, 0]])
    expect(values(o.codePoints[1]!.rects)).toEqual([[0, 0, 10]])
  })

  test('a −90 au space alone in its frame grows the box by the floored delta (c-79e5272a2644d9b8, F8)', () => {
    const l = layout([line([frame(0, 0, 1, 0, 90, [ch(-90)])], 0, 1)])
    expect(values(observeGecko(paragraph([' ']), l, noMeasure).codePoints[0]!.rects)).toEqual([[0, 0, 1.5]])
  })

  test('points count from the right edge of an RTL frame', () => {
    const l = layout([line([frame(0, 0, 2, 28848, 1152, [ch(576), ch(576)], { level: 1 })], 0, 2)])
    const o = observeGecko(paragraph(['אב'], 'rtl'), l, noMeasure)
    expect(values(o.codePoints[0]!.rects)).toEqual([[0, encodeEdges(28848 + 576, 30000).x, encodeEdges(28848 + 576, 30000).width]])
    expect(values(o.codePoints[1]!.rects)).toEqual([[0, encodeEdges(28848, 29424).x, encodeEdges(28848, 29424).width]])
  })

  test('a used soft hyphen reports the hyphen advance on the SHY (F11)', () => {
    const l = layout([line([frame(0, 0, 3, 0, 1584, [ch(576), ch(576), skip], { usedHyphen: true })], 0, 3)])
    l.lines[0]!.fragments = [{ kind: 'text', run: 0, start: 0, end: 2, painted: 'aa', level: 0 }, { kind: 'collapsed', run: 0, start: 2, end: 3 }, { kind: 'hyphen', run: 0, at: 3, painted: '‐', letterSpacing: 0, level: 0 }]
    const o = observeGecko(paragraph(['aa­']), l, noMeasure)
    expect(values(o.codePoints[2]!.rects)).toEqual([[0, 19.199996948242188, 7.1999969482421875]])
    expect(o.unobservable.some(u => u.fact === 'lines[0].fragments[2].painted')).toBe(true)
  })

  test('a lone VT with 1px letter spacing reports 60 au (c-92b6963ae4344985)', () => {
    const l = layout([line([frame(0, 0, 1, 0, 60, [ch(60)])], 0, 1)])
    expect(values(observeGecko(paragraph(['\v']), l, noMeasure).codePoints[0]!.rects)).toEqual([[0, 0, 1]])
  })

  test('a node without a frame reports nothing (F12)', () => {
    const l = layout([line([frame(1, 1, 4, 0, 1728, [ch(576), ch(576), ch(576)])], 0, 4)])
    const o = observeGecko(paragraph([' ', 'abc']), l, noMeasure)
    expect(o.codePoints[0]!.rects).toEqual([])
    expect(o.nodes[0]).toEqual([])
    expect(values(o.nodes[1]!)).toEqual([[0, 0, 28.800003051757812]])
  })

  test('code point edges collapsed at a line start report width 0 at the measured start', () => {
    const l = layout([line([frame(0, 0, 3, 0, 576, [ch(576)], { measuredStart: 2 })], 0, 3)])
    const o = observeGecko(paragraph(['  a']), l, noMeasure)
    expect(values(o.codePoints[0]!.rects)).toEqual([[0, 0, 0]])
    expect(values(o.codePoints[2]!.rects)).toEqual([[0, 0, 9.600006103515625]])
  })

  test('points inside a word are limited by in-word-prefix; a frame broken inside a word limits its box and later frames', () => {
    const a = ch(576)
    const words = layout([line([frame(0, 0, 5, 0, 2880, [a, a, a, a, a])], 0, 5)])
    const o = observeGecko(paragraph(['ab cd']), words, noMeasure)
    expect(states(o.codePoints[0]!.rects)).toEqual([['predicted', 'limited']])
    expect(states(o.codePoints[2]!.rects)).toEqual([['predicted', 'predicted']])
    expect(states(o.codePoints[3]!.rects)).toEqual([['predicted', 'limited']])
    expect(states(o.nodes[0]!)).toEqual([['predicted', 'predicted']])
    const split = layout([line([frame(0, 0, 2, 0, 1152, [a, a])], 0, 2), line([frame(0, 2, 4, 0, 1152, [a, a])], 2, 4)])
    expect(states(observeGecko(paragraph(['abcd']), split, noMeasure).nodes[0]!)).toEqual([['predicted', 'limited'], ['predicted', 'limited']])
  })
})
