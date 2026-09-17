// Which layers block (rebuild/tests/gate.ts).
import { describe, expect, test } from 'bun:test'
import type { GateReport } from '../lab/gate.ts'
import type { FactsDiff } from './facts.ts'
import { blockingLosses } from './gate.ts'

function families(ok: boolean, lostPairs = 0): GateReport {
  return {
    ok, engine: 'blink', engineVersion: '153.0.8010.48', runs: [],
    counts: { baselineCases: 1, observedCases: 1, lostPairs, newPairs: 0, historyDependentCases: 0, unstablePairs: 0, missingCases: 0, missingPairs: 0 },
    lost: [], newPasses: [], historyDependent: [], unstable: [], missing: { cases: 0, pairs: 0, ids: [] },
  }
}

const NO_CHANGE: FactsDiff = { compared: 3, unchanged: 3, decisiveChanged: [], flips: [], missing: [], added: [] }

describe('tests gate layers', () => {
  test('nothing lost, nothing blocks', () => {
    expect(blockingLosses(families(true), NO_CHANGE, { lost: [] })).toEqual([])
  })

  test('lost family pairs, fact flips, missing facts and lost coverage each block', () => {
    expect(blockingLosses(families(false, 2), null, null).length).toBe(1)
    expect(blockingLosses(families(true), { ...NO_CHANGE, flips: [{ fact: 'f', scope: '', before: 'holds', after: 'fails', decisiveBefore: 1, decisiveAfter: 2 }] }, null).length).toBe(1)
    expect(blockingLosses(families(true), { ...NO_CHANGE, missing: ['f []'] }, null).length).toBe(1)
    expect(blockingLosses(families(true), null, { lost: ['blink/lines/fit-bound-plus-one-lu'] }).length).toBe(1)
  })

  test('changed decisive values and new facts are reported, not blocking', () => {
    const diff: FactsDiff = { ...NO_CHANGE, decisiveChanged: [{ fact: 'f', scope: '', verdict: 'holds', before: 1, after: 2 }], added: ['g []'] }
    expect(blockingLosses(families(true), diff, null)).toEqual([])
  })
})
