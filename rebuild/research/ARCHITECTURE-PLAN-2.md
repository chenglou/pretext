# Pretext rebuild: re-architecture plan 2 (final)

2026-09-18. For branch `rebuild-20260916`, to run after round 4b freezes correctness.

- Paths are under `~/github/pretext-rebuild/rebuild/` unless absolute. `r4-tests:` is `~/github/pretext-rebuild-wt/tests/rebuild/`.
- Line numbers are at a5b4636. Round 4 shifts them, so each comes with its function's name.
- A "unit" is a UTF-16 code unit. Function names are working names inside the engines, not a public API.

This merges the draft plan with its critique. It follows the maintainer's direction of 2026-09-18, including two later notes in the orchestrator's log:
- 04:40: the simple version has no caching structures, and "tables filled on first read" come after profiling.
- 04:57: invisible acceleration structures may come back later if numbers ask for them.

I checked every critique against the code, and §12 lists the ones I rejected. Nothing under `pretext-rebuild` was edited. One experiment ran in a scratch copy (§2).

## 1. Decisions for the maintainer

**1. Gaps and engine geometry become output on request.**
- A paragraph is prepared either plain or inspected. Plain is what an app runs: lines and pieces only. Inspected is what the lab runs: today's gaps and engine geometry too.
- Recommend: yes. The whole plan assumes it.
- Cost:
  - Charter tentpoles 1 and 3 change from "returns" and "reports" to "on request".
  - The app path gets one null check per gap site.
  - The app path asks Canvas fewer questions than any recorded run, so each engine needs one extra browser run to prove it (§8, X1).

**2. The width leaves `Paragraph` and joins the line slot**, as `LineSlot = { width, left, right }`.
- Recommend: yes. All three engines already read the width only while filling a line, and one prepared paragraph then serves any width.
- Cost:
  - Every caller of `layoutParagraph` and the three observation ports change signature (S3).
  - One Chrome run fills other widths first on the same prepared paragraph, because Chrome caches shaped words per canvas.
- If no: S3 shrinks to the function set.

**3. The painter split belongs to this phase.**
- `paint.ts` is the largest case of shared code naming engines: 1,395 lines, about 25 branches, and imports of Blink internals.
- Recommend: yes, starting once the three X1 steps have merged.
- Cost: about one owner-step. Only a DOM differential and browser runs can prove it.
- If no: the independence check keeps an exception for `paint.ts`.

**4. Once the string memo is gone, no new structure stores measured values.**
- The rule:
  - A read asks Canvas.
  - A value needed twice in one scope is a local.
  - A value a break candidate measured is handed to the commit.
  - A value prepare already measures becomes a field set there.
  - Gecko's per-offset memos, which exist today, become one array of records on the prepared paragraph.
  - Per-offset tables for Blink and WebKit move to "after profiling" (§10), first in line.
- Recommend: yes.
  - The 04:40 note asks for it.
  - It removes the draft's most intricate mechanism: a Blink table entry had to remember and replay the gaps its measurement raised.
- Evidence, measured today (§2): with the memo switched off, all 190,441 recorded cases replay with 0 predictions changed and 0 new questions. Canvas questions rise ×7.2 in Chrome, ×6.5 in webkit-host and ×1.6 in Firefox on the lab path.
- Cost:
  - Chrome answers a repeated string from its own per-canvas cache in about 0.2 µs, and the JS around each read runs today too. Blink should cost about what it does now.
  - At least 81% of WebKit's repeats come from lab-only gap code. The app path barely moves. The lab path pays until that code takes the values the fill measured.
  - 88% of Gecko's repeats are totals asked again for every offset of one unit, which a field fixes.
  - Nobody has timed memo-off in a browser yet. X2 carries a tripwire.
  - Note, 2026-09-19, after X2: two of these didn't hold. The app path moved: the plain path asks 1.4 to 1.75 times its distinct questions in Gecko and WebKit and 4.1 to 5 times in Blink, where 70% of its repeats fall inside one `fillLine` call. And Gecko's unit total was already a field: its large repeat was the neighbour's suffix width, now kept per offset, and no field fixes the rest, which are strings that recur. Blink's wall time did hold (giants 55.3 s against 49.5 s). DESIGN.md §4.7, "What removing the memo cost", has the numbers and the two candidates that now lead §10.
- If no: the draft's per-offset tables filled on first read come into X2 now, with the critique's two corrections:
  - On an inspected paragraph a table never short-circuits, so gaps are raised as today.
  - Entries are `Entry | null` records, not typed arrays with masks.

## 2. Safe to start now, before the freeze

Yes, a few things. None touches `src`, `lab` or `tests` on any branch, and none produces code that round 4 must merge. Only item 5 needs a browser.

**0. Done while writing this plan: the memo-off replay.**
- Setup:
  - A scratch copy of r4-tests' library, with the memo removed from `measure/canvas.ts`.
  - APFS clones of the three frozen `no-facts` references under `.artifacts/tests/reference/`.
  - Each replay takes 7 to 12 s with 6 jobs.
- Result:

| | Cases | Predictions changed | New questions | Canvas questions |
|---|---|---|---|---|
| Chrome | 65,351 | 0 | 0 | 5.70M to 41.16M (×7.2) |
| Firefox | 62,437 | 0 | 0 | 4.51M to 7.29M (×1.6) |
| webkit-host | 62,653 | 0 | 0 | 1.46M to 9.56M (×6.5) |

- Every changed case asks the same questions again; none is dropped and none is added.
- Repeats by call site, on the development sets:
  - **Blink:** 85.5% of asks are repeats.
    - `pairAdjust16` 60.5%.
    - `windowAdjust16` 13.4%.
    - `groupPrefix16` 11.3%.
    - The script split inside `measure16` 7.6%.
    - `pairAdjustNoLigatures16` 6.1%.
  - **WebKit:** 78.1% of asks are repeats.
    - At least 81% of them sit under `lineGaps` and `itemGaps`, which only the lab runs.
    - Prepare's `boxWidth` 4.9%.
    - `mergedGlyphs` under `measureDomString` 2.2%.
  - **Gecko:** 41.5% of asks are repeats.
    - `w()` and `rangeAu` under `inWordAdvance` 88%.
    - Prepare's second stretch measure (`auIn`, gap-only) 8.9%.
- Patch, reports and tallies are in `<scratch>/memo-off/`.

**1. The citation and prose ledger.**
- A new file under `rebuild/tools/`, in a worktree of its own.
- Per engine folder it keeps a multiset of source citations, probe names and spec references in comments, plus every gap detail literal. With a multiset, a move passes and a deletion fails.
- Validate it by diffing bc49b0e against a5b4636, where the painter and `script-context` moved.

**2. The painter differential harness.**
- A recording document that serializes every attribute, style property and text node.
- A driver over a row file.
- A `bun build` step that bundles a frozen painter into one file.
- Validate it as the painter against itself over round 3's development rows.

**3. A deterministic stand-in Canvas and a two-tree driver.**
- The driver runs the same cases through two checkouts and compares the predictions.
- U+200D and letter spacing must change widths in the stand-in.
- Validate it as a5b4636 against itself.

**4. Scratch spikes, replayed against copies of the frozen references.**
- Copy each reference with `cp -cR`, for two reasons:
  - `replay.ts check` writes a `.work` folder inside the folder it reads.
  - The tests owner is freezing those folders again right now.
- The spikes:
  - Step X1 in WebKit: the decided line, history worlds, call order.
  - Step X1 in Blink: a null gap sink through `Shaper`, the end of the justification mutation, and plain equals inspected.
  - Gecko's stand-in reasons as a tagged union with byte-equal prose.
- They test the function set of §5.6 before three owners code against it, and they give the plain path's question counts.
- They are throwaway.

**5. The twin case family, as a scratch generator (optional).**
- The same string of 13 or more units of digits or brackets, once after Latin and once after Arabic, in one Amiri style of a segmented paragraph.
- Confirming the twin takes one short Chrome probe through the lock.

**Not safe yet:**
- Anything under `src`, `lab` or `tests`.
- The bench port and doc rewrites.
- The coverage map.
- Profiling.
- Recording sets again.
- The twin-string scan, which needs a tap inside `blink/shape.ts`, and the Blink owner has that file open.

## 3. What this phase does and doesn't do

The order is:
1. Simplicity from proper data structures and data flow, without over-simplifying.
2. Profile and optimize.
3. Decide the API shape.

Correctness doesn't move: every ported rule, citation, gap condition, probe order and observation port stays, and the row keeps its shape.

**In:**
- One home for each cross-cutting concern: gap reporting, measured values, output only the lab reads, and engine names in shared code.
- The engines' own model stays: inline tree input, a slot per line, a width-free first stage, then line filling.
- Accidental quadratics go where the fix is structural and the result is identical.

**Out (§10):**
- Any new store of Canvas answers.
- Fast paths, eager tables and the width-interval skip.
- Contexts created on first use.
- Any change to what is measured.
- Public API design, rich APIs, parity with current Pretext, and font loading.

## 4. The code today (a5b4636)

`src` has 21,141 non-test lines:
- shared 4,610, of which `paint.ts` is 1,395;
- Blink 5,946;
- WebKit 5,505;
- Gecko 5,080.

**Gap reporting threaded through measuring**
- **Blink:**
  - `Shaper = { p, m, gaps }` reaches every measuring function (`shape.ts:98-102`).
  - `measure16` raises gaps as a side effect (`:380-407`), through `joinedAtEdge` (`:165-179`) and `reportScriptContext` (`:458-482`). It does so on every call, memo hit or not.
  - There are 34 `addGap` sites: index 20, shape 13, line-breaker 1.
  - The line breaker has a gap-only method, `reportUncertainCandidate` (`line-breaker.ts:707-729`). Its `positionBounds` measures.
  - Geometry code raises into the line's list too: `clustersOf` (`index.ts:636-657`) and `hangWidthOf` (`:565`).
- **Gecko:**
  - `gaps: LineGaps | null` is a parameter of `glyphBefore`, `rangeAdvance`, `advanceWidth`, `scanAdvance`, `computeTabs` and the reflow functions (`lines.ts:491`, `:608-658`).
  - `prepareGecko` pushes gaps at 15 sites (`prepare.ts:629-1528`).
- **WebKit:**
  - `measure.ts` has no gaps.
  - Four sites push while a line is filled (`lines.ts:92-93`, `:695-696`, `:1270-1271`, `:1552-1554`).

**A string-keyed memo as the data flow**
- In `measure/canvas.ts`, a context is found by a joined string key, and `measureText` reads a `Map<string, number>` per context.
- Blink builds the Canvas string before every lookup (`shape.ts:395-397`).
- WebKit asks for `' '` through the memo at six sites (`measure.ts:149`, `:174`, `:200`, `:253`, `:284`, `:378`).
- Gecko has six module-level `WeakMap` memos (`lines.ts:57`, `:79`, `:320`, `:369`, `:488`, `:606`). One of them, `ligatureMemo`, is keyed by string.
- Gecko reads `m.log.contexts[...]` as state at six sites (`lines.ts:36`, `:252`, `:291`, `:411`, `:469`, `prepare.ts:515`).

**Output only the lab reads, computed on every line**
- **Blink:** `clustersOf`, `mappingOf` (`index.ts:1093-1127`), `lineEdgeGaps` and `itemEdgeGaps` (`:218-391`).
- **WebKit:**
  - `collectBoxFacts` and `collectHistoryWorlds` in prepare (`content.ts:538`, `:842`).
  - `lineGaps` (`lines.ts:2436-2583`).
  - `pageHistoryGaps`, which builds the line again in every history world (`:2650-2678`). Each world build runs its own `lineGaps` (`:2774`), whose result is discarded.
  - Display boxes for every line.
- **Gecko:**
  - `characters()` (`lines.ts:1354-1372`).
  - The in-word report (`:1916-1963`).
  - A second measure of every stretch, only for `space-in-shaping` (`prepare.ts:1265-1272`).
  - Stand-in reasons built as prose for every offset (`lines.ts:107-195`).

**Shared code that names engines**
- `src/index.ts` switches on the engine five times.
- `model.ts` imports three engines' types (`:5-7`). It holds their geometry (`:350-584`), the lab's row type and the observation contract (`:629-685`).
- `breaks/tables.ts`, `unicode/bidi.ts:53-64` and `unicode/grapheme.ts:17-23` select data by engine name.
- `paint.ts` branches on the engine at about 25 sites and imports Blink internals (`:55-56`).

**Other facts:**
- The width is read only while a line is filled:
  - `blink/line-breaker.ts:163`;
  - `blink/index.ts:1280`;
  - `webkit/lines.ts:2377` and `:2798`;
  - `gecko/lines.ts:1095`;
  - the painter;
  - `lab/observe/webkit.ts:315`.
- Blink's `lineOutput` runs `hangWidthOf` first (`index.ts:1137`). `applyJustification` then writes `r.justification` and `r.inlineSize` into the item results (`:1143`, `:785-788`), and `itemsOf` reads them. A second output of the same decided line would make `hangWidthOf` read justified sizes.
- Blink scans ICU boundaries to the text's end from every line start. It allocates two text-length arrays per line (`breaks.ts:134-168`).
- `UnportedFeature` is never thrown, and `ruleStatus()` has no caller.
- `bench/page.ts` doesn't compile.
- The painter takes, beyond the shared line fields and `slot`:
  - Blink's `needsAccurateEndPosition`;
  - WebKit's `boxes[].shapedAcrossBoxes`, plus the previous line's `next.offset` and `carriedWidth`;
  - each engine's overflow, used only as a sign (`paint.ts:90-103`, `:675`, `:697-702`, `:874-887`).
- Round 4's font-check resolver, as committed at aad3d5c in the font-checks worktree:
  - It names engines in `learnedFacts` and `withLearnedFontFacts`.
  - It keeps answers in a `WeakMap<Measurer, Map<string, Answer>>` with `JSON.stringify` keys.
  - It uses the memoized API.

## 5. Target

### 5.1 Stages, data and lifetimes

| Stage | Data | Made by | Lives as long as | Depends on width |
|---|---|---|---|---|
| Input | `Paragraph` (the inline tree) without `width`; the environment of `env.ts`; `LineSlot { width, left, right }` per line | the caller | the caller's scope | the slot only |
| Prepared | the engine's content, items, styles, break data and prepare-time widths; its Canvas contexts; references to the paragraph and the env; `inspect`, a record or null (§5.2) | `prepare` | the caller keeps it | no |
| Decided line | the engine's own record of one filled line: Blink `LineInfo` with its item results and views, WebKit's closed `Line` with its rect, Gecko's final pass. On an inspected paragraph it also holds the gaps raised while filling, in order. | `fillLine` | the caller's scope. Counting drops it. | yes |
| Pieces | fragments, `joinsNextLine`, `indented`, `align`, `overflows`, and the engine's facts for the painter | `linePieces` | the caller's scope | yes |
| Inspection | today's engine geometry and line gaps | `inspectLine` | the row | yes |
| Row | today's `ParagraphLayout` JSON | the lab adapter | the lab | yes |

Rules:
- Values that share a lifetime sit in one object.
- A value derived from a line is computed in the scope that asks, and is never stored on the line.
- Nothing mutates a decided line. Blink's justification writes its sizes into locals of the output.
- `next` and `hasLineBox` are fields of the fill result only.

### 5.2 Plain and inspected paragraphs, and one `gaps.ts` per engine

`prepare(paragraph, env, inspect)`. The mode is decided once and lives in `prepared.inspect`. No other boolean is tested anywhere.

- **A plain paragraph:**
  - It computes no gap, no limit, no clusters, characters, mapping or display boxes.
  - It asks no Canvas question that exists only for a gap.
  - `inspectLine` and `paragraphGaps` throw on it.
- **An inspected paragraph:**
  - It gives exactly today's gaps and geometry, in today's order, with today's Canvas questions in today's order.
  - The lab always prepares inspected paragraphs.

**`engines/<engine>/gaps.ts` owns every gap condition:** its test, its prose, its merge rule and its order.
- Nothing outside it builds a `Gap`.
- The rest of the engine calls it at the program points where today's code raises a gap. It makes one kind of call per kind of fact. For Blink the kinds are:
  - a measured range;
  - a view;
  - a reshape's HanKerning trims;
  - the hyphen;
  - tabs;
  - a break candidate;
  - the cuts.
- Each function returns at once when its sink is null.
- An expression that exists only to decide a gap is evaluated inside `gaps.ts`. Examples are `canvasScriptsPerUnit` at letter spacing 0, `positionBounds` and the no-ligature pair windows.
- Because the raise points stay where they are, order and merging stay the same, and byte identity follows by construction.
  - Note, 2026-09-19, after X2: this doesn't cover §5.3's flows in Blink. A raise rides on every `measure16` call, and `addGap` merges a range into the first entry it meets, so how ranges are grouped follows the number and order of raises; a value handed on in place of a repeated measurement regrouped 3 and 1 of 67,065 rows, and those two flows were taken back. X3 gives gap lists a canonical form (DESIGN.md §5; the comment beside `addGap` in `engines/blink/gaps.ts`).
  - Note, 2026-09-19, after X3: Blink's gap lists are canonical where they are handed out (`inspectLine`'s result, and the prepared paragraph's own list once `prepare` ends, which `paragraphGaps` copies), not where they are built: the line breaker's rewind cuts a list being built by length, so entries can't be merged away while it is built. 473 recorded Chrome rows without facts and 303 with them changed byte for byte, and all 67,065 cases of each configuration are equal after canonicalizing both sides. The two flows are back in. WebKit and Gecko got no canonical form: WebKit's raises come in one fixed order, and Gecko merges nothing (DESIGN.md §5).

**Merge rules are ported one by one, with no shared helper:**
- Blink merges by gap, run, detail and touching ranges (`blink/gaps.ts:9-24`).
- WebKit has six rules:
  - by gap and run (`lines.ts:92`, `:695`);
  - by equal range (`:1270`);
  - by overlap with extension (`:1552-1554`);
  - by gap, run and overlap, scanning from the end (`:2439-2447`);
  - by gap and run with extension and no overlap test (`:2669-2676`).
- Gecko pushes without dedupe and sorts the in-word report (`lines.ts:1959-1962`).

**A Canvas question is gap-only** when deleting it, and the gap it feeds, leaves every `fillLine` result unchanged. Owners classify by reading, and check 1 (§7) proves it.

**Why a mode, and not gaps derived from the decided line:**
- Blink's and WebKit's lists include conditions of probes that decided nothing.
- The scorer takes the first matching gap.

**One vocabulary for three owners:**

| Idea | Same everywhere | May differ per engine |
|---|---|---|
| Where gaps go during a fill | `GapSink = Gap[] \| null`, the first parameter of every `gaps.ts` function; null on a plain paragraph | nothing |
| What prepare keeps only for inspection | `prepared.inspect: <Engine>Inspect \| null`, one record that holds the paragraph's gaps, plus WebKit's gap-only box facts and worlds | its fields |
| Fill-time gaps | `line.gaps: Gap[] \| null`, in raise order, across every pass of the fill | nothing |
| Raw facts kept for a later report | integers on the decided line, never prose (Gecko's consulted offsets) | which facts |
| `gaps.ts` exports | `paragraphGaps(prepared)`, `lineGaps(prepared, line)`, and one function per kind of fact raised during a fill | the per-fact functions |
| A value Canvas can't confirm | `{ value, standIn: Reason \| null }`. `Reason` is a tagged union that carries the numbers the prose prints. Prose is printed only in `gaps.ts`. | the union's cases |
| Painter | `engines/<engine>/paint-rules.ts` exports one `PaintRules<Facts>` | `Facts` |

### 5.3 Measured values (decision 4)

- There is no lookup by string and no call log. `width(context, text)` and `bounds(context, text)` always call Canvas.
- X2 adds no stored measurement that today's code doesn't already store. What is stored today gets one plain place:
  - WebKit item widths.
  - Blink group cuts and prefixes.
  - Gecko unit widths.
  - Per-style constants that prepare measures.
  - Blink's `canvasSplitsWords` per style.
  - Gecko's per-offset in-word facts. They are one array on the prepared paragraph, indexed by transformed offset, with `Entry | null` records holding `{ au, standIn, the suffix width it measured, ligature, group, row and span facts }`.
- Repeats go away through flow, never through a lookup:
  - a local;
  - a candidate's measured width handed to the commit;
  - the fill's measured values handed to `lineGaps` through the decided line;
  - a field set in prepare at the point prepare already measures the value.
- Nothing is asked earlier than today. The replay can't answer a question the record lacks.
- The number that shows progress is the **ask ratio**: Canvas questions asked, divided by distinct (context, string) pairs asked, per engine and per path.
  - With the memo it is 1.00.
  - With the memo off at a5b4636 it is 7.2, 6.5 and 1.6 for Chrome, webkit-host and Firefox, on the inspected path.
  - X2 reports the ratio with the remaining repeats by call site.
  - It sets no threshold, only a tripwire (§8).
- Shared layer:
  - `Context = { settings, ctx }`.
  - `contextFor(contexts, settings)` scans the few contexts and compares fields. It sets `ctx.lang` before `ctx.font`.
  - `partition` stays.
  - `prepare` makes the paragraph's contexts and keeps them on the prepared paragraph, as `src/index.ts:40` does today.
  - No function takes a measurer.
  - Engines hold `Context` references in their style, box and run records.
- The lab counts calls and contexts with its own wrapper on the two context prototypes' `measureText`. Arguments pass through untouched.

### 5.4 The shared layer names no engine

**It keeps:**
- `model.ts`: the input tree, font facts, `Fragment`, `Gap`, `GapName`, `LineSlot` and `LinePieces<Facts>`.
- `content.ts`.
- `measure/`.
- The library ports as algorithms that take their data as a parameter: rbbi, icu4x, ubidi, unicode-bidi and graphemes.
- `paint.ts` as an engine-free core, after step 3.

**Two shared files may name engines:**
- `src/index.ts`, the one dispatch over a tagged prepared union.
- `src/env.ts`, whose serialized shape is part of the row.

Outside comments, no other shared file holds any of these. A test checks it (check 8):
- an import path containing `engines/`;
- a string literal `'blink'`, `'webkit'` or `'gecko'`;
- an identifier matching those names.

**It loses:**
- Engine geometry types and the line start types, which go to `engines/<engine>/geometry.ts`.
  - They are types only, and the one engine file the lab may import.
  - The row stores every line's `next` whole, so the start types are as frozen as the geometry.
- `ParagraphLayout`, `LineOf`, `LineResultOf`, `BelowFloats` and the observation contract, which go to the lab.
- The slot-row loop with refusals (`index.ts:116-138`), which goes to the lab adapter.
- `engines/engine.ts`, the memo, the log and `measure/log.ts`.
- The data selectors. Each engine builds its own `BidiData`, grapheme rules and break rules.
  - Shared generated data stays shared and is named by where it comes from: Unicode 17, libicucore 78.1, unicode-bidi 15.
  - Only data with one consumer moves under `engines/<engine>/generated/`: the two break-table files and Gecko's break data.
  - They move with `git mv`, and the gate is equal file hashes.

**The font checks stay called once from `src/index.ts`, before the engine.**
- Each engine exports what differs as data: which facts it reads, the zoom, and whether the context takes `lang`.
- The resolver resolves each distinct declaration of the paragraph once, in a list local to the call and compared by field.
- There is no `WeakMap` and there are no `JSON.stringify` keys.

### 5.5 The lab adapter and the frozen row

- The serialized `prediction.layout` is a frozen format, key order included, because the replay compares it as JSON. The format is `{ engine, env, lines, belowFloats, gaps }`, with every line's fields.
- `lab/predictor-core.ts` is the one lab file that imports library logic.
- Per line the adapter calls `fillLine`, then `inspectLine`, then `linePieces`. This is today's order of Canvas questions:
  - Blink: fill, `lineEdgeGaps`, `itemEdgeGaps`, then hang, justification, mapping and items.
  - WebKit: fill, `lineGaps`, display boxes, then the worlds.
- `inspectLine` keeps today's internal order. A refused slot gets `inspectLine` only.
- The adapter writes the fields the library no longer carries:
  - `slot` as `{ left, right }`;
  - the `engine` tag on `next`;
  - `prediction.measure`, from its own counter, with `memoHits: 0` once the memo is gone.
- Case files keep `paragraph.width`. The lab's own `Paragraph` type already differs from the library's, and the adapter puts the width into every slot.

### 5.6 Engine functions (working names)

```ts
prepare(paragraph, env, inspect: boolean): Prepared
firstLine(prepared): Start | null
fillLine(prepared, start, slot):
  | { kind: 'line'; line; next: Start | null; hasLineBox: boolean }
  | { kind: 'below-floats'; line; next: Start }
linePieces(prepared, line): LinePieces<Facts>    // what a painter takes
inspectLine(prepared, line): { geometry; gaps }  // inspected only; a refused slot gives gaps without geometry
paragraphGaps(prepared): Gap[]                   // inspected only; the engine-build gap first
```

```ts
type LinePieces<Facts> = {
  fragments; joinsNextLine; indented; align
  overflows: boolean
  facts: Facts
}
```

- The painter core is generic over `Facts` and never looks inside.
  - Blink's facts are `{ needsAccurateEndPosition }`.
  - WebKit's are `{ carriedWidth, shapedAcrossBoxes }`, taken from the decided line, so the limits need no display boxes.
  - Gecko's are empty.
- The painter's input per line is `{ pieces, slot, hasLineBox }`.
- `linePieces` and `inspectLine` are pure functions of their arguments.

## 6. Per engine

### Blink

**Prepared:**
- `text` and its per-unit arrays.
- Items as a tagged union.
- One style record that absorbs `settings`, `contexts`, `hanKerning` and `canvasSplitsWords`.
- Groups with `cuts` and `prefixAtCut`.
- Arrays only inspection reads, such as `collapsedAt`, are built by inspection.
- There are no per-offset measurement arrays (§10).

**Decided line:**
- `LineInfo` with its results and views, the start and the slot.
- `decisionEnd`, `untestedEnds`, `breaksInsideWords` and `truncatedStarts`, as now.
- Reshape records hold their own measured positions for the line's life.
  - Note, 2026-09-19: not built in X2. A reshape's own positions (`callPrefix16`) are 0.1% of Blink's repeats.
  - Note, 2026-09-19, after X3: still not built. It is a store of measured values, which decision 4 keeps for after profiling, and it would answer 0.1% of the repeats.

**`gaps.ts` takes:**
- `joinedAtEdge`'s conditions. The function becomes a pure "is U+200D added here".
- `reportScriptContext`, with its script work at letter spacing 0.
- The HanKerning, float32, `glyph-clusters`, `hyphen-glyph`, `tab-stops` and cut gaps.
- `reportUncertainCandidate`, `edgeGap`, `lineEdgeGaps`, `itemEdgeGaps`, `contentGaps` and `prepareGaps`.

**Computed only by `inspectLine`:** `startLimit`, `sizeLimit`, clusters and mapping.

**Moves verbatim, never restructured:**
- `canvasString`. It is the only constructor of Canvas strings, and the replay can't see string storage.
- `offsetForPosition`'s probe order.
- The view, part and segment bookkeeping.
- `floatWidthOfParts`.
- The ICU restart at every line start, with `adoptText` on today's string.

**X3, structural and result-identical. Each fix states its exact predicate:**
- The ICU and grapheme scans pull boundaries as the line asks.
- The line-break iterator and its arrays stop being built per line.
- The per-line `shapeResults` Map goes.
- Output stops scanning the whole paragraph per line:
  - `fragmentsOf` over all events (`index.ts:491`).
  - Box states from item 0 (`:863-867`).
  - `generated()` (`:1105-1113`).
  - `groupAround` (`:200-203`) becomes `g = groupOfUnit[k]; return g >= 0 && groups[g].start < k ? g : -1`, which stays strict on both sides.
- `scriptsPerUnit` isn't run where its result is discarded.
- Notes, 2026-09-19, after X3:
  - `groupAround` also needs `k < text.length`, since the content end can be `text.length`.
  - "The line-break iterator stops being built per line" came to mean its eager scan and its arrays. ICU restarts at every line start with no prior context, so an iterator object per line stays, as in Blink.
  - The browser's dictionary segmentation isn't pulled lazily: `lab/record.ts` stores what `next()` returned, so a partial pull would record a partial segmentation. It is asked once a dictionary segment is reached.
  - The per-line `shapeResults` Map became an array by item index and didn't go: dropping it would ask an item's result again after a rewind.
  - The import cycle went from five files to `shape.ts`, `limits.ts` and `gaps.ts`. No split removes it while one `gaps.ts` owns every condition (§5.2).

### WebKit

**Prepared:**
- Boxes with the fields line breaking reads.
- Items with stored widths.
- Per-box constants that prepare measures today.
- In `prepared.inspect` only:
  - the history worlds;
  - the gap-only box facts: `monospaceUnknown`, `hyphenUnknown`, `unverifiedCoverage`, `primaryFamilyUnknown`, `pairKerningUnknown`, `localeChoosesFonts` with its two contexts, `hanLocaleUnknown`, `quoteLocaleUnknown` and `dictionaryRangesStartingWithMark`.

**Decided line:**
- The closed `Line`, its rect, the last-line flag and the carried width.
- `{ measuredEnd, reverted, decisionStart, overflowStart, shapedCarry }`.
- The widths the fill measured, for `lineGaps`.
  - Note, 2026-09-19: not built in X2. In WebKit the fill measures almost nothing that `lineGaps` asks again: of the 2.44 M questions a line's own inspection repeats without facts, 1.69 M were first asked by prepare, 0.74 M by inspection itself and 15 thousand by the fill. Handing prepare's derivations over needs X3's item model.
  - Note, 2026-09-19, after X3: X3 didn't build that hand-over either. `measure.ts` knows nothing of inspection, so the record would come back from every measuring call or sit behind an inspected-only branch inside measuring, for a gain only the lab sees (about 1.5 M of the lab path's 3.6 M repeats without facts). Stored widths are written at two sites and read at one, so it fits there later.
- On an inspected paragraph, the fill-time gaps in order. `lineGaps` is seeded with them, and its dedupe reads them.

**`gaps.ts` takes:**
- The four fill-time sites.
- `lineGaps`, `pageHistoryGaps`, `collectBoxFacts` and `collectHistoryWorlds`.
- The LastResort comparison for `unverifiedCoverage` (`content.ts:275`). The coverage measure that decides `simplifiedMeasuring` stays in prepare.
- `hyphenGlyphsDiffer`.
- Note, 2026-09-19, after X3: the history worlds and `pageHistoryGaps` are `engines/webkit/history.ts`, not `gaps.ts`. A file that takes the fill's raises and also fills lines in worlds imports `lines.ts` both ways, which was the cycle. `gaps.ts` keeps `page-history`'s prose and merge rule as a raise function, and imports neither the fill nor the content stage. `collectBoxFacts` is gone: a box's inspection record is made with the box.

**History worlds:**
- `inspectLine` is built from two internal functions, `displayBoxes(prepared, line)` and `lineGaps(prepared, line)`.
- In X1 a world is prepared, filled and inspected as today, its discarded gap work included. Tier 1 then stays at exit 0.
- Dropping that work is in §10.

**Data flow:**
- A width measured for a candidate travels to the commit.
  - The TAB path is the exception: the candidate and the commit measure at different float32 positions (`lines.ts:1185`, `:1102`). Both measurements stay.
- Items and `LineRun` become tagged unions.
- `isDelimiterQuote` reads a list derived once at module load.
- The last-line scan exits at the first contentful item (`lines.ts:1817`).

**Unchanged:**
- `breakWord`'s probe sequence.
- `carriedWidth`.
- The three builders and their differences.
- Every float32 sum in source order: no Float64 accumulators and no regrouping.

### Gecko

**Prepared:**
- Leaf records instead of five parallel arrays.
- Text runs that hold their `Context`. The six `m.log.contexts` reads become `run.context.settings`.
- Units.
- The per-offset records of §5.3.
  - They replace five of the WeakMaps.
  - `groupEndMemo` becomes a field of the frame's provider.
    - Note, 2026-09-19: it has no successor. A field set when the provider is made would move first asks, and one set on first use could be written after the fill, so `groupEndSpacing` reads the per-offset records on every call.
  - `ligatureMemo`'s answer becomes a field of the offset's record. The same pair at another offset is then asked again, which is a repeat and not a new question.
- `emergencyUnconfirmed` becomes flags per offset.
- `Provider.tabs` becomes a sorted array.
- `scriptLimits` becomes a moving index.
  - Note, 2026-09-19, after X3: `emergencyUnconfirmed` became a list in text order, not flags per offset. It holds few entries, one membership test runs per line such a break decides, and flags would cost a byte per unit of text on every inspected paragraph. `scriptLimits` went with the second unit scan: the real redundancy was that units were cut twice, and they are now cut once, in the port of SplitAndInitTextRun.
- The item, style and frame lists of all three engines keep today's order and length, because the row's `next` names their indices.

**Decided line:**
- The final pass's placed frames, status and band.
- On an inspected paragraph, collected across every pass of the fill, in order:
  - the consulted stand-in offsets, recorded at `glyphBefore`'s one site;
  - the emergency-hyphen `font-fallback` (`lines.ts:1004`).
- `reflowLine` hands one list to both passes today (`:1324-1327`). "Past the end" reads offsets only the dropped pass consulted.

**`gaps.ts` takes:**
- Prepare's 15 sites with their gap-only measuring. The second stretch measure is one of them, and the owner classifies the rest by the rule of §5.2.
- The in-word report.
- The consulted record.

**Computed only by `inspectLine`:**
- `characters()` and the justification spacing per character. It computes the characters before the in-word report, as today.
- The trim and hang needed for `overflows` come from `linePieces`.

**First flow fix in X2:** the unit's total and the neighbour's suffix width are read from the records, not asked again for every offset (`inWordAdvance`, `lines.ts:156-182`). Today the string memo hands them over.

**Unchanged:**
- The linear break scan.
- The single redo.
- The `W(unit) − W(suffix)` recipe, quadratic cost included (§10).

## 7. Gates

Round 4 provides the tiers.

- **T0:** `bunx tsc --noEmit` over the four projects, and `bun test rebuild`.
- **T1:** `bun rebuild/tests/replay.ts check --browser=all --config=all`. It takes about 10 s a reference.
  - It compares each case's layout, the observation port's output and the painter's limits with the frozen reference, and the questions asked.
  - Exits: 0 when every case is the same, 1 when a prediction changed, and 3 when predictions are equal but questions differ.
- **T2:** `bun rebuild/tests/browser-sets.ts --browser=<b> --out=<dir>`. Pinned browsers, build-keyed seeds, 0 ledger transitions. Forward order while iterating, `--both-orders` at milestones.
- **T3:** the full evaluation (fresh sets, giants, the installed Safari spot check), once at the end.

**Every step states the T1 exit it expects.** Under exit 3, every differing case must classify as one of:
- **repeats only:** the same set of (context, string), with first occurrences per context in recorded order. This is provable offline, for two reasons:
  - Measuring the same text again on a context returns the same bits in all three engines (`measure/canvas.ts:10-13`).
  - A repeat can't reorder two different strings.
- **dropped only:** a subset of the recorded questions. It is accepted only where a step names what it drops: the plain path, and named gap-only work.

Anything else fails, and so does any new question.

After a step with exit 3 passes its browser runs, the orchestrator freezes the questions again:
- It uses `freeze --force --reason`.
- It first checks that the new reference's predictions are byte-equal to the original's.
- Predictions are never frozen again, and step 4 compares with the original reference.

**Checks added in step 0:**
1. **Plain equals inspected.**
   - Per case under replay, `fillLine` and `linePieces` from a plain paragraph equal the inspected ones.
   - The plain path's questions are dropped only.
   - The check reports the plain path's ask ratio.
   - Note, 2026-09-18, after X1: the check as built also wanted the plain path's first asks in the lab path's order, as tier 1 wants of dropped questions. All three ports failed that rule and nothing else. No path that asks less can keep the order: the lab's path asks inspection's questions between two fills, so a later fill's repeat of one is a memo hit there and a first ask on the plain path. The check now fails on a question the lab's path didn't ask and on more contexts, and counts the cases whose first asks come in another order. The plain predictor's browser run covers order, at every milestone that changes the plain path's questions. The header of `rebuild/tests/function-set.ts` has the rule.
2. **Purity.** `linePieces` and `inspectLine` give the same result twice and in either order.
3. **Width sweep on the stand-in Canvas.** One prepared paragraph filled at several widths equals fresh prepares. Under replay another width asks new questions, so this can't run there.
4. **Ask ratio and sites.** `check --sites` tallies asks and repeats by library call site, from the stack inside the replay's context. Nothing goes in `src`.
5. **Coverage map.** Lines of `src` the replay sets never execute are listed per engine. They move verbatim.
6. **Citation and prose ledger** (§2, item 1).
   - In addition, there is no new stale pointer and no lost annotated rule id in `tests/coverage.ts`'s report.
   - An owner who moves a test updates its engine's entries in `tests/rules.json` in the same commit.
7. **Painter differential.**
   - The frozen painter bundle paints each reference row.
   - The working side replays the case, takes `linePieces` and paints with the working painter.
   - The full serializations must be byte-equal.
   - Limits are checked by T1.
8. **Independence.**
   - The rule of §5.4 holds, `src/measure/` included.
   - Engines import no other engine.
   - Outside its adapter, the lab imports only `model.ts`, `env.ts` and the three `geometry.ts`.
9. **The twin family in the recorded sets** (recommended; §2, item 5). A reordered twin then shows offline as a changed prediction.

## 8. Order of work

Every owner works in a git worktree of their own under `~/github/pretext-rebuild-wt/`, and the orchestrator merges. T1 is each owner's inner loop. Browser jobs take the lock themselves. Owners return text for DESIGN.md, CHARTER.md and TESTS.md, as in round 4.

### Step 0. Reference and checks

Owners: the tests owner, plus the shared owner for tools. The library doesn't change.

- Freeze the reference at the round 4b commit, in both configs and all three browsers.
- Change `tests/replay.ts`:
  - Add the classification of §7, asked and distinct totals, and `--sites`.
  - `memoHits` leaves `Questions`.
  - `contexts` counts the replay's own contexts, so the tool stops reading `layout.measure`.
  - The `.work` scratch folder moves out of the reference folder (`:559`). Today two checks on one folder trash each other's work, and parallel owners share `.artifacts`.
- Add:
  - checks 1 to 9;
  - a script that compares a `LinesPrediction` run's ranges with another run's layout predictions.
- Record baselines:
  - the giants' time per browser, under the exclusive lock;
  - T2's forward wall time per browser.
- Exit:
  - T1 of the frozen tree against itself is 0.
  - The painter differential and the ledger are clean against themselves.

### Step 1. Shared layer

One owner, three steps in sequence.

**S1. The lab owns the row.**
- Moves out of `model.ts`: `ParagraphLayout`, `LineOf`, `LineResultOf`, `BelowFloats` and the observation contract. They go to `lab/types.ts` and a new `lab/observe/contract.ts`.
- Moves out of `index.ts`: `layoutParagraph` and `fillLines`. They go to `lab/predictor-core.ts`.
- Files: every importer of those names. Find them with `grep -rln 'ParagraphLayout\|layoutParagraph\|LineResultOf\|LineOf\b\|BelowFloats\|ObservationPort\|ExpectedObservation' rebuild`. Today that is:
  - `lab/{page,predictor-core,record,row-fixtures,score,types}.ts`;
  - `lab/observe/{blink,gecko,webkit}.ts`;
  - `tests/replay.ts`;
  - `bench/{page,protocol}.ts`;
  - `src/engines/webkit/lines.ts`;
  - `src/engines/gecko/gecko.test.ts`, which gets a local slot loop because `src` can't import the lab's;
  - `src/paint.ts`;
  - plus `lab/port-measure.ts`, `lab/baselines/no-facts-predictor.ts`, `probes/{page,types}.ts` and `tests/independence.test.ts`.
- Gate: T0, and T1 exit 0.

**S2. Shared code stops selecting engines.**
- New:
  - `engines/<engine>/geometry.ts`, from `model.ts:302-339` and `:350-584`.
  - The single-consumer generated data under `engines/<engine>/generated/`, with the output paths in `tools/gen-*.ts`.
  - Each engine's own `BidiData`, grapheme rules and break rules.
- The font-check resolver stops naming engines (§5.4).
- Deleted:
  - `engines/engine.ts`.
  - rbbi's unread rule status.
  - The selectors in `breaks/tables.ts`.
  - `bidiDataFor` and `graphemeRulesFor` for every caller but `paint.ts`, which loses them in step 3.
- Gate: T0, T1 exit 0, moved files' hashes equal, and check 8 with one listed exception for `paint.ts`.

**S3. Width in the slot, and the function set.**
- `model.ts`:
  - `LineSlot.width` is added.
  - `Paragraph.width` and `FULL_WIDTH` go.
  - `LinePieces<Facts>` is added.
- The five engine width sites and `lab/observe/webkit.ts:315`.
- Each engine's `index.ts` implements §5.6 over today's `nextLine`, with inspection always on inside until the engine's X1. This is code that runs, not a bridge to keep.
- `src/index.ts` becomes the dispatch, without a measurer parameter.
- `measure/canvas.ts` gets `Context`, `contextFor`, `width` and `bounds`, beside today's index API and over the same contexts.
- The font checks move to them, with the call-local list.
- Also:
  - the adapter with the call order of §5.5;
  - the three ports' signatures;
  - `lab/page.ts`, `lab/cases/family-widths.ts`, `lab/baselines/*.ts` and engine tests;
  - `tools/lines.ts`;
  - new `lab/baselines/plain-predictor.ts`, which returns a `LinesPrediction` from a plain paragraph;
  - a Chrome predictor that fills at two other widths first on the same prepared paragraph;
  - `bench/page.ts`, rewritten so it compiles, with count, pieces and inspect modes.
- Docs: DESIGN §2.1, §2.8, §2.9, §4.6 and §8.1, and the lab and bench READMEs.
- Gate:
  - T0.
  - T1 exit 0 in both configs.
  - Check 3.
  - Then T2 forward once in all three browsers.

### Step 2. Three engine owners in parallel

Files for each owner: all of `engines/<engine>/` and its generator. The `geometry.ts` types don't change.

**X1. Gaps get their home, and plain and inspected become real.**
- Contents:
  - The decided line.
  - Pure `linePieces` and `inspectLine`.
  - `gaps.ts` with the vocabulary of §5.2.
  - Nothing gap-only on a plain paragraph.
- Per engine:
  - Blink: the justification mutation ends.
  - WebKit: box facts and worlds move under `prepared.inspect`.
  - Gecko: `gaps | null` leaves every measuring signature.
- Deleted:
  - The engine's scattered gap building.
  - S3's wrapper. No `nextLine(` is left in `engines/<engine>/`.
- Gate:
  - T0.
  - T1 exit 0.
  - Checks 1, 2 and 6.
  - One forward browser run of the development sets with the plain predictor:
    - Its line ranges must equal the inspected run's predictions.
    - Its native observations are compared with the inspected run's using `lab/compare-rows.ts`.
    - A native difference is a history effect of the smaller question set, and goes to the ledger as such.

**X2. The memo goes.**
- Contents:
  - Every read becomes `width` or `bounds` on a held `Context`.
  - The engine stops importing the memoized API, context indices and the log.
  - Gecko's WeakMaps and log reads go (§6).
  - Then come the flow fixes of §5.3, starting from the sites `check --sites` names.
- Gate:
  - T0.
  - T1 exit 3 with every case repeats only and 0 new questions.
  - Checks 1 to 4.
  - A grep for string-keyed Maps.
  - T2 in both orders for that engine.
  - Blink adds the other-widths-first predictor in Chrome. Its rows must equal the reference predictions.
- Report the ask ratio for both paths, and the remaining repeats by site.
- Tripwire: T2's wall time and the giants stay within 2× step 0's.
  - If it trips, fix flow at the top site.
  - If flow can't fix it, the site goes to the orchestrator with its count, as the candidate for §10's first item.
- The questions are then frozen again.
- Note, 2026-09-19: X2 and step 3 are merged. DESIGN.md §4.7 has the ask ratios of both paths, the one trip of the tripwire and the decision on it; §10's first two rows are the candidates X2 sent on.

**X3. Model clean-up.**
- Contents:
  - Tagged unions, records for parallel arrays, no sentinels.
  - Map and Set only where the algorithm needs them.
  - The structural fixes of §6.
  - Dead fields and what knip finds.
  - List order and length stay (§6, Gecko).
- Gate:
  - T0.
  - T1 exit 0, or exit 3 with repeats only or fewer repeats.
  - T2 in both orders.
  - The giants set in the browser under the exclusive lock, with predictions byte-equal to the frozen giants rows and the time not worse.
- Note, 2026-09-19: X3 is merged for the three engines. The clean-ups moved no row and no question. Three Blink jobs merged with it change recorded Chrome rows: canonical gap lists with X2's two flows back (§5.2), the painter's script rule in an RTL block, and no unused one-byte hyphen contexts. Chrome's references are frozen again at this merge.
  - Not built, with each owner's reason. WebKit's item hand-over: it needs a record returned from every measuring call or an inspected-only branch inside measuring, for a gain only the lab sees (§6). Blink's reshape records that hold their own positions: a store of measured values, worth 0.1% of the repeats (§6). Gecko's flags per offset for `emergencyUnconfirmed`: a short list in text order does it, where flags would cost a byte per unit of text on every inspected paragraph (§6).
  - Line counts did not come down (non-test lines: Blink 7,118 to 7,195, WebKit 6,132 to 6,074, Gecko 5,848 to 5,850). X3 removed state and reads that cut across stages; the ports are mostly ported logic with citations (DESIGN.md §3).
  - "Dead fields and what knip finds": knip sees exports, not record fields. The owners found dead fields by looking for readers.
  - The tripwire's single timed run isn't enough on a shared machine: in Firefox the lab's own native and observation steps, which no tree changed, took 1.6 and 2.1 times as long in one of two back-to-back exclusive runs. Alternating pairs settled it (lab README, "Baselines for the tripwire").

Docs per engine: DESIGN §3, §4.4, §4.5 and §5 for that engine, and its `specs/*-RESULTS.md`.

### Step 3. Painter

Owner: shared. It starts when the three X1 have merged, and runs beside X2 and X3.

- `paint.ts` becomes an engine-free core over `{ pieces, slot, hasLineBox }` per line, the container width, the below-floats rows and a `PaintRules<Facts>` value.
- Each engine exports its rules from a new `engines/<engine>/paint-rules.ts`, as data plus a few functions typed by the core:
  - the hyphen span's style;
  - the hanging-space form;
  - which box decides the line end's wrapping;
  - the soft-wrap condition;
  - Blink's U+061C script mark with its script data;
  - Gecko's letter spacing at a run's end;
  - WebKit's tab-as-itself text and storage-class text nodes;
  - the HanKerning trim exception;
  - each engine's limits;
  - its `BidiData` and grapheme rules.
- Deleted:
  - the imports of Blink internals;
  - the last data selectors;
  - check 8's exception.
- Gate: T0, T1 exit 0 (limits), check 7, and T2 with painter observations unchanged.
- Docs: DESIGN §7.

### Step 4. Last deletions and the final proof

Owner: shared.

- Delete the memoized API, the log and `measure/log.ts`.
  - The adapter's counter takes over.
  - `tests/replay.ts` and `lab/record.ts:204-223` lose the library log. The record's `declared` field has no reader and goes with it.
- Run knip.
- Inventory and remove stale scripts: session workflows, per-round tools under `.artifacts`, `rebuild/tools` and lab scripts.
- Update CHARTER wording per decision 1, and TESTS.md.
- T2 in both orders, both configs and all browsers.
  - The plain predictor runs again.
  - The other-widths-first predictor runs in Chrome.
- T3.
- The ledger shows 0 transitions against the original frozen reference.
- Note, 2026-09-19, after step 4's deletions and documents:
  - The code had moved ahead of this list. `lab/record.ts` lost the library log and the record's `declared` field at S3,
    and step 0 took `memoHits` out of the replay's questions; what was left of the library log in `tests/replay.ts` was
    its reading of reference format 1, which held the memo hits and which no frozen reference is any more.
  - Deleted: the index API with its memo and log, `measure/log.ts`, `LineOf` and `LineResultOf` in `model.ts` (their
    comments and citations are on `FillResultOf` and `LinePieces`; the ports' test helper has its own line type), two
    exports only their tests read and an unused lab type (knip), and `tests/seed-facts-20260916.sh`. Knip found nothing
    in the ports. Tier 1: the same on all 389,646 cases, 0 questions changed; exit 3 for Chrome by the string storage rule
    alone, and Chrome's tier 2 forward in both configurations showed 0 transitions.
  - Not in the step, by the orchestrator's decision: the measurer's lifetime (contexts and font-check answers held by an
    object the caller makes once), which §9 already left out and §10 lists; it is the first item of the profiling phase,
    by the benchmark's measured shares (research/PROFILING-START.md). And the final proof (T2 in both orders with the
    plain and other-widths-first predictors, T3), which the orchestrator runs once this step and the correctness round
    beside it are both merged.

## 9. Not in this phase

- A shared measurer or contexts across paragraphs.
- A loader or per-engine bundles. Each engine's `index.ts` stays importable on its own.
- Public API design, `lineGeometry` for apps, and userland segment access.
- Parity work with current Pretext.
- New gap semantics, and unifying merge rules.
- Removing dead row or `env` fields. One follow-up after the phase can drop `slot`, `next.engine` and `memoHits` under a new row format.
- Support checks for main's demos and for rich `pre-wrap` (log, 04:40 items 3 and 4).
- The accepted cost: a long stretch without spaces stays seconds in Firefox on its first layout. A 9,428-unit Chinese paragraph took about 11 s.

## 10. After profiling, not before

All numbers are ungated ballparks, except the counts of the first three rows. The first two rows were added on 2026-09-19, from X2's reports, with gated numbers (DESIGN.md §4.7).

| Candidate | Evidence |
|---|---|
| Units of equal text in one prepared paragraph share one record of what measuring found (2026-09-19; Gecko's X2 report) | With the memo gone a string that recurs is measured at each occurrence. Firefox's giants take 15.3 s of prediction on the inspected path against 4.2 s (3.6×, the one trip of X2's tripwire; their plain path 1.28×): a giant is 18,000 to 47,000 words, a fifth to a half of them distinct, and the English one asks 843,386 questions for 54,673 distinct ones. Over the tier sets Gecko's ask ratio is 1.66 on the lab path and 1.41 on the plain path, 2.9 M repeats, every one a string that recurs. The engine's own structure there is the shaped-word cache (gfxFont.cpp:3569-3577). The record has the prepared paragraph's lifetime, so it can't go stale or leak. It must not share where a recipe reads text outside the unit: `scriptContextFor`'s character from elsewhere in the script run, and the font-matching prefix path. The same idea covers WebKit's repeated words (267 thousand of the plain path's 844 thousand repeats). |
| Per-fill positions and safe flags kept on the item's shape result, in Blink (2026-09-19; built unmerged on `ra-x2-blink-alt-positions`, d63c427) | 70% of the plain path's repeats fall inside one `fillLine` call: the start's position, the binary search, the safe tests and the view's edges ask about the same offsets. With the positions kept, the plain path's ask ratio goes from 4.11 to 2.95 without facts and from 4.98 to 3.50 with them, fill asks fall 42% on a sample, tier 1 stays repeats only, and checks 1 and 2 pass on 67,065 cases in both configurations. It is read back on plain paragraphs only: on an inspected one a measurement left out regroups gap ranges until gap lists have a canonical form (X3). Chrome's wall time barely moves either way, since its per-canvas cache answers a repeat. |
| Per-offset tables filled on first read: Blink positions and pair, wide and no-ligature adjustments; WebKit's per-cluster facts in letter-spaced boxes | Memo off, 60.5% of Blink's repeated asks are `pairAdjust16` at an offset already computed. The perf look got 4 to 5 times faster relayout. On an inspected paragraph the table must never short-circuit, or must replay gaps. Blink's adjustments depend on the shaping call's range as well as the offset. |
| Constants hoisted into prepare-time fields (WebKit's `' '`, hyphen widths) | They add questions, so they need browser proof. |
| Dropping a history world's discarded gap work | It speeds up only the lab. It is a "dropped only" step with one browser run. |
| Shared measurer, or shared contexts, across paragraphs | 200 messages in Chrome make 400 to 800 canvases. The perf look got 2 to 3 times faster on cold short texts. It needs a three-order browser run first, and font checks then run once per font. |
| A bounded store for strings that recur | Measure what flow fixes leave. A repeated `measureText` costs about 0.2 µs in Chrome. |
| Contexts created on first use | Blink makes five per style per paragraph (`shape.ts:85-92`). |
| Filling measured values in prepare, or a "words" variant | Prepare came to about 0.55 to 1.17 times main's, with no Canvas call at later widths. It changes which questions are asked. |
| A relayout loop over flat arrays, with the general path as fallback | 4 to 25 times faster than main's `layout()` on plain left-to-right text. About 57% of lines fall back at narrow widths. |
| The width-interval skip | A resize drag over 200 messages ran at 0.08 times main. It was sound over 100,200 checked layouts. |
| Gecko windows inside long units | 44.6M characters sent to Canvas became 0.34M on 9,000 Chinese units. It changes the recipe. |
| Blink cuts beside every safe space | Corpus calls went from 5,112 to 2,520. It moved gaps in 4 of 80 outputs. |
| Blink canvases by each string's own storage class | It removes the twin hazard by construction, but changes which canvas measures what. Done for segmented paragraphs, the only kind that asks both storages of the same characters, by the string storage fix after the line (`shape.ts` `contextsOf`; research/BLINK-STRING-STORAGE.md). |
| Bounding WebKit's `simplified-measuring` check | 28.5M characters for one 30,000-character word, on the inspected path only. |

## 11. Risks to correctness, and the check that catches each

| Risk | Check |
|---|---|
| **String storage class in Blink.** The replay compares characters only. | `canvasString` moves verbatim and stays the only constructor. No tables are built from sliced strings in this phase. The twin family (check 9). A Chrome T2 run after any edit near it. |
| **A repeated ask answered differently.** In Chrome this needs a twin plus a cache eviction. | T2 in both orders at X2's exit. None of 25,505 development cases holds a twin. Since the string storage fix no canvas holds a twin, and memo off is neutral in Chrome: on all 67,065 cases in both configurations for the fix alone (the independent check), and on the 380 `twins` with the rule for a neutral Latin range with a space on top (research/BLINK-STRING-STORAGE.md). |
| **float32 summation order in WebKit.** | T1 compares geometry to the bit where a path runs. Check 5 lists paths it never runs, the TAB path among them, and those move verbatim. |
| **Chrome's per-canvas shape cache and question order.** | Repeats only keeps first occurrences per context in order. One set of contexts per paragraph stays (one per storage in a segmented Blink paragraph since the string storage fix). The plain path and other widths get their own Chrome runs (X1, X2, step 4). |
| **Page history.** WebKit's worlds must use the same fill and inspection functions. The library's Canvas questions are part of a Firefox process's history. | The inspected path asks today's distinct questions. The plain run's native differences go to the ledger as history effects. T2 runs under the fixed protocol of `tests/sets.ts`. |
| **Gap order and merging.** | T1 compares gap lists byte for byte. Raise points and merge rules don't move. |
| **A pure function that mutates the line.** | Check 2. |
| **Dictionary segmentation.** | A changed string shows as a new question in T1. |
| **The row's shape or key order drifting.** | T1 is byte-level. The adapter owns the format. |
| **A rule, citation or gap site lost in a rewrite.** | Check 6. |
| **Font checks moving relative to engine measuring.** | T1 in the no-facts config. They stay called before the engine. |
| **The painter, which only browsers can judge.** | Check 7 offline, then T2 painter observations. |
| **Lab time growing once the memo goes.** | X2's tripwire and ask ratio. Note, 2026-09-19: it tripped once, on Firefox's giants along the inspected path (15.3 s of prediction against 4.2 s, 3.6×; their plain path 1.28×, layouts equal on all 9). The orchestrator accepted it, because the tripped path is the inspected one and what would answer it is a store found by string (§10's first row). |

## 12. What changed from the draft, and the critiques rejected

**Applied from the critique:**
- T1's real tool, with its three exits, the repeats only rule and freezing questions again (G1).
- The sweep on a stand-in Canvas, and the other-widths Chrome run (G2).
- A plain-path browser run for every engine (G3).
- Giants in X3's browser gate (G4).
- The twin family (G5).
- The differential with a frozen bundle (G6).
- The definition of "mention" (G7).
- The ledger limited to what nothing tracks yet (G8).
- The adapter's call order (G9).
- No measurer parameter (D3).
- The font-check resolver in S2 and S3 (D4).
- Shared data named by where it comes from (D5).
- The wrapper's end date (D6c).
- One place for `next` and `hasLineBox` (D7).
- `LinePieces<Facts>` (O1).
- Worlds kept as today in X1 (O2).
- WebKit's six merge rules ported one by one (O3).
- Gaps collected across Gecko's passes (O4).
- Start types and list order frozen (O5).
- The `groupAround` predicate (O6).
- The shared vocabulary.
- The file lists.
- The record that no longer replays.

**Rejected:**
- **D1 and D2** (prototype both Blink table variants; records instead of typed arrays): moot. The log's 04:40 note puts tables filled on first read after profiling, and the memo-off replay shows Blink costs about the same without them. They apply if decision 4 goes the other way. D2's record form is used for Gecko.
- **D6a and D6b** (drop `memoHits` from the row; a final commit under a new row format): the brief says the lab keeps its row shape. Freezing every reference and seed again to drop three lab-only fields is a follow-up (§9).
- **G4's second half** (record the giants for replay): the tests owner keeps giants out of records on purpose, because a giant's record is as large as its calls. X3 runs them in the browser.
- **§8 item 4's "Blink homes in both variants" prototype:** dropped with D1. The memo-off replay took its place, and it is done.

**Changed from both:**
- Measured values (decision 4).
- The painter step starts after X1, not after step 2.
- No browser order between engines, because each has its own browser.
- References now exist for both configs, and T1 takes seconds, not minutes.
