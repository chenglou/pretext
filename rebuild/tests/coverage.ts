// The coverage matrix (research/TEST-ARCHITECTURE.md §1): every registry rule against the evidence that covers it, under
// the charter's definition (TENTPOLES-CRITIC.md §2.D item 1, §4 item 10). A current rule is covered by
// - a bun test the registry lists as asserting it, present in the tree;
// - a fact that holds in the engine's current facts file, joined through the rule's probe labels;
// - an observed rule-targeted family: a family naming the rule, observed and scored in that engine's browser, with at least
//   one resolved bracket.
// Reach from generic or main-derived case families is measurement, never coverage, and this tool doesn't read it.
//
//   bun rebuild/tests/coverage.ts --facts=<facts file>[,...] --derived=<derivation dir>[,...] [--out=rebuild/tests/coverage.json]
//     [--previous=<coverage.json>]
//
// With --previous, a rule that had an observed family there and has none now is a loss (exit 1).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MetricName } from '../lab/score.ts'
import type { BrowserKind } from '../lab/types.ts'
import { engineOfBrowser, readNdjson, type FamilyStats, type FinalRecord } from './derive.ts'
import type { FactRecord } from './facts.ts'
import { FAMILIES } from './families/catalogue.ts'
import { familyEngines } from './families/types.ts'
import { loadRegistry, probeSpec, type RuleRecord } from './registry.ts'

const REBUILD = resolve(import.meta.dir, '..')
const METRICS: readonly MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']

export type FamilyEvidence = {
  family: string
  browser: BrowserKind
  build: string
  resolvedTargets: number
  targets: number
  cases: number
  // Passing cases per metric in the forward run, when it was scored.
  passes: Partial<Record<MetricName, number>>
  scored: number
}

export type RuleCoverage = {
  id: string
  engine: RuleRecord['engine']
  kind: RuleRecord['kind']
  declaredBy: string
  tests: { present: string[]; stale: string[] }
  facts: { specs: string[]; holds: number; fails: number; other: number; specsWithoutFacts: string[] }
  declaredFamilies: string[]
  observedFamilies: FamilyEvidence[]
  // Families naming the rule with resolved brackets in the engine's browser whose cases no scored prediction run has
  // reached yet, such as stage 5 families derived with FINAL_RUNS=native. They show where brackets exist; they don't cover.
  derivedFamilies: FamilyEvidence[]
  coveredBy: Array<'test' | 'fact' | 'family'>
  annotated: boolean
}

export type Coverage = {
  format: 'pretext-coverage/1'
  generatedAt: string
  inputs: { facts: string[]; derived: string[] }
  // derivedOnly: uncovered rules with a derived family (RuleCoverage.derivedFamilies).
  counts: Record<string, { current: number; covered: number; byTest: number; byFact: number; byFamily: number; uncovered: number; derivedOnly: number; withProbeButNoHoldingFact: number; deviations: number }>
  rulesWithObservedFamily: string[]
  uncovered: string[]
  // Rules with probe labels and no holding fact in the current facts files (TENTPOLES-CRITIC §2.D item 3).
  withProbeButNoHoldingFact: string[]
  // Current rules still classed as heuristics or choices by score.
  deviations: string[]
  // Registry rules without a `// rule <id>` annotation in rebuild/src, and annotations naming no registry rule.
  annotations: { annotated: number; missing: number; unknown: string[] }
  removed: Array<{ id: string; replacedBy: string[] }>
  rules: RuleCoverage[]
  lostFamilies: string[]
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

// 'path :: test name' is present when the file exists and holds the name; a bare path when the file exists. A name may be
// written as bun prints it, 'describe block > test name': then the file holds each part.
export function testPresent(entry: string): boolean {
  const separator = entry.indexOf(' :: ')
  const file = join(REBUILD, separator === -1 ? entry : entry.slice(0, separator))
  if (!existsSync(file)) return false
  if (separator === -1) return true
  const name = entry.slice(separator + 4)
  const text = readFileSync(file, 'utf8')
  return text.includes(name) || name.split(' > ').every(part => text.includes(part))
}

function familyEvidence(dir: string): FamilyEvidence[] {
  const finalDir = join(dir, 'final')
  const summary = JSON.parse(readFileSync(join(finalDir, 'summary.json'), 'utf8')) as { browser: BrowserKind; build: { engine: string }; families: Record<string, FamilyStats> }
  const records = readNdjson<FinalRecord>(join(finalDir, 'derivation.ndjson'))
  const perCase = join(finalDir, 'file', `${summary.browser}-per-case.ndjson`)
  const scores = new Map<string, Record<string, { status: string }>>()
  if (existsSync(perCase)) {
    for (const row of readNdjson<Record<string, unknown>>(perCase)) {
      if (typeof row['historyDependent'] === 'string') continue
      scores.set(row['id'] as string, row as Record<string, { status: string }>)
    }
  }
  const out: FamilyEvidence[] = []
  for (const [family, stats] of Object.entries(summary.families)) {
    const ids = new Set(records.filter(record => record.family === family).map(record => record.caseId))
    const passes: Partial<Record<MetricName, number>> = {}
    let scored = 0
    for (const id of ids) {
      const score = scores.get(id)
      if (score === undefined) continue
      scored++
      for (const metric of METRICS) if (score[metric]?.status === 'pass') passes[metric] = (passes[metric] ?? 0) + 1
    }
    out.push({ family, browser: summary.browser, build: summary.build.engine, resolvedTargets: stats.resolved, targets: stats.targets, cases: ids.size, passes, scored })
  }
  return out
}

export function buildCoverage(registry: readonly RuleRecord[], facts: readonly FactRecord[], evidence: readonly FamilyEvidence[], annotatedIds: ReadonlySet<string>, inputs: Coverage['inputs'], previous: Coverage | null): Coverage {
  const factsBySpec = new Map<string, FactRecord[]>()
  for (const fact of facts) {
    const list = factsBySpec.get(fact.spec) ?? []
    list.push(fact)
    factsBySpec.set(fact.spec, list)
  }
  const declared = new Map<string, string[]>()
  for (const family of FAMILIES) {
    for (const engine of familyEngines(family)) {
      for (const id of family.rules[engine]!) {
        const list = declared.get(id) ?? []
        if (!list.includes(family.name)) list.push(family.name)
        declared.set(id, list)
      }
    }
  }
  const rules: RuleCoverage[] = []
  const counts: Coverage['counts'] = {}
  const withProbeButNoHoldingFact: string[] = []
  const deviations: string[] = []
  for (const rule of registry) {
    if (rule.status !== 'current') continue
    const present: string[] = []
    const stale: string[] = []
    for (const entry of rule.tests) (testPresent(entry) ? present : stale).push(entry)
    const specs = [...new Set(rule.probes.map(probeSpec))]
    let holds = 0
    let fails = 0
    let other = 0
    const specsWithoutFacts: string[] = []
    for (const spec of specs) {
      const list = factsBySpec.get(spec)
      if (list === undefined) {
        specsWithoutFacts.push(spec)
        continue
      }
      for (const fact of list) {
        if (fact.supplementary) continue
        switch (fact.verdict) {
          case 'holds': holds++; break
          case 'fails': fails++; break
          case 'undecided':
          case 'precondition-failed':
          case 'errored': other++; break
        }
      }
    }
    const declaredFamilies = declared.get(rule.id) ?? []
    const observedFamilies = evidence.filter(value => declaredFamilies.includes(value.family) && engineOfBrowser(value.browser) === rule.engine && value.resolvedTargets > 0 && value.scored > 0)
    const derivedFamilies = evidence.filter(value => declaredFamilies.includes(value.family) && engineOfBrowser(value.browser) === rule.engine && value.resolvedTargets > 0 && value.scored === 0)
    const coveredBy: RuleCoverage['coveredBy'] = []
    if (present.length > 0) coveredBy.push('test')
    if (holds > 0) coveredBy.push('fact')
    if (observedFamilies.length > 0) coveredBy.push('family')
    if (specs.length > 0 && holds === 0) withProbeButNoHoldingFact.push(rule.id)
    if (rule.kind === 'heuristic' || rule.kind === 'choice by score') deviations.push(rule.id)
    rules.push({ id: rule.id, engine: rule.engine, kind: rule.kind, declaredBy: rule.declaredBy, tests: { present, stale }, facts: { specs, holds, fails, other, specsWithoutFacts }, declaredFamilies, observedFamilies, derivedFamilies, coveredBy, annotated: annotatedIds.has(rule.id) })
    const c = counts[rule.engine] ??= { current: 0, covered: 0, byTest: 0, byFact: 0, byFamily: 0, uncovered: 0, derivedOnly: 0, withProbeButNoHoldingFact: 0, deviations: 0 }
    c.current++
    if (coveredBy.length > 0) c.covered++
    else c.uncovered++
    if (coveredBy.length === 0 && derivedFamilies.length > 0) c.derivedOnly++
    if (coveredBy.includes('test')) c.byTest++
    if (coveredBy.includes('fact')) c.byFact++
    if (coveredBy.includes('family')) c.byFamily++
    if (specs.length > 0 && holds === 0) c.withProbeButNoHoldingFact++
    if (rule.kind === 'heuristic' || rule.kind === 'choice by score') c.deviations++
  }
  const rulesWithObservedFamily = rules.filter(rule => rule.observedFamilies.length > 0).map(rule => rule.id).sort()
  const known = new Set(registry.map(rule => rule.id))
  return {
    format: 'pretext-coverage/1', generatedAt: new Date().toISOString(), inputs, counts, rulesWithObservedFamily,
    uncovered: rules.filter(rule => rule.coveredBy.length === 0).map(rule => rule.id),
    withProbeButNoHoldingFact, deviations,
    annotations: { annotated: rules.filter(rule => rule.annotated).length, missing: rules.filter(rule => !rule.annotated).length, unknown: [...annotatedIds].filter(id => !known.has(id)).sort() },
    removed: registry.filter(rule => rule.status === 'removed').map(rule => ({ id: rule.id, replacedBy: rule.replacedBy })),
    rules,
    lostFamilies: previous === null ? [] : previous.rulesWithObservedFamily.filter(id => !rulesWithObservedFamily.includes(id)),
  }
}

if (import.meta.main) {
  const args = new Map(process.argv.slice(2).map(arg => {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1]!, match[2]!] as const
  }))
  const list = (name: string): string[] => (args.get(name) ?? '').split(',').filter(part => part !== '').map(part => resolve(part))
  const factPaths = list('facts')
  const derived = list('derived')
  const facts: FactRecord[] = factPaths.flatMap(path => readNdjson<FactRecord>(path))
  const evidence = derived.filter(dir => existsSync(join(dir, 'final', 'summary.json'))).flatMap(familyEvidence)
  const annotated = new Set<string>()
  for (const path of sourceFiles(join(REBUILD, 'src'))) {
    for (const match of readFileSync(path, 'utf8').matchAll(/\/\/\s*rule\s+([a-z0-9-]+\/[a-z0-9./-]+)/g)) annotated.add(match[1]!)
  }
  const previousPath = args.get('previous')
  const previous = previousPath === undefined ? null : JSON.parse(readFileSync(resolve(previousPath), 'utf8')) as Coverage
  const coverage = buildCoverage(loadRegistry().rules, facts, evidence, annotated, { facts: factPaths, derived }, previous)
  const out = resolve(args.get('out') ?? join(import.meta.dir, 'coverage.json'))
  writeFileSync(out, `${JSON.stringify(coverage, null, 1)}\n`)
  for (const [engine, c] of Object.entries(coverage.counts)) {
    console.log(`${engine}: ${c.current} current rules, covered ${c.covered} (tests ${c.byTest}, facts ${c.byFact}, families ${c.byFamily}), uncovered ${c.uncovered} (${c.derivedOnly} with derived families awaiting scored runs); ${c.withProbeButNoHoldingFact} with probes but no holding fact; ${c.deviations} heuristics or choices by score`)
  }
  console.log(`annotations: ${coverage.annotations.annotated} rules annotated in source, ${coverage.annotations.missing} not; ${out}`)
  if (coverage.lostFamilies.length > 0) {
    console.log(`lost their last observed family: ${coverage.lostFamilies.join(', ')}`)
    process.exit(1)
  }
}
