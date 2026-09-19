// What gates.ts makes of each gate's exit code and report. These run no gate.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { citationsVerdict, functionSetVerdict, painterVerdict, tier1Verdict, tscVerdict, twinVerdict, unitTestsVerdict, worse } from './gates.ts'

const tier1 = (counts: Partial<{ predictionChanged: number; repeatsOnly: number; droppedOnly: number; otherQuestions: number; newQuestion: number }>, storage?: { cases: number }) => ({
  counts: { cases: 100, predictionChanged: 0, repeatsOnly: 0, droppedOnly: 0, otherQuestions: 0, newQuestion: 0, unfaithful: 0, ...counts }, needsBrowser: [], ...(storage === undefined ? {} : { storage }),
})

describe('tier 1\'s exit codes', () => {
  test('0 is fine, 1 and 4 never are for a pure refactoring', () => {
    expect(tier1Verdict(0, tier1({})).as).toBe(0)
    expect(tier1Verdict(1, tier1({ predictionChanged: 2 })).as).toBe(1)
    expect(tier1Verdict(4, tier1({ otherQuestions: 1 })).as).toBe(4)
    expect(tier1Verdict(4, tier1({ newQuestion: 1 })).as).toBe(4)
  })

  test('3 is fine with repeats only or the string storage rule alone, and not with a dropped question', () => {
    expect(tier1Verdict(3, tier1({ repeatsOnly: 5 })).as).toBe(0)
    expect(tier1Verdict(3, tier1({}, { cases: 40 }))).toMatchObject({ as: 0, meaning: expect.stringContaining('40 storage-sensitive cases') })
    expect(tier1Verdict(3, tier1({ repeatsOnly: 5, droppedOnly: 1 }))).toMatchObject({ as: 3, meaning: expect.stringContaining('names what it drops') })
  })

  test('a failed tool, or a report this run didn\'t write, is never fine', () => {
    expect(tier1Verdict(2, null).as).toBe(2)
    expect(tier1Verdict(0, null).as).toBe(2)
    expect(tier1Verdict(7, tier1({})).as).toBe(2)
  })
})

describe('the other gates', () => {
  const functionSet = { counts: { cases: 10, passed: 10, problems: 0, skipped: 0 }, otherOrder: 3 }
  test('the function set: 5 means nothing was checked', () => {
    expect(functionSetVerdict('plain', 0, functionSet, '')).toMatchObject({ as: 0, counts: expect.stringContaining('3 first ask in another order') })
    expect(functionSetVerdict('pure', 1, { ...functionSet, counts: { cases: 10, passed: 9, problems: 1, skipped: 0 } }, '').as).toBe(1)
    expect(functionSetVerdict('sweep', 5, null, 'skipped').as).toBe(5)
    expect(functionSetVerdict('sweep', 2, null, 'it threw').as).toBe(2)
  })

  test('the painter differential: 3 waits for tier 1', () => {
    const counts = { cases: 10, painted: 10, same: 10, paintingDiffers: 0, predictionChanged: 0, newQuestion: 0, frozenDiffers: 0 }
    expect(painterVerdict(0, { counts }, '').as).toBe(0)
    expect(painterVerdict(1, { counts: { ...counts, paintingDiffers: 1 } }, '').as).toBe(1)
    expect(painterVerdict(3, { counts: { ...counts, predictionChanged: 1 } }, '').as).toBe(3)
  })

  test('citations, and the twin scan, whose exit is 0 whatever it finds', () => {
    expect(citationsVerdict(0, { losses: [], acceptedLosses: 2, moved: [], newStalePointers: [] }, '').as).toBe(0)
    expect(citationsVerdict(1, { losses: [{}], acceptedLosses: 2, moved: [], newStalePointers: [] }, '').as).toBe(1)
    expect(twinVerdict(0, { cases: 380, withTwoByteSlice: 281, withTwin: 0 }, '').as).toBe(0)
    expect(twinVerdict(0, { cases: 380, withTwoByteSlice: 281, withTwin: 166 }, '')).toMatchObject({ as: 1, meaning: expect.stringContaining('tripwire') })
    expect(twinVerdict(1, null, 'the anchor is gone').as).toBe(2)
  })

  test('tier 0', () => {
    expect(tscVerdict(0, '').as).toBe(0)
    expect(tscVerdict(2, 'rebuild/src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n')).toMatchObject({ as: 1, counts: '1 errors' })
    expect(tscVerdict(1, 'error: could not find tsc').as).toBe(2)
    // One summary a test file.
    expect(unitTestsVerdict(0, 2, ' 800 pass\n 0 fail\n 11 pass\n 0 fail\n')).toMatchObject({ as: 0, counts: '2 files: 811 pass, 0 fail' })
    expect(unitTestsVerdict(1, 2, ' 800 pass\n 0 fail\n 10 pass\n 1 fail\n')).toMatchObject({ as: 1, counts: '2 files: 810 pass, 1 fail' })
    expect(unitTestsVerdict(1, 2, ' 800 pass\n 0 fail\nerror: Cannot find module').as).toBe(2)
  })

  test('the worst result: 1, 2, 5, 4, 3, then 0', () => {
    expect([0, 3, 4, 5, 2, 1].reduce(worse, 0)).toBe(1)
    expect([0, 3, 4, 5, 2].reduce(worse, 0)).toBe(2)
    expect([3, 0, 4].reduce(worse, 0)).toBe(4)
    expect([0, 3, 0].reduce(worse, 0)).toBe(3)
  })
})

test('gates.ts refuses an unknown engine or argument before it runs anything', () => {
  const run = (args: string[]): { exitCode: number; stderr: string } => {
    const result = Bun.spawnSync(['bun', join(import.meta.dir, 'gates.ts'), ...args])
    return { exitCode: result.exitCode, stderr: result.stderr.toString() }
  }
  expect(run(['--engine=presto'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('--engine must be blink, webkit, gecko or all') })
  expect(run(['--fast'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('Unknown argument --fast') })
})
