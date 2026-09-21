import { expect, test } from 'bun:test'
import { findRecord, insertRecord, orderedRecords, type OrderedLinks } from './ordered-records.js'

type Entry = OrderedLinks & { value: number }

test('ordered records preserve creation order while finding ascending, descending and mixed inputs', () => {
  const n = 4096
  for (const order of ['up', 'down', 'mixed']) {
    const values = Array.from({ length: n }, (_, i) => i)
    if (order === 'down') values.reverse()
    if (order === 'mixed') {
      let seed = 123456
      for (let i = n - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const j = seed % (i + 1)
        ;[values[i], values[j]] = [values[j]!, values[i]!]
      }
    }
    const tree = orderedRecords<Entry>()
    for (const value of values) insertRecord(tree, { value, left: -1, right: -1, height: 1 }, (a, b) => a.value - b.value)
    const found: number[] = []
    for (let value = n - 1; value >= 0; value--) found.push(findRecord(tree, value, (a, b) => a - b.value)!.value)
    expect(found).toEqual(Array.from({ length: n }, (_, i) => n - 1 - i))
    expect(tree.records.map(record => record.value)).toEqual(values)
    expect(findRecord(tree, -1, (a, b) => a - b.value)).toBeNull()
    expect(findRecord(tree, n, (a, b) => a - b.value)).toBeNull()
  }
})
