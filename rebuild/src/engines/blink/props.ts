// Unicode properties Chrome 153 reads through ICU 78.2: Line_Break (break-all), General_Category L, N and M (keep-all),
// and Joining_Type (HarfBuzz's Arabic joining), per code point, from tools/gen-blink-data.ts.
import { decodeBase64 } from '../../breaks/icu4x.js'
import { blinkCharPropsBase64, blinkHanKerningTypes, blinkScriptKinds } from '../../breaks/generated/blink-break-tables.js'

// ULineBreak values used by name (unicode/uchar.h:2487-2565).
export const LB_AL = 2
export const LB_BA = 4
export const LB_CM = 9
export const LB_ID = 14
export const LB_NU = 19
export const LB_SA = 24

let runs: Uint32Array | null = null

function propsOf(cp: number): number {
  runs ??= new Uint32Array(decodeBase64(blinkCharPropsBase64).slice().buffer)
  let lo = 0
  let hi = runs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (runs[mid]! >>> 11 <= cp) lo = mid
    else hi = mid - 1
  }
  return runs[lo]! & 0x7ff
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

let hanKerningTypes: Map<number, number> | null = null

export function hanKerningCharType(cp: number): number {
  if (hanKerningTypes === null) {
    hanKerningTypes = new Map()
    for (let i = 0; i < blinkHanKerningTypes.length; i += 2) hanKerningTypes.set(blinkHanKerningTypes[i]!, blinkHanKerningTypes[i + 1]!)
  }
  return hanKerningTypes.get(cp) ?? HAN_OTHER
}

// Script kind: 0 another script, 1 Common or Inherited, 2 a cursive script.
export function scriptKind(cp: number): number {
  let lo = 0
  let hi = blinkScriptKinds.length / 3 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < blinkScriptKinds[mid * 3]!) hi = mid - 1
    else if (cp > blinkScriptKinds[mid * 3 + 1]!) lo = mid + 1
    else return blinkScriptKinds[mid * 3 + 2]!
  }
  return 0
}
