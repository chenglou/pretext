# Gecko port results (Firefox 156.0)

The Gecko engine in `rebuild/src/engines/gecko/` against installed Firefox 156.0 in the lab
(`rebuild/lab/run.ts --browser=firefox`, Retina DPR 2, 30 app units per device pixel, `regionalPrefsLocale` zh-hans-us given
by the driver). Every run held the shared browser lock, one job per hold with a pause between holds, windows in the
background. Rows, summaries and per-case scores are under `.artifacts/lab/gecko/s5-r<n>/<set>-<order>/`. Scores come from
`rebuild/lab/score.ts` version 3. The charter evaluation's rows, re-scored with version 3
(`.artifacts/lab/rescore-v3-20260917/firefox/`, and `.artifacts/lab/gecko/rescore-families-v3/` for the rule families), are
the baseline every transition below is counted against.

Earlier rounds (1-11, 2026-09-16) and their failure classes are in this file's git history.

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
