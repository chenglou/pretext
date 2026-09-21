import { beforeEach, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { prepare } from './index.js'
import { measure16 } from './shape.js'

let asked: string[] = [], largeAnswers = false
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked.push(text)
    return { width: largeAnswers ? (text === 'a' ? 2 ** 44 : 1 / 512) : text.length * .0001,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeEach(() => {
  asked = []; largeAnswers = false
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(text: string): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

test('preparing thousands of alternating LTR script segments completes with every original segment question', () => {
  const text = 'aक'.repeat(8192)
  const p = prepare(paragraph(text), env, false, createContextPool())
  expect(p.text).toBe(text)
  expect(p.groups.length).toBe(1)
  expect(asked.length).toBe(text.length)
  expect(asked.every((segment, i) => segment === (i % 2 === 0 ? 'a' : 'क'))).toBe(true)
  expect(p.groups[0]!.prefixAtCut).toEqual([0, 7 * text.length])
})

test('cross-script questions stay in source order and retain the right-associated measured total', () => {
  const p = prepare(paragraph('aकb'), env, false, createContextPool())
  asked = []; largeAnswers = true
  const width = measure16({ p, gaps: null }, 0, 0, p.text.length, 0, p.text.length)
  expect(asked).toEqual(['a', 'क', 'b'])
  // Per-segment raw widths are 2^60, 128, 128. Their original right-associated total includes 256;
  // summing each small width into the huge prefix would round both away.
  expect(width).toBe(2 ** 60 + 256)
})
