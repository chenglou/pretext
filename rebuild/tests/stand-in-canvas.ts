// A deterministic Canvas that stands in for a browser's where no record can answer: a layout at a width nobody recorded
// (function-set.ts sweep). It is no font. Its widths are a fixed function of a context's settings and the string, shaped
// like a font's where the ports' recipes look: a change to what a port measures, where it cuts a string or which context
// it asks changes the numbers, and with them the lines.
// - An advance per code point from the font string (size, weight, style, family) and the code point; combining marks and
//   default-ignorable code points have none; East Asian wide characters take the font size.
// - Pairs kern, unless fontKerning is 'none': W('AV') isn't W('A') + W('V'), so a port that measures a prefix and one that
//   sums its parts disagree.
// - U+200D changes the advance of the letter before it and of the letter after it, as a joining form does: the ports add
//   it at a shaping edge, and it must show.
// - Letter spacing adds to every code point with an advance, and turns the ligatures `fi` and `fl` off, as it does in the
//   three browsers' DOM. Gecko's Canvas rounds the spacing to app units (1/60 px) per character, which makes its 0.001px
//   recipe add nothing (src/measure/canvas-checks.ts), so the stand-in does the same under a Firefox user agent.
// - Word spacing adds to U+0020 and U+00A0.
// - The ink box starts a little after the origin and ends a little before the advance, by the first and last code point.
// Every value is a multiple of 1/1024 px, so sums of them are exact in a double whatever their order.
import { installPage, type PageFacts } from '../lab/measurements.ts'

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline'] as const
type Setting = typeof SETTINGS[number]

const GRID = 1024
const onGrid = (px: number): number => Math.round(px * GRID) / GRID

// A small integer hash (xorshift-multiply), stable across runs and hosts.
function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

function hashOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = mix(h, text.charCodeAt(i))
  return h
}

const MARK = /^\p{M}$/u
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u
const WIDE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]$/u
const LETTER = /^\p{L}$/u
const ZWJ = 0x200d

type Font = { size: number; seed: number }

function fontOf(shorthand: string): Font {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(shorthand)?.[1] ?? 10)
  return { size, seed: hashOf(shorthand.replace(/(\d+(?:\.\d+)?)px/, '')) }
}

// What a code point is to the stand-in, read from the Unicode properties once per code point.
type Kind = 'none' | 'wide' | 'space' | 'letter' | 'other'
const kinds = new Map<number, Kind>()
function kindOf(cp: number, ch: string): Kind {
  let kind = kinds.get(cp)
  if (kind === undefined) {
    kind = MARK.test(ch) || IGNORABLE.test(ch) ? 'none' : WIDE.test(ch) || cp > 0xffff ? 'wide' : cp === 0x20 || cp === 0xa0 ? 'space' : LETTER.test(ch) ? 'letter' : 'other'
    kinds.set(cp, kind)
  }
  return kind
}

function advance(font: Font, cp: number, kind: Kind): number {
  switch (kind) {
    case 'none': return 0
    case 'wide': return font.size
    case 'space': return onGrid(font.size * (0.25 + (font.seed % 4) / 64))
    case 'letter':
    case 'other': return onGrid(font.size * (0.4 + (mix(font.seed, cp) % 24) / 64))
  }
}

function width(font: Font, text: string, letterSpacing: number, wordSpacing: number, kerns: boolean): number {
  let total = 0
  // The last code point with an advance, and what it is.
  let previous = -1
  let previousKind: Kind = 'none'
  let joinsNext = false
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === ZWJ) {
      // The form of the letter before U+200D, and of the letter after it.
      if (previousKind === 'letter') total += onGrid(font.size * (((mix(font.seed, previous) % 5) - 2) / 32))
      joinsNext = true
      continue
    }
    const kind = kindOf(cp, ch)
    let own = advance(font, cp, kind)
    if (kind !== 'none') {
      if (joinsNext && kind === 'letter') own += onGrid(font.size * (((mix(font.seed ^ 1, cp) % 5) - 2) / 32))
      if (kerns && previous >= 0 && mix(mix(font.seed, previous), cp) % 5 === 0) own -= onGrid(font.size / 32)
      if (letterSpacing === 0 && previous === 0x66 && (cp === 0x69 || cp === 0x6c)) own -= onGrid(font.size / 16)
      own += letterSpacing
      if (kind === 'space') own += wordSpacing
      previous = cp
      previousKind = kind
      joinsNext = false
    }
    total += own
  }
  return total
}

export type StandIn = { asked: number; contexts: number; restore: () => void }

// Installs the stand-in as the page a layout reads (lab/measurements.ts installPage). Dictionary segmentation stays bun's
// own Intl.Segmenter; bun has no Intl.v8BreakIterator, so the Blink port finds its dictionary breaks unavailable.
export function installStandIn(env: PageFacts): StandIn {
  const standIn: StandIn = { asked: 0, contexts: 0, restore: () => {} }
  const gecko = /\bFirefox\//.test(env.userAgent)
  class Context {
    values = new Map<Setting, string>()
    measureText(text: string): Partial<TextMetrics> {
      standIn.asked++
      // A context's default font.
      const font = fontOf(this.values.get('font') ?? '10px sans-serif')
      const px = (name: Setting): number => Number.parseFloat(this.values.get(name) ?? '0') || 0
      const spacing = gecko ? Math.round(px('letterSpacing') * 60) / 60 : px('letterSpacing')
      const total = width(font, text, onGrid(spacing), onGrid(px('wordSpacing')), this.values.get('fontKerning') !== 'none')
      const first = text.codePointAt(0) ?? 0
      const last = text.codePointAt(text.length - 1) ?? 0
      return {
        width: total, actualBoundingBoxLeft: -onGrid(font.size * ((mix(font.seed, first) % 4) / 64)), actualBoundingBoxRight: total - onGrid(font.size * ((mix(font.seed, last) % 4) / 64)),
        actualBoundingBoxAscent: onGrid(font.size * 0.75), actualBoundingBoxDescent: onGrid(font.size * 0.25), fontBoundingBoxAscent: onGrid(font.size * 0.9), fontBoundingBoxDescent: onGrid(font.size * 0.2),
      }
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Context.prototype, name, {
      get(this: Context): string { return this.values.get(name) ?? '' },
      set(this: Context, value: unknown): void { this.values.set(name, String(value)) },
    })
  }
  standIn.restore = installPage(env, class {
    getContext(): Context {
      standIn.contexts++
      return new Context()
    }
  })
  return standIn
}
