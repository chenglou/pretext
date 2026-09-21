import { expect, test } from 'bun:test'
import { reorderBoxes, type BoxData } from './box-reorder.js'

function box(start: number, end: number, element: number): BoxData {
  return {
    element, start, end, hasLineLeftEdge: true, hasLineRightEdge: true,
    marginLineLeft: 3, marginLineRight: 5, mbpLineLeft: 7, mbpLineRight: 11,
    parent: 0, fragmentedFrom: 0, rectLeft: 0, rectRight: 0,
  }
}

test('visual fragments retain source order and move only the right edge to the last fragment', () => {
  const logical = Array.from({ length: 4 }, () => ({ box: 0 }))
  const visual = [logical[0]!, logical[3]!, logical[1]!, logical[2]!]
  const output = reorderBoxes(logical, visual, [box(0, 3, 12)])
  expect(output.map(b => [b.element, b.start, b.end, b.parent, b.fragmentedFrom])).toEqual([
    [12, 0, 1, 0, 1], [12, 2, 4, 0, 0],
  ])
  expect(output.map(b => [b.hasLineLeftEdge, b.hasLineRightEdge, b.marginLineLeft, b.marginLineRight, b.mbpLineLeft, b.mbpLineRight])).toEqual([
    [true, false, 3, 0, 7, 0], [false, true, 0, 5, 0, 11],
  ])
  expect(logical.every(child => child.box === 0)).toBe(true)
})

test('deep connected source boxes use only local parent paths', () => {
  const depth = 1024
  let parentReads = 0
  const boxes = Array.from({ length: depth }, (_, i) => new Proxy(box(depth - i - 1, depth + 1, i), {
    get(target, key, receiver) {
      if (key === 'parent') parentReads++
      return Reflect.get(target, key, receiver)
    },
  }))
  const logical = Array.from({ length: depth + 1 }, () => ({ box: 0 }))
  const visual = logical.slice().reverse()
  const output = reorderBoxes(logical, visual, boxes)
  expect(parentReads).toBeLessThanOrEqual(8 * depth)
  expect(output.length).toBe(depth)
  expect(output[0]).toMatchObject({ element: 0, start: 0, end: 2, parent: 2 })
  expect(output[depth - 1]).toMatchObject({ element: depth - 1, start: 0, end: depth + 1, parent: 0 })
  expect(output.every(b => b.hasLineLeftEdge && b.hasLineRightEdge && b.fragmentedFrom === 0)).toBe(true)
  expect(logical.every(child => child.box === 0)).toBe(true)
})

test('disconnected visual fragments do not repeatedly reindex earlier source boxes', () => {
  const count = 512
  let ownerReads = 0
  const boxes = Array.from({ length: count }, (_, i) => new Proxy(box(2 * i, 2 * i + 2, i), {
    get(target, key, receiver) {
      if (key === 'fragmentedFrom') ownerReads++
      return Reflect.get(target, key, receiver)
    },
  }))
  const logical = Array.from({ length: 2 * count }, () => ({ box: 0 }))
  const visual = [
    ...logical.filter((_, i) => i % 2 === 0),
    ...logical.filter((_, i) => i % 2 === 1),
  ]
  const output = reorderBoxes(logical, visual, boxes)
  expect(ownerReads).toBeLessThanOrEqual(16 * count)
  expect(output.length).toBe(2 * count)
  expect(output[0]).toMatchObject({ element: 0, start: 0, end: 1, fragmentedFrom: 1, hasLineRightEdge: false })
  expect(output[1]).toMatchObject({ element: 0, start: count, end: count + 1, fragmentedFrom: 0, hasLineLeftEdge: false, hasLineRightEdge: true })
  expect(output.at(-1)).toMatchObject({ element: count - 1, start: 2 * count - 1, end: 2 * count, hasLineRightEdge: true })
})

test('source depth uses local stacks without truncating or overflowing', () => {
  const depth = 32768
  const boxes = Array.from({ length: depth }, (_, i) => box(depth - i - 1, depth + 1, i))
  const logical = Array.from({ length: depth + 1 }, () => ({ box: 0 }))
  const output = reorderBoxes(logical, logical.slice().reverse(), boxes)
  expect(output.length).toBe(depth)
  expect(output[0]).toMatchObject({ start: 0, end: 2 })
  expect(output.at(-1)).toMatchObject({ start: 0, end: depth + 1 })
})
