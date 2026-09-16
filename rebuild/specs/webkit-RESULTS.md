# WebKit port results (Safari 27.0, WebKit 7625.1.29.11.27)

Lab runs of `rebuild/src/engines/webkit` in `webkit-host`, the system WebKit.framework that installed Safari 27.0 runs
(CFBundleVersion 22625.1.29.11.27, macOS 27, libicucore 78.1), on this Mac (Retina, `devicePixelRatio` 2), 2026-09-16.
Rows and summaries are under `.artifacts/lab/webkit/<run>/`. The scorer compares WebKit widths as float32 edges, so a
"0 units" failure is a difference below 1/64px.

Installed Safari wasn't run: at the checkpoint Safari was the frontmost app, and the machine rules allow Safari windows
only while it isn't.

## Scores

pass / fail / unobserved (not-applicable left out).

| Case set | Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke (300) | smoke-r3 | 297/3/0 | 290/6/4 | 230/26/34 | 228/52/20 |
| smoke (300) | smoke-r4 | 299/1/0 | 292/4/4 | 239/20/33 | 238/43/19 |
| runs (2,580) | runs-r1 | 2562/14/4 | 2506/64/10 | 1962/384/160 | 1916/512/152 |
| runs (2,580) | runs-r2 | 2566/10/4 | 2511/59/10 | 2134/198/179 | 2078/332/170 |
| ws (1,019) | ws-r3 | 1019/0/0 | 1019/0/0 | 716/113/190 | 702/134/183 |
| ws (1,019) | ws-r4 | 1019/0/0 | 1019/0/0 | 794/30/195 | 776/55/188 |
| policy (1,606) | policy-r1 | 1603/1/2 | 1574/8/24 | 1523/43/8 | 1441/158/7 |
| policy (1,606) | policy-r2 | 1603/1/2 | 1574/8/24 | 1524/42/8 | 1441/158/7 |
| suite sample (19,933 rows) | suite-r1 | 19575/355/3 | 19386/374/173 | 13978/720/4688 | 16734/2794/405 |
| suite sample (19,933 rows) | suite-r1 + targeted-r2 | 19903/27/3 | 19715/45/173 | 14205/658/4852 | 17090/2438/405 |

- The suite sample is `.artifacts/lab/cases/suite-sample.ndjson` in four parts of 5,000 (`suite-sample-part{0..3}.ndjson`,
  `suite-r1-part{0..3}/`), each under its own lock. run.ts selected 4,998 cases in part 2 and 4,935 in part 3.
- suite-r1 ran before the code path fix below. `suite-targeted-r2` reran the 491 failing cases of the heart-vs16,
  before-heart, before-sequence, after-sequence, after-skin, original-vs-reshaped-admission and keep-all families with the
  fix; the last row substitutes those results.
- Prediction errors: 0 in every run.
- `rebuild/lab/score.ts` changed at 09:45, between ws-r3 and ws-r4. Part of the ws widths gain is the scorer's, not the
  port's.

## measureText calls per paragraph

From `prediction.measureLog` (calls that reached Canvas; the per-layout memo answers repeats).

| Run | mean | median | p90 | p95 | max |
|---|---|---|---|---|---|
| smoke-r3 | 14.4 | 10 | 30 | | 73 |
| runs-r1 | 20.7 | 17 | 39 | | 98 |
| ws-r3 | 12.9 | 11 | 25 | | 72 |
| policy-r1 | 14.5 | 12 | 28 | | 99 |
| smoke-r4 | 14.3 | 10 | 30 | 36 | 73 |
| runs-r2 | 20.7 | 17 | 39 | 49 | 98 |
| ws-r4 | 12.9 | 11 | 25 | 31 | 72 |
| policy-r2 | 14.5 | 12 | 28 | 35 | 99 |
| suite-r1 + targeted-r2 | 11.5 | 6 | 27 | 38 | 2,059 |

The suite maximum is `c-c8b0ddb41a784eda` (then `c-a580f4ad18b9ea2c` at 1,580 and `c-d5ffa42e1eca7ac8` at 1,400): long words
split by `breakWord`, whose probe sequence measures prefixes from the item start (specs/webkit-lines.md §8.1).

## What the port does

- `content.ts`: textRendererIsNeeded, InlineTextBox content per text node, `characterRangeCodePath`, simplified measuring,
  the fixed-pitch allowlist with a per-code-point coverage test, items at BreakablePositions, the bidi paragraph with
  item splits and opaque levels, stored widths, builder choice, gaps.
- `breaks.ts`, `data.ts`: BreakablePositions verbatim (classify, the pair table, the stale fast-forward state, keep-all
  with 16-bit punctuation), libicucore line tables per locale and mode from the manifest with Apple's quote overrides,
  `mayBreakInBetween` with the next box's style, Intl.Segmenter word boundaries inside SA runs, kept at libicucore
  grapheme boundaries. `breaks.test.ts` equals the groundwork's recorded answers on 14,904 requests.
- `measure.ts`: TextUtil::width from Canvas totals with the following-space rule, tab stops, the fixed-pitch width,
  `breakWord`'s probe sequence and `firstUserPerceivedCharacterLength`.
- `lines.ts`: Line, ContinuousContent, InlineContentBreaker, TextOnlySimpleLineBuilder, RangeBasedLineBuilder and
  LineBuilder, the carried remainder, trailing soft hyphens, trimming and hanging, fragments and painted width.
- `WebKitLineStart` is `{ engine, itemIndex, offset, previousLine: { carriedWidth, endsWithLineBreak } | null,
  isFirstFormattedLine }`. DESIGN.md §2.3 lists `carriedWidth` and `endsWithLineBreak` as top-level fields. The port
  nests them because both come from the previous line, and the first line has none (LineBuilder's `previousLine`
  optional).

## Failure classes

Counts from the latest run of each set (smoke-r4, runs-r2, ws-r4, policy-r2, suite-r1 + targeted-r2). Attribution: model
bug, named gap, observation (written to `rebuild/lab/ISSUES.md`), painter (shared `src/paint.ts` or the painted
document), or unresolved.

| Class | Attribution | Counts | Example |
|---|---|---|---|
| Soft hyphen plus the painter's hyphen span wraps inside the painted line box | painter | painter: suite 1,076, smoke 6, ws 2 | `c-3a9a7b6cde7063c9` |
| Painted extent one float32 step or one 1/64px edge from the prediction | observation (same floor as below) | painter: suite 538, runs 166, policy 102, smoke 14, ws 13 | `c-f561607b4cfc7606` |
| Prediction equals the native node rects, the painted text measures differently (isolated context: space kerning in `negative-space`, joined forms in `U+200D`, controls) | painter | painter: suite 499, ws 21, runs 20, policy 18, smoke 11 | `c-0145610398f11164`, `c-18f83148f2a14065` |
| Control with a .notdef advance (U+0000-U+001F, U+007F-U+009F, VT, FF, CR) left out of the observed extent | observation (ISSUES) | widths: suite 451, ws 21, smoke 9 | `c-0252d87aa4eec9f8`, `c-076e6fc979e1fea8` |
| Code point rect at a line end floored to 1/64px against a float32 prediction | observation (ISSUES) | widths: suite 171, runs 115, policy 21, smoke 5, ws 2 | `c-f561607b4cfc7606`, `c-0608392e9e6aad81` |
| Locale-chosen fonts and glyphs: lang spans, zh/ja/ko paragraphs, serif under ja | named gap `canvas-language` | runs lang-spans: breaks 47, widths 73, painter 120; policy zh-lang: breaks 4, widths 13, painter 20; policy ja line-break and word-break: widths 8; suite keep-all: widths 15; smoke: breaks 3, widths 3 | `c-00c22a2f83f30caa`, `c-2ce3baa27d3aa92a`, `c-5bb44578b1e4f691` |
| Grapheme split across a text node edge, which native layout splits too | observation (ISSUES) | breaks: runs 9 | `c-07cd469004d08bb3`, `c-a560dabf8d17cd2c` |
| Lab document splits `aبِبِ((tail` at offset 5 where a fresh document doesn't | observation (ISSUES, probe F1) | breaks: suite 7 | `c-17af0e41879fc51f` |
| Arabic spans shaped across inline boxes | named gap `rtl-shaping-across-inline-boxes` | runs bidi-runs: widths 4, painter 7 | `c-0ad060cd384930bf` |
| Thai run after ZWSP: word boundaries from Intl.Segmenter differ from libicucore's line dictionary | design stand-in (DESIGN §6.3); no gap is emitted while a segmenter exists | breaks: policy 3, smoke 1 | `c-26eedff255c8f6b5` |
| Letter-spaced span holding fi/ff/fl: the DOM drops the ligature and adds spacing per letter, Canvas keeps it (1px per ligature at 1px spacing) | named gap `letter-spacing-ligatures` | runs letter-spacing-spans: widths 5, painter 6 | `c-046c8e49140717e2` ("files ": Canvas 37.88, node rect 38.88), `c-d584db1956a0ecf6` |
| Negative line width from the compounded carry (per-letter prefixes with 5px spacing overshoot the stored width): the engine width is −2.19px as natively, the Range rect normalizes the box to 2.19px, and the port's painted width clamps to 0 | unresolved extent rule, not changed | runs: widths 1, painter 1 | `c-67db90040d06ae76` (`measurement-r2`) |
| `suite/measurement` "predicted line splits a grapheme" (emoji with U+FE0E/U+FE0F) | model bug, fixed (code path); all 6 pass in `measurement-r2` | breaks: suite-r1 6 | `c-29638bb1a4343fad` |
| Painter other (U+200D, U+2060, U+FEFF lines, mark-context, marks, source-views) | not inspected one by one; the samples looked at were the painted-context class | painter: suite 115 | `c-1dd2827f2dae0851` |

The heart-vs16, before-heart, before-sequence, after-sequence and after-skin classes (suite-r1: breaks 330, widths 52,
painter about 400) were a model bug, fixed below. After the fix, their remaining failures are the soft hyphen painter
class.

## Gaps reported

From the debug predictor (`--predictor=` with fragments, items and gaps), rows reporting each gap:

| Run | rows | canvas-language | hyphen-glyph | letter-spacing-ligatures | rtl-shaping-across-inline-boxes | fixed-pitch-path |
|---|---|---|---|---|---|---|
| runs-debug-r1 (172 failing runs cases) | 172 | 132 | | 16 | 10 | 4 |
| suite-targeted-r2 (491 reruns) | 491 | 456 | 256 | | | |

`canvas-language` is reported for every run with a non-empty locale, including `en`, so it sits on most rows. The other
gaps the port can report: `page-zoom`, `control-character-width`, `simplified-measuring`, `dictionary-breaks-unavailable`,
`ui-language`, `string-storage`.

## Changes

- suite-r1 → targeted-r2: `isComplexCodePath` missed FontCascade.cpp:961-969, the U+FE00-U+FE0F variation selectors and
  U+FE20-U+FE2F half marks. `a❤️­b` took the simple font path, so `firstUserPerceivedCharacterLength` and `breakWord`
  split U+2764 from U+FE0F. On the 491 reruns: lineCount 484/7, breaks 470/7/14. `measurement-r2` reran the six
  `suite/measurement` grapheme failures (U+FE0E and U+FE0F emoji), which all pass.
- Before r4/r2 (since runs-r1, smoke-r3, ws-r3):
  - Painted width skips pre-wrap hanging spaces before a forced break and negative-left runs.
  - Intl.Segmenter boundaries that aren't libicucore grapheme boundaries are dropped (ICU dictbe.cpp `fMarkSet`).
  - Trailing runs that can only be collapsed white space or span edges fold into the previous line.
  - A block whose items can't make a contentful run has no line box.
- Earlier:
  - Whitespace-only text nodes after a span get a renderer.
  - The fixed-pitch width shortcut requires W(cp) = W(" ") for every code point (U+3000 falls back in Menlo).

## Follow-up probes

`rebuild/probes/webkit-followups.ts`, run in webkit-host (`.artifacts/probes/webkit/followups/webkit-host-probes.json`):

- F1 (Amiri) `aبِبِ((tail` at 15.5px, RTL, pre-wrap: 6 lines, `a | بِ | بِ(( | t | a | il`, as the port predicts. The lab rows
  of the same case have 7 lines; see ISSUES.md.
- F1 (Arial) at 8px: 6 lines, the same shape.
- F1 (Amiri, Arabic after) `aبِبِ((بب`: `a | بِ | بِ(( | ب…`, no split at 5.
