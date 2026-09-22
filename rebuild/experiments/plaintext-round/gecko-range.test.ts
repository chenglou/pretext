import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../src/env.js'
import { createContextPool } from '../../src/measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type InlineElement, type Paragraph } from '../../src/model.js'
import { fillLine, firstLine, inspectLine, linePieces, prepare } from '../../src/engines/gecko/index.js'
import { fillLineRange, type GeckoRangeFillResult } from '../../src/engines/gecko/lines.js'

beforeAll(() => {
  class Context {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string) {
      let width = 0
      for (const ch of text) if (!/^[\p{M}\p{Default_Ignorable_Code_Point}]$/u.test(ch)) width += 10 + Number.parseFloat(this.letterSpacing)
      return { width: Math.fround(width), actualBoundingBoxLeft: 0, actualBoundingBoxRight: Math.fround(width) }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
})
const env: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null,
  regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' } }
const font = { family: 'Optima', size: 16, weight: 400, style: 'normal' as const,
  facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false, pairKerning: 'first-advance' as const } }
function paragraph(content: InlineNode[], extra: Partial<Paragraph> = {}): Paragraph {
  return { font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
    lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content, ...extra }
}
function span(children: InlineNode[], extra: Partial<InlineElement> = {}): InlineElement {
  return { kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
    lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children, ...extra }
}
function ranges(p: ReturnType<typeof prepare>, width: number, rangeOnly: boolean): GeckoRangeFillResult[] {
  const rows: GeckoRangeFillResult[] = []
  for (let start = firstLine(p); start !== null;) {
    const r = rangeOnly ? fillLineRange(p, start, { width, left: 0, right: 0 }) : fillLine(p, start, { width, left: 0, right: 0 })
    if (r.kind === 'below-floats') throw new Error('unexpected refusal')
    rows.push({ kind: r.kind, start: r.start, end: r.end, next: r.next, hasLineBox: r.hasLineBox }); start = r.next
  }
  return rows
}

test('range-only empty/nested/control spans retain the edges and progress of full lines', () => {
  const node = span([span([]), { kind: 'text', text: '\u200e' }, { kind: 'wbr' }, { kind: 'br' }], {
    inlineStart: { margin: -2, border: 1, padding: 3 }, inlineEnd: { margin: 4, border: 2, padding: 5 },
  })
  const p = prepare(paragraph([node, { kind: 'text', text: 'ab cd' }]), env, false, createContextPool())
  for (const width of [1, 20, 37, 320, 20]) expect(ranges(p, width, true)).toEqual(ranges(p, width, false))
  const filled = fillLine(p, firstLine(p)!, { width: 320, left: 0, right: 0 })
  if (filled.kind !== 'line') throw new Error('unexpected refusal')
  expect(filled.end).toBe(1)
  expect(filled.hasLineBox).toBe(true)
  expect(linePieces(p, filled.line).fragments.filter(f => f.kind === 'box-start' || f.kind === 'box-end').length).toBe(4)
})

test('a range fill can precede full justified line materialization without losing frame metadata', () => {
  const source = paragraph([{ kind: 'text', text: 'a b c d e f ' }], { textAlign: 'justify', whiteSpace: 'pre-wrap' })
  for (const inspected of [false, true]) {
    const p = prepare(source, env, inspected, createContextPool())
    const fullBefore = fillLine(p, firstLine(p)!, { width: 37, left: 0, right: 0 })
    if (fullBefore.kind !== 'line') throw new Error('unexpected refusal')
    const pieces = linePieces(p, fullBefore.line)
    const inspection = inspected ? inspectLine(p, fullBefore.line) : null
    for (const width of [10, 37, 320, 37]) expect(ranges(p, width, true)).toEqual(ranges(p, width, false))
    const fullAfter = fillLine(p, firstLine(p)!, { width: 37, left: 0, right: 0 })
    if (fullAfter.kind !== 'line') throw new Error('unexpected refusal')
    expect(linePieces(p, fullAfter.line)).toEqual(pieces)
    if (inspection !== null) expect(inspectLine(p, fullAfter.line)).toEqual(inspection)
    expect(linePieces(p, fullBefore.line)).toEqual(pieces)
  }
})

test('range and full fills refuse the same float band and resume from the same start', () => {
  const p = prepare(paragraph([span([{ kind: 'text', text: 'abc' }])]), env, false, createContextPool())
  const start = firstLine(p)!
  expect(fillLineRange(p, start, { width: 20, left: 20, right: 0 })).toEqual({ kind: 'below-floats', next: start })
  expect(fillLine(p, start, { width: 20, left: 20, right: 0 }).kind).toBe('below-floats')
  expect(ranges(p, 20, true)).toEqual(ranges(p, 20, false))
})
