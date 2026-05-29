import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type AccuracyReport = {
  total?: number
  matchCount?: number
  mismatchCount?: number
}

type LetterSpacingSnapshot = {
  total?: number
  geometryMatchCount?: number
  geometryMismatchCount?: number
  firstBreakMismatchCount?: number
}

type BenchmarkResult = {
  label: string
  ms: number
  desc: string
}

type CorpusBenchmarkResult = {
  id: string
  label: string
  font: string
  chars: number
  analysisSegments: number
  segments: number
  breakableSegments: number
  width: number
  lineCount: number
  analysisMs: number
  measureMs: number
  prepareMs: number
  layoutMs: number
}

type BenchmarkReport = {
  results?: BenchmarkResult[]
  richResults?: BenchmarkResult[]
  richInlineResults?: BenchmarkResult[]
  richPreWrapResults?: BenchmarkResult[]
  richLongResults?: BenchmarkResult[]
  corpusResults?: CorpusBenchmarkResult[]
}

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

async function loadJson<T>(path: string): Promise<T> {
  return await Bun.file(path).json()
}

function summarizeAccuracy(report: AccuracyReport) {
  return {
    total: report.total ?? 0,
    matchCount: report.matchCount ?? 0,
    mismatchCount: report.mismatchCount ?? 0,
  }
}

function summarizeLetterSpacing(snapshot: LetterSpacingSnapshot) {
  return {
    total: snapshot.total ?? 0,
    geometryMatchCount: snapshot.geometryMatchCount ?? 0,
    geometryMismatchCount: snapshot.geometryMismatchCount ?? 0,
    firstBreakMismatchCount: snapshot.firstBreakMismatchCount ?? 0,
  }
}

function indexResults(results: BenchmarkResult[] | undefined): Record<string, { ms: number, desc: string }> {
  const indexed: Record<string, { ms: number, desc: string }> = {}
  for (const result of results ?? []) {
    indexed[result.label] = {
      ms: result.ms,
      desc: result.desc,
    }
  }
  return indexed
}

const output = parseStringFlag('output') ?? 'status/dashboard.json'
const chromeAccuracy = await loadJson<AccuracyReport>('accuracy/chrome.json')
const safariAccuracy = await loadJson<AccuracyReport>('accuracy/safari.json')
const firefoxAccuracy = await loadJson<AccuracyReport>('accuracy/firefox.json')
const letterSpacing = await loadJson<LetterSpacingSnapshot>('accuracy/letter-spacing.json')
const chromeBenchmarks = await loadJson<BenchmarkReport>('benchmarks/chrome.json')
const safariBenchmarks = await loadJson<BenchmarkReport>('benchmarks/safari.json')

const dashboard = {
  generatedAt: new Date().toISOString(),
  sources: {
    accuracy: {
      chrome: 'accuracy/chrome.json',
      safari: 'accuracy/safari.json',
      firefox: 'accuracy/firefox.json',
      letterSpacing: 'accuracy/letter-spacing.json',
    },
    benchmarks: {
      chrome: 'benchmarks/chrome.json',
      safari: 'benchmarks/safari.json',
    },
    corpora: 'corpora/dashboard.json',
  },
  browserAccuracy: {
    chrome: summarizeAccuracy(chromeAccuracy),
    safari: summarizeAccuracy(safariAccuracy),
    firefox: summarizeAccuracy(firefoxAccuracy),
  },
  letterSpacingOracle: summarizeLetterSpacing(letterSpacing),
  benchmarks: {
    chrome: {
      topLevel: indexResults(chromeBenchmarks.results),
      richShared: indexResults(chromeBenchmarks.richResults),
      richInline: indexResults(chromeBenchmarks.richInlineResults),
      richPreWrap: indexResults(chromeBenchmarks.richPreWrapResults),
      richLong: indexResults(chromeBenchmarks.richLongResults),
      longFormCorpusStress: chromeBenchmarks.corpusResults ?? [],
    },
    safari: {
      topLevel: indexResults(safariBenchmarks.results),
      richShared: indexResults(safariBenchmarks.richResults),
      richInline: indexResults(safariBenchmarks.richInlineResults),
      richPreWrap: indexResults(safariBenchmarks.richPreWrapResults),
      richLong: indexResults(safariBenchmarks.richLongResults),
      longFormCorpusStress: safariBenchmarks.corpusResults ?? [],
    },
  },
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8')
console.log(`wrote ${output}`)
