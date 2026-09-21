import type { Gap, GapName } from '../../model.js'
type Node = { last: number; value: number | null; left: Node | undefined; right: Node | undefined }
const node = (value: number): Node => ({ last: value, value, left: undefined, right: undefined })

// Ranges are inclusive integral source offsets in [0, paragraph UTF-16 length], including empty ranges at EOF.
// The paragraph's own producers provide that domain; this is not a validator for external Gap arrays.
// This line's raw ranges in raise order. Each source coordinate records the latest entry containing it; nodes store
// only ordinals into the same output list. Nothing is removed, so a shadowed earlier entry never becomes latest again.
export class LineGapRanges {
  private readonly groups = new Map<GapName, Map<number | null, Node>>()
  constructor(private readonly gaps: Gap[], private readonly end: number) {
    for (let i = 0; i < gaps.length; i++) {
      const gap = gaps[i]!
      if (gap.at !== undefined) this.assign(this.group(gap.gap, gap.run), 0, end, gap.at.start, gap.at.end, i)
    }
  }
  private group(gap: GapName, run: number | null): Node {
    let runs = this.groups.get(gap)
    if (runs === undefined) { runs = new Map(); this.groups.set(gap, runs) }
    let ranges = runs.get(run)
    if (ranges === undefined) { ranges = node(-1); runs.set(run, ranges) }
    return ranges
  }
  private maximum(n: Node, lo: number, hi: number, a: number, b: number): number {
    if (n.value !== null || (a <= lo && hi <= b)) return n.last
    const mid = lo + Math.floor((hi - lo) / 2)
    let result = -1
    if (a <= mid) result = this.maximum(n.left!, lo, mid, a, b)
    if (b > mid) result = Math.max(result, this.maximum(n.right!, mid + 1, hi, a, b))
    return result
  }
  private assign(n: Node, lo: number, hi: number, a: number, b: number, ordinal: number): void {
    if (n.value === ordinal) return
    if (a <= lo && hi <= b) { n.last = n.value = ordinal; n.left = n.right = undefined; return }
    if (n.value !== null) { n.left = node(n.value); n.right = node(n.value); n.value = null }
    const mid = lo + Math.floor((hi - lo) / 2)
    if (a <= mid) this.assign(n.left!, lo, mid, a, b, ordinal)
    if (b > mid) this.assign(n.right!, mid + 1, hi, a, b, ordinal)
    const left = n.left!, right = n.right!
    n.last = Math.max(left.last, right.last)
    if (left.value !== null && left.value === right.value) { n.value = left.value; n.left = n.right = undefined }
  }
  add(gap: GapName, run: number | null, detail: string, at: { start: number; end: number }): void {
    const ranges = this.group(gap, run)
    let ordinal = this.maximum(ranges, 0, this.end, at.start, at.end)
    if (ordinal >= 0) {
      const known = this.gaps[ordinal]!, old = known.at!
      known.at = { start: Math.min(old.start, at.start), end: Math.max(old.end, at.end) }
    } else { ordinal = this.gaps.length; this.gaps.push({ gap, run, detail, at }) }
    // The incoming range selected ordinal as its maximum, so it contains no later entry. Assign just that range:
    // widening the entire old hull could erase a later overlapping seed outside the incoming range.
    this.assign(ranges, 0, this.end, at.start, at.end, ordinal)
  }
}
