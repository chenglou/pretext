// Line filling, fragments and geometry on DESIGN.md §2.2's worked examples, with a stand-in Canvas whose every code point
// is 10px wide at 16px (bun has no OffscreenCanvas; the lab measures in Chrome). At layout zoom 1 a 10px advance is
// 640 raw LayoutUnits.
import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createMeasurer } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type BlinkLine, type FontFacts, type Gap, type Paragraph, type TextRun } from '../../model.js'
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

function paragraph(runs: [string, TextRun['node']][], width: number, whiteSpace: Paragraph['whiteSpace'] = 'normal', direction: Paragraph['direction'] = 'ltr', facts: FontFacts = UNKNOWN_FONT_FACTS): Paragraph {
  const font = { family: 'Mono', size: 16, weight: 400, style: 'normal' as const, facts }
  return {
    runs: runs.map(([text, node]) => ({ text, node, font, letterSpacing: 0, wordSpacing: 0, lang: null })), font, letterSpacing: 0, wordSpacing: 0,
    width, lineHeight: 20, whiteSpace, wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction, lang: 'en',
  }
}

// The line loop of src/index.ts over the Blink engine alone.
function blink(p: Paragraph, e: BlinkEnvironment = env): { lines: BlinkLine[]; gaps: Gap[] } {
  const measurer = createMeasurer()
  const prepared = blinkEngine.prepare(p, e, measurer)
  const lines: BlinkLine[] = []
  for (let start = blinkEngine.firstLine(prepared); start !== null;) {
    const line = blinkEngine.nextLine(prepared, start, p.width, measurer)
    lines.push(line)
    start = line.next
  }
  return { lines, gaps: blinkEngine.gaps(prepared) }
}

describe('blink lines', () => {
  test('DESIGN.md §2.2 example 1: trimmed and collapsed spaces at a break', () => {
    const layout = blink(paragraph([['Hello  ', 'span'], [' ', 'text'], ['world', 'span']], 60))
    expect(layout.lines.map(l => [l.start, l.end, l.hasLineBox])).toEqual([[0, 8, true], [8, 13, true]])
    expect(layout.lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 5, painted: 'Hello', level: 0 },
      { kind: 'trimmed', run: 0, start: 5, end: 6, painted: ' ', level: 0 },
      { kind: 'collapsed', run: 0, start: 6, end: 7 },
      { kind: 'collapsed', run: 1, start: 7, end: 8 },
    ])
    const g = layout.lines[0]!.geometry
    expect([g.availableWidth, g.width, g.hangWidth]).toEqual([3840, 3200, 0])
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
  })

  test('DESIGN.md §2.2 example 2: pre-wrap spaces hang', () => {
    const layout = blink(paragraph([['abc      def', 'text']], 40, 'pre-wrap'))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 9], [9, 12]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'hanging'])
    const g = layout.lines[0]!.geometry
    // Six hanging spaces: 3840 raw, all of it hangs on a wrapped line.
    expect([g.width, g.hangWidth]).toEqual([5760, 3840])
    expect(g.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1920], ['text', 1920, 3840]])
  })

  test('an RTL line ends at the content edge and starts at −hangWidth before alignment (inline_layout_algorithm.cc:303-311)', () => {
    const layout = blink(paragraph([['abc      def', 'text']], 40, 'pre-wrap', 'rtl'))
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
    const layout = blink(paragraph([['ab\ncd', 'text']], 400, 'pre-line'))
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'forced-break'])
    expect(layout.lines[0]!.geometry.items.map(i => [i.kind, i.x, i.inlineSize])).toEqual([['text', 0, 1280], ['forced-break', 1280, 0]])
    expect(blink(paragraph([['   ', 'span']], 400)).lines.map(l => [l.start, l.end, l.hasLineBox])).toEqual([[0, 3, false]])
    // A bare white-space node first in the block gets no LayoutText (text.cc:319-364): no inline items, no lines.
    expect(blink(paragraph([['   ', 'text']], 400)).lines.length).toBe(0)
  })

  test('CR in pre-wrap is text in the fragments and in no item (line_breaker.cc:2988-2994)', () => {
    const layout = blink(paragraph([['ab\rcd', 'text']], 400, 'pre-wrap'))
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
    const g = blink(paragraph([['abc   ', 'text']], 40, 'pre-wrap')).lines[0]!.geometry
    expect([g.availableWidth, g.width, g.hangWidth]).toEqual([2560, 3840, 1280])
    // Under break-spaces nothing hangs.
    expect(blink(paragraph([['ab ', 'text']], 400, 'break-spaces')).lines[0]!.geometry.hangWidth).toBe(0)
  })

  test('null font facts report their gaps; given facts report none', () => {
    expect(blink(paragraph([['ab', 'text']], 400)).gaps.map(g => g.gap)).toEqual([])
    expect(blink(paragraph([['ab', 'text']], 400), { ...env, devicePixelRatio: 2 }).gaps.map(g => g.gap)).toEqual(['optical-size'])
    const given = blink(paragraph([['ab', 'text']], 400, 'normal', 'ltr', { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false }), { ...env, devicePixelRatio: 2 })
    expect(given.gaps.map(g => g.gap)).toEqual([])
    expect(blink(paragraph([['ab', 'text']], 400), { ...env, uiLanguage: null }).gaps.map(g => g.gap)).toEqual([])
    const noLang = { ...paragraph([['ab', 'text']], 400), lang: '' }
    expect(blink(noLang, { ...env, uiLanguage: null }).gaps.map(g => g.gap)).toEqual(['ui-language'])
  })
})
