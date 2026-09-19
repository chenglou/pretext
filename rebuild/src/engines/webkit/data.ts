// WebKit's break and bidi data: BreakablePositions' pair table, libicucore 78.1's line tables with Apple ICU's quote
// overrides, its char.brk and bidi classes, the punctuation General_Category set, the dictionary engines' scripts, and
// WebKit's locale-to-script table (specs/webkit-text.md §4-§5, specs/webkit-canvas.md §2.5-§2.6, specs/webkit-gaps.md §4,
// §8). The tables are parsed when the module loads and kept for the life of the page: a parsed table depends only on its
// generated module.
import { decodeBase64 } from '../../breaks/icu4x.js'
import { pairCanBreak } from '../../breaks/pair-table.js'
import { NO_OVERRIDES, getCategory, parseBreakRules, type BreakRules, type CategoryOverrides } from '../../breaks/rbbi.js'
import { libicucoreBidiClasses, type BidiData } from '../../unicode/bidi.js'
import { unicode17BracketPairs } from '../../unicode/generated/bidi-data.js'
import type { GraphemeRules } from '../../unicode/grapheme.js'
import {
  webkitBreakTableBase64, webkitDelimiters, webkitDictionaryMarkRanges, webkitDictionaryScriptRanges, webkitLinePairsBase64, webkitLineTables,
  webkitLocaleScripts, webkitPunctuationRanges, webkitScriptNames, type WebKitBreakTable,
} from './generated/break-tables.js'
import type { LineBreakMode } from './types.js'

function parsed(table: WebKitBreakTable): BreakRules {
  return parseBreakRules(decodeBase64(webkitBreakTableBase64[table]))
}

// macOS 27 libicucore tables (ICU 78.1).
const webkitBreakRules: Record<WebKitBreakTable, BreakRules> = {
  line: parsed('line'), line_loose: parsed('line_loose'), line_normal: parsed('line_normal'), line_cj: parsed('line_cj'),
  line_normal_cj: parsed('line_normal_cj'), line_loose_cj: parsed('line_loose_cj'), char: parsed('char'),
}

// WebKit's LineBreakTable::breakTable, in the layout breaks/pair-table.ts reads.
const webkitLinePairs: Uint8Array = decodeBase64(webkitLinePairsBase64)

// Extended grapheme cluster boundaries: libicucore 78.1 char.brk, opened by NonSharedCharacterBreakIterator
// (specs/webkit-canvas.md §2.4). Its locale (the user's text-break locale) doesn't change the table on macOS 27 (both
// configurations load fe6dbecf).
export const webkitGraphemeRules: GraphemeRules = { kind: 'icu-rbbi', rules: webkitBreakRules.char }

// ICU 78.2's Bidi_Class and Bidi_Paired_Bracket, Unicode 17, with Apple's own classes for private-use U+F7F0..U+F8FF,
// which macOS 27's libicucore reports; for unicode/ubidi.ts.
export const webkitBidiData: BidiData = { classes: libicucoreBidiClasses, brackets: unicode17BracketPairs }

// LineBreakTable::unsafeLookup (BreakablePositions.h:111-116), both characters in U+0021..U+00FF.
export function pairTableBreaks(before: number, after: number): boolean {
  return pairCanBreak(webkitLinePairs, before, after)
}

// Whether `c` is in one of the ranges of a sorted flat list of [first, last] pairs.
export function inRanges(r: readonly number[], c: number): boolean {
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

// [[:LineBreak=SA:]&[:M:]]: the dictionary engines' fMarkSet for the script of c (ICU dictbe.cpp:210, 453, 648, 843).
export function isDictionaryMark(cp: number): boolean {
  return inRanges(webkitDictionaryMarkRanges, cp)
}

export type DictionaryScript = 'thai' | 'lao' | 'burmese' | 'khmer'
const DICTIONARY_SCRIPTS: readonly DictionaryScript[] = ['thai', 'lao', 'burmese', 'khmer']

// uscript_getScript(c) where it is Thai, Lao, Myanmar or Khmer and Line_Break is SA: the engine
// ICULanguageBreakFactory::loadEngineFor builds for c (brkeng.cpp:163-199) and the set it takes,
// [[:Thai:]&[:LineBreak=SA:]] and so on (dictbe.cpp:208, 451, 651, 841). null for every other character, which reaches
// UnhandledEngine and gets no breaks.
export function dictionaryScript(cp: number): DictionaryScript | null {
  const r = webkitDictionaryScriptRanges
  let lo = 0
  let hi = r.length / 3 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < r[mid * 3]!) hi = mid - 1
    else if (cp > r[mid * 3 + 1]!) lo = mid + 1
    else return DICTIONARY_SCRIPTS[r[mid * 3 + 2]!]!
  }
  return null
}

function localeKey(locale: string): string {
  return locale.replaceAll('_', '-').toLowerCase()
}

// ICU resource lookup: the locale as dumped, else its parents by truncation, else root. Break tables open with
// ures_openNoDefault, so the process default locale never enters (specs/webkit-gaps.md §8.3).
function lookupLocale<T>(table: Readonly<Record<string, T>>, locale: string): T {
  let key = localeKey(locale)
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
// locale ignores the mode; data/webkit's manifest records the table for every behaviour. `icuDefaultLocale` is the
// WebContent process's uloc_getDefault(), which only the quote overrides read.
export function lineRules(locale: string, mode: LineBreakMode, icuDefaultLocale: string): LineRules {
  const tables = lookupLocale(webkitLineTables, locale)
  let table: (typeof tables)[number]
  switch (mode) {
    case 'Default': table = tables[0]; break
    case 'Loose': table = tables[1]; break
    case 'Normal': table = tables[2]; break
    case 'Strict': table = tables[3]; break
  }
  const rules = webkitBreakRules[table]
  return { rules, overrides: quoteOverrides(rules, locale, icuDefaultLocale) }
}

// Rows of delimiters.tsv that record the dump's own default locale rather than data: `und` and `xx` have no ICU locale
// data, so ulocdata_open answered them through uloc_getDefault() = en_US_POSIX (the file's header; specs/webkit-gaps.md
// §8.3, groundwork probes: under ja_JP `und` behaves like ja).
const DEFAULT_LOCALE_ROWS = ['und', 'xx']

// Whether ulocdata_open(locale) finds locale data itself, as far as the dumped table shows: a row for the locale or a
// parent other than root. Otherwise it falls back through the process default locale (specs/webkit-canvas.md §2.6).
export function hasDelimiterData(locale: string): boolean {
  if (locale === '') return true
  let key = localeKey(locale)
  for (;;) {
    if (webkitDelimiters[key] !== undefined && !DEFAULT_LOCALE_ROWS.includes(key)) return true
    const cut = key.lastIndexOf('-')
    if (cut < 0) return false
    key = key.slice(0, cut)
  }
}

// Every code point any CLDR delimiter row names as a quotation mark with Line_Break QU: the characters an override can
// touch under some default locale.
const DELIMITER_QUOTES: readonly number[] = delimiterQuotes()

function delimiterQuotes(): number[] {
  const quotes: number[] = []
  const rows = Object.values(webkitDelimiters)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    for (let k = 0; k < 8; k += 2) if (row[k + 1] === 1 && !quotes.includes(row[k]!)) quotes.push(row[k]!)
  }
  return quotes
}

export function isDelimiterQuote(cp: number): boolean {
  return DELIMITER_QUOTES.includes(cp)
}

// Apple ICU setCategoryOverrides (AppleICU76 rbbi.cpp:397-486; specs/webkit-canvas.md §2.6): a one-unit delimiter with
// Line_Break QU reads as U+007B (opening) or U+007D (closing) in this table; a closing U+201C becomes U+201D, a closing
// U+2018 is dropped, and da gets none. The @lb keyword doesn't change the lookup. The empty locale opens root
// (specs/webkit-gaps.md §8.3); a locale without data takes the default locale's delimiters.
function quoteOverrides(rules: BreakRules, locale: string, icuDefaultLocale: string): CategoryOverrides {
  if (locale.split(/[-_@]/)[0]!.toLowerCase() === 'da') return NO_OVERRIDES
  const row = hasDelimiterData(locale) ? lookupLocale(webkitDelimiters, locale === '' ? 'root' : locale) : lookupLocale(webkitDelimiters, icuDefaultLocale)
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
// Preferred languages that aren't given are laid out as a list without a zh- entry (gap ui-language).
export function computedLocale(lang: string, preferredLanguages: readonly string[] | null): string {
  if (lang === '' || !isHanLocale(lang)) return lang
  const languages = preferredLanguages ?? []
  for (let i = 0; i < languages.length; i++) {
    if (languages[i]!.startsWith('zh-')) return languages[i]!
  }
  return 'zh-hans'
}
