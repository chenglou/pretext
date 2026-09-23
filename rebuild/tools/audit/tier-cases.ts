// The tier sets (tests/sets.ts) of one browser as one case file for the audit's knockout runs: every set the browser runs
// but features-en-US (which needs other process languages), each case once, in the sets' order. These are the adversarial
// rows: rule and feature families, suite samples, held-out families, the wide-group-cuts attack set.
//   bun rebuild/tools/audit/tier-cases.ts --browser=<b> --out=<file>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { partPaths, SETS, type TierBrowser } from '../../tests/sets.ts'

const arg = (name: string): string => process.argv.find(a => a.startsWith(`--${name}=`))!.split('=')[1]!
const browser = arg('browser') as TierBrowser
const root = join(process.env['HOME']!, 'github/pretext-rebuild')
const seen = new Set<string>()
const out: string[] = []
const counts: Record<string, number> = {}
for (const set of SETS) {
  if (!set.browsers.includes(browser) || set.name === 'features-en-US') continue
  for (const part of partPaths(set, browser)) {
    const path = join(root, part)
    if (!existsSync(path)) throw new Error(`missing ${path}`)
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line === '') continue
      const id = (JSON.parse(line) as { id: string }).id
      if (seen.has(id)) continue
      seen.add(id)
      out.push(line)
      counts[set.name] = (counts[set.name] ?? 0) + 1
    }
  }
}
writeFileSync(arg('out'), out.join('\n') + '\n')
console.log(browser, out.length, JSON.stringify(counts))
