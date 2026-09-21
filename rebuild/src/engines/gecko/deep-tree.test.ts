import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, linePieces, prepare } from './index.js'

beforeAll(() => {
  class Context {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string) { const width = Math.fround(10 * text.length); return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width } }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
})
const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null,
  regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' },
}
const font: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false, pairKerning: 'first-advance' } }
const paragraph = (content: InlineNode[], extra: Partial<Paragraph> = {}): Paragraph => ({
  font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere',
  lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content, ...extra,
})
function nested(p: Paragraph, depth: number, children: InlineNode[]): InlineNode[] {
  for (let i = 0; i < depth; i++) children = [{
    kind: 'span', font: p.font, letterSpacing: p.letterSpacing, wordSpacing: p.wordSpacing, whiteSpace: p.whiteSpace,
    wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize, lang: null,
    inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children,
  }]
  return children
}
function observed(p: Paragraph, inspected: boolean) {
  const prepared = prepare(p, env, inspected, createContextPool())
  const lines: unknown[] = []
  let edges = 0, inlineFrames = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width: 35, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    const pieces = linePieces(prepared, filled.line)
    edges += pieces.fragments.filter(f => f.kind === 'box-start' || f.kind === 'box-end').length
    const inspection = inspected ? inspectLine(prepared, filled.line) : null
    inlineFrames += inspection?.geometry?.frames.filter(f => f.kind === 'inline').length ?? 0
    lines.push({ start: filled.start, end: filled.end, nextOffset: filled.next?.contentOffset ?? null, hasLineBox: filled.hasLineBox,
      pieces: { ...pieces, fragments: pieces.fragments.filter(f => f.kind !== 'box-start' && f.kind !== 'box-end') },
      inspection: inspection === null ? null : { ...inspection, geometry: inspection.geometry === null ? null : {
        ...inspection.geometry, frames: inspection.geometry.frames.filter(f => f.kind !== 'inline'),
      } },
    })
    start = filled.next
  }
  return { lines, edges, inlineFrames }
}

test('source depth does not become the reflow, placement or inspection call-stack depth', () => {
  const depth = 16_384
  for (const shape of ['letter', 'bidi', 'justify', 'completed-span-before-tab'] as const) for (const inspected of [false, true]) {
    const p = paragraph([], shape === 'justify' ? { textAlign: 'justify' } : shape === 'completed-span-before-tab' ? { whiteSpace: 'pre-wrap' } : {})
    const inside: InlineNode[] = [{ kind: 'text', text: shape === 'letter' ? 'a' : shape === 'bidi' ? 'aא bב' : 'a b c d' }]
    const after: InlineNode[] = shape === 'completed-span-before-tab' ? [{ kind: 'text', text: '\tend' }] : []
    const shallow = observed({ ...p, content: [...inside, ...after] }, inspected)
    const deep = observed({ ...p, content: [...nested(p, depth, inside), ...after] }, inspected)
    expect(deep.lines).toEqual(shallow.lines)
    expect(deep.edges).toBe(2 * depth)
    if (inspected) expect(deep.inlineFrames).toBeGreaterThanOrEqual(depth)
  }
})

test('line whitespace participation reads a compiled whole-node fact rather than rescanning every future character', () => {
  const n = 512, p = prepare(paragraph([{ kind: 'text', text: ' '.repeat(n) }], { whiteSpace: 'break-spaces', textAlign: 'justify' }), env, false, createContextPool())
  const source = p.text
  let reads = 0
  // A local source view preserves every String operation. Count actual character reads after preparation without a
  // host-timing threshold or a production instrumentation hook.
  p.text = new Proxy(Object(source) as object, { get(target, key) {
    if (key === 'charCodeAt') return (at: number): number => { reads++; return source.charCodeAt(at) }
    const value: unknown = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(source) : value
  } }) as unknown as string
  let lines = 0, painted = ''
  for (let start = firstLine(p); start !== null;) {
    const filled = fillLine(p, start, { width: 15, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    for (const f of linePieces(p, filled.line).fragments) if (f.kind === 'text') painted += f.painted
    lines++; start = filled.next
  }
  expect(lines).toBe(n)
  expect(painted).toBe(source)
  expect(reads).toBeLessThan(32 * n)
})

test('whole-node whitespace classification preserves later source text in early-line justification', () => {
  const firstWidth = (text: string): number => {
    const p = prepare(paragraph([{ kind: 'text', text }], { whiteSpace: 'break-spaces', textAlign: 'justify' }), env, true, createContextPool())
    const filled = fillLine(p, firstLine(p)!, { width: 25, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('unexpected refusal')
    return inspectLine(p, filled.line).geometry!.width
  }
  expect(firstWidth(' '.repeat(8))).toBe(20 * 60)
  expect(firstWidth(' '.repeat(8) + 'a')).toBe(25 * 60)
})
