// Generates src/engines/webkit/generated/break-tables.ts from rebuild/data/webkit (macOS 27.0 26A428 libicucore 78.1
// tables dumped with ubrk_getBinaryRules, and WebKit 7625.1.29.11.27's BreakablePositions pair table). Every input is
// checked against data/webkit/FILES.tsv, or against the sha256 recorded here for files read from the pinned checkout.
// usage: bun rebuild/tools/gen-webkit-data.ts
//
// The WebKit port reads, besides the tables:
// - the Ps|Pe|Pi|Pf|Po code units behind keep-all's punctuation breaks and canBreakBefore (specs/webkit-text.md §5.4,
//   specs/webkit-lines.md §7.1);
// - the CLDR delimiters behind Apple ICU's quote overrides (specs/webkit-canvas.md §2.6);
// - which line table ubrk_open loads per requested locale and behaviour (specs/webkit-canvas.md §2.5);
// - localeToScriptCode's tables, for the Han locale swap (specs/webkit-text.md §4.1).
// - the Line_Break=SA combining marks the dictionary engines never stop before (ICU dictbe.cpp fMarkSet), from ICU 78.2's
//   ppucd.txt: [[:LineBreak=SA:]&[:M:]] (specs/webkit-gaps.md §4), and the Line_Break=SA code points of the four scripts
//   with dictionary engines, by Script (brkeng.cpp:163-199 loads the engine by uscript_getScript).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BROWSER_ENGINES, DATA, REBUILD, base64, parsePairBitmap, readVerified, writeModule } from './gen-shared.ts'
import { PPUCD_PATH, PPUCD_SHA256, forEachPpucdBlock, forEachPpucdRange } from './ppucd.ts'

const shaByPath = new Map<string, string>()
const files = readFileSync(resolve(DATA, 'webkit/FILES.tsv'), 'utf8').trim().split('\n')
for (let i = 0; i < files.length; i++) {
  const [path, , sha] = files[i]!.split('\t')
  shaByPath.set(path!.replace(/^\.\//, ''), sha!)
}

function verified(path: string): Uint8Array {
  const sha = shaByPath.get(path)
  if (sha === undefined) throw new Error(`data/webkit/FILES.tsv has no ${path}`)
  return readVerified(resolve(DATA, 'webkit', path), sha)
}

function verifiedText(path: string): string {
  return new TextDecoder().decode(verified(path))
}

// The 9 distinct binaries ubrk_open loads on macOS 27, identified from their rule source (specs/webkit-canvas.md §2.5).
const tables: Array<[string, string]> = [
  ['line', 'ac36fb0a8ca06abdd6c91750b3df6c2d90ea89fc27dfedc82e0bf9f7f6e4d001'],
  ['line_loose', 'e4895a01adfb94081be08631ae2271959c0d908d4abf8eacf5bf491138d32828'],
  ['line_normal', '65a4db3a86fbb9d364d5b725213c3402a23e774d0a8e312fd1de0c757266f74b'],
  ['line_cj', '7ef71178db96ab1f697fdfb726bc6e4f00b1bb849f4bc5cc5563c2c01dd01ddd'],
  ['line_normal_cj', '9734e512ac7503d767e72f6aaf4e89db93fa3945873c35f06054013a4f1dabcc'],
  ['line_loose_cj', '93b2373cd26cf6d8b09deffca42a92fe8b1dffedc7dfc5cd104387f94ab2e7be'],
  ['char', 'fe6dbecf6da020b1a6b12fb9e764676769256cc94342ac0ee14605849a75af83'],
]
const tableBySha = new Map<string, string>()

const lines: string[] = []
for (let i = 0; i < tables.length; i++) {
  const [name, sha] = tables[i]!
  tableBySha.set(sha, name)
  const bytes = verified(`icu-macos27-libicucore/brk/${sha}.brk`)
  lines.push(`  // brk/${sha}.brk: ${bytes.length} bytes`)
  lines.push(`  ${name}: '${base64(bytes)}',`)
}

const inc = verifiedText('breakable-positions/linebreak_table.inc')
const pairs = parsePairBitmap(inc, 'webkitBreakTable')

// Locale keys as ICU matches them: case-insensitive, '_' and '-' alike.
function localeKey(locale: string): string {
  return locale === '(empty)' ? '' : locale.replaceAll('_', '-').toLowerCase()
}

// keepall-punctuation-bmp.tsv: `first\tlast` hex ranges of U_GET_GC_MASK(c) & (Ps|Pe|Pi|Pf|Po), 600 code units.
const punctuation: number[] = []
{
  const rows = verifiedText('breakable-positions/keepall-punctuation-bmp.tsv').split('\n')
  let count = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.length === 0 || row.startsWith('#')) continue
    const [first, last] = row.split('\t')
    const a = parseInt(first!, 16)
    const b = parseInt(last!, 16)
    punctuation.push(a, b)
    count += b - a + 1
  }
  if (count !== 600) throw new Error(`expected 600 punctuation code units, got ${count}`)
}

// [[:LineBreak=SA:]&[:M:]] from ICU 78.2's ppucd.txt, which libicucore 78.1 shares for these properties
// (data/webkit/icu-macos27-libicucore/unicode-properties-vs-upstream78.3.diff differs only in private use).
const dictionaryMarks: number[] = []
// Line_Break=SA code points whose Script has a dictionary engine: [first, last, engine] with engine 0 Thai, 1 Laoo, 2 Mymr,
// 3 Khmr (ICULanguageBreakFactory::loadEngineFor, brkeng.cpp:163-199; the engines' sets [[:Thai:]&[:LineBreak=SA:]] and so
// on, dictbe.cpp:208, 451, 651, 841). Block values come first, because ppucd writes no cp line for code points whose values
// equal their block's (tools/ppucd.ts forEachPpucdBlock).
const dictionaryScripts: number[] = []
{
  const ppucdPath = resolve(BROWSER_ENGINES, PPUCD_PATH)
  readVerified(ppucdPath, PPUCD_SHA256)
  const ENGINE_SCRIPTS = ['Thai', 'Laoo', 'Mymr', 'Khmr']
  // -1: not SA or another script; 0..3 the engine.
  const engineOf = new Int8Array(0x110000).fill(-1)
  const assign = (first: number, last: number, props: Map<string, string>) => {
    const engine = props.get('lb') === 'SA' ? ENGINE_SCRIPTS.indexOf(props.get('sc') ?? '') : -1
    engineOf.fill(engine, first, last + 1)
  }
  await forEachPpucdBlock(ppucdPath, range => assign(range.first, range.last, range.props))
  await forEachPpucdRange(ppucdPath, range => {
    assign(range.first, range.last, range.props)
    if (range.props.get('lb') !== 'SA' || range.props.get('gc')?.[0] !== 'M') return
    const last = dictionaryMarks.length - 1
    if (last > 0 && dictionaryMarks[last] === range.first - 1) dictionaryMarks[last] = range.last
    else dictionaryMarks.push(range.first, range.last)
  })
  for (let cp = 0; cp < 0x110000; cp++) {
    const engine = engineOf[cp]!
    if (engine < 0) continue
    const last = dictionaryScripts.length - 3
    if (last >= 0 && dictionaryScripts[last + 1] === cp - 1 && dictionaryScripts[last + 2] === engine) dictionaryScripts[last + 1] = cp
    else dictionaryScripts.push(cp, cp, engine)
  }
}

// delimiters.tsv: locale, quotationStart, quotationEnd, alternateQuotationStart, alternateQuotationEnd as
// `U+XXXX/<Line_Break>`. Emitted as [code point, is QU] × 4.
const delimiters: string[] = []
{
  const rows = verifiedText('icu-macos27-libicucore/delimiters.tsv').split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.length === 0 || row.startsWith('#')) continue
    const fields = row.split('\t')
    const values: number[] = []
    for (let k = 1; k <= 4; k++) {
      const m = /^U\+([0-9A-F]{4,5})\/([A-Z0-9]+)$/.exec(fields[k] ?? '')
      if (m === null) throw new Error(`delimiters.tsv: unexpected field ${fields[k]} in ${row}`)
      values.push(parseInt(m[1]!, 16), m[2] === 'QU' ? 1 : 0)
    }
    delimiters.push(`  ${JSON.stringify(localeKey(fields[0]!))}: [${values.join(', ')}],`)
  }
}

// manifest.tsv: the line table libicucore loads per requested locale and behaviour.
const lineTables: string[] = []
{
  const rows = verifiedText('icu-macos27-libicucore/manifest.tsv').split('\n')
  let header: string[] | null = null
  const byLocale = new Map<string, Map<string, string>>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.length === 0 || row.startsWith('#')) continue
    const fields = row.split('\t')
    if (header === null) { header = fields; continue }
    const type = fields[header.indexOf('type')]!
    if (type !== 'line') continue
    const locale = localeKey(fields[header.indexOf('requestedLocale')]!)
    const behavior = fields[header.indexOf('behavior')]!
    const name = tableBySha.get(fields[header.indexOf('sha256')]!)
    if (name === undefined) throw new Error(`manifest.tsv: unknown table for ${row}`)
    let entry = byLocale.get(locale)
    if (entry === undefined) byLocale.set(locale, entry = new Map())
    entry.set(behavior, name)
  }
  for (const [locale, entry] of byLocale) {
    const names = ['default', 'loose', 'normal', 'strict'].map(b => {
      const name = entry.get(b)
      if (name === undefined) throw new Error(`manifest.tsv: ${locale} lacks ${b}`)
      return `'${name}'`
    })
    lineTables.push(`  ${JSON.stringify(locale)}: [${names.join(', ')}],`)
  }
}

// LocaleToScriptMapping.cpp at WebKit-7625.1.29.11.27: scriptNameToCode's table, then localeToScriptCode's table.
const LOCALE_TO_SCRIPT = 'webkit-7625.1.29.11.27/Source/WebCore/platform/text/LocaleToScriptMapping.cpp'
const LOCALE_TO_SCRIPT_SHA256 = '3e3def7070f57976e8973f71b43e148363f8bd7cc705e57ec33a251c7c60c8d7'
const scriptNames: string[] = []
const localeScripts: string[] = []
{
  const source = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, LOCALE_TO_SCRIPT), LOCALE_TO_SCRIPT_SHA256))
  const split = source.indexOf('UScriptCode localeToScriptCode(')
  if (split < 0) throw new Error('LocaleToScriptMapping.cpp: missing localeToScriptCode')
  const entry = /\{ "([a-z_]+)"_s, USCRIPT_([A-Z_]+) \}/g
  const collect = (part: string, out: string[]) => {
    for (let m = entry.exec(part); m !== null; m = entry.exec(part)) out.push(`  ${m[1]}: '${m[2]}',`)
  }
  collect(source.slice(0, split), scriptNames)
  collect(source.slice(split), localeScripts)
  if (scriptNames.length !== 106 || localeScripts.length !== 198) throw new Error(`LocaleToScriptMapping.cpp: expected 106 and 198 entries, got ${scriptNames.length} and ${localeScripts.length}`)
}

writeModule(resolve(REBUILD, 'src/engines/webkit/generated/break-tables.ts'), `// Generated by rebuild/tools/gen-webkit-data.ts from rebuild/data/webkit and WebKit-7625.1.29.11.27. Do not edit.
// macOS 27.0 (26A428) /usr/lib/libicucore.A.dylib, u_getVersion 78.1, Unicode 17, CLDR 48. Tables have no DataHeader.

export type WebKitBreakTable = ${tables.map(t => `'${t[0]}'`).join(' | ')}

export const webkitBreakTableBase64: Record<WebKitBreakTable, string> = {
${lines.join('\n')}
}

// LineBreakTable::breakTable, BreakablePositions.cpp:39-267 at WebKit-7625.1.29.11.27: U+0021..U+00FF pairs
// (223 rows x 28 bytes, bit (after - 0x21) % 8 of byte (after - 0x21) / 8 in row before - 0x21).
export const webkitLinePairsBase64 = '${base64(pairs)}'

// BMP code units c with U_GET_GC_MASK(c) & (Ps|Pe|Pi|Pf|Po) in libicucore 78.1, as [first, last] pairs
// (data/webkit/breakable-positions/keepall-punctuation-bmp.tsv).
export const webkitPunctuationRanges: readonly number[] = [${punctuation.join(', ')}]

// Code points with Line_Break=SA and General_Category M (ICU 78.2 ppucd.txt), as [first, last] pairs: the dictionary
// engines' fMarkSet per script (dictbe.cpp:210, 453, 648, 843).
export const webkitDictionaryMarkRanges: readonly number[] = [${dictionaryMarks.join(', ')}]

// Line_Break=SA code points of the scripts with dictionary engines (ICU 78.2 ppucd.txt), as [first, last, engine] triples:
// 0 Thai, 1 Lao, 2 Myanmar, 3 Khmer (brkeng.cpp:163-199, dictbe.cpp:208, 451, 651, 841).
export const webkitDictionaryScriptRanges: readonly number[] = [${dictionaryScripts.join(', ')}]

// CLDR delimiters per locale key (lowercase, '-'): [quotationStart, is QU, quotationEnd, is QU,
// alternateQuotationStart, is QU, alternateQuotationEnd, is QU] (data/webkit/icu-macos27-libicucore/delimiters.tsv).
export const webkitDelimiters: Readonly<Record<string, readonly number[]>> = {
${delimiters.join('\n')}
}

// The line table ubrk_open loads per requested locale key, for behaviours [default, loose, normal, strict]
// (data/webkit/icu-macos27-libicucore/manifest.tsv).
export const webkitLineTables: Readonly<Record<string, readonly [WebKitBreakTable, WebKitBreakTable, WebKitBreakTable, WebKitBreakTable]>> = {
${lineTables.join('\n')}
}

// scriptNameToCode's table, LocaleToScriptMapping.cpp (UScriptCode names without USCRIPT_).
export const webkitScriptNames: Readonly<Record<string, string>> = {
${scriptNames.join('\n')}
}

// localeToScriptCode's table, LocaleToScriptMapping.cpp:160-360.
export const webkitLocaleScripts: Readonly<Record<string, string>> = {
${localeScripts.join('\n')}
}
`)
