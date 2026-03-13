# Pretext

Pure JavaScript/TypeScript library for text measurement & layout. Fast, accurate & supports all the languages you didn't even know about. Allows rendering to DOM, Canvas, SVG and soon, server-side.

Pretext completely side-steps the need for DOM measurements (e.g. `getBoundingClientRect`, `offsetHeight`), which trigger layout reflow, one of the most expensive operations in the browser. See demos for layout out The Great Gatsby & other international books at >1000fps.

We're using AI to reimplement a subset of the font stack in userland, with the ground truth verifier that is browser rendering!

## API

You can use Pretext in two distinct ways.

The first use case is dead simple: you still render the text with regular DOM, and Pretext just tells you how tall that block will be at a given width. This is for feeds, cards, comments, chat, masonry, virtualization, all the normal app stuff.

```ts
import { prepare, layout } from './src/layout.ts'

const prepared = prepare(commentText, '16px Inter')
const { height, lineCount } = layout(prepared, containerWidth, 20)

// Then render with normal DOM. No line placement needed.
```

The second use case is the fun one: you want to lay out the lines yourself. Not just style a paragraph, but actually decide where each line goes. Wrap around a logo. Split across synced panes. Flow into columns. That path uses the richer APIs:

```ts
import {
  prepareWithSegments,
  walkLineRanges,
  layoutNextLine,
  layoutWithLines,
} from './src/layout.ts'

const prepared = prepareWithSegments(storyText, '18px "Helvetica Neue"')

// Fixed-width manual layout, no string materialization:
walkLineRanges(prepared, 320, line => {
  console.log(line.width, line.start, line.end)
})

// Variable-width manual layout, one row at a time:
let cursor = { segmentIndex: 0, graphemeIndex: 0 }
while (true) {
  const line = layoutNextLine(prepared, cursor, getWidthForCurrentRow())
  if (line === null) break
  placeLineManually(line)
  cursor = line.end
}
```

## What makes this different

- It is fast on the resize hot path.
- It is based on the browser's own shaping engine (`measureText`), so Arabic, Thai, CJK, emoji, bidi, etc. are not bolted on afterward.
- It lets us keep layout in userland instead of begging CSS for ever more one-off layout APIs.

That last part is the real point.

Most UI systems today are stuck between:
- a boring paragraph that the browser owns
- or a GPU-heavy landing page that barely has text

Pretext is trying to open up the space in between: text-heavy, expressive, interactive layouts that are still maintainable and still fast.

## Current shape of the project

- `layout()` is the low-friction production API for "just tell me the height."
- `prepareWithSegments()` + the richer layout helpers are the manual-layout path.
- `layoutWithLines()` gives you all the lines at once.
- `layoutNextLine()` is for variable-width / contour-like layouts where the width changes from row to row.
- `walkLineRanges()` is the lower-allocation batch geometry pass when you want widths/cursors but not strings.

## Current demos

- Great Gatsby canary
- international book corpora
- bubble shrinkwrap
- synced multi-view text panes
- contour and editorial layouts
- logo / poster experiments

## Honesty section

Pretext is not pretending to be a full browser layout engine.

It currently targets the common app-text setup:
- `white-space: normal`
- `word-break: normal`
- `overflow-wrap: break-word`
- explicit caller-provided `line-height`

If you want full browser-accurate paragraph spacing, arbitrary CSS line-height resolution, ruby, vertical text, every writing mode, every shape-outside quirk, etc., that's a different problem.

But if what you want is:
- very fast height prediction
- strong cross-language wrapping
- and a route to manual, userland-controlled text layout

that is exactly what this repo is for.
