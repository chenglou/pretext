// Break opportunities as Chrome and Safari find them: ports of Blink's and WebKit's
// line-break scans over their own pair tables and ICU line rules, which
// scripts/generate-engine-break-data.ts writes to src/generated/engine-break-data.ts.
//
// Sources, cited as file:line:
// - ICU 78.2 as vendored in Chromium 152, under third_party/icu/source/common. Chrome
//   153 runs the same code. apple-rbbi.cpp and apple-brkiter.cpp are Apple's
//   ICU-76142.5.1.200 sources, behind libicucore 78.1 on macOS 26.5.2.
// - Blink in Chromium 152, under third_party/blink/renderer/platform/text/:
//   tbi.cc = text_break_iterator.cc, tbi.h = text_break_iterator.h,
//   tbi_icu.cc = text_break_iterator_icu.cc, gen.cc = character_property_data_generator.cc.
// - WebKit safari-7624.2.5.11-branch (Safari 26.5.2), under Source/:
//   BP.h = WebCore/rendering/BreakablePositions.h,
//   IIB = WebCore/layout/formattingContexts/inline/InlineItemsBuilder.cpp,
//   IFU = WebCore/layout/formattingContexts/inline/InlineFormattingUtils.cpp,
//   TU = WebCore/layout/formattingContexts/inline/text/TextUtil.cpp,
//   TBI.h = WTF/wtf/text/TextBreakIterator.h, TBIICU.h = WTF/wtf/text/icu/TextBreakIteratorICU.h.
//
// Deliberate differences:
// - ICU runs forward from the start of the text, without its boundary cache, reverse
//   table or dictionary engines. Inside runs of Thai, Lao, Khmer and Myanmar letters,
//   Intl.Segmenter word boundaries stand in for the dictionaries.
// - Blink restarts ICU at each line start, which drops the context before the line
//   (tbi.h:159-163, tbi_icu.cc:771-810). These scans read each text once.
// - Chrome opens line_normal_cj.brk on zh pages, and on pages without a language under
//   a Chinese UI (tbi_icu.cc:58-83). Only line_normal.brk ships.
// - WebKit splits items where bidi levels change (IIB:588-679), and swaps a Han-script
//   locale for the user's first Chinese language (FontDescription.cpp:75-84, 108-114).
//   Pretext resolves no bidi levels and takes the page language as it is.

import {
  appleLineOverrides,
  appleQuoteRemaps,
  blinkLinePairsBase64,
  chromiumLineNormalBase64,
  webkitLinePairsBase64,
} from './generated/engine-break-data.js'

// Page languages whose line-break rules differ in some engine. Every other
// language, an empty or missing one, and no document read as root.
export type BreakLanguage = 'root' | 'ja' | 'ko' | 'zh'

// The primary language subtag, ASCII case-insensitively, up to `-`, `_` or the
// end. No allocation: preparation calls this once per text.
export function getBreakLanguage(tag: string | null): BreakLanguage {
  if (tag === null || tag.length < 2) return 'root'
  if (tag.length > 2 && tag.charCodeAt(2) !== 0x2D && tag.charCodeAt(2) !== 0x5F) return 'root'
  const first = tag.charCodeAt(0) | 0x20
  const second = tag.charCodeAt(1) | 0x20
  if (first === 0x6A && second === 0x61) return 'ja'
  if (first === 0x6B && second === 0x6F) return 'ko'
  if (first === 0x7A && second === 0x68) return 'zh'
  return 'root'
}

export function decodeBase64(s: string): Uint8Array {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// --- ICU's rule-based iterator over compiled line rules ---

const DONE = -1
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

// Little-endian data, read on a little-endian platform.
function copyU16(bytes: Uint8Array, offset: number, count: number): Uint16Array {
  const out = new Uint16Array(count)
  new Uint8Array(out.buffer).set(bytes.subarray(offset, offset + count * 2))
  return out
}

// Compiled rules without the data package header: RBBIDataHeader (rbbidata.h:67-94),
// checked as rbbidata.cpp:69-71 does, then the tables it points to.
export function parseBreakRules(bytes: Uint8Array): BreakRules {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0xb1a0 || bytes[4] !== 6) throw new Error('Expected ICU break rules, format 6')
  const catCount = view.getUint32(12, true)
  const table = view.getUint32(16, true)
  const trie = view.getUint32(32, true)
  const statusOffset = view.getUint32(48, true)
  const statusLength = view.getUint32(52, true)

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
    : copyU16(bytes, table + 20, numStates * rowWidth)

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

// UCPTRIE_FAST_GET with fastMax 0xffff (unicode/ucptrie.h:358, 601-620) and
// ucptrie_internalSmallIndex for a fast trie (ucptrie.cpp:161-185).
export function getCategory(rules: BreakRules, c: number): number {
  const index = rules.trieIndex
  if (c <= 0xffff) return rules.trieData[index[c >> 6]! + (c & 0x3f)]!
  if (c >= rules.trieHighStart) return rules.trieData[rules.trieDataLength - 2]!
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
  return rules.trieData[dataBlock + (c & 0xf)]!
}

// The data block of index-3 entry k in a fast trie (ucptrie.cpp:161-185).
function getDataBlock(index: number[], i3Block: number, k: number): number {
  if ((i3Block & 0x8000) === 0) return index[i3Block + k]!
  let at = (i3Block & 0x7fff) + (k & ~7) + (k >> 3)
  const j = k & 7
  return ((index[at++]! << (2 + 2 * j)) & 0x30000) | index[at + j]!
}

// Writes [start, end, category] triples into copies of the trie blocks that hold those
// code points, so blocks shared with other code points keep their values: 64-unit BMP
// data blocks, 32-entry index-2 and index-3 blocks and 16-unit supplementary data blocks
// (unicode/ucptrie.h:358, 601-620). trieDataLength keeps pointing at the original high
// value (ucptrie.cpp:74-81).
export function withCategoryOverrides(base: BreakRules, ranges: readonly number[]): BreakRules {
  const index = Array.from(base.trieIndex)
  const data = Array.from(base.trieData)
  const bmpCopies = new Map<number, number>()
  const i2Copies = new Map<number, number>()
  const i3Copies = new Map<number, number>()
  const dataCopies = new Map<number, number>()
  for (let r = 0; r < ranges.length; r += 3) {
    const category = ranges[r + 2]!
    for (let c = ranges[r]!; c <= ranges[r + 1]!; c++) {
      if (c <= 0xffff) {
        let block = bmpCopies.get(c >> 6)
        if (block === undefined) {
          block = data.length
          const from = index[c >> 6]!
          for (let k = 0; k < 64; k++) data.push(data[from + k]!)
          index[c >> 6] = block
          bmpCopies.set(c >> 6, block)
        }
        data[block + (c & 0x3f)] = category
        continue
      }
      const i1 = (c >> 14) + 1020
      let i2 = i2Copies.get(c >> 14)
      if (i2 === undefined) {
        i2 = index.length
        const from = index[i1]!
        for (let k = 0; k < 32; k++) index.push(index[from + k]!)
        index[i1] = i2
        i2Copies.set(c >> 14, i2)
      }
      const i2Entry = i2 + ((c >> 9) & 0x1f)
      let i3 = i3Copies.get(c >> 9)
      if (i3 === undefined) {
        i3 = index.length
        const from = index[i2Entry]!
        for (let k = 0; k < 32; k++) {
          const block = getDataBlock(index, from, k)
          if (block > 0xffff) throw new Error('Override data block does not fit a 16-bit index-3 entry')
          index.push(block)
        }
        index[i2Entry] = i3
        i3Copies.set(c >> 9, i3)
      }
      const i3Entry = i3 + ((c >> 4) & 0x1f)
      let block = dataCopies.get(c >> 4)
      if (block === undefined) {
        block = data.length
        const from = index[i3Entry]!
        for (let k = 0; k < 16; k++) data.push(data[from + k]!)
        index[i3Entry] = block
        dataCopies.set(c >> 4, block)
      }
      data[block + (c & 0xf)] = category
    }
  }
  if (data.length > 0xffff || index.length > 0x7fff) throw new Error('Override blocks do not fit the trie')
  return { ...base, trieIndex: Uint16Array.from(index), trieData: Uint16Array.from(data) }
}

const RUN = 0
const START = 1
const END = 2

class RuleBreakIterator {
  readonly rules: BreakRules
  // Characters in dictionary categories since the last boundary (rbbi.cpp:854), which
  // is when ICU would hand the segment to a dictionary (rbbi_cache.cpp:486-489).
  dictionaryCharCount = 0
  private text = ''
  private position = 0
  // ICU allocates the look-ahead slots uninitialized (rbbi.cpp:122-129) and never
  // resets them between calls. These start at -1.
  private readonly lookAheadMatches: Int32Array
  private readonly overrideChars: readonly number[]
  private readonly overrideCategories: readonly number[]

  constructor(rules: BreakRules, overrideChars: readonly number[] = [], overrideCategories: readonly number[] = []) {
    this.rules = rules
    this.lookAheadMatches = new Int32Array(rules.lookAheadResultsSize).fill(-1)
    this.overrideChars = overrideChars
    this.overrideCategories = overrideCategories
  }

  setText(text: string): void {
    this.text = text
    this.position = 0
  }

  // handleNext(), rbbi.cpp:779-952: the next boundary, or DONE at the end of the text.
  // The text is read like utext_next32() over UTF-16 (utext.cpp:272-308), with
  // unpaired surrogates as code points.
  next(): number {
    const r = this.rules
    const rows = r.rows
    const width = r.rowWidth
    const dictionaryStart = r.dictCategoriesStart
    const text = this.text
    const length = text.length
    const matches = this.lookAheadMatches
    const overrideChars = this.overrideChars
    const overrideCount = overrideChars.length

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
      if (mode === RUN) { // rbbi.cpp:850-855, with Apple's overrides (apple-rbbi.cpp:1061-1084)
        let overridden = false
        for (let i = 0; i < overrideCount; i++) {
          if (c === overrideChars[i]) { category = this.overrideCategories[i]!; overridden = true; break }
        }
        if (!overridden) {
          category = getCategory(r, c)
          if (category >= dictionaryStart) this.dictionaryCharCount++
        }
      }
      state = rows[row + 3 + category]! // rbbi.cpp:874-877
      row = state * width

      const accepting = rows[row]! // rbbi.cpp:880-896
      if (accepting === ACCEPTING_UNCONDITIONAL) {
        if (mode !== START) result = pos
      } else if (accepting > ACCEPTING_UNCONDITIONAL) {
        const lookAheadResult = matches[accepting]!
        if (lookAheadResult >= 0) {
          this.position = lookAheadResult
          return lookAheadResult
        }
      }

      const rule = rows[row + 1]! // rbbi.cpp:904-910
      if (rule > ACCEPTING_UNCONDITIONAL) matches[rule] = pos

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
    }
    this.position = result // rbbi.cpp:945
    return result
  }
}

// --- Line tables ---

type AppleLineTable = 'line' | 'line_normal' | 'line_cj'

let chromiumLineRules: BreakRules | null = null
const appleLineRules = new Map<AppleLineTable, BreakRules>()

function getChromiumLineRules(): BreakRules {
  return chromiumLineRules ??= parseBreakRules(decodeBase64(chromiumLineNormalBase64))
}

// libicucore's tables are Chromium's line_normal.brk with category overrides, which the
// generator checks behave the same for every input.
function getAppleLineRules(table: AppleLineTable): BreakRules {
  let rules = appleLineRules.get(table)
  if (rules === undefined) {
    rules = withCategoryOverrides(getChromiumLineRules(), appleLineOverrides[table])
    appleLineRules.set(table, rules)
  }
  return rules
}

// Line_Break=SA for one code point: the line rules' dictionary categories.
function isComplexContext(rules: BreakRules, c: number): boolean {
  return getCategory(rules, c) >= rules.dictCategoriesStart
}

// flags[b] = 1 at every ICU line boundary 0 < b <= text.length, and at Intl.Segmenter
// word boundaries strictly inside each run of dictionary characters of a segment that
// ICU would give to a dictionary. The line rules say $dictionary = [$SA].
function markLineBoundaries(iterator: RuleBreakIterator, text: string, flags: Uint8Array, wordSegmenter: Intl.Segmenter): void {
  iterator.setText(text)
  for (let start = 0, b = iterator.next(); b !== DONE; start = b, b = iterator.next()) {
    flags[b] = 1
    if (iterator.dictionaryCharCount > 0) markDictionaryWords(iterator.rules, text, start, b, flags, wordSegmenter)
  }
}

function markDictionaryWords(rules: BreakRules, text: string, start: number, end: number, flags: Uint8Array, wordSegmenter: Intl.Segmenter): void {
  let runStart = -1
  for (let i = start; i <= end;) {
    let dictionary = false
    let size = 1
    if (i < end) {
      let c = text.charCodeAt(i)
      if ((c & 0xfc00) === 0xd800 && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        c = ((c - 0xd800) << 10) + text.charCodeAt(i + 1) - 0xdc00 + 0x10000
        size = 2
      }
      dictionary = isComplexContext(rules, c)
    }
    if (dictionary) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      if (i - runStart > 1) {
        for (const segment of wordSegmenter.segment(text.slice(runStart, i))) {
          if (segment.index > 0) flags[runStart + segment.index] = 1
        }
      }
      runStart = -1
    }
    i += size
  }
}

const SPACE = 0x20
const TAB = 0x09
const LF = 0x0a
const ZWSP = 0x200b
const IDEOGRAPHIC_SPACE = 0x3000

// --- Blink ---

let blinkPairs: Uint8Array | null = null
let blinkIterator: RuleBreakIterator | null = null
// General category bits per UTF-16 code unit, filled on first use: 1 known, 2 letter
// or number, 4 mark.
let categoryBits: Uint8Array | null = null
const letterOrNumberRe = /^[\p{L}\p{N}]$/u
const markRe = /^\p{M}$/u

const NO_BREAK = 0
const CAN_BREAK = 1
const UNKNOWN = 2

// tbi.h:203-205
function isBlinkBreakableSpace(c: number): boolean {
  return c === SPACE || c === TAB || c === LF
}

// Context::ShouldBreakFast, tbi.cc:216-260, with soft hyphens enabled (hyphens: manual).
// The pair table is Chromium's generated kFastLineBreakTable for U+0021..U+00FF
// (gen.cc:422-551).
function shouldBreakFast(pairs: Uint8Array, lastLast: number, last: number, ch: number): number {
  if (last < 0x21 || ch < 0x21) return NO_BREAK
  if (last === 0x2d) {
    if (ch <= 0x7f) {
      if (ch >= 0x30 && ch <= 0x39) {
        const lower = lastLast | 0x20
        return (lastLast >= 0x30 && lastLast <= 0x39) || (lower >= 0x61 && lower <= 0x7a) ? CAN_BREAK : NO_BREAK
      }
    } else {
      return UNKNOWN
    }
  }
  if (last <= 0xff && ch <= 0xff) {
    const x = ch - 0x21
    return (pairs[(last - 0x21) * 28 + (x >> 3)]! & (1 << (x & 7))) !== 0 ? CAN_BREAK : NO_BREAK
  }
  return UNKNOWN
}

function getCategoryBits(unit: number): number {
  const bits = categoryBits ??= new Uint8Array(0x10000)
  let value = bits[unit]!
  if (value === 0) {
    const s = String.fromCharCode(unit)
    value = 1 | (letterOrNumberRe.test(s) ? 2 : 0) | (markRe.test(s) ? 4 : 0)
    bits[unit] = value
  }
  return value
}

// ShouldKeepAfterKeepAll, tbi.cc:157-165, per UTF-16 code unit.
function shouldKeepAfterKeepAll(rules: BreakRules, lastLast: number, last: number, ch: number): boolean {
  const pre = (getCategoryBits(last) & 4) !== 0 ? lastLast : last
  return (getCategoryBits(pre) & 2) !== 0 && !isComplexContext(rules, pre) &&
    (getCategoryBits(ch) & 2) !== 0 && !isComplexContext(rules, ch)
}

// Where a line may start in text Blink collapsed as Pretext does: flags[i] = 1 for
// 0 < i < text.length. NextBreakablePosition (tbi.cc:270-387) for LineBreakType kNormal
// or kKeepAll and BreakSpaceType kAfterSpaceRun, asked at every offset. Each answer
// depends only on the two units before the offset, the unit at it, and whether ICU has
// a boundary there.
export function getBlinkLineBreaks(text: string, keepAll: boolean, wordSegmenter: Intl.Segmenter): Uint8Array {
  const length = text.length
  const breaks = new Uint8Array(length + 1)
  if (length < 2) return breaks
  const pairs = blinkPairs ??= decodeBase64(blinkLinePairsBase64)
  const iterator = blinkIterator ??= new RuleBreakIterator(getChromiumLineRules())
  let icu: Uint8Array | null = null
  let lastLast = 0
  let last = text.charCodeAt(0)
  for (let i = 1; i < length; lastLast = last, last = text.charCodeAt(i), i++) {
    const ch = text.charCodeAt(i)
    if (isBlinkBreakableSpace(ch)) continue // tbi.cc:284-291
    if (isBlinkBreakableSpace(last)) { breaks[i] = 1; continue }
    const fast = shouldBreakFast(pairs, lastLast, last, ch)
    if (fast === CAN_BREAK) { breaks[i] = 1; continue } // tbi.cc:305-309
    if (keepAll && shouldKeepAfterKeepAll(iterator.rules, lastLast, last, ch)) continue // tbi.cc:338-344
    if (fast === NO_BREAK) continue // tbi.cc:346-348
    // tbi.cc:350-383: ICU's first boundary after i - 1 is i exactly when i is a boundary,
    // since the unit before it isn't a space here.
    if (icu === null) {
      icu = new Uint8Array(length + 1)
      markLineBoundaries(iterator, text, icu, wordSegmenter)
    }
    if (icu[i] === 1) breaks[i] = 1
  }
  return breaks
}

// --- WebKit ---

// BreakClass, BP.h:78-96.
const AL = 1
const ID = 2
const CM = 4
const OP = 8
const CP = 16
const CL = 32
const GL = 64
const QU = 128
const SP = 256
const WEIRD = 32768

let webkitPairs: Uint8Array | null = null
const webkitIterators = new Map<string, RuleBreakIterator>()

// BP.h:121-133 with NoBreakSpaceBehavior::Normal.
function isWebKitBreakableSpace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB
}

function isASCIIDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39
}

function isASCIIAlpha(c: number): boolean {
  const lower = c | 0x20
  return lower >= 0x61 && lower <= 0x7a
}

// BP.h:313-518. The 0x3000..0x303F switch reads only the low five bits, so it answers for
// 0x3020..0x303F too.
function classify(c: number): number {
  switch (c >> 7) {
    case 0:
      switch (c >> 4) {
        case 0: return WEIRD
        case 1: return CM
        case 2: return c === 0x20 ? SP : c === 0x22 || c === 0x27 ? QU : c === 0x28 ? OP : c === 0x29 ? CP : WEIRD
        case 3: return c <= 0x39 ? AL : WEIRD
        case 4: return AL
        case 5: return c <= 0x5a ? AL : c === 0x5b ? OP : c === 0x5d ? CP : WEIRD
        case 6: return AL
        default: return c <= 0x7a ? AL : c === 0x7b ? OP : c === 0x7d ? CL : WEIRD
      }
    case 1:
      if (c === 0xa0) return GL
      if (c > 0xc0) return AL
      if (c === 0xa1 || c === 0xbf) return OP
      if (c === 0xab || c === 0xbb) return QU
      return WEIRD
    case 2: case 3: case 4: return AL
    case 5: return c === 0x2c8 || c === 0x2cc || c === 0x2df ? WEIRD : AL
    case 6:
      if (c === 0x34f || (c >= 0x35c && c <= 0x362)) return GL
      if (c < 0x370) return CM
      if (c === 0x37e) return WEIRD
      return AL
    case 7: case 8: case 10: return AL
    case 9: return c >= 0x483 && c <= 0x489 ? CM : AL
    case 11:
      if (c <= 0x588 || c >= 0x5c8) return AL
      if (c >= 0x591 && c <= 0x5bd) return CM
      return c === 0x5bf || c === 0x5c1 || c === 0x5c2 || c === 0x5c4 || c === 0x5c5 || c === 0x5c7 ? CM : WEIRD
    case 64: return c === 0x2018 || c === 0x2019 ? QU : WEIRD
  }
  if (c >= 0x2e80 && c <= 0xa4cf) {
    if ((c & 0xff00) === 0x3000) {
      if (c <= 0x303f) {
        switch (c & 0x1f) {
          case 0x01: case 0x02: case 0x09: case 0x0b: case 0x0d: case 0x0f: case 0x11: case 0x15: case 0x17:
          case 0x19: case 0x1b: case 0x1e: case 0x1f:
            return CL
          case 0x08: case 0x0a: case 0x0c: case 0x0e: case 0x10: case 0x16: case 0x14: case 0x18: case 0x1a:
          case 0x1d:
            return OP
          default:
            return WEIRD
        }
      }
      return WEIRD
    }
    if ((c & 0xfff0) === 0x31f0) return WEIRD
    if ((c & 0xfff8) === 0x3248) return AL
    if ((c & 0xffc0) === 0x4dc0) return AL
    if (c === 0xa015) return WEIRD
    return ID
  }
  if (c >= 0xac00 && c <= 0xd7af) return ID
  if (c >= 0xf900 && c <= 0xfaff) return ID
  return WEIRD
}

// CachedLineBreakIteratorFactory (TBI.h:236-351) with two characters of prior context
// (TBI.h:239-290), and ubrk_following over the prior context followed by the text
// (TBIICU.h:99-124, 136-142).
class Factory {
  readonly text: string
  secondToLast = 0
  last = 0
  priorLength = 0
  private readonly iterator: RuleBreakIterator
  private readonly wordSegmenter: Intl.Segmenter
  private nextBoundary: Int32Array | null = null

  constructor(text: string, iterator: RuleBreakIterator, wordSegmenter: Intl.Segmenter) {
    this.text = text
    this.iterator = iterator
    this.wordSegmenter = wordSegmenter
  }

  setPriorContext(secondToLast: number, last: number): void {
    this.secondToLast = secondToLast
    this.last = last
    // PriorContext::length counts trailing non-zero characters (TBI.h:277-283).
    this.priorLength = last === 0 ? 0 : secondToLast === 0 ? 1 : 2
    this.nextBoundary = null
  }

  // The first ICU boundary after `location`, or -1. `location` is -1 only with a prior
  // context; WebKit's unsigned arithmetic then lands on the last prior character
  // (TBIICU.h:136-142).
  following(location: number): number {
    let next = this.nextBoundary
    if (next === null) {
      const prior = this.priorLength === 2
        ? String.fromCharCode(this.secondToLast, this.last)
        : this.priorLength === 1 ? String.fromCharCode(this.last) : ''
      const text = prior + this.text
      const flags = new Uint8Array(text.length + 1)
      markLineBoundaries(this.iterator, text, flags, this.wordSegmenter)
      next = new Int32Array(text.length + 2)
      next[text.length + 1] = -1
      for (let p = text.length; p >= 0; p--) next[p] = flags[p] === 1 ? p : next[p + 1]!
      this.nextBoundary = next
    }
    const o = location + this.priorLength + 1
    if (o >= next.length) return -1
    const b = next[o]!
    return b < 0 ? -1 : b - this.priorLength
  }
}

// BP.h:136-241 for LineBreakRules::Normal, WordBreakBehavior::Normal and
// NoBreakSpaceBehavior::Normal. During the fast-forward over units where ICU agrees
// (BP.h:227-235) the characters before are not read again.
function nextBreakablePosition(pairs: Uint8Array, f: Factory, startPosition: number): number {
  const s = f.text
  const length = s.length
  if (startPosition === 0 && f.priorLength === 0) {
    if (length <= 1) return length
    startPosition++
  }
  let beforeBefore = startPosition > 1 ? s.charCodeAt(startPosition - 2) : f.secondToLast
  let before = startPosition > 0 ? s.charCodeAt(startPosition - 1) : f.last
  let beforeType = 0
  let after = 0
  let afterType = 0
  let nextBreak = -1
  for (let i = startPosition; i < length; beforeBefore = before, before = after, beforeType = afterType, i++) {
    after = s.charCodeAt(i)
    afterType = 0
    if (isWebKitBreakableSpace(after)) return i
    // ASCII rapid lookup.
    if (before === 0x2d && isASCIIDigit(after)) {
      if (isASCIIDigit(beforeBefore) || isASCIIAlpha(beforeBefore)) return i
      continue
    }
    if (before <= 0xff && after <= 0xff) {
      if (before >= 0x21 && after >= 0x21) {
        const x = after - 0x21
        if ((pairs[(before - 0x21) * 28 + (x >> 3)]! & (1 << (x & 7))) !== 0) return i
      }
      continue
    }
    // Non-ASCII rapid lookup.
    if (beforeType === 0) beforeType = classify(before)
    afterType = classify(after)
    const pair = beforeType | afterType
    if ((pair & ~(SP | AL | QU)) === 0) continue
    if ((pair | AL) === (ID | AL)) return i
    if ((pair & (GL | QU)) !== 0 && (pair & WEIRD) === 0) continue
    if (afterType === CM) {
      afterType = beforeType
      continue
    }
    if ((pair & WEIRD) === 0 && (pair & (CL | CP | OP)) !== 0) {
      if (afterType === CL || afterType === CP || beforeType === OP) continue
      if ((pair & ID) !== 0) return i
    }
    // ICU lookup.
    if (nextBreak < i) nextBreak = f.following(i - 1)
    if (nextBreak >= 0 && i < nextBreak) {
      for (const max = Math.min(nextBreak, length - 1); i < max; beforeBefore = before, before = after, beforeType = afterType, i++) {
        const lookahead = s.charCodeAt(i + 1)
        if (lookahead <= 0xff && !isASCIIAlpha(lookahead)) break
      }
    }
    if (i === nextBreak && !isWebKitBreakableSpace(before)) return i
  }
  return length
}

// BP.h:244-257: keep-all breaks only at spaces, before ZWSP and after U+3000.
function nextBreakableSpace(s: string, startPosition: number): number {
  for (let i = startPosition; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (isWebKitBreakableSpace(c) || c === ZWSP) return i
    if (c === IDEOGRAPHIC_SPACE) return i + 1
  }
  return s.length
}

// TU:403-427 with line-break auto (LineMode Default, TU:455-471) and BP.h:271-283.
function findNextBreakablePosition(pairs: Uint8Array, f: Factory, startPosition: number, keepAll: boolean): number {
  return keepAll ? nextBreakableSpace(f.text, startPosition) : nextBreakablePosition(pairs, f, startPosition)
}

// ubrk_open(UBRK_LINE, locale) in libicucore (TBIICU.h:63-67): line_normal.brk for ja and
// ko, line_cj.brk for zh and line.brk otherwise, plus the locale's quotation remap
// (apple-brkiter.cpp:458-473, apple-rbbi.cpp:406-487), looked up with ICU's parent fallback.
function getWebKitLineIterator(language: string | null): RuleBreakIterator {
  const locale = language ?? ''
  let iterator = webkitIterators.get(locale)
  if (iterator !== undefined) return iterator
  const breakLanguage = getBreakLanguage(locale)
  const rules = getAppleLineRules(breakLanguage === 'ja' || breakLanguage === 'ko' ? 'line_normal' : breakLanguage === 'zh' ? 'line_cj' : 'line')
  let name = locale.replace(/-/g, '_')
  let remap = appleQuoteRemaps[name]
  while (remap === undefined) {
    const cut = name.lastIndexOf('_')
    name = cut < 0 ? '' : name.slice(0, cut)
    remap = appleQuoteRemaps[name]
  }
  const chars: number[] = []
  const categories: number[] = []
  for (let k = 0; k < remap.length; k += 2) {
    chars.push(remap[k]!)
    categories.push(getCategory(rules, remap[k + 1] === 0 ? 0x7b : 0x7d))
  }
  iterator = new RuleBreakIterator(rules, chars, categories)
  webkitIterators.set(locale, iterator)
  return iterator
}

const TEXT = 0
const WHITESPACE = 1
const SOFT_LINE_BREAK = 2

// Where a line may start in a text node's source: flags[i] = 1 for 0 < i < source.length.
// These are the soft wrap opportunities between the items InlineItemsBuilder::build
// makes (IIB:90-101), as the soft wrap index loop finds them (IFU:471-525): every item
// boundary that isn't next to a preserved newline, which is a forced break instead.
export function getWebKitLineBreaks(
  source: string,
  preserveNewlines: boolean,
  keepAll: boolean,
  language: string | null,
  wordSegmenter: Intl.Segmenter,
): Uint8Array {
  const pairs = webkitPairs ??= decodeBase64(webkitLinePairsBase64)
  const f = new Factory(source, getWebKitLineIterator(language), wordSegmenter)
  const length = source.length
  const breaks = new Uint8Array(length + 1)
  let previousKind = -1
  // handleTextContent, IIB:871-978, for hyphens manual and nbsp-mode normal.
  for (let position = 0; position < length;) {
    let kind = WHITESPACE
    let end = position
    if (preserveNewlines && source.charCodeAt(position) === LF) {
      // handleSegmentBreak, IIB:897-904.
      kind = SOFT_LINE_BREAK
      end++
    } else {
      // handleWhitespace, IIB:905-926, with moveToNextNonWhitespacePosition (IIB:52-70).
      for (; end < length; end++) {
        const c = source.charCodeAt(end)
        if (c !== SPACE && c !== TAB && (preserveNewlines || c !== LF)) break
      }
      if (end === position) {
        // handleNonWhitespace, IIB:946-965, with moveToNextBreakablePosition (IIB:72-84).
        kind = TEXT
        end = length
        for (let p = position; p < length; p++) {
          const next = findNextBreakablePosition(pairs, f, p, keepAll)
          if (next !== position) { end = next; break }
        }
      }
    }
    // IFU:351-370, 421-433: the scan split same-level items, and wrapping is allowed next
    // to white space.
    if (previousKind >= 0 && previousKind !== SOFT_LINE_BREAK && kind !== SOFT_LINE_BREAK) breaks[position] = 1
    previousKind = kind
    position = end
  }
  return breaks
}

// TU:379-401: whether a line may start where the next inline box starts, from a fresh
// factory on that box with the previous box's last two characters as prior context.
// hyphens: manual, so a trailing soft hyphen doesn't block the break.
export function getWebKitBreakBetweenItems(previous: string, next: string, language: string | null, wordSegmenter: Intl.Segmenter): boolean {
  const pairs = webkitPairs ??= decodeBase64(webkitLinePairsBase64)
  const f = new Factory(next, getWebKitLineIterator(language), wordSegmenter)
  const n = previous.length
  f.setPriorContext(n > 1 ? previous.charCodeAt(n - 2) : 0, n > 0 ? previous.charCodeAt(n - 1) : 0)
  return nextBreakablePosition(pairs, f, 0) === 0
}
