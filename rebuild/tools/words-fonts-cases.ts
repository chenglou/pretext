// Lab cases for the families tools/words-fonts-probe.ts names: the probe's own texts in one family at the probe's widths,
// so the lab can hold the base's and the prototype's lines against the browser's own layout (lab/run.ts, lab/score.ts).
// The probe compares two trees with each other; which of them the browser agrees with only an observed case says.
//
//   bun rebuild/tools/words-fonts-cases.ts --families=Zapfino,"Euphemia UCAS" --texts=0,2,4 --out=<cases.ndjson> [--widths=60,97.3,140,200,260,320]
//
// The ids are in no registry and --out has no default, so no run writes into the lab's case folder by accident.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { font, paragraph, text } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { TEXTS } from './words-fonts-probe.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const families = options.get('families')!.split(',')
const texts = options.get('texts')!.split(',').map(Number)
const widths = (options.get('widths') ?? '60,97.3,140,200,260,320').split(',').map(Number)
const lines: string[] = []
for (let f = 0; f < families.length; f++) {
  for (let t = 0; t < texts.length; t++) {
    const given = TEXTS[texts[t]!]!
    for (let w = 0; w < widths.length; w++) {
      const made = paragraph({ font: font(families[f]!, 16), lang: given.lang, lineHeight: 60, overflowWrap: 'break-word' }, [text(given.text)])
      lines.push(JSON.stringify(makeCase({ family: 'words-fonts/probe-texts', origin: `tools/words-fonts-cases.ts family=${families[f]!} text=${texts[t]!} width=${widths[w]!}`, pageLang: 'en', paragraph: { ...made, width: widths[w]! } })))
    }
  }
}
writeFileSync(resolve(options.get('out')!), `${lines.join('\n')}\n`)
console.log(`[words-fonts-cases] ${lines.length} cases`)
