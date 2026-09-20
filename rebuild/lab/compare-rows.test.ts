// compare-rows.ts --prediction=line-ranges: a run that predicts line ranges alone against a run of engine layouts.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareRowFiles, comparisonExit, lineRanges } from './compare-rows.ts'
import { abcd, abcdExpected, abcdNative, at, blink, native, row } from './row-fixtures.ts'
import type { LabRow } from './types.ts'

const dir = mkdtempSync(join(tmpdir(), 'compare-rows-test-'))
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function rowsFile(name: string, rows: LabRow[]): string {
  const path = join(dir, name)
  writeFileSync(path, rows.map(value => `${JSON.stringify(value)}\n`).join(''))
  return path
}

// `ab cd` on two lines with a line without a line box between them, which a LinesPrediction doesn't list.
const layoutRow = (id: string): LabRow => ({ ...row('chrome', abcd, abcdNative, blink([[0, 3, 2000], [3, 3, 0, false], [3, 5, 1800]]), abcdExpected, []), id })
const linesRow = (id: string, lines: Array<[number, number]>, observed: LabRow['native'] = abcdNative): LabRow => ({ ...layoutRow(id), native: observed, prediction: { lines: lines.map(([start, end]) => ({ start, end, width: 1 })) }, painter: null })

describe('line ranges', () => {
  test('a layout gives the ranges of its lines with a line box; a LinesPrediction its lines; an error stays one', () => {
    expect(lineRanges(layoutRow('a').prediction)).toEqual([[0, 3], [3, 5]])
    expect(lineRanges(linesRow('a', [[0, 3], [3, 5]]).prediction)).toEqual([[0, 3], [3, 5]])
    expect(lineRanges({ error: 'threw' })).toEqual({ error: 'threw' })
  })

  test('equal ranges pass although widths, painted lines and everything else of the prediction differ', async () => {
    const result = await compareRowFiles(rowsFile('lines-same.ndjson', [linesRow('a', [[0, 3], [3, 5]]), linesRow('b', [[0, 3], [3, 5]])]), rowsFile('layout.ndjson', [layoutRow('a'), layoutRow('b')]), null, 'line-ranges')
    expect(result).toMatchObject({ rows: 2, missing: [], native: 0, prediction: 0, painter: 0 })
    expect(comparisonExit(result, 'line-ranges')).toBe(0)
    // Compared whole, the same rows differ in prediction and painter.
    const whole = await compareRowFiles(join(dir, 'lines-same.ndjson'), join(dir, 'layout.ndjson'), null)
    expect(whole).toMatchObject({ prediction: 2, painter: 2 })
  })

  test('another break, another number of lines, a prediction error and a missing row are each found', async () => {
    const lines = rowsFile('lines-planted.ndjson', [linesRow('a', [[0, 2], [2, 5]]), linesRow('b', [[0, 5]]), { ...linesRow('c', []), prediction: { error: 'the plain path threw' } }, linesRow('d', [[0, 3], [3, 5]])])
    const result = await compareRowFiles(lines, rowsFile('layout-abc.ndjson', [layoutRow('a'), layoutRow('b'), layoutRow('c')]), null, 'line-ranges')
    expect(result).toMatchObject({ rows: 4, missing: ['d'], prediction: 3, native: 0 })
    expect(result.differences.map(value => value.prediction?.first)).toEqual(['line ranges[0][1]: 2 vs 3', 'line ranges[0][1]: 5 vs 3', 'line ranges: {"error":"the plain path threw"} vs [[0,3],[3,5]]'])
    expect(comparisonExit(result, 'line-ranges')).toBe(1)
  })

  test('a native observation that differs alone exits 3: a history effect to read, not a changed prediction', async () => {
    const moved = native(abcd, [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0)], [at(15.625, 7)], [at(22.625, 7.0625)]], [[at(0, 29.6875)]])
    const result = await compareRowFiles(rowsFile('lines-history.ndjson', [linesRow('a', [[0, 3], [3, 5]], moved)]), rowsFile('layout-a.ndjson', [layoutRow('a')]), null, 'line-ranges')
    expect(result).toMatchObject({ native: 1, nativeScorerView: 1, prediction: 0 })
    expect(comparisonExit(result, 'line-ranges')).toBe(3)
  })
})
