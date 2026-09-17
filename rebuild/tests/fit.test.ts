// The fit arithmetic against the recorded probe verdicts it cites.
import { describe, expect, test } from 'bun:test'
import { fitThreshold, gridWidth, widthGrid } from './fit.ts'

describe('fit thresholds from browser facts', () => {
  test('Chrome at DPR 2, blink-lines H2: nnnnn nnnnn in 16px Arial, C128 = 11959', () => {
    const grid = widthGrid('chrome', 2)
    const t = fitThreshold('chrome', 2, 11959 / 128)
    expect(gridWidth(t, grid)).toBe(93.421875)
    expect(gridWidth(t - 1, grid)).toBe(93.4140625)
  })

  test('Safari, webkit-lines H3: smallest one-line width 2985/64 for a 46.65625px line', () => {
    expect(fitThreshold('webkit-host', 2, 46.65625)).toBe(2985)
    expect(fitThreshold('safari', 1, 46.65625)).toBe(2985)
  })

  test('Firefox, gecko-lines H1: aaaa bbbb in 16px Courier New is 5184 au; 86.4px fits, 86.38px does not', () => {
    const t = fitThreshold('firefox', 2, 5184 / 60)
    expect(t).toBe(5184)
    expect(Math.round(Math.fround(gridWidth(t, 60)) * 60)).toBe(5184)
    expect(Math.round(Math.fround(86.38) * 60)).toBe(t - 1)
  })
})
