// Generates src/generated/engine-break-data.ts, the tables behind Chrome's and Safari's
// break scans in src/line-breaks.ts, Firefox's in src/gecko-line-breaks.ts and the grapheme
// clusters in src/graphemes.ts, from the engine files in scripts/engine-data/, and checks
// each table against its source. Refresh those files by hand when a browser's tables change,
// then run this. `--check` compares instead of writing.
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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  createRuleBreakIterator,
  getBreakLanguage,
  getCategory,
  getSmallTrieValue,
  nextRuleBoundary,
  parseBreakRules,
  unpackTable,
  type BreakRules,
} from '../src/line-breaks.ts'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptsDir, 'engine-data')
const outputPath = join(scriptsDir, '..', 'src', 'generated', 'engine-break-data.ts')
const readData = (path: string) => new Uint8Array(readFileSync(join(dataDir, path)))
const readText = (path: string) => readFileSync(join(dataDir, path), 'utf8')
const gzipSize = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

// unpackTable's form: greedy LZ77 over the dictionary and the table, matching at least four
// bytes among the last 64 positions with the same next four, checked to unpack exactly.
function packTable(bytes: Uint8Array, dictionary: Uint8Array | null = null): string {
  const dict = dictionary ?? new Uint8Array(0)
  const all = new Uint8Array(dict.length + bytes.length)
  all.set(dict)
  all.set(bytes, dict.length)
  const out: number[] = []
  const varint = (value: number) => {
    for (; value >= 0x80; value = Math.floor(value / 0x80)) out.push((value & 0x7f) | 0x80)
    out.push(value)
  }
  const chains = new Map<number, number[]>()
  const key = (i: number) => all[i]! | (all[i + 1]! << 8) | (all[i + 2]! << 16) | (all[i + 3]! * 0x1000000)
  const remember = (i: number) => {
    if (i + 4 > all.length) return
    const k = key(i)
    let chain = chains.get(k)
    if (chain === undefined) chains.set(k, chain = [])
    chain.push(i)
    if (chain.length > 64) chain.shift()
  }
  for (let i = 0; i < dict.length; i++) remember(i)
  varint(bytes.length)
  let literals: number[] = []
  for (let i = dict.length; i < all.length;) {
    let length = 0
    let distance = 0
    const chain = i + 4 <= all.length ? chains.get(key(i)) : undefined
    if (chain !== undefined) {
      for (let c = chain.length - 1; c >= 0; c--) {
        const j = chain[c]!
        let n = 0
        while (i + n < all.length && all[j + n] === all[i + n]) n++
        if (n > length) { length = n; distance = i - j }
      }
    }
    if (length >= 4) {
      varint(literals.length)
      out.push(...literals)
      literals = []
      varint(length - 4)
      varint(distance)
      for (let k = 0; k < length; k++) remember(i + k)
      i += length
    } else {
      literals.push(all[i]!)
      remember(i)
      i++
    }
  }
  varint(literals.length)
  out.push(...literals)
  const packed = base64(new Uint8Array(out))
  const unpacked = unpackTable(packed, dictionary)
  if (unpacked.length !== bytes.length || unpacked.some((byte, i) => byte !== bytes[i])) throw new Error('A table packs lossily')
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

// The RBBIDataHeader (rbbidata.h:67-94), forward state table, trie and status table,
// without the reverse table and rule source, which the iterator never reads.
function compactBreakRules(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const align = (n: number) => (n + 3) & ~3
  const [table, tableLength, trie, trieLength, status, statusLength] = [u32(16), u32(20), u32(32), u32(36), u32(48), u32(52)]
  const newTable = 80
  const newTrie = align(newTable + tableLength)
  const newStatus = align(newTrie + trieLength)
  const total = align(newStatus + statusLength)
  const out = new Uint8Array(total)
  out.set(bytes.subarray(0, 80), 0)
  const o = new DataView(out.buffer)
  o.setUint32(8, total, true)
  o.setUint32(16, newTable, true)
  o.setUint32(24, 0, true)
  o.setUint32(28, 0, true)
  o.setUint32(32, newTrie, true)
  o.setUint32(40, 0, true)
  o.setUint32(44, 0, true)
  o.setUint32(48, newStatus, true)
  out.set(bytes.subarray(table, table + tableLength), newTable)
  out.set(bytes.subarray(trie, trie + trieLength), newTrie)
  out.set(bytes.subarray(status, status + statusLength), newStatus)
  return out
}

function sameRules(a: BreakRules, b: BreakRules): boolean {
  const same = (x: ArrayLike<number>, y: ArrayLike<number>) => {
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
    return true
  }
  return a.catCount === b.catCount && a.dictCategoriesStart === b.dictCategoriesStart && a.flags === b.flags &&
    a.rowWidth === b.rowWidth && a.lookAheadResultsSize === b.lookAheadResultsSize && a.trieDataLength === b.trieDataLength &&
    a.trieHighStart === b.trieHighStart && same(a.rows, b.rows) && same(a.statusTable, b.statusTable) &&
    same(a.trieIndex, b.trieIndex) && same(a.trieData, b.trieData)
}

// A table cut from an ICU data package, compacted and checked to parse the same.
function readCompactBreakRules(path: string): Uint8Array {
  const bytes = withoutDataHeader(readData(path))
  const compact = compactBreakRules(bytes)
  if (!sameRules(parseBreakRules(bytes), parseBreakRules(compact))) throw new Error(`The compact ${path} parses differently`)
  return compact
}

// Pair tables.
const blinkPairs = parsePairTable(readText('chrome-153/break_iterator_data_inline_header.h'), 'kFastLineBreakTable[')
const webkitPairs = parsePairTable(readText('safari-27.0/BreakablePositions.cpp'), 'LineBreakTable::breakTable')
let differingPairs = 0
for (let i = 0; i < blinkPairs.length; i++) for (let k = 0; k < 8; k++) if (((blinkPairs[i]! ^ webkitPairs[i]!) >> k) & 1) differingPairs++

// Line tables. The five come from nearly the same rules, so each packs against the earlier table
// that packs it shortest, or alone where none does.
const lineTableSources = [
  ['chromium/line_normal', 'chrome-153/line_normal.brk'],
  ['chromium/line_normal_cj', 'chrome-153/line_normal_cj.brk'],
  ['apple/line_normal', 'safari-27.0/line_normal.brk'],
  ['apple/line', 'safari-27.0/line.brk'],
  ['apple/line_cj', 'safari-27.0/line_cj.brk'],
] as const
const lineTableBytes: Uint8Array[] = []
const lineTablesPacked: Record<string, [string | null, string]> = {}
for (let t = 0; t < lineTableSources.length; t++) {
  const bytes = readCompactBreakRules(lineTableSources[t]![1])
  lineTableBytes.push(bytes)
  let entry: [string | null, string] = [null, packTable(bytes)]
  for (let r = 0; r < t; r++) {
    const packed = packTable(bytes, lineTableBytes[r]!)
    if (packed.length < entry[1].length) entry = [lineTableSources[r]![0], packed]
  }
  lineTablesPacked[lineTableSources[t]![0]] = entry
}

// Character tables: ICU's grapheme cluster rules. src/graphemes.ts reads one in a single pass,
// ending a cluster before the code point whose transition stops or enters a look-ahead state and
// starting the next one there from the start state. That is ICU's handleNext when the start
// state takes every category the trie gives, every state it enters accepts, and each
// look-ahead state is entered only from states that record its position, one code point back.
// No dictionary categories or start-of-text rules either, and at most 128 states.
function checkSinglePass(rules: BreakRules, name: string): void {
  const width = rules.rowWidth
  const rows = rules.rows
  if ((rules.flags & 2) !== 0 || rules.dictCategoriesStart < rules.catCount) throw new Error(`${name} has start-of-text rules or dictionaries`)
  if (rows.length / width > 128) throw new Error(`${name} has more states than src/graphemes.ts keeps in 7 bits`)
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
const chromiumCharBytes = readCompactBreakRules('chrome-153/char.brk')
const appleCharBytes = readCompactBreakRules('safari-27.0/char.brk')
const chromiumChar = parseBreakRules(chromiumCharBytes)
const appleChar = parseBreakRules(appleCharBytes)
checkSinglePass(chromiumChar, 'chromium/char')
checkSinglePass(appleChar, 'apple/char')
if (chromiumChar.catCount !== appleChar.catCount || chromiumChar.rows.some((row, i) => row !== appleChar.rows[i])) {
  throw new Error('Chrome and libicucore have different grapheme rules')
}
const charTablesPacked: Record<string, [string | null, string]> = {
  'chromium/char': [null, packTable(chromiumCharBytes)],
  'apple/char': ['chromium/char', packTable(appleCharBytes, chromiumCharBytes)],
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
const quotation = new Set(JSON.parse(readText('safari-27.0/quotation.json')) as number[])
const locales = JSON.parse(readText('safari-27.0/locales.json')) as Record<string, [string, number, number, number, number]>
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
} = readRuleBreakData('firefox-156/segmenter_break_line_v1.rs.data')
// src/gecko-line-breaks.ts reads Line_Break values by number (icu_segmenter line.rs:18-128).
if (geckoLineField('complex_property') !== 46) throw new Error('Expected SA to be Line_Break value 46')

// Firefox's grapheme clusters, from ICU4X's grapheme data, which src/graphemes.ts doesn't ship:
// it takes Chrome's char.brk in Firefox. Checked here: both tables split the code points into the
// same classes, and ICU4X's RuleBreakIterator::next (icu_segmenter 2.1.2 rule_segmenter.rs:72-213,
// without complex properties) ends clusters where ICU's handleNext does, on every string of up to
// four code points taking one per class and on 100,000 random longer ones.
const geckoGrapheme = readRuleBreakData('firefox-156/segmenter_break_grapheme_cluster_v1.rs.data')
const geckoGraphemeIndex = new Uint16Array(geckoGrapheme.index.buffer, geckoGrapheme.index.byteOffset, geckoGrapheme.index.length >> 1)
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
  const iterator = createRuleBreakIterator(chromiumChar)
  const check = (classes: readonly number[]) => {
    let text = ''
    for (let i = 0; i < classes.length; i++) text += String.fromCodePoint(classRepresentatives[classes[i]!]!)
    iterator.text = text
    iterator.position = 0
    const ends: number[] = []
    for (let b = nextRuleBoundary(iterator); b !== -1; b = nextRuleBoundary(iterator)) ends.push(b)
    const geckoEnds = getGeckoClusterEnds(classes)
    if (ends.length !== geckoEnds.length || ends.some((end, i) => end !== geckoEnds[i])) {
      throw new Error(`Firefox's grapheme data ends clusters of ${JSON.stringify(text)} at ${geckoEnds}, Chrome's char.brk at ${ends}`)
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

// Firefox's Unicode properties.
type Ranges = [number, number, number][]
const properties = JSON.parse(readText('firefox-156/properties.json')) as {
  bidiClass: Ranges, eastAsianWidth: Ranges
}
// Flat [start - previous end - 1, end - start, value] triples of the kept values, from ranges
// that cover every code point in order.
const deltaRanges = (ranges: Ranges, keep: (value: number) => boolean): number[] => {
  const flat: number[] = []
  let previousEnd = -1
  for (let i = 0; i < ranges.length; i++) {
    const [start, end, value] = ranges[i]!
    if (start !== (i === 0 ? 0 : ranges[i - 1]![1] + 1) || end < start) throw new Error(`Ranges out of order at U+${start.toString(16)}`)
    if (!keep(value)) continue
    flat.push(start - previousEnd - 1, end - start, value)
    previousEnd = end
  }
  if (ranges[ranges.length - 1]![1] !== 0x10ffff) throw new Error('Ranges stop before U+10FFFF')
  return flat
}
const geckoBidiClassRanges = deltaRanges(properties.bidiClass, value => value !== 0)
const geckoEastAsianWidthRanges = deltaRanges(properties.eastAsianWidth, value => value === 2 || value === 3 || value === 5)

// unicode-bidi's bracket pairs: [opening, closing, normalized opening or 0].
const geckoBidiPairs: number[] = []
const pairsSource = readText('firefox-156/bidi_pairs_table.rs')
for (const match of pairsSource.matchAll(/\(\s*'\\u\{([0-9a-f]+)\}',\s*'\\u\{([0-9a-f]+)\}',\s*(?:None|Some\(\s*'\\u\{([0-9a-f]+)\}'\s*\))\s*\)/g)) {
  geckoBidiPairs.push(parseInt(match[1]!, 16), parseInt(match[2]!, 16), match[3] === undefined ? 0 : parseInt(match[3], 16))
}
if (geckoBidiPairs.length / 3 !== (pairsSource.match(/None|Some\(/g) ?? []).length) throw new Error('Unparsed bidi pairs')
const lineTablesJson = JSON.stringify(lineTablesPacked)
const charTablesJson = JSON.stringify(charTablesPacked)
const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`
const appleCharDifferenceRanges: string[] = []
for (let i = 0; i < appleCharDifferences.length; i++) {
  let k = i
  while (k + 1 < appleCharDifferences.length && appleCharDifferences[k + 1] === appleCharDifferences[k]! + 1) k++
  appleCharDifferenceRanges.push(k === i ? hex(appleCharDifferences[i]!) : `${hex(appleCharDifferences[i]!)}..${hex(appleCharDifferences[k]!)}`)
  i = k
}
const remapsJson = JSON.stringify(appleQuoteRemaps)
const geckoPropertiesJson = JSON.stringify([geckoBidiClassRanges, geckoEastAsianWidthRanges, geckoBidiPairs])
const nextSource = `// Generated by scripts/generate-engine-break-data.ts from scripts/engine-data/.
// Do not edit by hand. Regenerate with \`bun run generate:engine-break-data\`.

// Every table below is packed (unpackTable in src/line-breaks.ts).

// Chrome 153's line_normal.brk and line_normal_cj.brk (ICU 78.2) and libicucore 78.1's
// line.brk, line_normal.brk and line_cj.brk, without their reverse tables and rule source:
// each as the table it packs against, if any, and its packed bytes.
export type LineTable = ${lineTableSources.map(([name]) => `'${name}'`).join(' | ')}
export const lineTablesPacked: Record<LineTable, readonly [LineTable | null, string]> = ${lineTablesJson}

// Chrome 153's and libicucore 78.1's char.brk, ICU's grapheme cluster rules, packed the same way.
// libicucore's classes ${appleCharDifferenceRanges.join(', ')} apart from Chrome's.
export type CharTable = ${Object.keys(charTablesPacked).map(name => `'${name}'`).join(' | ')}
export const charTablesPacked: Record<CharTable, readonly [CharTable | null, string]> = ${charTablesJson}

// Chromium's generated kFastLineBreakTable, a bit per U+0021..U+00FF pair where a line may
// start between them (character_property_data_generator.cc:422-551).
export const blinkLinePairsPacked = '${packTable(blinkPairs)}'

// WebKit's LineBreakTable, BreakablePositions.cpp:42-269.
export const webkitLinePairsPacked = '${packTable(webkitPairs)}'

// libicucore's quotation remaps by locale name (apple-rbbi.cpp:406-487): a code point, then
// 0 for the category of U+007B or 1 for U+007D. A locale without an entry takes its parent's.
export const appleQuoteRemaps: Record<string, readonly number[]> = ${remapsJson}

// Firefox's baked ICU4X line data: a small CodePointTrie of Line_Break values (icu_collections
// 2.1.1 codepointtrie), with the index as u16 little-endian, and the BreakState byte of each pair
// of properties (icu_segmenter 2.1.2 src/provider/mod.rs:288-310).
export const geckoLineTrieHighStart = ${geckoLineField('high_start')}
export const geckoLinePropertyCount = ${geckoLinePropertyCount}
export const geckoLineLastCodepointProperty = ${geckoLineField('last_codepoint_property')}
export const geckoLineEotProperty = ${geckoLineField('eot_property')}
export const geckoLineTrieIndexPacked = '${packTable(geckoLineIndex)}'
export const geckoLineTrieDataPacked = '${packTable(geckoLineData)}'
export const geckoLineBreakStatesPacked = '${packTable(geckoLineStates)}'

// icu_properties 2.1.2's Bidi_Class other than L, and its East_Asian_Width H (2), F (3) and W (5),
// in ICU4C numbering, as flat [start - previous end - 1, end - start, value] triples of u32
// little-endian.
export const geckoBidiClassRangesPacked = '${packTable(new Uint8Array(Uint32Array.from(geckoBidiClassRanges).buffer))}'
export const geckoEastAsianWidthRangesPacked = '${packTable(new Uint8Array(Uint32Array.from(geckoEastAsianWidthRanges).buffer))}'

// unicode-bidi's bracket pairs (Unicode 15): [opening, closing, normalized opening or 0] as u32
// little-endian.
export const geckoBidiPairsPacked = '${packTable(new Uint8Array(Uint32Array.from(geckoBidiPairs).buffer))}'

`

const summary = [
  `line tables packed ${Object.entries(lineTablesPacked).map(([table, [reference, data]]) => `${table} ${data.length} B${reference === null ? '' : ` against ${reference}`}`).join(', ')}`,
  `character tables packed ${Object.entries(charTablesPacked).map(([table, [reference, data]]) => `${table} ${data.length} B${reference === null ? '' : ` against ${reference}`}`).join(', ')}`,
  `pair tables differ in ${differingPairs} pairs`,
  `quotation remaps ${Object.keys(appleQuoteRemaps).length} of ${ownRemaps.size} locales (${gzipSize(remapsJson)} B gzipped)`,
  `Firefox line data ${geckoLineIndex.length + geckoLineData.length + geckoLineStates.length} B`,
  `Firefox properties ${gzipSize(geckoPropertiesJson)} B gzipped`,
  `module ${nextSource.length} B, ${gzipSize(nextSource)} B gzipped`,
].join('; ')

if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== nextSource) throw new Error(`Generated engine break data is stale: ${outputPath}`)
  console.log(`Generated engine break data is up to date: ${summary}.`)
} else {
  await Bun.write(outputPath, nextSource)
  console.log(`Wrote ${outputPath}: ${summary}.`)
}
