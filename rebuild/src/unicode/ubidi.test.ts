// The ICU ubidi port against ICU itself: ubidi_setPara, ubidi_getDirection, ubidi_getParagraphByIndex, ubidi_getLevels
// and ubidi_getLogicalRun from Homebrew icu4c 78.3 (Chrome 153's bidi code and data, with Blink's data) and from the
// system libicucore (Safari 27's, with WebKit's data), over
// - every input of BidiTest-17.0.0 (ICU testdata), with the representative code point per class that unicode-bidi's
//   conformance test uses, at each paragraph level the line's bit set lists;
// - every input of ICU's BidiCharacterTest-6.3.0 and unicode-bidi's BidiCharacterTest-15.0.0;
// - a seeded fuzz over characters of every class, class-B and class-S characters, CR LF, supplementary characters,
//   unpaired surrogates and Apple's private-use classes, at levels 0, 1 and auto;
// - embeddings, isolates and brackets nested past the limits of explicit levels and bracket pairing;
// - the directed cases of specs/bidi.md §7.5 and §13.
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { BROWSER_ENGINES } from '../../tools/gen-shared.ts'
import { buildIcuBidiOracle, runIcuBidiOracle, type IcuBuild } from '../../tools/icu-bidi-oracle.ts'
import { forEachLine } from '../../tools/lines.ts'
import { blinkBidiData } from '../engines/blink/data.js'
import { webkitBidiData } from '../engines/webkit/data.js'
import type { EngineName } from '../env.js'
import { bidiClassOf, type BidiData, type ParagraphDirection } from './bidi.js'
import { resolveIcuBidi, type IcuBidiParagraph } from './ubidi.js'

const ICU_TESTDATA = resolve(BROWSER_ENGINES, 'chromium-152/src/third_party/icu/source/test/testdata')
const CRATE_BIDI_CHARACTER_TEST = resolve(BROWSER_ENGINES, 'pretext-emulation-20260915/oracle/gecko/validation/vendor/unicode-bidi-ca612daf1c08c53abe07327cb3e6ef6e0a760f0c/tests/data/BidiCharacterTest.txt')

// BidiTest class names in UCharDirection order, and unicode-bidi's representative code point per class
// (tests/conformance_tests.rs gen_char_from_bidi_class).
const CLASS_NAMES = ['L', 'R', 'EN', 'ES', 'ET', 'AN', 'CS', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'AL', 'RLE', 'RLO', 'PDF', 'NSM', 'BN', 'FSI', 'LRI', 'RLI', 'PDI']
const REPRESENTATIVES = [0x02b8, 0x0590, 0x06f9, 0x208b, 0x20cf, 0x0605, 0x2044, 0x000a, 0x001f, 0x200a, 0x03f6, 0x202a, 0x202d, 0x060b, 0x202b, 0x202e, 0x202c, 0x0300, 0x2060, 0x2068, 0x2066, 0x2067, 0x2069]

type Case = { text: string; direction: ParagraphDirection }
type Oracle = { engine: EngineName; build: IcuBuild; binary: string; data: BidiData }

const ORACLES: Oracle[] = [
  { engine: 'blink', build: 'icu4c-78', binary: buildIcuBidiOracle('icu4c-78'), data: blinkBidiData },
  { engine: 'webkit', build: 'libicucore', binary: buildIcuBidiOracle('libicucore'), data: webkitBidiData },
]

function oracleLine(c: Case): string {
  let para: number
  switch (c.direction) {
    case 'ltr': para = 0; break
    case 'rtl': para = 1; break
    case 'auto': para = 254; break
  }
  const units: string[] = []
  for (let i = 0; i < c.text.length; i++) units.push(c.text.charCodeAt(i).toString(16))
  return `${para};${units.join(' ')}`
}

// The oracle's output format for a result: direction; paragraphs; levels; logical runs.
function describeResult(r: IcuBidiParagraph): string {
  let direction: number
  switch (r.direction) {
    case 'ltr': direction = 0; break
    case 'rtl': direction = 1; break
    case 'mixed': direction = 2; break
  }
  const paragraphs: string[] = []
  for (let i = 0; i < r.paragraphs.length; i++) paragraphs.push(`${r.paragraphs[i]!.end}:${r.paragraphs[i]!.level}`)
  const runs: string[] = []
  for (let start = 0; start < r.levels.length;) {
    let end = start + 1
    while (end < r.levels.length && r.levels[end] === r.levels[start]) end++
    runs.push(`${end}:${r.levels[start]}`)
    start = end
  }
  return `${direction};${paragraphs.join(' ')};${Array.from(r.levels).join(' ')};${runs.join(' ')}`
}

// Streams cases to every oracle in chunks and compares each result with the port's.
async function compareWithIcu(produce: (add: (c: Case) => void) => Promise<void> | void): Promise<{ cases: number; failures: string[] }> {
  let pending: Case[] = []
  let cases = 0
  const failures: string[] = []
  const flush = (): void => {
    if (pending.length === 0) return
    const input = pending.map(oracleLine).join('\n') + '\n'
    for (let o = 0; o < ORACLES.length; o++) {
      const oracle = ORACLES[o]!
      const lines = runIcuBidiOracle(oracle.binary, 'levels', input).split('\n')
      for (let i = 0; i < pending.length; i++) {
        const c = pending[i]!
        const actual = describeResult(resolveIcuBidi(c.text, c.direction, oracle.data))
        if (actual !== lines[i] && failures.length < 10) failures.push(`${oracle.build} ${oracleLine(c)}\n  icu  ${lines[i]}\n  port ${actual}`)
      }
    }
    cases += pending.length
    pending = []
  }
  await produce(c => {
    pending.push(c)
    if (pending.length === 20000) flush()
  })
  flush()
  return { cases, failures }
}

const fromCodePoints = (codePoints: readonly number[]): string => String.fromCodePoint(...codePoints)

// mulberry32
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FUZZ_ALPHABET: readonly string[] = [
  'a', 'b', '\u{10300}', // L, one supplementary
  'א', 'ב', '\u{10900}', // R
  'ب', '؜', // AL, ALM
  '1', '۹', '\u{1CCF0}', // EN
  '٣', '٠', '\u{10D40}', // AN
  '+', '-', // ES
  '$', '%', // ET
  ',', ':', ' ', // CS
  '̀', 'ְ', // NSM
  '\n', '\r', ' ', '', '', // B
  '\t', '', // S
  ' ', '', ' ', // WS
  '!', '(', ')', '[', ']', '{', '}', '〈', '〉', '〈', '〉', '￼', '\u{1D6C1}', '\u{1F600}', // ON
  '­', '​', '‍', '⁠', '﻿', // BN
  '‪', '‫', '‬', '‭', '‮', // LRE, RLE, PDF, LRO, RLO
  '⁦', '⁧', '⁨', '⁩', // LRI, RLI, FSI, PDI
  '‎', '‏', // LRM, RLM
  '\uD800', '\uDC00', // unpaired surrogates
  '', '', '', '', // Apple private-use classes: AL, EN, NSM, ON
]
const DIRECTIONS: readonly ParagraphDirection[] = ['ltr', 'rtl', 'auto']

describe('ICU ubidi port equals ICU', () => {
  test('BidiTest-17.0.0 inputs', async () => {
    for (let i = 0; i < REPRESENTATIVES.length; i++) expect(bidiClassOf(blinkBidiData, REPRESENTATIVES[i]!)).toBe(i)
    const { cases, failures } = await compareWithIcu(async add => {
      await forEachLine(resolve(ICU_TESTDATA, 'BidiTest.txt'), line => {
        if (line.length === 0 || line.startsWith('#') || line.startsWith('@')) return
        const [classes, bits] = line.split(';')
        const names = classes!.trim().split(/\s+/)
        const codePoints: number[] = []
        for (let k = 0; k < names.length; k++) codePoints.push(REPRESENTATIVES[CLASS_NAMES.indexOf(names[k]!)]!)
        const text = fromCodePoints(codePoints)
        const set = parseInt(bits!.trim(), 16)
        if ((set & 1) !== 0) add({ text, direction: 'auto' })
        if ((set & 2) !== 0) add({ text, direction: 'ltr' })
        if ((set & 4) !== 0) add({ text, direction: 'rtl' })
      })
    })
    console.log(JSON.stringify({ source: 'BidiTest-17.0.0', cases }))
    expect(cases).toBe(770241)
    expect(failures).toEqual([])
  }, 600000)

  test('BidiCharacterTest inputs', async () => {
    const { cases, failures } = await compareWithIcu(async add => {
      for (const path of [resolve(ICU_TESTDATA, 'BidiCharacterTest.txt'), CRATE_BIDI_CHARACTER_TEST]) {
        await forEachLine(path, line => {
          if (line.length === 0 || line.startsWith('#')) return
          const fields = line.split(';')
          const codePoints = fields[0]!.trim().split(/\s+/).map(h => parseInt(h, 16))
          const para = fields[1]!.trim()
          add({ text: fromCodePoints(codePoints), direction: para === '0' ? 'ltr' : para === '1' ? 'rtl' : 'auto' })
        })
      }
    })
    console.log(JSON.stringify({ source: 'BidiCharacterTest 6.3.0 + 15.0.0', cases }))
    expect(cases).toBe(91670 + 91709)
    expect(failures).toEqual([])
  }, 600000)

  test('seeded fuzz', async () => {
    const random = seededRandom(20260916)
    const { cases, failures } = await compareWithIcu(add => {
      for (let i = 0; i < 400000; i++) {
        const length = 1 + Math.floor(random() * 16)
        let text = ''
        for (let k = 0; k < length; k++) text += FUZZ_ALPHABET[Math.floor(random() * FUZZ_ALPHABET.length)]!
        add({ text, direction: DIRECTIONS[Math.floor(random() * 3)]! })
      }
      for (let i = 0; i < 5000; i++) {
        const length = 50 + Math.floor(random() * 250)
        let text = ''
        for (let k = 0; k < length; k++) text += FUZZ_ALPHABET[Math.floor(random() * FUZZ_ALPHABET.length)]!
        add({ text, direction: DIRECTIONS[Math.floor(random() * 3)]! })
      }
    })
    console.log(JSON.stringify({ source: 'fuzz', cases }))
    expect(failures).toEqual([])
  }, 600000)

  test('nesting past the limits', async () => {
    const random = seededRandom(125)
    const initiators = ['‪', '‫', '‭', '‮', '⁦', '⁧', '⁨']
    const content = ['a', 'א', '1', '٣', '(', ')', ' ', '̀', '\n', '\t', '⁩', '‬']
    const { cases, failures } = await compareWithIcu(add => {
      const depths = [60, 61, 62, 63, 64, 65, 123, 124, 125, 126, 127, 128, 130, 200]
      for (let d = 0; d < depths.length; d++) {
        for (let k = 0; k < initiators.length; k++) {
          const opening = initiators[k]!
          const closing = k >= 4 ? '⁩' : '‬'
          const text = opening.repeat(depths[d]!) + 'aא 1(ب)' + closing.repeat(depths[d]! >> 1) + ' bב'
          for (let t = 0; t < DIRECTIONS.length; t++) add({ text, direction: DIRECTIONS[t]! })
        }
        const brackets = 'a' + '('.repeat(depths[d]!) + 'bא' + ')'.repeat(depths[d]!) + '́'
        for (let t = 0; t < DIRECTIONS.length; t++) {
          add({ text: brackets, direction: DIRECTIONS[t]! })
          add({ text: '‮' + brackets + '‬' + brackets, direction: DIRECTIONS[t]! })
        }
      }
      for (let i = 0; i < 3000; i++) {
        let text = ''
        const length = 100 + Math.floor(random() * 300)
        for (let k = 0; k < length; k++) {
          const r = random()
          text += r < 0.45 ? initiators[Math.floor(random() * initiators.length)]! : content[Math.floor(random() * content.length)]!
        }
        add({ text, direction: DIRECTIONS[Math.floor(random() * 3)]! })
      }
    })
    console.log(JSON.stringify({ source: 'limits', cases }))
    expect(failures).toEqual([])
  }, 600000)

  test('directed cases', async () => {
    const { cases, failures } = await compareWithIcu(add => {
      for (let i = 0; i < DIRECTED.length; i++) {
        for (let t = 0; t < DIRECTIONS.length; t++) add({ text: DIRECTED[i]!, direction: DIRECTIONS[t]! })
      }
    })
    expect(cases).toBe(DIRECTED.length * 3)
    expect(failures).toEqual([])
  })
})

// specs/bidi.md §7.5 D1-D13, the four isolate-after-embedding lines of §7.3, and paragraph text from the §13 probes.
const DIRECTED: readonly string[] = [
  fromCodePoints([0x61, 0x5d0, 0x2066, 0x78, 0x2069, 0x28, 0x63, 0x29]),
  fromCodePoints([0x2067, 0x5d0, 0x5d1, 0x1d, 0x5d2, 0x5d3, 0x2069]),
  fromCodePoints([0x5e9, 0x5dc, 0x5d5, 0x5dd, 0xad, 0x61, 0x62, 0x63]),
  fromCodePoints([0x66, 0x202a, 0x69, 0x202c]),
  fromCodePoints([0x61, 0x62, 0x63, 0x663, 0x664]),
  fromCodePoints([0x61, 0x62, 0x63, 0x20, 0x663, 0x664]),
  'a' + '('.repeat(70) + 'b)',
  fromCodePoints([0x61, 0x28, 0x62, 0x29, 0x301]),
  fromCodePoints([0x202a, 0x5d0, 0x28, 0x5d1, 0x202c, 0x202d, 0x29, 0x202c]),
  fromCodePoints([0x5d0, 0x9, 0x5d1]),
  fromCodePoints([0x31, 0xfffc, 0x2b, 0x32]),
  fromCodePoints([0x2067, 0x61, 0x62, 0x2029, 0x63, 0x64, 0x2069]),
  fromCodePoints([0x5d0, 0x1d6c1, 0x5d1]),
  fromCodePoints([0x202e, 0x2b8, 0x202a, 0x2b8, 0x202c, 0x2066, 0x2b8, 0x2069, 0x202a, 0x2b8, 0x202c, 0x2b8, 0x202c]),
  fromCodePoints([0x2067, 0x5d0, 0x5d1, 0xd, 0x5d2, 0x5d3, 0x2069]),
  fromCodePoints([0x5d0, 0xd, 0xa, 0x61]),
  fromCodePoints([0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x20, 0x28, 0x5e2, 0x5d5, 0x5dc, 0x5dd, 0x20, 0x61, 0x62, 0x29, 0x20, 0x63, 0x64]),
]

// What Blink and WebKit get where the resolvers disagree (specs/bidi.md §7.5, measured with ICU).
describe('large auto-direction paragraphs', () => {
  test('each paragraph supplies its own whitespace level', () => {
    const repeats = 8192
    const text = 'a\nא    \n'.repeat(repeats)
    for (const data of [blinkBidiData, webkitBidiData]) {
      const result = resolveIcuBidi(text, 'auto', data)
      const expected = new Uint8Array(text.length)
      const paragraphs: { end: number; level: number }[] = []
      for (let i = 0; i < repeats; i++) {
        expected.fill(1, i * 8 + 2, i * 8 + 8)
        paragraphs.push({ end: i * 8 + 2, level: 0 }, { end: i * 8 + 8, level: 1 })
      }
      expect(result.direction).toBe('mixed')
      expect(result.levels).toEqual(expected)
      expect(result.paragraphs).toEqual(paragraphs)
    }
  })
})

describe('ICU behaviour the engines depend on', () => {
  const data = blinkBidiData
  test('D5: Arabic-Indic digits right after letters are not mixed, so every level is 0 and Blink turns bidi off', () => {
    const r = resolveIcuBidi(DIRECTED[4]!, 'ltr', data)
    expect(r.direction).toBe('ltr')
    expect(Array.from(r.levels)).toEqual([0, 0, 0, 0, 0])
  })
  test('D3: a soft hyphen takes the next character\'s level', () => {
    expect(Array.from(resolveIcuBidi(DIRECTED[2]!, 'ltr', data).levels)).toEqual([1, 1, 1, 1, 0, 0, 0, 0])
  })
  test('D8: an NSM after a changed closing bracket stays neutral', () => {
    expect(Array.from(resolveIcuBidi(DIRECTED[7]!, 'rtl', data).levels)).toEqual([2, 2, 2, 2, 1])
  })
  test('Probe 11: CR ends a paragraph inside an isolate', () => {
    const r = resolveIcuBidi(DIRECTED[14]!, 'ltr', data)
    expect(r.paragraphs).toEqual([{ end: 4, level: 0 }, { end: 7, level: 0 }])
  })
})
