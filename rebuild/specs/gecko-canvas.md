# Gecko (Firefox 156.0) Canvas `measureText` and Firefox's line-break data

Topic owner: this spec. Scope: what `CanvasRenderingContext2D.measureText()` computes in Firefox 156.0 on macOS, how
that differs from the DOM text of the same string, which DOM width facts a rebuild can get exactly from Canvas totals,
and which ICU4X code and data Firefox 156 breaks lines with. Line filling (`BreakAndMeasureText`, `nsLineLayout`) is
another topic; it is mentioned only where it decides what Canvas must supply.

## 0. Pinned sources, labels and terms

- **FF156** = `~/github/browser-engines/firefox-156.0`, tag `FIREFOX_156_0_RELEASE`, commit
  `3bf8f468258c2181f455e23d4ffcd6acb8f4cdb1`. Every `path:line` below is in FF156 unless marked **[gh]**.
  During this work I added `dom/base gfx/src intl/icu_capi intl/icu4x-patches dom/html toolkit/library/rust
  third_party/rust/{icu_properties_data,icu_collections,utf8_iter,utf16_iter}` to the sparse checkout (add only).
- **[gh]** = fetched from `raw.githubusercontent.com/mozilla-firefox/firefox/3bf8f468.../<path>` because the directory
  is not in the checkout: `xpcom/ds/nsMathUtils.h`, `toolkit/moz.configure`, `browser/moz.configure`,
  `build/mozconfig.common`, `build/macosx/mozconfig.common`, `browser/config/mozconfigs/macosx64{,-aarch64}/common-opt`,
  `servo/components/style/properties/longhands.toml`, `servo/components/style/values/specified/text.rs`,
  `js/src/rust/shared/Cargo.toml`.
- **FF155** = Firefox 155.0.1 (`fb95137a`), what the groundwork read. I fetched 15 FF155 files for diffing
  (`data/gecko/source-diff-155-156.json`).
- **[V]** read in source. **[I]** inferred from what I read. **[P]** computed offline by a local program (no browser).

Terms:

- **App unit (au)**: Gecko's integer layout unit. 60 au = 1 CSS px (`gfx/src/AppUnits.h:11`).
- **apd**: app units per device pixel. For a page: `max(1, lround(60 / widgetScale))`, then
  `max(1, NSToIntRound(apd / fullZoom))` (`gfx/src/nsDeviceContext.cpp:52-63`, `:94-98`, `:410-415`). DPR 2 at
  100% zoom gives apd 30.
- **Text run** (`gfxTextRun`): one shaped string with per-character glyph records. **Glyph run**: a stretch of a text
  run that uses one font.
- **Shaping word**: a piece of a glyph run that Gecko shapes on its own and caches (§1.6, rule C8). Kerning and
  ligatures never cross the edge of a shaping word.
- **Cluster**: a grapheme cluster as marked by `gfxShapedText::SetupClusterBoundaries` (`gfx/thebes/gfxFont.cpp:708-769`).
- **Connected canvas**: a context whose `GetPresShell()` is non-null, that is, a `<canvas>` element in a document.
  **OffscreenCanvas context**: `new OffscreenCanvas(w,h).getContext('2d')` on the main thread or in a worker; it has
  no pres shell (`dom/canvas/CanvasRenderingContext2D.cpp:2086-2094`: only `mCanvasElement` or `mDocShell` yield one).
- `fround(x)`: round a double to float32 (JS `Math.fround`).

### 0.1 The maintainer's ten facts, as the Gecko 156 source produces them for this topic

1. **Styled runs.** `nsLineBreaker` grows one word across `AppendText` calls, so ICU4X sees `foo`+`bar` from two spans as
   one word with no break between them (`dom/base/nsLineBreaker.cpp:244-270`). For widths, a font change starts a new
   shaping word (`gfx/thebes/gfxFont.cpp:3708-3900` runs per font range); same-style spans can share a text run. Canvas
   measures one font per call, so the adapter concatenates same-style units (§2 A5).
2. **Break data.** ICU4X `icu_segmenter 2.1.2` with Firefox's own baked data (icu4x `3579f233`, CLDR 48, icuexport 78.1,
   SA dictionaries emptied), strict by default, `zh` locale only for Chinese/Japanese under `normal`/`loose` or
   non-default word-break (§4).
3. **White space and controls in Canvas.** TAB, LF, VT, FF, CR, U+001C..U+001F, NEL and PS become spaces; no collapsing;
   stray C0/C1 controls draw hexboxes in an OffscreenCanvas but are hidden in release DOM text (§1.3).
4. **Line filling.** Not this topic. For Canvas it matters that Gecko never reshapes at line edges
   (`gfx/thebes/gfxTextRun.cpp:1292-1301`), so whole-unit Canvas totals are the DOM's integers.
5. **Units.** Glyph advances are whole app units (1/60 CSS px at apd 60), rounded per glyph with `floor(x+0.5)`; spacing
   is whole app units; a Canvas total is `fround(sumAu / apd)` (§1.6, §1.8).
6. **Widths known late.** Gecko has no line-edge remeasure; nothing to model (fact 4).
7. **Direction, language, DPR.** Canvas splits at bidi runs and RTL script changes before shaping (§1.8); the language
   comes from `ctx.lang` or the root `lang` (§1.2 C3); an OffscreenCanvas works at apd 60 whatever the DPR, while the
   DOM's emoji advances and optical-size choices follow the device-pixel size (§1.9, §1.10).
8. **Carried remainder.** Safari-only; nothing in Gecko's Canvas path.
9. **Canvas is not the DOM.** Emoji (§1.9, bug 2020894), `system-ui` via optical size (§1.2 C1a), CR/FF/VT as spaces
   (§1.3), letter spacing turns ligatures off in both but with different thresholds and no cursive exception in Canvas
   (§1.7, §1.10), OffscreenCanvas language from the root `lang` or the OS locale (§1.2 C3), font sizes quantized to 7
   significant bits (§1.2 C2).
10. **Installed-browser checks.** §5.

---

## 1. Canvas `measureText` in Gecko 156

### 1.1 Top-level algorithm (port target)

This is what Firefox computes. The rebuild does not reimplement shaping; it needs this to know exactly what a
`measureText` total is.

```ts
// C0: whole procedure. Units: nscoord = int32 app units; gfxFloat = double; Float = float32.
function geckoMeasureTextWidth(ctx: Ctx, rawText: string): number /* double from float32 */ {
  const fontGroup = getCurrentFontStyle(ctx);                     // C1-C4
  let text = replaceWhitespace(rawText);                          // C5
  const isRTL = resolveDirection(ctx);                            // C6
  if (fontGroup.style.size === 0) return 0;                       // :5167-5174
  let flags = initialRunFlags(ctx);                               // C7
  const apd = ctx.hasPresShell ? presContext.apd : 60;            // :5217, :7132-7155
  let ls = 0, ws = 0;                                             // float32, in app units
  if (ctx.letterSpacingPx !== 0 || ctx.wordSpacingPx !== 0) {     // :5233-5242
    ls = fround(ctx.letterSpacingPx * apd);
    ws = fround(ctx.wordSpacingPx * apd);
    flags |= TEXT_ENABLE_SPACING;
    if (ctx.letterSpacingPx !== 0) flags |= TEXT_DISABLE_OPTIONAL_LIGATURES;
  }
  const totalAu /* nscoord */ = bidiProcessText(text, isRTL ? 1 : 0, ctx.presContextOrNull,
    (runText, dir) => {                                           // C9 SetText + GetWidth
      const run = fontGroup.makeTextRun(runText, apd, dir === RTL ? flags | TEXT_IS_RTL : flags); // C8
      return NSToCoordRound(run.measureAdvance(spacingProvider(run, ls, ws)));  // C10, C11
    });                                                           // C12
  return fround(totalAu / apd);                                   // :5277 float totalWidth
}
```

Citations for the skeleton: `MeasureText` → `DrawOrMeasureText` (`dom/canvas/CanvasRenderingContext2D.cpp:4726-4731`,
`:5096-5353`); measure returns `TextMetrics(totalWidth, ...)` (`:5331-5353`).

### 1.2 C1 Which font group, and its size

**C1a. OffscreenCanvas (no pres shell)**: `SetFontInternal` delegates to `SetFontInternalDisconnected`
(`CanvasRenderingContext2D.cpp:4219-4224`, `:4423-4611`) [V]:

```ts
function setFontDisconnected(ctx, fontString) {
  if (ctx.state.fontGroup && ctx.state.specifiedFont === fontString && userFontGenerationSame) return; // :4408-4421, :4452-4454
  const cached = fontGroupCache.lookup({fontString, lang: ctx.state.resolvedFontLang, stretch, caps, kerning, gen}); // :4461-4477
  if (cached) { use it; return; }
  const {families, style, width, weight, sizePx /* float32 */, smallCaps} = parseFontShorthandForMatching(fontString); // :4486-4490
  const size = quantizeFontSize(sizePx);                          // :4492
  // fontStretch / fontVariantCaps attributes override the shorthand            :4497-4564
  if (ctx.fontKerning === 'none')   featureSettings.push(['kern', 0]);          // :4566-4572
  if (ctx.fontKerning === 'normal') featureSettings.push(['kern', 1]);          // :4573-4576
  // 'auto' appends nothing                                                     :4577-4579
  new gfxFontGroup(visibility = mOffscreenCanvas, families, style{size}, lang = resolvedFontLang,
                   explicitLang, userFontSet, aDevToCssSize = 1.0, fontVariantEmoji = Normal); // :4589-4597
  // No nsFont::AddFontFeaturesToStyle, no AddFontVariationsToStyle => style.autoOpticalSize stays -1
}
```

- `gfxFontStyle::autoOpticalSize` defaults to `-1.0f` (`gfx/thebes/gfxFont.h:134`). Only
  `nsFont::AddFontVariationsToStyle` sets it, to the nsFont's CSS size, when `font-optical-sizing: auto`
  (`gfx/src/nsFont.cpp:266-279`). That function is called from `nsFontMetrics` (`gfx/src/nsFontMetrics.cpp:149`), which
  the disconnected path never uses [V].
- Consequence [V]: for a font with an `opsz` axis (for example the macOS system font behind `-apple-system` /
  `system-ui`), an OffscreenCanvas gets no automatic `opsz` (`gfx/thebes/gfxFontEntry.cpp:1362-1370` requires
  `autoOpticalSize >= 0`), and `gfxMacFont` then pins `opsz` to "the font's default ± 0.01"
  (`gfx/thebes/gfxMacFont.cpp:55-102`). DOM text gets `opsz = CSS size`.
- `font` getter serializes the quantized size (`SerializeFontForCanvas`, `:4375-4406`, appends `aStyle.size` at `:4403`),
  so `ctx.font = '13.33px Arial'` reads back `13.375px Arial` [V].

**C1b. Connected `<canvas>`** (`SetFontInternal`, `:4219-4365`) [V]:

- Style is resolved by Servo against the canvas element (em and % use its computed style), fallback parent
  `10px sans-serif` (`GetFontStyleForServo`, `:2831-2899`).
- It ignores the minimum-font-size adjusted size and takes the computed size (`:4249-4256`).
- `resizedFont.size = computedSize * (1 / CSSToDevPixelScale)` (`:4263-4264`), then
  `QuantizeFontSize(resizedFont.size.ToCSSPixels())` (`:4268-4269`). `CSSToDevPixelScale = 60 / apd`, so at DPR 2 this
  quantizes `size / 2`.
- Measured in installed Firefox 156 on 2026-09-16: `computedSize` is already kept to 10 significant bits by Servo
  (`servo/components/style/values/specified/font.rs:993-1022`), and the getter returns the computed size
  (`CanvasRenderingContext2D.cpp:2883-2893, :4358-4359`): `13.33px Arial` reads back `13.3281px Arial`, `12.1px` →
  `12.0938px`, and `1.2em` under a 16px parent → `19.1875px` (H3).
- `resizedFont.kerning = CanvasToGfx(fontKerning)` (`:4271`, mapping `:1193-1204`), then `nsPresContext::GetMetricsFor`
  (`:4345-4353`). `nsFontMetrics` converts the size with `ToAppUnits(size) / apd` (`gfx/src/nsFontMetrics.cpp:133-134`)
  and uses `devToCssSize = apd / 60` (`:151-154`).
  - Net effect [I from those lines]: the font group is sized in CSS px (at DPR 2: `(s/2)*60/30 = s`) but its text runs
    use the page apd (30 at DPR 2). Glyph advances are then multiples of `1/apd` CSS px (1/30 at DPR 2), not 1/60.
  - `autoOpticalSize = resizedFont.size.ToCSSPixels()` = `s / DPR` (`nsFont.cpp:276-279` on the resized nsFont).
  - `trak` size = `GetAdjustedSize() * apd / 60` (`gfx/thebes/gfxFont.cpp:3516-3521`) = `s * 30/60 = s/2` at DPR 2,
    while DOM text gets `2s * 30/60 = s` and an OffscreenCanvas gets `s * 60/60 = s`.

**C1c. Default font**: `10px sans-serif` when no font was set (`:5510-5522`); if that fails, a sans-serif group with
`devToCssSize = apd/60` (`:5523-5543`).

**C2. `QuantizeFontSize`** (`CanvasRenderingContext2D.cpp:4207-4217`) [V], float32 arithmetic:

```ts
function quantizeFontSize(size: number): number {     // all float32
  const d = fround(size * 131073);                     // scale = (1 << 17) + 1
  const t = fround(d - size);
  return fround(d - t);
}
```

- Effect [P, `data/gecko/font-size-quantization.json`]: keeps 7 significant bits. Steps are 1/16 px in [4,8),
  1/8 px in [8,16), 1/4 px in [16,32), 1/2 px in [32,64). Ties round to even: `16.125 → 16`.
  Examples: `13.33 → 13.375`, `14.4 → 14.375`, `16.8 → 16.75`; `12.5`, `13.5`, `15.5`, `16.25`, `31.75` unchanged.
- DOM font size [V]: `StyleCSSPixelLength::ToAppUnits` = `NSToIntRound(float(px) * 60)`, where `NSToIntRound` is
  `NS_lroundf` (half away from zero; `layout/style/ServoStyleConstsInlines.h:584-604`, `gfx/src/nsCoord.h:296`,
  **[gh]** `xpcom/ds/nsMathUtils.h:31-33`), used as `size_dev = au / apd`
  (`gfx/src/nsFontMetrics.cpp:133-134`). So the DOM size is on a 1/60 px grid.
- Canvas size equals DOM size only when `quantize(s) === round(s*60)/60`. Integers, halves and quarters (below 32px)
  qualify. Odd eighths never do: `13.375px` is `802.5 au` → `803 au` → `13.38333px` in the DOM, but stays `13.375px` in
  Canvas [P].
- Measured in installed Firefox 156 on 2026-09-16: the DOM size reaches the 1/60 px grid only after Servo's 10-bit
  `quantize_font_size` (H3b). `16.8px` lays out at 16.8125px = 1009 au: 60 × `m` in Georgia measures 53340 au at 16.8,
  16.81 and 16.8166667px. The equality condition becomes `quantize7(s) === round(q10(s) * 60) / 60`, with
  `q10(x) = d - (d - x)`, `d = fround(x * 16385)`. Integers, halves, quarters and odd eighths keep their results
  (13.375px: DOM − OC 0.3334px; 13.5px equal, H4); 16.8px doesn't. A2, §1.10 row 2 and A12's `domDevSize` need
  `q10(s)` in place of `s`.

**C3. Language** (`ResolveFontLang`, `:5421-5478`) [V], first match wins:

1. `ctx.lang` if it is not empty and not `inherit` → `explicitLang = true` (`:5426-5430`; setter
   `CanvasRenderingContext2D.h:355-358`; default `inherit`, `:1129`).
2. Connected canvas: the element's `lang` (explicit), else `OwnerDoc()->GetLanguageForStyle()` (`:5432-5439`).
3. A pres shell's document language (`:5441-5444`).
4. OffscreenCanvas: a `lang` transferred from a `<canvas>` (explicit; set by `transferControlToOffscreen` from the
   element's lang, `dom/html/HTMLCanvasElement.cpp:1162-1164`, kept on clone `dom/canvas/OffscreenCanvas.cpp:628-633`),
   else, if it has an owner window, the **root element's `lang` attribute**, with `explicitLang` left false
   (`:5446-5465`).
5. The OS locale (`:5467-5469`). A worker OffscreenCanvas with no transferred lang lands here.

- `SetFont` and every measure call re-run `ResolveFontLang`; a change drops the font group (`:4187-4189`, `:5494-5497`),
  so a main-thread OffscreenCanvas follows `document.documentElement.lang` changes on the next call [V].
- The language goes to the font group (`params.language`, `explicitLanguage` at `:4346-4347`, `:4593`), which uses it
  for generic-family prefs, Common/Inherited script resolution and HarfBuzz `locl`; `mExplicitLanguage` decides
  whether the language reaches a font-matching call at `gfx/thebes/gfxTextRun.cpp:2958` [V call site, effect not traced].

**C4. Font group caching (new in 156)**: `FontIsUnchanged` and the `FontGroupCache` MRU (`:4408-4421`, `:4456-4477`,
`CanvasRenderingContext2D.h` cache types) only avoid re-parsing. No width effect [V].

### 1.3 C5 Whitespace and control characters

- `TextReplaceWhitespaceCharacters` replaces U+0009, U+000A, U+000B, U+000C, U+000D, U+001C..U+001F, U+0085 and U+2029
  with U+0020 (`:4634-4637`, called at `:5110-5111`). No collapsing: `'a  b'` measures two spaces [V].
- `maxWidth <= 0` or NaN empties the string (`:5115-5118`); a positive `maxWidth` does not change the measured width.
- Other characters reach the text run unchanged. In the run:
  - `gfxFontGroup::IsInvalidChar` (`gfx/thebes/gfxTextRun.h:975-992`) is true for C0/C1 (≤ U+009F), U+200B, U+2028,
    U+2029, U+2060, U+FEFF and bidi controls (`intl/unicharutil/util/nsBidiUtils.h:84-90`). Such a character ends a
    shaping word and gets no glyph (`gfxFont.cpp:3781-3798`, `:3874-3897`).
  - Of those, general-category Cf characters become zero-width formatting controls (`:3881-3882`).
  - C0/C1 controls other than CR (`IsInvalidControlChar`, `gfxFont.cpp:3625-3627`) become **hexboxes** unless the run has
    `TEXT_HIDE_CONTROL_CHARACTERS` (`:3883-3891`). Hexbox advance = `int32_t(max(aveCharWidth,
    GetDesiredMinWidth(ch, apd)) * apd)` (`gfxFont.cpp:847-868`; min width `gfx/thebes/gfxFontMissingGlyphs.cpp:530-544`).
- **Where the hide flag comes from** [V]: `nsLayoutUtils::GetTextRunFlagsForStyle` adds it when
  `-moz-control-character-visibility` is `hidden` (`layout/base/nsLayoutUtils.cpp:6905-6908`). Its initial value reads
  pref `layout.css.control-characters.visible` (**[gh]** `servo/components/style/values/specified/text.rs:932-939`),
  which is `@IS_NOT_RELEASE_OR_BETA@` = false in 156.0 (`modules/libpref/init/StaticPrefList.yaml:10927-10931`).
  - DOM text and a connected canvas (flags from the canvas element's style, `:5191-5195`) hide stray controls: zero width.
  - An OffscreenCanvas starts with empty flags (`:5191-5195`, `canvasStyle` is null), so `'ab'` includes a hexbox.
- Bidi controls: `FormatUnicodeText` strips them (`layout/base/nsBidiPresUtils.cpp:2076`, `:2080-2098`), but it runs
  only when a pres context exists (`:2249-2252`, `:2405-2408`). An OffscreenCanvas keeps them in the run (zero width,
  splits shaping words); a connected canvas removes them (no split) [V].
- U+00AD SOFT HYPHEN is not an invalid char: Canvas shapes it inside the word [V]. The DOM discards SHY and bidi
  controls before building the run (`layout/generic/nsTextFrameUtils.cpp:32-41`).

### 1.4 C6 Direction; C7 initial run flags

- **C6** `ctx.direction` `ltr`/`rtl` is used as is; `inherit` uses the canvas element's computed `direction`, else the
  document bidi option, else LTR (`:5129-5151`). An OffscreenCanvas with `inherit` is LTR [V].
- **C7** flags [V]:
  - Connected: `GetTextRunFlagsForStyle(canvasStyle, presContext, font, text, letterSpacing = 0)` (`:5191-5195`), which
    can add `TEXT_HIDE_CONTROL_CHARACTERS`, `TEXT_OPTIMIZE_SPEED` and the orientation (`nsLayoutUtils.cpp:6896-6925`).
  - OffscreenCanvas: empty.
  - `textRendering`: `auto` sets `TEXT_OPTIMIZE_SPEED` below `browser.display.auto_quality_min_font_size` = 20
    (compared with the font's CSS px size here), `optimizeSpeed` sets it, the other two clear it (`:5197-5215`;
    pref `StaticPrefList.yaml:1535-1538`).
  - `TEXT_OPTIMIZE_SPEED` has no width effect: its only non-canvas use in gfx and layout is skipping
    `TEXT_NEED_BOUNDING_BOX` (`layout/generic/nsTextFrame.cpp:2602-2606`); elsewhere only a debug dump
    (`gfx/thebes/gfxTextRun.cpp:1721`) [V by grep of gfx/thebes, gfx/2d, layout/generic, layout/base, dom/canvas].

### 1.5 C8 Building the text run (same code as DOM text)

```ts
function makeTextRun(s, apd, flags) {                       // gfxTextRun.cpp:2491-2524
  if (s.length === 0) return emptyRun;                      // :2495-2497
  if (s === ' ') return spaceRun(firstValidFont);           // :2498-2500, :2381-2425
  if (style.adjustedSizeMustBeZero) return blankRun;        // :2506-2511
  initTextRun(...);   // script itemization, font ranges, then per range gfxFont::SplitAndInitTextRun
}
function splitAndInitTextRun(runChars, font, script, lang) { // gfxFont.cpp:3708-3900
  if (font.spaceMayParticipateInShaping(script) && (len > 32 || hasSpaces)) // :3747-3763
    return shapeWholeRangeWithoutWordCache();                // cross-space kerning possible
  for each i: boundary = (ch === ' ' || ch === ' ') && !isClusterExtender(next); // :3317-3322, :3784
              invalid = !boundary && isInvalidChar(ch);                             // :3785
    if (!boundary && !invalid) continue;                     // grow word
    shape word [wordStart, i) (cached if length <= 32, else straight into the run; same shaper) // :3804-3832
    if (boundary === ' ') spaceGlyph = NS_lroundf(font.spaceWidth * apd)  // simple glyph, not shaped; :3834-3839, :1590-1622
    else if (boundary === ' ') shape NBSP as its own word            // :3840-3861
    else handle invalid char (tab/newline flags, Cf zero width, hexbox)   // :3874-3892
}
```

- Shaper on macOS: HarfBuzz, because `gfx.font_rendering.coretext.enabled` is false (`gfxMacFont.cpp:157`,
  `StaticPrefList.yaml:7849-7852`); Graphite only for Graphite fonts (`gfxFont.cpp:3495-3510`) [V].
- Word-cache flags include `TEXT_DISABLE_OPTIONAL_LIGATURES` (`gfxFont.cpp:3766-3773`), so ligature state is part of
  the shaped word [V].
- No reshaping at line edges: `gfxTextRun::SetLineBreaks` is a no-op with zero width delta
  (`gfx/thebes/gfxTextRun.cpp:1292-1301`) [V]. A DOM line's width is a sum of the same per-glyph integers.

### 1.6 C10 Exact arithmetic per glyph (what sits inside a Canvas total)

All integers below are app units at the run's apd.

| Quantity | Formula | Types | Source |
|---|---|---|---|
| Font scale factor | `mFUnitsConvFactor = mAdjustedSize / upem` | double → float32 | `gfxMacFont.cpp:247-248`, `gfxFont.h:2373` |
| Adjusted size | `style.size * sizeAdjust(entry)`, clamped at 2000 | double | `gfxFont.h:1589-1599`, `gfxFont.cpp:4956-4960` |
| hmtx advance (TrueType, no fvar, no sbix) | `FloatToFixed(factor * uint16(advanceWidth))` = `trunc(65536 * fround(factor*u))` | float32 → int32 16.16 device px | `gfxHarfBuzzShaper.cpp:26`, `:354-380` |
| Variation font advance | `CGFontGetGlyphAdvances(instance) * factor * 0x10000` truncated | int32 | `gfxMacFont.cpp:437-446` |
| sbix (Apple Color Emoji) advance | `CTFontGetAdvancesForGlyphs(CTFont at mAdjustedSize device px).width * 0x10000` truncated | int32 | `gfxMacFont.h:30-36`, `gfxMacFont.cpp:448-462`, `gfxHarfBuzzShaper.cpp:44`, `:382-395` |
| HarfBuzz font scale | `hb_font_set_scale(trunc(65536 * adjustedSize))`, `ppem = adjustedSize` | uint32 | `gfxHarfBuzzShaper.cpp:1261-1263` |
| Glyph advance into the run | `floor((apd / 65536.0) * i_advance + 0.5)` when X rounding is off | double → nscoord | `gfxHarfBuzzShaper.cpp:1559`, `:1700-1703`, `:1766-1769` |
| X rounding | off: canvas reference target is Skia (`gfxPlatform.cpp:2347-2359`), `DrawTargetSkia::GetNativeSurface` returns null (`gfx/2d/DrawTargetSkia.cpp:2093-2095`), `gfxMacFont::ShouldRoundXOffset(nullptr)` is false (`gfxMacFont.cpp:566-570`) → `kRoundY` only (`gfxFont.cpp:1070-1107`); a non-translation canvas transform gives no rounding at all (`:1076-1078`) | | [V; main-thread `mScreenReferenceDrawTarget` backend at `gfxPlatform.cpp:1006` not traced] |
| Ligature continuation chars | advance 0; the ligature glyph sits on the first char | | `gfxHarfBuzzShaper.cpp:1779-1786` |
| U+0020 | `NS_lroundf(spaceWidth * apd)` with `spaceWidth = CGFontGetGlyphAdvances(space) * factor` (+ synthetic bold) | float32 → int32 | `gfxTextRun.cpp:1602-1603`, `gfxMacFont.cpp:371-376`, `:389-392`, `:414-435`; `NS_lroundf` **[gh]** `xpcom/ds/nsMathUtils.h:31-33` |
| `trak` tracking | `NS_round(TrackingForCSSPx(adjustedSize*apd/60) * factor * apd)` added to each positive simple advance and the last detailed glyph of a cluster | double → int32 | `gfxFont.cpp:3516-3543`, `:901-939` |
| Synthetic bold | same helper with `GetSyntheticBoldOffset()` when `maxAdvance > aveCharWidth` | | `gfxFont.cpp:3551-3562` |
| CJK scripts | `kern=0` unless kerning was set explicitly; explicit `kern=1` also adds `palt=1` (not for Yu Gothic UI) | | `gfxHarfBuzzShaper.cpp:1405-1438` |
| Letter-spacing ligature switch | `liga=0 clig=0 dlig=0 hlig=0` at the high/low feature boundary | | `gfxFont.cpp:672-701` |
| Cluster advance | simple: its advance; detailed: sum of glyph advances + `(n-1)*letterSpacing` if the cluster is flagged | int32 | `gfxTextRun.h:780-800` (flag set for case-transform merges, `layout/generic/nsTextRunTransformations.cpp:221`) |
| Run sum | `GetAdvanceForGlyphs` int32 sum; `MeasureText` accumulates per glyph run in double, spacing added as integers | int32 / double | `gfxTextRun.cpp:331-338`, `:802-839`, `:1214-1256`, `gfxFont.cpp:2955-3023` |

### 1.7 C11 Canvas spacing provider

`CanvasBidiProcessor::PropertyProvider::GetSpacing` (`CanvasRenderingContext2D.cpp:4759-4790`) [V]:

```ts
for (let i = range.start; i < range.end; i++) {
  const clusterEnd = i === run.length - 1 || (g[i+1].isClusterStart && g[i+1].isLigatureGroupStart);
  sp[i] = {before: 0, after: 0};
  if (clusterEnd) { if (run.isRTL) sp[i].before = NSToCoordRound(ls); else sp[i].after = NSToCoordRound(ls); }
  if (g[i].charIsSpace) { if (run.isRTL) sp[i].before += NSToCoordRound(ws); else sp[i].after += NSToCoordRound(ws); }
}
// LetterSpacing() = NSToCoordRound(ls), used between glyphs of flagged detailed clusters  :4796-4798
```

- `NSToCoordRound(float x) = nscoord(floorf(x + 0.5f))` (`gfx/src/nsCoord.h:99-101`).
- `charIsSpace` is set for U+0020 space glyphs (`gfxTextRun.cpp:1617-1619`, `gfxFont.cpp:3854-3856`) and for U+0020 and
  U+3000 inside shaped words (`gfxFont.cpp:749-750`). NBSP is not a space here [V].
- Spacing after the last character of every run, spaces included, and no script exception [V].
- `ctx.letterSpacing`/`wordSpacing` parse as `<length>` in CSS px; `em` uses the canvas font metrics, whose size is the
  quantized one (`:3091-3122`, `:3063-3089`); `SetFont` re-resolves them (`:4202-4204`, `:4613-4623`).

### 1.8 C9, C12 Bidi splitting and per-run rounding

`nsBidiPresUtils::ProcessText` (`layout/base/nsBidiPresUtils.cpp:2160-2378`) [V]:

```ts
if (len === 1 || isSurrogatePair || (baseLTR && !encoding_mem_is_utf16_bidi(text)))   // :2183-2190
  return simpleRun(text);            // one SetText; direction from the FIRST char's bidi class (:2395-2414)
bidi.setParagraph(text, baseLevel); for each visual run:                               // :2192-2214
  if (RTL) { SetText(whole run, RTL); xOffset += GetWidth(); }                        // :2235-2240 (positioning only)
  while (subRunCount > 0) {
    calculateBidiClass(...)   // splits a same-level run where a strong class changes and either side is RTL,
                              // e.g. Hebrew next to Arabic                            :2100-2158
    SetText(subRun, dir); width = GetWidth(); totalWidth += width;                     :2254-2256
  }
*aWidth = totalWidth;                                                                  :2374-2376
```

- `is_utf16_bidi` is true for any character in an RTL block, the four RTL controls, or an unpaired high surrogate
  (encoding_rs `mem.rs` doc, groundwork copy `oracle/gecko/validation/gecko-src-extra/encoding_rs_mem.rs:1285-1301`).
- Each sub-run is its own text run: no kerning or ligature across a direction change or a Hebrew/Arabic change [V].
- `GetWidth` rounds each run's double advance with `NSToCoordRound` (`CanvasRenderingContext2D.cpp:4854-4869`). With
  integer spacing the double is already integral, so the total is an exact integer sum [I].
- Final `totalWidth = float(totalWidthCoord) / apd` is float32 (`:5277`). The integer is recoverable as
  `Math.round(width * apd)` while `totalWidthCoord < 2^23` au (≈139,800 px at apd 60) [I: float32 relative error
  ≤ 2^-24].

### 1.9 Emoji (Mozilla bug 2020894)

- Source [V]: Apple Color Emoji has `sbix`, so advances come from Core Text at `mAdjustedSize` device px
  (`gfxMacFont.h:30-36`, `gfxMacFont.cpp:448-462`). DOM text at DPR 2 asks Core Text at `2 * size`
  (`nsFontMetrics.cpp:133-134`, apd 30) and stores `30 * adv`; an OffscreenCanvas asks at `size` and stores `60 * adv`.
  A connected canvas asks at `size` (CSS-px font group) and stores `30 * adv`.
- Offline probe [P] (`data/gecko/apple-color-emoji-advances-macos27.{c,tsv}`, Core Text on macOS 27.0, U+1F600,
  applying the Gecko formulas):

| CSS size | CT adv(size) = Canvas px | DOM px at DPR 2 = CT adv(2·size)/2 | DOM px at DPR 1 |
|---|---|---|---|
| 10 | 13 | 11.5 | 13 |
| 12 | 16 | 12.5 | 16 |
| 14 | 19 | 14 | 19 |
| 16 | 21 | 16 | 21 |
| 18 | 22 | 18 | 22 |
| 20 | 23 | 20 | 23 |
| 24 | 25 | 24 | 25 |
| 28 | 28 | 28 | 28 |

  This matches the Firefox table in bug 2020894 comment 2 exactly (canvas 13/16/19/20/21/22/23/25/28; DOM
  11.5/12.5/14/15/16/18/20/24/28) and jfkthame's comment 3 (DPR split, bitmap font).
- All probed advances (8–40px, U+1F600) are whole pixels, so an OffscreenCanvas measured at font size `size·DPR` and
  divided by DPR reproduces the DOM value exactly at DPR 2 [P/I].
- Measured in installed Firefox 156 on 2026-09-16: exact for U+1F600 and the ZWJ family at 8–32px at apd 30, 60, 40
  and 23 (DPR 2 DOM: 10.5, 11.5, 12.5, 14, 16, 20, 24, 32). Not exact at apd 27 (110% zoom at DPR 2) for 20px and 24px:
  DOM 19.8px and 23.85px, recipe 20.25px and 24.3px. The DOM asks Core Text at `round(q10(s) * 60) / apd` device px
  (44.44px and 53.33px, advances 44 and 53), while OffscreenCanvas quantizes `s·DPR` to 7 bits (44.5px and 53.5px,
  advances 45 and 54). The recipe is exact when both sizes get the same whole-pixel advance, which holds when `s·DPR`
  is on the 7-bit grid and equals the DOM device size, as for integer sizes at DPR 1 and 2. At fractional apd it can
  miss by one device pixel (E6, A12).

### 1.10 Canvas versus DOM text of the same string

| Fact | DOM text (layout) | OffscreenCanvas | Connected `<canvas>` | Source |
|---|---|---|---|---|
| apd of the run | page apd (30 at DPR 2) | 60 | page apd | `nsFontMetrics.cpp:124`; `CanvasRenderingContext2D.cpp:7132-7155` |
| Font size in the shaper | `round(s*60)/apd` device px | `quantize(s)` CSS px | `quantize(s/DPR)*DPR` CSS px | §1.2 |
| Advance grid in CSS px | 1/60 | 1/60 | 1/apd | §1.6 |
| Per-glyph hmtx au | `floor(30/65536*trunc(65536*fround(2s/upem*u))+0.5)` at DPR 2 | `floor(60/65536*trunc(65536*fround(s/upem*u))+0.5)` | 1/30 grid | §1.6 [I: at DPR 2 the DOM fixed value is `2F` or `2F+1`, so rare 1-au differences] |
| sbix emoji | CT at `size·DPR` | CT at `size` | CT at `size` | §1.9 |
| `opsz` (auto optical sizing) | CSS size | font default ± 0.01 | `size/DPR` | `nsFont.cpp:276-279`, `gfxFontEntry.cpp:1362-1370`, `gfxMacFont.cpp:85-101` |
| `trak` size | `s` | `s` | `s/DPR` | `gfxFont.cpp:3519-3521` |
| Stray C0/C1 controls (release) | hidden, 0 | hexbox | hidden, 0 | §1.3 |
| TAB, LF, VT, FF, CR, NEL, PS | layout rules (tab-size, forced breaks, invisible) | U+0020 | U+0020 | `:4634-4637` |
| SHY, bidi controls | removed before shaping | SHY shaped; bidi controls zero width, split words | SHY shaped; bidi controls stripped | §1.3 |
| Letter spacing amount | length: `NS_lroundf(fround(px*60))` au; percentage of the font size in au: truncated (`nsTextFrame.cpp:1949-1963`, `ServoStyleConstsInlines.h:580-604`, `:794-806`, `gfx/src/nsCoord.h:296`) | `NSToCoordRound(fround(px*60))` per cluster | same at apd | §1.7 |
| Letter spacing placement | model 0: after each cluster end where `CanAddSpacingAfter`, **skipped when the cluster's base char is in a cursive script** | after every cluster end, all scripts | same | `nsTextFrame.cpp:4107-4133`, `:4196-4214`, `:3860-3873`; `StaticPrefList.yaml:11041-11048` |
| Ligatures off when | resolved letter spacing ≠ 0 au, or `text-justify: inter-character` | `letterSpacing` float ≠ 0 | same | `nsLayoutUtils.cpp:6901-6904`, `nsTextFrame.cpp:2599-2601`; `CanvasRenderingContext2D.cpp:5238-5241` |
| Word-spacing chars | U+0020 and U+00A0 (not before a space-combining tail); TAB/CR when white space is not significant; LF when newlines are not significant | U+0020, U+3000 | same | `nsTextFrame.cpp:880-898`, `:4215-4226`; §1.7 |
| Kerning attribute | `font-kerning` | `ctx.fontKerning` (feature setting) | `ctx.fontKerning` (nsFont) | `nsFont.cpp:149-164`; `:4566-4580`; `:4271` |
| `text-rendering` | no width effect | no width effect | no width effect | §1.4 |
| Language | element style language | `ctx.lang` → transferred → root `lang` → OS | `ctx.lang` → element → document | §1.2 C3 |
| Direction runs | frame bidi resolution | `ProcessText` runs and sub-runs | same, with `FormatUnicodeText` | §1.8 |
| Line-edge reshaping | none | n/a | n/a | `gfxTextRun.cpp:1292-1301` |

### 1.11 Runtime settings on the measure path at 156.0 (release)

| Pref | Value | Effect | Source |
|---|---|---|---|
| `gfx.font_rendering.coretext.enabled` | false | HarfBuzz shapes everything on macOS | `StaticPrefList.yaml:7849-7852`, `gfxMacFont.cpp:157` |
| `layout.css.control-characters.visible` | `@IS_NOT_RELEASE_OR_BETA@` = false | DOM and connected canvas hide stray controls; OffscreenCanvas shows hexboxes | `:10927-10931` |
| `layout.css.letter-spacing.model` | 0 (2 only on Nightly) | DOM spacing after the cluster (trailing side) | `:11041-11048` |
| `browser.display.auto_quality_min_font_size` | 20 | toggles `TEXT_OPTIMIZE_SPEED`; no width effect | `:1535-1538` |
| `gfx.font_rendering.wordcache.charlimit` | 32 | shaping-word cache limit; no width effect | `:7931-7934` |
| `gfx.font_rendering.graphite.enabled` | true | Graphite fonts shaped by Graphite | `:7925-7928` |
| `gfx.font_rendering.fallback.async` | true | system fallback can arrive later and reflow | `:7861-7864`, `gfxTextRun.cpp:3111` |
| `gfx.font_rendering.fallback.unassigned_chars` | false | no fallback for unassigned code points | `:7873-7876`, `gfxTextRun.cpp:3525` |
| `layout.css.text-transform.uppercase-eszett.enabled` | false | `ß` uppercases to `SS` | `:11323-11326`, `nsTextFrame.cpp:2628` |
| `layout.css.text-autospace.enabled` | true, but initial value `no-autospace` | no inter-script spacing unless authored | `:11330-11333`, **[gh]** `longhands.toml:2610-2612` |
| `bidi.numeral` | 0 | no digit substitution in `FormatUnicodeText` | `:1021-1024`, `nsBidiPresUtils.cpp:2019-2074` |
| `layout.css.devPixelsPerPx` | -1 | widget scale decides apd | `:10871-10874` |
| Build option `--enable-fontations` | off by default, not set by any macOS mozconfig I checked | 156's new Skrifa metrics code (`gfxFont.cpp` `InitMetricsFromSkrifa`, `gfxMacFont.cpp:259-266`) is compiled out | **[gh]** `toolkit/moz.configure:888-901` |

Full list with line numbers: `data/gecko/prefs-156.json`.

---

## 2. Measurement adapter: how each CSS feature maps onto Canvas calls (port target)

Goal: for a styled run whose DOM layout Gecko will compute, obtain the integer app-unit advances Gecko sums, using
only an OffscreenCanvas. Use an **OffscreenCanvas**, never a connected `<canvas>` (§1.10 rows 1, 3, 5, 6).

```ts
// A1. One context per (font string, lang). Set ctx.lang explicitly so explicitLang = true (C3 step 1).
function contextFor(fontCss: string, lang: string) {
  ctx.font = fontCss;              // quantizes the size (C2)
  ctx.lang = lang || 'inherit';    // span lang or paragraph lang; 'inherit' => root lang attr, explicitLang false
  ctx.letterSpacing = '0px'; ctx.wordSpacing = '0px'; ctx.fontKerning = mapKerning(fontKerning); // 'auto'|'normal'|'none'
  ctx.direction = 'ltr';
}
const au = (s: string) => Math.round(ctx.measureText(s).width * 60);   // exact integer (C12)
```

A2. **Font size gate.** If `quantizeFontSize(s) !== Math.round(Math.fround(s)*60)/60` (C2), Canvas cannot give the DOM
size. Record the run as inexact (see §3 N1); scaling widths by `domSize/canvasSize` is only approximate because each
glyph rounds separately.

A3. **Text passed to Canvas** = the DOM's text after white-space processing (collapsing and segment-break
transformation are layout rules, not this topic), then:

- apply `text-transform` in JS with Gecko's rules: uppercase `ß` → `SS` (pref false, §1.11); language-specific casing
  for `tr az ba crh tt` (Turkish), `nl` (IJ), `el` (accent strip), `ga` (Irish), `lt` (Lithuanian)
  (`layout/generic/nsTextRunTransformations.cpp:274-298`);
- remove U+00AD and bidi controls (DOM discards them, §1.3);
- remove stray C0/C1 controls and U+0085 (DOM hides them in release; Canvas would draw a hexbox or a space);
- never pass TAB, LF, CR, VT, FF, U+2029: Canvas turns them into spaces (C5). A preserved TAB's advance comes from layout:
  `tab-size` number `n` → `n * (NSToCoordRound(spaceWidth*apd) + letterSpacing + wordSpacing)` using the
  **containing block's** first font with a space (`nsTextFrame.cpp:3875-3905`); `au(' ')` in that font gives the
  space term (§3 E2).

A4. **Shaping units.** Split the text where Gecko splits shaping words (C8): before and after each U+0020 and U+00A0
(unless the next char extends a cluster), at each invalid char (C5), at font-range changes, at script-run changes, and
at direction runs. Measure each unit with `au(unit)`; measure a U+0020 in context (§3 E2). Gecko never kerns across
those edges, so the line total is the integer sum. Exception: fonts whose default GSUB/non-kerning GPOS lookups involve
the space glyph are shaped whole, spaces included (`gfxFont.cpp:3747-3763`); measure the whole range for them.

A5. **Styled runs (fact 1).** Two adjacent spans with the same font, size, language and spacing continue one DOM text
run, so a unit that crosses the span edge is shaped once: measure the concatenated unit (`'foo'+'bar'`) with one
context. A font change always starts a new glyph run and a new shaping word: measure each side with its own context.

A6. **Letter spacing** (CSS `letter-spacing: L`):

```ts
const Lau = isPercent(L) ? Math.trunc(fontSizeAu * pct(L))          // ServoStyleConstsInlines.h:580-582, :804-805
                         : Math.round(Math.fround(Math.fround(px(L)) * 60)); // :584-595 (half away from zero; px >= 0 here)
if (Lau !== 0) ctx.letterSpacing = '0.001px';         // turns ligatures off (:5238-5241) and adds NSToCoordRound(0.06) = 0 au
unitAu = au(unit)                                      // ligature-free shaping, no spacing added
       + Lau * countClusterEndsWhereSpacingApplies(unit); // CanAddSpacingAfter and not a cursive-script base (nsTextFrame.cpp:3860-3873, :4196-4214)
```

`countClusterEndsWhereSpacingApplies` needs grapheme clusters, ligature group starts (no ligatures once disabled, except
required ones such as Arabic `rlig`), formatting controls, tabs and the cursive script set (Arabic, Syriac, NKo,
Mandaic, Mongolian, Phags-pa, Hanifi Rohingya per the groundwork reading of `intl/components/src/UnicodeProperties.h`,
which is byte-identical at 156).

A7. **Word spacing** (`word-spacing: W`): add `W au` after each U+0020 and U+00A0 that are not before a space-combining
tail, and after TAB/CR/LF when those are not significant (`nsTextFrame.cpp:880-898`, `:4215-4226`). Do not use
`ctx.wordSpacing` (it spaces U+3000 and skips NBSP, §1.7).

A8. **Hyphens: manual / SHY.** The DOM hyphen glyph width is the width of a text run of U+2010 if the first font of the
group has U+2010, else `-` (`gfxTextRun.cpp:2458-2488`). `au('‐')` is correct only when the first font covers
U+2010; otherwise Canvas may use a fallback font's U+2010 instead of the first font's `-` (§3 N5).

Measured in installed Firefox 156 on 2026-09-16: no fallback happens. When the first font lacks U+2010 or U+2011,
Gecko's HarfBuzz callback substitutes `-` (`gfxHarfBuzzShaper.cpp:119-124`; `gfxTextRun.cpp:3227-3229`). Georgia has
no U+2010, and OC `'‐'` = `'-'` = 5.9833px. So `au('‐')` equals the hyphen run's advance whenever the first font has
U+2010 or `-`. N5 and gecko-lines §9 item 6 change the same way; H25 can't discriminate in Georgia.

A9. **Direction and bidi.** Measure each bidi run as its own unit with `ctx.direction` set to the run's direction.
Canvas splits further where a strong class changes between RTL scripts (C9); DOM frames do their own resolution, so
measure a mixed Hebrew/Arabic run per script only if the DOM also splits it (not verified here).

A10. **Language.** Set `ctx.lang` to the span's language (C3). A worker OffscreenCanvas without `ctx.lang` uses the OS
locale.

A11. **DPR and zoom.** OffscreenCanvas widths do not depend on DPR or zoom (apd 60). DOM hmtx advances are also
DPR-independent up to rare 1-au rounding (§1.10 row 4). Correct only these DPR-dependent facts: Apple Color Emoji
(A12), hexboxes and synthesized widths rounded to device pixels (§3 N6).

A12. **Emoji at DPR d**: for a unit rendered by Apple Color Emoji, `domAu = round(ctx(fontSize = domDevSize).measureText(unit).width * 60) * apd / 60`
where `apd = max(1, round(60/d))` then zoom (`nsDeviceContext.cpp:52-63`), `domDevSize = round(s*60)/apd`, and the
canvas font size must survive `quantizeFontSize` (it does for integer `s` at DPR 2: `2s`).

A13. **Features that the Canvas font shorthand cannot express** (`font-feature-settings`, `font-variant-ligatures`,
`font-variation-settings`, `font-optical-sizing`, `font-size-adjust`, `font-synthesis`): Canvas cannot reproduce them;
§3 N2.

What does not touch measurement: `white-space` (except which characters reach the text, A3), `word-break`,
`overflow-wrap`, `line-break` (break data, §4), `hyphens: manual` (A8 supplies the width).

---

## 3. What Canvas can supply (Gecko 156, OffscreenCanvas, main thread)

**Exact** (integer app units, same as the DOM sum):

- **E1** A shaping unit's advance: `Math.round(measureText(unit).width * 60)`, for units as in A4, when the font size
  passes A2, the font has no `opsz` axis or the page sets `font-optical-sizing: none`, and the unit is not Apple Color
  Emoji at DPR ≠ 1. Groundwork measurement at FF155: per-word Canvas totals × 60 reproduced 6,741/6,741 word-edge line
  widths (`pretext-emulation-20260915/NOTES.md:122`); the code is unchanged at 156 (§6).
- **E2** U+0020 advance in its font context: `au(a+' '+b) - au(a) - au(b)`. In the primary font alone: `au(' ')`
  (`NS_lroundf(spaceWidth*60)`, `gfxTextRun.cpp:1602-1603`). This equals the DOM value at any DPR because
  `spaceWidth_dev * apd` is the same double product [I].
- **E3** Tab advance inputs (A3), from E2 in the containing block's font.
- **E4** Letter-spacing shaping (ligatures off) via `ctx.letterSpacing = '0.001px'` plus JS spacing (A6).
- **E5** `trak` tracking, synthetic bold, kerning, `palt` for explicit CJK kerning, and HarfBuzz `locl` via `ctx.lang`:
  same code with the same CSS size (§1.6, §1.10 row 7).
- **E6** Apple Color Emoji at integer DPR: measure at `size·DPR` and divide (A12); exact for the probed U+1F600
  8–40px because Core Text returns whole-pixel advances [P].
- **E7** Width of a unit with bidi controls removed (A3) equals the DOM unit, because the DOM removes them too.

**Not exact or not available:**

- **N1** Font sizes where `quantize(s) ≠ round(s*60)/60` (C2): no Canvas font string reaches the DOM size
  (`13.3333px` DOM vs `13.375px` Canvas). About 85% of sizes in 0.1px steps fail (`data/gecko/font-size-quantization.json`).
- **N2** Fonts with an `opsz` axis under `font-optical-sizing: auto` (the default), including `system-ui` and
  `-apple-system`: Canvas uses the default optical size (§1.2). Any `font-feature-settings`, `font-variant-*` other than
  small caps, `font-variation-settings`, `font-size-adjust` (A13).
- **N3** In-word prefix widths at an in-word break (emergency wrap, break-all, SHY): Canvas totals of sub-word pieces
  lose in-word kerning. Groundwork FF155 results: GPOS kerning recoverable as whole-minus-suffix (Arial Latin
  11,181/11,232); legacy `kern` fonts (Times, Verdana, Helvetica Neue) had no exact recipe (`NOTES.md:122-125`).
- **N4** Which font a character falls back to when system fallback runs asynchronously (§1.11).
- **N5** The hyphen glyph when the first font lacks U+2010 (A8), and the first font's cmap coverage in general.
- **N6** Hexboxes for missing glyphs (`max(aveCharWidth, minWidth)` rounded per apd, `gfxFont.cpp:847-868`) and widths
  synthesized for Unicode spaces no font covers (whole device pixels per the groundwork reading of
  `gfxTextRun.cpp`): need `aveCharWidth` and DPR, which Canvas totals do not expose.
- **N7** Rare 1-au per-glyph differences between the DOM at DPR ≠ 1 and Canvas at apd 60 from 16.16 truncation at
  different scales (§1.10 row 4) [I].
  - Measured in installed Firefox 156 on 2026-09-17 (probe gecko-port F7, `rebuild/probes/gecko-round2.ts`,
    `.artifacts/probes/gecko/round2`) [P]: single shaping units whose DOM box is 1 au off the OffscreenCanvas width, with
    nothing else on the node: `ووفقك` in 10px Geeza Pro (DOM 1173, OC 1172), `รมชาติทำให้ผู้คนมีคว` in 500 32px Thonburi (16899
    against 16898), `modern` in 15px Helvetica Neue (3118 against 3119). A `<canvas>` element, detached or connected,
    doesn't reproduce them: it measures on whole device pixels (1174, 16900, 3118; `In` 734 where the DOM and OC give 733).
    The source path: advances from hmtx as `FloatToFixed(float32 factor × units)` truncated to 16.16 at the device size
    (gfxHarfBuzzShaper.cpp:354-379), the HarfBuzz scale in 16.16 device px (:1262-1263), and each glyph's advance rounded to
    app units at the page's apd (:1699-1702). No Canvas string shows a glyph's sub-app-unit fraction, so the class has no
    Canvas-observable condition.
- **N8** Anything from a connected `<canvas>`: 1/apd grid, `size/DPR` quantization, `opsz` and `trak` at `size/DPR`.

---

## 4. Firefox 156 line-break data and how Gecko calls it

### 4.1 Crates and features

- `icu_segmenter 2.1.2` (crates.io, checksum `a807a748...`), `icu_segmenter_data 2.1.1` (path),
  `icu_properties 2.1.2` (vendored, depends on `harfbuzz-traits`), `icu_provider 2.1.1`, `icu_locale 2.1.1`,
  `icu_locale_core 2.1.1`, `icu_collections 2.1.1`, `icu_capi 2.1.1` (path), `zerovec 0.11.4`, `potential_utf 0.1.4`
  (`Cargo.lock:3626-3638`, `:3689-3697`, `:3716-3724`, `:3757-3765`, `:3776-3784`, `:3803-3821`). All versions and
  checksums equal FF155's (`data/gecko/icu-crates-156.json`) [V].
- Patches: `icu_capi → intl/icu_capi`, `icu_segmenter_data → intl/icu_segmenter_data` (`Cargo.toml:376-377`).
- Features actually on [V]: SpiderMonkey's shared crate enables `icu_capi` with `any_provider, compiled_data, segmenter,
  calendar` (**[gh]** `js/src/rust/shared/Cargo.toml:18`); `icu_capi` depends on `icu_segmenter ~2.1.1` with
  `features = ["auto"]`, `default-features = false` (`intl/icu_capi/Cargo.toml:264-268`); `compiled_data` forwards to
  `icu_segmenter?/compiled_data` (`:80-85`), which pulls `icu_segmenter_data` (`third_party/rust/icu_segmenter/Cargo.toml:47-52`);
  `auto = ["lstm"]` (`:46`). No `dictionary`-only build.
- Vendored `icu_segmenter` sources: `.cargo-checksum.json` byte-identical to FF155 (`third_party/rust/icu_segmenter`).

### 4.2 Baked data

- `intl/icu_segmenter_data/data/ICU4X-GIT-INFO:1`: icu4x commit `3579f233b2bdffbd99183d797231f9d7a0448548`.
- Datagen defaults `cldr 48.0.0`, `icuexport release-78.1`, `icu4x-icuexportdata-78.1.zip` (`intl/update-icu4x.sh:17-20`);
  Burmese, Khmer, Lao and Thai dictionaries replaced with `empty.toml` (`:58-67`); datagen writes into
  `intl/icu_segmenter_data/data` (`:45-50`, `:102-115`).
- sha256 at 156 (full list `data/gecko/segmenter-data-sha256.json`):

| File | bytes | sha256 (first 16) | = groundwork FF155 copy | = crates.io 2.1.1 |
|---|---|---|---|---|
| `segmenter_break_line_v1.rs.data` | 70,546 | `bbb77f4e38bf9551` | yes | no (`9b2c17ec78de5793`) |
| `segmenter_lstm_auto_v1.rs.data` | 874,165 | `404c07e25783eceb` | yes | no (`1953b57dae730a0c`) |
| `segmenter_dictionary_auto_v1.rs.data` | 5,247,820 | `2cb4147b39139cac` | yes | no |
| `segmenter_dictionary_extended_v1.rs.data` | 3,341 | `691e158ba2840062` | yes | no |
| `segmenter_break_grapheme_cluster_v1.rs.data` | 33,699 | `60bdd83d9f9c5835` | yes | no |
| `segmenter_break_word_v1.rs.data` | 54,463 | `ea6274edb7e02e74` | yes | no |
| `segmenter_break_word_override_v1.rs.data` | 5,439 | `54f3904e2027380e` | yes | no |
| `segmenter_break_sentence_v1.rs.data` | 49,888 | `551267cdd4bf0005` | yes | no |
| `segmenter_break_sentence_override_v1.rs.data` | 5,040 | `8a154340cce0f82f` | yes | no |
| `mod.rs` | 2,035 | `3420e67690582f26` | yes | no |

  Groundwork copies: `oracle/gecko/vendor/icu_segmenter_data/data` and `oracle/gecko/crates/firefox-data` (identical to
  each other). The groundwork measured that the crates.io data differs only in line classes for U+E1000..U+10FFFF with 0
  output differences on its corpus (`NOTES.md:53-55`).

### 4.3 How Gecko calls ICU4X (break opportunities)

`intl/lwbrk/LineBreaker.cpp` (byte-identical to FF155) [V]:

```ts
function computeBreakPositions(word: Uint16Array, wordBreak, lineBreak, isChineseOrJapanese): Uint8Array {
  if (word.length === 1) return [1];                                     // :120-127
  const strictness = {auto:'Strict', strict:'Strict', loose:'Loose', normal:'Normal', anywhere:'Anywhere'}[lineBreak]; // :26-41
  const wordOption = {normal:'Normal', 'break-all':'BreakAll', 'keep-all':'KeepAll'}[wordBreak];                    // :43-55
  const seg = (wordBreak === 'normal' && (lineBreak === 'strict' || lineBreak === 'auto') && !isChineseOrJapanese)
    ? LineSegmenter.new_auto(defaults)                                   // shared, :57-68, :70-76
    : LineSegmenter.new_lstm({strictness, wordOption, content_locale: isChineseOrJapanese ? 'zh' : null}); // :78-110
  out = zeros; for (pos of seg.segment16(word)) if (pos < word.length) out[pos] = 1;   // :165-171 (break at end dropped)
  return out;   // caller overwrites out[0] with its saved state (dom/base/nsLineBreaker.cpp:340-347)
}
```

- ICU4X side (`third_party/rust/icu_segmenter/src/line.rs`): defaults `Strict`, `Normal` (`:234`, `:238`); `ja_zh` only
  from a `ja`/`zh` content locale (`:240`); `new_auto` is `new_lstm` (`:402`, `:445`); CJ becomes ID under
  break-all/loose/normal (`:686-688`); break-all treats a left `AL NU SA` as ID (`:897`); keep-all pair rule (`:902`);
  `Normal` and `Loose` consult `ja_zh` (`:913`, `:918-923`, `:1126`); `Anywhere` (`:931`); SA complex breaking unless
  break-all (`:941`).
- Words come from `nsLineBreaker` (byte-identical to FF155): words end only at `IsSegmentSpace` characters
  (`dom/base/nsLineBreaker.h:260`) and, in 16-bit text, LF (`nsLineBreaker.cpp:332`); a word keeps growing across
  `AppendText` calls, which is how breaks are decided across span edges (`:244-270`); ASCII words made only of
  `kNonBreakableASCII` characters skip ICU4X unless break-all (`:33-55`, `:155-160`); `line-break: anywhere` marks every
  position without ICU4X (`:150`, `:335-338`).
- Language-dependent tables: only the `zh` locale switch for Chinese/Japanese under `normal`/`loose` or non-default
  word-break; `line-break: auto` gives identical results for all languages (strictness Strict, `ja_zh` unused).

### 4.4 Groundwork Rust oracle against 156 data

- I copied `pretext-emulation-20260915/oracle/gecko/{src,Cargo.toml,Cargo.lock}` to the scratchpad, pointed
  `[patch.crates-io] icu_segmenter_data` at `firefox-156.0/intl/icu_segmenter_data`, and ran
  `cargo build --release --offline`: built in 5.5 s with no source change [P].
- `gecko-breaks --dump-tables` output is byte-identical to the groundwork's `results/tables-firefox-data.json`
  (sha256 `0935cdebb84b67a3...`) [P]. Smoke: `hello world foo-bar` → breaks `[6,12,16]` (`data/gecko/oracle-build-156.json`).
- The C++ the oracle ports is byte-identical at 156: `nsLineBreaker.{cpp,h}`, `LineBreaker.{cpp,h}`, `Segmenter.cpp`,
  `nsTextFrame.cpp`, `nsTextFrameUtils.cpp`, `nsBidiPresUtils.cpp`, `gfxTextRun.h`, `gfxScriptItemizer`, `gfxSkipChars`,
  `nsBidiUtils.h`, `nsUnicodeProperties.cpp`, `UnicodeProperties.h`, `CharacterDataBuffer.cpp`, `line.rs`. The changed
  files (`gfxFont.cpp`, `gfxFont.h`, `gfxTextRun.cpp`, `nsContentUtils.cpp`, `nsLineLayout.cpp`, `nsTextFrame.h`,
  `gfxTypes.h`) change nothing the oracle ports (`data/gecko/source-diff-155-156.json`) [V].

### 4.5 Prefs that change line breaking at 156

- None in `intl/lwbrk` or `dom/base/nsLineBreaker.cpp`: no `StaticPrefs::` use [V by grep]. Break opportunities have no
  runtime switch.
- Line filling/placement prefs on by default that only matter for other features: `layout.css.text-wrap-balance.limit`
  = 10 and `layout.css.text-wrap-balance-after-clamp.enabled` = true (`text-wrap: balance`, `nsBlockFrame.cpp:1769-1813`),
  `layout.css.text-align.justify-only-after-last-tab` = true (`nsTextFrame.cpp:3740`).
- Width prefs that move breaks: §1.11 (control characters, letter-spacing model, eszett, coretext, async fallback).

---

## 5. Hypotheses to probe in installed Firefox 156.0 (macOS 27, headed, Retina DPR 2 unless noted)

Each probe uses a main-thread `new OffscreenCanvas(1,1).getContext('2d')` ("OC"), a connected `<canvas>` ("EC"), and a
DOM `<span>` in a `lang="en"` page with `white-space: pre` measured by `getBoundingClientRect().width` ("DOM").

1. **Integrality.** OC `font='16px Georgia'`, `measureText('Hello, world. Quick brown fox.').width * 60` is an integer
   within 1e-3. Same at DPR 1.
2. **Connected canvas grid.** EC `font='16px Georgia'` at DPR 2: `width * 30` is an integer; `width * 60` is never odd
   for any of 50 random words; EC and OC differ by at most `n/60` px for an `n`-glyph word.
3. **Quantized readback.** OC `ctx.font='13.33px Arial'` reads back `13.375px Arial`; EC reads back `13.33px Arial`.
   - Measured in installed Firefox 156 on 2026-09-16 (refuted for EC): OC reads back `13.375px Arial` as stated; EC
     reads back `13.3281px Arial` (13.3 → 13.2969, 16.8 → 16.8125, `1.2em` → 19.1875), Servo's 10-bit quantization of
     the computed size (§1.2 C1b note).
4. **Odd eighths.** `font: 13.375px Georgia`, text `'The quick brown fox jumps over the lazy dog. '` repeated 4 times:
   DOM − OC is positive, between 0.3 and 1.2 px (DOM size 803/60 = 13.3833px). At `13.5px` DOM×60 == OC×60 exactly.
5. **Emoji sizes.** OC `measureText('😀')` at `Npx "Helvetica Neue"`: 10→13, 12→16, 14→19, 16→21, 20→23, 24→25, 28→28.
   DOM at DPR 2: 11.5, 12.5, 14, 16, 20, 24, 28. DOM at DPR 1 (or 50% zoom on Retina): equals OC.
6. **Emoji recipe.** OC at `24px` → 25; divided by 2 = 12.5 = DOM `12px` at DPR 2. OC at `32px`/2 = 16 = DOM `16px`.
7. **Emoji in EC.** EC `12px` at DPR 2 gives 16 (Core Text at CSS size), not 12.5.
8. **System font optical size.** `font: 14px -apple-system`, text `'The quick brown fox jumps over the lazy dog'`:
   OC < DOM < EC (default opsz in OC; `opsz 7` and `trak` at 7px in EC). With `font-optical-sizing: none` on the DOM
   span, DOM×60 == OC×60 exactly.
9. **Root lang.** Page `<html lang="ja">`, OC `font='16px sans-serif'`, `measureText('直直直')` equals DOM span with no
   lang attribute. After `document.documentElement.lang='zh-CN'`, the next OC measure equals a DOM span `lang="zh-CN"`.
   A span-level `lang="zh-CN"` in a `ja` page is not followed unless `ctx.lang='zh-CN'`.
10. **Worker lang.** In a worker OC with no `ctx.lang`, `16px sans-serif` `'直'` follows the OS locale, not the page.
11. **Whitespace replacement.** OC: `'a\tb'`, `'a\nb'`, `'ab'`, `'ab'`, `'a\rb'`, `'ab'`, `'a b'` all
    equal `'a b'`. `'a  b'` = `'a b'` + one space.
12. **Stray controls.** OC `'ab'` > `'ab'` (hexbox ≥ `aveCharWidth`); EC `'ab'` == `'ab'`; DOM span whose
    text is set with `textContent = 'ab'` == DOM `'ab'`.
13. **Bidi controls.** `18px Arial`, `'AV'` vs `'A‎V'`: OC `'A‎V'` = OC `'A'` + OC `'V'` (kerning lost); EC
    `'A‎V'` == EC `'AV'`; DOM `A&lrm;V` == DOM `AV`.
14. **Tiny letter spacing.** `24px "Hoefler Text"`, `'fi'`: OC with `letterSpacing='0.001px'` is wider than with `'0px'`
    (ligature off, no spacing); DOM `letter-spacing: 0.001px` equals DOM with `0`.
15. **Cursive spacing.** `24px "Geeza Pro"`, `'بيت'` (three letters, no lam-alef ligature): OC with
    `letterSpacing='2px'` minus OC with `'0.001px'` = 6px (2px after each of 3 cluster ends); DOM `letter-spacing: 2px`
    minus DOM with `0` = 0.
16. **Word spacing sets.** `16px Georgia`, OC `wordSpacing='10px'`: `'a b'` unchanged, `'a　b'` +10;
    DOM `word-spacing:10px`: `a&nbsp;b` +10, `a　b` +0.
17. **textRendering.** OC `'Hello world'` at `12px Georgia`, `textRendering` `optimizeSpeed` vs `geometricPrecision`:
    identical widths.
18. **CJK kerning.** `16px "Hiragino Sans"`, `'「直」。'`: OC `fontKerning='normal'` differs from `'auto'` (explicit kern
    adds `palt`), and `'none'` equals `'auto'`.
19. **Space boundaries.** `18px Arial`: OC `'A V'` == OC `'A'` + OC `' '` + OC `'V'` in ×60 integers; OC `'A V'` ==
    `'A'` + `' '` + `'V'`.
20. **Per-run bidi sums.** OC `direction='ltr'`, `18px Arial`, `'abc אבג def'` == `'abc '` + `'אבג'` + `' def'` in ×60
    integers.
21. **Zoom.** EC at 110% page zoom on DPR 2 (apd 27): widths ×27 integers; OC unchanged from 100%.
22. **SHY in canvas.** `18px Arial`, OC `'A­V'` ≥ OC `'AV'` and ≤ OC `'A'`+OC `'V'`; DOM `A&shy;V` == DOM `AV`.
23. **Rare DPR-2 hmtx mismatch.** Over 10,000 corpus words at `16px Georgia`, DOM×60 − OC×60 is 0 for ≥ 99.9% of words
    and never exceeds ±(glyph count).
24. **Break data unchanged.** Every Firefox 156 line start in `tests/wrapping` rows is a break position of the groundwork
    oracle built against 156 data (§4.4), including `lang="zh"` with `line-break: normal` on `'ぁぁぁぁ'` (breaks between
    small kana) versus `line-break: auto` (no breaks before small kana).
25. **Hyphen glyph.** `16px Georgia` paragraph `'aaaa&shy;bbbb'` forced to break at the SHY: the line's DOM width equals
    OC `'aaaa'` + OC `'‐'` if Georgia has U+2010, else OC `'aaaa-'`.

---

## 6. Differences from the groundwork's earlier readings (verified)

1. **Canvas file moved and grew** (FF155 → 156): `QuantizeFontSize` `:4203` → `:4207`; `SetFontInternalDisconnected`
   `:4399-4547` → `:4423-4611`; `ResolveFontLang` `:5359-5406` → `:5421-5478`. 156 adds `FontIsUnchanged`, a
   `FontGroupCache` MRU and splits `state.font` into `specifiedFont`/`resolvedFont`. The measure path, whitespace
   replacement, spacing provider, `GetWidth` and `totalWidth` are unchanged (diff of the FF155 file) [V].
2. **`system-ui` mismatch now has a source explanation** (groundwork W11 said "[I]"): an OffscreenCanvas never sets
   `autoOpticalSize` (`nsFont.cpp:276-279` runs only via `nsFontMetrics.cpp:149`), so opsz fonts use the default
   optical size; a connected canvas uses `size/DPR` for opsz and `trak` (§1.2). The families resolve the same way in
   both (`gfxTextRun.cpp:1947-1966`, `gfxPlatformFontList.cpp:2279-2282`) [V]. This fits PLATFORM_BUGS.md's
   `14px -apple-system` numbers (OC 206.68 < DOM 238.12 < HTML canvas 257.97).
3. **Integer recovery bound**: groundwork said exact below 2^24/60 ≈ 279,000 px. `totalWidth` is a float32 division
   (`:5277`), so the safe bound is 2^23 au ≈ 139,800 px [I].
4. **Stray control characters**: not in the groundwork's Canvas table. Release DOM and a connected canvas hide them
   (pref `layout.css.control-characters.visible` false); an OffscreenCanvas draws hexboxes with a width (§1.3) [V].
5. **Bidi controls**: groundwork said Canvas keeps them. Only an OffscreenCanvas does; a connected canvas strips them
   in `FormatUnicodeText` because it has a pres context (`nsBidiPresUtils.cpp:2249-2252`, `:2405-2408`) [V]. Also,
   `CalculateBidiClass` splits Hebrew from Arabic inside one RTL level (§1.8) [V].
6. **Language**: confirmed order; added that the root-`lang` case leaves `explicitLang = false` (`:5457-5462`) and that
   a worker OffscreenCanvas falls to the OS locale unless a `lang` was transferred (`HTMLCanvasElement.cpp:1162-1164`) [V].
7. **Emoji**: groundwork W7 guessed "error under 1/120 px". A Core Text probe on macOS 27 gives whole-pixel sbix advances
   for U+1F600 at 8–40px, and the Gecko formulas reproduce bug 2020894's Firefox table exactly, so measuring at
   `size·DPR` is exact at DPR 2 for those sizes [P].
8. **Skia rounding** (groundwork "[I]"): verified `DrawTargetSkia::GetNativeSurface` returns null and
   `gfxMacFont::ShouldRoundXOffset(nullptr)` is false, so X advances are not snapped [V]. The main-thread reference
   target's backend is still untraced.
9. **Letter spacing and ligatures**: both DOM and Canvas turn optional ligatures off, but with different thresholds:
   DOM when the resolved au value is non-zero, Canvas when the float is non-zero (§1.10) [V].
10. **Word spacing**: groundwork said Canvas spaces "each U+0020". It also spaces U+3000 (`gfxFont.cpp:749-750`) and not
    NBSP, while the DOM spaces NBSP and not U+3000 [V].
11. **PLATFORM_BUGS.md "DOM text uses the requested size on a 1/64px grid"** is wrong for Gecko: the DOM size is on a
    1/60 px grid (`ServoStyleConstsInlines.h:584-604`). That explains the entry's "odd multiples of 1/8px measure narrower,
    cause unknown": `13.375px` becomes `13.3833px` in the DOM [V/P].
12. **New in 156, compiled out**: `InitMetricsFromSkrifa` in `gfxFont.cpp`/`gfxMacFont.cpp:259-266` and Skrifa hooks in
    `CoreTextFontList.cpp`, all under `MOZ_FONTATIONS`, which needs `--enable-fontations` (**[gh]**
    `toolkit/moz.configure:888-901`); none of the macOS mozconfigs I fetched enable it [V].
13. **Break data**: every baked data file, every ICU crate version, the vendored `icu_segmenter` checksum and all C++
    the oracle ports are byte-identical to FF155; the oracle builds unchanged and dumps identical tables (§4) [V/P].
14. **`gfxHarfBuzzShaper.cpp` 155→156**: only the mutex moved later in `ShapeText` and vertical initialization got a lock;
    features, CJK kerning and rounding are unchanged [V].

## 7. Open questions

1. Backend of the main-thread `gfxPlatform::mScreenReferenceDrawTarget` on macOS (`gfxPlatform.cpp:1006`); if it had a
   Cairo context with hinted metrics, advances could snap to pixels.
2. HarfBuzz at 156 (`gfx/harfbuzz`, not checked out): does its `trak`+`STAT` tracking at 12pt add to Gecko's own
   tracking for system fonts, identically in Canvas and DOM?
3. Servo's `ParseFontShorthandForMatching` for an OffscreenCanvas: what `em`, `%` and keyword sizes resolve against.
4. What `explicitLang = false` (root-`lang` OffscreenCanvas) changes at `gfxTextRun.cpp:2958`.
5. HarfBuzz's handling of U+00AD inside a Canvas word: zero advance, and does kerning cross it?
6. Whether a U+0020 in a fallback font range gets the fallback font's space width in the DOM, which `au(' ')` would miss.
7. Whether all Apple Color Emoji sequences (flags, ZWJ, keycaps) have whole-pixel Core Text advances at all sizes.
8. Whether DOM layout splits a Hebrew+Arabic RTL run into separate text runs as Canvas does.
