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

## Round 4c

Pinned Chrome 153.0.8010.50, scorer 7, 2026-09-18: the two Blink rules research/PREWRAP-RICH.md found. The baseline is the
merged round 4b tree (7567cf3), recorded on the tier 2 sets in both configurations and both orders and frozen as a private
tier 1 reference (`.artifacts/tests/runs/r4c-ports/`: `base/`, `fixed/`, `replay/`, `tier1/`, `rich-prewrap/`, `set-rich/`).

1. **A box that bidi reordering splits** (`blink/output/box-fragment-edges`, inline_box_state.h:328-332): round 4b's fix, read
   again here and registered with its annotation; nothing to port. On the rich pre-wrap set its cases hold no differing
   value.
2. **EndOffsetForJustify** (`blink/output/end-offset-for-justify`). `UpdateTextAlign` takes it from
   `ComputeTrailingSpaceWidth`'s own walk (line_info.cc:275-288, :289-415): back over the item results, skipping items
   opaque to collapsing, passing results that are only trailing spaces, and stopping inside the last text before its hanging
   spaces. The port had a loop of its own that stopped at the first result that wasn't only trailing spaces, a close tag
   included, so preserved spaces that fit before a box end, with more trailing spaces after it, were counted and expanded
   as justification opportunities. `hangWidthOf` is now `trailingSpacesOf`, which returns the width and the offset from one
   walk, and `applyJustification` takes the offset. `c-bb8068601ab36af7`: `alpha beta ` is 111.906px natively and was
   86.344px. Only positions moved; the hang width was right.

| Check | Result |
|---|---|
| `bun test rebuild` | 716 pass (1 new Blink test, `lines.test.ts` "blink round 4c"; 3 Gecko) |
| tier 1, 65,351 cases, either configuration | 65,351 the same: no tier case holds preserved spaces across a box end under justify |
| tier 2, both orders, either configuration | 0 status transitions against the baseline's ledger; differing predicted values equal (0 in cases failing no metric) |
| rich pre-wrap (1,334 cases), with facts | differing predicted values 126 in 8 cases, 7 of them failing no metric, to 1 in 1 case (`c-a37545c096e939be`, below); statuses unchanged: lineCount 1,334, breaks 1,333, widths 1,221 pass and 0 fail |
| rich pre-wrap, no facts | the same 7 cases (6 `trailing-spaces`, 1 `newlines`): limited values that differ 422 to 297 |

Left on the rich pre-wrap set, all in the known tail (`rebuild/tests/known-tail.json`): `c-a37545c096e939be`, the set's one
open row (a pre-line span whose only text is a trimmed space reports a zero-width rect natively; an observation port rule,
every code point is on the right line); 12 differing rect counts of spans without a box fragment (`<wbr>` inside one, the
font height stand-in); 63 limited `tab-stops` values in RTL tab runs. `rich-prewrap` is a tier set since this round.

## Round 4b

Pinned Chrome 153.0.8010.50, scorer 6, 2026-09-18, from the worktree branch `r4b-blink` on the merged round 4a tree
(584e359). A trimmed round: defects that give wrong lines or wrong exact values without warning, and the headline
configuration, which has no supplied font facts (`baselines/no-facts-predictor.ts`; the library asks Canvas what
`src/measure/font-checks.ts` can answer). The checks are lab/README.md's tiers: `bun test rebuild`, the offline replay, and
`rebuild/tests/browser-sets.ts` over the 13 sets (65,351 cases). Runs are under `.artifacts/lab/blink/r4b/`: `tier2/<name>`,
`tier1/` (replay reports), `reference/` (private replay folders, below) and `tools/`.

The frozen references describe round 3's library, and the no-facts one can't replay at all since the font checks ask
questions it doesn't hold (65,351 of 65,351 cases). So the offline replay ran against private copies: the facts reference
frozen again at 584e359, and a no-facts recording of this branch (`tier2/i1-no-facts`, both orders) packed and frozen into
`reference/chrome-no-facts-r4b`, where all 65,351 cases replay exactly. A change then shows as the cases it moved.

### Items

1. **System UI text that failed under `page-history` without page history** (ROUND3-CRITIC item 1: 28 of 28 rows fail the same
   alone in a fresh process; all are 16.8px). The cause is the platform font's size. `FontDescription::EffectiveFontSize`
   floors the computed size to 1/100 px in float32 (`font_description.cc:271-282`), and it is the size the platform font is
   made at and cached under (`font_cache_mac.mm`, `font_cache_key.h:53-68`). Canvas has no zoom, so the port's CSS-size font
   is `floor(f32(S) × 100) / 100` and the DOM's is `floor(f32(S × zoom) × 100) / 100`: 16.8px is 16.79px and 33.59px, a
   ratio of 2.0006, where 13.33px is 13.33px and 26.66px (in float32, `13.33f × 100` rounds to 1333 and `16.8f × 100` to
   1679.9999). The optical size is the same on both sides: both set `opsz` from the specified size
   (`font_platform_data_mac.mm:170-178`; `VariableAxisChangeEffective` compares clamped values, so Canvas's 16.79px font,
   which Core Text made at the clamped 17, isn't cloned and the DOM's is), HarfBuzz's `ptem` is the specified size
   (`harfbuzz_face.cc:639-648`), and Skia takes the `trak` table out of its advances (`SkCTFontCreateExactCopy.cpp:33-39`,
   `:74`, read in the chromium-152 checkout; Skia isn't in the 153 one). So the DOM's advances are the CSS-size font's times
   the ratio of the two platform font sizes, and `styleContexts` scales by that instead of the zoom. The critic's probe values
   follow: Canvas gives `Hello world again and more` 204.680374px at 16.8px, whose 16.16 total times 33.59 / 16.79 is 26,207
   LayoutUnits after the ceiling, 204.742188px, the DOM's width (times 2: 26,200 units, 204.6875px); 17.3px gives the DOM's
   210.078125px the same way, and at 13.33px and 16px the ratio is 2. The ratio is kept as a float32, so its products with
   Canvas's 16.16 totals are exact doubles and the pair and safe tests, which compare differences of measured totals with 0,
   stay exact; `raw16Of` no longer rounds the product. Letter spacing in such a context is the CSS value times the zoom over
   the ratio, so that the scaled total holds the DOM's spacing.
   All 64 `rule/system-fonts-and-sizes` rows at 16.8px pass the four metrics in both configurations (lineCount 8, breaks 24,
   widths 40 and painter 64 statuses moved to pass), and so do the critic's 28 rows run alone (`item1/critic-28-facts`).
   - *What `page-history` says now.* The effect is real (the font cache key lacks the specified size the `opsz` axis is set
     from, Chromium #489579956, rebuild/platform-bugs/LEDGER.md facet A), but it is a state of the renderer process, not of
     this text. It is a paragraph gap without a range (src/model.ts: such a gap "concerns the environment or a font as a
     whole"), so it covers no line by where it is, and the lab's both-orders and isolation protocols stay the check of whether
     a row is history-dependent. It covers no row on any set now (round 3: 72 statuses).
   - *What the scaled recipe is.* A stand-in: Blink truncates each glyph's advance to 1/65536 px at its own size
     (`skia_text_metrics.cc:207-211`), so a sum of scaled advances can be a few units off the DOM's. It shows at sizes where
     advances have a fraction of a unit: of 2,860 values under it at 13.33px, 4 are one LayoutUnit off in passing cases
     (`c-3ec3cd2536bf85bf`: `o` is 1110 units natively and 1109 scaled), none at 13, 16.8, 17 and 20.5px. The layout reports
     it as `optical-size` over the run, with the fact given too, so those values are limited, not predicted.
2. **Pair adjustments whose side isn't known** (the font-checks owner's 43 rows; 72 on the tiers' sets: `rule/text-align`
   64, `rule/in-word-breaks` 4, `rule/following-space` 2, `runs/split-word` 2). With no `pairKerning` fact the port puts a
   pair adjustment on the first glyph, where the kern and kerx machine gives each glyph half (`hb-kern.hh:102-106`). The values
   were limited already (`positionLimit`), but a line reported the condition only at its edges, so a width that differs
   inside the line had no gap that touches it: the hanging space after a reshaped `LYAY` keeps its half of the kern with
   `Y` (593 units natively, 640 predicted), and in `x AVAV…` every pair moves a share to its neighbour. `shapeOf` now reports
   `unsafe-to-break` over the two clusters around every cluster boundary of a line whose position takes an adjustment
   (`positionAdjust16`) that falls to the pair kerning rule (`adjustmentSide`: not HanKerning's, not beside a re-queued
   U+3000) in a font without the fact. All 72 rows are covered; they still fail, because no Canvas measurement shows the side
   (FACTS-FREE.md). It asks Canvas nothing new (0 new questions in the replay; memo hits rise by about 13%), and it costs
   signal: `unsafe-to-break` fires on 10.15% of passing lines with no facts (4.93% before), lift 4.99 (8.89).
3. **The headline configuration end to end** (no supplied facts, both orders, `tier2/i4-no-facts`, commit 0f64b3a):

   | Metric | Pass | Fail, covered | Fail, open | Unobserved |
   |---|---:|---:|---:|---:|
   | lineCount | 65,007 (99.47%) | 344 | 0 | 0 |
   | breaks | 64,937 (99.37%) | 414 | 0 | 0 |
   | widths | 61,590 (99.02%) | 607 | 0 | 3,154 |
   | painter | 59,055 (98.05%) | 1,169 | 3 | 5,124 |

   No case is history-dependent. Passing cases that hold a wrong predicted value: 0 in both orders (2 before: Courier New's
   lam before alef in an RTL item, below). 10.5% of values are predicted and 99.954% of them agree; the 265 that differ sit
   in cases whose lines fail. With the lab's facts (forward, `tier2/i4-facts`): lineCount 65,071, breaks 65,034, widths 61,976
   pass, no open prediction row, 5 open painter rows, and passing cases with a wrong predicted value 11 → 0 (below).

Found on the way, each a wrong exact value without warning:

- **A rect whose carets meet, in an RTL item** (`c-82fdb6df09ca942f`, `c-ba72f46bea4d347c`, no facts). The observation port
  gave the left edge of a rect without width the start caret's limit. In an RTL item the left edge is the end caret: the port
  gives Courier New's lam before alef no advance, natively the lam is half the ligature wide, and its x is the stand-in
  caret between the letters. `localRect` now takes the left edge from the item's direction where the carets meet.
- **A rect of negative width** (10 passing cases with facts: `suite/negative-space`, `suite/spacing-tail`,
  `suite/space-context-emoji`, `runs/word-spacing-spans`). A hanging space under negative letter or word spacing is an item
  of negative size (`UpdateShapeResult` doesn't clamp it, `line_breaker.cc:2409-2416`), and its whole rect goes through
  `gfx::RectF`, whose size clamps a negative width to 0 (`ui/gfx/geometry/size_f.h:30-31`, `:108`; `layout_text.cc:634-637`).
  The port reported −199 units where Chrome reports 0 at the same x.
- **A box fragment made by reordering** (`c-7d2264227b2141ba`, `rule/nowrap-spans`). A span split in two on one line (its
  hanging space goes to the line's left in an RTL block) gave the text fragment both paddings: the port copied the box's
  edges into the fragment, where Blink copies the item and rect alone (`BoxData(other, start, end)`,
  `inline_box_state.h:328-332`) and then moves the line-right edge to the last fragment. 9 code point x values and an
  element rect were 512 units off.

### Runs

| Run | Configuration | Library | Against | Transitions from pass | Notes |
|---|---|---|---|---:|---|
| `tier2/i1-no-facts` | no facts, both orders, recorded | 72da3b4 (item 1) | round 3's reference ledger | 0 | 72 open widths, 4 open painter rows |
| `tier2/i3-no-facts` | no facts, both orders, recorded | fba0805 (items 1, 2) | `i1-no-facts` | 0 | 72 open → covered; 149 transitions, all coverage |
| `tier2/i3-facts` | facts, forward | fba0805 | round 3's reference ledger | 0 | system UI rows to pass; 11 passing cases with a wrong predicted value |
| `tier2/i4-facts` | facts, forward | 0f64b3a | `i3-facts` | 0 | 1 transition (unobserved → pass); wrong predicted values in passing cases 0 |
| `tier2/i4-no-facts` | no facts, both orders, recorded | 0f64b3a | `i3-no-facts` | 0 | 1 transition (unobserved → pass) |

Offline replay of the final tree: with facts 2,373 cases differ from 584e359 (gaps 1,311, observation states 1,017, the 32
system UI geometries, the 11 rect widths and the one box), no case asks a new question beyond the 362 the round 3 recording
lacks. `bun test rebuild`: 689 pass.

### Fresh sets

The cap of 2 is used. Both orders, every generator kind.

| Set | Configuration | Cases | Prediction failures | Covered | Open | History-dependent | Passing cases with a wrong predicted value | Values agreeing | Values predicted |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `r4b-blink-1` | no supplied facts | 11,153 | 135 | 135 | 0 | 0 | 0 | 99.983% | 13.4% |
| `r4b-blink-2` | the lab's facts | 8,150 | 59 | 59 | 0 | 0 | 0 | 99.979% | 73.0% |

No new class. Set 1's 40 system font rows at new widths pass every prediction metric, the 8 at 16.8px among them. One
painter-only failure without a covered explanation in set 1 (`c-a478ac522795712e`, Courier New, one unit), none in set 2.
`unsafe-to-break` fires on 9.93% of set 1's passing lines (lift 6.19) and 3.77% of set 2's.

**Chrome's `Range.getClientRects()` hang came back** (round 4's bug report above). Set 1's part 2 stalled in both orders, in
the round trips that hold `c-a3f33be07d5b57aa` (forward; `…我說不清。」`, 20px sans-serif, 12px wide, `overflow-wrap:
break-word`) and `c-8957ae80bbdcdfdf` (reverse; `“引号”在…各不相同。`, 20px PingFang SC, 12px wide): `policy/zh-lang` cases
in a block between half an em and one em wide, like round 3's `c-1fda71ce84fd9989`. Neither order reached the cases between
them, so the five `policy/zh-lang` cases of that kind in the part went to `parts/excluded-native-hang.ndjson` (those two,
`c-dba6b75cf18717f9`, `c-0009dd3739b3ce85`, `c-0c83aa4c797f9e6e`), unverified one by one, and the two changed jobs ran once
and finished. Set 2's two such cases (`c-6893cc4de0825d6c`, `c-3229d7904410f2ae`) were set aside before its run. The
second hanging text has no pair of closing marks, so round 4's reduction names less than the bug: 79 other cases of the two
sets with a fullwidth mark in a block that narrow ran without a stall, `suite/maintained/kinsoku-units` with `」。」` in
16px Hiragino Sans among them.

### Known tail

Not worked on in this round; for the ledger's backlog.

- **`pairKerning` has no Canvas check.** The 72 rows above stay failures under `unsafe-to-break` with no facts:
  `rule/text-align` 64 (`c-0f3ea3e4202d62d0`, `c-2ed8c1519b0bff81`, `c-07edc35c22f24f4d`, …), `rule/in-word-breaks`
  `c-221292d7b03d9b88`, `c-40b62b718c49e524`, `c-63aa7548036970e9`, `c-d5d2808e238b8518`, `rule/following-space`
  `c-71ad21a18a8a0713`, `c-8c90eb487b92aa73`, `runs/split-word` `c-638e24bb090f9fb0`, `c-c4af3814fc390dbd`. They pass with
  the fact. The new in-line condition could be narrowed to pairs whose halves land in other LayoutUnits.
- **Stand-ins inside a line under a known `pairKerning`** (the pair window differs from the wide one, or liga, clig and
  calt change it) and beside a U+3000 without a coverage fact limit their values but report no gap inside the line, as the
  unknown fact did before this round. No failing row is known.
- **The scaled recipe's `optical-size` range is the whole run.** It could be the values within the truncation bound of a
  LayoutUnit edge (one unit and the ratio per glyph). Rows that show the class: `c-3ec3cd2536bf85bf`, `c-6f9d2063f8bcb5c8`,
  `c-c20059999b74e9ca`, `c-dd72cd90c56b7d64` (13.33px, one LayoutUnit, passing). Letter spacing under the recipe is Canvas's
  at the CSS size scaled, up to the ratio in units per character off; no lab row has it at a size whose ratio isn't the zoom.
- **`optical-size` with the fact unknown** still covers by position in fonts the font checks can't settle (a primary family
  without Latin letters, the system UI font): `c-56d1c38e222bf938` (`runs/split-word`, breaks), `c-906c6bc491c83c9d`,
  `c-a52d0bfda6f53a43`, `c-f1877e45ed22478e` (`runs/bidi-runs`, widths), each with `glyph-clusters`.
- **The library's own Canvas fonts and the platform font cache.** Measuring the system UI font at CSS size S makes the
  platform font that DOM text of S ÷ zoom px then takes (Chromium #489579956), and DOM text made first decides what Canvas
  measures at S. The lab has no pair of system UI sizes S and S × zoom in one process; the font-checks owner's note on the
  16px check font is the same hazard.
- **Weak coverage, no facts:** 15 failures are covered only by conditions with a lift below 2 (`glyph-clusters` 14,
  `tab-stops` 1); `script-context` fires on 32% of passing lines and `glyph-clusters` on 11%, both waiting for facts Canvas
  doesn't give (`scriptLookups`, ligatures).
- **Painter rows without a covered explanation** (no owner this round): no facts `c-a8c35abaa8a6f148` (`ws/text-nodes`),
  `c-333dbe214aac1431` (`suite/hanging-MEDIUM`), `c-fa9b31d5a0b9eaf0` (`suite/missing-THIN`); with facts those and
  `c-f98e572a561533c6` (`runs/span-at-space`), `c-8a054eb23d6b5e16` (`suite/rejected-control`); fresh `c-a478ac522795712e`.
- **Chrome's hang** isn't characterized: the lab needs a rule that sets such cases aside before a run, or a native
  observation that survives it.
- **Citations outside the 153 sparse checkout:** `ui/gfx/geometry/size_f.h` and Skia's `SkCTFontCreateExactCopy.cpp` were
  read in the chromium-152 checkout.
- From round 4, unchanged: `positionAdjust16` stays a registered heuristic; the 4 ProbeShantell and 3 `suite/space` rows
  fail under `in-word-prefix`; U+FFFC and clusters split across spans stay under `font-fallback`.

### Gap firing on passing lines, no supplied facts (all 13 sets, 225,771 passing lines)

| Condition | Passing lines | Failing lines | Lift | Covers |
|---|---:|---:|---:|---:|
| `script-context` | 32.39% | 52.48% | 1.62 | 548 |
| `glyph-clusters` | 10.96% | 16.56% | 1.51 | 171 |
| `unsafe-to-break` | 10.15% | 50.61% | 4.99 | 478 |
| `in-word-prefix` | 3.66% | 4.58% | 1.25 | 38 |
| `optical-size` | 3.45% | 0.37% | 0.11 | 4 |
| `soft-hyphen-shaping` | 1.38% | 4.58% | 3.33 | 20 |
| `tab-stops` | 1.37% | 0.09% | 0.07 | 1 |
| `float32-precision` | 1.32% | 0 | 0 | 0 |
| `font-fallback` | 0.71% | 51.36% | 72.42 | 541 |
| `control-character-width` | 0.40% | 0.09% | 0.24 | 0 |
| `han-kerning` | 0.35% | 0 | 0 | 0 |
| `joining-technology` | 0.05% | 0.19% | 3.64 | 2 |

1,021 prediction failures, all covered, 15 of them only by conditions with a lift below 2 (`glyph-clusters` 14, `tab-stops`
1). `page-history` fires on no line: it has no range. On the development sets alone `unsafe-to-break` is 12.56% and
`script-context` 45.36% (`bun rebuild/tests/ledger.ts conditions <ledger> --groups=development`).

## Round 4

Pinned Chrome 153.0.8010.50, scorer 5, forward order, 2026-09-18, from the worktree branch `r4-blink`. Every job ran a frozen
copy of the library and the lab (`scratchpad/r4-blink/builds/<build>`); rows are under `.artifacts/lab/blink/r4/<build>/<set>/`
(b8 plain, older builds compressed), fresh sets under `.artifacts/lab/fresh/chrome/r4-blink-<n>/`. The sets are round 3's
(`dev-flat`, `dev-suite`, `families`, `features`, `heldout-small`, `heldout-suite`, `triage-small`), and the baseline for
transitions is round 3's last build, w18, whose Blink engine and lab equal the evaluated tree's.

| Build | What changed |
|---|---|
| b1 | Line-end fit tests that another last safe offset turns around (item 1); U+3000 in a font without it (item 2); stand-in positions out of order (item 3) |
| b2 | Pair adjustments in a run HarfBuzz shapes reversed (item 4); the caret code's grapheme lists per view part (item 5) |
| b3-b4 | The item's shape as the caret code reads it: characters by count, runs, float sums per run (items 5, 6); `runs` and `partsKnown` in the geometry |
| b5 | Float sums exact by the advances' granularity (item 7); the clamped start correction (item 8) |
| b6 | The clamped start reported only where the other outcome makes another line |
| b7 | HanKerning's halt on the character Blink picks; parts unknown where only the joining rule makes an offset unsafe; listed ligatures across combining marks (items 9, 10) |
| b8 | The cut of an RTL view whose start reshape may be longer natively (item 11) |

### Against round 3

b8 against w18, outside history dependence (no Chrome case is history-dependent). No line count, break or width that passed
in w18 fails on any set. `triage-small`: breaks fail→pass 24 and widths not-applicable→pass 24, all `suite/joined` (item 10);
painter fail→pass 11 (paint.ts changed after w18). Every other prediction status is equal on all 73,260 cases.

Passing cases that hold a wrong predicted value, w18 → b8: dev-flat 2 → 0, dev-suite 16 → 0, heldout-small 5 → 0,
heldout-suite 28 → 0, triage-small 7 → 0, families and features 0. Differing predicted values in all (the rest sit on
failing lines): dev-flat 35 → 30, dev-suite 83 → 28, heldout-small 20 → 6, heldout-suite 109 → 30, triage-small 243 → 186,
families 495 and features 11 unchanged. Predicted share: dev-flat 69.8% → 70.3%, dev-suite 59.2% → 59.7%, heldout-suite
45.2% → 45.0%. Canvas calls per row are unchanged (dev-flat mean 132.6, dev-suite part 0 110.2, heldout-suite part 0 117.9).

### Items

1. **An exact-fit break in ProbeShantell under letter spacing** (the evaluation's class a, 4 rows). Natively `offic` is one
   reshape from the line's start, 33.98398 px in 33.984375, because HarfBuzz flags every offset of this font unsafe (round 3
   item 4). The port's width tests call offset 4 safe, so it reshapes `c` alone after that offset's ceiled position, 1602,
   and 573.44 units don't fit 573. Blink's test is `line_end_result->Width() <= end_position - safe_position`
   (shaping_line_breaker.cc:543-553): with equal glyphs another last safe offset changes it only by the ceiling of that
   offset's position, less than a LayoutUnit, and an uncertain first safe offset of a wrapped line start moves the end
   position by a LayoutUnit the same way (:309-324). `recordEndTest` computes both bounds in 16.16 units for every fit test
   and keeps the ones that could go the other way; the line reports `in-word-prefix` over the text the test decides (from
   the line's end to the opportunity given up, or the last opportunity to the line's end). The port can't learn the flags,
   so the rows stay failures, covered. Round 3's margin rule in `edgeGap` missed them because it measured the margin to the
   next opportunity under the style's own break type and from paragraph positions, where the test that failed was a
   reshape's under break-character.
2. **U+3000 kerned with the next line's first letter** (class b). Times New Roman has no U+3000: HarfBuzz's normalizer puts
   the font's space glyph there (hb-ot-shape-normalize.cc:174-186), the kern machine kerns it with `T`, and Blink counts
   that glyph as missing, "HarfBuzz synthesizes U+3000 IDEOGRAPHIC SPACE using the space glyph. This is not desired for
   run-splitting" (HarfBuzzShaper::ExtractShapeResults, harfbuzz_shaper.cc:598-606). U+3000 goes to a fallback font at one
   em, `T` keeps its half of the kern, and `T` is a run's first glyph, safe to break before whatever HarfBuzz flagged
   (SafeToBreakBefore, shape_result.cc:1361-1369), so the wrapped line start isn't reshaped. Canvas shapes the same way, so
   the adjustment its totals show beside U+3000 is what the neighbour kept. `requeuedSpaceAt` reads the coverage fact of the
   listed family that draws the neighbour: the adjustment sits on the neighbour, the offset is a run edge, the position is
   exact. Without the fact a line edge there reports `font-fallback` over U+3000 and the neighbour. `isFontRunEdge` makes
   every run start the coverage facts show safe to break. The row passes lineCount, breaks and widths; the painter, which
   lays the line out alone, paints `T` without the kern (PAINTER note below).
3. **An emergency break after a marked waw in Geeza Pro** (class c). The port's position of offset 18, inside lam-meem, is
   a Canvas stand-in 118 units right of offset 16's exact position. Blink finds the candidate by binary search over sorted
   positions (CachedOffsetForPosition, shape_result.cc:2300-2318); over the port's unsorted ones the search landed on 18
   although offset 16 already lay past the end position. A safe offset at or before the candidate never lies past the end
   position natively (`end_position - safe_position` is a width), so where the port's does, the search runs again below
   it, and what the first search reported is dropped. The row passes every metric.
4. **Pair adjustments in an RTL run of a left-to-right script** (`suite/signed-spacing/ascii-matrix`, 17 passing cases with
   a wrong predicted value). HarfBuzz reverses a buffer whose direction isn't its script's and shapes it in the script's
   direction (hb_ensure_native_direction, hb-ot-shape.cc:588-644), so between two quotes in an RTL paragraph the first
   glyph of the pair is the logically later one: natively the second `‘` is the narrow one. `shapedReversed` has the rule
   with HarfBuzz's script list (hb-common.cc:520-612) and the digits exception, and `pairBefore16` places GPOS values and
   the kern machine's halves by it.
5. **Blink's grapheme lists come from the view's part numbers** (`suite/raw-context` 8, `runs/bidi-runs`). The caret code
   copies the view into a ShapeResult whose runs keep the parts' numbers (CreateShapeResult, shape_result_view.cc:182-212)
   and lists each run's graphemes over the item text at the run's start_index_ (EnsureGraphemes, shape_result.cc:186-214).
   An RTL view of several segments numbers its parts in visual order, so a reshaped line end `بِ` after a NUL is listed from
   NUL and beh, two graphemes, and the letter and its mark report halves. PositionForOffset finds a character by counting
   the runs' characters (:696-733), so after a second cut a glyph can stand for another character: `نِ` and a trimmed space
   at a wrapped line start in Geeza Pro report the letter's glyphs for the letter and the space's glyph for the mark. `shapeOf`
   (index.ts) builds clusters per part with counted characters and `partGraphemeStarts`; a character no run counts reports
   position 0.
6. **Carets add run widths as floats** (`policy/word-break`, `runs/word-spacing-spans`). PositionForOffset adds the widths
   of the runs before the caret's run as floats, so past 256 zoomed px a caret depends on where the runs are: 19 Katakana
   clusters from the paragraph plus a reshaped `ウェ` give a caret one float step under 792 px, natively 50687 and 2561 where
   one exact sum gave 50688 and 2560. The geometry has the runs (`BlinkShapeRun`: a view's part cut at script segments and
   font runs, with the reshaped text it came from), and the observation port sums per run. Where the runs aren't known
   (`partsKnown` false, a font the facts don't name) a value within the possible rounding of a LayoutUnit edge is limited
   by `float32-precision`. `reshaped` is also what the painter asked for: whether ShapeLine reshaped a part whole
   (`first_safe.offset >= break_opportunity.offset`) shows as one run reshaped over the line's text.
7. **`float32-precision` narrowed from arithmetic.** A float32 holds 24 bits, so sums of multiples of 2^g units are exact
   below 2^(24 + g) units wherever the runs are, and a run that ends below 256 px can't round at all. Arial, Times New
   Roman, Georgia, Verdana and Courier New have 2048 units per em: at a zoomed 32 px every advance is a multiple of 1024
   units and sums are exact below 2^18 px. The gap fires on 0.25% of passing development lines (w18: 5.69%) and 0.03% to
   0.07% of fresh ones, still on no failing line.
8. **The 3 `suite/space` triage rows** (Amiri `a` TAB `ب` SHY kasra `ب`, 1px). Traced: the start of the line at SHY is
   reshaped to the text's end, and ShapeLine adds the paragraph's width of that text to the space, less the reshape, clamped
   at 0 (shaping_line_breaker.cc:309-324). hb-shape on the fixture font gives the first `ب` 247 units in the paragraph and
   the last 772, where U+200D gives the port 190 and 829: natively the correction is 129 − 228, clamped, nothing fits, the
   normal pass overflows and the break-character pass ends the line after SHY with its hyphen. The port's 129 − 111 leaves
   18 units. The end position doesn't depend on the start's position unless the clamp applies, so the condition is narrow:
   a start whose reshape alone takes the space, at a stand-in position, and only where laying the line out the other way
   gives another line (`clampedStarts`). The line reports `in-word-prefix` over its text, which holds the decision text.
   The rows still count as open: the soft hyphen's copied rect makes the scorer attribute line 0, as with
   `suite/U+FFFC/start`.
9. **HanKerning's halt** goes to the character Blink picks from text_content in logical order (han_kerning.cc:235-300),
   before pair placement: in an RTL paragraph `」。` is an RTL run and `」` is the half-width one.
10. **Listed ligatures across combining marks.** The facts list lam-alef as whole strings, which the matcher compared
    without skipping marks; lam, kasra, alef is one glyph natively. 24 `suite/joined` breaks pass.
11. **The cut of an RTL view after a start reshape** (fresh set 2's open row, `c-a3b5719bcaf20813`). `حين. ` at a wrapped
    line start in Geeza Pro: the port reshapes `حين` up to its first safe offset, the view numbers the rest before the
    reshape, and cutting the trimmed space off takes `ن` with it (2533 units), exactly as shape_result_view.cc:215-308 does
    for those parts. Natively the width is the whole reshape's and the full stop's, 3762: HarfBuzz left no offset safe up
    to the item's end (a `morx` font's flags follow its state machine), so the reshape was one part. The line reports
    `in-word-prefix` over the item result where such a reshape ends at an offset that is safe by the port's tests alone.
    Round 3's class 4 is the same cut where the port reshaped nothing.

### Fresh sets

| Set | Seed | Build | Cases | lineCount / breaks / widths fail | Prediction failures | Covered | Open | Passing cases with a wrong predicted value |
|---|---|---|---:|---|---:|---:|---:|---:|
| r3-blink-4, run again | | b7 | 11,377 | 26 / 39 / 26 | 65 | 65 | 0 | 0 |
| 1 | r4-blink-1 | b7 | 11,242 | 21 / 26 / 33 | 59 | 59 | 0 | 0 |
| 2 | r4-blink-2 | b7 | 11,238 | 20 / 26 / 34 | 60 | 59 | 1 | 0 |
| 3 | r4-blink-3 | b8 | 11,199 | 18 / 24 / 36 | 60 | 60 | 0 | 0 |

Set 2's open row is item 11; it is covered under b8. The round's cap of three sets is used. Predicted values agree on
99.987%, 99.983% and 99.983%, every differing value on a failing case, and 72.6%, 73.8% and 72.5% of all values are
predicted. Round 3's last two sets held 24 and 9 passing cases with a wrong predicted value and the evaluation's three
11, 11 and 10; all 65 are exact under b4 and later.

**Without supplied font facts** (`lab/baselines/no-facts-predictor.ts`, b8, dev-flat and heldout-small, 10,484 cases): no
error, no passing case with a wrong predicted value, lineCount failures 5 and 2 (with facts 3 and 1), widths 16 and 17 (8
and 4), 9% of values predicted. U+3000's and the font runs' rules need the coverage fact; without it the edges beside
U+3000 report `font-fallback`.

**Giants.** The 9 held-out giants and the 5 of fresh sets r3-blink-2 and r3-blink-3, `--chunk=1`, b7: all 14 pass lineCount,
breaks, widths and painter, and no predicted value differs.

### Gap firing on the development sets

Passing lines of dev-flat and dev-suite (87,694) that report each gap, w18 → b8:

| Gap | Passing lines | Passing cases | Lift |
|---|---|---|---|
| `script-context` | 30.72% → 30.82% | 38.04% → 38.04% | 1.21 → 1.21 |
| `glyph-clusters` | 8.82% → 8.83% | 12.83% → 12.85% | 4.29 → 4.28 |
| `unsafe-to-break` | 4.97% → 4.90% | 7.11% → 6.85% | 7.90 → 8.20 |
| `in-word-prefix` | 1.58% → 1.61% | 2.97% → 3.04% | 0.76 → 0.74 |
| `font-fallback` | 1.26% → 1.27% | 2.54% → 2.57% | 22.99 → 22.74 |
| `float32-precision` | 5.69% → 0.25% | 11.06% → 0.83% | no failing case |

The new conditions by themselves, on passing development lines: the clamped start 28 lines (0.032%; 196 before it was
limited to starts where the other outcome makes another line), the line-end fit test 1 line (0.001%), `font-fallback`
beside U+3000 without a coverage fact 14 lines (0.016%), the cut after a start reshape none. On the fresh sets
`in-word-prefix` fires on 1.47% to 1.53% of passing lines (round 3's last sets: 1.5%).

### `positionAdjust16`, looked at again

No source reading places an adjustment that Canvas shows only as a sum over a window wider than the two clusters. A pair
value is placed by the font's tables (`pairKerning`, and now the buffer's order). Anything beyond it comes from
contextual lookups, which change the glyphs of a rule's input sequence and leave its backtrack and lookahead alone
(chain_context_apply_lookup, hb-ot-layout-gsubgpos.hh), and which glyphs are input is the font's. The rule the port
applies is one assumption used on both sides of a space: a space glyph keeps its advance, so what a wider context changes
beside a space changes the letters (before a space the letter before it, probe blink-round3 R1; after a space the text
after it, `ريال`). It stays a registered heuristic; such positions are marked stand-ins, and a line edge taken from one
reports `unsafe-to-break`.

### Chrome never returns from `Range.getClientRects()`

Reduced from `c-1fda71ce84fd9989` (probe `scratchpad/r4-blink/hang/probe.ts`, outputs
`.artifacts/probes/blink/round4-range-hang-*`): two fullwidth closing marks in a block between half an em and one em wide
that may break anywhere.

```html
<!doctype html>
<html lang="en">
<div id="t" style="font: 16px 'PingFang SC'; width: 8px; overflow-wrap: break-word">。』</div>
<script>
  const node = document.getElementById('t').firstChild
  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, 1)
  range.getClientRects() // never returns; the tab has to be killed
</script>
```

Chrome 153.0.8010.50, macOS 27.0 (26A428), arm64, device pixel ratio 2. Layout itself ends (the block is 64px tall, two
lines), and the hang is in the Range call over `。`. It also hangs at 10px and in Hiragino Sans. It returns with
`text-spacing-trim: space-all`, at 1px, under `word-break: break-all` without `overflow-wrap`, for `我。』` over `我`, and
over `』`, whose rect is then 32px wide, twice the glyph. So it takes the line-end trim of `。`, ShapeLine's
`han_kerning_end` reshape that lets the half-width `。` fit (shaping_line_breaker.cc:344-363), in a line that then holds
it alone. Not traced further. The lab sets such a case aside in its part's `excluded-native-hang.ndjson`.

### Open after round 4

- The 4 ProbeShantell rows (item 1) and the 3 `suite/space` rows (item 8) fail under conditions the port can't settle:
  which offsets HarfBuzz flags, and a contextual form's share of a joined pair. The `suite/space` and `suite/U+FFFC/start`
  rows need the scorer's attribution fixed to count as covered.
- `partsKnown` is false on most wrapped lines, because a start after a space isn't a run's first glyph. It costs nothing
  below 256 px or with 2048-unit fonts at whole sizes; elsewhere values within a float step of a LayoutUnit edge are limited.
- The painter lays a line out alone, so a first letter that kept a kern with a U+3000 on the line before it paints 18
  units wider (`c-0ee8c36920378f9f`, painter fails without a covered explanation). `BlinkShapeRun.reshaped` says the start
  wasn't reshaped; the painter has no limit for it yet.
- No unit test covers items 3, 5 and 11 (they need a stand-in Canvas with joined forms); the lab cases named above do.

## Ceiling round 3

Installed Chrome 153.0.8010.50 (source-identical to the pinned .48: `git diff --name-only 153.0.8010.48 153.0.8010.50` lists
chrome/VERSION alone and DEPS is unchanged; `env.ts` `SOURCE_IDENTICAL_BUILDS` accepts it, so rows no longer report
`engine-build`). Scorer 5 (a gap covers a failing line only by touching what differs there). Forward order only, as the
round's rules ask of owners. Every job ran a frozen copy of the library and the lab (`scratchpad/blink-r3/builds/<build>`,
with its own `run.ts`, so another owner's edit in progress never reached a run); rows are under
`.artifacts/lab/blink/r3/<build>/<set>/`, fresh sets under `.artifacts/lab/fresh/chrome/<seed>/`. Sets: `dev-flat` (smoke,
runs, ws, policy without the 225 ids they share: 5,279 cases), `dev-suite` (19,994), `families` (10,976), `features`
(12,882), `heldout-small` (held-out runs, ws, policy: 5,205), `heldout-suite` (10,000, its 9 paragraphs over 50,000 units in
a job of their own with `--chunk=1`), `triage-small` (8,933).

| Build | What changed |
|---|---|
| w1 | Canvas's per-word scripts (item 1 below), the .50 build accepted, `fontKey` as JSON, ICU's Default_Ignorable_Code_Point generated |
| w3 | Positions the layout can't know marked in its geometry (`startLimit`, `sizeLimit`) and read by the observation port; `glyph-clusters` or `in-word-prefix` at an item edge inside a shaping call; the untested-end condition (item 4); `in-word-prefix`'s window constant replaced |
| w4-w6 | The adjustment across an offset over the widest exactly measured window (rejected as the position's adjustment at joined offsets and after spaces, see "The adjustment window") |
| w7 | Ligature and coverage facts: a ligature's letters are one glyph cluster; a position is known only where the facts rule a ligature out |
| w8 | A view's float width summed per HarfBuzz run in visual order, runs from the script segments and the coverage facts |
| w9-w10 | `unsafe-to-break` where the break candidate rests on an adjustment no fact places; `glyph-clusters` for a listed ligature the facts don't settle on a line that breaks between clusters |
| w12 | The observation port limits both edges of a rect whose carets run against the item's direction; atomic inline margins in visual order |
| w13 | RunSegmenter's emoji segments (`emoji.ts`): a HarfBuzz continuation merges only inside its own shaping call |
| w15-w16 | `script-context` reported for the strings the layout measures, narrowed by the `scriptLookups` fact and for default-ignorable characters |
| w17-w18 | The candidate condition over the two clusters it concerns; the untested-end condition at every wrapped line start; the truncated RTL start condition |

### Against round 2

w18 against the round 2 evaluation's forward rows (`evaluate-r2/chrome`), outside history dependence. No line count, break or
width that passed in round 2 fails on any set.

| Set (cases) | lineCount | breaks | widths |
|---|---|---|---|
| dev-flat (5,279) | – | fail→pass 1 | not-applicable→pass 1 |
| dev-suite (19,994) | fail→pass 5 | fail→pass 5 | fail→pass 1, not-applicable→pass 4, not-applicable→fail 1 |
| families (10,976) | fail→pass 10 | fail→pass 25 | fail→pass 4, not-applicable→pass 25 |
| features (12,882) | – | – | unobserved→pass 1,922 (scorer 5 observes indented lines) |
| heldout-small (5,205) | fail→pass 1 | fail→pass 1 | fail→pass 6, not-applicable→pass 1 |
| heldout-suite (10,000) | fail→pass 7 | fail→pass 10 | fail→pass 15, not-applicable→pass 9, not-applicable→fail 1 |
| triage-small (8,933) | fail→pass 88 | fail→pass 222 | fail→pass 2, not-applicable→pass 218, not-applicable→fail 4 |

The not-applicable→fail widths are cases whose breaks pass for the first time. Painter pass→fail: families 2 (`rule/joining`),
triage 6 (`suite/following-space-scope`), with the prediction unchanged on the same case; paint.ts changed between the
frozen builds (the painter owner's).

Predicted values that agree with the browser, round 2 → w18: dev-flat 99.390% → 99.991%, dev-suite 97.993% → 99.992%,
families 99.238% → 99.860%, features 99.951% → 99.998%, heldout-small 99.329% → 99.995%, heldout-suite 96.926% → 99.992%,
triage-small 98.689% → 99.973%. Cases that pass every prediction metric and hold a differing predicted value: round 2
2,030 on the development sets; w18 5 (dev-flat) and 17 (dev-suite). Most values that still differ sit on lines whose breaks
fail (`rule/object-replacement` 129 of the families' 149 cases).

### Items

1. **U+3000 inside Arabic under letter spacing** (`runs/word-spacing-spans`; the critic's probe). Canvas makes a PlainTextItem
   of every word and runs RunSegmenter over each alone (SegmentWord and NextWordEndIndex, plain_text_node.cc:93-155,
   372-425), and a word ends before a CJK ideograph or symbol base, so U+3000 between Arabic letters is Common in Canvas and
   takes letter spacing, where the paragraph keeps it in the Arabic run without any. `shape.ts` `canvasScriptsPerUnit` ports
   the word split. Whether a font is shaped word by word at all follows `Font::CanShapeWordByWord` (the space glyph in the
   primary font's GPOS or GSUB lookups under the contexts' optimizeLegibility, font_fallback_list.cc:264-286,
   harfbuzz_face.cc:341-390), which Canvas shows: `ب` U+3000 `ب` measures 1/64 px more under 1/64 px of letter spacing when
   words are split and the same when they aren't. Probe blink-round3 R2: Geeza Pro, Helvetica Neue, Georgia and Verdana split;
   Arial, Times New Roman, Courier New, Hiragino Sans, PingFang SC, Amiri, both Noto fonts, Shantell Sans and system-ui don't.
   All 8 rows pass every metric (5 fresh, 3 held-out).
2. **Ligatures across a span edge and inside items** (`c-906c6bc491c83c9d` and two more, `c-4a04b13ad0ab4062`). With the
   ligature facts (`FontFacts.fonts[].ligatures`, `ligatures.ts`) a listed ligature that forms in every context is one glyph
   cluster: its letters take one position, carets share its advance among its graphemes, no break falls inside it, and an
   item edge inside it gives the glyph to the item holding its first character. The three lam-alef rows pass widths and
   painter. A listed ligature that forms in some contexts only (Geeza Pro lam-lam-heh, lam-meem) stays a stand-in: the item
   edge reports `glyph-clusters` over the clusters around it (`itemEdgeGaps`), which covers `c-4a04b13ad0ab4062`'s one
   LayoutUnit. Without facts every position between two characters of one shaping call is a stand-in.
3. **In-word geometry reported as exact.** The layout marks a cluster start it can't know (`BlinkGlyphCluster.startLimit`)
   and an item end (`sizeLimit`): between letters HarfBuzz joins (`in-word-prefix`), where the facts don't rule a ligature out
   (`glyph-clusters`), where no fact places an adjustment (`unsafe-to-break`); `shape.ts` `positionLimit` has the source
   rule. The observation port reports a rect edge as predicted only where the layout knows the item's x and the position in
   the item: a gap on a character limits every position that sums its advance, and a limited size limits the x of what
   follows on the line (every x where the line's offset depends on its width). `in-word-prefix`'s two-cluster window is gone
   (the safe test reads the widest exactly measured window), and its 2 LayoutUnit margin is derived from ShapeLine's two
   ceilings (`edgeGap`).
4. **`c-8c84627af834611f` and `c-03316764a11a9d04`** (Shantell Sans `1111({tail`, −1px letter spacing, break-word). hb-shape
   on the fixture font flags every offset of the string unsafe to break: the font cycles alternates through a contextual
   chain that changes no advance. Blink then has no safe offset before the break opportunity, reshapes the whole range and
   takes it without a fit test (shaping_line_breaker.cc:497-506): natively `1({` is 2,430 units wide on a 2,422 unit line.
   The port's width tests call the offsets after `1` and `(` safe, so it runs the fit test, fails it and retreats. It can't
   know HarfBuzz's flags, so a line that retreats after a failed end-reshape fit test, at a wrapped line start with no
   shaping run edge before the opportunity, reports `in-word-prefix` over the text it gave up (`LineInfo.untestedEnds`).
5. **Chrome .50**, 6. **`fontKey`**: the fields were joined with a bare U+0001, which reads as `join('')` in most editors;
   now JSON, which also keeps a null locale apart from the locale `null`. 7. **Default ignorables**: ICU's
   Default_Ignorable_Code_Point is generated from ppucd.txt (`props.ts` `isDefaultIgnorable`; the hand-written ICU set was
   equal to it), `TreatAsZeroWidthSpace` reads it (it had read HarfBuzz's set plus extras and missed U+180F), and HarfBuzz's
   own switch stays ported as `isDefaultIgnorableHarfBuzz` (hb-unicode.hh:170-197).
8. **`script-context`.** It is reported where a string the layout measures resolves a character otherwise than the
   paragraph (`reportScriptContext` in `measure16`), not for every character that could be measured alone. It doesn't fire
   where HarfBuzz shapes the character alike under both scripts: the font that draws it (coverage facts) selects the same
   lookups for both (`scriptLookups`) and both take the default shaper (hb_ot_shaper_categorize, hb-ot-shaper.hh); or the
   character is default-ignorable, whose advance HarfBuzz zeroes under any script (hb-ot-shape.cc:779-799). Development
   sets, passing lines / passing cases: 51.06% / 75.98% (w1) → 30.72% / 38.04% (w18); fresh sets 19%. What is left: emoji and
   CJK punctuation drawn by a fallback font the facts don't name, and Common characters under scripts with a shaper of their
   own (Arabic, Hebrew, Thai, Myanmar, Khmer).

### The adjustment window

Round 2 took the adjustment across an offset from one glyph cluster on each side. Noto Nastaliq Urdu widens a word-final
letter before a space after some letters: `آگ` and a space measure 468 units more together than apart, `گ` and a space the
same (probe blink-round3 R1; natively `گ` is 3,436 units before a space and 2,968 at the end of text, and the space 338
either way). `windowAdjust16` measures the adjustment over the widest window around the offset whose Canvas total is exact
(the measured piece; halved toward the offset past 256 zoomed px), and the safe test reads it: whatever it shows, the two
sides shaped apart differ from the call, which is what HarfBuzz's flag means. Which side the adjustment sits on isn't in a
Canvas total. As the position's adjustment everywhere (w4) the wide window gained 11 development, 16 rule-family and 28
triage line counts, all at joined offsets, and lost 6 (`c-11abbf1905a0c6ef` and 5 more widths of it: after a space the
letters of `ريال` make one Rial glyph in Courier New's fallback and four measured alone, which is the text after the offset
changing). `positionAdjust16` takes the wide window before white space and the pair window elsewhere, and is registered as
a heuristic in CHARTER.md; where the windows differ and the offset isn't before white space the position is a stand-in and
a line edge taken from it reports `unsafe-to-break`. heldout-suite widths fail→pass 9 (w7 against w3).

### Classes the fresh sets and scorer 5 found

1. **One LayoutUnit on lines past 256 zoomed px** (`suite/maintained/corpus`, 6 held-out rows, uncovered under scorer 5). A
   view's width is the float sum of its runs' widths, one run per script segment and per stretch a fallback font draws
   (shape_result_view.cc:215-273, shape_result.cc:1539-1609), added in visual order; past 256 px the float32 sum rounds by
   where the runs are. Geeza Pro lacks `!` and `:`, which the next listed family draws. `floatWidthOfParts` sums per run with
   the font runs the coverage facts give; all 6 rows pass. Where a font isn't named by the facts and the exact total is
   within the possible rounding of a LayoutUnit edge, the line reports `float32-precision` (5.69% of passing development
   lines, 0.95% of fresh ones).
2. **`ب` SHY `ب` in Amiri under break-word** (2 fresh rows of set 1, 4 development and held-out rows that `script-context` on
   the SHY had covered). The two letters measure 111 units less together than their joined forms apart; the port put it
   all on the first, so the first fit a space it doesn't fit natively. Which glyph carries it isn't in a Canvas total and
   Amiri has no `pairKerning` fact: the line reports `unsafe-to-break` over the two clusters where the space left ends
   between the two places the position could be (`positionBounds`, `reportUncertainCandidate`).
3. **A listed ligature that forms in some contexts only, on a line that breaks between clusters** (`suite/joined`, 3 triage
   rows): Courier New draws `لله` as one glyph after some letters, the prefixes don't, and positions ran backwards. The line
   reports `glyph-clusters` over the ligature.
4. **`ك` 0 wide at an RTL wrapped line start** (`c-a7d036caa5cf8f42`, set 4): class 3 of round 1 (the RTL view's part numbers)
   at a start the port's tests call safe, after Geeza Pro's lam-alef. Reported as `in-word-prefix` over the first cluster of
   a wrapped RTL line start inside a shaping run whose item result the line cuts again.
5. **Atomic inline margins in an RTL block** (`rule/atomic-inlines`, 48 cases per fresh set, element rects only):
   ComputeLineMarginsForVisualContainer takes the physical margins in visual order (length_utils.h:555-567). Fixed; features
   99.951% → 99.998% of predicted values.
6. **A ZWJ after an emoji with nothing to join** (`suite/woman-after-zwj`, 106 passing development cases with a wrong
   predicted value): RunSegmenter's emoji scanner ends the emoji run before the ZWJ, so the ZWJ starts another shaping call
   and a cluster of its own. `emoji.ts` ports the scanner (emoji_presentation_scanner.rl) and the segment edges.
7. **Carets against the item's direction**: a stand-in advance can come out negative (Geeza Pro lam before meem), which
   swaps the rect's edges; the port limits both then.

### Fresh sets

`bun rebuild/lab/fresh.ts --browser=chrome --seed=<seed>` from the frozen build's tree.

| Set | Seed | Build | Cases | lineCount / breaks / widths fail | Prediction failures | Covered | Open | Classes found |
|---|---|---|---:|---|---:|---:|---:|---|
| 1 | r3-blink-1 | w8 | 11,441 | 27 / 33 / 32 | 65 | 65 | 0 | class 2 above (covered only by `script-context` on another character) |
| 2 | r3-blink-2 | w10 | 11,442 | 29 / 38 / 26 | 64 | 64 | 0 | classes 5 and 7 (predicted values), a Chrome hang (below) |
| 3 | r3-blink-3 | w13 | 11,417 | 38 / 47 / 44 | 91 | 91 | 0 | none |
| 4 | r3-blink-4 | w17 | 11,377 | 26 / 39 / 26 | 65 | 63 | 2 | item 4's second width and class 4, after `script-context` was narrowed |
| 5 | r3-blink-5 | w18 | 11,386 | 18 / 27 / 31 | 58 | 58 | 0 | none |
| 6 | r3-blink-6 | w18 | 11,375 | 18 / 29 / 29 | 58 | 58 | 0 | none |

Sets 5 and 6 are the two in a row without a new class. Their failures by covering gaps: `font-fallback` 36 and 39 (U+FFFC,
which Canvas turns into U+200B), `font-fallback` with `script-context` 8 and 6, `page-history` 8 and 8 (system fonts), and 6
and 5 others under `glyph-clusters`, `unsafe-to-break` and `tab-stops`. None is covered by `script-context` alone. Predicted
values agree on 99.975% and 99.981%, and 73% of all values are predicted. The giants of sets 2 and 3 (3 and 2 paragraphs)
weren't run.

**Chrome never returns from `Range.getClientRects()`** over code point 50 or 51 of set 2's `c-1fda71ce84fd9989` (PingFang SC
16px, `『阿呀呀，…我。』`, width 8px, keep-all, break-word, line-break strict): a probe page outside the lab stalls the same way
(limit 50 returns, 52 doesn't; `.artifacts/probes/blink/round3-native-hang-*`), a null predictor stalls the lab page, and
the prediction alone takes 34 ms. The case is set aside in the set's `parts/excluded-native-hang.ndjson` with its reason in
`parts.json`; part 2 then ran once.

### Gap firing on the development sets

Passing lines of dev-flat and dev-suite that report each gap, w1 (round 2's conditions with item 1) → w18:

| Gap | Passing lines | Passing cases | Lift |
|---|---|---|---|
| `script-context` | 51.06% → 30.72% | 75.98% → 38.04% | 1.19 → 1.21 |
| `glyph-clusters` | 10.44% → 8.82% | 15.38% → 12.83% | 3.97 → 4.29 |
| `float32-precision` | 0 → 5.69% | 0 → 11.06% | new; no failing case |
| `unsafe-to-break` | 4.50% → 4.97% | 5.85% → 7.11% | 8.64 → 7.90 |
| `in-word-prefix` | 1.54% → 1.58% | 2.83% → 2.97% | 2.23 → 0.76 |

`font-fallback`, `soft-hyphen-shaping`, `control-character-width`, `tab-stops` and `han-kerning` are unchanged. New or widened
conditions: `float32-precision` on wide lines with an unnamed font; `unsafe-to-break` for a candidate between two possible
positions and for an adjustment that reads a longer context; `in-word-prefix` for an untested end and a truncated RTL start
(29 more passing lines); `glyph-clusters` or `in-word-prefix` at an item edge inside a shaping call and for an unsettled
ligature on a line that breaks between clusters.

### What the font facts convert

w18 with the listed-font facts left out (`w18-nofonts`) against w18, fail→pass: dev-flat breaks 1; dev-suite lineCount 4,
breaks 4; families 3, 3; heldout-small lineCount 1, breaks 1, widths 3; heldout-suite lineCount 6, breaks 8, widths 6;
triage-small lineCount 74, breaks 209. Ligatures account for the break and line count rows (lam-alef, `ffi`, `fl`), coverage
for the 6 held-out corpus widths. Predicted values rise sixfold (dev-flat 62,900 → 375,379). `scriptLookups` converts no
row; it takes `script-context` from 53.47% to 37.00% of passing development lines.

### Costs

Not optimized (CHARTER tentpole 8). Canvas calls per row, w1 → w18: dev-flat mean 117.6 → 132.6 (median 104 → 118), dev-suite
part 0 mean 84.1 → 110.2 (max 14,439 → 26,381). Prediction time per row: dev-flat mean 0.61 → 1.07 ms, dev-suite part 0 mean
0.40 → 1.06 ms, max 251 → 968 ms. The wide window adds two long strings per safe test, and script resolution runs for every
measured string that holds a character without a script of its own. A variant that also widened the pair window until
Canvas resolved its sides like the paragraph (w14) took `script-context` from 52.75% to 45.54% of passing lines, lost 5
breaks and stalled three corpus jobs at 120 s; it was dropped for the `scriptLookups` narrowing.

### Open under scorer 5

- `suite/U+FFFC/start`, 3 rows (`c-23e11e5c3a96497d`, `c-a43249c733c43a9c`, `c-b0af41f52ed23824`): U+FFFC is 0 wide in Canvas
  and 1,233 units natively, `font-fallback` sits on it, and the scorer takes the line after it as the failing one (the soft
  hyphen's copied rect puts `b` on both native lines), where the gap doesn't reach. The cause is covered; the attribution is
  the scorer's.
- `suite/space`, 3 triage rows (`c-909a7a77bad03225` and two widths of it; Amiri `a` TAB `ب` SHY kasra `ب`, 1px): natively SHY
  takes a line with its hyphen and the kasra the next one; the port keeps SHY and the kasra together, as ICU's line rules
  and the hyphenation test read (shaping_line_breaker.cc:215). Not traced.
- Passing cases that still hold a differing predicted value on the last two fresh sets: 26 and 14
  (`suite/signed-spacing/ascii-matrix` 17, `suite/raw-context` 8, `suite/space-context` 5, 10 others). Not traced.

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
