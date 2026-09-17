// Fact extraction and the release diff on hand-made probe outputs.
import { describe, expect, test } from 'bun:test'
import type { ProbeOutput } from '../probes/types.ts'
import { carryForward, diffFacts, extractFacts, mergeFacts, type FactRecord } from './facts.ts'

function output(results: Array<{ id: string; spec: string; value: unknown; errors?: string[] }>, dpr = 2): ProbeOutput {
  return {
    status: 'ok', errors: [], browser: 'chrome', runId: 'r', probesFile: 'p.ts', only: null, startedAt: '2026-09-16T00:00:00Z', finishedAt: '', durationMs: 0,
    totals: { selected: 0, documents: 0, results: 0, probesWithErrors: 0, observationErrors: 0, reloads: 0, resends: 0 },
    envs: [{ userAgent: 'Chrome/153.0.0.0', devicePixelRatio: dpr, visualViewportScale: 1, visibilityState: 'visible', hasFocus: false, documents: 1 }],
    results: results.map((entry, document) => ({
      id: entry.id, spec: entry.spec, document, probe: { id: entry.id, spec: entry.spec, pageLang: 'en', observe: [] },
      result: { id: entry.id, fontsStatusBefore: 'loaded', fontsStatusAfter: 'loaded', observations: [{ kind: 'script', value: entry.value }], errors: entry.errors ?? [], ms: 1 },
    })),
  }
}

const OUTPUT = output([
  { id: 'blink-lines H2', spec: 'blink-lines H2', value: { checks: [{ name: 'fits', ok: true, expected: 1, measured: 1, dpr: 2 }, { name: 'at DPR 1', ok: false, expected: 1, measured: 2, dpr: 1 }, { name: 'fits', ok: false, expected: 1, measured: 2, dpr: null }] } },
  { id: 'gecko-lines H1', spec: 'gecko-lines H1', value: { checks: [{ name: 'width 86.4px', ok: true, expected: 1, measured: 1 }], pre: [{ name: 'OC au', ok: false, expected: 5184, measured: 5183 }] } },
  { id: 'webkit-text H13', spec: 'webkit-text H13', value: { ok: null, lines: [0, 2] } },
  { id: 'broken', spec: 'x H1', value: null, errors: ['timeout'] },
])

describe('facts', () => {
  const facts = extractFacts(OUTPUT, 'run.json', 'blink', '153.0.8010.48', { probeSet: 'test' })

  test('checks at another DPR are outside the run and names repeat with a suffix', () => {
    expect(facts.filter(fact => fact.spec === 'blink-lines H2').map(fact => [fact.fact, fact.verdict])).toEqual([
      ['blink-lines H2 :: fits', 'holds'], ['blink-lines H2 :: fits#1', 'fails'],
    ])
  })

  test('a failed precondition makes the probe\'s checks precondition-failed', () => {
    expect(facts.filter(fact => fact.spec === 'gecko-lines H1').map(fact => [fact.fact, fact.verdict])).toEqual([
      ['gecko-lines H1 :: pre: OC au', 'fails'], ['gecko-lines H1 :: width 86.4px', 'precondition-failed'],
    ])
  })

  test('single-verdict probes and errored probes become facts too', () => {
    expect(facts.find(fact => fact.spec === 'webkit-text H13')!.verdict).toBe('undecided')
    expect(facts.find(fact => fact.spec === 'x H1')!.verdict).toBe('errored')
    expect(facts.every(fact => fact.env.buildSource === 'given' && fact.scope['dpr'] === 2 && fact.scope['probeSet'] === 'test')).toBe(true)
  })

  test('merge refuses one fact twice in one scope', () => {
    expect(() => mergeFacts([facts, facts])).toThrow()
  })

  test('the release diff separates flips, changed decisive values, missing and new facts, and carries holdsIn forward', () => {
    const next: FactRecord[] = facts.map(fact => ({ ...fact, env: { ...fact.env, build: '153.0.9999.1' }, holdsIn: fact.verdict === 'holds' ? ['153.0.9999.1'] : [] }))
    next[1] = { ...next[1]!, verdict: 'holds' }
    next[3] = { ...next[3]!, decisive: { expected: 5184, measured: 5184 } }
    next.pop()
    next.push({ ...next[0]!, fact: 'new :: check' })
    const diff = diffFacts(facts, next, null)
    expect(diff.flips.map(flip => flip.fact)).toEqual(['blink-lines H2 :: fits#1'])
    expect(diff.decisiveChanged.map(change => change.fact)).toEqual(['gecko-lines H1 :: width 86.4px'])
    expect(diff.missing.length).toBe(1)
    expect(diff.added.length).toBe(1)
    const carried = carryForward(facts, next)
    expect(carried[0]!.holdsIn).toEqual(['153.0.8010.48', '153.0.9999.1'])
  })
})
