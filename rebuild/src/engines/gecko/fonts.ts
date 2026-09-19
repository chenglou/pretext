// Font declarations as Gecko reads them (Firefox 156.0): the parsed family list, the equality text runs continue on, and
// the facts about realized fonts the port reads (DESIGN.md §1.2).
import type { FontDecl } from '../../model.js'

export type FontFamilyEntry =
  | { kind: 'generic'; name: 'serif' | 'sans-serif' | 'monospace' | 'cursive' | 'fantasy' | 'math' | 'system-ui' }
  | { kind: 'named'; name: string; syntax: 'quoted' | 'identifiers' }

// GenericFontFamily's keywords (servo/components/style/values/computed/font.rs:670-691), matched ignoring ASCII case;
// -moz-fixed is monospace. math and system-ui are behind prefs that are on in Firefox 156
// (StaticPrefList.yaml:10857, :12072).
function genericFamily(ident: string): Extract<FontFamilyEntry, { kind: 'generic' }>['name'] | null {
  switch (ident.toLowerCase()) {
    case 'serif': return 'serif'
    case 'sans-serif': return 'sans-serif'
    case 'monospace': case '-moz-fixed': return 'monospace'
    case 'cursive': return 'cursive'
    case 'fantasy': return 'fantasy'
    case 'math': return 'math'
    case 'system-ui': return 'system-ui'
    default: return null
  }
}

// One CSS escape at text[i] === '\\' (CSS Syntax §4.3.7): the code point and where parsing continues.
function escape(text: string, i: number): { value: string; next: number } {
  let hex = ''
  let k = i + 1
  while (k < text.length && hex.length < 6 && /[0-9a-fA-F]/.test(text[k]!)) hex += text[k++]
  if (hex.length > 0) {
    if (k < text.length && /\s/.test(text[k]!)) k++
    const cp = parseInt(hex, 16)
    return { value: cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp), next: k }
  }
  return { value: k < text.length ? text[k]! : '�', next: k + 1 }
}

// FontFamilyList as parsed by SingleFontFamily::parse (font.rs:707-768): a quoted string is a quoted family name; an
// identifier that is a generic keyword is that generic; other identifiers join with single spaces into one name, quoted
// syntax only when an escaped identifier holds a space.
export function parseFamilyList(list: string): FontFamilyEntry[] {
  const out: FontFamilyEntry[] = []
  let i = 0
  while (i <= list.length) {
    while (i < list.length && /\s/.test(list[i]!)) i++
    const quote = list[i]
    if (quote === '"' || quote === "'") {
      let name = ''
      i++
      while (i < list.length && list[i] !== quote) {
        if (list[i] === '\\') {
          const e = escape(list, i)
          name += e.value
          i = e.next
        } else {
          name += list[i++]
        }
      }
      out.push({ kind: 'named', name, syntax: 'quoted' })
      i++
    } else {
      const idents: string[] = []
      let spaced = false
      for (;;) {
        while (i < list.length && /\s/.test(list[i]!)) i++
        if (i >= list.length || list[i] === ',') break
        let ident = ''
        while (i < list.length && !/\s/.test(list[i]!) && list[i] !== ',') {
          if (list[i] === '\\') {
            const e = escape(list, i)
            ident += e.value
            i = e.next
          } else {
            ident += list[i++]
          }
        }
        spaced ||= ident.includes(' ')
        idents.push(ident)
      }
      const generic = idents.length === 1 ? genericFamily(idents[0]!) : null
      if (generic !== null) out.push({ kind: 'generic', name: generic })
      else out.push({ kind: 'named', name: idents.join(' '), syntax: spaced ? 'quoted' : 'identifiers' })
    }
    while (i < list.length && /\s/.test(list[i]!)) i++
    if (i >= list.length) break
    i++ // ','
  }
  return out
}

function sameFamilies(a: FontFamilyEntry[], b: FontFamilyEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let k = 0; k < a.length; k++) {
    const x = a[k]!
    const y = b[k]!
    switch (x.kind) {
      case 'generic':
        if (y.kind !== 'generic' || y.name !== x.name) return false
        break
      case 'named':
        if (y.kind !== 'named' || y.name !== x.name || y.syntax !== x.syntax) return false
        break
    }
  }
  return true
}

// Servo quantize_font_size, 10 significant bits (servo/components/style/values/specified/font.rs:993-1022).
export function quantize10(size: number): number {
  const d = Math.fround(size * 16385)
  const t = Math.fround(d - size)
  return Math.fround(d - t)
}

// The part of nsFont::CalcDifference the model can vary (gfx/src/nsFont.cpp:36-60): style, weight as FontWeight's
// FixedPoint<u16, 6> (font.rs:92-96, :155), the quantized computed size and the parsed family list, whose FamilyName
// equality includes the syntax (font.rs:512-533), so Arial and "Arial" differ. ContinueTextRunAcrossFrames compares
// these (nsTextFrame.cpp:2168).
export function sameFontForTextRun(a: FontDecl, b: FontDecl): boolean {
  return a.style === b.style && Math.round(Math.fround(a.weight) * 64) === Math.round(Math.fround(b.weight) * 64) &&
    quantize10(a.size) === quantize10(b.size) && sameFamilies(parseFamilyList(a.family), parseFamilyList(b.family))
}

// FontFacts.opticalSizeAxis with its documented default: true for Gecko's system-font keywords, which resolve to the
// macOS system font, whose opsz axis is a recorded browser fact (probes cross-cutting 5, specs/gecko-canvas.md §1.2 C1a).
// Only the unquoted keyword is the generic: a quoted "system-ui" parses as a named family (SingleFontFamily::parse,
// font.rs:707-768), so the default reads the parsed entry, not its name. A given primaryFamily names a family as the
// browser realizes it, so the keywords there stand for themselves.
export function opticalSizeAxisOf(font: FontDecl): boolean {
  if (font.facts.opticalSizeAxis !== null) return font.facts.opticalSizeAxis
  if (font.facts.primaryFamily !== null) return font.facts.primaryFamily === 'system-ui' || font.facts.primaryFamily === '-apple-system'
  const first = parseFamilyList(font.family)[0]!
  return (first.kind === 'generic' && first.name === 'system-ui') || (first.kind === 'named' && first.syntax === 'identifiers' && first.name === '-apple-system')
}

// ListedFontFacts.scriptLookups of the first listed family that gives a font, the font FontFacts.pairKerning describes; null
// where the facts don't say which family that is.
export function firstFontScriptLookups(font: FontDecl): readonly (readonly string[])[] | null {
  const fonts = font.facts.fonts
  if (fonts === undefined) return null
  for (let i = 0; i < fonts.length; i++) {
    if (fonts[i]!.realizes === false) continue
    return fonts[i]!.realizes === true ? fonts[i]!.scriptLookups : null
  }
  return null
}

// Which family of the list draws a code point, by the optional coverage facts (FontFacts.fonts): the index of the first
// family that realizes and maps it, -1 where every family is known and none maps it (the engine's fallback draws it, with a
// font the facts don't name), or null where the facts don't say. gfxFontGroup::FindFontForChar takes the first font of the
// group that has the character (gfxTextRun.cpp:3276-3300, :3394-3500), and for U+2010 and U+2011 one that has U+002D
// (:3228-3232). It doesn't hold for the characters font matching places by their neighbours: cluster extenders, join
// controls and variation selectors, a character after U+200D, U+202F, and characters with an emoji presentation.
export function listedFontOf(font: FontDecl, cp: number): number | null {
  const fonts = font.facts.fonts
  if (fonts === undefined) return null
  for (let i = 0; i < fonts.length; i++) {
    const f = fonts[i]!
    if (f.realizes === false) continue
    if (f.realizes === null || f.coverage === null) return null
    if (covers(f.coverage, cp) || ((cp === 0x2010 || cp === 0x2011) && covers(f.coverage, 0x2d))) return i
  }
  return -1
}

// The family that draws a cluster extender after a character family `base` draws: the same one where it maps the extender
// (FindFontForChar takes the previous character's font for a cluster extender it has, gfxTextRun.cpp:3181-3194), else the
// extender's own (listedFontOf). `base` is a listedFontOf result.
export function extenderFontOf(font: FontDecl, base: number | null, cp: number): number | null {
  if (base === null) return null
  if (base >= 0 && covers(font.facts.fonts![base]!.coverage!, cp)) return base
  return listedFontOf(font, cp)
}

// Sorted inclusive ranges, flat.
function covers(ranges: readonly number[], cp: number): boolean {
  let lo = 0
  let hi = ranges.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < ranges[2 * mid]!) hi = mid - 1
    else if (cp > ranges[2 * mid + 1]!) lo = mid + 1
    else return true
  }
  return false
}

// The color emoji font Core Text draws emoji with on macOS 27, a recorded browser fact of the pinned build (probe
// gecko-port F3, rebuild/probes/gecko-emoji-font.ts; data/gecko/apple-color-emoji-advances-macos27.tsv). Its advances come
// from Core Text at the device size (gfxMacFont.cpp:437-463).
export const COLOR_EMOJI_FAMILY = '"Apple Color Emoji"'
