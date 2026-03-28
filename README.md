# Pretext

Pure JavaScript/TypeScript library for multiline text measurement & layout. Fast, accurate & supports all the languages you didn't even know about. Allows rendering to DOM, Canvas, SVG and soon, server-side.

Pretext side-steps the need for DOM measurements (e.g. `getBoundingClientRect`, `offsetHeight`), which trigger layout reflow, one of the most expensive operations in the browser. It implements its own text measurement logic, using the browsers' own font engine as ground truth (very AI-friendly iteration method).

## Installation

```sh
npm install @chenglou/pretext
```

## Demos

Clone the repo, run `bun install`, then `bun start`, and open the `/demos` in your browser (no trailing slash. Bun devserver bugs on those)
Alternatively, see them live at [chenglou.me/pretext](https://chenglou.me/pretext/). Some more at [somnai-dreams.github.io/pretext-demos](https://somnai-dreams.github.io/pretext-demos/)

- [**Masonry**](https://chenglou.me/pretext/masonry/) — Occlusion (virtualization) of hundreds of thousands of text boxes, each with differing height, without DOM measurement. The visibility check is a single linear cache-less traversal of heights, scrolling & resizing at 120fps.
- [**Bubbles**](https://chenglou.me/pretext/bubbles/) — Shrinkwrapped chat bubbles using `walkLineRanges()` to find the tightest container width.
- [**Dynamic Layout**](https://chenglou.me/pretext/dynamic-layout) — Multi-column magazine layout, but _responsive_ and dynamic. Fixed-height editorial spread with continuous two-column flow, obstacle-aware title routing, and live logo-driven reflow.
- [**Variable Typographic ASCII**](https://chenglou.me/pretext/variable-typographic-ascii) — Variable font width ASCII art, because why not, it's easy now.
- [**Accordion**](https://chenglou.me/pretext/accordion/) — Your typical auto-growing text area, accordion, multi-line text centering, pure canvas multiline text, and all other things that used to be real CSS challenges, now reduced to a boring footnote.

## API

Pretext serves 2 use cases:

### 1. Measure a paragraph's height _without ever touching DOM_

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀', '16px Inter')
const { height, lineCount } = layout(prepared, textWidth, 20) // pure arithmetics. No DOM layout & reflow!
```

`prepare()` does the one-time work: normalize whitespace, segment the text, apply glue rules, measure the segments with canvas, and return an opaque handle. `layout()` is the cheap hot path after that: pure arithmetic over cached widths.

If you want textarea-like text where ordinary spaces, `\t` tabs, and `\n` hard breaks stay visible, pass `{ whiteSpace: 'pre-wrap' }` to `prepare()` / `prepareWithSegments()`.

```ts
const prepared = prepare(textareaValue, '16px Inter', { whiteSpace: 'pre-wrap' })
const { height } = layout(prepared, textareaWidth, 20)
```

On the current checked-in benchmark snapshot:
- `prepare()` is about `19ms` for the shared 500-text batch
- `layout()` is about `0.09ms` for that same batch

We support all the languages you can imagine, including emojis and mixed-bidi, and caters to specific browser quirks

The returned height is the crucial last piece for unlocking web UI's:
- proper virtualization/occlusion without guesstimates & caching
- fancy userland layouts: masonry, JS-driven flexbox-like implementations, nudging a few layout values without CSS hacks (imagine that), etc.
- _development time_ verification (especially now with AI) that labels on e.g. buttons don't overflow to the next line, browser-free
- prevent layout shift when new text loads and you wanna re-anchor the scroll position

### 2. Lay out the paragraph lines manually yourself

Switch out `prepare` with `prepareWithSegments`, then:

- `layoutWithLines()` gives you all the lines at a fixed width:

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('AGI 春天到了. بدأت الرحلة 🚀', '18px "Helvetica Neue"')
const { lines } = layoutWithLines(prepared, 320, 26) // 320px max width, 26px line height
for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].text, 0, i * 26)
```

- `walkLineRanges()` gives you line widths and cursors without building the text strings:

```ts
let maxW = 0
walkLineRanges(prepared, 320, line => { if (line.width > maxW) maxW = line.width })
// maxW is now the widest line — the tightest container width that still fits the text! This multiline "shrink wrap" has been missing from web
```

- `layoutNextLine()` lets you route text one row at a time when width changes as you go:

```ts
let cursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

// Flow text around a floated image: lines beside the image are narrower
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const line = layoutNextLine(prepared, cursor, width)
  if (line === null) break
  ctx.fillText(line.text, 0, y)
  cursor = line.end
  y += 26
}
```

This usage allows rendering to canvas, SVG, WebGL and (eventually) server-side.

### API Glossary

Use-case 1 APIs:
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedText // one-time text analysis + measurement pass, returns an opaque value to pass to `layout()`. Make sure `font` is synced with your css `font` declaration shorthand (e.g. size, weight, style, family) for the text you're measuring. `font` is the same format as what you'd use for `myCanvasContext.font = ...`, e.g. `16px Inter`.
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // calculates text height given a max width and lineHeight. Make sure `lineHeight` is synced with your css `line-height` declaration for the text you're measuring.
```

Use-case 2 APIs:
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }): PreparedTextWithSegments // same as `prepare()`, but returns a richer structure for manual line layouts needs
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // high-level api for manual layout needs. Accepts a fixed max width for all lines. Similar to `layout()`'s return, but additionally returns the lines info
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // low-level api for manual layout needs. Accepts a fixed max width for all lines. Calls `onLine` once per line with its actual calculated line width and start/end cursors, without building line text strings. Very useful for certain cases where you wanna speculatively test a few width and height boundaries (e.g. binary search a nice width value by repeatedly calling walkLineRanges and checking the line count, and therefore height, is "nice" too. You can have text messages shrinkwrap and balanced text layout this way). After walkLineRanges calls, you'd call layoutWithLines once, with your satisfying max width, to get the actual lines info.
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // iterator-like api for laying out each line with a different width! Returns the LayoutLine starting from `start`, or `null` when the paragraph's exhausted. Pass the previous line's `end` cursor as the next `start`.
type LayoutLine = {
  text: string // Full text content of this line, e.g. 'hello world'
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutLineRange = {
  width: number // Measured width of this line, e.g. 87.5
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutCursor = {
  segmentIndex: number // Segment index in prepareWithSegments' prepared rich segment stream
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
```

Other helpers:
```ts
clearCache(): void // clears Pretext's shared internal caches used by prepare() and prepareWithSegments(). Useful if your app cycles through many different fonts or text variants and you want to release the accumulated cache
setLocale(locale?: string): void // optional (by default we use the current locale). Sets locale for future prepare() and prepareWithSegments(). Internally, it also calls clearCache(). Setting a new locale doesn't affect existing prepare() and prepareWithSegments() states (no mutations to them)
```

## How It Works

Two-phase architecture: expensive one-time `prepare()`, then cheap per-resize `layout()`.

### Prepare Phase

`prepare(text, font)` does all the heavy lifting upfront and returns an opaque handle.

**Text analysis** (no canvas yet):
1. **Normalize whitespace.** In `'normal'` mode, collapse runs of spaces/tabs/newlines to single spaces, strip leading/trailing. In `'pre-wrap'` mode, preserve spaces, tabs, and `\n` hard breaks; only normalize `\r\n` to `\n`.
2. **Segment via `Intl.Segmenter`.** The browser's locale-aware word boundary algorithm. Handles CJK (per-character boundaries), Thai (no-space script), Arabic, and every other script the browser knows.
3. **Classify segments.** Each segment gets a break kind: `text`, `space`, `preserved-space`, `tab`, `glue` (NBSP/NNBSP/word joiner), `zero-width-break` (ZWSP), `soft-hyphen`, or `hard-break`.
4. **Apply glue rules.** Merge closing punctuation (`.`, `,`, `!`, `)`, etc.) into the preceding word so `"better."` is one unit. Merge opening quotes into the following word. Keep NBSP-style glue attached to adjacent text. Keep URL-like runs and numeric/time-range runs together.
5. **CJK grapheme splitting + kinsoku.** CJK text is split into per-grapheme segments (one per ideograph/kana), then [kinsoku shori](https://en.wikipedia.org/wiki/Line_breaking_rules_in_East_Asian_languages) rules re-merge line-start-prohibited punctuation (。、！ etc.) with the preceding grapheme and line-end-prohibited punctuation (「【 etc.) with the following.
6. **Script-specific fixes.** Arabic no-space punctuation clusters, Myanmar medial glue, escaped quote clusters, and similar edge cases are handled in preprocessing so the line breaker stays simple.

**Measurement** (canvas):
1. **Measure each segment** via `canvas.measureText()`. Cache results in a shared `Map<font, Map<segment, metrics>>` so repeated words across texts are free.
2. **Emoji correction.** Chrome/Firefox on macOS inflate emoji widths in canvas at font sizes below ~24px. Pretext auto-detects this by comparing one canvas measurement against one cached DOM read per font, then subtracts the constant per-emoji-grapheme correction. Safari doesn't need it.
3. **Pre-measure grapheme widths** for segments that might need overflow-wrap word breaking (long words wider than `maxWidth`). These are measured lazily and cached alongside the segment.
4. **Detect browser engine quirks.** A one-time engine profile captures line-fit epsilon (Safari 1/64px vs Chrome/Firefox 0.005px), whether CJK carries after closing quotes (Chromium), and whether prefix-sum widths are more accurate for breakable runs (Safari).

The output is a set of parallel arrays (widths, break kinds, line-end advances, grapheme widths) packed into the opaque `PreparedText` handle. In `'pre-wrap'` mode, the text is also pre-split into chunks at hard-break boundaries.

### Layout Phase

`layout(prepared, maxWidth, lineHeight)` walks cached segment widths with pure arithmetic. No DOM reads, no canvas calls, no string work, no allocations beyond the return value. ~0.0002ms per text.

The line breaker implements CSS `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`, `line-break: auto`:

- **Greedy left-to-right.** Accumulate segment widths. At each break opportunity (after spaces, ZWSP, soft hyphens), record a pending break point. When the line overflows, take the last pending break.
- **Overflow-wrap fallback.** If a single word is wider than the line and there's no pending break, break at the last grapheme boundary that fits.
- **Trailing whitespace hangs** past the line edge without triggering breaks (CSS behavior). The algorithm tracks both fit-width (for break decisions) and paint-width (for reported line width).
- **Hard breaks** (`\n` in pre-wrap) force an unconditional line break.
- **Tabs** advance to the next 8-character tab stop.
- **Soft hyphens** are zero-width; if the break is taken, a visible `-` is added to the line width.
- **Line-fit tolerance.** A small epsilon (browser-specific) prevents false breaks from floating-point drift.

There's a **fast path** for the common case (no soft hyphens, tabs, or preserved whitespace) and a **full path** for everything else.

### Caching

Segment metrics are cached `Map<font, Map<segmentText, metrics>>`, shared across all `prepare()` calls. Emoji correction is cached once per font. `clearCache()` releases everything. `setLocale()` also clears caches since locale changes can alter word boundaries.

### Bidi

For `prepareWithSegments()`, Pretext computes Unicode Bidirectional Algorithm embedding levels per segment. These are metadata for custom rendering (reordering glyphs in Canvas/WebGL). Line breaking itself doesn't read bidi levels — it operates on visual order from `Intl.Segmenter`.

### Language Coverage

- **CJK** (Chinese, Japanese, Korean, Hangul) — per-grapheme breaking with kinsoku
- **Arabic, Hebrew, Urdu** — correct segmentation, bidi metadata on rich path
- **Thai, Lao, Khmer, Myanmar** — dictionary-based segmentation via `Intl.Segmenter`
- **Emoji** — grapheme-aware with per-font canvas/DOM correction
- All of the above mixed freely in a single paragraph

## Caveats

Pretext doesn't try to be a full font rendering engine (yet?). It currently targets the common text setup:
- `white-space: normal`
- `word-break: normal`
- `overflow-wrap: break-word`
- `line-break: auto`
- If you pass `{ whiteSpace: 'pre-wrap' }`, ordinary spaces, `\t` tabs, and `\n` hard breaks are preserved instead of collapsed. Tabs follow the default browser-style `tab-size: 8`. The other wrapping defaults stay the same: `word-break: normal`, `overflow-wrap: break-word`, and `line-break: auto`.
- `system-ui` is unsafe for `layout()` accuracy on macOS. Use a named font.
- Because the default target includes `overflow-wrap: break-word`, very narrow widths can still break inside words, but only at grapheme boundaries.

## Develop

See [DEVELOPMENT.md](DEVELOPMENT.md) for the dev setup and commands.

## Credits

Sebastian Markbage first planted the seed with [text-layout](https://github.com/chenglou/text-layout) last decade. His design — canvas `measureText` for shaping, bidi from pdf.js, streaming line breaking — informed the architecture we kept pushing forward here.
