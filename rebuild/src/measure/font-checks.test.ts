// The runtime font checks against a stand-in Canvas whose fonts are small tables: which characters a family draws and how
// wide. The browsers' answers are rebuild/probes/font-checks.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { blinkFontChecks } from '../engines/blink/checks.ts'
import { joiningType } from '../engines/blink/props.ts'
import { geckoFontChecks } from '../engines/gecko/checks.ts'
import { webkitFontChecks } from '../engines/webkit/checks.ts'
import { PINNED_BUILDS, type BlinkEnvironment, type Environment, type GeckoEnvironment, type WebKitEnvironment } from '../env.ts'
import { UNKNOWN_FONT_FACTS, type FontDecl, type FontFacts, type InlineNode, type Paragraph } from '../model.ts'
import { createContextPool, type ContextPool } from './canvas.ts'
import { withLearnedFontFacts, type FontChecks } from './font-checks.ts'
import { fillLine, firstLine, prepare } from '../index.ts'

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
// A stand-in context measures with the fonts of the moment, as Chrome's does. With `keepsFirstFonts` it keeps the listed
// families it found at its first measurement, as Firefox's keeps the font group whose family names it resolved then.
let keepsFirstFonts = false
let calls = 0
// Every context made since the last test began, and every question asked, in order.
let made: StandInContext[] = []
let asked: { context: StandInContext; text: string }[] = []

class StandInContext {
  font = '10px sans-serif'
  lang = ''
  letterSpacing = '0px'
  wordSpacing = '0px'
  fontKerning = 'auto'
  textRendering = 'auto'
  direction = 'ltr'
  found: string[] | null = null
  measureText(text: string): { width: number } {
    calls++
    asked.push({ context: this, text })
    const match = /^(?:normal|italic) \d+ ([\d.]+)px (.*)$/.exec(this.font)!
    const size = Number(match[1])
    const listed = match[2]!.split(',').map(f => f.trim().replace(/^"|"$/g, ''))
    if (!keepsFirstFonts || this.found === null) this.found = listed.filter(family => fonts[family] !== undefined)
    const families = this.found
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
    const first = fonts[listed[0]!]
    if (first?.adjust !== undefined) width += first.adjust(text, size) * size
    return { width }
  }
}

const globals = globalThis as { OffscreenCanvas?: unknown }
let previousCanvas: unknown
beforeAll(() => {
  previousCanvas = globals.OffscreenCanvas
  globals.OffscreenCanvas = class {
    getContext(): StandInContext {
      const context = new StandInContext()
      made.push(context)
      return context
    }
  }
})
afterAll(() => { globals.OffscreenCanvas = previousCanvas })
beforeEach(() => {
  calls = 0
  made = []
  asked = []
  keepsFirstFonts = false
  fonts = { monospace: fixed(0.625), serif: proportional, Prop: proportional, Mono: fixed(0.5) }
})

const blink = (devicePixelRatio: number): BlinkEnvironment => ({ engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio, pageLang: 'en', contentLanguage: null, uiLanguage: 'en-US', dictionaryBreaks: { kind: 'unavailable' } })
const webkit: WebKitEnvironment = { engine: 'webkit', build: PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'unavailable' } }
const gecko: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'unavailable' } }

function paragraph(family: string, text: string, facts: FontFacts = UNKNOWN_FONT_FACTS, size = 16): Paragraph {
  const font: FontDecl = { family, size, weight: 400, style: 'normal', facts }
  return {
    font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start',
  }
}

// What index.ts prepare hands the checks for an environment.
function checksOf(env: Environment, inspect = true): FontChecks {
  switch (env.engine) {
    case 'blink': return blinkFontChecks(env, inspect)
    case 'webkit': return webkitFontChecks
    case 'gecko': return geckoFontChecks
  }
}

function learn(family: string, text: string, env: Environment, facts?: FontFacts): FontFacts {
  return withLearnedFontFacts(paragraph(family, text, facts), checksOf(env), createContextPool()).font.facts
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
    expect(learn('system-ui', 'ab', blink(2)).opticalSizeAxis).toBe(null)
    expect(made.every(c => / 16px /.test(c.font))).toBe(true)
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

  test('every letter with a joining type asks, by the Blink port\'s own data (U+200D alone doesn\'t)', () => {
    const unasked: string[] = []
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const jt = joiningType(cp)
      if (jt === 0 || jt === 5 || cp === 0x200d) continue
      calls = 0
      learn('Prop', String.fromCodePoint(cp), blink(1))
      if (calls === 0) unasked.push(cp.toString(16))
    }
    expect(unasked).toEqual([])
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

describe('the checks\' contexts', () => {
  // Every check at once: a soft hyphen, a joining letter, and in Blink a zoom other than 1.
  const everyCheck = `a\u00adb${BEH}`

  test('Blink: text-rendering optimizeLegibility, which keeps them off the font cache key of the page\'s own text', () => {
    const facts = learn('Prop', everyCheck, blink(2))
    expect(facts.primaryFamily).toBe('Prop')
    expect(facts.opticalSizeAxis).toBe(false)
    expect(made.length).toBeGreaterThan(0)
    expect(made.filter(c => c.textRendering !== 'optimizeLegibility')).toEqual([])
    // Check 4's two sizes are among them: the zoomed size is where a context at text-rendering auto would share the key.
    expect(made.some(c => / 32px /.test(c.font))).toBe(true)
  })

  test('the text rendering of the engine\'s own contexts, in every engine', () => {
    const envs: Environment[] = [blink(2), webkit, gecko]
    for (let e = 0; e < envs.length; e++) {
      // The checks run before the engine, so their contexts are the first ones a prepare makes.
      made = []
      withLearnedFontFacts(paragraph('Prop', everyCheck), checksOf(envs[e]!, false), createContextPool())
      const checks = made
      made = []
      prepare(paragraph('Prop', everyCheck), envs[e]!, false)
      expect(made.slice(0, checks.length).map(c => c.font)).toEqual(checks.map(c => c.font))
      const own = made.slice(checks.length)
      expect(own.length).toBeGreaterThan(0)
      expect(checks.length > 0).toBe(envs[e]!.engine !== 'gecko')
      const renderings = new Set(own.map(c => c.textRendering))
      expect(renderings.size).toBe(1)
      expect(checks.filter(c => !renderings.has(c.textRendering))).toEqual([])
    }
  })
})

describe('one call', () => {
  const everyCheck = `a\u00adb${BEH}`
  const spanOf = (p: Paragraph, font: FontDecl, lang: string | null): InlineNode => ({
    kind: 'span', font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, lang,
    inlineStart: { margin: 0, border: 0, padding: 0 }, inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline', children: p.content,
  })

  test('an engine with no font checks keeps a large caller tree and its facts directly', () => {
    const p = paragraph('Prop', everyCheck)
    const content: InlineNode[] = []
    for (let i = 0; i < 8192; i++) content.push(spanOf(p, { ...p.font, size: 16 + i / 100 }, null))
    const input = { ...p, content }
    const result = withLearnedFontFacts(input, geckoFontChecks, createContextPool())
    expect(result).toBe(input)
    expect(calls).toBe(0)
  })

  test('deep inherited and reset languages resolve without recursion or mutating the caller', () => {
    const p = paragraph('Prop', everyCheck)
    let content = p.content
    const depth = 32768
    for (let i = 0; i < depth; i++) {
      const node = spanOf({ ...p, content }, p.font, i === 0 ? '' : i === depth - 1 ? 'ja' : null)
      content = [node]
    }
    const input = { ...p, content }
    const result = withLearnedFontFacts(input, blinkFontChecks(blink(2)), createContextPool())
    let source = input.content
    let learned = result.content
    for (let i = 0; i < depth; i++) {
      const before = source[0]!
      const after = learned[0]!
      if (before.kind !== 'span' || after.kind !== 'span') throw new Error('missing span')
      if (i === 0 || i === depth - 1) {
        expect(after.font.facts.primaryFamily).toBe('Prop')
        expect(before.font.facts).toBe(UNKNOWN_FONT_FACTS)
      }
      source = before.children
      learned = after.children
    }
    expect(learned[0]).toBe(p.content[0])
    expect(new Set(asked.map(q => q.context.lang))).toEqual(new Set(['en', 'ja', '']))
  })

  test('resolves a declaration once, and declarations of several sizes share their questions', () => {
    const p = paragraph('Prop', everyCheck)
    const first = withLearnedFontFacts(p, blinkFontChecks(blink(2)), createContextPool()).font.facts
    const asked = calls
    const same = withLearnedFontFacts({ ...p, content: [spanOf(p, { ...p.font }, null)] }, blinkFontChecks(blink(2)), createContextPool())
    expect(same.content[0]!.kind === 'span' && same.content[0]!.font.facts).toEqual(first)
    expect(calls).toBe(2 * asked)
    // Another size asks only the check that reads the size.
    withLearnedFontFacts({ ...p, content: [spanOf(p, { ...p.font, size: 20 }, null)] }, blinkFontChecks(blink(2)), createContextPool())
    expect(calls).toBe(3 * asked + 2)
  })

  test('a list that outlives the call saves the next call its contexts and none of its questions, so a font that loads between two calls shows in the second', () => {
    const p = paragraph('Late, Prop', 'ab')
    const contexts = createContextPool()
    expect(withLearnedFontFacts(p, webkitFontChecks, contexts).font.facts.primaryFamily).toBe('Prop')
    const askedFirst = calls
    const madeFirst = made.length
    expect(withLearnedFontFacts(p, webkitFontChecks, contexts).font.facts.primaryFamily).toBe('Prop')
    expect([calls, made.length]).toEqual([2 * askedFirst, madeFirst])
    fonts = { ...fonts, Late: fixed(0.5) }
    expect(withLearnedFontFacts(p, webkitFontChecks, contexts).font.facts.primaryFamily).toBe('Late')
  })

  test('Gecko\'s contexts are one prepared paragraph\'s whatever list the caller keeps, so a family name that contexts learn only at their first use shows in the next call', () => {
    keepsFirstFonts = true
    const p = paragraph('Late, Prop', 'ab ab ab')
    const lineCount = (env: Environment, contexts: ContextPool): number => {
      const prepared = prepare(p, env, false, contexts)
      let lines = 0
      for (let start = firstLine(prepared); start !== null;) {
        const filled = fillLine(prepared, start, { width: 50, left: 0, right: 0 })
        if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
        lines++
        start = filled.next
      }
      return lines
    }
    const geckoList = createContextPool()
    const webkitList = createContextPool()
    expect([lineCount(gecko, geckoList), lineCount(webkit, webkitList)]).toEqual([2, 2])
    const madeFirst = made.length
    fonts = { ...fonts, Late: fixed(0.25) }
    expect(lineCount(gecko, geckoList)).toBe(1)
    expect(geckoList.size).toBe(0)
    expect(made.length).toBeGreaterThan(madeFirst)
    // The control: contexts that keep their first fonts on a list that is used, which is what WebKit's do after a loaded
    // FontFace is added. The second call makes no context and lays out with the fallback; a new list finds the family.
    const madeSecond = made.length
    expect(lineCount(webkit, webkitList)).toBe(2)
    expect(made.length).toBe(madeSecond)
    expect(lineCount(webkit, createContextPool())).toBe(1)
  })

  test('a list whose settings never repeat is emptied instead of growing without end', () => {
    const contexts = createContextPool()
    let most = 0
    for (let i = 0; i < 400; i++) {
      prepare(paragraph('Prop', 'ab', UNKNOWN_FONT_FACTS, 10 + i / 100), blink(2), false, contexts)
      most = Math.max(most, contexts.size)
    }
    expect(most).toBeGreaterThan(512)
    expect(most).toBeLessThan(530)
  })

  test('a question several checks share is asked once', () => {
    // WebKit's fixed-pitch check reads the space under the list the primary family check measured it under, and both
    // declarations' primary family checks read the space under the two generics alone.
    const p = paragraph('"Mono"', 'ab')
    withLearnedFontFacts({ ...p, content: [spanOf(p, { ...p.font, family: '"Prop"' }, null)] }, webkitFontChecks, createContextPool())
    const spaceUnder = (font: string): number => asked.filter(a => a.text === ' ' && a.context.font === font).length
    expect([spaceUnder('normal 400 16px "Mono", serif'), spaceUnder('normal 400 16px monospace'), spaceUnder('normal 400 16px serif')]).toEqual([1, 1, 1])
    for (let i = 0; i < asked.length; i++) for (let k = 0; k < i; k++) expect(asked[k]!.context === asked[i]!.context && asked[k]!.text === asked[i]!.text).toBe(false)
  })

  test('spans take their own declaration and language', () => {
    const p = paragraph('Prop', 'ab')
    const out = withLearnedFontFacts({ ...p, content: [spanOf(p, { ...p.font, family: 'Mono' }, 'ja')] }, blinkFontChecks(blink(2)), createContextPool())
    const learned = out.content[0]!
    expect(learned.kind === 'span' && learned.font.facts.primaryFamily).toBe('Mono')
    expect(made.some(c => c.lang === 'ja' && c.font.includes('Mono'))).toBe(true)
  })
})

describe('plain Blink optical check', () => {
  const checked = (p: Paragraph, inspect: boolean): Paragraph => withLearnedFontFacts(p, blinkFontChecks(blink(2), inspect), createContextPool())

  test('omits only linear-sample questions while preserving named-family resolution', () => {
    const p = paragraph('Prop', 'Hello world')
    const inspected = checked(p, true)
    const inspectCalls = calls
    const inspectQuestions = asked.map(q => ({ font: q.context.font, text: q.text }))
    calls = 0; asked = []
    const plain = checked(p, false)
    expect(plain.font.facts).toEqual({ ...inspected.font.facts, opticalSizeAxis: null })
    expect(plain.font.facts.primaryFamily).toBe('Prop')
    expect(asked.map(q => ({ font: q.context.font, text: q.text }))).toEqual(inspectQuestions.filter(q => q.text !== 'Hamburgefonstiv'))
    expect(asked.some(q => q.text === 'Hamburgefonstiv')).toBe(false)
    expect(calls).toBeLessThan(inspectCalls)
    expect([inspectCalls, calls]).toEqual([10, 4])
  })

  test('retains the exact primary-family condition, including Missing/system-ui permutations', () => {
    fonts['system-ui'] = { ...proportional, adjust: (_text, size) => size / 1000 }
    fonts['BlinkMacSystemFont'] = fonts['system-ui']!
    const cases: [string, string | null, boolean][] = [
      ['Missing, system-ui', 'system-ui', true],
      ['system-ui, Missing', 'system-ui', true],
      ['Missing, BlinkMacSystemFont', 'BlinkMacSystemFont', true],
      ['Prop, system-ui', 'Prop', false],
      ['Missing, Prop, system-ui', 'Prop', false],
      ['"system-ui", Prop', null, true],
    ]
    for (let i = 0; i < cases.length; i++) {
      const [family, primary, cssSize] = cases[i]!
      const p = paragraph(family, 'Hello world')
      const a = checked(p, true)
      const b = checked(p, false)
      expect(b.font.facts.primaryFamily).toBe(a.font.facts.primaryFamily)
      expect(b.font.facts.primaryFamily).toBe(primary)
      const oldState = prepare(p, blink(2), true)
      const plainState = prepare(p, blink(2), false)
      expect(oldState.engine).toBe('blink')
      expect(plainState.engine).toBe('blink')
      if (oldState.engine !== 'blink' || plainState.engine !== 'blink') throw Error('wrong engine')
      expect(plainState.state.styles[0]!.measuresAtCssSize).toBe(oldState.state.styles[0]!.measuresAtCssSize)
      expect(plainState.state.styles[0]!.measuresAtCssSize).toBe(cssSize)
      const firstOld = firstLine(oldState)!
      const firstPlain = firstLine(plainState)!
      const oldLine = fillLine(oldState, firstOld, { width: 500, left: 0, right: 0 })
      const plainLine = fillLine(plainState, firstPlain, { width: 500, left: 0, right: 0 })
      expect(plainLine.kind).toBe(oldLine.kind)
      if (oldLine.kind !== 'line' || plainLine.kind !== 'line' || oldLine.line.engine !== 'blink' || plainLine.line.engine !== 'blink') throw Error('wrong line')
      expect([plainLine.start, plainLine.end, plainLine.line.info.width]).toEqual([oldLine.start, oldLine.end, oldLine.line.info.width])
    }
    // A keyword before a missing family can itself be unavailable: the realized named family must still win.
    delete fonts['system-ui']
    const p = paragraph('system-ui, Prop', 'Hello world')
    expect(checked(p, false).font.facts.primaryFamily).toBe('Prop')
    const plainState = prepare(p, blink(2), false)
    if (plainState.engine !== 'blink') throw Error('wrong engine')
    expect(plainState.state.styles[0]!.measuresAtCssSize).toBe(false)
  })

  test('preserves supplied facts without introducing a primary-family query', () => {
    const supplied: FontFacts = { primaryFamily: 'Other', mapsHyphen: false, monospace: true, opticalSizeAxis: true, joining: 'aat', pairKerning: 'split' }
    expect(checked(paragraph('Prop', `a\u00adb${BEH}`, supplied), false).font.facts).toEqual(supplied)
    expect(calls).toBe(0)
    const suppliedAxis = { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false }
    expect(checked(paragraph('Missing, system-ui', 'Hello', suppliedAxis), false).font.facts).toEqual(suppliedAxis)
    expect(calls).toBe(0)
    const atOne = withLearnedFontFacts(paragraph('Missing, system-ui', 'Hello'), blinkFontChecks(blink(1), false), createContextPool())
    expect(atOne.font.facts).toEqual(UNKNOWN_FONT_FACTS)
    expect(calls).toBe(0)
  })

  test('still asks the hyphen and joining checks plain text decisions consume', () => {
    const p = paragraph('Prop', `a\u00adb${BEH}`)
    const a = checked(p, true).font.facts
    const b = checked(p, false).font.facts
    expect(b).toEqual({ ...a, opticalSizeAxis: null })
    expect(b.mapsHyphen).toBe(true)
  })
})
