# WebKit observation model: Range geometry of text in Safari 27.0

Pinned source: WebKit 7625.1.29.11.27 at `~/github/browser-engines/webkit-7625.1.29.11.27`. Paths are relative to
`Source/WebCore/` unless they start with `Source/WTF/` or `rebuild/`. Evidence from lab rows is an offline census
(section 11); no browser ran.

Terms used here:

- **Display box**: one `InlineDisplay::Box` of type Text, WordSeparator or SoftLineBreak. WebKit makes one per text or
  soft-line-break `Line::Run` of a line. A text node spread over three lines, or split by a bidi level change on one
  line, has several.
- **Whole-box range**: a Range whose clamped start is at or before a box's start and whose clamped end is at or after
  the box's end.
- **Partial range**: any other Range that reports on a box.
- **trunc64(v)**: `LayoutUnit(double)`, `Math.trunc(v × 64) / 64`, which rounds toward zero (`platform/LayoutUnit.h:83-86`).
  **ceil64(v)**: `LayoutUnit::fromFloatCeil`, `Math.ceil(f32(v × 64)) / 64` (`LayoutUnit.h:93-96`). **f32**: `Math.fround`.
- **In-context advances**: the per-glyph advances CoreText gives when WebKit shapes a box's whole text once, with
  WebKit's adjustments. Canvas can only measure strings on their own, so it can't see them.

## 0. Answer first

`Range.getClientRects()` over text returns one rect for each display box of the range's text node that the range
touches. There are two kinds:

1. **Whole-box rect.** The display box's float32 rect, unsnapped. Its width is `f32(f32(x + w) − x)`.
2. **Partial rect.** A selection rect computed in LayoutUnits from in-context advances:
   - x is floored to a whole CSS px;
   - the right edge is ceiled to a whole px and then clamped to `trunc64` of the box's right edge;
   - y and height are `trunc64` of the box's;
   - a zero advance stays zero width.

What the lab can compare exactly:

- per text node, the display box list (count, order, x bits, width bits);
- per line, the extent as the union of its boxes, including hanging white space and a chosen hyphen, and without
  trimmed spaces;
- per code point, which boxes report a rect, and so which lines;
- the x of a caret rect at a box start.

What is unobservable by rule:

- code point edges inside a box;
- how a glyph's advance is shared between the code points it covers;
- y and height;
- whether trailing white space hangs, under `text-align: start`;
- which hyphen glyph was drawn, when the two advances are equal;
- collapsed white space after the first unit of a collapsed run;
- anything at page zoom ≠ 1, or with a length-changing `text-transform`.

So under tentpole 2 the scorer's Safari width rules no longer decide widths: visible code points, trailing runs, `boxEdge`,
the soft-hyphen and other-space exclusions (`rebuild/lab/score.ts:182-289`). The WebKit port's `paintedExtent`, which
copies those rules (`rebuild/src/engines/webkit/lines.ts:1489-1565`, audit D1), goes too. The engine emits display
boxes, and the lab compares whole-node rects with them.

## 1. What the lab calls

- `rebuild/lab/page.ts:188-201`: for every code point, `range.setStart(node, i)`, `setEnd(node, i + len)` on the run's
  own text node, then `getClientRects()`.
- `page.ts:202-210`: `runRects`, `selectNodeContents(node)` per run.
- `page.ts:110-112`: rects are made relative to the paragraph's `getBoundingClientRect()`. The paragraph is absolutely
  positioned at (0, 0), so the subtraction is exact.

## 2. Call chain

```
Range::getClientRects                          dom/Range.cpp:1109-1113
  → RenderObject::clientBorderAndTextRects     rendering/RenderObject.cpp:2359-2362  (behavior = {})
  → borderAndTextRects(range, Client, {})      :2278-2352
      text node with a renderer → absoluteRectsForRangeInText      :2193-2246
        move edges off surrogate pair middles                      :2200-2203
        RenderText::absoluteQuadsForRange(start, end, {})          rendering/RenderText.cpp:761-832
        boundingBoxes(quads)                                       FloatQuad::boundingBox, platform/graphics/FloatQuad.cpp:90-99
      Document::convertAbsoluteToClientRects                       dom/Document.cpp:9705-9720
```

- None of IgnoreEmptyTextSelections, UseSelectionHeight or ComputeIndividualCharacterRects is set
  (`RenderObject.h:848-859`). So every box is visited, heights come from the box, and there is no per-character rect
  pass.
- A text node without a renderer reports nothing (`RenderObject.cpp:2195-2197`).
- A Range inside one text node intersects no element, so no span border boxes are added (`:2290-2336`).

## 3. Units and rounding

| Value | Unit and rounding | Source |
|---|---|---|
| Display box x, width | float32 CSS px (`InlineRect` of `InlineLayoutUnit`, `FloatRect`) | `layout/formattingContexts/inline/display/InlineDisplayBox.h:122-132` |
| Whole-box DOMRect x | box x plus the block's absolute x, in float32 (the lab's block is at 0) | `RenderText.cpp:811-826`, `localToAbsoluteQuad` |
| Whole-box DOMRect width | `f32(f32(x + w) − x)`: quad corners, then `right − left` in float | `FloatQuad.cpp:90-99` |
| Partial rect x | `trunc64` after each float move, then floored to a whole px | `LayoutPoint.h:62`, `LayoutUnit.h:88, 490-493, 550-554`, `platform/graphics/LayoutRect.cpp:206-213` |
| Partial rect width | `ceil64(after − before)`, whole-px `enclosingIntRect`, clamped to `trunc64(right − x)` | `FontCascade.cpp:1668-1681`, `rendering/LegacyInlineTextBox.cpp:146-160` |
| Partial rect y, height | `trunc64(box y)`, `trunc64(box height)` | `RenderText.cpp:722-739` (float assigned to a `LayoutRect`) |
| Client conversion | scaled by `inverseFrameScale` when it isn't 1, then moved by the scroll offset | `Document.cpp:9711-9719` |

- Device pixel ratio changes none of these values. Text rects aren't snapped to device pixels, and WebKit's LayoutUnit
  is 1/64 CSS px at any DPR.
- At page zoom 1 with no scroll, the client conversion is the identity.
- `FloatRect::isZero` means zero size (`FloatRect.h:101`). A partial rect with zero width and positive height is kept
  (`RenderText.cpp:829-830`). A whole-box rect is kept unconditionally.

## 4. Engine input: display boxes

The observation port needs the closed `Line::Run` list of every line, after four steps:

- trimming (`InlineLine.cpp:745-778`);
- the trailing bidi reset (`:243-287`);
- `addTrailingHyphen` (`:609-619`);
- `handleTrailingHangingContent` (`:198-233`).

It then turns each text or soft-line-break run into one display box (`InlineDisplayContentBuilder.cpp:118-144, 196-302,
305-325`).

```ts
type DisplayBox = {
  run: number               // the text node (paragraph run index)
  start: number; end: number   // UTF-16 offsets into the node's content (InlineDisplay::Box::Text start/length)
  hasHyphen: boolean; hyphenString: string   // needsHyphen: rendered content is text + hyphenString (:279-281)
  kind: 'text' | 'soft-line-break'
  level: number             // bidi level after resetBidiLevelForTrailingWhitespace
  isWordSeparator: boolean
  line: number              // line index
  x: number; w: number      // float32 CSS px, section 5
  y: number; h: number      // float32; unobservable by rule (section 10)
}
```

Which content gets a run, and where runs split. Each rule cites `layout/formattingContexts/inline/InlineLine.cpp`:

- **Collapsing completely.** A collapsible white-space item leaves no run at a line start, or after a text run that
  already ends in collapsible white space, even across inline box edges (`:348-370` for `appendText`, `:483-495` for
  `appendTextFast`).
- **Collapsed white space.** A collapsible white-space item of two or more units adds only one unit to the run's content
  (`trailingWhitespaceType` Collapsed, `:813-822`, `:866-889`, `:891-914`). The next text starts a new run
  (`hasCollapsedTrailingWhitespace`, `:386-387`, `:500-501`). So `foo   bar` in one node on one line is two boxes:
  `[0, 4)` `"foo "` and `[6, 9)` `"bar"`. Units 4 and 5 are in no box.
- **Other run splits** in `appendText` (`:375-402`):
  - another layout box, meaning a text node or span edge;
  - another bidi level;
  - a last run that isn't text;
  - non-zero word spacing at a word separator;
  - a ZWSP separator item (`InlineTextItem.cpp:84-88`);
  - a quirk no-break space;
  - an RTL change between preserved white space and other content;
  - a shaping boundary.

  `appendTextFast`, used by TextOnlySimpleLineBuilder, splits only on collapsed white space, another layout box, a ZWSP
  separator or a quirk no-break space (`:495-509`).
- **Trimmed trailing white space.** The run loses one unit, and its width loses the trailing white space width
  (`removeTrailingWhitespace`, `:963-988`). In RTL that width is measured again, and a run left with no content is
  removed (`:771-775`). `foo bar` broken after the space gives line 1 `[0, 3)` and line 2 `[4, 7)`.
- **Hanging white space** stays inside its run, width included. `detachHangingTrailingWhitespaceIfApplicable` runs only
  for `text-align: justify` (`InlineLineBuilder.cpp:693-699`).
- **Bidi trailing white space.** Trailing white space of a mixed run whose level parity differs from the root's is split
  off into its own run at the root level (`:268-286`).
- **A chosen soft hyphen** sets `needsHyphen` and adds the hyphen width to the last text run (`InlineLine.h:388-393`).
- **A preserved newline** is its own zero-width run, `{ position, 1 }` (`:856-865`).

How this maps onto the rebuild: the WebKit port already keeps this list as `LineRun`
(`rebuild/src/engines/webkit/lines.ts:28-42`: left, width, textStart, textLength, level, isWordSeparator). It has no
`needsHyphen`; the hyphen is a `Piece` (`:46-49`). The public `Fragment` list (`rebuild/src/model.ts:76-91`) can't
rebuild box boundaries. A `text` fragment doesn't say whether a collapsed white-space run, a ZWSP separator or a bidi
detach split it off. Engine-true output needs `boxes: DisplayBox[]` per line, built from the closed run list, not from
fragments.

## 5. Display box geometry

```ts
// InlineDisplayContentBuilder::build (:100-117): reorder only when the line has a visual order list, which every RTL
// paragraph has (:508-513).
function boxGeometry(line: ClosedLine, p: Paragraph): DisplayBox[] {
  const lineLeft = 0            // no floats or text-indent in the lab (m_displayLine.topLeft())
  if (!line.needsBidiReordering) {
    // processNonBidiContent :505-600 or buildTextOnlyContent :118-144; LineBox::logicalRectForTextRun InlineLineBox.cpp:58-73
    // rootInlineBoxLeft is 0 under text-align: start in LTR
    for (const run of line.runs) if (isTextOrSoftBreak(run))
      emit({ ...run, x: f32(lineLeft + f32(rootInlineBoxLeft + run.left)), w: run.width })
    return
  }
  // processBidiContent :862-940; with spans, handleInlineBoxes → adjustVisualGeometryForDisplayBox :744-768 and :1060-1066
  // redo the same sums from the same edge (spans have no margin, border or padding in the lab)
  let edge = p.direction === 'ltr'
    ? rootInlineBoxLeft
    : f32(lineBoxWidth − line.contentLogicalRightIncludingNegativeMargin)   // InlineDisplayLineBuilder.cpp:117-127
  for (const run of visualOrder(line.runs)) {           // skips word break opportunities and inline box ends (:888)
    if (run.kind === 'text') {
      const margin = run.isWordSeparator ? wordSpacing(run) : 0
      emit({ ...run, x: f32(lineLeft + f32(edge + margin)), w: run.width })   // InlineRect::setLeft moves the rect, InlineRect.h:229-235
      edge = f32(edge + f32(run.width + margin))
    } else if (run.kind === 'soft-line-break') {
      emit({ ...run, x: f32(lineLeft + edge), w: 0 })
    }
  }
}
```

- `lineBoxWidth` is the line's LayoutUnit-truncated available width as float.
- The RTL content edge is a float32 difference, and the boxes add up in float32. So the last box's right edge can sit one
  or two float32 steps from the content box edge, as in 336.0000305175781 for 336 (VALIDATION.md third pass).
- The port's `paintedExtent` already does these sums (`lines.ts:1504-1516`). It uses `lastRunLogicalRight(line)` where
  the source reads `contentGeometry.logicalRightIncludingNegativeMargin`. Those two aren't shown equal with hanging
  content (`InlineDisplayLineBuilder.cpp:126`).

## 6. Rects of a whole text node

```ts
// selectNodeContents → [0, length]; clamped to [caretMin, caretMax] it still covers every box.
function wholeNodeRects(node: number, boxes: DisplayBox[]): DOMRectLike[] {
  // RenderText::absoluteQuadsForRange :785-826 iterates textBoxesFor(renderer): the layout box's display boxes in box
  // index order, which is line order then visual order (LayoutIntegrationLineLayout.cpp:1048-1059,
  // InlineIteratorTextBox.cpp:71-102)
  return boxesOf(node, boxes).map(b => ({
    x: b.x,                                    // + block absolute x (0 in the lab)
    width: f32(f32(b.x + b.w) − b.x),          // FloatQuad::boundingBox
    y: b.y, height: f32(f32(b.y + b.h) − b.y), // unobservable by rule
  }))
}
```

Zero-width boxes are reported too: soft line breaks, a box holding only a ZWSP, or an unchosen soft hyphen alone on its
line. The census found 3,555 in installed Safari's dev rows.

## 7. Rects of one code point

```ts
function codePointRects(node: number, s: number, e: number, boxes: DisplayBox[]): DOMRectLike[] {
  const own = boxesOf(node, boxes)                       // no renderer, or no box at all → []
  if (own.length === 0) return []
  const caretMin = Math.min(...own.map(b => b.start))    // RenderText::caretMinOffset :2105-2116
  const caretMax = Math.max(...own.map(b => b.end))      // caretMaxOffset :2118-2127
  s = clamp(s, caretMin, caretMax); e = clamp(e, caretMin, caretMax)     // :777-783
  const out = []
  for (let k = 0; k < own.length; k++) {
    const b = own[k]
    if (s <= b.start && b.end <= e) { out.push(wholeNodeRects(node, [b])[0]); continue }   // :811-826
    const r = selectionRect(b, own[k + 1] ?? null, k === own.length − 1, s, e)            // :352-396
    if (r === null) continue                                                               // height 0 → skipped (:725-726)
    out.push({ x: r.x, width: r.width, y: trunc64(b.y), height: trunc64(b.h) })            // :728-733
  }
  return out
}

function selectionRect(b, next, isLast, s, e) {
  const len = b.end − b.start
  const extra = b.hasHyphen ? b.hyphenString.length : 0      // InlineIteratorBoxModernPath.h:76-97
  const clampOffset = (o: number) => {                        // TextBoxSelectableRange.h:40-54
    const c = clamp(o, b.start, b.end) − b.start
    return c === len ? c + extra : c
  }
  const cs = clampOffset(s), ce = clampOffset(e)
  if (cs >= ce) {
    if (s === e) {                                          // caret case :360-366
      const inside = isLast ? (s >= b.start && s <= b.end) : (s >= b.start && s < b.end)
      if (!inside) return null
    } else {                                                // :368-375
      const within = (s >= b.start && s < b.end) || (s === b.end && next !== null && next.start > b.end)
      if (!within) return null
    }
  }
  const rendered = content(b) + (b.hasHyphen ? b.hyphenString : '')          // InlineDisplayBox.h:51-52
  let xLU = 0, wLU = trunc64(b.w)                                            // LayoutRect { 0, …, logicalWidth } :384
  if (cs !== 0 || ce !== rendered.length) {                                  // :387-389
    // FontCascade::adjustSelectionRectForText :603-621. On macOS, kerning is on unless text-rendering is optimizeSpeed
    // (FontCascade.h:289-302), so a box longer than one unit takes the complex path (FontCascade.cpp:708-731; USE(FONT_VARIANT_VIA_FEATURES)
    // is only GTK/WPE, Source/WTF/wtf/PlatformUse.h:73-76), and a partial range can't be simple either (:673-684).
    const A = inContextAdvances(b, rendered)
    const before = A.upTo(cs), after = A.upTo(ce)
    xLU = trunc64(f32(xLU + (isRTL(b.level) ? f32(A.total − after) : before)))   // adjustSelectionRectForComplexText :1668-1681
    wLU = ceil64(f32(after − before))
  }
  xLU = trunc64(f32(xLU + b.x))                        // move(logicalLeftIgnoringInlineDirection) :393, InlineIteratorBoxInlines.h:36
  // snappedSelectionRect, LegacyInlineTextBox.cpp:146-160; enclosingIntRect keeps a zero width zero (LayoutRect.cpp:206-213)
  const X = Math.floor(xLU)
  const M = wLU !== 0 ? Math.ceil(xLU + wLU) : X
  const right = f32(b.x + b.w)                         // logicalRightIgnoringInlineDirection, InlineIteratorBoxInlines.h:37
  const W = X > right ? 0 : M > right ? trunc64(f32(right − X)) : M − X
  return { x: X, width: W }
}
```

`inContextAdvances(b, rendered)` is ComplexTextController over the box's rendered text, with the box's font, direction
and `xPos` (`InlineIteratorBoxModernPathInlines.h:38-66`):

- **Adjusted advances** (`platform/graphics/ComplexTextController.cpp:740-800`):
  - SPACE, TAB, LF and NBSP take the space width (`FontCascadeInlines.h:140-143`);
  - a TAB with tabs allowed takes the tab stop width;
  - ZWNJ and the `treatAsZeroWidthSpace` characters take 0: C0 below U+0020, U+007F-U+009F, SHY, ZWSP, LRM, RLM,
    U+202A-U+202E, U+FEFF, U+FFFC (`FontCascadeInlines.h:160-175`);
  - controls other than LF, CR, NBSP, TAB and NUL then take the `.notdef` advance (`:773-782`);
  - letter spacing is added to each glyph that has an advance (`:787-792`).
- **`upTo(o)`** runs `ComplexTextController::advance(o)` (`:577-668`):
  - it sums the adjusted advance of every glyph whose character range starts before `o`;
  - a glyph that covers UTF-16 units `[gs, ge)` contributes the share `(units below o) / (ge − gs)`
    (`runWidthSoFarFraction`, `:558-575`);
  - a glyph with an empty range contributes its whole advance;
  - when CoreText gives a code point no glyph of its own, the preceding glyph's range stretches over it.

## 8. Cases

Every row assumes one text node and the lab's fixed styles.

| Case | Whole node | Code point range |
|---|---|---|
| Letters inside a box | the box rect | partial: `[floor(x0), ceil(x1)]` of in-context positions, clamped at the box's right |
| Code point alone in its box | the box rect | the same rect, exactly (whole-box range) |
| First code point of an LTR box | — | x = `floor(trunc64(b.x))`, exact from box geometry |
| Last code point of a box | — | right edge = `min(ceil(glyph end), trunc64(box right))`: usually `trunc64(right)`, a whole px when the in-context glyph total ends at least a px fraction before the box's layout width |
| Collapsed run `a␠␠␠b` | two boxes, `"a␠"` and `"b"` | 1st space: partial inside box 1 (space width). 2nd space: `s === b.end` and the next box starts later → a zero-width rect at `floor` of box 1's glyph end, on box 1's line. 3rd space: no rect |
| Leading collapsible white space of a node | no box for it | clamped to `caretMin` → a caret rect of zero width at `floor(first box x)`, on the first box's line. This is the "collapsed space after `</span>`, zero width on the next line" |
| Trimmed trailing space | the box ends before it | inside the node: the trailing-content rule gives a zero-width rect at ≈ `floor(box right)` on the previous line. At the node end, clamped to `caretMax`, the caret case gives the same |
| Hanging `pre-wrap` spaces | inside the run's box: the box extent includes them | partial snapped rects inside the box |
| Preserved newline | its own zero-width box at the float32 edge | the box rect (float y); the text box before it gives none, because the newline box starts where it ends |
| CR, NUL, format and bidi controls, ZWSP, ZWNJ, ZWJ | inside the box | 0 advance → zero width. If CoreText makes no glyph for it, it takes a share of the previous glyph (`abc­`, below) |
| C0/C1 controls other than TAB, LF, CR, NUL | inside the box | the `.notdef` advance: positive |
| Chosen soft hyphen | box width includes the hyphen; rendered text ends with `hyphenString` | SHY last in the box: `clampOffset` extends `ce` over the hyphen → `[floor(x_shy), trunc64(box right)]`. SHY alone in its box: the box rect |
| Unchosen soft hyphen | inside the box | zero width, or a share of the previous glyph. Alone in its box: a zero-width box rect |
| Base plus marks, emoji sequences, ligatures | inside the box | each code point gets its UTF-16 share of the glyph, snapped, or zero width when it has its own zero-advance glyph |
| Bidi runs | split into boxes at level changes, placed in visual order (section 5) | RTL box: `before` counts from the right, `total − after` |
| Span or text node edge | boxes never cross it | each node has its own `caretMin`/`caretMax`; a grapheme across the edge is shaped as two |
| Text node with no renderer: ASCII-white-space-only first child, such as a lone FF before a span | none | none (`rendering/updating/RenderTreeUpdater.cpp:536-592`) |
| `text-transform` that changes length | — | box offsets index the renderer's transformed text (`layout/integration/LayoutIntegrationBoxTreeUpdater.cpp:291`), while the Range passes DOM offsets unchanged (`RenderObject.cpp:2199`) |

Examples from installed Safari 27.0's dev rows:

- **`c-16d2dea18ab3b7f6`**, `abc­`, 16px Arial, 100px. Box `[0, 25.796875]`. `a [0, 9]`, `b [8, 18]`, `c [17, 22]`,
  SHY `[21, 25.796875]`. CoreText gives the SHY no glyph, so `c`'s 8px glyph covers two units at 4px each:
  - `c` spans 17.797-21.797, snapped to `[17, 22]`;
  - the SHY spans 21.797-25.797, snapped to `[21, 26]` and clamped to `trunc64(25.796875)`.
- **`c-10f3ebe4617e0873`**, the same text 1px narrower per glyph: `c [15, 20]`, SHY `[19, 22.796875]`. The share
  includes the letter spacing.
- **`c-3d32f0bd925a18dd`**:
  - `❤️`: U+2764 `[21, 32]` and U+FE0F `[31, 42]`, half each;
  - `🏳️‍🌈`, 6 units over a 21px glyph: `[0, 7]`, `[7, 11]`, `[10, 14]`, `[14, 21]`.
- **`c-030319a220fabcab`** (Arabic): `ب` `[67, 71.625]` and its kasra zero width at 67. The mark is its own zero-advance
  glyph.
- **`c-336f0215f95f5460`** (CR LF): the CR is partial, x 22, width 0, y 202.03125 (trunc64). The LF is its own box,
  x 22.7158203125, y 202.04638671875 (float).
- **`c-1696ae676dfa6699`**: `a` alone on its line is a whole-box range, and its rect equals the box rect
  `[0, 8.8984375]`.

## 9. Recorded observation quirks, explained

WebKit's quirks first. The other engines' quirks are listed only for completeness.

1. **"A code point Range edge inside a text box is snapped outward to whole CSS px ('T' is [0, 10] for a 9.77px glyph)"**
   (lab/README.md:288-290).
   - Cause: `snappedSelectionRect` → `enclosingIntRect` (`LegacyInlineTextBox.cpp:146-160`, `LayoutRect.cpp:206-213`).
   - Correction: this applies to every partial rect, box-start edges included: x = `floor(trunc64(b.x))`. Only
     whole-box ranges are unsnapped.
2. **"The right edge of a code point that ends a box is floored, mostly to 1/64px (190.296875 for a box ending at
   190.3046875), in some lines to whole px (80 for 80.22)"** (README:290-291; ISSUES.md "floored line-end edge").
   - Cause: the clamp `logicalWidth = logicalRight − x`. It is a float assigned to a LayoutUnit, so it truncates
     (`LayoutUnit.h:83-88`). 190.3046875 × 64 = 12179.5 truncates to 12179, giving 190.296875.
   - A whole px happens when `ceil(xLU + wLU) ≤ right`: the in-context glyph total ends at least a px fraction before
     the box's layout width. Layout adds item widths measured one item at a time; selection shapes the box once.
   - Census: 1,410 of about 102,000 boxes, for example PingFang TC `c-3587c24903eea32e` (117 against 119.2) and Thonburi
     `c-26eedff255c8f6b5`.
3. **Whole-node rects are float glyph positions (190.3046875).** Cause: the whole-box branch uses
   `visualRectIgnoringBlockDirection` (`RenderText.cpp:811-826`).
4. **"A box's right edge is the float32 sum of its x and width"** (ISSUES.md; `score.ts:216-220`).
   - Cause: the reported width is `f32(f32(x + w) − x)` (`FloatQuad.cpp:90-99`).
   - Census: 562 of 106,527 box rects have an `x + width` that isn't a float32.
   - Consequence: compare x and width bits with this formula instead of rebuilding sums.
5. **"Controls other than TAB, LF and CR get the font's .notdef advance (U+001C 12px in 16px Arial)"** (README:291-292;
   ISSUES.md controls entry).
   - Cause: `ComplexTextController.cpp:773-782` for selection, and `WidthIterator.cpp:817-830` for layout widths.
   - NUL is deleted (`FontCascadeInlines.h:151-153`), and CR takes 0 on the complex path (`:165-167`).
6. **"Safari splits a cluster's advance between a letter and a following ZWSP ('c' [17, 22) and ZWSP [21, 25.797))"**
   (README:292-293).
   - Cause: `runWidthSoFarFraction` (`ComplexTextController.cpp:558-575`) shares a glyph's advance by UTF-16 units, and
     the ZWSP had no glyph of its own.
   - A ZWSP at a box start gets 0 instead: a ZWSP separator item starts a new run (`InlineLine.cpp:394-395`).
7. **"Chrome and Safari give each code point of such a cluster a copy of its rect"** (README:159-161; VALIDATION.md,
   third pass, item 17 derivation).
   - Not true for Safari. Only 108 of 38,843 multi-code-point graphemes have identical rects, and those are zero-width
     pairs such as CR LF or two zero-advance marks at one x.
   - The rest split by the share rule (16,437) or give some code points zero width (22,298).
   - The scorer's `carriesInk` still handles both, because a split grapheme keeps positive rects.
8. **"After an inline box end (`</span> foo`), the collapsed space's rect has zero width on the next line"**
   (README:299-300; specs/probes-safari.md:23-25).
   - Cause: `caretMinOffset` clamps the range to the first box's start (`RenderText.cpp:777-783, 2105-2116`), and the
     caret case reports a zero-width rect there (`:356-366`).
   - Census: 3,420 zero-width space rects sit at `floor(box left)` on their line.
9. **"Safari's extra zero-width rect on the previous line"** (`score.ts:349-354`).
   - Cause: the trailing-content rule, `rangeStart == textBox.end()` with the next box starting later
     (`RenderText.cpp:368-375`), or the `caretMax` clamp at a node end.
   - Census: 15,952 zero-width space rects sit at `floor(box right)` on their line. 155 sit one px lower, where the box
     right is a whole px and the in-context total falls just short of it.
10. **"A chosen soft hyphen gets a positive rect; a line holding only an unchosen soft hyphen observes 0px"** (ISSUES.md
    soft hyphen entry).
    - Cause, chosen: `additionalLengthAtEnd` extends the SHY's range over the hyphen string
      (`InlineIteratorBoxModernPath.h:76-97`, `TextBoxSelectableRange.h:40-54`).
    - Cause, unchosen: a SHY alone in its box is a whole-box range of width 0.
11. **"`abc­` at 100px: Safari gives the trailing soft hyphen a positive rect"** (research/TESTS.md:284). Cause: the share
    rule, as in the `c-16d2dea18ab3b7f6` example in section 8. Census, installed Safari dev rows: inside runs, 5,490 SHYs
    with a positive rect and 951 without; at the paragraph end, 14 with and 39 without.
12. **"Lone FF before a span: no rect; FF node between spans: 12px rect"** (probes-safari.md:66).
    - Cause, lone FF: an ASCII-white-space-only text node that would be the block's first inline content gets no
      renderer (`RenderTreeUpdater.cpp:548-592`).
    - Cause, between spans: the previous renderer is inline, so the node gets a renderer, and FF takes `.notdef`.
13. **"With a `text-transform` that changes length, Range offsets address the transformed text"** (README:300-301).
    Cause: the InlineTextBox content is the renderer's text (`LayoutIntegrationBoxTreeUpdater.cpp:291`), while Range
    offsets are passed through unchanged (`RenderObject.cpp:2199`).
14. **"Inline layout positions are float32 px; widths mostly off the 1/64px grid"** (VALIDATION.md "Safari 27"). Cause:
    display boxes are float32 sums of item widths (section 5). Only partial selection rects sit on the LayoutUnit grid.
15. **"In RTL the first box's x + width sits one or two float32 steps from the content edge (336.0000305175781 for 336)"**
    (VALIDATION.md third pass). Cause: the float32 accumulation from `f32(lineBoxWidth − contentLogicalRight)`
    (`InlineDisplayLineBuilder.cpp:117-127`, `InlineDisplayContentBuilder.cpp:862-936`).
16. **"A cluster across a text node edge: native layout breaks between `i` and U+0308"** (ISSUES.md text node edge entry).
    Cause: boxes and shaping never cross a layout box (`InlineLine.cpp:381-382`), so each node's code points have their
    own rects.
17. **Page-history rows** (WEBKIT-HOST.md). These aren't observation: the boxes themselves change (break position cache,
    probes-safari.md cross-check item 1).
18. **Other engines**: Chrome's duplicate soft-hyphen box (README:139-140), Chrome's U+2028 copy, Firefox's advance on
    VS16 or ZWNJ, and Firefox's zero-width base letters come from other engines' geometry code and don't occur in WebKit.

## 10. What the lab can derive and compare exactly

Exact comparisons, from predicted display boxes:

- **E1. Box list per text node.** The observed `runRects[r]` equals `wholeNodeRects(r, predictedBoxes)` in count and order,
  with `x` and `width` bit-equal. Census: in all 37,338 run nodes of installed Safari's dev rows, the rects come by line,
  then left to right.
- **E2. Line extent.** The union of the line's boxes: left = min x, right = max `f32(x + w)`. This includes hanging white
  space, a chosen hyphen's width and controls' `.notdef` advances, and leaves out trimmed spaces, because the engine
  shrank the run. It needs none of the scorer's visibility rules.
  - A line ending at a soft hyphen becomes observable: the box width holds the hyphen.
  - So does a line ending in another space separator: the engine either trimmed it or kept it in the box.
- **E3. Line membership of a code point.** Take the boxes that report for its range (section 7 predicate). A partial
  rect's `y` equals `trunc64(y)` of its box's whole-node rect. The census found no positive partial rect without such a
  box. This replaces the half-line-height centre clustering for rects of one node.
- **E4. Rects for white space outside boxes.** The count (0 or 1) and line of rects for collapsed, trimmed and leading
  white space. The x of a caret rect at a box start, `floor(b.x)`.
- **E5. A text node with no renderer** reports no rects.

Unobservable by rule, never by fitting:

- **U1. y and height.** They depend on primary-font ascent and descent with `snapToInt` and half-leading
  (`InlineLineBox.cpp:58-73`), which the model doesn't carry. Line order across nodes stays an observation assumption
  (centres half a line height apart) until vertical metrics are ported.
- **U2. Code point edges inside a box.** These are whole-px floors and ceils of in-context CoreText positions. Canvas
  prefix widths leave out kerning across the cut and glyph clustering.
- **U3. Whether a zero-advance code point gets a positive rect, and how wide the previous glyph's rect is.** It depends on
  whether CoreText gives the code point a glyph: SHY, ZWSP, ZWJ, ZWNJ, VS, marks, CR, NUL, bidi and format controls.
  At grapheme level, a positive rect is derivable where the grapheme's advance is positive.
- **U4. The right edge of the last code point in a box.** Whole px or `trunc64(right)`, depending on the in-context total
  against the layout width. Zero-width trailing-content rects have x ≈ `floor(glyph end)` (U2).
- **U5. Whether trailing white space hangs** under `text-align: start`. The box geometry is the same either way; hanging
  shows only through breaks.
- **U6. Which hyphen glyph was drawn** when U+2010 and `-` have equal advances.
- **U7. Which line a collapsed unit after the first of a collapsed run belongs to.** It has no rect.
- **U8. Page zoom ≠ 1.** `inverseFrameScale` isn't ported.
- **U9. Length-changing `text-transform`.** The lab sets `none`.

What changes in the lab and the port:

- `score.ts` for Safari and webkit-host: `boxEdge`, the whole-px and floored-edge unobserved reasons, the soft-hyphen and
  other-space width exclusions, and the visible-code-point extent become unnecessary for widths (E1, E2). They stay
  usable for native-only diagnostics.
- The Chrome and Firefox rules in `score.ts` aren't touched by this spec.
- The WebKit engine emits `boxes` per line (section 4). Its public `width` stops copying lab rules (audit D1). The lab
  derives expected rects with sections 5-7 and compares E1-E5.
- The `painter` metric compares the union of the painted nodes' boxes with the predicted union. Exact equality still
  depends on the painted DOM producing the same runs (DESIGN.md §7 limits).

## 11. Census

Offline, streaming, peak RSS about 250 MB. Tools and outputs are in
`~/github/pretext-rebuild/.artifacts/research-20260916/tentpoles/webkit-observation/`.

- **`census.ts`**:
  - webkit-host smoke, ws, policy and runs forward (5,505 rows): 229,340 partial rects: 202,102 right edges on a whole px,
    19,015 at `trunc64(box right)`, 8,223 zero width, 0 unexplained;
  - installed Safari `dev-all` forward (25,180 rows): 1,056,193 code point rects, of which 35,234 equal a box rect.
    1,020,959 are partial: 907,519 whole-px right edges, 58,262 at `trunc64(box right)`, 55,178 zero width, 0 unexplained;
  - both sets: 0 positive partial rects with x off a whole px, and 0 with a width off 1/64.
- **`box-ends.ts`**: 41,558 box ends at `trunc64` and 1,410 a whole px lower. The "other" bucket (6,934) is an attribution
  artifact of the script: a neighbouring box's floored code point x falls inside the box.
- **`white-space-rects.ts`**: zero-width space rects are 15,952 at `floor(box right)`, 3,420 at `floor(box left)` and
  155 elsewhere. The four one-line ASCII nodes with collapsed runs all have `boxes = collapsed runs + 1`.

## 12. Not settled

- Vertical geometry (U1): a port of `logicalRectForTextRun` heights with `snapToInt`.
- Whether the port's `lastRunLogicalRight` equals `contentLogicalRightIncludingNegativeMargin` for RTL lines with
  hanging content.
- `c-8a8ef1c653dff4ab` (Hiragino Sans, `break-all` and `break-word` at 5px): a box at x −27, and a code point with rects
  on two lines. Not traced.
- The causes behind the 1,410 whole-px box ends (U4) weren't split per font.
- Held-out rows weren't censused.
