// A knockout's price and what it buys, against the browser: rows of a knockout run and of a baseline run (both from
// count-predictor.ts, usually with --predict-only), each scored against a native observation of the same case from native
// rows (lab/score.ts withNativeRow + scoreRow). A case's lines are right when its line count passes and every visible
// character lands on the browser's line (the scorer's visibleBreaks diagnostic). Per group of inputs: cases, cases whose
// predicted lines differ from the baseline's, lost (baseline right, knockout wrong), gained, moved (both wrong, lines
// differ), and the Canvas calls and characters a paragraph of each run.
//
//   bun rebuild/tools/audit/eval.ts --base=<rows> --ko=<rows> --native=<rows>[,<rows>...] [--json=<out>] [--examples=<n>] [--all]
// --all also scores every case of the knockout run, changed or not (koWrong of scored).
import { readFileSync, writeFileSync } from 'node:fs'
import { scoreRow, withNativeRow } from '../../lab/score.ts'
import type { LabRow } from '../../lab/types.ts'
import { groupOf } from './counts.ts'

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))

function readRows(path: string): Map<string, LabRow> {
  const bytes = path.endsWith('.zst') ? Bun.spawnSync(['zstd', '-dc', path], { stdout: 'pipe', maxBuffer: 2 ** 33 }).stdout : readFileSync(path)
  const text = new TextDecoder().decode(bytes)
  const map = new Map<string, LabRow>()
  let at = 0
  while (at < text.length) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    if (end > at) {
      const row = JSON.parse(text.slice(at, end)) as LabRow
      map.set(row.id, row)
    }
    at = end + 1
  }
  return map
}

type Audit = { calls: number; chars: number; contexts: number; ms: number }
type Pred = { lines?: { start: number; end: number }[]; audit?: Audit; error?: string }

function right(row: LabRow, native: LabRow): boolean | null {
  const merged = 'skipped' in (row.native as object) ? withNativeRow(row, native) : row
  if ('error' in merged) throw new Error(`${row.id}: ${merged.error}`)
  const s = scoreRow(merged)
  if (s.metrics.lineCount.status === 'unobserved') return null
  const visible = s.diagnostics?.visibleBreaks?.status
  return s.metrics.lineCount.status === 'pass' && visible === 'pass'
}

export type Outcome = {
  n: number; lines: number; linesChanged: number; changed: number; lost: number; gained: number; moved: number; unscored: number; baseWrong: number; koWrong: number; scored: number
  base: Audit; ko: Audit; units: number; lostIds: string[]; gainedIds: string[]; movedIds: string[]
}

export function evaluate(base: Map<string, LabRow>, ko: Map<string, LabRow>, natives: Map<string, LabRow>, all = false): Map<string, Outcome> {
  const groups = new Map<string, Outcome>()
  for (const [id, k] of ko) {
    const b = base.get(id)
    const n = natives.get(id)
    if (b === undefined || n === undefined) continue
    let units = 0
    for (const r of k.case.paragraph.runs) units += r.text.length
    const keys = [groupOf(k.family), k.family.startsWith('chat/') ? 'chat (all)' : k.family.startsWith('real/') ? 'real (all)' : k.family.startsWith('book/') ? 'book (all)' : 'other (all)']
    if (keys[1] === 'other (all)') keys.push(k.case.paragraph.width < 80 ? 'other, under 80px' : 'other, 80px or more')
    const bp = b.prediction as unknown as Pred
    const kp = k.prediction as unknown as Pred
    const changed = JSON.stringify(bp.lines) !== JSON.stringify(kp.lines)
    // Lines of the knockout that the baseline doesn't have, by range.
    let linesChanged = 0
    if (changed && kp.lines !== undefined && bp.lines !== undefined) {
      const known = new Set(bp.lines.map(l => `${l.start}-${l.end}`))
      for (const l of kp.lines) if (!known.has(`${l.start}-${l.end}`)) linesChanged++
    }
    let verdict: 'same' | 'lost' | 'gained' | 'moved' | 'unscored' | 'both-right' = 'same'
    let baseRight: boolean | null = null
    let koWrongAll = false
    let scoredAll = false
    if (all) {
      const r = right(k, n)
      if (r !== null) { scoredAll = true; koWrongAll = !r }
    }
    if (changed) {
      baseRight = right(b, n)
      const koRight = 'lines' in kp ? right(k, n) : false
      if (baseRight === null || koRight === null) verdict = 'unscored'
      else if (baseRight && !koRight) verdict = 'lost'
      else if (!baseRight && koRight) verdict = 'gained'
      else if (!baseRight && !koRight) verdict = 'moved'
      else verdict = 'both-right'
    }
    for (const key of keys) {
      let g = groups.get(key)
      if (g === undefined) {
        g = { n: 0, lines: 0, linesChanged: 0, changed: 0, lost: 0, gained: 0, moved: 0, unscored: 0, baseWrong: 0, koWrong: 0, scored: 0, base: { calls: 0, chars: 0, contexts: 0, ms: 0 }, ko: { calls: 0, chars: 0, contexts: 0, ms: 0 }, units: 0, lostIds: [], gainedIds: [], movedIds: [] }
        groups.set(key, g)
      }
      g.n++
      g.units += units
      g.lines += bp.lines?.length ?? 0
      g.linesChanged += linesChanged
      if (scoredAll) { g.scored++; if (koWrongAll) g.koWrong++ }
      if (changed) g.changed++
      if (verdict === 'lost') { g.lost++; g.lostIds.push(id) }
      if (verdict === 'gained') { g.gained++; g.gainedIds.push(id) }
      if (verdict === 'moved') { g.moved++; g.movedIds.push(id) }
      if (verdict === 'unscored') g.unscored++
      const ba = bp.audit, ka = kp.audit
      if (ba !== undefined) { g.base.calls += ba.calls; g.base.chars += ba.chars; g.base.contexts += ba.contexts; g.base.ms += ba.ms }
      if (ka !== undefined) { g.ko.calls += ka.calls; g.ko.chars += ka.chars; g.ko.contexts += ka.contexts; g.ko.ms += ka.ms }
    }
  }
  return groups
}

if (import.meta.main) {
  const base = readRows(args.get('base')!)
  const ko = readRows(args.get('ko')!)
  const natives = new Map<string, LabRow>()
  for (const path of args.get('native')!.split(',')) for (const [id, row] of readRows(path)) if (!natives.has(id)) natives.set(id, row)
  const groups = evaluate(base, ko, natives, args.has('all'))
  const examples = Number(args.get('examples') ?? 5)
  console.log('group               n  changed  lost gained moved unscored | calls/p base -> ko   chars/p base -> ko   ms/p base -> ko')
  const out: Record<string, unknown> = {}
  for (const [key, g] of [...groups.entries()].sort()) {
    const per = (x: number): string => (x / g.n).toFixed(1)
    console.log(`${key.padEnd(16)} ${String(g.n).padStart(5)} ${String(g.changed).padStart(8)} ${String(g.lost).padStart(5)} ${String(g.gained).padStart(6)} ${String(g.moved).padStart(5)} ${String(g.unscored).padStart(8)} | ${per(g.base.calls).padStart(7)} -> ${per(g.ko.calls).padStart(7)}  ${per(g.base.chars).padStart(8)} -> ${per(g.ko.chars).padStart(8)}  ${(g.base.ms / g.n).toFixed(2)} -> ${(g.ko.ms / g.n).toFixed(2)}`)
    if (g.lostIds.length > 0) console.log(`   lost: ${g.lostIds.slice(0, examples).join(' ')}`)
    if (g.scored > 0) console.log(`   all cases scored: ${g.scored}, wrong ${g.koWrong}`)
    if (g.linesChanged > 0) console.log(`   lines: ${g.lines} in the baseline, ${g.linesChanged} of the knockout's differ`)
    out[key] = { ...g, lostIds: g.lostIds, gainedIds: g.gainedIds.slice(0, 200), movedIds: g.movedIds.slice(0, 200) }
  }
  if (args.has('json')) writeFileSync(args.get('json')!, JSON.stringify(out, null, 1))
}
