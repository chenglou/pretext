// A gap list as it is handed out (gaps.ts canonicalGaps), and the painter's script rule in an RTL block
// (paint-rules.ts lineStartScript).
import { describe, expect, test } from 'bun:test'
import type { Gap } from '../../model.js'
import { canonicalGaps } from './gaps.js'
import { blinkPaintRules } from './paint-rules.js'

const gap = (name: Gap['gap'], run: number | null, detail: string, start?: number, end?: number): Gap =>
  start === undefined || end === undefined ? { gap: name, run, detail } : { gap: name, run, detail, at: { start, end } }

describe('blink canonical gap lists', () => {
  test('ranges of one gap, run and detail that meet become one, where the first of them was', () => {
    // The list a build can leave: [9, 13] raised first, then an entry that grew to [10, 19] beside it.
    const built = [gap('script-context', 0, 'd', 9, 13), gap('unsafe-to-break', 0, 'u', 4, 4), gap('script-context', 0, 'd', 10, 19)]
    expect(canonicalGaps(built)).toEqual([gap('script-context', 0, 'd', 9, 19), gap('unsafe-to-break', 0, 'u', 4, 4)])
  })

  test('a range that meets two entries joins them, and touching counts as meeting', () => {
    const built = [gap('glyph-clusters', 1, 'd', 0, 3), gap('glyph-clusters', 1, 'd', 8, 9), gap('glyph-clusters', 1, 'd', 3, 8)]
    expect(canonicalGaps(built)).toEqual([gap('glyph-clusters', 1, 'd', 0, 9)])
  })

  test('another run, another detail or no range stays an entry of its own; the order is that of first raises', () => {
    const built = [
      gap('page-history', 0, 'p'), gap('script-context', 0, 'd', 5, 6), gap('script-context', 1, 'd', 5, 6), gap('script-context', 0, 'e', 5, 6),
      gap('script-context', 0, 'd', 0, 2),
    ]
    expect(canonicalGaps(built)).toEqual(built)
  })

  test('the same ranges raised again, in any order, give the same list', () => {
    const once = [gap('in-word-prefix', 0, 'd', 2, 4), gap('in-word-prefix', 0, 'd', 6, 8), gap('in-word-prefix', 0, 'd', 4, 6)]
    const again = [...once, once[1]!, once[0]!, once[2]!]
    expect(canonicalGaps(again)).toEqual(canonicalGaps(once))
    expect(canonicalGaps(canonicalGaps(once))).toEqual(canonicalGaps(once))
  })

  test('the entries are copies', () => {
    const built = [gap('tab-stops', 0, 'd', 1, 2)]
    const out = canonicalGaps(built)
    out[0]!.at!.end = 9
    expect(built[0]!.at).toEqual({ start: 1, end: 2 })
  })
})

describe('blink painter script rule', () => {
  const rule = blinkPaintRules.lineStartScript
  if (rule.form !== 'arabic-letter-mark') throw new Error('the Blink painter asks its script itemizer')
  const COMMON = 0, LATIN = 25

  test('an 8-bit line is one Latin segment in an LTR block and is segmented by script in an RTL one', () => {
    expect(Array.from(rule.scriptsOf('((( ', false, 'ltr'))).toEqual([LATIN, LATIN, LATIN, LATIN])
    expect(Array.from(rule.scriptsOf('((( ', false, 'rtl'))).toEqual([COMMON, COMMON, COMMON, COMMON])
    // With a letter the brackets take its script either way.
    expect(Array.from(rule.scriptsOf('((a', false, 'rtl'))).toEqual([LATIN, LATIN, LATIN])
  })
})
