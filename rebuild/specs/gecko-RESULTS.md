# Gecko port results (Firefox 156.0)

The Gecko engine in `rebuild/src/engines/gecko/` against installed Firefox 156.0 in the lab
(`rebuild/lab/run.ts --browser=firefox`, Retina DPR 2, 30 app units per device pixel). Rows, summaries and per-case
scores are under `.artifacts/lab/gecko/<set>-r<n>/`; every run held the shared browser lock. Scores come from
`rebuild/lab/score.ts` as of 09:41 (the lab owner's change that day moved about 530 suite width results from fail to pass
or unobserved; round 4 rows rescored with it are in `<set>-r4/per-case-rescored.ndjson`).

## Port

- `prepare.ts`: frames (a white-space-only 8-bit bare text node at the block's first or last child gets none under
  `normal` or `nowrap`); bidi with unicode-bidi 0.3.15 over `ReplaceSeparators` text, per preserved line in
  newline-significant modes, frames split at level-run ends; text runs by `ContinueTextRunAcrossFrames`; `TransformText`
  per mapped flow with the carried white-space bit; glyph flags (`SplitAndInitTextRun`, `SetupClusterBoundaries` with
  ICU4X graphemes, the script itemizer, emergency flags after hyphens, the text-run-start cluster guard); `nsLineBreaker`
  over every flow with ICU4X per word; letter and word spacing in au; shaping units measured whole, one OffscreenCanvas
  context per text run; Apple Color Emoji clusters measured at the device size; script context for units whose leading
  Common characters the DOM itemizer merges into another script's run; tab width, minimum tab advance, hyphen run.
- `lines.ts`: `ReflowInlineFrames` with one redo at the saved optional break, `ReflowText`, `BreakAndMeasureText` with
  the line-wide break priority, `CanPlaceFrame` backup, tab stops, soft hyphens, trailing break at the text run end,
  `TrimTrailingWhiteSpace`, fragments. In-word advances: `W(unit) − W(suffix)`, with U+200D before the suffix where the
  letters on both sides join. `engineWidth` is Gecko's line box in au; `width` is the extent the lab observes: the line box when
  no non-visible white space has width, else the visible code points in UAX #9 L2 frame order.
- `linebreak.ts`: `nsLineBreaker` (16-bit and 8-bit `AppendText`, `FlushCurrentWord`, the sticky Chinese/Japanese flag,
  word-break and line-break transitions, `NoBreaks`, `SetPotentialLineBreaks`) and ICU4X 2.1.2's `LineBreakIterator`
  with strict, normal, loose and anywhere, break-all and keep-all, SA through `Intl.Segmenter` words.
- `props.ts` over `generated/props.ts` from ICU 78.2 `ppucd.txt` (`tools/gen-gecko-data.ts`).
- `gecko.test.ts`: 24 tests with a stand-in OffscreenCanvas (16px Courier New, 576 au per character): the Firefox probe
  verdicts H1-H24 and W3, gecko-text H1/H2/H7/H19/H26, the groundwork oracle's break cases, spec §9.5 oracle outputs,
  §6.3 transform examples, tab-size 0 and negative tab widths, and source tiling.
- `rebuild/probes/gecko-followups.ts`: F1 (refuted) and F2 (confirmed), below.

## Scores, round 8

| Case set | Rows | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke | 297 | 296 / 1 / 0 | 292 / 0 / 5 | 272 / 4 / 16 | 281 / 12 / 4 |
| runs | 2,580 | 2,576 / 0 / 4 | 2,568 / 8 / 4 | 2,466 / 45 / 57 | 2,438 / 71 / 71 |
| ws | 1,019 | 1,018 / 1 / 0 | 1,017 / 2 / 0 | 966 / 11 / 40 | 973 / 15 / 31 |
| policy | 1,606 | 1,605 / 1 / 0 | 1,605 / 1 / 0 | 1,594 / 11 / 0 | 1,585 / 21 / 0 |
| suite sample | 19,888 | 19,726 / 159 / 3 | 18,978 / 142 / 768 | 15,108 / 494 / 3,376 | 18,370 / 1,357 / 161 |

Cells are pass / fail / unobserved; widths also have not-applicable rows where breaks failed or weren't observed.

## measureText calls per paragraph (round 6 rows)

| Case set | mean | median | p90 | max | calls per 100 source characters |
|---|---|---|---|---|---|
| smoke | 23.6 | 17 | 45 | 300 | 63.2 |
| runs | 31.4 | 27 | 56 | 176 | 57.6 |
| ws | 17.8 | 16 | 35 | 111 | 55.6 |
| policy | 23.1 | 19 | 45 | 96 | 64.4 |
| suite sample | 19.3 | 9 | 44 | 7,987 | 46.6 |

Calls: one per distinct word, space and NBSP per context; one whole-stretch check per run of units between invalid
characters (`space-in-shaping`); suffixes or ZWJ prefixes at in-word candidates the line loop reaches (the 7,987-call
paragraph is a long unbroken word under `overflow-wrap`, measured once per cluster); emoji clusters at the device size;
script contexts; `'0'` for tab runs; U+2010 for soft-hyphen runs.

## Failure classes, round 8

Attribution: **named gap** (reported in `gaps`), **observation** (in `rebuild/lab/ISSUES.md`), **painter** (a loss of
specs/painter.md §7), **model limit** (a DOM fact Canvas totals can't give and no gap name covers yet).

| Class | Attribution | Counts | Example |
|---|---|---|---|
| Joining and contextual forms at a break inside a word: Amiri and Noto Naskh `ب­ب` around invisible characters, Amiri parentheses after Arabic, lam-alef, Mongolian | named gap `in-word-prefix` | suite: 42 lineCount, 57 breaks, 426 widths, 766 painter (Amiri `ب­ب` +55 au: its final beh after a beh isn't its final beh after U+200D); runs ~5 widths, 3 breaks; policy 3 widths, 1 lineCount, 1 breaks | `c-0899d73ee0825de0`, `c-09a7775ba6eea10d` |
| Emoji measured after a Canvas measurement of a text-presentation sequence: every later OffscreenCanvas measurement of U+1F600 in the document returns the text glyph (17px at 32px Arial, probe F2) | named gap `font-fallback` | suite: 117 lineCount, 82 breaks, 40 widths, 412 painter | `c-0e9eee22e9d69e02` |
| Kerning on the right glyph, or split as HarfBuzz splits legacy `kern` (kern >> 1 on the left), at an in-word break: Verdana, Helvetica Neue, Times New Roman bold | named gap `in-word-prefix` | ws 6+2 widths, 1 lineCount, 1 breaks; policy ~6 widths; runs ~10 widths; suite 26 widths, 3 breaks | `c-1c7520b02b5b5942` (`hy`, −8 au), `c-63ccab1fe0df0cea` |
| Partial ligature shares: a soft hyphen inside a ZWJ sequence, `ffi` split by an emergency break | named gap `in-word-prefix` | smoke 1 lineCount, 1 widths | `c-40ecb4f7950b571e` |
| Device-size emoji rounding: Canvas's advance at the device size is an odd au at apd 60, so the DOM's au at apd 30 is ambiguous, and synthetic bold is added after rounding | named gap `bitmap-emoji-size` | runs ~20 widths (±1-2 au per line) | `c-12c0b70f8e3d11dc` |
| 1 au per glyph: the DOM rounds each hmtx advance at the device size, Canvas at apd 60 (specs/gecko-canvas.md §3 N7) | model limit | runs 7 widths (Geeza Pro 10px) | `c-268ee59b15a407a8` |
| An emoji + VS16, or a letter + U+200C/U+200D: Firefox gives the joiner or selector the cluster's advance and the scorer drops it as invisible | observation, fixed by the lab owner's 09:41 scorer except 2 suite rows | suite 2 widths | `c-7c1bb30f6445a88a` |
| Firefox starts a line inside what the lab's segmenter calls one grapheme (a conjunct across spans, a mark in its own span) | observation | runs 5 breaks | `c-a560dabf8d17cd2c` |
| A trailing space with negative spacing keeps a positive rect on one line and not on another | open (3 runs cases) | runs 3 widths | `c-79e5272a2644d9b8` |
| A mid-word painted slice loses kerning with the next line's first glyph | painter L1 | runs ~25, policy ~11, suite 65, smoke 5 painter | `c-a62a1173a43c5cf2` |
| Digits and punctuation painted at a line start lose the surrounding script run (Hangul shapes without kern) | painter L7 | policy 5, runs ~10 painter | `c-27d5d232618787d5` |
| Combining marks isolated by soft hyphens painted alone | painter | suite 112 painter | `c-a1cc790386f04a1a` |

## Gaps the engine reports

- `in-word-prefix`: break candidates inside shaping units exist (normal and emergency flags, cluster starts under
  `overflow-wrap`, soft hyphens), with the count.
- `font-fallback`: an emoji-presentation character in a unit whose family isn't Apple Color Emoji.
- `bitmap-emoji-size`: an emoji cluster's device-size advance doesn't give an exact au at the page's apd, or the device
  size isn't on Canvas's 7-bit size grid.
- `font-size-quantization`: `QuantizeFontSize(s) × 60` isn't the DOM's `NSToIntRound(q10(s) × 60)`.
- `optical-size`: `system-ui`, `-apple-system`, `ui-*`, SF and New York families.
- `space-in-shaping`: a stretch of units between invalid characters measures differently whole than unit by unit.
- `dictionary-breaks-unavailable`, `ui-language` (`lang=""`).

## Probes run for attribution

- F1, refuted: in a fresh document an OffscreenCanvas measures U+1F600 at 32px Arial, 33px Arial and 47px Georgia
  correctly on the first call (`.artifacts/probes/gecko/followups/firefox-probes.json`). Asynchronous system font
  fallback isn't the cause.
- F2, confirmed: after one OffscreenCanvas measures U+1F600 U+FE0E (17px), U+1F600 alone measures 17px at 32px and 28px
  Arial and 28px Georgia in new contexts (`.artifacts/probes/gecko/followups-f2/firefox-probes.json`).

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
