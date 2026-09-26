// The browser side of a job. run.ts serves this bundle in a document whose <html lang> is the page language of the cases
// it will get, with the web fonts they need listed in #fonts. The page loads those fonts, then asks the server for chunks
// of cases, records or predicts each one, and posts the results back with the next request. Only fetches drive the loop,
// so a background window's timer throttling can't stall it.
import { recordCase } from './observe.ts'
import { predict } from './predict.ts'
import type { BrowserKind, Case, PageEnv, Prediction, Recording } from './types.ts'

type Reply =
  | { kind: 'chunk'; mode: 'record' | 'predict'; browser: BrowserKind; cases: Case[] }
  | { kind: 'navigate'; url: string }
  | { kind: 'done' }

const job = new URLSearchParams(location.search).get('job') ?? ''

async function post(body: unknown): Promise<Reply> {
  const response = await fetch('/api/step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`/api/step: ${response.status} ${await response.text()}`)
  return await response.json() as Reply
}

async function main(): Promise<void> {
  const fonts = JSON.parse(document.getElementById('fonts')!.textContent!) as Array<{ family: string; weight: string; url: string }>
  for (let i = 0; i < fonts.length; i++) {
    const face = new FontFace(fonts[i]!.family, `url(${fonts[i]!.url})`, { weight: fonts[i]!.weight })
    document.fonts.add(await face.load())
  }
  await document.fonts.ready
  const env: PageEnv = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, languages: [...navigator.languages] }
  const range = document.createRange()
  let reply = await post({ job, env, results: null })
  for (;;) {
    switch (reply.kind) {
      case 'done':
        document.title = 'harness done'
        return
      case 'navigate':
        location.replace(reply.url)
        return
      case 'chunk': {
        const results: Array<Recording | Prediction> = []
        for (let i = 0; i < reply.cases.length; i++) {
          const c = reply.cases[i]!
          if (c.pageLang !== document.documentElement.lang) throw new Error(`Case ${c.id} needs <html lang="${c.pageLang}">`)
          results.push(reply.mode === 'record' ? recordCase(c, range, reply.browser) : predict(c))
        }
        reply = await post({ job, env, results })
      }
    }
  }
}

main().catch((error: unknown) => {
  document.title = 'harness failed'
  void fetch('/api/fatal', { method: 'POST', body: JSON.stringify({ job, message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) }) })
})
