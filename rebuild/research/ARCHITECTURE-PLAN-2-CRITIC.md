# Attack on re-architecture plan 2

2026-09-18. Read-only review of the draft executable plan against `~/github/vibescript/docs/engineering.md`, the maintainer's direction of 2026-09-18, and the code.

**Paths.** Under `~/github/pretext-rebuild/rebuild/` at a5b4636, unless prefixed:
- `r4-tests:` is `~/github/pretext-rebuild-wt/tests/rebuild/`, HEAD 260392b.
- `r4-font-checks:` is `~/github/pretext-rebuild-wt/font-checks/rebuild/`, HEAD a422f9d plus uncommitted edits. Its line numbers are moving.

**What I did.** I edited nothing under `pretext-rebuild`. I ran the main tree's `lab/measurements.ts` three times, read-only, with rows decompressed into my scratchpad (no `--out`). `git status` was clean afterwards. Nothing was prototyped.

Item ids (G, D, O, F) are only numbers for reference. "The draft" is the plan under review. "The critique" is `research/ARCHITECTURE-PLAN-CRITIC.md`.

## 1. Verdict

The model holds: plain and inspected paragraphs, one `gaps.ts` per engine, a home per Canvas answer, a lab-owned row. The draft reads the engines accurately (§2).

It isn't executable as written, for five reasons:
1. Its gates describe a replay tool that round 4 has already replaced (G1). Under the real tool, every measurement step sends all of a browser's cases to "needs the browser", and the plan has no rule for that.
2. Its "safe now" prototypes rest on a record that no longer replays (§2 claim 10, §8).
3. Round 4's font-check resolver, which the plan treats as given, breaks two of the plan's own rules on arrival, and no step owns it (D4).
4. The plain path, the one apps run, is never scored in a browser for WebKit or Gecko (G3).
5. `LinePieces` leaves out facts the painter reads today (O1).

## 2. The draft's load-bearing claims, checked by reading

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Blink measuring raises gaps. `script-context` sits inside `measure16`. The probe is written onto the prepared paragraph. At letter spacing 0 it is gap-only. | True | `blink/shape.ts:98-102`, `:165-179`, `:345-354`, `:380-407`, `:458-482`. Two additions the draft needs. The gaps are raised by the JS around the lookup, so a memo hit raises them again. Geometry measuring raises into the same line list: `clustersOf` at `blink/index.ts:636-657`, `hangWidthOf` at `:565`. Both are reached from `lineOutput` at `:1283`, after `:1276-1277`. |
| 2 | About 34 Blink gap sites, and a gap-only method in the line breaker | True | `addGap(` counts are index 20, shape 13, line-breaker 1. `line-breaker.ts:707-729`. `positionBounds` (`shape.ts:837-847`) has that one caller (`:719`), and it measures. |
| 3 | Gecko threads `gaps \| null`, has six WeakMaps, and reads `m.log.contexts` as state | True, but there are six log reads, not five | `gecko/lines.ts:491`, `:608-658`. WeakMaps at `:57`, `:79`, `:320`, `:369`, `:488`, `:606`. Log reads at `:36`, `:252`, `:291`, `:411`, **`:469`**, and `prepare.ts:515`. |
| 4 | `prepareGecko` pushes gaps at 15 sites in one function of about 900 lines, and the second stretch measure is gap-only | True | `gecko/prepare.ts:629-1528`. 15 `gaps.push` sites. `:1265-1272`. |
| 5 | WebKit's `measure.ts` has no gaps, there are four fill-time sites, and the worlds build the line again | True | `webkit/lines.ts:92-93`, `:695-696`, `:1270-1271`, `:1552-1554`, `:2650-2678`. Addition: `buildLine` runs `lineGaps` itself (`:2774`). So a world's build does its own gap work today, and `:2668` reads only its range and geometry. |
| 6 | A string-keyed memo; Blink builds the string before the lookup; six `' '` sites | True | `measure/canvas.ts:59-60`, `:84-93`. `blink/shape.ts:395-397`. `webkit/measure.ts:149`, `:174`, `:200`, `:253`, `:284`, `:378`. |
| 7 | Shared code names engines | True | `src/index.ts:41`, `:50`, `:64`, `:79`, `:92`. `model.ts:5-7`, `:300`, `:350-584`, `:629-685`. `unicode/bidi.ts:53-64`. `unicode/grapheme.ts:17-23`. `paint.ts:55-56` and about 22 branch lines. |
| 8 | The width is read only at line time | True, exact lines | Plus one lab reader the draft misses: `lab/observe/webkit.ts:315`. |
| 9 | `applyJustification` writes into item results, "and `hangWidthOf` reads them afterwards" | Half wrong | `hangWidthOf` runs first (`blink/index.ts:1137`). Justification then writes `r.justification` and `r.inlineSize` (`:1143`, `:785-788`), and `itemsOf` reads them (`:912-913`). The hazard is a second output of the same decided line: `hangWidthOf` (`:555`, `:563`) would then read justified sizes. |
| 10 | "Round 3's recorded `runs` set replays offline today" | **False; I ran it** | With the record under `.artifacts/lab/round3-infra/record/` on the main tree: Chrome 11 the same, 38 different, 2,531 new questions of 2,580. Firefox 0, 0, 2,580. webkit-host 32, 615, 1,933. The record dates from 09-17 20:09, before three library snapshots. The main tree's tool also can't read the compressed rows (`measurements.ts:204`). |
| 11 | The replay's rule: layout JSON byte-equal, a new question fails | Out of date | See G1. |
| 12 | Blink rescans ICU from every line start; `UnportedFeature` is never thrown; `ruleStatus()` has no caller; `bench/page.ts` doesn't compile | True | `blink/breaks.ts:134-168`, `:139`, `:205`, with `adoptText(sub)` at `:153`. `bench/page.ts:126-133`, `:181`. |

## 3. Gates: what the offline replay can and can't prove

**G1. Tier 1 is not the tool the draft describes.**

Evidence, in `r4-tests:tests/replay.ts`:
- The compared prediction is the row layout, the observation port's expected rects, and the painter's limits (`:20-24`, `:260`).
- Questions are compared too: `Questions = { predict, observe, contexts, memoHits }` (`:91`). They are read from the library's own log (`:240`, `:260`) and compared at `:485-500`.
- There are three exits (`:696`):
  - 0: every case the same;
  - 1: a prediction changed;
  - 3: the predictions are equal but questions differ or are new, and those cases are listed for the browser (`:32-39`).
- A repeated question is answered by a recorded index. So without the memo `predict` is no longer `'all'`, and `memoHits` goes to 0.
- The trial reference holds 65,351 Chrome, 62,437 Firefox and 62,653 webkit-host cases, with 0 unfaithful. Giants are in no recorded set (`:58`).

Consequence:
- X2 and step 4 turn nearly every case into "questions changed" on purpose.
- S1's "the lab counts calls itself" and step 4's deletion of the log remove the source of `contexts` and `memoHits`.
- No file list names `tests/replay.ts`.

*Corrected text for §5, T1:*

> T1 is `bun rebuild/tests/replay.ts check`, per browser and config. Every step states the exit it expects.
> - Exit 0 is expected from S1, S2, S3, X1, X3 and the painter step.
> - X2 and step 4 expect exit 3, with 0 predictions changed and 0 new questions.
> - Under exit 3, every differing case must be classified **repeats only**: the same set of (context, string), with first occurrences per context in recorded order. Anything else fails.
> - **Dropped only** is accepted only where a step names what it drops.
>
> Step 0 changes `tests/replay.ts`:
> - it adds the classification;
> - `memoHits` leaves `Questions`, because a memo hit is a question not asked, which `predict` already shows;
> - `contexts` counts the replay's own contexts, so the tool stops reading `layout.measure`.
>
> After a step with exit 3 passes its browser runs, the orchestrator freezes the questions again:
> - it uses `freeze --force --reason`;
> - it first checks that the new reference's predictions are byte-equal to the original's;
> - predictions are never frozen again, and step 4 compares with the original reference.
>
> Why repeats are provable offline: measuring the same text again on a context returns the same bits in all three engines (`measure/canvas.ts:10-13`), and a repeat can't reorder two different strings.

**G2. Check 4's width sweep can't run under replay.** Another width measures other strings: line-edge reshapes and `breakWord` probes. The replay throws `NewQuestion` for them (`lab/measurements.ts`, `ReplayContext.measureText`).

*Corrected:*
- The first sentence of check 4 stays under replay, because it is the same width.
- The sweep runs on a deterministic stand-in Canvas (a new file). It compares a sweep on one prepared paragraph with fresh prepares.
- The stand-in must give U+200D and letter spacing an effect on widths. The earlier scratch fake skipped joiners, and would miss a home keyed too coarsely.
- Add the critique's A7.3, which the draft dropped: a Chrome predictor that fills at two other widths on the same prepared paragraph before the case's width, in both width orders. It runs at X2's exit, and its rows must equal the reference predictions.

**G3. The plain path is what apps run, and only Blink's ever reaches a browser.**
- The lab always prepares inspected paragraphs (§3.2).
- Check 2 proves that plain equals inspected under identical answers.
- It can't show that answers stay identical when fewer questions are asked.
- Order matters in Chrome's per-canvas cache. For example, `positionBounds` measures up to three offsets per candidate only for a gap (`line-breaker.ts:591`, `:719`).
- In Firefox, some answers follow the process's font state, which the library's own questions move (`gecko/prepare.ts:1360`, `:1413`, `:1506`).

*Corrected, X1 exit for every engine:*

> One forward browser run of the development sets with a plain-only predictor. It is a new file under `lab/baselines/` that returns a `LinesPrediction` (`lab/types.ts:199-205`).
> - Its line ranges must equal the inspected run's predictions.
> - Its native observations are compared with the inspected run's using `lab/compare-rows.ts`.
> - A native difference is a history effect of the smaller question set, and goes to the ledger as such.
>
> Repeat the run at step 4 and in T3.

**G4. Giants and fresh sets are not in T1.** X3's "giants' time not worse" sits on its T1 line.

*Corrected:*
- X3's gate is T1 (identity on the recorded sets) plus the giants set in the browser under the exclusive lock.
- The giants' predictions must be byte-equal to the frozen giants rows, and the time not worse.
- Step 0 records the giants for replay where the record's size allows, and says where it doesn't.

**G5. Check 5 (twins) has no stable seam, and the better half of the critique's A7 was dropped.**
- A record can't show string storage (`r4-tests:tests/replay.ts:51-54`).
- The earlier scan patched a scratch copy of `shape.ts` with a global hook.
- The replay does see twin order when a twin exists: it serves a repeated (context, string) by ask order.
- So a twin case in the recorded sets turns a reordered twin into a changed prediction, offline.

*Corrected:*

> Step 0 adds the critique's family before the freeze. The same string of 13 or more units of digits or brackets appears once after Latin and once after Arabic, in one style of a segmented paragraph, in Amiri (`blink/shape.ts:231-233`, `:279-284`). It is recorded in the sets.
>
> The scan stays a report only. It runs through a mechanical patch of a scratch copy, anchored on the `raw16Of` call in `measure16`, and it fails when the anchor is missing.

**G6. Check 8 can't run as written.**
- After step 3 the working painter takes `LinePieces`, which a row doesn't hold.
- The frozen `paint.ts` imports modules that S1 to S3 delete (`paint.ts:51-57`).
- The test document's `html()` keeps only some styles (`paint.test.ts:24-28`), so it isn't a full serialization.
- The painter's limits are already part of T1's prediction.

*Corrected:*

> - At the freeze, `bun build` bundles the frozen painter into one file.
> - The differential paints each reference row with the bundle.
> - For the working side, it replays the case, takes `linePieces`, and paints with the working painter.
> - Both paint into a recording document that serializes every attribute, style property and text node.
> - Limits are checked by T1, not here.

**G7. Check 9's "mention" needs a definition.** Shared files cite engines in comments throughout (`model.ts`, `measure/font.ts`).

*Corrected:* outside comments, a shared file may hold:
- no import path containing `engines/`;
- no string literal `'blink'`, `'webkit'` or `'gecko'`;
- no identifier matching those names.

The check covers `src/measure/` too (see D4).

**G8. Part of check 7 already exists.**
- `tests/coverage.ts` reports which rule ids are annotated in source and which unit-test pointers are stale (`:83-148`, `:180`).
- `tests/rules.json` holds 166 pointers of the form `src/engines/... .test.ts :: name`.
- WebKit has 10 `// rule <id>` annotations (for example `webkit/lines.ts:2585`, `measure.ts:121`). Blink and Gecko have none.

*Corrected:*
- The new ledger holds only what nothing tracks yet. Per engine folder, that is the multiset of source citations, probe names, and spec and DESIGN references in comments, plus every gap detail literal.
- It is a multiset so that a move passes and a deletion fails.
- Each engine step's gate adds: no new stale pointer and no lost annotated id in the coverage report.
- An owner who moves a test updates its engine's entries in `tests/rules.json` in the same commit.

**G9. The adapter's call order decides exit 0.** Today's order per line:
- Blink: fill, `lineEdgeGaps`, `itemEdgeGaps`, then hang, justification, mapping and items (`blink/index.ts:1274-1283`, `:1137-1156`). The hang measures (`:569-570`).
- WebKit: fill, `lineGaps` (`:2774`), display boxes (`:2816`), then the same three for each world (`:2683`).

§3.5 lists `fillLine`, `linePieces`, `inspectLine`.

*Corrected:*

> - Per line the adapter calls `fillLine`, then `inspectLine`, then `linePieces`.
> - `inspectLine` keeps today's internal order.
> - A refused slot gets `inspectLine` only.
> - Check 3 still asserts that results don't depend on the order.

## 4. Against the direction and the guide

**D1. Blink's stored raw gap calls per entry are a cache of derived data, there for the lab path's speed.**

Guide: "Avoid caching", "derived data should be computed and then gone".

The capture mechanism is the most intricate one in the plan:
- a capturing sink;
- nested captures;
- replay of the captured calls on every read.

It serves only inspected paragraphs, which only the lab prepares.

*Simpler variant:*
- On an inspected paragraph a home never short-circuits. The computation runs on every read and raises its gaps as it goes. This is today's code path without the memo (`shape.ts:380-407` raises again on a memo hit already).
- On a plain paragraph the same code returns the stored number, and the sink is null.
- There is one branch, in the home's accessor.
- The cost is repeated Canvas calls on the lab path, which Chrome answers from its whole-string cache (about 0.2 µs each, `perf-mvp-20260917/REPORT-2.md:31`).
- X2's exit 3 already covers the repeats.

*Corrected text:*

> X2's Blink prototype builds both variants against the replay.
> - Both must give byte-equal predictions.
> - Take the recomputing variant, unless the inspected path's time on the development sets more than doubles.

**D2. "`Float64Array` with a filled mask" is a container chosen for speed before profiling.**

*Corrected:*
- A home is an array indexed by text offset.
- Its entries are `Entry | null` records holding the facts that are computed together.
- Separate arrays are used only for facts filled at different times.
- Typed arrays move to §8. The Int32 overflow note moves with them, because it matters only there.

**D3. The measurer is a caller's page-lifetime value in §3.1 and §3.6, while §7 and §8 say sharing is unproven.**
- Chrome's first shaping of a word wins per canvas.
- The replay header expects one measurer per paragraph (`r4-tests:tests/replay.ts:55-56`).

Guide: "Resist future-proofing".

*Corrected:*

> - `prepare(paragraph, env, inspect)` makes the paragraph's measurer and keeps it on the prepared paragraph, as `src/index.ts:40` does today.
> - No function takes a measurer.
> - The Page stage holds the environment only.
> - A caller-owned measurer arrives with §8's proof.

**D4. Round 4's font-check resolver breaks two of the plan's rules on arrival, and no step owns it.**

Evidence:
- `r4-font-checks:src/measure/font-checks.ts` tests `engine === 'gecko'`, `'webkit'` and `'blink'` inside `learnedFacts`, and tests `env.engine` in `withLearnedFontFacts` (about `:249-267`, `:290-291`).
- It keeps answers in a module-level `WeakMap<Measurer, Map<string, Answer>>`, with keys from `JSON.stringify` and a 256-entry limit (about `:95-112`, `:251`).
- It uses the memoized `measureText` and `measureContext`, which step 4 deletes.
- With a measurer per paragraph, it asks its checks again for every paragraph.

*Corrected:*

> S2 adds:
> - the resolver stops naming engines;
> - `src/index.ts` passes what differs, which each engine exports as data: which facts the engine reads, the zoom, and whether the context takes `lang`.
>
> S3 adds:
> - the resolver moves to `Context` and `width`;
> - its store becomes a short list of records on the measurer, `{ family, weight, style, lang, answers }`, compared by field like `contextFor`.
>
> Its cost per prepare is recorded for §8's shared-measurer row.

**D5. Splitting the bidi data per engine duplicates one fact.**
- Blink and Gecko share `unicode17BidiClassRanges`.
- Blink and WebKit share `unicode17BracketPairs` (`unicode/bidi.ts:53-64`).

*Corrected:*

> - Shared generated data stays shared, named by where it comes from: Unicode 17, libicucore 78.1, unicode-bidi 15.
> - Each engine builds its own `BidiData` and grapheme rules from those names.
> - Only data with one consumer moves under `engines/<engine>/generated/`: the two break-table files and Gecko's break data.
> - The gate is `git mv` plus equal file hashes. It needs no regeneration.

**D6. Three pieces of glue have no end date.**
- (a) The adapter writes `memoHits: 0`. `prediction.measure` is outside the compared layout (`lab/page.ts:522`), so drop the field and make it `{ contexts, calls }`.
- (b) The adapter rebuilds `slot` and `next.engine` for the row for good. Add to step 4: "after the final proof, one commit removes the dead row fields under a new row format and freezes again".
- (c) S3's wrappers over `nextLine` are acceptable because they run. X1's deletions must list them: "no `nextLine(` left in `engines/<engine>/`".

**D7. `next` and `hasLineBox` sit in two places in one return value.**
- §3.6 returns `{ line, next, hasLineBox }`, while §3.1 says the decided line "also holds the next start".

*Corrected:* they live on the fill result only, and the row adapter reads them there.

## 5. Over-simplifications: what would lose its home

**O1. `LinePieces` leaves out facts the painter reads today.** `paint.ts:90-94` lists exactly what it takes:
- **Blink:** `needsAccurateEndPosition`. It is used by the soft-wrap condition (`:675`) and the hanging-space form (`:698-702`).
- **WebKit:** `boxes[].shapedAcrossBoxes`, and the previous line's `next.offset` and `carriedWidth`, for the limits (`:877-887`).
- **The overflow amount:** used only as a sign (`:701`, `:810`, `:853`, `:943`).

Putting these into a shared `LinePieces` would make `model.ts` name engine facts again.

*Corrected:*

> - `LinePieces<Facts> = { fragments, hasLineBox, joinsNextLine, indented, align, overflows: boolean, facts: Facts }`.
> - The painter core is generic over `Facts` and never looks inside.
> - Each engine's `paint-rules.ts` exports `PaintRules<Facts>`, whose functions read the facts.
> - Blink's facts are `{ needsAccurateEndPosition }`.
> - WebKit's are `{ carriedWidth, shapedAcrossBoxes }`, taken from the decided line. The limits then don't need display boxes.
> - Gecko's are empty.

**O2. WebKit's history worlds have no stated mode, and `inspectLine` throws on a plain paragraph.** A world needs its line's range and display boxes. It needs none of its gaps (`webkit/lines.ts:2592-2618`).

*Corrected:*

> - In X1 a world is prepared and filled as today, including its discarded gap work (`:2774`). T1 then stays at exit 0.
> - WebKit's `inspectLine` is built from two internal functions, `displayBoxes(prepared, line)` and `lineGaps(prepared, line)`. A world calls the first.
> - Stopping the world's gap work later is a "dropped only" step with one browser run. It is a §8 item, because it speeds up only the lab.

**O3. "Its merging (`addGap`)" hides that WebKit has six merge rules and Gecko has none.**
- Blink merges by gap, run, detail and touching ranges (`blink/gaps.ts:9-24`).
- WebKit merges:
  - by gap and run (`lines.ts:92`, `:695`);
  - by equal range (`:1270`);
  - by overlap with extension (`:1552-1554`);
  - by gap, run and overlap, scanning from the end (`:2439-2447`);
  - by gap and run with extension and no overlap test (`:2669-2676`).
- Gecko pushes without any dedupe (`lines.ts:1004`, prepare's 15 sites) and sorts the in-word report (`:1959-1962`).

*Corrected:*

> - Each `gaps.ts` ports its engine's merge rules one by one, with these line references.
> - There is no shared merge helper.
> - Unifying them changes rows, and waits for the row format change of D6 (b).

**O4. Gecko's fill-time list spans both passes of a redo.**
- `reflowLine` hands one `LineGaps` to both `reflowPass` calls (`gecko/lines.ts:1324-1327`).
- So a `font-fallback` can be pushed twice.
- "Past the end" reads offsets that only the dropped pass consulted (`:1957-1958`).
- The in-word report also reads the characters (`:1949-1956`).

*Corrected:*

> The decided line's gap list and consulted offsets are collected across every pass of the fill, in order. `inspectLine` computes the characters before the in-word report, as today.

**O5. The row freezes more than `geometry.ts`.**
- Every line's `next` is stored whole (`model.ts:302-339`).
- It names index spaces:
  - Blink's `itemIndex` and `style` (`blink/types.ts:187-205`);
  - WebKit's `itemIndex` (`webkit/types.ts:189-208`);
  - Gecko's `frame` (`gecko/types.ts:203-208`).

*Corrected:*

> - The start types move into `geometry.ts` beside the geometry types, types only.
> - X3 may turn parallel arrays into records and items into tagged unions.
> - The item, style and frame lists keep today's order and length.
> - `GapName` and `Fragment` are frozen during step 2.

**O6. "`groupAround`: use `groupOfUnit`" changes results at group starts.**
- `groupAround` is strict on both sides (`blink/index.ts:200-203`).
- *Corrected:* `g = groupOfUnit[k]; return g >= 0 && groups[g].start < k ? g : -1`.
- Every structural fix in §4 states its exact predicate like this.

## 6. Where three engines drift, and one vocabulary to stop it

The draft states one rule ("call `gaps.ts` where today's code raises"). It then describes three mechanisms:
- Blink: sink calls plus captured lists.
- WebKit: fill-time pushes seeding `lineGaps`.
- Gecko: a consulted record.

Add this table to §3.2, so three owners write one dialect:

| Idea | One name and shape everywhere | May differ per engine |
|---|---|---|
| Where gaps go during a fill | `GapSink = Gap[] \| null`, the first parameter of every `gaps.ts` function; null on a plain paragraph | nothing |
| What prepare keeps only for inspection | `prepared.inspect: <Engine>Inspect \| null`, one record. It holds the paragraph's gaps, and WebKit's gap-only box facts and worlds. No boolean is tested anywhere else. | its fields |
| Fill-time gaps on the decided line | `line.gaps: Gap[] \| null`, in raise order, across all passes | nothing |
| Raw facts kept for a later report | integers on the decided line, never prose (Gecko's consulted offsets) | which facts |
| `gaps.ts` exports | `paragraphGaps(prepared)`, `lineGaps(prepared, line)`, and one function per kind of fact raised during a fill | the per-fact functions |
| A value Canvas can't confirm | the home stores `{ value, standIn: Reason \| null }`. `Reason` is a tagged union carrying the numbers the prose prints. Prose is printed only in `gaps.ts`. Blink's position limits and Gecko's stand-in reasons are this same idea. | the union's cases |
| A home | an array on the prepared paragraph, read through one accessor per fact | index: offset, item or box |
| Painter | `engines/<engine>/paint-rules.ts` exports one `PaintRules<Facts>` | `Facts` |

The function set of §3.6 is the contract three owners code against in parallel, and it is untested. A scratch WebKit spike of X1 before step 1 tests it cheaply: decided line, worlds, call order. See §8.

## 7. Ownership and file lists

**S1 misses these files:**
- `r4-tests:tests/replay.ts`, which reads `layout.measure` and imports the row and observation types at `:63`;
- `lab/score.ts`, `lab/row-fixtures.ts`, `lab/port-measure.ts`;
- `lab/baselines/no-facts-predictor.ts`;
- `probes/page.ts`, `probes/types.ts` and two Blink probes;
- `bench/protocol.ts`;
- `src/engines/gecko/gecko.test.ts`. It calls `layoutParagraph` with slots at `:151`, `:651`, `:658`, `:709`. `src` can't import the lab's loop, so the test gets a local one.

**S3 misses these files:**
- `lab/observe/webkit.ts:315` and the three ports' signatures, because the paragraph loses its width;
- `lab/page.ts`;
- `lab/cases/family-widths.ts`;
- `lab/baselines/*.ts`;
- `src/measure/font-checks.ts` (D4).

**Step 2:**
- Owners return text for DESIGN.md, CHARTER.md and TESTS.md, as in round 4.
- An owner edits only its own engine's entries in `tests/rules.json`.

**Step 4:**
- `tests/replay.ts` and `lab/record.ts:209-223` lose the library log.
- The recorder joins a context to its declared settings by the `ctx` object in `Measurer.contexts`, not by the call log.

## 8. Corrected §11: safe to start before the freeze

This is the answer to the maintainer's question. All of it is offline unless said otherwise. None of it touches `src`, `lab` or `tests` on any branch.

**Safe now:**
1. **The citation and prose ledger** (G8). It is a new file under `rebuild/tools/` in a worktree of its own. It is validated by diffing bc49b0e against a5b4636, where the painter and `script-context` moved.
2. **The painter differential harness** (G6):
   - the recording document;
   - a driver over a row file;
   - the bundling step.
   
   It is validated as the painter against itself over round 3's development rows.
3. **The deterministic stand-in Canvas and a two-tree driver** (G2). It is validated as a5b4636 against itself.
4. **Scratch prototypes.** They run in a worktree branched from r4-tests' 260392b. They replay a copy of `.artifacts/tests/r4-tests/replay1/<browser>-no-facts` (78, 35 and 29 MB; all 65,351 Chrome cases replay the same there) with `--jobs=4`. They do not use round 3's record, which no longer replays (§2 claim 10). The prototypes are:
   - Blink's homes in both variants of D1;
   - Gecko's stand-in reasons as a tagged union with byte-equal prose;
   - a WebKit spike of X1 (§6).
5. **The twin case family**, as a scratch generator (G5). Confirming the twin in Chrome takes one short probe job through the lock. It is optional.

**Not safe yet:**
- The twin-string scan. It needs a tap inside `engines/blink/shape.ts`, which r4-blink has open with uncommitted edits.
- Anything under `src`, `lab` or `tests`.
- The bench port.
- Doc rewrites.
- The coverage map.
- Profiling.
- Recording sets again.

## 9. Corrected order, compact

- **Step 0** adds:
  - the `replay.ts` classification and the `Questions` change (G1);
  - the twin family in the recorded sets (G5);
  - the stand-in Canvas (G2);
  - the frozen painter bundle (G6);
  - the plain-only and sweep predictors (G3, G2);
  - the giants recorded, or listed as browser-only (G4).
- **Step 1:**
  - S1 with its full file list;
  - S2 with the font checks and shared data named by where it comes from (D4, D5);
  - S3 without a measurer parameter, with `LinePieces<Facts>` and the start types in `geometry.ts` (D3, O1, O5).
- **Step 2:**
  - X1 exits with exit 0, the wrapper gone, and the plain-only browser run (G3, D6 c).
  - X2 exits with exit 3 "repeats only", the browser in both orders, the sweep predictor in Chrome, and the questions frozen again (G1, G2).
  - X3 exits with exit 0, plus the giants in the browser (G4).
  - The vocabulary of §6 applies throughout.
- **Step 3:** the painter is generic over `Facts`. Limits are checked by T1. The DOM is checked by G6's differential.
- **Step 4:** the log leaves `replay.ts` and `record.ts`. After the final proof, the row format change of D6 (b).
