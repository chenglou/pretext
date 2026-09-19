// text_content and items on the specs' worked examples (specs/blink-text.md §2.C, DESIGN.md §2.2 example 1).
import { describe, expect, test } from 'bun:test'
import { indexContent } from '../../content.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../model.js'
import { buildContent, segmentBidiRuns, stylesOf, type Content } from './content.js'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }

function paragraph(runs: [string, 'span' | 'text'][], whiteSpace: Paragraph['whiteSpace'] = 'normal', direction: Paragraph['direction'] = 'ltr'): Paragraph {
  const style = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace, wordBreak: 'normal' as const, overflowWrap: 'normal' as const, lineBreak: 'auto' as const, tabSize: 8 }
  const content: InlineNode[] = runs.map(([text, node]) => node === 'text'
    ? { kind: 'text', text }
    : { ...style, kind: 'span', lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text }] })
  return { ...style, content, lineHeight: 20, direction, lang: 'en', textIndent: 0, textAlign: 'start' }
}

function content(p: Paragraph): Content {
  const index = indexContent(p)
  const s = stylesOf(p, index, 1)
  return buildContent(index, s.styles, s.styleOfLeaf, s.styleOfElement, () => false)
}

describe('blink content', () => {
  test('collapse examples (specs/blink-text.md §2.C.4)', () => {
    expect(content(paragraph([['  a \n\t b  ', 'text']])).text).toBe('a b')
    expect(content(paragraph([['a\rb', 'text']])).text).toBe('a b')
    expect(content(paragraph([['a\fb', 'text']])).text).toBe('a\fb')
    expect(content(paragraph([['a​\nb', 'text']])).text).toBe('a​b')
  })

  test('DESIGN.md example 1: spans and a bare space', () => {
    const c = content(paragraph([['Hello  ', 'span'], [' ', 'text'], ['world', 'span']]))
    expect(c.text).toBe('Hello world')
    expect(Array.from(c.sourceOffsets)).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12])
    expect(c.items.map(i => `${i.type}[${i.start},${i.end})`)).toEqual([
      'open-tag[0,0)', 'text[0,6)', 'close-tag[6,6)', 'text[6,6)', 'open-tag[6,6)', 'text[6,11)', 'close-tag[11,11)',
    ])
  })

  test('a bare white-space node first in the block gets no LayoutText (text.cc:319-364)', () => {
    const c = content(paragraph([[' ', 'text'], ['a', 'span']]))
    expect(c.text).toBe('a')
    expect(c.items.map(i => i.type)).toEqual(['open-tag', 'text', 'close-tag'])
  })

  test('pre-wrap: leading spaces get a generated break opportunity; controls split items', () => {
    const c = content(paragraph([['  a\tb\nc\rd', 'text']], 'pre-wrap'))
    expect(c.text).toBe('  ​a\tb\nc\rd')
    expect(c.items.map(i => `${i.type}:${i.control}`)).toEqual([
      'text:none', 'control:generated-zwsp', 'text:none', 'control:tab', 'text:none', 'control:forced-break', 'text:none', 'control:cr-ff', 'text:none',
    ])
  })

  test('pre-line removes the space before a newline', () => {
    const c = content(paragraph([['a  \n  b', 'text']], 'pre-line'))
    expect(c.text).toBe('a\nb')
  })

  test('a nowrap space collapsing a wrapping space run leaves a generated break opportunity (inline_items_builder.cc:847-866)', () => {
    const p = paragraph([['a ', 'span'], [' b', 'span']])
    const first = p.content[0]!
    if (first.kind !== 'span') throw new Error('expected a span')
    first.whiteSpace = 'nowrap'
    const c = content(p)
    expect(c.text).toBe('a ​b')
    expect(c.items.map(i => `${i.type}:${i.control}`)).toEqual([
      'open-tag:none', 'text:none', 'close-tag:none', 'open-tag:none', 'control:generated-zwsp', 'text:none', 'close-tag:none',
    ])
  })

  test('atomic inlines, <br> and <wbr> add U+FFFC, LF and U+200B without source units', () => {
    const p = paragraph([['a ', 'text']])
    p.content.push({ kind: 'atomic', width: 10, height: 10, marginInlineStart: 0, marginInlineEnd: 0 }, { kind: 'br' }, { kind: 'text', text: ' b' }, { kind: 'wbr' }, { kind: 'text', text: 'c' })
    const c = content(p)
    // The space after "a" is restored before the atomic inline; the leading space after <br> collapses.
    expect(c.text).toBe('a \u{FFFC}\nb​c')
    expect(Array.from(c.sourceOffsets)).toEqual([0, 1, -1, -1, 3, -1, 4])
    expect(c.items.map(i => `${i.type}:${i.control}:${i.element}`)).toEqual([
      'text:none:-1', 'atomic:none:0', 'control:forced-break:1', 'text:none:-1', 'control:wbr:2', 'text:none:-1',
    ])
  })

  test('D5: text that ICU calls LTR and not mixed turns bidi off (specs/bidi.md §7.5)', () => {
    const p = paragraph([['abc٣٤', 'text']])
    expect(segmentBidiRuns(p, content(p)).enabled).toBe(false)
    const q = paragraph([['abc אב', 'text']])
    const r = segmentBidiRuns(q, content(q))
    expect(r.enabled).toBe(true)
    expect(r.items.map(i => `${i.start}-${i.end}:${i.bidiLevel}`)).toEqual(['0-4:0', '4-6:1'])
  })
})
