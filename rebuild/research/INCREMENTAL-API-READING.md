# Main's incremental-prepare work: what to keep in mind for the rebuild's API

Read-only, from the issues, branches and documents the task named. Prototype numbers are quoted from #313, not re-measured: V8 with a fake Canvas, no browser timing (only the owner prototype ran in Chrome 152). Treat them as floors.

**Short answer.** None of the old API shapes should come back. Four things are worth keeping: how exactness was tested, the "split at forced breaks equals the whole" property, keying reuse on what is prepared instead of on source text, and the cache growth from streamed partial words. The re-architecture needs no third capability.

## 1. The prototypes

| | API | Reuses | Numbers | Why parked |
|---|---|---|---|---|
| Paragraph pattern (`incremental-pieces`) | None. A README recipe: prepare each `pre-wrap` line (keeping its `\n`) or each markdown block on its own, in a Map keyed by text | whole lines or blocks | 100k-char keystroke 0.4-0.6 ms against 16-17 (en); 10k stream 0.05-0.5 s against 2.0-16.5 | Not parked; recommended as docs only. It needed three engine fixes where a fact read across `\n` (#270-#272) |
| Chat block reuse (same branch) | `parseMarkdownBlocks(markdown, previous)`: re-lex the whole message per token, reuse blocks whose preparation inputs are equal | blocks | en 10k stream 457 ms against 2,122. One growing paragraph gains nothing (484 against 476). Lexing is then over half the cost | Optional demo change, never landed |
| Item reuse (`incremental-rich-memo`) | `prepareRichInline(items, previous?)` | each unchanged item's own preparation | 10-17x at 500 items | 2.3-4.1% slower and 9-11% more heap for callers who never pass `previous`; no workload above about 100 items; differed from fresh after a font load |
| Edit window (`incremental-prepare-edit`) | `{ editable: true }` + `prepareEdit(previous, text)`; finds the change itself | everything outside a window between "clean" spaces, verified by guard blocks | 12-41x on one long paragraph | p90 over its 1 ms bar in 7 of 8 rows at 100k, from whole-text copies, counts and an emoji scan; +2.47 kB gzip; 1.5x handle memory; separator rules coupled to every rule that reads across a space; a bug that 135k random edits missed; Japanese has no separators and falls back |
| Owner (`incremental-owner-prototype`) | `createIncrementalPreparer(font)` gives `{ replace, append, clear }` | analysis before the last safe space; redoes the whole suffix | 3.6x on an 18.2k stream, Chrome 152 | thin exactness evidence, no invalidation check, caller must `clear()` |

`incremental-pieces-nosimple` deleted main's fast line walker: `layout()` got 2x slower. Rejected.

#153's `prepareStream` + `appendPreparedText` was never built: appended text can change how the old tail breaks, it mutates held handles, and it covers fewer edits than a diff.

## 2. Use cases

A frame at 60 updates a second is 16.7 ms. The streaming message shares it with lexing and painting, so I also show a 2 ms share. Needed from-scratch cost is budget ÷ length:

| one unit laid out from scratch | whole frame | 2 ms share |
|---|---|---|
| 2k chars | 8.3 µs/char | 1 µs/char |
| 20k | 0.83 | 0.1 |
| 200k | 0.083 | 0.01 |

Reference points, µs/char: main's warm `prepare()` 0.11-0.24 (Japanese 1.2); the idempotent prototype's first sight about 0.32; the unhacked rebuild about 5; main's `layout()` alone 0.002-0.006.

- 2k: covered once the rebuild is 5x faster than today. The prototype already is.
- 20k: needs main's best English speed. Not reliable across scripts.
- 200k: needs the speed of line arithmetic alone. No from-scratch engine gets there.

But the unit isn't the message:

**Streaming append (chat, logs, transcripts).** Covered by the rebuild's direction if the app passes blocks, not messages, as the chat guide already says. Unchanged blocks hit the store at about 0.2 µs each, so 400 blocks (a 200k message) cost a few tenths of a millisecond, and only the growing block is a first sight. The 2k row is the real requirement: about 1 µs/char. The design still lacks two things: eviction for the word-width store, since tokens cut words and partial words pile up (main's heap grew from 1.5 to 9.7 MB over 800 edits of one growing word), and a painter that updates a row in place (DEMO-COVERAGE h), since the row repaints every token. Not covered: one growing paragraph above about 5k chars, such as a transcript without breaks. That needs prefix reuse inside prepare, which can come later, invisibly (section 4). After block reuse the lexer dominates; that's userland.

**Edits in the middle (textarea, editors).** `pre-wrap` splits at `\n`, so the answer is the same, provided each port keeps "split equals whole" true. A long `normal` paragraph is the same hole as above. Editors mostly need source offsets, caret x and hit testing: capability g, not incremental prepare.

**Rich inline item reuse.** Covered by speed. Chat paragraphs have too few items (block plus item reuse measured 0.98-1.05x), and no 500-item workload was found.

**Invalidation.** Every prototype with carried state had a stale-result bug. The idempotent call avoids that class, except for font loads: Pretext can't see them without DOM access, so the store needs one explicit "fonts changed" reset (capability i).

## 3. Ideas

**Keep regardless of perf**
- The bar and the method. An accelerated path must equal from-scratch output under a counting fake Canvas. The harness must fail on copies of the source with one check broken, and someone reads the diff. Random edits alone missed a real bug. The plan's checks 1 and 3 are this kind; a future store or fast path should get one too.
- "Split at forced breaks equals the whole" as an offline property test per port. On main it found three facts leaking across `\n`, and one fix corrected 3 Safari metrics. It's also what lets paragraph boundaries bound the work.
- Key reuse on what is prepared, not on source. A late markdown reference definition changes an earlier paragraph whose markdown didn't change. That's the idempotent store's key already. #313's "region-wide prepare" idea (one pass, reuse last frame's results, drop the unused) is the two-generation store, reached independently.
- No edit hints. Finding the changed range costs 4-6 µs at 100k.
- Line identity for DOM reuse needs nothing incremental. Lines carry `[start, end)` and tile the text, so a painter can key on the start offset.
- Unknowns that carry over: the real cost of setting `ctx.font` per paragraph (the fake Canvas hid it), and Chrome's history-dependent widths, so any path that asks fewer questions needs its own browser run.

**Only compensates for main's cost**
- `editable` + `prepareEdit`, clean separators and guard blocks. In the rebuild they'd be derived three times, once per port.
- `previous?` parameters and owner objects: carried state, against the stance.
- Append-only content as an input. A markdown stream isn't append-only once parsed (setext headings, a closing `**`, late references), and without handles there's nothing to append to.
- Line index, chunked storage, typed-array handles: they matter only if an edit window returns.

One reversal: main's open question "may results change in place?" goes away. Nobody holds a handle, so a store may extend its own entry when new content starts with the old, as long as nothing returned to the app points into it. Main rejected a hidden memo for pinning memory and thrashing when two texts alternate; the two-generation store answers both.

## 4. Constraint on the re-architecture

**No, a third capability isn't needed.**
- Resuming from the last unchanged line is already a composition. `fillLine(prepared, start, slot)` takes a `Start` that is small plain data (item index, offset, a few flags; WebKit adds the carried width), frozen in the row. An old line's `next`, or a `Start` made from an offset, works on a new paragraph whose earlier items are equal.
- It saves only filling the growing block's earlier lines again. Filling is the heavy stage in Chrome today (575 of 777 Canvas calls come after prepare), but at the 1 µs/char target a whole 2k block costs 2 ms, and the block boundary already bounds it.
- Which line is unchanged isn't knowable without the new text's break data. A growing URL or dictionary segmentation (one Thai edit moved boundaries 11 segments back) can move the previous line's end. WebKit's own partial layout restarts one line early for this reason (`InlineInvalidation.cpp:388-389`), and Blink reuses shape results around an edit behind safe-to-reuse checks (`inline_node.cc:1001`). Neither shows in output, so nothing to port.
- Prefix reuse in prepare, if profiling ever asks for it, fits behind the idempotent call with no API. It belongs in the plan's section 10.

Two properties to keep true, both already implied by the plan: `Start` stays plain data that doesn't depend on the prepared object, and nothing handed to the app aliases prepared data. One cheap ask for X3 owners: list the prepared facts that read across a forced break or the whole text. (Answered on 2026-09-19; the appendix has the list.)

## Limits of this reading

- All prototype numbers are quoted from issue #313, not re-measured. They were timed on Node or Bun with a fake Canvas on V8. Only the owner prototype was timed in a browser (Chrome 152). No harness on the branches was run.
- The per-character reference points for the rebuild are rough divisions of numbers in IDEMPOTENT-API.md and DEMO-COVERAGE.md. About 0.32 µs/char comes from 40 µs per 126-char message. About 5 µs/char comes from 6.9 s per 10,000 messages and from 75 ms per 15,000 units. Those sources describe themselves as busy-machine or background-window measurements.
- The 2 ms per-frame share for the streaming message and the 'about 5k chars' limit for one growing paragraph are my assumptions, not measured thresholds. The claim that chat paragraphs rarely pass 2k characters is also an assumption.
- The pointers to WebKit's InlineInvalidation.cpp:388-389 and Blink's inline_node.cc:1001 (SetTextWithOffset) were checked by grep in the pinned sources under ~/github/browser-engines. I did not read them in depth. Gecko's line-dirty path was not checked and is not cited.
- That 'split at forced breaks equals the whole' holds in the three rebuild ports follows from browser semantics. It was not tested here.
- All five incremental branches conflict with current main, per #313. I only read them with git diff, git show and git log; nothing was checked out. I wrote only intermediate files under <scratch>/incr (the saved issue text and the draft used for word counting). `gh issue view 313 --comments` printed nothing in plain mode, so I fetched the issue with --json instead.
- Word count is 1,499 by `wc -w`, which counts table pipes and markdown markers as words; about 1,425 without them.

## Appendix, 2026-09-19: the prepared facts that read across a forced break or over the whole text

Section 4 asked the X3 owners for this list. It is theirs, from their X3 reports (the X3 sections of
specs/blink-RESULTS.md, specs/webkit-RESULTS.md and specs/gecko-RESULTS.md), reconciled into one table; the names were
checked against the tree at the X3 merge. It is a reading of the ports, not a test: "split at forced breaks equals the
whole" is still untested in the rebuild. A forced break here is a preserved newline or a `<br>`. "Whole text" means the
fact is decided once over the paragraph, so content anywhere changes it; "across" means the fact is local but its
reading reaches over a forced break.

| Fact | Engine | Reads | Why |
|---|---|---|---|
| `bidiEnabled` | Blink | whole text | Any RTL character anywhere, or an RTL block, turns bidi on for the paragraph. |
| `is8Bit` | Blink | whole text | The paragraph's text is 8-bit only while every unit is. |
| `segmented` | Blink | whole text | It follows `is8Bit` and `bidiEnabled`. With the three go the partition of the paragraph's Canvas contexts and how `canvasString` spells every range. |
| `scripts` | Blink | across | `ScriptRunIterator`'s runs cross a forced break: a Common or Inherited character after the break takes the run before it, and bracket pairs reach across. Checked: digits after LF following Hebrew take Hebrew; alone they are Common. |
| A span's `shouldCreateBoxFragment` and `run` | Blink | across | They read the span's whole content. |
| `hanKerningCandidates` | Blink | whole text, as prefix counts | Appended text leaves earlier entries as they are. |
| Word spacing at text_content index 0 | Blink | whole text | The exception for a separator at index 0 counts the index in the whole text, not from the last forced break. |
| `inspect.gaps` (inspected only) | Blink | whole text | The conditions per style range over every item of a style. |
| The browser's dictionary segmentation, at fill time | Blink | across | It is asked over the text from the line start to the paragraph's end. ICU boundaries restart at the line start and read nothing before it. |
| The builder choice (`WebKitPrepared.builder`) | WebKit | whole text | It reads the whole tree and item list, the block's style and whether the paragraph reorders. |
| Whether the paragraph reorders (`content.ts`, prepare's `reordering`) | WebKit | whole text | Any 16-bit box with a strong RTL character, or any RTL span, sets it. It turns bidi on, defers every stored width until after the bidi splits, and leaves every `spaceWidth` null. |
| Bidi levels and the item splits they cause | WebKit | whole text | `ubidi_setPara` runs over the whole paragraph text, and its direction flags are the whole text's. A paragraph between forced breaks without RTL characters resolves otherwise once another one holds an RTL character (held-out `c-7cc5e3e26ff7c30d`). Inline box items take their levels from neighbouring content, across `<br>` too. |
| A box's `is8Bit`, `simpleFontCodePath`, `simplifiedMeasuring` with its coverage test, deferred white-space widths (a TAB anywhere in the node) and `spaceWidth` | WebKit | across | They are per text node, and a preserved newline doesn't end a node. |
| `BreakablePositions`' prior context | WebKit | across | A scan reads the two code units before its start. After a preserved newline these are the newline and the unit before it. |
| Whether a white-space-only node gets a renderer | WebKit | across | It depends on the previous sibling's renderer, a `<br>` among them. |
| Source offsets (`runStarts`, an element item's `sourceOffset`) | WebKit | whole text, as prefix sums | Appended content changes no earlier entry. |
| The paragraph's contexts | WebKit | whole text | One context per distinct settings over all boxes. |
| A box's history worlds and its box facts (inspected only) | WebKit | across | They are per box, so per text node. |
| `GeckoLeaf.is8bit` | Gecko | across | It reads the whole node, preserved newlines included. It decides the 8-bit `IsTrimmableSpace` path, whether `TransformText` discards bidi controls, `IsBoundarySpace`'s cluster-extender test and the text run's 8-bit flag. |
| The white-space-only boundary node rule | Gecko | whole text | It reads the whole node, and whether the node is the block's first or last child. Appended content changes which node is last. |
| `GeckoPrepared.bidi` (prepare's `resolveBidi`) | Gecko | whole text | True where the block is RTL or any 16-bit node anywhere holds an RTL code unit. One character turns on level resolution, frame splits and line reordering for the whole paragraph, and turns off the `page-history` gap for left-to-right controls. The levels themselves stop at forced breaks: each preserved line and each `<br>` is its own bidi paragraph, and span continuations split only inside one. |
| A text run's facts: `context`, the `is8bit` AND, `scriptRuns`, `hasShy`, `hasTab`, `hyphenAu`, `minTabAdvance`, `BREAK_SKIP_SETTING_NO_BREAKS`, `trailingBreak` | Gecko | across | A text run continues across a preserved newline inside one node; only a frame that ends in a newline, a `<br>`, an atomic inline, a `<wbr>` or a style difference ends a run. `context` reads the first flow's font, language and letter-spacing flag; the itemizer merges Common characters and pairs brackets across a newline, and an 8-bit run's `hasLetter` is over the whole run; the rest are whole-run guards and flags, and `trailingBreak` is a fact of the run's end. |
| `rangeAu`'s script context character and font-matching prefix | Gecko | across | The script context comes from `scriptRuns`, so it can come from the other side of a forced break. The font-matching prefix is the script run's text before a piece that starts with a cluster extender or U+202F right after an invalid character. A newline is an invalid character, so that text can be the line before it. |
| Prefix sums: `unit.startAdvance`, `run.totalAdvance`, `spacingPrefix`, `scanSpacingPrefix`, `tabs.spacingPrefix`, `correctionPrefix` | Gecko | whole text, as prefix sums | The first two run from the text run's start, the others over the whole transformed text. Only differences are read, and appending never changes earlier entries. |
| `nsLineBreaker`'s current word | Gecko | across | It runs across spans and text runs until a `<br>`, an atomic inline, a `<wbr>` or the block's end. In an 8-bit node it also runs across a preserved newline, because only 16-bit text ends a word at LF. The break iterator is then handed text from both sides; UAX #14 restarts at the LF, so no opportunity moves. |
| `tabs.unit`; `contexts` | Gecko | whole text | The block's space, measured only when any text run anywhere has a tab; one list of contexts for the paragraph. |
| `dictionaryBreaks`, `replacementCharacters`, `figureSpaces` (inspected only) | Gecko | whole text, for local facts | Each scans the whole text and reports per place. The space-in-shaping windows run over the units of a run and end at invalid characters, so at newlines. |
| `isFirstLine` (text-indent), at line time | Gecko | across | It is not prepared: it lives in the plain line start. |

What the owners found to stop at a forced break:

- Blink: shaping groups and everything measured per group; `graphemeStarts`, `continuations`, `ligature`, `fontRun` and
  `priorities`; bidi levels (checked on samples: the levels after LF equal the tail laid out alone, in both directions).
- WebKit: nothing beyond the rows above was listed as checked.
- Gecko: units (a newline or a tab is an invalid unit); `unit.inWord`, except through the script context and the
  font-matching prefix above; glyph flags; the emergency break after a hyphen; the white-space collapsing carry, which a preserved LF and a `<br>` reset;
  the spacing rules, whose base search stops at the frame's start; the boundary space after a word ending in U+200D,
  which reads the adjacent unit.

The two properties section 4 asked to keep, as the owners left them at X3:

- *A line start is plain data* in all three ports, independent of the prepared object. Gecko's is
  `{ engine, frame, contentOffset, isFirstLine }`, and one made from a source offset `s` names the item of the frame
  holding `s` (`types.ts` `holderOfSource`; `GeckoFrame.item` is kept for this and has no other reader). WebKit's can
  be made from a source offset too, but a start at a non-zero offset still needs its `previousLine` record, as before.
- *Nothing handed to the application aliases prepared data*, with one exception found while these documents were
  written. Pieces, geometry and a line's gaps are made per call in all three ports, and Blink's and WebKit's
  `paragraphGaps` hand out copies of the entries since X3. Gecko's returns the prepared list, and `src/index.ts` puts
  the build gap in front of it with `concat`: the list is fresh, and its entries are still the prepared paragraph's
  objects. A decided line is the engine's own record and is only valid with its prepared paragraph.
