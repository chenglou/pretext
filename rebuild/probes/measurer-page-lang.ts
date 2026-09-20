// `<html lang>` changing while a measurer lives (research/PROFILING-START.md, item 1, "Staleness"; a review's check of
// src/measure/font-checks.ts Measurer, whose comment says the document's language can't make a kept context stale because
// every context gets an explicit `ctx.lang`). measure/canvas.ts contextFor assigns `lang` and then `font` once, when the
// context is made, and a measurer keeps the context for the page's life. What this probe asks of each browser's
// OffscreenCanvas:
// - G1: whether a context with an explicit `lang` ('' included, which is what a block with lang="" gets) measures a
//   string it had measured, and one it hadn't, as before once `<html lang>` has changed;
// - G2: whether a context made after the change with the same assignments measures what the old one does. A difference
//   is a width a page's measurer gets and a measurer a call doesn't;
// - G3, the control: a context whose `lang` was never assigned, made before and after, which shows whether the page
//   language moves these widths at all in this browser.
// One script observation; raw widths only. `serif` at 32px: Chrome resolves a generic family by language, so Latin text
// under `ja` is another font's (probes/blink-probes.ts canvas H13).
//
// Verdicts, 2026-09-19, pinned Chrome 153.0.8010.50, pinned Firefox 156.0 and webkit-host (.artifacts/probes/measurer/
// page-lang), `<html lang>` from en to ja, `Hello, world` 161.31px under en and 187.01px under ja in Chrome:
// - G1, G2: in all three browsers every old context measures what a context made after the change measures, for the
//   strings it had measured and the ones it hadn't, under every `lang` tried ('', en, ja, zh-CN, sr). So the document's
//   language gives a page's measurer nothing a measurer a call doesn't get.
// - Chrome: no context with an assigned `lang` moves, '' included, which measures as en does here.
// - Firefox: a context whose `lang` is '' follows `<html lang>` on every call (161.73px, then 186.97px), exactly as one
//   never assigned does; an old one and a new one agree because both follow the document. Gecko's port gives a context
//   '' for content with lang="" when the process languages are unknown (engines/gecko/prepare.ts `canvasLang`).
// - webkit-host: the context has no `lang` attribute and nothing moves, the control included.
// - G3: the control moves in Chrome for a new context only (the old one keeps en, blink-canvas H13) and in Firefox for both.
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py measurer-page-lang -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/measurer-page-lang.ts --out=.artifacts/probes/measurer/page-lang
import type { Probe } from './types.ts'

const SOURCE = `
  const root = document.documentElement
  const font = '32px serif'
  const seen = ['Hello, world', '直次今骨、。「」', 'Привет, мир']
  const unseen = ['Hello, world again', '直次今骨、。「」直', 'Привет, мир опять']
  const langs = ['', 'en', 'ja', 'zh-CN', 'sr']
  const make = lang => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    if (lang !== null) c.lang = lang
    c.font = font
    return c
  }
  const widths = (c, texts) => texts.map(text => c.measureText(text).width)
  const out = { pageLangBefore: root.lang, langAttribute: 'lang' in make(null), contexts: [] }
  const old = langs.map(make)
  const oldInherit = make(null)
  const before = old.map(c => widths(c, seen))
  const beforeInherit = widths(oldInherit, seen)
  root.setAttribute('lang', 'ja')
  const wait = () => new Promise(done => { const channel = new MessageChannel(); channel.port1.onmessage = () => done(null); channel.port2.postMessage(null) })
  await wait()
  for (let i = 0; i < langs.length; i++) {
    const fresh = make(langs[i])
    out.contexts.push({
      lang: langs[i], before: before[i], oldAfterSeen: widths(old[i], seen), oldAfterUnseen: widths(old[i], unseen),
      freshAfterSeen: widths(fresh, seen), freshAfterUnseen: widths(fresh, unseen),
    })
  }
  const freshInherit = make(null)
  out.inherit = { before: beforeInherit, oldAfterSeen: widths(oldInherit, seen), oldAfterUnseen: widths(oldInherit, unseen), freshAfterSeen: widths(freshInherit, seen), freshAfterUnseen: widths(freshInherit, unseen) }
  out.pageLangAfter = root.lang
  root.setAttribute('lang', out.pageLangBefore)
  return out
`

const probes: Probe[] = [{
  id: 'measurer-page-lang',
  spec: 'PROFILING-START item 1, staleness: the document language',
  pageLang: 'en',
  browsers: ['chrome', 'safari', 'firefox'],
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: SOURCE }],
  note: 'Widths at 32px serif on OffscreenCanvas contexts with an explicit lang made before <html lang> went from en to ja, and on ones made after.',
}]

export default probes
