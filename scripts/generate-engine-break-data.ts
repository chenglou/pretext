// Generates src/generated/engine-break-data.ts, the tables behind Chrome's and Safari's
// break scans in src/line-breaks.ts, from the engine files in scripts/engine-data/, and
// checks each table against its source. Refresh those files by hand when a browser's
// tables change, then run this. `--check` compares instead of writing.
//
// chrome-153/, from Chrome 153.0.8010.37:
// - line_normal.brk: the brkitr/line_normal.brk entry of Chrome's icudtl.dat (ICU 78.2).
// - break_iterator_data_inline_header.h: the header Chromium's build generates for
//   kFastLineBreakTable (character_property_data_generator.cc:422-551).
// safari-26.5.2/, from Safari 26.5.2 on macOS 26.5.2:
// - line.brk, line_normal.brk, line_cj.brk: brkitr entries of /usr/share/icu/icudt78l.dat,
//   the data libicucore 78.1 reads.
// - BreakablePositions.cpp: WebKit's checked-in pair table (safari-7624.2.5.11-branch).
// - locales.json: for every locale libicucore lists, the line table ubrk_open(UBRK_LINE)
//   opens and the four quotation delimiters ulocdata_getDelimiter reports.
// - quotation.json: the code points libicucore gives Line_Break=QU.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { getBreakLanguage, getCategory, parseBreakRules, withCategoryOverrides, type BreakRules } from '../src/line-breaks.ts'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(scriptsDir, 'engine-data')
const outputPath = join(scriptsDir, '..', 'src', 'generated', 'engine-break-data.ts')
const readData = (path: string) => new Uint8Array(readFileSync(join(dataDir, path)))
const readText = (path: string) => readFileSync(join(dataDir, path), 'utf8')
const gzipSize = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

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

// Overrides that make table A's categories stand for table B's: each A category pairs with
// the B category most of its code points have, and each B category with the A category
// most of its code points pair with. Code points whose B category pairs elsewhere take it.
function deriveOverrides(a: BreakRules, b: BreakRules): Map<number, number> {
  const count = new Map<number, number>()
  for (let c = 0; c <= 0x10ffff; c++) {
    const key = getCategory(a, c) * 65536 + getCategory(b, c)
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const majorityB = new Map<number, [number, number]>()
  for (const [key, n] of count) {
    const m = majorityB.get(key >> 16)
    if (m === undefined || n > m[1]) majorityB.set(key >> 16, [key & 0xffff, n])
  }
  const targetA = new Map<number, [number, number]>()
  for (const [categoryA, [categoryB, n]] of majorityB) {
    const t = targetA.get(categoryB)
    if (t === undefined || n > t[1]) targetA.set(categoryB, [categoryA, n])
  }
  const overrides = new Map<number, number>()
  for (let c = 0; c <= 0x10ffff; c++) {
    const categoryA = getCategory(a, c)
    const categoryB = getCategory(b, c)
    if (majorityB.get(categoryA)![0] === categoryB) continue
    const t = targetA.get(categoryB)
    if (t === undefined) throw new Error(`No category of A pairs with B category ${categoryB}`)
    if (t[0] !== categoryA) overrides.set(c, t[0])
  }
  return overrides
}

function statusVector(rules: BreakRules, index: number): string {
  return Array.from(rules.statusTable.subarray(index + 1, index + 1 + rules.statusTable[index]!)).join(',')
}

// Walks the product of both state machines over every pair of categories a code point has
// in A and B, from the start state. The tables behave the same for every input when no
// reachable pair of states differs in stopping, accepting, look-ahead slots or rule
// status, and dictionary categories agree.
function findDifferences(a: BreakRules, b: BreakRules): string[] {
  const EOF_PAIR = 1 * 65536 + 1
  const BOF_PAIR = 2 * 65536 + 2
  const pairSet = new Set<number>()
  for (let c = 0; c <= 0x10ffff; c++) pairSet.add(getCategory(a, c) * 65536 + getCategory(b, c))
  const pairs = Array.from(pairSet).sort((x, y) => x - y)
  const differences: string[] = []
  for (const pair of pairs) {
    if (((pair >> 16) >= a.dictCategoriesStart) !== ((pair & 0xffff) >= b.dictCategoriesStart)) differences.push(`dictionary ${pair}`)
  }
  const slotAToB = new Map<number, number>()
  const slotBToA = new Map<number, number>()
  const mapSlot = (x: number, y: number): boolean => {
    const mappedY = slotAToB.get(x)
    const mappedX = slotBToA.get(y)
    if (mappedY === undefined && mappedX === undefined) {
      slotAToB.set(x, y)
      slotBToA.set(y, x)
      return true
    }
    return mappedY === y && mappedX === x
  }
  const seen = new Set<number>([1 * 65536 + 1])
  const queue: number[] = []
  const arrive = (stateA: number, stateB: number, via: number): void => {
    const rowA = stateA * a.rowWidth
    const rowB = stateB * b.rowWidth
    const stops = (stateA === 0) !== (stateB === 0)
    if (stops) differences.push(`stop ${stateA} ${stateB}`)
    const acceptingA = a.rows[rowA]!
    const acceptingB = b.rows[rowB]!
    if ((acceptingA === 0) !== (acceptingB === 0) || (acceptingA === 1) !== (acceptingB === 1) || (acceptingA > 1 && !mapSlot(acceptingA, acceptingB))) {
      differences.push(`accepting ${stateA} ${stateB}`)
    }
    const lookAheadA = a.rows[rowA + 1]!
    const lookAheadB = b.rows[rowB + 1]!
    if ((lookAheadA === 0) !== (lookAheadB === 0) || (lookAheadA > 1 && !mapSlot(lookAheadA, lookAheadB))) {
      differences.push(`look-ahead ${stateA} ${stateB}`)
    }
    if (acceptingA !== 0 && acceptingB !== 0 && statusVector(a, a.rows[rowA + 2]!) !== statusVector(b, b.rows[rowB + 2]!)) {
      differences.push(`status ${stateA} ${stateB}`)
    }
    const key = stateA * 65536 + stateB
    if (!seen.has(key) && via !== EOF_PAIR && stateA !== 0 && stateB !== 0 && !stops) {
      seen.add(key)
      queue.push(key)
    }
  }
  if (((a.flags & 2) !== 0) !== ((b.flags & 2) !== 0)) differences.push('flags')
  if ((a.flags & 2) !== 0) arrive(a.rows[a.rowWidth + 3 + 2]!, b.rows[b.rowWidth + 3 + 2]!, BOF_PAIR)
  else queue.push(1 * 65536 + 1)
  for (let q = 0; q < queue.length && differences.length === 0; q++) {
    const stateA = queue[q]! >> 16
    const stateB = queue[q]! & 0xffff
    for (const pair of pairs) arrive(a.rows[stateA * a.rowWidth + 3 + (pair >> 16)]!, b.rows[stateB * b.rowWidth + 3 + (pair & 0xffff)]!, pair)
    arrive(a.rows[stateA * a.rowWidth + 3 + 1]!, b.rows[stateB * b.rowWidth + 3 + 1]!, EOF_PAIR)
  }
  return differences
}

// Pair tables.
const blinkPairs = parsePairTable(readText('chrome-153/break_iterator_data_inline_header.h'), 'kFastLineBreakTable[')
const webkitPairs = parsePairTable(readText('safari-26.5.2/BreakablePositions.cpp'), 'LineBreakTable::breakTable')
let differingPairs = 0
for (let i = 0; i < blinkPairs.length; i++) for (let k = 0; k < 8; k++) if (((blinkPairs[i]! ^ webkitPairs[i]!) >> k) & 1) differingPairs++

// Chromium's line table.
const chromiumRulesBytes = withoutDataHeader(readData('chrome-153/line_normal.brk'))
const chromiumCompact = compactBreakRules(chromiumRulesBytes)
const chromiumRules = parseBreakRules(chromiumRulesBytes)
if (!sameRules(chromiumRules, parseBreakRules(chromiumCompact))) throw new Error('The compact line_normal.brk parses differently')

// libicucore's line tables as overrides on Chromium's.
const appleLineOverrides: Record<string, number[]> = {}
for (const table of ['line', 'line_normal', 'line_cj']) {
  const appleRules = parseBreakRules(withoutDataHeader(readData(`safari-26.5.2/${table}.brk`)))
  const overrides = deriveOverrides(chromiumRules, appleRules)
  const codePoints = Array.from(overrides.keys()).sort((x, y) => x - y)
  const ranges: number[] = []
  for (let i = 0; i < codePoints.length; i++) {
    const c = codePoints[i]!
    const category = overrides.get(c)!
    const n = ranges.length
    if (n > 0 && ranges[n - 2] === c - 1 && ranges[n - 1] === category) ranges[n - 2] = c
    else ranges.push(c, c, category)
  }
  const patched = withCategoryOverrides(chromiumRules, ranges)
  for (let c = 0; c <= 0x10ffff; c++) {
    if (getCategory(patched, c) !== (overrides.get(c) ?? getCategory(chromiumRules, c))) throw new Error(`Patched ${table} category wrong at U+${c.toString(16)}`)
  }
  const differences = findDifferences(patched, appleRules)
  if (differences.length > 0) throw new Error(`Patched ${table} differs from ${table}.brk: ${differences.slice(0, 5).join('; ')}`)
  appleLineOverrides[table] = ranges
}

// Quotation remaps per locale, setCategoryOverrides in apple-rbbi.cpp:406-487.
const quotation = new Set(JSON.parse(readText('safari-26.5.2/quotation.json')) as number[])
const locales = JSON.parse(readText('safari-26.5.2/locales.json')) as Record<string, [string, number, number, number, number]>
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

const chromiumBase64 = base64(chromiumCompact)
const overridesJson = JSON.stringify(appleLineOverrides)
const remapsJson = JSON.stringify(appleQuoteRemaps)
const nextSource = `// Generated by scripts/generate-engine-break-data.ts from scripts/engine-data/.
// Do not edit by hand. Regenerate with \`bun run generate:engine-break-data\`.

// Chrome 153's line_normal.brk (ICU 78.2), without its reverse table and rule source.
export const chromiumLineNormalBase64 = '${chromiumBase64}'

// libicucore 78.1's line.brk, line_normal.brk and line_cj.brk as [start, end, category]
// overrides on chromiumLineNormalBase64, each checked to behave the same for every input.
export const appleLineOverrides: Record<'line' | 'line_normal' | 'line_cj', readonly number[]> = ${overridesJson}

// Chromium's generated kFastLineBreakTable, a bit per U+0021..U+00FF pair where a line may
// start between them (character_property_data_generator.cc:422-551).
export const blinkLinePairsBase64 = '${base64(blinkPairs)}'

// WebKit's LineBreakTable, BreakablePositions.cpp:42-269.
export const webkitLinePairsBase64 = '${base64(webkitPairs)}'

// libicucore's quotation remaps by locale name (apple-rbbi.cpp:406-487): a code point, then
// 0 for the category of U+007B or 1 for U+007D. A locale without an entry takes its parent's.
export const appleQuoteRemaps: Record<string, readonly number[]> = ${remapsJson}
`

const summary = [
  `line_normal.brk ${chromiumCompact.length} B compact, ${gzipSize(chromiumBase64)} B gzipped as base64`,
  `overrides ${Object.entries(appleLineOverrides).map(([table, ranges]) => `${table} ${ranges.length / 3} ranges`).join(', ')} (${gzipSize(overridesJson)} B gzipped)`,
  `pair tables differ in ${differingPairs} pairs`,
  `quotation remaps ${Object.keys(appleQuoteRemaps).length} of ${ownRemaps.size} locales (${gzipSize(remapsJson)} B gzipped)`,
  `module ${nextSource.length} B, ${gzipSize(nextSource)} B gzipped`,
].join('; ')

if (process.argv.includes('--check')) {
  if (readFileSync(outputPath, 'utf8') !== nextSource) throw new Error(`Generated engine break data is stale: ${outputPath}`)
  console.log(`Generated engine break data is up to date: ${summary}.`)
} else {
  await Bun.write(outputPath, nextSource)
  console.log(`Wrote ${outputPath}: ${summary}.`)
}
