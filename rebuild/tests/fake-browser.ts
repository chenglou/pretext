// A browser for tests that record: a fake Canvas whose widths are a fixed function of the font size and the code points,
// as the globals lab/record.ts wraps and a layout reads. replay.test.ts and function-set.test.ts record with it and replay
// what they recorded.
import { installRecorder } from '../lab/record.ts'

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
export const BUILD = { app: 'Google Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: '26A428' }
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline']

// Widths in multiples of 1/64 px.
function fakeContextClass(): new () => object {
  class Context {
    values = new Map<string, string>()
    measureText(value: string): unknown {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.values.get('font') ?? '10px')?.[1] ?? 10)
      const spacing = Number.parseFloat(this.values.get('letterSpacing') ?? '0') || 0
      let width = 0
      for (const ch of value) width += Math.round(size * (24 + (ch.codePointAt(0)! % 13)) + spacing * 64) / 64
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: size * 0.75, actualBoundingBoxDescent: size * 0.25, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.2 }
    }
  }
  for (const name of SETTINGS) {
    Object.defineProperty(Context.prototype, name, {
      configurable: true,
      get(this: Context): string { return this.values.get(name) ?? '' },
      set(this: Context, value: unknown): void { this.values.set(name, String(value)) },
    })
  }
  return Context
}

// One pair of context classes for the process: the recorder wraps the prototypes it finds the first time it is installed.
const Offscreen = fakeContextClass()
const Element = fakeContextClass()

const NAMES = ['OffscreenCanvasRenderingContext2D', 'CanvasRenderingContext2D', 'OffscreenCanvas', 'navigator', 'window', 'document']

// Installs the fake browser and the recorder over it; returns what puts the old globals back.
export function installFakeBrowser(): () => void {
  const globals = globalThis as Record<string, unknown>
  const intl = Intl as unknown as Record<string, unknown>
  const before = NAMES.map(name => Object.getOwnPropertyDescriptor(globals, name))
  const v8Before = Object.getOwnPropertyDescriptor(intl, 'v8BreakIterator')
  const define = (name: string, value: unknown): void => { Object.defineProperty(globals, name, { value, configurable: true, writable: true }) }
  define('OffscreenCanvasRenderingContext2D', Offscreen)
  define('CanvasRenderingContext2D', Element)
  define('OffscreenCanvas', class { getContext(): object { return new Offscreen() } })
  define('navigator', { userAgent: USER_AGENT })
  define('window', { devicePixelRatio: 2 })
  define('document', { documentElement: { lang: 'en' } })
  // Chrome has Intl.v8BreakIterator, and the library's environment says whether it exists.
  intl['v8BreakIterator'] = class { adoptText(): void {} first(): number { return 0 } next(): number { return -1 } current(): number { return 0 } breakType(): string { return 'none' } resolvedOptions(): unknown { return {} } }
  installRecorder()
  return () => {
    for (let i = 0; i < NAMES.length; i++) {
      const descriptor = before[i]
      if (descriptor === undefined) delete globals[NAMES[i]!]
      else Object.defineProperty(globals, NAMES[i]!, descriptor)
    }
    if (v8Before === undefined) delete intl['v8BreakIterator']
    else Object.defineProperty(intl, 'v8BreakIterator', v8Before)
  }
}
