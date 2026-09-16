// Generates src/breaks/generated/blink-break-tables.ts from rebuild/data/blink (Chrome 153.0.8010.48 icudtl.dat, ICU
// 78.2): the line tables Blink's LazyLineBreakIterator opens, char.brk for grapheme boundaries, and Blink's generated
// kFastLineBreakTable. Every input is checked against data/blink/manifest.json.
// usage: bun rebuild/tools/gen-blink-data.ts
//
// The Blink port extends this file (and only this generator) when it needs more Blink data, for example Line_Break and
// General_Category values from ICU 78.2 for break-all and keep-all (specs/blink-text.md §2.F.5).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BROWSER_ENGINES, DATA, REBUILD, base64, parsePairBitmap, readVerified, writeModule } from './gen-shared.ts'
import { PPUCD_PATH, PPUCD_SHA256, forEachPpucdRange } from './ppucd.ts'

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
// Joining_Type as HarfBuzz's Arabic shaper reads it for joining forms across shaping calls (specs/blink-text.md §2.E).
const JOINING_TYPE = ['U', 'D', 'R', 'L', 'C', 'T']
const props = new Uint16Array(0x110000)
await forEachPpucdRange(ppucdPath, range => {
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
await forEachPpucdRange(ppucdPath, range => {
  const gc = range.props.get('gc')
  if (gc !== 'Ps' && gc !== 'Pe') return
  const wide = range.props.get('blk') === 'CJK_Symbols' || range.props.get('ea') === 'F'
  const type = gc === 'Ps' ? (wide ? HAN_OPEN : HAN_OPEN_NARROW) : (wide ? HAN_CLOSE : HAN_CLOSE_NARROW)
  for (let cp = range.first; cp <= range.last; cp++) hanKerning.set(cp, type)
})
const hanKerningFlat: number[] = []
for (const [cp, type] of [...hanKerning.entries()].sort((a, b) => a[0] - b[0])) if (type !== HAN_OTHER) hanKerningFlat.push(cp, type)

const runs: number[] = []
for (let cp = 0; cp < props.length; cp++) {
  if (cp === 0 || props[cp] !== props[cp - 1]) runs.push(cp * 2048 + props[cp]!)
}
const packed = new Uint8Array(new Uint32Array(runs).buffer)

writeModule(resolve(REBUILD, 'src/breaks/generated/blink-break-tables.ts'), `// Generated by rebuild/tools/gen-blink-data.ts from rebuild/data/blink. Do not edit.
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
`)
