import { describe, expect, test } from 'bun:test'
import { pairwiseRows } from './covering.ts'

function uncoveredPairs(sizes: readonly number[], rows: readonly number[][]): number {
  let missing = 0
  for (let i = 0; i < sizes.length; i++) {
    for (let j = i + 1; j < sizes.length; j++) {
      for (let a = 0; a < sizes[i]!; a++) {
        for (let b = 0; b < sizes[j]!; b++) if (!rows.some(row => row[i] === a && row[j] === b)) missing++
      }
    }
  }
  return missing
}

describe('pairwise covering rows', () => {
  test('cover every pair of values of two axes', () => {
    const shapes = [[3, 3, 2, 2], [2, 2, 2], [4, 3, 3, 2, 2], [5], [3, 1, 4], []]
    for (const sizes of shapes) {
      const rows = pairwiseRows(sizes)
      expect(uncoveredPairs(sizes, rows)).toBe(0)
      for (const row of rows) for (let a = 0; a < sizes.length; a++) expect(row[a]!).toBeLessThan(sizes[a]!)
    }
  })

  test('stay far below the crossproduct', () => {
    expect(pairwiseRows([3, 3, 2, 2]).length).toBeLessThanOrEqual(10)
    expect(pairwiseRows([3, 3, 3, 3]).length).toBeLessThanOrEqual(12)
  })

  test('are deterministic', () => {
    expect(pairwiseRows([3, 2, 4, 2])).toEqual(pairwiseRows([3, 2, 4, 2]))
  })
})
