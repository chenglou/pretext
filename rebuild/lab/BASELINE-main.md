# Baseline: main's library through the lab

`rebuild/lab/baselines/main-predictor.ts` predicts with the current library in `src/` (main 2e5e2bd's public API,
source unchanged) the way an app developer uses it, so the rebuild's engines have a number to beat on the same case
sets.

<!-- TABLES -->

## How the adapter uses main

- Font: one canvas font string from the run style all runs share: `[italic ][weight ]<size>px <family>`, leaving out
  weight 400 (`16px Arial`, `italic 700 18px "Helvetica Neue"`).
- `prepareWithSegments(text, font, options)` with `whiteSpace: 'pre-wrap'` for pre-wrap, `wordBreak: 'keep-all'` for
  keep-all and `letterSpacing` when it isn't 0. Then `walkLineRanges(prepared, paragraph.width, ...)`. Line height
  doesn't change main's lines.
- Language: main takes break rules and Canvas font resolution from `<html lang>` only. The adapter calls
  `setLocale(paragraph.lang)` before each case, which only changes the word segmenter's locale. So a paragraph whose
  `lang` differs from the page's is predicted under the page's language; the subgroup tables count those cases apart.
- Direction: main has no direction option and its lines don't depend on direction (README: render the paragraph as one
  element with its direction set). RTL cases are predicted like LTR ones; the subgroup tables count them apart.
- Line ranges: `walkLineRanges` cursors index main's segment stream, the text after main's white-space normalization
  (normal: SPACE, TAB, LF, CR and FF runs become one SPACE, leading and trailing ones are dropped, and Blink and Gecko
  profiles remove a run with LF next to a ZWSP; pre-wrap: CRLF, CR and FF become LF). The adapter turns a cursor into a
  stream offset (segment start plus the grapheme's offset from `Intl.Segmenter`), aligns the joined segments with the
  source text once, and maps each line's first and last stream unit to source offsets. A collapsed run belongs to the
  line whose stream holds its SPACE; source white space main removed belongs to no line. The adapter never searches
  line text. When the stream doesn't align, the prediction is the error `adapter: main's segment stream does not align
  with the source text`; no browser row has one.
- Widths are `LayoutLineRange.width` as main reports them.
- `measureLog`: main doesn't report measureText calls, so the adapter counts calls to
  `CanvasRenderingContext2D.prototype.measureText` and `OffscreenCanvasRenderingContext2D.prototype.measureText` while
  `predict` runs. `setLocale` clears main's caches, so every case prepares cold and the count is one fresh prepare.
- `paint` returns null, so the painter metric is not-applicable everywhere.

Offline check before the browser runs (fake canvas, one process each under a Chrome, Safari and Firefox user agent):
every supported case in the five sets gave forward, disjoint ranges inside the text that cover every inked code point.

## Unsupported cases

`predict` returns `{ error: 'unsupported by main: <reasons>' }`, every reason joined, for:

- `white-space` other than `normal` or `pre-wrap`
- `word-break` other than `normal` or `keep-all`
- `overflow-wrap` other than `break-word`
- `line-break` other than `auto`
- any nonzero `word-spacing`
- several runs with different styles (font, letter spacing or word spacing), empty runs included
- a span `lang` different from the paragraph's
- `tab-size` other than 8 in pre-wrap text holding a TAB

The browser runs observed only the supported cases: `.artifacts/lab/baseline-main/cases/` holds each set's supported
cases, byte-identical to the set's lines (suite-sample split into four files of 5,000), and the scorer ran with
`--cases` on the original set. The unsupported counts come from the same `unsupportedReasons` function over each set,
per browser after the cases' `browsers` filter.

<!-- UNSUPPORTED -->

## Caveats

<!-- CAVEATS -->

## Reproducing

```sh
# supported cases per set (writes .artifacts/lab/baseline-main/cases and support.json)
bun <check script> chrome write
python3 .artifacts/session/with-browser-lock.py baseline-main-<browser>-<set> -- \
  bun rebuild/lab/run.ts --browser=<browser> --cases=.artifacts/lab/baseline-main/cases/<set>.ndjson \
  --out=.artifacts/lab/baseline-main/<browser>/<set> --predictor=rebuild/lab/baselines/main-predictor.ts
bun rebuild/lab/score.ts --rows=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-rows.ndjson \
  --cases=.artifacts/lab/cases/<set>.ndjson --out=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-summary.json \
  --per-case=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-per-case.ndjson --examples=10
```
