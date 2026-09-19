# WebKit port results (Safari 27.0, WebKit 7625.1.29.11.27)

Lab runs of `rebuild/src/engines/webkit` in `webkit-host`, the system WebKit.framework that installed Safari 27.0 runs
(CFBundleVersion 22625.1.29.11.27, macOS 27, libicucore 78.1), on this Mac (Retina, `devicePixelRatio` 2). Rows,
summaries and per-case files are under `.artifacts/lab/webkit-round4b/` and `.artifacts/lab/fresh/webkit-host/r4b-webkit-*`
for round 4b, `.artifacts/lab/webkit-round4/` and `.artifacts/lab/fresh/webkit-host/r4-webkit-*` for round 4, `.artifacts/lab/webkit-round3/` and `.artifacts/lab/fresh/webkit-host/` for ceiling round 3,
`.artifacts/lab/webkit-round2/<run>/` for round 2 and `.artifacts/lab/webkit-stage5/<run>/` before it. Installed Safari ran
once in round 3, as a spot check.

## 2026-09-19: correctness round 5 (main's true passes)

research/MAIN-FACTS-ANALYSIS.md traced the cases main passes and the port fails to WebKit's source. What landed from it,
one fix a commit; the prototypes it names (branch `x-mainfacts-webkit`) were made before X3 and were ported by meaning.

- **The font code path is the measured string's** (a ported rule; `measure.ts` "The font code path"). FontCascade::width
  chooses the simple or the complex path from the TextRun it is handed (FontCascade.cpp:304-309, :708-730), TextUtil::width
  hands it the measured range alone (TextUtil.cpp:84-89), and Canvas measures through the same function. `mergedGlyphs`
  asked the box, so a box with a combining mark or an Arabic letter anywhere separated no ligature pair: `ffi` after
  U+2060 U+0301 kept its ligature at -4px of letter spacing, about 8px too wide (suite `c-19d718b564ee2744`, 9 lines for the
  DOM's 4). It now asks the string. `isComplexCodePath` moved from `content.ts` to `measure.ts` for it. The box's path stays
  what WebKit reads the box's for: simplified measuring, breakWord, firstUserPerceivedCharacterLength and the runs shaped
  across inline boxes. Cost: nothing without letter spacing, and nothing in a simple path box; in a letter-spaced complex
  path box, a measured string that holds no complex path character and has a merged pair asks the separated string's two
  totals (the count context and the plain one) and measures the separated string where it measured the unseparated one.
  Tier 1: 2 of 63,987 cases ask a question the record lacks in each configuration (`c-1d3594196ff8bfae`,
  `c-65b6a6b017410209`, both `heldout-suite-sample`), every other case is the same, 0 predictions changed.

- **`control-character-width` reads the measured string's path too** (the same ported rule, in `gaps.ts`; no line moves).
  The condition asked the box: in a complex path box VT and FF always reported, with the complex text controller's prose,
  and a CR never did. A string of such a box without a complex path character is WidthIterator's, in the DOM and in
  Canvas, so it now reports as in a simple path box: nothing where Canvas shows no pair adjustment around the control,
  and always for a CR followed by more of the string. Tier 1, both configurations: 154 cases change, in their gaps alone
  (94 lines lose the gap, 58 keep it only through the whole item a carried width comes from, 1 line gains it for a CR,
  1 line's first gap becomes the `page-history` that followed it); 148 of them pass every metric with exact values, 1
  passes with widths unobserved, 5 are history-dependent. It costs the plain path nothing: a plain paragraph computes no
  gap.
- **A box's space is a number measured as the box is made** (`WebKitBox.spaceWidth`, content.ts makeBox; X2's open item).
  It was set where handleTextContent measures it and null for boxes whose white space is deferred (a reordered paragraph,
  or preserved white space with a TAB), which then asked Canvas at every read: the space a text item is measured with,
  and every white-space item, about three questions a word. Now every box asks `W(' ')` in its context once, after
  makeBox's own questions, and nothing asks it again. A box that isn't deferred asks what it asked (handleTextContent
  measured the space whether or not the box holds one); a deferred box that never read its space asks one question it
  didn't. No width changes: the same string in the same context. The first ask moves, so tier 1 can't call it: without
  facts 34,363 cases are the same, 22,604 ask the same or fewer questions in another order with the same prediction
  (9,174 repeats only, 13,430 other questions), 7,020 ask a space the record lacks, 0 predictions changed (with facts
  34,363, 22,580 and 7,044). On the 56,967 headline cases that replay, the plain path asks 2,117,070 questions where it
  asked 2,295,968 (37.16 a paragraph for 40.30).

## 2026-09-19: re-architecture X3 (the model clean-up)

research/ARCHITECTURE-PLAN-2.md §8 step 2, X3. No rule, citation, gap condition, merge rule, probe order or measured string
moved, and no Canvas question: every case of both configurations asks what it asked, in the order it asked it, on the lab's
path and on the plain path. Runs and scratch tools are under `.artifacts/tests/runs/ra-x3-webkit/`.

- **A line's runs are a tagged union** (`types.ts` `LineRun`): a text run, a soft line break, an element's run with the
  source offset of its item, and a line-spanning inline box start. The `box: -1` and `element: -1` sentinels and the text
  fields every run carried are gone. A run's trailing white space is a record or null (WebKit's own
  `Line::Run::TrailingWhitespace`), and so is a line's trimmable content, where four fields ran in parallel; the two copies
  of `Line::Run::detachTrailingWhitespace` are one function. The aligner works on the runs (`expansion.ts`), where it copied
  them into a stringly typed shape and back.
- **The content breaker's result is a union on its action**: only `break` carries partial trailing content. The three
  `hyphenWidth` fields that were always null (they come with `hyphens: auto`) and their four dead branches are gone, with
  `Content.isTextOnlyContent` and `hasTrailingSoftHyphen`, `Builder.isFirstFormattedLine`, `WebKitPrepared.paragraph` and
  `runTexts`, `WebKitBox.hasStrongDirectionality` (a local of prepare), `firstNamedGeneric` (gaps alone read it) and
  `wordSpacing` (the box's style holds the same number), `expansionShares` (no caller; the observation port has its own) and
  `dictionaryRangeStartsWithMark`.
- **Imports run one way**: types, data and breaks, measure, gaps, then items and lines, output, history, content, index
  (content prepares the history worlds, so it imports `history.ts`; corrected 2026-09-19, this line had content before them).
  `gaps.ts` keeps every condition, its prose and its merge rule and imports neither the fill nor the content stage; the item
  builder is `items.ts`; the break position cache's history worlds, and a decided line laid out in them, are `history.ts`,
  which raises `page-history` through `gaps.ts`; `index.ts` composes `inspectLine` from the two. The plan's §6 put the worlds
  in `gaps.ts`, which is what made `lines.ts` and `gaps.ts` import each other.
- **A box's inspection record is made in one step**, from makeBox's own parsed family list (`fonts.ts` `familyNames`, parsed
  once per box, where the list was split and parsed again at seven sites). Its three Canvas contexts are made as the box is made, before the
  paragraph's items are measured; a context asks nothing when it is made, and tier 2 in both orders says the order doesn't
  show.
- **Structural fixes with identical results** (plan §3, §6): the last-line scan stops at the first contentful item;
  `isDelimiterQuote` reads a list derived once when the module loads; an element's item carries its source offset, so a
  line's start and end and an element's fragment no longer scan the item list (`elementOffsetOnLine` scanned every item for
  every element run of every line, on the plain path too); a fragment's text leaf is found by binary search; the builder
  choice names `inline-boxes-only`, which `fillLine` tested with a scan of every item on every line; a display box's word
  spacing travels with its tree node, where `boxOfRun` searched the boxes.
- **`measure.ts` lost its gap-only switch**: `boxWidth`'s `fixedPitchShortcut` parameter existed for test T1 alone;
  `gaps.ts` now holds the advances against the shortcut's total itself (`advancesWidth`, `lessMeasuredSpace`).
- **Map and Set**: the two `Set<string>` of `collectHistoryWorlds` are comparisons of number lists, its set of item ends an
  array by offset, `nearestCommonAncestor` a walk, the open inline boxes of a line's display boxes a stack. What stays: the
  code points makeBox's coverage test has asked (unbounded), `CJK_SYMBOLS` (fixed data), and the membership sets of the
  bidi display box tree, which are local to one line's inspection.
- **Nothing handed out is the prepared paragraph's**: `paragraphGaps` returns copies. A line start was already plain data.

Not built, on purpose: a text item that keeps what measuring found beside its width (the merged-glyph record, the raw
total), which would end 1.5 M of the lab path's repeats without facts. `measure.ts` knows nothing of inspection today, and
the hand-over would put an inspected-only branch into every measuring call for a gain the lab alone sees. Where it would
go is narrow: stored widths are written at two sites (`items.ts` `handleTextContent` and `computeItemWidths`) and read at
one (`lines.ts` `measuredItemWidth`), so a record per item, or one shared by items of equal text in a box's context, hangs
there without touching `measure.ts`.

WebKit's merge rules and the order of raises (the Blink owner's X2 finding): two of the six rules, overlap with extension
(`rtl-shaping-across-inline-boxes`, and `lineGaps`' own), merge a new range into the first entry it overlaps and never two
entries with each other, so how ranges are grouped could follow the order of raises while what they cover together
couldn't. A line's raises come in one order here (its items in line order, each item's conditions in a fixed sequence, the
fill's before them), this step moved none, and tier 1 compares the lists byte for byte. Nothing changed.

Prepared facts that read across a forced break or over the whole text (research/INCREMENTAL-API-READING.md §4):

- the builder choice: the whole tree and item list (any span, atomic inline or `<wbr>`; the block's style; reordering);
- `reordering` (any 16-bit box with a strong RTL character, any RTL span): it turns bidi on, defers every stored width to
  after the splits and leaves every box's `spaceWidth` null;
- bidi levels and the item splits they cause: `ubidi_setPara` runs over the whole paragraph text, and its direction flags
  are the whole text's, so a forced-break paragraph without RTL characters resolves otherwise once another one holds one
  (held-out `c-7cc5e3e26ff7c30d`); inline box items take their levels from neighbouring content, across a `<br>` too;
- per text node, which a preserved newline doesn't end: `is8Bit`, `simpleFontCodePath`, `simplifiedMeasuring` with its
  coverage test, whether white-space widths are deferred (a TAB anywhere in the node) and `spaceWidth` with it;
- break opportunities inside a node: BreakablePositions reads the two code units before a scan's start, which after a
  preserved newline are the newline and the unit before it;
- whether a white-space-only text node gets a renderer: the previous sibling's renderer, a `<br>` among them;
- source offsets (`runStarts`, an element item's `sourceOffset`), sums over the text before;
- the paragraph's Canvas contexts, one per distinct settings over all boxes;
- inspected only: a box's history worlds (its whole text and items) and its box facts (any character of the node).

Gates, webkit-host, 63,987 cases a configuration:

- Tier 0: tsc clean for six projects; `bun test rebuild` 811 pass.
- Tier 1: exit 0, read directly: all six references the same, 0 predictions changed, 0 questions changed. A differential
  of the function set against the start commit's (`tools/diff-set.ts`: every fill, pieces with `overflows` and the paint
  facts, inspection, paragraph gaps, contexts made and the question sequence, on an inspected and on a plain paragraph):
  0 of 63,987 differ in either configuration, after every move.
- `function-set.ts plain`, `pure`, `sweep`: exit 0 in both configurations; the plain path asks 2,516,180 questions for
  1,672,597 distinct without facts and 1,385,178 for 792,164 with, and first asks in another order in 1,174 and 1,218
  cases, all as X2 left them. Citations: 0 lost, 2 accepted by name (`boxOfRun`'s throw; four copies of the atomic
  narrowing throw, now `atomicElement`). Painter differential: 63,987 of 63,987 byte-equal in both configurations. knip:
  nothing in the port but the test paragraphs. No import cycle in the folder, types included.
- Tier 2, both orders, both configurations: exit 0 twice, 0 status transitions, 0 cases less exact, differing predicted
  values 0 -> 0, rect counts 197 -> 197, gate lost 0, one library bundle a run (`a8aa415c604c…` without facts,
  `8c7fae70e8eb…` with; the comment edits after the runs leave both hashes as they were).
- The plain predictor over every set (63,987 rows, forward) against the usual run's forward rows: 0 line ranges differ; 3
  native observations differ, `c-1ca0bab9ded7a4c6`, `c-53283654e67b8035` and `c-7cc5e3e26ff7c30d`, the three of X2, all
  history-dependent in every metric in the reference ledger.
- Giants under the exclusive lock: 9 of 9 predictions, native observations and painted lines equal to step 0's frozen rows
  (`compare-rows.ts --prediction=without-measure`); 731,516 Canvas calls, as in X2.
- Time. Other owners' jobs held the machine at a load average of 40 to 68 throughout, so wall times say little and the rows'
  own timings are what compares. Giants under the exclusive lock, the start commit and this one back to back: the library's
  prediction 3.41 s and 2.22 s (X2's run 4.29 s; step 0, with the memo, 2.72 s), native observation 252 s and 347 s, wall
  487 s and 659 s: the native side, which this step doesn't touch, went the other way and carries the wall time. A forward
  tier 2 of each, back to back: the rows' prediction time 32.2 s and 21.4 s, native 107.9 s and 100.7 s; browser jobs 356 s
  and 504 s, the difference being the first three jobs' wait for a slot. Offline, the library's JavaScript alone over the
  recorded cases under replay, the two trees interleaved case by case (`tools/time-set.ts`): the plain path takes 95% of
  the start commit's time without facts and 97% with, the lab's path 81% and 77%.

Canvas questions a paragraph didn't move: the lab's path 88.79 asked for 31.81 distinct without facts and 59.86 for 19.18
with; the plain path 39.32 for 26.14 and 21.65 for 12.38.

Lines, non-test and non-generated: 6,132 to 6,074.

| File | Start | X3 |
|---|---:|---:|
| lines.ts | 2,109 | 1,982 |
| gaps.ts | 844 | 430 |
| history.ts | | 414 |
| content.ts | 690 | 451 |
| items.ts | | 253 |
| output.ts | 536 | 529 |
| measure.ts | 447 | 441 |
| types.ts | 218 | 303 |
| expansion.ts | 190 | 150 |
| breaks.ts, data.ts, fonts.ts, index.ts | 422, 226, 68, 36 | 417, 236, 79, 43 |
| style.ts, joining.ts, geometry.ts, paint-rules.ts, checks.ts, test-paragraph.ts | 92, 51, 91, 56, 15, 41 | unchanged |

### Open

- `firstUserPerceivedCharacterLength` takes the grapheme boundaries of the whole box for one emergency break on the complex
  path, and `endsWithSoftWrapOpportunity` and `mayBreakInBetween` make a break factory per call, whose first ICU query walks
  the whole box. Both are per line and O(box); a structure that outlives the call would end them, which waits for
  profiling (plan §10).
- `nbspBreaks` is a constant false through four functions of `breaks.ts` (`-webkit-nbsp-mode: space` isn't in the model);
  it stays with the verbatim port of BreakablePositions.
- `WebKitBox.spaceWidth` is still null for deferred boxes (X2, "Open").

## 2026-09-19: re-architecture X2 (the memo goes)

research/ARCHITECTURE-PLAN-2.md §8 step 2, X2. No rule, citation, gap condition, merge rule, probe order or measured string
moved: every case asks the questions it asked, first in the order it asked them, and some of them again. Runs are under
`.artifacts/tests/runs/ra-x2-webkit/`.

- **Every read asks Canvas.** The port no longer imports the memoized API, context indices or the call log. A box holds the
  four contexts it measures in (`context`, `plainContext`, `spacedContext`, `countContext`), the box facts of an inspected
  paragraph hold theirs (`localeChoosesFonts`, the coverage test's LastResort), and the prepared paragraph keeps the list
  they were found in (`contexts`, which a world shares). No function takes a measurer; `measure.ts` lost the unused prepared
  paragraph of `boxWidth`, `tabbedWidth` and `fixedPitchWidth` with it. `collectShapeRanges` compares FontCascades by
  context and word spacing, where it multiplied a context index.
- **A value needed twice in one scope is a local**: a letter-spaced string's total in the count context, which says whether
  the string can be counted and then counts it (`mergedGlyphs`); the letter before a control (`controlIsAdjusted`); the
  hyphen's total, which `lineHyphenWidth` measures once and hands to `hyphen-glyph`'s test, so `hyphenGlyphsDiffer` and
  `measure.ts` hyphenWidth are gone; and makeBox's coverage test asks each code point of the text once, where it first
  stands (a `Set` of code points local to the test; `coveredLikeLastResort` lost its own duplicate test).
- **A value prepare already measures is a field set there**: `WebKitBox.spaceWidth`, the space handleTextContent measures
  for the box's white-space items, which `singleSpaceWidth` reads. It is null where the box's white space is deferred (the
  paragraph is reordered, or preserved white space holds a TAB) and the space is first asked later: those boxes ask at
  every read, because measuring the space as the box is made would ask it earlier than the rows do (plan §10).
- **Nothing of the fill's is handed to `lineGaps`**, against the plan's §6. Of the 2.44 M questions a line's own inspection
  asks again without facts, 1.69 M were first asked by prepare (stored item widths and their glyph counts), 0.74 M by
  inspection itself (single code points, for `canvas-language` and `simplified-measuring`) and 15 thousand by the fill
  (`tools/lab-stages.ts` under the runs folder reads the stage of every first ask from the call stack). What inspection
  re-derives is what prepare derived while it measured a stored width, and handing that over means text items that carry
  their measured range and merged-glyph record: X3's item model, or the per-cluster tables of plan §10.

Gates, webkit-host, 63,987 cases a configuration:

- Tier 0: tsc clean for six projects; `bun test rebuild` 809 pass (805 at the start of the step; 4 new, of the questions a
  paragraph asks).
- Tier 1: exit 3. Every changed case is repeats only (58,144 without facts, 56,498 with), 0 dropped only, 0 other
  questions, 0 new questions, 0 predictions changed. Chrome's and Firefox's four references: exit 0.
- `function-set.ts plain`, `pure`, `sweep`: exit 0 in both configurations; the plain path's first asks come in another
  order than the lab's in 1,174 and 1,218 cases, the counts X1 left. Citations: 0 lost. Painter differential: 63,987 of
  63,987 byte-equal in both configurations. No string-keyed Map in the port; two `Set<string>` stay in
  `collectHistoryWorlds` (item-end lists as keys, local to the call; nothing measured), which are X3's.
- Tier 2, both orders, both configurations: exit 0 twice, 0 status transitions, 0 cases less exact, differing predicted
  values 0 -> 0, rect counts 197 -> 197, gate lost 0, one library bundle a run.
- The plain predictor over every set (63,987 rows, forward) against the usual run's forward rows: 0 line ranges differ; 3
  native observations differ, `rich-prewrap/trailing-spaces` `c-1ca0bab9ded7a4c6` and `c-53283654e67b8035` as in X1, and
  `suite/rejected-control` `c-7cc5e3e26ff7c30d` of the held-out sample, all three history-dependent in every metric in the
  reference ledger.
- The tripwire (plan §8: tier 2's wall time and the giants within 2x step 0's), measured beside other owners' jobs, so
  upper bounds. Tier 2: 263 s and 302 s of browser jobs for both orders (step 0: 99 s forward, alone; X1: 141 s forward,
  beside others); the rows' prediction time of the forward order sums to 18.9 s without facts and 16.6 s with (step 0 10.4 s;
  X1 14.1 s and 12.0 s), while the same rows' native time went 49.9 s, 69.0 s and 70.7 s. Giants, without the exclusive
  lock: 472 s against 325 s, the library's prediction 4.29 s against 2.72 s (native 231 s against 172 s) from 731,516
  Canvas calls against 111,489: a repeated call costs about 2.5 µs here.

Canvas questions a paragraph, asked (distinct), and the ask ratio:

| | with the memo | the memo switched off, nothing else | X2 |
|---|---:|---:|---:|
| the lab's path, without facts | 31.81 (31.81) 1.00 | 98.90 (31.81) 3.11 | 88.79 (31.81) 2.79 |
| the lab's path, with the lab's facts | 19.18 (19.18) 1.00 | 68.76 (19.18) 3.59 | 59.86 (19.18) 3.12 |
| the plain path, without facts | 26.14 (26.14) 1.00 | 46.33 (26.14) 1.77 | 39.32 (26.14) 1.50 |
| the plain path, with the lab's facts | 12.38 (12.38) 1.00 | 28.20 (12.38) 2.28 | 21.65 (12.38) 1.75 |

Without facts the font checks ask 11.7 of those a paragraph, none of them twice (their own list of asked questions, which
WebKit doesn't need: a question asked again gives the same bits).

What is still asked again, in thousands of questions over the 63,987 cases, without facts / with them. Each repeated
question is in one row, by its call stack and text under replay (`tools/classes.ts` under the runs folder; the totals are
`replay.ts check`'s and `function-set.ts plain`'s, 3,646 / 2,603 on the lab's path and 844 / 593 on the plain path):

| Asked again by | the lab's path | the plain path | What would end it |
|---|---:|---:|---|
| `mergedGlyphs` under `itemGaps`: a letter-spaced item's glyph counts, which prepare counted | 1,505 / 160 | none | items that keep their merged-glyph record; per-cluster tables (plan §10) |
| single code points for `simplified-measuring`, per occurrence | 445 / 911 | none | a table per box and code point (plan §10) |
| `familyDraws`, a character under two font lists, per occurrence (`canvas-language`) | 427 / 427 | none | the same |
| a history world's line: its fill and its discarded gap work (`pageHistoryGaps`) | 306 / 336 | none | dropping the discarded work (plan §10) |
| `mergedGlyphs` while measuring: a cluster's count at every occurrence of the letter, in prepare and in `breakWord`'s prefixes | 288 / 37 | 287 / 37 | per-cluster tables (plan §10) |
| the space of the box's context: boxes whose white space is deferred, and boxes that share a context | 228 / 228 | 228 / 228 | the space measured as the box is made, which moves its first ask (plan §10) |
| the same word measured again by prepare; the same prefix or character again by the fill | 207 + 64 / 207 + 65 | 207 + 60 / 207 + 60 | a bounded store of strings (plan §10) |
| `simplified-measuring`'s total of an item, which prepare measured | 58 / 137 | none | items that keep their raw total |
| the item widths of the history worlds | 41 / 21 | none | — |
| makeBox: a code point or the space again in another box of the same font | 27 / 27 | 20 / 20 | — |
| the space of the plain context (fixed pitch, tab stops) and the hyphen per soft hyphen read | 23 + 18 / 23 + 18 | 23 + 18 / 23 + 18 | box constants (plan §10) |
| controls, test T1 | 10 / 8 | 1 / 1 | — |

### Open

- `WebKitBox.spaceWidth` is null for deferred boxes only because no step of this phase may move a first ask. Eight of the
  nine giants are reordered Arabic, so deferred: they ask about three questions a word (the word with the space after it,
  that space, and the white-space item's space), where the memo left one per distinct word.
- A relayout at another width asks Canvas for nothing a stored width answers, as before. What it asks each time: the
  hyphen per soft hyphen it reads, `breakWord`'s prefixes, preserved white space with a TAB, and runs shaped across boxes.
- `gaps.ts`, `lines.ts` and `content.ts` still import each other's functions (X1).

## 2026-09-18: re-architecture X1 (gaps get their home; plain and inspected paragraphs)

research/ARCHITECTURE-PLAN-2.md §8 step 2, X1. No rule, citation, gap condition, merge rule or probe order moved; what
moved is where they live. Runs and the scratch verifiers are under `.artifacts/tests/runs/ra-x1-webkit/`.

- **The decided line** (`lines.ts`). `fillLine` runs the line builder and returns where the line breaks (`start`, `end`,
  `next`, `hasLineBox`) with the engine's record of it: the closed `Line::Run` list, the start and the slot it was filled
  from and in, the builder that filled it, the line rect, the last-line flag, `measuredEnd`, and on an inspected paragraph
  the gaps the filling raised, in order. It builds no fragment and no display box. `linePieces` and `lineGeometry`
  (`output.ts`) and `lineGaps` (`gaps.ts`) read it and write nothing; the display boxes of a reordered line without content
  no longer switch a flag of the line off and on. `webkitNextLine` and the function-set wrapper over it are gone.
- **`gaps.ts`** holds every gap: the four conditions a break decision itself shows, raised into the fill's `GapSink`
  (`hyphen-glyph`, the 8-bit emergency break's `string-storage`, `dictionary-breaks-stand-in` between boxes,
  `rtl-shaping-across-inline-boxes`), `lineGaps` with its item conditions, `page-history` with the history worlds and their
  building, the box facts only gaps read, LastResort measured beside makeBox's coverage test, and the tests that exist for a
  gap alone (`hyphenGlyphsDiffer`, `controlsMeasureExactly`, `fixedPitchShortcutWidth`, `familyDraws`,
  `hasLanguageDependentFallback`). The six merge rules are ported one by one, each named at its site. A world's line is
  filled and inspected by the functions that fill and inspect the paragraph's own, its gap work included, as before.
- **`prepared.inspect`** is a record or null: the paragraph's gaps, per box the facts only gaps read (`monospaceUnknown`,
  `hyphenUnknown`, `unverifiedCoverage`, `primaryFamilyUnknown`, `pairKerningUnknown`, `localeChoosesFonts` with its three
  contexts, `hanLocaleUnknown`, `quoteLocaleUnknown`, `dictionaryRangesStartingWithMark`), and the history worlds. A plain
  paragraph has none of it, a null `GapSink`, and makes none of the contexts that serve a gap alone.
- **Dropped:** `reverted`, `decisionStart` and `overflowStart` of the fill state, which round 2's narrowing read and nothing
  has read since round 3's worlds replaced it.

Gates, webkit-host, 63,987 cases a configuration:

- Tier 1: exit 0 in both configurations, every prediction and every question the same, in order.
- The function set against the start commit's (`tools/diff-set.ts`, under replay): every fill result, every line's pieces
  with `overflows` and the paint facts, every inspection, the paragraph's gaps and the inspected path's questions in order,
  and the plain paragraph's fills and pieces: 0 of 63,987 cases differ, either configuration.
- `function-set.ts pure`: exit 0. `function-set.ts plain`: the plain path's lines and pieces equal the inspected
  paragraph's on every case, it asks no question the record lacks and makes no more contexts, and `inspectLine` throws on
  it; 1,174 cases without facts and 1,218 with fail the check's order rule alone (below).
- Citations: 0 lost.
- Tier 2 forward, both configurations: 0 status transitions, 0 cases less exact, gate lost 0. The two configurations'
  pass, history-dependent and unobserved totals are equal, as they are in the two frozen references; what differs between
  them is which gaps cover a failure, and each run gives its own reference's breakdown.
- The plain predictor over the development sets (26,472 rows) against the usual run: 0 line ranges differ; 2 native
  observations differ, `rich-prewrap/trailing-spaces` `c-1ca0bab9ded7a4c6` and `c-53283654e67b8035` (one code point rect
  11 against 10.125px wide, one 9.953125 against 10), both history-dependent in every metric in the reference ledger
  already. The plain run's page paints nothing, so its process lays out no painted copy of a case's text, which is another
  break position cache history as well as a smaller set of Canvas questions.

Canvas questions a paragraph, asked and distinct alike (the memo is still there):

| | the lab's path | the plain path before | the plain path now |
|---|---:|---:|---:|
| without facts | 31.81 | 31.81 | 26.14 (−17.8%) |
| with the lab's facts | 19.18 | 19.18 | 12.38 (−35.4%) |

What the plain path drops, by the `gaps.ts` function that asks it on the lab's path (`tools/plain-drops.ts`, which reads the
call stack under replay), a paragraph, without facts and with them:

| Asked by | without facts | with facts |
|---|---:|---:|
| `familyDraws`: a character under the named list or the whole list, and under LastResort (`canvas-language`) | 2.30 | 2.30 |
| `itemGaps`: single code points and the total for `simplified-measuring`, test T1's width | 1.47 | 2.85 |
| LastResort beside makeBox's coverage test (`font-fallback`) | 1.03 | 1.03 |
| the item widths of the history worlds | 0.58 | 0.58 |
| glyph counts of letter-spaced strings asked for the gap first | 0.22 | 0.02 |
| the worlds' lines, controls | 0.01 | 0.01 |

The same tool checks the drop itself, on all 127,974 cases: the plain path asks only questions the lab's path asked; every
question the lab's path asks outside `gaps.ts` it asks too, in the lab's order; every question it drops was asked under
`gaps.ts`. 0 violations. `hyphen-glyph`'s second hyphen is dropped too, but no recorded case has `mapsHyphen` unknown; a
unit test holds it.

**The order rule of `function-set.ts plain`.** A question the lab's path first asks under `gaps.ts` and a later fill needs
(a single code point that `simplified-measuring` measured for line 1 and `breakWord` probes on line 2; a world item's width
that is a prefix a later line measures) is answered by the memo on the lab's path, and asked by the fill on the plain path:
later than in the lab's order, which the check reads as other questions. It follows from dropping, not from the port: 2,133
such questions without facts and 2,008 with, every one first asked under `gaps.ts` on the lab's path (the tool's fourth
check). WebKit keeps measured words per font, not per canvas, so the order of two different strings changes no answer.

### Open

- The decided line carries no width the fill measured: with the memo in place `lineGaps` finds them there. X2 hands them
  over.
- `gaps.ts`, `lines.ts` and `content.ts` import each other's functions: the break decisions raise into `gaps.ts`, and
  `gaps.ts` fills the worlds' lines and builds their items with content.ts's white-space and bidi helpers. No module reads
  another's values while loading.

## 2026-09-18: round 4c (the first and last display box rule, checked and registered)

research/PREWRAP-RICH.md's WebKit rule, `computeIsFirstIsLastBox` (InlineDisplayContentBuilder.cpp:1036-1060, read at
:770-772), is round 4b's display box fix. It was read again in the pinned source (the first display box of a span in box
order keeps the start edge, the last the end edge) and is registered as `webkit/output/first-and-last-display-box`; nothing
was ported. Scorer 7; runs under `.artifacts/tests/runs/r4c-ports/`.

- Tier 1 (62,653 cases, either configuration) and tier 2 (both orders) against the merged round 4b tree: nothing moves, as
  the round's other fixes are Blink's and Gecko's.
- Rich pre-wrap set, either configuration: 0 predicted values differ (of 3,213 without facts, 7,917 with). 10 cases of the
  main set fail a prediction metric, all under `page-history`. 8 are the break cache handing a pre-wrap node the item
  structure of an earlier break-spaces paragraph (PREWRAP-RICH §3 B): alone in a fresh process each has another native
  layout and passes every metric (`rich-prewrap/isolate-host`). 2 aren't history: `c-7ab87463d0a47df0` and
  `c-ea6d4a54b03e0a22` fail widths the same way alone and in installed Safari, one float32 step (engine line width
  109.06256103515625, native rects span 109.06256866455078 on a reordered line with padded spans); the whole line is
  limited, so no value is reported as predicted, and `page-history` covers it by position. Known tail:
  `webkit/reordered-line-width-one-float-step`.
- Installed Safari 27.0 spot check, which round 4b couldn't run (150 cases in 8 s, `safari-spot/`, with
  `--allow-safari-frontmost`): the 42 cases the display box fix moved pass lineCount, breaks and widths; the 108
  `rich-prewrap/bidi` cases pass lineCount and breaks, widths 103 pass, 3 unobserved and the 2 above fail; 0 of 506
  predicted values and 0 of 5,147 rect counts differ.
- `rich-prewrap` is a tier set since this round. Under the tier protocol (one document history for the 1,334 cases, both
  orders): 11 history-dependent cases, lineCount 1 and breaks 6 failing under `page-history`, widths the 2 above.

## 2026-09-18: round 4b (what the observation port reports as predicted; the Canvas family in the layout)

A trimmed round: the round 3 critic's finding 3 (research/ROUND3-CRITIC.md: the port reports values as predicted under the
layout's own gaps) and the port's Canvas family. Scorer 6. Baseline: the round 4a library (`584e359`), recorded on the tier 2
sets in both configurations and both orders (`webkit-round4b/sets/base-<config>`), and packed and frozen as a private tier 1
reference (`webkit-round4b/replay/webkit-host-<config>`, `replay.ts --dir`), since the shared references describe the round 3
library: against them every no-facts case asks a question the record lacks. Tools are in `webkit-round4b/tools/`:
`wrong-values.ts` (every predicted value that differs from the browser in scored runs), `offline-wrong.ts` (the same from
the working tree's replay of a recording against its native rows, 4 s), `state-diff.ts` (layout fields and state moves
against the private reference), `dump-values.ts`, `debug-case.ts` and `critic-remeasure.sh`.

### Predicted values that differ from the browser

| Set | Library | Predicted values | Differing | Cases holding one | Of them failing no prediction metric |
|---|---|---:|---:|---:|---:|
| the critic's fresh set `critic-r3-1`, 21,042 cases, facts | round 3 (the critic's rows) | 418,057 | 2,310 | 481 | 13 |
| | round 4a | 418,298 | 349 | 123 | 13 |
| | round 4b | 281,545 | 0 | 0 | 0 |
| | round 4b, no facts | 194,702 | 0 | 0 | 0 |
| tier 2 sets, 62,384 cases, either configuration | round 4a | 985,796 | 1,110 | 476 | 98 (42 pass all three) |
| tier 2 sets, no facts, either order | round 4b | 561,968 | 0 | 0 | 0 |
| tier 2 sets, facts, either order | round 4b | 764,570 | 0 | 0 | 0 |
| fresh `r4b-webkit-1`, 9,875 cases, no facts | round 4b | 85,273 | 0 | 0 | 0 |
| fresh `r4b-webkit-2`, 7,723 cases, facts | round 4b | 103,434 | 0 | 0 | 0 |

History-dependent cases and protocol rows are left out, as everywhere; the tier 2 sets' 268 history-dependent cases hold no
differing predicted value in either order either. Round 4a had narrowed `canvas-language`, which took most of the critic's
1,254 values with it; what it left sat under `letter-spacing-ligatures` (122), `canvas-language` (60), `page-history` (48)
and `rtl-shaping-across-inline-boxes` (65), and on lines with no gap after a line whose break a gap had moved (37).

The 98 tier 2 cases that failed no prediction metric and held a wrong predicted value, traced (round 4 counted 75 of them in
its family file; the tier 2 sets hold 15 more `rule/joining` cases and 8 suite and runs cases):

- 42 were an engine bug (`rule/nested-box-edges` 24, `rule/nowrap-spans` 10, `rule/box-edges` 8), fixed. In an RTL block a
  span's hanging space goes to the line's left at the root level and its word stays with the LTR text at the right, so the
  span has two display boxes on one line, and the port gave both the span's start edge: 44.53px where the DOM reports
  38.53px (`c-20592b0063422319`). `computeIsFirstIsLastBox` (InlineDisplayContentBuilder.cpp:1036-1060) makes only the first
  display box in box order the span's first box and only the last its last box (:770-782). Their widths go from unobserved
  to pass, the round's only status transitions on the tier 2 sets, in both configurations.
- 28 are page history (`rule/br-elements` 12, `rule/hanging-white-space` 10, four `suite/*/middle` cases, `suite/glue` 1,
  `suite/mixed` 1): alone in a fresh process all 28 hold exact predicted values (`runs/isolate-passing-wrong-base`), and in
  their sets the break cache hands their boxes other item ends, so the DOM has one box `[7,10)` where the prediction has
  two (`c-0560e2fd253c8ca1`), or `)` and U+200B in boxes of their own (`c-4c58dcad97d2cfb6`). Their lines report
  `page-history`; the port now limits them.
- 28 sit on lines with runs shaped across inline boxes (`rule/joining` 26, `runs/bidi-runs` 2): the x of boxes around the
  shaped runs, a float32 step off. Their lines report `rtl-shaping-across-inline-boxes`; the port now limits them.

### What the port reports as predicted

A value is predicted only where no gap the layout reports can move it (`lab/observe/webkit.ts`, the file's header):

- A line that reports a gap is limited as a whole, every x and every width on it, by that gap. The line's break rests on
  every width the line measured, so which text each box holds rests on a stand-in; a box sits at the widths of the runs
  before it, an RTL line's edge and an alignment offset come from the content width, a justified line shares out what its
  content leaves, and a reported width is `f32(f32(x + width) − x)`.
- The lines after it are limited by the same gap, up to a forced break: a line starts where the line before it ended
  (`leadingInlineItemPositionForNextLine`, InlineFormattingUtils.cpp:278-298). With line slots nothing starts over, since the
  rows shift with the line count, and a slot the engine refused on a gap moves every line after it.
- A paragraph gap concerns the lines its range meets, and every line without a range.
- Only the 0 width of a soft line break's box and of a `<br>`'s stays predicted on such a line. A caret's doesn't: a collapsed
  space reports a caret only while it ends its line (`c-a749f1e7bd879df8`: 6px natively where the line goes on).

Two narrower rules were built and measured first, offline over the 59,759 replayable tier 2 cases, no facts and facts:

| Rule | Predicted share | Differing predicted values |
|---|---|---:|
| boxes a gap's range meets, and what is placed after them on the line (box order in an LTR block, the whole line in an RTL block or under an alignment offset; expansion on a justified line; an inline box by what it holds) | 18.1% (no facts) | 109 in 64 cases, all failing breaks: the box that ends the failing line, and the lines after it |
| the same, with the text box that ends a line that reports a gap, and the lines after such a line up to a forced break | 14.2% and 19.1% | 0 |
| a line that reports a gap as a whole, and the lines after it up to a forced break (adopted) | 13.2% and 18.6% | 0 |

The second holds a claim no source reading gives (a moved break changes only the line's last box), takes about twice the
code of the third, and keeps half a point to a point more of the values predicted. The third is what `line.gaps` already says: a line
with a gap can be wrong, and then so can what follows it. In the browser runs the predicted share of all values goes from
18.9% (round 4a, either configuration) to 10.8% with no facts and 14.6% with facts; with no facts `simplified-measuring`
alone fires on 23% of passing fresh lines (lift 0.26), because `pairKerning` is unknown. No metric reads a state: lineCount,
breaks, widths and the painter compare rects whatever their state, and tier 1 compares every value of every case. What the
states decide is the evaluation's predicted-value agreement, which is now exact on every set above, so a predicted value
that differs is a bug in the port or the engine and nothing else.

How often a value limited by a line's gap differs from the browser, tier 2 sets, no facts, forward order (the scorer's
`facts.limited`; `in-word-prefix` and `glyph-clusters` are the in-box stand-ins, as before):

| Gap | Equal | Differ |
|---|---:|---:|
| `simplified-measuring` | 295,340 | 122 |
| `page-history` | 46,897 | 257 |
| `tab-stops` | 34,235 | 153 |
| `canvas-language` | 17,782 | 318 |
| `rtl-shaping-across-inline-boxes` | 6,916 | 247 |
| `letter-spacing-ligatures` | 6,415 | 52 |
| `string-storage` | 5,856 | 0 |
| `fixed-pitch-path` | 5,259 | 0 |
| `control-character-width` | 3,998 | 53 |
| `dictionary-breaks-stand-in` | 851 | 11 |

One scorer rule reads the states: `webkitStandInAddends` (scorer 6) takes the nodes whose expected width is limited as the
units of a line where only the float32 sum differs. Every node of a limited line is limited now, and they follow each other,
so such a line is covered where a gap's range touches any node on it: where the line holds a stand-in, which is what the rule
means to ask. No status moved on the tier 2 sets, the critic's set or the fresh sets.

### The Canvas family in the layout

`WebKitTextBox.canvasFamily` is the font-family list the box's text was measured with: the declared list with the generic
keywords the box's locale resolves named, and the script's standard family appended where no listed family resolves
(`engines/webkit/content.ts` makeBox). The port measures a leaf's in-box stand-ins with it, where it used the declared list
(it can't import `fonts.ts` under the independence rule). Those values were and are limited under `in-word-prefix`; on the
tier 2 sets 5,362 fewer of them differ from the browser (452,972 to 447,610 of 4.1 million). 2,626 tier 2 cases ask the port's questions under another font string than the
recording holds, so tier 1 sends them to tier 2.

The per-language table of generic families (`data/webkit/coretext-macos27/css-families.tsv`, generated into
`engines/webkit/generated/fonts.ts`) is macOS 27 Core Text data kept as engine data beside the libicucore break tables, by
the orchestrator's decision of 2026-09-18; it could become an environment input later. For the maintainer.

### Sets

Tier 2 (`webkit-round4b/sets/final-<config>`, both orders, 62,653 cases, 268 history-dependent), either configuration:
lineCount 81, breaks 133 and widths 257 failures, all covered, none open; against round 4a's ledger 42 transitions, widths
unobserved to pass. The critic's set, scored against the critic's native rows in both orders: no transition but 8 widths
unobserved to pass, 0 open.

Fresh sets (the round's cap of two, both orders):

| Seed | Configuration | Cases | History-dependent | lineCount / breaks / widths fail | Prediction failures | Open | Painter-only without an explanation |
|---|---|---:|---:|---|---:|---:|---:|
| `r4b-webkit-1` | no facts | 9,893 | 18 | 13 / 34 / 40 | 74 | 0 | 15 |
| `r4b-webkit-2` | facts | 7,735 | 12 | 4 / 10 / 32 | 42 | 0 | 5 |

No open row in either order and no new class. The second set's suite kind drew no case (the first drew 2,156).

Installed Safari didn't run: Safari was the frontmost app for the driver's whole ten-minute wait, and the driver doesn't open
a window over the user's (`runs/safari-spot-first-box.log`; the 42 cases of the display box fix).

### Known tail

Left for the ledger's backlog; nothing here was worked on.

- Painter-only failures without a covered explanation on the fresh sets: Thonburi, Thai with and without marks, under a
  hundredth of a unit (`c-017911e809ca65cc`, `c-1167f190a0c2eb1a`, `c-40579247e82324fa`, `c-fd3085c497b6baed`,
  `c-59b7dfffb03afe7a`, `c-06fa7b3ece3135e2`, `c-76f49356245aa1de`, `c-fc6f0aef0d4dbd76`); Georgia with Arabic, the same size
  (`c-035e3e87fbd4b6b6`, `c-bb8240573c72b7eb`, `c-265fa5ac9392927f`, `c-6dec45404fcc6dfd`); Times New Roman with Latin and
  Arabic, 33 to 64 units (`c-7f76e001defaf681`, `c-8ae74f1f8584217e`).
- `page-history` in the families' own documents: the same paragraphs at other widths give the break cache its entries, so
  `rule/br-elements` and `rule/hanging-white-space` cases pass every metric and differ in box structure from the case alone
  (`c-0560e2fd253c8ca1`, `c-0584f659aa240683`, `c-2831e2b52af7ff89`, `c-21ecede4442ac69d`, `c-357e4ce08f51853c`), and
  `suite/maintained/kinsoku-units` holds 29 of the first fresh set's 31 failures under `page-history` alone
  (`c-222b897d174bb6b7`, `c-2ced3e7672c3fc7d`, `c-37d85f3be46b8591`, `c-3cbdacac26c35e1e`). Predictable only with the cache's
  state as an input.
- `simplified-measuring` with no facts: 23% of passing fresh lines at lift 0.26, none of the first fresh set's failures but
  5 lines beside other gaps. It only diagnoses, and it now costs the predicted state of those lines and the lines after
  them. A Canvas-learnable reading of `pairKerning`, or a default, would clear it.
- `canvas-language`, system fallback by language: 22 and 20 fresh failures (`rule/keep-all-storage` 12 each,
  `policy/line-break`, `rule/languages`; `c-14d638d1d2d9cd24`, `c-4d0e304955ee9c29`, `c-90085c8df1d1bed6`,
  `c-3fe4e791b820fc5f`, `c-6f28d2483ce5e923`). Convertible with a font fact for the fallback font's class (round 4).
- `control-character-width`: 12 fresh failures a set in `rule/controls` (`c-36790cd39470be40`, `c-614b46c6f3889c92`,
  `c-03f66b457c62d5b7`, `c-32cc0163b5e17acc`), half of them beside `page-history`.
- `rtl-shaping-across-inline-boxes`: 7 a set (`c-7f344b45601ac620`, `c-831565fe24e24ef2`, `c-2bd2cb161d145aac`,
  `c-9538b1d868b0f616`); `dictionary-breaks-stand-in`: 3 in `runs/letter-spacing-spans` (`c-865597c8631ac2ca`,
  `c-e2636af0c0d4c0ed`, `c-fecc7f07676530b7`).
- The port reads a whole line as limited where a gap names a few characters, so on a line with a gap nothing says which
  boxes are still exact. The ranged rule above would say so for 5 points of the values, with its claim about the last box
  registered as a heuristic.
- An unranged line gap (`hyphen-glyph`) and the unported `inverseFrameScale` under page zoom limit as before.

## 2026-09-18: round 4 (generic families by locale, shaped runs, registered constants, isolation)

Scorer 5 throughout. Every library change ran predict-only against the round 3 evaluation's native rows in both orders
(`dev-all` and `families-all` from `.artifacts/ceiling-20260917/evaluate-r3/webkit-host/`, `heldout-all` from round 2's
`webkit-round2/heldout-all-*-r1`), in three shards (`webkit-round4/runs/<set>-<p>/`, tools in `webkit-round4/tools/`), then on
three fresh sets. The baseline `b0` is the evaluated bundle (sha256 `80b6b4b8…`) over the same rows. Probes are in
`rebuild/probes/webkit-round4.ts` (webkit-host; outputs under `.artifacts/probes/webkit/round4*`); Core Text research tools
are `rebuild/data/webkit/tools/ct-css-families.m` and `webkit-round4/tools/ctshape.m`, `ctruns.m` and `ctfile.m`. Row files
are compressed (`zstd -dc`).

### Sets

| Set | Cases | lineCount fail | breaks fail | widths fail | painter fail | Prediction failures | Without a covered explanation |
|---|---:|---|---|---|---|---|---|
| development combined file | 25,180 | 20 to 9 | 71 to 18 | 130 to 26 | 1,260 to 1,114 | 201 to 44 | 0 to 0 |
| held-out 09-16 combined file | 15,196 | 40 to 31 | 84 to 43 | 162 to 46 | 2,231 to 2,078 | 246 to 89 | 0 to 0 |
| rule and feature families | 21,734 | 51 to 43 | 86 to 78 | 177 to 177 | 910 to 910 | 263 to 255 | 0 to 0 |

- No pair lost on any metric of any set (`tools/compare.py`). Predicted values agree on 99.963% of the development file's
  (99.732%), 99.917% of the held-out file's (99.636%) and 99.777% of the families' (99.775%).
- With no supplied font facts (`lab/baselines/no-facts-predictor.ts`, `<set>-nofacts-p5`): development 10 / 19 / 34, held-out
  32 / 46 / 55, families 43 / 78 / 177, none without a covered explanation. What facts buy is `monospace` (`ws/controls`,
  `ws/text-nodes`), as research/FACTS-FREE.md found. Without facts `fixed-pitch-path` fires on 21%, 17% and 45% of passing
  lines and `simplified-measuring` on 18%, 9% and 44%: the `monospace` and `pairKerning` facts. The first is
  Canvas-learnable (FACTS-FREE); the second isn't, and it decides only whether a pair adjustment sits on the U+0020 a text
  item is measured with.
- What is left under `canvas-language`: development 9, held-out 11, families 130 cases, all system fallback by language (Han
  and Hangul in Arial under ko, kana in `"PingFang SC"` under ko, simplified Han in `"Hiragino Sans"` under ja).
- Giants (`giants-p5`, the 9 held-out giants, predict-only against the evaluation's native rows, `--chunk=1`): lineCount 9 of
  9, breaks 9 of 9, widths 1 pass and 8 unobserved, as in the evaluation. The job took 204 s: prediction 0.15 to 1.46 s a
  giant (106,857 to 269,747 units, 9,874 to 20,279 Canvas calls), the lab's observation port 4 to 47 s.

Fresh sets (`bun rebuild/lab/fresh.ts --browser=webkit-host --seed=<seed>`, file order, final library from `r4-webkit-2` on;
`r4-webkit-1` ran before the `page-history` correction below, which moves no prediction):

| Seed | Cases | lineCount / breaks / widths fail | Prediction failures | Open | Under `page-history` | `canvas-language` | Other |
|---|---:|---|---:|---:|---:|---:|---:|
| `r4-webkit-1` | 10,953 | 35 / 66 / 67 | 133 | 0 | 82 | 29 | 22 |
| `r4-webkit-2` | 10,846 | 54 / 99 / 56 | 155 | 0 | 118 | 23 | 14 |
| `r4-webkit-3` | 10,812 | 12 / 38 / 48 | 86 | 0 | 50 | 24 | 12 |

- 374 prediction failures in 32,611 cases, 115 per 10,000 (round 3's evaluation: 207), no new class on any set, which is the
  round's cap of three sets. The changes made after a set (USCRIPT_HAN's standard family after `r4-webkit-3`, the fallback
  table's additions) move no prediction or cover on the defined sets (`<set>-p6` equals `<set>-p5` case by case). Other: `control-character-width` 22, `letter-spacing-ligatures` 14,
  `rtl-shaping-across-inline-boxes` 7, `dictionary-breaks-stand-in` 5.
- The 250 cases under `page-history`, each alone in a fresh process (`isolate-fresh<n>-part-*`): lineCount 250 of 250,
  breaks 250 of 250, widths 219 pass, 12 unobserved, 19 fail, those also under `control-character-width`,
  `letter-spacing-ligatures` or `tab-stops`. Outside page history the fresh sets hold 124 prediction failures, 38 per 10,000.
- Painter-only failures without a covered explanation: 701, 641 and 442 (painter owner; `painterLimits` isn't recorded).

### canvas-language: which family draws

The round 3 condition fired on every Han, kana and Hangul character under a Han, kana or Hangul locale and on every
character no named family draws before a generic family. Three source readings and four probes replace it.

- **A named family settles its own characters under every locale.** A family named by a string is looked up by name
  (fontWithFamily, FontCacheCoreText.cpp:624-643; only fontDescriptorWithFamilySpecialCase's system names read the locale),
  its glyph page is CTFontGetGlyphsForCharacters of that font, which takes no language (GlyphPageCoreText.cpp:51-73), and a
  list draws a character with its first family that has a glyph (FontCascadeFonts::glyphDataForVariant,
  FontCascadeFonts.cpp:426-470). Probe R7 (33 named families, 46 characters, 7 languages): the 663 characters Canvas says a
  named family draws (the family followed by LastResort doesn't give LastResort's box) measure the same in the DOM as in
  Canvas under no language, en, ja, ko, zh-Hans, zh-Hant and zh-HK, 4,641 of 4,641; of the 855 no named family draws, 468
  differ under ko, 51 under ja, 48 under each zh, none under en or none. R12 (15 named families, 18 strings, 10 languages):
  whole strings differ only in such characters, so the locale doesn't reach a named family's shaping on these fonts.
- **Round 3's `"PingFang SC"` reading was a missing glyph.** Under ko the family drew kana at Apple SD Gothic Neo's advance
  because it has no kana here: the WebContent process resolves the name to the system's reserved
  `/System/Library/PrivateFrameworks/FontServices.framework/Resources/Reserved/PingFangUI.ttc` (Han and no kana or U+2027),
  where an unsandboxed process finds the downloaded `PingFang.ttc` asset, which has both (`ctfile.m`, `ctshape.m`). Canvas
  says so too: `"PingFang SC", LastResort` gives kana LastResort's box. The lab's `coverage` facts read the asset, which is
  why they claimed U+2027 (font facts owner). STHeiti, Kaiti SC, LiHei Pro, LiSong Pro, BIZ UDGothic and Osaka don't resolve
  in the process at all.
- **Generic families are measured, not reported.** serif, sans-serif, cursive, fantasy and monospace resolve through
  `CTFontDescriptorCreateForCSSFamily(keyword, locale)` whenever the locale's script isn't Common
  (SystemFontDatabaseCoreText.cpp:320-365, FontDescriptionCocoa.cpp:77-118), and WebKit looks the returned family up by name
  (CSSFontSelector.cpp:431-492), rejecting reserved names (a leading `.`) for the settings' family and turning Monaco into
  Courier. Core Text is closed, so its answers are data: `rebuild/data/webkit/coretext-macos27/css-families.tsv`, 1,079
  languages (every system locale identifier) dumped by `data/webkit/tools/ct-css-families.m` on macOS 27.0 26A428, 32
  distinct answers, generated into `engines/webkit/generated/fonts.ts` as the default and the 60 languages whose answer
  differs from their parent's (`tools/gen-webkit-fonts.ts`). The port names that family in the list Canvas gets (`engines/webkit/fonts.ts`,
  `content.ts` makeBox). Probe R11 (36 language values, the five keywords and -webkit-standard, 14 strings;
  `tools/r11-verdict3.ts` with the port's own lookup): of 216 pairs 125 name a family, and the DOM's boxes equal Canvas
  totals under the list the port builds on 200, 152 to the bit and 48 within a float32 step on strings with break
  opportunities inside (a probe artefact: the DOM sums items). The other 16 are the port's other rules: Kaiti SC and Kaiti TC,
  which the WebContent process doesn't have (12: the standard family then draws, below), -webkit-standard under zh (2, the
  preferred languages), Han after Menlo under ko and Arabic under ur (system fallback by language). Under en, `monospace`
  is Menlo and `fantasy` Zapfino, where Canvas resolves the keywords to Courier and Papyrus; under he, sans-serif is Lucida
  Grande and monospace Courier New; under ru and tr, cursive and fantasy are Snell Roundhand. `yue`, `mul` and unknown
  languages have a Common script and resolve as Canvas does, as the source says.
- **-webkit-standard from source.** The settings' standard family per script is in WebKit
  (SettingsBase::initializeDefaultFontFamilies, SettingsBaseCocoa.mm:44-50: Songti TC, Songti SC, Hiragino Mincho ProN,
  AppleMyungjo), and it also stands behind a list none of whose families resolves (FontCascadeFonts.cpp:210-217): named at
  the end of the Canvas list where the list followed by LastResort measures a space as LastResort alone does (R7: `a` in
  `STHeiti` is 7.99px under en and 9.81px under ja at 18px). USCRIPT_HAN follows a system preference and stays reported.
- **What still reports**, per character: no named family draws it and the list holds a system design family, or
  -webkit-standard under USCRIPT_HAN without the preferred languages (userPrefersSimplifiedChinese, Language.cpp:129-138,
  chooses Songti SC or TC by them); it has default emoji presentation and only a generic named for Canvas could draw it
  (the DOM skips a generic family's outline glyph for it, FontCascadeFonts.cpp:440-447, FontCascadeCoreText.cpp:473-523, and
  Canvas doesn't know the named family for a generic one); or no family of the list draws it and the language moves its
  system fallback.
- **Closed in Core Text: system fallback.** `CTFontCreateForCharactersWithLanguageAndOption` (lookupFallbackFont,
  FontCacheCoreText.cpp:775-790) picks the fallback font from the original font, the characters and the language, for
  every character no family of the list draws. As the source reads, that is every such character under any locale: the
  condition then fires on 29% of passing development lines at a lift of 0.8 (`dev-all-x1`), because the lab's Latin lists meet
  Arabic, Hebrew, Thai, Han and emoji everywhere. So which characters a language moves stays a table of probe verdicts,
  `gaps.ts` hasLanguageDependentFallback (in `content.ts` until X1), now registered as a heuristic. Round 3's table was Han, kana, Hangul, CJK
  punctuation and fullwidth blocks under Han, kana and Hangul scripts. R13 (3 Latin fonts, 45 languages, 28 strings of 25
  scripts) and R14 (Helvetica, Times and Geeza Pro, 70 languages, three sample characters of each of 321 blocks) add Arabic
  under Urdu and Kashmiri (Noto Nastaliq Urdu for Geeza Pro) and enclosed alphanumerics, box drawing, geometric shapes and
  vertical forms under ko, and find no other pair. The probes see a font change only where advances differ, and three
  samples don't stand for a block. The font also follows the original font's class: Han under ko falls back to AppleMyungjo
  from Times and Georgia and to Apple SD Gothic Neo from Helvetica, Arial and Menlo (R12), so predicting it would need a
  font fact Canvas can't show.
- **Not traced:** an Ethiopic word (`አማርኛ`) after Georgia, Helvetica and Menlo differs from Canvas under every language
  but am and none (R13), while single Ethiopic characters don't (R14): the locale reaches shaping there
  (Font::applyTransforms and the complex text controller hand Core Text the computed locale, FontCoreText.cpp:646-700,
  ComplexTextControllerCoreText.mm:199-203). No condition reports it, and no lab case holds Ethiopic.
- Firing on passing lines, `b0` to final: development 15.41% to 1.11% (lift 5.6 to 18.3), held-out 13.86% to 0.92% (5.4 to
  15.5), families 6.91% to 3.52% (8.2 to 16.5); fresh sets 2.4%, 2.6% and 3.1% (round 3's: 15.9%). No failing line lost its
  cover on any set.

### Text shaped across inline boxes

- **The 8 `rule/joining` rows, traced.** `بب <span>ببب</span><span>ببب</span> بب`, 24px Amiri, 1px letter spacing, 11.42px
  wide, `overflow-wrap: anywhere`. The native 34.672px is no run's share: it is 23.224px, the first letter measured alone
  with its spacing, plus 11.448px, the share of the rest `بب` after the next candidate shaped it again with `ببب`
  (`بب` + `ببب` as one run; the partial leading item takes part in shaping with its partial text, InlineLineBuilder.cpp
  candidateContentForLine and :920-967). 11.448px is over the 11.4375px available, so the rest breaks again and carries
  11.448 - 23.224 = -11.776px. The port's flow was the source's; its stand-in wasn't: `بب` followed by U+200D is 9.96px in
  Canvas, because Amiri's forms follow the letters after them, not joining alone, and 9.96px fits. Canvas does give
  11.448px as the joined text less the text after the run: 44.352 - 32.904.
- **Shares are suffix differences now.** A run's share is the Canvas total of the joined text from the run on, less the
  total of the text after the run, each after U+200D where the letters at its first edge join; where that agrees with the
  run alone in its joining context within the float32 rounding of the three totals, the run alone stands, since a
  difference of totals isn't the float32 sum of the run's advances (33 family widths were one step off without this).
  The shares add up to the joined text's total, which the source says (shapedContentWidth is the sum of the run widths) and
  probe R10 confirms (35 of 36 run lists in 9 fonts and all 36 in Courier New; the DOM's shaped boxes carry no letter
  spacing). Chosen over
  the run alone and over prefix differences by R10's counts, 509, 492 and 474 of 770 runs equal to the DOM's: a registered
  heuristic. No recipe is right throughout: Amiri's `ب|ب` is 5.928 and 18.528px natively and no Canvas total splits 24.456
  that way. Families: lineCount +8, breaks +8, nothing lost; `rtl-shaping-across-inline-boxes` covers 17 failing family
  lines (25).
- **Joining is the Unicode Standard's.** Whether two runs join is Joining_Type at the edge, transparent characters skipped
  (`engines/webkit/joining.ts`, `generated/joining.ts` from ICU 78.2's ppucd.txt), in place of round 3's nearer-of-two-sums
  test: R10 gives the two decisions the same counts on 8 of 10 fonts (Joining_Type ahead on 16px Amiri, the sums test on Al
  Nile), and the sums test cost up to five Canvas calls an edge.
- **Found, not predicted: ranges WebKit doesn't shape.** Core Text returns several glyph runs for one font's stretch that
  holds a shadda with a vowel sign (`ctruns.m`: `ببَّب` is three runs in 8 fonts; which pairs compose is per font),
  glyphAdvancesForTextRun counts the stretch's characters once per glyph run (ComplexTextController.cpp:190-203;
  stringLength() is the whole stretch, ComplexTextController.h:112), the size check fails and
  applyShapingOnRunRange returns before any width changes (InlineLineBuilder.cpp:943-946). The boxes keep their own widths,
  letter spacing included (R10: `الرَّحِي|مِ` in all 10 fonts; suite `c-d03f94e8fb53e7e2`, which round 3 couldn't explain).
  Not Canvas-observable; the gap covers it. Both this and letter spacing missing from shaped boxes look like WebKit bugs.

### Registered constants and the decision rule

- **64px letter-spacing probe.** Any spacing works whose count the two totals' float32 rounding can't move by half; a power
  of two keeps the product exact. Both totals are float32 sums of at most three additions a glyph, so the difference is
  within 3 × glyphs × ulp(total) of glyphs × 64. `measure.ts` checks that bound per string (about 900 letters at 16px) and
  reports `letter-spacing-ligatures` on a longer one instead of counting it. Probe R8: the quotient is within 0.002 of the
  glyph count at 50,000 letters in 5 fonts, so the bound is far from tight.
- **0.75 to 1.5 sanity bound.** Replaced by the Sterbenz interval itself: Canvas totals f32(U + f32(S - U)), rounding is
  monotonic and U / 2 and 2 × U are float32 numbers, so a total strictly between them says S is in range and the total is S.
  On the development file the check ran on 77,265 strings: 68,781 equal their unshaped sum, 8,484 lie inside (ratios 0.82
  to 1.013), none outside. No firing change.
- **Nearer-of-two-sums.** Replaced by Joining_Type, above.

### page-history against the isolation protocol

`tools/history-check.ts`: every history-dependent case of the defined sets and every case failing under `page-history`
whose two orders agree, each alone in a fresh process (`runs/isolate-<set>`, 400 cases), against both orders.

| Set | History-dependent | Failing under `page-history`, orders equal | Alone: lineCount / breaks / widths pass | Differ from alone, forward / reverse | Fail uncovered in an order |
|---|---:|---:|---|---|---:|
| development | 80 | 26 | 106 / 106 / 104 (1 fail, 1 unobserved) | 57 / 53 | 1 |
| held-out 09-16 | 144 | 68 | 212 / 212 / 210 (2 unobserved) | 129 / 129 | 0 |
| families | 6 | 76 | 82 / 82 / 50 (32 fail, `rule/controls` steps) | 50 / 48 | 0 |

- The history-free prediction is the native layout of every case alone, outside the control-width steps. 116 of the 170
  cases whose orders agree differ from the case alone in both orders (15, 57 and 44): two orders can't see history both
  share. Alone, every history-dependent development and held-out case equals exactly one of its two orders (the forward
  one differs for 42 of 80 and 72 of 144).
- **One condition bug found and fixed.** Before the fix 9 development rows of `suite/original-vs-reshaped-admission` failed
  uncovered in reverse order and held-out `c-d7754587b964dea1` forward. A line that starts with a carried width was laid
  out in a world with the own carried width whenever the world's item started where the own item does; the carried width is
  the whole item's less what earlier lines took, so it stands only where the world's item is the own one
  (`c-19ccdb6bbbc8089c`: `ببب((` carries 32.4px for `بب((`, where a world that ends an item before `((` carries 10.416px for
  `بب`, which fits). Such a line now reports. `page-history` on passing lines: development 3.42% to 3.68%, held-out 4.43%
  to 4.82%, families 1.28% unchanged.
- The row left, `c-a749f1e7bd879df8` forward: `page-history` sits on the decision text, and a node it doesn't touch reports
  f32(f32(x + w) - x) one step off at the moved x, the observation consequence scorer 5 has no rule for (tests owner).
- **One box at a time, not contradicted.** Natively lines move in more than one text node in 2 development, 1 held-out and
  20 family cases (`rule/br-elements`), every one covered in both orders, and later nodes move with any earlier break, so the
  count can't tell two cached boxes from one. No case needed two boxes' worlds at once for its first differing line. What
  wasn't done: laying whole paragraphs out in products of worlds and matching them to the native lines; the library lays
  out each line in each world from the own line start.

### Costs

measureText calls per paragraph on the development combined file, mean / median / p90 / p95 / max: round 3 final 37.2 / 12 /
102 / 120 / 2,273; now 22.7 / 12 / 49 / 78 / 3,818 (the maximum is a Han paragraph under a Han locale: two calls a distinct
character). By the engine code that asks first (`tools/calls-by-asker.ts`, an offline replay of `dev-all-rec` that reads the
call stack; a string a condition asks first and layout asks later counts for the condition):

| Asks | Share | Per paragraph | Decides lines? |
|---|---:|---:|---|
| `boxWidth`: item widths, line filling, breakWord probes | 45.4% | 10.33 | yes |
| makeBox: fixed-pitch coverage, the list followed by LastResort and the plain list per distinct character | 10.4% | 2.38 | yes (the width shortcut) |
| makeBox: the same character under LastResort alone, for `font-fallback` | 5.2% | 1.19 | no |
| `simplified-measuring`: every code point of a measured string alone, for the unshaped sum, and the total | 14.5% | 3.29 | no |
| `canvas-language`: a character under the named list or the whole list, and under LastResort | 10.1% | 2.30 | no |
| `page-history`: widths of the split parts of a world's items | 3.9% | 0.89 | no |
| letter-spaced strings: glyph counts at 64px and plain (clusters, pairs, the whole, the separated string) | 4.4% | 1.02 | yes (the measured string) and the gap |
| item widths at item building (bidi content) | 3.8% | 0.86 | yes |
| hyphen width | 1.0% | 0.24 | yes |
| the standard family test (a space under the list followed by LastResort) | 0.7% | 0.15 | yes |
| controls, tab stops, shaped runs, world lines | 0.4% | 0.08 | mixed |

About a third of the calls are diagnostic. The unshaped sums of `simplified-measuring` never decided anything on this file
(above), and LastResort's advance was the same for all 1,518 probed characters (R7), so both could be asked far less.

### Open

- System fallback by language (Core Text, above): 150 of the 388 prediction failures left on the defined sets, 76 of 374 on
  the fresh sets. Its table of characters is a heuristic from probes, and shaping under a locale (the Ethiopic word) has no
  condition.
- The generic family table is macOS 27.0's Core Text. An unknown language takes its parent's answer (the identifier less
  its last subtag), which the dump confirms for the 1,079 identifiers it holds and nothing confirms beyond them. Core Text
  reads `ZH-Hant` (upper-case language) as Simplified; the port lower-cases first. Whether the table belongs in the library
  or behind an environment input is the maintainer's call.
- Ranges WebKit doesn't shape (shadda with a vowel sign), ligatures and pair adjustments across a box edge, and letter
  spacing under `liga`-less shaping stay stand-ins under `rtl-shaping-across-inline-boxes`.
- Without font facts, `simplified-measuring` fires on every simplified-path item measured with its following space
  (`pairKerning` unknown): 18% of passing development lines for a font construction R2 never met.
- 75 passing family cases hold one wrong predicted value each, as before this round (`rule/nested-box-edges` 24,
  `rule/br-elements` 12, `rule/joining` 11, `rule/hanging-white-space` 10, `rule/nowrap-spans` 10, `rule/box-edges` 8): node
  rects are equal, so it is a code point or element rect; not traced.
- The observation port still measures its in-box stand-ins with the declared family list, not the list with generics
  named. Those values are limited, never predicted, so no metric reads them.
- Registry: `webkit/measure/generic-family-by-locale` is new; `webkit/lines/shaped-run-in-joining-context` and
  `webkit/gap/canvas-language-scope` keep their ids with new statements (rules.json belongs to the tests owner).

## 2026-09-17: ceiling round 3 (covered failures, fresh sets)

Scorer 5 throughout: a gap covers a failing line only where its range touches what differs there (lab/README.md, "Covered
failures"). Round 2's rows were re-scored with it first (`webkit-round3/rescore-r2/`); every library change then ran
predict-only against round 2's native rows in both orders (`webkit-round3/runs/<set>-p<n>/`, tools in
`webkit-round3/tools/`), and on fresh sets from the lab's `fresh.ts`. Probes are in `rebuild/probes/webkit-round3.ts`
(webkit-host; outputs under `.artifacts/probes/webkit/round3*`).

### What round 2's zero hid

Round 2's rows under scorer 5, prediction failures without a covered explanation: development 7, held-out 09-16 27, rule and
feature families 0, triage 8. Every one traced to a condition that was narrower than its source reading:

- **`page-history` missed three things the break position cache reaches.**
  - *The carried width.* The rest of an item split across lines keeps the whole item's width less what earlier lines took
    (overflowWidthAsLeadingForNextLine, AbstractLineBuilder.cpp:54-98). A cached end inside the item starts that chain from
    another whole, so the lines after the one that read the end differ. Triage `c-66ae4ab7d56cb0ae` (round 2's open row): an LTR
    box of the same text, laid out earlier in the process in both orders, ends an item between `((` and `بببب`; line 6 then
    keeps `ببب` at 16.27px, the rest of `بببب` alone, where the rest of `((بببب` is 26.02px. 12 of the critic's 13 rows
    (`suite/original-vs-reshaped-admission`, `c-38c6f39166bffa7e`) are the same chain one float32 step apart.
  - *float32 order.* The parts of a split item enter the line's sums as separate terms, so a line can move by a float32 step
    although the parts add up to the whole. Round 2 reported only where the parts measured otherwise (`c-b15c696c7d085af8`,
    `c-9ebcbc805266199c`, `c-c63d3cd84183da36`).
  - *ICU's direction shortcut.* ubidi_setPara gives a text without RTL characters the paragraph level everywhere
    (directionFromFlags, ICU 78.2 ubidi.cpp:1007-1018, :2684-2693), so `a` SHY LRI `b` PDI `c` has no level boundary alone
    and has two once its paragraph holds an RTL character anywhere (held-out `c-7cc5e3e26ff7c30d`). The contexts are now
    resolved as mixed, over the whole text where a bracket pair or an explicit code reaches past an edge, with the contexts
    that open an isolate or embedding before the box or close one after it, and with AL before a European number.
- **`page-history` is now the cache's effect, computed.** Each other item list the cache can hand a box is a history world:
  the paragraph's items with that box built as buildInlineItemListForTextFromBreakingPositionsCache builds it (another
  paragraph's level boundaries per direction and context pair, the three preserved white-space structures, the cached
  word-separator flag of a white-space item that starts with a TAB, InlineItemsBuilder.cpp:893), then the box's own bidi
  splits. Every line is laid out in each world that changes an item the line read, from the same line start, and the gap is
  reported where the world's line differs in its range or display boxes, on the text between the two breaks or the boxes
  that differ. A line that starts with a carried width inside an item a world ends earlier can't be laid out in that world and
  reports. Declared approximations: one box differs per world, and the contexts stand for every neighbouring text.
- **Carried widths carry conditions.** A line that starts with a carried width reports, on the rest of the item, every
  condition of the whole item's measurement (triage `c-0033f34a9d6b3f85`: `ty` after `affini`, a float32 step off a whole that
  leaves out a pair adjustment), and `rtl-shaping-across-inline-boxes` where the width was carried from a shaped run.
- **`dictionary-breaks-stand-in` between boxes.** mayBreakInBetween's iterator text is the previous box's last two units and
  the next box's text, so a box edge inside a Thai word can start a dictionary range with a combining mark (held-out
  `c-964d495e90c81b81`: U+0E49 U+0E27 before the next node's `ยกั`, where WebKit breaks between the nodes).
- Gaps name every stretch of characters they concern, one entry per gap, leaf and stretch, instead of the first.

### Weak conditions turned into predictions or narrow conditions

Probes R1 to R6 (`rebuild/probes/webkit-round3.ts`). Firing rates are on the fresh set `r3-webkit-1` (11,235 cases, the same
native rows): round 2's library, then the final one, as shares of passing lines with the lift against failing lines.

| Gap | Round 2 library | Final library | What changed |
|---|---|---|---|
| `letter-spacing-ligatures` | 8.68%, lift 1.08 | 0.04%, lift 55.7 | Canvas shows merged glyphs; a recipe measures without them |
| `simplified-measuring` | 20.66%, lift 0.34 | 5.69%, no failing line | Only where a space's own advance can be shaped |
| `control-character-width` | 5.80%, lift 1.56 | 0.37%, lift 16.3 | VT, FF and CR measured as Core Text shapes them; other Cc exact |
| `canvas-language` | 28.82%, lift 2.45 | 15.88%, lift 5.03 | Han, kana or Hangul locales; characters no named family draws |
| `page-history` | 6.31%, lift 3.92 | 4.38%, lift 3.67 | The cache's effect per line (above) |
| `rtl-shaping-across-inline-boxes` | 0.07% | 0.13% | Also on lines with a carried shaped width; the recipe changed |
| `tab-stops` | 1.32% | 1.32% | The TAB's float32 order ported; the condition stands |

Failures covered only by gaps with a case-level lift below 2: development 180 of 207 under round 2's library, 2 of 202 now;
held-out 09-16 33 of 268, now 5 of 250; families 153 of 525, now 0 of 263 (the rest sit under `tab-stops`).

- **Letter spacing (probe R1, 16 fonts).** The DOM turns off liga, clig, dlig and hlig where letter-spacing isn't 0
  (StyleComputedStyleBase.cpp:324-331, UnrealizedCoreTextFont.cpp:258-264); Canvas keeps them. WidthIterator adds letter
  spacing once per character that keeps glyphs of non-zero width after shaping (WidthIterator.cpp:491-517, :654-690), and the
  complex text controller once per glyph with an advance (ComplexTextController.cpp:792-796), so a total at 64px of letter
  spacing less the total at none counts a string's spacing-bearing glyphs.
  - A string whose count equals its grapheme clusters' counts measures the same in Canvas as in the letter-spaced DOM: 247 of
    247 probed strings without a space. No gap there.
  - On the simple path a merged pair is measured with U+200C between its letters, which no lookup matches across
    (WidthIterator.cpp:318-323) and which takes no spacing. That leaves out the pair adjustment between the two with the
    features off: equal to the DOM in Amiri (64 of 64 probed strings) and Hoefler Text (24 of 24), 0.29px narrow for
    ProbeShantell's `fi`, 0.29px wide for Helvetica Neue's. The gap stays on the pair.
  - On the complex path nothing is separated (U+200C would break joining, and lam-alef merges in the DOM too), and the gap
    stays on the item.
  - Font facts: where `ListedFontFacts.coverage` and `spacingInputs` say every character of a string is drawn by a listed
    family and none is an input of a lookup letter-spacing turns off, nothing is separated and nothing reported (Geeza Pro's
    lam-alef and Allah ligatures, which the DOM keeps). On `r3-webkit-3` the gap went from 364 lines to 21 with grapheme
    clusters and the facts together; the facts' part is Geeza Pro's 48 lines. They convert no failing row: the failing rows
    are the pair adjustments no fact places.
  - Triage (`triage-small`, 9,854 cases): lineCount 483 failing to 131, breaks 732 to 302. 15 line counts went the other way,
    all `suite/ligature-thresholds-v3` at widths between the DOM's width and the recipe's (`waffles` 33.664px natively,
    33.456px measured, in 33.633px): their breaks were failing before, and the pair gap covers them.
- **Simplified measuring (probes R1, R2).** The DOM sums shaped advances in one float32 loop (FontCascade.cpp:381-412);
  WidthIterator adds (shaped sum less unshaped sum) to the unshaped sum after putting spaces back to their unshaped advances
  (WidthIterator.cpp:84-120). The two sums are within a factor of two of each other, so their difference is exact in float32
  and WidthIterator's total is the shaped sum: 162 of 162 strings without a space equal the DOM, kerned and ligated ones
  included. What Canvas can't show is a shaped advance on a space itself: a U+0020 before the string's last unit (a
  preserved run of spaces), or the following U+0020 where the font's tables adjust a pair's second glyph. R2: 2,350 of 2,350
  pre boxes of an ASCII character and a space equal the recipe in 25 fonts, 47 of them with a pair adjustment, which Core
  Text puts on the letter. `FontFacts.pairKerning`, where given, says the tables hold no second-glyph record; where it is
  null the gap stays on strings measured with their following space. A face without any pair kerning has a null fact in
  the lab's table, so Georgia, Courier New, Menlo, PingFang and Amiri boxes keep the gap (a value for "none" would clear it).
- **VT, FF and CR (probe R5, 6 fonts).** Font::applyTransforms hands Core Text the characters with the glyphs
  (FontCoreText.cpp:689-700), and Core Text kerns the letter before the control as before a space: `A` FF `V` in 16px Arial is
  A less 113 units, .notdef's 12px, V. applyCSSVisibilityRules then overwrites a control's advance with .notdef's and leaves
  CR's as shaped (WidthIterator.cpp:792-823). Canvas never sees the control (it turns U+0009-U+000D into spaces), and its
  `A` U+0001 `V` kerns A against V across the stand-in. The stand-in in place is exact where Canvas shows no pair adjustment
  around the control; elsewhere the width is the text before the control shaped before a space, the control's advance and
  the text after it (46 of 48 probed strings equal, 2 a float32 step off), under the gap. Other Cc characters reach Canvas as
  they are: 96 of 96 equal, no gap. Families: `rule/controls` 142 failing rows to 64, all now one float32 step off in
  Helvetica Neue's non-dyadic advances.
- **TAB.** WidthIterator sums a TAB as the space glyph and then adds f32(stop less space) to it (calculateAdditionalWidth,
  WidthIterator.cpp:491-517), so a lone TAB is f32(space + f32(stop - space)), not the stop (`c-6607fcdcc27aec94`:
  22.880001068115234px for a stop 22.8799991607666px away). Without spacing the Canvas total of the string, TABs as spaces,
  plus the additions in order is WidthIterator's own order.
- **`canvas-language` (probes R3, R3b, R3c).**
  - System fallback under a locale whose script isn't Han, kana or Hangul follows the preferred languages, as Canvas does:
    117 of 117 strings under each of 18 languages and under none; under ko 36 of 117. No gap for such a box unless its list
    holds a family the locale resolves.
  - In a list with such a family (a CSS generic, -webkit-standard, a system design), only a character no named family
    before it draws is concerned; Canvas decides that with the named families followed by LastResort. R3c: U+2027 through
    `"Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, sans-serif` is no named family's glyph and differs under hi,
    zh-Hant and ko.
  - Under a Han, kana or Hangul locale a named family doesn't settle Han, kana, Hangul, CJK punctuation and fullwidth forms:
    `"PingFang SC"` draws kana 18px wide under en, hi and zh-Hant and 15.57px wide under ko, Apple SD Gothic Neo's advance,
    though Canvas finds the family's own kana glyph. A first narrowing by coverage lost 65 rows' cover on the iterated sets
    and was taken back. Core Text is closed, so these stay concerned whatever the list names.
  - The listed families' `coverage` facts weren't used: they say PingFang SC maps U+2027, which WebKit doesn't draw from it
    (R3c).
- **Text shaped across inline boxes.** A run's share is the sum of Core Text base advances of its characters in the joined
  text (ComplexTextController.cpp:186-205). Round 2 took Canvas prefix differences of the joined text, which reshape the
  letter at each cut. Now a run is the Canvas total of its text with U+200D on each side where the neighbouring run joins it,
  and two runs join where their texts as one string are nearer to the sum with U+200D between them than to the sum alone.
  Families: lineCount +62, breaks +89, widths +19 against the prefix recipe; `c-0ad060cd384930bf`'s boxes are now exact
  (23.924049377441406px and 55.62748718261719px, round 2 had 32.80px and 46.75px) and its line sum is one float32 step off,
  under the gap. 8 `rule/joining` line counts were lost: letter-spaced, `overflow-wrap: anywhere`, one letter per line,
  passing by accident with failing widths (carried 1.23px predicted, -11.78px natively); still not explained beyond the gap.

### Sets

Round 2's rows under scorer 5 against the final library (predict-only, history flags from round 2's two orders):

| Set | Cases | lineCount fail | breaks fail | widths fail | Prediction failures | Without a covered explanation |
|---|---:|---|---|---|---|---|
| development combined file | 25,180 | 25 to 20 | 75 to 70 | 132 to 132 | 207 to 202 | 7 to 0 |
| held-out 09-16 combined file (9 giants moved out) | 15,196 | 44 to 40 | 91 to 86 | 177 to 164 | 268 to 250 | 27 to 0 |
| rule and feature families | 21,734 | 140 to 51 | 234 to 86 | 291 to 177 | 525 to 263 | 0 to 0 |
| triage-small | 9,854 | 483 to 131 | 732 to 302 | 17 to 398 | 749 to 700 | 8 to 1 |

- Lost pairs, all with a covering gap: development 1 width (`c-0ad060cd384930bf`, above); families 8 lineCount and 8 breaks
  (`rule/joining`, above); triage 15 lineCount (`suite/ligature-thresholds-v3`, above) and 2 widths (`suite/raw-context`
  `c-210779861cd564ec`, `c-829d50fd5c613373`: `a` VT `f` in Noto Nastaliq Urdu, pieced together one float32 step off where
  the stand-in in place was exact). Triage widths rise because breaks now pass and widths get scored.
- The one triage row left, `c-4bb3746469073e4d`: native is the history world with an item end before the CR (line 1 ends
  there), and the gap sits on line 1 at [4, 6). The scorer names line 0 as the first line that differs, because WebKit reports
  a zero-width rect for a line's first character at the end of the line before when the next box in box order starts later
  (RenderText.cpp:777-783), which depends on line 1's boxes.
- The 8 `rule/br-elements` rows of round 2's evaluation: `rule/br-elements` has 32 failing rows, `rule/hanging-white-space`
  12, all under `page-history`. Each alone in a fresh process (`sharded.ts --isolate`, 76 rows with the `rule/controls` ones):
  lineCount 76 of 76, breaks 76 of 76; the 32 widths that still fail alone are the `rule/controls` float32 steps.

Fresh sets (`bun rebuild/lab/fresh.ts --browser=webkit-host --seed=<seed>`, file order, about 11,200 cases each: runs, ws,
policy, a 3,000-case suite sample and the family paragraphs at new widths):

| Seed | Library | Cases | lineCount / breaks / widths fail | Prediction failures | Open | Classes |
|---|---|---:|---|---:|---:|---|
| `r3-webkit-1` | page-history worlds, letter spacing, simplified measuring | 11,235 | 23 / 67 / 159 | 226 | 1 | a float32 step after a moved box (below) |
| `r3-webkit-2` | + controls, canvas-language, shaped runs | 11,216 | 22 / 66 / 187 | 253 | 0 | none |
| `r3-webkit-3` | + zero-width characters draw no font's glyph | 11,221 | 27 / 78 / 187 | 265 | 0 | none |
| `r3-webkit-4` | final (clusters, spacing facts, TAB order) | 11,198 | 26 / 90 / 154 | 244 | 0 | none |
| `r3-webkit-5` | final | 11,184 | 26 / 81 / 152 | 233 | 0 | none |

- `r3-webkit-1` under round 2's library: 24 / 70 / 160, 230 prediction failures, 10 open: 9 widths rows of
  `suite/U+001E/middle`, `suite/U+001F/middle`, `suite/U+000C/middle` and `suite/glue` where only the line's sum is off (the
  classes above, not traced one by one), and the row below. Under the final library: 19 / 57 / 135, 192 failures, 1 open.
- The open row, `c-653ac96abf5487ff` (`runs/lang-spans`): line 1's Hangul node is 2.7px wider natively (`canvas-language`
  covers it), which moves the next node. That node's width is the same in the engine, 60.336002349853516px; FloatQuad's
  bounding box reports f32(f32(x + w) - x), 60.33599853515625px at the predicted x and 60.33601379394531px at the native x.
  No gap concerns the node, so scorer 5 counts it open: an observation consequence of the covered node, not a class.
- `page-history` under the fresh sets, which ran one order: the 79 failing cases of `r3-webkit-3` it covers ran each alone in
  a fresh process. lineCount 79 of 79 pass, breaks 76, widths 59; the 19 that still fail alone are also under
  `canvas-language`, `control-character-width` or `letter-spacing-ligatures`.
- Installed Safari, spot check (`r3-webkit-5`'s runs, ws and policy, 5,184 cases in two parts of 44 s and 90 s,
  `--allow-safari-frontmost`): lineCount 12, breaks 50, widths 117 failing, 167 prediction failures, 0 open, and the three
  statuses equal webkit-host's on all 5,184 cases.
- Painter-only failures without a covered explanation rose on `r3-webkit-1` from 312 to 772 as the conditions narrowed: most
  are painted extents under 0.01 units off (69 Amiri Latin, 31 Helvetica Neue), which `simplified-measuring` and
  `letter-spacing-ligatures` used to sit on. Painter owner.

### Costs

measureText calls per paragraph on the development combined file, mean / median / p90 / p95 / max: round 2 17.7 / 8 / 37 /
56 / 2,069; final 37.2 / 12 / 102 / 120 / 2,273. Prediction time per paragraph in webkit-host: mean 0.10 ms to 0.33 ms (2.5 s
to 8.3 s over the file). The additions are all condition work, not layout: the named-family test of `canvas-language` (three
totals per distinct character of a box whose list holds a locale-resolved family), the glyph counts of letter-spaced boxes
(two totals per string, grapheme cluster and merged pair), the pair adjustment tests around VT, FF and CR, and the split
parts and second layouts of history worlds. Not reduced: performance is deferred.

### Open

- `canvas-language` under Han, kana and Hangul locales still fires on every such character (16% of passing lines on fresh
  sets). What would close it: the per-language cascade of the OS as a given fact, or a connected `<canvas>` with `lang`
  (SUPERSET-webkit §3.3, a maintainer decision). Under ko the fallback for Han and kana is Apple SD Gothic Neo in every probed
  list (R3, R3b); a recipe that names it would predict most of the 130 ko rows, as a platform table.
- Pair adjustments inside a separated ligature pair, and the float32 order of pieced control widths and shaped run sums, are
  stand-ins under their gaps. A `FontFace` of `local()` with `font-feature-settings` would give Canvas the DOM's features
  under letter-spacing; it is font loading, outside the charter's boundary, and wasn't tried.
- The locale also reaches shaping (applyTransforms and the complex path's string attributes take computedLocale), so a named
  font with language-specific lookups can shape otherwise under a locale than in Canvas. No lab row shows it; no condition
  reports it.
- `page-history`'s worlds vary one box at a time, and the glyph geometry cache (TextMeasurementCache, shared by the simplified
  path, the fixed-pitch path and WidthIterator under one key, sampled) is a second process-wide cache; with the
  simplified-measuring result above its three writers agree except on a shaped space, and no row shows it.
- Registry: `webkit/measure/word-spacing-in-js` is retired for `webkit/measure/word-spacing-in-context`, and round 3's rules
  are registered and annotated in source (`// rule <id>`).

## 2026-09-17: ceiling round 2 (line-local gaps)

### What changed

The round 2 definition covers a failing line only with a gap on that line or on the break decision that ended the line
before it (lab/README.md, "Line-local gaps"), and round 1's WebKit gaps were all on the paragraph. Every condition of the
content and fonts is now reported on the lines whose filling measured the characters it concerns, with `at` naming them;
the paragraph keeps only `page-zoom`.

- **Which characters a line concerns** (`lineGaps`, engines/webkit/gaps.ts since X1). The items from the line start to the end of
  the last candidate content the builder formed: the placed content and the content whose fit ended the line, which the
  next line starts with. The builders record how far they read (`measuredEnd`), where the last candidate began
  (`decisionStart`), whether InlineContentBreaker ran on it (`overflowStart`) and whether they rebuilt the line back to an
  earlier wrap opportunity (`reverted`).
- **Conditions narrowed from source, per line:**
  - `control-character-width`: a measured CR on the simple font code path, or another Cc (specs/webkit-text.md §5.3).
  - `tab-stops`: a measured TAB where tabs are allowed.
  - `letter-spacing-ligatures`: two adjacent measured characters that aren't white space or controls, in a box with letter
    spacing. liga, clig, dlig and hlig replace at least two glyphs and the DOM turns them off
    (ComputedStyleBase.cpp:324-331, UnrealizedCoreTextFont.cpp:258-264); Canvas keeps them and shows no ligature apart from
    kerning.
  - `canvas-language`: every measured character of a box with a locale whose fonts depend on it, or its Han, kana and Hangul
    characters where only system fallback does. **Corrected reading:** serif, sans-serif, cursive, fantasy and monospace
    resolve through CoreText's per-locale families whenever the locale's script isn't Common
    (FontDescription::platformResolveGenericFamily, FontDescriptionCocoa.cpp:77-118, called first by
    CSSFontSelector::resolveGenericFamily, CSSFontSelector.cpp:334-353). The port had read only -webkit-standard as per
    script, so Latin in `serif` under `ja` had no gap (`c-dfa5a082c19b5785`: native `語f` 23.904px, predicted 23.994px from
    Times).
  - `simplified-measuring`: a measured string of a simplified-path box outside the width shortcut that holds U+0020, or whose
    Canvas total isn't the float32 sum of its code points' advances in order. The DOM's simplified path sums the shaped
    advances in one loop (FontCascade.cpp:381-412); WidthIterator sums unshaped advances, adds what shaping moved and
    restores every character treated as a space to its unshaped advance (WidthIterator.cpp:84-120, :473-474), so the two
    agree where shaping moved nothing. Canvas can't show a space's shaped advance.
  - `fixed-pitch-path`: an item failing test T1 while `monospace` is null, and now also while `primaryFamily` is null in a
    fixed-pitch box: whether the realized family is Courier New decides the width shortcut (FontCoreText.cpp:776-782), and
    the first listed family only stands in for it (research/ROUND1-CRITIC.md item 8).
  - `font-fallback`: a measured code point as wide as LastResort's box in a box taking the width shortcut.
  - `string-storage`: keep-all punctuation in Latin-1 text (BreakablePositions.h:257-274, :292-299), or an emergency break in
    Latin-1 text whose second unit can't start a line (InlineContentBreaker.cpp:143-157), reported where the break is taken.
  - `ui-language`, `dictionary-breaks-unavailable`, `dictionary-breaks-stand-in`: the measured characters the condition
    reads (the box of a Han locale, its quotes, its dictionary ranges).
  - `page-history` (below).
- **`page-history` from the break position cache's key.** TextBreakingPositionCache stores a box's item ends after its bidi
  splits under (content, TextBreakingPositionContext, origin), for boxes of at least 5 units and 3 items, and a later box
  with the same key builds its items from those ends, then takes its own bidi splits (InlineItemsBuilder.cpp:858-924,
  1082-1148; TextBreakingPositionCache.h:41-42). The context holds white-space collapse (preserve and break-spaces share a
  value), overflow-wrap, line-break, word-break, nbsp mode and locale (TextBreakingPositionContext.h:30-80). So another box
  of the same text can differ only by its bidi splits and by how it splits preserved white space. Each box records:
  - the level boundaries its text gets under either paragraph direction and one or two characters of context standing for
    each resolved class UAX #9's rules read across its edges (sos and eos with L1, L, R, AL, EN alone or after L or R, AN),
    less the ends its items already have (`historyEnds`, content.ts `collectHistoryFacts`);
  - preserved white space of two units or more (`historyWhitespace`).
  A line reports the gap where such an end falls inside a measured item and either the parts measure otherwise than the
  whole, or the item is content whose fit ended the line (or the builder reverted over it): an extra end is a wrap
  opportunity there (endsWithSoftWrapOpportunity, InlineFormattingUtils.cpp:336-355). For white space the whole run of the
  box's white-space items counts, in both directions. Round 1 reported the gap for any box with strong RTL content or an RTL
  block, and missed Latin text laid out after an RTL box of the same text. The contexts are a declared approximation of
  "every context": longer contexts aren't enumerated.
- **Observation port.** A text box shaped across inline boxes is limited under `rtl-shaping-across-inline-boxes`, the gap
  its line reports, instead of `in-word-prefix`.

### Runs

Scorer 4 throughout. Native runs of the round 1 combined files in webkit-host with the first round 2 library, file order and
reverse (`<set>-forward-r1`, `<set>-reverse-r1`, 12:51 to 13:11, every row observed, no native, prediction or painter
error), scored forward against reverse. The last two source corrections (generic families by locale; decision content from
where the last candidate began, only where it overflowed; white-space runs in both directions) change gaps and not
predictions, so they ran predict-only against the r1 native rows (`<set>-predict-p2`, history flags from r1). Cells are
cases, history-dependent cases, prediction failures, and lineCount / breaks / widths failures without a line-local gap.

| Set | Cases | History-dependent | Prediction failures | Without a line-local gap: round 1 re-scored | r1 | p2 |
|---|---:|---:|---:|---|---|---|
| development combined file | 25,180 | 96 | 209 | 25 / 75 / 131 | 0 / 1 / 4 | 0 / 0 / 0 |
| held-out 09-16 combined file | 15,205 | 144 | 266 | 43 / 88 / 176 | 0 / 1 / 2 | 0 / 0 / 1 |
| rule and feature families (7 protocol rows) | 21,734 | 6 | 525 | 78 / 145 / 194 | 14 / 14 / 0 | 0 / 0 / 0 |

- **p2 against r1:** 0 lineCount, breaks or widths transitions on any set. The painter transitions (development 1 lost, 11
  gained; held-out 2 lost, 10 gained; families 4 gained) came with the painter owner's working-tree changes to paint.ts
  between the runs; the WebKit changes don't move geometry.
- **Failures r1 left uncovered, attributed:**
  - `runs/lang-spans` `c-accaa5a60eb82121`, `c-bd0a609e0aec120b`, `c-295b6c791fc3f4e9`, `suite/keep-all` `c-dfa5a082c19b5785`,
    held-out `policy/zh-lang` `c-c63614c0ae195f5d`: `serif` under a Han, kana or Hangul locale draws Latin and punctuation
    from CoreText's per-locale family (`‘` 3.744px against Times' 5.328px; `¥` 13.84px against 10px). Generic families by
    locale, above.
  - `suite/glue` `c-cf7bb1ee29b5b4cf` and held-out `c-67cd9bd538cb3e95` (`ب` SHY `ب` NBSP `x` in an RTL block): the cached end
    at 3 sits inside [2, 4), placed on line 1 as part of the candidate [2, 5) whose overflow ended the line. Decision content
    from where the last candidate began.
  - 14 `rule/br-elements` cases (`c-178367f98108fb03`, `c-06105f785157b4bd`, `c-3403348a57059e54` traced): `xx aaaa␠␠⇥<br>`
    under break-spaces keeps `aaaa␠␠⇥` on one line natively, the run whole as a pre-wrap box of the same text cached it; the
    port splits per space, and line 1's overflowing item [8, 9) belongs to the run [7, 10) that starts before it. White-space
    runs in both directions.
  - held-out `runs/word-spacing-spans` `c-064c3e678034473f`: not a gap. Line 8's box `ه` NBSP in a span with 16px word
    spacing measures 26.596744537px, native 26.596746444px, one float32 step: WebKit adds word spacing per character inside
    its float32 loop, the port added it to the Canvas total afterwards. Same class: development `c-4303efdc328a680d`,
    `c-a797931f634f8091`, held-out `c-d6f5ad1dde30cfa1` (letter- and word-spaced lines, covered by `letter-spacing-ligatures`
    on their lines). Recipe change below.
- **Weak gaps, case-level lift (share of failing cases over share of all-pass cases), r1 then p2:**

  | Gap | Development | Held-out 09-16 | Families | Round 1 re-scored, all three |
  |---|---|---|---|---|
  | `page-history` | 3,552 reports, 3.11; 3,689, 2.99 | 2,378, 3.09; 2,483, 2.99 | 809, 7.60; 825, 7.98 | 13,692, 0.35 |
  | `canvas-language` | 5,645, 3.48; 11,361, 1.71 | 2,741, 3.35; 2,773, 3.32 | 3,828, 1.39; 3,828, 1.39 | 12,213, 2.30 |
  | `simplified-measuring` | 4,955, 0.46; 4,955, 0.46 | 2,101, 0.70; 2,101, 0.70 | 11,476, 0.39; 11,476, 0.39 | 22,367, 0.52 |
  | `letter-spacing-ligatures` | 2,501, 0.95 | 1,939, 0.74 | 2,360, 2.19 | 7,377, 1.41 |
  | `control-character-width` | 1,176, 0.74 | 3,793, 0.91 | 336, 28.63 | 5,312, 2.89 |
  | `string-storage` | 111, 0 | 131, 0 | 32, 0 | 1,264, 0.28 |

  Failures covered only by gaps below lift 2 over development and families r1 together: lineCount 45, breaks 107, widths
  186 (`canvas-language` 19 / 68 / 152, `letter-spacing-ligatures` 17 / 25 / 12, `simplified-measuring` 8 / 8 / 0). See Open.
- **c-90c2ca856ed4ab91** (`بِبِ((tail` SHY `word`, Amiri 24px, 24px wide; round 1 critic item 3): alone in a fresh document
  the ceiling library passes lineCount, breaks and widths (`c-90c2ca856ed4ab91/`); the charter-era native lines (`بِ((` /
  `tai`) came from the document it ran in. Lines 0 and 1 report `page-history` at 6. The painter fails with a wrapped line
  (painter owner).
- **Feature rows:** `c-303d850e42b725dd`, `c-32a0d43aea9861a7` and the accidental pass `c-9863334967bab8a9` are protocol rows
  under scorer 4.

### Word spacing in the Canvas context

WebKit adds word spacing inside WidthIterator's per-character float32 loop (calculateAdditionalWidth: after SPACE, LF, NBSP
and TAB without tabs, past the TextRun's index 0 unless NBSP; the complex text controller likewise per glyph,
ComplexTextController.cpp:790-845). The port measured a Canvas total without word spacing and added the spacing to it,
another float32 order, which moved line widths by one float32 step on letter- and word-spaced lines. OffscreenCanvas's
setWordSpacing gives the context's FontCascade the spacing (CanvasRenderingContext2DBase.cpp:3299-3324), so each box with word
spacing now measures in a context that carries it (`spacedContext`); only strings split at TABs, whose parts start past the
DOM's index 0, add it in JS. This replaces the registry's `webkit/measure/word-spacing-in-js` for strings without TABs
(rules.json belongs to the tests owner).

- Development combined file, predict-only against the r1 native rows (`dev-all-predict-p3`): widths 0 lost, 2 gained
  (`runs/word-spacing-spans` `c-4303efdc328a680d`, `c-a797931f634f8091`, which now pass every metric); lineCount and breaks 0
  transitions; prediction failures 209 to 207, none without a line-local gap.
- Held-out 09-16 combined file (`heldout-all-predict-p3`): widths 0 lost, 1 gained (`c-d6f5ad1dde30cfa1`, every metric passes);
  `c-064c3e678034473f`'s line 8 now equals native, and its widths are unobserved (line 4, a TAB box, isn't spanned by the
  expected node rects); lineCount and breaks 0 transitions; prediction failures 266 to 264, none without a line-local gap.
- Painter transitions against r1 (development 1 lost, 13 gained; held-out 3 lost, 11 gained) include the 3 word-spacing gains;
  the rest came with the painter owner's paint.ts changes (12:51 r1, paint.ts changed again at 13:22, before held-out p3):
  `c-3ef09a2630650b9b` has no word spacing.

- Rule and feature families (`families-all-predict-p3`; 540 of their cases have word spacing, `rule/following-space` among
  them): 0 transitions on lineCount, breaks and widths against r1; painter the same 4 gains as p2; prediction failures 525.

With p3, prediction failures without a line-local gap are 0 / 0 / 0 on the development and held-out 09-16 combined files
and on the rule and feature families.
- measureText calls per paragraph on the development combined file, mean / median / p90 / p95 / max: round 1 evaluation 15.1
  / 7 / 33 / 50 / 2,059; round 2 r1 17.7 / 8 / 37 / 56 / 2,069; p3 the same as r1. The line-local conditions add about 17% on
  the mean (code point singles for `simplified-measuring`, split parts for `page-history`, T1 widths); the spaced context adds
  nothing measurable.

### Open

- **Three conditions stay weak because WebKit's OffscreenCanvas can't show what they concern.** On the development combined
  file's r1 rows (88,384 engine lines, 25,084 cases outside history dependence, 209 failing a prediction metric),
  `simplified-measuring` is on 15,995 lines of 4,955 cases (19 failing), `letter-spacing-ligatures` on 6,741 lines of 2,501
  cases (20 failing), `canvas-language` on 17,033 lines of 5,645 cases (166 failing).
  - A space's shaped advance: WidthIterator restores it before Canvas reports a total (WidthIterator.cpp:103-117), so the
    simplified path's kept advance has no Canvas reading, and every simplified-path string with U+0020 reports the gap.
  - Which pairs a font ligates: Canvas keeps liga, clig, dlig and hlig under letter spacing and has no setting that turns
    them off, and a pair total differs from its parts by kerning too.
  - The locale's fonts: OffscreenCanvas has no locale attribute, so no measurement shows a locale-chosen font.
  Each would close with an explicit input (a font fact, a per-locale realized family) or with a maintainer decision on a
  connected `<canvas>` (SUPERSET-webkit §3.3); neither is an engine change.
- **`page-history` contexts.** The level boundaries come from a declared set of one- and two-character contexts, standing for
  the resolved classes UAX #9 reads across a box's edges; longer contexts aren't enumerated.
- **`contentWidth` unobserved by a scorer rule** (CHARTER known deviations, tentpole 2): unchanged.
- Installed Safari: not run by the WebKit owner; webkit-host stands in (lab/WEBKIT-HOST.md).

## 2026-09-17: stage 5 (inline structure, line slots, alignment)

### What changed

- **Input.** `prepare` walks `indexContent(paragraph)`. Each text box takes its parent's computed style, and every site
  that read the block's style now reads the box the source reads (webkit audit F1): the item's own style
  (`trailingWhitespaceType`, `appendText`, `wordBreakBehavior`, `isBreakableRun`, `lastValidBreakingPosition`), the layout
  box parent's (`isAtSoftWrapOpportunity`, `shouldWrapUnbreakableContentToNextLine`, the wrap opportunity list), the
  nearest common ancestor's (`InlineFormattingUtils.cpp:357-383, :436`), the next box's (`mayBreakInBetween`) and the root's
  (the simple builder, `handleLineEnding`).
- **Text renderers.** `textRendererIsNeeded` over the tree: previous child renderer, a `<br>` before white space, a span
  parent (`RenderTreeUpdater.cpp:536-595`).
- **Items.** Inline box start and end, atomic inline, hard line break and word break opportunity items
  (`InlineItemsBuilder.cpp:1053-1078`), with their bidi paragraph entries (U+FFFC, LF, opaque; `:568, :596-618, :730-774`).
- **Box edges.** Inline box start and end widths as LayoutUnit sums of margin, border and padding
  (`InlineFormattingUtils.cpp:320-324`; `LayoutIntegrationBoxGeometryUpdater.cpp:231-306`; borders snapped as border widths
  to device pixels, `StyleLineWidth.cpp:46-61`). `appendInlineBoxStart` and `appendInlineBoxEnd` with the hanging reset,
  negative margins and the letter-spacing stack (`InlineLine.cpp:289-344`). Decorated boxes are contentful
  (`InlineLine.cpp:989-1008`, `InlineLineBuilder.cpp:64-78`).
- **Atomic inlines, `<br>`, `<wbr>`.** `appendAtomicInlineBox`, `appendLineBreak`, `appendWordBreakOpportunity`
  (`InlineLine.cpp:558-602`), candidate content and trailing opportunities (`InlineLineBuilder.cpp:141-192, :1030-1170`),
  `nextWrapOpportunity` (`InlineFormattingUtils.cpp:456-544`), the atomic branch of `processOverflowingContent`
  (`InlineContentBreaker.cpp:263-299`). The simple builder takes `<br>` (`TextOnlySimpleLineBuilder.cpp:80-94, :488-497`).
- **Builders.** Simple and range-based eligibility over the style records (`TextOnlySimpleLineBuilder.cpp:488-528`,
  `RangeBasedLineBuilder.cpp:36-39, :131-184`), and the range-based builder's leading and trailing inline box runs
  (`:48-126`).
- **Line slots.** The line rect from the slot's insets through `floatAvoidingRect` (`InlineLineBuilder.cpp:432-478,
  :1185-1216`); a float-constrained line counts as having content (`:1454-1455`), so content that doesn't fit beside the
  floats places nothing and the line moves below them (`below-floats`, `InlineFormattingUtils.cpp:54-103, :286-289`). Floats
  make the content ineligible for the simple builders, so every line from the first slotted one uses LineBuilder
  (`WebKitLineStart.hasFloats`). The lab protocol puts the slot floats before the content, so the paragraph's first build
  places them itself (`tryPlacingFloatBox`, `:1329-1400`): they narrow the line afterwards, and `m_lineContentEdgeOffset`,
  which tab stops read, stays the indent alone (`:478`, `:1394-1396`). A later build finds them in the formatting context.
  A refused first build returns `below-floats` with `next`, its start with `hasFloats` set (additive `LineResultOf` field
  and `fillLines` change, SHARED-CHANGES.md).
- **text-indent.** A start margin on the first formatted line, which tab stops read through `m_lineContentEdgeOffset`
  (`InlineFormattingUtils.cpp:143-179`, `InlineLineBuilder.cpp:453-478`).
- **text-align.** `horizontalAlignmentOffset` with text-align-last auto (`InlineFormattingUtils.cpp:198-276`) in both
  builders, and `align` on the line. `justify` through `InlineContentAligner` (below).
- **Geometry.** `lineLeft`, `contentEdgeOffset`, `alignmentOffset`; `inline-box`, `atomic` and `line-break` display boxes
  from `processNonBidiContent` and the line box builder (`InlineDisplayContentBuilder.cpp:504-645`,
  `InlineLineBoxBuilder.cpp:440-540`), and on bidi lines from `processBidiContent`'s display box tree (below).
- **Fragments.** `box-start` and `box-end` for every span (spanning starts carry none), `atomic`, `br`, `wbr`.
- **Observation port** (`lab/observe/webkit.ts`). Walks the tree; per-leaf Canvas settings from the leaf's parent style;
  element rects: a span's inline box per line (`RenderInline::absoluteQuads`), an atomic inline's frame at its truncated
  LayoutUnit location (`RenderBox::absoluteQuads`, `InlineDisplayContentBuilder.cpp:632-640`), a `<br>`'s line break box
  (`RenderLineBreak.cpp:97-105`), nothing for `<wbr>` (no display box). A `wbr` fragment's line and an atomic inline's
  margins are listed as unobservable. A box's `xPos`, which only tab stops read, is its position from the content box less
  the display line's `contentLogicalLeft`, the root inline box's left inside the line box: the alignment offset alone
  (`InlineIteratorBoxModernPathInlines.h:38-60`, `InlineDisplayLineBuilder.cpp:134-160`, `InlineLineBoxBuilder.cpp:63`).
  The port had subtracted the slot insets and text-indent too.
- **Gaps.**
  - `font-fallback` where the fixed-pitch coverage test meets a code point exactly as wide as LastResort's box, where the
    recipe can't tell (research/CHARTER-CRITIC.md item 1).
  - A quoted family name no longer counts as a generic keyword for `canvas-language` (CHARTER-CRITIC item 9).
  - `page-history` now follows the break position cache's key from source (below).
  - `rtl-shaping-across-inline-boxes` is reported per line where LineBuilder shaped a range, no longer for the paragraph
    (below, *Text shaping across inline boxes*).
- **Process languages.** `preferredLanguages` and `icuDefaultLocale` are read where the source reads them (Han locales,
  quote overrides). `contentLanguage` is never the root locale here: the model's block always carries a `lang` attribute,
  and `Element::effectiveLang` reads Content-Language only without one (CHARTER-CRITIC item 10).

### Flat parity

Forward runs with the stage-5 library, scored, against the previous forward runs (smoke: the lab foundations run with
process languages; the others: the charter evaluation). Cells are pass / fail / unobserved, and widths add not-applicable.

| Set | Rows | lineCount | breaks | widths | painter | Transitions |
|---|---:|---|---|---|---|---|
| smoke | 300 | 299/1/0 | 297/3/0 | 287/5/5/3 | 263/32/5 | 0 lost, 0 gained |
| ws | 1,019 | 1019/0/0 | 1019/0/0 | 1017/2/0/0 | 993/26/0 | 0 lost, 0 gained |
| policy | 1,606 | 1605/1/0 | 1599/7/0 | 1558/21/20/7 | 1451/139/16 | 0 lost, 0 gained; `ui-language` 103 → 0 |
| runs | 2,580 | 2571/9/0 | 2530/50/0 | 2317/83/130/50 | 2240/221/119 | 0 lost, 0 gained |
| suite sample | 19,933 | 19912/21/0 | 19887/46/0 | 19750/48/89/46 | 18810/1045/78 | lineCount 1, breaks 7, widths 10 lost; 0 gained |

- Prediction errors 0 and observation errors 0 in every set.
- **Rerun with the final library** (`<set>-forward-r2/`, after justify, bidi geometry, `font-fallback` and the
  `page-history` condition): the same counts on every set and 0 transitions against the first stage-5 runs. No failing
  case reports no gap. `page-history` now fires on smoke 40, ws 38, policy 44, runs 756 and suite sample 4,526 rows (the
  source condition, not narrowed by counts); `font-fallback` on none.
- **Rerun after the shaping port and the slot fixes** (`<set>-forward-r5/`, smoke, ws, policy and the suite sample, against
  r2 and the suite sample's r3): 0 transitions on every metric, and no failing case without a gap. Flat cases have no
  slots or indent, so the tab-stop fixes can't move them; the shaping port moved `runs` only (below).
- **The suite sample's losses are page history.** On all 7 cases the prediction is the charter's to the bit, and the
  native geometry differs between the two runs: `c-10045fce207d89e7` and `c-b87d5d950d1bc9e2` (`straight-double`, observed
  after other cases), `c-2a0af46d56e09079`, `c-80023476b04ec0a6`, `c-b52e18f58d0c2974`, `c-d2e3af1d49858fb5`
  (`U+001C`/`U+001E` middle) and `c-5c68643afc1d77d8` (`spacing-hanging-NBSP`). No reverse run was made this round, so
  the forward rows don't mark them.

### Feature probes

`.artifacts/lab/webkit-stage5/probe-features/`: 92 tree cases in 16px Arial and Menlo (box edges at wrap points, border
and margin, negative margin, nested spans, nowrap in wrap and wrap in nowrap, atomic inlines next to text, NBSP, CJK and
spaces, `<br>` after white space and inside a decorated span, `<br>` under pre-wrap, `<wbr>` under keep-all and nowrap,
positive and negative text-indent with tabs, end, center and right in RTL, pre-wrap with end, slots on either side, slots
too narrow for a word, RTL slots).

- lineCount 85/0/7, breaks 85/0/7, widths 57/0/28/7, painter 57/0/35: **no failures**. Unobserved lines hold only an
  atomic inline, or box edges or an atomic inline at a line end, which the scorer's node-rect widths can't span.
- **Element rects**, compared offline exactly: 64 equal and 7 differ in the first run, from two port bugs since fixed:
  - a negative margin start stays inside the inline box's rect (`InlineLineBoxBuilder.cpp:482-487`): native x −5, width
    19.27;
  - an atomic inline reports its renderer's frame, whose location is the display box's truncated to a LayoutUnit:
    22.234375 for 22.2421875.
- The rerun with both fixes (`run-r2/`) gives the same metrics, and all 67 element rects equal native to the bit: spans 40,
  atomic inlines 15, `<wbr>` 8 (none reported, none expected), `<br>` 4.

### text-align: justify

Ported after the first probe round: `applyRunBasedAlignmentIfApplicable` with text-align-last auto (InlineLineBuilder.cpp:
679-704), hanging trailing white space detached into its own run (InlineLine.cpp:235-241, :918-941),
`InlineContentAligner::computedExpansions` and `applyExpansionOnRange` (InlineContentAligner.cpp:150-267),
`FontCascade::expansionOpportunityCount` with ideographs on Cocoa (FontCascade.cpp:974-1303,
cocoa/FontCascadeCocoaInlines.h:34-37). Display boxes carry `expansion` and `expansionBehavior` (additive model field,
SHARED-CHANGES.md), and the observation port places the expansion among a box's glyphs as the complex text controller
does (ComplexTextController.cpp:107-118, :673-696, :800-845).

Probe round r3 (`run-r3/`, 109 cases with 17 justify cases: plain, pre-wrap with runs of spaces, RTL, CJK under `zh`, a
decorated span, an atomic inline, `<br>`): lineCount 102/0/7, breaks 102/0/7, widths 72/0/30/7, no failures. In the
justify cases every predicted and limited value equals native, code point edges inside expanded boxes included. All 73
element rects are equal. Painter 3 failures, all `align-justify-pre-wrap`: the painted line's extent differs (painter
owner).

### Bidi lines with inline structure

Ported after the justify round, replacing the `UnportedFeature` throws: `processBidiContent` with
`processBidiLinesWithNoContent`, the display box tree of `ensureDisplayBoxForContainer`, `adjustVisualGeometryForDisplayBox`
and `closeInlineBoxes` (InlineDisplayContentBuilder.cpp:713-1088).

Probe round r4 (`run-r4/`, 129 cases with 20 bidi cases: RTL spans with padding, margins and borders, RTL atomic inlines,
`<br>` under RTL, Latin spans in RTL blocks, Hebrew spans and atomic inlines in LTR blocks, an empty decorated span, nested
spans): lineCount 120/0/9, breaks 120/0/9, widths 83/0/37/9, no failures. In the bidi cases every predicted and limited
value equals native, and all 95 element rects of the round are equal.

### Observation port: negative Canvas stand-ins

The rows' `facts.predicted` count values the ported rules claim to give exactly. In the r2 runs 515 suite sample cases
(732 values) and 172 runs cases (906 values) had a predicted value that differed from native, 121 suite cases without any
gap: `U+200D/middle` 70, `U+200D/end` 50, `maintained/accuracy` and others. The partial rect of a code point at a box
edge kept its x on the edge only while its in-context advance was non-negative, and the Canvas stand-in, a prefix
difference, went negative where a joining form or a fallback font measured alone is narrower (`ب` ZWJ, `ريال` in Courier
New). In-context advances are glyph advances plus non-negative spacing and expansion (ComplexTextController.cpp:740-845),
so a negative stand-in is the stand-in's error: it now clamps at 0 unless spacing is negative.

r3 (`runs-forward-r3/`, `suite-sample-forward-r3/`): 0 metric transitions; predicted-value differences down to 93 suite
cases (226 values) and 136 runs cases (868 values), every one reporting a gap: `original-vs-reshaped-admission` and `glue`
page history 25, `canvas-language` 16, `control-character-width` 18, `simplified-measuring` 14, `letter-spacing-ligatures`
10 and a few with several.

### Text shaping across inline boxes

`TextShapingAcrossInlineBoxes` is on by default (UnifiedWebPreferences.yaml:8489-8501, InlineFormattingContext.cpp:569-570),
so LineBuilder shapes complex RTL text of one font joined over undecorated inline box edges as one run
(`applyShapingIfNeeded`, `collectShapeRanges`, `applyShapingOnRunRange`, `shapePartialLineCandidate`,
InlineLineBuilder.cpp:780-1028; the run splits of `Line::appendText`, InlineLine.cpp:399). The port had only a paragraph
gap for it, and the charter's rule families failed 194 `rule/joining` cases under it (`c-0c565437ddc97aaa`: Geeza Pro
`بب ببب ببب بب` over two spans, native line 110.918px, predicted 119.175px from separately measured items).

Ported: the ranges and their eligibility from source; a run's share is the Canvas prefix difference of the joined text in
the plain context (glyphAdvancesForTextRun sums CoreText base advances without letter spacing,
ComplexTextController.cpp:186-205). Canvas positions glyphs otherwise than those base advances, so even the range total can
differ: in `c-d03f94e8fb53e7e2` (Geeza Pro 16px, `الرَّحِيمِ|السلام` over two spans) WebKit's shares equal the separately
measured words and the joined Canvas total is 0.51px wider. The line reports
`rtl-shaping-across-inline-boxes` where a range was shaped (the paragraph-level condition is gone), and the display boxes
carry `shapedAcrossBoxes` (additive, SHARED-CHANGES.md), whose rect values the observation port marks limited.

Rule families (`families-forward-r4/`, the charter's 9,584 derived family cases), against the charter evaluation's families
run: lineCount 9458/126 (+33, −22), breaks 9376/208 (+33, −22), widths 8822/291/263/208 (+58, −0), painter 8388/995/201
(+58, −6). All changes are `rule/joining`.

- **The 22 lost line counts were accidental passes.** In every one the charter's widths failed: it measured the items
  separately, where WebKit shapes the range as one run, and its line count came out right anyway. With `line-break:
  anywhere` the lines depend on the share each character has inside the joined shaping, which Canvas can't give:
  `c-16a062eb9e8d14cb` (`بب ببب|ببب بب` over two spans in 16px Arial, 7.8px) has a native box of 0.305px for the last
  letter of the first span. Those lines report `rtl-shaping-across-inline-boxes`.
- Failures without a gap: 0 (charter 0). `rule/joining` failures under the gap: 186 (charter 194).
- runs (`runs-forward-r4/`, against r3): breaks +1, widths +2 −1, painter +2 −1, all `runs/bidi-runs`. The lost width is
  `c-d03f94e8fb53e7e2` above, under the line's `rtl-shaping-across-inline-boxes`.

### Feature families

The families owner's webkit-host derivation (`.artifacts/tests/features-20260917/webkit-host/final/`, 12,150 cases in 9
families, native rows observed in file order and in reverse). Predict-only runs under the lock, scored with
`--native-rows` from the file-order rows and `--native-compare` against the reverse rows (0 history-dependent cases):
`features-families/predict/` (the stage-5 library with the shaping port) and `predict-r2/` (after the two fixes below).

| Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| predict | 11407/38/705 | 11310/135/705 | 8241/200/2869/840 | 8270/494/3386 |
| predict-r2 | 11426/19/705 | 11416/29/705 | 8547/0/2869/734 | 8449/315/3386 |

r2 against the first run: 0 lost on every metric; gained lineCount 19, breaks 106, widths 306, painter 179, all
`rule/line-slots`.

- **Tab stops beside slot floats** (309 failing cases, all `rule/line-slots` with tabs under pre-wrap, reported under
  `tab-stops`, whose condition doesn't explain them). Only first lines with a left inset differed, by the float's share of
  a tab: `c-0289df69e0498d74` (Arial, a 40px left float, `aaaa⇥bbbb cccc⇥dddd eeee`) native box 217.88px, predicted
  213.45px from stops counted past the float. Two root causes, both from source:
  - the engine counted the first build's tab stops past the floats that build places itself (above, *Line slots*);
  - the observation port's `xPos` subtracted the slot insets and text-indent (above, *Observation port*); on later lines too
    native tab rects extend to the box end (`c-0150d8ad3497ba83` line 1: 42.66px, the port 39px), and these values are
    limited by `in-word-prefix`, so no metric showed them.
- **Left after r2** (lineCount 19, breaks 29, widths 0):
  - `rule/br-elements` 16 line counts, 24 breaks, under `page-history`: `xx aaaa␠␠⇥<br>…` under break-spaces keeps the
    overflowing white space before `<br>` natively and the port breaks it. All 24 pass alone in a fresh document
    (`isolate-br/`: lineCount 24/0, breaks 24/0, widths 12/0/12), so they are page history, although the reverse rows
    showed no difference.
  - `rule/line-slots` 5 cases (2 without a gap: `c-303d850e42b725dd`, `c-32a0d43aea9861a7`): the native floats aren't
    the declared slots. Row 0's left inset, right inset and text-indent exceed the width, so the right float doesn't fit
    beside the indented line and goes below it (`haveEnoughSpaceForFloatWithClear`, InlineLineBuilder.cpp:1317-1380), and
    every later row moves. 7 of 1,906 line-slots cases have native floats that differ from their slots, the 5 failing
    ones among them. A lab item: the scorer's slot-rows assumption doesn't compare `floats` with `lineSlots`.
- Painter failures (315): `rule/line-slots` 179 painted extents and line wraps, `rule/text-align` 80, `rule/wbr-elements`
  38, `rule/atomic-inlines` 24; painter owner.
- Unobserved (705 lines, 2,869 widths): lines holding only an atomic inline, or box edges at a line end, which the scorer's
  node-rect spans can't measure.

### Failures without a named gap

From the charter evaluation's forward per-case files (dev, held-out and families), outside page history: 15 suite cases
reported no gap (`suite/original-vs-reshaped-admission` 7, `suite/glue` 8), and MAIN-TRIAGE's 9 webkit-host facts to
learn without gaps (`suite/raw-context` 7, `suite/physical-window-terminal-seam` 2), which include SUPERSET-webkit's
unexplained case D (`c-49feb03a06bd4b90`).

- **Each alone in a fresh webkit-host process, all 17 pass lineCount, breaks and widths** (`isolate/`): the 8 glue and
  reshaped-admission cases observed in the suite rows, and the 9 triage cases. So they are page history, not port bugs.
- **The mechanism, from source.** `InlineItemsBuilder::populateBreakingPositionCache` stores a box's item ends after the
  bidi splits (`InlineItemsBuilder.cpp:1082-1148`), and a later box with the same text, wrapping styles, nbsp mode and
  locale builds its items from them (`:858-900, :936-939`). `TextBreakingPositionContext` has no direction or bidi level
  (`TextBreakingPositionContext.h:48-80`). All 17 are the same text in several directions and widths.
- **Probe** (`probe-glue/`, one document): `ب` SHY `ب` NBSP `x` in 16px Arial, `break-word`, RTL at 0, 27.78 and 40px,
  equals the prediction. The LTR variant at 27.78px, observed after the RTL ones, gives `[0, 4)` `[4, 5)` where the port
  gives `[0, 2)` `[2, 5)`: the RTL box's cached ends include 4, which splits `NBSP x` into two items at one level, and
  `endsWithSoftWrapOpportunity` returns true there (`InlineFormattingUtils.cpp:342-346`).
- **The rest of MAIN-TRIAGE's webkit-host facts** (`isolate-triage/`, 6 cases in one fresh document): `c-7fcab2c1e2e0c85a`,
  `c-da5b8181a781b719` and `c-ea243dabb9a70fe7` pass alone (page history, all reporting `page-history`). `c-0774ff114d939edf`
  (`A` CR TAB `B`), `c-af325ec8545eb5af` and `c-d1da84746a9b926a` (`😀A` FF TAB `B`) fail alone: SUPERSET-webkit §3.4's CR
  and FF kerning, reported as `control-character-width`. With the 9 above, all 15 facts to learn outside
  `letter-spacing-ligatures` are accounted for.
- **Gap condition changed.** `page-history` is reported for a box of at least 3 items and 5 units whose item ends depend
  on what the key leaves out: strong RTL content or an RTL block (bidi splits), or preserved white space split at word
  separators or per space. It replaces the narrower white-space-only condition.

### Costs

measureText calls per paragraph (`prediction.measure.calls`), forward runs with the current library, and in parentheses the
first stage-5 runs, which equal the charter's:

| Run | mean | median | p90 | p95 | max |
|---|---|---|---|---|---|
| smoke r5 | 18.6 (16.4) | 11 (11) | 49 (37) | 69 (53) | 122 (86) |
| ws r5 | 18.0 (15.4) | 11 (11) | 39 (31) | 48 (37) | 100 (72) |
| policy r5 | 17.5 (16.0) | 12 (12) | 36 (35) | 63 (47) | 123 (99) |
| runs r4 | 25.1 (22.8) | 17 (17) | 55 (47) | 76 (61) | 140 (103) |
| suite sample r5 | 13.4 (12.5) | 6 (6) | 30 (30) | 38 (38) | 2,059 (2,059) |
| rule families r4 | 7.3 | 6 | 10 | 14 | 66 |
| feature families r2 | 9.1 | 6 | 18 | 23 | 29 |

The r2 runs already cost what r5 costs, so the shaping port added nothing on flat cases. The rise arrived between the
first runs and r2 (justify, bidi geometry, `font-fallback`, the `page-history` condition). Justify and bidi geometry make no
Canvas calls on flat cases, so it most likely comes from `font-fallback`'s LastResort context, one call per distinct code
point of fixed-pitch boxes; not isolated. The tree walk adds no Canvas call.

### Open

- Slot rows whose insets and text-indent can't all fit: native floats differ from the declared slots (lab and families
  owners).
- The known gaps stand: `letter-spacing-ligatures` (721 census cases; SUPERSET-webkit §3.3 needs the maintainer's decision
  on a connected `<canvas>`), `control-character-width` for CR and FF kerning (§3.4), and SUPERSET §3.6's leftover width,
  which no longer applies: lines carry display boxes, and the scorer derives extents.

## 2026-09-16: before stage 5

The charter tables for smoke, ws, policy, runs and the suite sample, the failure classes and the gap firing rates are in
this file's git history (committed with the charter merge, 7c3fcf9) and in REPORT.md §2-§4.
