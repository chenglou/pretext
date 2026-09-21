import { expect, test } from 'bun:test'
import type { Gap } from '../../model.js'
import { LineGapRanges } from './line-gap-ranges.js'

const gap = (start: number, end: number, detail: string, run: number | null = 0): Gap => ({
  gap: 'string-storage', run, detail, at: { start, end },
})

test('a bridge extends only the latest overlapping entry, keeping its fields and raw raise order', () => {
  const raw = [gap(0, 2, 'first'), gap(6, 8, 'second')]
  const ranges = new LineGapRanges(raw, 12)
  ranges.add('string-storage', 0, 'bridge', { start: 2, end: 6 })
  expect(raw).toEqual([gap(0, 2, 'first'), gap(2, 8, 'second')])
  ranges.add('string-storage', 1, 'other run', { start: 2, end: 6 })
  ranges.add('font-fallback', 0, 'other gap', { start: 2, end: 6 })
  expect(raw.slice(2)).toEqual([
    gap(2, 6, 'other run', 1),
    { gap: 'font-fallback', run: 0, detail: 'other gap', at: { start: 2, end: 6 } },
  ])
})

test('nested seeds stay latest outside an incoming range when an earlier entry is widened', () => {
  const seeds = [gap(0, 10, 'outer'), gap(7, 8, 'nested'), gap(7, 7, 'latest point')]
  const raw = seeds.map(value => ({ ...value }))
  const ranges = new LineGapRanges(raw, 20)
  ranges.add('string-storage', 0, 'widen outer', { start: 0, end: 15 })
  // The wide incoming range sees the last point and extends that entry, not the enclosing first one.
  expect(raw).toEqual([gap(0, 10, 'outer'), gap(7, 8, 'nested'), gap(0, 15, 'latest point')])
  expect(seeds).toEqual([gap(0, 10, 'outer'), gap(7, 8, 'nested'), gap(7, 7, 'latest point')])

  const overlaps = [gap(2, 10, 'outer'), gap(7, 8, 'nested')]
  const extended = overlaps.map(value => ({ ...value }))
  const index = new LineGapRanges(extended, 20)
  index.add('string-storage', 0, 'outer-only extension', { start: 0, end: 3 })
  index.add('string-storage', 0, 'nested extension', { start: 6, end: 7 })
  expect(extended).toEqual([gap(0, 10, 'outer'), gap(6, 8, 'nested')])
  expect(extended[0]!.at).not.toBe(overlaps[0]!.at)
  expect(extended[1]!.at).not.toBe(overlaps[1]!.at)
})

test('touching ranges and zero-length EOF points overlap; no-at entries retain multiplicity', () => {
  const scalar: Gap = { gap: 'string-storage', run: null, detail: 'scalar' }
  const raw: Gap[] = [{ ...scalar }, { ...scalar }, gap(0, 2, 'range', null)]
  const ranges = new LineGapRanges(raw, 4)
  ranges.add('string-storage', null, 'touch', { start: 2, end: 4 })
  ranges.add('string-storage', null, 'EOF', { start: 4, end: 4 })
  expect(raw).toEqual([scalar, scalar, gap(0, 4, 'range', null)])
  const empty: Gap[] = []
  const zero = new LineGapRanges(empty, 0)
  zero.add('string-storage', null, 'first', { start: 0, end: 0 })
  zero.add('string-storage', null, 'second', { start: 0, end: 0 })
  expect(empty).toEqual([gap(0, 0, 'first', null)])
})

test('separated emitted ranges do not reread every earlier raw gap', () => {
  const count = 1024
  let reads = 0
  const values: Gap[] = []
  const raw = new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  const ranges = new LineGapRanges(raw, 2 * count)
  for (let i = 0; i < count; i++) ranges.add('string-storage', 0, `gap ${i}`, { start: 2 * i, end: 2 * i + 1 })
  expect(reads).toBeLessThan(4 * count)
  expect(values.length).toBe(count)
  expect(values[0]).toEqual(gap(0, 1, 'gap 0'))
  expect(values[count - 1]).toEqual(gap(2 * count - 2, 2 * count - 1, `gap ${count - 1}`))
})
