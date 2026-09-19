// Shapes shared by the bench driver (run.ts), the page (page.ts) and the report (report.ts).
import type { CssFont, Direction } from '../src/model.ts'

// 'webkit-host': the system WebKit.framework in rebuild/tools/webkit-host, background only. 'safari': installed Safari,
// foreground only.
export type BrowserKind = 'chrome' | 'firefox' | 'safari' | 'webkit-host'
export type Script = 'latin' | 'cjk' | 'arabic' | 'mixed'
export type SizeClass = 'tiny' | 'sentence' | 'paragraph' | 'long' | 'corpus'
export type Scenario = 'cold' | 'sweep' | 'many' | 'chat'
export type Library = 'main' | 'rebuild'

// One page context: every row of a script runs in one document whose <html lang> is `lang`. 'chat' is the chat rows'
// context (README.md, "Chat").
export type ScriptStyle = {
  script: Script | 'chat'
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
  // The first `ChatPlan.timed` messages of one of the plan's chat sets.
  | { kind: 'chat'; id: string; set: ChatSetId }

// ---- Chat (README.md, "Chat") ----

// 'mix': chat-like messages of every kind below. 'latin': plain ASCII messages only, the common case.
export type ChatSetId = 'mix' | 'latin'

// What a message is made of. 'latin' is printable ASCII; 'latin-smart' keeps the source's curly quotes and dashes, which
// make the text 16-bit; the next three are ASCII text with an emoji, a URL, or one inline code span; 'app-mixed' is a
// slice of corpora/mixed-app-text.txt (several scripts, emoji sequences, a URL, soft hyphens).
export type ChatKind = 'latin' | 'latin-smart' | 'latin-emoji' | 'latin-url' | 'latin-code' | 'cjk' | 'arabic' | 'app-mixed'

// A message is its parts in order. A `code` part is an inline code span: a span in another font with padding on both
// inline sides in the rebuild's paragraph tree, an item with extraWidth in main's rich-inline helper.
export type ChatPart = { code: boolean; text: string }
export type ChatMessage = { kind: ChatKind; parts: ChatPart[] }

export type ChatPlan = {
  // The inline code span: its font, main's font string for it, and the padding on each inline side in CSS px.
  codeFont: CssFont
  codeMainFont: string
  codePadding: number
  // The width every message is first laid out at, and the other widths of the resize case.
  width: number
  resizeWidths: number[]
  // Every set holds max(timed, headline) messages. The timed rows, the counts and the phase pass use the first `timed`;
  // the headline passes use the first `headline` (0: no headline pass).
  sets: { id: ChatSetId; messages: ChatMessage[] }[]
  timed: number
  headline: number
  headlinePasses: number
  phasePasses: number
}

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
  // The chat sets of a context with chat rows, else null.
  chat: ChatPlan | null
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
  // A fixed piece of integer arithmetic timed in the page before the first row and after the last, in ms. It says nothing
  // about either library; it shows whether the page ran slower than the same build does elsewhere (a background window
  // the OS scheduled down, a busy machine), and whether that changed during the context.
  spinMs: { start: number; end: number }
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
  // Paragraph layouts one repetition makes, where the report divides by them (chat rows: the messages, times the widths
  // in a resize variant), else null.
  layouts: number | null
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
  // Whether the rebuild's three modes gave the same line ranges for every paragraph and width of the row. In a chat row
  // the paragraphs prepared with the font checks lifted are held against them too.
  rebuildModesSameLines: boolean
}

// One headline pass per entry, each the whole set once, in ms: the rebuild from scratch in count mode, and main's cold
// batch. The two alternate, and which goes first alternates by pass.
export type ChatHeadline = {
  set: ChatSetId
  messages: number
  rebuildScratchMs: number[]
  // The rebuild from scratch with one measurer for the pass's messages, made inside the timing (Kept 'both').
  rebuildKeepingMs: number[]
  mainColdMs: number[]
  lines: { rebuild: number; rebuildKeeping: number; main: number }
}

// What a page's measurer serves in a variant that keeps one across messages (rebuild/src/measure/font-checks.ts Measurer):
// both halves of prepare(), which is prepare() handed the measurer, or one half alone while the other gets the call's own,
// which shows what each half's share of the gain is.
export type Kept = 'both' | 'checks' | 'contexts'

// The resize case on the headline set, once: every message prepared and filled at `ChatPlan.width` (timed as
// `rebuildPrepareAndFillMs`, `mainPrepareAndLayoutMs`), all of them kept, then every message laid out at each of the
// resize widths (`rebuildResizeMs`, `mainResizeMs`: the whole set at every width, so layouts = messages × widths).
export type ChatHeadlineResize = {
  set: ChatSetId
  messages: number
  widths: number[]
  rebuildPrepareAndFillMs: number
  rebuildResizeMs: number
  // The same on paragraphs prepared with one measurer, which share their Canvas contexts.
  rebuildKeepingPrepareAndFillMs: number
  rebuildKeepingResizeMs: number
  mainPrepareAndLayoutMs: number
  mainResizeMs: number
}

// What one phase of the rebuild's from-scratch work took over a set, with the counting and timing wrappers on: all of it,
// the part inside measureText, and the part making contexts (the OffscreenCanvas constructor, getContext and the
// assignments to the context's text attributes).
export type PhaseTotals = { ms: number; measureTextMs: number; measureTextCalls: number; contextMs: number; contexts: number }

// Where the rebuild's from-scratch time goes, from one instrumented pass over the first `timed` messages of a set, the
// median of `passes` passes field by field. The phases are index.ts prepare()'s two halves and the line loop: the runtime
// font checks (measure/font-checks.ts withLearnedFontFacts), the engine's prepare, and fillLine over every line.
export type ChatPhases = {
  set: ChatSetId
  // Whether every pass made one measurer for its messages; false: every message its own.
  keeping: boolean
  messages: number
  passes: number
  checks: PhaseTotals
  prepare: PhaseTotals
  fill: PhaseTotals
  byKind: { kind: ChatKind; messages: number; units: number; checksMs: number; prepareMs: number; fillMs: number; measureTextCalls: number; contexts: number }[]
  // One performance.now() call, measured in a loop. Every wrapped Canvas call adds two of them to the pass, so the pass
  // is slower than the timed rows; read its shares, and the timed rows for the totals.
  nowMs: number
}

export type RowPost = { runId: string; context: number; row: RowTiming }
export type ChatPost = {
  runId: string
  context: number
  part: { kind: 'headline'; result: ChatHeadline } | { kind: 'headline-resize'; result: ChatHeadlineResize } | { kind: 'phases'; result: ChatPhases }
}
// The counts go on their own, as soon as they are made: the chat context still has a timed part after them.
export type CountsPost = { runId: string; context: number; counts: RowCount[] }
export type ContextDonePost = { runId: string; context: number; environment: PageEnvironment }
