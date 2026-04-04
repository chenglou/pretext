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

## API

Pretext serves 2 use cases:

### 1. Measure a paragraph's height _without ever touching DOM_

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀‎', '16px Inter')
const { height, lineCount } = layout(prepared, textWidth, 20) // pure arithmetics. No DOM layout & reflow!
```

`prepare()` does the one-time work: normalize whitespace, segment the text, apply glue rules, measure the segments with canvas, and return an opaque handle. `layout()` is the cheap hot path after that: pure arithmetic over cached widths. Do not rerun `prepare()` for the same text and configs; that'd defeat its precomputation. For example, on resize, only rerun `layout()`.

If you want textarea-like text where ordinary spaces, `\t` tabs, and `\n` hard breaks stay visible, pass `{ whiteSpace: 'pre-wrap' }` to `prepare()`:

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

If your manual layout needs a small helper for mixed inline runs, atomic pills, and browser-like boundary whitespace collapse, there is an experimental alpha sidecar at `@chenglou/pretext/inline-flow`. It stays inline-only and `white-space: normal`-only on purpose:

```ts
import { prepareInlineFlow, walkInlineFlowLines } from '@chenglou/pretext/inline-flow'

const prepared = prepareInlineFlow([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 },
  { text: "'s rich-note", font: '500 17px Inter' },
])

walkInlineFlowLines(prepared, 320, line => {
  // each fragment keeps its source item index, text slice, gapBefore, and cursors
})
```

It is intentionally narrow:
- raw text in, including boundary spaces
- caller-owned `extraWidth` for padding/border chrome
- `break: 'never'` for atomic items like chips
- no nested markup tree, no `pre-wrap`, no attempt to be a general CSS inline formatting engine

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
measureLineGeometry(prepared: PreparedTextWithSegments, maxWidth: number): { lineCount: number, maxLineWidth: number } // aggregate geometry helper for callers that only need line count and widest wrapped line
measureNaturalWidth(prepared: PreparedTextWithSegments): number // intrinsic-width helper for manual layouts. Returns the widest forced line when width itself is not the thing causing wraps
layoutNextLineRange(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLineRange | null // iterator-like geometry API for variable-width layouts, without building line text strings
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // iterator-like api for laying out each line with a different width! Returns the LayoutLine starting from `start`, or `null` when the paragraph's exhausted. Pass the previous line's `end` cursor as the next `start`.
materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine // turns one previously computed line range back into a full line with text
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

Experimental inline-flow sidecar:
```ts
prepareInlineFlow(items: InlineFlowItem[]): PreparedInlineFlow // compile raw inline items with their original text. The compiler owns cross-item collapsed whitespace and caches each item's natural width
layoutNextInlineFlowLineRange(prepared: PreparedInlineFlow, maxWidth: number, start?: InlineFlowCursor): InlineFlowLineRange | null // stream one inline-flow line at a time without building fragment text strings
layoutNextInlineFlowLine(prepared: PreparedInlineFlow, maxWidth: number, start?: InlineFlowCursor): InlineFlowLine | null // stream one line at a time through an inline item sequence
walkInlineFlowLineRanges(prepared: PreparedInlineFlow, maxWidth: number, onLine: (line: InlineFlowLineRange) => void): number // non-materializing line walker for shrinkwrap/aggregate geometry work
walkInlineFlowLines(prepared: PreparedInlineFlow, maxWidth: number, onLine: (line: InlineFlowLine) => void): number // low-level line walker for inline fragment streams
measureInlineFlowGeometry(prepared: PreparedInlineFlow, maxWidth: number): { lineCount: number, maxLineWidth: number } // aggregate geometry helper for callers that only need line count and widest line
measureInlineFlow(prepared: PreparedInlineFlow, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // line counter for inline fragment streams
type InlineFlowItem = {
  text: string // raw author text, including leading/trailing collapsible spaces
  font: string // canvas font shorthand for this item
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a chip
  extraWidth?: number // caller-owned horizontal chrome, e.g. padding + border width
}
type InlineFlowCursor = {
  itemIndex: number
  segmentIndex: number
  graphemeIndex: number
}
type InlineFlowFragment = {
  itemIndex: number // index back into the original InlineFlowItem array
  text: string
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor
  end: LayoutCursor
}
type InlineFlowLine = {
  fragments: InlineFlowFragment[]
  width: number
  end: InlineFlowCursor
}
type InlineFlowFragmentRange = {
  itemIndex: number // index back into the original InlineFlowItem array
  gapBefore: number // collapsed boundary gap paid before this fragment on this line
  occupiedWidth: number // text width plus extraWidth
  start: LayoutCursor
  end: LayoutCursor
}
type InlineFlowLineRange = {
  fragments: InlineFlowFragmentRange[]
  width: number
  end: InlineFlowCursor
}
```

Other helpers:
```ts
clearCache(): void // clears Pretext's shared internal caches used by prepare() and prepareWithSegments(). Useful if your app cycles through many different fonts or text variants and you want to release the accumulated cache
setLocale(locale?: string): void // optional (by default we use the current locale). Sets locale for future prepare() and prepareWithSegments(). Internally, it also calls clearCache(). Setting a new locale doesn't affect existing prepare() and prepareWithSegments() states (no mutations to them)
```

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
