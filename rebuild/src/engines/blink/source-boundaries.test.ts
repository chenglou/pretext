import { beforeEach, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { fillLine, firstLine, linePieces, prepare } from './index.js'
import { lineSourceRange } from './pieces.js'

let asks = 0
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asks++
    return { width: text.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeEach(() => {
  asks = 0
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

test('source-free forced lines keep zero source ranges and materialize every original BR', () => {
  const input = paragraph(), count = 2048
  for (let i = 0; i < count; i++) input.content.push({ kind: 'br' })
  const p = prepare(input, env, false, createContextPool())
  let token = firstLine(p), lines = 0, fragments = 0
  while (token !== null) {
    const filled = fillLine(p, token, { width: 100, left: 0, right: 0 })
    if (filled.kind !== 'line') throw Error('a slot without insets gives a line')
    expect([filled.start, filled.end]).toEqual([0, 0])
    fragments += linePieces(p, filled.line).fragments.filter(fragment => fragment.kind === 'br').length
    lines++; token = filled.next
  }
  expect([lines, fragments, asks]).toEqual([count, count, 0])
})

test('mapped source, collapse and generated-only intervals tile source exactly through EOF', () => {
  const input = paragraph(), count = 64
  input.content.push({ kind: 'text', text: '  a  ' })
  for (let i = 0; i < count; i++) input.content.push({ kind: 'br' })
  input.content.push({ kind: 'text', text: ' b ' })
  for (let i = 0; i < count; i++) input.content.push({ kind: 'wbr' })
  for (let i = 0; i < count; i++) input.content.push({ kind: 'br' })
  const p = prepare(input, env, false, createContextPool())
  // Every valid content endpoint agrees with the independently read source mapping, including holes and EOF.
  for (let offset = 0; offset <= p.text.length; offset++) {
    const expected = Array.from(p.sourceOffsets.slice(offset)).find(source => source >= 0) ?? p.index.text.length
    const token = { engine: 'blink' as const, itemIndex: 1, textOffset: offset, style: 0, afterForcedBreak: false,
      isPastFirstFormattedLine: true, afterLeadingFloats: false }
    expect(lineSourceRange(p, token, token)).toEqual({ start: expected, end: expected })
  }
  let token = firstLine(p), previousEnd = 0, lines = 0, painted = ''
  const ranges: [number, number][] = []
  while (token !== null) {
    const filled = fillLine(p, token, { width: 100, left: 0, right: 0 })
    if (filled.kind !== 'line') throw Error('a slot without insets gives a line')
    expect(filled.start).toBe(previousEnd)
    ranges.push([filled.start, filled.end]); previousEnd = filled.end
    for (const fragment of linePieces(p, filled.line).fragments) if (fragment.kind === 'text') painted += fragment.painted
    lines++; token = filled.next
  }
  expect(ranges[0]).toEqual([0, 6])
  expect(ranges[count - 1]).toEqual([6, 6])
  expect(ranges[count]).toEqual([6, 8])
  expect(ranges.at(-1)).toEqual([8, 8])
  expect([lines, previousEnd, painted]).toEqual([2 * count, 8, 'ab'])
})

test('a long text/atomic stream retains its atomic break opportunities, source range and fragments', () => {
  const input = paragraph(), count = 512
  for (let i = 0; i < count; i++) input.content.push({ kind: 'text', text: 'a' },
    { kind: 'atomic', width: 1, height: 1, marginInlineStart: 0, marginInlineEnd: 0 })
  const p = prepare(input, env, false, createContextPool()), token = firstLine(p)!
  asks = 0
  const filled = fillLine(p, token, { width: 1_000_000, left: 0, right: 0 })
  if (filled.kind !== 'line') throw Error('a slot without insets gives a line')
  const pieces = linePieces(p, filled.line)
  expect([filled.start, filled.end, filled.next, asks]).toEqual([0, count, null, 0])
  expect(pieces.fragments.filter(fragment => fragment.kind === 'text').length).toBe(count)
  expect(pieces.fragments.filter(fragment => fragment.kind === 'atomic').length).toBe(count)
  // The slot fits each glyph alone and not its atomic: those atomics remain separate legal break positions.
  let start = firstLine(p), lines = 0
  while (start !== null) {
    const line = fillLine(p, start, { width: 8, left: 0, right: 0 })
    if (line.kind !== 'line') throw Error('a slot without insets gives a line')
    lines++; start = line.next
  }
  expect(lines).toBe(2 * count)
})
