import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type InlineNode, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, prepare } from './index.js'
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; direction = 'ltr'
  fontKerning = 'auto'; textRendering = 'auto'
  measureText(text: string) { return { width: text.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 } }
}
beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null,
  uiLanguage: 'en', dictionaryBreaks: { kind: 'unavailable' },
}

test('wrapped text reopens only ancestors that produce box fragments', () => {
  const depth = 1024, words = 32
  const p: Paragraph = {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS },
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start', content: [],
  }
  let content: InlineNode[] = [{ kind: 'text', text: 'a '.repeat(words) }]
  for (let d = 0; d < depth; d++) content = [{
    kind: 'span', font: p.font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
    verticalAlign: 'baseline', children: content,
  }]
  p.content = content
  const prepared = prepare(p, env, true, createContextPool())
  expect(prepared.styles.every(s => !s.shouldCreateBoxFragment)).toBe(true)
  let parentReads = 0
  prepared.styles = prepared.styles.map(style => new Proxy(style, {
    get(target, key, receiver) { if (key === 'parent') parentReads++; return Reflect.get(target, key, receiver) },
  }))
  let start = firstLine(prepared), lines = 0, items = 0
  while (start !== null) {
    const result = fillLine(prepared, start, { width: 9, left: 0, right: 0 })
    if (result.kind !== 'line') throw new Error('unrestricted line refused')
    const geometry = inspectLine(prepared, result.line).geometry!
    expect(geometry.items.length).toBe(1)
    expect(geometry.items[0]).toMatchObject({ kind: 'text', textStart: 2 * lines, textEnd: 2 * lines + 1, x: 0, inlineSize: 512 })
    lines++
    items += geometry.items.length
    start = result.next
  }
  expect(lines).toBe(words)
  expect(items).toBe(words)
  expect(parentReads).toBeLessThanOrEqual(8 * (depth + words))
})
