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

Two properties to keep true, both already implied by the plan: `Start` stays plain data that doesn't depend on the prepared object, and nothing handed to the app aliases prepared data. One cheap ask for X3 owners: list the prepared facts that read across a forced break or the whole text.

## Limits of this reading

- All prototype numbers are quoted from issue #313, not re-measured. They were timed on Node or Bun with a fake Canvas on V8. Only the owner prototype was timed in a browser (Chrome 152). No harness on the branches was run.
- The per-character reference points for the rebuild are rough divisions of numbers in IDEMPOTENT-API.md and DEMO-COVERAGE.md. About 0.32 µs/char comes from 40 µs per 126-char message. About 5 µs/char comes from 6.9 s per 10,000 messages and from 75 ms per 15,000 units. Those sources describe themselves as busy-machine or background-window measurements.
- The 2 ms per-frame share for the streaming message and the 'about 5k chars' limit for one growing paragraph are my assumptions, not measured thresholds. The claim that chat paragraphs rarely pass 2k characters is also an assumption.
- The pointers to WebKit's InlineInvalidation.cpp:388-389 and Blink's inline_node.cc:1001 (SetTextWithOffset) were checked by grep in the pinned sources under ~/github/browser-engines. I did not read them in depth. Gecko's line-dirty path was not checked and is not cited.
- That 'split at forced breaks equals the whole' holds in the three rebuild ports follows from browser semantics. It was not tested here.
- All five incremental branches conflict with current main, per #313. I only read them with git diff, git show and git log; nothing was checked out. I wrote only intermediate files under <scratch>/incr (the saved issue text and the draft used for word counting). `gh issue view 313 --comments` printed nothing in plain mode, so I fetched the issue with --json instead.
- Word count is 1,499 by `wc -w`, which counts table pipes and markdown markers as words; about 1,425 without them.
