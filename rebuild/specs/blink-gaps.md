# Blink gaps: control widths, reshape from Canvas totals, four handlers, font facts (Chrome 153.0.8010.48)

This spec fills CRITIC.md §5 items 2, 6, 7, 8 and the later Blink items 12, 13, 14 (Blink part) and 15. Each section
says what the pinned source does, what Canvas `measureText` can supply, and what it can't. The hypotheses are in §8.

## 0. Sources, tags, notation

- `C153/` = `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/` (local sparse checkout, HEAD
  `199a3a54`). Files outside the sparse set were fetched from gitiles at `refs/tags/153.0.8010.48` and are marked
  "(gitiles 153)". A few were read only in the 152 checkout and are marked "(152, not re-read at 153)".
- `hb/` = HarfBuzz `dfdc088c4d7c5d31dd5b13070b919b51f6c21ea8` (`C153/../../../DEPS:384`), `src/` files from a GitHub
  partial clone into the session scratchpad. `hb-unicode.hh` came from `raw.githubusercontent.com` at the same commit.
- Tags:
  - **[V]**: read at the cited lines.
  - **[I]**: inferred, not executed.
  - **[M]**: measured on this Mac by a small local program, not a browser. Two programs:
    - `fontfacts.c`, which links Homebrew HarfBuzz 14.2.0 with `hb-ot` font functions and reports font units;
    - `ctfacts.swift`, which calls CoreText.

    The HarfBuzz rules used here (pair kerning, legacy `kern`, cmap) are the same code paths as `dfdc088c`, but the
    version differs.
- **Z**: Blink's layout zoom (device scale factor × browser zoom; blink-lines §2.1). On a Retina screen at 100% zoom,
  Z = 2.
- **R(s)**: `Math.round(ctx.measureText(s).width * 65536)`, the Canvas total as an integer 16.16 value. It's exact while
  the width is below 256 px (blink-canvas §1.5).
- **LS**: U+2028 LINE SEPARATOR, used in §3 and §5 as a stand-in for U+0020.
- **P**: the paragraph shape result: one HarfBuzz call over a whole shaping group (blink-lines §3.2).
- **d(x, y)** = R(xy) − R(x) − R(y): the total adjustment HarfBuzz makes between two neighbors x and y.

---

## 1. Short answers

1. **FF, VT and other C0 controls in collapse modes (item 2).**
   - Blink has no special case for them. HarfBuzz treats them as ordinary characters: they aren't default-ignorable
     below U+0080, so a font without a cmap entry gives glyph 0 (§2.3).
   - Blink then runs font fallback for that cluster. On macOS the system fallback asks CoreText
     (`CTFontCreateForString`). On this Mac, for Arial, Helvetica, Helvetica Neue, Courier New and Menlo it returns
     Hiragino Sans W3, and for Times, Times New Roman and Georgia it returns Hiragino Mincho ProN W3. Hiragino's own
     cmap maps U+0001, U+000B, U+000C, U+000E and U+001F to glyph 1, which is 333/1000 em wide [M].
   - **Predicted DOM width of FF or VT at 16 px: about 5.328 px**, not the primary font's .notdef (12 px in Arial) and
     not a space (4.4453 px).
   - Canvas turns U+0009..U+000D into spaces, so it can't measure FF or VT directly. It can measure another C0 control
     the primary font doesn't map, such as U+0001, which goes down the same fallback path (§2.8).
2. **Unsafe-to-break from Canvas totals (item 6).**
   - Default Canvas settings split text into words at U+0020 (blink-canvas §1.3). Replacing U+0020 with U+2028 keeps the
     whole string in one piece, and Blink maps U+2028 to the space glyph. So `measureText(s.replaceAll(' ', ' '))`
     should return the one-call HarfBuzz total, cross-space kerning included [I, H5-H8].
   - With that, a cut at offset k that changes the total proves k is unsafe. A cut that doesn't change it proves
     nothing (§3.3).
   - **Main loss:** where Blink uses paragraph advances at an unsafe offset without reshaping, the result depends on
     which glyph carries the adjustment, and totals can't show that. The common case is a line that ends before a space
     under default alignment. GPOS pair kerning puts all of it on the first glyph (Arial). The legacy `kern` table puts
     `d >> 1` on the first glyph (Helvetica, Times, Times New Roman) [M].
3. **Handlers (item 7).** §4 ports `HandleEmptyText`, `HandleControlItem`, `HandleForcedLineBreak`,
   `HandleBidiControlItem`, `ComputeTrailingCollapsibleSpace(Helper)`, `RemoveTrailingCollapsibleSpace` and
   `SplitTrailingBidiPreservedSpace`.
4. **`CanShapeWordByWord` and U+2010 (item 8).**
   - **`CanShapeWordByWord`.** It is used only by Canvas (`PlainTextNode`); DOM inline layout never reads it. It checks
     only whether the space glyph is in GPOS or GSUB lookup coverage, so legacy `kern`, `kerx` and `morx` never count.
     Helvetica, Times and Times New Roman kern across spaces through `kern` [M]. No Canvas typesetting setting makes
     Canvas shape Helvetica or Times whole. Times New Roman is shaped whole only under `optimizeLegibility`, because its
     space glyph is in GSUB coverage.
   - **Canvas `"A V"` vs `"A"` + `" "` + `"V"`.** Under default Canvas settings these are equal by construction, whatever
     the font, so the comparison tests nothing. The useful tests are §5.4 test C (the U+2028 comparison) and test B (a
     word-spacing cache order).
   - **Whether the primary font "has" U+2010.** Blink answers through HarfBuzz's glyph function plus Apple's CoreText
     fallback for U+2010 and U+2011. That function is also what shapes the hyphen, so a two-fallback-font Canvas test
     answers the question exactly (§5.5). Arial, Georgia, Times, Times New Roman, Courier New and Verdana have no
     U+2010 cmap entry, but CoreText gives them the hyphen-minus glyph, so Blink uses U+2010 for them [M].
5. **Later items.**
   - Item 12: `HanKerning::MayApply` needs 16-bit text containing a possible opening or closing bracket, and a font with
     `halt`.
   - Item 13: `GetHyphenationWithLimits()` is null unless `hyphens: auto` [V].
   - Item 14: **storage matters in DOM layout too**. A text node stored as 16-bit, even if it holds only Latin-1, turns
     off the single-Latin-segment shortcut (`inline_items_builder.cc:725`).
   - Item 15: at Z = 2, `getBoundingClientRect` and `Range.getClientRects` widths are raw LayoutUnits ÷ 128 exactly.

---

## 2. Item 2: DOM width of FF, VT and other C0 controls

### 2.1 Which controls reach the shaper [V]

From blink-text §2.C.9 and `C153/core/layout/inline/inline_items_builder.cc:164-184, 1119-1125`:

| code point | normal, nowrap, pre-line | pre, pre-wrap, break-spaces |
|---|---|---|
| U+0009 TAB, U+000D CR | collapse as spaces | control items (tab stops; CR has zero width) |
| U+000A LF | collapses (pre-line: forced break) | forced break |
| U+000C FF | **literal character inside the text item** | control item, zero width (`line_breaker.cc:2988-2994`) |
| U+000B VT, U+0001..U+0008, U+000E..U+001F | **literal** | **literal** |

So the widths this section is about are FF in collapse modes, and VT plus the other C0 controls in every mode.

### 2.2 Glyph lookup in Blink [V]

- HarfBuzz asks Blink's `HarfBuzzGetGlyph` for a glyph (`C153/platform/fonts/shaping/harfbuzz_face.cc:88-231`;
  `HarfBuzzGetNominalGlyph` at :233-239).
- The only code-point substitutions are U+2028 and U+2029 → U+0020 (:110-113), plus the Apple CoreText fallback for
  U+2010 and U+2011 (:217-229).
- Everything else goes to `hb_font_get_glyph` on the parent font, which is the font's own cmap (:182-183).
- A grep of `C153/platform/fonts` and `C153/core/layout/inline` for `kFormFeed` and `kLineTabulation` finds only:
  - the control-item code (`line_breaker.cc:2989`; `inline_items_builder.cc:172`; `inline_item.cc:336`);
  - the line-truncator newline test (`line_truncator.cc:38-39`);
  - `Character::TreatAsZeroWidthSpace` (`C153/platform/text/character.h:163-182`).

  None of these changes the glyph.

### 2.3 What HarfBuzz does with a C0 control [V]

- **Not default-ignorable.** Unicode props mark default-ignorables only for `u >= 0x80`
  (`hb/src/hb-ot-layout.hh:212-256`, test at :219-221). Page 0x00 lists only U+00AD (`hb/src/hb-unicode.hh:167-186`).
  So `hb_ot_hide_default_ignorables` and `hb_ot_zero_width_default_ignorables` never touch a C0 control
  (`hb/src/hb-ot-shape.cc:778-847`).
- **Normalization.**
  - `decompose_current_character` tries the cmap, then decomposition, then the space fallback. The space fallback is
    only for characters of general category Zs, and C0 controls are Cc (`hb/src/hb-ot-shape-normalize.cc:149-201`).
  - A control with no cmap entry keeps `glyph = 0`, i.e. `.notdef` (:154, :200).
  - Blink sets no buffer flags and no not-found glyph: a grep for `hb_buffer_set_flags` and `HB_BUFFER_FLAG` in
    `C153/platform/fonts/shaping` finds nothing.

### 2.4 The fallback chain for a .notdef cluster [V]

For one segment (`C153/platform/fonts/shaping/harfbuzz_shaper.cc:880-1059`):

```
queue = [NextFont, Range(segment)]
iterator = font.CreateFontFallbackIterator(priority)          // text priority for 8-bit text (:1072-1077)
loop over queue items:
  NextFont item:
     font = iterator.Next(hint chars of the queued ranges)    // :937-953
  Range item:
     if !iterator.HasNext(): stage = Last                     // :956-958
     shape the range with `font` in one hb_shape call         // :1005-1038
     ExtractShapeResults:                                     // :559-702
        clusters with glyph 0 → queue again, unless the stage is Last
        clusters with real glyphs → commit as runs of this font
        at stage Last → commit everything, .notdef included   // :554-556, :693-700
```

`FontFallbackIterator::Next` (`C153/platform/fonts/font_fallback_iterator.cc:120-230`):

1. **The `font-family` list.** Each family in order (:166-196). Typefaces already returned are skipped (:76-102).
2. **System fallback, once per hint character** (:136-157, :264-284):
   - `FontCache::FallbackFontForCharacter` refuses only private-use characters and noncharacters
     (`C153/platform/fonts/font_cache.cc:229-257`);
   - on macOS it calls `GetAlternateFontPlatformData` → `GetSubstituteFont` → `CTFontCreateForString(primary, char)`;
   - it returns nothing if CoreText gives the LastResort font (`C153/platform/fonts/mac/font_cache_mac.mm:127-184,
     199-279, 313-373`).
3. **The last-resort font.** Times, else Lucida Grande (`font_cache_mac.mm:375-392`).
4. **The first candidate**, i.e. the primary font, again, so its .notdef is drawn (`font_fallback_iterator.cc:159-164`).
   The iterator then has no next font, so the stage becomes Last and the .notdef glyph is committed.

### 2.5 What that gives on this Mac [M]

cmap entries for C0 controls (HarfBuzz raw cmap, the table Blink's glyph lookup uses; `fontfacts.c`):

| primary font | C0 cmap entries | glyph 0 advance at 16 px (CoreText) |
|---|---|---|
| Arial, Times New Roman, Courier New, Georgia, Verdana, Menlo, SF (`SFNS.ttf`) | none | Arial 12.0, TNR 12.4453125, Courier New 9.6015625, Georgia 16.0, Menlo 9.6328125 |
| Helvetica, Times (`Times.ttc`) | U+0000, U+0008, U+001D → glyph 1 (advance 0); U+0009, U+000A, U+000D → glyph 2 (space width) | Helvetica 10.140625, Times 11.5546875 |
| Helvetica Neue | U+0000, U+0008, U+001D → zero-advance glyphs; U+0009, U+000A, U+000D → space-width glyphs | 8.0 |

CoreText substitutes (`ctfacts.swift`, `CTFontCreateForString` at 16 px):

- **Sans-serif primaries.** For U+0001, U+000B, U+000C, U+000E and U+001F, Arial, Helvetica, Helvetica Neue, Courier New
  and Menlo → `HiraginoSans-W3`, glyph 1, advance 5.328 px.
- **Serif primaries.** Times, Times New Roman and Georgia → `HiraMinProN-W3`, glyph 1, advance 5.328 px.
- **Hiragino's raw cmap.** `hb-shape` on `ヒラギノ角ゴシック W3.ttc` (faces 0-2) and `ヒラギノ明朝 ProN.ttc` (faces
  0-2) maps each of those controls to glyph 1. It's Hiragino's CID 1, a proportional space 333/1000 em wide.

**Predicted DOM widths at Z = 1, 16 px, collapse mode:**

| text | primary | contribution of the control |
|---|---|---|
| `a\fb`, `a\vb`, `ab` | Arial | ≈ 5.328 px: Hiragino glyph 1. Raw 349175 via the Skia/CoreText advance path, or 349176 if Hiragino has `trak` without `sbix` and Blink uses `hb_ot` advances (blink-canvas §1.4) [I] |
| `ab` | Helvetica | 0: Helvetica glyph 1 |
| `ab` | Helvetica | ≈ 5.328 px (Hiragino) |

If CoreText returned LastResort on another machine, the chain would end with the primary font's .notdef advance
(for example 12.0 px in Arial), because the last-resort Times has no cmap entry for U+0001, U+000B or U+000C [M].

Two more facts:

- **No kerning across the control.** The control sits in its own fallback run, and the first shaping call has .notdef
  in its place (`harfbuzz_shaper.cc:559-702`). So `a` and `b` never kern across it.
- **Process language [I].** CoreText's cascade for control characters may depend on the process's preferred languages.
  Chrome's renderer may not use this Mac's `AppleLanguages` (zh-Hans-US, en-US), so the Hiragino choice needs a
  browser probe (H1).

### 2.6 Letter spacing on controls [V]

- `ShapeResultSpacing::ComputeSpacing` skips letter spacing for `TreatAsZeroWidthSpace` characters
  (`C153/platform/fonts/shaping/shape_result_spacing.cc:126-130`).
- That set is FF, CR, U+FFFC, default-ignorables, ZWNJ and ZWJ (`character.h:163-189`).
- So in `letter-spacing: 3px`, **FF gets no spacing and VT gets 3 px** (H3).

### 2.7 Break opportunities

None next to a code point below U+0021 (blink-text §2.F.5), so a control glues its neighbors into one word.

### 2.8 What Canvas can supply

- **FF and VT: no direct measurement.** Canvas normalization turns U+0009..U+000D into U+0020
  (`C153/platform/fonts/plain_text_node.cc:49-50`; `character.h:226-238`).
- **Other C0 controls: measured literally.** U+0001..U+0008 and U+000E..U+001F aren't in the normalized set or the
  zero-width set (`character.h:167-175`). They don't end Canvas words (`plain_text_node.cc:84-113`), and they go
  through the same `HarfBuzzShaper` fallback chain.
- **Recipe for FF or VT in collapse modes.** Measure the same string with each FF and VT replaced by U+0001, with
  `letterSpacing = '0px'`. Add letter spacing arithmetically to VT, but not to FF (§2.6).
- **Losses.**
  - A primary font that maps U+000B or U+000C but not U+0001 (or the reverse). Canvas can't see this for FF or VT. None
    of the 10 fonts in §2.5 does [M].
  - CoreText returning different substitutes for U+0001 and U+000C. On this Mac it returns the same font [M].
- **U+0000.** Not read. Blink's parser and `Text` handling of NUL are outside this reading.

---

## 3. Item 6: unsafe-to-break and reshaping, from Canvas totals

### 3.1 Where Blink consumes the safe flag [V]

- **Per glyph.** Safe before glyph i when:
  - it's the first glyph of a run, or
  - it starts a new cluster whose flags lack `HB_GLYPH_FLAG_UNSAFE_TO_BREAK`.

  Sources: `C153/platform/fonts/shaping/shape_result.cc:1360-1392, 1559-1563`. `HanKerning` adds unsafe offsets
  (`harfbuzz_shaper.cc:1044-1048`).
- **Queries.**
  - `NextSafeToBreakOffset` and `PreviousSafeToBreakOffset` scan glyph data (`shape_result.cc:121-160`).
  - `IsStartSafeToBreak` requires the first glyph to be safe and to belong to the first character (:484-500).
- **ShapeLine** (`C153/platform/fonts/shaping/shaping_line_breaker.cc`):
  - fast whole-item path (:283-297);
  - line-start reshape `[start, firstSafe)` at a wrapped line start (:309-324);
  - Han-kerning line-end reshape (:344-363);
  - whole-piece reshape when no safe offset lies between start and break (:500-507);
  - line-end reshape loop (:511-584);
  - pieces joined as `[lineStart] + P[firstSafe..lastSafe] + [lineEnd]` (:610-636).
- **`TruncateLineEndResult`** reshapes `[lastSafe, end)` only when `NeedsAccurateEndPosition`
  (`C153/core/layout/inline/line_breaker.cc:2371-2405`).
- **Reshape context.** A reshape is one `hb_shape` over a substring of text_content. HarfBuzz records up to 5 code
  points on each side as context (`case_mapping_harfbuzz_buffer_filler.cc:32-43`; `hb/src/hb-buffer.hh:109-111`;
  `hb/src/hb-buffer.cc:1837-1862`).

### 3.2 When HarfBuzz sets UNSAFE_TO_BREAK [V]

- **The contract.** Without the flag, "the two sides will represent the exact same result one would get if breaking
  input text at the beginning of this cluster and shaping the two sides separately" (`hb/src/hb-buffer.h:76-89`).
- **How it's marked.** `unsafe_to_break(start, end)` marks every cluster in the range except the lowest one
  (`interior = true`). Ranges over 255 glyphs are ignored (`hb/src/hb-buffer.hh:493-516`).
- **Concat flags are off.** Blink doesn't request `PRODUCE_UNSAFE_TO_CONCAT`, so `unsafe_to_concat` does nothing
  (:531-537).

| source | marks unsafe when | width changes? |
|---|---|---|
| GPOS PairPos format 1 | the applied value is non-zero (`hb/src/OT/Layout/GPOS/PairSet.hh:144-145`), **and always when the record has a second value format** (:147-153) | not always |
| GPOS PairPos format 2 | the same (`PairPosFormat2.hh:275-288`) | not always |
| contextual and chaining GSUB/GPOS | the input, backtrack and lookahead match, even if the nested lookups change nothing (`hb-ot-layout-gsubgpos.hh:2469-2480, 3896-3918`) | not always |
| ligatures | clusters merge (`hb-ot-layout-gsubgpos.hh:1611`), so Blink's cluster rule makes inner offsets unsafe (`shape_result.cc:1370-1373`) | usually |
| legacy `kern` table | kern ≠ 0 (`hb/src/hb-kern.hh:84-128`) | yes |
| AAT state machines (`morx`, `kerx`) | a transition isn't provably neutral (`hb/src/hb-aat-layout-common.hh:1341-1370`) | not always |
| fraction slash | numerator/denominator runs (`hb-ot-shape.cc:709-733`) | yes |
| Arabic joining | `safe_to_insert_tatweel` → `unsafe_to_break`, because Blink doesn't request tatweel flags (`hb-buffer.hh:517-527`; `hb-ot-shaper-arabic.cc:329-333`) | yes |
| Blink `HanKerning` | fullwidth punctuation that gets `halt` (`harfbuzz_shaper.cc:1044-1048`) | yes |

Which glyph gets the adjustment differs by mechanism:

- **GPOS PairPos.** A first-glyph X advance goes to the first glyph (`ValueFormat.hh:107-110` via `PairSet.hh:126`); a
  second-value-format adjustment goes to the second.
- **Legacy `kern`.** It splits the scaled kern: `kern1 = kern >> 1` on the first glyph, and `kern2 = kern − kern1` on
  the second glyph's advance plus the same amount as its X offset (`hb-kern.hh:102-106`).

Measured at font units [M, `hb-shape`]:

| font | mechanism | `A` then space | space then `V` |
|---|---|---|---|
| Arial | GPOS, first-glyph values | A 1366 → 1253 (d = −113, all on A) | 0 |
| Helvetica | legacy `kern` (GPOS absent) | A −56, space −56 with x offset −56 (d = −112) | 0 |
| Times New Roman | legacy `kern` table applied (split pattern; GPOS present) [I: GPOS without a `kern` feature, `hb-ot-shape.cc:173-183`] | A −57, space −56 with offset −56 (d = −113) | space −19, V −18 with offset −18 (d = −37) |
| Times | legacy `kern` | A −56, space −56 (d = −112) | space −18, V −18 (d = −36) |
| Georgia | none | 0 | 0 |

At 16 px with upem 2048, one font unit is exactly 512 raw 16.16 units, so d = −113 is −57856 raw16 (−0.8828125 px).

### 3.3 What Canvas totals reveal

- **Stand-in for the space.** Default Canvas splits at U+0020, TAB and ZWSP (`plain_text_node.cc:84-113, 381`), so
  `measureText("A V")` never includes cross-space shaping. With U+2028 in place of each U+0020:
  - normalization leaves U+2028 unchanged (`plain_text_node.cc:49-60`; `character.h:159-175`);
  - it doesn't end a word (`plain_text_node.cc:89-90, 118-126`);
  - it isn't a bidi trigger (`character.h:307-316`);
  - HarfBuzz gets the space glyph for it (`harfbuzz_face.cc:110-113`).

  So `R(s with LS)` is one HarfBuzz total over `s` [I; H5-H8].
- **Caveats of the stand-in.**
  - The string becomes 16-bit, so `RunSegmenter` runs. A string with no strong-script letter (digits and punctuation
    only) is shaped as Common script, not Latin (blink-canvas §1.4).
  - Word spacing isn't applied to U+2028 (`TreatAsSpace`, `character.h:159-162`; `shape_result_spacing.cc:107-114,
    132-136`). Measure with `wordSpacing = '0px'` and add it arithmetically.
  - Letter spacing applies to U+2028 as to a space.
  - Canvas still splits before CJK ideographs (`plain_text_node.cc:115-127`).
  - It's Chrome-only; other engines don't remap U+2028.
- **Necessary condition.** If k is safe, `R(g[a..k]) + R(g[k..b]) = R(g[a..b])` in integers (by the §3.2 contract; the
  sums below 256 px are exact). **So an inequality proves k is unsafe.**
- **Not sufficient.** Equality doesn't prove k is safe. It can be flagged unsafe with no width change:
  - zero-valued second-value-format pairs;
  - contextual lookups that matched without changing anything;
  - AAT transitions;
  - adjustments that cancel inside the window.
- **Ink doesn't help.** Totals can't tell which glyph carries the adjustment, and ink bounds are identical under both
  splits, because legacy `kern` moves the second glyph by its offset.
- **Canvas has no per-glyph position API by default.** `getSelectionRects`, `getTextClusters` and `getIndexFromOffset`
  are behind `ExtendedTextMetrics`, which is `experimental` with an origin trial
  (`C153/platform/runtime_enabled_features.json5:2745-2749`; `C153/core/html/canvas/text_metrics.idl:57-64`).

### 3.4 What each piece of ShapeLine needs, for LTR Latin

| piece | Blink computes | from Canvas |
|---|---|---|
| paragraph position `pos(k)` at a safe k | `ceil64(prefix of P)` (blink-lines §1.4) | `R(g[a..k])` + earlier safe prefix: **exact** |
| `pos(k)` at an unsafe k (candidate search) | the prefix includes the part of d(g[k−1], g[k]) put on glyph k−1 | `R(g[a..k]) + share × d(g[k−1], g[k])`, where share = 1 (GPOS first-glyph values), `>> 1` (legacy `kern`), unknown otherwise: **attribution loss** |
| line ending before a space, default alignment | no reshape (`shaping_line_breaker.cc:484-495`): width = P advances `[start, wordEnd)`, the last glyph carries its share of d(last, space) | same formula at k = wordEnd: **attribution loss** |
| line end with `NeedsAccurateEndPosition` (end/center/justify/right in LTR, decorations, box background) | `reshape [lastSafe, bo)`, fit is a float compare (:546-553) | `R(g[lastSafe..bo))`: **exact** if lastSafe is known |
| break inside a word (break-all, overflow-wrap, CJK) | the same line-end reshape (:487, :511-584) | `R(g[lastSafe..bo))`: **exact** if lastSafe is known |
| wrapped line start at an unsafe offset | `available += (pos(firstSafe) − pos(start)) − ceil64(width(reshape))` (:312-324) | `R(g[start..firstSafe))` exact; `pos(start)` needs attribution. A **width-neutral flag still moves the available width by up to 1 raw LU**, because a difference of two ceilings isn't the ceiling of the difference |
| trailing-space removal | reshape only when `NeedsAccurateEndPosition` (`line_breaker.cc:2387-2404`) | as above |

### 3.5 A port from Canvas totals

```ts
// One shaping group g: one font, one direction, Latin, no fallback font inside, spacing added arithmetically.
const LS = ' ';
const R = (s: string) => Math.round(ctx.measureText(s.replaceAll(' ', LS)).width * 65536); // exact below 256 px
const d = (x: string, y: string) => R(x + y) - R(x) - R(y);

// Unsafe test: pair window, exact for pair-only fonts.
// Longer windows are needed for contextual lookups (§3.6 L2).
function maybeUnsafe(g: string, k: number): boolean { return d(g[k - 1], g[k]) !== 0; }

// Paragraph prefix at offset k, measured from a safe offset a < k.
// `share` is a per-font fact Canvas can't measure (§3.6 L1).
function prefixP(g: string, a: number, k: number, prefixA: number, share: 'first' | 'legacyHalf'): number {
  const base = prefixA + R(g.slice(a, k));   // glyph k-1 is last, so it has no right-hand adjustment
  if (k >= g.length || !maybeUnsafe(g, k)) return base;
  const dk = d(g[k - 1], g[k]);
  return base + (share === 'first' ? dk : Math.floor(dk / 2));   // hb-kern.hh:102 kern1 = kern >> 1
}

// ShapeLine pieces (blink-lines §6 pseudo-code, same names):
//   pos(k)          = ceilFrom16(prefixP(...))
//   lineStartResult = R(g.slice(start, firstSafe))
//   lineEndResult   = R(g.slice(lastSafe, bo))
//   middle          = prefixP(lastSafe) - prefixP(firstSafe)
// then the item inline size = luCeil(f32 sum of pieces) as in blink-lines §5.2.
// Pieces over 256 px: split at safe offsets and add integers (§3.6 L4).
```

Cost: one Canvas call for each distinct neighbor pair and each piece. Pairs can be cached per (font, pair). The groundwork
did the same with pair probes and a per-font attribution fact, and got 36,657/36,672 lines exact
(`pretext-emulation-20260915/NOTES.md:127-133`). U+2028 would replace its `optimizeLegibility` mode, which works only for
fonts with the space glyph in GPOS or GSUB coverage. U+2028 works for every font [I, H5-H8].

### 3.6 What is lost where Canvas can't tell

- **L1 attribution.** Which glyph carries an adjustment at an unsafe offset that Blink doesn't reshape:
  - default-aligned lines ending before a space;
  - the candidate search;
  - `pos(start)` at wrapped line starts.

  GPOS first-glyph kerning puts all of d on the first glyph; legacy `kern` puts `d >> 1` there; second-glyph values and
  contextual positioning put it elsewhere.
  - Size: up to ⌈|d|/2⌉ per line end for a font whose mechanism is guessed wrong. Arial `AAAA` before a space: all of
    −0.8828 px; Helvetica: −0.4375 px (H10).
  - No Canvas signal found that tells legacy `kern` from GPOS. `textRendering = 'optimizeLegibility'` tells only whether
    the space glyph is in GPOS or GSUB coverage, and Times New Roman is in GSUB coverage yet kerns through `kern`.
  - The rebuild needs a per-font fact, or accepts this loss.
- **L2 width-neutral unsafe flags** (§3.2 rows marked "not always").
  - Blink reshapes where the totals show nothing.
  - Widths only change if the reshape changes glyphs, but the line-start adjustment can still move the available width
    by 1 raw LU (§3.4).
  - AAT fonts on macOS (`morx` in Helvetica, Times, Menlo) can flag transitions without width change.
- **L3 context.** The DOM reshape keeps up to 5 context code points on each side; Canvas has none. Context is read by
  Arabic joining (`hb/src/hb-ot-shaper-arabic.cc:305-316, 355-372`) and by dotted-circle insertion
  (`hb-ot-shape.cc:554-557`). A cut inside an Arabic word gets different joining forms. The groundwork's ZWJ probes
  approximate this.
- **L4 float32.** `measureText` returns a float32 sum. Above 256 px the low bits of R are rounded. Measure at safe
  offsets in pieces below 256 px and add integers.
- **L5 group edges.** Blink's paragraph shape is per shaping group, which ends at style, font, direction, segment and
  control items (blink-lines §3.2). Canvas pieces must not cross a group edge, or they add kerning the DOM doesn't apply.
- **L6 fallback fonts** inside a group give separate runs, with no cross-run kerning in either engine. A run start is
  always safe (`shape_result.cc:1366-1368`), so nothing is lost there, but Canvas must reproduce the same font choice.

---

## 4. Item 7: port-level pseudo-code for the handlers

State, types and helpers are as in blink-lines §4-§9 (`results`, `current = {itemIndex, textOffset}`, `position` in raw
LU, `state`, `trailingWhitespace`).

### 4.1 Shared helpers [V]

```ts
const isBreakableSpace = (c) => c === ' ' || c === '\t';                                   // line_breaker.cc:186-188
const isBidiTrailingSpace = (c) => bidiClass(c) === 'WS';                                  // :202-204
// WS class [M, Python unicodedata 16.0]: U+000C, U+0020, U+1680, U+2000..U+200A, U+2028, U+205F, U+3000

function addItem(item, endOffset = item.end) {                                             // :575-598
  const prev = results.at(-1);
  const r = {
    item, itemIndex: current.itemIndex, start: current.textOffset, end: endOffset,
    inlineSize: 0, shapeResult: null, canBreakAfter: false,
    hasOnlyPreWrapTrailingSpaces: false, hasOnlyBidiTrailingSpaces: false,
    breakAnywhereIfOverflow,
    shouldCreateLineBox: !!prev?.shouldCreateLineBox,                                      // inherited :237-239, :591
    hasUnpositionedFloats: !!prev?.hasUnpositionedFloats,
  };
  results.push(r);
  return r;
}

function addEmptyItem(item) {                                                              // :600-616
  const r = addItem(item, current.textOffset);          // empty range, zero width
  const last = results.at(-2);
  if (last?.canBreakAfter) { last.canBreakAfter = false; r.canBreakAfter = true; }   // an opportunity moves past empty items
  return r;
}

function moveToNextOf(item) { current = { itemIndex: current.itemIndex + 1, textOffset: item.end }; }   // :4665-4676

function moveToNextOfResult(r) {                                                           // :4678-4684
  current = { itemIndex: current.itemIndex, textOffset: r.end };
  if (r.end === r.item.end) current.itemIndex++;
}

function handleOverflowIfNeeded(): boolean {                                               // :619-625
  if (state === 'Continue' && !(position <= availableWidth + 1)) { handleOverflow(); return true; }
  return false;
}

function computeCanBreakAfter(r) { r.canBreakAfter = autoWrap && breakIterator.isBreakable(r.end); }    // :270-275
```

### 4.2 HandleEmptyText [V]

```ts
function handleEmptyText(item) {                     // line_breaker.cc:2034-2042
  addEmptyItem(item);                                // keeps every item visible to later passes
  moveToNextOf(item);                                // for a CR/FF control item this skips its one character
}
```

It doesn't change `position`, `state` or `trailingWhitespace`.

Example: pre-wrap `"a \rb"` has items `["a "][CR][b]`.
- `"a "` fits, and the space opportunity puts `canBreakAfter` on it.
- CR adds an empty result that **takes over** `canBreakAfter`.
- A rewind therefore finds the opportunity at the CR result (blink-text H35: 2 lines, CR has zero width).

### 4.3 HandleControlItem [V]

```ts
function handleControlItem(item) {                                   // :2944-2999
  if (item.textType === 'ForcedLineBreak') return handleForcedLineBreak(item);
  switch (text[item.start]) {
    case '\t':                                                       // :2955-2976, tab stops: blink-lines §12
      if (!item.style.font.primaryFont) return handleEmptyText(item);
      return handleText(item, shapeForTabulationCharacters(item, position /* + float offset + tab stop offset */));
    case '​': {                                                 // <wbr> or generated opportunity :2977-2987
      const r = addItem(item);
      if (!item.isGeneratedForLineBreak) r.shouldCreateLineBox = true;
      r.canBreakAfter = true;                                        // even under nowrap
      break;
    }
    case '\r': case '\f':                                            // :2988-2994 (preserve modes only)
      return handleEmptyText(item);
  }
  moveToNextOf(item);
}
```

### 4.4 HandleForcedLineBreak [V]

```ts
function handleForcedLineBreak(item /* null for an implicit forced break */) {   // :2856-2940
  if (handleOverflowIfNeeded()) return;          // content before the LF overflowed: re-break first; the LF comes back later
  if (item) {
    // (<br clear> past floats in another fragmentainer: :2895-2903, out of scope)
    const r = addItem(item);                     // [LF, LF+1), inline size 0
    r.shouldCreateLineBox = true;
    r.hasOnlyPreWrapTrailingSpaces = true;
    r.hasOnlyBidiTrailingSpaces = true;
    r.canBreakAfter = true;
    moveToNextOf(item);
    while (!atEnd()) {                           // pull following close tags and empty texts onto THIS line :2918-2930
      const next = items[current.itemIndex];
      if (next.type === 'CloseTag') { handleCloseTag(next); continue; }   // adds inline-end margin+border+padding; moves canBreakAfter
      if (next.type === 'Text' && next.length === 0) { handleEmptyText(next); continue; }
      break;
    }
  }
  if (hasHyphen()) position -= removeHyphen();
  isForcedBreak = true;
  lineInfo.hasForcedBreak = true;
  lineInfo.isLastLine = true;
  state = 'Done';
}
```

Consequences for the next line and the line end:
- The next line has `previousLineHadForcedBreak` (blink-lines §4.1), so ShapeLine never reshapes its start
  (`shaping_line_breaker.cc:91-96`).
- `RemoveTrailingCollapsibleSpace` doesn't rewind trailing open tags after a forced break (`line_breaker.cc:2567-2569`).
  Its helper skips the LF result and removes a collapsible space before it (§4.5). So `"foo <br>"` loses the space.
- If the state is `Overflow` when the LF arrives, `handleOverflowIfNeeded` returns false, because it runs only in
  `Continue`. The LF then ends the overflowing line.

### 4.5 ComputeTrailingCollapsibleSpace, its helper, and RemoveTrailingCollapsibleSpace [V]

```ts
function computeTrailingCollapsibleSpace() {                                        // :2651-2666
  if (['Leading', 'None', 'Collapsed', 'Preserved'].includes(trailingWhitespace)) { trailingSpace = null; return; }
  trailingWhitespace = 'None';                                                      // Unknown or Collapsible from here
  if (!helper()) trailingSpace = null;
}

function helper(): boolean {                                                        // :2668-2747 (ruby branch omitted)
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i], item = r.item;
    if (item.endCollapseType === 'OpaqueToCollapsing') continue;                    // tags, bidi controls, floats, OOF, atomics
    if (item.type === 'Text') {
      if (r.end === r.start) continue;
      const last = text[r.end - 1];
      if (last === '　') { trailingWhitespace = 'Preserved'; trailingSpace = null; return true; }
      if (!isBreakableSpace(last)) { trailingSpace = null; return true; }          // state stays 'None'
      if (item.style.preservesWhiteSpace) { trailingWhitespace = 'Preserved'; trailingSpace = null; return true; }
      if (!r.shapeResult) { trailingSpace = null; return true; }                   // overflow result without shaping
      if (!trailingSpace || trailingSpace.index !== i)
        trailingSpace = { index: i,
          collapsed: r.end - 1 > r.start ? truncateLineEndResult(r, r.end - 1) : null };
      trailingWhitespace = 'Collapsible';
      return true;
    }
    if (item.type === 'Control') {
      if (item.textType === 'ForcedLineBreak') continue;                            // look through <br> / LF
      trailingWhitespace = 'Preserved'; trailingSpace = null; return true;          // tab, ZWSP, CR, FF items
    }
    trailingSpace = null; return true;                                              // block-in-inline
  }
  return false;
}

function truncateLineEndResult(r, end) {                                            // :2371-2405
  if (!needsAccurateEndPosition(lineInfo, r.item)) return view(r.shapeResult, r.start, end);
  const lastSafe = r.shapeResult.previousSafeToBreakOffset(end);
  if (lastSafe === end || lastSafe <= r.start) return view(r.shapeResult, r.start, end);
  return view([r.shapeResult, r.start, lastSafe], [reshape(r.item, lastSafe, end), 0, end]);
}

function removeTrailingCollapsibleSpace() {                                         // :2564-2613
  if (!isForcedBreak) rewindTrailingOpenTags();
  computeTrailingCollapsibleSpace();
  if (!trailingSpace) return;
  const r = results[trailingSpace.index];
  const saturated = position === LU_MAX;
  position -= r.inlineSize;
  if (trailingSpace.collapsed) {
    r.end -= 1;
    r.shapeResult = trailingSpace.collapsed;
    r.inlineSize = luCeil(r.shapeResult.width);      // SnappedWidth, no clamp
    position += r.inlineSize;
  } else {
    r.end = r.start; r.shapeResult = null; r.inlineSize = 0;   // result kept, empty
  }
  if (saturated) position = lineInfo.computeWidth();
  trailingSpace = null;
  trailingWhitespace = 'Collapsed';
}

function rewindTrailingOpenTags() {                                                 // :2536-2560
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].item.type !== 'OpenTag') {
      if (i + 1 < results.length) { const end = startOf(results[i + 1]); rewind(i + 1); current = end; }
      break;
    }
  }
}
```

- **Atomic inlines.** `endCollapseType` is `Collapsible` only for text, control and block-in-inline items. Every other
  type is `OpaqueToCollapsing` (`C153/core/layout/inline/inline_item.h:215-228`), so the helper looks through atomic
  inlines. Only the `trailingWhitespace` state gate at :2652-2658 keeps it from removing a space before an image. That
  state after `HandleAtomicInline` wasn't read here.
- **`TrailingCollapsibleSpaceWidth`** (:2616-2647) is used only for float placement (:3703), so it's out of scope.

### 4.6 HandleBidiControlItem [V]

```ts
function handleBidiControlItem(item) {                              // :3001-3041
  const c = text[item.start];
  if (c === '⁩' /* PDI */ || c === '‬' /* PDF */) {       // "pop": like a close tag
    if (results.length) {
      const r = addItem(item);
      const last = results.at(-2);
      if (last.canBreakAfter) { r.canBreakAfter = true; last.canBreakAfter = false; }
      else computeCanBreakAfter(r);             // isBreakable(r.end): the iterator skips bidi controls
    } else {
      addItem(item);
    }
  } else {                                      // LRE, RLE, LRO, RLO, LRI, RLI, FSI: like an open tag
    if (state === 'Trailing' && results.at(-1)?.canBreakAfter) {
      moveToNextOf(item);                       // consumed, NOT added: the next line starts after it
      state = 'Done';
      return;
    }
    addItem(item);                              // canBreakAfter stays false
  }
  moveToNextOf(item);
}
```

Example: `<bdi>foo</bdi>bar`.
- text_content is `"⁨foo⁩bar"`.
- The PDI result asks `isBreakable` at the offset after the PDI. The iterator skips the control and sees `o` then `b`,
  so there's no opportunity and the word `foobar` overflows as one word (H15).

### 4.7 SplitTrailingBidiPreservedSpace [V]

```ts
function splitTrailingBidiPreservedSpace() {                                     // :2758-2853
  if (trailingWhitespace === 'Leading' || trailingWhitespace === 'None') return;   // only Collapsed or Preserved
  if (!node.isBidiEnabled) return;
  if (mode === 'MinContent') return;
  for (let idx = results.length - 1; idx >= 0; idx--) {
    const r = results[idx], item = r.item;
    if (r.hasOnlyBidiTrailingSpaces || item.endCollapseType === 'OpaqueToCollapsing'
        || item.textType === 'ForcedLineBreak') continue;
    if (item.type !== 'Text' && item.type !== 'Control') return;
    if (r.end === r.start) { r.hasOnlyBidiTrailingSpaces = true; continue; }
    let i = r.end;
    while (i > r.start && (isBreakableSpace(text[i - 1]) || isBidiTrailingSpace(text[i - 1]))) i--;
    if (i === r.start) { r.hasOnlyBidiTrailingSpaces = true; continue; }        // all spaces: keep walking back
    if (i === r.end) break;                                                    // ends in a non-space
    if (item.bidiLevel !== baseDirection /* 0 LTR, 1 RTL */) {
      const prev = r.inlineSize, src = r.shapeResult, end = r.end;
      r.end = i;
      r.shapeResult = view(src, r.start, i);
      r.inlineSize = luCeil(r.shapeResult.width);
      const spaces = newResult(item, r.itemIndex, [i, end],
        r.breakAnywhereIfOverflow, r.shouldCreateLineBox, r.hasUnpositionedFloats);
      spaces.hasOnlyBidiTrailingSpaces = true;
      spaces.shapeResult = view(src, i, end);
      spaces.inlineSize = prev - r.inlineSize;                                   // line width unchanged
      results.splice(idx + 1, 0, spaces);                                        // spaces.canBreakAfter = false
    }
    break;
  }
}
```

- **Effect.** Results with `hasOnlyBidiTrailingSpaces` take the paragraph level when the line is reordered (UAX #9 L1;
  `C153/core/layout/inline/logical_line_builder.cc:725-729`). It changes neither line breaks nor `position`. It changes
  per-result widths (a split) and where the spaces are drawn.
- **Example.** `white-space: pre-wrap`, LTR block, content `def<span dir=rtl>אבג </span>`:
  - the Hebrew item has level 1, the trailing space is split off at level 0;
  - the space is drawn right of the isolate, not left of `ג` (H16).

---

## 5. Item 8: CanShapeWordByWord and U+2010

### 5.1 Who uses CanShapeWordByWord [V]

- A grep of `C153` finds one caller, `PlainTextNode::SegmentWord` (`C153/platform/fonts/plain_text_node.cc:381`), which
  serves Canvas and other plain-text painting.
- DOM inline layout shapes each shaping group in one call (`C153/core/layout/inline/inline_node.cc:1551-1796`) and never
  asks. So the question for the rebuild isn't this flag. It's **whether the DOM's one-call shaping changes widths at
  spaces**, and §5.4 test C answers that directly.

### 5.2 The rule [V]

- **Settings.** `ComputeCanShapeWordByWord` returns true when the typesetting-feature bits are 0
  (`C153/platform/fonts/font_fallback_list.cc:264-277`). Otherwise it's
  `!HasSpaceInLigaturesOrKerning(features)` on the first font with a space glyph (:269-270).
  - Canvas bits are 0 by default.
  - `fontKerning = 'normal'` sets `kKerning` (`C153/modules/canvas/canvas2d/canvas_rendering_context_2d_state.cc:450-458`;
    `C153/platform/fonts/font_description.cc:356-362`).
  - `textRendering = 'optimizeLegibility'` or `'geometricPrecision'` sets `kKerning | kLigatures` (`state.cc:947-957`;
    `font_description.cc:350-353`).
  - Element ligature settings apply only on a connected canvas with zero letter spacing (:371-389).
- **Cache.** The answer is computed once per `FontFallbackList` (:279-286).
- **The space check** (`C153/platform/fonts/shaping/harfbuzz_face.cc:322-390`): with `kKerning`, is the space glyph in
  the glyph set collected from any GPOS lookup; with `kLigatures`, from any GSUB lookup. Collection uses
  `hb_ot_layout_lookup_collect_glyphs`, with one set for before, input, after and output (:326-333).
  - **Not checked:** the legacy `kern` table, `kerx` and `morx`.
  - **Pair-kerning collection lists** the first-glyph coverage and the glyphs named in the second class table
    (`hb/src/OT/Layout/GPOS/PairPosFormat2.hh:118-122`). A pair whose second glyph is in class 0, the implicit class,
    doesn't add that glyph [V code; no font example found].

### 5.3 Font facts on this Mac [M]

| font | GPOS | GSUB | `kern` | `morx` | space in GPOS coverage | space in GSUB coverage | cross-space d in `"A V"` (font units) |
|---|---|---|---|---|---|---|---|
| Arial | yes | yes | yes | – | **yes** | yes | −113 |
| Helvetica | – | – | yes | yes | no | no | −112 |
| Helvetica Neue | – | – | yes | yes | no | no | 0 |
| Times | – | – | yes | yes | no | no | −148 |
| Times New Roman | yes | yes | yes | – | no | **yes** | −150 |
| Courier New | yes | yes | – | – | no | yes | 0 |
| Georgia | – | tiny | – | – | no | no | 0 |
| Verdana | tiny | tiny | yes | – | no | no | 0 |
| Menlo | – | – | – | yes | no | no | 0 |
| SF (`SFNS.ttf`) | yes | yes | – | – | yes | yes | 0 |

So `CanShapeWordByWord` is false only under:
- `fontKerning = 'normal'` for Arial and SF;
- `optimizeLegibility` for Arial, SF, Times New Roman and Courier New.

Helvetica and Times kern across spaces in the DOM, and no Canvas typesetting setting makes Canvas shape them whole. This
agrees with the groundwork (`NOTES.md:79-81, 130`).

### 5.4 Canvas-observable tests

- **A. `"A V"` vs `"A"` + `" "` + `"V"` under default settings.**
  - Always equal: `NextWordEndIndex` makes `"A"`, `" "` and `"V"` separate items in both calls
    (`plain_text_node.cc:93-113`), and the sum is the same float32 additions (blink-canvas §1.3). It tests nothing.
  - Under `fontKerning = 'normal'` a difference means `CanShapeWordByWord` is false **and** the pair kerns (Arial). An
    equality means nothing.
- **B. `CanShapeWordByWord` itself, through the word-spacing cache [I].**
  - Mechanism: word-by-word shaping caches `" "` by text and direction with the spacing of its first use
    (`plain_text_node.cc:402-453`), and a space at content offset 0 gets no word spacing
    (`shape_result_spacing.cc:132-136`).
  - Setup: a fresh OffscreenCanvas, `ctx.fontKerning = 'normal'`, `ctx.wordSpacing = '10px'`.
  - Measure `" x"` first, then `"x y"`.
  - Word by word: `"x y"` reuses the cached `" "` and gets **no** +10 px.
  - Whole run: `"x y"` is one item and gets +10 px (H9).
- **C. Cross-space shaping in the DOM, whatever the flag says [I].**
  - `dSpace(s) = R(s with U+0020 → U+2028) − R(s)` under default settings.
  - A non-zero value means the DOM's one-call shaping of `s` differs from the word sum by exactly that amount.
  - It covers GPOS, GSUB, legacy `kern`, `kerx` and `morx`, with the §3.3 caveats (H5-H8).

### 5.5 Whether the primary font has U+2010 [V]

- **Rule.** `ComputedStyle::HyphenString()` returns `hyphenate-character` if set. Otherwise it returns U+2010 when
  `PrimaryFont()->GlyphForCharacter(U+2010)` is non-zero, else U+002D (gitiles 153
  `third_party/blink/renderer/core/style/computed_style.cc:1804-1820`).
  - The primary font is the first font with a space glyph (`C153/platform/fonts/font.h:234-237`;
    `font_fallback_list.h:76-84`).
  - `GlyphForCharacter` calls `HarfBuzzGetNominalGlyph` (`C153/platform/fonts/simple_font_data.cc:250-262`;
    `harfbuzz_face.cc:397-402`). That is HarfBuzz's cmap, plus on Apple `SkTypeface::unicharToGlyph` (CoreText) when
    the cmap has no U+2010 (`harfbuzz_face.cc:217-229`).
- **Shaping.** The hyphen is shaped with the item's font, direction only, and no letter or word spacing
  (`C153/core/layout/inline/hyphen_result.cc:12-16`).
- **[M] on this Mac.**
  - No cmap U+2010: Arial, Times, Times New Roman, Courier New, Georgia, Verdana. CoreText returns glyph 16, their
    hyphen-minus: Arial 5.328125 px at 16 px, Georgia 5.984375, Courier New 9.6015625. **Blink uses U+2010 for all of
    them.**
  - A real U+2010: Helvetica (glyph 581), Helvetica Neue (glyph 619, same advance as `-`), Menlo, SF (the same glyph as
    `-`).
- **Canvas test (exact, same lookup function).**
  - With `letterSpacing = '0px'`, measure `measureText('‐')` twice: with `ctx.font = '16px X, "Courier New"'` and
    with `'16px X, Georgia'`.
  - If X has no U+2010 glyph even through CoreText, HarfBuzz falls back to the second family, whose synthesized hyphens
    differ (9.6015625 vs 5.984375 px).
  - Equal results mean X has the glyph: the DOM hyphen is U+2010, width `measureText('‐')` in `16px X`.
  - Different results mean it doesn't: the DOM hyphen is `-`, width `measureText('-')`.
- **Losses.** Web fonts with `unicode-range`, where the range check at `harfbuzz_face.cc:98-101` runs first, and a
  primary font whose own synthesized hyphen happens to equal one of the two fallback widths.
  - Use a third family to rule out a coincidence.
  - On this Mac every tested font's U+2010 width equals its `-` width, so the choice changes no widths for them [M].

---

## 6. Later Blink items

### 6.1 Item 12: HanKerning::MayApply [V]

- **Constructor.** `may_apply_ = MayApply(segment text) && text-spacing-trim != space-all`
  (`C153/platform/fonts/shaping/han_kerning.h:57-65`).
- **`MayApply(text)`.** `!text.Is8Bit()` and some code unit passes `MaybeHanKerningOpenOrCloseFast` (:152-156). 8-bit
  text never applies.
- **`AppendFontFeatures`** returns false when:
  - a sub-range of the segment fails `MayApply` (`han_kerning.cc:237-241`);
  - the font lacks `halt` (`vhal` in vertical text; :404-410);
  - the font maps its probe characters to more than one glyph each (:465-470);
  - an exclusive feature is on (:247-251).
- **Canvas.** Every segment constructs `HanKerning` (`harfbuzz_shaper.cc:895, 1019-1030`). Canvas keeps a Common-script
  bracket in the same word as its neighbor (`plain_text_node.cc:141-146`).
- **Test (H18).** `R("「「")` < `2 × R("「")` in a font with `halt`, because the second opening bracket is trimmed
  [I from `han_kerning.h:164-168`]. That tells the rebuild whether DOM Han kerning can apply for that font.

### 6.2 Item 13: GetHyphenationWithLimits [V]

- `GetHyphenation()` returns null unless `hyphens: auto`; with auto it returns the locale's hyphenation, with the
  `hyphenate-limit-chars` limits (gitiles 153 `core/style/computed_style.cc:1784-1802`).
- `SetCurrentStyleForce`:
  - `hyphens: none`: soft hyphens off, `hyphenation_ = null`;
  - otherwise soft hyphens on and `hyphenation_ = GetHyphenationWithLimits()`, which is null for `manual`
    (`line_breaker.cc:4628-4634`);
  - `word-break: auto-phrase` forces `hyphens = none` (:4595-4602).
- With `hyphenation_` null, `PreviousBreakOpportunity` and `NextBreakOpportunity` use only the iterator
  (`shaping_line_breaker.cc:174-209`), and a break is hyphenated iff `text[break − 1] == U+00AD` (:211-225).
- blink-lines §10's inference is confirmed.

### 6.3 Item 14 (Blink part): 8-bit vs 16-bit storage

- **JS strings.** `ToBlinkString` picks the WTF storage from `v8_string->IsOneByte()` (gitiles 153
  `platform/bindings/to_blink_string.cc:216-227`, byte-identical to 152). [I] V8's `IsOneByte` reports the
  representation, so a Latin-1-only JS string can still be two-byte, for example a long slice of a two-byte string.
  V8 wasn't read.
- **Parser text.** `UCharLiteralBuffer::AsString` makes an 8-bit string when every code unit ≤ U+00FF
  (`core/html/parser/literal_buffer.h:306-321`, 152, not re-read at 153). Pending text is appended through a
  `StringBuilder` (`core/html/parser/html_construction_site.h:326-336`, 152).
- **DOM layout depends on storage [V].**
  - `AppendTransformedString` sets `has_non_orc_16bit_` when the appended string **is stored as 16-bit**
    (`C153/core/layout/inline/inline_items_builder.cc:725`), not only per character (:216-218, :1258, :1343).
  - `SegmentScriptRuns` takes the single-Latin-segment shortcut only if text_content is 8-bit or `!has_non_orc_16bit_`
    (`inline_node.cc:1256-1266`).
  - So one 16-bit-stored text node sends the whole block through `RunSegmenter`. A block with no strong-script letter
    (digits, punctuation) is then shaped as Common script (`DFLT` lookups), not Latin.
  - Bidi is still turned on only by content (`MaybeBidiRtl`, `inline_items_builder.cc:1744-1746`).
  - The break iterator runs the same template for both storages (`C153/platform/text/text_break_iterator.cc:404-417`) [I:
    no result difference].
  - East Asian newline removal needs 16-bit text on both sides (`inline_items_builder.cc:115-118, 142-150`), but it also
    needs wide characters.
- **Canvas.** Storage chooses Latin vs `RunSegmenter` per item (blink-canvas §1.4). Normalization keeps a 16-bit input
  16-bit (`plain_text_node.cc:66-81`).

### 6.4 Item 15: Blink DOM geometry at DPR 2 [V]

- `Element::GetBoundingClientRect` unions the client quads, then `AdjustRectForScrollAndAbsoluteZoom` (gitiles 153
  `core/dom/element.cc:3445-3462`).
- `Range::getClientRects` uses:
  - `LayoutText::AbsoluteQuadsForRange`, which builds a `PhysicalRect` from `cursor.CurrentLocalRect` or
    `item.LocalRect` and converts it with `LocalRectToAbsoluteQuad` (gitiles 153 `core/layout/layout_text.cc:556-648`);
  - then `AdjustQuadsForScrollAndAbsoluteZoom` (`core/dom/range.cc:1681-1715`, same at 152 and 153).
- Both scale by `1 / GetAbsoluteZoom`. That is the frame's `LayoutZoomFactor` when `StandardizedBrowserZoom` is on,
  else `EffectiveZoom` (gitiles 153 `core/layout/adjust_for_absolute_zoom.h:42-49, 109-124`). The flag is stable
  (`C153/platform/runtime_enabled_features.json5:5955-5957`).
- **Arithmetic [I].** A LayoutUnit rect becomes a float `raw/64` (exact below 2^24 raw), then it's multiplied by the
  float `1/Z`.
  - At Z = 2 the factor is exactly 0.5, so every width is an integer count of 1/128 CSS px.
  - At Z = 2.2, `1/2.2` is inexact in float32: read widths as `round(width × Z × 64)`.
  - `Document::AdjustQuadsForScrollAndAbsoluteZoom` was read at 152 (`core/dom/document.cc:8880-8899`).

---

## 7. Corrections and additions to the other specs

- **blink-text §2.E and H5, H6.** The width of a C0 control isn't "undetermined": §2.4-§2.5 give the chain and the
  expected Hiragino width on this Mac.
- **blink-text H5 (pre-wrap part).** `width == width("ab")` is imprecise. In `pre-wrap` the FF control item splits `a`
  and `b` into separate items, each rounded up to 1/64 px on its own, so the width can be 1 raw LU more (H2).
- **blink-lines §3.2, blink-text §2.D/§2.E, and CRITIC item 14.** The single-Latin-segment condition depends on storage
  through `inline_items_builder.cc:725`: one 16-bit-stored text node is enough to turn the shortcut off.
- **blink-lines §20** says whether the primary font has U+2010 is "not directly" observable. The §5.5 two-fallback test
  observes it exactly.
- **blink-canvas §1.3** says legacy `kern`, `kerx` and `morx` aren't checked, which is right. Add the consequence:
  Helvetica, Times and Times New Roman kern across spaces in the DOM, and no Canvas typesetting setting shapes Helvetica
  or Times whole [M].
- **blink-lines §6** says line-end reshape depends on alignment (probe 6). Add: under default alignment the width of a
  line ending before a space depends on the font's kerning mechanism (§3.6 L1).

---

## 8. Hypotheses to probe in installed Chrome 153

**Harness.**
- Page: `<!doctype html><html lang="en"><body style="margin:0">`.
- Z = `devicePixelRatio` at 100% browser zoom.
- Text containing controls or U+2028 is set with `el.firstChild.data = ...`.
- DOM widths are `getBoundingClientRect().width` of an inline `<span>` in an unconstrained `<div>`, or
  `Range.getClientRects()` per line, read as `L = Math.round(width × Z × 64)` raw LU.
- Canvas values come from a fresh OffscreenCanvas at `16×Z px`, read as `R16`.
- "ceil64" means `Math.ceil(R16 / 1024)`.
- Expected numbers assume CoreText advances equal `hmtx` (groundwork: 60 face/size pairs), and are given at Z = 1 and
  Z = 2.

1. **FF width goes through fallback.**
   - Setup: `font: 16px Arial`, span data `"a\fb"`.
   - Expected: `L` equals ceil64 of Canvas `measureText("ab")`, and `L("a\fb") − L("ab")` is 341 raw LU ± 1 at Z = 1
     (≈ 5.328 px, Hiragino glyph 1).
   - Refuted if the difference is 768 raw (Arial .notdef, 12 px) or 285 raw (space, 4.4453 px).
2. **VT literal in every mode, FF only in collapse modes.**
   - Same font as H1.
   - `L("a\vb")` equals `L("a\fb")` from H1, both in `white-space: normal` and in `pre-wrap` for VT.
   - In `pre-wrap`, FF is a zero-width control item that splits the text into two items, each rounded up separately:
     `L("a\fb") == ceil64(R16("a")) + ceil64(R16("b"))`. For Arial at Z = 1 that is 1140, one more than `L("ab") = 1139`.
3. **Letter spacing skips FF but not VT.** `font: 16px Arial; letter-spacing: 3px`:
   `L("a\vb") − L("a\fb") = 192` raw at Z = 1 (384 at Z = 2).
4. **Helvetica's zero-width controls.**
   - DOM: in `font: 16px Helvetica`, `L("ab") == L("ab")`, and `L("ab") − L("ab")` ≈ 341 raw at Z = 1.
   - Canvas: `R16("ab") == R16("ab")`.
5. **Arial: GPOS kerning across a space, and U+2028 shaping whole.** `16px Arial`, Z = 1:
   - `R16("A V") − R16("A V") = 57856`;
   - `R16("A V") = 1690112`, `R16("A V") = 1632256`;
   - DOM span `"A V"`: `L = 1594` (24.90625 px).

   At Z = 2 (Canvas at 32 px), the difference is 115712 and `L = 3188`.
6. **Helvetica: legacy `kern`, invisible to typesetting modes.** `16px Helvetica`:
   - `R16("A V") − R16("A V") = 57344` at Z = 1;
   - with `ctx.fontKerning = 'normal'` and, separately, `ctx.textRendering = 'optimizeLegibility'`, `R16("A V")` is still
     1690112 (word-split);
   - DOM `"A V"`: `L = 1595` at Z = 1 (ceil of 1594.5), `L = 3189` at Z = 2.
7. **Times New Roman: legacy `kern` in a font with GPOS.** `16px "Times New Roman"`:
   - default and `fontKerning = 'normal'`: `R16("A V") = 1776640`;
   - `R16("A V") = 1699840` (d = −76800 = −(113 + 37) × 512);
   - under `optimizeLegibility`, `R16("A V") = 1699840` (the space glyph is in GSUB coverage);
   - DOM `L = 1660` at Z = 1.
8. **Georgia control.** `16px Georgia`: `R16("A V") == R16("A V") == 1655296` in all three Canvas modes, and DOM
   `L = 1617` at Z = 1.
9. **`CanShapeWordByWord` through the word-spacing cache.**
   - Setup: fresh OffscreenCanvas, `fontKerning = 'normal'`, `wordSpacing = '10px'`; `measureText(" x")` first, then
     `w = measureText("x y").width`.
   - Control: on a second fresh OffscreenCanvas with `wordSpacing = '0px'`, `w0 = measureText("x y").width`.
   - `16px Arial`: `w − w0 = 10`.
   - `16px Georgia`: `w − w0 = 0`.
   - For both fonts, measuring `"x y"` first on a fresh canvas gives `w − w0 = 10`.
10. **Line-end attribution under default alignment.**
    - Setup: `<div><span id=s>AAAA</span> VVVV</div>`, no width limit, measure `s`.
    - Arial, 16px: `L = 2676` at Z = 1 (all of d on the 4th A), `5351` at Z = 2.
    - Helvetica: `L = 2704` at Z = 1 (d >> 1 = −28672), `5408` at Z = 2.
    - Times New Roman: `L = 2930` at Z = 1, `5860` at Z = 2.
    - Georgia: `L = ceil64(R16("AAAA"))`.

    A model that ignores d gives 2732 (Arial and Helvetica) and 2958 (Times New Roman) at Z = 1.
11. **Line-end reshape under right alignment removes d.**
    - Setup: `<div style="width:60px;text-align:right">AAAA VVVV</div>`, plain text, per-line
      `Range.getClientRects()`.
    - With `text-align: right`, line 1 has `L = 2732` at Z = 1 for Arial and Helvetica (the reshape of `[3,4)` drops d),
      and 5464 at Z = 2.
    - With `text-align: left`, line 1 has `L = 2676` (Arial) and `2704` (Helvetica) at Z = 1.
12. **Unsafe offsets through pair totals.**
    - Arial `R16("To") ≠ R16("T") + R16("o")`, and `R16(" T") ≠ R16(" ") + R16("T")` with U+2028 in place of the space.
    - Georgia: both pairs equal.
    - Courier New: all pairs among `A V T o` equal.
13. **U+2010.**
    - `measureText('‐')` is 5.328125 px both under `16px Arial, "Courier New"` and under `16px Arial, Georgia`: Arial
      "has" U+2010 through CoreText.
    - `16px "Helvetica Neue", "Courier New"` vs `16px "Helvetica Neue", Georgia`: both 6.224 px.
    - DOM `<div lang=en style="font:16px Georgia;hyphens:manual;width:Wpx">aaaa&shy;bbbb</div>`, with W forcing the soft
      hyphen break: line 1 `L − ceil64(R16("aaaa")) == ceil64(R16("‐")) = 383` raw at Z = 1.
14. **A forced break pulls close tags onto its line.**
    - Setup: `<div style="font:16px Georgia;width:300px"><span id=s style="padding-right:30px">a<br></span>b</div>`.
    - `s.getClientRects().length == 1`, its width ≈ W(`a`) + 30 px, and a Range over `b` has `x == 0`.
15. **A pop bidi control doesn't create an opportunity.**
    - Setup: `<div style="font:16px Georgia;width:0"><bdi>foo</bdi>bar</div>`.
    - 1 line (height 1 line box), not 2.
16. **UAX #9 L1 split of preserved trailing spaces.**
    - Setup: `<div style="font:16px Georgia;white-space:pre-wrap;width:300px">def<span dir=rtl>אבג </span></div>`.
    - The Range rect of the trailing U+0020 has `left ≥` the maximum `right` of the three Hebrew letters' rects (drawn
      after the isolate at level 0).
    - Without the split, it would be left of `ג`.
17. **FF and VT through CoreText's fallback language.** Repeat H1 with `lang="ja"` and `lang="zh-Hans"` on the div. The
    expected width is unchanged (§2.4: the fallback font for a control comes from `CTFontCreateForString` without the
    locale). A change would show the renderer's CoreText cascade depends on the element language.
18. **Han kerning is available.** OffscreenCanvas `16px "Hiragino Sans"`: `R16("「「") < 2 × R16("「")` by about
    8 px × 65536 (half an em, `halt`).
19. **`hyphens: manual` never auto-hyphenates.**
    - Setup: `<div lang=en style="font:16px Georgia;width:50px;hyphens:manual">extraordinarily</div>`.
    - 1 line (overflow).
    - The same with `hyphens: auto` gives ≥ 2 lines, all but the last ending in a hyphen.
20. **Storage switches the single-Latin segment [I].**
    - `s8 = "))))))))))))))"` (14 × `)`), `s16 = ("Ā" + s8).slice(1)`.
    - In a font whose `latn` and `DFLT` lookups differ for `)` (Amiri, PLATFORM_BUGS #560614560):
      - Canvas: `R16(s8) ≠ R16(s16)`;
      - DOM: `L` of a div containing `s8` differs from one containing `s16` in the same direction.
    - In Georgia both pairs are equal.
21. **Client-rect widths are 1/128 px at Z = 2.** For 1,000 spans of random ASCII words in `16px Arial`,
    `getBoundingClientRect().width × 128` is within 1e-9 of an integer.

---

## 9. Open questions

- **Chrome's renderer and CoreText.** Does Chrome's renderer on macOS get the same `CTFontCreateForString` substitute
  for C0 controls as a plain process (Hiragino here)? H1 and H17 settle it.
- **Kerning mechanism from Canvas.** Is there any Canvas-observable signal for it (GPOS first-glyph values vs legacy
  `kern` split)? None was found. Without one, the rebuild needs a per-font table or accepts §3.6 L1.
- **Width-neutral unsafe flags.** How often do they occur in `morx` fonts (Helvetica, Times, Menlo) at word edges? They
  can shift wrapped-line available width by 1 raw LU (§3.4). Measuring needs the HarfBuzz flags themselves, for example
  with `hb-shape --show-flags` over the corpus.
- **V8's `IsOneByte`.** Its representation semantics and SlicedString threshold weren't read (§6.3, H20).
- **U+0000 in DOM text.** Not read.
