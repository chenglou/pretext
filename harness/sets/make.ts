// Makes the case files in harness/cases. Sets with a given width are written directly; the catalog, the engine facts and
// the rich set are searched for the widths where each browser's lines change first (widths.ts), which takes the
// browsers, under the browser lock like any browser job:
//
//   bun harness/sets/make.ts write                           # sample and reports
//   bun harness/sets/make.ts first <set> --browser=<b>        # catalog, facts or rich: round 0 in one browser
//   bun harness/sets/make.ts select <set>                     # after round 0 in all three: which changes to keep
//   bun harness/sets/make.ts bisect <set> --browser=<b>       # the kept changes' exact widths in one browser
//   bun harness/sets/make.ts cut <set>                        # the cut cases, into harness/cases/<set>.ndjson, with
//                                                             # the set's main/* cases, taken once, kept as they are
//   bun harness/sets/make.ts sizes                            # each case file's cases and units per browser
//
// then `bun harness record --cases=harness/cases/<set>.ndjson` records what `check` compares against.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readCases } from '../store.ts'
import type { Case } from '../types.ts'
import { writeCases } from './build.ts'
import { catalogTemplates } from './catalog.ts'
import { reportCases } from './exact.ts'
import { factTemplates } from './facts.ts'
import { richTemplates } from './rich.ts'
import { checkedInSample, sampleReport } from './sample.ts'
import { bisect, CUT_BROWSERS, cut, recordFirst, select, unitsPerBrowser, type Template } from './widths.ts'

const CASES = join(import.meta.dir, '../cases')
const US_PER_UNIT = 58

function templatesOf(set: string): Template[] {
  switch (set) {
    case 'catalog': return catalogTemplates()
    case 'facts': return factTemplates()
    case 'rich': return richTemplates()
    default: throw new Error(`No searched set ${set}; expected catalog, facts or rich`)
  }
}

function browserFlag(): (typeof CUT_BROWSERS)[number] {
  const flag = process.argv.find(arg => arg.startsWith('--browser='))?.slice('--browser='.length)
  const browser = CUT_BROWSERS.find(b => b === flag)
  if (browser === undefined) throw new Error(`--browser must be one of ${CUT_BROWSERS.join(', ')}`)
  return browser
}

function printSizes(name: string, cases: readonly Case[]): void {
  const sizes = unitsPerBrowser(cases)
  const row = CUT_BROWSERS.map(b => `${b} ${sizes[b].cases} cases, ${sizes[b].units} units, ~${Math.round(sizes[b].units * US_PER_UNIT / 1e6)} s per order`)
  console.log(`${name}: ${cases.length} cases; ${row.join('; ')}`)
}

const [command, set] = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
switch (command) {
  case 'write': {
    const sample = checkedInSample()
    console.log(sampleReport(sample).join('\n'))
    const sets: Array<[string, Case[]]> = [['reports', reportCases()], ['sample', sample.cases]]
    for (let i = 0; i < sets.length; i++) printSizes(sets[i]![0], writeCases(join(CASES, `${sets[i]![0]}.ndjson`), sets[i]![1]))
    break
  }
  case 'first':
    await recordFirst(set!, templatesOf(set!), browserFlag())
    break
  case 'select': {
    // The catalog alone is too big to review whole: it keeps the changes that show a new line break (widths.ts).
    const r = select(set!, templatesOf(set!), set === 'catalog')
    console.log(`${set}: ${r.templates} templates, ${r.incomplete} not recorded in every browser, ${r.merged} merged into another (rule 2), ${r.kept} kept`)
    for (let b = 0; b < CUT_BROWSERS.length; b++) console.log(`  ${CUT_BROWSERS[b]}: ${r.changes[CUT_BROWSERS[b]!]} changes, ${r.selected[CUT_BROWSERS[b]!]} kept`)
    console.log(`  ${r.selectedTemplates} templates with a kept change`)
    break
  }
  case 'bisect':
    await bisect(set!, templatesOf(set!), browserFlag())
    break
  case 'cut': {
    const path = join(CASES, `${set}.ndjson`)
    const taken = existsSync(path) ? readCases(path).filter(c => c.family.startsWith(`${set}/main/`)) : []
    printSizes(set!, writeCases(path, [...taken, ...cut(set!, templatesOf(set!))]))
    break
  }
  case 'sizes': {
    const files = readdirSync(CASES).filter(name => name.endsWith('.ndjson')).sort()
    for (let i = 0; i < files.length; i++) printSizes(files[i]!, readCases(join(CASES, files[i]!)))
    break
  }
  default:
    console.error('Usage: bun harness/sets/make.ts write | first <set> --browser=<b> | select <set> | bisect <set> --browser=<b> | cut <set> | sizes')
    process.exit(2)
}
