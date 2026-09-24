// Lab cases for the layouts tools/bwf-constructed-probe.ts found differing between the base and the head, so the browser's
// own layout can say which tree it agrees with (lab/run.ts with the base's predictor, then the head's with --predict-only,
// then lab/score.ts on each), and the transitions between the two scores.
//
//   bun rebuild/tools/bwf-constructed-verdict.ts cases --probe=<dir>/chrome-probes.json[,<more>] --cases=<cases.ndjson> --out=<verdict cases.ndjson> [--limit=40]
//   bun rebuild/tools/bwf-constructed-verdict.ts cases --attack=<words-attack report.json>[,<more>] --cases=<cases.ndjson> --out=<verdict cases.ndjson> [--limit=40]
//   bun rebuild/tools/bwf-constructed-verdict.ts compare --base=<base per-case.ndjson> --head=<head per-case.ndjson> --cases=<verdict cases.ndjson>
//
// --limit is the most layouts a source case gives. The ids are in no registry.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeCase } from '../lab/cases/case.ts'
import type { Case } from '../lab/types.ts'

const [command, ...rest] = process.argv.slice(2)
const options = new Map<string, string>()
for (const raw of rest) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const readCases = (path: string): Map<string, Case> => {
  const out = new Map<string, Case>()
  for (const line of readFileSync(resolve(path), 'utf8').split('\n')) if (line !== '') { const c = JSON.parse(line) as Case; out.set(c.id, c) }
  return out
}

type Differing = { id: string; family: string; width: number }
if (command === 'cases') {
  const source = readCases(options.get('cases')!)
  const limit = Number(options.get('limit') ?? 40)
  const lines: string[] = []
  const seen = new Set<string>()
  const taken = new Map<string, number>()
  // A probe's differing layouts, or a words-attack report's differences between the two trees (the stand-in's, which the
  // browser may or may not repeat).
  const lists: Differing[][] = []
  for (const file of (options.get('probe') ?? '').split(',').filter(f => f !== '')) {
    const report = JSON.parse(readFileSync(resolve(file), 'utf8')) as { results: Array<{ result: { observations: Array<{ value: { differing: Differing[] } }> } }> }
    for (let r = 0; r < report.results.length; r++) lists.push(report.results[r]!.result.observations[0]!.value.differing)
  }
  for (const file of (options.get('attack') ?? '').split(',').filter(f => f !== '')) {
    const report = JSON.parse(readFileSync(resolve(file), 'utf8')) as { differences: Array<Differing & { check: string }> }
    lists.push(report.differences.filter(d => d.check === 'trees'))
  }
  {
    for (let r = 0; r < lists.length; r++) {
      const differing = lists[r]!
      for (let i = 0; i < differing.length; i++) {
        const d = differing[i]!
        const c = source.get(d.id)
        if (c === undefined) throw new Error(`no case ${d.id}`)
        if ((taken.get(d.id) ?? 0) >= limit) continue
        taken.set(d.id, (taken.get(d.id) ?? 0) + 1)
        const made = makeCase({ family: `con-verdict/${c.family.slice(4)}`, origin: `tools/bwf-constructed-verdict.ts source=${c.id} width=${d.width}`, pageLang: c.pageLang, paragraph: { ...c.paragraph, width: d.width }, inline: c.inline, fontFixtures: c.fontFixtures })
        if (seen.has(made.id)) continue
        seen.add(made.id)
        lines.push(JSON.stringify(made))
      }
    }
  }
  writeFileSync(resolve(options.get('out')!), `${lines.join('\n')}\n`)
  console.log(`[bwf-constructed-verdict] ${lines.length} cases`)
} else if (command === 'compare') {
  const cases = readCases(options.get('cases')!)
  type Row = { id: string; [metric: string]: unknown }
  const load = (path: string): Map<string, Row> => {
    const out = new Map<string, Row>()
    for (const line of readFileSync(resolve(path), 'utf8').split('\n')) if (line !== '') { const r = JSON.parse(line) as Row; out.set(r.id, r) }
    return out
  }
  const base = load(options.get('base')!)
  const head = load(options.get('head')!)
  const tally: Record<string, number> = {}
  const lost: string[] = []
  for (const [id, b] of base) {
    const h = head.get(id)
    if (h === undefined) continue
    const c = cases.get(id)!
    for (const metric of ['lineCount', 'breaks', 'widths']) {
      const bs = (b[metric] as { status: string }).status
      const hs = (h[metric] as { status: string }).status
      if (bs === hs) continue
      const key = `${metric} ${c.family} ${bs}>${hs}`
      tally[key] = (tally[key] ?? 0) + 1
      if (bs === 'pass' && metric !== 'widths') lost.push(`${id} ${metric} ${c.family} ${c.paragraph.font.family} ${c.paragraph.font.size}px ls=${c.paragraph.letterSpacing} ws=${c.paragraph.wordSpacing} ${c.paragraph.whiteSpace} w=${c.paragraph.width}: ${String((h[metric] as { detail?: string }).detail ?? '').slice(0, 160)}`)
    }
  }
  const keys = Object.keys(tally).sort()
  for (let i = 0; i < keys.length; i++) console.log(`${keys[i]}: ${tally[keys[i]!]}`)
  console.log(`lost passes (breaks, line counts): ${lost.length}`)
  for (let i = 0; i < lost.length; i++) console.log(`  ${lost[i]}`)
} else {
  throw new Error('usage: bwf-constructed-verdict.ts cases|compare ...')
}
