// Per group of inputs, what the audit predictor's rows say each paragraph asked Canvas (count-predictor.ts `audit`), and,
// with a per-case file from lab/score.ts, how many cases get their line count and visible breaks right.
//
//   bun rebuild/tools/audit/counts.ts --rows=<rows.ndjson> [--per-case=<per-case.ndjson>] [--json=<out.json>]
import { readFileSync, writeFileSync } from 'node:fs'

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? ''] as const }))

export type RowCounts = { id: string; family: string; units: number; lines: number; calls: number; chars: number; contexts: number; ms: number; ko: string; ranges: string }

export function readRows(path: string): RowCounts[] {
  const out: RowCounts[] = []
  const text = readFileSync(path, 'utf8')
  let at = 0
  while (at < text.length) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    const line = text.slice(at, end)
    at = end + 1
    if (line === '') continue
    const row = JSON.parse(line) as { id: string; family: string; case: { paragraph: { runs: { text: string }[] } }; prediction: { lines?: { start: number; end: number }[]; audit?: { calls: number; chars: number; contexts: number; ms: number; ko: string }; error?: string } }
    let units = 0
    for (const run of row.case.paragraph.runs) units += run.text.length
    const p = row.prediction
    const a = p.audit ?? { calls: NaN, chars: NaN, contexts: NaN, ms: NaN, ko: '' }
    out.push({ id: row.id, family: row.family, units, lines: p.lines?.length ?? -1, calls: a.calls, chars: a.chars, contexts: a.contexts, ms: a.ms, ko: a.ko, ranges: p.lines === undefined ? `error: ${p.error}` : p.lines.map(l => `${l.start}-${l.end}`).join(',') })
  }
  return out
}

export function groupOf(family: string): string {
  if (family.startsWith('chat/')) return family.split('/').slice(0, 2).join('/')
  if (family.startsWith('real/')) {
    const f = family.slice(5)
    if (/^(zh|ja|ko)-/.test(f)) return 'real/cjk'
    if (/^(ar|ur|he)-/.test(f)) return 'real/rtl'
    if (/^(th|km|my)-/.test(f)) return 'real/sa'
    if (/^hi-/.test(f)) return 'real/hi'
    return 'real/latin'
  }
  return family.split('/')[0]!
}

export type Status = { lineCount: string; visible: string }
export function readPerCase(path: string): Map<string, Status> {
  const map = new Map<string, Status>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line === '') continue
    const r = JSON.parse(line) as { id: string; lineCount: { status: string }; diagnostics?: { visibleBreaks?: { status: string } } }
    map.set(r.id, { lineCount: r.lineCount.status, visible: r.diagnostics?.visibleBreaks?.status ?? 'unobserved' })
  }
  return map
}

if (import.meta.main) {
  const rows = readRows(args.get('rows')!)
  const perCase = args.has('per-case') ? readPerCase(args.get('per-case')!) : null
  type Agg = { n: number; units: number; lines: number; calls: number; chars: number; contexts: number; ms: number; right: number; wrong: number }
  const groups = new Map<string, Agg>()
  const add = (key: string, r: RowCounts): void => {
    const g = groups.get(key) ?? { n: 0, units: 0, lines: 0, calls: 0, chars: 0, contexts: 0, ms: 0, right: 0, wrong: 0 }
    g.n++; g.units += r.units; g.lines += r.lines; g.calls += r.calls; g.chars += r.chars; g.contexts += r.contexts; g.ms += r.ms
    const s = perCase?.get(r.id)
    if (s !== undefined) { if (s.lineCount === 'pass' && s.visible === 'pass') g.right++; else g.wrong++ }
    groups.set(key, g)
  }
  for (const r of rows) { add(groupOf(r.family), r); add(r.family.startsWith('chat/') ? 'chat (all)' : 'real (all)', r) }
  const out: Record<string, unknown> = {}
  console.log('group                 n    units/p  lines/p  calls/p   chars/p  chars/unit  ctx/p   ms/p   right/wrong')
  for (const [k, g] of [...groups.entries()].sort()) {
    out[k] = { ...g, callsPer: g.calls / g.n, charsPer: g.chars / g.n, charsPerUnit: g.chars / g.units }
    console.log(`${k.padEnd(18)} ${String(g.n).padStart(5)} ${(g.units / g.n).toFixed(0).padStart(9)} ${(g.lines / g.n).toFixed(1).padStart(8)} ${(g.calls / g.n).toFixed(1).padStart(8)} ${(g.chars / g.n).toFixed(0).padStart(9)} ${(g.chars / g.units).toFixed(2).padStart(10)} ${(g.contexts / g.n).toFixed(1).padStart(6)} ${(g.ms / g.n).toFixed(2).padStart(6)}   ${perCase === null ? '' : `${g.right}/${g.wrong}`}`)
  }
  if (args.has('json')) writeFileSync(args.get('json')!, JSON.stringify(out, null, 1))
}
