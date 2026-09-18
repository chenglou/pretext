// The layered gate (research/TEST-ARCHITECTURE.md §6), keyed on the environment score.ts names per row: the browser build
// the driver read from the app bundle, the OS build, DPR, scale and the scorer version.
//
// Layers:
// - rule families, blocking: the pairs (case id, metric) of the derived family cases that passed in both seeding runs,
//   forward and reverse (lab/gate.ts seed and check rules, --complete);
// - facts, blocking: the build's facts file against the one the baseline recorded; a verdict flip or a missing fact fails;
// - coverage, blocking: a rule that had an observed family at seeding and has none now fails, unless it was removed and
//   its replacements have one (coverage.ts lostObservedFamilies);
// - measurement corpus, report only: main-derived runs (suite/, obligations/) against a lab G0 baseline. Their losses are
//   listed and never fail the gate, until each obligation is triaged (CHARTER.md tentpole 5).
//
//   bun rebuild/tests/gate.ts seed --staging=<dir> --derived=<derivation dir> --baseline=<file> [--facts=<file>] [--coverage=<file>] [--note=<text>]
//   bun rebuild/tests/gate.ts check --derived=<derivation dir> --baseline=<file> [--facts=<file>] [--coverage=<file>]
//     [--corpus-baseline=<lab gate file> --corpus-runs=<per-case file or dir>[,...]] [--out=<report.json>]
//
// `seed` never writes the baseline it names, like lab/gate.ts --seed (lab README, "Seeds go to a staging folder"):
// `--baseline` is the adopted seed, which stays as it is; the new seed goes to `<staging>/<the baseline's file name>` with its
// record next to it (`<name>.seed-record.json`: the family pairs the new seed loses against the adopted one with their
// covering gaps, the pairs that leave through new history dependence or as protocol rows, the pairs gained). Whoever is
// allowed to adopts it by copying it over the baseline, after review.
//
// Exit 2 when the runs come from another environment than the baseline (a new browser build: derive the families again,
// seed a new baseline for the new key, and attribute the pairs the old key had), when the derived cases changed, or when a
// run wasn't scored against the other order. Exit 1 on a blocking loss.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { checkRuns, parseBaseline, readRun, runPaths, runProblems, seedBaseline, seedRecord, stagedPath, type Baseline, type GateReport } from '../lab/gate.ts'
import type { BrowserBuild, BrowserKind } from '../lab/types.ts'
import { lostObservedFamilies, type Coverage } from './coverage.ts'
import { engineOfBrowser, readNdjson, type FamilyStats } from './derive.ts'
import { diffFacts, type FactRecord, type FactsDiff } from './facts.ts'

export const TESTS_GATE_FORMAT = 'pretext-tests-gate/1'
const REPO = resolve(import.meta.dir, '../..')

export type TestsBaseline = {
  format: typeof TESTS_GATE_FORMAT
  browser: BrowserKind
  build: BrowserBuild
  note: string
  families: { casesFile: string; casesSha256: string; cases: number; totals: Record<string, number>; baseline: Baseline }
  facts: { file: string; sha256: string; facts: number } | null
  coverage: { rulesWithObservedFamily: string[] } | null
}

export type TestsReport = {
  ok: boolean
  environment: string[]
  families: GateReport
  facts: FactsDiff | null
  coverage: { lost: string[] } | null
  corpus: { lostPairs: number; newPairs: number; lostByFamily: Record<string, number> } | null
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

type Derived = { browser: BrowserKind; build: BrowserBuild; casesFile: string; totals: Record<string, number>; runs: string[] }

function readDerived(dir: string): Derived {
  const finalDir = join(dir, 'final')
  const summary = JSON.parse(readFileSync(join(finalDir, 'summary.json'), 'utf8')) as { browser: BrowserKind; build: BrowserBuild; totals: Record<string, number>; families: Record<string, FamilyStats> }
  const runs = ['file', 'reverse'].map(order => join(finalDir, order, `${summary.browser}-per-case.ndjson`))
  for (const run of runs) if (!existsSync(run)) throw new Error(`${run} is missing: run observe-families.sh to the end`)
  return { browser: summary.browser, build: summary.build, casesFile: join(finalDir, 'family-cases.ndjson'), totals: summary.totals, runs }
}

// Blocking layers on top of the family check: pure, so the rules are testable.
export function blockingLosses(families: GateReport, facts: FactsDiff | null, coverage: { lost: string[] } | null): string[] {
  const out: string[] = []
  if (!families.ok) out.push(`rule families: ${families.counts.lostPairs} lost pairs, ${families.counts.missingPairs} missing pairs`)
  if (facts !== null && (facts.flips.length > 0 || facts.missing.length > 0)) out.push(`facts: ${facts.flips.length} verdict flips, ${facts.missing.length} missing facts`)
  if (coverage !== null && coverage.lost.length > 0) out.push(`coverage: ${coverage.lost.length} rules lost their last observed family`)
  return out
}

function main(): number {
  const [command, ...rest] = process.argv.slice(2)
  const values = new Map<string, string>()
  const corpusRuns: string[] = []
  for (const arg of rest) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    if (match[1] === 'corpus-runs') corpusRuns.push(match[2]!)
    else values.set(match[1]!, match[2]!)
  }
  const need = (name: string): string => {
    const value = values.get(name)
    if (value === undefined) throw new Error(`--${name} is required`)
    return resolve(value)
  }
  const derived = readDerived(need('derived'))
  const engine = engineOfBrowser(derived.browser)
  const runs = derived.runs.map(readRun)
  const baselinePath = need('baseline')
  const factsPath = values.get('facts') === undefined ? null : need('facts')
  const coveragePath = values.get('coverage') === undefined ? null : need('coverage')
  const coverage = coveragePath === null ? null : JSON.parse(readFileSync(coveragePath, 'utf8')) as Coverage

  switch (command) {
    case 'seed': {
      const problems = runProblems(engine, runs, { allowUncompared: false, environments: null })
      if (problems.length > 0) {
        console.error(problems.join('\n'))
        return 2
      }
      const baseline: TestsBaseline = {
        format: TESTS_GATE_FORMAT, browser: derived.browser, build: derived.build, note: values.get('note') ?? '',
        families: {
          casesFile: relative(REPO, derived.casesFile), casesSha256: sha256File(derived.casesFile), cases: readNdjson<unknown>(derived.casesFile).length, totals: derived.totals,
          baseline: seedBaseline(runs, { engine, engineVersion: derived.build.engine, note: `rule families, ${derived.build.app} ${derived.build.appVersion}, macOS ${derived.build.os}` }),
        },
        facts: factsPath === null ? null : { file: relative(REPO, factsPath), sha256: sha256File(factsPath), facts: readNdjson<unknown>(factsPath).length },
        coverage: coverage === null ? null : { rulesWithObservedFamily: coverage.rulesWithObservedFamily.filter(id => id.startsWith(`${engine}/`) || id.startsWith(`lab/observe/${engine}/`)) },
      }
      // Staged, never written over the adopted baseline; the record says what the new seed loses against it.
      const staged = stagedPath(baselinePath, values.get('staging'))
      const adopted = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) as TestsBaseline : null
      if (adopted !== null && adopted.format !== TESTS_GATE_FORMAT) throw new Error(`${baselinePath}: format ${JSON.stringify(adopted.format)}`)
      const before = adopted === null ? null : parseBaseline(JSON.stringify(adopted.families.baseline), baselinePath)
      const record = seedRecord(before, baseline.families.baseline, runs, { staged: relative(REPO, staged), against: relative(REPO, baselinePath) })
      mkdirSync(dirname(staged), { recursive: true })
      writeFileSync(staged, `${JSON.stringify(baseline, null, 2)}\n`)
      const recordPath = `${staged.replace(/\.json$/, '')}.seed-record.json`
      writeFileSync(recordPath, `${JSON.stringify({ ...record, casesChanged: adopted !== null && adopted.families.casesSha256 !== baseline.families.casesSha256 }, null, 2)}\n`)
      const pairs = Object.values(baseline.families.baseline.counts.passPairs).reduce((sum, n) => sum + n, 0)
      if (before !== null) console.log(`against ${relative(REPO, baselinePath)}: ${record.lost.length} pairs lost (${record.lost.filter(value => !value.covered).length} without a covered explanation), ${record.leftThroughHistory.length} leave through new history dependence, ${record.leftThroughProtocol.length} leave as protocol rows, ${record.leftWithTheirCase?.length ?? 0} leave with a case the runs don't hold, ${record.gained.length} gained; record ${relative(REPO, recordPath)}`)
      console.log(`staged ${relative(REPO, staged)} (not adopted; ${relative(REPO, baselinePath)} is unchanged): ${baseline.families.baseline.counts.cases} family cases, ${pairs} pass pairs ${JSON.stringify(baseline.families.baseline.counts.passPairs)}, ${baseline.families.baseline.counts.historyDependentCases} history-dependent, ${baseline.families.baseline.counts.unstablePairs} unstable pairs; environments ${baseline.families.baseline.environments.join(' | ')}`)
      return 0
    }
    case 'check': {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as TestsBaseline
      if (baseline.format !== TESTS_GATE_FORMAT) throw new Error(`${baselinePath}: format ${JSON.stringify(baseline.format)}`)
      const familyBaseline = parseBaseline(JSON.stringify(baseline.families.baseline), baselinePath)
      const problems = runProblems(engine, runs, { allowUncompared: false, environments: familyBaseline.environments })
      if (sha256File(derived.casesFile) !== baseline.families.casesSha256) problems.push(`${relative(REPO, derived.casesFile)}: the derived family cases differ from the seeded ones; seed a new baseline for them and attribute the lost pairs`)
      if (problems.length > 0) {
        console.error(problems.join('\n'))
        return 2
      }
      const families = checkRuns(familyBaseline, runs, { complete: true })
      let facts: FactsDiff | null = null
      if (baseline.facts !== null && factsPath !== null && sha256File(factsPath) !== baseline.facts.sha256) {
        const before = join(REPO, baseline.facts.file)
        if (!existsSync(before)) throw new Error(`${baseline.facts.file}: the baseline's facts file is gone`)
        facts = diffFacts(readNdjson<FactRecord>(before), readNdjson<FactRecord>(factsPath), null)
      }
      const coverageLayer = baseline.coverage === null || coverage === null ? null : { lost: lostObservedFamilies(baseline.coverage.rulesWithObservedFamily, coverage) }
      let corpus: TestsReport['corpus'] = null
      if (values.get('corpus-baseline') !== undefined && corpusRuns.length > 0) {
        const corpusBaseline = parseBaseline(readFileSync(need('corpus-baseline'), 'utf8'), need('corpus-baseline'))
        const report = checkRuns(corpusBaseline, runPaths(corpusRuns).map(readRun), { complete: false })
        const lostByFamily: Record<string, number> = {}
        for (const lost of report.lost) {
          const group = lost.family.split('/')[0]!
          lostByFamily[group] = (lostByFamily[group] ?? 0) + 1
        }
        corpus = { lostPairs: report.counts.lostPairs, newPairs: report.counts.newPairs, lostByFamily }
      }
      const losses = blockingLosses(families, facts, coverageLayer)
      const report: TestsReport = { ok: losses.length === 0, environment: familyBaseline.environments, families, facts, coverage: coverageLayer, corpus }
      if (values.get('out') !== undefined) writeFileSync(need('out'), `${JSON.stringify(report, null, 2)}\n`)
      console.log(`tests gate ${derived.browser} (${baseline.build.app} ${baseline.build.appVersion}, engine ${baseline.build.engine}, macOS ${baseline.build.os})`)
      console.log(`  rule families: lost ${families.counts.lostPairs}, new ${families.counts.newPairs}, history-dependent ${families.counts.historyDependentCases}, unstable ${families.counts.unstablePairs}, missing ${families.counts.missingPairs}`)
      if (facts !== null) console.log(`  facts: flips ${facts.flips.length}, missing ${facts.missing.length}, decisive values changed ${facts.decisiveChanged.length}, new ${facts.added.length}`)
      if (coverageLayer !== null) console.log(`  coverage: ${coverageLayer.lost.length} rules lost their last observed family`)
      if (corpus !== null) console.log(`  measurement corpus (report only): lost ${corpus.lostPairs} ${JSON.stringify(corpus.lostByFamily)}, new ${corpus.newPairs}`)
      for (const loss of losses) console.log(`  FAIL ${loss}`)
      console.log(report.ok ? 'tests gate: pass' : 'tests gate: FAIL')
      return report.ok ? 0 : 1
    }
    default:
      throw new Error('Usage: bun rebuild/tests/gate.ts seed --staging=<dir> --derived=<dir> --baseline=<file> ... | check --derived=<dir> --baseline=<file> ...')
  }
}

if (import.meta.main) {
  try {
    process.exit(main())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
