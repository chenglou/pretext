// The stand-in Canvas: the engines' capability checks pass on it, and its widths depend on what a wrong data flow would
// mix up (the text around a character, U+200D, the context's letter spacing, language and font list).
import { afterEach, describe, expect, test } from 'bun:test'
import { missingCanvasSupport } from '../src/measure/canvas-checks.ts'
import { installStandInCanvas, type StandIn } from './stand-in-canvas.ts'

const AGENTS = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
} as const
type Engine = keyof typeof AGENTS

let installed: StandIn | null = null
afterEach(() => {
  installed?.restore()
  installed = null
})

function canvas(engine: Engine, pageLang = 'en'): (text: string, settings?: Record<string, string>) => TextMetrics {
  installed = installStandInCanvas({ userAgent: AGENTS[engine], devicePixelRatio: 2, pageLang })
  return (text, settings = {}) => {
    const context = new OffscreenCanvas(1, 1).getContext('2d') as unknown as Record<string, string> & { measureText: (text: string) => TextMetrics }
    context['font'] = '16px Arial'
    for (const [name, value] of Object.entries(settings)) context[name] = value
    return context.measureText(text)
  }
}

describe('the stand-in Canvas', () => {
  test('every engine\'s capability checks pass, and WebKit\'s context has no lang', () => {
    for (const engine of ['blink', 'gecko', 'webkit'] as const) {
      canvas(engine)
      expect(missingCanvasSupport(engine)).toEqual([])
      expect('lang' in new OffscreenCanvas(1, 1).getContext('2d')!).toBe(engine !== 'webkit')
      installed!.restore()
    }
  })

  test('the same question has the same answer, in any context with the same settings', () => {
    const measure = canvas('blink')
    expect(measure('The quick brown fox').width).toBe(measure('The quick brown fox').width)
    expect(measure('The quick brown fox').width).toBeGreaterThan(100)
  })

  test('a width is not the sum of its parts: kerning, ligatures and Arabic joining read the neighbours', () => {
    for (const engine of ['blink', 'gecko', 'webkit'] as const) {
      const measure = canvas(engine)
      expect(measure('fi').width).toBeLessThan(measure('f').width + measure('i').width)
      expect(measure('بب').width).toBeLessThan(2 * measure('ب').width)
      let kerned = 0
      for (const pair of ['AV', 'To', 'We', 'ry', 'Yo', 'LT', 'Pa', 'ov', 'ck', 'xe', 'Ta', 'Wa', 'ye', 'r.', 'f,']) if (measure(pair).width !== measure(pair[0]!).width + measure(pair[1]!).width) kerned++
      expect(kerned).toBeGreaterThan(0)
      expect(measure('AV', { fontKerning: 'none' }).width).toBeCloseTo(measure('A', { fontKerning: 'none' }).width + measure('V', { fontKerning: 'none' }).width, 4)
      installed!.restore()
    }
  })

  test('U+200D has no width of its own and changes the width of the letter it joins', () => {
    const measure = canvas('blink')
    expect(measure('‍').width).toBe(0)
    expect(measure('a‍b').width).toBe(measure('ab').width - (measure('ab').width - measure('a').width - measure('b').width))
    expect(measure('ب‍').width).toBeLessThan(measure('ب').width)
    expect(measure('\u{1f469}‍\u{1f469}').width).toBe(measure('\u{1f469}').width)
  })

  test('letter spacing is per spaced character and turns ligatures off, except in WebKit; the engines\' own units hold', () => {
    const blink = canvas('blink')
    expect(blink('nnnn', { letterSpacing: '0.015625px' }).width - blink('nnnn').width).toBe(4 * 0.015625)
    expect(blink('fi', { letterSpacing: '1px' }).width).toBe(blink('f', { letterSpacing: '1px' }).width + blink('i', { letterSpacing: '1px' }).width)
    expect(blink('é', { letterSpacing: '1px' }).width).toBe(blink('e', { letterSpacing: '1px' }).width)
    installed!.restore()
    const gecko = canvas('gecko')
    const spaced = gecko('nnnn', { letterSpacing: '0.001px' })
    expect(spaced.width).toBe(gecko('nnnn').width)
    expect(spaced.actualBoundingBoxRight).toBe(gecko('nnnn').actualBoundingBoxRight)
    expect(Number.isInteger(Math.round(gecko('Hamburg').width * 60 * 1e6) / 1e6)).toBe(true)
    installed!.restore()
    const webkit = canvas('webkit')
    expect(webkit('fi', { letterSpacing: '1px' }).width).toBeLessThan(webkit('f', { letterSpacing: '1px' }).width + webkit('i', { letterSpacing: '1px' }).width)
    expect(webkit('Hamburg').width).toBe(Math.fround(webkit('Hamburg').width))
  })

  test('a family that is missing or lacks the character falls through the list, and a generic draws Han by language', () => {
    const measure = canvas('blink')
    const drawnBy = (family: string, text: string): boolean => measure(text, { font: `16px ${family}, monospace` }).width === measure(text, { font: `16px ${family}, serif` }).width
    const names = Array.from({ length: 40 }, (_, i) => `Family ${i}`)
    const present = names.filter(name => drawnBy(name, ' '))
    expect(present.length).toBeGreaterThan(20)
    expect(present.length).toBeLessThan(40)
    expect(present.filter(name => !drawnBy(name, '‐')).length).toBeGreaterThan(0)
    expect(measure('中', { font: '16px serif', lang: 'ja' }).width).toBe(16)
    const ink = measure('「', { font: '16px serif' })
    expect(ink.actualBoundingBoxLeft).toBe(-8)
  })

  test('counts the questions: calls, distinct (context, string) pairs and contexts', () => {
    installed = installStandInCanvas({ userAgent: AGENTS.blink, devicePixelRatio: 2, pageLang: 'en' })
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    context.font = '16px Arial'
    context.measureText('a')
    context.measureText('a')
    context.measureText('b')
    expect(installed.asked()).toEqual({ calls: 3, distinct: 2, contexts: 1, characters: 3 })
    installed.reset()
    expect(installed.asked().calls).toBe(0)
  })
})
