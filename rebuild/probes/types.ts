// Shared shapes for the probe runner. A probe is plain data (JSON-serializable): the driver validates it, serves it
// to the page, and the page records raw observations. Verdicts are computed afterwards from the output file.

import type { LabApp } from '../lab/browser-build.ts'
import type { BrowserBuild } from '../lab/types.ts'

// 'webkit-host': the system WebKit.framework, the engine installed Safari runs, in rebuild/tools/webkit-host. Its output
// stays apart from Safari's; it takes Safari's probes.
export type BrowserKind = 'chrome' | 'safari' | 'firefox' | 'webkit-host'

// 'offscreen': `new OffscreenCanvas(1, 1)` on the main thread.
// 'element': a `<canvas>` connected to the document (appended to the probe host).
// 'worker': `new OffscreenCanvas(1, 1)` inside a dedicated worker created for the probe.
// 'transferred': a connected `<canvas>` whose `transferControlToOffscreen()` result is measured inside the worker.
export type CanvasKind = 'offscreen' | 'element' | 'worker' | 'transferred'

// Context properties a canvas entry can assign. They're assigned in the order the keys appear in the entry object,
// and only when present, so an absent key leaves the context's current value (a fresh context keeps its default).
export const CANVAS_PROPERTIES = ['font', 'letterSpacing', 'wordSpacing', 'textRendering', 'fontKerning', 'fontVariantCaps', 'fontStretch', 'direction', 'lang'] as const
export type CanvasProperty = typeof CANVAS_PROPERTIES[number]

export type CanvasMeasure = {
  kind: CanvasKind
  // measureText(text).width is the observation.
  text: string
  // Entries with the same key share one canvas and context within the probe, in entry order; the kind must match.
  // Absent: a fresh canvas and context for this entry alone.
  context?: string
  font?: string
  letterSpacing?: string
  wordSpacing?: string
  textRendering?: string
  fontKerning?: string
  fontVariantCaps?: string
  fontStretch?: string
  direction?: string
  lang?: string
  // 'element' and 'transferred', first entry of a context only: the `<canvas>` element's lang attribute and inline
  // style when it's created.
  elementLang?: string
  elementStyle?: string
  // Before this entry's assignments: set `<html lang>` (null removes the attribute). It stays changed until the probe
  // ends; the page then restores the document's own value.
  pageLang?: string | null
  // 'offscreen' and 'element' only: before this entry's assignments, wait for this many animation frames, drawing
  // `fillRect(0, 0, 1, 1)` on the context in each frame callback.
  frames?: number
}

export type ObservationSpec =
  // Per code point Range rects of the target's text, grouped into lines.
  | 'lines' | { kind: 'lines'; selector?: string }
  // getBoundingClientRect and getClientRects of each element matching the selectors inside the host. The string
  // form observes the test element itself.
  | 'boxWidth' | { kind: 'boxWidth'; selectors: string[] }
  // Range over the target's contents: client rects, bounding rect and the horizontal extent of positive rects.
  | 'rangeWidth' | { kind: 'rangeWidth'; selector?: string }
  // Runs the probe's canvas entries in order.
  | 'canvasWidths' | { kind: 'canvasWidths' }
  // Environment, plus document.fonts.check and a measurement-based resolution test for each named family.
  | 'env' | { kind: 'env'; families?: string[] }
  // Escape hatch: the body of an async function with parameters (host, element); its JSON-serializable return
  // value is recorded.
  | { kind: 'script'; source: string }

export type Probe = {
  id: string
  // Spec and hypothesis this probe tests, e.g. 'blink-canvas H7'.
  spec: string
  // <html lang> of the probe's document. null omits the attribute (only for probes about a missing lang); '' writes
  // lang="".
  pageLang: string | null
  // Markup of exactly one test element, inserted into the host with innerHTML (no surrounding white space). The HTML
  // parser turns CR and CRLF into LF and NUL into U+FFFD; set such text from `setup`.
  html?: string
  // Body of an async function with parameters (host, element), run after the markup is inserted and before anything
  // is observed. For text the parser can't carry (CR), several adjacent text nodes, or other DOM building.
  setup?: string
  canvas?: CanvasMeasure[]
  // Observations in the order they run.
  observe: ObservationSpec[]
  // Host width in CSS px (default 1000). The host is `position: fixed` at (0, 0) with no margin, padding or border.
  hostWidth?: number
  // Web fonts from tests/wrapping/fonts/fonts.json, by family, loaded as FontFace objects before the document runs any
  // probe (and into the worker's FontFaceSet when a worker is used).
  fontFixtures?: string[]
  // Browsers the probe applies to; absent means all.
  browsers?: BrowserKind[]
  // Probes with the same document key run consecutively in one document (they must share pageLang and fontFixtures).
  // Absent: the probe gets a fresh document of its own.
  document?: string
  // Free text for the verdict author; not used by the runner.
  note?: string
}

// ---- Raw results ----

export type Rect = { x: number; y: number; width: number; height: number }

export type LinePoint = {
  // UTF-16 offset into the target's textContent and 1 or 2 units.
  offset: number
  length: number
  // Index into `nodes`.
  node: number
  // Every Range client rect, unfiltered (zero-area rects included).
  rects: Rect[]
}

export type ObservedLine = {
  // Offsets of the first and past the last visible code point assigned to the line, and the text between them.
  start: number
  end: number
  text: string
  // Horizontal and vertical extent of the positive rects of the line's visible code points.
  left: number
  right: number
  top: number
  bottom: number
  // Vertical centre of the first positive rect that started the line.
  centre: number
  visiblePoints: number
}

export type LinesObservation = {
  kind: 'lines'
  selector: string | null
  text: string
  box: Rect
  computedLineHeight: string
  // Code points whose first positive rect has its centre within this distance of a line's centre join that line:
  // half the computed line height when it's in px, otherwise half the first positive rect's height.
  groupThreshold: number
  // Lines sorted by centre.
  lines: ObservedLine[]
  // Line start offsets (ObservedLine.start), in line order.
  lineStarts: number[]
  points: LinePoint[]
  // Per text node in tree order: its offset into textContent, its length and the rects of a Range over the whole node.
  nodes: Array<{ offset: number; length: number; rects: Rect[] }>
  // Offsets of code points with positive rects on more than one line.
  multiLine: number[]
  // True when two lines' [start, end) ranges overlap.
  interleaved: boolean
}

export type BoxObservation = {
  kind: 'boxWidth'
  // selector null: the test element itself.
  boxes: Array<{ selector: string | null; matches: Array<{ tag: string; rect: Rect; clientRects: Rect[] }> }>
}

export type RangeObservation = {
  kind: 'rangeWidth'
  selector: string | null
  text: string
  rects: Rect[]
  bounding: Rect
  // Extent of the rects with positive width and height; null when there are none.
  extent: { left: number; right: number; width: number } | null
}

export type CanvasResult = {
  index: number
  kind: CanvasKind
  context: string | null
  text: string
  // Assignments made, in order, with the error text when the setter threw.
  assignments: Array<{ property: CanvasProperty; value: string; error?: string }>
  // Context property values read back right before measuring; null when the context has no such property.
  readback: Record<CanvasProperty, string | null>
  width: number | null
  actualBoundingBoxLeft: number | null
  actualBoundingBoxRight: number | null
  pageLangAttribute: string | null
  frames?: { requested: number; completed: number }
  error?: string
}

export type CanvasObservation = { kind: 'canvasWidths'; entries: CanvasResult[] }

export type FamilyCheck = {
  family: string
  // document.fonts.check('16px "<family>"'). Browsers answer true for installed fonts that aren't in the FontFaceSet
  // and sometimes for families that don't exist; treat it as raw.
  check: boolean | null
  // A probe string at 64px measured differently from at least one of two generic fallbacks.
  resolves: boolean
}

export type EnvObservation = {
  kind: 'env'
  userAgent: string
  devicePixelRatio: number
  visualViewportScale: number | null
  pageLangAttribute: string | null
  navigatorLanguage: string
  navigatorLanguages: string[]
  intlLocale: string
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  screenWidth: number
  screenHeight: number
  visibilityState: string
  hasFocus: boolean
  fontsStatus: string
  fontFixtures: string[]
  families: FamilyCheck[]
  features: { offscreenCanvas: boolean; contextLang: boolean; contextLetterSpacing: boolean; transferControlToOffscreen: boolean; v8BreakIterator: boolean }
}

export type ScriptObservation = { kind: 'script'; value: unknown }

export type Observation = LinesObservation | BoxObservation | RangeObservation | CanvasObservation | EnvObservation | ScriptObservation
  | { kind: string; error: string }

export type ProbeResult = {
  id: string
  // document.fonts.status right after the markup was laid out, and after awaiting document.fonts.ready.
  fontsStatusBefore: string
  fontsStatusAfter: string
  observations: Observation[]
  // Errors outside a single observation: markup, setup, timeout.
  errors: string[]
  ms: number
}

// What the page reports alongside each document's results; the driver flags a change during the run.
export type PageEnv = { userAgent: string; devicePixelRatio: number; visualViewportScale: number | null; visibilityState: string; hasFocus: boolean }

export type ProbeOutput = {
  status: 'ok' | 'error'
  foreground?: boolean
  isolated?: boolean
  requireClean?: boolean
  errors: string[]
  browser: BrowserKind
  // The browser build the runner read from the app bundles before launch (lab/browser-build.ts). Absent in outputs recorded
  // before 2026-09-16 23:40; facts extracted from those take the build as given (rebuild/tests/facts.ts).
  build?: BrowserBuild
  // The app bundle the runner launched (lab/browser-build.ts LabApp); null for webkit-host. Absent before 2026-09-17 20:00.
  app?: LabApp | null
  runId: string
  probesFile: string
  only: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
  totals: { selected: number; documents: number; results: number; probesWithErrors: number; observationErrors: number; reloads: number; resends: number }
  envs: Array<PageEnv & { documents: number }>
  // One per selected probe, in run order (documents in order of first appearance, probes in file order within one);
  // `result` is null when the run stopped before the probe ran.
  results: Array<{ id: string; spec: string; document: number; probe: Probe; result: ProbeResult | null }>
}
