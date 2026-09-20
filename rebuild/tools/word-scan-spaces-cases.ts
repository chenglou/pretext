// Lab cases for Gecko's word scan (src/engines/gecko/lines.ts wordScan) in the real Firefox: every space-like character
// inside a word under negative word spacing, at the widths where a word's prefix is wider than the word if the
// character takes the spacing. The word scan passes over a word whose end fits, so it needs the port's spacing data to
// say which characters take word spacing: U+0020 and U+00A0 do (IsCSSWordSpacingSpace, nsTextFrame.cpp:879-898), the
// other spaces don't, and only U+0020 and U+00A0 end a shaping unit, and not before a join control (IsBoundarySpace,
// gfxFont.cpp:3317-3330). A case that fails under the plain predictor and passes under the usual one is a wrong line
// of the word scan; one that fails under both is the port's spacing, not the word scan.
//   bun rebuild/tools/word-scan-spaces-cases.ts --out=<cases.ndjson>
//   bun rebuild/lab/run.ts --browser=firefox --cases=<cases.ndjson> --out=<dir> --order=file --predictor=rebuild/lab/baselines/plain-predictor.ts
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { font, leaf, treeParagraph, type BlockSpec } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import type { Case } from '../lab/types.ts'

const out = process.argv.slice(2).find(arg => arg.startsWith('--out='))
if (out === undefined) throw new Error('--out=<cases.ndjson>')

const c = (...codes: number[]): string => String.fromCodePoint(...codes)
const SPACES = [0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]
// After the space: a join control (the space is then inside a word whatever it is), nothing, a bidi control and a join
// control (the combining sequence tail test skips bidi controls, nsTextFrameUtils.cpp:24-30).
const AFTER = [c(0x200d), c(0x200c), '', c(0x200e, 0x200d)]
const WHITE_SPACE = ['normal', 'pre-wrap', 'break-spaces'] as const
const FAMILIES = ['Arial', 'Times New Roman']
const SPACINGS = [-30, -20]
// 16px `aaaa` is 35.6px in Arial and 28.4px in "Times New Roman"; with -30px on the space the word `aaaa bb` is 27.8
// and 14.4px.
const WIDTHS = [16, 24, 28, 30, 32, 36, 40, 48]

const cases: Case[] = []
for (let s = 0; s < SPACES.length; s++) for (let a = 0; a < AFTER.length; a++) for (let ws = 0; ws < WHITE_SPACE.length; ws++) {
  const text = `aaaa${c(SPACES[s]!)}${AFTER[a]!}bb cc`
  for (let f = 0; f < FAMILIES.length; f++) for (let k = 0; k < SPACINGS.length; k++) for (let w = 0; w < WIDTHS.length; w++) {
    const spec: BlockSpec = { font: font(FAMILIES[f]!, 16), lang: 'en', lineHeight: 40, wordSpacing: SPACINGS[k]!, whiteSpace: WHITE_SPACE[ws]!, overflowWrap: 'break-word' }
    const made = treeParagraph(spec, [leaf(text)])
    cases.push(makeCase({
      family: 'attack/space-like-word-spacing', origin: `words2-gecko-attack U+${SPACES[s]!.toString(16).toUpperCase().padStart(4, '0')} after=${a} ${WHITE_SPACE[ws]!}`, pageLang: 'en',
      paragraph: { ...made.paragraph, width: WIDTHS[w]! }, inline: made.inline,
    }))
  }
}
writeFileSync(resolve(out.slice('--out='.length)), `${cases.map(one => JSON.stringify(one)).join('\n')}\n`)
console.log(`${cases.length} cases`)
