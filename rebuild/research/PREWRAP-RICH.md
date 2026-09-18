# white-space: pre-wrap in rich inline content (2026-09-18)

**Verdict:** the rebuild's model and assumptions do not block `white-space: pre-wrap` in rich inline content. The model already carries white-space and tab-size per element. Every engine reads the item's own style when it fills a line, decides hanging spaces at the line end, and computes tab advances at line time from the line position. Everything that failed was a small port rule, WebKit's own history dependence, or a lab or painter limit. Four experimental fixes to five local port defects (the patch comes to 163 lines with context) made every Firefox prediction metric pass on the 1,259-case main set (slots family 75/75) and removed every Chrome and WebKit position difference a port rule caused. They lost nothing on the round 3 feature families.

All file:line references are at e8ebf19, the base of my worktree. The main tree has since merged round 4 work (584e359), so lines may have moved; I give function names throughout.

## Verdict per engine

- **Chrome (Blink): not blocked.**
  - Line count was right on 1,334 of 1,334 cases.
  - It has two local defects that move positions only: box edges on spans that bidi reordering splits, and justification that expands trailing spaces lying across a box end.
- **Firefox (Gecko): not blocked.**
  - All 36 prediction failures in the main set have one cause: tab-size is read from the block instead of the text frame's own style.
  - A second missing rule (a preserved newline doesn't mark the line as ending in a break) moves alignment and justify positions.
- **Safari (WebKit, via webkit-host): not blocked.**
  - 8 of 8 prediction failures depend on page history. All 8 pass when run alone in a fresh process, and the port reported the `page-history` gap on exactly those lines.
  - One missing rule (which fragment of a split span is its first and last box) moves positions only.
- **Painter:** needs work before anything ships. Painting each line as its own block turns a wrapped line into a last line, which changes how trailing spaces hang and how justify applies next to box edges.

## 1. What is already modeled and tested

**Model.** `TextStyleOf` (`rebuild/src/model.ts:157-167`) carries `whiteSpace` and `tabSize` on the block and on every span. Fragments already have the kinds `hanging`, `trimmed`, `collapsed` and `forced-break` (`model.ts:267-297`).

**Blink**
- `blink/content.ts:454-460` `appendText` picks the builder by the leaf's own style.
  - Preserved text: `appendPreserveWhitespace`, `:410-451`. It adds a generated break opportunity after leading preserved spaces (`:389-401`), tab control items (`:431-437`), forced-break items, and CR/FF control items.
  - pre-line: `appendPreserveNewline`, `:373-386`.
  - Collapsing text: `:293-363`, including the generated break opportunity when a nowrap run collapses a wrapping one (`:320-324`).
- White-space-only nodes follow the leaf's style (`layoutTextNeeded`, `:513-527`).
- `blink/line-breaker.ts`:
  - `handleTrailingSpaces` (`:742-791`) works by item style.
  - Tabs go through `tabShapeResult` with the line position plus the float offset (`:805-810`).
  - Close tags follow ShouldBreakOnlyAfterWhiteSpace (`:912-940`).
  - `rewindOverflow` treats pre-wrap spaces (`:1051-1096`).
- `blink/shape.ts:1319-1349` uses the span's tab-size with the block's font and spacing.
- `blink/index.ts:544-598` `hangWidthOf` ports ComputeTrailingSpaceWidth per item style and skips open and close tags, so hanging works across box edges.

**WebKit**
- `webkit/style.ts:9-32, :69-92` holds the per-box collapse and wrap values and the predicates (`trailingWhitespaceHangs` is pre-wrap only).
- `webkit/content.ts:326-365` makes soft-line-break items and white-space items (whole, or per unit under break-spaces). `:333-335` defers the width of preserved white space when the box holds a TAB.
- `webkit/lines.ts`:
  - `:261-272`: trimmable versus hanging content per item style.
  - `:360, :378`: a box start or end with a nonzero edge cancels the line's hang.
  - `:504-508`: the hang is conditional before a forced break.
  - `:889-901`: the overflow rules with hanging content.
  - `:1389-1399`: a tab is measured at the content edge offset plus the pen position.
- `webkit/measure.ts:213-217` takes tab stops from the box's own tab-size and its own font's space.

**Gecko**
- `gecko/prepare.ts:46-75` builds a per-run style, and `:137-147` picks the compress mode per style.
- `gecko/lines.ts`:
  - `:958-1043`: newline handling, trimming and hanging per frame.
  - `:1400-1440`: TrimTrailingWhiteSpace recursing into spans.
  - `:1467-1480`: GetHangFrom.
  - `:643-657`: `computeTabs` counts from the block's content edge.
  - `:1632-1672`: TextAlignLine with the hang.
- The gap: `prepare.ts:1462-1478` computes one tab width for the whole paragraph.

**What round 3's rows already tested** (`.artifacts/ceiling-20260917/evaluate-r3`, forward order, history-dependent cases left out):
- Flat pre-wrap in the `ws` development and held-out sets: 390 of 390 on line count, breaks and widths in all three browsers. break-spaces was 400/400 (399/399 in webkit-host).
- Tree cases with a pre-wrap block in the rule and feature families: line count and breaks 4,372/4,372 in Chrome, 4,142/4,142 in Firefox and 4,376/4,376 in webkit-host.
- Trees where a span's white-space differs from its parent's (the `nowrap-spans` family and others): every one passes line count and breaks in all three browsers.
  - Chrome 1,320, Firefox 1,120 and webkit-host 1,136 cases.
  - Widths have 0 failures.
- Not covered before today: a tab-size set on a span, justify with a preserved newline, spans with box edges that bidi reordering splits, trailing preserved spaces lying across a box end under justify, and a wbr inside a span with no box edges.

## 2. The case set and pass rates

The generator is `rebuild/lab/cases/rich-prewrap.ts` (run with `bun rebuild/lab/cases/rich-prewrap.ts`). It writes 1,334 cases in 11 families to `.artifacts/prewrap-20260918/cases/rich-prewrap.ndjson` (sha256 starts 61bdf919).
- Families and counts: fonts 144, box-edges 126, span-in-normal 105, normal-in-pre-wrap 105, tabs 183, newlines 100, trailing-spaces 160, bidi 108, narrow 120, nested 108, slots 75.
- 378 of the cases are flat in the lab's sense (a pre-wrap block with plain spans) and 956 are trees.
- This is more than the few hundred asked for; a run takes seconds.

Forward order, scorer 5, Chrome 153.0.8010.50, Firefox 156.0, webkit-host. Percentages are pass over (pass + fail).

| Browser | line count | breaks | widths (pass / fail / unobserved) | painter (pass / fail / unobserved) |
|---|---|---|---|---|
| Chrome | 1,334 / 1,334 (100%) | 1,333 / 1,334 (99.93%) | 1,213 / 1 / 119 (99.92%) | 1,065 / 17 / 252 (98.4%) |
| Firefox | 1,325 / 1,334 (99.33%) | 1,315 / 1,334 (98.58%) | 1,204 / 20 / 91 (98.37%) | 1,022 / 53 / 259 (95.1%) |
| webkit-host | 1,333 / 1,334 (99.93%) | 1,326 / 1,334 (99.40%) | 1,244 / 0 / 82 (100%) | 1,106 / 15 / 213 (98.7%) |

The slots family on its own: Chrome and webkit-host had 0 prediction failures and 0 differing rect values. Firefox had 3 breaks failures, all from the tab-size variant.

Exact rect values on the 1,259-case main set (run1, without the slots family):

| Browser | differing predicted values | differing rect counts |
|---|---|---|
| Chrome | 209 of 88,696 | 12 |
| Firefox | 753 of 93,816 | 15 |
| webkit-host | 182 of 25,918 | 21 |

With the experimental patch (predict-only against the same native rows):
- **Firefox**
  - Every prediction metric passes 1,259 of 1,259 on the main set, and the slots family 75 of 75.
  - 0 of 93,852 predicted values differ and no rect counts differ.
  - Painter failures drop to 12.
- **Chrome**
  - Widths failures go from 1 to 0.
  - Differing values go from 209 to 1.
  - Painter failures go from 16 to 11.
- **webkit-host**
  - Differing values go from 182 to 28. 25 of the 28 sit on the history-dependent rows.
  - 16 more widths become observable.
  - Two of the newly observed widths fail, by one float32 step.
- On round 3's feature families (13,010, 12,050 and 12,268 rows) no metric lost a pass:
  - Chrome's differing values go from 11 to 0.
  - webkit-host's go from 247 to 193.
  - Firefox is unchanged.
- Engine unit tests in the patched scratch copy: 237 pass. The 2 that fail there only miss `rebuild/data` files I didn't copy; all 239 pass in the unmodified worktree.

## 3. Every failure, by class

### A. Rules a port lacks (all local)

**G1. Gecko: tab-size comes from the text frame's own style.**
- In Firefox, `ComputeTabWidthAppUnits` (`nsTextFrame.cpp:3875-3906`) reads tab-size from the text frame and the space width and spacing from the containing block.
- The port (`gecko/prepare.ts:1476`) uses the block's tab-size for every run.
- All 36 Firefox prediction failures in the main set, and the 3 in slots, are spans with their own tab-size. 6 such cases pass by luck, and no case with the block's tab-size fails.
- Example `c-07ac640c4ed9f71f`: the engine line is 1,728 au wide, the native line 6,912.

**G2. Gecko: a text frame that ends in a preserved newline sets LineEndsInBR.**
- Firefox sets it at `nsTextFrame.cpp:11472-11476`, and `nsBlockFrame.cpp:5971-5974` reads it to decide the last-line alignment.
- The port sets it only for `<br>` (`gecko/lines.ts:1293`; the newline branch is at `:1056-1057`).
- Under justify, a line before a preserved newline was therefore justified. Example `c-b4c6bea8cb3653f5`: the space after "alpha" is 4.3 px natively and 15.4 px expected.
- The same rule also moves where content sits on lines with a hang.
- Line breaks were unaffected. It affects flat paragraphs too; no existing family combines justify with a newline.

**B1. Blink: a box that bidi reordering splits into fragments.**
- In Chrome, the fragment's `BoxData(other, start, end)` copies only the item and the rect (`inline_box_state.h:328-332`).
- The port copies the whole record with `{ ...boxes[boxIndex - 1] }` (`blink/index.ts:1005`), so the fragment gets a second line-left edge.
- It shows wherever preserved trailing spaces sit at the other level inside a span with edges: an RTL block with Latin text, or an Arabic span in an LTR block.
- Example `c-5c539d896162748d`: "gamma" is at 105.648 natively and 107.648 expected.
- It explains:
  - the one Chrome widths failure (`c-76988d9af309476d`, a −3px end margin);
  - 10 more cases where only positions differ;
  - 5 painter failures.

**B2. Blink: EndOffsetForJustify.**
- `ComputeTrailingSpaceWidth` (`line_info.cc:289-415`) skips items that are opaque to collapsing, such as tags. It hands back the offset before all the trailing spaces.
- The port's loop (`blink/index.ts:710-716`) stops at the first item result that isn't only trailing spaces, such as a close tag.
- The spaces before a box end were therefore expanded as justification opportunities. 7 cases.
- Example `c-bb8068601ab36af7`: "alpha beta " is 111.906 px natively and 86.344 px expected.
- Only positions moved; the hang width was already right.

**W1. WebKit: first and last box under bidi reordering.**
- `computeIsFirstIsLastBox` (`InlineDisplayContentBuilder.cpp:1036-1060`, read at `:770-772`) gives the start edge to a span's first display box on the line and the end edge to its last.
- The port's `bidiDisplayBoxes` gives both edges to every fragment (`webkit/lines.ts:2102, :2179-2180`).
- About 17 cases. Only positions moved: the text shifts by the duplicated edge.
- After the fix, 3 cases remain one float32 step off, for example 119.00000763 against 119. That is summation order.

### B. The browser's own history dependence, a named gap, not a port defect

**W2. WebKit's process-wide TextBreakingPositionCache.**
- It hands a pre-wrap node the per-space item structure that an earlier break-spaces paragraph with the same text left behind.
- Natively, the last space then wraps together with a box end that has an edge.
- Example `c-0e4174c0ddcc1e52`: 20 spaces in a span with 6px end padding; 19 spaces stay on the line and the last one moves to the next line.
- This covers all 8 webkit-host prediction failures plus 2 cases where only rect counts differ.
- All 10 pass alone in a fresh process, and each one's native layout alone differs from its layout in the full run (`isolate-host`, `isolate-host2`). The port reported `page-history` on exactly those lines.
- For a future feature: a page that uses the same strings under both break-spaces and pre-wrap is history-dependent in Safari itself.

### C. Lab observation limits (lines and text rects agree)

- **Element rects of spans with no box fragment (12 cases).**
  - `lab/observe/blink.ts:476-478` leaves `<wbr>` "unsettled". These native rows settle it: a wbr inside such a span reports a zero-width rect at its position. 9 cases, for example `c-1cef17b63706b01e`.
  - 3 cases come from the documented stand-in at `blink/index.ts:1198-1205`, which takes any different font declaration as a different font height. Verdana regular around Verdana bold italic doesn't create a box fragment natively (`c-43b2450047abf23f`).
- **Chrome's one breaks failure, `c-a37545c096e939be`.**
  - A pre-line span's only text is a trimmed trailing space.
  - Natively the span reports a zero-width rect at the line end; the observation port expects none.
  - Every code point is on the right line.
- **63 limited `tab-stops` values in Chrome.**
  - In an RTL tab run the partial first advance sits on the other tab of the pair; the sum is the same.
  - Flat `ws` rows show the same 53 differences, so this is not specific to rich content.
- **Unobserved widths:** Chrome 119, Firefox 91, webkit-host 82.
  - The first-run split for the 1,259-case main set is 110, 83 and 78. Most are a span margin at a line edge, which no rect shows: 77 of 110, 83 of 83 and 58 of 78.
  - The rest are lines with padded spans next to hanging spaces, alignment or RTL.

### D. Painter limits

First-run counts are 17, 53 and 15.
- **Firefox 53:** 39 are the G1 tab-size rows. The other 14 fall to 12 with the patch. Of those 12, 7 are justify with hanging spaces in `trailing-spaces`; the other 5 are in `bidi` (2), `newlines` (2) and `nested` (1, a `<br>` after spaces).
- **Chrome 17:**
  - 5 are B1 and go away with its fix.
  - 6 are "painted line wraps". A one-line block makes the line a last line, where pre-wrap spaces hang only conditionally. A box end's padding or margin after them then overflows and wraps, as do end and justify alignment. Examples: `c-395cc1859d9b105b`, `c-fc24e0137719bb7b`.
  - 4 are one LayoutUnit wide, from hanging spaces or U+3000 painted as their own node (`c-35d522f87eafad25`).
  - 1 is 1 px on a break-spaces span in a normal block.
  - 1 is a painted-line wrap in the slots family that I didn't trace.
- **webkit-host 15:**
  - 8 are the history rows.
  - 3 are W1.
  - 1 is a float32 step.
  - 2 are lines that wrap when painted alone (a newline in a nested span; an RTL block with negative margins).
  - 1 is justify with hanging spaces.

## 4. What a rich pre-wrap feature needs beyond today's model

- **Input:** nothing new.
- **Engines:** the five rules above, each under 20 changed lines.
- **Tab stops** have to stay a line-time computation.
  - They depend on the line position: text-indent, the slot's left inset, and any box edges before the tab.
  - All three ports already compute them at line time, so taking the width out of `Paragraph` (decision 2 of ARCHITECTURE-PLAN-2) doesn't conflict.
  - The rule differs per engine. Blink and Gecko use the span's tab-size with the block's font and spacing; WebKit uses the span's tab-size with the span's own font.
  - Tabs after padded and margined box starts, tabs under text-indent, and tabs beside floats with uniform, decreasing or increasing insets all pass. Spans with their own tab-size fail only in Firefox (G1).
- **Hanging spaces** are decided after the break, per item style.
  - They hang conditionally before a forced break or on the last line.
  - Blink lets box ends follow hanging spaces on the same line. WebKit cancels the line's hang when a box start or end has an edge. Gecko reads only the last text frame's hang.
  - All of this is modeled: the 160 `trailing-spaces` cases pass line count and breaks everywhere except the WebKit history rows.
- **App-facing output:** the fragments already say hanging, trimmed, collapsed and forced-break.
  - An API for apps would also need x and width per fragment in CSS px, tab advances included.
  - Today only the lab's observation ports derive those (`model.ts:638-640`).
  - That is an API question, not a block.
- **Painter:** this is the real work before shipping. It would have to place hanging spaces and span edges itself on such lines, or paint them in a form that keeps the line from being a last line.
- **Tests:** add rule families for tab-size on a span, justify with a preserved newline, split spans with edges, and trailing spaces across a box end under justify.

## 5. Main's other rich-inline limits (README.md:117, :165-222)

- **A flat item list only.** Not blocked: the model is a tree.
- **`extraWidth` lumps padding and border.** Not blocked:
  - Margin, border and padding are modeled per side and split across lines.
  - `box-decoration-break: clone` isn't modeled.
- **`break: 'never'` chips.** Not blocked: a nowrap span or an atomic inline covers them.
- **No `<br>`, `<wbr>`, text-indent, text-align, justify or float-narrowed lines.** Not blocked: all are modeled and have families.
- **No bidi levels.** Not blocked:
  - Levels and visual order are computed per engine, with positions per fragment.
  - Spans inherit the block's direction, though; per-span `direction` and `unicode-bidi` aren't in the model.
- **Options main fixes** (tab-size 8, `line-break: auto`, `overflow-wrap: break-word`, no word-spacing, no `lang` per item). Not blocked: all are per element in the model.
- **The same as main, by choice:**
  - one fixed line height on the block and every inline;
  - only `baseline` and `0px` for vertical-align;
  - no atomic inline taller than the line;
  - no font-feature or font-variation settings;
  - no text-transform;
  - no hyphens: auto.

## Files

- Commit 57ad03d on branch `r4-prewrap`, in `~/github/pretext-rebuild-wt/prewrap` (new files only):
  - `/Users/chenglou/github/pretext-rebuild-wt/prewrap/rebuild/lab/cases/rich-prewrap.ts`
  - `/Users/chenglou/github/pretext-rebuild-wt/prewrap/rebuild/research/rich-prewrap-experiment.patch`. It is not applied, and `git apply --check` is clean at e8ebf19.
- Artifacts are under `/Users/chenglou/github/pretext-rebuild/.artifacts/prewrap-20260918/`:
  - `cases/`: the case file.
  - `run1/<browser>`: the 1,259-case main set.
  - `run2-slots/<browser>`: the 75 slots cases.
  - `exp1`, `exp2`, `exp2-slots`, `exp2-features`: the patched library, predict-only.
  - `isolate-host`, `isolate-host2`: the WebKit cases run alone in fresh processes.
  - `experiment-fixes.patch`: a copy of the patch.
- Every `*rows.ndjson` has a verified `.zst` beside it and the originals are left in place. The folder is 776 MB.
- No browser job failed.
- Only forward order ran, plus the two isolation runs, so history dependence in Chrome and Firefox was not checked.
- I wrote no notes file; this report is the write-up.
