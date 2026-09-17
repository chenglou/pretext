// Shared data shapes for the rebuild's observation lab. The lab owns this file; generators use the case
// shapes, the page and scorer use all of it.

// 'webkit-host': the system WebKit.framework, the engine installed Safari runs, in rebuild/tools/webkit-host. Its rows stay
// apart from Safari's; it takes Safari's cases and is scored like Safari.
export type BrowserKind = 'chrome' | 'safari' | 'firefox' | 'webkit-host'

// The styled paragraph is defined once in rebuild/src/model.ts. A case describes the page, so its fonts are CSS fonts
// without the font facts the library also takes; predictor.ts adds those (DESIGN.md §1.2), and they don't enter case ids.
import type { CssFont, ExpectedObservation, Paragraph as LibraryParagraph, ParagraphLayout, ParagraphOf, TextRunOf } from '../src/model.ts'
export type FontDecl = CssFont
export type TextRun = TextRunOf<CssFont>
export type Paragraph = ParagraphOf<CssFont>

export type Case = {
  id: string
  // Generator family, e.g. 'suite/pre-wrap' or 'runs/split-word'.
  family: string
  // Provenance: old suite row id, generator name and seed.
  origin: string
  // <html lang> of the page the case runs in.
  pageLang: string
  paragraph: Paragraph
  // Browsers the case applies to; absent means all.
  browsers?: BrowserKind[]
  // Web fonts the page must load before observing, by family name from tests/wrapping/fonts/fonts.json
  // (every weight listed there). Only imported old-suite fixture cases (Amiri, Noto Naskh Arabic, Noto
  // Nastaliq Urdu, ProbeShantell, Shantell Sans) set it; absent means installed fonts only.
  fontFixtures?: string[]
}

export type Rect = { x: number; y: number; width: number; height: number }

// ---- Lab runtime rows (page.ts writes them, run.ts streams them, score.ts reads them) ----

// The browser build a run observed, read by the driver from the app bundles before launch (research/TEST-ARCHITECTURE.md
// §4.3): user agents can't tell builds apart (Chrome's says 153.0.0.0 for every 153 build).
export type BrowserBuild = {
  // The bundle's name: 'Google Chrome', 'Firefox', 'Safari', or 'webkit-host', which has no bundle of its own.
  app: string
  // CFBundleShortVersionString of Chrome, Firefox or Safari; installed Safari's for webkit-host, whose user agent copies it.
  appVersion: string
  // The build the library's ports pin (GivenFacts.build, DESIGN.md §1.4): Chrome's and Firefox's appVersion,
  // WebKit.framework's CFBundleVersion for Safari and webkit-host.
  engine: string
  // sw_vers -buildVersion. Fonts, Core Text and libicucore move with it.
  os: string
}

export type PageEnv = {
  userAgent: string
  devicePixelRatio: number
  // visualViewport.scale, or null when the browser has no visualViewport.
  visualViewportScale: number | null
  // document.documentElement.lang when the case ran.
  pageLang: string
  // Fixture web font families the page loaded (Case.fontFixtures), sorted.
  fontFixtures: string[]
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  visibilityState: string
  hasFocus: boolean
  // How many cases this document observed before this one, and the id of the last of them (null for the first). The page
  // reloads on every page-context change, so this is the case's in-page history. Absent in rows from before these fields.
  documentCaseIndex?: number
  previousCaseId?: string | null
}

// One code point of the concatenated run text.
export type CodePointObservation = {
  // UTF-16 offset into the concatenation of all run texts.
  offset: number
  // 1 or 2 UTF-16 units.
  length: number
  // Every Range client rect, relative to the paragraph's content box, unfiltered (zero-width rects included).
  rects: Rect[]
}

export type NativeObservation = {
  // document.fonts.status right after the paragraph was laid out, and after awaiting document.fonts.ready.
  fontsStatusBefore: string
  fontsStatusAfter: string
  // CSS properties whose value the browser refused (the inline style stayed empty), so native layout used another value.
  rejectedStyles: string[]
  // Paragraph border-box height and width in CSS px (no padding or border, so this is the content box).
  height: number
  width: number
  points: CodePointObservation[]
  // Per run, the Range client rects of its whole text node: one rect per box the node has on each line.
  runRects: Rect[][]
  // Named families in the paragraph's or runs' font lists that the page couldn't resolve (a probe string measured the
  // same as with two generic fallbacks), so native layout used a fallback. Absent in rows from before this field.
  missingFonts?: string[]
}

export type PredictionLine = {
  // UTF-16 offsets into the concatenated run text.
  start: number
  end: number
  // Predicted line width in CSS px.
  width: number
}

// A prediction of line ranges alone: an external predictor such as baselines/main-predictor.ts, and every row recorded
// before the page ran the observation ports (2026-09-16 and earlier). Only the line count can be scored against it.
export type LinesPrediction = {
  lines: PredictionLine[]
  // Number of measureText calls, when the predictor reports it.
  measureLog?: number
}

// What predictor.ts gives the page for an engine prediction: the library's input, with the font facts the predictor gave,
// and its layout. The page runs the observation port over them and records an EnginePrediction.
export type LayoutPrediction = { paragraph: LibraryParagraph; layout: ParagraphLayout }

// ParagraphLayout as a row keeps it: every engine line with its geometry, fragments and gaps, the environment and the
// paragraph's gaps, without the Canvas call log (counted in EnginePrediction.measure).
type WithoutMeasure<Layout> = Layout extends unknown ? Omit<Layout, 'measure'> : never
export type RecordedLayout = WithoutMeasure<ParagraphLayout>

// What rebuild/src computed for the case, and what lab/observe/<engine>.ts expects the browser to report for it, measured
// live in the page (DESIGN.md §9).
export type EnginePrediction = {
  layout: RecordedLayout
  measure: { contexts: number; calls: number; memoHits: number }
  // An error when the observation port threw: a lab failure, not a prediction.
  observation: ExpectedObservation | { error: string }
}

export type PainterLine = {
  // getBoundingClientRect of the line element, relative to the host.
  box: Rect
  height: number
  // Range client rects of every text node inside the element, relative to the host.
  rects: Rect[]
  // Horizontal extent of the positive-width rects in `rects`, or null when there are none.
  extent: { left: number; right: number } | null
  // The element's text nodes concatenated in document order, and every Range client rect of each of its code points,
  // relative to the host, unfiltered. Absent in rows from before these fields.
  text?: string
  points?: CodePointObservation[]
}

export type PainterObservation = { lines: PainterLine[] }

export type LabRow = {
  id: string
  family: string
  browser: BrowserKind
  // The browser build the driver read before launch. Absent in rows from before the driver recorded it.
  build?: BrowserBuild
  // The case exactly as the driver served it.
  case: Case
  env: PageEnv
  native: NativeObservation | { error: string }
  prediction: EnginePrediction | LinesPrediction | { error: string }
  // null when paint returned null or there was no prediction.
  painter: PainterObservation | { error: string } | null
  // observeMs: the observation port. Absent in rows from before the page ran it.
  timings: { nativeMs: number; predictMs: number; observeMs?: number; paintMs: number; painterObserveMs: number }
}
