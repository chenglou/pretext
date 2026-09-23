// What Blink's cut search does on recorded answers. Needs the scratch tree (tools/audit/knockouts.patch applied), whose
// src/ko.ts counts the search into globalThis.__auditCutStats: searches of groups of 256
// zoomed px or more, the safe tests tried, how often the first offset tried passes, where the passing cut is, and the
// window shrinks that only ask whether a window is still 256 zoomed px or wider.
//   bun rebuild/tools/audit/cut-stats.ts --run=<recording run dir> [--family=<prefix>]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installReplay, type PageFacts } from '../../lab/measurements.ts'
import type { CaseMeasurements } from '../../lab/record.ts'
import type { Case, LabRow } from '../../lab/types.ts'
import { predict } from './count-predictor.ts'

const arg = (name: string): string | undefined => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const run = arg('run')!
const family = arg('family') ?? ''
const lines = (path: string): string[] => new TextDecoder().decode(path.endsWith('.zst') ? Bun.spawnSync(['zstd', '-dc', path], { stdout: 'pipe', maxBuffer: 2 ** 32 }).stdout : readFileSync(path)).split('\n').filter(l => l !== '')
const rows = lines(join(run, 'chrome-rows.ndjson'))
const records = lines(join(run, 'chrome-measurements.ndjson.zst'))
let n = 0
for (let i = 0; i < rows.length; i++) {
  const row = JSON.parse(rows[i]!) as LabRow
  if (!row.family.startsWith(family)) continue
  const record = JSON.parse(records[i]!) as CaseMeasurements
  const env: PageFacts = { userAgent: row.env.userAgent, devicePixelRatio: row.env.devicePixelRatio, pageLang: row.env.pageLang }
  const replay = installReplay(record, env, 'predict')
  try { predict(row.case as Case, { browser: row.browser, build: row.build!.engine, languages: row.languages!.given }) } finally { replay.restore() }
  n++
}
const s = (globalThis as { __auditCutStats?: { searches: number; tries: number; firstPassed: number; passedBesideSpace: number; passedElsewhere: number; unsafe: number; uncut: number; pairFailed: number; wideFailed: number; shrinks: number; shrinkChars: number; windowCalls: number; tryHistogram: number[] } }).__auditCutStats
if (s === undefined) throw new Error('run this in the scratch tree: tools/audit/knockouts.patch counts the cut search')
console.log(`${n} paragraphs (${family || 'all'}): ${s.searches} searches of wide groups or pieces, ${(s.searches / n).toFixed(1)} a paragraph`)
console.log(`  safe tests tried ${s.tries} (${(s.tries / s.searches).toFixed(2)} a search); the first offset tried passed in ${s.firstPassed} (${(100 * s.firstPassed / s.searches).toFixed(1)}%)`)
console.log(`  cut beside a space ${s.passedBesideSpace}, elsewhere ${s.passedElsewhere}, no offset passed (unsafe cut) ${s.unsafe}, no grapheme boundary ${s.uncut}`)
console.log(`  failures: pair window ${s.pairFailed}, wide window ${s.wideFailed}; wide windows measured ${s.windowCalls}, shrinks ${s.shrinks} (${(s.shrinks / Math.max(1, s.windowCalls)).toFixed(2)} a window), ${s.shrinkChars} characters in shrunk windows (${(s.shrinkChars / n).toFixed(0)} a paragraph)`)
console.log(`  tries per search: ${s.tryHistogram.map((c, k) => c > 0 ? `${k}:${c}` : '').filter(x => x).join(' ')}`)
