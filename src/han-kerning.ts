// Blink's HanKerning under the default text-spacing-trim: normal (han_kerning.cc/.h,
// han_kerning_char_type.h and shaping_line_breaker.cc at Chrome 153). Blink halts a fullwidth
// opening mark after an opening, middle, closing or narrow opening mark, and a closing mark
// before a closing, middle or narrow closing mark (HanKerning::ShouldKern and ShouldKernLast,
// han_kerning.h:164-174), reading the characters on both sides of each shaped range, except
// at a wrapped line start: text-spacing-trim: normal doesn't trim there
// (text_spacing_trim.h:31-34), and the line start is reshaped with is_line_start, which skips
// the character before it (shaping_line_breaker.cc:91-109, 307-324; harfbuzz_shaper.cc:1019-1030;
// han_kerning.cc:266). At a line end it halts a closing mark that doesn't otherwise fit, where
// a break follows it (shaping_line_breaker.cc:342-363).
//
// Canvas applies the pair rules only inside what it shapes as one word: Blink's Canvas cuts a
// string before and after CJK ideographs and symbols and shapes each word alone
// (plain_text_node.cc:93-155, 377-400). So preparation adds the halts the page gives across
// segment boundaries and across those cuts. A segment's width leaves out the halt of its first
// character after the text before it, which a line start takes back, the halts of pairs it
// holds across a cut, such as `(「`, and the halt of its last character before the text after
// it; a line end can halt its last closing mark. Every character type and trim is read from
// Canvas once per font: in `cc` HanKerning halts exactly one of the two, so a character's trim
// is 2 W(c) - W(cc), and the types of dots, colons, semicolons and quotes follow their ink
// bounds under the page's Han script (han_kerning.cc:47-168, 400-535).
import { getMeasureContext, getSegmentMetrics, type FontMeasurement, type SegmentMetrics } from './measurement.js'

const OTHER = 0
const OPEN = 1
const CLOSE = 2
const MIDDLE = 3
const OPEN_NARROW = 4
const CLOSE_NARROW = 5
const DOT = 6
const COLON = 7
const SEMICOLON = 8
const OPEN_QUOTE = 9
const CLOSE_QUOTE = 10

const openPunctuationRe = /^\p{Ps}$/u
const closePunctuationRe = /^\p{Pe}$/u

// Character::MaybeHanKerningOpenOrCloseFast (character.h:138-141): every fullwidth opening
// and closing mark and every quote is in these ranges.
const maybeHanKerningRe = /[\u2018-\u301F\uFF08-\uFF60]/

function maybeHanKerns(c: number): boolean {
  return (c >= 0x2018 && c <= 0x301F) || (c >= 0xFF08 && c <= 0xFF60)
}

export function textMayHanKern(text: string): boolean {
  return maybeHanKerningRe.test(text)
}

// HanKerningCharType (character_property_data_generator.cc:143-167, han_kerning_char_type.h:17-44):
// the listed quotes, dots, colon, semicolon and middles, then Ps and Pe, fullwidth when in the CJK
// Symbols block or East_Asian_Width F.
function getStaticCharType(c: number): number {
  switch (c) {
    case 0x2018: case 0x201C: return OPEN_QUOTE
    case 0x2019: case 0x201D: return CLOSE_QUOTE
    case 0x3001: case 0x3002: case 0xFF0C: case 0xFF0E: return DOT
    case 0xFF1A: return COLON
    case 0xFF1B: return SEMICOLON
    case 0x00B7: case 0x2027: case 0x3000: case 0x30FB: return MIDDLE
  }
  if (c < 0x28) return OTHER
  const s = String.fromCharCode(c)
  const wide = (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF01 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6)
  if (openPunctuationRe.test(s)) return wide ? OPEN : OPEN_NARROW
  if (closePunctuationRe.test(s)) return wide ? CLOSE : CLOSE_NARROW
  return OTHER
}

export type HanKerningFontData = {
  typeForDot: number
  typeForColon: number
  typeForSemicolon: number
  quoteFullwidth: boolean
  trims: Map<number, number>
}

// CharTypeFromBounds (han_kerning.cc:48-73), horizontal, of c as HanKerning::FontData
// shapes it: under the locale's Han script (han_kerning.cc:462), where `locl` can move
// punctuation. Under zh-Hans, PingFang TC draws `。` in the left half of its em, and alone
// centered. Canvas shapes a CJK symbol next to 中 as Han, so its right edge comes from `中c`
// and its left edge from `c中`, where 中's ink covers neither. Curly quotes and U+FF1B are
// words of their own in Canvas (NextWordEndIndex) and are measured alone.
function getTypeFromBounds(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, c: number, hanWidth: number): { advance: number; type: number } {
  const s = String.fromCharCode(c)
  let advance: number
  let left: number
  let right: number
  if (isCanvasCjkSymbol(c)) {
    const after = ctx.measureText('\u4E2D' + s)
    advance = after.width - hanWidth
    right = after.actualBoundingBoxRight - hanWidth
    left = -ctx.measureText(s + '\u4E2D').actualBoundingBoxLeft
  } else {
    const metrics = ctx.measureText(s)
    advance = metrics.width
    left = -metrics.actualBoundingBoxLeft
    right = metrics.actualBoundingBoxRight
  }
  const halfEm = advance / 2
  const type = right <= halfEm ? CLOSE : left >= halfEm ? OPEN : right - left <= halfEm && left >= halfEm / 2 ? MIDDLE : OTHER
  return { advance, type }
}

function getTrim(data: HanKerningFontData, c: number, cache: Map<string, SegmentMetrics>): number {
  let trim = data.trims.get(c)
  if (trim === undefined) {
    const one = String.fromCharCode(c)
    trim = 2 * getSegmentMetrics(one, cache).width - getSegmentMetrics(one + one, cache).width
    data.trims.set(c, trim)
  }
  return trim
}

// HanKerning::FontData (han_kerning.cc:400-535), with the measure context set to the font;
// null where the font that draws 「 has no halt.
function getFontData(measurement: FontMeasurement): HanKerningFontData | null {
  if (measurement.hanKerning !== undefined) return measurement.hanKerning
  const cache = measurement.metrics
  const data: HanKerningFontData = { typeForDot: OTHER, typeForColon: OTHER, typeForSemicolon: OTHER, quoteFullwidth: false, trims: new Map() }
  if (getTrim(data, 0x300C, cache) <= 1e-3) {
    measurement.hanKerning = null
    return null
  }
  const hanWidth = getSegmentMetrics('\u4E2D', cache).width
  const ctx = getMeasureContext()
  const glyphs = [0x3001, 0x3002, 0xFF0C, 0xFF0E, 0xFF1A, 0xFF1B, 0x201C, 0x2018, 0x201D, 0x2019].map(c => getTypeFromBounds(ctx, c, hanWidth))
  // A group has one type only when its glyphs share the advance and the type (han_kerning.cc:88-135).
  const group = (from: number, to: number): number => {
    for (let i = from + 1; i < to; i++) {
      if (glyphs[i]!.advance !== glyphs[from]!.advance || glyphs[i]!.type !== glyphs[from]!.type) return OTHER
    }
    return glyphs[from]!.type
  }
  data.typeForDot = group(0, 4)
  data.typeForColon = glyphs[4]!.type
  data.typeForSemicolon = glyphs[5]!.type
  data.quoteFullwidth = group(6, 8) === OPEN && group(8, 10) === CLOSE
  measurement.hanKerning = data
  return data
}

// HanKerning::GetCharType (han_kerning.cc:142-168).
function getCharType(data: HanKerningFontData, c: number): number {
  const type = getStaticCharType(c)
  switch (type) {
    case DOT: return data.typeForDot
    case COLON: return data.typeForColon
    case SEMICOLON: return data.typeForSemicolon
    case OPEN_QUOTE: return data.quoteFullwidth ? OPEN : OPEN_NARROW
    case CLOSE_QUOTE: return data.quoteFullwidth ? CLOSE : CLOSE_NARROW
    default: return type
  }
}

// HanKerning::ShouldKern and ShouldKernLast (han_kerning.h:164-174): the halted character of
// the pair (earlier, later), 1 for the later, -1 for the earlier, 0 for neither.
function haltedSide(earlier: number, later: number): number {
  if (later === OPEN && (earlier === OPEN || earlier === MIDDLE || earlier === CLOSE || earlier === OPEN_NARROW)) return 1
  if (earlier === CLOSE && (later === CLOSE || later === MIDDLE || later === CLOSE_NARROW)) return -1
  return 0
}

// Character::IsCjkIdeographOrSymbol (character_property_data.h:17-110) for the characters
// HanKerning types. Canvas starts a word where exactly one of two such characters is a CJK
// symbol (NextWordEndIndex, plain_text_node.cc:93-155): curly quotes, U+00B7, U+2027, U+FF1B
// and the narrow brackets aren't.
function isCanvasCjkSymbol(c: number): boolean {
  return (c >= 0x3000 && c <= 0x30FF) || (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFFEF && c !== 0xFF1B)
}

export type HanKerningTrims = {
  // Per segment, the halts the page gives its characters that its Canvas width keeps: of its
  // first character after the text before it, of its last before the text after it, and of
  // pairs inside it that Canvas shapes as two words. Null without any.
  widthTrims: number[] | null
  // Per segment, the halt of its first character after the character before it, which a line
  // start adds back. Null without any.
  lineStartExtras: number[] | null
  // Per segment, the halt of its last character where the line ends after it. Null without any.
  lineEndTrims: number[] | null
}

// The trims of text segments, given each segment's text, the characters before and after it
// (-1 at the paragraph's ends), and whether a break directly follows it.
export function getHanKerningTrims(
  measurement: FontMeasurement,
  texts: readonly string[],
  isText: (index: number) => boolean,
  previousCode: (index: number) => number,
  nextCode: (index: number) => number,
  breaksAfterEnd: (index: number) => boolean,
): HanKerningTrims {
  const out: HanKerningTrims = { widthTrims: null, lineStartExtras: null, lineEndTrims: null }
  const data = getFontData(measurement)
  if (data === null) return out
  const cache = measurement.metrics
  const addWidthTrim = (i: number, trim: number): void => {
    out.widthTrims ??= Array.from({ length: texts.length }, () => 0)
    out.widthTrims[i] = out.widthTrims[i]! + trim
  }
  for (let i = 0; i < texts.length; i++) {
    if (!isText(i)) continue
    const text = texts[i]!
    const first = text.charCodeAt(0)
    const previous = previousCode(i)
    if (previous >= 0 && maybeHanKerns(first) && haltedSide(getCharType(data, previous), getCharType(data, first)) === 1) {
      const trim = getTrim(data, first, cache)
      out.lineStartExtras ??= Array.from({ length: texts.length }, () => 0)
      out.lineStartExtras[i] = trim
      addWidthTrim(i, trim)
    }
    for (let k = 1; k < text.length; k++) {
      const earlier = text.charCodeAt(k - 1)
      const later = text.charCodeAt(k)
      if (!(maybeHanKerns(earlier) || maybeHanKerns(later)) || isCanvasCjkSymbol(earlier) === isCanvasCjkSymbol(later)) continue
      const side = haltedSide(getCharType(data, earlier), getCharType(data, later))
      if (side !== 0) addWidthTrim(i, getTrim(data, side === 1 ? later : earlier, cache))
    }
    const last = text.charCodeAt(text.length - 1)
    if (!maybeHanKerns(last)) continue
    // The text after it halts a closing mark wherever the line ends.
    const next = nextCode(i)
    if (next >= 0 && haltedSide(getCharType(data, last), getCharType(data, next)) === -1) {
      addWidthTrim(i, getTrim(data, last, cache))
      continue
    }
    // Character::MaybeHanKerningClose (character.h:131-133, character.cc:130-135). Blink then
    // halts the character whatever the font types it (han_kerning.cc:284-285, 312-313); the
    // port asks for a closing type, since only then does 2 W(c) - W(cc) measure the halt.
    const lastType = getStaticCharType(last)
    if ((lastType === CLOSE || lastType === CLOSE_QUOTE) && getCharType(data, last) === CLOSE && breaksAfterEnd(i)) {
      out.lineEndTrims ??= Array.from({ length: texts.length }, () => 0)
      out.lineEndTrims[i] = getTrim(data, last, cache)
    }
  }
  return out
}
