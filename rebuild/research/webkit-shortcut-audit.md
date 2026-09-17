# WebKit port: structural shortcut audit

Scope: `rebuild/src/engines/webkit` at c72550a (3,180 lines without tests), plus the shared code it calls: `measure/`, `unicode/bidi.ts`, `unicode/ubidi.ts`, `unicode/grapheme.ts`, `breaks/rbbi.ts`, `breaks/tables.ts`, `paint.ts`, `model.ts`, `env.ts`, `index.ts`, and the generator `tools/gen-webkit-data.ts`. I read all of it.

Checked against the pinned source, `~/github/browser-engines/webkit-7625.1.29.11.27`, at these places. Abbreviations: IL = InlineLine.cpp, ICB = InlineContentBreaker.cpp, TOS = TextOnlySimpleLineBuilder.cpp, RBB = RangeBasedLineBuilder.cpp, ILB = InlineLineBuilder.cpp, IFU = InlineFormattingUtils.cpp, IFC = InlineFormattingContext.cpp, IIB = InlineItemsBuilder.cpp, ALB = AbstractLineBuilder.cpp, TU = text/TextUtil.cpp, IDCB = display/InlineDisplayContentBuilder.cpp.

- builder eligibility: TOS:488-528, RBB:131-184, IFC:170-184;
- items and widths: IIB:133, 550-600, 777-856, 924-1051, 1150-1154;
- placement and line ending: ILB:385-499, 499-710, 1030-1185, 1432-1485, 1726-1811, 1889-1916;
- wrap opportunities and next line start: IFU:278-544; the line loop: IFC:293-360;
- breaking: ICB:270-365, 875-915; Line: IL:198-287, 346-481; HangingContent: InlineLine.h:370-376; carry: ALB:54-98;
- TU:54-122, 621-624; FontCascade.cpp:486-510; FontCoreText.cpp:753-785; FontCascadeInlines.h:76-94, 188;
- RenderTreeUpdater.cpp:536-595; IDCB:119-144, 196+; SettingsBaseCocoa.mm:62.

For `breakWord`, `firstUserPerceivedCharacterLength` and `appendTextFast` I rely on webkit-AUDIT §3, which checked them at the pinned lines. No browser was launched. The data behind the counts is in `.artifacts/research-20260916/webkit-shortcut-audit/catalogue.json`.

## 1. Answer first

**Did the WebKit port take the brief seriously?** In the parts the brief can check, yes:

- **Break data:** BreakablePositions is checked against a dump of the compiled `classify` over all 65,536 code units in both no-break-space modes (131,072 lookups) and the 1,547-pair table. The libicucore tables are dumped from the OS, and ubidi matches both ICUs with 0 differences.
- **Fit arithmetic:** float32 sums, and the only epsilon is the source's `LayoutUnit::epsilon()`.
- **Line filling:** all three line builders, ContinuousContent, InlineContentBreaker, and the width a split word carries to the next line.
- **Clean code:** nothing in the engine is keyed on a case id, and no tolerance was added. 95 of 144 top-level functions name their source file and lines in the comment above them; the rest are small helpers or output code.
- **Audit fixes cite source:** each fix after the audit points at source or a probe (B2 box geometry, B4 dictionary ranges, B5 probe).

**The shortcuts sit at three edges**, where Canvas can't see something or the brief was vague:

1. **Font identity.**
   - Fixed pitch comes from a 10-name allowlist of family names.
   - The hyphen is always measured as U+2010.
   - CR is measured as zero width.
2. **The output geometry.**
   - A line's `width` is defined as what the lab can observe, not what WebKit's display boxes hold.
   - Fragments come from a second list of the line's contents that the port keeps in step by hand.
3. **Gap reporting.**
   - The conditions are paragraph-level, and some were reshaped by counting lab rows.
   - 6 of the 10 WebKit gaps don't locate failures (REPORT §4).

**Where it would slip:** the model has one style for the whole block and flat, one-level spans. The port reduced every source style lookup to that one block style (50 reads) and treats inline boxes as zero-width markers. None of this shows in the lab, which has no per-span styles, padding, text-align, generic `monospace` or web fonts. It will show as soon as any of those land.

**Where it holds:** the port keeps the source's functions and signatures. For most features, the rework is porting more of a function it already has, not redesigning. The exceptions are the output layer and threading styles per box.

## 2. Counts

| What | Count | How |
|---|---:|---|
| Engine lines without tests | 3,180 | lines.ts 1,653, content.ts 571, breaks.ts 392, measure.ts 222, data.ts 148, types.ts 102, style.ts 53, index.ts 39 |
| Top-level functions / with a source citation above them | 144 / 95 | content 16/12, lines 78/49, measure 13/12, breaks 19/13, data 12/7, style 6/2 |
| Case ids in engine or shared code | 0 | grep `c-[0-9a-f]{16}` |
| Tolerances or epsilons not in the source | 0 | grep `Math.abs`, `epsilon`, `1e-`, `toFixed`, `Math.round` |
| Reads of the one block style (`p.style`) | 50 | lines.ts 35, content.ts 15 |
| Names in `FIXED_PITCH_FAMILIES` / used by any lab case | 10 / 2 | Courier New (4,832 runs) and Menlo (1,992) among 29 primary families |
| WebKit gap names reported / weak (lift < 2) | 10 / 6 | REPORT §4 |
| WebKit prediction failures / with no gap / with only weak gaps | 510 / 16 / 417 | REPORT §4 |
| Unobserved suite-sample widths, webkit-host | dev 5,284 against 14,413 observed; held-out 4,858 against 4,669 | REPORT §2.2 |
| Tests in breaks.test.ts / that skip when outside files are missing | 18 / 2 | `describe.skipIf` at breaks.test.ts:215, 254 |
| Unit tests for lines.ts, measure.ts, content.ts line filling | 0 | only breaks.test.ts exists |
| Canvas calls kept in lab rows | a count only | `prediction.measureLog` is an integer |

Catalogue by class: (a) 7 areas, (b) 4, (c) 5, (d) 2, (e) 7, (f) 11, plus 1 area that is structurally sound (F12) and 2 test findings (T1, T2).

## 3. Catalogue

### (a) Ported rules, cited, faithful

- **A1.** BreakablePositions `classify`, the pair table, the stale fast-forward state, keep-all `nextBreakableSpace` and `mayBreakInBetween` (breaks.ts:180-392; BreakablePositions.h:124-300; TU:374-422).
- **A2.** libicucore 78.1 line tables per locale and mode, Apple's quote overrides with the `da` exception, `computedLocale` and `localeScript` (data.ts:44-148).
- **A3.** `ubidi_setPara` (ubidi.ts). 0 differences with icu4c 78.3 and system libicucore over 770,241 BidiTest runs, 183,379 BidiCharacterTest lines and 405,000 fuzz strings.
- **A4.** Line bookkeeping, InlineContentBreaker, TextOnlySimpleLineBuilder, RangeBasedLineBuilder and LineBuilder (lines.ts:24-1343).
  - I checked placement, trimming, hanging, the trailing bidi reset, `nextWrapOpportunity`, `hasTrailingSoftWrapOpportunity`, `processLineBreakingResult` and `isLastLineWithInlineContent` at the lines above.
  - Carry: ILB:480-497 carries a width only at a non-zero offset, so the port's `partialLeading` (lines.ts:1575-1580) is right.
  - HangingContent keeps only the last item (InlineLine.h:370-376), and so does the port (lines.ts:158).
- **A5.**
  - `textRendererIsNeeded` (content.ts:36-49), for this model's tree.
  - `characterRangeCodePath` and `characterCanUseSimplifiedTextMeasuring` (content.ts:58-172).
  - `handleTextContent`, including the deferred measurement rule (content.ts:265-305 against IIB:777-787, 924-1051, 1150-1154).
  - Bidi splits and opaque levels (content.ts:318-419).
  - Stored widths after a split (content.ts:423-433 against IIB:133).
- **A6.** TextUtil::width with the following-space rule, `itemWidth`, the fixed-pitch width, `breakWord` and `firstUserPerceivedCharacterLength` (measure.ts:95-222).
- **A7.** Line width `trunc64(f32(width × zoom))`, with + 1/64 only where the source adds it (lines.ts:802, 1269, 1571). Probes webkit-lines H1, H2 and cross-cutting 6 confirm it.

### (b) Canvas recipes backed by source and an installed-browser probe

- **B1.** `canvasString` (measure.ts:15-25): VT and FF are measured as U+0001, CR as U+0000.
  - Probes: webkit-canvas H8, H10; cross-cutting 2; probes-safari correction 4.
  - What's left: CR is assumed to have a zero advance, which holds in Arial. Named gap `control-character-width`.
- **B2.** Primary-font coverage for fixed-pitch boxes (content.ts:223-239): measure "P, LastResort" against the family list per code point. Probe webkit-followups B5. What's left: a fallback glyph whose advance equals LastResort's 17.6015625px.
- **B3.** Dictionary boundaries (breaks.ts:87-139): JSC `Intl.Segmenter` per ICU engine range, with ICU's minimum span and mark rules.
  - 27 of 282,337 positions differ from libicucore's own iterator, all in ranges that start with a mark.
  - These are named `dictionary-breaks-stand-in`, one of the gaps that does locate failures (lift 2.53).
- **B4.** `ubrk_following` from one forward pass (breaks.ts:141-164): 3,635,280 checks (webkit-canvas §2.6).

### (c) Named gaps, and where the gap was a shortcut

- **C1. `hyphen-glyph`** (measure.ts:33-36).
  - The source uses U+2010 only if the primary font maps it, else `-` (StyleComputedStyle.cpp:419-435).
  - The port always measures U+2010 and reports the gap on every soft hyphen: 12,145 reports, lift 4.61.
  - **Shortcut:** webkit-gaps §3.3 already gives a Canvas test for whether the primary font maps U+2010: two fallback families, Menlo and Arial, whose U+2010 advances differ. It isn't implemented.
  - Replacement: run the §3.3 test per primary family, measure `-` when it says no, and keep the gap only for `unicode-range` faces.
- **C2. `string-storage`** (content.ts:207-208, 509-514). Text whose every code unit is at most U+00FF is assumed to be stored 8-bit (REPORT §7 item 4). Lift 0.37.
- **C3. `rtl-shaping-across-inline-boxes`** (lines.ts:1113-1114). `applyShapingIfNeeded` isn't ported (ILB:780-1028). Lift 0.76.
- **C4. `letter-spacing-ligatures`** (content.ts:482). It fires on any non-zero spacing, whether or not the text holds a ligature. Lift 0.74.
- **C5. Missing: page history.**
  - `TextBreakingPositionCache` is confirmed as an input; a measurement cache is suspected.
  - Neither is in the model, and no gap is reported. The lab leaves those cases out instead: webkit-host dev suite 55 and held-out suite 154; installed Safari combined files dev 73 and held-out 124.
  - Users get silent misses there. REPORT §7 item 3 proposes a `page-history` gap.

### (d) Choices made by lab score

**D1. The painted width follows the lab's visibility rules** (lines.ts:1489-1565).

- **What the port does:** `paintedExtent` leaves out:
  - the line's trailing SPACE and TAB under `normal`, `nowrap`, `pre-line` and `pre-wrap`;
  - default-ignorable code points at the line end;
  - and it normalizes negative box widths "as the DOM rect does".
- **What WebKit does:** a text display box is `lineRun.logicalLeft()` with `lineRun.logicalWidth()` (IDCB:131). It keeps untrimmed trailing spaces and ignorables, for example a space before a ZWSP, which `appendText` doesn't trim (IL:445-477).
- **Where the rule came from:**
  - DESIGN.md:184 defines `width` as "the extent the lab observes".
  - webkit-AUDIT §8 B3: "The port now leaves the line's trailing run out of the extent the same way … All five cases pass widths, so no ISSUES entry."
  - `gen-webkit-data.ts:85` ships `Default_Ignorable_Code_Point` "what the lab leaves out"; its only use is lines.ts:1538.
- **Cost if left:** `Line.width` is a Range-rect rule, not an engine quantity.
  - Anything that places content after a line (a caret, trailing decorations, shrink-to-fit, and later text-align) needs the display extent. The library returns neither that nor the hanging width separately.
  - Every change to the scorer's visibility rules becomes an engine change.
- **Replacement:**
  - Report the display-box extent, and the hanging trailing width, from the source geometry.
  - Keep `engineWidth` as `Line::close()`'s content width.
  - Have the scorer derive the observable extent from fragments and its own per-code-point visibility.

**D2. Gap conditions reshaped by lab counts** (content.ts:437-441, 466, 477, 490-501).

- `canvas-language` was narrowed from 12,329 all-pass suite reports to 3,623 "and covers every canvas-language failure". It is still weak (lift 0.53).
- `simplified-measuring` dropped its integer-size exemption and became "a measured width off the 1/2048px grid", kept because "it covers both one-step shortcut-path failures". The grid rule is an inference [I].
- **Cost if left:** gap reports don't tell a user where a prediction may be wrong. Of 510 prediction failures, 417 report only weak gaps and 16 report none.
- **Replacement:**
  - Report gaps at the line edges actually chosen (REPORT §7 item 5).
  - Derive the language-dependent fallback set from dumped CoreText cascades per language, as the break tables were dumped.
  - Take the quote characters from `webkitDelimiters`, which is already bundled, instead of the hand list at content.ts:466.

### (e) Uncited heuristics, allowlists, name lists

**E1. Fixed pitch by family name** (content.ts:174-176, 217-218, 242, 496).

- **What the port does:**
  - It lowercases the first listed family and looks it up in 10 names.
  - `courier new` loses the width shortcut.
  - The `fixed-pitch-path` gap is reported only for those 10 names.
- **What WebKit does:**
  - `m_treatAsFixedPitch` comes from the realized primary font's `kCTFontMonoSpaceTrait` or its fixed-advance attribute (FontCoreText.cpp:775).
  - The width shortcut is also off for user-installed fonts (:784), not only for Courier New (:776-782).
  - The primary font is the first family that realizes (FontCascadeFonts.cpp:200-218).
  - `monospace` resolves to Courier (SettingsBaseCocoa.mm:62), which has the trait.
- **Silent misses, with no gap:**
  - `font-family: monospace` and `ui-monospace`;
  - `NotInstalled, Menlo`;
  - any web font with the trait.
  - For non-ASCII text in those fonts the DOM sums n × space width and the port sums real advances. Example from webkit-gaps §2.5: `16px Courier` `ΩΩΩΩ`, DOM 38.40625, Canvas 49.15625.
- **Lab coverage:** 2 of the 10 names appear in any case, and no case uses a generic monospace family or a web font with the trait. The gap's lift is 0.17.
- **Replacement:**
  - Resolve generic families through WebKit's per-script settings first.
  - Take the first available family, using the webkit-gaps §2.3 Canvas test.
  - Run T1 (webkit-gaps §2.5) per item.
  - Report `fixed-pitch-path` for any family not classified on this OS release when T1 fails, not only for known trait families.

**E2. Canvas word spacing** (content.ts:220; measure.ts:62).

- **What the port does:**
  - It sets `ctx.wordSpacing` to the run's spacing.
  - It adds word spacing to a space right after a TAB because "a Canvas string doesn't add at index 0".
- **Source:** TU:62-104 subtracts `singleSpaceWidth + wordSpacing`, so the subtraction is source-backed. The two Canvas claims have no probe: probes-safari has no word-spacing row, and webkit-AUDIT N1 says "the recipe has no verdict". Only lab rows back them.
- **Replacement:** probe Canvas word spacing at index 0, mid-string and after a TAB against DOM spans.

**E3. Tabs** (measure.ts:38-71).

- **What the port does:**
  - It measures the text between TABs as separate Canvas strings.
  - It adds letter spacing after every TAB, which is marked [I] (webkit-AUDIT N3).
  - It takes the tab base from Canvas `W(' ')`.
- **What WebKit does:** `Font::spaceWidth()` (FontCascadeInlines.h:76-94).
- **Evidence:** probe webkit-lines H15 confirms the stop rule in Arial only. WebKit reports no `tab-stops` gap, while Blink found untracked space advances in fonts with `trak`.
- **Replacement:** probe tabs in Helvetica Neue and SF with letter spacing, then either confirm the recipe or add the gap.

**E4. The following-space rule omits `hasKerningOrLigatures`** (measure.ts:99 against TU:72-76).

- This is latent: the model has no `font-kerning` or `text-rendering`.
- Once either lands, items in non-kerning text would be measured with the following space where WebKit doesn't, and could differ by a float32 step.

**E5. Dictionary engine chosen by Unicode block** (breaks.ts:60-66).

- The source uses `uscript_getScript` (brkeng.cpp:163-199). The comment asserts that every SA character in these blocks has the block's script, which is checkable but unchecked.
- Replacement: take the script from the pinned ppucd, which the generator already reads.

**E6. U+2028 appended to the bidi paragraph as a space** (content.ts:346).

- The source appends the character itself (IIB:593).
- Both are Bidi_Class WS, so the levels come out the same. It's an uncited substitution that costs nothing today.

**E7. Painter white-space test** (paint.ts:29-31, 159).

- It uses Blink's `IsASCIISpace` set, which includes VT, for every engine.
- WebKit's set excludes VT (content.ts:25-32). This affects the painter only.

### (f) Structural deviations that will need rework

Each entry gives what the port does, what the source does, which feature it blocks, and the principled replacement.

**F1. One block style for every box** (style.ts:5-28; 50 reads of `p.style`).

- **Source:** the style read differs by site:
  - the item's style: `needsNewRun` IL:375-402, `wordBreakBehavior` ICB:877-915;
  - the parent's style: `isBreakableRun` ICB:353-362, `shouldWrapUnbreakableContentToNextLine` ICB:278-293, the wrap-opportunity list ILB:1748;
  - the nearest common ancestor's: IFU:436;
  - the next box's: TU:374-396;
  - the root's: TOS:499-528, `handleLineEnding`.
- **Blocks:** per-span `white-space`, `word-break`, `line-break`, `overflow-wrap`, `direction` and `unicode-bidi`, for example `<code style="white-space:nowrap">`. Every one of the 50 sites must choose the right box.
- **Replacement:** a computed style record per box, with each call site reading root, item, parent or nearest-ancestor style as the source does. The functions already carry source names, so the change is mechanical, but it touches most of lines.ts.

**F2. Flat runs** (model.ts:26-37).

- **Engine sites:**
  - `parentIsSpan` (lines.ts:1027-1029);
  - `sameParent` (lines.ts:1048);
  - the spanning box, which is only the run's own span (lines.ts:1605-1609);
  - `textRendererIsNeeded`'s `previous: 'none'|'text'|'inline'` (content.ts:36-49);
  - range-builder detection `inlineBoxes === 1` (content.ts:565).
- **Source:** the ancestor walk in `createLineSpanningInlineBoxes` (ILB:385-430) and `nearestCommonAncestor` (IFU:357-383).
- **Blocks:** nested inline boxes, and a span with more than one child.
- **Replacement:** a box tree in the model. The source's stack-based code (`nextWrapOpportunity`, opaque bidi levels) is already ported and fits it.

**F3. Inline boxes have zero width and never count as content** (lines.ts:244-249, 390-393, 1276-1287).

- **Source:**
  - an inline box start is margin + border + padding wide (IFU:320-324);
  - a decorated box counts as content (ILB:64-78);
  - `appendInlineBoxStart` resets the hanging state when the box has decoration (IL:289-344);
  - decoration disqualifies the range builder (RBB:147-165).
- **Blocks:** padding, border and margin on spans, and the line heights and line-start rules that depend on them.
- **Replacement:** port those widths and predicates. ContinuousContent already carries per-run widths, so candidate collection needs little change.

**F4. Fragments from a second list** (lines.ts:44-65, 1364-1436).

- **What the port does:**
  - The line keeps `pieces`, kept in step by hand at 7 sites (lines.ts:178, 210, 222, 240, 258, 268-273, 305-306).
  - `buildFragments` re-derives the trailing bidi reset on its own (lines.ts:1375-1380).
  - It marks every trailing `pre-wrap` white space piece `hanging` (lines.ts:1381-1387), even where `Line::handleTrailingHangingContent` stops hanging content that fits (IL:198-233).
- **Source:** geometry comes from the `Line::Run` list after `close()`, through InlineDisplayContentBuilder. It has no counterpart to `pieces`.
- **Blocks:** text-align and justify (runs detached and expanded), hanging punctuation, decorations. Any feature that changes runs must also update `pieces`, or the fragments drift from the engine.
- **Replacement:** derive fragments and widths from the closed run list plus a port of the display-box geometry, then drop `pieces`.

**F5. Builder eligibility checks only what the model has** (content.ts:559-568).

- **What the port checks:** word spacing, RTL, the inline box count, reordering.
- **Source:**
  - TOS:488-528 also rejects `text-indent`, `justify`, `box-decoration-break: clone`, `hanging-punctuation`, `hyphenate-limit-lines`, `text-wrap: balance/pretty`, `line-align/snap`, a differing first-line style, `text-autospace` and floats.
  - RBB:131-184 also rejects decorations, a span `text-align` that differs from the block's, and line clamp.
- **Blocks:** adding any of those properties silently keeps the simple builder.
- **Replacement:** port both eligibility functions whole over the style record, with the model's defaults filled in.

**F6. No line-rect offset** (lines.ts:1569-1572).

- **Source:** `LineBuilder::initialize` narrows the line by text-indent and floats and sets `m_lineContentEdgeOffset`, which tab pen positions read (ILB:453-478).
- **Blocks:** `text-indent` and floats.
- **Hook:** `WebKitLineStart` already carries `endsWithLineBreak` (types.ts:99), which `text-indent: each-line` reads.

**F7. Box content is the source text** (types.ts:27-33; content.ts:206; lines.ts:1347-1356, 1413-1418).

- **Blocks:** a `text-transform` that changes length. Range offsets address the transformed text (lab README "Range geometry").
- **Replacement:** a content string per box, plus a map from content offsets to source offsets.

**F8. `hyphens: manual` only** (lines.ts:485-493, 673; content.ts:265-305).

- **What the port does:**
  - `wordBreakBehavior` has no `AtHyphenationOpportunities`.
  - `tryHyphenationAcrossOverflowingInlineTextItems` (ICB:737-811) isn't ported.
  - Items always split at soft hyphens, while the source merges them under `hyphens: none` (IIB:1016-1021).
- **Blocks:** `hyphens: auto` and `hyphens: none`. Hyphenation points come from CoreText and can't be read from Canvas, so `auto` needs a named gap.

**F9. No `<br>`, `<wbr>`, atomic inline or float items** (types.ts:70-75).

- **Engine sites:**
  - `nextWrapOpportunity` skips non-text items (lines.ts:1062-1089);
  - `isAtSoftWrapOpportunity` handles text only (lines.ts:1046-1059);
  - candidate collection handles text, box edges and soft breaks only (lines.ts:1128-1146).
- **Source:** IFU:456-544 handles line breaks, `<wbr>`, floats and blocks; atomic boxes give an opportunity (IFU:446-450); ILB:1030-1170 collects all item kinds.
- **Blocks:** `<br>` and atomic inlines.
- **Replacement:** port the missing branches, which sit next to code that is already ported.

**F10. The painted width assumes `text-align: start`** (lines.ts:1491-1507).

- **Source:**
  - `horizontalAlignmentOffset` with the hanging trailing width (TOS:117);
  - justification inflates the content width (`applyRunBasedAlignmentIfApplicable` in ILB's `handleLineEnding`, InlineContentAligner).
- **Blocks:** `text-align`. It enters through F4 and F5.

**F11. Gaps per paragraph at prepare time** (engine.ts:13-14; content.ts:443-520).

- The conditions can't see which widths decided a break, which is why so many gaps are weak (D2).
- Replacement: gaps per line on `LineOf`, as DESIGN-REVIEW §3.5 proposed.

**F12. Variable line widths are sound.**

- `nextLine` takes a width per line (index.ts:33-37; lines.ts:1571).
- The carried width is valid only at the width that produced it, which is also what WebKit's `trailingOverflowingContentWidth` means (IFC:293-360, ALB:54-98).

## 4. Do the engine's tests pin real engine behaviour?

**Partly.** The break data is pinned by what the engine itself produces. Line filling isn't pinned by anything that runs without a browser.

breaks.test.ts has 18 tests:

- **2 against data dumped from the engine:**
  - `classify.tsv`, all 65,536 code units in both no-break-space modes (131,072 lookups), from a compiled 7625 `classify`;
  - the pair table, 1,547 breakable pairs.
- **12 against installed-browser probe verdicts:** H1-H3, H9, H13, H14+H17, H15, H16, H18, H23, H4+H5, H6.
  - They go through a test-local `opportunities()` (breaks.test.ts:57-86). That helper restates `endsWithSoftWrapOpportunity` and `mayBreakInBetween`, and leaves out `isAtSoftWrapOpportunity`'s wrap, anywhere and same-parent rules.
  - So they test the break scan through a copy of the port's decision rule, not the line builder that produced the probe's 1px lines.
- **1 against libicucore's own line iterator** over 1,556 SA texts. It pins the known loss: 27 of 282,337 positions.
- **1 against the groundwork C++ WebKit oracle.** That oracle is WebKit 7624, one version behind the pin. 14,904 requests are compared and 4,489 excluded, including every Thai, Lao, Khmer and Myanmar text and every 7625 rule change.
- **2 that restate the port's reading of the source:**
  - the per-locale override spot checks, for example `quoteCategory('en')` equals the category of `{`;
  - seven literal `canBreakBefore` answers.

**Risk:** the libicucore test and the oracle test use `describe.skipIf` on files under `~/github/browser-engines`. A fresh checkout passes without running them.

**Shared tests that cover WebKit's data are real engine output:**

- rbbi.test.ts: libicucore `probes.tsv` from `ubrk_open` / `ubrk_next`;
- ubidi.test.ts: an oracle linked against system libicucore;
- bidi.test.ts: bidi class tables against both ICUs;
- grapheme.test.ts: GraphemeBreakTest-17.0.0, which ICU passes.

**No unit test covers:**

- lines.ts (1,653 lines);
- measure.ts (222 lines);
- content.ts's builder choice, bidi splits and gaps;
- `paintedExtent`.

DESIGN-REVIEW §3.5 proposed a recorded-width Measurer; it isn't there. `createMeasurer()` always creates an OffscreenCanvas. Lab rows keep `prediction.measureLog` only as a count, so no lab case can be replayed without a browser.

**Tests worth making first-class for WebKit:**

1. **Keep the dumped-data, libicucore, ubidi and rbbi tests.** Move the SA libicucore rows and the oracle answers into `rebuild/data/webkit` with sha256 checks, so they can't skip silently.
2. **Record full call logs in lab rows** (context settings, text, width). Add a recorded-width Measurer, and replay `layoutParagraph` in bun against the native lines. Every lab case then becomes an offline regression test of line filling.
3. **Pin the confirmed line probes as fixtures** with recorded widths: webkit-lines H1, H2, H4, H5, H7, H8, H9, H10, H12, H15, H18, H19, H20, H21. Leave out:
   - H6, refuted because the probe's design can't separate its cases;
   - H11, partly refuted through page history;
   - H13 (empty div), H3 (not discriminating), H16 and H17 (not run), H22 (`::first-line` isn't modeled).
4. **Assert the 12 verdict tests through `layoutParagraph` at 1px,** which is what the probes observed, instead of the test-local restatement.

## 5. Where this port would slip, and where it's sound

**Sound, and likely to hold as issues arrive:**

- **Break opportunities:**
  - a verbatim BreakablePositions, checked against dumped data;
  - the OS's own libicucore tables with Apple's overrides;
  - the dictionary stand-in with a measured loss;
  - an exact ubidi.
- **The line loop:** the same three builders, the same ContinuousContent and breaker actions, the same carry and fit arithmetic. The port is a subset of the source, with source names and signatures.
- **Variable widths per line.**
- **The rule for fixes after the audit:** fix at the source, rerun, no case-specific code.

**Where it would slip, in order of likely cost:**

1. **Per-span styles** (F1) and **nesting** (F2). The first real content with `nowrap` code spans or nested inline markup breaks the one-style assumption at 50 sites.
2. **Output geometry** (D1, F4, F10).
   - `width` follows the lab's rules, and fragments come from a hand-kept list.
   - text-align, justify and inline decorations all need geometry the port doesn't derive from the engine's runs.
3. **Fonts outside the lab** (E1, C1).
   - Generic `monospace` and `ui-monospace`, and monospace web fonts, miss the fixed-pitch rules silently.
   - Every soft hyphen reports a gap that a Canvas test could settle.
4. **Gap reporting that doesn't locate losses** (D2, F11, C5).
   - 417 of 510 prediction failures carry only weak gaps.
   - Page history has none.
5. **Properties the model doesn't have yet:**
   - inline box widths (F3);
   - builder eligibility (F5);
   - the line-rect offset for text-indent and floats (F6);
   - text-transform offsets (F7);
   - `hyphens: auto` and `none` (F8);
   - `<br>` and atomic inlines (F9).
   - Each is a port of a source function the port already partly has.
6. **No offline test of line filling** (T2). A regression in lines.ts shows only after a browser lab run.

**Where the MVP numbers look better than the structure:**

- **Widths are scored only where the Range rects can settle them.** In webkit-host's held-out suite sample, 4,858 widths are unobserved against 4,669 observed.
- **History-dependent cases are left out of every table.**
- **Some widths pass by definition:** `width` is the extent the scorer observes (D1).

None of these are per-case tricks, but a user's Safari page gets neither the exclusions nor gap reports that point at the failures.

## 6. First fixes, cheapest structural wins

1. Move the lab's visibility rules out of `paintedExtent` into the scorer, report the display-box extent, and stop shipping `webkitDefaultIgnorableRanges` for the lab (D1).
2. Implement the hyphen test of webkit-gaps §3.3 and the fixed-pitch resolution of E1: generic families, first available family, T1, gap for families nobody has classified (C1, E1).
3. Add the recorded-width Measurer and full call logs in lab rows, then the probe fixtures (T2).
4. Decide the model's tree and style shape before more features land, then give each box its own style and derive fragments from `Line::Run` (F1, F2, F4).
