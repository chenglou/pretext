// The shapes the harness passes between its files: a case, what the browser recorded for it, and what a library build
// predicted for it. The case format is the per-engine rebuild's (rebuild/lab/types.ts) without inline structure, so its
// case sets load as they are.

// 'webkit-host' is the system WebKit.framework that installed Safari runs, in a background window (harness/webkit-host).
// 'ios' is Safari in an iOS simulator the harness boots for the job (browsers.ts).
export type BrowserKind = 'chrome' | 'firefox' | 'webkit-host' | 'safari' | 'ios'
export const BROWSERS: readonly BrowserKind[] = ['chrome', 'firefox', 'webkit-host', 'safari', 'ios']

// What each browser is to the harness:
// - `cases`: the browser whose cases it takes as well as its own; webkit-host runs installed Safari's engine.
// - `sample`: installed Safari, whose window has to stay uncovered while it records, is recorded on a seeded sample of
//   this many cases, which a new sample replaces, so cases with no recording are expected there.
// - `settleMs`: Firefox changes fonts under a page after it starts (harness/README.md, Browsers and pins): emoji beside
//   Arial laid out differently when recorded 11 s after launch than at 12, 15 or 30 s. So every job's first document is
//   held until this long after launch.
// - `textEmojiLast`: Firefox's cases holding U+FE0E go in documents after every other and are never pinned (score.ts).
// - `hyphenCopies`: Chrome reports a soft hyphen's box for the code point next to it too, which the recorder leaves out.
// - `systemWebKit`: the system WebKit's build is part of the environment key.
// - `wholePixelBoxes`: WebKit gives the rectangle of a range over part of a text box in whole pixels (RenderText.cpp,
//   selectionRectForTextBox, which ends in snappedSelectionRect's enclosingIntRect), so a width the recorder reads off
//   a character's box is exact only to a pixel there (score.ts, countWidths).
// - `background`: check, gate and the others run it by default, in the background.
// - `foreground`: the bench times it in the foreground, in these by default.
// - `phone`: a phone's browser, which lays text out at its CSS size only in the page an app serves it: a viewport meta
//   tag and `text-size-adjust: 100%` (run.ts). Its recordings are never checked in (cli.ts).
export const BROWSER: Record<BrowserKind, {
  cases: BrowserKind; sample: number | null; settleMs: number; textEmojiLast: boolean; hyphenCopies: boolean; systemWebKit: boolean
  wholePixelBoxes: boolean; background: boolean; foreground: boolean; phone: boolean
}> = {
  chrome: { cases: 'chrome', sample: null, settleMs: 0, textEmojiLast: false, hyphenCopies: true, systemWebKit: false, wholePixelBoxes: false, background: true, foreground: true, phone: false },
  firefox: { cases: 'firefox', sample: null, settleMs: 15_000, textEmojiLast: true, hyphenCopies: false, systemWebKit: false, wholePixelBoxes: false, background: true, foreground: true, phone: false },
  'webkit-host': { cases: 'safari', sample: null, settleMs: 0, textEmojiLast: false, hyphenCopies: false, systemWebKit: true, wholePixelBoxes: true, background: true, foreground: false, phone: false },
  safari: { cases: 'safari', sample: 2000, settleMs: 0, textEmojiLast: false, hyphenCopies: false, systemWebKit: true, wholePixelBoxes: true, background: false, foreground: true, phone: false },
  ios: { cases: 'safari', sample: null, settleMs: 0, textEmojiLast: false, hyphenCopies: false, systemWebKit: true, wholePixelBoxes: true, background: false, foreground: false, phone: true },
}

export type CssFont = { family: string; size: number; weight: number; style: 'normal' | 'italic' }

export type TextRun = {
  text: string
  // 'span': the text in its own <span> with this run's styles. 'text': a bare text node with the paragraph's styles.
  node: 'span' | 'text'
  font: CssFont
  letterSpacing: number
  wordSpacing: number
  // The span's lang attribute; null inherits the paragraph's.
  lang: string | null
  // A span only: an atomic chip (inline-block, no break inside, rich-inline's `break: 'never'`), and horizontal padding
  // on each side, repeated on every line the span reaches (rich-inline's `extraWidth` is twice it).
  atomic?: true
  padding?: number
  // A span only: a box, rich-inline's RichInlineBox, drawn as an empty inline-block of this width and height with
  // `vertical-align: top`, whose text is one U+FFFC, which stands for it in the paragraph's source offsets.
  box?: { width: number; height: number }
}

export type Paragraph = {
  runs: TextRun[]
  font: CssFont
  letterSpacing: number
  wordSpacing: number
  width: number
  lineHeight: number
  whiteSpace: 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
  wordBreak: 'normal' | 'break-all' | 'keep-all' | 'break-word'
  overflowWrap: 'normal' | 'break-word' | 'anywhere'
  lineBreak: 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
  tabSize: number
  direction: 'ltr' | 'rtl'
  lang: string
}

export type Case = {
  id: string
  // Generator family, e.g. 'real/chat' or 'catalog/soft-hyphen'.
  family: string
  // Where the case came from: a corpus line, a generator and seed, an issue.
  origin: string
  // <html lang> of the document the case runs in.
  pageLang: string
  paragraph: Paragraph
  // Browsers the case applies to; absent means all.
  browsers?: BrowserKind[]
  // Web fonts the page loads before anything measures, by family in harness/fonts/fonts.json.
  fontFixtures?: string[]
  // A draw of the real-usage sample: its group, which the interval resamples within, the share of real paragraphs it
  // stands for, and whether its text only stands in for the kind the draw asked for (harness/sets/sample.ts).
  sample?: { group: string; weight: number; standIn?: true }
  // A behaviour-catalog entry: the behaviour's name. Its cases are width 1, width 100000, and around each width where the
  // browser's lines change, 1/64 px either side (`edge`) and a width well inside each of the two layouts.
  behaviour?: string
  edge?: true
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.font.family === b.font.family && a.font.size === b.font.size && a.font.weight === b.font.weight
    && a.font.style === b.font.style && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing
}

// Whether the adapter (predict.ts) sends a case's runs through rich-inline: an app would write them with inline elements.
export function isRich(runs: readonly TextRun[]): boolean {
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if ((runs.length > 1 && run.node === 'span') || !sameStyle(run, runs[0]!) || run.atomic === true || run.padding !== undefined || run.box !== undefined) return true
  }
  return false
}

// `box`: the rect of a box (TextRun), which is a visible character whatever its width.
export type Rect = { x: number; y: number; width: number; height: number; box?: true }

// One line as the browser laid it out: the UTF-16 offsets of the code points that start its first and last visible
// character (-1 on a line without one), and the horizontal extent of the line's text boxes.
export type RecordedLine = { first: number; last: number; width: number }

// What `record` keeps of a case in one browser build. `error`: the browser refused a style, so its layout isn't the case's.
export type Recording = { lines: RecordedLine[]; height: number } | { error: string }

export type PredictedLine = { start: number; end: number; width: number }

// How a pinned case fared (score.ts): 'count', a wrong line count; 'breaks', the right count with a visible character on
// another line; 'error', no prediction.
export type Status = 'pass' | 'count' | 'breaks' | 'error'
export type Failure = Exclude<Status, 'pass'>

// What a library build predicted: the walk's lines (predict.ts), a 32-bit hash of their text (of their fragments' for a
// rich case; older adapters send none), the measureText calls made while preparing and while the line
// APIs ran (they should make none), the UTF-16 units submitted while preparing, and the first way another line API
// disagrees with the walk, or null.
// `unsupported`: the adapter can't express the case. `error`: the library threw.
export type Prediction =
  | { lines: PredictedLine[]; textHash?: number; prepareCalls: number; prepareUnits: number; lineCalls: number; disagreement: string | null }
  | { unsupported: string }
  | { error: string }

// What the page reports about the browser it runs in. Part of the environment key.
export type PageEnv = { userAgent: string; devicePixelRatio: number; languages: string[] }
