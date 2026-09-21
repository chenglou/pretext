// Stable Chrome153 observations for c-d0c13fd8c7aca939, both orders, DPR2. Check positive source placement without a gap waiver.
import { expect, test } from 'bun:test'
import { evaluateVisibleRanges } from './check-main-obligations.ts'
import { blink, native, paragraph, row } from '../lab/row-fixtures.ts'

const p = paragraph([['لألالإلآ', 'text']], { letterSpacing: 1, width: 16.849999237060548, lineHeight: 48, overflowWrap: 'break-word' })
p.runs[0]!.letterSpacing = 1
const points = Array.from({ length: 8 }, (_, offset) => [{
  x: offset % 2 === 0 ? 4.3515625 : 0, y: 15 + Math.floor(offset / 2) * 48, width: 4.3515625, height: 18,
}])
const runRects = Array.from({ length: 4 }, (_, line) => ({ x: 0, y: 15 + line * 48, width: 8.703125, height: 18 }))
const observed = native(p, points, [runRects])
observed.width = 16.84375; observed.height = 192

// Kept as a real visible obligation although the unavailable cluster information is named truthfully.
test('a joined-text main pass requires correct native line count and positive source cuts despite glyph-cluster uncertainty', () => {
  const failed = row('chrome', p, observed, blink([[0, 3, 1538], [3, 6, 1584], [6, 8, 1114]]), { error: 'inspection unavailable' })
  if (!('layout' in failed.prediction)) throw new Error('fixture layout')
  failed.prediction.layout.gaps = [{ gap: 'glyph-clusters', run: 0, detail: 'cluster membership unavailable' }]
  expect(evaluateVisibleRanges(failed)).toMatchObject({ lineCount: { status: 'fail' }, nativeLines: 4, ranges: [[0, 3], [3, 6], [6, 8]] })
  const withRanges = (ranges: [number, number][]) => ({
    ...failed, prediction: { lines: ranges.map(([start, end]) => ({ start, end, width: 10.703125 })) },
  })
  expect(evaluateVisibleRanges(withRanges([[0, 2], [2, 4], [4, 6], [6, 8]]))).toMatchObject({
    lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' },
  })
  expect(evaluateVisibleRanges(withRanges([[0, 3], [3, 4], [4, 6], [6, 8]]))).toMatchObject({
    lineCount: { status: 'pass' }, visibleBreaks: { status: 'fail' },
  })
})
