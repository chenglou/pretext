// What counts as coverage (rebuild/tests/coverage.ts) on a hand-made registry.
import { describe, expect, test } from 'bun:test'
import { buildCoverage, lostObservedFamilies, testPresent, type Coverage, type FamilyEvidence } from './coverage.ts'
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
  { family: 'box-edges', browser: 'chrome', build: '153.0.8010.48', resolvedTargets: 5, targets: 6, cases: 12, passes: {}, scored: 0 },
]

describe('coverage', () => {
  const registry = [
    rule('blink/lines/fit-bound-plus-one-lu', { probes: ['blink-lines H2: confirmed'] }),
    rule('blink/hankerning/line-end-halt-apply-end'),
    rule('blink/tabs/tab-size-zero', { probes: ['blink-lines H99: not run'], tests: ['src/engines/blink/no-such.test.ts :: gone'] }),
    rule('blink/shape/wide-group-halved', { kind: 'heuristic', tests: ['src/engines/blink/lines.test.ts'] }),
    rule('blink/lines/reshaped-part-measured-alone-when-cut', { status: 'removed', replacedBy: ['blink/lines/reshape-slice'] }),
    rule('blink/lines/open-tag-edge-size'),
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
    expect(coverage.counts['blink']!.current).toBe(5)
    expect(coverage.removed).toEqual([{ id: 'blink/lines/reshaped-part-measured-alone-when-cut', replacedBy: ['blink/lines/reshape-slice'] }])
  })

  test('annotations and lost families are reported', () => {
    expect(coverage.annotations).toEqual({ annotated: 1, missing: 4, unknown: ['blink/unknown/rule'] })
    expect(coverage.lostFamilies).toEqual(['blink/tabs/tab-stops'])
  })

  test('a removed rule whose replacements are observed doesn\'t lose its family; one without an observed replacement does', () => {
    const now = { rulesWithObservedFamily: ['webkit/measure/word-spacing-in-context', 'blink/lines/kept'], removed: [
      { id: 'webkit/measure/word-spacing-in-js', replacedBy: ['webkit/measure/word-spacing-in-context'] },
      { id: 'webkit/measure/half-replaced', replacedBy: ['webkit/measure/word-spacing-in-context', 'webkit/measure/unobserved'] },
      { id: 'webkit/measure/dropped', replacedBy: [] },
    ] }
    expect(lostObservedFamilies(['webkit/measure/word-spacing-in-js', 'blink/lines/kept'], now)).toEqual([])
    expect(lostObservedFamilies(['webkit/measure/half-replaced', 'webkit/measure/dropped', 'blink/lines/gone'], now)).toEqual(['webkit/measure/half-replaced', 'webkit/measure/dropped', 'blink/lines/gone'])
  })

  test('a derived family without scored runs is listed and does not cover', () => {
    const open = byId.get('blink/lines/open-tag-edge-size')!
    expect(open.coveredBy).toEqual([])
    expect(open.derivedFamilies.map(value => value.family)).toEqual(['box-edges'])
    expect(coverage.counts['blink']!.derivedOnly).toBe(1)
  })

  test('a listed test is found by its name, alone or under its describe block as bun prints it', () => {
    expect(testPresent('tests/coverage.test.ts')).toBe(true)
    expect(testPresent('tests/coverage.test.ts :: a listed test is found by its name')).toBe(true)
    expect(testPresent('tests/coverage.test.ts :: coverage > a listed test is found by its name')).toBe(true)
    expect(testPresent(`tests/coverage.test.ts :: coverage > no test ${'has this name'}`)).toBe(false)
    expect(testPresent('tests/no-such.test.ts :: coverage')).toBe(false)
  })
})
