# Completeness critic for the nine engine specs

Reviewed files, all in `~/github/pretext-rebuild/rebuild/specs/`: `blink-lines.md`, `blink-text.md`, `blink-canvas.md`,
`webkit-lines.md`, `webkit-text.md`, `webkit-canvas.md`, `gecko-lines.md`, `gecko-text.md`, `gecko-canvas.md`.
All nine were read in full. No browser was launched.

Checkouts used for spot-checks:
- `C153/` = `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/` (the sparse checkout has
  finished; HEAD `199a3a54 Incrementing VERSION to 153.0.8010.48`). The three Blink specs cite gitiles copies because
  this checkout was still downloading when they were written. Every Blink line number checked below matches the local
  153 files.
- `W/` = `~/github/browser-engines/webkit-7625.1.29.11.27/Source/WebCore/` (HEAD `2756e8be`).
- `F/` = `~/github/browser-engines/firefox-156.0/` (HEAD `3bf8f468`).

Terms used here:
- **covered**: the spec states how the pinned source produces the fact, with `path:line` citations read at the pinned
  version.
- **partial**: some of it is cited, but a branch that changes line results is inferred, taken from the groundwork
  without a re-read, or missing.
- **missing**: no spec for that engine addresses it.

---

## 1. Coverage

### 1.1 The maintainer's ten facts

| Fact | Blink (Chrome 153) | WebKit (Safari 27.0) | Gecko (Firefox 156) |
|---|---|---|---|
| 1. Styled runs; no break between bold `foo` and regular `bar` | covered: one iterator over the whole paragraph text, `IsBreakable(item end)`, close-tag rules (blink-lines §7; blink-text §2.F.6) | covered: `mayBreakInBetween`, where the next node's style decides and the prior context is the previous node's last 2 code units (webkit-text §7.4; webkit-lines §5) | covered: `nsLineBreaker` grows a word across `AppendText` calls; backup pass (gecko-text §8; gecko-lines §3.6, §4.7) |
| 2. Engine break data, pinned | covered: pair table, space rule, break-all/keep-all, ICU 78.2 table selection verified with `icudtl.dat` (blink-text §2.F; blink-canvas Part 2) | partial: scan, table and classes are verbatim, but Apple ICU 78.1 source is unpublished. The quote overrides are read from AppleICU76 and checked with 1.7M probes; the ICU default locale in the WebContent process is unknown (webkit-canvas §2.6; webkit-text §4.3) | covered: ICU4X 2.1.2 with Firefox's baked data; the groundwork oracle rebuilt against 156 data (gecko-text §8-§10; gecko-canvas §4) |
| 3. White space and control characters | partial: processing is covered. The DOM **width** of FF, VT and other C0 controls under `white-space: normal` is not determined (blink-text H5, H6; see §5 item 2) | covered: renderer rule, items, .notdef and CR advances (webkit-text §2, §5.3; webkit-lines §3.3) | covered: `TransformText`, invalid characters, hidden controls (gecko-text §3, §6, §7) |
| 4. Filling structure | covered: re-break walk, whole-line redo with grapheme breaks (blink-lines §9) | covered: both builders, breaker, `breakWord` (webkit-lines §5-§8) | covered: `BreakAndMeasureText`, line priority, one backup (gecko-lines §4, §6) |
| 5. Units and rounding | covered (blink-lines §1) | covered (webkit-lines §1) | partial: Canvas X-rounding is verified; for DOM text, "no Cairo context, so no snapping" is inference (gecko-lines §2.5) |
| 6. Widths known only after breaking | covered: line-start and line-end reshape, tabs, hyphen, trailing-space removal (blink-lines §6, §8.3, §11, §12) | covered: `breakWord` prefix measurements, tabs, carry (webkit-lines §8) | covered: tabs, hyphen, trimming (gecko-lines §4.6, §4.8) |
| 7. Direction, language, DPR/zoom | partial: zoom and DPR covered (blink-lines §2); bidi levels "via ICU ubidi" with no port-level rules | partial: bidi paragraph text covered. The stable `EvaluationTimeZoomEnabled` pref is not mentioned, and the font size under page zoom is left open (webkit-canvas H9; see §3 W5) | partial: apd covered. `unicode-bidi` 0.3.15 rules not re-read (gecko-text §20); DOM glyph rounding inferred |
| 8. Next line's start state | covered: `{item, offset}`, style, forced flag (blink-lines §4.1) | covered: position plus carried width, and 5 other items (webkit-lines §8.2) | covered: content offset only (gecko-lines §4.8) |
| 9. Canvas isn't the DOM | covered (blink-canvas §1.8, (e); blink-lines §20) | covered (webkit-canvas §1.5, (e)) | covered (gecko-canvas §1.10, §3) |
| 10. Hypotheses | 16 + 37 + 25 probes | 22 + 30 + 19 | 24 + 33 + 25 |

### 1.2 Checklist items (a)-(g)

| Item | Blink | WebKit | Gecko |
|---|---|---|---|
| (a) algorithm with pseudo-code | covered. Gaps: `HandleForcedLineBreak` (`line_breaker.cc:2856-2940`), `HandleBidiControlItem` and `SplitTrailingBidiPreservedSpace` are summarized, not ported | covered. Gap: `TextShapingAcrossInlineBoxes` RTL widths described but not ported (webkit-lines §9.3) | covered. Gaps: the `BuildTextRuns` partial rescan (gecko-lines §12); UAX #9 L1 for trailing white space |
| (b) `path:line` citations | covered (gitiles at 153; they match the local checkout) | covered | covered |
| (c) exact arithmetic | covered | covered | covered (DOM X rounding inferred) |
| (d) runtime flags and prefs | covered (`runtime_enabled_features.json5`) | partial: `EvaluationTimeZoomEnabled` (stable, default true, `UnifiedWebPreferences.yaml:2862-2874` via `git show`) missing; `text-rendering: optimizeSpeed` turning off `calt` in DOM text (`W/platform/graphics/cocoa/UnrealizedCoreTextFont.cpp:250-256`) missing | covered (`StaticPrefList.yaml`) |
| (e) What Canvas can supply | covered in all three specs | covered in all three | covered in all three |
| (f) hypotheses | covered | covered, one wrong expectation (§3 W7) | covered |
| (g) differences from groundwork | covered | covered | covered |

### 1.3 CSS features in the checklist

| Feature | Blink | WebKit | Gecko |
|---|---|---|---|
| `white-space` (6 values) | covered | covered | covered |
| `word-break` normal/break-all/keep-all/break-word | covered | covered: break-all acts only at overflow | covered |
| `overflow-wrap` normal/break-word/anywhere | covered | covered | covered |
| `line-break` auto/loose/normal/strict/anywhere | covered: locale table, strict needs a locale, ko strict fails | covered: no lang means root ICU; `canBreakBefore` | covered: strictness mapping, sticky `cjFlag` |
| `hyphens: manual` + SHY | covered: retry narrower | covered: both builders differ | covered: fit width vs frame width |
| `letter-spacing` | covered | covered | covered: cursive skip verified at `F/intl/components/src/UnicodeProperties.h:350-355` |
| `word-spacing` | covered | covered (LineBuilder only) | covered |
| `tab-size` | covered | covered | covered |
| `text-transform` where it changes measured text | covered | covered | covered: **breaks are computed on pre-transform text** (gecko-text §8.1, §13) |
| `direction` ltr/rtl, bidi | partial: levels from ICU, no UAX #9 details | partial: same | partial: `unicode-bidi` 0.3.15 with Unicode 15.0 tables, rules not re-read |
| `lang` on paragraph and spans | covered | covered | covered |
| DPR and zoom | covered | partial (§3 W5) | covered |

---

## 2. Citation spot-checks (41 checked)

"OK" means the source at the cited lines says what the spec claims.

| # | Spec | Citation | Claim | Verdict |
|---|---|---|---|---|
| 1 | blink-lines §1.2 | `C153/platform/geometry/layout_unit.h:125-130, 134-136` | `LayoutUnit(float)` truncates; `FromFloatCeil` = `ceilf(v*64)` | OK |
| 2 | blink-lines §1.5 | `C153/core/layout/inline/line_breaker.h:307-317` | fit is `position_ <= available + 1 raw` | OK. The source also has `\|\| (parent_breaker_ && !auto_wrap_)`, which applies to ruby only |
| 3 | blink-lines §1.2, §9.1 | `C153/core/layout/inline/line_breaker.cc:4143` | `inline_size - 1` subtracts one whole px | OK (an `int` operand) |
| 4 | blink-lines §5.2 | `line_breaker.cc:1692, 1703, 1737-1750, 1758` | overflow width `+1` px; `SnappedWidth().ClampNegativeToZero()`; fit uses `inline_size` | OK |
| 5 | blink-text §2.C.9 | `line_breaker.cc:2988-2994` | CR and FF control items → `HandleEmptyText` | OK |
| 6 | blink-text §2.C.2 | `C153/platform/text/character.h:150-153` | collapsible space includes CR | OK |
| 7 | blink-canvas §1.3 | `C153/platform/fonts/plain_text_node.cc:47-60`; `character.h:226-238` | Canvas turns U+0009..U+000D into U+0020 | OK |
| 8 | blink-canvas §1.3 | `C153/platform/fonts/plain_text_painter.cc:251, 260` | Canvas passes `mode_ == kCanvas` | OK |
| 9 | blink-lines §2.3 | `C153/platform/fonts/font_description.cc:271-282`; `font_cache_key.h:53` | `floorf(size*100)/100` in float32 | OK (`unsigned` 100 promotes to float) |
| 10 | blink-canvas §1.3 | `C153/core/html/canvas/text_metrics.cc:179, 222` | `float xpos`, summed per item | OK |
| 11 | blink-lines §1.3 | `C153/platform/fonts/shaping/shape_result.cc:1551-1553, 1576, 1609` | 16.16 advances; run width clamped at 0 → float; float32 sum | OK |
| 12 | blink-text §2.E | `C153/platform/fonts/shaping/harfbuzz_face.cc:110-113` | U+2028 and U+2029 use the space glyph | OK |
| 13 | blink-text §2.A | `C153/platform/wtf/text/ascii_ctype.h:102-104` (cited at 152) | `IsAsciiSpace` includes VT | OK |
| 14 | blink-text §2.F.5 | `C153/platform/text/text_break_iterator.cc:292-302`; `character.h:156-158` | break-spaces: break after space or U+3000 | OK |
| 15 | blink-canvas §2.4 | same lines | "SP/TAB/LF or other Zs" | **Wrong**: `IsOtherSpaceSeparator` is U+3000 only |
| 16 | blink-lines §1.3 step 3 | `shape_result.cc:997-1044` | after spacing, run width is "rebuilt the same way" as step 2, whose rule clamps at 0 | **Imprecise**: `:1041` assigns `run->width_ = total_advance_for_run` with no clamp (blink-canvas §1.5 has it right) |
| 17 | blink-lines §0.2 | `C153/platform/fonts/shaping/shaping_line_breaker.cc:370-375`; `runtime_enabled_features.json5:3865-3866` | new `LineBreakerHanKerningEnd` branch, flag stable | OK |
| 18 | blink-text §2.F.6 | `runtime_enabled_features.json5:3861-3862` | `LineBreakAfterSpaceBeforeOpenTag` stable | OK |
| 19 | webkit-lines §1.4 | `W/layout/formattingContexts/inline/InlineLineBuilder.cpp:1172-1183` | available width = line width + 1/64 − content right | OK |
| 20 | webkit-lines §1.4, §2 | `W/.../inline/TextOnlySimpleLineBuilder.cpp:318, 481-486, 488-528` | fast commit `<=`; epsilon except min-content; eligibility | OK |
| 21 | webkit-lines §3.3 | `W/.../inline/text/TextUtil.cpp:62-104, 111-122` | item + following space − (space + word-spacing); single preserved space | OK |
| 22 | webkit-text §5.4 | `W/rendering/BreakablePositions.h:124-139, 141-255` | U+2028/U+2029 are breakable spaces; stale state after fast-forward | OK (the fast-forward loop never refreshes `after`) |
| 23 | webkit-lines §7 | `W/.../inline/InlineContentBreaker.cpp:105-122, 124-137, 139-158, 877-915` | hyphen revert; `canBreakBefore`; line-start prohibition; `wordBreakBehavior` | OK |
| 24 | webkit-lines §3.3; webkit-text §5.3 | `W/platform/graphics/WidthIterator.cpp:792-823` | LF and CR take the space glyph but keep their own advance; other Cc get the .notdef advance | OK |
| 25 | webkit-lines §3.3 | `W/platform/graphics/WidthIterator.cpp:694-742` | simplified measuring allows CR and LF, rejects other controls and chars ≥ U+3041 | OK |
| 26 | webkit-canvas §1.5 table | same lines | "not a control, format character, NBSP or SHY" | **Imprecise**: omits the CR/LF exception (`:698-701`) and U+2592 |
| 27 | webkit-lines §8.2 | `W/.../inline/AbstractLineBuilder.cpp:54-98` | carried remainder rules | OK |
| 28 | webkit-canvas §1.2 | `W/html/canvas/CanvasRenderingContext2DBase.cpp:2847-2875` | normalizeSpaces turns U+0009..U+000D into spaces | OK |
| 29 | webkit-canvas §1.3; webkit-text §10 | `W/platform/graphics/cocoa/UnrealizedCoreTextFont.cpp:258-264` | letter-spacing turns off liga/clig/dlig/hlig, not calt | OK. Unmentioned: `:250-256` `text-rendering: optimizeSpeed` also turns off `calt` |
| 30 | webkit-text §2 | `W/rendering/updating/RenderTreeUpdater.cpp:536-595` | text renderer rule | OK |
| 31 | webkit-lines §1.2 | `W/style/values/primitives/StylePrimitiveData.h:299-306` | fixed length = `m_floatValue * zoom` | OK |
| 32 | webkit-lines §1.6 | `W/style/StyleFontSizeFunctions.cpp:45-...` | computed font size includes zoom | **Incomplete**: `:65-66` returns the specified size unzoomed for `MinimumFontSizeRule::None` (the Canvas path, `StyleResolveForFont.cpp:380`). The DOM path `:86-95` uses `style.usedZoom()`. The stable `EvaluationTimeZoomEnabled` pref (`StyleBuilderState.cpp:105-113` uses zoom 1.0 under it) isn't mentioned |
| 33 | gecko-lines §2.8, §4.5 | `F/gfx/thebes/gfxTextRun.cpp:1068-1109` | record `<=`; stop `>`; priority | OK |
| 34 | gecko-text §6.1 | `F/layout/generic/nsTextFrameUtils.cpp:32-49` | SHY and 16-bit bidi controls discarded, CR kept | OK |
| 35 | gecko-text §8.2 | `F/dom/base/nsLineBreaker.h:260-264` | word ends at SP, TAB, CR | OK |
| 36 | gecko-lines §2.5 | `F/gfx/thebes/gfxHarfBuzzShaper.cpp:1559, 1700-1703` | `floor(apd/65536 * advance + 0.5)` | OK |
| 37 | gecko-lines §4.4 | `F/layout/generic/nsTextFrame.cpp:11202-11251, 11272-11273` | trim or hang; frame width `NSToCoordCeilClamped` | OK |
| 38 | gecko-lines §4.4 | `nsTextFrame.cpp:904-919` | trimmable: SP, U+1680, TAB, FF, LF, CR | OK |
| 39 | gecko-lines §5 row "CR, FF, VT" | same lines, plus `:926-941` | "all three are trimmable" | **Wrong**: VT is not in either `IsTrimmableSpace` |
| 40 | gecko-text §12.1; gecko-lines §4.6 | `F/intl/components/src/UnicodeProperties.h:350-355`; `nsTextFrame.cpp:4202-4214, 4388-4399, 6829-6845` | cursive list; hyphen fit width includes letter spacing, frame width doesn't | OK. gecko-lines' "outside the sparse checkout, not re-read" is out of date: the file is in the checkout and matches |
| 41 | gecko-canvas §1.3, §1.11; gecko-text §3 | `F/dom/canvas/CanvasRenderingContext2D.cpp:4634-4637`; `StaticPrefList.yaml:10927-10930`; `F/layout/base/nsCSSFrameConstructor.cpp:5278-5287`; `F/dom/base/CharacterData.cpp:500-515`; `F/gfx/thebes/gfxMacFont.cpp:566-569`; `F/layout/style/ServoStyleConstsInlines.h:584-595`; `F/gfx/src/nsDeviceContext.cpp:52-63` | whitespace replacement; hidden controls; whitespace-only nodes 8-bit only; no X rounding without Cairo; `NSToIntRound(float(px)*60)`; apd | OK |

---

## 3. Wrong or imprecise statements

- **W1** blink-canvas §2.4 says `kAfterEverySpace` breaks after "other Zs". It breaks only after U+3000
  (`C153/platform/text/character.h:156-158`). blink-text §2.F.5 is correct.
- **W2** blink-lines §1.3 step 3 reads as if run widths are clamped at 0 after letter or word spacing. They are not
  (`shape_result.cc:1041-1044`). The item's `inline_size` is still clamped later (`line_breaker.cc:1703`), so the fit
  result is unchanged, but a float32 sum over several runs can differ.
- **W3** gecko-lines §5 row "CR, FF, VT" says all three are trimmable at line start and end. VT is not
  (`nsTextFrame.cpp:904-919, 926-941`). gecko-lines §4.4 and the gecko-text §6.4 table are correct.
- **W4** gecko-lines §4.6 and §12 say the cursive-script list was not re-read at 156. It is in the checkout at
  `F/intl/components/src/UnicodeProperties.h:350-355` and matches gecko-text §12.1.
- **W5** webkit-lines §1.6 says the font's computed size includes zoom, citing `StyleFontSizeFunctions.cpp:45-...`.
  That helper applies zoom only when a minimum-font-size rule is active. The DOM caller at `:86-95` passes
  `style.usedZoom()`. The stable `EvaluationTimeZoomEnabled` pref, default true, moves length zoom to evaluation time
  (`W/style/StyleBuilderState.cpp:105-113`; `W/style/values/primitives/StylePrimitiveNumericTypes+Conversions.h:64,
  82, 200`). No WebKit spec covers it, so "under page zoom Z every length and font size is multiplied by Z before
  truncating" is unverified.
- **W6** The webkit-canvas §1.5 table lists the simplified-measuring conditions without the CR/LF exception
  (`WidthIterator.cpp:698-701`). webkit-lines §3.3 is correct.
- **W7** webkit-lines H13 expects `<div></div>` to produce one line. An empty block has no line box and height 0. Also,
  `<div>\r</div>` in HTML source reaches the DOM as `\n` (webkit-text §2: `InputStreamPreprocessor.h:89-93`). Set the
  text with `textContent` and compare against `<div>x</div>`.
- **W8** blink-text §3 writes the fit bound as "available + 1/64". It is +1 raw LayoutUnit, which is 1/64 of a
  **zoomed** px: 1/128 CSS px on a Retina screen at 100% zoom (blink-lines §1.5, §2.4).

---

## 4. Contradictions and cross-spec disagreements

### 4.1 Settled by source in this review

| # | Specs | Disagreement | Source says |
|---|---|---|---|
| C1 | blink-text vs blink-canvas | break-spaces space set: U+3000 vs "other Zs" | U+3000 only (W1) |
| C2 | blink-lines vs blink-canvas | run width clamp after spacing | no clamp (W2) |
| C3 | gecko-lines §5 vs gecko-lines §4.4 and gecko-text | VT trimmable | not trimmable (W3) |
| C4 | webkit-lines vs webkit-canvas | simplified measuring with CR and LF | allowed (W6) |
| C5 | gecko-lines §8 vs gecko-text §2.3 and gecko-canvas | `text-autospace` initial value "not re-read" | read at 156: `no-autospace` |
| C6 | blink-text §5 vs blink-canvas §1.3 | `CanShapeWordByWord` conditions "from groundwork" | re-read at 153 by blink-canvas |

### 4.2 Still open (browser probes in §6)

| # | Specs | Disagreement |
|---|---|---|
| C7 | blink-lines §2.5, §20 vs blink-canvas §1.8 | blink-lines says DOM widths at zoom 2 come from Canvas at `2 × font-size` [I]. blink-canvas says that fails for fonts with an `opsz` axis or `trak`+`STAT`, and for system-ui, because the DOM gives opsz and HarfBuzz `ptem` the unzoomed size (`font_platform_data_mac.mm:170-176`; `harfbuzz_face.cc:648`). |
| C8 | gecko-lines §2.5 vs gecko-canvas §1.6 | DOM glyph X rounding: gecko-lines infers "no Cairo context, so no snapping". gecko-canvas verifies this only for Canvas and says the main-thread reference draw target (`gfxPlatform.cpp:1006`) is untraced. If layout text runs had `kRoundX`, DOM advances would snap to device pixels and depend on DPR. |
| C9 | gecko-lines §3.3 vs gecko-text §6.2, §19.3 | Context for East Asian segment-break removal: gecko-lines says "neighbors must be inside the same run" (the groundwork's per-direction-run rule). gecko-text says only the current mapped flow's text, so never across a text node. |
| C10 | webkit-lines §1.6 vs webkit-canvas H9 and open questions | Font size under page zoom: "read" vs "not read at this tag". See W5. |
| C11 | webkit-text §4.2 vs webkit-canvas §2.5 | ICU default-locale fallback. webkit-canvas found identical tables and overrides for defaults `en_US_POSIX` and `zh_CN`. webkit-text cites the groundwork probe, where default `ja_JP` made `und` and `mul` behave like `ja`. Both leave the WebContent process default unknown. |
| C12 | maintainer fact 9 vs all three canvas specs | "Safari's Canvas measures CR, FF and VT as spaces": source says **all three** engines' Canvas do this (`C153/platform/fonts/plain_text_node.cc:49`; `W/html/canvas/CanvasRenderingContext2DBase.cpp:2855`; `F/dom/canvas/CanvasRenderingContext2D.cpp:4635`). The DOM differs per engine: Blink CR = space and FF/VT literal in collapse modes, zero-width control items in preserve modes; WebKit CR advance kept from the glyph lookup, FF/VT `.notdef`; Gecko zero width. |
| C13 | maintainer fact 9 vs blink-canvas H27 and gecko-canvas §1.10 | "Canvas letterSpacing keeps ligatures the DOM turns off": source says WebKit only. Chrome's and Firefox's Canvas letter spacing also turns optional ligatures off, with different thresholds in Firefox. |
| C14 | blink-text §2.B, webkit-lines §3.1 vs gecko-text §8.1, §13 | What text the break iterator sees under `text-transform`. Blink and WebKit break the transformed string; Gecko breaks the white-space-transformed text **before** `text-transform` and copies the flags into the transformed run. No spec has a probe where the transform changes break classes. |
| C15 | the three canvas specs | OffscreenCanvas language. Blink reads the document root's inherited language at font resolve and keeps it until the font string changes. Gecko re-resolves on every measure. WebKit has no locale at all. These are engine differences, but the rebuild's adapter must treat each engine separately. |

---

## 5. Prioritized missing readings

1. **How the DOM painter keeps predicted widths (all engines).** No spec says how painted lines reproduce the widths the
   model predicted. Splitting text into per-line nodes changes:
   - WebKit: `mayBreakInBetween` context and "item + following space" measurement (`W/.../text/TextUtil.cpp:76-99`);
     webkit-text §7.5 only says spans must be painted as their own runs;
   - Blink: HarfBuzz pre- and post-context (5 code points, `hb-buffer.hh:109`), Arabic joining across calls, and
     line-edge reshape;
   - Gecko: text runs, mapped flows, segment-break context and the word cache.

   Needed: read what each engine does for the chosen painting form (for example one `nowrap` span per line), and add
   probes.
2. **Blink DOM width of FF, VT and other C0 controls in collapse modes.** A grep of
   `C153/platform/fonts/shaping/*.cc` finds no special case. Read `HarfBuzzFace::GetGlyph` fallback,
   `FontFallbackList`/`FontCache::PlatformFallbackFontForCharacter`, and HarfBuzz's default-ignorable handling for C0.
3. **Bidi level resolution, port-level rules, per engine.**
   - Blink: ICU 78.2 `ubidi` over text_content, with isolates and U+FFFC for floats.
   - WebKit: libicucore 78.1 `ubidi` over its paragraph text.
   - Gecko: Rust `unicode-bidi` 0.3.15 with **Unicode 15.0** tables after `ReplaceSeparators`.

   Missing everywhere: bracket pairs (N0), L1 trailing white space, levels of opaque items, and what the Unicode 15 vs
   17 table difference changes.
4. **WebKit zoom path.** Trace `EvaluationTimeZoomEnabled`, `usedZoom()` and `usedZoomForLength()` for content-box width
   truncation and for the font's computed size (W5, C10).
5. **Gecko DOM X rounding.** Which draw target layout text runs are built with
   (`nsTextFrame` reference draw target → `gfxFont::GetRoundOffsetsToPixels`, `gfx/thebes/gfxFont.cpp:1070-1107`) (C8).
6. **Blink unsafe-to-break offsets without font files.** Line-start and line-end reshape depend on HarfBuzz
   `UNSAFE_TO_BREAK` flags (`shape_result.cc:1360-1392`; `shaping_line_breaker.cc:309-324, 511-584`). Canvas can't
   expose them, and loading font files is forbidden. A spec must say which Canvas totals detect a reshape difference
   (for example `W(prefix)` vs the contextual sum), or accept a documented loss.
7. **Blink handlers not ported:** `HandleForcedLineBreak` (`line_breaker.cc:2856-2940`), `HandleEmptyText`,
   `HandleBidiControlItem` (`:3001-3041`), `SplitTrailingBidiPreservedSpace` (`:2749-2853`),
   `ComputeTrailingCollapsibleSpaceHelper` (`:2668-2747`).
8. **Unobservable font facts the recipes depend on:**
   - Blink `CanShapeWordByWord` (is the space glyph in GPOS/GSUB coverage);
   - Gecko `SpaceMayParticipateInShaping` (`gfxFont.cpp:1550-1596`);
   - whether the primary font has U+2010 (all engines);
   - WebKit fixed-pitch eligibility.

   Each needs a Canvas-observable test, or a stated loss.
9. **WebKit Apple ICU:** Thai, Lao, Khmer and Myanmar dictionary/LSTM results in libicucore 78.1 (one sample only), and
   `uloc_getDefault` in WebContent (C11).
10. **Gecko:** `BuildTextRuns` partial rescan (`nsTextFrame.cpp:1633-1693`) and its effect on `cjFlag` and the carried
    white-space bit; HarfBuzz 14.3.1 `trak`+`STAT` possible double tracking (`hb-ot-shape.cc:216-221`).
11. **WebKit `text-rendering: optimizeSpeed`** turns off `liga, clig, dlig, hlig, calt` in DOM text
    (`UnrealizedCoreTextFont.cpp:250-256`), and Canvas has no `textRendering` attribute. Not in any spec.
12. **Blink `HanKerning::MayApply`** (DOM line ends and Canvas words); blink-lines probe 15 and blink-canvas (g)3 depend
    on it.
13. **Blink `GetHyphenationWithLimits()`** returning null for `hyphens: manual` is inferred (blink-lines §10).
14. **8-bit vs 16-bit storage of JS-created and parser-created text nodes** in all three engines. It decides:
    - Blink's single Latin segment (`inline_node.cc:1256-1266`);
    - WebKit keep-all punctuation breaks and 1-unit emergency breaks;
    - Gecko whitespace-only frame suppression (`CharacterData.cpp:500-508`).
15. **Blink DOM geometry.** Conversion from LayoutUnits to CSS px in `getClientRects` at DPR 2. Probes read results at
    1/128 px.

---

## 6. Hypotheses that settle the open contradictions

Each line gives the probe and the outcome per the source.

1. **C7, Blink zoom recipe.** Retina (DPR 2), zoom 100%. The DOM span width of `Hello world`:
   - at `16px Arial`: equals `OffscreenCanvas measureText` at `32px Arial` / 2, within 1/128 px;
   - at `13px system-ui`: differs from both `W(13px)` and `W(26px)/2`.
2. **C8, Gecko DOM X rounding.** DPR 2, `font: 16px Georgia`, span `bbb`.
   - Without snapping: width = 1614/60 = 26.9px (538 au per `b`, gecko-lines §2.5).
   - With device-pixel snapping: a multiple of 1/30 px, for example 26.8667 or 26.9333.
3. **C9, Gecko segment-break context.** `<p lang="en" style="font:16px 'PingFang SC'">`.
   - `<span>日本` newline `<span>語</span></span>`: width equals `日本 語` (a space).
   - `<span>日本` newline `語</span>`: width equals `日本語`.
4. **C10, WebKit page zoom.** Safari at 125% page zoom, `<div style="width:100.3px">`, with text whose single-line f32
   width, measured at the zoomed font size (`20px Arial` for a `16px Arial` page), lies in (125.375, 125.390625]
   zoomed px.
   - Zoom before truncation: `trunc64(100.3 × 1.25) = 125.375`, fit bound 125.390625, so 1 line.
   - Truncation before zoom: `trunc64(trunc64(100.3) × 1.25) = 125.359375`, fit bound 125.375, so 2 lines.
5. **C11, WebKit ICU default locale.** `<div lang="und" style="font:16px Menlo;width:50px">abcd.“efg”</div>`: 2 lines
   if the WebContent default has en-like quote overrides, 1 line if ja-like.
6. **C12, Canvas controls in all engines.** On a fresh OffscreenCanvas in Chrome, Safari and Firefox, `16px Arial`:
   `measureText("a\fb") === measureText("a b")`, and likewise for `\v` and `\r`.
7. **C13, Canvas ligatures under letter spacing.** OffscreenCanvas `40px "Hoefler Text"`, `letterSpacing='1px'`, `fi`.
   - Chrome and Firefox: width = `W("f") + W("i") + 2`.
   - Safari: width = ligature width + 1.
8. **C14, break text before or after `text-transform`.**
   `<div style="width:1px;text-transform:full-width;font:16px 'Hiragino Sans'">ab</div>`.
   - Chrome: 2 lines (breaks the transformed `ａｂ`, class ID).
   - Safari: 2 lines (ICU on `ａｂ`).
   - Firefox: 1 line (breaks `ab` before the transform).
9. **W1, Blink break-spaces.** `white-space:break-spaces;width:1px`, text `a b` (NARROW NO-BREAK SPACE, Zs, class
   GL): 1 line. An "other Zs" reading would give 2 lines.
10. **W3, Gecko VT.** `white-space:normal;font:16px "Courier New";width:57.6px`, textContent `aaaa \vbbbbb`: `Range`
    rects show the VT kept at the start of line 2 with zero width, not trimmed away. Low value, because VT has zero
    width either way.
11. **W7, WebKit empty nodes.** `<div id=a></div>` height 0. `a.textContent = "\r"` also gives height 0 (no renderer).
    `a.textContent = "\v"` gives one line.
12. **W8, Blink fit bound at DPR 2.** `16px Arial`, `nnnnn nnnnn`, with `C128 = ceil(W(32px) × 64)`:
    - width `(C128 − 1)/128` px: 1 line;
    - width `(C128 − 2)/128` px: 2 lines.

    A +1/64 CSS px bound would keep 1 line at `(C128 − 2)/128`.

---

## 7. Open questions

- Is installed Chrome's layout zoom 2 on a Retina display? The source trail (`web_frame_widget_impl.cc:2525-2575`) is
  outside the local sparse checkout and was read only from gitiles by blink-lines.
- Which painting form will the rebuild use, and does each engine lay it out with the same widths the model predicted?
  (§5 item 1)
- Can the Canvas-only runtime detect Blink reshape boundaries, Blink `CanShapeWordByWord`, Gecko
  `SpaceMayParticipateInShaping` and primary-font U+2010 coverage? If not, list them as accepted losses.
- UI and system locales on this Mac (`AppleLanguages` = zh-Hans-US, en-US). They reach:
  - Blink: unlabeled break tables, Canvas generic families;
  - WebKit: the Han locale swap to `zh-CN`, grapheme and capitalize iterators;
  - Gecko: `mLanguage` without `lang`, and the ja/zh newline rule.

  Probe pages must set `lang` explicitly, and the rebuild must model the no-lang case per engine.
- Font-size precision in Canvas: Blink floors to 1/100 px in both Canvas and DOM; Gecko quantizes Canvas sizes to 7
  significant bits while the DOM uses a 1/60 px grid; WebKit applies neither. Fractional CSS sizes need a per-engine
  gate before Canvas totals count as exact.
