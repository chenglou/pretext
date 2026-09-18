# Pretext rebuild: re-architecture plan 2 (executable)

2026-09-18. For branch `rebuild-20260916`, to run after round 4b freezes correctness. Paths are under `~/github/pretext-rebuild/rebuild/` unless absolute. Line numbers are at commit a5b4636 (round 3 evaluation), and round 4 will shift them. A "unit" is a UTF-16 code unit.

This merges `research/ARCHITECTURE-PLAN.md` with its critique under the maintainer's direction of 2026-09-18. I read the current code for every claim kept. No browser ran, nothing was prototyped, and nothing under `pretext-rebuild` was edited. Owners should not need the drafts.

Function names below are working names inside the engines, not a public API.

## 1. The direction, and what it rules in and out

The order is: simplicity from proper data structures and data flow, not over-simplified; then profile and optimize; then decide the API shape. Correctness must not move.

**In this plan:**
- Each cross-cutting concern gets one home. The concerns are gap reporting, measurement reads, output only the lab reads, and engine differences in shared code.
- The engines' own model stays: the inline tree input, a slot per line, and a width-free first stage followed by line filling.
- Accidental quadratics from ported code are fixed where the fix is structural and the result is identical. The engineering guide treats unbounded O(n²) as a modeling bug, not an optimization.

**Out, moved to §8 with their evidence:**
- a string store across paragraphs;
- fast paths, eager tables and the width-interval skip;
- contexts created on first use;
- any change to what is measured.

Also out: public API design, rich APIs, parity with current Pretext, font loading.

## 2. What the code is today (checked at a5b4636)

The drafts were written at 17,939 non-test lines under `src`. It is now 21,141: shared 4,610 (of which `paint.ts` is 1,395), Blink 5,946, WebKit 5,505, Gecko 5,080.

| Concern | Where it shows |
|---|---|
| Gap reporting threaded through measuring | **Blink:** `Shaper = { p, m, gaps }` goes to every measuring function (`shape.ts:98-102`). `measure16` raises gaps as a side effect (`:380-407`, through `joinedAtEdge` `:165-179` and `reportScriptContext` `:458-482`). About 34 gap sites sit in `index.ts`, `shape.ts` and `line-breaker.ts`, including a whole gap-only method inside the line breaker (`reportUncertainCandidate`, `line-breaker.ts:707-729`). **Gecko:** `gaps: LineGaps | null` is a parameter of `glyphBefore`, `rangeAdvance`, `advanceWidth`, `scanAdvance`, `computeTabs` and the reflow functions (`lines.ts:491`, `:608-658`). `prepareGecko` pushes gaps at 15 sites inside one function of about 900 lines. **WebKit:** `measure.ts` is already free of gaps. Four sites push while a line is filled (`lines.ts:92-93`, `:695-696`, `:1270-1271`, `:1552-1554`). |
| A string-keyed memo as the data flow | `measure/canvas.ts`: a context is found by a joined string key, and `measureText` reads a `Map<string, number>` per context. **Blink** builds the Canvas string before every lookup (`shape.ts:395-397`). **WebKit** asks for `' '` through the memo at every use (`measure.ts:149`, `:174`, `:200`, `:253`, `:284`, `:378`), and `mergedGlyphs` measures every cluster again for every string. **Gecko** has grown six module-level `WeakMap` memos (`lines.ts:57`, `:79`, `:320`, `:369`, `:488`, `:606`). Five sites read `m.log.contexts[...]` as state (`lines.ts:36`, `:252`, `:291`, `:411`, `prepare.ts:515`). |
| Output only the lab reads, computed on every line | **Blink:** `clustersOf` (`index.ts:636-657`), `mappingOf` (`:1093-1127`), `lineEdgeGaps` and `itemEdgeGaps` (`:218-391`). **WebKit:** `collectBoxFacts` and `collectHistoryWorlds` in prepare (`content.ts:538`, `:842`; the worlds measure item widths, `:765-768`). `lineGaps` (`lines.ts:2436-2583`). `pageHistoryGaps` builds the same line again in every history world (`:2650-2678`). Display boxes are built for every line. **Gecko:** `characters()` (`lines.ts:1354-1372`), the in-word report (`:1916-1963`), a second measure of every stretch only for `space-in-shaping` (`prepare.ts:1265-1272`), and stand-in reasons built as prose for every offset (`lines.ts:107-195`). |
| Shared code that names engines | `src/index.ts` switches on the engine five times and makes a measurer per paragraph (`:40`). `model.ts` imports three engines' types (`:5-8`) and holds their geometry (`:345-575`), the lab's row type and the observation contract (`:638-685`). `breaks/tables.ts`, `unicode/bidi.ts:55-61` and `unicode/grapheme.ts:19-21` select data by engine name. `paint.ts` branches on the engine at about 25 sites and imports Blink internals (`:55-56`). |

Other facts still true:
- The width is read only at line time, at `blink/line-breaker.ts:163`, `blink/index.ts:1280`, `webkit/lines.ts:2377` and `:2798`, `gecko/lines.ts:1095`, and by the painter.
- Blink's `applyJustification` writes into the item results (`index.ts:785-788`), and `hangWidthOf` reads them afterwards.
- Blink scans ICU boundaries to the end of the text from every line start and allocates two text-length arrays per line (`breaks.ts:134-168`, `:139`, `:205`).
- `UnportedFeature` is never thrown, and `ruleStatus()` has no caller.
- `bench/page.ts` does not compile (`:130-133`, `:181`).

**What changed since the drafts and changes the plan:**
1. Blink's `measure16` now raises `script-context` as well. That gap depends on the measured string and on a per-style Canvas probe (`canvasSplitsWords`, `shape.ts:345-354`) that is written onto the prepared paragraph on first use. At letter spacing 0 that work and the probe's two Canvas calls exist only for the gap (`:403-405`). The critique's idea of deriving a read's gaps from (group, offset) alone (its B1) no longer covers what a measurement raises.
2. WebKit's `page-history` condition is computed from "history worlds": other prepared paragraphs kept inside the prepared paragraph. Every world fills and outputs each line again.
3. Gecko's per-offset facts already exist, as WeakMap memos that hold `{ au, standIn: string | null }`.
4. `paint.ts` was rewritten, from 489 lines to 1,395.
5. The offline replay exists (`lab/measurements.ts`, `lab/record.ts`). It sets the rule: a build must ask the same Canvas questions or fewer, and the layout JSON as the row keeps it, `env` included, must be byte-equal. A new question fails the case.
6. Round 4 removes Gecko's canvas element path (`CanvasSettings.element`, `GeckoEnvironment.canvasElement`, `GeckoTextRun.auPerPx`). It also adds the runtime font-check resolver to the shared measure layer.

## 3. Target

### 3.1 Stages, data and lifetimes

| Stage | Data | Made by | Lives as long as | Depends on width |
|---|---|---|---|---|
| Page | the environment of `env.ts`; a `Measurer` | the caller | the caller keeps them | no |
| Input | `Paragraph` (the inline tree) without `width`; `LineSlot { width, left, right }` per line | the caller | the caller's scope | the slot only |
| Prepared | the engine's content, items, styles, break data and prepare-time widths; references to the paragraph, the env and the measurer; the homes of measured facts (§3.3); `inspect`, which is null on a plain paragraph (§3.2) | `prepare` | the caller keeps the prepared paragraph | no |
| Decided line | the engine's own record of one filled line: Blink `LineInfo` with its item results and views, WebKit's closed `Line` with its rect, Gecko's final pass. It also holds the next start. On an inspected paragraph it holds the gaps raised while filling. | `fillLine` | the caller's scope. Counting drops it. | yes |
| Pieces | fragments, `hasLineBox`, `joinsNextLine`, `indented`, `align`, and whether the line overflows its band | `linePieces(prepared, line)` | the caller's scope | yes |
| Inspection | today's engine geometry and today's line gaps | `inspectLine(prepared, line)` | the row | yes |
| Row | today's `ParagraphLayout` JSON | the lab adapter | the lab | yes |

The rules behind the table, from the engineering guide:
- Values that share a lifetime sit in one object.
- A value derived from a line is computed in the scope that asks and is never stored on the line.
- Nothing mutates a decided line. Blink's justification therefore writes its sizes into locals of the output instead of into the item results.

### 3.2 Plain and inspected paragraphs: where gaps, limits and lab-only geometry live

`prepare(paragraph, env, measurer, inspect: boolean)`. The mode is a property of the prepared paragraph. It is decided once and never checked per call site.

**A plain paragraph:**
- computes no gap and no limit;
- computes no clusters, characters, mapping or display boxes;
- asks no Canvas question that exists only for a gap;
- `inspectLine` and `paragraphGaps` throw on it.

**An inspected paragraph:**
- produces exactly today's gaps and geometry, in today's order, with today's Canvas questions in today's order.
- The lab always prepares inspected paragraphs, so the lab path stays what the rows were recorded from.

**One home per engine: `engines/<engine>/gaps.ts`.** It owns:
- every condition's test;
- its prose;
- its merging (`addGap`);
- its order.

**Rules for that home:**
- Nothing outside it builds a `Gap`.
- The rest of the engine calls it at the program points where today's code raises a gap. It makes one kind of call per kind of fact. For Blink the calls are: a measured range, a view, a reshape's HanKerning trims, the hyphen, tabs, a break candidate, and the cuts.
- Each of its functions returns at once when the list it is given is null.
- An expression that exists only to decide a gap is evaluated inside `gaps.ts`, never before the call. Examples are `canvasScriptsPerUnit` at letter spacing 0, `positionBounds`, and the no-ligature pair windows.

This keeps the raise points, so order and merging stay the same and byte identity follows by construction. It removes the logic from measuring code and costs the default path one null check per site.

**Limits and lab-only geometry** are computed only by `inspectLine`:
- Blink: `startLimit`, `sizeLimit`, clusters and mapping;
- Gecko: `standInBefore`, `standInAtEnd` and the characters;
- WebKit: display boxes.

`painterLimits` stays a function the lab calls.

**Why a mode, and not gaps derived from the decided line:** today's Blink and WebKit gap lists include conditions of probes that decided nothing. `addGap` merges by insertion order, and the scorer takes the first matching gap. Deriving gaps from the decision alone would change rows. Gecko's in-word report is already a function of the decided line, plus the first consulted offset past its end, and stays that way.

### 3.3 Measurement: every Canvas answer has one home

There is no lookup by string anywhere. Each measured quantity is stored where it belongs, indexed by what it is, and is asked for when first needed.

| Home | Holds | Lifetime |
|---|---|---|
| per style, box or text run | constants: the space width, the hyphen's text and width, tab bases, Blink's `canvasSplitsWords` and HanKerning font data, Gecko's hyphen and minimum tab advance | the prepared paragraph |
| per text offset, in arrays with a filled mask | **Blink:** the position before an offset in its group, and the pair, wide and no-ligature adjustments there, for reads whose arguments are a function of group and offset alone. **Gecko:** the in-word advance and the ligature group, row and span facts per transformed offset. **WebKit**, in letter-spaced boxes only: the spacing-bearing glyph count per cluster and the merged flag per adjacent pair. | the prepared paragraph |
| per item or piece | WebKit item widths (already stored), Blink group cuts and prefixes, Gecko unit widths | the prepared paragraph |
| per reshape, probe or partial item | Blink's line-edge reshapes and positions inside them, WebKit's `breakWord` probes and partial items, tab items | the line's scope, handed down to where they are used |

**Why first need and not prepare:** the replay gate cannot answer a question the record lacks. So a rewrite that must be proven offline may only ask what today's code asks. Filling in prepare is in §8.

**What a home stores:** a number, or a small tagged record. It never stores prose and never a string to look up again.

**Gaps a Blink fact raised:** on an inspected paragraph, an entry filled from Canvas also keeps the raw, unmerged list of gap calls its computation made. Every later read hands those calls to the current list in the same order. Today every `measure16` call raises its gaps again even on a memo hit, so this reproduces today's sequence exactly. It works through one sink type in `gaps.ts`:
- a line's or the paragraph's list merges;
- a capturing list pushes raw;
- a read nested inside a computation lands in the capture.

Three prototypes at bc49b0e got byte-identical lines, geometry, gaps and Canvas calls this way. They predate `script-context` moving into `measure16`, so Blink's measurement step starts with a fresh throwaway prototype against the replay (§6).

**Duplicates:** two homes can need the same string, for example Blink's single cluster in the pair windows of two neighbouring offsets. It is then asked twice. Values can't differ:
- Chrome returns the first shaping of a string on a canvas;
- WebKit and Gecko are deterministic;
- the replay serves repeats.

Whether the duplicates cost anything is a profiling question (§8).

**Shared layer:**
- `Measurer = { contexts: Context[] }`, plus round 4's font-check store.
- `Context = { settings, ctx }`.
- `contextFor(m, settings)` scans the few contexts and compares fields, with `ctx.lang` set before `ctx.font`.
- `width(c, text)` and `bounds(c, text)` always call Canvas.
- Engines hold `Context` references in their style, box and run records, and the prepared paragraph holds its measurer. No measurer is passed at line time.
- `partition` stays, as the generic way to keep equal settings on separate canvases.
- The lab keeps making one measurer per case, as today.

### 3.4 What the shared layer keeps, and that it names no engine

**It keeps:**
- `model.ts`: the input tree, font facts, `Fragment`, `Gap` and `GapName`, `LineSlot` and `LinePieces`;
- `content.ts`;
- `measure/` (`canvas.ts`, `font.ts`, round 4's font checks);
- the library ports as algorithms that take their data as a parameter (rbbi, icu4x, ubidi, unicode-bidi, graphemes);
- `paint.ts` as an engine-free core, after step 3.

**Two shared files may name engines:**
- `src/index.ts`, the one dispatch over a tagged prepared union. The runtime tag stays, for processes that load two engines.
- `src/env.ts`, the environment union and detection. Its serialized shape is part of the row and doesn't change.

No other shared file holds an engine name or imports from `engines/`. A test checks that.

**It loses:**
- engine geometry types, to `engines/<engine>/geometry.ts`. These are types only and are the one engine file the lab may import.
- `ParagraphLayout`, `LineOf`, `LineResultOf`, `BelowFloats` and the observation contract, to the lab.
- the slot-row loop with refusals (`index.ts:116-138`), to the lab adapter. It is the lab's float protocol.
- `engines/engine.ts`.
- the data selectors in `breaks/tables.ts`, `unicode/bidi.ts` and `unicode/grapheme.ts`. Engines import their own generated data, which moves to `engines/<engine>/generated/`.
- the memo, the log and `measure/log.ts`.

### 3.5 The lab adapter and the frozen row format

The serialized `prediction.layout` is a frozen format, key order included, because the replay compares it as JSON. The format is `{ engine, env, lines, belowFloats, gaps }`, with every line's fields.

`lab/predictor-core.ts` is the one lab file that imports library logic. It builds the row from `prepare(..., true)`, the slot-row loop, `fillLine`, `linePieces`, `inspectLine` and `paragraphGaps`. It writes the fields the library no longer carries:
- `slot` as `{ left, right }`;
- the `engine` tag on `next`.

The lab counts Canvas calls and contexts with its own wrapper and writes `memoHits: 0`.

### 3.6 Engine functions (working names)

```ts
prepare(paragraph, env, measurer, inspect): Prepared
firstLine(prepared): Start | null
fillLine(prepared, start, slot): { kind: 'line'; line; next: Start | null; hasLineBox } | { kind: 'below-floats'; line; next: Start }
linePieces(prepared, line): LinePieces        // what a painter takes
inspectLine(prepared, line): { geometry; gaps } // inspected paragraphs only; a refused slot gives its gaps without geometry, as today
paragraphGaps(prepared): Gap[]                 // inspected paragraphs only; the engine-build gap first
```

All but `prepare` and `fillLine` are pure functions of their arguments. They may fill a home on first read.

## 4. Per engine

One rule for all three: a Canvas question is gap-only when deleting it, and the gap it feeds, leaves every `fillLine` result unchanged. Classify by reading. The plain-equals-inspected check (§5) proves it.

### Blink

**Prepared:**
- `text` and its per-unit arrays.
- Items as a tagged union.
- One style record that absorbs `settings`, `contexts`, `hanKerning` and `canvasSplitsWords`.
- Groups with `cuts` and `prefixAtCut`.
- One set of per-offset arrays for the paragraph. Groups are disjoint, so text offset is the index. They are `Float64Array` with a filled mask, because 16.16 positions overflow Int32 past 32,768 zoomed px.
- On an inspected paragraph, the gap calls per entry.

Arrays only inspection reads, such as `collapsedAt`, are built by inspection.

**Decided line:** `LineInfo` with its results and views, the start and the slot. It carries `decisionEnd`, `untestedEnds`, `breaksInsideWords` and `truncatedStarts` as now. Reshape records hold their own measured positions for the line's life.

**`gaps.ts` takes:**
- `joinedAtEdge`'s conditions. The function becomes a pure "is U+200D added here", and the same inputs give the condition.
- `reportScriptContext` with its script work at letter spacing 0.
- The HanKerning, float32, `glyph-clusters`, `hyphen-glyph`, `tab-stops` and cut gaps.
- `reportUncertainCandidate`, `edgeGap`, `lineEdgeGaps` and `itemEdgeGaps`.
- `contentGaps` and `prepareGaps`.

**Moves verbatim, never restructured:**
- `canvasString`. It is the only constructor of Canvas strings, and the replay cannot see string storage.
- `offsetForPosition`'s probe order.
- The view, part and segment bookkeeping.
- `floatWidthOfParts`.
- The ICU restart at every line start, with `adoptText` on today's string.

**Structural, result-identical fixes:**
- The ICU and grapheme scans pull boundaries as the line asks, instead of scanning to the text's end.
- The line-break iterator and its arrays stop being built per line.
- The per-line `shapeResults` Map goes, since an item's result is two position reads.
- Output stops scanning the whole paragraph per line: `fragmentsOf` over all events (`index.ts:491`), box states from item 0 (`:863-867`), `groupAround` (`:200-203`, use `groupOfUnit`), `generated()` (`:1105-1113`).
- `scriptsPerUnit` is not run where its result is discarded.

### WebKit

**Prepared:**
- Boxes with the fields line breaking reads.
- Items with stored widths.
- Per-box constants, and for letter-spaced boxes the per-offset facts.
- On an inspected paragraph only:
  - the gap-only box facts (`monospaceUnknown`, `hyphenUnknown`, `unverifiedCoverage`, `primaryFamilyUnknown`, `pairKerningUnknown`, `localeChoosesFonts` with its two contexts, `hanLocaleUnknown`, `quoteLocaleUnknown`, `dictionaryRangesStartingWithMark`);
  - the history worlds.

**Decided line:**
- the closed `Line`, its rect, the next start, the last-line flag and the carried width;
- `{ measuredEnd, reverted, decisionStart, overflowStart, shapedCarry }`;
- on an inspected paragraph, the gaps pushed while filling, in order, which `lineGaps` is seeded with. Its dedupe reads them (`lines.ts:2441-2446`).

**`gaps.ts` takes:**
- the four fill-time sites;
- `lineGaps`;
- `pageHistoryGaps`, which fills and inspects the same line in each world with the same functions;
- `collectBoxFacts` and `collectHistoryWorlds`;
- the LastResort comparison for `unverifiedCoverage` (`content.ts:275`). The coverage measure that decides `simplifiedMeasuring` stays.
- `hyphenGlyphsDiffer`.

**Data flow:**
- A width measured for a candidate travels to commit, except on the TAB path. There the candidate and the commit measure at different float32 positions (`lines.ts:1185`, `:1102`), and both measurements stay.
- Items and `LineRun` become tagged unions.
- `isDelimiterQuote` reads a list derived once at module load.
- The last-line scan exits at the first contentful item (`lines.ts:1817`).

**Unchanged:**
- `breakWord`'s probe sequence.
- `carriedWidth`.
- The three builders and their differences.
- Every float32 sum, in source order: no Float64 accumulators and no regrouping.

### Gecko

**Prepared:**
- Leaf records instead of five parallel arrays.
- Text runs that hold their `Context`.
- Units.
- The per-offset in-word facts as arrays or records on the prepared paragraph. These replace the six WeakMaps, and `groupEndMemo` becomes a field of the frame's provider.
- Stand-in reasons become a tagged union. It carries the numbers the prose prints (sides sum, across, unit width, the nested edge reason). Prose is printed only in `gaps.ts`, byte-equal to today's.
- `emergencyUnconfirmed` becomes flags per offset.
- `Provider.tabs` becomes a sorted array.
- `scriptLimits` becomes a moving index.

**Decided line:**
- the final pass's placed frames, status and next start, and the band;
- on an inspected paragraph:
  - the consulted stand-in offsets, recorded at `glyphBefore`'s one site;
  - the emergency-hyphen `font-fallback` (`lines.ts:1004`).

**`gaps.ts` takes:**
- prepare's 15 sites with their gap-only measuring. The second stretch measure is one of them, and the owner classifies the rest by the rule above.
- the in-word report;
- the consulted record.

`characters()` and the justification spacing per character run only in `inspectLine`. The trim and hang needed for "overflows" are computed by `linePieces`.

**Unchanged:**
- The linear break scan, because advances need not be monotone.
- The single redo.
- The `W(unit) − W(suffix)` recipe, quadratic cost included (§8).

## 5. Gates

Round 4 provides the tiers. This plan uses them like this:

- **T0:** `bunx tsc --noEmit` over the four projects, and `bun test rebuild/src rebuild/lab rebuild/tests`.
- **T1, offline replay identity:** every case of every replay set, per engine, in both configs (no supplied facts, and with facts), against the frozen reference. 0 changed cases and 0 new questions. Questions no longer asked are allowed only where a step says so.
- **T2, browser sets:** pinned browsers, scorer 5, build-keyed seeds through the staging gate, 0 ledger transitions. Forward order while iterating, both orders at milestones.
- **T3, full evaluation:** fresh sets, giants, the installed Safari spot check. Once, at the end.

Checks this plan adds to T1's tooling. They go in new files, or as flags on `lab/measurements.ts` for the tests owner:
1. **Order (Blink).** Per context, the sequence of first occurrences of measured strings on the inspected path equals the record's. Report only for WebKit and Gecko.
2. **Plain equals inspected.** Per case, `fillLine` and `linePieces` from a plain paragraph equal the inspected ones, and the plain path's questions are a subset of the record.
3. **Purity.** `linePieces` and `inspectLine` give the same result twice and in either order.
4. **Slot width.** Filling from a start with `{ width: w, left: 0, right: 0 }` equals the reference's line at paragraph width `w`. A sweep of widths on one prepared paragraph equals fresh prepares.
5. **Twins (Blink).** A scan for one context measuring the same characters in both storage classes within a case. The critique found none in 25,505 development cases.
6. **Coverage map.** Which lines of `src` the replay sets execute, per engine. Unexecuted lines are not provable offline: they move verbatim and are listed.
7. **Ledger of citations, rule ids and gap sites** under `src` against the frozen commit. A missing one needs a reviewed entry.
8. **Painter differential.** The frozen painter and the working painter paint every reference row's layout into a recording document (as in `paint.test.ts`). The full serializations are byte-equal.
9. **Independence.**
   - Only the two named shared files mention an engine.
   - Engines import no other engine.
   - The lab imports only `model.ts`, `env.ts` and the three `geometry.ts`, outside its adapter.

## 6. Order of work

Every owner works in a git worktree of their own under `~/github/pretext-rebuild-wt/`, and the orchestrator merges. T1 is each owner's inner loop. Browser jobs go through the lock.

### Step 0. Reference and checks (tests or shared owner; library unchanged)

- Freeze the reference at the round 4b commit: both configs, three engines, with measurements recorded.
- Add checks 1 to 9 of §5.
- Time the giants once as a baseline.

Exit: T1 of the frozen tree against itself is clean, and the painter differential of the painter against itself is clean.

### Step 1. Shared layer (one owner)

**S1. The lab owns the row.**
- Files: `src/model.ts`, `src/index.ts`, `lab/types.ts`, new `lab/observe/contract.ts`, `lab/predictor-core.ts`, `lab/page.ts`, `lab/record.ts`, the three observation ports' imports, `tests/independence.test.ts`.
- Moves out of `model.ts`: `ParagraphLayout`, `LineOf`, `LineResultOf`, `BelowFloats`, the observation contract.
- Moves out of `index.ts`: `layoutParagraph` and `fillLines`.
- The lab counts calls itself.
- Gate: T0, T1.

**S2. Shared code stops selecting engines.**
- Files:
  - new `engines/<engine>/geometry.ts`, from `model.ts:345-575`;
  - each engine's imports of break, bidi and grapheme data;
  - `breaks/generated/*` and the bidi data, split into `engines/<engine>/generated/`, with the output paths in `tools/gen-*.ts`.
- Deleted:
  - `engines/engine.ts`;
  - rbbi's unread rule status;
  - the selectors in `breaks/tables.ts`;
  - `bidiDataFor` and `graphemeRulesFor`, for every caller but `paint.ts`, which loses them in step 3.
- Gate: T0, T1, check 9, and regenerated data byte-equal.

**S3. Width at line time and the function set.**
- Files:
  - `model.ts`: `LineSlot.width`; `Paragraph.width` and `FULL_WIDTH` go;
  - the five width sites;
  - each engine's `index.ts`, implementing §3.6 over today's `nextLine`, with inspection always on inside until the engine's own step. This is code that runs, not a bridge to keep.
  - `src/index.ts`, as the dispatch;
  - `measure/canvas.ts`: `Context` objects and `width`/`bounds` beside today's index API, over the same contexts;
  - the adapter, engine tests, the families' line tools;
  - `bench/page.ts`, rewritten so it compiles, with count, paint and inspect modes.
- Docs: DESIGN §2.1, §2.8, §2.9, §4.6, §8.1; lab and bench READMEs.
- Gate: T0, T1 in both configs, check 4, then T2 forward once in all three browsers.

### Step 2. Three engine owners in parallel

Files for each owner: all of `engines/<engine>/` and its generator. The `geometry.ts` types don't change.

**X1. Gaps get their home; plain and inspected become real.**
- The decided line.
- Pure `linePieces` and `inspectLine`.
- `gaps.ts`.
- Nothing gap-only on a plain paragraph.
- Blink: the justification mutation ends.
- WebKit: box facts and history worlds move under inspection.
- Gecko: `gaps | null` leaves every measuring signature.
- Gate: T0, T1, checks 2 and 3.
- Deleted: the engine's scattered gap building.

**X2. Measurement homes.**
- Every read moves to its home.
- The engine stops importing the memoized `measureText`, `measureContext` indices and the log. Gecko's six WeakMaps and `m.log` reads go.
- Blink starts with a throwaway prototype of the per-offset arrays with gap replay, run against T1. If a read's call sequence turns out to depend on its caller, that read gets no array and stays a line-scope value.
- Gate: T0, T1 with check 1, check 5, and a grep for string-keyed Maps.
- Then T2 in both orders for that engine.
- For Blink, also a plain-mode Chrome run: a predictor that returns line ranges from a plain paragraph, compared with the reference rows' ranges on the development sets.

**X3. Model clean-up.**
- Tagged unions, records for parallel arrays, no sentinels.
- Map and Set only where the algorithm needs them.
- The structural fixes of §4.
- Dead fields and what knip finds.
- Gate: T0, T1, the giants' time not worse, T2 in both orders.

**Docs per engine:** DESIGN §3, §4.4, §4.5 and §5 for that engine, and its `specs/*-RESULTS.md`.

**Browser order:** WebKit first, because it changes least in measurement. Then Gecko. Then Blink.

### Step 3. Painter (shared owner, after step 2 merges)

`paint.ts` becomes an engine-free core. It takes `LinePieces`, the container width, and a `PaintRules` value. Each engine exports its rules from `engines/<engine>/paint-rules.ts`, as data plus a few functions typed by the core:
- the hyphen span's style;
- the hanging-space form;
- which box decides the line end's wrapping;
- the soft-wrap condition;
- Blink's U+061C script mark with its script data;
- Gecko's letter spacing at a run's end;
- WebKit's tab-as-itself text and storage-class text nodes;
- the HanKerning trim exception;
- each engine's limits.

Deleted: the imports of Blink internals and the last data selectors.

Gate: T0, check 8, T2 with painter observations unchanged. Docs: DESIGN §7.

### Step 4. Last deletions and the final proof (shared owner)

- Delete the memoized API, the log and `measure/log.ts`.
- Run knip.
- Update CHARTER wording per decision 1, and TESTS.md.
- T2 in both orders, both configs, all browsers.
- T3.
- The ledger shows 0 transitions against the frozen reference.

## 7. Not done

- No performance structures (§8).
- No change to what is measured.
- No shared measurer across paragraphs.
- No loader or per-engine bundles. Each engine's `index.ts` is importable on its own, and packaging waits.
- No public API design.
- No `lineGeometry` for apps, and no userland segment access.
- No parity work with current Pretext.
- No dead-field removal from the row or from `env`.
- No new gap semantics. The accepted cost: a long stretch without spaces stays seconds in Firefox on its first layout (a 9,428-unit Chinese paragraph took about 11 s).

## 8. After profiling, not before

Each item lists what motivates it. All numbers are ungated ballparks.

| Candidate | Evidence |
|---|---|
| Shared measurer, or shared contexts, across paragraphs | 200 messages in Chrome make 400 to 800 canvases. The perf look got 2 to 3 times faster on cold short texts. The critique's bench got −4.8% time in Chrome. It needs a three-order browser run first, and round 4's font checks then run once per font instead of per paragraph. |
| A bounded store for strings that recur across homes | 84 to 90% memo hits in Chrome today. Most are re-reads of one offset, which homes absorb. Measure what is left. A repeated `measureText` costs about 0.2 µs. |
| Contexts created on first use | Blink makes five per style per paragraph (`shape.ts:85-92`). |
| An integer-keyed store per prepared paragraph for line-edge strings (WebKit `(box, from, to)`, Blink reshapes) | Without it a repeated width asks Canvas again for split words and unsafe edges. |
| Filling homes in prepare, or a "words" variant | Prepare came to about 0.55 to 1.17 times main's, with no Canvas call at later widths. It changes which questions are asked, so it needs new records and browser runs. |
| A relayout loop over flat arrays, with the general path as fallback | 4 to 25 times faster than main's `layout()` on plain left-to-right text in all three engines. About 57% of lines fall back at narrow widths. One assumption is unproven. |
| The width-interval skip | A resize drag over 200 messages ran at 0.08 times main. It was sound over 100,200 checked layouts. |
| Gecko windows inside long units | 44.6M characters sent to Canvas became 0.34M on 9,000 Chinese units. It changes the recipe. |
| Blink cuts beside every safe space | Corpus calls went from 5,112 to 2,520. It moved gaps in 4 of 80 outputs. The acceptance rule must come from source, not from rows. |
| Blink canvases by each string's own storage class | Removes the twin hazard by construction, but changes which canvas measures what. |
| Bounding WebKit's `simplified-measuring` check | 28.5M characters for one 30,000-character word. It runs on the inspected path only. |
| Piece-relative Int32 tables; one transformed Gecko string sliced at measure time | Memory and string building, if profiles show them. |

## 9. Risks to correctness, and the check that catches each

| Risk | Check |
|---|---|
| **String storage class in Blink.** An 8-bit and a forced 16-bit string with equal characters share Chrome's cache key and shape differently. The replay compares characters only, so it is blind to this. | `canvasString` moves verbatim and stays the only constructor. No slicing or concatenation of Canvas strings elsewhere. Check 5 (twins). A Chrome T2 run after any edit near it, not only at the end. |
| **float32 summation order in WebKit.** | T1 compares geometry to the bit wherever a path is exercised. Check 6 lists paths it never runs. Those move verbatim, the TAB path among them, where the critique found 0 of 1,528 lines measuring one range at two positions. No Float64 accumulators, and no carried candidate width on the TAB path. |
| **Chrome's per-canvas shape cache and measurement order.** | Homes fill in today's order, so check 1 holds by construction and is tested. The lab keeps one measurer per case. Check 2, plus the plain-mode Chrome run, covers the smaller question set of plain paragraphs. Sharing is out of this plan. |
| **Page history.** WebKit's worlds must use the same fill and inspection functions. The library's Canvas questions are part of a process's history for later cases' native layout in Firefox. | The inspected path asks today's set of questions, so native rows don't move. T2 runs under the fixed protocol of `tests/sets.ts`, in both orders at milestones, with history-dependent rows held by ledger status. |
| **Gap order and merging.** | T1 compares gap lists byte for byte. Raise points don't move. |
| **A pure function that mutates the line** (Blink justification today). | Check 3. |
| **Dictionary segmentation.** | Any change to the string given to `Intl.Segmenter` or `v8BreakIterator` shows as a new question in T1. |
| **Positions past 32,768 zoomed px.** | Float64 arrays, and the giants. |
| **The row's shape or key order drifting.** | T1 is byte-level. The adapter owns the format. |
| **A rule, citation or gap site lost in a rewrite.** | Check 7. |
| **Font checks of round 4 moving relative to engine measuring.** | T1 in the no-facts config. Check 1 on shared contexts. |
| **The painter, which only browsers can judge.** | Check 8 offline, then T2 painter observations. |

## 10. Decisions that are the maintainer's

1. **Gaps and engine geometry become output on request** (inspected paragraphs), not part of every line. Charter tentpoles 1 and 3 call them output, so their wording changes. The whole plan assumes yes.
2. **The width leaves `Paragraph` and joins the line slot.** It follows from where the engines read it, and it lets one prepared paragraph serve any width. If no, only S3 shrinks.
3. **Whether the painter split (step 3) belongs to this phase.** It is the largest case of shared code naming engines. It can only be proven by the DOM differential and browser runs. I recommend yes, after the engines.

## 11. Safe to start before the freeze

This answers "what could already run in parallel without churn". All three items touch nothing that round 4 owns.

- **This plan and its attack.**
- **New-file tools**, in a worktree of their own from a5b4636, under `rebuild/tools/`. Each can be validated against round 3's rows and records:
  - the citation and gap-site ledger;
  - the painter differential, run as the painter against itself;
  - the twin-string scan.
- **Two scratch-only prototypes** that de-risk the central mechanisms, run against round 3's recorded `runs` set, which replays offline today:
  - Blink per-offset arrays with gap replay;
  - Gecko's stand-in reasons as a tagged union, with byte-equal prose.

**Not safe yet:**
- anything under `src`, `lab` or `tests`;
- the bench port and doc rewrites, since the functions under them change in step 1;
- the coverage map, which needs round 4's replay command;
- profiling.

## 12. Where this differs from the draft and its critique

| Topic | Draft, then critique | Here |
|---|---|---|
| Gaps of a Blink table read | Stored per entry (draft). Derived from group and offset (critique). | Stored as raw gap calls, on inspected paragraphs only. Derivation no longer covers `script-context`. |
| Gaps and geometry | `inspectLine` after every `breakLine`, with gaps collected during every fill | A mode fixed at prepare. Plain paragraphs compute none and ask no gap-only question. |
| Cross-paragraph store, `measureShared`, shared measurer in step 3 | In the plan (draft). Contexts only (critique). | All in §8. |
| "A second pass at the same width makes no Canvas call" | A gate (draft). Contradicted (critique). | Dropped. Line-scope values ask again. |
| WebKit constants as fields filled in prepare | Draft: yes. Critique: no, because it adds questions. | Fields asked on first use. |
| Row comparison | Byte-equal (draft). A normalizing projection and a new row version (critique). | The row format is frozen and the adapter owns it. |
| `lineGeometry` for apps, the loader, `likely.ts` table | Proposed | Not in this phase. |
| Painter | 489 lines with three branches | 1,395 lines with about 25 branches, so it gets its own step and its own offline check. |
| Accidental quadratics | Mixed into engine lists | Kept only where structural and result-identical, each proven by T1. |
