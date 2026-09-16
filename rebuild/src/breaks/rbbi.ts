// Forward iterator over ICU4C compiled rule-based break data (.brk), without dictionary engines. Blink (Chromium ICU
// 78.2 data from Chrome 153's icudtl.dat) and WebKit (macOS 27 libicucore 78.1 tables dumped with
// ubrk_getBinaryRules) both run through it.
//
// Ported from the groundwork's runtime/rbbi.ts, which follows ICU 78.2 as vendored in Chromium 152, cited as
// file:line under third_party/icu/source/common. Upstream ICU 78.3's rbbi.cpp, rbbi_cache.cpp, rbbidata.*, ucptrie.*
// and utext.cpp are byte-identical to those files. Apple's category override loop is from Apple ICU-76142.5.1.200
// rbbi.cpp:1061-1084 and was checked against libicucore 78.1 with 1.7M probes (specs/webkit-canvas.md §2.6).
//
// Deliberate differences from ICU:
// - Forward iteration from the start of the text only: no following(), preceding(), isBoundary() and no boundary
//   cache (rbbi_cache.cpp), so the reverse table is never read. Callers that need `following(k)` collect boundaries
//   from the start of the text they gave ICU.
// - No dictionary break engines. dictionaryCharCount counts characters in dictionary categories (rbbi.cpp:854), which
//   is when ICU would hand the segment to a dictionary engine (rbbi_cache.cpp:486-489). Engines handle those segments
//   with the dictionary source of the environment (DESIGN.md §6).
// - 8-bit rows and 8-bit trie values are widened to Uint16Array when parsing.
// - Look-ahead slots start at -1. ICU mallocs them uninitialized (rbbi.cpp:122-129) and never resets them between
//   calls; staleLookAheadReads counts reads of a slot not written in the same call.
// - Input is a JS string read like utext_next32() over UTF-16 (utext.cpp:272-308): unpaired surrogates are code points.

export const DONE = -1

const START_STATE = 1 // rbbi.cpp:48
const STOP_STATE = 0 // rbbi.cpp:51
const ACCEPTING_UNCONDITIONAL = 1 // rbbidata.h:127
const RBBI_BOF_REQUIRED = 2 // rbbidata.h:151
const RBBI_8BITS_ROWS = 4 // rbbidata.h:152

export type BreakRules = {
  catCount: number
  dictCategoriesStart: number
  flags: number
  rowWidth: number
  rows: Uint16Array
  lookAheadResultsSize: number
  statusTable: Int32Array
  trieIndex: Uint16Array
  trieData: Uint16Array
  trieDataLength: number
  trieHighStart: number
}

function copyU16(bytes: Uint8Array, offset: number, count: number): Uint16Array {
  const out = new Uint16Array(count)
  new Uint8Array(out.buffer).set(bytes.subarray(offset, offset + count * 2))
  return out
}

export function parseBreakRules(bytes: Uint8Array): BreakRules {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let base = 0
  // An entry cut from an ICU .dat package starts with a DataHeader (MappedData, then UDataInfo, unicode/udata.h:116-153).
  // rbbidata.cpp:49-62 checks it and skips headerSize bytes. ubrk_getBinaryRules output has no DataHeader.
  if (bytes[2] === 0xda && bytes[3] === 0x27) {
    const headerSize = view.getUint16(0, true)
    if (headerSize < 20 || bytes[8] !== 0 || bytes[9] !== 0 || bytes[12] !== 0x42 || bytes[13] !== 0x72 ||
      bytes[14] !== 0x6b || bytes[15] !== 0x20 || bytes[16] !== 6) {
      throw new Error('expected little-endian ASCII "Brk " data, format version 6')
    }
    base = headerSize
  }
  // RBBIDataHeader, rbbidata.h:67-94. Magic and major version as checked at rbbidata.cpp:69-71, 97.
  if (view.getUint32(base, true) !== 0xb1a0 || bytes[base + 4] !== 6) throw new Error('not RBBI data format 6')
  const catCount = view.getUint32(base + 12, true)
  const fTable = base + view.getUint32(base + 16, true)
  const trie = base + view.getUint32(base + 32, true)
  const statusOffset = base + view.getUint32(base + 48, true)
  const statusLength = view.getUint32(base + 52, true)

  // RBBIStateTable, rbbidata.h:134-148: five uint32 fields, then numStates rows. A row is fAccepting, fLookAhead,
  // fTagsIdx and fNextState[catCount], 8 or 16 bits each (rbbidata.h:98-125).
  const numStates = view.getUint32(fTable, true)
  const rowLen = view.getUint32(fTable + 4, true)
  const dictCategoriesStart = view.getUint32(fTable + 8, true)
  const lookAheadResultsSize = view.getUint32(fTable + 12, true)
  const flags = view.getUint32(fTable + 16, true)
  const rowWidth = 3 + catCount
  const eightBitRows = (flags & RBBI_8BITS_ROWS) !== 0 // rbbi.cpp:739
  if (rowLen !== rowWidth * (eightBitRows ? 1 : 2)) throw new Error('unexpected state table row length')
  const rows = eightBitRows
    ? Uint16Array.from(bytes.subarray(fTable + 20, fTable + 20 + numStates * rowLen))
    : copyU16(bytes, fTable + 20, numStates * rowWidth)

  // UCPTrieHeader, ucptrie_impl.h:24-56, checked as in ucptrie_openFromBinary (ucptrie.cpp:44-68). RBBI asks for
  // UCPTRIE_TYPE_FAST with 8- or 16-bit values (rbbidata.cpp:113-127; enums at unicode/ucptrie.h:125-172).
  if (view.getUint32(trie, true) !== 0x54726933) throw new Error('bad trie signature')
  const options = view.getUint16(trie + 4, true)
  const valueWidth = options & 7 // UCPTRIE_VALUE_BITS_16 = 0, UCPTRIE_VALUE_BITS_8 = 2
  if (((options >> 6) & 3) !== 0 || (options & 0x38) !== 0 || (valueWidth !== 0 && valueWidth !== 2)) {
    throw new Error('expected a fast trie with 8- or 16-bit values')
  }
  const indexLength = view.getUint16(trie + 6, true)
  const trieDataLength = ((options & 0xf000) << 4) | view.getUint16(trie + 8, true) // ucptrie.cpp:74-75
  const trieHighStart = view.getUint16(trie + 14, true) << 9 // UCPTRIE_SHIFT_2, ucptrie.cpp:80
  const trieIndex = copyU16(bytes, trie + 16, indexLength) // ucptrie.cpp:117-119
  const dataStart = trie + 16 + indexLength * 2
  const trieData = valueWidth === 0
    ? copyU16(bytes, dataStart, trieDataLength)
    : Uint16Array.from(bytes.subarray(dataStart, dataStart + trieDataLength))

  const statusTable = new Int32Array(statusLength / 4) // rbbidata.cpp:133-134
  new Uint8Array(statusTable.buffer).set(bytes.subarray(statusOffset, statusOffset + statusLength))

  return {
    catCount, dictCategoriesStart, flags, rowWidth, rows, lookAheadResultsSize, statusTable,
    trieIndex, trieData, trieDataLength, trieHighStart,
  }
}

// UCPTRIE_FAST_GET with fastMax 0xffff (unicode/ucptrie.h:358, 601-620) and ucptrie_internalSmallIndex for a fast trie
// (ucptrie.cpp:161-185).
export function getCategory(r: BreakRules, c: number): number {
  const index = r.trieIndex
  if (c <= 0xffff) return r.trieData[index[c >> 6]! + (c & 0x3f)]!
  if (c >= r.trieHighStart) return r.trieData[r.trieDataLength - 2]!
  const i1 = (c >> 14) + 1020 // UCPTRIE_BMP_INDEX_LENGTH - UCPTRIE_OMITTED_BMP_INDEX_1_LENGTH
  let i3Block = index[index[i1]! + ((c >> 9) & 0x1f)]!
  let i3 = (c >> 4) & 0x1f
  let dataBlock: number
  if ((i3Block & 0x8000) === 0) {
    dataBlock = index[i3Block + i3]!
  } else {
    i3Block = (i3Block & 0x7fff) + (i3 & ~7) + (i3 >> 3)
    i3 &= 7
    dataBlock = (index[i3Block++]! << (2 + 2 * i3)) & 0x30000
    dataBlock |= index[i3Block + i3]!
  }
  return r.trieData[dataBlock + (c & 0xf)]!
}

// Category overrides for single code points, as Apple ICU's setCategoryOverrides installs them for a line iterator
// opened by locale (Apple ICU brkiter.cpp:458-473, rbbi.cpp:397-486). `categories[i]` is the category code point
// `chars[i]` reads as; WebKit derives both from the locale's CLDR delimiters (specs/webkit-canvas.md §2.6).
export type CategoryOverrides = { chars: readonly number[]; categories: readonly number[] }
export const NO_OVERRIDES: CategoryOverrides = { chars: [], categories: [] }

const RUN = 0
const START = 1
const END = 2

export class RuleBreakIterator {
  readonly rules: BreakRules
  readonly overrides: CategoryOverrides
  text = ''
  position = 0
  ruleStatusIndex = 0
  dictionaryCharCount = 0
  staleLookAheadReads = 0
  private readonly lookAheadMatches: Int32Array
  private readonly lookAheadCall: Int32Array
  private call = 0

  constructor(rules: BreakRules, overrides: CategoryOverrides) {
    this.rules = rules
    this.overrides = overrides
    this.lookAheadMatches = new Int32Array(rules.lookAheadResultsSize).fill(-1)
    this.lookAheadCall = new Int32Array(rules.lookAheadResultsSize)
  }

  // setText() then first(): the cache resets to boundary 0 with rule status index 0 (rbbi_cache.cpp:218-225).
  setText(text: string): void {
    this.text = text
    this.position = 0
    this.ruleStatusIndex = 0
  }

  // getRuleStatus(), rbbi.cpp:1049-1058.
  ruleStatus(): number {
    const t = this.rules.statusTable
    const i = this.ruleStatusIndex
    return t[i + t[i]!]!
  }

  // handleNext(), rbbi.cpp:779-952. Returns the next boundary, or DONE at the end of the text.
  next(): number {
    const r = this.rules
    const rows = r.rows
    const width = r.rowWidth
    const dictStart = r.dictCategoriesStart
    const text = this.text
    const length = text.length
    const matches = this.lookAheadMatches
    const overrideChars = this.overrides.chars
    const overrideCategories = this.overrides.categories
    const overrideCount = overrideChars.length
    const call = ++this.call

    this.ruleStatusIndex = 0
    this.dictionaryCharCount = 0
    const initialPosition = this.position
    let result = initialPosition
    if (initialPosition >= length) return DONE // rbbi.cpp:809-813

    let pos = initialPosition
    let c = text.charCodeAt(pos++)
    if ((c & 0xfc00) === 0xd800 && pos < length) {
      const trail = text.charCodeAt(pos)
      if ((trail & 0xfc00) === 0xdc00) { pos++; c = ((c - 0xd800) << 10) + trail - 0xdc00 + 0x10000 }
    }
    let atEnd = false

    let state = START_STATE
    let row = state * width
    let mode = RUN
    let category = 0
    if ((r.flags & RBBI_BOF_REQUIRED) !== 0) { category = 2; mode = START } // rbbi.cpp:823-826

    for (;;) {
      if (atEnd) { // rbbi.cpp:832-843
        if (mode === END) break
        mode = END
        category = 1
      }
      if (mode === RUN) { // rbbi.cpp:850-855; override loop from Apple rbbi.cpp:1061-1084
        let overridden = false
        for (let i = 0; i < overrideCount; i++) {
          if (c === overrideChars[i]) { category = overrideCategories[i]!; overridden = true; break }
        }
        if (!overridden) {
          category = getCategory(r, c)
          if (category >= dictStart) this.dictionaryCharCount++
        }
      }
      state = rows[row + 3 + category]! // rbbi.cpp:874-877
      row = state * width

      const accepting = rows[row]! // rbbi.cpp:880-896
      if (accepting === ACCEPTING_UNCONDITIONAL) {
        if (mode !== START) result = pos
        this.ruleStatusIndex = rows[row + 2]!
      } else if (accepting > ACCEPTING_UNCONDITIONAL) {
        const lookAheadResult = matches[accepting]!
        if (lookAheadResult >= 0) {
          if (this.lookAheadCall[accepting] !== call) this.staleLookAheadReads++
          this.ruleStatusIndex = rows[row + 2]!
          this.position = lookAheadResult
          return lookAheadResult
        }
      }

      const rule = rows[row + 1]! // rbbi.cpp:904-910
      if (rule > ACCEPTING_UNCONDITIONAL) {
        matches[rule] = pos
        this.lookAheadCall[rule] = call
      }

      if (state === STOP_STATE) break // rbbi.cpp:912-917

      if (mode === RUN) { // rbbi.cpp:923-929
        if (pos >= length) {
          atEnd = true
        } else {
          c = text.charCodeAt(pos++)
          if ((c & 0xfc00) === 0xd800 && pos < length) {
            const trail = text.charCodeAt(pos)
            if ((trail & 0xfc00) === 0xdc00) { pos++; c = ((c - 0xd800) << 10) + trail - 0xdc00 + 0x10000 }
          }
        }
      } else if (mode === START) {
        mode = RUN
      }
    }

    if (result === initialPosition) { // rbbi.cpp:937-942
      pos = initialPosition + 1
      if ((text.charCodeAt(initialPosition) & 0xfc00) === 0xd800 && pos < length &&
        (text.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++
      result = pos
      this.ruleStatusIndex = 0
    }
    this.position = result // rbbi.cpp:945
    return result
  }
}

// A boundary ICU reports, and whether ICU would give the segment ending there to a dictionary engine.
export type RuleBoundary = { offset: number; dictionarySegment: boolean }

// Every boundary after 0 over the whole text, as ubrk_first() then ubrk_next() until UBRK_DONE report them.
export function ruleBoundaries(iterator: RuleBreakIterator, text: string): RuleBoundary[] {
  iterator.setText(text)
  const out: RuleBoundary[] = []
  for (let b = iterator.next(); b !== DONE; b = iterator.next()) {
    out.push({ offset: b, dictionarySegment: iterator.dictionaryCharCount > 0 })
  }
  return out
}
