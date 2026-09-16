# Blink Canvas measureText and Chrome's break data (Chrome 153.0.8010.48)

Scope: how Chrome 153 on macOS computes `CanvasRenderingContext2D.measureText().width` and `OffscreenCanvasRenderingContext2D.measureText().width`, which width facts a rebuild can take from it, and which break-opportunity data Chrome ships and selects. The line-filling loop (`line_breaker.cc`, `shaping_line_breaker.cc`) and white-space collapsing belong to the Blink line-breaker spec. This spec covers only the parts of them that pick break data.

## 0. Sources, notation and terms

**Pinned sources**
- Chrome 153.0.8010.48, tag `153.0.8010.48` (`chrome/VERSION` MAJOR=153 MINOR=0 BUILD=8010 PATCH=48).
  - The sparse checkout `~/github/browser-engines/chromium-153.0.8010.48` was still fetching (no files checked out yet).
  - Every 153 file cited here was therefore read from gitiles at that tag (`https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.48/<path>`). Those are the same bytes and line numbers the checkout will hold.
- Pins taken from `DEPS` at the tag:
  - ICU: `chromium/deps/icu.git@8cc91d9b6ab9991802fd208ee03a69714fd0251c` (`DEPS:2408-2409`)
  - V8: `6b96683d44174e78ff4e65cb274bad56dc108231` (`DEPS:344`)
  - Skia: `fca11a08da7c1ed3777b40b31611961c85c63c43` (`DEPS:340`)
- Chromium 152.0.7977.83 local checkout: `~/github/browser-engines/chromium-152/src`. It is used only for 152→153 diffs and for its built generator output.

**Citation prefixes**
- `B/` = `third_party/blink/renderer/` at the 153 tag.
- `icu153:` = the ICU pin above (`third_party/icu/`). `v8-153:` = the V8 pin. `skia153:` = the Skia pin.
- `cr152:` = the local 152 checkout.
- `data:` = `~/github/pretext-rebuild/rebuild/data/blink/`.

**Terms**
- **16.16 unit.** An integer `raw` that means `raw / 65536` px. HarfBuzz positions (`hb_position_t`) and Blink's `TextRunLayoutUnit` and `InlineLayoutUnit` use it.
- **float32.** IEEE single precision. In JavaScript, `Math.fround`.
- **8-bit string.** A WTF `String` stored one byte per character (every code unit ≤ U+00FF). A **16-bit string** is stored as UTF-16. The same text can be either, depending on how it was built.
- **Item** (Canvas). One piece of the measured string that is shaped by its own HarfBuzz call. A **word item** is an item cut by `NextWordEndIndex`.
- **Cluster.** Glyphs that HarfBuzz gives the same `character_index`.
- **UI language.** Chrome's application locale, returned by `DefaultLanguage()`. It is not the page's `lang`.
- **Typesetting features.** The bit set `kKerning | kLigatures | kCaps` stored in `FontDescription`.

---

# Part 1: Canvas `measureText`

## 1.1 Short answer

1. **Width is a float32 sum of float32 item widths.** Each item width is a float32 conversion of an integer 16.16 sum of glyph advances.
   - The accumulator is `float xpos` (`B/core/html/canvas/text_metrics.cc:179,222`). `width_` is that float widened to double (`text_metrics.cc:109-111`).
   - No rounding to device pixels, LayoutUnit or 1/64 happens anywhere on this path.
2. **Canvas splits the string before shaping.**
   - First at bidi level runs (UAX #9 through ICU ubidi), if the text may contain RTL characters or the direction is `rtl`.
   - Then into word items at U+0020, U+0009 and U+200B, and before CJK bases. It does this unless the font "cannot shape word by word".
   - Each item is shaped alone (`B/platform/fonts/plain_text_node.cc:377-418`). So by default, kerning and ligatures across spaces never show up in Canvas.
3. **Canvas fonts use the CSS pixel size.** Zoom, device pixel ratio and minimum font size are all ignored (`B/modules/canvas/canvas2d/canvas_rendering_context_2d.cc:690-706`; `B/core/css/resolver/font_style_resolver.cc:52-61`).
4. **Per-canvas shape caches make results order dependent.**
   - Word results are cached by (word text, direction) per `FontFallbackList` (`B/platform/fonts/shaping/frame_shape_cache.cc:45-65,135-149`).
   - The cached result keeps whatever script context and spacing applied the first time that word was shaped (`plain_text_node.cc:402-452`).
5. **What `letterSpacing` and `textRendering` do to features.**
   - `letterSpacing` ≠ 0 turns off `liga`, `clig` and `calt` (`B/platform/fonts/shaping/font_features.cc:52-87`).
   - `textRendering = 'optimizeSpeed'` turns off `liga`, `clig` and `calt`, and leaves `kern` on.
   - `fontKerning = 'none'` is the only setting that removes `kern` (`font_features.cc:39-50`).
   - `fontKerning = 'normal'`, `optimizeLegibility` and `geometricPrecision` add no HarfBuzz feature. They only let Canvas shape the whole string when the primary font's GPOS or GSUB lookups contain the space glyph (`B/platform/fonts/font_description.cc:341-393`; `B/platform/fonts/font_fallback_list.cc:264-286`; `B/platform/fonts/shaping/harfbuzz_face.cc:322-390`).
6. **Control characters become spaces.**
   - Canvas turns U+0009 through U+000D (TAB, LF, VT, FF, CR) into U+0020.
   - It turns SHY, ZWSP, LRM, RLM, LRE through RLO, U+FEFF and U+FFFC into U+200B (`plain_text_node.cc:47-60`; `B/platform/text/character.h:167-175,226-238`).
   - Any such change makes the working copy 16-bit (`plain_text_node.cc:66-79`).

## 1.2 Font string resolution

**Setting a font**

`ctx.font = s` calls `BaseRenderingContext2D::setFont` (`B/modules/canvas/canvas2d/base_rendering_context_2d.cc:821-837`).

```
setFont(s):
  if host is HTMLCanvasElement:                        // canvas_rendering_context_2d.cc:625-637
     if document has no frame: return                  // font stays as it was
     UpdateStyleAndLayoutTreeForElement(canvas)
  if s == state.unparsedFont and CurrentFontResolvedAndUpToDate(): return   // base:827-829
     // CurrentFontResolvedAndUpToDate = HasRealizedFont && !LangIsDirty (base:816-819),
     // and for HTMLCanvasElement also fonts_resolved_using_current_style_ not empty
     // (canvas_rendering_context_2d.cc:639-646)
  if !ResolveFont(s): return                           // invalid string: keep the old font
  state.unparsedFont = s
```

**`ResolveFont` for a connected `<canvas>`** (`canvas_rendering_context_2d.cc:662-714`):
1. `locale = LocaleFromLang()`. When `ctx.lang` is `"inherit"` (the default), this is `canvas.ComputeInheritedLanguage()`. If there is none, it is `LayoutLocale::GetDefault()`, the UI language (`base_rendering_context_2d.cc:1217-1225`; `B/core/html/canvas/html_canvas_element.cc:2012-2021`; `B/platform/text/layout_locale.cc:294-302`).
2. Look up `s` in the context's `fonts_resolved_using_current_style_`. On a hit, update the locale if it differs and use the entry (672-679).
3. On a miss:
   - Parse `s` with `CanvasFontCache::ParseFont`, which calls `CSSParser::ParseFont`. The per-document LRU keeps 50 entries (soft), 250 (hard), or 1 while the page is hidden (`B/core/html/canvas/canvas_font_cache.cc:22-27,90-124`).
   - Start from **the canvas element's computed `FontDescription`**. Set the locale, and reset `ComputedSize = AdjustedSize = SpecifiedSize` (685-695).
   - Call `StyleEngine::ComputeFont`, which is `StyleResolver::ComputeFont`. It applies **only** `font-size`, `font-family`, `font-stretch`, `font-style`, `font-variant-caps` and `font-weight` from the parsed shorthand onto a clone of that style (`B/core/css/resolver/style_resolver.cc:3284-3315`).
   - Reset `ComputedSize = AdjustedSize = SpecifiedSize` again (702-706).
   - **Consequence [V code, I effect]:** everything else in the canvas element's `FontDescription` is kept. That includes the element's CSS `letter-spacing` and `word-spacing`, which Blink stores inside `FontDescription` (`B/core/style/computed_style.h:897-906,3319-3323`), and also `font-feature-settings`, `font-variant-ligatures`, `font-variation-settings`, `font-optical-sizing`, `text-spacing-trim` and `-webkit-font-smoothing`. `font-kerning` and `text-rendering` are overwritten from the context (1.6). Letter and word spacing are overwritten only once the context has set them (1.6). The CSS `font` shorthand lists 19 longhands (`B/core/css/css_properties.json5`, entry `name: "font"`), but canvas applies only the six above.

**`ResolveFont` for a detached `<canvas>`** (no computed style; 715-729): use `CanvasFontCache::GetFontUsingDefaultStyle`, where the default style is `10px sans-serif` (`canvas_font_cache.cc:29-42,69-88`). Then set the locale and reset the sizes.

**`ResolveFont` for OffscreenCanvas** (`B/modules/canvas/offscreencanvas2d/offscreen_canvas_rendering_context_2d.cc:544-572`):
- A thread-local `OffscreenFontCache` maps the string to a `FontDescription`. It holds 250 entries (hard) and is trimmed to 25 at push-frame (49-89, 342).
- On a miss: `CSSParser::ParseFont`, then `FontStyleResolver::ComputeFont(style, base selector)`.
  - That starts from a fresh `FontDescription`. Font sizes are `(10, 10)` with zoom 1 (`font_style_resolver.cc:45-132`), so `em`/`%` sizes are relative to 10px.
  - It applies the same six properties.
  - It returns nothing for element-dependent `calc()` (22-41).
  - Then `desc.SetLocale(locale)`.
- Locale sources (`B/core/offscreencanvas/offscreen_canvas.cc:748-760`):
  - an explicit `locale_`, set by `transferControlToOffscreen` from the canvas's locale (`B/modules/canvas/htmlcanvas/html_canvas_element_module.cc:88`)
  - otherwise, on a window, `documentElement.ComputeInheritedLanguage()` read at resolve time
  - otherwise (workers) `LayoutLocale::GetDefault()`
- Font selector (`offscreen_canvas.cc:762-779`): the document's `FontSelector` on a window, the `WorkerGlobalScope`'s in a worker.

**Realizing the font** (`B/modules/canvas/canvas2d/canvas_rendering_context_2d_state.cc:366-431`): `state.SetFont(desc, UniqueFontSelector)`.

```
SetFont(desc):
  desc.SetSubpixelAscentDescent(true)
  conv = length conversion with font sizes (ComputedSize, ComputedSize) and zoom 1.0     // :372-378
  if word_spacing_is_set_:   desc.wordSpacing   = Fixed(conv.px(word_spacing_, unit))   // :390-395
  if letter_spacing_is_set_: desc.letterSpacing = Fixed(conv.px(letter_spacing_, unit)) // :399-404
  desc.kerning = state.fontKerning          // default kAutoKerning (state.h:436)
  desc.textRendering = state.textRendering  // default kAuto (state.h:434-435)
  font = UniqueFontSelector.FindOrCreateFont(desc)   // cache keyed by the whole description
                                                     // (B/core/html/canvas/unique_font_selector.cc:58-80)
```

**Generic families.** They are resolved at font-fallback time by `FontSelector::FamilyNameFromSettings`, keyed by `font_description.GetScript()`, which comes from the locale. `serif`, `sans-serif`, `monospace` and the rest map to `settings.Serif(script)` and so on (`B/platform/fonts/font_selector.cc:72-87`). So the context's locale picks the family behind a generic name.

**system-ui.** `FontCache::CreateFontPlatformData` on Mac calls `MatchSystemUIFont(weight, style, stretch, size)` (`B/platform/fonts/mac/font_cache_mac.mm:408-411`). That calls `CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, size, nullptr)` (`B/platform/fonts/mac/font_matcher_mac.mm:540-545`). Here `size` is the effective font size: CSS px in Canvas, zoomed px in the DOM. The result goes to `FontPlatformDataFromCTFont(matched, size, SpecifiedSize, ...)` (`font_cache_mac.mm:441-448`).

**Font size precision**
- The platform font is created at `EffectiveFontSize() = floorf(size * 100) / 100` (`font_description.cc:271-282`; `B/platform/fonts/font_cache_key.h:53`).
- `ctx.font` reads back `ComputedSize` without that floor (`base_rendering_context_2d.cc:802`).
- On Mac the font cache key uses device scale factor 1.0 (`font_description.cc:322-326`).

**Language changes**
- `ctx.lang = x` sets `lang_is_dirty_` and re-resolves `font()` (`base_rendering_context_2d.cc:1201-1215`; `state.cc:361-364`).
- A connected canvas hears `lang` attribute changes on itself or an ancestor. `Element::LangAttributeChanged` recurses into children without `lang` (`B/core/dom/element.cc:8119-8131`) and reaches `HTMLCanvasElement::LangAttributeChanged` (`html_canvas_element.cc:1779-1783`). There `CanvasRenderingContext2D::LangAttributeChanged` clears the resolved fonts and calls `setFont(font())` when `lang` is `inherit` (`canvas_rendering_context_2d.cc:777-785`).
- An OffscreenCanvas gets no such signal. Setting the same font string again short-circuits (base:827-829), so the old locale stays until the string or `ctx.lang` changes.

**Frame-less document.** `measureText` on an HTML canvas whose document has no frame returns an empty `TextMetrics`, with width 0 (`base_rendering_context_2d.cc:1174-1177`).

## 1.3 The measureText algorithm

```
measureText(text):                                     // base_rendering_context_2d.cc:1169-1195
  if host is HTMLCanvasElement:
     if !document.frame: return width 0
     UpdateStyleAndLayoutTreeForElement(canvas)
  font = AccessFont()                                  // realizes '10px sans-serif' if never set
  dir  = ctx.direction == inherit ? host.GetTextDirection(style) : ctx.direction
       // HTMLCanvasElement: the canvas's computed direction (html_canvas_element.cc:1988-);
       // OffscreenCanvas: text_direction_ or LTR (offscreen_canvas.cc:740-742)
  node = PlainTextPainter(kCanvas).CreateNode(TextRun(text, dir), font)   // plain_text_painter.cc:243-264
  xpos = f32(0)
  for item in node.items:                              // visual order
     xpos = f32(xpos + item.shapeResult.width)         // text_metrics.cc:181-223
  return f64(xpos)
```

`CreateNode` (`B/platform/fonts/plain_text_painter.cc:243-264`):
- `cache = GetCacheFor(font)`. That is one `FrameShapeCache` per `FontFallbackList`, or none on low-end devices (266-280).
- Look up the node by (whole original text, direction). On a hit, the whole node is reused.

```
PlainTextNode(run, normalize_space = true, font, supports_bidi = true, cache):   // plain_text_node.cc:243-263
  (content, maybeBidi) = Normalize(run.text)                                       // :278-284
  items = []
  if maybeBidi or dir == rtl:                                                      // :285
     original16 = run.text as 16-bit                                               // :291-292
     bidi.SetParagraph(original16, paraLevel = dir)       // explicit LTR/RTL level
                                                          // (B/platform/text/bidi_paragraph.cc:28-37)
     if !(bidi.IsUnidirectional() and bidi.base == LTR):                           // :306-307
        for run in bidi.GetVisualRuns():                  // visual order
           SegmentWord(content, run.start, run.length, run.direction)              // :309-318
  if items is empty:
     SegmentWord(content, 0, len, base direction)                                  // :361-363
  Shape(font, cache)                                                               // :402-453
```

`Normalize` (`plain_text_node.cc:24-82`) keeps the length unchanged:

```
for each code point c:
  if c in U+0009..U+000D:      out = U+0020          // IsNormalizedCanvasSpaceCharacter, character.h:226-238
  elif c in {U+0020, U+0009, U+000A} (TreatAsSpace, excluding NBSP): out = U+0020   // no change
  elif c in {FF, CR, U+00AD, U+200B, U+200E..U+200F, U+202A..U+202E, U+FEFF, U+FFFC}:
                               out = U+200B          // character.h:167-175; FF and CR never get here
  else                         out = c               // NBSP, U+2028, U+2066..2069 are unchanged
  maybeBidi |= MaybeBidiRtl(c)
      // c >= U+0590, excluding U+200B, U+2010..2029, U+206A..U+D7FF, U+FF00..U+FFFF,
      // U+1AFF0..U+1B16F and the rest of character.h:307-323
  if any out != c: the result is a new 16-bit string (StringBuffer<UChar>, :66-79);
  otherwise the original string (8-bit or 16-bit) is kept
```

`SegmentWord(content, start, length, dir)` (`plain_text_node.cc:377-400`):

```
if !font.CanShapeWordByWord():                   // B/platform/fonts/font.cc:220-222
   items.append(Item(start, length, dir)); return
insertion = items.size
i = 0
while i < length:
   e = NextWordEndIndex(view(content, start, length), i)
   item = Item(start + i, e - i, dir)            // item.text = content.substr(...) (plain_text_node.h:35-42)
   if dir == LTR: items.append(item) else items.insert(insertion, item)   // RTL reversed into visual order
   i = e
```

`NextWordEndIndex(text, s)` (`plain_text_node.cc:93-155`):

```
if s + 1 == len or text[s] in {U+0020, U+0009, U+200B}: return s + 1
if text is 8-bit: return the next index at or after s+1 holding U+0020 or U+0009, or len
cp = code point at s; end = s + size(cp)
if !IsCjkIdeographOrSymbol(cp):                  // character.h:97-104
   scan code points from end; stop before U+0020/U+0009/U+200B or before an IsCjkIdeographOrSymbolBase
   character (a CJK ideograph or symbol that is not M, Lm or Sk); return that index or len
hasScript = !IsCommonOrInheritedScript(cp)
for each next code point ch at index end:
   if gc(ch) in {M, Lm, Sk} or ch == ZWJ or IsEmojiComponent(ch) or IsExtendedPictographic(ch): advance; continue
   if IsCjkIdeographOrSymbol(ch):
      if IsCommonOrInheritedScript(ch): advance; continue       // "」「、。" stay with the ideograph
      if !hasScript: hasScript = true; advance; continue
   return end
return len
```

`CanShapeWordByWord` (`font_fallback_list.cc:264-286`):
- True when `GetTypesettingFeatures() == 0`.
- Otherwise, true unless the primary font (the first one with a space glyph) has the space glyph in any GPOS lookup (when `kKerning` is set) or any GSUB lookup (when `kLigatures` is set) (`harfbuzz_face.cc:322-390`). Legacy `kern`, `kerx` and `morx` tables are not checked.
- The answer is computed once per `FontFallbackList`. `FontFallbackMap` keys lists by the whole `FontDescription` (`B/platform/fonts/font_fallback_map.cc:18-27`; equality includes letter and word spacing, `font_description.cc:136-143`).

`UpdateTypesettingFeatures` (`font_description.cc:341-393`):

```
f = 0
textRendering: optimizeSpeed → f &= ~(kKerning|kLigatures); optimizeLegibility or geometricPrecision → f |= kKerning|kLigatures
kerning: none → f &= ~kKerning; normal → f |= kKerning; auto → no change
if letterSpacing is zero: common ligatures disabled → &= ~kLigatures, enabled → |= kLigatures;
                          discretionary, historical or contextual enabled → |= kLigatures
variantCaps != normal → f |= kCaps
```

So in Canvas: `auto`/`auto` gives f = 0 and word-by-word shaping. `fontKerning='normal'`, `optimizeLegibility` or `geometricPrecision` may give whole-run items. `small-caps` alone sets only `kCaps`, which `HasSpaceInLigaturesOrKerning` ignores, so shaping stays word by word. A connected canvas can inherit `font-variant-ligatures` from its element (1.2), which can set `kLigatures`.

`Shape` (`plain_text_node.cc:402-453`):

```
spacing = ShapeResultSpacing(content); spacing.SetSpacing(desc, normalize_space = true)   // :403-404
for item in items:
   e = cache.FindOrCreateShapeEntry(item.text, item.dir)            // key: text and direction only
   if e.shapeResult: item.result = e.shapeResult; continue           // reused as is, spacing included
   r = HarfBuzzShaper(item.text).Shape(font, item.dir)               // shaped alone, no outside context
   if spacing.HasSpacing(): r.ApplySpacing(spacing, item.start)      // absolute offset in content
   item.result = r; cache.RegisterShapeEntry(item, e)
```

## 1.4 Shaping one item

`HarfBuzzShaper::Shape(font, dir, 0, len)` (`B/platform/fonts/shaping/harfbuzz_shaper.cc:1061-1100`):
- **8-bit text:** one segment with `script = USCRIPT_LATIN` and fallback priority text (1072-1077).
- **16-bit text:** `RunSegmenter` over the item splits by script, emoji presentation and orientation (1082-1098).
  - Script runs come from `ScriptRunIterator`. A run of Common-only characters stays `USCRIPT_COMMON` (`B/platform/fonts/script_run_iterator.cc:184-190`).
  - `ICUScriptToHBScript` maps it with `hb_script_from_string(uscript_getShortName)` (`harfbuzz_shaper.cc:275-281`), so HarfBuzz sees `Zyyy`/Common and uses the font's DFLT script lookups instead of `latn`.
  - **Consequence [I]:** the word `)` from 8-bit text is shaped as Latin, and the same word cut from 16-bit text is shaped as Common. That is the Amiri/Noto Naskh case in PLATFORM_BUGS.md (Chromium #560614560).

`ShapeSegment` (`harfbuzz_shaper.cc:880-1058`):
- Language = the locale's HarfBuzz language (`harfbuzz_shaper.cc:860-876`; `font-language-override` can't be set from Canvas).
- `HanKerning` is constructed for every segment (895). Whether it applies depends on `HanKerning::MayApply` and text-spacing-trim (`B/platform/fonts/shaping/han_kerning.h:61-68`).
- **Font fallback per cluster.** Each cluster that shapes to .notdef is queued for the next font.
- **Small caps.** When `fontVariantCaps != normal` and the font lacks the feature, text is case-mapped with the locale and shaped with `SmallCapsFontData` (999-1008; `B/platform/fonts/opentype/open_type_caps_support.cc:87-140`). This is the only Canvas path that changes the measured characters.
- `ShapeRange` (309-358):
  - `hb_buffer_set_language/script/direction` (340-342)
  - `GetScaledFont(..., specified_size)`: x/y scale = `SkiaScalarToHarfBuzzPosition(platform size)`, ptem = specified size (`harfbuzz_face.cc:639-648`)
  - `hb_shape_full(font, buffer, features)` (351-353)
  - positions rounded to whole px only if the font is not subpixel (354-356). On Mac `setSubpixel(true)` except in web tests (`B/platform/fonts/mac/font_platform_data_mac.mm:211-262`).

HarfBuzz features (`font_features.cc:32-240`) for Canvas:

| Feature | Rule | Canvas source |
|---|---|---|
| `kern` | HarfBuzz default on; pushed off only for `kNoneKerning` (39-50) | `ctx.fontKerning = 'none'` |
| `liga`, `clig` | off if letter spacing ≠ 0, or common ligatures disabled, or (normal and `optimizeSpeed`) (52-67) | `ctx.letterSpacing`, `ctx.textRendering`, element `font-variant-ligatures` (connected canvas only) |
| `calt` | same rule with contextual ligatures (81-86) | same |
| `dlig`, `hlig` | on only if enabled and letter spacing is zero (68-79) | element style only |
| `hwid`/`twid`/`qwid`, east-asian, numeric, sub/sups | from the description (89-196, 230-239) | element style only |
| `chws` | on when `ShouldTrimAdjacent(text-spacing-trim)` and no conflicting settings (197-228) | default normal → on |
| `font-feature-settings` | appended (203-225) | element style only |

**Glyph advances on macOS**
- `HarfBuzzSkiaFontFuncs::GetFunctions` uses HarfBuzz's own `hb_ot` advances only for typefaces with `trak` and no `sbix`. Otherwise it uses Skia advances (`harfbuzz_face.cc:439-461`).
- **Skia path:**
  - `SkScalerContext_Mac::generateMetrics` calls `CTFontGetAdvancesForGlyphs` on a CTFont copy at the strike size and converts CGFloat to float (`skia153:src/ports/SkScalerContext_mac_ct.cpp:297-311`).
  - The copy turns tracking off (`NSCTFontUnscaledTrackingAttribute = 0`) and sets opsz from the base font (`skia153:src/utils/mac/SkCTFontCreateExactCopy.cpp:18-39`).
  - Above 256 px Skia measures a canonical size and scales (`skia153:src/core/SkStrikeSpec.cpp:69,118`).
  - Blink then applies `SkiaScalarToHarfBuzzPosition(v) = ClampTo<int>(v * 65536)` (`B/platform/fonts/skia/skia_text_metrics.cc:17-73,207-211`). `ClampTo` ends in `static_cast<int>`, which truncates toward zero (`B/platform/wtf/math_extras.h:190-205`).
- **Variable fonts** with `font-optical-sizing: auto` get the `opsz` axis set to the **specified** size (`font_platform_data_mac.mm:170-176`).

## 1.5 Exact arithmetic

```
size_platform  = floorf(SpecifiedSize * 100) / 100              // float; font_description.cc:271-282
advance_raw    = trunc(float32(CGFloat advance at size_platform) * 65536)      // int32, Skia path
               | HarfBuzz hb_ot advance at x_scale = trunc(size_platform * 65536)   // trak without sbix
glyph positions: HarfBuzz integer 16.16 additions (GPOS/kerx/kern), subpixel so no rounding
glyph_raw      = TextRunLayoutUnit::FromFixed<16>(x_advance)    // exact copy; shape_result.cc:1356-1358,1550-1553
run_raw        = Σ glyph_raw                                    // InlineLayoutUnit, int64 16.16
run_width      = float32(max(run_raw, 0)) / 65536               // shape_result.cc:1576; ToFloat layout_unit.h:244-246
item_width     = float32 Σ run_width (runs in order)            // shape_result.cc:1609, float width_ (shape_result.h:482-485)
with spacing (ApplySpacingOrExpansion, shape_result.cc:993-1046):
   ls_raw = trunc(letterSpacingPx * 65536); ws_raw = trunc(wordSpacingPx * 65536)   // FixedPoint(float), layout_unit.h:125-129
   at the last glyph of each cluster whose first character index is k (absolute offset in content):
      glyph_raw += (ls_raw if !TreatAsZeroWidthSpace(content[k]) and (!cursive run or k is a space))
                 + (ws_raw if content[k] is a space (U+0020, NBSP; U+0009..U+000D after normalization)
                            and (k != 0 or content[k] == NBSP))            // shape_result_spacing.cc:103-139
   run width = float32(run_raw) with NO clamp to 0, summed as float32   // :1041-1044
measure_width  = float32 Σ item_width in visual order          // text_metrics.cc:179,222
JS width       = float64(measure_width)
```

- A 16.16 value `raw/65536` is exact in float32 when `|raw| < 2^24`, which means width < 256 px. Below 256 px every step above is exact, and `Math.round(width * 65536)` recovers the integer sum.
- From 256 px to 512 px float32 steps are 1/32768 px, then 1/16384 px, and so on. Sums can round there, to nearest, ties to even.
- **Porting:** keep integers per run, convert with `Math.fround(raw / 65536)`, and accumulate with `w = Math.fround(w + itemWidth)` in the same item order.
- `TreatAsZeroWidthSpace(c)` is true for U+000C, U+000D, U+FFFC, U+00AD, default-ignorable code points, ZWNJ and ZWJ (`character.h:163-189`). After normalization, CR and FF are already spaces.
- Cursive scripts (Arabic, Syriac and the others in `IsCursiveScript`) get no letter spacing except on spaces while `IgnoreLetterSpacingInCursiveScripts` is on. It is stable (`B/platform/runtime_enabled_features.json5:3593-3594`; `shape_result_spacing.cc:118-130`).
- **Comparison against an available width.** Canvas compares nothing. For a rebuild: Blink's DOM line breaker snaps item widths with `SnappedWidth() = LayoutUnit::FromFloatCeil(width_)` (`B/platform/fonts/shaping/shape_result.h:170`; `layout_unit.h:134-136`, ceil to 1/64 of the zoomed px). It fits against an available width with one raw unit added (`AddEpsilon`, `layout_unit.h:341-343`). The groundwork's reading of the comparison `position <= available.AddEpsilon()` (`line_breaker.h:307-317` at 152) was not re-read at 153; the Blink line-breaker spec owns it.

**Letter and word spacing values** (`state.cc:83-104,871-945`):
- The string must be exactly one CSS dimension token with a length unit. `"3"` (no unit), `"10%"` and `calc()` are ignored.
- Conversion uses font sizes (ComputedSize, ComputedSize) with zoom 1, so `em` and `rem` are relative to the canvas font's CSS size.
- The flag `letter_spacing_is_set_` is set before an equal-string early return (875-877). Setting `'0px'` when the parsed string is already `'0px'` leaves the description untouched.

## 1.6 Context properties

| Property | Stored as | Effect on measurement |
|---|---|---|
| `font` | 1.2 | family, size (CSS px, floor 1/100), style, weight, stretch, variant-caps |
| `letterSpacing` | `FontDescription.letter_spacing_` (Fixed px) | +trunc16.16 per cluster (1.5). Turns off liga/clig/calt (`font_features.cc:63-86`) and the ligature typesetting bit (`font_description.cc:371-389`) |
| `wordSpacing` | `FontDescription.word_spacing_` | +trunc16.16 per space except at content offset 0. Cached per word (1.7) |
| `fontKerning` | `FontDescription.kerning` | `none` removes `kern`. `normal` sets `kKerning`, which allows whole-run items only for fonts with space in GPOS |
| `textRendering` | `FontDescription.text_rendering` (`state.cc:131-142,947-957`) | `optimizeSpeed`: liga/clig/calt off, kern on. `optimizeLegibility`/`geometricPrecision`: typesetting bits on, which can mean whole-run items. `geometricPrecision` also sets `SkFontHinting::kNone` only when a description is passed (`font_platform_data_mac.mm:264-270`); the advance code does not read hinting |
| `fontVariantCaps` | `FontDescription.variant_caps` (`state.cc:472-480`) | `smcp`/`c2sc`, or synthesis with case mapping and a smaller font (1.4). Sets `kCaps`, shaping stays word by word |
| `fontStretch` | `FontSelectionValue` (`state.cc:106-129,460-470`) | picks a different face or width variation through font matching |
| `direction` | state | paragraph level for the bidi split. Items are shaped with their run direction |
| `lang` | state, default `inherit` | locale: generic-family script, HarfBuzz language, case-mapping locale, HanKerning locale |

**CSS properties from the rebuild checklist**
- Canvas has no white-space collapsing, `tab-size`, `text-transform`, `word-break`, `overflow-wrap`, `line-break` or `hyphens`.
- Tabs are measured as U+0020 (1.3). Soft hyphens are measured as U+200B.
- On a **connected** canvas the element's `letter-spacing`, `word-spacing`, `font-feature-settings`, `font-variant-ligatures`, `font-variation-settings`, `font-optical-sizing` and `text-spacing-trim` can leak in (1.2).

## 1.7 Caches and order dependence

**Where the caches live**
- `FrameShapeCache` belongs to the host's `PlainTextPainter(kCanvas)` (`B/core/html/canvas/canvas_rendering_context_host.cc:193-199`), with one cache per `FontFallbackList` (`plain_text_painter.cc:266-280`).
- It holds a node map keyed by (whole text, direction) and a shape map keyed by (word, direction). Each is capped at 32,768 entries, halving by LRU when exceeded (`frame_shape_cache.cc:15-16,92-104`).

**When entries go away**
- `DidSwitchFrame` runs from `NotifyCachesOfSwitchingFrame` (`canvas_rendering_context_host.cc:83-90`).
  - It is called at the end of `HTMLCanvasElement::PostFinalizeFrame` (`html_canvas_element.cc:734`) and `OffscreenCanvasRenderingContext2D::FinalizeFrame` (`offscreen_canvas_rendering_context_2d.cc:144`).
  - It removes entries whose generation is neither the initial one nor the current one, and only if new entries were added since the last switch (`frame_shape_cache.cc:29-43,74-90`). **Entries created before the first frame switch are never evicted by frame switches.**
- Critical memory pressure clears all caches (`plain_text_painter.cc:284-288`).
- `UniqueFontSelector` keeps `Font` objects per description, so reassigning the same font string finds the same `Font` and the same caches (`unique_font_selector.cc:58-84`).

**Mechanisms that make one measurement depend on earlier ones** (all [V code, I effect])
1. **Script context.** A word shaped from 8-bit text is Latin; the same characters from 16-bit text go through `RunSegmenter`. Both share the key (word, direction). WTF string equality does not care about 8-bit vs 16-bit storage [I]. Sources of 16-bit text: a bidi split (RTL characters), or any normalization (TAB, LF, VT, FF, CR, SHY, bidi controls, U+FEFF, U+FFFC).
2. **Word spacing at offset 0.** A cached `" "` result keeps its first spacing decision. `measureText(" x")` then `measureText("x y")` gives the second call no word spacing on its space.
3. **Fonts that can't shape word by word.** The node is built from whole bidi runs, but the result is still cached by the run's text.
4. **Node cache.** The same whole string returns the node built the first time, even after other measurements.

## 1.8 Device pixel ratio, zoom, emoji and system-ui

- **Canvas is never zoomed.** Neither the HTML canvas nor OffscreenCanvas applies zoom to font size (1.2). The canvas backing-store scale doesn't enter `measureText`. At DPR 2, `measureText` returns the same bits as at DPR 1 for the same font, size and fonts installed.
- **The DOM on a Retina display shapes at the zoomed size.** It uses computed size = specified × layout zoom, where layout zoom includes the device scale factor. That is the groundwork's 152 reading (`web_frame_widget_impl.cc`, `style_resolver.cc`), not re-read at 153. Meanwhile opsz and HarfBuzz `ptem` get the specified (unzoomed) size (`font_platform_data_mac.mm:170-176`; `harfbuzz_face.cc:648`).
- **Apple Color Emoji at small sizes.**
  - The font has `sbix`, so advances come from Skia/CoreText at the platform size (`harfbuzz_face.cc:439-461`; `SkScalerContext_mac_ct.cpp:307-311`).
  - Canvas at 12px asks CoreText for the 12px advance. The DOM at DPR 2 asks for the 24px advance and divides by the zoom.
  - If CoreText's bitmap-emoji advance isn't linear in size, the two differ. That matches Chromium #489494015's "size-dependent, disappears at larger sizes" [I].
- **system-ui.** `CTFontCreateUIFontForLanguage(..., size)` receives CSS px from Canvas but device px from the DOM at DPR 2, while opsz is forced to the CSS size in both. Canvas at `size × DPR` also gets opsz = `size × DPR`. **No Canvas size reproduces the DOM's (CoreText size, opsz) pair** for system-ui on a Retina display [I]. This fits Chromium #489579956.
  - Measured in installed Chrome 153 on 2026-09-16 (refuted): in a clean renderer at DPR 2, DOM(S) = ceil64(2 × W(S))/128 at every size 10–28px, so Canvas at the CSS size reproduces the DOM (13px `Hello world`: DOM 67.875, W(13px) 67.8691406, W(26px)/2 62.5902023). A different DOM width appears only after a Canvas measured `2S` px system-ui first (13px: 60.5703125). `FontCacheKey` holds `EffectiveFontSize()` but not the specified size (`font_description.cc:308-331`; `font_cache_key.h:53-68`), and opsz is fixed when the platform font is created, so a Canvas at 2S and DOM text at S share one platform font whose opsz came from whichever text created it. At DPR 1 DOM = W(13px). `-apple-system` resolves like `sans-serif`; `BlinkMacSystemFont` is the system UI font.
- **Measuring at `size × zoom`** reproduces the DOM's CoreText advances only for fonts with no opsz axis and no `trak`+`STAT` tracking, whose font matching doesn't depend on size [I].

## 1.9 Runtime settings that matter at 153

`B/platform/runtime_enabled_features.json5`:

| Setting | Status | Effect |
|---|---|---|
| `IgnoreLetterSpacingInCursiveScripts` | stable (3593-3594) | letter spacing skipped inside cursive runs |
| `TextMetricsBaselines` | stable (6305-6306) | baselines attributes exist; no width effect |
| `ExtendedTextMetrics` | experimental + origin trial (2745-2748) | `getSelectionRects`, `getTextClusters` etc. off by default |
| `CanvasTextMetricsPreciseBounds` | experimental (1046-1047) | bounding boxes only |
| `HarfRustShaping` | no status (3434-3435) | off: HarfBuzz C++ is the shaper |
| `TextSpacingTrimFallback`, `TextSpacingTrimFallbackChws` | stable (6326-6339) | HanKerning fallbacks |
| `TextSpacingTrimFallback2` | test | off |
| `LineBreakerHanKerningEnd` | stable (3865-3866), new since 152 | DOM line-end HanKerning; not Canvas |

Other settings:
- `PlainTextPainter` uses no cache on low-end devices (`plain_text_painter.cc:267-269`).
- `CanvasFontCache` limits drop to 5/20 fonts in low-end mode (`canvas_font_cache.cc:22-25`).

## 1.10 152→153 differences in the Canvas and font files read

Only these files differ; all other files read have 0 changed lines:

| File | Lines changed | What changed |
|---|---|---|
| `html_canvas_element.cc` | 32 | drawElement checks, encoder calls |
| `offscreen_canvas.cc` | 24 | error strings, a use counter |
| `base_rendering_context_2d.cc/.h` | 15/4 | print recording |
| `canvas_rendering_context_2d.cc/.h` | 54/10 | recording, hibernation |
| `offscreen_canvas_rendering_context_2d.cc` | 18 | WritePixels |
| `font_cache.cc` | 9 | crash keys |
| `harfbuzz_shaper.cc` | 5 | log formatting |
| `shape_result.cc` | 25 | graphemes moved into `glyph_data_` |
| `runtime_enabled_features.json5` | 623 | adds `LineBreakerHanKerningEnd`; nothing Canvas-related |

- **None changes widths.**
- Unchanged, 0 lines: `text_metrics.cc/.h/.idl`, `canvas_rendering_context_2d_state.cc/.h`, `canvas_font_cache.cc/.h`, `font_style_resolver.cc`, `plain_text_node.cc/.h`, `plain_text_painter.cc/.h`, `frame_shape_cache.cc/.h`, `font_description.cc/.h`, `font_fallback_list.cc`, `font.cc/.h`, `font_features.cc`, `harfbuzz_face.cc`, `shape_result_spacing.cc/.h`, `bidi_paragraph.cc/.h`, `character.h/.cc`, `font_cache_mac.mm`, `font_platform_data_mac.mm`, `font_selector.cc`, `generic_font_family_settings.cc`, `font_builder.cc`, `css_font_selector*.cc`.

---

# Part 2: Chrome's break data

## 2.1 The installed ICU data

- **Identity**
  - `/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/153.0.8010.48/Resources/icudtl.dat`: 10,823,536 bytes, sha256 `a3c6d7824935e87fed17e94c2d84b7683ef360ebc5c4ea92e2ca70f361bc9314`.
  - The groundwork's `oracle/blink/data/icudtl-chrome153.dat` has the same sha256, and so do the installed 153.0.8010.36 and .37 copies.
- **ICU version.**
  - `u_getVersion` = 78.2, and the `icuver` resource gives `DataVersion 78.2.0.0` (`data:select_line_rules.out.txt`, lines 1-3).
  - The package is common-data format `CmnD`, version 1.0.0.0, with 2,360 entries.
  - Unicode 17.0 comes from the groundwork's oracle report (`u_getUnicodeVersion`); I did not re-run it.
- **Versus the 152 build.** The Chromium 152 build's `out/Trace210/icudtl.dat` (sha256 `9f48c7f9…`, 10,876,560 bytes, 2,361 entries) differs only by `icudt78l/nfkc_scf.nrm`. Every brkitr entry is byte-identical (`cmp` over all 24 extracted entries).
- **DEPS pins.**
  - 153 pins `icu.git@8cc91d9b6ab9…` (`DEPS:2408-2409`). 152 pins `d578f2e8b7bd…`.
  - The gitiles log between them has one commit: `8cc91d9b6ab9 [ICU] Exclude unused nfkc_scf.nrm from ICU data bundle`.
  - `filters/common.json` gains an `excludelist: ["nfkc_scf"]` block (`icu153:filters/common.json:172-176`).
  - `source/common/{brkiter,rbbi,rbbidata,brkeng,dictbe,lstmbe}.cpp`, `unicode/uvernum.h`, `README.chromium` and `source/data/brkitr/{root,ja,ko,zh,zh_Hant,en,de}.txt` plus the `rules/line*.txt` files are byte-identical between the two pins.
- **One ICU in the process.**
  - Chrome initializes ICU by mapping the bundle's `icudtl.dat` and calling `udata_setCommonData` (`cr153:base/i18n/icu_util.cc:93,174,248`), from `content_main_runner_impl.cc:962-968`.
  - `otool -L` on the installed framework shows no dependency on the system `libicucore`.

## 2.2 Break-iterator resources in the package

Extracted into `data:` with their ICU DataHeader. The manifest with sizes, sha256 and selection rules is `data:manifest.json`.

| Entry | Bytes | Contents |
|---|---|---|
| `line.brk` | 73,424 | strict rules, 65 categories, 365 states |
| `line_normal.brk` | 73,312 | 65 categories, 365 states |
| `line_normal_cj.brk` | 74,416 | 66 categories, 367 states |
| `line_loose.brk` | 75,584 | 66 categories, 375 states |
| `line_loose_cj.brk` | 80,240 | 70 categories, 382 states |
| `line_phrase_cj.brk` | 78,560 | |
| `line_normal_phrase_cj.brk` | 79,552 | |
| `line_loose_phrase_cj.brk` | 85,584 | |
| `char.brk` | 14,048 | 8-bit rows |
| `word.brk` | 23,168 | |
| `sent.brk`, `sent_el.brk` | 19,856, 19,872 | |
| `cjdict.dict` | 2,007,344 | |
| `thaidict.dict` | 126,144 | |
| `laodict.dict` | 52,112 | |
| `khmerdict.dict` | 94,240 | |
| `burmesedict.dict` | 254,448 | |
| `jaml.res` | 12,832 | Japanese phrase model |
| `root.res`, `ja.res`, `ko.res`, `zh.res`, `zh_Hant.res`, `res_index.res`, `en.res`, `en_US.res`, `de.res`, `el.res`, `es.res`, `fr.res`, `it.res`, `pt.res`, `ru.res` | | brkitr resource bundles |

- Every `.brk` file has format `Brk ` version 6.0.0.0, data version 4.1.0.0, RBBI magic `0xb1a0`.
- Line tables use 16-bit rows. `char.brk` uses 8-bit rows (flags 5).
- Not shipped: `line_cj.brk`, `title.brk`, `word_POSIX`, LSTM models.

Resource tables, dumped with Chromium ICU 78.2 source over this package (`data:select_line_rules.cc`, output `data:select_line_rules.out.txt`):
- `root/boundaries`: grapheme=char.brk, **line=line_normal.brk**, line_loose=line_loose.brk, line_normal=line_normal.brk, line_strict=line.brk, sentence=sent.brk, title=title.brk (missing), word=word.brk.
- `root/dictionaries`: Hani, Hira, Kana=cjdict.dict; Khmr=khmerdict.dict; Laoo=laodict.dict; Mymr=burmesedict.dict; Thai=thaidict.dict.
- `ja/boundaries`: line=line_normal.brk, line_normal=line_normal_cj.brk, line_strict=line.brk, line_loose=line_loose_cj.brk, line_phrase=line_phrase_cj.brk, line_normal_phrase=line_normal_phrase_cj.brk, line_loose_phrase=line_loose_phrase_cj.brk, line_strict_phrase=line_phrase_cj.brk.
- `ko/boundaries`: like ja, except line_strict=**line_cj.brk** (missing).
- `zh/boundaries` and `zh_Hant/boundaries`: line=line_normal_cj.brk, line_normal=line_normal_cj.brk, line_strict=line.brk, line_loose=line_loose_cj.brk.
- `en`, `de`, `es`, `fr`, `it`, `pt`, `ru`: no boundaries table (sentence exceptions only). `el`: sentence=sent_el.brk.

## 2.3 From CSS to a rule file

**Step 1. Style to iterator settings** (`B/core/layout/inline/line_breaker.cc:4557-4641`; `StrictnessFromLineBreak` 57-71):

```
if !auto_wrap (white-space without wrapping: nowrap, pre): settings untouched, no soft wrap
locale = font_description.Locale()                   // null when no lang anywhere (4566)
if line-break == anywhere: strictness = default; type = kBreakCharacter   // 4569-4572
else:
  strictness = {auto, after-white-space: default; normal: kNormal; strict: kStrict; loose: kLoose}   // 4574
  word-break normal → kNormal; break-all → kBreakAll; keep-all → kKeepAll                           // 4577-4594
  word-break break-word → kNormal and break_anywhere_if_overflow (unless line-clamp ellipsis)       // 4585-4590
  word-break auto-phrase → kPhrase and hyphens = none (unless disable_phrase_)                      // 4595-4608
  overflow-wrap anywhere, or break-word in content mode → break_anywhere_if_overflow               // 4611-4616
  break_anywhere_if_overflow and (override_break_anywhere_ or min-content mode) → kBreakCharacter   // 4617-4623
hyphens none → soft hyphen disabled; otherwise enabled                                             // 4628-4634
break-spaces → kAfterEverySpace; otherwise kAfterSpaceRun                                          // 4636-4641
```

**Step 2. Locale string** (`B/platform/text/text_break_iterator.h:274-288`; `layout_locale.cc:138-150,368-428`):

```
if locale is null: key = ""
elif strictness == default and type != kPhrase: key = locale.LocaleString()        // e.g. "ja-JP"
else: key = uloc_setKeywordValue(locale, "lb", {normal, strict, loose, or removed for default})
            + (type == kPhrase ? ";lw=phrase" : "")
      // a locale string already containing '@' is returned unchanged (layout_locale.cc:376-378)
```

**Step 3. Iterator pool** (`B/platform/text/text_break_iterator_icu.cc:59-108`):

```
Take(key):
  reuse a pooled iterator with this key (4 entries, kCapacity at :108)
  it = createLineInstance(key empty ? CurrentTextBreakIcuLocale() : Locale(key))   // :72-75
  if key non-empty and open failed: it = createLineInstance(CurrentTextBreakIcuLocale())   // :78-82
  // CurrentTextBreakIcuLocale = UI language (text_break_iterator_internal_icu.cc:31-45)
```

**Step 4. ICU's choice** (`icu153:source/common/brkiter.cpp:433-455`, `buildInstance` 57-136):

```
type = "line"; if keyword lb present: type += "_" + lb
if language is ja or ko and lw == "phrase": type += "_phrase"
bundle = ures_openNoDefault("icudt78l-brkitr", locale)       // falls back through the parent chain to root
file = bundle["boundaries"][type] with fallback; udata_open(file); phrase flag = type contains "phrase"
```

**Result** (measured with `data:select_line_rules.cc`):

| Blink setting | root, en, de, fr, ru, ar, he, th, hi, yue, und, invalid | ja, ja-JP | ko, ko-KR | zh, zh-CN, zh-Hans | zh-TW, zh-HK, zh-Hant |
|---|---|---|---|---|---|
| line-break auto | line_normal | line_normal | line_normal | **line_normal_cj** | **line_normal_cj** |
| normal (@lb=normal) | line_normal | line_normal_cj | line_normal_cj | line_normal_cj | line_normal_cj |
| strict (@lb=strict) | line | line | **open fails** → UI-language table | line | line |
| loose (@lb=loose) | line_loose | line_loose_cj | line_loose_cj | line_loose_cj | line_loose_cj |
| auto-phrase, auto (@lw=phrase) | line_normal | line_phrase_cj | line_phrase_cj | line_normal_cj | line_normal_cj |
| auto-phrase + normal | line_normal | line_normal_phrase_cj | line_normal_phrase_cj | line_normal_cj | line_normal_cj |
| auto-phrase + strict | line | line_phrase_cj | line_phrase_cj | line | line |
| auto-phrase + loose | line_loose | line_loose_phrase_cj | line_loose_phrase_cj | line_loose_cj | line_loose_cj |
| no locale (no lang, no Content-Language) | the UI language's `auto` entry: line_normal_cj for a zh UI, line_normal for en | | | | |

How the tables differ (probed with ICU C over `data:*.brk`):
- `中〜文`: line_normal and line gives boundaries [2,3]; line_normal_cj and line_loose_cj give [1,2,3]. The _cj tables allow a break before U+301C.
- `ゝゞ々ぁァ`: line_normal gives [3,4,5]; line (strict) gives [5]; line_loose and line_loose_cj give [1,2,3,4,5].

## 2.4 Break opportunities using the data

`LazyLineBreakIterator::NextBreakablePosition` (`B/platform/text/text_break_iterator.cc:267-387`; dispatch 432-446) for kNormal, kPhrase, kBreakAll and kKeepAll:

```
Context at pos: last = str[pos-1] if pos > start_offset; lastLast = str[pos-2] if pos > start_offset+1   // :185-199
for i from pos:
  cur = str[i]
  if kAfterSpaceRun: if cur in {SP, TAB, LF}: continue; if last in {SP, TAB, LF}: return i            // :283-291
  if kAfterEverySpace: if last is SP/TAB/LF or other Zs: return i;
                       if cur is SP/TAB/LF or other Zs and i+1 < len: return i+1                        // :292-302
  fast = ShouldBreakFast:                                                                              // :216-260
     if last < U+0021 or cur < U+0021: NoBreak
     if last == '-': if cur <= U+007F and cur is an ASCII digit: CanBreak iff lastLast is ASCII alphanumeric, else NoBreak;
                     if cur > U+007F: Unknown
     if last <= U+00FF and cur <= U+00FF:
        bit = kFastLineBreakTable[last-0x21][(cur-0x21)/8] & (1 << ((cur-0x21)%8))   // data:break_iterator_data_inline_header.h
        if !bit: NoBreak; if soft hyphen disabled and last == U+00AD: NoBreak; else CanBreak
     else Unknown
  if fast == CanBreak: return i
  if kBreakAll (cur not a lead surrogate):                                                             // :311-337
     if strictness loose and cur in {U+2010, U+2013} and lastClass in {NU, AL, SA, ID}: return i
     class = Line_Break(cur), with '+' treated as AL (:116-123)
     if kBreakAllLineBreakClassTable[lastClass][class] and !(class == BA and cur != '|' and !loose): return i (i-1 if cur is a trail surrogate)
     if class != CM: lastClass = class
  if kKeepAll and ShouldKeepAfterKeepAll(lastLast, last, cur): continue   // L/N on both sides, not SA; a mark counts as its base (:157-165)
  if fast == NoBreak: continue
  if i <= start_offset: continue
  ICU: nextBreak = following(i-1-start_offset) + start_offset on an iterator over text[start_offset..]   // :350-382
       (with soft hyphen disabled, skip boundaries right after U+00AD)
  if i == nextBreak and last is not a space: return i
return len
```

- **kBreakCharacter:** grapheme boundaries from `CharacterBreakIterator` over `text[start_offset..]`. 16-bit text uses `char.brk` (`text_break_iterator.cc:419-430`; `character_break_iterator.cc`).
- **Restart at line starts.** The ICU text starts at `start_offset`, which is the line start (`text_break_iterator.h:159-163,225-242`), so context before the line is invisible to ICU.

**The generated pair table**
- `character_data` runs `character_data_generator` with `$root_build_dir/icudtl.dat` as input and produces `break_iterator_data_inline_header.h` (`B/platform/BUILD.gn:133-148`).
- `LineBreakData::FillFromIcu` asks `createLineInstance("en")` (which resolves to root line_normal.brk) about `isBoundary(1)` for every pair from U+0021 to U+00FF (`B/platform/text/character_property_data_generator.cc:431-447`). `FillAscii` then overrides the ASCII pairs (457-495). The package is loaded with `udata_setCommonData` (52-72).
- `data:break_iterator_data_inline_header.h` (sha256 `a32fc28f…`) is byte-identical to Chromium's own generator output in the 152 build (`cr152:out/Trace210/gen/third_party/blink/renderer/platform/text/break_iterator_data_inline_header.h`).
- The generator source is unchanged 152→153 (0 lines), and the brkitr data it reads is identical, so this is the 153 table.

**152→153 diffs in the break code.** 0 changed lines in `text_break_iterator.cc`, `text_break_iterator.h`, `text_break_iterator_icu.cc`, `text_break_iterator_internal_icu.cc`, `character_property_data_generator.cc`, `layout_locale.cc` and `character_break_iterator.cc`.

## 2.5 Do the groundwork's TypeScript readers read these tables unchanged?

**`runtime/rbbi.ts`: yes.**
- `parseBreakRules` accepts a DataHeader with `Brk ` version 6 and RBBI magic `0xb1a0` v6, 8- or 16-bit rows, and a fast trie with 8- or 16-bit values (`rbbi.ts:51-112`). Every extracted `.brk` has that header.
- The extracted files are byte-identical to `runtime/data/chrome153/*` (all 16 the groundwork extracted; `sent_el.brk` is new here).
- **Parity run (this session).** 17 strings (ASCII punctuation, Latin-1, CJK quotes, U+301C, Hangul, Arabic, Hebrew, emoji ZWJ and flags, dashes, SHY/ZWSP/WJ/NBSP, iteration marks, combining marks). Each went through rbbi.ts over `data:*.brk` and through ICU C 78.2 (`RuleBasedBreakIterator(binary rules)`).
  - 0 differences for line, line_normal, line_normal_cj, line_loose, line_loose_cj and char.
  - The three phrase tables: 0 differences on the 11 strings without dictionary characters. The 6 strings with Han/Kana in a dictionary category were skipped, because ICU would run cjdict or the ML engine there and rbbi.ts has no dictionary engine.

**`runtime-parity/blink-webkit` (`blink-scan.ts`, `icu-line.ts`): reads the data unchanged, but the scan covers only part of Blink.**
- **What it reads.** Base64 copies of Chrome 153 `line_normal.brk` and `line_normal_cj.brk`, taken from the same bytes (`generated/icu-line-data.ts`, via `tools/gen-data.ts:81-87`). The pair table comes from the same generated header (`gen-data.ts:32`).
- **What it would need to cover all of Blink:**
  - strict, loose and phrase tables
  - the ja/ko `@lb=normal` → cj mapping. `blinkLineTable` only checks for `zh` (`blink-scan.ts`), so `ja` with `line-break: normal` would open the wrong table.
  - the ko strict failure and the UI-language fallback for missing or invalid locales
  - kBreakAll (class table and LB21 rule), kAfterEverySpace, soft hyphen disabling, kBreakCharacter
  - restarting ICU at each line start. The scan runs one ICU pass over the whole text.
  - real dictionary engines. The scan uses `Intl.Segmenter` words in SA runs as a stand-in.

## 2.6 `Intl.v8BreakIterator` as an in-page oracle

- **Same data: yes.**
  - V8 builds against `//third_party/icu` (`v8-153:gni/v8.gni:253`). In Chrome it runs in the same process ICU that `base::i18n::InitializeICU` loaded from the same `icudtl.dat` (2.1).
  - `Intl.v8BreakIterator` is installed with no flag check (`v8-153:src/init/bootstrapper.cc:3688-3722`).
  - `type: 'line'` calls `icu::BreakIterator::createLineInstance(icu_locale)` (`v8-153:src/objects/js-break-iterator.cc:85-90`).
- **Differences from Blink:**
  1. **No keywords.** The locale is resolved with an empty set of relevant extension keys (`js-break-iterator.cc:53-54`). `LookupAndValidateUnicodeExtensions` clears all extensions and adds back only relevant keys (`v8-153:src/objects/intl-objects.cc:2509,2545,2581`). So `-u-lb-strict` never reaches ICU, and it can open only the "no keyword" table per locale: line_normal, or line_normal_cj for zh. Strict, loose, `ja`/`ko` normal and phrase tables are unreachable.
  2. **Different fallback.** An unavailable locale goes to `isolate->DefaultLocale()` (`intl-objects.cc:2631`), not to Blink's UI-language retry.
  3. **Only the ICU half.** It knows nothing of Blink's space rule, the generated Latin-1 pair table, the `-`+digit rule, break-all, keep-all or soft-hyphen handling (2.4).
  4. **Forward only.** It exposes only `first`, `next`, `current` and `breakType`. To match Blink, `adoptText(text.slice(lineStart))` per line and walk `next()`.
- **Earlier measurement.** The groundwork ran headless Chromium 147 and found the lb keyword dropped (`pretext-emulation-20260915/NOTES.md:69`; `runtime/results/v8bi.json`). It also found 24 of 19,338 LineBreakTest cases where headless 147's V8 disagreed with the Chrome 153 `line_normal.brk`; that was a different ICU build. Installed 153 should show 0 (hypothesis H20).

---

## (e) What Canvas can supply

Exact facts, meaning integer 16.16 totals below 256 px:
1. **Width of a string shaped alone** in the primary-font context, for a string that Canvas keeps as one item: no U+0020/U+0009/U+200B, no CJK base after the first character, one bidi level.
   - Recipe: `raw = Math.round(measureText(s).width * 65536)`.
   - For 8-bit strings the script is Latin. For 16-bit strings it follows `RunSegmenter` over the string alone.
2. **Isolated cluster advances:** `measureText(grapheme)`.
3. **In-word pair adjustments:** `W("AV") − W("A") − W("V")`, covering kerning, ligatures and contextual forms inside words. Totals only; no attribution to a glyph.
4. **Cross-space GPOS/GSUB adjustments,** for fonts whose GPOS or GSUB lookups contain the space glyph. Set `textRendering = 'optimizeLegibility'` (or `fontKerning = 'normal'`) and measure `W("L F")` with the space inside; `W("L F") − W("L") − W(" ") − W("F")`. For other fonts Canvas splits words, and cross-space effects from legacy `kern`/`kerx`/`morx` aren't visible.
5. **Letter and word spacing arithmetic.** It is exactly Blink's (1.5). It is simpler to measure spacing-free and add `trunc(ls·65536)` per cluster in JS, which avoids the offset-0 and cache effects.
6. **Hyphen width:** `W("‐")` or `W("-")`.
7. **Device-size advances** for fonts without an opsz axis and without `trak`+`STAT`: set `ctx.font` to `size × zoom` (the 1/100 floor applies in both paths) and divide.
8. **Font-size quantization** is visible directly: widths are equal for sizes that floor to the same 1/100.

Not obtainable from Canvas:
1. HarfBuzz unsafe-to-break flags, and which glyph carries an adjustment.
2. Which font each cluster used (fallback identity) and its tables (`trak`, `STAT`, `halt`, `chws`, whether U+2010 exists, whether the space is in GPOS or GSUB). Some can be inferred, but never proven absent.
3. The DOM's script context for characters shaped inside a longer item. A punctuation-only Canvas word from 16-bit text is Common, while the DOM resolves script over the item.
4. CoreText size plus opsz pairs that the DOM uses at DPR ≠ 1 for opsz or system-ui fonts; bitmap emoji advances at device size other than by measuring at `size × DPR`, which is a hypothesis (H19).
   - Measured in installed Chrome 153 on 2026-09-16: measuring emoji at `size × DPR` is exact (DOM = ceil64(W(2 × size))/128 at 8–32px; the emoji probe is H17, not H19). `system-ui` in a clean renderer is reproduced by Canvas at the CSS size (§1.8 note). What Canvas can't supply is the renderer's font-cache order: which text created the platform font first.
5. The UI language, which picks generic families for unlabeled canvases and break tables for unlabeled content.
6. Any break data. `Intl.v8BreakIterator` supplies only ICU's "no keyword" tables (2.6).
7. Order-independent widths for words whose cached result depends on earlier strings. The rebuild must control measurement order, or use fresh canvases, for words that can occur in both 8-bit and 16-bit strings or with word spacing.
8. On a connected canvas, widths free of the element's inherited font properties. Use OffscreenCanvas.
9. Exact 16.16 values for totals ≥ 256 px.

## (f) Hypotheses to probe in installed Chrome 153

Unless stated otherwise:
- Use a fresh `OffscreenCanvas(1,1)` 2D context per probe.
- `W(s)` means `ctx.measureText(s).width`, and `W0` means a third fresh context with no spacing.
- The page has `<html lang="en">`.
- Fonts are system fonts, or the suite's web fonts from `tests/wrapping/fonts` loaded with `FontFace` before measuring.

1. **H1, float32 accumulation.**
   - Probe: `16px Arial`, `s = "Hello brave new world"`.
   - Expected: `W(s) === fround(fround(fround(fround(fround(fround(fround(W("Hello")+W(" "))+W("brave"))+W(" "))+W("new"))+W(" "))+W("world")))`, and `W(s)*65536` is an integer.
2. **H2, control characters as spaces.**
   - Probe: `16px Arial`, `W("a\rb")`, `W("a\fb")`, `W("a\vb")`, `W("a\tb")`, `W("a\nb")`.
   - Expected: each `=== W("a b")`.
3. **H3, SHY and bidi controls as ZWSP.**
   - Probe: `16px Arial`.
   - Expected: `W("ab­cd") === fround(W("ab") + W("cd"))` and `W("​") === 0`, and the same for `"ab‪cd"`.
4. **H4, letterSpacing turns off ligatures and alternates, keeps kerning.**
   - Probe: `40px "Shantell Sans"` (suite web font) and `40px "Hoefler Text"`.
   - Expected: `W("ffi")` with `letterSpacing='1px'` minus 3 `===` `W("ffi")` with `letterSpacing='0px'` and `textRendering='optimizeSpeed'`, bit for bit.
5. **H5, optimizeSpeed keeps kerning.**
   - Probe: `40px Arial`.
   - Expected: `W("AV")` is equal under `textRendering='optimizeSpeed'` and `'auto'`, and differs from `fontKerning='none'` (if Arial kerns AV). `fontKerning='normal'` added to optimizeSpeed gives the same width.
6. **H6, whole-string shaping only with space in GPOS/GSUB.**
   - Probe: `40px Arial` and `40px "Times New Roman"`, `s = "AV AV"`.
   - Expected by default: `W(s) === fround(fround(W("AV")+W(" "))+W("AV"))`.
   - Expected under `textRendering='optimizeLegibility'`: either the same value (space not in GPOS/GSUB coverage) or the DOM's whole-run width. For Times, if its cross-space kerning comes only from legacy `kern` (`pretext-emulation-20260915/NOTES.md:81`), the value stays equal to the split sum.
   - Measured in installed Chrome 153 on 2026-09-16: by default the split sum (Arial 111.89453125, Times New Roman 115.234375). Under `optimizeLegibility` both fonts give the DOM whole-run width (Arial 109.6875, Times New Roman 112.3046875). The guess that Times New Roman stays split is wrong: on macOS 27 its space glyph is in GPOS or GSUB coverage.
7. **H7, word-spacing order dependence.**
   - Probe: `16px Arial`, `wordSpacing='10px'`.
   - Context A measures `W(" x")`, then `W("x y")`. Context B measures `W("x y")`, then `W(" x")`.
   - Expected: `A1 === W0(" x")`, `A2 === W0("x y")` (no +10), `B1 === W0("x y") + 10`, `B2 === W0(" x") + 10`.
8. **H8, normalization makes text 16-bit and changes punctuation script.**
   - Probe: `16px Amiri`.
   - Expected on a fresh context: `W(")") ≈ 4.080`.
   - Expected on another fresh context, measuring `W("\t)")` first and then `W(")")`: the second is `≈ 7.328`, the Common-script form, and `W("\t)") === fround(W(" ") + 7.328…)`.
9. **H9, entries from before the first frame persist.**
   - Probe: a connected `<canvas>`, `16px Amiri`. Measure `W("(ب⁠ب)")`, then run 3 `requestAnimationFrame` callbacks that each `fillRect`, then `W(")")`.
   - Expected: `W(")") ≈ 7.328` (not 4.080).
10. **H10, zoom and DPR independence.**
    - Probe: `16px "Helvetica Neue"`, `"Hello world"`, on a Retina display (DPR 2) at page zoom 100%, 110% and 175%, and on an external DPR 1 display.
    - Expected: identical `W`.
11. **H11, 1/100 size floor.**
    - Probe: `W("Hello world")` at `13.337px Arial` and `13.33px Arial`.
    - Expected: equal; `13.34px` differs; `ctx.font` reads back `13.337px Arial`.
12. **H12, a connected canvas inherits element font properties.**
    - Probe: `<canvas style="letter-spacing:5px">` in the DOM, `ctx.font='40px Arial'`, `ctx.letterSpacing` never set.
    - Expected: `W("abc") === W_offscreen("abc") + 15` at DPR 1, and possibly +30 at DPR 2 [I: element spacing stored zoomed].
    - After `ctx.letterSpacing='0px'`: unchanged. After `ctx.letterSpacing='0em'`: +0.
    - Same probe with `style="font-feature-settings:'liga' 0"` on `"ffi"` in a ligature font: differs from OffscreenCanvas.
13. **H13, OffscreenCanvas keeps the language it was resolved with.**
    - Probe: `ctx.font='32px serif'`, `W("Hello, world")`. Then `document.documentElement.lang='ja'`, then `ctx.font='32px serif'` again.
    - Expected: `W` unchanged. After `ctx.font='32px  serif'` (two spaces): `W` changes to the Japanese serif family's width. `ctx.lang='ja'` also changes it.
14. **H14, a connected canvas follows lang changes.**
    - Probe: same as H13 on a connected `<canvas>` with no `lang` of its own, without touching `ctx.font`.
    - Expected: `W` changes right after `lang='ja'`.
15. **H15, transferred canvas language.**
    - Probe: `<canvas lang="ja">`, `transferControlToOffscreen()`, then in a worker `ctx.font='32px serif'`, `W("Hello, world")`.
    - Expected: equals the Japanese result. A worker's own `new OffscreenCanvas` follows the UI language.
16. **H16, system-ui on Retina.**
    - Probe: DPR 2, `13px system-ui`, `"Hello world"`; DOM span at 13px (Range width); `W` at `13px` and at `26px`.
    - Expected: some sizes in 10-28px where DOM ≠ `W(13px)` and also DOM ≠ `W(26px)/2`; at DPR 1, DOM === `W(13px)` within 1/64 px.
    - Measured in installed Chrome 153 on 2026-09-16 (refuted): at DPR 2 in a clean renderer DOM = ceil64(2 × W(S))/128 at every size 10–28px. DOM differs from both W(13px) and W(26px)/2 (60.5703125) only after a Canvas measured 26px system-ui first. At DPR 1 DOM 67.875 = W(13px) within 1/64. See the §1.8 note.
17. **H17, emoji at small sizes.**
    - Probe: DPR 2, `12px "Helvetica Neue"`, `"😀"`.
    - Expected: DOM Range width equals `W` at `24px` divided by 2 (±1/128 px) and differs from `W` at `12px`; at DPR 1, DOM equals `W(12px)`.
18. **H18, negative spacing isn't clamped.**
    - Probe: `16px Arial`, `letterSpacing='-20px'`.
    - Expected: `W("ab") < 0`.
19. **H19, invalid spacing strings are ignored.**
    - Probe: `letterSpacing='3'` or `'10%'` after `'2px'`.
    - Expected: `W("ab")` still includes +4.
20. **H20, v8BreakIterator drops keywords and uses 153's tables.**
    - Probe: `bi = new Intl.v8BreakIterator([L], {type:'line'}); bi.adoptText("中〜文")`, collect `first()` and then `next()` until -1.
    - Expected: L=`zh` gives [0,1,2,3]; `en` gives [0,2,3]; `ja-u-lb-normal` gives [0,2,3] with `resolvedOptions().locale === "ja"`. For `"ゝゞ々ぁァ"` with `en`: [0,3,4,5].
    - Over LineBreakTest.txt with `en`: 0 differences from rbbi.ts over `data:line_normal.brk`.
21. **H21, DOM table per lang and line-break.**
    - Probe: `<div lang=X style="font:16px 'PingFang SC'; width:1px; line-break:Y">中〜文</div>`, counting lines with `Range.getClientRects()`.
    - Expected: zh/auto 3, en/auto 2, ja/auto 2, ja/normal 3, ja/strict 2, ko/loose 3, en/loose 2, zh-TW/auto 3.
22. **H22, ko strict falls back to the UI language.**
    - Probe: same as H21 with `lang=ko`, `line-break:strict`.
    - Expected: 3 lines if Chrome's UI language is Chinese (this Mac's `AppleLanguages` starts with `zh-Hans`), 2 if English.
23. **H23, unlabeled content uses the UI language.**
    - Probe: a page with no `lang` and no Content-Language, `<div style="width:1px">中〜文</div>`.
    - Expected: 3 lines with a Chinese UI, 2 with an English UI.
24. **H24, small-caps synthesis.**
    - Probe: `32px Arial`, `fontVariantCaps='small-caps'`.
    - Expected: `W("HELLO")` equals the width with `normal`; `W("hello")` is less than `W("HELLO")` with `normal` and differs from `W("hello")` with `normal`.
25. **H25, rtl alone doesn't split LTR text.**
    - Probe: `16px Arial`, `direction='rtl'`.
    - Expected: `W("abc def")` equals the LTR width.

## (g) Differences from the groundwork's readings, verified here

1. **CR and FF in Canvas.** `blink-source.md` §4.3 said Canvas turns CR and FF into ZWSP. At 153 the Canvas branch `IsNormalizedCanvasSpaceCharacter` (U+0009 through U+000D) runs first (`plain_text_node.cc:47-50`), so CR, FF and VT become U+0020. The ZWSP mapping of CR and FF applies only in the non-Canvas `kShared` mode.
2. **16-bit copies.** §4.2's "8-bit text splits only at space and tab" is correct, but any normalization produces a 16-bit copy (`plain_text_node.cc:66-79`). Its words go through `RunSegmenter` instead of forced Latin, which matters for punctuation script (1.4, H8).
3. **HanKerning in Canvas.** §6 row 13 "per-character CJK words mean Canvas never shows HanKerning [I]" doesn't hold as stated. Common/Inherited CJK symbols stay in the word of the preceding ideograph (`plain_text_node.cc:129-153`), and HanKerning is set up for every segment (`harfbuzz_shaper.cc:895`). Whether it applies inside a Canvas word needs `HanKerning::MayApply`, not read here.
4. **Inherited element font properties.** Not in the groundwork. A connected HTML canvas resolves only six font properties on top of the canvas element's `FontDescription` (`style_resolver.cc:3284-3315`; `canvas_rendering_context_2d.cc:685-706`). The element's letter-spacing, word-spacing, feature settings and similar properties leak in until the context sets its own (`state.cc:390-404`).
5. **Cache structure.** §4.3's "cached per FontFallbackList, keyed by (text, direction), evicted between frames" is refined:
   - two maps with 32,768-entry caps (`frame_shape_cache.cc:15-16`)
   - entries from the initial generation are never evicted by frame switches (29-43, 80-86)
   - cached word results include spacing from their first use (`plain_text_node.cc:406-451`), which gives the new word-spacing order effect (H7)
6. **OffscreenCanvas zoom.** §4.4 "OffscreenCanvas has no zoom [I]" is confirmed: `FontStyleResolver::ComputeFont` uses font sizes (10, 10) and zoom 1 (`font_style_resolver.cc:52-61`).
7. **Canvas locale sources.** §4.4 now also includes:
   - `transferControlToOffscreen` passes the canvas locale (`html_canvas_element_module.cc:88`)
   - worker OffscreenCanvas and unlabeled HTML canvases use `LayoutLocale::GetDefault()`, the UI language (`offscreen_canvas.cc:748-760`; `html_canvas_element.cc:2012-2021`)
   - an OffscreenCanvas keeps a stale locale when the font string is unchanged (`base_rendering_context_2d.cc:827-829`)
8. **Oracle report defaults.** The groundwork's `oracle/blink/results/rules-report-chromium-icu.json` lists `"" → line_normal_cj.brk` and `ko@lb=strict → line_normal_cj.brk`. Those come from the oracle's `--ui-locale zh-CN` fallback. ICU itself opens `line_normal.brk` for an empty locale, and fails `ko@lb=strict` with `U_FILE_ACCESS_ERROR` (`data:select_line_rules.out.txt`). That confirms §1.5's [I] prediction.
9. **Phrase tables.** The §1.5 mapping table matches the 153 resource dump for all its rows. Added here: `ja`/`ko` phrase tables (`line_phrase_cj` for no lb or strict, `line_normal_phrase_cj`, `line_loose_phrase_cj`), and `zh` ignores `lw=phrase`.
10. **v8BreakIterator keywords.** §1.5 said "same data in V8 [V]". Confirmed at the 153 V8 pin, and now shown in source to drop `-u-lb-*`: empty relevant extension keys (`js-break-iterator.cc:53-54`; `intl-objects.cc:2509,2545,2581`). It falls back to V8's default locale (`intl-objects.cc:2631`).
11. **ICU pin.** The oracle's ICU build comes from the 152 pin `d578f2e8`. The 153 pin `8cc91d9b` differs only by the `nfkc_scf` filter commit, and the break C++ sources are byte-identical, so the oracle's ICU code stands for 153.
12. **Pair table provenance.** The groundwork's pair table is Chromium's generated table: byte-identical to the 152 build's generator output, and the generator is unchanged in 153.
13. **Line numbers that moved from 152 to 153:**
    - `canvas_rendering_context_2d.cc` zoom resets: 677-696 → 687-706
    - `base_rendering_context_2d.cc` `measureText`: 1180-1204 → 1169-1195
    - runtime flags: `ExtendedTextMetrics` 2745-2748, `TextMetricsBaselines` 6305-6306, `IgnoreLetterSpacingInCursiveScripts` 3593-3594, `CanvasTextMetricsPreciseBounds` 1046-1047
    - `text_break_iterator*.cc`, `character_property_data_generator.cc`, `plain_text_node.cc`, `text_metrics.cc`, `font_features.cc` and `font_description.cc` keep their 152 line numbers (0-line diffs)

## Open questions

- `HanKerning::MayApply` conditions for Canvas words (not read).
- Whether `WTF::String::substr` of a 16-bit string whose characters are all ≤ U+00FF stays 16-bit. Assumed for mechanism 1.7.1.
- Whether an element's zoomed `letter-spacing` reaches a connected canvas as zoomed px (H12).
- Chrome's UI language on this Mac. `Local State` was not readable from the sandbox; `AppleLanguages` = (zh-Hans-US, en-US).
- Where `FinalizeFrame` runs for an OffscreenCanvas that never commits: `measureText` alone never switches frames.
