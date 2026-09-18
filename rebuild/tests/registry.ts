// The rule registry: one id per library rule, with its kind, citation, probe labels and asserting tests
// (rebuild/tests/rules.json). It starts from the 2026-09-16 catalogue (research/RULES.md) with the stage-1 changes in
// rule-changes.json applied by import-rules.ts. Once rules carry `// rule <id>` annotations in source, the registry is
// regenerated from them; coverage.ts lists registry rules without an annotation and annotations without a registry row.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 'observer assumption': a named assumption of the lab's observer, not a library rule (DESIGN.md §9), such as grouping rects
// of different text nodes into lines by vertical centre.
export type RuleKind = 'ported rule' | 'recipe' | 'named gap' | 'fact' | 'choice by score' | 'heuristic' | 'observation rule' | 'observer assumption'
export type RuleEngine = 'blink' | 'webkit' | 'gecko' | 'shared'

export type RuleRecord = {
  id: string
  engine: RuleEngine
  area: string
  kind: RuleKind
  statement: string
  source: string
  // Probe labels, 'blink-lines H2: confirmed': the spec label before ':' joins fact records (facts.ts).
  probes: string[]
  // Bun tests whose expectations assert the rule: 'path under rebuild/ :: test name', or a whole file.
  tests: string[]
  audit: string | null
  status: 'current' | 'removed'
  replacedBy: string[]
  // 'catalogue 2026-09-16', an owner, or 'provisional' for ids an owner report gave only as a table row.
  declaredBy: string
}

// generated: per rule id, a hash of the rule as import-rules.ts last generated it, so the importer can tell a hand edit of
// this file from a change in rule-changes.json. Absent in registries from before 2026-09-17 20:00.
export type Registry = { format: 'pretext-rules/1'; note: string; rules: RuleRecord[]; generated?: Record<string, string> }

export const REGISTRY_PATH = resolve(import.meta.dir, 'rules.json')

export function loadRegistry(path: string = REGISTRY_PATH): Registry {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Registry
  if (value.format !== 'pretext-rules/1') throw new Error(`${path}: format ${JSON.stringify(value.format)}`)
  return value
}

export function probeSpec(label: string): string {
  const colon = label.indexOf(':')
  return (colon === -1 ? label : label.slice(0, colon)).trim()
}
