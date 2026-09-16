// Reproducible stratified sampling by family. Families at or below `keepFamiliesUpTo` are kept whole,
// items with `keep` are always kept, and the remaining budget is water-filled: every larger family
// receives the same quota (or all of its items when it has fewer), and the leftover goes one item per
// family in a seeded family order. Inside a family, items are ordered by priority, then by a seeded
// hash of their id, so a sample doesn't depend on input order.

import { hash32 } from './prng.ts'

export type SampleOptions<T> = {
  family(item: T): string
  id(item: T): string
  keepFamiliesUpTo: number
  keep?(item: T): boolean
  // Larger values are picked first inside a family.
  priority?(item: T): number
}

export type SampleResult<T> = { selected: T[]; kept: number; quota: number; overBudget: boolean }

export function stratifiedSample<T>(items: readonly T[], n: number, seed: string, options: SampleOptions<T>): SampleResult<T> {
  const groups = new Map<string, T[]>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const family = options.family(item)
    let group = groups.get(family)
    if (group === undefined) groups.set(family, (group = []))
    group.push(item)
  }
  const selected: T[] = []
  const pools: Array<{ order: number; family: string; items: T[] }> = []
  for (const [family, group] of groups) {
    if (group.length <= options.keepFamiliesUpTo) {
      selected.push(...group)
      continue
    }
    const pool: T[] = []
    for (let i = 0; i < group.length; i++) (options.keep?.(group[i]!) === true ? selected : pool).push(group[i]!)
    if (pool.length === 0) continue
    const keyed = pool.map(item => ({ item, priority: options.priority?.(item) ?? 0, hash: hash32(`${seed}/${options.id(item)}`), id: options.id(item) }))
    keyed.sort((a, b) => b.priority - a.priority || a.hash - b.hash || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    pools.push({ order: hash32(`${seed}/family/${family}`), family, items: keyed.map(entry => entry.item) })
  }
  pools.sort((a, b) => a.order - b.order || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0))
  const kept = selected.length
  const budget = n - kept
  if (budget <= 0) return { selected, kept, quota: 0, overBudget: budget < 0 }
  const total = (quota: number): number => {
    let sum = 0
    for (let i = 0; i < pools.length; i++) sum += Math.min(pools[i]!.items.length, quota)
    return sum
  }
  let low = 0
  let high = 0
  for (let i = 0; i < pools.length; i++) high = Math.max(high, pools[i]!.items.length)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (total(mid) <= budget) low = mid
    else high = mid - 1
  }
  const quota = low
  let leftover = budget - total(quota)
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i]!
    let take = Math.min(pool.items.length, quota)
    if (leftover > 0 && pool.items.length > quota) {
      take++
      leftover--
    }
    for (let j = 0; j < take; j++) selected.push(pool.items[j]!)
  }
  return { selected, kept, quota, overBudget: false }
}
