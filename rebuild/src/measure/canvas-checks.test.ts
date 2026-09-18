// detectEngine's Canvas checks against stand-in contexts. What the browsers answer, the pinned ones and one whose Canvas
// lacks `lang` and keeps a 0.001px letter spacing as a fraction, is rebuild/probes/canvas-checks.ts.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { detectEngine, detectEnvironment, type EngineName } from '../env.ts'
import { missingCanvasSupport } from './canvas-checks.ts'

const USER_AGENTS: Record<EngineName, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
}

// A stand-in Canvas: which context attributes exist, whether TextMetrics has the ink box, and the width and the ink box's
// right edge of `letters` letters, each 8px wide, under a letter spacing.
type StandIn = { attributes: readonly string[]; inkBox: boolean; measure: (letters: number, spacingPx: number) => { width: number; right: number } }

const ALL_ATTRIBUTES = ['lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']
// Blink adds the spacing to each character in 16.16 units, Gecko in app units, WebKit as a float.
const perCharacter = (spacing: (px: number) => number) => (letters: number, px: number): { width: number; right: number } => ({ width: letters * (8 + spacing(px)), right: letters * 8 + (letters - 1) * spacing(px) })
const BLINK: StandIn = { attributes: ALL_ATTRIBUTES, inkBox: true, measure: perCharacter(px => Math.trunc(px * 65536) / 65536) }
const GECKO: StandIn = { attributes: ALL_ATTRIBUTES, inkBox: true, measure: perCharacter(px => Math.round(px * 60) / 60) }
const WEBKIT: StandIn = { attributes: ['letterSpacing', 'wordSpacing', 'direction'], inkBox: true, measure: perCharacter(px => px) }
// A Canvas that keeps the spacing as a fraction and rounds the total to app units: two letters measure the same under
// 0.001px, and only the ink box shows it.
const FRACTION_KEPT: StandIn['measure'] = (letters, px) => ({ width: Math.round(letters * (8 + px) * 60) / 60, right: letters * 8 + (letters - 1) * px })

let measureTextCalls = 0
let contexts = 0
// The context's textRendering at each measureText call ('' is the stand-in's untouched default).
let renderingAtMeasure: unknown[] = []

function canvasOf(standIn: StandIn): unknown {
  return class {
    getContext(): object {
      contexts++
      const context: Record<string, unknown> = {
        font: '10px sans-serif',
        measureText(this: Record<string, unknown>, text: string): object {
          measureTextCalls++
          renderingAtMeasure.push(this['textRendering'])
          const spacing = typeof this['letterSpacing'] === 'string' && standIn.attributes.includes('letterSpacing') ? Number.parseFloat(this['letterSpacing']) : 0
          const measured = standIn.measure(text.length, spacing)
          return standIn.inkBox ? { width: measured.width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: measured.right } : { width: measured.width }
        },
      }
      for (let i = 0; i < standIn.attributes.length; i++) context[standIn.attributes[i]!] = standIn.attributes[i] === 'letterSpacing' ? '0px' : ''
      return context
    }
  }
}

const globals = globalThis as Record<string, unknown>
const NAMES = ['OffscreenCanvas', 'navigator', 'window', 'document']
let before: Array<PropertyDescriptor | undefined> = []

function page(engine: EngineName, standIn: StandIn | null): void {
  const define = (name: string, value: unknown): void => { Object.defineProperty(globals, name, { value, configurable: true, writable: true }) }
  define('navigator', { userAgent: USER_AGENTS[engine] })
  define('window', { devicePixelRatio: 2 })
  define('document', { documentElement: { lang: 'en' } })
  if (standIn === null) delete globals['OffscreenCanvas']
  else define('OffscreenCanvas', canvasOf(standIn))
}

beforeEach(() => {
  before = NAMES.map(name => Object.getOwnPropertyDescriptor(globals, name))
  measureTextCalls = 0
  contexts = 0
  renderingAtMeasure = []
})
afterEach(() => {
  for (let i = 0; i < NAMES.length; i++) {
    if (before[i] === undefined) delete globals[NAMES[i]!]
    else Object.defineProperty(globals, NAMES[i]!, before[i]!)
  }
})

describe('Canvas checks at engine detection', () => {
  test('a Canvas with what each port measures with is supported, for two contexts and two measureText calls at most', () => {
    const pages: Array<[EngineName, StandIn]> = [['blink', BLINK], ['gecko', GECKO], ['webkit', WEBKIT]]
    for (let i = 0; i < pages.length; i++) {
      page(pages[i]![0], pages[i]![1])
      measureTextCalls = 0
      contexts = 0
      expect(detectEngine()).toEqual({ kind: 'supported', engine: pages[i]![0] })
      expect(measureTextCalls).toBeLessThanOrEqual(2)
      expect(contexts).toBeLessThanOrEqual(2)
    }
  })

  test('a Canvas without lang that keeps a 0.001px letter spacing as a fraction is refused, and each lack is named', () => {
    page('gecko', { attributes: ['letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'], inkBox: true, measure: FRACTION_KEPT })
    expect(FRACTION_KEPT(2, 0.001).width).toBe(16)
    const detected = detectEngine()
    expect(detected.kind).toBe('unsupported')
    if (detected.kind !== 'unsupported') return
    expect(detected.reason).toContain('the context attribute lang')
    expect(detected.reason).toContain("a letter spacing of 0.001px that adds 0px to each character's width (here it adds ")
    expect(detected.reason).toContain('a letter spacing of 0.001px that leaves the ink box where it was')
    // With lang, the spacing alone refuses it.
    page('gecko', { ...GECKO, measure: FRACTION_KEPT })
    expect(missingCanvasSupport('gecko')).toHaveLength(2)
  })

  test('each port names what its own recipes set', () => {
    page('blink', { attributes: ['direction'], inkBox: false, measure: BLINK.measure })
    expect(missingCanvasSupport('blink')).toEqual(['the context attribute lang', 'the context attribute letterSpacing', 'the context attribute textRendering', 'TextMetrics.actualBoundingBoxLeft and actualBoundingBoxRight'])
    // Blink's recipes cancel the spacing in 16.16 units: a Canvas that adds anything but 1/64 px a character is refused.
    page('blink', { ...BLINK, measure: perCharacter(px => px * 2) })
    expect(missingCanvasSupport('blink')).toEqual(["a letter spacing of 0.015625px that adds 0.015625px to each character's width (here it adds 0.03125px)"])
    // WebKit's context has no lang or textRendering, and its port doesn't need the ink box.
    page('webkit', { ...WEBKIT, inkBox: false })
    expect(missingCanvasSupport('webkit')).toEqual([])
    page('webkit', { attributes: ['direction'], inkBox: true, measure: WEBKIT.measure })
    expect(missingCanvasSupport('webkit')).toEqual(['the context attribute letterSpacing', 'the context attribute wordSpacing'])
  })

  test("Blink's check measures at the port's own text rendering, off the font cache key of the page's default text", () => {
    page('blink', BLINK)
    expect(missingCanvasSupport('blink')).toEqual([])
    expect(renderingAtMeasure).toEqual(['optimizeLegibility', 'optimizeLegibility'])
    renderingAtMeasure = []
    page('gecko', GECKO)
    expect(missingCanvasSupport('gecko')).toEqual([])
    expect(renderingAtMeasure).toEqual(['', ''])
  })

  test('no OffscreenCanvas is named', () => {
    page('blink', null)
    expect(detectEngine()).toMatchObject({ kind: 'unsupported', reason: "this browser's Canvas lacks what the blink port measures with: OffscreenCanvas" })
  })

  test('detectEnvironment asks Canvas nothing, so a page can call it again', () => {
    page('gecko', GECKO)
    const detected = detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: 'en-us' })
    expect(detected.kind).toBe('supported')
    expect(measureTextCalls).toBe(0)
    expect(contexts).toBe(0)
  })
})
