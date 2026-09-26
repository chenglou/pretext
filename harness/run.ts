// One job: a list of cases recorded or predicted in one browser. The server serves page.ts, bundled with the library
// build to predict with, and feeds the page chunks of cases. Cases are grouped into documents by page language and web
// fonts, in the order they come, and a document ends after `documentSize` cases, so the page reloads into a fresh one.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { environmentKey, FONTS_DIR, launch, type Session } from './browsers.ts'
import { firefoxTextEmoji } from './score.ts'
import type { BrowserKind, Case, PageEnv, Prediction, Recording } from './types.ts'

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
// Firefox changes fonts under a page for about 12 s after it starts (PLATFORM_BUGS.md, the late family names): emoji
// beside Arial laid out differently when recorded 11 s after launch than at 12, 15 or 30 s. So its first document is held
// until 15 s after launch, in every job, recording or predicting.
const FIREFOX_SETTLE_MS = 15_000

async function bundle(lib: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'page.ts')],
    target: 'browser',
    format: 'esm',
    plugins: [{
      name: 'library-build',
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/src\/(layout|rich-inline)\.ts$/ }, args => ({ path: join(lib, args.path.slice('../src/'.length)) }))
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
    const late = firefoxTextEmoji(browser, c)
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

function pageHtml(doc: Case[]): string {
  const c = doc[0]!
  const families = c.fontFixtures ?? []
  const fonts = FIXTURES.filter(fixture => families.includes(fixture.family)).map(fixture => ({ family: fixture.family, weight: fixture.weight, url: `/fonts/${fixture.file}` }))
  const lang = c.pageLang.replace(/[&"<>]/g, ch => `&#${ch.charCodeAt(0)};`)
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>pretext harness</title>`
    + '<style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>'
    + `<script id="fonts" type="application/json">${JSON.stringify(fonts)}</script><script type="module" src="/page.js"></script></body></html>`
}

// A server on the first free port from 3002 (`bun start` takes 3000), which another job may take between the check and
// the bind.
function serve(fetch: (request: Request) => Promise<Response>): ReturnType<typeof Bun.serve> {
  for (let port = 3002; port < 3100; port++) {
    if (Bun.spawnSync(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).exitCode === 0) continue
    try {
      // idleTimeout 0: Bun drops a request after 10 s without a response, and Firefox's first document is held longer.
      return Bun.serve({ hostname: '127.0.0.1', port, maxRequestBodySize: 1 << 30, idleTimeout: 0, fetch })
    } catch {
      // Taken meanwhile.
    }
  }
  throw new Error('No free port in 3002-3099')
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
  let lastActivity = Date.now()
  let finish: (error: Error | null) => void = () => {}
  const finished = new Promise<void>((done, fail) => { finish = error => (error === null ? done() : fail(error)) })
  const docUrl = (n: number): string => `/doc?job=${id}&n=${n}`

  const step = async (request: Request): Promise<Response> => {
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

  const server = serve(async request => {
    lastActivity = Date.now()
    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case '/doc': {
          const n = Number(url.searchParams.get('n'))
          if (url.searchParams.get('job') !== id || n !== doc) return new Response('Inactive document', { status: 409 })
          const wait = settled - Date.now()
          if (wait > 0) await Bun.sleep(wait)
          return new Response(pageHtml(docs[n]!), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
        }
        case '/page.js': return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } })
        case '/api/step': return await step(request)
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
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
      return new Response(String(error), { status: 500 })
    }
  })
  const base = `http://127.0.0.1:${server.port}`
  let session: Session | null = null
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > 120_000) finish(new Error(`${job.browser}: no page activity for 2 minutes (${results.size} of ${job.cases.length} cases done)`))
  }, 1000)
  const settled = Date.now() + (job.browser === 'firefox' ? FIREFOX_SETTLE_MS : 0)
  try {
    session = await launch(job.browser, base + docUrl(0), id, tabUrl => tabUrl.startsWith(`${base}/doc?job=${id}`))
    await finished
  } finally {
    clearInterval(watchdog)
    await session?.close()
    await server.stop(true)
  }
  return { env: environmentKey(job.browser, env!), results, ms: Date.now() - start }
}
