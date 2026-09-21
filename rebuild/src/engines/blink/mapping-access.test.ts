import { beforeAll, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { createContextPool } from '../../measure/canvas.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, firstLine, inspectLine, prepare } from './index.js'

let asks = 0
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; direction = 'ltr'
  fontKerning = 'auto'; textRendering = 'auto'
  measureText(text: string) {
    asks++
    return { width: text.length * 8, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null,
  uiLanguage: 'en', dictionaryBreaks: { kind: 'unavailable' },
}

test('many source-free lines retain the collapsed source mapping without rescanning its suffix', () => {
  const count = 512
  const paragraph: Paragraph = {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS },
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
    lineBreak: 'auto', tabSize: 8, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
    content: [{ kind: 'text', text: 'a' + ' '.repeat(count) }, ...Array.from({ length: count }, () => ({ kind: 'br' as const }))],
  }
  asks = 0
  const p = prepare(paragraph, env, true, createContextPool())
  expect(asks).toBe(1)
  let reads = 0
  p.contentOffsets = new Proxy(p.contentOffsets, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, target)
    },
  })
  let start = firstLine(p), lines = 0, mappingUnits = 0, items = 0
  while (start !== null) {
    const result = fillLine(p, start, { width: 1_000_000, left: 0, right: 0 })
    if (result.kind !== 'line') throw new Error('unrestricted line refused')
    const geometry = inspectLine(p, result.line).geometry!
    if (lines === 0) expect(geometry.mapping).toEqual([
      { run: 0, start: 0, end: 1, textStart: 0, textEnd: 1, collapsed: false },
      { run: 0, start: 1, end: count + 1, textStart: 1, textEnd: 1, collapsed: true },
    ])
    mappingUnits += geometry.mapping.length
    items += geometry.items.length
    lines++
    start = result.next
  }
  expect(lines).toBe(count)
  expect(mappingUnits).toBe(2)
  expect(items).toBe(count + 1)
  expect(asks).toBe(1)
  expect(reads).toBeLessThanOrEqual(8 * count)
})
