// The ledger's token rules and its loss rule (citations.ts), on hand-made text.
import { describe, expect, test } from 'bun:test'
import { blockTokens, compare, countsOf, type Ledger, type Occurrence } from './citations.ts'

function tokens(text: string): string[] {
  const out: string[] = []
  blockTokens(text, (kind, token) => { out.push(`${kind} ${token}`) })
  return out
}

describe('tokens of a comment block or a string', () => {
  test('lines alone continue the file before them, across text and with or without the colon', () => {
    expect(tokens('ShouldApplyTextIndent, line_breaker.cc:45-56, :846-857, :878-879; its margin box width, :321-333').filter(t => t.startsWith('source'))).toEqual([
      'source line_breaker.cc:45-56', 'source line_breaker.cc:846-857', 'source line_breaker.cc:878-879', 'source line_breaker.cc:321-333'])
    expect(tokens('(hb-ot-shape.cc:60-66, 100-101; probe blink-followups F1)')).toEqual([
      'source hb-ot-shape.cc:60-66', 'source hb-ot-shape.cc:100-101', 'probe blink-followups F1', 'id F1'])
    expect(tokens('a ratio of 3 :4 names no file')).toEqual([])
  })
  test('a section takes the name before it, and a section right after another takes the same one', () => {
    expect(tokens('DESIGN.md §1 and §2 explain; later, §9 stands alone')).toEqual(['doc DESIGN.md', 'section DESIGN.md §1', 'section DESIGN.md §2', 'section §9'])
    expect(tokens('(blink-gaps §3.4-§3.5, CSS Text 3 §5.1)')).toEqual(['section blink-gaps §3.4', 'section blink-gaps §3.5', 'section CSS Text 3 §5.1', 'standard CSS Text 3'])
  })
  test('files without lines, qualified names, paths, cases and standards', () => {
    expect(tokens('LineInfo::ComputeWidth (line_info.cc), probe .artifacts/probes/gecko/round3-f16 on c-0123456789abcdef, UAX #14 LB30')).toEqual([
      'file line_info.cc', 'symbol LineInfo::ComputeWidth', 'path .artifacts/probes/gecko/round3-f16', 'id LB30', 'case c-0123456789abcdef', 'standard UAX #14'])
  })
})

describe('the loss rule', () => {
  const at = (kind: Occurrence['kind'], token: string, scope: Occurrence['scope'], where: Occurrence['where'] = 'code'): Occurrence => ({ kind, token, scope, where, file: 'x.ts', line: 1 })
  const ledger = (occurrences: Occurrence[]): Ledger => ({ format: 'pretext-citations/1', commit: 'line', gapNames: [], limitNames: [], entries: [...countsOf(occurrences).values()], stalePointers: ['a -> t'] })
  const line = ledger([at('source', 'a.cc:1', 'shared'), at('source', 'a.cc:1', 'blink'), at('prose', 'a gap', 'gecko')])

  test('a move between scopes passes and is listed; a deletion and a rewording fail', () => {
    const moved = compare(line, [], countsOf([at('source', 'a.cc:1', 'blink'), at('source', 'a.cc:1', 'blink'), at('prose', 'a gap', 'gecko')]), ['a -> t'])
    expect(moved.losses).toEqual([])
    expect(moved.moved).toEqual([{ kind: 'source', token: 'a.cc:1', where: 'code', before: { shared: 1, blink: 1 }, after: { blink: 2 } }])
    const lost = compare(line, [], countsOf([at('source', 'a.cc:1', 'blink'), at('prose', 'the gap', 'gecko')]), ['a -> t'])
    expect(lost.losses.map(loss => `${loss.kind} ${loss.token} ${loss.before}->${loss.after}`)).toEqual(['source a.cc:1 2->1', 'prose a gap 1->0'])
  })
  test('a test that names a citation doesn\'t make up for the code that lost it', () => {
    expect(compare(line, [], countsOf([at('source', 'a.cc:1', 'shared'), at('source', 'a.cc:1', 'blink', 'tests'), at('prose', 'a gap', 'gecko')]), []).losses.length).toBe(1)
  })
  test('a loss accepted by name passes, an acceptance nothing needs is named, and a new stale pointer shows', () => {
    const accepted = [{ kind: 'prose' as const, token: 'a gap', where: 'code' as const, count: 1, reason: 'reworded on purpose' }]
    const now = countsOf([at('source', 'a.cc:1', 'shared'), at('source', 'a.cc:1', 'blink')])
    expect(compare(line, accepted, now, ['a -> t', 'b -> u'])).toMatchObject({ losses: [], acceptedLosses: 1, unusedAcceptances: [], newStalePointers: ['b -> u'] })
    expect(compare(line, accepted, countsOf([at('source', 'a.cc:1', 'shared'), at('source', 'a.cc:1', 'blink'), at('prose', 'a gap', 'gecko')]), []).unusedAcceptances).toEqual(accepted)
  })
})
