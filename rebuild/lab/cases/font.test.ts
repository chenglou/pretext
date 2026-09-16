import { describe, expect, test } from 'bun:test'
import type { FontDecl } from '../types.ts'
import { canonicalFontFamily, formatFontShorthand, parseFontFamilyList, parseFontShorthand } from './font.ts'

describe('parseFontShorthand', () => {
  test('size and one family', () => {
    expect(parseFontShorthand('16px Arial')).toEqual({ family: 'Arial', size: 16, weight: 400, style: 'normal' })
  })

  test('numeric weight and a quoted family', () => {
    expect(parseFontShorthand('700 18px "Helvetica Neue"')).toEqual({ family: '"Helvetica Neue"', size: 18, weight: 700, style: 'normal' })
  })

  test('bold keyword', () => {
    expect(parseFontShorthand('bold 16px ProbeShantell')).toEqual({ family: 'ProbeShantell', size: 16, weight: 700, style: 'normal' })
  })

  test('style and weight in either order, with normal keywords', () => {
    const expected: FontDecl = { family: 'Georgia, serif', size: 12, weight: 700, style: 'italic' }
    expect(parseFontShorthand('italic 700 12px Georgia, serif')).toEqual(expected)
    expect(parseFontShorthand('700 italic 12px Georgia,serif')).toEqual(expected)
    expect(parseFontShorthand('normal normal 16px Arial')).toEqual({ family: 'Arial', size: 16, weight: 400, style: 'normal' })
    expect(parseFontShorthand('  italic   16px   Arial  ')).toEqual({ family: 'Arial', size: 16, weight: 400, style: 'italic' })
  })

  test('fractional size and weight', () => {
    expect(parseFontShorthand('550.5 13.33px Arial')).toEqual({ family: 'Arial', size: 13.33, weight: 550.5, style: 'normal' })
  })

  test('equivalent family spellings share one canonical form', () => {
    expect(parseFontShorthand('16px Times New Roman').family).toBe('"Times New Roman"')
    expect(parseFontShorthand('16px "Times New Roman"').family).toBe('"Times New Roman"')
    expect(parseFontShorthand("16px 'Times New Roman'").family).toBe('"Times New Roman"')
    expect(parseFontShorthand('16px "Arial"').family).toBe('Arial')
    expect(parseFontShorthand('16px Sans-Serif').family).toBe('sans-serif')
  })

  test('a quoted generic name is a family, not the generic keyword', () => {
    expect(parseFontShorthand('16px "serif"').family).toBe('"serif"')
    expect(parseFontFamilyList('"serif", serif')).toEqual([{ name: 'serif', generic: false }, { name: 'serif', generic: true }])
  })

  test('every font shorthand in the re-observed old suite parses', () => {
    const fonts = [
      '16px Arial', '24px Amiri', '16px "Shantell Sans"', '16px "Noto Naskh Arabic"', '18px Times New Roman', '16px "Hiragino Sans"',
      'bold 16px ProbeShantell', '16px "Noto Nastaliq Urdu"', '12px "Apple Color Emoji"',
      '20px "Helvetica Neue", Helvetica, Arial, sans-serif', '20px Verdana, Geneva, sans-serif', '12px "Courier New", Courier, monospace',
      '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif', '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif',
      '20px "Myanmar MN", "Myanmar Sangam MN", "Noto Sans Myanmar", serif', '20px "Thonburi", "Noto Sans Thai", sans-serif',
      '18px "Helvetica Neue", Arial, "Apple SD Gothic Neo", "Geeza Pro", "Kohinoor Devanagari", "Thonburi", sans-serif',
      '20px "Noto Nastaliq Urdu", "DecoType Nastaleeq Urdu UI", "Geeza Pro", serif', '18px serif', '16px "Times New Roman", SimSun, "Songti SC"',
      '12px Calibri, sans-serif', '20px "Geeza Pro", "Arial", serif',
    ]
    for (const value of fonts) {
      const parsed = parseFontShorthand(value)
      expect(parseFontShorthand(formatFontShorthand(parsed))).toEqual(parsed)
    }
    expect(parseFontShorthand('20px "Geeza Pro", "Arial", serif').family).toBe('"Geeza Pro", Arial, serif')
  })

  const rejected = [
    '', '16px', 'Arial', '16 Arial', 'oblique 16px Arial', 'small-caps 16px Arial', 'bolder 16px Arial', 'lighter 16px Arial',
    'condensed 16px Arial', '1em Arial', '12pt Arial', '100% Arial', '16PX Arial', '16px/20px Arial', '16px / 20px Arial',
    'bold bold 16px Arial', 'bold 700 16px Arial', 'italic italic 16px Arial', '1001 16px Arial', '0 16px Arial', '0px Arial',
    '16px Arial,', '16px ,Arial', '16px Arial,,serif', '16px "Arial', '16px "Ari\\"al"', '16px ""', '16px inherit', '16px initial',
    '16px 3D Font', 'var(--font) 16px Arial', '16px Arial "Neue"', 'large Arial', 'italic "Arial" 16px',
  ]
  for (const value of rejected) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      expect(() => parseFontShorthand(value)).toThrow()
    })
  }
})

describe('canonicalFontFamily', () => {
  test('is idempotent', () => {
    for (const list of ['"Helvetica Neue", Arial', 'Times New Roman, serif', "'PingFang SC', sans-serif", 'ヒラギノ角ゴシック, "Hiragino Sans"']) {
      const once = canonicalFontFamily(list)
      expect(canonicalFontFamily(once)).toBe(once)
    }
  })
})
