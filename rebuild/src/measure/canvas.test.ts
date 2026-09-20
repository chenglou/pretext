// measure/canvas.ts hands Canvas the string its caller built, asks a context each question once, and keys a stored answer by
// the text or by the key its caller gave instead. bun can't see a string's storage, so the test watches the keys: a Map or
// Set lookup of a measured string that came with another key would show as a key that is that object. In Chrome the same is
// pinned by storage (probes/blink-storage.ts S5).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bounds, contextFor, MAX_ANSWERS, width, type CanvasSettings, type Context } from './canvas.js'

const SETTINGS: CanvasSettings = { font: '16px x', lang: 'en', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '' }

let asked: string[] = []
let saved: unknown

beforeEach(() => {
  asked = []
  saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
  class Context {
    font = ''; lang = ''; letterSpacing = ''; wordSpacing = ''; fontKerning = ''; textRendering = ''; direction = ''
    measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
      asked.push(text)
      return { width: text.length * 10, actualBoundingBoxLeft: 1, actualBoundingBoxRight: text.length * 10 - 1 }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})

afterEach(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = saved
})

// Every string used as a Map or Set key while `run` runs.
function keysDuring(run: () => void): string[] {
  const keys: string[] = []
  const names = ['get', 'has', 'set', 'delete'] as const
  const mapOriginals = names.map(name => Map.prototype[name])
  const setOriginals = (['has', 'add', 'delete'] as const).map(name => Set.prototype[name])
  const note = (key: unknown): void => { if (typeof key === 'string') keys.push(key) }
  try {
    names.forEach((name, i) => { (Map.prototype as unknown as Record<string, unknown>)[name] = function (this: Map<unknown, unknown>, ...args: unknown[]): unknown { note(args[0]); return (mapOriginals[i] as (...a: unknown[]) => unknown).apply(this, args) } })
    ;(['has', 'add', 'delete'] as const).forEach((name, i) => { (Set.prototype as unknown as Record<string, unknown>)[name] = function (this: Set<unknown>, ...args: unknown[]): unknown { note(args[0]); return (setOriginals[i] as (...a: unknown[]) => unknown).apply(this, args) } })
    run()
  } finally {
    names.forEach((name, i) => { (Map.prototype as unknown as Record<string, unknown>)[name] = mapOriginals[i] })
    ;(['has', 'add', 'delete'] as const).forEach((name, i) => { (Set.prototype as unknown as Record<string, unknown>)[name] = setOriginals[i] })
  }
  return keys
}

describe('contextFor, width and bounds', () => {
  test('a context asks Canvas a string once, for its width and for its ink box apart', () => {
    const contexts: Context[] = []
    const text = '((((((((((((('
    const keys = keysDuring(() => {
      const context = contextFor(contexts, SETTINGS)
      expect(width(context, text)).toBe(130)
      expect(width(contextFor(contexts, { ...SETTINGS }), text)).toBe(130)
      expect(bounds(context, text)).toEqual({ width: 130, left: 1, right: 129 })
      expect(bounds(context, text)).toEqual({ width: 130, left: 1, right: 129 })
      expect(width(contextFor(contexts, { ...SETTINGS, partition: '16bit' }), text)).toBe(130)
    })
    expect(asked).toEqual([text, text, text])
    expect(keys).toEqual([text, text, text, text, text, text, text, text])
    expect(contexts.length).toBe(2)
  })

  test('a text that comes with a key is never a key itself', () => {
    const context = contextFor([], SETTINGS)
    const text = ['((((((', '((((((('].join('')
    const key = '((((((' + '((((((('
    const keys = keysDuring(() => {
      expect(width(context, text, key)).toBe(130)
      expect(width(context, text, key)).toBe(130)
    })
    expect(asked.length).toBe(1)
    expect(asked[0]).toBe(text)
    expect(keys.length).toBe(3)
    // Object.is can't tell two equal strings apart, so the test reads which object was handed over from the call's order:
    // the key is what every lookup got, and measureText got the text.
    expect(keys.every(k => k === key)).toBe(true)
  })

  test('a context that holds MAX_ANSWERS answers forgets them all', () => {
    const context = contextFor([], SETTINGS)
    for (let i = 0; i < MAX_ANSWERS; i++) width(context, `w${i}`)
    expect(context.widths.size).toBe(MAX_ANSWERS)
    width(context, 'one more')
    expect(context.widths.size).toBe(1)
    const before = asked.length
    width(context, 'w0')
    expect(asked.length).toBe(before + 1)
  })

  test('a context is found by every setting, the partition too', () => {
    const contexts: Context[] = []
    const names = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'partition'] as const
    const first = contextFor(contexts, SETTINGS)
    for (let i = 0; i < names.length; i++) expect(contextFor(contexts, { ...SETTINGS, [names[i]!]: 'rtl' })).not.toBe(first)
    expect(contexts.length).toBe(names.length + 1)
    expect(contextFor(contexts, { ...SETTINGS })).toBe(first)
  })
})
