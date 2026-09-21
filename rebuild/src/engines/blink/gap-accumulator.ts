import type { Gap, GapName } from '../../model.js'
type Entry = { data: Gap; ordinal: number; key: string }
type Node = {
  first: Entry | null
  last: Entry | null
  value: Entry | null | undefined
  left: Node | undefined
  right: Node | undefined
}
type Group = { tree: Node; whole: Entry | undefined; count: number; key: string }
const node = (value: Entry | null): Node => ({ first: value, last: value, value, left: undefined, right: undefined })
const first = (a: Entry | null, b: Entry | null): Entry | null => a === null ? b : b === null ? a : a.ordinal < b.ordinal ? a : b
const last = (a: Entry | null, b: Entry | null): Entry | null => a === null ? b : b === null ? a : a.ordinal > b.ordinal ? a : b

// The source offsets produced by gaps.ts are integers in [0, end], including zero-length ranges at EOF.
// Each source coordinate records the earliest raw gap that contains it. The tree stores uniform spans compactly.
export class GapAccumulator {
  private entries: Entry[] = []
  private keys = new Map<string, Group>()
  private ordinal = 0

  constructor(private readonly end: number, initial: readonly Gap[] = []) {
    if (!Number.isSafeInteger(end) || end < 0) throw Error('invalid source length')
    for (const data of initial) {
      const group = this.group(data.gap, data.run, data.detail)
      const e = { data: data.at === undefined ? { ...data } : { ...data, at: { ...data.at } }, ordinal: this.ordinal++, key: group.key }
      this.entries.push(e)
      group.count++
      if (data.at === undefined) group.whole ??= e
    }
    // Raw lists can overlap after an earlier entry widens. Earlier entries overwrite later ones when restoring that state.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!, at = e.data.at
      if (at !== undefined) {
        this.validate(at)
        this.assign(this.keys.get(e.key)!.tree, 0, this.end, at.start, at.end, e)
      }
    }
  }

  private group(gap: GapName, run: number | null, detail: string): Group {
    // gap is an enum and run a numeric index; delimiters before arbitrary detail are unambiguous.
    const key = gap + '\0' + (run === null ? 'null' : run) + '\0' + detail
    let group = this.keys.get(key)
    if (group === undefined) {
      group = { tree: node(null), whole: undefined, count: 0, key }
      this.keys.set(key, group)
    }
    return group
  }

  private validate(at: { start: number; end: number }): void {
    if (!Number.isSafeInteger(at.start) || !Number.isSafeInteger(at.end) || at.start < 0 || at.end < at.start || at.end > this.end) {
      throw Error('range not produced by Blink source mapping')
    }
  }

  get length(): number { return this.entries.length }
  snapshot(): Gap[] { return this.entries.map(e => e.data) }

  truncate(count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > this.entries.length) throw Error('invalid gap checkpoint')
    if (count === this.entries.length) return
    const cutoff = this.entries[count]!.ordinal
    const affected = new Set<Group>()
    for (let i = count; i < this.entries.length; i++) {
      const group = this.keys.get(this.entries[i]!.key)!
      group.count--
      affected.add(group)
    }
    this.entries.length = count
    for (const group of affected) {
      if (group.count === 0) this.keys.delete(group.key)
      else {
        if (group.whole !== undefined && group.whole.ordinal >= cutoff) group.whole = undefined
        this.prune(group.tree, cutoff)
      }
    }
  }

  private uniform(n: Node, value: Entry | null): void {
    n.first = n.last = n.value = value
    n.left = n.right = undefined
  }

  private join(n: Node): void {
    const l = n.left!, r = n.right!
    if (l.value !== undefined && l.value === r.value) this.uniform(n, l.value)
    else {
      n.first = first(l.first, r.first)
      n.last = last(l.last, r.last)
    }
  }

  // Retained entries all predate the checkpoint. Remove only newer entries, keeping prior range widenings.
  private prune(n: Node, cutoff: number): void {
    if (n.last === null || n.last.ordinal < cutoff) return
    if (n.first!.ordinal >= cutoff) this.uniform(n, null)
    else {
      this.prune(n.left!, cutoff)
      this.prune(n.right!, cutoff)
      this.join(n)
    }
  }

  private minimum(n: Node, lo: number, hi: number, a: number, b: number): Entry | null {
    if (n.first === null || n.value !== undefined || a <= lo && hi <= b) return n.first
    const mid = lo + Math.floor((hi - lo) / 2)
    let result: Entry | null = null
    if (a <= mid) result = this.minimum(n.left!, lo, mid, a, b)
    if (b > mid) result = first(result, this.minimum(n.right!, mid + 1, hi, a, b))
    return result
  }

  private assign(n: Node, lo: number, hi: number, a: number, b: number, e: Entry): void {
    if (a <= lo && hi <= b) { this.uniform(n, e); return }
    if (n.value !== undefined) {
      n.left = node(n.value)
      n.right = node(n.value)
      n.value = undefined
    }
    const mid = lo + Math.floor((hi - lo) / 2)
    if (a <= mid) this.assign(n.left!, lo, mid, a, b, e)
    if (b > mid) this.assign(n.right!, mid + 1, hi, a, b, e)
    this.join(n)
  }

  add(gap: GapName, run: number | null, detail: string, at?: { start: number; end: number }): void {
    if (at !== undefined) this.validate(at)
    const group = this.group(gap, run, detail)
    if (at === undefined) {
      if (group.whole !== undefined) return
      const e = { data: { gap, run, detail }, ordinal: this.ordinal++, key: group.key }
      this.entries.push(e)
      group.count++
      group.whole = e
      return
    }
    // Preserve the flat list's constant-time first-touch case before searching later entries.
    const oldest = group.tree.first
    const firstRange = oldest?.data.at
    const e = firstRange !== undefined && at.start <= firstRange.end && at.end >= firstRange.start
      ? oldest! : this.minimum(group.tree, 0, this.end, at.start, at.end)
    if (e !== null) {
      const old = e.data.at!
      // The incoming range chose e as its earliest intersecting entry, so only its extensions can change the index.
      if (at.start < old.start) this.assign(group.tree, 0, this.end, at.start, old.start - 1, e)
      if (at.end > old.end) this.assign(group.tree, 0, this.end, old.end + 1, at.end, e)
      e.data.at = { start: Math.min(old.start, at.start), end: Math.max(old.end, at.end) }
    } else {
      const e = { data: { gap, run, detail, at: { ...at } }, ordinal: this.ordinal++, key: group.key }
      this.entries.push(e)
      group.count++
      this.assign(group.tree, 0, this.end, at.start, at.end, e)
    }
  }

}
