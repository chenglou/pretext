import type { WebKitHistoryWorld, WebKitItem, WebKitItemSequence } from './types.js'

// Arrays are the ordinary path; virtual lists exist only for counterfactual history inspection.
export function itemAt(items: WebKitItemSequence, index: number): WebKitItem | undefined {
  if (Array.isArray(items)) return items[index]
  if (index < 0 || index >= items.length) return undefined
  if (index < items.start) return items.base[index]
  const local = index - items.start
  if (local < items.replacement.length) return items.replacement[local]
  return items.base[items.end + local - items.replacement.length]
}

export function sliceItems(items: WebKitItemSequence, start: number, end: number): WebKitItem[] {
  if (Array.isArray(items)) return items.slice(start, end)
  const result: WebKitItem[] = []
  for (let i = start; i < end; i++) result.push(itemAt(items, i)!)
  return result
}

export function worldItemIndex(world: WebKitHistoryWorld, ownIndex: number): number {
  if (ownIndex < world.start) return ownIndex
  if (ownIndex >= world.end) return ownIndex + world.prepared.items.length - world.prepared.items.base.length
  return world.start + world.itemIndex[ownIndex - world.start]!
}

export function firstAtOrAfter(positions: readonly number[], position: number): number {
  let lo = 0, hi = positions.length
  while (lo < hi) { const mid = lo + Math.floor((hi - lo) / 2); if (positions[mid]! < position) lo = mid + 1; else hi = mid }
  return lo
}
