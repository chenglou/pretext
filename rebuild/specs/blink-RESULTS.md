# Blink port results (Chrome 153.0.8010.48)

Lab runs of `rebuild/src/engines/blink` in installed Chrome 153 on this Mac (Retina, `devicePixelRatio` 2), 2026-09-17,
with the browser-process language the driver launches Chrome with (`uiLanguage` zh-CN, lab/README.md "Browser-process
languages"). Scorer 3. Every set runs in file order and in reverse, and each order is scored against the other with
`--native-compare`; no Chrome case was history-dependent. Each chain bundles a frozen copy of the library
(`scratchpad/builds/<build>`, passed with `--predictor`), so edits made while a chain runs never reach it. Rows, per-case
files and summaries are under `.artifacts/lab/blink/<build>/<set>-<order>/`. The 2026-09-16 results of the pre-charter
port are in this file's git history.

Baselines for transitions:

- smoke: `.artifacts/lab/foundations-20260917/chrome/forward` (the charter library with the process languages given);
- ws, policy, runs, the 20,000-case suite sample and the rule families: the charter evaluation's forward rows
  (`.artifacts/charter-20260916/evaluate/chrome/`), recorded without process languages;
- the triage population (research/MAIN-TRIAGE.md §2.1, Chrome small file, 8,933 cases): the charter triage rows
  (`.artifacts/charter-20260916/triage/runs/chrome/charter-file/small`), scored again with scorer 3.

## Ceiling round 2

Chrome 153.0.8010.48 as above, scorer 4 (lab/README.md "Line-local gaps": a failing line is covered only by a gap of that
line, of the decision that ended the line before it, or a paragraph gap whose `at` range meets them; slot protocol rows
and element rects). Each chain bundles a frozen copy of the library (`scratchpad/blink-r2/builds/<build>`); rows are under
`.artifacts/lab/blink/<build>/<set>-<order>/`, forward scored against reverse. No Chrome case was history-dependent.

| Build | What changed |
|---|---|
| r2-a | Gap attribution: the content's conditions are computed in `prepare` with `at` ranges and copied onto a line whose break decision measured them past its end (`contentGaps`, `lineEdgeGaps`); `control-character-width` only for VT and collapsible FF, the characters Canvas turns into spaces (plain_text_node.cc:47-58); `script-context` for a grapheme some Canvas string the port measures resolves otherwise than the paragraph, and a Latin range stays an 8-bit string at any length; `NeedsAccurateEndPosition` as `PrepareNextLine` computes it, before the base direction is set; tab-size 0 |
| r2-b | r2-a plus the font fact `pairKerning` (model.ts, lab font table), the pair window over whole glyph clusters, and the edge after preserved trailing spaces |
| r2-c | r2-b plus `IsCjkIdeographOrSymbol` for justification from generated data, the no-ligature pair test for `glyph-clusters` at adjusted edges, the margin and wide-window conditions of `in-word-prefix`, in-item limits in the observation port from the layout's gaps, and citations read at Chrome 153's HarfBuzz (dfdc088c) and V8 (6b96683d) |
| r2-d | r2-c plus item results and views that take glyph clusters by their first character (CopyRanges and FindGlyphDataRange, inline_node.cc:1781, glyph_data_range.cc:56-90), and U+2060 before a short Latin-1 range the paragraph shapes under another script than Latin, so Canvas shapes it as Common rather than as one Latin segment |
| r2-e | r2-d plus `glyph-clusters` on a line where a pair window in the content its break decision measured past the end, up to the next break opportunity under the style's own break type, adjusts otherwise with ligatures off; HanKerning::MayApply from a per-paragraph count instead of a scan per position; and the observation port's paragraph gaps indexed by source blocks. No prediction changes by construction (below) |

### Offline replay

`scratchpad/blink-r2/capture-predictor.ts` runs the working tree's predictor in Chrome and returns the layout's Canvas call
log as the prediction's error text; `replay.ts` lays each captured case out again in bun with those widths, runs the
observation port and scores the result with `score.ts`. On the 12 cases of `capture-1b` it reproduced the Chrome rows'
lines, advances and widths, and a trace (`trace.ts`, `trace2.ts`) patches `LineBreaker` and `LineBreakIterator` methods.
A string the capture didn't measure throws, so a change that measures new strings needs a new capture.

### Classes traced to source

1. **Tab stops under tab-size 0** (`rule/tabs`, 97 failures in round 1, covered only by `tab-stops`). `TabWidth(font_data,
   tab_size)` returns the letter spacing as the base when the pixel size is 0 (TabWidthInternal, font.cc:303-317,
   font.h:260-264), so `TabWidth(…, position)` stops at multiples of the letter spacing with the half-space minimum
   (font.cc:319-340); the port returned the letter spacing. Helvetica Neue 16px, `xx aaaaaaa` TAB: the tab is 234 LayoutUnits
   natively, predicted 128 before and 234 now (`c-0470827bf3f9951d`). r2-a against round 1, rule families: lineCount
   fail→pass 12, breaks 18, widths 78 (and 18 not-applicable→pass); nothing lost.
2. **Line-end reshapes under `text-align: left` and `right`** (round 1's "reshape offsets under right but not left").
   `LineBreaker::PrepareNextLine` calls `LineInfo::Reset`, which sets the base direction to LTR (line_info.cc:48-75), then
   `SetLineStyle`, which computes `needs_accurate_end_position_` from `BaseDirection()` (line_info.cc:127-175,
   line_breaker.cc:842), and only then `SetBaseDirection` (:870-871). So left never needs an accurate end and right always
   does, in RTL too: Arial `xx AAAA` RTL right reshapes the end natively (6830 LayoutUnits), RTL left doesn't (6689). r2-a
   against round 1, feature families: lineCount fail→pass 16, pass→fail 4, widths fail→pass 50. The 4 losses
   (`c-39e85a9de00bf85b`, `c-c1f755d340d7f35c`, `c-d64de8a4a5a0c8b2` and one more, Times New Roman, RTL left) had passed
   because the wrong reshape dropped the whole kern at the line end, where Blink keeps half of it (class 3).
3. **Pair adjustments split by the kern machine.** Times New Roman (GPOS without a kern feature, and a `kern` table),
   Helvetica Neue and Hoefler Text kern through HarfBuzz's pair machine, which adds `kern >> 1` to the first glyph's advance
   and the rest to the second's (hb-kern.hh:102-106; plan hb-ot-shape.cc:150-185); GPOS PairPos in Arial adds all of it to
   the first (PairSet.hh:126-127). A position between the two glyphs differs by `d − (d >> 1)`: Times New Roman 20px `AAAA`
   before a trimmed space is 7325 natively where the first-glyph placement gave 7254. Canvas totals can't show which, so it
   is the font fact `pairKerning`, read offline from the GPOS kern lookups' value formats and the kern and kerx subtable
   formats (`.artifacts/charter-20260916/font-facts/tools/tables.py`, `build-facts.ts`; SHARED-CHANGES.md). r2-b against
   r2-a: rule families lineCount fail→pass 26 (`following-space` 16, `in-word-breaks` 6, `hyphen-glyph` 4), breaks 41,
   widths 56 and 41 not-applicable→pass; feature families lineCount 16, widths 164; runs widths 2; no prediction metric lost.
4. **A mark after a default-ignorable character measured alone** (`c-01763358db8471a3`, held-out `suite/space`, `a` TAB
   `ب` SHY kasra `ب` in Shantell Sans, the round 1 critic's unsettled `glyph-clusters` edge). The pair window at offset 5
   took one grapheme on each side, the kasra alone, which in Canvas is a broken cluster, and gave `ب` a −2 px adjustment;
   `offsetForPosition` then found the candidate at 5 instead of 2, and the port kept `ب` SHY kasra on one line. HarfBuzz
   merges the kasra into SHY's cluster (hb_form_clusters, hb-ot-shape.cc:578-586), so the window now takes whole clusters.
   Replayed from `capture-1c`: 4 lines `a` TAB / `ب` / SHY kasra / `ب`, as native.
5. **Emoji sequences split across spans** (`runs/letter-spacing-spans`, `runs/split-word`): a span edge inside
   `🏳️‍🌈` starts the second span with ZWJ, where Canvas starts a word before the pictograph (plain_text_node.cc:117-153,
   `IsCjkIdeographOrSymbolBase`) and letter-spaces it while the DOM keeps it in the ZWJ's cluster; `❤` in one span and VS16
   in the next take emoji presentation natively from RunSegmenter over the whole text. Covered by `font-fallback` at the
   grapheme's range ("a shaping-group edge inside a grapheme cluster"); no recipe.
6. **U+FFFC in text** (`rule/object-replacement`, `suite/U+FFFC/*`): `font-fallback` at the character (probe
   blink-followups-20260917: no Canvas character stands in for every font).
7. **Null font facts**: `system-ui` and `BlinkMacSystemFont` (`rule/system-fonts-and-sizes`) report `optical-size` and
   `page-history` on their text; Hoefler Text, `-apple-system`, Kohinoor Bangla and Monaco, which only the rule families use,
   aren't in the lab's font table, so their facts are null (`rule/in-word-breaks`: `optical-size`, and `unsafe-to-break` at
   kerned edges). With `pairKerning` 'split' (Hoefler Text has a format 0 `kern` table) the widths case
   `c-0ace7f5d64c2d61f` passes in replay.

### Transitions

Forward rows, outside history dependence. r2-b against r2-a and round 1's are in the classes above.

- **r2-c against r2-b** (smoke, ws, policy, runs, rule and feature families, held-out runs, ws and policy): no line count,
  break or width changed. The narrowed conditions change only which gaps fire.
- **r2-d against r2-c**, the same sets: smoke widths fail→pass 1 (`c-26a7a7b28da24b44`, `سلام((tail` in Amiri: the brackets
  after Arabic measured as Common through U+2060, 1407 units each as natively, where the 8-bit string gave 784). Nothing
  else changed.
- **r2-e against r2-d** (smoke, runs, ws, policy, held-out runs, ws and policy, rule and feature families in both
  languages, the four suite sample parts and the triage population's small file): no line count, break, width or painter
  status changed on any case. The changes add gaps and remove work. Failures without a line-local gap: triage 11 → 1
  (`c-8c84627af834611f`), none on the other sets.
- **r2-d against round 1's evaluation rows**, no line count, break or width lost on any set:

| Set (cases) | lineCount | breaks | widths |
|---|---|---|---|
| smoke (299) | – | – | fail→pass 1 |
| runs (2,580) | – | – | fail→pass 2 |
| ws, policy, held-out policy, features en-US | – | – | – |
| held-out runs (2,579) | – | – | fail→pass 3 |
| held-out ws (1,039) | – | – | fail→pass 1 |
| rule families (10,976) | fail→pass 38 | fail→pass 59 | fail→pass 138, not-applicable→pass 59 |
| feature families (12,882) | fail→pass 28, unobserved→pass 719 (element rects) | the same | fail→pass 212, unobserved→pass 1,938, not-applicable→pass 640 |
| suite sample (19,994) | fail→pass 33 | fail→pass 42 | fail→pass 83, not-applicable→pass 42 |
| held-out suite sample (10,000; r2-e) | fail→pass 18 | fail→pass 39 | fail→pass 81, not-applicable→pass 39 |

  Suite sample gains: `original-vs-reshaped-admission` 23 line counts and 41 widths and `partial-source-context` 3 and 8
  (U+2060 before brackets under Arabic), `negative-space` 34 widths (`pairKerning` in Times New Roman),
  `separator-grapheme` 6 widths (clusters by their first character). Held-out suite gains (r2-e, both parts, forward rows
  against `.artifacts/ceiling-20260917/evaluate/chrome/heldout-suite-sample-forward/`): the Amiri families whose text puts
  `((` or `[[` after Hebrew, Arabic or Cyrillic (`source-shaped-arabic` 13 widths, 10 breaks, 4 line counts; the
  `hanging-*`, `missing-*` and `spacing-hanging-*` space families, `physical-window-terminal-seam`, `raw-context`,
  `script-prefix-heldout`, `hidden-control-spacing`, `joined-mark`, `space`, `mixed`), which is the U+2060 prefix;
  `separator-grapheme` 16 and `ideographic-source-edge` 6 widths (Arial `a` U+3000 and a mark: clusters by their first
  character); Times New Roman `space-context` 4, `spacing-tail` 8, `following-space-context` and `following-space-scope`
  (`pairKerning`); `chromium-script-spacing` 1 width (Courier New `a` SP U+0301 `b`), not traced. Painter pass→fail 25:
  22 on cases whose line count, breaks or widths changed on the same case, and 3 (`spacing-tail` 2,
  `following-space-scope` 1) with no prediction change, where paint.ts changed. Every held-out suite prediction failure
  (193 cases) has a line-local gap; round 1 left 29 without one. The triage population (8,933 cases) against fix-r11:
  lineCount fail→pass 264, pass→fail 2; breaks fail→pass 296, pass→fail 2 (below).
- **Painter.** Feature families pass→fail 36, all `rule/text-align` cases whose widths are now right (the painted line is
  laid out alone and doesn't repeat the paragraph's line-end reshape). Rule families `in-word-breaks` 16 and `controls` 8,
  and suite sample `negative-space` 28 and `spacing-tail` 2, lost painter passes where no prediction metric changed: paint.ts
  changed between the frozen builds (the painter owner's hanging-space node and soft-wrap boxes, SHARED-CHANGES.md).

### A stalled held-out suite run

r2-d's held-out suite part 0 in file order stopped twice with "No page activity for 120000ms": with 25 cases per round
trip after 0 rows (`.artifacts/lab/blink/r2-d/heldout-suite-sample-part0-forward-stalled-chunk25/`), and once more, with
one case per round trip as round 1 ran it, after 4 rows (`r2-d/heldout-suite-sample-part0-forward/`). Its 5th case,
`c-c8110fb16910a3a7`, is a 256,837-unit Arabic paragraph. Round 1's evaluation row of it
(`.artifacts/ceiling-20260917/evaluate/chrome/heldout-suite-sample-forward/part0`) took 95.4 s to predict, 7.2 s to observe
and 2.9 s natively, already near the limit. r2-d's rows before it predicted in 14-17 s against round 1's 11-15 s and
observed in 1.4-3.8 s against 0.6-1.9 s. Two costs, both exact to remove:

- **Positions scanned the whole shaping group.** A bun profile of the prediction with a stand-in Canvas
  (`scratchpad/blink-r2/prof/`) put 95% of the time in `groupPrefix16`, with round 1's code and r2-d's alike: every position
  asked `kernsAfter`, which asked HanKerning::MayApply over the group by scanning it, and a group without Han punctuation
  scans to its end. The paragraph now counts candidates once (`hanKerningCandidates`), so MayApply over any range is a
  subtraction. Same case in bun: 59.1 s → 3.3 s, the same 230,129 Canvas calls, and the lines, gaps and call log hash
  equal (`hash-layout.ts`). The prefix count agrees with the scan on 100,000 random ranges of mixed text (`hk-check.ts`).
- **The observation port scanned every paragraph gap for every code point.** r2-a gives content gaps source ranges, 5,317
  `script-context` ranges here, and `gapConcerning` checked all of them for each of the 256,837 code points. The port now
  indexes the ranged gaps by 64-unit blocks and still returns the first gap in the layout's order: observation 10.8 s →
  7.1 s in bun with an equal hash of the expected observation (`obs-time.ts`), and the `capture-4c` replay byte-equal.

Build r2-e has both; its held-out suite parts ran with one case per round trip. In Chrome the two paragraphs predict in
5.2 and 6.7 s (round 1: 95.4 and 102.5 s) with the same Canvas call counts as r2-d's rows before them, and part 0 in file
order took 92 s against round 1's 341 s. Observation stays at 7.1 and 9.8 s, most of it the port's per-code-point quads.
The first rerun with one case per round trip came from a wrong reading of the bun timings: the stand-in Canvas runs are no
guide to Chrome's time, and that run failed on the same case before the two costs above were found.

### Gap firing on the development set

Smoke, runs, ws, policy and the suite sample (25,498 cases), forward rows. Lift: a gap's share of cases failing a prediction
metric over its share of all-pass cases. Round 1 (223 prediction-failing cases) → r2-d (95) → r2-e (95):

| Gap | Reports | Prediction-failing cases reporting it | Lift |
|---|---|---|---|
| `script-context` | 18,298 → 19,394 → 19,394 | 173 → 86 → 86 | 1.09 → 1.20 → 1.20 |
| `in-word-prefix` | 13,638 → 732 → 724 | 133 → 6 → 6 | 1.10 → 2.13 → 2.16 |
| `glyph-clusters` | 3,165 → 2,724 → 3,953 | 155 → 57 → 58 | 7.44 → 7.58 → 4.74 |
| `unsafe-to-break` | 2,223 → 1,523 → 1,523 | 156 → 48 → 48 | 11.79 → 14.61 → 14.61 |
| `font-fallback` | 697 → 697 → 697 | 52 → 52 → 52 | 11.23 → 26.44 → 26.44 |
| `soft-hyphen-shaping` | 390 → 434 → 434 | 10 → 10 → 10 | 2.90 → 6.08 → 6.08 |
| `tab-stops` | 250 → 250 → 250 | 4 → 1 → 1 | 1.82 → 1.06 → 1.06 |
| `control-character-width` | 970 → 127 → 127 | 0 | 0 |
| `han-kerning` | 229 → 228 → 228 | 0 | 0 |

`script-context` stays weak (Other open items). `tab-stops` fires on every tab and covers one failure: whether the platform
space advance differs from Canvas's needs a tracking fact. r2-e's look-ahead makes `glyph-clusters` weaker on this set
(1,229 more reports, one more failing case). It is what covers the triage population's 10 ligature cases, where no other
condition fires, so the condition stays; a tighter one would need where the decision's own measurement crosses the
ligature, which the look-ahead doesn't compute.

### Round 1 rows under scorer 4

Chrome prediction failures outside history dependence without a line-local gap, round 1's evaluation rows re-scored
(`scratchpad/blink-r2/uncovered-all.ts`): runs 3, held-out runs 4, held-out ws 1, rule families 72 (`system-fonts-and-sizes`
64 with paragraph gaps only, `following-space` 8 with gaps on the next line), feature families 52 (`text-align`), suite
sample 9 and held-out suite sample 29 (`U+FFFC/*` with paragraph gaps only, one `rich-boundaries`, one `space-context`).
round 1's "0 without a gap" counted paragraph gaps.

## Builds

| Build | What changed |
|---|---|
| conv-r1 | Stage 5 (DESIGN.md §8.3): the port walks the inline tree; per-span styles wherever Blink reads an item's style; open and close tags with box edges; atomic, `<br>` and `<wbr>` items; text-indent; text-align offsets and `NeedsAccurateEndPosition`; layout opportunities from line slots and below-floats; the new geometry fields and fragments. No flat-paragraph rule changed |
| fix-r2 | conv-r1 plus three fixes from research/SUPERSET-blink.md §2.1: A, HarfBuzz continuation clusters for positions, safe-to-break and RTL x positions (`isClusterBoundary`); B, letter spacing wherever the Canvas string's script and the DOM run's script differ in cursiveness (`ShapeResultSpacing::ComputeSpacing` on both sides); C, Canvas strings split at the paragraph's script edges (`HarfBuzzShaper` shapes each RunSegmenter segment alone) |
| fix-r3 | fix-r2 plus gap conditions: `glyph-clusters` at a chosen line edge where the pair total shows an adjustment, and `unsafe-to-break` wherever an OpenType joining edge is measured through the U+200D stand-in |
| fix-r4 | fix-r3 plus `afterLeadingFloats` in the break token (below) |
| fix-r5 | fix-r4 plus box edges through bidi reordering (`PrepareForReorder`, `UpdateAfterReorder`, `ComputeInlinePositions` with box data, inline_box_state.cc:661-935) and border widths by `ConvertBorderWidth` and `ClampLineWidth` (style_builder_converter.cc:1953-1990) |
| fix-r6 | fix-r5 plus `text-align: justify` (`ApplyJustification`, justification_utils.cc:237-310; `ShapeResultSpacing` expansion) |
| fix-r7 | fix-r6 plus `glyph-clusters` at every chosen line edge between joining letters. Predictions equal fix-r6's |
| fix-r8 | fix-r7 with the fitted part of `blink/measure/ignorables-left-out-if-8bit` removed: in a segmented paragraph a Canvas string keeps its default-ignorable characters as U+2060 whatever its length (probe below) |
| fix-r9 | fix-r8 with `isClusterBoundary` true at every unit that isn't a continuation, inside a grapheme too. Rejected (transitions below) |
| fix-r10 | fix-r8 plus `glyph-clusters` wherever a position is asked inside a grapheme at a unit HarfBuzz doesn't mark a continuation (`startsClusterInsideGrapheme`): in a line's glyph clusters and at a hang's end |
| fix-r11 | fix-r10 plus the same report at every view part edge (`makeView`), where a bidi run edge or a split-off trailing space cuts a grapheme. Predictions equal fix-r8's |
| fix-r12 | fix-r11 with views built as Blink builds them (`viewFromSegments`): parts carry `start_index_`, `offset_` and `num_characters_`; in RTL the segments are walked back to front, so a view joining a reshaped line start and the rest numbers its parts in visual order, and later views take parts and glyphs by those numbers (shape_result_view.cc:89-322, glyph_data_range.cc:56-90). Class 3 below |

## Scores

pass / fail / unobserved, widths and painter adding not-applicable. Forward runs.

| Set (cases) | Build | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke (299) | conv-r1, fix-r2, fix-r5 | 298/1/0 | 298/1/0 | 295/1/2/1 | 294/3/2 |
| feature families (12,882) | fix-r4 | 10017/2248/617 | 10017/2248/617 | 6087/2420/3730/645 | 6226/309/4127/2220 |
| feature families (12,882) | fix-r5 | 11975/188/719 | 11975/188/719 | 6859/360/4916/747 | 6914/402/5406/160 |

With fix-r6 the feature families' remaining 160 prediction errors (justify) pass line counts and breaks, leaving 28 line
count failures, all `rule/text-align` under named gaps.

## Transitions

**conv-r1 against the baselines.** smoke, ws, runs: no metric of any case changed. policy: breaks 2 fail→pass, widths 2
not-applicable→pass (`c-d45e7865486e1537`, `c-890e3959591b8891`), both reporting `ui-language` before: the given process
language. The conversion to the tree model loses no pair on the flat sets.

**fix-r2 against conv-r1.** smoke, ws, policy, runs: no metric changed.

**fix-r5 against fix-r2.** smoke, ws, policy, runs and the 19,994-case suite sample: no metric of any case changed, so the
positioning rewrite for box data keeps flat parity.

**fix-r2 against the charter rows, suite sample (19,994 cases).**

| Metric | Transitions |
|---|---|
| lineCount | fail→pass 10 |
| breaks | fail→pass 41 |
| widths | fail→pass 27, not-applicable→pass 39, not-applicable→fail 2 |
| painter | fail→pass 26, pass→fail 7 |

- Process language (`ui-language` before, not now): `curly-double-open` `c-ab42aa1d1701a85d`, `spacing/curly-double-open`
  `c-b0677e0d51718133`, `explicit-locale-quotes` 3, `signed-spacing/curly-single-*` 2.
- Fix A: `cluster-v1` 2, among them the case main's suite requires, `c-9c5a66597ebf5aef` (`a` U+2060 U+0301 `b`,
  MAIN-TRIAGE §3.2), and `c-bf63924e328743c3`; `mark-context` 12; `physical-text-geometry` 9; `joined-mark`;
  `restart-next-word`; Myanmar paragraphs (`my-bad-deeds-return-to-you-teacher` 5 breaks and 8 painter; MAIN-TRIAGE §3.7).
- `my-cunning-heron-teacher` 12 widths and painter fail→pass (Myanmar corpus with Common quotes and ellipses between
  Myanmar words): fix A or C, not separated.
- Painter pass→fail 7, each with its engine metric fixed on the same line, so the old pass painted a wrong prediction:
  `c-59dc002adc3c3ae7` (widths now pass at 2278; painted 2406), `c-8bcd71f575e5f894` (widths now pass at 0; painted 128),
  `c-23469b4fb3916a6b` (breaks now pass; painted 1408 against 1216), `joined-mark` 4 more.
- widths not-applicable→fail 2: `c-aeaf1d54df73bdf0` (`accepted-l`, line count now passes, `unsafe-to-break`) and
  `c-34cda5a5b914e8b5` (`joined-mark`, line count now passes). No pass lost.

**fix-r2 against the charter rows, rule families (10,976 cases).** lineCount fail→pass 32, breaks fail→pass 50, widths
not-applicable→pass 50, painter fail→pass 34, all `rule/languages` and `rule/quotes`: the given process language. No
metric lost.

**fix-r4 against the charter triage rows (Chrome small, 8,933 cases).**

| Metric | Transitions |
|---|---|
| lineCount | fail→pass 283 |
| breaks | fail→pass 303 |
| widths | not-applicable→pass 299, fail→pass 2, not-applicable→fail 4 |
| painter | fail→pass 38, pass→fail 47 |

- Fix B, U+202F measured without letter spacing (MAIN-TRIAGE §3.5): `chromium-script-spacing` 61 line counts, 69 breaks;
  `maintained/kinsoku-units` 18 and 22.
- Fix A (MAIN-TRIAGE §3.2): `cluster-v2-new` 40, `prefix-cap-control` 40, `cluster-v1` 34, `restart-next-word` 18.
- Fix C (SUPERSET §2.1 C): `following-space-scope` 12.
- `mixed` 14 and others: fixes A to C, not separated case by case.
- Painter pass→fail 47: 41 have lineCount, breaks or widths fixed on the same case (the painted line matched a wrong
  prediction). The other 6 (`hidden-control-spacing` 3, `cross-item` 1, 2 more) paint a line that starts with Common
  punctuation after an Arabic line: fix B gives `((` in the DOM's Arabic run no letter spacing (`c-23b8729896b137c2`, line
  `((tail` 6129→5873 units, 128 per `(`), and the painted line, where no Arabic precedes it, spaces them again. The case's
  line count failed before and after under `script-context`. Painter form.

**fix-r5 against fix-r4, feature families (12,882 cases).** lineCount and breaks fail→pass 1,958 (`box-edges` 1,350,
`nested-box-edges` 360, `nowrap-spans` 136, `br-elements` 112) and fail→unobserved 102 (`br-elements`: a line holding only
a `<br>`, which no Range reports); widths fail→pass 772; painter not-applicable→pass 688 and not-applicable→fail 93. These
were prediction errors in fix-r4 (box edges in bidi paragraphs, borders off the device-pixel grid). No metric lost.

**fix-r5 against fix-r2, rule families.** No metric of any case changed. Prediction failures without a gap drop from 64 to 12
(`rule/joining` widths, class 3 below): the joining line counts now report `unsafe-to-break`.

**fix-r7 against fix-r4, triage population.** No metric of any case changed. Prediction failures without a gap drop from 2
to 0 (the lam-alef and three-letter ligature cases now report `glyph-clusters`, which 719 of the 8,933 cases report).

**fix-r6 against fix-r5, feature families.** lineCount and breaks fail→pass 160, all `rule/text-align` justify; widths
fail→pass 84, fail→unobserved 56; painter not-applicable→pass 78, →fail 28, →unobserved 54. No metric lost.

**fix-r8 against fix-r5 (flat sets, suite sample, rule families) and fix-r7 (triage population).** smoke, ws, policy, runs,
suite parts 0 to 2 and the rule families: no metric changed. Suite part 3: `suite/partial-source-context` lineCount and
breaks fail→pass 4 (RLM `((` before Hebrew or Arabic text: U+2060 `((` gives the DOM's 2814 units), breaks pass→fail 1
with painter pass→fail 1 (`c-9f72ec9d12c60092`, RLM `((tail`, RTL, Amiri). There the brackets take the Latin script from
`tail` and the DOM gives `((` 1567 units; the item's Canvas string holds no Latin letter, so its brackets shape as Common
at 2814, and the case now reports `script-context`, whose condition holds (Canvas script Common, paragraph script Latin).
The old pass came from the fitted rule, which left the RLM out and so hit the Common-only `((` at 1567. Triage population:
`suite/mixed` lineCount fail→pass 5, breaks fail→pass 3, widths not-applicable→fail 3 (all under `script-context`). No
other metric changed.

**fix-r9 against fix-r8.** Triage population: `suite/ideographic-source-edge` fail→pass 2 in every metric
(`c-32e897f031fc55ea`, `c-c8df57f69da55e59`: `a` U+0600 U+3000 `b`, Amiri, pre-wrap, keep-all, break-word; natively U+0600
is its own cluster at 3484 units, and fix-r8 gave its width to the hanging U+3000, so the line fit). Suite part 3: the second
case again. Rule families: `rule/clusters` lineCount and breaks pass→fail 8 (`c-0f9175c5a0b8d182` and 7 more, `x ক্যক্যক্য y`
in Kohinoor Bangla, width 1 px, break-all): natively each conjunct `ক্য` is one cluster, so no break falls inside it,
where fix-r9 split it at `য` and broke there. Smoke, ws, policy, runs, suite parts 0 to 2: no change. A grapheme and a
HarfBuzz cluster disagree in both directions, and which one applies is the font's ligature, so fix-r9 is rejected:
fix-r10 keeps the grapheme as the unit and reports `glyph-clusters` where they may disagree.

**fix-r10 against fix-r8.** Every metric of every case equals fix-r8's in smoke, ws, policy, runs, the four suite parts,
the rule families and the triage population. The new `glyph-clusters` report in a line's glyph clusters and at a hang's end
never fired on the two ideographic cases, whose cut inside the grapheme is a bidi run edge (U+0600 is AN), so fix-r11
reports it at every view part edge instead (`makeView`).

**fix-r11 against fix-r8.** Triage population and rule families: no metric of any case changed. The ideographic cases'
failing line 0 now reports `glyph-clusters`. The report fires in 628 of the 19,909 cases: `obligations/accuracy` 256,
`rule/zwnj` 216 (ZWNJ is grapheme Extend but no HarfBuzz continuation, so its position is the letter's end natively and
the grapheme start in the port), `rule/clusters` 152, `obligations/emergency-graphemes` 2, `suite/ideographic-source-edge` 2.

**fix-r12 against fix-r11.** Rule families: `rule/joining` widths fail→pass 48, all of class 3's cases; painter pass→fail
44, every one on a case whose widths now pass (`c-13205f06e6e28015`: the engine's line 1 is 0 wide, as natively, and the
painter, laying that line out alone without the following span or a reshaped line start, paints the letter). No line
count, break or width lost. Probe `probe-zw3` against fix-r10: widths fail→pass 7, painter pass→fail on the same 7.
Triage population and suite parts 0 to 2: no metric changed. Suite part 3: widths fail→pass 1 with painter pass→fail 1,
`c-88f6431511efc998` (`suite/physical-window-terminal-seam`, RTL, Amiri). Its line 2 starts at a joining `ب` in an RTL
item and is cut before its trimmed tab. Natively the `ب` is 0 and the ZWSP after it 898 units, which fix-r12 now predicts;
the painter lays `ب` ZWSP TAB out alone and paints the letter's advance ([5479, 8192]). Runs: widths fail→pass 1 with
painter pass→fail 1, `c-2b00e683ec53cd0c` (`runs/split-word`, class 3's runs case, the same pattern). Smoke, ws, policy and
the feature families: no metric changed. Across every set, fix-r12 loses no line count, break or width, and each painter
loss is on a case whose widths it fixed.

## A stall and its root cause

fix-r3's feature run stalled the page after 5,750 rows (120 s without activity; the chain stopped and didn't retry).
Case `c-0262c91b5a593353` (`aaaa` TAB `bbbb cccc` TAB `dddd eeee`, pre-wrap, text-indent 10, first slot leaving 3.7 px):
the indent alone overflows, `HandleOverflow`'s leading-floats rule rewinds it and ends an empty line
(line_breaker.cc:4225-4248), and the shared loop lays the next line, with no line box, from the same start in the same slot.
In Blink that rule runs once: the first line handles the floats before any inline content, so later break tokens are past
their items. The model's slot floats aren't items, so `BlinkLineStart.afterLeadingFloats` carries it. An offline replay
of all 12,882 feature cases in bun with a stand-in Canvas (`scratchpad/hang-all.ts`) finds no line that restarts where it
started.

## Failing cases without a gap

Failures (lineCount, breaks or widths) and failures on a case that reports no gap, forward rows of the newest builds:

| Set (cases) | Build | lineCount | breaks | widths | without a gap |
|---|---|---:|---:|---:|---:|
| smoke (299) | fix-r12 | 1 | 1 | 1 | 0 |
| ws (1,019) | fix-r12 | 0 | 0 | 1 | 0 |
| policy (1,606) | fix-r12 | 0 | 0 | 0 | 0 |
| runs (2,580) | fix-r12 | 2 | 3 | 9 | 0 |
| suite sample parts 0 to 3 (19,994) | fix-r12 | 89 | 100 | 108 | 0 |
| rule families (10,976) | fix-r12 | 204 | 286 | 368 | 0 |
| triage population (8,933) | fix-r12 | 480 | 714 | 11 | 0 |
| feature families (12,882) | fix-r12 | 28 | 28 | 220 | 0 |

Earlier builds had failures without a gap: suite 3 (classes 4 and 2), triage 2 (class 2), rule families 64 (classes 1 and
3), runs 1 (class 3). Classes 1, 2 and 4 report gaps whose conditions the source and probes support; class 3 was a model
bug, fixed in fix-r12. No open model bug remains by this file's rule (a failure without a gap, or a gap whose condition
the source contradicts). The classes:

1. **Joined Arabic reshaped at a line edge in an OpenType font** (`rule/joining` 16 line counts, e.g. `c-15467033b9eb674d`,
   Amiri `بب بببببب بب`, break-all, RTL): native ends line 0 at `ب` 390 units wide where the U+200D stand-in gives 350. U+200D
   gives the joined forms but not contextual alternates that read further context: DESIGN.md §5 `unsafe-to-break`,
   "contextual forms across" a chosen edge. The port skipped the report when the joining fact was given; fix-r3 reports it
   wherever such an edge is measured.
2. **A ligature over the chosen edge** (`suite/joined` `c-0783d6381458ee82`, `بِلا` with Geeza Pro fallback; triage
   `c-1c0b1895a5de8849`, `صلىالله`, whose `لله` natively splits one glyph into equal thirds): Blink never breaks inside a
   glyph (`OffsetToFit` with `BreakGlyphsOption(false)`, shape_result.cc:684-694), and Canvas totals don't show glyph
   clusters. The pair window of one grapheme per side misses a three-letter ligature, so fix-r7 reports `glyph-clusters` at
   every chosen line edge between joining letters as well as where the pair total shows an adjustment (MAIN-TRIAGE
   decision 3).
3. **A final Arabic letter before a trailing space at an element edge under break-all reports zero width natively**
   (`rule/joining` 48 widths, `runs/split-word` `c-2b00e683ec53cd0c`). Fixed in fix-r12 from source. Probe `probe-zw3`
   (`scratchpad/probe-zw3.ts`, `.artifacts/lab/blink/probe-zw3/`, 48 cases, Arial 24px, break-all) gave the condition:
   - the whole line-1 fragment is zero width natively, text node rect included;
   - under LTR `pre-wrap` the letter reports 0 and the space 3045 units, the letter's 2192 plus the space's 854;
   - it takes a wrapped line starting at a joining letter, the letter and its space in one RTL item at a text node's end
     with a span after it, and the line's result cut at the space (the trailing-space trim under `normal`, the bidi split
     of a preserved trailing space in an LTR paragraph);
   - RTL `pre-wrap` (no cut), width 40 (no reshaped line start), the space inside the span and two text nodes without a
     span keep the letter's advance.

   The mechanism: `ShapeToEnd` joins the reshaped line start [1, 2) and the item's [2, 3) in one view
   (shaping_line_breaker.cc:640-670). `ShapeResultView::Create` walks the segments back to front in RTL while
   `PopulateRunInfoParts` numbers each segment's parts from the characters counted so far (shape_result_view.cc:215-308), so
   the space's part is numbered 1 and the letter's 2. The later view [1, 2) (`TruncateLineEndResult`,
   line_breaker.cc:2371-2400) finds no part numbered there (`RunInfoPart::ComputeStartEnd`, shape_result_view.h:218-250),
   and the view [2, 3) takes both glyphs. fix-r12 builds views this way (`viewFromSegments`). On the probe cases against
   fix-r10: widths fail→pass 7, no line count, break or width lost; painter pass→fail on the same 7, because the painter
   lays the line out alone, where no span follows and no line start is reshaped (painter form).

4. **`ب` SHY `ب` ZWJ `ب` in Amiri under break-word** (`suite/U+200D/middle` `c-03c543bf92efcb2d`, `c-cc0717026d813422`):
   native 4 lines (`ب` / the hyphen / `ب` ZWJ / `ب`), port 2 ([0, 4) at 850 units, then `ب`). Explained by probe
   `blink-followups-20260917 amiri shy zwj` (`.artifacts/probes/blink/followups-20260917-class4/`): in the item's own shaping
   (one nowrap line) `ب` is 478 units and `ب` ZWJ 501, so [0, 4) is 979 units, over the 975 available, while the U+200D
   stand-in string gives 850 (the whole string equals the DOM in Canvas, 2786). With 979, the break-character retry's
   candidate (`CachedOffsetForPosition`) is at offset 2, the hyphen doesn't fit (390 + 756), BreakText retries at 219 and
   `ShapeLine` takes the next opportunity, 1 (shaping_line_breaker.cc:386-400, line_breaker.cc:1706-1718), which gives the
   native lines. The first letter's wider form reads context past the chosen edge: `unsafe-to-break`, which both cases
   report on line 0. Not a model bug.

Painter failures without a gap (`rule/controls` 14, `rule/fit-bound` 12, `ws/trailing-space-edge` 7 and more, one
LayoutUnit short; painted lines that wrap) are the painter owner's.

## Features in the tree model

Unit tests (`bun test rebuild/src/engines/blink`, 78 tests, stand-in Canvas of 10 px per code point) cover:
- box edges at a wrap point with an `inline-box` item, and box edges in an RTL paragraph;
- an atomic inline with a start margin, `<br>` and `<wbr>`;
- text-indent on the first formatted line, and an indent that overflows a narrowed first slot (the stall above);
- center and end alignment, and justify;
- a slot that moves a line below its floats, and border widths snapped by `ClampLineWidth`;
- the `glyph-clusters` report where a view edge cuts a grapheme.

`rebuild/lab/observe/blink.test.ts` covers element rects: a box fragment per line, an atomic border box, a `<br>` item and a
culled span's items.

The families owner's feature families (`.artifacts/tests/features-20260917/chrome/final/family-cases.ndjson`, 12,882
cases) with fix-r6: every case lays out; line count failures only in `rule/text-align` (28, named gaps). Remaining
unobserved values are the scorer's width rule over lines with text-indent, slot offsets, box edges and atomic inlines,
and lines holding only an atomic inline or a `<br>`: the lab doesn't record element rects yet.

What the port throws `UnportedFeature` for instead of laying out silently: nothing since ceiling round 2 (r2-c). Justification
over a character at U+02C7 or above reads `IsCjkIdeographOrSymbol` from `blinkCjkIdeographOrSymbolRanges`, which
tools/gen-blink-data.ts generates from character_property_data.h:17-111, ICU 78.2's `Emoji_Presentation` and the
Extended_Pictographic characters of RGI emoji ZWJ and modifier sequences (character_property_data_generator.cc:89-140); no
lab case reaches it, and `lines.test.ts` checks the opportunities before and after ideographs.

Where the port decides something the lab can't show yet:

- whether a nested span without box edges creates a box fragment because its font height differs from its parent span's
  (`ShouldCreateBoxFragmentForChild`, inline_items_builder.cc:244-266): the port compares font declarations. It decides
  element rects only, never breaks;
- `<wbr>` element rects: none; a probe should settle whether its flow-control item makes a fragment item (DESIGN.md §9);
- `BlinkEnvironment.contentLanguage` reaches no locale: the model's block always carries a `lang` attribute, which
  replaces the root's Content-Language (style_resolver.cc:2405-2406).

## Probe blink-followups-20260917

`rebuild/probes/blink-followups-20260917.ts` in installed Chrome 153 (`.artifacts/probes/blink/followups-20260917/`), DOM
range widths against `ceil(W × 64)` of Canvas strings at the zoomed size:

- **RLM `((` in Amiri 24px** (CHARTER-CRITIC item 5). DOM in a plain block, RTL and LTR: 2814 units. Canvas: `((` 1567,
  U+2060 `((` 2814, U+034F `((` 2814, RLM `((` 2814, U+2060 alone 0; `a` U+2060 `b` equals `ab` (2784) in the DOM and in
  Canvas. So U+2060 is what the DOM gives here, and the 1567 an earlier probe saw natively (the item inside a span followed
  by Latin text) came from the brackets resolving to the Latin run's script, not from storage. The port's "left out if the
  string would have 1 or 2 code units" rule was fitted to that one string; fix-r8 removes it and keeps the source rule
  for 8-bit paragraphs.
- **U+FFFC** (`font-fallback`). DOM: 2048 units in Arial 16px and in Times New Roman 16px (one em), 1232 in Amiri 16px.
  Canvas: U+FFFD 2048 in all three, U+FFF9..U+FFFB 1233 in all three, U+0378 and U+10FFFD 1536 (Arial), 1593 (Times New
  Roman), 746 (Amiri), U+E000 0. No character stands in for every font: which font draws U+FFFC follows the primary font's
  cascade, which Canvas doesn't show. `font-fallback` stays the named gap.

## Other open items
Round 1's items, as of ceiling round 2:
- Resolved: `glyph-clusters` at adjusted edges fired on kerned Latin edges; r2-c reports it only where the pair window
  measured with liga, clig and calt off (a 1/64 px letter spacing, font_features.cc:54-86) gives another adjustment.
  Ligatures from rlig or ccmp stay unseen; joining letters report `glyph-clusters` whatever the window shows.
- Resolved: justification over U+02C7 and above (above).
- Resolved: CHARTER.md "Known deviations" names `ignorables-left-out-if-8bit` a ported rule cited at Chrome 153's V8, and
  registers `shape/cluster-unit-grapheme` as a heuristic chosen by counts.
- Resolved: scorer 4 compares element rects; r2-c's feature families pass every line count and break (12,882 cases), so
  the nested-span font-height rule decides no failing rect there. `<wbr>` rects stay unsettled (DESIGN.md §9).

Open:
- `script-context` fires about as often on passing cases as on failing ones (lift 1.0 on smoke, runs, ws and policy). The
  condition holds by source: Canvas does shape those characters under another script. It can't change a width where the
  font selects the same lookups for both, and HarfBuzz gives Common text the `latn` lookups of a font without a `DFLT`
  script (hb-ot-layout.cc:549-600); Arial, Times New Roman, Georgia, Verdana and Courier New have no `DFLT` record, and
  Shantell Sans and SF have equal `DFLT` and `latn` systems, while Amiri and Noto Naskh Arabic don't. Narrowing it needs
  that as a font fact and the primary font's coverage of the characters, which Canvas doesn't show either.
- The lab's font table lacks five families only the rule families use (Hoefler Text 200 cases, `-apple-system` 160,
  `BlinkMacSystemFont` 160, Kohinoor Bangla 152, Monaco 136), so their facts are null; `rule/in-word-breaks` Hoefler Text
  cases fail under `optical-size` and `unsafe-to-break` where `pairKerning` 'split' would pass in replay.
- The triage population's provisional soft-hyphen cases (`c-5ad66fca9795e477`, `c-b6353fa535b61f06`, `ب` kasra SHY kasra
  `ب` at width 0 under break-word): natively SHY and the kasra that continues its cluster share a line. r2-d gives the
  Shantell Sans case its 3 native lines (replay of `capture-3`). The Noto Nastaliq Urdu case still ends a line after SHY
  with a hyphen: from the line start at 2 every offset up to 5 is unsafe, the start reshape leaves no space, and the
  break-character retry takes the grapheme boundary at 3 (trace from `capture-3`). HandleOverflow matches the source
  (line_breaker.cc:4079-4125); what keeps the kasra with SHY natively isn't traced. The failing lines report
  `unsafe-to-break` and `glyph-clusters`.
- `c-8c84627af834611f` (`suite/mixed`, `1111({tail` in Shantell Sans, letter spacing −1px, break-word): natively `1({`
  shares a line, where the port ends it before `{`. Line 1's decision rejects the candidate at 6 because the end reshape of
  `{` alone measures 959,447 raw units (14.64 px), over the 14.5 px left, while the paragraph's positions give `{` 13.2 px
  with its pair adjustment before `t` (trace from `capture-4b`). Kerning stays on under letter spacing (font_features.cc:39-50)
  and no line-end letter-spacing trim exists in line_breaker.cc, so no source reading explains the native line yet. The
  line reports no gap. Every line of this case overflows (18.92 px against glyphs of 11-13 px), so each is an emergency
  break: the port gives `111` / `1(` / `{t` / `ail`, natively code point 5 is on line 1 with the same line count. With the
  fixture font through `hb-shape` (HarfBuzz 14.2.0, not Chrome's pin; liga, clig and calt off as letter spacing turns them
  off), `{` takes a −45-unit kern before `t`, which marks offset 6 unsafe to break, and a required substitution swaps its
  glyph by context (1283 alone, 1282 before another glyph) at the same 520-unit advance. So the reshape of `{` at the line
  end differs from its position only by the kern, as the port models it. The case stays without a line-local gap in r2-e,
  the only one of the triage population's 422 prediction failures.
- 1 au of reshapes and positions, ligatures at emergency breaks: `ffiffl` in ProbeShantell and `office`, `affinity` in
  Shantell Sans fit one more `f` natively, where Blink gives characters inside a ligature glyph the glyph's position
  (shape_result.cc:2113-2200). r2-d reported nothing on those lines; the working tree reports `glyph-clusters` where a
  pair window in the content the decision measured past the line's end, under the style's own break type, adjusts
  otherwise with ligatures off. Replayed from `capture-4c` (13 triage cases): the 10 ligature cases (`ligature-thresholds-v3`
  4, `word` 3, `mixed` 2, `space` 1) report `glyph-clusters` on their failing lines, and predictions are unchanged. With
  break-character mode the decision's end was one grapheme past the line, which holds no pair window, so the look-ahead
  takes the next break opportunity under the style's own break type.

## measureText calls

`prediction.measure.calls` per row (calls that reached Canvas; the per-layout memo answers repeats) and `timings.predictMs`
per row, fix-r10 forward runs (feature families: fix-r5). Not optimized (CHARTER tentpole 8).

| Set (cases) | mean calls | median | p95 | max | mean predict ms | max predict ms |
|---|---:|---:|---:|---:|---:|---:|
| smoke (299) | 79.1 | 66 | 213 | 293 | 0.73 | 17.0 |
| ws (1,019) | 72.4 | 76 | 119 | 241 | 0.35 | 4.5 |
| policy (1,606) | 79.8 | 69 | 169 | 231 | 0.39 | 4.2 |
| runs (2,580) | 123.2 | 113 | 239 | 584 | 0.56 | 18.8 |
| suite sample part 0 (5,000) | 59.3 | 21 | 197 | 348 | 0.25 | 4.3 |
| rule families (10,976) | 32.1 | 30 | 58 | 89 | 0.13 | 4.0 |
| triage population (8,933) | 128.8 | 138 | 254 | 348 | 0.51 | 10.2 |
| suite sample part 3 (4,999), fix-r12 | 34.6 | 11 | 24 | 20,846 | 0.85 | 1,874.3 |
| feature families (12,722 laid out) | 34.9 | 34 | 56 | 57 | 0.11 | 3.9 |

fix-r5 to fix-r10 added about 0.5 calls per paragraph in smoke and suite part 0 (the U+2060 strings fix-r8 keeps in
segmented paragraphs make more strings distinct). fix-r12's view bookkeeping measures nothing: every set's calls equal
fix-r10's. Suite part 3 holds the slowest paragraph seen, 20,846 calls and 1.9 s; not investigated (performance comes
later).

The pre-charter port measured 47.6 (smoke), 38.8 (ws), 47.3 (policy) and 68.6 (runs) calls per paragraph (git history of
this file). The added calls come from the gap checks, which measure the pair window at every chosen line edge, and fix C,
which measures once per script segment a range crosses. Justification measures nothing.
