import type { BrowserEnvironmentReport } from './browser-environment.ts'

export type BenchmarkResult = {
  label: string
  ms: number
  desc: string
}

export type CorpusBenchmarkResult = {
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

export type BenchmarkResults = {
  results: BenchmarkResult[]
  richResults: BenchmarkResult[]
  richInlineResults: BenchmarkResult[]
  richPreWrapResults: BenchmarkResult[]
  richLongResults: BenchmarkResult[]
  corpusResults: CorpusBenchmarkResult[]
}

export type BenchmarkReport =
  | (BenchmarkResults & { status: 'ready'; requestId?: string; environment: BrowserEnvironmentReport })
  | { status: 'error'; requestId?: string; environment?: BrowserEnvironmentReport; message: string }

export type BenchmarkRun = BenchmarkResults & {
  status: 'ready'
  requestId: string
  environment: BrowserEnvironmentReport
}

export type BenchmarkSummary = BenchmarkResults & {
  status: 'ready'
  runs: BenchmarkRun[]
}
