# Blink port: structural shortcut audit

Scope: `rebuild/src/engines/blink` (3,461 lines without tests) and the shared code it calls: `measure/`, `unicode/grapheme.ts`, `unicode/bidi.ts`, `breaks/rbbi.ts`, `breaks/tables.ts`, `paint.ts`. All of it was read in full. Port functions were compared with the pinned source at `~/github/browser-engines/chromium-153.0.8010.48`. No browser was launched and nothing under `rebuild/src` was edited.

New data, all under `.artifacts/research-20260916/blink-shortcuts/`:

- `census.ts` / `census.json`: runs Blink `prepare()` in bun with a stand-in Canvas over every Chrome lab case (development and held-out, 40,703 cases). It records facts that don't depend on widths and joins them to the final Chrome forward per-case scores. Its totals equal REPORT §4's: 40,703 cases and 3,136 prediction failures.
- `space-in-lookups.c` / `space-in-lookups-all.tsv`: Blink's `HarfBuzzFace::HasSpaceInLigaturesOrKerning` (harfbuzz_face.cc:320-385), run with the system HarfBuzz over every installed font and the lab's fixture fonts.

Classes used below:

- (a) a ported rule, cited and faithful;
- (b) a Canvas recipe backed by source and a probe;
- (c) a named gap;
- (d) a choice made by lab score;
- (e) an uncited heuristic, allowlist or special case;
- (f) a structural simplification that will need rework.

"Prediction failure" means lineCount, breaks or widths fails.

## 1. The short answer

- **The Blink port is a real port where Blink's code can be ported.**
  - The line loop, ShapeLine, the break iterator, the units and the HanKerning rules follow 153's source function by function. I found no float epsilon, and the one `+1` is `LayoutUnit::AddEpsilon`.
  - Several things I expected to be shortcuts are correct at 153:
    - `IsOtherSpaceSeparator` is only U+3000 (character.h:156-158);
    - `text-autospace` defaults to `no-autospace` (css_properties.json5:6241-6247);
    - `text-spacing-trim: normal` never trims paragraph or wrapped-line starts (text_spacing_trim.h:22-35).
- **The shortcuts sit in the layer where Canvas stands in for HarfBuzz and Blink's style system**, and in the output definition:
  - one global model constant chosen by lab counts;
  - a rule for Canvas strings chosen from 29 probe strings;
  - a `width` output that copies the lab scorer;
  - two font-name allowlists;
  - block-level styles hard-wired into 12 sites.
- **Gap reporting is complete on paper but broad.** Only 3 of 3,136 prediction failures report no gap (REPORT §4). But two gaps fire on more than half of all cases and don't locate failures.

## 2. Checked against the 153 source: faithful ports (a)

| Port | Source at 153 | What I checked |
|---|---|---|
| `HandleText` line-breaker.ts:281-345 | line_breaker.cc:1322-1504 | leading-space skip, overflow path, `BreakText` outcomes, hanging spaces with `Rewind` |
| `BreakText` :368-409 | :1603-1759 | hyphen retry, `kNoResultIfOverflow` size `available + 1`, `can_break_after`, trailing state |
| `HandleTrailingSpaces` :570-618 | :2426-2534 | collapse branch, preserved-space item, `AddEmptyItem`, `kTrailing` |
| `HandleOverflow` :705-775 | :4079-4305 | walk-back, `inline_size − 1` (64 raw units), break-anywhere retry, hyphen restore |
| `RewindOverflow`, `Rewind`, `ComputeCurrentStyle` :801-875 | :4334-4533 | open-tag nesting count, empty-text loop, style lookup |
| `RemoveTrailingCollapsibleSpace` with helper, `RewindTrailingOpenTags` :879-938 | :2536-2747 | end states, U+3000 preserved, forced break skipped |
| `SplitTrailingBidiPreservedSpace` :941-970 | :2758-2853 | level check against the base, split sizes |
| `HandleForcedLineBreak`, `HandleControlItem` :627-670 | :2856-2999 | close tags and empty text after the break; tab, generated ZWSP, CR/FF |
| `ShapeLine` :438-567 | shaping_line_breaker.cc:266-612 | first safe offset, candidate, HanKerning end extension, previous/next opportunity, non-hangable run end, line-end reshape loop |
| `nextBreakablePosition`, `previousBreakOpportunity`, `shouldBreakFast` breaks.ts:216-312 | text_break_iterator.cc:216-484 | space rule, `-` + digit, fast table, break-all loose hyphens, keep-all, ICU `following` with SHY skip |
| `BREAK_ALL_ROWS` breaks.ts:43-54 | text_break_iterator.cc:48-110 | all 49 rows compared. It is hand-transcribed, not generated, and faithful |
| `canFitOnLine` line-breaker.ts:138-144 | line_breaker.h:307-317 (`AvailableWidthToFit = AddEpsilon`) | probes-chrome H1, H2, H9, X6 |
| HanKerning start and end context shape.ts:420-445, hankerning.ts:92-98 | han_kerning.cc:229-320 | `is_line_start`, `ShouldKern` / `ShouldKernLast`, `apply_end` |
| `tabShapeResult` shape.ts:637-660 | shape_result.cc:1906-1944, font.cc:318-340 | first tab from the position, others the base, half-space minimum |
| `offsetForPosition`, `positionForOffset` shape.ts:512-541 | shape_result.cc:2261-2363 | binary search, RTL border rule |
| content.ts `appendPreserveWhitespace`, leading-space ZWSP | inline_items_builder.cc:986-1136 | tab runs, ZWNJ split, CR/FF control items |
| `ShouldRemoveNewline` content.ts:112-115 | inline_items_builder.cc:67-151 | the East Asian width rule really is compiled out (`#define … 0`) |
| script.ts | script_run_iterator.cc | 47 of Chrome's own unit tests |

## 3. Catalogue

### (b) Canvas recipes with a probe

| Id | Where | Recipe | Source | Probe |
|---|---|---|---|---|
| B1 | shape.ts:216 | U+2028 in place of U+0020, so Canvas doesn't split words at spaces | harfbuzz_face.cc:110-113 maps U+2028 to the space glyph; plain_text_node.cc:84-91 doesn't delimit at it | blink-gaps-probes "H5-H8": `A V` in 4 fonts, one string. No spec records the verdict (TAKE-BACK 2.6). **Thin coverage.** |
| B2 | shape.ts:78 | `optimizeLegibility` contexts | font_fallback_list.cc:264-277 | blink-canvas H6 |
| B3 | shape.ts:217 | U+0001 for VT and FF | blink-gaps §2.8 | probes-chrome X2 (Arial, Helvetica Neue) |
| B4 | shape.ts:214-215 | U+2060 in place of SHY, ZWSP, LRM, RLM, U+202A..U+202E, U+FEFF | character.h:167-175 | blink-ignorables, 27 of 29 strings equal |
| B5 | shape.ts:143-178 | U+200D at call edges to get joined forms | hb-ot-shaper-arabic.cc (152 HarfBuzz) | blink-followups F1, blink-text H29 |
| B6 | hankerning.ts:50-76 | `halt` detected from 2·W(「) − W(「「); dot, colon and quote types from ink bounds | Canvas runs the same `HanKerning::FontData`, including the ten-glyph test (han_kerning.cc:405-535). So the pair trim is a faithful detector | blink-followups F2 (PingFang SC only) |
| B7 | shape.ts:304-316, 318-323 | pair adjustment d = R(xy) − R(x) − R(y), put on the glyph before k; "safe" when d = 0, the grapheme boundary holds and nothing joins | blink-gaps §3.4-§3.6 | blink-gaps-probes "H12" (unrecorded). **Only necessary, not sufficient.** |
| B8 | shape.ts:325-363 | a group of 256 zoomed px or more is halved | exactness limit of 16.16 in float32 (blink-canvas §1.5) | The cut location (a space edge first, nearest the middle) is invented; the census finds 1 case with `float32-precision` |

### (c) Named gaps

There are 19 `addGap` call sites over 12 names:

- `unsafe-to-break` 4
- `han-kerning` 4
- `font-fallback` 2
- one each: `control-character-width`, `soft-hyphen-shaping`, `script-context`, `in-word-prefix`, `tab-stops`, `optical-size`, `float32-precision`, `dictionary-breaks-unavailable`, `ui-language`

§5 judges how useful they are. Conditions found here that no gap reports:

- **C-u1. Canvas shapes CJK one character at a time for some fonts.**
  - Under `optimizeLegibility`, `ComputeCanShapeWordByWord` is true when the primary font's space glyph is in no GPOS or GSUB lookup (font_fallback_list.cc:264-277, harfbuzz_face.cc:320-385).
  - `PlainTextNode::SegmentWord` then delimits a 16-bit string at every CJK ideograph or symbol (plain_text_node.cc:93-155, 377-400). HanKerning between adjacent fullwidth marks and any kerning between CJK glyphs is then missing from the Canvas totals.
  - Lab families where this holds (`space-in-lookups-all.tsv`): Georgia, Helvetica Neue, Verdana, Menlo, Songti SC, Thonburi, Geeza Pro, Kohinoor Devanagari, Myanmar MN, Khmer Sangam MN. It doesn't hold for Arial, Times New Roman, Courier New, PingFang SC/TC, Hiragino Sans, Apple SD Gothic Neo, Amiri or Noto Naskh Arabic.
  - Census: 1,302 cases put CJK text in such a font, with 12 prediction failures. 109 cases have an adjacent HanKerning pair in such a font, with 3 failures, one of them the keycap case `c-8862f0d3be757916`. A small cost today, but nothing reports it.
- **C-u2.** The Blink hyphen test (E2) is wrong when a later family in the list maps U+2010, or when Courier New or Georgia isn't installed. Blink never reports `hyphen-glyph`.
- **C-u3.** Fonts with an `opsz` axis other than the system UI font, at zoom ≠ 1 (E1). Nothing reports it.
- **C-u4. U+FFFC.** It is reported as `font-fallback`, but all 183 lab cases holding it fail a prediction metric (lineCount 72, breaks 70, widths 109). A named gap with no recipe and a 100% failure rate should get a probe: which font draws it, and whether some character that Canvas doesn't normalize measures the same.

## 4. Details for (d), (e) and (f)

### D1. The joining model is a global constant chosen by lab counts

- **Port.** `JOINING_CONTEXT: 'opentype' | 'aat' = 'opentype'` (shape.ts:102-108). The comment gives the lab numbers behind the choice. One switch decides both the U+200D edges at group edges and at reshapes (shape.ts:143-150), and `joinsNextLine` (index.ts:271-281).
- **Engine.**
  - Every offset between joining letters is unsafe to break (hb-buffer.hh:517-527, hb-ot-shaper-arabic.cc:332, 366; the 152 HarfBuzz, since 153's dfdc088c isn't checked out).
  - OpenType fonts read the call's context; `morx` fonts don't (hb-ot-shape.cc:60-66, 100-101).
  - The font decides, and Canvas can't see which kind a font is.
- **Measured.**
  - 369 cases have a shaping-group edge between joining letters, and 318 fail a prediction metric.
  - Of the 328 that hold Geeza Pro or a family that falls back to it, 317 fail. Of the other 41, 1 fails.
  - Development 179 cases with 141 failures; held-out 190 with 177.
  - So the constant is right for OpenType fonts and fails almost every Geeza Pro edge. The choice follows the lab's font mix: case rows name Amiri 6,868 times and Noto Naskh Arabic 4,913 times, Geeza Pro 1,310 and Shantell Sans, which falls back to Geeza Pro, 5,095.
- **Cost.** Sites that use the system fallback on macOS (Geeza Pro) get wrong widths at every group edge and line edge inside an Arabic word.
- **Replacement.** I know of no Canvas-only test for "this font shapes with `morx`". So the principled options are:
  - (1) keep the gap, but state its condition as "the Arabic glyphs come from an AAT font", and record in DESIGN that the default was chosen by lab mix;
  - (2) take the fact as an input: a per-font joining fact the caller supplies, the way DESIGN already plans `fontKerning` and feature settings.
  - Don't tune the default further by lab counts.

### D2. Ignorables left out of 8-bit Canvas strings

- **Port.** shape.ts:223-235.
  - Where the string without the character would be 8-bit (an 8-bit paragraph, or 1-2 code units), the character is left out and the string keeps 8-bit storage.
  - Otherwise U+2060 goes in its place.
  - The comment admits the unknown: RLM before `((` in Amiri is 1,567 units natively, 1,567 left out and 2,814 with any substitute, "and its cause isn't known" (shape.ts:200-202).
- **Evidence.** The rule was picked because leaving the character out passed every probed Latin-1 string (blink-RESULTS "Follow-up"). Census: 3,056 cases take this path at prepare time, and 36 fail.
- **Cost.** A rule fitted to 29 strings, with one known unexplained case. Any `morx` substitution across a left-out character is wrong, and that is reported as `soft-hyphen-shaping`.
- **Replacement.**
  - Settle the RLM case with a probe before keeping the storage-based rule. Candidates: string storage, bidi run splitting in `PlainTextNode::SegmentText` (plain_text_node.cc:278-340), or the RLM changing the paragraph direction of the Canvas string.
  - If the cause is Canvas bidi, the rule should key on that, not on storage.

### D3. The public `width` copies the lab scorer's visibility rules

- **Port.** `paintedExtent` (index.ts:299-396) says it computes "the painted extent the lab observes (DESIGN.md §2.1; lab/score.ts markVisible and lineExtent)". Then:
  - `isOtherSpace` (index.ts:294-297) cites `lab/score.ts OTHER_SPACE`, whose own comment says "no engine's behaviour is verified here" (score.ts:62-63);
  - the generator emits White_Space and ink-less classes "which is how lab/score.ts classifies code points" (gen-blink-data.ts:78-79);
  - blink-AUDIT §8 B5: "paintedExtent follows score.ts's markVisible".
- **Engine.**
  - Blink's line width is `LineInfo::Width()` (line_breaker.cc:1149-1161). The port computes it as `engineWidth.raw` (index.ts:268).
  - Blink doesn't treat U+2000..U+200A, U+1680 or U+205F as hanging: `IsOtherSpaceSeparator` is U+3000 only (character.h:156-158). They are ordinary text with advances inside the line's width. The extent drops them.
- **Measured.** 1,182 cases hold such a character: 62 prediction failures, and widths unobserved on 738, because the scorer refuses those lines. The prediction and the observation drop the same thing, so the lab can't catch it.
- **Cost.** The `widths` metric partly tests that the port mirrors the scorer. An app that shrink-wraps or aligns lines needs Blink's line width, not an ink extent that leaves out leading and trailing controls, ignorables and thin spaces. index.ts spends 311 of its 482 lines on output and gap code (lineOutput 179-287, paintedExtent 289-396, gaps 84-177), and a third of that encodes lab conventions.
- **Replacement.** Make `width` the engine width (`raw / 64 / layoutZoom`). Move the extent derivation into the lab's predictor adapter (`rebuild/lab/predictor.ts`), next to the scorer it copies. Score `engineWidth` directly where the whole-node rects give the line box.

### E1. system-ui is detected by family name

- **Port.** `measuresAtCssSize` (shape.ts:63-66) returns true when the first family is `system-ui` or `BlinkMacSystemFont`. `optical-size` is reported only for those names (index.ts:105).
- **Engine.** Any typeface with an `opsz` axis gets `opsz` = the specified size when optical sizing is auto (font_platform_data_mac.mm:170-176). The system UI font is one such font, not the rule. Also, only the first family string is checked: `"Missing Font", system-ui` resolves to system-ui and isn't caught.
- **Measured.** 0 of 40,703 lab cases use these names, so the recipe is untested by the lab. It rests on probes-chrome correction 7 alone.
- **Replacement.** Test for size nonlinearity from Canvas, the observable effect: compare 16.16 W(S × z) with z × W(S) on a probe string in the run's font. Where they differ, measure at the CSS size and scale, or report `optical-size`. That covers any `opsz` font, not two names. The detection itself needs a probe.

### E2. The hyphen glyph test uses two fallback font names

- **Port.** shape.ts:620-631 measures `‐` in `family, "Courier New"` and in `family, Georgia`. Equal widths mean the primary font maps U+2010.
- **Engine.** `HyphenString` asks `PrimaryFont()->GlyphForCharacter(U+2010)` (computed_style.cc:1804-1820, cited from the 152 checkout, since `core/style` isn't in 153's).
- **Where it goes wrong.**
  - A later family in the list that maps U+2010 makes both measurements equal, so the port picks `‐` where Blink picks `-`.
  - A system missing either fallback font gives equal widths too.
  - Blink never reports `hyphen-glyph`.
- **Replacement.** Keep the recipe, but report `hyphen-glyph` for Blink whenever the family list has more than one family. Longer term, pick two fallbacks by a measured property (their U+2010 advances differ) rather than by name.

### E3. V8 string storage rules without a citation

- **Port.** shape.ts:223 (`p.segmented && codes.length - substituted.length > 2`) and shape.ts:238-239 (`('Ā' + s).slice(1)` forces a 16-bit string). The comment cites to_blink_string.cc:216-227, only in the 152 checkout, for Blink keying storage on V8's representation. The rule that 1-2 unit slices become 8-bit is V8's, and no V8 file is cited; `v8/` isn't in the 153 checkout.
- **Cost.** A V8 heap internal decides which Canvas shaping path runs. It isn't pinned and isn't tested in bun.
- **Replacement.** Check out V8 at Chrome 153's DEPS pin and cite the substring and concat factory rules, or probe W for each length from 1 to 13 as 8-bit and 16-bit, and test the construction.

### E4. Invented cut location for wide groups

- **Port.** shape.ts:331-363 prefers a space edge nearest the middle, then any safe offset, then the nearest cluster boundary with `unsafe-to-break`.
- **Assessment.** The 256 px trigger is from source. The location is invented, but harmless where the safe test is sufficient, and reported otherwise. It was reported on 1 case. Low risk; keep.

### F1. Block-level styles where Blink reads each item's style

- **Port.** `iteratorSettings` builds one settings object from the block (index.ts:18-51, "spans inherit them in this model"), and `setCurrentStyleForce` hands it to every style (line-breaker.ts:114-123). There are 12 sites that read the block's white-space or wrap settings:
  - content.ts:79, 328, 355;
  - line-breaker.ts:93, 117, 348, 359;
  - index.ts:21-49, 89, 189, 310, 433.
- **Engine.**
  - `SetCurrentStyleForce(item.Style())` (line_breaker.cc:4557-4643).
  - `item.Style()->ShouldCollapseWhiteSpaces()` in HandleText and HandleTrailingSpaces (:1341, :2455).
  - The nowrap-to-wrap opportunity recomputed in `HandleOpenTag` (:4003-4007).
  - The generated break opportunity at a nowrap-to-wrap collapsed space (inline_items_builder.cc:851-866, skipped at content.ts:183).
  - `RewindOverflow` reads `item.Style()` (:4353-4355).
- **Cost.** Per-span `white-space`, `word-break`, `overflow-wrap`, `line-break` or `hyphens`, and any nesting, touch all 12 sites and the model.
- **Replacement.** Carry the wrap properties on `BlinkStyle` (types.ts:19-29), read `styles[item.style]` wherever Blink reads `item.Style()`, and port the two skipped nowrap-to-wrap rules. This needs the tree-shaped model DESIGN-REVIEW §3.5 asks for.

### F2. Tags have no box sizes, and shaping groups ignore box edges

- **Port.** `handleOpenTag` and `handleCloseTag` add zero size (line-breaker.ts:672-702). `shapingGroups` (index.ts:58-82) never splits at box edges.
- **Engine.**
  - `ComputeOpenTagResult` and `ComputeInlineEndSize` add margin, border and padding to the position and force a line box (line_breaker.cc:3937-3984, 4010-4021).
  - `ShouldBreakShapingBeforeBox` and `ShouldBreakShapingAfterBox` end a group at non-zero padding, margin or border, or `vertical-align` other than baseline (inline_node.cc:494-527).
  - The painter already depends on that second rule: its Blink hyphen span uses `vertical-align: 0px` (paint.ts:60), a rule the engine doesn't model.
- **Cost.** Moderate and local. The handlers exist with the right shape.
- **Replacement.** Port the two size functions and the two box checks. Add `ShouldCreateLineBox` for boxes.

### F3. text-indent and tab offsets are dropped

- **Port.** The position starts at 0 (line-breaker.ts:72). `BlinkLineStart` (types.ts:120-130) has no "past the first formatted line" flag. Tabs use `this.position` alone (line-breaker.ts:633-635).
- **Engine.** `PrepareNextLine` sets `position_ = applied_text_indent_` (line_breaker.cc:878-879) when `ShouldApplyTextIndent` holds, on the first formatted line or after a forced break. Tabs use `position_ + ComputeFloatOffset() + tab_stop_offset_` (:2966-2972).
- **Replacement.**
  - Add the flag to the break token, as `InlineBreakToken::IsPastFirstFormattedLine` does.
  - Start the position from the indent.
  - Keep the float and tab stop offsets as explicit inputs.

### F4. The accurate line-end position is hard-coded off

- **Port.** The line end is never reshaped before a space (line-breaker.ts:526-528), and a trailing space is removed through a view (:902-904). Both assume `NeedsAccurateEndPosition` is false.
- **Engine.** It is true for `text-align: end`, `center`, `justify` and `match-parent`, for `left` in RTL and `right` in LTR (line_info.cc:127-150), and for box decoration backgrounds or text decorations (line_breaker.cc:255-262).
- **Replacement.** A `needsAccurateEndPosition` value computed per line from `text-align` and direction, read at those 2 sites and in `TruncateLineEndResult` (line_breaker.cc:2371-2405, which reshapes when it's true).

### F5. Line-box folding by look-ahead, and gaps written while lines are filled

- **Port.**
  - `firstLine` lays lines out at `p.paragraph.width` until one creates a line box (index.ts:444-452).
  - `nextLine` lays out the following line at the current line's width to decide folding (index.ts:466-471).
  - Gaps are written into the prepared paragraph from `nextLine`, the look-ahead lines and `measure16`, `addCuts`, the HanKerning functions and `tabShapeResult`: index.ts:461, 472; shape.ts:254, 265, 352, 358, 430, 443, 591, 595, 639.
- **Engine.** A line with no line box is still a line of its own (line_breaker.cc:945-975), and the layout algorithm skips it. No look-ahead.
- **Cost.**
  - Variable line widths (floats, shapes, a different width per line) fold at the wrong width.
  - The planned "prepare once, lay out at many widths" API (REPORT §7 item 6) would mix gaps from different widths.
  - Every line is laid out twice.
- **Replacement.**
  - Return lines with no line box as lines marked "creates no line box" and let `fillLines` skip them.
  - Move gaps that depend on the chosen breaks onto each line (DESIGN-REVIEW §3.5).

### F6. Slices of reshaped text are measured again

- **Port.** `truncateView` measures a reshaped part cut at an edge alone (shape.ts:602-616). It is used at line-breaker.ts:903, 960, 963 and index.ts:387, 390.
- **Engine.** `ShapeResultView::Create(result, start, end)` slices the reshaped glyphs without shaping again (shape_result_view.cc:310-322).
- **Cost.** A kerning or joining pair across the cut is lost where Blink keeps it. It's rare today, because line ends before a space aren't reshaped, but it grows with F4.
- **Replacement.** Keep a reshape's piece and pair adjustments, the way groups keep cuts and prefixes (types.ts:56-68), and slice from those.

### F7. One-to-one offset mapping

- **Port.** `sourceOffsets` holds one source offset per text_content unit, and `contentOffsets` one text_content unit per source unit (types.ts:95-101, content.ts:89-93). `lineOutput` rebuilds painted text unit by unit (index.ts:251-266).
- **Engine.** `OffsetMapping` with units that can map 1 to N.
- **Cost.** `text-transform` (`ß` → `SS`) doesn't fit the arrays.
- **Replacement.** Mapping units with ranges on both sides.

### F8. Only the item types the model produces

- **Port.** `BreakLine` dispatches text, open and close tags and controls (line-breaker.ts:268-276). The model has no `<br>`, `<wbr>`, atomic inlines, floats or bidi controls (types.ts:7-9). `layoutTextNeeded` assumes a flat list of runs (content.ts:316-342).
- **Engine.** line_breaker.cc:1052-1145 also handles floats, bidi controls, block-in-inline, ruby, atomic inlines and list markers.
- **Assessment.** The loop is shaped like Blink's, so adding handlers is additive. The model's node types are the real blocker.

### F9. hyphens: auto

- **Port.** `ShapeLine` has no hyphenation branches (shaping_line_breaker.cc:111-209).
- **Assessment.** No JavaScript API gives Chrome's hyphenation data, so this will be a named gap, not a port.

### F10. The break iterator scans the rest of the paragraph at every line start

- **Port.** `icuFlags` runs ICU over `text.slice(start)` to the end, and dictionary runs the same way (breaks.ts:121-157). The cost is O(remaining text) per line.
- **Engine.** Blink restarts ICU at each line start too, but lazily (text_break_iterator.h:159-163).
- **Assessment.** Correct results, and a structural cost behind the 884 ms maximum in REPORT §3. Scanning only as far as needed is the fix.

### F11. CR and FF control items are output as `collapsed`

- **Port.** index.ts:196-205 only marks text and tab results as painted, so the painter drops CR and FF controls. This matches REPORT §7 item 8. It is a small output fix.

## 5. Gap naming: complete on paper, broad in practice

- **Blink gaps from REPORT §4.** Lift is a gap's share of failing cases divided by its share of all-pass cases.

  | Gap | Cases reporting it | Lift |
  |---|---:|---:|
  | `in-word-prefix` | 22,718 of 40,703 | 1.1 |
  | `script-context` | 21,259 | 1.44 |
  | `soft-hyphen-shaping` | 4,741 | 0.93 |
  | `tab-stops` | 811 | 0.67 |
  | `han-kerning` | 503 | 0.81 |
  | `unsafe-to-break` | 5,392 | 24.95 |
  | `font-fallback` | 1,027 | 9.0 |
  | `control-character-width` | 4,379 | 5.24 |

- **The census adds attribution.**
  - `script-context` is reported at prepare time on 1,457 8-bit paragraphs, and only 1 fails (`c-ce9a56bfc13a2cb6`). In an 8-bit paragraph the DOM shapes one Latin segment (inline_node.cc:1256-1266). The report comes from the port's own 16-bit Canvas strings, where U+2028 turns a digits-only word into Common script.
  - `soft-hyphen-shaping` at prepare time: 3,056 cases, 36 failures.
- **Why it matters.**
  - The brief's "handled on purpose or named" is formally met: 3 prediction failures with no gap.
  - But `in-word-prefix` names the admitted weak point of the recipe layer, a safe-to-break test that is necessary, not sufficient, and it fires on more than half of all paragraphs. When new fonts or scripts arrive, failures will land inside these broad gaps, and the gaps won't separate them.
- **Replacement.**
  - Report `in-word-prefix` and attribution only at chosen line edges where the pair window is actually insufficient.
  - Strengthen the safe test: compare R(word) = R(prefix to k) + R(suffix from k) over the whole word between spaces, not one grapheme on each side. Fonts don't read lookups across spaces unless the space is in their lookups, and `space-in-lookups.c` gives that fact per font.
  - Drop the `script-context` report where the paragraph is 8-bit and the difference comes only from the port's U+2028 strings.

## 6. Do the tests pin real engine behaviour?

`bun test rebuild/src/engines/blink` has 60 tests.

| File | Tests | What the expectations come from |
|---|---:|---|
| script.test.ts | 47 | Chrome's own `script_run_iterator_test.cc` cases over ICU data (63 TESTs there; the mock-data ones aren't ported). **Real engine expectations.** |
| breaks.test.ts | 3 | `lineTable`: 7 checks from the specs' table, partly confirmed by probes H14-H17 and H22. Worked examples: 7 from blink-text §2.F.5 (H11 confirms `x!é`, `x!a`). The "oracle" test: 13,108 requests with 0 differences, but the oracle is `oracle/blink/src/blink_oracle.cc`, a **C++ re-port of Chromium 152's `LazyLineBreakIterator`** over Chrome 153's `icudtl.dat`, not Chrome. Its header lists what isn't ported: break-all, `line-break: anywhere` and break-word retries, `break-spaces`, strictness keywords. The test compares `perLine[0]` only, one ICU pass from the start of the text, so restarts at line starts are untested. Inputs came from installed-browser rows; answers from another port of the same source. |
| content.test.ts | 6 | Spec examples (blink-text §2.C.4; H4 and H9 confirm some); D5 bidi, checked by the ICU oracle elsewhere |
| lines.test.ts | 4 | A stand-in Canvas at 10px per code point. The expected fragments and `engineWidth.raw 3200` are the port's own output model. Only the fit-bound test (lines.test.ts:59-63) encodes a probed Chrome rule (H1, H9). |

- **Not covered by any bun test:**
  - shape.ts (660 lines): Canvas strings, joining, pair adjustment, cuts, hyphen, tabs;
  - hankerning.ts;
  - ShapeLine reshapes, `HandleOverflow`, `RewindOverflow`;
  - `paintedExtent`.
  - The lab is their only check.
- **Blink's own tests could pin engine behaviour cheaply:**
  - `inline_items_builder_test.cc`: 31 TESTs, 1 of which builds a document. Text-only expectations for content.ts.
  - `text_break_iterator_test.cc`: 25, including BreakAllLooseHyphen, SoftHyphen, HyphenMinusBeforeHighLatin and the emoji keep tests.
  - `line_breaker_test.cc`: 44, of which 25 load Ahem. Every Ahem glyph is 1em, so a stand-in Canvas reproduces them exactly.
  - `shaping_line_breaker_test.cc`: 9.
  - `han_kerning_test.cc`: 6.
- **First-class candidates**, in order:
  - the 25 Ahem line-breaker tests and 31 items-builder tests, ported where the model can express the HTML;
  - the break-iterator tests;
  - the oracle test, widened to per-line restarts and the modes the C++ oracle skips, using `Intl.v8BreakIterator` or rows from installed Chrome instead of the re-port.

## 7. Where the port will slip, and where it is sound

**Sound, and safe to build on:**

- Break opportunities: generated from pinned `icudtl.dat` and Blink's generated pair table (gen-blink-data.ts checks sha256), ICU restarted per line, and a faithful `LazyLineBreakIterator`.
- Content building and bidi: an exact ICU `ubidi` port.
- The LineBreaker and ShapeLine control flow: handler for handler with 153 (§2). Future features mostly add handlers rather than change the loop.
- LayoutUnit arithmetic and the fit test: probe-confirmed.
- HanKerning context rules: faithful to 153, after audit findings B1 and B2 were fixed.
- Where failures are: 2,956 of 3,136 Chrome prediction failures are in bidi-enabled paragraphs; 8-bit paragraphs fail 33 of 10,130.

**Where it will slip as issues appear:**

1. **Glyph positions come from Canvas totals.**
   - Positions are prefix + pair adjustment, and "safe to break" is a pair test that is only necessary.
   - Any font with contextual lookups wider than one grapheme per side, or proportional CJK kerning, makes line-edge widths silently wrong, under a gap that fires on half of all cases.
   - Pinning is also weak here: 23 of the 180 file:line citations in the Blink sources resolve only in the 152 checkout (HarfBuzz ×9 files, element.cc, text.cc, computed_style.cc, to_blink_string.cc), and V8 isn't cited at all.
2. **The joining constant (D1)** fails 317 of 328 Geeza Pro group-edge cases by construction.
3. **Canvas string rules are piling up** in one 36-line function (shape.ts:205-240): U+2028, U+2060, U+0001, leave-out-if-8-bit, a 1-2 unit storage rule and forced 16-bit storage. Each is probed on a narrow set; their interactions aren't tested in bun, and one case is unexplained.
4. **The `width` output mirrors the lab (D3)**, so a shared blind spot passes as unobserved instead of failing.
5. **Fixed styles are hard-wired (F1-F4, F7, F8).** Per-span wrap styles, inline box padding, text-indent, text-align other than start, `<br>` and text-transform each need changes at known sites. The loop structure is right, but the style plumbing and offset mapping aren't.
6. **Look-ahead folding and gaps written during line filling (F5)** will break variable widths and a prepare-once API.
7. **Two unreported font conditions (C-u1, E1)**, cheap to report now.
