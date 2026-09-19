// The painter's forms and limits on hand-made layouts, with a small stand-in document that records what was built.
// Browser behaviour is checked in the lab (specs/PAINTER-RESULTS.md); these tests pin what the painter builds for a layout.
import { describe, expect, test } from 'bun:test'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type Fragment, type InlineElement, type InlineNode, type Paragraph } from './model.js'
import { paintLines, painterLimits, type PaintableLayout } from './paint.js'

class Node {
  children: Node[] = []
  props = new Map<string, string>()
  style: Record<string, unknown>
  lang = ''
  deleted = 0
  constructor(public tag: string | null, public data = '') {
    const props = this.props
    this.style = new Proxy({}, {
      get: (_target, key) => key === 'setProperty' ? (name: string, value: string) => props.set(name, value) : key === 'removeProperty' ? (name: string) => props.delete(name) : props.get(String(key)) ?? '',
      set: (_target, key, value) => { props.set(String(key) === 'cssFloat' ? 'float' : String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(value)); return true },
    })
  }
  append(...nodes: Node[]): void { this.children.push(...nodes) }
  appendChild(node: Node): Node { this.children.push(node); return node }
  deleteData(offset: number, count: number): void { this.data = this.data.slice(0, offset) + this.data.slice(offset + count); this.deleted += count }
  // The inline markup under a line block: tags with the styles that decide the form, text between brackets.
  html(): string {
    if (this.tag === null) return `[${this.data}]`
    const css = [...this.props].filter(([k]) => /bidi|direction|border-inline|vertical|^display$|text-wrap/.test(k)).map(([k, v]) => `${k}:${v}`).join(';')
    return `<${this.tag}${css ? ` ${css}` : ''}>${this.children.map(c => c.html()).join('')}</${this.tag}>`
  }
  inner(): string { return this.children.map(c => c.html()).join('') }
  textNodes(): Node[] { return this.tag === null ? [this] : this.children.flatMap(c => c.textNodes()) }
}
const doc = { createElement: (tag: string) => new Node(tag), createTextNode: (data: string) => new Node(null, data) } as unknown as Document

const font: FontDecl = { family: 'Arial', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
const style = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8 } as const
function paragraph(content: InlineNode[], more: Partial<Paragraph> = {}): Paragraph {
  return { ...style, content, lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start', ...more }
}
function span(children: InlineNode[], more: Partial<InlineElement> = {}): InlineElement {
  return { ...style, kind: 'span', lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children, ...more }
}
const shared = { hasLineBox: true, joinsNextLine: false, slot: { width: 100, left: 0, right: 0 }, indented: false, align: 'start' } as const
const blinkGeometry = { needsAccurateEndPosition: false, width: 0, hangWidth: 0, availableWidth: 6400 }
function blink(lines: { fragments: Fragment[]; geometry?: Partial<typeof blinkGeometry> }[]): PaintableLayout {
  return { engine: 'blink', belowFloats: [], lines: lines.map(line => ({ ...shared, fragments: line.fragments, geometry: { ...blinkGeometry, ...line.geometry } })) }
}
function webkit(lines: { fragments: Fragment[]; next?: { offset: number; carriedWidth: number | null } }[]): PaintableLayout {
  return {
    engine: 'webkit', belowFloats: [],
    lines: lines.map(line => ({
      ...shared, fragments: line.fragments, geometry: { contentWidth: 0, hangingWidth: 0, lineBoxWidth: 100, boxes: [] },
      next: line.next === undefined ? null : { offset: line.next.offset, previousLine: { carriedWidth: line.next.carriedWidth } },
    })),
  }
}
function gecko(lines: { fragments: Fragment[]; align?: 'start' | 'justify' }[]): PaintableLayout {
  return { engine: 'gecko', belowFloats: [], lines: lines.map(line => ({ ...shared, align: line.align ?? 'start', fragments: line.fragments, geometry: { width: 0, hang: 0, availableWidth: 6000 } })) }
}
const text = (run: number, start: number, painted: string, level: number): Fragment => ({ kind: 'text', run, start, end: start + painted.length, painted, level })
const paint = (p: Paragraph, layout: PaintableLayout): Node[] => paintLines(p, layout, doc) as unknown as Node[]

describe('override spans', () => {
  // <div dir=rtl>b<span style="border-inline-end: 6px solid">bbb</span> c</div>, the line `b`, the span and a trimmed space.
  const p = paragraph([{ kind: 'text', text: 'b' }, span([{ kind: 'text', text: 'bbb' }], { inlineEnd: { margin: 0, border: 6, padding: 0 } }), { kind: 'text', text: ' c' }], { direction: 'rtl' })
  const layout = blink([
    { fragments: [text(0, 0, 'b', 2), { kind: 'box-start', element: 0 }, text(1, 1, 'bbb', 2), { kind: 'box-end', element: 0 }, { kind: 'trimmed', run: 2, start: 4, end: 5, painted: ' ', level: 1 }] },
    { fragments: [text(2, 5, 'c', 2)] },
  ])
  test('one override span holds the pieces above its level, a whole element included, and the element keeps the paragraph direction', () => {
    const line = paint(p, layout)[0]!
    expect(line.props.get('unicode-bidi')).toBe('bidi-override')
    expect(line.inner()).toBe(
      '<span unicode-bidi:bidi-override;direction:ltr><span direction:rtl>[b]</span><span border-inline-end:6px solid;direction:rtl>[bbb]</span></span>' +
      '<span direction:rtl>[ ]</span><span display:inline-block;vertical-align:top></span>')
  })
})

describe('Blink hanging spaces', () => {
  const p = paragraph([{ kind: 'text', text: 'AA  BB' }], { whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  const fragments: Fragment[] = [text(0, 0, 'AA', 0), { kind: 'hanging', run: 0, start: 2, end: 4, painted: '  ', level: 0 }]
  const second = { fragments: [text(0, 4, 'BB', 0)] }
  test('a text node of their own where the text kept its shape', () => {
    expect(paint(p, blink([{ fragments, geometry: { width: 3000, hangWidth: 1000 } }, second]))[0]!.inner()).toBe('[AA][  ]<span display:inline-block;vertical-align:top></span>')
  })
  test('the same node where an overflow break reshaped the text', () => {
    expect(paint(p, blink([{ fragments, geometry: { width: 8000, hangWidth: 1000 } }, second]))[0]!.inner()).toBe('[AA  ]<span display:inline-block;vertical-align:top></span>')
  })
  test('a shaping group of their own where the line needs an accurate end position, with its limit', () => {
    const layout = blink([{ fragments, geometry: { width: 3000, hangWidth: 1000, needsAccurateEndPosition: true } }, second])
    expect(paint(p, layout)[0]!.inner()).toBe('[AA]<span vertical-align:0px>[  ]</span><span display:inline-block;vertical-align:top></span>')
    expect(painterLimits(p, layout)[0]!.map(x => x.limit)).toEqual(['space-shaped-with-next-line', 'hanging-space-kern-share'])
  })
})

describe('Blink script mark', () => {
  const guillemet = String.fromCharCode(0xab)
  const arabic = String.fromCharCode(0x628, 0x628)
  const p = paragraph([{ kind: 'text', text: arabic + guillemet + 'tail' }], { overflowWrap: 'break-word' })
  test('a line of Common characters after Arabic text starts with U+061C', () => {
    const layout = blink([{ fragments: [text(0, 0, arabic, 1)] }, { fragments: [text(0, 2, guillemet, 0)] }, { fragments: [text(0, 3, 'tail', 0)] }])
    const lines = paint(p, layout)
    expect(lines[1]!.textNodes().map(n => n.data)).toEqual([String.fromCharCode(0x61c) + guillemet])
    expect(lines[2]!.textNodes().map(n => n.data)).toEqual(['tail'])
    expect(painterLimits(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['edge-inside-shaped-text'], ['edge-inside-shaped-text'], ['edge-inside-shaped-text']])
  })
  test('not a closing bracket whose opening bracket stood after Latin text, which is Latin in the paragraph too', () => {
    const q = paragraph([{ kind: 'text', text: 'a(' + arabic + ')b' }], { overflowWrap: 'break-word' })
    const lines = paint(q, blink([{ fragments: [text(0, 0, 'a(', 0), text(0, 2, arabic, 1)] }, { fragments: [text(0, 4, ')b', 0)] }]))
    expect(lines[1]!.textNodes().map(n => n.data)).toEqual([')b'])
  })
  test('not digits that take script Arabic from the text after them: after the mark they would be Arabic numbers', () => {
    const q = paragraph([{ kind: 'text', text: '12 ' + arabic }])
    const layout = blink([{ fragments: [text(0, 0, '12', 0), { kind: 'trimmed', run: 0, start: 2, end: 3, painted: ' ', level: 0 } as Fragment] }, { fragments: [text(0, 3, arabic, 1)] }])
    expect(paint(q, layout)[0]!.textNodes().map(n => n.data)[0]).toBe('12 ')
    expect(painterLimits(q, layout)[0]!.map(x => x.limit)).toContain('script-at-line-start')
  })
})

describe('WebKit text node storage', () => {
  const wide = String.fromCharCode(0x3000)
  const p = paragraph([{ kind: 'text', text: 'ab' + wide + 'cd' }])
  test("a Latin-1 slice of a leaf with a wide character is made wide and cut back", () => {
    const lines = paint(p, webkit([{ fragments: [text(0, 0, 'ab', 0)], next: { offset: 0, carriedWidth: null } }, { fragments: [text(0, 2, wide + 'cd', 0)] }]))
    expect(lines[0]!.textNodes().map(n => [n.data, n.deleted])).toEqual([['ab', 1]])
    expect(lines[1]!.textNodes().map(n => [n.data, n.deleted])).toEqual([[wide + 'cd', 0]])
  })
})

describe('Gecko text run end', () => {
  test('a tab before more text of its leaf at its level is followed by a newline under letter spacing', () => {
    const p = paragraph([{ kind: 'text', text: 'a\tb' }], { whiteSpace: 'pre-wrap', letterSpacing: 1 })
    const lines = paint(p, gecko([{ fragments: [text(0, 0, 'a\t', 0)] }, { fragments: [text(0, 2, 'b', 0)] }]))
    expect(lines[0]!.textNodes().map(n => n.data)).toEqual(['a\t\n'])
  })
  test('not where the next piece has another level, which ends the text run in the paragraph too', () => {
    const p = paragraph([{ kind: 'text', text: 'a\tb' }], { whiteSpace: 'pre-wrap', letterSpacing: 1, direction: 'rtl' })
    const lines = paint(p, gecko([{ fragments: [text(0, 0, 'a', 2), text(0, 1, '\t', 1)] }, { fragments: [text(0, 2, 'b', 2)] }]))
    expect(lines[0]!.textNodes().map(n => n.data).join('')).toBe('a\t')
  })
})

describe('limits', () => {
  test('WebKit: a line that starts inside an item keeps a carried width', () => {
    const p = paragraph([{ kind: 'text', text: 'abcdef' }], { overflowWrap: 'break-word' })
    const layout = webkit([{ fragments: [text(0, 0, 'abc', 0)], next: { offset: 3, carriedWidth: 20 } }, { fragments: [text(0, 3, 'def', 0)] }])
    expect(painterLimits(p, layout).map(limits => limits.map(x => x.limit))).toEqual([[], ['carried-width']])
  })
  test('WebKit: a whole item that wrapped is measured again, and a word whose space is on the next line names its limit', () => {
    const p = paragraph([{ kind: 'text', text: 'A B' }], { whiteSpace: 'pre-wrap' })
    const layout = webkit([{ fragments: [text(0, 0, 'A', 0)], next: { offset: 0, carriedWidth: 5 } }, { fragments: [text(0, 1, ' B', 0)] }])
    expect(painterLimits(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['word-measured-with-next-space'], []])
  })
  test('Gecko: a trimmed U+3000 inside a leaf', () => {
    const wide = String.fromCharCode(0x3000)
    const p = paragraph([{ kind: 'text', text: 'a' + wide + 'b' }])
    const layout = gecko([{ fragments: [text(0, 0, 'a', 0), { kind: 'trimmed', run: 0, start: 1, end: 2, painted: wide, level: 0 }] }, { fragments: [text(0, 2, 'b', 0)] }])
    expect(painterLimits(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['frame-ended-at-break'], []])
  })
  test('a line edge inside a grapheme cluster', () => {
    const p = paragraph([{ kind: 'text', text: 'ae' + String.fromCharCode(0x301) }], { overflowWrap: 'break-word' })
    const layout = gecko([{ fragments: [text(0, 0, 'ae', 0)] }, { fragments: [text(0, 2, String.fromCharCode(0x301), 0)] }])
    expect(painterLimits(p, layout)[0]!.map(x => x.limit)).toContain('edge-inside-cluster')
  })
})
