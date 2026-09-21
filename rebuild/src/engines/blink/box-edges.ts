import { addLU, LU_MIN, LU_MAX } from './layout-unit.js'

// Raw signed LayoutUnits from finished visual children and source-order box edges, owned by geometry.
type BoxEdges = { start: number; end: number; mbpLineLeft: number; mbpLineRight: number }

// Each source suffix shift is x -> clamp(x + delta). Compositions retain that form plus
// an allowed output interval. Activate shifts by child boundary, but compose in original box order.
export function applyBoxEdges(children: readonly { offset: number }[], boxes: readonly BoxEdges[]): void {
  if (boxes.length === 0) return
  const events: { at: number; delta: number; order: number }[] = []
  for (const box of boxes) {
    if (box.mbpLineLeft !== 0) events.push({ at: box.start, delta: box.mbpLineLeft, order: events.length })
    if (box.mbpLineRight !== 0) events.push({ at: box.end, delta: box.mbpLineRight, order: events.length })
  }
  if (events.length === 0) return
  events.sort((a, b) => a.at - b.at || a.order - b.order)
  let size = 1
  while (size < events.length) size *= 2
  const tree = new Float64Array(6 * size)
  for (let i = 1; i < 2 * size; i++) {
    tree[3 * i + 1] = LU_MIN
    tree[3 * i + 2] = LU_MAX
  }
  const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))
  const activate = (event: { delta: number; order: number }): void => {
    let node = size + event.order
    const data = 3 * node
    tree[data] = event.delta
    tree[data + 1] = addLU(LU_MIN, event.delta)
    tree[data + 2] = addLU(LU_MAX, event.delta)
    if (tree[data + 1] === tree[data + 2]) tree[data] = 0
    for (node = Math.floor(node / 2); node > 0; node = Math.floor(node / 2)) {
      const left = 6 * node
      const right = left + 3
      const out = 3 * node
      const lo = clamp(tree[left + 1]! + tree[right]!, tree[right + 1]!, tree[right + 2]!)
      const hi = clamp(tree[left + 2]! + tree[right]!, tree[right + 1]!, tree[right + 2]!)
      tree[out] = lo === hi ? 0 : tree[left]! + tree[right]!
      tree[out + 1] = lo
      tree[out + 2] = hi
    }
  }
  let next = 0
  for (let c = 0; c < children.length; c++) {
    while (next < events.length && events[next]!.at <= c) activate(events[next++]!)
    children[c]!.offset = clamp(children[c]!.offset + tree[3]!, tree[4]!, tree[5]!)
  }
}

