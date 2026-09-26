// bun harness bench <base> [--lib=<dir|ref>] [--browser=chrome,firefox,safari] [--sessions=3] [--rows=new,seen,...]
//   [--background]
// Times <base>'s src/ against --lib's (this tree's by default) in the same documents, with a second copy of base as the
// control (README, Bench). Pinned Chrome and Firefox and installed Safari run one at a time in the foreground; with
// --background the harness's background browsers, webkit-host for WebKit, run instead and every verdict is a
// hypothesis. Raw samples go to .artifacts/harness-bench/<time>/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launch, type Session } from '../browsers.ts'
import type { BrowserKind } from '../types.ts'
import { benchBundle, srcOf } from './lib.ts'
import type { Doc, DocResult, OpSpec } from './page.ts'
import { report, type SessionResults } from './report.ts'
import { createRng } from '../sets/build.ts'
import { familyText, labels, MESSAGE_FAMILIES, reader, richItems, shapes, STYLE, units } from './texts.ts'

export const ROWS = ['new', 'fresh', 'rich', 'seen', 'resize', 'lines', 'worst'] as const
const LABELS = ['base', 'candidate', 'control'] as const
const WARM = 2
const ROUNDS: Record<(typeof ROWS)[number], number> = { new: 12, fresh: 9, rich: 12, seen: 16, resize: 16, lines: 12, worst: 12 }
const TARGET_MS = 50
const SEEN_UNITS: Record<(typeof MESSAGE_FAMILIES)[number], number> = { latin: 40_000, cjk: 15_000, arabic: 40_000, thai: 30_000, mixed: 40_000 }
const FRESH_UNITS: Record<(typeof MESSAGE_FAMILIES)[number], number> = { latin: 1000, cjk: 200, arabic: 1000, thai: 650, mixed: 1000 }
const RICH_UNITS = 1000

// The documents of one session in one browser, in this order, so the rows that want new text meet text no document
// before them laid out: new, fresh and rich read each family forward; seen, resize and lines take its first units.
export type Planned = Omit<Doc, 'libraries'> & { lang: string; row: string; family: string; library?: string }
export function documents(rows: readonly string[], seed: string, focus: boolean): Planned[] {
  const out: Planned[] = []
  const doc = (row: (typeof ROWS)[number], family: string, lang: string, font: string, options: object, ops: OpSpec[], fresh?: { label: string; round: number; batches: string[][] }): void => {
    const id = `${row} ${family}${fresh === undefined ? '' : ` ${fresh.round} ${fresh.label}`}`
    out.push({
      id, row, family, lang, seed: `${seed}/${id}`, font, options, focus, warm: WARM, rounds: ROUNDS[row], targetMs: TARGET_MS, ops,
      ...(fresh === undefined ? {} : { library: fresh.label, fresh: { batches: fresh.batches, units: fresh.batches.map(units) } }),
    })
  }
  const rng = createRng(seed)
  const newBatches = LABELS.length * (WARM + ROUNDS.new)
  const freshRounds = WARM + ROUNDS.fresh
  const readers = new Map(MESSAGE_FAMILIES.map(family => [family, reader(family)]))
  const want = (row: string): boolean => rows.includes(row)
  // Each family's new batches are the largest, a multiple of 10 units, that leave room for the fresh documents and, in
  // Latin, the rich ones.
  const reads = (family: (typeof MESSAGE_FAMILIES)[number]): number[] => [
    ...Array.from({ length: freshRounds * LABELS.length * 2 }, () => FRESH_UNITS[family]), ...(family === 'latin' ? Array.from({ length: newBatches }, () => RICH_UNITS) : []),
  ]
  for (const family of MESSAGE_FAMILIES) {
    const size = batchSize(family, newBatches, reads(family))
    const batches = Array.from({ length: newBatches }, () => readers.get(family)!.batch(size))
    if (want('new')) doc('new', family, STYLE[family].lang, STYLE[family].font, {}, [{ op: 'new', batches, batchUnits: batches.map(units), widths: [320] }])
  }
  const all = labels()
  const per = Math.floor(all.length / newBatches)
  if (want('new')) {
    const batches = Array.from({ length: newBatches }, (_, b) => all.slice(b * per, (b + 1) * per))
    // Per call: a label's units are one.
    doc('new', 'labels', STYLE.labels.lang, STYLE.labels.font, {}, [{ op: 'new', batches, batchUnits: batches.map(b => b.length), widths: [320] }])
  }
  // A fresh page a library a round, the libraries of a round in a shuffled order.
  for (const family of MESSAGE_FAMILIES) {
    for (let round = -WARM; round < ROUNDS.fresh; round++) {
      const order = LABELS.map(label => ({ label, key: rng.next() })).sort((a, b) => a.key - b.key)
      for (const { label } of order) {
        const batches = [readers.get(family)!.batch(FRESH_UNITS[family]), readers.get(family)!.batch(FRESH_UNITS[family])]
        if (want('fresh')) doc('fresh', family, STYLE[family].lang, STYLE[family].font, {}, [], { label, round, batches })
      }
    }
  }
  if (want('rich')) {
    const latin = readers.get('latin')!
    const batches = Array.from({ length: newBatches }, () => latin.batch(RICH_UNITS).map(m => richItems(m, STYLE.latin.font)))
    const kept = reader('latin').batch(20_000).map(m => richItems(m, STYLE.latin.font))
    const keptUnits = 20_000
    doc('rich', 'latin', 'en', STYLE.latin.font, {}, [
      { op: 'rich-new', batches, batchUnits: batches.map(items => items.reduce((n, list) => n + list.reduce((m, item) => m + item.text.length, 0), 0)), widths: [220] },
      ...['rich-stats', 'rich-walk', 'rich-stream'].map(op => ({ op, texts: kept, textUnits: keptUnits, handles: 'rich' as const, widths: [180, 220, 260] })),
    ])
  }
  for (const family of MESSAGE_FAMILIES) {
    const texts = reader(family).batch(SEEN_UNITS[family])
    const style = STYLE[family]
    if (want('seen')) doc('seen', family, style.lang, style.font, {}, [{ op: 'seen', texts, textUnits: units(texts), widths: [320] }])
    if (want('resize')) doc('resize', family, style.lang, style.font, {}, [
      { op: 'layout', texts, textUnits: units(texts), handles: 'fast', widths: [260, 380, 440] },
      { op: 'layout', texts, textUnits: units(texts), handles: 'fast', widths: [] },
    ])
  }
  if (want('lines')) {
    const texts = reader('mixed').batch(20_000)
    doc('lines', 'mixed', 'en', STYLE.mixed.font, {}, ['stats', 'walk', 'stream', 'lines'].map(op => ({ op, texts, textUnits: units(texts), handles: 'segments' as const, widths: [180, 240, 320] })))
  }
  if (want('worst')) {
    for (const shape of shapes()) {
      doc('worst', shape.id, shape.lang, shape.font, shape.options, shape.ops.map(op => ({
        op, texts: shape.texts, textUnits: units(shape.texts), widths: [240, 300, 360], ...(op === 'prepare' ? {} : { handles: op === 'walk' ? 'segments' as const : 'fast' as const }),
      })))
    }
  }
  return out
}

const sizes = new Map<string, number>()
export function batchSize(family: (typeof MESSAGE_FAMILIES)[number], count: number, after: readonly number[]): number {
  const key = `${family} ${count} ${after.length}`
  let size = sizes.get(key) ?? Math.floor(familyText(family).length / count / 10) * 10
  for (;; size = Math.floor(size * 0.95 / 10) * 10) {
    try {
      const r = reader(family)
      for (let i = 0; i < count; i++) r.batch(size)
      for (let i = 0; i < after.length; i++) r.batch(after[i]!)
      break
    } catch (error) {
      if (!(error instanceof Error) || !/ran out/.test(error.message) || size <= 10) throw error
    }
  }
  sizes.set(key, size)
  return size
}

function power(): { source: string; percent: number } {
  const out = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' })
  return { source: out.includes("'AC Power'") ? 'AC' : 'battery', percent: Number(/(\d+)%/.exec(out)?.[1] ?? 100) }
}
const load = (): string => execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim()

// One session in one browser: every document, each a fresh page, each library's bundle with a comment of its own.
async function session(browser: BrowserKind, docs: Planned[], bundles: Record<string, string>, foreground: boolean): Promise<Map<string, DocResult>> {
  const id = crypto.randomUUID()
  const results = new Map<string, DocResult>()
  let n = 0
  let attempt = 0
  let finish: (error: Error | null) => void = () => {}
  const finished = new Promise<void>((done, fail) => { finish = error => (error === null ? done() : fail(error)) })
  const script = await Bun.build({ entrypoints: [join(import.meta.dir, 'page.ts')], target: 'browser', format: 'esm' }).then(built => built.outputs[0]!.text())
  const isolated = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' }
  const docUrl = (i: number): string => `/doc?job=${id}&n=${i}&attempt=${attempt}`
  let lastActivity = Date.now()
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 0, maxRequestBodySize: 1 << 30,
    async fetch(request) {
      lastActivity = Date.now()
      const url = new URL(request.url)
      if (url.searchParams.get('job') !== id && url.pathname !== '/favicon.ico') return new Response('Inactive job', { status: 409 })
      const d = docs[Number(url.searchParams.get('n'))]!
      switch (url.pathname) {
        case '/doc': return new Response(`<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><title>pretext bench</title></head><body><script type="module" src="/page.js?job=${id}&n=0"></script></body></html>`, { headers: { ...isolated, 'content-type': 'text/html; charset=utf-8' } })
        case '/page.js': return new Response(script, { headers: { ...isolated, 'content-type': 'text/javascript; charset=utf-8' } })
        case '/api/doc': {
          const names = d.library === undefined ? LABELS : [d.library]
          const libraries = names.map(label => ({ label, code: `/* ${d.id} ${label} ${id} ${attempt} */\n${bundles[label === 'control' ? 'base' : label]}` }))
          return Response.json({ ...d, libraries } satisfies Doc)
        }
        case '/api/result': {
          const body = await request.json() as { result?: DocResult; error?: string }
          if (body.error !== undefined) {
            if (!/focus/.test(body.error) || ++attempt > 4) {
              finish(new Error(`${browser}: ${d.id}: ${body.error}`))
              return Response.json({ next: null })
            }
            console.log(`${browser}: ${d.id} lost focus; again in 60 s (attempt ${attempt + 1} of 5)`)
            await Bun.sleep(60_000)
            return Response.json({ next: docUrl(n) })
          }
          results.set(d.id, body.result!)
          attempt = 0
          if (++n === docs.length) {
            finish(null)
            return Response.json({ next: null })
          }
          return Response.json({ next: docUrl(n) })
        }
        default: return new Response(null, { status: 404 })
      }
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  let s: Session | null = null
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > 300_000) finish(new Error(`${browser}: no page activity for 5 minutes, at ${docs[n]?.id}`))
  }, 1000)
  try {
    // Chrome's documents take up to 3.6 GB, near the 4 GB a harness job gets.
    s = await launch(browser, base + docUrl(0), id, tabUrl => tabUrl.startsWith(base), finish, foreground, 6144)
    await finished
  } finally {
    clearInterval(watchdog)
    await s?.close()
    await server.stop(true)
  }
  return results
}

export async function bench(baseRef: string, lib: string, browsers: BrowserKind[], sessions: number, rows: readonly string[], background: boolean): Promise<void> {
  const before = power()
  if (!background && before.source === 'battery' && before.percent < 20) throw new Error(`On battery at ${before.percent}%: the Mac throttles; plug it in to time`)
  if (!background && browsers.includes('webkit-host')) throw new Error('webkit-host runs in the background only: time WebKit in installed Safari, or pass --background')
  const built = { base: await benchBundle(srcOf(baseRef)), candidate: await benchBundle(srcOf(lib)) }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = resolve(import.meta.dir, '../../.artifacts/harness-bench', stamp)
  mkdirSync(dir, { recursive: true })
  console.log(`bench ${baseRef} against ${lib}, ${sessions} sessions in ${browsers.join(', ')}${background ? ', in the background (hypotheses)' : ', in the foreground'}; power ${before.source} ${before.percent}%, load ${load()}; samples in ${dir}`)
  const all: SessionResults[] = []
  // A browser that fails a session sits out the rest, and the others' tables still print.
  const failed = new Map<BrowserKind, string>()
  for (let s = 0; s < sessions; s++) {
    for (const browser of browsers) {
      if (failed.has(browser)) continue
      const seed = crypto.randomUUID()
      const docs = documents(rows, seed, !background)
      const started = Date.now()
      let results: Map<string, DocResult>
      try {
        results = await session(browser, docs, { base: built.base.code, candidate: built.candidate.code }, !background)
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        failed.set(browser, `session ${s + 1}: ${why}`)
        console.log(`${browser} session ${s + 1} failed, so ${browser} sits out the rest: ${why}`)
        continue
      }
      const entry: SessionResults = { browser, session: s, seed, docs: docs.map(d => ({ row: d.row, family: d.family, id: d.id })), results: Object.fromEntries(results) }
      writeFileSync(join(dir, `${browser}-${s}.json`), JSON.stringify(entry))
      console.log(`${browser} session ${s + 1}: ${docs.length} documents in ${((Date.now() - started) / 1000).toFixed(0)} s, seed ${seed}`)
      all.push(entry)
    }
  }
  const after = power()
  console.log(report(all, { hypotheses: background, sizes: { base: built.base, candidate: built.candidate } }))
  console.log(`power ${after.source} ${after.percent}%, load ${load()}`)
  if (failed.size > 0) throw new Error(`bench: ${[...failed].map(([browser, why]) => `${browser} ${why}`).join('; ')}`)
}
