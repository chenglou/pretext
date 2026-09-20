// The calibration tables, counted from census.ts's per-case records.
//   bun rebuild/tools/census/tables.ts [--out=<dir>]   # <dir>/calibration.json, <dir>/tables.txt (Markdown)
// Every count is over one browser's records (<dir>/<browser>/<chunk>/cases.ndjson). The columns:
// - cases: records of the family; observed: those whose line count the scorer could compare (the rebuild's lineCount status
//   isn't `unobserved`). Main and the rebuild are compared on observed cases only.
// - main: main's line count equals the native count. rebuild lineCount / breaks / widths: the scorer's pass, over the cases
//   where that metric isn't `unobserved`; `fail` and `not-applicable` (widths after failed breaks) both count as not passing.
// - main fails, rebuild passes and main passes, rebuild fails: by line count. covered: the scorer says every failing line
//   of the rebuild's failure has a gap that covers it (score.ts "Covered failures").
// - wrong lines: the rebuild fails lineCount or breaks; families sort by it, then by failed widths.
// - right count, wrong breaks: main's line count passes and its visible-breaks diagnostic fails (research/MAIN-TRIAGE.md).
// Set aside (webkit-host): cases the census of 2026-09-17 found to lay out differently in a fresh document
// (history/webkit-host/history.json) and the known tail's webkit/page-history cases. They're counted apart.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readLines } from '../../lab/rows.ts'

type Status = 'pass' | 'fail' | 'unobserved' | 'not-applicable'
type Record_ = {
  browser: string; id: string; family: string; chunk: string; units: number
  rebuild: { lineCount: Status; breaks: Status; widths: Status; painter: Status }
  covered: { lineCount?: boolean; breaks?: boolean; widths?: boolean }
  gaps: string[]
  main: { lineCount: Status; visibleBreaks: Status | 'none' }
  mainError?: string
  native: { lines: number; key: string }
}
type Then = { rebuild: { lineCount: Status; breaks: Status; widths: Status }; main: { lineCount: Status } }

const BROWSERS = ['chrome', 'firefox', 'webkit-host']
const THEN = '.artifacts/research-20260916/census'
const outArg = process.argv.slice(2).find(a => a.startsWith('--out='))
const OUT = outArg === undefined ? '.artifacts/census-20260919' : outArg.slice('--out='.length)

// ---- Counts ----

type Counts = {
  cases: number; observed: number; mainPass: number; rebuildPass: number
  breaksObserved: number; breaksPass: number; widthsObserved: number; widthsPass: number; widthsFail: number
  mainFailRebuildPass: number; mainPassRebuildFail: number; mainPassRebuildFailCovered: number; bothFail: number
  wrongLines: number; wrongLinesCovered: number; mainPassWrongLines: number; mainPassWrongLinesCovered: number
  mainFailRightLines: number; rightCountWrongBreaks: number; truePassWrongLines: number
  mainPassBreaksObserved: number; mainPassBreaksPass: number; mainFailBreaksObserved: number; mainFailBreaksPass: number
  mainPassWidthsObserved: number; mainPassWidthsPass: number; mainFailWidthsObserved: number; mainFailWidthsPass: number
}
const FIELDS: Array<keyof Counts> = ['cases', 'observed', 'mainPass', 'rebuildPass', 'breaksObserved', 'breaksPass', 'widthsObserved', 'widthsPass', 'widthsFail',
  'mainFailRebuildPass', 'mainPassRebuildFail', 'mainPassRebuildFailCovered', 'bothFail', 'wrongLines', 'wrongLinesCovered', 'mainPassWrongLines', 'mainPassWrongLinesCovered',
  'mainFailRightLines', 'rightCountWrongBreaks', 'truePassWrongLines',
  'mainPassBreaksObserved', 'mainPassBreaksPass', 'mainFailBreaksObserved', 'mainFailBreaksPass', 'mainPassWidthsObserved', 'mainPassWidthsPass', 'mainFailWidthsObserved', 'mainFailWidthsPass']

function emptyCounts(): Counts {
  const counts = {} as Counts
  for (let f = 0; f < FIELDS.length; f++) counts[FIELDS[f]!] = 0
  return counts
}

function count(into: Counts, r: Record_): void {
  into.cases++
  if (r.rebuild.lineCount === 'unobserved') return
  into.observed++
  const main = r.main.lineCount === 'pass'
  const rebuild = r.rebuild.lineCount === 'pass'
  const wrong = r.rebuild.lineCount === 'fail' || r.rebuild.breaks === 'fail'
  // Covered: every failing metric of the two is covered.
  const wrongCovered = wrong && (r.rebuild.lineCount !== 'fail' || r.covered.lineCount === true) && (r.rebuild.breaks !== 'fail' || r.covered.breaks === true)
  if (main) into.mainPass++
  if (rebuild) into.rebuildPass++
  if (r.rebuild.breaks !== 'unobserved') {
    into.breaksObserved++
    if (r.rebuild.breaks === 'pass') into.breaksPass++
    if (main) { into.mainPassBreaksObserved++; if (r.rebuild.breaks === 'pass') into.mainPassBreaksPass++ } else { into.mainFailBreaksObserved++; if (r.rebuild.breaks === 'pass') into.mainFailBreaksPass++ }
  }
  if (r.rebuild.widths !== 'unobserved') {
    into.widthsObserved++
    if (r.rebuild.widths === 'pass') into.widthsPass++
    if (r.rebuild.widths === 'fail') into.widthsFail++
    if (main) { into.mainPassWidthsObserved++; if (r.rebuild.widths === 'pass') into.mainPassWidthsPass++ } else { into.mainFailWidthsObserved++; if (r.rebuild.widths === 'pass') into.mainFailWidthsPass++ }
  }
  if (!main && rebuild) into.mainFailRebuildPass++
  if (main && !rebuild) { into.mainPassRebuildFail++; if (r.covered.lineCount === true) into.mainPassRebuildFailCovered++ }
  if (!main && !rebuild) into.bothFail++
  if (wrong) { into.wrongLines++; if (wrongCovered) into.wrongLinesCovered++ }
  if (main && wrong) { into.mainPassWrongLines++; if (wrongCovered) into.mainPassWrongLinesCovered++ }
  if (!main && !wrong) into.mainFailRightLines++
  if (main && r.main.visibleBreaks === 'fail') into.rightCountWrongBreaks++
  if (main && r.main.visibleBreaks !== 'fail' && wrong) into.truePassWrongLines++
}

// ---- Reading ----

async function records(browser: string, only: (chunk: string) => boolean): Promise<Record_[]> {
  const out: Record_[] = []
  const dir = join(OUT, browser)
  const chunks = existsSync(dir) ? readdirSync(dir).sort() : []
  for (let c = 0; c < chunks.length; c++) {
    const path = join(dir, chunks[c]!, 'cases.ndjson')
    if (!only(chunks[c]!) || !existsSync(path)) continue
    for await (const line of readLines(path)) out.push(JSON.parse(line) as Record_)
  }
  return out
}

function setAsideIds(): Set<string> {
  const ids = new Set<string>()
  const history = JSON.parse(readFileSync(join(THEN, 'history/webkit-host/history.json'), 'utf8')) as { historyDependent: Array<{ id: string }> }
  for (let i = 0; i < history.historyDependent.length; i++) ids.add(history.historyDependent[i]!.id)
  const tail = JSON.parse(readFileSync(join(import.meta.dir, '../../tests/known-tail.json'), 'utf8')) as { items: Array<{ id: string; cases: Array<{ id: string }> }> }
  for (let i = 0; i < tail.items.length; i++) {
    if (tail.items[i]!.id !== 'webkit/page-history') continue
    for (let k = 0; k < tail.items[i]!.cases.length; k++) ids.add(tail.items[i]!.cases[k]!.id)
  }
  return ids
}

// ---- Markdown ----

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${(100 * n / d).toFixed(2)}%`)
const rate = (n: number, d: number): string => (d === 0 ? 'n/a' : `${pct(n, d)} (${d - n})`)

const HEADER = '| family | cases | observed | main | rebuild lineCount | rebuild breaks | rebuild widths | main fails, rebuild passes | main passes, rebuild fails (covered) | wrong lines (covered) | right count, wrong breaks |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'

function tableRow(name: string, c: Counts): string {
  return `| ${name} | ${c.cases} | ${c.observed} | ${rate(c.mainPass, c.observed)} | ${rate(c.rebuildPass, c.observed)} | ${rate(c.breaksPass, c.breaksObserved)} | ${rate(c.widthsPass, c.widthsObserved)} | ${c.mainFailRebuildPass} | ${c.mainPassRebuildFail} (${c.mainPassRebuildFailCovered}) | ${c.wrongLines} (${c.wrongLinesCovered}) | ${c.rightCountWrongBreaks} |`
}

function familyTable(families: Map<string, Counts>, total: Counts): string {
  const names = [...families.keys()].sort((a, b) => {
    const x = families.get(a)!
    const y = families.get(b)!
    return y.wrongLines - x.wrongLines || y.widthsFail - x.widthsFail || (a < b ? -1 : 1)
  })
  const lines = [HEADER]
  for (let i = 0; i < names.length; i++) lines.push(tableRow(`\`${names[i]!.replace(/^suite\//, '')}\``, families.get(names[i]!)!))
  lines.push(tableRow('**all**', total))
  return lines.join('\n')
}

function headlines(c: Counts): string[] {
  const mainFail = c.observed - c.mainPass
  return [
    `- Of the ${mainFail} cases main gets wrong (line count), the rebuild gets ${c.mainFailRebuildPass} right by line count: **${pct(c.mainFailRebuildPass, mainFail)}**. With the right breaks too (lineCount and breaks pass): ${c.mainFailRightLines}, ${pct(c.mainFailRightLines, mainFail)}.`,
    `- Of the ${c.mainPass} cases main gets right (line count), the rebuild gets ${c.mainPassRebuildFail} wrong by line count: **${pct(c.mainPassRebuildFail, c.mainPass)}** (${c.mainPassRebuildFailCovered} of them under a covering gap). Counting wrong breaks too: ${c.mainPassWrongLines}, ${pct(c.mainPassWrongLines, c.mainPass)} (${c.mainPassWrongLinesCovered} covered). Leaving out main's right counts with wrong visible breaks (${c.rightCountWrongBreaks}): ${c.truePassWrongLines}, ${pct(c.truePassWrongLines, c.mainPass - c.rightCountWrongBreaks)}.`,
  ]
}

function difficulty(c: Counts): string {
  const mainFail = c.observed - c.mainPass
  return [
    '| half | cases | rebuild lineCount | rebuild breaks | rebuild widths |\n|---|---:|---:|---:|---:|',
    `| main passes | ${c.mainPass} | ${rate(c.mainPass - c.mainPassRebuildFail, c.mainPass)} | ${rate(c.mainPassBreaksPass, c.mainPassBreaksObserved)} | ${rate(c.mainPassWidthsPass, c.mainPassWidthsObserved)} |`,
    `| main fails | ${mainFail} | ${rate(c.mainFailRebuildPass, mainFail)} | ${rate(c.mainFailBreaksPass, c.mainFailBreaksObserved)} | ${rate(c.mainFailWidthsPass, c.mainFailWidthsObserved)} |`,
  ].join('\n')
}

function tally(list: Record_[]): { families: Map<string, Counts>; total: Counts } {
  const families = new Map<string, Counts>()
  const total = emptyCounts()
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!
    let family = families.get(r.family)
    if (family === undefined) families.set(r.family, family = emptyCounts())
    count(family, r)
    count(total, r)
  }
  return { families, total }
}

// ---- 2026-09-17 against today ----

type Moves = Record<string, number>
const METRICS = ['lineCount', 'breaks', 'widths'] as const

async function thenRecords(): Promise<Map<string, Then>> {
  const out = new Map<string, Then>()
  for await (const line of readLines(join(THEN, 'census-transitions.ndjson'))) {
    const t = JSON.parse(line) as Then & { browser: string; id: string }
    out.set(`${t.browser} ${t.id}`, { rebuild: t.rebuild, main: t.main })
  }
  return out
}

async function thenNative(browser: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const dir = join(OUT, browser)
  const chunks = existsSync(dir) ? readdirSync(dir).sort() : []
  for (let c = 0; c < chunks.length; c++) {
    const path = join(dir, chunks[c]!, 'then.ndjson')
    if (!existsSync(path)) continue
    for await (const line of readLines(path)) {
      const t = JSON.parse(line) as { id: string; native: { key: string } }
      out.set(t.id, t.native.key)
    }
  }
  return out
}

function movesTable(moves: Record<string, Moves>): string {
  const lines = ['| metric | pass → pass | fail → pass | pass → fail | fail → fail | unobserved on either day | pass rate then | pass rate now |\n|---|---:|---:|---:|---:|---:|---:|---:|']
  for (const name of Object.keys(moves)) {
    const m = moves[name]!
    const get = (k: string): number => m[k] ?? 0
    const both = get('pp') + get('fp') + get('pf') + get('ff')
    lines.push(`| ${name} | ${get('pp')} | ${get('fp')} | ${get('pf')} | ${get('ff')} | ${get('u')} | ${pct(get('pp') + get('pf'), both)} | ${pct(get('pp') + get('fp'), both)} |`)
  }
  return lines.join('\n')
}

// ---- Main ----

const aside = setAsideIds()
const then = await thenRecords()
const json: Record<string, unknown> = { generatedAt: new Date().toISOString(), fields: FIELDS }
const text: string[] = []
for (let b = 0; b < BROWSERS.length; b++) {
  const browser = BROWSERS[b]!
  const all = await records(browser, chunk => chunk !== 'real-text' && !chunk.startsWith('rerun'))
  if (all.length === 0) continue
  const kept: Record_[] = []
  const apart: Record_[] = []
  for (let i = 0; i < all.length; i++) (browser === 'webkit-host' && aside.has(all[i]!.id) ? apart : kept).push(all[i]!)
  const suite = tally(kept)
  const asideTally = tally(apart)
  const whole = tally(all)
  text.push(`## ${browser}: main's suite, ${all.length} cases${apart.length > 0 ? ` (${apart.length} set aside as page history)` : ''}`, '', ...headlines(suite.total), '', difficulty(suite.total), '', familyTable(suite.families, suite.total), '')
  if (apart.length > 0) text.push(`### ${browser}: the ${apart.length} cases set aside`, '', HEADER, tableRow('set aside', asideTally.total), tableRow('suite with them', whole.total), '')

  // Then and now, on the cases both days hold. A status that isn't pass counts as fail unless it is unobserved.
  const nativeThen = await thenNative(browser)
  const moves: Record<string, Moves> = {}
  const movedFamilies = new Map<string, { fp: number; pf: number }>()
  let joined = 0
  let nativeCompared = 0
  let nativeMoved = 0
  const bump = (name: string, a: Status, z: Status): string => {
    const key = a === 'unobserved' || z === 'unobserved' ? 'u' : `${a === 'pass' ? 'p' : 'f'}${z === 'pass' ? 'p' : 'f'}`
    const m = moves[name] ??= {}
    m[key] = (m[key] ?? 0) + 1
    return key
  }
  for (let i = 0; i < kept.length; i++) {
    const r = kept[i]!
    const t = then.get(`${browser} ${r.id}`)
    if (t === undefined) continue
    joined++
    const keyThen = nativeThen.get(r.id)
    const sameNative = keyThen === undefined ? null : keyThen === r.native.key
    if (sameNative !== null) { nativeCompared++; if (!sameNative) nativeMoved++ }
    for (let m = 0; m < METRICS.length; m++) {
      const key = bump(`rebuild ${METRICS[m]}`, t.rebuild[METRICS[m]!], r.rebuild[METRICS[m]!])
      if (sameNative === true) bump(`rebuild ${METRICS[m]}, same native view`, t.rebuild[METRICS[m]!], r.rebuild[METRICS[m]!])
      if (METRICS[m] === 'lineCount' && (key === 'fp' || key === 'pf')) {
        let f = movedFamilies.get(r.family)
        if (f === undefined) movedFamilies.set(r.family, f = { fp: 0, pf: 0 })
        f[key]++
      }
    }
    bump('main lineCount', t.main.lineCount, r.rebuild.lineCount === 'unobserved' ? 'unobserved' : r.main.lineCount)
  }
  const movedNames = [...movedFamilies.keys()].sort((x, y) => movedFamilies.get(y)!.fp + movedFamilies.get(y)!.pf - movedFamilies.get(x)!.fp - movedFamilies.get(x)!.pf)
  text.push(`### ${browser}: 2026-09-17 against today, ${joined} cases held on both days`, '',
    nativeCompared === 0 ? 'Native views of 2026-09-17 weren\'t read.' : `Native views compared on ${nativeCompared} cases: ${nativeMoved} differ.`, '', movesTable(moves), '',
    `Line-count moves by family (fail → pass, pass → fail): ${movedNames.slice(0, 25).map(n => `\`${n.replace(/^suite\//, '')}\` ${movedFamilies.get(n)!.fp}, ${movedFamilies.get(n)!.pf}`).join('; ')}${movedNames.length > 25 ? `; and ${movedNames.length - 25} more families` : ''}.`, '')

  const real = tally(await records(browser, chunk => chunk === 'real-text'))
  if (real.total.cases > 0) text.push(`### ${browser}: real paragraphs, ${real.total.cases} cases`, '', ...headlines(real.total), '', familyTable(real.families, real.total), '')

  json[browser] = {
    suite: { total: suite.total, families: Object.fromEntries(suite.families) }, setAside: asideTally.total, suiteWithSetAside: whole.total,
    thenAndNow: { joined, nativeCompared, nativeMoved, moves, families: Object.fromEntries(movedFamilies) },
    realText: { total: real.total, families: Object.fromEntries(real.families) },
  }
}
writeFileSync(join(OUT, 'calibration.json'), JSON.stringify(json, null, 1) + '\n')
writeFileSync(join(OUT, 'tables.txt'), text.join('\n') + '\n')
console.log(`wrote ${join(OUT, 'calibration.json')} and ${join(OUT, 'tables.txt')}`)
