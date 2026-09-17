# Gecko port results (Firefox 156.0)

The Gecko engine in `rebuild/src/engines/gecko/` against installed Firefox 156.0 in the lab
(`rebuild/lab/run.ts --browser=firefox`, Retina DPR 2, 30 app units per device pixel, `regionalPrefsLocale` zh-hans-us given
by the driver). Every run held the shared browser lock, one job per hold with a pause between holds, windows in the
background. Rows, summaries and per-case scores are under `.artifacts/lab/gecko/s5-r<n>/<set>-<order>/`. Scores come from
`rebuild/lab/score.ts` version 3. The charter evaluation's rows, re-scored with version 3
(`.artifacts/lab/rescore-v3-20260917/firefox/`, and `.artifacts/lab/gecko/rescore-families-v3/` for the rule families), are
the baseline every transition below is counted against.

Earlier rounds (1-11, 2026-09-16) and their failure classes are in this file's git history.

## Ceiling round 2, 2026-09-17

Round 2's definition of an open model bug (research/ROUND1-CRITIC.md, the orchestrator's round 2 brief): a failing row is
covered only by a gap on the failing line or on the break decision the line starts from, whose source reading says the
prediction can be wrong there. Scores come from `rebuild/lab/score.ts` version 4 (lab/README.md, "Line-local gaps",
"Protocol rows", "Elements"). Round 1's Firefox rows re-scored with version 4 are the baseline
(`.artifacts/lab/gecko/r2-rescore-r1/`, and the lab owner's `.artifacts/lab/round2-scorer4/rescore-r1/firefox-*` for the
families).

### Probes

Installed Firefox 156 at DPR 2, one job each under the lock: `rebuild/probes/gecko-round2.ts`
(`.artifacts/probes/gecko/round2`) and `gecko-round2b.ts` (`.artifacts/probes/gecko/round2b`).

- **F7, 1 au unit widths.** Single shaping units in their own node, DOM box against measureText:
  - `ووفقك` in 10px Geeza Pro: DOM 1173 au, OffscreenCanvas 1172, `<canvas>` element 1174;
  - `รมชาติทำให้ผู้คนมีคว` in 500 32px Thonburi: 16899, 16898, 16900;
  - `modern` in 15px Helvetica Neue: 3118, 3119, 3118; `ancient` 2932, 2932, 2936.
  - An element canvas, detached or connected, measures on whole device pixels, so it is further off than an
    OffscreenCanvas. The DOM rounds each glyph's 16.16 advance at the device size to app units (gfxHarfBuzzShaper.cpp:354-379,
    :1262-1263, :1699-1702); Canvas shows no glyph's sub-app-unit fraction. specs/gecko-canvas.md N7 is now [P].
- **F8, digits in an 8-bit run.** ` 7:00-9:00` in 18px bold Apple SD Gothic Neo under `lang="ko"`: the 8-bit node's box is 5184
  au with `7` at 516 and `-` at 377; the same digits in a 16-bit text run (a node holding `한` follows) are 4969 au, `7` 556,
  `-` 406. Canvas: `7:00-9:00` alone under ko is 4969, under en 4900, and `a 7:00-9:00` less `a ` under ko is 4900.
  - Source: `InitTextRun` tests an 8-bit run for a Latin letter with `const uint8_t c = aString[j] & ~0x20; hasLetter = (c - 'A' <=
    'Z' - 'A')` (gfxTextRun.cpp:2744-2747). `c - 'A'` is a signed int, so digits, spaces and ASCII punctuation count, and the
    run is Latin. A 16-bit run without a letter resolves Common from the language, Hangul here, and CJK scripts turn
    kerning off (gfxHarfBuzzShaper.cpp:1405-1438).
- **F9, a partial ligature.** 14px Helvetica Neue: inside `firstname` the DOM gives `f` 217 au and `i` 218, the two shares of
  the 435 au `fi` ligature (ComputeLigatureData, gfxTextRun.cpp:238-322), also at a 2px emergency break. Canvas: `f` 249,
  `i` 186, `fi` 435 with ligatures on and off (letterSpacing 0.001px), but the ink box of `fi` ends at 438 au on and 438.36
  off. `ffi` and `office` differ in width (671 against 668). Arial and Georgia show no ligature either way.
- **F10, coverage through LastResort.** `16px <family>, LastResort` measures exactly like `<family>` for every probed
  character (中, ب, ก, 😀, U+2010, U+0301 and Latin in Arial, Georgia, Times New Roman, Menlo, Hiragino Sans and Geeza Pro),
  though `document.fonts.check('16px LastResort')` is true. Gecko's font matching doesn't reach LastResort, so Canvas has no
  coverage signal this way.
- **F11, emoji boxes.** Where Apple Color Emoji draws a cluster, the cluster measures the same in Arial, Menlo, Apple Symbols,
  Times New Roman and "Apple Color Emoji" alone, box [60, 1020] au at 16px. Text presentation doesn't: `©︎` is 707 au in Arial
  (DOM 707) and 729 in "Apple Color Emoji"; `☺` is 980 au in Arial with box [−131.25, 848.91].
- **F12, how a pair's kerning divides.** DOM code point rects of `AV`, `To`, `Wa`, `LT`, `Yo` at 18px:
  - Times New Roman, Verdana, Helvetica and Helvetica Neue (a legacy `kern` table, no GPOS `kern` feature) give each glyph
    half the adjustment: Times New Roman `AV` 710 + 710 where Canvas gives `A` 780, `V` 780 and `AV` 1420 (hb-kern.hh's machine,
    `kern1 = kern >> 1` on the first glyph, the rest on the second with an offset). With odd adjustments the split rounds
    either way (Verdana `Wa` 1042 + 622 against 1068 + 649 and 1664).
  - Arial, Hiragino Sans and Apple SD Gothic Neo (GPOS) put it on the first glyph (Arial `AV` 640 + 720).
  - Canvas totals are the same either way.

### Fixes and new conditions

- **8-bit script (F8).** `textRunScripts` counts an 8-bit run as Latin when any unit's masked value is at most `Z`, and
  `scriptContextFor` gives a Latin run whose piece has no letter the context `a`. Fixes `c-9d23fb8693d45e81` and
  `c-f716dcbf1c7bbf6f`.
- **Ligatures at in-word offsets (F9).** Where the prefix and suffix sum test passes, `glyphBefore` also measures the clusters
  on both sides of the offset with ligatures off, and reports `in-word-prefix` at the offset where the width or the ink box
  differs. Necessary, not sufficient: a ligature that moves neither, or one starting two clusters earlier, doesn't show. It
  covers `c-daf9c7047097f77b`.
- **Pair kerning split (F12).** The font fact `pairKerning` (added to src/model.ts and the lab's font table in this round)
  says where HarfBuzz puts a pair adjustment. Where it is `split`, `glyphBefore` gives the glyph before an in-word offset
  `kern >> 1` of the adjustment Canvas shows across it, W(unit) − W(prefix) − W(suffix), instead of all of it
  (hb-kern.hh:102-106 in Firefox 156's HarfBuzz 14.3.1; hb-ot-shape.cc:130-187 applies the legacy `kern` table where GPOS
  has no kern feature). Canvas's adjustment is already rounded per glyph, so an odd one can land either way in the DOM,
  and `in-word-prefix` is still reported wherever the adjustment isn't 0. The lab's table gives `split` for Times New Roman
  (regular and bold), Helvetica, Helvetica Neue and Verdana (regular), `first-advance` for Arial and the Times New Roman
  italics.
- **Emoji font identity (F11, CHARTER-CRITIC item 2).** The Apple Color Emoji test also compares ink boxes at the CSS size, so a
  text font with equal widths at both sizes isn't taken for the color font.
- **`lang=""` (CHARTER-CRITIC item 11).** nsFontCache gives text with an empty style language the locale language, the first
  regional-prefs locale lowercased (nsFontCache.cpp:34, :61-63; nsLanguageAtomService.cpp:107-138), for font matching and
  shaping; the explicit-language flag it lacks is read only for synthetic small caps (gfxTextRun.cpp:2958). The measure
  contexts of such runs take `regionalPrefsLocale` when the caller gives it, and `ui-language` is reported only when it
  isn't. Line breaking and TransformText still see the empty tag.
- **Line-local gaps.** Every paragraph gap carries `at`: the leaf (ui-language, page-history), the text run's source range
  (font-size-quantization, optical-size, letter-spacing `glyph-clusters`), the measured stretch (space-in-shaping), the
  cluster (the emoji `font-fallback` and `bitmap-emoji-size`), the character (U+2007 and U+2008 `font-fallback`) or each
  complex-script stretch (dictionary-breaks-unavailable). `in-word-prefix` line gaps carry their offset.
- **`<wbr>` rects.** The layout returns a `wbr` frame, 0 × 0 where the WBRFrame was placed, and the port reports it as the
  element's one rect, as round 1's feature rows show (`c-00370d538345f01b`: x 3558 au, width 0, height 0 after a 3558 au
  frame). A 0 × 0 rect is placed on no native line, so no metric reads it; the facts compare its x.
- **Costs.** The ligature test answers each context and cluster pair once per layout (a memo keyed by the measurer), since a
  line consults an offset in the scan, at its measured edges and again in the redo. Smoke takes 71.2 measureText calls per
  paragraph against round 1's 49.8 (`.artifacts/lab/gecko/r2-2/smoke-forward`); without the memo it was 115.8
  (`.artifacts/lab/gecko/r2-1/smoke-forward`, a run stopped after smoke).
- **Observation port (ROUND1-CRITIC item 5, CHARTER-CRITIC item 13).** The layout records `unitStart` per character. The port
  marks a point limited only where an end of its advance sum lies inside a shaping unit, the DESIGN.md §9 rule, and takes
  the unit edges from the layout instead of a `\p{M}` stand-in. Frame boxes, the positions of later frames and element rects
  are engine output and predicted, so a width failure no longer says "under a named gap" where the layout reports none.
  - Feature families, forward (`.artifacts/lab/gecko/r2-2/features-forward` against round 1 re-scored with scorer 4): rect
    counts that differ 1,188 → 0, since `<wbr>` elements now report their box; predicted values that differ 291 → 349 and
    limited ones 2,651 → 2,593. The 58 more differing predicted values are code point x values 1 au off in RTL paragraphs
    of 100000px blocks (`rule/box-edges` 27, `rule/atomic-inlines` 21, `rule/br-elements` 10; `c-075ed472cb01888e` x
    5991128.906 au against 5991129.844): probe F6's float32 steps far from the origin, which round 1 counted as limited only
    because an earlier frame on the line had a limited width. No metric reads them.

### Scores

Installed Firefox 156.0, every set in file order and in reverse, one job per case file under the lock, each order scored
with scorer 4 against the other (`scratchpad chain.sh`, outputs `.artifacts/lab/gecko/r2-3/<set>-{forward,reverse}`). The
library is the working tree with every change above; `r2-2` is the same without the split kerning recipe. Forward cells,
pass / fail / unobserved, widths adding not-applicable; the reverse runs give the same lineCount and breaks cells on every
set.

| Set (cases) | lineCount | breaks | widths | painter | History-dependent | Without a line-local gap (lineCount, breaks, widths) |
|---|---|---|---|---|---:|---|
| smoke (297) | 297/0/0 | 297/0/0 | 292/5/0/0 | 283/14/0 | 0 | 0, 0, 1 |
| runs (2,580) | 2580/0/0 | 2576/4/0 | 2541/35/0/4 | 2486/94/0 | 0 | 0, 0, 1 |
| ws (1,019) | 1019/0/0 | 1019/0/0 | 1019/0/0/0 | 1002/17/0 | 0 | 0, 0, 0 |
| policy (1,606) | 1606/0/0 | 1605/1/0 | 1598/7/0/1 | 1583/23/0 | 0 | 0, 0, 0 |
| suite sample (19,888) | 19816/63/0 | 19802/77/0 | 18918/884/0/77 | 18233/1646/0 | 9 | 0, 0, 7 |
| held-out 09-16 runs (2,579) | 2571/8/0 | 2568/11/0 | 2525/43/0/11 | 2479/100/0 | 0 | 0, 0, 6 |
| held-out 09-16 ws (1,022) | 1022/0/0 | 1022/0/0 | 1021/1/0/0 | 1008/14/0 | 0 | 0, 0, 0 |
| held-out 09-16 policy (1,604) | 1604/0/0 | 1602/2/0 | 1594/8/0/2 | 1573/31/0 | 0 | 0, 0, 0 |
| held-out 09-16 suite sample (10,000) | 9762/48/0 | 9739/71/0 | 8997/742/0/71 | 8523/1287/0 | 190 | 0, 0, 0 |
| rule families (9,584) | 9432/152/0 | 9200/384/0 | 8592/608/0/384 | 8048/1536/0 | 0 | 0, 0, 0 |
| feature families (11,946) | 11931/0/15 | 11931/0/15 | 8862/0/3084/0 | 6425/41/5480 | 0 | 0, 0, 0 |
| the 36 provisional triage cases | 36/0/0 | 36/0/0 | 36/0/0/0 | 6/30/0 | 0 | 0, 0, 0 |

- **Failures without a line-local gap: 15 rows, every one the 1 au class** (smoke and runs `c-268ee59b15a407a8`; held-out
  runs 6; suite sample 7, all `suite/maintained/accuracy` in 15px Helvetica Neue). Round 1's rows re-scored with scorer 4
  have smoke 1, runs 16, policy 1, suite sample 7, held-out runs 27, held-out suite sample 1, rule families lineCount 79,
  breaks 210 and widths 374; the rest were covered only by paragraph gaps without a range, or were the port bugs above.
- **The 15 feature-family protocol rows** are unobserved by scorer 4's slot rule, no longer failures.
- **Suite-sample history dependence** is 9 rows where round 1's evaluation had 123: this chain ran the suite parts 25 cases
  per round trip where the evaluation ran one, so the documents see other histories. The transitions below leave out the
  rows either run marks.

Transitions, forward, cases neither run marks history-dependent. Round 1 re-scored with scorer 4 → `r2-2`: held-out runs
widths +2 and painter +2 (F8); runs painter +3 and feature families painter +180 and 12 to unobserved. 180 of those 192 feature
cases have the same layout as round 1, so the painted lines changed, with the painter owner's `paint.ts` in the same tree;
the other 12 differ in their frame lists. Nothing else changed, nothing lost.
`r2-2` → `r2-3`, the split kerning recipe, nothing lost:

| Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| smoke | 0 | 0 | +1 | 0 |
| runs | 0 | +1 | +8, 1 n/a → fail (`c-3ae0e772055c21ec`, `runs/split-word`, 1 au on line 6 under `in-word-prefix`) | 0 |
| ws | +1 | +2 | +11, +2 from n/a | +1 |
| policy | 0 | 0 | +6 | 0 |
| suite sample | 0 | +1 | +17, +1 from n/a | +1 |
| held-out runs | 0 | +1 | +6, +1 from n/a | +1 |
| held-out ws | 0 | 0 | +3 | 0 |
| held-out policy | 0 | 0 | +11 | 0 |
| held-out suite sample | +1 | +1 | +16, +1 from n/a | 0 |
| rule families | +10 | +34 | +78, +33 from n/a, 1 n/a → fail (covered) | 0 |
| provisional triage cases | +30 | +30 | +30 from n/a | 0 |

Every gained case breaks inside a word in Times New Roman, Helvetica, Helvetica Neue or Verdana with a kerned pair across the
break; `in-word-prefix` still reports there.

Costs, measureText calls per paragraph, forward, round 1 → round 2: smoke 49.8 → 72.9, runs 66.7 → 97.7, ws 38.1 → 57.9,
policy 51.1 → 84.5, held-out runs 65.5 → 95.1, held-out ws 38.7 → 58.9, held-out policy 51.7 → 85.6, rule families 17.3 →
20.0, feature families 21.2 → 21.8. The ligature test at consulted in-word offsets and the split recipe's W(prefix) add them.

### Traced, not changed

- **The 1 au class (F7):** `c-268ee59b15a407a8` (smoke, runs), `c-02e7d131f09e05b9`, `c-d575ffd182517ddc`, `c-e05daec9b21bfc36`
  (Geeza Pro 10px), `c-13c64a6ce641374d`, `c-8f9cd18c645671da`, `c-fcbb3bc755b5a5e8` (Helvetica Neue 15px), the two rows
  round 1's critic found with gaps on other lines, `c-79f342df6e23e13a` and `c-f52cf560ae801fed` (Thonburi 32px), and
  `c-78c9f151226956de` (the same Thonburi run on line 0; round 1 covered it only by a paragraph gap without a range). No
  Canvas-observable condition exists, so they stay failures without a gap; a condition that fired on every unit at DPR 2
  would cover every Firefox width failure and hide real port bugs like F8.
- **`c-aad1cfdbd82a76b7` and the 30 provisional accidental passes** (`suite/following-space-scope` and
  `following-space-context`, `A­V​​  B` and `AV​​ tail` in 18px Times New Roman at 12px, run with the round 2 library
  before the fixes: `.artifacts/lab/gecko/r2-0/provisional-forward`). Natively `V ZWSP ZWSP SP` share a line; the port puts
  the zero-width characters on their own line. Cause (F12): Times New Roman's legacy `kern` gives `A` and `V` 710 au each,
  so `V` fits the 720 au line and the break after the spaces wins; the port's `W(unit) − W(suffix)` gives `V` 780 au, which
  overflows, so the emergency break before the ZWSP is taken (gfxTextRun.cpp BreakAndMeasureText, the port's loop is the
  same). Not a loop bug. `in-word-prefix` fires at offset 1 (or 4) on the failing lines. Main's visible lines match native for
  another reason: its rows (`.artifacts/charter-20260916/triage/runs/firefox/main-file`) give `V` 13px, 780 au, like the
  port, but main keeps the ZWSP on `V`'s overflowing line (`[1, 3) "V​"`) and leaves the rest of the white space outside
  every line, so its line count isn't evidence of the split. The other 6 provisional cases (`suite/cross-item`) pass every
  metric now.
- **Emergency-break `font-fallback` (critic: 21 Firefox failures covered only by it, 20 `rule/hyphen-classes` and 1
  held-out `suite/measurement`).** The condition is on the line whose break it decides. It can't be narrowed from Canvas: the
  emergency break needs the alphanumeric, the hyphen and the next alphanumeric in one font range (gfxFont.cpp:741-753,
  gfxTextRun.cpp:2930-3000), and F10 finds no Canvas signal for which characters the listed families cover.

## Stage 5, 2026-09-17: the port

The model became a tree of inline content (DESIGN.md §1.1), and lines are laid out one slot at a time (§2.9).

### prepare.ts

- **The walk.** Leaves come from `indexContent`. Each leaf reads its parent element's computed style (`styleUnder`) and
  language (`langUnder`): white-space, word-break, line-break, spacing and font are per frame. The block's own style is
  kept for the root span and tab widths.
- **Frames.** A white-space-only 8-bit text node gets no frame only when it is the block's first or last DOM child
  (`AtLineBoundary`, `nsCSSFrameConstructor.cpp:5220-5258`). A leaf with empty text makes no node.
- **Items.** Text frames and element events (open, close, atomic, `<br>`, `<wbr>`) in document order, each with the
  source offset it sits at.
- **Text runs** follow `BuildTextRunsScanner::ScanFrame` (`nsTextFrame.cpp:2176-2276`):
  - Spans continue text runs and the line breaker (`nsInlineFrame::CanContinueTextRun`).
  - An atomic inline, `<br>` or `<wbr>` ends both. It flushes the line breaker and records a trailing break on the run it
    flushes, except before a `<br>` (`FlushFrames(true, isBR)`, `FlushLineBreaks :1835-1855`). It also clears the incoming
    white-space bit.
  - `ContinueTextRunAcrossFrames` walks the boxes between two frames up to their common ancestor. A nonzero margin,
    border or padding, or a `vertical-align` other than baseline, on the side between them ends the run
    (`:2054-2126`). Equal computed styles continue at once; otherwise word-break, line-break, font, language and
    letter-spacing flags must match (`:2141-2173`).
- **Line breaker.** Every flow reads its own word-break and line-break (`SetupBreakSinksForTextRun :2913-2940`).
  - Its initial break is suppressed when the element controlling it can't wrap. That element is the common ancestor with
    the last frame, lifted as spans close (`:1151-1156`, `:2229-2233`, `:2956-2963`).
- **Box edges.** Margins and padding use `ToAppUnits`. Border widths are snapped down to whole device pixels, at least one
  (`snap_as_border_width`, `servo/components/style/values/specified/border.rs:235-246`).
- **Bidi buffer.** `TraverseFrames` in document order (`nsBidiPresUtils.cpp:1169-1429`): text pieces, U+FFFC for an atomic
  inline, U+200B for a `<wbr>`, and U+2028 for a `<br>`, which also ends the bidi paragraph (`:1381-1400`). A non-text leaf
  takes the level of its character (`ResolveParagraph :975-982, :1027`), so the space before a `<br>` takes the paragraph
  level by rule L1 and splits off its text frame.
- **Bidi continuations of spans.** Where two neighbouring leaves of one bidi paragraph differ in level, every span holding
  both is split (`ResolveParagraph :1039-1057, :1114-1147`; `CreateContinuation`, `SplitInlineAncestors :612-758`). The
  items get a close and an open marked `split` there, after the spans that close behind the first leaf. The text-run
  scanner lifts the common ancestor past an ended continuation as past a span (`nsTextFrame.cpp:2275`). Nothing is refused
  with `UnportedFeature` any more.

### lines.ts

- **Per-span line data.** `nsLineLayout::BeginSpan`/`EndSpan` (`nsLineLayout.cpp:378-436`) and `nsInlineFrame::ReflowFrames`
  (`nsInlineFrame.cpp:489-688`):
  - A span's children fill up to the parent's end less the span's start margin, start edge and end border and padding, on
    every line (`:500-521`).
  - The start edge and start margin go only without a previous continuation (`AllowForStartMargin`,
    `nsLineLayout.cpp:1110-1134`). The end edge goes as the last continuation; the end margin only when complete
    (`:1217-1224`).
  - `EndSpan` gives 0 without placed frames (`:431`).
  - A child's break-before becomes break-after and incomplete, except on the span's first child, where it propagates
    (`nsInlineFrame.cpp:707-757`).
  - A span is always placed and requests backup when it overflows.
- **Atomic, `<br>`, `<wbr>`** through `nsLineLayout::ReflowFrame` and `CanPlaceFrame` (`:733-1342`):
  - An overflowing atomic inline is pushed, restoring the saved break position.
  - Every frame that can't continue a text run clears the trimmable width, except a `<br>` (`:1015-1020`), and records an
    optional break after itself (`:1057-1071`).
  - `BRFrame` ends the line after itself (`BRFrame.cpp:98-166`).
  - A `WBRFrame` is 0 × 0 and not empty (`nsIFrame::IsEmpty`, `nsIFrame.cpp:9380-9382`).
- **Line start state.** `GeckoLineStart` is `{ frame, contentOffset, isFirstLine }`: the item the line starts at (open spans
  there become continuations), the offset inside a text frame, and whether text-indent still applies.
  `AdvanceToNextLine` counts only lines whose line layout wasn't empty (`BlockReflowState.h:251-257`).
- **Slots.** The band's start and size come from the slot insets in au (`nsBlockFrame.cpp:5252-5273`).
  - With floats in the band, the line start is an optional break (`:5289-5299`), `notSafeToBreak` is false (`:785`), and
    the line is breakable from its start (`LineIsBreakable`, `nsLineLayout.h:151-155`).
  - A redo forced at the line start, or a break-before on the line's first frame, returns below-floats
    (`nsBlockFrame.cpp:5549-5555`).
- **text-indent** on line number 0 (`nsLineLayout.cpp:178-201`). Tab stops read the span chain's inline coordinates, indent
  included (`nsTextFrame.cpp:11063-11067`).
- **Trimming** recurses into spans, skips `<br>` and stops at any other frame that isn't text
  (`TrimTrailingWhiteSpaceIn`, `nsLineLayout.cpp:2851-2985`).
- **Alignment.** `TextAlignLine` (`nsLineLayout.cpp:3482-3670`): start, left, right, end and center with the hang of a
  wrapped line (`GetHangFrom :3416-3450`).
  - Justify follows `ComputeFrameJustification`, `AssignInterframeJustificationGaps` and `ApplyFrameJustification`
    (`:3006-3275`), `PropertyProvider::ComputeJustification` with text-justify auto (`nsTextFrame.cpp:3332-3406`,
    `:3726-3830`) and `SetupJustificationSpacing` (`:4503-4560`).
  - The trimmed-space opportunity is cancelled (`CancelOpportunityForTrimmedSpace`). With preserved white space,
    `GetTrimFrom`'s count and advance apply (`:3452-3478`, `:3531-3570`).
  - The last line and a line ending in `<br>` take start.
- **Geometry.** `lineLeft`, `availableWidth`, `impactedByFloats`, `textIndent`, `width` (the line box after trimming, plus
  the justification expansion), `hang`, `alignOffset`. Frames are in logical order: `inline` frames before their children,
  then `atomic` and `br`. A `WBRFrame` has no geometry kind in the model.
- **Bidi continuations in reflow.** A continuation that begins at a split has no start edge or start margin
  (`GetPrevContinuation`, `nsInlineFrame.cpp:510`, `nsLineLayout.cpp:1109-1115`). One that ends at a split has no end edge
  or end margin but still reserves the end border and padding (`LastInFlow()->GetNextContinuation()`,
  `nsInlineFrame.cpp:514-521, :670-674`, `nsLineLayout.cpp:1217-1224`). Split items make no `box-start` or `box-end`
  fragments.
- **Bidi positions.** `RepositionInlineFrames` orders the line's frames by their first leaves' levels
  (`GetFrameBidiData :1545-1547`) and walks them from the start edge (`nsBidiPresUtils.cpp:1882-1905`). `RepositionFrame`
  (`:1769-1868`) is ported recursively:
  - a span's edges and margins go by visual order: first if no earlier continuation on this line was visited and none
    exists on an earlier line, last likewise (`IsFirstOrLast :1561-1671`);
  - a span walks its children left to right at an even level and right to left at an odd one;
  - a frame's start margin comes first in its container's walk, and places add up from the containing frame.
- **Fragments.** `box-start` and `box-end` for every span on the lines holding its first and last continuations, plus
  `atomic`, `br` and `wbr`.

### Correctness fixes from research/SUPERSET-gecko.md

- **B, letter spacing after a mark that follows a removed soft hyphen.** The cluster base stops at a skipped original
  character (`FindClusterStart`, `nsTextFrame.cpp:3549-3560`, `:4203-4213`).
- **C, shaping units that crossed script runs.** Units end at script-run limits: `InitScriptRun` shapes each run on its own
  (`gfxTextRun.cpp:2779-2809`).
- **D, pair kerning in reversed runs.** HarfBuzz reverses a buffer whose direction isn't its script's native one
  (`hb_ensure_native_direction`, `hb-ot-shape.cc:588-645`, read in Chromium 152's HarfBuzz copy; Firefox 156's HarfBuzz
  version isn't checked). The pair adjustment then lands on the later glyph, so the advance before an in-word offset is the
  prefix's own. Common and Inherited runs shape as Latin (`gfxHarfBuzzShaper.h:83-94`).
- **A, a unit starting with a cluster extender or U+202F right after an invalid character.**
  - **The superset's recipe:** `W(prev + unit) − W(prev)` gained 11 line counts but lost 3 line counts and 3 breaks in
    `suite/source-views/*` (ZWSP U+0308 SHY U+093E).
  - **Probe gecko-port F4** (`.artifacts/probes/gecko/font-matching`, installed Firefox, fresh document) settled it:
    - `a WJ U+0301 ZWSP U+0308 U+093E b` in 16px Arial measures 1329 au whole in Canvas, as in the DOM;
    - `U+0308 U+093E b` alone and after ZWSP measure 1429 au;
    - `x U+2028 U+202F` gives U+202F 0 au whole, as in the DOM, and 192 au alone.
  - **The rule:** `gfxFontGroup::ComputeRanges` matches fonts over the whole script run, carrying the previous character
    and its font (`gfxTextRun.cpp:3593-3875`), and `FindFontForChar` reads both for a cluster extender and U+202F
    (`:3181-3212`). So such a unit is measured with the script run's earlier text in front, `W(prefix + unit) − W(prefix)`.
    The invalid character ends the shaped word, so nothing shapes across it (`gfxFont.cpp:3872-3897`).
  - **Round 8 against round 7:** superset lineCount +11, breaks +11, widths +40, painter +36; the suite sample unchanged;
    nothing lost.
- **E, the Apple Color Emoji test for a text-presentation cluster in Apple Color Emoji's own font list.** The two contexts
  are one, so equal widths prove nothing. Such a cluster reports `font-fallback` (`gfxTextRun.cpp:3268-3308`), and the
  measurement stays, since the superset's switch regressed 27 controls.
  - The superset's other candidate: apply the device-size advance only to clusters whose Canvas width doesn't scale in
    proportion between the CSS and device sizes, as Apple Color Emoji's bitmap strikes don't (probe F3).
  - Rounds 6 and 9 tried it, on rounded au and then on the returned widths. No lab case changed
    (`.artifacts/lab/gecko/s5-r6`, `s5-r9`), so it came out again.
  - Probe F4 shows why: `©︎` in 16px "Apple Color Emoji" is 729 au in Canvas and the DOM and 1459 au at 32px, like Times New
    Roman. An outline font's Canvas width doesn't scale exactly in proportion either, so the scaling can't tell the fonts
    apart.
  - Which exact recipe gives the DOM's 729 au where the port predicts 730 stays open: 24 superset widths.
- **F, the library's copy of the lab's width rules.** Gone since the charter; all 15 cases pass.

### Other source rules and gaps added

- `page-history` for an LTR paragraph holding LRE, LRO, LRI or FSI and no right-to-left character (gecko audit F3).
  - Gecko splits frames at those controls' level changes once any text node in the document has bidi characters
    (`CharacterData.cpp:298-302`), and frames at different levels don't share a text run (`nsTextFrame.cpp:2139-2148`).
  - The port predicts a fresh document.
- `opticalSizeAxis` default: only the unquoted `system-ui` keyword, or an identifier `-apple-system`, counts. A quoted
  `"system-ui"` is a named family (`SingleFontFamily::parse`, `font.rs:707-768`; CHARTER-CRITIC item 8).
- `font-fallback` where an emergency break after a hyphen decides a line. `SetupClusterBoundaries` sets the flag inside one
  shaped word (`gfxFont.cpp:741-753`), and `InitScriptRun` shapes words per font range (`gfxTextRun.cpp:2930-3000`), which
  Canvas doesn't show.
  - It names the `rule/hyphen-classes` failures `zz 中中-2b q`: natively no break between `-` and `2`, where 中 falls back
    and `-2` is Georgia's or Arial's.
  - It also fires on 76 passing family rows of its 96.

### Observation port (lab/observe/gecko.ts)

- Walks the tree itself.
- Produces `elements`: per span each continuation's `inline` frame box, per atomic inline and `<br>` its frame box
  (`GetAllInFlowRects`, `nsLayoutUtils.cpp:3477-3505`, `:3661-3667`). An element rect is limited under `in-word-prefix`
  when a text frame on its line is.
- `<wbr>` gets no rects: untraced.
- Lists `impactedByFloats` as unobservable.

### Tests

`bun test rebuild/src/engines/gecko rebuild/lab/observe/gecko.test.ts`: 71 pass. The Gecko tests were converted to the tree
with a flat-runs helper. New tests:
- RTL visual order walked from the right edge;
- an atomic inline in an RTL block at level 2 with its start margin on the right;
- a `<br>` in an RTL block ending the bidi paragraph, so the space before it takes level 1;
- a padded span in an RTL block split at a level change, the start edge on the right continuation and the end edge on the
  left one;
- H12b's end padding at 67.2px;
- start and end padding with `box-start` and `box-end`;
- `<br>` with trimming;
- `<wbr>` backup;
- an atomic inline pushed, then backed up after;
- H15 tab stops with text-indent;
- H13 pre-wrap with `text-align: right` (x 1152 au);
- center;
- a narrow slot giving below-floats, and a slot that holds a line;
- justify spreading 1440 au over a space's gaps, and pre-wrap justify.

## Scores, the final library (round 13; rounds 4-12 equal on these metrics)

| Set | Rows | lineCount | breaks | widths | painter | History-dependent |
|---|---:|---|---|---|---|---:|
| smoke | 297 | 297 / 0 | 297 / 0 | 291 / 6 | 283 / 14 | 0 |
| runs | 2,580 | 2,580 / 0 | 2,575 / 5 | 2,533 / 42 | 2,483 / 97 | 0 |
| ws | 1,019 | 1,018 / 1 | 1,017 / 2 | 1,006 / 11 | 1,001 / 18 | 0 |
| policy | 1,606 | 1,606 / 0 | 1,605 / 1 | 1,592 / 13 | 1,583 / 23 | 0 |
| suite sample | 19,888 | 19,695 / 63 | 19,680 / 78 | 18,779 / 901 | 18,111 / 1,647 | 130 |
| held-out runs | 2,579 | 2,571 / 8 | 2,567 / 12 | 2,516 / 51 | 2,476 / 103 | 0 |
| held-out ws | 1,022 | 1,022 / 0 | 1,022 / 0 | 1,018 / 4 | 1,008 / 14 | 0 |
| held-out policy | 1,604 | 1,604 / 0 | 1,602 / 2 | 1,583 / 19 | 1,573 / 31 | 0 |
| rule families | 9,584 | 9,422 / 162 | 9,166 / 418 | 8,481 / 685 | 8,048 / 1,536 | 0 |

Cells are pass / fail; no row is unobserved. The suite sample counts exclude its 130 history-dependent rows, the same rows
as round 11.

- **A geometry bug the metrics missed, found in round 10 and fixed in round 11.** Stage 5's positioning walked an RTL line's
  visual order from its left end, so RTL lines with frames at several levels were mirrored. `RepositionInlineFrames` walks it
  from the line's start edge (`nsBidiPresUtils.cpp:1882-1905`).
  - lineCount, breaks, widths and painter can't see it: line membership and line extents don't change.
  - The observation facts did: against the charter, round 10's runs had 249 cases with more differing predicted rect
    values and 435 with more differing limited ones; smoke 11 and 23, the suite sample 88 and 454.
  - Round 11 equals the charter's facts on smoke, runs and the suite sample (16 cases have fewer differing limited values).
  - The no-regression check since compares facts per case as well as metrics.
- **Rounds 12 and 13, the bidi ports** (object substitutes, then continuations of spans). Forward, smoke, runs, the suite
  sample, ws and policy equal the charter rows on every metric and fact, as round 11 did; the superset cases equal round 11.
- **No-regression check.** Per case and metric, against the charter rows re-scored with scorer 3, in both orders: 0 pass
  pairs lost on every set.
  - Round 4 ran every set in both orders.
  - Rounds 9, 11 and 13 (`.artifacts/lab/gecko/s5-r9`, `s5-r11`, `s5-r13`) ran smoke, runs, ws, policy and the suite
    sample in both orders, and the superset cases forward; round 12 ran the five sets in both orders. All with the same
    result, and from round 11 on the facts per case equal the charter's too.
  - The rule families' round 4 and 7 rows equal the charter's.
  - Gained: 3 suite-sample widths (`suite/control` `c-295d6f5aecd97c78`, `suite/hyphen-quote-policy`
    `c-42a05a28230401ab`, `suite/cross-item` `c-c8c92591bdc03ec9`).
  - `lab/gate.ts` refuses these runs (exit 2): their environment names `regionalPrefsLocale`, and
    `gate-firefox-156.0.json` was seeded without it. Reseeding is the lab or tests owner's call.
- **The structural port alone** (a copy with fixes A-D switched off, `.artifacts/lab/gecko/s5-r2/*-fix-none`) equals the
  charter rows on every case and metric of the suite sample, smoke, runs, ws and policy.
- **Held-out suite sample: not run.** Three launches failed the same way: `Page error: NetworkError when attempting to fetch
  resource` before the first chunk, 0 rows. That's two forward launches in rounds 3-4 and one in reverse. Other sets ran
  between them, and nothing listened on port 3002 afterwards. The set holds paragraphs of up to 273 KB. It was left for
  the lab owner.

## Attribution of the fixes

**Superset cases.** The 5,816 cases of the superset experiment (`research/SUPERSET-gecko.md`: 816 main-only, 5,000 controls)
ran with the fixes switched on alone in a copy of the library (`.artifacts/lab/gecko/s5-r2/changed-fix-{A,B,C,D}`, 121
changed cases). Against every fix off:

| Fix | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| B, spacing base | +26 | +26 | +28 | +2 / −11 |
| C, script-run units | +13 | +16 | +28 | +8 / −4 |
| D, reversed kerning | 0 | +4 | +15 | +4 |
| A, previous character (reverted) | +11 / −3 | +11 / −3 | +40 / −2 | +36 / −2 |

- **The final library (round 11) against every fix off**, superset cases: lineCount +50, breaks +57, widths +108, painter +50 / −15,
  nothing else lost. Facts: 50 cases with fewer differing rect counts, 209 with fewer differing predicted values, 376 with
  fewer differing limited values and 7 with fewer line membership differences; 2 `suite/control` cases with more differing
  limited values, under named gaps.
- **Round 8, the script-run prefix recipe for A, against round 7:** superset lineCount +11, breaks +11, widths +40,
  painter +36; the suite sample unchanged.
- **Round 3, B, C, D with the A gap, against every fix off:** superset lineCount +39, breaks +46, widths +68, painter +14 / −15;
  suite sample widths +3; no line count or breaks lost.
- **The painter losses** are cases whose widths now pass while the painted line doesn't reproduce them. Named painter limits
  (DESIGN.md §7): letter spacing after a painted line's last character (B), and the script a painted line's first characters
  inherit (C).
- **Superset groups, round 8:**
  - previous-character font matching 40 of 40 pass all three metrics, script runs 22 of 22, reversed kerning 14 of 14,
    width rules 15 of 15;
  - spacing base 17 of 24, and the other 7 fail widths only, under `in-word-prefix`;
  - text-presentation emoji 24 fail widths, and legacy kerning 105, lam-alef 360 of 372 and the in-word glyph classes 195
    of 199 fail line count or breaks, all under named gaps.
- **MAIN-TRIAGE.md facts to learn, Firefox (620 records; 585 are superset cases), round 8:** 45 pass (12 of them without a
  gap), 540 fail, all under named gaps.

## Inline structure features

139 cases of the WebKit owner's feature probes (`.artifacts/lab/webkit-stage5/probe-features` and `probe-glue`, Menlo),
round 5: 0 prediction errors, lineCount 134 pass / 0 fail / 5 unobserved, breaks 134 / 0 / 5, widths 93 / 0 / 41, painter
88 / 5 / 46.

- **Every lineCount and breaks result passes:**
  - padding at the start and end of wraps, borders with margins, negative margins, nested spans;
  - nowrap spans and wrapping spans in nowrap blocks;
  - atomic inlines next to text, NBSP, CJK and spaces;
  - `<br>` after spaces, in spans and in pre-wrap; `<wbr>`, also under keep-all and nowrap;
  - positive, negative and tab text-indent;
  - end, center, right in RTL, end in pre-wrap;
  - left, right, narrow and RTL slots;
  - justify, in pre-wrap, RTL, CJK, with spans, atomic inlines and `<br>`.
- **Unobserved results are the scorer's:**
  - Widths and painter with box edges: node rects don't span the engine width, and `elements` aren't compared yet.
  - The 5 atomic line counts: a line holding only an atomic inline has no expected text rect.
- **Painter failures:** 3 justified pre-wrap lines, 1 justified span line and 1 justified atomic line. A painted line is its
  block's last line.
- **Round 13** (`.artifacts/lab/gecko/s5-r13/features-*`, both orders, 0 history-dependent) equals round 10 on every
  metric and fact.

## Rule families derived fresh, inline families included

`bash rebuild/tests/observe-families.sh firefox .artifacts/lab/gecko/families-s5` (12 derivation steps, then final runs of
21,530 cases forward and reverse; 0 history-dependent):
- **Totals:** lineCount 18,018 pass / 3,166 fail / 346 unobserved, breaks 17,759 / 3,425 / 346, widths 13,595 / 3,683 / 3,479,
  painter 13,132 / 1,670 / 3,730.
- **The final library on the same cases, both orders** (`.artifacts/lab/gecko/s5-r10/families-derived-{file,reverse}`): the same
  metrics. Facts: 136 cases with fewer differing predicted values and 382 with fewer differing limited ones, from the RTL fix;
  8 with more differing limited values, in rule/hyphen-glyph and rule/joining, all under named gaps.
- **Refused inputs, rounds 10-11.** 2,998 rows were `UnportedFeature` prediction errors, all in right-to-left paragraphs:
  box edges 1,560 (box-edges, nested-box-edges, nowrap-spans), atomic inlines 958, `<br>` 480 (br-elements, text-indent).
- **Round 12, bidi object substitutes** (`.artifacts/lab/gecko/s5-r12/families-objects-*`, the atomic-inlines,
  br-elements, text-indent and wbr-elements families, 4,948 cases, both orders, 0 history-dependent). Against round 10:
  lineCount +1,002, breaks +1,002, widths +590, painter +676; nothing lost.
- **Round 13, bidi continuations of spans** (`.artifacts/lab/gecko/s5-r13/families-derived-*`, all 21,530 cases, both
  orders, 0 history-dependent). Against round 10 in each order: lineCount +2,674, breaks +2,674, widths +1,140, painter
  +1,161; nothing lost. No prediction error is left.
  - Totals: lineCount 20,692 pass / 168 fail / 670 unobserved, breaks 20,433 / 427 / 670, widths 14,735 / 685 / 5,013,
    painter 14,293 / 1,769 / 5,468.
  - Failures without a gap in cases predicted before are unchanged: the rule/line-slots protocol cases (below) and
    painter results.
  - Facts: no case that was predicted before has more differing values. 111 formerly refused cases have differing
    predicted values and 282 differing limited ones. The limited ones are under `in-word-prefix`. The predicted ones are
    1 au code point x differences in RTL lines, a class the round 10 rows without objects already show (54 rule/line-slots,
    20 rule/hanging-white-space, 6 rule/text-align and others, `.artifacts/lab/gecko/s5-r10/families-derived-file`).
    Probe F6 shows it is float32 precision far from the origin, not a model rule (below).
  - Formerly refused cases failing without a gap: painter only. 61 box-edges, 11 nested-box-edges and 3 nowrap-spans
    painted extents are the box-edge painter limit the LTR halves already fail (the painted node rects don't include the
    padding). 16 atomic-inlines lines paint the space before an atomic inline at the left end of an RTL line, since the
    painter draws the line's text without the object. 8 painted lines wrap.
- **Left-to-right halves of those families:** no lineCount or breaks failure without a gap; widths and painter are mostly
  unobserved, since `elements` aren't compared yet. wbr-elements 1,188, text-align 1,104 and all the earlier families pass
  every lineCount and breaks row, or fail under named gaps.
- **Failures without a gap:** 6 line counts and 9 breaks in `rule/line-slots` (below).

## Failures without a named gap (open model bugs)

| Case | Set | What differs | Status |
|---|---|---|---|
| `c-13c64a6ce641374d`, `c-8f9cd18c645671da`, `c-fcbb3bc755b5a5e8` | suite sample | Helvetica Neue with Arabic, 1 au on one line | specs/gecko-canvas.md §3 N7: rare 1 au per-glyph differences from 16.16 truncation at the device scale [I]. No Canvas-observable condition and no gap name. Needs a probe and a name (architect). |
| `c-268ee59b15a407a8` | smoke, runs | 1 au on one line | the same class |
| `c-daf9c7047097f77b` | policy | Helvetica Neue `fi` at an in-word break: natively 217 + 218 au by cluster share, predicted 249 + 186 | a ligature whose width equals its parts, invisible to the `in-word-prefix` check. No Canvas-observable condition. Needs a name. |


The earlier rule families have none since the emergency-break gap (round 5, `.artifacts/lab/gecko/s5-r5/families-file`).

**Not model bugs: 1 au code point x values in 100000px blocks.** The rule families put RTL paragraphs in a 100000px
block, so their lines sit near x = 100000px. Probe gecko-port F6 (`rebuild/probes/gecko-rtl-rects.ts`,
`.artifacts/probes/gecko/rtl-rects`, "Hello world again" in 13px Georgia):
- In a 300px or 4000px block, RTL or LTR, each code point's x relative to the first equals the frame's integer prefix
  within 0.01 au (1459, 1879, 2067).
- In a 100000px block, RTL and right-aligned LTR alike, they drift by up to 0.69 au (1459.688, 1879.688, 2068.125). Rect
  values that far from the origin come back in float32 steps of 1/128px, 0.47 au.
- So an exact prediction can differ by 1 au after rounding: 111 formerly refused rows in round 13, and rows without
  objects since the charter. Reported in SHARED-CHANGES.md for the lab and scorer owners.

**Not model bugs: 9 `rule/line-slots` cases** (`c-2c6803d9cbcda5b2`, `c-0011200bf7ddcc7c` and 7 more; LTR 3, RTL 6), failing
6 line counts and 9 breaks. Each has a text-indent wider than row 0's band.
- Natively line 0 sits in row 1 with row 0's right inset.
- Probe gecko-port F5 (`rebuild/probes/gecko-slot-indent.ts`, `.artifacts/probes/gecko/slot-indent`, c-2c6803d9cbcda5b2's
  paragraph):
  - With text-indent 10px, row 0's right float is at y 32px, not 0, and every later right float moves down a row. With
    9px, and without indent, the floats sit in their rows.
  - A float in the first line's content is placed only where it fits beside that line's indent. Otherwise it goes below
    the line. `nsLineLayout::TryToPlaceFloat` and `BlockReflowState::AddFloat` weren't read line by line.
- The page's floats then don't describe the case's slots, so these rows break the slot-rows observer assumption
  (DESIGN.md §2.9). Reported in SHARED-CHANGES.md for the lab and families owners.

## Gaps the engine reports, round 7 census (the final library)

Cases reporting the gap, with all-pass cases (lineCount, breaks and widths) in parentheses. Round 7 (`.artifacts/lab/gecko/s5-r7`,
forward) equals round 5 on every metric of the suite sample, superset, smoke, runs, ws and policy.

| Set | `in-word-prefix` | `glyph-clusters` | `font-fallback` | `bitmap-emoji-size` | `page-history` | `ui-language` |
|---|---|---|---|---|---|---|
| smoke | 46 (41) | 29 (29) | 8 (8) | 1 (1) | 0 | 1 (1) |
| runs | 604 (571) | 510 (508) | 3 (3) | 33 (18) | 0 | 0 |
| ws | 91 (78) | 0 | 0 | 0 | 0 | 0 |
| policy | 106 (93) | 0 | 24 (24) | 0 | 0 | 0 |
| suite sample | 5,260 (4,284) | 2,241 (2,224) | 465 (459) | 1 (1) | 4 (4) | 9 (9) |

`font-fallback` discriminates poorly: most reports come from the emergency-break condition, which holds wherever an emergency
break decides a line, and the 40 previous-character cases and the 24 text-presentation emoji cases are its failing ones.

## measureText calls per paragraph, round 4

| Set | mean | median | p90 | max | per 100 source characters | predict ms summed |
|---|---:|---:|---:|---:|---:|---:|
| smoke | 49.7 | 39 | 105 | 595 | 132.9 | 148 |
| runs | 66.7 | 60 | 111 | 366 | 122.3 | 650 |
| ws | 38.1 | 35 | 71 | 166 | 119.2 | 133 |
| policy | 51.1 | 42 | 94 | 183 | 142.3 | 451 |
| suite sample | 41.6 | 17 | 94 | 26,613 | 100.3 | 14,933 |
| rule families | 17.3 | 16 | 26 | 68 | 101.3 | 544 |

Equal to the charter evaluation's within its noise (smoke 50.5, runs 67.6, suite 42.7). The inline structure adds no Canvas
call; justification adds none.

## Not done, and why

- **Language items (CHARTER-CRITIC 10, 11).**
  - `contentLanguage` is read where no element and no `<html lang>` has a language (`Document::GetLanguageForStyle`).
    The model's block always has `lang`, and the lab always sets `<html lang>`, so no read site is reachable.
  - `lang=""` maps to an empty style language (`MapLangAttributeInto`, `nsGenericHTMLElement.cpp:1337-1375`). No Gecko
    line-breaking rule reads the locale for it: TransformText's ja/zh test and `UpdateCurrentWordLanguage` see the empty
    tag. Font matching for an unknown language reads `GetLocaleLanguage` (`nsLanguageAtomService.cpp:107-138`).
  - Whether OffscreenCanvas with `lang` '' matches the same way needs a probe of Han fallback. `ui-language` stays reported
    for `lang=""` runs.
- **CHARTER-CRITIC 13.** The observation port's `\p{M}` stand-in for `IsClusterExtender` decides only whether a value is
  predicted or limited. A ported rule needs shaping-unit edges in `GeckoCharacter`, a model change (architect).
- **An empty span in a paragraph that resolves bidi** is a bidi leaf standing for U+200B (`nsBidiPresUtils.cpp:1391-1396`)
  with a level of its own. The port gives it no leaf, so its frame takes the paragraph level for ordering. U+200B is
  boundary-neutral, so no other level changes.
- **A `<wbr>`'s level** comes from the resolver's level for U+200B, which isn't checked against Gecko's bidi engine. It
  decides only whether spans split around the `<wbr>`.
- **`<wbr>` rects** are untraced.
