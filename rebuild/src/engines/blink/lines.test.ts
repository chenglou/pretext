// Line filling and fragments on DESIGN.md §2.2's worked examples, with a stand-in Canvas whose every code point is 10px
// wide at 16px (bun has no OffscreenCanvas; the lab measures in Chrome).
import { beforeAll, describe, expect, test } from 'bun:test'
import { BLINK, type Environment } from '../../env.js'
import { layoutParagraph } from '../../index.js'
import type { Paragraph, TextRun } from '../../model.js'

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

const font = { family: 'Mono', size: 16, weight: 400, style: 'normal' as const }
const env: Environment = {
  engine: BLINK, devicePixelRatio: 1, pageZoom: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en', preferredLanguages: ['en'],
  dictionaryBreaks: { kind: 'unavailable' },
}

function paragraph(runs: [string, TextRun['node']][], width: number, whiteSpace: Paragraph['whiteSpace'] = 'normal'): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font, letterSpacing: 0, wordSpacing: 0, lang: null })), font, letterSpacing: 0, wordSpacing: 0,
    width, lineHeight: 20, whiteSpace, wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en',
  }
}

describe('blink lines', () => {
  test('DESIGN.md §2.2 example 1: trimmed and collapsed spaces at a break', () => {
    const layout = layoutParagraph(paragraph([['Hello  ', 'span'], [' ', 'text'], ['world', 'span']], 60), env)
    expect(layout.lines.map(l => [l.start, l.end, l.width])).toEqual([[0, 8, 50], [8, 13, 50]])
    expect(layout.lines[0]!.fragments).toEqual([
      { kind: 'text', run: 0, start: 0, end: 5, painted: 'Hello', width: 50, level: 0 },
      { kind: 'trimmed', run: 0, start: 5, end: 6, painted: ' ', level: 0 },
      { kind: 'collapsed', run: 0, start: 6, end: 7 },
      { kind: 'collapsed', run: 1, start: 7, end: 8 },
    ])
    expect(layout.lines[0]!.engineWidth).toEqual({ unit: 'blink-layout-unit', raw: 3200, layoutZoom: 1 })
  })

  test('DESIGN.md §2.2 example 2: pre-wrap spaces hang', () => {
    const layout = layoutParagraph(paragraph([['abc      def', 'text']], 40, 'pre-wrap'), env)
    expect(layout.lines.map(l => [l.start, l.end, l.width])).toEqual([[0, 9, 30], [9, 12, 30]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'hanging'])
  })

  test('the fit bound is available + 1 raw LayoutUnit (specs/blink-lines.md §1.5)', () => {
    // "aaaa bbbb" is 90px = 5760 raw. At 89.984375px the available width is 5759 raw and the bound 5760: one line.
    expect(layoutParagraph(paragraph([['aaaa bbbb', 'text']], 89.984375), env).lines.length).toBe(1)
    expect(layoutParagraph(paragraph([['aaaa bbbb', 'text']], 89.96875), env).lines.length).toBe(2)
  })

  test('pre-line forced breaks and an empty paragraph', () => {
    const layout = layoutParagraph(paragraph([['ab\ncd', 'text']], 400, 'pre-line'), env)
    expect(layout.lines.map(l => [l.start, l.end])).toEqual([[0, 3], [3, 5]])
    expect(layout.lines[0]!.fragments.map(f => f.kind)).toEqual(['text', 'forced-break'])
    expect(layoutParagraph(paragraph([['   ', 'text']], 400), env).lines.length).toBe(0)
  })
})
