// Planted defects in the case sets: each test plants a fault the sets exist to avoid. The test name says what an app
// developer would see if it went unseen.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeRecordings } from '../store.ts'
import type { Recording } from '../types.ts'
import { font, paragraph, writeCases } from './build.ts'
import { oracleCases, reportCases } from './exact.ts'
import { checkedInSample, drawSample } from './sample.ts'
import { CUT_BROWSERS, cut, dirOf, probesFile, recordingsFile, select, sweepId, templateKey, type Template } from './widths.ts'

describe('the real-usage sample', () => {
  test('every group weighs its real share: a rare group topped up to 300 draws would otherwise move the headline by far more than it moves real apps', () => {
    const sample = drawSample({ draws: 3000, minimum: 150, pilot: 30_000 })
    for (let g = 0; g < sample.groups.length; g++) {
      const group = sample.groups[g]!
      expect(group.first + group.extra).toBeGreaterThanOrEqual(150)
      // Drawn at random, so within a few standard errors of the pilot's share, never the extra draws' share.
      expect(Math.abs(group.weighted - group.share)).toBeLessThan(Math.max(0.3 * group.share, 0.004))
    }
    let total = 0
    for (let i = 0; i < sample.cases.length; i++) total += sample.cases[i]!.sample!.weight
    expect(total).toBeCloseTo(1, 4)
  }, 60_000)

  test('the checked-in sample is what weights.json draws: a changed weight without a new draw would score the old usage', () => {
    const dir = join(import.meta.dir, '../../.artifacts/harness-sets')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'sample-check.ndjson')
    writeCases(path, checkedInSample().cases)
    expect(readFileSync(path, 'utf8')).toBe(readFileSync(join(import.meta.dir, '../cases/sample.ndjson'), 'utf8'))
    rmSync(path)
  }, 60_000)
})

describe('the sets taken as they are', () => {
  test('the checked-in reports and oracles are what their sources make: a report or an oracle added to src/test-data.ts would go unchecked', () => {
    const dir = join(import.meta.dir, '../../.artifacts/harness-sets')
    mkdirSync(dir, { recursive: true })
    const sets: Array<[string, ReturnType<typeof reportCases>]> = [['reports', reportCases()], ['oracles', oracleCases()]]
    for (let i = 0; i < sets.length; i++) {
      const path = join(dir, `${sets[i]![0]}-check.ndjson`)
      writeCases(path, sets[i]![1])
      expect(readFileSync(path, 'utf8')).toBe(readFileSync(join(import.meta.dir, `../cases/${sets[i]![0]}.ndjson`), 'utf8'))
      rmSync(path)
    }
  })
})

// A set of synthetic templates with recordings laid out by hand, in the three browsers.
const SET = `sets-test-${process.pid}`
const line = (first: number, last: number, width: number): { first: number; last: number; width: number } => ({ first, last, width })
function template(text: string, family = 'test/controls'): Template {
  return { family, origin: 'test', pageLang: 'en', paragraph: paragraph({ font: font('Arial', 16), lang: 'en' }, [text]), widths: [10, 20], grid: false }
}
// Two lines below width 20, one from it: a 3-code-point text whose middle character is invisible.
const twoThenOne = (width: number): Recording => (width < 20 ? { lines: [line(0, 0, 8), line(2, 2, 8)], height: 40 } : { lines: [line(0, 2, 16)], height: 20 })
// `probes`: widths bisection recorded, per template.
function record(templates: ReadonlyArray<[Template, (width: number) => Recording]>, probes: number[] = []): void {
  mkdirSync(dirOf(SET), { recursive: true })
  for (let b = 0; b < CUT_BROWSERS.length; b++) {
    const recordings = new Map<string, Recording>()
    const probed: Record<string, number[]> = {}
    for (let i = 0; i < templates.length; i++) {
      for (const width of [1, 10, 20, 100_000, ...probes]) recordings.set(sweepId(SET, templates[i]![0], width), templates[i]![1](width))
      probed[templateKey(templates[i]![0])] = probes
    }
    writeRecordings(recordingsFile(SET, CUT_BROWSERS[b]!), { env: 'test', recordings })
    writeFileSync(probesFile(SET, CUT_BROWSERS[b]!), JSON.stringify(probed))
  }
}
afterAll(() => rmSync(dirOf(SET), { recursive: true, force: true }))

describe('the cut', () => {
  test('inputs that differ only in a pasted control of one category merge: each copy of main\'s control-character families would count as a behaviour of its own', () => {
    const zwsp = template('a\u{200B}b')
    const zwnj = template('a\u{200C}b')
    const control = template('a\u{1}b')
    record([[zwsp, twoThenOne], [zwnj, twoThenOne], [control, twoThenOne]])
    const report = select(SET, [zwsp, zwnj, control], false)
    expect(report.merged).toBe(1)
    const cases = cut(SET, [zwsp, zwnj, control])
    // U+0001 (Cc) doesn't merge with the Cf pair; each kept input is pinned at 1, 100000 and either side of its change.
    expect(cases.map(c => c.paragraph.width).sort((x, y) => x - y)).toEqual([1, 1, 10, 10, 20.015625, 20.015625, 100_000, 100_000])
    expect(cases.some(c => c.origin.includes('stands for the same input with U+200C'))).toBe(true)
  })

  test('inputs that lay out differently stay apart even with one category of control: a control one browser breaks at would lose its case', () => {
    const zwsp = template('a\u{200B}b')
    const wordJoiner = template('a\u{2060}b')
    record([[zwsp, twoThenOne], [wordJoiner, () => ({ lines: [line(0, 2, 16)], height: 20 })]])
    expect(select(SET, [zwsp, wordJoiner], false).merged).toBe(0)
  })

  test('only the two widths around each change are pinned: a sweep of whole pixels would pin one layout hundreds of times', () => {
    const t = template('a\u{200B}b')
    // Round 0 at 10 and 20, then bisection at 15 and 19.5: the lines change between 19.5 and 20, pinned at 19.5 and 1/64 px
    // past 20.
    record([[t, twoThenOne]], [15, 19.5])
    select(SET, [t], false)
    const widths = cut(SET, [t]).map(c => c.paragraph.width)
    expect(widths.sort((x, y) => x - y)).toEqual([1, 19.5, 20.015625, 100_000])
  })

  test('a paragraph keeps at most three of the widths where its lines change, the widest first, each showing a new kind of break: pinning every one would sweep one input across widths', () => {
    // Four breaks of four kinds (after a space, a hyphen, a slash and a colon) come undone one by one from 30 to 60.
    const mixed = template('a b-c/d:e', 'test/kinds')
    const starts = [[0, 2, 4, 6, 8], [0, 4, 6, 8], [0, 6, 8], [0, 8], [0]]
    const layout = (width: number): Recording => {
      const firsts = starts[width < 30 ? 0 : width < 40 ? 1 : width < 50 ? 2 : width < 60 ? 3 : 4]!
      return { lines: firsts.map((first, i) => line(first, (firsts[i + 1] ?? 10) - 2, 8)), height: 20 * firsts.length }
    }
    // Four breaks after spaces, all alike, the last where the text comes to fit on one line.
    const spaces = template('a b c d e', 'test/spaces')
    record([[mixed, layout], [spaces, layout]], [29, 30, 39, 40, 49, 50, 59, 60])
    select(SET, [mixed, spaces], false)
    const widths = (t: Template, edge: boolean): number[] => cut(SET, [t]).filter(c => (c.edge === true) === edge).map(c => c.paragraph.width).sort((x, y) => x - y)
    // The three widest changes, 1/64 px either side where the side's layout reaches (the recorded 39 stands in for
    // 39.984375, which falls between recordings), and a whole pixel inside each layout.
    expect(widths(mixed, true)).toEqual([39, 40.015625, 49, 50.015625, 59, 60.015625])
    expect(widths(mixed, false)).toEqual([1, 35, 45, 55, 100_000])
    // Only the widest of the changes that break alike.
    expect(widths(spaces, true)).toEqual([59, 60.015625])
    expect(widths(spaces, false)).toEqual([1, 55, 100_000])
  })

  test('the cover keeps one change per kind of line break: two inputs that break the same way would double the review for one behaviour', () => {
    const first = template('x yz', 'test/words')
    const second = template('x ab', 'test/words')
    const words = (width: number): Recording => (width < 20 ? { lines: [line(0, 0, 8), line(2, 3, 16)], height: 40 } : { lines: [line(0, 3, 28)], height: 20 })
    record([[first, words], [second, words]])
    const report = select(SET, [first, second], true)
    for (let b = 0; b < CUT_BROWSERS.length; b++) expect(report.selected[CUT_BROWSERS[b]!]).toBe(1)
    expect(new Set(cut(SET, [first, second]).map(c => c.behaviour)).size).toBe(1)
  })
})
