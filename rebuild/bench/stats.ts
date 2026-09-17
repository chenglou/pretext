// Sample statistics, shared by the page and the report.
import type { SampleStats } from './protocol.ts'

function sortedCopy(values: readonly number[]): number[] {
  return values.slice().sort((a, b) => a - b)
}

// Nearest rank: the smallest value with at least q of the samples at or below it.
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const rank = Math.max(1, Math.ceil(q * sorted.length))
  return sorted[rank - 1]!
}

export function median(values: readonly number[]): number {
  const sorted = sortedCopy(values)
  if (sorted.length === 0) return Number.NaN
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function summarize(samples: readonly number[], reps: number, heapDrops: readonly boolean[] | null): SampleStats {
  const sorted = sortedCopy(samples)
  const mid = median(sorted)
  const deviations: number[] = []
  let sum = 0
  for (let i = 0; i < sorted.length; i++) {
    deviations.push(Math.abs(sorted[i]! - mid))
    sum += sorted[i]!
  }
  const mad = median(deviations)
  const threshold = mid + Math.max(5 * mad, mid / 2)
  let outliers = 0
  for (let i = 0; i < sorted.length; i++) if (sorted[i]! > threshold) outliers++
  let drops: number | null = null
  if (heapDrops !== null) {
    drops = 0
    for (let i = 0; i < heapDrops.length; i++) if (heapDrops[i]) drops++
  }
  return {
    n: sorted.length,
    reps,
    medianMs: mid,
    p95Ms: quantile(sorted, 0.95),
    minMs: sorted.length === 0 ? Number.NaN : sorted[0]!,
    maxMs: sorted.length === 0 ? Number.NaN : sorted[sorted.length - 1]!,
    meanMs: sorted.length === 0 ? Number.NaN : sum / sorted.length,
    madMs: mad,
    outliers,
    heapDropSamples: drops,
  }
}
