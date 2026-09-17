import { describe, expect, test } from 'bun:test'
import { indexContent, langUnder, styleUnder } from './content.js'
import { NO_BOX_EDGE, type CssFont, type InlineElementOf, type InlineNodeOf, type ParagraphOf } from './model.js'

const font: CssFont = { family: 'Arial', size: 16, weight: 400, style: 'normal' }
const block = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8 } as const

function span(lang: string | null, whiteSpace: 'normal' | 'nowrap', children: InlineNodeOf<CssFont>[]): InlineElementOf<CssFont> {
  return { ...block, whiteSpace, kind: 'span', lang, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children }
}

// <div lang="en">ab<span lang="ja" style="white-space: nowrap">c<span><br></span>d<img></span><wbr>e</div>
const paragraph: ParagraphOf<CssFont> = {
  ...block,
  content: [
    { kind: 'text', text: 'ab' },
    span('ja', 'nowrap', [
      { kind: 'text', text: 'c' },
      span(null, 'nowrap', [{ kind: 'br' }]),
      { kind: 'text', text: 'd' },
      { kind: 'atomic', width: 20, height: 10, marginInlineStart: 0, marginInlineEnd: 0 },
    ]),
    { kind: 'wbr' },
    { kind: 'text', text: 'e' },
  ],
  lang: 'en', direction: 'ltr', width: 100, lineHeight: 20, textIndent: 0, textAlign: 'start',
}

describe('indexContent', () => {
  const index = indexContent(paragraph)

  test('leaves carry source offsets and parents in document order', () => {
    expect(index.text).toBe('abcde')
    expect(index.leaves.map(leaf => [leaf.text, leaf.start, leaf.parent, leaf.event])).toEqual([
      ['ab', 0, -1, 0], ['c', 2, 0, 2], ['d', 3, 0, 6], ['e', 4, -1, 10],
    ])
  })

  test('elements are numbered in preorder with their events', () => {
    expect(index.elements.map(element => [element.node.kind, element.parent, element.open, element.close])).toEqual([
      ['span', -1, 1, 8], ['span', 0, 3, 5], ['br', 1, 4, 4], ['atomic', 0, 7, 7], ['wbr', -1, 9, 9],
    ])
    expect(index.events.map(event => event.kind)).toEqual(['text', 'open', 'text', 'open', 'br', 'close', 'text', 'atomic', 'close', 'wbr', 'text'])
  })

  test('style and lang come from the nearest element', () => {
    expect(styleUnder(paragraph, index, -1).whiteSpace).toBe('normal')
    expect(styleUnder(paragraph, index, 1).whiteSpace).toBe('nowrap')
    expect(langUnder(paragraph, index, -1)).toBe('en')
    expect(langUnder(paragraph, index, 1)).toBe('ja')
    expect(() => styleUnder(paragraph, index, 3)).toThrow()
  })

  test('an empty leaf keeps its index and makes no text', () => {
    const flat: ParagraphOf<CssFont> = { ...paragraph, content: [span(null, 'normal', [{ kind: 'text', text: '' }]), { kind: 'text', text: 'x' }] }
    const flatIndex = indexContent(flat)
    expect(flatIndex.leaves.map(leaf => [leaf.text, leaf.start])).toEqual([['', 0], ['x', 0]])
  })
})
