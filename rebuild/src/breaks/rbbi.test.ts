// The rule-based iterator against recorded ICU outputs:
// - macOS 27 libicucore 78.1: data/webkit/icu-macos27-libicucore/probes.tsv, ubrk_open + ubrk_next over 15 sample texts
//   for every locale and behaviour WebKit opens (tools/icu_brk_dump.c). Apple's quote overrides are derived from
//   delimiters.tsv exactly as specs/webkit-canvas.md §2.6 describes.
// - Chrome 153 icudtl.dat (ICU 78.2): the ICU C probe results in specs/blink-text.md Appendix B and specs/blink-canvas.md §2.3.
// Segments ICU would give to a dictionary engine are skipped: this iterator has none (DESIGN.md §6).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DATA, sha256 } from '../../tools/gen-shared.ts'
import { decodeBase64 } from './icu4x.js'
import { NO_OVERRIDES, RuleBreakIterator, getCategory, parseBreakRules, ruleBoundaries, type BreakRules, type CategoryOverrides } from './rbbi.js'
import { blinkBreakTableBase64, type BlinkBreakTable } from '../engines/blink/generated/break-tables.js'
import { webkitBreakTableBase64, type WebKitBreakTable } from '../engines/webkit/generated/break-tables.js'

const APPLE = resolve(DATA, 'webkit/icu-macos27-libicucore')

type AppleConfig = { type: string; requestedLocale: string; behavior: string; sha256: string; file: string }
const appleManifest = JSON.parse(readFileSync(resolve(APPLE, 'manifest.json'), 'utf8')) as { sampleTexts: string[]; configs: AppleConfig[] }

const parsedApple = new Map<string, BreakRules>()
function appleRules(config: AppleConfig): BreakRules {
  let rules = parsedApple.get(config.sha256)
  if (rules === undefined) {
    rules = parseBreakRules(new Uint8Array(readFileSync(resolve(APPLE, config.file))))
    parsedApple.set(config.sha256, rules)
  }
  return rules
}

// delimiters.tsv: locale, quotationStart, quotationEnd, altQuotationStart, altQuotationEnd as `U+XXXX/<Line_Break>`.
type Delimiter = { cp: number; quotation: boolean }
const delimiters = new Map<string, Delimiter[]>()
{
  const rows = readFileSync(resolve(APPLE, 'delimiters.tsv'), 'utf8').split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.length === 0 || row.startsWith('#')) continue
    const fields = row.split('\t')
    const parsed: Delimiter[] = []
    for (let k = 1; k <= 4; k++) {
      const m = /^U\+([0-9A-F]{4})\/([A-Z0-9]+)$/.exec(fields[k] ?? '')
      parsed.push(m === null ? { cp: 0, quotation: false } : { cp: parseInt(m[1]!, 16), quotation: m[2] === 'QU' })
    }
    delimiters.set(fields[0] === '(empty)' ? '' : fields[0]!, parsed)
  }
}

// Apple ICU setCategoryOverrides (rbbi.cpp:397-486): a one-unit delimiter with Line_Break=QU reads as U+007B (opening)
// or U+007D (closing); a closing U+201C becomes U+201D and a closing U+2018 is dropped; da gets none.
function appleOverrides(rules: BreakRules, locale: string): CategoryOverrides | null {
  const row = delimiters.get(locale)
  if (row === undefined) return null
  if (locale.split(/[-_@]/)[0] === 'da') return NO_OVERRIDES
  const chars: number[] = []
  const categories: number[] = []
  for (let pair = 0; pair < 2; pair++) {
    const open = row[pair * 2]!
    let close = row[pair * 2 + 1]!
    if (close.cp === 0x201c) close = { cp: 0x201d, quotation: true }
    if (close.cp === 0x2018) close = { cp: 0, quotation: false }
    if (open.cp === close.cp) continue
    if (open.quotation && open.cp !== 0x2019) { chars.push(open.cp); categories.push(getCategory(rules, 0x7b)) }
    if (close.quotation && close.cp !== 0x2019) { chars.push(close.cp); categories.push(getCategory(rules, 0x7d)) }
  }
  return { chars, categories }
}

function boundaries(rules: BreakRules, overrides: CategoryOverrides, text: string): number[] | null {
  const found = ruleBoundaries(new RuleBreakIterator(rules, overrides), text)
  const out = [0]
  for (let i = 0; i < found.length; i++) {
    if (found[i]!.dictionarySegment) return null
    out.push(found[i]!.offset)
  }
  return out
}

describe('libicucore 78.1 tables', () => {
  test('probes.tsv', () => {
    const configs = new Map<string, AppleConfig>()
    for (let i = 0; i < appleManifest.configs.length; i++) {
      const c = appleManifest.configs[i]!
      configs.set(`${c.type}|${c.requestedLocale}|${c.behavior}`, c)
    }
    const rows = readFileSync(resolve(APPLE, 'probes.tsv'), 'utf8').split('\n')
    let compared = 0
    let dictionarySkipped = 0
    let noDelimiters = 0
    const failures: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      if (row.length === 0 || row.startsWith('#')) continue
      const [key, sample, expected] = row.split('\t') as [string, string, string]
      const config = configs.get(key)
      if (config === undefined) throw new Error(`probes.tsv row for unknown config ${key}`)
      if (config.type !== 'line' && config.type !== 'character') continue
      const rules = appleRules(config)
      const overrides = config.type === 'line' ? appleOverrides(rules, config.requestedLocale) : NO_OVERRIDES
      if (overrides === null) { noDelimiters++; continue }
      const text = appleManifest.sampleTexts[Number(sample)]!
      const actual = boundaries(rules, overrides, text)
      if (actual === null) { dictionarySkipped++; continue }
      compared++
      if (actual.join(' ') !== expected) failures.push(`${key} #${sample} ${JSON.stringify(text)}: got ${actual.join(' ')}, expected ${expected}`)
    }
    console.log(JSON.stringify({ compared, dictionarySkipped, noDelimiters, failures: failures.length }))
    expect(failures.slice(0, 10)).toEqual([])
    expect(compared).toBeGreaterThan(1000)
  })
})

describe('Chrome 153 icudtl.dat tables', () => {
  // [text, table name, boundaries including 0].
  const cases: Array<[string, BlinkBreakTable, number[]]> = []
  const appendixB: Array<[string, number[], number[], number[], number[], number[], number[]]> = [
    // text, en (line_normal), zh (line_normal_cj), ja (line_normal), ja@lb=normal (line_normal_cj), en@lb=strict (line), en@lb=loose (line_loose)
    ['a“b', [0, 3], [0, 3], [0, 3], [0, 3], [0, 3], [0, 3]],
    ['a”b', [0, 3], [0, 2, 3], [0, 3], [0, 2, 3], [0, 3], [0, 3]],
    ['あー', [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 2], [0, 1, 2]],
    ['あぁ', [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 2], [0, 1, 2]],
    ['あ々', [0, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 1, 2]],
    ['あ〜', [0, 2], [0, 1, 2], [0, 2], [0, 1, 2], [0, 2], [0, 2]],
    ['一……', [0, 3], [0, 3], [0, 3], [0, 3], [0, 3], [0, 2, 3]],
  ]
  for (let i = 0; i < appendixB.length; i++) {
    const [text, en, zh, ja, jaNormal, strict, loose] = appendixB[i]!
    cases.push([text, 'line_normal', en], [text, 'line_normal_cj', zh], [text, 'line_normal', ja],
      [text, 'line_normal_cj', jaNormal], [text, 'line', strict], [text, 'line_loose', loose])
  }
  const other: Array<[string, number[]]> = [
    ['a b', [0, 2, 3]], ['a​b', [0, 2, 3]], ['a⁠b', [0, 3]], ['\u{1f469}‍\u{1f4bb}x', [0, 5, 6]],
    ['\u{1f44d}\u{1f3fd}x', [0, 4, 5]], ['a￼b', [0, 1, 2, 3]], ['一一。一', [0, 1, 3, 4]],
    ['a　b', [0, 2, 3]], ['foo‐bar', [0, 4, 7]], ['a-é', [0, 2, 3]], [' -é', [0, 1, 3]],
    ['é-1', [0, 3]], ['\u{20000}\u{20000}', [0, 2, 4]],
  ]
  for (let i = 0; i < other.length; i++) cases.push([other[i]![0], 'line_normal', other[i]![1]])
  // specs/blink-canvas.md §2.3: boundaries after 0.
  cases.push(['中〜文', 'line_normal', [0, 2, 3]], ['中〜文', 'line', [0, 2, 3]],
    ['中〜文', 'line_normal_cj', [0, 1, 2, 3]], ['中〜文', 'line_loose_cj', [0, 1, 2, 3]],
    ['ゝゞ々ぁァ', 'line_normal', [0, 3, 4, 5]], ['ゝゞ々ぁァ', 'line', [0, 5]],
    ['ゝゞ々ぁァ', 'line_loose', [0, 1, 2, 3, 4, 5]], ['ゝゞ々ぁァ', 'line_loose_cj', [0, 1, 2, 3, 4, 5]])

  test('recorded ICU C probe results', () => {
    const failures: string[] = []
    for (let i = 0; i < cases.length; i++) {
      const [text, table, expected] = cases[i]!
      const rules = parseBreakRules(decodeBase64(blinkBreakTableBase64[table]))
      const actual = boundaries(rules, NO_OVERRIDES, text)
      if (actual === null || actual.join(' ') !== expected.join(' ')) failures.push(`${table} ${JSON.stringify(text)}: got ${actual?.join(' ')}, expected ${expected.join(' ')}`)
    }
    expect(failures).toEqual([])
  })
})

describe('generated modules', () => {
  test('Blink tables decode to the manifest bytes', () => {
    const manifest = JSON.parse(readFileSync(resolve(DATA, 'blink/manifest.json'), 'utf8')) as { entries: { name: string; sha256: string }[] }
    const names = Object.keys(blinkBreakTableBase64) as BlinkBreakTable[]
    for (let i = 0; i < names.length; i++) {
      const expected = manifest.entries.find(e => e.name === `${names[i]}.brk`)!.sha256
      expect(sha256(decodeBase64(blinkBreakTableBase64[names[i]!]))).toBe(expected)
    }
  })
  test('WebKit tables decode to the dumped bytes', () => {
    const names = Object.keys(webkitBreakTableBase64) as WebKitBreakTable[]
    for (let i = 0; i < names.length; i++) {
      const bytes = decodeBase64(webkitBreakTableBase64[names[i]!])
      expect(readFileSync(resolve(APPLE, `brk/${sha256(bytes)}.brk`)).length).toBe(bytes.length)
    }
  })
})
