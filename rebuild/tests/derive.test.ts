// The derivation's bracketing on hand-made observations.
import { describe, expect, test } from 'bun:test'
import { el, font, leaf, treeParagraph } from '../lab/cases/build.ts'
import { bisectionWidths, chooseByFocus, declaredOffset, evaluate, hasOwnOverflowWrap, lineEnd, MAX_D_ROUNDS, minimumUnits, unresolvedReason, type Observed } from './derive.ts'

function observed(units: number, keys: number[], textLength = 20): Observed {
  return { units, keys, textLength, caseId: `c-${units}` }
}

describe('derivation brackets', () => {
  test('lineEnd: the key of the next line, the text end, or null without a line at s', () => {
    expect(lineEnd(observed(100, [0, 5, 10]), 0)).toBe(5)
    expect(lineEnd(observed(100, [0, 5, 10]), 10)).toBe(20)
    expect(lineEnd(observed(100, [0, 5, 10]), 7)).toBeNull()
  })

  test('adjacent grid widths where the line reaches k and doesn\'t resolve the target', () => {
    const own = [observed(128, [0, 5, 10]), observed(900, [0, 5, 10]), observed(901, [0, 10]), observed(12800000, [0])]
    expect(evaluate({ s: 0, k: 10 }, own)).toEqual({ kind: 'resolved', hi: 901, lo: 900, nonMonotone: false })
  })

  test('a gap between the nearest differing widths is a window', () => {
    const own = [observed(128, [0, 5, 10]), observed(880, [0, 5]), observed(960, [0])]
    expect(evaluate({ s: 0, k: 10 }, own)).toEqual({ kind: 'window', lo: 880, hi: 960, nonMonotone: false })
  })

  test('a wider width that stops short again is reported as non-monotone', () => {
    const own = [observed(128, [0, 5]), observed(500, [0, 10]), observed(501, [0, 5, 12]), observed(499, [0, 5])]
    expect(evaluate({ s: 0, k: 10 }, own)).toEqual({ kind: 'resolved', hi: 500, lo: 499, nonMonotone: true })
  })

  test('widths without a line starting at s don\'t count', () => {
    const own = [observed(128, [0, 3, 6, 12]), observed(600, [0, 4, 9]), observed(700, [0, 6])]
    expect(evaluate({ s: 6, k: 20 }, own)).toEqual({ kind: 'window', lo: 128, hi: 700, nonMonotone: false })
    expect(evaluate({ s: 5, k: 9 }, own)).toEqual({ kind: 'no-reach' })
  })

  test('an open window names why: rounds exhausted, no narrower width, or no line starting at s inside it', () => {
    expect(unresolvedReason({ kind: 'window', lo: 10, hi: 90, nonMonotone: false }, MAX_D_ROUNDS)).toBe('rounds-exhausted')
    expect(unresolvedReason({ kind: 'window', lo: null, hi: 90, nonMonotone: false }, 1)).toBe('no-short-width')
    expect(unresolvedReason({ kind: 'window', lo: 10, hi: 90, nonMonotone: false }, 2)).toBe('no-line-inside')
  })

  test('bisection widths stay strictly inside the window and cover small windows whole', () => {
    expect(bisectionWidths(10, 15)).toEqual([11, 12, 13, 14])
    const wide = bisectionWidths(0, 1000)
    expect(wide.length).toBe(16)
    for (const u of wide) expect(u > 0 && u < 1000).toBe(true)
  })

  test('focus offsets choose their candidate, or the nearest on each side', () => {
    expect(chooseByFocus([3, 6, 9, 12], [9], 0, 20, 4)).toEqual([9])
    expect(chooseByFocus([3, 6, 9, 12], [8], 0, 20, 4)).toEqual([6, 9])
    expect(chooseByFocus([3, 6, 9, 12], [8, 13], 7, 20, 4)).toEqual([9, 12])
    expect(chooseByFocus([3, 6, 9, 12], [2, 5, 11], 0, 20, 2)).toEqual([3, 6])
  })
})

describe('structured paragraphs', () => {
  const arial = font('Arial', 16)

  test('an overflow-wrap on a span alone makes pass A observe twice', () => {
    expect(hasOwnOverflowWrap(treeParagraph({ font: arial, lang: 'en', textIndent: 4 }, [leaf('a b')]))).toBe(false)
    expect(hasOwnOverflowWrap(treeParagraph({ font: arial, lang: 'en' }, [leaf('a '), el({}, el({ overflowWrap: 'anywhere' }, leaf('bbbb')))]))).toBe(true)
  })

  test('declared lengths: the first row\'s insets, and the indent on the first line only', () => {
    const tree = treeParagraph({ font: arial, lang: 'en', textIndent: -12, lineSlots: [{ left: 40, right: 37.3 }, { left: 10, right: 10 }] }, [leaf('a b')])
    expect(declaredOffset(tree.inline, 0)).toBeCloseTo(65.3, 9)
    expect(declaredOffset(tree.inline, 5)).toBeCloseTo(77.3, 9)
    expect(declaredOffset(undefined, 0)).toBe(0)
  })

  test('sized passes stay at or above the widest row of insets, in grid units', () => {
    const tree = treeParagraph({ font: arial, lang: 'en', lineSlots: [{ left: 40, right: 0 }, { left: 111.9, right: 0 }] }, [leaf('a b')])
    expect(minimumUnits(tree.inline, 128)).toBe(Math.ceil(111.9 * 128))
    expect(minimumUnits(treeParagraph({ font: arial, lang: 'en', textIndent: 3 }, [leaf('a b')]).inline, 128)).toBe(0)
  })
})
