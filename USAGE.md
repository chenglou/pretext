# Using Pretext

This guide walks you through practical patterns for using Pretext, from a 3-line quickstart to multi-column editorial layouts. For the complete API reference, see the [README](./README.md#api).

## Quickstart

```js
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('Your paragraph text here.', '16px Inter')
const { height, lineCount } = layout(prepared, 300, 24) // maxWidth, lineHeight
```

`prepare()` does the expensive work: it segments text and measures each segment via canvas. For 500 texts, this takes ~19ms. `layout()` is pure arithmetic on cached widths — the same 500 texts take ~0.09ms. Call `prepare()` once when text arrives. Call `layout()` on every resize.

## Choosing Your API

- **Only need height and line count?**
  `prepare()` + `layout()` — the fastest path, returns `{ height, lineCount }`.

- **Need the actual line text and widths?**
  `prepareWithSegments()` + `layoutWithLines()` — returns `{ lines: [{ text, width, start, end }] }`.

- **Need line geometry without building strings?**
  `prepareWithSegments()` + `walkLineRanges()` — callback receives `{ width, start, end }` per line, no string allocation. Good for shrink-wrapping and aggregate measurements.

- **Each line has a different available width?**
  `prepareWithSegments()` + `layoutNextLine()` — call in a loop with a cursor, varying `maxWidth` per line. For text flowing around images, multi-column, or obstacle-aware layouts.

`prepareWithSegments()` is a superset of `prepare()` — it returns a richer handle that works with all APIs. If you only ever call `layout()`, prefer `prepare()` because it skips bidi metadata.

## Core Concepts

### The Two-Phase Model

Pretext splits text work into two phases:

1. **Prepare** — segments the text, measures each segment via `canvas.measureText()`, and caches the widths. This is the only step that touches a browser API.
2. **Layout** — walks the cached widths with pure arithmetic to compute line breaks. No DOM, no canvas, no allocations.

This separation is what eliminates layout reflow. `prepare()` runs once per unique `(text, font)` pair. `layout()` runs on every resize and is effectively free.

### Font Strings

The `font` parameter must be a valid [`CanvasRenderingContext2D.font`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font) string — the same format as the CSS `font` shorthand:

```js
prepare(text, '16px Inter')
prepare(text, 'bold 14px "Helvetica Neue", Arial, sans-serif')
prepare(text, '600 italic 18px Georgia')
```

The font must match what your CSS actually renders. If your CSS sets `font-weight: 600; font-size: 14px; font-family: Inter`, your Pretext font string is `'600 14px Inter'`.

`system-ui` is unsafe — canvas and DOM can resolve it to different fonts on macOS. Always use a named font.

### Cursors

A `LayoutCursor` is `{ segmentIndex, graphemeIndex }`. It marks a position in the prepared text — the bookmark between calls to `layoutNextLine()`.

```js
let cursor = { segmentIndex: 0, graphemeIndex: 0 } // start of text

const line = layoutNextLine(prepared, cursor, maxWidth)
cursor = line.end // advance to where this line ended

const nextLine = layoutNextLine(prepared, cursor, differentWidth)
// returns null when text is exhausted
```

The cursor is what lets text flow seamlessly across columns, pages, or around obstacles.

## Height Prediction

The most common use case: you have text and need its rendered height without triggering DOM reflow.

```js
import { prepare, layout } from '@chenglou/pretext'

const text = 'Your paragraph text here...'
const font = '16px Inter'
const lineHeight = 24
const prepared = prepare(text, font)

function getHeight(containerWidth) {
  return layout(prepared, containerWidth, lineHeight).height
}

// On resize — layout() is ~0.0002ms, call it freely
window.addEventListener('resize', () => {
  element.style.height = `${getHeight(element.clientWidth)}px`
})
```

### React

```tsx
import { prepare, layout } from '@chenglou/pretext'
import { useMemo, useRef, useState, useEffect } from 'react'

function useTextHeight(text: string, font: string, lineHeight: number, width: number) {
  const prepared = useMemo(() => prepare(text, font), [text, font])
  return useMemo(
    () => width > 0 ? layout(prepared, width, lineHeight) : { height: 0, lineCount: 0 },
    [prepared, width, lineHeight],
  )
}

function AutoHeightText({ text, font, lineHeight }: {
  text: string
  font: string
  lineHeight: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { height } = useTextHeight(text, font, lineHeight, width)

  return (
    <div ref={ref} style={{ height, font, lineHeight: `${lineHeight}px` }}>
      {text}
    </div>
  )
}
```

`prepare()` is memoized by `(text, font)`. When only the container width changes, only `layout()` re-runs.

## Canvas Rendering

For canvas-based UIs — games, diagrams, or editors — use `layoutWithLines()` to get the text for each line:

```js
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const font = '18px Georgia'
const lineHeight = 26
const maxWidth = 400

const prepared = prepareWithSegments(text, font)
const { lines } = layoutWithLines(prepared, maxWidth, lineHeight)

const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')
ctx.font = font
ctx.textBaseline = 'top'
ctx.fillStyle = '#000'

for (let i = 0; i < lines.length; i++) {
  ctx.fillText(lines[i].text, 0, i * lineHeight)
}
```

Each `lines[i].width` gives the painted width of that line, which you can use for right-alignment or centering:

```js
// Right-aligned
const x = maxWidth - lines[i].width
ctx.fillText(lines[i].text, x, i * lineHeight)
```

The `font` string passed to `ctx.font` must match the one passed to `prepareWithSegments()`.

## Shrink-Wrapping

Chat bubbles, tooltips, and labels often look better when the container is as tight as possible — the minimum width that keeps the same line count. Since `layout()` costs ~0.0002ms, a binary search over pixel widths is essentially free:

```js
import { prepareWithSegments, layout, walkLineRanges } from '@chenglou/pretext'

function shrinkWrap(text, font, lineHeight, maxWidth) {
  const prepared = prepareWithSegments(text, font)
  const targetLineCount = layout(prepared, maxWidth, lineHeight).lineCount

  // Binary search for the narrowest width with the same line count
  let lo = 1, hi = Math.ceil(maxWidth)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (layout(prepared, mid, lineHeight).lineCount <= targetLineCount) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  // Get the widest line at that width (no string allocation)
  let tightWidth = 0
  walkLineRanges(prepared, lo, (line) => {
    if (line.width > tightWidth) tightWidth = line.width
  })

  return Math.ceil(tightWidth)
}
```

`walkLineRanges()` avoids materializing line strings — it reports only geometry. Its return value is the total line count.

This pattern powers the [Bubbles demo](https://chenglou.me/pretext/demos/bubbles).

## Variable-Width Layout

When each line has a different available width — text flowing around an image, a pull quote, or across columns — use `layoutNextLine()` in a cursor loop:

### Text around an image

```js
import { prepareWithSegments, layoutNextLine } from '@chenglou/pretext'

const prepared = prepareWithSegments(text, '18px Palatino')
const lineHeight = 28
const columnWidth = 500
const image = { width: 180, height: 140, gap: 16 }

let cursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

while (true) {
  // Lines next to the image are narrower
  const maxWidth = y < image.height
    ? columnWidth - image.width - image.gap
    : columnWidth

  const line = layoutNextLine(prepared, cursor, maxWidth)
  if (line === null) break

  const x = y < image.height ? image.width + image.gap : 0
  renderLine(line.text, x, y)

  cursor = line.end
  y += lineHeight
}
```

### Two-column continuous flow

The cursor carries the exact position so text flows seamlessly from one column to the next:

```js
// Column 1
let cursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

while (y + lineHeight <= columnHeight) {
  const line = layoutNextLine(prepared, cursor, column1Width)
  if (line === null) break
  drawLine(line.text, column1Left, y)
  cursor = line.end
  y += lineHeight
}

// Column 2 — resumes exactly where column 1 stopped
y = 0
while (y + lineHeight <= columnHeight) {
  const line = layoutNextLine(prepared, cursor, column2Width)
  if (line === null) break
  drawLine(line.text, column2Left, y)
  cursor = line.end
  y += lineHeight
}
```

This pattern powers the [Dynamic Layout demo](https://chenglou.me/pretext/demos/dynamic-layout).

## Pre-Wrap Mode

For textarea-like inputs where whitespace is meaningful:

```js
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare(userInput, '14px monospace', { whiteSpace: 'pre-wrap' })
const { height, lineCount } = layout(prepared, containerWidth, 20)
```

`pre-wrap` preserves ordinary spaces, `\t` tabs (at browser-default tab stops), and `\n` hard breaks. Other wrapping rules remain the same. Use this for code editors, chat inputs, and anywhere the user's whitespace is semantically meaningful.

## Performance

### What to cache

Cache the `PreparedText` handle by `(text, font)`. This is the expensive object (~0.04ms per text). `layout()` is allocation-free at ~0.0002ms — never cache its result, just call it.

`prepareWithSegments()` is slightly more expensive than `prepare()` because it retains segment strings and bidi metadata. Use `prepare()` when you only need height.

### When to re-prepare

| Changed | Action |
|---------|--------|
| Text content | Re-prepare |
| Font (size, weight, family) | Re-prepare |
| `whiteSpace` mode | Re-prepare |
| Container width | Just call `layout()` again |

### Batch preparation

For lists or grids, prepare all items upfront and re-layout on resize:

```js
// At data load time (once)
const items = texts.map(text => ({
  text,
  prepared: prepare(text, font),
}))

// On every resize (cheap)
const heights = items.map(item =>
  layout(item.prepared, currentWidth, lineHeight).height
)
```

This pattern powers the [Masonry demo](https://chenglou.me/pretext/demos/masonry) with thousands of cards.

### Clearing the cache

Pretext maintains a shared `Map<font, Map<segment, metrics>>` cache across all `prepare()` calls. Segments that appear in multiple texts (common words, punctuation) are measured only once.

Call `clearCache()` to release this memory — for example, when switching to a completely different text corpus. `setLocale()` also clears caches.

## Framework Integration

### Vanilla JS

The pattern used by all Pretext demos — `ResizeObserver` with `requestAnimationFrame` deduplication:

```js
let raf = null

const ro = new ResizeObserver(([entry]) => {
  if (raf !== null) return
  raf = requestAnimationFrame(() => {
    raf = null
    const width = entry.contentRect.width
    const { height } = layout(prepared, width, lineHeight)
    element.style.height = `${height}px`
  })
})
ro.observe(element)
```

Wait for web fonts before the first measurement — metrics change when the real font arrives:

```js
document.fonts.ready.then(() => {
  prepared = prepare(text, font) // re-prepare with real font metrics
  scheduleRender()
})
```

### Vue, Svelte, Angular

The pattern is the same across frameworks: memoize `prepare()` when text or font changes, call `layout()` when width changes. Use your framework's reactive primitive — `computed()` in Vue, `$derived` in Svelte, a service in Angular — for the prepared handle, and trigger re-layout on container resize.

## Tips

- **Named fonts only.** `system-ui` resolves differently in canvas vs DOM on macOS. Use `Inter`, `Helvetica`, `Arial`, etc.
- **Match your CSS exactly.** The `font` string must include size, weight, style, and family in the `CanvasRenderingContext2D.font` format.
- **Wait for fonts.** Call `prepare()` after `document.fonts.ready` resolves, or re-prepare when fonts finish loading. Measurements against a fallback font will be wrong.
- **`lineHeight` is explicit.** Pretext does not read CSS `line-height`. You pass it as a number to `layout()`. Make sure it matches your CSS.
- **Empty strings** return `{ lineCount: 0, height: 0 }`. No special casing needed.
- **Very narrow widths** break words at grapheme boundaries, matching CSS `overflow-wrap: break-word`.
- **`walkLineRanges()` returns line count.** Its return value is the total number of lines, same as `layout().lineCount`.
- **`setLocale()`** retargets the word segmenter for future `prepare()` calls. Call it before preparing text if you need a specific `Intl.Segmenter` locale.

## Further Reading

- [Live demos](https://chenglou.me/pretext/) — accordion, bubbles, dynamic layout, masonry, editorial engine, and more
- [API reference](./README.md#api) — full function signatures and type definitions
- [Development setup](./DEVELOPMENT.md) — run the demos locally with `bun start`
