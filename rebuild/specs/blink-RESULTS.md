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

What the port throws `UnportedFeature` for instead of laying out silently:

- `text-align: justify` over a character at U+02C7 or above that isn't white space or default-ignorable:
  `IsCjkIdeographOrSymbol` reads Blink's generated character property data (character_property_data_generator.cc:104-140),
  which the port's tables don't carry.

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
- The broad gaps: `glyph-clusters` at adjusted edges fires on kerned Latin line edges too (the justify cases report it).
  Telling a kern from a ligature needs a font fact the model doesn't have (FontFacts has no ligature field).
- `text-align: justify` over a character at U+02C7 or above still throws `UnportedFeature`. Blink's `IsCjkIdeographOrSymbol`
  is the explicit arrays and ranges of character_property_data.h:17-111 plus ICU's `Emoji_Presentation` and the
  Extended_Pictographic characters of RGI emoji sequences (character_property_data_generator.cc:89-140). No feature
  family case reaches it (fix-r6: 0 of 12,882 throw).
- CHARTER.md "Known deviations" still describes `blink/measure/ignorables-left-out-if-8bit` with its fitted length rule,
  which fix-r8 removed (probe blink-followups-20260917); the shared charter is the orchestrator's to update.
- Element rects aren't scored yet (lab), so the nested-span font-height rule and `<wbr>` rects have no lab check.

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
