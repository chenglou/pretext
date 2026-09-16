// ICU4X rule-based segmenter data and iterator, as Firefox 156 bakes and runs them: icu_segmenter 2.1.2 and
// icu_collections 2.1.1 with Firefox's own data (intl/icu_segmenter_data, icu4x commit 3579f233, icuexport 78.1).
//
// - CodePointTrie::get32 for TrieType::Small with u8 values and error value 0 (icu_collections cptrie.rs:433-509,
//   568-600, 648-656), ported from the groundwork's runtime-parity/gecko/src/icu4x-line.ts.
// - RuleBreakIterator::next for UTF-16 (icu_segmenter src/rule_segmenter.rs:69-205) without complex-language handling,
//   which is what GraphemeClusterSegmenter::segment_utf16 builds (src/grapheme.rs:221-236). The line iterator adds LB9,
//   word options, strictness and SA handling on top (src/line.rs:833-1080); engines/gecko owns that port.

export type Icu4xRuleDataSource = {
  highStart: number
  propertyCount: number
  lastCodepointProperty: number
  sotProperty: number
  eotProperty: number
  complexProperty: number
  // CodePointTrie index, u16 little-endian.
  trieIndexBase64: string
  // CodePointTrie data, u8.
  trieDataBase64: string
  // BreakState bytes, propertyCount squared.
  breakStatesBase64: string
}

export type Icu4xRuleData = {
  highStart: number
  index: Uint16Array
  data: Uint8Array
  states: Uint8Array
  propertyCount: number
  lastCodepointProperty: number
  sotProperty: number
  eotProperty: number
  complexProperty: number
}

// BreakState bytes (icu_segmenter src/provider/mod.rs:244-300).
export const BREAK = 253
export const NO_MATCH = 254
export const KEEP = 255
export const INTERMEDIATE = 120

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function parseIcu4xRuleData(source: Icu4xRuleDataSource): Icu4xRuleData {
  const indexBytes = decodeBase64(source.trieIndexBase64)
  const index = new Uint16Array(indexBytes.length >> 1)
  for (let i = 0; i < index.length; i++) index[i] = indexBytes[2 * i]! | (indexBytes[2 * i + 1]! << 8)
  const states = decodeBase64(source.breakStatesBase64)
  if (states.length !== source.propertyCount * source.propertyCount) throw new Error('break state table is not propertyCount squared')
  return {
    highStart: source.highStart,
    index,
    data: decodeBase64(source.trieDataBase64),
    states,
    propertyCount: source.propertyCount,
    lastCodepointProperty: source.lastCodepointProperty,
    sotProperty: source.sotProperty,
    eotProperty: source.eotProperty,
    complexProperty: source.complexProperty,
  }
}

// CodePointTrie::get32, small trie, u8 values, error value 0.
export function icu4xProperty(d: Icu4xRuleData, c: number): number {
  const index = d.index
  const data = d.data
  if (c <= 0xfff) return data[index[c >> 6]! + (c & 0x3f)]! // get32_assuming_fast_index
  if (c > 0x10ffff) return 0 // error_value
  if (c >= d.highStart) return data[data.length - 2]! // small_index
  // internal_small_index: SHIFT_1 14, SMALL_INDEX_LENGTH 64, SHIFT_2 9, INDEX_2_MASK 31, SHIFT_3 4, INDEX_3_MASK 31.
  let i3Block = index[index[(c >> 14) + 64]! + ((c >> 9) & 0x1f)]!
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
  return data[dataBlock + (c & 0xf)]!
}

// get_break_state_from_table falls back to Keep for an index outside the table (rule_segmenter.rs:243-250).
function breakState(d: Icu4xRuleData, left: number, right: number): number {
  return d.states[left * d.propertyCount + right] ?? KEEP
}

// Every boundary RuleBreakIterator yields over UTF-16 text, including 0 and text.length ([0] for empty text).
export function icu4xRuleBoundaries(d: Icu4xRuleData, text: string): number[] {
  const out: number[] = []
  const len = text.length
  // Utf16Indices (indices.rs:58-83): `front` is the next unit to read; `pos`/`cp` are current_pos_data, pos -1 at EOF.
  let front = 0
  let pos = -1
  let cp = 0
  const advance = (): void => {
    if (front >= len) { pos = -1; return }
    let c = text.charCodeAt(front)
    pos = front
    front++
    if ((c & 0xfc00) === 0xd800 && front < len) {
      const next = text.charCodeAt(front)
      if ((next & 0xfc00) === 0xdc00) { c = ((c & 0x3ff) << 10) + (next & 0x3ff) + 0x10000; front++ }
    }
    cp = c
  }

  // First call (rule_segmenter.rs:91-113): SOT x first character.
  advance()
  if (pos < 0) return [0]
  if (breakState(d, d.sotProperty, icu4xProperty(d, cp)) === BREAK || breakState(d, d.sotProperty, icu4xProperty(d, cp)) === NO_MATCH) out.push(pos)

  // Later calls (rule_segmenter.rs:115-204). `pos >= 0` holds at the top of every pass.
  outer: for (;;) {
    const leftProp = icu4xProperty(d, cp)
    advance()
    if (pos < 0) { out.push(len); return out }
    const rightProp = icu4xProperty(d, cp)
    // No complex-language handler: a complex right after a non-complex left is a break (:128-138).
    if (rightProp === d.complexProperty && leftProp !== d.complexProperty) { out.push(pos); continue }
    const state = breakState(d, leftProp, rightProp)
    if (state === KEEP) continue
    if (state === BREAK || state === NO_MATCH) { out.push(pos); continue }
    let index = state >= INTERMEDIATE ? state - INTERMEDIATE : state
    let markFront = front
    let markPos = pos
    let markCp = cp
    for (;;) {
      advance()
      if (pos < 0) {
        if (breakState(d, index, d.eotProperty) === NO_MATCH) {
          front = markFront; pos = markPos; cp = markCp
          out.push(pos)
          continue outer
        }
        out.push(len)
        return out
      }
      const prop = icu4xProperty(d, cp)
      const previousIsCodepointProperty = index <= d.lastCodepointProperty
      const next = breakState(d, index, prop)
      if (next === KEEP) continue outer
      if (next === NO_MATCH) {
        front = markFront; pos = markPos; cp = markCp
        out.push(pos)
        continue outer
      }
      if (next === BREAK) { out.push(pos); continue outer }
      if (next >= INTERMEDIATE) {
        index = next - INTERMEDIATE
        markFront = front; markPos = pos; markCp = cp
      } else {
        index = next
        if (previousIsCodepointProperty) { markFront = front; markPos = pos; markCp = cp }
      }
    }
  }
}
