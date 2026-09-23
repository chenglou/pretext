// A made-up TrueType font for browser tests of Gecko's word scan (src/engines/gecko/lines.ts wordScan): boxes for a to z,
// A to Z, the digits, the period, the comma and the space, and a legacy `kern` table without GPOS, which HarfBuzz applies
// through its kern pair machine: kern >> 1 on the first glyph's advance and the rest on the second's (hb-kern.hh:102-106).
// Pairs whose adjustment is more than twice the second glyph's advance give that glyph a negative advance, so a word that
// ends in it has a negative tail and a prefix wider than the word: the word scan's premise fails in the font itself.
// - `y.` and `f,`: -700 of 1000 units against a 250 unit point and comma, so the point is -100 and the comma -100.
// - `a.`: -100, a control that keeps the tail positive.
// - `Vq`: -1100 against a 500 unit q, so q is -50: a letter, not punctuation.
// Nothing here is a real font; the file is made where a probe asks for it and never checked in.
//
//   bun rebuild/tools/negative-tail-font.ts <out.ttf>
import { writeFileSync } from 'node:fs'

export const NEGATIVE_TAIL_PAIRS: ReadonlyArray<readonly [string, string, number]> = [['y', '.', -700], ['f', ',', -700], ['a', '.', -100], ['V', 'q', -1100]]

function u16(n: number): number[] { return [(n >> 8) & 0xff, n & 0xff] }
function i16(n: number): number[] { return u16(n < 0 ? n + 0x10000 : n) }
function u32(n: number): number[] { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff] }

function checksum(bytes: number[]): number {
  let sum = 0
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0
  return sum
}

export function negativeTailFont(family = 'NegativeTail'): Uint8Array {
  const chars: number[] = [0x20, 0x2c, 0x2e]
  for (let c = 0x30; c <= 0x39; c++) chars.push(c)
  for (let c = 0x41; c <= 0x5a; c++) chars.push(c)
  for (let c = 0x61; c <= 0x7a; c++) chars.push(c)
  chars.sort((a, b) => a - b)
  // Glyph 0 is .notdef; glyph k + 1 draws chars[k].
  const advance = (cp: number): number => cp === 0x20 ? 300 : cp === 0x2e || cp === 0x2c ? 250 : cp === 0x69 || cp === 0x6c ? 250 : 500
  const glyphs: { advance: number; box: [number, number, number, number] | null }[] = [{ advance: 500, box: [50, 0, 450, 700] }]
  for (let k = 0; k < chars.length; k++) {
    const a = advance(chars[k]!)
    glyphs.push({ advance: a, box: chars[k] === 0x20 ? null : [30, 0, a - 30, chars[k] === 0x2e || chars[k] === 0x2c ? 120 : 600] })
  }
  const glyphOf = (ch: string): number => chars.indexOf(ch.codePointAt(0)!) + 1
  const n = glyphs.length

  // glyf and loca (short offsets, so every glyph's length is even).
  const glyf: number[] = []
  const loca: number[] = []
  for (let g = 0; g < n; g++) {
    loca.push(...u16(glyf.length / 2))
    const box = glyphs[g]!.box
    if (box === null) continue
    const [x0, y0, x1, y1] = box
    glyf.push(...i16(1), ...i16(x0), ...i16(y0), ...i16(x1), ...i16(y1))
    glyf.push(...u16(3)) // endPtsOfContours
    glyf.push(...u16(0)) // instructionLength
    glyf.push(1, 1, 1, 1) // flags: on curve, long coordinates
    const xs = [x0, x1, x1, x0]
    const ys = [y0, y0, y1, y1]
    let px = 0
    for (let i = 0; i < 4; i++) { glyf.push(...i16(xs[i]! - px)); px = xs[i]! }
    let py = 0
    for (let i = 0; i < 4; i++) { glyf.push(...i16(ys[i]! - py)); py = ys[i]! }
    if (glyf.length % 2 === 1) glyf.push(0)
  }
  loca.push(...u16(glyf.length / 2))

  const hmtx: number[] = []
  for (let g = 0; g < n; g++) hmtx.push(...u16(glyphs[g]!.advance), ...i16(glyphs[g]!.box?.[0] ?? 0))

  // cmap: one format 4 subtable (3, 1), a segment per character and the closing segment.
  const segs = chars.map((cp, k) => ({ start: cp, end: cp, delta: (k + 1 - cp) & 0xffff }))
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 })
  const segX2 = segs.length * 2
  let searchRange = 2
  let entrySelector = 0
  while (searchRange * 2 <= segX2) { searchRange *= 2; entrySelector++ }
  const f4: number[] = []
  f4.push(...u16(4), ...u16(0), ...u16(0), ...u16(segX2), ...u16(searchRange), ...u16(entrySelector), ...u16(segX2 - searchRange))
  for (const s of segs) f4.push(...u16(s.end))
  f4.push(...u16(0))
  for (const s of segs) f4.push(...u16(s.start))
  for (const s of segs) f4.push(...u16(s.delta))
  for (let i = 0; i < segs.length; i++) f4.push(...u16(0))
  f4[2] = (f4.length >> 8) & 0xff
  f4[3] = f4.length & 0xff
  const cmap = [...u16(0), ...u16(1), ...u16(3), ...u16(1), ...u32(12), ...f4]

  // kern, version 0, one horizontal format 0 subtable, pairs sorted by glyph pair.
  const pairs = NEGATIVE_TAIL_PAIRS.map(([l, r, v]) => ({ key: glyphOf(l) * 65536 + glyphOf(r), l: glyphOf(l), r: glyphOf(r), v })).sort((a, b) => a.key - b.key)
  let pr = 1
  let pe = 0
  while (pr * 2 <= pairs.length) { pr *= 2; pe++ }
  const sub: number[] = [...u16(0), ...u16(0), ...u16(0x0001), ...u16(pairs.length), ...u16(pr * 6), ...u16(pe), ...u16((pairs.length - pr) * 6)]
  for (const p of pairs) sub.push(...u16(p.l), ...u16(p.r), ...i16(p.v))
  sub[2] = (sub.length >> 8) & 0xff
  sub[3] = sub.length & 0xff
  const kern = [...u16(0), ...u16(1), ...sub]

  const maxAdvance = Math.max(...glyphs.map(g => g.advance))
  const head = [...u32(0x00010000), ...u32(0x00010000), ...u32(0), ...u32(0x5f0f3cf5), ...u16(0x000b), ...u16(1000),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...i16(0), ...i16(0), ...i16(maxAdvance), ...i16(700), ...u16(0), ...u16(8), ...i16(2), ...i16(0), ...i16(0)]
  const hhea = [...u32(0x00010000), ...i16(800), ...i16(-200), ...i16(0), ...u16(maxAdvance), ...i16(0), ...i16(0), ...i16(maxAdvance), ...i16(1), ...i16(0), ...i16(0),
    ...i16(0), ...i16(0), ...i16(0), ...i16(0), ...i16(0), ...u16(n)]
  const maxp = [...u32(0x00010000), ...u16(n), ...u16(4), ...u16(1), ...u16(0), ...u16(0), ...u16(2), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0)]
  const os2 = [...u16(4), ...i16(480), ...u16(400), ...u16(5), ...u16(0), ...i16(650), ...i16(600), ...i16(0), ...i16(75), ...i16(650), ...i16(600), ...i16(0), ...i16(350), ...i16(50), ...i16(250), ...i16(0),
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(1), ...u32(0), ...u32(0), ...u32(0), 0x4e, 0x4f, 0x4e, 0x45, ...u16(0x40), ...u16(0x20), ...u16(0x7a),
    ...i16(800), ...i16(-200), ...i16(0), ...u16(800), ...u16(200), ...u32(1), ...u32(0), ...i16(500), ...i16(700), ...u16(0), ...u16(0x20), ...u16(2)]
  const post = [...u32(0x00030000), ...u32(0), ...i16(-100), ...i16(50), ...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)]
  const names: Array<[number, string]> = [[1, family], [2, 'Regular'], [3, `${family}-Regular-test`], [4, `${family} Regular`], [6, `${family}-Regular`]]
  const nameStrings: number[] = []
  const nameRecords: number[] = []
  for (const [id, text] of names) {
    const bytes: number[] = []
    for (let i = 0; i < text.length; i++) bytes.push(...u16(text.charCodeAt(i)))
    nameRecords.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(bytes.length), ...u16(nameStrings.length))
    nameStrings.push(...bytes)
  }
  const name = [...u16(0), ...u16(names.length), ...u16(6 + nameRecords.length), ...nameRecords, ...nameStrings]

  const tables: Array<[string, number[]]> = [['OS/2', os2], ['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['kern', kern], ['loca', loca], ['maxp', maxp], ['name', name], ['post', post]]
  let tr = 1
  let te = 0
  while (tr * 2 <= tables.length) { tr *= 2; te++ }
  const out: number[] = [...u32(0x00010000), ...u16(tables.length), ...u16(tr * 16), ...u16(te), ...u16(tables.length * 16 - tr * 16)]
  let offset = 12 + tables.length * 16
  const body: number[] = []
  let headOffset = 0
  for (const [tag, data] of tables) {
    const padded = [...data]
    while (padded.length % 4 !== 0) padded.push(0)
    for (let i = 0; i < 4; i++) out.push(tag.charCodeAt(i))
    out.push(...u32(checksum(padded)), ...u32(offset), ...u32(data.length))
    if (tag === 'head') headOffset = offset
    body.push(...padded)
    offset += padded.length
  }
  const file = [...out, ...body]
  const adjustment = (0xb1b0afba - checksum(file)) >>> 0
  file.splice(headOffset + 8, 4, ...u32(adjustment))
  return Uint8Array.from(file)
}

if (import.meta.main) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('usage: bun rebuild/tools/negative-tail-font.ts <out.ttf>')
  writeFileSync(path, negativeTailFont())
}
