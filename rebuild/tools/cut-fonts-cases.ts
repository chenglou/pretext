// Lab cases for the families tools/cut-fonts-probe.ts names: the probe's own texts in one family, at the probe's ordinary
// widths and at the widths it found beside a cut, so the lab can hold the base's and the head's lines against the
// browser's own layout (lab/run.ts, lab/score.ts). The probe compares two trees with each other; which of them the browser
// agrees with only an observed case says. Brought over from the words study (branch x-spec-words-blink,
// tools/words-fonts-cases.ts).
//
//   bun rebuild/tools/cut-fonts-cases.ts --probe=<the probe's chrome-probes.json> --families=Zapfino,"Euphemia UCAS",!serif \
//     --out=<cases.ndjson> [--texts=ligatures,arabic] [--sizes=16,28]
//
// A family must be one whose widths the probe listed (its CUT_DETAIL list, or a family that differed). The ids are in no
// registry and --out has no default, so no run writes into the lab's case folder by accident.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { font, paragraph, text } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { TEXTS } from './cut-fonts-probe.ts'

type Row = { family: string; resolves: boolean; targets?: Array<{ text: number; size: number; widths: number[] }> }

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const report = JSON.parse(readFileSync(resolve(options.get('probe')!), 'utf8')) as { results: Array<{ result: { observations: Array<{ value: { fonts: Row[] } }> } }> }
const rows = report.results[0]!.result.observations[0]!.value.fonts
const families = options.get('families')!.split(',')
const names = options.get('texts')?.split(',') ?? null
const sizes = options.get('sizes')?.split(',').map(Number) ?? null
const ordinary = [97.3, 200, 320, 560]
const lines: string[] = []
for (let f = 0; f < families.length; f++) {
  const row = rows.find(candidate => candidate.family === families[f]!)
  if (row === undefined || row.targets === undefined || row.targets.length === 0) throw new Error(`the probe lists no widths for ${families[f]!}`)
  const family = families[f]!.startsWith('!') ? families[f]!.slice(1) : families[f]!
  for (let p = 0; p < row.targets.length; p++) {
    const target = row.targets[p]!
    const given = TEXTS[target.text]!
    if (names !== null && !names.includes(given.name)) continue
    if (sizes !== null && !sizes.includes(target.size)) continue
    const widths = ordinary.slice()
    for (let i = 0; i < target.widths.length; i++) if (!widths.includes(target.widths[i]!)) widths.push(target.widths[i]!)
    for (let w = 0; w < widths.length; w++) {
      const made = paragraph({ font: font(family, target.size), lang: given.lang, lineHeight: target.size * 2, overflowWrap: 'break-word', direction: given.rtl ? 'rtl' : 'ltr' }, [text(given.text)])
      lines.push(JSON.stringify(makeCase({ family: 'cut-fonts/probe-texts', origin: `tools/cut-fonts-cases.ts family=${families[f]!} text=${given.name} size=${target.size} width=${widths[w]!}`, pageLang: 'en', paragraph: { ...made, width: widths[w]! } })))
    }
  }
}
writeFileSync(resolve(options.get('out')!), `${lines.join('\n')}\n`)
console.log(`[cut-fonts-cases] ${lines.length} cases`)
