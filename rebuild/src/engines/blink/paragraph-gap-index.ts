import type { Gap } from '../../model.js'

type Node = {
  index: number
  start: number
  end: number
  firstStart: number
  maxEnd: number
  left: Node | null
  right: Node | null
}

function build(gaps: readonly Gap[], ids: readonly number[], lo: number, hi: number): Node | null {
  if (lo >= hi) return null
  const mid = lo + Math.floor((hi - lo) / 2)
  const index = ids[mid]!
  const at = gaps[index]!.at!
  const left = build(gaps, ids, lo, mid)
  const right = build(gaps, ids, mid + 1, hi)
  return {
    index, start: at.start, end: at.end, firstStart: left?.firstStart ?? at.start,
    maxEnd: Math.max(at.end, left?.maxEnd ?? -Infinity, right?.maxEnd ?? -Infinity), left, right,
  }
}

// The prepared paragraph's canonical gap ranges stay fixed. Index them once by source start; queries return their
// original first-raise order and use exactly lineEdgeGaps' strict endpoint test, including zero-length source ranges.
export class ParagraphGapIndex {
  private readonly root: Node | null

  constructor(gaps: readonly Gap[]) {
    const ids: number[] = []
    for (let i = 0; i < gaps.length; i++) if (gaps[i]!.at !== undefined) ids.push(i)
    ids.sort((a, b) => gaps[a]!.at!.start - gaps[b]!.at!.start || a - b)
    this.root = build(gaps, ids, 0, ids.length)
  }

  private collect(node: Node | null, start: number, end: number, result: number[]): void {
    if (node === null || node.firstStart >= end || node.maxEnd <= start) return
    this.collect(node.left, start, end, result)
    if (node.start < end && node.end > start) result.push(node.index)
    if (node.start < end) this.collect(node.right, start, end, result)
  }

  intersect(start: number, end: number): number[] {
    const result: number[] = []
    this.collect(this.root, start, end, result)
    result.sort((a, b) => a - b)
    return result
  }
}
