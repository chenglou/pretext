# Pretext rebuild: target architecture and migration plan

Read-only plan, 2026-09-17, for branch `rebuild-20260916`. Paths are under `~/github/pretext-rebuild/rebuild/` unless absolute. A "unit" is a UTF-16 code unit.

Every number names its source:
- **rows**: saved lab rows under `.artifacts`, real browsers. They keep counts of Canvas calls, not the strings.
- **bench**: `.artifacts/bench/smoke-20260917`, a background smoke run at c51065a, before the inline-tree model. Indicative only.
- **offline**: bun with a stand-in Canvas. It shows JS cost and call structure, never real shaping cost.

Terms used below:
- **Decided line**: the engine's own record of one filled line. Blink's `LineInfo`, WebKit's closed `Line`, Gecko's final reflow pass.
- **Default path**: what an app runs: `prepare`, `breakLine`, and `lineWidth` or `lineFragments` for the lines it needs.
- **Lab path**: the default path plus gaps and full engine geometry for every line. It is what `lab/predictor.ts` runs.
- **Reference rows**: lab rows recorded at the frozen pre-migration commit (step 0).

## 1. The facts the plan rests on

| Fact | Where |
|---|---|
| The line width never enters a measured string. `paragraph.width` is read at five sites, all at line time. | `src/engines/blink/line-breaker.ts:145`, `blink/index.ts:1228`, `webkit/lines.ts:2345` and `:2692`, `gecko/lines.ts:658`. Bench: Chrome makes 12,677 calls for one width and for 20. |
| Every port already fills a line, then checks gaps, then builds output, inside one function. | `blink/index.ts:1222-1232`, `webkit/lines.ts:2583-2726`, `gecko/lines.ts:898-912`. |
| Output that only the lab reads is most of the line-time cost. | Blink `clustersOf` (`blink/index.ts:593-611`): about 75% of line lookups and 57% of line Canvas calls. Gecko `characters()` (`gecko/lines.ts:917-934`): 55–95% of line calls. WebKit `lineGaps` (`webkit/lines.ts:2408-2580`): every line-time lookup, and as much JS as filling the line. |
| The text-keyed memo is the read path, and a hit still builds its string first. | `src/measure/canvas.ts:75-86`; Blink `canvasString`, `blink/shape.ts:241-285`. Rows: Chrome 84–90% hits, 8–25 lookups per unit. Bench: each extra width costs 74 ms of JS with 0 Canvas calls on 15,000 units. |
| Some work grows faster than the text. | Blink rescans ICU boundaries to the end of the text from every line start (`blink/breaks.ts:134-168`): 12 ms against 0.16 ms lazily (offline). Gecko's `W(unit) − W(suffix)` is quadratic in unit length (`gecko/lines.ts:68-122`): a 9,428-unit Chinese paragraph takes 10,979 ms in Firefox (rows). WebKit's last-line loop has no `break` (`webkit/lines.ts:1785`): 39 of 42 ms on 6,000 words. WebKit builds a fresh break factory per boundary (`lines.ts:1255`, `breaks.ts:394`). |
| The measurer is per paragraph. | `src/index.ts:40`. Bench, 200 messages: Chrome 400 canvases and 47,455 calls; one shared measurer makes 24,171; main makes 2,043. |
| Prepare does work that only feeds gaps. | WebKit about 90% of prepare JS (`isDelimiterQuote`, `webkit/data.ts:115-120`, alone 55–62%; history facts, `webkit/content.ts:590-667`). Blink `contentGaps` 30–35% (`blink/index.ts:147-186`). Gecko measures every stretch a second time only to report `space-in-shaping` (`gecko/prepare.ts:1158-1169`; I confirmed it writes nothing but the gap). |
| Every bundle carries all three engines and 1.49 MB of tables. | `src/index.ts:3-9`, `breaks/tables.ts:5-7`, `unicode/bidi.ts:53`, `unicode/grapheme.ts:17`. |

Evidence that the central change is safe: three independent offline prototypes gave the Blink port a per-offset position table that re-raises the gaps each entry's measurement raised. All three got byte-identical lines, geometry and gaps, and identical Canvas calls, over 450, 2,169 and 853 lines of varied content. A Gecko advance-table prototype gave byte-identical lines too.

Today: 17,939 non-test lines under `src` (shared 3,600, Blink 5,055, WebKit 4,913, Gecko 4,331, a 40-line test helper).

## 2. The target in one page

**Base:** the engine-fidelity design. It has a small shared layer, engines that own everything end to end, a lab path that makes today's exact Canvas calls, and sharing across paragraphs landed last behind its own gate.

**Grafted from the data-model design:**
- `breakLine` returns the decided line;
- Gecko's consulted offsets;
- the Int32 overflow finding;
- a lab-owned row adapter;
- a line count that reports overflow.

**Grafted from the measurement design:**
- the list of which strings recur and which belong to one offset;
- the replay gate from recorded Canvas calls;
- the store bound;
- the string-storage hazard;
- the four changes to what is measured, each with offline evidence.

**The seven points:**
1. **Two stages, because the engines have them.** `prepare` is width-free. `breakLine` fills one line. The width is part of the per-line slot: `LineSlot = { width, left, right }`. This isn't main's split. The primitive is a line cursor, the measurer is explicit, the input is a tree, and the output has depths.
2. **`breakLine` returns the decided line and nothing else.** `lineWidth`, `lineFragments`, `paragraphGaps` and `inspectLine` are pure functions of it and compute on request. Counting drops the line.
3. **In Blink and Gecko, a measured fact that belongs to a text offset lives in typed arrays on the prepared paragraph.** An array is filled on first read. An entry keeps which gap conditions its measurement raised, and a read raises them again. A read builds no string and asks no Map.
4. **The app owns one `Measurer`.** It holds the Canvas contexts and a bounded store for strings that recur. The per-paragraph measurer, the memo as the read path and the call log go.
5. **No shared code names an engine.** Each engine is an entry module with its own data. One loader holds the only switch, as three dynamic imports.
6. **The lab path keeps today's row shape and today's Canvas calls.** `lab/predictor.ts` composes it from the same functions apps use.
7. **Every ported rule, citation, gap condition, probe order and observation port stays.**

## 3. Data per stage

| Stage | Data | Lifetime | Depends on width |
|---|---|---|---|
| Module | The loaded engine's tables, parsed at import. No lazy slots. | page | no |
| App | `Environment` from the engine's `detectEnvironment(given)`; `Measurer` from `createMeasurer()` | page; a new `Measurer` after a font loads | no |
| Input | `Paragraph` without `width` and `lineHeight`; `LineSlot { width, left, right }` per line | caller | the slot only |
| Prepared | see the list below | as long as the app keeps the paragraph | no |
| Decided line | the engine's record, plus what gap checks need later (§6) | caller; dropped when counting | yes |
| On request | `LinePieces`, CSS-px width, `ParagraphGaps`, the inspected line | the caller's scope | yes |
| Lab | `RecordedLayout`, built by `lab/predictor.ts` | the row | yes |

**The prepared paragraph holds:**
- references to `paragraph`, `env` and `measurer`, never copies of their fields;
- the content index, built once and also read by the painter (today `paint.ts:162` builds it again);
- the engine's items, styles and per-unit arrays;
- prepare-time widths;
- the per-offset tables;
- the conditions prepare's own measurements raised, as `{ name, run, at }`.

**Stored nowhere:**
- paragraph gaps computed from content alone;
- WebKit's 12 gap-only box fields and its history facts;
- Blink's content gaps;
- `fontKey` strings;
- the measure log;
- per-line copies of `layoutZoom` and `appUnitsPerDevPixel`;
- `engine` tags on starts and layouts;
- the three source-indexed Blink arrays (`contentOffsets`, `collapsedAt`, `sourceRuns`), which output derives over the line's range.

**Restated promise** (DESIGN §2.8 says `nextLine` never changes the prepared paragraph):
- A table entry, once written, never changes.
- Its value doesn't depend on who asked first.
- Its conditions are raised on every read.
- So lines in different slots never mix gaps, which is how the memo behaves today.

## 4. API

```ts
// src/pretext.ts: shared. The only file naming three engines (type imports plus three dynamic imports).
detectEngine(): EngineName | null
loadEngine(name: EngineName): Promise<Pretext>
// src/canvas.ts
createMeasurer(): Measurer
// src/lines.ts: plain loops over breakLine, no cache
countLines(pretext, prepared, width): { lines: number; widest: number; overflows: boolean }
layoutLines(pretext, prepared, width, slots): { lines: Line[]; refused: { row: number; line: Line }[] }   // today's loop, src/index.ts:116-138, once
// src/paint.ts
paintLine(doc, prepared, rules, lineHeight, pieces, slot, previousJoins, hasNext): HTMLElement

// every engine's index.ts exports these over its own concrete types (type Pretext, method syntax)
detectEnvironment(given): Environment
prepare(paragraph, env, measurer): Prepared
firstLine(prepared): LineStart | null
breakLine(prepared, start, slot): { kind: 'line'; line } | { kind: 'below-floats'; line; next }   // next always given
lineWidth(prepared, line): number             // the engine's alignment width in CSS px (DESIGN §2.6)
lineFragments(prepared, line): LinePieces     // { fragments, joinsNextLine, indented, align }
paragraphGaps(prepared): ParagraphGaps        // engine type: Gap[] plus per-paragraph facts that line checks read
inspectLine(prepared, paragraphGaps, result): today's LineResultOf for this engine
paintRules(paragraph): PaintRules             // plain data: hyphen span style, soft-wrap-box rule, hanging text node
```

- **Counting.** `widest` gives shrink-wrap from the same walk. `overflows` marks the case DESIGN §2.6 excludes: an overflowing line breaks differently at other widths.
- **A different width per line** is `{ width, left: 0, right: 0 }`. It gives no below-floats refusals, no WebKit `hasFloats` builder switch and no Gecko float-impacted band. Insets remain for real floats, with each engine's separate truncation (DESIGN §2.9).
- **Apps that paint their own elements** read `lineFragments`. Fragments already carry leaf, source range, painted text, level and box edges.
- **`Fragment` is unchanged and keeps `painted`**, built as one slice of the engine's content string where there is one.
- **`inspectLine` on a refused line** returns the decision's and edge checks' gaps without geometry conditions, as today (`blink/index.ts:1229`).
- **The `Pretext` type** uses method syntax, so a module over concrete engine types satisfies it without casts (checked with the repo's strict `tsc` in the engine-fidelity scratch, `arch-plan/target/types-check/`). It relies on TypeScript comparing method parameters bivariantly. That is safe only because one engine is loaded per page, and a comment in `pretext.ts` says so. Code that loads two engines, such as tests and tools, uses the engines' concrete types.

## 5. Measurement

```ts
type Measurer = { contexts: Context[]; calls: number; hits: number; storedChars: number; onCall: ((c: Context, text: string, m: TextMetrics) => void) | null }
type Context = { settings: CanvasSettings; ctx: OffscreenCanvasRenderingContext2D; widths: Map<string, number>; bounds: Map<string, Bounds> }
contextFor(m, settings): Context     // linear scan comparing the eight settings; creates on a miss; ctx.lang before ctx.font
measure(m, c, text): number          // always calls Canvas: a string that belongs to one offset
measureShared(m, c, text): number    // reads and fills c.widths: a string that recurs
measureBounds(m, c, text) / measureBoundsShared(m, c, text)
```

- **Contexts.** Engines hold `Context` references in style records. There is no joined string key (`canvas.ts:44-46`), and nothing reads the log as state (`gecko/lines.ts:40` does today). Blink creates the `rtl` and the two no-ligature contexts on first use. Today it creates five per style per paragraph (`blink/shape.ts:81-89`).
- **The call site picks the function.**
  - `measure`:
    - Blink's prefixes, pieces and whole groups;
    - Gecko's suffixes and prefixes;
    - WebKit's `breakWord` prefixes.
  - `measureShared`:
    - Blink's pair and single-cluster windows, short reshapes, hyphen, space and HanKerning data;
    - WebKit's words with their space and its per-box constants;
    - Gecko's shaping units, space, hyphen and `'0'`;
    - Gecko's ligature ink boxes, which replaces its `WeakMap` (`gecko/lines.ts:49-61`).
- **Bound.** `storedChars` counts key characters. At the cap every context's maps are cleared. Set the cap in profiling; start at 2 million.
- **Blink never stores a forced two-byte string.** `canvasString` can build a one-byte string and a forced two-byte string with equal content (`blink/shape.ts:279-284`), and a Map can't tell them apart. `canvasString` stays the only constructor of Blink's Canvas strings. The tables remove repeated builds, not the builder.
- **The lab's hook.** `onCall` is how the lab records calls. Replay offline is a stand-in `OffscreenCanvas` that answers from a recorded log and throws on a miss. It needs no library code.

**When measurement happens.**
- Prepare measures what every width needs: Blink's pieces and cuts, WebKit's items, Gecko's units.
- A position inside a word is measured the first time a line asks.
- Filling everything in prepare is rejected. It costs about 2.4 times the cold Canvas calls in Blink (784 against 331 per 600 units, offline), and Gecko would pay its quadratic recipe for every offset when default CSS consults about 160 of 15,000. Cold layout of many paragraphs is this library's worst case.

## 6. Per engine

### Blink

**Prepared:**
- `text` and the per-unit arrays over it;
- items as a tagged union, with no `-1` or `'none'` sentinels;
- one style record that absorbs `settings`, `contexts`, `hanKerning` and the break table resolved for the style;
- groups with `cuts` and `prefixAtCut`;
- per group, allocated on first miss: `prefix16: Float64Array` and `pair16: Float64Array`, where NaN means not measured, and `raised: Uint8Array`.

**Why doubles.** A 16.16 position overflows Int32 past 32,768 zoomed px. A prototype broke on a 15,000-unit paragraph until it stored doubles.

**What an entry can raise.** Inside a position computation only `joinedAtEdge` raises gaps (`shape.ts:163-177`, called at `:304`). The possible conditions are one at the group's start edge and one at its end edge, of a kind fixed by `style.joining`. Order matters because `addGap` merges ranges (`blink/gaps.ts:9-24`) and the lab attributes a failure to the first matching gap (`lab/observe/blink.ts:80-92`).

So `raised[k]` stores, separately for the prefix read and the pair read, one of five values: none, start, end, start then end, end then start. A read re-raises them in that order. The prototypes used an ordered gap list per entry; if the compact form ever differs in the offline differential, use the list.

**Not in a table:** reshapes with their own call edges (`shape.ts:697`, `:862-894`), the hyphen and tabs.

**Decided line:** `LineInfo` with its item results, plus the gaps its measurements raised, in order. `applyJustification` must stop writing into the results (`blink/index.ts:746-749`).

**`inspectLine`** runs edge checks (`index.ts:284-348`), then hang, justification, items with clusters, and mapping, in today's order.

**Unchanged:**
- `offsetForPosition`'s probe order (`shape.ts:647-658`);
- the View, Part and Segment bookkeeping (`shape.ts:780-825`);
- the ICU restart at every line start, which now scans only as far as the line asks.

**Other changes:**
- `scriptsPerUnit` is skipped when letter spacing is 0. Its result is discarded there (`shape.ts:307`, `:319`), and it is 25–35% of JS time.
- The second `pairAdjust16` at a cut (`shape.ts:513`) reuses the first.
- `contentGaps` and `prepareGaps` run inside `paragraphGaps()`, in today's order after the conditions that prepare's measurements raised.

### WebKit

**No table.** Item widths are already stored (`webkit/types.ts:131-133`).

**Prepared:**
- boxes with the 16 fields line breaking reads, plus space, plain-space and hyphen widths as fields;
- items and `LineRun` as tagged unions, which removes 206 `!`, 57 `as` and 7 throws;
- one "soft wrap opportunity after this item" flag per item, computed once per box.

**Decided line:** the closed run list plus `{ measuredEnd, reverted, decisionStart, overflowStart, placedEnd }`, exactly what `lineGaps` reads (`lines.ts:2408-2416`, `:2528`).

**Other changes:**
- A width measured for a candidate travels to commit, instead of being measured again at `lines.ts:1102`, `:1115`, `:1383` and `:1624`.
- `lineGaps` and the box and history facts run only under `paragraphGaps` and `inspectLine`.
- Two fixes I read and judge result-identical: a flat list of the 10 quote code points for `isDelimiterQuote`, and a `break` at `lines.ts:1785` (the flag only goes false).

**Unchanged:**
- `breakWord`'s probe sequence and `carriedWidth`;
- the two parallel builders and their six result-changing differences (`specs/webkit-lines.md` §2).

### Gecko

**Prepared:**
- leaf records instead of five parallel arrays;
- spans split from atomic, br and wbr, which removes 17 casts;
- one transformed string sliced at measure time, instead of `tUnits` and 14 rebuild sites (string storage doesn't matter to Gecko's Canvas);
- units;
- `before: Float64Array` per transformed unit, the in-word advance, filled on first ask.

**Decided line:** the final pass's placed frames with trailing white space already trimmed, plus `consulted`: the in-word offsets the break scan asked about, in order, across both passes of a redo. The trim moves into the decision because the line width depends on it.

**In-word checks** cost 1,015 of 4,263 line-phase calls on the Latin corpus (offline). They run in `inspectLine` over `consulted`, in order, stopping at the first report as today. `glyphBefore` loses its `gaps | null` parameter.

**Other changes:**
- `characters()` runs only in `inspectLine`.
- The `space-in-shaping` stretch measure runs in `paragraphGaps()`.
- Prepare runs the itemizer, the unit split and the grapheme pass once each.
- The device-size context is created only for runs that need it (`prepare.ts:1204`).

**Break decisions keep their linear scan**, because advances need not be monotone.

## 7. Files after the migration

```
src/
  pretext.ts   ~60    loader, detectEngine, type Pretext
  model.ts     ~320   inline tree, font facts, Fragment, Gap, LineSlot, LinePieces, PaintRules (citations stay)
  content.ts   ~70    lines.ts ~45    canvas.ts ~75    paint.ts ~400    font.ts 13
  icu/         rbbi.ts, ubidi.ts, grapheme.ts      imported by Blink and WebKit, each with its own data
  icu4x/       segmenter                           Gecko
  unicode-bidi/                                    Gecko
  engines/<engine>/   index, types (with this engine's geometry types), env, content, breaks, measure, lines, output, gaps, generated/
```

- The port's source-named files stay inside those roles.
- There are no shared helpers for things that merely look alike: each engine keeps its own `f32`, rounding and table reads.

| Part | Today | Target |
|---|---:|---:|
| Shared core | 1,626 | about 970 |
| Library ports (`icu`, `icu4x`, `unicode-bidi`) | 1,974 | about 1,720 |
| Blink | 5,055 | about 4,370 |
| WebKit | 4,913 | about 3,420 |
| Gecko | 4,331 | about 3,820 (about 3,500 with a likely-subtags answer table) |
| Total | 17,939 | about 14,300 |

| Shipped to one browser | Lines | Tables |
|---|---:|---:|
| Today, every browser | 17,939 | 1.49 MB |
| Blink | about 6,400 | about 490 KB |
| WebKit | about 5,450 | about 480 KB |
| Gecko | about 5,450 | 105–250 KB |

All line targets are judgments from reading; nobody prototyped a rewrite.

## 8. Where the designs disagreed, and the pick

| Topic | Pick | Reason |
|---|---|---|
| What the line call returns | The decided line, with pure functions over it | One fill serves count, paint and inspection. Three entry points would refill visible lines and triple the wrappers. |
| Gaps and geometry: batch after all lines, or per line | Per line (`inspectLine`), called right after `breakLine` by the lab | It keeps the lab path's Canvas call sequence identical to today's, so the differential can compare call logs and not only output. |
| Who builds the lab's row shape | `lab/predictor.ts`, from `breakLine`, `paragraphGaps` and `inspectLine` | The persisted format is the lab's. The library returns engine-true lines, not rows. |
| Gecko in-word checks: inline or deferred | Deferred through `consulted` | They are about a quarter of line-phase calls and move no line. Firefox has no per-canvas first-wins cache, so Gecko's gate compares output and the set of measured strings. |
| Gap replay storage | Compact order code per entry; the list is the proven fallback | Only two conditions exist per group, and neither prose nor objects need keeping per offset. |
| Table number type | `Float64Array` with NaN | One array holds value and filled state, and no Int32 overflow. Revisit piece-relative Int32 only if memory per kept paragraph matters. |
| Session or page record against environment plus measurer | `Environment` and `Measurer` stay two values | They don't share a lifetime. A font load replaces the measurer only, and contexts are keyed by settings. |
| One `measure` with a length test, or two functions | Two, chosen at the call site | The call site knows whether a string recurs. A length test is a hidden branch. |
| Slot type name | `LineSlot`, with `width` added | `LineBox` would collide with `hasLineBox`, which means the CSS line box. |
| `Fragment.painted`: a view or a string | A string, one slice | Fragments are made only for lines someone paints or records. It keeps the painter and saved rows byte-equal. |
| `white-space` input | The CSS shorthand; each engine parses it once per style | The input mirrors the CSS apps write. The repeated reading was the problem, not the shape. |
| Fill tables eagerly or on first read | First read; no `measureAhead` until profiling asks | Cold layout of many paragraphs is the worst case. |
| WebKit items as typed arrays | Tagged unions now | They remove the casts without a second model. Revisit only if allocation shows in profiles. |
| When sharing across paragraphs lands | Last, behind order runs | DESIGN §5 lists a fresh measurer per paragraph as part of handling Chrome's per-canvas cache. |
| Engine order | The three in parallel after the shared step | Owners touch disjoint directories. Only browser jobs are serialized. |

## 9. Decisions that are the maintainer's

1. **Gaps and per-cluster or per-character geometry are returned on request** by `inspectLine`. They are not on every line. Charter tentpoles 1 and 3 call them output. Nothing is lost and the lab always asks, but the charter's wording should agree.
2. **One measurer shared across paragraphs as the default in Chrome**, once step 3's order runs pass. If a class of cases moves, Blink alone keeps a private measurer per prepared paragraph, decided inside the Blink module.
3. **Whether and when to try the four changes to what is measured** (§13). Without the Gecko one, a long paragraph without spaces stays at seconds on its first layout. Without the Blink one, Chrome can't approach main's call counts.
4. **The loader's shape:** one async `loadEngine` with a chunk per engine, or per-engine entry points chosen at build time. The `Pretext` type serves both, and shipping both costs about 60 lines.
5. **A generated answer table for Gecko's `likely.ts`.** The port is 478 lines plus 143 KB, and 41 of 7,527 entries matter. The rule and citation stay; the generator must fold in the alias tables.
6. **Userland line breakers** that read segments and widths (the justification-comparison demo) are not served by this design.

## 10. Gates: what "green" means at every step

**Offline, minutes, no browser lock:**
1. `bunx tsc --noEmit -p` over four projects: `rebuild/tsconfig.json`, `rebuild/lab/tsconfig.json`, `rebuild/tests/tsconfig.json`, `rebuild/bench/tsconfig.json`.
2. `bun test rebuild/src rebuild/lab rebuild/tests`.
3. **Differential.**
   - It runs the frozen tree (a git worktree at the pre-migration commit) against the working tree, on one deterministic stand-in Canvas with kerning pairs, a ligature, Arabic joining widths and ink boxes.
   - It covers every development case file (`.artifacts/lab/cases/{smoke,suite-sample,runs,ws,policy}.ndjson`), the rule and feature family cases, and generated paragraphs of 15,000 units and more. Long paragraphs are what exposed the Int32 overflow.
   - It requires byte-equal `lines`, `belowFloats` and `gaps`. It requires an identical Canvas call sequence for Blink and WebKit, and an identical set for Gecko once its checks are deferred.
   - It excludes heldout and sealed files.
4. **Replay.** The working tree runs against each reference row's recorded calls. A miss means the new lab path measured something the old one didn't. The output must equal the row. Cases with Thai, Lao, Khmer or Myanmar text are excluded, since they need the browser's own segmenter.
5. **Citation ledger.** About 790 distinct `file:line` citations under `src` and about 73 WebKit short forms survive, or sit on a reviewed dropped list. `tests/rules.json` (504 ids, 476 current) and the coverage matrix don't change. Gap emit sites are counted the same way.
6. **Invariants per engine:**
   - lines tile the source;
   - the pure functions give the same result twice and in any order, which catches output that mutates the decision;
   - a second pass at the same width makes no Canvas call.

**Browsers.** Chrome, Firefox and webkit-host run under `.artifacts/session/with-browser-lock.py`, one job at a time across all owners, since parallel heavy jobs have run this Mac out of memory.

7. Full runs of the development files and the families, with `--order=file` and `--order=reverse`.
8. **Layout diff:** `prediction.layout.lines`, `belowFloats`, `gaps` and the painter observation are byte-equal to the reference rows of the same build and order. `layout.env` is left out, because it loses dead fields.
9. `bun rebuild/lab/score.ts --per-case --native-compare`, then `bun rebuild/lab/gate.ts --baseline=rebuild/lab/baselines/gate-<browser>-<build>.json --runs=<dir> --complete`: 0 lost pairs.
10. `bun rebuild/tests/gate.ts check --derived=<dir> --baseline=rebuild/tests/baselines/<browser>-<build>.json`: 0 lost pairs, 0 fact flips, 0 rules losing their last family.
11. **From step 2 on, the default-path check.** Per case, on fresh canvases, the lines from `breakLine` alone equal the lab path's lines. The default path measures a subset of the lab path's strings, and Chrome's cache makes order observable.

The sealed sets are not part of the migration.

## 11. Migration

### Step 0. Gates and reference (shared owner; library unchanged)

**New:**
- `tools/standin-canvas.ts`, merging the stubs at `src/engines/blink/lines.test.ts:28` and `gecko/gecko.test.ts:72`;
- `tools/differential.ts`;
- `tools/layout-diff.ts`;
- `tools/replay-canvas.ts`;
- `tools/citations.ts`.

**Lab:** a `--keep-calls` flag in `lab/run.ts`. With it, `lab/page.ts:389-395` and `:497-498` keep each call's context settings, text, width and ink box. This is the open stage 0 of DESIGN §8.3.

**Reference runs:** after the running evaluation ends, freeze the commit and record reference rows per browser in both orders with calls kept.

**Exit:** the differential of the frozen tree against itself is 0, and replay reproduces the reference rows for all three engines.

Lines: 0 in the library. Calls: 0.

### Step 1. Shared layer, API and lab adapter (shared owner)

The engines keep their behaviour. Each `engines/<engine>/index.ts` satisfies `Pretext` by running today's `nextLine` and using today's full line as its decided line. That is about 25 lines per engine, in the file its owner rewrites in step 2. It is code that runs during the migration, not a bridge to keep.

**Rewrite:**

| File | Lines now | Lines after | Notes |
|---|---:|---:|---|
| `src/model.ts` | 600 | about 320 | geometry types `:279-490` move to each engine's `types.ts`; the observation contract `:553-600` moves to new `lab/observe/contract.ts`; the generics go |
| `src/env.ts` | 153 | about 100 | engines take their own record; `pageLang`, `contentLanguage` and `ProcessLanguages` go |
| `src/content.ts` | 101 | about 70 | |
| `src/paint.ts` | 489 | about 400 | `paintLine`, `PaintRules` in place of the branches at `:93-108`, `:309-313`, `:420`; takes the prepared index and `lineHeight` |
| `src/measure/canvas.ts` | 86 | `src/canvas.ts`, about 75 | `Measurer`, `Context`, counters and `onCall`; today's memoized `measureText` stays until step 3 so the engines run unchanged |

**New:** `src/pretext.ts`, `src/lines.ts`.

**Delete:**
- `src/index.ts` (138);
- `src/engines/engine.ts` (35, with `UnportedFeature`, which is never thrown);
- `src/measure/log.ts` (11);
- `src/breaks/tables.ts` (52);
- the selectors in `src/unicode/bidi.ts` and `grapheme.ts`;
- rbbi's rule-status diagnostics (`breaks/rbbi.ts:147-152`, `169-173`, `187`, `235`, `245`).

**Move:**
- `breaks/rbbi.ts`, `unicode/ubidi.ts` and graphemes to `src/icu/`;
- `breaks/icu4x.ts` to `src/icu4x/`;
- `unicode/unicode-bidi.ts` to `src/unicode-bidi/`;
- each `breaks/generated/*` to `engines/<engine>/generated/`, with the output paths in `tools/gen-*.ts`;
- bidi data split per engine.

**Engines, boundary only:**
- the five `paragraph.width` sites read `slot.width`;
- `firstLine` drops the `engine` tag;
- engine tests call the exported functions.

**Lab:**
- `lab/predictor.ts`:
  - the row adapter;
  - the page-language check at `:109` reads `document.documentElement.lang` itself;
- `lab/types.ts`: `ParagraphLayout`, `LineOf` and a predicted paragraph carrying the case's `width` and `lineHeight` for the ports;
- the three ports' import paths;
- `lab/page.ts`: counts from the counters;
- `lab/row-fixtures.ts`.

**Tests:** the contract set in `tests/independence.test.ts:11` adds the three `engines/*/types.ts`. New checks: shared code imports no engine, and engines import no other engine.

**Bench:** `bench/page.ts` is rewritten (484 to about 350), with count, paint and inspect modes and a measurer per paragraph or shared. It doesn't compile today (`:130-133`, `:181`).

**Docs:**
- DESIGN §2, §2.8, §2.9, §4.6 and §8.1;
- the stale lines `:9-11` and `:1445-1446`;
- TESTS §11;
- lab and bench READMEs.

**Exit:** gates 1–10, with the differential at 0 and identical call sequences for all three engines.

**Lines:** about −650 net. Shared goes from 3,600 to about 2,750, and about 290 lines of types and boundary move into engines.

**Calls:** none, by design. Each engine's bundle drops the other two engines and 0.6–1.2 MB of tables.

### Step 2. Three engine rewrites, in parallel

- Each owner rewrites their directory whole, plus their generator.
- Shared changes go to the shared owner.
- The offline differential and replay are the inner loop; browser jobs queue.
- The internal order below is an order of work inside one landing. It is not a series of patches.

**WebKit** (4,913 to about 3,420, −1,560 with moved types). It goes first in the browser queue, because its measurement changes least.

Files: all of `engines/webkit/` and `tools/gen-webkit-data.ts`. `lines.ts` goes from 2,726 to about 1,700.

1. The decided line and its decision record. Fragments, display boxes and `lineGaps` become pure.
2. Box and history facts move under `paragraphGaps`. The flat quote list lands. Per-box constants become fields. The locale is parsed once per box (today 3 times: `content.ts:284`, `:550`, `:554`).
3. Break flags are computed once per box. The `break` at `lines.ts:1785` lands. The candidate width travels to commit.
4. Tagged unions for items and `LineRun`. The dead code goes: three `hyphenWidth` fields that are always null, `expansionShares`, `nbspBreaks`, and about 80 lines.
5. Generator: drop the unread `.brk` sections and emit the byte-identical forward tables once (about −150 KB).

| WebKit | Before | After |
|---|---:|---:|
| Default-path Canvas calls, lab-like rows | | about −15% (`specs/webkit-RESULTS.md`: line-local gap conditions raised mean calls from 15.1 to 17.7) |
| Latin corpus calls | 1,200 | 1,200 or fewer |
| Prepare JS per 100 words | 219 µs | about 22 µs |
| LineBuilder fill, 6,000 words | 42 ms | about 2 ms |
| One 30,000-character word | 162 ms | about 4 ms |

The prepare and fill figures are offline.

**Gecko** (4,331 to about 3,820, −590).

Files: all of `engines/gecko/` and `tools/gen-gecko-data.ts`.

1. The decided line: final pass, `consulted`, trim in the close step. Pure output, with `characters()` in `inspectLine` only.
2. The advance table. In-word checks are deferred. Ligature ink boxes go through `measureBoundsShared`.
3. A single-pass prepare (§6).
4. Model cleanup:
   - leaf records;
   - a spans array;
   - one status union instead of three booleans plus a string (`lines.ts:731-778`);
   - newline positions found once, instead of `indexOf` to the end of the text per reflow (`lines.ts:524`);
   - `computeTabs` stops at the line's end;
   - aliases and unread fields go.

| Gecko | Before | After |
|---|---:|---:|
| Latin corpus calls, `overflow-wrap: normal` | about 5,200 (bench) | about 1,360 (main: 1,247) |
| Latin corpus calls, `overflow-wrap: break-word` | about 5,200 (bench) | about 2,100 |
| 200 messages, measurer per paragraph | 22,010 (bench) | about 5,300 |
| Warm pass, Latin | 3.9 ms | 1.1 ms (offline) |
| Warm pass, 9,000 CJK units | 4,453 ms | 1.3 ms (offline) |

The first pass on text without spaces is unchanged until §13 A.

**Blink** (5,055 to about 4,370, −750).

Files: all of `engines/blink/` and `tools/gen-blink-data.ts`. `index.ts` (1,237) splits into exports, `prepare`, `output` and `gaps`.

1. The decided line. Pure output with no mutation in justification. `inspectLine` in today's order.
2. The tables with condition replay.
   - An item's shape result becomes two table reads, so the per-line `shapeResults` Map goes (`line-breaker.ts:133`).
   - The dead script scan and the second pair evaluation go.
3. The lazy ICU and grapheme scan per line. The per-line `Uint8Array(text.length + 1)` goes (`breaks.ts:139`, `:205`). The break table is resolved once per style instead of a locale regex per character (`breaks.ts:22-24`, `127-136`).
4. `paragraphGaps` on request. Contexts on first use. `addGap` dedupes by name, run and range; the prose comes from constants.
5. Model cleanup:
   - the style record and tagged items;
   - dead fields go;
   - per-line whole-paragraph scans in output become O(line) (`index.ts:448-489`, `821-835`, `1063-1071`, `1118-1131`);
   - `fontKey` with no separator (`content.ts:140`) becomes a field compare.
6. Generator: about −90 KB.

| Blink | Before | After |
|---|---:|---:|
| Latin corpus calls | 12,677 (bench) | about 4,800–5,100 |
| 200 messages, measurer per paragraph | 47,455 (bench) | about 15,000–18,000 |
| Warm relayout per line | 140–205 µs | 1–5 µs for the decision, 10–18 µs with full output (offline) |
| Prepare, 16-unit message | 52 µs | about 12 µs (offline) |
| Canvases per style, LTR | 4–5 | 1–2 |

**Exit for each engine:** gates 1–11. The lab path makes exactly today's calls, so reference rows and replay must match byte for byte.

**Docs:** DESIGN §3 and §4.5 for that engine, its spec RESULTS file, and REPORT §3.

### Step 3. Sharing on, last deletions (shared owner)

1. Run the suite with one measurer per page context in `--order=file`, `--order=reverse` and `--order=shuffle:<seed>`. Compare predictions byte for byte with the per-case-measurer rows.
2. If equal:
   - the lab flips to a shared measurer;
   - README examples share one;
   - DESIGN §5's row on Chrome's cache is rewritten.
   - If a class of Chrome cases moves, see decision 2.
3. Delete:
   - the memoized `measureText`;
   - the whole-text `ruleBoundaries` and `graphemeBoundaries` if no engine calls them;
   - what knip finds.
   - About −60 lines.

**Calls, 200 messages:**

| Browser | After step 2 | After step 3 | Main |
|---|---:|---:|---:|
| Chrome | 15,000–18,000 | about 3,000–9,000 (offline synthetic texts gave 2,894 and 7,000, which repeat words more than real chat) | 2,043 |
| Firefox | about 5,300 | about 700–3,500 | 2,043 |
| WebKit | about 4,100 | about 2,100 | 6,968 |

Chrome contexts go from 800 to 4.

### Summary

| Step | Owner | Lines | Canvas calls saved |
|---|---|---:|---|
| 0 | shared | 0 | 0 |
| 1 | shared | −650 | 0; one engine per bundle |
| 2 WebKit | WebKit | −1,560 | about 15% on lab-like rows; prepare JS ×10 |
| 2 Gecko | Gecko | −590 | 60–74% on Latin |
| 2 Blink | Blink | −750 | about 60%; relayout JS ×30–100 |
| 3 | shared | −60 | chat: a further 2–5 times |
| Total | | 17,939 to about 14,300 | |

## 12. What to profile afterwards

Run benches foreground, on power, after rewriting the bench page. Compare with `~/github/pretext/src`. Measure, per browser:

1. **Cold prepare plus count** per paragraph at 16, 100, 600 and 15,000 units: time, Canvas calls and canvases created.
2. **200 and 10,000 chat messages:** total time and calls, with and without the shared store. Read off the store's hit share and size to set the cap, or to drop the store.
3. **Resize:** 20 widths over one prepared paragraph and over 10,000.
   - Report the worst frame, not the mean.
   - Report new Canvas calls per width.
   - Decide whether an explicit "fill now" is wanted.
4. **Memory per kept paragraph**, tables included.
   - The estimate is about 27 bytes per unit in Blink, against well over 150 today.
   - Decide on piece-relative Int32 tables only here.
5. **Hot spots left in JS,** expected in this order:
   - Blink `canvasString` on first reads and `offsetForPosition` probes;
   - Gecko `rangeAu` string building and per-line allocation (about 10 Maps and Sets per line today);
   - WebKit candidate objects per word;
   - `bidiClassOf`'s binary search (`unicode/bidi.ts:67-78`);
   - the painter's per-line closures.
6. **Appends to one message** in Chrome (streaming).
   - Today's halving cuts move as the text grows: 12,115 calls over 133 appends (offline).
   - This measures the case for §13 B.

## 13. Changes to what is measured

Each is its own branch and browser run, never part of the rewrite.

**A. Gecko: windows inside long units.**
- Cut a unit over 64 units at cluster starts where both sides add up. That test is the recipe's own identity.
- Verify in integer au that the windows add up to the unit.
- Run the suffix recipe inside the window.
- Shorter units are untouched. A unit whose windows don't add up keeps today's recipe.
- Offline on 9,000 Chinese units:
  - 44.6M characters to Canvas became 0.34M;
  - lines, geometry and gap positions were identical;
  - only the au quoted inside gap details differed.
- Risk: real fonts with contextual shaping beyond pairs.
- Gate: every Firefox row holding such a unit.

**B. Blink: pieces that begin and end beside every space that passes the safe test.**
- Pieces of 256 px or more are halved as before.
- The registry already lists cut placement as a heuristic (`blink/shape/wide-group-halved`).
- Offline:
  - corpus calls 5,112 to 2,520;
  - 200 messages 7,000 to 990;
  - appends 12,115 to 1,320;
  - geometry identical on 40 cases;
  - 4 of 80 outputs moved `joining-technology` gaps between lines.
- A greedy forward cut near 200 px is the smaller step if this loses rows.

**C. WebKit: bound the simplified-measuring check inside the lab.**
- It measures the whole rest of a split word on every line: 28.5M characters for one 30,000-character word.
- Apps no longer pay it after step 2.

**D. Blink: canvases split by each string's storage class,** instead of by the paragraph's. It removes the twin-string hazard by construction, but it changes which canvas measures what.

## 14. A cache, only if the measurements demand it

**Trigger.** After step 3 and profiling, a drag-resize over many kept paragraphs still misses frames with zero new Canvas calls.

**Shape.**
- Per prepared paragraph, keep the last count `{ lines, widest }` and the width interval over which every line's fit test gives the same answer.
- On a new width inside the interval, return the stored count without walking lines.
- The interval comes from the walk itself:
  - per line, the slack between what was used and what was available;
  - per line, the width at which the next piece would have fit.
  - Each engine threads these through its one fit comparison (DESIGN §2.6 gives the monotone tests).
- A layout with an overflowing line stores no interval.
- No lines are stored. They are recomputed at microseconds each.

**Why it fits the guide's exceptions:**
- stable input identity: the prepared paragraph and integer-exact widths;
- real reuse: most paragraphs don't change count between two nearby widths;
- bounded size: four numbers per paragraph;
- one clear invalidation: a new prepared paragraph.

**Gate.** An exhaustive offline sweep of every representable width step over a range, per engine, comparing cached with recomputed counts, plus the slot families.

**Second candidate,** only if that isn't enough: resume from the first line whose fit flips, reusing the `LineStart`s before it.

## 15. Risks

1. **Shared canvases in Chrome** can make case order visible. Step 3's three-order byte diff decides, and the default-path check (gate 11) covers the smaller call set from step 2 on.
2. **The memo's removal.** Today a forced two-byte string can be answered by its one-byte twin's memo entry without a Canvas call. Afterwards it calls Canvas on the same canvas. DESIGN §4.2 says Chrome's own cache returns the first shaping there, which should give the same value. Only the browser layout diff can confirm. The stand-in can't see string storage.
3. **Gap order.** `addGap` merges ranges and the lab takes the first matching gap, so every gate compares gap lists byte for byte.
4. **The stand-in Canvas has no real shaping.** Replay from recorded calls and the browser diff cover real fonts.
5. **About 2,900 lines of engine and port tests assert today's shapes.** They move mechanically in steps 1 and 2.
6. **Line and call targets are estimates.** The call figures combine a stale smoke bench with offline counts.
7. **The evaluation now running** must finish before the reference runs. The baselines list two Chrome builds (153.0.8010.48 and .50), so reference rows and gate baselines must name the same build.
