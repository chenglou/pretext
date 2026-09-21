import type { ListedFontFacts } from '../../model.js'
export function cmapCovers(coverage: readonly number[], cp: number): boolean {
  let lo = 0, hi = coverage.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < coverage[2 * mid]!) hi = mid - 1
    else if (cp > coverage[2 * mid + 1]!) lo = mid + 1
    else return true
  }
  return false
}
export function decidesFont(cp: number): boolean {
  return !(cp === 0xad || cp === 0x34f || cp === 0x61c || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff)
}
type Points = number | readonly number[] | null
function pointsOf(text: string, a: number, b: number): Points {
  let first = -1, rest: number[] | null = null, seen: Set<number> | null = null
  for (let i = a; i < b;) {
    const cp = text.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    if (!decidesFont(cp)) continue
    if (first < 0) first = cp
    else if (seen !== null) { if (!seen.has(cp)) { seen.add(cp); rest!.push(cp) } }
    else if (cp !== first) { rest = [first, cp]; seen = new Set(rest) }
  }
  return rest ?? (first < 0 ? null : first)
}
type Source = { family: number; rank: number; coverage: readonly number[] }
type Bits = { left: Bits | null; right: Bits | null; word: number }
type Endpoint = { source: Source; index: number; at: number; closing: boolean }
type Block = { sources: Source[]; coordinates: number[]; roots: (Bits | null)[]; weight: number; tier: number }
// Coverage follows model.ts: sorted inclusive codepoint ranges. Unknown families stop source discovery; equal cmap
// identities keep only the earliest eligible family. Compact ranks follow that source order, even across missing families.
// Pure source relation: each coordinate version describes which source families cover that codepoint.
// Persistent bitmap paths share unchanged source intervals. No query string, tuple or Canvas answer is retained.
export class FontCoverage {
  private readonly sources: Source[] = []
  private readonly byCoverage = new Map<readonly number[], Source>()
  private readonly blocks: Block[] = []
  private nextFamily = 0
  private sealed = false
  private compiled = 0
  private pendingUnits = 0
  private sourceUnits = 0
  private work = 0
  private readonly words: number
  constructor(private readonly fonts: readonly ListedFontFacts[]) { this.words = Math.max(1, Math.ceil(fonts.length / 32)) }
  font(text: string, a: number, b: number): number {
    const points = pointsOf(text, a, b)
    if (points === null) return (this.sources[0] ?? this.discover())?.family ?? -1
    for (const block of this.blocks) {
      const family = this.query(block, points)
      if (family >= 0) return family
    }
    for (let i = this.compiled; i < this.sources.length; i++) {
      const source = this.sources[i]!
      if (this.accepts(source.coverage, points)) return this.finish(source.family)
    }
    for (let source = this.discover(); source !== null; source = this.discover()) {
      if (this.accepts(source.coverage, points)) return this.finish(source.family)
    }
    return this.finish(-1)
  }
  private discover(): Source | null {
    while (!this.sealed && this.nextFamily < this.fonts.length) {
      const family = this.nextFamily++, font = this.fonts[family]!
      this.work++; this.sourceUnits++
      if (font.realizes === false) continue
      if (font.realizes === null || font.coverage === null) { this.sealed = true; return null }
      const coverage = font.coverage
      if (this.byCoverage.has(coverage)) continue
      const source: Source = { family, rank: this.sources.length, coverage }
      this.byCoverage.set(coverage, source); this.sources.push(source)
      this.pendingUnits += 1 + coverage.length; this.sourceUnits += coverage.length
      return source
    }
    this.sealed = true
    return null
  }
  private covers(coverage: readonly number[], cp: number): boolean {
    let lo = 0, hi = coverage.length / 2 - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      this.work++
      if (cp < coverage[2 * mid]!) { hi = mid - 1; continue }
      this.work++
      if (cp > coverage[2 * mid + 1]!) lo = mid + 1
      else return true
    }
    return false
  }
  private accepts(coverage: readonly number[], points: Exclude<Points, null>): boolean {
    if (typeof points === 'number') return this.covers(coverage, points)
    for (const cp of points) if (!this.covers(coverage, cp)) return false
    return true
  }
  private word(root: Bits | null, at: number, a = 0, b = this.words): number {
    if (root === null) return 0
    if (b - a === 1) return root.word
    const mid = (a + b) >>> 1
    return at < mid ? this.word(root.left, at, a, mid) : this.word(root.right, at, mid, b)
  }
  private update(root: Bits | null, at: number, word: number, a = 0, b = this.words): Bits | null {
    if (b - a === 1) { if (word === (root?.word ?? 0)) return root; if (word === 0) return null; return { left: null, right: null, word } }
    const mid = (a + b) >>> 1
    const left = at < mid ? this.update(root?.left ?? null, at, word, a, mid) : root?.left ?? null
    const right = at >= mid ? this.update(root?.right ?? null, at, word, mid, b) : root?.right ?? null
    if (left === (root?.left ?? null) && right === (root?.right ?? null)) return root
    if (left === null && right === null) return null
    return { left, right, word: 0 }
  }
  private advance(endpoint: Endpoint): boolean {
    if (!endpoint.closing) { endpoint.closing = true; endpoint.at = Math.min(0x10ffff, endpoint.source.coverage[endpoint.index + 1]!) + 1; return true }
    const coverage = endpoint.source.coverage
    for (endpoint.index += 2; endpoint.index < coverage.length; endpoint.index += 2) {
      const a = Math.max(0, coverage[endpoint.index]!), b = Math.min(0x10ffff, coverage[endpoint.index + 1]!)
      if (a <= b) { endpoint.at = a; endpoint.closing = false; return true }
    }
    return false
  }
  private before(a: Endpoint, b: Endpoint): boolean {
    return a.at < b.at || (a.at === b.at && (a.source.rank >>> 5) < (b.source.rank >>> 5))
  }
  private down(heap: Endpoint[], at: number): void {
    const value = heap[at]!
    for (;;) {
      const left = at * 2 + 1
      if (left >= heap.length) break
      const right = left + 1, child = right < heap.length && this.before(heap[right]!, heap[left]!) ? right : left
      if (!this.before(heap[child]!, value)) break
      heap[at] = heap[child]!; at = child
    }
    heap[at] = value
  }
  private build(sources: Source[], weight: number): Block {
    // Each cmap's inclusive interval endpoints are already ordered. Merge those streams rather than copying and sorting E events.
    const heap: Endpoint[] = []
    for (const source of sources) {
      const endpoint: Endpoint = { source, index: -2, at: 0, closing: true }
      if (this.advance(endpoint)) heap.push(endpoint)
    }
    for (let i = (heap.length >>> 1) - 1; i >= 0; i--) this.down(heap, i)
    const coordinates: number[] = [], roots: (Bits | null)[] = []
    let root: Bits | null = null
    while (heap.length > 0) {
      const at = heap[0]!.at
      while (heap.length > 0 && heap[0]!.at === at) {
        const word = heap[0]!.source.rank >>> 5
        let add = 0, remove = 0
        while (heap.length > 0 && heap[0]!.at === at && (heap[0]!.source.rank >>> 5) === word) {
          const endpoint = heap[0]!, mask = 1 << (endpoint.source.rank & 31)
          if (endpoint.closing) remove |= mask; else add |= mask
          if (!this.advance(endpoint)) {
            const last = heap.pop()!
            if (heap.length > 0) heap[0] = last
          }
          if (heap.length > 0) this.down(heap, 0)
        }
        root = this.update(root, word, (this.word(root, word) & ~remove) | add)
      }
      coordinates.push(at); roots.push(root)
    }
    return { sources, coordinates, roots, weight, tier: Math.floor(Math.log2(weight)) }
  }
  private rootAt(block: Block, cp: number): Bits | null {
    let a = 0, b = block.coordinates.length
    while (a < b) { const mid = (a + b) >>> 1; if (block.coordinates[mid]! <= cp) a = mid + 1; else b = mid }
    return a === 0 ? null : block.roots[a - 1]!
  }
  private first(root: Bits | null, a = 0, b = this.words): number {
    if (root === null) return -1
    if (b - a === 1) return a * 32 + 31 - Math.clz32(root.word & -root.word)
    const mid = (a + b) >>> 1
    const family = this.first(root.left, a, mid)
    return family >= 0 ? family : this.first(root.right, mid, b)
  }
  private intersect(roots: (Bits | null)[], parents: (Bits | null)[], depth = 0, a = 0, b = this.words): number {
    for (const root of roots) if (root === null) return -1
    if (b - a === 1) {
      let word = -1
      for (const root of roots) word &= root!.word
      return word === 0 ? -1 : a * 32 + 31 - Math.clz32(word & -word)
    }
    const mid = (a + b) >>> 1, offset = depth * roots.length
    for (let i = 0; i < roots.length; i++) { parents[offset + i] = roots[i]!; roots[i] = roots[i]!.left }
    let family = this.intersect(roots, parents, depth + 1, a, mid)
    if (family < 0) {
      for (let i = 0; i < roots.length; i++) roots[i] = parents[offset + i]!.right
      family = this.intersect(roots, parents, depth + 1, mid, b)
    }
    for (let i = 0; i < roots.length; i++) roots[i] = parents[offset + i]!
    return family
  }
  private query(block: Block, points: Exclude<Points, null>): number {
    const rank = typeof points === 'number' ? this.first(this.rootAt(block, points)) : this.intersect(points.map(cp => this.rootAt(block, cp)), [])
    return rank < 0 ? -1 : this.sources[rank]!.family
  }
  private finish(family: number): number {
    const budget = 2 * this.pendingUnits * (1 + Math.ceil(Math.log2(this.sourceUnits + 2)))
    if (this.sources.length - this.compiled >= 2 && this.work >= budget) {
      // A merged old block grows by at least 1.5x, bounding repeated source construction by log(source volume).
      // Weighted blocks avoid rebuilding one giant earlier cmap for every tiny later source home.
      let sources = this.sources.slice(this.compiled)
      let weight = this.pendingUnits
      while (this.blocks.length > 0 && this.blocks[this.blocks.length - 1]!.tier <= Math.floor(Math.log2(weight))) {
        const left = this.blocks.pop()!
        sources = left.sources.concat(sources)
        weight += left.weight
      }
      this.blocks.push(this.build(sources, weight))
      this.compiled = this.sources.length; this.pendingUnits = 0; this.work = 0
    }
    return family
  }
}
