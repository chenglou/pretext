// Browser side of the lab. run.ts serves this bundle at /page.js inside a document whose <html lang> is the
// chunk's pageLang, with the chunk's fixture web fonts listed in #lab-fonts. The page loads those fonts, asks the
// server for chunks, observes each case natively, runs the prediction hook and the observation port over its layout,
// observes the painted lines, and posts the rows back before asking for the next chunk.
//
// Only fetch promises drive the loop (no timers), so background-window timer throttling doesn't stall it.
import type { CanvasMeasure, ExpectedObservation, ParagraphLayout } from '../src/model.ts'
import { parseFontFamilyList } from './cases/font.ts'
import { observeBlink } from './observe/blink.ts'
import { observeGecko } from './observe/gecko.ts'
import { observeWebKit } from './observe/webkit.ts'
import { paint, predict } from './predictor.ts'
import type {
  BrowserKind, Case, CodePointObservation, FontDecl, LabRow, LayoutPrediction, LinesPrediction, NativeObservation, PageEnv,
  PainterLine, PainterObservation, Paragraph, Rect, RecordedLayout,
} from './types.ts'

type PageRow = Omit<LabRow, 'family' | 'browser' | 'build' | 'case'>
type StepReply =
  // build: the engine build the driver read from the app bundle, given to the library as GivenFacts.build.
  | { kind: 'chunk'; seq: number; browser: BrowserKind; build: string; cases: Case[] }
  | { kind: 'navigate'; lang: string; fonts: string[] }
  | { kind: 'done' }

const runId = new URLSearchParams(location.search).get('run') ?? ''
let fontFixtures: string[] = []
// This document's history: how many cases it observed and the last one's id. WebKit reuses content-keyed caches across
// cases, so a case can lay out differently after another one (lab README "Page-history dependence").
let casesObserved = 0
let previousCaseId: string | null = null

// A named family resolves when a probe string measures differently from at least one of two generic fallbacks. This
// catches fonts that aren't installed, that Safari hides from web content, and fixtures that didn't load; it can't tell
// a family apart from a fallback it's metrically identical to in both cases.
const FONT_PROBE = 'mmmmmmmmmmlli1WQ@&% 永文字ひらがなカタカナ 한글 العربية עברית ไทย देवनागरी'
const fontResolves = new Map<string, boolean>()
let probeContext: CanvasRenderingContext2D | null = null

function resolves(name: string): boolean {
  let known = fontResolves.get(name)
  if (known === undefined) {
    probeContext ??= document.createElement('canvas').getContext('2d')
    if (probeContext === null) throw new Error('No 2d canvas context for the font probe')
    known = false
    const fallbacks = ['monospace', 'serif']
    for (let i = 0; i < fallbacks.length; i++) {
      probeContext.font = `64px ${fallbacks[i]}`
      const base = probeContext.measureText(FONT_PROBE).width
      probeContext.font = `64px "${name}", ${fallbacks[i]}`
      if (probeContext.measureText(FONT_PROBE).width !== base) known = true
    }
    fontResolves.set(name, known)
  }
  return known
}

function missingFonts(p: Paragraph): string[] {
  const missing = new Set<string>()
  const lists = new Set([p.font.family, ...p.runs.map(run => run.font.family)])
  for (const list of lists) {
    const names = parseFontFamilyList(list)
    for (let i = 0; i < names.length; i++) if (!names[i]!.generic && !resolves(names[i]!.name)) missing.add(names[i]!.name)
  }
  return [...missing].sort()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return await response.json() as T
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
}

function reportFatal(error: unknown): void {
  document.title = 'lab failed'
  void fetch('/api/fatal', { method: 'POST', body: JSON.stringify({ runId, message: message(error) }) })
}

// Loads the fixture web fonts before anything measures; returns their families, sorted.
async function loadFontFixtures(): Promise<string[]> {
  const fixtures = JSON.parse(document.getElementById('lab-fonts')?.textContent ?? '[]') as Array<{ family: string; weight: string; url: string }>
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!
    const response = await fetch(fixture.url)
    if (!response.ok) throw new Error(`Font ${fixture.family}: HTTP ${response.status}`)
    const face = new FontFace(fixture.family, await response.arrayBuffer(), { weight: fixture.weight })
    await face.load()
    document.fonts.add(face)
  }
  return [...new Set(fixtures.map(fixture => fixture.family))].sort()
}

function readEnv(): PageEnv {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport === null ? null : window.visualViewport.scale,
    pageLang: document.documentElement.lang,
    fontFixtures,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    documentCaseIndex: casesObserved,
    previousCaseId,
  }
}

function relative(rect: DOMRect, origin: DOMRect): Rect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }
}

function pushRects(list: DOMRectList, origin: DOMRect, into: Rect[]): void {
  for (let i = 0; i < list.length; i++) into.push(relative(list[i]!, origin))
}

function setFont(style: CSSStyleDeclaration, font: FontDecl): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

// The paragraph and its runs, with the run text inserted exactly as given. nodes[i] is run i's text node.
function buildParagraph(p: Paragraph): { element: HTMLDivElement; nodes: Text[]; rejectedStyles: string[] } {
  const element = document.createElement('div')
  const s = element.style
  s.position = 'absolute'
  s.left = '0'
  s.top = '0'
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.boxSizing = 'content-box'
  s.width = `${p.width}px`
  setFont(s, p.font)
  s.letterSpacing = `${p.letterSpacing}px`
  s.wordSpacing = `${p.wordSpacing}px`
  s.lineHeight = `${p.lineHeight}px`
  s.textAlign = 'start'
  s.textIndent = '0'
  s.textTransform = 'none'
  s.hyphens = 'manual'
  const keywords: Array<[string, string]> = [
    ['white-space', p.whiteSpace], ['word-break', p.wordBreak], ['overflow-wrap', p.overflowWrap],
    ['line-break', p.lineBreak], ['tab-size', String(p.tabSize)], ['direction', p.direction],
  ]
  const rejectedStyles: string[] = []
  for (let i = 0; i < keywords.length; i++) {
    const [property, value] = keywords[i]!
    s.setProperty(property, value)
    if (s.getPropertyValue(property) === '') rejectedStyles.push(`${property}: ${value}`)
  }
  element.lang = p.lang
  const nodes: Text[] = []
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    const text = document.createTextNode(run.text)
    nodes.push(text)
    if (run.node === 'text') {
      element.append(text)
      continue
    }
    const span = document.createElement('span')
    setFont(span.style, run.font)
    span.style.letterSpacing = `${run.letterSpacing}px`
    span.style.wordSpacing = `${run.wordSpacing}px`
    if (run.lang !== null) span.lang = run.lang
    if (run.text.length > 0) span.append(text)
    element.append(span)
  }
  return { element, nodes, rejectedStyles }
}

async function observeNative(c: Case, range: Range): Promise<NativeObservation> {
  const p = c.paragraph
  const { element, nodes, rejectedStyles } = buildParagraph(p)
  document.body.append(element)
  try {
    element.getBoundingClientRect()
    const fontsStatusBefore = document.fonts.status
    await document.fonts.ready
    const fontsStatusAfter = document.fonts.status
    const origin = element.getBoundingClientRect()
    const points: CodePointObservation[] = []
    let base = 0
    for (let r = 0; r < p.runs.length; r++) {
      const text = p.runs[r]!.text
      const node = nodes[r]!
      for (let i = 0; i < text.length;) {
        const length = text.codePointAt(i)! > 0xffff ? 2 : 1
        range.setStart(node, i)
        range.setEnd(node, i + length)
        const rects: Rect[] = []
        pushRects(range.getClientRects(), origin, rects)
        points.push({ offset: base + i, length, rects })
        i += length
      }
      base += text.length
    }
    const runRects: Rect[][] = []
    for (let r = 0; r < p.runs.length; r++) {
      const rects: Rect[] = []
      if (p.runs[r]!.text.length > 0) {
        range.selectNodeContents(nodes[r]!)
        pushRects(range.getClientRects(), origin, rects)
      }
      runRects.push(rects)
    }
    return { fontsStatusBefore, fontsStatusAfter, rejectedStyles, height: origin.height, width: origin.width, points, runRects, missingFonts: missingFonts(p) }
  } finally {
    element.remove()
  }
}

// The Canvas the observation ports measure with, live: one OffscreenCanvas per distinct settings, set up in the order the
// library's measure/canvas.ts uses (lang before font). Only the WebKit port measures (research/observe-webkit.md §7).
type ContextWithLang = OffscreenCanvasRenderingContext2D & { lang: string }
const portContexts = new Map<string, ContextWithLang>()
const measureLive: CanvasMeasure = (settings, text) => {
  const key = JSON.stringify(settings)
  let ctx = portContexts.get(key)
  if (ctx === undefined) {
    const created = new OffscreenCanvas(1, 1).getContext('2d') as ContextWithLang | null
    if (created === null) throw new Error('OffscreenCanvas has no 2d context')
    created.lang = settings.lang
    created.font = settings.font
    created.letterSpacing = settings.letterSpacing
    created.wordSpacing = settings.wordSpacing
    created.fontKerning = settings.fontKerning
    created.textRendering = settings.textRendering
    created.direction = settings.direction
    portContexts.set(key, created)
    ctx = created
  }
  return ctx.measureText(text).width
}

// What the browser will report for the layout, by the engine's own geometry code (DESIGN.md §9).
function observeLayout(prediction: LayoutPrediction): ExpectedObservation {
  const layout = prediction.layout
  switch (layout.engine) {
    case 'blink': return observeBlink(prediction.paragraph, layout, measureLive)
    case 'webkit': return observeWebKit(prediction.paragraph, layout, measureLive)
    case 'gecko': return observeGecko(prediction.paragraph, layout, measureLive)
  }
}

// The layout without its Canvas call log, which the row counts instead.
function recordedLayout(layout: ParagraphLayout): RecordedLayout {
  switch (layout.engine) {
    case 'blink': return { engine: layout.engine, env: layout.env, lines: layout.lines, gaps: layout.gaps }
    case 'webkit': return { engine: layout.engine, env: layout.env, lines: layout.lines, gaps: layout.gaps }
    case 'gecko': return { engine: layout.engine, env: layout.env, lines: layout.lines, gaps: layout.gaps }
  }
}

function observePainter(c: Case, prediction: LayoutPrediction, range: Range, timings: PageRow['timings']): PainterObservation | { error: string } | null {
  const host = document.createElement('div')
  const s = host.style
  s.position = 'absolute'
  s.left = '0'
  s.top = '0'
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.width = `${c.paragraph.width}px`
  document.body.append(host)
  try {
    let start = performance.now()
    let elements: HTMLElement[] | null
    try {
      elements = paint(c, prediction, host)
    } catch (error) {
      return { error: message(error) }
    } finally {
      timings.paintMs = performance.now() - start
    }
    if (elements === null) return null
    start = performance.now()
    host.append(...elements)
    const origin = host.getBoundingClientRect()
    const lines: PainterLine[] = []
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]!
      const box = relative(element.getBoundingClientRect(), origin)
      const rects: Rect[] = []
      const points: CodePointObservation[] = []
      let text = ''
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        range.selectNodeContents(node)
        pushRects(range.getClientRects(), origin, rects)
        const data = (node as Text).data
        for (let k = 0; k < data.length;) {
          const length = data.codePointAt(k)! > 0xffff ? 2 : 1
          range.setStart(node, k)
          range.setEnd(node, k + length)
          const own: Rect[] = []
          pushRects(range.getClientRects(), origin, own)
          points.push({ offset: text.length + k, length, rects: own })
          k += length
        }
        text += data
      }
      let extent: PainterLine['extent'] = null
      for (let k = 0; k < rects.length; k++) {
        const rect = rects[k]!
        if (rect.width <= 0 || rect.height <= 0) continue
        extent = extent === null
          ? { left: rect.x, right: rect.x + rect.width }
          : { left: Math.min(extent.left, rect.x), right: Math.max(extent.right, rect.x + rect.width) }
      }
      lines.push({ box, height: box.height, rects, extent, text, points })
    }
    timings.painterObserveMs = performance.now() - start
    return { lines }
  } finally {
    host.remove()
  }
}

async function observeCase(c: Case, browser: BrowserKind, build: string, range: Range): Promise<PageRow> {
  const timings = { nativeMs: 0, predictMs: 0, observeMs: 0, paintMs: 0, painterObserveMs: 0 }
  const env = readEnv()
  let start = performance.now()
  let native: PageRow['native']
  try {
    native = await observeNative(c, range)
  } catch (error) {
    native = { error: message(error) }
  }
  timings.nativeMs = performance.now() - start
  start = performance.now()
  // A predictor swapped in with run.ts --predictor may predict line ranges alone (baselines/main-predictor.ts).
  let hook: LayoutPrediction | LinesPrediction | { error: string }
  try {
    hook = predict(c, { browser, build })
  } catch (error) {
    hook = { error: message(error) }
  }
  timings.predictMs = performance.now() - start
  casesObserved++
  previousCaseId = c.id
  if (!('layout' in hook)) return { id: c.id, env, native, prediction: hook, painter: null, timings }
  start = performance.now()
  let observation: ExpectedObservation | { error: string }
  try {
    observation = observeLayout(hook)
  } catch (error) {
    observation = { error: message(error) }
  }
  timings.observeMs = performance.now() - start
  const log = hook.layout.measure
  const prediction: PageRow['prediction'] = { layout: recordedLayout(hook.layout), measure: { contexts: log.contexts.length, calls: log.calls.length, memoHits: log.memoHits }, observation }
  let painter: PageRow['painter']
  try {
    painter = observePainter(c, hook, range, timings)
  } catch (error) {
    painter = { error: message(error) }
  }
  return { id: c.id, env, native, prediction, painter, timings }
}

async function main(): Promise<void> {
  fontFixtures = await loadFontFixtures()
  await document.fonts.ready
  const range = document.createRange()
  const pageLang = document.documentElement.lang
  let reply = await post<StepReply>('/api/step', { runId, pageLang, fonts: fontFixtures, seq: null, rows: [] })
  while (true) {
    switch (reply.kind) {
      case 'done':
        document.title = 'lab done'
        return
      case 'navigate':
        location.replace(`/lab?run=${encodeURIComponent(runId)}&lang=${encodeURIComponent(reply.lang)}&fonts=${encodeURIComponent(reply.fonts.join('|'))}`)
        return
      case 'chunk': {
        const rows: PageRow[] = []
        for (let i = 0; i < reply.cases.length; i++) {
          const c = reply.cases[i]!
          if (c.pageLang !== pageLang) throw new Error(`Case ${c.id} needs <html lang="${c.pageLang}">; page has "${pageLang}"`)
          rows.push(await observeCase(c, reply.browser, reply.build, range))
        }
        reply = await post<StepReply>('/api/step', { runId, pageLang, fonts: fontFixtures, seq: reply.seq, rows })
      }
    }
  }
}

window.addEventListener('error', event => reportFatal(event.error ?? event.message))
window.addEventListener('unhandledrejection', event => reportFatal(event.reason))
main().catch(reportFatal)
