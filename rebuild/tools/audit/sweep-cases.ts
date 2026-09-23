// The audit's width sweep: every census real paragraph at 150 to 800 px in steps of 10 px, and every chat message at 180 to
// 440 px in steps of 20 px, so a line end meets more of the places where a knockout's arithmetic differs. Knockouts are
// run predict-only over it; only the cases whose lines differ from the baseline's get a native observation.
//   bun rebuild/tools/audit/sweep-cases.ts --cases=<audit cases dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeCase } from '../../lab/cases/case.ts'
import type { Case } from '../../lab/types.ts'

const dir = process.argv.find(a => a.startsWith('--cases='))!.slice(8)
const read = (name: string): Case[] => readFileSync(join(dir, name), 'utf8').split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Case)
const out: string[] = []
for (const c of read('real-400.ndjson')) {
  const base = c.id.replace(/-w\d+$/, '')
  for (let w = 150; w <= 800; w += 10) out.push(JSON.stringify({ ...c, id: `${base}-w${w}`, paragraph: { ...c.paragraph, width: w } }))
}
const real = out.length
for (const c of read('chat.ndjson')) {
  for (let w = 180; w <= 440; w += 20) {
    const made = makeCase({ family: c.family, origin: `${c.origin} width=${w}`, pageLang: c.pageLang, paragraph: { ...c.paragraph, width: w }, inline: c.inline })
    out.push(JSON.stringify(made))
  }
}
writeFileSync(join(dir, 'sweep.ndjson'), out.join('\n') + '\n')
console.log(`sweep: ${real} real, ${out.length - real} chat`)
