import { expect, test } from 'bun:test'
import { appendLineRun, rightMostRun } from './run-extent.js'
import type { LineRun } from './types.js'

function run(left: number, width: number): LineRun {
  return { kind: 'atomic', element: 0, sourceOffset: 0, level: 254, left: Math.fround(left), width: Math.fround(width) }
}

function literalRight(runs: readonly LineRun[]): number {
  let right = 0
  for (let i = runs.length - 1; i >= 0; i--) right = Math.max(right, Math.fround(runs[i]!.left + runs[i]!.width))
  return right
}

test('a mutable last run and signed float geometry retain the full-list extent', () => {
  const extent = { rightMostBeforeLastRun: null as number | null }, runs: LineRun[] = []
  const inputs = [[10, -20], [16777214, .9921875], [-16776215.992, 10.890625], [92.1015625, 16777206.992], [0, -0]]
  for (const [left, width] of inputs) {
    const last = run(left!, width!)
    appendLineRun(extent, runs, last)
    for (const change of [-16, 32, -64, 0]) {
      last.width = Math.fround(last.width + change)
      expect(rightMostRun(extent, runs)).toBe(literalRight(runs))
    }
  }
  // A rebuild owns a fresh run list and no extent from the abandoned line.
  extent.rightMostBeforeLastRun = null
  const rebuilt: LineRun[] = []
  appendLineRun(extent, rebuilt, run(0, 3))
  expect(rightMostRun(extent, rebuilt)).toBe(3)
})

test('ordinary appends need no extent reads and one demanded extent has a linear operation budget', () => {
  const extent = { rightMostBeforeLastRun: null as number | null }, raw: LineRun[] = []
  let reads = 0
  const runs = new Proxy(raw, { get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) reads++
    return Reflect.get(target, property, receiver)
  } })
  const count = 1024
  for (let i = 0; i < count; i++) {
    const last = run(i / 8, i % 2 ? -3 : 4)
    appendLineRun(extent, runs, last)
    last.width = Math.fround(last.width - i % 3)
    if (i < count / 4) continue
    expect(rightMostRun(extent, runs)).toBe(literalRight(raw))
  }
  expect(reads).toBeLessThanOrEqual(2 * count)
  const inactive = { rightMostBeforeLastRun: null as number | null }
  reads = 0
  const ordinary: LineRun[] = new Proxy([], { get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) reads++
    return Reflect.get(target, property, receiver)
  } })
  for (let i = 0; i < count; i++) appendLineRun(inactive, ordinary, run(i, 1))
  expect(reads).toBe(0)
})
