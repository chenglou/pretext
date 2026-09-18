# WebKit gaps: zoom, fixed pitch, U+2010, SA breaking, control characters, 8-bit text, ICU default locale

Pinned engine: WebKit tag `WebKit-7625.1.29.11.27` (Safari 27.0), checkout `~/github/browser-engines/webkit-7625.1.29.11.27`, HEAD `2756e8be`.

This file fills these CRITIC.md §5 items for WebKit:
- item 4: page zoom;
- item 8: fixed pitch and U+2010;
- item 9: Apple ICU for Thai, Lao, Khmer and Myanmar, and the default locale;
- item 11: `text-rendering: optimizeSpeed`;
- item 14: 8-bit text storage.

It also answers the extra questions in the assignment:
- the DOM advance of U+000D, U+000B and U+000C;
- the ICU default locale in the WebContent process.

It settles CRITIC W5 and C10 and narrows C11. It ends with numbered browser probes.

No browser was launched. Local programs were run on this Mac (macOS 27.0) against the system `libicucore` and CoreText. Their source is in this session's scratchpad `<scratch>/`, which is temporary:
- `icuprobe2/resprobe.c` reads the `brkitr/root` tables, tries to open the LSTM model resources, and prints `uloc_getDefault()`.
- `icuprobe2/sa.c` prints line and word boundaries for Thai, Lao, Khmer and Myanmar samples.
- `ctprobe/mono.m`, `mono2.m`, `wide.m`, `ctrl.m` and `exact.m` print CoreText traits and glyph advances.
- `zoom.mjs` and `probes.mjs` do the f32 arithmetic for the tables and probes.
- `appleicu/` holds Apple ICU 76 sources fetched from `github.com/apple-oss-distributions/ICU`, tag `ICU-76142.5.1.200`.

## 0. Notation

Paths:
- `W/` = `Source/WebCore/`
- `WTF/` = `Source/WTF/wtf/`
- `JSC/` = `Source/JavaScriptCore/`
- `WK/` = `Source/WebKit/`
- `PREFS` = `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`
- `AppleICU76/` = `icu/icu4c/source/` at Apple ICU `ICU-76142.5.1.200`. Apple has not published the 78.1 source that macOS 27 ships.
- `(raw)` marks a WebKit file outside the sparse checkout, fetched from `raw.githubusercontent.com/WebKit/WebKit/WebKit-7625.1.29.11.27/` (same tag).

Sparse directories added for this work:
- WebCore: `Source/WebCore/dom`, `html/parser`, `page`, `css/values`, `PAL/pal/text`;
- JavaScriptCore: `Source/JavaScriptCore/runtime`, `parser`, `Configurations`;
- WebKit: `Source/WebKit/WebProcess`, `Shared`, `UIProcess/Cocoa`, `UIProcess/mac`, `UIProcess/Launcher`.

Every line number is at 7625 unless the path starts with `AppleICU76/`.

Marks:
- [V] read at the tag, or measured on this Mac (the section says which program);
- [I] inferred;
- [G] a groundwork measurement reused without re-running.

Terms:
- **f32**: IEEE single precision. `Math.fround` reproduces one f32 operation.
- **LU**: `LayoutUnit`, an `int` in 1/64 CSS px. `trunc64(v) = Math.trunc(v * 64) / 64` is what `LayoutUnit(double)` does (`W/platform/LayoutUnit.h:83-86`).
- **Z**: the page zoom factor (Safari's View > Zoom In).
- **Text zoom**: Safari's "Zoom Text Only" factor.
- **M(font, s)**: `OffscreenCanvasRenderingContext2D.measureText(s).width` with `ctx.font = font`.
- **Simplified measuring**: the DOM text-box fast path, `box.canUseSimplifiedContentMeasuring` (webkit-lines §3.3).
- **Primary font**: the first font of the first available family whose range includes U+0020 (`W/platform/graphics/FontCascadeFonts.h:225-240`).
- **8-bit string**: a WTF `StringImpl` stored as Latin-1 bytes, so every code unit is at most U+00FF.
- **SA**: characters whose Line_Break property is SA (Thai, Lao, Khmer, Myanmar and a few others).

---

## 1. Page zoom under `EvaluationTimeZoomEnabled` (CRITIC §5 item 4; W5, C10)

### 1.1 The preference [V]

`EvaluationTimeZoomEnabled` is `status: stable` with default `true` for WebKitLegacy, WebKit and WebCore (`PREFS:2862-2874`). Its description reads "Enables used zoom value to be applied during layout and avoid applying at style-build time".

The document root copies it into the root style and the root font description (`W/style/StyleResolveForDocument.cpp:95, 117`). The style bit is inherited (`W/style/computed/data/StyleInheritedRareData.cpp:134, 240`).

Plain meaning:
- With the preference, `width: 100.3px` is stored as `100.3`, and zoom is multiplied in when layout evaluates the length.
- Without it, style building would store `100.3 × Z` already.

### 1.2 Where Z comes from [V]

1. `LocalFrame::setPageZoomFactor(float)` stores Z as f32 (`W/page/LocalFrame.cpp:1072-1082`; `W/page/LocalFrame.h:219-221`).
2. The root style calls `setZoom(pageZoomFactor)` (`W/style/StyleResolveForDocument.cpp:64`).
   - That sets `usedZoom = clamp(usedZoom × zoom)` (`W/style/computed/StyleComputedStyleProperties+SettersCustomInlines.h:70-72`).
   - It also sets `isZoomed = (usedZoom != 1)` (`W/style/computed/StyleComputedStyleBase+SettersInlines.h:245-251`).
   - Children inherit `usedZoom`, and CSS `zoom` multiplies it further.
3. Layout reads one of two getters (`W/style/computed/StyleComputedStyleBase+GettersInlines.h:310-332`):

```ts
function usedZoom(style): f32 { return style.inheritedRare.usedZoom }
function usedZoomForLength(style): f32 {
  if (!style.isZoomed) return 1
  if (style.useSVGZoomRulesForLength) return 1
  return style.evaluationTimeZoomEnabled ? style.inheritedRare.usedZoom : 1
}
```

So under the stable preference, `usedZoomForLength() === usedZoom()` for HTML content.

### 1.3 Box lengths are stored unzoomed and zoomed at evaluation [V]

Which properties use "Unzoomed" ranges:
- `width` and `height`: `LengthPercentage<NonnegativeLayoutUnitClampedUnzoomed>` (`W/style/values/sizing/StylePreferredSize.h:52`);
- padding: `NonnegativeUnzoomed` (`W/style/values/box/StylePadding.h:35`);
- margin: `AllUnzoomed` (`W/style/values/box/StyleMargin.h:35`).

The range flag means "the value held in the primitive has NOT had zoom applied to it" (`W/css/values/primitives/CSSPrimitiveNumericRange.h:56-57, 86-145`).

When style is built, an Unzoomed range under the preference gets conversion data with zoom 1 (`W/style/values/primitives/StylePrimitiveNumericTypes+Conversions.h:63-65, 81-83`). Canonicalization then returns the unzoomed px (`W/style/values/primitives/StyleLengthResolution.cpp:251-259`).

At layout time:
- `RenderBox::computeLogicalWidthUsingGeneric` calls `evaluate<LayoutUnit>(logicalWidth, availableLogicalWidth, style().usedZoomForLength())` (`W/rendering/RenderBox.cpp:3111`). Margins do the same (`:2864-2865`).
- The Unzoomed overload (`W/style/values/primitives/StylePrimitiveNumericTypes+Evaluation.h:133-142`) ends in:

```ts
// W/style/values/primitives/StylePrimitiveData.h:341-360
function valueWithZoom(kind, stored: f32, maximum: () => number, Z: f32): LU {
  switch (kind) {
    case 'Fixed':      return LayoutUnit(fround(stored * Z))                    // :347, LayoutUnit truncates to 1/64
    case 'Percentage': return LayoutUnit(fround(maximum() * stored / 100))      // :350, no zoom: the containing block is already zoomed
    case 'Calc':       return LayoutUnit(nonNanCalculatedValue(range, maximum(), Z)) // :353, not traced
  }
}
```

So the content-box width of `width: w` (px) is `trunc64(fround(fround(w) × fround(Z)))`:
- nothing is truncated before the zoom;
- the fit bound is that value plus 1/64 zoomed px (webkit-lines §1.4).

f32 values from `zoom.mjs`:

| Z (f32) | `width: 100.3px` LU | raw LU | fit bound | `width: 333.33px` LU | truncate-then-zoom for 100.3px (what WebKit does **not** do) |
|---|---|---|---|---|---|
| 1.0 | 100.296875 | 6419 | 100.3125 | 333.328125 | 100.296875 |
| 1.1 (1.10000002384) | 110.328125 | 7061 | 110.34375 | 366.65625 | 110.3125 |
| 1.25 | 125.375 | 8024 | 125.390625 | 416.65625 | 125.359375 |
| 1.5 | 150.4375 | 9628 | 150.453125 | 499.984375 | 150.4375 |

Other parts of the box:
- **Border widths** are evaluated as `snap(width × Z)` (`W/style/values/backgrounds/StyleLineWidth.cpp:46-62, 123-132`):
  - a length below one device pixel becomes one device pixel;
  - any other length becomes `floor(length × dpr) / dpr`.

  The keywords thin, medium and thick are 1, 3 and 5 before zoom (`:94-105`). Only `box-sizing: border-box` widths and auto widths see this.
- **An auto-width block** gets the containing block's LU minus each margin `trunc64(m × Z)`, borders and padding [I: `fillAvailableMeasure` at `W/rendering/RenderBox.cpp:3119` was not re-read].

What JS reads back:
- **`getBoundingClientRect()` and Range rects.** `GetBoundingClientRectZoomedEnabled` is stable, default true for WebKit on macOS (`PREFS:3457-3469`). So `zoomForClient` returns no element zoom (`W/dom/Document.cpp:9681-9686`), and quads are scaled by `1 / (pageZoom × frameScale)` in f32 (`W/page/LocalFrameView.cpp:6313-6332`; `W/dom/Document.cpp:9694-9699`). `width: 100.3px` reads as:
  - 100.296875 at Z = 1;
  - 100.29829406738281 at 1.1;
  - 100.30000305175781 at 1.25;
  - 100.29167175292969 at 1.5.
- **`clientWidth`** of an element is `roundToInt(paddingBoxWidth)`, divided by zoom and returned as an integer (`W/dom/Element.cpp:1648-1665`). For the root element it is the frame's layout width adjusted for zoom (`:1645-1646`). Either way a page that reads `document.body.clientWidth` under zoom loses the exact LU [I: the rounding inside `adjustForAbsoluteZoom` was not traced].
- **`window.devicePixelRatio`** is `deviceScaleFactor × frameScaleFactor × pageZoomFactor` (`W/page/LocalDOMWindow.cpp:1784-1788`). On a Retina Mac at 125% it is 2.5. JS can't split that product into DPR and Z without knowing one of them.

### 1.4 The font's computed size [V]

Every DOM font-size change calls `computedFontSizeFromSpecifiedSize(size, isAbsoluteSize, useSVGZoomRules, style, document)`. The callers are `W/style/StyleBuilderStateInlines.h:65-77`, `W/style/StyleBuilderState.cpp:294-299`, `W/style/StyleResolver.cpp:635`, and the root at `W/style/StyleResolveForDocument.cpp:101`:

```ts
// W/style/StyleFontSizeFunctions.cpp:86-96 (caller) and :45-84 (helper)
function domComputedFontSize(specified: f32, isAbsoluteSize: boolean, style, frame, settings): { size: f32, usedZoomFactor: f32 } {
  let zoom: f32 = 1
  if (!style.svgZoomRules) {
    zoom = style.usedZoom                                                   // :90
    if (style.textZoom !== 'reset') zoom = fround(zoom * frame.textZoomFactor) // :92-93
  }
  // The rule is AbsoluteAndRelative for HTML (:95)
  if (Math.abs(specified) < F32_EPSILON) return { size: 0, usedZoomFactor: zoom }        // :51-52
  let zoomed = fround(specified * zoom)                                                  // :69
  zoomed = Math.max(zoomed, settings.minimumFontSize)                                    // :72, default 0
  if (specified >= settings.minimumLogicalFontSize || !isAbsoluteSize)                   // :78
    zoomed = Math.max(zoomed, settings.minimumLogicalFontSize)                           // :79, default 9
  return { size: Math.min(maximumAllowedFontSize, zoomed), usedZoomFactor: zoom }        // :83
}
```

Where these values go:
- The result is stored as f32 together with its zoom factor (`W/platform/graphics/FontDescription.h:112`).
- The font cache key uses that same f32 (`W/platform/graphics/FontCascadeCache.h:114`). **Font sizes are not quantized** to 1/64 or 1/100.
- Defaults: `MinimumFontSize` is 0 and `MinimumLogicalFontSize` is 9 (`PREFS:5609-5631`). The Safari app may override them [I].
- **`isAbsoluteSize`** for a length is `parentIsAbsoluteSize || !(percentage or parent-font-relative)` (`W/style/StyleBuilderCustom.h:791`). For keywords, only larger, smaller, ruby-text and math keep the parent's flag (`:757`). The root starts from the `medium` keyword and is not absolute [I: only `setKeywordSizeFromIdentifier` is called there, and the flag's default is false].

Consequences:
- **Zoomed sizes.** `font: 16px Georgia` gives a DOM size of `fround(16 × 1.1f)` = 17.600000381469727 at Z = 1.1, 20 at 1.25 and 24 at 1.5. 13px at 1.25 gives 16.25.
- **Smart minimum under zoom-out.** A size that is at least 9 before zoom never drops below 9 after zoom. 16px at Z = 0.5 becomes 9, not 8.
- **Smart minimum at any zoom.** A relative size with no px anywhere above it is floored at 9, even at 100%:
  - `<body><span style="font-size:50%">` (16px medium root) gives 9px;
  - `<div style="font-size:16px"><span style="font-size:50%">` gives 8px, because that span is absolute.
- **W5 settled.** The helper at `:45-84` applies zoom only when a minimum-size rule is active. The DOM caller always passes `AbsoluteAndRelative` (`:95`), so the product at `:69` always runs. webkit-lines §1.6's outcome, "the font size is multiplied by Z", holds for sizes of at least 9px at Z ≥ 1.
- **`em` inside box lengths** uses `computedSize / usedZoomFactor` (`W/platform/graphics/FontDescription.h:51-52`; `W/style/values/primitives/StyleLengthResolution.cpp:126-131`) and is zoomed later with the length. If the smart minimum raised the font (9 instead of 8 at Z = 0.5), that "unzoomed" em is 18px [I: arithmetic from those lines].
- **Letter- and word-spacing.** Style building converts them with only the text-zoom factor (`W/style/StyleBuilderState.cpp:105-113`; `W/style/values/text/StyleLetterSpacing.cpp:49-58`; `W/style/values/text/StyleWordSpacing.cpp:52`). The style then evaluates the stored value with `usedZoomForLength()` (`W/style/computed/StyleComputedStyleBase.cpp:312-369`). A px value becomes `px × Z` [V]. `em` values were not traced [I].
- **Size given to CoreText.** The size, including the optical-size attribute, is the `size` argument of `UnrealizedCoreTextFont::modifyFromContext` (`W/platform/graphics/cocoa/UnrealizedCoreTextFont.cpp:214, 246`). Where that argument comes from was not traced. If it is `computedSize`, a Canvas font at the zoomed size gets the same `opsz` and CoreText tracking as the DOM [I]. This is WebKit's counterpart of Blink's C7.

### 1.5 Canvas does not apply zoom [V]

- **OffscreenCanvas.** A fresh description has `evaluationTimeZoomEnabled = false` and size 10 (`W/platform/graphics/FontDescription.cpp:70`; webkit-canvas §1.3).
  - `resolveForUnresolvedFont` keeps a px size unchanged through `computeUnzoomedNonCalcLengthDouble(…, CSSPropertyFontSize, …)` (`W/style/StyleResolveForFont.cpp:278`; `W/style/values/primitives/StyleLengthResolution.cpp:100-131`).
  - It then calls `setComputedSize(size)` with the default zoom factor 1 (`W/style/StyleResolveForFont.cpp:394-399`; `W/platform/graphics/FontDescription.h:112`).
- **No smart minimum.** The keyword-size path uses `MinimumFontSizeRule::None`, which returns the specified size (`W/style/StyleResolveForFont.cpp:380`; `W/style/StyleFontSizeFunctions.cpp:64-65`).
- **HTMLCanvasElement.** The context starts from the canvas element's computed description (webkit-canvas §1.3), but the same resolver overwrites the size and resets the zoom factor to 1 [V for `setComputedSize`].
- **Spacing.** Canvas `letterSpacing` and `wordSpacing` are unzoomed (webkit-canvas §1.3).

Recipe for a Canvas-only runtime under page zoom Z and text zoom T (normally 1):
1. Font size: `s' = fround(fround(s) × fround(Z × T))`. Then apply `s' = max(s', 9)` when `s ≥ 9` or when the CSS size chain is relative. Measure Canvas at `s'`.
2. Letter- and word-spacing in px: multiply by Z.
3. Available width: `trunc64(fround(fround(w) × fround(Z)))`, with fit bound + 1/64.
4. Widths reported to JS: multiply by `fround(1/Z)` in f32.

Losses:
- Z itself can't be observed from JS alone (§1.3). The app must pass it, or the runtime must guess it from `devicePixelRatio` with a known base DPR.
- Safari's zoom steps are not in WebKit source. From Safari's UI they are 50, 75, 85, 100, 115, 125, 150, 175, 200, 250 and 300% [I: not verified at this tag]. 110% is Chrome's step, not Safari's, but a `WKWebView.pageZoom` of 1.1 is possible [I].

---

## 2. Fixed-pitch eligibility (CRITIC §5 item 8, WebKit)

### 2.1 Font-level traits [V]

`Font::determinePitch` runs at the end of `Font::platformGlyphInit` (`W/platform/graphics/Font.cpp:195`; `W/platform/graphics/coretext/FontCoreText.cpp:753-785`):

```ts
function determinePitch(font): { treatAsFixedPitch: boolean, canTakeFixedPitchFastContentMeasuring: boolean } {
  const eq = (a, b) => a != null && a.toLowerCase() === b.toLowerCase()   // caseInsensitiveCompare, :61-64
  let treatAsFixedPitch = (CTFontGetSymbolicTraits(font) & kCTFontMonoSpaceTrait) !== 0
    || CTFontCopyAttribute(font, kCTFontFixedAdvanceAttribute) !== 0
    || eq(fullName, "Osaka-Mono") || eq(fullName, "MS-PGothic") || eq(fullName, "MonotypeCorsiva")   // :775
  let fast
  if (eq(familyName, "Courier New")) {                                   // :776-782
    // iOS only: treatAsFixedPitch = false
    fast = false
  } else fast = treatAsFixedPitch && !CTFontCopyAttribute(font, kCTFontUserInstalledAttribute)        // :784
  return { treatAsFixedPitch, canTakeFixedPitchFastContentMeasuring: fast }
}
```

Two details:
- The comments above that expression say MS-PGothic and MonotypeCorsiva should *not* be fixed pitch (`:762-768`). The expression ORs them in, so both **are** treated as fixed pitch.
- `kCTFontUserInstalledAttribute` is SPI (`W/PAL/pal/spi/cf/CoreTextSPI.h:140` (raw)).

### 2.2 Cascade-level rule [V]

- `FontCascade::isFixedPitch()` and `canTakeFixedPitchFastContentMeasuring()` (`W/platform/graphics/FontCascadeInlines.h:58-69`) use the font's flag only when the index-0 family's `FontRanges` has exactly one range. Otherwise the pitch is Variable and fast measuring is off (`W/platform/graphics/FontCascadeFonts.cpp:130-154`).
- Index 0 is the first family that realizes, else the standard family, else the last-resort font (`:200-218`). So `font-family: NotInstalled, Menlo` makes Menlo the index-0 family [I: `realizeNextFallback` not re-read].
- A locally installed family is one range [I].
- A web-font family split into `unicode-range` faces has several ranges, so it takes neither shortcut [I].

### 2.3 The two shortcuts

**(a) Width shortcut** (`W/layout/formattingContexts/inline/text/TextUtil.cpp:80-86`; `W/platform/graphics/FontCascade.cpp:414-442`). It needs box simplified measuring and `canTakeFixedPitchFastContentMeasuring()`:

```ts
function fixedPitchWidth(units: string /* UTF-16 */, collapse: boolean, sw: f32 /* primaryFont.spaceWidth(), Font.cpp:191 */, wordSpacing: f32): f32 {
  if (units.length === 0) return 0
  if (collapse) return fround(units.length * sw)                   // :419-421, a single f32 product
  let w: f32 = 0
  for (let i = 0; i < units.length; i++) {
    const c = units.charCodeAt(i)
    if (c === 0x0A || c === 0x2028 || c === 0x2029) { /* zero width */ }
    else if (c >= 0x20) w = fround(w + sw)                         // any unit at or above U+0020 is one space width
    if (i > 0 && c === 0x20) w = fround(w + wordSpacing)           // always 0: simplified measuring needs word-spacing 0
  }
  return w                                                          // CR and other units below U+0020 add 0
}
```

This ignores glyph advances, kerning and ligatures.

Box simplified measuring needs all of (`W/rendering/RenderText.cpp:480-521`):
- the simple font code path, and no small caps;
- zero word- and letter-spacing, no synthetic bold, and the same first-line font;
- for every character, `WidthIterator::characterCanUseSimplifiedTextMeasuring` (`W/platform/graphics/WidthIterator.cpp:694-742`);
- **for every character, a glyph from the primary font** (`W/platform/graphics/FontCascade.cpp:498-502`).

So one character that the primary font lacks turns the shortcut off for the whole text box. webkit-lines §3.3's list misses the last condition.

**(b) breakWord shortcut** (`TextUtil.cpp:265-280`, ported in webkit-lines §8.1 step (1)). It needs only `isFixedPitch()` and box simplified measuring:
- It therefore also applies to Courier New and to user-installed monospace fonts, which have no width shortcut.
- `cw = widthOfSpaceString()` is the full-path width of `" "` (`W/platform/graphics/FontCascadeInlines.h:188-191`).
- It accepts a prefix whenever `W(prefix) <= avail` and `W(prefix) + cw >= avail`, even when the real glyphs are narrower than `cw`.

### 2.4 Fonts on this Mac that carry the trait [V: `ctprobe/mono.m`, `mono2.m`, `wide.m`, `exact.m`]

Advances at 16px:

| Family | Where | Monospace trait | User-installed | Space | Other glyphs probed |
|---|---|---|---|---|---|
| Menlo | `/System/Library/Fonts` | 1 | no | 9.6328125 | all 9.6328125 |
| Monaco, Andale Mono | System | 1 | no | 9.6016 | all equal |
| Courier New | System | 1 | no | 9.6016 | all equal; width shortcut off by name |
| PT Mono | System | 1 | no | 9.6 | all equal |
| **Courier** | `/System/Library/Fonts/Courier.ttc` | 1 | no | 9.6015625 | **Ω U+03A9 = 12.2890625** |
| **BIZ UDGothic**, BIZ UDMincho | MobileAsset download | 1 | no | 8 | **Ж U+0416, Ω, → U+2192, … U+2026, ‐ U+2010: 16** |
| PCMyungjo, Osaka-Mono | MobileAsset | 1 | no | 8 | Greek, Cyrillic and arrows: 16 |
| Lantinghei TC | MobileAsset | 1 | yes | 4.4375 | i 3.1875, W 16.5625: proportional glyphs with the trait |
| Fira Code, Monaspace (5 families), Spot Mono | `~/Library/Fonts` or MobileAsset | 1 | yes | 9.6–9.92 | — |

- `Osaka` (without `-Mono`) doesn't carry the trait.
- `SF Mono` is not reachable by name: CoreText returns Helvetica.
- Whether Safari exposes MobileAsset and user-installed fonts to web content was not traced. The root font description carries `shouldAllowUserInstalledFonts` (`W/style/StyleResolveForDocument.cpp:92`) [I].

### 2.5 What Canvas can supply, and the losses

Canvas never takes either shortcut: `measureText` runs `FontCascade::width` over real advances (webkit-canvas §1.4), not `TextUtil::width`.

**T1, a Canvas test for when eligibility matters.** For each text item `s` in a white-space-collapsing mode, compare `fround(s.length × M(font, " "))` with `M(font, s)`:
- If they are equal for every item in the paragraph, eligibility doesn't change any width.
- Menlo, Monaco, PT Mono and Andale Mono pass T1 for Latin, Greek and Cyrillic at integer sizes, because their advances are exact binary fractions.
- At fractional sizes the sum and the product can differ in the last f32 bit. For example, Menlo's space at 17.6px is 10.59609413 in f32. T1 then tells the runtime to use the product form.

**Eligibility is not observable from Canvas.** The monospace trait, the fixed-advance attribute and the user-installed attribute have no Canvas signal. When T1 fails, the runtime needs an allowlist of trait-carrying system families per OS release (§2.4 for macOS 27), or it records a loss. Examples:
- `16px Courier`, item `ΩΩΩΩ`: the DOM text box is 38.40625 (4 × 9.6015625); `M` gives 49.15625.
- `16px BIZ UDGothic`, item `ЖЖЖЖ`: the DOM gives 32; `M` gives 64.

Web fonts:
- The trait comes from the font file (`post.isFixedPitch`) [I].
- A single-face web font with that flag and uneven advances shows the same loss, and no allowlist can cover it.

breakWord shortcut:
- When the width shortcut is on, prefix widths are `n × sw`, and the shortcut agrees with bisection except at f32 edges [I].
- For Courier New (trait, but no width shortcut) the runtime must port the exact acceptance test (webkit-lines §8.1 (1)). That also needs `isFixedPitch`, so it uses the same allowlist.

---

## 3. Does the primary font have U+2010? (CRITIC §5 item 8, WebKit)

### 3.1 Source [V]

- `hyphenString()` with `hyphenate-character: auto` returns U+2010 if `primaryFont().glyphForCharacter(U+2010)` is non-zero, else U+002D (`W/style/computed/StyleComputedStyle.cpp:419-435`).
- The hyphen's width is then measured through the whole cascade (webkit-lines §3.3).
- `glyphForCharacter` reads the font's own glyph page. That page is filled by `CTFontGetGlyphsForCharacters` on that font alone, and glyph 0 means "no glyph" (`W/platform/graphics/coretext/GlyphPageCoreText.cpp:51-73`; `W/platform/graphics/Font.cpp:433-440`).

### 3.2 This Mac [V: `ctprobe/mono.m`, `exact.m`]

All 37 families probed have a U+2010 glyph:

> Helvetica, Helvetica Neue, Arial, Times, Times New Roman, Georgia, Verdana, Menlo, Courier, Courier New, Hiragino Sans, PingFang SC, Avenir, Palatino, Trebuchet MS, Tahoma, Impact, Comic Sans MS, Gill Sans, Optima, Futura, Baskerville, American Typewriter, Monaco, Thonburi, Apple SD Gothic Neo, Geneva, Lucida Grande, Noteworthy, Chalkboard SE, Didot, Hoefler Text, Charter, Rockwell, Andale Mono, PT Mono, Osaka

In all but two of them, U+2010 and U+002D have the same advance. The exceptions, at 16px:
- Osaka: `‐` 8, `-` 6.0625;
- Apple SD Gothic Neo: `‐` 6.592, `-` 6.912.

### 3.3 A Canvas test [V for the lookup order; the test design is I]

The glyph lookup walks the `font-family` list in order and uses system fallback only after the list (`W/platform/graphics/FontCascadeFonts.cpp:426-439, 483-496`).

Test for a family P:
1. P is available if `M("16px P, Menlo", "abc") !== M("16px Menlo", "abc")`.
2. Let `a = M("16px P, Menlo", "‐")` and `b = M("16px P, Arial", "‐")`. Menlo and Arial both have U+2010, with advances 9.6328125 and 5.328125 at 16px.
3. If `a === b`, P has U+2010. If `a === M("16px Menlo", "‐")` and `b === M("16px Arial", "‐")`, it doesn't.

Loss: a web-font family made of `unicode-range` faces can hold U+2010 in a face other than the primary one. The test then says "has", but `primaryFont()` doesn't have it, so the DOM uses `-`.

---

## 4. Thai, Lao, Khmer and Myanmar in libicucore 78.1 (CRITIC §5 item 9)

### 4.1 Dictionary engines, not LSTM [V for data; I for the 78.1 code]

**Data file.** `research/icudat_toc.py` over `/usr/share/icu/icudt78l.dat` lists:
- `brkitr/thaidict.dict` 126,208 B, `laodict.dict` 162,624 B, `khmerdict.dict` 445,552 B and `burmesedict.dict` 254,448 B;
- no LSTM model resources.

**Installed library** (`icuprobe2/resprobe.c`):
- `brkitr/root` has `dictionaries{Hani Hira Kana Khmr Laoo Mymr Thai}`.
- It also has `lstm{Mymr=Burmese_graphclust_model5_heavy.res Thai=Thai_graphclust_model4_heavy.res}`.
- `ures_openDirect("icudt78l-brkitr", "Thai_graphclust_model4_heavy")` returns `U_MISSING_RESOURCE_ERROR`, and so does the Burmese model.

**Code at Apple ICU 76:**
- `ICULanguageBreakFactory::loadEngineFor(UChar32 c, const char*)` tries LSTM first (`AppleICU76/common/brkeng.cpp:163-184`).
- `CreateLSTMDataForScript` reads the `lstm` entry and opens the model. When the open fails it returns null (`AppleICU76/common/lstmbe.cpp:784-808`).
- The factory then resets the status and builds `ThaiBreakEngine`, `LaoBreakEngine`, `BurmeseBreakEngine` or `KhmerBreakEngine` over the dictionary (`brkeng.cpp:185-199`).
- Neither file has an `APPLE_ICU_CHANGES` block.
- The locale parameter is unnamed, so these engines ignore the locale (`:164`).

Result: all four scripts break through dictionaries, in the line iterator and the word iterator alike [I that 78.1 keeps the 76 code; this agrees with the data and with the groundwork's WebKit-oracle equality].

Sample boundaries from `icuprobe2/sa.c`, identical for LINE and WORD and for locales `""`, `th` and `en_US_POSIX`:

| Script | Text | Boundaries |
|---|---|---|
| Thai | ความสวยงามของธรรมชาติ | 0 4 10 13 21 |
| Thai | ภาษาไทยเป็นภาษาราชการ | 0 4 7 11 15 21 |
| Lao | ພາສາລາວເປັນພາສາລາຊະການ | 0 4 7 11 15 22 |
| Khmer | ភាសាខ្មែរជាភាសាផ្លូវការ | 0 9 11 23 |
| Myanmar | မြန်မာဘာသာသည်ရုံးသုံးဘာသာဖြစ်သည် | 0 10 13 25 32 |

[G] Chrome 153's SA dictionaries total 526,944 B raw. Chrome and Safari agree on 95.4% of interior SA positions (`results-sa-equivalence.txt`), so one shipped dataset can't serve both.

### 4.2 JavaScriptCore's `Intl.Segmenter` [V]

- `IntlSegmenter::initializeSegmenter` resolves the locale against the `ubrk_countAvailable()` list (`JSC/runtime/IntlSegmenter.cpp:74-85`; `JSC/runtime/IntlObject.cpp:601-616`).
- It maps `granularity: "word"` to `UBRK_WORD` and calls `ubrk_open(type, locale)` (`IntlSegmenter.cpp:87-108`).
- `segment()` clones the iterator and runs `ubrk_setText` over a UTF-16 copy of the whole string (`:112-141`).
- JavaScriptCore links `-licucore` (`JSC/Configurations/Base.xcconfig:167`). That is the same system library WebCore's line iterator uses (webkit-text §0).
- The default locale comes from the global object's `defaultLanguage`, then the preferred languages. `uloc_getDefault()` is used only when both are empty (`JSC/runtime/IntlObject.cpp:836-870`).

So in Safari, `Intl.Segmenter` word boundaries come from the same dictionaries, library and process as layout's line iterator [I: one libicucore per process].

Word vs line granularity [G]:
- Inside SA runs, the two iterators agree on 53,929 of 53,983 positions (99.900%), and exactly outside runs that begin with a combining mark.
- JSC's Segmenter (Bun 1.4.0 over this libicucore) equals the raw word iterator on 53,980 of 53,980.
- 3 line opportunities fall inside Apple grapheme clusters.

In-page recipe: run `new Intl.Segmenter(lang, {granularity: "word"})` over the whole paragraph, and keep boundaries whose neighbors are both SA.

Stated losses:
- SA runs that start with a combining mark (broken text);
- the 3 in-cluster opportunities;
- boundaries at text-box edges, where WebKit gives ICU only 2 units of prior context (webkit-text §7.4) while the Segmenter sees the whole paragraph [I].

---

## 5. DOM advances of U+000D, U+000B and U+000C

### 5.1 Glyph lookup on Cocoa [V]

- **No control-character override on Cocoa.**
  - `overrideControlCharacters`, which maps C0 and C1 controls to ZERO WIDTH SPACE, is compiled only under `#if PLATFORM(WIN)` (`W/platform/graphics/Font.cpp:343-384, 406-409`).
  - The comment at `:153-154` ("Control characters, including 0, are mapped to the ZERO WIDTH SPACE glyph for non FreeType based ports") is stale for Cocoa [I].
- **Filling.** The glyph page comes from CoreText's own cmap lookup (`W/platform/graphics/coretext/GlyphPageCoreText.cpp:51-73`).
- **Fallback.** A character the primary font lacks goes through the family list, then system fallback (`W/platform/graphics/FontCascadeFonts.cpp:426-496, 369-404`). If nothing is found, the width iterator uses the primary font (`W/platform/graphics/WidthIterator.cpp:443-447`).
- **Which characters count as controls.** `isControlCharacter(c)` is `u_charType(c) == U_CONTROL_CHAR`, so U+0000–U+001F and U+007F–U+009F (`WTF/text/CharacterProperties.h:106-109`).

### 5.2 Per measuring path [V]

| Character | Simplified measuring (text box) | Full path, simple code path (`WidthIterator`) | Complex path |
|---|---|---|---|
| U+000D CR | Allowed (`WidthIterator.cpp:698-701`) **only when the primary font maps U+000D** (`FontCascade.cpp:498-502`). Width is `widthForGlyph(glyphForCharacter(CR))`, then the CoreText transforms (`FontCascade.cpp:387-407`). Fixed-pitch fast path: space width when collapsing, 0 when preserving (`:419-434`). | Glyph of the first font that maps U+000D. It is redrawn as that font's space glyph but **keeps its advance** (`WidthIterator.cpp:792-800`). | 0, because `treatAsZeroWidthSpaceInComplexScript` includes every `c < U+0020` (`W/platform/graphics/FontCascadeInlines.h:165-173`; `ComplexTextController.cpp:762-768`). |
| U+000B VT, U+000C FF, other Cc except NUL | Rejected (`WidthIterator.cpp:738`) | Glyph 0 of the font that resolved the character, with `.notdef`'s advance (`:817-822`) | 0, then the `.notdef` advance (`ComplexTextController.cpp:762-780`) |
| U+0000 NUL | Rejected | Deleted, advance 0 (`FontCascadeInlines.h:152-153` through `WidthIterator.cpp:812-815`) | 0 |

### 5.3 This Mac [V: `ctprobe/ctrl.m`, `exact.m`, 16px]

| Font | U+000D glyph advance | Space | Maps U+000B and U+000C? | `.notdef` |
|---|---|---|---|---|
| Arial, Times New Roman, Georgia, Verdana, Menlo, `.AppleSystemUIFont`, Helvetica, Helvetica Neue, Courier, PingFang SC | same as space | Arial 4.4453125 | no | Arial 12; system UI 15.6875 |
| **Avenir Next** | **0** | 4 | no | 8.192 |
| **Thonburi** | **1.96875** | 5.3125 | no | 8 |
| Hiragino Sans | 5.328 (glyph 1, which is also the space glyph) | 5.328 | **yes: every C0 → glyph 1** | 16 |

So in the DOM:
- **CR.** `"a\rb"` in `white-space: pre` measures `M("a") + CR advance + M("b")`, with CoreText's kerning applied to that glyph sequence.
- **VT and FF.** The `.notdef` advance comes from whichever font resolved the character:
  - for Hiragino Sans that is Hiragino's own `.notdef` (16);
  - for the other fonts it is a system fallback font, which this reading did not identify [I].

### 5.4 What Canvas can supply

- **What Canvas replaces.** Canvas replaces U+0009–U+000D with U+0020 before measuring (`W/html/canvas/CanvasRenderingContext2DBase.cpp:2847-2875`).
- **What it doesn't.** U+0001–U+0008, U+000E–U+001F and U+007F–U+009F are **not** replaced, and they reach the same visibility rules as in the DOM.
- **Recipe C1** [I]: the DOM advance of VT or FF in font F equals `M(F, "")`.
  - This holds when U+0001 and U+000B resolve to the same font.
  - That is true for every font probed: either neither is mapped, or all C0 controls are (Hiragino Sans).
  - Probe 13 checks it.
- **CR can't be measured in Canvas.** The runtime needs a per-font fact, "U+000D's advance equals the space advance":
  - it holds for the common fonts in §5.3;
  - it fails for Avenir Next and Thonburi;
  - for fonts that aren't listed, it is a stated loss.

---

## 6. `text-rendering: optimizeSpeed` (CRITIC §5 item 11) [V]

DOM effects:
- A DOM font with `text-rendering: optimizeSpeed` turns off `liga`, `clig`, `dlig`, `hlig` **and `calt`** (`W/platform/graphics/cocoa/UnrealizedCoreTextFont.cpp:251-257`). Non-zero letter-spacing turns off the first four but not `calt` (`:258-264`).
- The same mode turns kerning off unless `font-kerning: normal` is set (`W/platform/graphics/FontCascade.h:289-302`).
- It also turns shaping off unless `font-variant-*` or `font-feature-settings` are set (`:304-311`).
- With kerning and shaping both off, `TextUtil::width` no longer measures "item + following space − space" (`W/layout/formattingContexts/inline/text/TextUtil.cpp:72-78`).

Canvas:
- Canvas has no `textRendering` attribute (webkit-canvas §1.1).
- An **HTMLCanvasElement** context copies the canvas element's computed font description, including `text-rendering` and `font-kerning`, and the font resolver doesn't overwrite those fields (webkit-canvas §1.3).
- So a connected `<canvas style="text-rendering: optimizeSpeed">` context can supply these widths [I: it needs a computed style, so the canvas must be in the document].
- OffscreenCanvas can't supply them.

---

## 7. 8-bit storage of text nodes (CRITIC §5 item 14, WebKit)

Why it matters:
- keep-all breaks after punctuation happen only in 16-bit text (webkit-text §9, H15);
- the first unit on an empty line is 1 code unit for 8-bit text (`TextUtil.cpp:578-598`);
- `breakWord` aligns indexes differently for 16-bit text (`TextUtil.cpp:256-263`).

The text box content is the node's data after `text-transform` (webkit-text §3).

### 7.1 The full HTML parser: Latin-1 text is 8-bit [V]

- Each appended character is ORed into `m_data8BitCheck` (`W/html/parser/HTMLToken.h:141, 184, 205`). `charactersIsAll8BitData()` is `m_data8BitCheck <= 0xFF` (`:356-360`).
- The tree builder turns an all-Latin-1 token into `String::make8Bit` (`W/html/parser/HTMLTreeBuilder.cpp:140-154, 241-246`). Whitespace runs are collected in a `Latin1Character` vector (`:200-217`).
- `insertTextNode` creates `Text` nodes from substrings of that string. It can also append to the previous text node through a `StringBuilder` (`W/html/parser/HTMLConstructionSite.cpp:689-740`; `W/dom/CharacterData.cpp:104-117`) [I: a `StringBuilder` stays 8-bit when both parts are 8-bit].

Examples:
- `<div>abc,def(ghi</div>` → 8-bit, whatever else the page contains.
- `<div>abc,def(gh&#105;</div>` → 8-bit, since the reference decodes to `i` inside the token [I on the reference path].
- `<div>abc&#x4E2D;</div>` → 16-bit.

### 7.2 The `innerHTML` fast path: text follows the markup string's storage, and escaped text is always 16-bit [V]

Path:
- `Element.innerHTML` → `createFragmentForInnerOuterHTML` → `createFragmentForMarkup` → `DocumentFragment::parseHTML` (`W/editing/markup.cpp:1541-1547, 1557-1559` (raw)).
- `parseHTML` tries `tryFastParsingHTMLFragment` first (`W/dom/DocumentFragment.cpp:95-99`).

Storage:
- The fast parser scans text as a span of the *markup string's* unit type (`W/html/parser/HTMLDocumentParserFastPath.cpp:642-694`) and creates `String(text)` (`:369-380, 910-921`).
- For a 16-bit markup string, that is `String(std::span<const char16_t>)`, which calls `StringImpl::create` and stays 16-bit (`WTF/text/WTFString.h:67`; `WTF/text/StringImpl.cpp:257-260`).
- Text containing `&` or CR goes through `m_ucharBuffer`, a `Vector<char16_t>` (`:364, 698-719`). The resulting text node is 16-bit even when the markup is 8-bit (`:922-926`).
- When the fast path refuses the markup, the full parser (§7.1) runs instead.

Examples (JS string literals are 8-bit when all their units are Latin-1, §7.4):
- `div.innerHTML = "abc,def(ghi"` → 8-bit.
- `div.innerHTML = "abc,def(gh&#105;"` → **16-bit**.
- `div.innerHTML = "<b>中</b>abc,def(ghi"` → the text node `abc,def(ghi` is **16-bit**.

### 7.3 `textContent`, `createTextNode` and `data` keep the JS string's storage [V/I]

- On an element, `Node::setTextContent` calls `ContainerNode::stringReplaceAll(String&&)`, which calls `createTextNode(WTF::move(string))` (`W/dom/Node.cpp:1809`; `W/dom/ContainerNode.cpp:948-951`).
- `CharacterData::setData` stores the string it is given (`W/dom/CharacterData.cpp:59-74`).
- `appendData` stores `makeString(old, new)` (`:132-135`).
- The binding hands over the JSString's `StringImpl` [I].

### 7.4 When a Latin-1-only JS string is 16-bit

**Source literals are 8-bit** [V/I]:
- In a 16-bit script, the string lexer stays on its 8-bit buffer until it meets a non-Latin-1 unit (`JSC/parser/Lexer.cpp:1289-1299`), then makes the identifier from `m_buffer8` (`:1378-1382`).
- The slow path (escapes, non-Latin-1 units) makes it from `m_buffer16` (`:1538`) through `Identifier::fromString` (`JSC/parser/ParserArena.h:79-86`), then `AtomStringImpl::add`, then `StringImpl::create8BitIfPossible` (`WTF/text/AtomStringImpl.cpp:111-117`) [I: the `fromString` → `add` step].

**`JSON.parse`** [V]:
- Tokens from an 8-bit source are 8-bit (`JSC/runtime/LiteralParser.cpp:888-900, 1091-1101`).
- From a 16-bit source, strings of up to 16 units are atomized, so they are 8-bit when possible (`JSC/runtime/JSONAtomStringCacheInlines.h:93-116`).
- Longer strings from a 16-bit source are `String(span16)`: **16-bit** (`:98-99`).

**Network text** [V]:
- `TextCodecUTF8::decode` writes into an 8-bit buffer until the first non-Latin-1 character, then copies everything into a 16-bit buffer (`W/PAL/pal/text/TextCodecUTF8.cpp:314-393, 395-405`).
- So one `中` anywhere in a response body makes the whole decoded string 16-bit [I: that `Response.text()` uses this codec].

**Substrings** [V]:
- JSC resolves a substring rope with `substringSharingImpl` (`JSC/runtime/JSString.cpp:238-239`).
- `StringImpl::createSubstringSharingImpl` copies a slice of a 16-bit parent into 8-bit only when two things hold (`WTF/text/StringImpl.h:1046-1068`):
  - the copy is no larger than a shared reference;
  - every unit is Latin-1.
- With the header layout (`:162-172`) and `tailOffset` (`:1228-1231, 1241-1244`), the size condition is `24 + 8 >= 20 + length`, which means **length ≤ 12**. Examples:
  - `("中" + "abc,def(ghia,jkl(mno").slice(1)` is 20 units: **16-bit**.
  - `("中" + "abc,def(ghi").slice(1)` is 11 units: 8-bit.

Concatenating with a 16-bit piece resolves to 16-bit [I].

### 7.5 What a runtime can know

- JS can't see a string's storage, and Canvas has no signal for it.
- The rule "every unit ≤ U+00FF ⇒ 8-bit" is right for parser-built text and for `textContent` set from string literals.
- It is wrong for:
  - `innerHTML` text when the markup string is 16-bit or the text contains any character reference;
  - JSON strings longer than 16 units parsed from 16-bit text;
  - text decoded from a response that contains any non-Latin-1 character;
  - substrings longer than 12 units of such strings.
- These cases are a stated loss unless the painter builds the text node from a known 8-bit string [I: no JSC operation that forces 8-bit storage was traced].
- `text-transform` changes the content's storage on its own path. `convertToUppercaseWithoutLocale` keeps ASCII input 8-bit (`WTF/text/StringImpl.cpp:462-500`). The non-ASCII branches were not read [I].

---

## 8. ICU default locale in Safari's WebContent process (CRITIC §5 item 9; C11)

### 8.1 WebKit never sets it [V]

- A grep for `uloc_setDefault` finds nothing in any of:
  - the checked-out WebKit directories: `WK/WebProcess`, `WK/Shared`, `WK/UIProcess/Cocoa`, `WK/UIProcess/mac`, `WK/UIProcess/Launcher`;
  - `WTF/`, every checked-out WebCore directory, and `JSC/runtime`.
- GitHub code search over WebKit's default branch finds only the ICU headers `Source/WTF/icu/unicode/uloc.h` and `urename.h`.
- `setlocale(LC_ALL, "")` appears only in the GTK entry point (`WK/WebProcess/gtk/WebProcessMainGtk.cpp:79`).
- The XPC bootstrap message overrides WTF's preferred languages, not ICU's default (`WK/Shared/EntryPointUtilities/Cocoa/XPCService/XPCServiceMain.mm:67-78, 181-190`).
- The launcher forwards `HOME`, `CFFIXED_USER_HOME` and `TMPDIR`, and only on iOS (`WK/UIProcess/Launcher/cocoa/ProcessLauncherCocoa.mm:379-395`).

### 8.2 What Apple ICU computes [V: code at 76, measured at 78.1]

`uprv_getDefaultLocaleID()` (`AppleICU76/common/putil.cpp:1727-1785, 1790-1797, 1816-1874`):
1. It reads `setlocale(LC_MESSAGES, nullptr)`.
2. If that is null, "C" or "POSIX", it tries `getenv("LC_ALL")`, then `LC_MESSAGES`, then `LANG`.
3. With nothing usable, it returns `en_US_POSIX`.

Measured with `icuprobe2/resprobe.c`:
- with `LANG`, `LC_ALL` and `LC_MESSAGES` unset, `uloc_getDefault()` is `en_US_POSIX`;
- with `LANG=ja_JP.UTF-8`, it is `ja_JP`.

On this Mac:
- `launchctl getenv LANG` is empty;
- `ps -E` on the running WebContent processes shows no environment, because it isn't readable.

Inference: the WebContent default is `en_US_POSIX` unless launchd hands the process `LANG` or an `LC_*` variable [I]. Probe 17 checks it.

### 8.3 What the default can change [V/G]

- **Not the break tables.** `BreakIterator::buildInstance` opens the break bundle with `ures_openNoDefault` (`AppleICU76/common/brkiter.cpp:78`). This matches webkit-canvas §2.5, where both defaults produced identical tables.
- **Only Apple's quote overrides, and only for locale strings ICU has no data for.**
  - After building a line iterator, Apple ICU calls `setCategoryOverrides(loc)` (`brkiter.cpp:457-471`).
  - Its `ulocdata_open` falls back through the default locale (webkit-canvas §2.6). Apple's `ulocdata.cpp` was not re-read: the fetch failed twice.
- **Groundwork probes** [G]:
  - under default `ja_JP`, `und` and `mul` behaved like `ja` (`oracle/webkit/build/probe-ja.txt`);
  - under `en_US_POSIX`, `und`, `mul`, `th`, `my`, `km` and `hi` gave root results (`oracle/webkit/build/probe-posix.txt`).
- **No `lang` at all.** WebKit passes `""` (webkit-text §4.2). That opens root and is unaffected.

So C11 narrows to pages whose `lang` is `und`, `mul`, `zxx` or another tag with no ICU data. The expected answer there is en-like.

webkit-text §4.2 says ICU falls back through the default locale "for locale names its data doesn't know". That is true for the quote overrides only, not for the tables.

---

## 9. What Canvas can supply (this file's topics)

| Fact | From Canvas? | How, or the loss |
|---|---|---|
| Page zoom Z | No | App input; `devicePixelRatio` mixes DPR and Z (§1.3) |
| Zoomed content width | Yes, given Z | `trunc64(fround(fround(w) × fround(Z)))` (§1.3) |
| Zoomed font size | Yes, given Z | `fround(s × Z)` with the smart minimum of 9 (§1.4) |
| Fixed-pitch width shortcut | Partly | T1 shows when it matters; eligibility needs a family allowlist (§2.5) |
| breakWord fixed-pitch shortcut | Partly | Same allowlist (§2.5) |
| Primary font has U+2010 | Yes, for named local fonts | Fallback-difference test (§3.3); loss for segmented web fonts |
| SA break positions | Yes | `Intl.Segmenter` word granularity (§4.2); small documented losses |
| VT and FF advance | Yes [I] | `M(F, "")` (§5.4) |
| CR advance | No | Per-font table; loss for unlisted fonts (§5.3) |
| `text-rendering: optimizeSpeed` widths | Yes [I] | A connected `<canvas>` with the same computed style (§6) |
| 8-bit storage | No | Latin-1 rule plus the listed exceptions (§7.5) |
| ICU default locale | No | Assume `en_US_POSIX`; it only matters for unknown `lang` tags (§8.3) |

---

## 10. Corrections to other specs

- **webkit-lines §1.2 and §1.6** cite `StylePrimitiveData.h:305` for "value × zoom before truncation". That line is the minimum-value overload. The width overload is `:341-360` (`:347`).
  - The outcome stands: lengths are zoomed before the 1/64 truncation.
  - The font-size claim needs the smart minimum (§1.4).
- **webkit-lines §3.3.** The simplified-measuring conditions also need "every glyph comes from the primary font" (`W/platform/graphics/FontCascade.cpp:498-502`). The fixed-pitch width shortcut in preserve modes adds 0 for CR and the other units below U+0020 (§2.3).
- **webkit-canvas §2.5** says Thai, Lao, Khmer and Myanmar data "libicucore loads itself" (dictionary or LSTM). On macOS 27 it is dictionaries only (§4.1).
- **webkit-text §4.2** says the default locale is the fallback for unknown names. It is the fallback for Apple's quote overrides only; tables use `ures_openNoDefault` (§8.3).
- **CRITIC W5 and C10 are settled.**
  - The DOM font size includes zoom, with the smart minimum.
  - OffscreenCanvas and HTMLCanvasElement never include page zoom or text zoom.
  - Box lengths are zoomed at evaluation time, and there is no truncation before the zoom.

---

## 11. Browser probes (Safari 27.0 on this Mac, headed, Retina display)

Conventions for every probe:
- The page is `<html lang="en">`, with no font-size on `html` or `body`, unless the probe says otherwise.
- "Rect width" is `getBoundingClientRect().width`.
- M(…) is OffscreenCanvas `measureText` in the same page.
- CR, VT and FF are set through JS: the HTML parser turns CR into LF.

1. **Zoom is applied before truncation.** Safari at 125%. `<div style="width:96.3265px;font:16px Menlo">aaaaa aaaa</div>` gives **1 line**; with `width:96.32px` it gives **2 lines**.
   - The text is 120.41015625 wide at 20px Menlo.
   - At 96.3265px: `trunc64(96.3265 × 1.25)` = 120.40625, fit bound 120.421875, so it fits.
   - Truncating before zooming would give 120.390625 and 2 lines at 96.3265px.
   - An unzoomed font would give 1 line at 96.32px.
2. **Client rects under zoom.** `<div style="width:100.3px">` has rect width:
   - 100.296875 at 100%;
   - 100.29829406738281 at 110% (through `WKWebView.pageZoom` if Safari has no 110% step);
   - 100.30000305175781 at 125%;
   - 100.29167175292969 at 150%.
3. **devicePixelRatio includes zoom.** On a Retina display, `devicePixelRatio === 2.5` at 125% and `=== 2` at 100%.
4. **The DOM font is zoomed.** At 125%, `<span style="font:16px Georgia">Hello world</span>` has rect width × 1.25 within 1/64 of `M("20px Georgia", "Hello world")`.
5. **Canvas is not zoomed.** At 125%, `M("16px Georgia", "Hello world")` equals its value at 100% exactly.
6. **Smart minimum for a relative size.** At 100%:
   - `<span style="font-family:Georgia;font-size:50%">Hello world</span>` directly inside `<body>` has rect width `=== M("9px Georgia", "Hello world")`, not `M("8px Georgia", …)`;
   - the same span inside `<div style="font-size:16px">` measures `M("8px Georgia", …)`.
7. **Smart minimum under zoom-out.** At 50%, `<span style="font:16px Georgia">Hello world</span>` has rect width × 0.5 within 1/64 of `M("9px Georgia", "Hello world")`, not `M("8px Georgia", …)`.
8. **Fixed-pitch width shortcut in Courier.** `<span style="font:16px Courier">ΩΩΩΩ</span>` has rect width **38.40625**, while `M("16px Courier", "ΩΩΩΩ")` is **49.15625**.
9. **Fixed-pitch width shortcut in BIZ UDGothic**, if Safari exposes the font. `<span style="font:16px 'BIZ UDGothic'">ЖЖЖЖ</span>` has rect width **32**, while `M(…)` is **64**. If the family isn't available, the rect equals `M` of the fallback font instead.
10. **CR under the fixed-pitch shortcut.** `<span style="font:16px Menlo">`, `textContent = "a\rb"`:
    - with `white-space:normal`, rect width **28.8984375** (3 × 9.6328125);
    - with `white-space:pre-wrap`, rect width **19.265625** (CR adds 0).
11. **Primary font with U+2010, Canvas side.**
    - `M("16px Osaka, Menlo", "‐") === M("16px Osaka, Arial", "‐") === 8`.
    - `M("16px Menlo", "‐")` (9.6328125) and `M("16px Arial", "‐")` (5.328125) differ, so the test discriminates.
12. **Hyphen string, DOM side.** `<div style="font:16px Osaka;hyphens:manual">aaaa&shy;bbbb</div>`, with `W = M("16px Osaka", "aaaa")`:
    - at `width: W + 8.01px`, line 1 ends at the soft hyphen (offset 5) and shows a hyphen;
    - at `width: W + 7px`, line 1 does not end at offset 5.

    A U+002D hyphen (6.0625 wide) would still fit at `W + 7px`.
13. **VT and FF `.notdef` from Canvas.** `<span style="font:16px Arial;white-space:pre">`:
    - with `textContent = "a\vb"`, (rect width − rect width of `"ab"`) `=== M("16px Arial", "ab") − M("16px Arial", "ab")` within 1/64;
    - the same holds with `"a\fb"`;
    - with `16px Hiragino Sans`, the same holds and the difference is about 16, minus any kerning change.
14. **CR advance per font.** `white-space:pre`, `textContent = "o\ro"`:
    - in `16px Avenir Next`, rect width `=== 2 × M("16px Avenir Next", "o")` (CR adds 0);
    - in `16px Thonburi`, `2 × M("16px Thonburi", "o") + 1.96875`;
    - in `16px Arial`, `=== M("16px Arial", "o o")`.
15. **SA breaks through dictionaries.** `width:1px`:
    - `<div lang="lo" style="font:16px 'Lao Sangam MN'">ພາສາລາວເປັນພາສາລາຊະການ</div>` gives 5 lines starting at offsets 0, 4, 7, 11 and 15;
    - `lang="km"`, `'Khmer Sangam MN'`, ភាសាខ្មែរជាភាសាផ្លូវការ gives 3 lines at 0, 9 and 11;
    - `lang="my"`, `'Myanmar Sangam MN'`, မြန်မာဘာသာသည်ရုံးသုံးဘာသာဖြစ်သည် gives 4 lines at 0, 10, 13 and 25.

    In the same page, `[...new Intl.Segmenter(lang, {granularity: "word"}).segment(t)].map(s => s.index)` returns the same starts. The Thai case is webkit-text H22.
16. **8-bit vs 16-bit text through DOM APIs.** `<div style="word-break:keep-all;width:1px;font:16px Menlo">`:
    - `div.textContent = "abc,def(ghi"` → **1 line**;
    - `div.innerHTML = "abc,def(gh&#105;"` → **3 lines** (`abc,` | `def(` | `ghi`);
    - `div.textContent = ("中" + "abc,def(ghia,jkl(mno").slice(1)` → **5 lines** (`abc,` | `def(` | `ghia,` | `jkl(` | `mno`);
    - `div.textContent = ("中" + "abc,def(ghi").slice(1)` → **1 line**.
17. **ICU default locale.** `<div lang="und" style="font:16px Menlo;width:58px">----““aabb</div>` gives **2 lines** (`----` | `““aabb`) if the WebContent default is en-like.
    - Control: `lang="en"` gives 2 lines.
    - Control: `lang="ja"` gives 1 line.
    - If `lang="ja"` also gives 2 lines, WebKit decided `-|“` without asking ICU, and the probe says nothing.

---

## 12. Open questions

- The WebContent process environment (`LANG`, `LC_*`). Probe 17 tests its effect.
- Whether Safari exposes MobileAsset fonts (BIZ UDGothic, Osaka-Mono) and user-installed fonts to web content. Probe 9.
- Which system fallback font resolves U+000B, U+000C and U+0001 when the primary font lacks them, and whether the three always resolve alike. Probe 13.
- The size WebKit passes to CoreText for `opsz` and tracking under page zoom (§1.4).
- Apple's 78.1 ICU source is unpublished. "Dictionaries only" rests on the installed data plus the 76 code.
- Apple ICU's `ulocdata_open` fallback was not re-read; it comes from webkit-canvas §2.6 and the groundwork probes.
- Safari's zoom step list, and the Safari app's `MinimumLogicalFontSize`. Neither is in WebKit source.
- JS operations that are guaranteed to produce 8-bit strings, such as `String.fromCharCode` or `TextDecoder`, were not traced.
