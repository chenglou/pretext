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

Other `prepare()` options are `{ wordBreak: 'keep-all' }` for CSS-like `word-break: keep-all`, and `{ letterSpacing: n }` to match CSS `letter-spacing` (`n` is treated as a px value).

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

The range APIs return positions and widths without allocating text strings. “Materializing” a range builds the line's text only when needed.

- `layoutNextLineRange()` lets you route text one row at a time when width changes as you go:

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

For hyphenation, insert soft hyphens before calling `prepare()` or `prepareWithSegments()`. They stay invisible unless the line breaks there, in which case it ends with `-`. A soft hyphen at the end of the paragraph is consumed without painting a hyphen. Pretext doesn't insert soft hyphens for you. For mixed-language or user-generated app text, prefer conservative, locale-aware insertion over aggressive pattern hyphenation.

At very narrow widths, Pretext may wrap text containing soft hyphens differently from the browser. Safari can overflow a prefix plus hyphen, while Chromium and Gecko may move part of the prefix to another line.

To lay out text with mixed fonts, code spans, mentions, or chips, use `@chenglou/pretext/rich-inline`:

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

Pass a flat list of text items. Keep leading and trailing spaces; the helper collapses repeated spaces to one. Use `extraWidth` for padding and borders, and `break: 'never'` to keep an item on one line. Only `white-space: normal` is supported. This is not a general CSS inline formatting engine.

Fragment and cursor `itemIndex` values refer to that original list, including when it contains empty items. A collapsed boundary space uses the first space's font and letter spacing; `gapBefore` can be zero or negative. Zero-width content can still occupy a line and carry a break opportunity.

In Chrome and Safari, items break where the text they join has a break opportunity, not at every item boundary. Safari finds breaks inside each span from that span's own text, and Pretext follows it there, so a Thai, Lao, Khmer or Myanmar word split across items wraps like Safari's spans rather than like one text node. In Firefox, and in engines Pretext doesn't recognize, every item boundary is still a break opportunity, so punctuation that starts an item or the rest of a split word can wrap there where Firefox keeps it with the text before. Each item is measured on its own, so kerning across a boundary isn't included: Chrome and Firefox shape neighboring same-font spans together and Safari doesn't, which can move a wrap by about a pixel.

### API Glossary

Use-case 1 APIs:
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedText // one-time text analysis + measurement pass, returns an opaque value to pass to `layout()`. Make sure `font` and `letterSpacing` are synced with your CSS for the text you're measuring. `font` is the same format as what you'd use for `myCanvasContext.font = ...`, e.g. `16px Inter`; `letterSpacing` is a CSS pixel value.
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // calculates text height given a max width and lineHeight. Make sure `lineHeight` is synced with your css `line-height` declaration for the text you're measuring.
```

Use-case 2 APIs:
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedTextWithSegments // same as `prepare()`, but returns a richer structure for manual line layout needs
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // high-level api for manual layout needs. Accepts a fixed max width for all lines. Similar to `layout()`'s return, but additionally returns the lines info
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // low-level api for manual layout needs. Accepts a fixed max width for all lines. Calls `onLine` once per line with its actual calculated line width and start/end cursors, without building line text strings. Very useful for certain cases where you wanna speculatively test a few width and height boundaries (e.g. binary search a nice width value by repeatedly calling walkLineRanges and checking the line count, and therefore height, is "nice" too). You can have text messages shrinkwrap and balanced text layout this way. After walkLineRanges calls, you'd call layoutWithLines once, with your satisfying max width, to get the actual lines info.
measureLineStats(prepared: PreparedTextWithSegments, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids line/string allocations.
measureNaturalWidth(prepared: PreparedTextWithSegments): number // Returns the width of the widest line when only explicit line breaks apply.
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
prepareRichInline(items: RichInlineItem[]): PreparedRichInline // prepares the items for layout and collapses spaces between them
layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null // stream one line of rich-text inline flow at a time without building fragment text strings
walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number // non-materializing line walker for rich-text inline flow shrinkwrap/stats work
materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine // turns one previously computed rich-inline line range back into full fragment text
measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids fragment-text allocations.
type RichInlineItem = {
  text: string // raw text, including leading/trailing collapsible spaces
  font: string // canvas font shorthand for this item
  letterSpacing?: number // extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` keeps the item atomic (aka on one line), like a chip
  extraWidth?: number // extra width around the text, e.g. padding and borders
}
type RichInlineCursor = {
  itemIndex: number // Which source RichInlineItem this cursor is currently in
  segmentIndex: number // Segment index within that item's prepared text
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
type RichInlineFragment = {
  itemIndex: number // index back into the original RichInlineItem array
  text: string // Text slice for this fragment
  gapBefore: number // collapsed space before this fragment, in pixels; can be zero or negative
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
  gapBefore: number // collapsed space before this fragment, in pixels; can be zero or negative
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
- If you're drawing mixed bidi text, like English and Arabic, `prepareWithSegments()` includes `segLevels`: approximate bidi levels for each text segment, or `null` when no bidi metadata is needed. Levels describe direction and nesting for drawing; they don't affect where lines wrap. Base direction and weak/neutral state restart at Unicode bidi paragraph separators in the normalized text. In `pre-wrap`, normalized newlines start fresh paragraphs; in `normal`, ASCII newlines collapse to spaces first, or disappear next to a zero-width space in Chrome and Firefox. Tabs and U+2028 LINE SEPARATOR do not restart paragraph direction. This is not a full Unicode Bidirectional Algorithm implementation.
- Segment widths are browser-canvas widths for line breaking. They aren't enough to position individual characters correctly in Arabic or mixed bidi text.
- In Safari, a word keeps its kerning with a following space. When a narrow width breaks such a word just before invisible characters, such as a word joiner before the space, the line holding them can have a slightly negative advance, as in WebKit's own line layout. Strongly negative `letterSpacing` can do the same. Line breaking uses that advance, but a line's reported `width` is clamped at 0.
- If a soft hyphen wins the break, materialized line text includes the visible trailing `-`.
- `measureNaturalWidth()` returns the widest forced line. Hard breaks still count.
- `prepare()` and `prepareWithSegments()` do horizontal-only work. `lineHeight` stays a layout-time input.

## Caveats

Pretext doesn't try to be a full font rendering engine (yet?). It currently targets the common text setup:
- `white-space: normal` and `pre-wrap`
- `word-break: normal` and `keep-all`
- `overflow-wrap: break-word`. Very narrow widths can still break inside words and independent symbol runs, but only at grapheme boundaries.
- `line-break: auto`
- `letter-spacing` as a numeric pixel value passed to `prepare()` / `prepareWithSegments()`
- Tabs follow the default browser-style `tab-size: 8`
- In `pre-wrap`, Pretext treats a lone `\r` as a line break, but browsers don't. Normalize `\r` to `\n` in the text you render, not just the text you measure.
- `{ wordBreak: 'keep-all' }` is supported too. It behaves like you'd expect for CJK/Hangul and no-space mixed Latin/numeric/CJK text, while keeping the same `overflow-wrap: break-word` fallback for overlong runs.
- `system-ui` and `-apple-system` are unsafe for `layout()` accuracy on macOS. Use a named font. See the [platform bug ledger](PLATFORM_BUGS.md) for the Chrome and Firefox issues.
- Emoji next to punctuation can still wrap differently from the browser.
- A paragraph containing only zero-width spaces (ZWSP) occupies one line. A ZWSP at the start of a paragraph or after a hard break gets its own line when the text after it doesn't fit beside it. Other ZWSP beside text, whitespace or hard breaks can still wrap differently from the browser. The rich-inline helper preserves standalone ZWSP items, but still inherits the flat text engine's wrapping limits inside each item.
- In `normal`, Chrome and Firefox remove a newline, and the spaces and tabs around it, when a ZWSP is right before or after them; Safari turns it into a space. Pretext follows the browser it runs in, except across rich-inline items. Firefox also removes newlines between Chinese or Japanese characters, which Pretext still turns into spaces, so such text can wrap differently there.
- Some fonts, such as Shantell Sans, can produce different line breaks inside long words in Pretext and the browser.
- Page language changes fonts and line breaks, and without `lang` Chrome and Firefox use the browser's or system's language. A generic font like `sans-serif`, or a character missing from a named font, may use a different font from the one Pretext measures, and curly quotes can wrap differently per language. Set `lang` on `<html>`, use a named font that covers your text, and check the result in your browser. If you change `<html lang>`, prepare your text again; existing prepared handles keep the widths measured before the change.
- In Chrome, text is measured under the page direction (`<html dir>`) from when Pretext first measured, or last saw `<html lang>` change. Text whose direction differs from the page, like an Arabic paragraph on an LTR page, can wrap slightly differently around brackets and other neutral characters.
- Runtime requires `Intl.Segmenter`, Canvas 2D text measurement, and Unicode property escapes (`\p{...}`). Browsers without these features aren't supported. Without Unicode property escapes, Pretext can't load and throws a `SyntaxError`.
- Pretext uses the canvas `font` string. Separate CSS settings such as `font-optical-sizing`, `font-feature-settings`, and `font-variation-settings` aren't supported. Variable-font settings only apply when expressed through that string, such as font weight.

## Develop

See [DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md) for the dev setup and commands.

## Credits

Sebastian Markbage first planted the seed with [text-layout](https://github.com/chenglou/text-layout) last decade. His design — canvas `measureText` for shaping, bidi from pdf.js, streaming line breaking — informed the architecture we kept pushing forward here.
