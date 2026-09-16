// The unicode-bidi 0.3.15 port with Gecko's data against recorded outputs, streamed line by line:
// - BidiTest-17.0.0 (ICU testdata), class sequences with unicode-bidi's representative code point per class; each
//   sequence is one paragraph with B only at its end, which the crate resolves without splitting;
// - unicode-bidi's own tests/data/BidiCharacterTest.txt (Unicode 15.0.0), which the crate passes;
// - the crate-side levels of specs/bidi.md §7.5, where the crate departs from ICU.
// Levels marked x (removed by X9) aren't in the conformance files, so they're only covered by the directed cases.
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { BROWSER_ENGINES } from '../../tools/gen-shared.ts'
import { forEachLine } from '../../tools/lines.ts'
import { bidiDataFor, type ParagraphDirection } from './bidi.js'
import { resolveUnicodeBidi } from './unicode-bidi.js'

const BIDI_TEST = resolve(BROWSER_ENGINES, 'chromium-152/src/third_party/icu/source/test/testdata/BidiTest.txt')
const CRATE_BIDI_CHARACTER_TEST = resolve(BROWSER_ENGINES, 'pretext-emulation-20260915/oracle/gecko/validation/vendor/unicode-bidi-ca612daf1c08c53abe07327cb3e6ef6e0a760f0c/tests/data/BidiCharacterTest.txt')

const CLASS_NAMES = ['L', 'R', 'EN', 'ES', 'ET', 'AN', 'CS', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'AL', 'RLE', 'RLO', 'PDF', 'NSM', 'BN', 'FSI', 'LRI', 'RLI', 'PDI']
const REPRESENTATIVES = [0x02b8, 0x0590, 0x06f9, 0x208b, 0x20cf, 0x0605, 0x2044, 0x000a, 0x001f, 0x200a, 0x03f6, 0x202a, 0x202d, 0x060b, 0x202b, 0x202e, 0x202c, 0x0300, 0x2060, 0x2068, 0x2066, 0x2067, 0x2069]

const data = bidiDataFor('gecko')

// Compares levels per code point, skipping x.
function matches(text: string, direction: ParagraphDirection, expected: readonly string[], expectedLevel: number | null): boolean {
  const actual = resolveUnicodeBidi(text, direction, data)
  if (expectedLevel !== null && actual.level !== expectedLevel) return false
  for (let i = 0, unit = 0; i < expected.length; i++) {
    if (expected[i] !== 'x' && Number(expected[i]) !== actual.levels[unit]) return false
    unit += text.codePointAt(unit)! > 0xffff ? 2 : 1
  }
  return true
}

describe('unicode-bidi port conformance', () => {
  test('BidiTest-17.0.0', async () => {
    let runs = 0
    const failures: string[] = []
    let expected: string[] = []
    await forEachLine(BIDI_TEST, line => {
      if (line.startsWith('@Levels:')) {
        expected = line.slice('@Levels:'.length).trim().split(/\s+/).filter(t => t.length > 0)
        return
      }
      if (line.length === 0 || line.startsWith('#') || line.startsWith('@')) return
      const [classes, bits] = line.split(';')
      const names = classes!.trim().split(/\s+/)
      const codePoints: number[] = []
      for (let k = 0; k < names.length; k++) codePoints.push(REPRESENTATIVES[CLASS_NAMES.indexOf(names[k]!)]!)
      const text = String.fromCodePoint(...codePoints)
      const set = parseInt(bits!.trim(), 16)
      const directions: ParagraphDirection[] = []
      if ((set & 1) !== 0) directions.push('auto')
      if ((set & 2) !== 0) directions.push('ltr')
      if ((set & 4) !== 0) directions.push('rtl')
      for (let d = 0; d < directions.length; d++) {
        runs++
        if (!matches(text, directions[d]!, expected, null) && failures.length < 10) failures.push(`${line} (${directions[d]})`)
      }
    })
    console.log(JSON.stringify({ file: 'BidiTest-17.0.0', runs }))
    expect(runs).toBe(770241)
    expect(failures).toEqual([])
  }, 120000)

  test('unicode-bidi 0.3.15 BidiCharacterTest-15.0.0', async () => {
    let cases = 0
    const failures: string[] = []
    await forEachLine(CRATE_BIDI_CHARACTER_TEST, line => {
      if (line.length === 0 || line.startsWith('#')) return
      // code points; paragraph direction 0 LTR, 1 RTL, 2 auto; resolved paragraph level; levels per code point, x for
      // characters removed by X9; visual order.
      const fields = line.split(';')
      const text = String.fromCodePoint(...fields[0]!.trim().split(/\s+/).map(h => parseInt(h, 16)))
      const para = fields[1]!.trim()
      const direction: ParagraphDirection = para === '0' ? 'ltr' : para === '1' ? 'rtl' : 'auto'
      cases++
      if (!matches(text, direction, fields[3]!.trim().split(/\s+/), Number(fields[2]!.trim())) && failures.length < 10) failures.push(line)
    })
    console.log(JSON.stringify({ file: 'BidiCharacterTest-15.0.0', cases }))
    expect(cases).toBe(91709)
    expect(failures).toEqual([])
  }, 120000)
})

// specs/bidi.md §7.5, crate column: levels per code point, removed characters included.
describe('unicode-bidi behaviour Gecko depends on', () => {
  const levels = (codePoints: readonly number[], direction: ParagraphDirection): number[] => Array.from(resolveUnicodeBidi(String.fromCodePoint(...codePoints), direction, data).levels)
  test('D1: the N0 context search walks earlier runs first to last', () => {
    expect(levels([0x61, 0x5d0, 0x2066, 0x78, 0x2069, 0x28, 0x63, 0x29], 'rtl')).toEqual([2, 1, 1, 2, 1, 2, 2, 2])
  })
  test('D3: a soft hyphen takes the previous character\'s level', () => {
    expect(levels([0x5e9, 0x5dc, 0x5d5, 0x5dd, 0xad, 0x61, 0x62, 0x63], 'ltr')).toEqual([1, 1, 1, 1, 1, 0, 0, 0])
  })
  test('D4 and D5: text with no RTL content still gets full levels', () => {
    expect(levels([0x66, 0x202a, 0x69, 0x202c], 'ltr')).toEqual([0, 0, 2, 0])
    expect(levels([0x61, 0x62, 0x63, 0x663, 0x664], 'ltr')).toEqual([0, 0, 0, 2, 2])
  })
  test('D7: bracket pairing stops after 63 openings', () => {
    const expected = new Array<number>(72).fill(2)
    expected.push(1)
    expect(levels([0x61, ...new Array<number>(70).fill(0x28), 0x62, 0x29], 'rtl')).toEqual(expected)
  })
  test('D8: an NSM after a changed closing bracket follows it', () => {
    expect(levels([0x61, 0x28, 0x62, 0x29, 0x301], 'rtl')).toEqual([2, 2, 2, 2, 2])
  })
  test('D9: overridden brackets never pair', () => {
    expect(levels([0x202a, 0x5d0, 0x28, 0x5d1, 0x202c, 0x202d, 0x29, 0x202c], 'ltr')).toEqual([0, 3, 3, 3, 3, 3, 2, 0])
  })
})
