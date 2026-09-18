# Target architecture: three ports, one small shared layer

Paths are under `~/github/pretext-rebuild/rebuild/` unless absolute. "Unit" means a UTF-16 code unit. Offline numbers come from bun with a stand-in Canvas, so they show JS cost and call counts only. My scratch files are in `<scratch>/arch-plan/target/`.

## 0. The design in short

1. Every port stays, function for function, with its citations. What changes is what flows between stages.
2. Nothing Canvas-derived is keyed by a constructed string any more. In Blink and Gecko a measured fact belongs to a text offset, so it lives in typed arrays on the prepared paragraph. That is the position data the engines themselves keep and the ports lacked.
3. A line is computed in two steps.
   - `breakLine` runs the engine's line filling and returns the **line decision**: Blink's `LineInfo`, WebKit's closed `Line`, or Gecko's final pass.
   - Fragments, geometry, advances and gaps are pure functions of that decision, computed when someone asks.
4. The lab asks for everything through one function that reproduces today's row shape byte for byte. The observation ports, the gate and the saved rows stay valid.
5. Width leaves `Paragraph` and becomes a line-time argument.
6. The shared layer shrinks to what is truly engine-independent: input types, the content index, Canvas contexts, the line loops and the painter. The ICU, ICU4X and unicode-bidi ports become libraries that each engine imports with its own data.
7. One loader holds the only engine switch, as dynamic imports. A page fetches one engine and its tables.

## 1. Claims checked against the code

### 1.1 Prepared state is width-free

`paragraph.width` is read at five line-time sites and nowhere in prepare:
- `blink/line-breaker.ts:145`
- `blink/index.ts:1228`
- `webkit/lines.ts:2345` and `:2692`
- `gecko/lines.ts:658`

No engine reads `lineHeight`; only `paint.ts:179-216` does.

### 1.2 In Blink and Gecko, measured facts are functions of a text offset

- **Blink.** `groupPrefix16(g, k)` (`blink/shape.ts:497-518`) and `pairAdjust16` with group edges (`:385-393`) depend only on `k`.
  - Every read still builds a Canvas string (`:241-285`) and scans its scripts (`:307`). The scan result is discarded at `:319` when letter spacing is 0.
  - The read then hits a string-keyed Map (`measure/canvas.ts:75-86`).
  - The pair adjustment is computed twice in one expression (`:511`, `:513`).
- **Gecko.** `glyphBefore(p, m, run, t, gaps)` (`gecko/lines.ts:68-122`) depends only on `t`. The per-line `inWordReported` flag gates the check, and with it which Canvas calls run.
- **WebKit.** It needs no table: item widths are already stored on items. Its line-time strings depend on the previous break, so they are measured each time.
  - Those strings are `breakWord` prefixes from a partial item and the RTL trim.

### 1.3 Prototype of the Blink table

Files: `target/src-table`, run by `target/blink-ab.ts`.

I added `prefixAt` and `pairAt`, two `Float64Array`s over text_content where NaN means "not measured". The gaps raised while an entry is computed are stored with the entry and raised again on every read.

Test set: 15 paragraph shapes × 10 widths × 3 DPRs, two passes each.
- The shapes are:
  - Latin with kerning and an `fi` ligature;
  - justify;
  - end alignment with indent;
  - `overflow-wrap: anywhere`;
  - `break-all`;
  - letter and word spacing;
  - soft hyphens;
  - `pre-wrap` with tabs;
  - spans with padding, an atomic inline, `<br>` and `<wbr>`;
  - Arabic;
  - Arabic with a mid-word span under `joining` null and `'opentype'`;
  - bidi;
  - CJK.
- Output differs in 0 of 450 layouts, with geometry, clusters and gaps included.
- The Canvas call log differs in 0 of 450: same calls, same order.
- Lookups answered by the memo fell from 4,113,331 to 575,502 (−86%).

| Warm relayout with full lab output | Before | After |
|---|---:|---:|
| Latin, 15 lines | 1.70 ms | 0.12 ms |
| Arabic | 0.87 ms | 0.05 ms |
| CJK | 0.65 ms | 0.05 ms |

### 1.4 The Blink break decision alone

File: `target/blink-breakonly.ts`. It runs `LineBreaker.nextLine` with no gaps pass and no output.

| Latin text | First layout | Warm relayout |
|---|---|---|
| 600 units | 190 prepare + 141 line calls | 4.7 µs per line |
| 15,000 units | 917 + 831 calls | 1.1 µs per line |

Chinese grows with paragraph length: 7.0, 16.7 and 46.8 µs per line at 600, 3,000 and 9,000 units.
- `blink/breaks.ts:134-168` scans ICU boundaries over `text.slice(start)` to the end of the text at every line start.
- It also allocates `Uint8Array(text.length + 1)` each time (`:139`).

### 1.5 Many paragraphs

File: `target/blink-many.ts`. 200 chat-sized paragraphs, 28,383 units.

| Flow | Canvas calls | Canvases | JS time |
|---|---:|---:|---:|
| Today | 53,626 | 800 | 126 ms |
| Table, break decision only, a measurer per paragraph | 18,255 | 800 | 43 ms |
| Table, break decision only, one measurer for all paragraphs | 2,894 | 4 | 38 ms |

- Relaying all 200 out at another width with the one measurer adds 210 calls and takes 5.5 ms for 934 lines.
- For the same scale, the saved bench has 47,455 calls for the rebuild in real Chrome and 2,043 for main.
- My messages come from one short source, so strings recur across them more than in real chat. Treat 2,894 as a lower bound.

### 1.6 Gaps and measurement

- **Blink raises gaps as side effects of measuring.**
  - `joinedAtEdge` (`blink/shape.ts:163-177`) pushes to whatever sink is current.
  - `clustersOf` pushes `glyph-clusters` at `blink/index.ts:602`.
  - Moving a measurement would therefore move a gap. Storing an entry's gaps with the entry and raising them on every read keeps each line's gaps exactly (1.3).
- **WebKit's `lineGaps` is already a pure function** of the line's bookkeeping (`webkit/lines.ts:2408-2579`).
  - It reads `measuredEnd`, `reverted`, `decisionStart`, `overflowStart`.
  - It builds its detail strings as arguments before the dedupe check at `:2412`.
- **Gecko's line is already two steps**: `reflowLine`, then `lineOutput` (`gecko/lines.ts:898-912`).

### 1.7 The lab's tools for order effects exist

- `lab/run.ts:31` takes `--order=file|reverse|shuffle:<seed>`.
- The gate requires both orders (`lab/gate.ts` header).
- The only production caller of the library is `lab/predictor.ts:111`.

### 1.8 Dead code, confirmed by grep

- `UnportedFeature` is never thrown.
- No engine reads `env.pageLang` or `env.contentLanguage`.
- `LineStart.engine` is read only by the mismatch throws at `index.ts:66-72`.
- The measure log is read as state once, at `gecko/lines.ts:40`.

## 2. Rules the design follows

1. **Fidelity first.** A port's functions keep the source's names, order and citations. Shared code never reshapes a port so it can be shared.
2. **Shared means engine-independent.** Shared code never names an engine, with one exception: the loader.
3. **A measured fact lives with what it describes.**
   - An offset's position is in the paragraph's table.
   - A recurring string's width (a letter pair, a word, the space, the hyphen) is with its context.
   - Nothing is looked up by a string built for the lookup.
4. **A gap raised by a measurement is stored with that measurement.** A diagnostic that measures nothing is a pure function and runs on demand.
5. **Output is pulled.** `breakLine` never measures or allocates for output nobody asked for.

## 3. What is shared, what stops, what starts

### 3.1 Stays shared (about 970 lines)

| File | Holds | Lines |
|---|---|---:|
| `model.ts` | the inline tree, font facts, `Fragment`, `Gap`, plus the new `LineBox`, `LineBreak`, `LinePieces`, `PaintRules` | ~320, mostly cited comments |
| `content.ts` | the document-order index | ~70 |
| `canvas.ts` | contexts and measuring | ~75 |
| `lines.ts` | count, walk rows, shrink-wrap | ~45 |
| `paint.ts` | fragments to DOM | ~400 |
| `pretext.ts` | the loader, `detectEngine`, the `Pretext` module type | ~60 |

### 3.2 Becomes a library port

The ports sit under the name of what they port, not under "shared".
- `icu/`: `rbbi.ts`, `ubidi.ts` and graphemes through `char.brk`. Blink and WebKit import it.
- `icu4x/`: the segmenter. Gecko imports it.
- `unicode-bidi/`: Gecko imports it.

Each engine passes its own data. If Chrome's ICU and Apple's ever differ in algorithm, fork the file then.

### 3.3 Stops being shared

- `index.ts`: its five switches, its three static engine imports and the 3× repeated layout block.
- `engines/engine.ts`.
- The per-engine geometry types in `model.ts:279-490`. They move into each engine's `types.ts`.
- `ParagraphLayout`, `LineOf` and the observation contract (`model.ts:544-600`). They move to the lab.
- The per-engine records in `env.ts`. Each engine owns its environment type and `createPage`.
- The engine selectors:
  - `breaks/tables.ts`;
  - `bidiDataFor` in `unicode/bidi.ts`;
  - `graphemeRulesFor` in `unicode/grapheme.ts`.
- The Blink-only and WebKit-only data under `breaks/generated/`. It moves to `engines/<engine>/generated/`.
- The painter's three engine branches (`paint.ts:93-108`, `:309-313`, `:420`).
- The text-keyed memo and the retained call log.

### 3.4 Becomes shared

- `LineBox` and the neutral `LineBreak` header.
- The `Pretext` module type, which every engine's `index.ts` must satisfy.
- `lines.ts`.
- `PaintRules`.
- Page-lifetime Canvas contexts.
- A lazy next-boundary call in `icu/rbbi.ts` and in graphemes. It replaces the whole-text functions that callers slice for (`rbbi.ts:281`, `grapheme.ts:26`).
- Under `tests/`: one stand-in Canvas and one A/B harness, used the same way for all three engines.

## 4. What each engine owns, and its interface

### 4.1 Ownership

An engine owns everything end to end:
- its environment type and `createPage`;
- styles, with `white-space` parsed once per style;
- content building;
- the bidi call;
- shaping units;
- break opportunities;
- Canvas recipes and their tables;
- line filling and line end;
- fragments and geometry;
- gap conditions and their prose;
- paint rules;
- generated data and its generator.

Its observation port stays in the lab and imports only types from the engine's `types.ts`.

### 4.2 The module surface

```ts
// model.ts
type LineBox = { width: number; left: number; right: number }   // CSS px: content width at this line, float insets
type LineBreak<Start, Decision> =
  | { kind: 'line'; start: number; end: number; hasLineBox: boolean; decision: Decision; next: Start | null }
  | { kind: 'below-floats'; gaps: Gap[]; next: Start }           // next is always given (today it is optional, model.ts:277)
type LinePieces = { fragments: Fragment[]; joinsNextLine: boolean; indented: boolean; align: TextAlign }
type PaintRules = { hyphen: 'plain' | 'vertical-align-0' | 'isolate'; softWrapBoxAfter: 'trimmed' | 'hanging' | 'never'; hangingSpacesOwnTextNode: boolean }

// pretext.ts: the only file naming all three engines (type imports and three dynamic imports)
type Pretext = {                       // method syntax on purpose, see below
  createPage(given: GivenFacts | null): Page               // env facts and an empty context list, once per page
  prepare(paragraph: Paragraph, page: Page): Prepared      // width-free
  firstLine(prepared: Prepared): LineStart | null
  breakLine(prepared: Prepared, start: LineStart, box: LineBox): LineBreakResult
  linePieces(prepared: Prepared, line: Line): LinePieces   // what a painter needs
  lineWidth(prepared: Prepared, line: Line): number        // CSS px alignment width, DESIGN §2.6
  lineGaps(prepared: Prepared, line: Line): Gap[]
  paragraphGaps(prepared: Prepared): Gap[]
  paintRules(paragraph: Paragraph): PaintRules
}
function loadEngine(engine: EngineName): Promise<Pretext>  // the one switch: import('./engines/blink/index.js') …
```

- `Prepared`, `LineStart` and `Line` are unions of the three engines' types.
  - The imports are type-only, so they cost nothing at runtime.
- Each engine's `index.ts` exports functions over its own concrete types.
- TypeScript compares method parameters bivariantly, so such a module satisfies `Pretext` with no casts, no factory and no tag checks.
  - I checked this with the repo's `tsc` in strict mode (`target/types-check/`), including a dynamic `import()` typed as `Promise<Pretext>`.
  - Only one engine is ever loaded on a page, so the unsound direction can't happen. One comment in `pretext.ts` says so.
- `LineStart.engine` and the `startMismatch` throws go.

### 4.3 Exports outside `Pretext`

The lab, caret and selection code, and Canvas renderers import these per engine:
- `geometry(prepared, line)`: today's per-engine geometry with advances, as charter tentpole 1 requires.
- `recordParagraph(prepared, boxes, rest)`: today's `ParagraphLayout` arm.
  - It breaks and records line by line, in today's pass order with one gap sink.
  - Recorded rows and the Canvas call order are therefore unchanged.
  - It is the successor of each port's `lineOutput` tail, about 30 lines per engine.

### 4.4 How the three avoid becoming three dialects

1. `const check: Pretext = module` in each engine fixes names, stages and neutral shapes at compile time.
2. Every engine uses the same file roles: `env`, `content`, `breaks`, `measure`, `lines`, `output`, `gaps`, `record`, `data`, `types`, `index`. The port's source-named files stay inside those roles.
3. Only source offsets, `Fragment`, `Gap`, `LineBox` and the line header are shared vocabulary. Everything else keeps the source's names.
4. There are no shared helpers for things that merely look alike. Each engine keeps its own `f32`, `LayoutUnit` rounding and table reads.
5. The import test in `tests/independence.test.ts` is extended to check:
   - shared code imports no engine;
   - engines import no other engine;
   - the lab imports types only.
6. The same offline invariants run for each engine:
   - lines tile the source;
   - `recordParagraph` equals `breakLine` plus the pure functions;
   - the pure functions give the same result twice and in any order;
   - a second pass makes no new measurement.

## 5. Data model per stage

| Stage | Data | Lifetime | Depends on width |
|---|---|---|---|
| Module | Parsed tables of the loaded engine only. They are parsed at module load, so there are no memo slots. | page | no |
| Page | `Page = { env, canvas }` | page | no |
| Input | `Paragraph` without `width` or `lineHeight`. `textIndent`, `textAlign` and `direction` stay, because they are style. | caller | no |
| Prepared | `{ paragraph, page, index, …engine state }` | as long as the caller keeps it | no |
| Line | `LineStart`, the caller's `LineBox`, and the `LineBreak` result with the engine's decision | the caller keeps it for painted lines and drops it when counting | yes |
| On demand | `LinePieces`, geometry, gaps, width in px. Pure functions that leave nothing behind. | the caller's scope | yes |
| Lab | `recordParagraph`'s layout, which has today's shape | the row | yes |

**The page's canvas.**
- `canvas = { contexts: Context[], calls, onCall }`.
- `Context = { settings, ctx, widths: Map<string, number>, bounds: Map<string, Bounds> }`.
- A context is found by a linear scan that compares the eight settings.
  - There is no joined string key (`canvas.ts:44-46`).
  - `ctx.lang` is still set before `ctx.font`.

**Prepared state, per engine.**
- Blink:
  - the text and per-unit arrays;
  - items as a tagged union;
  - one style record that absorbs the four parallel per-style arrays;
  - groups with cuts;
  - the `prefixAt` and `pairAt` tables, with the gaps stored per entry.
- WebKit:
  - boxes, with the space and hyphen widths as fields;
  - items with stored widths;
  - one "soft wrap opportunity after this item" flag per item.
- Gecko:
  - one transformed string;
  - leaf records;
  - frames and units;
  - the `advanceBefore` and `inWordCheck` tables.
- The source-to-content maps Blink stores today (`contentOffsets`, `collapsedAt`, `sourceRuns`) are derived on demand by the output functions.

**Two restated promises.**
- DESIGN §2.8 says `nextLine` never changes the prepared paragraph. The new promise has three parts.
  - A table entry, once written, never changes.
  - An entry's value doesn't depend on who asked first.
  - An entry's gaps are raised on every read, so lines in different boxes never mix gaps.
  - The memo already behaves this way today.
- The pure functions must not mutate the decision. Today two places do.
  - `applyJustification` writes `r.justification` and `r.inlineSize` into the item results (`blink/index.ts:746-749`).
  - Gecko's `lineOutput` trims and positions in place.

**Memory.**
- Today a kept paragraph retains every measured string twice, as memo key and as log entry. My estimate is well over 150 bytes per unit.
- The target keeps about 27 bytes per unit in Blink and retains no strings.
- That is still about ten times main. For 100,000 kept messages it should be measured in the profiling step.

## 6. Control flow from input to DOM

```
once:           pretext = await loadEngine(detectEngine());  page = pretext.createPage(given)
per paragraph:  prepared = pretext.prepare(paragraph, page)
per layout:     for (start = pretext.firstLine(prepared); start !== null;) {
                  r = pretext.breakLine(prepared, start, boxOfRow(row))
                  switch (r.kind) {
                    case 'below-floats': row++; start = r.next; break
                    case 'line': use(r); if (r.hasLineBox) row++; start = r.next; break
                  } }
visible lines:  paintLine(doc, prepared.paragraph, prepared.index, rules, lineHeight,
                          pretext.linePieces(prepared, line), box, previousJoins, hasNext)
lab:            engine.recordParagraph(prepared, boxes, rest)
```

- **`prepare`** runs the engine's own sequence:
  1. index the content;
  2. build styles;
  3. build the engine's content;
  4. resolve bidi;
  5. form shaping units;
  6. load break data;
  7. make the measurements the engine makes before filling lines.
- The Canvas calls stay where they are today and in today's order (DESIGN §4.5), less the ones nobody asked for.
- **`lines.ts`** holds the row loop once:
  - `countLines(pretext, prepared, width)`;
  - `walkLines` with boxes, the DESIGN §2.9 loop;
  - `shrinkWrapWidth`.
- **The painter** has no engine switch and reads no geometry.
  - Each engine exports `paintRules(paragraph)` as plain data with citations.
  - Blink's soft-wrap rule depends on `needsAccurateEndPosition`, which comes from `textAlign` alone (`blink/index.ts:1144-1149`). So Blink returns `'never'` or `'trimmed'` per paragraph.
- **An app that paints its own elements** walks `fragments` with `prepared.index`.
  - Fragments already carry leaf, source range, painted text, level, box edges and atomics.
- Each engine keeps the content index on its prepared paragraph as the one source.
  - Today WebKit and Gecko copy it into `runStarts`, `runTexts`, `runParents` and similar arrays.
  - Today the painter builds the index again (`paint.ts:162`).

## 7. How the four uses are served

- **Resize.**
  - Prepare once; the loop runs again at the new width.
  - The only Canvas calls are for offsets no layout has touched yet, plus WebKit's `breakWord` and RTL-trim strings.
  - Measured for Blink: 1 to 5 µs per line warm, against about 205 µs in the saved Chrome bench.
  - Expect relayout to land within roughly 10 to 30 times main's cost, down from 143 to 1,420 times. The remaining distance is the price of running the engine's real line breaker.
- **A different width per line.**
  - `LineBox.width` varies per call, with zero insets.
  - The engine treats each line as the first line of a block of that width, which is how the painter paints it and how the editorial demos draw.
  - Such a box never triggers below-floats, WebKit's sticky float builder or Gecko's float-impacted band.
  - Insets stay available for true float semantics. The lab protocol uses them.
- **Rich inline content.**
  - The inline tree is unchanged.
  - An app that paints itself uses the fragments; an app that positions things uses `geometry`.
- **Many paragraphs.**
  - Contexts live with the page. That is 4 canvases instead of 800 for 200 messages.
  - Counting runs the break decision only.
  - No strings are retained.
  - Recurring strings are measured once per page.

### Alternatives rejected

- **One call without prepare.** It repeats the width-free work. Prepare is 1.6 ms against 0.075 ms for a warm line pass on 600 units.
- **Filling the tables in prepare so layout is Canvas-free.**
  - Blink would make 784 calls instead of 331 per 600 units.
  - Gecko would pay the quadratic in-word recipe for every offset. Under default CSS about 160 of 15,000 offsets are ever consulted.
  - If profiling wants even resize frames, it can come back as an explicit "fill now" call.
- **A factory that binds an engine, opaque handles with casts, or a generic API.** The method-typed module shape makes all three unnecessary.

## 8. Measurement

`canvas.ts` has two measuring functions, so each call site says which kind of string it has:
- `measure(canvas, context, text)` always calls Canvas.
  - It is for strings that belong to one offset.
  - Those are Blink's prefixes and pieces, Gecko's suffixes and prefixes, WebKit's `breakWord` prefixes.
  - The result goes into the engine's table or item.
- `measureShared` reads and fills the context's `widths`.
  - It is for strings that recur.
  - Those are Blink's pair and single-cluster windows and short reshapes, WebKit's words with their space, Gecko's shaping units, the space and the hyphen.
  - `measureBoundsShared` does the same for ink boxes.
  - It replaces Gecko's `ligatureMemo` WeakMap (`gecko/lines.ts:49-61`) and the read of settings out of the log (`:40`).
- The shared stores fit the guide's exceptions: stable identity, real reuse, and one clear call.
- The log becomes a counter plus an optional `onCall` hook, which the lab uses for the full call log DESIGN §8.3 stage 0 wants.

**Blink.**
- `canvasString` stays the only constructor of Canvas strings. V8's one-byte or two-byte storage is an input to Chrome's Canvas.
- The table removes repeated builds, not the builder.
- The script scan runs only when letter spacing isn't 0. That scan is 25 to 35% of Blink's JS time today.
- `offsetForPosition` keeps its exact probe order (`blink/shape.ts:647-658`). The table changes what a probe costs, not which probes run.
- The break iterator advances lazily from the line start and keeps the boundaries found for that line.
  - ICU still restarts at every line start.
- Reshape calls with their own call edges (`:697`) aren't tabled.

**Gecko.**
- There are two tables, so the call sequence stays identical:
  - `advanceBefore[t]` is filled whenever `t` is asked;
  - `inWordCheck[t]` is filled only when a line that hasn't reported the gap consults `t`.
- `characters()` leaves the default path.

**WebKit.**
- A width measured for a candidate travels with the candidate to commit. Today it is measured again at `webkit/lines.ts:1102` or `:1115` and answered by the memo.
- `lineGaps` and the 12 gap-only box fields become on-demand functions.
  - `recordParagraph` computes the per-box facts once, in its own scope.
- Two fixes in scratch copies were judged result-identical. Both go through the A/B (§11).
  - The `break` in the loop at `:1785`.
  - The flat quote list for `isDelimiterQuote`.

## 9. What is deleted

- `index.ts`'s switches, the `PreparedParagraph` wrapper, `startMismatch`, the `EngineImplementation` objects and `UnportedFeature`.
- `Measurer.memo`, `Measurer.keys` and the retained `log.calls`.
- `ligatureMemo`.
- The `tables.ts` memo slots and the two selectors.
- `ParagraphLayout` and `LineOf` leave the library for the lab. So does the observation contract.
- `env.pageLang` and its DOM read, `env.contentLanguage`, the `ProcessLanguages` union.
- The rbbi diagnostics (`ruleStatus`, stale look-ahead counters).
- From the generated data:
  - the reverse table, rule source and DataHeader of every `.brk`;
  - byte-identical forward tables, emitted once.
- `Paragraph.width` and `Paragraph.lineHeight`.
- `LineStart.engine`, the `LineOf.slot` echo, the optional `next?`.
- Blink:
  - the per-line `shapeResults` Map (`line-breaker.ts:133`);
  - the per-line flag arrays;
  - eager creation of five contexts per style. The `rtl` context and the two no-ligature contexts are created when first needed.
- The dead fields and branches the maps list.
- The stale `bench/page.ts` code, rewritten against this API before any profiling.

Kept on purpose:
- Gap `detail` prose. It documents each condition, and once gaps run on demand it costs nothing on the hot path.
- `Fragment` unchanged.
- The `whiteSpace` shorthand as input.

## 10. Expected lines and Canvas calls

### 10.1 Lines

Engine figures are the maps' judgments plus the types that move in. None comes from a prototype rewrite.

| Part | Today | Target |
|---|---:|---:|
| Shared core | 1,626 | ~970 |
| Library ports (`icu`, `icu4x`, `unicode-bidi`) | 1,974 | ~1,720 |
| Blink | 5,055 | ~4,370 |
| WebKit | 4,913 | ~3,420 |
| Gecko | 4,331 | ~3,820 |
| Total under `src`, non-test | 17,939 | ~14,300 |

Shipped to one browser today: all 17,939 lines and 1.49 MB of data.

| Shipped to one browser, target | Lines | Data |
|---|---:|---|
| Blink | ~6,400 | ~490 KB |
| WebKit | ~5,450 | ~480 KB |
| Gecko | ~5,450 | 105 to 250 KB, depending on the likely-subtags answer table |

### 10.2 Canvas calls

| Scenario | Today | Target default path | Main |
|---|---:|---:|---:|
| Blink, 600-unit Latin paragraph, first layout (stand-in) | 784 | 331 | 118 |
| Blink, 20 widths of the same paragraph (stand-in) | 899 | 638 | n/a |
| Blink, 15k Latin corpus | 12,677 (Chrome bench) | ~1,750 (stand-in) to ~4,800 (bench prepare + the callers' line-time ablation) | 1,247 |
| Blink, 200 messages | 47,455 (bench), 53,626 (stand-in) | 18,255 with canvases per paragraph; 2,894 with page-lifetime canvases and widths (small vocabulary) | 2,043 |
| Gecko, 15k Latin, `overflow-wrap: break-word` | 5,293 | ~3,100 | 1,247 |
| Gecko, 15k Latin, `overflow-wrap: normal` | ~4,600 | ~1,360 | 1,247 |
| Gecko, 9,428 Chinese units | 27,059 calls, 11 s | the same on a first pass; later passes 0 new calls (warm 4,453 ms to 1.3 ms in the Gecko reader's prototype) | n/a |
| WebKit, 15k Latin | 1,200 | 1,200, less the lab-only gap checks (about 15% of calls on lab rows) | 4,374 |
| WebKit, 200 messages | 4,777 | ~2,100 (the bench's shared-measurer run) | 6,968 |

The lab path makes exactly today's calls by design.

## 11. Risks to correctness and the gates

1. **A port's logic changes by accident.**
   - Offline A/B: the library frozen at the pre-change commit against the new one.
     - It uses one stand-in Canvas with kerning, a ligature, joining forms and ink boxes.
     - It runs over every development case file with its widths, boxes and environment variants.
     - It compares `recordParagraph` output byte for byte, and the Canvas call sequence.
     - It takes minutes in bun and needs no browser lock.
   - In-browser A/B:
     - both libraries on one page in predict-only mode, with fresh canvases;
     - every case;
     - byte equality.
   - Then the lab gate in both orders with 0 lost pairs, plus the existing oracle tests.
2. **Gaps move because measurements move.** The byte comparison includes every line's gaps. Storing gaps with table entries gave 0 differences in the prototype.
3. **Chrome's per-canvas shaping cache makes call order observable.** The default path measures a subset of what the lab path measures.
   - Gate: per case, in the browser, the lines from `breakLine` alone equal `recordParagraph`'s lines, each on fresh canvases.
   - Before contexts and widths live with the page: run the suite with one page across cases in file, reverse and shuffled order.
     - Compare predictions byte for byte with fresh-per-case predictions.
   - DESIGN §4.2 says partitions and JS word spacing handle order. The bench's shared-measurer run agreed on its texts.
   - Until the order runs pass, the lab keeps a fresh canvas per case.
4. **String storage class isn't visible in a call log.**
   - Two equal strings with different storage measure differently in Chrome.
   - Only the in-browser A/B catches that.
   - So `canvasString` isn't rewritten.
5. **Output functions that mutate the decision.** The offline invariant "same result twice and in any order" catches them.
6. **Lazy ICU scanning.**
   - It is equal by construction, because `next()` is already incremental.
   - Blink's 13,108-request break oracle and the A/B check it.
7. **Width as a line argument.**
   - Blink's below-floats test compares the available width with the container width (`blink/index.ts:1228`). It must read `box.width`.
   - The slot families and the A/B with boxes check it.
8. **Saved rows.** `recordParagraph` keeps the row shape, so rescoring and gates keep working. Any cleanup of the row format is a later, versioned lab change.
9. **Recipe changes are not part of this work.**
   - Each needs its own rule id and gate run. Examples:
     - Blink cuts at every safe space, so prefix strings become word prefixes and recur across paragraphs;
     - Gecko measures long units in pieces, to end the quadratic Chinese case.
   - The architecture makes each a change in one function.

## 12. Order of work

1. **Freeze and tooling.**
   - Freeze the current commit.
   - Build the stand-in Canvas and the A/B harness, offline and in-browser.
   - Rewrite `bench/page.ts` against the new API.
   - Fix the stale DESIGN.md lines (`:9-11`).
2. **Shared layer, loader, and the WebKit engine.**
   - It needs no tables and exercises the whole API, the paint rules and `recordParagraph`.
   - Then Gecko, then Blink.
   - An engine lands when both A/Bs are byte-identical, bun is green and the lab gate loses no pair.
3. **Default-path equality checks** (risk 3, first gate).
4. **Page-lifetime contexts and shared widths**, after the order runs.
5. **Profile against main**: time, calls, and memory per unit. Only then decide on:
   - filling tables in prepare;
   - the recipe changes;
   - reusing decision objects when counting;
   - the library's own cache, as a worst case: per prepared paragraph, the line count plus the width interval over which every line's fit test gives the same answer.
     - DESIGN §2.6's monotone fit tests make that interval exact, except for overflowing lines.
     - A drag-resize would then skip most paragraphs.

## 13. Decisions for the maintainer

1. **The loader.** One async call at start and one chunk per engine, or per-engine entries chosen at build time. The `Pretext` type serves both.
2. **Lazy table fill as the default,** with an explicit fill call as a possible addition.
3. **Shared widths on by default** once the order runs pass, with a clear function.
4. **The two recipe changes** in §11.9, and when to try them.
5. **`geometry` as one function with advances.** Add a positions-only form if a Canvas renderer needs it.
