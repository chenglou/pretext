// The bench's inputs stay in their size classes and deterministic, and the statistics are the documented ones.
//   bun test rebuild/bench
import { describe, expect, test } from 'bun:test'
import { buildContexts, buildInput, buildMessages, SCENARIOS, SCRIPTS, SIZE_RANGES, SIZES, SWEEP_WIDTHS } from './cases.ts'
import { median, quantile, summarize } from './stats.ts'

describe('cases', () => {
  test('every input is in its size class', () => {
    for (let s = 0; s < SCRIPTS.length; s++) {
      for (let z = 0; z < SIZES.length; z++) {
        const text = buildInput(SCRIPTS[s]!, SIZES[z]!)
        const [min, max] = SIZE_RANGES[SIZES[z]!]
        expect(text.length).toBeGreaterThanOrEqual(min)
        expect(text.length).toBeLessThanOrEqual(max)
      }
    }
  })

  test('messages are deterministic, non-empty and chat-sized', () => {
    for (let s = 0; s < SCRIPTS.length; s++) {
      const first = buildMessages(SCRIPTS[s]!, 1000)
      expect(buildMessages(SCRIPTS[s]!, 1000)).toEqual(first)
      expect(first.length).toBe(1000)
      for (let i = 0; i < first.length; i++) {
        expect(first[i]!.length).toBeGreaterThan(0)
        expect(first[i]!.length).toBeLessThanOrEqual(410)
      }
    }
  })

  test('contexts hold one row per size per scenario, and one many row', () => {
    const contexts = buildContexts({ scripts: SCRIPTS, sizes: SIZES, scenarios: SCENARIOS, messages: 10 })
    expect(contexts.length).toBe(SCRIPTS.length)
    for (let c = 0; c < contexts.length; c++) expect(contexts[c]!.rows.length).toBe(2 * SIZES.length + 1)
    expect(SWEEP_WIDTHS.length).toBe(20)
  })
})

describe('stats', () => {
  test('nearest-rank p95 and median', () => {
    const values = Array.from({ length: 40 }, (_, i) => i + 1)
    expect(quantile(values, 0.95)).toBe(38)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  test('outliers and heap drops', () => {
    const stats = summarize([1, 1, 1, 1, 10], 7, [false, true, false, false, true])
    expect(stats.n).toBe(5)
    expect(stats.reps).toBe(7)
    expect(stats.medianMs).toBe(1)
    expect(stats.outliers).toBe(1)
    expect(stats.heapDropSamples).toBe(2)
    expect(summarize([1, 2], 1, null).heapDropSamples).toBeNull()
  })
})
