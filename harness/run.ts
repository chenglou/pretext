// One job: a list of cases recorded or predicted in one browser. The server serves the build's adapter (page.ts),
// bundled with its src/, and feeds the page chunks of cases. Cases are grouped into documents by page language and web
// fonts, in the order they come, and a document ends after `documentSize` cases, so the page reloads into a fresh one.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { environmentKey, FONTS_DIR, launch, type Session } from './browsers.ts'
import { lateTextEmoji } from './score.ts'
import { BROWSER, type BrowserKind, type Case, type PageEnv, type Prediction, type Recording } from './types.ts'

export type Mode = 'record' | 'predict'
export type Job = { browser: BrowserKind; mode: Mode; cases: Case[]; documentSize: number; lib: string }
export type JobResult<T> = { env: string; results: Map<string, T>; ms: number }

type FontFixture = { family: string; weight: string; file: string }
const FIXTURES = JSON.parse(readFileSync(join(FONTS_DIR, 'fonts.json'), 'utf8')) as FontFixture[]
// A chunk holds up to 25 cases and ends after the case that reaches 20,000 UTF-16 units, so a chunk of books still
// answers well within the stall watchdog.
const CHUNK = 25
const CHUNK_UNITS = 20_000
export const LIB = resolve(import.meta.dir, '../src')

// A build is a src/ and the adapter beside it, ../harness/page.ts, which predicts with it, so equal and --lib run whole
// builds. Either adapter's imports of the library go to that src/. A src/ with none beside it, such as a ref's from
// before the harness (#341), takes this tree's adapter, whose cursor map (predict.ts) needs src/graphemes.ts (#344).
export async function bundle(lib: string): Promise<string> {
  const own = join(lib, '../harness/page.ts')
  const built = await Bun.build({
    entrypoints: [existsSync(own) ? own : join(import.meta.dir, 'page.ts')],
    target: 'browser',
    format: 'esm',
    plugins: [{
      name: 'library-build',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/src\/[\w-]+\.ts$/ }, args => ({ path: join(lib, args.path.slice('../src/'.length)) }))
      },
    }],
  })
  if (!built.success) throw new Error(built.logs.map(String).join('\n'))
  return await built.outputs[0]!.text()
}

// Text above U+007E goes out escaped: a string parsed from JSON with any raw non-Latin-1 character is 16-bit even when
// it is ASCII, and WebKit and Blink have rules for 16-bit text only, so one CJK case would change every ASCII case in
// its chunk.
function asciiJson(value: unknown): Response {
  const body = JSON.stringify(value).replace(/[\u007f-\uffff]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

// Firefox's U+FE0E cases go in documents after every other (score.ts).
export function documents(browser: BrowserKind, cases: Case[], size: number): Case[][] {
  const groups = new Map<string, { late: boolean; cases: Case[] }>()
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!
    const late = lateTextEmoji(browser, c)
    const key = JSON.stringify([late, c.pageLang, [...(c.fontFixtures ?? [])].sort()])
    let group = groups.get(key)
    if (group === undefined) groups.set(key, group = { late, cases: [] })
    group.cases.push(c)
  }
  const docs: Case[][] = []
  const late: Case[][] = []
  for (const group of groups.values()) for (let i = 0; i < group.cases.length; i += size) (group.late ? late : docs).push(group.cases.slice(i, i + size))
  return docs.concat(late)
}

// A phone gets the page an app serves it, with a viewport meta tag and `text-size-adjust: 100%`. On a bare page iPhone
// Safari enlarges the text of a block wider than its viewport: it laid out 63 of the sample's 11,901 cases otherwise,
// all 736-864 px wide (a 14 px Roboto line 177.5 px wide came out 262 px wide), and was wrong on 0.58% of paragraphs
// inside what Pretext claims, against 0.29% (Safari 26.0.1 in the iOS 26.0 simulator, 2026-09-30).
function pageHtml(doc: Case[], phone: boolean): string {
  const c = doc[0]!
  const families = c.fontFixtures ?? []
  const fonts = FIXTURES.filter(fixture => families.includes(fixture.family)).map(fixture => ({ family: fixture.family, weight: fixture.weight, url: `/fonts/${fixture.file}` }))
  const lang = c.pageLang.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">${phone ? '<meta name="viewport" content="width=device-width,initial-scale=1">' : ''}<title>pretext harness</title>`
    + `<style>html,body{margin:0;padding:0;background:#fff;color:#000}${phone ? 'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}' : ''}</style></head><body>`
    + `<script id="fonts" type="application/json">${JSON.stringify(fonts)}</script><script type="module" src="/page.js"></script></body></html>`
}

// Serves one job to one browser, and returns once the job ends, with the browser and the server gone: a server on a port
// the OS assigns, the browser opened at `path` there, and a watchdog that ends the job after `stallMs` without a request,
// saying where it stood (`stalled`). `handle` answers the page and ends the job with `finish`; a handler that throws
// ends it with that error.
export async function serveJob(
  browser: BrowserKind,
  id: string,
  path: string,
  o: { stallMs: number; stalled: () => string; foreground?: boolean; boundMb?: number },
  handle: (request: Request, url: URL, finish: (error: Error | null) => void) => Promise<Response>,
): Promise<void> {
  let finish: (error: Error | null) => void = () => {}
  const finished = new Promise<void>((done, fail) => { finish = error => (error === null ? done() : fail(error)) })
  let lastActivity = Date.now()
  // idleTimeout 0: Bun drops a request after 10 s without a response, and Firefox's first document is held longer.
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, maxRequestBodySize: 1 << 30, idleTimeout: 0,
    async fetch(request) {
      lastActivity = Date.now()
      try {
        return await handle(request, new URL(request.url), finish)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return new Response(String(error), { status: 500 })
      }
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  let session: Session | null = null
  // The stall clock starts once the browser is open: a simulator takes a minute to boot before it opens the page.
  const watchdog = setInterval(() => {
    if (session !== null && Date.now() - lastActivity > o.stallMs) finish(new Error(`${browser}: no page activity for ${o.stallMs / 60_000} minutes, ${o.stalled()}`))
  }, 1000)
  try {
    session = await launch(browser, base + path, id, tabUrl => tabUrl.startsWith(`${base}/`), finish, o.foreground, o.boundMb)
    lastActivity = Date.now()
    await finished
  } finally {
    clearInterval(watchdog)
    await session?.close()
    await server.stop(true)
  }
}

export async function runJob<T extends Recording | Prediction>(job: Job): Promise<JobResult<T>> {
  const start = Date.now()
  const id = randomUUID()
  const docs = documents(job.browser, job.cases, job.documentSize)
  const results = new Map<string, T>()
  if (docs.length === 0) return { env: '', results, ms: 0 }
  const script = await bundle(job.lib)
  let env: PageEnv | null = null
  let doc = 0
  let next = 0
  let pending: { start: number; end: number } | null = null
  const docUrl = (n: number): string => `/doc?job=${id}&n=${n}`

  const step = async (request: Request, finish: (error: Error | null) => void): Promise<Response> => {
    const body = await request.json() as { job: string; env: PageEnv; results: T[] | null }
    if (body.job !== id) return new Response('Inactive job', { status: 409 })
    env ??= body.env
    if (JSON.stringify(env) !== JSON.stringify(body.env)) throw new Error(`The page's environment changed: ${JSON.stringify(env)} then ${JSON.stringify(body.env)}`)
    if (body.results !== null && pending !== null) {
      if (body.results.length !== pending.end - pending.start) throw new Error(`${body.results.length} results for ${pending.end - pending.start} cases`)
      for (let i = 0; i < body.results.length; i++) results.set(docs[doc]![pending.start + i]!.id, body.results[i]!)
      next = pending.end
      pending = null
    }
    if (pending === null && next >= docs[doc]!.length) {
      if (doc + 1 === docs.length) {
        finish(null)
        return Response.json({ kind: 'done' })
      }
      doc++
      next = 0
      return Response.json({ kind: 'navigate', url: docUrl(doc) })
    }
    // The next chunk; a page that loads again before answering gets the same one.
    if (pending === null) {
      const cases = docs[doc]!
      let end = next
      for (let units = 0; end < cases.length && end - next < CHUNK && units < CHUNK_UNITS; end++) {
        const runs = cases[end]!.paragraph.runs
        for (let r = 0; r < runs.length; r++) units += runs[r]!.text.length
      }
      pending = { start: next, end }
    }
    return asciiJson({ kind: 'chunk', mode: job.mode, browser: job.browser, cases: docs[doc]!.slice(pending.start, pending.end) })
  }

  const settled = Date.now() + BROWSER[job.browser].settleMs
  await serveJob(job.browser, id, docUrl(0), { stallMs: 120_000, stalled: () => `${results.size} of ${job.cases.length} cases done` }, async (request, url, finish) => {
    switch (url.pathname) {
      case '/doc': {
        const n = Number(url.searchParams.get('n'))
        if (url.searchParams.get('job') !== id || n !== doc) return new Response('Inactive document', { status: 409 })
        const wait = settled - Date.now()
        if (wait > 0) await Bun.sleep(wait)
        return new Response(pageHtml(docs[n]!, BROWSER[job.browser].phone), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      }
      case '/page.js': return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } })
      case '/api/step': return await step(request, finish)
      case '/api/fatal': {
        const body = await request.json() as { job: string; message: string }
        if (body.job === id) finish(new Error(`Page error: ${body.message}`))
        return new Response('ok')
      }
      case '/favicon.ico': return new Response(null, { status: 204 })
      default: {
        const fixture = FIXTURES.find(font => url.pathname === `/fonts/${font.file}`)
        return fixture === undefined ? new Response('Not found', { status: 404 }) : new Response(Bun.file(join(FONTS_DIR, fixture.file)))
      }
    }
  })
  return { env: environmentKey(job.browser, env!), results, ms: Date.now() - start }
}
