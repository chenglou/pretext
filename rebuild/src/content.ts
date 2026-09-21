// Document order over a paragraph's inline content (DESIGN.md §1.1): the text leaves with their source offsets, the
// elements with their parents, and the sequence of events a DOM walk visits. Engines build their items from this walk,
// as each engine's builder walks its layout tree (Blink InlineItemsBuilder, WebKit InlineItemsBuilder, Gecko's frame
// construction); the painter replays it between painted pieces. The lab doesn't import it (research/TEST-ARCHITECTURE.md
// §0 rule 1) and walks the tree itself.
import type { InlineNodeOf, ParagraphOf, TextStyleOf } from './model.js'

export type ContentEvent =
  | { kind: 'open'; element: number }
  | { kind: 'close'; element: number }
  | { kind: 'text'; run: number }
  | { kind: 'atomic' | 'br' | 'wbr'; element: number }

export type IndexedLeaf = {
  text: string
  // Source offset of the leaf's first code unit.
  start: number
  // The span holding the leaf, or -1 for the block.
  parent: number
  // The leaf's event.
  event: number
}

export type IndexedElement<Font> = {
  node: Exclude<InlineNodeOf<Font>, { kind: 'text' }>
  // The span holding the element, or -1 for the block.
  parent: number
  // A span's open and close events; an atomic, br or wbr element's one event, twice.
  open: number
  close: number
}

export type ContentIndex<Font> = {
  // Every leaf's text in document order: what source offsets index.
  text: string
  leaves: IndexedLeaf[]
  elements: IndexedElement<Font>[]
  events: ContentEvent[]
}

export function indexContent<Font>(paragraph: ParagraphOf<Font>): ContentIndex<Font> {
  const leaves: IndexedLeaf[] = []
  const elements: IndexedElement<Font>[] = []
  const events: ContentEvent[] = []
  let text = ''
  // An explicit stack instead of recursion, so a deeply nested tree can't overflow the call stack.
  const stack: { children: readonly InlineNodeOf<Font>[]; next: number; parent: number }[] = [{ children: paragraph.content, next: 0, parent: -1 }]
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!
    if (frame.next === frame.children.length) {
      stack.pop()
      if (frame.parent >= 0) {
        elements[frame.parent]!.close = events.length
        events.push({ kind: 'close', element: frame.parent })
      }
      continue
    }
    const node = frame.children[frame.next]!
    frame.next++
    switch (node.kind) {
      case 'text':
        leaves.push({ text: node.text, start: text.length, parent: frame.parent, event: events.length })
        events.push({ kind: 'text', run: leaves.length - 1 })
        text += node.text
        break
      case 'span': {
        const element = elements.length
        elements.push({ node, parent: frame.parent, open: events.length, close: -1 })
        events.push({ kind: 'open', element })
        stack.push({ children: node.children, next: 0, parent: element })
        break
      }
      case 'atomic':
      case 'br':
      case 'wbr': {
        const element = elements.length
        elements.push({ node, parent: frame.parent, open: events.length, close: events.length })
        events.push({ kind: node.kind, element })
        break
      }
    }
  }
  return { text, leaves, elements, events }
}

// The computed style of the element content under `parent` sits in: the span's own, or the block's for -1.
export function styleUnder<Font>(paragraph: ParagraphOf<Font>, index: ContentIndex<Font>, parent: number): TextStyleOf<Font> {
  if (parent < 0) return paragraph
  const node = index.elements[parent]!.node
  if (node.kind !== 'span') throw new Error(`element ${parent} is ${node.kind}, which holds no content`)
  return node
}
