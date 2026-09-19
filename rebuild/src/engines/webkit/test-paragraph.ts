// Paragraphs for the WebKit port's tests: flat runs as the tree DESIGN.md §1.1 describes ("Flat paragraphs"), and the few
// tree nodes the feature tests need. Test support only; no library file imports it.
import { NO_BOX_EDGE, type AtomicInline, type BoxEdge, type FontDecl, type InlineElement, type InlineNode, type Paragraph, type TextStyle } from '../../model.js'
import type { Sized } from '../../test-lines.js'

export type FlatNode = 'span' | 'text'

export function textStyleOf(p: Paragraph): TextStyle {
  return {
    font: p.font, letterSpacing: p.letterSpacing, wordSpacing: p.wordSpacing, whiteSpace: p.whiteSpace, wordBreak: p.wordBreak,
    overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize,
  }
}

// A paragraph of the block's styles holding `content`.
export function treeParagraph(content: InlineNode[], font: FontDecl, overrides: Partial<Sized> = {}): Sized {
  return {
    content, font, letterSpacing: 0, wordSpacing: 0, width: 1000, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', ...overrides,
  }
}

// Flat runs: a bare text node, or a span with the block's styles and one leaf; the block's overrides apply to every span.
export function flatParagraph(runs: Array<[string, FlatNode]>, font: FontDecl, overrides: Partial<Sized> = {}): Sized {
  const block = treeParagraph([], font, overrides)
  const content: InlineNode[] = []
  for (let i = 0; i < runs.length; i++) {
    const [text, node] = runs[i]!
    content.push(node === 'text' ? { kind: 'text', text } : span(block, [{ kind: 'text', text }]))
  }
  return { ...block, content }
}

// A span with the block's styles, unless overridden.
export function span(block: Paragraph, children: InlineNode[], overrides: Partial<InlineElement> = {}, inlineStart: BoxEdge = NO_BOX_EDGE, inlineEnd: BoxEdge = NO_BOX_EDGE): InlineElement {
  return { ...textStyleOf(block), kind: 'span', lang: null, inlineStart, inlineEnd, verticalAlign: 'baseline', children, ...overrides }
}

export function atomic(width: number, marginInlineStart = 0, marginInlineEnd = 0): AtomicInline {
  return { kind: 'atomic', width, height: 10, marginInlineStart, marginInlineEnd }
}
