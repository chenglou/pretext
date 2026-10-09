// The library's port of ICU's rule-based break iterator and its packed tables (src/line-breaks.ts, src/graphemes.ts)
// against the system's ICU, libicucore, through bun:ffi, on seeded random strings: an oracle that shares nothing with
// the port, in seconds and without a browser. Skipped where the library or a symbol is missing, as off macOS, and a
// browser's rules where the system's ICU can't judge them.
// - Chrome's line and character rules, the compiled files in scripts/engine-data that the shipped tables were packed
//   from, run by the system's ICU engine (ubrk_openBinaryRules): the packing, the port's state machine and its class
//   lookup against ICU's, on rules it didn't write.
// - Safari's line rules for each locale (ubrk_open with UBRK_LINE, as WebKit opens them) and its character rules: the
//   shipped Apple tables, their choice by language and the quotation remaps against the ICU Safari runs. Only while the
//   system's ICU holds the break data the tables were generated from, which `bun harness repin safari` reports: an OS
//   update is no regression.
// No Thai, Lao, Khmer or Myanmar letter is drawn: inside their runs Intl.Segmenter stands in for ICU's dictionaries
// (src/line-breaks.ts), and the two engines' dictionaries differ on random letters.
import './watchdog.ts'
import { dlopen, FFIType, type Pointer } from 'bun:ffi'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import SOURCES from '../scripts/engine-data/sources.json'
import type { LineTable } from '../src/generated/engine-break-data.ts'
import { findGraphemeEnds } from '../src/graphemes.ts'
import { getBreakRules, getWebKitLineRules, markRuleBoundaries, type BreakRules } from '../src/line-breaks.ts'
import { breakDataReport } from './break-data.ts'
import { createRng } from './sets/build.ts'

function openIcu() {
  try {
    return dlopen('/usr/lib/libicucore.A.dylib', {
      ubrk_open: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
      ubrk_openBinaryRules: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
      ubrk_setText: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.void },
      ubrk_first: { args: [FFIType.ptr], returns: FFIType.i32 },
      ubrk_next: { args: [FFIType.ptr], returns: FFIType.i32 },
      ubrk_close: { args: [FFIType.ptr], returns: FFIType.void },
    }).symbols
  } catch {
    return null
  }
}
const icu = openIcu()
const status = new Int32Array(1)
const NO_TEXT = new Uint16Array(1)
const UBRK_CHARACTER = 0
const UBRK_LINE = 2

// The system's iterator for a locale's rules, or for compiled rules; null where ICU refuses them (a status above 0).
// Each call takes its arrays themselves, which bun holds for the call. ICU goes on reading compiled rules and the text
// an iterator was set, so both stay referenced here, where the collector can't take them between the calls.
function open(type: number, locale: string): Pointer | null {
  status[0] = 0
  const iterator = icu!.ubrk_open(type, Buffer.from(`${locale}\0`), NO_TEXT, 0, status)
  return status[0] > 0 ? null : iterator
}
const opened: Uint8Array[] = []
function openRules(file: string): Pointer | null {
  // ICU takes the rules after the file's data header, whose first two bytes are its length.
  const bytes = new Uint8Array(readFileSync(join(import.meta.dir, '../scripts/engine-data', SOURCES.chrome.dir, file)))
  const rules = bytes.slice(bytes[0]! | bytes[1]! << 8)
  opened.push(rules)
  status[0] = 0
  const iterator = icu!.ubrk_openBinaryRules(rules, rules.length, NO_TEXT, 0, status)
  return status[0] > 0 ? null : iterator
}

// Every boundary after the start, as ubrk_next gives them.
let units = NO_TEXT
function boundaries(iterator: Pointer, text: string): string {
  units = new Uint16Array(text.length + 1)
  for (let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i)
  status[0] = 0
  icu!.ubrk_setText(iterator, units, text.length, status)
  icu!.ubrk_first(iterator)
  let out = ''
  for (let at = icu!.ubrk_next(iterator); at >= 0; at = icu!.ubrk_next(iterator)) out += `${at} `
  return out
}

// Code points of every kind the rules tell apart, unpaired surrogates and unassigned ones included.
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i)
const POOLS: number[][] = [
  range(0x20, 0x7f),
  range(0xa0, 0x100),
  [0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f, 0x2039, 0x203a, 0xab, 0xbb, 0x300c, 0x300d, 0x300e, 0x300f, 0x301d, 0x301e, 0x301f, 0xff02, 0xff07, 0x275b, 0x275c, 0x275d, 0x275e, 0x2e42],
  [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2024, 0x2025, 0x2026, 0x2027, 0x2030, 0x2032, 0x203c, 0x2044, 0x20ac, 0x2103, 0x2116, 0xb0, 0xa3, 0x24, 0x25, 0x2d, 0x2f, 0x2c, 0x2e, 0x3a, 0x3b, 0x21, 0x3f],
  [0x20, 0x20, 0x20, 0xa0, 0x2002, 0x2003, 0x2007, 0x2009, 0x200a, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x202f, 0x205f, 0x3000, 0x1680, 0x180e, 0x9, 0xa, 0xd, 0x85, 0x2028, 0x2029, 0xad, 0x34f],
  [0x4e2d, 0x6587, 0x3042, 0x3041, 0x30a2, 0x30a1, 0x30fc, 0x3005, 0x303b, 0x309d, 0x30fd, 0x3001, 0x3002, 0xff0c, 0xff0e, 0xff01, 0xff1f, 0xff08, 0xff09, 0x3008, 0x3009, 0x301c, 0x30a0, 0x30fb, 0xff65, 0x31f0, 0xff67, 0xff70, 0xac00, 0xac01, 0x1100, 0x1161, 0x11a8, 0x20000, 0x3400, 0xf900, 0x2e80, 0xa015, 0x3248, 0x4dc0],
  [0x300, 0x301, 0x308, 0x20dd, 0xfe0f, 0xfe0e, 0x5d0, 0x5b0, 0x5be, 0x5f3, 0x627, 0x628, 0x64e, 0x600, 0x60c, 0x61f, 0x660, 0x6f0, 0x915, 0x94d, 0x93f, 0x903, 0x964, 0xb95, 0xbcd, 0x1f600, 0x1f468, 0x1f3fb, 0x1f1fa, 0x1f1f8, 0x2764, 0x23, 0x20e3, 0xe0020, 0xe007f, 0x1b05, 0x1b44, 0xa9, 0x2122],
  [0x30, 0x31, 0x39, 0x2c, 0x2e, 0x2d, 0x2b, 0x24, 0x25, 0x28, 0x29, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x5c, 0x3a, 0x40, 0x23, 0x26, 0x2a, 0x3d, 0x5f, 0x7e, 0x7c, 0x27, 0x22],
  [0xd800, 0xdc00, 0xfffd, 0xfffc, 0xffff, 0x10ffff, 0xe000, 0x378, 0x2fff, 0x1f000, 0x0, 0x1, 0x1b, 0x7f, 0x9f, 0xf870, 0xf884],
]

// `count` strings of 1 to 12 code points, a quarter of them up to 40, each from one to three of the pools.
function randomTexts(seed: string, count: number): string[] {
  const rng = createRng(seed)
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    const length = 1 + rng.int(rng.int(4) === 0 ? 40 : 12)
    const chosen: number[][] = []
    for (let k = rng.int(3); k >= 0; k--) chosen.push(POOLS[rng.int(POOLS.length)]!)
    let text = ''
    for (let i = 0; i < length; i++) {
      const pool = chosen[rng.int(chosen.length)]!
      text += String.fromCodePoint(pool[rng.int(pool.length)]!)
    }
    out.push(text)
  }
  return out
}

const shown = (text: string): string => Array.from(text, ch => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

// The first few texts whose boundaries the library and the system's ICU give differently.
function differences(texts: readonly string[], iterator: Pointer, mine: (text: string) => string): string[] {
  const out: string[] = []
  for (let i = 0; i < texts.length && out.length < 5; i++) {
    const theirs = boundaries(iterator, texts[i]!)
    if (mine(texts[i]!) !== theirs) out.push(`${shown(texts[i]!)}: the library ${mine(texts[i]!)}| ICU ${theirs}`)
  }
  icu!.ubrk_close(iterator)
  return out
}

function lineBoundaries(text: string, rules: BreakRules, overrides?: Parameters<typeof markRuleBoundaries>[3]): string {
  const flags = new Uint8Array(text.length + 1)
  markRuleBoundaries(rules, text, flags, overrides)
  let out = ''
  for (let at = 1; at <= text.length; at++) if (flags[at] === 1) out += `${at} `
  return out
}

function graphemeBoundaries(table: 'chromium/char' | 'apple/char', text: string): string {
  const ends = new Int32Array(text.length)
  const count = findGraphemeEnds(table, text, 0, text.length, ends)
  let out = ''
  for (let i = 0; i < count; i++) out += `${ends[i]} `
  return out
}

describe.skipIf(icu === null)('the ICU port against the system\'s ICU', () => {
  // An ICU that no longer reads one of Chrome's compiled rule files can't judge it: that file's test is skipped.
  const LINE_TABLES = ['chromium/line_normal', 'chromium/line_normal_cj'] satisfies LineTable[]
  const characterIterator = icu === null ? null : openRules('char.brk')

  for (const table of LINE_TABLES) {
    const file = `${table.slice('chromium/'.length)}.brk`
    const iterator = icu === null ? null : openRules(file)
    test.skipIf(iterator === null)(`Chrome's line rules in ${file} give ICU's boundaries through the port's state machine and tries: a wrong transition would move breaks in Chrome and Edge that no recorded case holds`, () => {
      const rules = getBreakRules(table)
      expect(differences(randomTexts(table, 30_000), iterator!, text => lineBoundaries(text, rules))).toEqual([])
    })
  }

  test.skipIf(characterIterator === null)('the grapheme scan gives ICU\'s clusters on Chrome\'s character rules: a line broken between graphemes would split one', () => {
    expect(differences(randomTexts('chromium/char', 30_000), characterIterator!, text => graphemeBoundaries('chromium/char', text))).toEqual([])
  })

  // The system's own rules judge the Apple tables only while they are the bytes the tables came from.
  const current = icu !== null && breakDataReport('safari', '').startsWith('safari\'s break data: the bytes')
  test.skipIf(!current)('Safari\'s line tables, their choice by language and the quotation remaps give ICU\'s boundaries in each locale: a quote would open or close a line otherwise than in Safari under some page language', () => {
    // ICU's alias locales and three-letter tags (zh-TW, zh-HK, iw, sh, mo, jpn, kor) are left out: the library's
    // lookup gets them wrong (ENGINE_FOLLOWUPS.md, Language and generic families).
    const locales = ['', 'en', 'en-GB', 'fr', 'fr-CA', 'de', 'de-CH', 'ru', 'da', 'sv', 'pl', 'fi', 'es', 'he', 'ar', 'th', 'cs', 'nl', 'hu', 'el', 'bg', 'bs', 'ja', 'ja-JP', 'ko', 'ko-KR', 'zh', 'zh-Hant', 'zh-Hant-TW', 'und', 'xx']
    const texts = randomTexts('apple/line', 4000)
    for (let i = 0; i < locales.length; i++) {
      const iterator = open(UBRK_LINE, locales[i]!.replaceAll('-', '_'))
      expect(iterator).not.toBeNull()
      const line = getWebKitLineRules(locales[i] === '' ? null : locales[i]!)
      expect(differences(texts, iterator!, text => lineBoundaries(text, line.rules, line.overrides)).map(line => `${locales[i]}: ${line}`)).toEqual([])
    }
  })

  test.skipIf(!current)('the grapheme scan gives ICU\'s clusters on Safari\'s character rules: a line broken between graphemes would split one', () => {
    const iterator = open(UBRK_CHARACTER, '')
    expect(iterator).not.toBeNull()
    expect(differences(randomTexts('apple/char', 30_000), iterator!, text => graphemeBoundaries('apple/char', text))).toEqual([])
  })
})
