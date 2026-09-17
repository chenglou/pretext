// Pairwise covering arrays for a family's neighbour axes (TEST-ARCHITECTURE.md §2.2): a fixed list of rows in which
// every pair of values of two axes appears at least once. Deterministic and greedy: each row starts from the first
// uncovered pair and fills the other axes with the value that covers the most uncovered pairs, lowest index on ties.

export function pairwiseRows(sizes: readonly number[]): number[][] {
  const n = sizes.length
  if (n === 0) return [[]]
  if (n === 1) {
    const rows: number[][] = []
    for (let v = 0; v < sizes[0]!; v++) rows.push([v])
    return rows
  }
  const key = (i: number, a: number, j: number, b: number): string => `${i}:${a}|${j}:${b}`
  const uncovered = new Set<string>()
  const ordered: Array<[number, number, number, number]> = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let a = 0; a < sizes[i]!; a++) {
        for (let b = 0; b < sizes[j]!; b++) {
          uncovered.add(key(i, a, j, b))
          ordered.push([i, a, j, b])
        }
      }
    }
  }
  const rows: number[][] = []
  let cursor = 0
  while (uncovered.size > 0) {
    while (!uncovered.has(key(...ordered[cursor]!))) cursor++
    const [i, a, j, b] = ordered[cursor]!
    const row: number[] = new Array(n).fill(-1)
    row[i] = a
    row[j] = b
    for (let k = 0; k < n; k++) {
      if (row[k] !== -1) continue
      let best = 0
      let bestCount = -1
      for (let v = 0; v < sizes[k]!; v++) {
        let count = 0
        for (let other = 0; other < n; other++) {
          if (row[other] === -1 || other === k) continue
          const pair = other < k ? key(other, row[other]!, k, v) : key(k, v, other, row[other]!)
          if (uncovered.has(pair)) count++
        }
        if (count > bestCount) {
          best = v
          bestCount = count
        }
      }
      row[k] = best
    }
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) uncovered.delete(key(p, row[p]!, q, row[q]!))
    }
    rows.push(row)
  }
  return rows
}
