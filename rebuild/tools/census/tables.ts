// The calibration tables, counted from census.ts's per-case records.
//   bun rebuild/tools/census/tables.ts [--out=<dir>] [--top=N]   # <dir>/calibration.json, <dir>/tables.txt and tables-full.txt (Markdown)
// Every count is over one browser's records (<dir>/<browser>/<chunk>/cases.ndjson). The columns:
// - cases: records of the family; observed: those whose line count the scorer could compare (the rebuild's lineCount status
//   isn't `unobserved`). Main and the rebuild are compared on observed cases only.
// - main: main's line count equals the native count. rebuild lineCount / breaks / widths: the scorer's pass, over the cases
//   where that metric isn't `unobserved`; `fail` and `not-applicable` (widths after failed breaks) both count as not passing.
// - main fails, rebuild passes and main passes, rebuild fails: by line count. covered: the scorer says every failing line
//   of the rebuild's failure has a gap that covers it (score.ts "Covered failures").
// - wrong lines: the rebuild fails lineCount or breaks; families sort by it, then by failed widths.
// - right count, wrong breaks: main's line count passes and its visible-breaks diagnostic fails (research/MAIN-TRIAGE.md).
// Set aside as page history, and counted apart: a case whose native view in either short fresh rerun (chunks rerun-file and
// rerun-reverse, census.ts rerun-cases) differs from the one the long document gave; and in webkit-host the cases the census
// of 2026-09-17 found that way (history/webkit-host/history.json) and the known tail's webkit/page-history cases. Only cases
// where the rebuild fails lineCount or breaks were run again, so a pass that depends on history is not found.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const topArg = process.argv.slice(2).find(a => a.startsWith('--top='))
const TOP = topArg === undefined ? Infinity : Number(topArg.slice('--top='.length))

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

// Every family worst first: by the rebuild's wrong lines, then by its failed widths. With `top`, the families after the
// first `top` are summed into one row, for the document; tables-full.txt keeps every row.
function familyTable(families: Map<string, Counts>, total: Counts, top: number): string {
  const names = [...families.keys()].sort((a, b) => {
    const x = families.get(a)!
    const y = families.get(b)!
    return y.wrongLines - x.wrongLines || y.widthsFail - x.widthsFail || (a < b ? -1 : 1)
  })
  const lines = [HEADER]
  const rest = emptyCounts()
  let worstFolded = ''
  for (let i = 0; i < names.length; i++) {
    const c = families.get(names[i]!)!
    if (i < top) {
      lines.push(tableRow(`\`${names[i]!.replace(/^suite\//, '')}\``, c))
      continue
    }
    if (i === top) worstFolded = `at most ${c.wrongLines} wrong lines each`
    for (let f = 0; f < FIELDS.length; f++) rest[FIELDS[f]!] += c[FIELDS[f]!]
  }
  if (names.length > top) lines.push(tableRow(`the other ${names.length - top} families (${worstFolded})`, rest))
  lines.push(tableRow('**all**', total))
  return lines.join('\n')
}

// The mean of the families' pass rates, each family counting once whatever its size.
function familyMeans(families: Map<string, Counts>): string {
  const sums = [0, 0, 0, 0]
  const counted = [0, 0, 0, 0]
  for (const c of families.values()) {
    const parts = [[c.mainPass, c.observed], [c.rebuildPass, c.observed], [c.breaksPass, c.breaksObserved], [c.widthsPass, c.widthsObserved]]
    for (let k = 0; k < parts.length; k++) {
      if (parts[k]![1] === 0) continue
      sums[k]! += parts[k]![0]! / parts[k]![1]!
      counted[k]!++
    }
  }
  const mean = (k: number): string => pct(sums[k]!, counted[k]!)
  return `- Every family counting once (the mean of ${families.size} family pass rates): main ${mean(0)}; the rebuild lineCount ${mean(1)}, breaks ${mean(2)}, widths ${mean(3)}.`
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

async function thenNative(browser: string): Promise<Map<string, { lines: number; key: string }>> {
  const out = new Map<string, { lines: number; key: string }>()
  const dir = join(OUT, browser)
  const chunks = existsSync(dir) ? readdirSync(dir).sort() : []
  for (let c = 0; c < chunks.length; c++) {
    const path = join(dir, chunks[c]!, 'then.ndjson')
    if (!existsSync(path)) continue
    for await (const line of readLines(path)) {
      const t = JSON.parse(line) as { id: string; native: { lines: number; key: string } }
      out.set(t.id, t.native)
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

const wrongLines = (r: Record_): boolean => r.rebuild.lineCount === 'fail' || r.rebuild.breaks === 'fail'
const mainOnly = (r: Record_): boolean => r.main.lineCount === 'pass' && r.rebuild.lineCount === 'fail'

const knownAside = setAsideIds()
const then = await thenRecords()
const json: Record<string, unknown> = { generatedAt: new Date().toISOString(), fields: FIELDS }
const text: string[] = []
const full: string[] = []
const realByBrowser: Array<{ browser: string; families: Map<string, Counts>; total: Counts }> = []
for (let b = 0; b < BROWSERS.length; b++) {
  const browser = BROWSERS[b]!
  const all = await records(browser, chunk => chunk.startsWith('chunk') || chunk.startsWith('corpus'))
  if (all.length === 0) continue

  // The reruns: which failures are the long document's history, and which stay in short fresh documents.
  const byId = new Map<string, Record_>()
  for (let i = 0; i < all.length; i++) byId.set(all[i]!.id, all[i]!)
  const forward = await records(browser, chunk => chunk === 'rerun-file')
  const reverse = new Map<string, Record_>()
  for (const r of await records(browser, chunk => chunk === 'rerun-reverse')) reverse.set(r.id, r)
  const aside = new Set<string>(browser === 'webkit-host' ? knownAside : [])
  const rerun = { cases: 0, historyDependent: 0, historyDependentRightInBoth: 0, historyDependentRightInOne: 0, historyDependentMainPassInBoth: 0, historyDependentMainPassInOne: 0, historyDependentMainOnlyThen: 0, historyDependentMainOnlyInBoth: 0, stable: 0, stableWrongInBoth: 0, stableRightInBoth: 0, stableMainOnlyThen: 0, stableMainOnlyInBoth: 0 }
  for (let i = 0; i < forward.length; i++) {
    const a = forward[i]!
    const z = reverse.get(a.id)
    const r = byId.get(a.id)
    if (z === undefined || r === undefined) continue
    rerun.cases++
    const right = !wrongLines(a) && !wrongLines(z)
    const mainOnlyInBoth = mainOnly(a) && mainOnly(z)
    if (a.native.key !== r.native.key || z.native.key !== r.native.key) {
      aside.add(a.id)
      rerun.historyDependent++
      if (right) rerun.historyDependentRightInBoth++
      else if (!wrongLines(a) || !wrongLines(z)) rerun.historyDependentRightInOne++
      const mainPasses = (a.main.lineCount === 'pass' ? 1 : 0) + (z.main.lineCount === 'pass' ? 1 : 0)
      if (mainPasses === 2) rerun.historyDependentMainPassInBoth++
      if (mainPasses === 1) rerun.historyDependentMainPassInOne++
      if (mainOnly(r)) rerun.historyDependentMainOnlyThen++
      if (mainOnlyInBoth) rerun.historyDependentMainOnlyInBoth++
    } else {
      rerun.stable++
      if (wrongLines(a) && wrongLines(z)) rerun.stableWrongInBoth++
      if (right) rerun.stableRightInBoth++
      if (mainOnly(r)) rerun.stableMainOnlyThen++
      if (mainOnlyInBoth) rerun.stableMainOnlyInBoth++
    }
  }

  const kept: Record_[] = []
  const apart: Record_[] = []
  for (let i = 0; i < all.length; i++) (aside.has(all[i]!.id) ? apart : kept).push(all[i]!)
  const suite = tally(kept)
  const asideTally = tally(apart)
  const whole = tally(all)
  text.push(`## ${browser}: main's suite, ${all.length} cases${apart.length > 0 ? ` (${apart.length} set aside as page history)` : ''}`, '', ...headlines(suite.total), familyMeans(suite.families), '', difficulty(suite.total), '', familyTable(suite.families, suite.total, TOP), '')
  full.push(`## ${browser}: main's suite, every family`, '', familyTable(suite.families, suite.total, Infinity), '')
  if (apart.length > 0) text.push(`### ${browser}: the ${apart.length} cases set aside`, '', HEADER, tableRow('set aside', asideTally.total), tableRow('suite with them', whole.total), '')
  if (rerun.cases > 0) text.push(`### ${browser}: the rebuild's wrong lines, run again in short fresh documents (${rerun.cases} cases, both orders)`, '',
    `- Native view differs from the long document's in either rerun (page history, set aside): ${rerun.historyDependent}. The rebuild has the right lines in both reruns on ${rerun.historyDependentRightInBoth} of them, in one on ${rerun.historyDependentRightInOne} and in neither on ${rerun.historyDependent - rerun.historyDependentRightInBoth - rerun.historyDependentRightInOne}; main's line count passes in both on ${rerun.historyDependentMainPassInBoth}, in one on ${rerun.historyDependentMainPassInOne} and in neither on ${rerun.historyDependent - rerun.historyDependentMainPassInBoth - rerun.historyDependentMainPassInOne}; main passed and the rebuild failed line count on ${rerun.historyDependentMainOnlyThen} in the long document and on ${rerun.historyDependentMainOnlyInBoth} in both reruns.`,
    `- Same native view in both reruns: ${rerun.stable}. The rebuild's lines are wrong in both reruns on ${rerun.stableWrongInBoth} and right in both on ${rerun.stableRightInBoth}; main passed and the rebuild failed line count on ${rerun.stableMainOnlyThen} in the long document and on ${rerun.stableMainOnlyInBoth} in both reruns.`, '')

  // Then and now, on the cases both days hold. A status that isn't pass counts as fail unless it is unobserved.
  const nativeThen = await thenNative(browser)
  const moves: Record<string, Moves> = {}
  const movedFamilies = new Map<string, { fp: number; pf: number }>()
  let joined = 0
  let nativeCompared = 0
  let nativeMoved = 0
  let nativeLinesMoved = 0
  // Cases that passed lineCount or breaks on 2026-09-17 and fail it today. That day's library carried the lab's font facts
  // (research/FACTS-FREE.md); chunk facts-pass-to-fail runs these cases through today's library with those facts.
  const passToFail: string[] = []
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
    const nativeWas = nativeThen.get(r.id)
    const sameNative = nativeWas === undefined ? null : nativeWas.key === r.native.key
    if (nativeWas !== undefined) {
      nativeCompared++
      if (nativeWas.key !== r.native.key) nativeMoved++
      if (nativeWas.lines !== r.native.lines) nativeLinesMoved++
    }
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
    if ((t.rebuild.lineCount === 'pass' && r.rebuild.lineCount === 'fail') || (t.rebuild.breaks === 'pass' && r.rebuild.breaks === 'fail')) passToFail.push(r.id)
  }
  mkdirSync(join(OUT, 'rerun'), { recursive: true })
  writeFileSync(join(OUT, 'rerun', `${browser}-pass-to-fail.ids`), passToFail.join('\n') + '\n')
  const withFacts = await records(browser, chunk => chunk === 'facts-pass-to-fail')
  let factsRight = 0
  for (let i = 0; i < withFacts.length; i++) if (!wrongLines(withFacts[i]!)) factsRight++
  const movedNames = [...movedFamilies.keys()].sort((x, y) => movedFamilies.get(y)!.fp + movedFamilies.get(y)!.pf - movedFamilies.get(x)!.fp - movedFamilies.get(x)!.pf)
  text.push(`### ${browser}: 2026-09-17 against today, ${joined} cases held on both days`, '',
    nativeCompared === 0 ? 'Native views of 2026-09-17 weren\'t read.' : `Native views compared on ${nativeCompared} cases: ${nativeMoved} differ, ${nativeLinesMoved} of them in the number of lines.`, '', movesTable(moves), '',
    `${passToFail.length} cases passed lineCount or breaks then and fail it now (\`rerun/${browser}-pass-to-fail.ids\`).${withFacts.length > 0 ? ` Run again today with the lab's font facts, which that day's library carried: ${factsRight} of ${withFacts.length} have the right lines.` : ''}`, '',
    `Line-count moves by family (fail → pass, pass → fail): ${movedNames.slice(0, 25).map(n => `\`${n.replace(/^suite\//, '')}\` ${movedFamilies.get(n)!.fp}, ${movedFamilies.get(n)!.pf}`).join('; ')}${movedNames.length > 25 ? `; and ${movedNames.length - 25} more families` : ''}.`, '')

  // The cases main passes and the rebuild gets wrong, as a list, with the gaps their rows name.
  const gapNames = new Map<string, number>()
  const listed: string[] = []
  for (let i = 0; i < kept.length; i++) {
    const r = kept[i]!
    if (r.rebuild.lineCount === 'unobserved' || r.main.lineCount !== 'pass' || !wrongLines(r)) continue
    listed.push(JSON.stringify(r))
    for (let g = 0; g < r.gaps.length; g++) gapNames.set(r.gaps[g]!, (gapNames.get(r.gaps[g]!) ?? 0) + 1)
  }
  mkdirSync(join(OUT, 'main-only'), { recursive: true })
  writeFileSync(join(OUT, 'main-only', `${browser}.ndjson`), listed.join('\n') + '\n')
  const gapList = [...gapNames.keys()].sort((x, y) => gapNames.get(y)! - gapNames.get(x)!)
  text.push(`Gaps named on the ${listed.length} cases main passes and the rebuild gets wrong (a case can name several; \`main-only/${browser}.ndjson\` lists the cases): ${gapList.map(g => `${g} ${gapNames.get(g)}`).join(', ')}.`, '')

  const real = tally(await records(browser, chunk => chunk === 'real-text'))
  realByBrowser.push({ browser, ...real })
  if (real.total.cases > 0) full.push(`## ${browser}: real paragraphs, every corpus`, '', familyTable(real.families, real.total, Infinity), '')

  json[browser] = {
    suite: { total: suite.total, families: Object.fromEntries(suite.families) }, setAside: asideTally.total, suiteWithSetAside: whole.total, rerun,
    thenAndNow: { joined, nativeCompared, nativeMoved, nativeLinesMoved, moves, families: Object.fromEntries(movedFamilies) },
    realText: { total: real.total, families: Object.fromEntries(real.families) },
  }
}
// Real paragraphs, the browsers side by side. Per browser: main's failed line counts, main's right counts with wrong visible
// breaks, the rebuild's wrong lines, the rebuild's failed widths.
if (realByBrowser.length > 0 && realByBrowser[0]!.total.cases > 0) {
  const cell = (c: Counts): string => `${c.observed - c.mainPass} / ${c.rightCountWrongBreaks} / ${c.wrongLines} / ${c.widthsFail}`
  const lines = [`## Real paragraphs: ${realByBrowser[0]!.total.cases} cases a browser`, '', 'Each cell: main\'s failed line counts / main\'s right counts with wrong visible breaks / the rebuild\'s wrong lines / the rebuild\'s failed widths.', '',
    `| corpus | cases | ${realByBrowser.map(r => r.browser).join(' | ')} |\n|---|---:|${realByBrowser.map(() => '---').join('|')}|`]
  for (const name of [...realByBrowser[0]!.families.keys()].sort()) {
    lines.push(`| \`${name.replace(/^real\//, '')}\` | ${realByBrowser[0]!.families.get(name)!.cases} | ${realByBrowser.map(r => cell(r.families.get(name) ?? emptyCounts())).join(' | ')} |`)
  }
  lines.push(`| **all** | ${realByBrowser[0]!.total.cases} | ${realByBrowser.map(r => cell(r.total)).join(' | ')} |`, '')
  for (let i = 0; i < realByBrowser.length; i++) {
    const c = realByBrowser[i]!.total
    lines.push(`- ${realByBrowser[i]!.browser}: main's line count passes ${rate(c.mainPass, c.observed)}; the rebuild's lineCount ${rate(c.rebuildPass, c.observed)}, breaks ${rate(c.breaksPass, c.breaksObserved)}, widths ${rate(c.widthsPass, c.widthsObserved)}; main fails and the rebuild passes ${c.mainFailRebuildPass}; main passes and the rebuild fails ${c.mainPassRebuildFail}.`)
  }
  text.push(...lines, '')
}
writeFileSync(join(OUT, 'calibration.json'), JSON.stringify(json, null, 1) + '\n')
writeFileSync(join(OUT, 'tables.txt'), text.join('\n') + '\n')
writeFileSync(join(OUT, 'tables-full.txt'), full.join('\n') + '\n')
console.log(`wrote ${join(OUT, 'calibration.json')} and ${join(OUT, 'tables.txt')}`)
