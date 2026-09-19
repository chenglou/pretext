# Capability check: what the function set lets an application do (2026-09-19)

Branch `x-capability-check`, worktree `~/github/pretext-rebuild-wt/caps`, base 1e464d5. Scripts are in `rebuild/research/capability-check/`. No browser ran. Every number comes from the stand-in Canvas (`rebuild/tools/stand-in-canvas.ts`). It shows which calls exist, what they return, and how many Canvas questions they ask. It says nothing about a browser's widths.

## Short answer

No door is closed. Each capability that DEMO-COVERAGE listed is in one of three states:
- It works today.
- It works through a few lines that read an engine's own record.
- It needs a small change, which I wrote and ran for two of the three engines.

The clean-up stage running now (X3) keeps every seam I used. I merged the `ra-x3-blink` and `ra-x3-gecko` heads with my branch in scratch copies. After three field renames the proofs gave the same numbers:
- Blink: `p.settings[i]` became `p.styles[i].iterator`, and `p.sourceLength` became `p.index.text.length`.
- Gecko: `p.runStyles[r]` became `p.leaves[r].style`.
- `ra-x3-webkit` conflicts with my proof lines textually, but its builders still take `rangeEnd` as data.

Three things are worth knowing before the API is designed:
1. No CSS-px width exists anywhere in `src`. It is the one gap that blocks the most demos, and it costs 3 to 5 lines per engine.
2. With that width, an application's own line breaker (Knuth-Plass) already works on the function set, Blink included. Fills at width 0 list the break opportunities. Candidate widths can be summed. A slot halfway between two candidate widths makes `fillLine` return the chosen line.
3. DESIGN.md §2.6's shrink-wrap claim is wrong for Gecko when a line ends inside a span that has end border or padding.

## How it was checked

- Samples (`setup.ts`), all with overflow-wrap: break-word, which is what main's demos mean:
  - Latin: 340 units with one 45-letter word.
  - CJK: 125 units, lang ja.
  - Arabic: 195 units, rtl.
  - Spans: a bold span, a link with 1px border and 4px padding, a 64px atomic chip, and a `<br>`.
  - `--wrap=normal` switches the samples to overflow-wrap: normal.
- Engines: Blink, WebKit and Gecko environments at the pinned builds, devicePixelRatio 2, font facts unknown.
- Status words:
  - **as is**: only the exports of `rebuild/src/index.ts` at 1e464d5.
  - **internals**: reads an engine's own record or file; I name it and say what would have to be exported.
  - **model**: needs a change to how a port works.
- "Calls" are `measureText` calls. "New" means a (context, string) pair the run had never asked before.
- Unmerged proofs on the branch (151 added lines in `src`, all marked `research/capability-check`):
  - `lineWidth` and `lineStartAt` in each engine's `index.ts` and in `src/index.ts`.
  - An optional end for WebKit's and Gecko's `fillLine`.
  - An optional `onElement` callback in `paintLines`.
  - `bun test rebuild/src` still passes (367 tests). `tsc` passes on `rebuild` and on the scripts.

## Capability table

| Capability | Blink | WebKit | Gecko |
|---|---|---|---|
| a. Width per layout | as is | as is | as is |
| b. Line count at a new width, no fragments | as is; every fill asks Canvas again (423 to 1,122 calls per width) | as is; 0 calls in the common case | as is; 0 calls at a width filled before, or under overflow-wrap: normal outside CJK |
| c. CSS-px line width, widest line, natural width | internals: `line.info.width` less `trailingSpacesOf` (pieces.ts:191), divided by 64 and the layout zoom | internals: `line.line.contentLogicalWidth` less `line.hanging.width`, divided by the page zoom | internals: needs `placeLine` (placement.ts:245), then `(lineISize − hang) / 60` |
| c'. Shrink-wrap to the widest line | holds at 55 of 55 widths on all four samples | holds at 55 of 55 (54 for Latin, where one width overflowed and was skipped) | fails at 2 of 55 on the spans sample; DESIGN §2.6 needs an exception |
| d. Several slots per row, carried cursor | as is | as is | as is |
| e. Painted text mapped to the application's tree | as is (`run` and `element` on fragments) | as is | as is |
| f. How a line ended | end of text, forced and hyphen as is; opportunity against inside a word: internals (the iterator's `isBreakable` at the next start) | same; internals: `next.offset !== 0` | same; internals: `breakFlags[nextT[end]] !== BREAK_NORMAL` |
| f'. "Did a word break" for a headline fit | as is: overflow-wrap: normal plus `linePieces().overflows` | as is | as is |
| g1. Line start from a source offset | internals, 20 lines; equals the engine's own start at 81 of 81 | internals, 14 lines; fills the same line at 76 of 77, differs by design in the carried width | internals, 8 lines; 77 of 77 |
| g2. Break opportunities | as is: fills at width 0; equals the iterator run from offset 0 | as is | as is; equals `breakFlags` |
| g3. Candidate line widths | `lineWidth` plus sums; exact on the greedy lines | same; within 0.0003px of engine-closed lines (242 candidates) | same; exact (241 candidates) |
| g4. Close the line at a chosen opportunity | by slot width as is plus `lineWidth`: 252 of 252; a direct call is **model**, about 50 to 70 lines, no seam | by slot width 242 of 242; direct call proven with 3 changed lines | by slot width 241 of 241; direct call proven with 3 lines and a 15-line helper |
| h1. Identity on the painter's DOM | **model**, small: a 6-line callback in `paint.ts` (proven) | same | same |
| h2. Piece positions in px on a plain paragraph | internals, and costly: `geometryOf` measures every cluster (2,260 to 4,766 calls per sample) | internals: `lineGeometry` (output.ts:38), 0 calls | fused with gaps in `inspectLine`, which throws on a plain paragraph; `placeLine` has frame positions |
| i. Contexts shared across paragraphs | one seam (index.ts:124) | one seam (content.ts:548) | one seam (prepare.ts:410) |
| A start is plain data | 143 bytes as JSON | 196 bytes | 69 bytes |
| Nothing handed out aliases prepared data | true | true | true; only the decided line shares objects (its text runs), as documented |

## Per capability

### b. Count at a new width (`count.ts`, `count-cost.ts`)

Call sequence: `prepare(paragraph, env, false)` once. Per width: `firstLine`, then loop `fillLine(prepared, start, { width, left: 0, right: 0 })`, count the results with `hasLineBox`, and continue from `result.next`. `linePieces` is never called. All 12 cases equal fresh prepares.

Calls at 320, 240, 410, then 320px again (new in brackets):

| | prepare | 320 | 240 | 410 | 320 again |
|---|---|---|---|---|---|
| Blink Latin | 633 | 577 (103) | 829 (67) | 423 (26) | 577 (0) |
| Blink CJK | 931 | 916 (31) | 1,122 (10) | 816 (8) | 916 (0) |
| Blink Arabic | 274 | 234 (57) | 351 (54) | 214 (22) | 234 (0) |
| Blink spans | 303 | 250 (62) | 310 (30) | 151 (13) | 250 (0) |
| WebKit Latin | 63 | 0 | 8 (7) | 0 | 0 |
| WebKit CJK, spans | 131, 61 | 0 | 0 | 0 | 0 |
| WebKit Arabic | 109 | 8 (4) | 12 (6) | 6 (3) | 8 (0) |
| Gecko Latin | 53 | 276 (194) | 176 (97) | 83 (44) | 0 |
| Gecko CJK | 42 | 359 (257) | 1 | 9 (4) | 0 |
| Gecko Arabic | 35 | 62 (53) | 134 (95) | 38 (26) | 0 |
| Gecko spans | 43 | 115 (95) | 99 (63) | 46 (29) | 0 |

Under overflow-wrap: normal, Gecko asks 10, 0, 0, 0 (Latin) and 0 at every width (Arabic, spans). CJK still asks 359 once.

The plan's promise (b), "another width asks Canvas nothing new in the common case", holds as follows:
- WebKit: it holds.
- Gecko: it holds once an offset has been measured, because the per-offset records are kept on the prepared paragraph.
- Blink: it holds for distinct questions only. Every fill asks its positions again, even at a width already filled. That is DESIGN §4.7's known cost, and plan §10 rows 2 and 3 are the candidates. It is cost, not a closed door.

CPU time under the stand-in, on a busy machine, for one paragraph's count:
- Blink: 0.9 to 2.9 ms.
- WebKit and Gecko: 0.02 to 0.11 ms.
- Reading pieces or widths adds little.

### c. Widths in CSS px (`widths.ts`, `shrink-wrap.ts`)

Where the conversion lives: px to engine unit only.
- Blink: `lengthLU` (content.ts:80), called in LineBreaker's constructor (line-breaker.ts:191-193).
- WebKit: `layoutUnit(f32(width × zoom))` in `lineRect` (lines.ts:1934-1937).
- Gecko: `pxToAu` (prepare.ts:38) in `bandOf` (lines.ts:588).
- The reverse exists nowhere in `src`. It is in DESIGN §2.6's prose and in the lab (score.ts:300, :311; observe/*.ts).

`linePieces` doesn't give what a caller needs. It gives `overflows`, a boolean computed from exactly the three numbers a width needs (blink/pieces.ts:281, webkit/output.ts:32, gecko/pieces.ts:139), but not the number.

`lineWidth` on my branch is 3 to 5 lines per engine.
- It equals the inspected geometry's width on all 12 cases.
- Natural width: the widest line in a slot of a million px. It asks 0 extra calls, except 442 for Blink CJK.
- Gecko's width needs `placeLine`, which trims a copy of the line.

Shrink-wrap: fill, take the widest line, round it up to the engine's unit, fill again. The lines are the same at every width tried, except Gecko with the spans sample at 2 widths. For example, 323px shrinks to 314.85px and line 1 changes from 0-45 to 0-41.
- Cause: Gecko takes a span's end border and padding off the available width on every line of the span, not only its last (`availableISize -= framePadding.IEnd`, nsInlineFrame.cpp:516 in the pinned source; port lines.ts:733).
- A line that ends inside such a span therefore needs more room than its content is wide.
- Where to fix:
  - DESIGN.md §2.6, "Shrink-wrap", needs this exception now.
  - A later width helper should return Gecko's needed width: the content plus the end edges of the spans still open at the line's end.
  - Until then an application counts again at the shrunk width.
- bubbles (plain text) is not affected. markdown-chat's inline code with padding would be, in Firefox.

### d. Slots and a carried cursor (`columns.ts`)

The layout: two 260px columns of 7 rows. Rows 2 to 4 have two slots around an obstacle. Row 5 has a 12px sliver. One `fillLine` runs per slot. A `below-floats` result takes no line and hands on its `next`.

The lines tile the text in all 12 cases. Example line counts per column: Latin in Blink 11 + 6, spans 11 + 3.

Two notes for demo ports:
- Slots with insets follow each engine's float rules, so the engines differ.
  - Under break-word, Gecko refuses 8 slots for the Latin sample, because the long word moves below the floats.
  - Blink and WebKit break the word into the slot.
  - Under overflow-wrap: normal, all three refuse those 8.
  - Slots given as plain widths (`--plain-slots`) are never refused.
- In WebKit, once a slot has insets, `hasFloats` stays set on every later start. Every later line then runs the full LineBuilder instead of the simple builders.

Application-defined geometry should use plain widths.

### f. How a line ended (`line-end.ts`)

- As is: `next === null` means end of text. A `forced-break` or `br` fragment means a forced end. A `hyphen` fragment means a hyphen.
- Opportunity against inside a word needs internals. At 150px the three engines agree: two breaks inside the long word, and every other break at an opportunity.
- What the demos need works as is: reject a headline size that breaks a word. Lay out with overflow-wrap: normal and read `overflows`. Line 4 overflows in all three engines.

### g1. A start from a source offset (`offset-start.ts`)

`lineStartAt` builds the engine's start from the prepared paragraph's maps:
- Blink: `contentOffsets`, the item scan, and the style ComputeCurrentStyle gives there.
- WebKit: an item scan with `sourceOffset` (lines.ts:1874).
- Gecko: the items' `at` offsets.

At every line start the engines reached themselves (two widths):
- Blink: 81 of 81 equal as JSON.
- Gecko: 77 of 77.
- WebKit: equal but for `previousLine.carriedWidth`, which is a fact of the previous line's fill. It fills the same line at 76 of 77. The miss is the rest of a split word, whose width WebKit carries instead of measuring fresh (DESIGN §2.7).

An offset alone can't say which side of a `<br>` or an atomic inline the start is on. A full position needs a side or the engine's item index.

The drop cap doesn't need any of this:
- Slicing the first letter off and preparing the rest gives the same lines as a start at offset 1 in all 12 cases. Gecko Arabic's first line measures 317.70 against 319.38px, because the start falls inside a joined word.
- A CSS `::first-letter` box is its own shaping run anyway.

A start survives JSON and serves another prepared object of the same paragraph (12 of 12).

### g2 to g4. An application's own line breaker (`breaks.ts`, `close-here.ts`, `close-by-width.ts`)

Opportunities, as is:
- With overflow-wrap: normal, a fill at width 0 places the content up to the first opportunity. A walk at width 0 therefore lists them, and each `next` is a native start.
- Unit counts: 53 (Latin), 119 (CJK; Gecko 114, its own rules), 34 (Arabic), 59 (spans).
- The lists equal Blink's iterator run once from offset 0 and Gecko's `breakFlags` on the flat samples.
- Calls:
  - Blink: 3,257 (Latin) and 9,509 (CJK).
  - WebKit: 0 (22 for spans).
  - Gecko: 10 (Latin) and 359 (CJK).
- Blink builds a new iterator per line and restarts ICU at each line start, which X3 already plans to fix.

Candidate widths, with `lineWidth`:
- A fill from each unit's start in a million-px slot gives the width to the paragraph's end. Differences of those widths give the width of any stretch between two starts.
- Against lines the engines closed themselves (through the proofs below), the sums are within 0.0003px in WebKit and exact in Gecko.
- Cost: one wide fill per unit. For Blink CJK that is 15,094 calls.

Close the line where the application says:
- By slot width, with no engine change: a slot halfway between the sum to B and the sum to the next opportunity made `fillLine` end at B.
  - Blink: 252 of 252. WebKit: 242 of 242. Gecko: 241 of 241.
  - Every width was within 1/64 px of the sum.
  - The result is a real decided line with pieces to paint.
  - Halfway forgives an error of up to half the next unit's width. A real font's line-end reshape would need that margin. The stand-in has no such error to show.
- A direct call, per port:
  - **WebKit**:
    - The functions are `nextWrapOpportunity` (lines.ts:1289), `isAtSoftWrapOpportunity` (:1266), `candidateContentForLine` (:1359), `commitCandidateContent` (:1583), and the close steps `handleTrailingTrimmableContent` (:434) and `handleTrailingHangingContent` (:501).
    - They are free functions over a plain `Builder` record (:987) whose `rangeEnd` is data, but none is exported.
    - Passing an end item to `rangeEnd` is 3 changed lines. It gives the same range and width on 23 of 23 greedy lines.
    - This is the nearest of the three.
  - **Gecko**:
    - Opportunities are prepared data (`breakFlags`, types.ts:188). The scan is `breakAndMeasureText` (lines.ts:166). `rangeAdvance` (:75) is exported, but needs a Provider that only `reflowText` builds.
    - The block's redo already forces a break at a saved position (`reflowPass`'s `force`, :597).
    - Turning a source offset into that position is a 15-line helper plus 3 changed lines. It gives the same range and width on 23 of 23 greedy lines, and the same next start on 22.
    - The one different start ends at the `<br>`. The offset there can't say on which side of the `<br>` the line ends.
  - **Blink**:
    - `LineBreakIterator` (breaks.ts:100) is exported and constructible. It gives the text opportunities, but:
      - its locale, settings and break type follow the current item's style, which only `LineBreaker.setCurrentStyleForce` (line-breaker.ts:232) sets;
      - opportunities at atomic inlines and tags live in the handlers (`canBreakAfter`, :557).
    - There is no close step. `shapeLine` and `shapeLineWith` (:601, :624) find the end from a width, and the reshape of the line's end is the tail of that search (:741-798).
    - A direct call needs three things:
      - that tail as a step of its own, `shapeLineTo(item, sr, start, end)`;
      - an end bound in `atEnd` (:257);
      - an end bound in `handleText` (:438).
    - That is about 50 to 70 lines. It should not happen in X3, which moves ShapeLine verbatim. It belongs with the API work, and the slot-width route covers the need until then.

### h. Identity and positions (`identity.ts`, `geometry-plain.ts`)

- Identity as data works as is. For example, WebKit's line 2 of the spans sample reads `text@leaf3 box-end@element1 text@leaf4 atomic@element2 text@leaf5 trimmed@leaf5`.
- `paintLines` sets only styles and `lang` on its elements.
  - With the 6-line `onElement` callback the application is handed each span and atomic box with its element index.
  - An absent callback changes nothing the painter differential records.
  - A callback can attach an href handler or a chip's content. It can't turn a span into an `<a>`.
- Positions in px come only from `inspectLine` on an inspected paragraph, which costs:
  - Blink: 2,811 to 6,251 calls per sample.
  - WebKit: 0 to 272.
  - Gecko: 33 to 719.
- On a plain paragraph:
  - WebKit's `lineGeometry` is separable and asks nothing.
  - Blink's `geometryOf` runs with a null gap sink but still measures every cluster. Positions and clusters are fused in `itemsOf` (inspect.ts:307).
  - Gecko's geometry sits inside `inspectLine` with the gaps and throws on a plain paragraph. `placeLine` already has the frame positions.
- No demo among the eight reads positions today.

### i. Contexts (`shared-contexts.ts` with `shared-contexts.patch`, scratch copy only)

Each prepared paragraph makes its own contexts. Over 200 paragraphs with unknown font facts:

| | contexts made | per paragraph | with one shared list |
|---|---|---|---|
| Blink | 2,500 | 12.5 | 1,520 |
| WebKit | 1,348 | 6.7 | 1,007 |
| Gecko | 748 | 3.7 | 15 |

- With one list shared through the three one-line sites, the lines and the calls are identical.
- What remains is the font checks' own contexts, made per prepare (font-checks.ts:320): about 7.6 a paragraph in Blink and 5 in WebKit.
- For markdown-chat's 10,000 blocks that is about 125,000 canvases in Chrome today.
- The door is open:
  - Three engine sites and the font checks' resolution would take a list from outside.
  - The records that hold contexts by reference don't change.
- What is missing is browser proof. Chrome caches shaped words per canvas, so plan §10 asks for a three-order run. The stand-in has no such cache.

## The eight demos

| Demo | What it needs | Status now | Still missing |
|---|---|---|---|
| accordion | a count at a new width, 4 texts | served as is | nothing; cost only in Blink |
| masonry | the same for 1,904 cards per frame | served as is | cost: Blink asks Canvas on every fill; about 12 contexts per card |
| bubbles | count; the widest line; a binary search on the count | count as is | `lineWidth`. Shrink-wrap is safe for its plain text |
| dynamic-layout | slots with a carried cursor; "did a word break"; title line widths; a natural width | slots and the word test as is | `lineWidth` |
| editorial-engine | the same, plus several slots per row and a body that starts after the drop cap | as is; drop cap by slicing the letter off, which gives the same lines | `lineWidth`. A true offset start is internals only, and not needed here |
| justification-comparison | opportunities, candidate widths, its own Knuth-Plass, its own Canvas painting | opportunities as is; widths, sums and chosen lines with `lineWidth` (735 of 735 closed by slot width) | `lineWidth`. A direct close call: WebKit 3 lines, Gecko 18, Blink no seam. Justified space widths come only from `inspectLine` |
| rich-note | a tree with chips and links; one span per painted piece | layout as is; identity as data as is | `paintLines` identity (6-line callback), or the app paints from fragments itself |
| markdown-chat | 10,000 blocks kept; a count per width; bubble width; lines for about 20 rows; links and code | counts and lines as is; pre-wrap is in the model | `lineWidth`; the painter callback; shared contexts; in Firefox, shrink-wrap around padded inline code must count again |

variable-typographic-ascii (the ninth demo in DEMO-COVERAGE) needs only `lineWidth` at an unbounded width.

## Doors closed or closing, and where to fix each

1. **No CSS-px width in `src` (closed, trivial to open).**
   - Where: one function per engine beside `linePieces`, or a field of `LinePieces`.
   - When: the final step (step 4), or the API work.
   - Size: 3 to 5 lines per engine.
   - If it waits, the only unit-to-px code stays in the lab's scorer.
2. **Gecko's shrink-wrap exception (a wrong claim in DESIGN §2.6).**
   - Fix the text now.
   - A width helper for Gecko should return content plus the end edges of open spans. It reads `PlacedSpan.hasEndEdge` and `el.edges.endBorderPadding`.
3. **Positions fused with inspection in Blink and Gecko.**
   - Where: Blink `itemsOf` (positions and clusters together); Gecko `inspectLine` (geometry, characters and gaps together).
   - X3 is the cheap moment to separate "positions" from "clusters and characters", since it already cleans those files and the result is identical.
   - Later it costs a second pass over frozen code.
   - It is not needed by the eight demos.
4. **Blink has no "close the line here" seam.**
   - Where: `shapeLineWith`'s tail.
   - Not X3 and not the final step. Do it with the API work, if the slot-width route proves too weak in a real browser. A font whose line-end reshape exceeds half a unit would show that.
5. **Blink asks Canvas on every fill.**
   - This is known (DESIGN §4.7).
   - It is the cost that decides accordion, masonry and chat.
   - It belongs to the profiling phase (plan §10 rows 2 and 3).
6. **Contexts per paragraph, and font checks per prepare.**
   - Open mechanically: four sites.
   - Needs a Chrome run in three orders.
   - When: after profiling, or step 4 if the maintainer wants the seam in place.
7. **A source offset is not a full position at an element without text.**
   - A note for API design; nothing to fix now.
8. **X3's knip pass.**
   - Nothing the capabilities read is unused today. They read: `contentOffsets`, `sourceOffsets`, `LineInfo.width`, WebKit's `rangeEnd` and `sourceOffset`, Gecko's `breakFlags`, `nextT`, `tSource`, `force` and `placeLine`.
   - If a later pass finds one of them dead, this list says why to keep it.

## The three cheapest things that would open the most

1. **`lineWidth` in CSS px**, 3 to 5 lines per engine.
   - It opens bubbles, dynamic-layout, editorial-engine, markdown-chat's bubble and marker widths, and variable-typographic-ascii.
   - With the width-0 walk and the slot-width trick, it opens justification-comparison in all three engines.
   - It should carry the Gecko needed-width rule.
2. **The painter's element callback**, 6 lines in `paint.ts`.
   - It opens rich-note and markdown-chat on `paintLines`.
3. **A contexts list handed to `prepare`, and font checks that outlive one prepare**, four sites.
   - It removes about 12 of Blink's 12.5 contexts per paragraph for masonry and chat.
   - Code is cheap; it needs one Chrome run in three orders.

Next in line is `lineStartAt` (8 to 20 lines per engine), for editors and for resuming a long paragraph. No demo needs it.

## Limits

- Stand-in Canvas only. Its kerning, ligatures and joining make wrong data flow show, but it has:
  - no line-end reshape error;
  - no per-canvas cache;
  - no font fallback surprises.
- A browser run would have to confirm these three results:
  - the slot-width close (735 of 735);
  - the sums' accuracy;
  - the shared contexts result.
- One paragraph per script and four samples. No `pre-wrap`, tabs, text-indent, justify or soft hyphen sample.
- The X3 check used the committed heads (ra-x3-blink 3aced8f, ra-x3-gecko 9c7808b, ra-x3-webkit 1c32ac8), not their uncommitted edits.
- The 13 scripts that run on the branch as it is take about 40 seconds together and need no browser. They can serve as a door check after X3 and step 4. `shared-contexts.ts` runs only in a patched scratch copy.
- Script outputs are kept in `<scratch>/capability-check-out/`.

## Limits

- Every number is from the stand-in Canvas and no browser ran. A browser still has to confirm the slot-width close (735 of 735), the accuracy of summed candidate widths, and the shared-contexts result. The stand-in has no line-end reshape error and no per-canvas cache.
- DESIGN.md §2.6's shrink-wrap claim has a counter-example. Gecko reserves a span's end border and padding on every line of the span (nsInlineFrame.cpp:516 in the pinned source; port lines.ts:733). Shrinking to the widest line moved lines at 2 of 55 widths on the spans sample. I did not edit DESIGN.md; the text needs an exception.
- In Blink, a count at a width already filled still asks Canvas as many times as the first fill (577 calls for the 340-unit Latin sample). Promise (b), 'nothing new', holds for distinct questions only. This is known (DESIGN §4.7, plan §10) and is cost, not a closed door.
- The unmerged proofs read internal fields that X3 renames. I adapted them in scratch copies merged with the ra-x3-blink and ra-x3-gecko heads, and they gave the same numbers. ra-x3-webkit conflicts textually with the proof lines in webkit/index.ts and webkit/lines.ts; the rangeEnd seam itself is still there. The proofs are not meant to merge.
- Blink has no seam for a direct 'close the line here' call. I did not build one and estimate it at 50 to 70 lines. The slot-width route covers the need on the stand-in.
- A source offset alone cannot name a start at an element without text (before or after a <br> or an atomic inline). WebKit's native start also carries a width from the previous line's fill that a made start cannot know: 76 of 77 made starts fill the same line, and the miss is the rest of a split word.
- The samples have no pre-wrap, tab, text-indent, justify or soft-hyphen case, and each script lays out one paragraph at a time.
