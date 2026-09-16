# Blink text preparation and break opportunities (Chrome 153.0.8010.48)

Scope: how Chrome turns DOM text plus styles into the paragraph string that its line breaker walks, how that string is split into items and shaping groups, and where break opportunities come from. Line filling, width fitting and glyph advances are other specs; they are mentioned only where they consume what this spec produces.

## 0. Sources, citation format, version checks

- **Blink** citations are `path:line` in chromium/src at tag `153.0.8010.48` (`chrome/VERSION` MAJOR=153 MINOR=0 BUILD=8010 PATCH=48). The sparse checkout at `~/github/browser-engines/chromium-153.0.8010.48` was still downloading, so every Blink file was fetched from gitiles at that tag (`https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.48/<path>?format=TEXT`). `blink/` means `third_party/blink/renderer/`.
- **ICU** citations are `icu:path:line` in `third_party/icu`. Chrome 153 pins it at `8cc91d9b6ab9991802fd208ee03a69714fd0251c` (`DEPS:2408-2409`), and Chrome 152 at `d578f2e8` (the local checkout `~/github/browser-engines/chromium-152/src/third_party/icu`). The only ICU commit between the two is "[ICU] Exclude unused nfkc_scf.nrm from ICU data bundle". The 153 copies of `README.chromium`, `source/data/brkitr/{root,zh,ja,ko}.txt` are identical to 152, and `filters/common.json` differs by those 5 lines only. The installed `Google Chrome Framework.framework/Versions/153.0.8010.48/Resources/icudtl.dat` is byte-identical (`cmp`) to the groundwork oracle's `oracle/blink/data/icudtl-chrome153.dat`. ICU line numbers therefore come from the 152 checkout, which holds the same break data. The version is ICU 78.2 (`icu:README.chromium`).
- **HarfBuzz** citations are `hb:path:line` at `dfdc088c4d7c5d31dd5b13070b919b51f6c21ea8` (`DEPS:384`; Chrome 152 used `28f4dc62`). `hb:src/hb-ot-shape.cc` is identical between the two revisions.
- **Local probe.** `scratchpad/icuprobe/probe.cc` was built against Chromium's ICU 78.2 source (the groundwork's `libicuuc_chromium.a`) and loads the installed Chrome 153 `icudtl.dat` through `udata_setCommonData`, as `blink/platform/text/character_property_data_generator.cc:52-75` does. Every "ICU says" result below comes from that probe. No browser was launched.

### 0.1 152 → 153 differences in the files this spec relies on

Byte-identical between 152 and 153 (`diff` against the 152 checkout): `inline_items_builder.cc/.h`, `inline_item.cc/.h`, `inline_node.cc/.h`, `inline_item_segment.cc`, `text_break_iterator.cc/.h`, `text_break_iterator_icu.cc`, `text_break_iterator_internal_icu.cc`, `character.cc/.h`, `character_break_iterator.cc`, `character_property_data_generator.cc`, `layout_locale.cc/.h`, `bidi_paragraph.cc/.h`, `run_segmenter.cc/.h`, `font_features.cc`, `shape_result_spacing.cc`, `case_mapping_harfbuzz_buffer_filler.cc`, `font_description.cc`, `whitespace_attacher.cc`, `font_fallback_list.cc`, `tab_size.h`.

Changed:
- `blink/core/dom/text.cc`: adds `getBoxQuads`/`convert*FromNode` (153:165-198), so later line numbers shift by +40. `TextLayoutObjectIsNeeded` logic is unchanged.
- `blink/core/layout/layout_text.cc`: refactor of `TransformAndSecureText` (153:888-919). Uses `StyleRef()` where 152 checked `Style()` for null. No change for laid-out text.
- `blink/core/layout/inline/line_breaker.cc`, compared with the 152 **committed** file (`git show HEAD:`; the 152 working tree also has local TRACE210 logging): the only change is the added `constraint_space_.Direction()` argument at 153:3857-3858.
- `blink/platform/fonts/shaping/shaping_line_breaker.cc`: new `LineBreakerHanKerningEnd` path (153:370-375), flag new and `stable` (`blink/platform/runtime_enabled_features.json5:3865-3866`). It affects widths at Han-kerned line ends, not break opportunities.
- `blink/platform/fonts/shaping/harfbuzz_shaper.cc`: logging format only (153:67, 159, 175). Line numbers after 66 are +1 relative to 152.
- `blink/platform/fonts/shaping/shape_result.cc`: 25 changed lines, not inspected beyond `ApplySpacingOrExpansion` (153:993-1056), which this spec cites.
- `runtime_enabled_features.json5`: among text-related flags, only `LineBreakerHanKerningEnd` (added, stable), `TextOverflowString` (test→experimental) and `MemoryConsumerForNGShapeCache` changed. The rest are removals of editing flags.

## 1. Terms

- **text_content**: the paragraph string Blink builds for one block's inline content (one "inline formatting context"). It is UTF-16, and all offsets in this spec are UTF-16 code-unit indices into it. It contains the collapsed text of every text node, plus one character for some non-text things: U+FFFC for an atomic inline or block-in-inline, U+200B for `<wbr>` or a generated break opportunity, U+000A for a forced break, and bidi control characters for `unicode-bidi`. Built by `InlineItemsBuilder`; stored at `blink/core/layout/inline/inline_items_builder.cc:1737`.
- **item** (`InlineItem`): a `[start, end)` range of text_content plus a type and a style. Types used here: `kText`, `kControl` (tab run, LF forced break, U+200B opportunity, CR, FF), `kOpenTag`/`kCloseTag` (zero length), `kBidiControl` (one bidi control char), `kAtomicInline` (U+FFFC), `kFloating`/`kOutOfFlowPositioned` (zero length).
- **collapse type** of an item's end: `kNotCollapsible` (default, `blink/core/layout/inline/inline_item.h:307`), `kCollapsible` (ends with a collapsed space, or is a forced break), `kCollapsed` (its trailing space was removed), `kOpaqueToCollapsing` (ignored when looking for the previous item to collapse with).
- **break opportunity at offset k**: the line may end before code unit k. `IsBreakable(k)` in Blink.
- **shaping group**: the maximal run of items shaped by one `HarfBuzzShaper::Shape` call.
- **8-bit string**: a WTF string whose code units are all ≤ U+00FF. Blink chooses fast paths on this.

## 2. Pipeline

```
DOM  --(A) which text nodes get a LayoutText-->  layout tree
     --(B) text-transform, -webkit-text-security, <br>, <wbr>-->  per-LayoutText strings
     --(C) InlineItemsBuilder: white-space processing-->  text_content + items
     --(D) bidi levels (split items) + script/emoji segments-->
     --(E) ShapeText: shaping groups, context, fallback, spacing-->  ShapeResults per item
     --(F) LineBreaker + LazyLineBreakIterator-->  break opportunities as lines are filled
```

### 2.A Which text nodes get layout objects

`Text::TextLayoutObjectIsNeeded` (`blink/core/dom/text.cc:319-364`):

```
function textLayoutObjectIsNeeded(textNode, ctx, style):   // style = parent element's style
  if !ctx.parent.canHaveChildren(): return false
  if textNode.isEditingText(): return true
  if textNode.length == 0: return false
  if style.display == none: return false
  if !containsOnlyWhitespaceOrEmpty(textNode.data): return true
  // whitespace-only from here. "Whitespace" = IsAsciiSpace: U+0020, U+0009..U+000D
  // (string_impl.cc:375-382; ascii_ctype.h:102-104 in the 152 checkout). VT (U+000B) counts.
  if ctx.parent is table/table-row/table-section/table-col/frameset/flexbox/grid/SVG root, container, image or shape:
     if !ctx.usePreviousInFlow || ctx.previousInFlow is null || !previousInFlow.isText: return false
     if !(style.shouldPreserveBreaks || !endsWithWhitespace(previousInFlow.transformedText)): return false   // text.cc:299-317
  if style.preservesWhiteSpaces && style.wrap && parent.isSVG: return false
  if style.shouldPreserveBreaks: return true            // pre, pre-wrap, pre-line, break-spaces
  if !ctx.usePreviousInFlow: return false
  if ctx.previousInFlow is null: return ctx.parent.isLayoutInline   // first in-flow thing: only inside an inline box
  if ctx.previousInFlow.isText: return !endsWithWhitespace(previousInFlow.transformedText)  // IsAsciiSpace on last code unit, text.cc:295-297
  return previousInFlow.isInline && !previousInFlow.isBR
```

- `previousInFlow` is the previous **in-flow** layout sibling. Floats and absolutely positioned boxes are not recorded (`blink/core/dom/WhitespaceLayoutObjects.md:32-52`). `use_previous_in_flow` is set when a subtree is attached and during whitespace reattachment (`blink/core/dom/whitespace_attacher.cc:117-121`; 152 `core/dom/element.cc:4681,4876`).
- Effect in collapse modes: dropping a node that InlineItemsBuilder would have collapsed anyway changes nothing.
  - `previousInFlow` is a layout sibling. After `<span>…</span>` it is the span's `LayoutInline`, so a whitespace node after an element is kept.
  - The `EndsWithWhitespace` branch applies only when the previous sibling is itself a text node, for example two adjacent text nodes created from JS, or text separated by a comment.
  - It **does** change results when that previous text node ends in FF or VT. `IsAsciiSpace` accepts both, but neither collapses (§2.C.4), so the space that would have separated them from the next element never appears. See H7 and H8.
  - A preserved space cannot trigger this: the whitespace node would share the parent's preserve style, and then `ShouldPreserveBreaks` keeps it.

### 2.B Per-LayoutText string

- **Text node**: `LayoutText::TransformedText()` = `TransformAndSecureText(original)` (`blink/core/layout/layout_text.cc:888-919`).
  - `text-transform` is applied first (`blink/core/style/computed_style.cc:1966-2025`), in spec order:
    - `capitalize` / `uppercase` / `lowercase`, using ICU `CaseMap` with the element's locale (1981-1998). `capitalize` uses `Capitalize(result, previous_character)` unless the `ICUCapitalization` flag is on, and that flag is `experimental`, so off (`runtime_enabled_features.json5:3589-3590`). The previous character is the last code unit of the previous LayoutText in pre-order, or U+0020 if there is none (`layout_text.cc:857-877`).
    - then `full-width` (2000-2003)
    - then `full-size-kana` (2005-2022)
    - Measured in installed Chrome 153 on 2026-09-16: `full-width` isn't parsed (`CSS.supports('text-transform', 'full-width')` false, computed `none`). The keyword is gated by the experimental runtime flag `CSSTextTransformFullWidth` (`runtime_enabled_features.json5:2066-2070`), and `full-size-kana` by `CSSTextTransformFullSizeKana`, also experimental, so lines 2000-2022 never run in stable 153 (H32; CRITIC C14).
  - Uppercase and lowercase can change the length, for example `ß` → `SS`. Line breaking and shaping see the transformed string.
  - `-webkit-text-security: disc|circle|square` then replaces each grapheme cluster by U+2022, U+25E6 or U+25A0 (`layout_text.cc:899-966`).
- **`<br>`**: `LayoutBR` text is `"\n"` (`blink/core/layout/layout_br.cc:32-37`).
- **`<wbr>`**: `LayoutWordBreak` has empty text and `IsWordBreak()==true` (`blink/core/layout/layout_word_break.cc:34-40`).

### 2.C InlineItemsBuilder (white-space processing)

The tree walk is `CollectInlinesInternal` (`blink/core/layout/inline/inline_node.cc:340-468`). In document order:
- `EnterBlock` for the block
- per LayoutText, `AppendText`
- per float, `AppendFloating` (opaque, no character, 1316-1327)
- per out-of-flow box, `AppendOutOfFlowPositioned` (opaque, no character, 1329-1336)
- per atomic inline, `AppendAtomicInline`
- per inline box, `EnterInline` … children … `ExitInline`
- `ExitBlock` at the end

`white-space` longhands (`blink/core/css/white_space.h`):

| `white-space` | collapse (25-33) | wrap | PreserveWhiteSpaces (48-50) | PreserveBreaks (56-58) | BreakSpaces (62-64) | ShouldWrapLine (74-76) |
|---|---|---|---|---|---|---|
| normal | collapse | wrap | no | no | no | yes |
| nowrap | collapse | nowrap | no | no | no | no |
| pre | preserve | nowrap | yes | yes | no | no |
| pre-wrap | preserve | wrap | yes | yes | no | yes |
| pre-line | preserve-breaks | wrap | no | yes | no | yes |
| break-spaces | break-spaces | wrap | yes | yes | yes | yes |

(`EWhiteSpace` values: `white_space.h:103-116`.)

#### C.1 Dispatch (`inline_items_builder.cc:586-681`)

```
function appendText(layoutText):
  if layoutText.isWordBreak:                        // <wbr>
     if isTextCombine: appendTextItem(U+200B) else appendBreakOpportunity()   // 598-610
     return
  S = layoutText.transformedText
  if S.empty: appendEmptyTextItem(); return          // opaque, zero-length (302-312)
  restoreTrailingCollapsibleSpaceIfRemoved()         // 669, see C.6
  noNewline = layoutText.isSVGInlineText || isTextCombine || rubyTextNesting > 0   // 662-667
  if style.preservesWhiteSpaces:           appendPreserveWhitespace(S)      // pre, pre-wrap, break-spaces
  elif style.preservesBreaks && !noNewline: appendPreserveNewline(S)        // pre-line
  else:                                    appendCollapseWhitespace(S)      // normal, nowrap
```

#### C.2 Character predicates

- `IsCollapsibleSpace(c)` = U+0020, U+000A, U+0009, **U+000D** (`blink/platform/text/character.h:150-153`). A run of these is a "space run". It "has a newline" only if it contains U+000A (`inline_items_builder.cc:189-202`).
- `IsControlItemCharacter(c)` = U+000A, U+0009, U+200C (ZWNJ), U+000D, U+000C (`inline_items_builder.cc:164-184`). This is used **only** in preserve modes.
- `GetCollapsedSpaceChar(style)` = U+3000 if `text-transform` includes `full-width`, else U+0020 (221-226).
- `LastItemToCollapseWith(items)` = the last item whose end collapse type is not `kOpaqueToCollapsing` (207-214). These are skipped: open/close tags, bidi controls, `<wbr>` and generated U+200B items, empty text items, floats, out-of-flow boxes.

#### C.3 Segment break transformation (the only rule that removes a newline)

`ShouldRemoveNewline` (`inline_items_builder.cc:92-151`). The East Asian width rule is compiled out: `SEGMENT_BREAK_TRANSFORMATION_FOR_EAST_ASIAN_WIDTH 0` at 67.

```
function shouldRemoveNewline(before /*text_content so far*/, spaceIndex, after /*rest of this LayoutText after the space run*/):
  // 8-bit fast path at 148 is equivalent: U+200B forces 16-bit.
  return (spaceIndex > 0 && before[spaceIndex-1] == U+200B) || (after.length > 0 && after[0] == U+200B)
```

So a space run containing a newline disappears completely when a ZWSP is right before it (in text_content, including a `<wbr>` ZWSP) or right after it (in the same text node). CJK text around a newline keeps the space.

#### C.4 Collapse modes (`AppendCollapseWhitespace`, 784-985)

```
function appendCollapseWhitespace(S, style, layoutText):
  i = 0; endCollapse = NotCollapsible; runHasNewline = false
  if isCollapsibleSpace(S[0]):
    (i, runHasNewline) = endOfSpaceRun(S, 0)
    if runHasNewline && S.length == 1 && layoutText.isBR:                     // 814-823
       if isTextCombine || rubyTextNesting > 0: appendTextItem(" ") else appendForcedBreakCollapseWhitespace()
       return
    last = lastItemToCollapseWith(items)
    if last == null: insertSpace = false                                       // paragraph-leading spaces removed (868-872)
    elif last.endCollapse == NotCollapsible: insertSpace = true                // 828-831
    else:   // last.endCollapse == Collapsible (a text item ending in a space, or a forced break)
      insertSpace = false
      if (runHasNewline || last.isEndCollapsibleNewline) && last.type == Text &&
         shouldRemoveNewline(text, last.end - 1, S[i:]):
         removeTrailingCollapsibleSpace(last); runHasNewline = false           // 841-846
      elif !last.style.wrap && style.wrap:                                     // nowrap → wrap edge
         if !(last.type == Control && text[last.start] == '\n'):
            appendGeneratedBreakOpportunity()                                  // 847-866
    if runHasNewline && shouldRemoveNewline(text, text.length, S[i:]):
       insertSpace = false; runHasNewline = false                              // 875-879
    start = text.length
    if insertSpace: text += collapsedSpaceChar(style)
    if i == S.length: endCollapse = Collapsible
  else:
    last = lastItemToCollapseWith(items)
    if last && last.endCollapse == Collapsible && last.isEndCollapsibleNewline &&
       shouldRemoveNewline(text, last.end - 1, S): removeTrailingCollapsibleSpace(last)   // 903-910
    start = text.length
  while i < S.length:                                                          // 916-972
    j = first index ≥ i with isCollapsibleSpace(S[j]) (or S.length)
    text += S[i:j]                                     // non-space text verbatim, including FF, VT, NBSP, ZWSP, ZWNJ
    if j == S.length: endCollapse = NotCollapsible; break
    (i, runHasNewline) = endOfSpaceRun(S, j)
    if runHasNewline && shouldRemoveNewline(text, text.length, S[i:]):
       endCollapse = NotCollapsible; runHasNewline = false                     // run removed
    else:
       text += collapsedSpaceChar(style); endCollapse = Collapsible
  if text.length == start: appendEmptyTextItem(); return                       // 975-978
  push Text item [start, text.length), endCollapse, isEndCollapsibleNewline = runHasNewline   // 980-984
```

Examples, each one text node inside `<div>`. Output is text_content.
- `"  a \n\t b  "` → `"a b "` while building. `ExitBlock` removes the trailing space: `"a b"`.
- `"a\rb"` → `"a b"`, because CR is collapsible (character.h:152).
- `"a\fb"` → `"a\fb"`: FF stays a real character inside the text item.
- `"a​\nb"` → `"a​b"`, by the ZWSP rule.
- `<span style="white-space:nowrap">foo </span> bar` → `"foo ​bar"`. The second space collapses into the first, and a generated U+200B control item is added because the edge goes from nowrap to wrap (847-866).

#### C.5 pre-line (`AppendPreserveNewline`, 1138-1160)

```
for each maximal piece of S:
   "\n" → appendForcedBreakCollapseWhitespace()     // removes a collapsible trailing space, then a forced break (1201-1208)
   other → appendCollapseWhitespace(piece)          // TAB and CR collapse; FF and VT stay
```

#### C.6 Preserve modes: pre, pre-wrap, break-spaces (`AppendPreserveWhitespace`, 1040-1136)

```
function appendPreserveWhitespace(S, style):
  start = 0
  insertBreakAfterLeadingPreservedSpaces(S, style, &start)
  if start >= S.length: return
  loop:
    c = first index ≥ start with isControlItemCharacter(S[c]) (or S.length)
    if c != start: push Text item S[start:c]; if c >= S.length: break; start = c
    switch S[start]:
      '\n': if isTextCombine || rubyTextNesting > 0: push Text " "; start++
            else: appendForcedBreak(); start++; insertBreakAfterLeadingPreservedSpaces(S, style, &start)
      '\t': e = end of the run of tabs; push Control item S[start:e] (FlowControl); start = e   // 1098-1111
      U+200C: c = next control char after start+1 (or S.length); continue   // ZWNJ becomes the first char of the next text item (1112-1118)
      '\r', '\f': push Control item [start,start+1) (FlowControl); start++    // 1119-1125
    if start >= S.length: break

function insertBreakAfterLeadingPreservedSpaces(S, style, &start):   // 987-1034
  if isTextCombine || style.collapsesWhiteSpaces || !style.wrap || S[start] != ' ': return
  atLineStart = start > 0 ? S[start-1] == '\n' : (text.empty || text.last == '\n')
  if !atLineStart: return
  e = first index > start with S[e] != ' '         // U+0020 only; tabs do not count
  push Text item S[start:e]; appendGeneratedBreakOpportunity(); start = e
```

- VT (U+000B), other C0 controls (U+0001-U+0008, U+000E-U+001F), NBSP, ZWSP, U+2060, U+2028 and U+2029 are **not** control characters. They stay inside text items in every mode.
- `appendForcedBreak()` (1162-1199):
  - if bidi contexts are open, first push their exit characters (PDF/PDI, innermost first) as opaque `kBidiControl` items
  - push a `kControl` item U+000A with type `kForcedLineBreak` and end collapse type `kCollapsible` (1188), so following collapsible spaces are removed as leading spaces
  - re-push the enter characters of those bidi contexts
- `appendBreakOpportunity()` pushes an opaque `kControl` U+200B, `kFlowControl` (1210-1218). `appendGeneratedBreakOpportunity()` is the same but marked generated, and is skipped for SVG text (315-326).
- `appendAtomicInline()` restores a removed trailing space, then pushes `kAtomicInline` U+FFFC (1268-1287). Its collapse type is the default `kNotCollapsible`, so a following space is kept.
- `appendBlockInInline()` removes a trailing collapsible space and pushes U+FFFC with collapse type `kCollapsible` (1289-1314).

#### C.7 Trailing spaces

- `removeTrailingCollapsibleSpace(item)` (1376-1410):
  - if `item.type != Text`, nothing happens. A forced break or block-in-inline only pretends to end in a space.
  - otherwise it erases `text[item.end-1]` (U+0020 or U+3000), sets `item.end -= 1` and `endCollapse = Collapsed`, and shifts the offsets of every later item by −1.
- `restoreTrailingCollapsibleSpaceIfRemoved()` (1412-1451): if the last collapse-relevant item is `Collapsed`, it reinserts the collapsed space character at `item.end` and shifts later items by +1. It is called at the start of every `AppendText` and `AppendAtomicInline`.
- `ExitBlock()`: pop all bidi contexts, then `removeTrailingCollapsibleSpaceIfExists()` (1621-1629). A paragraph never ends with a collapsed space in text_content.

#### C.8 Bidi control characters (`EnterBlock` 1474-1527, `EnterInline` 1529-1619, `Exit` 1726-1732)

- On the block, `unicode-bidi: normal|embed|isolate` inserts nothing. The block direction becomes the paragraph level, and RTL sets `has_bidi_controls_`. `bidi-override` and `isolate-override` insert LRO/RLO … PDF. `plaintext` inserts nothing; the paragraph level comes from the text.
- On an inline box, the characters go **before** the `kOpenTag` item, and the exits come after `kCloseTag` (`ExitInline` 1699-1723):

| `unicode-bidi` | enter | exit |
|---|---|---|
| embed | LRE U+202A / RLE U+202B | PDF U+202C |
| bidi-override | LRO U+202D / RLO U+202E | PDF |
| isolate | LRI U+2066 / RLI U+2067 | PDI U+2069 |
| plaintext | FSI U+2068 | PDI |
| isolate-override | FSI then LRO/RLO | PDF then PDI |

- UA rules: `[dir=ltr i], [dir=rtl i], [dir=auto i], bdi` get `unicode-bidi: isolate`, and `bdo` gets `isolate-override` (`blink/core/html/resources/html.css:1883-1888`). The `dir` attribute sets `direction` (`blink/core/html/html_element.cc:447-449`). So `foo<span dir=rtl>bar</span>` gives the text_content `"foo⁧bar⁩"`.

#### C.9 Character table (what text_content and items contain)

| code point | normal / nowrap | pre-line | pre / pre-wrap / break-spaces |
|---|---|---|---|
| U+0020 | collapses; runs become one U+0020 (U+3000 under `full-width`) | same | kept. In wrap modes, a leading run at paragraph start or after LF is followed by a generated U+200B |
| U+0009 TAB | collapses as a space | collapses | `kControl` item for each run of tabs |
| U+000A LF | collapses; sets "has newline" | forced break, removing the trailing collapsible space before it | forced break |
| U+000D CR | collapses as a space | collapses | one-char `kControl` item |
| U+000C FF | literal character in the text item | literal | one-char `kControl` item |
| U+000B VT, other C0 | literal | literal | literal |
| U+200B ZWSP | literal; removes an adjacent segment break (C.3) | literal | literal |
| U+200C ZWNJ | literal | literal | starts a new text item |
| U+00A0, U+00AD, U+2060, U+2028, U+2029, U+3000 | literal | literal | literal |

What control items do in the line breaker (`blink/core/layout/inline/line_breaker.cc:2944-2999`):
- tab: shaped as tab stops through `CreateForTabulationCharacters`, then handled like text (2955-2976)
- U+200B: `can_break_after = true` even under `nowrap`. A `<wbr>` creates a line box; a generated one does not (2977-2987).
- CR, FF: `HandleEmptyText`, meaning zero width and `can_break_after` left false (2988-2994)
- LF: `HandleForcedLineBreak` (2856-2940)

### 2.D Bidi resolution and script/emoji segments

- **Bidi enabled?** `is_bidi_enabled_ = has_bidi_controls_ || (has_non_orc_16bit && MaybeBidiRtl(text_content))` (`inline_items_builder.cc:1744-1746`).
  - `has_non_orc_16bit` is set when any appended code unit is ≥ U+0100 other than U+FFFC (216-218, 725).
  - `MaybeBidiRtl` is true for 16-bit text containing a code unit ≥ U+0590 outside U+200B, U+2010-U+2029, U+206A-U+D7FF and U+FF00-U+FFFF (`character.h:295-305, 324-328`). Surrogates count as maybe-RTL.
- **`SegmentBidiRuns`** (`inline_node.cc:1333-1461`):
  - `ubidi_setPara(text_content, paraLevel)`. The level is the block's `direction`, or `UBIDI_DEFAULT_LTR` when the block has `unicode-bidi: plaintext` (`blink/platform/text/bidi_paragraph.cc:14-47`).
  - If the result is unidirectional LTR, bidi is disabled.
  - Floats and out-of-flow boxes are represented by an inserted U+FFFC for resolution only (1379-1409).
  - For each logical run from `ubidi_getLogicalRun`, `InlineItem::SetBidiLevel` assigns the level and **splits an item** whose range crosses the run end (`inline_item.cc:207-254, 311-320`).
  - `item.Direction()` = RTL iff the level is odd (`inline_item.h:163`).
- **`SegmentScriptRuns`** (`inline_node.cc:1223-1287`):
  - If `(text_content.Is8Bit() || !has_non_orc_16bit) && !is_bidi_enabled`, the **whole paragraph is one segment with script Latin** and fallback priority Text (1256-1266).
  - Otherwise `RunSegmenter` runs over the entire text_content (1270-1286). A segment ends where either iterator ends a run (`blink/platform/fonts/shaping/run_segmenter.cc:44-73`):
    - `ScriptRunIterator` (`blink/platform/fonts/script_run_iterator.cc:325-429`): ICU script plus Script_Extensions, with Common/Inherited characters merged into the surrounding script and paired brackets (431-489, 491+)
    - `SymbolsIterator`, which runs the ragel emoji-presentation scanner from `third_party/emoji-segmenter` and yields priority `kEmojiEmoji`, `kEmojiEmojiWithVS`, `kEmojiTextWithVS` or `kText` (`blink/platform/fonts/symbols_iterator.cc:34-79`)
  - Orientation segments only in vertical text.
  - Segments do **not** split items. Each shape call walks the segments it overlaps (`inline_item_segment.cc:255-273`).

### 2.E Which text is shaped together (`InlineNode::ShapeText`, `inline_node.cc:1551-1796`)

```
index = 0
while index < items.length:
  s = items[index]
  if s.type != Text || s.length == 0: index++; continue
  end = s.end
  for j in index+1..:
    it = items[j]
    if it.type == Control: break                                    // LF, tab, U+200B, CR, FF (1639-1643)
    if it.type == Text:
       if it.length == 0: continue
       if it is a symbol marker: break
       if style(it) != style(s) && font(it) != font(s): break        // Font equality (472-485)
       if it.direction != s.direction || it.runSegment != s.runSegment: break   // 487-490
       if text[it.start] == U+200C: break                           // ZWNJ at item start (1654-1658)
       end = it.end
    elif it.type == OpenTag:  if padding-inline-start ≠ 0 || margin-inline-start ≠ 0 || border-inline-start-width ≠ 0 || vertical-align ≠ baseline: break   // 494-509
    elif it.type == CloseTag: same test with the inline-end sides                          // 512-527
    else: break                                                     // atomic inline, bidi control, float, OOF, ruby
  shapeResult = HarfBuzzShaper(text_content).Shape(font(s), s.direction, s.start, end, segments)
  if font(s).letterSpacing != 0 || font(s).wordSpacing != 0: shapeResult.applySpacing(...)   // 1720-1730
  split shapeResult into per-item results without reshaping; the item holding the first code unit of a ligature keeps the glyph   // 1743-1781
```

- **Font equality.** `Font::operator==` compares the font fallback list (or selector plus description) (`blink/platform/fonts/font.cc:79-89`). `FontDescription::operator==` includes family, **locale**, all sizes, **letter_spacing**, **word_spacing**, weight/style/stretch, the feature and variation settings, palette and alternates (`blink/platform/fonts/font_description.cc:136-157`).
  - So `<b>`, a different `lang`, or a different `letter-spacing` or `word-spacing` start a new group.
  - A different color or text-decoration does not.
- **The HarfBuzz call.** `HarfBuzzShaper::Shape(font, dir, start, end, ranges)` (`harfbuzz_shaper.cc:1108-1136`) calls `ShapeSegment` once per segment range (880-1059). Inside a segment, font fallback works per cluster (`ExtractShapeResults` 559-702):
  - glyph 0 (`.notdef`), and U+3000 shaped with the space glyph while other fonts remain (598-606), queue the cluster range for the next font
  - each queued range is shaped again as a separate `hb_shape_full` call
- **What one hb_shape call sees.** The buffer is filled with `hb_buffer_add_latin1/utf16(text_content, text_length, item_offset=shape_start, item_length)` (`case_mapping_harfbuzz_buffer_filler.cc:32-43`). HarfBuzz records up to `CONTEXT_LENGTH = 5` code points of pre- and post-context from outside the range (`hb:src/hb-buffer.hh:109`; `hb:src/hb-buffer.cc:1837-1862`).
  - **Kerning, ligatures and GPOS never cross a group, segment or fallback boundary**, because those are separate `hb_shape` calls.
  - **Arabic joining does cross them**: the Arabic shaper reads the pre- and post-context characters when choosing joining forms (`hb:src/hb-ot-shaper-arabic.cc:305-360`).
  - Example: `ب<b>ب</b>` makes two shape calls with different fonts, and both letters still get joined forms.
  - Measured in installed Chrome 153 on 2026-09-16: true for the OpenType font Noto Naskh Arabic (`ب<b>ب</b>` 43.6875 = initial 11 + bold final 32.6875), false for Geeza Pro (55.90625 = isolated 25.59375 + bold isolated 30.3125). Geeza Pro's faces carry `morx` and `kern` but no `GSUB` or `GPOS`, so [I] HarfBuzz shapes it with the AAT shaper, which doesn't read the buffer context. Geeza Pro joins only inside one group (`ب<span style="color:red">ب</span>` 37.4921875). Cross-item joining needs an OpenType Arabic font (H3).
  - Inside one group, e.g. `<span>A</span><span>V</span>` with the same font, `A` and `V` are in one call and kern.
- **Script and language.** The segment script goes into `hb_buffer_set_script` (340-341). The language is `font-language-override` if set, else `LocaleOrDefault().HarfbuzzLanguage()` (858-876): the element locale, else the UI language (`layout_locale.cc:294-302`).
- **Glyph lookups that change measured text.**
  - U+2028 and U+2029 are mapped to the space glyph (`blink/platform/fonts/shaping/harfbuzz_face.cc:110-113`).
  - On Apple, a missing U+2010 or U+2011 is synthesized through CoreText (217-229).
  - Default-ignorable characters (U+00AD, U+200B-U+200F, U+202A-U+202E, U+2060-U+206F, U+FEFF, variation selectors …) become the invisible space glyph with zero advance (`hb:src/hb-ot-shape.cc:778-799, 823-847`). Blink sets no `REMOVE`/`PRESERVE` buffer flags (no `hb_buffer_set_flags` in `harfbuzz_shaper.cc`).
  - C0 controls such as U+000B and U+000C are not default-ignorable in HarfBuzz, so they go through normal cmap lookup and fallback. Their width is not determined by the source here; see H5 and H6.
- **Letter spacing turns ligatures off.**
  - Features come from `FontFallbackList::GetFontFeatures` → `FontFeatureRange::FromFontDescription` (`font_fallback_list.cc:226-250`).
  - With `LetterSpacing() != 0`, it pushes `liga=0`, `clig=0` and `calt=0`, and refuses to add `dlig` and `hlig` (`blink/platform/fonts/shaping/font_features.cc:52-86`).
  - `kern` stays on.
  - `chws` is added by default through `text-spacing-trim` (197-228).
- **Spacing application** (`ShapeResult::ApplySpacingOrExpansion`, `shape_result.cc:993-1046`; `ShapeResultSpacing::ComputeSpacing`, `blink/platform/fonts/shaping/shape_result_spacing.cc:103-139`):

```
for each run, for each glyph g that is the last glyph of its HarfBuzz cluster (same character_index ends):
  index = run.startIndex + g.characterIndex            // an offset in text_content
  c = text_content[index]                              // one code unit
  treatAsSpace = c in {U+0020, U+0009, U+000A, U+00A0}  // character.h:159-162 (tab allowed: allow_tabs_=false only for canvas normalize)
  spacing = 0
  if letterSpacing != 0 && !TreatAsZeroWidthSpace(c) && (!isCursiveScript(run.script) || treatAsSpace):   // IgnoreLetterSpacingInCursiveScripts is stable
       spacing += letterSpacing
  if treatAsSpace && (allowWordSpacingAnywhere || index != 0 || c == U+00A0): spacing += wordSpacing
  g.advance += spacing
```

- `TreatAsZeroWidthSpace(c)` = FF, CR, U+FFFC, or any `Default_Ignorable_Code_Point` (below U+0100 only U+00AD), plus ZWNJ and ZWJ (`character.h:163-189`).
- The cursive scripts are Arabic, Hanifi Rohingya, Mandaic, Mongolian, NKo, Phags-pa and Syriac (`shape_result.cc:977-990`).
- `allowWordSpacingAnywhere` = SVG text, or the block's style `ShouldPreserveWhiteSpaces()` together with the `WordSpacingWhiteSpacePre` flag, which is stable (`inline_node.cc:1561-1565`; `runtime_enabled_features.json5:7360-7361`).

### 2.F Break opportunities

#### F.1 The iterator object and what it sees

- `LineBreaker` owns one `LazyLineBreakIterator break_iterator_` over **text_content** (the whole paragraph, all spans). For each line it calls `SetStartOffset(line_start_offset)` (`line_breaker.cc:548-553`), which drops the ICU iterator (`blink/platform/text/text_break_iterator.h:159-163`).
- The ICU iterator is opened lazily on `text_content[start_offset:]` with **no prior context**:
  - `AcquireLineBreakIterator(StringView{string_, start_offset_}, localeWithKeyword)` (`text_break_iterator.h:225-242`)
  - `TextOpenLatin1/TextOpenUtf16(..., prior_context=nullptr, 0)` (`blink/platform/text/text_break_iterator_icu.cc:735-802, 804-810`)
  - Consequence: ICU rules and dictionaries (Thai, Lao, Khmer, Burmese, CJ, phrase) restart at every line start and look ahead to the end of the paragraph.
- The grapheme iterator used for `kBreakCharacter` is also built over `StringView(string_, start_offset_)` (`text_break_iterator.h:244-249`).
- The iterator's settings follow the **current style** (`SetCurrentStyleForce`, `line_breaker.cc:4557-4643`). The current style switches at:
  - `HandleOpenTag` → the span's style (3998)
  - `HandleCloseTag` → the parent's style (4033)
  - the line start (553, 869)
  - rewinds and retries (4154, 4199, 4324-4327, 4482)
  - Text items do not switch it: they are handled under the style of their enclosing box.
  - A decision at the end of an item is therefore made under the style of the box that contains that item.

#### F.2 Settings per style (`line_breaker.cc:4557-4643`)

```
autoWrap = style.wrap (and not disallowed)                              // 419-424
if autoWrap:
  locale = style.fontDescription.locale                                 // LayoutLocale or null
  hyphens = style.hyphens
  if line-break == anywhere: strictness = Default; type = BreakCharacter; breakAnywhereIfOverflow = false
  else:
    strictness = {auto, after-white-space, anywhere → Default; normal → Normal; strict → Strict; loose → Loose}   // 57-71
    switch word-break:
      normal:      type = Normal;   breakAnywhereIfOverflow = false
      break-all:   type = BreakAll; breakAnywhereIfOverflow = false
      break-word:  type = Normal;   breakAnywhereIfOverflow = !lineClampEllipsis
      keep-all:    type = KeepAll;  breakAnywhereIfOverflow = false
      auto-phrase: type = disablePhrase ? Normal : Phrase; if !disablePhrase: hyphens = none
    if !breakAnywhereIfOverflow && !lineClampEllipsis:
      breakAnywhereIfOverflow = overflow-wrap == anywhere || (overflow-wrap == break-word && mode == Content)
    if breakAnywhereIfOverflow && (overrideBreakAnywhere || mode == MinContent): type = BreakCharacter
  softHyphenEnabled = hyphens != none
  breakSpace = style.shouldBreakSpaces ? AfterEverySpace : AfterSpaceRun
```

- **Retries that change the type.**
  - A line that overflowed with `kPhrase` is redone with `disable_phrase_ = true` (4251-4257).
  - A line that overflowed with `breakAnywhereIfOverflow` is redone with `override_break_anywhere_ = true`, meaning `BreakCharacter` (4259-4263). The whole line is rewound and the current style is forced again (4307-4330).
  - Both flags reset for each line (864-865).

#### F.3 Locale string → ICU rule file

- **Where the locale comes from.**
  - `lang` (or `xml:lang`, which wins) maps to the presentation property `-webkit-locale: "<value>"` when the value is non-empty (`blink/core/dom/element.cc:12653-12660`; `html_element.cc:455-460`).
  - `-webkit-locale` is inherited (`blink/core/css/css_properties.json5:1886-1894`) and sets `FontDescription::locale = LayoutLocale::Get(value)` (`blink/core/css/properties/longhands/longhands_custom.cc:11374-11384`).
  - The document root starts from `LayoutLocale::Get(Document::ContentLanguage())` (`blink/core/css/resolver/style_resolver.cc:2405-2406`), which is null without a Content-Language header or meta tag.
  - `lang=""` adds nothing, so the parent locale is inherited.
- **Locale with keyword** (`text_break_iterator.h:274-288`; `blink/platform/text/layout_locale.cc:368-429`):

```
function localeWithKeyword(locale, strictness, type):
  if locale == null: return ""                                    // keywords are dropped too
  if strictness == Default && type != Phrase: return locale.string
  if locale.string contains '@': return locale.string             // 376-378
  return uloc_setKeywordValue(locale.string, "lb", {Normal:"normal", Strict:"strict", Loose:"loose", Default: remove})
         + (type == Phrase ? "@lw=phrase" (via uloc_setKeywordValue) : "")
```

- **Pool** (`text_break_iterator_icu.cc:59-94`):
  - `createLineInstance(locale == "" ? CurrentTextBreakIcuLocale() : icu::Locale(locale))`
  - if a non-empty locale fails, it is retried with `CurrentTextBreakIcuLocale()`
  - `CurrentTextBreakIcuLocale()` = `icu::Locale(DefaultLanguage())` (`blink/platform/text/text_break_iterator_internal_icu.h:39-41`; `text_break_iterator_internal_icu.cc:31-45`)
  - `DefaultLanguage()` is Chrome's canonicalized platform or UI locale (`blink/platform/language.cc:63-99`)
  - up to 4 iterators are pooled, keyed by locale string (108)
- **Rule selection in ICU.**
  - Type `line`, plus `_strict|_normal|_loose` from `lb`, plus `_phrase` only if the language is `ja` or `ko` (`icu:source/common/brkiter.cpp:433-457`).
  - Resource fallback runs through `icu:source/data/brkitr/{root,zh,zh_Hant,ja,ko}.txt`. Chromium's `line_normal.patch` makes root `line` = `line_normal.brk` (`icu:source/data/brkitr/root.txt:8-12`).
  - `line_cj.brk` is excluded from the data (`icu:filters/common.json:183-191` at 153).
- **Verified with the probe on Chrome 153 data.** `cj` = `line_normal_cj.brk` (U+201D as CL, U+201C as OP, break before U+301C/U+30A0). `loose`/`loose_cj` add breaks before 々 and between IN characters (`icu:source/data/brkitr/rules/line_loose.txt` diff at 21-23, 346). `strict` = `line.brk` (CJ → NS):

| locale string (Blink) | default (`line-break:auto`) | `@lb=normal` | `@lb=strict` | `@lb=loose` | `@lw=phrase` |
|---|---|---|---|---|---|
| `en`, `th`, invalid, `cmn`, `yue` | root `line_normal` | `line_normal` | `line` | `line_loose` | root (ignored) |
| `zh`, `zh-CN`, `zh-Hans` → actual `zh` | **`line_normal_cj`** | `line_normal_cj` | `line` | `line_loose_cj` | ignored |
| `zh-TW`, `zh-HK`, `zh-Hant` → actual `zh_Hant` | **`line_normal_cj`** | `line_normal_cj` | `line` | `line_loose_cj` | ignored |
| `ja`, `ja-JP` | `line_normal` | `line_normal_cj` | `line` | `line_loose_cj` | `line_phrase_cj` (+ jaml model) |
| `ko` | `line_normal` | `line_normal_cj` | **open fails** (`U_FILE_ACCESS_ERROR`) → UI-locale default | `line_loose_cj` | `line_phrase_cj` |
| `""` (no locale) | UI language's default | (keyword dropped) | (dropped) | (dropped) | (dropped) |

- **"Chrome switches tables for Chinese"** is this: any locale that falls back to ICU `zh` or `zh_Hant` gets the CJ-normal rules without any keyword, for example "a”b" breaks after ”. Blink's own `MacrolanguageChineseLanguageTags` list (`layout_locale.cc:33-53`) only picks fonts; `cmn` and `yue` get root rules.
- **SA scripts.** The rules resolve `$SA` through dictionaries (`icu:source/data/brkitr/rules/line_normal.txt:87, 93`). The data ships `thaidict`, `laodict` (abridged), `khmerdict` (abridged, `khmer-dictbe.patch`), `burmesedict` and `cjdict`, without LSTM models (`icu:source/data/brkitr/root.txt:17-23`; `icu:README.chromium:143-193`; `strings icudtl.dat`).
  - Probe: `การทดสอบ` → break at 3; `ភាសា…` 9 code units → 5; `ພາສາລາວ` → 4; `မြန်မာဘာသာ` → no internal break.
- **Emoji ZWJ sequences.** LB8a (`$ZWJ [^$CM]`, `line_normal.txt:153-155`) and LB30b (`402-404`) keep `👩‍💻` and `👍🏽` together. Regional indicator pairs break between flags: probe `x🇯🇵🇺🇸` → 1, 5, 9.

#### F.4 The pair table (build time)

`LineBreakData` (`character_property_data_generator.cc:418-579`) generates `kFastLineBreakTable` for `last, current` in U+0021..U+00FF (`kMinChar='!'`, `kMaxChar=0xFF`, 574-575):
1. `FillFromIcu` (431-447): `pair[a][b] = createLineInstance("en").isBoundary(1)` on the two-character string. "en" → root `line_normal.brk`.
2. `FillAscii` (457-495) overwrites **every** pair with both characters in U+0021..U+007F:
   - all "no break"
   - break before `( < [ {` and after `-` and `?`
   - then no break for `-$`, before `! ) , . / : ; ? ] }`, and for `?"` and `?'`
   - no break after `$ ' ( / 0-9 < @ A-Z [ ^ _ \` a-z { DEL`
   - no break for `-` followed by `0-9`
3. Lookup: `GetFastLineBreak(a, b) = table[a-0x21][(b-0x21)/8] & (1 << ((b-0x21)%8))` (544-549).

Appendix A lists the resulting non-zero entries, from the probe using the installed Chrome 153 data.

#### F.5 `NextBreakablePosition` (`text_break_iterator.cc:267-387`)

```
function nextBreakablePosition(pos, len):                 // len ≤ text.length; the ICU iterator still covers text[start:]
  if type == BreakCharacter: return nextGraphemeBoundary(pos)   // below
  ctx.last = (pos > start) ? text[pos-1] : none (ch=0, not space)
  ctx.lastLast = (pos > start+1) ? text[pos-2] : 0            // 185-199
  nextBreak = 0
  if type == BreakAll: lastLB = lbClass(lastLast, last)        // 278-281
  for i = pos; i < len; i++, lastLast = last.ch, last = current:
    current = text[i]
    // (1) space rule. isSpace(c) = U+0020, U+0009, U+000A (text_break_iterator.h:203-205)
    if breakSpace == AfterSpaceRun:
       if isSpace(current): continue
       if isSpace(last): return i
    else: // AfterEverySpace
       if isSpace(last) || last == U+3000: return i
       if (isSpace(current) || current == U+3000) && i + 1 < len: return i + 1
    // (2) fast table
    fast = shouldBreakFast(last, lastLast, current)
    if fast == CanBreak: return i
    // (3) type-specific
    if type == BreakAll && !isLeadSurrogate(current):
       if strictness == Loose && current in {U+2010, U+2013} && lastLB in {NU, AL, SA, ID}: return i   // 319-327
       lb = lbClass(last, current)          // '+' → AL; a surrogate pair is combined (116-123)
       if breakAllTable(lastLB, lb) && !(lb == BA && current != '|' && strictness != Loose):
          return (i > pos && isTrailSurrogate(current)) ? i - 1 : i          // 330-333
       if lb != CM: lastLB = lb
    elif type == KeepAll && keepAll(lastLast, last, current): continue       // 338-343
    if fast == NoBreak: continue
    // (4) ICU (fast == Unknown)
    if nextBreak < i || nextBreak == 0:
       if i <= start: continue
       nextBreak = i - 1
       loop:
         f = icu.following(nextBreak - start)            // first ICU boundary > nextBreak
         if f == DONE: nextBreak = len; break
         nextBreak = f + start
         if !softHyphenEnabled && nextBreak > 0 && nextBreak <= len && text[nextBreak-1] == U+00AD: continue
         break
    if i == nextBreak && !isSpace(last): return i
  return len

function shouldBreakFast(last, lastLast, current):        // 216-260
  if last < U+0021 || current < U+0021: return NoBreak     // any C0 control or space on either side
  if last == '-':
     if current <= U+007F:
        if isAsciiDigit(current): return isAsciiAlnum(lastLast) ? CanBreak : NoBreak
     else: return Unknown                                  // '-' before non-ASCII: ICU decides
  if last <= U+00FF && current <= U+00FF:
     if !table(last, current): return NoBreak
     if !softHyphenEnabled && last == U+00AD: return NoBreak
     return CanBreak
  return Unknown

function keepAll(lastLast, last, current):                // 157-165, per UTF-16 code unit
  pre = (generalCategory(last) is M) ? lastLast : last
  return gc(pre) in L|N && lb(pre) != SA && gc(current) in L|N && lb(current) != SA

function isBreakable(k): len = min(k + 1, text.length); return nextBreakablePosition(k, len) == k   // text_break_iterator.h:185-194
function nextBreakOpportunity(k[, len]) = nextBreakablePosition(k, len or text.length)              // .cc:448-458
function previousBreakOpportunity(k, min):                                                            // .cc:460-484
  pos = min(k, text.length); end = min(pos + 2, text.length)
  while pos > min:
     if nextBreakablePosition(pos, end) == pos: return pos
     end = pos; pos = previous code point boundary (U16_BACK_1 in 16-bit text, pos-1 in 8-bit)
  return min

function nextGraphemeBoundary(pos):                        // .cc:419-430
  iter = grapheme iterator over text[start:]   (16-bit: ICU char.brk; 8-bit: every code unit except LF after CR, character_break_iterator.cc:106-154)
  n = iter.following(pos - start > 0 ? pos - start - 1 : 0)
  return n != DONE ? n + start : text.length
```

- **break-all class table**, decoded from `kBreakAllLineBreakClassTable` (`text_break_iterator.cc:48-110`, MSB-first bits, row = `lastLB`, column = `lb`). "Break" means an extra opportunity; 0 means "fall through", not "forbid":
  - rows AI, AL, BA, NU, SA, SY, HL: break before AI, AL, BA, HY, NU, OP, PR, SA, HL
  - row CL: AI, AL, BA, HY, NU, PR, HL
  - row CP: AI, AL, BA, HY, NU, PR, SA, HL
  - rows EX, PO: AI, AL, BA, HY, NU, PO, PR, HL
  - row IS: AI, AL, BA, HY, NU, HL
  - row HY: NU
  - row PR: PO
  - every other row (including ID, CJ, H2, H3, EB, EM, ZWJ, RI and the ICU 74/78 classes): none
  - Measured in installed Chrome 153 on 2026-09-16: U+2010 HYPHEN is class HH at ICU 78 (Unicode 17), not BA. In Chrome's `line_normal.brk` it shares an RBBI category with U+2013, which LineBreakTest 17.0 labels HH. So its break-all row is empty and the `lb == BA` exception doesn't apply. The loose rule in (3) tests the character and still breaks before U+2010 (`text_break_iterator.cc:315-327`). A break after the hyphen can come only from ICU, which restarts at each line start with no prior context (F.1), and `line_normal.txt:301` `^($HY | $HH) $CM* ($ALPlus | $HL);` (LB20a) forbids a break after a line-initial hyphen. `a‐b` with break-all + loose gives `a` / `‐b`, and `‐b` alone 1 line (H20). U+2013 behaves the same.
- **Worked examples** (text_content from `<div lang=en>`, start 0):
  - `"a )"` → space rule, break at 2 (before `)`).
  - `"x!é"` → table row `!`, column `é`: break at 2. `"x!a"`: no break.
  - `"ABCD-1234"` → break at 5. `"x -1"` → break at 2 only. `"é-1"` → none.
  - `"a-é"` → ICU: break at 2. `" -é"` → ICU: none at 2.
  - `"a b"` → ICU sees BK after U+2028 and reports a boundary; Blink does not read rule status, so it is an ordinary opportunity at 2 (probe: 0,2,3).
  - `"ab"` (NEL) → table row 85: break at 2.
  - `"a​b"` → ICU: break at 2. `"a⁠b"`: none.
  - `"foo⁧bar⁩ baz"` → no break around RLI/PDI; break at 9 (after the space).
  - `"$%"` with `word-break: break-all` → PR→PO in the break-all table: break at 1.

#### F.6 How the line breaker uses opportunities

- **Inside a text item** (`auto_wrap_` true): `BreakText` → `ShapingLineBreaker::ShapeLine` (`line_breaker.cc:1603-1759`).
  - `ShapingLineBreaker::PreviousBreakOpportunity` / `NextBreakOpportunity` use `break_iterator_` (`blink/platform/fonts/shaping/shaping_line_breaker.cc:174-209`).
  - They also compute `FindNonHangableEnd`, the start of the space run before the break. Spaces here are U+0020, TAB, LF and U+3000 (38-41, 72-83).
  - The result is **hyphenated** iff `text[break-1] == U+00AD` (211-225).
  - A break inside the item sets `can_break_after = true`. A break at the item end sets `can_break_after = CanBreakAfter(item)` (1737-1750).
- **`CanBreakAfter(item)`** (`line_breaker.cc:1210-1267`) = `IsBreakable(item.end)`, except:
  - after ruby-generated bidi controls, the check skips them (1224-1228)
  - if the next code unit is an atomic inline's U+FFFC, the answer is **true** without asking the iterator (1229-1248). Exceptions: the sticky-images quirk with NBSP, and text-combine.
- **`!auto_wrap_`** (nowrap, pre): the whole item is added and `can_break_after` stays false (1481-1503).
- **Open tag, nowrap → wrap**: `can_break_after` of the previous text result is recomputed under the new style (3997-4007).
- **Close tag** (4036-4073):
  - if the previous result can break after, the flag **moves** to the close tag
  - else, if the closed box was auto-wrap: `can_break_after = nextChar in {U+0020, U+0009} && (!ShouldBreakOnlyAfterWhiteSpace || prevChar in {U+0020,U+0009}) && !(LineBreakAfterSpaceBeforeOpenTag && next non-bidi item is an open tag)`
    - `ShouldBreakOnlyAfterWhiteSpace` = (preserve spaces && wrap) || `line-break: after-white-space` (`blink/core/style/computed_style.h:2326-2329`)
    - `LineBreakAfterSpaceBeforeOpenTag` is stable (`runtime_enabled_features.json5:3861-3862`)
  - else, if auto-wrap now and the previous char is not a space: `ComputeCanBreakAfter`
- **Bidi pop control** (PDF/PDI): takes over a true `can_break_after` from the previous result, else `auto_wrap && IsBreakable(end)` (3001-3041).
- **Atomic inline**: `can_break_after = auto_wrap && (end == text.length || (image && !stickyImagesQuirk) || not text-combine)` (1168-1208).
- **U+200B control**: always `can_break_after = true`, even under nowrap (2977-2987).
- **Forced break**: ends the line (2856-2940).
- **Min-content and phrase details** (`HandleTextForFastMinContent`, 1911-1995 and 2151-2365) re-seat the start offset; they are outside layout.

## 3. Arithmetic

- **Offsets** are `unsigned` UTF-16 code-unit indices. The iterator makes only integer comparisons:
  - `i == nextBreak`, `nextBreak < i || nextBreak == 0`, `i <= start_offset_`
  - `f < 0` → DONE
  - `i + 1 < len` (break-spaces)
  - `len = min(pos + 1, length)` in `IsBreakable` (`text_break_iterator.h:191`)
  - ICU positions are `int32_t` relative to `start_offset_` (`text_break_iterator.cc:360-379`)
- **No width enters any break-opportunity decision.** Fitting happens later (`inline_size <= available_width_with_hyphens`, `line_breaker.cc:1758`, with `AvailableWidthToFit() = available + 1/64`; see the line-fill spec and groundwork §5).
- **Letter and word spacing.**
  - `FontDescription::LetterSpacing()` and `WordSpacing()` are `float` (`blink/platform/fonts/font_description.h:328-332`).
  - `TextRunLayoutUnit(float)` = `saturated_cast<int32_t>(value * 65536)`, which truncates toward zero and saturates (`blink/platform/geometry/layout_unit.h:98-100, 127-128` in the 152 checkout; `shape_result_spacing.cc:14-17`).
  - The spacing is added to the advance of the last glyph of each HarfBuzz cluster, as a 16.16 integer add (`shape_result.cc:1026`).
  - Run width accumulates as `InlineLayoutUnit` (int64 16.16), and `width_` becomes float (1041-1044).
  - Example: `letter-spacing: 0.3px` → raw 19660 (0.29998779 px) per cluster.
- **Tabs** are measured separately: `Font::TabWidth(tab_size, position)` (`blink/platform/fonts/font.cc:303-350`). The flags `TabSizeWithSpacing`, `TabSizeAncestor` and `TabAlignmentWithFloats` are all stable (`runtime_enabled_features.json5:6172-6173, 6164-6165, 6133-6134`).

## 4. Runtime flags on at 153 that affect this topic

| flag | status | effect | source |
|---|---|---|---|
| `IgnoreLetterSpacingInCursiveScripts` | stable | no letter-spacing between cursive-script clusters, except on spaces | `runtime_enabled_features.json5:3593-3594`; `shape_result_spacing.cc:122-125` |
| `WordSpacingWhiteSpacePre` | stable | word-spacing on a space at text_content offset 0 in preserve-mode blocks | 7360-7361; `inline_node.cc:1563-1565` |
| `LineBreakAfterSpaceBeforeOpenTag` | stable | no break after a close tag before a space when an open tag follows | 3861-3862; `line_breaker.cc:4067-4068` |
| `ICUCapitalization` | experimental (off) | `capitalize` uses Blink's `Capitalize`, not ICU titlecasing | 3589-3590; `computed_style.cc:1981-1988` |
| `CSSLineClampLineBreakingEllipsis` | experimental (off) | — | 1746-1748 |
| `TabSizeWithSpacing`, `TabSizeAncestor`, `TabAlignmentWithFloats` | stable | tab stop width and origin | 6133-6173 |
| `CollapseZeroWidthSpaceWhenReuseItem`, `OffsetMappingReuseFullWidthSpaceFix` | stable | only when items are reused on relayout; fresh layout is unaffected | 1202-1203, 4397-4398; `inline_items_builder.cc:393-418` |
| `HarfRustShaping` | no status (off) | HarfBuzz C++ "ot" backend used | 3434 |
| `TextSpacingTrimFallback`, `TextSpacingTrimFallbackChws` | stable | Han kerning fallback | 6326-6339 |
| `LineBreakerHanKerningEnd` | stable (new in 153) | reshaping at Han-kerned line ends | 3865-3866; `shaping_line_breaker.cc:370-375` |
| `GraphemeClusterBoundsCheck` | stable | grapheme counting in `ForEachGraphemeClusters` | 3415-3416 |

## 5. What Canvas can supply

- **Break opportunities: nothing.**
  - Canvas has no line breaking. The port must implement F.4-F.5 plus ICU 78.2 with Chrome's data: the rule files in F.3, the dictionaries, `jaml`, and `char.brk` for graphemes.
  - Chrome-only shortcut, not verified here: `Intl.v8BreakIterator({type:'line'})` opens ICU line iterators from the same `icudtl.dat` (groundwork `research/blink-source.md` §1.5, V8 code read on 152). Its locale-keyword handling (`-u-lb-strict` against Blink's `@lb=strict`) and its lack of Blink's start-offset restart are open questions.
- **text_content, items, bidi controls, text-transform: nothing needed.** They are computable from DOM strings and computed styles. Uppercase and lowercase need ICU `CaseMap` with the element locale; JS `toLocaleUpperCase(locale)` in V8 uses ICU too, but equivalence is a hypothesis.
- **Exact totals for one shaping group**: `measureText(groupText).width` with the group's font gives exactly the DOM group's advance sum (at DPR 1) **only when all of these hold**:
  1. Canvas shapes the string as one HarfBuzz call. Canvas `PlainTextNode::SegmentWord` splits at U+0020, U+0009, U+200B (16-bit) and before CJK characters when `font.CanShapeWordByWord()` (`blink/platform/fonts/plain_text_node.cc:84-155, 377-400`). A group with spaces is split, so kerning or ligatures involving the space glyph are lost. The `CanShapeWordByWord` conditions come from the groundwork, not re-read.
  2. The same script segmentation. Canvas runs `RunSegmenter` on each word, and 8-bit words are Latin. The DOM runs it on the whole paragraph, where Common punctuation takes the neighbouring script (§2.D; PLATFORM_BUGS.md row "Canvas 2D context … Amiri").
  3. The same bidi. Canvas resolves bidi on the measured string alone (`plain_text_node.cc:285-353`). The DOM resolves it on the paragraph, with isolates from `dir`.
  4. No context-dependent shaping at the group edges. The DOM passes up to 5 code points of context to HarfBuzz (`hb-buffer.hh:109`); Canvas cannot. Arabic joining across a span with a different font cannot be reproduced by measuring the span alone. Candidate workaround (H29): add U+200D ZWJ on the joining side.
     - Measured in installed Chrome 153 on 2026-09-16: the workaround fails in an LTR context. With Noto Naskh Arabic, W(`ب` + ZWJ) = W(`ب`) = 30.8799896 (isolated), while the DOM's first ب is 11 (initial). With `ctx.direction = 'rtl'` it gives 11, and `ب` + ZWJ + `ب` gives the joined pair (43.6799927). `PlainTextNode` shapes each bidi run alone (`plain_text_node.cc:285-318`); [I] at paragraph level LTR the trailing ZWJ forms its own run under UAX #9 L1. Measure a joining form with `direction = 'rtl'`, or with the ZWJ between two Arabic letters (H29).
  5. The same characters. Canvas turns TAB, LF, VT, FF and CR into U+0020, and SHY, ZWSP, LRM, RLM, LRE-RLO, ZWNBSP and U+FFFC into U+200B (`plain_text_node.cc:47-60`; `character.h:167-175, 226-238`). In the DOM:
     - CR in collapse modes is a space, so Canvas matches
     - FF and VT in collapse modes are real characters (H5, H6), so **Canvas cannot supply them**
     - CR and FF in preserve modes are zero-width control items: measure the string without them
  6. The same letter- and word-spacing index rules. Canvas applies spacing with `text_start_offset` = the word's offset in the measured string (`plain_text_node.cc:402-425`). A space at offset 0 of the measured string gets no word-spacing, while the DOM uses its paragraph offset. Measure with a non-space prefix and subtract, or add `wordSpacing` by hand.
  7. Font size and locale: DPR/zoom and `lang` (other specs; groundwork §4.4).
- **Ligatures under letter spacing.** Source says Canvas `letterSpacing` also turns `liga`, `clig` and `calt` off in Chrome: `SetLetterSpacing` rebuilds the `Font` with `SetLetterSpacing` (`blink/modules/canvas/canvas2d/canvas_rendering_context_2d_state.cc:871-907`), and features come from the description (`font_fallback_list.cc:226-230`; `font_features.cc:63-86`). The maintainer's "Canvas letterSpacing keeping ligatures" gap may be another engine's, or a path with a null selector (`SetFontInternal` runs only `if (selector)`, 904-906). See H27.
- **Width facts Canvas cannot supply for this topic:**
  - where HarfBuzz marks unsafe-to-break
  - which fallback font takes a cluster
  - the width of FF, VT or other C0 controls as DOM text

## 6. Hypotheses to probe in installed Chrome 153

Common harness: `<!doctype html><html lang="en"><body style="margin:0">`. Lines are counted with `Math.round(el.getBoundingClientRect().height / 20)` on `<div id=t style="font:16px/20px 'Helvetica Neue'; width:0">`. With `width:0`, every break opportunity ends a line, so lines = opportunities taken + 1. Text containing control characters is set with `t.firstChild.data = ...`. Widths are `span.getBoundingClientRect().width` of an inline `<span>` in an unconstrained div. "Expected" is what the source predicts.

1. **Span edge, no break.** `foo<b>bar</b>` in `#t` → 1 line. `foo <b>bar</b>` → 2 lines. `foo<span lang=zh>bar</span>` → 1 line.
2. **Kerning inside a group.** 48px Helvetica Neue: width(`<span>A</span><span style="color:red">V</span>`) == width(`<span>AV</span>`). width(`<span>A</span><span style="letter-spacing:0.01px">V</span>`) == width("A") + width("V" with 0.01px spacing), with no kern. width(`A<span style="padding-left:0.001px">V</span>`) ≥ width("A")+width("V").
3. **Arabic joining across a font change.** 40px Geeza Pro: `ب<b>ب</b>` draws joined forms. Its width equals width(initial ب) + width(bold final ب) and differs from width("ب") + width(bold "ب") measured in separate paragraphs.
   - Measured in installed Chrome 153 on 2026-09-16 (refuted for Geeza Pro): 55.90625 = isolated + bold isolated, not initial + bold final 55.6875. The OpenType font Noto Naskh Arabic gives 43.6875 = initial + bold final. See the §2.E note.
4. **CR collapses.** Normal white-space, data `"a\rb"` → 2 lines in `#t`, and span width == width of `"a b"`. `white-space:pre-line` → 2 lines. `white-space:pre-wrap` → 1 line, width == width("ab").
5. **FF is literal in normal mode.** data `"a\fb"` in `#t` → 1 line (no opportunity next to a char < U+0021). Width ≠ width("a b") and ≥ width("ab"); the exact value is unknown from source. `pre-wrap` → 1 line, width == width("ab").
6. **VT is literal in every mode.** data `"a\vb"` → 1 line in normal and in pre-wrap. Width in pre-wrap ≠ width("ab") unless the fallback glyph has zero advance.
7. **A whitespace-only text node after a text node ending in FF is dropped.** Build `#t` from JS: `t.append("a\f", "\n", Object.assign(document.createElement("span"), {textContent: "b"}))` → 1 line (no collapsed space, and no opportunity next to FF). Control: `t.append("a", "\n", span)` → 2 lines ("a b").
8. **Same with VT** (`IsAsciiSpace` includes U+000B): `t.append("a\v", "\n", span)` → 1 line. Control: put the FF text inside an element instead, `t.append(spanContaining("a\f"), "\n", span)` → 2 lines. After an element, `previousInFlow` is its `LayoutInline`, so the whitespace node is kept and becomes a collapsed space.
9. **ZWSP swallows a segment break.** `<span>a&#x200B;\nb</span>` width == width("a​b") == width("ab"). `<span>a\nb</span>` width == width("a b").
10. **Space rule beats UAX #14.** `a )` in `#t` → 2 lines.
11. **Latin-1 table divergence.** `x!é` → 2 lines; `x!a` → 1 line; `x/é` → 2 lines; `x/a` → 1 line.
12. **NEL is a soft break.** data `"ab"`: `#t` → 2 lines; at width 1000px → 1 line.
13. **U+2028 is a soft break drawn as a space.** data `"a b"`: width 1000px → 1 line; `#t` → 2 lines. Unconstrained span width == width("a b").
14. **Chinese table switch.** `a”b` (U+201D) in `#t`: `lang=en` → 1 line; `lang=zh`, `zh-TW` or `zh-HK` → 2 lines; `lang=ja` → 1 line; `lang=ja` + `line-break:normal` → 2 lines; `lang=cmn` → 1 line.
15. **No locale means the UI language.** A page with no `lang` anywhere and `a”b` in `#t` → 2 lines if Chrome's UI language is Chinese (this Mac: zh-Hans per the groundwork oracle), else 1 line.
16. **Strictness needs a locale.** `あぁ` in `#t` with `line-break:strict`: `<html lang=en>` → 1 line (CJ→NS). No `lang` anywhere → 2 lines (keyword dropped).
17. **Korean strict falls back.** `<div lang=ko style="line-break:strict">あぁ</div>` in `#t` → 2 lines. `lang=ja` strict → 1 line.
18. **Loose.** `lang=en`, `line-break:loose`, `あ々` → 2 lines; with `line-break:auto` → 1 line. `一‥‥` → 2 lines in loose, 1 line in auto.
19. **keep-all per code unit.** `word-break:keep-all`: `一一` → 1 line; `𠀀𠀀` (U+20000 ×2) → 2 lines; `한국어` → 1 line; `ภาษาไทย` → 2 lines (SA excluded, dictionary break at 4).
20. **break-all loose hyphen.** `lang=en`: `a‐b` (U+2010) with `word-break:break-all; line-break:loose` → 3 lines; with `break-all` alone → 2 lines (break after ‐ only).
    - Measured in installed Chrome 153 on 2026-09-16 (refuted): break-all + loose gives 2 lines, `a` / `‐b`; break-all alone `a‐` / `b`; `‐b` alone 1 line with or without loose. See the F.5 note: U+2010 is class HH, and LB20a forbids a break after a hyphen at the start of a line.
21. **break-all PR→PO.** `$%` in `#t` with `word-break:break-all` → 2 lines; `word-break:normal` → 1 line.
22. **wbr inside nowrap.** `<div id=t style="white-space:nowrap">foo<wbr>bar</div>` → 2 lines.
23. **nowrap→wrap generated opportunity.** `<div id=t><span style="white-space:nowrap">foo </span> bar</div>` → 2 lines, and the second line starts with "bar" (b's left == 0).
24. **Atomic inlines break on both sides.** `abc<img style="width:10px;height:10px">def` in `#t` → 3 lines; `abc&nbsp;<img …>` → 2 lines.
25. **Soft hyphen.** `super&shy;cali` in `#t` → 2 lines with a hyphen drawn; with `hyphens:none` → 1 line.
26. **Emoji sequences.** `👩‍💻👩‍💻` in `#t` → 2 lines, also with `word-break:break-all` and `keep-all`. `x🇯🇵🇺🇸` → 3 lines.
27. **Letter spacing turns ligatures off in DOM and Canvas.** 48px Times: DOM width of `fi` with `letter-spacing:0.001px` == width("f")+width("i")+2×0.001 (±1/64). Canvas `ctx.letterSpacing="0.001px"; measureText("fi")` gives the same, not the ligature width.
28. **Canvas normalizes controls.** `measureText("a\fb") == measureText("a b")`, and likewise for `\v` and `\r`. `measureText("a­b") == measureText("ab")`.
29. **ZWJ as joining context in Canvas.** 40px Geeza Pro: `measureText("ب‍")` equals the DOM width of the first ب in `<span>ب</span><b>ب</b>`.
    - Measured in installed Chrome 153 on 2026-09-16 (refuted): Geeza Pro matches (W 25.5876923 vs DOM 25.59375) only because its initial and isolated ب have the same advance. Noto Naskh Arabic: DOM first ب 11, Canvas W(`ب` + ZWJ) 30.8799896 (isolated); with `ctx.direction = 'rtl'` 11. See the §5 item 4 note.
30. **Word spacing at paragraph offset 0.** `word-spacing:10px` on the span.
    - `<div style="white-space:pre-wrap"><span style="word-spacing:10px"> a</span></div>`: a's left == width(" ") + 10, because the block preserves spaces and `WordSpacingWhiteSpacePre` is stable.
    - `<div style="white-space:normal"><span style="white-space:pre-wrap; word-spacing:10px"> a</span></div>`: a's left == width(" "). The block style does not preserve spaces, and the space is at text_content offset 0.
31. **Uppercase changes measured text.** `<span style="text-transform:uppercase">ß</span>` width == width("SS"). In `#t`, `ßß` uppercase → 1 line.
32. **full-width collapses to U+3000.** `<span style="text-transform:full-width">a  b</span>` width == width("ａ　ｂ"). In `#t` → 2 lines (break after U+3000).
    - Measured in installed Chrome 153 on 2026-09-16 (refuted): `full-width` isn't supported (computed `none`). The span is 22.53125 (plain `a b`), and the 2 lines come only from the space. See the §2.B note.
33. **break-spaces.** `white-space:break-spaces`, `a  b` in `#t` → 3 lines ("a ", " ", "b"); `a　b` (U+3000) → 2 lines.
34. **ICU restarts at the line start.** `<div lang=en style="font:16px 'Thonburi'; width:Wpx">การทดสอบ</div>`: at a width that ends the first line after `การ`, the second line is `ทดสอบ` with no further internal break. Pick W between width("การ") and width("การท").
35. **CR/FF control items in pre-wrap block breaks.** data `"a \rb"` in `#t` with pre-wrap → 2 lines (the break is after the space, before CR), and the CR adds zero width.
36. **Close-tag break before a space.** `<div id=t style="white-space:pre-wrap"><span>foo</span> bar</div>` → 2 lines, with "foo " on line 1 (break only after the space).
37. **`lang` on a span changes breaks inside it only.** `<div lang=en id=t>a<span lang=zh>”b</span></div>` → 2 lines ("a”", "b"). `<div lang=zh id=t>a<span lang=en>”b</span></div>` → 1 line.

## 7. Differences from the groundwork (`research/blink-source.md`, Chromium 152) that I verified

- **Confirmed unchanged at 153:**
  - space rule (§1.2)
  - pair table generation and `-`+digit rule (§1.3)
  - ICU consulted from the line start with no prior context, pool of 4 (§1.4)
  - keep-all and break-all code (§1.6)
  - shaping group rules (§2.1)
  - letter/word spacing (§2.6)
  - Canvas space normalization (§4.3)
  - The cited line numbers in `text_break_iterator.cc/.h`, `text_break_iterator_icu.cc` and `character_property_data_generator.cc` still match.
- **Rule-file table (§1.5) verified by running ICU with the installed Chrome 153 data**, including the predicted `ko@lb=strict` failure (`U_FILE_ACCESS_ERROR`). New facts:
  - `zh-CN`, `zh-Hans`, `zh-TW` and `zh-HK` resolve to `zh`/`zh_Hant` and get CJ-normal rules.
  - `cmn` and `yue` get root rules.
- **New: keywords are dropped when there is no locale.** The iterator's locale string is empty, so `line-break: strict|normal|loose` and `word-break: auto-phrase` have no effect without `lang` or Content-Language (`text_break_iterator.h:276-277`). The groundwork said a null locale opens the UI language, but not that the keywords are dropped.
- **New: CR is a collapsible space** (`character.h:150-153`). FF is kept as a literal character in collapse modes, and CR and FF become zero-width control items without break opportunities in preserve modes (`inline_items_builder.cc:164-184, 1119-1125`; `line_breaker.cc:2988-2994`). The groundwork listed only LF, tab and ZWSP as control items.
- **Nuance on the single Latin segment** (groundwork §2.1): the condition is `(Is8Bit || no non-ORC 16-bit character) && !is_bidi_enabled` (`inline_node.cc:1256-1266`), so 16-bit text whose only character above U+00FF is U+FFFC is also one Latin segment.
- **Nuance on word spacing** (groundwork §2.6): `allow_word_spacing_anywhere` is true for blocks with preserved white space, through the stable `WordSpacingWhiteSpacePre` (`inline_node.cc:1561-1565`).
- **Context across shaping calls, new:** HarfBuzz receives 5 code points of context from text_content, and the Arabic shaper uses it (`hb-buffer.hh:109`; `hb-ot-shaper-arabic.cc:305-360`). The groundwork mentioned pre- and post-context but not that joining crosses font changes.
- **New: close-tag and open-tag transfer of `can_break_after`** (`line_breaker.cc:3997-4007, 4036-4073`), and the unconditional break next to atomic inlines (1229-1248, 1168-1208).
- **Version inputs.** The 153 ICU revision differs from 152 but its break data is unchanged. HarfBuzz moved from 14.2.1-37 (`28f4dc62`) to `dfdc088c` (after 14.3.1). The groundwork's HarfBuzz citations (`hb-ot-shape.cc`) are still valid; other HarfBuzz files were not diffed. The log includes GPOS mark-attachment and kern changes that a shaping spec should check.
- **Groundwork line numbers for `line_breaker.cc`** came from 152 HEAD. Relative to 153 they are unchanged up to 3856 and +1 after it.

## Appendix A. Blink's Latin-1 pair table (Chrome 153 data)

These are the pairs (`last` row, `current` columns, hex) where `GetFastLineBreak` says "can break". All other pairs in U+0021..U+00FF say "no break".
- Rows below U+0080 with columns below U+0080 come from `FillAscii` only. `2D` and `3F` break before all printable ASCII except `! ) , . / : ; ? ] }`, and `2D` also except `$ 0-9`, `3F` also except `" '`.
- `-` followed by a character above U+007F is not looked up; ICU decides.
- Generated with `scratchpad/icuprobe/probe latin1`.

ASCII × ASCII:
```
21 22 23 25 26 29 2A 2B 2C 2E 3A 3B 3D 3E 5C 5D 7C 7D 7E: 28 3C 5B 7B
2D: 22-23 25-28 2A-2B 2D 3C-3E 40-5C 5E-7C 7E-7F
3F: 23-26 28 2A-2B 2D 30-39 3C-3E 40-5C 5E-7C 7E-7F
```
Pairs involving U+0080..U+00FF (from ICU root `line_normal.brk`):
```
21 2F 3F 7D: A1-AA AC AE-BA BC-FF
7C: A0-AA AC AE-BA BC-FF
24 25 29 2B 2C 2E 3A 3B 5C 5D: A1-A5 B0-B1 B4 BF
2D: A0-A5 B0-B1 B4 BF        (not consulted for current > 7F; ICU is used)
23 26 2A 30-39 3C-3E 40-5A 5E-7A 7E-7F 80-84 86-9F A6-AA AC AE AF B2 B3 B5-BA BC-BE C0-FF: B4
(rows 22 27 28 5B 7B A0 A1 AB B4 BB BF have no "can break" entry with a non-ASCII column)
85: 21-FF
A2 A3 A4 A5 B0 B1: 24-25 28 2B 5B-5C 7B A1-A5 B0-B1 B4 BF
AD: 23-26 28 2A-2B 30-39 3C-3E 40-5C 5E-7B 7E A0-AA AC AE-BA BC-FF
```
(U+00B4 ACUTE ACCENT is class BB, so a break is allowed before it; U+0085 NEL is class NL; U+00AD SHY is class BA.)

## Appendix B. ICU probe, selected results (Chrome 153 `icudtl.dat`)

Boundaries are UTF-16 offsets as returned by `BreakIterator::first/next` on the whole string. The start (0) and end are included.

| string | en | zh | ja | ja@lb=normal | en@lb=strict | en@lb=loose |
|---|---|---|---|---|---|---|
| `a“b` | 0,3 | 0,3 | 0,3 | 0,3 | 0,3 | 0,3 |
| `a”b` | 0,3 | 0,2,3 | 0,3 | 0,2,3 | 0,3 | 0,3 |
| `あー` | 0,1,2 | 0,1,2 | 0,1,2 | 0,1,2 | 0,2 | 0,1,2 |
| `あぁ` | 0,1,2 | 0,1,2 | 0,1,2 | 0,1,2 | 0,2 | 0,1,2 |
| `あ々` | 0,2 | 0,2 | 0,2 | 0,2 | 0,2 | 0,1,2 |
| `あ〜` | 0,2 | 0,1,2 | 0,2 | 0,1,2 | 0,2 | 0,2 |
| `一……` | 0,3 | 0,3 | 0,3 | 0,3 | 0,3 | 0,2,3 |

Other (`en`): `a b` 0,2,3; `a​b` 0,2,3; `a⁠b` 0,3; `👩‍💻x` 0,5,6; `👍🏽x` 0,4,5; `a￼b` 0,1,2,3; `一一。一` 0,1,3,4; `a　b` 0,2,3; `foo‐bar` 0,4,7; `a-é` 0,2,3; ` -é` 0,1,3; `é-1` 0,3; `𠀀𠀀` 0,2,4. `ko@lb=strict`: open fails with `U_FILE_ACCESS_ERROR`. `ja@lw=phrase` on `日本語の文章です`: 0,4,8.
