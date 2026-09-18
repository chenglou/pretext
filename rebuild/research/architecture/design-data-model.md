# Target architecture for the rebuild: an independent design

Paths are relative to `~/github/pretext-rebuild/rebuild` unless absolute. "Unit" means a UTF-16 code unit. Offline timings are bun (JavaScriptCore) with a stand-in Canvas, so they show JS cost and call structure only.

## 0. What I checked in the code, and one prototype

I read the engineering guide, `CHARTER.md` and `DESIGN.md` in full. I then checked the five maps' load-bearing claims against the source.

**Claims confirmed**

- **Width is a line-time input.**
  - `paragraph.width` is read at five engine sites, all at line time: `src/engines/blink/line-breaker.ts:145`, `blink/index.ts:1228`, `webkit/lines.ts:2345`, `webkit/lines.ts:2692`, `gecko/lines.ts:658`.
  - `lineHeight` is read only by `src/paint.ts:179-181, 212-216`.
- **Every engine already separates the break decision from the output, inside one function.**
  - Blink: `new LineBreaker(...).nextLine()` → `lineEdgeGaps` → `lineOutput` (`blink/index.ts:1222-1232`).
  - WebKit: the builder → `lineGaps` → `lineFragments` and `displayBoxes` (`webkit/lines.ts:2583-2726`).
  - Gecko: `reflowLine` → `lineOutput` (`gecko/lines.ts:898-912`).
  - The public shape hides this seam; the code already has it.
- **Blink positions are pure functions of the offset.**
  - `groupPrefix16` (`blink/shape.ts:497-518`) and the group-range `pairAdjust16` (`:385-393`) read only the group, its cuts, its trims and style facts. All of those are prepared.
  - The only gaps a position computation can raise are the two call-edge joining gaps of its group: `joinedAtEdge`, `shape.ts:163-177`, which fires only when the measured range touches the group's own edge.
  - Every lookup builds a `canvasString` (`shape.ts:241-285`) before the memo is asked (`measure/canvas.ts:75-86`).
  - Every two-byte string runs `scriptsPerUnit` (`shape.ts:307`). At zero letter spacing the result is never used (`:319`).
- **Blink rescans ICU to the end of the paragraph from every line start.**
  - It also allocates a `Uint8Array(text.length + 1)` each time (`blink/breaks.ts:134-168`, `:139`).
  - `RuleBreakIterator.next()` is already incremental (`breaks/rbbi.ts:176-274`). Its look-ahead array persists across `next()` calls, so a restart per line must stay.
- **WebKit's `lineGaps` is a pure function of a small decision record.**
  - It reads `start`, `measuredEnd`, `reverted`, `decisionStart`, `overflowStart` and `placedEnd` (`webkit/lines.ts:2408-2416, 2528`).
  - Item widths are already stored on items (`webkit/types.ts:131-133`).
- **Gecko's `glyphBefore` is a pure function of the offset, apart from its gap side effect.**
  - The side effect runs behind a `gaps: LineGaps | null` parameter (`gecko/lines.ts:68-122`).
  - `characters()` calls it for every source unit of every placed frame (`:917-934`).
  - One function reads the measure log as state (`:40`).
- **Output code mutates the decision in place.**
  - Blink justification: `blink/index.ts:746-749`.
  - Gecko trimming and positions: `gecko/lines.ts:1004, 1150`.
  - Output on request needs pure output functions, so this has to go.
- **The lab's gap attribution depends on gap order.** It takes the first gap, in list order, that meets a range (`lab/observe/blink.ts:80-92`). The scorer reads gap names and `at`, never `detail` (`lab/score.ts:492-560`).

**Prototype**

Files: `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/arch-plan/indep/` holds `blink-table.ts`, `debug1-4.ts`, `prep.ts`, and the copies `src-base` and `src-t`.

I patched a scratch copy of the Blink port with:

- a per-offset position table and pair table, replaying the gaps each position raised;
- an ICU scan that advances only as far as the line asks;
- the dead script scan skipped;
- a break-only entry.

Results:

- **Identical output.** Whole-line JSON, gaps included, matched the unpatched copy over 1,869 lines: six content types (Latin, justify with anywhere, pre-wrap with letter spacing, Arabic RTL, mixed with break-all, CJK) at 3–6 widths each against one prepared paragraph. Canvas call counts were identical.
- **Gap replay was exercised.** A second test put shaping-group edges between joining letters (an Arabic word split across spans). 275 positions carried gaps, and 300 lines showed 0 differences.
- **A bug found on the way.** 16.16 positions overflow Int32 past 32,768 zoomed px. A 15,000-unit paragraph broke until the table held doubles. The final design stores positions relative to the nearest cut, which stay below 2^24 by construction (`EXACT16`, `shape.ts:36`), so Int32 is exact.

JS time, stand-in Canvas:

| 15,000 Latin units, 389 lines, DPR 2 | Prepare | First pass | Same width again | Another width |
|---|---:|---:|---:|---:|
| Today | 22.4 ms, 917 calls | 55.6 ms, 1,297 calls | 54.2 ms (139 µs/line) | 54.0 ms |
| Table, full output as today | 15.0 ms | 16.8 ms, 1,297 calls | 4.2 ms (10.7 µs/line) | 4.0 ms |
| Table, break decision only | 13.7 ms | 3.5 ms, 831 calls | 0.47 ms (1.2 µs/line) | 2.0 ms, 119 new calls |

- The other scripts behave the same:
  - CJK: 39 ms → 0.48 ms on a repeat pass.
  - Arabic: 29 ms → 0.27 ms on a repeat pass.
- After this change prepare dominates, and over half of Blink's prepare is the content-gap pass, which makes no Canvas call:

| Paragraph size | Prepare today | With the content-gap pass on request |
|---|---:|---:|
| 15,000 units | 12.0 ms | 5.6 ms |
| 600 units | 520 µs | 221 µs |
| 16 units (a chat message) | 52 µs | 12 µs |

## 1. The design in one page

1. **Keep the engines' own two stages and make them the API.**
   - Blink (`PrepareLayout` and `ShapeText`, then `LineBreaker`), WebKit (`InlineItemsBuilder`, then the line builders) and Gecko (text run construction, then reflow) all do width-independent work once and then fill lines.
   - The saved bench agrees:
     - Chrome makes the same 12,677 calls for one width and for 20.
     - WebKit makes all of its calls in prepare.
   - So there is a prepared paragraph and a per-line call. That is where the similarity to main ends.
2. **Width is an argument of the line call.** It is no longer a field of the paragraph.
3. **One `Measurer` per page, owned by the app.**
   - It holds the Canvas contexts and a width store for short strings.
   - Canvas is the one genuinely expensive operation here. The store has stable input identity and measured reuse, and it is bounded by each engine's own units.
   - It replaces the per-paragraph measurer, the memo used as data flow, and the call log.
4. **Widths the engine keeps per offset are tables in the prepared paragraph, filled on first use.**
   - Blink's character position data, which Blink itself fills lazily in `EnsurePositionData`.
   - Gecko's per-glyph advances.
   - A table read builds no string and asks no Map.
5. **The line call returns the engine's own decided line.**
   - Blink's `LineInfo`, WebKit's closed run list, Gecko's placed frames.
   - Fragments, engine geometry and gaps are pure functions of it. Each is computed on request and then gone.
   - Nothing about the decision changes.
6. **Text in the output is a view.** A fragment holds ranges, and the painted string is sliced at paint time.
7. **Engine differences are modeled once: which module is imported.**
   - Each engine module has its own data, its own geometry types, its own CSS-px conversion and its own painter policy record.
   - No shared function takes an engine name.

## 2. Data model by stage

### Stage A: module lifetime (static data)

- Each engine directory has a `data.ts`.
  - It imports only that engine's generated tables.
  - It exposes parsed constants built at import: break rules, pair table, grapheme rules, bidi classes. Parsing a table takes 0.08 ms.
- No lazy slots, no `tables.ts`, no `bidiDataFor(engine)`, no `graphemeRulesFor(engine)`. Shared algorithms take the data as an argument.
- Generators emit only the `.brk` sections `rbbi.ts` reads, and emit byte-identical forward tables once.

### Stage B: page lifetime, owned by the app

```ts
type Environment = BlinkEnvironment | WebKitEnvironment | GeckoEnvironment   // as today, minus fields no engine reads

type Measurer = {
  contexts: MeasureContext[]          // creation order; engine styles hold indices into it
  byKey: Map<string, number>          // settings → index. A Map because the keys are user font strings with page lifetime
  calls: number; hits: number         // the lab reads these two and contexts.length; there is no log
}
type MeasureContext = { settings: CanvasSettings; ctx: OffscreenCanvasRenderingContext2D; widths: Map<string, number> }
```

Measuring functions:

- `measure(m, context, text)` reads and fills `widths`.
- `measureUnstored(m, context, text)` is for strings with no bound:
  - Gecko's suffixes and prefixes;
  - WebKit's `breakWord` prefixes;
  - Blink's first whole-group measurement.
  - The call site chooses. There is no length test inside.
- `measureBounds` stores its result too. That removes Gecko's `WeakMap<Measurer, Map>` (`gecko/lines.ts:49-61`).
- A recorded source for offline replay is a second way to construct a `Measurer` (`DESIGN.md` §8.3 stage 0). It is not a mode flag.

Lifetime: the app drops the `Measurer` when fonts load or memory matters, and prepares again.

### Stage C: input, owned by the caller

```ts
type Paragraph = TextStyle & { content: InlineNode[]; lang: string; direction: Direction; textIndent: number; textAlign: TextAlign }
type LineSlot = { width: number; left: number; right: number }   // content-box width in CSS px, and what floats take off each side (0 = none)
```

- The inline tree, `FontDecl` and `FontFacts` stay as they are.
- `Paragraph` is concrete; the lab keeps its own case type.
- `white-space` stays the CSS shorthand in the input. Each engine parses it into collapse and wrap once per style, as WebKit and Gecko already do.
- The paragraph no longer holds `width` or `lineHeight`. The painter takes `lineHeight`.

### Stage D: prepared paragraph

One per paragraph, independent of width. It lives as long as the app keeps the paragraph. Only the two lazily filled tables ever change.

Shared part:

```ts
type Content = { text: string; leaves: Leaf[]; elements: Element[]; events: ContentEvent[] }
type Leaf = { start: number; end: number; parent: number; event: number }            // a view into text, not a copy
type Element = { kind: 'span'; node; parent; open; close } | { kind: 'atomic' | 'br' | 'wbr'; node; parent; event }
```

- `Content` is built once and kept.
- The engine's output code and the painter read it.
- It is the only place leaf starts and parents live.

Every prepared paragraph holds `paragraph`, `env`, `measurer` and `content` by reference. None copies a fact out of them: no `baseLevel`, `textAlign`, `layoutZoom` or `sourceLength` fields.

**Blink**

- `text` (text_content), `is8Bit`, `segmented`, `bidiEnabled`.
- Per text unit:
  - `scripts` (U8);
  - `sourceOffsets` (I32);
  - `graphemeStarts` (U8);
  - `continuations` (U8);
  - `hanKerningCandidates` (I32).
  - The three source-indexed arrays (`contentOffsets`, `collapsedAt`, `sourceRuns`) go. Fragments and mapping derive them over the line's range.
- `styles: BlinkStyle[]`: one record per style. It absorbs the parallel `settings`, `contexts` and `hanKerning` arrays and the break table resolved for the style. The dead fields go.
- `items`: a tagged union per item kind, with no `-1` or `'none'` sentinels.
- `groups`: `{ start, end, style, rtl, cuts, prefixAtCut, startTrim16, endTrim16, startEdgeGap, endEdgeGap }`.
- `positions: { rel16: Int32Array; pair16: Int32Array; state: Uint8Array }`, per text unit.
  - `rel16` is the 16.16 advance from the nearest cut at or before the offset.
  - `pair16` is the pair adjustment there.
  - `state` holds a "filled" bit and two bits for "this position's measurement touched the group's start or end edge".
  - A line that reads a flagged position adds the group's edge gap to its gaps. Today the side effect inside `measure16` does that on every lookup.
  - Reshapes, the hyphen and tabs depend on the line and stay line-time measurements.
- About 20 bytes per unit against about 23 plus the memo today.

**WebKit**

- `rootStyle`.
- `elements`.
- `boxes`: the 16 fields line breaking reads. The 12 gap-only fields become derived data inside gap inspection.
- `items`: a tagged union where each item carries what its kind needs, so an item never looks up an element of another kind.
- `builder`.
- Stored item widths stay as they are.
- One break-position pass per box, kept on the box. This is WebKit's own `TextBreakingPositionCache`. Today a fresh whole-box ICU pass runs per boundary per line (`lines.ts:1255`, `breaks.ts:394`).
- The per-box constants now answered by the memo become box fields: space width, plain space width, hyphen width.

**Gecko**

- Per-leaf records instead of five parallel arrays.
- `spans`, `items` (tagged union, leaf data on the item), `frames`, `textRuns`.
- `tText: string`: one transformed string, sliced at measure time. It replaces the Uint16Array and its 14 rebuild sites. String storage doesn't matter to Gecko's Canvas; it does to Blink's, which is why Blink keeps `canvasString`.
- Per transformed unit: `tSource`, `breakFlags`, `clusterStart`, `isSpace`, `kind`, `spacingPrefix`, `correctionPrefix`, `unitOf`.
- `sourceT`.
- `units` with `canvasAu` and the start-advance prefix.
- `advances: { before: Int32Array; state: Uint8Array }`, per transformed unit: the in-word advance before the offset, filled on first use. The Gecko map's prototype of this table gave byte-identical lines (3.9 ms → 1.1 ms warm).

**Not stored on any prepared paragraph**

- Paragraph gaps.
- WebKit's page-history facts.
- Blink's content gaps.
- `fontKey` strings.
- The measure log.

### Stage E: the decided line

Made per `breakLine` call. It is the engine's own working state, which the decision builds anyway.

```ts
type BlinkLine = {
  slot: LineSlot; start: BlinkLineStart; next: BlinkLineStart | null
  sourceStart: number; sourceEnd: number
  results: ItemResult[]                      // LineInfo::Results with their views and reshapes
  lineLeft: number; lineRight: number; availableWidth: number; textIndent: number; width: number; unclampedWidth: number   // raw LayoutUnits
  hasLineBox: boolean; hasForcedBreak: boolean; isLastLine: boolean; hasTrailingSpaces: boolean; hasOverflow: boolean
  decisionEnd: number
  raised: { rule: GapRule; at: number }[]    // gaps the decision's own measurements raised, in order, as integers
}
type WebKitLine = {
  slot; start; next; sourceStart; sourceEnd; builder
  rect: { left; width; contentEdgeOffset; constrainedByFloat }
  runs: LineRun[]                            // the closed Line::Run list, a tagged union per run kind
  contentWidth; hanging; trimmedUnit; endsAtForcedBreakOrEnd; hasLineBox
  decision: { measuredEnd; reverted; decisionStart; overflowStart; placedEnd }   // exactly what lineGaps reads today
}
type GeckoLine = {
  slot; start; next; sourceStart; sourceEnd; band
  root: SpanData                             // placed frames of the final pass, trailing white space already trimmed
  lineIsEmpty; lineEndsInBR; hasLineBox
  consulted: number[]                        // in-word offsets the break scan asked advances for, in order
}
```

- **Line starts** lose their `engine` tag. Only one engine exists per page.
- **Below floats** becomes `{ kind: 'below-floats'; line; next }`.
  - `next` is always given, which removes the optional `next?`.
  - The refused line is kept so its gaps can be inspected.
- **`consulted`** follows the guide's "store the raw fact, interpret where it's needed".
  - Gecko's in-word gap check costs Canvas calls today, inside the decision: 1,015 of 4,263 line-phase calls on the Latin corpus with break-word.
  - With the offsets recorded, the check runs only when gaps are asked for, in the same order, stopping at the first that reports.
  - `glyphBefore` loses its `gaps | null` parameter.
- **Gecko's trailing trim** moves from `lineOutput` into the decision's close step. The line width depends on it, and natively it happens before the next line starts.

### Stage F: output

Pure functions of `(prepared, line)`, computed on request.

| Function | Returns | Notes |
|---|---|---|
| `lineWidth(prepared, line)` | The engine's alignment width in CSS px | Blink `(width − hangWidth) / 64 / zoom`; WebKit `contentWidth − hangingWidth`; Gecko `(width − hang) / 60` (`DESIGN.md` §2.6). The lab's per-engine `engineWidth` switch goes. |
| `lineFragments(prepared, line)` | `Fragment[]` | Today's union without `painted`. Text kinds carry the engine content range instead. |
| `fragmentText(prepared, fragment)` | string | Slices once, at paint time. |
| `inspectLines(prepared, lines)` | `{ paragraphGaps; lines: { geometry; gaps }[] }` | See below. |

`inspectLines`:

- One batch call.
  - Derived gap facts that span lines are computed once in its scope and dropped.
  - Those facts are Blink's content gaps, WebKit's box and history facts, and Gecko's in-word checks.
- It returns the per-engine geometry and gaps of today, in today's order: gaps raised by the decision, then edge gaps, then geometry gaps.
- Geometry is computed into locals. Nothing mutates the line.

## 3. Control flow

1. **Once per page**
   - `detectEnvironment(given)`.
   - One `switch (env.engine)` dynamically imports that engine's module and data.
   - `createMeasurer()`.
2. **Prepare, per paragraph**
   - Index the content.
   - Build style records: the shorthand is parsed, contexts are resolved through the `Measurer`, and the break table is resolved.
   - Build the engine's content (white-space processing), bidi and per-unit arrays.
   - Measure shaping-unit widths.
   - No gap pass.
3. **`breakLine`, per line**
   - The ported line filler runs unchanged in its rules.
   - A width comes from a prepared table. A miss measures and fills the table, with the same strings in the same order as today's first request.
   - Blink scans ICU from the line start only as far as the line asks.
4. **Counting or heights:** drop the line.
5. **Painting:** `lineFragments`, then `paintLine`.
   - `paintLine` is a DOM writer over fragments and `Content`.
   - It takes one policy record from the engine module:
     - hyphen span style;
     - soft-wrap-box rule;
     - whether hanging text is its own text node.
   - The painter therefore has no engine switch and no regex over painted strings. The fragment kind already says white space.
6. **Lab:** `inspectLines`.

## 4. Application-facing API and the engine interface

```ts
detectEnvironment(given): Environment | unsupported
loadEngine(env): Promise<Pretext>
createMeasurer(): Measurer

prepare(paragraph, measurer): Prepared
firstLine(prepared): LineStart | null
breakLine(prepared, start, slot): { kind: 'line'; line } | { kind: 'below-floats'; line; next }
layoutLines(prepared, width, slots): { lines; refused }        // today's slot loop (index.ts:116-138), one copy
measureLines(prepared, width): { lines: number; width: number; overflows: boolean }   // a plain loop over breakLine and lineWidth; no cache
lineWidth, lineFragments, fragmentText, paintLine(prepared, line, lineHeight, doc), inspectLines
```

- **Engine interface.**
  - Each engine module exports these as plain functions over its concrete types. This is today's `EngineImplementation`, with `nextLine` split into `breakLine` and the three output functions.
  - The lab and the tests import engine modules directly and see the concrete geometry types.
- **App surface.**
  - Apps get the same functions bound once over opaque `Prepared`, `LineStart` and `Line` types.
  - That takes one generic `bind` and one cast at the boundary.
  - A mismatched line start can't exist at runtime, so the `startMismatch` throws go.
- **What differs from main:**
  - the primitive is a line cursor;
  - lines are engine state;
  - output has three depths;
  - the measurer is explicit and shared;
  - width is per line;
  - the input is a tree.
- **Rejected: an immediate-mode API with no prepared handle.** Offline, prepare costs 10× a warm break pass in Blink (221 µs against 20 µs for 600 units) and 1.5–3× in WebKit.

## 5. How the four uses are served

- **Many paragraphs (chat, virtualized lists).**
  - One `Measurer` for the page. Prepare each message once.
  - Blink prepares a 16-unit message in 12 µs of JS. Today that is 52 µs plus 4 new canvases.
  - Heights come from `measureLines`.
  - Only visible rows ask for fragments.
- **Resize.**
  - Same prepared paragraph, new `slot.width`.
  - Widths already visited cost table reads: 1.2 µs per line for Blink offline.
  - A new width measures only the positions it newly probes: 119 calls for 15,000 units.
- **A different width per line.**
  - `breakLine` with that line's `{ width, left: 0, right: 0 }`.
  - That is a block of that width, without the float side effects of insets.
  - Insets remain for real floats.
- **Rich inline runs.**
  - The inline tree as today: spans with box edges, atomic inlines, `<br>`, `<wbr>`.
  - Fragments are data (leaf, ranges, level, box edges, atomic elements), so an app can paint its own elements or call `paintLine`.
- **Not served in this design:** userland line breakers that read segments and widths (justification-comparison). That needs its own decision.

## 6. What is deleted

**Library**

- `Paragraph.width` and `lineHeight`; `ParagraphOf<Font>` and the other generics.
- `PreparedParagraph`'s duplicated `engine`, `env` and `paragraph`.
- The `ParagraphLayout` union with its three identical arms.
- The five engine switches and static imports of all engines (`src/index.ts:41-105`).
- `UnportedFeature`, which is never thrown.
- `MeasureLog`, the text-keyed memo as data flow, `Measurer.keys` as built per paragraph, and Gecko's `ligatureMemo`.
- `Fragment.painted`.
- Per-line copies of `layoutZoom` and `appUnitsPerDevPixel`.
- `LineStart.engine`; the optional `next?` and `at?`; default-parameter modes such as `noLigatures = false` and `fixedPitchShortcut = true`.
- The `gaps | null` parameter.

**Moved to the lab**

- The observation-contract types (`model.ts:553-600`).
- `RecordedLayout`.
  - A lab adapter builds it from the new API.
  - It materializes `painted` with `fragmentText`, so the 153 GB of saved rows stay comparable.

**Engines**

- Blink:
  - the dead style fields;
  - the `fontKey` join with no separator (compare the fields instead);
  - the two hand-copied ignorable sets, which disagree at U+180F. Merging them is the owner's call.
- WebKit: the dead fields and about 80 dead lines the map lists.
- Gecko: the aliases and unread fields.
- Whole-paragraph scans per line in output code.
- `addGap`'s O(G²) dedupe by prose. Dedupe by rule and range instead; prose comes from a per-engine catalogue at inspect time.

**Data**

- Unread `.brk` sections, about 10%.
- Duplicated forward tables.
- The other engines' tables in every bundle.
- Owner's call: replace Gecko's `likely.ts` trie with a generated answer table. It is 478 lines plus 143 KB for 41 relevant entries.

## 7. Expected size and measureText calls

**Lines** (non-test; today 17,899)

| Area | Today | Target |
|---|---:|---:|
| Shared | 3,600 | about 2,900 |
| Blink | 5,055 | about 4,300 |
| WebKit | 4,913 | about 3,400 |
| Gecko | 4,331 | about 3,800 |
| Total | 17,899 | about 14,400 |

- The engine figures include each engine's moved geometry types.
- Per shipped engine: about 6,600 lines for Blink and about 5,700 each for WebKit and Gecko, plus only that engine's tables. Today every bundle carries about 1.5 MB of tables.
- These are judgment estimates built on the maps' per-file estimates.

**Canvas calls**

Estimates derived from the maps' ablations and the saved smoke bench.

| Case | Today | Target, count or paint | Target, lab inspection | Main |
|---|---:|---:|---:|---:|
| Chrome, Latin corpus, 15k units | 12,677 | about 4,800 (2,624 prepare plus about 2,160 line) | about 12,700 | 1,247 |
| Firefox, same | 5,190 | about 1,360 (`overflow-wrap: normal`) to about 2,100 (break-word) | about 5,200 | 1,247 |
| WebKit, same | 1,200 | 1,200 or fewer | about 1,200 | 4,374 |
| Chrome, 200 chat messages | 47,455 | about 9,000 | – | 2,043 |
| Firefox, same | 22,010 | about 2,300–3,500 | – | 2,043 |
| WebKit, same | 4,777 | about 2,100 | – | 6,968 |

**JS time**

- Blink relayout goes from about 140 µs per line to 1–10 µs per line offline (§0).
- That is within a small multiple of main; the saved bench has today's sweeps at ×143 to ×1,420.
- WebKit's and Gecko's gains, from the maps:
  - the `isDelimiterQuote` fix: prepare 219 → 53 µs;
  - the missing early exit: 39 of 42 ms;
  - `lineGaps` on request;
  - `characters()` on request.

## 8. Risks to correctness and how the gates catch them

1. **A table read must equal a recompute.**
   - Shown by the purity argument in §0 and the prototype: 2,169 lines, byte-identical.
   - Offline gate, new:
     - run the pinned old tree (a git worktree at a fixed commit) and the new tree over every case file with a stand-in Canvas that has kerning-, joining- and ligature-like behaviour;
     - require byte-equal `RecordedLayout`s.
     - This catches control-flow slips before any browser time.
2. **Gaps are side effects of measurement today.**
   - Blink's decision-time gaps stay recorded in order (`raised`). Table reads replay the group edge gaps.
   - Edge gaps and geometry gaps are appended in today's order, because attribution takes the first match.
   - Gate: the differential above compares gaps. The browser layout diff (item 4) confirms.
3. **A Measurer shared across paragraphs.**
   - Chrome caches shaped words per canvas and the first shaping wins.
   - `DESIGN.md` §5 lists "a fresh measurer per prepared paragraph" as part of the handling.
   - The bench's shared-measurer run kept the same lines on four scripts.
   - Gate: lab runs with one run-wide measurer in both case orders, diffed against per-paragraph rows.
   - If a class of cases moves, Blink alone falls back to per-paragraph contexts. That decision lives in the Blink module only.
   - The same gate covers the moved timing of inspection-only measurements.
4. **Browser gate, stricter than pass/fail.**
   - In each browser, diff the new `prediction.layout` byte for byte against the saved rows of the same build. Measure counts are excluded.
   - Then the existing no-regression gate, with 0 lost pairs.
   - The sealed sets are run once at the end.
5. **String storage in Blink.**
   - `canvasString` and its forced two-byte storage stay.
   - Only a table hit skips building a string.
   - No source slices are measured in Blink.
6. **The lazy ICU scan.**
   - Same iterator, same restart per line, same look-ahead array.
   - It stops early. It does not continue across lines, where stale look-ahead entries could differ.
7. **Rules and citations.**
   - A ledger script extracts every source citation and checks that each survives or is listed as dropped with a reason.
     - Today that is 231 distinct in Blink and 213 in Gecko.
     - WebKit's short forms need their own pattern.
   - The 476 current ids in `tests/rules.json` and the coverage matrix must not change.
   - The roughly 60 gap emit sites are counted the same way.
8. **Tests that assert today's shapes.**
   - About 2,900 lines of engine and observe tests.
   - They go through the lab adapter or move to the new functions mechanically.

## 9. Order of work

- **Step 0:**
  - the offline differential harness;
  - the layout-diff tool;
  - the citation ledger;
  - fix `bench/page.ts`, which fails `tsc` against the current API.
- **Step 1:** the shared layer, the API and the lab adapter.
- **Step 2:** each engine rewritten whole against the new shared layer, with no bridge code.
  - WebKit first: the smallest change, and it sets the pattern.
  - Then Gecko.
  - Then Blink.
  - Each lands at 0 differences in both gates.
- **Step 3:** profile in browsers and compare with main.
- **Step 4, only if step 3 says so:** reuse a paragraph's line count across widths inside the interval where no fit test flips.
  - It is exact only if every width comparison is threaded through one site per engine.
  - Validate it with an exhaustive offline width sweep.

## 10. Decisions for the maintainer

1. **The default line no longer carries gaps or per-cluster and per-character geometry.**
   - They are returned on request by `inspectLines`.
   - Charter tentpoles 1 and 3 call them output.
   - Nothing is lost, and the lab always asks.
2. **Gecko's first pass on text without spaces stays quadratic under the current recipe, `W(unit) − W(suffix)`.**
   - A 9,428-unit Chinese paragraph took 10,979 ms.
   - The advance table fixes every later pass, but not the first.
   - A suffix bounded at a checked split point would fix it. It is a recipe change, and needs a probe and a full Firefox layout diff.
3. **Blink's group halving shapes each character about 7 times in prepare.**
   - The registry already lists it as a heuristic.
   - A greedy forward cut is a recipe change under the same gate.
4. **A generated answer table for Gecko's `likely.ts`.**
5. **WebKit items as typed arrays.** Not recommended now; a tagged union with the payload on the item removes the casts.
6. **Support for userland line breakers is not designed here.**
