// The second reader's cases against the 'lam-alef' default of the x-lam-alef study: short words that hold lam and an alef
// in the ways a font may or may not ligate, at widths where an overflow break falls inside the word.
//   bun rebuild/tools/cluster-default/attack-cases.ts <out file.ndjson>
// Every text is built from code points. Each runs in 13 families x 2 ways to break inside a word (overflow-wrap: break-word,
// word-break: break-all) x 14 widths from 5 to 44 px, 16px, direction rtl; the plain word also runs under direction ltr.
import { writeFileSync } from 'node:fs'
import { font, paragraph, span, text, type Part } from '../../lab/cases/build.ts'
import { makeCase, sortCases } from '../../lab/cases/case.ts'
import type { Case, Paragraph } from '../../lab/types.ts'

const out = process.argv[2]!
const s = (...cps: number[]): string => String.fromCodePoint(...cps)
const LAM = 0x644, ALEF = 0x627, BEH = 0x628, SEEN = 0x633, MEEM = 0x645, KAF = 0x643
const FATHA = 0x64e, KASRA = 0x650, SHADDA = 0x651, FATHATAN = 0x64b

// name, what it asks, the parts as a function of the family's font (a span edge needs one)
type Shape = { name: string; letterSpacing: number; parts: (f: ReturnType<typeof font>, other: ReturnType<typeof font>, bigger: ReturnType<typeof font>) => Part[] }
const plain = (name: string, value: string, letterSpacing = 0): Shape => ({ name, letterSpacing, parts: () => [text(value)] })
const SHAPES: Shape[] = [
  plain('final', s(BEH, KASRA, LAM, ALEF)),
  plain('isolated', s(LAM, ALEF)),
  plain('initial-then-letter', s(LAM, ALEF, BEH, SEEN)),
  plain('medial-word', s(ALEF, LAM, SEEN, LAM, ALEF, MEEM)),
  plain('twice', s(KAF, LAM, ALEF, LAM, ALEF)),
  plain('mark-between', s(BEH, LAM, FATHA, ALEF, BEH)),
  plain('two-marks-between', s(BEH, LAM, SHADDA, FATHA, ALEF, BEH)),
  plain('mark-after', s(BEH, LAM, ALEF, FATHATAN)),
  plain('cgj-between', s(BEH, LAM, 0x34f, ALEF, BEH)),
  plain('zwnj-between', s(BEH, LAM, 0x200c, ALEF, BEH)),
  plain('zwj-between', s(BEH, LAM, 0x200d, ALEF, BEH)),
  plain('soft-hyphen-between', s(BEH, LAM, 0xad, ALEF, BEH)),
  plain('word-joiner-between', s(BEH, LAM, 0x2060, ALEF, BEH)),
  plain('rlm-between', s(BEH, LAM, 0x200f, ALEF, BEH)),
  plain('tatweel-between', s(BEH, LAM, 0x640, ALEF, BEH)),
  plain('alef-madda', s(BEH, LAM, 0x622, BEH)),
  plain('alef-hamza-above', s(BEH, LAM, 0x623, BEH)),
  plain('alef-hamza-below', s(BEH, LAM, 0x625, BEH)),
  plain('alef-wasla', s(BEH, LAM, 0x671, BEH)),
  plain('letter-spacing-plus', s(BEH, KASRA, LAM, ALEF), 2),
  plain('letter-spacing-minus', s(BEH, KASRA, LAM, ALEF), -0.5),
  plain('letter-spacing-word', s(ALEF, LAM, SEEN, LAM, ALEF, MEEM), 1),
  { name: 'span-edge-same-style', letterSpacing: 0, parts: f => [text(s(BEH, LAM)), span(s(ALEF, BEH), f)] },
  { name: 'span-edge-bigger', letterSpacing: 0, parts: (_f, _o, bigger) => [text(s(BEH, LAM)), span(s(ALEF, BEH), bigger)] },
  { name: 'span-edge-other-font', letterSpacing: 0, parts: (_f, other) => [text(s(BEH, LAM)), span(s(ALEF, BEH), other)] },
  { name: 'span-edge-spaced-span', letterSpacing: 0, parts: f => [text(s(BEH, LAM)), span(s(ALEF, BEH), f, { letterSpacing: 1 })] },
]
const FAMILIES: { family: string; fixture: string | null }[] = [
  { family: 'Georgia', fixture: null }, { family: '"Geeza Pro"', fixture: null }, { family: 'Arial', fixture: null },
  { family: '"Times New Roman"', fixture: null }, { family: '"Courier New"', fixture: null }, { family: 'Tahoma', fixture: null },
  { family: '"Microsoft Sans Serif"', fixture: null }, { family: '"Arial Unicode MS"', fixture: null }, { family: 'Damascus', fixture: null },
  { family: 'system-ui', fixture: null },
  { family: 'Amiri', fixture: 'Amiri' }, { family: '"Noto Naskh Arabic"', fixture: 'Noto Naskh Arabic' }, { family: '"Noto Nastaliq Urdu"', fixture: 'Noto Nastaliq Urdu' },
]
const MODES: { name: string; overflowWrap: Paragraph['overflowWrap']; wordBreak: Paragraph['wordBreak'] }[] = [
  { name: 'break-word', overflowWrap: 'break-word', wordBreak: 'normal' },
  { name: 'break-all', overflowWrap: 'normal', wordBreak: 'break-all' },
]
const WIDTHS = [5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44]
const cases: Case[] = []
for (let n = 0; n < SHAPES.length; n++) {
  const shape = SHAPES[n]!
  for (let f = 0; f < FAMILIES.length; f++) {
    const { family, fixture } = FAMILIES[f]!
    const fontFixtures = fixture === null ? [] : [fixture]
    const other = family === 'Arial' ? font('"Geeza Pro"', 16) : font('Arial', 16)
    const parts = shape.parts(font(family, 16), other, font(family, 20))
    const directions: Paragraph['direction'][] = shape.name === 'final' ? ['rtl', 'ltr'] : ['rtl']
    for (let m = 0; m < MODES.length; m++) {
      const mode = MODES[m]!
      for (let d = 0; d < directions.length; d++) {
        const base = paragraph({ font: font(family, 16), lang: 'ar', direction: directions[d]!, letterSpacing: shape.letterSpacing, overflowWrap: mode.overflowWrap, wordBreak: mode.wordBreak }, parts)
        for (let w = 0; w < WIDTHS.length; w++) {
          cases.push(makeCase({ family: `lam-alef-attack/${shape.name}`, origin: `x-lam-alef attack shape=${shape.name} mode=${mode.name}`, pageLang: 'ar', paragraph: { ...base, width: WIDTHS[w]! }, browsers: ['chrome'], fontFixtures }))
        }
      }
    }
  }
}
writeFileSync(out, sortCases(cases).map(c => JSON.stringify(c)).join('\n') + '\n')
console.log(`${cases.length} cases`)
