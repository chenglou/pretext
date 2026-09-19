// The painter's forms and limits on hand-made lines, with a small stand-in document that records what was built.
// Browser behaviour is checked in the lab (specs/PAINTER-RESULTS.md); these tests pin what the painter builds for the
// pieces of a line under each engine's painting rules (engines/<engine>/paint-rules.ts).
import { describe, expect, test } from 'bun:test'
import type { BlinkPaintFacts } from './engines/blink/index.js'
import { blinkPaintRules } from './engines/blink/paint-rules.js'
import type { GeckoPaintFacts } from './engines/gecko/index.js'
import { geckoPaintRules } from './engines/gecko/paint-rules.js'
import type { WebKitPaintFacts } from './engines/webkit/index.js'
import { webkitPaintRules } from './engines/webkit/paint-rules.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type Fragment, type InlineElement, type InlineNode, type Paragraph } from './model.js'
import { paintLines, painterLimits, type PaintLine, type PaintRules, type PainterLimit } from './paint.js'

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
// An engine's lines as the painter takes them, with its rules.
type Painted<Facts> = { lines: PaintLine<Facts>[]; rules: PaintRules<Facts> }
function line<Facts>(fragments: Fragment[], overflows: boolean, facts: Facts): PaintLine<Facts> {
  return { pieces: { fragments, joinsNextLine: false, indented: false, align: 'start', overflows, facts }, slot: { width: 100, left: 0, right: 0 }, hasLineBox: true }
}
function blink(lines: { fragments: Fragment[]; overflows?: boolean; needsAccurateEndPosition?: boolean }[]): Painted<BlinkPaintFacts> {
  return { rules: blinkPaintRules, lines: lines.map(made => line(made.fragments, made.overflows ?? false, { needsAccurateEndPosition: made.needsAccurateEndPosition ?? false })) }
}
function webkit(lines: { fragments: Fragment[]; carriedWidth?: number }[]): Painted<WebKitPaintFacts> {
  return { rules: webkitPaintRules, lines: lines.map(made => line(made.fragments, false, { carriedWidth: made.carriedWidth ?? null, shapedAcrossBoxes: false })) }
}
function gecko(lines: { fragments: Fragment[] }[]): Painted<GeckoPaintFacts> {
  return { rules: geckoPaintRules, lines: lines.map(made => line(made.fragments, false, {})) }
}
const text = (run: number, start: number, painted: string, level: number): Fragment => ({ kind: 'text', run, start, end: start + painted.length, painted, level })
const paint = <Facts>(p: Paragraph, painted: Painted<Facts>): Node[] => paintLines(p, painted.lines, [], painted.rules, doc) as unknown as Node[]
const limitsOf = <Facts>(p: Paragraph, painted: Painted<Facts>): PainterLimit[][] => painterLimits(p, painted.lines, painted.rules)

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
    expect(paint(p, blink([{ fragments }, second]))[0]!.inner()).toBe('[AA][  ]<span display:inline-block;vertical-align:top></span>')
  })
  test('the same node where an overflow break reshaped the text', () => {
    expect(paint(p, blink([{ fragments, overflows: true }, second]))[0]!.inner()).toBe('[AA  ]<span display:inline-block;vertical-align:top></span>')
  })
  test('a shaping group of their own where the line needs an accurate end position, with its limit', () => {
    const layout = blink([{ fragments, needsAccurateEndPosition: true }, second])
    expect(paint(p, layout)[0]!.inner()).toBe('[AA]<span vertical-align:0px>[  ]</span><span display:inline-block;vertical-align:top></span>')
    expect(limitsOf(p, layout)[0]!.map(x => x.limit)).toEqual(['space-shaped-with-next-line', 'hanging-space-kern-share'])
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
    expect(limitsOf(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['edge-inside-shaped-text'], ['edge-inside-shaped-text'], ['edge-inside-shaped-text']])
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
    expect(limitsOf(q, layout)[0]!.map(x => x.limit)).toContain('script-at-line-start')
  })
})

describe('WebKit text node storage', () => {
  const wide = String.fromCharCode(0x3000)
  const p = paragraph([{ kind: 'text', text: 'ab' + wide + 'cd' }])
  test("a Latin-1 slice of a leaf with a wide character is made wide and cut back", () => {
    const lines = paint(p, webkit([{ fragments: [text(0, 0, 'ab', 0)] }, { fragments: [text(0, 2, wide + 'cd', 0)] }]))
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
  test('WebKit: a line whose first text keeps a carried width', () => {
    const p = paragraph([{ kind: 'text', text: 'abcdef' }], { overflowWrap: 'break-word' })
    const layout = webkit([{ fragments: [text(0, 0, 'abc', 0)] }, { fragments: [text(0, 3, 'def', 0)], carriedWidth: 20 }])
    expect(limitsOf(p, layout)).toEqual([[], [{ limit: 'carried-width', detail: "the line's first text keeps the carried width 20" }]])
  })
  test('WebKit: a word whose space is on the next line names its limit, and a line without a carried width names none', () => {
    const p = paragraph([{ kind: 'text', text: 'A B' }], { whiteSpace: 'pre-wrap' })
    const layout = webkit([{ fragments: [text(0, 0, 'A', 0)] }, { fragments: [text(0, 1, ' B', 0)] }])
    expect(limitsOf(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['word-measured-with-next-space'], []])
  })
  test('Gecko: a trimmed U+3000 inside a leaf', () => {
    const wide = String.fromCharCode(0x3000)
    const p = paragraph([{ kind: 'text', text: 'a' + wide + 'b' }])
    const layout = gecko([{ fragments: [text(0, 0, 'a', 0), { kind: 'trimmed', run: 0, start: 1, end: 2, painted: wide, level: 0 }] }, { fragments: [text(0, 2, 'b', 0)] }])
    expect(limitsOf(p, layout).map(limits => limits.map(x => x.limit))).toEqual([['frame-ended-at-break'], []])
  })
  test('a line edge inside a grapheme cluster', () => {
    const p = paragraph([{ kind: 'text', text: 'ae' + String.fromCharCode(0x301) }], { overflowWrap: 'break-word' })
    const layout = gecko([{ fragments: [text(0, 0, 'ae', 0)] }, { fragments: [text(0, 2, String.fromCharCode(0x301), 0)] }])
    expect(limitsOf(p, layout)[0]!.map(x => x.limit)).toContain('edge-inside-cluster')
  })
})
