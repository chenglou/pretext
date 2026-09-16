# Baseline: main's library through the lab

`rebuild/lab/baselines/main-predictor.ts` predicts with the current library in `src/` (main 2e5e2bd's public API,
source unchanged) the way an app developer uses it, so the rebuild's engines have a number to beat on the same case
sets. Runs of 2026-09-16: Chrome 153, Firefox 156 and webkit-host on WebKit 22625.1.29.11.27 (Safari 27.0's build), all
at DPR 2, on `.artifacts/lab/cases/{smoke,runs,ws,policy,suite-sample}.ndjson`. Rows, summaries and per-case files are
in `.artifacts/lab/baseline-main/<browser>/<set>/`; the suite-sample rows ran in four parts (`suite-sample-1` to `-4`) and
were scored together.

## Results

Counts are cases. Each metric is pass / fail / unobserved; widths add not-applicable (breaks failed or were
unobserved). `cases` is the set's cases for that browser after its `browsers` filter, `unsupported` the ones main can't
express, and `scored` the rest, which the browser observed. No row has an adapter error or a native observation error.
measureText is the mean number of calls per scored case with main's caches cleared before each case.

### chrome

| set | cases | unsupported | scored | lineCount | breaks | widths | measureText |
|---|---:|---:|---:|---|---|---|---:|
| smoke | 299 | 196 | 103 | 79 / 24 / 0 | 69 / 28 / 6 | 31 / 36 / 2 / 34 | 15.4 |
| runs | 2,580 | 2,559 | 21 | 21 / 0 / 0 | 21 / 0 / 0 | 11 / 10 / 0 / 0 | 31.0 |
| ws | 1,019 | 916 | 103 | 89 / 14 / 0 | 83 / 20 / 0 | 40 / 43 / 0 / 20 | 20.4 |
| policy | 1,606 | 1,198 | 408 | 397 / 11 / 0 | 387 / 21 / 0 | 188 / 199 / 0 / 21 | 29.1 |
| suite-sample | 19,994 | 0 | 19,994 | 15,400 / 4,593 / 1 | 14,682 / 5,088 / 224 | 7,566 / 6,844 / 272 / 5,312 | 20.5 |

### firefox

| set | cases | unsupported | scored | lineCount | breaks | widths | measureText |
|---|---:|---:|---:|---|---|---|---:|
| smoke | 297 | 196 | 101 | 85 / 16 / 0 | 73 / 23 / 5 | 52 / 15 / 6 / 28 | 15.0 |
| runs | 2,580 | 2,559 | 21 | 21 / 0 / 0 | 21 / 0 / 0 | 19 / 2 / 0 / 0 | 31.1 |
| ws | 1,019 | 916 | 103 | 95 / 8 / 0 | 88 / 15 / 0 | 70 / 17 / 1 / 15 | 20.3 |
| policy | 1,606 | 1,198 | 408 | 396 / 12 / 0 | 387 / 21 / 0 | 373 / 14 / 0 / 21 | 28.4 |
| suite-sample | 19,888 | 0 | 19,888 | 17,820 / 2,065 / 3 | 16,804 / 2,316 / 768 | 12,432 / 2,358 / 2,014 / 3,084 | 20.2 |

### webkit-host

| set | cases | unsupported | scored | lineCount | breaks | widths | measureText |
|---|---:|---:|---:|---|---|---|---:|
| smoke | 300 | 196 | 104 | 81 / 23 / 0 | 73 / 27 / 4 | 51 / 10 / 12 / 31 | 18.5 |
| runs | 2,580 | 2,559 | 21 | 20 / 1 / 0 | 20 / 1 / 0 | 13 / 2 / 5 / 1 | 43.3 |
| ws | 1,019 | 916 | 103 | 88 / 15 / 0 | 82 / 21 / 0 | 50 / 7 / 25 / 21 | 29.2 |
| policy | 1,606 | 1,198 | 408 | 383 / 25 / 0 | 335 / 66 / 7 | 284 / 51 / 0 / 73 | 34.1 |
| suite-sample | 19,933 | 0 | 19,933 | 15,684 / 4,246 / 3 | 14,912 / 4,848 / 173 | 11,018 / 2,099 / 1,795 / 5,021 | 28.7 |

### Subgroups of the scored cases

| subgroup | browser | scored | lineCount | breaks | widths |
|---|---|---:|---|---|---|
| suite-sample, old suite requires height or lineCount | chrome | 7,771 | 7,771 / 0 / 0 | 7,763 / 5 / 3 | 3,620 / 4,142 / 1 / 8 |
| | firefox | 7,727 | 7,726 / 1 / 0 | 7,717 / 8 / 2 | 7,571 / 145 / 1 / 10 |
| | webkit-host | 7,774 | 7,770 / 4 / 0 | 7,770 / 2 / 2 | 6,336 / 1,409 / 25 / 4 |
| suite-sample without the `suite/U+*` control-character families | chrome | 15,614 | 13,794 / 1,819 / 1 | 13,220 / 2,184 / 210 | 7,423 / 5,618 / 179 / 2,394 |
| | firefox | 15,508 | 14,455 / 1,050 / 3 | 13,517 / 1,223 / 768 | 12,268 / 1,031 / 218 / 1,991 |
| | webkit-host | 15,553 | 13,685 / 1,865 / 3 | 13,097 / 2,283 / 173 | 10,568 / 1,805 / 724 / 2,456 |
| suite-sample, direction rtl | chrome | 4,690 | 2,592 / 2,097 / 1 | 2,417 / 2,251 / 22 | 1,199 / 1,099 / 119 / 2,273 |
| | firefox | 4,656 | 3,761 / 895 / 0 | 3,448 / 918 / 290 | 1,445 / 1,046 / 957 / 1,208 |
| | webkit-host | 4,658 | 2,723 / 1,935 / 0 | 2,452 / 2,188 / 18 | 1,395 / 256 / 801 / 2,206 |
| policy, paragraph lang differs from `<html lang>` | chrome | 192 | 186 / 6 / 0 | 178 / 14 / 0 | 92 / 86 / 0 / 14 |
| | firefox | 192 | 185 / 7 / 0 | 178 / 14 / 0 | 177 / 1 / 0 / 14 |
| | webkit-host | 192 | 180 / 12 / 0 | 150 / 35 / 7 | 118 / 32 / 0 / 42 |
| suite-sample, paragraph lang differs from `<html lang>` | chrome | 89 | 81 / 8 / 0 | 70 / 19 / 0 | 40 / 30 / 0 / 19 |
| | firefox | 89 | 78 / 11 / 0 | 66 / 23 / 0 | 54 / 12 / 0 / 23 |
| | webkit-host | 89 | 74 / 15 / 0 | 64 / 25 / 0 | 51 / 13 / 0 / 25 |

The first subgroup is the old wrapping suite's own gate: rows whose `required` metrics (kept in the case's `origin`)
include height or lineCount. Main passes nearly all of them, as its suite says it should, which also checks that the
adapter reads main's lines faithfully. Most suite-sample failures come from research rows the old suite didn't require.
The control-character families (`suite/U+0000/end` and so on, 4,380 cases for Chrome) give 2,774 of Chrome's 4,593 line
count failures, 1,015 of Firefox's 2,065 and 2,381 of webkit-host's 4,246. Most of the rest come from emoji sequences
with a soft hyphen or ZWSP at narrow widths (`woman-before-zwj/shy`, `skin-modifier/zwsp` and similar).

Scored-case failure reasons in suite-sample, as the scorer names them: line counts fail only as "line count differs".
Breaks fail on line counts (Chrome 4,517, Firefox 1,833, webkit-host 4,176) or on the first visible code point with
equal counts (571, 483, 672). Widths are unobserved mostly for a positive soft hyphen rect at a line end (189, 1,900,
1,518).

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

Direction isn't a reason: main has no direction option, but its line breaks don't depend on direction (its README has
the paragraph rendered as one element with its direction set), so RTL cases are predicted like LTR ones. Every
suite-sample case is supported; its multi-run cases give every run the same style.

Cases per reason. A case can have several reasons, so a column can add up to more than the unsupported count. The
counts are the same in every browser.

| reason | smoke | runs | ws | policy |
|---|---:|---:|---:|---:|
| several runs with different styles | 110 | 2,364 | 643 | 0 |
| overflow-wrap normal | 60 | 369 | 150 | 555 |
| overflow-wrap anywhere | 23 | 231 | 98 | 183 |
| word-break break-all | 13 | 0 | 0 | 248 |
| word-break break-word | 6 | 0 | 0 | 66 |
| line-break loose / normal / strict / anywhere | 12 / 5 / 6 / 7 | 30 / 39 / 27 / 0 | 0 | 123 / 102 / 138 / 130 |
| span lang differs from the paragraph | 14 | 360 | 0 | 23 |
| word-spacing | 12 | 354 | 0 | 0 |
| white-space pre-line / break-spaces / pre / nowrap | 7 / 10 / 2 / 4 | 87 / 60 / 0 / 0 | 195 / 210 / 102 / 102 | 0 |
| tab-size 0 / 2 / 3 | 0 | 0 | 2 / 3 / 3 | 0 |
| unsupported cases | 196 | 2,559 | 916 | 1,198 |

The browsers observed only the supported cases. `.artifacts/lab/baseline-main/cases/` holds each set's supported
cases, byte-identical to the set's lines, and `support.json` the counts above. The scorer ran with `--cases` on the
original set files.

## How the adapter uses main

- Font: one canvas font string from the style all runs share: `[italic ][weight ]<size>px <family>`, leaving out
  weight 400 (`16px Arial`, `italic 700 18px "Helvetica Neue"`).
- `prepareWithSegments(text, font, options)` with `whiteSpace: 'pre-wrap'` for pre-wrap, `wordBreak: 'keep-all'` for
  keep-all and `letterSpacing` when it isn't 0, then `walkLineRanges(prepared, paragraph.width, ...)`. Line height
  doesn't change main's lines.
- Language: main takes break rules and Canvas font resolution from `<html lang>` only. Before each case the adapter
  calls `setLocale(paragraph.lang)`, which only sets the word segmenter's locale (and clears main's caches). A paragraph
  whose `lang` differs from the page's is predicted under the page's language; the subgroup table counts those cases.
- Line ranges: `walkLineRanges` cursors index main's segment stream, the text after main's white-space normalization
  (normal: runs of SPACE, TAB, LF, CR and FF become one SPACE, a leading and a trailing one are dropped, and the Blink
  and Gecko profiles remove a run with LF next to a ZWSP; pre-wrap: CRLF, CR and FF become LF). The adapter turns a
  cursor into a stream offset (the segment's start plus the grapheme's offset from `Intl.Segmenter`), aligns the joined
  segments with the source text once, and maps each line's first and last stream unit to source offsets. A collapsed
  run belongs to the line whose stream holds its SPACE. Source white space main removed, such as leading spaces,
  belongs to no line. The adapter never searches line text. When the stream doesn't align with the source, the
  prediction is an adapter error; no row has one. Before the browser runs, a check with a fake canvas under a Chrome,
  Safari and Firefox user agent found forward, disjoint ranges covering every inked code point in every supported case.
- Widths: `LayoutLineRange.width` as main reports it.
- measureText: main doesn't report calls, so the adapter counts calls to `CanvasRenderingContext2D.prototype.measureText`
  and `OffscreenCanvasRenderingContext2D.prototype.measureText` while `predict` runs. Because `setLocale` clears the
  caches, each count is one cold prepare.
- `paint` returns null, so the painter metric is not-applicable everywhere.

## Caveats

- Width semantics. Main's width is a float sum of Canvas advances. Blink's line extent is in LayoutUnits (1/128 CSS px
  at DPR 2) and comes out one unit wider, so in Chrome main misses by exactly one grid unit on many lines: 4,844 of the
  6,844 width-failing suite-sample cases miss by at most one unit on every mismatched line (9,981 of 12,773 mismatched
  lines), and 170 of 199 in policy. In Firefox (1/60 px) that's 45 of 2,358. webkit-host is scored by float32 line edges;
  1,581 of its 2,099 width-failing cases are within one 1/64 px unit. Compare Chrome widths with this in mind.
- Pre-wrap trailing spaces. Main counts the part of the spaces before a newline or at the end of the text that fits in
  the width. The lab treats them as hanging and leaves them out of the extent. Few lines have this: 55 of Chrome's
  mismatched suite-sample lines, 66 of Firefox's and 18 of webkit-host's.
- Control characters. Main takes the Canvas width of C0 and C1 controls (5 to 13 px in these rows, such as U+0001 at
  5.33 px in Chrome and U+0000 at 13 px in Firefox), where the engines give them no width, so lines holding one fail
  widths and often line counts.
- Lone CR in pre-wrap. Main breaks the line there and browsers don't; README documents it. It affects 36 suite-sample
  cases, 8 ws cases and 1 smoke case.
- Missing fonts. Some rows name families the page couldn't resolve (Chrome 44 rows, Firefox 65, webkit-host 24: SimSun,
  Noto Sans Myanmar in Firefox, Yu Mincho and others). Native layout and Canvas both fall back, not necessarily to the
  same font.
- History dependence. These rows observed only the supported cases, in each set's order, so a case's predecessors in
  the document differ from other lab runs. No `--native-compare` was run, so the few WebKit cases that depend on
  earlier cases aren't flagged.
- Prediction time (`predictMs`, cold caches, adapter included): suite-sample totals 1.5 s in Chrome, 1.4 s in Firefox and
  2.2 s in webkit-host for about 20,000 cases.

## Reproducing

```sh
python3 .artifacts/session/with-browser-lock.py baseline-main-<browser>-<set> -- \
  bun rebuild/lab/run.ts --browser=<browser> --cases=.artifacts/lab/baseline-main/cases/<set>.ndjson \
  --out=.artifacts/lab/baseline-main/<browser>/<set> --predictor=rebuild/lab/baselines/main-predictor.ts
bun rebuild/lab/score.ts --rows=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-rows.ndjson \
  --cases=.artifacts/lab/cases/<set>.ndjson --out=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-summary.json \
  --per-case=.artifacts/lab/baseline-main/<browser>/<set>/<browser>-per-case.ndjson --examples=10
```

The supported-case files select the lines of a set whose `unsupportedReasons(c)` (exported by the adapter) is empty.
`run.ts` also takes a full set file; the unsupported cases then score as failures with the reason "prediction error",
and the supported ones run after other predecessors.
