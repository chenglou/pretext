// A gap list as it is handed out (gaps.ts canonicalGaps), and the painter's script rule in an RTL block
// (paint-rules.ts lineStartScript).
import { describe, expect, test } from 'bun:test'
import type { Gap } from '../../model.js'
import { ParagraphGapIndex } from './paragraph-gap-index.js'
import { GapAccumulator } from './gap-accumulator.js'
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

// The raw list deliberately widens only its first touching entry. Checkpoints remove appended entries, not those widenings.
describe('blink raw gap accumulation', () => {
  test('a bridge widens the first raise without consuming the later raw entry', () => {
    const gaps = new GapAccumulator(32)
    gaps.add('script-context', 0, 'd', { start: 0, end: 2 })
    gaps.add('script-context', 0, 'd', { start: 4, end: 6 })
    const checkpoint = gaps.length
    gaps.add('script-context', 0, 'd', { start: 2, end: 4 })
    gaps.add('script-context', 0, 'd', { start: 4, end: 8 })
    gaps.add('unsafe-to-break', 0, 'u', { start: 20, end: 20 })
    gaps.truncate(checkpoint)
    expect(gaps.snapshot()).toEqual([gap('script-context', 0, 'd', 0, 8), gap('script-context', 0, 'd', 4, 6)])
    expect(canonicalGaps(gaps.snapshot())).toEqual([gap('script-context', 0, 'd', 0, 8)])
  })

  test('discarded scalar and range raises can be raised again, with independent detail and run keys', () => {
    const gaps = new GapAccumulator(32)
    gaps.add('page-history', null, 'd')
    gaps.add('page-history', null, 'd')
    gaps.add('page-history', null, 'd', { start: 0, end: 0 })
    gaps.add('page-history', 0, 'd', { start: 0, end: 0 })
    gaps.add('page-history', null, 'd\0x', { start: 0, end: 0 })
    gaps.truncate(1)
    gaps.add('page-history', null, 'd', { start: 16, end: 16 })
    gaps.add('page-history', null, 'd')
    expect(gaps.snapshot()).toEqual([gap('page-history', null, 'd'), gap('page-history', null, 'd', 16, 16)])
    gaps.truncate(0)
    gaps.add('page-history', null, 'd')
    expect(gaps.snapshot()).toEqual([gap('page-history', null, 'd')])
  })

  test('restoring raw overlaps preserves first-raise priority and copies the input ranges', () => {
    const raw = [gap('script-context', 0, 'd', 0, 8), gap('script-context', 0, 'd', 4, 6)]
    const gaps = new GapAccumulator(32, raw)
    gaps.add('script-context', 0, 'd', { start: 6, end: 10 })
    expect(gaps.snapshot()).toEqual([gap('script-context', 0, 'd', 0, 10), gap('script-context', 0, 'd', 4, 6)])
    expect(raw).toEqual([gap('script-context', 0, 'd', 0, 8), gap('script-context', 0, 'd', 4, 6)])
    gaps.truncate(1)
    gaps.add('script-context', 0, 'd', { start: 20, end: 20 })
    expect(gaps.snapshot()).toEqual([gap('script-context', 0, 'd', 0, 10), gap('script-context', 0, 'd', 20, 20)])
  })

  test('zero-length sources and long touching growth retain one raw range', () => {
    const empty = new GapAccumulator(0)
    empty.add('script-context', null, 'd', { start: 0, end: 0 })
    expect(empty.snapshot()).toEqual([gap('script-context', null, 'd', 0, 0)])
    const gaps = new GapAccumulator(4096)
    for (let end = 1; end <= 4096; end++) gaps.add('script-context', 0, 'd', { start: end - 1, end })
    expect(gaps.snapshot()).toEqual([gap('script-context', 0, 'd', 0, 4096)])
    gaps.truncate(0)
    gaps.add('script-context', 0, 'd', { start: 4000, end: 4000 })
    expect(gaps.snapshot()).toEqual([gap('script-context', 0, 'd', 4000, 4000)])
  })

  test('mixed first-touch, repeated and speculative raises keep the raw contract', () => {
    // Independent flat-list oracle states the existing first-touch rule, including its retained widening on rollback.
    const raise = (raw: Gap[], name: Gap['gap'], run: number | null, detail: string, at?: { start: number; end: number }): void => {
      for (const g of raw) {
        if (g.gap !== name || g.run !== run || g.detail !== detail) continue
        if (at === undefined) { if (g.at === undefined) return }
        else if (g.at !== undefined && at.start <= g.at.end && at.end >= g.at.start) {
          g.at = { start: Math.min(g.at.start, at.start), end: Math.max(g.at.end, at.end) }
          return
        }
      }
      raw.push(at === undefined ? gap(name, run, detail) : gap(name, run, detail, at.start, at.end))
    }
    let seed = 339703
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
    const names = ['script-context', 'unsafe-to-break', 'page-history'] as const
    for (let sequence = 0; sequence < 24; sequence++) {
      const raw: Gap[] = []
      let gaps = new GapAccumulator(1024)
      for (let i = 0; i < 128; i++) {
        if (random() < 0.15) {
          const count = Math.floor(random() * (raw.length + 1))
          raw.length = count
          gaps.truncate(count)
        } else {
          const start = Math.floor(random() * 1025)
          const end = Math.min(1024, start + Math.floor(random() * 20))
          const name = names[Math.floor(random() * names.length)]!
          const run = random() < 0.25 ? null : Math.floor(random() * 4)
          const detail = 'd' + Math.floor(random() * 2)
          const at = random() < 0.1 ? undefined : { start, end }
          raise(raw, name, run, detail, at)
          gaps.add(name, run, detail, at)
        }
        expect(gaps.snapshot()).toEqual(raw)
        if (i === 63) gaps = new GapAccumulator(1024, gaps.snapshot())
      }
    }
  })
})

describe('blink prepared paragraph gap selection', () => {
  test('source intervals are selected in original raise order, across nested, touching and scalar entries', () => {
    const raw = [
      gap('script-context', 0, 'd', 8, 12), gap('script-context', 1, 'd', 0, 20), gap('page-history', null, 'd'),
      gap('script-context', 2, 'd', 4, 6), gap('script-context', 3, 'd', 6, 6), gap('script-context', 4, 'd', 5, 8),
    ]
    const original = structuredClone(raw)
    const index = new ParagraphGapIndex(raw)
    expect(index.intersect(5, 9)).toEqual([0, 1, 3, 4, 5])
    expect(index.intersect(6, 6)).toEqual([1, 5])
    expect(index.intersect(12, 14)).toEqual([1])
    expect(index.intersect(32, 36)).toEqual([])
    expect(index.intersect(0, 20)).toEqual([0, 1, 3, 4, 5])
    expect(raw).toEqual(original)
    expect(new ParagraphGapIndex([]).intersect(0, 0)).toEqual([])
  })

  test('disjoint and overlapping positive source ranges agree with the original strict filter', () => {
    let seed = 930115
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (let sequence = 0; sequence < 32; sequence++) {
      const raw: Gap[] = Array.from({ length: 128 }, (_, i) => {
        const start = Math.floor(random() * 1025)
        return random() < 0.1 ? gap('page-history', null, 'd') : gap('script-context', i, 'd', start, start + Math.floor(random() * 256))
      })
      const index = new ParagraphGapIndex(raw)
      for (let query = 0; query < 64; query++) {
        const start = Math.floor(random() * 1536) - 128, end = start + Math.floor(random() * 256)
        const expected: number[] = []
        for (let i = 0; i < raw.length; i++) {
          const at = raw[i]!.at
          if (at !== undefined && at.start < end && at.end > start) expected.push(i)
        }
        expect(index.intersect(start, end)).toEqual(expected)
      }
    }
  })
})
