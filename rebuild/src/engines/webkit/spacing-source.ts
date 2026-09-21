// One resolved font list's pure source coverage/spacing policy. Every edge is a supplied cmap or spacing-input endpoint;
// nothing is keyed by text, a queried codepoint or a Canvas answer. Small demand reads only consulted source intervals.
import { insertRecord, orderedRecords, type OrderedLinks, type OrderedRecords } from '../../ordered-records.js'
import { inRanges } from './data.js'

type Family = { coverage: readonly number[]; inputs: readonly number[] }
type Cell = OrderedLinks & { start: number; end: number; changes: boolean | null }
type Range = { start: number; end: number; changes: boolean }
type View =
  | { kind: 'single'; family: Family }
  | { kind: 'partition'; ranges: Range[] }
  | { kind: 'demand'; families: Family[]; cells: OrderedRecords<Cell>; work: number; limit: number }

export class SpacingSource {
  private view: View
  constructor(families: readonly Family[]) {
    const sources: Family[] = [], seen = new Set<readonly number[]>()
    let endpoints = 0
    for (const family of families) {
      // Equal immutable coverage means the earlier family's inputs decide every character they cover.
      if (family.coverage.length === 0 || seen.has(family.coverage)) continue
      seen.add(family.coverage); sources.push(family)
      endpoints += family.coverage.length / 2 + family.inputs.length / 2
    }
    this.view = sources.length === 0 ? { kind: 'partition', ranges: [] }
      : sources.length === 1 ? { kind: 'single', family: sources[0]! }
      : { kind: 'demand', families: sources, cells: orderedRecords(), work: 0,
        limit: (sources.length + endpoints) * Math.ceil(Math.log2(sources.length + 1)) }
  }

  canChange(text: string): boolean | null {
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      const changes = this.at(cp)
      // Preserve source order: an uncovered earlier character returns null before a later spacing input.
      if (changes !== false) return changes
    }
    return false
  }

  at(cp: number): boolean | null {
    const view = this.view
    if (view.kind !== 'demand') return this.read(view, cp)
    const tree = view.cells
    let node = tree.root, start = 0, end = 0x10ffff, steps = 0
    while (node >= 0) {
      steps++
      const cell = tree.records[node]!
      if (cp < cell.start) { end = Math.min(end, cell.start - 1); node = cell.left }
      else if (cp > cell.end) { start = Math.max(start, cell.end + 1); node = cell.right }
      else return cell.changes
    }
    view.work += steps + 1
    if (view.work >= view.limit) return this.read(this.view = this.partition(view.families), cp)
    let changes: boolean | null = null
    const bounds = (ranges: readonly number[]): boolean => {
      let lo = 0, hi = ranges.length / 2 - 1
      while (lo <= hi) {
        view.work++
        const mid = (lo + hi) >>> 1, a = ranges[2 * mid]!, b = ranges[2 * mid + 1]!
        if (cp < a) hi = mid - 1
        else if (cp > b) lo = mid + 1
        else { start = Math.max(start, a); end = Math.min(end, b); return true }
      }
      if (hi >= 0) start = Math.max(start, ranges[2 * hi + 1]! + 1)
      if (lo < ranges.length / 2) end = Math.min(end, ranges[2 * lo]! - 1)
      return false
    }
    for (const family of view.families) {
      view.work++
      if (bounds(family.coverage)) { changes = bounds(family.inputs); break }
    }
    view.work += tree.root < 0 ? 1 : tree.records[tree.root]!.height
    insertRecord(tree, { start, end, changes, left: -1, right: -1, height: 1 }, (a, b) => a.start - b.start)
    return changes
  }

  private read(view: Exclude<View, { kind: 'demand' }>, cp: number): boolean | null {
    if (view.kind === 'single') return inRanges(view.family.coverage, cp) ? inRanges(view.family.inputs, cp) : null
    let lo = 0, hi = view.ranges.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (view.ranges[mid]!.end < cp) lo = mid + 1
      else hi = mid
    }
    return lo < view.ranges.length && view.ranges[lo]!.start <= cp ? view.ranges[lo]!.changes : null
  }

  private partition(families: Family[]): Extract<View, { kind: 'partition' }> {
    type Source = { index: number; active: boolean; inputs: boolean; queued: boolean }
    type Walker = { source: Source; ranges: readonly number[]; input: boolean; next: number; at: number; end: number; add: boolean }
    const nextRange = (walker: Walker): boolean => {
      if (walker.next === walker.ranges.length) return false
      walker.at = walker.ranges[walker.next]!; walker.end = walker.ranges[walker.next + 1]!; walker.next += 2
      // Adjacent inclusive ranges stay active across their shared closing/opening coordinate.
      while (walker.next < walker.ranges.length && walker.ranges[walker.next]! <= walker.end + 1) {
        walker.end = Math.max(walker.end, walker.ranges[walker.next + 1]!); walker.next += 2
      }
      walker.add = true
      return true
    }
    const events: Walker[] = []
    for (let i = 0; i < families.length; i++) {
      const family = families[i]!, source: Source = { index: i, active: false, inputs: false, queued: false }
      for (const input of [false, true]) {
        const walker: Walker = { source, ranges: input ? family.inputs : family.coverage, input, next: 0, at: 0, end: 0, add: true }
        if (nextRange(walker)) events.push(walker)
      }
    }
    const down = (at: number): void => {
      const value = events[at]!
      for (;;) {
        const left = at * 2 + 1
        if (left >= events.length) break
        const right = left + 1, child = right < events.length && events[right]!.at < events[left]!.at ? right : left
        if (value.at <= events[child]!.at) break
        events[at] = events[child]!; at = child
      }
      events[at] = value
    }
    for (let i = (events.length >>> 1) - 1; i >= 0; i--) down(i)
    const active: Source[] = []
    const push = (source: Source): void => {
      source.queued = true
      let at = active.length
      active.push(source)
      while (at > 0) {
        const parent = (at - 1) >>> 1
        if (active[parent]!.index <= source.index) break
        active[at] = active[parent]!; at = parent
      }
      active[at] = source
    }
    const pop = (): void => {
      active[0]!.queued = false
      const last = active.pop()!
      if (active.length === 0) return
      let at = 0
      for (;;) {
        const left = at * 2 + 1
        if (left >= active.length) break
        const right = left + 1, child = right < active.length && active[right]!.index < active[left]!.index ? right : left
        if (last.index <= active[child]!.index) break
        active[at] = active[child]!; at = child
      }
      active[at] = last
    }
    const ranges: Range[] = []
    while (events.length > 0) {
      const at = events[0]!.at
      do {
        const event = events[0]!, source = event.source
        if (event.input) source.inputs = event.add
        else { source.active = event.add; if (event.add && !source.queued) push(source) }
        if (event.add) { event.at = event.end + 1; event.add = false }
        else if (!nextRange(event)) {
          const last = events.pop()!
          if (events.length > 0) events[0] = last
        }
        if (events.length > 0) down(0)
      } while (events.length > 0 && events[0]!.at === at)
      while (active.length > 0 && !active[0]!.active) pop()
      if (events.length === 0 || active.length === 0) continue
      const changes = active[0]!.inputs, end = events[0]!.at - 1
      const previous = ranges[ranges.length - 1]
      if (previous !== undefined && previous.changes === changes && previous.end + 1 === at) previous.end = end
      else ranges.push({ start: at, end, changes })
    }
    return { kind: 'partition', ranges }
  }
}
