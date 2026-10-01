// Generates src/generated/engine-break-data.ts, the tables behind Chrome's and Safari's
// break scans in src/line-breaks.ts, Firefox's in src/gecko-line-breaks.ts and the grapheme
// clusters in src/graphemes.ts, from the engine files in scripts/engine-data/. It reads each
// engine's own format (ICU's compiled rules and UCPTrie, ICU4X's baked trie, property ranges),
// writes what the engines' tables hold in a shorter form, and checks that src/line-breaks.ts
// unpacks that form to every class of every code point and every state row of its source.
// Refresh those files by hand when a browser's tables change, then run this. `--check` compares
// instead of writing. A test imports the tables as read here (engineClassMaps,
// engineRuleTables) to check the module the library ships against them. This script unpacks with
// src/line-breaks.ts, which imports the module it writes, so a change to the module's exports
// has to leave the old module loadable until this has run.
//
// chrome-153/, from Chrome 153.0.8010.37. Chrome 154.0.8037.57's icudtl.dat holds the same
// brkitr entries byte for byte (only its time zone data changed), and Chromium 154 left
// character_property_data_generator.cc as it was:
// - line_normal.brk: the brkitr/line_normal.brk entry of Chrome's icudtl.dat (ICU 78.2).
// - line_normal_cj.brk: the brkitr/line_normal_cj.brk entry of Chrome 153.0.8010.48's
//   icudtl.dat (sha256 6202891a...), which Chrome opens for zh content.
// - break_iterator_data_inline_header.h: the header Chromium's build generates for
//   kFastLineBreakTable (character_property_data_generator.cc:422-551).
// - char.brk: the brkitr/char.brk entry of Chrome 153.0.8010.53's icudtl.dat, the same bytes
//   as in 153.0.8010.48 and 153.0.8010.50.
// safari-27.0/, from Safari 27.0 on macOS 27:
// - line.brk, line_normal.brk, line_cj.brk: brkitr entries of /usr/share/icu/icudt78l.dat,
//   the data libicucore 78.1 reads, the same bytes as on macOS 26.5.2.
// - char.brk: the same file's brkitr/char.brk, read on macOS 27.
// - BreakablePositions.cpp: WebKit's checked-in pair table (safari-7625.1.29.11-branch,
//   unchanged since Safari 26.5.2's safari-7624.2.5.11-branch).
// - locales.json: for every locale uloc_getAvailable lists, the line table ubrk_open(UBRK_LINE)
//   opens (its ubrk_getBinaryRules bytes matched against the three tables) and the four
//   quotation delimiters ulocdata_getDelimiter reports under uloc_getName's name. Dumped on
//   macOS 26.5.2 by a small C program against libicucore; macOS 27 lists a few locales more
//   or fewer, all with root's table and delimiters, which generate the same module.
// - quotation.json: the code points libicucore's u_getIntPropertyValue gives Line_Break=QU.
// firefox-156/, from Firefox 155.0.1's source tree. Firefox 156.0's and 156.0.1's XUL hold the
// same line data and icu_properties Bidi_Class data byte for byte:
// - segmenter_break_line_v1.rs.data: intl/icu_segmenter_data/data/, Firefox's baked ICU4X
//   line data (icuexport release-78.1, CLDR 48), databake output for RuleBreakData
//   (icu_segmenter 2.1.2 src/provider/mod.rs:151-180).
// - segmenter_break_grapheme_cluster_v1.rs.data: the same directory's grapheme data, which
//   is only checked against Chrome's char.brk (see the character tables below).
// - properties.json: icu_properties 2.1.2's compiled data (Unicode 17), the crate Firefox
//   vendors, as [first, last, value] ranges over every code point: Bidi_Class and
//   East_Asian_Width in ICU4C numbering (CodePointMapData::get32(cp).to_icu4c_value()).
//   Dumped by a small Rust program that depends on that crate alone.
// - bidi_pairs_table.rs: servo/unicode-bidi ca612daf's bracket table,
//   src/char_data/tables.rs:519-535.
// - property_enum_bidi_class_v1.rs.data: third_party/rust/icu_properties_data/data/ in
//   Firefox 156.0's source tree, the baked Bidi_Class trie properties.json's bidiClass holds;
//   this script doesn't read it, and `bun harness repin firefox` looks for its bytes in XUL.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  getBreakLanguage,
  getClass,
  markRuleBoundaries,
  unpackClassRuns,
  unpackStateRows,
  unpackTable,
  unpackVarints,
  type BreakRules,
  type ClassTable,
} from '../src/line-breaks.ts'
import SOURCES from './engine-data/sources.json'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptsDir, 'engine-data')
// Each browser's folder there, which `bun harness repin` also reads (sources.json).
const CHROME = SOURCES.chrome.dir
const SAFARI = SOURCES.safari.dir
const FIREFOX = SOURCES.firefox.dir
const outputPath = join(scriptsDir, '..', 'src', 'generated', 'engine-break-data.ts')
const readData = (path: string) => new Uint8Array(readFileSync(join(dataDir, path)))
const readText = (path: string) => readFileSync(join(dataDir, path), 'utf8')
const gzipSize = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const writeVarint = (out: number[], value: number) => {
  for (; value >= 0x80; value = Math.floor(value / 0x80)) out.push((value & 0x7f) | 0x80)
  out.push(value)
}

// unpackTable's form: LZ77 over the table. A copy takes the longest run of at least four bytes that
// starts at any earlier position, unless the copy one byte later would be longer: then this byte
// goes out as a literal (lazy matching). Checked to unpack exactly.
function packTable(bytes: Uint8Array): string {
  const out: number[] = []
  writeVarint(out, bytes.length)
  // Earlier positions by their next four bytes.
  const chains = new Map<number, number[]>()
  const key = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! * 0x1000000)
  const remember = (i: number) => {
    if (i + 4 > bytes.length) return
    const k = key(i)
    let chain = chains.get(k)
    if (chain === undefined) chains.set(k, chain = [])
    chain.push(i)
  }
  // The longest run at i that repeats an earlier position's, and how far back the nearest such position is.
  const longestCopy = (i: number): [number, number] => {
    let length = 0
    let distance = 0
    const chain = i + 4 <= bytes.length ? chains.get(key(i)) : undefined
    if (chain !== undefined) {
      for (let c = chain.length - 1; c >= 0; c--) {
        const j = chain[c]!
        let n = 0
        while (i + n < bytes.length && bytes[j + n] === bytes[i + n]) n++
        if (n > length) { length = n; distance = i - j }
      }
    }
    return [length, distance]
  }
  let literals: number[] = []
  for (let i = 0; i < bytes.length;) {
    const [length, distance] = longestCopy(i)
    remember(i)
    if (length < 4 || longestCopy(i + 1)[0] > length) {
      literals.push(bytes[i]!)
      i++
      continue
    }
    writeVarint(out, literals.length)
    out.push(...literals)
    literals = []
    writeVarint(out, length - 4)
    writeVarint(out, distance)
    for (let k = 1; k < length; k++) remember(i + k)
    i += length
  }
  writeVarint(out, literals.length)
  out.push(...literals)
  const packed = base64(new Uint8Array(out))
  const unpacked = unpackTable(packed)
  if (unpacked.length !== bytes.length || unpacked.some((byte, i) => byte !== bytes[i])) throw new Error('A table packs lossily')
  return packed
}

// Values as the little-endian base-128 varints unpackVarints reads, in base64.
function packVarints(values: readonly number[]): string {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) writeVarint(out, values[i]!)
  const packed = base64(new Uint8Array(out))
  const unpacked = unpackVarints(packed)
  if (unpacked.length !== values.length || unpacked.some((value, i) => value !== values[i])) throw new Error('Varints pack lossily')
  return packed
}

// 223 rows of 28 bytes, a bit per U+0021..U+00FF pair, as B(a, b, c, d, e, f, g, h) =
// a | b << 1 | ... | h << 7.
function parsePairTable(source: string, marker: string): Uint8Array {
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Missing ${marker}`)
  const groups = source.slice(start).match(/B\(\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*,\s*[01]\s*\)/g) ?? []
  const bytes = new Uint8Array(223 * 28)
  if (groups.length < bytes.length) throw new Error(`Expected ${bytes.length} pair bytes after ${marker}, got ${groups.length}`)
  for (let i = 0; i < bytes.length; i++) {
    const bits = groups[i]!.match(/[01]/g)!
    let byte = 0
    for (let k = 0; k < 8; k++) byte |= Number(bits[k]) << k
    bytes[i] = byte
  }
  return bytes
}

// An entry cut from an ICU data package starts with a DataHeader (unicode/udata.h:116-153),
// which rbbidata.cpp:49-62 checks and skips.
function withoutDataHeader(bytes: Uint8Array): Uint8Array {
  const headerSize = bytes[0]! | (bytes[1]! << 8)
  if (bytes[2] !== 0xda || bytes[3] !== 0x27 || headerSize < 20 || bytes[8] !== 0 || bytes[9] !== 0 ||
    bytes[12] !== 0x42 || bytes[13] !== 0x72 || bytes[14] !== 0x6b || bytes[15] !== 0x20 || bytes[16] !== 6) {
    throw new Error('Expected a little-endian ASCII "Brk " entry, format version 6')
  }
  return bytes.subarray(headerSize)
}

// ICU's compiled rules as the engines read them, which src/line-breaks.ts gets in the shorter form
// written below: the state table and the UCPTrie of categories.
type CompiledRules = {
  catCount: number
  dictCategoriesStart: number
  flags: number
  rowWidth: number
  rows: Uint16Array
  lookAheadResultsSize: number
  trieIndex: Uint16Array
  trieData: Uint16Array
  trieDataLength: number
  trieHighStart: number
}

// `count` little-endian values of `Type` from `offset` in `bytes`, which needn't be aligned, copied
// out on a little-endian platform.
function readValues<T extends Uint16Array | Uint32Array>(
  Type: { new (length: number): T, readonly BYTES_PER_ELEMENT: number },
  bytes: Uint8Array,
  offset = 0,
  count = (bytes.length - offset) / Type.BYTES_PER_ELEMENT,
): T {
  const out = new Type(count)
  new Uint8Array(out.buffer).set(bytes.subarray(offset, offset + count * Type.BYTES_PER_ELEMENT))
  return out
}

const RBBI_8BITS_ROWS = 4 // rbbidata.h:152

// Compiled rules without the data package header: RBBIDataHeader (rbbidata.h:67-94),
// checked as rbbidata.cpp:69-71 does, then the tables it points to.
function parseBreakRules(bytes: Uint8Array): CompiledRules {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0xb1a0 || bytes[4] !== 6) throw new Error('Expected ICU break rules, format 6')
  const catCount = view.getUint32(12, true)
  const table = view.getUint32(16, true)
  const trie = view.getUint32(32, true)

  // RBBIStateTable, rbbidata.h:134-148: five uint32 fields, then rows of fAccepting,
  // fLookAhead, fTagsIdx and fNextState[catCount], 8 or 16 bits each (rbbidata.h:98-125).
  // 8-bit rows and trie values are widened to 16 bits.
  const numStates = view.getUint32(table, true)
  const rowLength = view.getUint32(table + 4, true)
  const dictCategoriesStart = view.getUint32(table + 8, true)
  const lookAheadResultsSize = view.getUint32(table + 12, true)
  const flags = view.getUint32(table + 16, true)
  const rowWidth = 3 + catCount
  const eightBitRows = (flags & RBBI_8BITS_ROWS) !== 0 // rbbi.cpp:739
  if (rowLength !== rowWidth * (eightBitRows ? 1 : 2)) throw new Error('Unexpected state table row length')
  const rows = eightBitRows
    ? Uint16Array.from(bytes.subarray(table + 20, table + 20 + numStates * rowLength))
    : readValues(Uint16Array, bytes, table + 20, numStates * rowWidth)

  // UCPTrieHeader, ucptrie_impl.h:24-56, checked as ucptrie_openFromBinary does
  // (ucptrie.cpp:44-68). RBBI asks for a fast trie with 8- or 16-bit values
  // (rbbidata.cpp:113-127).
  if (view.getUint32(trie, true) !== 0x54726933) throw new Error('Bad trie signature')
  const options = view.getUint16(trie + 4, true)
  const valueWidth = options & 7 // UCPTRIE_VALUE_BITS_16 = 0, UCPTRIE_VALUE_BITS_8 = 2
  if (((options >> 6) & 3) !== 0 || (options & 0x38) !== 0 || (valueWidth !== 0 && valueWidth !== 2)) {
    throw new Error('Expected a fast trie with 8- or 16-bit values')
  }
  const indexLength = view.getUint16(trie + 6, true)
  const trieDataLength = ((options & 0xf000) << 4) | view.getUint16(trie + 8, true) // ucptrie.cpp:74-75
  const trieHighStart = view.getUint16(trie + 14, true) << 9 // UCPTRIE_SHIFT_2, ucptrie.cpp:80
  const trieIndex = readValues(Uint16Array, bytes, trie + 16, indexLength) // ucptrie.cpp:117-119
  const dataStart = trie + 16 + indexLength * 2
  const trieData = valueWidth === 0
    ? readValues(Uint16Array, bytes, dataStart, trieDataLength)
    : Uint16Array.from(bytes.subarray(dataStart, dataStart + trieDataLength))

  return {
    catCount, dictCategoriesStart, flags, rowWidth, rows, lookAheadResultsSize,
    trieIndex, trieData, trieDataLength, trieHighStart,
  }
}

// A trie's data index past its fast range and below its high start: ucptrie_internalSmallIndex
// (ucptrie.cpp:161-185) and ICU4X's internal_small_index (icu_collections 2.1.1
// cptrie.rs:433-500), with SHIFT_1 14, SHIFT_2 9, SHIFT_3 4 and 5-bit masks.
function getTrieDataIndex(index: Uint16Array, firstLevelStart: number, c: number): number {
  let i3Block = index[index[(c >> 14) + firstLevelStart]! + ((c >> 9) & 0x1f)]!
  let i3 = (c >> 4) & 0x1f
  let dataBlock: number
  if ((i3Block & 0x8000) === 0) {
    dataBlock = index[i3Block + i3]!
  } else {
    i3Block = (i3Block & 0x7fff) + (i3 & ~7) + (i3 >> 3)
    i3 &= 7
    dataBlock = (index[i3Block]! << (2 + 2 * i3)) & 0x30000
    dataBlock |= index[i3Block + 1 + i3]!
  }
  return dataBlock + (c & 0xf)
}

// UCPTRIE_FAST_GET with fastMax 0xffff (unicode/ucptrie.h:358, 601-620), and a fast trie's
// first index level after UCPTRIE_BMP_INDEX_LENGTH - UCPTRIE_OMITTED_BMP_INDEX_1_LENGTH entries.
function getCategory(rules: CompiledRules, c: number): number {
  const index = rules.trieIndex
  if (c <= 0xffff) return rules.trieData[index[c >> 6]! + (c & 0x3f)]!
  if (c >= rules.trieHighStart) return rules.trieData[rules.trieDataLength - 2]!
  return rules.trieData[getTrieDataIndex(index, 1020, c)]!
}

// ICU4X's CodePointTrie::get32 for TrieType::Small with u8 values (cptrie.rs:648-656), for a
// code point up to U+10FFFF: Firefox's line data. SMALL_INDEX_LENGTH is 64.
function getSmallTrieValue(index: Uint16Array, data: Uint8Array, highStart: number, c: number): number {
  if (c <= 0xfff) return data[index[c >> 6]! + (c & 0x3f)]! // get32_assuming_fast_index, :568-600
  if (c >= highStart) return data[data.length - 2]! // small_index, :503-509
  return data[getTrieDataIndex(index, 64, c)]!
}

// The class `get` gives every code point, a byte each.
function classesOf(get: (c: number) => number): Uint8Array {
  const classes = new Uint8Array(0x110000)
  for (let c = 0; c < classes.length; c++) {
    const value = get(c)
    if (value > 0xff) throw new Error(`U+${c.toString(16)} has class ${value}, more than a byte`)
    classes[c] = value
  }
  return classes
}

// Every code point's class in each map the library reads, and each line and character table's
// compiled rules, as the engine files have them. The module below must unpack to these.
export const engineClassMaps: Record<string, Uint8Array> = {}
export const engineRuleTables: Record<string, CompiledRules> = {}

// A table cut from an ICU data package: its rules, and its categories as a class map.
function readBreakRules(name: string, path: string): CompiledRules {
  const rules = parseBreakRules(withoutDataHeader(readData(path)))
  engineRuleTables[name] = rules
  engineClassMaps[name] = classesOf(c => getCategory(rules, c))
  return rules
}

// Pair tables.
const blinkPairs = parsePairTable(readText(`${CHROME}/break_iterator_data_inline_header.h`), 'kFastLineBreakTable[')
const webkitPairs = parsePairTable(readText(`${SAFARI}/BreakablePositions.cpp`), 'LineBreakTable::breakTable')
let differingPairs = 0
for (let i = 0; i < blinkPairs.length; i++) for (let k = 0; k < 8; k++) if (((blinkPairs[i]! ^ webkitPairs[i]!) >> k) & 1) differingPairs++

// Line tables.
const lineTableSources = [
  ['chromium/line_normal', `${CHROME}/line_normal.brk`],
  ['chromium/line_normal_cj', `${CHROME}/line_normal_cj.brk`],
  ['apple/line_normal', `${SAFARI}/line_normal.brk`],
  ['apple/line', `${SAFARI}/line.brk`],
  ['apple/line_cj', `${SAFARI}/line_cj.brk`],
] as const
for (let t = 0; t < lineTableSources.length; t++) {
  const [name, path] = lineTableSources[t]!
  if ((readBreakRules(name, path).flags & 2) !== 0) throw new Error(`${name} has start-of-text rules, which src/line-breaks.ts doesn't read`)
}

// Character tables: ICU's grapheme cluster rules. src/graphemes.ts reads one in a single pass,
// ending a cluster before the code point whose transition stops or enters a look-ahead state and
// starting the next one there from the start state. That is ICU's handleNext when the start
// state takes every category the trie gives, every state it enters accepts, and each
// look-ahead state is entered only from states that record its position, one code point back.
// No dictionary categories or start-of-text rules either, and at most 128 states. The start
// state doesn't accept, so no code point leads back to it.
function checkSinglePass(rules: CompiledRules, name: string): void {
  const width = rules.rowWidth
  const rows = rules.rows
  if ((rules.flags & 2) !== 0 || rules.dictCategoriesStart < rules.catCount) throw new Error(`${name} has start-of-text rules or dictionaries`)
  if (rows.length / width > 128) throw new Error(`${name} has more states than src/graphemes.ts keeps in 7 bits`)
  if (rows[width] !== 0) throw new Error(`${name}'s start state accepts`)
  for (let c = 0; c <= 0x10ffff; c++) {
    const category = getCategory(rules, c)
    if (category < 3 || category >= rules.catCount) throw new Error(`${name} gives U+${c.toString(16)} category ${category}`)
  }
  for (let state = 1; state < rows.length / width; state++) {
    for (let category = 3; category < rules.catCount; category++) {
      const next = rows[state * width + 3 + category]!
      const accepting = rows[next * width]!
      if (state === 1 ? accepting === 1 : next === 0 || accepting === 1 || (accepting > 1 && rows[state * width + 1] === accepting)) continue
      throw new Error(`${name}: state ${state} takes category ${category} to state ${next}, which one pass can't follow`)
    }
  }
}
const charTableNames = ['chromium/char', 'apple/char'] as const
const chromiumChar = readBreakRules('chromium/char', `${CHROME}/char.brk`)
const appleChar = readBreakRules('apple/char', `${SAFARI}/char.brk`)
checkSinglePass(chromiumChar, 'chromium/char')
checkSinglePass(appleChar, 'apple/char')
if (chromiumChar.catCount !== appleChar.catCount || chromiumChar.rows.some((row, i) => row !== appleChar.rows[i])) {
  throw new Error('Chrome and libicucore have different grapheme rules')
}
// src/gecko-line-breaks.ts takes a word of code units below U+0300 as a cluster per unit: of those
// code points, only CR and LF share a cluster (GB3), and Gecko's words hold neither.
{
  const categories = new Set<number>()
  for (let c = 0; c < 0x300; c++) if (c !== 0x0d && c !== 0x0a) categories.add(getCategory(chromiumChar, c))
  const width = chromiumChar.rowWidth
  for (const first of categories) {
    const state = chromiumChar.rows[width + 3 + first]!
    for (const second of categories) {
      if (chromiumChar.rows[state * width + 3 + second] !== 0) throw new Error('Below U+0300, code points other than CR and LF share a cluster')
    }
  }
}
const appleCharDifferences: number[] = []
for (let c = 0; c <= 0x10ffff; c++) if (getCategory(chromiumChar, c) !== getCategory(appleChar, c)) appleCharDifferences.push(c)

// Quotation remaps per locale, setCategoryOverrides in apple-rbbi.cpp:406-487.
const quotation = new Set(JSON.parse(readText(`${SAFARI}/quotation.json`)) as number[])
const locales = JSON.parse(readText(`${SAFARI}/locales.json`)) as Record<string, [string, number, number, number, number]>
function getQuoteRemap(language: string, delimiters: readonly number[]): number[] {
  const remap: number[] = []
  if (language === 'da') return remap
  for (let pair = 0; pair < 2; pair++) {
    const open = delimiters[pair * 2]!
    let close = delimiters[pair * 2 + 1]!
    if (close === 0x201c) close = 0x201d
    if (close === 0x2018) close = 0
    if (open === close) continue
    if (quotation.has(open) && open !== 0x2019) remap.push(open, 0)
    if (quotation.has(close) && close !== 0x2019) remap.push(close, 1)
  }
  return remap
}
const ownRemaps = new Map<string, number[]>()
for (const [name, [table, ...delimiters]] of Object.entries(locales)) {
  const language = getBreakLanguage(name)
  const expected = language === 'ja' || language === 'ko' ? 'line_normal.brk' : language === 'zh' ? 'line_cj.brk' : 'line.brk'
  if (table !== expected) throw new Error(`libicucore opens ${table} for ${name}, where the scan opens ${expected}`)
  ownRemaps.set(name, getQuoteRemap(name.split('_')[0]!, delimiters))
}
const appleQuoteRemaps: Record<string, number[]> = { '': ownRemaps.get('')! }
const lookUpRemap = (name: string): number[] => {
  for (;;) {
    const remap = appleQuoteRemaps[name]
    if (remap !== undefined) return remap
    const cut = name.lastIndexOf('_')
    name = cut < 0 ? '' : name.slice(0, cut)
  }
}
const names = Array.from(ownRemaps.keys()).sort((x, y) => x.split('_').length - y.split('_').length || (x < y ? -1 : 1))
for (const name of names) {
  if (JSON.stringify(lookUpRemap(name)) !== JSON.stringify(ownRemaps.get(name))) appleQuoteRemaps[name] = ownRemaps.get(name)!
}
for (const [name, remap] of ownRemaps) {
  if (JSON.stringify(lookUpRemap(name)) !== JSON.stringify(remap)) throw new Error(`Remap lookup misses ${name}`)
}

// Firefox's rule data: three Rust byte string literals, the trie index as u16 little-endian,
// the trie data and the break states as u8, and header fields.
const rustEscapes: Record<string, number> = { '0': 0, n: 10, r: 13, t: 9, '\\': 92, '"': 34, "'": 39 }
const parseRustByteString = (literal: string): Uint8Array => {
  const bytes: number[] = []
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] !== '\\') { bytes.push(literal.charCodeAt(i)); continue }
    const escape = literal[++i]!
    if (escape === 'x') { bytes.push(parseInt(literal.slice(i + 1, i + 3), 16)); i += 2 }
    else if (escape in rustEscapes) bytes.push(rustEscapes[escape]!)
    else throw new Error(`Unknown Rust escape \\${escape}`)
  }
  return new Uint8Array(bytes)
}
function readRuleBreakData(path: string) {
  const source = readText(path)
  const literals = Array.from(source.matchAll(/b"((?:[^"\\]|\\.)*)"/g), match => parseRustByteString(match[1]!))
  const field = (name: string): number => {
    const match = source.match(new RegExp(`${name} : (\\d+)u`))
    if (match === null) throw new Error(`Missing ${name} in ${path}`)
    return Number(match[1])
  }
  if (literals.length !== 3) throw new Error(`Expected 3 byte strings in ${path}, got ${literals.length}`)
  const [index, data, states] = literals as [Uint8Array, Uint8Array, Uint8Array]
  const propertyCount = field('property_count')
  if (!/trie_type : icu :: collections :: codepointtrie :: TrieType :: Small/.test(source)) throw new Error(`Expected a small trie in ${path}`)
  if (!/\) \} , 0u8\) \} , break_state_table/.test(source)) throw new Error(`Expected trie error value 0 in ${path}`)
  if (index.length % 2 !== 0 || states.length !== propertyCount ** 2) throw new Error(`Unexpected data sizes in ${path}`)
  return { index, data, states, propertyCount, field }
}
const {
  index: geckoLineIndex, data: geckoLineData, states: geckoLineStates, field: geckoLineField, propertyCount: geckoLinePropertyCount,
} = readRuleBreakData(`${FIREFOX}/segmenter_break_line_v1.rs.data`)
// src/gecko-line-breaks.ts reads Line_Break values by number (icu_segmenter line.rs:18-128).
if (geckoLineField('complex_property') !== 46) throw new Error('Expected SA to be Line_Break value 46')
{
  const index = readValues(Uint16Array, geckoLineIndex)
  const highStart = geckoLineField('high_start')
  engineClassMaps['gecko/line'] = classesOf(c => getSmallTrieValue(index, geckoLineData, highStart, c))
}

// Firefox's Unicode properties: icu_properties 2.1.2's Bidi_Class, and its East_Asian_Width H (2),
// F (3) and W (5) with 0 for every other value, in ICU4C numbering.
type Ranges = [number, number, number][]
const properties = JSON.parse(readText(`${FIREFOX}/properties.json`)) as {
  bidiClass: Ranges, eastAsianWidth: Ranges
}
// The class of every code point from ranges that cover them all in order.
const rangeClasses = (ranges: Ranges, keep: (value: number) => boolean): Uint8Array => {
  const classes = new Uint8Array(0x110000)
  for (let i = 0; i < ranges.length; i++) {
    const [start, end, value] = ranges[i]!
    if (start !== (i === 0 ? 0 : ranges[i - 1]![1] + 1) || end < start) throw new Error(`Ranges out of order at U+${start.toString(16)}`)
    if (value > 0xff) throw new Error(`U+${start.toString(16)} has class ${value}, more than a byte`)
    if (keep(value)) classes.fill(value, start, end + 1)
  }
  if (ranges[ranges.length - 1]![1] !== 0x10ffff) throw new Error('Ranges stop before U+10FFFF')
  return classes
}
engineClassMaps['gecko/east_asian_width'] = rangeClasses(properties.eastAsianWidth, value => value === 2 || value === 3 || value === 5)
engineClassMaps['gecko/bidi_class'] = rangeClasses(properties.bidiClass, () => true)

// unicode-bidi's bracket pairs: [opening, closing, normalized opening or 0].
const geckoBidiPairs: number[] = []
const pairsSource = readText(`${FIREFOX}/bidi_pairs_table.rs`)
for (const match of pairsSource.matchAll(/\(\s*'\\u\{([0-9a-f]+)\}',\s*'\\u\{([0-9a-f]+)\}',\s*(?:None|Some\(\s*'\\u\{([0-9a-f]+)\}'\s*\))\s*\)/g)) {
  geckoBidiPairs.push(parseInt(match[1]!, 16), parseInt(match[2]!, 16), match[3] === undefined ? 0 : parseInt(match[3], 16))
}
if (geckoBidiPairs.length / 3 !== (pairsSource.match(/None|Some\(/g) ?? []).length) throw new Error('Unparsed bidi pairs')

// --- The shorter form ---

// Class maps. Engines class most code points alike, and so do one engine's tables, so the maps
// ship as one list of runs of joint classes, the classes all the maps together tell apart, and a
// byte per joint class for each map (unpackClassRuns in src/line-breaks.ts). Joint classes are
// numbered from the one with the most runs, so most take one byte.
const classMapNames = Object.keys(engineClassMaps)
const jointOf = new Uint16Array(0x110000)
let jointClassCount = 0
const jointRuns: [number, number][] = []
{
  const jointIds = new Map<string, number>()
  for (let c = 0; c < 0x110000; c++) {
    let key = ''
    for (let m = 0; m < classMapNames.length; m++) key += String.fromCharCode(engineClassMaps[classMapNames[m]!]![c]!)
    let joint = jointIds.get(key)
    if (joint === undefined) jointIds.set(key, joint = jointIds.size)
    jointOf[c] = joint
  }
  jointClassCount = jointIds.size
  const runCounts = new Array<number>(jointClassCount).fill(0)
  for (let c = 0; c < 0x110000; c++) if (c === 0 || jointOf[c] !== jointOf[c - 1]) runCounts[jointOf[c]!]!++
  const byRuns = Array.from(runCounts.keys()).sort((x, y) => runCounts[y]! - runCounts[x]! || x - y)
  const renumbered = new Uint16Array(jointClassCount)
  for (let i = 0; i < byRuns.length; i++) renumbered[byRuns[i]!] = i
  for (let c = 0; c < 0x110000; c++) jointOf[c] = renumbered[jointOf[c]!]!
  for (let c = 0; c < 0x110000;) {
    let end = c + 1
    while (end < 0x110000 && jointOf[end] === jointOf[c]) end++
    jointRuns.push([end - c - 1, jointOf[c]!])
    c = end
  }
}
const classRunsVarints = packVarints(jointRuns.flat())
const classRuns = unpackVarints(classRunsVarints)
const classRemaps = new Uint8Array(classMapNames.length * jointClassCount)
for (let c = 0; c < 0x110000; c++) {
  for (let m = 0; m < classMapNames.length; m++) classRemaps[m * jointClassCount + jointOf[c]!] = engineClassMaps[classMapNames[m]!]![c]!
}
// Each map's row in the remaps and the blocks its table takes, found by unpacking it with room for
// every block, then checked: the table of that size gives every code point its class.
const classMaps: Record<string, [number, number]> = {}
const unpackedClasses: Record<string, ClassTable> = {}
for (let m = 0; m < classMapNames.length; m++) {
  const name = classMapNames[m]!
  const remap = classRemaps.subarray(m * jointClassCount, (m + 1) * jointClassCount)
  const blocks = unpackClassRuns(classRuns, remap, 0x1100).index.reduce((most, block) => Math.max(most, block), 0) + 1
  const table = unpackClassRuns(classRuns, remap, blocks)
  const classes = engineClassMaps[name]!
  for (let c = 0; c < 0x110000; c++) if (getClass(table, c) !== classes[c]) throw new Error(`${name} unpacks U+${c.toString(16)} to another class`)
  classMaps[name] = [m, blocks]
  unpackedClasses[name] = table
}

// State tables, as unpackStateRows in src/line-breaks.ts reads them. The line tables come from
// nearly the same rules, and so do the character tables, so each ships as its differences from the
// earlier table of its kind that makes it shortest, or alone where none does. A table of another
// shape is tried too: ICU's rule compiler numbers categories and states in the order it makes
// them, so a rule added to a table inserts some and renumbers the rest, as line_normal_cj.brk's
// does to line_normal.brk's. findTransform looks for that; where it finds none, the table ships
// against the tables of its own shape or alone.
const ruleTableKinds: readonly (readonly string[])[] = [lineTableSources.map(([name]) => name), charTableNames]

// unpackStateRows's differences from `start`, the rows it has before it reads any, to `rows`.
function findRowDifferences(rows: Uint16Array, width: number, start: Uint16Array): number[] {
  const out: number[] = []
  let skipped = 0
  for (let row = 0; row < rows.length; row += width) {
    const differing = (from: Uint16Array, other: number): number[] => {
      const cells: number[] = []
      for (let c = 0; c < width; c++) if (rows[row + c] !== from[other + c]) cells.push(c)
      return cells
    }
    let back = 0
    let cells = differing(start, row)
    for (let other = row - width; other >= 0 && cells.length > 0; other -= width) {
      const otherCells = differing(rows, other)
      if (otherCells.length < cells.length) { back = (row - other) / width; cells = otherCells }
    }
    if (back === 0 && cells.length === 0) { skipped++; continue }
    out.push(skipped, back, cells.length)
    skipped = 0
    for (let i = 0; i < cells.length; i++) out.push(cells[i]! - (i === 0 ? 0 : cells[i - 1]! + 1), rows[row + cells[i]!]!)
  }
  return out
}

// unpackStateRows's transform from `base` to a table with categories or states inserted, or null.
// States are paired by running both tables from their start states over every category at once:
// the states each lands in pair up. That needs each category's base category first, so it is the
// one most of its code points have in the base, or its own number if it has no code point; then,
// with the states paired, the base category whose column differs from its own in the fewest
// rows, since a category split off another keeps that one's code points but may take a third's
// transitions: line_normal_cj.brk's category of U+301C and U+30A0 ($NSX, ICU's
// source/data/brkitr/rules/line_normal_cj.txt:63-64), nonstarters in line_normal.brk, is nearest
// the column of U+00B4's category there. It is a transform when every base state is paired, in
// the base's order.
function findTransform(baseName: string, name: string): number[] | null {
  const base = engineRuleTables[baseName]!
  const rules = engineRuleTables[name]!
  const baseClasses = engineClassMaps[baseName]!
  const classes = engineClassMaps[name]!
  const baseStates = base.rows.length / base.rowWidth
  const shared = Array.from({ length: rules.catCount }, () => new Array<number>(base.catCount).fill(0))
  for (let c = 0; c < 0x110000; c++) shared[classes[c]!]![baseClasses[c]!]!++
  const columns: number[] = []
  for (let category = 0; category < rules.catCount; category++) {
    const counts = shared[category]!
    const most = counts.reduce((best, count, i) => count > counts[best]! ? i : best, 0)
    columns.push(counts[most]! > 0 ? most : Math.min(category, base.catCount - 1))
  }
  const moved = new Array<number>(baseStates)
  const pairStates = () => {
    moved.fill(-1)
    moved[0] = 0
    moved[1] = 1
    const queue = [0, 1]
    for (let q = 0; q < queue.length; q++) {
      const baseState = queue[q]!
      for (let category = 0; category < rules.catCount; category++) {
        const baseNext = base.rows[baseState * base.rowWidth + 3 + columns[category]!]!
        if (moved[baseNext] !== -1) continue
        moved[baseNext] = rules.rows[moved[baseState]! * rules.rowWidth + 3 + category]!
        queue.push(baseNext)
      }
    }
  }
  pairStates()
  for (let category = 0; category < rules.catCount; category++) {
    const differing = (baseCategory: number): number => {
      let count = 0
      for (let baseState = 0; baseState < baseStates; baseState++) {
        if (moved[baseState] === -1) continue
        const baseNext = moved[base.rows[baseState * base.rowWidth + 3 + baseCategory]!]!
        if (baseNext !== rules.rows[moved[baseState]! * rules.rowWidth + 3 + category]) count++
      }
      return count
    }
    let fewest = differing(columns[category]!)
    for (let baseCategory = 0; baseCategory < base.catCount; baseCategory++) {
      const count = differing(baseCategory)
      if (count < fewest) { fewest = count; columns[category] = baseCategory }
    }
  }
  pairStates()
  const inserted: number[] = []
  for (let baseState = 0; baseState < baseStates; baseState++) {
    if (moved[baseState] === -1 || (baseState > 0 && moved[baseState]! <= moved[baseState - 1]!)) return null
    for (let state = baseState === 0 ? 0 : moved[baseState - 1]! + 1; state < moved[baseState]!; state++) inserted.push(state)
  }
  for (let state = moved[baseStates - 1]! + 1; state < rules.rows.length / rules.rowWidth; state++) inserted.push(state)
  return [base.catCount, ...columns, ...inserted]
}

type PackedRuleTable = [number, number, number, number, string | null, string | null, string]
const ruleTables: Record<string, PackedRuleTable> = {}
for (const ruleTableNames of ruleTableKinds) for (let t = 0; t < ruleTableNames.length; t++) {
  const name = ruleTableNames[t]!
  const rules = engineRuleTables[name]!
  const states = rules.rows.length / rules.rowWidth
  let best: PackedRuleTable | null = null
  for (let r = -1; r < t; r++) {
    const baseName = r < 0 ? null : ruleTableNames[r]!
    const base = baseName === null ? null : engineRuleTables[baseName]!
    let transform: number[] | null = null
    if (base !== null && (base.rowWidth !== rules.rowWidth || base.rows.length !== rules.rows.length)) {
      transform = findTransform(baseName!, name)
      if (transform === null) continue
    }
    const unpack = (differences: Int32Array) => unpackStateRows(
      rules.rowWidth, states, base === null ? null : base.rows, transform === null ? null : Int32Array.from(transform), differences,
    )
    const differences = findRowDifferences(rules.rows, rules.rowWidth, unpack(new Int32Array(0)))
    const packed: PackedRuleTable = [
      rules.catCount, rules.dictCategoriesStart, rules.lookAheadResultsSize, states,
      baseName, transform === null ? null : packVarints(transform), packVarints(differences),
    ]
    const unpacked = unpack(unpackVarints(packed[6]))
    if (unpacked.length !== rules.rows.length || unpacked.some((cell, i) => cell !== rules.rows[i])) throw new Error(`${name}'s state rows unpack otherwise`)
    const size = (table: PackedRuleTable) => table[6].length + (table[5] === null ? 0 : table[5].length)
    if (best === null || size(packed) < size(best)) best = packed
  }
  ruleTables[name] = best!
}

// A table's rules as the library has them once unpacked: both checked above.
const unpackedRules = (name: string): BreakRules => {
  const rules = engineRuleTables[name]!
  return {
    catCount: rules.catCount, dictCategoriesStart: rules.dictCategoriesStart, rowWidth: rules.rowWidth, rows: rules.rows,
    lookAheadResultsSize: rules.lookAheadResultsSize, classes: unpackedClasses[name]!,
  }
}

// Firefox's grapheme clusters, from ICU4X's grapheme data, which src/graphemes.ts doesn't ship:
// it takes Chrome's char.brk in Firefox. Checked here: both tables split the code points into the
// same classes, and ICU4X's RuleBreakIterator::next (icu_segmenter 2.1.2 rule_segmenter.rs:72-213,
// without complex properties) ends clusters where ICU's handleNext does, on every string of up to
// four code points taking one per class and on 100,000 random longer ones.
const geckoGrapheme = readRuleBreakData(`${FIREFOX}/segmenter_break_grapheme_cluster_v1.rs.data`)
const chromiumCharUnpacked = unpackedRules('chromium/char')
const geckoGraphemeIndex = readValues(Uint16Array, geckoGrapheme.index)
const geckoGraphemeHighStart = geckoGrapheme.field('high_start')
const getGeckoGraphemeProperty = (c: number) => getSmallTrieValue(geckoGraphemeIndex, geckoGrapheme.data, geckoGraphemeHighStart, c)
const classRepresentatives: number[] = []
{
  const propertyOfCategory = new Map<number, number>()
  const categoryOfProperty = new Map<number, number>()
  for (let c = 0; c <= 0x10ffff; c++) {
    const category = getCategory(chromiumChar, c)
    const property = getGeckoGraphemeProperty(c)
    if (!propertyOfCategory.has(category)) { propertyOfCategory.set(category, property); classRepresentatives.push(c) }
    if (!categoryOfProperty.has(property)) categoryOfProperty.set(property, category)
    if (propertyOfCategory.get(category) !== property || categoryOfProperty.get(property) !== category) {
      throw new Error(`Firefox's grapheme data classes U+${c.toString(16)} apart from Chrome's char.brk`)
    }
  }
}
const [BREAK, NO_MATCH, KEEP, INTERMEDIATE] = [253, 254, 255, 120]
// The UTF-16 ends of the clusters of a string of class representatives.
function getGeckoClusterEnds(classes: readonly number[]): number[] {
  const { states, propertyCount } = geckoGrapheme
  const lastCodepointProperty = geckoGrapheme.field('last_codepoint_property')
  const eot = geckoGrapheme.field('eot_property')
  const n = classes.length
  const offsets = [0]
  for (let i = 0; i < n; i++) offsets.push(offsets[i]! + (classRepresentatives[classes[i]!]! > 0xffff ? 2 : 1))
  const property = (i: number) => getGeckoGraphemeProperty(classRepresentatives[classes[i]!]!)
  const ends: number[] = []
  for (let current = 0; current < n;) {
    let end = n
    next: for (;;) {
      const left = property(current++)
      if (current === n) break
      const state = states[left * propertyCount + property(current)]!
      if (state === KEEP) continue
      if (state === BREAK || state === NO_MATCH) { end = current; break }
      let index = state >= INTERMEDIATE ? state - INTERMEDIATE : state
      let marker = current
      for (;;) {
        current++
        if (current === n) {
          if (states[index * propertyCount + eot] === NO_MATCH) end = marker
          break next
        }
        const wasCodepointProperty = index <= lastCodepointProperty
        const following = states[index * propertyCount + property(current)]!
        if (following === KEEP) continue next
        if (following === NO_MATCH) { end = marker; break next }
        if (following === BREAK) { end = current; break next }
        index = following >= INTERMEDIATE ? following - INTERMEDIATE : following
        if (following >= INTERMEDIATE || wasCodepointProperty) marker = current
      }
    }
    ends.push(offsets[end]!)
    current = end
  }
  return ends
}
{
  const check = (classes: readonly number[]) => {
    let text = ''
    for (let i = 0; i < classes.length; i++) text += String.fromCodePoint(classRepresentatives[classes[i]!]!)
    const flags = new Uint8Array(text.length + 1)
    markRuleBoundaries(chromiumCharUnpacked, text, flags)
    const ends: number[] = []
    for (let b = 1; b <= text.length; b++) if (flags[b] === 1) ends.push(b)
    const geckoEnds = getGeckoClusterEnds(classes)
    if (ends.length !== geckoEnds.length || ends.some((end, i) => end !== geckoEnds[i])) {
      throw new Error(`Firefox's grapheme data ends clusters of ${JSON.stringify(text)} at ${geckoEnds.join(',')}, Chrome's char.brk at ${ends.join(',')}`)
    }
  }
  const classes: number[] = []
  const extend = (length: number) => {
    if (classes.length > 0) check(classes)
    if (classes.length === length) return
    for (let k = 0; k < classRepresentatives.length; k++) {
      classes.push(k)
      extend(length)
      classes.pop()
    }
  }
  extend(4)
  let seed = 1
  const random = (n: number) => { seed = (seed * 48271) % 0x7fffffff; return seed % n }
  for (let t = 0; t < 100_000; t++) {
    const alphabet = Array.from({ length: 2 + random(4) }, () => random(classRepresentatives.length))
    classes.length = 0
    for (let length = 6 + random(40); length > 0; length--) classes.push(alphabet[random(alphabet.length)]!)
    check(classes)
  }
}

const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`
const appleCharDifferenceRanges: string[] = []
for (let i = 0; i < appleCharDifferences.length; i++) {
  let k = i
  while (k + 1 < appleCharDifferences.length && appleCharDifferences[k + 1] === appleCharDifferences[k]! + 1) k++
  appleCharDifferenceRanges.push(k === i ? hex(appleCharDifferences[i]!) : `${hex(appleCharDifferences[i]!)}..${hex(appleCharDifferences[k]!)}`)
  i = k
}
const remapsJson = JSON.stringify(appleQuoteRemaps)
const quoted = (names: readonly string[]) => names.map(name => `'${name}'`).join(' | ')
const classRemapsPacked = packTable(classRemaps)
const ruleTablesJson = JSON.stringify(ruleTables)
const geckoLineBreakStatesPacked = packTable(geckoLineStates)
const geckoBidiPairsVarints = packVarints(geckoBidiPairs)
const nextSource = `// Generated by scripts/generate-engine-break-data.ts from scripts/engine-data/.
// Do not edit by hand. Regenerate with \`bun run generate:engine-break-data\`.

// A string named ...Packed is a table in unpackTable's form, the others are varints in base64
// (unpackVarints), both in src/line-breaks.ts.

// Chrome 153's line_normal.brk and line_normal_cj.brk (ICU 78.2) and libicucore 78.1's line.brk,
// line_normal.brk and line_cj.brk: ICU's line rules. Chrome 153's and libicucore 78.1's char.brk:
// ICU's grapheme cluster rules. libicucore's character classes ${appleCharDifferenceRanges.join(', ')}
// apart from Chrome's.
export type LineTable = ${quoted(lineTableSources.map(([name]) => name))}
export type CharTable = ${quoted(charTableNames)}
export type RuleTable = LineTable | CharTable

// A class for every code point: each rule table's categories, and for Firefox the Line_Break
// values of its baked ICU4X line data and icu_properties 2.1.2's Bidi_Class and East_Asian_Width
// H (2), F (3) and W (5), 0 otherwise, in ICU4C numbering. For each map, its row in the remaps and
// how many blocks its table takes; then one list of runs for all maps and the remaps, a byte per
// joint class and map (unpackClassRuns in src/line-breaks.ts).
export type ClassMap = ${quoted(classMapNames)}
export const classMaps: Record<ClassMap, readonly [number, number]> = ${JSON.stringify(classMaps)}
export const jointClassCount = ${jointClassCount}
export const classRunsVarints = '${classRunsVarints}'
export const classRemapsPacked = '${classRemapsPacked}'

// Each rule table's forward state table: its categories, first dictionary category, look-ahead
// slots and states, then the table its rows start from, if any, the transform of that table's
// rows, if any, and the rows' differences (unpackStateRows in src/line-breaks.ts).
export const ruleTables: Record<RuleTable, readonly [number, number, number, number, RuleTable | null, string | null, string]> = ${ruleTablesJson}

// Chromium's generated kFastLineBreakTable, a bit per U+0021..U+00FF pair where a line may
// start between them (character_property_data_generator.cc:422-551).
export const blinkLinePairsPacked = '${packTable(blinkPairs)}'

// WebKit's LineBreakTable, BreakablePositions.cpp:42-269.
export const webkitLinePairsPacked = '${packTable(webkitPairs)}'

// libicucore's quotation remaps by locale name (apple-rbbi.cpp:406-487): a code point, then
// 0 for the category of U+007B or 1 for U+007D. A locale without an entry takes its parent's.
export const appleQuoteRemaps: Record<string, readonly number[]> = ${remapsJson}

// Firefox's baked ICU4X line data: the BreakState byte of each pair of properties (icu_segmenter
// 2.1.2 src/provider/mod.rs:288-310).
export const geckoLinePropertyCount = ${geckoLinePropertyCount}
export const geckoLineLastCodepointProperty = ${geckoLineField('last_codepoint_property')}
export const geckoLineEotProperty = ${geckoLineField('eot_property')}
export const geckoLineBreakStatesPacked = '${geckoLineBreakStatesPacked}'

// unicode-bidi's bracket pairs (Unicode 15) as varints: [opening, closing, normalized opening or 0]
// for each.
export const geckoBidiPairsVarints = '${geckoBidiPairsVarints}'

`

const summary = [
  `${jointRuns.length} runs of ${jointClassCount} joint classes for ${classMapNames.length} class maps, ${classRunsVarints.length} B in base64, remaps ${classRemapsPacked.length} B`,
  `class table blocks ${classMapNames.map(name => `${name} ${classMaps[name]![1]}`).join(', ')}`,
  `state tables ${Object.keys(ruleTables).map(name => {
    const [, , , , base, transform, differences] = ruleTables[name]!
    return `${name} ${differences.length + (transform === null ? 0 : transform.length)} B${base === null ? '' : ` from ${base}${transform === null ? '' : ', transformed'}`}`
  }).join(', ')}`,
  `pair tables differ in ${differingPairs} pairs`,
  `quotation remaps ${Object.keys(appleQuoteRemaps).length} of ${ownRemaps.size} locales (${gzipSize(remapsJson)} B gzipped)`,
  `Firefox break states packed ${geckoLineBreakStatesPacked.length} B, bracket pairs ${geckoBidiPairsVarints.length} B`,
  `module ${nextSource.length} B, ${gzipSize(nextSource)} B gzipped`,
].join('; ')

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== nextSource) throw new Error(`Generated engine break data is stale: ${outputPath}`)
    console.log(`Generated engine break data is up to date: ${summary}.`)
  } else {
    await Bun.write(outputPath, nextSource)
    console.log(`Wrote ${outputPath}: ${summary}.`)
  }
}
