// The family catalogue against the registry and the lab's case rules.
import { describe, expect, test } from 'bun:test'
import { makeCase } from '../../lab/cases/case.ts'
import { loadRegistry } from '../registry.ts'
import { FAMILIES } from './catalogue.ts'
import { expandFamily, familyEngines } from './types.ts'

const SEED = 'rule-families-test'

describe('rule families', () => {
  const registry = loadRegistry()
  const current = new Map(registry.rules.filter(rule => rule.status === 'current').map(rule => [rule.id, rule]))

  test('names are unique', () => {
    expect(new Set(FAMILIES.map(family => family.name)).size).toBe(FAMILIES.length)
  })

  test('every targeted rule is a current registry rule of that engine', () => {
    const problems: string[] = []
    for (const family of FAMILIES) {
      for (const engine of familyEngines(family)) {
        for (const id of family.rules[engine]!) {
          const rule = current.get(id)
          if (rule === undefined) problems.push(`${family.name}: ${id} is not a current rule`)
          else if (rule.engine !== engine) problems.push(`${family.name}: ${id} belongs to ${rule.engine}, listed under ${engine}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  test('every paragraph makes a valid case and its focus offsets sit inside the text', () => {
    for (const family of FAMILIES) {
      for (const engine of familyEngines(family)) {
        const paragraphs = expandFamily(family, engine, SEED)
        expect(paragraphs.length).toBeGreaterThan(0)
        for (const p of paragraphs) {
          const value = makeCase({ family: `rule/${family.name}`, origin: 'test', pageLang: p.draft.pageLang, paragraph: { ...p.draft.paragraph, width: 100 }, inline: p.draft.inline, fontFixtures: p.draft.fontFixtures })
          const length = value.paragraph.runs.reduce((sum, run) => sum + run.text.length, 0)
          expect(p.draft.focus.length).toBeGreaterThan(0)
          for (const offset of p.draft.focus) {
            expect(offset).toBeGreaterThan(0)
            expect(offset).toBeLessThan(length)
          }
        }
      }
    }
  })

  test('expansion is deterministic', () => {
    for (const family of FAMILIES) {
      const engine = familyEngines(family)[0]!
      expect(expandFamily(family, engine, SEED).map(p => p.key)).toEqual(expandFamily(family, engine, SEED).map(p => p.key))
    }
  })
})
