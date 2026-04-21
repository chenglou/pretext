import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'

const FONT = '16px Test Sans'
const LINE_HEIGHT = 19

type LayoutModule = typeof import('./layout.ts')

let prepare: LayoutModule['prepare']
let prepareWithSegments: LayoutModule['prepareWithSegments']
let layout: LayoutModule['layout']
let layoutWithLines: LayoutModule['layoutWithLines']
let clearCache: LayoutModule['clearCache']
let setLocale: LayoutModule['setLocale']

class TestCanvasRenderingContext2D {
  font = ''
  measureText(text: string): { width: number } {
    return { width: text.length * 10 }
  }
}

class TestOffscreenCanvas {
  constructor(_width: number, _height: number) {}
  getContext(_kind: string): TestCanvasRenderingContext2D {
    return new TestCanvasRenderingContext2D()
  }
}

beforeAll(async () => {
  Reflect.set(globalThis, 'OffscreenCanvas', TestOffscreenCanvas)
  const mod = await import('./layout.ts')
  ;({
    prepare,
    prepareWithSegments,
    layout,
    layoutWithLines,
    clearCache,
    setLocale,
  } = mod)
})

beforeEach(() => {
  setLocale(undefined)
  clearCache()
})

describe('Unicode line break compliance', () => {
  const lineBreakers = [
    { name: 'Vertical Tab', char: '\v' },
    { name: 'Next Line', char: '\u0085' },
    { name: 'Line Separator', char: '\u2028' },
    { name: 'Paragraph Separator', char: '\u2029' },
  ]

  for (const { name, char } of lineBreakers) {
    test(`normal mode collapses ${name}`, () => {
      const prepared = prepare(`a${char}b`, FONT)
      const result = layout(prepared, 200, LINE_HEIGHT)
      expect(result.lineCount).toBe(1)
    })

    test(`pre-wrap mode treats ${name} as hard-break`, () => {
      const prepared = prepare(`a${char}b`, FONT, { whiteSpace: 'pre-wrap' })
      const result = layout(prepared, 200, LINE_HEIGHT)
      expect(result.lineCount).toBe(2)

      const rich = layoutWithLines(prepareWithSegments(`a${char}b`, FONT, { whiteSpace: 'pre-wrap' }), 200, LINE_HEIGHT)
      expect(rich.lines.map(l => l.text)).toEqual(['a', 'b'])
    })
  }
})
