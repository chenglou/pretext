import { clearCache, layoutWithLines, prepareWithSegments } from '../src/layout.js'
import { publishNavigationPhase, publishNavigationReport } from './report-utils.ts'
import { createBrowserEnvironmentGuard, type BrowserEnvironmentReport } from '../shared/browser-environment.ts'

type FontCase = { label: string, text: string, font: string, width: number, lang: string }
type Prefix = { end: number, dom: number, canvas: number, isolated: number, domInContext: number, canvasLookahead: number }
type WidthProbe = { width: number, dom: number[], pretext: number[], prefixReset: number[], lookahead: number[] }
type FontRow = FontCase & {
  loadedFaces: number
  computedFont: string
  prefixes: Prefix[]
  domLines: string[]
  pretextLines: string[]
  canvasLines: string[]
  domWidth: number
  canvasWidth: number
  isolatedWidth: number
  canvasFont: string
  languageCanvasWidth: number
  widths: WidthProbe[]
}
export type FontProbeReport = { requestId: string } & (
  | { status: 'ready', environment: BrowserEnvironmentReport, rows: FontRow[] }
  | { status: 'error', message: string, environment?: BrowserEnvironmentReport }
)

const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? ''
const reportEndpoint = params.get('reportEndpoint')
const status = document.querySelector<HTMLParagraphElement>('#status')!
const cases: FontCase[] = [
  { label: 'Shantell bold #195', text: 'x'.repeat(56), font: 'bold 15px "Shantell Sans", cursive', width: 140, lang: 'en' },
  { label: 'Shantell regular control', text: 'x'.repeat(56), font: '15px "Shantell Sans", cursive', width: 140, lang: 'en' },
  { label: 'Arial bold control', text: 'x'.repeat(56), font: 'bold 15px Arial', width: 140, lang: 'en' },
  { label: 'Generic serif English', text: 'foo-bar日本語', font: '18px serif', width: 110, lang: 'en' },
  { label: 'Generic serif Japanese', text: 'foo-bar日本語', font: '18px serif', width: 110, lang: 'ja' },
  { label: 'Named serif Japanese', text: 'foo-bar日本語', font: '18px "Times New Roman"', width: 110, lang: 'ja' },
]
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function styleText(element: HTMLElement, test: FontCase): void {
  element.lang = test.lang
  Object.assign(element.style, { font: test.font, lineHeight: '18px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', lineBreak: 'auto', width: `${test.width}px` })
  element.textContent = test.text
}

// Range reads preserve one native text node; per-grapheme span probes would
// change contextual shaping and invalidate this particular experiment.
function readDomLines(element: HTMLElement, text: string, ends: number[]): string[] {
  const node = element.firstChild!
  const range = document.createRange()
  const lines: string[] = []
  let top = Number.NaN
  let start = 0
  for (const end of ends) {
    range.setStart(node, start)
    range.setEnd(node, end)
    // WebKit can include a zero-width rectangle on the preceding line.
    const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0)!
    const segment = text.slice(start, end)
    if (Math.abs(rect.top - top) > 1 || Number.isNaN(top)) {
      top = rect.top
      lines.push(segment)
    } else lines[lines.length - 1] += segment
    start = end
  }
  return lines
}

// Each new line is measured from its own start. Subtracting two paragraph
// prefixes retains context across the very boundary being investigated.
function prefixLines(text: string, ends: number[], ctx: OffscreenCanvasRenderingContext2D, width: number): string[] {
  const lines: string[] = []
  let start = 0
  let end = 0
  for (const next of ends) {
    if (ctx.measureText(text.slice(start, next)).width > width && end > start) {
      lines.push(text.slice(start, end))
      start = end
    }
    end = next
  }
  lines.push(text.slice(start))
  return lines
}

// Diagnostic only: preserve each grapheme's following-character context.
// This models the repeated-x fit thresholds, not arbitrary shaping or paint width.
function lookaheadLines(prefixes: Prefix[], width: number): number[] {
  const lengths: number[] = []
  let previous = 0
  let count = 0
  let lineWidth = 0
  for (const prefix of prefixes) {
    const advance = prefix.canvasLookahead - previous
    previous = prefix.canvasLookahead
    if (count > 0 && lineWidth + advance > width + 0.005) {
      lengths.push(count)
      count = 0
      lineWidth = 0
    }
    count++
    lineWidth += advance
  }
  lengths.push(count)
  return lengths
}

async function probe(test: FontCase, guard: ReturnType<typeof createBrowserEnvironmentGuard>): Promise<FontRow> {
  const faces = await document.fonts.load(test.font, test.text)
  guard.assertStable()
  if (test.font.includes('Shantell') && faces.length === 0) throw new Error('The requested Shantell Sans face was not loaded; fallback results are invalid.')
  const sample = document.createElement('div')
  styleText(sample, test)
  sample.className = 'sample'
  document.querySelector('#samples')!.append(sample)
  const measure = document.createElement('span')
  styleText(measure, test)
  Object.assign(measure.style, { position: 'absolute', whiteSpace: 'pre', width: 'max-content' })
  document.body.append(measure)
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.font = test.font
  const canvas = document.createElement('canvas')
  canvas.lang = test.lang
  const languageCtx = canvas.getContext('2d')!
  languageCtx.font = test.font
  const ends = Array.from(segmenter.segment(test.text), ({ segment, index }) => index + segment.length)
  const prefixes: Prefix[] = []
  let isolated = 0
  for (let i = 0; i < ends.length; i++) {
    const end = ends[i]!
    const segment = test.text.slice(ends[i - 1] ?? 0, end)
    isolated += ctx.measureText(segment).width
    measure.textContent = test.text.slice(0, end)
    const dom = measure.getBoundingClientRect().width
    measure.textContent = test.text
    const prefixRange = document.createRange()
    prefixRange.setStart(measure.firstChild!, 0)
    prefixRange.setEnd(measure.firstChild!, end)
    const nextEnd = ends[i + 1] ?? end
    const next = test.text.slice(end, nextEnd)
    const canvasLookahead = ctx.measureText(test.text.slice(0, nextEnd)).width - ctx.measureText(next).width
    prefixes.push({ end, dom, canvas: ctx.measureText(test.text.slice(0, end)).width, isolated, domInContext: prefixRange.getBoundingClientRect().width, canvasLookahead })
  }
  const canvasLines = prefixLines(test.text, ends, ctx, test.width)
  const domLines = readDomLines(sample, test.text, ends)
  clearCache()
  const prepared = prepareWithSegments(test.text, test.font, { whiteSpace: 'pre-wrap' })
  const pretext = layoutWithLines(prepared, test.width, 18)
  const widths: WidthProbe[] = []
  if (/^x+$/.test(test.text)) {
    for (const prefix of prefixes.slice(4, 20)) {
      for (const delta of [-0.02, 0.02, 0.2]) {
        const width = prefix.canvas + delta
        sample.style.width = `${width}px`
        widths.push({ width, dom: readDomLines(sample, test.text, ends).map(line => line.length),
          pretext: layoutWithLines(prepared, width, 18).lines.map(line => line.text.length),
          prefixReset: prefixLines(test.text, ends, ctx, width).map(line => line.length),
          lookahead: lookaheadLines(prefixes, width) })
      }
    }
    sample.style.width = `${test.width}px`
  }
  const last = prefixes[prefixes.length - 1]!
  const row: FontRow = { ...test, loadedFaces: faces.length, computedFont: getComputedStyle(sample).font, prefixes, domLines, pretextLines: pretext.lines.map(line => line.text), canvasLines, domWidth: last.dom, canvasWidth: last.canvas, isolatedWidth: isolated, canvasFont: ctx.font, languageCanvasWidth: languageCtx.measureText(test.text).width, widths }
  measure.remove()
  return row
}

async function publish(report: FontProbeReport): Promise<void> {
  document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2)
  if (reportEndpoint !== null) {
    publishNavigationPhase('posting', requestId)
    const response = await fetch(reportEndpoint, { method: 'POST', body: JSON.stringify(report) })
    if (!response.ok) throw new Error(`Report POST failed: ${response.status}`)
    publishNavigationReport({ status: report.status, requestId })
  } else publishNavigationReport(report)
}

let environmentGuard: ReturnType<typeof createBrowserEnvironmentGuard> | undefined
try {
  publishNavigationPhase('loading', requestId)
  await Promise.all(cases.map(test => document.fonts.load(test.font, test.text)))
  await document.fonts.ready
  environmentGuard = createBrowserEnvironmentGuard('correctness')
  environmentGuard.assertStable()
  publishNavigationPhase('measuring', requestId)
  const rows: FontRow[] = []
  for (const test of cases) {
    const row = await probe(test, environmentGuard)
    environmentGuard.assertStable()
    rows.push(row)
    const tr = document.createElement('tr')
    for (const value of [row.label, `${row.domLines.map(line => line.length).join('/')} · ${row.pretextLines.map(line => line.length).join('/')}`, `${row.domWidth.toFixed(2)} / ${row.canvasWidth.toFixed(2)}`, row.isolatedWidth.toFixed(2)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td)
    }
    document.querySelector('#rows')!.append(tr)
  }
  status.textContent = `${rows.length} cases measured. Boundary probes compare isolated prefixes, paragraph-context advances and native lines. These are diagnostics for repeated-x runs, not a word-breaking implementation.`
  environmentGuard.assertStable()
  await publish({ status: 'ready', requestId, environment: environmentGuard.report(), rows })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  status.textContent = message
  await publish({ status: 'error', requestId, message, ...(environmentGuard === undefined ? {} : { environment: environmentGuard.report() }) })
} finally {
  environmentGuard?.dispose()
}
