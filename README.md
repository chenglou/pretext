# Pretext

Pure JavaScript/TypeScript library for multiline text measurement & layout. Fast, accurate & supports all the languages you didn't even know about. Allows rendering to DOM, Canvas, SVG and soon, server-side.

Pretext side-steps the need for DOM measurements (e.g. `getBoundingClientRect`, `offsetHeight`), which trigger layout reflow, one of the most expensive operations in the browser. It implements its own text measurement logic, using the browsers' own font engine as ground truth (very AI-friendly iteration method).

## Installation

```sh
npm install @chenglou/pretext
```

## Demos

Clone the repo, run `bun install`, then `bun start`, and open `/demos/index` in your browser. On Windows, use `bun run start:windows`.
Alternatively, see them live at [chenglou.me/pretext](https://chenglou.me/pretext/). Some more at [somnai-dreams.github.io/pretext-demos](https://somnai-dreams.github.io/pretext-demos/)

## API

Pretext serves 2 use cases:

### 1. Measure a paragraph's height _without ever touching DOM_

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀‎', '16px Inter')
const { height, lineCount } = layout(prepared, 320, 20) // pure arithmetic. No DOM layout & reflow!
```

`prepare()` does the one-time work: normalize whitespace, segment the text, apply glue rules, measure the segments with canvas, and return an opaque handle. `layout()` is the cheap hot path after that: pure arithmetic over cached widths. Do not rerun `prepare()` for the same text and configs; that'd defeat its precomputation. For example, on resize, only rerun `layout()`.

If you want textarea-like text where ordinary spaces, `\t` tabs, and `\n` hard breaks stay visible, pass `{ whiteSpace: 'pre-wrap' }` to `prepare()`:

```ts
const prepared = prepare(textareaValue, '16px Inter', { whiteSpace: 'pre-wrap' })
const { height } = layout(prepared, textareaWidth, 20)
```

If you want CSS-like `word-break: keep-all`, pass `{ wordBreak: 'keep-all' }` to `prepare()` too.

The returned height is the crucial last piece for unlocking web UIs:
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

- `measureLineStats()` and `walkLineRanges()` give you line counts, widths and cursors without building the text strings:

```ts
import { measureLineStats, walkLineRanges } from '@chenglou/pretext'

const { lineCount, maxLineWidth } = measureLineStats(prepared, 320)
let maxW = 0
walkLineRanges(prepared, 320, line => { if (line.width > maxW) maxW = line.width })
// maxW is now the widest line — the tightest container width that still fits the text! This multiline "shrink wrap" has been missing from web
```

- `layoutNextLineRange()` lets you route text one row at a time when width changes as you go. If you want the actual string too, `materializeLineRange()` turns that one range back into a full line:

```ts
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'

const prepared = prepareWithSegments(article, BODY_FONT)
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

// Flow text around a floated image: lines beside the image are narrower
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const range = layoutNextLineRange(prepared, cursor, width)
  if (range === null) break

  const line = materializeLineRange(prepared, range)
  ctx.fillText(line.text, 0, y)
  cursor = range.end
  y += 26
}
```

This usage allows rendering to canvas, SVG, WebGL and (eventually) server-side. See the `/demos/dynamic-layout` demo for a richer example.

For manual hyphenation, add soft hyphens to the source text before `prepare()` / `prepareWithSegments()`. They stay invisible unless the engine chooses that break, in which case materialized line text includes the visible trailing `-`. For mixed-language or user-generated app text, conservative selective hyphenation is usually safer than aggressive pattern-based hyphenation; automatic hyphenation is not built in today.

If your manual layout needs a small helper for rich-text inline flow, code spans, mentions, chips, and browser-like boundary whitespace collapse, there is a helper at `@chenglou/pretext/rich-inline`. It stays inline-only and `white-space: normal`-only on purpose:

```ts
import { materializeRichInlineLineRange, prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'

const prepared = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 },
  { text: "'s rich-note", font: '500 17px Inter' },
])

walkRichInlineLineRanges(prepared, 320, range => {
  const line = materializeRichInlineLineRange(prepared, range)
  // each fragment keeps its source item index, text slice, gapBefore, and cursors
})
```

It is intentionally narrow:
- raw inline text in, including boundary spaces
- caller-owned `extraWidth` for pill chrome
- `break: 'never'` for atomic items like chips and mentions
- `white-space: normal` only
- not a nested markup tree and not a general CSS inline formatting engine

### API Glossary

Use-case 1 APIs:
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all' }): PreparedText // one-time text analysis + measurement pass, returns an opaque value to pass to `layout()`. Make sure `font` is synced with your css `font` declaration shorthand (e.g. size, weight, style, family) for the text you're measuring. `font` is the same format as what you'd use for `myCanvasContext.font = ...`, e.g. `16px Inter`.
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // calculates text height given a max width and lineHeight. Make sure `lineHeight` is synced with your css `line-height` declaration for the text you're measuring.
```

Use-case 2 APIs:
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all' }): PreparedTextWithSegments // same as `prepare()`, but returns a richer structure for manual line layout needs
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // high-level api for manual layout needs. Accepts a fixed max width for all lines. Similar to `layout()`'s return, but additionally returns the lines info
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // low-level api for manual layout needs. Accepts a fixed max width for all lines. Calls `onLine` once per line with its actual calculated line width and start/end cursors, without building line text strings. Very useful for certain cases where you wanna speculatively test a few width and height boundaries (e.g. binary search a nice width value by repeatedly calling walkLineRanges and checking the line count, and therefore height, is "nice" too). You can have text messages shrinkwrap and balanced text layout this way. After walkLineRanges calls, you'd call layoutWithLines once, with your satisfying max width, to get the actual lines info.
measureLineStats(prepared: PreparedTextWithSegments, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids line/string allocations.
measureNaturalWidth(prepared: PreparedTextWithSegments): number // returns the widest forced line when width itself is not the thing causing wraps
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // iterator-like api for laying out each line with a different width! Returns the LayoutLine starting from `start`, or `null` when the paragraph's exhausted. Pass the previous line's `end` cursor as the next `start`.
layoutNextLineRange(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLineRange | null // same as layoutNextLine(), but without allocating line text strings. Useful for variable-width manual layout, occlusion, and virtualization measurements.
materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine // turns a LayoutLineRange from layoutNextLineRange() or walkLineRanges() into a full line with text
type LineStats = {
  lineCount: number // Number of wrapped lines, e.g. 3
  maxLineWidth: number // Widest wrapped line, e.g. 192.5
}
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

Helper for rich-text inline flow:
```ts
prepareRichInline(items: RichInlineItem[]): PreparedRichInline // compile raw inline items with their original text. The compiler owns cross-item collapsed whitespace and caches each item's natural width
layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null // stream one line of rich-text inline flow at a time without building fragment text strings
walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number // non-materializing line walker for rich-text inline flow shrinkwrap/stats work
materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine // turns one previously computed rich-inline line range back into full fragment text
measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids fragment-text allocations.
type RichInlineItem = {
  text: string // raw author text, including leading/trailing collapsible spaces
  font: string // canvas font shorthand for this item
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a chip
  extraWidth?: number // caller-owned horizontal chrome, e.g. padding + border width
}
type RichInlineCursor = {
  itemIndex: number // Which source RichInlineItem this cursor is currently in
  segmentIndex: number // Segment index within that item's prepared text
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
type RichInlineFragment = {
  itemIndex: number // index back into the original RichInlineItem array
  text: string // Text slice for this fragment
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}
type RichInlineLine = {
  fragments: RichInlineFragment[] // Materialized fragments on this line
  width: number // Measured width of this line, including gapBefore/extraWidth
  end: RichInlineCursor // Exclusive end cursor for continuing the next line
}
type RichInlineFragmentRange = {
  itemIndex: number // index back into the original RichInlineItem array
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}
type RichInlineLineRange = {
  fragments: RichInlineFragmentRange[] // Non-materialized fragment ownership/ranges on this line
  width: number // Measured width of this line, including gapBefore/extraWidth
  end: RichInlineCursor // Exclusive end cursor for continuing the next line
}
type RichInlineStats = {
  lineCount: number // Number of wrapped lines, e.g. 3
  maxLineWidth: number // Widest wrapped line, e.g. 192.5
}
```

Other helpers:
```ts
clearCache(): void // clears Pretext's shared internal caches used by prepare() and prepareWithSegments(). Useful if your app cycles through many different fonts or text variants and you want to release the accumulated cache
setLocale(locale?: string): void // optional (by default we use the current locale). Sets locale for future prepare() and prepareWithSegments(). Internally, it also calls clearCache(). Setting a new locale doesn't affect existing prepare() and prepareWithSegments() states (no mutations to them)
```

Notes:
- `PreparedText` is the opaque fast-path handle. `PreparedTextWithSegments` is the richer manual-layout handle.
- `LayoutCursor` is a segment/grapheme cursor, not a raw string offset.
- `layout()` with an empty string returns `{ lineCount: 0, height: 0 }`. Browsers still size an empty block to one `line-height`, so clamp with `Math.max(1, lineCount) * lineHeight` if you need that behavior.
- The richer handle also includes `segLevels` for custom bidi-aware rendering. The line-breaking APIs do not read it.
- Segment widths are browser-canvas widths for line breaking, not exact glyph-position data for custom Arabic or mixed-direction x-coordinate reconstruction.
- If a soft hyphen wins the break, materialized line text includes the visible trailing `-`.
- `measureNaturalWidth()` returns the widest forced line. Hard breaks still count.
- `prepare()` and `prepareWithSegments()` do horizontal-only work. `lineHeight` stays a layout-time input.

## Caveats

Pretext doesn't try to be a full font rendering engine (yet?). It currently targets the common text setup:
- `white-space: normal` and `pre-wrap`
- `word-break: normal` and `keep-all`
- `overflow-wrap: break-word`. Very narrow widths can still break inside words, but only at grapheme boundaries.
- `line-break: auto`
- Tabs follow the default browser-style `tab-size: 8`
- `{ wordBreak: 'keep-all' }` is supported too. It behaves like you'd expect for CJK/Hangul text, while keeping the same `overflow-wrap: break-word` fallback for overlong runs.
- `system-ui` is unsafe for `layout()` accuracy on macOS. Use a named font.
- Runtime requires `Intl.Segmenter` and Canvas 2D text measurement. Browsers or runtimes without `Intl.Segmenter` are not supported by the main package today.
- CSS text features outside the canvas `font` shorthand, such as `letter-spacing`, `font-optical-sizing`, `font-feature-settings`, and standalone `font-variation-settings`, are not modeled separately. Variable-font axes only help when the active axis is reflected in the canvas font string, for example via weight.

## Develop

See [DEVELOPMENT.md](DEVELOPMENT.md) for the dev setup and commands.

## Credits

Sebastian Markbage first planted the seed with [text-layout](https://github.com/chenglou/text-layout) last decade. His design — canvas `measureText` for shaping, bidi from pdf.js, streaming line breaking — informed the architecture we kept pushing forward here.
