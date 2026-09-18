// The measurer hands Canvas the string its caller built and never uses that string as a key. bun can't see a string's
// storage, so the test watches the keys: any Map, Set or property lookup of the measured string would show as a key with
// its characters. In Chrome the same is pinned by storage (probes/blink-storage.ts S5).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createMeasurer, measureContext, measureText, type CanvasSettings } from './canvas.js'

const SETTINGS: CanvasSettings = { font: '16px x', lang: 'en', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '' }

let asked: string[] = []
let saved: unknown

beforeEach(() => {
  asked = []
  saved = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
  class Context {
    font = ''; lang = ''; letterSpacing = ''; wordSpacing = ''; fontKerning = ''; textRendering = ''; direction = ''
    measureText(text: string): { width: number } {
      asked.push(text)
      return { width: text.length * 10 }
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

describe('measureText', () => {
  test('never looks the measured string up: no key holds its characters alone', () => {
    const m = createMeasurer()
    const context = measureContext(m, SETTINGS)
    const text = '((((((((((((('
    const keys = keysDuring(() => {
      expect(measureText(m, context, text)).toBe(130)
      expect(measureText(m, context, text)).toBe(130)
    })
    expect(asked).toEqual([text])
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.includes(text)).toBe(false)
    expect(m.log.memoHits).toBe(1)
    expect(m.log.calls).toEqual([{ context, text, width: 130 }])
  })

  test('the memo keeps texts apart, a text that spells another text\'s key too', () => {
    const m = createMeasurer()
    const context = measureContext(m, SETTINGS)
    expect(measureText(m, context, 'a')).toBe(10)
    expect(measureText(m, context, '|a')).toBe(20)
    expect(measureText(m, context, '||a')).toBe(30)
    expect(measureText(m, context, 'a')).toBe(10)
    expect(asked).toEqual(['a', '|a', '||a'])
  })
})
