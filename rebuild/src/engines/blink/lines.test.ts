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

  test('glyph clusters follow HarfBuzz continuations (hb-ot-shape.cc:466-522): marks, regional indicator pairs, ZWJ + pictograph', () => {
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
