// What counts as coverage (rebuild/tests/coverage.ts) on a hand-made registry.
import { describe, expect, test } from 'bun:test'
import { buildCoverage, type Coverage, type FamilyEvidence } from './coverage.ts'
import type { FactRecord } from './facts.ts'
import type { RuleRecord } from './registry.ts'

function rule(id: string, overrides: Partial<RuleRecord> = {}): RuleRecord {
  return { id, engine: 'blink', area: 'lines', kind: 'ported rule', statement: '', source: '', probes: [], tests: [], audit: null, status: 'current', replacedBy: [], declaredBy: 'test', ...overrides }
}

function fact(spec: string, verdict: FactRecord['verdict']): FactRecord {
  return {
    format: 'pretext-fact/1', fact: `${spec} :: check`, spec, scope: { browser: 'chrome', dpr: 2 }, verdict, decisive: null, supplementary: false, probeSha256: '',
    env: { engine: 'blink', build: '153.0.8010.48', buildSource: 'given', os: null, userAgent: '' }, observedAt: '', run: '', holdsIn: [],
  }
}

const EVIDENCE: FamilyEvidence[] = [
  { family: 'fit-bound', browser: 'chrome', build: '153.0.8010.48', resolvedTargets: 3, targets: 4, cases: 10, passes: { lineCount: 9 }, scored: 10 },
  { family: 'hankerning', browser: 'chrome', build: '153.0.8010.48', resolvedTargets: 0, targets: 2, cases: 3, passes: {}, scored: 3 },
]

describe('coverage', () => {
  const registry = [
    rule('blink/lines/fit-bound-plus-one-lu', { probes: ['blink-lines H2: confirmed'] }),
    rule('blink/hankerning/line-end-halt-apply-end'),
    rule('blink/tabs/tab-size-zero', { probes: ['blink-lines H99: not run'], tests: ['src/engines/blink/no-such.test.ts :: gone'] }),
    rule('blink/shape/wide-group-halved', { kind: 'heuristic', tests: ['src/engines/blink/lines.test.ts'] }),
    rule('blink/lines/reshaped-part-measured-alone-when-cut', { status: 'removed', replacedBy: ['blink/lines/reshape-slice'] }),
  ]
  const previous = { rulesWithObservedFamily: ['blink/lines/fit-bound-plus-one-lu', 'blink/tabs/tab-stops'] } as Coverage
  const coverage = buildCoverage(registry, [fact('blink-lines H2', 'holds')], EVIDENCE, new Set(['blink/lines/fit-bound-plus-one-lu', 'blink/unknown/rule']), { facts: [], derived: [] }, previous)
  const byId = new Map(coverage.rules.map(value => [value.id, value]))

  test('a holding fact and an observed family with a resolved bracket both cover', () => {
    expect(byId.get('blink/lines/fit-bound-plus-one-lu')!.coveredBy).toEqual(['fact', 'family'])
  })

  test('a family without a resolved bracket does not cover, and stale tests and unrun probes do not either', () => {
    expect(byId.get('blink/hankerning/line-end-halt-apply-end')!.coveredBy).toEqual([])
    expect(byId.get('blink/tabs/tab-size-zero')!.coveredBy).toEqual([])
    expect(byId.get('blink/tabs/tab-size-zero')!.tests.stale).toEqual(['src/engines/blink/no-such.test.ts :: gone'])
    expect(coverage.withProbeButNoHoldingFact).toEqual(['blink/tabs/tab-size-zero'])
  })

  test('a present asserting test covers; heuristics are listed as deviations; removed rules stay out of the counts', () => {
    expect(byId.get('blink/shape/wide-group-halved')!.coveredBy).toEqual(['test'])
    expect(coverage.deviations).toEqual(['blink/shape/wide-group-halved'])
    expect(coverage.counts['blink']!.current).toBe(4)
    expect(coverage.removed).toEqual([{ id: 'blink/lines/reshaped-part-measured-alone-when-cut', replacedBy: ['blink/lines/reshape-slice'] }])
  })

  test('annotations and lost families are reported', () => {
    expect(coverage.annotations).toEqual({ annotated: 1, missing: 3, unknown: ['blink/unknown/rule'] })
    expect(coverage.lostFamilies).toEqual(['blink/tabs/tab-stops'])
  })
})
