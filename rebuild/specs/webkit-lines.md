# WebKit line filling and units (Safari 27.0, WebKit-7625.1.29.11.27)

Scope: how Safari 27.0 puts horizontal inline text into lines once the text items and their break positions exist. That covers which line builder runs, how widths are measured and summed, the fit test, emergency splits, the carried remainder, trailing white space, soft hyphens, letter and word spacing, tabs, what width a line reports, and how zoom and device pixel ratio enter. Break-opportunity data (BreakablePositions, ICU line rules) belongs to another spec; this one only says where break positions are consumed.

Source: sparse checkout `~/github/browser-engines/webkit-7625.1.29.11.27` at tag `WebKit-7625.1.29.11.27` (commit `2756e8be`, "Cherry-pick 86e957015e02"). Every `path:line` below is at that checkout. No browser was launched.

Path prefixes:
- `IL/` = `Source/WebCore/layout/formattingContexts/inline/`
- `G/` = `Source/WebCore/platform/graphics/`
- `LI/` = `Source/WebCore/layout/integration/`
- `ST/` = `Source/WebCore/style/`
- `R/` = `Source/WebCore/rendering/`
- `C/` = `Source/WebCore/html/canvas/`
- `WTF/` = `Source/WTF/wtf/`
- `PREFS` = `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`

Tags: **[V]** read in the pinned source. **[I]** inferred, not checked. **[G]** measured by the groundwork on Safari 26.x or headless WebKit 26.4, not on 27.0.

## 0. Terms

- **f32**: an IEEE float32 value. In TypeScript every add, subtract, multiply and divide on these values must be wrapped in `Math.fround`.
- **LU** (LayoutUnit): an int32 counting 1/64 CSS px (`G/../LayoutUnit.h` = `Source/WebCore/platform/LayoutUnit.h:63-64`).
- **Inline item**: one entry of the flat list the engine builds from the box tree: a text item, a soft line break (preserved `\n`, U+2028, U+2029), a `<br>`, a `<wbr>`, an inline box start (`<span>`), an inline box end (`</span>`), an atomic inline, a float, an out-of-flow box (`IL/InlineItemsBuilder.cpp:318-381`).
- **Text item**: a range `[start, end)` of one text node's content (`IL/InlineTextItem.h:44-46`). It is one of:
  - a *whitespace item*: a run of U+0020, plus TAB, plus LF when LF is not preserved (`IL/InlineItemsBuilder.cpp:54-73`);
  - a *non-whitespace item*: text up to the next break position (`:1012-1038`);
  - a one-character NBSP item, only with `-webkit-nbsp-mode: space` (`:993-1011`).
- **Stored width**: the f32 width saved on a text item when it is created (`IL/InlineTextItem.h:55`). An item may have none, in which case it is measured when placed.
- **Candidate content**: the items between two soft wrap opportunities, which the builder tries to put on the line as one unit. Its engine type is `ContinuousContent` (`IL/InlineContentBreaker.h:73-147`).
- **Run** (inside a candidate): one item plus `offset` (word-spacing before it) and `contentWidth`; `spaceRequired = offset + contentWidth` (`IL/InlineContentBreaker.h:108-126`).
- **Line run**: an entry of `Line::m_runs` with `logicalLeft` and `logicalWidth` (`IL/InlineLine.h:93-226`).
- **Wrap opportunity list**: the items on the current line after which the line could end (`m_wrapOpportunityList`, reset per line at `IL/AbstractLineBuilder.cpp:46-52`).
- **Available width**: remaining room on the line, defined in §1.4.
- **Carried remainder**: the width given to the rest of a split word on the next line without measuring it again (§7).
- **M(s)**: `OffscreenCanvasRenderingContext2D.measureText(s).width` with the same font string.

## 1. Units and exact arithmetic

### 1.1 Types [V]

- `InlineLayoutUnit` is `float` because `USE_FLOAT_AS_INLINE_LAYOUT_UNIT` is 1 (`Source/WebCore/layout/LayoutUnits.h:39-42`). `InlineRect` stores a `FloatRect` (`IL/InlineRect.h:102`). Every width inside inline layout is f32.
- `LayoutUnit` holds `int m_value` in 1/64 px (`platform/LayoutUnit.h:63-64`).
  - `LayoutUnit(double v)` gives `m_value = clampTo<int>(v * 64)` (`:83-86`). `clampTo` for a floating source is `static_cast<int>`, i.e. truncation toward zero (`WTF/MathExtras.h:219-231`). A float argument is promoted to double first.
  - `toFloat()` gives `m_value / 64` as float (`:118`), which is exact for any realistic width.
  - `epsilon()` is `1.0f / 64` (`:190`).
- Glyph advances come from CoreText as CGFloat, but `GlyphBuffer` widths are read as float and `WidthIterator::m_runWidthSoFar` is float (`G/WidthIterator.cpp:470-485`). `ComplexTextController::totalAdvance()` is a FloatSize (`G/FontCascade.cpp:365`). So every measured width is f32.

### 1.2 The available line width comes from an LU

1. A specified CSS length evaluates as `LayoutUnit(m_floatValue * zoom)` (`ST/values/primitives/StylePrimitiveData.h:299-306`), reached from `RenderBox::computeLogicalWidthUsingGeneric` (`R/RenderBox.cpp:3109-3112`). Truncation: `width: 100.3px` → `100.3f * 64 = 6419.2` → raw 6419 → 100.296875px.
2. The inline formatting context receives `HorizontalConstraints { logicalLeft: LU, logicalWidth: LU }` (`Source/WebCore/layout/formattingContexts/FormattingConstraints.h:34-39`). `logicalWidth = rootRenderer->contentBoxWidth()` (`LI/LayoutIntegrationBoxGeometryUpdater.cpp:787-822`, at `:808`).
3. Each line starts from `InlineRect { top, constraints.horizontal().logicalLeft, constraints.horizontal().logicalWidth, lineHeight }` (`IL/InlineFormattingContext.cpp:317`), i.e. `lineWidth = rawLU / 64` as f32.
4. `LineBuilder` subtracts float intrusions and `text-indent` from that rect (`IL/InlineLineBuilder.cpp:453-478`). `TextOnlySimpleLineBuilder` uses it unchanged (`IL/TextOnlySimpleLineBuilder.cpp:159`); it only runs without text-indent and without floats (§2).

### 1.3 Conversions to LU inside inline layout

On the line-filling path nothing is converted back to LU. The conversions that do exist:
- intrinsic sizes: `ceiledLayoutUnit` = `LayoutUnit::fromFloatCeil` (`IL/InlineFormattingContext.cpp:194, 238, 245, 273`; `layout/LayoutUnits.h:140-143`);
- float-avoidance queries: `LayoutUnit { lineLogicalTop }` (`IL/InlineFormattingUtils.cpp:190-191`), vertical only.

### 1.4 Available width and the fit tests [V]

TextOnlySimpleLineBuilder (`IL/TextOnlySimpleLineBuilder.cpp:481-486`):
```ts
availableWidth() = fround(fround(lineWidth + (intrinsicMode === 'min' ? 0 : 1/64)) - (isNaN(line.contentLogicalRight) ? 0 : line.contentLogicalRight))
```
LineBuilder (`IL/InlineLineBuilder.cpp:1172-1183`, called at `:1445-1452`):
```ts
function availableWidth(line, lineWidth, intrinsicMode) {
  if (!intrinsicMode || intrinsicMode === 'max') lineWidth = fround(lineWidth + 1/64)
  const w = fround(lineWidth - line.contentLogicalRight)
  return isNaN(w) ? F32_MAX : w
}
```
Here `lineWidth` is `constraints.logicalRect.width()`, or a `text-wrap: balance|pretty` override minus text-indent (`:1447-1450`). `line.contentLogicalRight` is the right edge of the last line run (`IL/InlineLine.h:71, 254`), not the maximum content width.

Example: `width: 100.3px`, empty line. `lineWidth` = 100.296875, available = 100.3125. Content of f32 width 100.3125 fits; 100.31251 does not.

Every comparison on the line-filling path:

| Where | Test | Citation |
| --- | --- | --- |
| Simple builder, fast commit | `candidate.logicalWidth <= availableWidth()` and no leading partial item | `IL/TextOnlySimpleLineBuilder.cpp:318` |
| Simple builder, slow path | breaker runs only if `cc.logicalWidth() > availableWidth` | `:349` |
| LineBuilder | breaker runs only if `continuousContent.logicalWidth() > available` | `IL/InlineLineBuilder.cpp:1466-1467` |
| Breaker, trimmed fit | `logicalWidth - trailingTrimmable [- leadingTrimmable] <= available` | `IL/InlineContentBreaker.cpp:174-178` |
| Breaker, hanging fit | `logicalWidth - hangingWidth <= available` | `:183-186` |
| Breaker, overflowing run | first run with `nonOverflowing + spaceRequired > available` | `:828-833` |
| Breaker, room for mid-word split | `availableWidth > 0`, where `availableWidth = max(0, available - nonOverflowing)` | `:508, 650` |
| Soft hyphen after Wrap | `trailingSoftHyphenWidth > available` means revert | `:117-118` |
| breakWord bisection | `w < avail` goes right; `w > avail` goes left; `==` stops | `IL/text/TextUtil.cpp:337-346` |
| breakWord grapheme scan | stop when `w > avail` | `:358-359` |
| Simple builder hyphen revert | `hyphenWidth <= availableWidth()`, with epsilon | `IL/TextOnlySimpleLineBuilder.cpp:466-470` |
| LineBuilder hyphen revert | `hyphenWidth <= lineRect.width() - contentLogicalRight`, **no epsilon** | `IL/InlineLineBuilder.cpp:1873-1876` |
| Line end, overflow flag | `lineRect.width() < contentLogicalWidth`, no epsilon | `:640-642`; `IL/TextOnlySimpleLineBuilder.cpp:428, 431` |
| Conditional hanging | `contentLogicalWidth <= lineWidth`, no epsilon | `IL/InlineLine.cpp:214-220` |

All operands are f32. Because every quantity is exact in f32 and `lineWidth` is an exact multiple of 1/64, a port that keeps f32 at every step needs no other tolerance.

### 1.5 Summing order

- Simple builder candidate width: `logicalWidth += itemWidth`, one item at a time in f32 (`IL/TextOnlySimpleLineBuilder.cpp:45-55`).
- ContinuousContent: `m_logicalWidth = clampTo<float>(m_logicalWidth + offset + contentWidth)` (`IL/InlineContentBreaker.cpp:923-927`). C++ evaluates this as `(m_logicalWidth + offset) + contentWidth`, both steps f32.
- Line: a new run's `logicalLeft = lastRunLogicalRight + (isWordSeparator ? wordSpacing : 0)` and `contentLogicalRight = logicalLeft + width` (`IL/InlineLine.cpp:406-415`). Expanding an existing run gives `m_logicalWidth += width` (`:891-899`); its right edge is `logicalLeft + logicalWidth` (`IL/InlineLine.h:142`). This grouping differs from a flat running sum, and a port must reproduce it: keep `left` and `width` per run and merge the same way as `needsNewRun` (§6.2).

### 1.6 Device pixel ratio and zoom [V]

- No inline line-breaking code reads the device scale factor. Across `IL/`, `LayoutIntegrationLineLayout.cpp` and `LayoutIntegrationUtils.cpp`, `deviceScaleFactor` appears only for outline ink overflow (`IL/display/InlineDisplayContentBuilder.cpp:154, 182`). LU precision is 1/64 CSS px at any DPR (`platform/LayoutUnit.h:63-64`).
- DPR reaches line widths only through box sizes. Border widths are snapped to device pixels: lengths below one device pixel become one device pixel, others are floored to device pixels (`ST/values/backgrounds/StyleLineWidth.cpp:46-61`). `border-left: 0.7px` therefore gives a 1px border at DPR 1 and a 0.5px border at DPR 2, which changes `contentBoxWidth`.
- Page zoom sets the root style's zoom (`ST/StyleResolveForDocument.cpp:64`). Lengths evaluate as `value * zoom` before the 1/64 truncation (`ST/values/primitives/StylePrimitiveData.h:305`). The font's computed size includes the zoom factor (`ST/StyleFontSizeFunctions.cpp:45-...`, `zoomedSize = specifiedSize * zoomFactor`). Letter- and word-spacing evaluate with `usedZoomForLength()` (`ST/computed/StyleComputedStyleBase.cpp:312-371`). Under page zoom Z, layout is the unzoomed algorithm with every CSS length and font size multiplied by Z. A Canvas font string must then carry the zoomed size [I: OffscreenCanvas resolves fonts from a fresh description with no document zoom, `C/OffscreenCanvasRenderingContext2D.cpp:115-121`].
- `SubpixelInlineLayoutEnabled` (default true, `PREFS:8160-8172`) only chooses float or integer ascent/descent for vertical metrics (`IL/InlineFormattingUtils.cpp:650-680`). It has no horizontal effect.

## 2. Which line builder runs

Every block container with inline children uses the modern inline formatting context. `canUseForLineLayout` returns true except for SVG text (`LI/LayoutIntegrationCoverage.cpp:338-343`; `R/RenderBlockFlow.cpp:1128-1146`). `InlineFormattingContext::layout` then picks one of three builders (`IL/InlineFormattingContext.cpp:170-184`):

```ts
if (simpleByContent(items, placedFloats) && simpleByStyle(root)) return TextOnlySimpleLineBuilder
if (rangeBasedEligible(ctx, needsLayoutRange, items, placedFloats)) return RangeBasedLineBuilder
return LineBuilder
```

`simpleByContent` (`IL/TextOnlySimpleLineBuilder.cpp:488-497`) requires all of:
- items not empty;
- text and forced line breaks only, and no inline boxes (`hasInlineBoxes`);
- no content that needs visual reordering (`requiresVisualReordering`);
- no `text-autospace` on an inline box (`m_hasTextAutospace`, set only at `IL/InlineItemsBuilder.cpp:1057`);
- no placed floats.

`requiresVisualReordering` is true for a text node containing a strong RTL, RLE/LRE, RLO/LRO or PDF character (`IL/InlineItemsBuilder.cpp:231-240`; `R/RenderText.cpp:522`; `IL/text/TextUtil.cpp:486-515`), or for an in-flow inline box with `direction: rtl` or with `unicode-bidi` other than normal. Hebrew or Arabic anywhere in the paragraph therefore selects LineBuilder.

`simpleByStyle` (`IL/TextOnlySimpleLineBuilder.cpp:499-528`) requires, on the root style and on its first-line style:
- `word-spacing` of 0;
- `direction: ltr`;
- `word-break` other than `auto-phrase`;
- initial `text-indent`;
- no `text-align: justify`, no `text-align-last: justify`, not `display: ruby-text`;
- `box-decoration-break` other than `clone`;
- `hanging-punctuation: none`;
- `hyphenate-limit-lines: no-limit`;
- no `text-wrap-style: balance|pretty` while wrapping;
- no `line-align` or `line-snap`.

`rangeBasedEligible` (`IL/RangeBasedLineBuilder.cpp:131-184`) requires all of:
- a full layout;
- exactly one inline box, and it wraps every item (`<div><span>text</span></div>`), or the paragraph is inline boxes only;
- that box has no horizontal margin, border or padding, no negative margins, and initial `box-decoration-break`;
- no line clamp;
- the nested content passes `simpleByContent`, the box's `text-align` equals the root's, and both styles pass `simpleByStyle`.

RangeBasedLineBuilder then runs the simple builder on the items inside the span and adds the span's start and end runs around the result (`IL/RangeBasedLineBuilder.cpp:85-128`). Line breaking is exactly the simple builder's.

**Structural differences between the builders that change results** [V]. Probes are in §12.
1. Soft hyphen in the fit test. LineBuilder adds the hyphen width to a candidate that ends in a soft hyphen before testing fit (`IL/InlineLineBuilder.cpp:1154-1165`; `IL/InlineContentBreaker.cpp:917-921`). The simple builder does not (`IL/TextOnlySimpleLineBuilder.cpp:244, 318`); it checks the hyphen only when the next content fails to fit (`IL/InlineContentBreaker.cpp:114-120`).
2. The "revert until a hyphen fits" loop. LineBuilder compares without the 1/64 epsilon and never tests index 0, falling back to the first opportunity (`IL/InlineLineBuilder.cpp:1868-1886`). The simple builder compares with the epsilon and accepts index 0 unconditionally (`IL/TextOnlySimpleLineBuilder.cpp:459-479`).
3. The pen position passed to position-dependent measurement (tabs). The simple builder uses `line.contentLogicalRight + candidateWidthSoFar` (`IL/TextOnlySimpleLineBuilder.cpp:242, 315`). LineBuilder uses `m_lineContentEdgeOffset + currentLogicalRight`, where the edge offset is text-indent plus float intrusion (`IL/InlineLineBuilder.cpp:478, 1042, 1076`).
4. No wrap (`white-space: pre|nowrap`). The simple builder collects the whole paragraph up to a forced break as one candidate (`IL/TextOnlySimpleLineBuilder.cpp:264-307`). LineBuilder still walks wrap opportunities, but `isAtSoftWrapOpportunity` returns false for no-wrap text (`IL/InlineFormattingUtils.cpp:400-403, 412-437`).
5. A paragraph that is a single one-character, non-whitespace text item takes a shortcut in the simple builder: one line, width = stored width, no fit test (`IL/TextOnlySimpleLineBuilder.cpp:164-196`).
6. LineBuilder only: word-spacing offsets, reverting when a wrap would strand an inline box start behind trimmed white space (`IL/InlineLineBuilder.cpp:1756-1770`), cloned decorations (`:1561-1608`), and reshaping of RTL complex text across inline boxes (§9).

A cached shortcut can skip line breaking entirely. If an earlier intrinsic sizing pass stored a max-content line and `maximumContentSize <= contentBoxWidth` (the code returns early when `>`, float against LU with no epsilon), the paragraph becomes that single line (`IL/InlineFormattingContext.cpp:496-544`).

## 3. Inline items and their stored widths

### 3.1 Building items per text node [V]

`handleTextContent` walks one text node (`IL/InlineItemsBuilder.cpp:924-1051`). At each position it tries these in order:
1. **Segment break**: U+2028, U+2029, or LF when newlines are preserved, becomes a soft line break item (`:954-962`).
2. **White space**: `moveToNextNonWhitespacePosition` collects U+0020, TAB, and LF when not preserved (`:54-73, 963-992`). The item is a *word separator* if it contains a space, a non-preserved LF or a non-preserved TAB. With preserved spaces and non-zero word-spacing the run stops where separator and non-separator characters meet (`:964`). With `white-space-collapse: break-spaces` every character becomes its own item (`:972-978`).
3. **NBSP**: only with `-webkit-nbsp-mode: space`, one item per U+00A0 (`:993-1011`).
4. **Non-whitespace**: text up to the next break position from `findNextBreakablePosition` (`:75-87, 1012-1038`). With `hyphens: none`, items that end in U+00AD are merged with what follows (`:1016-1021`). Otherwise `hasTrailingSoftHyphen` records whether the item's last character is U+00AD (`:1022-1026`).

CR (U+000D), FF (U+000C) and VT (U+000B) are none of the above. They end up inside non-whitespace items and are measured as glyphs (§3.3). A text node made only of space, LF, TAB, CR and FF (`WTF/ASCIICType.h:154-157`) gets no renderer at all: it produces no items and no line. The exceptions are pre, pre-wrap and pre-line parents, a previous sibling that is a text renderer, and some inline-parent cases (`R/updating/RenderTreeUpdater.cpp:536-590`). VT is not in that set, so a node containing only VT does get a renderer.

The text content is the transformed text. `RenderText::setRenderedText` applies `text-transform` (upper, lower, capitalize using the previous character, full-width, full-size-kana) (`R/RenderText.cpp:1763-1805`), and the layout box takes `textRenderer->text()` (`LI/LayoutIntegrationBoxTreeUpdater.cpp:257, 413`). Measure transformed strings.

Break positions may come from `TextBreakingPositionCache` instead (`IL/InlineItemsBuilder.cpp:858-922, 936`). The positions are those of an earlier build of the same text and style.

### 3.2 Stored widths [V]

Widths are measured while the items are built, unless measurement is deferred (`IL/InlineItemsBuilder.cpp:1150-1154`):
```ts
defer = contentRequiresVisualReordering || hasTextAutospace
deferNonWhitespace = defer || !canCache(box, false)
deferWhitespace    = defer || !canCache(box, true)
// canCache (:777-787): false if the first-line font differs from the normal font;
//   for white space also false if spaces are preserved and the node contains a TAB
```
Measured widths:
- non-whitespace item: `TextUtil::width(box, start, end, contentLogicalLeft = 0, UseTrailingWhitespaceMeasuringOptimization::Yes)` (`:98-113, 1033-1034`);
- collapsible white space, or a preserved run of length 1: `singleSpaceWidth` (`:980-986`);
- preserved white space of length > 1: `TextUtil::width(box, start, end, 0, No)` (`:985`);
- break-spaces items: `singleSpaceWidth` each (`:977`).

When measurement is deferred for reordering or autospace, items are split at bidi level boundaries first (`IL/InlineItemsBuilder.cpp:127-130, 716-723`), and widths are computed by `computeInlineTextItemWidthsAndTextSpacing` (`:804-856`). Position-dependent white space (preserved TABs) never gets a stored width; it is measured when placed, with the pen position (§2, difference 3). An item split by bidi loses its width (`IL/InlineTextItem.cpp:73-82`) and is measured when placed.

### 3.3 `TextUtil::width` [V]

`IL/text/TextUtil.cpp:111-122`, for an item range:
```ts
if (item.isWhitespace && (!preserveSpacesAndTabs(box) || (to - from === 1 && text[from] === ' ')))
  return max(0, singleSpaceWidth(font, box.canUseSimplifiedContentMeasuring))
return widthBox(box, from, to, contentLogicalLeft, opt)
```
`singleSpaceWidth` (`:54-60`): `primaryFont.spaceWidth()` (the space glyph advance) on the simplified path, else `widthOfSpaceString()` = `FontCascade::width(" ")` (`G/FontCascadeInlines.h:188-191`). NaN becomes 0 and infinity becomes `F32_MAX`.

`widthBox` (`:62-104`):
```ts
if (from === to) return 0
if (box.isCombined) return font.size
const hasKerningOrLigatures = font.enableKerning || font.requiresShaping   // both true by default
const extended = opt === 'Yes' && hasKerningOrLigatures && to < text.length && text[to] === ' '
if (extended) to++
let w
if (box.canUseSimplifiedContentMeasuring)
  w = font.canTakeFixedPitchFastContentMeasuring
      ? widthForSimpleTextWithFixedPitch(text[from..to], style.collapseWhiteSpace)  // G/FontCascade.cpp:414-442
      : widthForTextUsingSimplifiedMeasuring(text[from..to])                         // G/FontCascadeInlines.h:96-106; G/FontCascade.cpp:381-412
else {
  run = TextRun(text[from..to], xpos = contentLogicalLeft,
                direction = isOverride(unicodeBidi) ? style.direction : LTR, override = isOverride(unicodeBidi))
  if (!style.collapseWhiteSpace && tabSize != 0) run.setTabSize(true, tabSize)
  w = font.width(run)                                                                  // G/FontCascade.cpp:304-379
}
if (extended) w = fround(w - fround(singleSpaceWidth(font, simplified) + font.wordSpacing))
if (isNaN(w)) return 0; if (isInf(w)) return F32_MAX
return max(0, w)
```
The "item plus its following space minus the space" rule applies whenever the character right after `to` is U+0020. It applies to prefixes too, but a mid-word prefix is never followed by a space. Every width in §§5-8 goes through this function.

Simplified measuring (`box.canUseSimplifiedContentMeasuring`) requires all of (`R/RenderText.cpp:480-524`; `IL/text/TextUtil.cpp:716-745`; `G/WidthIterator.cpp:694-742`):
- the simple font code path;
- no small caps;
- zero word- and letter-spacing, and no synthetic bold;
- the same first-line font;
- every character below U+3041, not a control character other than CR and LF, and not TAB with preserved white space;
- none of NBSP, SHY, the bidi controls, ZWJ, ZWNJ, WJ, ZWSP, U+FEFF, U+FFFC or U+2592.

On that path the width is the primary font's glyph advances after one `applyTransforms` (CoreText shaping), summed in f32. Space advances are not restored after shaping (`G/FontCascade.cpp:387-407`). The fixed-pitch variant returns `length * spaceWidth` with no shaping when white space collapses (`:419-421`). [G] no suite font took the fixed-pitch path, and the missing space-advance restore changed no item.

The full path, `FontCascade::width` (`G/FontCascade.cpp:304-379`), chooses the simple or complex code path (`:708-731`).
- Simple path, `WidthIterator` (`G/WidthIterator.cpp:404-485, 491-548, 654-692, 744-827`):
  - per glyph, `advance = widthForGlyph(glyph)` (`:470`);
  - characters treated as space (U+0020, TAB, LF, NBSP; `G/FontCascadeInlines.h:140-143`) get back their pre-shaping advance after shaping (`G/WidthIterator.cpp:473-474`, restored inside `applyFontTransforms`);
  - **letter-spacing** is added after every character whose glyphs have a non-zero advance, including the last character of the string (`:508-516`);
  - **word-spacing** is added on characters treated as space, except at string index 0 (NBSP excepted) and except a TAB when tabs are allowed (`:518-519`);
  - a TAB with tabs allowed has its advance replaced by `tabWidth(position)` (`:500-506`), where `position = run.xPos + widthSoFar` (`:660, 686-690`);
  - visibility rules (`:744-827`): LF and CR take the space glyph but keep their original advance (`:792-799`); a TAB is made invisible (`:803-806`); SHY and other default-ignorables are deleted and their advance subtracted (`:812-815`); other control characters (FF, VT, ...) take glyph 0 (.notdef) and its advance (`:817-822`).
- Complex path, `ComplexTextController::adjustGlyphsAndAdvances` (`G/ComplexTextController.cpp:715-850`):
  - space-like characters take `spaceWidth` (`:743-745`);
  - a TAB takes `tabWidth(xPos + totalAdvance)` (`:747-748`);
  - characters below U+0020 (CR, FF, VT), SHY, ZWSP, bidi controls and U+FEFF get advance 0 (`:762-768`); then control characters other than LF, CR, NBSP, TAB and NUL take the .notdef advance (`:773-780`);
  - letter-spacing is added on glyphs with a non-zero advance (`:795-796`), and word-spacing as in the simple path (`:841-842`).

**Tab width** (`G/FontCascadeInlines.h:76-94`; `G/TabSize.h:52-55`):
```ts
base = tabSize.isSpaces ? tabSize.value * font.spaceWidth : tabSize.value   // space glyph advance; no letter- or word-spacing
if (base === 0) tab = letterSpacing
else { r = fmodf(position, base); if (r < 0) r += base; tab = base - r; if (tab < font.spaceWidth / 2) tab += base }
tab -= font.syntheticBoldOffset   // with SyntheticBoldInclusion::Exclude
```
`position` counts from the TextRun's `xpos`, which is the builder's pen position, i.e. relative to the line's content start (§2, difference 3). With `tab-size: 0`, tabs are not allowed, so the TAB is measured as a space-like glyph (`IL/text/TextUtil.cpp:91-92`).

**Hyphen** (`ST/computed/StyleComputedStyle.cpp:419-434`; `IL/text/TextUtil.cpp:621-624`): `hyphenWidth = max(0, font.width(hyphenString))`. `hyphenString` is the `hyphenate-character` string, or for `auto` U+2010 if the primary font has a glyph for it, else U+002D.

**Spacing values** (`ST/computed/StyleComputedStyleBase.cpp:312-371`): letter- and word-spacing evaluate against the font size with zoom and are stored on the FontCascade. Any non-zero letter-spacing sets `shouldDisableLigaturesForSpacing` on the DOM font (`:325`), which turns off liga, clig, dlig and hlig [V in groundwork: `G/cocoa/UnrealizedCoreTextFont.cpp`, not re-read here].

## 4. Line bookkeeping (`Line`)

State per line (`IL/InlineLine.h:323-335`): `runs`, `m_contentLogicalWidth`, trimmable trailing content, hanging content, and `m_trailingSoftHyphenWidth`.

`appendText(item, style, width)` (`IL/InlineLine.cpp:346-481`); `appendTextFast` (`:483-556`) is the simple builder's variant without word-spacing, bidi or shaping cases:
```ts
// 1. collapse completely (:348-373; fast :486-495)
if (item.isEmpty) return
if (item.isWhitespace && !preserveSpacesAndTabs) {
  // walk back over runs: an atomic inline means "keep"; the first text run decides:
  // collapse if it ends in collapsible white space; if no text run exists, collapse (leading white space)
  if (collapses) return
}
// 2. new run or extend (:375-402): new run if any of
//   no runs; different layout box; different bidi level; last run not text; last run ends in collapsed white space;
//   wordSpacing != 0 && (item is a word separator || (last run is a separator && level != default));
//   item is a lone ZWSP; NBSP item or last run NBSP; RTL + preserved spaces + (whitespace != whitespace-only);
//   a shaping boundary
old = contentLogicalWidth
if (newRun) {
  left = isFirstLine && hangablePunctuationStart && !lineHasContent ? -hangWidth : fround(lastRunRight + (item.isWordSeparator ? wordSpacing : 0))
  runs.push({ left, width }); right = fround(left + width)
} else if (letterSpacing >= 0) { last.width = fround(last.width + width); right = fround(last.left + last.width) }
else { /* negative letter-spacing: right = max(contentWidth without last run, lastRight + width) (:423-436) */ }
contentLogicalWidth = max(old, right)                     // :440
// 3. trimmable (:445-455)
if (item.isFullyTrimmable) trimmable.add(runIndex, offset = fround(fround(contentLogicalWidth - old) - width), width)
else trimmable.reset()
// 4. hanging (:457-477): not trimmable && whitespace && shouldTrailingWhitespaceHang(style) => hang(length, width);
//    else hanging punctuation; else reset
// 5. soft hyphen (:479-480)
trailingSoftHyphenWidth = item.hasTrailingSoftHyphen ? hyphenWidth(style) : undefined
```
- `isFullyTrimmable` = whitespace item and spaces not preserved (`IL/InlineTextItem.cpp:97-100`).
- `shouldTrailingWhitespaceHang` = `white-space-collapse: preserve` && wrapping allowed, i.e. `pre-wrap` only (`IL/text/TextUtil.cpp:444-448`).
- A collapsible white-space run is one space long in text but carries the item's width (`IL/InlineLine.cpp:813-822, 876-883, 912-915`).
- `addTrailingHyphen(w)`: adds `w` to the last text run and to `contentLogicalWidth` (`:609-619`; `IL/InlineLine.h:388-393`).
- `handleTrailingTrimmableContent(Remove)`: removes `offset + trailing white-space width` from that run and from `contentLogicalWidth`, and moves the following non-content runs left (`IL/InlineLine.cpp:112-125, 745-778`). In an RTL run with non-whitespace content, the removed width is measured again as `W(start, end, Yes) - W(start, end-1, No)` (`:972-982`; `IL/text/TextUtil.cpp:124-130`).
- Trailing letter-spacing is never trimmed. `addPartiallyTrimmableContent` has no caller in the checkout, so the removal at an inline box end (`IL/InlineLine.cpp:322-326`) never fires. A line's width includes the letter-spacing after its last glyph.
- `close()` returns `contentLogicalWidth` plus cloned-decoration widths (`:87-110`).

## 5. TextOnlySimpleLineBuilder (also used inside RangeBasedLineBuilder)

Line loop driver (`IL/InlineFormattingContext.cpp:293-360`):
```ts
let start = {index: 0, offset: 0}, previousLine = undefined, prevEnd = undefined, isFirstFormattedLine = true
while (true) {
  const result = builder.layoutInlineContent({range: [start, end], rect: {left, width: lineWidthLU / 64}}, previousLine, isFirstFormattedLine)
  if (result.hasContentfulInFlowContent) isFirstFormattedLine = false
  start = leadingInlineItemPositionForNextLine(result.range.end, prevEnd, hasFloats, end)   // IL/InlineFormattingUtils.cpp:278-298
  if (start === end) break
  previousLine = { lineIndex, trailingOverflowingContentWidth: result.contentGeometry.trailingOverflowingContentWidth,
                   endsWithLineBreak, hasContentfulInFlowContent, inlineBaseDirection, suspendedFloats }  // :357
  prevEnd = result.range.end
}
```
The next line starts from an `InlineItemPosition { index, offset }` (`IL/InlineLineTypes.h:62-68`) plus that `PreviousLine`. No other state crosses lines.

`layoutInlineContent` (`IL/TextOnlySimpleLineBuilder.cpp:101-134`):
```ts
if (items.length === 1 && isText(items[0]) && items[0].length <= 1 && !items[0].isWhitespace)
  return oneLine(items[0].width ?? 0)                    // :164-196
initialize(range, rect, previousLine)                    // :136-162
const end = isWrappingAllowed(rootStyle) ? placeInlineTextContent(range) : placeNonWrappingInlineTextContent(range)
const r = line.close()
return { range: [range.start, end], runs: r.runs, contentLogicalWidth: r.contentLogicalWidth,
         trailingOverflowingContentWidth: overflowContentLogicalWidth, hangingWidth: r.hangingTrailingContentWidth, ... }
```
`initialize`: if `previousLine` exists and `range.start.offset > 0`, then `partialLeading = items[start.index].right(length - offset, previousLine.trailingOverflowingContentWidth)` (`:141-154`). `right()` keeps the carried width as the stored width (`IL/InlineTextItem.cpp:65-71`). The wrap opportunity list is emptied (`IL/AbstractLineBuilder.cpp:46-52`).

`placeInlineTextContent` (`IL/TextOnlySimpleLineBuilder.cpp:198-262`):
```ts
const wrapBeforeWhitespace = collapse !== 'break-spaces' && lineBreak !== 'after-white-space'
let placed = 0, result = {}, cand = {start: range.start.index, end: range.start.index, width: 0}
let next = range.start.index
const atSoftWrapOrEnd = (it) =>
  it.isWhitespace || next >= range.end.index || items[next].isLineBreak ||
  (items[next].isWhitespace ? wrapBeforeWhitespace
   : (it.textBox === items[next].textBox || mayBreakInBetween(it, items[next])))   // IL/text/TextUtil.cpp:367-396
const process = () => {
  result = commitCandidateContent(cand)
  placed = result.isRevert ? result.committedCount : placed + result.committedCount
  cand = {start: cand.end, end: cand.end, width: 0}
  return result.isEndOfLine
}
let eol = false
if (partialLeading) { cand.end++; /* width += 0 */ next++; if (atSoftWrapOrEnd(partialLeading)) eol = process() }
while (!eol && next < range.end.index) {
  const it = items[next++]
  if (it.isText) {
    cand.width = fround(cand.width + (it.width ?? measure(it, fround(line.contentLogicalRight + cand.width))))
    cand.end++
    if (atSoftWrapOrEnd(it)) eol = process()
  } else if (it.isLineBreak) { eol = true; result = {} }
}
if (!result.overflowingContentLength && !result.isRevert && items[range.start.index + placed]?.isLineBreak) { line.appendLineBreak(); placed++ }
const placedEnd = placedInlineItemEnd(range.start.index, placed, result.overflowingContentLength)   // :65-73
handleLineEnding(placedEnd)
overflowContentLogicalWidth = result.overflowLogicalWidth
return placedEnd
```
`measure(it, left)` (`:57-63`) is `TextUtil::width(it, left)`. Collapsible white space is measured on its first character only. `placedInlineItemEnd` with an overflowing length gives `{ index: last placed item, offset: item.length - overflowingLength }`. Two text nodes join into one candidate when `mayBreakInBetween` says no. That call builds an iterator over the *next* node with the next node's locale and mode, seeds it with the previous node's last two characters, and asks whether position 0 is breakable. A previous node ending in SHY under `hyphens: none` never breaks (`IL/text/TextUtil.cpp:374-396`). This is why a bold "foo" followed by a regular "bar" has no break between them.

`commitCandidateContent` (`IL/TextOnlySimpleLineBuilder.cpp:309-341`):
```ts
const hasLeadingPartial = partialLeading && cand.start === range.start.index
if (cand.width <= availableWidth() && !hasLeadingPartial) {
  for (const it of cand) line.appendTextFast(it, rootStyle, it.width ?? measure(it, line.contentLogicalRight))
  if (line.hasContent) wrapList.push(items[cand.end - 1])
  return { isEndOfLine: false, committedCount: cand.end - cand.start }
}
const cc = new ContinuousContent()
let i = cand.start
if (hasLeadingPartial) { cc.appendTextContent(partialLeading, rootStyle, partialLeading.width ?? measure(partialLeading, line.contentLogicalRight)); i++ }
for (; i < cand.end; i++) cc.appendTextContent(items[i], rootStyle, items[i].width ?? measure(items[i], fround(line.contentLogicalRight + cc.logicalWidth)))
return handleOverflowingTextContent(cc)
```
`handleOverflowingTextContent` (`:343-421`):
```ts
const avail = availableWidth()
let res = { action: 'Keep', isEndOfLine: false }
if (cc.logicalWidth > avail)
  res = breaker.processInlineContent(cc, { contentLogicalRight: line.contentLogicalRight, availableWidth: avail,
        trimmableOrHangingWidth: line.trimmableTrailingWidth, trailingSoftHyphenWidth: line.trailingSoftHyphenWidth,
        hasFullyTrimmableTrailingContent: line.isTrailingRunFullyTrimmable, hasContent: line.hasContent,
        hasWrapOpportunityAtPreviousPosition: wrapList.length > 0 })
switch (res.action) {
  case 'Keep': appendAll(cc.runs); if (line.hasContent) wrapList.push(last(cc.runs).item); return { isEndOfLine: res.isEndOfLine, committedCount: cc.runs.length }
  case 'Wrap': return { isEndOfLine: true, committedCount: 0, overflowLogicalWidth: overflowWidthAsLeadingForNextLine(cc.runs, res) }
  case 'WrapWithHyphen': line.addTrailingHyphen(line.trailingSoftHyphenWidth); return { isEndOfLine: true, committedCount: 0 }
  case 'Break': {
    const t = res.partialTrailingContent
    appendAll(cc.runs.slice(0, t.trailingRunIndex))
    if (!t.partialRun) { append(cc.runs[t.trailingRunIndex]); if (t.hyphenWidth) line.addTrailingHyphen(t.hyphenWidth)
                         return { isEndOfLine: true, committedCount: t.trailingRunIndex + 1 } }
    line.appendTextFast(run.item.left(t.partialRun.length), style, t.partialRun.logicalWidth)
    if (t.partialRun.hyphenWidth) line.addTrailingHyphen(t.partialRun.hyphenWidth)
    return { isEndOfLine: true, committedCount: t.trailingRunIndex + 1,
             overflowingContentLength: run.item.length - t.partialRun.length,
             overflowLogicalWidth: overflowWidthAsLeadingForNextLine(cc.runs, res) }
  }
  case 'RevertToLastWrapOpportunity': return { isEndOfLine: true, committedCount: revertToTrailingItem(last(wrapList)), isRevert: true }
  case 'RevertToLastNonOverflowingWrapOpportunity': return { isEndOfLine: true, committedCount: revertToLastNonOverflowingItem(), isRevert: true }
}
```
`left(n)` drops the stored width (`IL/InlineTextItem.cpp:57-63`); the partial run uses the breaker's fresh prefix width.

`revertToTrailingItem(target)` (`IL/TextOnlySimpleLineBuilder.cpp:437-457`) clears the line and appends, with no fit test, the partial leading item and then items from the range start up to and including `target`. It returns how many were appended.

`revertToLastNonOverflowingItem` (`:459-479`):
```ts
for (let i = wrapList.length - 1; i >= 0; i--) {
  const n = revertToTrailingItem(wrapList[i]); const h = line.trailingSoftHyphenWidth
  if (i === 0 || h === undefined || h <= availableWidth()) { if (h !== undefined) line.addTrailingHyphen(h); return n }
}
```
`placeNonWrappingInlineTextContent` (`:264-307`): sum every text item up to the first forced break into one candidate, then `commitCandidateContent` once. Because no run can break, the breaker returns Keep and everything goes on one line; a forced break then ends the line.

`handleLineEnding` (`:423-435`):
```ts
const W = rect.width                         // no epsilon
const isLast = placedEnd.index === range.end.index && placedEnd.offset === 0
trimmedTrailingWhitespaceWidth = line.handleTrailingTrimmableContent(
  lineBreak === 'after-white-space' && mode !== 'min' && (!isLast || W < line.contentLogicalWidth) ? 'Preserve' : 'Remove')
if (!intrinsic && W < line.contentLogicalWidth && nbspMode === 'space' && wrapping && collapse !== 'break-spaces')
  line.handleOverflowingNonBreakingSpace(..., fround(line.contentLogicalWidth - W))   // IL/InlineQuirks.cpp:45-51
line.handleTrailingHangingContent(intrinsicMode, W, isLast)                           // IL/InlineLine.cpp:198-233
```

## 6. LineBuilder

### 6.1 Placement loop

`placeInlineAndFloatContent` (`IL/InlineLineBuilder.cpp:499-710`), floats and blocks omitted:
```ts
let placed = 0, idx = range.start.index
while (idx < range.end.index) {
  const candEnd = nextWrapOpportunity(idx, range, items)                        // IL/InlineFormattingUtils.cpp:456-544
  candidateContentForLine(cand, idx, candEnd, range, line.contentLogicalRight)   // :1030-1170
  const r = handleInlineContent(range, cand)                                     // :1432-1481
  let eol = r.isEndOfLine
  if (!r.committedCount.isRevert) {
    placed += r.committedCount.value
    if (cand.runs.length === r.committedCount.value && !r.partialTrailingContentLength) {
      if (cand.trailingWordBreakOpportunity) { placed++; line.appendWordBreakOpportunity() }
      if (cand.trailingLineBreak) { line.appendLineBreak(); placed++; eol = true }
    }
  } else placed = r.committedCount.value
  if (eol) { partialTrailingContentLength = r.partialTrailingContentLength; overflowLogicalWidth = r.overflowLogicalWidth; break }
  idx = range.start.index + placed
}
// range end (:610-629): with a partial trailing length, end = { lastItem, item.length - partialTrailingContentLength }
// line ending (:633-707): same trimming, NBSP quirk and hanging as §5, plus resetBidiLevelForTrailingWhitespace (:676) and justification (:683-700)
```

`nextWrapOpportunity` (`IL/InlineFormattingUtils.cpp:456-544`) walks forward from `idx`:
- A `<br>` or `<wbr>` ends the candidate right after it, together with any following inline box ends.
- Inline box starts, ends and out-of-flow boxes are skipped while deciding.
- For two consecutive content items (text or atomic), `isAtSoftWrapOpportunity(prev, cur)` (`:385-454`) decides:
  - both in the same parent and neither may wrap → no;
  - prev is white space → the prev box's `text-wrap-mode` decides;
  - cur is white space → yes if cur may wrap and is neither `break-spaces` nor `after-white-space`;
  - either has `line-break: anywhere` → yes;
  - same parent and no wrap → no;
  - otherwise `endsWithSoftWrapOpportunity`: same text box and same bidi level → yes, because items are cut at break positions; same box but a different bidi level → ask the iterator at that offset; different boxes → `mayBreakInBetween` (`:336-355`). The answer then needs the nearest common ancestor to allow wrapping.
- The opportunity is placed *before* the first inline box start that opens the trailing content, so `ex-<span>ample` wraps after "ex-" (`:523-539`).

### 6.2 Candidate collection

`candidateContentForLine` (`IL/InlineLineBuilder.cpp:1030-1170`):
```ts
cand.reset(); let right = currentLogicalRight
if (idx === range.start.index && partialLeading) {
  const w = inlineItemWidth(partialLeading, fround(edgeOffset + right))   // stored carried width if present
  cand.append(partialLeading, w); right = fround(right + w); idx++
}
let shyIndex = undefined
for (let i = idx; i < candEnd; i++) {
  const it = items[i], style = firstLine ? it.firstLineStyle : it.style
  if (it.isText) {
    let w = inlineItemWidth(it, fround(edgeOffset + right))                // IL/InlineFormattingUtils.cpp:300-309
    if (right === 0 && trimmableTextSpacings.has(i)) w = fround(w - trimmableTextSpacings.get(i))   // text-autospace
    cand.appendTextContent(it, style, w)
    right = fround(fround(right + w) + (it.isWordSeparator ? style.wordSpacing : 0))
    shyIndex = it.hasTrailingSoftHyphen ? i : undefined
  } else if (it.isInlineBoxStartOrEnd) { const w = marginBorderPaddingOfThatSide(it); cand.append(it, w); right = fround(right + w) }
  else if (it.isLineBreak || it.isWordBreakOpportunity) cand.recordTrailing(it)
}
if (shyIndex !== undefined && items.slice(shyIndex, candEnd).every(isText))
  cand.logicalWidth = fround(cand.logicalWidth + hyphenWidth(styleOf(items[shyIndex])))   // hyphen counted in the fit test
cand.hasTrailingSoftWrapOpportunity = hasTrailingSoftWrapOpportunity(candEnd, range.end, items)   // :141-192
applyShapingIfNeeded(cand)                                                                  // §9
```
`inlineItemWidth` (`IL/InlineFormattingUtils.cpp:300-334`): the stored width if any; otherwise `TextUtil::width(item, left)`, measuring collapsible white space on its first character only. An inline box start or end contributes its margin + border + padding on that side. `m_overflowingLogicalWidth` (`:1076`) is only set when a line starts at a non-zero offset in a non-text item, which cannot happen for text (`:480-495`), so ignore it.

`ContinuousContent::appendTextContent` (`IL/InlineContentBreaker.cpp:950-988`):
```ts
hasTextContent = true
const afterSeparator = hasTrailingWordSeparator; hasTrailingWordSeparator = it.isWordSeparator
const hangs = it.isWhitespace && shouldTrailingWhitespaceHang(style)
if (hangs) hangingContentWidth = w
const trimmable = !hangs && (it.isFullyTrimmable || it.isQuirkNonBreakingSpace) ? w : undefined
const offset = afterSeparator ? style.wordSpacing : 0
if (trimmable === undefined) { push(it, offset, w); if (offset && isFullyTrimmable) leadingTrimmable += offset; resetTrailingTrimmable(); return }
isFullyTrimmable ||= runs.length === 0
const leading = logicalWidth === 0 || isFullyTrimmable      // evaluated before the push
push(it, offset, w)
if (leading) leadingTrimmable = fround(leadingTrimmable + w)
else trailingTrimmable = (trimmable === w) ? fround(trailingTrimmable + w) : trimmable
// resetTrailingTrimmable (:929-935): if (!leadingTrimmable) leadingTrimmable = trailingTrimmable; trailingTrimmable = 0; isFullyTrimmable = false
```

### 6.3 Fit and result handling

`handleInlineContent` (`IL/InlineLineBuilder.cpp:1432-1481`):
```ts
if (cand.runs.length === 0) return { isEndOfLine: !!cand.trailingLineBreak }
const avail = availableWidth(line, rect.width, intrinsicMode)          // §1.4
const hasContent = line.hasContent(includeInsideListMarker) || constrainedByFloats
let res = { action: 'Keep', isEndOfLine: false }
if (cand.minimumRequiredWidth > avail) { if (hasContent) res = Wrap }  // ruby only
else if (clonedDecorations) res = handleInlineContentWithClonedDecoration(...)
else if (cand.logicalWidth > avail)
  res = breaker.processInlineContent(cand, { contentLogicalRight: line.contentLogicalRight, availableWidth: avail,
        trimmableOrHangingWidth: line.trimmableTrailingWidth, trailingSoftHyphenWidth: line.trailingSoftHyphenWidth,
        hasFullyTrimmableTrailingContent: line.isTrailingRunFullyTrimmable, hasContent,
        hasWrapOpportunityAtPreviousPosition: wrapList.length > 0 })
return processLineBreakingResult(cand, range, res)
```
`processLineBreakingResult` (`:1726-1811`):
- **Keep**: commit all runs (`:1610-1724`, `Line::appendText` per text run). If the candidate has a trailing soft wrap opportunity, the line has content, and the trailing run's parent (or, for an inline box, the run itself) may wrap, push the trailing item to the wrap list. Return count = number of runs.
- **Wrap**: if the line has trimmable trailing width, its last run is an inline box start, and the wrap list has more than one entry: pop the list and rebuild the line up to the new last entry (revert). Otherwise return `{ eol, count 0, overflowLogicalWidth }`.
- **WrapWithHyphen**: `line.addTrailingHyphen(line.trailingSoftHyphenWidth)`.
- **RevertToLastWrapOpportunity**: `rebuildLineWithInlineContent(range, last(wrapList))`.
- **RevertToLastNonOverflowingWrapOpportunity**: `rebuildLineForTrailingSoftHyphen`.
- **Break**: commit runs before `trailingRunIndex`. For a partial run, append `item.left(length)` with `partialRun.logicalWidth` and then any hyphen; otherwise append the whole trailing run and then any hyphen. Return `{ eol, count trailingRunIndex+1, partialTrailingContentLength: item.length - length, overflowLogicalWidth }`.

`rebuildLineWithInlineContent(range, target)` (`:1813-1858`): clear the line. If the target is the partial leading item, commit it alone. Otherwise collect a candidate from the range start through the target (floats skipped) and process it as Keep, without a fit test.

`rebuildLineForTrailingSoftHyphen` (`:1860-1887`):
```ts
for (let i = wrapList.length - 1; i >= 1; i--) {
  const n = rebuildLineWithInlineContent(range, wrapList[i]); const h = line.trailingSoftHyphenWidth
  if (h === undefined || h <= fround(rect.width - line.contentLogicalRight)) { if (h !== undefined) line.addTrailingHyphen(h); return n }
}
const n = rebuildLineWithInlineContent(range, wrapList[0])
if (line.trailingSoftHyphenWidth !== undefined) line.addTrailingHyphen(line.trailingSoftHyphenWidth)
return n
```

## 7. InlineContentBreaker: what happens when a candidate does not fit

Both builders call this only when the candidate overflows (§1.4), except in min-content sizing.

### 7.1 Top level [V]

`processInlineContent` (`IL/InlineContentBreaker.cpp:105-122`):
```ts
if (minContentMode && cc.isTextOnly) { const r = simplifiedMinimumIntrinsicWidthBreak(cc, st); if (r) return r }   // :301-328
let r = processOverflowingContent(cc, st)
if (r.action === 'Wrap' && st.trailingSoftHyphenWidth !== undefined && hasLeadingTextContent(cc))
  r = { action: st.trailingSoftHyphenWidth > st.availableWidth ? 'RevertToLastNonOverflowingWrapOpportunity' : 'WrapWithHyphen', isEndOfLine: true }
return r
```
`st.trailingSoftHyphenWidth` belongs to the *line*: its last placed item ended in U+00AD. So the hyphen becomes visible only when the next content wraps.

`processOverflowingContent` (`:160-299`):
```ts
// (a) trailing content that may overflow (:165-200)
if (cc.isFullyTrimmable) return Keep                               // collapsible white space always stays
if (cc.hasTrimmableSpace) {
  if (isWhitespaceOnlyContent(cc)) return Keep
  let need = fround(cc.logicalWidth - cc.trailingTrimmableWidth)
  if (st.hasFullyTrimmableTrailingContent) need = fround(need - cc.leadingTrimmableWidth)
  if (need <= st.availableWidth) return Keep
}
if (cc.isHangingContent) return Keep                               // pre-wrap white space only
if (cc.hangingContentWidth && fround(cc.logicalWidth - cc.hangingContentWidth) <= st.availableWidth) return Keep
if (st.trimmableOrHangingWidth && isNonContentRunsOnly(cc) && cc.logicalWidth <= fround(st.availableWidth + st.trimmableOrHangingWidth)) return Keep
// (b) text (:202-262)
let overflowingRunIndex = 0
if (cc.hasTextContent) {
  const o = processOverflowingContentWithText(cc, st); overflowingRunIndex = o.runIndex
  if (o.breakingPosition) {
    const t = o.breakingPosition.trailingContent
    if (!t) {                                                      // not even one unit fits
      if (st.hasContent) return Wrap
      const ti = firstTextRunIndex(cc.runs), it = cc.runs[ti].item
      if (it.length > firstUserPerceivedCharacterLength(it)) {
        const p = firstCharacterBreakRespectingLineStartProhibitions(it, cc.runs[ti], st.contentLogicalRight)
        if (p.length < it.length) return Break({ trailingRunIndex: ti, partialRun: p })
      }
      // keep the whole item together with the inline box ends after it
      const after = firstRunAfter(ti, skipping OutOfFlow, stopping at first non-InlineBoxEnd)   // :234-248
      return after !== undefined ? Break({ trailingRunIndex: after - 1 }) : { action: 'Keep', isEndOfLine: true }
    }
    if (t.overflows && st.hasContent) return Wrap
    return Break({ trailingRunIndex: o.breakingPosition.runIndex, partialRun: t.partialRun, hyphenWidth: t.hyphenWidth })
  }
}
// (c) unbreakable (:274-298)
if (!st.hasContent) return { action: 'Keep', isEndOfLine: false }
let allowed = isWrappingAllowed(box(overflowingRunIndex).isInlineBox ? its style : its parent's style)
for (let i = overflowingRunIndex; !allowed && i-- > 0;) allowed = isWrappingAllowed(parentStyle(cc.runs[i]))
if (allowed) return Wrap
if (st.hasWrapOpportunityAtPreviousPosition) return { action: 'RevertToLastWrapOpportunity', isEndOfLine: true }
return { action: 'Keep', isEndOfLine: false }
```
`firstUserPerceivedCharacterLength` (`IL/text/TextUtil.cpp:578-604`): 1 for 8-bit text; one code point on the simple font path; otherwise an ICU grapheme from `NonSharedCharacterBreakIterator`, whose locale is the user's text-break locale and not the page language [G].

`firstCharacterBreakRespectingLineStartProhibitions` (`IL/InlineContentBreaker.cpp:139-158`):
```ts
let len = firstUserPerceivedCharacterLength(it)
let w = TextUtil.width(it, it.start, it.start + len, contentLogicalRight)
if (text.is8Bit) return { length: len, logicalWidth: w }
while (it.start + len < it.end && !canBreakBefore(text[it.start + len], style.lineBreak)) {
  len = nextCodePointBoundary(len); w = TextUtil.width(it, it.start, it.start + len, contentLogicalRight)
}
return { length: len, logicalWidth: w }
```
`canBreakBefore(c, lineBreak)` (`:124-137`): false for U+2010 and U+2013 unless `line-break: loose`; false for NBSP; otherwise true for `\` and for any character that is not in general category Ps, Pe, Pi, Pf or Po.

### 7.2 Finding the break [V]

`processOverflowingContentWithText` (`:813-875`):
```ts
let nonOverflowing = 0, idx = runs.length
for (let i = 0; i < runs.length; i++) {
  if (runs[i].item.isOutOfFlow) continue
  if (fround(nonOverflowing + runs[i].spaceRequired) > st.availableWidth) { idx = i; break }
  nonOverflowing = fround(nonOverflowing + runs[i].spaceRequired)
}
if (idx === runs.length) return { runIndex: runs.length - 1 }      // only the trailing hyphen overflowed (LineBuilder)
let bp = tryBreakingOverflowingRun(st, runs, idx, nonOverflowing)   // :643-662
if (bp) return { runIndex: idx, breakingPosition: bp }
const beforeAllowed = !(runs[idx].isWhitespaceText && style(runs[idx]).lineBreak === 'after-white-space')
if (beforeAllowed && (bp = tryBreakingPreviousNonOverflowingRuns(st, runs, idx, nonOverflowing))) return { runIndex: idx, breakingPosition: bp }   // :664-702
if ((bp = tryHyphenationAcrossOverflowingInlineTextItems(st, runs, idx))) return { runIndex: idx, breakingPosition: bp }   // :737-811, hyphens:auto only
if ((bp = tryBreakingNextOverflowingRuns(st, runs, idx, nonOverflowing))) return { runIndex: idx, breakingPosition: bp }   // :704-735
return { runIndex: idx }
```
`tryBreakingOverflowingRun` (`:643-662`):
```ts
if (!runs[idx].item.isText || !isWrappingAllowed(runs[idx].style)) return undefined      // isBreakableRun :353-362
const avail = max(0, fround(st.availableWidth - nonOverflowing))
const p = tryBreakingTextRun(runs, { index: idx, isOverflowingRun: true, logicalLeft: fround(st.contentLogicalRight + nonOverflowing) }, avail, st)
if (!p) return undefined
if (p.length) return { runIndex: idx, trailingContent: { overflows: false, partialRun: p } }
const tr = findTrailingRunIndexBeforeBreakableRun(runs, idx)                                // :330-351
return tr !== undefined ? { runIndex: tr, trailingContent: {} } : {}   // {} means "not even the first unit fits"
```
`tryBreakingPreviousNonOverflowingRuns` (`:664-702`): walk back from `idx - 1`, subtracting each run's `spaceRequired` from `nonOverflowing` first. For each breakable text run call `tryBreakingTextRun(runs, { i, isOverflowingRun: false, left: contentRight + remaining }, max(0, avail - remaining))`. A result covering the whole run gives a break after that run, advanced past inline box ends up to `idx`; a shorter result gives a partial break.

`tryBreakingNextOverflowingRuns` (`:704-735`): for runs after `idx`, call `tryBreakingTextRun` with available width 0 and `overflows: true`. A non-empty partial result breaks inside that run. An empty one breaks before it, or at `idx` if there is nothing before.

`wordBreakBehavior(style, hasWrapOpportunityAtPreviousPosition)` (`:877-915`):
```ts
if (style.lineBreak === 'anywhere') return ['AtArbitraryPosition']
if (style.wordBreak === 'break-all') return ['AtArbitraryPositionWithinWords']
const hyph = !hyphenationDisabledByLimitLines && style.hyphens === 'auto' && canHyphenate(locale)
const withHyph = (r) => hyph ? [...r, 'AtHyphenationOpportunities'] : r
if (style.wordBreak === 'break-word' && !hasWrapOpportunityAtPreviousPosition) return withHyph(['AtArbitraryPosition'])
if (((!minContentMode && style.overflowWrap === 'break-word') || style.overflowWrap === 'anywhere') && !hasWrapOpportunityAtPreviousPosition)
  return withHyph(['AtArbitraryPosition'])
if (style.wordBreak === 'keep-all') return []
return withHyph([])
```
So `overflow-wrap: break-word|anywhere` and `word-break: break-word` split a word only while the line has no earlier wrap opportunity. Otherwise the word wraps and is split on the next line, where it comes first. `word-break: break-all` and `line-break: anywhere` split even on a line that already has content. `hyphens: manual` adds no rule; soft hyphens act only as item boundaries (§3.1, §8.3).

`tryBreakingTextRun(runs, cand, avail, st)` (`:502-641`):
```ts
const rules = wordBreakBehavior(run.style, st.hasWrapOpportunityAtPreviousPosition); if (!rules.length) return undefined
const room = avail > 0
if (rules.includes('AtArbitraryPositionWithinWords')) {                              // break-all
  if (it.isWhitespace || it.length === 0) return undefined
  if (cand.isOverflowingRun) {
    if (room) { const wb = midWordBreak(run, cand.logicalLeft, avail); if (wb) return wb }
    if (canBreakBefore(text[it.start], lineBreak)) return { length: 0, logicalWidth: 0 }
    if (!st.hasContent) {                                                              // first position where a break is allowed
      for (let r = nextCP(it.start); r < it.end; r = nextCP(r))
        if (canBreakBefore(text[r], lineBreak)) return { length: r - it.start, logicalWidth: TextUtil.width(it, it.start, r, cand.logicalLeft) }
    }
    return undefined
  }
  const pos = lastValidBreakingPosition(runs, cand.index)                              // :364-403
  return pos !== undefined ? { length: pos - it.start, logicalWidth: TextUtil.width(it, it.start, pos, cand.logicalLeft) } : undefined
}
if (rules.includes('AtHyphenationOpportunities')) { /* hyphens:auto; CFStringGetHyphenationLocationBeforeIndex; out of scope */ }
if (rules.includes('AtArbitraryPosition')) {                                           // overflow-wrap / word-break:break-word / line-break:anywhere
  if (it.length === 0) return undefined
  if (!cand.isOverflowingRun) {
    if (nextTextRunIndex(runs, cand.index) !== undefined) return { length: it.length, logicalWidth: TextUtil.width(it, cand.logicalLeft) }
    if (it.length > 1) return { length: it.length - 1, logicalWidth: TextUtil.width(it, it.start, it.end - 1, cand.logicalLeft) }
    return undefined
  }
  if (!room) return { length: 0, logicalWidth: 0 }
  const wb = TextUtil.breakWord(it, run.style.font, run.spaceRequired, avail, cand.logicalLeft)
  return { length: wb.length, logicalWidth: wb.logicalWidth }
}
return undefined
```
`midWordBreak(run, left, avail)` (`:405-430`):
```ts
const wb = TextUtil.breakWord(it, font, run.spaceRequired, avail, left)
if (wb.length === 0 || wb.length === it.length) return undefined
if (canBreakBefore(text[it.start + wb.length], lineBreak)) return wb
let r = it.start + wb.length
for (; r > it.start; r--) { r = codePointStart(r); if (canBreakBefore(text[r], lineBreak)) break }
if (r === it.start) return undefined
return { length: r - it.start, logicalWidth: TextUtil.width(it, it.start, r, left) }
```
`breakWord`'s first argument, `textWidth`, is `spaceRequired`, i.e. the run's stored or carried width plus its word-spacing offset. It is only used for the average-width estimate.

## 8. breakWord, the carried remainder, soft hyphens

### 8.1 `TextUtil::breakWord` (`IL/text/TextUtil.cpp:242-365`) [V]

`start = item.start`, `length = item.length`. Every width below is `TextUtil::width(box, start, end, left)`: a fresh measurement from the *item start*, with the following-space extension when `text[end] === ' '`.
```ts
if (textWidth === 0) return { length: 0, logicalWidth: 0 }
if (box.canUseSimpleFontCodePath) {
  const align = (i) => text.is8Bit ? i : codePointStart(i, start)
  // (1) fixed pitch (:265-280)
  if (font.isFixedPitch && box.canUseSimplifiedContentMeasuring) {
    const cw = font.widthOfSpaceString()
    const end = align(min(start + Math.floor(avail / cw), start + length - 1))
    const w = W(start, end)
    if (!(w > avail || fround(w + cw) < avail)) return { length: end - start, logicalWidth: w }
  }
  // (2) average-width estimate (:284-311)
  const avg = fround(textWidth / length)
  const cl = Math.trunc(avail / avg)                     // f32 division, truncated to size_t
  const ce = align(start + cl)
  if (ce > start && ce < start + length) {
    const w = W(start, ce)
    if (w === avail) return { length: ce - start, logicalWidth: w }
    if (w > avail) { const a = align(ce - 1); if (a > start) { const aw = W(start, a); if (aw <= avail) return { length: a - start, logicalWidth: aw } } }
    else { const a = align(ce + 1); if (a < start + length) { const aw = W(start, a)
             if (aw > avail) return { length: ce - start, logicalWidth: w }
             if (aw === avail) return { length: a - start, logicalWidth: aw } } }
  }
  // (3) bisection (:315-349)
  let left = start, right = align(min(start + Math.trunc(2 * avail / avg), start + length - 1)), leftW = 0
  while (left < right) {
    const mid = align(Math.floor((left + right) / 2))    // std::midpoint on size_t rounds toward left
    const eom = text.is8Bit ? mid + 1 : nextCodePoint(mid)
    const w = W(start, eom)
    if (w < avail) { left = eom; leftW = w } else if (w > avail) right = mid else { right = eom; leftW = w; break }
  }
  return { length: right - start, logicalWidth: leftW }
}
// complex font path (:354-364): grapheme clusters from NonSharedCharacterBreakIterator
let res = { length: 0, logicalWidth: 0 }
for (const cs of graphemeBoundaries(text[start..start+length]))    // ubrk_next, first boundary after 0
{ const w = W(start, start + cs); if (w > avail) return res; res = { length: cs, logicalWidth: w } }
return res
```
Two consequences:
- The search tests only O(log n) prefixes, and prefix widths need not increase with length (kerning, negative spacing). The result is the output of this exact probe sequence, not "the longest prefix that fits".
- On the bisection path the returned `leftW` belongs to the last prefix that tested `<` or `==`. If bisection ends with `left === right` before any such prefix was measured, the width is 0 while the length may be non-zero [I: e.g. when (2) is skipped and `right` starts at `start`, the length is 0 anyway].

### 8.2 The carried remainder and the next line's start state [V]

`overflowWidthAsLeadingForNextLine(runs, result)` (`IL/AbstractLineBuilder.cpp:54-98`):
```ts
let idx
if (runs.length === 1) idx = 0
else if (result.action === 'Break' && result.partialTrailingContent) idx = result.partialTrailingContent.trailingRunIndex
else return undefined
if (!runs[idx].item.isText) return undefined
if (runs[idx].item.isWhitespace && runs[idx].item.width === undefined) return undefined
if (isFirstFormattedLine && run.style !== item.style && !fontCascadeEqual) return undefined
if (result.action === 'Wrap') return runs[idx].contentWidth
if (result.action === 'Break' && result.partialTrailingContent.partialRun)
  return fround(runs[idx].contentWidth - result.partialTrailingContent.partialRun.logicalWidth)   // not clamped, not re-measured
return undefined
```
- It becomes `LineLayoutResult.contentGeometry.trailingOverflowingContentWidth` (`IL/TextOnlySimpleLineBuilder.cpp:122`; `IL/InlineLineBuilder.cpp:371`), then `PreviousLine.trailingOverflowingContentWidth` (`IL/InlineFormattingContext.cpp:357`).
- On the next line the rest of the item, `item.right(length - offset, carried)`, keeps the carried value as its stored width (`IL/TextOnlySimpleLineBuilder.cpp:141-154`; `IL/InlineLineBuilder.cpp:480-496`; `IL/InlineTextItem.cpp:65-71`). `commitCandidateContent` and `inlineItemWidth` use that width unchanged (`IL/TextOnlySimpleLineBuilder.cpp:312-316, 333`; `IL/InlineFormattingUtils.cpp:303-304`).
- If the rest still overflows, `breakWord` runs on it with `textWidth = carried`, measuring prefixes *from the rest's start*. The following carry is `carried - freshPrefixWidth`. Remainders compound: `carry_n = carry_(n-1) - prefix_n`.
- With no carried value (multi-run candidate + Wrap, whitespace without width, first-line font change) the rest is measured fresh as `TextUtil::width(rest, left)`, with the following-space extension.
- The carried value is used only for a rest that starts mid-item (`offset > 0`). A whole item that wrapped keeps its stored width.

State the next line starts from:
1. `InlineItemPosition { index, offset }` (`IL/InlineLineTypes.h:62-68`);
2. `trailingOverflowingContentWidth`;
3. `endsWithLineBreak`, used by `text-indent: each-line` and by `unicode-bidi: plaintext` direction (`IL/InlineLineBuilder.cpp:194-204, 452-453`);
4. the inline base direction;
5. suspended floats;
6. whether the first formatted line has passed, which picks `::first-line` style (`IL/InlineFormattingContext.cpp:331-334`).

The wrap opportunity list and all trimmable and hanging state restart empty.

[G] 'AV'.repeat(17), 16px Arial, 112.75–114.75px: carry gives line starts [0, 11, 22], a fresh measurement gives [0, 11, 22, 33]. Headless WebKit DOM agreed with carry on 36 of 36 cases.

### 8.3 Soft hyphens under `hyphens: manual` [V]

1. Items are cut after each U+00AD, since the break iterator allows a break there; the item gets `hasTrailingSoftHyphen` (`IL/InlineItemsBuilder.cpp:1022-1026`). The SHY itself measures 0: it is a default-ignorable glyph and gets deleted (`G/WidthIterator.cpp:812-815`; `G/FontCascadeInlines.h:145-158`).
2. Placing such an item sets `line.trailingSoftHyphenWidth = hyphenWidth(style)` (`IL/InlineLine.cpp:479-480, 554-555`).
3. Simple builder: the item's candidate is tested without the hyphen. When the next candidate overflows and the breaker returns Wrap, `processInlineContent` compares the line's hyphen width with the available width, which includes the 1/64 epsilon: `>` means RevertToLastNonOverflowingWrapOpportunity, otherwise WrapWithHyphen adds the hyphen to the line (`IL/InlineContentBreaker.cpp:114-120`).
4. LineBuilder: the candidate ending in SHY already includes the hyphen width (§6.2). If `w(item) + hyphen` exceeds the available width while `w(item)` alone fits, `processOverflowingContentWithText` finds no overflowing run and returns no break position. With content already on the line the result is Wrap, and the whole candidate moves to the next line even if the following text would have fit without a hyphen (`IL/InlineContentBreaker.cpp:835-838, 274-295`).
5. A hyphen added to the line increases the last text run's width and `contentLogicalWidth` (`IL/InlineLine.cpp:609-619`). The display box text gets `hyphenString` appended (`IL/display/InlineDisplayContentBuilder.cpp:280`).
6. `hyphens: none` merges items across SHY, so no break happens there (`IL/InlineItemsBuilder.cpp:1016-1021`; `IL/text/TextUtil.cpp:388-389`).

## 9. Line ending and the width a line reports

### 9.1 Trailing white space [V]

- **Collapsible** (`normal`, `nowrap`, `pre-line`): a whitespace item is fully trimmable (`IL/InlineTextItem.cpp:97-100`).
  - While the line fills, it always fits: the breaker keeps fully trimmable content (`IL/InlineContentBreaker.cpp:166-169`).
  - When the next word does not fit, the space still counts in `contentLogicalRight`. So `w(word1) + w(space) + w(word2) <= avail` is the test for the second word.
  - At line end `handleTrailingTrimmableContent(Remove)` subtracts the space and any word-spacing offset (`IL/InlineLine.cpp:112-125, 745-778`).
  - Exception: `line-break: after-white-space` preserves it unless this is the last line and nothing overflows (`IL/TextOnlySimpleLineBuilder.cpp:427-430`; `IL/InlineLineBuilder.cpp:643-646`).
- **pre-wrap** (preserve + wrap): white space hangs (`IL/text/TextUtil.cpp:444-448`).
  - In the fit test a candidate of only hanging white space always Keeps (`IL/InlineContentBreaker.cpp:181-182`), so preserved spaces never push content to the next line, however wide they are.
  - The line's `contentLogicalWidth` includes them.
  - At line end the hang is *conditional* if the line is the paragraph's last line or ends in a forced break (`IL/InlineLine.h:370-376`; `IL/InlineLine.cpp:207-221`): the spaces stop hanging when `contentLogicalWidth <= lineWidth`.
  - Otherwise the hang is unconditional.
- **break-spaces**: nothing hangs and nothing is trimmed.
  - Each preserved space is its own item, and there is no wrap opportunity *before* a space (`IL/TextOnlySimpleLineBuilder.cpp:200, 213-214`; `IL/InlineFormattingUtils.cpp:418-420`).
  - An overflowing space finds no break rule and moves to the next line together with the word before it, as Wrap, when the line has content (`IL/InlineContentBreaker.cpp:857-862, 274-295`).
- **pre / nowrap**: one candidate per forced-break segment. It never breaks, and it Keeps on an empty line (§5).
- **NBSP quirk** with `-webkit-nbsp-mode: space`, wrapping, not break-spaces: trailing NBSP runs of an overflowing line are removed up to the overflow amount (`IL/InlineLine.cpp:127-175`; `IL/InlineQuirks.cpp:45-51`). The default nbsp-mode is normal, so this is off by default [I: default not re-read].
- **RTL**: after trimming, trailing whitespace runs return to the paragraph's bidi level (UAX#9 L1). A mixed run's trailing white space is detached into its own run (`IL/InlineLine.cpp:243-287`).

### 9.2 Reported widths [V]

- `LineLayoutResult.contentGeometry.logicalWidth` = `Line::close().contentLogicalWidth` = f32 content width after trimming (§4), plus cloned-decoration ends (`IL/InlineLine.cpp:87-110`). It includes:
  - the letter-spacing after the last glyph;
  - an added hyphen;
  - pre-wrap spaces, hanging or not.
- `LineLayoutResult.lineGeometry.logicalWidth` = the line rect width (the available width without the epsilon) (`IL/TextOnlySimpleLineBuilder.cpp:123`; `IL/InlineLineBuilder.cpp:372`).
- The root inline box width is `contentWidth - hangingWidth` for LTR and `contentWidth` for RTL (`IL/InlineLineBoxBuilder.cpp:46-63`). `hangingWidth` is 0 when a conditional hang did fit (§9.1).
- Text display boxes use each line run's `logicalLeft`/`logicalWidth` offset by the root inline box left (`IL/display/InlineDisplayContentBuilder.cpp:131`). `Range.getClientRects()` on the text returns these run rects [I: through `InlineIterator`, not traced].
- Horizontal alignment offset (`IL/InlineFormattingUtils.cpp:198-276`): with a hanging width, `contentRight = min(contentRight, lineWidth)` if the hang is conditional, else `contentRight - hangingWidth`. Then `space = lineWidth - contentRight`, and it is used only if `space > 0`. start → 0; end → space; center → space / 2.

### 9.3 Bidi and direction [V]

- An RTL root, or content with strong RTL characters, runs `breakAndComputeBidiLevels` (`IL/InlineItemsBuilder.cpp:127-130, 637-775`). The paragraph text replaces non-preserved LF and TAB with spaces (`:383-415`), adds bidi controls for inline boxes (`:430-476, 599-615`), and puts `\n` at forced breaks (`:535-548`). `ubidi_setPara` gets level LTR/RTL, or `UBIDI_DEFAULT_LTR` for `unicode-bidi: plaintext` (`:666-680`). Text items are split where levels change (`:716-723`).
- Items are measured *after* splitting and with an LTR TextRun, unless `unicode-bidi` is an override (`IL/text/TextUtil.cpp:89-90`). Line filling proceeds in logical order; reordering happens only for display (`IL/InlineLineBuilder.cpp:364-366`).
- A different bidi level forces a new line run (`IL/InlineLine.cpp:381-382`), which changes the f32 grouping (§1.5).
- Shaping across inline boxes, `TextShapingAcrossInlineBoxes` (default true, `PREFS:8489-8501`; `Source/WebCore/layout/LayoutState.cpp:50`; `IL/InlineFormattingContext.cpp:569-570`), applies only in LineBuilder. For a candidate whose text spans inline boxes, it finds ranges of complex-path RTL text with the same font joined by decoration-free, non-isolating boxes (`IL/InlineLineBuilder.cpp:780-918`). It shapes the joined string as one RTL TextRun and gives each run the sum of `max(0, glyphAdvance)` over its characters. The candidate width becomes that total (`:920-979`). A partial commit reshapes (`:981-1028, 1691-1692`). None of these widths are Canvas totals of the pieces.

## 10. Property matrix and runtime settings

| Property | Effect on line filling | Citations |
| --- | --- | --- |
| `white-space: normal` | collapse + wrap; trailing spaces trimmed | §9.1 |
| `nowrap` | collapse + no wrap: one candidate per segment; trimmed | `IL/TextOnlySimpleLineBuilder.cpp:110, 264-307` |
| `pre` | preserve + no wrap; tabs allowed (`tab-size`) | `IL/text/TextUtil.cpp:91-92, 424-442` |
| `pre-wrap` | preserve + wrap; spaces hang | §9.1 |
| `pre-line` | collapse spaces and tabs, preserve LF as soft line break items | `ST/computed/StyleComputedStyle+GettersInlines.h:266-269`; `IL/text/TextUtil.cpp:431-436` |
| `break-spaces` | one item per space or tab; no break before a space; no hang | `IL/InlineItemsBuilder.cpp:972-978` |
| `word-break: normal` | break positions only (another spec) | — |
| `word-break: break-all` | mid-word split of the overflowing run even with content on the line; `canBreakBefore` adjusts the split | `IL/InlineContentBreaker.cpp:886-887, 515-577` |
| `word-break: keep-all` | no emergency rule unless `overflow-wrap` allows one | `:912-913` |
| `word-break: break-word` | like `overflow-wrap: anywhere` when the line has no earlier wrap opportunity | `:903-904` |
| `overflow-wrap: break-word` / `anywhere` | `breakWord` split only while the wrap list is empty; min-content ignores `break-word` | `:908-910` |
| `line-break: anywhere` | always AtArbitraryPosition; soft wrap around every character between text items | `:882-883`; `IL/InlineFormattingUtils.cpp:422-425` |
| `line-break: loose` | `canBreakBefore` allows U+2010 and U+2013; iterator mode Loose | `IL/InlineContentBreaker.cpp:129-132`; `IL/text/TextUtil.cpp:450-466` |
| `line-break: normal` / `strict` | iterator mode only | same |
| `hyphens: manual` + U+00AD | §8.3 | |
| `hyphens: none` | SHY merges items | `IL/InlineItemsBuilder.cpp:1016-1021` |
| `letter-spacing` | added after each non-zero-advance glyph including the last; never trimmed; disables simplified measuring; DOM turns ligatures off | `G/WidthIterator.cpp:508-516`; §4; `ST/computed/StyleComputedStyleBase.cpp:312-337` |
| `word-spacing` ≠ 0 | LineBuilder only; items exclude it; the line adds it before each word-separator run and in the offset of the item after a separator inside a candidate; trimmed with trailing spaces | `IL/text/TextUtil.cpp:98-99`; `IL/InlineLine.cpp:411, 448`; `IL/InlineContentBreaker.cpp:968-972` |
| `tab-size` | stop formula §3.3; pen relative to the line content start | `G/FontCascadeInlines.h:76-94` |
| `text-transform` | measured text is transformed text | `R/RenderText.cpp:1763-1805` |
| `direction: rtl`, bidi | LineBuilder; §9.3 | |
| `lang` (paragraph or span) | locale of the iterator per text node; at a node boundary the *next* node's locale decides; shaping language through `computedLocale` | `IL/InlineItemsBuilder.cpp:950`; `IL/text/TextUtil.cpp:384` |
| `text-indent` | LineBuilder; line rect narrowed; pen offset | `IL/InlineLineBuilder.cpp:453-478` |
| `text-wrap: balance|pretty` | LineBuilder with per-line width overrides from InlineContentConstrainer (not covered) | `IL/InlineFormattingContext.cpp:162-168`; `PREFS:1558-1570` |
| zoom, DPR | §1.6 | |

Runtime settings on at 27.0 that change results [V]:
- `TextShapingAcrossInlineBoxes: true` (`PREFS:8489-8501`), §9.3.
- `CSSTextWrapPrettyEnabled: true` (`PREFS:1558-1570`): `text-wrap-style: pretty` parses and selects the constrainer.
- `CSSWordBreakAutoPhraseEnabled: false` (`PREFS:1659-1672`): `word-break: auto-phrase` is off by default.
- `SubpixelInlineLayoutEnabled: true` (`PREFS:8160-8172`): vertical metrics only.
- `hyphenate-limit-lines`: after N successive hyphenated lines, automatic hyphenation turns off (`IL/InlineLayoutState.h:66`; `IL/InlineLineBuilder.cpp:446`). It does not affect manual SHY.

## 11. What Canvas can supply

Canvas `measureText` (`C/CanvasRenderingContext2DBase.cpp:3064-3086`):
1. `normalizeSpaces` turns U+0009, U+000A, U+000B, U+000C and U+000D into U+0020 (`:2847-2875`);
2. builds `TextRun(text, xpos 0, direction = ctx.direction, characterScanForCodePath = true)`;
3. returns `FontCascade::width(run, &glyphOverflow)`, the same function the DOM's non-simplified path calls (`G/FontCascade.cpp:304-379`).

The canvas text attributes are only `font`, `textAlign`, `textBaseline`, `direction`, `letterSpacing` and `wordSpacing` (`C/CanvasTextDrawingStyles.idl:29-34`). An OffscreenCanvas font starts from a fresh description with no locale (`C/OffscreenCanvasRenderingContext2D.cpp:115-121`). The FontCascade constructor clears `shouldDisableLigaturesForSpacing` (`G/FontCascade.cpp:74-82`).

**Exact from Canvas totals** (named fonts that cover the text, no page-language font choice, font size already multiplied by page zoom):

| Width fact | Recipe | Notes |
| --- | --- | --- |
| Non-whitespace item or prefix `text[a..b)` | `b < len && text[b] === ' '` ? `max(0, fround(fround(M(text[a..b] + ' ')) - fround(M(' '))))` : `max(0, M(text[a..b]))` | §3.3. The DOM simplified path sums primary-font glyphs without restoring space advances; [G] 0 items differed. With word-spacing set on the context, subtract `M(' ') + wordSpacing`; simpler to measure with word-spacing 0. |
| `singleSpaceWidth` | `M(' ')` | |
| Preserved white space without TAB, length > 1 | `M(ws)` | |
| `breakWord` probe widths | same recipe as items, on `text[start..end)` of the current item or rest | A rest starts mid-word, so the strings depend on where the previous line broke; they are measured during layout, not before. |
| Hyphen width | `M('‐')` or `M('-')` | Canvas can't tell whether the primary font has U+2010: fallback would still give U+2010 a width. |
| Letter-spaced widths, text with no liga/clig/dlig/hlig ligatures | `ctx.letterSpacing = ls`, then the item recipe | The per-glyph rule is the same `WidthIterator` code. |
| Tab stop | `spaceWidth = M(' ')` (primary font space advance, when the primary font has a space and no synthetic bold); formula §3.3 with the pen position from f32 sums | Canvas turns TAB into a space, so the tab itself is computed statically. If letter-spacing ≠ 0 the tab also gets `ls` when its glyph advance is non-zero [I: font dependent]. |
| Available width, fit tests, carried remainder, trimming, hanging | static f32 arithmetic on the values above | §1.4, §8.2 |

**Not supplied by Canvas totals**:
1. Break positions, bidi levels and item splits: static data plus a resolver matching ICU `ubidi`.
2. FF, VT and other C0 controls: the DOM uses the .notdef advance, Canvas a space.
3. CR: on the simple path the DOM keeps the advance of the font's glyph for U+000D (`G/WidthIterator.cpp:792-799`); on the complex path it is 0 (`G/ComplexTextController.cpp:762-768`); Canvas measures a space.
4. Letter-spaced text whose font forms ligatures: DOM spacing disables them and Canvas does not, and no canvas attribute can disable them.
5. Page language for generic families and fallback: OffscreenCanvas has no locale.
6. Shaping across inline boxes (§9.3): per-character glyph advances of a joined RTL string.
7. Whether the fixed-pitch fast path applies, which depends on font traits (`G/FontCascade.cpp:414-421`).
8. The RTL trailing-space re-measure: it *is* two Canvas totals, but it needs the run's last non-whitespace start, which is static (`IL/InlineLine.cpp:972-982`).

## 12. Hypotheses to probe in installed Safari 27.0

Common setup unless stated: `<html lang="en">`, a `<div>` with `font: 16px Arial; line-height: 20px`, content-box `width` as given, no padding or border. `M()` is measured on OffscreenCanvas with `font = "16px Arial"`. `f()` is `Math.fround`. `T(x)` is `Math.trunc(x * 64) / 64`. The expected outcome follows from the source; "lines" means line count and line starts.

1. **Fit tolerance.** Text `"ab cd"`. Let `s = f(f(M('ab ') - M(' ')) + M(' '))` and `w = f(s + M('cd'))`. At `width: T(w)px` expect 1 line if `w <= T(w) + 1/64`, else 2. At `width: (ceil64(w) - 2/64)px` expect 2 lines whenever `w > ceil64(w) - 1/64`. (§1.4)
2. **Width truncation.** Same text. `width: (k/64 + 0.01)px` gives the same lines as `width: (k/64)px` for every k, because 0.01px is less than 1/64 (`platform/LayoutUnit.h:83-86`).
3. **Following-space measurement.** Text `"AV AV"` in 16px Georgia. Choose `W = T(f(f(M('AV ') - M(' ')) + M(' ') + f(M('AV ') - M(' '))))`. Expect 1 line, and the first text box (Range over "AV") is `M('AV ') - M(' ')` wide, not `M('AV')`. [G] the recipe was bit-exact on 26.x.
4. **Carried remainder.** `"AV".repeat(17)`, `overflow-wrap: anywhere`, widths 112.75, 113.5 and 114.75px. Expect starts [0, 11, 22] (3 lines), as the carry model predicts (§8.2). A fresh measurement of the rest would give [0, 11, 22, 33].
5. **Builder difference: hyphen in the fit test.** A: `<div>x foo&shy;i</div>`. B: `<div><span>x</span> foo&shy;i</div>`. Let `wx = f(M('x ') - M(' '))`, `ws = M(' ')`, `wf = M('foo­')`, `wi = M('i')`, `H = M('‐')` (or `M('-')` if Arial lacks U+2010). Let `L = f(f(f(wx + ws) + wf) + wi)` and `Lh = f(f(f(wx + ws) + wf) + H)`. The probe needs `H > wi`. Choose `W` so that `L <= T(W) + 1/64 < Lh`. Expect A (TextOnlySimpleLineBuilder): 1 line "x fooi". Expect B (LineBuilder): 2 lines, "x" / "fooi". (§2 difference 1; §8.3)
6. **Builder difference: hyphen revert epsilon.** A: `<div>aa&shy;bb&shy;cc&shy;dd</div>`; B: the same with `<span>a</span>` in place of the first "a". Choose `W` so that "dd" overflows after "aabbcc", `H > T(W) + 1/64 - w(aabbcc)`, and `T(W) - w(aabb) < H <= T(W) + 1/64 - w(aabb)`. Expect A: line 1 "aabb‐". Expect B: line 1 "aa‐" (LineBuilder's loop tests "bb" without the epsilon and falls back to the first opportunity). (§2 difference 2)
7. **Trailing letter-spacing counts and isn't trimmed.** `letter-spacing: 4px`, text `"abc abc"`. Let `a = f(M_ls('abc ') - M_ls(' '))` with `ctx.letterSpacing = '4px'`. At `W = T(a)` expect 2 lines, and the first line's box is `a` wide (it includes 4px after "c"). At `W = T(a) - 1/64 - 0.01` expect 3 lines, or "abc" overflowing on its own first line.
8. **overflow-wrap splits only without an earlier opportunity.** `"aa bbbbbbbbbbbbbbbbbbbb"`, `overflow-wrap: anywhere`, `W = T(M('aa bbbb'))`. Expect line 1 "aa", line 2 starts with "b". With `word-break: break-all` instead, expect line 1 "aa b…", with as many b's as `breakWord` fits.
9. **First unit on an empty line, 8-bit vs 16-bit.** `width: 1px; overflow-wrap: anywhere`. A: `"W)))iiii"` (8-bit). B: `"W)))iiii一"`. Expect A line 1 = "W" and B line 1 = "W)))". Only the 16-bit path skips break-before-punctuation positions (`IL/InlineContentBreaker.cpp:139-158`). The groundwork's 26.5.2 reading lacked this function, so 26.x would give "W" for both.
10. **break-all with `line-break: loose`.** `word-break: break-all; width` narrow enough to split `"aaaa‐bbbb"` just before U+2010. Expect `line-break: auto` to move the split earlier (no break before U+2010), and `loose` to allow the split right before U+2010. (`canBreakBefore`, §7.1)
11. **pre-wrap spaces hang; break-spaces wrap.** `"abc      def"` (6 spaces), `W = T(M('abc') + M(' '))`. pre-wrap: 2 lines, "abc      " / "def", and the first root inline box width excludes the unconditionally hanging spaces. break-spaces: the spaces spread over lines; no line starts with the white space that ended a previous word. nowrap/pre: 1 line.
12. **Collapsible trailing space is trimmed from the reported width.** `text-align: right`, `"abc def"`, `W = T(M('abc ') - M(' ') + M(' ')) + 1/64`. Expect 2 lines; line 1 is right-aligned with offset `W - f(M('abc ') - M(' '))`, since the space is trimmed.
13. **White-space-only node.** `<div>\r</div>` and `<div> \t\n\f</div>` produce height 0 (no renderer), while `<div></div>` produces one line (`R/updating/RenderTreeUpdater.cpp:536-590`; `WTF/ASCIICType.h:154-157`).
14. **Control characters in the DOM vs Canvas.** `white-space: pre`, text `"ab"`. Expect the text box width to be `M('a') + notdefAdvance + M('b')`, not `M('a b')`. For `"a\rb"` expect a width different from `M('a b')` unless Arial's U+000D glyph advance equals its space.
15. **Tab stops.** `white-space: pre; tab-size: 4`, text `"a\tb"`. Expect b's left = `f(M('a')) + tab`, where `base = 4 * M(' ')`, `tab = base - fmod(M('a'), base)`, plus `base` if `tab < M(' ')/2`. With `tab-size: 1` and a text starting `"aa\t"` where `fmod(w(aa), M(' ')) > M(' ')/2`, the tab jumps a whole extra space.
16. **DPR does not change breaks.** Probes 1, 4 and 8 give identical line starts on a Retina (DPR 2) and a non-Retina (DPR 1) display. Exception: `border-left: 0.7px solid` changes the content box (1px vs 0.5px border) and so the breaks (`ST/values/backgrounds/StyleLineWidth.cpp:46-61`).
17. **Page zoom.** At 125% page zoom, probe 1's lines equal those of an unzoomed page with `font-size: 20px` and `width: T(1.25 * W)`.
18. **Styled runs.** `<div>foo<b>bar</b> baz</div>`, `W = T(M('foo')) + 1/64`. Expect no break between "foo" and "bar": line 1 "foobar" overflows and "baz" is on line 2 (`mayBreakInBetween`, §5). With `overflow-wrap: anywhere` the split happens inside "foobar" by `breakWord` per run, and the carried remainder applies only to the run that was split.
19. **text-transform.** `text-transform: uppercase`, `"straße straße"`, `W = T(M('STRASSE'))`. Expect 2 lines, and the text box widths equal the Canvas recipe on "STRASSE".
20. **Single-character paragraph.** `<div style="width:0">W</div>`: 1 line, box width `M('W')`, no fit test. Same for `<div style="width:0"><span>W</span></div>`.
21. **Hanging whitespace alignment.** `white-space: pre-wrap; text-align: right`, text `"abc   "` alone. If `w(abc) + 3*M(' ') <= W`, the spaces are part of the content (offset `W - (w(abc) + 3*M(' '))`). Otherwise the content right is clamped to W (offset 0).
22. **Rest measured fresh when the style differs on the first line.** `::first-line { font-size: 16px }` against a 16px paragraph (equal fonts): the carry is kept. With `::first-line { letter-spacing: 1px }` the rest is measured fresh (`IL/AbstractLineBuilder.cpp:84-91`).

## 13. Differences from the groundwork's readings, verified at 7625.1.29.11.27

The groundwork (`pretext-emulation-20260915/research/webkit-source.md`, `results-wf4-webkit.txt`) read Safari 26.5.2 (`7c696f57`, copies in `research/webkit-safari/`). I diffed those copies against the pinned files.

1. **First unit on an empty line.** 26.5.2 kept one grapheme or code point. 27.0 has `firstCharacterBreakRespectingLineStartProhibitions`, which for 16-bit text extends the kept unit over characters that `canBreakBefore` rejects (`IL/InlineContentBreaker.cpp:139-158, 228-232`). The groundwork said only trunk had it. Probe 12.9.
2. **Preserved single-space measurement.** 26.5.2 had `auto length = from - to`, so the length-1 test never matched. 27.0 tests `to - from == 1 && content[from] == ' '` and returns `singleSpaceWidth` (`IL/text/TextUtil.cpp:116-120`).
3. **When item widths are measured.** The groundwork cited a separate pass, `computeContentAttributesAndInlineTextItemWidths` (26.5.2 `InlineItemsBuilder.cpp:755-822`). In 27.0 widths are measured while items are created (`IL/InlineItemsBuilder.cpp:980-987, 1030-1035`). The separate pass `computeInlineTextItemWidthsAndTextSpacing` runs only for visual reordering or text-autospace (`:132-133, 804-856`). Values are the same `TextUtil::width` calls.
4. **TextOnlySimpleLineBuilder style eligibility.** 27.0 also rejects `word-break: auto-phrase`, `box-decoration-break: clone` and `display: ruby-text` (`IL/TextOnlySimpleLineBuilder.cpp:506-513`). RangeBasedLineBuilder also rejects negative margins (`IL/RangeBasedLineBuilder.cpp:153`).
5. **Simplified display build** (`IL/TextOnlySimpleLineBuilder.cpp:530-548`; `IL/InlineFormattingContext.cpp:172-177, 430-443`) is new. It builds display boxes only and does not change breaks.
6. **Line numbers moved.** LineBuilder `availableWidth` is at `IL/InlineLineBuilder.cpp:1172-1183` (groundwork 1138-1149). Candidate SHY width is at `:1154-1165` (groundwork 1120-1131). `hyphenString` moved from `RenderStyle.cpp:288-304` to `ST/computed/StyleComputedStyle.cpp:419-434`, with the same logic plus `hyphenate-character`. Canvas `normalizeSpaces` is at `C/CanvasRenderingContext2DBase.cpp:2847-2875` and `measureTextInternal` at `:3064-3086`.
7. **Canvas and the width cache.** The groundwork said canvas bypasses the text measurement cache. In 27.0 `FontCascade::width` uses `glyphGeometryCache` even with a `GlyphOverflow` when `computeBounds` matches (`G/FontCascade.cpp:319-352`). The cache stores the computed value, so widths are unaffected [I].
8. **Still true.** Trailing letter-spacing is not trimmed: `addPartiallyTrimmableContent` still has no caller, and the one caller of `removePartiallyTrimmableContent` is guarded by a flag that is never set (`IL/InlineLine.cpp:322-326, 734-743`).
9. **The groundwork's open question on 55 contradicted carry rows.** The source gives no carry for a multi-run candidate that Wraps, for whitespace without a stored width, or when the first-line font differs (`IL/AbstractLineBuilder.cpp:59-91`). The carry is used only when the next line starts mid-item. [I] this explains those rows; not re-measured.
10. **`PreviousLine`** gains `hasContentfulInFlowContent` (`IL/InlineLineTypes.h:89`). It is used for block margins, not text.
11. **Builder-specific soft hyphen handling** (§2 differences 1 and 2) was not in the groundwork. Its emulator ported both builders and matched 26.5.2 rows, but no suite row isolated those cases [I].

## 14. Open questions and gaps

- Is `-webkit-nbsp-mode` initially `normal` at 27.0? Not re-read in style code.
- CoreText's advance for U+000D in common fonts, which decides probe 12.14's CR case.
- Whether OffscreenCanvas applies page zoom to its font. The source suggests not (§1.6); needs a probe.
- `InlineContentConstrainer` (`text-wrap: balance|pretty`), hyphens: auto, ruby, floats, atomic inlines and cloned decorations are not covered.
- The `::first-line` style path is only noted (§8.2).
- `IntrinsicWidthHandler` (min/max-content) is not covered. It runs the same builders with `IntrinsicWidthMode` (no epsilon for min-content, §1.4).
