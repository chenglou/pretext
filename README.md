# Pretext

Pure JavaScript/TypeScript library for multiline text measurement & layout. Fast, accurate & supports all the languages you didn't even know about. Allows rendering to DOM, Canvas and SVG.

Pretext side-steps the need for DOM measurements (e.g. `getBoundingClientRect`, `offsetHeight`), which trigger layout reflow, one of the most expensive operations in the browser. It implements its own text measurement logic, using the browsers' own font engine as ground truth (very AI-friendly iteration method).

## Installation

```sh
npm install @chenglou/pretext
```

## Demos

The demos are exemplary API usage patterns we encourage you to read. They don't ship in the npm package, so clone the repo, run `bun install`, then `bun start`, and open <http://localhost:3000/demos> in your browser. On Windows, use `bun run start:windows`.
Alternatively, see them live at [chenglou.me/pretext](https://chenglou.me/pretext/). Some more at [somnai-dreams.github.io/pretext-demos](https://somnai-dreams.github.io/pretext-demos/)
Building a chat or another long list? [pages/demos/markdown-chat.md](https://github.com/chenglou/pretext/blob/main/pages/demos/markdown-chat.md) walks through the Markdown chat demo's patterns and when you can skip each.

## API

Pretext serves 2 use cases:

### 1. Measure a paragraph's height _without ever touching DOM_

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀‎', '16px Inter')
const { height, lineCount } = layout(prepared, 320, 20) // pure arithmetic. No DOM layout & reflow!
```

`prepare()` does the one-time work: normalize whitespace, segment the text at its break opportunities, measure the segments with canvas, and return an opaque handle. `layout()` is the cheap hot path after that: pure arithmetic over cached widths. Do not rerun `prepare()` for the same text, font and options; that'd defeat its precomputation. For example, on resize, only rerun `layout()`.

If you want textarea-like text where ordinary spaces, `\t` tabs, and `\n` hard breaks stay visible, pass `{ whiteSpace: 'pre-wrap' }` to `prepare()`:

```ts
const prepared = prepare(textareaValue, '16px Inter', { whiteSpace: 'pre-wrap' })
const { height } = layout(prepared, textareaWidth, 20)
// A <textarea> shows one more line than this when its value is empty or ends with \n

// Long text edited live: prepare each paragraph apart, keeping its \n, and re-prepare only the one an edit touches
const paragraphs = textareaValue.split(/(?<=\n)/).map(p => prepare(p, '16px Inter', { whiteSpace: 'pre-wrap' }))
const lineCount = paragraphs.reduce((n, p) => n + layout(p, textareaWidth, 20).lineCount, 0)
```

Other `prepare()` options are `{ wordBreak: 'keep-all' }` for CSS-like `word-break: keep-all`, and `{ letterSpacing: n }` to match CSS `letter-spacing` (`n` is treated as a px value).

The returned height is the crucial last piece for unlocking web UIs:
- proper virtualization/occlusion without guesstimates & caching
- fancy userland layouts: masonry, JS-driven flexbox-like implementations, nudging a few layout values without CSS hacks (imagine that), etc.
- _development time_ verification (especially now with AI) that labels on e.g. buttons don't overflow to the next line, browser-free
- prevent layout shift when new text loads and you wanna re-anchor the scroll position

The same `prepare()` handle also works with the APIs below that don't return text (`measureLineStats()`, `measureNaturalWidth()`, `walkLineRanges()`, `layoutNextLineRange()`), e.g. to shrink-wrap a chat bubble to its widest line.

### 2. Lay out the paragraph lines manually yourself

Switch out `prepare` with `prepareWithSegments` (the APIs that return a line's text need it: `layoutWithLines()`, `layoutNextLine()`, `materializeLineRange()`), then:

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

Size an element to `Math.ceil(maxW)`, capped at the `maxWidth` you passed, as the `/demos/bubbles` demo does. At the exact fractional width the browser can wrap the widest line. Without the cap the element can come out a pixel wider than `maxWidth`, where the browser can break its lines elsewhere: a line that just fits can measure slightly over `maxWidth`.

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

See the `/demos/dynamic-layout` demo for a richer example, and the `/demos/ellipsis` demo for a paragraph clamped to a number of lines with an ellipsis, as CSS `-webkit-line-clamp` does, and a path cut in its middle.

For hyphenation, insert soft hyphens before calling `prepare()` or `prepareWithSegments()`. They stay invisible unless the line breaks there, in which case the line ends with a hyphen, which its `width` counts. For mixed-language or user-generated app text, prefer conservative, locale-aware insertion over aggressive pattern hyphenation.

To lay out text with mixed fonts, code spans, mentions, chips or images, use `@chenglou/pretext/rich-inline`:

```ts
import { materializeRichInlineLineRange, prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'

const prepared = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 },
  { text: "'s rich-note ", font: '500 17px Inter' },
  { width: 20 }, // a custom emoji
])

walkRichInlineLineRanges(prepared, 320, range => {
  const line = materializeRichInlineLineRange(prepared, range)
  // each fragment keeps its source item index, text slice, where that slice sits in the item's text, gapBefore and gapItemIndex
})
```

Pass a flat list of items. For an image, a custom emoji, a formula or a badge inside a line, pass a box, `{ width }`: its element's margin box, padding and border included, in whole or quarter pixels, since browsers round other widths to their layout unit. A line can break on either side of a box, as at an `<img>`, and its fragment has no text; a box is an item with no `text`. For a size not known yet, prepare with a placeholder and again when it arrives; for an image capped at `max-width: 100%`, pass `min(its width, the paragraph's width)` and prepare again when that changes. Heights are yours: give each box `vertical-align: top`, and each line is as tall as the paragraph's line height or its tallest box, whichever is taller.

A line count is a height only while no item grows its line. A line is as tall as the paragraph's line height while its text keeps the paragraph font's size, ascent and descent; text in another size, or in a face whose ascent and descent differ (Helvetica Neue's bold on macOS), makes its line taller. Give each item's element `line-height: 1`, as the rich-note demo does, and the count times the paragraph's line height is the block's height.

For `white-space: pre-wrap` or `word-break: keep-all` on the paragraph, pass `{ whiteSpace: 'pre-wrap' }` or `{ wordBreak: 'keep-all' }` as the second argument; it applies to every item. In `pre-wrap` every item but an atomic one keeps its spaces, tabs and newlines: spaces at a line's end hang past it whichever items hold them, tab stops count from the line's start, and a newline ends its line. Paint each line with `white-space: pre`: a line painted alone in `pre-wrap` is its paragraph's last line, where spaces at its end hang only if they don't fit and a padded item's end after them can wrap. This is not a general CSS inline formatting engine.

### API Glossary

Use-case 1 APIs:
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedText // one-time text analysis + measurement pass, returns an opaque value to pass to `layout()` and to the APIs below that don't return text. Make sure `font` and `letterSpacing` are synced with your CSS for the text you're measuring. `font` is the same format as what you'd use for `myCanvasContext.font = ...`, e.g. `16px Inter`; `letterSpacing` is a CSS pixel value, and must be finite.
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // calculates text height given a max width and lineHeight. Make sure `lineHeight` is synced with your css `line-height` declaration for the text you're measuring.
```

Use-case 2 APIs:
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedTextWithSegments // same as `prepare()`, but returns a richer structure for manual line layout needs
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // high-level api for manual layout needs. Accepts a fixed max width for all lines. Similar to `layout()`'s return, but additionally returns the lines info
walkLineRanges(prepared: PreparedText, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // low-level api for manual layout needs. Accepts a fixed max width for all lines. Calls `onLine` once per line with its actual calculated line width and start/end cursors, without building line text strings. Very useful for certain cases where you wanna speculatively test a few width and height boundaries (e.g. binary search a nice width value by repeatedly calling walkLineRanges and checking the line count, and therefore height, is "nice" too). You can have text messages shrinkwrap and balanced text layout this way. After walkLineRanges calls, you'd call layoutWithLines once, with your satisfying max width, to get the actual lines info.
measureLineStats(prepared: PreparedText, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids line/string allocations.
measureNaturalWidth(prepared: PreparedText): number // Returns the width of the widest line when only explicit line breaks apply.
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // iterator-like api for laying out each line with a different width! Returns the LayoutLine starting from `start`, or `null` when the paragraph's exhausted. Pass the previous line's `end` cursor as the next `start`.
layoutNextLineRange(prepared: PreparedText, start: LayoutCursor, maxWidth: number): LayoutLineRange | null // same as layoutNextLine(), but without allocating line text strings. Useful for variable-width manual layout, occlusion, and virtualization measurements.
materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine // turns a LayoutLineRange from layoutNextLineRange() or walkLineRanges() into a full line with text
type PreparedTextWithSegments = PreparedText & {
  readonly segments: readonly string[] // The text split into segments, e.g. ['hello', ' ', 'world']
  readonly kinds: readonly ('text' | 'space' | 'preserved-space' | 'tab' | 'zero-width-break' | 'soft-hyphen' | 'zero-width-glue' | 'hard-break' | 'control')[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  readonly widths: ArrayLike<number> // Width of each segment in px, e.g. [42.5, 4.4, 37.2]
}
// The kinds. 'space': a collapsible space; 'preserved-space', 'tab' and 'hard-break': a space, tab or newline kept by `pre-wrap`; 'zero-width-break': a zero-width space the line can break after; 'soft-hyphen': a soft hyphen (U+00AD); 'zero-width-glue': a zero-width space or soft hyphen the browser doesn't break after; 'control': in Safari, a next-line character (U+0085), which takes letter spacing of its own
type LineStats = {
  lineCount: number // Number of wrapped lines, e.g. 3
  maxLineWidth: number // Widest wrapped line, e.g. 192.5
}
type LayoutLine = {
  text: string // Full text content of this line, e.g. 'hello world'
  width: number // Measured width of this line, e.g. 87.5, leaving out spaces and tabs that hang past its end
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutLineRange = {
  width: number // Measured width of this line, e.g. 87.5, leaving out spaces and tabs that hang past its end
  start: LayoutCursor // Inclusive start cursor in prepared segments/graphemes
  end: LayoutCursor // Exclusive end cursor in prepared segments/graphemes
}
type LayoutCursor = {
  segmentIndex: number // Segment index in `segments`
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
```

Helper for rich-text inline flow:
```ts
prepareRichInline(items: Array<RichInlineItem | RichInlineBox>, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all' }): PreparedRichInline // prepares the items for layout and, in `white-space: normal`, collapses spaces between them. `whiteSpace` and `wordBreak` are the paragraph's, as in `prepare()`
layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null // stream one line of rich-text inline flow at a time without building fragment text strings
walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number // non-materializing line walker for rich-text inline flow shrinkwrap/stats work
materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine // turns one previously computed rich-inline line range back into full fragment text
measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): { lineCount: number, maxLineWidth: number } // returns only how many lines this width produces, and how wide the widest one is. Avoids fragment-text allocations.
type RichInlineItem = {
  text: string // raw text, including leading/trailing collapsible spaces
  font: string // canvas font shorthand for this item
  letterSpacing?: number // extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` makes the item atomic: one box that can't break inside, as CSS `display: inline-block` does. A line can break on either side of it, whatever touches it
  extraWidth?: number // extra width around the text, e.g. padding and borders
}
type RichInlineBox = {
  width: number // the room an object inside the line takes, e.g. an image, in CSS px: its element's margin box. Finite and at least 0
}
type RichInlineCursor = {
  itemIndex: number // Which source item this cursor is currently in
  segmentIndex: number // Segment index within that item's part of the paragraph
  graphemeIndex: number // Grapheme index within that segment; `0` at segment boundaries
}
type RichInlineFragment = {
  itemIndex: number // index back into the items prepareRichInline() took
  text: string // Text slice for this fragment
  gapBefore: number // collapsed space before this fragment, in pixels; 0 when there's none, and negative under letter spacing more negative than the space is wide
  gapItemIndex: number // index of the item whose collapsed space gapBefore measures, or -1 when no space precedes this fragment on this line
  occupiedWidth: number // text width plus extraWidth, or a box's width
  sourceStart: number // where `text` starts in the item's `text`, as a UTF-16 offset
  sourceEnd: number // where it ends there
}
type RichInlineLine = {
  fragments: RichInlineFragment[] // Materialized fragments on this line
  width: number // Measured width of this line, including gapBefore/extraWidth
  end: RichInlineCursor // Exclusive end cursor for continuing the next line
}
type RichInlineFragmentRange = {
  itemIndex: number // index back into the items prepareRichInline() took
  gapBefore: number // collapsed space before this fragment, in pixels; 0 when there's none, and negative under letter spacing more negative than the space is wide
  gapItemIndex: number // index of the item whose collapsed space gapBefore measures, or -1 when no space precedes this fragment on this line
  occupiedWidth: number // text width plus extraWidth, or a box's width
  start: LayoutCursor // Start cursor within the item's part of the paragraph
  end: LayoutCursor // End cursor within the item's part of the paragraph
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
clearCache(): void // clears Pretext's shared internal caches used by prepare(), prepareWithSegments() and prepareRichInline(). Useful if your app cycles through many different fonts or text variants and you want to release the accumulated cache. After a web font loads, call it and prepare that font's text again: widths measured earlier are the fallback font's
setLocale(locale?: string): void // optional (by default we use the page language, from `<html lang>`). Sets locale for future prepare(), prepareWithSegments() and prepareRichInline(). Internally, it also calls clearCache(). Setting a new locale doesn't affect existing prepared states (no mutations to them). A worker has no `<html lang>`, so call it there with the page's `document.documentElement.lang` to give the worker the page's language. Pretext corrects emoji widths by measuring one DOM element, which a worker doesn't have, so in a worker small emoji measure too wide in Chrome and Firefox on macOS
```

Notes:
- `LayoutCursor` is a segment/grapheme cursor, not a raw string offset.
- Rich inline lays its items out as one paragraph, so a rich-inline cursor, a line's `end` or a fragment range's `start` and `end`, counts segments of the item's part of that paragraph: pass it back to `layoutNextRichInlineLineRange()` or `materializeRichInlineLineRange()`, and don't read it as a cursor into `prepareWithSegments(item.text)`. The two differ, among other cases, for an item that starts with white space after another item's text, which keeps that space as its first segment; for an atomic item, which is one segment; for an item that starts inside a word whose breaks depend on the whole word, as a Thai word's do; and for an item with `extraWidth` that starts with a zero-width space or, in `pre-wrap`, with spaces, a tab or a newline, whose start edge is its first segment. A paragraph of one text item that isn't atomic and has no `extraWidth` keeps its text's cursors. A materialized fragment's `sourceStart` and `sourceEnd` say where its text sits in its item's `text`.
- Browsers let the spaces at a line's end run past it without counting toward its width, which CSS calls hanging. A line's `width` leaves out what hangs: all of it where the line wraps, and in `pre-wrap`, before a newline or at the end of the text, only the part that doesn't fit in `maxWidth`. Chrome and Safari hang tabs the same way; Firefox counts them in the width. `measureNaturalWidth()` still counts spaces before a newline, like CSS max-content.
- `layout()` with an empty string returns `{ lineCount: 0, height: 0 }`, as an empty block is 0 tall, and a newline at the very end of `pre-wrap` text adds no line. A `<textarea>` shows one more line in both cases, so add one to `lineCount` when its value is empty or ends with `\n`.
- Pretext doesn't give bidi levels or a visual order. If you're drawing mixed bidi text, like English and Arabic, render each paragraph as one DOM element with its direction set, and the browser orders every line. In `pre-wrap` text every newline starts a paragraph: set `unicode-bidi: plaintext` on the element, or prepare and paint each paragraph apart, so that each takes its own direction. An English paragraph inside a right-to-left element can paint a line wider than Pretext measures it, which then wraps. If you draw lines separately, such as with Canvas `fillText()`, each line is ordered as its own paragraph, so numbers or punctuation next to a line break, or bidi controls that span lines (invisible direction characters such as U+202A-U+202E or U+2066-U+2069), can come out in a different order.
- Paint a `never` item as `display: inline-block; white-space: nowrap`. A span with only `white-space: nowrap` stays in the text's flow, so the browser keeps a `:` or `'s` right after it on its line, where Pretext can break before them.
- A rich-inline fragment's `gapBefore` is a space in the font and letter spacing of item `gapItemIndex`: the fragment's own item, the previous fragment's item, or an item holding only whitespace, which gets no fragment. The space is measured with the text beside it in that item, so in Chrome `gapBefore` holds the kerning between the two, as a browser draws a space next to a word, and can be narrower than a space alone. An atomic item's own leading and trailing white space makes no gap, as browsers trim it inside the item's inline-block, and an atomic item of only white space is an empty box as wide as its `extraWidth`. Draw the space inside that item's element so it paints at that width.
- In `pre-wrap`, rich-inline fragments have no gaps: a fragment's `text` keeps its spaces, and its `occupiedWidth`, like the line's `width`, leaves out what hangs at the line's end. An atomic item's own spaces collapse, as in a chip's `white-space: nowrap` inline-block. A tab counts eight spaces of its own item's font, as Safari does; Chrome and Firefox count the paragraph's, so a tab inside an item in another font, such as inline code in prose, can land on another stop there.
- A rich-inline item that wraps is charged its whole `extraWidth` on every line it reaches, as CSS `box-decoration-break: clone` pads a span, where CSS's default pads only the span's two ends. Paint each fragment as its own element with the padding on both sides, as the demos do: a padded span the browser wraps itself can break elsewhere, with `clone` too.
- Segment widths are browser-canvas widths for line breaking, not enough to position individual characters in Arabic or mixed bidi text. They don't always add up to a line's width either: a tab's is 0, the letter spacing after a segment's last letter isn't in it, and a line broken at a soft hyphen adds its hyphen. For a width, read the line's `width`, or call `measureNaturalWidth()` for the whole text.

## Caveats

Pretext doesn't try to be a full font rendering engine (yet?). It currently targets the common text setup:
- `white-space: normal` and `pre-wrap`
- `word-break: normal` and `keep-all`
- `overflow-wrap: break-word`, which isn't CSS's default: set it on the text you paint. When a word, a run of symbols or a `keep-all` group doesn't fit a line, Pretext breaks it between graphemes, as `overflow-wrap: break-word` does, where CSS's default would let it overflow.
- `line-break: auto`
- `letter-spacing` as a numeric pixel value passed to `prepare()` / `prepareWithSegments()`
- Tabs follow the default browser-style `tab-size: 8`
- In `pre-wrap`, Pretext treats a lone `\r` as a line break, but browsers don't. Normalize `\r` to `\n` in the text you render, not just the text you measure.
- `system-ui` and `-apple-system` are unsafe for `layout()` accuracy on macOS. Use a named font, by its English family name (`"Hiragino Kaku Gothic ProN"`, not `"ヒラギノ角ゴ ProN"` or a face name like `"Avenir Next Demi Bold"`): Firefox resolves localized family names and face names only seconds after it starts, and text measured before then can stay in a fallback font. See the [platform bug ledger](https://github.com/chenglou/pretext/blob/main/PLATFORM_BUGS.md) for the Chrome and Firefox issues.
- Page language changes fonts and line breaks, and without `lang` Chrome and Firefox use the browser's or system's language. A generic font like `sans-serif`, or a character missing from every named font, may use a different font from the one Pretext measures, and curly quotes can wrap differently per language. Set `lang` on `<html>`, list a named font for each script your text uses (`16px "Helvetica Neue", "PingFang SC", "Geeza Pro", sans-serif`), and check in your browser that a painted element's height matches `layout()`'s. Pretext doesn't read an element's own `lang`. If you change `<html lang>`, prepare your text again: existing handles keep the old widths and line-break rules.
- Prepare text once its web font has loaded: `await document.fonts.load('16px Inter', text)`, passing the text, since a family split by `unicode-range` loads only the parts that text needs, and `document.fonts.ready` doesn't wait for a font nothing has used yet. Add a `FontFace` to `document.fonts` before it loads, or Safari can keep the fallback font's widths even after `clearCache()`.
- In Chrome and Firefox on macOS, a small emoji's painted width depends on `devicePixelRatio`, and Pretext reads its correction once per font. When the ratio changes, as when the page is zoomed, call `clearCache()` and prepare text with emoji again ([#418](https://github.com/chenglou/pretext/issues/418)).
- Runtime requires Canvas 2D text measurement and Unicode property escapes (`\p{...}`), and `Intl.Segmenter` for text in Thai, Lao, Khmer, Myanmar and the other Southeast Asian scripts written without spaces. Browsers without these features aren't supported. Without Unicode property escapes, Pretext can't load and throws a `SyntaxError`; without `Intl.Segmenter`, preparing such text throws.
- Pretext uses the canvas `font` string. Separate CSS settings such as `font-variant-numeric`, `font-optical-sizing`, `font-feature-settings`, and `font-variation-settings` aren't supported. Variable-font settings only apply when expressed through that string, such as font weight.
- Pass font sizes in px. If your CSS sizes text in `rem` or `em`, resolve them to px once, higher up in your app (for example, when the root font size changes), and pass that string to Pretext. Firefox measures canvas text at a rounded font size, so a fractional size like `13.33px` can wrap differently there; prefer whole-pixel sizes.
- `maxWidth` is the content width you set on the element, in CSS px. Pass the number you set, not one read back from the page, which is rounded, and scaled under zoom. Round a width you compute, such as a share of a column, to whole or quarter pixels before passing it to Pretext and to CSS. Browsers round other widths to their layout unit, and a line that just fits the width you passed may not fit the element.
- Pretext assumes default font kerning and word spacing. Text painted with a different `font-kerning` or `word-spacing`, including word spacing inherited from the page, can wrap differently.
- Pretext predicts the browser's default wrapping. Text painted with `text-wrap: balance` or `pretty`, `hyphens: auto`, `hanging-punctuation` or `text-rendering: optimizeLegibility` can wrap differently.
- Chrome and Firefox let people set a minimum font size. Text below it paints at the minimum, while Pretext measures the size you pass. If your app uses small sizes, measure the height of an element with `font-size: 1px; line-height: 1` once and pass Pretext the larger size.
- iPhone Safari can enlarge the text of a block wider than the screen. Set `-webkit-text-size-adjust: 100%` on the page.

## Develop

See [DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md) for the demo server, engine data and releases.

## Credits

Sebastian Markbage first planted the seed with [text-layout](https://github.com/chenglou/text-layout) last decade. His design — canvas `measureText` for shaping, bidi from pdf.js, streaming line breaking — informed the architecture we kept pushing forward here.
