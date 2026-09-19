// two-trees.ts where one side predicts line ranges alone: a layout's lines without a line box aren't a plain predictor's.
import { describe, expect, test } from 'bun:test'
import { abcd, blink, row } from '../lab/row-fixtures.ts'
import type { LayoutPrediction, LinesPrediction } from '../lab/types.ts'
import { compare, type Predictor } from './two-trees.ts'

const c = row('chrome', abcd, { skipped: 'test' }, blink([]), { error: 'test' }).case
const neither: Predictor = { predict: () => ({ error: 'never asked' }) }
const lines = (ranges: Array<[number, number]>): LinesPrediction => ({ lines: ranges.map(([start, end]) => ({ start, end, width: 1 })) })
// `ab cd` on two lines with a line without a line box between them.
const layout = { layout: { ...blink([[0, 3, 2000], [3, 3, 0, false], [3, 5, 1800]]), measure: { contexts: 0, calls: 0, memoHits: 0 } } } as LayoutPrediction

describe('line ranges against a layout', () => {
  test('a line without a line box is no difference, on either side', () => {
    expect(compare(c, neither, neither, lines([[0, 3], [3, 5]]), layout)).toBe(null)
    expect(compare(c, neither, neither, layout, lines([[0, 3], [3, 5]]))).toBe(null)
  })

  test('another break and another number of lines are found', () => {
    expect(compare(c, neither, neither, lines([[0, 2], [2, 5]]), layout)).toMatchObject({ part: 'lines', first: { path: 'lines[0][1]' } })
    expect(compare(c, neither, neither, lines([[0, 3], [3, 3], [3, 5]]), layout)).toMatchObject({ part: 'lines' })
  })
})
