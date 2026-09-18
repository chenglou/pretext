// The registry importer keeps what was edited by hand in rules.json (import-rules.ts header).
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { adoptHandEdits, formatChanges, generate, type CatalogueRule, type Changes } from './import-rules.ts'
import type { Registry, RuleRecord } from './registry.ts'

const CATALOGUE: CatalogueRule[] = [
  { id: 'blink/a', engine: 'blink', area: 'lines', kind: 'ported rule', statement: 'a', source: 'a.cc:1', probes: [], tests: [], audit: null },
  { id: 'blink/b', engine: 'blink', area: 'lines', kind: 'heuristic', statement: 'b', source: 'b.cc:1', probes: [], tests: [], audit: null },
]

function changes(): Changes {
  return { note: 'test', removed: [], reclassified: [], added: [{ id: 'blink/c', engine: 'blink', area: 'shape', kind: 'ported rule', statement: 'c', source: 'c.cc:1', probes: [], tests: [], declaredBy: 'owner' }] }
}

// A registry as the importer writes it: the rules and the hash of each.
function registry(rules: RuleRecord[]): Registry {
  const FIELDS = ['id', 'engine', 'area', 'kind', 'statement', 'source', 'probes', 'tests', 'audit', 'status', 'replacedBy', 'declaredBy'] as const
  const generated = Object.fromEntries(rules.map(rule => [rule.id, createHash('sha256').update(JSON.stringify(FIELDS.map(name => rule[name]))).digest('hex').slice(0, 16)]))
  return { format: 'pretext-rules/1', note: '', rules: rules.map(rule => ({ ...rule })), generated }
}

describe('import-rules', () => {
  test('a reclassified entry changes an added rule, the case that threw in ceiling round 2', () => {
    const value = changes()
    value.reclassified.push({ id: 'blink/c', kind: 'heuristic', source: 'chosen by counts' })
    const rule = generate(CATALOGUE, value).find(entry => entry.id === 'blink/c')!
    expect([rule.kind, rule.source, rule.statement, rule.declaredBy]).toEqual(['heuristic', 'chosen by counts', 'c', 'owner'])
  })

  test('an unedited registry takes whatever the changes say now', () => {
    const before = registry(generate(CATALOGUE, changes()))
    const value = changes()
    value.reclassified.push({ id: 'blink/a', statement: 'a, read again' })
    expect(adoptHandEdits(before, CATALOGUE, value)).toEqual({ adopted: [], conflicts: [] })
    expect(value.reclassified).toHaveLength(1)
  })

  test('a hand edit and a rule added by hand move into the changes, and the next generation keeps them', () => {
    const file = registry(generate(CATALOGUE, changes()))
    const edited = file.rules.find(rule => rule.id === 'blink/b')!
    edited.kind = 'ported rule'
    edited.tests = ['src/x.test.ts :: b']
    file.rules.push({ id: 'blink/d', engine: 'blink', area: 'lines', kind: 'named gap', statement: 'd', source: 'd.cc:1', probes: [], tests: [], audit: null, status: 'current', replacedBy: [], declaredBy: 'owner, by hand' })
    const value = changes()
    const result = adoptHandEdits(file, CATALOGUE, value)
    expect(result.conflicts).toEqual([])
    expect(result.adopted).toHaveLength(2)
    expect(value.reclassified).toEqual([{ id: 'blink/b', kind: 'ported rule', tests: ['src/x.test.ts :: b'] }])
    const next = generate(CATALOGUE, value)
    expect(next.find(rule => rule.id === 'blink/b')).toEqual(edited)
    expect(next.find(rule => rule.id === 'blink/d')!.declaredBy).toBe('owner, by hand')
  })

  test('a rule edited by hand and changed in the changes file stops the import', () => {
    const file = registry(generate(CATALOGUE, changes()))
    file.rules.find(rule => rule.id === 'blink/a')!.statement = 'a, by hand'
    const value = changes()
    value.reclassified.push({ id: 'blink/a', statement: 'a, in the changes' })
    expect(adoptHandEdits(file, CATALOGUE, value).conflicts).toHaveLength(1)
  })

  test('a rule deleted by hand stops the import', () => {
    const file = registry(generate(CATALOGUE, changes()))
    file.rules = file.rules.filter(rule => rule.id !== 'blink/b')
    expect(adoptHandEdits(file, CATALOGUE, changes()).conflicts).toEqual(['blink/b: deleted from rules.json by hand; retire it with a removed entry instead'])
  })

  test('the changes file keeps its layout through a rewrite', () => {
    const text = formatChanges(changes())
    expect(formatChanges(JSON.parse(text) as Changes)).toBe(text)
    // One line per entry: the braces, the note, two empty lists, and the added list's bracket, entry and bracket.
    expect(text.trimEnd().split('\n')).toHaveLength(8)
  })
})
