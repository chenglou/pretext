// WebKit's break data: BreakablePositions' pair table, libicucore 78.1's line tables with Apple ICU's quote overrides,
// the punctuation General_Category set, and WebKit's locale-to-script table (specs/webkit-text.md §4-§5,
// specs/webkit-canvas.md §2.5-§2.6).
import { NO_OVERRIDES, getCategory, type BreakRules, type CategoryOverrides } from '../../breaks/rbbi.js'
import { pairCanBreak, webkitBreakRules, webkitLinePairs } from '../../breaks/tables.js'
import {
  webkitDefaultIgnorableRanges, webkitDelimiters, webkitDictionaryMarkRanges, webkitLineTables, webkitLocaleScripts, webkitPunctuationRanges, webkitScriptNames,
} from '../../breaks/generated/webkit-break-tables.js'
import type { LineBreakMode } from './types.js'

// LineBreakTable::unsafeLookup (BreakablePositions.h:111-116), both characters in U+0021..U+00FF.
export function pairTableBreaks(before: number, after: number): boolean {
  return pairCanBreak(webkitLinePairs(), before, after)
}

function inRanges(r: readonly number[], c: number): boolean {
  let lo = 0
  let hi = r.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (c < r[mid * 2]!) hi = mid - 1
    else if (c > r[mid * 2 + 1]!) lo = mid + 1
    else return true
  }
  return false
}

// U_GET_GC_MASK(c) & (Ps|Pe|Pi|Pf|Po) for a UTF-16 code unit in libicucore 78.1. Surrogates are Cs, so supplementary
// punctuation never matches.
export function isPunctuation(c: number): boolean {
  return inRanges(webkitPunctuationRanges, c)
}

// Default_Ignorable_Code_Point (ICU 78.2 ppucd.txt).
export function isDefaultIgnorable(cp: number): boolean {
  return inRanges(webkitDefaultIgnorableRanges, cp)
}

// [[:LineBreak=SA:]&[:M:]]: the dictionary engines' fMarkSet for the script of c (ICU dictbe.cpp:210, 453, 648, 843).
export function isDictionaryMark(cp: number): boolean {
  return inRanges(webkitDictionaryMarkRanges, cp)
}

// ICU resource lookup: the locale as dumped, else its parents by truncation, else root. Break tables open with
// ures_openNoDefault, so the process default locale never enters (specs/webkit-gaps.md §8.3); for CLDR delimiters the
// default (en_US_POSIX here) gives root's data too.
function lookupLocale<T>(table: Readonly<Record<string, T>>, locale: string): T {
  let key = locale.replaceAll('_', '-').toLowerCase()
  for (;;) {
    const found = table[key]
    if (found !== undefined) return found
    const cut = key.lastIndexOf('-')
    if (cut < 0) return table['root']!
    key = key.slice(0, cut)
  }
}

export type LineRules = { rules: BreakRules; overrides: CategoryOverrides }

// ubrk_open(UBRK_LINE, makeLocaleWithBreakKeyword(locale, mode)) (TextBreakIteratorICU.h:56-67, 150-193). The empty
// locale ignores the mode; data/webkit's manifest records the table for every behaviour.
export function lineRules(locale: string, mode: LineBreakMode): LineRules {
  const tables = lookupLocale(webkitLineTables, locale)
  let table: (typeof tables)[number]
  switch (mode) {
    case 'Default': table = tables[0]; break
    case 'Loose': table = tables[1]; break
    case 'Normal': table = tables[2]; break
    case 'Strict': table = tables[3]; break
  }
  const rules = webkitBreakRules(table)
  return { rules, overrides: quoteOverrides(rules, locale) }
}

// Apple ICU setCategoryOverrides (AppleICU76 rbbi.cpp:397-486; specs/webkit-canvas.md §2.6): a one-unit delimiter with
// Line_Break QU reads as U+007B (opening) or U+007D (closing) in this table; a closing U+201C becomes U+201D, a closing
// U+2018 is dropped, and da gets none. The @lb keyword doesn't change the lookup.
function quoteOverrides(rules: BreakRules, locale: string): CategoryOverrides {
  if (locale.split(/[-_@]/)[0]!.toLowerCase() === 'da') return NO_OVERRIDES
  const row = lookupLocale(webkitDelimiters, locale)
  const chars: number[] = []
  const categories: number[] = []
  for (let pair = 0; pair < 2; pair++) {
    const open = row[pair * 4]!
    const openIsQuotation = row[pair * 4 + 1] === 1
    let close = row[pair * 4 + 2]!
    let closeIsQuotation = row[pair * 4 + 3] === 1
    if (close === 0x201c) {
      close = 0x201d
      closeIsQuotation = true
    } else if (close === 0x2018) {
      close = 0
      closeIsQuotation = false
    }
    if (open === close) continue
    if (openIsQuotation && open !== 0x2019) {
      chars.push(open)
      categories.push(getCategory(rules, 0x7b))
    }
    if (closeIsQuotation && close !== 0x2019) {
      chars.push(close)
      categories.push(getCategory(rules, 0x7d))
    }
  }
  return { chars, categories }
}

// PackedASCIILowerCodes::parse: at most `max` ASCII units, lowercased; anything else matches nothing.
function packedLower(s: string, max: number): string | null {
  if (s.length > max) return null
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return null
  return s.toLowerCase()
}

// localeToScriptCode (LocaleToScriptMapping.cpp:360-377): the USCRIPT_ name without its prefix, or 'COMMON'.
export function localeScript(locale: string): string {
  let canonical = locale.replaceAll('-', '_')
  while (canonical.length > 0) {
    const name = packedLower(canonical, 8)
    if (name !== null) {
      const script = webkitLocaleScripts[name]
      if (script !== undefined) return script
    }
    const cut = canonical.lastIndexOf('_')
    if (cut < 0) break
    const scriptName = packedLower(canonical.slice(cut + 1), 4)
    if (scriptName !== null) {
      const script = webkitScriptNames[scriptName]
      if (script !== undefined && script !== 'UNKNOWN') return script
    }
    canonical = canonical.slice(0, cut)
  }
  return 'COMMON'
}

export function isHanLocale(locale: string): boolean {
  return localeScript(locale) === 'HAN'
}

// FontDescription::setSpecifiedLocale (FontDescription.cpp:107-113): `lang=""` gives a null locale, and a Han locale
// becomes the specialized Chinese locale, the first preferred language starting with "zh-", else "zh-hans" (:75-104).
export function computedLocale(lang: string, preferredLanguages: readonly string[]): string {
  if (lang === '' || !isHanLocale(lang)) return lang
  for (let i = 0; i < preferredLanguages.length; i++) {
    if (preferredLanguages[i]!.startsWith('zh-')) return preferredLanguages[i]!
  }
  return 'zh-hans'
}
