import { expect, test } from 'bun:test'
import { indexContent } from '../../content.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../model.js'
import { buildContent, stylesOf } from './content.js'

function paragraph(): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}
function span(p: Paragraph, children: InlineNode[]): Extract<InlineNode, { kind: 'span' }> {
  return { kind: 'span', font: p.font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
    verticalAlign: 'baseline', children }
}
function build(p: Paragraph) {
  const index = indexContent(p), computed = stylesOf(p, index, 1)
  const content = buildContent(index, computed.styles, computed.styleOfLeaf, computed.styleOfElement)
  return { content, styles: computed.styles }
}

test('deep empty spans keep every empty box fragment and source-free tag position', () => {
  const p = paragraph(), depth = 2048
  let children: InlineNode[] = []
  for (let i = 0; i < depth; i++) children = [span(p, children)]
  p.content = children
  const { content, styles } = build(p)
  expect(content.text).toBe('')
  expect(content.sourceOffsets.length).toBe(0)
  expect(content.items.length).toBe(2 * depth)
  expect(content.items.every(item => (item.type === 'open-tag' || item.type === 'close-tag') && item.start === 0 && item.end === 0)).toBe(true)
  expect(styles.slice(1).every(style => style.shouldCreateBoxFragment)).toBe(true)
})

test('a long WBR/space stream collapses only the source space and shifts generated items coherently', () => {
  const p = paragraph(), count = 2048
  p.content = [{ kind: 'text', text: 'a ' }]
  for (let i = 0; i < count; i++) p.content.push({ kind: 'wbr' }, { kind: 'text', text: ' ' })
  const { content } = build(p)
  expect(content.text).toBe('a' + '\u200b'.repeat(count))
  expect(Array.from(content.sourceOffsets)).toEqual([0, ...new Array<number>(count).fill(-1)])
  expect(content.items.length).toBe(1 + 2 * count)
  expect(content.items[0]).toMatchObject({ type: 'text', start: 0, end: 1, endCollapseType: 'collapsed' })
  for (const i of [0, count - 1]) {
    expect(content.items[1 + 2 * i]).toMatchObject({ type: 'control', control: 'wbr', start: i + 1, end: i + 2 })
    expect(content.items[2 + 2 * i]).toMatchObject({ type: 'text', start: i + 2, end: i + 2, endCollapseType: 'opaque-to-collapsing' })
  }
})

test('an erased singleton space still blocks its owner empty-box flag, and a later atomic restores its source', () => {
  const p = paragraph()
  p.content = [{ kind: 'text', text: '\u200b' }, span(p, [{ kind: 'text', text: ' ' }, span(p, [{ kind: 'text', text: '\n' }])])]
  let result = build(p)
  expect(result.content.text).toBe('\u200b')
  expect(result.content.items[2]).toMatchObject({ type: 'text', start: 1, end: 1, endCollapseType: 'collapsed' })
  expect(result.styles.slice(1).map(style => style.shouldCreateBoxFragment)).toEqual([false, true])
  p.content.push({ kind: 'atomic', width: 10, height: 10, marginInlineStart: 0, marginInlineEnd: 0 }, span(p, []))
  result = build(p)
  expect(result.content.text).toBe('\u200b \ufffc')
  expect(Array.from(result.content.sourceOffsets)).toEqual([0, 1, -1])
  expect(result.content.items[2]).toMatchObject({ start: 1, end: 2, endCollapseType: 'collapsible' })
  expect(result.content.items.slice(3, 7).every(item => item.start === 2 && item.end === 2)).toBe(true)
  expect(result.styles.slice(1).map(style => style.shouldCreateBoxFragment)).toEqual([false, true, true])
})

test('a long eligible-space epoch preserves source and tag coordinates through repeated removal and restoration', () => {
  const p = paragraph(), count = 2048
  p.content = [{ kind: 'text', text: '\u200b ' }]
  for (let i = 0; i < count; i++) p.content.push({ kind: 'wbr' }, span(p, [{ kind: 'text', text: '\n' }]))
  let { content, styles } = build(p)
  expect(content.text).toBe('\u200b' + '\u200b'.repeat(count))
  expect(Array.from(content.sourceOffsets)).toEqual([0, ...new Array<number>(count).fill(-1)])
  expect(content.items.length).toBe(1 + 4 * count)
  expect(content.items[0]).toMatchObject({ start: 0, end: 1, endCollapseType: 'collapsed' })
  expect(styles.slice(1).every(style => style.shouldCreateBoxFragment)).toBe(true)
  for (const i of [0, count - 1]) {
    expect(content.items[1 + 4 * i]).toMatchObject({ type: 'control', control: 'wbr', start: i + 1, end: i + 2 })
    expect(content.items.slice(2 + 4 * i, 5 + 4 * i).every(item => item.start === i + 2 && item.end === i + 2)).toBe(true)
  }
  // A new glyph restores the same original source space before all the generated WBRs.
  p.content.push({ kind: 'text', text: 't' })
  ;({ content, styles } = build(p))
  expect(content.text).toBe('\u200b ' + '\u200b'.repeat(count) + 't')
  expect(Array.from(content.sourceOffsets)).toEqual([0, 1, ...new Array<number>(count).fill(-1), count + 2])
  expect(content.items[0]).toMatchObject({ start: 0, end: 2, endCollapseType: 'collapsible' })
  expect(content.items.at(-1)).toMatchObject({ type: 'text', start: count + 2, end: count + 3 })
  expect(styles.slice(1).every(style => style.shouldCreateBoxFragment)).toBe(true)
})

test('a forced break finalizes an erased-space epoch before a later source glyph', () => {
  const p = paragraph(), count = 256
  p.content = [{ kind: 'text', text: '\u200b ' }]
  for (let i = 0; i < count; i++) p.content.push({ kind: 'wbr' }, span(p, [{ kind: 'text', text: '\n' }]))
  p.content.push({ kind: 'br' }, { kind: 'text', text: 't' })
  const { content } = build(p)
  expect(content.text).toBe('\u200b' + '\u200b'.repeat(count) + '\nt')
  expect(Array.from(content.sourceOffsets)).toEqual([0, ...new Array<number>(count + 1).fill(-1), count + 2])
  expect(content.items[1 + 4 * (count - 1)]).toMatchObject({ control: 'wbr', start: count, end: count + 1 })
  expect(content.items.at(-2)).toMatchObject({ type: 'control', control: 'br', start: count + 1, end: count + 2 })
  expect(content.items.at(-1)).toMatchObject({ type: 'text', start: count + 2, end: count + 3 })
})
