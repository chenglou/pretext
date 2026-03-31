import { writeFileSync } from 'node:fs'
import { spawnSync, type ChildProcess } from 'node:child_process'
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

type CorpusSweepRow = {
  width: number
  contentWidth: number
  predictedHeight: number
  actualHeight: number
  diffPx: number
  predictedLineCount: number
  browserLineCount: number
}

type CorpusSweepReport = {
  status: 'ready' | 'error'
  requestId?: string
  corpusId?: string
  title?: string
  language?: string
  widthCount?: number
  exactCount?: number
  rows?: CorpusSweepRow[]
  message?: string
}

type SweepMismatch = {
  width: number
  diffPx: number
  predictedHeight: number
  actualHeight: number
  predictedLineCount: number | null
  browserLineCount: number | null
}

type SweepSummary = {
  corpusId: string
  language: string
  title: string
  browser: BrowserKind
  start: number
  end: number
  step: number
  samples: number | null
  widthCount: number
  exactCount: number
  mismatches: SweepMismatch[]
}

type SweepOptions = {
  id: string | null
  all: boolean
  start: number
  end: number
  step: number
  port: number
  browser: BrowserKind
  output: string | null
  timeoutMs: number
  samples: number | null
  font: string | null
  lineHeight: number | null
  diagnose: boolean
  diagnoseLimit: number
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

function parseOptions(): SweepOptions {
  const start = parseNumberFlag('start', 300)
  const end = parseNumberFlag('end', 900)
  const step = parseNumberFlag('step', 10)
  if (step <= 0) throw new Error('--step must be > 0')
  if (end < start) throw new Error('--end must be >= --start')
  const samplesRaw = parseStringFlag('samples')
  let samples: number | null = null
  if (samplesRaw !== null) {
    const parsedSamples = Number.parseInt(samplesRaw, 10)
    if (!Number.isFinite(parsedSamples) || parsedSamples <= 0) {
      throw new Error(`Invalid value for --samples: ${samplesRaw}`)
    }
    samples = parsedSamples
  }

  return {
    id: parseStringFlag('id'),
    all: hasFlag('all'),
    start,
    end,
    step,
    port: parseNumberFlag('port', Number.parseInt(process.env['CORPUS_CHECK_PORT'] ?? '0', 10)),
    browser: parseBrowser(parseStringFlag('browser')),
    output: parseStringFlag('output'),
    timeoutMs: parseNumberFlag('timeout', Number.parseInt(process.env['CORPUS_CHECK_TIMEOUT_MS'] ?? '180000', 10)),
    samples,
    font: parseStringFlag('font'),
    lineHeight: parseOptionalNumberFlag('lineHeight'),
    diagnose: hasFlag('diagnose'),
    diagnoseLimit: parseNumberFlag('diagnose-limit', 6),
  }
}

function appendOverrideParams(url: string, options: SweepOptions): string {
  let nextUrl = url
  if (options.font !== null) {
    nextUrl += `&font=${encodeURIComponent(options.font)}`
  }
  if (options.lineHeight !== null) {
    nextUrl += `&lineHeight=${options.lineHeight}`
  }
  return nextUrl
}

function getSweepWidths(meta: CorpusMeta, options: SweepOptions): number[] {
  const min = Math.max(options.start, meta.min_width ?? options.start)
  const max = Math.min(options.end, meta.max_width ?? options.end)

  if (options.samples !== null) {
    const samples = options.samples
    if (samples === 1) {
      const middle = Math.round((min + max) / 2)
      return [middle]
    }

    const sampled = new Set<number>()
    for (let i = 0; i < samples; i++) {
      const ratio = i / (samples - 1)
      const width = Math.round(min + (max - min) * ratio)
      sampled.add(width)
    }
    return [...sampled].sort((a, b) => a - b)
  }

  const widths: number[] = []
  for (let width = min; width <= max; width += options.step) {
    widths.push(width)
  }
  return widths
}

function bucketMismatches(mismatches: SweepMismatch[]): string {
  if (mismatches.length === 0) return 'exact'

  const buckets = new Map<number, number[]>()
  for (const mismatch of mismatches) {
    const list = buckets.get(mismatch.diffPx)
    if (list === undefined) {
      buckets.set(mismatch.diffPx, [mismatch.width])
    } else {
      list.push(mismatch.width)
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([diffPx, widths]) => `${diffPx > 0 ? '+' : ''}${diffPx}px: ${widths.join(', ')}`)
    .join(' | ')
}

function printSummary(summary: SweepSummary): void {
  console.log(
    `${summary.corpusId} (${summary.language}) | ${summary.exactCount}/${summary.widthCount} exact | ${summary.mismatches.length} nonzero`,
  )
  console.log(`  ${bucketMismatches(summary.mismatches)}`)
}

function getSweepRows(report: CorpusSweepReport, corpusId: string): CorpusSweepRow[] {
  if (report.rows === undefined) {
    throw new Error(`Corpus sweep report was missing rows for ${corpusId}`)
  }
  return report.rows
}

function runDetailedDiagnose(meta: CorpusMeta, mismatches: SweepMismatch[], options: SweepOptions): void {
  if (!options.diagnose || mismatches.length === 0) return

  const widths = mismatches
    .slice(0, options.diagnoseLimit)
    .map(mismatch => String(mismatch.width))

  console.log(`diagnosing ${meta.id} at ${widths.length} widths: ${widths.join(', ')}`)

  const args = ['run', 'scripts/corpus-check.ts', `--id=${meta.id}`, '--diagnose', ...widths]
  if (options.font !== null) {
    args.push(`--font=${options.font}`)
  }
  if (options.lineHeight !== null) {
    args.push(`--lineHeight=${options.lineHeight}`)
  }

  const result = spawnSync('bun', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORPUS_CHECK_BROWSER: options.browser,
      CORPUS_CHECK_PORT: String(options.port),
      CORPUS_CHECK_TIMEOUT_MS: String(options.timeoutMs),
    },
    encoding: 'utf8',
  })

  if (result.stdout.length > 0) process.stdout.write(result.stdout)
  if (result.stderr.length > 0) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`corpus-check exited with status ${result.status ?? 'unknown'}`)
  }
}

const options = parseOptions()
options.port = await getAvailablePort(options.port === 0 ? null : options.port)
const sources = await loadSources()

const targets = options.all
  ? sources
  : (() => {
      if (options.id === null) {
        throw new Error(`Missing --id or --all. Available corpora: ${sources.map(source => source.id).join(', ')}`)
      }
      const meta = sources.find(source => source.id === options.id)
      if (meta === undefined) {
        throw new Error(`Unknown corpus ${options.id}. Available corpora: ${sources.map(source => source.id).join(', ')}`)
      }
      return [meta]
    })()

const lock = await acquireBrowserAutomationLock(options.browser)
const session = createBrowserSession(options.browser)
let serverProcess: ChildProcess | null = null
const summaries: SweepSummary[] = []

try {
  const pageServer = await ensurePageServer(options.port, '/corpus', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/corpus`

  for (const meta of targets) {
    const widths = getSweepWidths(meta, options)
    const requestId = `${Date.now()}-${meta.id}-${Math.random().toString(36).slice(2)}`
    let url =
      `${baseUrl}?id=${encodeURIComponent(meta.id)}` +
      `&widths=${encodeURIComponent(widths.join(','))}` +
      `&report=1` +
      `&requestId=${encodeURIComponent(requestId)}`
    url = appendOverrideParams(url, options)

    const reportServer = await startPostedReportServer<CorpusSweepReport>(requestId)
    url += `&reportEndpoint=${encodeURIComponent(reportServer.endpoint)}`

    const report = await (async () => {
      try {
        return await loadPostedReport(
          session,
          url,
          () => reportServer.waitForReport(null),
          requestId,
          options.browser,
          options.timeoutMs,
        )
      } finally {
        reportServer.close()
      }
    })()
    if (report.status === 'error') {
      throw new Error(`Corpus page returned error for ${meta.id}: ${report.message ?? 'unknown error'}`)
    }

    const rows = getSweepRows(report, meta.id)
    const mismatches: SweepMismatch[] = rows
      .filter(row => Math.round(row.diffPx) !== 0)
      .map(row => ({
        width: row.width,
        diffPx: Math.round(row.diffPx),
        predictedHeight: Math.round(row.predictedHeight),
        actualHeight: Math.round(row.actualHeight),
        predictedLineCount: row.predictedLineCount,
        browserLineCount: row.browserLineCount,
      }))
    const exactCount = report.exactCount ?? (rows.length - mismatches.length)

    const summary: SweepSummary = {
      corpusId: meta.id,
      language: meta.language,
      title: meta.title,
      browser: options.browser,
      start: options.start,
      end: options.end,
      step: options.step,
      samples: options.samples,
      widthCount: rows.length,
      exactCount,
      mismatches,
    }
    summaries.push(summary)
    printSummary(summary)
    runDetailedDiagnose(meta, mismatches, options)
  }

  if (options.output !== null) {
    writeFileSync(options.output, JSON.stringify(summaries, null, 2))
    console.log(`wrote ${options.output}`)
  }
} finally {
  session.close()
  serverProcess?.kill()
  lock.release()
}
