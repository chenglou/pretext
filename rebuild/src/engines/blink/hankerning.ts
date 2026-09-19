// HanKerning (han_kerning.cc/.h at Chrome 153): with the default text-spacing-trim: normal, Blink applies `halt` to a
// fullwidth open mark after an open, middle, close or narrow open mark, and to a close mark before a close, middle or
// narrow close mark, reading the characters on both sides of each shaped range from text_content. Canvas shapes a
// measured string alone, so those context trims, and the line-end trim ShapingLineBreaker asks for with
// `han_kerning_end`, are added here. The trim of one character is 2 × W(c) − W(cc): in `cc` HanKerning halts exactly
// one of the two (ShouldKern for opens, ShouldKernLast for closes).
import { bounds } from '../../measure/canvas.js'
import {
  HAN_CLOSE, HAN_CLOSE_NARROW, HAN_CLOSE_QUOTE, HAN_COLON, HAN_DOT, HAN_MIDDLE, HAN_OPEN, HAN_OPEN_NARROW, HAN_OPEN_QUOTE, HAN_OTHER,
  HAN_SEMICOLON, hanKerningCharType,
} from './props.js'
import { raw16Of, type Shaper } from './shape.js'
import type { BlinkPrepared } from './types.js'

export type HanKerningFontData = {
  hasHalt: boolean
  typeForDot: number
  typeForColon: number
  typeForSemicolon: number
  quoteFullwidth: boolean
}

// Character::MaybeHanKerningOpenOrCloseFast (character.h:138-141).
export function maybeHanKerningFast(c: number): boolean {
  return (c >= 0x2018 && c <= 0x301f) || (c >= 0xff08 && c <= 0xff60)
}

// Character::MaybeHanKerningClose (character.h:131-133).
export function maybeHanKerningClose(c: number): boolean {
  const type = hanKerningCharType(c)
  return maybeHanKerningFast(c) && (type === HAN_CLOSE || type === HAN_CLOSE_QUOTE)
}

// Per text_content offset, how many units before it pass MaybeHanKerningOpenOrCloseFast, the end included. An 8-bit text
// has none (every such character is above U+00FF).
export function hanKerningCandidates(text: string): Int32Array {
  const counts = new Int32Array(text.length + 1)
  for (let i = 0; i < text.length; i++) counts[i + 1] = counts[i]! + (maybeHanKerningFast(text.charCodeAt(i)) ? 1 : 0)
  return counts
}

// HanKerning::MayApply (han_kerning.h:152-156) for text_content[start, end), from hanKerningCandidates: a scan of the range
// on every position made a 256,837-unit Arabic paragraph's positions quadratic.
export function hanKerningMayApply(candidates: Int32Array, start: number, end: number): boolean {
  return candidates[end]! - candidates[start]! > 0
}

// CharTypeFromBounds (han_kerning.cc:37-63), horizontal.
function typeFromBounds(halfEm: number, left: number, right: number): number {
  if (right <= halfEm) return HAN_CLOSE
  if (left >= halfEm) return HAN_OPEN
  if (right - left <= halfEm && left >= halfEm / 2) return HAN_MIDDLE
  return HAN_OTHER
}

// HanKerning::FontData (han_kerning.cc:417-535) from Canvas: `halt` through the pair trim of 「「, glyph bounds from
// measureText's ink box. Measured in prepare for every style with a shaping group HanKerning may apply to.
export function measureHanKerningFontData(sh: Shaper, style: number): void {
  const p = sh.p
  if (p.hanKerning[style] !== null) return
  const context = p.contexts[style]!.hyphen
  const data: HanKerningFontData = { hasHalt: trim16(sh, style, 0x300c) > 0, typeForDot: HAN_OTHER, typeForColon: HAN_OTHER, typeForSemicolon: HAN_OTHER, quoteFullwidth: false }
  if (data.hasHalt) {
    const chars = [0x3001, 0x3002, 0xff0c, 0xff0e, 0xff1a, 0xff1b, 0x201c, 0x2018, 0x201d, 0x2019]
    const glyphs = chars.map(c => {
      const b = bounds(context, String.fromCharCode(c))
      return { advance: b.width, type: typeFromBounds(b.width / 2, -b.left, b.right) }
    })
    // A group has one type only when its glyphs share the advance and the type (han_kerning.cc:75-110).
    const group = (from: number, to: number): number => {
      for (let i = from + 1; i < to; i++) {
        if (glyphs[i]!.advance !== glyphs[from]!.advance || glyphs[i]!.type !== glyphs[from]!.type) return HAN_OTHER
      }
      return glyphs[from]!.type
    }
    data.typeForDot = group(0, 4)
    data.typeForColon = glyphs[4]!.type
    data.typeForSemicolon = glyphs[5]!.type
    data.quoteFullwidth = group(6, 8) === HAN_OPEN && group(8, 10) === HAN_CLOSE
  }
  p.hanKerning[style] = data
}

// The measured font data of a style whose text HanKerning may apply to.
export function hanKerningFontData(p: BlinkPrepared, style: number): HanKerningFontData {
  return p.hanKerning[style]!
}

// HanKerning::GetCharType (han_kerning.cc:116-140).
export function resolvedCharType(data: HanKerningFontData, c: number): number {
  const type = hanKerningCharType(c)
  switch (type) {
    case HAN_DOT: return data.typeForDot
    case HAN_COLON: return data.typeForColon
    case HAN_SEMICOLON: return data.typeForSemicolon
    case HAN_OPEN_QUOTE: return data.quoteFullwidth ? HAN_OPEN : HAN_OPEN_NARROW
    case HAN_CLOSE_QUOTE: return data.quoteFullwidth ? HAN_CLOSE : HAN_CLOSE_NARROW
    default: return type
  }
}

// HanKerning::ShouldKern and ShouldKernLast (han_kerning.h:162-172).
export function shouldKern(type: number, lastType: number): boolean {
  return type === HAN_OPEN && (lastType === HAN_OPEN || lastType === HAN_MIDDLE || lastType === HAN_CLOSE || lastType === HAN_OPEN_NARROW)
}

export function shouldKernLast(type: number, lastType: number): boolean {
  return lastType === HAN_CLOSE && (type === HAN_CLOSE || type === HAN_MIDDLE || type === HAN_CLOSE_NARROW)
}

// The 16.16 amount `halt` removes from character c in this style's font.
export function trim16(sh: Shaper, style: number, c: number): number {
  const contexts = sh.p.contexts[style]!
  const one = String.fromCharCode(c)
  return 2 * raw16Of(contexts, contexts.hyphen, one) - raw16Of(contexts, contexts.hyphen, one + one)
}
