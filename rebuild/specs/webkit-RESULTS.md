# WebKit port results (Safari 27.0, WebKit 7625.1.29.11.27)

Lab runs of `rebuild/src/engines/webkit` in `webkit-host`, the system WebKit.framework that installed Safari 27.0 runs
(CFBundleVersion 22625.1.29.11.27, macOS 27, libicucore 78.1), on this Mac (Retina, `devicePixelRatio` 2). Rows,
summaries and per-case files are under `.artifacts/lab/webkit-round2/<run>/` for ceiling round 2 and
`.artifacts/lab/webkit-stage5/<run>/` before it. Installed Safari wasn't run by the WebKit owner in either round.

## 2026-09-17: ceiling round 2 (line-local gaps)

### What changed

The round 2 definition covers a failing line only with a gap on that line or on the break decision that ended the line
before it (lab/README.md, "Line-local gaps"), and round 1's WebKit gaps were all on the paragraph. Every condition of the
content and fonts is now reported on the lines whose filling measured the characters it concerns, with `at` naming them;
the paragraph keeps only `page-zoom`.

- **Which characters a line concerns** (`lineGaps`, engines/webkit/lines.ts). The items from the line start to the end of
  the last candidate content the builder formed: the placed content and the content whose fit ended the line, which the
  next line starts with. The builders record how far they read (`measuredEnd`), where the last candidate began
  (`decisionStart`), whether InlineContentBreaker ran on it (`overflowStart`) and whether they rebuilt the line back to an
  earlier wrap opportunity (`reverted`).
- **Conditions narrowed from source, per line:**
  - `control-character-width`: a measured CR on the simple font code path, or another Cc (specs/webkit-text.md §5.3).
  - `tab-stops`: a measured TAB where tabs are allowed.
  - `letter-spacing-ligatures`: two adjacent measured characters that aren't white space or controls, in a box with letter
    spacing. liga, clig, dlig and hlig replace at least two glyphs and the DOM turns them off
    (ComputedStyleBase.cpp:324-331, UnrealizedCoreTextFont.cpp:258-264); Canvas keeps them and shows no ligature apart from
    kerning.
  - `canvas-language`: every measured character of a box with a locale whose fonts depend on it, or its Han, kana and Hangul
    characters where only system fallback does. **Corrected reading:** serif, sans-serif, cursive, fantasy and monospace
    resolve through CoreText's per-locale families whenever the locale's script isn't Common
    (FontDescription::platformResolveGenericFamily, FontDescriptionCocoa.cpp:77-118, called first by
    CSSFontSelector::resolveGenericFamily, CSSFontSelector.cpp:334-353). The port had read only -webkit-standard as per
    script, so Latin in `serif` under `ja` had no gap (`c-dfa5a082c19b5785`: native `語f` 23.904px, predicted 23.994px from
    Times).
  - `simplified-measuring`: a measured string of a simplified-path box outside the width shortcut that holds U+0020, or whose
    Canvas total isn't the float32 sum of its code points' advances in order. The DOM's simplified path sums the shaped
    advances in one loop (FontCascade.cpp:381-412); WidthIterator sums unshaped advances, adds what shaping moved and
    restores every character treated as a space to its unshaped advance (WidthIterator.cpp:84-120, :473-474), so the two
    agree where shaping moved nothing. Canvas can't show a space's shaped advance.
  - `fixed-pitch-path`: an item failing test T1 while `monospace` is null, and now also while `primaryFamily` is null in a
    fixed-pitch box: whether the realized family is Courier New decides the width shortcut (FontCoreText.cpp:776-782), and
    the first listed family only stands in for it (research/ROUND1-CRITIC.md item 8).
  - `font-fallback`: a measured code point as wide as LastResort's box in a box taking the width shortcut.
  - `string-storage`: keep-all punctuation in Latin-1 text (BreakablePositions.h:257-274, :292-299), or an emergency break in
    Latin-1 text whose second unit can't start a line (InlineContentBreaker.cpp:143-157), reported where the break is taken.
  - `ui-language`, `dictionary-breaks-unavailable`, `dictionary-breaks-stand-in`: the measured characters the condition
    reads (the box of a Han locale, its quotes, its dictionary ranges).
  - `page-history` (below).
- **`page-history` from the break position cache's key.** TextBreakingPositionCache stores a box's item ends after its bidi
  splits under (content, TextBreakingPositionContext, origin), for boxes of at least 5 units and 3 items, and a later box
  with the same key builds its items from those ends, then takes its own bidi splits (InlineItemsBuilder.cpp:858-924,
  1082-1148; TextBreakingPositionCache.h:41-42). The context holds white-space collapse (preserve and break-spaces share a
  value), overflow-wrap, line-break, word-break, nbsp mode and locale (TextBreakingPositionContext.h:30-80). So another box
  of the same text can differ only by its bidi splits and by how it splits preserved white space. Each box records:
  - the level boundaries its text gets under either paragraph direction and one or two characters of context standing for
    each resolved class UAX #9's rules read across its edges (sos and eos with L1, L, R, AL, EN alone or after L or R, AN),
    less the ends its items already have (`historyEnds`, content.ts `collectHistoryFacts`);
  - preserved white space of two units or more (`historyWhitespace`).
  A line reports the gap where such an end falls inside a measured item and either the parts measure otherwise than the
  whole, or the item is content whose fit ended the line (or the builder reverted over it): an extra end is a wrap
  opportunity there (endsWithSoftWrapOpportunity, InlineFormattingUtils.cpp:336-355). For white space the whole run of the
  box's white-space items counts, in both directions. Round 1 reported the gap for any box with strong RTL content or an RTL
  block, and missed Latin text laid out after an RTL box of the same text. The contexts are a declared approximation of
  "every context": longer contexts aren't enumerated.
- **Observation port.** A text box shaped across inline boxes is limited under `rtl-shaping-across-inline-boxes`, the gap
  its line reports, instead of `in-word-prefix`.

### Runs

Scorer 4 throughout. Native runs of the round 1 combined files in webkit-host with the first round 2 library, file order and
reverse (`<set>-forward-r1`, `<set>-reverse-r1`, 12:51 to 13:11, every row observed, no native, prediction or painter
error), scored forward against reverse. The last two source corrections (generic families by locale; decision content from
where the last candidate began, only where it overflowed; white-space runs in both directions) change gaps and not
predictions, so they ran predict-only against the r1 native rows (`<set>-predict-p2`, history flags from r1). Cells are
cases, history-dependent cases, prediction failures, and lineCount / breaks / widths failures without a line-local gap.

| Set | Cases | History-dependent | Prediction failures | Without a line-local gap: round 1 re-scored | r1 | p2 |
|---|---:|---:|---:|---|---|---|
| development combined file | 25,180 | 96 | 209 | 25 / 75 / 131 | 0 / 1 / 4 | 0 / 0 / 0 |
| held-out 09-16 combined file | 15,205 | 144 | 266 | 43 / 88 / 176 | 0 / 1 / 2 | 0 / 0 / 1 |
| rule and feature families (7 protocol rows) | 21,734 | 6 | 525 | 78 / 145 / 194 | 14 / 14 / 0 | 0 / 0 / 0 |

- **p2 against r1:** 0 lineCount, breaks or widths transitions on any set. The painter transitions (development 1 lost, 11
  gained; held-out 2 lost, 10 gained; families 4 gained) came with the painter owner's working-tree changes to paint.ts
  between the runs; the WebKit changes don't move geometry.
- **Failures r1 left uncovered, attributed:**
  - `runs/lang-spans` `c-accaa5a60eb82121`, `c-bd0a609e0aec120b`, `c-295b6c791fc3f4e9`, `suite/keep-all` `c-dfa5a082c19b5785`,
    held-out `policy/zh-lang` `c-c63614c0ae195f5d`: `serif` under a Han, kana or Hangul locale draws Latin and punctuation
    from CoreText's per-locale family (`‘` 3.744px against Times' 5.328px; `¥` 13.84px against 10px). Generic families by
    locale, above.
  - `suite/glue` `c-cf7bb1ee29b5b4cf` and held-out `c-67cd9bd538cb3e95` (`ب` SHY `ب` NBSP `x` in an RTL block): the cached end
    at 3 sits inside [2, 4), placed on line 1 as part of the candidate [2, 5) whose overflow ended the line. Decision content
    from where the last candidate began.
  - 14 `rule/br-elements` cases (`c-178367f98108fb03`, `c-06105f785157b4bd`, `c-3403348a57059e54` traced): `xx aaaa␠␠⇥<br>`
    under break-spaces keeps `aaaa␠␠⇥` on one line natively, the run whole as a pre-wrap box of the same text cached it; the
    port splits per space, and line 1's overflowing item [8, 9) belongs to the run [7, 10) that starts before it. White-space
    runs in both directions.
  - held-out `runs/word-spacing-spans` `c-064c3e678034473f`: not a gap. Line 8's box `ه` NBSP in a span with 16px word
    spacing measures 26.596744537px, native 26.596746444px, one float32 step: WebKit adds word spacing per character inside
    its float32 loop, the port added it to the Canvas total afterwards. Same class: development `c-4303efdc328a680d`,
    `c-a797931f634f8091`, held-out `c-d6f5ad1dde30cfa1` (letter- and word-spaced lines, covered by `letter-spacing-ligatures`
    on their lines). Recipe change below.
- **Weak gaps, case-level lift (share of failing cases over share of all-pass cases), r1 then p2:**

  | Gap | Development | Held-out 09-16 | Families | Round 1 re-scored, all three |
  |---|---|---|---|---|
  | `page-history` | 3,552 reports, 3.11; 3,689, 2.99 | 2,378, 3.09; 2,483, 2.99 | 809, 7.60; 825, 7.98 | 13,692, 0.35 |
  | `canvas-language` | 5,645, 3.48; 11,361, 1.71 | 2,741, 3.35; 2,773, 3.32 | 3,828, 1.39; 3,828, 1.39 | 12,213, 2.30 |
  | `simplified-measuring` | 4,955, 0.46; 4,955, 0.46 | 2,101, 0.70; 2,101, 0.70 | 11,476, 0.39; 11,476, 0.39 | 22,367, 0.52 |
  | `letter-spacing-ligatures` | 2,501, 0.95 | 1,939, 0.74 | 2,360, 2.19 | 7,377, 1.41 |
  | `control-character-width` | 1,176, 0.74 | 3,793, 0.91 | 336, 28.63 | 5,312, 2.89 |
  | `string-storage` | 111, 0 | 131, 0 | 32, 0 | 1,264, 0.28 |

  Failures covered only by gaps below lift 2 over development and families r1 together: lineCount 45, breaks 107, widths
  186 (`canvas-language` 19 / 68 / 152, `letter-spacing-ligatures` 17 / 25 / 12, `simplified-measuring` 8 / 8 / 0). See Open.
- **c-90c2ca856ed4ab91** (`بِبِ((tail` SHY `word`, Amiri 24px, 24px wide; round 1 critic item 3): alone in a fresh document
  the ceiling library passes lineCount, breaks and widths (`c-90c2ca856ed4ab91/`); the charter-era native lines (`بِ((` /
  `tai`) came from the document it ran in. Lines 0 and 1 report `page-history` at 6. The painter fails with a wrapped line
  (painter owner).
- **Feature rows:** `c-303d850e42b725dd`, `c-32a0d43aea9861a7` and the accidental pass `c-9863334967bab8a9` are protocol rows
  under scorer 4.

### Word spacing in the Canvas context

WebKit adds word spacing inside WidthIterator's per-character float32 loop (calculateAdditionalWidth: after SPACE, LF, NBSP
and TAB without tabs, past the TextRun's index 0 unless NBSP; the complex text controller likewise per glyph,
ComplexTextController.cpp:790-845). The port measured a Canvas total without word spacing and added the spacing to it,
another float32 order, which moved line widths by one float32 step on letter- and word-spaced lines. OffscreenCanvas's
setWordSpacing gives the context's FontCascade the spacing (CanvasRenderingContext2DBase.cpp:3299-3324), so each box with word
spacing now measures in a context that carries it (`spacedContext`); only strings split at TABs, whose parts start past the
DOM's index 0, add it in JS. This replaces the registry's `webkit/measure/word-spacing-in-js` for strings without TABs
(rules.json belongs to the tests owner).

- Development combined file, predict-only against the r1 native rows (`dev-all-predict-p3`): widths 0 lost, 2 gained
  (`runs/word-spacing-spans` `c-4303efdc328a680d`, `c-a797931f634f8091`, which now pass every metric); lineCount and breaks 0
  transitions; prediction failures 209 to 207, none without a line-local gap.
- Held-out 09-16 combined file (`heldout-all-predict-p3`): widths 0 lost, 1 gained (`c-d6f5ad1dde30cfa1`, every metric passes);
  `c-064c3e678034473f`'s line 8 now equals native, and its widths are unobserved (line 4, a TAB box, isn't spanned by the
  expected node rects); lineCount and breaks 0 transitions; prediction failures 266 to 264, none without a line-local gap.
- Painter transitions against r1 (development 1 lost, 13 gained; held-out 3 lost, 11 gained) include the 3 word-spacing gains;
  the rest came with the painter owner's paint.ts changes (12:51 r1, paint.ts changed again at 13:22, before held-out p3):
  `c-3ef09a2630650b9b` has no word spacing.

- Rule and feature families (`families-all-predict-p3`; 540 of their cases have word spacing, `rule/following-space` among
  them): 0 transitions on lineCount, breaks and widths against r1; painter the same 4 gains as p2; prediction failures 525.

With p3, prediction failures without a line-local gap are 0 / 0 / 0 on the development and held-out 09-16 combined files
and on the rule and feature families.
- measureText calls per paragraph on the development combined file, mean / median / p90 / p95 / max: round 1 evaluation 15.1
  / 7 / 33 / 50 / 2,059; round 2 r1 17.7 / 8 / 37 / 56 / 2,069; p3 the same as r1. The line-local conditions add about 17% on
  the mean (code point singles for `simplified-measuring`, split parts for `page-history`, T1 widths); the spaced context adds
  nothing measurable.

### Open

- **Three conditions stay weak because WebKit's OffscreenCanvas can't show what they concern.** On the development combined
  file's r1 rows (88,384 engine lines, 25,084 cases outside history dependence, 209 failing a prediction metric),
  `simplified-measuring` is on 15,995 lines of 4,955 cases (19 failing), `letter-spacing-ligatures` on 6,741 lines of 2,501
  cases (20 failing), `canvas-language` on 17,033 lines of 5,645 cases (166 failing).
  - A space's shaped advance: WidthIterator restores it before Canvas reports a total (WidthIterator.cpp:103-117), so the
    simplified path's kept advance has no Canvas reading, and every simplified-path string with U+0020 reports the gap.
  - Which pairs a font ligates: Canvas keeps liga, clig, dlig and hlig under letter spacing and has no setting that turns
    them off, and a pair total differs from its parts by kerning too.
  - The locale's fonts: OffscreenCanvas has no locale attribute, so no measurement shows a locale-chosen font.
  Each would close with an explicit input (a font fact, a per-locale realized family) or with a maintainer decision on a
  connected `<canvas>` (SUPERSET-webkit §3.3); neither is an engine change.
- **`page-history` contexts.** The level boundaries come from a declared set of one- and two-character contexts, standing for
  the resolved classes UAX #9 reads across a box's edges; longer contexts aren't enumerated.
- **`contentWidth` unobserved by a scorer rule** (CHARTER known deviations, tentpole 2): unchanged.
- Installed Safari: not run by the WebKit owner; webkit-host stands in (lab/WEBKIT-HOST.md).

## 2026-09-17: stage 5 (inline structure, line slots, alignment)

### What changed

- **Input.** `prepare` walks `indexContent(paragraph)`. Each text box takes its parent's computed style, and every site
  that read the block's style now reads the box the source reads (webkit audit F1): the item's own style
  (`trailingWhitespaceType`, `appendText`, `wordBreakBehavior`, `isBreakableRun`, `lastValidBreakingPosition`), the layout
  box parent's (`isAtSoftWrapOpportunity`, `shouldWrapUnbreakableContentToNextLine`, the wrap opportunity list), the
  nearest common ancestor's (`InlineFormattingUtils.cpp:357-383, :436`), the next box's (`mayBreakInBetween`) and the root's
  (the simple builder, `handleLineEnding`).
- **Text renderers.** `textRendererIsNeeded` over the tree: previous child renderer, a `<br>` before white space, a span
  parent (`RenderTreeUpdater.cpp:536-595`).
- **Items.** Inline box start and end, atomic inline, hard line break and word break opportunity items
  (`InlineItemsBuilder.cpp:1053-1078`), with their bidi paragraph entries (U+FFFC, LF, opaque; `:568, :596-618, :730-774`).
- **Box edges.** Inline box start and end widths as LayoutUnit sums of margin, border and padding
  (`InlineFormattingUtils.cpp:320-324`; `LayoutIntegrationBoxGeometryUpdater.cpp:231-306`; borders snapped as border widths
  to device pixels, `StyleLineWidth.cpp:46-61`). `appendInlineBoxStart` and `appendInlineBoxEnd` with the hanging reset,
  negative margins and the letter-spacing stack (`InlineLine.cpp:289-344`). Decorated boxes are contentful
  (`InlineLine.cpp:989-1008`, `InlineLineBuilder.cpp:64-78`).
- **Atomic inlines, `<br>`, `<wbr>`.** `appendAtomicInlineBox`, `appendLineBreak`, `appendWordBreakOpportunity`
  (`InlineLine.cpp:558-602`), candidate content and trailing opportunities (`InlineLineBuilder.cpp:141-192, :1030-1170`),
  `nextWrapOpportunity` (`InlineFormattingUtils.cpp:456-544`), the atomic branch of `processOverflowingContent`
  (`InlineContentBreaker.cpp:263-299`). The simple builder takes `<br>` (`TextOnlySimpleLineBuilder.cpp:80-94, :488-497`).
- **Builders.** Simple and range-based eligibility over the style records (`TextOnlySimpleLineBuilder.cpp:488-528`,
  `RangeBasedLineBuilder.cpp:36-39, :131-184`), and the range-based builder's leading and trailing inline box runs
  (`:48-126`).
- **Line slots.** The line rect from the slot's insets through `floatAvoidingRect` (`InlineLineBuilder.cpp:432-478,
  :1185-1216`); a float-constrained line counts as having content (`:1454-1455`), so content that doesn't fit beside the
  floats places nothing and the line moves below them (`below-floats`, `InlineFormattingUtils.cpp:54-103, :286-289`). Floats
  make the content ineligible for the simple builders, so every line from the first slotted one uses LineBuilder
  (`WebKitLineStart.hasFloats`). The lab protocol puts the slot floats before the content, so the paragraph's first build
  places them itself (`tryPlacingFloatBox`, `:1329-1400`): they narrow the line afterwards, and `m_lineContentEdgeOffset`,
  which tab stops read, stays the indent alone (`:478`, `:1394-1396`). A later build finds them in the formatting context.
  A refused first build returns `below-floats` with `next`, its start with `hasFloats` set (additive `LineResultOf` field
  and `fillLines` change, SHARED-CHANGES.md).
- **text-indent.** A start margin on the first formatted line, which tab stops read through `m_lineContentEdgeOffset`
  (`InlineFormattingUtils.cpp:143-179`, `InlineLineBuilder.cpp:453-478`).
- **text-align.** `horizontalAlignmentOffset` with text-align-last auto (`InlineFormattingUtils.cpp:198-276`) in both
  builders, and `align` on the line. `justify` through `InlineContentAligner` (below).
- **Geometry.** `lineLeft`, `contentEdgeOffset`, `alignmentOffset`; `inline-box`, `atomic` and `line-break` display boxes
  from `processNonBidiContent` and the line box builder (`InlineDisplayContentBuilder.cpp:504-645`,
  `InlineLineBoxBuilder.cpp:440-540`), and on bidi lines from `processBidiContent`'s display box tree (below).
- **Fragments.** `box-start` and `box-end` for every span (spanning starts carry none), `atomic`, `br`, `wbr`.
- **Observation port** (`lab/observe/webkit.ts`). Walks the tree; per-leaf Canvas settings from the leaf's parent style;
  element rects: a span's inline box per line (`RenderInline::absoluteQuads`), an atomic inline's frame at its truncated
  LayoutUnit location (`RenderBox::absoluteQuads`, `InlineDisplayContentBuilder.cpp:632-640`), a `<br>`'s line break box
  (`RenderLineBreak.cpp:97-105`), nothing for `<wbr>` (no display box). A `wbr` fragment's line and an atomic inline's
  margins are listed as unobservable. A box's `xPos`, which only tab stops read, is its position from the content box less
  the display line's `contentLogicalLeft`, the root inline box's left inside the line box: the alignment offset alone
  (`InlineIteratorBoxModernPathInlines.h:38-60`, `InlineDisplayLineBuilder.cpp:134-160`, `InlineLineBoxBuilder.cpp:63`).
  The port had subtracted the slot insets and text-indent too.
- **Gaps.**
  - `font-fallback` where the fixed-pitch coverage test meets a code point exactly as wide as LastResort's box, where the
    recipe can't tell (research/CHARTER-CRITIC.md item 1).
  - A quoted family name no longer counts as a generic keyword for `canvas-language` (CHARTER-CRITIC item 9).
  - `page-history` now follows the break position cache's key from source (below).
  - `rtl-shaping-across-inline-boxes` is reported per line where LineBuilder shaped a range, no longer for the paragraph
    (below, *Text shaping across inline boxes*).
- **Process languages.** `preferredLanguages` and `icuDefaultLocale` are read where the source reads them (Han locales,
  quote overrides). `contentLanguage` is never the root locale here: the model's block always carries a `lang` attribute,
  and `Element::effectiveLang` reads Content-Language only without one (CHARTER-CRITIC item 10).

### Flat parity

Forward runs with the stage-5 library, scored, against the previous forward runs (smoke: the lab foundations run with
process languages; the others: the charter evaluation). Cells are pass / fail / unobserved, and widths add not-applicable.

| Set | Rows | lineCount | breaks | widths | painter | Transitions |
|---|---:|---|---|---|---|---|
| smoke | 300 | 299/1/0 | 297/3/0 | 287/5/5/3 | 263/32/5 | 0 lost, 0 gained |
| ws | 1,019 | 1019/0/0 | 1019/0/0 | 1017/2/0/0 | 993/26/0 | 0 lost, 0 gained |
| policy | 1,606 | 1605/1/0 | 1599/7/0 | 1558/21/20/7 | 1451/139/16 | 0 lost, 0 gained; `ui-language` 103 → 0 |
| runs | 2,580 | 2571/9/0 | 2530/50/0 | 2317/83/130/50 | 2240/221/119 | 0 lost, 0 gained |
| suite sample | 19,933 | 19912/21/0 | 19887/46/0 | 19750/48/89/46 | 18810/1045/78 | lineCount 1, breaks 7, widths 10 lost; 0 gained |

- Prediction errors 0 and observation errors 0 in every set.
- **Rerun with the final library** (`<set>-forward-r2/`, after justify, bidi geometry, `font-fallback` and the
  `page-history` condition): the same counts on every set and 0 transitions against the first stage-5 runs. No failing
  case reports no gap. `page-history` now fires on smoke 40, ws 38, policy 44, runs 756 and suite sample 4,526 rows (the
  source condition, not narrowed by counts); `font-fallback` on none.
- **Rerun after the shaping port and the slot fixes** (`<set>-forward-r5/`, smoke, ws, policy and the suite sample, against
  r2 and the suite sample's r3): 0 transitions on every metric, and no failing case without a gap. Flat cases have no
  slots or indent, so the tab-stop fixes can't move them; the shaping port moved `runs` only (below).
- **The suite sample's losses are page history.** On all 7 cases the prediction is the charter's to the bit, and the
  native geometry differs between the two runs: `c-10045fce207d89e7` and `c-b87d5d950d1bc9e2` (`straight-double`, observed
  after other cases), `c-2a0af46d56e09079`, `c-80023476b04ec0a6`, `c-b52e18f58d0c2974`, `c-d2e3af1d49858fb5`
  (`U+001C`/`U+001E` middle) and `c-5c68643afc1d77d8` (`spacing-hanging-NBSP`). No reverse run was made this round, so
  the forward rows don't mark them.

### Feature probes

`.artifacts/lab/webkit-stage5/probe-features/`: 92 tree cases in 16px Arial and Menlo (box edges at wrap points, border
and margin, negative margin, nested spans, nowrap in wrap and wrap in nowrap, atomic inlines next to text, NBSP, CJK and
spaces, `<br>` after white space and inside a decorated span, `<br>` under pre-wrap, `<wbr>` under keep-all and nowrap,
positive and negative text-indent with tabs, end, center and right in RTL, pre-wrap with end, slots on either side, slots
too narrow for a word, RTL slots).

- lineCount 85/0/7, breaks 85/0/7, widths 57/0/28/7, painter 57/0/35: **no failures**. Unobserved lines hold only an
  atomic inline, or box edges or an atomic inline at a line end, which the scorer's node-rect widths can't span.
- **Element rects**, compared offline exactly: 64 equal and 7 differ in the first run, from two port bugs since fixed:
  - a negative margin start stays inside the inline box's rect (`InlineLineBoxBuilder.cpp:482-487`): native x −5, width
    19.27;
  - an atomic inline reports its renderer's frame, whose location is the display box's truncated to a LayoutUnit:
    22.234375 for 22.2421875.
- The rerun with both fixes (`run-r2/`) gives the same metrics, and all 67 element rects equal native to the bit: spans 40,
  atomic inlines 15, `<wbr>` 8 (none reported, none expected), `<br>` 4.

### text-align: justify

Ported after the first probe round: `applyRunBasedAlignmentIfApplicable` with text-align-last auto (InlineLineBuilder.cpp:
679-704), hanging trailing white space detached into its own run (InlineLine.cpp:235-241, :918-941),
`InlineContentAligner::computedExpansions` and `applyExpansionOnRange` (InlineContentAligner.cpp:150-267),
`FontCascade::expansionOpportunityCount` with ideographs on Cocoa (FontCascade.cpp:974-1303,
cocoa/FontCascadeCocoaInlines.h:34-37). Display boxes carry `expansion` and `expansionBehavior` (additive model field,
SHARED-CHANGES.md), and the observation port places the expansion among a box's glyphs as the complex text controller
does (ComplexTextController.cpp:107-118, :673-696, :800-845).

Probe round r3 (`run-r3/`, 109 cases with 17 justify cases: plain, pre-wrap with runs of spaces, RTL, CJK under `zh`, a
decorated span, an atomic inline, `<br>`): lineCount 102/0/7, breaks 102/0/7, widths 72/0/30/7, no failures. In the
justify cases every predicted and limited value equals native, code point edges inside expanded boxes included. All 73
element rects are equal. Painter 3 failures, all `align-justify-pre-wrap`: the painted line's extent differs (painter
owner).

### Bidi lines with inline structure

Ported after the justify round, replacing the `UnportedFeature` throws: `processBidiContent` with
`processBidiLinesWithNoContent`, the display box tree of `ensureDisplayBoxForContainer`, `adjustVisualGeometryForDisplayBox`
and `closeInlineBoxes` (InlineDisplayContentBuilder.cpp:713-1088).

Probe round r4 (`run-r4/`, 129 cases with 20 bidi cases: RTL spans with padding, margins and borders, RTL atomic inlines,
`<br>` under RTL, Latin spans in RTL blocks, Hebrew spans and atomic inlines in LTR blocks, an empty decorated span, nested
spans): lineCount 120/0/9, breaks 120/0/9, widths 83/0/37/9, no failures. In the bidi cases every predicted and limited
value equals native, and all 95 element rects of the round are equal.

### Observation port: negative Canvas stand-ins

The rows' `facts.predicted` count values the ported rules claim to give exactly. In the r2 runs 515 suite sample cases
(732 values) and 172 runs cases (906 values) had a predicted value that differed from native, 121 suite cases without any
gap: `U+200D/middle` 70, `U+200D/end` 50, `maintained/accuracy` and others. The partial rect of a code point at a box
edge kept its x on the edge only while its in-context advance was non-negative, and the Canvas stand-in, a prefix
difference, went negative where a joining form or a fallback font measured alone is narrower (`ب` ZWJ, `ريال` in Courier
New). In-context advances are glyph advances plus non-negative spacing and expansion (ComplexTextController.cpp:740-845),
so a negative stand-in is the stand-in's error: it now clamps at 0 unless spacing is negative.

r3 (`runs-forward-r3/`, `suite-sample-forward-r3/`): 0 metric transitions; predicted-value differences down to 93 suite
cases (226 values) and 136 runs cases (868 values), every one reporting a gap: `original-vs-reshaped-admission` and `glue`
page history 25, `canvas-language` 16, `control-character-width` 18, `simplified-measuring` 14, `letter-spacing-ligatures`
10 and a few with several.

### Text shaping across inline boxes

`TextShapingAcrossInlineBoxes` is on by default (UnifiedWebPreferences.yaml:8489-8501, InlineFormattingContext.cpp:569-570),
so LineBuilder shapes complex RTL text of one font joined over undecorated inline box edges as one run
(`applyShapingIfNeeded`, `collectShapeRanges`, `applyShapingOnRunRange`, `shapePartialLineCandidate`,
InlineLineBuilder.cpp:780-1028; the run splits of `Line::appendText`, InlineLine.cpp:399). The port had only a paragraph
gap for it, and the charter's rule families failed 194 `rule/joining` cases under it (`c-0c565437ddc97aaa`: Geeza Pro
`بب ببب ببب بب` over two spans, native line 110.918px, predicted 119.175px from separately measured items).

Ported: the ranges and their eligibility from source; a run's share is the Canvas prefix difference of the joined text in
the plain context (glyphAdvancesForTextRun sums CoreText base advances without letter spacing,
ComplexTextController.cpp:186-205). Canvas positions glyphs otherwise than those base advances, so even the range total can
differ: in `c-d03f94e8fb53e7e2` (Geeza Pro 16px, `الرَّحِيمِ|السلام` over two spans) WebKit's shares equal the separately
measured words and the joined Canvas total is 0.51px wider. The line reports
`rtl-shaping-across-inline-boxes` where a range was shaped (the paragraph-level condition is gone), and the display boxes
carry `shapedAcrossBoxes` (additive, SHARED-CHANGES.md), whose rect values the observation port marks limited.

Rule families (`families-forward-r4/`, the charter's 9,584 derived family cases), against the charter evaluation's families
run: lineCount 9458/126 (+33, −22), breaks 9376/208 (+33, −22), widths 8822/291/263/208 (+58, −0), painter 8388/995/201
(+58, −6). All changes are `rule/joining`.

- **The 22 lost line counts were accidental passes.** In every one the charter's widths failed: it measured the items
  separately, where WebKit shapes the range as one run, and its line count came out right anyway. With `line-break:
  anywhere` the lines depend on the share each character has inside the joined shaping, which Canvas can't give:
  `c-16a062eb9e8d14cb` (`بب ببب|ببب بب` over two spans in 16px Arial, 7.8px) has a native box of 0.305px for the last
  letter of the first span. Those lines report `rtl-shaping-across-inline-boxes`.
- Failures without a gap: 0 (charter 0). `rule/joining` failures under the gap: 186 (charter 194).
- runs (`runs-forward-r4/`, against r3): breaks +1, widths +2 −1, painter +2 −1, all `runs/bidi-runs`. The lost width is
  `c-d03f94e8fb53e7e2` above, under the line's `rtl-shaping-across-inline-boxes`.

### Feature families

The families owner's webkit-host derivation (`.artifacts/tests/features-20260917/webkit-host/final/`, 12,150 cases in 9
families, native rows observed in file order and in reverse). Predict-only runs under the lock, scored with
`--native-rows` from the file-order rows and `--native-compare` against the reverse rows (0 history-dependent cases):
`features-families/predict/` (the stage-5 library with the shaping port) and `predict-r2/` (after the two fixes below).

| Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| predict | 11407/38/705 | 11310/135/705 | 8241/200/2869/840 | 8270/494/3386 |
| predict-r2 | 11426/19/705 | 11416/29/705 | 8547/0/2869/734 | 8449/315/3386 |

r2 against the first run: 0 lost on every metric; gained lineCount 19, breaks 106, widths 306, painter 179, all
`rule/line-slots`.

- **Tab stops beside slot floats** (309 failing cases, all `rule/line-slots` with tabs under pre-wrap, reported under
  `tab-stops`, whose condition doesn't explain them). Only first lines with a left inset differed, by the float's share of
  a tab: `c-0289df69e0498d74` (Arial, a 40px left float, `aaaa⇥bbbb cccc⇥dddd eeee`) native box 217.88px, predicted
  213.45px from stops counted past the float. Two root causes, both from source:
  - the engine counted the first build's tab stops past the floats that build places itself (above, *Line slots*);
  - the observation port's `xPos` subtracted the slot insets and text-indent (above, *Observation port*); on later lines too
    native tab rects extend to the box end (`c-0150d8ad3497ba83` line 1: 42.66px, the port 39px), and these values are
    limited by `in-word-prefix`, so no metric showed them.
- **Left after r2** (lineCount 19, breaks 29, widths 0):
  - `rule/br-elements` 16 line counts, 24 breaks, under `page-history`: `xx aaaa␠␠⇥<br>…` under break-spaces keeps the
    overflowing white space before `<br>` natively and the port breaks it. All 24 pass alone in a fresh document
    (`isolate-br/`: lineCount 24/0, breaks 24/0, widths 12/0/12), so they are page history, although the reverse rows
    showed no difference.
  - `rule/line-slots` 5 cases (2 without a gap: `c-303d850e42b725dd`, `c-32a0d43aea9861a7`): the native floats aren't
    the declared slots. Row 0's left inset, right inset and text-indent exceed the width, so the right float doesn't fit
    beside the indented line and goes below it (`haveEnoughSpaceForFloatWithClear`, InlineLineBuilder.cpp:1317-1380), and
    every later row moves. 7 of 1,906 line-slots cases have native floats that differ from their slots, the 5 failing
    ones among them. A lab item: the scorer's slot-rows assumption doesn't compare `floats` with `lineSlots`.
- Painter failures (315): `rule/line-slots` 179 painted extents and line wraps, `rule/text-align` 80, `rule/wbr-elements`
  38, `rule/atomic-inlines` 24; painter owner.
- Unobserved (705 lines, 2,869 widths): lines holding only an atomic inline, or box edges at a line end, which the scorer's
  node-rect spans can't measure.

### Failures without a named gap

From the charter evaluation's forward per-case files (dev, held-out and families), outside page history: 15 suite cases
reported no gap (`suite/original-vs-reshaped-admission` 7, `suite/glue` 8), and MAIN-TRIAGE's 9 webkit-host facts to
learn without gaps (`suite/raw-context` 7, `suite/physical-window-terminal-seam` 2), which include SUPERSET-webkit's
unexplained case D (`c-49feb03a06bd4b90`).

- **Each alone in a fresh webkit-host process, all 17 pass lineCount, breaks and widths** (`isolate/`): the 8 glue and
  reshaped-admission cases observed in the suite rows, and the 9 triage cases. So they are page history, not port bugs.
- **The mechanism, from source.** `InlineItemsBuilder::populateBreakingPositionCache` stores a box's item ends after the
  bidi splits (`InlineItemsBuilder.cpp:1082-1148`), and a later box with the same text, wrapping styles, nbsp mode and
  locale builds its items from them (`:858-900, :936-939`). `TextBreakingPositionContext` has no direction or bidi level
  (`TextBreakingPositionContext.h:48-80`). All 17 are the same text in several directions and widths.
- **Probe** (`probe-glue/`, one document): `ب` SHY `ب` NBSP `x` in 16px Arial, `break-word`, RTL at 0, 27.78 and 40px,
  equals the prediction. The LTR variant at 27.78px, observed after the RTL ones, gives `[0, 4)` `[4, 5)` where the port
  gives `[0, 2)` `[2, 5)`: the RTL box's cached ends include 4, which splits `NBSP x` into two items at one level, and
  `endsWithSoftWrapOpportunity` returns true there (`InlineFormattingUtils.cpp:342-346`).
- **The rest of MAIN-TRIAGE's webkit-host facts** (`isolate-triage/`, 6 cases in one fresh document): `c-7fcab2c1e2e0c85a`,
  `c-da5b8181a781b719` and `c-ea243dabb9a70fe7` pass alone (page history, all reporting `page-history`). `c-0774ff114d939edf`
  (`A` CR TAB `B`), `c-af325ec8545eb5af` and `c-d1da84746a9b926a` (`😀A` FF TAB `B`) fail alone: SUPERSET-webkit §3.4's CR
  and FF kerning, reported as `control-character-width`. With the 9 above, all 15 facts to learn outside
  `letter-spacing-ligatures` are accounted for.
- **Gap condition changed.** `page-history` is reported for a box of at least 3 items and 5 units whose item ends depend
  on what the key leaves out: strong RTL content or an RTL block (bidi splits), or preserved white space split at word
  separators or per space. It replaces the narrower white-space-only condition.

### Costs

measureText calls per paragraph (`prediction.measure.calls`), forward runs with the current library, and in parentheses the
first stage-5 runs, which equal the charter's:

| Run | mean | median | p90 | p95 | max |
|---|---|---|---|---|---|
| smoke r5 | 18.6 (16.4) | 11 (11) | 49 (37) | 69 (53) | 122 (86) |
| ws r5 | 18.0 (15.4) | 11 (11) | 39 (31) | 48 (37) | 100 (72) |
| policy r5 | 17.5 (16.0) | 12 (12) | 36 (35) | 63 (47) | 123 (99) |
| runs r4 | 25.1 (22.8) | 17 (17) | 55 (47) | 76 (61) | 140 (103) |
| suite sample r5 | 13.4 (12.5) | 6 (6) | 30 (30) | 38 (38) | 2,059 (2,059) |
| rule families r4 | 7.3 | 6 | 10 | 14 | 66 |
| feature families r2 | 9.1 | 6 | 18 | 23 | 29 |

The r2 runs already cost what r5 costs, so the shaping port added nothing on flat cases. The rise arrived between the
first runs and r2 (justify, bidi geometry, `font-fallback`, the `page-history` condition). Justify and bidi geometry make no
Canvas calls on flat cases, so it most likely comes from `font-fallback`'s LastResort context, one call per distinct code
point of fixed-pitch boxes; not isolated. The tree walk adds no Canvas call.

### Open

- Slot rows whose insets and text-indent can't all fit: native floats differ from the declared slots (lab and families
  owners).
- The known gaps stand: `letter-spacing-ligatures` (721 census cases; SUPERSET-webkit §3.3 needs the maintainer's decision
  on a connected `<canvas>`), `control-character-width` for CR and FF kerning (§3.4), and SUPERSET §3.6's leftover width,
  which no longer applies: lines carry display boxes, and the scorer derives extents.

## 2026-09-16: before stage 5

The charter tables for smoke, ws, policy, runs and the suite sample, the failure classes and the gap firing rates are in
this file's git history (committed with the charter merge, 7c3fcf9) and in REPORT.md §2-§4.
