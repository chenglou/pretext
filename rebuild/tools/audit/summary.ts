// One line per knockout from the eval files (eval.ts --json): Canvas calls and characters a chat message and a real
// paragraph before and after, the saving, and the cases lost on real text (chat, real paragraphs, the width sweep) and on
// the adversarial tier corpus (all, under 80 px, 80 px or more). Markdown on stdout.
//   bun rebuild/tools/audit/summary.ts --audit=<.artifacts/audit dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv.find(a => a.startsWith('--audit='))!.slice(8)
type G = { n: number; changed: number; lost: number; gained: number; moved: number; base: { calls: number; chars: number }; ko: { calls: number; chars: number } }
const read = (path: string): Record<string, G> | null => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, G> : null
const names = new Set<string>()
for (const sub of ['ko', 'sweep', 'tier', 'book']) {
  const e = join(dir, sub, 'eval')
  if (!existsSync(e)) continue
  for (const f of readdirSync(e)) if (f.endsWith('.json')) names.add(f.slice(0, -5))
}
const per = (g: G | undefined, side: 'base' | 'ko', what: 'calls' | 'chars'): string => g === undefined ? '' : (g[side][what] / g.n).toFixed(what === 'calls' ? 0 : 0)
const cell = (g: G | undefined): string => g === undefined ? '' : `${g.lost}${g.gained > 0 ? ` (+${g.gained})` : ''}${g.moved > 0 ? ` m${g.moved}` : ''} / ${g.n}`
const saving = (g: G | undefined, what: 'calls' | 'chars'): string => g === undefined || g.base[what] === 0 ? '' : `${(100 * (1 - g.ko[what] / g.base[what])).toFixed(0)}%`
console.log('| knockout | chat calls | chat chars | real calls | real chars | lost: chat | lost: real | lost: sweep | lost: books (lines) | lost: tier | tier <80px | tier ≥80px |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const name of [...names].sort()) {
  const k = read(join(dir, 'ko', 'eval', `${name}.json`))
  const s = read(join(dir, 'sweep', 'eval', `${name}.json`))
  const t = read(join(dir, 'tier', 'eval', `${name}.json`))
  const bk = read(join(dir, 'book', 'eval', `${name}.json`))
  const chat = k?.['chat (all)'], real = k?.['real (all)']
  const sw = s === null ? undefined : { ...s['real (all)']!, lost: (s['real (all)']?.lost ?? 0) + (s['chat (all)']?.lost ?? 0), n: (s['real (all)']?.n ?? 0) + (s['chat (all)']?.n ?? 0) }
  console.log(`| ${name} | ${per(chat, 'base', 'calls')} → ${per(chat, 'ko', 'calls')} (−${saving(chat, 'calls')}) | ${per(chat, 'base', 'chars')} → ${per(chat, 'ko', 'chars')} (−${saving(chat, 'chars')}) | ${per(real, 'base', 'calls')} → ${per(real, 'ko', 'calls')} | ${per(real, 'base', 'chars')} → ${per(real, 'ko', 'chars')} | ${cell(chat)} | ${cell(real)} | ${cell(sw as G | undefined)} | ${bk === null ? '' : `${cell(bk['book (all)'])} (${(bk['book (all)'] as unknown as { linesChanged: number }).linesChanged} of ${(bk['book (all)'] as unknown as { lines: number }).lines} lines)`} | ${cell(t?.['other (all)'])} | ${cell(t?.['other, under 80px'])} | ${cell(t?.['other, 80px or more'])} |`)
}
