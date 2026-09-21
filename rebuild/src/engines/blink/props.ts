// Unicode properties Chrome 153 reads through ICU 78.2: Line_Break (break-all), General_Category L, N and M (keep-all),
// Joining_Type (HarfBuzz's Arabic joining), scripts and paired brackets (ScriptRunIterator), HanKerning types, White_Space,
// Extended_Pictographic, Default_Ignorable_Code_Point, Emoji_Component and General_Category Lm and Sk, per code point, from
// tools/gen-blink-data.ts.
import { decodeBase64 } from '../../breaks/icu4x.js'
import {
  blinkCharPropsBase64, blinkCjkIdeographOrSymbolRanges, blinkCursiveScripts, blinkHanKerningTypes, blinkScriptExtensions, blinkScriptPropsBase64,
} from './generated/break-tables.js'

// ULineBreak values used by name (unicode/uchar.h:2487-2565).
export const LB_AL = 2
export const LB_BA = 4
export const LB_CM = 9
export const LB_ID = 14
export const LB_NU = 19
export const LB_SA = 24

// Decoded when the module loads and kept for the life of the page, like the break tables (data.ts).
const runs = new Uint32Array(decodeBase64(blinkCharPropsBase64).slice().buffer)
const scriptRuns = new Uint32Array(decodeBase64(blinkScriptPropsBase64).slice().buffer)

function searchProps(cp: number): number {
  let lo = 0
  let hi = runs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (runs[mid]! >>> 11 <= cp) lo = mid
    else hi = mid - 1
  }
  return runs[lo]! & 0x7ff
}

function searchScriptProps(cp: number): number {
  let lo = 0
  let hi = scriptRuns.length / 2 - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (scriptRuns[2 * mid]! <= cp) lo = mid
    else hi = mid - 1
  }
  return scriptRuns[2 * lo + 1]!
}

// Both values of every code point below U+3000 (the scripts written with letters, and General Punctuation), read by
// index. Every string the port measures reads several: the joining types at its two edges, the marks beside an offset,
// the script of its first characters. Made from the runs when the module loads, in about a millisecond, and kept like
// them: 72 KB.
const FLAT = 0x3000
const flatProps = new Uint16Array(FLAT)
const flatScriptProps = new Uint32Array(FLAT)
for (let cp = 0; cp < FLAT; cp++) {
  flatProps[cp] = searchProps(cp)
  flatScriptProps[cp] = searchScriptProps(cp)
}

function propsOf(cp: number): number {
  return cp < FLAT ? flatProps[cp]! : searchProps(cp)
}

// u_getIntPropertyValue(cp, UCHAR_LINE_BREAK).
export function lineBreakClass(cp: number): number {
  return propsOf(cp) & 0x3f
}

// U_MASK(u_charType(c)) & (U_GC_L_MASK | U_GC_N_MASK).
export function isLetterOrNumber(cp: number): boolean {
  return (propsOf(cp) & 0x40) !== 0
}

// U_MASK(u_charType(c)) & U_GC_M_MASK.
export function isMark(cp: number): boolean {
  return (propsOf(cp) & 0x80) !== 0
}

// Joining_Type: 0 U, 1 D, 2 R, 3 L, 4 C, 5 T.
export function joiningType(cp: number): number {
  return (propsOf(cp) >> 8) & 7
}

// HanKerningCharType (han_kerning_char_type.h:17-37): 0 other, 1 open, 2 close, 3 middle, 4 open narrow, 5 close narrow,
// 6 dot, 7 colon, 8 semicolon, 9 open quote, 10 close quote.
export const HAN_OTHER = 0, HAN_OPEN = 1, HAN_CLOSE = 2, HAN_MIDDLE = 3, HAN_OPEN_NARROW = 4, HAN_CLOSE_NARROW = 5, HAN_DOT = 6,
  HAN_COLON = 7, HAN_SEMICOLON = 8, HAN_OPEN_QUOTE = 9, HAN_CLOSE_QUOTE = 10

// From the generated [code point, type] pairs, ascending, of every code point that isn't kOther.
export function hanKerningCharType(cp: number): number {
  const pairs = blinkHanKerningTypes
  let lo = 0
  let hi = pairs.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pairs[2 * mid] === cp) return pairs[2 * mid + 1]!
    if (pairs[2 * mid]! < cp) lo = mid + 1
    else hi = mid - 1
  }
  return HAN_OTHER
}

// UScriptCode numbers used by name (unicode/uscript.h:63-539).
export const USCRIPT_INVALID_CODE = -1, USCRIPT_COMMON = 0, USCRIPT_INHERITED = 1, USCRIPT_BOPOMOFO = 5, USCRIPT_HAN = 17,
  USCRIPT_HIRAGANA = 20, USCRIPT_KATAKANA = 22, USCRIPT_LATIN = 25, USCRIPT_KATAKANA_OR_HIRAGANA = 54

function scriptPropsOf(cp: number): number {
  return cp < FLAT ? flatScriptProps[cp]! : searchScriptProps(cp)
}

// uscript_getScript.
export function scriptOf(cp: number): number {
  return scriptPropsOf(cp) & 0xff
}

// uscript_getScriptExtensions: the extension list, or the script alone.
export function scriptExtensionsOf(cp: number): readonly number[] {
  const value = scriptPropsOf(cp)
  const list = (value >> 8) & 0x3ff
  return list === 0 ? [value & 0xff] : blinkScriptExtensions[list]!
}

// u_getIntPropertyValue(cp, UCHAR_BIDI_PAIRED_BRACKET_TYPE): 0 none, 1 open, 2 close.
export function pairedBracketType(cp: number): number {
  return (scriptPropsOf(cp) >> 18) & 3
}

// East_Asian_Width W, F or H (script_run_iterator.cc:94-97).
export function isEastAsianWide(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x100000) !== 0
}

// White_Space.
export function isWhiteSpace(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x200000) !== 0
}

// Extended_Pictographic (HarfBuzz's _hb_unicode_is_emoji_Extended_Pictographic).
export function isExtendedPictographic(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x400000) !== 0
}

// Character::IsDefaultIgnorable (character.h:184-189): SHY alone below U+0100, else ICU's Default_Ignorable_Code_Point.
// HarfBuzz's own set is another one (hb-unicode.hh:170-197, shape.ts isDefaultIgnorableHarfBuzz).
export function isDefaultIgnorable(cp: number): boolean {
  if (cp < 0x100) return cp === 0xad
  return (scriptPropsOf(cp) & 0x800000) !== 0
}

// Character::IsEmojiComponent (character.cc:245-247): Emoji_Component.
export function isEmojiComponent(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x1000000) !== 0
}

// U_GET_GC_MASK(c) & (U_GC_M_MASK | U_GC_LM_MASK | U_GC_SK_MASK) (plain_text_node.cc:136-137, character.h:101-104).
export function isMarkOrModifier(cp: number): boolean {
  return isMark(cp) || (scriptPropsOf(cp) & 0x2000000) !== 0
}

// Character::IsEmoji (Emoji), IsEmojiEmojiDefault (Emoji_Presentation) and IsEmojiModifierBase (character_emoji.cc:320-335),
// and u_charType(c) == U_UNASSIGNED (:337-343).
export function isEmoji(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x4000000) !== 0
}

export function isEmojiPresentation(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x8000000) !== 0
}

export function isEmojiModifierBase(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x10000000) !== 0
}

export function isUnassigned(cp: number): boolean {
  return (scriptPropsOf(cp) & 0x20000000) !== 0
}

// IsCursiveScript (shape_result.cc:977-990) over UScriptCode numbers.
export function isCursiveScript(script: number): boolean {
  return blinkCursiveScripts.includes(script)
}

// Character::IsCjkIdeographOrSymbol (character.h:97-100): false below U+02C7, else Blink's generated property
// (character_property_data_generator.cc:89-140), from the ranges tools/gen-blink-data.ts generates.
export function isCjkIdeographOrSymbol(cp: number): boolean {
  if (cp < 0x2c7) return false
  const ranges = blinkCjkIdeographOrSymbolRanges
  let lo = 0
  let hi = ranges.length / 2 - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[2 * mid]! <= cp) lo = mid
    else hi = mid - 1
  }
  return ranges[2 * lo]! <= cp && cp <= ranges[2 * lo + 1]!
}

// Character::IsCjkIdeographOrSymbolBase (character.h:101-104).
export function isCjkIdeographOrSymbolBase(cp: number): boolean {
  return isCjkIdeographOrSymbol(cp) && !isMarkOrModifier(cp)
}
