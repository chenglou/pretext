// bun harness bench <base> [--lib=<dir|ref>] [--browser=chrome,firefox,safari] [--sessions=2] [--rows=new,seen,...]
//   [--background]
// Times <base>'s src/ against --lib's (this tree's by default) in the same documents, with a second copy of base as the
// control (harness/README.md, Bench). After two sessions, each browser times the documents of the rows that read slower
// or faster in a third. Pinned Chrome and Firefox and installed Safari run one at a time in the foreground; with
// --background the harness's background browsers, webkit-host for WebKit, run instead and every verdict is a
// hypothesis. Raw samples go to .artifacts/harness-bench/<time>/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveJob, watched, windowTitle } from '../run.ts'
import { BROWSER, type BrowserKind } from '../types.ts'
import { benchBundle, buildName, srcOf } from './lib.ts'
import type { Doc, DocResult, OpSpec } from './page.ts'
import { report, unconfirmed, type SessionResults } from './report.ts'
import { createRng } from '../sets/build.ts'
import type { RichInlineItem } from '../../src/rich-inline.ts'
import { chatItems, familyText, itemReader, labels, MESSAGE_FAMILIES, reader, richItems, shapes, STYLE, units, wholeBatches, wholeItems, wholeMessages } from './texts.ts'

export const ROWS = ['new', 'fresh', 'rich', 'seen', 'resize', 'lines', 'worst'] as const
const LABELS = ['base', 'candidate', 'control'] as const
const WARM = 2
const ROUNDS: Record<(typeof ROWS)[number], number> = { new: 12, fresh: 9, rich: 12, seen: 16, resize: 16, lines: 12, worst: 12 }
const TARGET_MS = 50
const SEEN_UNITS: Record<(typeof MESSAGE_FAMILIES)[number], number> = { latin: 40_000, cjk: 15_000, arabic: 40_000, thai: 30_000, mixed: 40_000 }
const FRESH_UNITS: Record<(typeof MESSAGE_FAMILIES)[number], number> = { latin: 1000, cjk: 200, arabic: 1000, thai: 650, mixed: 1000 }
const RICH_UNITS = 1000
// A new batch of the chat documents holds four times the stress document's, whose size the length of the Latin text
// caps (The Great Gatsby's opening, texts.ts). A round compares three batches, one a library, and 1,000 units of the
// demo's paragraphs cost 180 to 1,900 µs per 1,000 units in Chrome by what they held, where batches of prose differ
// less: main read 15-49% slower than itself in three sessions (RESEARCH.md, Evaluation Traps, Timing).
const CHAT_UNITS = 4000
const NEW_BATCHES = LABELS.length * (WARM + ROUNDS.new)
const FRESH_ROUNDS = WARM + ROUNDS.fresh

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
  const readers = new Map(MESSAGE_FAMILIES.map(family => [family, reader(family)]))
  const want = (row: string): boolean => rows.includes(row)
  for (const family of MESSAGE_FAMILIES) {
    const size = newBatchSize(family)
    const batches = Array.from({ length: NEW_BATCHES }, () => readers.get(family)!.batch(size)!)
    if (want('new')) doc('new', family, STYLE[family].lang, STYLE[family].font, {}, [{ op: 'new', batches, batchUnits: batches.map(units), widths: [320] }])
  }
  const all = labels()
  const per = Math.floor(all.length / NEW_BATCHES)
  if (want('new')) {
    const batches = Array.from({ length: NEW_BATCHES }, (_, b) => all.slice(b * per, (b + 1) * per))
    // Per call: a label's units are one.
    doc('new', 'labels', STYLE.labels.lang, STYLE.labels.font, {}, [{ op: 'new', batches, batchUnits: batches.map(b => b.length), widths: [320] }])
  }
  // A fresh page a library a round, the libraries of a round in a shuffled order.
  for (const family of MESSAGE_FAMILIES) {
    for (let round = -WARM; round < ROUNDS.fresh; round++) {
      const order = LABELS.map(label => ({ label, key: rng.next() })).sort((a, b) => a.key - b.key)
      for (const { label } of order) {
        const batches = [readers.get(family)!.batch(FRESH_UNITS[family])!, readers.get(family)!.batch(FRESH_UNITS[family])!]
        if (want('fresh')) doc('fresh', family, STYLE[family].lang, STYLE[family].font, {}, [], { label, round, batches })
      }
    }
  }
  if (want('rich')) {
    const latin = readers.get('latin')!
    const batches = Array.from({ length: NEW_BATCHES }, () => latin.batch(RICH_UNITS)!.map(m => richItems(m, STYLE.latin.font)))
    const kept = reader('latin').batch(20_000)!.map(m => richItems(m, STYLE.latin.font))
    const itemUnits = (lists: RichInlineItem[][]): number => lists.reduce((n, list) => n + list.reduce((m, item) => m + item.text.length, 0), 0)
    const rich = (family: string, newBatches: RichInlineItem[][][], texts: RichInlineItem[][]): void => doc('rich', family, 'en', STYLE.latin.font, {}, [
      { op: 'rich-new', batches: newBatches, batchUnits: newBatches.map(itemUnits), widths: [220] },
      ...['rich-stats', 'rich-walk', 'rich-stream'].map(op => ({ op, texts, textUnits: itemUnits(texts), handles: 'rich' as const, widths: [180, 220, 260] })),
      // The kept messages prepared again, where every item looks its font up and measures nothing.
      { op: 'rich-seen', texts, textUnits: itemUnits(texts), widths: [220] },
    ])
    // The stress items, a word or a space each; then the chat demo's messages as it prepares them, most of them one
    // item, and its styled paragraphs alone, which no document before them prepared (texts.ts, chatItems). Each chat
    // document's kept paragraphs are read before its new batches, so a batch's size doesn't decide which paragraphs
    // the line operations run on.
    rich('latin', batches, kept)
    const chat = itemReader(chatItems())
    const chatKept = chat.batch(20_000)
    rich('chat', Array.from({ length: NEW_BATCHES }, () => chat.batch(CHAT_UNITS)), chatKept)
    const styled = itemReader(chat.rest().filter(items => items.length > 1))
    const styledKept = styled.batch(20_000)
    rich('chat-styled', Array.from({ length: NEW_BATCHES }, () => styled.batch(CHAT_UNITS)), styledKept)
  }
  // Scratch (rp3-whole-rich, never merged), chosen with --rows=whole (--rows=rich,whole times them after the rich row's
  // own): three documents of the rich row, with its floor and operations, whose every width is a whole number, the
  // CJK messages cut down to the characters 16px PingFang TC draws a whole number of pixels wide (texts.ts,
  // wholeMessages). `whole-one`: every paragraph one item. `whole-chat`: each paragraph in the shape of the chat
  // demo's paragraph of the same rank, 86% of them one item. `whole-styled`: each in the shape of the demo's styled
  // paragraph of the same rank, so every one is several items. The kept paragraphs are the messages, and the new
  // batches the same messages cut into batches, so a new batch is new to the copy that prepares it and holds text the
  // kept paragraphs hold too, which nothing timed reads: the line operations' handles and the first exposure of the
  // text prepared again aren't timed. The page counts, after the timed rounds, the numbers in each copy's lists that
  // aren't whole (page.ts, checkWhole).
  if (want('whole')) {
    const messages = wholeMessages()
    const batches = wholeBatches(messages, NEW_BATCHES, Math.floor(units(messages) / NEW_BATCHES / 10) * 10)
    const demo = chatItems()
    const styled = demo.filter(items => items.length > 1)
    const body: RichInlineItem[] = [{ text: ' ', font: '400', letterSpacing: 0, break: 'normal', extraWidth: 0 }]
    const itemUnits = (lists: RichInlineItem[][]): number => lists.reduce((n, list) => n + list.reduce((m, item) => m + item.text.length, 0), 0)
    for (const [family, shapeOf] of [['whole-one', () => body], ['whole-chat', (rank: number) => demo[rank]!], ['whole-styled', (rank: number) => styled[rank]!]] as const) {
      let rank = 0
      const texts = messages.map(m => wholeItems(m, shapeOf(rank++)))
      const newBatches = batches.map(batch => batch.map(m => wholeItems(m, shapeOf(rank++))))
      doc('rich', family, STYLE.cjk.lang, STYLE.cjk.font, {}, [
        { op: 'rich-new', batches: newBatches, batchUnits: newBatches.map(itemUnits), widths: [220] },
        ...['rich-stats', 'rich-walk', 'rich-stream'].map(op => ({ op, texts, textUnits: itemUnits(texts), handles: 'rich' as const, widths: [180, 220, 260] })),
        { op: 'rich-seen', texts, textUnits: itemUnits(texts), widths: [220] },
      ])
      out[out.length - 1]!.checkWhole = true
    }
  }
  for (const family of MESSAGE_FAMILIES) {
    const texts = reader(family).batch(SEEN_UNITS[family])!
    const style = STYLE[family]
    if (want('seen')) doc('seen', family, style.lang, style.font, {}, [{ op: 'seen', texts, textUnits: units(texts), widths: [320] }])
    if (want('resize')) doc('resize', family, style.lang, style.font, {}, [
      { op: 'layout', texts, textUnits: units(texts), handles: 'fast', widths: [260, 380, 440] },
      { op: 'layout', texts, textUnits: units(texts), handles: 'fast', widths: [] },
    ])
  }
  if (want('lines')) {
    // Latin and CJK messages of their own too: the mixed ones hold little of any one script, so a line walk that slowed
    // on one script's handles would leave their rows within noise, as one on CJK handles would have in #366
    // (RESEARCH.md, The Walkers' Shapes).
    for (const family of ['mixed', 'latin', 'cjk'] as const) {
      const texts = reader(family).batch(20_000)!
      const ops = family === 'mixed' ? ['stats', 'walk', 'stream', 'lines'] : ['stats', 'walk', 'stream']
      doc('lines', family, STYLE[family].lang, STYLE[family].font, {}, ops.map(op => ({ op, texts, textUnits: units(texts), handles: 'segments' as const, widths: [180, 240, 320] })))
    }
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

// Each family's new batch size, found once per process: the largest multiple of 10 units, from an even share of its text
// down, whose batches leave room for the fresh documents' and, in Latin, the rich ones.
const newBatchSizes = new Map<string, number>()
function newBatchSize(family: (typeof MESSAGE_FAMILIES)[number]): number {
  let size = newBatchSizes.get(family)
  if (size !== undefined) return size
  const reads = [
    ...Array.from({ length: FRESH_ROUNDS * LABELS.length * 2 }, () => FRESH_UNITS[family]), ...(family === 'latin' ? Array.from({ length: NEW_BATCHES }, () => RICH_UNITS) : []),
  ]
  for (size = Math.floor(familyText(family).length / NEW_BATCHES / 10) * 10; ; size = Math.floor(size * 0.95 / 10) * 10) {
    const r = reader(family)
    let fits = true
    for (let i = 0; i < NEW_BATCHES + reads.length && fits; i++) fits = r.batch(i < NEW_BATCHES ? size : reads[i - NEW_BATCHES]!) !== null
    if (fits) break
    if (size <= 10) throw new Error(`${family}: its text holds no new batches`)
  }
  newBatchSizes.set(family, size)
  return size
}

function power(): { source: string; percent: number } {
  const out = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' })
  return { source: out.includes("'AC Power'") ? 'AC' : 'battery', percent: Number(/(\d+)%/.exec(out)?.[1] ?? 100) }
}
const load = (): string => execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim()

// One session in one browser: every document, each a fresh page, each library's bundle with a comment of its own. A
// background window's title says so (windowTitle, run.ts); a foreground one keeps the title its floors were fitted with.
async function session(browser: BrowserKind, docs: Planned[], bundles: Record<string, string>, foreground: boolean): Promise<Map<string, DocResult>> {
  const id = crypto.randomUUID()
  const results = new Map<string, DocResult>()
  let n = 0
  let attempt = 0
  const script = await Bun.build({ entrypoints: [join(import.meta.dir, 'page.ts')], target: 'browser', format: 'esm' }).then(built => built.outputs[0]!.text())
  const isolated = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' }
  const docUrl = (i: number): string => `/doc?job=${id}&n=${i}&attempt=${attempt}`
  // Chrome's documents take up to 3.6 GB, near the 4 GB a harness job gets.
  await serveJob(browser, id, docUrl(0), { stallMs: 300_000, stalled: () => `at ${docs[n]?.id}`, foreground, boundMb: 6144 }, async (request, url, finish) => {
    if (url.searchParams.get('job') !== id && url.pathname !== '/favicon.ico') return new Response('Inactive job', { status: 409 })
    const d = docs[Number(url.searchParams.get('n'))]!
    switch (url.pathname) {
      case '/doc': return new Response(`<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><title>${foreground ? 'pretext bench' : windowTitle('pretext bench', browser)}</title>${watched(browser) ? '<style>html{background:#111}</style>' : ''}</head><body><script type="module" src="/page.js?job=${id}&n=0"></script></body></html>`, { headers: { ...isolated, 'content-type': 'text/html; charset=utf-8' } })
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
        // Scratch (rp3-whole-rich): what the page counted in each copy's lists.
        const counted = 'ops' in body.result! ? body.result.whole : undefined
        if (counted !== undefined) {
          console.log(`${browser}: ${d.id}: ${counted.map(w => `${w.label} ${w.paragraphs} paragraphs, ${w.widthFractions} of ${w.widths} widths not whole, ${w.otherFractions} of ${w.others} other numbers${w.example === '' ? '' : ` (${w.example})`}`).join('; ')}`)
        }
        const spaces = 'ops' in body.result! ? body.result.spaces : undefined
        if (spaces !== undefined) console.log(`${browser}: ${d.id}: a space is ${spaces.map(f => `${f.space}px in ${f.font}`).join(', ')}`)
        attempt = 0
        if (++n === docs.length) {
          finish(null)
          return Response.json({ next: null })
        }
        return Response.json({ next: docUrl(n) })
      }
      default: return new Response(null, { status: 404 })
    }
  })
  return results
}

// Every session of a run: each browser's `sessions` of every document, then, after two, the confirming one, of the
// documents whose rows read slower or faster (report.ts, unconfirmed): the floors are fitted to three sessions, so a
// verdict needs three; one session stays a hypothesis, and three or more need no other. A browser that fails a session
// sits out the rest, and the others' tables still print.
export async function runSessions(
  browsers: readonly BrowserKind[], sessions: number, plan: (seed: string) => Planned[],
  io: { time: (browser: BrowserKind, docs: Planned[]) => Promise<Map<string, DocResult>>; save: (entry: SessionResults) => void; log: (text: string) => void },
): Promise<{ all: SessionResults[]; failed: Map<BrowserKind, string> }> {
  const all: SessionResults[] = []
  const failed = new Map<BrowserKind, string>()
  const run = async (browser: BrowserKind, s: number, only: readonly string[] | null): Promise<void> => {
    const seed = crypto.randomUUID()
    const docs = plan(seed).filter(d => only === null || only.includes(d.id))
    const started = Date.now()
    let results: Map<string, DocResult>
    try {
      results = await io.time(browser, docs)
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      failed.set(browser, `session ${s + 1}: ${why}`)
      io.log(`${browser} session ${s + 1} failed, so ${browser} sits out the rest: ${why}`)
      return
    }
    const entry: SessionResults = { browser, session: s, seed, docs: docs.map(d => ({ row: d.row, family: d.family, id: d.id })), results: Object.fromEntries(results) }
    io.save(entry)
    io.log(`${browser} session ${s + 1}${only === null ? '' : ', confirming the rows that read slower or faster'}: ${docs.length} documents in ${((Date.now() - started) / 1000).toFixed(0)} s, seed ${seed}`)
    all.push(entry)
  }
  for (let s = 0; s < sessions; s++) for (const browser of browsers) if (!failed.has(browser)) await run(browser, s, null)
  for (const browser of browsers) {
    const again = failed.has(browser) || sessions !== 2 ? [] : unconfirmed(all.filter(r => r.browser === browser))
    if (again.length > 0) await run(browser, sessions, again)
  }
  return { all, failed }
}

export async function bench(baseRef: string, lib: string, browsers: BrowserKind[], sessions: number, rows: readonly string[], background: boolean): Promise<void> {
  const before = power()
  if (!background && before.source === 'battery' && before.percent < 20) throw new Error(`On battery at ${before.percent}%: the Mac throttles; plug it in to time`)
  const behind = browsers.find(browser => !BROWSER[browser].foreground)
  if (!background && behind !== undefined) throw new Error(`${behind} runs in the background only: time its engine in a browser that runs in the foreground, or pass --background`)
  const built = { base: await benchBundle(srcOf(baseRef)), candidate: await benchBundle(srcOf(lib)) }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = resolve(import.meta.dir, '../../.artifacts/harness-bench', stamp)
  mkdirSync(dir, { recursive: true })
  console.log(`bench ${baseRef} against ${lib}, ${sessions} sessions in ${browsers.join(', ')}${background ? ', in the background (hypotheses)' : ', in the foreground'}; power ${before.source} ${before.percent}%, load ${load()}; samples in ${dir}`)
  const { all, failed } = await runSessions(browsers, sessions, seed => documents(rows, seed, !background), {
    time: (browser, docs) => session(browser, docs, { base: built.base.code, candidate: built.candidate.code }, !background),
    save: entry => writeFileSync(join(dir, `${entry.browser}-${entry.session}.json`), JSON.stringify(entry)),
    log: text => console.log(text),
  })
  const after = power()
  console.log(report(all, { builds: `base: ${buildName(baseRef)}; candidate: ${buildName(lib)}`, hypotheses: background, sizes: { base: built.base, candidate: built.candidate } }))
  console.log(`power ${after.source} ${after.percent}%, load ${load()}`)
  if (failed.size > 0) throw new Error(`bench: ${[...failed].map(([browser, why]) => `${browser} ${why}`).join('; ')}`)
}
