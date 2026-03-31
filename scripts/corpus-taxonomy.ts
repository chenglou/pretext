import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadPostedReport,
  type BrowserKind,
} from './browser-automation.ts'
import { startPostedReportServer } from './report-server.ts'

type CorpusMeta = {
  id: string
  language: string
  title: string
  min_width?: number
  max_width?: number
}

type CorpusBreakMismatch = {
  line: number
  deltaText: string
  reasonGuess: string
  oursContext: string
  browserContext: string
}

type CorpusSweepRow = {
  width: number
  diffPx: number
  browserLineMethod?: 'span-probe' | 'range'
  maxLineWidthDrift?: number
  firstBreakMismatch?: CorpusBreakMismatch | null
}

type CorpusSweepReport = {
  status: 'ready' | 'error'
  requestId?: string
  rows?: CorpusSweepRow[]
  message?: string
}

type TaxonomyCategory =
  | 'edge-fit'
  | 'shaping-context'
  | 'glue-policy'
  | 'boundary-discovery'
  | 'diagnostic-sensitivity'
  | 'unknown'

type TaxonomyEntry = {
  width: number
  diffPx: number
  category: TaxonomyCategory
  reason: string
  deltaText: string
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
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseOptionalNumberFlag(name: string): number | null {
  const raw = parseStringFlag(name)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowser(value: string | null): BrowserKind {
  const browser = (value ?? process.env['CORPUS_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
  if (browser !== 'chrome' && browser !== 'safari') {
    throw new Error(`Unsupported browser ${browser}; expected chrome or safari`)
  }
  return browser
}

async function loadSources(): Promise<CorpusMeta[]> {
  return await Bun.file('corpora/sources.json').json()
}

function getTargetWidths(meta: CorpusMeta, start: number, end: number, step: number, samples: number | null): number[] {
  const min = Math.max(start, meta.min_width ?? start)
  const max = Math.min(end, meta.max_width ?? end)

  if (samples !== null) {
    if (samples === 1) return [Math.round((min + max) / 2)]
    const sampled = new Set<number>()
    for (let i = 0; i < samples; i++) {
      const ratio = i / (samples - 1)
      sampled.add(Math.round(min + (max - min) * ratio))
    }
    return [...sampled].sort((a, b) => a - b)
  }

  const fromArgs = process.argv.slice(2)
    .filter(arg => !arg.startsWith('--'))
    .map(arg => Number.parseInt(arg, 10))
    .filter(width => Number.isFinite(width))
  if (fromArgs.length > 0) return fromArgs

  const widths: number[] = []
  for (let width = min; width <= max; width += step) widths.push(width)
  return widths
}

function appendOverrideParams(url: string, font: string | null, lineHeight: number | null): string {
  let nextUrl = url
  if (font !== null) nextUrl += `&font=${encodeURIComponent(font)}`
  if (lineHeight !== null) nextUrl += `&lineHeight=${lineHeight}`
  return nextUrl
}

const quoteOrPunctuationRe = /["'“”‘’«»‹›「」『』（）()［］【】。，、！？!?,.;:—-]/

function classifyTaxonomy(row: CorpusSweepRow): TaxonomyCategory {
  const mismatch = row.firstBreakMismatch
  const reason = mismatch?.reasonGuess ?? ''

  if (reason.includes('only') && reason.includes('overflow')) {
    return 'edge-fit'
  }
  if (reason.includes('segment sum drifts')) {
    return 'shaping-context'
  }
  if (row.browserLineMethod === 'span-probe' && (row.maxLineWidthDrift ?? 0) === 0 && mismatch === null) {
    return 'diagnostic-sensitivity'
  }
  if (mismatch != null && quoteOrPunctuationRe.test(mismatch.deltaText)) {
    return 'glue-policy'
  }
  if (mismatch != null) {
    return 'boundary-discovery'
  }
  return 'unknown'
}

function printEntries(entries: TaxonomyEntry[]): void {
  if (entries.length === 0) {
    console.log('all checked widths exact')
    return
  }

  const byCategory = new Map<TaxonomyCategory, TaxonomyEntry[]>()
  for (const entry of entries) {
    const bucket = byCategory.get(entry.category)
    if (bucket === undefined) {
      byCategory.set(entry.category, [entry])
    } else {
      bucket.push(entry)
    }
  }

  for (const [category, bucket] of byCategory.entries()) {
    console.log(`${category}: ${bucket.length}`)
    for (const entry of bucket.slice(0, 8)) {
      console.log(
        `  ${entry.width}px -> ${entry.diffPx > 0 ? '+' : ''}${entry.diffPx}px | ${entry.reason}${entry.deltaText.length > 0 ? ` | delta ${JSON.stringify(entry.deltaText)}` : ''}`,
      )
    }
  }
}

const browser = parseBrowser(parseStringFlag('browser'))
const requestedPort = parseNumberFlag('port', Number.parseInt(process.env['CORPUS_CHECK_PORT'] ?? '0', 10))
const timeoutMs = parseNumberFlag('timeout', Number.parseInt(process.env['CORPUS_CHECK_TIMEOUT_MS'] ?? '180000', 10))
const start = parseNumberFlag('start', 300)
const end = parseNumberFlag('end', 900)
const step = parseNumberFlag('step', 10)
const samples = parseOptionalNumberFlag('samples')
const font = parseStringFlag('font')
const lineHeight = parseOptionalNumberFlag('lineHeight')
const id = parseStringFlag('id')

const sources = await loadSources()
if (id === null) {
  throw new Error(`Missing --id. Available corpora: ${sources.map(source => source.id).join(', ')}`)
}
const meta = sources.find(source => source.id === id)
if (meta === undefined) {
  throw new Error(`Unknown corpus ${id}. Available corpora: ${sources.map(source => source.id).join(', ')}`)
}

const widths = getTargetWidths(meta, start, end, step, samples)
const lock = await acquireBrowserAutomationLock(browser)
const session = createBrowserSession(browser)
let serverProcess: ChildProcess | null = null

try {
  const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
  const pageServer = await ensurePageServer(port, '/corpus', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/corpus`
  const entries: TaxonomyEntry[] = []

  console.log(`${meta.id} (${meta.language}) — ${meta.title}`)
  const requestId = `${Date.now()}-${meta.id}-${Math.random().toString(36).slice(2)}`
  const reportServer = await startPostedReportServer<CorpusSweepReport>(requestId)
  let url =
    `${baseUrl}?id=${encodeURIComponent(meta.id)}` +
    `&widths=${encodeURIComponent(widths.join(','))}` +
    `&report=1` +
    `&diagnostic=full` +
    `&requestId=${encodeURIComponent(requestId)}` +
    `&reportEndpoint=${encodeURIComponent(reportServer.endpoint)}`
  url = appendOverrideParams(url, font, lineHeight)

  const report = await (async () => {
    try {
      return await loadPostedReport(
        session,
        url,
        () => reportServer.waitForReport(null),
        requestId,
        browser,
        timeoutMs,
      )
    } finally {
      reportServer.close()
    }
  })()
  if (report.status === 'error') {
    throw new Error(`Corpus page returned error for ${meta.id}: ${report.message ?? 'unknown error'}`)
  }
  if (report.rows === undefined) {
    throw new Error(`Corpus taxonomy report was missing rows for ${meta.id}`)
  }

  for (const row of report.rows) {
    const diffPx = Math.round(row.diffPx)
    if (diffPx === 0) continue

    entries.push({
      width: row.width,
      diffPx,
      category: classifyTaxonomy(row),
      reason: row.firstBreakMismatch?.reasonGuess ?? 'no break diagnostic',
      deltaText: row.firstBreakMismatch?.deltaText ?? '',
    })
  }

  printEntries(entries)
} finally {
  session.close()
  serverProcess?.kill()
  lock.release()
}
