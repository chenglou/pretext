import { expect, test } from 'bun:test'
import { abcd, abcdExpected, abcdLayout, abcdNative, row } from '../lab/row-fixtures.ts'
import { evaluateVisibleRanges } from './check-main-obligations.ts'
import type { BrowserKind } from '../lab/types.ts'
function input(browser: BrowserKind, width: number, dpr: number, observed: number) {
  const value = row(browser, structuredClone(abcd), structuredClone(abcdNative), structuredClone(abcdLayout), structuredClone(abcdExpected))
  value.case.paragraph.width = width; value.env.devicePixelRatio = dpr
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.width = observed
  return value
}
test('integer and zero content-box widths retain exact bounds in all lab browsers at DPR1/2', () => {
  for (const browser of ['chrome', 'firefox', 'webkit-host', 'safari'] as const) for (const dpr of [1, 2]) for (const width of [0, 1, 220, 820]) {
    const value = input(browser, width, dpr, width)
    expect(evaluateVisibleRanges(value).lineCount.status).toBe('pass'); expect(evaluateVisibleRanges(value).visibleBreaks.status).toBe('pass')
  }
})
test('fractional native content boxes follow each browser encoding, not exact JS input equality or a fitted tolerance', () => {
  const cases: Array<[BrowserKind, number, number, number]> = [
    ['chrome', 20.0149, 1, 20], ['chrome', 20.0149, 2, 20.0078125],
    // Non-power-of-two zoom must retain the final float32 client-coordinate conversion.
    ['chrome', 20.0149, 1.5, 20.010417938232422],
    ['webkit-host', 20.0149, 1, 20], ['webkit-host', 20.0149, 2, 20],
    ['firefox', 31.083333206176757, 1, 31.083328247070312], ['firefox', 31.083333206176757, 2, 31.083328247070312],
    ['firefox', 86.38, 2, 86.38333129882812],
    // Float32 rounds this declaration onto the exact lattice before truncation.
    ['chrome', 17.749999237060546, 2, 17.75], ['webkit-host', 17.749999237060546, 2, 17.75],
  ]
  for (const [browser, width, dpr, observed] of cases) {
    const value = input(browser, width, dpr, observed)
    expect(evaluateVisibleRanges(value).visibleBreaks.status).toBe('pass')
    if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
    value.native.width = observed + (browser === 'firefox' ? 1 / 60 : 1 / 128)
    expect(evaluateVisibleRanges(value).visibleBreaks.detail).toContain('expected observed content-box width')
  }
})
test('pinch zoom does not change Blink layout quantization; WebKit/Gecko DPR changes do not alter declared width encoding', () => {
  const value = input('chrome', 20.0149, 2, 20.0078125); value.env.visualViewportScale = 1.5
  expect(evaluateVisibleRanges(value).visibleBreaks.status).toBe('pass')
  for (const browser of ['webkit-host', 'firefox'] as const) {
    const observed = browser === 'webkit-host' ? 20 : 20.01666259765625
    for (const dpr of [1, 2]) expect(evaluateVisibleRanges(input(browser, 20.0149, dpr, observed)).visibleBreaks.status).toBe('pass')
  }
})
test('an overflowing atomic inline keeps the declared parent content-box width', () => {
  const value = input('chrome', 20, 2, 20)
  value.case.paragraph.runs = []; value.prediction = { lines: [{ start: 0, end: 0 }] }
  value.case.inline = { textIndent: 0, textAlign: 'start', lineSlots: [], content: [{ kind: 'atomic', width: 200, height: 20, marginInlineStart: 0, marginInlineEnd: 0 }] }
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.points = []; value.native.runRects = []; value.native.elements = [[{ x: 0, y: 0, width: 200, height: 20 }]]; value.native.height = 20
  expect(evaluateVisibleRanges(value).lineCount.status).toBe('pass')
  expect(evaluateVisibleRanges(value).visibleBreaks.status).toBe('inconclusive') // No text: do not invent a visible-cut certificate.
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.width = 200; expect(evaluateVisibleRanges(value).visibleBreaks.detail).toContain('expected observed content-box width 20px')
})
test('unknown or clamped geometry needs protocol review rather than a guessed width pass', () => {
  for (const value of [input('chrome', 20, NaN, 20), input('chrome', 20, 0, 20), input('firefox', 200000, 2, 200000), input('webkit-host', 1e100, 2, 1e100)]) expect(evaluateVisibleRanges(value).visibleBreaks.status).toBe('protocol')
  const unavailable = input('chrome', 20, 2, 100); unavailable.native = { error: 'native unavailable' }
  expect(evaluateVisibleRanges(unavailable).visibleBreaks.status).toBe('inconclusive') // Scorer owns missing-native classification.
})
