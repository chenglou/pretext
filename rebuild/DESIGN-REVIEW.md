# Design review

A reviewer's pass over `rebuild/DESIGN.md` and `rebuild/src`, 2026-09-16. No code was edited and no browser was
launched.

- **Read:** DESIGN.md; every file under `src/`; `lab/types.ts`, `lab/predictor.ts`, the `lang` and document handling
  in `lab/page.ts`, and the width and painter metrics in `lab/score.ts`; the specs blink-lines, blink-text,
  blink-canvas, webkit-lines, webkit-text, webkit-canvas, gecko-lines, gecko-text, gecko-canvas, CRITIC, bidi, painter,
  blink-gaps and gecko-gaps.
- **Not available:** `specs/PROBES.md` and `probes-*.md` don't exist, so no installed-browser verdict overrides
  anything below.
- **No literal MUST lists:** a grep for MUST finds nothing in the specs. The review took each [V] rule, each
  pseudo-code step and each numbered hypothesis instead.
- **Timing:** painter.md, bidi.md, gecko-gaps.md and blink-gaps.md were written within minutes of DESIGN.md (file
  times 07:15-07:26). Several findings are places where a spec written at the same time says more than the design
  could.

For each rule the question was: can an engine owner implement it inside `src/engines/<engine>/`, their generator and
their generated module, without changing `model.ts`, `env.ts`, `paint.ts`, `measure/`, `unicode/` or `breaks/`?

## 1. Verdict per topic

| Topic | Inside the engine directory? | Verdict |
|---|---|---|
| Breaks decided across span edges | Yes. Blink's one iterator over text_content with the current style's locale (blink-lines §7; blink-text §2.F.1-2), WebKit's next-box style with two units of prior context (webkit-text §7.4) and Gecko's word growing across flows (gecko-text §8.3) all fit `prepare` over `rbbi.ts` and `icu4x.ts` | Right |
| Safari's carried remainder and builder choice | Yes: `WebKitLineStart.carriedWidth`, `WebKitPrepared.builder` (webkit-lines §2, §8.2) | Right |
| Blink line-edge reshapes, walk-back re-breaking, whole-line retries | Yes: `nextLine` gets the measurer and owns the whole loop (blink-lines §6, §9) | Right; recipe notes in §3.1 |
| Gecko whole-line redo and one break priority per line | Yes: the redo lives inside `nextLine`, and the state is a content offset (gecko-lines §4.1, §4.7, §6) | Right |
| Per-engine white-space transforms | Yes: each engine builds its own content | Right |
| Shaping units that don't cross text node edges (WebKit) or do (Blink with equal fonts, Gecko in one text run) | Yes: contexts are identified by their settings, and the engine picks what to measure | Right; recipe notes in §3.1 |
| Widths that exist only at line-edge time | Yes: tabs, the hyphen, `breakWord` probes and reshapes are all measured in `nextLine` | Right |
| Bidi splitting before measurement | **No**: the shared resolver has one algorithm | **Blocking, B1**; resolved |
| Device pixel ratio in Blink | Yes, with documentation fixes | Non-blocking, §3.1 and §3.4 |
| Gecko font-size quantization | Yes, but there's no rule for sizes the gate rejects | Non-blocking, §3.2 |
| Painter fidelity | **No**: the output types lack what painter.md needs, and `paint.ts` has no engine branch | **Blocking, B2**; resolved |

## 2. Blocking issues

### B1. The shared bidi resolver runs unicode-bidi's algorithm, but Blink and WebKit run ICU `ubidi`

**What the design does.**
- DESIGN §3 says that for bidi the engines "differ only in data", and `bidiDataFor(engine)` picks that data.
- `src/unicode/bidi.ts` ports unicode-bidi 0.3.15 and serves all three engines.
- `resolveBidiLevels(text, direction, data)` has no algorithm choice and never splits a paragraph.

**What the specs say.** Blink and WebKit call `ubidi_setPara` with default options (bidi.md §5.1). On identical text,
ICU's algorithm differs from the crate's (bidi.md §2 item 4, §5.3):
1. **Unidirectional shortcut.** For text that isn't mixed, ICU returns the paragraph level for every character, and
   Blink then turns bidi off (blink-text §2.D; `inline_node.cc:1355-1359`).
2. **Removed characters.** SHY, ZWSP, WJ and the other BN characters, plus LRE…PDF, take the **next** character's level
   in ICU and the **previous** one's in the crate.
3. **Paragraphs.** ICU ends a paragraph at every class-B character and resets the embedding stack (P1). Both engines
   feed such characters to ICU (bidi.md §3.1, §3.2, §3.4):
   - Blink keeps U+2029, U+001C-U+001E and NEL literally in every mode, and CR in preserve modes;
   - WebKit keeps CR, U+001C-U+001E and NEL literally in collapse modes.
4. **Bracket pairs.** ICU and the crate differ in which brackets can pair under overrides, the 63-opening limit, the
   context walk before an opening bracket, and marks after a closing bracket.

**Failing examples** (bidi.md §7.5 and §13):
- **D5, Blink.** LTR block, text `abc٣٤` (U+0663 U+0664).
  - text_content is 16-bit and `MaybeBidiRtl` is true, so Blink resolves.
  - ICU calls the text LTR and not mixed, so Blink turns bidi off and the text stays one item.
  - The shared resolver gives `0 0 0 2 2`, so a port splits the item at 3. The line position then sums two ceil64
    inline sizes instead of one, and the bidi-only paths turn on (`SplitTrailingBidiPreservedSpace`, reordering).
- **D3, Blink and WebKit.** LTR block, `שלום­abc`, with the SHY at index 4.
  - ICU gives the SHY level 0, so the level runs end at 4. The crate gives it level 1, so they end at 5.
  - **Blink:** under ICU, a soft-hyphen break at 5 falls inside the Latin item. Under the crate it's an item end, which
    takes the `CanBreakAfter(item)` path (blink-lines §5.2, §7).
  - **WebKit:** under ICU the word piece `[0,5)` is split at 4, and the split decides which item carries
    `hasTrailingSoftHyphen` (webkit-text §6 step 5). LineBuilder reads that flag in its fit test (webkit-lines §6.2).
- **Probe 11, WebKit.** `<span dir=rtl>אב\rגד</span>` in collapse mode. WebKit hands CR to ICU, which ends the paragraph
  there, so `גד` resolves in a paragraph of its own. The shared resolver treats the whole string as one paragraph.

**The current test doesn't cover this.**
- `bidi.test.ts` runs the crate port against ICU's copy of the Unicode conformance file. That file holds the expected
  UAX #9 levels (version 6.3.0), not ICU's outputs.
- ICU 78.3 fails 30 lines of BidiCharacterTest-17.0.0, and its shortcut makes it differ from UAX #9 on 105,785
  BidiTest runs (bidi.md §7.2).
- A seeded fuzz found 130,661 of 300,000 short strings where ICU and the crate port disagree (bidi.md §7.4). So this
  isn't limited to the rare inputs DESIGN §3 mentions.

**Why engine owners can't fix it.** `unicode/bidi.ts` is architect-owned (DESIGN §8.1), and its only switch picks data.

**Fix.**
- Follow bidi.md §10.1: one resolver with a `profile: 'icu78' | 'unicodeBidi'` union, chosen per engine next to
  `bidiDataFor`, with the eight switches listed there. For `icu78` that includes splitting paragraphs at B, with CR LF
  counted once.
- Verify `icu78` against fixtures generated by ICU 78.x `ubidi`, keeping every level including `x` positions. Run them
  over both conformance files and the §7.4 fuzz set.
- Verify plain UAX #9 mode against the 17.0.0 files (bidi.md §10.3).
- Then correct DESIGN §3.

**Resolution** (2026-09-16). Resolved with a port of ICU's own resolver instead of profile switches.

- **What changed.**
  - `src/unicode/ubidi.ts` ports `ubidi_setPara` from ICU 78.2's `ubidi.cpp`, in the default mode both engines use:
    paragraph splits in `getDirProps`, bracket pairing during explicit levels, `directionFromFlags`, the implicit state
    tables that resume after isolates, and `adjustWSLevels`. It returns `{ direction, paragraphs, levels }`, which is what
    Blink and WebKit read through `ubidi_getDirection`, `ubidi_getParaLevel` and `ubidi_getLogicalRun`.
  - `src/unicode/unicode-bidi.ts` holds the crate port for Gecko, unchanged.
  - Each engine imports the resolver its browser runs, as it imports `breaks/rbbi.ts` or `breaks/icu4x.ts`. `bidi.ts`
    keeps the data and `bidiDataFor(engine)`.
  - DESIGN §3 is corrected, and the engine TODOs name their resolver. The WebKit TODO also lists the literal CR and
    U+001C-U+001E in collapse modes and the FSI wrapper for a root `plaintext` paragraph (§3.3 below).
- **Why not the profile switches of bidi.md §10.1.** ICU isn't structured like UAX #9:
  - brackets pair while explicit levels are computed;
  - level runs split where only the override bit changes;
  - the weak and neutral rules run as state tables that resume after an isolate.

  The four untraced isolate-after-embedding lines of bidi.md §7.3 come from the second point. Under an override, an
  isolate initiator or PDI gets its level without the override flag (`ubidi.cpp:1222, 1282`), so it starts a level run
  of its own and resolves as a neutral. Matching that with switches would put nine or more profile conditionals inside
  the crate's algorithm, and every ICU roll would need them worked out again. The port is exact by construction and can
  be diffed against the next `ubidi.cpp`. The cost is size: `ubidi.ts` is 844 lines with its state tables, next to the
  crate port's 509.
- **Verification.** `src/unicode/ubidi.test.ts` builds `tools/icu-bidi-oracle.c` against Homebrew icu4c 78.3, whose bidi
  sources and data are byte-identical to Chrome 153's 78.2, and against the system libicucore, Safari 27's ICU 78.1. It
  compares the direction, the paragraphs, every level including the x positions, and the logical runs, over:
  - 770,241 BidiTest-17.0.0 runs;
  - 183,379 BidiCharacterTest lines (ICU's 6.3.0 file and the crate's 15.0.0 file);
  - 405,000 fuzz strings with class-B and class-S characters, CR LF, supplementary characters, unpaired surrogates and
    Apple's private-use classes, at levels 0, 1 and auto;
  - 3,378 cases nested past the explicit-level and 63-opening limits;
  - 51 directed cases: D1-D13, the four §7.3 lines and probe 11's text, at three levels.

  There are 0 differences with either ICU. D3, D5, D8 and probe 11 are also asserted literally. `bun test rebuild/src`
  takes about 7 s.
- **The crate side.** `unicode-bidi.test.ts` runs the crate port over BidiTest-17.0.0 (770,241 runs) and the crate's
  BidiCharacterTest-15.0.0, and asserts the crate-side levels of D1, D3, D4, D5, D7, D8 and D9. A one-off differential
  against the crate itself at `ca612daf` (its source equals Firefox 156's), built as a small Cargo example in the
  scratchpad, gave 0 differences on 405,240 strings, x positions included.
- **Found on the way.** macOS 27's libicucore gives the private-use characters U+F7F0..U+F8FF Apple's own Bidi_Class
  values (ON, NSM, AL, R, ET, EN), where upstream ICU gives L. `gen-unicode-data.ts` said libicucore differed "not in
  Bidi_Class". WebKit now has its own class table, and `bidi.test.ts` checks Blink's and WebKit's tables for every code
  point against the two ICUs.
- **Not covered.** No browser verdicts yet: bidi.md §13's probes still have to settle the paragraph builders, which no
  oracle tests. The bidi tests need clang, Homebrew `icu4c@78` and macOS's libicucore.

### B2. The painted form loses widths and glyph order that painter.md shows a painter can keep

**What the design does.** DESIGN §7 and `src/paint.ts`:
- one `white-space: pre` block per line, with no width;
- collapsed and hanging fragments aren't painted;
- the hyphen goes through `runNode`, which returns a bare text node when the run is a bare text node and the letter
  spacing is unchanged, and otherwise a span with the run's styles;
- nothing handles bidi.

On the model side, `Fragment` has no painted text for a trailing collapsible space, `Line` has no levels, and nothing
marks a mid-word line edge.

**What the spec says.**
- painter.md §1 and §6 recommend form A-wrap: the paragraph's `white-space` and content width, `text-align` carried
  over, and trailing collapsible spaces kept in their slice so the engine trims them (R1, R3).
- It adds a per-engine hyphen span (R6), a ZWJ at mid-word edges in joining scripts (R7) and nested `bidi-override`
  spans built from per-engine levels (R8, §4.4).
- §7 lists what no painted form can keep. The `pre` form loses more than that list.

**Failing examples.**
1. **Chrome: kerning against a trailing space** (painter.md §3.1 c; blink-gaps §3.6 L1, H11).
   - Setup: `<div style="font:16px Arial;width:60px">AAAA VVVV</div>`.
   - Native line 1 keeps Arial's A+space GPOS adjustment on the last `A`, because under `text-align: start` a line that
     ends at a space isn't reshaped (blink-lines §5.2, §8.3). Width: 2676 raw LayoutUnits at zoom 1.
   - The painted `pre` line holds `AAAA` without the space and measures 2732 raw.
   - The lab's `painter` metric fails by 56 raw (0.875px) while `widths` passes.
2. **Chrome: CJK punctuation at a line end** (painter.md §3.1 e, probe 4).
   - Setup: `<div lang=ja style="font:16px 'Hiragino Mincho ProN'; width:92px">あいうえお。かきくけこ</div>`.
   - Native line 1 is 88px, because `ShapeLine` trims `。` with `halt`.
   - A `pre` line never runs `ShapeLine`, so the painted line is 96px.
3. **The hyphen** (blink-lines §11; painter.md §3.1 h, §3.3 g, R6).
   - Setup: `super&shy;cali` in one bare text node, with paragraph `letter-spacing: 0`.
   - `runNode` returns a bare text node for `‐`.
   - Chrome: the hyphen joins `super`'s shaping group and kerns with `r`, but native Blink shapes it alone.
   - Firefox: a same-style hyphen continues the text run (gecko-text §5.2), so it's shaped as part of the word.
   - R6 breaks shaping with `letter-spacing:0; vertical-align:0px` in Blink and `unicode-bidi: isolate` in Gecko.
     `paint.ts` has no engine branch to apply either one.
4. **Bidi order** (painter.md §4.3, probe 7).
   - Setup: `<div style="font:24px Arial">שלום (עולם ab) cd</div>`, with line 1 `שלום (עולם`.
   - From the whole paragraph, line 1's levels are `1 1 1 1 0 0 1 1 1 1`.
   - Painted alone, the unpaired `(` resolves by N1 and the whole line reverses.
   - The extents don't change, so the lab's `painter` metric passes while the glyphs are in the wrong order.
5. **WebKit: item plus following space** (painter.md §3.2 a, probe 3). DESIGN §7 already names this loss; R3 fixes it.

**Why engine owners can't fix it.** Every fix touches shared code (painter.md §6, "What the model must supply per
line"):
- `Fragment` needs painted text for trailing collapsible white space;
- `Line` needs per-code-unit levels, the base level and mid-word edge flags;
- `paint.ts` needs one engine switch for R6 and R7.

**Fix.** Adopt painter.md §6.
- DESIGN §7's reason for `pre` ("nothing sets a width, so the painted extent is an independent check") still holds
  under A-wrap: the lab reads the extent from text rects, not from the block's width (`lab/score.ts`, `painter`).
- A line wider than predicted still shows up, as "painted line wraps".

**Resolution** (2026-09-16). Adopted painter.md §6, form A-wrap.

- **Model** (`src/model.ts`, DESIGN §2):
  - Every painted fragment (`text`, `hanging`, `hyphen` and the new `trimmed`) carries `level`: the level the engine
    reorders it with, after its own line-end rule for trailing white space. That is one level per fragment rather than
    per code unit. Every engine splits items or frames at level changes before filling lines, so its fragments split
    the same way.
  - `trimmed` is collapsible white space removed at the line end after the break was chosen. It has painted text and no
    width, and it is painted. `collapsed` now covers only white space the engine never lays out.
  - `LineOf.joinsNextLine` says the paragraph's shaping joined letters across the break. It replaces the proposed
    mid-word edge flags, because R7 is about joining, not about a missing space: a flag at every mid-word edge would
    also put ZWJs at CJK and `break-all` breaks, where nothing joins. WebKit never shapes across a line edge, so it
    reports false, and the painter needs no engine branch for R7.
  - There is no separate base level. It equals `paragraph.direction` until `unicode-bidi: plaintext` becomes a model
    field, which will add one per line.
- **Painter** (`src/paint.ts`, DESIGN §7):
  - one block per line at the paragraph's width, with its `white-space`, `word-break`, `overflow-wrap`, `line-break` and
    `tab-size`;
  - one node per run slice, with trimmed and hanging spaces painted;
  - the hyphen as a span styled in one engine switch: `vertical-align: 0px` in Blink, `unicode-bidi: isolate` in Gecko,
    nothing in WebKit;
  - U+200D at joined edges;
  - nested `bidi-override` spans built from the fragment levels, on lines with any level other than the base level.
- **The failing examples.**
  1. Chrome `AAAA VVVV`: line 1 is painted as `AAAA ` with a `trimmed` space, so Blink removes it without reshaping, as
     in the paragraph.
  2. Chrome `あいうえお。`: A-wrap at 92px runs `ShapeLine` again, which trims the `。`.
  3. The hyphen: its own span per engine, so Blink and Gecko shape it alone.
  4. `שלום (עולם`: painted with levels `1 1 1 1 0 0 1 1 1 1` under overrides.
  5. WebKit's item plus following space: the space stays in its slice, as `trimmed` or `hanging`.
- **Still open.**
  - These outcomes are inferences until painter.md probes 1-11 run in the installed browsers.
  - The lab's painter extent takes every positive rect of each painted text node. Under A-wrap hanging white space is
    painted, so the lab owner has to leave it out, as the `widths` derivation already does (DESIGN §7).
  - What no painted form keeps (painter.md §7 L1-L9) is listed in DESIGN §7.

## 3. Non-blocking issues

### 3.1 Blink

- **Shaping across spaces.**
  - DOM Blink shapes each shaping group in one HarfBuzz call and never asks `CanShapeWordByWord` (blink-gaps §5.1).
  - The `optimizeLegibility` contexts in DESIGN §4.2 make Canvas shape a whole string only for fonts whose space glyph
    is in GPOS or GSUB coverage: Arial, SF, Times New Roman and Courier New.
  - Helvetica and Times still split, although the DOM kerns across their spaces through the legacy `kern` table
    (blink-gaps §5.3, H6).
  - Replacing U+0020 with U+2028 gives the one-call total for any font (blink-gaps §3.3 and §5.4 test C [I, H5-H8]).
  - Update DESIGN §4.2, §4.4 and the `space-in-shaping` row. The change stays inside engines/blink.
- **Run widths.** The recipe `run width = f32(Σ raw16 over the run's words)` treats a DOM run as a set of Canvas words.
  That only holds when nothing is shaped across a space. State the recipe over shaping-group totals.
- **Safe-to-break offsets.**
  - Equal `raw16(prefix) + raw16(suffix)` doesn't prove an offset safe (blink-gaps §3.3).
  - Where Blink doesn't reshape at an unsafe offset, the width depends on which glyph carries the adjustment: all of it
    on the first glyph for GPOS, `d >> 1` for legacy `kern` (§3.6 L1, H10).
  - Name that per-font fact as an input or a gap. Default-aligned Arial and Helvetica lines that end before a space
    depend on it.
- **The 16-bit partition.**
  - A JS string whose code units are all ≤ U+00FF usually reaches Blink as an 8-bit string (blink-gaps §6.3 [I]). A
    separate '16bit' canvas alone would still shape such a word as Latin.
  - The engine has to make the measured string 16-bit, for example with a normalized prefix character (blink-canvas H8,
    `W("\t)")`), and subtract the prefix's width in 16.16 integers.
  - DESIGN §4.2 should say so.
- **Spacing at layout zoom.** CSS lengths are multiplied by zoom (blink-lines §2.2), and the DOM applies spacing from
  that zoomed font description (blink-lines §3.2).
  - At zoom z, `ctx.letterSpacing` is `f32(ls × z)` px, and word spacing added in JS is `trunc(f32(ws × z) × 65536)`.
  - DESIGN §4.2 says "the run's px".
- **Han kerning at line ends** (blink-lines §6 step 4, `LineBreakerHanKerningEnd`, stable; blink-gaps §6.1, H18) has no
  gap name and no recipe.
- **FF, VT and C0 controls in collapse modes.** DESIGN §5 still lists them as unhandled, but blink-gaps §2.8 gives a
  recipe: measure with U+0001 in their place, and add letter spacing to VT but not to FF.
- **The hyphen glyph.**
  - blink-gaps §5.5 gives an exact Canvas test with two fallback families.
  - gecko-gaps §3.6 shows Firefox needs no test, because `measureText("‐")` already equals the DOM hyphen.
  - That leaves the `hyphen-glyph` gap for WebKit only.
- **`lang=""`.**
  - Blink maps `lang` to `-webkit-locale` only when the value isn't empty, so `lang=""` inherits the parent's locale
    (blink-text §2.F.3).
  - DESIGN §1.1 says `''` doesn't inherit `<html lang>` in any engine. That is WebKit's rule (webkit-text H7), not
    Blink's. Gecko's rule wasn't read.
- **Emulated device pixel ratio** (blink-lines §2.1, probe 3). `devicePixelRatio` can be 2 while layout zoom is 1, and
  detection can't tell the two apart. Name the condition in a gap.

### 3.2 Gecko

- **Sizes the gate rejects.** DESIGN §4.3 says an engine measures only when the Canvas and DOM sizes agree. A
  prediction is still returned for other sizes, so say what is measured then: the quantized size, with
  `font-size-quantization` reported.
- **The no-lang language.**
  - gecko-gaps §5.4 needs a "no-lang language" input, separate from an explicit `lang`.
  - `Paragraph.lang: string` can't say "no lang attribute", so the model can't express the OS-locale newline rule
    (gecko-gaps §10 probe 11).
  - `navigator.language` is Firefox's accept-language list, not the regional-prefs locale.
- **Clusters.** `graphemeRulesFor('gecko')` is plain ICU4X. `SetupClusterBoundaries` also marks a leading extender as a
  continuation and joins a Bengali YA after a VIRAMA (gecko-text §7.3). The Gecko TODO should list both.
- **Emoji at DPR ≠ 1.** The recipe needs to know which clusters Apple Color Emoji draws, and Canvas doesn't show which
  fallback font was used. Give a detection rule or a gap condition.
- **Document state.**
  - A block scan keeps the sticky Chinese/Japanese flag across words, and a partial rescan drops it (gecko-gaps §8.1).
  - `mAlwaysCreateFramesForIgnorableWhitespace` flips after some script queries (gecko-text §3, §20).
  - `lab/page.ts` observes chunks of cases in one document, and navigates only when a case needs another page language
    or font set.
  - The model predicts fresh layouts, so the lab owner should check whether Range reads on earlier cases change later
    ones.

### 3.3 WebKit

- **Cached break positions.** A text box rebuilt from `TextBreakingPositionCache` takes `isWordSeparator` from its first
  character only, which matters with word spacing (webkit-text §5.2). In a reused lab document, repeated text can take
  that path.
- **Paragraph text for bidi.** Once B1 lands, WebKit's paragraph builder keeps CR and U+001C-U+001E literally in
  collapse modes, and wraps a root `plaintext` paragraph in FSI … PDI (bidi.md §3.2). Both belong in engines/webkit and
  should be in its TODO.

### 3.4 Environment and lab

- **Predicting one engine from another runtime.**
  - DESIGN §1.2 allows building an Environment for another runtime.
  - Canvas totals come from the running engine: Core Text advances in Safari, Gecko's per-glyph au rounding and size
    quantization, Blink's Skia or HarfBuzz advances. So widths are wrong too, not only dictionary breaks.
  - Require `env.engine` to match the runtime whenever it measures, or name a gap.
- **The lab's grid in Chrome at DPR 2.**
  - At zoom 2, Blink's widths are whole 1/128 CSS px (blink-gaps §6.4, H21).
  - `score.ts` snaps both sides to 1/64 px, rounding half up. Predicted 19240 raw (150.3125px) and observed 19239 raw
    (150.3046875px) both become 9620 and pass.
  - DESIGN §2.1 says a conversion mistake shows up as an offset, but at zoom 2 a 1-raw mistake at the fit bound
    (CRITIC W8) can hide.
  - This is lab-owned: use `64 × layout zoom` as Chrome's grid.
- **UI and system languages.**
  - One `uiLanguage` from `navigator.language` stands in for Chrome's application locale, Safari's ICU default locale
    and `AppleTextBreakLocale`, and Firefox's regional-prefs locale and document encoding.
  - An explicit Environment can't carry the right fact per engine. Consider named per-engine fields.

### 3.5 Model and engine interface

- **Flat runs.** `runs[]` has no nesting and no per-run `white-space`, `word-break`, `line-break` or `overflow-wrap`.
  - Several span-edge rules read the wrap style of the nearest common ancestor: WebKit's `isAtSoftWrapOpportunity`
    (webkit-text §7.3) and Gecko's `mAncestorControllingInitialBreak` (gecko-text §8.1).
  - Others read per-span wrap styles: Blink's generated ZWSP at a nowrap-to-wrap edge (blink-text §2.C.4) and its
    close-tag rules (blink-lines §7).
  - Flat fields can come through the planned-fields path. Nested inline boxes would reshape `Fragment.run`, every
    engine's item-to-run mapping and the painter.
  - No current lab case needs nesting, but decide the tree shape before the ports hard-code run indexes.
- **Gaps that depend on the chosen breaks.**
  - Examples: unsafe offsets at the chosen line edge, in-word prefixes at a chosen emergency break, and float32
    precision of a reshaped piece.
  - They can reach `gaps(prepared)` only if `nextLine` mutates the prepared paragraph, which leaks between layouts at
    different widths.
  - Consider gaps per line on `LineOf`.
- **`LineStart` validity.** WebKit's carried width and Blink's line-start reshape depend on the width that produced the
  previous line. Document that a `LineStart` is valid only at that width.
- **A test seam for widths.**
  - `createMeasurer()` always creates OffscreenCanvas, and bun has none.
  - Line-filling tests on the specs' worked examples (gecko-lines §6, Courier New at 576 au) need recorded widths.
  - A source union in `measure/canvas.ts`, `{ kind: 'canvas' } | { kind: 'recorded'; widths }`, would let owners test
    `nextLine` in bun without more shared changes later.

### 3.6 Data and tests

- **Forward-only `rbbi.ts`.**
  - Blink's `NextBreakablePosition` asks `following()` of an iterator that runs from the line start to the paragraph
    end, under the current style's locale (blink-text §2.F.1-F.5). WebKit asks with prior context (webkit-text §5.5).
  - Collecting boundaries from the start gives the same answers: `ubrk_following` equaled forward iteration in
    3,635,280 checks (webkit-canvas §2.6).
  - It costs one pass per line start and per locale change. Record that with the other costs.
- **Bidi conformance files.** The test uses version 6.3.0 (ICU's testdata) and 15.0.0 (the crate's). bidi.md §10.3
  lists the 17.0.0 files and how to fetch them.
- **Skipped probe rows.** `rbbi.test.ts` skips 900 `probes.tsv` rows for locales missing from `delimiters.tsv`.
  webkit-canvas §2.6 lists several locales with no quote overrides: sv, fi, da, he, ar, ja, zh-Hant. Check whether the
  skipped locales are those, which should run with no overrides, or locales with no data.

## 4. Parts that are right

- **No shared content model or line loop, and one engine switch.** Every pipeline row in DESIGN §3 differs across the
  specs, and `index.ts` holds the only switch over engines.
- **Per-engine line start state matches the specs:**
  - Blink's break token, with the forced-break flag and the current style (blink-lines §4.1);
  - WebKit's position, carried width and previous-line facts (webkit-lines §8.2);
  - Gecko's content offset alone (gecko-lines §4.8).
- **`nextLine` receives the measurer**, so line-edge measurements happen when the engine makes them: Blink's line-start
  and line-end reshapes, WebKit's `breakWord` probes and tab pen positions, Gecko's tab stops and hyphen run.
- **Gecko's redo lives inside `nextLine`**, which returns only the final pass, and the break priority starts at
  `eNoBreak` for each line (gecko-lines §6).
- **Engine units.** `EngineWidth` keeps LayoutUnits with zoom, float32 px and app units, and converts once at output.
- **OffscreenCanvas for all three engines**, for the reasons the canvas specs give (blink-canvas §1.2, webkit-canvas
  §1.3, gecko-canvas §1.10 and §2).
- **Chrome's per-canvas caches.** Contexts identified by settings, word spacing added in JS and a fresh measurer per
  layout avoid the order effects in blink-canvas §1.7 and H7.
- **Gecko measurement:**
  - the `0.001px` letter-spacing trick, with spacing added in JS (gecko-canvas A6, A7, H30);
  - never passing controls, SHY or bidi controls to Canvas (A3);
  - the font-size gate (C2) and emoji measured at size × DPR (A12).
- **Blink font sizes:** float32 zoomed size with the 1/100 floor on both paths (blink-lines §2.3).
- **Break data:**
  - pinned bytes with sha256 checks;
  - Apple's quote overrides inside `rbbi.ts`, with 1,658 probes passing;
  - Thai, Lao, Khmer and Myanmar breaks from the running browser's own segmenter with a verification list (§6.3),
    instead of UAX #14 defaults.
- **Named gaps** are reported with the prediction instead of hidden in approximations.
- **Painter rules that hold under any form:** paint the transformed text, give each original run slice its own node,
  never merge runs, and never set `text-transform` (painter.md R2, R5).
- **Imports** in `src` use runtime-honest `.js` specifiers.
- **A real groundwork bug was found:** Gecko's bracket table was missing 3 of its 64 pairs.
