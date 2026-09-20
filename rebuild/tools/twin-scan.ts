// The twin-string scan, a report (research/ARCHITECTURE-PLAN-2.md §7 check 9, §11 "String storage class in Blink"). A twin
// is one run of characters the Blink port asks one Canvas context twice, once as a one-byte string and once as a two-byte
// one (engines/blink/shape.ts canvasString slices a Latin-1-only string of 13 units or more out of a two-byte string where
// the paragraph shapes the range under another script). Chrome shapes the two differently and keeps the first shaping per
// canvas (probes/blink-twins.ts: Amiri's 13 brackets are 159.12px one-byte and 285.79px two-byte at 48px, whichever is
// asked first answers both, in both orders, through 20,000 other words), so on one context the first asked would decide
// both widths. Since the string storage fix (research/BLINK-STRING-STORAGE.md) a segmented paragraph measures its
// one-byte strings on contexts of their own, and the scan is a tripwire: 0 cases ask one context both storages on every
// set (166 of the 380 `twins` cases did at the correctness line). No record shows a string's storage and bun has none,
// so tier 1 can't see a twin change hands; this scan says which cases ask a two-byte slice, so they are in the sets tier
// 2 runs, and whether any context is asked both.
//
//   bun rebuild/tools/twin-scan.ts --cases=<cases.ndjson>[,<more>] [--tree=<checkout or commit>] [--limit=N] [--out=<report.json>] [--jobs=N] [--page]
//
// --page scans a case file as one page that keeps one list of contexts (lab/baselines/page-contexts-predictor.ts): every
// case of the file shares its Canvas contexts with the ones before it, whatever their page language, so a twin is one run
// of characters any two cases of the file ask one context in both storages. It is listed under the case that asked the
// second storage. With per-paragraph contexts the partition by storage had to hold inside a paragraph; with a page's it
// has to hold across paragraphs (research/PROFILING-START.md, item 1). prepare empties a list that has grown past its
// bound (src/index.ts), so the scan names a context by the object it is and not by its place in the list: with places,
// a whole-page scan listed a case whose `8bit` context had taken the place a `16bit` one held before the list was
// emptied.
//
// It works on a scratch copy of the tree's rebuild/src and rebuild/lab with one line added to measure16, after its
// raw16Of call, which notes the context, the string and canvasString's `twoByte`. The anchor is that call's text: the scan
// fails when it is gone, instead of scanning nothing. The cases run through the copy's Chrome predictor under the
// stand-in Canvas (the strings a layout asks follow its own widths, so these are the stand-in's lines; a twin inside a
// word is asked at prepare time whatever the lines are). Exit 0; the report is the result.
//
// Several case files are scanned by a child process each, --jobs at a time (default: all cores but two), over the one
// scratch copy, and the report lists the cases in the files' order, as one process lists them: a case's result follows
// from the case alone. One process took nine minutes over the 67,072 case lines of Chrome's set files. --limit counts
// cases across the files, so with it one process scans them all.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { Case } from '../lab/types.ts'
import { withCore } from '../tests/cores.ts'
import { PREDICTORS } from '../tests/sets.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const REPO = resolve(import.meta.dir, '../..')
const SHAPE = 'rebuild/src/engines/blink/shape.ts'
const ANCHOR = 'const w = cs.s.length === 0 ? 0 : raw16Of(contexts, context, cs.s)'
// The port holds its contexts by reference, and the scan numbers them in the order they are first asked.
const TAP = '  ;(globalThis as { twinScan?: Array<[object, string, boolean]> }).twinScan?.push([context, cs.s, cs.twoByte])'
const PAGE_PREDICTOR = 'rebuild/lab/baselines/page-contexts-predictor.ts'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const ENV: PredictEnv = { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } }

type Twin = { context: number; text: string; first: 'one-byte' | 'two-byte'; asks: number }
// `slices`: the cases that ask a Latin-1-only string as a two-byte slice at all, with those strings: what Chrome is asked
// changes for them when the slice starts or stops reaching Canvas as two-byte.
type Report = { format: 'pretext-twin-scan/1'; tree: string; cases: number; withTwoByteSlice: number; withTwin: number; slices: Array<{ id: string; family: string; strings: string[] }>; twins: Array<{ id: string; family: string; twins: Twin[] }> }

const options = new Map<string, string>()
const page = process.argv.includes('--page')
for (const raw of process.argv.slice(2)) {
  if (raw === '--page') continue
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const files = options.get('cases')?.split(',')
if (files === undefined) throw new Error('Usage: bun rebuild/tools/twin-scan.ts --cases=<cases.ndjson>[,<more>] [--tree=<checkout or commit>] [--limit=N] [--out=<report.json>] [--jobs=N] [--page]')

const tree = options.get('tree') ?? REPO
const report: Report = { format: 'pretext-twin-scan/1', tree, cases: 0, withTwoByteSlice: 0, withTwin: 0, slices: [], twins: [] }
const limit = Number(options.get('limit') ?? Infinity)
const jobs = Math.max(1, Number(options.get('jobs') ?? Math.max(1, cpus().length - 2)))
// A child scans one file in its parent's scratch copy (the hidden option --scratch) and writes its report.
const parentScratch = options.get('scratch')
if (parentScratch !== undefined) {
  await scan(parentScratch, files)
  writeFileSync(resolve(options.get('out')!), JSON.stringify(report))
  process.exit(0)
}

// The scratch copy: a commit through git archive, a checkout as an APFS clone of its two folders.
const scratch = mkdtempSync(join(tmpdir(), 'twin-scan-'))
if (existsSync(tree) && statSync(tree).isDirectory()) {
  execFileSync('mkdir', ['-p', join(scratch, 'rebuild')])
  for (const folder of ['src', 'lab']) execFileSync('cp', ['-cR', join(resolve(tree), 'rebuild', folder), join(scratch, 'rebuild', folder)])
} else {
  execFileSync('tar', ['-x', '-C', scratch], { input: execFileSync('git', ['archive', tree, 'rebuild/src', 'rebuild/lab'], { cwd: REPO, maxBuffer: 1 << 30 }) })
}
const shape = readFileSync(join(scratch, SHAPE), 'utf8')
if (shape.split(ANCHOR).length !== 2) {
  rmSync(scratch, { recursive: true, force: true })
  throw new Error(`${SHAPE} of ${tree} doesn't hold the scan's anchor once: ${ANCHOR}`)
}
writeFileSync(join(scratch, SHAPE), shape.replace(ANCHOR, `${ANCHOR}\n${TAP}`))

if (files.length === 1 || jobs === 1 || limit !== Infinity) await scan(scratch, files)
else {
  // A child a file, the largest file first; their reports joined in the files' order.
  const order = files.map((_, i) => i).sort((a, b) => statSync(resolve(files[b]!)).size - statSync(resolve(files[a]!)).size)
  const failed: string[] = []
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(jobs, files.length); w++) workers.push((async () => {
    while (next < order.length) {
      const i = order[next++]!
      const code = await withCore(false, () => Bun.spawn(['bun', import.meta.path, `--cases=${files[i]!}`, `--scratch=${scratch}`, `--out=${join(scratch, `report-${i}.json`)}`, ...(page ? ['--page'] : [])], { cwd: REPO, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }).exited)
      if (code !== 0) failed.push(files[i]!)
    }
  })())
  await Promise.all(workers)
  if (failed.length > 0) {
    rmSync(scratch, { recursive: true, force: true })
    throw new Error(`The scan failed on ${failed.sort().join(', ')}`)
  }
  for (let i = 0; i < files.length; i++) {
    const part = JSON.parse(readFileSync(join(scratch, `report-${i}.json`), 'utf8')) as Report
    report.cases += part.cases
    report.withTwoByteSlice += part.withTwoByteSlice
    report.withTwin += part.withTwin
    for (let k = 0; k < part.slices.length; k++) report.slices.push(part.slices[k]!)
    for (let k = 0; k < part.twins.length; k++) report.twins.push(part.twins[k]!)
  }
}
rmSync(scratch, { recursive: true, force: true })
console.log(`[twin-scan] ${report.cases} cases${page ? ', a file one page with one list of contexts' : ''}: ${report.withTwoByteSlice} ask a Latin-1-only string as a two-byte slice, ${report.withTwin} ask one context the same characters in both storages`)
for (const entry of report.twins.slice(0, 12)) console.log(`  ${entry.id} ${entry.family}: ${entry.twins.map(twin => `${JSON.stringify(twin.text)} on context ${twin.context}, ${twin.first} first, ${twin.asks} asks`).join('; ')}`)
const out = options.get('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`)

// The files' cases through the scratch copy's Chrome predictor, into `report`.
async function scan(scratch: string, files: readonly string[]): Promise<void> {
  const predictor = await import(join(scratch, page ? PAGE_PREDICTOR : PREDICTORS['no-facts'])) as { predict: (c: Case, env: PredictEnv) => unknown }
  const asked: Array<[object, string, boolean]> = []
  ;(globalThis as { twinScan?: typeof asked }).twinScan = asked
  // Per context and string: the storages asked, in order. A case's own, or with --page the process's, whose predictor keeps
  // one list of contexts, so a context serves the cases after the one that made it.
  let byQuestion = new Map<string, { context: number; text: string; storages: boolean[] }>()
  let numbers = new Map<object, number>()
  for (const file of files) for (const line of readFileSync(resolve(file), 'utf8').split('\n')) {
    if (line === '' || report.cases >= limit) continue
    const c = JSON.parse(line) as Case
    report.cases++
    asked.length = 0
    const standIn = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: c.pageLang })
    try {
      predictor.predict(c, ENV)
    } finally {
      standIn.restore()
    }
    if (!page) {
      byQuestion = new Map()
      numbers = new Map()
    }
    const sliced = new Set<string>()
    // The questions whose second storage this case asked first: a twin is listed once.
    const found: Array<{ context: number; text: string; storages: boolean[] }> = []
    for (let i = 0; i < asked.length; i++) {
      const [asker, text, twoByte] = asked[i]!
      // Only a Latin-1-only string has a one-byte spelling.
      if (!/^[\x00-\xff]*$/.test(text)) continue
      if (twoByte) sliced.add(text)
      let context = numbers.get(asker)
      if (context === undefined) {
        context = numbers.size
        numbers.set(asker, context)
      }
      const key = `${context}\n${text}`
      const entry = byQuestion.get(key)
      if (entry === undefined) {
        byQuestion.set(key, { context, text, storages: [twoByte] })
        continue
      }
      if (!entry.storages.includes(twoByte)) found.push(entry)
      entry.storages.push(twoByte)
    }
    const twins: Twin[] = found.map(entry => ({ context: entry.context, text: entry.text, first: entry.storages[0]! ? 'two-byte' : 'one-byte', asks: entry.storages.length }))
    if (sliced.size > 0) {
      report.withTwoByteSlice++
      report.slices.push({ id: c.id, family: c.family, strings: [...sliced] })
    }
    if (twins.length > 0) {
      report.withTwin++
      report.twins.push({ id: c.id, family: c.family, twins })
    }
  }
}
