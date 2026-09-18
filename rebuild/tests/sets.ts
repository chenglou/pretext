// The sets the test tiers run (rebuild/lab/README.md, "Test tiers"), and the protocol they run under. One list, so the
// offline replay (replay.ts), the browser sets (browser-sets.ts) and the ledger (ledger.ts) name the same cases in the same
// parts.
//
// The protocol is part of a result. Native layout can depend on the cases a document and a browser process saw before a
// case (lab README, "Page-history dependence"), and which cases those are follows from how a set is cut into jobs and how
// many cases go in a round trip: round 3's held-out history-dependent counts moved when the run method did. So a set's parts
// are fixed here, every part is one run.ts job in a fresh browser process, in file order or reversed, at run.ts's default
// of 25 cases a round trip, and every ledger records the protocol it was observed under (ledger.ts `protocol`). Two results
// compare like with like only when their protocols are equal.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserKind } from '../lab/types.ts'

export const REPO = resolve(import.meta.dir, '../..')
const A = '.artifacts'
const DERIVED = `${A}/tests/derive-r3-20260917`

export type TierBrowser = Exclude<BrowserKind, 'safari'>
export const TIER_BROWSERS: readonly TierBrowser[] = ['chrome', 'firefox', 'webkit-host']

// Which predictor lays the cases out. `no-facts` is the headline: no supplied font facts, the library asks Canvas what it
// needs. `facts` declares the lab's font facts (lab/font-facts.ts), the optional input.
export type Config = 'no-facts' | 'facts'
export const CONFIGS: readonly Config[] = ['no-facts', 'facts']
export const PREDICTORS: Record<Config, string> = { 'no-facts': 'rebuild/lab/baselines/no-facts-predictor.ts', facts: 'rebuild/lab/predictor.ts' }

export type SetGroup = 'smoke' | 'development' | 'families' | 'heldout'
export type TestSet = {
  name: string
  group: SetGroup
  // Repo-relative case files, one per part, in order; a part is one run.ts job. `{browser}` is the browser's name.
  parts: readonly string[]
  // More run.ts arguments for every job of the set.
  runArgs: readonly string[]
  browsers: readonly TierBrowser[]
}

const EN_US = ['--chrome-apple-languages=en-US', '--chrome-accept-languages=en-US,en']
const ALL = TIER_BROWSERS
const one = (name: string, group: SetGroup, file: string, browsers: readonly TierBrowser[] = ALL, runArgs: readonly string[] = []): TestSet => ({ name, group, parts: [file], runArgs, browsers })

// Giants (paragraphs over 50,000 units, lab README "Giants") are in none of these: a giant's record is as large as its
// calls and one can take minutes, so they stay an evaluation job of their own.
export const SETS: readonly TestSet[] = [
  one('smoke-hand', 'smoke', 'rebuild/lab/smoke-cases.ndjson'),
  one('smoke', 'smoke', `${A}/lab/cases/smoke.ndjson`),
  one('runs', 'development', `${A}/lab/cases/runs.ndjson`),
  one('ws', 'development', `${A}/lab/cases/ws.ndjson`),
  one('policy', 'development', `${A}/lab/cases/policy.ndjson`),
  // White-space: pre-wrap in rich inline content (lab/cases/rich-prewrap.ts, research/PREWRAP-RICH.md): the only set that
  // reaches tab-size on a span, and justify beside a preserved newline or beside preserved spaces across a box end.
  one('rich-prewrap', 'development', `${A}/lab/cases/rich-prewrap.ndjson`),
  { name: 'suite-sample', group: 'development', parts: [0, 1, 2, 3].map(k => `${A}/lab/final-20260916/cases/suite-sample-part${k}.ndjson`), runArgs: [], browsers: ALL },
  one('families', 'families', `${DERIVED}/{browser}/families/final/family-cases.ndjson`),
  one('features', 'families', `${DERIVED}/{browser}/features/final/family-cases.ndjson`),
  one('features-en-US', 'families', `${DERIVED}/chrome-en-US/features/final/family-cases.ndjson`, ['chrome'], EN_US),
  one('heldout-runs', 'heldout', `${A}/lab/cases/heldout-runs.ndjson`),
  one('heldout-ws', 'heldout', `${A}/lab/cases/heldout-ws.ndjson`),
  one('heldout-policy', 'heldout', `${A}/lab/cases/heldout-policy.ndjson`),
  { name: 'heldout-suite-sample', group: 'heldout', parts: [0, 1].map(k => `${A}/lab/final-20260916/cases/heldout-suite-sample-part${k}.ndjson`), runArgs: [], browsers: ALL },
]

// A set's case files as run.ts gets them: real paths. A worktree reaches the shared `.artifacts` through a symbolic link,
// and a run record names its case file (run.json `casesFile`, which lab/cases/used-ids.ts reads for the registry of used
// ids), so the record names the shared file itself, which outlives the worktree.
export function partFiles(set: TestSet, browser: TierBrowser): string[] {
  return set.parts.map(part => {
    const path = join(REPO, part.replaceAll('{browser}', browser))
    return existsSync(path) ? realpathSync(path) : path
  })
}

// The sets a command's --sets and --groups select for a browser, in SETS order: a set named by either. Both absent selects
// every set.
export function selectSets(browser: TierBrowser, sets: string | undefined, groups: string | undefined): TestSet[] {
  const names = sets === undefined ? null : new Set(sets.split(',').filter(name => name !== ''))
  const wantedGroups = groups === undefined ? null : new Set(groups.split(',').filter(name => name !== ''))
  if (names !== null) for (const name of names) if (!SETS.some(set => set.name === name)) throw new Error(`Unknown set ${name}; known: ${SETS.map(set => set.name).join(', ')}`)
  if (wantedGroups !== null) for (const name of wantedGroups) if (!SETS.some(set => set.group === name)) throw new Error(`Unknown group ${name}; known: smoke, development, families, heldout`)
  const all = names === null && wantedGroups === null
  return SETS.filter(set => set.browsers.includes(browser) && (all || names?.has(set.name) === true || wantedGroups?.has(set.group) === true))
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// What a result was observed under, apart from the browser and the library: the parts with their case files' hashes, the
// cases per round trip and the order. `run.ts` defaults to 25 cases a round trip; a tier never passes --chunk.
export const CASES_PER_ROUND_TRIP = 25
export type PartProtocol = { casesFile: string; casesSha256: string }
export type SetProtocol = { set: string; parts: PartProtocol[]; casesPerRoundTrip: number; freshProcessPerPart: true; runArgs: string[] }

// `moreRunArgs`: run.ts arguments a command adds to every job, which change what a row was observed after
// (browser-sets.ts --measure-first). They are part of the protocol, so such a ledger meets the usual one only knowingly.
export function setProtocol(set: TestSet, browser: TierBrowser, moreRunArgs: readonly string[] = []): SetProtocol {
  const parts: PartProtocol[] = []
  for (const part of set.parts) {
    const relative = part.replaceAll('{browser}', browser)
    const path = join(REPO, relative)
    if (!existsSync(path)) throw new Error(`${relative}: the case file of set ${set.name} is missing`)
    parts.push({ casesFile: relative, casesSha256: sha256File(path) })
  }
  return { set: set.name, parts, casesPerRoundTrip: CASES_PER_ROUND_TRIP, freshProcessPerPart: true, runArgs: [...set.runArgs, ...moreRunArgs] }
}
