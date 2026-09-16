# DOM painter: which painted form keeps each engine's line widths and glyph positions

CRITIC.md §5 item 1. The library predicts where a paragraph's lines break and how wide each line is, then paints the
lines with DOM elements. This spec reads, per engine, what painting a line on its own does to shaping, widths, glyph
positions and bidi reordering, compared with the same text laid out as one paragraph. It recommends a painted form
and lists what no painted form can reproduce. No browser was launched.

## 0. Sources, labels, terms

Prefixes (all at the pinned tags):
- `C/` = `~/github/browser-engines/chromium-153.0.8010.48/third_party/blink/renderer/`. This reading added
  `third_party/blink/renderer/core/paint` to the sparse checkout.
- `HB/` = HarfBuzz `src/` at Chrome 153's DEPS revision `dfdc088c4d7c5d31dd5b13070b919b51f6c21ea8`
  (`chromium-153.0.8010.48/DEPS:384, 2274-2275`). It isn't in the local checkout (152's copy is `28f4dc6`). The five
  files read were fetched from `raw.githubusercontent.com/harfbuzz/harfbuzz/<that commit>/src/`, the repository the
  Chromium DEPS URL mirrors.
- `ICU/` = `~/github/browser-engines/chromium-icu-8cc91d9b/source/common/`.
- `W/` = `~/github/browser-engines/webkit-7625.1.29.11.27/Source/WebCore/`, and `IL/` = `W/layout/formattingContexts/inline/`.
- `F/` = `~/github/browser-engines/firefox-156.0/`.

Labels: **[V]** read here at the pinned tag; **[S]** taken from a sibling spec in this directory, named inline;
**[I]** inference, with a probe in §8 where one is cheap.

Terms:
- **original paragraph**: the author's element with its spans, laid out by the engine at the paragraph width. The
  model predicts this paragraph's lines.
- **painted line**: the DOM the painter builds for one predicted line.
- **node slice**: the part of one original text node (a bare text node or a span's text) that lies on a given line,
  after white-space processing.
- **line edge**: the start or end of a line. A **mid-word edge** is a line edge with no space next to it, as with
  `word-break: break-all` or `overflow-wrap: anywhere`.
- **context**: text outside the range being shaped that the shaper still reads.
- **level run**: a maximal run of characters with the same resolved bidi embedding level.

The candidate forms:
- **A-wrap**: one block per line, same `white-space` value and content width as the paragraph, one span per node slice.
- **A-nowrap**: the same, but with `white-space: nowrap` (collapse modes) or `pre` (preserve modes).
- **B**: the original markup, with `<br>` inserted at predicted line ends (text nodes split where a break falls inside one).
- **C**: A with each line block absolutely positioned.
- **D**: the original markup left alone.

---

## 1. Short answer

| | Blink (Chrome 153) | WebKit (Safari 27) | Gecko (Firefox 156) |
|---|---|---|---|
| What paints the glyphs | the layout's own shape results | a fresh shaping of each display box's text at paint time | the layout's own glyph records |
| What a line alone loses | HarfBuzz pre/post context (joining scripts at mid-word edges); nothing for other scripts, because line-edge reshapes are already separate shaping calls | almost nothing: layout never measures across a text box or a line edge. The exceptions are the item-plus-following-space rule and RTL shaping across inline boxes | whole-word shaping at mid-word edges (kerning, ligature shares, joining) |
| Bidi | levels come from the whole paragraph; a line alone re-resolves them | same | same |
| Recommended | A-wrap (or C) | A-wrap or A-nowrap (or C) | A-wrap (or C) |

Rules that apply in every engine (§6):
1. One block per predicted line, at the paragraph's content width. Carry over the same font, `lang`, spacing,
   `text-align`, `text-align-last` and decorations.
2. Give every original node's slice its own element with that node's style. Never merge or split slices within a
   line.
3. Keep the trailing collapsible spaces inside their slice, and let the engine trim them.
4. Paint text that is already transformed (collapsed, `text-transform` applied). Put `text-indent` on the first
   painted line only.
5. For a paragraph with bidi content, wrap each level run in nested `unicode-bidi: bidi-override` spans built from the
   model's per-engine levels.

Forms B and C give the same shaping and bidi results as A (§5). D reproduces everything, because it paints nothing.

What no form reproduces (§7):
- Gecko at mid-word edges;
- Blink and Gecko joining-script forms at mid-word edges (a ZWJ may restore them, [I], probe 5);
- WebKit kerning between a word and its appended hyphen, in both the width and the ink at the same time;
- visual order in bidi paragraphs unless the model resolves levels per engine;
- Blink's line-end CJK punctuation trimming under A-nowrap (A-wrap keeps it).

---

## 2. What sets a line's width and its glyph positions

### 2.1 Blink [V]

- **Painting uses layout's shape results.**
  - `TextFragmentPainter::Paint` returns early without a shape result (`C/core/paint/text_fragment_painter.cc:343-346`).
  - `FragmentItem::TextPaintInfo` hands over `text_.shape_result` (`C/core/layout/inline/fragment_item.cc:606-611`).
  - `TextPainter::Paint` draws that result (`C/core/paint/text_painter.cc:373-401`).
- **Glyph x** = the fragment's x in LayoutUnits, plus float advances inside the fragment.
- **Fragment widths.** A fragment's x is the sum of the earlier fragments' `inline_size`. Each `inline_size` is ceil64
  of its item result's width [S blink-lines §5.2, §17].
- **Consequence: node division matters.** The same text split into different items changes the per-item ceil. Splits
  come from style boundaries, controls and bidi levels.

### 2.2 WebKit [V]

- **Layout widths.** They come from `TextUtil::width` per item (`IL/text/TextUtil.cpp:62-104`).
- **Line runs.** Consecutive items merge into one line run while they share the text box and bidi level. Other
  conditions also split runs: word spacing, ZWSP, NBSP quirk, tabs in RTL, shaping boundaries
  (`IL/InlineLine.cpp:376-399`). Each run becomes one display box (`IL/display/InlineDisplayContentBuilder.cpp:196-300`).
- **Painting reshapes.** `TextBoxPainter` builds a `TextRun` from the display box's `renderedContent()`
  (`W/rendering/TextBoxPainter.cpp:195`; `W/layout/integration/inline/InlineIteratorBoxModernPathInlines.h:38-66`) and
  shapes it again to draw (`TextBoxPainter.cpp:690`). The rendered content has the hyphen string appended when the run
  ends at a used soft hyphen (`InlineDisplayContentBuilder.cpp:279-280, 299`).
- **Consequence.**
  - Glyph positions inside a run come from paint-time shaping of that run's text alone.
  - A run's left edge comes from the layout sums of the runs before it.
  - The two can disagree inside one line. Example: the hyphen (§3.2 e).
- **Exception: RTL complex text across inline boxes.** Layout shapes the joined string once
  (`IL/InlineLineBuilder.cpp:920-979`). Paint rebuilds the same joined string and draws it clipped per box
  (`TextBoxPainter.cpp:116-186, 693-730`).

### 2.3 Gecko [V]

- **Painting.** A text frame draws its range of the text run's glyph records: `::DrawTextRun(mTextRun, ...)`
  (`F/layout/generic/nsTextFrame.cpp:7961`). A used soft hyphen is drawn from a separate hyphen text run at the
  frame's end (`:7963-7984`). Its width is `hyphen run advance + letter spacing` (`:4389-4398`).
- **Widths.** Frame widths are integer app units. Glyph records are computed once per text run and never reshaped
  because of a line break [S gecko-lines §1 step 3, §2.5].
- **Glyph x** = the frame's x (au) plus au advances.

---

## 3. What leaves the paragraph when a line is painted alone

### 3.1 Blink

**a. HarfBuzz context (joining scripts).**
- Every shape call passes the whole `text_content` with an offset and length
  (`C/platform/fonts/shaping/case_mapping_harfbuzz_buffer_filler.cc:24-43`).
- HarfBuzz stores up to 5 code points before and after the range (`HB/hb-buffer.hh:109-111`;
  `HB/hb-buffer.cc:1831-1863`).
- Two uses were read:
  - Arabic-family joining reads both contexts (`HB/hb-ot-shaper-arabic.cc:299-360`).
  - The dotted circle for a buffer that starts with a mark is suppressed when pre-context exists
    (`HB/hb-ot-shape.cc:549-556`).
- Joining marks glyphs `unsafe_to_concat`, not `unsafe_to_break` (`HB/hb-ot-shaper-arabic.cc:337-345, 370`). So
  Blink's line breaker sees a safe break inside an Arabic word and keeps the glyphs of the whole-paragraph shaping, in
  their joined forms [S blink-lines §6 steps 2 and 8 reshape only at unsafe offsets].
- A painted line holding only line 1's part of the word has no post-context, so its last letter takes the final or
  isolated form. That is a different glyph, usually with a different advance.
- The painted line's `text_content` is only that line. The same happens at the start of line 2.

**b. Line-edge reshapes, other scripts.**
- At an unsafe line start Blink reshapes `[start, firstSafe)`; at an unsafe line end, `[lastSafe, break)`. Each is a
  separate `hb_shape` call [S blink-lines §6].
- Kerning, ligatures and contextual lookups don't read the buffer context. They see only glyphs inside the call
  (§3.1 a lists the context uses).
- So a painted line that shapes `[start, end)` in one call gets the same glyphs as the original line for Latin, CJK
  and other non-joining text [I: this relies on HarfBuzz's safe-to-break promise at `firstSafe` and `lastSafe`].

**c. Trailing collapsible space.**
- Where a line ends at a space, `dont_reshape_end_if_at_space` stops the line-end reshape. The trailing space is then
  removed by taking a view of the shaping, without reshaping (`C/core/layout/inline/line_breaker.cc:255-268`;
  [S blink-lines §5.2, §8.3]).
- So the last letter keeps any GPOS adjustment it got from the following space.
- A painted slice `foo ` shapes the space too and trims it the same way. A painted `foo` doesn't.

**d. `NeedsAccurateEndPosition`.**
- It is true in these cases (`line_breaker.cc:255-268`; `C/core/layout/inline/line_info.cc:127-...`):
  - `text-align` or `text-align-last` needs the end position: `end`, `center`, `justify`, `left` in RTL, `right` in LTR;
  - the line-end item has a box decoration background or text decorations.
- When true, removing the trailing space **reshapes** `[lastSafe, end)` [S blink-lines §8.3].
- So the painted line must give this test the same answer as the original. The simplest way is to keep the same
  `text-align`, `text-align-last`, background and decorations.

**e. No `ShapeLine` under nowrap.**
- With `auto_wrap_` false, `HandleText` takes the whole item's shape result and its `SnappedWidth()`
  (`line_breaker.cc:1484-1498`).
- `ShapingLineBreaker::ShapeLine` only runs in wrapping mode (`:1392`).
- The CJK line-end trimming lives only in `ShapeLine`. When a closing punctuation mark (for example `。`) doesn't fit at
  full width, it is reshaped with `han_kerning_end` and kept on the line if it then fits
  (`C/platform/fonts/shaping/shaping_line_breaker.cc:344-378`; options at `harfbuzz_shaper.cc:1018-1030`).
- So under A-nowrap that `。` stays full width, and the painted line is wider than the original. Under A-wrap with the
  paragraph's width, the same `ShapeLine` step runs [I: `IsBreakable(range_end)` at the end of text is true]. See
  probe 4.

**f. Shaping groups and item division.**
- A group extends over items with equal fonts (the font description includes letter and word spacing), the same
  direction and the same run segment.
- It stops at controls, bidi control items, atomic inlines, and at box edges with non-zero inline padding, margin or
  border, or non-`baseline` `vertical-align` (`C/core/layout/inline/inline_node.cc:472-527`).
- So painted slices must keep the original node division:
  - merging same-style nodes changes the per-item ceil (§2.1);
  - splitting them adds nothing, unless the new box breaks shaping.

**g. Script segments (Common characters).** [I]
- An 8-bit `text_content` without bidi is one Latin segment. Otherwise `RunSegmenter` runs over the whole paragraph
  [S blink-text §2.D].
- Common characters take the script of the preceding run.
- So digits or punctuation at the start of a line can carry the previous line's script (for example `hani`) in the
  original, and `latn` or Common when painted alone.
- This changes widths only for fonts with script-specific lookups for those characters. No probe; open question.

**h. Hyphen.**
- The hyphen is shaped alone with no letter or word spacing (`C/core/layout/inline/hyphen_result.cc:12-16`).
- It is placed as its own fragment after a text fragment of `inline_size − hyphen` (`logical_line_builder.cc:245-252`).
- So a literal hyphen inside a letter-spaced slice is `letter-spacing` wider (probe 10).
- It also kerns with the letter before it when both sit in one shaping group.

**i. Tabs and indent.** Tab width depends on `position_` from the line start, including `text-indent`
[S blink-lines §12]. The first painted line must carry `text-indent`, not a margin or padding.

### 3.2 WebKit

**a. Item plus following space** [V].
- `TextUtil::width` extends the measured range by one when the next code unit **in the same text box** is U+0020 and
  kerning or shaping is on, then subtracts `singleSpaceWidth + wordSpacing` (`IL/text/TextUtil.cpp:76-77, 98-99`).
- A painted slice `foo ` measures `foo` the same way as the original. A painted `foo` (space dropped, or moved into
  another node) measures `foo` alone.
- They differ where the font's shaping gives the last glyph a different advance before a space (probe 3).

**b. Measurement never crosses a text box** [S webkit-text §7.5; V `IL/InlineLine.cpp:376-399`].
- So `A<span>V</span>` has no kerning in layout or paint, in the original and in the painted line alike.
- Node division must match. Merging two same-style nodes into one painted node adds kerning that the original doesn't
  have.

**c. Mid-word edges reproduce.**
- The overflow breaker measures prefixes of the item alone [S webkit-lines §8.1].
- Paint shapes the display box's substring alone (§2.2).
- So the original line already lacks any shaping with the next line's text, and a painted line matches it, including
  Arabic joining forms [I for paint: Core Text receives only the substring].

**d. Node-edge scans.**
- `mayBreakInBetween` and the prior two code units of the previous box decide only wrap opportunities
  [S webkit-text §7.4].
- A painted line that fits never asks. They matter for form B, where splitting a node changes the prior context of a
  later decision, but only when content overflows.

**e. Hyphen.**
- Layout adds `hyphenWidth = font.width(hyphenString)`, measured alone and including letter spacing
  [S webkit-lines §3.3, §8.3].
- Paint shapes item text and hyphen as one string (§2.2).
- A literal hyphen in the same node makes the layout width match paint (kerned) but not the original layout width.
- A hyphen in its own span matches the original layout width, but paints the hyphen unkerned.
- Both are right only when the font doesn't kern the last letter with the hyphen.

**f. Shaping across inline boxes** [V].
- Only in `LineBuilder`, for RTL complex-path text with an equal font cascade, joined through boxes with no
  margin, border or padding on that side and not isolating (`IL/InlineLineBuilder.cpp:780-918`, the isolation test at
  `:823-824`).
- The joined string is shaped once, and each run gets `Σ max(0, advance)` (`:920-979`).
- The painted line has the same spans, and it is one candidate, so it forms the same ranges within the line [I].
- A range cut by a mid-word line edge goes through `shapePartialLineCandidate` in the original (`:981-1028`) [I: this
  is expected to match shaping the part alone].

**g. Builder choice.**
- Adding spans can move a root from `TextOnlySimpleLineBuilder` to `LineBuilder` [S webkit-lines §2].
- For a line that fits, both take widths from the same `TextUtil::width`. Their structural differences are all about
  fit tests, reverts, tab pen origin with indent or floats, and word-spacing offsets (`simpleByStyle` excludes word
  spacing).

**h. `pre-wrap` trailing spaces.**
- A painted block's only line is its last line, so its trailing preserved spaces hang conditionally. They stop hanging
  when the content fits. A non-last original line hangs them unconditionally [S webkit-lines §9.1].
- `contentLogicalWidth` includes the spaces in both cases. Only alignment offsets can differ, for `text-align` other
  than `start` [I].

### 3.3 Gecko

**a. Text runs end at block edges.**
- Frames in different blocks never share a text run (`F/layout/generic/nsTextFrame.cpp:2104-2112`).
- Gecko shapes word by word between spaces and invalid characters, with the word cache [S gecko-lines §3.5], and never
  reshapes at a break.
- So at space line edges the painted words have the same glyph records as the original words, and the widths match.

**b. Mid-word edges don't reproduce.**
- In the original, the split word is one shaped word inside the paragraph's text run.
- Line 1's last glyph keeps its kerning against line 2's first glyph (the GPOS adjustment sits in its advance).
- A ligature across the edge is shared between the two frames by integer division [S gecko-lines §2.7;
  `F/gfx/thebes/gfxTextRun.cpp:238-329`].
- Joining forms stay joined.
- A painted line shapes its half alone and gets none of these (probe 6).

**c. No shaper context** [V].
- `hb_buffer_add_utf16(buffer, text, length, 0, length)` passes no pre- or post-context
  (`F/gfx/thebes/gfxHarfBuzzShaper.cpp:1484-1485`).
- `TEXT_INCOMING_ARABICCHAR` / `TEXT_TRAILING_ARABICCHAR` carry between text runs (`nsTextFrame.cpp:1786-1807,
  2377-2378, 2593-2594`), but they only feed numeral substitution (`F/gfx/thebes/gfxTextRun.cpp:2688-2692`).
- So Gecko joins only inside one word of one text run, and a ZWJ is the only way to hand context to a painted half [I].

**d. Fonts whose default lookups use the space glyph.**
- For these, the whole run is shaped at once, spaces included, bypassing the word cache
  (`F/gfx/thebes/gfxFont.cpp:3743-3763`).
- The original run crosses line edges; a painted line's run doesn't. A lookup that spans a line edge is lost [I].

**e. When painted spans share a text run** [V].
- `ContinueTextRunAcrossFrames` separates frames that differ in font, language, `text-transform`, `word-break`,
  `line-break` or run flags.
- It also separates them at element edges with inline margin, border or padding, a non-default vertical alignment, or
  an isolate (`nsTextFrame.cpp:2054-2137, 2139-2174`).
- `vertical-align: 0px` counts as default: baseline alignment with a zero shift (`:2000-2012`). So unlike Blink it
  doesn't break shaping.

**f. `pre-wrap` hang width.** A frame counts only the non-overflowing part of its trailing preserved spaces
[S gecko-lines §4.4, §4.8]. A painted `pre` line counts them all, while A-wrap keeps the original rule.

**g. Hyphen.** Drawn as its own text run plus letter spacing (§2.3). A literal hyphen in the letter-spaced slice gets
the same spacing, but it shapes inside the word and can kern with the letter before it.

**h. White-space transform.**
- The painter writes text that is already transformed. The one-bit "in white space" carry and segment-break context
  [S gecko-lines §3.3] then see no collapsible runs to act on.
- The model must still produce Gecko's transform, including newline removal between East Asian characters.

---

## 4. Bidi

### 4.1 Paragraph resolution, line reordering [V]

- **Blink.**
  - `ubidi_setPara` over the paragraph's `text_content`, at the block's level or `UBIDI_DEFAULT_LTR` for
    `plaintext` (`C/platform/text/bidi_paragraph.cc:14-47`).
  - Items are split at level changes [S blink-text §2.D].
  - Each line reorders its items with `ubidi_reorderVisual` over the item levels. Results that are only trailing
    spaces use the base level (`C/core/layout/inline/logical_line_builder.cc:688-760`;
    `line_breaker.cc:2749-2775`).
- **WebKit.**
  - `buildBidiParagraph` then `ubidi_setPara` [S webkit-text §6].
  - Per line, `computedVisualOrder` calls `ubidi_reorderVisual` on run levels (`IL/InlineLineBuilder.cpp:92-134`).
  - UAX #9 L1 resets trailing white space to the root level (`IL/InlineLine.cpp:243-287`).
- **Gecko.**
  - `nsBidiPresUtils` builds a paragraph per block and resolves it with Rust `unicode-bidi` 0.3.15, which implements
    bracket pairs (N0) (`F/third_party/rust/unicode-bidi/src/implicit.rs:263-294`).
  - `ReorderFrames` reorders per line (`F/layout/base/nsBidiPresUtils.cpp:1494-1532`).

In all three, **levels come from the whole paragraph**; each line only reorders.

### 4.2 Forced breaks end a bidi paragraph in all three [V]

- **Blink.** `<br>` appends an LF control item. Open bidi contexts are closed before it and reopened after it
  (`C/core/layout/inline/inline_items_builder.cc:1163-1198`).
  - LF is class B. ICU resets the embedding stack at B and gives each paragraph its own level range
    (`ICU/ubidi.cpp:1284-1295`; per-paragraph levels `:1110-1135`).
- **WebKit.** A hard line break, a block, or a class-B soft break appends `\n` and unwinds and rewinds the contexts
  (`IL/InlineItemsBuilder.cpp:535-548, 563-574`).
- **Gecko.** A `<br>` appends U+2028 and resolves the paragraph so far (`nsBidiPresUtils.cpp:1381-1384`). Preformatted
  text is resolved per line at each significant LF (`:1256-1300`).

So form B resolves each line alone, exactly like form A.

### 4.3 Which results depend on text outside the line

Any UAX #9 rule that reads across the line edge:
- P2/P3: `unicode-bidi: plaintext` picks the base direction from the paragraph's first strong character.
- W1: NSM after sos.
- W2: EN becomes AN after AL.
- W5–W7.
- N0: a bracket pair can span lines.
- N1/N2: neutrals between strong types on either side of the edge.

Worked example, LTR paragraph `שלום (עולם ab) cd`, wrapping after `(עולם `:
- **Whole paragraph.**
  - The pair `(`…`)` contains R (`עולם`) and L (`ab`). The embedding direction is L, so both brackets become L (N0).
  - Levels on line 1: `שלום` = 1, ` (` = 0, `עולם` = 1.
  - Visual order: `שלום` at the left, then ` (`, then `עולם`.
- **Line 1 alone** (`שלום (עולם`).
  - The `(` has no pair. The neutral run ` (` sits between R and R, so it becomes R (N1). The whole line is level 1.
  - Visual order is reversed: `עולם` at the left, then a mirrored `(`, then `שלום`.
- Widths are equal; glyph positions are not (probe 7).

### 4.4 Painting the paragraph's levels

The model supplies the resolved level of every code unit on the line, with L1 applied (per engine: ICU 78.2, Apple
ICU 78.1, `unicode-bidi` 0.3.15 with Unicode 15.0 tables; CRITIC §5 item 3). The painter then builds nested override
spans in logical order:

```ts
// base: 0 (ltr) or 1 (rtl), the paragraph's resolved base level.
// levels[i] >= base for every code unit of the line, trailing white space already at base (L1).
function paintLevels(line: HTMLElement, text: string, levels: number[], base: number, slices: Slice[]) {
  line.style.direction = base & 1 ? 'rtl' : 'ltr'
  line.style.unicodeBidi = 'bidi-override'      // level-base characters are overridden too
  for (let s = 0; s < slices.length; s++) {
    const nodeSpan = makeNodeSpan(slices[s])    // the slice's own style (§6)
    const stack: HTMLElement[] = [nodeSpan]     // depth d means level base + d
    for (let i = slices[s].start; i < slices[s].end; i++) {
      const depth = levels[i] - base
      while (stack.length - 1 > depth) stack.pop()
      while (stack.length - 1 < depth) {
        const span = document.createElement('span')
        span.style.unicodeBidi = 'bidi-override'
        span.style.direction = (base + stack.length) & 1 ? 'rtl' : 'ltr'   // levels alternate parity, so +1 each
        stack[stack.length - 1]!.append(span); stack.push(span)
      }
      appendCodeUnit(stack[stack.length - 1]!, text[i]!)
    }
    line.append(nodeSpan)
  }
}
```

**Why this reproduces the levels.**
- An override from level n with the opposite parity always gives level n + 1.
- Every character's class is forced, so no W or N rule can re-resolve anything inside the line.
- L2 on the line then gives the original visual order. Mirroring follows the level parity, as in the original.

**Why override and not the alternatives.**
- `isolate` or `isolate-override` breaks Gecko text runs (`nsTextFrame.cpp:2091-2096`) and WebKit shaping ranges
  (`IL/InlineLineBuilder.cpp:823-824`).
- `embed` leaves neutrals open to re-resolution inside the line.

**Costs** [I unless cited].
- **Blink.** Override spans add bidi control items, which break shaping groups (`inline_node.cc` group loop,
  [S blink-text §2.E]).
  - The original breaks groups at direction and segment changes, so text across a level edge was already shaped
    separately. The exceptions are same-parity level changes (for example 0 to 2) and a level run cut by a node edge,
    where the painter closes and reopens overrides.
  - Joining still crosses the controls: bidi controls are Cf, which HarfBuzz joining treats as transparent. Kerning
    doesn't.
- **WebKit.** Under an override, layout measures with the style's direction and the override flag
  (`IL/text/TextUtil.cpp:89-90`), where the original measures with an LTR, non-override `TextRun`. The glyphs are
  expected to be the same for text whose characters all resolve to the override's direction.
- **Gecko.** Overrides need bidi turned on. RTL characters in the text already do that
  (`F/dom/base/CharacterData.cpp:298-303`), and so does `direction: rtl` (`F/layout/generic/nsIFrame.cpp:1506-1512`).
- **All engines.** For a line whose levels all equal `base`, skip the overrides. For a pure-LTR paragraph, skip the
  whole structure.

A painted line never uses `unicode-bidi: plaintext`. Its `direction` is the paragraph's resolved base direction
(probe 9).

---

## 5. The forms, engine by engine

| Form | Blink | WebKit | Gecko |
|---|---|---|---|
| A-wrap | reproduces widths and glyphs, except §7 L1, L2, L6. Keeps the `ShapeLine` line-end logic (§3.1 e). A line wider than predicted wraps visibly | reproduces, except L3 and L5 | reproduces, except L1 at mid-word edges, L4, L7. Keeps the `pre-wrap` hang width |
| A-nowrap / pre | also loses the CJK line-end trimming (L6); a wider line overflows instead of wrapping | same as A-wrap | also counts overflowing `pre-wrap` spaces (§3.3 f) |
| B (`<br>`) | same shaping as A: LF is a control item, and a following LF breaks the group and the joining context. Same bidi as A (§4.2). Keeps inline box fragmentation and `text-indent`. Mutates the author's nodes | same as A. Split nodes must be cut after the trailing space (§3.2 a) | same as A |
| C (absolute) | same as A. The box origin is truncated to 1/64 px [S blink-lines §1.2] | same as A | same as A. The origin rounds to 1/60 px |
| D (as is) | native by definition; no per-line control | same | same |

All forms carry one more painted-line effect: `text-align-last` applies to every painted line (each one is the last
line of its block, or the line before a `<br>`). A justified paragraph's non-last lines need `text-align-last:
justify`. In Blink that keeps `NeedsAccurateEndPosition` true, as in the original.

---

## 6. Recommended painter (port target)

```ts
// A-wrap. One call per predicted line; returns the line block (form C: also set position absolute, left 0, top).
function paintLine(p: ParagraphModel, line: LineModel, engine: 'blink' | 'webkit' | 'gecko'): HTMLElement {
  const el = document.createElement('div')
  el.lang = p.lang
  setFont(el.style, p.font); el.style.lineHeight = `${p.lineHeight}px`
  el.style.letterSpacing = `${p.letterSpacing}px`; el.style.wordSpacing = `${p.wordSpacing}px`
  el.style.width = `${p.contentWidth}px`                     // same available width (§3.1 e)
  el.style.whiteSpace = p.whiteSpace                         // A-wrap; never plaintext bidi
  el.style.wordBreak = p.wordBreak; el.style.overflowWrap = p.overflowWrap
  el.style.lineBreak = p.lineBreak; el.style.tabSize = String(p.tabSize)
  el.style.textAlign = p.textAlign                           // §3.1 d
  el.style.textAlignLast = line.isParagraphLastOrBeforeForcedBreak ? p.textAlignLast
    : (p.textAlign === 'justify' ? 'justify' : p.textAlignLast)
  el.style.textIndent = line.isFirst ? p.textIndent : '0px'  // §3.1 i
  el.style.direction = p.resolvedBaseDirection
  // text: transformed text (collapsed white space, text-transform applied), so no text-transform style (§6 R5)
  if (line.levels) paintLevels(el, line.text, line.levels, p.baseLevel, line.slices)   // §4.4
  else for (const s of line.slices) el.append(makeNodeSpan(s))                          // §6 R2, R3
  if (line.hyphen) el.lastChild!.append(hyphenSpan(line, engine))                        // §6 R6
  return el
}
```

- **R1. Available width.** Paint at the paragraph's content-box width, with the same `white-space`. Where a spill is
  worse than an overflow, use A-nowrap, and accept L6 in Blink and §3.3 f in Gecko.
- **R2. Node slices.**
  - One element per node slice, carrying that node's style (font, spacing, `lang`) and nothing that breaks shaping.
  - A bare text node stays a bare text node.
  - Never merge adjacent same-style slices (WebKit kerning, Blink per-item ceil). Never split a slice within a line.
- **R3. Trailing spaces.**
  - Include the trailing collapsible white space in the slice that owns it in the original. The engine trims it
    (Blink `RemoveTrailingCollapsibleSpace`, WebKit trimmable content, Gecko `TrimTrailingWhiteSpace`).
  - Preserved spaces go in as laid out. Leading collapsible spaces of a line are left out.
- **R4. Inline boxes that span lines.** Put `padding`, `border` and `margin` on the inline-start side only on the
  fragment that starts the box, and on the inline-end side only on the fragment that ends it (slice behaviour).
  Otherwise these sides break shaping (§3.1 f, §3.3 e) and add width.
- **R5. Transformed text.** Paint the transformed text and drop `text-transform`. `capitalize` reads the previous
  character, which lives on the previous line after a mid-word edge [S webkit-lines §3.1].
- **R6. Soft hyphen at a line end.** Append the engine's hyphen string (`hyphenate-character`, else U+2010 when the
  primary font has it, else `-`), per engine:
  - **Blink:** `<span style="letter-spacing:0; vertical-align:0px">`. A length `vertical-align` breaks shaping at the
    box edge (`inline_node.cc:494-527`) without moving the baseline [I].
  - **Gecko:** `<span style="unicode-bidi:isolate">`, which breaks the text run (`nsTextFrame.cpp:2091-2096`) and keeps
    letter spacing (§2.3).
  - **WebKit:** a span with no extra style. This matches the layout width, but not the paint kerning (L3).
- **R7. Joining scripts at a mid-word edge** (Blink, Gecko). Append U+200D to line n's text and prepend U+200D to line
  n+1's text [I, probe 5]. WebKit needs nothing (§3.2 c). The ZWJ becomes part of the DOM text.
- **R8. Bidi.** Levels as in §4.4. Trailing preserved white space stays at the base level.
- **R9. No pseudo-elements.** No `::first-line` or `::first-letter` on painted blocks. The first painted line gets
  those styles inline if the paragraph had them.

What the model must supply per line:
- the slices (original node, start and end in the transformed text);
- whether the line starts or ends at a mid-word edge;
- the hyphen string per engine;
- per-engine levels, only for bidi paragraphs;
- the resolved base direction.

---

## 7. What cannot be reproduced

- **L1. Gecko mid-word edges.** Kerning between the last glyph of line n and the first glyph of line n+1, integer
  ligature shares, and contextual forms (§3.3 b). The size is the kern or ligature difference, for example
  |kern(A, V)| at 48px Arial. No DOM form reproduces it, because the original shapes across the edge.
- **L2. Blink and Gecko joining forms at mid-word edges** without R7. With R7 only joining comes back. Other contextual
  lookups that read letters across the edge stay lost [I].
- **L3. WebKit hyphen kerning.** Layout measures the hyphen alone, paint shapes it with the word (§3.2 e). A painted line
  can match the width or the ink, not both, when the font kerns the pair.
- **L4. Gecko fonts whose default lookups use the space glyph** (`gfxFont.cpp:3743-3763`), at line edges [I].
- **L5. WebKit RTL shaping across inline boxes** on candidates cut by a line edge (§3.2 f) [I].
- **L6. Blink line-end CJK punctuation trimming under A-nowrap** (§3.1 e). A-wrap keeps it.
- **L7. Script of Common characters at a line start** inherited from the previous line, in Blink (`RunSegmenter`) and
  Gecko (script itemizer over the text run) [I].
- **L8. Bidi visual order** whenever the model doesn't resolve levels per engine (§4.3). It can't be fixed afterwards
  without DOM reads.
- **L9. Blink same-parity level changes** painted with override spans shape separately where the original shaped them
  together (§4.4), giving sub-pixel kerning or per-item ceil differences [I].

---

## 8. Probes

Common setup for every probe:
- a headed browser at DPR 2 and 100% zoom, `<html lang="en">`;
- widths from `Range.getClientRects()` extents over each line's text nodes;
- the "grid" is 1/64 px in Chrome and Safari and 1/60 px in Firefox;
- "painted" means the §6 painter output, appended to a host of the paragraph's width.

1. **Baseline, space edges (all three).**
   - Paragraph `The quick brown fox jumps over the lazy dog`, `font: 16px Georgia`, `width: 150px`,
     `white-space: normal`.
   - Painted A-wrap and A-nowrap lines, each with its trailing space kept in the slice.
   - Expected: every painted line's extent equals the native line's extent on the grid, in both variants and all
     three browsers. Georgia has no GPOS [S gecko-lines §2.5].
2. **Span edges and shaping breaks.**
   - Premise: OffscreenCanvas `48px Arial`, `measureText("AV").width < measureText("A").width +
     measureText("V").width`.
   - Four `white-space: nowrap` divs:
     - (a) `AV`;
     - (b) `A<span>V</span>`;
     - (c) `A<span style="vertical-align:0px">V</span>`;
     - (d) `A<span style="unicode-bidi:isolate">V</span>`.
   - Expected extents:
     - Chrome: b = a; c = d = W(A) + W(V).
     - Firefox: b = c = a; d = W(A) + W(V).
     - Safari: b = c = d = W(A) + W(V).
3. **WebKit item plus following space (Safari).**
   - Premise, for a font F: `measureText("To ").width − measureText(" ").width ≠ measureText("To").width` at `40px F`.
     Candidates: "Hoefler Text", Zapfino, Baskerville.
   - Paragraph `To be`, `font: 40px F`, width = native nowrap extent of `To` + 4px, so line 1 is `To`.
   - Expected:
     - painted line `To ` (space in the slice): extent = native line 1;
     - painted `To`: extent − native line 1 = `measureText("To") − (measureText("To ") − measureText(" "))`, within
       1/64 px.
   - If no candidate meets the premise, record that the rule has no observable effect for installed fonts.
4. **Blink line-end trimming.**
   - `<div lang="ja" style="font:16px 'Hiragino Mincho ProN'; width:92px">あいうえお。かきくけこ</div>`. If the kana
     aren't 16px wide, use width = 5·W(あ) + W(。) − 4px.
   - Expected in Chrome:
     - native line 1 = `あいうえお。` with extent 88px (the `。` trimmed to half width);
     - painted A-wrap line 1: one line, 88px;
     - painted A-nowrap line 1: 96px.
   - Expected in Safari and Firefox: native line 1 = `あいうえ` (64px; no trimming, and no break before `。`), with
     painted extents equal in both variants.
5. **Joining at a mid-word edge.**
   - Load the lab fixture "Noto Naskh Arabic".
     `<div lang="ar" dir="rtl" style="font:32px 'Noto Naskh Arabic'; word-break:break-all; width:Wpx">بببببببببب</div>`
     (10 × U+0628), with W = 0.6 × native nowrap extent of the same string.
   - Paint line n with U+200D appended and line n+1 with U+200D prepended, and also without the ZWJs.
   - Expected:
     - Chrome and Firefox: native line extents equal the painted-with-ZWJ extents, and differ from painted without them;
     - Safari: native line extents equal the painted extents without ZWJ.
6. **Gecko mid-word kerning.**
   - Premise as in probe 2.
     `<div style="font:48px Arial; word-break:break-all; width:Wpx">AVAVAVAVAV</div>`, with W = native nowrap extent of
     `AVAVA` + 2px.
   - Expected, comparing painted line 1 (A-wrap, same text as native line 1) with native line 1:
     - Firefox: painted is wider by |kern(A,V)| rounded to au, when line 1 ends with `A`;
     - Chrome and Safari: equal on the grid.
7. **Bidi N0 across a line edge.**
   - `<div style="font:24px Arial; direction:ltr">שלום (עולם ab) cd</div>`, with width = native nowrap extent of
     `שלום (עולם` + 2px.
   - Expected, native in all three: line 1 is `שלום (עולם`, and the rect of U+05E9 `ש` is left of the rect of U+05E2
     `ע`.
   - Painted line with no overrides: `ע` is left of `ש`.
   - Painted per §4.4 with levels `[1,1,1,1,0,0,1,1,1,1]`: `ש` is left of `ע`, and every code point's rect x equals
     native within one grid unit.
   - Repeat with the override on an inline `<span style="unicode-bidi:bidi-override;direction:ltr">` wrapper inside a
     plain block. Expected: the same x values.
8. **Form B splits the bidi paragraph.** `<div style="font:24px Arial; width:500px">שלום (עולם<br>ab) cd</div>`.
   Expected in all three: on line 1 `ע` is left of `ש` (§4.2).
9. **`plaintext` base direction.**
   - `<div style="unicode-bidi:plaintext; font:24px Arial; width:Wpx">abc שלום עולם</div>`, with W = native nowrap
     extent of `abc שלום` + 2px.
   - Expected, native in all three: line 2 is `עולם`, with its left edge at x = 0.
   - Painted line 2 with `unicode-bidi: plaintext`: left edge at W − extent.
   - Painted with `direction: ltr; unicode-bidi: normal`: x = 0.
10. **Hyphen and letter spacing.**
    - `<div style="font:16px Arial; letter-spacing:4px; hyphens:manual; hyphenate-character:'-'; text-align:right;
      width:120px">abcdefgh&shy;ijklmnop</div>`, where line 1 must end at the soft hyphen.
    - Compare the rect x of `a` on line 1: native, painted with `-` inside the letter-spaced slice, and painted with the
      R6 span.
    - Expected:
      - Chrome: native = R6 span (`letter-spacing:0; vertical-align:0px`); literal is 4px further left.
      - Firefox and Safari: native = literal; `letter-spacing:0` span is 4px further right.
11. **Form C equals A.** Probe 1's lines as absolutely positioned blocks (`position:absolute; left:0; top:k·lineHeight`).
    Expected: extents equal the A-wrap extents on the grid in all three.

## Open questions

- Blink `HanKerning::MayApply` for the probe 4 font (CRITIC §5 item 12). If it's false, Chrome behaves like Safari there.
- Does `IsBreakable(range_end)` at the end of `text_content` return true in Blink (§3.1 e)?
- Does a length `vertical-align: 0px` change Blink line box metrics in any font? (R6)
- Common-script inheritance at line starts (L7): which installed fonts have script-specific GPOS or GSUB for digits
  and punctuation?
- Does a ZWJ at a mid-word edge (R7) change kerning or GPOS mark positioning in Noto Naskh Arabic or Noto Nastaliq
  Urdu, beyond the joining forms?
