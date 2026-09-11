import type { ContractFailure, Prediction } from './contracts.ts'
import type { BrowserEnvironmentReport } from '../../shared/browser-environment.ts'

export type BrowserKind = 'chrome' | 'safari' | 'firefox'
export type BrowserContext = { kind: 'fixtures' } | { kind: 'installed'; lang: string }

export type WrappingCase = {
  id: string
  family: string
  detail?: 'height' | 'full'
  lineMethod?: 'range' | 'span'
  required?: Array<keyof Assessment>
  heightMode?: 'exact' | 'accuracy' | 'corpus'
  // Maintained probes use prepareWithSegments/layout; discretionary checks use line array height.
  heightSource?: 'layout' | 'lines'
  nativeSource?: 'normalized'
  // Observe same-font normal inline items independently of the flat paragraph.
  nativeItems?: true
  context?: Extract<BrowserContext, { kind: 'installed' }>
  origins: string[]
  text: string
  parts?: string[]
  discretionary?: { expectedText: string[] }
  emergencyGraphemes?: true
  font: string
  fontFixture?: string
  width: number
  lineHeight: number
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
  letterSpacing: number
  direction: 'ltr' | 'rtl'
  lang?: string
  locale?: string
  scope: 'supported' | 'research'
  note?: string
  browsers?: BrowserKind[]
}

export type MetricResult =
  | { status: 'pass' }
  | { status: 'fail'; detail: string }
  | { status: 'unobserved'; reason: string }
  | { status: 'not-applicable'; reason: string }

export type Assessment = {
  height: MetricResult
  lineCount: MetricResult
  breaks: MetricResult
  source: MetricResult
  whitespace: MetricResult
  widths: MetricResult
  hyphen: MetricResult
  api: MetricResult
  richHeight: MetricResult
}

export type NativeRect = { x: number; y: number; width: number; height: number }
export type NativePoint = { start: number; end: number; text: string; rects: NativeRect[] }
export type NativeExtraction = {
  method: 'range' | 'span'
  // The exact documented-normalized source laid out by this intervention.
  source: string
  height: number
  usedLineHeight: number
  units: NativePoint[]
  // Scalar rectangles inside the same extraction DOM retain visible evidence
  // even when a grapheme unit also contains an invisible formatting control.
  points: NativePoint[]
  lineRects: NativeRect[]
}
export type NativeObservation = {
  height: number
  lineCount: number
  usedLineHeight?: number
  points: NativePoint[]
  lineRects: NativeRect[]
  extraction?: NativeExtraction
  // Observer v1 source groups lack extraction-stage geometry. Retained only
  // for reading old records; they cannot reconstruct a NativeExtraction.
  extractedLines?: Array<{ start: number; end: number }>
  richHeight?: number
}

export type CandidateResult =
  | { name: string; prediction: Prediction; assessment: Assessment }
  | { name: string; error: string }

export type CaseResult = {
  input: WrappingCase
  native: NativeObservation
  predictions: CandidateResult[]
}

export type FontFixture = {
  family: string
  weight: string
  url: string
  sha256: string
}

export type BrowserConfig = {
  requestId: string
  context: BrowserContext
  browser: BrowserKind
  schedule: 'ordinary' | 'full'
  direction: 'ltr' | 'rtl'
  family: string | null
  caseId: string | null
  fonts: FontFixture[]
}

export type BrowserEnvironment = {
  measurement: BrowserEnvironmentReport
  context: BrowserContext
  userAgent: string
  dpr: number
  locale: string
  visibility: DocumentVisibilityState
  focused: boolean
  fonts: FontFixture[]
}

export type BrowserReport = {
  status: 'ready'
  observerVersion: 2
  contexts: Array<Extract<BrowserContext, { kind: 'installed' }>>
  rowCount: number
  environment: BrowserEnvironment
  richContracts: { name: string; font: string; letterSpacing: number; failures: ContractFailure[]; passedContracts: string[] }[]
}

export type BrowserFailure = { status: 'error'; message: string; measurement?: BrowserEnvironmentReport }

// Every page context has its own request. Older tabs cannot contribute rows or
// finish a later context, even when they still know the local server address.
export type BrowserRows = { requestId: string; sequence: number; rows: CaseResult[] }
export type BrowserProgress = { requestId: string; completed: number; total: number }
export type BrowserCompletion = { requestId: string; url: string; report: BrowserReport | BrowserFailure }
