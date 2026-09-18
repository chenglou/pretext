// The runtime font checks against a stand-in Canvas whose fonts are small tables: which characters a family draws and how
// wide. The browsers' answers are rebuild/probes/font-checks.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment, type Environment, type GeckoEnvironment, type WebKitEnvironment } from '../env.ts'
import { UNKNOWN_FONT_FACTS, type FontDecl, type FontFacts, type Paragraph } from '../model.ts'
import { createMeasurer, type Measurer } from './canvas.ts'
import { withLearnedFontFacts } from './font-checks.ts'

const BEH = '\u0628'
const LAJANYALAN = '\u07fa'

type StandInFont = {
  // Advance in em of a character the font draws; undefined: not drawn.
  advance: (ch: string) => number | undefined
  // Em added to a whole string, for joined forms and size-dependent designs.
  adjust?: (text: string, size: number) => number
}

const fixed = (em: number): StandInFont => ({ advance: ch => (ch.charCodeAt(0) < 0x250 || ch === '\u2010' ? em : undefined) })
const proportional: StandInFont = { advance: ch => (ch.charCodeAt(0) >= 0x250 && ch !== '\u2010' ? undefined : ch === 'i' || ch === '.' ? 0.25 : ch === 'M' ? 0.875 : 0.5) }
const arabicWidths = (joinedEm: number): StandInFont['advance'] => ch => (ch === BEH ? joinedEm : undefined)

let fonts: Record<string, StandInFont> = {}
let calls = 0

class StandInContext {
  font = '10px sans-serif'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  measureText(text: string): { width: number } {
    calls++
    const match = /^(?:normal|italic) \d+ ([\d.]+)px (.*)$/.exec(this.font)!
    const size = Number(match[1])
    const families = match[2]!.split(',').map(f => f.trim().replace(/^"|"$/g, ''))
    let width = 0
    for (const ch of text) {
      let em = 1
      for (let f = 0; f < families.length; f++) {
        const drawn = fonts[families[f]!]?.advance(ch)
        if (drawn !== undefined) {
          em = drawn
          break
        }
      }
      width += em * size
    }
    const first = fonts[families[0]!]
    if (first?.adjust !== undefined) width += first.adjust(text, size) * size
    return { width }
  }
}

const globals = globalThis as { OffscreenCanvas?: unknown }
let previousCanvas: unknown
beforeAll(() => {
  previousCanvas = globals.OffscreenCanvas
  globals.OffscreenCanvas = class { getContext(): StandInContext { return new StandInContext() } }
})
afterAll(() => { globals.OffscreenCanvas = previousCanvas })
beforeEach(() => {
  calls = 0
  fonts = { monospace: fixed(0.625), serif: proportional, Prop: proportional, Mono: fixed(0.5) }
})

const blink = (devicePixelRatio: number): BlinkEnvironment => ({ engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio, pageLang: 'en', contentLanguage: null, uiLanguage: 'en-US', dictionaryBreaks: { kind: 'unavailable' } })
const webkit: WebKitEnvironment = { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'unavailable' } }
const gecko: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' } }

function paragraph(family: string, text: string, facts: FontFacts = UNKNOWN_FONT_FACTS, size = 16): Paragraph {
  const font: FontDecl = { family, size, weight: 400, style: 'normal', facts }
  return {
    font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lang: 'en', direction: 'ltr', width: 100, lineHeight: 20, textIndent: 0, textAlign: 'start',
  }
}

function learn(family: string, text: string, env: Environment, facts?: FontFacts, m: Measurer = createMeasurer(), size?: number): FontFacts {
  return withLearnedFontFacts(paragraph(family, text, facts, size), env, m).font.facts
}

describe('primaryFamily', () => {
  test('the first listed family that draws the space, named as the list names it', () => {
    expect(learn('Missing, "Prop", serif', 'ab', webkit).primaryFamily).toBe('Prop')
    expect(learn('sans-serif', 'ab', webkit).primaryFamily).toBe(null)
    expect(learn('serif', 'ab', webkit).primaryFamily).toBe('serif')
  })

  test('null where the two generics give the space one width', () => {
    fonts['monospace'] = proportional
    expect(learn('Prop', 'ab', webkit).primaryFamily).toBe(null)
  })

  test('a quoted family named like a generic keyword can\'t be named', () => {
    fonts['system-ui'] = proportional
    expect(learn('"system-ui"', 'ab', webkit).primaryFamily).toBe(null)
    expect(learn('system-ui', 'ab', webkit).primaryFamily).toBe('system-ui')
  })
})

describe('supplied facts', () => {
  test('are returned as given and cost no Canvas call', () => {
    const given: FontFacts = { primaryFamily: 'Other', mapsHyphen: false, monospace: true, opticalSizeAxis: true, joining: 'aat', pairKerning: 'split' }
    expect(learn('Prop', `a\u00adb${BEH}`, blink(2), given)).toEqual(given)
    expect(learn('Prop', `a\u00adb${BEH}`, webkit, given)).toEqual(given)
    expect(calls).toBe(0)
  })

  test('a fact the engine doesn\'t read isn\'t asked', () => {
    expect(learn('Mono', `a\u00adb${BEH}`, gecko)).toEqual(UNKNOWN_FONT_FACTS)
    // Blink at zoom 1 reads the primary family for nothing a Latin paragraph without a soft hyphen needs.
    expect(learn('Mono', 'ab', blink(1))).toEqual(UNKNOWN_FONT_FACTS)
    expect(calls).toBe(0)
    expect(learn('Mono', 'ab', blink(2))).toEqual({ ...UNKNOWN_FONT_FACTS, primaryFamily: 'Mono', opticalSizeAxis: false })
  })
})

describe('mapsHyphen', () => {
  test('asked only of a paragraph with a soft hyphen', () => {
    expect(learn('Prop', 'ab', webkit).mapsHyphen).toBe(null)
    expect(learn('Prop', 'a\u00adb', webkit).mapsHyphen).toBe(true)
  })

  test('false where a fallback draws U+2010', () => {
    fonts['NoHyphen'] = { advance: ch => (ch === '\u2010' ? undefined : 0.5) }
    expect(learn('NoHyphen', 'a\u00adb', blink(1)).mapsHyphen).toBe(false)
  })
})

describe('monospace (WebKit)', () => {
  test('equal sample advances', () => {
    expect(learn('Mono', 'ab', webkit).monospace).toBe(true)
    expect(learn('Prop', 'ab', webkit).monospace).toBe(false)
    expect(learn('Mono', 'ab', blink(2)).monospace).toBe(null)
  })

  test('null where the primary family doesn\'t draw the sample', () => {
    fonts['ArabicOnly'] = { advance: ch => (ch === ' ' || ch === BEH ? 0.5 : undefined) }
    expect(learn('ArabicOnly', 'ab', webkit).monospace).toBe(null)
  })
})

describe('opticalSizeAxis (Blink)', () => {
  test('false where advances scale between the CSS size and the zoomed size', () => {
    expect(learn('Prop', 'ab', blink(2)).opticalSizeAxis).toBe(false)
  })

  test('not asked at zoom 1, and null for a design that changes with the size', () => {
    expect(learn('Prop', 'ab', blink(1)).opticalSizeAxis).toBe(null)
    fonts['Optical'] = { ...proportional, adjust: (_text, size) => size / 1000 }
    expect(learn('Optical', 'ab', blink(2)).opticalSizeAxis).toBe(null)
  })

  test('the system UI font is never measured at the zoomed size', () => {
    fonts['system-ui'] = proportional
    const m = createMeasurer()
    expect(learn('system-ui', 'ab', blink(2), undefined, m).opticalSizeAxis).toBe(null)
    expect(m.log.contexts.every(c => / 16px /.test(c.font))).toBe(true)
  })
})

describe('joining (Blink)', () => {
  const contextual = (font: StandInFont['advance'], change: number, inCall: number): StandInFont => ({
    advance: font,
    adjust: text => (text === BEH + LAJANYALAN || text === LAJANYALAN + BEH ? change : text === BEH + BEH ? inCall : 0),
  })

  test('asked only of a paragraph with letters of a joining script', () => {
    fonts['Naskh'] = contextual(arabicWidths(0.75), -0.25, -0.25)
    expect(learn('Naskh', 'ab', blink(1)).joining).toBe(null)
    expect(learn('Naskh', BEH, blink(1)).joining).toBe('opentype')
    expect(learn('Naskh', BEH, webkit).joining).toBe(null)
  })

  test('aat where context changes nothing and the font has joined forms of another width', () => {
    fonts['Geeza'] = contextual(arabicWidths(0.75), 0, -0.25)
    expect(learn('Geeza', BEH, blink(1)).joining).toBe('aat')
  })

  test('null where joined forms are as wide as isolated ones, or U+07FA\'s own forms change width', () => {
    fonts['FixedArabic'] = contextual(arabicWidths(0.5), 0, 0)
    expect(learn('FixedArabic', BEH, blink(1)).joining).toBe(null)
    fonts['Naskh'] = contextual(arabicWidths(0.75), -0.25, -0.25)
    fonts['NKo'] = { advance: ch => (ch === LAJANYALAN ? 0.5 : undefined), adjust: text => (text === LAJANYALAN + LAJANYALAN ? 0.125 : 0) }
    expect(learn('NKo, Naskh', BEH, blink(1)).joining).toBe(null)
  })
})

describe('the store', () => {
  test('keeps a declaration\'s answers for the measurer\'s life', () => {
    const m = createMeasurer()
    const first = learn('Prop', `a\u00adb${BEH}`, blink(2), undefined, m)
    const asked = calls
    expect(learn('Prop', `a\u00adb${BEH}`, blink(2), undefined, m)).toEqual(first)
    expect(calls).toBe(asked)
    // Another size asks only the check that reads the size.
    learn('Prop', `a\u00adb${BEH}`, blink(2), undefined, m, 20)
    expect(calls).toBe(asked + 2)
  })

  test('spans take their own declaration and language', () => {
    const p = paragraph('Prop', 'ab')
    const span = { ...p, kind: 'span' as const, font: { ...p.font, family: 'Mono' }, lang: 'ja', inlineStart: { margin: 0, border: 0, padding: 0 }, inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline' as const, children: [{ kind: 'text' as const, text: 'cd' }] }
    const m = createMeasurer()
    const out = withLearnedFontFacts({ ...p, content: [span] }, blink(2), m)
    const learned = out.content[0]!
    expect(learned.kind === 'span' && learned.font.facts.primaryFamily).toBe('Mono')
    expect(m.log.contexts.some(c => c.lang === 'ja' && c.font.includes('Mono'))).toBe(true)
  })
})
