// Generates src/engines/blink/generated/break-tables.ts from rebuild/data/blink (Chrome 153.0.8010.48 icudtl.dat, ICU
// 78.2): the line tables Blink's LazyLineBreakIterator opens, char.brk for grapheme boundaries, and Blink's generated
// kFastLineBreakTable. Every input is checked against data/blink/manifest.json.
// usage: bun rebuild/tools/gen-blink-data.ts
//
// The Blink port extends this file (and only this generator) when it needs more Blink data, for example Line_Break and
// General_Category values from ICU 78.2 for break-all and keep-all (specs/blink-text.md §2.F.5).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BROWSER_ENGINES, DATA, REBUILD, base64, parsePairBitmap, readVerified, writeModule } from './gen-shared.ts'
import { PPUCD_PATH, PPUCD_SHA256, forEachPpucdBlock, forEachPpucdRange, type PpucdRange } from './ppucd.ts'

type ManifestEntry = { name: string; bytes: number; sha256: string }
const manifest = JSON.parse(readFileSync(resolve(DATA, 'blink/manifest.json'), 'utf8')) as { entries: ManifestEntry[] }

function entry(name: string): ManifestEntry {
  for (let i = 0; i < manifest.entries.length; i++) if (manifest.entries[i]!.name === name) return manifest.entries[i]!
  throw new Error(`data/blink/manifest.json has no ${name}`)
}

// Table names as ICU's brkitr resource bundles name them (specs/blink-canvas.md §2.2-2.3). The phrase tables need the
// jaml model and word-break: auto-phrase, which the input model doesn't have (DESIGN.md §1).
const tables = ['line', 'line_normal', 'line_normal_cj', 'line_loose', 'line_loose_cj', 'char'] as const

const lines: string[] = []
for (let i = 0; i < tables.length; i++) {
  const name = tables[i]!
  const e = entry(`${name}.brk`)
  const bytes = readVerified(resolve(DATA, 'blink', e.name), e.sha256)
  lines.push(`  // ${e.name}: ${e.bytes} bytes, sha256 ${e.sha256}`)
  lines.push(`  ${name}: '${base64(bytes)}',`)
}

const header = entry('break_iterator_data_inline_header.h')
const headerText = new TextDecoder().decode(readVerified(resolve(DATA, 'blink', header.name), header.sha256))
const pairs = parsePairBitmap(headerText, 'kFastLineBreakTable[')

// Line_Break and General_Category per code point from ICU 78.2's ppucd.txt, what u_getIntPropertyValue(UCHAR_LINE_BREAK)
// and u_charType return in Chrome 153 (text_break_iterator.cc:112-165: break-all classes, keep-all categories).
// ULineBreak numbering, unicode/uchar.h:2487-2565.
const LINE_BREAK = ['XX', 'AI', 'AL', 'B2', 'BA', 'BB', 'BK', 'CB', 'CL', 'CM', 'CR', 'EX', 'GL', 'HY', 'ID', 'IN', 'IS', 'LF',
  'NS', 'NU', 'OP', 'PO', 'PR', 'QU', 'SA', 'SG', 'SP', 'SY', 'ZW', 'NL', 'WJ', 'H2', 'H3', 'JL', 'JT', 'JV', 'CP', 'CJ', 'HL', 'RI',
  'EB', 'EM', 'ZWJ', 'AK', 'AP', 'AS', 'VF', 'VI', 'HH']
const ppucdPath = resolve(BROWSER_ENGINES, PPUCD_PATH)
readVerified(ppucdPath, PPUCD_SHA256)
// Every code point: block values first, then the cp and unassigned lines over them. ppucd writes no cp line for code points
// whose values equal their block's (CJK Extension A except U+3405, Extension B, Hangul syllables, private use), so reading
// cp lines alone left 210,383 code points at 0 (Line_Break XX, no General_Category, script Common).
async function forEachPpucdCodePointRange(visit: (range: PpucdRange) => void): Promise<void> {
  await forEachPpucdBlock(ppucdPath, visit)
  await forEachPpucdRange(ppucdPath, visit)
}
// Joining_Type as HarfBuzz's Arabic shaper reads it for joining forms across shaping calls (specs/blink-text.md §2.E).
const JOINING_TYPE = ['U', 'D', 'R', 'L', 'C', 'T']
const props = new Uint16Array(0x110000)
await forEachPpucdCodePointRange(range => {
  const lb = LINE_BREAK.indexOf(range.props.get('lb') ?? '')
  const gc = range.props.get('gc') ?? ''
  const jt = JOINING_TYPE.indexOf(range.props.get('jt') ?? '')
  if (lb < 0 || gc === '' || jt < 0) throw new Error(`no lb, gc or jt for ${range.first.toString(16)}`)
  // bit 6: General_Category L or N (U_GC_L_MASK | U_GC_N_MASK); bit 7: M (U_GC_M_MASK); bits 8-10: Joining_Type.
  const bits = gc[0] === 'L' || gc[0] === 'N' ? 0x40 : gc[0] === 'M' ? 0x80 : 0
  props.fill(lb | bits | (jt << 8), range.first, range.last + 1)
})
// HanKerningCharType per code point (character_property_data_generator.cc:143-167; han_kerning_char_type.h:17-37):
// explicit quotes, dots, colon, semicolon and middles, then [[:blk=CJK_Symbols:][:ea=F:] & [:gc=Ps:]] open,
// ... & [:gc=Pe:] close, [[:gc=Ps:] - [:blk=CJK_Symbols:] - [:ea=F:]] narrow open, and the Pe counterpart narrow close.
const HAN_OTHER = 0, HAN_OPEN = 1, HAN_CLOSE = 2, HAN_MIDDLE = 3, HAN_OPEN_NARROW = 4, HAN_CLOSE_NARROW = 5, HAN_DOT = 6,
  HAN_COLON = 7, HAN_SEMICOLON = 8, HAN_OPEN_QUOTE = 9, HAN_CLOSE_QUOTE = 10
const hanKerning = new Map<number, number>([
  [0x2018, HAN_OPEN_QUOTE], [0x201c, HAN_OPEN_QUOTE], [0x2019, HAN_CLOSE_QUOTE], [0x201d, HAN_CLOSE_QUOTE],
  [0x3000, HAN_MIDDLE], [0x3001, HAN_DOT], [0x3002, HAN_DOT], [0xff0c, HAN_DOT], [0xff0e, HAN_DOT], [0xff1a, HAN_COLON],
  [0xff1b, HAN_SEMICOLON], [0x00b7, HAN_MIDDLE], [0x2027, HAN_MIDDLE], [0x30fb, HAN_MIDDLE],
])
await forEachPpucdCodePointRange(range => {
  const gc = range.props.get('gc')
  if (gc !== 'Ps' && gc !== 'Pe') return
  const wide = range.props.get('blk') === 'CJK_Symbols' || range.props.get('ea') === 'F'
  const type = gc === 'Ps' ? (wide ? HAN_OPEN : HAN_OPEN_NARROW) : (wide ? HAN_CLOSE : HAN_CLOSE_NARROW)
  for (let cp = range.first; cp <= range.last; cp++) hanKerning.set(cp, type)
})
// ScriptRunIterator's data (script_run_iterator.cc:133-236, :80-113): uscript_getScript and uscript_getScriptExtensions as
// UScriptCode numbers from ICU 78.2's uscript.h, extension lists in ICU's order (ascending codes, as icu4c 78.3's
// uscript_getScriptExtensions returns them), Bidi_Paired_Bracket_Type, and East_Asian_Width W, F or H for
// FixScriptsByEastAsianWidth; White_Space for the script comparison of Canvas strings; Extended_Pictographic, which
// HarfBuzz reads to merge a ZWJ and the pictograph after it into the previous glyph cluster (hb-ot-shape.cc:466-522);
// Default_Ignorable_Code_Point, which Character::IsDefaultIgnorable reads above U+00FF (character.h:184-189);
// Emoji_Component and General_Category Lm or Sk, which Canvas's word splitting reads (plain_text_node.cc:115-153,
// character.h:101-104); Emoji, Emoji_Presentation, Emoji_Modifier_Base and General_Category Cn, which RunSegmenter's emoji
// categories read (emoji_segmentation_category_inline_header.h:15-77, character_emoji.cc:320-347).
const USCRIPT_PATH = 'chromium-icu-8cc91d9b/source/common/unicode/uscript.h'
const USCRIPT_SHA256 = '293adf40390583c1c5394d3dc1794ed1669e8356cdf292ca5eaac145a2a5d1e0'
const uscriptSource = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, USCRIPT_PATH), USCRIPT_SHA256))
const scriptCodes = new Map<string, number>()
for (const m of uscriptSource.matchAll(/USCRIPT_\w+\s*=\s*(\d+),\s*\/\*\s*([A-Z][a-z]{3})\s*\*\//g)) {
  if (!scriptCodes.has(m[2]!)) scriptCodes.set(m[2]!, Number(m[1]))
}
function scriptCode(name: string): number {
  const code = scriptCodes.get(name)
  if (code === undefined) throw new Error(`uscript.h has no UScriptCode for ${name}`)
  return code
}
// Index 0 stands for "the code point's own script".
const extensionLists: string[] = ['']
const scriptProps = new Uint32Array(0x110000)
await forEachPpucdCodePointRange(range => {
  const sc = scriptCode(range.props.get('sc') ?? '')
  const scx = range.props.get('scx') ?? '<script>'
  let list = 0
  if (scx !== '<script>') {
    const key = scx.split(' ').map(scriptCode).sort((a, b) => a - b).join(',')
    list = extensionLists.indexOf(key)
    if (list < 0) {
      list = extensionLists.length
      extensionLists.push(key)
    }
  }
  const bpt = range.props.get('bpt') ?? 'n'
  const ea = range.props.get('ea') ?? 'N'
  const gc = range.props.get('gc') ?? ''
  const flags = (bpt === 'o' ? 1 : 0) | (bpt === 'c' ? 2 : 0) | (ea === 'W' || ea === 'F' || ea === 'H' ? 4 : 0) |
    (range.props.has('WSpace') ? 8 : 0) | (range.props.has('ExtPict') ? 16 : 0) | (range.props.has('DI') ? 32 : 0) |
    (range.props.has('EComp') ? 64 : 0) | (gc === 'Lm' || gc === 'Sk' ? 128 : 0) | (range.props.has('Emoji') ? 256 : 0) |
    (range.props.has('EPres') ? 512 : 0) | (range.props.has('EBase') ? 1024 : 0) | (gc === 'Cn' ? 2048 : 0)
  scriptProps.fill(sc | (list << 8) | (flags << 18), range.first, range.last + 1)
})
if (extensionLists.length > 1024) throw new Error('more than 1024 Script_Extensions lists')
const scriptRuns: number[] = []
for (let cp = 0; cp < scriptProps.length; cp++) if (cp === 0 || scriptProps[cp] !== scriptProps[cp - 1]) scriptRuns.push(cp, scriptProps[cp]!)
const scriptPacked = new Uint8Array(new Uint32Array(scriptRuns).buffer)
const cursiveScripts = ['Arab', 'Rohg', 'Mand', 'Mong', 'Nkoo', 'Phag', 'Syrc'].map(scriptCode)

// Character::IsCjkIdeographOrSymbol (character.h:97-100, character_property_data_generator.cc:89-140): the explicit values
// and ranges of character_property_data.h:17-111, every Emoji_Presentation character (ICU 78.2 ppucd.txt EPres), and the
// Extended_Pictographic characters of RGI_Emoji_ZWJ_Sequence and RGI_Emoji_Modifier_Sequence strings (ICU builds those
// properties of strings from Unicode 17's emoji-zwj-sequences.txt and emoji-sequences.txt, which chromium-152's ICU 78.2
// checkout carries; Chrome 153 pins the same ICU release). Justification reads it (justification_opportunity.cc:105-120).
const CPD_PATH = 'chromium-153.0.8010.48/third_party/blink/renderer/platform/text/character_property_data.h'
const CPD_SHA256 = '3d7724d334e0ab019d536b7cec054df31635c96e4d6c7d854ddaee98883dc8b2'
const ZWJ_SEQUENCES_PATH = 'chromium-152/src/third_party/icu/source/data/unidata/emoji-zwj-sequences.txt'
const ZWJ_SEQUENCES_SHA256 = '5b25441daed2322b068c5e70cda522946a4f0274df864445a1965a92e5fc5cad'
const SEQUENCES_PATH = 'chromium-152/src/third_party/icu/source/data/unidata/emoji-sequences.txt'
const SEQUENCES_SHA256 = '12cc8267dc33cbd11ed32bcf6fc5dc2ad9c7a77bae1bdfba2f41b1b9b3ead8dd'
const cpdSource = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, CPD_PATH), CPD_SHA256))
function cpdList(name: string): number[] {
  const start = cpdSource.indexOf(`static constexpr auto ${name} = std::to_array<UChar32>({`)
  if (start < 0) throw new Error(`character_property_data.h has no ${name}`)
  const body = cpdSource.slice(start, cpdSource.indexOf('});', start)).replace(/\/\/[^\n]*/g, '')
  return [...body.slice(body.indexOf('({') + 2).matchAll(/0x([0-9A-Fa-f]+)/g)].map(m => parseInt(m[1]!, 16))
}
const cjkSymbol = new Uint8Array(0x110000)
for (const cp of cpdList('kIsCjkIdeographOrSymbolArray')) cjkSymbol[cp] = 1
const cjkRanges = cpdList('kIsCjkIdeographOrSymbolRanges')
if (cjkRanges.length % 2 !== 0) throw new Error('kIsCjkIdeographOrSymbolRanges has an odd count')
for (let i = 0; i < cjkRanges.length; i += 2) cjkSymbol.fill(1, cjkRanges[i]!, cjkRanges[i + 1]! + 1)
await forEachPpucdCodePointRange(range => {
  if (range.props.has('EPres')) cjkSymbol.fill(1, range.first, range.last + 1)
})
function markSequencePictographs(path: string, sha: string, property: string): void {
  const text = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, path), sha))
  for (const line of text.split('\n')) {
    const data = line.split('#')[0]!
    const fields = data.split(';').map(f => f.trim())
    if (fields.length < 2 || fields[1] !== property) continue
    for (const hex of fields[0]!.split(/\s+/)) {
      const cp = parseInt(hex, 16)
      if ((scriptProps[cp]! & (16 << 18)) !== 0) cjkSymbol[cp] = 1
    }
  }
}
markSequencePictographs(ZWJ_SEQUENCES_PATH, ZWJ_SEQUENCES_SHA256, 'RGI_Emoji_ZWJ_Sequence')
markSequencePictographs(SEQUENCES_PATH, SEQUENCES_SHA256, 'RGI_Emoji_Modifier_Sequence')
const cjkSymbolRanges: number[] = []
for (let cp = 0; cp < cjkSymbol.length; cp++) {
  if (cjkSymbol[cp] === 1 && (cp === 0 || cjkSymbol[cp - 1] !== 1)) cjkSymbolRanges.push(cp)
  if (cjkSymbol[cp] === 1 && (cp + 1 === cjkSymbol.length || cjkSymbol[cp + 1] !== 1)) cjkSymbolRanges.push(cp)
}

// HarfBuzz's OpenType language system tags per ISO 639 code (hb_ot_tags_from_language, hb-ot-tag.cc:322-420, over
// ot_languages2 and ot_languages3 of hb-ot-tag-table.hh at Chrome 153's HarfBuzz dfdc088c): which language system of a
// font a locale's first subtag selects. Longer locales go through hb_ot_tags_from_complex_language first, which isn't
// generated; the port treats them as unknown where a font has language systems of its own.
const OT_TAG_PATH = 'harfbuzz-dfdc088c/src/hb-ot-tag-table.hh'
const OT_TAG_SHA256 = '2aa80e3fe65f262c602e58ef1ece8152cd221cfa1549da5bf0e78d084161a375'
const otTagSource = new TextDecoder().decode(readVerified(resolve(BROWSER_ENGINES, OT_TAG_PATH), OT_TAG_SHA256))
const otLanguageTags = new Map<string, string[]>()
for (const table of ['ot_languages2', 'ot_languages3']) {
  const start = otTagSource.indexOf(`static const LangTag ${table}[] = {`)
  if (start < 0) throw new Error(`hb-ot-tag-table.hh has no ${table}`)
  const body = otTagSource.slice(start, otTagSource.indexOf('};', start))
  for (const m of body.matchAll(/\{HB_TAG\('(.)','(.)','(.)','(.)'\),\s*(HB_TAG_NONE|HB_TAG\('(.)','(.)','(.)','(.)'\))\s*\}/g)) {
    const language = (m[1]! + m[2]! + m[3]! + m[4]!).trim()
    const list = otLanguageTags.get(language) ?? []
    if (m[5] !== 'HB_TAG_NONE') list.push(m[6]! + m[7]! + m[8]! + m[9]!)
    otLanguageTags.set(language, list)
  }
}
if (otLanguageTags.size < 900) throw new Error(`only ${otLanguageTags.size} languages parsed from hb-ot-tag-table.hh`)
const otLanguageRecords = [...otLanguageTags.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([language, tags]) => JSON.stringify([language, ...tags])).join(',')

const hanKerningFlat: number[] = []
for (const [cp, type] of [...hanKerning.entries()].sort((a, b) => a[0] - b[0])) if (type !== HAN_OTHER) hanKerningFlat.push(cp, type)

const runs: number[] = []
for (let cp = 0; cp < props.length; cp++) {
  if (cp === 0 || props[cp] !== props[cp - 1]) runs.push(cp * 2048 + props[cp]!)
}
const packed = new Uint8Array(new Uint32Array(runs).buffer)

writeModule(resolve(REBUILD, 'src/engines/blink/generated/break-tables.ts'), `// Generated by rebuild/tools/gen-blink-data.ts from rebuild/data/blink. Do not edit.
// Chrome 153.0.8010.48 icudtl.dat (sha256 a3c6d782…), ICU 78.2, Unicode 17. Entries keep their ICU DataHeader.

export type BlinkBreakTable = ${tables.map(t => `'${t}'`).join(' | ')}

export const blinkBreakTableBase64: Record<BlinkBreakTable, string> = {
${lines.join('\n')}
}

// kFastLineBreakTable for U+0021..U+00FF pairs (223 rows x 28 bytes, bit (b - 0x21) % 8 of byte (b - 0x21) / 8 in row
// a - 0x21), generated by character_property_data_generator.cc over the same icudtl.dat. sha256 of the header:
// ${header.sha256}
export const blinkLinePairsBase64 = '${base64(pairs)}'

// Runs over U+0000..U+10FFFF as little-endian uint32 (first code point << 11 | value), value = ULineBreak | 0x40 for
// General_Category L or N | 0x80 for M | Joining_Type (U D R L C T = 0..5) << 8, from ICU 78.2 ppucd.txt
// (sha256 ${PPUCD_SHA256}).
export const blinkCharPropsBase64 = '${base64(packed)}'

// HanKerningCharType as [code point, type] pairs for every code point not kOther: 1 open, 2 close, 3 middle, 4 open
// narrow, 5 close narrow, 6 dot, 7 colon, 8 semicolon, 9 open quote, 10 close quote.
export const blinkHanKerningTypes: readonly number[] = [${hanKerningFlat.join(',')}]

// Runs over U+0000..U+10FFFF as little-endian uint32 pairs (first code point, value), value = UScriptCode (bits 0-7) |
// Script_Extensions list index << 8 (0: the script alone) | Bidi_Paired_Bracket_Type open 0x40000, close 0x80000 |
// East_Asian_Width W, F or H 0x100000 | White_Space 0x200000 | Extended_Pictographic 0x400000 |
// Default_Ignorable_Code_Point 0x800000 | Emoji_Component 0x1000000 | General_Category Lm or Sk 0x2000000 | Emoji 0x4000000 |
// Emoji_Presentation 0x8000000 | Emoji_Modifier_Base 0x10000000 | General_Category Cn 0x20000000, from ICU 78.2 ppucd.txt
// and uscript.h (sha256 ${USCRIPT_SHA256}).
export const blinkScriptPropsBase64 = '${base64(scriptPacked)}'

// Script_Extensions lists by index, UScriptCode numbers in ICU's order.
export const blinkScriptExtensions: readonly (readonly number[])[] = [${extensionLists.map(key => `[${key}]`).join(',')}]

// IsCursiveScript (shape_result.cc:977-990): Arab, Rohg, Mand, Mong, Nkoo, Phag, Syrc as UScriptCode numbers.
export const blinkCursiveScripts: readonly number[] = [${cursiveScripts.join(',')}]

// HarfBuzz's OpenType language system tags per ISO 639 code, as [code, tag, ...] records sorted by code (tags keep their
// trailing spaces), from ot_languages2 and ot_languages3 of hb-ot-tag-table.hh at harfbuzz dfdc088c (sha256 ${OT_TAG_SHA256}).
export const blinkOtLanguageTags: readonly (readonly string[])[] = [${otLanguageRecords}]

// Character::IsCjkIdeographOrSymbol as sorted inclusive [first, last] pairs: character_property_data.h (sha256 ${CPD_SHA256}),
// Emoji_Presentation, and the Extended_Pictographic characters of RGI emoji ZWJ and modifier sequences (emoji-zwj-sequences.txt
// sha256 ${ZWJ_SEQUENCES_SHA256}, emoji-sequences.txt sha256 ${SEQUENCES_SHA256}).
export const blinkCjkIdeographOrSymbolRanges: readonly number[] = [${cjkSymbolRanges.join(',')}]
`)
