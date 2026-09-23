// Lab cases for the layouts tools/words2-sum-probe.ts found differing between the base and the head, so the browser's own
// layout can say which tree it agrees with (lab/run.ts with each tree's predictor, then lab/score.ts). Only plain
// paragraphs and the styles the lab's paragraph builder takes as they are (letter and word spacing, white-space, text
// indent, justification, the other direction); the span styles are left out.
//
//   bun rebuild/tools/words2-sum-cases.ts --probe=<the probe's chrome-probes.json> --out=<cases.ndjson> [--families=Zapfino,!serif] [--limit=60]
//
// --limit is the most cases a family and text get. The ids are in no registry and --out has no default.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { font, leaf, treeParagraph, type BlockSpec } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { TEXTS } from './words2-sum-probe.ts'

type Differing = { part: string; text: string; style: string; size: number; width: number; paragraph?: string }
type Row = { family: string; resolves: boolean; differing?: Differing[] }

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const report = JSON.parse(readFileSync(resolve(options.get('probe')!), 'utf8')) as { results: Array<{ result: { observations: Array<{ value: { fonts: Row[] } }> } }> }
const rows = report.results[0]!.result.observations[0]!.value.fonts
const families = options.get('families')?.split(',') ?? null
const limit = Number(options.get('limit') ?? 60)
const STYLES: Record<string, Partial<BlockSpec> | null> = {
  'plain': {}, 'letter-spacing': { letterSpacing: 1.5 }, 'word-spacing': { wordSpacing: 4 }, 'negative-word-spacing': { wordSpacing: -2 }, 'pre-wrap': { whiteSpace: 'pre-wrap' },
  'break-spaces': { whiteSpace: 'break-spaces' }, 'justify-indent': { textAlign: 'justify', textIndent: 17.5 }, 'other-direction': {}, 'spans': null, 'padded-spans': null,
}
const lines: string[] = []
const seen = new Set<string>()
for (let f = 0; f < rows.length; f++) {
  const row = rows[f]!
  if (!row.resolves || row.differing === undefined || (families !== null && !families.includes(row.family))) continue
  const family = row.family.startsWith('!') ? row.family.slice(1) : row.family
  const taken = new Map<string, number>()
  for (let i = 0; i < row.differing.length; i++) {
    const d = row.differing[i]!
    const style = STYLES[d.style]
    const given = TEXTS.find(candidate => candidate.name === d.text)!
    if (style === null || style === undefined) continue
    const key = `${d.text}/${d.style}`
    if ((taken.get(key) ?? 0) >= limit) continue
    taken.set(key, (taken.get(key) ?? 0) + 1)
    const rtl = given.rtl !== (d.style === 'other-direction')
    const made = treeParagraph({ font: font(family, d.size), lang: given.lang, lineHeight: d.size * 2, overflowWrap: 'break-word', direction: rtl ? 'rtl' : 'ltr', ...style }, [leaf(d.paragraph ?? given.text)])
    const c = makeCase({ family: 'words2-sum/differing', origin: `tools/words2-sum-cases.ts family=${row.family} text=${d.text}/${d.style} size=${d.size} width=${d.width} part=${d.part}`, pageLang: 'en', paragraph: { ...made.paragraph, width: d.width }, inline: made.inline })
    if (seen.has(c.id)) continue
    seen.add(c.id)
    lines.push(JSON.stringify(c))
  }
}
writeFileSync(resolve(options.get('out')!), `${lines.join('\n')}\n`)
console.log(`[words2-sum-cases] ${lines.length} cases`)
