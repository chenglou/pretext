// Whether two runs of the same cases recorded the same things: per case, the native observation, the prediction and the
// painted lines, each compared whole as JSON. For checks of the lab itself: a pinned browser against the installed one, a
// recorded run against a plain one, sharded against unsharded, installed Safari against webkit-host with the same parts,
// the usual protocol against measure first (rebuild/tests/compare-sets.ts runs it over two tier 2 folders).
// Environments and timings aren't compared. Rows pair by case id, so the two runs may differ in order.
//
//   bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]] [--report=<file.json>]
//
// It streams the first file and reads the second by byte offset; either may be compressed (rows.ts). --report writes every
// differing case: for a native observation what the scorer compares (score.ts nativeDifference: line count, every rect's x,
// width and native line), or that only values outside it differ (y, height, font status); for a prediction and for painted
// lines the first differing field. Exit 1 when a row is missing or anything differs.
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { plainRows, readLines } from './rows.ts'
import { indexRows, nativeDifference, nativeView, readRowAt } from './score.ts'
import type { LabRow } from './types.ts'

const PARTS = ['native', 'prediction', 'painter'] as const
export type RowDifference = {
  id: string
  family: string
  // Per part that differs: what differs first. `nativeLines` says whether the scorer's view of the native observation
  // differs (line count, rects' x, width or line), which is what makes a case history-dependent between two orders.
  native?: { scorerView: string | null; first: string }
  prediction?: { first: string }
  painter?: { first: string }
}
export type RowComparison = { rows: number; missing: string[]; native: number; nativeScorerView: number; prediction: number; painter: number; differences: RowDifference[] }

// The first field that differs between two JSON values, in key order, with both values cut short.
function firstDifference(before: unknown, after: unknown, path: string): string | null {
  if (before === after) return null
  const show = (value: unknown): string => {
    const text = value === undefined ? 'absent' : JSON.stringify(value)
    return text.length > 120 ? `${text.slice(0, 117)}...` : text
  }
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null || Array.isArray(before) !== Array.isArray(after)) return `${path}: ${show(before)} vs ${show(after)}`
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      const found = firstDifference(before[i], after[i], `${path}[${i}]`)
      if (found !== null) return found
    }
    return before.length === after.length ? null : `${path}.length: ${before.length} vs ${after.length}`
  }
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDifference(a[key], b[key], path === '' ? key : `${path}.${key}`)
    if (found !== null) return found
  }
  return null
}

export async function compareRowFiles(rowsPath: string, otherPath: string, wanted: ReadonlySet<string> | null): Promise<RowComparison> {
  const other = plainRows(otherPath)
  const index = await indexRows(other.path)
  const fd = openSync(other.path, 'r')
  const result: RowComparison = { rows: 0, missing: [], native: 0, nativeScorerView: 0, prediction: 0, painter: 0, differences: [] }
  try {
    for await (const line of readLines(rowsPath)) {
      const row = JSON.parse(line) as LabRow
      if (wanted !== null && !wanted.has(row.id)) continue
      result.rows++
      const entry = index.get(row.id)
      if (entry === undefined) {
        result.missing.push(row.id)
        continue
      }
      const otherRow = readRowAt(fd, entry)
      const difference: RowDifference = { id: row.id, family: row.family }
      for (let i = 0; i < PARTS.length; i++) {
        const part = PARTS[i]!
        if (JSON.stringify(row[part]) === JSON.stringify(otherRow[part])) continue
        result[part]++
        const first = firstDifference(row[part], otherRow[part], part) ?? `${part}: key order`
        if (part === 'native') {
          const scorerView = nativeDifference(nativeView(row), nativeView(otherRow))
          if (scorerView !== null) result.nativeScorerView++
          difference.native = { scorerView, first }
        } else {
          difference[part] = { first }
        }
      }
      if (difference.native !== undefined || difference.prediction !== undefined || difference.painter !== undefined) result.differences.push(difference)
    }
  } finally {
    closeSync(fd)
    other.release()
  }
  return result
}

export function comparisonLine(result: RowComparison): string {
  const examples = result.differences.slice(0, 10).map(difference => `${difference.id} ${PARTS.filter(part => difference[part] !== undefined).join('+')}`)
  return `${result.rows} rows: ${result.missing.length} missing in the other file; differing native observations ${result.native} (${result.nativeScorerView} in what the scorer compares), predictions ${result.prediction}, painted lines ${result.painter}${examples.length === 0 ? '' : `; ${examples.join(', ')}`}`
}

if (import.meta.main) {
  const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  const idsArg = process.argv.slice(2).find(arg => arg.startsWith('--ids='))
  const reportArg = process.argv.slice(2).find(arg => arg.startsWith('--report='))
  if (paths.length !== 2) throw new Error('Usage: bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]] [--report=<file.json>]')
  const result = await compareRowFiles(paths[0]!, paths[1]!, idsArg === undefined ? null : new Set(idsArg.slice('--ids='.length).split(',')))
  if (reportArg !== undefined) writeFileSync(reportArg.slice('--report='.length), `${JSON.stringify(result, null, 2)}\n`)
  console.log(comparisonLine(result))
  process.exit(result.missing.length + result.native + result.prediction + result.painter === 0 ? 0 : 1)
}
