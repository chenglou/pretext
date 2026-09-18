// Whether two runs of the same cases recorded the same things: per case, the native observation, the prediction and the
// painted lines, each compared whole as JSON. For checks of the lab itself: a pinned browser against the installed one, a
// recorded run against a plain one, sharded against unsharded, installed Safari against webkit-host with the same parts.
// Environments and timings aren't compared. Rows pair by case id, so the two runs may differ in order.
//
//   bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]]
//
// It streams the first file and reads the second by byte offset. Exit 1 when a row is missing or anything differs.
import { closeSync, openSync } from 'node:fs'
import { indexRows, readLines, readRowAt } from './score.ts'
import type { LabRow } from './types.ts'

const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const idsArg = process.argv.slice(2).find(arg => arg.startsWith('--ids='))
if (paths.length !== 2) throw new Error('Usage: bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]]')
const wanted = idsArg === undefined ? null : new Set(idsArg.slice('--ids='.length).split(','))
const index = await indexRows(paths[1]!)
const fd = openSync(paths[1]!, 'r')
const parts = ['native', 'prediction', 'painter'] as const
const counts = { rows: 0, missing: 0, native: 0, prediction: 0, painter: 0 }
const examples: string[] = []
try {
  for await (const line of readLines(paths[0]!)) {
    const row = JSON.parse(line) as LabRow
    if (wanted !== null && !wanted.has(row.id)) continue
    counts.rows++
    const entry = index.get(row.id)
    if (entry === undefined) {
      counts.missing++
      continue
    }
    const other = readRowAt(fd, entry)
    for (let i = 0; i < parts.length; i++) {
      if (JSON.stringify(row[parts[i]!]) === JSON.stringify(other[parts[i]!])) continue
      counts[parts[i]!]++
      if (examples.length < 10) examples.push(`${row.id} ${parts[i]}`)
    }
  }
} finally {
  closeSync(fd)
}
console.log(`${counts.rows} rows: ${counts.missing} missing in the other file; differing native observations ${counts.native}, predictions ${counts.prediction}, painted lines ${counts.painter}${examples.length === 0 ? '' : `; ${examples.join(', ')}`}`)
process.exit(counts.missing + counts.native + counts.prediction + counts.painter === 0 ? 0 : 1)
