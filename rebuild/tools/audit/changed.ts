// The cases whose predicted lines differ between a baseline run and any of several knockout runs (predict-only rows), per
// knockout and in all, and a case file of their union, so only those need a native observation.
//   bun rebuild/tools/audit/changed.ts --base=<rows> --ko=<rows>[,<rows>...] --cases=<cases.ndjson> --out=<changed cases.ndjson>
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

const arg = (name: string): string => process.argv.find(a => a.startsWith(`--${name}=`))!.slice(name.length + 3)
function lines(path: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line === '') continue
    const row = JSON.parse(line) as { id: string; prediction: { lines?: unknown; error?: string } }
    map.set(row.id, JSON.stringify(row.prediction.lines ?? row.prediction.error))
  }
  return map
}
const base = lines(arg('base'))
const union = new Set<string>()
for (const path of arg('ko').split(',')) {
  const ko = lines(path)
  let changed = 0
  for (const [id, l] of ko) if (base.get(id) !== l) { changed++; union.add(id) }
  console.log(`${basename(dirname(path))}: ${ko.size} cases, ${changed} with other lines`)
}
const out: string[] = []
for (const line of readFileSync(arg('cases'), 'utf8').split('\n')) if (line !== '' && union.has((JSON.parse(line) as { id: string }).id)) out.push(line)
writeFileSync(arg('out'), out.join('\n') + (out.length > 0 ? '\n' : ''))
console.log(`union: ${union.size} cases -> ${arg('out')}`)
