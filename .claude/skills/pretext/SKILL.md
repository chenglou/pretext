---
name: pretext
description: >-
  How to use @chenglou/pretext for DOM-free multiline text measurement and line
  layout. Use when measuring paragraph height without touching the DOM (avoiding
  getBoundingClientRect/offsetHeight reflow), wrapping or laying out text to
  canvas/SVG/WebGL/server-side, computing line counts or a multiline
  shrink-wrap width, virtualizing long text lists, flowing text around
  obstacles, or laying out inline rich text with chips/mentions. Triggers on
  `prepare`/`layout`/`prepareWithSegments`/`layoutWithLines`/`walkLineRanges`,
  the `@chenglou/pretext` or `@chenglou/pretext/rich-inline` imports, or any
  "measure text height in JS without the DOM" task.
---

# Pretext

Pure JS/TS library for **multiline text measurement and layout** with no DOM
reflow. It does its own line breaking and uses the browser's canvas `measureText`
as the ground-truth font engine. Output is the wrapped **height**, **line count**,
per-line **widths/cursors**, and (on request) the line **text**.

Use it to predict text height/line-count before paint, virtualize long lists,
shrink-wrap a container to its text, or render text to canvas/SVG/WebGL.

## The one mental model: prepare once, layout many

Everything flows from a two-phase split. Internalize this before anything else.

| Phase | Function | Cost | When |
|---|---|---|---|
| **Analyze + measure** | `prepare()` / `prepareWithSegments()` | Expensive: normalize, segment, glue rules, canvas measurement | Once per `(text, font, options)` |
| **Fit to width** | `layout()`, `layoutWithLines()`, `walkLineRanges()`, … | Cheap: pure arithmetic over cached widths | Every resize / every width you test |

**The golden rule: never re-run `prepare()` for the same text + font + options.**
On resize, re-run only `layout()`. Re-preparing throws away the entire point of
the library (the precomputed measurement pass). Cache the prepared handle keyed
on `(text, font, options)`.

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀', '16px Inter') // once
const { height, lineCount } = layout(prepared, 320, 20)               // every resize
```

## Choosing the right API

Pick the smallest API that answers your question. Three families:

1. **Fast path — you only need height/line-count.** `prepare()` → `layout()`.
   The handle is opaque; it deliberately carries no segment data so the hot path
   stays allocation-light. This is the default. Use it for: predicting block
   height, occlusion/virtualization math, dev-time "does this label overflow?"
   checks, preventing layout shift.

2. **Rich manual layout — you render the lines yourself** (canvas/SVG/WebGL/server).
   `prepareWithSegments()` → then one of:
   - `layoutWithLines(p, w, h)` — all lines at one fixed width, with text. The
     high-level choice when width is constant.
   - `walkLineRanges(p, w, onLine)` — line widths + cursors, **no string
     allocation**. Use for stats, shrink-wrap, and speculative width probing.
   - `measureLineStats(p, w)` → `{ lineCount, maxLineWidth }` — counts only, no
     line/string allocation.
   - `measureNaturalWidth(p)` — widest *forced* line (hard breaks still count),
     when width is not what's causing wraps.
   - `layoutNextLineRange(p, cursor, w)` / `layoutNextLine(p, cursor, w)` —
     **variable width per line** (flow around a float, ragged columns). Feed the
     previous range's `end` cursor as the next `start`. `null` = paragraph done.
   - `materializeLineRange(p, range)` — turn a range (from `walkLineRanges` or
     `layoutNextLineRange`) back into `{ text, width, start, end }` when you
     finally need the string.

3. **Inline rich text** — chips, mentions, code spans, mixed fonts on one flowing
   line. Import from `@chenglou/pretext/rich-inline`: `prepareRichInline()` →
   `walkRichInlineLineRanges()` / `layoutNextRichInlineLineRange()` /
   `measureRichInlineStats()` → `materializeRichInlineLineRange()`. Intentionally
   narrow: inline-only, `white-space: normal` only, not a markup tree.

**Decision shortcut:**
- Just need a number (height/lines)? → `prepare` + `layout`.
- Rendering lines yourself at one width? → `prepareWithSegments` + `layoutWithLines`.
- Probing many widths / shrink-wrapping / virtualizing? → `walkLineRanges` or `measureLineStats` (no strings).
- Width changes line-to-line? → `layoutNextLineRange` in a loop.
- Inline pills/mentions/mixed fonts? → `rich-inline` helper.

## Accuracy contract — read before trusting a number

Pretext matches the browser **only if you feed it the same inputs the browser
uses**. These are the most common ways to get wrong numbers:

- **`font` must match your CSS exactly**, in canvas-shorthand form (same string
  you'd assign to `ctx.font`), e.g. `'600 16px Inter'`. A mismatched weight or
  size silently shifts every width.
- **`lineHeight` passed to `layout()` must match your CSS `line-height`.** It's a
  layout-time input on purpose — `prepare()` does horizontal-only work.
- **`letterSpacing` must match CSS `letter-spacing`** as a numeric px value, set in
  `prepare()` options (not at layout time).
- **Never use `system-ui`.** Canvas and DOM resolve it to different fonts on
  macOS, so `layout()` accuracy breaks. Use a named font (`Inter`,
  `'Helvetica Neue'`, …).
- The font must actually be **loaded** before you `prepare()`, or canvas measures
  a fallback. `await document.fonts.ready` (or `document.fonts.load(font)`) first.
- **Empty string** → `layout()` returns `{ lineCount: 0, height: 0 }`. Browsers
  still size an empty block to one line. If you need that, clamp:
  `Math.max(1, lineCount) * lineHeight`.

## What pretext supports (and what it doesn't)

Supported CSS surface — the common app-text setup:
- `white-space: normal` (default) and `pre-wrap` (`{ whiteSpace: 'pre-wrap' }`,
  editor/textarea-oriented: keeps spaces, `\t` tabs at `tab-size: 8`, and `\n`).
- `word-break: normal` and `keep-all` (`{ wordBreak: 'keep-all' }`, for CJK/Hangul
  and CJK-leading no-space mixed runs).
- `overflow-wrap: break-word` — overlong words still break at narrow widths, but
  only at **grapheme** boundaries.
- `line-break: auto`.
- Soft hyphens as optional break points (insert `­` before `prepare()`; a
  chosen break materializes a trailing `-`, an unchosen one stays invisible).

Not modeled / out of scope:
- Automatic hyphenation (you insert soft hyphens yourself; prefer conservative,
  locale-aware insertion for mixed-language UGC).
- CSS text features outside the canvas `font` shorthand: `font-optical-sizing`,
  `font-feature-settings`, standalone `font-variation-settings`. Variable-font
  axes only count when reflected in the font string (e.g. via weight).
- Exact glyph x-positions for custom Arabic / mixed-direction reconstruction —
  segment widths are canvas widths for *line breaking*, not glyph placement.
- Runtimes without `Intl.Segmenter` or Canvas 2D `measureText` are unsupported.

## Recipes

### Predict height to prevent layout shift / size a container

```ts
const prepared = prepare(comment.body, '16px Inter')
const { height } = layout(prepared, containerWidth, 24)
reserveSpace(height) // anchor scroll, avoid jump when text paints
```

### Resize without re-preparing (the hot path)

```ts
const prepared = prepare(text, font, opts) // ONCE — cache this
function onResize(width: number) {
  return layout(prepared, width, lineHeight) // cheap arithmetic, call freely
}
```

### Multiline shrink-wrap — tightest width that keeps the same line count

`walkLineRanges` gives widths without building strings, so it's cheap to probe
many widths (e.g. binary-search a "balanced" width), then call `layoutWithLines`
once at the width you like.

```ts
import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext'
const p = prepareWithSegments(label, '14px Inter')
let widest = 0
walkLineRanges(p, maxWidth, line => { if (line.width > widest) widest = line.width })
// `widest` is the narrowest container that still fits — long missing from the web
```

### Render to canvas at a fixed width

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
const p = prepareWithSegments(text, '18px "Helvetica Neue"')
const { lines } = layoutWithLines(p, 320, 26)
lines.forEach((l, i) => ctx.fillText(l.text, 0, i * 26))
```

### Flow text around an obstacle (variable width per line)

```ts
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'
const p = prepareWithSegments(article, BODY_FONT)
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const range = layoutNextLineRange(p, cursor, width)
  if (range === null) break
  ctx.fillText(materializeLineRange(p, range).text, 0, y)
  cursor = range.end
  y += 26
}
```

### Virtualize a long list cheaply

Use `measureLineStats` (no strings, no line objects) to compute each item's height
for the scroll offsets, and only `layoutWithLines` the items actually on screen.

```ts
import { measureLineStats } from '@chenglou/pretext'
const { lineCount } = measureLineStats(prepared, width)
const itemHeight = Math.max(1, lineCount) * lineHeight
```

### Inline rich text with an atomic chip

```ts
import { prepareRichInline, walkRichInlineLineRanges, materializeRichInlineLineRange } from '@chenglou/pretext/rich-inline'
const p = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 }, // chip: never splits, owns its padding/border px
  { text: "'s note", font: '500 17px Inter' },
])
walkRichInlineLineRanges(p, 320, range => {
  const line = materializeRichInlineLineRange(p, range)
  // each fragment keeps its source itemIndex, text slice, gapBefore, cursors
})
```

## Best practices checklist

- **Cache the prepared handle**; re-run only the layout call on width changes.
- **Sync `font`, `lineHeight`, `letterSpacing` with the actual CSS** of the text.
- **Wait for fonts to load** (`document.fonts.ready`) before `prepare()`.
- **Reach for the non-materializing APIs** (`walkLineRanges`, `measureLineStats`,
  `layoutNextLineRange`) whenever you don't need the line strings — they skip
  string allocation, which matters in virtualization and width-probing loops.
- **`LayoutCursor` is a segment/grapheme cursor, not a string offset.** Don't
  reconstruct line offsets from `line.text.length`; thread cursors instead.
- **Clamp empty text** with `Math.max(1, lineCount)` if you want browser-like
  one-line minimum height.
- **`clearCache()`** if your app cycles through many fonts/text variants and you
  want to release accumulated cache. **`setLocale(locale?)`** before preparing new
  text if you need a specific `Intl.Segmenter` locale; it also clears caches and
  does not mutate already-prepared handles.
- Don't expect glyph-level positioning, automatic hyphenation, or `system-ui`
  accuracy — those are explicitly out of scope.

## Reference

The authoritative API glossary, type definitions, and caveats live in the
package `README.md` (the project treats it as the public source of truth). When
in doubt about a signature or an edge case, read `README.md` rather than guessing,
and prefer it over older blog/example snippets that may predate the current
0.0.x API.
