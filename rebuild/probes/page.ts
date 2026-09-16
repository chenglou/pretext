// Browser side of the probe runner. runner.ts serves this bundle at /page.js inside a document whose <html lang> is the
// current document's pageLang, with its fixture web fonts listed in #probe-doc. The page loads those fonts, asks the
// server for the document's probes, runs them one by one in the fixed host, posts the raw results, and reloads for the
// next document (the URL never changes, so the Safari session can always identify its tab).
//
// Only fetch promises drive the loop. Timers are used only as guards (probe, frame and worker timeouts).
import { CANVAS_PROPERTIES } from './types.ts'
import type {
  BoxObservation, CanvasMeasure, CanvasObservation, CanvasProperty, CanvasResult, EnvObservation, LinePoint, LinesObservation,
  Observation, ObservedLine, PageEnv, Probe, ProbeResult, RangeObservation, Rect,
} from './types.ts'

type DocInfo = { runId: string; doc: number; fixtures: Array<{ family: string; weight: string; url: string }> }
type StepReply =
  | { kind: 'probes'; seq: number; timeoutMs: number; probes: Probe[] }
  | { kind: 'reload' }
  | { kind: 'done' }

const info = JSON.parse(document.getElementById('probe-doc')?.textContent ?? '{}') as DocInfo
const host = document.getElementById('probe-host') as HTMLDivElement
const documentLang = document.documentElement.getAttribute('lang')

function message(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}`.trim() : String(error)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return await response.json() as T
}

function reportFatal(error: unknown): void {
  document.title = 'probes failed'
  void fetch('/api/fatal', { method: 'POST', body: JSON.stringify({ runId: info.runId, message: message(error) }) })
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function loadFontFixtures(): Promise<string[]> {
  for (let i = 0; i < info.fixtures.length; i++) {
    const fixture = info.fixtures[i]!
    const response = await fetch(fixture.url)
    if (!response.ok) throw new Error(`Font ${fixture.family}: HTTP ${response.status}`)
    const face = new FontFace(fixture.family, await response.arrayBuffer(), { weight: fixture.weight })
    await face.load()
    document.fonts.add(face)
  }
  return [...new Set(info.fixtures.map(fixture => fixture.family))].sort()
}

function readPageEnv(): PageEnv {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    visualViewportScale: window.visualViewport === null ? null : window.visualViewport.scale,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
  }
}

// ---- Geometry ----

function relative(rect: DOMRect, origin: DOMRect): Rect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }
}

function rectList(list: DOMRectList, origin: DOMRect): Rect[] {
  const rects: Rect[] = []
  for (let i = 0; i < list.length; i++) rects.push(relative(list[i]!, origin))
  return rects
}

function positive(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}

function target(element: Element | null, selector: string | undefined): Element {
  if (selector === undefined) {
    if (element === null) throw new Error('This observation needs the probe markup')
    return element
  }
  const found = host.querySelector(selector)
  if (found === null) throw new Error(`No element matches ${JSON.stringify(selector)}`)
  return found
}

function observeLines(element: Element | null, selector: string | undefined): LinesObservation {
  const node = target(element, selector)
  const origin = host.getBoundingClientRect()
  const range = document.createRange()
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let next = walker.nextNode(); next !== null; next = walker.nextNode()) texts.push(next as Text)
  const points: LinePoint[] = []
  const nodes: LinesObservation['nodes'] = []
  let base = 0
  for (let n = 0; n < texts.length; n++) {
    const text = texts[n]!
    const data = text.data
    for (let i = 0; i < data.length;) {
      const length = data.codePointAt(i)! > 0xffff ? 2 : 1
      range.setStart(text, i)
      range.setEnd(text, i + length)
      points.push({ offset: base + i, length, node: n, rects: rectList(range.getClientRects(), origin) })
      i += length
    }
    range.selectNodeContents(text)
    nodes.push({ offset: base, length: data.length, rects: rectList(range.getClientRects(), origin) })
    base += data.length
  }
  const content = node.textContent ?? ''
  const computedLineHeight = getComputedStyle(node).lineHeight
  let groupThreshold = computedLineHeight.endsWith('px') ? Number.parseFloat(computedLineHeight) / 2 : Number.NaN
  const lines: ObservedLine[] = []
  const multiLine: number[] = []
  const lineNear = (centre: number): ObservedLine | undefined => {
    for (let i = 0; i < lines.length; i++) if (Math.abs(lines[i]!.centre - centre) < groupThreshold) return lines[i]
    return undefined
  }
  for (let p = 0; p < points.length; p++) {
    const point = points[p]!
    let assigned: ObservedLine | undefined
    let otherLine = false
    for (let r = 0; r < point.rects.length; r++) {
      const rect = point.rects[r]!
      if (!positive(rect)) continue
      const centre = rect.y + rect.height / 2
      if (assigned === undefined) {
        if (!Number.isFinite(groupThreshold)) groupThreshold = rect.height / 2
        assigned = lineNear(centre)
        if (assigned === undefined) {
          assigned = { start: point.offset, end: point.offset + point.length, text: '', left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height, centre, visiblePoints: 0 }
          lines.push(assigned)
        }
        assigned.start = Math.min(assigned.start, point.offset)
        assigned.end = Math.max(assigned.end, point.offset + point.length)
        assigned.visiblePoints++
      } else if (Math.abs(assigned.centre - centre) >= groupThreshold) {
        otherLine = true
        continue
      }
      assigned.left = Math.min(assigned.left, rect.x)
      assigned.right = Math.max(assigned.right, rect.x + rect.width)
      assigned.top = Math.min(assigned.top, rect.y)
      assigned.bottom = Math.max(assigned.bottom, rect.y + rect.height)
    }
    if (otherLine) multiLine.push(point.offset)
  }
  lines.sort((a, b) => a.centre - b.centre)
  let interleaved = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    line.text = content.slice(line.start, line.end)
    for (let k = 0; k < i; k++) if (line.start < lines[k]!.end && lines[k]!.start < line.end) interleaved = true
  }
  return {
    kind: 'lines', selector: selector ?? null, text: content, box: relative(node.getBoundingClientRect(), origin), computedLineHeight,
    groupThreshold: Number.isFinite(groupThreshold) ? groupThreshold : 0, lines, lineStarts: lines.map(line => line.start), points, nodes, multiLine, interleaved,
  }
}

function observeBoxes(element: Element | null, selectors: string[] | undefined): BoxObservation {
  const origin = host.getBoundingClientRect()
  const describe = (node: Element): BoxObservation['boxes'][number]['matches'][number] => ({
    tag: node.tagName.toLowerCase(), rect: relative(node.getBoundingClientRect(), origin), clientRects: rectList(node.getClientRects(), origin),
  })
  if (selectors === undefined) return { kind: 'boxWidth', boxes: [{ selector: null, matches: [describe(target(element, undefined))] }] }
  return {
    kind: 'boxWidth',
    boxes: selectors.map(selector => ({ selector, matches: Array.from(host.querySelectorAll(selector), describe) })),
  }
}

function observeRange(element: Element | null, selector: string | undefined): RangeObservation {
  const node = target(element, selector)
  const origin = host.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(node)
  const rects = rectList(range.getClientRects(), origin)
  let extent: RangeObservation['extent'] = null
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!
    if (!positive(rect)) continue
    const left: number = extent === null ? rect.x : Math.min(extent.left, rect.x)
    const right: number = extent === null ? rect.x + rect.width : Math.max(extent.right, rect.x + rect.width)
    extent = { left, right, width: right - left }
  }
  return { kind: 'rangeWidth', selector: selector ?? null, text: node.textContent ?? '', rects, bounding: relative(range.getBoundingClientRect(), origin), extent }
}

// ---- Fonts ----

// A named family resolves when a probe string measures differently from at least one of two generic fallbacks. It can't
// tell a family apart from a fallback it's metrically identical to in both cases.
const FONT_PROBE = 'mmmmmmmmmmlli1WQ@&% 永文字ひらがなカタカナ 한글 العربية עברית ไทย देवनागरी'

function familyResolves(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (ctx === null) throw new Error('No 2d canvas context for the font probe')
  const fallbacks = ['monospace', 'serif']
  for (let i = 0; i < fallbacks.length; i++) {
    ctx.font = `64px ${fallbacks[i]}`
    const base = ctx.measureText(FONT_PROBE).width
    ctx.font = `64px "${family}", ${fallbacks[i]}`
    if (ctx.measureText(FONT_PROBE).width !== base) return true
  }
  return false
}

function observeEnv(families: string[] | undefined, fontFixtures: string[]): EnvObservation {
  const checks: EnvObservation['families'] = []
  const list = families ?? []
  for (let i = 0; i < list.length; i++) {
    let check: boolean | null
    try {
      check = document.fonts.check(`16px "${list[i]}"`)
    } catch {
      check = null
    }
    checks.push({ family: list[i]!, check, resolves: familyResolves(list[i]!) })
  }
  return {
    kind: 'env',
    ...readPageEnv(),
    pageLangAttribute: document.documentElement.getAttribute('lang'),
    navigatorLanguage: navigator.language,
    navigatorLanguages: [...navigator.languages],
    intlLocale: new Intl.DateTimeFormat().resolvedOptions().locale,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenWidth: screen.width,
    screenHeight: screen.height,
    fontsStatus: document.fonts.status,
    fontFixtures,
    families: checks,
    features: {
      offscreenCanvas: typeof OffscreenCanvas === 'function',
      contextLang: 'lang' in CanvasRenderingContext2D.prototype,
      contextLetterSpacing: 'letterSpacing' in CanvasRenderingContext2D.prototype,
      transferControlToOffscreen: 'transferControlToOffscreen' in HTMLCanvasElement.prototype,
      v8BreakIterator: typeof (Intl as unknown as { v8BreakIterator?: unknown }).v8BreakIterator === 'function',
    },
  }
}

// ---- Canvas ----

type Measured = Pick<CanvasResult, 'assignments' | 'readback' | 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>

// Self-contained: it's also stringified into the worker, so it may not reference anything outside itself.
function measureWith(ctx: Record<string, unknown> & { measureText: (text: string) => TextMetrics }, assignments: Array<[string, string]>, properties: readonly string[], text: string): Measured {
  const done: Array<{ property: string; value: string; error?: string }> = []
  for (let i = 0; i < assignments.length; i++) {
    const [property, value] = assignments[i]!
    try {
      ctx[property] = value
      done.push({ property, value })
    } catch (error) {
      done.push({ property, value, error: String(error) })
    }
  }
  const readback: Record<string, string | null> = {}
  for (let i = 0; i < properties.length; i++) {
    const value = ctx[properties[i]!]
    readback[properties[i]!] = typeof value === 'string' ? value : null
  }
  const metrics = ctx.measureText(text)
  return {
    assignments: done as Measured['assignments'],
    readback: readback as Measured['readback'],
    width: metrics.width,
    actualBoundingBoxLeft: typeof metrics.actualBoundingBoxLeft === 'number' ? metrics.actualBoundingBoxLeft : null,
    actualBoundingBoxRight: typeof metrics.actualBoundingBoxRight === 'number' ? metrics.actualBoundingBoxRight : null,
  }
}

// Self-contained worker entry, stringified with measureWith passed in.
function workerMain(measure: typeof measureWith): void {
  const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (message: unknown) => void; fonts?: FontFaceSet }
  const contexts = new Map<string, Record<string, unknown> & { measureText: (text: string) => TextMetrics }>()
  scope.onmessage = async (event: MessageEvent) => {
    const data = event.data as { id: number; type: string; [key: string]: unknown }
    try {
      if (data.type === 'fonts') {
        const fixtures = data['fixtures'] as Array<{ family: string; weight: string; url: string }>
        if (scope.fonts === undefined) throw new Error('No FontFaceSet in this worker')
        for (let i = 0; i < fixtures.length; i++) {
          const response = await fetch(fixtures[i]!.url)
          const face = new FontFace(fixtures[i]!.family, await response.arrayBuffer(), { weight: fixtures[i]!.weight })
          await face.load()
          scope.fonts.add(face)
        }
        scope.postMessage({ id: data.id, value: fixtures.length })
        return
      }
      const key = data['key'] as string
      let ctx = contexts.get(key)
      if (ctx === undefined) {
        const canvas = (data['canvas'] as OffscreenCanvas | undefined) ?? new OffscreenCanvas(1, 1)
        const created = canvas.getContext('2d')
        if (created === null) throw new Error('No 2d context in the worker')
        ctx = created as unknown as Record<string, unknown> & { measureText: (text: string) => TextMetrics }
        contexts.set(key, ctx)
      }
      scope.postMessage({ id: data.id, value: measure(ctx, data['assignments'] as Array<[string, string]>, data['properties'] as string[], data['text'] as string) })
    } catch (error) {
      scope.postMessage({ id: data.id, error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) })
    }
  }
}

type WorkerHandle = { request: (message: Record<string, unknown>, transfer: Transferable[]) => Promise<unknown>; terminate: () => void }

function startWorker(timeoutMs: number): WorkerHandle {
  const source = `(${workerMain.toString()})(${measureWith.toString()})`
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  URL.revokeObjectURL(url)
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let nextId = 0
  let failure: string | null = null
  worker.onmessage = event => {
    const data = event.data as { id: number; value?: unknown; error?: string }
    const request = pending.get(data.id)
    if (request === undefined) return
    pending.delete(data.id)
    if (data.error !== undefined) request.reject(new Error(data.error))
    else request.resolve(data.value)
  }
  worker.onerror = event => {
    event.preventDefault()
    failure = `Worker error: ${event.message}`
    for (const request of pending.values()) request.reject(new Error(failure))
    pending.clear()
  }
  return {
    request(message, transfer) {
      if (failure !== null) return Promise.reject(new Error(failure))
      const id = nextId++
      const promise = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
      worker.postMessage({ ...message, id }, transfer)
      return withTimeout(promise, timeoutMs, `Worker request ${String(message['type'])}`)
    },
    terminate() {
      worker.terminate()
      for (const request of pending.values()) request.reject(new Error('Worker terminated'))
      pending.clear()
    },
  }
}

type ProbeState = {
  probe: Probe
  timeoutMs: number
  contexts: Map<string, { kind: CanvasMeasure['kind']; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D }>
  workerContexts: Map<string, CanvasMeasure['kind']>
  worker: WorkerHandle | null
  errors: string[]
}

function assignmentsOf(entry: CanvasMeasure): Array<[CanvasProperty, string]> {
  const list: Array<[CanvasProperty, string]> = []
  const keys = Object.keys(entry)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as CanvasProperty
    if ((CANVAS_PROPERTIES as readonly string[]).includes(key)) list.push([key, entry[key]!])
  }
  return list
}

function createCanvasElement(entry: CanvasMeasure): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 10
  canvas.height = 10
  if (entry.elementLang !== undefined) canvas.setAttribute('lang', entry.elementLang)
  if (entry.elementStyle !== undefined) canvas.setAttribute('style', entry.elementStyle)
  host.append(canvas)
  return canvas
}

async function ensureWorker(state: ProbeState): Promise<WorkerHandle> {
  if (state.worker !== null) return state.worker
  const worker = startWorker(Math.min(10_000, state.timeoutMs))
  state.worker = worker
  if (info.fixtures.length > 0) {
    const fixtures = info.fixtures.map(fixture => ({ ...fixture, url: new URL(fixture.url, location.href).href }))
    try {
      await worker.request({ type: 'fonts', fixtures }, [])
    } catch (error) {
      state.errors.push(`Worker font fixtures: ${message(error)}`)
    }
  }
  return worker
}

async function measureEntry(state: ProbeState, entry: CanvasMeasure, index: number): Promise<CanvasResult> {
  const key = entry.context ?? `#entry-${index}`
  const result: CanvasResult = {
    index, kind: entry.kind, context: entry.context ?? null, text: entry.text, assignments: [],
    readback: Object.fromEntries(CANVAS_PROPERTIES.map(property => [property, null])) as CanvasResult['readback'],
    width: null, actualBoundingBoxLeft: null, actualBoundingBoxRight: null, pageLangAttribute: null,
  }
  try {
    if (entry.pageLang !== undefined) {
      if (entry.pageLang === null) document.documentElement.removeAttribute('lang')
      else document.documentElement.setAttribute('lang', entry.pageLang)
    }
    result.pageLangAttribute = document.documentElement.getAttribute('lang')
    const assignments = assignmentsOf(entry)
    if (entry.kind === 'offscreen' || entry.kind === 'element') {
      let known = state.contexts.get(key)
      if (known !== undefined && known.kind !== entry.kind) throw new Error(`Context ${key} is ${known.kind}, not ${entry.kind}`)
      if (known === undefined) {
        const ctx = entry.kind === 'offscreen' ? new OffscreenCanvas(1, 1).getContext('2d') : createCanvasElement(entry).getContext('2d')
        if (ctx === null) throw new Error('No 2d context')
        known = { kind: entry.kind, ctx }
        state.contexts.set(key, known)
      }
      const ctx = known.ctx
      if (entry.frames !== undefined) {
        result.frames = { requested: entry.frames, completed: 0 }
        for (let i = 0; i < entry.frames; i++) {
          await withTimeout(new Promise<void>(resolve => requestAnimationFrame(() => {
            ctx.fillRect(0, 0, 1, 1)
            resolve()
          })), 3_000, 'Animation frame')
          result.frames.completed++
        }
      }
      Object.assign(result, measureWith(ctx as unknown as Parameters<typeof measureWith>[0], assignments, CANVAS_PROPERTIES, entry.text))
      return result
    }
    const worker = await ensureWorker(state)
    const known = state.workerContexts.get(key)
    if (known !== undefined && known !== entry.kind) throw new Error(`Context ${key} is ${known}, not ${entry.kind}`)
    const transfer: Transferable[] = []
    const request: Record<string, unknown> = { type: 'measure', key, assignments, properties: CANVAS_PROPERTIES, text: entry.text }
    if (known === undefined && entry.kind === 'transferred') {
      const offscreen = createCanvasElement(entry).transferControlToOffscreen()
      request['canvas'] = offscreen
      transfer.push(offscreen)
    }
    state.workerContexts.set(key, entry.kind)
    Object.assign(result, await worker.request(request, transfer) as Measured)
  } catch (error) {
    result.error = message(error)
  }
  return result
}

async function observeCanvas(state: ProbeState): Promise<CanvasObservation> {
  const entries = state.probe.canvas ?? []
  const results: CanvasResult[] = []
  for (let i = 0; i < entries.length; i++) results.push(await measureEntry(state, entries[i]!, i))
  return { kind: 'canvasWidths', entries: results }
}

// ---- Probes ----

function runSource(source: string, element: Element | null): Promise<unknown> {
  const fn = new Function('host', 'element', `return (async () => {\n${source}\n})()`) as (host: HTMLElement, element: Element | null) => Promise<unknown>
  return fn(host, element)
}

async function runProbe(probe: Probe, timeoutMs: number, fontFixtures: string[]): Promise<ProbeResult> {
  const start = performance.now()
  const result: ProbeResult = { id: probe.id, fontsStatusBefore: '', fontsStatusAfter: '', observations: [], errors: [], ms: 0 }
  const state: ProbeState = { probe, timeoutMs, contexts: new Map(), workerContexts: new Map(), worker: null, errors: result.errors }
  const body = async (): Promise<void> => {
    host.replaceChildren()
    host.style.width = `${probe.hostWidth ?? 1000}px`
    let element: Element | null = null
    if (probe.html !== undefined) {
      host.innerHTML = probe.html
      if (host.childNodes.length !== 1 || host.firstElementChild === null) {
        throw new Error(`The markup must be exactly one element with no surrounding text; the host has ${host.childNodes.length} child nodes`)
      }
      element = host.firstElementChild
    }
    if (probe.setup !== undefined) await runSource(probe.setup, element)
    host.getBoundingClientRect()
    result.fontsStatusBefore = document.fonts.status
    await document.fonts.ready
    result.fontsStatusAfter = document.fonts.status
    for (let i = 0; i < probe.observe.length; i++) {
      const spec = probe.observe[i]!
      const kind = typeof spec === 'string' ? spec : spec.kind
      let observation: Observation
      try {
        switch (kind) {
          case 'lines': observation = observeLines(element, typeof spec === 'string' ? undefined : (spec as { selector?: string }).selector); break
          case 'boxWidth': observation = observeBoxes(element, typeof spec === 'string' ? undefined : (spec as { selectors: string[] }).selectors); break
          case 'rangeWidth': observation = observeRange(element, typeof spec === 'string' ? undefined : (spec as { selector?: string }).selector); break
          case 'canvasWidths': observation = await observeCanvas(state); break
          case 'env': observation = observeEnv(typeof spec === 'string' ? undefined : (spec as { families?: string[] }).families, fontFixtures); break
          case 'script': observation = { kind: 'script', value: JSON.parse(JSON.stringify(await runSource((spec as { source: string }).source, element) ?? null)) as unknown }; break
          default: throw new Error(`Unknown observation ${kind}`)
        }
      } catch (error) {
        observation = { kind, error: message(error) }
      }
      result.observations.push(observation)
    }
  }
  try {
    await withTimeout(body(), timeoutMs, `Probe ${probe.id}`)
  } catch (error) {
    result.errors.push(message(error))
  } finally {
    state.worker?.terminate()
    host.replaceChildren()
    if (documentLang === null) document.documentElement.removeAttribute('lang')
    else document.documentElement.setAttribute('lang', documentLang)
  }
  result.ms = performance.now() - start
  return { ...result, observations: [...result.observations], errors: [...result.errors] }
}

async function main(): Promise<void> {
  const fontFixtures = await loadFontFixtures()
  await document.fonts.ready
  let reply = await post<StepReply>('/api/step', { runId: info.runId, doc: info.doc, seq: null, env: readPageEnv(), results: [] })
  while (true) {
    switch (reply.kind) {
      case 'done':
        document.title = 'probes done'
        return
      case 'reload':
        location.reload()
        return
      case 'probes': {
        const results: ProbeResult[] = []
        for (let i = 0; i < reply.probes.length; i++) results.push(await runProbe(reply.probes[i]!, reply.timeoutMs, fontFixtures))
        reply = await post<StepReply>('/api/step', { runId: info.runId, doc: info.doc, seq: reply.seq, env: readPageEnv(), results })
      }
    }
  }
}

window.addEventListener('error', event => reportFatal(event.error ?? event.message))
window.addEventListener('unhandledrejection', event => reportFatal(event.reason))
main().catch(reportFatal)
