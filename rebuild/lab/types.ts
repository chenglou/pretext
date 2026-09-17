// Shared data shapes for the rebuild's observation lab. The lab owns this file; generators use the case
// shapes, the page and scorer use all of it.

// 'webkit-host': the system WebKit.framework, the engine installed Safari runs, in rebuild/tools/webkit-host. Its rows stay
// apart from Safari's; it takes Safari's cases and is scored like Safari.
export type BrowserKind = 'chrome' | 'safari' | 'firefox' | 'webkit-host'

// The styled paragraph is the library's input, defined once in rebuild/src/model.ts.
import type { Paragraph } from '../src/model.ts'
export type { FontDecl, Paragraph, TextRun } from '../src/model.ts'

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
  // Per run, the Range client rects of its whole text node: one rect per box the node has on each line. Safari snaps
  // a Range edge that falls inside a text box to whole CSS px, but reports box edges unsnapped.
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

export type Prediction = {
  lines: PredictionLine[]
  // Number of measureText calls, when the predictor reports it.
  measureLog?: number
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
  // relative to the host, unfiltered. The scorer takes the painted extent from these the way it takes native widths, so
  // trimmed and hanging white space don't count. Absent in rows from before these fields.
  text?: string
  points?: CodePointObservation[]
}

export type PainterObservation = { lines: PainterLine[] }

export type LabRow = {
  id: string
  family: string
  browser: BrowserKind
  // The case exactly as the driver served it.
  case: Case
  env: PageEnv
  // `skipped`: run.ts --predict-only records predictions without observing native layout; score.ts --native-rows takes
  // the native observation from another run's row for the same case.
  native: NativeObservation | { error: string } | { skipped: string }
  prediction: Prediction | { error: string }
  // null when paint returned null or there was no prediction.
  painter: PainterObservation | { error: string } | null
  timings: { nativeMs: number; predictMs: number; paintMs: number; painterObserveMs: number }
}
