# Gecko line filling and units (Firefox 156.0)

Topic: how Firefox 156.0 fills lines of horizontal inline text, and the exact arithmetic it uses. Break
opportunities themselves (which positions ICU4X marks) are another spec; here they are an input.

## 0. Revision, conventions, terms

- Source: `~/github/browser-engines/firefox-156.0`, tag `FIREFOX_156_0_RELEASE`, commit
  `3bf8f468258c2181f455e23d4ffcd6acb8f4cdb1`. Every `path:line` below is at that commit.
  - Files outside the sparse checkout were read with `git show FIREFOX_156_0_RELEASE:<path>` from the same clone,
    so their line numbers are the tag's: `dom/base/nsLineBreaker.{h,cpp}`, `dom/base/nsContentUtils.cpp`,
    `gfx/src/{AppUnits.h,nsCoord.h,nsDeviceContext.cpp,nsFontMetrics.cpp}`,
    `servo/components/style/properties/{shorthands.rs,longhands.toml}`,
    `servo/components/style/values/specified/text.rs`, `gfx/harfbuzz/moz.yaml`, `gfx/harfbuzz/src/hb-ot-shape.cc`.
- No browser was launched. Section 10 lists what to check in the installed browser.
- Font numbers in the examples come from a stdlib Python reader of the macOS 27 font files
  (`/System/Library/Fonts/Supplemental/*.ttf`), applying Gecko's formula from section 2.5. They are predictions.

Terms used throughout:

- **app unit (au)**: Gecko's layout unit, 1/60 of a CSS pixel (`gfx/src/AppUnits.h:11`). Stored in `nscoord`, a
  signed 32-bit integer (`gfx/src/nsCoord.h:27-28`).
- **apd**: app units per device pixel. 60 at DPR 1, 40 at DPR 1.5, 30 at DPR 2 (section 2.1).
- **frame**: a layout object. A **text frame** (`nsTextFrame`) maps a content range `[offset, offset+length)` of one
  DOM text node. A text node gets one frame per line it occupies (continuations), plus extra frames where bidi
  direction changes. An **inline frame** (`nsInlineFrame`) is a `<span>` or similar.
- **text run** (`gfxTextRun`): one shaped string covering one or more consecutive text frames that share font,
  language, direction and some text properties. Each frame's text reaches its text run after white-space processing
  ("transformed" text). Every character of a text run has a **glyph record** holding its advance in au and flags.
- **mapped flow**: the slice of a text run that belongs to one DOM text node.
- **cluster**: a grapheme cluster, marked by the "cluster start" flag on its first character.
- **break candidate**: a position before character `i` where the line loop may end a line: a normal break from the
  line breaker, a soft-hyphen break, an emergency break inside a word, or a break after a space under
  `white-space: break-spaces`.
- **break priority** (`gfxBreakPriority`, `gfx/thebes/gfxTypes.h:48`): `eNoBreak = 0`, `eWordWrapBreak = 1`
  (a break inside a word, from `overflow-wrap` or the after-hyphen rule), `eNormalBreak = 2` (an ordinary break,
  a soft hyphen, or a break-spaces break).
- **optional break position**: the line's saved "we could have broken here" point
  (`mLastOptionalBreakFrame`, offset, priority; `layout/generic/nsLineLayout.h:382-383, :552-554`).
- **backup**: redoing a whole line with a break forced at the saved optional break position.
- **trimmable white space**: trailing spaces that don't count when checking fit and are removed or hang at a line end.
- **hang**: trailing preserved spaces allowed to stick out past the line end (`pre-wrap`).

## 1. Pipeline in one page

1. **Frames.** Each DOM text node becomes text frames. When the document has bidi content, `nsBlockFrame::ResolveBidi`
   (`layout/generic/nsBlockFrame.cpp:9201`) splits a text frame at every directional run end into a *non-fluid*
   continuation (`layout/base/nsBidiPresUtils.cpp:1039-1057`) and stores the run's embedding level on the frame
   (`:948-965`). A white-space-only text node next to a line boundary (for example first or last child of a block)
   gets no frame at all when white space isn't significant (`layout/base/nsCSSFrameConstructor.cpp:5263-5286`).
2. **Text runs.** `BuildTextRunsScanner` walks the frames of a block's lines. Consecutive frames continue one text run
   only if `ContinueTextRunAcrossFrames` says so (`layout/generic/nsTextFrame.cpp:2015-2174`, section 3.2). Each
   mapped flow's text is transformed for white space separately (`:2489-2554`, section 3.3). The line breaker keeps
   running across text runs; only non-text frames and hard breaks flush it (section 3.6).
3. **Glyph records.** HarfBuzz shapes the text run word by word; every glyph advance is rounded to whole au once
   (section 2.5). Nothing is ever reshaped because of where a line breaks (`gfx/thebes/gfxTextRun.cpp:1292-1301`).
4. **Line loop.** For each line the block creates an `nsLineLayout`, reflows frames in logical order, and each text
   frame asks `gfxTextRun::BreakAndMeasureText` how much of its text fits in the space left on the line
   (section 4). A line that overflowed because a word ran across a frame edge is redone once with a forced break.
5. **Line end.** Trailing collapsible white space is trimmed (`nsLineLayout::TrimTrailingWhiteSpace`), the line box
   width becomes the sum of placed frame widths, then text-align runs (section 4.8).

## 2. Units and arithmetic

### 2.1 App units per device pixel, DPR and zoom

- Widget scale: `apd0 = max(1, NS_lround(60 / scale))` (`gfx/src/nsDeviceContext.cpp:52-55`). DPR 1 → 60, DPR 1.5 → 40,
  DPR 2 → 30.
- Full zoom: `apd = max(1, NSToIntRound(float(apd0) / fullZoom))`, then the zoom is re-derived as `apd0 / apd`
  (`nsDeviceContext.cpp:57-63, :410-415`). Example: DPR 2 at 110% → `30/1.1 = 27.27` → 27; DPR 1 at 133% → 45.
- The pres context reports it as `AppUnitsPerDevPixel()` (`layout/base/nsPresContext.h:615`).
- All layout lengths (available width, frame widths, letter spacing) are in au and don't depend on apd.
  apd only enters glyph advance computation (section 2.5) and a few device-pixel rules (section 5, "DPR").

### 2.2 CSS lengths to au

- A length in CSS px becomes au by `NSToIntRound(float(px) * 60.0f)`: float32 product, then round half away from
  zero (`layout/style/ServoStyleConstsInlines.h:584-595`; `gfx/src/nsCoord.h:296-298`).
  - Example: `width: 86.38px` → `float32(86.38)*60 = 5182.8` → 5183 au. `width: 86.4px` → 5184 au.
- A percentage resolved during layout truncates: `NSToCoordTruncClamped(basis * pct)`
  (`ServoStyleConstsInlines.h:580-582, :794-806`; `nsCoord.h:267-276`).
- The line's available width is the content-box inline size of the block (after floats) in au
  (`nsBlockFrame.cpp:5256-5273` → `nsLineLayout::BeginLineReflow`, `layout/generic/nsLineLayout.cpp:162-167`).

### 2.3 Font size

- The DOM font size in device pixels is `size.ToAppUnits() / apd` (`gfx/src/nsFontMetrics.cpp:124, :134`), so the
  size itself is quantized to 1/60 CSS px first. `devToCssSize = apd / 60` (`:151`).
- Measured in installed Firefox 156 on 2026-09-16: before that step, Servo computes every font size through
  `quantize_font_size`, which keeps 10 significant bits (`servo/components/style/values/specified/font.rs:993-1022`).
  The computed `font-size` equals that value for all 9 sizes tested (13.33 → 13.3281, 16.8 → 16.8125, 14.4 → 14.4063,
  10.01 → 10.0156). 60 × `m` in Georgia measures 53340 au at 16.8, 16.81 and 16.8166667px and 53220 au at 16.79px, so
  `16.8px` lays out at 16.8125px = 1009 au, not 1008. The size is `NSToIntRound(fround(q10(s)) * 60)` au, with
  `q10(x) = d - (d - x)`, `d = fround(x * 16385)`, all float32.
- On macOS `mAdjustedSize = GetAdjustedSize()` (size-adjust / font-size-adjust applied) and
  `mFUnitsConvFactor = mAdjustedSize / upem`, a float (`gfx/thebes/gfxMacFont.cpp:247-248`).

### 2.4 Which shaper runs for a named font on macOS

- `gfxMacFont::ShapeText` uses Core Text only if the font requires AAT layout **and** the pref
  `gfx.font_rendering.coretext.enabled` is true (`gfx/thebes/gfxMacFont.cpp:144-184`). That pref is `false` on
  Darwin (`modules/libpref/init/StaticPrefList.yaml:7847-7853`).
- Otherwise `gfxFont::ShapeText` runs Graphite if the font has Graphite tables, else HarfBuzz
  (`gfx/thebes/gfxFont.cpp:3486-3545`). Vendored HarfBuzz is 14.3.1 (`gfx/harfbuzz/moz.yaml:23, :27`).
- So for Georgia, Arial, Courier New, Helvetica Neue and similar installed fonts, the shaper is HarfBuzz.
  `gfxCoreTextShaper.cpp` does not run.

### 2.5 Per-glyph advance and rounding

- HarfBuzz scale is the device-pixel size in 16.16 fixed point: `scale = FloatToFixed(adjustedSize)`
  (`gfx/thebes/gfxHarfBuzzShaper.cpp:1261-1263`).
- For TrueType fonts without variations or `sbix`, Gecko's own hmtx callback returns
  `FloatToFixed(float(mFUnitsConvFactor * uint16 advance))`, which truncates to an int32 16.16 value
  (`gfxHarfBuzzShaper.cpp:354-380`, `FloatToFixed` at `:26`).
- Variation fonts and `sbix` fonts (Apple Color Emoji) take widths from CoreGraphics/Core Text instead
  (`gfx/thebes/gfxMacFont.h:30-36`; `gfxMacFont.cpp:437-463`). For `sbix`, Core Text is asked at the device-pixel size.
- Rounding flags: `GetRoundOffsetsToPixels` returns `kRoundX|kRoundY` only when there is a Cairo context that asks for
  it; `gfxMacFont::ShouldRoundXOffset` is false without a Cairo context (`gfxFont.cpp:1070-1107`;
  `gfxMacFont.cpp:566-569`). Inference: macOS content draws through Skia, so there's no Cairo context and inline
  advances are not snapped to device pixels.
- Without x rounding, each glyph's advance is `advance_au = floor(apd / 65536 * i_advance + 0.5)`, a double
  computation stored as an integer (`gfxHarfBuzzShaper.cpp:1554-1559, :1700-1703, :1766-1769`). Kerning and other
  GPOS adjustments are already in `i_advance`.
- One glyph per character becomes a "simple glyph" with a 12-bit advance; anything else becomes "detailed glyphs"
  with `int32_t mAdvance`, all attached to the first character of the clump. The other characters of a ligature get
  no glyphs and zero advance (`gfxHarfBuzzShaper.cpp:1705-1786`; `gfx/thebes/gfxFont.h:794-797, :857-865, :1064-1070`).
- Net result: `advance_au ≈ round(60 * cssSize * designUnits / upem)`, independent of DPR and zoom except at
  near-ties caused by float32 truncation. Computed from the font files:

  | Font, 16px | `a` | `b` | U+0020 | `0` | `-` | "aaaa bbbb" |
  |---|---|---|---|---|---|---|
  | Courier New (upem 2048, every ASCII glyph 1229 units) | 576 | 576 | 576 | 576 | 576 | 5184 au = 86.4px |
  | Georgia (upem 2048; GSUB only `aalt locl`, no GPOS) | 484 | 538 | 232 | 589 | 359 | 4320 au = 72px |

  The same integers come out at apd 60, 55, 45, 40, 30, 27 and 23. Neither font maps U+2010 or U+3000.
- `GetAdvanceForGlyph(i, ls)` returns the simple advance, or the sum of detailed glyph advances plus
  `(glyphCount - 1) * letterSpacing` for clusters flagged to space between their glyphs
  (`gfx/thebes/gfxTextRun.h:780-800`).

### 2.6 Spaces, missing glyphs, tracking, synthetic bold

- **U+0020** is not shaped. It becomes a simple glyph with `NS_lroundf(spaceWidth_devpx * apd)` and the
  "is space" flag (`gfx/thebes/gfxTextRun.cpp:1590-1622`, called from `gfxFont.cpp:3834-3861`).
  `spaceWidth` is the font's space advance scaled to the size, plus the synthetic-bold offset
  (`gfxMacFont.cpp:371-375, :389-391`).
- **U+00A0** is also a word boundary but is shaped as a one-character word (`gfxFont.cpp:3317-3322, :3838-3861`).
- **Unicode spaces no font covers** get `apd * floor(width_devpx + 0.5)`, rounded to whole device pixels
  (`gfxTextRun.cpp:3032-3043`).
- **Tracking** (`trak` table) and **synthetic bold** add `NS_round(value * apd)` au to the last glyph of each
  cluster with a positive advance (`gfxFont.cpp:901-939, :3510-3545, :3551-3562`).
- **Open**: HarfBuzz 14.3.1 also applies `trak` itself when the face has `trak` and `STAT`
  (`gfx/harfbuzz/src/hb-ot-shape.cc:216-221, :288-291`). Whether that doubles tracking for such fonts is unverified.

### 2.7 Spacing and other added widths, all integers

- `gfxFont::Spacing { nscoord mBefore; nscoord mAfter; }` (`gfx/thebes/gfxFont.h:1767-1770`).
- Letter spacing and word spacing are `nscoord` resolved per frame (`nsTextFrame.cpp:1949-1980, :3488-3489`).
- A tab's width is `NSToIntRound(nextTabStop - x)` (`nsTextFrame.cpp:4364-4369`).
- The hyphen width is the advance of a separately shaped hyphen text run plus the frame's letter spacing
  (`nsTextFrame.cpp:4388-4399`; `gfxTextRun.cpp:2458-2488`).
- A character inside a ligature at a range edge gets an integer share of the ligature width:
  `share = clusters * (ligatureWidth / totalClusters)` with integer division, the remainder going to the last part
  (`gfxTextRun.cpp:238-329`).

### 2.8 Types and every comparison against the available width

All widths are integers carried in doubles, so every comparison below is exact integer arithmetic in au. A float
epsilon has no place here.

| Quantity | Type | Where |
|---|---|---|
| available width `aWidth` | `gfxFloat` (double) holding an `nscoord` | `nsTextFrame.cpp:11116`; `nsLineLayout.cpp:798` |
| running `width`, `advance`, `trimmableAdvance` | double | `gfxTextRun.cpp:970-975` |
| `TrimmableWS::mAdvance` | `gfx::Float` (float32) | `gfxTextRun.h:403-406` |
| frame width | `NSToCoordCeilClamped(max(0, advance))` | `nsTextFrame.cpp:11272-11273`; `nsCoord.h:240-246` |
| line's trimmable width `mTrimmableISize` | `NSToCoordFloor(trimmableWS.mAdvance)` | `nsTextFrame.cpp:11426-11429` |
| width removed at line end | `NSToCoordFloor(delta - advanceDelta)` | `nsTextFrame.cpp:11605` |
| line box width | `psd->mICoord - psd->mIStart` (int) | `nsLineLayout.cpp:1784-1786` |

Comparisons:

1. Record a break before character `i`: `lastBreak < 0 || width + advance (+ hyphenWidth) - trimmableAdvance <= aWidth`
   (`gfxTextRun.cpp:1091-1092`).
2. Stop scanning: `width - trimmableAdvance > aWidth`, tested only right after a break candidate
   (`gfxTextRun.cpp:1103-1109`).
3. Everything fits: `width - trimmableAdvance <= aWidth` (`gfxTextRun.cpp:1175`).
4. A soft hyphen at the very end of a frame "fits": `advanceWidth + hyphenWidth <= availWidth` (`nsTextFrame.cpp:11436`).
5. The break at the end of a text run is taken immediately: `advanceWidth - trimmable > availWidth`
   (`nsTextFrame.cpp:11455-11456`).
6. Overflowing part of trailing preserved spaces: `hang = min(max(0, advanceWidth - availWidth), trimmable)`
   (`nsTextFrame.cpp:11218-11220`).
7. Frame placement: `outside = frameIEnd - mTrimmableISize + endMargin > psd->mIEnd`, integers
   (`nsLineLayout.cpp:1251-1252`).
8. Leftover space for alignment: `remainingISize = availISize - line.ISize()` (`nsLineLayout.cpp:3493-3494`).

## 3. From styled runs to text runs

### 3.1 white-space as two longhands

`white-space` is a shorthand for `text-wrap-mode` and `white-space-collapse`
(`servo/components/style/properties/shorthands.rs:916-927`): `normal` = wrap + collapse; `pre` = nowrap + preserve;
`pre-wrap` = wrap + preserve; `pre-line` = wrap + preserve-breaks. `nowrap` is `text-wrap-mode: nowrap`;
`break-spaces` is `white-space-collapse: break-spaces`. The predicates Gecko uses:

- `WhiteSpaceIsSignificant`: collapse is not `collapse` or `preserve-breaks` (`layout/style/nsStyleStruct.h:1324-1328`).
- `NewlineIsSignificantStyle`: `preserve`, `preserve-breaks` or `break-spaces` (`:1340-1345`).
- `WhiteSpaceCanWrapStyle`: `text-wrap-mode: wrap` (`:1356-1358`).
- `WhiteSpaceCanHangOrVisuallyCollapse`: wrap and not `break-spaces` (`:1330-1337`).
- `WordCanWrapStyle`: wrap, and effective `overflow-wrap` is `break-word` or `anywhere` (`:1360-1367`).
  `word-break: break-word` means `word-break: normal` plus `overflow-wrap: anywhere` (`:1303-1315`).
- The frame-aware versions exclude SVG text, ruby and text-combine (`layout/style/nsStyleStructInlines.h:18-34`).

### 3.2 When frames share a text run

`ContinueTextRunAcrossFrames(f1, f2)` (`nsTextFrame.cpp:2015-2174`) returns false, which starts a new text run, if:

- bidi is enabled and the embedding levels differ, or `f2` follows a bidi control (`:2023-2029`);
- writing mode differs (`:2037-2040`);
- `f1` ends in a significant newline (`:2049-2052`);
- the frames are in different elements and any box between them has a non-zero inline margin, border or padding on
  that side, non-baseline vertical alignment, or `unicode-bidi: isolate` (`:2054-2137`);
- `f2` is a non-fluid continuation of the same node, as bidi splitting creates (`:2139-2148`);
- the styles differ in `text-transform`, effective `word-break`, `line-break`, font, language, or text-run flags
  (letter spacing zero vs non-zero, `text-rendering`, hidden control characters) (`:2150-2173`;
  `layout/base/nsLayoutUtils.cpp:6896-6925`).

Two different non-zero letter-spacing values can share a text run: spacing is applied per frame (section 4.6).

Consequences:

- A bold `foo` next to a regular `bar` are two text runs, so shaping, kerning and ligatures stop at the edge. The
  line breaker still sees `foobar` as one word, so there is no break between them (section 3.6).
- `<span style="color:red">` in the middle of a word keeps one text run, so a ligature can span the two frames.
  Each frame then gets an integer share of the ligature width (section 2.7).

### 3.3 White-space transform, per mapped flow

`BuildTextRunForFrames` calls `nsTextFrameUtils::TransformText` once per mapped flow, on that flow's content range
only (`nsTextFrame.cpp:2489-2554`). The mode comes from `GetCSSWhitespaceToCompressionMode` (`:1335-1354`):
`collapse` → `COMPRESS_WHITESPACE_NEWLINE`; `preserve-breaks` → `COMPRESS_WHITESPACE`; `preserve`, `preserve-spaces`,
`break-spaces` → `COMPRESS_NONE`, or `COMPRESS_NONE_TRANSFORM_TO_SPACE` when newlines are suppressed.

The transform (`layout/generic/nsTextFrameUtils.cpp:211-401`):

- **Discarded in every mode**: U+00AD SHY (sets the `HasShy` flag), and in 16-bit text the bidi controls
  (`:32-49`). The skipped characters stay in the DOM offsets but not in the text run.
- **COMPRESS_NONE**: keep everything else. A tab sets `HasTab`; a newline sets `HasNewline` (`:222-271`). The
  "in white space" state for the next run is cleared (`:271`).
- **Collapse modes**: a run of spaces, tabs and newlines (plus discardables inside it) is processed as a unit
  (`:320-367`, `TransformWhiteSpaces` at `:84-209`):
  - spaces and tabs next to a newline are removed (`:151-158`);
  - otherwise the first space or tab becomes one U+0020 and the rest are removed; a space already carried in from the
    previous run removes the first one too (`:160-165, :286`);
  - `COMPRESS_WHITESPACE` (pre-line) keeps the newline as is (`:169-179`);
  - `COMPRESS_WHITESPACE_NEWLINE` turns a newline into a space, or removes it when a ZWSP is next to it, when both
    neighbors are East-Asian wide/fullwidth/halfwidth and not Hangul, or for `ja`/`zh` language when either neighbor
    is East-Asian punctuation. Those neighbors must be inside the same run (`:97-141, :183-193`);
    - Measured in installed Firefox 156 on 2026-09-16 (CRITIC C9): the neighbors must be inside the same mapped flow,
      one text node. `<span>日本` newline `<span>語</span></span>` keeps the space (53.3333px = `日本 語`);
      `<span>日本` newline `語</span>` removes it (48px).
  - a space right before a combining mark is kept as a space (`:337-345`).
- **CR (U+000D)** is not white space here: it's kept as is in every mode and it ends the "in white space" state
  (`:169-179, :369-379`). **FF (U+000C)** and **VT (U+000B)** are ordinary characters for this transform.
- Only one bit, "in white space", carries from one mapped flow to the next (`nsTextFrame.cpp:1124-1125, :2223-2226`;
  `nsTextFrameUtils.cpp:382-386`). This gives the per-direction-run rule the groundwork ported: text at a different
  bidi level is a different text run, so newline removal can't look across the run edge, while space collapsing still
  can.

### 3.4 Characters with no width

- `gfxFontGroup::IsInvalidChar`: C0 and C1 controls (tab and LF included), U+200B, U+2028, U+2029, U+2060, U+FEFF and
  bidi controls (`gfx/thebes/gfxTextRun.h:971-992`). They end shaping words and get no glyph (`gfxFont.cpp:3872-3897`):
  - a tab sets the tab flag and a newline the newline flag (`:3877-3880`);
  - a format character (general category Cf) is marked as a formatting control (`:3881-3882`);
  - another control character becomes a hexbox only if control characters are visible (`:3883-3892`). CR never is
    (`gfxFont.cpp:3625-3627`).
- On release builds control characters are hidden. `layout.css.control-characters.visible` is
  `@IS_NOT_RELEASE_OR_BETA@` (`StaticPrefList.yaml:10927-10930`), so `-moz-control-character-visibility` starts as
  `hidden` (`servo/components/style/values/specified/text.rs:932-940`; `longhands.toml:2518-2524`), which sets
  `TEXT_HIDE_CONTROL_CHARACTERS` (`nsLayoutUtils.cpp:6905-6908`).
  - Net: in the DOM, CR, FF and VT are zero-width wherever the transform kept them.

### 3.5 Shaping units, cluster and space flags

- `gfxFont::SplitAndInitTextRun` shapes separately each "word" between U+0020/U+00A0 (not followed by a cluster
  extender) and invalid characters (`gfxFont.cpp:3708-3900`). Words over 32 UTF-16 units skip the word cache
  (`gfx.font_rendering.wordcache.charlimit`, `StaticPrefList.yaml:7931-7934`; `gfxFont.cpp:3736-3739, :3804-3811`)
  but use the same shaper.
- Exception: if the font's default lookups involve the space glyph, the whole run is shaped at once, spaces included
  (`gfxFont.cpp:3743-3763`).
- `gfxShapedText::SetupClusterBoundaries` (`gfxFont.cpp:708-769`, 8-bit `:771-795`), run on every shaped word and
  fragment (`gfx/thebes/gfxFont.h:1462, :1477`; `gfxFont.cpp:3577`):
  - marks grapheme cluster continuations;
  - sets the "is space" flag for U+0020 **and U+3000** (`:732, :749-750`);
  - sets `FLAG_BREAK_TYPE_EMERGENCY_WRAP` before a letter or number that follows `- ‐ ‒ – ֊` preceded by a letter or
    number (`:741-753`; `dom/base/nsContentUtils.cpp:2231-2235, :2246-2254`).
- The simple space-glyph path sets "is space" only for U+0020 (`gfxTextRun.cpp:1617-1618`).

### 3.6 Break flags the line loop reads (summary)

- The line breaker (`dom/base/nsLineBreaker.cpp`) receives each mapped flow's transformed text with flags from
  `SetupBreakSinksForTextRun` (`nsTextFrame.cpp:2889-2998`):
  - `BREAK_SUPPRESS_INITIAL` when the nearest common ancestor with the previous text can't wrap (`:2953-2961`);
  - `BREAK_SUPPRESS_INSIDE` when this frame can't wrap (`:2962-2966`).
- A word keeps growing across `AppendText` calls, so across frames and text runs, until U+0020, TAB or CR
  (`nsLineBreaker.cpp:242-270`; `nsLineBreaker.h:260-264`).
- The break before the first non-space after breakable spaces is `NORMAL` (`nsLineBreaker.cpp:321-331`). Breaks inside
  words come from ICU4X or from `word-break: break-all` / `line-break: anywhere` (`:150-164, :324-348`).
- Suppression is applied when a word is flushed (`:190-198`).
- `gfxTextRun::SetPotentialLineBreaks` drops a break before a non-cluster-start unless the previous character is a
  space. It never clears an emergency flag already present, but a `NORMAL` flag overwrites it
  (`gfxTextRun.cpp:210-236`; `gfxFont.h:923-936`).
- `HasTrailingBreak` is set on the last text run before a non-text frame or the end of the block when the line breaker
  ended on breakable space (`nsTextFrame.cpp:1835-1848`; `nsLineBreaker.cpp:710-720`).
- Non-text frames flush the line breaker (`nsTextFrame.cpp:2246-2273`). Inline frames continue text runs
  (`layout/generic/nsInlineFrame.cpp:471-474`).

## 4. The line loop

Pseudo-code is TypeScript-shaped. `au` values are integers. Names follow Gecko where that helps a reader of the
source.

### 4.1 Block: one line, possibly twice

`nsBlockFrame::ReflowInlineFrames` (`nsBlockFrame.cpp:5123-5199`) and `DoReflowInlineFrames` (`:5232-5476`):

```ts
function reflowLine(block, lineStart): LineResult {
  let force: {frame, offset} | null = null
  while (true) {
    const ll = new LineLayout(block, lineStart)              // nsLineLayout, fresh per pass (:5159-5161)
    if (force) ll.forceBreakFrame = force                    // ForceBreakAtPosition (:5162-5164)
    const status = doReflowInlineFrames(ll)                   // :5165-5167
    if (status === 'RedoNoPull') {                            // :5170-5194
      force = ll.needBackup ? ll.lastOptionalBreak : null     // GetLastOptionalBreakPosition (:5173-5183)
      continue                                                // second pass cannot back up again (:5364-5370)
    }
    return placeLine(ll)                                      // PlaceLine (:5438-5445)
  }
}

function doReflowInlineFrames(ll): Status {
  ll.beginLineReflow(contentBoxIStart, availISize)            // :5270-5273
  let status = 'OK'
  for (const frame of lineFrames) {                           // :5304-5355 (existing children, then pulled frames)
    status = reflowInlineFrame(ll, frame)                     // :5486-5620
    if (status !== 'OK') break
  }
  const needsBackup = ll.needBackup && (status === 'Stop' || status === 'OK')
                      && !ll.forceBreakFrame                   // :5361-5370
  if (needsBackup && ll.lastOptionalBreakFrame) return 'RedoNoPull'   // :5371-5379
  ll.clearOptionalBreakPosition()                             // :5380-5384
  return status
}
```

`reflowInlineFrame` maps a frame's status onto the line (`nsBlockFrame.cpp:5539-5620`):
- break-before on a frame that isn't the line's first child: split the line before it and mark the line wrapped
  if the frame was pushed (`:5547-5566`);
- break-after: split after it (`:5567-5595`);
- incomplete (a text frame that broke inside): create a continuation for the rest, mark the line wrapped unless it
  ended in a forced newline, and split after the frame (`:5598-5619`).

### 4.2 Line state

`nsLineLayout::BeginLineReflow` (`nsLineLayout.cpp:107-221`):

```ts
psd.iStart = aICoord; psd.iCoord = aICoord; psd.iEnd = aICoord + aISize   // :162-164
psd.inset = 0            // text-wrap: balance only (:167)
psd.noWrap = !wrapMode   // :172
lineIsEmpty = true; lineAtStart = true; totalPlacedFrames = 0             // :143-150
if (text-indent applies to this line) psd.iCoord += resolve(textIndent, containerISize)   // :178-201
// optional-break state starts empty: frame null, offset -1, priority eNoBreak (nsLineLayout.h:382, :552-554)
lineIsBreakable = () => totalPlacedFrames > 0 || impactedByFloats          // nsLineLayout.h:151-155
```

An inline element opens a child span (`nsInlineFrame::ReflowFrames`, `nsInlineFrame.cpp:489-688`;
`nsLineLayout::BeginSpan`, `nsLineLayout.cpp:378-414`):

```ts
startEdge = (first continuation || box-decoration-break: clone) ? borderPaddingStart : 0     // :503-513
avail = availableSpaceOnLine - startMargin - startEdge - borderPaddingEnd                     // :514-519; nsLineLayout.cpp:813-815, :1116-1129
child span: iStart = iCoord = startEdge; iEnd = startEdge + avail                             // :520-521
child span noWrap = !WhiteSpaceCanWrap(span)                                                  // nsLineLayout.cpp:407-408
// ... reflow children with ReflowFrame against the child span ...
spanISize = iCoord - iStart (+ borderPaddingStart if first) (+ borderPaddingEnd if complete and last)   // :643-674
```

The end border and padding are subtracted from the children's space on **every** line the span occupies, even where
the span continues onto the next line (`nsInlineFrame.cpp:518-519`). The end margin counts only on the span's last
fragment (`nsLineLayout.cpp:1217-1224`).

### 4.3 ReflowFrame

`nsLineLayout::ReflowFrame` (`nsLineLayout.cpp:733-1092`):

```ts
function reflowFrame(ll, frame): {status, pushed} {
  const psd = ll.currentSpan
  pfd.iStart = psd.iCoord                                          // :772
  const notSafeToBreak = ll.lineIsEmpty && !ll.impactedByFloats     // :785
  const availableSpaceOnLine = psd.iEnd - psd.iCoord - psd.inset    // :798 (may be negative)
  const saved = ll.lastOptionalBreak                                // :857-860
  const status = isText ? reflowText(ll, frame, availableSpaceOnLine)   // :866-869
                        : reflowInlineChildren(...)                     // :863-864
  const isEmpty = isText ? !frame.hasNoncollapsedCharacters : spanIsEmpty   // :908-930
  if (status.breakBefore) { pushFrame(); return {status, pushed: true} }    // :1081-1084
  if (!frame.canContinueTextRun && !pfd.skipWhenTrimming) ll.trimmableISize = 0   // :1015-1020
  if (canPlaceFrame(ll, pfd, notSafeToBreak, isTextOrInline, status)) {    // :1029-1031
    if (!isEmpty) { psd.hasNonemptyContent = true; ll.lineIsEmpty = false
                    if (!pfd.span) ll.lineAtStart = false }                  // :1032-1038
    psd.iCoord = pfd.iEnd + pfd.endMargin; if (!placeholder) ll.totalPlacedFrames++   // PlaceFrame :1391-1403
    // non-text-run frames (e.g. <br>) record an optional break after themselves (:1057-1071)
  } else {
    pushFrame(); ll.restoreSavedBreakPosition(saved)                   // :1072-1079
  }
}

function canPlaceFrame(ll, pfd, notSafeToBreak, canContinueTextRun, status): boolean {   // :1189-1342
  if (status.incomplete || nonLastFragment) pfd.endMargin = 0         // :1217-1224
  pfd.iStart += pfd.startMargin                                       // :1227-1230
  if (psd.noWrap) return true                                         // :1233-1236
  const outside = pfd.iEnd - ll.trimmableISize + pfd.endMargin > psd.iEnd    // :1251-1252
  if (!outside) return true
  if (pfd.startMargin + pfd.iSize + pfd.endMargin === 0) return true  // :1264-1270
  if (frame is <br>) return true                                      // :1273-1278
  if (notSafeToBreak) return true                                     // :1280-1293
  if (pfd.span?.containsFloat) return true                            // :1296-1321
  if (canContinueTextRun) { ll.needBackup = true; return true }       // :1323-1335
  status.setBreakBeforeAndReset(); return false                       // :1340-1341
}
```

Text frames never take the last branch, so a text frame (or inline span) is always placed. Overflow is fixed by
backup instead.

### 4.4 ReflowText

`nsTextFrame::ReflowText` (`nsTextFrame.cpp:10847-11532`), the parts that change line results:

```ts
function reflowText(ll, frame, availableSpaceOnLine /* au */) {
  const maxContentLength = frame.inFlowContentLength                   // :10888
  if (maxContentLength === 0) return zeroMetrics()                    // :10893-10896
  const atStartOfLine = ll.lineAtStart; if (atStartOfLine) frame.TEXT_START_OF_LINE = true   // :10904-10907
  let offset = frame.contentOffset, length = maxContentLength
  let newLineOffset = -1
  if (NewlineIsSignificant(frame)) {                                   // :10919-10933; :10778-10799
    const nl = indexOf('\n', content, offset)
    if (nl >= 0 && nl < offset + length) { newLineOffset = nl; length = nl + 1 - offset }
  }
  if (atStartOfLine && !WhiteSpaceIsSignificant) {                     // :10935-10951
    const n = countTrimmableWhitespace(content, offset, newLineOffset >= 0 ? length - 1 : length)
    offset += n; length -= n
  }
  if (length === 0) return zeroMetrics()                               // :10953-10957

  const xOffsetForTabs = textRun.HasTab                                // :11063-11067
    ? ll.currentFrameInlineDistanceFromBlock() - lineContainer.borderPaddingLeft : -1
  let limitLength = length
  let forceBreak = ll.forcedBreakPosition(frame)                       // :11084-11094
  let forceBreakAfter = false
  if (forceBreak >= length) { forceBreakAfter = forceBreak === length; forceBreak = -1 }
  if (forceBreak >= 0) limitLength = forceBreak
  const [tStart, tLength] = transformedRange(offset, limitLength)      // :11097-11111

  const availWidth = availableSpaceOnLine                              // :11116 (double)
  const canTrim = !WhiteSpaceIsSignificant                             // :11122-11123
  const isBreakSpaces = collapse === 'break-spaces'                    // :11124-11125
  const whitespaceCanHang = WhiteSpaceCanHangOrVisuallyCollapse        // :11127
  let breakPriority = ll.lastOptionalBreakPriority                     // :11128
  const suppress = ShouldSuppressLineBreak(frame) ? 'all'
                 : !ll.lineIsBreakable() ? 'initial' : 'none'          // :11129-11135
  const r = breakAndMeasureText(tStart, tLength, frame.TEXT_START_OF_LINE, availWidth, provider, suppress,
                                WordCanWrap(frame), WhiteSpaceCanWrap(frame), isBreakSpaces,
                                /*wantTrimmable*/ canTrim || whitespaceCanHang, breakPriority)   // :11136-11145
  breakPriority = r.breakPriority
  let charsFit = originalOffset(tStart + r.charsFit) - offset          // :11162-11164
  if (offset + charsFit === newLineOffset) charsFit++                  // :11165-11171
  let lastBreak = -1, usedHyphenation = r.usedHyphenation
  if (charsFit >= limitLength) {                                       // :11175-11191
    charsFit = limitLength
    if (r.lastBreak !== UINT32_MAX) lastBreak = originalOffset(tStart + r.lastBreak)
    if ((forceBreak >= 0 || forceBreakAfter) && softHyphenBefore(offset + charsFit)) usedHyphenation = true
  }
  let advance = r.metrics.advanceWidth
  if (usedHyphenation) advance += hyphenRun.measureText().advanceWidth // AddHyphenToMetrics :11192-11197; :6829-6845
  const brokeText = forceBreak >= 0 || r.charsFit < tLength            // :11202
  let trimmable = r.trimmableAdvance                                   // float32
  if (trimmable > 0) {                                                 // :11203-11240
    if (canTrim) {
      if (brokeText) { advance -= trimmable; trimmable = 0; frame.TEXT_TRIMMED_TRAILING_WHITESPACE = true }
    } else if (whitespaceCanHang) {
      const hang = Math.min(Math.max(0, advance - availWidth), trimmable)
      frame.hangableISize = roundHalfUp(trimmable - hang)              // NSToCoordRound
      advance -= hang; trimmable = 0
    }
  }
  if (!brokeText && lastBreak >= 0)                                    // :11242-11251
    ll.notifyOptionalBreakPosition(frame, lastBreak - offset, true, breakPriority)
  const contentLength = offset + charsFit - frame.contentOffset        // :11253
  const width = Math.ceil(Math.max(0, advance))                        // :11272-11273
  if (r.charsFit > 0) { ll.trimmableISize = Math.floor(trimmable); frame.hasNoncollapsed = true }   // :11426-11429
  let breakAfter = forceBreakAfter
  if (suppress !== 'all') {                                            // :11431-11462
    if (charsFit > 0 && charsFit === length && hyphens !== 'none' && softHyphenBefore(offset + charsFit))
      ll.notifyOptionalBreakPosition(frame, length, advance + provider.hyphenWidth() <= availWidth, 'normal')
    if (!breakAfter && charsFit === length && !(atStartOfLine && length === 0)
        && tStart + tLength === textRun.length && textRun.HasTrailingBreak) {
      if (advance - trimmable > availWidth) breakAfter = true
      else ll.notifyOptionalBreakPosition(frame, length, true, 'normal')
    }
  }
  const status = {}
  if (contentLength !== maxContentLength) status.incomplete = true     // :11465-11467
  if (charsFit === 0 && length > 0 && !usedHyphenation) status.breakBefore = true         // :11469-11471
  else if (contentLength > 0 && frame.contentOffset + contentLength - 1 === newLineOffset) {
    status.breakAfter = true; ll.lineEndsInBR = true }                 // :11472-11476
  else if (breakAfter) status.breakAfter = true                        // :11477-11479
  if (brokeText && breakPriority === 'wordWrap') ll.usedOverflowWrap = true   // :11484-11486
  frame.setLength(contentLength)                                       // :11523 (the rest goes to a continuation)
  return {status, width}
}
```

`countTrimmableWhitespace` is `GetTrimmableWhitespaceCount` (`nsTextFrame.cpp:967-996`). In 16-bit text it counts
U+0020 and U+1680 (unless a combining mark follows), TAB, FF, LF and CR (`:904-913`). 8-bit text counts space, TAB,
FF, LF and CR (`:917-919`).

### 4.5 BreakAndMeasureText

`gfxTextRun::BreakAndMeasureText` (`gfx/thebes/gfxTextRun.cpp:922-1212`), with `hyphens: auto` rescanning left out:

```ts
function breakAndMeasureText(aStart, aMaxLength, aLineBreakBefore, aWidth, provider, suppress,
                             canWordWrap, canWhitespaceWrap, isBreakSpaces, wantTrimmable, breakPriority) {
  aMaxLength = Math.min(aMaxLength, textRun.length - aStart)               // :932
  const spacing = provider.getSpacing(range)   // only when TEXT_ENABLE_SPACING (:940-943, :1020-1022)
  const haveHyph = suppress !== 'all' && (hyphens === 'auto'
                   || (hyphens === 'manual' && textRun.TEXT_ENABLE_HYPHEN_BREAKS))   // :954-958
  let width = 0, advance = 0, trimmableChars = 0, trimmableAdvance = 0
  let lastBreak = -1, lb = {chars: -1, adv: -1, hyph: false}
  let cand = {brk: -1, chars: -1, adv: -1, hyph: false, prio: 'none'}
  const end = aStart + aMaxLength
  const lig = shrinkToLigatureBoundaries(aStart, end)                     // :988-989
  let aborted = false
  for (let i = aStart; i < end; i++) {                                    // :1004
    if (suppress !== 'all' && (suppress !== 'initial' || i > aStart)) {   // :1051-1052
      const atNatural = g[i].canBreakBefore === NORMAL                    // :1053-1054
      const atHyph = !atNatural && haveHyph && (!aLineBreakBefore || i > aStart)
                     && hyphenBuffer[i - aStart] >= Soft                  // :1061-1063
      const atBreak = atNatural || atHyph
      const wordWrapping = (canWordWrap || (canWhitespaceWrap && g[i].canBreakBefore === EMERGENCY_WRAP))
                           && g[i].isClusterStart && breakPriority <= 'wordWrap'    // :1068-1074
      const wsWrapping = i > aStart && isBreakSpaces
                         && (g[i-1].isSpace || g[i-1].isTab || g[i-1].isNewline)    // :1076-1083
      if (atBreak || wordWrapping || wsWrapping) {
        const hyphenated = advance + (atHyph ? provider.hyphenWidth() : 0)          // :1086-1089
        if (lastBreak < 0 || width + hyphenated - trimmableAdvance <= aWidth) {     // :1091-1101
          lastBreak = i; lb = {chars: trimmableChars, adv: trimmableAdvance, hyph: atHyph}
          breakPriority = (atBreak || wsWrapping) ? 'normal' : 'wordWrap'
        }
        width += advance; advance = 0                                      // :1103-1104
        if (width - trimmableAdvance > aWidth) { aborted = true; break }  // :1105-1109
        if (wordWrapping || !atAutoHyphenWithManualInSameWord)            // :1122-1128
          cand = {brk: lastBreak, ...lb, prio: breakPriority}
      }
    }
    const charAdvance = (i >= lig.start && i < lig.end)
      ? textRun.getAdvanceForGlyph(i, provider.letterSpacing) + spacing[i].before + spacing[i].after
      : partialLigatureWidth(i, i + 1, provider)                          // :1139-1149
    advance += charAdvance                                                // :1151
    if (wantTrimmable) {                                                  // :1152-1160
      if (g[i].isSpace) { trimmableChars++; trimmableAdvance += charAdvance }
      else { trimmableChars = 0; trimmableAdvance = 0 }
    }
  }
  if (!aborted) width += advance                                         // :1163-1165
  let charsFit, usedHyphenation = false
  if (width - trimmableAdvance <= aWidth) charsFit = aMaxLength           // :1175-1176
  else if (lastBreak >= 0) {                                              // :1177-1188
    if (cand.brk >= 0 && cand.brk !== lastBreak) { lastBreak = cand.brk; lb = cand; breakPriority = cand.prio }
    charsFit = lastBreak - aStart; trimmableChars = lb.chars; trimmableAdvance = lb.adv; usedHyphenation = lb.hyph
  } else charsFit = aMaxLength                                            // :1189-1191
  const metrics = measureText(aStart, aStart + charsFit)                  // :1195-1196, includes trailing spaces
  const outLastBreak = charsFit === aMaxLength ? (lastBreak < 0 ? UINT32_MAX : lastBreak - aStart) : undefined   // :1203-1209
  return {charsFit, metrics, trimmableAdvance, usedHyphenation, lastBreak: outLastBreak, breakPriority}
}
```

Plain-language reading:

- The first break candidate on a frame is always recorded, even if it already overflows. A later candidate is
  recorded only while the text before it fits, with trailing spaces discounted.
- Scanning stops at the first candidate after which the text no longer fits. Widths between candidates are added in
  whole chunks, so a long word overflows as one unit until the next candidate.
- Only characters flagged "is space" (U+0020, and U+3000 within shaped words) count as trimmable. Tabs, NBSP and
  other Unicode spaces don't.
- `measureText` sums the same integer advances and spacing (`gfxTextRun.cpp:802-839`; `gfxFont.cpp:3074-3141`).
  Partial ligatures at the range ends take their integer shares.

### 4.6 Spacing provider

`nsTextFrame::PropertyProvider::GetSpacingInternal` (`nsTextFrame.cpp:4089-4295`) with the release pref
`layout.css.letter-spacing.model = 0` (`StaticPrefList.yaml:11041-11052`; switch at `nsTextFrame.cpp:4114-4133`):

```ts
for each unskipped character i of the range:
  spacing[i] = {before: 0, after: 0}
  if (letterSpacing !== 0 && canAddSpacingAfter(i) && !isCursiveScript(baseCharOfCluster(i)))   // :4202-4214
    spacing[i].after += letterSpacing
  if (wordSpacing !== 0 && isCSSWordSpacingSpace(originalChar(i)))                              // :4215-4226
    spacing[clusterEnd(i)].after += wordSpacing
  // text-autospace: only when enabled on the frame (:4231-4255)
if (textRun.HasTab) applyTabWidths(range)                                                        // :4261-4273

canAddSpacingAfter(i) =                                                                          // :3860-3873
  !(NewlineIsSignificant && g[i].isNewline) &&
  (i + 1 >= textRun.length || (g[i+1].isClusterStart && g[i+1].isLigatureGroupStart
                               && !g[i].isFormattingControl && !g[i].isTab))
isCSSWordSpacingSpace(ch) =                                                                      // :880-898
  ch === ' ' || ch === NBSP ? !combiningMarkFollows
  : ch === '\r' || ch === '\t' ? !WhiteSpaceIsSignificant
  : ch === '\n' ? !NewlineIsSignificant : false
```

- `letterSpacing = ResolveLetterSpacing(frame)`: a length in au, or a percentage of the font size in au, truncated
  (`nsTextFrame.cpp:1949-1963`). Cursive scripts are Arabic, Syriac, NKo, Mandaic, Mongolian, Phags-pa and Hanifi
  Rohingya (`intl/components/src/UnicodeProperties.h`, cited by the groundwork at 155; not re-read here).
- `wordSpacing = ResolveWordSpacing(frame)`: a length, or a percentage **of the font size** in au, truncated
  (`nsTextFrame.cpp:1966-1980`).
- Letter spacing is added after the last character on a line too; nothing removes it at a line end.
- A trailing space's trimmable advance includes its letter spacing and word spacing (`gfxTextRun.cpp:1139-1156`).
- Non-zero letter spacing (after rounding to au) turns off optional ligatures (`nsLayoutUtils.cpp:6901-6904`).

Tabs (`nsTextFrame.cpp:3875-3906, :4298-4386, :1931-1937, :311-334`):

```ts
tabWidth = tab-size is a length ? toAppUnits(length)
         : N * (NSToCoordRound(spaceWidth_devpx(firstFontWithSpace(containingBlock)) * apd)
                + resolve(cb.letterSpacing, cb.emHeight) + resolve(cb.wordSpacing, spaceWidth))   // :3875-3906
minTabAdvance = 0.5 * NS_round(firstFont.ZeroOrAveCharWidth_devpx * apd)                           // :1931-1937
x = xOffsetForTabs            // distance from the block's content edge, including text-indent and earlier frames
for i in range:
  x += spacing(i).before
  if (!isTab(i)) { if (isClusterStart(i)) x += glyphAdvance(cluster(i)) }   // no provider: glyphs only (:4349-4358)
  else { next = ceil((x + minTabAdvance) / tabWidth) * tabWidth                                   // :4298-4304
         spacing[i].after += NSToIntRound(next - x); x = next }                                   // :4364-4369, :331
  x += spacing(i).after
```

A tab has no glyph and no letter spacing (sections 3.4 and 4.6). Tabs exist in the text run only under
`COMPRESS_NONE` (`nsTextFrameUtils.cpp:261-263`), so only `pre`, `pre-wrap` and `break-spaces` have tab stops.

Soft hyphens (`hyphens: manual`):

- `GetHyphenationBreaks` returns none unless the frame can wrap and `hyphens` isn't `none` (`nsTextFrame.cpp:4414-4418`).
- Otherwise it marks `Soft` before the first kept character after a skipped run ending in SHY, except at the frame
  start of a line-starting frame (`:4430-4456`).
- The hyphen run uses U+2010 if the first available font has it, else `-` (`gfxTextRun.cpp:2458-2474`).
- `GetHyphenWidth()` = hyphen run advance + letter spacing (`nsTextFrame.cpp:4388-4399`), used for fitting.
- The frame width adds the hyphen run's advance **without** letter spacing (`AddHyphenToMetrics`,
  `nsTextFrame.cpp:6829-6845`).

### 4.7 Optional break positions and backup

`nsLineLayout::NotifyOptionalBreakPosition` (`nsLineLayout.cpp:1495-1516`):

```ts
function notifyOptionalBreakPosition(frame, offset, fits, priority): boolean {
  if ((fits && priority >= ll.lastOptionalBreakPriority) || !ll.lastOptionalBreakFrame) {
    ll.lastOptionalBreakFrame = frame; ll.lastOptionalBreakFrameOffset = offset
    ll.lastOptionalBreakPriority = priority
  }
  return frame === ll.forceBreakFrame && offset === ll.forceBreakFrameOffset
}
```

- A text frame reports its last recorded break only when all of its text fit (`nsTextFrame.cpp:11242-11251`). It also
  reports a break after a trailing soft hyphen (`:11432-11440`) and after trailing breakable space at the end of a
  text run (`:11441-11461`).
- The first report on a line is kept even if it doesn't fit. After that, a report replaces the saved one only if it
  fits and its priority is at least as high.
- When a frame isn't placed, the saved position is restored to what it was before that frame (`nsLineLayout.cpp:1072-1079`).
- Backup: a text or inline frame that overflows sets `needBackup` and is placed anyway (`:1323-1335`). If the line
  then stops or runs out of frames with a saved position, the block redoes the line with
  `forceBreakFrame/Offset = saved` (`nsBlockFrame.cpp:5170-5194, :5361-5379`).
  - In the redo pass, `ReflowText` of that frame limits its length to the forced offset (`nsTextFrame.cpp:11084-11094`).
  - A forced offset equal to the frame length becomes "break after this frame", with the hyphen added if a soft
    hyphen precedes it (`:11087-11090, :11185-11190`).
  - A second backup is never attempted (`nsBlockFrame.cpp:5364-5370`).
- Example: `aa b<span style="color:red">bbbbb</span>` at 16px Courier New, width 57.6px (3456 au).
  - Frame 1 `aa b` fits (2304 au) and reports a break before `b` at offset 3.
  - Frame 2 `bbbbb` has no candidates, overflows (2304 + 2880 > 3456) and sets `needBackup`.
  - The redo forces the break at frame 1 offset 3. Lines: `aa` / `bbbbbb`.

### 4.8 Line end, line width, alignment

`nsBlockFrame::PlaceLine` calls `nsLineLayout::TrimTrailingWhiteSpace` first (`nsBlockFrame.cpp:5844`):

```ts
function trimTrailingWhiteSpaceIn(psd): {handled, delta} {                 // nsLineLayout.cpp:2851-2985
  for (pfd = last frame; pfd; pfd = pfd.prev) {
    if (pfd.span) { const r = trimTrailingWhiteSpaceIn(pfd.span)
                    if (r.handled) { pfd.iSize -= r.delta; psd.iCoord -= r.delta; return r } }
    else if (!pfd.isText && !pfd.skipWhenTrimming) return {handled: true, delta: 0}   // <br> and placeholders are skipped
    else if (pfd.isText) {
      const t = textFrame.trimTrailingWhiteSpace()                          // nsTextFrame.cpp:11540-11628
      if (t.delta) { pfd.iSize -= t.delta; psd.iCoord -= t.delta }
      if (pfd.isNonEmptyText || t.changed) return {handled: true, delta: t.delta}
    }
  }
  return {handled: false, delta: 0}
}

textFrame.trimTrailingWhiteSpace():                                        // :11540-11628
  if (!TEXT_TRIMMED_TRAILING_WHITESPACE && trimmedEnd < contentEnd)
    delta = textRun.getAdvanceWidth(trimmedEnd..contentEnd, provider)      // includes spacing (gfxTextRun.cpp:1214-1256)
  return floor(delta - 0)                                                  // SetLineBreaks is a no-op (:11595-11605)
```

- `trimmedEnd` comes from `GetTrimmedOffsets`, which trims only when white space isn't significant, using
  `IsTrimmableSpace` (U+0020, U+1680, TAB, FF, LF, CR) (`nsTextFrame.cpp:3287-3330, :904-919`).
  - **U+3000 is not trimmed here**, although `BreakAndMeasureText` counted it as trimmable. It's removed from a
    frame's width only when that frame broke inside itself (`:11203-11213`).
- Line box width = `psd.iCoord - psd.iStart` after trimming (`nsLineLayout.cpp:1784-1786`, empty lines `:1704-1705`).
  It includes text-indent, every placed frame's ceil width, inline border/padding/margins, the hyphen advance of a
  used soft hyphen, trailing letter spacing, and for `pre-wrap` the non-overflowing part of trailing spaces.
- `TextAlignLine` (`nsLineLayout.cpp:3482-3668`): `remainingISize = availISize - lineISize` (`:3493-3494`).
  - On a wrapped line, `hang = GetHangFrom(...)`, the frame's `hangableISize`, negated when the whitespace's
    direction is against the line (`:3505-3516, :3416-3448`).
  - right/end: `dx = remaining + max(hang, 0)`; center: `(remaining + hang) / 2` with integer division
    (`:3604-3629`). Bidi reordering happens here (`:3646-3652`).
- **Where the next line starts**: a text frame that broke keeps `offset + charsFit` characters (plus a newline it
  broke before) and a continuation frame maps the rest (`nsTextFrame.cpp:11165-11171, :11253, :11523`). The next line
  begins at that content offset, and its leading collapsible white space is skipped again (`:10935-10951`).
  - No measured remainder or reshaped piece carries over. The continuation measures its text from the same glyph
    records.

## 5. Branches by CSS feature

| Feature | What changes in the line loop | Source |
|---|---|---|
| `white-space: normal` | collapse; skip leading spaces at line start; spaces trimmable; wrap | 3.3; `nsTextFrame.cpp:10935-10951, :11122-11123` |
| `nowrap` | same transform; span `noWrap` so every frame fits; no breaks inside, no hyphen or emergency breaks | `nsLineLayout.cpp:172, :407-408, :1233-1236`; `nsTextFrame.cpp:2958-2966, :4414-4418`; `gfxTextRun.cpp:1068-1072` |
| `pre` | no collapse; newline ends the frame and the line; tabs have stops; no trimming; nowrap | `nsTextFrameUtils.cpp:222-271`; `nsTextFrame.cpp:10919-10933, :11472-11476` |
| `pre-wrap` | no collapse; no leading skip; trailing U+0020/U+3000 hang (only the overflowing part leaves the frame width); tabs don't hang | `nsTextFrame.cpp:11216-11230`; `gfxTextRun.cpp:1152-1160` |
| `pre-line` | spaces/tabs collapse, spaces next to a newline removed, newline forced; trimmed like normal | `nsTextFrameUtils.cpp:151-158, :169-179` |
| `break-spaces` | no collapse; break after every space, tab and newline; spaces neither trimmable nor hanging | `nsTextFrame.cpp:11124-11127, :11142`; `gfxTextRun.cpp:1076-1083` |
| `overflow-wrap: break-word` / `anywhere`, `word-break: break-word` | every cluster start is a word-wrap candidate while the line's priority ≤ wordWrap; identical in line filling (they differ only in min-content, `nsTextFrame.cpp:9951-9958`) | `gfxTextRun.cpp:1068-1074`; `nsStyleStruct.h:1303-1315, :1360-1367` |
| emergency wrap (default `overflow-wrap`) | cluster after `alnum` + hyphen + `alnum` is a word-wrap candidate when white space can wrap | `gfxFont.cpp:741-753`; `gfxTextRun.cpp:1069-1072` |
| `word-break: break-all / keep-all`, `line-break` | only through break flags (break-opportunity spec) | `nsLineBreaker.cpp:150-164, :324-348`; `nsTextFrame.cpp:2911-2941` |
| `hyphens: manual` | soft hyphens become candidates; hyphen width in fit; hyphen advance in frame width | 4.6 |
| `hyphens: none` | SHY still removed from the text run; no hyphen breaks | `nsTextFrame.cpp:4414-4418` |
| `letter-spacing` | after each cluster except cursive bases, tabs, formatting controls; kept at line end; disables optional ligatures | 4.6 |
| `word-spacing` | after U+0020, NBSP (and collapsed TAB/CR/LF); % of font size | 4.6 |
| `tab-size` | tab stops from the content edge; min advance half the `0` width | 4.6 |
| `text-transform` | measured text is the transformed string (for example `ß` → `SS`, full-width forms); different transforms split text runs | `nsTextFrame.cpp:2155-2158, :2626-2636`; `layout/generic/nsTextRunTransformations.cpp:209, :671, :787-788` |
| `direction`, bidi | frames split per directional run before line filling; each run is its own text run and own white-space context; lines fill in logical order and reorder afterwards | 1, 3.2, 3.3; `nsLineLayout.cpp:3646-3652` |
| `lang` (paragraph or span) | the font group's language (shaping, Common-script resolution); different `lang` splits text runs but not words; `ja`/`zh` newline removal; explicit `lang` feeds hyphenation | `nsTextFrame.cpp:2168-2169, :2495, :2898-2899`; `nsTextFrameUtils.cpp:273-285` |
| DPR / zoom | apd changes glyph rounding only at ties, `sbix` and variation widths, device-pixel synthesized spaces; lengths and fit arithmetic are unchanged | 2.1, 2.5, 2.6 |
| `text-indent` | added to the line's starting coordinate; tab origin includes it | `nsLineLayout.cpp:178-201`; `nsTextFrame.cpp:11063-11067` |
| inline margin/border/padding | start edge offsets children; end border+padding reserved on every line of the span; end margin only on the last fragment; non-zero values split text runs | 4.2; `nsTextFrame.cpp:2054-2137` |
| white-space-only text | no frame at a line boundary; elsewhere a frame whose text may collapse to nothing (placed with zero width, making the line breakable) | `nsCSSFrameConstructor.cpp:5263-5286`; `nsTextFrame.cpp:10953-10957`; `nsLineLayout.cpp:1391-1403` |
| CR, FF, VT | kept by the transform, zero width in the DOM; CR is a word boundary for the line breaker; all three are trimmable at line start/end when not significant | 3.3, 3.4; `nsLineBreaker.h:260-264`; `nsTextFrame.cpp:904-942` |

Measured in installed Firefox 156 on 2026-09-16: the last row is wrong for VT (CRITIC W3). `aaaa \vbbbbb` in 16px
Courier New at 57.6px gives line starts [0, 6]: VT is class BK, so the break comes after it, and it stays at the end
of line 1 with zero width. VT isn't trimmable (`nsTextFrame.cpp:904-919`), so the space before it isn't trimmed either:
right-aligned, line 1 starts at x 9.6 (48px wide).

## 6. "Firefox splits inside a word only while the line has no ordinary break"

- **Where**:
  - `ReflowText` passes the line's saved priority into `BreakAndMeasureText` (`nsTextFrame.cpp:11128`).
  - A cluster start is a word-wrap candidate only while `breakPriority <= eWordWrapBreak` (`gfxTextRun.cpp:1068-1074`).
  - Recording an ordinary break (normal, soft hyphen, break-spaces) raises the priority to `eNormalBreak`
    (`:1098-1100`).
  - The priority is line-wide: a frame that fit hands it to the line (`nsTextFrame.cpp:11249-11250`), and a
    lower-priority report can't replace a fitting higher one (`nsLineLayout.cpp:1508-1509`).
  - A new `nsLineLayout` starts each line at `eNoBreak` (`nsLineLayout.h:552`).
- **How, worked example**: `overflow-wrap: anywhere`, 16px Courier New (576 au per character), width 57.6px (3456 au),
  text `aa bbbbbbbbbb`.
  - Line 1: the break before `b` (i=3) is recorded, `1728 - 576 <= 3456`, priority → normal. From then on no cluster
    start is a candidate. At the end `width = 7488 > 3456` → `charsFit = 3` → line 1 is `aa`.
  - Line 2 starts at `eNoBreak` with the initial break suppressed. Cluster starts i=1..6 are recorded while
    `576*k <= 3456`, and scanning stops at i=7 → `bbbbbb`.
  - Line 3 is `bbbb`.
- The after-hyphen rule behaves the same way with default `overflow-wrap`: `x aaaa-1111` at width 57.6px gives `x` /
  `aaaa-` / `1111`. The emergency candidate before `1` is ignored on line 1 because the ordinary break after `x ` was
  already recorded.

## 7. The maintainer's ten facts, answered for Gecko

1. **Styled runs**: frames per element, text runs split by font/lang/spacing flags and box edges (3.2). The line
   breaker spans them all, so a bold `foo` + `bar` has no break (3.6). Backup handles a word that crosses a frame
   edge (4.7).
2. **Break data**: flags come from `nsLineBreaker` + ICU4X, plus Gecko's own after-hyphen emergency rule and cluster
   filtering (3.5, 3.6). The line loop only reads the flags.
3. **White space and control characters**: per-mapped-flow transform with one carried bit; CR, FF and VT kept but
   zero-width; white-space-only nodes at line boundaries get no frame (3.3, 3.4, 5).
4. **Filling structure**: a greedy scan per frame; first candidate always taken; stop at the first overflowing
   candidate; a line-wide break priority; one backup pass (4.3-4.7, 6). No reshaping, no carried remainder.
5. **Units**: integer au per glyph rounded once per glyph; integer spacing; exact `<=` / `>` comparisons in au (2).
6. **Widths known in advance**: every glyph width is fixed before lines are decided. Line-dependent additions are
   tab stops (depend on x), the hyphen at a used soft hyphen, trimming/hanging, and span end padding (4.6, 4.8).
7. **Direction, language, DPR**: bidi runs split before measuring; language picks shaping and newline rules; DPR
   barely matters (2.1, 5).
8. **Next line start**: a content offset only (4.8).
9. **Canvas gaps**: section 9.
10. **Checks**: section 10.

## 8. Runtime settings and prefs that are on and change results

| Pref / setting | Value at 156.0 release | Effect | Source |
|---|---|---|---|
| `gfx.font_rendering.coretext.enabled` | false (Darwin) | HarfBuzz shapes every font, AAT included | `StaticPrefList.yaml:7847-7853`; `gfxMacFont.cpp:156-157` |
| `layout.css.letter-spacing.model` | 0 (2 on Nightly) | spacing only after each cluster | `StaticPrefList.yaml:11041-11052`; `nsTextFrame.cpp:4114-4133` |
| `layout.css.control-characters.visible` | false on release | control characters invisible, zero width | `StaticPrefList.yaml:10927-10930`; `servo/.../specified/text.rs:932-940` |
| `gfx.font_rendering.wordcache.charlimit` | 32 | shaping path only; same results | `StaticPrefList.yaml:7931-7934` |
| `layout.css.text-autospace.enabled` | true | spacing only if `text-autospace` is set (initial value per groundwork: `no-autospace`, not re-read at 156) | `StaticPrefList.yaml:11330-11333`; `nsStyleStruct.h:1317-1322` |
| `browser.display.auto_quality_min_font_size` | 20 | sets `TEXT_OPTIMIZE_SPEED` below 20 device px; no advance change found | `StaticPrefList.yaml:1535-1538`; `nsLayoutUtils.cpp:6913-6920` |
| `layout.css.dpi`, `layout.css.devPixelsPerPx` | -1, -1.0 | system DPR used for apd | `StaticPrefList.yaml:10735-10738, :10871-10874`; `nsDeviceContext.cpp:65-106` |
| `layout.css.text-transform.uppercase-eszett.enabled` | false | `ß` uppercases to `SS` | `StaticPrefList.yaml:11323-11326`; `nsTextFrame.cpp:2628-2631` |
| `font.size.inflation.minTwips` | 0 | no font inflation on desktop | `StaticPrefList.yaml:6831-6834` |
| `layout.css.text-align.justify-only-after-last-tab` | true | justification only | `StaticPrefList.yaml:11353-11356` |

## 9. What Canvas can supply

Canvas path: a main-thread `new OffscreenCanvas()` has no pres shell (`dom/canvas/CanvasRenderingContext2D.cpp:2086-2093`).

- App units: `GetAppUnitsValues` gives apd 60 (`:7132-7155`).
- Font size: `fontStyle.size = QuantizeFontSize(size)` in CSS px, 7 significant bits (`:4207-4217, :4492`), with a font
  group at `devToCssSize = 1.0` (`:4585-4600`).
- Each bidi run goes through `gfxFontGroup::MakeTextRun`, the same `InitTextRun` → `SplitAndInitTextRun` → HarfBuzz
  path as layout (`:4836-4852`).
- Width: `NSToCoordRound(advanceWidth)` per run (`:4854-4869`), then `float(totalWidthCoord) / 60` (`:5277`).

**Exact from `measureText` totals** (`au = Math.round(width * 60)`, exact below about 139,000 px):

1. The integer au sum of a shaping unit (text between U+0020/U+00A0/invalid characters), for a font size that
   `QuantizeFontSize` leaves unchanged: 1/8 px steps from 8px to 16px, 1/4 px from 16px to 32px
   (PLATFORM_BUGS.md:45). The DOM computes the same per-glyph integers (2.5), except at float32 near-ties when apd ≠ 60.
2. A whole line string measured at once = the sum of its units, because spaces are unshaped and kerning doesn't cross
   them (`gfxFont.cpp:3781-3866`), unless the font lets spaces take part in shaping.
3. `W(' ') * 60` = the DOM's `NS_lroundf(spaceWidth * apd)` space advance at apd 60 (`gfxTextRun.cpp:1602-1603`).
4. Tracking and synthetic bold: same code, so they're included in unit totals.
5. Tab-stop inputs: `W(' ')` and `W('0')` (the `ZeroOrAveCharWidth` input when the font has `0`). Stops, min advance
   and `NSToIntRound` are then computed in JS (4.6).
6. Widths without optional ligatures: set `ctx.letterSpacing` to a value whose `NSToCoordRound(ls * 60)` is 0 (for
   example `0.001px`). Canvas then sets `TEXT_DISABLE_OPTIONAL_LIGATURES` and adds no spacing (`:5233-5242, :4796-4798`).
7. Language-dependent shaping: set `ctx.lang` to the span's language. Otherwise the canvas uses the root element's
   `lang`, then the OS locale (`:5423-5470`).

**Not obtainable from totals**:

1. Prefix widths inside a unit, needed at emergency, `overflow-wrap`, break-all, CJK and soft-hyphen breaks. The DOM
   sums per-character advances from one shaping of the whole unit. A separately measured prefix loses kerning with the
   next glyph and changes contextual forms. `W(unit) - W(suffix)` is exact when the suffix's shaping doesn't depend
   on what precedes it (GPOS pair kerning lands on the left glyph). Arabic joining, contextual alternates and legacy
   `kern` break that. Groundwork measured recipe losses: `results-gecko-canvas-only.txt`.
2. Partial-ligature shares at frame or line edges: the page can't see ligature grouping (`gfxTextRun.cpp:238-322`;
   groundwork attributed 579 rows to this).
3. Letter spacing for cursive scripts: Canvas adds `NSToCoordRound(ls*apd)` after every cluster end, all scripts, and
   to the left in RTL (`:4759-4790`). The DOM skips cursive bases, tabs and formatting controls.
4. Word spacing: Canvas adds it after "is space" characters, U+0020 and U+3000 (`:4780-4786`). The DOM adds it after
   U+0020 and NBSP, not U+3000. Compute it in JS.
5. CR, FF, VT, TAB, LF, U+001C..U+001F, U+0085, U+2029: Canvas turns them into spaces (`:4634-4637`). The DOM keeps
   CR/FF/VT at zero width, turns tabs into stops or collapses them, and LF per white-space.
6. The hyphen glyph: U+2010 if the first font maps it, else `-` (`gfxTextRun.cpp:2464-2473`). A canvas measuring
   U+2010 falls back silently to another font, so the page can't tell which case applies.
   - Measured in installed Firefox 156 on 2026-09-16, with the source read: there is no silent fallback. Gecko's
     HarfBuzz nominal-glyph callback substitutes `-` for U+2010 and U+2011 when the font lacks them
     (`gfxHarfBuzzShaper.cpp:119-124`), and font matching falls back to `-` in the primary font
     (`gfxTextRun.cpp:3227-3229`). Georgia has no U+2010, and OC `'‐'` = 5.9833px = 359 au = `-` with either generic
     after it. So `au('‐')` gives the hyphen run's advance whenever the first font has U+2010 or `-`.
7. Font sizes not representable in 7 bits (for example 14.4px → 14.375px): no exact scaling back.
8. `sbix` emoji: Core Text at the device size in the DOM vs CSS size in canvas (`gfxMacFont.cpp:448-462`;
   PLATFORM_BUGS.md:12).
9. `system-ui`: resolves to a different font (PLATFORM_BUGS.md:14).
10. Synthesized widths for Unicode spaces no font has, at DPR ≠ 1 (`gfxTextRun.cpp:3032-3043`).
11. Glyph rounding at apd ≠ 60 near ties: a tie-level difference per glyph at most (2.5). Not expected for the probe
    fonts.

## 10. Hypotheses to probe in installed Firefox 156.0

Common setup unless stated:
- `<!doctype html><html lang="en">`, a `<div>` with `font: 16px "Courier New"; line-height: 20px`, the stated
  `width`, `white-space: normal`, DPR 2.
- Courier New maps every ASCII character to 1229/2048 units, which is 576 au (9.6px). Its GPOS has only `mark/mkmk`.
- Line starts are read with `Range.getClientRects()` per character, as in `tests/wrapping/observe.ts:34-70`.
- Widths: the rect of an inline `<span>` wrapping the text, or the x of the first glyph with `text-align: right`.

1. **Fit uses `<=` in au.**
   - Probe: `aaaa bbbb`, width `86.4px` (5184 au) vs `86.38px` (5183 au).
   - Expected: 1 line at 86.4px; 2 lines (`aaaa` / `bbbb`) at 86.38px.
2. **Trailing spaces don't count.**
   - Probe: `aaaa bbbb cccc`, width `86.4px`.
   - Expected: 2 lines, `aaaa bbbb` / `cccc`.
3. **DPR and zoom don't move breaks.**
   - Probe: `font: 16px Georgia`, `aaaa bbbb` (4320 au = 72px), widths `72px` and `71.99px` (4319 au), at DPR 1, 1.5
     and 2 and full zoom 110% and 133%.
   - Expected: 1 line at 72px and 2 lines at 71.99px in every configuration.
4. **Letter spacing rounds to whole au per cluster and stays at the line end.**
   - Probe: `letter-spacing: 0.01px` (1 au), `aaaa bbbb` = 5184 + 9 = 5193 au, widths `86.55px` (5193 au) vs `86.5px`
     (5190 au).
   - Expected: 1 line vs 2 lines.
5. **Letter spacing after the last character is kept.**
   - Probe: `letter-spacing: 1px`, `aaaa bbbb` = 9 × 636 = 5724 au, widths `95.4px` vs `95.35px` (5721 au).
   - Expected: 1 line vs 2 lines.
6. **Percentage word spacing is relative to the font size.**
   - Probe: `word-spacing: 10%`, `aaaa bbbb` = 5184 + 96 = 5280 au, widths `88px` vs `87.95px` (5277 au).
   - Expected: 1 line vs 2 lines. A space-width basis would give 5241 au and 1 line at 87.95px.
7. **NBSP gets word spacing in the DOM; Canvas doesn't give it.**
   - Probe: `word-spacing: 10px`, `a b`, span rect width.
   - Expected: 38.8px. OffscreenCanvas with `ctx.font = '16px "Courier New"'; ctx.wordSpacing = '10px'` measures
     `a b` at 28.8px and `a b` at 38.8px.
8. **The after-hyphen emergency break is used only while the line has no ordinary break.**
   - Probe: width `57.6px`, text `x aaaa-1111`; then `aaaa-1111` alone; then `aaaa-1111` with `white-space: nowrap`.
   - Expected: `x` / `aaaa-` / `1111`; then `aaaa-` / `1111`; then 1 overflowing line.
9. **overflow-wrap splits a word only on a line without an ordinary break.**
   - Probe: `overflow-wrap: anywhere`, width `57.6px`, `aa bbbbbbbbbb`.
   - Expected: line starts at indices 0, 3 and 9. Same result with `break-word`.
10. **Backup across a span edge.**
    - Probe: width `57.6px`, `aa b<span style="color:red">bbbbb</span>`.
    - Expected: 2 lines, `aa` / `bbbbbb`; the second line starts at the `b` at index 3.
11. **No break between styled runs.**
    - Probe: width `28.8px`, `<b>foo</b>bar`.
    - Expected: 1 line; the text overflows (`bar` on the same line as `foo`).
12. **Inline end padding shrinks the space on every line of the span.**
    - Probe: width `57.6px`, `<span style="padding-right:9.6px">aaa aaa b</span>`; control without the padding.
    - Expected: `aaa` / `aaa b` with padding; `aaa aaa` / `b` without.
    - Measured in installed Firefox 156 on 2026-09-16 (refuted control): at 57.6px (3456 au) `aaa aaa` is 4032 au and
      can't fit, so both elements give `aaa` / `aaa b`. At 67.2px (4032 au) the claim holds: with padding `aaa` /
      `aaa b`, without `aaa aaa` / `b`. Use 67.2px.
13. **pre-wrap hangs only the overflowing part.**
    - Probe: `white-space: pre-wrap; text-align: right`, width `57.6px`, `aaaa   bb` (three spaces).
    - Expected: lines `aaaa   ` / `bb`. The first `a` sits at x = 19.2px (1152 au = hangable 1728 − 576).
14. **break-spaces moves the third space to line 2.**
    - Probe: `white-space: break-spaces`, width `57.6px`, `aaaa   bb`.
    - Expected: line 1 holds `aaaa` + 2 spaces; line 2 starts with a space at index 6.
15. **Tab stops.**
    - Probe: `white-space: pre`, default `tab-size: 8` (stop 4608 au, min advance 288 au); report the x of `b`.
    - Expected:
      - `a\tb` → 76.8px;
      - `aaaaaaa\tb` → 76.8px;
      - `aaaaaaaa\tb` → 153.6px;
      - `a\tb` with `text-indent: 57.6px` → 76.8px.
16. **The hyphen's letter spacing counts for fit but not for width.**
    - Probe: `hyphens: manual; letter-spacing: 1px`, width `53px` (3180 au), `<span>aaaa&shy;bbbb</span>`.
    - Expected: 2 lines, `aaaa-` / `bbbb`. The span's first rect is 52px wide (4 × 636 + 576 au), not 53px.
17. **U+3000 is trimmed only when the frame broke inside itself.**
    - Probe: `font: 16px "Hiragino Sans"`, width `48px`, `text-align: right`. First confirm with Canvas that あ, い and
      U+3000 are each 16px.
      - (A) `ああ　いい`
      - (B) `ああ　<span style="color:red">いい</span>`
    - Expected: both give 2 lines. Line 1's first あ is at x = 16px in (A) (width 32px) and x = 0 in (B) (width 48px).
18. **CR, FF and VT are zero-width in the DOM.**
    - Probe: `a\rb`, `ab`, `ab` in spans; `a \r b` vs `a  b`.
    - Expected: each span is 19.2px wide (OffscreenCanvas gives 28.8px). `a \r b` is 38.4px because both spaces are
      kept; `a  b` is 28.8px.
19. **Canvas totals are exact integers at apd 60.**
    - Probe: OffscreenCanvas `ctx.font = '16px Georgia'`, `measureText('aaaa bbbb').width * 60`.
    - Expected: within 1e-3 of 4320. `'16px "Courier New"'` → 5184.
20. **Canvas font-size quantization moves breaks.**
    - Probe: `font: 14.4px Georgia`, `aaaa bbbb`, width `64.7px` (3882 au).
    - Expected: DOM 2 lines (DOM sum 3884 au). OffscreenCanvas at `14.4px Georgia` measures 3880 au (size 14.375px),
      which would predict 1 line.
21. **Cursive scripts get no letter spacing in the DOM.**
    - Probe: `font: 16px "Geeza Pro"; letter-spacing: 2px`, `<span>بببب</span>`.
    - Expected: the span width equals OffscreenCanvas `measureText('بببب')` with `ctx.letterSpacing = '0.001px'`.
      Canvas with `'2px'` is 8px wider.
22. **A soft hyphen at a frame end plus backup.**
    - Probe: width `57.6px`, `aaaa&shy;<span style="color:red">bbbb</span>`.
    - Expected: `aaaa-` / `bbbb`, the same as without the span.
23. **The first candidate is taken even when it overflows.**
    - Probe: width `57.6px`, `aaaaaaaa bb`.
    - Expected: line 1 `aaaaaaaa` extends to 76.8px; line 2 `bb`.
24. **pre-line removes spaces around a newline.**
    - Probe: `white-space: pre-line`, `<span>aaaa \n bb</span>`.
    - Expected: 2 lines; the span's first rect is 38.4px wide.

## 11. Differences from the groundwork (checked at 156.0)

1. **Revision.** The groundwork read `FIREFOX_155_0_1_RELEASE` (fb95137a). At 156.0:
   - HarfBuzz is 14.3.1, not 14.3.0 (`gfx/harfbuzz/moz.yaml:23, :27`);
   - the layout line numbers it cited are unchanged (for example `gfxTextRun.cpp:922-1212`,
     `nsTextFrame.cpp:11136-11145`, `nsLineLayout.cpp:798, :1251-1252`);
   - Canvas and pref line numbers moved:

   | Item | 155 (groundwork) | 156 |
   |---|---|---|
   | `QuantizeFontSize` | `4203-4213` | `4207-4217` |
   | `GetAppUnitsValues` | `7068-7091` | `7132-7155` |
   | `TextReplaceWhitespaceCharacters` | `4570-4573` | `4634-4637` |
   | Canvas `GetSpacing` | `4695-4726` | `4759-4790` |
   | Canvas `GetWidth` | `4790-4805` | `4854-4869` |
   | letter/word spacing setup | `5169-5178` | `5233-5242` |
   | `totalWidth` | `5213` | `5277` |
   | `ResolveFontLang` | `5359-5406` | `5423-5470` |
   | CoreText pref | `7841-7847` | `7847-7853` |
   | word cache pref | `7926-7929` | `7931-7934` |
   | letter-spacing model pref | `11009-11020` | `11041-11052` |
   | `ShouldRoundXOffset` | `562-566` | `566-569` |

2. **Control characters.** The groundwork said invalid controls become hexboxes. On release 156 control characters
   start hidden (8, 3.4), so FF and VT get zero width. CR is never a hexbox (`gfxFont.cpp:3625-3627`).
3. **Canvas word spacing.** The groundwork said "after each U+0020". It applies to every "is space" glyph, which
   includes U+3000 (`CanvasRenderingContext2D.cpp:4780-4786`; `gfxFont.cpp:749-750`), and the DOM rule differs
   (NBSP yes, U+3000 no).
4. **U+3000.** Confirmed as trimmable in `BreakAndMeasureText`. New: `TrimTrailingWhiteSpace` doesn't trim it, so line
   width depends on whether the frame broke inside itself (4.8, H17).
5. **Hyphen and letter spacing.** New: the fit check adds letter spacing to the hyphen (`nsTextFrame.cpp:4398`), while
   the frame width adds the bare hyphen advance (`:6829-6845`).
6. **Types.** New precision: `TrimmableWS::mAdvance` is float32 (`gfxTextRun.h:403-406`) and `gfxFont::Spacing` holds
   `nscoord` (`gfxFont.h:1767-1770`). Integer inputs keep everything exact.
7. **apd with zoom.** Confirmed `max(1, NSToIntRound(float(apd0)/zoom))`, and the zoom is re-derived from the rounded
   apd (`nsDeviceContext.cpp:57-63, :410-415`).
8. **Emulator port** (`emulate/gecko-fallback-v2/emulate.py`). Branches that exist at 156 but the port doesn't take:
   - `whitespaceCanHang` is forced true (false for nowrap and break-spaces, `nsStyleStruct.h:1330-1337`);
   - no nowrap spans (`nsLineLayout.cpp:1233-1236`);
   - no inline margins/border/padding (`nsInlineFrame.cpp:503-521`; `nsLineLayout.cpp:1217-1264`);
   - no text-indent (`nsLineLayout.cpp:178-201`);
   - no break-spaces (`gfxTextRun.cpp:1076-1083`);
   - a trailing break only on the last frame of one text node (`nsTextFrame.cpp:11443-11446` uses the text run end).
9. **Discardables.** Confirmed SHY and bidi controls are removed (`nsTextFrameUtils.cpp:32-41`); in 8-bit text only SHY
   is (`:43-49`).
10. **Percentages.** The groundwork's "percent-based lengths truncate" holds at 156 (`ServoStyleConstsInlines.h:580-582`).
    New: `word-spacing: <percentage>` resolves against the font size in `ResolveWordSpacing` (`nsTextFrame.cpp:1966-1980`)
    but against the space width inside tab-size (`:3903-3905`).

## 12. Open questions and gaps

- HarfBuzz `trak` + `STAT` possible double tracking (2.6).
- Fonts whose default GSUB/GPOS lookups involve U+0020 switch to whole-run shaping (3.5). Which installed fonts do?
- `text-autospace` initial value at 156 not re-read (servo `longhands.toml`).
- `BuildTextRuns` can start scanning at a later line and discard partial text runs (`nsTextFrame.cpp:1633-1693`). The
  groundwork assumed a scan from line 0. An effect on line results is not established.
- Cursive-script list (`intl/components/src/UnicodeProperties.h`) not re-read at 156 (outside the sparse checkout).
- Floats, atomic inlines, ruby, first-letter/first-line, `text-wrap: balance`, justification and `hyphens: auto` are
  out of scope. Their branches are marked where they touch the loop.
