// Triage records for the cases where main passes and the rebuild fails (research/TEST-ARCHITECTURE.md §7.1,
// research/MAIN-TRIAGE.md §2): one record per case, from rows scored by the scorer's own rules. Offline; no browser.
//
//   bun rebuild/lab/triage.ts --rows=<rebuild rows, file order>[,...] --reverse-rows=<rebuild rows, reverse>[,...]
//     --main-rows=<main rows, file order>[,...] [--main-reverse-rows=<main rows, reverse>[,...]]
//     [--decisions=<decisions.ndjson>] --out=<records.ndjson> [--summary=<summary.json>]
//
// Rows: lab rows of one browser. The rebuild's rows carry native observations and engine layouts. Main's rows come from
// run.ts --predictor=baselines/main-predictor.ts, with their own native observation or from --predict-only; a predict-only
// row takes the native observation of the rebuild's file-order row for its case (score.ts withNativeRow).
//
// Population: main's line count passes, and the rebuild fails lineCount, or fails breaks while main's visible breaks don't
// fail. Main returns line ranges only, so its breaks are a diagnostic (score.ts lineRangeDiagnostics), not a metric, and
// its widths aren't compared: class D of §7.1 can't arise under scorer 3.
//
// Class, from observations only (§7.1 step 2):
// - A: main's line count passes, and its visible breaks fail: right count, wrong places;
// - B: main's line count passes, and no code point shows where lines start (visible breaks unobserved);
// - C: main's line count and visible breaks pass, and the rebuild fails lineCount or breaks.
//
// Outcome, by the first rule that applies (MAIN-TRIAGE.md §2.4; a decision record overrides it):
// 1. isolation 'moved': the reverse run derives other native lines, or main's own session did. The case belongs to
//    page-history protocols (§6.5), not triage: undecided;
// 2. class A: accidental, right count, wrong breaks;
// 3. main's prediction changes in reverse order and fails there: accidental, main's own page history;
// 4. main's zero-width placement fails: accidental, provisional, since no observation port covers main;
// 5. class B: undecided;
// 6. class C: a fact to learn. `fact`, `probe` and `family` stay null until a probe and a rule family exist.
// Opinions dropped (requiredness, API contracts, observer protocols) need a decision record.
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import type { GapName } from '../src/model.ts'
import { environmentKey, nativeDifference, nativeView, readLines, scoreRow, withNativeRow, type Metric, type Status } from './score.ts'
import type { BrowserKind, LabRow, LinesPrediction } from './types.ts'

export const TRIAGE_FORMAT = 'pretext-lab-triage/1'

export type TriageClass = 'A' | 'B' | 'C'
export type Outcome = 'fact-to-learn' | 'accidental' | 'opinion-dropped' | 'undecided'
export type TriageRecord = {
  format: typeof TRIAGE_FORMAT
  // Main's suite case ids the lab case came from (its origin), and the first of them.
  mainCase: string | null
  mainCases: string[]
  labCase: string
  browser: BrowserKind
  labFamily: string
  class: TriageClass
  // 'same': both orders (and main's own session, when it observed natively) derive the same native lines; 'moved': they
  // don't; 'unchecked': no reverse row.
  isolation: 'same' | 'moved' | 'unchecked'
  outcome: Outcome
  // An observation-only outcome that rests on a diagnostic without an observation port (rule 4).
  provisional: boolean
  // For a fact to learn: the fact id, the probe that settles it and the rule family it enters. null until decided.
  fact: string | null
  probe: string | null
  family: string | null
  reason: string
  decidedBy: 'rule' | 'hand'
  rebuild: { lineCount: Status; breaks: Status }
  main: { lineCount: Status; visibleBreaks: Status; zeroWidthPlacement: Status; predictionMovesInReverse: boolean | null; firstMiss: string | null }
  // Gaps the rebuild's layout reports: a fact to learn that already has a named gap is a different kind of hole from one
  // that has none (research/CHARTER-CRITIC.md §2 item 2).
  gaps: GapName[]
  // Metrics main's suite required for the case (its origin), which a decision may drop as an opinion.
  required: string[]
  environment: string
}

// A hand decision: overrides the rule's outcome, fact, probe, family and reason for one case in one browser.
export type Decision = { labCase: string; browser: BrowserKind; outcome: Outcome; fact?: string | null; probe?: string | null; family?: string | null; reason: string }

type MainEntry = { row: LabRow; predictOnly: boolean }

// Main's diagnostics for one case: its row scored against its own native observation, or against the rebuild row's.
function scoreMain(main: LabRow, rebuild: LabRow): { lineCount: Metric; visibleBreaks: Metric; zeroWidthPlacement: Metric; row: LabRow } | { error: string } {
  let row = main
  if ('skipped' in main.native) {
    const combined = withNativeRow(main, rebuild)
    if ('error' in combined) return combined
    row = combined
  }
  if ('error' in row.prediction) return { error: `main's prediction failed: ${row.prediction.error.split('\n')[0]}` }
  if ('layout' in row.prediction) return { error: 'main\'s row carries an engine layout' }
  const score = scoreRow(row)
  if (score.diagnostics === null || score.native === null || 'error' in row.native || 'skipped' in row.native) {
    const unobserved: Metric = { status: 'unobserved', reason: score.metrics.lineCount.reason ?? 'no native lines' }
    return { lineCount: score.metrics.lineCount, visibleBreaks: unobserved, zeroWidthPlacement: unobserved, row }
  }
  return { lineCount: score.metrics.lineCount, visibleBreaks: score.diagnostics.visibleBreaks, zeroWidthPlacement: score.diagnostics.zeroWidthPlacement, row }
}

function linesKey(row: LabRow): string | null {
  const prediction = row.prediction as LinesPrediction | { error: string }
  return 'error' in prediction ? null : JSON.stringify(prediction.lines.map(line => [line.start, line.end]))
}

export function mainCasesOf(origin: string): string[] {
  return [...new Set(origin.match(/wrap-[0-9a-f]+/g) ?? [])]
}

export function requiredOf(origin: string): string[] {
  const out = new Set<string>()
  for (const match of origin.matchAll(/required=([A-Za-z,]+)/g)) for (const name of match[1]!.split(',')) if (name !== '') out.add(name)
  return [...out].sort()
}

// The record for one case, or null when the case isn't in the population. `reverse` is the rebuild's reverse-order row;
// `mainReverse` main's reverse-order row.
export function triageCase(rebuild: LabRow, reverse: LabRow | null, main: LabRow, mainReverse: LabRow | null): TriageRecord | { error: string } | null {
  const score = scoreRow(rebuild)
  const lineCount = score.metrics.lineCount.status
  const breaks = score.metrics.breaks.status
  if (lineCount !== 'fail' && breaks !== 'fail') return null
  const mainScore = scoreMain(main, rebuild)
  if ('error' in mainScore) return mainScore
  if (mainScore.lineCount.status !== 'pass') return null
  const visible = mainScore.visibleBreaks.status
  if (lineCount !== 'fail' && visible === 'fail') return null
  const cls: TriageClass = visible === 'fail' ? 'A' : visible === 'unobserved' ? 'B' : 'C'

  const view = nativeView(rebuild)
  let isolation: TriageRecord['isolation'] = reverse === null ? 'unchecked' : nativeDifference(view, nativeView(reverse)) === null ? 'same' : 'moved'
  if (!('skipped' in main.native) && nativeDifference(view, nativeView(main)) !== null) isolation = 'moved'

  let predictionMovesInReverse: boolean | null = null
  let mainHistoryFails = false
  if (mainReverse !== null) {
    predictionMovesInReverse = linesKey(mainReverse) !== linesKey(main)
    if (predictionMovesInReverse) {
      const reverseScore = scoreMain(mainReverse, reverse ?? rebuild)
      mainHistoryFails = 'error' in reverseScore || reverseScore.lineCount.status !== 'pass' || reverseScore.visibleBreaks.status === 'fail'
    }
  }

  let outcome: Outcome
  let reason: string
  let provisional = false
  if (isolation === 'moved') {
    outcome = 'undecided'
    reason = 'the native lines depend on page history (TEST-ARCHITECTURE §6.5), not triage'
  } else if (cls === 'A') {
    outcome = 'accidental'
    reason = 'right count, wrong breaks'
  } else if (mainHistoryFails) {
    outcome = 'accidental'
    reason = 'main\'s own page history: its prediction changes and fails in reverse order'
  } else if (mainScore.zeroWidthPlacement.status === 'fail') {
    outcome = 'accidental'
    provisional = true
    reason = 'zero-width characters on other lines'
  } else if (cls === 'B') {
    outcome = 'undecided'
    reason = 'no code point shows where main\'s lines start'
  } else {
    outcome = 'fact-to-learn'
    reason = 'main passes everything observable, and the native lines show what the browser does'
  }
  const mainCases = mainCasesOf(rebuild.case.origin)
  return {
    format: TRIAGE_FORMAT, mainCase: mainCases[0] ?? null, mainCases, labCase: rebuild.id, browser: rebuild.browser, labFamily: rebuild.family,
    class: cls, isolation, outcome, provisional, fact: null, probe: null, family: null, reason, decidedBy: 'rule',
    rebuild: { lineCount, breaks },
    main: {
      lineCount: mainScore.lineCount.status, visibleBreaks: visible, zeroWidthPlacement: mainScore.zeroWidthPlacement.status, predictionMovesInReverse,
      firstMiss: mainScore.visibleBreaks.detail ?? mainScore.zeroWidthPlacement.detail ?? null,
    },
    gaps: score.gaps, required: requiredOf(rebuild.case.origin), environment: environmentKey(rebuild),
  }
}

export function applyDecision(record: TriageRecord, decision: Decision): TriageRecord {
  return {
    ...record, outcome: decision.outcome, fact: decision.fact ?? record.fact, probe: decision.probe ?? record.probe, family: decision.family ?? record.family,
    reason: decision.reason, provisional: false, decidedBy: 'hand',
  }
}

function paths(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(',').filter(part => part !== '')
}

async function* rowsOf(files: readonly string[]): AsyncGenerator<LabRow> {
  for (let f = 0; f < files.length; f++) for await (const line of readLines(files[f]!)) yield JSON.parse(line) as LabRow
}

async function main(): Promise<number> {
  const USAGE = 'Usage: bun rebuild/lab/triage.ts --rows=<files> --reverse-rows=<files> --main-rows=<files> [--main-reverse-rows=<files>] [--decisions=<file>] --out=<records.ndjson> [--summary=<file>]'
  const args = new Map<string, string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null || !['rows', 'reverse-rows', 'main-rows', 'main-reverse-rows', 'decisions', 'out', 'summary'].includes(match[1]!)) {
      console.error(`Unknown argument ${raw}. ${USAGE}`)
      return 2
    }
    args.set(match[1]!, match[2]!)
  }
  const outPath = args.get('out')
  if (args.get('rows') === undefined || args.get('main-rows') === undefined || outPath === undefined) {
    console.error(`--rows, --main-rows and --out are required. ${USAGE}`)
    return 2
  }
  const decisions = new Map<string, Decision>()
  if (args.get('decisions') !== undefined) {
    const lines = readFileSync(args.get('decisions')!, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === '') continue
      const decision = JSON.parse(lines[i]!) as Decision
      decisions.set(`${decision.browser}\n${decision.labCase}`, decision)
    }
  }
  // Rows for the other orders and main, held per case. Main's rows are small (line ranges); the rebuild's reverse rows
  // aren't, so only their native views are kept.
  const reverseViews = new Map<string, LabRow>()
  for await (const row of rowsOf(paths(args.get('reverse-rows')))) reverseViews.set(row.id, { ...row, prediction: { error: 'not kept' }, painter: null })
  const mains = new Map<string, MainEntry>()
  for await (const row of rowsOf(paths(args.get('main-rows')))) mains.set(row.id, { row, predictOnly: 'skipped' in row.native })
  const mainReverse = new Map<string, LabRow>()
  for await (const row of rowsOf(paths(args.get('main-reverse-rows')))) mainReverse.set(row.id, row)

  const summary = {
    format: TRIAGE_FORMAT, generatedAt: new Date().toISOString(), rows: 0, withoutMainRow: 0, mainErrors: {} as Record<string, number>, population: 0,
    outcomes: {} as Record<string, number>, classes: {} as Record<string, number>, isolation: {} as Record<string, number>, decisionsApplied: 0,
    environments: {} as Record<string, number>,
  }
  const bump = (counts: Record<string, number>, key: string): void => { counts[key] = (counts[key] ?? 0) + 1 }
  const records: TriageRecord[] = []
  for await (const row of rowsOf(paths(args.get('rows')))) {
    summary.rows++
    const main = mains.get(row.id)
    if (main === undefined) {
      summary.withoutMainRow++
      continue
    }
    const result = triageCase(row, reverseViews.get(row.id) ?? null, main.row, mainReverse.get(row.id) ?? null)
    if (result === null) continue
    if ('error' in result) {
      bump(summary.mainErrors, result.error.slice(0, 120))
      continue
    }
    const decision = decisions.get(`${row.browser}\n${row.id}`)
    const record = decision === undefined ? result : applyDecision(result, decision)
    if (decision !== undefined) summary.decisionsApplied++
    records.push(record)
    summary.population++
    bump(summary.outcomes, `${record.outcome}${record.provisional ? ' (provisional)' : ''}: ${record.reason}`)
    bump(summary.classes, record.class)
    bump(summary.isolation, record.isolation)
    bump(summary.environments, record.environment)
  }
  records.sort((a, b) => (a.labCase < b.labCase ? -1 : a.labCase > b.labCase ? 1 : 0))
  const fd = openSync(outPath, 'w')
  try {
    for (let i = 0; i < records.length; i++) writeSync(fd, `${JSON.stringify(records[i])}\n`)
  } finally {
    closeSync(fd)
  }
  const summaryPath = args.get('summary')
  if (summaryPath !== undefined) writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`triage: ${summary.rows} rows, ${summary.population} records (${Object.entries(summary.classes).map(([k, n]) => `${k} ${n}`).join(', ')}); ${summary.withoutMainRow} without a main row; ${outPath}`)
  for (const [outcome, n] of Object.entries(summary.outcomes)) console.log(`  ${n} ${outcome}`)
  return 0
}

if (import.meta.main) process.exit(await main())
