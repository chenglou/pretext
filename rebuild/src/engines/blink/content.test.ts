// text_content and items on the specs' worked examples (specs/blink-text.md §2.C, DESIGN.md §2.2 example 1).
import { describe, expect, test } from 'bun:test'
import type { Paragraph, TextRun } from '../../model.js'
import { buildContent, segmentBidiRuns, styles } from './content.js'

const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const }

function paragraph(runs: [string, TextRun['node']][], whiteSpace: Paragraph['whiteSpace'] = 'normal', direction: Paragraph['direction'] = 'ltr'): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font, letterSpacing: 0, wordSpacing: 0, lang: null })), font, letterSpacing: 0, wordSpacing: 0,
    width: 60, lineHeight: 20, whiteSpace, wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction, lang: 'en',
  }
}

function content(p: Paragraph): ReturnType<typeof buildContent> {
  return buildContent(p, styles(p).styleOfRun)
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

  test('D5: text that ICU calls LTR and not mixed turns bidi off (specs/bidi.md §7.5)', () => {
    const p = paragraph([['abc٣٤', 'text']])
    expect(segmentBidiRuns(p, content(p)).enabled).toBe(false)
    const q = paragraph([['abc אב', 'text']])
    const r = segmentBidiRuns(q, content(q))
    expect(r.enabled).toBe(true)
    expect(r.items.map(i => `${i.start}-${i.end}:${i.bidiLevel}`)).toEqual(['0-4:0', '4-6:1'])
  })
})
