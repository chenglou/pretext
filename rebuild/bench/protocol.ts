// Shapes shared by the bench driver (run.ts), the page (page.ts) and the report (report.ts).
import type { CssFont, Direction } from '../src/model.ts'

// 'webkit-host': the system WebKit.framework in rebuild/tools/webkit-host, background only. 'safari': installed Safari,
// foreground only.
export type BrowserKind = 'chrome' | 'firefox' | 'safari' | 'webkit-host'
export type Script = 'latin' | 'cjk' | 'arabic' | 'mixed'
export type SizeClass = 'tiny' | 'sentence' | 'paragraph' | 'long' | 'corpus'
export type Scenario = 'cold' | 'sweep' | 'many'
export type Library = 'main' | 'rebuild'

// One page context: every row of a script runs in one document whose <html lang> is `lang`.
export type ScriptStyle = {
  script: Script
  // <html lang> and the paragraph's lang attribute.
  lang: string
  // The rebuild's CSS font. main gets the same declaration as a canvas font string.
  font: CssFont
  mainFont: string
  direction: Direction
  lineHeight: number
}

export type RowSpec =
  | { kind: 'cold'; id: string; size: SizeClass; text: string; width: number }
  | { kind: 'sweep'; id: string; size: SizeClass; text: string; widths: number[] }
  | { kind: 'many'; id: string; messages: string[]; width: number }

export type Settings = {
  // Samples per variant: at least minSamples, at most samples, and no new round once the row spent budgetMs.
  samples: number
  minSamples: number
  // Calibrated rounds run and discarded before sampling.
  warmup: number
  // A sample repeats its operation until it spans max(minSampleMs, 20 timer steps).
  minSampleMs: number
  budgetMs: number
  foreground: boolean
  smoke: boolean
}

export type ContextPlan = {
  runId: string
  index: number
  count: number
  browser: BrowserKind
  // The engine build the driver read from the app bundle, given to the rebuild as GivenFacts.build.
  engineBuild: string
  style: ScriptStyle
  settings: Settings
  rows: RowSpec[]
}

export type PageSnapshot = {
  visibility: string
  focused: boolean
  devicePixelRatio: number
  innerWidth: number
  innerHeight: number
}

export type PageEnvironment = {
  userAgent: string
  pageLang: string
  crossOriginIsolated: boolean
  // The smallest nonzero step between successive performance.now() readings in a busy loop, and the distinct steps seen.
  timerResolutionMs: number
  timerSteps: number
  // performance.memory exists (Chrome), so a heap drop across a sample marks a collection during it.
  heapApi: boolean
  hardwareConcurrency: number
  screen: { width: number; height: number }
}

export type SampleStats = {
  n: number
  // Repetitions per sample, calibrated per variant.
  reps: number
  medianMs: number
  // Nearest rank.
  p95Ms: number
  minMs: number
  maxMs: number
  meanMs: number
  // Median absolute deviation.
  madMs: number
  // Samples above median + max(5 × MAD, median / 2): collections or interruptions.
  outliers: number
  // Samples across which performance.memory.usedJSHeapSize dropped, or null without the API.
  heapDropSamples: number | null
}

export type VariantResult = {
  variant: string
  library: Library
  // What one repetition does.
  desc: string
  // The variant this one is compared with in the table, or null.
  baseline: string | null
  // One repetition timed alone before calibration and warm-up (the row's inputs are new to both libraries then).
  firstMs: number
  // Per-repetition milliseconds, one entry per sample, in sampling order.
  samplesMs: number[]
  heapDrops: boolean[] | null
  stats: SampleStats
}

export type RowTiming = {
  id: string
  kind: Scenario
  size: SizeClass | null
  // UTF-16 units in the text, or summed over the messages.
  units: number
  messages: number | null
  widths: number[]
  // The library whose variants ran first in the first-repetition timing; it alternates by row.
  firstLibrary: Library
  minSampleMs: number
  elapsedMs: number
  start: PageSnapshot
  end: PageSnapshot
  variants: VariantResult[]
}

export type VariantCount = {
  variant: string
  // OffscreenCanvasRenderingContext2D and CanvasRenderingContext2D measureText calls during one repetition, and the
  // contexts it made (getContext calls on OffscreenCanvas and <canvas>).
  measureTextCalls: number
  contexts: number
  // Lines produced by that repetition, summed over widths or messages: main's line count, the rebuild's line boxes.
  lines: number
}

export type RowCount = {
  id: string
  variants: VariantCount[]
  // Whether the rebuild's three modes gave the same line ranges for every paragraph and width of the row.
  rebuildModesSameLines: boolean
}

export type RowPost = { runId: string; context: number; row: RowTiming }
export type ContextDonePost = { runId: string; context: number; environment: PageEnvironment; counts: RowCount[] }
