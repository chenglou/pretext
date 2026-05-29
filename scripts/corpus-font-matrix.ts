import { writeFileSync } from 'node:fs'
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
  default_width?: number
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
  rows?: CorpusSweepRow[]
  exactCount?: number
  message?: string
}

type FontVariant = {
  id: string
  label: string
  font: string
  lineHeight: number
}

type VariantResult = {
  id: string
  label: string
  font: string
  lineHeight: number
  widthCount: number
  exactCount: number
  mismatches: Array<{
    width: number
    diffPx: number
    predictedHeight: number
    actualHeight: number
  }>
}

type MatrixSummary = {
  corpusId: string
  title: string
  browser: BrowserKind
  widths: number[]
  variants: VariantResult[]
}

type MatrixOptions = {
  id: string
  browser: BrowserKind
  port: number
  timeoutMs: number
  output: string | null
  samples: number | null
  start: number
  end: number
  step: number
}

const FONT_MATRIX: Record<string, FontVariant[]> = {
  'ja-kumo-no-ito': [
    {
      id: 'default',
      label: 'Hiragino Mincho ProN',
      font: '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif',
      lineHeight: 32,
    },
    {
      id: 'hiragino-sans',
      label: 'Hiragino Sans',
      font: '20px "Hiragino Sans", "Hiragino Mincho ProN", sans-serif',
      lineHeight: 32,
    },
  ],
  'ja-rashomon': [
    {
      id: 'default',
      label: 'Hiragino Mincho ProN',
      font: '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif',
      lineHeight: 32,
    },
    {
      id: 'hiragino-sans',
      label: 'Hiragino Sans',
      font: '20px "Hiragino Sans", "Hiragino Mincho ProN", sans-serif',
      lineHeight: 32,
    },
  ],
  'ko-unsu-joh-eun-nal': [
    {
      id: 'default',
      label: 'Apple SD Gothic Neo',
      font: '18px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif',
      lineHeight: 30,
    },
    {
      id: 'myungjo',
      label: 'AppleMyungjo',
      font: '18px "AppleMyungjo", "Apple SD Gothic Neo", serif',
      lineHeight: 30,
    },
  ],
  'ko-sonagi': [
    {
      id: 'default',
      label: 'Apple SD Gothic Neo',
      font: '18px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif',
      lineHeight: 30,
    },
    {
      id: 'myungjo',
      label: 'AppleMyungjo',
      font: '18px "AppleMyungjo", "Apple SD Gothic Neo", serif',
      lineHeight: 30,
    },
  ],
  'zh-zhufu': [
    {
      id: 'default',
      label: 'Songti SC',
      font: '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif',
      lineHeight: 32,
    },
    {
      id: 'pingfang-sc',
      label: 'PingFang SC',
      font: '20px "PingFang SC", "Songti SC", sans-serif',
      lineHeight: 32,
    },
  ],
  'zh-guxiang': [
    {
      id: 'default',
      label: 'Songti SC',
      font: '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif',
      lineHeight: 32,
    },
    {
      id: 'pingfang-sc',
      label: 'PingFang SC',
      font: '20px "PingFang SC", "Songti SC", sans-serif',
      lineHeight: 32,
    },
  ],
  'th-nithan-vetal-story-1': [
    {
      id: 'default',
      label: 'Thonburi',
      font: '20px "Thonburi", "Noto Sans Thai", sans-serif',
      lineHeight: 32,
    },
    {
      id: 'ayuthaya',
      label: 'Ayuthaya',
      font: '20px "Ayuthaya", "Thonburi", serif',
      lineHeight: 32,
    },
  ],
  'th-nithan-vetal-story-7': [
    {
      id: 'default',
      label: 'Thonburi',
      font: '20px "Thonburi", "Noto Sans Thai", sans-serif',
      lineHeight: 32,
    },
    {
      id: 'ayuthaya',
      label: 'Ayuthaya',
      font: '20px "Ayuthaya", "Thonburi", serif',
      lineHeight: 32,
    },
  ],
  'my-cunning-heron-teacher': [
    {
      id: 'default',
      label: 'Myanmar MN',
      font: '20px "Myanmar MN", "Myanmar Sangam MN", "Noto Sans Myanmar", serif',
      lineHeight: 32,
    },
    {
      id: 'myanmar-sangam',
      label: 'Myanmar Sangam MN',
      font: '20px "Myanmar Sangam MN", "Myanmar MN", serif',
      lineHeight: 32,
    },
    {
      id: 'noto-sans',
      label: 'Noto Sans Myanmar',
      font: '20px "Noto Sans Myanmar", "Myanmar MN", sans-serif',
      lineHeight: 32,
    },
  ],
  'my-bad-deeds-return-to-you-teacher': [
    {
      id: 'default',
      label: 'Myanmar MN',
      font: '20px "Myanmar MN", "Myanmar Sangam MN", "Noto Sans Myanmar", serif',
      lineHeight: 32,
    },
    {
      id: 'myanmar-sangam',
      label: 'Myanmar Sangam MN',
      font: '20px "Myanmar Sangam MN", "Myanmar MN", serif',
      lineHeight: 32,
    },
    {
      id: 'noto-sans',
      label: 'Noto Sans Myanmar',
      font: '20px "Noto Sans Myanmar", "Myanmar MN", sans-serif',
      lineHeight: 32,
    },
  ],
  'km-prachum-reuang-preng-khmer-volume-7-stories-1-10': [
    {
      id: 'default',
      label: 'Khmer Sangam MN',
      font: '20px "Khmer Sangam MN", "Khmer MN", "Noto Sans Khmer", serif',
      lineHeight: 32,
    },
    {
      id: 'khmer-mn',
      label: 'Khmer MN',
      font: '20px "Khmer MN", "Khmer Sangam MN", serif',
      lineHeight: 32,
    },
  ],
  'hi-eidgah': [
    {
      id: 'default',
      label: 'Kohinoor Devanagari',
      font: '20px "Kohinoor Devanagari", "Noto Serif Devanagari", serif',
      lineHeight: 32,
    },
    {
      id: 'sangam',
      label: 'Devanagari Sangam MN',
      font: '20px "Devanagari Sangam MN", "Kohinoor Devanagari", serif',
      lineHeight: 32,
    },
    {
      id: 'itf',
      label: 'ITF Devanagari',
      font: '20px "ITF Devanagari", "Kohinoor Devanagari", serif',
      lineHeight: 32,
    },
  ],
  'ar-risalat-al-ghufran-part-1': [
    {
      id: 'default',
      label: 'Geeza Pro',
      font: '20px "Geeza Pro", "Noto Naskh Arabic", "Arial", serif',
      lineHeight: 34,
    },
    {
      id: 'sf-arabic',
      label: 'SF Arabic',
      font: '20px "SF Arabic", "Geeza Pro", serif',
      lineHeight: 34,
    },
    {
      id: 'arial',
      label: 'Arial Arabic',
      font: '20px "Arial", "Geeza Pro", serif',
      lineHeight: 34,
    },
  ],
  'he-masaot-binyamin-metudela': [
    {
      id: 'default',
      label: 'Times New Roman',
      font: '20px "Times New Roman", "Noto Serif Hebrew", serif',
      lineHeight: 32,
    },
    {
      id: 'sf-hebrew',
      label: 'SF Hebrew',
      font: '20px "SF Hebrew", "Times New Roman", serif',
      lineHeight: 32,
    },
  ],
  'ur-chughd': [
    {
      id: 'default',
      label: 'Noto Nastaliq Urdu',
      font: '20px "Noto Nastaliq Urdu", "DecoType Nastaleeq Urdu UI", "Geeza Pro", serif',
      lineHeight: 38,
    },
    {
      id: 'geeza-pro',
      label: 'Geeza Pro',
      font: '20px "Geeza Pro", "Noto Nastaliq Urdu", serif',
      lineHeight: 34,
    },
  ],
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

function parseOptions(): MatrixOptions {
  const id = parseStringFlag('id')
  if (id === null) {
    throw new Error(`Missing --id. Available corpora: ${Object.keys(FONT_MATRIX).join(', ')}`)
  }

  const samples = parseOptionalNumberFlag('samples')
  const start = parseNumberFlag('start', 300)
  const end = parseNumberFlag('end', 900)
  const step = parseNumberFlag('step', 10)
  if (step <= 0) throw new Error('--step must be > 0')
  if (end < start) throw new Error('--end must be >= --start')

  return {
    id,
    browser: parseBrowser(parseStringFlag('browser')),
    port: parseNumberFlag('port', Number.parseInt(process.env['CORPUS_CHECK_PORT'] ?? '0', 10)),
    timeoutMs: parseNumberFlag('timeout', Number.parseInt(process.env['CORPUS_CHECK_TIMEOUT_MS'] ?? '180000', 10)),
    output: parseStringFlag('output'),
    samples,
    start,
    end,
    step,
  }
}

function getSweepWidths(meta: CorpusMeta, options: MatrixOptions): number[] {
  const min = Math.max(options.start, meta.min_width ?? options.start)
  const max = Math.min(options.end, meta.max_width ?? options.end)

  if (options.samples !== null) {
    const samples = options.samples
    if (samples <= 1) return [Math.round((min + max) / 2)]
    const sampled = new Set<number>()
    for (let i = 0; i < samples; i++) {
      const ratio = i / (samples - 1)
      sampled.add(Math.round(min + (max - min) * ratio))
    }
    return [...sampled].sort((a, b) => a - b)
  }

  const widths: number[] = []
  for (let width = min; width <= max; width += options.step) {
    widths.push(width)
  }
  return widths
}

function bucketMismatches(mismatches: VariantResult['mismatches']): string {
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

function printSummary(summary: MatrixSummary): void {
  console.log(`${summary.corpusId} — ${summary.title}`)
  console.log(`widths: ${summary.widths.join(', ')}`)
  for (const variant of summary.variants) {
    console.log(`  ${variant.label}: ${variant.exactCount}/${variant.widthCount} exact | ${variant.mismatches.length} nonzero`)
    console.log(`    ${bucketMismatches(variant.mismatches)}`)
  }
}

const options = parseOptions()
options.port = await getAvailablePort(options.port === 0 ? null : options.port)
const sources = await loadSources()
const meta = sources.find(source => source.id === options.id)
if (meta === undefined) {
  throw new Error(`Unknown corpus ${options.id}. Available corpora: ${sources.map(source => source.id).join(', ')}`)
}

const variants = FONT_MATRIX[options.id]
if (variants === undefined) {
  throw new Error(`No font matrix configured for ${options.id}. Available corpora: ${Object.keys(FONT_MATRIX).join(', ')}`)
}

const widths = getSweepWidths(meta, options)
const lock = await acquireBrowserAutomationLock(options.browser)
const session = createBrowserSession(options.browser)
let serverProcess: ChildProcess | null = null

try {
  const pageServer = await ensurePageServer(options.port, '/corpus', process.cwd())
  serverProcess = pageServer.process
  const baseUrl = `${pageServer.baseUrl}/corpus`
  const variantResults: VariantResult[] = []

  for (const variant of variants) {
    const requestId = `${Date.now()}-${variant.id}-${Math.random().toString(36).slice(2)}`
    const reportServer = await startPostedReportServer<CorpusSweepReport>(requestId)
    const url =
      `${baseUrl}?id=${encodeURIComponent(meta.id)}` +
      `&widths=${encodeURIComponent(widths.join(','))}` +
      `&report=1` +
      `&requestId=${encodeURIComponent(requestId)}` +
      `&font=${encodeURIComponent(variant.font)}` +
      `&lineHeight=${variant.lineHeight}` +
      `&reportEndpoint=${encodeURIComponent(reportServer.endpoint)}`

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
      throw new Error(`Corpus page returned error for ${meta.id} (${variant.id}): ${report.message ?? 'unknown error'}`)
    }
    if (report.rows === undefined) {
      throw new Error(`Corpus font matrix report was missing rows for ${meta.id} (${variant.id})`)
    }

    const mismatches: VariantResult['mismatches'] = report.rows
      .filter(row => Math.round(row.diffPx) !== 0)
      .map(row => ({
        width: row.width,
        diffPx: Math.round(row.diffPx),
        predictedHeight: Math.round(row.predictedHeight),
        actualHeight: Math.round(row.actualHeight),
      }))
    const exactCount = report.exactCount ?? (report.rows.length - mismatches.length)

    variantResults.push({
      id: variant.id,
      label: variant.label,
      font: variant.font,
      lineHeight: variant.lineHeight,
      widthCount: report.rows.length,
      exactCount,
      mismatches,
    })
  }

  const summary: MatrixSummary = {
    corpusId: meta.id,
    title: meta.title,
    browser: options.browser,
    widths,
    variants: variantResults,
  }

  printSummary(summary)

  if (options.output !== null) {
    writeFileSync(options.output, JSON.stringify(summary, null, 2))
    console.log(`wrote ${options.output}`)
  }
} finally {
  session.close()
  serverProcess?.kill()
  lock.release()
}
