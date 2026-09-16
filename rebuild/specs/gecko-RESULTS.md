# Gecko port results (Firefox 156.0)

The Gecko engine in `rebuild/src/engines/gecko/` against installed Firefox 156.0 in the lab
(`rebuild/lab/run.ts --browser=firefox`, Retina DPR 2, 30 app units per device pixel). Rows, summaries and per-case
scores are under `.artifacts/lab/gecko/<set>-r<n>/`; every run held the shared browser lock. From round 9 the runs use
`.artifacts/lab/gecko/gaps-predictor.ts`, the lab predictor plus each paragraph's gaps and engine widths. Scores come
from `rebuild/lab/score.ts` sha256 `e0a7b4be…` (10:10). Round 8 rescored with the same scorer is in
`.artifacts/lab/gecko/audit/<set>-r8-now/` (specs/gecko-AUDIT.md §2).

## Port

- `prepare.ts`: frames (a white-space-only 8-bit bare text node at the block's first or last child gets none under
  `normal` or `nowrap`); bidi with unicode-bidi 0.3.15 over `ReplaceSeparators` text, per preserved line in
  newline-significant modes, frames split at level-run ends; text runs by `ContinueTextRunAcrossFrames`; `TransformText`
  per mapped flow with the carried white-space bit; glyph flags (`SplitAndInitTextRun`, `SetupClusterBoundaries` with
  ICU4X graphemes, the script itemizer, emergency flags after hyphens, the text-run-start cluster guard); `nsLineBreaker`
  over every flow with ICU4X per word; letter and word spacing in au; shaping units measured whole, one OffscreenCanvas
  context per text run; tab width, minimum tab advance, hyphen run.
  - `rangeAu` is the one recipe for measuring a piece of a unit: the piece in the script the itemizer gives it in the
    paragraph, `context + ' ' + piece` less `context + ' '` where it itemizes differently alone. Units, suffixes and the
    in-word check's prefixes all use it.
  - Apple Color Emoji's device-size advance (`floor(apd × Core Text advance at the device size + 0.5)`) applies to a
    cluster only where Canvas shows Apple Color Emoji draws it: the cluster measures the same in the run's font list as
    in `"Apple Color Emoji"` alone, at the CSS size and at the device size (probe F3 below). Candidates are clusters
    whose first character has an emoji presentation other than TextOnly (`GetEmojiPresentation`).
  - Unicode spaces no listed font covers (U+2000-U+2006, U+2009, U+200A, U+202F, U+3000) take Gecko's synthesized width,
    `apd × floor(device size / divisor + 0.5)` (gfxTextRun.cpp:3032-3043, gfxFont.cpp:4792-4826), where Canvas measures
    the synthesized value at both sizes.
- `lines.ts`: `ReflowInlineFrames` with one redo at the saved optional break, `ReflowText`, `BreakAndMeasureText` with
  the line-wide break priority, `CanPlaceFrame` backup, tab stops, soft hyphens, trailing break at the text run end,
  `TrimTrailingWhiteSpace`, fragments.
  - In-word advances: `W(unit) − W(suffix)`, with U+200D before the suffix where the letters on both sides join. Inside a
    grapheme cluster (a soft hyphen before a mark or inside an emoji sequence) the advance before the offset is the
    advance before the cluster's end, as HarfBuzz clumps and `ComputeLigatureData` give it.
  - `engineWidth` is Gecko's line box in au. `width` is the extent the lab observes, computed from Gecko's geometry:
    Range rects cover clusters, a piece whose advance isn't positive has no rect, white space a frame removed at the
    line end spans to the frame's edge, and the lab's visibility categories (lab/README.md "Visible code points") decide
    what counts.
- `linebreak.ts`: `nsLineBreaker` (16-bit and 8-bit `AppendText`, `FlushCurrentWord`, the sticky Chinese/Japanese flag,
  word-break and line-break transitions, `NoBreaks`, `SetPotentialLineBreaks`) and ICU4X 2.1.2's `LineBreakIterator`
  with strict, normal, loose and anywhere, break-all and keep-all, SA through `Intl.Segmenter` words.
- `props.ts` over `generated/props.ts` from ICU 78.2 `ppucd.txt` (`tools/gen-gecko-data.ts`), block values included.
- Tests:
  - `gecko.test.ts`, 30 tests with a stand-in OffscreenCanvas (576 au per code point at 16px, plus a kern pair,
    script-dependent parentheses, Apple Color Emoji advances with a pinned state and a synthesized U+2009): the Firefox
    probe verdicts H1, H2, H4, H5, H8-H11, H12b, H13-H16, H22-H24 and W3, gecko-text H1/H2/H7/H19/H26, the groundwork
    oracle's break cases, spec §9.5 oracle outputs, §6.3 transform examples, tab-size 0 and negative tab widths, source
    tiling, and one test per audit finding (in-word gap discrimination, suffix script context, emoji font
    identification, soft hyphens inside clusters, negative trimmed white space, controls with letter spacing).
  - `props.test.ts`: General_Category, East_Asian_Width, Emoji, Default_Ignorable_Code_Point, Bidi_Mirrored, Script,
    Script_Extensions and the opening-punctuation mirror equal icu_properties 2.1.2 (the groundwork's `props-dump`) for
    every code point. Emoji_Presentation, Emoji_Modifier and Joining_Type aren't in that dump.
- `rebuild/probes/gecko-followups.ts` (F1, F2) and `rebuild/probes/gecko-emoji-font.ts` (F3), below.

## Scores, round 11

| Case set | Rows | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke | 297 | 297 / 0 / 0 | 292 / 0 / 5 | 272 / 4 / 16 | 281 / 12 / 4 |
| runs | 2,580 | 2,576 / 0 / 4 | 2,573 / 3 / 4 | 2,481 / 35 / 57 | 2,445 / 63 / 72 |
| ws | 1,019 | 1,018 / 1 / 0 | 1,017 / 2 / 0 | 966 / 11 / 40 | 973 / 15 / 31 |
| policy | 1,606 | 1,605 / 1 / 0 | 1,605 / 1 / 0 | 1,594 / 11 / 0 | 1,585 / 21 / 0 |
| suite sample | 19,888 | 19,860 / 25 / 3 | 19,091 / 29 / 768 | 15,253 / 456 / 3,382 | 18,531 / 1,196 / 161 |
| suite sample, reverse order, 130 history-dependent rows excluded | 19,758 | 19,730 / 25 / 3 | 18,962 / 29 / 767 | 15,125 / 455 / 3,382 | 18,402 / 1,195 / 161 |

Cells are pass / fail / unobserved; widths also have not-applicable rows where breaks failed or weren't observed.

Round 8 with the same scorer: smoke 296/1/0, 292/0/5, 272/4/16, 281/12/4; runs 2,576/0/4, 2,573/3/4, 2,471/45/57,
2,438/71/71; ws and policy as above; suite 19,726/159/3, 18,978/142/768, 15,106/496/3,376, 18,368/1,359/161. Per case
and metric, round 11 against round 8: smoke 1 better, runs 17, suite 558, ws and policy unchanged, and 1 worse
(`c-bf532a3f37ed556f` painter: the width now passes, and painted alone at a line start `((` loses the Hebrew run's
script, painter L7).

## Page-history dependence

The suite sample ran in file order and in reverse (`suite-sample-r11-reverse`, scored with `--native-compare`). 130 cases
lay out differently natively between the two orders, almost all U+1F600 in 16px Arial after or before
`suite/measurement`'s `😀😀︎` (numeric-ideograph-direction 16, non-ascii-control 12, pair 10, space-context-emoji 7,
policy/* about 60). The predictions have no failure in either order for 127 of them. Round 8 failed 118 of them in file
order. The three left: `c-29638bb1a4343fad` widths in file order (Canvas pinned while this row's DOM still drew Apple
Color Emoji; `font-fallback` reported), `c-bd4a89130a560c90` widths in reverse, `c-dc00fd4247ac24b5` painter in file
order.

## measureText calls per paragraph, round 11

| Case set | mean | median | p90 | max | calls per 100 source characters |
|---|---|---|---|---|---|
| smoke | 39.0 | 29 | 75 | 595 | 102.6 |
| runs | 47.6 | 40 | 86 | 265 | 86.4 |
| ws | 27.8 | 22 | 66 | 148 | 87.1 |
| policy | 41.6 | 35 | 81 | 183 | 112.9 |
| suite sample | 30.1 | 15 | 73 | 15,981 | 71.9 |

Round 8: smoke 23.7 / 17 / 45 / 300 / 62.2, runs 31.4 / 27 / 56 / 176 / 57.1, ws 17.8 / 16 / 35 / 111 / 55.6, policy
23.1 / 19 / 45 / 96 / 62.6, suite 19.4 / 9 / 44 / 7,987 / 46.3.

Calls: one per distinct word, space and NBSP per context; one whole-stretch check per run of units between invalid
characters (`space-in-shaping`); suffixes at in-word offsets the line loop reaches, and until the paragraph has reported
`in-word-prefix` also the prefixes that check needs (the 15,981-call paragraph is a long unbroken word under
`overflow-wrap`); per emoji-property cluster at DPR ≠ 1 the run's context and `"Apple Color Emoji"` at the CSS size, and
both at the device size where they agree; synthesized-space candidates at both sizes; script contexts; `'0'` for tab
runs; U+2010 for soft-hyphen runs.

## Gaps the engine reports

- `in-word-prefix`, from the line loop: the first in-word offset the layout consults where Canvas can't confirm the
  recipe. That is where the prefix and suffix shaped alone don't add up to the unit, where letters join across the
  offset, or, inside a grapheme cluster, where the rest of the cluster has an advance of its own. The detail names the
  offset and the values.
- `font-fallback`: a cluster that asks for a color glyph (`FindFontForChar`: emoji-default without VS15, VS16, a skin tone
  modifier, a black flag with tags) that Canvas draws with another font than Apple Color Emoji, the pinned state of
  probes F2 and F3.
- `bitmap-emoji-size`: an Apple Color Emoji cluster whose device-size advance doesn't give an exact au at the page's
  apd, or whose device size isn't on Canvas's 7-bit size grid.
- `font-size-quantization`: `QuantizeFontSize(s) × 60` isn't the DOM's `NSToIntRound(q10(s) × 60)`.
- `optical-size`: `system-ui`, `-apple-system`, `ui-*`, SF and New York families.
- `space-in-shaping`: a stretch of units between invalid characters measures differently whole than unit by unit.
- `dictionary-breaks-unavailable`, `ui-language` (`lang=""`).

Census from the round 11 rows (cases reporting the gap; all-pass cases reporting it; failing cases with no gap):

| Set | `in-word-prefix` | all-pass with `in-word-prefix` | `font-fallback` | failing with no gap |
|---|---|---|---|---|
| smoke | 46 (round 8: 264) | 32 of 266 (233) | 0 | 1 of 12 |
| runs | 604 (2,421) | 550 of 2,436 (2,267) | 0 | 9 of 63 |
| ws | 91 (663) | 72 of 966 (612) | 0 | 0 of 15 |
| policy | 106 (1,493) | 91 of 1,584 (1,471) | 0 | 7 of 22 |
| suite sample | 5,260 (18,610) | 2,715 of 15,124 (13,768) | 122 | 69 of 1,197 |

The failures with no gap:
- Painter losses: 66 of the 69 suite cases, 8 of 9 runs, 6 of 7 policy and the ws set's none.
- The 1 au per-glyph rounding of specs/gecko-canvas.md §3 N7: the other 3 suite cases, `c-13c64a6ce641374d`,
  `c-8f9cd18c645671da` and `c-fcbb3bc755b5a5e8` (Helvetica Neue with Arabic, 1 au on one line), and runs and smoke
  `c-268ee59b15a407a8`.
- A ligature whose width equals its parts, which Canvas totals can't show (`c-daf9c7047097f77b`, Helvetica Neue `fi`:
  natively 217 + 218 au by cluster share, predicted 249 + 186).

## Failure classes, round 11

Attribution: **named gap** (reported in `gaps`), **observation** (in `rebuild/lab/ISSUES.md`), **painter** (a loss of
specs/painter.md §7), **model limit** (a DOM fact Canvas totals can't give and no gap name covers yet).

| Class | Attribution | Counts | Example |
|---|---|---|---|
| Joining and contextual forms at a break inside a word: Amiri and Noto Naskh `ب­ب` around invisible characters (native final beh 741 au, the U+200D suffix gives 848), lam-alef, Mongolian | named gap `in-word-prefix` | suite 25 lineCount, 29 breaks (original-vs-reshaped-admission 11 and 11, U+200B/U+200C/U+200D/U+2028/U+2060/U+FEFF start 11 and 11), about 309 widths, about 600 painter; policy 1 lineCount, 1 breaks | `c-264def40e7ee263a`, `c-15392ecfc5a69b77` |
| Kerning on the right glyph, or split as HarfBuzz splits legacy `kern`, at an in-word break: Verdana, Helvetica Neue, Times New Roman | named gap `in-word-prefix` | suite maintained/accuracy 17 widths; ws trailing-space-edge 6 and text-nodes 3 widths, 1 lineCount, 2 breaks; policy url-number 4, overflow-wrap 2 widths | `c-101ea8815873259c` (W(prefix) + W(suffix) 7 au over the unit), `c-63ccab1fe0df0cea` |
| Other in-word breaks the check flags (Geeza Pro under break-all, emoji clusters, mixed fonts and bidi runs), not traced one by one this round | named gap `in-word-prefix` | runs 19 widths, 3 breaks; policy word-break and emoji 2 widths each, 1 lineCount, 1 breaks | `c-5ba3b0da55cb63ad` |
| A ligated emoji sequence split by a soft hyphen: the paragraph gives the whole cluster to line n and 0 au to the rest; painted alone, the rest draws as its own emoji and the line wraps | painter | suite skin-modifier/shy, woman-before-zwj/shy, woman-after-zwj/shy 84 painter each | `c-27e5b02212b7324f` |
| Device-size emoji rounding and synthetic bold after rounding | named gap `bitmap-emoji-size` | runs 15 widths, 15 painter | `c-12c0b70f8e3d11dc` |
| Emoji measured while Canvas and this row's DOM disagree about the pinned fallback font | named gap `font-fallback` | suite 1 widths | `c-29638bb1a4343fad` |
| 1 au per glyph: the DOM rounds each hmtx advance at the device size, Canvas at apd 60 (specs/gecko-canvas.md §3 N7) | model limit | runs and smoke 1, suite 3 widths | `c-268ee59b15a407a8`, `c-13c64a6ce641374d` |
| A ligature whose width equals its parts at an in-word break | model limit | policy 1 widths | `c-daf9c7047097f77b` |
| A mid-word painted slice loses kerning or contextual forms with the next line's first glyph (the painter failures of lines that end inside a word, outside the classes above) | painter L1, L2 | smoke 11, runs 39, policy 15, suite 155 painter | `c-a62a1173a43c5cf2` |
| Painter losses with no gap reported: Common characters at a line start lose the surrounding script run (Hangul shapes without kern; `((` after Hebrew or Arabic takes 367 au instead of 660), marks, ZWSP or tabs with letter spacing painted alone at a line edge | painter L7 and zero-width clusters at edges | policy korean 5 and word-break 1; runs 5; suite 66 | `c-27d5d232618787d5`, `c-bf532a3f37ed556f`, `c-a1cc790386f04a1a`, `c-3796c11b7b50fd7d` |
| Bidi lines painted with override spans | painter L9 | runs 3 painter | `c-01cfe05b2ffd874b` |

## Probes run for attribution

- F1, refuted: in a fresh document an OffscreenCanvas measures U+1F600 at 32px Arial, 33px Arial and 47px Georgia
  correctly on the first call (`.artifacts/probes/gecko/followups/firefox-probes.json`). Asynchronous system font
  fallback isn't the cause.
- F2, confirmed: after one OffscreenCanvas measures U+1F600 U+FE0E (17px), U+1F600 alone measures 17px at 32px and 28px
  Arial and 28px Georgia in new contexts (`.artifacts/probes/gecko/followups-f2/firefox-probes.json`).
- F3, confirmed (`rebuild/probes/gecko-emoji-font.ts`, `.artifacts/probes/gecko/emoji-font/firefox-probes.json`): a
  cluster Apple Color Emoji draws measures the same in the run's font list as in `"Apple Color Emoji"` alone.
  - Fresh, 16px Arial: U+1F600, U+2764 U+FE0F, `#️⃣`, a flag, a skin tone sequence and U+1F469 U+200D U+1F680 are
    1260 au at 16px and 1920 au at 32px in both fonts; the DOM gives 960 au.
  - U+1F600 U+FE0E, U+2764 alone, `#⃣` and `1` differ from Apple Color Emoji, and the DOM equals Canvas at the CSS size
    (1020, 874, 534, 534 au).
  - After `😀😀︎`: Arial gives U+1F600 1020 au at 16px and at 32px, Apple Color Emoji still 1260 and 1920 au, the DOM
    1020 au. The explicit Apple Color Emoji context isn't pinned.

## Changes by run

- r1 (smoke only): lineCount 295 / 2, breaks 291 / 1, widths 258 / 19, painter 260 / 33.
- r2: significant newlines are content for the first line and the absorbed tail (`\r\n\r\n\r\n` under pre-line had no
  lines); widths became the visible extent; the Gecko hyphen span gets `white-space: nowrap` in `paint.ts`
  (SHARED-CHANGES.md: overflow-wrap offered a break before the separate hyphen frame); script context for Common unit
  starts (Hangul `7:00-9:00` shaped without kern, `c-8eabfbd5a87acdfa`, +72 au).
- r3: `engineWidth` is the line box, `width` the visible extent in visual frame order (an RTL frame's trailing space
  sits mid-line, `c-01cfe05b2ffd874b`); white space a frame or `TrimTrailingWhiteSpace` removed has no advance; zero-width
  controls don't count; emoji DOM advance `floor(au60 × apd / 60 + 0.5)` (a lone regional indicator isn't a whole pixel);
  `tab-size: 0` gives tabs no width. First runs of runs, ws, policy and the suite sample.
- r4: whole-node extent when no non-visible white space has width (`score.ts` `lineExtent`); negative tab width
  (letter spacing below minus the space width) gives no tab stops; `font-fallback` gap for emoji.
- r5: a line holding only a used soft hyphen observes the hyphen.
- r6: a space or invalid character with a non-positive advance has no rect (negative word spacing,
  `c-3b2e9519e5b651d4`); `bitmap-emoji-size` for ambiguous device-size advances.
- r7: `W(prefix + U+200D)` at in-word breaks between joining letters. Suite: 326 metric results better, 16 worse (all
  in `original-vs-reshaped-admission`, Amiri contextual forms); runs 10 better, policy 4, smoke 1, none worse.
- r8: U+200D goes before the suffix instead (`W(unit) − W(U+200D + suffix)`), which keeps the default recipe's
  attribution of context effects to the prefix: suite 20 better, 7 worse; runs 1 better; policy 1 worse
  (`c-5ba3b0da55cb63ad`, Arabic under break-all).
- r9 (specs/gecko-AUDIT.md B1-B4): Apple Color Emoji identified from Canvas; the advance before an offset inside a
  cluster is the cluster's end; suffixes through `rangeAu`; `in-word-prefix` from the line loop; width from cluster
  geometry. Suite: 558 metric results better than round 8, 236 worse. The worse ones were the geometry pass: a piece
  crossed from an invalid character into a word that starts with a mark (skin-modifier/zwsp 96 widths and painter,
  policy/thai 2), and spaces with negative advances got rects (runs word-spacing-spans 6 widths).
- r10: pieces stop at unit edges, and only positive advances make rects. Against round 8: suite 558 better, 1 worse;
  runs 8 better; none worse elsewhere.
- r11: synthesized Unicode spaces (runs word-spacing-spans 6 widths pass, `c-55485f415fd9dfed`: 18px U+2009 is 240 au in
  Canvas, 210 au in the DOM); props from ppucd block lines (CJK Ext A-J and private use had General_Category Cn,
  found by `props.test.ts`; no lab case changed); the empty-line join cites `nsLineLayout::VerticalAlignLine`.
