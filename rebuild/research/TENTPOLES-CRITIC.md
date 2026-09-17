# Critique: tentpole research against rebuild/CHARTER.md

These are the five research outputs:
- **A:** the Blink observation model.
- **B:** the WebKit observation model.
- **C:** the Gecko observation model.
- **D:** the rule catalogue and coverage matrix.
- **E:** the test architecture.

Each is checked against the charter's tentpoles:
- **1:** engine-true output.
- **2:** observation ported from source.
- **3:** rules from source, facts from browsers.
- **4:** tests designed for the rebuild.
- **5:** main as an external corpus.
- **6:** explicit environment.

Paths are relative to the pinned checkouts:
- **C153** is `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/`.
- **W** is `~/github/browser-engines/webkit-7625.1.29.11.27/Source/WebCore/`.
- **F** is `~/github/browser-engines/firefox-156.0/`.

No browser ran, and nothing under `rebuild/` was edited.

## 0. Verdict in one paragraph per document

- **A, Blink observation.**
  - **Strengths:** ported line by line from `LayoutText::AbsoluteQuadsForRange`, and every citation I checked is right. It explains Chrome's duplicate soft-hyphen box from one flag. Inferences are marked `[I]`.
  - **What stays open:**
    - The output could live "behind a debug flag", which the charter rules out.
    - Inner caret positions are presented as exactly comparable, although the library gets them from Canvas prefix widths.
    - Lines are still grouped by vertical centre, the scorer's rule.
    - Its evidence from rows is aggregate consistency, not predicted rects.
- **B, WebKit observation.**
  - **Strengths:** faithful to RenderText and `snappedSelectionRect`. The rounding census is strong: 1,020,959 partial rects, 0 unexplained.
  - **What stays open:**
    - It labels facts Safari does report (interior edges, the right edge of a box's last code point) as "unobservable by rule". They are limits on prediction, and the charter allows only rules to mark facts unobservable.
    - It misses that its own source line says the RTL content edge differs from the port's with hanging content.
- **C, Gecko observation.**
  - **Strengths:** the rounding rule replaces a tolerance-like allowance with an exact rule, which is the largest single gain for the charter here.
  - **What stays open:**
    - "Reproduces all 1,431,864 rects" overstates it: the census checks the au-to-DOMRect step, not frame geometry.
    - Its exact comparison of rect x and width rests on the port's in-word advance, whose U+200D suffix variant was chosen by lab score (gecko audit D1).
    - It keeps the lab's visible extent as a metric (E6).
- **D, rule catalogue.** It delivers the matrix tentpole 4 asks for, but its definition of covered is weaker than the charter's.
  - 150 rules counted as covered by lab evidence alone, plus 10 covered only by main-derived cases, have no rule-targeted family, so under the charter they are uncovered.
  - Failure shares joined to rules invite choosing rules by score.
  - Rules with no confirming verdict are listed as coverage gaps. Under tentpole 3 they are deviations.
- **E, test architecture.** The best fit to the charter: an independence rule, sealed held-out sets, fact files per build, lock files with engine-library oracles, triage records and page history as an input.
  - The threshold prototype adds grapheme widths, which the observation models show overshoots in Chrome and Safari.
  - The scorer it keeps as L0 carries a height tolerance (`rebuild/lab/score.ts:518`) that no document names.
  - One triage example files a Chrome fact under main's API-contract family `emergency-graphemes`.

## 1. Citations checked at the pinned tags (41)

Content right in all 41. Six line numbers are off by 3 to 19 lines; one citation is partial.

### Blink (A, and E's fit bound)

| # | Claim | Citation | Result |
|---|---|---|---|
| 1 | Every rect comes from the item walk; a hyphen is included only if the last end was included | C153 `core/layout/layout_text.cc:556-648`, `:593`, `:604-609`, `:617-621` ("Hyphens. Include if the last end was included."), `:638-646` (boundary quads only when nothing covers the range) | exact |
| 2 | A whole item reports its size unrounded | `core/layout/inline/fragment_item.cc:1217-1219` | exact |
| 3 | A slice uses kToStart/kToEnd caret positions, rounded outward; flow control uses 0 or its size, 0 in RTL | `fragment_item.cc:1147-1164`, `:1165-1192` | exact |
| 4 | Caret rects round to nearest, not outward | `fragment_item.cc:1110-1113` (`FromFloatRound`) | exact |
| 5 | Encompass rounding: floor the start, ceil the end, floor both when equal | `platform/geometry/layout_unit.h:164-184`, `:134-142` | exact |
| 6 | A node without a LayoutText reports nothing; `text-transform` TODO | `core/dom/range.cc:1760-1762`, `:1764-1766` | exact |
| 7 | CR and FF in preserving modes create no fragment | `core/layout/inline/line_breaker.cc:2988-2994` → `HandleEmptyText :2034-2042` → `AddEmptyItem :600-603` calls `AddItem(item, current_.text_offset)`, an empty result → `logical_line_builder.cc:429-433` returns | exact. This upgrades A's `[I]` to read source and settles the conflict with REPORT §7 item 8 |
| 8 | Position just after the text is 0 in RTL, the width in LTR; logical to visual | `platform/fonts/shaping/shape_result.cc:727-730`, `:706-711` (inside `PositionForOffset`, which `CaretPositionForOffset :735-741` calls) | exact |
| 9 | Leading collapsible spaces are skipped at a line start | `line_breaker.cc:1337-1350` | exact |
| 10 | U+2028 and U+2029 shape as the space glyph | `platform/fonts/shaping/harfbuzz_face.cc:104-113` | exact |
| 11 | An RTL line starts at −hangWidth | `core/layout/inline/inline_layout_algorithm.cc:303-311` | exact |
| 12 | `CurrentLocalRect` → `LocalRect` | `core/layout/inline/inline_cursor.cc:510-518` | exact |
| 13 | (E) The fit bound is available + 1 LayoutUnit | `core/layout/inline/line_breaker.h:307-317` | exact |
| 14 | (E) "a line ending at a space isn't reshaped under text-align: start" | `line_breaker.cc:255-268` | **partial:** those lines only read box decoration, text decoration and `LineInfo::NeedsAccurateEndPosition`. The text-align part is in `line_info.cc:127-150` (blink audit F4) |

### WebKit (B)

| # | Claim | Citation | Result |
|---|---|---|---|
| 15 | Client rects call with no flags | W `rendering/RenderObject.cpp:2359-2362` | exact |
| 16 | Range clamped to caretMin and caretMax | `rendering/RenderText.cpp:777-783` | exact |
| 17 | Whole-box branch uses the float visual rect | cited `:811-826` | **off by lines:** `:815-831` |
| 18 | Caret case and trailing-content rule | cited `:360-366`, `:368-375` | **off by lines:** `:357-371`, `:373-380`. Pseudo-code matches |
| 19 | Zero height is skipped; a zero-width rect with positive height is kept | `:725-726`; cited `:829-830` for the keep | **off by lines:** keep is at `:832-834`. `FloatRect::isZero` → `FloatSize::isZero` (`platform/graphics/FloatSize.h:183-186`) needs both dimensions near 0, so the claim holds |
| 20 | Partial rects snap to whole px, clamped to trunc64 of the box right | `rendering/LegacyInlineTextBox.cpp:146-160`; `platform/graphics/LayoutRect.cpp:206-213` | exact |
| 21 | Box width is `f32(right − left)` | `platform/graphics/FloatQuad.cpp:90-99` | exact |
| 22 | RTL moves by total − after; width is fromFloatCeil | `platform/graphics/FontCascade.cpp:1668-1681` | exact |
| 23 | Kerning forces the complex path for partial ranges | `FontCascade.cpp:603-621`, `:673-684`, `:708-731` | exact under the lab's fixed styles. But `:610-611` (fixed-pitch selection) is reachable when kerning is off; see §2.B |
| 24 | Advance shares by UTF-16 units; `.notdef` for controls | `platform/graphics/ComplexTextController.cpp:558-575`, `:773-780` | exact |
| 25 | Space-like and zero-width character sets | `platform/graphics/FontCascadeInlines.h:140-143`, `:160-175` | exact |
| 26 | Collapsed trailing white space starts a new run; ZWSP separator starts a new run | cited `InlineLine.cpp:386-387`, `:394-395` | first right (`:385-386`); second **off by lines:** `:390-391` (`:394-398` is the RTL preserved-white-space rule) |
| 27 | Detaching trailing white space happens only for justify | `layout/formattingContexts/inline/InlineLineBuilder.cpp:693-699` | exact |
| 28 | A chosen hyphen extends the selectable end | `rendering/TextBoxSelectableRange.h:40-54`; `layout/integration/inline/InlineIteratorBoxModernPath.h:76-97` | exact |
| 29 | LayoutUnit from double truncates; fromFloatCeil | `platform/LayoutUnit.h:83-86`, `:93-96` | exact |
| 30 | RTL content edge | cited `InlineDisplayLineBuilder.cpp:117-127` | **off by lines:** the rule is `:136-138`. Its comment says "with hanging content lineLayoutResult.contentGeometry.logicalRight is not the same as rootLineBoxRect.right()". That is B's open question §12, already answered by source |

Also checked: `platform/text/WritingMode.h:104`, `:321`. `isLogicalLeftLineLeft` is false only for sideways-lr, so B leaving out `RenderText.cpp:391-392` is right for horizontal text. B should say so.

### Gecko (C)

| # | Claim | Citation | Result |
|---|---|---|---|
| 31 | One rect per overlapping continuation, cut at offset points | F `dom/base/AbstractRange.cpp:771-831`, `:804-815` | exact |
| 32 | Points clamp into the already-cut rect | `AbstractRange.cpp:715-765`, `:741-743` | exact |
| 33 | Rects are relative to the root frame | `layout/base/nsLayoutUtils.cpp:3698-3700` | exact |
| 34 | Round to 1/65536 px, then narrow each field to float32 | `dom/base/DOMRect.cpp:152-164`; `DOMRect.h:122-127` (`SetRect(float×4)`), `:97` (double storage) | exact |
| 35 | Points snap to the cluster start inside trimmed offsets; ceil of the advance | `layout/generic/nsTextFrame.cpp:8667-8690`, `:8692-8719`, `:8731-8735` | exact |
| 36 | End-of-line trimmable set includes TAB, CR, FF and LF, not VT | `nsTextFrame.cpp:921-942` (cited `:922-944`) | exact |
| 37 | Frames already trimmed at a break aren't trimmed again; the delta is floored and unclamped | `nsTextFrame.cpp:11576-11592`, `:11605` | exact |
| 38 | `pre-wrap` hangs only the overflowing part; frame size is ceil(max(0, advance)) | `nsTextFrame.cpp:11216-11229`, `:11272-11273` | exact |
| 39 | Negative hang shift under `text-align: start` on wrapped lines | `layout/generic/nsLineLayout.cpp:3508-3515`, `:3594-3602` | exact |
| 40 | Bidi is enabled document-wide by any bidi text node | `dom/base/CharacterData.cpp:299-302`, `:409-411` | exact |
| 41 | `CharIsSpace` means U+0020 and U+3000 | cited `gfx/thebes/gfxFont.cpp:749-750` | content right: that line sets the flag, which `gfxTextRun.h:133-135` reads |

## 2. Document by document

### A. Blink observation model

**What follows the charter:**
- Observation is a port of `AbsoluteQuadsForRange` with its hyphen flag, not a list of visibility rules (tentpole 2).
- Unobservable facts U1-U8 each come from a rule in that code.
- It corrects two inherited claims:
  - the lab's "U+2028 copy" is really an odd-level hyphen copy;
  - REPORT §7 item 8 is wrong. Row 7 above confirms the correction from source.
- It proposes scoring widths as `LineInfo::Width` with hanging spaces included, taken from whole-node rects, not the scorer's extent (audit D3).

**Inherited opinions or fitted rules still present:**
1. **Debug-flag option (§10).** "Carry `BlinkObservedLayout` … next to `lines`, or behind a debug flag." Tentpole 1 says the output is what the engine computes. A debug flag leaves the public `width` (`rebuild/src/engines/blink/index.ts:283`, `paintedExtent :306-395`) as the observed extent, which is the known deviation.
2. **Inner edges presented as comparable (§8, "Positions inside a line").** A says the lab can check which glyph carries a kerning adjustment "to one unit". But the port's caret positions come from Canvas prefix measurements (`shape.ts:551-615`, 16.16 prefix sums), not HarfBuzz per-glyph advances.
   - A mismatch there is usually a Canvas limit (`in-word-prefix`, `unsafe-to-break`), not an observation failure.
   - A names a gap only for ligature shares. It must say which comparisons run under which named gap.
3. **Aggregate evidence stands in for validation (§7).** Counts such as "609,708 pairs overlap by one unit" and "66,375 identical copies" show the rows are consistent with the rounding and copy rules. No predicted rect was compared with a row, because the engine doesn't emit items yet, so the model's exactness is untested.
4. **Centre clustering stays (§4.8, U7).** Line membership still comes from the scorer's centre clustering, a lab rule inherited from main's observer. A predicted rect carries its engine line index, so the comparison can match rects per node by line index. Clustering remains only for native rows across nodes, as a named assumption, until vertical metrics are ported.
5. **HarfBuzz at 152.** HarfBuzz cluster rules are cited from Chromium 152 (`hb-ot-shape.cc:466-522`) while the charter pins 153. Add the 153 HarfBuzz roll to the sparse checkout (add only), or fetch it through gitiles.
6. **Untraced line-breaking cases.** `c-16ed8328a8304ca6` and `c-00272aea15923712` report two zero-width rects on a soft hyphen that the port places inside a line. That points at a possible line-breaker port bug, not an observation rule, and it should be traced before the observation port declares exactness.

### B. WebKit observation model

**What follows the charter:**
- Box-level port with source for every rounding step.
- Corrects the lab README twice:
  - Safari splits cluster advances; it doesn't copy rects.
  - Box-start edges snap too.
- Proposes emitting display boxes (`DisplayBox`) as engine-true output and deleting `paintedExtent` (`rebuild/src/engines/webkit/lines.ts:1489-1565`).

**Inherited opinions or fitted rules still present:**
1. **U2 and U4 are prediction limits, not observation rules.**
   - Safari reports interior code point edges to 1px. The library can't predict them from Canvas, but that makes them a named gap (`in-word-prefix` or a letter-share gap), not unobservable.
   - U4, the right edge of a box's last code point, is decided by `A.total`, the in-context advance of the box's rendered text. Canvas `measureText` of the same string shapes it once too, with B's own caveats (locale, ligatures under letter spacing), so U4 is predictable under `canvas-language` and `letter-spacing-ligatures`.
   - Marking these unobservable would let the lab stop scoring content Safari does show, which tentpole 2 forbids.
2. **U3 needs the same split.** "Whether CoreText gives a code point a glyph" can't be seen through Canvas, but a positive or zero rect is observed, so it is a gap, not unobservability.
3. **RTL open item already answered.** §12 lists as open whether the port's `lastRunLogicalRight` equals `contentGeometry.logicalRightIncludingNegativeMargin`. `W/layout/formattingContexts/inline/display/InlineDisplayLineBuilder.cpp:138` says they differ with hanging content. The port's RTL box geometry is therefore wrong for RTL lines with hanging white space. Fix that in the port.
4. **Fixed-pitch selection branch missing.** `FontCascade.cpp:610-611` runs `adjustSelectionRectForSimpleTextWithFixedPitch` when the code path isn't complex. That happens when kerning is off or the text rendering is `optimizeSpeed`, both planned `Paragraph` fields in DESIGN.md §1.1. The pseudo-code covers only the complex path. Add the branch, or name the missing branch, before those fields land.
5. **Centre clustering across nodes.** "Line order across nodes stays an observation assumption (centres half a line height apart)" is inherited from the scorer. Keep it only as a named assumption with an owner until vertical metrics are ported.
6. **Census scope.** The census mixes webkit-host rows and installed Safari rows. Under tentpole 6 the host is its own environment key, which B records. Held-out rows weren't censused, which is moot, because E burns that set.

### C. Gecko observation model

**What follows the charter:**
- Exact rounding from source (`DOMRect::SetLayoutRect` then `SetRect(float)`), which retires the scorer's float32-step allowance.
- A chosen hyphen's width becomes observable exactly (F11), and the "other space separator" unobserved rule isn't needed for Firefox.
- The library's scorer-copying width (`rebuild/src/engines/gecko/lines.ts:605-744`) moves to the lab.
- Document-wide bidi and the negative hang shift are named as missing geometry.

**Inherited opinions or fitted rules still present:**
1. **Overstated census.** "Reproduces all 1,431,864 native rects" is an overstatement. The census inverts each rect to integer au and checks that the encoding gives the value back. That confirms the encoding, because a wrong rule would miss values, but it says nothing about frame boxes or points. Reword it as "every observed value is in the encoding's image".
2. **Point positions rest on a score-chosen recipe.** `pointAu` is the port's `advance(p, m, r.prov, r.prov.startT, t)` (`lines.ts:98-103`). The gecko audit says it serves two quantities (F7), and its in-word part uses the U+200D suffix variant that was kept for suite score and that probe A2 contradicts (gecko audit D1).
   - "E1: every rect's x and width, by exact double equality" therefore silently depends on a tentpole 3 violation.
   - Until D1 is replaced, code point edges inside a word are compared under `in-word-prefix`.
3. **The visible extent survives (E6).** "The visible extent the lab scores today, computed by lab code … with its own visibility rules" keeps main's observer definition of width as a metric. E3, the box union, should be the widths metric; E6 can only be a diagnostic.
4. **A lab definition inside the document (F4).** "Whether to count it in a line width is a lab definition" is a lab opinion. With E3 no definition is needed: the box either holds the U+3000 advance or doesn't.
5. **Environment scope.** The float32 round trip and its limit (2^23 au at apd 30) were checked only at apd 30. At apd 60 the device px transform differs. State the census scope as apd 30 (DPR 2).

### D. Rule catalogue and coverage matrix

**What follows the charter:**
- A catalogue of 399 rules with kind, source, probes, tests and code location: the matrix tentpole 4 asks for.
- Honest limits: stand-in Canvas, rarely-firing bound markers, skipped long obligations.

**Where it departs:**
1. **"Covered" is weaker than the charter's definition.** Tentpole 4 wants every rule to have at least one rule-targeted family at widths derived from observations. No such family exists yet. So the 150 rules with only lab evidence and the 10 covered only by main-derived cases are uncovered by the charter's definition, and "14 uncovered" misleads as a headline. Reach from `runs`, `ws`, `policy` or the suite sample shows that code ran, not that its threshold was exercised.
2. **Failure shares are a lab-score signal.** For example, "Blink OpenType joining constant 59% of 4,386". They may order triage, never justify keeping or changing a rule (tentpole 3). D doesn't say this, and its headline highlights the joining choices by failure share.
3. **Deviations filed as coverage gaps.**
   - 21 rules with no confirming probe verdict (class N).
   - The 41 heuristics, recipes, gaps and choices with only lab evidence.
   - Under tentpole 3 these are rules without a citation or a verdict.
   - The most-used example: `blink/measure/space-as-u2028` (`rebuild/src/engines/blink/shape.ts:210`), applied on every Blink measurement, has probes "run 2026-09-16 11:18, verdict not recorded in a spec".
4. **Asserting tests of uneven strength count the same.** WebKit's verdict tests assert through a test-local copy of the rule. Blink's oracle is a C++ re-port that checks one ICU pass. E §5 says oracles must be the engines' own libraries, so these should count as weak, not asserting.
5. **Ids aren't anchored in code.**
   - Catalogue ids (`blink/lines/fit-bound-plus-one-lu`) differ from E's annotation scheme (`blink/fit-bound`).
   - Probes and tests were mapped by reading, so the matrix can't be regenerated.
   - One scheme is needed, written in source comments, with `rules.json` generated from them.
6. **A live name key without a font input.** `webkit/content/fixed-pitch-by-family-name` (`rebuild/src/engines/webkit/content.ts:176`, reached on 1,987 / 2,238 / 1,792 cases) is catalogued as a heuristic whose engine source is `FontCoreText.cpp:753-785` (kCTFontMonoSpaceTrait). Tentpole 3 names the monospace trait as an explicit font-declaration input with a Canvas-observable default. The catalogue should mark it as a deviation to remove, not just a heuristic.

### E. Test architecture

**What follows the charter:**
- No expected value from `rebuild/src`, enforced by a test.
- Held-out sets sealed with committed hashes and counts-only scoring.
- Facts per browser build with declared scope and verdict rules inside the probe.
- Lock files whose oracles are engine libraries, and optional tests that skip become failures (`rebuild/src/engines/blink/breaks.test.ts:87`).
- Triage records replace main's required lists (`rebuild/lab/cases/obligations.ts:35-57` keys first-class status on main's origin labels).
- Page history is an explicit prelude input.
- The environment key comes from app bundles.

**Where it departs:**
1. **Pass B adds grapheme widths.**
   - `threshold-derivation.ts:97-102` sums per-grapheme union widths.
   - Chrome: A shows adjacent code point rects overlap by one LayoutUnit on 609,708 of 991,521 LTR pairs, because each slice rounds outward. A sum overshoots by up to one LayoutUnit per grapheme boundary.
   - Safari: B shows every partial rect snaps to whole px, so a sum overshoots by up to about 1px per grapheme. E's "Safari extents good to about 1px" holds only with edge differences.
   - Firefox: points are integer au, so sums are exact.
   - The prototype's 1px sweeps hide this, which may be why 197 of 214 transitions matched. At pass C's T and one grid unit below, most Chrome and nearly all Safari brackets would fall to pass D.
   - Fix: extent [s, k) = right edge of the last grapheme minus left edge of the first, one floor and one ceil. In Chrome, where k ends an item, use the item's whole rect.
2. **The kept scorer has a tolerance.** `rebuild/lab/score.ts:518`: `tolerance = Number.isInteger(p.lineHeight) ? 0.5 : Math.max(0.5, lines.length)` for the height consistency check. E keeps `deriveNative` as L0 without naming it; the charter says no tolerances. The same goes for:
   - the `hyphenBoxes` filter (`score.ts:314-320`), which A now explains from source;
   - the zero-area-line rule and centre clustering (`score.ts:349-354`).
   These should become ported observation rules or explicitly named observer assumptions with owners.
3. **Main's contract name in triage.** `c-9c5a66597ebf5aef` "joins the `emergency-graphemes` family". That name and group are main's API contract (research/TESTS.md §1d item 5; `obligations.ts:52-53`). Name the family after the engine rule (catalogue `blink/breaks/break-character-graphemes`, Blink's break-anywhere retry) with probe provenance.
4. **Candidate facts are hypotheses, not facts.**
   - `c-08bceab4491a000c` (U+202F after `）`, letter spacing −2px at 49px) looks like an overflow path, not a GL-class pair rule.
   - The lam-alef emergency-break fact cites shape_result.cc second-hand through the Blink audit.
   - Neither enters a fact file until its probe runs.
5. **DPR scoping is judgment.** "Only families whose rules read DPR run under forced DPR 1" is decided by reading. Each rule should declare its environment axes with a source citation in its annotation, so the coverage tool picks the DPR families.
6. **The independence boundary needs one more exemption.** Tentpole 2's observation ports (`lab/observe/`) must read engine geometry types. Allow type imports from `rebuild/src/model.ts`, never engine logic.
7. **G0 blocks while main-derived pairs are untriaged.** The charter's last known deviation calls obligations and baselines measurement inputs until triage. Removing the scorer-copying `width` will lose width pairs in G0 by construction. E's step 9 re-seeds for scorer changes, but G0 pairs from `obligations` should be report-only until triaged, not blocking.

## 3. Conflicts between the documents and with existing docs

1. **Three output shapes, one architect decision.** A has items with caret functions and the offset mapping. B has display boxes with a hyphen flag. C has frames with measured starts and a point function. The architect decides the shared `model.ts` change: per-engine typed geometry in engine units, always returned (tentpole 8 defers the cost).
2. **Caret and point functions are closures over Canvas widths.** Validating them offline against existing rows needs the full call log (E's L3). Today rows keep only a count (`rebuild/lab/types.ts:90-94`).
3. **REPORT §7 item 8 is wrong.** It proposes zero-width `text` fragments for Blink CR and FF. Source (row 7) shows no fragment: model them as items with no fragment. The port marks them `collapsed` today (`rebuild/src/engines/blink/index.ts:196-205`, audit F11), which is also wrong for observation: they are uncovered but not collapsed in the offset mapping, so they report two boundary rects, like trimmed spaces.
4. **DESIGN.md is stale in two places.**
   - `rebuild/DESIGN.md:184` still defines `width` as "the extent the lab observes".
   - `rebuild/DESIGN.md:37-38` says no probe verdicts are recorded and `specs/PROBES.md` doesn't exist, but `rebuild/specs/PROBES.md` exists.
5. **Two rule id schemes** (D against E §2.1).
6. **research/TESTS.md §1a** makes main's accuracy grid, oracles and filed reports first-class obligations. E admits main's tests only through triage. E's rule should win; demote TESTS.md's first-class verdicts to measurement inputs.

## 4. What the implementation phase must do first, in order

**P0: make exact observation comparison possible**
1. **Full call logs.** Record the Canvas call log in lab rows: context settings, text and width for every `measureText` call. This enables offline replay (E L3) and offline validation of every observation port. It touches `lab/run.ts`, `page.ts` and `types.ts`, so it waits until the census finishes.
2. **Engine-true geometry in `model.ts`.** One architect decision covering:
   - Blink: fragment items with LayoutUnit x and size, direction, text_content offsets, caret tables and the offset mapping;
   - WebKit: display boxes per line from the closed run list, with `needsHyphen`;
   - Gecko: frames with content range, measured start, box au, x au and point table.
   Carry the line index everywhere, and no debug flag.
3. **Observation ports.** `lab/observe/{blink,webkit,gecko}.ts` from A, B and C with the corrections above: B's fixed-pitch branch, the RTL edge at `InlineDisplayLineBuilder.cpp:136-138`, C's wording of its census.
   - Validate on existing rows through replay: whole-node box lists first (B E1, C E3, A's node rects), then code point rects.
   - Report exact agreement per rule.
   - Then remove each engine's scorer-copying `width` in a second commit, gated against a v2 scorer seed (E §8 step 9).
4. **Re-sort every "unobservable" item in A, B and C.**
   - Unobservable by rule: the rects are identical either way.
   - Predicted under a named gap: Safari interior edges and last-box edges, Blink inner caret positions, Gecko in-word points.
   Only the first may suppress a comparison.

**P1: remove tentpole 3 deviations on live paths**

5. **Replace choices by score and name keys** with source- or probe-backed rules, or explicit font-declaration inputs with Canvas-observable defaults:
   - Blink `JOINING_CONTEXT` (`index.ts:273`, font technology input);
   - Gecko U+200D suffix (`gecko/lines.ts:46`; probe A2 contradicts it);
   - WebKit `FIXED_PITCH_FAMILIES` (`webkit/content.ts:176`, monospace trait input);
   - Blink system-ui name key;
   - WebKit gap conditions reshaped by counts (audit D2).
6. **Record verdicts** in E's fact format for recipes used on every measurement: `blink/measure/space-as-u2028`, `ignorables-as-u2060`, and the other rules whose probes have no confirming verdict.
7. **Drop REPORT §7 item 8.** Model Blink CR and FF in preserving modes as items with no fragment (row 7).
8. **Trace the untraced cases** before calling the ports exact: A's P5 cases (`c-16ed8328a8304ca6`, `c-00272aea15923712`), B's `c-8a8ef1c653dff4ab`, and E's four Hiragino transitions.

**P2: tests the charter asks for**

9. **Fix pass B extents** to edge differences. Build passes A-D for the first five rules: HanKerning line-end trim, Blink fit bound, WebKit carried remainder, Gecko redo, WebKit following space.
10. **One rule id scheme** written in source comments. Regenerate `rules.json` from annotations. "Covered" means a parity test with an engine-library oracle, a recorded fact verdict or a rule-targeted family; reach from generic or main-derived families is measurement only.
11. **G0 and obligations pairs report-only until triaged.** Start triage records from Chrome's complete census (670 class C rows).
12. **Replace the scorer's height tolerance** (`score.ts:518`), the soft-hyphen box filter and centre clustering with ported observation rules (vertical metrics) or explicitly named observer assumptions.
13. **Facts, locks and held-out.**
    - Facts extractor and differ; lock files; skipped oracle tests become failures.
    - Seal a new held-out set and move `heldout-20260916` to development.

**P3: housekeeping**

14. Sparse-add Chromium 153's HarfBuzz (add only) and re-cite A's cluster rules at 153.
15. Correct `DESIGN.md:37-38` and `:184`, lab README's cluster-copy and U+2028 claims, and research/TESTS.md's first-class verdicts.
