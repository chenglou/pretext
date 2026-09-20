// Holds two runs of probe gecko-windows-attack against each other, sample by sample: a run from a tree without windows
// inside long shaping units and a run from a tree with them (or two runs of one tree, as a control for what Firefox's
// process moves by itself). Per class of samples: offsets whose advance differs, with which of the two is the DOM's;
// offsets whose stand-in reason kind differs (exact on one side only, or another kind); lines that differ, plain and
// inspected; how far a difference grows along a unit (a drift would grow with the offset); the windows the second
// run made; and what each run sent to Canvas.
//
//   bun rebuild/tools/windows-attack-diff.ts <before>/firefox-probes.json <after>/firefox-probes.json [--json=<report>]
import { readFileSync, writeFileSync } from 'node:fs'

type Dump = { units: number; src: number[]; au: number[]; kinds: string[]; windows: number[][]; widths: number[]; lines: number[][]; inspectedLines: number[][] }
type Row = { id: string; cls: string; calls: number; unitsSent: number; ms: number; error: string | null; dump: Dump | null; dom: number[] | null }
type Tally = {
  cls: string; samples: number; offsets: number; errors: number; auDiffer: number; afterIsDom: number; beforeIsDom: number; neitherIsDom: number; maxAuDiff: number; lateDiffer: number
  exactOnlyBefore: number; exactOnlyAfter: number; otherKind: number; linesDiffer: number; inspectedDiffer: number; plainNotInspected: number
  withWindows: number; windows: number; callsBefore: number; callsAfter: number; unitsBefore: number; unitsAfter: number; msBefore: number; msAfter: number
  exactBeforeNotDom: number; exactAfterNotDom: number
}

const args = process.argv.slice(2)
const files = args.filter(a => !a.startsWith('--'))
const jsonOut = args.find(a => a.startsWith('--json='))?.slice(7) ?? null
if (files.length !== 2) throw new Error('two firefox-probes.json files')
const rowsOf = (path: string): Row[] => {
  const run = JSON.parse(readFileSync(path, 'utf8')) as { results: { result: { observations: { value: { samples: Row[] } }[] } }[] }
  return run.results[0]!.result.observations[0]!.value.samples
}
const before = rowsOf(files[0]!)
const after = rowsOf(files[1]!)
if (before.length !== after.length) throw new Error(`sample counts differ: ${before.length}, ${after.length}`)

function same(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
const tallies: Tally[] = []
const examples: unknown[] = []
for (let i = 0; i < before.length; i++) {
  const b = before[i]!
  const a = after[i]!
  if (b.id !== a.id) throw new Error(`sample ${i} differs: ${b.id} | ${a.id}`)
  let t = tallies.find(entry => entry.cls === b.cls)
  if (t === undefined) {
    t = { cls: b.cls, samples: 0, offsets: 0, errors: 0, auDiffer: 0, afterIsDom: 0, beforeIsDom: 0, neitherIsDom: 0, maxAuDiff: 0, lateDiffer: 0, exactOnlyBefore: 0, exactOnlyAfter: 0, otherKind: 0, linesDiffer: 0,
      inspectedDiffer: 0, plainNotInspected: 0, withWindows: 0, windows: 0, callsBefore: 0, callsAfter: 0, unitsBefore: 0, unitsAfter: 0, msBefore: 0, msAfter: 0, exactBeforeNotDom: 0, exactAfterNotDom: 0 }
    tallies.push(t)
  }
  t.samples++
  t.callsBefore += b.calls; t.callsAfter += a.calls; t.unitsBefore += b.unitsSent; t.unitsAfter += a.unitsSent; t.msBefore += b.ms; t.msAfter += a.ms
  if (b.dump === null || a.dump === null) {
    t.errors++
    examples.push({ id: b.id, errorBefore: b.error, errorAfter: a.error })
    continue
  }
  const db = b.dump
  const da = a.dump
  if (!same(db.src, da.src)) throw new Error(`cluster starts differ in ${b.id}`)
  if (da.windows.length > 0) t.withWindows++
  for (let k = 0; k < da.windows.length; k++) t.windows += da.windows[k]!.length
  // The DOM's glyph advance before an offset: its rects' sum less the letter spacing of the clusters before it, from
  // the start of the offset's text run, as the port counts it. A text run starts where the port's advance is 0 again.
  const spacing = Number(/ ls (-?[\d.]+) \|/.exec(b.id)![1]) * 60
  const n = db.au.length
  let runStart = 0
  for (let k = 0; k < n; k++) {
    t.offsets++
    if (k > 0 && db.au[k] === 0 && db.au[k - 1]! > 0) runStart = k
    const dom = b.dom![k]! - b.dom![runStart]! - (k - runStart) * spacing
    const isDom = (au: number): boolean => Math.abs(au - dom) < 0.02
    if (db.kinds[k] === '' && !isDom(db.au[k]!)) t.exactBeforeNotDom++
    if (da.kinds[k] === '' && !isDom(da.au[k]!)) t.exactAfterNotDom++
    if (db.au[k] !== da.au[k]) {
      t.auDiffer++
      if (k >= n / 2) t.lateDiffer++
      t.maxAuDiff = Math.max(t.maxAuDiff, Math.abs(db.au[k]! - da.au[k]!))
      if (isDom(da.au[k]!)) t.afterIsDom++
      else if (isDom(db.au[k]!)) t.beforeIsDom++
      else t.neitherIsDom++
      if (examples.length < 400) examples.push({ id: b.id, cluster: k, at: db.src[k], before: db.au[k], after: da.au[k], dom, kindBefore: db.kinds[k], kindAfter: da.kinds[k] })
    }
    if (db.kinds[k] !== da.kinds[k]) {
      if (db.kinds[k] === '') t.exactOnlyBefore++
      else if (da.kinds[k] === '') t.exactOnlyAfter++
      else t.otherKind++
      if (db.au[k] === da.au[k] && examples.length < 400) examples.push({ id: b.id, cluster: k, at: db.src[k], au: db.au[k], dom, kindBefore: db.kinds[k], kindAfter: da.kinds[k] })
    }
  }
  for (let w = 0; w < db.lines.length; w++) {
    if (!same(db.lines[w]!, da.lines[w]!)) {
      t.linesDiffer++
      if (examples.length < 400) examples.push({ id: b.id, width: db.widths[w], linesBefore: db.lines[w], linesAfter: da.lines[w] })
    }
  }
  for (let w = 0; w < db.inspectedLines.length; w++) {
    if (!same(db.inspectedLines[w]!, da.inspectedLines[w]!)) t.inspectedDiffer++
    if (!same(da.inspectedLines[w]!, da.lines[w * 3]!)) t.plainNotInspected++
  }
}

const head = ['class', 'samples', 'offsets', 'au differ', 'after=DOM', 'before=DOM', 'neither', 'max diff', 'in 2nd half', 'exact only before', 'exact only after', 'other kind', 'lines differ', 'inspected differ',
  'plain != inspected', 'exact, not DOM: before', 'after', 'with windows', 'windows', 'calls before', 'after', 'units before', 'after', 'ms before', 'after', 'errors']
console.log(head.join(' | '))
const total: number[] = new Array<number>(head.length - 1).fill(0)
for (let i = 0; i < tallies.length; i++) {
  const t = tallies[i]!
  const row = [t.samples, t.offsets, t.auDiffer, t.afterIsDom, t.beforeIsDom, t.neitherIsDom, t.maxAuDiff, t.lateDiffer, t.exactOnlyBefore, t.exactOnlyAfter, t.otherKind, t.linesDiffer, t.inspectedDiffer, t.plainNotInspected,
    t.exactBeforeNotDom, t.exactAfterNotDom, t.withWindows, t.windows, t.callsBefore, t.callsAfter, t.unitsBefore, t.unitsAfter, Math.round(t.msBefore), Math.round(t.msAfter), t.errors]
  for (let k = 0; k < row.length; k++) total[k] = k === 6 ? Math.max(total[k]!, row[k]!) : total[k]! + row[k]!
  console.log([t.cls, ...row].join(' | '))
}
console.log(['ALL', ...total].join(' | '))
if (jsonOut !== null) writeFileSync(jsonOut, JSON.stringify({ before: files[0], after: files[1], tallies, examples }, null, 1))
