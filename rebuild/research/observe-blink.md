# Blink observation model: Range geometry in Chrome 153

Scope: what `Range.getClientRects()` returns in Chrome 153.0.8010.48 for the lab's two kinds of range: one code point (page.ts:188-200) and a whole text node (`selectNodeContents`, page.ts:202-210). The input is Blink's line boxes and fragment items, as the rebuild's Blink engine models them. This is the Blink part of charter tentpole 2.

Citations:
- `C153/` is `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/`. I added `core/dom`, `core/editing` and `core/layout` to that sparse checkout, add only.
- `C152/` is the same tree at `chromium-152/src`, used only for a file 153's checkout lacks.
- `HB152/` is `~/github/browser-engines/chromium-152/src/third_party/harfbuzz/src/src/`. 153's HarfBuzz roll isn't checked out (blink-shortcut-audit §7).
- `[I]` marks a statement inferred, not read line by line.

Evidence: an offline census of existing Chrome rows, `.artifacts/lab/final-20260916/chrome/*-forward/chrome-rows.ndjson`, all at DPR 2. Three groups:
- small sets: development smoke, ws, policy and runs, plus held-out ws, policy and runs (10,709 rows);
- development suite sample (19,994 rows);
- held-out suite sample (9,978 rows; 22 corpus rows over 20,000 code points were skipped).

Scripts and outputs are in `.artifacts/research-20260916/tentpoles/blink-observation/`. No browser ran, and `rebuild/src` and the lab weren't touched.

Units used in examples: "raw" is a LayoutUnit (LU), 1/64 of a zoomed px. At zoom 2 a rect value in CSS px times 128 is raw. Examples write rects as `[x+width @y]`, with x and width in raw and y in CSS px.

## 1. Short answer

- **One function produces every rect.** A Range rect in Chrome is one fragment item's rect, or a slice of it. `LayoutText::AbsoluteQuadsForRange` walks the text node's fragment items: lines in order, and within a line in visual order. For each item the range overlaps or touches, it takes `FragmentItem::LocalRect(start, end)`, moves it by the item's offset and divides by the layout zoom.
- **Edges round outward.** A slice's edges are the item's float caret positions, floored at the start and ceiled at the end to LayoutUnits. A whole item uses its own size instead, which is the ceiling of its float width. So two adjacent code points overlap by one LayoutUnit wherever the caret position between them isn't on the 1/64 grid: 609,708 of 991,521 adjacent left-to-right pairs in the rows.
- **Glyph runs share rects.** A glyph run here is one HarfBuzz cluster: consecutive glyphs sharing one character index. Every code point inside a glyph run gets the whole run's rect. When the run covers several graphemes, its advance is split into equal shares instead.
- **Characters no item holds get only boundary rects.** Characters with no advance get zero-width rects at the floor of their caret position. Characters that no fragment item holds get only zero-width rects at the edges of the items they touch. That covers collapsed white space, spaces removed at a line end, spaces skipped at a line start, and CR and FF in the preserving modes.
- **The hyphen hangs on one flag.** A chosen soft hyphen draws a separate generated hyphen item. A range includes that item only if the item visited just before it, in the same text node, ended inside the range. That flag explains Chrome's duplicate hyphen box, the zero-width soft hyphen in right-to-left runs, and the case VALIDATION.md recorded as a U+2028 copy.
- **The lab can predict rects exactly.** It can compute all of these rects from engine-true fragments that carry caret positions, and compare them exactly, without the scorer's visibility rules.
- **Some facts are unobservable by rule**, and the same code says which (§9): positions finer than a LayoutUnit; how a glyph run's advance divides among its code points; which line a zero-advance or uncovered code point belongs to, when both answers give the same rects; and the hyphen of an odd-level item that comes first in its node, in a right-to-left paragraph.

## 2. The call chain

| Step | Source | What it does |
|---|---|---|
| `Range::getClientRects` | `C153/core/dom/range.cc:1681-1693` | Updates style and layout, collects quads, returns `DOMRectList(quads)`. |
| `Range::GetBorderAndTextQuads` | `range.cc:1718-1808` | For a range inside one text node there is no element quad. The text branch (1757-1776) calls `ComputeTextQuads`. A node without a `LayoutText` contributes nothing (1760-1762). DOM offsets pass through unmapped (TODO at 1764-1766), so `text-transform` shifts them. |
| `ComputeTextQuads` | `range.cc:1705-1715` | `AbsoluteQuadsForRange`, then `AdjustQuadsForScrollAndAbsoluteZoom`. |
| `LayoutText::AbsoluteQuadsForRange` | `C153/core/layout/layout_text.cc:556-648` | The walk in §4.6. |
| `LayoutText::MapDOMOffsetToTextContentOffset` | `layout_text.cc:511-554`; `C153/core/layout/inline/offset_mapping.cc:278-299, 405-459` | Maps DOM offsets to text_content offsets, skipping collapsed units (§4.5). |
| `InlineCursor::CurrentLocalRect` → `FragmentItem::LocalRect` | `inline/inline_cursor.cc:510-518`; `inline/fragment_item.cc:1201-1235` | The whole item gives its size; a slice goes through `LineLeftAndRightForOffsets` (`:1132-1199`). |
| `ShapeResult::CaretPositionForOffset` | `C153/platform/fonts/shaping/shape_result.cc:735-741, 696-733, 166-349` | Float caret positions, with equal shares inside a glyph run. |
| `LayoutUnit::FromFloatEncompassRound` | `C153/platform/geometry/layout_unit.h:164-184` | Floors the start and ceils the end. |
| `Document::AdjustQuadsForScrollAndAbsoluteZoom` | `C153/core/dom/document.cc:8901-8909`; `core/layout/adjust_for_absolute_zoom.h:42-49, 109-115` | Scales by `1 / LayoutZoomFactor`, a float32. |
| `DOMRectList` | `C152/core/geometry/dom_rect_list.cc:33-36` | One `DOMRect::FromRectF(quad.BoundingBox())` per quad, zero-width quads included. |

Not on this path:
- **Selection rects.** `InlineCursor::CurrentLocalSelectionRectForText` (`inline_cursor.cc:520-546`) stretches rects to the line height, gives a line break a space's width and extends soft line breaks.
- **Caret rects.** `CaretInlinePositionForOffset` (`fragment_item.cc:1099-1130`) rounds to nearest (`FromFloatRound`), not outward. The lab calls neither.
- **`Range::getBoundingClientRect`** unions the same quads (`range.cc:1810-1833`).

## 3. What the engine output has to carry

The rebuild's `Line` and `Fragment` types (`src/model.ts:76-111`) carry CSS px widths per fragment. Observation needs each line's Blink fragment items with their LayoutUnit geometry and caret positions, plus the offset mapping.

```ts
type BlinkObservedLayout = {
  layoutZoom: number
  runs: Array<{
    hasLayoutText: boolean            // Text::TextLayoutObjectIsNeeded (specs/blink-text.md §2.A)
    // OffsetMapping units in DOM order. A collapsed unit has tcStart === tcEnd (offset_mapping_builder.cc:95-117).
    units: Array<{ collapsed: boolean; domStart: number; domEnd: number; tcStart: number; tcEnd: number }>
  }>
  lines: Array<{ items: ObservedItem[] }>   // items in visual order (logical_line_builder.cc:688-760)
}
type ObservedItem = {
  run: number                         // the LayoutText
  kind: 'text' | 'tab' | 'forced-break' | 'hyphen'
  start: number; end: number          // text_content offsets; a hyphen has neither
  rtl: boolean                        // the item's direction, the parity of its bidi level
  x: number                           // raw LU from the content box's left edge (§4.2)
  inlineSize: number                  // raw LU: InlineItemResult::inline_size (hyphenated text: minus the hyphen)
  top: number; height: number         // raw LU (§4.8)
  caret: ((offset: number, adjust: 'start' | 'end') => number) | null  // float32 zoomed px (§4.3); null for a forced break
}
```

How today's fragment kinds map onto Blink's fragment items:
- **`text`** is roughly one item result. `lineOutput` merges source units by run, level and result (`src/engines/blink/index.ts:251-266`) and cuts the hyphen off into a `hyphen` fragment. Observation needs the item granularity, visual order and the LayoutUnit offset.
- **`hanging`** is a real text item: an item result whose only content is `pre-wrap` trailing spaces (`C153/core/layout/inline/line_breaker.cc:2426-2534`). It has a size and positive rects.
- **`trimmed`** has no item. `RemoveTrailingCollapsibleSpace` shortens or empties the item result (`line_breaker.cc:2536-2600`), but the space stays in text_content, so it isn't collapsed in the offset mapping.
- **`collapsed`** has no item. Either the offset mapping collapsed it (white space collapsed while text_content is built), or it is a leading space skipped at a line start, which is in text_content like `trimmed` (`line_breaker.cc:1337-1350`).
- **`forced-break`** is an item (`PlaceControlItem`, `logical_line_builder.cc:404-445`).
- **CR and FF in `pre`, `pre-wrap` and `break-spaces`** have no item: `HandleControlItem` sends them to `HandleEmptyText` (`line_breaker.cc:2944-2999`), and `PlaceControlItem` returns for an empty result (`logical_line_builder.cc:429-433`). They aren't collapsed in the mapping either. So for observation they behave like `trimmed`, not like `collapsed` (index.ts:196-205 marks them `collapsed`), and not like the zero-width `text` fragments REPORT §7 item 8 proposes.

Caret positions:
- The port already keeps 16.16 prefix sums per shaping group and views for reshaped edges (`src/engines/blink/shape.ts:551-615`).
- Its `positionForOffset` (shape.ts:512-519) ports the line breaker's LayoutUnit table (`CachedPositionForOffset`), not `CaretPositionForOffset`. Observation needs float positions and the boundaries of glyph runs.
- Glyph runs that come from Unicode data can be ported from HarfBuzz's rules (`HB152/hb-ot-shape.cc:466-522, 578-586`): marks, ZWJ with an Extended_Pictographic character, emoji modifiers, regional indicator pairs.
- Clusters that a font's ligatures merge aren't visible to Canvas. Their equal shares are a named gap for predicting rects.

## 4. Port-level pseudo-code

### 4.1 Units and rounding

```
raw LU           int32; 1 raw = 1/64 zoomed px
item x, size     raw LU sums (inline_box_state.cc:845-856)
caret position   16.16 fixed-point sums of glyph advances, returned as float32 (shape_result.cc:245-348)
float to LU      floor64(v) = floorf(f32(v) × 64); ceil64(v) = ceilf(f32(v) × 64)   (layout_unit.h:134-142)
reported value   f32(f32(raw / 64) × f32(1 / zoom))   (layout_unit.h:244-246; adjust_for_absolute_zoom.h:109-115)
reported width   f32(right) − f32(left) of the quad's bounding box   [I]
```

- At zoom 2 every reported value is raw / 128 exactly, while |raw| < 2^24.
- 16.16 sums are exact in float32 below 256 zoomed px. Past that, the caret position is the float32 of the 16.16 value, and that is what gets floored or ceiled.
- Example, `c-21177e1cab2c68c9`: `갈` is `[0+1551]` and the following space is `[1550+728]`. The caret position between them lies strictly between 1550 and 1551 raw, so the two rects overlap by one unit.

### 4.2 The fragment items of a line

```
function lineItems(lineInfo, paragraph):                          // logical_line_builder.cc:200-464
  items = []
  for r in lineInfo.results:                                     // logical order
    switch r.item.type:
      case text:
        if r.end == r.start: continue                            // :215-223 fully collapsed text, emptied trailing space
        if r.isHyphenated:                                       // :245-252
          push text item {start: r.start, end: r.end, inlineSize: r.inlineSize − r.hyphen.inlineSize, level: r.item.level}
          push hyphen item {run: r.item.run, inlineSize: r.hyphen.inlineSize, level: r.item.level}   // PlaceHyphen :447-464
        else push text item {inlineSize: r.inlineSize, level: r.item.level}
      case control:
        if r.item.isGeneratedForLineBreak or r.end == r.start: continue   // :419-433 (generated ZWSP; CR and FF)
        push tab or forced-break item {inlineSize: r.inlineSize}         // :441-444
      case open-tag, close-tag: nothing                          // a span without decoration is a culled inline box
  if bidi is enabled:                                            // :182-189
    levels = item levels, with results holding only trailing spaces at the base level (:688-760)
    reorder items visually (ubidi_reorderVisual over runs)
  position = paragraph.rtl ? −lineInfo.hangWidth : 0             // AdjustLineOffsetForHanging, inline_layout_algorithm.cc:303-311
  for item in items: item.x0 = position; position += item.inlineSize   // ComputeInlinePositions, inline_box_state.cc:845-856
  space = available − (lineInfo.width − hangWidth)               // WidthForAlignment, line_info.h:151-166; ApplyTextAlign :943-970
  offset = paragraph.rtl ? space : 0                             // text-align: start (length_utils.cc:1607-1640); may be negative
  for item in items: item.x = offset + item.x0                   // inline_layout_algorithm.cc:361-389, 485-491
```

- `hangWidth` comes from `LineInfo::ComputeTrailingSpaceWidth` (`line_info.cc:289-400`). On the last line or after a forced break, `pre-wrap` hangs only the part of the spaces that overflows.
- Consequence: in a left-to-right paragraph a line's items start at x = 0. In a right-to-left paragraph they end at the content box's right edge, `trunc(f32(width × zoom) × 64)`, even when the line overflows or has hanging spaces.
- Rows: 125,446 left-to-right lines start at 0 and 50,959 right-to-left lines end at the content edge. The 686 exceptions are the unobservable hyphen of §9 U3.

### 4.3 Caret positions

```
function caret(item, offset, adjust):                            // CaretPositionForOffset, shape_result.cc:696-741
  sr = the item's ShapeResultView as a ShapeResult: runs in visual order, character indices relative to the item
       (shape_result_view.cc:182-207)
  n = item.end − item.start; o = offset − item.start
  if o == n: return item.rtl ? 0 : f32(sr.width)                 // :727-730
  v = item.rtl ? n − o − 1 : o                                   // :706-711 logical to visual
  x = 0
  for run in sr.runs:
    if v < run.numCharacters:
      return x + runPosition(run, run.rtl ? run.numCharacters − v − 1 : v, adjust)   // :166-173
    v −= run.numCharacters; x += run.width
  return 0

function runPosition(run, o, adjust):                            // ShapeResultRun::XPositionForOffset, :228-349
  // A glyph run: consecutive glyphs sharing character_index, covering characters [s, e).
  S = the glyph run holding o; acc = the advances of the glyph runs to its left in visual order; adv = S.advance
  atStart = (o == S.s)
  g = graphemes(run, S.s, S.e)          // CharacterBreakIterator over the run's text: ICU char.brk for 16-bit text,
                                        // one grapheme per code unit except CR LF for 8-bit (character_break_iterator.cc:76-87, 180-198)
  if g > 1:                                                      // :310-329
    k = graphemes(run, S.s, o == run.numCharacters ? o : o + 1) − 1
    if o > 0: atStart = graphemes(run, o − 1, o + 1) != 1
    adv = adv / g                                                // 16.16 [I: integer division]
    acc += adv × (run.ltr ? k : g − k − 1)
  if !atStart and adjust == 'end': acc += run.ltr ? adv : −adv   // :331-341
  if run.rtl: acc += adv                                         // :343-346 right side
  return f32(acc)
```

- Which characters share a glyph run is HarfBuzz's cluster formation at `HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES` (`HB152/hb-buffer.h:466`):
  - marks, ZWJ with an Extended_Pictographic character after it, emoji modifiers and regional indicator pairs are continuations (`HB152/hb-ot-shape.cc:466-522`), merged into the previous cluster (`:578-586`);
  - a font's ligatures merge clusters too.
- Default-ignorable characters become a zero-advance invisible glyph with their own cluster (`HB152/hb-ot-shape.cc:824-846`). Blink sets no remove flag (no `hb_buffer_set_flags` in `C153/platform/fonts`).
- Tabs get one space glyph per tab, carrying the tab-stop advance (`shape_result.cc:1898-1938`).
- U+2028 and U+2029 map to the space glyph (`C153/platform/fonts/shaping/harfbuzz_face.cc:104-113`).

### 4.4 The rect of a range inside one item

```
function localRect(item, a, b):                                  // FragmentItem::LocalRect, fragment_item.cc:1201-1235
  if a == item.start and b == item.end: return {x: 0, width: item.inlineSize}   // :1217-1219, no rounding
  if item.caret == null:                                         // flow control without a shape result, :1165-1192
    s = (a == item.start or item.rtl) ? 0 : item.inlineSize
    e = (b == item.start or item.rtl) ? 0 : item.inlineSize
  else:
    fs = item.caret(a, 'start'); fe = item.caret(b, 'end')       // :1147-1160
    if fs < fe:   s = floor64(fs); e = ceil64(fe)                // FromFloatEncompassRound, layout_unit.h:164-184
    elif fs > fe: s = ceil64(fs);  e = floor64(fe)               // negative advances
    else:         s = e = floor64(fs)
  return {x: min(s, e), width: |e − s|}                          // :1194-1198, :1223-1226
```

### 4.5 DOM offsets to text_content offsets

```
function mapRange(run, s, e):                                    // layout_text.cc:511-554
  p = startOfNextNonCollapsed(run, s) ?? endOfLastNonCollapsed(run, s)
  if p == null: return null                                      // every unit collapsed: no rects at all
  q = endOfLastNonCollapsed(run, e)
  ts = tc(run, p)
  te = (q == null or q <= p) ? ts : tc(run, q)
  return [ts, te]

unitAt(run, o) = the last unit with domStart <= o, if its domEnd >= o      // offset_mapping.cc:278-299
startOfNextNonCollapsed(run, o):                                 // :414-435
  for u from unitAt(run, o) forward, within the run: if u.domEnd > o and !u.collapsed: return max(o, u.domStart)
endOfLastNonCollapsed(run, o):                                   // :437-459
  for u from unitAt(run, o) backward, within the run: if u.domStart < o and !u.collapsed: return min(o, u.domEnd)
tc(run, o) = unitAt(run, o).tcStart + (o − unitAt(run, o).domStart), or tcStart for a collapsed unit   // :405-412
```

A collapsed code point `[k, k+1)` maps to the empty range `[t, t]`, where t is the text_content offset of the next non-collapsed content in the same node, or of the end of the last one when nothing follows in the node.

### 4.6 Quads for a range

```
function quadsForRange(run, s, e):                               // AbsoluteQuadsForRange, layout_text.cc:556-648
  if !layout.runs[run].hasLayoutText: return []                  // range.cc:1760-1762
  r = mapRange(run, s, e); if r == null: return []
  [ts, te] = r
  out = []; boundary = []; lastEndIncluded = false               // :587-593
  for line in layout.lines, for item in line.items where item.run == run:   // cursor order: lines, then visual order
    if item.kind != 'hyphen':
      if ts > item.end or te < item.start or (item.kind == 'forced-break' and ts == te):   // :604-608
        lastEndIncluded = false; continue
      lastEndIncluded = item.end <= te                           // :609
      a = max(ts, item.start); b = min(te, item.end)
      rect = localRect(item, a, b); isBoundary = a >= b          // :610-613
    else:
      if !lastEndIncluded: continue                              // :616-621 "Include if the last end was included."
      rect = {x: 0, width: item.inlineSize}                      // the hyphen's own size
      isBoundary = false
    quad = {x: item.x + rect.x, width: rect.width, y: item.top, height: item.height}   // :635-636
    if isBoundary: boundary.push(quad) else out.push(quad)       // :638-643
  return out.length > 0 ? out : boundary                         // :645-646
```

- A zero-width quad from an item that covers the range counts as a normal quad: `a < b` even when the advance is 0.
- Boundary rects are kept only when nothing covers the range.

### 4.7 The lab's two observations

```
codePointRects(run, k, len) = quadsForRange(run, k, k + len).map(toCss)    // page.ts:191-199
nodeRects(run)              = quadsForRange(run, 0, run.text.length).map(toCss)   // page.ts:202-210
toCss(q) = { x: f32(f32(q.x / 64) × f32(1 / zoom)), width: f32(f32((q.x + q.width) / 64) × f32(1 / zoom)) − x, same for y and height }
```

The paragraph sits at (0, 0), and the page subtracts its bounding box origin (page.ts:110-112).

### 4.8 Vertical placement

```
item.height = LU(lround(ascent)) + LU(lround(descent))           // primary font of the item's style: FontMetrics::GetFontHeight,
                                                                 // font_metrics.h:53-71, 160-166; Skia rounding, font_metrics.cc:104-125
text_top    = −ascent                                            // inline_box_state.cc:110-150
halfLeading = floor64((lineHeight − item.height) / 2)            // CalculateLeadingSpace, line_utils.cc:36-45
item.top    = lineTop + lineBaseline − ascent   [I: baseline alignment across mixed fonts not ported here]
```

- Example, same font and zoom 2: 16px Arial has ascent + descent 36 zoomed px, so line height 48 gives y 15 on line 1 and 63 on line 2 (`c-2eac81c1906028f1`).
- The lab only groups rects into lines by vertical centre. An exact y needs the rounded integer metrics, which Canvas `fontBoundingBox*` doesn't give rounded the same way [I].

## 5. What each kind of content reports

Two terms:
- A code point is **covered** when a fragment item's text range holds it.
- A **boundary rect** is a zero-width quad from an item the range only touches.

1. **Glyphs inside a text item.**
   - Rect: `[floor64(caret before), ceil64(caret after)]`. The first code point of an item starts exactly at the item edge. The last one ends at `ceil64(width)`, which equals the item's size (`SnappedWidth`, `shape_result_view.h:124`).
   - Adjacent code points either touch or overlap by one unit.
   - The node rect per line is one rect per item, not a union.
2. **Glyph runs of several code points** (base + marks, emoji ZWJ sequences, flag pairs, emoji + modifier).
   - Every code point gets the run's rect: 66,375 identical adjacent pairs in the rows.
   - When the run covers g graphemes, each grapheme gets 1/g of the advance:
     - Thai `ย` ZWSP `ั` in Thonburi: ZWSP `[35945+650]`, `ั` `[36595+650]` (`c-26eedff255c8f6b5`). HarfBuzz merges the mark into the ZWSP's cluster, and ICU puts a grapheme break after the ZWSP.
     - `👍` SHY `🏽`: SHY `[2390+577]`, `🏽` `[2966+577]` (`c-0374b1379a6ff659`). The modifier merges into the SHY's cluster.
     - A ligature spanning two graphemes would split the same way [I: no row isolates one].
3. **Zero-advance code points in their own glyph run** (a soft hyphen not chosen, ZWSP, WJ, bidi controls): a zero-width rect at `floor64(caret)`.
   - Census: 640 of 674 ZWSP rects and all 132 U+2060 rects have width 0. The others share a glyph run with a mark (item 2).
   - A line whose content all has zero advance still has items, so it reports zero-width rects on its own y. That is the lab's zero-area-line rule.
4. **Collapsed white space** (collapsed units: runs of spaces collapsed while text_content is built, a bare white-space node collapsed into the previous space, the paragraph's trailing space, removed segment breaks).
   - The range maps to `[t, t]`, so the rects are boundary rects from this node's items that touch t: usually one, at the start of the node's next content.
   - A node whose content is all collapsed reports nothing. So does a node without a LayoutText.
5. **A trailing space removed at a line end** (`trimmed`). It is covered by nothing and isn't collapsed, so `[t, t+1)` touches the previous line's item at its end and the next line's item at its start:
   - two boundary rects when both items belong to the node;
   - example `c-21177e1cab2c68c9`, `를` + space: `[17629+0 @5.5]` and `[0+0 @33.5]`, while the node rect ends at 17630. The first is `floor64` of the item's end position; the item size is its `ceil64`.
   - Census: 7,515 + 14,992 + 1,938 = 24,445 spaces with exactly two zero-width rects.
6. **A leading space skipped at a line start** (`line_breaker.cc:1337-1350`): uncovered, so boundary rects as in item 5.
7. **Hanging `pre-wrap` spaces.**
   - They are a text item with their full advance, so their rects are positive and inside the node rect.
   - They count in `LineInfo::Width`, and only alignment leaves them out.
   - Their level is the base level (`SplitTrailingBidiPreservedSpace`, `line_breaker.cc:2758-2853`), so in right-to-left paragraphs they sit at the visual left and push the text start left by `hangWidth`.
8. **Tabs**: a positive rect of the tab-stop advance.
9. **A preserved LF**: a forced-break item, reporting its full item rect on the line it ends [I: inline size 0].
10. **CR and FF in `pre`, `pre-wrap` and `break-spaces`**: no item, so boundary rects at the neighbouring item edges.
    - In `normal`, `nowrap` and `pre-line`, CR collapses as a space, while FF, VT and other C0/C1 controls stay text and get glyph advances. That is the lab's 1,185 of 1,429 positive control rects.
    - What those advances are is the `control-character-width` gap, not an observation rule.
11. **Soft hyphens.**
    - **Not chosen:** item 3.
    - **Chosen:** the text item ends after the SHY, and a hyphen item H follows it logically at the same level. After reordering, H is after the text in an even-level item and before it in an odd-level item. A range includes H only when the previous item visited in this node ended inside the range (§4.6).
    - **Even level:** the SHY's range and the next code point's range `[s+1, s+2)` both touch the text item's end, so both get H's rect. The whole-node range gets it too. Census: 4,509 copies, all on the code point after the SHY.
    - **Odd level:** H comes right after the previous line's last item of the node. Call that item's end offset e. Code points `[e−1, e)` and `[e, e+1)` get H's rect; the SHY gets it only when `s == e`. The whole-node range gets H on every line except the node's first line with items.
    - **Worked example, `c-be7f6b754e4527ff`** (`ب­ب` U+001E, `pre-wrap`, `break-word`, width 8, 16px Noto Naskh Arabic, LTR block):
      - line 1 is `[ب 0+564]`;
      - line 2 is `[H 0+660][SHY 660+0]`;
      - the letter before reports `[0+564 @10.5]` and `[0+660 @58.5]`;
      - the SHY reports `[0+660 @58.5]` and `[660+0 @58.5]`.
    - Census: 1,912 copies at −1, all at narrow widths where the SHY starts its line.
    - **When no item of the node comes before H** (an odd level on the node's first line), no range includes H. The SHY's rect has zero width even though the hyphen is drawn. That is probe F3 (`ب­ب`: SHY `[5.15625+0]` at the letter's left edge, `scrollWidth` 13), and the census counts 814 + 888 + 3 such lines.
12. **Bidi runs.**
    - Items split where levels change, and each item measures caret positions in its own direction. Code point rects jump at reordering boundaries: 6,982 adjacent pairs are neither touching nor overlapping by one unit, and the sampled ones sit at such boundaries or under negative spacing.
    - Trailing spaces that end a line sit at the base level.
13. **Span edges.**
    - Every run is its own LayoutText, and its rects come only from its own items.
    - Kerning across the edge sits in the last glyph advance of the earlier item's slice. Item sizes are `ceil64` of each slice, so a line's node rects sum per-item ceilings.
    - An empty span has no text node.
14. **Negative letter or word spacing.**
    - Caret positions go backwards, and the rects still round outward. Space `[23139+304]` ends where the `t` before it ends, `[22636+807]` (`c-7a41fa9a65d50fc2`).
    - Code point rects can stick out of the item's size: 277 code point rects outside every node rect, all in sampled spacing families. `c-91bbae9a376693f3`'s emoji starts 455 raw left of its node rect.

## 6. Recorded observation quirks, explained

### 6.1 Chrome

| Quirk as recorded | Where | Explanation from source |
|---|---|---|
| A chosen hyphen's box appears a second time, as a rect of the letter after it (before it in RTL) | lab/README "Scoring", "Range geometry"; VALIDATION problem 5; score.ts:314-320 | §5 item 11. The copy lands on whatever range touches the end of the item visited just before H: the next code point at an even level; the last code point of the previous line's item and the line's first code point at an odd level. What decides is the item's level parity, not the letters. `🙂­🙂` in an RTL block copies onto the emoji before the SHY. |
| A chosen soft hyphen in an RTL run has a zero-width rect; the hyphen is drawn but not observed | ISSUES last entry; blink-RESULTS class 2; probe F3 | The odd-level H is visually before the text item, so on the node's first line no item precedes it and `lastEndIncluded` is false (§9 U3). On later lines the whole-node rect includes H. |
| "A U+2028 at a line start gets a copy of the next letter's rect", which makes derived lines overlap | VALIDATION "Partition", "Remaining caveats"; README "Scoring" | Misdiagnosed. In `c-3108bb5f49d2e36e` (U+2028 `ب­ب`, pre-wrap) the U+2028 is the previous line's own item at the base level. It and the next `ب` both get the odd-level H's rect `[0+682 @63]`, while the SHY has none. U+2028 matters only because it forms its own item. |
| Rects are exact 1/128 px at DPR 2 | README; VALIDATION pass 2 | Every edge is raw LU; the scale by `1/2` is exact in float32 (§4.1). At zoom 1.5 or 2.2 the float32 `1/zoom` is inexact (specs/blink-gaps.md §6.4). |
| Controls other than TAB, LF and CR mostly get an advance inside the node box | README; ISSUES controls note | In the collapsing modes they are text characters with glyph advances (§5 item 10). CR and FF in the preserving modes have no item and report only boundary rects. |
| A lone ZWSP, joiner or soft hyphen can make a line with only zero-width rects | README; VALIDATION problem 6 | §5 item 3; the item exists with size 0. |
| Chrome gives every code point of a cluster a copy of its rect | ISSUES VS16 resolution; VALIDATION pass 17 | `AdjustMidCluster::kToStart` and `kToEnd` (§4.3). Exception: glyph runs covering several graphemes split their advance equally. |
| A grapheme with ink has no positive rect (`a⁠́b`, `office­́office`) | VALIDATION first table | The mark is a HarfBuzz continuation merged into the WJ's or SHY's glyph run, whose advance is 0. |
| Break-all splits inside a Thai grapheme | ISSUES; VALIDATION pass 20 | A layout fact; the rects simply follow the items. |
| Range edges are the caret position rounded outward | blink-RESULTS "Changes by run"; port `paintedExtent` (index.ts:305, 387-390) | `FromFloatEncompassRound` (§4.4). The port's floor at the start and ceil at the end match. |
| A span with its own `lang` makes a taller line box | VALIDATION problem 8 | A layout fact: baseline alignment with another primary font. |

Not yet recorded in the lab docs:
- two boundary rects on a removed trailing space (§5 item 5);
- rects outside node rects under negative spacing (§5 item 14);
- two cases whose soft hyphen reports two zero-width rects, implying no item holds it, while the port places it inside line 2 (`c-16ed8328a8304ca6`: `a⁠́­b`, pre-wrap, `break-word`, width 2; `c-00272aea15923712`). Not traced; §10 P5.

### 6.2 Recorded for other engines, with Blink's behaviour

These belong to the WebKit and Gecko parts. Blink's behaviour is listed so the models don't borrow each other's rules.

| Quirk | Engine | Blink 153 |
|---|---|---|
| Code point edges inside a box snap outward to whole px; the right edge at a box end is floored to 1/64 | Safari | Partial edges are `floor64` or `ceil64` of the caret position, never whole px; whole items are exact. |
| Box right edge is the float32 sum x + width | Safari | Edges are raw LU; widths are exact at zoom 2. |
| Controls take the font's `.notdef` advance | Safari | Shaped as text in the collapsing modes; no item for CR and FF in the preserving modes. |
| The collapsed space after `</span>` reports a zero-width rect on the next line | Safari | A collapsed space maps to the next non-collapsed content of its own node (§4.5). The boundary rect sits where that content is, which is the next line when it wraps [I: not counted]. |
| A cluster's advance is split between a letter and a following ZWSP | Safari | A letter and a following ZWSP are separate glyph runs; only runs covering several graphemes split (ZWSP + Thai mark). |
| Offsets address transformed text under `text-transform` | Safari | The same TODO in Blink (`range.cc:1764-1766`); the lab sets `none`. |
| An emoji + VS16 cluster's advance sits on the VS16; a letter + ZWNJ or ZWJ puts it on the joiner; a precomposed base can be zero-width | Firefox | Every code point of the glyph run copies the run's rect. |
| VT and FF zero-width with the space before kept; 1px controls; rect values one or two float32 steps off 1/60 | Firefox | Not applicable. |
| U+3000 + VS16 carries the advance on the VS16 | Firefox | VS16 is a continuation and gets the copied run rect [I]. |

## 7. Evidence from the rows

| Fact | Small sets (10,709 rows) | Dev suite (19,994) | Held-out suite (9,978) |
|---|---|---|---|
| Adjacent LTR pairs overlapping by 1 unit / touching | 201,730 / 115,916 | 343,748 / 201,303 | 64,230 / 64,594 |
| Adjacent RTL pairs overlapping by 1 / touching | 42,850 / 9,378 | 110,829 / 26,073 | 53,392 / 2,529 |
| Identical adjacent rects (cluster copies) | 22,302 | 40,256 | 3,817 |
| Other adjacent pairs (bidi jumps, negative spacing in samples) | 1,475 | 4,755 | 752 |
| Hyphen copies at +1 / −1 (no other offset occurs) | 41 / 3 | 2,534 / 1,029 | 1,934 / 880 |
| RTL-letter SHY with a zero-width rect at a line end (hyphen unobservable) | 3 | 814 | 888 |
| Spaces with exactly two zero-width rects | 7,515 | 14,992 | 1,938 |
| Code point rects outside every node rect of their run (negative spacing in samples) | 138 of 459,033 | 81 of 796,823 | 58 of 229,531 |

Line checks (`lines.ts`):
- LTR lines whose node rect union starts at x = 0: 41,513 small + 83,933 suite.
- RTL lines ending at the content edge: 4,601 + 46,358.
- The 686 LTR lines starting elsewhere all hold a SHY with RTL-level text. In the samples the offset is 682 raw, one Arial hyphen: the unobservable first-line H pushes the text right.

## 8. What the lab can derive and compare exactly

- **Predicted rects.** From `BlinkObservedLayout` (§3), compute `codePointRects` and `nodeRects` for every run (§4.6-§4.7). Compare them with the row as multisets per code point and per node, in raw units: `Math.round(v × 64 × zoom)` at power-of-two zooms, else the float32 formula of §4.1. This comparison is exact, with no visibility rule.
- **Lines and breaks.** The line count, each line's text range and each line's first covered code point come from the items. The scorer's centre clustering, zero-area-line rule, `hyphenBoxes` filter and cluster starts become diagnostics, not the metric.
- **Widths.** `LineInfo::Width` with hanging included equals the sum of the line's item sizes. It also equals the right edge minus the left edge of the line's node rect union, whenever every item of the line is reported by some node range: all lines except §9 U3.
  - The port's `engineWidth.raw` is `info.width − hanging` (index.ts:268). Scoring that is `info.width` checked against the node union, which is audit D3's suggestion.
  - The CSS-px `width` then no longer has to copy `markVisible` or `OTHER_SPACE`.
- **Positions inside a line.** Any caret position that doesn't sit on the LayoutUnit grid is observed to one unit through its floor and ceiling: two constraints per inner edge. So the lab can check, to one unit, which glyph carries a kerning adjustment (legacy `kern` gives `d >> 1` to the first glyph; blink-gaps §3.6 L1) whenever the adjustment is at least one unit.
- **Painter.** The same model scores painted lines. The painter metric becomes a prediction of the painted items' rects.

## 9. Unobservable by rule

- **U1.** Caret positions finer than one LayoutUnit: only `floor64` and `ceil64` survive. Whole items give their `ceil64` width.
- **U2.** How advances divide inside one glyph run. Code points of one grapheme share the run's rect; several graphemes get equal shares. Per-code-point shaping inside a run can't be seen, and neither can which characters a font's ligature merged, except through the equal shares.
- **U3.** The hyphen item of an odd-level item when no fragment item of the same text node comes before it: the node's first line with items. No range includes H. Its width is still visible indirectly in an LTR paragraph, where the text item after it starts at `H.inlineSize` (the 686 lines). In an RTL paragraph, where H is the leftmost item and the line's right edge is pinned, nothing shows it, unless another item lies to its left.
- **U4.** Whether a zero-advance code point is covered by an item or only touches one. A covered zero-advance character and an uncovered character touching one item boundary report the same single zero-width rect. Line membership of such code points is visible only where the rects differ.
- **U5.** Text nodes without a LayoutText, and nodes whose content is all collapsed: nothing is reported, so which rule dropped them is invisible.
- **U6.** Which glyph a character draws: the hyphen's U+2010 against `-`, a control's glyph. Range rects give advances, not ink.
- **U7.** Vertical placement beyond line grouping, until rounded integer ascent and descent are an input (§4.8).
- **U8.** Lines that create no line box: no items, no rects.

## 10. Open items and probes to run

Probes (Chrome, DPR 2, one browser at a time under the lock):
- **P1. Odd-level hyphen copies away from the SHY.** `<div dir=rtl style="font:16px Arial;width:Wpx">abc بب­بب</div>`, with W such that the Arabic word starts line 2 and breaks at the SHY. Expected: H's rect on the last code point of line 1's item, on the space removed at line 1's end and on the first `ب` of line 2; the SHY zero-width; the whole-node rect includes H.
- **P2.** A preserved LF in `pre-wrap`: expect a zero-width, non-boundary rect at the end of the line it ends [I: size 0].
- **P3.** CR and FF in `pre-wrap`: expect two boundary rects at the edges of the neighbouring items. FF in `normal`: expect a positive rect.
- **P4.** A two-grapheme ligature, `ffi` in a fixture font that has one: expect equal shares.
- **P5.** `c-16ed8328a8304ca6`: find out whether the SHY is collapsed in text_content, or the line breaker left it out of line 2's item, which the port includes. Compare a Range from the WJ to `b` with the node rects.
- **P6.** Zoom 1.5 and 3: check `f32(f32(raw / 64) × f32(1 / zoom))`.
- **P7.** Legacy `kern` attribution through inner code point edges in Times New Roman `AV`.

Decisions for the owners:
- Carry `BlinkObservedLayout` (§3) as engine-true output next to `lines`, or behind a debug flag.
- Model CR and FF in the preserving modes as items with no fragment, not `collapsed` and not zero-width `text` (conflicts with REPORT §7 item 8).
- Correct the lab docs' U+2028 caveat (§6.1).
