// A deterministic stand-in for the browsers' Canvas (research/ARCHITECTURE-PLAN-2.md §2 item 3, §7 check 3). The replay
// answers only the questions a browser was asked when a case was recorded, so it can't lay a case out at another width,
// run a new case, or compare two trees that ask different questions. This Canvas answers any question, the same way
// every time, in bun: a width sweep on one prepared paragraph against fresh prepares, two checkouts on the same cases
// (two-trees.ts), an owner's quick experiment. It says nothing about a browser. What it must do is make a wrong data flow
// show, so its widths depend on everything a real width depends on:
// - the font string (style, weight, size, and the family list with per-character fallback: a listed family is missing or
//   lacks a character by a hash of its name, generic families draw everything, a generic draws Han, kana and Hangul by
//   the context's `lang`), so the runtime font checks find primary families, hyphens and fixed pitch both ways;
// - the text in context: pair kerning by a hash of the pair, ligatures of `f` with `f`, `i` and `l` and of hashed pairs of
//   two different lowercase letters, Arabic letters narrower where they join a neighbour, and U+200D joining them, so W(ab) is not W(a) + W(b) and
//   a joiner changes the width of what it touches; combining marks, format characters and variation selectors add
//   nothing; an emoji after U+200D, a skin tone and the second regional indicator join the emoji before; the controls
//   Canvas turns into spaces measure as spaces;
// - the context's letter spacing (per spaced character, and it turns ligatures off where the engine's Canvas does: not
//   in WebKit), word spacing and `fontKerning`;
// - the engine's own arithmetic, so the ports' exact recipes read values of the kind they expect and the capability
//   checks of src/measure/canvas-checks.ts pass: Blink advances are multiples of 1/64 px and a 1/64 px spacing adds
//   exactly that; Gecko advances and spacing are whole app units (60 a px), so 0.001px adds nothing and moves no ink
//   edge; WebKit sums float32 advances in order.
// The ink box is the advance box less each end character's side bearing, half an em on the open side of full-width
// brackets and stops, which is what Blink's HanKerning and Gecko's ligature test read.
//
// installStandInCanvas(env) installs the globals a layout reads (OffscreenCanvas, navigator, window, document, and for a
// Chrome user agent Intl.v8BreakIterator over bun's word segmenter) and counts the questions: calls, distinct (context,
// string) pairs, contexts. restore() puts the old globals back.

export type PageFacts = { userAgent: string; devicePixelRatio: number; pageLang: string }
export type Asked = { calls: number; distinct: number; contexts: number; characters: number }
export type StandIn = { asked: () => Asked; reset: () => void; restore: () => void }

type Engine = 'blink' | 'webkit' | 'gecko'

function engineOf(userAgent: string): Engine {
  if (/\bFirefox\//.test(userAgent)) return 'gecko'
  if (/\bChrome\//.test(userAgent)) return 'blink'
  return 'webkit'
}

// FNV-1a over UTF-16 units and numbers.
function hash(...parts: Array<string | number>): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    const text = typeof part === 'number' ? `#${part}` : part
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ 0xff, 0x01000193)
  }
  return h >>> 0
}

const GENERICS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont'])
const FIXED_PITCH = /mono|courier|menlo|consolas/i

type Font = { style: string; weight: string; size: number; families: string[] }

function parseFont(font: string): Font {
  const match = /^\s*(?:(normal|italic|oblique)\s+)?(?:(normal|bold|\d+)\s+)?(\d*\.?\d+(?:e[+-]?\d+)?)px\s+(.+?)\s*$/i.exec(font)
  if (match === null) throw new Error(`the stand-in Canvas can't read the font ${JSON.stringify(font)}`)
  const families = match[4]!.split(',').map(name => name.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(name => name !== '')
  return { style: match[1] ?? 'normal', weight: match[2] ?? '400', size: Number(match[3]), families }
}

const MARK = 1
const FORMAT = 2
const EMOJI = 4
const WIDE = 8
const OPEN_HALF = 16
const CLOSE_HALF = 32
const ARABIC = 64
const LOWERCASE = 128
const CLASS_TESTS: ReadonlyArray<[number, RegExp]> = [
  [MARK, /^\p{M}$/u],
  [FORMAT, /^[\p{Cf}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]$/u],
  [EMOJI, /^\p{Extended_Pictographic}$/u],
  [WIDE, /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]$/u],
  [OPEN_HALF, /^[\u2018\u201c\u3008\u300a\u300c\u300e\u3010\u3014\u3016\u3018\u301d\uff08\uff3b\uff5b]$/],
  [CLOSE_HALF, /^[\u2019\u201d\u3001\u3002\u3009\u300b\u300d\u300f\u3011\u3015\u3017\u3019\u301f\uff09\uff0c\uff0e\uff3d\uff5d]$/],
  [ARABIC, /^[\u0620-\u064a\u066e-\u06d3\u06fa-\u06ff\u0750-\u077f\u07ca-\u07ea\u07fa]$/],
  [LOWERCASE, /^[a-z]$/],
]
const ZWJ = 0x200d

// A code point's classes, read once: fixed data of the Unicode tables bun carries.
const classes = new Map<number, number>()
function classOf(cp: number): number {
  let known = classes.get(cp)
  if (known === undefined) {
    const text = String.fromCodePoint(cp)
    known = 0
    for (let i = 0; i < CLASS_TESTS.length; i++) if (CLASS_TESTS[i]![1].test(text)) known |= CLASS_TESTS[i]![0]
    classes.set(cp, known)
  }
  return known
}

// `spaced`: takes letter spacing, as a glyph with an advance of its own does. `space`: takes word spacing.
type Glyph = { cp: number; is: number; family: string; advance: number; spaced: boolean; space: boolean }

// The family that draws the character: the first listed one that exists and has it.
function familyFor(font: Font, cp: number, is: number, lang: string): string {
  const language = (is & WIDE) === 0 ? '' : `@${lang.split('-')[0]!.toLowerCase()}`
  for (let i = 0; i < font.families.length; i++) {
    const name = font.families[i]!
    if (GENERICS.has(name.toLowerCase())) return name + language
    if (hash('exists', name) % 9 === 0) continue
    // Every font has Basic Latin and the space; past it, coverage goes by a hash of the family and the character's block.
    if (cp < 0x80 || hash('covers', name, cp >> 7) % 4 !== 0) return name
  }
  return `last-resort${language}`
}

// An advance in ems.
function emAdvance(family: string, weight: string, style: string, cp: number, is: number): number {
  if ((is & (MARK | FORMAT)) !== 0) return 0
  if ((is & (EMOJI | WIDE)) !== 0) return 1
  if (FIXED_PITCH.test(family)) return 0.6
  const h = hash('advance', family, weight, style, cp)
  if (cp === 0x20 || cp === 0xa0) return 0.25 + (h % 5) / 64
  return 0.3 + (h % 29) / 64
}

function glyphsOf(font: Font, lang: string, value: string): Glyph[] {
  const out: Glyph[] = []
  for (let i = 0; i < value.length;) {
    let cp = value.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    // Canvas replaces the controls with spaces before shaping (HTML's text preparation algorithm).
    if (cp >= 0x09 && cp <= 0x0d) cp = 0x20
    // Blink maps U+2028 to the space glyph (harfbuzz_face.cc:110-113), which its port measures in place of U+0020
    // (engines/blink/shape.ts canvasString): the space's family and advance, and no word spacing, which is U+0020's.
    const glyph = cp === 0x2028 ? 0x20 : cp
    const is = classOf(glyph)
    const family = familyFor(font, glyph, is, lang)
    const advance = emAdvance(family, font.weight, font.style, glyph, is)
    out.push({ cp, is, family, advance, spaced: advance !== 0, space: cp === 0x20 || cp === 0xa0 })
  }
  // Emoji sequences are one glyph: the parts after the first add nothing and take no spacing.
  for (let i = 1; i < out.length; i++) {
    const glyph = out[i]!
    const before = out[i - 1]!
    const joined = ((glyph.is & EMOJI) !== 0 && before.cp === ZWJ && i >= 2 && (out[i - 2]!.is & EMOJI) !== 0)
      || (glyph.cp >= 0x1f3fb && glyph.cp <= 0x1f3ff && (before.is & EMOJI) !== 0)
      || (glyph.cp >= 0x1f1e6 && glyph.cp <= 0x1f1ff && before.cp >= 0x1f1e6 && before.cp <= 0x1f1ff && before.spaced)
    if (joined) {
      glyph.advance = 0
      glyph.spaced = false
    }
  }
  return out
}

// The neighbour a letter joins: the nearest character that isn't a combining mark.
function neighbour(glyphs: readonly Glyph[], from: number, step: number): Glyph | null {
  for (let i = from + step; i >= 0 && i < glyphs.length; i += step) if ((glyphs[i]!.is & MARK) === 0) return glyphs[i]!
  return null
}

const joins = (glyph: Glyph | null): boolean => glyph !== null && (glyph.cp === ZWJ || (glyph.is & ARABIC) !== 0)

type Settings = { font: Font; lang: string; letterSpacing: number; wordSpacing: number; kerning: boolean }

// Advances in ems per glyph, with what the text around each one does to it.
function shaped(engine: Engine, settings: Settings, value: string): Glyph[] {
  const glyphs = glyphsOf(settings.font, settings.lang, value)
  const ligatures = settings.letterSpacing === 0 || engine === 'webkit'
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!
    if (glyph.advance === 0) continue
    if ((glyph.is & ARABIC) !== 0) {
      // Initial, medial and final forms are narrower than the isolated one.
      if (joins(neighbour(glyphs, i, -1))) glyph.advance -= 6 / 64
      if (joins(neighbour(glyphs, i, 1))) glyph.advance -= 4 / 64
      continue
    }
    const next = glyphs[i + 1]
    if (next === undefined || next.family !== glyph.family || next.advance === 0 || FIXED_PITCH.test(glyph.family)) continue
    const pair = hash('pair', glyph.family, glyph.cp, next.cp)
    const lowercase = (glyph.is & next.is & LOWERCASE) !== 0
    // A letter never ligates with itself but `ff`: the capability checks measure one letter repeated for that reason.
    if (ligatures && lowercase && ((glyph.cp === 0x66 && (next.cp === 0x66 || next.cp === 0x69 || next.cp === 0x6c)) || (pair % 31 === 0 && glyph.cp !== next.cp))) {
      // One glyph for the two: the second adds nothing and takes no letter spacing.
      glyph.advance += next.advance - 5 / 64
      next.advance = 0
      next.spaced = false
      i++
    } else if (settings.kerning && pair % 7 === 0) {
      glyph.advance -= (1 + (pair >>> 8) % 3) / 64
    }
  }
  return glyphs
}

function bearing(glyph: Glyph, side: 'left' | 'right'): number {
  if ((glyph.is & OPEN_HALF) !== 0) return side === 'left' ? 0.5 : 0
  if ((glyph.is & CLOSE_HALF) !== 0) return side === 'right' ? 0.5 : 0
  return (hash('bearing', side, glyph.family, glyph.cp) % 4) / 64
}

function measure(engine: Engine, settings: Settings, value: string): { width: number; left: number; right: number } {
  const glyphs = shaped(engine, settings, value)
  const size = settings.font.size
  // The engine's arithmetic: Blink in 1/64 px, Gecko in app units, both exact integers until the end; WebKit in float32 px,
  // summed in order. `spacing` is what a spaced glyph really got, which the ink box ends before.
  let width = 0
  let spacing: number
  switch (engine) {
    case 'blink':
    case 'gecko': {
      const unit = engine === 'blink' ? 64 : 60
      const spacingUnits = Math.round(settings.letterSpacing * unit)
      const wordSpacingUnits = Math.round(settings.wordSpacing * unit)
      for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i]!
        width += Math.round(glyph.advance * size * unit) + (glyph.spaced ? spacingUnits : 0) + (glyph.space ? wordSpacingUnits : 0)
      }
      width /= unit
      spacing = spacingUnits / unit
      break
    }
    case 'webkit':
      for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i]!
        width = Math.fround(width + Math.fround(glyph.advance * size))
        if (glyph.spaced) width = Math.fround(width + Math.fround(settings.letterSpacing))
        if (glyph.space) width = Math.fround(width + Math.fround(settings.wordSpacing))
      }
      spacing = Math.fround(settings.letterSpacing)
      break
  }
  let first: Glyph | null = null
  let last: Glyph | null = null
  for (let i = 0; i < glyphs.length; i++) {
    if (glyphs[i]!.advance === 0) continue
    first ??= glyphs[i]!
    last = glyphs[i]!
  }
  return {
    width,
    left: first === null ? 0 : -bearing(first, 'left') * size,
    right: last === null ? 0 : width - bearing(last, 'right') * size - (last.spaced ? spacing : 0),
  }
}

// WebKit's context has no lang, fontKerning or textRendering attribute; assigning one there makes an ordinary property.
const ATTRIBUTES: Record<Engine, readonly string[]> = {
  blink: ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'],
  gecko: ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'],
  webkit: ['font', 'letterSpacing', 'wordSpacing', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'],
}
const DEFAULTS: Record<string, string> = { font: '10px sans-serif', lang: 'inherit', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr' }

export function installStandInCanvas(env: PageFacts): StandIn {
  const engine = engineOf(env.userAgent)
  const counts: Asked = { calls: 0, distinct: 0, contexts: 0, characters: 0 }

  class Context {
    values = new Map<string, string>()
    seen = new Set<string>()
    parsed: { font: string; value: Font } | null = null
    constructor() { counts.contexts++ }
    setting(name: string): string { return this.values.get(name) ?? DEFAULTS[name] ?? '' }
    measureText(value: string): unknown {
      counts.calls++
      counts.characters += value.length
      if (!this.seen.has(value)) {
        this.seen.add(value)
        counts.distinct++
      }
      const font = this.setting('font')
      if (this.parsed === null || this.parsed.font !== font) this.parsed = { font, value: parseFont(font) }
      const lang = engine === 'webkit' || this.setting('lang') === 'inherit' ? env.pageLang : this.setting('lang')
      const settings: Settings = { font: this.parsed.value, lang, letterSpacing: Number.parseFloat(this.setting('letterSpacing')), wordSpacing: Number.parseFloat(this.setting('wordSpacing')), kerning: this.setting('fontKerning') !== 'none' }
      const size = settings.font.size
      const { width, left, right } = measure(engine, settings, value)
      return { width, actualBoundingBoxLeft: left, actualBoundingBoxRight: right, actualBoundingBoxAscent: size * 0.75, actualBoundingBoxDescent: size * 0.25, fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.2 }
    }
  }
  for (const name of ATTRIBUTES[engine]) {
    Object.defineProperty(Context.prototype, name, {
      configurable: true,
      get(this: Context): string { return this.setting(name) },
      set(this: Context, value: unknown): void { this.values.set(name, String(value)) },
    })
  }

  const globals = globalThis as Record<string, unknown>
  const intl = Intl as unknown as Record<string, unknown>
  const names = ['OffscreenCanvas', 'navigator', 'window', 'document']
  const before = names.map(name => Object.getOwnPropertyDescriptor(globals, name))
  const v8 = Object.getOwnPropertyDescriptor(intl, 'v8BreakIterator')
  const define = (name: string, value: unknown): void => { Object.defineProperty(globals, name, { value, configurable: true, writable: true }) }
  const Canvas = class { getContext(): Context { return new Context() } }
  define('OffscreenCanvas', Canvas)
  define('navigator', { userAgent: env.userAgent })
  define('window', { devicePixelRatio: env.devicePixelRatio })
  define('document', {
    documentElement: { lang: env.pageLang },
    createElement(name: string): unknown {
      if (name !== 'canvas') throw new Error(`The stand-in has no <${name}> element`)
      return new Canvas()
    },
  })
  // Chrome alone has Intl.v8BreakIterator, and the library asks whether it exists. Its line boundaries inside dictionary
  // text stand in as bun's word boundaries.
  if (engine === 'blink') {
    intl['v8BreakIterator'] = class {
      breaks: number[] = []
      at = 0
      adoptText(text: string): void {
        this.breaks = []
        for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (segment.index > 0) this.breaks.push(segment.index)
        this.breaks.push(text.length)
        this.at = 0
      }
      first(): number { return 0 }
      next(): number { return this.breaks[this.at++] ?? -1 }
    }
  } else {
    delete intl['v8BreakIterator']
  }
  return {
    asked: () => ({ ...counts }),
    reset: () => { counts.calls = 0; counts.distinct = 0; counts.contexts = 0; counts.characters = 0 },
    restore: () => {
      for (let i = 0; i < names.length; i++) {
        if (before[i] === undefined) delete globals[names[i]!]
        else Object.defineProperty(globals, names[i]!, before[i]!)
      }
      if (v8 === undefined) delete intl['v8BreakIterator']
      else Object.defineProperty(intl, 'v8BreakIterator', v8)
    },
  }
}
