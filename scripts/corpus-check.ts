import { type ChildProcess } from 'node:child_process'
import type { BrowserEnvironmentReport } from '../shared/browser-environment.ts'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type BrowserKind,
  type BrowserSession,
} from './browser-automation.ts'

type CorpusMeta = {
  id: string
  language: string
  title: string
  min_width?: number
  max_width?: number
  default_width?: number
}

type CorpusOverrideOptions = {
  font: string | null
  lineHeight: number | null
  method: 'span' | 'range' | null
  sliceStart: number | null
  sliceEnd: number | null
}

type CorpusReport = {
  status: 'ready' | 'error'
  requestId?: string
  environment?: BrowserEnvironmentReport
  corpusId?: string
  sliceStart?: number | null
  sliceEnd?: number | null
  title?: string
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  browserLineMethod?: 'span-probe' | 'range'
  alternateBrowserLineMethod?: 'span-probe' | 'range'
  alternateBrowserLineCount?: number
  probeHeight?: number
  normalizedHeight?: number
  mismatchCount?: number
  firstMismatch?: {
    line: number
    ours: string
    browser: string
  } | null
  firstBreakMismatch?: {
    line: number
    oursStart: number
    browserStart: number
    oursEnd: number
    browserEnd: number
    oursText: string
    browserText: string
    oursRenderedText: string
    browserRenderedText: string
    oursContext: string
    browserContext: string
    deltaText: string
    reasonGuess: string
    oursSumWidth: number
    oursDomWidth: number
    oursFullWidth: number
    browserDomWidth: number
    browserFullWidth: number
    oursSegments: Array<{
      text: string
      width: number
      domWidth: number
      isSpace: boolean
    }>
  } | null
  alternateFirstBreakMismatch?: object | null
  extractorSensitivity?: string | null
  maxLineWidthDrift?: number
  maxDriftLine?: {
    line: number
    drift: number
    text: string
    sumWidth: number
    fullWidth: number
    domWidth: number
    pairAdjustedWidth: number
    segments: Array<{
      text: string
      width: number
      domWidth: number
      isSpace: boolean
    }>
  } | null
  message?: string
}

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for --${name}: ${raw}`)
  }
  return parsed
}

function parseBrowser(value: string | null): BrowserKind {
  const browser = (value ?? process.env['CORPUS_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
  if (browser !== 'chrome' && browser !== 'safari') {
    throw new Error(`Unsupported browser ${browser}; expected chrome or safari`)
  }
  return browser
}

function parseOptionalNumberFlag(name: string): number | null {
  const raw = parseStringFlag(name)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for --${name}: ${raw}`)
  }
  return parsed
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function loadSources(): Promise<CorpusMeta[]> {
  return await Bun.file('corpora/sources.json').json()
}

function getTargetWidths(meta: CorpusMeta): number[] {
  const widths = process.argv.slice(2)
    .filter(arg => !arg.startsWith('--'))
    .map(arg => Number.parseInt(arg, 10))
    .filter(width => Number.isFinite(width))

  if (widths.length > 0) return widths

  const min = meta.min_width ?? 300
  const max = meta.max_width ?? 900
  const preferred = [min, Math.max(min, Math.min(max, meta.default_width ?? 600)), max]
  return [...new Set(preferred)]
}

function appendOverrideParams(url: string, overrides: CorpusOverrideOptions): string {
  let nextUrl = url
  if (overrides.font !== null) {
    nextUrl += `&font=${encodeURIComponent(overrides.font)}`
  }
  if (overrides.lineHeight !== null) {
    nextUrl += `&lineHeight=${overrides.lineHeight}`
  }
  if (overrides.method !== null) {
    nextUrl += `&method=${encodeURIComponent(overrides.method)}`
  }
  if (overrides.sliceStart !== null) {
    nextUrl += `&sliceStart=${overrides.sliceStart}`
  }
  if (overrides.sliceEnd !== null) {
    nextUrl += `&sliceEnd=${overrides.sliceEnd}`
  }
  return nextUrl
}

function printReport(report: CorpusReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  const width = report.width ?? 0
  const diff = Math.round(report.diffPx ?? 0)
  const predicted = Math.round(report.predictedHeight ?? 0)
  const actual = Math.round(report.actualHeight ?? 0)
  const lines = report.predictedLineCount !== undefined && report.browserLineCount !== undefined
    ? `${report.predictedLineCount}/${report.browserLineCount}`
    : '-'

  console.log(
    `width ${width}: diff ${diff > 0 ? '+' : ''}${diff}px | height ${predicted}/${actual} | lines ${lines}`,
  )
  if (report.sliceStart !== undefined || report.sliceEnd !== undefined) {
    console.log(`  slice: ${report.sliceStart ?? 0}-${report.sliceEnd ?? '-'}`)
  }
  if (report.maxLineWidthDrift !== undefined) {
    console.log(`  max line width drift: ${report.maxLineWidthDrift.toFixed(3)}px`)
  }
  if (report.environment !== undefined) {
    const env = report.environment.end
    console.log(
      `  env: dpr ${env.dpr} | viewport ${env.innerWidth}x${env.innerHeight} | outer ${env.outerWidth}x${env.outerHeight} | scale ${env.visualViewportScale ?? '-'} | screen ${env.screenWidth}x${env.screenHeight}`,
    )
  }
  if (report.probeHeight !== undefined || report.normalizedHeight !== undefined) {
    console.log(
      `  probe heights: probe ${Math.round(report.probeHeight ?? 0)}px | normalized ${Math.round(report.normalizedHeight ?? 0)}px | book ${actual}px | method ${report.browserLineMethod ?? '-'}`,
    )
  }
  if (report.extractorSensitivity !== null && report.extractorSensitivity !== undefined) {
    console.log(`  extractor sensitivity: ${report.extractorSensitivity}`)
  }
  if (
    report.alternateBrowserLineMethod !== undefined &&
    report.alternateBrowserLineCount !== undefined
  ) {
    console.log(
      `  alternate method: ${report.alternateBrowserLineMethod} (${report.predictedLineCount ?? '-'}${report.alternateBrowserLineCount !== undefined ? `/${report.alternateBrowserLineCount}` : ''} lines)` +
      (report.alternateFirstBreakMismatch === null ? ' exact' : ''),
    )
  }
  if (report.maxDriftLine !== null && report.maxDriftLine !== undefined) {
    console.log(
      `  drift sample L${report.maxDriftLine.line}: ${report.maxDriftLine.drift.toFixed(3)}px (${report.maxDriftLine.sumWidth.toFixed(3)} sum vs ${report.maxDriftLine.fullWidth.toFixed(3)} full vs ${report.maxDriftLine.domWidth.toFixed(3)} dom vs ${report.maxDriftLine.pairAdjustedWidth.toFixed(3)} pair)`,
    )
    console.log(`  text: ${JSON.stringify(report.maxDriftLine.text.slice(0, 140))}`)
    if (report.maxDriftLine.segments.length > 0) {
      const summary = report.maxDriftLine.segments
        .map(segment => `${JSON.stringify(segment.text)}@${segment.width.toFixed(2)}/${segment.domWidth.toFixed(2)}${segment.isSpace ? ':space' : ''}`)
        .join(' | ')
      console.log(`  segments: ${summary}`)
    }
  }
  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    const mismatch = report.firstBreakMismatch
    console.log(`  break L${mismatch.line}: ${mismatch.reasonGuess}`)
    console.log(`  offsets: ours ${mismatch.oursStart}-${mismatch.oursEnd} | browser ${mismatch.browserStart}-${mismatch.browserEnd}`)
    console.log(`  delta: ${JSON.stringify(mismatch.deltaText)}`)
    console.log(`  ours text:    ${JSON.stringify(mismatch.oursText)}`)
    console.log(`  browser text: ${JSON.stringify(mismatch.browserText)}`)
    console.log(`  ours rendered:    ${JSON.stringify(mismatch.oursRenderedText)}`)
    console.log(`  browser rendered: ${JSON.stringify(mismatch.browserRenderedText)}`)
    console.log(`  ours:    ${mismatch.oursContext}`)
    console.log(`  browser: ${mismatch.browserContext}`)
    console.log(
      `  widths: ours sum/dom/full ${mismatch.oursSumWidth.toFixed(3)}/${mismatch.oursDomWidth.toFixed(3)}/${mismatch.oursFullWidth.toFixed(3)} | browser dom/full ${mismatch.browserDomWidth.toFixed(3)}/${mismatch.browserFullWidth.toFixed(3)}`,
    )
    if (mismatch.oursSegments.length > 0) {
      const summary = mismatch.oursSegments
        .map(segment => `${JSON.stringify(segment.text)}@${segment.width.toFixed(2)}/${segment.domWidth.toFixed(2)}${segment.isSpace ? ':space' : ''}`)
        .join(' | ')
      console.log(`  ours segments: ${summary}`)
    }
  } else if (report.firstMismatch !== null && report.firstMismatch !== undefined) {
    console.log(`  first mismatch L${report.firstMismatch.line}`)
    console.log(`  ours:    ${JSON.stringify(report.firstMismatch.ours.slice(0, 120))}`)
    console.log(`  browser: ${JSON.stringify(report.firstMismatch.browser.slice(0, 120))}`)
  }
}

let serverProcess: ChildProcess | null = null
const browser = parseBrowser(parseStringFlag('browser'))
const requestedPort = parseNumberFlag('port', Number.parseInt(process.env['CORPUS_CHECK_PORT'] ?? '0', 10))
const timeoutMs = parseNumberFlag('timeout', Number.parseInt(process.env['CORPUS_CHECK_TIMEOUT_MS'] ?? '180000', 10))
const requestedMethod = parseStringFlag('method')
if (requestedMethod !== null && requestedMethod !== 'span' && requestedMethod !== 'range') {
  throw new Error(`Unsupported --method ${requestedMethod}; expected span or range`)
}
const overrideOptions: CorpusOverrideOptions = {
  font: parseStringFlag('font'),
  lineHeight: parseOptionalNumberFlag('lineHeight'),
  method: requestedMethod as 'span' | 'range' | null,
  sliceStart: parseOptionalNumberFlag('sliceStart'),
  sliceEnd: parseOptionalNumberFlag('sliceEnd'),
}
const sources = await loadSources()
const id = parseStringFlag('id')

if (id === null) {
  throw new Error(`Missing --id. Available corpora: ${sources.map(source => source.id).join(', ')}`)
}

const meta = sources.find(source => source.id === id)
if (meta === undefined) {
  throw new Error(`Unknown corpus ${id}. Available corpora: ${sources.map(source => source.id).join(', ')}`)
}

const lock = await acquireBrowserAutomationLock(browser)
let session: BrowserSession | null = null
const diagnose = hasFlag('diagnose')

try {
  session = createBrowserSession(browser, { foreground: false, headless: false })
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  const pageServer = await ensurePageServer(port, '/corpus', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/corpus`
  console.log(`${meta.id} (${meta.language}) — ${meta.title}`)

  for (const width of getTargetWidths(meta)) {
    const requestId = `${Date.now()}-${width}-${Math.random().toString(36).slice(2)}`
    let url =
      `${baseUrl}?id=${encodeURIComponent(meta.id)}` +
      `&width=${width}` +
      `&report=1` +
      `&diagnostic=${diagnose ? 'full' : 'light'}` +
      `&requestId=${encodeURIComponent(requestId)}`
    url = appendOverrideParams(url, overrideOptions)

    const report = await loadHashReport<CorpusReport>(session, url, requestId, browser, timeoutMs)
    printReport(report)
    if (report.status === 'error') {
      process.exitCode = 1
      break
    }
  }
} finally {
  try {
    await session?.close()
  } finally {
    serverProcess?.kill()
    lock.release()
  }
}
