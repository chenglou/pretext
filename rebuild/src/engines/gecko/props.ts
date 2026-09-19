// Character properties Gecko reads through nsUnicodeProperties and intl::UnicodeProperties (ICU), from the generated
// ppucd tables (tools/gen-gecko-data.ts). Each helper cites the Firefox 156 function it ports.
import { decodeBase64 } from '../../breaks/icu4x.js'
import {
  eastAsianWidths, generalCategories, joiningTypes, openingMirrors, propertyRunsBase64, scriptExtensionLists,
  scriptExtensionRunsBase64, scriptNames,
} from './generated/props.js'

type Runs = { starts: Uint32Array; values: Int32Array }

function decodeRuns(base64: string): Runs {
  const bytes = decodeBase64(base64)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2)
  const n = words.length >> 1
  const starts = new Uint32Array(n)
  const values = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    starts[i] = words[2 * i]!
    values[i] = words[2 * i + 1]! | 0
  }
  return { starts, values }
}

const propertyRuns = decodeRuns(propertyRunsBase64)
const extensionRuns = decodeRuns(scriptExtensionRunsBase64)

function lookup(r: Runs, cp: number): number {
  let lo = 0
  let hi = r.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (r.starts[mid]! <= cp) lo = mid
    else hi = mid - 1
  }
  return r.values[lo]!
}

const gcIndex = (name: string) => generalCategories.indexOf(name)
const GC_MN = gcIndex('Mn'), GC_MC = gcIndex('Mc'), GC_ME = gcIndex('Me'), GC_CF = gcIndex('Cf')
const EA_H = eastAsianWidths.indexOf('H'), EA_F = eastAsianWidths.indexOf('F'), EA_W = eastAsianWidths.indexOf('W')

export const packedProps = (cp: number): number => lookup(propertyRuns, cp)
export const generalCategory = (cp: number): string => generalCategories[packedProps(cp) & 31]!
const gc = (cp: number): number => packedProps(cp) & 31
const ea = (cp: number): number => (packedProps(cp) >> 5) & 7
export const joiningType = (cp: number): string => joiningTypes[(packedProps(cp) >> 8) & 7]!
export const isEmoji = (cp: number): boolean => (packedProps(cp) & (1 << 11)) !== 0
export const isEmojiPresentation = (cp: number): boolean => (packedProps(cp) & (1 << 12)) !== 0
export const isDefaultIgnorable = (cp: number): boolean => (packedProps(cp) & (1 << 14)) !== 0
export const isBidiMirrored = (cp: number): boolean => (packedProps(cp) & (1 << 15)) !== 0
export const scriptOf = (cp: number): string => scriptNames[packedProps(cp) >>> 17]!

export const isFormatCategory = (cp: number): boolean => gc(cp) === GC_CF

// nsUnicodeProperties.h:127-165 GetEmojiPresentation.
export type EmojiPresentation = 'text-only' | 'text-default' | 'emoji-default'
export function emojiPresentation(cp: number): EmojiPresentation {
  if (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39) || cp === 0xa9 || cp === 0xae) return 'text-default'
  if (cp < 0x2000 || !isEmoji(cp)) return 'text-only'
  return isEmojiPresentation(cp) ? 'emoji-default' : 'text-default'
}

// nsContentUtils::IsAlphanumeric: general category letter or number.
export function isAlphanumeric(cp: number): boolean {
  const name = generalCategories[gc(cp)]!
  return name[0] === 'L' || name[0] === 'N'
}

export const isPunctuation = (cp: number): boolean => generalCategories[gc(cp)]![0] === 'P'
export const isOpenPunctuation = (cp: number): boolean => generalCategories[gc(cp)] === 'Ps'
export const isClosePunctuation = (cp: number): boolean => generalCategories[gc(cp)] === 'Pe'

// nsUnicodeProperties.cpp:130-147 IsClusterExtender / IsClusterExtenderExcludingJoiners.
export function isClusterExtender(cp: number): boolean {
  if (cp < 0x300) return false
  const g = gc(cp)
  return g === GC_MN || g === GC_MC || g === GC_ME || cp === 0x200c || cp === 0x200d || (cp >= 0xff9e && cp <= 0xff9f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f)
}

export function isClusterExtenderExcludingJoiners(cp: number): boolean {
  if (cp < 0x300) return false
  const g = gc(cp)
  return g === GC_MN || g === GC_MC || g === GC_ME || (cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0020 && cp <= 0xe007f)
}

// UnicodeProperties.h:187-218: East_Asian_Width F, H or W; excluding W characters with the Emoji property.
export function isEastAsianWidthFHW(cp: number): boolean {
  const w = ea(cp)
  return w === EA_F || w === EA_H || w === EA_W
}

export function isEastAsianWidthFHWexcludingEmoji(cp: number): boolean {
  const w = ea(cp)
  return w === EA_F || w === EA_H || (w === EA_W && !isEmoji(cp))
}

// nsUnicharUtils.cpp:498-504 IsSegmentBreakSkipChar.
export function isSegmentBreakSkipChar(cp: number): boolean {
  return isEastAsianWidthFHWexcludingEmoji(cp) && scriptOf(cp) !== 'Hang' && cp !== 0x20a9
}

// nsUnicharUtils.cpp:506-524 IsEastAsianPunctuation.
export function isEastAsianPunctuation(cp: number): boolean {
  return isEastAsianWidthFHW(cp) && ((isPunctuation(cp) && cp !== 0x20a9) || cp === 0xff5e || cp === 0x3000)
}

// intl::UnicodeProperties::IsCursiveScript (UnicodeProperties.h:350-355).
export function isCursiveScript(cp: number): boolean {
  const s = scriptOf(cp)
  return s === 'Arab' || s === 'Syrc' || s === 'Nkoo' || s === 'Mand' || s === 'Mong' || s === 'Phag' || s === 'Rohg'
}

// Script_Extensions as space-separated short names; a code point without an explicit list has its Script.
export function scriptExtensions(cp: number): string {
  const list = lookup(extensionRuns, cp)
  return list < 0 ? scriptOf(cp) : scriptExtensionLists[list]!
}

// intl::UnicodeProperties::HasScript: the code point's Script_Extensions contain the script.
export function hasScript(cp: number, script: string): boolean {
  return scriptExtensions(cp).split(' ').includes(script)
}

export function openingMirror(cp: number): number {
  for (let i = 0; i < openingMirrors.length; i += 2) if (openingMirrors[i] === cp) return openingMirrors[i + 1]!
  return cp
}

// encoding_rs::mem::is_utf16_code_unit_bidi (mem.rs:1392-1422), used by HasRTLChars (nsBidiUtils.h:107-111).
export function isUtf16CodeUnitBidi(u: number): boolean {
  if (u < 0x0590) return false
  if (u >= 0x0900 && u < 0xd802) {
    if (u >= 0x200f && u <= 0x2067) return u === 0x200f || u === 0x202b || u === 0x202e || u === 0x2067
    return false
  }
  if (u >= 0xd83c && u < 0xfb1d) return false
  if (u >= 0xd804 && u < 0xd83a) return false
  if (u > 0xfefe) return false
  if (u >= 0xfe00 && u < 0xfe70) return false
  return true
}

// nsBidiUtils.h:84-90 IsBidiControl.
export function isBidiControl(u: number): boolean {
  return (u >= 0x202a && u <= 0x202e) || (u >= 0x2066 && u <= 0x2069) || u === 0x200e || u === 0x200f || u === 0x061c
}
