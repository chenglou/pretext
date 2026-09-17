# Gecko port: structural shortcut audit

Scope: `rebuild/src/engines/gecko` (prepare.ts 982 lines, lines.ts 771, linebreak.ts 520, types.ts 127, props.ts 141, index.ts 30, gecko.test.ts 349, props.test.ts 57) and the shared code it uses: `measure/` (canvas.ts, font.ts, log.ts), `unicode/bidi.ts`, `unicode/grapheme.ts`, `unicode/unicode-bidi.ts`, `breaks/icu4x.ts`, `breaks/tables.ts`, `paint.ts`, `model.ts`, `env.ts`, `index.ts`, `engines/engine.ts`. Branch rebuild-20260916 at c72550a. I read all of these in full.

Method:
- **Source check.** Every "(read)" citation below was re-read in `~/github/browser-engines/firefox-156.0` for this audit. Citations without "(read)" are the port's own and weren't re-checked.
- **Tests.** `bun test rebuild/src/engines/gecko`: 31 pass, 0 fail.
- **Census.** One offline census ran over the Firefox forward lab rows with a stand-in Canvas (576 au per code point at 16px). It counts which code paths run, not accuracy.
- **Limits.** No browser work, no edits to `rebuild/src`, no commits.
- **Data files** (`.artifacts/research-20260916/gecko-structural/`):
  - `catalogue.json`: 74 entries, one class each;
  - `width-census.ts` and `census.json`.

Classes:
- **(a)** ported rule, cited, faithful;
- **(b)** Canvas recipe backed by source and an installed-browser probe;
- **(c)** named gap;
- **(d)** chosen by lab score;
- **(e)** uncited heuristic, name-keyed constant, or approximation;
- **(f)** structural deviation that will need rework as features land.

## 0. Verdict

| Class | Count | Of which |
|---|---:|---|
| (a) ported, cited, faithful | 34 | |
| (b) Canvas recipe with source and probe | 11 | 2 with only a lab row or an audit probe behind them |
| (c) named gap | 7 | 2 conditions are known in the source but never reported |
| (d) chosen by lab score | 3 | |
| (e) heuristic, name key, approximation | 9 | 2 font-family literals, 1 approximated ICU table |
| (f) structural deviation | 10 | |

**The rebuild took the brief seriously where it counts most.**
- **Break opportunities** are a line-by-line port. The offline Rust oracle agrees on 5,060,059 scan positions and differs on 401 (specs/gecko-oracle-replay.md §3). 400 of those are one known bug (E4) and 1 is bun's segmenter.
- **The line loop for text-only paragraphs** matches the source branch by branch. I re-read BreakAndMeasureText, ReflowText, CanPlaceFrame, NotifyOptionalBreakPosition, ReflowInlineFrames and TrimTrailingWhiteSpaceIn, and found no deviation for paragraphs that contain only text frames.
- **The arithmetic** is integer app units with no epsilon.
- **No shortcuts of the cheap kind:** there is no special case keyed on case ids or on text.

**Where it slips structurally:**
1. **In-word advances rest on a Canvas model limit plus one score-picked recipe** (D1). This is Gecko's largest remaining failure class, and more rows won't fix it.
2. **`Line.width` is the lab's measurement rule, not a Gecko value** (F9, E5, E6, D2).
3. **There is no inline-box structure** (F1, F5, F6). The first span with padding, `<br>` or an atomic inline needs a new line-state data structure, not a patch.
4. **Word units are hard-wired** (F2) where Gecko switches to whole-run shaping per font.
5. **Document and platform state is either missing or written into engine code** (F3, F4, E1, E3).

## 1. (a) Ported rules

| Id | Where | Rule | Source / verification |
|---|---|---|---|
| P1 | prepare.ts:30-35 | NS_lroundf, px → au | nsMathUtils.h:31-33; ServoStyleConstsInlines.h:584-595 |
| P2 | prepare.ts:38-50 | 7-bit Canvas and 10-bit Servo size quantization | CanvasRenderingContext2D.cpp:4207-4217; font.rs:993-1022; probe gecko-canvas H3b |
| P3 | prepare.ts:52-80 | white-space longhands, WordCanWrap, EffectiveWordBreak | nsStyleStruct.h:1303-1367 |
| P4 | prepare.ts:86-123 | IsHyphen, IsInvalidChar, IsSpaceCombiningSequenceTail, IsTrimmableSpace | nsContentUtils.cpp:2257-2265; gfxTextRun.h:971-992; nsTextFrame.cpp:904-942 |
| P5 | prepare.ts:130-246 | TransformText per mapped flow | nsTextFrameUtils.cpp:84-401; oracle replay: kept source offsets equal on 125,505 paragraphs |
| P6 | prepare.ts:153-154 | ja/zh segment-break language test | nsTextFrameUtils.cpp:273-284 (read) |
| P7 | prepare.ts:253-348 | SetupClusterBoundaries (including Bengali ya-phala at :288), SplitAndInitTextRun, word cache limit 32 | gfxFont.cpp:733-756 (read), :3708-3900; StaticPrefList.yaml:7931-7934 (read) |
| P8 | prepare.ts:351-435 | gfxScriptItemizer | gfxScriptItemizer.cpp:60-243 |
| P9, P11 | prepare.ts:444-460, :507-526 | InitTextRun script runs | gfxTextRun.cpp:2673-2831 |
| P12 | prepare.ts:529-537 | ReplaceSeparators | nsBidiPresUtils.cpp:861-875 |
| P16 | prepare.ts:563-575 | GetEmojiPresentation; the presentation FindFontForChar asks for | nsUnicodeProperties.h:127-165 (read); gfxTextRun.cpp:3260-3308 (read) |
| P17 | prepare.ts:579 | app units per device pixel | nsDeviceContext.cpp:52-63 |
| P19 | prepare.ts:605-621 | no frame for an 8-bit white-space-only text node at a line boundary, unless white space or newlines are significant | nsCSSFrameConstructor.cpp:5220-5290 (read) |
| P21 | prepare.ts:631-674 | bidi per preserved line, frames split at level runs | nsBidiPresUtils.cpp:790-1167 |
| P23 | prepare.ts:721-745 | nsLineBreaker over every flow, HasCompressedLeadingWhitespace | nsTextFrame.cpp:2867-2887 (read) |
| P32 | prepare.ts:941-952 | tab width from the containing block's space, letter and word spacing | nsTextFrame.cpp:3875-3906 (read) |
| L1 | linebreak.ts:88-271 | ICU4X LineBreakIterator | line.rs:833-1080; replay segment layer 5,278,015 agree / 1 differ |
| L3-L5, L7 | linebreak.ts:278-342, :360-520 | ComputeBreakPositions, SetPotentialLineBreaks, kNonBreakableASCII, nsLineBreaker | LineBreaker.cpp:112-194; gfxTextRun.cpp:210-236; nsLineBreaker.cpp:33-720 |
| N6 | lines.ts:125-130 | GetHyphenationBreaks | nsTextFrame.cpp:4409-4457 (read) |
| N7 | lines.ts:143-234 | BreakAndMeasureText, manual hyphens, including the last-candidate fallback | gfxTextRun.cpp:922-1212 (read) |
| N8 | lines.ts:250-255 | NotifyOptionalBreakPosition | nsLineLayout.cpp:1495-1516 (read) |
| N9 | lines.ts:278-380 | ReflowText: leading white space skip, forced break, trim or hang, break-after at a trailing break | nsTextFrame.cpp:10847-11532 (read) |
| N11 | lines.ts:431-435 | at most one redo at the saved break | nsBlockFrame.cpp:5139-5196, :5361-5384 (read): a second backup is refused once a break is forced |
| N14 | lines.ts:581-604 | line box after TrimTrailingWhiteSpace, the floored delta subtracted unclamped | nsLineLayout.cpp:2851-2985 (read); nsTextFrame.cpp:11540-11628 (read); SetLineBreaks' delta is always 0, gfxTextRun.cpp:1292-1301 (read) |
| N16 | lines.ts:674-695 | visual frame order | nsBidiPresUtils.cpp:1494-1532 |
| S1-S5 | props.ts; unicode-bidi.ts; grapheme.ts; breaks/icu4x.ts; measure/canvas.ts | properties, bidi levels, graphemes, trie and rule iterator, per-layout memo | props.test.ts against icu_properties 2.1.2 for every code point; BidiTest 17 and the crate's BidiCharacterTest; GraphemeBreakTest 17; tables-check with 0 differences |

The text-frame branch of CanPlaceFrame (lines.ts:413) is exact. I checked each source branch (nsLineLayout.cpp:1189-1342, read):
- `mNoWrap` fits: the port's `style.wrap` test;
- the outside test with `mTrimmableISize`: the same;
- a zero-width frame fits: `width !== 0`;
- not-safe-to-break fits: `lineIsEmpty`;
- a frame that can continue a text run is placed and requests backup: the same.

`notSafeToBreak = LineIsEmpty() && !mImpactedByFloats` (:785) and `mLineAtStart` (:1034-1038) match as well.

## 2. (b) Canvas recipes

| Id | Where | Recipe | Backing | Caveat |
|---|---|---|---|---|
| B1 | prepare.ts:782-809 | one OffscreenCanvas context per text run; `au = Math.round(W × 60)`; `letterSpacing = '0.001px'` turns ligatures off where the resolved au isn't 0, and spacing is added in JS | probes gecko-lines H19, gecko-canvas H1, H14, H23, gecko-text H21, H30, cross-cutting 3 | |
| B2 | prepare.ts:466-505 | `rangeAu`: a piece measured in the script the itemizer gives it, `W(ctx + ' ' + piece) − W(ctx + ' ')` | gfxScriptItemizer.cpp:60-243; word boundaries at U+0020 (gfxFont.cpp:3781-3866); audit probe A1; policy/korean trace `c-d0840b740198cf4d` | The recipe assumes nothing shapes across its U+0020. Nothing checks that. `SpaceMayParticipateInShaping` is true for Hebrew runs in Arial, Times New Roman and Courier New (gecko-gaps §3.3), and there Canvas shapes context, space and piece together. |
| B3 | prepare.ts:853-919 | sbix device-size advance, only where Canvas shows Apple Color Emoji draws the cluster | gfxMacFont.cpp:437-463; probe gecko-port F3 (`rebuild/probes/gecko-emoji-font.ts`) | keyed on a family literal (E3) |
| B4 | prepare.ts:870-885 | synthesized Unicode space widths where Canvas measures the synthesized value at both sizes | gfxTextRun.cpp:3032-3043; gfxFont.cpp:4792-4826; lab row `c-55485f415fd9dfed` | no dedicated probe; I showed the detection is self-consistent (a coincidental match gives delta 0) |
| B5 | prepare.ts:932-933 | min tab advance `0.5 × au('0')`; hyphen run `au('‐')` | nsTextFrame.cpp:1931-1937 (read); probe H15; probes-firefox correction 5 | |
| B6 | linebreak.ts:35-60 | SA slices through the running browser's `Intl.Segmenter` word granularity | complex/mod.rs:135-156; probe gecko-text H25; replay stand-in run with 0 differences | whether word granularity equals the line LSTM on every slice is untested (replay §5) |
| B7 | lines.ts:20-57 | in-word advance `W(unit) − W(suffix)` | gecko-lines §9 "Not obtainable" 1: GPOS pair adjustments land on the left glyph | kerning in legacy `kern` tables, ligature shares and joining break it; covered by `in-word-prefix` |
| B8 | lines.ts:24-41 | at an offset inside a grapheme cluster, the advance before the cluster's end | gfxHarfBuzzShaper.cpp:1705-1786; gfxTextRun.cpp:238-322; skin-modifier/shy families | |
| B9 | measure/font.ts:11-13 | `style weight size family`, `String(size)` | DESIGN §4.3 | |
| B10 | paint.ts:66-70 | the Gecko hyphen span gets `unicode-bidi: isolate` | nsTextFrame.cpp:2091-2096 (read): an isolate boundary stops shaping across elements | |
| B11 | paint.ts:105-121 | trailing white space painted at the level of the text before it | UAX #9 L1 (unicode-bidi.ts:281-309) | |

## 3. (c) Named gaps, and conditions that aren't reported

| Id | Where | Gap | Note |
|---|---|---|---|
| C1 | prepare.ts:602 | `ui-language` for `lang=""` | |
| C2 | prepare.ts:796-800 | `font-size-quantization` | never fired in the lab |
| C3 | prepare.ts:816-829, :929 | `space-in-shaping` | report only; see F2 |
| C4 | prepare.ts:901-914 | `bitmap-emoji-size` | |
| C5 | lines.ts:33-55 | `in-word-prefix` at the first consulted in-word offset Canvas can't confirm | REPORT §4: 10,234 reports, 2,136 of them failing, lift 4.83. Blind to a ligature whose width equals its parts (`c-daf9c7047097f77b`). |
| C6 | prepare.ts:548-549 | U+2007 and U+2008 synthesized widths aren't corrected | **never reported** |
| C7 | prepare.ts:758-767 | letter spacing after a cluster ignores `IsLigatureGroupStart` (nsTextFrame.cpp:3870-3872, read) | **never reported**. Canvas can't show ligature groups. Letter spacing turns optional ligatures off, but required ones stay. |

## 4. (d) Chosen by lab score

### D1. U+200D before the suffix between joining letters: lines.ts:42-46, :75-83

- **What the port does.**
  - Where the last non-transparent letter before offset t joins forward and the first from t joins back (Joining_Type D/L/C then D/R/C), the advance before t is `W(unit) − W(U+200D + suffix)`.
  - The painter then puts U+200D on both sides of the edge.
- **What Gecko does.**
  - The DOM sums the glyph records of one shaping of the whole unit: GetAdvanceForGlyph during the scan (gfxTextRun.cpp:1139-1149, read) and GetAdvanceWidth for widths (:1214-1256).
  - The prefix's joined forms come from that one shaping, and no Canvas string exposes them.
- **How it was chosen** (gecko-RESULTS.md "Changes by run"):
  - r7 put U+200D after the prefix: suite 326 metric results better, 16 worse.
  - r8 moved it before the suffix: suite 20 better, 7 worse, and policy `c-5ba3b0da55cb63ad` worse.
  - Neither round cites a source reason for the order. Both were kept for their score.
- **Evidence against it** (audit probe A2, gecko-AUDIT §3):
  - Geeza Pro: `W(‍ه.)` is 590 au; the native final ه plus `.` is 504 au.
  - `c-ddb7b0c21bf3d492`: Mongolian, predicted 556 au for two letters, less than native ᠠ alone (755).
  - `c-dd0665732322b000`: lam predicted 12 au, native 241.
- **Cost.** This is Gecko's largest failure class (REPORT §6):
  - development widths: `suite/U+200C`, `U+2060` and `U+FEFF` 64 each, `U+200D` 26;
  - held-out: `joined` widths 22, `joined-plain` painter 19.

  Every such row reports `in-word-prefix`, so it never looks unnamed, but the recipe was fit to rows.
- **Replacement.**
  1. Decide the recipe from DOM geometry, not suite score. Firefox's Range rects cover clusters and are backed by the glyph records (gecko-AUDIT B4). An installed-browser probe can read the DOM's in-word x positions for joined text in the lab's fonts (Geeza Pro, Amiri, Noto Naskh Arabic, Mongolian fallback) and compare `W(prefix + U+200D)`, `W(unit) − W(U+200D + suffix)` and plain `W(unit) − W(suffix)`.
  2. Keep whichever the probe shows is exact, per font class.
  3. Where none is exact, report the gap and stop presenting a number as exact.

### D2. Range-rect rules behind `width`: lines.ts:632-662

- **What the port does.**
  - A piece has a rect only when its advance is positive.
  - White space the frame removed at the line end spans to the frame's edge.
  - Hidden controls with letter spacing count.
- **What Gecko does.** Range rects come from nsRange client rects over nsTextFrame geometry. The port cites no file for them, and none was read.
- **How it was chosen.**
  - r6 added the positive-advance rule from `c-3b2e9519e5b651d4`.
  - r9 lost 236 results; r10 fixed them.
  - The audit B4 resolution corrects the rule from rows `c-4aafc349e1c161fd`, `c-3b2e9519e5b651d4` and `c-79e5272a2644d9b8`.
- **Cost.** It encodes the harness's observation in library code (F9). Scorer edits flip results: the 10:08 scorer turned `c-fc59a73aa616baff` and `c-92b6963ae4344985` from pass to fail (gecko-AUDIT §2).
- **Replacement.** Move it to the lab (F9).

### D3. Painter R7, U+200D on both sides of a joined edge: paint.ts:204-206

- Probe 5 hasn't run, and Firefox rows contradict R7 at narrow widths (PAINTER-RESULTS.md:125).
- **Replacement:** run painter probe 5 in Firefox, and decide per engine.

## 5. (e) Heuristics, name keys, approximations

### E1. `OPTICAL_SIZE_FAMILIES`: prepare.ts:544, :801

- **What it is.** A regex of family names (system-ui, -apple-system, BlinkMacSystemFont, ui-*, SF Pro, SF Compact, New York).
- **What Gecko does.** The DOM applies `font-optical-sizing: auto` to any font with an opsz axis; OffscreenCanvas never does (gecko-canvas §1.2 C1a). Probe cross-cutting 5 covers system-ui only.
- **Cost.** Silent errors for every other font with an opsz axis. It never fired in the lab.
- **Replacement.** Generate a pinned list of installed macOS 27 families with an opsz axis, the way the break tables are generated (offline, with hashes). Report the gap from that list, and name the list in the gap detail.

### E2. `sameFont` compares raw family strings: prepare.ts:539-540, :690

- **What Gecko does.** `fontStyle1->mFont == fontStyle2->mFont` compares the parsed font (nsTextFrame.cpp:2168, read).
- **Cost.** `Arial` against `"Arial"` ends a text run that Gecko continues, so the word is shaped in two pieces: kerning or joining across the span edge is lost.
- **Replacement.** Normalize the family list once per run. A small parser works, or OffscreenCanvas's `font` readback, which serializes the declaration (probe gecko-canvas H3). Then compare normalized declarations.

### E3. Family literal `"Apple Color Emoji"`: prepare.ts:863

- **What Gecko does.** The sbix device-size path belongs to Core Text fonts (gfxMacFont.cpp:437-463). `Environment` has no platform.
- **Cost.** Nothing today: the pinned Firefox runs on macOS 27. But a platform fact lives as a string in engine code, and another color bitmap font a page names isn't covered.
- **Replacement.** Add an Environment platform fact with its emoji family from pinned data, and keep B3's comparison over it.

### E4. `scriptIsChineseOrJapanese` approximates ICU likely subtags: linebreak.ts:346-358

- **What Gecko does.** nsLineBreaker.cpp:674-686 → `Locale::AddLikelySubtags` → `uloc_addLikelySubtags` (intl/components/src/Locale.cpp:907-930).
- **Cost.** 400 fuzz positions (yue, wuu, und-TW). ICU also gives cmn, hak, nan, gan, lzh, und-HK and und-JP a Chinese or Japanese script (oracle replay §4.1). No lab case uses those tags.
- **Replacement.** Generate a likely-script module from ICU 78's likely-subtags data, checked by hash, and test it against the oracle's LocaleExpander.

### E5. Fragment kinds for trailing white space follow the lab: lines.ts:485-507

- **What the port does.** `hangs = collapse === 'preserve' && wrap && (ch === 0x20 || ch === 0x09)`.
- **What Gecko does.** Hangable white space is counted from `CharIsSpace` only (gfxTextRun.cpp:1152-1159, read), which is set for U+0020 and U+3000 (gfxFont.cpp:750, read). A TAB doesn't hang in Gecko and U+3000 does.
- **What isn't affected.** The port's fit test uses `isSpace` correctly (lines.ts:199-206), so breaks aren't affected.
- **Census** (stand-in Canvas): trailing "hanging" fragments containing a TAB:
  - 142 in the development suite sample;
  - 21 in ws, 12 in runs, 3 in smoke.
- **Cost.** Consumers get the lab's categories under Gecko's names. That matters for text-align (the hang amount) and for any painter that doesn't re-run the engine.
- **Replacement.** Classify from Gecko's own flags and the hang from ReflowText (nsTextFrame.cpp:11216-11230, read). Map to lab categories in lab code.

### E6. Visibility categories from lab/README.md: lines.ts:751-761

- `isWhiteSpaceProperty`, `isInvisible` and `isOtherControl` are the lab's "Visible code points" rules (lab/README.md:148-166).
- This is part of F9.

### E7. SA ranges duplicated: prepare.ts:954-962

- The ranges duplicate linebreak.ts:24-30.
- An environment with `dictionaryBreaks.kind === 'v8-break-iterator'` passed for Gecko gives SA runs no interior breaks and reports no gap.
- **Replacement:** one function, and report `dictionary-breaks-unavailable` whenever the kind isn't the one Gecko can use.

### E8. Painter's first-slice rule uses Blink's `IsASCIISpace` for every engine: paint.ts:31, :159

- Gecko's rule is the one the port already has (prepare.ts:612-619, from nsCSSFrameConstructor.cpp:5278-5290, read).
- It affects painting only.

### E9. Painter's `text-wrap-mode: nowrap` on hyphenated or joined lines: paint.ts:158

- A painter design choice with no Gecko source.
- Low cost.

## 6. (f) Structural deviations

### F1. Text-run joining is reduced to what the model has: prepare.ts:688-691

- **What the port compares.**
  - same level;
  - different run;
  - no preserved newline at the end of the previous piece;
  - raw font fields;
  - language;
  - letter spacing zero or not.
- **What Gecko compares** (`ContinueTextRunAcrossFrames`, nsTextFrame.cpp:2015-2174, read):
  1. embedding level, and `precedingControl` from the control frames that CSS `unicode-bidi` and `dir` insert (:2026-2029; nsBidiPresUtils.cpp:946-962, :1238-1241, read);
  2. non-zero margin, border or padding, a non-baseline `vertical-align`, or an isolate on any inline box between the two frames (:2054-2137);
  3. identical computed style continues at once (:2150);
  4. `text-transform`, `word-break` and `line-break` (:2155-2158);
  5. the whole `mFont` plus `GetTextRunFlagsForStyle` (:2168-2173).
- **Today.** Items 1-4 can't occur, because the model has no span box properties and `word-break` and `line-break` are paragraph-level (prepare.ts:727-728 sets them from the paragraph). Item 5 is reduced (E2).
- **Cost.** Every span property added later has to be threaded here and into the per-flow nsLineBreaker settings by hand.
- **Replacement.** A per-run record of the computed-style subset Gecko compares, and a port of the function over it, including the ancestor walk once span boxes exist.

### F2. Shaping unit = the word between boundary spaces, hard-wired: prepare.ts:829-928; lines.ts:20-57

- **What Gecko does.**
  - When `SpaceMayParticipateInShaping` holds and the run has a space or is longer than 32 characters, Gecko shapes the whole run without the word cache (gfxFont.cpp:3747-3763, read; ShapeTextWithoutWordCache :3633-3680).
  - That depends on font tables. gecko-gaps §3.3: Arial with Hebrew script, and Arial, Avenir Next and New York under `font-kerning: normal`; SF and Hiragino Sans GB whenever the feature list is non-empty.
- **What the port does.** `unitOf`, `startAdvance` and `glyphBefore` all assume word units. C3 can only report; the `space-in-shaping` gap reported 15 cases in all final runs, 1 failing. B2's recipe has the same unchecked assumption.
- **Cost.** Once `font-kerning`, `font-feature-settings` or `font-variant` land, or for Hebrew in those fonts, units are structurally wrong.
- **Replacement.** Make the unit "what Canvas shapes as one piece".
  - When the stretch check disagrees, the stretch between invalid characters becomes the unit. Canvas runs the same `SplitAndInitTextRun` decision in the same font group, so `W(stretch)` is the DOM's total.
  - `glyphBefore` then works over stretches, and B2 is gated by the same check.

### F3. Bidi resolution is decided per paragraph, Gecko decides per document: prepare.ts:625-630

- **What Gecko does.**
  - Blocks resolve bidi when `NS_BLOCK_NEEDS_BIDI_RESOLUTION` is set and `PresContext()->BidiEnabled()` holds (nsBlockFrame.cpp:863-864, :940, :1668, read). `MarkIntrinsicISizesDirty` sets the block bit (:782-785, read).
  - `BidiEnabled` is set document-wide by any text node holding RTL characters (dom/base/CharacterData.cpp:298-302, :405-411, read).
- **What the port does.** It resolves only when this paragraph is RTL or holds RTL code units.
- **What follows from the source** (not probed):
  - Take an LTR paragraph with LRE, LRO, LRI or FSI and no RTL character. Gecko splits its frames at the level changes only after the document has seen RTL text.
  - Frames of one node at different levels don't share a text run (nsTextFrame.cpp:2139-2148, read), so shaping across those edges is lost.
  - The port always predicts the fresh-document case.
- **Cost.** An unnamed page-history condition, next to the named emoji one.
- **Replacement.** Either an Environment fact ("the document has seen RTL text") or a `page-history` gap for paragraphs with LTR-type bidi controls and no RTL. Probe `a‪AV‬b` in 32px Arial, with and without an earlier Hebrew node in the document.

### F4. Gap state written into the prepared paragraph: lines.ts:33-64; types.ts:116-119

- **What it is.** `nextLine` pushes `in-word-prefix` into `prepared.gaps` and sets `inWordGapReported`.
- **Cost.** With the prepare-once, lay-out-at-many-widths API that REPORT §7 item 6 recommends, width A's gap leaks into width B, and the flag suppresses width B's own report.
- **Replacement.** Gaps per line, or an accumulator owned by the layout call.

### F5. The line loop knows only text frames: lines.ts:394-428

- **What Gecko keeps.**
  - A tree of per-span line data. Each span has its own available end, `psd->mIEnd − psd->mICoord − psd->mInset` (nsLineLayout.cpp:798, read), and nsInlineFrame takes the end padding off the span's children on every line (nsInlineFrame.cpp:514-521, read). Probe gecko-lines H12b: `aaa aaa` fits at 67.2px without padding-right and breaks with 9.6px.
  - CanPlaceFrame applies end margins (:1217-1228), always places a BR (:1272-1278), and for content that can't continue a text run returns break-before and pushes the frame (:1340-1341, :1072-1080).
  - After non-text content, ReflowFrame records a break opportunity (:1057-1071).
  - TrimTrailingWhiteSpaceIn recurses into child spans (:2851-2985).
- **What the port keeps.** One scalar `avail`, one `x`, a flat frame list, and one CanPlaceFrame condition.
- **Cost.** Spans with padding, border or margin, `<br>` and atomic inlines each need that per-span structure. None of them can be added as a condition in `reflowPass`.
- **Replacement.** Port nsLineLayout's per-span and per-frame line data (BeginSpan/EndSpan, :378-416) as the line state before adding any box property. `reflowText` and `breakAndMeasureText` can stay as they are.

### F6. Tab x starts at `ll.x`: lines.ts:106-121, :323

- **What Gecko does.** `GetCurrentFrameInlineDistanceFromBlock() − lineContainer->GetUsedBorderAndPadding().left` (nsTextFrame.cpp:11063-11067, read). That includes text-indent and inline start padding; probe H15 checks the text-indent case.
- **Replacement:** take the distance from the span stack of F5.

### F7. One advance function serves two different Gecko quantities: lines.ts:98-103, :231

- **What Gecko does.**
  - The scan sums per-character glyph advances. A ligature's whole width sits on its first character, and partial-ligature widths apply only at the range ends (gfxTextRun.cpp:989, :1139-1149, read).
  - The frame's metrics come from MeasureText (:1195), with proportional shares (ComputePartialLigatureWidth :324, AccumulatePartialLigatureMetrics :767).
  - Audit trace `c-8b93d57e539164e4`: the scan gives Amiri's whole 763 au `ffi` ligature to the first `f`.
- **What the port does.** It uses `W(unit) − W(suffix)` for both.
- **Cost.** The `of­fice` and `AV­ATAR` class (REPORT §6: held-out `latin` 14) can't be modeled even with ligature data, and when a width is off you can't tell which of the two quantities is wrong.
- **Replacement.** Two functions, each named for its source function, with the same recipe today.

### F8. An all-collapsed pass joins the next line: lines.ts:439-450, :463-468

- **What Gecko does.** It keeps a zero-height line box (the port cites nsLineLayout::VerticalAlignLine).
- **Cost.** Nothing today. Once text-indent or `::first-line` land, the first line box may be the empty one; I haven't verified this.
- **Replacement.** Return the empty line and let consumers skip it.

### F9. `Line.width` is the lab's observed extent: lines.ts:605-744, with E5 and E6

- **What it is.**
  - 174 of lines.ts's 771 lines (605-744, 485-507, 751-761) produce the lab's measurement, not a Gecko quantity.
  - The choice between whole-node boxes and code-point rects copies `lineExtent` (lab/score.ts:250-290).
  - The categories come from lab/README.md:148-166.
  - DESIGN §2.1 asks for exactly this ("`width` is the extent the lab observes"). The request was followed, but it put the harness in the library.
  - Gecko's own line box is `engineWidth` (lines.ts:581-604).
- **Census** (stand-in Canvas, `census.json`): lines where `width` isn't the line box.

  | Set | Lines | Cases | Main reason |
  |---|---|---|---|
  | development suite sample | 732 of 67,586 | 626 | hanging white space 531 |
  | runs | 475 of 12,718 | 209 | hanging 397 |
  | ws | 334 of 3,970 | 176 | hanging 277 |
  | policy | 33 of 7,835 | 13 | hanging 33 |
  | smoke | 49 of 1,462 | 21 | hanging 40 |

- **Cost.** Scorer edits force engine edits (gecko-AUDIT §2, B4). A developer aligning or justifying lines needs the line box and hang amounts, not this extent.
- **Replacement.** Engines return geometry they own: the line box, per-fragment advances, the hang amount, and whether a piece has a rect by the engine's own rect rule. The lab derives its observed extent from that in lab code.

### F10. The painter's per-line block forces `text-indent: 0` and `text-align: start`: paint.ts:76-104

- **Cost.** Adding text-indent or text-align means reworking the painter, not just the engine.

## 7. The engine's own tests

`bun test rebuild/src/engines/gecko`: 31 tests, 31 pass.

| What the expectation comes from | Tests | Which |
|---|---:|---|
| Installed Firefox 156 probe verdicts carried over to Courier New's real advance (576 au per ASCII glyph, confirmed by probe gecko-lines H19) | 17 | H1, H2, H4, H5, H8, H9, H10, H11, H13/H14, H15, H16, H22, H23, H24, W3, H12b control, gecko-text H1/H2/H7/H19/H26 |
| Lab-row or probe values modeled in the stand-in | 3 | B1a (probe F3's 960 and 1020 au), synthesized U+2009 (210 au from `c-55485f415fd9dfed`), VT with letter spacing (60 au, `c-92b6963ae4344985`) |
| Real engine data | 1 | props.test.ts against icu_properties 2.1.2 for every code point. Emoji_Presentation, Emoji_Modifier and Joining_Type aren't checked, and joiningType drives D1. |
| The Rust oracle's unit cases and spec §9.5 oracle outputs (a second port) | 3 | break-flag tests; now also backed by the 5M-position replay |
| Spec examples | 1 | TransformText §6.3 (partly probe-backed: gecko-text H10, H12, H14) |
| The port's own arithmetic or invariants | 6 | tiling; B2 gap discrimination over a stand-in kern pair; B3 (expected 1812 and 660 au are stand-in arithmetic, the native case was 24px Amiri); B1b widths (stand-in hyphen 432 au against native 240; starts are native); B4 `engineWidth` 2388 (stand-in arithmetic); tab-size 0 and a negative tab width (source reading, no probe) |

Also in the H13/H14 test, the line box values [3456, 1152] are port values; only the starts and the visible width 38.4 were observed.

No test exercises `W(unit) − W(suffix)`, D1, B2 with real shaping, or F9's width rules against native geometry. Only lab rows do. The stand-in makes every code point the same width, so those recipes can't fail in unit tests.

## 8. Readiness for the features you named

| Feature | What the port needs | Kind |
|---|---|---|
| Inline boxes with padding, border or margin | per-span line data, span end reduced per line (H12b), end margins in CanPlaceFrame, trim recursion, F1's box checks, F6's tab distance | rework (F5) |
| `<br>` | a BR frame kind: always placed (:1272-1278), skipped when trimming, line breaker flushed with no trailing break (nsTextFrame.cpp:2243-2272, read) | additive once F5 exists |
| Atomic inlines | push path and break-before, optional break after the atom, line breaker flush, text runs ended | rework (F5) |
| text-transform | unit strings are built from `tUnits` (prepare.ts:845-851, :500); case mapping changes what's measured but Gecko merges characters back onto source indices, so the index arrays can stay and the measured string has to be separated | moderate; F1 item 4 |
| hyphens: auto | the auto-hyphenation branch (gfxTextRun.cpp:959-964, :1027-1040, :1064-1128, read) is omitted; hyphenation dictionaries aren't available to a page, so it also needs a gap | additive plus a gap |
| text-align | line box and hang amount are known in `reflowText` but not returned (F9, E5); painter forces `start` (F10) | moderate |
| text-indent | the available width per line is already a parameter; tab x (F6), the empty-line join (F8) and the painter (F10) need changes | small to moderate |
| Variable line widths | `nextLine(width)` per line, and the line start carries only an offset, which is sound; the gap state in the prepared paragraph (F4) is the only obstacle | small |

## 9. Plain judgement

**Structurally sound.**
- Break opportunities: TransformText, glyph flags, nsLineBreaker, ICU4X and the property data.
- The text-frame line loop.

These are ports that follow Gecko's data flow, verified by source reading, a 5M-position oracle replay and probe verdicts. New issues there should be bugs in the port, fixable in place.

**Where it will slip as issues accumulate.**
1. **In-word advances.** `W(unit) − W(suffix)` is a principled recipe, but it can't see glyph records. The joining variant was picked by suite score and contradicted by a probe (D1). Adding rows to tune it is overfitting. This needs a DOM-geometry probe, and the gap where no recipe is exact.
2. **`width`.** It's the scorer's model living in the engine (F9, E5, E6, D2). Every harness fix edits engine code, and consumers get lab categories.
3. **No inline-box structure** (F5, F1, F6). The first span box property forces a new line state.
4. **Word units hard-wired** (F2) against Gecko's per-font whole-run shaping.
5. **Page and platform state.** The document's bidi flag (F3), gaps stored in the prepared paragraph (F4), and two font-family literals (E1, E3).

**Not cheap shortcuts in the MVP sense.**
- No DOM widths, no epsilons, no case-id keys.
- The approximations are few and named: likely subtags (E4), U+2007/U+2008 (C6), ligature-group spacing (C7).

## 10. Limits of this audit

- The census uses a stand-in Canvas. It counts code paths and output shapes, not accuracy.
- F3 comes from source and wasn't probed. D1's replacement probe wasn't run. My part had no browser work.
- I read the relevant sections of specs/gecko-text.md and gecko-lines.md, not every line of them.
- F8's effect on text-indent isn't verified.
- The painter entries (B10, B11, D3, E8-E10) are brief; painter accuracy is outside this part.
