// Whether two runs of the same cases recorded the same things: per case, the native observation, the prediction and the
// painted lines, each compared whole as JSON. For checks of the lab itself: a pinned browser against the installed one, a
// recorded run against a plain one, sharded against unsharded, installed Safari against webkit-host with the same parts,
// the usual protocol against measure first (rebuild/tests/compare-sets.ts runs it over two tier 2 folders).
// Environments and timings aren't compared. Rows pair by case id, so the two runs may differ in order.
//
//   bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]] [--report=<file.json>]
//     [--prediction=line-ranges|without-measure]
//
// It streams the first file and reads the second by byte offset; either may be compressed (rows.ts). --report writes every
// differing case: for a native observation what the scorer compares (score.ts nativeDifference: line count, every rect's x,
// width and native line), or that only values outside it differ (y, height, font status); for a prediction and for painted
// lines the first differing field. Exit 1 when a row is missing or anything differs.
//
// --prediction=line-ranges compares the predictions as line ranges alone, for a run of a predictor that returns a
// LinesPrediction (the re-architecture's plain predictor) against a run whose predictions are engine layouts: a
// LinesPrediction's lines, and of a layout the lines that have a line box, which are the lines score.ts counts a
// LinesPrediction's against; every range's start and end must agree, a line's width isn't compared (CSS px on one side,
// engine units on the other), and neither are painted lines, which a LinesPrediction has none of. The native observations
// are compared as always: a run that asks Canvas less can leave the page another history. Exit 1 when a row is missing
// or line ranges differ, 3 when only native observations do.
//
// --prediction=without-measure compares the predictions without their counts of Canvas work (types.ts CanvasWork), for a
// run whose predictor asks Canvas more for the same layout (baselines/other-widths-first-predictor.ts): the layout, the
// observation port's expectation, the painter's limits and the painted lines must agree. Exit 1 when a row is missing or
// any of those differ, 3 when only native observations do.
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

export type PredictionView = 'whole' | 'line-ranges' | 'without-measure'

// A prediction as line ranges (the file comment), or its error.
export function lineRanges(prediction: LabRow['prediction']): Array<[number, number]> | { error: string } {
  if ('error' in prediction) return { error: prediction.error }
  const out: Array<[number, number]> = []
  if ('layout' in prediction) {
    const lines = prediction.layout.lines
    for (let l = 0; l < lines.length; l++) if (lines[l]!.hasLineBox) out.push([lines[l]!.start, lines[l]!.end])
  } else {
    for (let l = 0; l < prediction.lines.length; l++) out.push([prediction.lines[l]!.start, prediction.lines[l]!.end])
  }
  return out
}

// A prediction without its count of Canvas work.
function withoutMeasure(prediction: LabRow['prediction']): unknown {
  if (!('layout' in prediction)) return prediction
  const { measure: _measure, ...rest } = prediction
  return rest
}

export async function compareRowFiles(rowsPath: string, otherPath: string, wanted: ReadonlySet<string> | null, view: PredictionView = 'whole'): Promise<RowComparison> {
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
        if (view === 'line-ranges' && part === 'painter') continue
        const ranges = view === 'line-ranges' && part === 'prediction'
        const unmeasured = view === 'without-measure' && part === 'prediction'
        const mine: unknown = ranges ? lineRanges(row.prediction) : unmeasured ? withoutMeasure(row.prediction) : row[part]
        const theirs: unknown = ranges ? lineRanges(otherRow.prediction) : unmeasured ? withoutMeasure(otherRow.prediction) : otherRow[part]
        if (JSON.stringify(mine) === JSON.stringify(theirs)) continue
        result[part]++
        const first = firstDifference(mine, theirs, ranges ? 'line ranges' : part) ?? `${part}: key order`
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

// 0 when nothing differs. Whole predictions: 1 otherwise. The other views: 1 when a row is missing or what they compare of
// the predictions and painted lines differs, 3 when only native observations do, which are read as history effects of
// another set of Canvas questions.
export function comparisonExit(result: { missing: number | string[]; native: number; prediction: number; painter: number }, view: PredictionView): number {
  const missing = typeof result.missing === 'number' ? result.missing : result.missing.length
  if (view === 'whole') return missing + result.native + result.prediction + result.painter === 0 ? 0 : 1
  return missing + result.prediction + result.painter > 0 ? 1 : result.native > 0 ? 3 : 0
}

export function comparisonLine(result: RowComparison): string {
  const examples = result.differences.slice(0, 10).map(difference => `${difference.id} ${PARTS.filter(part => difference[part] !== undefined).join('+')}`)
  return `${result.rows} rows: ${result.missing.length} missing in the other file; differing native observations ${result.native} (${result.nativeScorerView} in what the scorer compares), predictions ${result.prediction}, painted lines ${result.painter}${examples.length === 0 ? '' : `; ${examples.join(', ')}`}`
}

if (import.meta.main) {
  const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  const idsArg = process.argv.slice(2).find(arg => arg.startsWith('--ids='))
  const reportArg = process.argv.slice(2).find(arg => arg.startsWith('--report='))
  const viewArg = process.argv.slice(2).find(arg => arg.startsWith('--prediction='))?.slice('--prediction='.length) ?? 'whole'
  const view = (['whole', 'line-ranges', 'without-measure'] as const).find(name => name === viewArg)
  if (paths.length !== 2 || view === undefined) throw new Error('Usage: bun rebuild/lab/compare-rows.ts <rows.ndjson> <other rows.ndjson> [--ids=<id>[,<id>...]] [--report=<file.json>] [--prediction=line-ranges|without-measure]')
  const result = await compareRowFiles(paths[0]!, paths[1]!, idsArg === undefined ? null : new Set(idsArg.slice('--ids='.length).split(',')), view)
  if (reportArg !== undefined) writeFileSync(reportArg.slice('--report='.length), `${JSON.stringify(result, null, 2)}\n`)
  console.log(comparisonLine(result))
  process.exit(comparisonExit(result, view))
}
