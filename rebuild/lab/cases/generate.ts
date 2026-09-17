// Case generator CLI: writes NDJSON Case records (rebuild/lab/types.ts) plus a summary with family
// counts next to each file. Never launches a browser.
//
//   bun rebuild/lab/cases/generate.ts all                  # runs, ws, policy, smoke, suite-sample, obligations
//   bun rebuild/lab/cases/generate.ts runs [--families=split]
//   bun rebuild/lab/cases/generate.ts suite --suite-sample=20000 [--suite-families=kinsoku]
//   bun rebuild/lab/cases/generate.ts smoke --smoke-count=300
//   bun rebuild/lab/cases/generate.ts obligations          # first-class cases from main's suite (obligations.ts)
//
// Options: --seed=S (default lab-20260916), --out=FILE (single kind only), --out-dir=DIR
// (default .artifacts/lab/cases), --rows=DIR (default .artifacts/rows-20260916),
// --exclude-ids=FILE[,FILE...] (drop every case whose id appears in these case files before sampling or writing;
// for held-out sets).
//
// suite, smoke and obligations read the old suite's rows in one pass. The obligations summary adds `groups` (cases and
// required pairs per group and browser) and `required` (per case, the lab metrics each browser requires).

import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Case } from '../types.ts'
import type { Generator } from './build.ts'
import { mergeCases, sortByCaseOrder, sortCases } from './case.ts'
import { ObligationImport } from './obligations.ts'
import { POLICY_GENERATORS } from './policy.ts'
import { RUN_GENERATORS } from './runs.ts'
import { stratifiedSample } from './sample.ts'
import { streamRowInputs, SuiteImport, suiteRowFiles, type SuiteEntry } from './suite.ts'
import { WS_GENERATORS } from './ws.ts'

const REPO = resolve(import.meta.dir, '../../..')
const KINDS = ['runs', 'ws', 'policy', 'suite', 'smoke', 'obligations', 'all'] as const
type Kind = (typeof KINDS)[number]
// Suite families at or below this size are kept whole by --suite-sample.
const SMALL_FAMILY = 200

type Flags = Map<string, string>

function parseArgs(argv: readonly string[]): { kinds: Kind[]; flags: Flags } {
  const kinds: Kind[] = []
  const flags: Flags = new Map()
  const known = new Set(['seed', 'out', 'out-dir', 'rows', 'families', 'suite-sample', 'suite-families', 'smoke-count', 'exclude-ids'])
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq === -1) throw new Error(`Option ${arg} needs a value (--name=value)`)
      const name = arg.slice(2, eq)
      if (!known.has(name)) throw new Error(`Unknown option --${name}`)
      flags.set(name, arg.slice(eq + 1))
    } else if ((KINDS as readonly string[]).includes(arg)) {
      kinds.push(arg as Kind)
    } else {
      throw new Error(`Unknown kind ${arg}; expected one of ${KINDS.join(', ')}`)
    }
  }
  if (kinds.length === 0) {
    throw new Error(`Usage: bun rebuild/lab/cases/generate.ts <${KINDS.join('|')}>... [--seed=S] [--out=FILE] [--out-dir=DIR] [--rows=DIR] [--families=substr] [--suite-sample=N] [--suite-families=substr] [--smoke-count=N] [--exclude-ids=FILE[,FILE...]]`)
  }
  if (flags.has('out') && (kinds.length !== 1 || kinds[0] === 'all')) throw new Error('--out needs exactly one kind other than all')
  return { kinds, flags }
}

function positiveInt(flags: Flags, name: string, fallback: number | null): number | null {
  const value = flags.get(name)
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`)
  return n
}

function generateFamilies(generators: readonly Generator[], seed: string, filter: string | undefined): Case[] {
  const cases: Case[] = []
  for (const generator of generators) {
    if (filter !== undefined && !generator.family.includes(filter)) continue
    cases.push(...generator.generate(seed))
  }
  return mergeCases(cases)
}

// Streams cases to NDJSON and writes `<name>.summary.json` with the family counts.
function writeCases(path: string, cases: Iterable<Case>, summary: Record<string, unknown>): Record<string, number> {
  mkdirSync(dirname(path), { recursive: true })
  const counts = new Map<string, number>()
  let total = 0
  const fd = openSync(path, 'w')
  try {
    let buffer = ''
    for (const value of cases) {
      buffer += `${JSON.stringify(value)}\n`
      counts.set(value.family, (counts.get(value.family) ?? 0) + 1)
      total++
      if (buffer.length > 1 << 20) {
        writeSync(fd, buffer)
        buffer = ''
      }
    }
    if (buffer !== '') writeSync(fd, buffer)
  } finally {
    closeSync(fd)
  }
  const families = Object.fromEntries([...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
  const summaryPath = `${path.replace(/\.ndjson$/, '')}.summary.json`
  writeFileSync(summaryPath, `${JSON.stringify({ file: path, cases: total, ...summary, families }, null, 2)}\n`)
  console.log(`${path}: ${total} cases in ${counts.size} families (summary ${summaryPath})`)
  return families
}

type RowsRead = { files: string[]; skipped: string[] }
type SuiteData = { suite: SuiteImport; entries: SuiteEntry[]; files: string[]; skipped: string[]; excludedCases: number }

// Case ids listed in NDJSON case files (--exclude-ids). Lines are split on LF only: JSON strings can hold U+2028.
function readCaseIds(paths: string): Set<string> {
  const ids = new Set<string>()
  for (const path of paths.split(',')) {
    const lines = readFileSync(resolve(path), 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === '') continue
      ids.add((JSON.parse(lines[i]!) as { id: string }).id)
    }
  }
  return ids
}

// One pass over the old suite's finished row files, feeding the suite import and the obligations import.
async function readRows(rowsDir: string, suite: SuiteImport | null, obligations: ObligationImport | null): Promise<RowsRead> {
  const { files, skipped } = suiteRowFiles(rowsDir)
  if (files.length === 0) throw new Error(`No finished row files under ${rowsDir} (${skipped.join('; ')})`)
  for (const note of skipped) console.error(`skipped rows ${note}`)
  for (const file of files) {
    const started = Date.now()
    const rows = await streamRowInputs(file.rows, input => {
      suite?.add(input)
      obligations?.add(input, file.browser)
    })
    Bun.gc(true)
    const sizes = [suite === null ? null : `${suite.size} cases`, obligations === null ? null : `${obligations.size} obligation cases`].filter(value => value !== null)
    console.error(`read ${rows} rows from ${file.rows} in ${Date.now() - started}ms (${sizes.join(', ')} so far)`)
  }
  return { files: files.map(file => file.rows), skipped }
}

function selectSuite(suite: SuiteImport, read: RowsRead, familyFilter: string | undefined, excluded: ReadonlySet<string> | null): SuiteData {
  let entries = suite.entries()
  let excludedCases = 0
  if (excluded !== null) {
    const before = entries.length
    entries = entries.filter(entry => !excluded.has(entry.id))
    excludedCases = before - entries.length
  }
  if (familyFilter !== undefined) {
    entries = entries.filter(entry => entry.family.includes(familyFilter) || entry.oldFamilies.some(family => family.includes(familyFilter)))
    if (entries.length === 0) throw new Error(`--suite-families=${familyFilter} matches no suite case`)
  }
  return { suite, entries, files: read.files, skipped: read.skipped, excludedCases }
}

function* materialize(suite: SuiteImport, entries: readonly SuiteEntry[]): IterableIterator<Case> {
  for (let i = 0; i < entries.length; i++) yield suite.materialize(entries[i]!.id)
}

type FamilyRow = { cases: number; required: number; selected: number }

function suiteFamilyTable(all: readonly SuiteEntry[], selected: readonly SuiteEntry[]): Record<string, FamilyRow> {
  const table = new Map<string, FamilyRow>()
  const row = (family: string): FamilyRow => {
    let value = table.get(family)
    if (value === undefined) table.set(family, (value = { cases: 0, required: 0, selected: 0 }))
    return value
  }
  for (const entry of all) {
    const value = row(entry.family)
    value.cases++
    if (entry.required) value.required++
  }
  for (const entry of selected) row(entry.family).selected++
  return Object.fromEntries([...table].sort((a, b) => b[1].cases - a[1].cases || (a[0] < b[0] ? -1 : 1)))
}

async function main(): Promise<void> {
  const { kinds, flags } = parseArgs(process.argv.slice(2))
  const seed = flags.get('seed') ?? 'lab-20260916'
  const outDir = resolve(flags.get('out-dir') ?? resolve(REPO, '.artifacts/lab/cases'))
  const rowsDir = resolve(flags.get('rows') ?? resolve(REPO, '.artifacts/rows-20260916'))
  const familyFilter = flags.get('families')
  const excludeIds = flags.get('exclude-ids')
  const excluded = excludeIds === undefined ? null : readCaseIds(excludeIds)
  // Summary fields for --exclude-ids, absent without it so existing summaries don't change.
  const exclusion = (removed: number): Record<string, unknown> => (excluded === null ? {} : { excludeIds, excludedIds: excluded.size, excludedCases: removed })
  const all = kinds.includes('all')
  const expanded = new Set<Kind>(all ? ['runs', 'ws', 'policy', 'smoke', 'suite', 'obligations'] : kinds)
  const outFor = (name: string): string => resolve(flags.get('out') ?? resolve(outDir, `${name}.ndjson`))

  const generated = new Map<string, { cases: Case[]; removed: number }>()
  const familyCases = (name: 'runs' | 'ws' | 'policy'): { cases: Case[]; removed: number } => {
    let value = generated.get(name)
    if (value === undefined) {
      const generators = name === 'runs' ? RUN_GENERATORS : name === 'ws' ? WS_GENERATORS : POLICY_GENERATORS
      const cases = generateFamilies(generators, seed, familyFilter)
      const kept = excluded === null ? cases : cases.filter(c => !excluded.has(c.id))
      value = { cases: kept, removed: cases.length - kept.length }
      generated.set(name, value)
    }
    return value
  }
  if (familyFilter !== undefined && [...RUN_GENERATORS, ...WS_GENERATORS, ...POLICY_GENERATORS].every(generator => !generator.family.includes(familyFilter))) {
    throw new Error(`--families=${familyFilter} matches no generator family`)
  }
  for (const name of ['runs', 'ws', 'policy'] as const) {
    if (expanded.has(name)) {
      const { cases, removed } = familyCases(name)
      writeCases(outFor(name), sortCases(cases.slice()), { seed, familyFilter: familyFilter ?? null, ...exclusion(removed) })
    }
  }

  const needSuite = expanded.has('suite') || expanded.has('smoke')
  const obligations = expanded.has('obligations') ? new ObligationImport() : null
  let suiteData: SuiteData | null = null
  let read: RowsRead | null = null
  if (needSuite || obligations !== null) {
    const suite = needSuite ? new SuiteImport() : null
    read = await readRows(rowsDir, suite, obligations)
    if (suite !== null) suiteData = selectSuite(suite, read, flags.get('suite-families'), excluded)
  }

  if (expanded.has('suite') && suiteData !== null) {
    const { suite, entries } = suiteData
    const sampleSize = positiveInt(flags, 'suite-sample', all ? 20000 : null)
    let selected: SuiteEntry[] = entries
    let sampleInfo: Record<string, unknown> = {}
    if (sampleSize !== null) {
      const result = stratifiedSample(entries, sampleSize, `${seed}/suite-sample`, {
        family: entry => entry.family, id: entry => entry.id, keepFamiliesUpTo: SMALL_FAMILY, keep: entry => entry.required,
      })
      selected = result.selected
      sampleInfo = { sampleSize, keptWhole: result.kept, quotaPerLargeFamily: result.quota, overBudget: result.overBudget }
      if (result.overBudget) console.error(`warning: ${result.kept} small-family and required cases exceed --suite-sample=${sampleSize}; kept them all`)
    }
    const required = entries.filter(entry => entry.required).length
    const families = new Set(entries.map(entry => entry.family)).size
    writeCases(outFor(sampleSize === null ? 'suite' : 'suite-sample'), materialize(suite, sortByCaseOrder(selected.slice())), {
      seed, rows: suiteData.files, skippedRows: suiteData.skipped, inputs: suite.inputs, suiteCases: entries.length, requiredCases: required,
      suiteFamilies: flags.get('suite-families') ?? null, ...exclusion(suiteData.excludedCases), ...sampleInfo, suiteFamilyTable: suiteFamilyTable(entries, selected),
    })
    console.log(`suite: ${suite.inputs} row inputs -> ${entries.length} cases (${required} with required metrics) in ${families} families; wrote ${selected.length}`)
  }

  if (expanded.has('smoke')) {
    const count = positiveInt(flags, 'smoke-count', 300)!
    const pool = [...familyCases('runs').cases, ...familyCases('ws').cases, ...familyCases('policy').cases]
    const fromSuite = suiteData === null ? [] : stratifiedSample(suiteData.entries, Math.round(count / 4), `${seed}/smoke-suite`, {
      family: entry => entry.family, id: entry => entry.id, keepFamiliesUpTo: 0, priority: entry => (entry.required ? 1 : 0),
    }).selected.map(entry => suiteData.suite.materialize(entry.id))
    const fromGenerated = stratifiedSample(pool, count - fromSuite.length, `${seed}/smoke`, {
      family: value => value.family, id: value => value.id, keepFamiliesUpTo: 0,
    }).selected
    writeCases(outFor('smoke'), sortCases(mergeCases([...fromGenerated, ...fromSuite])), { seed, suiteShare: fromSuite.length, ...exclusion(0) })
  }

  if (obligations !== null && read !== null) {
    const cases = obligations.cases()
    const kept = excluded === null ? cases : cases.filter(c => !excluded.has(c.id))
    const table = obligations.table(new Set(kept.map(c => c.id)))
    writeCases(outFor('obligations'), kept, {
      rows: read.files, skippedRows: read.skipped, inputs: obligations.inputs, ...exclusion(cases.length - kept.length), groups: table.groups, required: table.required,
    })
    console.log(`obligations: ${obligations.inputs} row inputs -> ${kept.length} cases in ${Object.keys(table.groups).length} groups`)
  }
}

await main()
