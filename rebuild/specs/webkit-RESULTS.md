# WebKit port results (Safari 27.0, WebKit 7625.1.29.11.27)

Lab runs of `rebuild/src/engines/webkit` in `webkit-host`, the system WebKit.framework that installed Safari 27.0 runs
(CFBundleVersion 22625.1.29.11.27, macOS 27, libicucore 78.1), on this Mac (Retina, `devicePixelRatio` 2), 2026-09-16,
after the audit fixes (specs/webkit-AUDIT.md §8). Rows, summaries and per-case files are under
`.artifacts/lab/webkit/<run>/`. Every run is scored with `rebuild/lab/score.ts` as of 10:10, which compares WebKit
widths as float32 edges; a "0 units" failure is a difference below 1/64px.

Installed Safari wasn't run: Safari was the frontmost app at every check (11:13 to 11:40), and the machine rules allow
Safari windows only while it isn't. WEBKIT-HOST.md reserves reported numbers for installed Safari, so these are
host numbers.

## Scores

pass / fail / unobserved (not-applicable left out). "Before" is the audit's rescoring of the previous rows with the same
scorer (webkit-AUDIT.md §2).

| Case set | Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke (300) | before: smoke-r4 | 299/1/0 | 292/4/4 | 241/10/41 | 244/39/17 |
| smoke (300) | smoke-r7 | 299/1/0 | 293/3/4 | 247/5/41 | 248/35/17 |
| ws (1,019) | before: ws-r4 | 1019/0/0 | 1019/0/0 | 843/9/167 | 823/36/160 |
| ws (1,019) | ws-r7 | 1019/0/0 | 1019/0/0 | 847/5/167 | 827/32/160 |
| policy (1,606) | before: policy-r2 | 1603/1/2 | 1574/8/24 | 1524/42/8 | 1441/158/7 |
| policy (1,606) | policy-r5 | 1603/1/2 | 1575/7/24 | 1546/21/8 | 1460/139/7 |
| runs (2,580) | before: runs-r2 | 2566/10/4 | 2520/50/10 | 2142/199/179 | 2078/332/170 |
| runs (2,580) | runs-r5 | 2566/10/4 | 2521/49/10 | 2257/83/181 | 2156/252/172 |
| suite sample (19,933 rows) | before: suite-r1 + targeted-r2 | 19903/27/3 | 19718/42/173 | 14344/91/5283 | 17478/2066/389 |
| suite sample (19,933 rows) | suite-r4 | 19910/20/3 | 19724/36/173 | 14401/38/5285 | 17507/2036/390 |
| suite sample, page-history cases left out | suite-r4 | 19860/15/3 | 19697/16/165 | 14376/37/5284 | 17464/2024/390 |

- The suite sample runs in four parts of 5,000 (`suite-sample-part{0..3}.ndjson`, `suite-r4-part{0..3}/`); run.ts
  selects 4,998 cases in part 2 and 4,935 in part 3. `per-case-all.ndjson` and `summary-all.json` score every row;
  `per-case.ndjson` and `summary.json` leave out page-history cases (below).
- Page history: `suite-r2-reverse-part{0..3}/` ran each part with `--order=reverse`, and the suite-r4 parts are scored
  with `--native-compare` against those rows. 55 cases lay out differently in the two orders (11, 0, 25, 19 per part):
  original-vs-reshaped-admission 13, ascii-angle-policy, explicit-locale-quotes, numeric-postfix-grammar,
  numeric-prefix-grammar, opening-quote-ownership and repeated-pr-opener 4 each, policy/fullwidth-paren 3, and others.
  The comparison only finds what the two orders expose (lab README "Page-history dependence").
- Prediction errors: 0 in every run.

## measureText calls per paragraph

From `prediction.measureLog` (calls that reached Canvas; the per-layout memo answers repeats).

| Run | mean | median | p90 | p95 | max |
|---|---|---|---|---|---|
| smoke-r7 | 16.5 | 11 | 37 | 53 | 86 |
| ws-r7 | 15.4 | 11 | 31 | 37 | 72 |
| policy-r5 | 16.0 | 12 | 35 | 47 | 99 |
| runs-r5 | 23.1 | 17 | 47 | 61 | 103 |
| suite-r4 | 12.5 | 6 | 30 | 38 | 2,059 |

The previous means were 14.3, 12.9, 14.5, 20.7 and 11.5. The increase is the primary-font coverage test, two calls per
distinct code point of a fixed-pitch box (content.ts `makeBox`). The suite maximum is still `c-c8b0ddb41a784eda` (then
`c-a580f4ad18b9ea2c` at 1,580 and `c-d5ffa42e1eca7ac8` at 1,400): long words split by `breakWord`, whose probe sequence
measures prefixes from the item start (specs/webkit-lines.md §8.1).

## What the port does

- `content.ts`: textRendererIsNeeded, InlineTextBox content per text node, `characterRangeCodePath`, simplified measuring
  with the primary-font coverage test for fixed-pitch families, the fixed-pitch allowlist, items at BreakablePositions,
  the bidi paragraph with item splits and opaque levels, stored widths, builder choice, gaps.
- `breaks.ts`, `data.ts`: BreakablePositions verbatim (classify, the pair table, the stale fast-forward state, keep-all
  with 16-bit punctuation), libicucore line tables per locale and mode with Apple's quote overrides, `mayBreakInBetween`
  with the next box's style, and dictionary boundaries per engine range with the engines' minimum span and mark rules.
- `measure.ts`: TextUtil::width from Canvas totals with the following-space rule, tab stops, the fixed-pitch width,
  `breakWord`'s probe sequence and `firstUserPerceivedCharacterLength`.
- `lines.ts`: Line, ContinuousContent, InlineContentBreaker, TextOnlySimpleLineBuilder, RangeBasedLineBuilder and
  LineBuilder, the carried remainder, trailing soft hyphens, trimming, hanging, the trailing white space level reset, and
  the painted extent from InlineDisplayContentBuilder's box geometry.
- `WebKitLineStart` is `{ engine, itemIndex, offset, previousLine: { carriedWidth, endsWithLineBreak } | null,
  isFirstFormattedLine }`. DESIGN.md §2.3 lists `carriedWidth` and `endsWithLineBreak` as top-level fields. The port
  nests them because both come from the previous line, and the first line has none (LineBuilder's `previousLine`
  optional).

## Failure classes

Counts from the latest run of each set, lineCount, breaks and widths results, page-history cases left out. Each
failing case's gaps come from `gaps-r1/`, the in-page gap predictor over all 254 failing cases. Attribution: named gap,
page history, or unresolved. Every failing case except the page-history class reports a gap.

| Class | Attribution | Counts | Example |
|---|---|---|---|
| Locale-chosen fonts: lang spans, zh/ja/ko paragraphs, serif or sans-serif with Han, kana or Hangul under a language | named gap `canvas-language` | runs: widths 73, breaks 47, lineCount 8; policy: widths 21, breaks 5, lineCount 1; suite: widths 15, breaks 2, lineCount 2; smoke: widths 5, breaks 3, lineCount 1; ws: widths 1 | `c-024909ef9234f390`, `c-64bf20f7c2d249a1`, `c-142318ab2676108c` |
| Letter-spaced text with ligatures or joined Arabic: the DOM turns ligatures off, Canvas keeps them | named gap `letter-spacing-ligatures` | suite: widths 8, lineCount 5, breaks 4; runs: widths 5, lineCount 1, breaks 1 | `c-046c8e49140717e2`, `c-f561607b4cfc7606` |
| Controls with a `.notdef` or CR advance Canvas can't give | named gap `control-character-width` | suite: widths 6, breaks 1; ws: widths 3 | `c-790a15d5d04b7c3a`, `c-076e6fc979e1fea8` |
| Arabic spans shaped across inline boxes, which also splits runs where the port doesn't | named gap `rtl-shaping-across-inline-boxes` | runs: widths 5, lineCount 1, breaks 1 | `c-0ad060cd384930bf`, `c-d03f94e8fb53e7e2` |
| A dictionary range that starts with a combining mark, where libicucore's engine resynchronizes from its dictionary | named gap `dictionary-breaks-stand-in` | policy: breaks 2 | `c-8e0ef1214d002403`, `c-2a1fef66065962b0` |
| Shortcut-path summing order, one float32 step | named gap `simplified-measuring` | suite: widths 1; ws: widths 1 | `c-08d207e44b9fbbb4`, `c-fbd2f77752afe430` |
| Hyphen glyph at soft hyphens in fixture fonts | named gap `hyphen-glyph` | suite: widths 1, lineCount 1, breaks 1 | `c-311b65d1c9ab10e4` |
| Amiri `a…((tail` cases and one Times New Roman case: native lines after other cases of the family differ from a fresh document, which equals the port (probe F1, ISSUES.md) | page history, not exposed by the reverse run | suite: breaks 8, lineCount 7, widths 6 | `c-17af0e41879fc51f`, `c-718c3e84352a57fc`, `c-6e866f68bcc7bb7e` |
| 55 suite cases whose native lines differ between forward and reverse order | page history, flagged by `--native-compare` | left out of the counts | `c-9577ee04c2807ef2`, `c-cd9aa832387ef76f` |

Painter results, which paint.ts and the painted document decide, not the prediction:

| Reason | Counts | Example |
|---|---|---|
| Painted line wraps: mostly a soft hyphen plus the painter's hyphen span wrapping inside the painted line box | suite 1,133, runs 40, policy 14, smoke 10, ws 4 | `c-3a9a7b6cde7063c9` |
| Painted extent differs: the prediction equals the native boxes and the painted text measures differently (isolated shaping context, joined forms, controls, negative carried widths painted fresh) | suite 891, runs 212, policy 125, ws 28, smoke 25 | `c-0145610398f11164`, `c-ffb529e6cf621a00` |

## Gaps reported

`census.ts` (scratchpad `wk-r5/`) prepares every case in bun with a stand-in Canvas, so `simplified-measuring` never fires
there; the in-page run `gaps-r1` gives it on failing cases. Rows reporting each gap among the cases that pass every
metric:

| Set (all-pass cases) | canvas-language | string-storage | fixed-pitch-path | letter-spacing-ligatures | control-character-width | hyphen-glyph | rtl-shaping | dictionary-breaks-stand-in |
|---|---|---|---|---|---|---|---|---|
| smoke (265) | 88 | 16 | 49 | 27 | 16 | 23 | 12 | 3 |
| ws (987) | 193 | 11 | 363 | | 227 | 38 | | |
| policy (1,465) | 727 | 91 | 118 | | | | | 9 |
| runs (2,327) | 858 | 110 | 497 | 488 | | 12 | 351 | |
| suite (17,851) | 3,623 | 486 | 1,919 | 2,129 | 646 | 4,694 | | 1 |

Before the fixes `canvas-language` fired on 12,329 of 17,832 all-pass suite cases (webkit-AUDIT.md B4). Not reported:
`locl` lookups for a language in fonts outside the reported conditions. WebKit shapes with the locale
(FontCascade.cpp:403, WidthIterator.cpp:96), OffscreenCanvas has none, and Canvas shows no sign of which fonts carry
such lookups.

## Changes since the audit

- Painted width: each line's width is the extent of the display boxes InlineDisplayContentBuilder gives its text runs:
  - a box keeps its run's width after trimming, f32(f32(w + space) − space), not the content width;
  - bidi lines place boxes in visual order (ubidi_reorderVisual over run levels), advancing by f32(width + margin);
  - an RTL line's content starts at f32(line width − content logical right);
  - negative box widths draw left of their x;
  - the lab's trailing run is left out (SPACE and TAB under normal, nowrap, pre-line and pre-wrap, and default-ignorable
    code points), except a run that carries the line's hyphen.

  `resetBidiLevelForTrailingWhitespace` detaches trailing white space as the source does.
- Dictionary boundaries: engine ranges start at the first dictionary character of a rule segment and hold one engine's
  characters, with no breaks inside ranges too short for two words: four code points for Thai, under four code units for
  the others. A boundary before a Line_Break=SA combining mark is dropped (`fMarkSet`), where the grapheme filter was.
  `breaks.test.ts` compares the dictionary path with libicucore's own line iterator over the groundwork's 1,556 SA texts
  (`runtime-parity/sa`): 27 of 282,337 positions differ, all in ranges that start with a mark.
- Fixed-pitch coverage: a code point comes from the primary family when "P, LastResort" measures what the paragraph's
  family list measures (probe `webkit-followups B5`: Courier maps Ω and keeps the 38.40625px shortcut, Menlo doesn't map
  U+3000). This replaces the W(cp) = W(space) test.
- Gap conditions:
  - `canvas-language`: -webkit-standard under Han, kana or Hangul locales; system-ui and ui-* families; Han, kana,
    Hangul and fullwidth code points under any locale.
  - `simplified-measuring`: a measured width off the 1/2048px grid on the shortcut path.
  - `string-storage`: adds Latin-1 items whose second unit can't start a line.
  - `dictionary-breaks-stand-in`: new shared gap name.
- Generated data: `webkitDictionaryMarkRanges` and `webkitDefaultIgnorableRanges` from ICU 78.2's ppucd.txt.

## Follow-up probes

`rebuild/probes/webkit-followups.ts`, run in webkit-host:

- F1 (`.artifacts/probes/webkit/followups/`): Amiri `aبِبِ((tail` at 15.5px, RTL, pre-wrap gives 6 lines as the port
  predicts; the lab rows of the family give 7 after other cases in the document (ISSUES.md).
- B5 (`.artifacts/probes/webkit/followups-b5/`): LastResort is reachable by name, 17.6015625px for every code point at
  16px. Menlo maps a, Ω, ─, →, ж and €, not U+3000 or 中; Courier maps a, Ω and €. DOM: Courier `ΩΩΩΩ` 38.40625px,
  Menlo `a　a` 35.265625px (= Canvas, full path), Menlo `a─a` 28.8984375px.
