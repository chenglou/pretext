import { expect, test } from 'bun:test'
import { indexContent } from '../../content.js'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { lengthLU, stylesOf } from './content.js'
import { addLU, subLU, negLU, clampLU, LU_MIN, LU_MAX } from './layout-unit.js'
import { ceilFrom16, luCeil, luTrunc } from './shape.js'

test('source fixed-point conversions saturate signed i32 storage, including ceil from InlineLayoutUnit', () => {
  expect([luCeil(Infinity), luCeil(-Infinity), luTrunc(NaN), clampLU(NaN)]).toEqual([LU_MAX, LU_MIN, 0, 0])
  expect([luCeil(1 / 128), luTrunc(1 / 128), luTrunc(-1 / 128)]).toEqual([1, 0, 0])
  expect([ceilFrom16(LU_MAX * 1024 + 1), ceilFrom16(LU_MIN * 1024 - 1)]).toEqual([LU_MAX, LU_MIN])
})

test('CSS fixed lengths clamp before float storage and LayoutUnit conversion', () => {
  // CSSPrimitiveValue clamps the double product to +/- CSS length limits before returning a float.
  // The positive limit 33554429 rounds to 33554428 in float storage; the negative -33554430 is exact.
  expect([lengthLU(33554432, 1), lengthLU(-33554432, 1), lengthLU(33554430, 1)]).toEqual([2147483392, -2147483520, 2147483392])
  expect([lengthLU(33554427, 1), lengthLU(-33554429, 1)]).toEqual([2147483392, -2147483392])
  expect([lengthLU(33554432, 2), lengthLU(-33554432, 2)]).toEqual([2147483392, -2147483520])
})

test('each source fixed-point update saturates before a later cancellation', () => {
  expect(addLU(addLU(512, LU_MAX), -LU_MAX)).toBe(0)
  expect(addLU(addLU(-512, LU_MIN), LU_MAX)).toBe(-1)
  expect(subLU(0, LU_MIN)).toBe(LU_MAX)
  expect(subLU(LU_MIN, 1)).toBe(LU_MIN)
  expect([negLU(LU_MIN), negLU(LU_MAX), negLU(0)]).toEqual([LU_MAX, -LU_MAX, 0])
})

test('ConvertBorderWidth caps integer pixels before converting to LayoutUnit', () => {
  const font = { family: 'Arial', size: 16, weight: 400, style: 'normal' as const, facts: UNKNOWN_FONT_FACTS }
  const p: Paragraph = {
    font, content: [], letterSpacing: 0, wordSpacing: 0, lineHeight: 20, whiteSpace: 'nowrap', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
  p.content = [{
    ...p, kind: 'span', children: [{ kind: 'text', text: 'a' }], lang: null, verticalAlign: 'baseline',
    inlineStart: { margin: 1e20, border: 1e20, padding: 1e20 }, inlineEnd: NO_BOX_EDGE,
  }]
  const style = stylesOf(p, indexContent(p), 1).styles[1]!
  expect(style.start).toEqual({ margin: 2147483392, border: 2147483584, padding: 2147483392 })
})
