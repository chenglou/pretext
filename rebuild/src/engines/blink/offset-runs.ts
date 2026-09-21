// Maximal half-open runs of units with the given fixed input property. Ordinary boundary-per-unit text has no entries.
export class OffsetRuns {
  private readonly ranges: number[] = []
  constructor(length: number, inside: (k: number) => boolean) {
    let start = -1
    for (let k = 0; k <= length; k++) {
      const on = k < length && inside(k)
      if (on && start < 0) start = k
      else if (!on && start >= 0) { this.ranges.push(start, k); start = -1 }
    }
  }
  // The caller already knows k is inside a run from the source/cluster membership flag.
  private containing(k: number): number {
    let lo = 0, hi = this.ranges.length / 2
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2)
      if (this.ranges[mid * 2]! <= k) lo = mid + 1
      else hi = mid
    }
    return (lo - 1) * 2
  }
  start(k: number): number { return this.ranges[this.containing(k)]! }
  end(k: number): number { return this.ranges[this.containing(k) + 1]! }
}
