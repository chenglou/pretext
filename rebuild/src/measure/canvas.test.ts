// measure/canvas.ts hands Canvas the string its caller built and never uses that string as a key. bun can't see a string's
// storage, so the test watches the keys: any Map or Set lookup of the measured string would show as a key with its
// characters. In Chrome the same is pinned by storage (probes/blink-storage.ts S5).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bounds, contextFor, width, type CanvasSettings, type Context } from './canvas.js'

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
  test('always ask Canvas and use no key', () => {
    const contexts: Context[] = []
    const text = '((((((((((((('
    const keys = keysDuring(() => {
      const context = contextFor(contexts, SETTINGS)
      expect(width(context, text)).toBe(130)
      expect(width(contextFor(contexts, { ...SETTINGS }), text)).toBe(130)
      expect(bounds(context, text)).toEqual({ width: 130, left: 1, right: 129 })
    })
    expect(asked).toEqual([text, text, text])
    expect(keys).toEqual([])
    expect(contexts.length).toBe(1)
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
