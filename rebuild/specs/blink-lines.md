# Blink line filling and units (Chrome 153.0.8010.48)

How Chrome's layout engine, for horizontal text in one block of inline text, walks styled text runs, measures them, decides where each line ends, and in which units. It is written so the loop can be ported to TypeScript. Break opportunity *data* (the pair table, ICU rules) is another spec's topic; this one covers how the line loop *uses* break opportunities.

## 0. Sources, conventions, terms

### 0.1 Pinned source

- Chrome 153.0.8010.48. The sparse checkout `~/github/browser-engines/chromium-153.0.8010.48` was still inside `git checkout` while I worked (no `third_party/blink/renderer` directory existed yet), so every Chromium file cited here was fetched from gitiles at `refs/tags/153.0.8010.48` (`curl 'https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.48/<path>?format=TEXT' | base64 -D`). Copies are in the session scratchpad under `c153/` and `c153bl/`. **Line numbers are those of the 153 tag.**
- `B/` below is short for `third_party/blink/renderer/`.
- Tags: **[V]** read in the pinned source at the cited lines. **[I]** inferred from code, not executed.

### 0.2 152 → 153 differences in the files this spec relies on

Compared with the committed 152.0.7977.83 files (`git show HEAD:<path>` in `~/github/browser-engines/chromium-152/src`, because that checkout has uncommitted TRACE210 logging in `line_breaker.cc` and `shaping_line_breaker.cc`):

| File | Difference |
|---|---|
| `B/platform/fonts/shaping/shaping_line_breaker.cc` | New branch at 370-375: when the han-kerning line-end trim lets the candidate reach the item end, return `ConcatShapeResults(...)` with the trimmed end result instead of `ShapeToEnd`. Gated by `LineBreakerHanKerningEnd` (stable, §18). All later line numbers in this file moved by +6 (plus one `#include` line at 12). |
| `B/core/layout/inline/line_breaker.cc` | 3857-3858: `FindLayoutOpportunity` gets `constraint_space_.Direction()` (floats only). No other change. |
| `B/core/layout/inline/inline_layout_algorithm.cc` | 1169-1170: same `Direction()` argument (floats only). |
| `B/platform/fonts/shaping/shape_result.cc`, `shape_result_run.h` | Grapheme and glyph-offset storage moved into a `RareData` object. No arithmetic change. |
| `B/platform/fonts/shaping/harfbuzz_shaper.cc` | Logging format only. |
| `B/platform/runtime_enabled_features.json5` | 623 changed lines; every flag cited in §18 was read at 153. |
| `line_breaker.h`, `shaping_line_breaker.h`, `line_info.cc/.h`, `inline_item_result.cc/.h`, `inline_item.cc/.h`, `inline_node.cc`, `inline_items_builder.cc`, `hyphen_result.cc/.h`, `layout_unit.h`, `shape_result.h`, `shape_result_view.cc/.h`, `shape_result_spacing.cc/.h`, `font.cc/.h`, `text_break_iterator.cc/.h`, `character.cc/.h`, `line_widths.cc`, `score_line_breaker.cc`, `paragraph_line_breaker.cc`, `logical_line_builder.cc` | Identical (0 changed lines). |

Files fetched only at 153 and not compared with 152: `web_frame_widget_impl.cc`, `web_view_impl.cc/.h`, `local_frame.cc`, `style_resolver.cc`, `font_builder.cc`, `font_size_functions.cc`, `font_description.cc`, `font_cache_key.h`, `font_platform_data_cache.cc`, `mac/font_cache_mac.mm`, `css_length_resolver.cc`, `css_primitive_value.cc/.h`, `length.h`, `length_functions.h/.cc`, `tab_size.h`, `text_spacing_trim.h`, `simple_font_data.cc`, `plain_text_node.cc`, `plain_text_painter.cc`, `text_metrics.cc`, `canvas_rendering_context_2d.cc`, `canvas_rendering_context_2d_state.cc`, `font_fallback_list.cc`, `font_features.cc`.

### 0.3 Terms

- **text_content**: the paragraph's text after white-space processing and `text-transform`, one string for the whole block. All offsets below are UTF-16 offsets into it.
- **Item** (`InlineItem`): a piece of the paragraph: a text run of one style, a control character run (tab, newline, ZWSP from `<wbr>`, CR, FF), an open tag, a close tag, a bidi control. Items have `[start, end)` offsets into text_content; tags have length 0.
- **Item result** (`InlineItemResult`): the part of an item placed on the current line: `[start, end)`, `inline_size`, `shape_result` (a view), `can_break_after`, `may_break_inside`, flags.
- **Shaping group**: consecutive text items shaped by one HarfBuzz call (§3.2). Each item keeps its own `ShapeResult` cut from the group's result.
- **LayoutUnit (LU)**: signed 32-bit fixed point, 1/64 of a *zoomed* pixel. "raw" means the integer count. At device pixel ratio 2 with page zoom 100%, one LU raw is 1/128 CSS px.
- **ceil64(f)**: `LayoutUnit::FromFloatCeil(f)`, rounds a float32 up to a whole raw LU. **trunc64(f)**: `LayoutUnit(float)`, truncates toward zero.
- **16.16 value**: an integer count of 1/65536 px (HarfBuzz positions, `TextRunLayoutUnit`, `InlineLayoutUnit`).
- **Safe to break before offset k**: HarfBuzz did not flag the glyph at k as unsafe, so the text can be split at k without reshaping (§1.4).
- **Reshape**: shape a substring again on its own (the substring's glyphs only, with the rest of the paragraph as HarfBuzz pre/post context).
- **Break opportunity**: an offset where the break iterator allows a soft wrap.
- **Trailable item**: an item that may be appended to a line after the wrap point (spaces, close tags, empty texts, bidi pops).
- **Hang**: content that stays on the line but is not counted against the available width.
- **Zoom**: Blink's layout zoom factor = device scale factor × browser zoom × CSS `zoom` of the embedding frame (§2.1). On a Retina display at 100% zoom it is 2.

---

## 1. Units and exact arithmetic

### 1.1 Types [V]

`B/platform/geometry/layout_unit.h:473-475`:

| Type | Storage | Fraction | Used for |
|---|---|---|---|
| `LayoutUnit` | `int32_t` | 6 bits (1/64) | positions, item widths, available width, line width |
| `TextRunLayoutUnit` | `int32_t` | 16 bits (1/65536) | per-glyph advance, letter/word spacing amounts |
| `InlineLayoutUnit` | `int64_t` | 16 bits | prefix sums of advances, run totals |

### 1.2 Conversions and operators [V]

| Operation | Rule | Citation |
|---|---|---|
| `LayoutUnit(float v)` | `saturated_cast<int32>(v * 64)`: truncates toward zero, NaN → 0 | `layout_unit.h:125-130`, `98-100` |
| `FromFloatCeil(v)` | `ceilf(v * 64)` then saturate | `layout_unit.h:134-136` |
| `FromFloatFloor(v)` / `FromFloatRound(v)` | `floorf` / `roundf` (half away from zero) | `layout_unit.h:140-148` |
| `InlineLayoutUnit::ToCeil<LayoutUnit>()` | `raw >> 10`, plus 1 if any of the low 10 bits is set (ceil for both signs) | `layout_unit.h:231-241` |
| `ToFloat()` | `static_cast<float>(raw) / denominator` | `layout_unit.h:244-246` |
| `AddEpsilon()` | raw + 1 (saturating) | `layout_unit.h:341-343` |
| `ClampNegativeToZero()` | max(0, v) | `layout_unit.h:307-309` |
| `LayoutUnit ± LayoutUnit` | saturating raw add/sub | `layout_unit.h:646-651, 679-682` |
| `LayoutUnit ± int` | the int is converted to **whole pixels** first (`LayoutUnit(1)` = 64 raw) | `layout_unit.h:653-655, 684-686` |
| `LayoutUnit + float` | returns `float` | `layout_unit.h:657-661` |
| `LayoutUnit <=> float` | compares `ToFloat()` with the float | `layout_unit.h:268` |
| `NearlyMax()` | raw `INT32_MAX - 32` | `layout_unit.h:350-352` |

The `LayoutUnit ± int` rule matters twice in the line breaker: `item_result->inline_size - 1` in `HandleOverflow` subtracts one whole layout pixel (`line_breaker.cc:4143`), and `available_width_with_hyphens + 1` adds one whole layout pixel (`line_breaker.cc:1692`).

### 1.3 How a text width is built [V]

1. Each glyph advance is HarfBuzz's 16.16 position taken as is: `TextRunLayoutUnit::FromFixed<16>(pos.x_advance)` (`B/platform/fonts/shaping/shape_result.cc:1356-1358, 1551-1553`).
2. A run (one font, one script segment) sums its advances as `InlineLayoutUnit`, clamps at 0 and stores **float32**: `run->width_ = total_advance.ClampNegativeToZero().ToFloat()` (`shape_result.cc:1539, 1573-1576`).
3. The item's `ShapeResult::width_` is a **float32 sum of run widths** (`shape_result.cc:1609`). After letter/word spacing it is rebuilt the same way: per-run `InlineLayoutUnit` total → float, float32 sum (`shape_result.cc:997-1044`). After `EnsurePositionData()` it is overwritten with the float of the exact whole-result 16.16 total (`shape_result.cc:2230`).
4. `ShapeResult::SnappedWidth()` = `FromFloatCeil(width_)` (`B/platform/fonts/shaping/shape_result.h:170`).
5. A line piece is a `ShapeResultView` over up to three segments (§6). Its `width_` is a float32 sum over parts. A part that covers a whole run uses `run->width_` (float); a part that covers part of a run sums that part's glyph advances as `InlineLayoutUnit` and converts to float (`B/platform/fonts/shaping/shape_result_view.cc:250-265`). `SnappedWidth()` = `FromFloatCeil(width_)` (`B/platform/fonts/shaping/shape_result_view.h:124`).
6. The item result's `inline_size` = `shape_result->SnappedWidth().ClampNegativeToZero()` (`B/core/layout/inline/line_breaker.cc:1703`), plus the hyphen width if hyphenated (§11).
7. The line position `position_` is a `LayoutUnit` sum of item `inline_size`s, starting at `text-indent` (`line_breaker.cc:876-879, 1409`; `B/core/layout/inline/line_info.cc:418-425`).

**Exactness.** A float32 holds 24 significant bits. A 16.16 value below 256 px fits exactly, so run widths, item widths and sums stay exact while every partial sum is below 256 zoomed px; above that the float32 steps are 1/32768 px or coarser and results round to even. A port must use `Math.fround` at every float step and integer arithmetic for every LU step. A float epsilon anywhere is wrong.

### 1.4 Per-character positions and safe-to-break flags [V]

- `ComputePositionData` walks glyphs in visual order, accumulating an exact `InlineLayoutUnit` prefix sum. The position of character k is `ToCeil<LayoutUnit>()` of the prefix sum of all glyphs before k's first glyph. Characters with no glyph take the last position (LTR) or this position (RTL) (`shape_result.cc:2112-2231`). A monospace compaction (every glyph maps 1:1 with one shared advance) stores only the advance and reconstructs `advance × k` bit-identically (`shape_result.cc:2218-2228, 2334-2343`).
- `CachedPositionForOffset(k)`: LTR returns that table entry; k == length returns `FromFloatCeil(width_)`. RTL returns the left edge of the next cluster base in visual order (`shape_result.cc:2325-2363`).
- `CachedOffsetForPosition(x)`: `x <= 0` → 0; `x >= width_` (float compare) → length; otherwise the largest k with `position(k) <= x`, found by binary search; RTL mirrors it (`shape_result.cc:2261-2323`).
- `CachedWidth(a, b)` = `position(b) - position(a)` in LU (`shape_result.cc:2365-2374`).
- Safe to break before glyph i: always before a run's first glyph; not inside a cluster; otherwise not if HarfBuzz set `HB_GLYPH_FLAG_UNSAFE_TO_BREAK` (`shape_result.cc:1360-1392`). `HanKerning` can add unsafe offsets (`B/platform/fonts/shaping/harfbuzz_shaper.cc:1044-1048`).
- `CachedNextSafeToBreakOffset(k)` / `CachedPreviousSafeToBreakOffset(k)`: nearest character at or after / at or before k whose flag is safe; at or past the end returns the end; before the start returns the start (`shape_result.cc:2376-2431`; RTL uses `NextSafeToBreakOffset`/`PreviousSafeToBreakOffset`, `shape_result.cc:503-553`). The monospace compaction treats every offset as safe (`shape_result.cc:2388-2390, 2419-2421`).

### 1.5 Where widths meet the available width [V]

| Comparison | Operator | Citation |
|---|---|---|
| `CanFitOnLine()` | `position_ <= available_width_ + 1 raw` | `B/core/layout/inline/line_breaker.h:307-317` |
| `RemainingAvailableWidth()` | `available_width_ + 1 raw - position_` | `line_breaker.h:311-313` |
| ShapeLine fast path (whole item) | `available_space >= result.SnappedWidth()` | `B/platform/fonts/shaping/shaping_line_breaker.cc:283` |
| ShapeLine candidate | largest k with `ceil64 prefix(k) <= start_position + available_space` | `shaping_line_breaker.cc:329-333` |
| Line-start reshape | `available_space += old_width − SnappedWidth(reshaped)`, clamped ≥ 0 | `shaping_line_breaker.cc:312-324` |
| Line-end reshape fits | `float(reshaped width) <= float(end_position − safe_position)` | `shaping_line_breaker.cc:546-553` |
| BreakText result | `inline_size <= available_width_with_hyphens` (inline size includes the hyphen) | `line_breaker.cc:1758` |
| Hyphen retry | `hyphen > available_width_with_hyphens − inline_size` (when that difference ≥ 0) | `line_breaker.cc:1710-1717` |
| Overflow walk | `width_to_rewind = position_ − (available + 1 raw)`, fit when `<= 0` | `line_breaker.cc:4080-4120` |

### 1.6 Port helpers

```ts
const f32 = Math.fround;
// LayoutUnit values: integers counting 1/64 zoomed px ("raw").
function luTrunc(f: number): number { return clampI32(Math.trunc(f32(f32(f) * 64))); } // LayoutUnit(float)
function luCeil(f: number): number  { return clampI32(Math.ceil(f32(f32(f) * 64))); }  // FromFloatCeil
function luRound(f: number): number { return clampI32(roundHalfAway(f32(f32(f) * 64))); }
function ceilFrom16(i16: number): number { // InlineLayoutUnit::ToCeil<LayoutUnit>
  const q = Math.floor(i16 / 1024);
  return clampI32(i16 % 1024 !== 0 ? q + 1 : q);
}
function runWidthF32(sum16: number): number { return f32(Math.max(0, sum16)) / 65536; } // ToFloat, exact /2^16
function addF32(a: number, b: number): number { return f32(a + b); }
const ONE_PX = 64; // LayoutUnit(1)
```

---

## 2. Zoom, device pixel ratio, font size and the available width

### 2.1 The zoom factor [V]

- `layout_zoom_factor = device_scale_factor × ZoomLevelToZoomFactor(zoom_level) × css_zoom_factor`, all as float (`B/core/frame/web_frame_widget_impl.cc:2525-2575`). `device_scale_factor` is `ZoomFactorForViewportLayout()` (`web_frame_widget_impl.cc:2538-2541`; `B/core/exported/web_view_impl.h:182-201`), set from the screen's device scale factor (`web_frame_widget_impl.cc:5456-5459`; `web_view_impl.cc:2496-2514`).
- The root style's zoom and effective zoom are `frame->LayoutZoomFactor()` (`B/core/css/resolver/style_resolver.cc:2374-2379, 2395-2396`).
- `window.devicePixelRatio` = `InspectorDeviceScaleFactorOverride() × LayoutZoomFactor()` (`B/core/frame/local_frame.cc:1933-1941`). The override is `zoom_factor_for_device_scale_factor_ / compositor_device_scale_factor_override_` when device emulation overrides the compositor scale, else 1 (`web_view_impl.cc:2439-2447`). **[I]** So an emulated device scale factor (DevTools device mode, headless `deviceScaleFactor`) can report `devicePixelRatio == 2` while layout zoom stays 1. The groundwork observed exactly this in headless Chrome (NOTES.md: "reports DPR 2 but lays text out in CSS px LayoutUnits"). Installed Chrome on a Retina screen uses layout zoom 2.

### 2.2 CSS lengths → available width [V]

1. A `px` length is multiplied by zoom as a double (`B/core/css/css_length_resolver.cc:153-160`) and stored as `Length::Fixed(ClampToCSSLengthRange(double))`, a **float** (`B/core/css/css_primitive_value.cc:328-333`; `B/core/css/css_primitive_value.h:282`; `B/platform/geometry/length.h:147-150, 204-206, 403`).
2. A fixed length becomes `LayoutUnit(length.Pixels())`, **truncated** (`B/platform/geometry/length_functions.h:52-57`). A percentage is `LayoutUnit(float(maximum × percent / 100f))`, also truncated (`B/platform/geometry/length_functions.cc:64-68`).
3. The line's available width is the line opportunity's inline size (`B/core/layout/exclusions/line_layout_opportunity.h:55-58`), then `UpdateAvailableWidth()`: minus the line-clamp ellipsis (off by default), at least the cloned box-decoration start size, at most `NearlyMax()` (`line_breaker.cc:426-462`). `text-wrap: balance` may override it (`line_breaker.cc:564-568`; `B/core/layout/inline/inline_layout_algorithm.cc:118-131`).

### 2.3 Font size [V]

- Computed font size = `min(kMaximumAllowedFontSize, specified_size × zoom_factor)` as float, where `zoom_factor` includes the effective zoom and the text zoom preference (`B/core/css/font_size_functions.cc:218`; `B/core/css/resolver/font_builder.cc:304-326`).
- The platform font is created at `EffectiveFontSize() = floorf(computed × 100) / 100`, with the multiplication in **float32** (`B/platform/fonts/font_description.cc:271-282`; `B/platform/fonts/font_cache_key.h:53`; `B/platform/fonts/font_platform_data_cache.cc:60-61`; `B/platform/fonts/mac/font_cache_mac.mm:273-275`).
- Consequences computed with float32 (Python `struct` emulation, this session):

| `font-size` | zoom | computed (float32) | computed×100 (float32) | effective size |
|---|---|---|---|---|
| 16px | 1, 1.5, 2 | 16, 24, 32 | 1600, 2400, 3200 | 16, 24, 32 |
| 13.33px | 1.5 | 19.994999 | 1999.4999 | **19.99** |
| 14.1px | 1.25 | 17.625 | 1762.5 | 17.62 |
| 17.3px | 1 | 17.299999 | 1729.99988 | **17.29** |
| 17.3px | 2 | 34.599998 | 3459.99976 | **34.59** |

  **[I]** So `font: 17.3px Arial` is shaped at 17.29 px even at DPR 1 (hypothesis H3).

### 2.4 The device-pixel grid at DPR 1, 1.5 and 2

Everything in the line breaker is in zoomed px: glyph advances come from the font at the zoomed size, and all LU values count 1/64 of a device px. CSS px counts do not appear anywhere in the loop.

Worked example: a block with `width: 150.3px` (content box, no padding) and one word with a float32 width at 16px of exactly `W16 = 150.3046875` (= 9619.5/64). Assume the font's advances scale linearly, so the word is `1.5×W16` at 24px and `2×W16` at 32px.

| zoom | available: trunc64(150.3 × zoom) | fit bound (+1 raw) | word: ceil64(W) | fits? |
|---|---|---|---|---|
| 1 | trunc(9619.20) = 9619 raw = 150.296875 px | 9620 raw = 150.3125 px (css 150.3125) | ceil(9619.5) = 9620 | yes (9620 ≤ 9620) |
| 1.5 | trunc(14428.80) = 14428 raw = 225.4375 dev px | 14429 raw (css 150.302083) | ceil(14429.25) = 14430 | **no** |
| 2 | trunc(19238.40) = 19238 raw = 300.59375 dev px | 19239 raw (css 150.3046875) | ceil(19239.0) = 19239 | yes |

More available-width values (float32 emulated): `width: 100.01px` gives 6400 raw (zoom 1), 9600 raw = 150.0 dev px (zoom 1.5), 12801 raw = 200.015625 dev px (zoom 2). `width: 112px` gives 7168 / 10752 / 14336 raw.

### 2.5 Canvas ignores zoom [V]

The HTML canvas resets `ComputedSize` and `AdjustedSize` to `SpecifiedSize`, "to skip zoom and minimum font size" (`B/modules/canvas/canvas2d/canvas_rendering_context_2d.cc:690-706, 722-727`). Canvas `letterSpacing` / `wordSpacing` are converted with the canvas's conversion data (`B/modules/canvas/canvas2d/canvas_rendering_context_2d_state.cc:399-403, 900-903`). **[I]** To get DOM device-px widths at zoom 2 from Canvas, measure at `2 × font-size` (the same float32 `EffectiveFontSize` floor then applies to the same value).

---

## 3. What the line breaker visits

### 3.1 Items [V]

- Text items follow `LayoutText` boundaries (style boundaries) and are split further:
  - At control characters: LF, runs of TAB, ZWNJ (starts a new *text* item), CR and FF (`B/core/layout/inline/inline_items_builder.cc:165-184`). In preserved white space: LF → forced-break control item; a run of tabs → one `kControl` item with `kFlowControl`; ZWNJ splits but stays text; CR/FF → a one-character `kControl` item (`inline_items_builder.cc:1040-1135`). **VT (U+000B) is not a control item** in this builder; it stays in a text item.
  - `<wbr>` appends an opaque `kControl` ZWSP (`inline_items_builder.cc:1211-1215`).
  - Bidi level changes split items (`B/core/layout/inline/inline_node.cc:1333-1432`; `B/core/layout/inline/inline_item.cc:207-236`).
- Open/close tags are zero-length items. Text, control and block-in-inline items can be collapsible at their end; all other types (tags, floats, out-of-flow, bidi controls) are **opaque to collapsing** (`B/core/layout/inline/inline_item.h:215-226`), so trailing-space search looks through them (§8.3).
- `text-transform` applies before text_content is built: the builder appends `layout_text->TransformedText()` (`inline_items_builder.cc:495`), so the measured and broken string is the transformed one [V for the call site; details belong to the white-space spec].

### 3.2 Shaping groups and spacing [V]

`InlineNode::ShapeText` (`inline_node.cc:1551-1796`):

- Starting from a non-empty text item, extend the group over following items while all hold (`inline_node.cc:1636-1674`):
  - not a `kControl` item (tab, LF, ZWSP, CR/FF break shaping);
  - empty text items are skipped;
  - not a symbol marker;
  - `ShouldBreakShapingBeforeText` is false: the font is equal (`&style == &start_style` or `*font == start_font`), the direction is equal, and the run segment (script, orientation, fallback priority) is equal (`inline_node.cc:472-491`);
  - the text does not start with ZWNJ;
  - an open tag has no non-zero inline-start padding, margin or border and baseline `vertical-align`; a close tag likewise at its inline end (`inline_node.cc:494-527`);
  - any other item type ends the group.
- 8-bit text_content (or no non-ORC 16-bit characters) without bidi gets one segment with script Latin (`inline_node.cc:1256-1266`).
- The group is shaped once; spacing from the **start item's font description** is applied to the whole group (`inline_node.cc:1717-1730`), then the result is cut into per-item results without reshaping (`inline_node.cc:1743-1781`).
- Spacing (`B/platform/fonts/shaping/shape_result_spacing.cc:14-32, 103-139`; `shape_result.cc:993-1046`):
  - amounts are `TextRunLayoutUnit(float)`, truncated to 1/65536;
  - added to the last glyph of every grapheme cluster, including the last cluster of the text;
  - letter spacing skipped for zero-width characters (`TreatAsZeroWidthSpace`), and inside cursive scripts except on spaces (`IgnoreLetterSpacingInCursiveScripts`, stable);
  - word spacing on U+0020, TAB, LF, NBSP (`B/platform/text/character.h:159-162`), skipped at text_content index 0 unless the character is NBSP or `allow_word_spacing_anywhere` (true for SVG, or when the block preserves white space under `WordSpacingWhiteSpacePre`, stable: `inline_node.cc:1561-1565`).
- Any non-zero letter spacing turns off `liga`, `clig`, `dlig`, `hlig` (`B/platform/fonts/shaping/font_features.cc:52-79`) and `calt` (`font_features.cc:80-86`).

### 3.3 Reshaping during line breaking [V]

`LineBreaker::ShapeText(item, start, end, options)` shapes `[start, end)` with the item's font, direction and segment data over the full text_content (so HarfBuzz sees pre/post context characters: `B/platform/fonts/shaping/case_mapping_harfbuzz_buffer_filler.cc:32-44`), then applies `spacing_`, the spacing of the line breaker's *current style* (`line_breaker.cc:2044-2064, 4557-4561`). The `is_line_start` option only feeds `HanKerning` (`harfbuzz_shaper.cc:1019-1030`).

---

## 4. The line loop

### 4.1 Per line [V]

`NextLine` (`line_breaker.cc:893-1007`), `PrepareNextLine` (`line_breaker.cc:810-891`):

```ts
function nextLine() {
  // PrepareNextLine
  if (!current.isZero()) { previousLineHadForcedBreak = isForcedBreak; isForcedBreak = false; }
  lineInfo.start = current;                       // {itemIndex, textOffset}
  lineInfo.isStartOfParagraph = current.isZero() || previousLineHadForcedBreak;
  lineInfo.textIndent = applies ? MinimumValueForLength(text-indent) : 0;  // LU, truncated
  overrideBreakAnywhere = false; disablePhrase = false;
  if (!currentStyle) setCurrentStyle(lineStyle);  // otherwise keep the style at the break token
  computeBaseDirection();                          // unicode-bidi: plaintext only
  hyphenIndex = null; hasAnyHyphens = false;
  position = lineInfo.textIndent;
  lastRewind = null;

  breakLine();

  if (hyphenIndex != null) results[hyphenIndex].isHyphenated = true;   // FinalizeHyphen
  removeTrailingCollapsibleSpace();                                     // §8.3
  splitTrailingBidiPreservedSpace();                                    // §14
  lineInfo.endItemIndex = current.itemIndex;
  if (trailingWhitespace == Preserved) lineInfo.hasTrailingSpaces = true;
  lineInfo.width = position;                      // ComputeLineLocation, §17
  breakToken = atEnd() ? null
    : { start: current, style: currentStyle, forced: isForcedBreak };  // CreateBreakToken 4696-4774
}
```

The next line starts from `{itemIndex, textOffset}`, the style active at the end of the previous line, and the forced-break flag (`line_breaker.cc:548-553`). Nothing else carries over (fact 8: Blink needs no carried measurement).

### 4.2 States [V]

`B/core/layout/inline/line_breaker.h:160-175`:

- `Continue`: still looking for items that fit.
- `Overflow`: the line overflowed with no earlier break opportunity; end at the earliest opportunity.
- `Trailing`: the break point is known; only trailable items (spaces, close tags, empty texts, `<br>`) may still be appended.
- `Done`.

### 4.3 BreakLine [V]

`line_breaker.cc:1009-1147`, content mode, no floats/atomic inlines/ruby:

```ts
function breakLine() {
  state = Continue;
  trailingWhitespace = Leading;
  while (state != Done) {
    if (current.itemIndex >= items.length) {                  // IsAtEnd
      if (handleOverflowIfNeeded() && !atEnd()) continue;      // state==Continue && !canFitOnLine()
      if (hasHyphen()) position -= removeHyphen();
      lineInfo.isLastLine = true;
      return;
    }
    if (state == Overflow && lastResult()?.canBreakAfter) state = Trailing;
    const item = items[current.itemIndex];
    switch (item.type) {
      case Text:       item.length ? handleText(item, item.shapeResult) : handleEmptyText(item); continue;
      case OpenTag:    handleOpenTag(item); continue;
      case CloseTag:   handleCloseTag(item); continue;
      case Control:    handleControlItem(item); continue;
      case BidiControl: handleBidiControlItem(item); continue;
      // floats, block-in-inline, ruby: out of scope
    }
    if (state == Trailing) return;   // non-trailable items (atomic inlines, list markers...) end a trailing line
    ...
  }
}
```

Items are visited in logical order, once each, except when a rewind moves `current` back (§9).

---

## 5. Text items: HandleText and BreakText

### 5.1 HandleText [V]

`line_breaker.cc:1322-1504`:

```ts
function handleText(item, sr) {
  if (state == Trailing) return handleTrailingSpaces(item, sr);                        // 1332-1335
  if (trailingWhitespace == Leading && item.style.collapsesWhiteSpace
      && text[current.textOffset] == ' ') {                                           // 1340-1353
    current.textOffset++;                                   // one space = the whole collapsed run
    if (current.textOffset == item.end) return handleEmptyText(item);
  }
  if (state == Continue && !canFitOnLine()) {                                          // 1357-1372
    if (autoWrap && isSpaceLB(text[current.textOffset])) {
      handleTrailingSpaces(item, sr);
      if (state != Done) { state = Continue; return; }
    }
    return handleOverflow();
  }
  if (hasHyphen()) position -= removeHyphen();                                         // 1374-1376
  const r = addItem(item, current.textOffset, item.end);  r.shouldCreateLineBox = true;
  if (autoWrap) {
    const avail = remainingAvailableWidth();                                            // avail + 1 raw − position
    const res = breakText(r, item, sr, avail, avail);
    position += r.inlineSize;
    moveToNextOf(r);                                        // current = r.end; itemIndex++ if r.end == item.end
    if (res == Success) {
      if (r.end < item.end) return handleTrailingSpaces(item, sr);
      return;
    }
    // Overflow
    if (!r.shapeResult) return handleOverflow();            // break-word first pass: no result (1439-1443)
    if (r.hasOnlyPreWrapTrailingSpaces) {                   // 1446-1457
      state = Trailing;
      if (item.style.preservesWhiteSpace && isSpaceLB(text[r.end - 1]))
        rewind(indexOf(r));                                 // unless sub-breaker with index 0
      return;
    }
    if (state == Overflow) { if (r.canBreakAfter) state = Trailing; return; }         // 1460-1464
    if (allSpacesLB(text, r.start, r.end)) return;                                     // 1468-1470
    return handleOverflow();
  }
  // !autoWrap: white-space nowrap / pre / text-wrap-mode nowrap
  r.shapeResult = (r.start == item.start) ? viewOf(sr) : view(sr, r.start, r.end);
  r.inlineSize = max(0, luCeil(r.start == item.start ? sr.width : r.shapeResult.width));
  trailingWhitespace = Unknown;
  position += r.inlineSize;
  moveToNextOf(item);
}
```

`isSpaceLB(c)` is `c == U+0020 || c == U+0009` (`line_breaker.cc:186-188`).

### 5.2 BreakText [V]

`line_breaker.cc:1603-1759`:

```ts
function breakText(r, item, sr, availableWidth, availableWidthWithHyphens) {
  const b = new ShapingLineBreaker(sr, breakIterator, hyphenation, item.style.font);
  b.textSpacingTrim = item.style.textSpacingTrim;
  b.lineStart = lineInfo.startOffset;
  b.isAfterForcedBreak = previousLineHadForcedBreak;
  if (!needsAccurateEndPosition(lineInfo, item)) b.dontReshapeEndIfAtSpace = true;    // 1658-1659
  if (breakAnywhereIfOverflow && !overrideBreakAnywhere) b.noResultIfOverflow = true;  // 1671-1672
  let inlineSize, out;
  for (;;) {                                                                            // at most 2 passes
    const view = b.shapeLine(r.start, max(0, availableWidth), out = {});
    if (!view) {                                                                         // 1690-1696
      r.inlineSize = availableWidthWithHyphens + ONE_PX;
      r.end = item.end;
      return Overflow;
    }
    inlineSize = max(0, luCeil(view.width));
    r.inlineSize = inlineSize;
    if (out.isHyphenated) {                                                              // 1705-1720
      const h = addHyphen(r);                              // r.inlineSize += hyphen width
      if (!out.isOverflow && inlineSize <= availableWidth) {
        const spaceForHyphen = availableWidthWithHyphens - inlineSize;
        if (spaceForHyphen >= 0 && h > spaceForHyphen) {
          availableWidth -= h; removeHyphen(); continue;   // retry narrower
        }
      }
      inlineSize = r.inlineSize;
    }
    r.end = out.breakOffset;
    r.hasOnlyPreWrapTrailingSpaces = r.hasOnlyBidiTrailingSpaces = out.hasTrailingSpaces;
    r.shapeResult = view;
    break;
  }
  if (r.end < item.end) {                                                                // 1737-1745
    r.canBreakAfter = true;
    trailingWhitespace = breakIterator.breakType == BreakCharacter ? Unknown : None;
  } else {
    r.canBreakAfter = canBreakAfter(item);                 // §7
    trailingWhitespace = Unknown;
  }
  r.mayBreakInside = !out.isOverflow;                                                    // 1754
  return inlineSize <= availableWidthWithHyphens ? Success : Overflow;                  // 1758
}
```

`needsAccurateEndPosition(lineInfo, item)` (`line_breaker.cc:255-268`; `line_info.cc:127-179`) is true when any of:
- `text-align` is `end`, `center`, `-webkit-center`, `justify`, `match-parent`; or `left` in an RTL line; or `right` in an LTR line;
- `text-align-last` is `end`, `center`, `justify`, `match-parent`; `left` in RTL; `right` in LTR;
- the line-end item's style has a box decoration background, or applied text decorations.

The default (`text-align: start`, no decoration) gives `dontReshapeEndIfAtSpace = true`.

Note the fit decision uses `inlineSize` (ceil64 of the view's float width), not ShapeLine's `isOverflow` (`line_breaker.cc:1756-1758`). Because positions are ceil64 of prefix sums, `position(b) − position(start)` can be 1 raw smaller than `ceil64(width of [start, b))` when the line starts mid-item. A break that ShapeLine thought fit can then return `Overflow`; `HandleOverflow` re-breaks the item with `inline_size − 1px` (§9).

---

## 6. ShapingLineBreaker::ShapeLine

`shaping_line_breaker.cc:256-612`. `flip(v)` is `v` for LTR, `−v` for RTL (`:33-36`). `isSpaceSLB(c)` = U+0020, TAB, LF or U+3000 (`:38-41`; `B/platform/text/text_break_iterator.h:203-205`; `character.h:156-158`).

```ts
function shapeLine(start, availableSpace, out) {
  const rangeStart = sr.start, rangeEnd = sr.end;
  out.isOverflow = out.isHyphenated = out.hasTrailingSpaces = false;
  // 1. Whole item fits.                                                         283-297
  if (start == rangeStart && availableSpace >= luCeil(sr.width)
      && !(isStartOfWrappedLine(start) && shouldTrimStartOfWrappedLine(trim))    // false by default
      && sr.isStartSafeToBreak()) {
    setBreakOffset(rangeEnd); return viewOf(sr);
  }
  ensurePositionData();
  const startPos = pos(start);
  // 2. Reshape the start of a wrapped line.                                     309-324
  const firstSafe = firstSafeOffset(start);  // {offset, hanKerning}
  let lineStartResult = null;
  if (firstSafe.offset != start) {
    lineStartResult = reshape(start, firstSafe.offset, {isLineStart: true, hanKerningStart: firstSafe.hanKerning});
    const oldWidth = flip(pos(firstSafe.offset) - startPos);
    const diff = oldWidth - luCeil(lineStartResult.width);
    if (diff) availableSpace = max(availableSpace + diff, 0);
  }
  // 3. Candidate: first character that starts at or before the edge.           329-340
  const endPos = startPos + flip(availableSpace);
  let candidate = offsetForPosition(endPos) + rangeStart;
  // (text-autospace adjustment: default off)
  // 4. Han kerning at the line end (text-spacing-trim: normal).                 344-363
  let lastSafe, lineEndResult = null;
  if (candidate < rangeEnd && shouldTrimEnd(trim) && maybeHanKerningClose(text[candidate])) {
    const adj = candidate + 1;
    if (breakIterator.isBreakable(adj)) {
      lastSafe = prevSafe(candidate);
      lineEndResult = reshape(lastSafe, adj, {hanKerningEnd: true});
      if (f32(flip(pos(lastSafe) - startPos) / 64 + lineEndResult.width) <= availableSpace / 64) candidate = adj;
      else lineEndResult = null;
    }
  }
  if (candidate >= rangeEnd) {                                                   // 365-378
    setBreakOffset(rangeEnd);
    if (lineEndResult /* && LineBreakerHanKerningEnd, stable */)
      return concat(start, rangeEnd, firstSafe.offset, lastSafe, lineStartResult, lineEndResult);
    return shapeToEnd(start, lineStartResult, firstSafe.offset, rangeStart, rangeEnd);
  }
  candidate = max(candidate, start);
  // 5. Pick a break opportunity.                                                389-454
  const afterAnySpace = breakIterator.breakSpace == AfterEverySpace;   // white-space: break-spaces
  let bo;
  if (!isSpaceSLB(text[candidate]) || afterAnySpace) {
    bo = previousBO(candidate, start);
    out.isOverflow = bo.offset <= start;
    if (out.isOverflow) {
      if (noResultIfOverflow) return null;
      bo = nextBO(max(candidate, start + 1), start, rangeEnd);
    }
  } else {                                  // the candidate is a breakable space
    bo = nextBO(max(candidate, start + 1), start, rangeEnd);
    if (bo.offset > candidate && (bo.nonHangableRunEnd == null || bo.nonHangableRunEnd > candidate)) {
      const prev = previousBO(candidate, start);
      if (prev.offset > start) bo = prev;
      else { out.isOverflow = true; if (noResultIfOverflow) return null; }
    }
    if (bo.nonHangableRunEnd != null && bo.nonHangableRunEnd <= start) {   // only spaces from start
      out.hasTrailingSpaces = true;
      out.breakOffset = min(rangeEnd, bo.offset); out.isHyphenated = false;
      return view(sr, start, out.breakOffset);
    }
  }
  // 6. Clamp to the item end.                                                    456-479
  let reshapeLineEnd = !lineEndResult;
  if (bo.offset >= rangeEnd) {
    setBreakOffset(rangeEnd);
    if (out.isOverflow) return shapeToEnd(start, lineStartResult, firstSafe.offset, rangeStart, rangeEnd);
    bo.offset = rangeEnd;
    reshapeLineEnd = false;                  // e.g. <span>abc</span>def: the range end is not reshaped
    if (bo.nonHangableRunEnd != null && rangeEnd < bo.nonHangableRunEnd) bo.nonHangableRunEnd = null;
    if (isSpaceSLB(text[rangeEnd - 1])) bo.nonHangableRunEnd = findNonHangableEnd(rangeEnd - 1);
  }
  if (dontReshapeEndIfAtSpace && reshapeLineEnd) reshapeLineEnd = !isSpaceSLB(text[bo.offset - 1]);  // 484-488
  if (!afterAnySpace && bo.nonHangableRunEnd != null) bo.offset = max(start + 1, bo.nonHangableRunEnd); // 492-495
  // 7. No safe point between start and the break: reshape the whole piece.       500-507
  if (firstSafe.offset >= bo.offset) {
    setBreakOffset(bo);
    return viewOf(reshape(start, bo.offset, {isLineStart: true, hanKerningStart: firstSafe.hanKerning}));
  }
  // 8. Reshape the line end if the break is not safe.                            511-584
  if (reshapeLineEnd) {
    for (;;) {
      if (!afterAnySpace && bo.nonHangableRunEnd != null) bo.offset = max(start + 1, bo.nonHangableRunEnd);
      lastSafe = prevSafe(bo.offset);
      if (lastSafe == bo.offset) break;
      if (lastSafe < firstSafe.offset) { lastSafe = start; lineStartResult = null; }
      if (out.isOverflow) { lineEndResult = reshape(lastSafe, bo.offset); break; }
      const safePos = pos(lastSafe);
      lineEndResult = reshape(lastSafe, bo.offset);
      if (lineEndResult.width <= f32(flip(endPos - safePos) / 64)) break;    // float compare
      lineEndResult = null;
      bo = previousBO(bo.offset - 1, start);
      if (bo.offset > start) continue;
      out.isOverflow = true;                 // nothing fits: take the opportunity around the candidate
      bo = previousBO(candidate, start);
      if (bo.offset <= start) {
        bo = nextBO(max(candidate, start + 1), start, rangeEnd);
        if (bo.offset >= rangeEnd) { setBreakOffset(rangeEnd); return shapeToEnd(start, lineStartResult, firstSafe.offset, rangeStart, rangeEnd); }
      }
    }
  }
  if (!lineEndResult) lastSafe = bo.offset;  // (text-autospace unapply: default off)       586-596
  setBreakOffset(bo);
  return concat(start, bo.offset, firstSafe.offset, lastSafe, lineStartResult, lineEndResult);   // 610-611
}
```

Helpers (`shaping_line_breaker.cc:72-225, 613-675`; `shaping_line_breaker.h:104-107`):

```ts
isStartOfWrappedLine(k) = k != 0 && k == lineStart && !isAfterForcedBreak;
firstSafeOffset(k) = !isStartOfWrappedLine(k) ? {offset: k}
  : shouldTrimStartOfWrappedLine(trim) && maybeHanKerningOpen(text[k]) ? /* not default */ ...
  : {offset: nextSafe(k)};
findNonHangableEnd(k) { let e = k; while (e > 0) { if (!isSpaceSLB(text[--e])) return e + 1; } return e; }
previousBO(k, start) { const b = iter.previousBreakOpportunity(k, start);
  return isSpaceSLB(text[b - 1]) ? {offset: b, nonHangableRunEnd: findNonHangableEnd(b - 1)} : {offset: b}; }
nextBO(k, start, len) { const b = iter.nextBreakOpportunity(k, len);   // scan limited to len
  return isSpaceSLB(text[b - 1]) ? {offset: b, nonHangableRunEnd: findNonHangableEnd(b - 1)} : {offset: b}; }
setBreakOffset(bo) { out.breakOffset = bo.offset; out.isHyphenated = bo.isHyphenated || text[bo.offset - 1] == U+00AD; }
shapeToEnd(start, lsr, firstSafe, rs, re) =
  !lsr ? (start == rs ? viewOf(sr) : view(sr, start, re))
  : firstSafe >= re ? view(lsr, start, re)
  : view([lsr whole], [sr firstSafe..re]);
concat(start, end, firstSafe, lastSafe, lsr, ler) =
  view([lsr whole]?, [sr firstSafe..lastSafe] if lastSafe > firstSafe, [ler whole]?);
```

With `hyphens: auto` the opportunity functions go through `Hyphenate` (`shaping_line_breaker.cc:111-172`); out of scope for this spec except that `hyphens: manual` leaves `hyphenation_` null (§10).

**What a port needs from the font per item** (fact 5, fact 6): the 16.16 advances per glyph per run, the glyph → character map, the safe-to-break flag per character, and the ability to reshape any `[a, b)` of an item alone and get its runs' 16.16 sums. Reshaped widths are decided **during** line breaking: at the start of a wrapped line (only if that line starts at an unsafe offset) and at a line end that is not a space (or is a space when `needsAccurateEndPosition`).

---

## 7. Break opportunities at item edges (styled runs)

The break iterator runs over the **whole text_content**, not per item (`line_breaker.cc:487-496`). Where an item ends, the line breaker asks the iterator about that offset with the *current style's* settings (locale, strictness, break type):

- `CanBreakAfter(item)` = `breakIterator.IsBreakable(item.end)`, with exceptions for ruby bidi controls, atomic inlines at the next offset and text-combine (`line_breaker.cc:1210-1267`). `IsBreakable(pos)` limits the scan to `pos + 1` characters (`text_break_iterator.h:185-194`).
- **Example (fact 1).** `<b>foo</b>bar`: text_content `"foobar"`, items `[open b]["foo"][close b]["bar"]`. `"foo"` fits; its `can_break_after = IsBreakable(3)` on `"foobar"` = false. The close tag then gets `can_break_after` only if the previous item had it, or if the next character is a breakable space (below). So there is no opportunity between `foo` and `bar`, and the line overflows as one word.
- `HandleOpenTag` (`line_breaker.cc:3957-4008`): adds the open tag with its inline-start margin + border + padding as `inline_size` (`line_breaker.cc:3937-3955`), sets the new current style, and if the style switched from nowrap to wrap and the previous item is text, recomputes that text's `can_break_after = autoWrap && IsBreakable(end)` (`line_breaker.cc:270-275, 4003-4007`).
- `HandleCloseTag` (`line_breaker.cc:4010-4074`): `inline_size` = inline-end margin + border + padding (`line_breaker.cc:245-253`), style becomes the parent's. Then:
  - if the previous result had `can_break_after`, move it to the close tag;
  - else if the closed element wrapped: `can_break_after = isSpaceLB(text[end]) && (!parentStyle.ShouldBreakOnlyAfterWhiteSpace() || isSpaceLB(text[end − 1])) && !IsNextNonBidiControlItemOpenTag()` (the last term under `LineBreakAfterSpaceBeforeOpenTag`, stable);
  - else if the parent wraps and `text[end − 1]` is not a space: `can_break_after = IsBreakable(end)`.
  `ShouldBreakOnlyAfterWhiteSpace()` = (preserves white space and wraps) or `line-break: after-white-space` (`B/core/style/computed_style.h:2326-2329`).
- `AddEmptyItem` moves a `can_break_after` from the previous result onto the empty result (`line_breaker.cc:600-616`).
- Bidi pop controls take over `can_break_after` from the previous result, or compute it from the iterator; push controls end a trailing line (`line_breaker.cc:3001-3041`).
- A soft wrap inside an item is always `can_break_after = true` at the break (`line_breaker.cc:1737-1745`).

**Locale per span (fact 2, fact 7).** `SetCurrentStyleForce` calls `break_iterator_.SetLocale(font_description.Locale())` for every wrapping style (`line_breaker.cc:4563-4566`). A span with a different `lang` changes the iterator's locale while its items are handled, including the `IsBreakable(end)` query at that span's text end. Breaks found by `ShapeLine` inside an item use that item's style.

---

## 8. White space at line ends

### 8.1 The white-space values [V for the keywords and predicates used; mapping I]

`white-space-collapse` keywords `collapse | preserve | preserve-breaks | break-spaces`, initial `collapse`; `text-wrap-mode` `wrap | nowrap`, initial `wrap` (`B/core/css/css_properties.json5:8163-8193`). The line breaker only reads `ShouldWrapLine()`, `ShouldCollapseWhiteSpaces()`, `ShouldPreserveWhiteSpaces()`, `ShouldBreakSpaces()`, `ShouldBreakOnlyAfterWhiteSpace()` (`computed_style.h:2294-2329`).

| `white-space` | wraps | collapses spaces | preserves spaces | break-spaces |
|---|---|---|---|---|
| normal | yes | yes | no | no |
| nowrap | no | yes | no | no |
| pre | no | no | yes | no |
| pre-wrap | yes | no | yes | no |
| pre-line | yes | yes (breaks preserved) | no | no |
| break-spaces | yes | no | yes [I] | yes |

`ShouldBreakSpaces()` selects `BreakSpaceType::kAfterEverySpace`; everything else `kAfterSpaceRun` (`line_breaker.cc:4636-4641`). The iterator's space rule: with `kAfterSpaceRun` no break inside a run of space/TAB/LF, and a break before the first non-space after it; with `kAfterEverySpace` a break after every space or U+3000 (`B/platform/text/text_break_iterator.cc:282-303`).

### 8.2 HandleTrailingSpaces [V]

`line_breaker.cc:2418-2534`:

```ts
function handleTrailingSpaces(item, sr) {
  if (!autoWrap) { state = Done; return; }
  const style = item.style, c = text[current.textOffset];
  if (style.collapsesWhiteSpace && c != U+3000) {
    if (c != ' ') {
      if (current.textOffset > 0 && isSpaceLB(text[current.textOffset - 1])) trailingWhitespace = Collapsible;
      state = Done; return;
    }
    current.textOffset++;                                  // skip the one collapsed space, no width added
    if (trailingWhitespace != Preserved) trailingWhitespace = Collapsed;
    results.last.canBreakAfter = true;                      // even if nowrap
  } else if (!style.breakSpaces) {                          // pre-wrap, or U+3000 in collapsing text
    let end = current.textOffset;
    while (end < item.end && isSpaceOrU3000(text[end])) end++;
    if (end == current.textOffset) {
      if (isSpaceOrU3000(text[end - 1])) trailingWhitespace = Preserved;
      state = Done; return;
    }
    const r = addItem(item, current.textOffset, end);
    r.shouldCreateLineBox = true; r.hasOnlyPreWrapTrailingSpaces = r.hasOnlyBidiTrailingSpaces = true;
    r.shapeResult = viewOf(sr);
    if (r covers the whole item) r.inlineSize = luCeil(r.shapeResult.width);        // no clamp
    else { r.shapeResult = truncateLineEndResult(r, r.end); r.inlineSize = luCeil(r.shapeResult.width); }
    position += r.inlineSize;                               // hanging spaces are counted in position...
    r.canBreakAfter = end < text.length && !isSpaceOrU3000(text[end]);
    current.textOffset = end;
    trailingWhitespace = Preserved;
  }
  // break-spaces: neither branch
  if (current.textOffset < item.end) { state = Done; return; }
  if (results.empty || results.last.item != item) addEmptyItem(item);
  current.itemIndex++;
  state = Trailing;                                         // ...but Trailing never runs the overflow check
}
```

So preserved spaces after a wrap point **hang**: they add to `position_` and the line width, but `HandleOverflowIfNeeded` only runs in `Continue` (`line_breaker.cc:619-625`). With `break-spaces` spaces are ordinary content: `ShapeLine` uses the previous opportunity even at a space (`shaping_line_breaker.cc:390-395`), and `RewindOverflow` does not treat them as trailable (`line_breaker.cc:4354, 4380`).

### 8.3 Removing a trailing collapsible space [V]

`RemoveTrailingCollapsibleSpace` (`line_breaker.cc:2562-2613`), `ComputeTrailingCollapsibleSpaceHelper` (`line_breaker.cc:2668-2747`), `TruncateLineEndResult` (`line_breaker.cc:2369-2405`):

```ts
function removeTrailingCollapsibleSpace() {
  if (!isForcedBreak) rewindTrailingOpenTags();     // a line never ends with open tags
  if (trailingWhitespace in {Leading, None, Collapsed, Preserved}) return;
  trailingWhitespace = None;
  for (r of results reversed) {
    if (r.item.endCollapseType == OpaqueToCollapsing) continue;   // tags, bidi controls
    if (r.item.type == Text) {
      if (r.length == 0) continue;
      const last = text[r.end - 1];
      if (last == U+3000) { trailingWhitespace = Preserved; return; }
      if (!isSpaceLB(last)) return;
      if (r.item.style.preservesWhiteSpace) { trailingWhitespace = Preserved; return; }
      if (!r.shapeResult) return;
      position -= r.inlineSize;
      if (r.end - 1 > r.start) {
        r.end--;
        r.shapeResult = truncateLineEndResult(r, r.end);
        r.inlineSize = luCeil(r.shapeResult.width);            // no ClampNegativeToZero
      } else { r.end = r.start; r.shapeResult = null; r.inlineSize = 0; }
      position += r.inlineSize;
      trailingWhitespace = Collapsed; return;
    }
    if (r.item.type == Control) {
      if (r.item is forced line break) continue;
      trailingWhitespace = Preserved; return;
    }
    return;
  }
}
function truncateLineEndResult(r, end) {
  if (!needsAccurateEndPosition(lineInfo, r.item)) return view(r.shapeResult, r.start, end);
  const lastSafe = r.shapeResult.previousSafeToBreakOffset(end);
  if (lastSafe == end || lastSafe <= r.start) return view(r.shapeResult, r.start, end);
  return view([r.shapeResult r.start..lastSafe], [reshape(max(lastSafe, r.start), end) whole]);
}
```

This runs after the line is decided (fact 6). An item `"foo "` that fitted with its space keeps `position_` including the space while later items are tried; the space is removed only at the end.

---

## 9. Overflow: rewinding and redoing a line

### 9.1 HandleOverflow [V]

`line_breaker.cc:4076-4305`:

```ts
function handleOverflow() {
  const availFit = availableWidth + 1;
  const hyphenBefore = hyphenIndex;
  if (hasHyphen()) position -= removeHyphen();
  let widthToRewind = position - availFit;
  let breakBefore = 0;
  let hasBreakAnywhere = breakAnywhereIfOverflow;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    hasBreakAnywhere ||= r.breakAnywhereIfOverflow;
    if (i < results.length - 1 && r.canBreakAfter) {
      if (widthToRewind <= 0) { position = availFit + widthToRewind; return rewindOverflow(i + 1); }
      breakBefore = i + 1;                       // ends as the EARLIEST opportunity on the line
    }
    widthToRewind -= r.inlineSize;
    if (widthToRewind > 0) continue;
    if (r.item.type == Text) {
      if (r.length == 0) continue;
      if (widthToRewind < 0 && r.mayBreakInside) {
        const itemAvail = -widthToRewind;
        const minAvail = r.inlineSize - ONE_PX;              // one whole layout px, not 1 raw
        if (minAvail <= 0) {
          if (breakTextAtPreviousBreakOpportunity(i)) return rewindOverflow(i + 1);
          continue;
        }
        const saved = copy(r), savedStyle = currentStyle;
        setCurrentStyle(r.item.style);
        breakText(r, r.item, r.item.shapeResult, min(itemAvail, minAvail), itemAvail);
        if (r.canBreakAfter && r.inlineSize <= itemAvail && r.end < saved.end) {
          if (i + 1 == results.length) {
            position = availFit + widthToRewind + r.inlineSize;
            current = r.endIndex();
            return handleTrailingSpaces(r.item, r.item.shapeResult);
          }
          state = Trailing; return rewind(i + 1);
        }
        if (hasHyphen()) removeHyphen();
        results[i] = saved; setCurrentStyle(savedStyle);
      }
    }
  }
  // (text-indent rewind with leading floats: out of scope, 4226-4247)
  if (breakType == Phrase && !disablePhrase) { disablePhrase = true; return retryAfterOverflow(); }   // word-break: auto-phrase
  if (!overrideBreakAnywhere && hasBreakAnywhere) { overrideBreakAnywhere = true; return retryAfterOverflow(); }
  lineInfo.hasOverflow = true;
  if (hyphenBefore != null && hyphenBefore < results.length) position += addHyphen(hyphenBefore);
  if (breakBefore) return rewindOverflow(breakBefore);
  if (lastResult().canBreakAfter) { state = Trailing; return; }
  state = Overflow;                              // break at the first opportunity that comes
}
```

`BreakTextAtPreviousBreakOpportunity(i)` (`line_breaker.cc:1797-1829`): `b = iter.PreviousBreakOpportunity(r.end − 1, r.start)`; if `b > r.start`, truncate to `view(item.shapeResult, r.start, b)` (no reshape), `inlineSize = max(0, luCeil(width))`, `can_break_after = true`.

### 9.2 RewindOverflow, Rewind, RetryAfterOverflow [V]

`line_breaker.cc:4307-4497`:

```ts
function rewindOverflow(newEnd) {         // keep trailable items after newEnd, cut before the first non-trailable
  let openTags = 0;
  for (let index = newEnd; index < results.length; index++) {
    const r = results[index], item = r.item;
    if (item.type == Text) {
      if (r.length == 0) continue;
      if (r.shapeResult || (breakAnywhereIfOverflow && !overrideBreakAnywhere)) {
        if (item.style.wraps && !item.style.breakSpaces && isSpaceLB(text[r.start])) {
          if (r.shapeResult && allSpacesLB(text, r.start + 1, r.end)) continue;
          state = Trailing; return rewind(index);
        }
      }
    } else if (item.type == Control) {
      if (item.style.wraps && !item.style.breakSpaces) continue;
    } else if (item.type == OpenTag) { if (!openTags) newEnd = index; openTags++; continue; }
    else if (item.type == CloseTag) { if (openTags) openTags--; continue; }
    else if (isTrailableItemType(item.type)) continue;
    if (openTags) index = newEnd;
    state = Done; return rewind(index);
  }
  if (openTags) { state = Done; return rewind(newEnd); }
  trailingWhitespace = Unknown; position = computeWidth(); state = Done;
  if (atEnd()) lineInfo.isLastLine = true;
}
function rewind(newEnd) {
  if (newEnd) {
    moveToNextOf(results[newEnd - 1]);   // its (possibly truncated) end
    trailingWhitespace = Unknown;
    while (!atEnd() && items[current.itemIndex] is empty Text) handleEmptyText(items[current.itemIndex]);
  } else { current = lineInfo.start; trailingWhitespace = Leading; }
  setCurrentStyle(computeCurrentStyle(newEnd));
  results.length = newEnd;              // also drops any empty items appended just above
  trailingCollapsibleSpace = null;
  if (hyphenIndex != null && hyphenIndex >= newEnd) hyphenIndex = null;
  if (hyphenIndex == null && hasAnyHyphens) restoreLastHyphen();   // hyphen on the last text/atomic result
  position = computeWidth();            // text-indent + Σ inline sizes
}
function retryAfterOverflow() {           // redo the whole line from its start
  state = Continue;
  if (results.length) { setCurrentStyleForce(computeCurrentStyle(0)); rewind(0); }
  else setCurrentStyleForce(currentStyle);
  lastRewind = null;
}
```

`isTrailableItemType` excludes atomic inlines, out-of-flow, initial letter, list markers and ruby column opens (`line_breaker.cc:226-231`). `computeCurrentStyle(i)`: the style of result i if text or close tag; otherwise walk back to a text or open tag (its style) or a close tag (its parent's style); else the break token's style or the line style (`line_breaker.cc:4502-4533`).

### 9.3 Structure (fact 4)

- The line is filled item by item; an item is split only when `BreakText` finds an opportunity inside it that fits.
- When the line overflows, Blink walks back over item results and re-breaks an earlier text item with a narrower width.
- With `overflow-wrap: break-word | anywhere` or `word-break: break-word`, the first pass never splits a word. If no opportunity fits, the **whole line is rewound to its start** and broken again with grapheme-cluster opportunities (`override_break_anywhere_` → `LineBreakType::kBreakCharacter`, `line_breaker.cc:4617-4625`).
- Without an emergency break, the line ends at the earliest opportunity and overflows.

---

## 10. word-break, overflow-wrap, line-break, hyphens

`SetCurrentStyleForce` (`line_breaker.cc:4557-4643`), only when the style wraps:

| Style | Iterator break type | `break_anywhere_if_overflow_` |
|---|---|---|
| `line-break: anywhere` | `kBreakCharacter`, strictness default | false |
| `word-break: normal` | `kNormal` | from `overflow-wrap` |
| `word-break: break-all` | `kBreakAll` | from `overflow-wrap` |
| `word-break: keep-all` | `kKeepAll` | from `overflow-wrap` |
| `word-break: break-word` | `kNormal` | true (unless line-clamp ellipsis) |
| `word-break: auto-phrase` | `kPhrase` (hyphens forced none), `kNormal` after the phrase retry | from `overflow-wrap` |
| `overflow-wrap: anywhere` | (unchanged) | true |
| `overflow-wrap: break-word` | (unchanged) | true in content layout, false for min-content |

- Strictness: `line-break: auto | after-white-space | anywhere` → default; `normal`, `strict`, `loose` → those (`line_breaker.cc:57-71`).
- If `break_anywhere_if_overflow_` and `override_break_anywhere_` (after a retry) → `kBreakCharacter` (`line_breaker.cc:4617-4625`).
- `hyphens: none` → soft hyphens disabled in the iterator and no hyphenation; otherwise soft hyphens enabled and `hyphenation_ = style.GetHyphenationWithLimits()` (`line_breaker.cc:4628-4634`). **[I]** For `hyphens: manual` that returns null, so only U+00AD opportunities exist.
- `kBreakCharacter` uses the character break iterator from the line start (`text_break_iterator.cc:419-430`).

---

## 11. Soft hyphens and the hyphen width [V]

- A break after U+00AD marks the result hyphenated (`shaping_line_breaker.cc:211-225`), including the whole-item fast path when the item ends with U+00AD (`:283-296`).
- `AddHyphen` shapes the hyphen once per item result and adds `hyphen.InlineSize()` to the result's `inline_size`, not to `position_` (`line_breaker.cc:728-765`). `RemoveHyphen` subtracts it (`:767-780`). The caller adjusts `position_`.
- Hyphen string: the style's `hyphenate-character` if set, else U+2010 if the **primary font** has a glyph for it, else U+002D (`B/core/style/computed_style.cc:1804-1820`).
- The hyphen is shaped alone with `HarfBuzzShaper(text).Shape(font, direction)`: **no letter or word spacing** (`B/core/layout/inline/hyphen_result.cc:12-16`). Width = `SnappedWidth().ClampNegativeToZero()` = ceil64 of its float width (`B/core/layout/inline/hyphen_result.h:30-32`).
- Retry: if the text before the soft hyphen fits but the hyphen does not, shrink `available_width` by the hyphen width and run `ShapeLine` again (§5.2).
- The hyphen is removed again when more text is added to the same line (`line_breaker.cc:1374-1376`), when the paragraph ends (`:1035-1037`), before an atomic inline (`:3089-3091`), and on a forced break (`:2933-2935`); rewinds restore it (`:784-799, 4487-4492`). `FinalizeHyphen` sets `is_hyphenated` on the kept one (`:801-807`).
- Placement: the text fragment is `inline_size − hyphen` wide and the hyphen is a separate fragment (`B/core/layout/inline/logical_line_builder.cc:245-252`).

---

## 12. Tabs [V]

- A tab run is a `kControl` item. `HandleControlItem` builds `ShapeResult::CreateForTabulationCharacters(font, direction, tab-size, position_ + floatOffset + tab_stop_offset_, start, length)` at the moment the item is reached, then runs `HandleText` on it (`line_breaker.cc:2955-2976`). **Its width depends on where it lands on the line** (fact 6).
- `font` = `node_.FontForTab()`, the IFC block's font (`TabSizeAncestor`, stable; `B/core/layout/inline/inline_node.cc:2395-2403`); the font data is `PrimaryFontForTabSize()` (`FontFallbackForTabSize`, stable; `B/platform/fonts/font.h:251-254`).
- Advances (`shape_result.cc:1898-1944`): the first tab gets `TextRunLayoutUnit::FromFloatRound(TabWidth(font_data, tab_size, position))`; later tabs in the run get `FromFloatRound(TabWidth(font_data, tab_size))`. Every glyph is the space glyph and safe to break.
- `TabWidth` (`B/platform/fonts/font.cc:303-340`; `font.h:260-264`):
  - `base = tab-size × (spaceWidth + letterSpacing + wordSpacing)` for a number, or the length for a length (`TabSizeWithSpacing`, stable; `B/platform/text/tab_size.h:24-33`). `spaceWidth` is the font's space glyph advance (`B/platform/fonts/simple_font_data.cc:238-240`).
  - `base == 0` → letter spacing.
  - `d = base − fmodf(position, base)` (float, negative fmod wrapped); if `d < spaceWidth / 2`, `d += base`.
- `position` is `position_` (LU, includes text-indent) converted to float, plus the float offset under `TabAlignmentWithFloats` (stable).
- Tabs break shaping (§3.2) and are breakable spaces for `ShapeLine` and trailing-space handling.

---

## 13. Letter spacing, word spacing, text-transform

- Letter spacing is part of every cluster's advance, **including the last cluster on a line**; nothing trims it at line ends (no letter-spacing code in `B/core/layout/inline/line_breaker.cc` other than the DCHECK at 4547-4550).
- Reshaped pieces get the current style's spacing (`line_breaker.cc:2060-2062`). Shaping groups get the start item's spacing (§3.2). **[I]** If two same-font spans had different letter spacing they would have different font descriptions, so they would not share a group.
- The hyphen gets no spacing (§11). Tab width includes spacing (§12).
- `text-transform` changes text_content (§3.1); its effect on measurement is only through the transformed string.

---

## 14. Direction and bidi

- Items are split at bidi level boundaries and shaped per direction; direction changes break shaping (§3.1, §3.2) (fact 7).
- The line breaker works in logical order. `ShapeLine` flips signs for RTL; positions for RTL results are left edges of the logically next cluster (§1.4).
- Base direction per paragraph comes from the block, or with `unicode-bidi: plaintext` from the first strong character after each forced break (`line_breaker.cc:636-672`).
- `SplitTrailingBidiPreservedSpace` (`line_breaker.cc:2749-2853`), only if the node has bidi and trailing white space is Collapsed or Preserved: walking back, results that are only spaces are marked `has_only_bidi_trailing_spaces`; a result ending in spaces or WS-class characters whose level differs from the base level is split into text `[start, i)` with `inline_size = luCeil(view width)` and a spaces result with `inline_size = previous − new` (total unchanged).
- Reordering happens after the line is decided (`logical_line_builder.cc:182-189`); it does not change the width.

---

## 15. lang

- Break iterator locale per wrapping style (§7).
- HarfBuzz language from the font description's locale: `CaseMappingHarfBuzzBufferFiller(..., font_description.LocaleOrDefault(), ...)` and the `language` passed to `ShapeRange` (`harfbuzz_shaper.cc:1005-1007, 1032-1036`).
- `-webkit-locale` from `lang` and the root from `Content-Language` belong to the break-data spec (groundwork §1.5).

---

## 16. Defaults and text-wrap at 153 [V]

- `text-wrap-style` initial `auto` (`css_properties.json5:8201-8207`); `text-wrap-mode` initial `wrap` (`:8187-8193`).
- `LineBreakStrategy` uses the score breaker for `pretty` and the score or bisection breaker for `balance`; every other value takes the greedy path above (`inline_layout_algorithm.cc:59-84`). **`pretty` and `balance` are not defaults**; `auto` and `stable` are greedy.
- `text-spacing-trim` initial `TextSpacingTrim::kInitial` = `kNormal` (`css_properties.json5:6529-6537`; `B/platform/fonts/shaping/text_spacing_trim.h:12-19`): trims adjacent punctuation and line ends (`ShouldTrimEnd`), not wrapped line starts nor paragraph starts (`text_spacing_trim.h:23-38`).
- `text-autospace` initial `no-autospace` (`css_properties.json5:6241-6247`).
- `hyphens` initial `manual` (`:4012-4018`); `overflow-wrap` `normal` (`:4907-4913`); `line-break` `auto` (`:7557-7562`); `tab-size` `8` (`:6168-6175`); `letter-spacing` `Length::Fixed()` (0) (`:4197-4205`).

---

## 17. What a line's reported width is [V]

- `LineInfo::SetWidth(available, position_ + cloned end size + ellipsis)` after trailing collapsible spaces were removed (`line_breaker.cc:975-989, 1149-1161`; `B/core/layout/inline/line_info.h:190-193`).
- `LineInfo::Width()` includes hanging preserved trailing spaces; negative values clamp to 0 (`line_info.h:151-167`). `HangWidth` (`line_info.cc:275-416`) is used only for alignment.
- Each text fragment's rect width is its result's `inline_size` (or `inline_size − hyphen`, plus a hyphen fragment) (`logical_line_builder.cc:245-266`).
- All in LU of zoomed px. **[I]** DOM geometry APIs report CSS px = LU / 64 / zoom; at DPR 2 fragment widths are multiples of 1/128 CSS px.

---

## 18. Runtime flags at 153 that change results [V]

`B/platform/runtime_enabled_features.json5`:

| Flag | Status | Effect |
|---|---|---|
| `LineBreakerHanKerningEnd` | stable (3865-3866) | ShapeLine returns the han-kerning-trimmed end at the item end (§6 step 4) |
| `LineBreakAfterSpaceBeforeOpenTag` | stable (3861-3862) | no break after a close tag when a space follows and an open tag comes next (§7) |
| `IgnoreLetterSpacingInCursiveScripts` | stable (3593-3594) | no letter spacing inside Arabic, Syriac, NKo... except on spaces |
| `WordSpacingWhiteSpacePre` | stable (7360-7361) | word spacing at text_content index 0 when the block preserves spaces |
| `TabSizeWithSpacing` | stable (6172-6173) | tab stop includes letter and word spacing |
| `TabSizeAncestor` | stable (6164-6165) | tab stops use the block's font |
| `FontFallbackForTabSize` | stable (3208-3209) | tab font data from `PrimaryFontForTabSize` |
| `TabAlignmentWithFloats` | stable (6133-6134) | tab position includes the float offset |
| `TabSizeInRubyBase` | stable (6168-6169) | ruby only |
| `TextSpacingTrimFallback`, `TextSpacingTrimFallbackChws` | stable (6326-6328, 6337-6340) | han kerning with fallback fonts |
| `TextSpacingTrimFallback2` | test (6331-6333) | off |
| `BoxDecorationBreakCloneLineBreaking` | test (946-947) | off: cloned decoration end size not subtracted |
| `CSSLineClampLineBreakingEllipsis` | experimental (1746-1748) | off |
| `HarfRustShaping` | no status (3434-3435) | off: HarfBuzz C++ shaper |
| `CSSTextSpacing` | test (2058-2059) | off |
| `SkipOofItemForBreakCandidate`, `ScoreLineBreakerAbort` | stable | score breaker only (not default) |

---

## 19. The ten expensive facts, as Blink produces them

1. **Styled runs.** One break iterator over text_content; item-end opportunities come from `IsBreakable(end)` on the joined text and are moved across tags by fixed rules (§7). Shaping joins same-font runs (§3.2).
2. **Engine break data.** The line loop consumes the iterator's answers with the current style's locale, strictness and break type (§7, §10). Data: other spec.
3. **White space and controls.** Collapsed spaces skipped at line ends without width (§8.2); trailing collapsible space removed after the line is decided (§8.3); preserved spaces hang; break-spaces don't hang; CR/FF are zero-width control items that break shaping; VT is text; tabs position-dependent (§3.1, §12).
4. **Line filling structure.** Item-by-item greedy fill; walk back and re-break earlier text with `inline_size − 1px`; whole-line redo in grapheme mode for emergency breaks (§9).
5. **Units.** 16.16 advances; float32 run and piece sums; ceil to 1/64 zoomed px per item; LU sums; fit `<= avail + 1 raw` (§1).
6. **Widths known late.** Wrapped-line start reshape, non-space line-end reshape (or any end with `needsAccurateEndPosition`), tab advances, hyphen additions, trailing-space removal (§6, §8.3, §11, §12).
7. **Direction, language, DPR.** Items split at bidi levels and shaped per direction; locale per style; zoom scales fonts and lengths and the 1/64 grid (§2, §14, §15).
8. **Next line start.** Only `{itemIndex, textOffset}`, the style and the forced-break flag (§4.1).
9. **Canvas ≠ DOM.** §20.
10. **Probes.** §21.

---

## 20. What Canvas can supply

Canvas `measureText` in Chrome (`B/core/html/canvas/text_metrics.cc:95-112, 172-225`; `B/platform/fonts/plain_text_node.cc`; `B/platform/fonts/plain_text_painter.cc:251, 260`):

- The string is normalized for canvas: TAB, LF, VT, FF, CR → U+0020 (`plain_text_node.cc:47-50`; `character.h:226-237`); other `TreatAsSpace` characters except NBSP → U+0020; `TreatAsZeroWidthSpaceInComplexScriptLegacy` characters (SHY, ZWSP, LRM/RLM, embedding controls...) → U+200B (`plain_text_node.cc:51-60`; `character.h:167-171`).
- If `font.CanShapeWordByWord()` (true whenever no typesetting features are set, which is the canvas default), the text is cut into words: space and TAB (and ZWSP in 16-bit text) are one-character words; 8-bit words end at space/TAB; 16-bit words also end before CJK ideographs/symbols (`plain_text_node.cc:84-155, 377-400`; `B/platform/fonts/font_fallback_list.cc:264-286`).
- Each word is shaped alone, spacing applied with the canvas's letter/word spacing (`plain_text_node.cc:402-425`); the width is the float32 sum of word `ShapeResult::Width()` (`text_metrics.cc:179-222`).
- Font size = specified size, no zoom (§2.5).

| Width fact the Blink loop needs | From Canvas totals? |
|---|---|
| Float32 width of a text item or shaping group `[a, b)` with no space-involving shaping, 8-bit Latin or one script, below 256 zoomed px | **Exact** at zoom 1: `measureText(text.slice(a, b))`. At zoom z: measure at `z × font-size`. [I] exactness relies on the word split not crossing a kerning/ligature pair and on the same script choice |
| Same, when the font kerns or ligates across spaces (for example Arial's GPOS covers the space glyph, groundwork) | Not with default settings (words shaped alone). `textRendering = 'optimizeLegibility'` or `fontKerning = 'normal'` shapes the whole string only for fonts whose GPOS/GSUB include the space glyph (`font_fallback_list.cc:264-277`); totals only |
| ceil64 per item, LU sums, fit comparisons | Computed in JS from the totals (§1.6) |
| Per-character positions `ceil64(prefix(k))` inside an item | Only approximately: `measureText(prefix)` shapes the prefix alone, so a pair adjustment carried by the last glyph of the prefix with the next character is missing. Exact for fonts without contextual adjustments |
| Where HarfBuzz marks unsafe-to-break | **No** |
| Width of a reshaped line start `[start, firstSafe)` or line end `[lastSafe, b)` | The substring total is exact for Latin (shaped alone in both). Which offsets are `firstSafe` / `lastSafe`: **no** |
| Contextual (kerned) advance of a word's last glyph before a space | **No** attribution; only a whole-string total with the special settings above |
| Hyphen width | **Exact**: `measureText('‐')` (or `'-'`) with `letterSpacing = '0px'`. Whether the primary font has U+2010: not directly |
| Space width for tab stops | `measureText(' ')` [I]: `SpaceWidth` is the space glyph advance; differs if HarfBuzz applies `trak` to a shaped space (groundwork §3.3) |
| Letter/word spacing | `ctx.letterSpacing` / `ctx.wordSpacing` run the same `ShapeResultSpacing`; word-spacing index-0 rule is relative to the canvas string, not text_content |
| CR/FF in DOM text | Measure without them: Canvas turns them into spaces while DOM makes them zero-width and splits shaping |
| Font per cluster, script runs | Totals include fallback fonts; run boundaries (float32 per-run sums) not visible, matters only above 256 px |
| Han kerning (`halt`) at line ends | **No** |
| Break opportunities | Not Canvas (break-data spec) |
| Zoomed-size effects (emoji bitmaps, `system-ui` optical variants) | Measure at `zoom × size`; PLATFORM_BUGS.md records the known gaps at small sizes |

The groundwork's Canvas-only run (results-canvas-only-blink.txt) got 96.3% of Chrome line counts from totals plus probes. The losses came from in-word positions and totals across spaces, not from the rules above.

---

## 21. Hypotheses to probe in installed Chrome 153

All: page zoom 100%, a `<div>` with the given `width`, `padding: 0`, `font` as given, `lang="en"` on `<html>`, observe line count by `Range.getClientRects()` per character or by height. "C64(s)" means `ceil(W × 64)` where `W = OffscreenCanvas measureText(s).width` at the stated font. Unless stated, DPR 1 means a non-Retina display (or window on one); DPR 2 means a Retina display, not emulation.

1. **Fit epsilon (DPR 1).** Font `16px Arial`, text `nnnnn nnnnn`. Width `(C64 − 1)/64` px → 1 line. Width `(C64 − 2)/64` px → 2 lines. Width `(C64 − 1)/64 + 1/128` px → 1 line (truncation to 1/64).
2. **Device grid (DPR 2).** Same text. Let `C128 = ceil(W32 × 64)` with `W32` measured at `32px Arial`. Width `(C128 − 1)/128` → 1 line; `(C128 − 2)/128` → 2 lines. Expect at least one width in `[C64/64 − 1/32, C64/64]` where DPR 1 and DPR 2 give different line counts, exactly as the formulas predict.
3. **Emulated DPR.** In DevTools device emulation or headless with `deviceScaleFactor: 2` on a DPR 1 screen, `devicePixelRatio == 2` but probe 2's thresholds equal probe 1's (layout zoom 1).
4. **Effective font size floor.** DPR 1, span `mmmmmmmmmmmmmmmmmmmm` (20 × m) with `white-space: nowrap`. `getBoundingClientRect().width` at `17.3px Arial` equals the width at `17.29px Arial` and differs from `17.31px Arial`. Canvas `measureText` at `17.3px Arial` also equals `17.29px`.
5. **Styled runs.** `width: 1px; font: 16px Arial`. `<b>foo</b>bar` → 1 line. `<b>foo </b>bar` → 2 lines. `<b>foo</b> bar` → 2 lines. `foo<span lang="ja">bar</span>` → 1 line.
6. **Line-end reshape depends on alignment.** Font `16px Arial`, text `AAAA AAAA AAAA`. Binary-search (1/64 px steps) the smallest width giving `AAAA AAAA` on line 1, once with `text-align: left` and once with `text-align: right` (and once with `text-decoration: underline`). Expected: left < right by the kerning of the (A, space) pair at 16px if Arial's GPOS has it (the right-aligned line reshapes the last `A` alone); with `16px "Courier New"` all three thresholds are equal.
7. **Hyphen retry.** Font `16px Arial`, text `cc aaaa&shy;bbbb`. Let `H = ceil64(measureText('‐'))` (or `'-'` if Arial lacks U+2010) and `A = C64("cc aaaa")/64`. Width `A + H − 1/64` → line 1 `cc aaaa‐`, line 2 `bbbb`. Width `A + H − 2/64` → lines `cc`, `aaaa‐`, `bbbb`.
8. **Hyphen has no letter spacing, text keeps trailing spacing.** Probe 7 with `letter-spacing: 3px`: thresholds computed with `ctx.letterSpacing = '3px'` for `cc aaaa` and `0px` for the hyphen still predict exactly.
9. **Trailing letter spacing counts.** `16px Arial; letter-spacing: 3px`, text `nnnn nnnn`, `C64` measured with `ctx.letterSpacing = '3px'` on `nnnn nnnn`. Width `(C64 − 1)/64` → 1 line; `(C64 − 2)/64` → 2 lines (a trimmed trailing spacing would move the threshold down by 3px).
10. **Tabs.** `white-space: pre; tab-size: 8; font: 16px "Courier New"`. Let `S = measureText(' ')`. Text `aaaaaaaa\tb`: `b`'s left offset = `ceil64(8S)/64 + d` where `d = 8S − fmod(ceil64(8S)/64, 8S)`, plus `8S` if `d < S/2` (for an exact 1/64 grid value of `8S`, `b` sits at `16S`). Text `aaaaaaa\tb`: `b` at `8S` when `8S − ceil64(7S)/64 ≥ S/2`. With `letter-spacing: 2px` the stop is `8 × (S + 2)`.
11. **pre-wrap hangs, break-spaces does not.** `16px Arial`, text `nnnn      nnnn` (6 spaces), width `C64("nnnn")/64 + 1` px. `white-space: pre-wrap` → 2 lines, and the first line's text rect is wider than the div (spaces hang). `white-space: break-spaces` → 3 lines: `nnnn ` (overflowing by one space), 5 spaces, `nnnn`.
12. **CR/FF are zero-width split points in DOM, spaces in Canvas.** `white-space: pre-wrap; font: 16px "Times New Roman"`, text `A\fV` in a span: span width = `ceil64(W('A'))/64 + ceil64(W('V'))/64` (no A–V kerning); Canvas `measureText('A\fV')` = `measureText('A V')`.
13. **Emergency break redoes the line.** `width: 60px; font: 16px Arial`, `<div>aaaaaaaaaaaaaaaa<span style="overflow-wrap:anywhere">bbbbbbbb</span></div>` → line 1 is `aaaaaaaaaaaaaaaab` (the unbreakable prefix plus exactly one `b`), then the rest of the b's by grapheme fill.
14. **Soft hyphen at an item end is dropped when text follows.** `16px Arial`, wide div, `aaaa&shy;<span>bbbb</span>` → 1 line, no hyphen drawn; the line width equals `ceil64(W("aaaa­"))` + `ceil64(W("bbbb"))` in 1/64 steps.
15. **Han kerning trim at line end (default text-spacing-trim).** `16px "Hiragino Sans"`, text `あああ」いいい`. Let `F = C64("あああ」")/64` (Canvas shapes each CJK character alone, so this is the untrimmed width). Width `F − 4` px (the bracket is a full-width em of 16px, and `halt` should remove about half of it) → line 1 is `あああ」`, because ShapeLine reshapes the bracket with `halt` at the line end and it fits. Width `F − 9` px → line 1 no longer ends with `」` (exact content depends on break data for U+300D, which cannot start a line). The same probe in a font without `halt` (for example `16px "Courier New"` with a fallback font) keeps `」` off line 1 at `F − 4` px.
16. **Re-break after a 1-raw position/width mismatch.** DPR 1, `font: 16px "Times New Roman"`, text `nnn nnnn nnnn nnnn` in a width where line 2 starts at `nnnn` inside the same item. Compute with the §6 pseudo-code over Canvas prefix widths (`measureText` of each prefix). Expected: wherever `ceil64(P(b)) − ceil64(P(start))` fits but `ceil64(P(b) − P(start))` is 1 raw too wide, Chrome ends line 2 one opportunity earlier than a position-only model. A width scan in 1/64 px steps over the line-2 threshold should show such a width if the prefix sums have fractional 1/64 parts.

---

## 22. Differences from the groundwork (pretext-emulation-20260915/research/blink-source.md, NOTES.md) that I verified

1. **Pinned files.** The groundwork read 152.0.7977.83. At 153 the relied-on line-breaking files are unchanged except `shaping_line_breaker.cc` 370-375 (`LineBreakerHanKerningEnd`, stable), so the groundwork's `shaping_line_breaker.cc` citations after 369 are 6 lines lower than 153's.
2. **"inline_size − 1".** The groundwork wrote `min(item_available, inline_size - 1)` without a unit. The `1` is an `int`, converted to one whole layout px (64 raw) by `operator-(LayoutUnit, integral)` (`layout_unit.h:684-686`). Likewise the no-result overflow width is `available + 1px` (`line_breaker.cc:1692`).
3. **Fit decision vs `is_overflow`.** Verified that `BreakText` decides with `inline_size <= available_width_with_hyphens`, ignoring ShapeLine's `is_overflow` (TODO crbug 1003742), and that positions (ceil of prefix) and widths (ceil of difference) can disagree by 1 raw when a line starts inside an item; the overflow walk then re-breaks the item.
4. **Canvas CR/FF.** The groundwork (§4.3) said Canvas turns CR and FF into ZWSP. At 153 the canvas painter passes `is_canvas = true` (`plain_text_painter.cc:251, 260`), and TAB, LF, VT, FF and CR are turned into U+0020 first (`plain_text_node.cc:47-50`; `character.h:226-237`); only the remaining zero-width-like characters (SHY, ZWSP, bidi marks) become ZWSP.
5. **Effective font size.** The groundwork gave `floor(computed×100)/100`. The multiplication is float32, so sizes like 17.3px become 17.29px even at zoom 1 (`font_description.cc:279-281`), and that size is what the platform font uses (`font_platform_data_cache.cc:60-61`).
6. **Tabs.** The groundwork used the tab item's style font and a stop of `tab-size × space`. At 153 the font is the block's font (`TabSizeAncestor`), font data from `PrimaryFontForTabSize` (`FontFallbackForTabSize`), the stop includes letter and word spacing (`TabSizeWithSpacing`), and the position includes the float offset (`TabAlignmentWithFloats`); all stable.
7. **Word spacing at index 0.** Verified the groundwork's rule and added that `allow_word_spacing_anywhere` is also true for blocks that preserve white space (`WordSpacingWhiteSpacePre`, stable, `inline_node.cc:1561-1565`).
8. **Width after `EnsurePositionData`.** `ShapeResult::width_` is first the float32 sum of per-run floats and becomes the float of the exact total once position data exists (`shape_result.cc:1609, 2230`). Same value below 256 px.
9. **Space sets.** Three different "breakable space" sets are in play: line breaker U+0020/TAB (`line_breaker.cc:186-188`), shaping line breaker U+0020/TAB/LF/U+3000 (`shaping_line_breaker.cc:38-41`), iterator U+0020/TAB/LF (`text_break_iterator.h:203-205`). The groundwork listed only the iterator's.
10. **Emulated DPR explained.** The groundwork observed headless Chrome reporting DPR 2 while laying out at zoom 1. Source: `devicePixelRatio` multiplies the inspector override into `LayoutZoomFactor` (`local_frame.cc:1933-1941`; `web_view_impl.cc:2439-2447`).
11. **Monospace compaction.** 153's `CachedOffsetForPosition` / `CachedPositionForOffset` have a compacted path for 1:1 constant-advance results (`shape_result.cc:2218-2228, 2273-2298, 2334-2343`), and the compacted safe-to-break lookups treat every offset as safe. The groundwork's emulator did not model it; it is documented as bit-identical for positions.
12. **Not a difference, confirmed.** Greedy is the default (`inline_layout_algorithm.cc:59-84`), `text-spacing-trim` initial is `normal` with end trimming, `text-autospace` is off.

---

## 23. Open questions

- Whether `ShapeResultView` part widths for a part covering a whole run use the run's per-run float (yes, `shape_result_view.cc:253-255`) while `FindGlyphDataRange` sums for partial runs: above 256 px these can round differently from a single float of the total. No probe designed.
- `ComputeTrailingCollapsibleSpaceHelper` skips atomic inlines if they are opaque to collapsing (`inline_item.h:221-226` says all non-text, non-control, non-block-in-inline items are); out of scope here but worth checking before adding atomic inlines.
- `hyphens: auto` on macOS (`CFStringGetHyphenationLocationBeforeIndex`, minimum 5/2/2 per groundwork) is not covered.
- `GetHyphenationWithLimits()` returning null for `hyphens: manual` is inferred, not read.
- DOM geometry conversion from LU to CSS px (divide by zoom) was not traced.
- Probe 15's second width depends on break data for U+300D (no break before a closing bracket), which this spec does not cover.
