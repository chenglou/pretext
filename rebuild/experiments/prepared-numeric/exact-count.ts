import { lengthLU } from '../../src/engines/blink/content.js'
import { addLU } from '../../src/engines/blink/layout-unit.js'
export type PreparedNumericWord = { positions: Int32Array; totalPx: number; zoom: number }

// Research control: qualify positions in preparation before using this search.
// Bound a search from its current start, retaining Blink fitting and progress.
// Sorted positions require O(N) total comparisons per width, with no extra data.
export function countPreparedWord(p: PreparedNumericWord, width: number, endOffsets?: number[]): number {
  const available = addLU(Math.max(0, lengthLU(width, p.zoom)), 1)
  const end = p.positions.length - 1
  let start = 0, count = 0
  while (start < end) {
    const x = addLU(p.positions[start]!, available)
    let next: number
    if (Math.fround(x / 64) >= p.totalPx) next = end
    else {
      let low = start, high = Math.min(start + 1, end - 1), stride = 1
      while (high < end - 1 && p.positions[high]! <= x) {
        low = high
        stride *= 2
        high = Math.min(start + stride, end - 1)
      }
      while (low < high) {
        const middle = (low + high + 1) >>> 1
        if (p.positions[middle]! <= x) low = middle
        else high = middle - 1
      }
      next = Math.max(start + 1, low)
    }
    count++; endOffsets?.push(next); start = next
  }
  return count
}
