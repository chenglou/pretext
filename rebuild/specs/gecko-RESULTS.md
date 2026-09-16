# Gecko port results (Firefox 156.0)

The Gecko engine in `rebuild/src/engines/gecko/` measured against installed Firefox 156.0 with the lab
(`rebuild/lab/run.ts --browser=firefox`, DPR 2, apd 30). Rows and summaries are under
`.artifacts/lab/gecko/<run>/`. Each run holds the shared browser lock; scores come from `rebuild/lab/score.ts`.

## Port

- `prepare.ts`: frames (white-space-only bare text nodes at the block edges get none), bidi splits with unicode-bidi
  over `ReplaceSeparators` text, per preserved line in newline-significant modes; text runs
  (`ContinueTextRunAcrossFrames`); `TransformText` per mapped flow with the carried white-space bit; glyph flags
  (`SplitAndInitTextRun`, `SetupClusterBoundaries` with ICU4X graphemes, the script itemizer, emergency flags after
  hyphens); `nsLineBreaker` over every flow with ICU4X per word (strict, normal, loose, anywhere; break-all, keep-all;
  SA through `Intl.Segmenter` words); letter and word spacing in au; shaping units measured whole in one OffscreenCanvas
  context per text run; Apple Color Emoji clusters re-measured at the device size; script context for Common-only unit
  starts; the tab width and minimum tab advance; the hyphen run.
- `lines.ts`: `ReflowInlineFrames` with one redo at the saved optional break, `ReflowText`, `BreakAndMeasureText` with
  the line-wide break priority, `CanPlaceFrame` backup, tab stops, soft hyphens, trailing break at the text run end,
  `TrimTrailingWhiteSpace`, fragments, and two widths: `engineWidth` is Gecko's line box width in au; `width` is the
  extent the lab observes over visible code points, frames in UAX #9 L2 order.
- `linebreak.ts`: `nsLineBreaker` (16-bit and 8-bit `AppendText`, `FlushCurrentWord`, the sticky Chinese/Japanese flag,
  word-break and line-break transitions, `SetPotentialLineBreaks`) and ICU4X 2.1.2's `LineBreakIterator`.
- `props.ts` over `generated/props.ts` from ICU 78.2 `ppucd.txt` (`tools/gen-gecko-data.ts`).
- Tests: `gecko.test.ts`, 22 tests with a stand-in OffscreenCanvas (16px Courier New, 576 au per character): the
  Firefox probe verdicts H1-H24, W3, gecko-text H1/H2/H7/H19/H26, the groundwork oracle's break cases, spec §9.5 oracle
  outputs, §6.3 transform examples, and source tiling.

## Scores, latest runs

| Case set | Run | Rows | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|---|
| smoke | smoke-r3 | 297 | 296 / 1 / 0 | 292 / 0 / 5 | 266 / 12 / 14 | 274 / 19 / 4 |
| runs | runs-r3 | 2,580 | 2,576 / 0 / 4 | 2,568 / 8 / 4 | 2,432 / 80 / 56 | 2,415 / 95 / 70 |
| ws | ws-r3 | 1,019 | 1,018 / 1 / 0 | 1,017 / 2 / 0 | 966 / 11 / 40 | 973 / 15 / 31 |
| policy | policy-r1 code, r3 run | 1,606 | 1,606 / 0 / 0 | 1,605 / 1 / 0 | 1,573 / 32 / 0 | 1,564 / 42 / 0 |
| suite sample | suite-r1 | 19,888 | 19,686 / 199 / 3 | 18,935 / 185 / 768 | 14,545 / 1,816 / 2,574 | 17,428 / 2,299 / 161 |

Cells are pass / fail / unobserved; widths also have not-applicable rows (breaks failed or unobserved).

## measureText calls per paragraph (runs r3)

| Case set | mean | median | p90 | max | calls per 100 source characters |
|---|---|---|---|---|---|
| smoke | 23.6 | 17 | 45 | 300 | 63.2 |
| runs | 31.4 | 27 | 56 | 176 | 57.6 |
| ws | 17.8 | 16 | 35 | 111 | 55.6 |
| policy | 23.1 | 19 | 45 | 96 | 64.4 |

Calls come from unit totals (one per distinct word, space and NBSP per context), a whole-stretch check per run of units
between invalid characters (`space-in-shaping`), suffixes at in-word candidates the line loop reaches, emoji clusters
at the device size, script contexts, `'0'` for tab runs and U+2010 for soft-hyphen runs.

## Failure classes

Attribution: **model bug** (a rule not ported or ported wrong), **named gap** (reported in `gaps`), **observation**
(written to `rebuild/lab/ISSUES.md`), **painter** (a loss specs/painter.md §7 lists).

| Class | Attribution | Counts (latest runs) | Example |
|---|---|---|---|
| An emoji + VS16 cluster puts its advance on the VS16 rect, which the scorer treats as invisible | observation | smoke 6 widths; runs ~60 widths; policy ~30 widths; suite heart-vs16/* and before-heart ~430 widths | `c-9b13e18e12ef188a` |
| Kerning attributed to the right glyph, or split as HarfBuzz splits legacy `kern`, at a break inside a word: `W(unit) − W(suffix)` gives the left glyph the whole pair (Verdana, Helvetica Neue, Times New Roman bold) | named gap `in-word-prefix` | ws 6, policy ~14, runs ~15 widths | `c-1c7520b02b5b5942` (`hy`, −8 au) |
| Arabic joining and lam-alef forms across a break inside a word: the suffix measured alone takes isolated or initial forms | named gap `in-word-prefix` | smoke 4, suite Amiri U+200x/U+2060/U+FEFF families ~450 widths | `c-672e97f1328e77cb` |
| Partial ligature shares: a soft hyphen inside a ZWJ sequence, `ffi` split by an emergency break | named gap `in-word-prefix` | smoke 2 | `c-40ecb4f7950b571e` |
| 1 au per glyph at apd 30: the DOM rounds each hmtx advance at the device size, Canvas at apd 60 (specs/gecko-canvas.md §3 N7) | model limit, no gap name yet | runs 7 widths (Geeza Pro 10px) | `c-268ee59b15a407a8` |
| Firefox starts a line inside what the lab's grapheme segmenter calls one grapheme (conjuncts across spans, a mark in its own span) | observation | runs 5 breaks | `c-a560dabf8d17cd2c` |
| Painted slice at a mid-word edge loses the kerning with the next line's first glyph | painter L1 | smoke 5, runs ~30 painter | `c-a62a1173a43c5cf2` |
| Digits and punctuation painted at a line start lose the surrounding script (Hangul runs shape without kern) | painter L7 | policy/korean 5, runs ~10 painter | `c-cece41d58b28eb3f` |

## Gaps the engine reports

- `in-word-prefix`: any break candidate inside a shaping unit (normal flags, emergency flags, cluster starts under
  `overflow-wrap`, soft hyphens), with the count.
- `font-size-quantization`: when `QuantizeFontSize(s) × 60` isn't the DOM's `NSToIntRound(q10(s) × 60)`.
- `optical-size`: `system-ui`, `-apple-system`, `ui-*` and SF or New York families.
- `space-in-shaping`: a stretch of units between invalid characters measures differently whole than unit by unit.
- `bitmap-emoji-size`: an emoji cluster at a device size Canvas's 7-bit size grid can't express.
- `dictionary-breaks-unavailable`, `ui-language` (`lang=""`).

## Changes by run

- smoke-r1 (first run): lineCount 295 / 2, breaks 291 / 1, widths 258 / 19, painter 260 / 33.
- smoke-r2: significant newlines count as content for the first line and the absorbed tail (`\r\n\r\n\r\n` under
  pre-line gave no lines); widths now the visible extent (a line holding only a ZWSP with letter spacing, spaces before
  a forced newline); the Gecko hyphen span gets `white-space: nowrap` in `paint.ts` (SHARED-CHANGES.md); script context
  for Common-only unit starts, which Gecko shapes in the surrounding run (Hangul `7:00-9:00` shaped without kern,
  `c-8eabfbd5a87acdfa`, +72 au).
- r3: `engineWidth` is the line box width, `width` the visible extent in visual frame order (an RTL frame's trailing
  space sits mid-line, `c-01cfe05b2ffd874b`); U+3000 already removed by a frame that broke after it has no advance;
  white space `TrimTrailingWhiteSpace` removes and zero-width controls don't count (`The \f quick`); emoji DOM advance
  `floor(au60 × apd / 60 + 0.5)` (a lone regional indicator isn't a whole pixel); `tab-size: 0` gives tabs no width.
