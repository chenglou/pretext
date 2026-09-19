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
//   bun rebuild/tools/twin-scan.ts --cases=<cases.ndjson>[,<more>] [--tree=<checkout or commit>] [--limit=N] [--out=<report.json>]
//
// It works on a scratch copy of the tree's rebuild/src and rebuild/lab with one line added to measure16, after its
// raw16Of call, which notes the context, the string and canvasString's `twoByte`. The anchor is that call's text: the scan
// fails when it is gone, instead of scanning nothing. The cases run through the copy's Chrome predictor under the
// stand-in Canvas (the strings a layout asks follow its own widths, so these are the stand-in's lines; a twin inside a
// word is asked at prepare time whatever the lines are). Exit 0; the report is the result.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PredictEnv } from '../lab/predictor-core.ts'
import type { Case } from '../lab/types.ts'
import { PREDICTORS } from '../tests/sets.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const REPO = resolve(import.meta.dir, '../..')
const SHAPE = 'rebuild/src/engines/blink/shape.ts'
const ANCHOR = 'const w = cs.s.length === 0 ? 0 : raw16Of(sh, contexts, context, cs.s)'
const TAP = '  ;(globalThis as { twinScan?: Array<[number, string, boolean]> }).twinScan?.push([context, cs.s, cs.twoByte])'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const ENV: PredictEnv = { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } }

type Twin = { context: number; text: string; first: 'one-byte' | 'two-byte'; asks: number }
// `slices`: the cases that ask a Latin-1-only string as a two-byte slice at all, with those strings: what Chrome is asked
// changes for them when the slice starts or stops reaching Canvas as two-byte.
type Report = { format: 'pretext-twin-scan/1'; tree: string; cases: number; withTwoByteSlice: number; withTwin: number; slices: Array<{ id: string; family: string; strings: string[] }>; twins: Array<{ id: string; family: string; twins: Twin[] }> }

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const files = options.get('cases')?.split(',')
if (files === undefined) throw new Error('Usage: bun rebuild/tools/twin-scan.ts --cases=<cases.ndjson>[,<more>] [--tree=<checkout or commit>] [--limit=N] [--out=<report.json>]')

// The scratch copy: a commit through git archive, a checkout as an APFS clone of its two folders.
const tree = options.get('tree') ?? REPO
const scratch = mkdtempSync(join(tmpdir(), 'twin-scan-'))
if (existsSync(tree) && statSync(tree).isDirectory()) {
  execFileSync('mkdir', ['-p', join(scratch, 'rebuild')])
  for (const folder of ['src', 'lab']) execFileSync('cp', ['-cR', join(resolve(tree), 'rebuild', folder), join(scratch, 'rebuild', folder)])
} else {
  execFileSync('tar', ['-x', '-C', scratch], { input: execFileSync('git', ['archive', tree, 'rebuild/src', 'rebuild/lab'], { cwd: REPO, maxBuffer: 1 << 30 }) })
}
const shape = readFileSync(join(scratch, SHAPE), 'utf8')
if (shape.split(ANCHOR).length !== 2) {
  execFileSync('trash', [scratch])
  throw new Error(`${SHAPE} of ${tree} doesn't hold the scan's anchor once: ${ANCHOR}`)
}
writeFileSync(join(scratch, SHAPE), shape.replace(ANCHOR, `${ANCHOR}\n${TAP}`))

const predictor = await import(join(scratch, PREDICTORS['no-facts'])) as { predict: (c: Case, env: PredictEnv) => unknown }
const asked: Array<[number, string, boolean]> = []
;(globalThis as { twinScan?: typeof asked }).twinScan = asked
const report: Report = { format: 'pretext-twin-scan/1', tree, cases: 0, withTwoByteSlice: 0, withTwin: 0, slices: [], twins: [] }
const limit = Number(options.get('limit') ?? Infinity)
for (const file of files) {
  for (const line of readFileSync(resolve(file), 'utf8').split('\n')) {
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
    // Per context and string: the storages asked, in order.
    const byQuestion = new Map<string, { context: number; text: string; storages: boolean[] }>()
    const sliced = new Set<string>()
    for (let i = 0; i < asked.length; i++) {
      const [context, text, twoByte] = asked[i]!
      // Only a Latin-1-only string has a one-byte spelling.
      if (!/^[\x00-\xff]*$/.test(text)) continue
      if (twoByte) sliced.add(text)
      const key = `${context}\n${text}`
      const entry = byQuestion.get(key)
      if (entry === undefined) byQuestion.set(key, { context, text, storages: [twoByte] })
      else entry.storages.push(twoByte)
    }
    if (sliced.size > 0) {
      report.withTwoByteSlice++
      report.slices.push({ id: c.id, family: c.family, strings: [...sliced] })
    }
    const twins: Twin[] = []
    for (const entry of byQuestion.values()) {
      if (entry.storages.includes(true) && entry.storages.includes(false)) twins.push({ context: entry.context, text: entry.text, first: entry.storages[0]! ? 'two-byte' : 'one-byte', asks: entry.storages.length })
    }
    if (twins.length > 0) {
      report.withTwin++
      report.twins.push({ id: c.id, family: c.family, twins })
    }
  }
}
execFileSync('trash', [scratch])
console.log(`[twin-scan] ${report.cases} cases: ${report.withTwoByteSlice} ask a Latin-1-only string as a two-byte slice, ${report.withTwin} ask one context the same characters in both storages`)
for (const entry of report.twins.slice(0, 12)) console.log(`  ${entry.id} ${entry.family}: ${entry.twins.map(twin => `${JSON.stringify(twin.text)} on context ${twin.context}, ${twin.first} first, ${twin.asks} asks`).join('; ')}`)
const out = options.get('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`)
