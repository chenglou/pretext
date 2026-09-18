// Line filling, fragments and geometry on DESIGN.md §2.2's worked examples, with a stand-in Canvas whose every code point
// is 10px wide at 16px (bun has no OffscreenCanvas; the lab measures in Chrome). At layout zoom 1 a 10px advance is
// 640 raw LayoutUnits.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createMeasurer } from '../../measure/canvas.js'
import {
  FULL_WIDTH, NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type BlinkLine, type BoxEdge, type FontFacts, type Gap, type InlineNode, type LineSlot, type Paragraph,
} from '../../model.js'
import { blinkEngine } from './index.js'

beforeAll(() => {
  class Context {
    font = '16px x'
    lang = ''
    letterSpacing = '0px'
    wordSpacing = '0px'
    fontKerning = 'auto'
    textRendering = 'auto'
    direction = 'ltr'
    measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
      const size = parseFloat(/([\d.]+)px/.exec(this.font)![1]!)
      let n = 0
      for (const c of text) if (c !== '‍' && c !== '​') n++
      return { width: n * size * 10 / 16, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}

type Options = { whiteSpace?: Paragraph['whiteSpace']; direction?: Paragraph['direction']; facts?: FontFacts; textIndent?: number; textAlign?: Paragraph['textAlign'] }

function fontOf(facts: FontFacts): Paragraph['font'] {
  return { family: 'Mono', size: 16, weight: 400, style: 'normal', facts }
}

// A flat paragraph: each run a span or a bare text node with the block's styles (DESIGN.md §1.1, "Flat paragraphs").
function paragraph(runs: [string, 'span' | 'text'][], width: number, o: Options = {}): Paragraph {
  const whiteSpace = o.whiteSpace ?? 'normal'
  const font = fontOf(o.facts ?? UNKNOWN_FONT_FACTS)
  const style = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8 }
  const content: InlineNode[] = runs.map(([text, node]) => node === 'text'
    ? { kind: 'text', text }
    : { ...style, kind: 'span', lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text }] })
  return {
    ...style, content, width, lineHeight: 20, direction: o.direction ?? 'ltr', lang: 'en',
    textIndent: o.textIndent ?? 0, textAlign: o.textAlign ?? 'start',
  }
}

function span(children: InlineNode[], edges: { start?: BoxEdge; end?: BoxEdge; whiteSpace?: Paragraph['whiteSpace'] } = {}): InlineNode {
  const font = fontOf(UNKNOWN_FONT_FACTS)
  return {
    kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: edges.whiteSpace ?? 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: edges.start ?? NO_BOX_EDGE, inlineEnd: edges.end ?? NO_BOX_EDGE,
    verticalAlign: 'baseline', children,
  }
}

function tree(content: InlineNode[], width: number, o: Options = {}): Paragraph {
  return { ...paragraph([], width, o), content }
}

// The line loop of src/index.ts over the Blink engine alone.
function blink(p: Paragraph, e: BlinkEnvironment = env, slots: LineSlot[] = []): { lines: BlinkLine[]; gaps: Gap[]; belowFloats: number[] } {
  const measurer = createMeasurer()
  const prepared = blinkEngine.prepare(p, e, measurer)
  const lines: BlinkLine[] = []
  const belowFloats: number[] = []
  let row = 0
  for (let start = blinkEngine.firstLine(prepared); start !== null;) {
    const result = blinkEngine.nextLine(prepared, start, row < slots.length ? slots[row]! : FULL_WIDTH, measurer)
    if (result.kind === 'below-floats') {
      belowFloats.push(row)
      row++
      continue
    }
    lines.push(result.line)
    if (result.line.hasLineBox) row++
    start = result.line.next
  }
  return { lines, gaps: blinkEngine.gaps(prepared), belowFloats }
}

describe('blink lines', () => {
  test('DESIGN.md §2.2 example 1: trimmed and collapsed spaces at a break', () => {
    const layout = blink(paragraph([['Hello  ', 'span'], [' ', 'text'], ['world', 'span']], 60))
    expect(layout.lines.map(l => [l.start, l.end, l.hasLineBox])).toEqual([[0, 8, true], [8, 13, true]])
    expect(layout.lines[0]!.fragments).toEqual([
      { kind: 'box-start', element: 0 },
      { kind: 'text', run: 0, start: 0, end: 5, painted: 'Hello', level: 0 },
      { kind: 'trimmed', run: 0, start: 5, end: 6, painted: ' ', level: 0 },
      { kind: 'collapsed', run: 0, start: 6, end: 7 },
      { kind: 'box-end', element: 0 },
      { kind: 'collapsed', run: 1, start: 7, end: 8 },
    ])
    expect(layout.lines[1]!.fragments.map(f => f.kind)).toEqual(['box-start', 'text', 'box-end'])
    const g = layout.lines[0]!.geometry
    expect([g.availableWidth, g.width, g.hangWidth, g.lineLeft, g.lineRight, g.alignOffset]).toEqual([3840, 3200, 0, 0, 3840, 0])
    // The trimmed space is in text_content but in no item; the second space and the bare text node collapse to offset 6.
    expect(g.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 3200]])
    expect(g.mapping).toEqual([
      { run: 0, start: 0, end: 6, textStart: 0, textEnd: 6, collapsed: false },
      { run: 0, start: 6, end: 7, textStart: 6, textEnd: 6, collapsed: true },
      { run: 1, start: 7, end: 8, textStart: 6, textEnd: 6, collapsed: true },
    ])
    const text = g.items[0]!
    if (text.kind !== 'text') throw new Error('expected a text item')
    expect(text.clusters.map(c => [c.textStart, c.textEnd, c.advance])).toEqual([[0, 1, 655360], [1, 2, 655360], [2, 3, 655360], [3, 4, 655360], [4, 5, 655360]])
    expect([layout.lines[0]!.slot, layout.lines[0]!.indented, layout.lines[0]!.align]).toEqual([FULL_WIDTH, false, 'start'])
  })

  test('DESIGN.md §2.2 example 2: pre-wrap spaces hang', () => {
    const layout = blink(paragraph([['abc      def', 'text']], 40, { whiteSpace: 'pre-wrap' }))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 9], [9, 12]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'hanging'])
    const g = layout.lines[0]!.geometry
    // Six hanging spaces: 3840 raw, all of it hangs on a wrapped line.
    expect([g.width, g.hangWidth]).toEqual([5760, 3840])
    expect(g.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1920], ['text', 1920, 3840]])
  })

  test('an RTL line ends at the content edge and starts at −hangWidth before alignment (inline_layout_algorithm.cc:303-311)', () => {
    const layout = blink(paragraph([['abc      def', 'text']], 40, { whiteSpace: 'pre-wrap', direction: 'rtl' }))
    const g = layout.lines[0]!.geometry
    const last = g.items[g.items.length - 1]!
    expect(last.x + last.inlineSize).toBe(2560)
  })

  test('the fit bound is available + 1 raw LayoutUnit (specs/blink-lines.md §1.5)', () => {
    // "aaaa bbbb" is 90px = 5760 raw. At 89.984375px the available width is 5759 raw and the bound 5760: one line.
    expect(blink(paragraph([['aaaa bbbb', 'text']], 89.984375)).lines.length).toBe(1)
    expect(blink(paragraph([['aaaa bbbb', 'text']], 89.96875)).lines.length).toBe(2)
  })

  test('pre-line forced breaks; a span of collapsed spaces makes one line without a line box, a bare one no line', () => {
    const layout = blink(paragraph([['ab\ncd', 'text']], 400, { whiteSpace: 'pre-line' }))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'forced-break'])
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1280], ['forced-break', 1280, 0]])
    expect(blink(paragraph([['   ', 'span']], 400)).lines.map(l => [l.start, l.end, l.hasLineBox])).toEqual([[0, 3, false]])
    // A bare white-space node first in the block gets no LayoutText (text.cc:319-364): no inline items, no lines.
    expect(blink(paragraph([['   ', 'text']], 400)).lines.length).toBe(0)
  })

  test('CR in pre-wrap is text in the fragments and in no item (line_breaker.cc:2988-2994)', () => {
    const layout = blink(paragraph([['ab\rcd', 'text']], 400, { whiteSpace: 'pre-wrap' }))
    expect(layout.lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 2, painted: 'ab', level: 0 },
      { kind: 'text', run: 0, start: 2, end: 3, painted: '\r', level: 0 },
      { kind: 'text', run: 0, start: 3, end: 5, painted: 'cd', level: 0 },
    ])
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1280], ['text', 1280, 1280]])
    expect(layout.lines[0]!.geometry.mapping).toEqual([{ run: 0, start: 0, end: 5, textStart: 0, textEnd: 5, collapsed: false }])
  })

  test('glyph clusters follow HarfBuzz continuations (hb-ot-shape.cc:470-546): marks, regional indicator pairs, ZWJ + pictograph', () => {
    const clusters = (text: string): number[][] => {
      const item = blink(paragraph([[text, 'text']], 400)).lines[0]!.geometry.items[0]!
      if (item.kind !== 'text') throw new Error('expected a text item')
      return item.clusters.map(c => [c.textStart, c.textEnd, c.graphemeStarts.length])
    }
    expect(clusters('ab́c')).toEqual([[0, 1, 1], [1, 3, 1], [3, 4, 1]])
    // Three regional indicators: the first two pair, the third starts a cluster.
    expect(clusters('\u{1F1EF}\u{1F1F5}\u{1F1FA}')).toEqual([[0, 4, 1], [4, 6, 1]])
    // Woman ZWJ laptop is one cluster; a ZWJ before a letter only continues the cluster before it, and a letter with a
    // ZWJ is one grapheme (GB9).
    expect(clusters('\u{1F469}‍\u{1F4BB}a‍b')).toEqual([[0, 5, 1], [5, 7, 1], [7, 8, 1]])
  })

  test('pre-wrap spaces on the last line hang only where they overflow (line_info.cc:370-381)', () => {
    // "abc   " at 40px: the line is 3840 raw, the available width 2560, so 1280 of the 1920 raw of spaces hang.
    const g = blink(paragraph([['abc   ', 'text']], 40, { whiteSpace: 'pre-wrap' })).lines[0]!.geometry
    expect([g.availableWidth, g.width, g.hangWidth]).toEqual([2560, 3840, 1280])
    // Under break-spaces nothing hangs.
    expect(blink(paragraph([['ab ', 'text']], 400, { whiteSpace: 'break-spaces' })).lines[0]!.geometry.hangWidth).toBe(0)
  })

  test('null font facts report their gaps; given facts report none', () => {
    expect(blink(paragraph([['ab', 'text']], 400)).gaps.map(g => g.gap)).toEqual([])
    expect(blink(paragraph([['ab', 'text']], 400), { ...env, devicePixelRatio: 2 }).gaps.map(g => g.gap)).toEqual(['optical-size'])
    const given = blink(paragraph([['ab', 'text']], 400, { facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }), { ...env, devicePixelRatio: 2 })
    expect(given.gaps.map(g => g.gap)).toEqual([])
    expect(blink(paragraph([['ab', 'text']], 400), { ...env, uiLanguage: null }).gaps.map(g => g.gap)).toEqual([])
    const noLang = { ...paragraph([['ab', 'text']], 400), lang: '' }
    expect(blink(noLang, { ...env, uiLanguage: null }).gaps.map(g => g.gap)).toEqual(['ui-language'])
  })
})

describe('blink inline structure', () => {
  test('box edges add to the position on the lines holding them (line_breaker.cc:3937-4025) and create box items', () => {
    // "ab cd" in a span with 10px padding at both ends, width 60: "ab" + start padding fits (640 + 1280 = 1920 raw),
    // "ab cd" + padding (640 + 3200 + 640 = 4480) doesn't fit 3840, so the break is after the space.
    const edge = { margin: 0, border: 0, padding: 10 }
    const layout = blink(tree([span([{ kind: 'text', text: 'ab cd' }], { start: edge, end: edge })], 60))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['box-start', 'text', 'trimmed'])
    expect(layout.lines[1]!.fragments.map(f => f.kind)).toEqual(['text', 'box-end'])
    expect(layout.lines[0]!.geometry.width).toBe(1920)
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 640, 1280], ['inline-box', 0, 1920]])
    expect(layout.lines[1]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1280], ['inline-box', 0, 1920]])
  })

  test('an atomic inline is one item with a break opportunity on both sides (line_breaker.cc:3043-3165)', () => {
    const atomic: InlineNode = { kind: 'atomic', width: 30, height: 10, marginInlineStart: 5, marginInlineEnd: 0 }
    const layout = blink(tree([{ kind: 'text', text: 'ab' }, atomic, { kind: 'text', text: 'cd' }], 60))
    expect(layout.lines.map(l => l.fragments.map(f => f.kind))).toEqual([['text', 'atomic'], ['text']])
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1280], ['atomic', 1600, 1920]])
  })

  test('<br> is a forced break and <wbr> a break opportunity without a character (inline_items_builder.cc:597-607, 1163-1218)', () => {
    const br = blink(tree([{ kind: 'text', text: 'ab' }, { kind: 'br' }, { kind: 'text', text: 'cd' }], 400))
    expect(br.lines.map(l => [l.start, l.end, l.fragments.map(f => f.kind)])).toEqual([[0, 2, ['text', 'br']], [2, 4, ['text']]])
    const wbr = blink(tree([{ kind: 'text', text: 'abc' }, { kind: 'wbr' }, { kind: 'text', text: 'def' }], 40))
    expect(wbr.lines.map(l => [l.start, l.end, l.fragments.map(f => f.kind)])).toEqual([[0, 3, ['text', 'wbr']], [3, 6, ['text']]])
  })

  test('text-indent starts the first formatted line\'s position (line_breaker.cc:846-879)', () => {
    const layout = blink(paragraph([['aaa bbb', 'text']], 60, { textIndent: 20 }))
    expect(layout.lines.map(l => [l.start, l.end, l.indented])).toEqual([[0, 4, true], [4, 7, false]])
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x])).toEqual([['text', 1280]])
    expect(layout.lines[0]!.geometry.textIndent).toBe(1280)
  })

  test('text-align moves the line box by LineOffsetForTextAlign (length_utils.cc:1607-1655)', () => {
    const center = blink(paragraph([['ab', 'text']], 40, { textAlign: 'center' })).lines[0]!.geometry
    expect([center.alignOffset, center.items[0]!.x, center.needsAccurateEndPosition]).toEqual([640, 640, true])
    const end = blink(paragraph([['ab', 'text']], 40, { textAlign: 'end' })).lines[0]!.geometry
    expect(end.alignOffset).toBe(1280)
  })

  test('an indent that overflows a narrowed first slot ends one empty line, then the line moves below the floats (line_breaker.cc:4225-4248)', () => {
    // Case c-0262c91b5a593353's shape: the first slot leaves 4px, the indent is 10px. Only the line that places the leading
    // floats rewinds the indent; the next start carries afterLeadingFloats, so the same slot refuses the line.
    const layout = blink(paragraph([['aaaa bbbb', 'text']], 100, { whiteSpace: 'pre-wrap', textIndent: 10 }), env, [{ left: 96, right: 0 }, { left: 20, right: 0 }])
    expect(layout.lines[0]!.hasLineBox).toBe(false)
    expect(layout.belowFloats).toEqual([0])
    expect(layout.lines.slice(1).map(l => [l.start, l.end, l.slot.left, l.indented])).toEqual([[0, 5, 20, true], [5, 9, 0, false]])
  })

  test('border widths: the zoomed px floored, at least one px when positive (style_builder_converter.cc:1953-1990)', () => {
    const edge = (border: number): number => {
      const layout = blink(tree([span([{ kind: 'text', text: 'ab' }], { start: { margin: 0, border, padding: 0 } })], 400), { ...env, devicePixelRatio: 2 })
      return layout.lines[0]!.geometry.width - 2 * 640 * 2
    }
    expect([edge(0.4), edge(1.3), edge(2)]).toEqual([64, 128, 256])
  })

  test('box edges in an RTL paragraph go on the line-right side of the span (inline_box_state.cc:548-630)', () => {
    const edge = { margin: 0, border: 0, padding: 10 }
    const layout = blink(tree([span([{ kind: 'text', text: 'ab' }], { start: edge })], 60, { direction: 'rtl' }))
    const g = layout.lines[0]!.geometry
    // The line is 640 of start padding + 1280 of text, right-aligned in 3840: the text sits left of the padding.
    expect(g.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 1920, 1280], ['inline-box', 1920, 1920]])
  })

  test('justify expands the spaces of a wrapped line to the available width (justification_utils.cc:237-310)', () => {
    const layout = blink(paragraph([['aaa bbb ccc', 'text']], 90, { textAlign: 'justify' }))
    expect(layout.lines.map(l => [l.start, l.end, l.align])).toEqual([[0, 8, 'justify'], [8, 11, 'start']])
    const g = layout.lines[0]!.geometry
    expect([g.alignOffset, g.items.map(i => [i.kind, i.x, i.inlineSize])]).toEqual([0, [['text', 0, 5760]]])
  })

  test('a slot narrows the opportunity; a line that overflows it moves below the floats (inline_layout_algorithm.cc:1341-1367)', () => {
    const layout = blink(paragraph([['abcd ef', 'text']], 60), env, [{ left: 30, right: 0 }, { left: 20, right: 0 }])
    // Row 0 is 30px wide, "abcd" (40px) overflows it: below-floats. Row 1 is 40px: "abcd" fits.
    expect(layout.belowFloats).toEqual([0])
    expect(layout.lines.map(l => [l.start, l.end, l.slot.left, l.geometry.lineLeft])).toEqual([[0, 5, 20, 1280], [5, 7, 0, 0]])
  })

  test('a view edge inside a grapheme at a unit HarfBuzz may start a cluster at reports glyph-clusters (hb-ot-layout-gsubgpos.hh:1500-1510)', () => {
    // U+0600 (bidi AN) and U+3000 are one grapheme (GB9b) in two bidi runs, so an item edge falls inside the grapheme.
    const gapsOf = (text: string): string[] => blink(paragraph([[text, 'text']], 400)).lines.flatMap(l => l.gaps.map(g => g.gap))
    expect(gapsOf('a؀　b')).toContain('glyph-clusters')
    expect(gapsOf('a b')).not.toContain('glyph-clusters')
  })

  test('an RTL view joining a reshaped line start and the rest numbers its parts in visual order, so cutting off the trailing space leaves no glyph (shape_result_view.cc:215-308)', () => {
    // Class 3 in specs/blink-RESULTS.md: line 1 starts at a joining letter, ShapeToEnd joins the reshaped [1, 2) and the
    // item's [2, 3), and TruncateLineEndResult's view [1, 2) finds no part numbered there.
    const base = paragraph([['بب ', 'text'], ['بب', 'span']], 1, { facts: { ...UNKNOWN_FONT_FACTS, joining: 'opentype' } })
    const p: Paragraph = { ...base, wordBreak: 'break-all', content: base.content.map(n => n.kind === 'span' ? { ...n, wordBreak: 'break-all' } : n) }
    const lines = blink(p).lines
    expect(lines.map(l => [l.start, l.end])).toEqual([[0, 1], [1, 3], [3, 4], [4, 5]])
    expect(lines.map(l => l.geometry.width > 0)).toEqual([true, false, true, true])
  })
})

describe('blink round 2', () => {
  test('justify expands before and after CJK ideographs in 16-bit text (justification_opportunity.cc:105-120)', () => {
    // Four ideographs at 10px in 35px: line 0 holds three and expands by 5px over two opportunities (after each but the
    // last); nothing throws.
    const layout = blink(paragraph([['中中中中', 'text']], 35, { textAlign: 'justify' }))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 4]])
    const item = layout.lines[0]!.geometry.items[0]!
    if (item.kind !== 'text') throw new Error('expected a text item')
    expect(item.inlineSize).toBe(2240)
    expect(item.clusters.map(c => c.advance)).toEqual([655360 + 163840, 655360 + 163840, 655360])
  })

  test('with tab-size 0 and letter spacing, tabs stop at multiples of the letter spacing (font.cc:303-340)', () => {
    const base = paragraph([['ab\tc', 'text']], 400, { whiteSpace: 'pre-wrap' })
    const p: Paragraph = { ...base, letterSpacing: 2, tabSize: 0 }
    const tab = blink(p).lines[0]!.geometry.items.find(i => i.kind === 'tab')!
    // The stand-in Canvas gives "ab" 20px whatever the spacing: 20 is a multiple of 2, the distance 2 is under half a space
    // (5px), so the tab takes one more stop: 4px.
    expect(tab.inlineSize).toBe(256)
  })

  test('NeedsAccurateEndPosition reads the base direction before it is set: left never, right always (line_breaker.cc:811-871)', () => {
    const accurate = (align: Paragraph['textAlign'], direction: Paragraph['direction']): boolean =>
      blink(paragraph([['ab cd', 'text']], 400, { textAlign: align, direction })).lines[0]!.geometry.needsAccurateEndPosition
    expect([accurate('left', 'ltr'), accurate('left', 'rtl'), accurate('right', 'ltr'), accurate('right', 'rtl')]).toEqual([false, false, true, true])
    expect([accurate('start', 'rtl'), accurate('center', 'ltr')]).toEqual([false, true])
  })

  test('a pair adjustment sits on the first glyph, or kern >> 1 on it under the pair machine (hb-kern.hh:102-106)', () => {
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Kerned {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        let n = 0
        for (const c of text) if (c !== '\u200d' && c !== '\u200b') n++
        return { width: n * 10 - (text.includes('AV') ? 2 : 0), actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Kerned { return new Kerned() } }
    try {
      const advances = (pairKerning: FontFacts['pairKerning']): number[] => {
        const item = blink(paragraph([['AV', 'text']], 400, { facts: { ...UNKNOWN_FONT_FACTS, pairKerning } })).lines[0]!.geometry.items[0]!
        if (item.kind !== 'text') throw new Error('expected a text item')
        return item.clusters.map(c => c.advance)
      }
      expect(advances('first-advance')).toEqual([655360 - 131072, 655360])
      expect(advances('split')).toEqual([655360 - 65536, 655360 - 65536])
    } finally {
      ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
    }
  })

  test('a ligature in the word the break decision measured past the line end reports glyph-clusters on the line', () => {
    // The stand-in ligates `fi` to one 10px glyph unless letter spacing turns ligatures off (font_features.cc:54-86), so
    // the pair window f|i adjusts by −10px with ligatures and by 0 without: positions inside the ligature glyph are the
    // glyph's (shape_result.cc:2113-2200), which the decision over `fi` used.
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Ligating {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        let n = 0
        for (const c of text) if (c !== '‍' && c !== '​') n++
        const ligatures = this.letterSpacing === '0px' ? text.split('fi').length - 1 : 0
        return { width: (n - ligatures) * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Ligating { return new Ligating() } }
    try {
      const firstLineGaps = (text: string): string[] => blink(paragraph([[text, 'text']], 35)).lines[0]!.gaps.map(g => g.gap)
      expect(firstLineGaps('ab fi')).toContain('glyph-clusters')
      expect(firstLineGaps('ab gh')).not.toContain('glyph-clusters')
    } finally {
      ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
    }
  })

  test('a view takes the glyph clusters that start in its range, so an item edge inside a cluster gives it to the earlier item (glyph_data_range.cc:56-90)', () => {
    // U+0301 continues U+3000's HarfBuzz cluster across the text node edge: the first item holds a and the whole cluster.
    const items = blink(paragraph([['a\u3000', 'span'], ['\u0301b', 'span']], 400)).lines[0]!.geometry.items.filter(i => i.kind === 'text')
    expect(items.map(i => i.inlineSize)).toEqual([1920, 640])
  })

  test('content conditions carry the source range they concern (DESIGN.md §2.8)', () => {
    const gaps = blink(paragraph([['a\vb', 'text']], 400)).gaps
    expect(gaps.filter(g => g.gap === 'control-character-width').map(g => g.at)).toEqual([{ start: 1, end: 2 }])
  })
})

describe('blink round 4', () => {
  // A stand-in Canvas: 10px per code point at any size, less `kern` px for every occurrence of each listed pair.
  const withPairs = (pairs: Record<string, number>, run: () => void): void => {
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Kerned {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        let width = 0
        for (const c of text) if (c !== '\u200d' && c !== '\u200b' && c !== '\u2060') width += 10
        for (const pair of Object.keys(pairs)) width -= (text.split(pair).length - 1) * pairs[pair]!
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Kerned { return new Kerned() } }
    try { run() } finally { (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved }
  }
  const listed = (coverage: number[]): FontFacts => ({
    ...UNKNOWN_FONT_FACTS, pairKerning: 'split',
    fonts: [{ family: 'Mono', realizes: true, coverage, ligatures: null, spacingInputs: null, scriptLookups: null }],
  })
  const textItems = (line: BlinkLine): Extract<BlinkLine['geometry']['items'][number], { kind: 'text' }>[] =>
    line.geometry.items.filter((i): i is Extract<BlinkLine['geometry']['items'][number], { kind: 'text' }> => i.kind === 'text')

  test('U+3000 in a font without it goes to a fallback font: the letter after it keeps the whole adjustment and starts a run (harfbuzz_shaper.cc:598-606)', () => {
    withPairs({ '\u3000T': 2 }, () => {
      // The font maps ASCII only. U+3000 is one em and hangs; `T` keeps both px of what Canvas shows beside it, and the
      // wrapped line starts at a run's first glyph, so it isn't reshaped.
      const lines = blink(paragraph([['ab\u3000Tc', 'text']], 25, { facts: listed([0x20, 0x7e]) })).lines
      expect(lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
      expect(textItems(lines[0]!).map(i => i.inlineSize)).toEqual([1280, 640])
      const second = textItems(lines[1]!)[0]!
      expect(second.clusters.map(c => c.advance)).toEqual([655360 - 131072, 655360])
      expect(second.runs).toEqual([{ textStart: 3, textEnd: 5, reshaped: null, fontsKnown: true }])
      expect(lines[1]!.gaps.map(g => g.gap)).toEqual([])
      // A font that maps U+3000 kerns it like any glyph: the pair machine leaves half on U+3000, and the start is reshaped.
      const own = blink(paragraph([['ab\u3000Tc', 'text']], 25, { facts: listed([0x20, 0x7e, 0x3000, 0x3000]) })).lines
      expect(textItems(own[0]!).map(i => i.inlineSize)).toEqual([1280, 640 - 64])
      expect(textItems(own[1]!)[0]!.runs[0]!.reshaped).toEqual({ textStart: 3, textEnd: 4 })
      // Without a coverage fact the line edges beside U+3000 report font-fallback.
      const unknown = blink(paragraph([['ab\u3000Tc', 'text']], 25, { facts: { ...UNKNOWN_FONT_FACTS, pairKerning: 'split' } })).lines
      expect(unknown[1]!.gaps.map(g => g.gap)).toContain('font-fallback')
    })
  })

  test('a pair adjustment in an RTL run of a left-to-right script sits on the logically later cluster (hb-ot-shape.cc:588-644)', () => {
    withPairs({ '\u2018\u2018': 2 }, () => {
      // Quotes in an RTL paragraph are an RTL run of Common text: HarfBuzz reverses the buffer and shapes it left to right.
      const advances = (direction: Paragraph['direction']): number[] =>
        textItems(blink(paragraph([['\u2018\u2018', 'text']], 400, { direction, facts: { ...UNKNOWN_FONT_FACTS, pairKerning: 'first-advance' } })).lines[0]!)[0]!.clusters.map(c => c.advance)
      expect(advances('ltr')).toEqual([655360 - 131072, 655360])
      expect(advances('rtl')).toEqual([655360, 655360 - 131072])
    })
  })

  test('a line-end fit test that another last safe offset turns around reports in-word-prefix over the text it decides (shaping_line_breaker.cc:543-553)', () => {
    // Letters of 665.3 LayoutUnits and a kern between `c` and `d`. The line has 1996 units. The candidate is offset 3, which
    // the kern makes unsafe, so the port reshapes `c` after offset 2's ceiled position, 1331: 665.3 units in 665 don't fit, and
    // the line ends at 2. If HarfBuzz flags offset 2 as well, Blink reshapes `abc` from the line's start, 1995.9 units, which
    // fit.
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Fine {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        return { width: ([...text].length * 681267 - (text.split('cd').length - 1) * 65536) / 65536, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Fine { return new Fine() } }
    try {
      const base = paragraph([['abcdef', 'text']], 31.171875, { facts: { ...UNKNOWN_FONT_FACTS, pairKerning: 'first-advance' } })
      const lines = blink({ ...base, overflowWrap: 'break-word' }).lines
      expect([lines[0]!.start, lines[0]!.end]).toEqual([0, 2])
      expect(lines[0]!.gaps.filter(g => g.gap === 'in-word-prefix').map(g => g.at)).toEqual([{ start: 2, end: 3 }])
    } finally {
      ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
    }
  })
})

describe('blink round 4b', () => {
  test('a box that reordering splits on a line keeps its line-left edge on the first fragment and moves the line-right one to the last (inline_box_state.h:328-332)', () => {
    // An RTL block of LTR text: the pre-wrap span's hanging space takes the block's level and goes to the line's left, so the
    // span has two box fragments on line 0. Each has one 4px padding; c-7d2264227b2141ba natively.
    const pad: BoxEdge = { margin: 0, border: 0, padding: 4 }
    const p = tree([{ kind: 'text', text: 'xx aaaa ' }, span([{ kind: 'text', text: 'bbbb cccc ' }], { start: pad, end: pad, whiteSpace: 'pre-wrap' }), { kind: 'text', text: 'dddd eeee' }], 190, { direction: 'rtl', whiteSpace: 'nowrap' })
    const items = blink(p).lines[0]!.geometry.items
    const boxes = items.filter(i => i.kind === 'inline-box')
    expect(boxes.map(b => b.inlineSize).sort((a, b) => a - b)).toEqual([640 + 256, 9 * 640 + 256])
    // The text fragment has no padding on its left: the letters start at the box's left edge.
    const letters = items.find(i => i.kind === 'text' && i.textStart === 8)!
    expect(boxes.some(b => b.x === letters.x && b.inlineSize === 9 * 640 + 256)).toBe(true)
  })

  test('a font measured at the CSS size scales by the ratio of the two platform font sizes (font_description.cc:271-282)', () => {
    // A stand-in Canvas whose advances follow the platform font size as Blink floors it: 16.8px is a 16.79px font.
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Floored {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        const size = Math.fround(parseFloat(/([\d.]+)px/.exec(this.font)![1]!))
        const effective = Math.fround(Math.floor(Math.fround(size * 100)) / 100)
        return { width: Math.round([...text].length * effective * 0.625 * 65536) / 65536, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Floored { return new Floored() } }
    try {
      const at = (size: number): { size: number; gaps: Gap[] } => {
        const base = paragraph([['abcd', 'text']], 400, { facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: true } })
        const font = { ...base.font, size }
        const layout = blink({ ...base, font }, { ...env, devicePixelRatio: 2 })
        const item = layout.lines[0]!.geometry.items[0]!
        return { size: item.inlineSize, gaps: layout.gaps }
      }
      // The DOM's font is 33.59px: four letters of 0.625 em are 83.975px, 5375 units. Twice the 16.79px font's width is 5373.
      expect(at(16.8).size).toBe(5375)
      // 13.33px is 13.33px and 26.66px, and 16px is 16px and 32px: the ratio is the zoom.
      expect(at(13.33).size).toBe(Math.ceil(4 * 0.625 * 26.66 * 64))
      expect(at(16).size).toBe(5120)
      // The scaled advances are stand-ins over the text; the renderer's font cache concerns no text range.
      const gaps = at(16.8).gaps
      expect(gaps.map(g => [g.gap, g.at])).toEqual([['optical-size', { start: 0, end: 4 }], ['page-history', undefined]])
    } finally {
      ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
    }
  })

  test('a pair adjustment inside a line whose side no fact gives is reported over its two clusters (hb-kern.hh:102-106)', () => {
    const saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    class Kerned {
      font = '16px x'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        let width = 0
        for (const c of text) if (c !== '‍' && c !== '​' && c !== '⁠') width += 10
        return { width: width - (text.split('AV').length - 1) * 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
      }
    }
    ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Kerned { return new Kerned() } }
    try {
      const gapsWith = (pairKerning: FontFacts['pairKerning']): (Gap['at'])[] =>
        blink(paragraph([['xAVx', 'text']], 400, { facts: { ...UNKNOWN_FONT_FACTS, pairKerning } })).lines[0]!.gaps.filter(g => g.gap === 'unsafe-to-break').map(g => g.at)
      expect(gapsWith(null)).toEqual([{ start: 1, end: 3 }])
      expect(gapsWith('split')).toEqual([])
      expect(gapsWith('first-advance')).toEqual([])
    } finally {
      ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
    }
  })
})

describe('blink round 4c', () => {
  test('justify ends before preserved trailing spaces that lie across a box end (line_info.cc:289-415)', () => {
    // A pre-wrap block at 150px: line 0 is `aa bb cc`, three spaces inside the span, its 6px end padding and three spaces
    // after it, 146px. The spaces inside the span fit, so they stay in the item result of `cc   `; the ones after it are
    // the trailing item result. ComputeTrailingSpaceWidth's walk skips the close tag and stops inside `cc   `: 60px hang,
    // and EndOffsetForJustify is the end of `cc`. The 64px of free space (150 − (146 − 60)) goes to the two spaces of
    // `aa bb `, 32px each, and none to the spaces inside the span.
    const pad: BoxEdge = { margin: 0, border: 0, padding: 6 }
    const p = tree([{ kind: 'text', text: 'aa bb ' }, span([{ kind: 'text', text: 'cc   ' }], { end: pad, whiteSpace: 'pre-wrap' }), { kind: 'text', text: '   dd ee' }], 150, { whiteSpace: 'pre-wrap', textAlign: 'justify' })
    const layout = blink(p)
    expect(layout.lines.map(l => [l.start, l.end, l.align])).toEqual([[0, 14, 'justify'], [14, 19, 'start']])
    const g = layout.lines[0]!.geometry
    expect(g.hangWidth).toBe(60 * 64)
    const texts = g.items.filter(i => i.kind === 'text').map(i => [i.textStart, i.x, i.inlineSize])
    // The spaces after the span are two items: a break opportunity is generated after a leading preserved space.
    expect(texts).toEqual([[0, 0, 124 * 64], [6, 124 * 64, 50 * 64], [11, 180 * 64, 10 * 64], [12, 190 * 64, 20 * 64]])
  })
})

describe('blink string storage', () => {
  // Every string asked, with the partition of its context.
  function asks(p: Paragraph): { partition: string; text: string }[] {
    const measurer = createMeasurer()
    const prepared = blinkEngine.prepare(p, env, measurer)
    for (let start = blinkEngine.firstLine(prepared); start !== null;) {
      const result = blinkEngine.nextLine(prepared, start, FULL_WIDTH, measurer)
      if (result.kind === 'below-floats') throw new Error('no floats here')
      start = result.line.next
    }
    return measurer.log.calls.map(call => ({ partition: measurer.log.contexts[call.context]!.partition, text: call.text }))
  }
  const latin1 = (text: string): boolean => /^[ -ÿ]*$/.test(text)
  const RUN = '((((((((((((('
  const ARABIC = 'عربي'

  test('a segmented paragraph asks its one-byte and its two-byte strings on contexts of their own', () => {
    // The brackets after the Arabic word are shaped under Arabic and asked as a two-byte slice; the same characters after
    // `abc` are shaped under Latin and asked as a one-byte string (canvasString).
    for (const width of [2000, 140]) {
      const all = asks(paragraph([[`${ARABIC}${RUN}abc${RUN}def`, 'text']], width))
      const oneByte = all.filter(a => a.partition === '8bit')
      const twoByte = all.filter(a => a.partition === '16bit')
      expect(oneByte.length + twoByte.length).toBe(all.length)
      expect(oneByte.some(a => a.text === RUN)).toBe(true)
      expect(twoByte.some(a => a.text === RUN)).toBe(true)
      // One-byte contexts hold Latin-1 alone; a Latin-1-only string on a two-byte context is a slice of 13 units or more.
      expect(oneByte.every(a => latin1(a.text))).toBe(true)
      expect(twoByte.every(a => !latin1(a.text) || a.text.length >= 13)).toBe(true)
    }
  })

  test('an unsegmented paragraph keeps one set of contexts', () => {
    const all = asks(paragraph([[`abc ${RUN} def ${RUN}`, 'text']], 2000))
    expect(new Set(all.map(a => a.partition))).toEqual(new Set(['8bit']))
  })

  test('a text node that holds U+FFFC is 16-bit content, an atomic inline isn\'t (inline_items_builder.cc:725, 1258)', () => {
    const measurer = createMeasurer()
    expect(blinkEngine.prepare(paragraph([['abc', 'text'], ['￼', 'span']], 2000), env, measurer).segmented).toBe(true)
    expect(blinkEngine.prepare(paragraph([['abc', 'text']], 2000), env, measurer).segmented).toBe(false)
  })
})
