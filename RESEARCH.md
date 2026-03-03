# Research Log

Everything we tried, measured, and learned while building this library.

## The problem: DOM measurement interleaving

When UI components independently measure text heights (e.g. virtual scrolling a comment feed), each `getBoundingClientRect()` forces synchronous layout reflow. If components write DOM then read measurements without coordination, the browser re-layouts on every read. For 500 comments, this can cost 30ms+ per frame.

The goal: measure text heights without any DOM reads, so components can measure independently without coordinating batched passes.

## Approach 1: Canvas measureText + word-width caching

Canvas `measureText()` bypasses the DOM layout engine entirely. It goes straight to the browser's font engine. No reflow, no interleaving.

Two-phase design:
- `prepare(text, font)` — segment text, measure each word via canvas, cache widths
- `layout(prepared, maxWidth)` — walk cached widths, count lines. Pure arithmetic.

On resize (width changes), only `layout()` runs. No canvas calls, no DOM, no strings. ~0.0002ms per text block.

### Benchmarks (500 comments, resize to new width)

| Approach | Chrome | Safari |
|---|---|---|
| Our library | 0.02ms | 0.02ms |
| DOM batch (best case) | 0.18ms | 0.14ms |
| DOM interleaved | ~same (hidden container) | ~same |
| Sebastian's text-layout (no cache) | 30ms | 31ms |
| Sebastian's + word cache added | 3.8ms | 2.7ms |

Sebastian's 30ms breakdown:
- Chrome: createRunList 8.4ms (bidi + break iterator) + breakLine 20ms (canvas measureText per run)
- Safari: createRunList 1ms + breakLine 27ms
- The measurement calls dominate. Word-width caching eliminates them on resize.

## Approach 2 (rejected): Full-line measureText in layout

Instead of summing cached word widths, measure the full candidate line as a single string during layout. Should be pixel-perfect since it captures inter-word kerning.

Results:
- Chrome: 27ms for 500 comments. Safari: 136ms.
- **Worse than Sebastian's original.**
- The cost is O(n²) string concatenation: `lineStr + word` copies the entire line on every word.
- Actually **less accurate** than word-by-word (196/208 vs 202/208 match against DOM).

The string concatenation dominates. Not viable.

## Approach 3 (rejected): DOM-based measurement in prepare()

Replace canvas `measureText()` with hidden `<span>` elements in `prepare()`. Create spans for all words, read widths in one batch (one reflow), cache them. Layout stays arithmetic.

Results:
- Accuracy: fixes the system-ui font mismatch (see below). 99.2% → matches DOM exactly for named fonts.
- Problem: **reintroduces DOM reads**. Each `prepare()` call triggers a reflow. If components call `prepare()` independently during a render cycle, we're back to interleaving.

This defeats the purpose. Reverted.

## Approach 4 (rejected): SVG getComputedTextLength()

SVG `<text>` has `getComputedTextLength()` for single-line width measurement. But:
- Still a DOM read (triggers layout)
- No auto-wrapping (SVG text is single-line)
- Strictly worse than canvas for our use case

## Discovery: system-ui font resolution mismatch

Canvas and DOM resolve `system-ui` to different font variants on macOS at certain sizes:

| Size | Canvas/DOM match |
|---|---|
| 10px | MISMATCH (2.9%) |
| 11px | MISMATCH (6.9%) |
| 12px | MISMATCH (11.3%) |
| 13px | OK |
| 14px | MISMATCH (14.5%) |
| 15-25px | OK |
| 26px | MISMATCH (12.4%) |
| 27-28px | OK |

macOS uses SF Pro Text (small sizes) and SF Pro Display (large sizes). Canvas and DOM switch between them at different thresholds.

**Fix: use a named font** (Helvetica Neue, Inter, Arial, etc.). With named fonts, canvas and DOM agree perfectly (0.00px diff).

## Discovery: word-by-word sum accuracy

Tested whether `measureText("word1") + measureText(" ") + measureText("word2")` equals `measureText("word1 word2")` in canvas:

**Diff: 0.0000152587890625px.** Essentially zero. Canvas `measureText()` is internally consistent — no kerning/shaping across word boundaries.

The same test with HarfBuzz: also 0.00 diff (when using explicit LTR direction).

## Discovery: punctuation accumulation error

At larger font sizes, measuring segments separately accumulates error:
- `measureText("better") + measureText(".")` can differ from `measureText("better.")` by up to 2.6px at 28px font.
- Over a full line of segments, this pushes the total 2-3px past what the browser renders.
- At borderline widths, this causes off-by-one line breaks.

**Fix: merge punctuation into preceding word** before measuring. `Intl.Segmenter` produces `["better", "."]` as separate segments. We merge non-space, non-word segments into the preceding word: `["better."]`. Measured as one unit.

This also matches CSS behavior where punctuation is visually attached to its word.

## Discovery: trailing whitespace CSS behavior

CSS `white-space: normal` lets trailing spaces "hang" past the line edge — they don't contribute to the line width for breaking purposes. Our initial algorithm counted space widths in the line total, causing premature breaks at narrow widths.

**Fix: when a space segment causes overflow, skip it** (don't break, don't add to lineW). This matches the CSS behavior: trailing spaces hang.

## Discovery: emoji canvas/DOM width discrepancy

Canvas and DOM measure emoji at different widths on macOS (Chrome):

| Size | Canvas | DOM | Diff |
|---|---|---|---|
| 10px | 13px | 11px | +2 |
| 12px | 15px | 12px | +3 |
| 14px | 18px | 14px | +4 |
| 15px | 19px | 15px | +4 |
| 16px | 20px | 16px | +4 |
| 20px | 22px | 20px | +2 |
| 24px | 24px | 24px | 0 |
| 28px+ | matches | matches | 0 |

Properties:
- Same across all font families (Helvetica, Arial, Georgia, monospace)
- Same for all emoji tested (🚀🎯👏🦊🐕🏠😴)
- DOM scales linearly: emoji width = font size
- Canvas inflates at small sizes, converges at ≥24px
- This is a Chrome/macOS issue with Apple Color Emoji rendering pipeline

Not yet fixed. A correction table by font size (one-time DOM read at startup) could work.

## Discovery: HarfBuzz guessSegmentProperties RTL bug

When running headless tests with HarfBuzz, `buf.guessSegmentProperties()` assigns RTL direction to isolated Arabic words. This changes their advance widths compared to measuring them as part of a mixed LTR/RTL string:

- `measure("مستندات")` isolated with RTL: 51.35px
- Same word in `measure("your مستندات with")`: effective width is 74.34px
- Diff: 23px per Arabic word

**Fix: `buf.setDirection('ltr')` explicitly.** This matches browser canvas behavior where `measureText()` always returns the same width regardless of surrounding context. Result: 98.4% → 100% accuracy.

Note: this is a headless testing issue only. Browser canvas is not affected.

## Server-side measurement comparison

Tested three server-side engines:

| Engine | Latin | CJK | Emoji | Notes |
|---|---|---|---|---|
| @napi-rs/canvas | OK | Wrong (fallback widths) | Wrong (0.5x or 1x font size) | Needs explicit font registration |
| opentype.js | OK | OK (with CJK font) | OK (= font size) | Pure JS, no shaping |
| harfbuzzjs | OK | OK (with CJK font) | OK (= font size) | WASM, full shaping |

opentype.js and harfbuzzjs give identical results — both read advance widths from the font file directly. HarfBuzz additionally does shaping (ligatures, contextual forms) which matters for Arabic/Devanagari.

@napi-rs/canvas uses Skia but doesn't auto-detect macOS system fonts. CJK/emoji fall back to generic monospace widths without manual `GlobalFonts.registerFont()`.

None of these match browser canvas/DOM exactly — different font engines, different platform font resolution. Server-side measurement is useful for testing the algorithm but not for matching browser rendering.

## Accuracy summary

Browser (canvas measureText, named font):
- 3816/3840 (99.4%) across 2 fonts × 8 sizes × 8 widths × 30 texts
- Remaining 24 mismatches: all emoji at small font sizes

Headless (HarfBuzz, Arial Unicode):
- 1472/1472 (100%) word-sum vs full-line measurement
- Algorithm is exact; browser mismatches are measurement backend differences

## What Sebastian already knew

From his RESEARCH file:
> "Space and tabs are used to define word boundaries. CJK characters are treated as individual words."
> "Spaces are shaped independently from the words."

He designed for per-word caching but never implemented it. His code re-measures every run on every `breakLine()` call. Adding a word-width cache to his library drops it from 30ms to 3ms — a 10x improvement from caching alone, without changing the algorithm.

We went further: the two-phase split (prepare once, layout as arithmetic) drops it to 0.02ms — a 1500x improvement over his original.
