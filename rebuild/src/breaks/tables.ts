// Loads the generated break data once per table. A parsed table depends only on its generated module, so keeping it
// for the life of the page is an acceleration structure with a fixed key (the table name) and a bounded size.
import { decodeBase64, parseIcu4xRuleData, type Icu4xRuleData } from './icu4x.js'
import { parseBreakRules, type BreakRules } from './rbbi.js'
import { blinkBreakTableBase64, blinkLinePairsBase64, type BlinkBreakTable } from './generated/blink-break-tables.js'
import { geckoGraphemeData, geckoLineBreakData } from './generated/gecko-break-data.js'
import { webkitBreakTableBase64, webkitLinePairsBase64, type WebKitBreakTable } from './generated/webkit-break-tables.js'

export type { BlinkBreakTable } from './generated/blink-break-tables.js'
export type { WebKitBreakTable } from './generated/webkit-break-tables.js'

const blinkRules: { [K in BlinkBreakTable]?: BreakRules } = {}
const webkitRules: { [K in WebKitBreakTable]?: BreakRules } = {}
let blinkPairs: Uint8Array | null = null
let webkitPairs: Uint8Array | null = null
let geckoLine: Icu4xRuleData | null = null
let geckoGrapheme: Icu4xRuleData | null = null

// Chrome 153 icudtl.dat tables (ICU 78.2).
export function blinkBreakRules(table: BlinkBreakTable): BreakRules {
  return blinkRules[table] ??= parseBreakRules(decodeBase64(blinkBreakTableBase64[table]))
}

// macOS 27 libicucore tables (ICU 78.1).
export function webkitBreakRules(table: WebKitBreakTable): BreakRules {
  return webkitRules[table] ??= parseBreakRules(decodeBase64(webkitBreakTableBase64[table]))
}

// Blink's kFastLineBreakTable: can break between `last` and `current`, both in U+0021..U+00FF.
export function blinkLinePairs(): Uint8Array {
  return blinkPairs ??= decodeBase64(blinkLinePairsBase64)
}

// WebKit's LineBreakTable::breakTable, same layout.
export function webkitLinePairs(): Uint8Array {
  return webkitPairs ??= decodeBase64(webkitLinePairsBase64)
}

export function pairCanBreak(pairs: Uint8Array, before: number, after: number): boolean {
  const x = after - 0x21
  return (pairs[(before - 0x21) * 28 + (x >> 3)]! & (1 << (x & 7))) !== 0
}

// Firefox 156 segmenter_break_line_v1.
export function geckoLineRules(): Icu4xRuleData {
  return geckoLine ??= parseIcu4xRuleData(geckoLineBreakData)
}

// Firefox 156 segmenter_break_grapheme_cluster_v1.
export function geckoGraphemeRules(): Icu4xRuleData {
  return geckoGrapheme ??= parseIcu4xRuleData(geckoGraphemeData)
}
