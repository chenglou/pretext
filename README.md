# text-metrics

DOM-free text measurement for the browser. Predicts text block heights without triggering layout reflow.

## Problem

Measuring text in the browser requires DOM reads (`getBoundingClientRect`, `offsetHeight`), which trigger synchronous layout reflow. When UI components independently measure text — e.g. a virtual scrolling list sizing 500 comments — each measurement forces the browser to recompute layout for the entire document. This creates read/write interleaving that can cost 30ms+ per frame.

## Solution

Two-phase measurement using canvas `measureText()` (which bypasses the DOM layout engine entirely):

```js
import { prepare, layout } from './src/layout.ts'

// Phase 1: measure word widths (once, when text appears)
const block = prepare(commentText, '16px Inter', 19)

// Phase 2: compute height at any width (pure arithmetic, on every resize)
const { height, lineCount } = layout(block, containerWidth)
```

`prepare()` segments text via `Intl.Segmenter`, measures each word via canvas, and caches the widths. `layout()` walks the cached widths to count lines — no canvas, no DOM, no string operations. Each `layout()` call is ~0.0002ms.

## Performance

500 comments, resize to a new width (the hot path):

| Approach | Time | DOM-free |
|---|---|---|
| **text-metrics** | **0.11ms** | Yes |
| DOM batch (write all, read all) | 0.18ms | No |
| DOM interleaved (per-component) | varies, much worse in practice | No |
| Sebastian's text-layout (no cache) | 30ms | Yes |
| Sebastian's + word cache | 3ms | Yes |

## Accuracy

99.4% match against browser DOM ground truth across 2 fonts × 8 sizes × 8 widths × 30 texts (3840 tests). Remaining mismatches are emoji only (canvas measures emoji 4px wider than DOM at font sizes <24px on macOS — a browser pipeline difference with Apple Color Emoji).

100% match in headless tests (HarfBuzz vs full-line measurement, 1472 tests).

## i18n

- **Line breaking**: `Intl.Segmenter` with `granularity: 'word'` handles CJK (per-character breaks), Thai, Arabic, and all scripts the browser supports.
- **Bidi**: Unicode Bidirectional Algorithm (UAX #9) for mixed LTR/RTL text. Pure LTR text fast-paths with zero overhead.
- **Shaping**: canvas `measureText()` uses the browser's font engine, so ligatures, kerning, and contextual forms (Arabic connected letters) are handled correctly.
- **Emoji**: works, but canvas measures them 4px wider than DOM at small sizes on macOS. Converges at ≥24px.

## Known limitations

- **Emoji width**: canvas and DOM disagree on emoji metrics at font sizes <24px on macOS. The DOM renders emoji at exactly the font size; canvas inflates them. This is a Chrome/macOS issue with Apple Color Emoji, not algorithmic.
- **`system-ui` font**: canvas and DOM resolve this CSS keyword to different font variants at certain sizes on macOS. Use a named font (Inter, Helvetica, Arial, etc.) for guaranteed accuracy.
- **Server-side**: requires a canvas implementation (browser, or `@napi-rs/canvas` with registered fonts). Headless tests use HarfBuzz (WASM) instead.

## How it works

1. **Segmentation**: `Intl.Segmenter('word')` splits text into words and non-words (spaces, punctuation).
2. **Punctuation merging**: `"better."` is measured as one unit, not `"better"` + `"."`. This reduces accumulation error from summing individual measurements (up to 2.6px at 28px font without merging).
3. **CJK splitting**: CJK word segments are re-split into individual graphemes, since CSS allows line breaks between any CJK characters.
4. **Measurement**: each segment is measured via canvas `measureText()` and cached per (segment, font). Common words across texts share cache entries.
5. **Bidi classification**: characters are classified into bidi types, embedding levels are computed. Pure LTR text skips this entirely.
6. **Layout** (per resize): walk the cached widths, accumulate per line, break when exceeding `maxWidth`. Trailing whitespace hangs past the edge (CSS behavior). Punctuation overflow triggers break before the last word. Segments wider than `maxWidth` are broken at grapheme boundaries. Bidi reordering is applied per completed line.

## Research

See [RESEARCH.md](RESEARCH.md) for the full exploration log: every approach we tried, benchmarks, the system-ui font discovery, punctuation accumulation error analysis, emoji width tables, HarfBuzz RTL bug, server-side engine comparison, and what Sebastian already knew.

## Credits

Based on [Sebastian Markbage's text-layout](https://github.com/reactjs/text-layout) research prototype (2016). Sebastian's design — canvas `measureText` for shaping, bidi algorithm from pdf.js, streaming line breaking — informed the architecture. We added: two-phase caching (making resize O(n) arithmetic), `Intl.Segmenter` (replacing the `linebreak` npm dependency and non-standard `Intl.v8BreakIterator`), punctuation merging, CJK grapheme splitting, overflow-wrap support, and trailing whitespace handling.

## Development

```bash
bun install
bun start        # http://localhost:3000 — demo pages
bun run check    # typecheck + lint
bun test         # headless accuracy tests (HarfBuzz)
```

Pages:
- `/` — visual demo (side-by-side with browser rendering)
- `/accuracy` — sweep across fonts, sizes, widths, i18n texts
- `/benchmark` — performance comparison (TODO)
- `/interleaving` — realistic DOM interleaving demo (TODO)
