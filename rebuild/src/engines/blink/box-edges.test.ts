import { expect, test } from 'bun:test'
import { applyBoxEdges } from './box-edges.js'
import { LU_MAX, LU_MIN } from './layout-unit.js'

type Edges = { start: number; end: number; mbpLineLeft: number; mbpLineRight: number }
const sourceClamp = (value: bigint): bigint => value > BigInt(LU_MAX) ? BigInt(LU_MAX) : value < BigInt(LU_MIN) ? BigInt(LU_MIN) : value
function sequential(offsets: readonly number[], boxes: readonly Edges[]): number[] {
  const result = offsets.map(BigInt)
  for (const b of boxes) {
    for (let k = b.start; k < result.length; k++) result[k] = sourceClamp(result[k]! + BigInt(b.mbpLineLeft))
    for (let k = b.end; k < result.length; k++) result[k] = sourceClamp(result[k]! + BigInt(b.mbpLineRight))
  }
  return result.map(Number)
}

test('visual box shifts preserve source event order through intermediate saturation', () => {
  const boxes = [
    { start: 2, end: 4, mbpLineLeft: LU_MAX, mbpLineRight: 0 },
    { start: 0, end: 3, mbpLineLeft: -LU_MAX, mbpLineRight: LU_MAX },
  ]
  const offsets = [512, LU_MIN, 512, LU_MAX, -512]
  const children = offsets.map(offset => ({ offset }))
  applyBoxEdges(children, boxes)
  expect(children.map(c => c.offset)).toEqual(sequential(offsets, boxes))
  expect(children[2]!.offset).toBe(0)
})

test('ordered shift product agrees with literal source arithmetic across signed extents', () => {
  let state = 0xa57826cb
  const next = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state }
  const delta = (): number => [LU_MIN, LU_MAX, 0, -64, 64, next() | 0][next() % 6]!
  for (let trial = 0; trial < 160; trial++) {
    const count = 1 + next() % 64
    const offsets = Array.from({ length: count }, delta)
    const boxes = Array.from({ length: 1 + next() % 80 }, (): Edges => {
      const start = next() % (count + 1)
      return { start, end: start + next() % (count - start + 1), mbpLineLeft: delta(), mbpLineRight: delta() }
    })
    const children = offsets.map(offset => ({ offset }))
    applyBoxEdges(children, boxes)
    expect(children.map(c => c.offset)).toEqual(sequential(offsets, boxes))
  }
})

test('many source box edges write each finished visual child once', () => {
  const count = 1024
  let reads = 0, writes = 0
  const children = Array.from({ length: count * 2 }, (_, k) => new Proxy({ offset: k * 64 }, {
    get(target, key) { if (key === 'offset') reads++; return Reflect.get(target, key) },
    set(target, key, value) { if (key === 'offset') writes++; return Reflect.set(target, key, value) },
  }))
  const boxes = Array.from({ length: count }, (_, k): Edges => ({ start: 2 * k, end: 2 * k + 1, mbpLineLeft: 64, mbpLineRight: -32 }))
  applyBoxEdges(children, boxes)
  expect(reads).toBeLessThanOrEqual(children.length * 2)
  expect(writes).toBe(children.length)
  expect(children[0]!.offset).toBe(64)
  expect(children[children.length - 1]!.offset).toBe((children.length - 1) * 64 + count * 32)
})
