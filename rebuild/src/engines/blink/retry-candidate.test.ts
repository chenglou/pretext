import { expect, test } from 'bun:test'
import { createContextPool } from '../../measure/canvas.js'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { fillLine, fillLineRange, firstLine, prepare } from './index.js'

const environment: BlinkEnvironment = { engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1,
  pageLang: 'en', contentLanguage: null, uiLanguage: 'en', dictionaryBreaks: { kind: 'unavailable' } }

function paragraph(text: string): Paragraph {
  return { font: { family: 'RetryTest', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS },
    content: [{ kind: 'text', text }], letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, lineHeight: 20, direction: 'ltr', lang: 'en',
    textIndent: 0, textAlign: 'start' }
}

function onCanvas<T>(work: () => T): T {
  class Context {
    font = '16px RetryTest'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto';
    textRendering = 'auto'; direction = 'ltr'
    measureText(text: string) {
      let count = 0
      for (const character of text) if (!/^[\p{Mark}\p{Default_Ignorable_Code_Point}]$/u.test(character)) count++
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16)
      const width = count * (8 * size / 16 + Number.parseFloat(this.letterSpacing))
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas')
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class { getContext() { return new Context() } } })
  try { return work() }
  finally {
    if (original === undefined) delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
    else Object.defineProperty(globalThis, 'OffscreenCanvas', original)
  }
}

function cuts(p: ReturnType<typeof prepare>, width: number, range: boolean) {
  const records = []
  for (let start = firstLine(p); start !== null;) {
    const result = range ? fillLineRange(p, start, { width, left: 0, right: 0 }) : fillLine(p, start, { width, left: 0, right: 0 })
    if (result.kind !== 'line') throw new Error('unexpected float refusal')
    records.push({ start: result.start, end: result.end, next: result.next, hasLineBox: result.hasLineBox })
    start = result.next
  }
  return records
}

// Count a prepared fact's actual numeric reads, without changing any string, global prototype or production function.
function countedPrefixes<T>(p: ReturnType<typeof prepare>, work: () => T): { result: T; reads: number } {
  let reads = 0
  const originals = p.groups.map(group => group.prefix16)
  for (const group of p.groups) group.prefix16 = new Proxy(group.prefix16, {
    get(target, key) {
      if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)) reads++
      return Reflect.get(target, key, target)
    },
    set(target, key, value) { return Reflect.set(target, key, value, target) },
  })
  try { return { result: work(), reads } }
  finally { p.groups.forEach((group, i) => { group.prefix16 = originals[i]! }) }
}

test('plain overflow fallback does not repeat the whole-item position search', () => onCanvas(() => {
  for (const range of [false, true]) {
    const p = prepare(paragraph('abcd'.repeat(128)), environment, false, createContextPool())
    const expected = cuts(p, 16, range)
    const start = firstLine(p)!
    const observed = countedPrefixes(p, () => range ? fillLineRange(p, start, { width: 16, left: 0, right: 0 }) : fillLine(p, start, { width: 16, left: 0, right: 0 }))
    expect(observed.result.kind).toBe('line')
    if (observed.result.kind !== 'line') throw new Error('expected a line')
    expect(observed.result.end).toBe(2)
    // A first line should not walk the same whole-item binary search twice after falling back to character breaks.
    expect(observed.reads).toBeLessThanOrEqual(30)
    expect(observed.reads).toBeGreaterThan(0)
    expect(cuts(p, 16, range)).toEqual(expected)
  }
}))

test('width, indentation, rich edges and forced breaks keep independent continuation decisions', () => onCanvas(() => {
  const source = paragraph('abcdefgh\u00adijklmnop\nqrstuv')
  source.whiteSpace = 'pre-line'
  source.textIndent = 40
  source.content = [{ kind: 'span', font: source.font, letterSpacing: 0, wordSpacing: 0, whiteSpace: source.whiteSpace,
    wordBreak: source.wordBreak, overflowWrap: source.overflowWrap, lineBreak: source.lineBreak, tabSize: 8,
    lang: null, inlineStart: { margin: 0, border: 0, padding: 3 }, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline',
    children: source.content }]
  const retained = prepare(source, environment, false, createContextPool())
  for (const width of [16, 48, 24, 96, 16]) {
    const fresh = prepare(source, environment, false, createContextPool())
    expect(cuts(retained, width, false)).toEqual(cuts(fresh, width, true))
  }
}))
