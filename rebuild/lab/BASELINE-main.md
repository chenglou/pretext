# Baseline: main's library through the lab

`rebuild/lab/baselines/main-predictor.ts` predicts with the library in `src/` (main `48980bb`, source unchanged) through
main's own harness adapter, `harness/predict.ts`: the way an app developer uses main, and the way main's harness judges it.
It is the number the redo's stopping rule (2) measures against: a superset of main in all three engines, rich inline
included (rebuild/README.md). The runs below are of 2026-09-25: every tier 2 set (`rebuild/tests/sets.ts`) in pinned
Chrome 154.0.8037.57, Firefox 156.0.1 and webkit-host on WebKit 22625.1.29.11.27, at DPR 2, in file order, with their own
native observations (`rebuild/tests/browser-sets.ts --predictor=rebuild/lab/baselines/main-predictor.ts`), and main's
harness case files against main's recordings. Rows, joins and scripts are in `.artifacts/tests/runs/rule2-20260925/`.
The baseline of main `2e5e2bd` (2026-09-16, five sets) is in this file's history; its rows stay in
`.artifacts/lab/baseline-main/`.

## How a case is judged

A case is right when the prediction has the browser's line count and every visible code point (one whose positive-width
rects all sit on one native line) lies in the predicted line of that index: `rebuild/tests/check-main-obligations.ts`
`evaluateVisibleRanges`, which is main's harness rule read on the lab's rects. Main's rows carry line ranges alone, so the
lab's `breaks` and `widths` metrics don't apply to them. The redo's side is its frozen tier 2 predictions
(`.artifacts/tests/reference/<browser>-<config>/browser`, which tier 1 finds equal to this tree's, and which the re-pin
found Chrome 154 and Firefox 156.0.1 record the same), judged on the same native observation as main's, from main's run.
`tools/join-tier.ts` does it; without and with the lab's facts. No row shows a disagreement between main's line APIs.

## Tier 2 sets

Cases per set, the redo without facts. "Main can't express" counts the cases whose prediction is `unsupported by main`.

| set | chrome: cases / main can't express / main right / redo right / main only / redo only | firefox | webkit-host |
|---|---|---|---|
| smoke-hand | 25 / 25 / 0 / 25 / 0 / 25 | 25 / 25 / 0 / 25 / 0 / 25 | 25 / 25 / 0 / 25 / 0 / 25 |
| smoke | 299 / 148 / 124 / 295 / 0 / 171 | 297 / 148 / 133 / 295 / 0 / 162 | 300 / 148 / 132 / 297 / 0 / 165 |
| runs | 2,580 / 1,317 / 1,219 / 2,577 / 0 / 1,358 | 2,580 / 1,317 / 1,243 / 2,580 / 0 / 1,337 | 2,580 / 1,317 / 1,237 / 2,579 / 0 / 1,342 |
| ws | 1,019 / 805 / 179 / 982 / 0 / 803 | 1,019 / 805 / 191 / 978 / 1 / 788 | 1,019 / 805 / 175 / 985 / 0 / 810 |
| policy | 1,606 / 1,198 / 391 / 1,606 / 0 / 1,215 | 1,606 / 1,198 / 404 / 1,606 / 0 / 1,202 | 1,606 / 1,198 / 401 / 1,602 / 0 / 1,201 |
| rich-prewrap | 1,334 / 1,334 / 0 / 1,334 / 0 / 1,334 | 1,334 / 1,334 / 0 / 1,334 / 0 / 1,334 | 1,334 / 1,334 / 0 / 1,326 / 0 / 1,326 |
| twins | 380 / 380 / 0 / 380 / 0 / 380 | | |
| wide-group-cuts | 2,159 / 2,159 / 0 / 2,118 / 0 / 2,118 | | |
| suite-sample | 19,994 / 0 / 15,048 / 19,369 / 3 / 4,324 | 19,888 / 0 / 17,867 / 19,297 / 30 / 1,460 | 19,933 / 0 / 15,788 / 19,355 / 2 / 3,569 |
| families | 11,154 / 10,706 / 270 / 10,894 / 6 / 10,630 | 9,776 / 9,328 / 429 / 9,524 / 4 / 9,099 | 9,726 / 9,278 / 426 / 9,674 / 0 / 9,248 |
| features | 13,010 / 13,010 / 0 / 12,994 / 0 / 12,994 | 12,050 / 12,050 / 0 / 12,050 / 0 / 12,050 | 12,268 / 12,268 / 0 / 12,236 / 0 / 12,236 |
| features-en-US | 468 / 468 / 0 / 468 / 0 / 468 | | |
| heldout-runs | 2,579 / 1,340 / 1,179 / 2,577 / 0 / 1,398 | 2,579 / 1,340 / 1,194 / 2,576 / 0 / 1,382 | 2,579 / 1,340 / 1,224 / 2,577 / 0 / 1,353 |
| heldout-ws | 1,022 / 789 / 202 / 993 / 0 / 791 | 1,022 / 789 / 213 / 991 / 0 / 778 | 1,022 / 789 / 201 / 996 / 0 / 795 |
| heldout-policy | 1,604 / 1,202 / 393 / 1,604 / 0 / 1,211 | 1,604 / 1,202 / 399 / 1,604 / 0 / 1,205 | 1,604 / 1,202 / 395 / 1,604 / 0 / 1,209 |
| heldout-suite-sample | 9,991 / 0 / 6,640 / 9,752 / 7 / 3,119 | 9,991 / 0 / 8,517 / 9,878 / 1 / 1,362 | 9,991 / 0 / 7,441 / 9,807 / 6 / 2,372 |
| all | 69,224 / 34,881 / 25,645 / 67,968 / 16 / 42,339 | 63,771 / 29,536 / 30,590 / 62,738 / 36 / 32,184 | 63,987 / 29,704 / 27,420 / 63,063 / 8 / 35,651 |

With the lab's facts the redo is right on 68,081, 62,760 and 63,063 cases, and main only on 6, 35 and 8. In Chrome 2,809
of the cases main predicts go through rich inline; the 2026-09-16 adapter had no rich inline and left out every case with
runs of several styles.

Each case main gets right and the redo doesn't was read line by line (`tools/explain-losses.ts`, `tools/classify.py`;
`classify-no-facts.txt`, `classify-facts.txt`) and put in the first class that fits: page history (the reference calls it
history-dependent, main's run laid it out otherwise than the redo's run did, or the redo reports `page-history`), narrower
than 24 px, main right by luck (main's width of the line whose end is in dispute is more than 0.05 px off the browser's),
and a true redo loss (main has that width to 0.05 px).

| browser | main only | page history | narrower than 24 px | main right by luck | true redo loss |
|---|---:|---:|---:|---:|---:|
| chrome | 16 | 0 | 4 | 5 | 7 |
| firefox | 36 | 14 | 17 | 4 | 1 |
| webkit-host | 8 | 5 | 1 | 1 | 1 |
| chrome, with facts | 6 | 0 | 2 | 3 | 1 |
| firefox, with facts | 35 | 14 | 17 | 4 | 0 |
| webkit-host, with facts | 8 | 5 | 1 | 1 | 1 |

- True redo losses. Chrome: `rule/in-word-breaks`, six cases, `x AVAV…AV y` in 16 and 24px Times New Roman and Hoefler
  Text at 157-357 px, where main's widths are Chrome's to 1/128 px: in four the redo fits `x ` and the kerned word on one
  line, at least 0.1-0.6 px narrower than Chrome's, and in two (1px of letter spacing) it breaks inside the word a letter
  later than Chrome, past the available width by its own measure. The redo reports `unsafe-to-break` there, and with the
  lab's facts it gets all six right. `suite/partial-source-context`, 24px Amiri, `‏((tail` right to left at 40 px: the
  redo measures `((tai` more than 4 px wider than Chrome and breaks before `i` (`script-context`, `unsafe-to-break`; with
  facts too). Firefox:
  `ws/text-nodes`, 16px Times New Roman `past.”␍␍with` at 68 px, where the redo fits `past.` and Firefox breaks after
  `past` (`in-word-prefix`). webkit-host: `suite/ligature-thresholds-v3`, 16px ProbeShantell with letter spacing at
  25.68 px (`letter-spacing-ligatures`).
- Main right by luck. Chrome: `suite/U+FFFC` (main's line 2.4-8.5 px narrower than Chrome's around U+FFFC) and
  `suite/source-shaped-arabic` at 24 px (4.6 px). Firefox: `rule/in-word-breaks` in Hoefler Text, where main sums the
  graphemes without the kerning Firefox applies and is 0.9-1.5 px off. webkit-host: `suite/source-views/long-tail-edge-falsifier`
  (9.6 px).
- Page history: Firefox's curly and straight quote, guillemet, signed-spacing and space-context-emoji cases beside emoji
  (the reference calls all 14 history-dependent); webkit-host's five `suite/U+000D/middle` cases, where the redo reports
  `page-history` beside `control-character-width`.

## Main's harness case files

The redo (`baselines/inspected-ranges-predictor.ts`, the facts-free inspected core as line ranges, `run.ts
--predict-only`) on every case file of main's harness (`harness/cases/*.ndjson` at `48980bb`), judged by main's own
`score()` against main's recordings (`harness/recordings/<browser>.txt`: the same builds, OS build, page languages, DPR 2
and fonts as the lab's runs; Chrome given an en-US interface, as main's harness gives it). Main's verdict is main's
lists: a pinned case is right unless `harness/accepted/<browser>.txt` lists it, and a varying `runs` case isn't judged.
Two lab changes served this run and aren't committed (`harness-run-local.patch`): the fonts come from `harness/fonts`,
which adds Inter and Roboto, and a page may have no language, as 1,498 of the sample's cases have. The rich and sample
cases with a chip (an inline-block of text, rich-inline's `break: 'never'`) or with padding repeated on every line
(`box-decoration-break: clone`, rich-inline's `extraWidth`), 391 cases, weren't run: the redo's atomic inlines are boxes
of a declared size and its box edges slice (DESIGN.md §1.1), so it can't express them. `tools/harness-join.ts`,
`harness/join-<browser>.json`.

| file | chrome: pinned / main right / redo right / main only / redo only | firefox | webkit-host |
|---|---|---|---|
| smoke | 316 / 316 / 316 / 0 / 0 | 316 / 316 / 316 / 0 / 0 | 316 / 316 / 316 / 0 / 0 |
| reports | 27 / 23 / 27 / 0 / 4 | 27 / 24 / 27 / 0 / 3 | 27 / 27 / 27 / 0 / 0 |
| oracles | 55 / 52 / 55 / 0 / 3 | 55 / 53 / 55 / 0 / 2 | 55 / 55 / 55 / 0 / 0 |
| followups | 2 / 1 / 2 / 0 / 1 | 1 / 0 / 1 / 0 / 1 | 2 / 2 / 2 / 0 / 0 |
| old-gate | 322 / 50 / 318 / 4 / 272 | 322 / 21 / 322 / 0 / 301 | 259 / 150 / 249 / 0 / 99 |
| census | 4,386 / 4,386 / 4,386 / 0 / 0 | 4,386 / 4,386 / 4,386 / 0 / 0 | 4,386 / 4,386 / 4,386 / 0 / 0 |
| rich | 1,617 / 1,490 / 1,501 / 3 / 121 | 1,636 / 1,543 / 1,511 / 2 / 80 | 1,623 / 1,589 / 1,510 / 0 / 29 |
| sample | 11,901 / 11,414 / 11,744 / 1 / 456 | 11,901 / 11,021 / 11,300 / 0 / 400 | 11,896 / 11,413 / 11,715 / 0 / 427 |
| facts | 4,818 / 4,528 / 4,815 / 1 / 288 | 4,848 / 4,710 / 4,848 / 0 / 138 | 4,927 / 4,743 / 4,902 / 0 / 159 |
| catalog | 18,099 / 15,072 / 17,974 / 17 / 2,919 | 18,981 / 16,910 / 18,864 / 41 / 1,995 | 19,378 / 16,836 / 19,359 / 8 / 2,531 |
| books | 72 / 70 / 72 / 0 / 2 | 72 / 72 / 72 / 0 / 0 | 72 / 72 / 72 / 0 / 0 |
| all | 41,615 / 37,402 / 41,210 / 26 / 4,066 | 42,545 / 39,056 / 41,702 / 43 / 2,920 | 42,941 / 39,589 / 42,593 / 8 / 3,245 |

Of the pinned cases with a chip or cloned padding (261, 260 and 261), main gets 232, 231 and 233 right. The census and
the books are the redo's own real-text census and book survey, which main's harness took whole: the redo is right on
every one of them in all three browsers.

The 77 main-only cases were laid out again in the lab with both predictors and their own natives (`harness/recheck`,
`tools/recheck-eval.ts`, `classify-harness.py`), and classed as above, page history there meaning the redo is right when
laid out again:

| browser | main only | page history | narrower than 24 px | main right by luck | true redo loss |
|---|---:|---:|---:|---:|---:|
| chrome | 26 | 0 | 8 | 11 | 7 |
| firefox | 43 | 4 | 10 | 1 | 28 |
| webkit-host | 8 | 0 | 2 | 5 | 1 |

- Chrome's true losses: `catalog/classes/B2` (U+2E3B between Hangul, 69 and 90 px, `script-context`), `classes/JV`
  (Hangul jamo U+118F and U+D7C6 at 30-60 px, `glyph-clusters`, `unsafe-to-break`), `classes/EM` (Hebrew and U+1F3FB at
  29.7 px), and one real-usage draw, `sample/ai/paragraph/zh` (15px PingFang SC at 864 px): Chrome sets `。` half an em
  narrower before an ASCII `}`, 7.5 px, which the redo's HanKerning doesn't (Chrome's own positions against the port's,
  `fits/probe-zh`), so its line is 15 px wider than Chrome's and ends a character early; the redo reports no gap at the
  cause.
- Firefox's true losses: `catalog/classes/EM` (17) and `EB` (2), an emoji modifier or U+261D between letters, where the
  redo's U+1F3FB is 21.0 px and Firefox lays it out at 16.0 px at 16px: main corrects Canvas's emoji width by the
  difference a hidden DOM span shows (`getEmojiCorrection`, one of its documented DOM reads), the redo takes Canvas's and
  reports only `optical-size`; `ideographic-source-edge` (8), `a`
  U+3000 U+200D `b` in Arial and Amiri, where the redo's U+3000 with the joiner is 0.5 px wider (`in-word-prefix`); and
  `classes/CM` (U+0DD8 after two spaces, 24 px).
- webkit-host's: `catalog/rule/joining` in Noto Naskh Arabic at 44.3 px (`rtl-shaping-across-inline-boxes`).
- Main right by luck: Chrome's `ideographic-source-edge` with U+0600 (main 16 px off), `classes/CB`, a facts case,
  `old-gate/space` and `old-gate/mixed`, and rich Myanmar; Firefox's `rule/joining` in Geeza Pro; webkit-host's
  `rule/joining` at 42-54 px (0.4-4 px) and `source-views/long-tail-edge-falsifier`.

## Unsupported cases

`predict` returns `{ error: 'unsupported by main: <reasons>' }`, every reason joined, for a case main's adapter can't
express (`harness/predict.ts` `unsupported`): white-space other than normal or pre-wrap; word-break other than normal or
keep-all; overflow-wrap other than break-word; line-break other than auto; word spacing; a span lang other than the
paragraph's; tab-size other than 8 in pre-wrap text with a TAB; and rich inline (spans among other runs, several styles)
outside white-space normal and word-break normal. A case with inline structure (a tree, atomic inlines, `<br>`, `<wbr>`,
text-indent, text-align or floats) has no place in main's case format and is unsupported too. Reasons over Chrome's tier
cases: overflow-wrap normal 14,839, inline structure 13,606, overflow-wrap anywhere 2,799, rich inline outside normal
2,491, break-all 2,089, word spacing 1,339, break-spaces 1,213, span lang 1,194, line-break loose / strict / normal /
anywhere 1,139 / 760 / 499 / 406, pre-line 739, nowrap 233, pre 207, break-word 138, tab-size 375.

## How the adapter uses main

- `harness/predict.ts`, called as main's harness calls it: a font string per run style (`[italic ][weight ]<size>px
  <family>`, weight 400 left out); `prepareWithSegments(text, font, options)` with `whiteSpace: 'pre-wrap'`,
  `wordBreak: 'keep-all'` and `letterSpacing` as the case asks, then `walkLineRanges`; or `prepareRichInline` with one
  item per run (letter spacing per item) and `walkRichInlineLineRanges`. It also runs `layout()` on `prepare()`'s handle,
  `measureLineStats`, `layoutNextLineRange`, `layoutNextLine`, `layoutWithLines` and `materializeLineRange` (the rich
  ones for a rich case), and keeps the first way one disagrees with the walk on the prediction as `disagreement`.
- The adapter aligns main's segment stream with the source once and returns UTF-16 source ranges, main's widths, and the
  `measureText` calls while preparing as `measureLog`. Main's caches are cleared before every case, so each count is a
  cold prepare. Since #340 main takes break rules and font resolution from `<html lang>` alone and `setLocale()` only
  clears the caches.
- `baselines/book-main-predictor.ts` adds what `layout()` on `prepare()`'s handle counts, the book survey's public height.
- `paint` returns null.

## Caveats

- Width semantics. Main's width is a float sum of Canvas advances and isn't compared here; the 2026-09-16 baseline found
  Chrome's line extents one LayoutUnit wider on many lines.
- Main's recordings were made by main's harness in its own documents; the lab's recheck laid the 77 cases out again, and
  in Firefox four of them are laid out as the redo predicts.
- Not measured: the words-first real-text attack's 59 sets (751,327 Chrome layouts), whose case files and natives
  weren't kept; the book survey's own workflow (the harness's `books.ndjson` holds its 72 paragraphs); Safari installed.

## Reproducing

```sh
bun rebuild/tests/browser-sets.ts --browser=<browser> --out=<dir>/main-<browser> \
  --predictor=rebuild/lab/baselines/main-predictor.ts
bun .artifacts/tests/runs/rule2-20260925/tools/join-tier.ts <browser> no-facts <dir>/main-<browser> \
  .artifacts/tests/reference/<browser>-no-facts [<the redo's run with its own natives>] > join.json
```

The harness runs: `.artifacts/tests/runs/rule2-20260925/harness/run-redo-harness.sh <browser>` in a checkout with
`harness-run-local.patch` applied, then `tools/harness-join.ts <browser> harness/redo-<browser>`.
