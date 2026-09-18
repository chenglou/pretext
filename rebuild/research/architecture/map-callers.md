# Map of the API layer and its callers (rebuild-20260916)

**Scope read in full**
- Library API layer: rebuild/src/index.ts, model.ts, env.ts, content.ts, paint.ts, measure/*, engines/engine.ts, engines/*/types.ts.
- Callers: lab/predictor.ts, page.ts, types.ts, observe/{blink,webkit,gecko}.ts, the library-facing parts of lab/score.ts, and bench/page.ts, protocol.ts, cases.ts, README.
- Main: README, the API calls in the demos, and markdown-chat.md.
- Engines: only where output and measurement are produced (blink/index.ts, blink/shape.ts, gecko/lines.ts `characters`, webkit `lineGaps`).

**How the numbers were obtained**
- (a) Saved development rows from `.artifacts/ceiling-20260917/evaluate-r2/<browser>/suite-sample-forward` (about 19,900 rows per engine).
- (b) The bench smoke in `.artifacts/bench/smoke-20260917`.
- (c) Offline bun prototypes in the scratch dir (`arch-plan/proto.ts`, `run-ablate.ts`, `rows-stats.ts`). They run the ports on corpus text with a stand-in Canvas, attribute every measurer lookup to its call path, and ablate a scratch copy of the source.
- The stand-in Canvas is nearly free, so offline times are JS cost only.

## 0. Who calls the library and what each caller reads

**Callers**
- `lab/predictor.ts:111,116` is the only production caller in a browser. It calls `layoutParagraph(paragraph, env, lineSlots)` and `paintLines(paragraph, layout, document)`.
- `rebuild/tests` never imports `rebuild/src` (tests/independence.test.ts). Its families reach the library only through the lab.
- The stepwise public API (`prepareParagraph`, `firstLineStart`, `layoutLine`, `paragraphGaps`, index.ts:39-84) has no caller and no test anywhere.
- Unit tests go around the public API: they call `blinkEngine`, `webkitEngine` or `geckoEngine` `.prepare/.firstLine/.nextLine/.gaps` with `createMeasurer()` (blink/lines.test.ts:70-88 and siblings).
- `UnportedFeature` (engine.ts:25) is exported and documented but never thrown.
- `bench/page.ts` is stale. Commit c9dbc32 (06:11) predates the inline-tree model e446bf6 (07:19).
  - `tsc -p rebuild/bench/tsconfig.json` gives 5 errors (page.ts:130, 131, 131, 133, 181).
  - It passes a number where `LineSlot` is expected, reads `.start/.end/.next` off a `LineResultOf`, and builds `Paragraph` with `runs`.
  - The saved bench numbers therefore describe an older library.

**What is read from `ParagraphLayout`**

| Reader | Fields read |
|---|---|
| Painter (paint.ts:49-53) | `fragments`, `hasLineBox`, `joinsNextLine`, `slot`, `indented`, `align`; Blink `geometry.needsAccurateEndPosition`; `belowFloats[].row`. No positions or widths. |
| lab/score.ts | `lines[].start/end`, `hasLineBox`, `gaps` (with `at`), `belowFloats[].row/gaps`, paragraph `gaps`; one width per engine (`engineWidth` :243-249: Blink `width`, WebKit `contentWidth`, Gecko `width`); Blink `geometry.layoutZoom` (:262). Everything else comes from the observation port's output. |
| observe/blink.ts | `geometry.mapping`; items' `kind/run/textStart/textEnd/level/x/inlineSize`; `clusters[].textStart/textEnd/graphemeStarts/advance`; element items' `x/inlineSize`; `hangWidth` and `align` (only to list unobservable facts); line and paragraph `gaps`; `env.devicePixelRatio`. |
| observe/webkit.ts | boxes' `kind/run/start/end/level/x/width/hyphen/expansion/expansionBehavior/shapedAcrossBoxes`; `geometry.alignmentOffset`; `hangingWidth`; fragments `hyphen`, `collapsed` and `wbr`; `env.pageZoom`. It also measures with its own live Canvas. |
| observe/gecko.ts | frames' `run/contentStart/contentEnd/measuredStart/level/x/width/usedHyphen`; `characters[].skipped/clusterStart/unitStart/advance`; element frames; `impactedByFloats`; hyphen fragments. |
| lab/page.ts:497-498 | `measure.contexts.length`, `measure.calls.length`, `measure.memoHits`. Nobody reads the logged texts or widths; they are dropped before the row is written (:389-395). |
| bench | `lines.length`, `lines[].start/end`, and the two log lengths. |

**Fields read by nobody outside unit tests**
- Blink: `lineLeft`, `lineRight`, `availableWidth`, `textIndent`, `alignOffset`, items' `hasStartEdge/hasEndEdge/marginStart/marginEnd`.
- WebKit: `lineLeft`, `contentEdgeOffset`, `lineBoxWidth`, `isWordSeparator`. `contentLogicalRight` is only named in an unobservable note.
- Gecko: `appUnitsPerDevPixel`, `lineLeft`, `availableWidth`, `textIndent`, `hang`, `alignOffset`, `hasHeight`.
- These are cheap by-products. The expensive unread output is the per-cluster and per-character geometry plus the per-line gap passes (section 3).

**Output size (JSON bytes per source unit in saved rows)**
- Blink about 110, Gecko about 100, WebKit 16-50.
- Geometry is 57-74% of that; fragments are 5-7%.
- Blink rows hold 764,028 cluster objects for 832,517 units. Gecko rows hold 830,576 character objects for 831,458 units.

## 1. Data structures by stage, lifetimes, and width dependence

1. **Input, owned by the caller**
   - `Paragraph` (model.ts:157-172): block style, `content: InlineNode[]`, lang, direction, `width`, `lineHeight`, textIndent, textAlign.
   - `Environment` (env.ts:50-91), built once per page by `detectEnvironment`.
   - `LineSlot[]`.
   - `width` sits in this prepared input although only line-time code reads it: blink/line-breaker.ts:145, blink/index.ts:1228, webkit/lines.ts:2345 and :2692, gecko/lines.ts:658.
   - No engine reads `lineHeight`.
2. **`ContentIndex`** (content.ts:33-39)
   - Holds the concatenated `text`, `leaves[]` (each with a copy of its text), `elements[]`, `events[]`.
   - Built in each engine's prepare (Blink keeps it as `BlinkPrepared.index`) and again in every `paintLines` call (paint.ts:162).
   - The three observation ports each walk the tree themselves by the independence rule (observe/blink.ts:284, webkit.ts:50, gecko.ts:37).
   - Width-independent.
3. **`Measurer`** (measure/canvas.ts:32-37)
   - `contexts[]`; `keys: Map<string, number>` keyed by 8 settings joined with spaces (:44-46); `memo: Map<string, number>[]`, one per context; `log {contexts, calls[], memoHits}`.
   - Created per paragraph by `prepareParagraph` (index.ts:40). Shared by prepare and every `nextLine`. Never shared across paragraphs.
   - `log` escapes into `ParagraphLayout.measure`, so every measured string stays alive with the result.
4. **Per-engine prepared state** (`BlinkPrepared` blink/types.ts:120-170, `WebKitPrepared` webkit/types.ts:148-169, `GeckoPrepared` gecko/types.ts:129-177)
   - All width-independent: content strings, per-unit typed arrays, items, styles, shaping groups with cuts and prefixes, stored item widths, unit advances, break flags, bidi levels, context indices, paragraph `gaps`.
   - Each also holds `paragraph` and `env`, which `PreparedParagraph` holds again (index.ts:34-37).
   - Text is kept two or three times:
     - Blink: `index.text`, `index.leaves[].text`, `text`.
     - WebKit: `runTexts[]`, `boxes[].text`.
     - Gecko: `text`.
5. **`LineStart`** per engine (blink/types.ts:173, webkit/types.ts:172, gecko/types.ts:184)
   - A small cursor record, created per line and returned as `line.next`.
   - Depends on every earlier break, but serves any slot.
   - It carries an `engine` tag that exists only for the mismatch throws in index.ts:66, 69 and 72.
6. **`LineOf<Start, Geometry>`** (model.ts:236-265), created per `nextLine`
   - Fields: `start/end`, `fragments[]` (with `painted` string copies), `hasLineBox`, `joinsNextLine`, `slot` (echo of the argument), `indented`, `align`, `geometry`, `gaps[]`, `next`.
   - All width- or slot-dependent.
   - `layoutZoom` (Blink) and `appUnitsPerDevPixel` (Gecko) are paragraph constants repeated on every line.
   - Blink allocates per line: a `LineBreaker` instance with its `shapeResults` Map (line-breaker.ts:133), 5 Sets and Maps in `elementsOn` (index.ts:357), a Map per `clustersOf` call (:596), and `lastOf` (:973).
   - WebKit and Gecko allocate similar Sets and Maps per line (webkit/lines.ts:1264, 1968, 2048-2050; gecko/lines.ts:552, 1176, 1243-1245, 1316-1317, 1373-1375).
7. **`ParagraphLayout`** (model.ts:544-547): `{engine, env (echo), lines, belowFloats, measure, gaps}`.
8. **Lab only**
   - `ExpectedObservation` holds a rect list per code point (133-164 MB against 67-137 MB of layout in the sample).
   - `RecordedLayout` is a persisted format: about 153 GB of saved rows depend on it.
   - lab/types.ts carries 8 "absent in rows from before" optional fields.
9. **Painted DOM**: one `div` per line box.

**Width-independent values that are nevertheless recomputed per line**
- Blink's advance before each cluster boundary inside the paragraph's shaping:
  - In the bench sweep, 20 widths logged 12,677 calls, the same as one width.
  - Offline, a second width added 63 calls after 10,736.
- Gecko's per-character advances inside shaping units.

**Truly width-dependent**
- The break chain.
- Blink's line-start and line-end reshape strings.
- WebKit `breakWord` prefixes and `carriedWidth`.
- Tab stops (they read the line position).
- The hyphen decision.
- Hang widths, alignment offsets and justification.
- Fragments, x positions, line gaps, and refusals.

## 2. Canvas measurement flow

**Context settings** (DESIGN §4.2)

| Engine | Contexts |
|---|---|
| Blink | 5 per style, created eagerly (ltr, rtl, two without ligatures, hyphen; shape.ts:81-88), whether or not the paragraph is RTL or needs them. At zero letter spacing the hyphen context equals ltr, so 4 are distinct. |
| WebKit | 2-3 per box, plus 2 coverage contexts for fixed pitch (content.ts:251-266). |
| Gecko | 1 per text run, plus device and emoji contexts and a block space context (prepare.ts:1145, 1204-1205, 1298). |

- Saved rows average 4.11 contexts per row in Chrome, 3.18 in Firefox and 1.17 in WebKit.
- Every context is a new OffscreenCanvas per paragraph, so Chrome's per-canvas shaped-word cache starts cold for each paragraph.

**Totals**

| | Canvas calls per unit (rows) | Memo hits per unit (rows) | Bench, Latin 15k: rebuild vs main |
|---|---|---|---|
| Chrome | 2.04 (3.13 under 20 units) | 11.1 | 12,677 vs 1,247 |
| Firefox | 1.52 | 1.68 | 5,293 vs 1,247 |
| WebKit | 0.365 | 0.55 | 1,200 vs 4,374 |

- Bench many/latin (200 messages):
  - the rebuild made 47,455 calls in 400 contexts;
  - one shared measurer made 24,171;
  - main made 2,043.

**Where overlapping text is measured again**

Offline attribution, Blink, 5,000 Latin units, 119 lines: 3,740 Canvas calls and 57,234 memo hits in line filling (about 510 lookups per line), and about 30 string units handed to the measurer per source unit.

- (a) Blink `addCuts` (shape.ts:432-464) measures the whole range at every recursion level (:435).
  - Each unit is shaped about log2(n/36) times before lines start.
  - Example: 880 calls and 29,069 string units at the deepest level alone for 5k units.
- (b) `groupPrefix16` (shape.ts:497-518) evaluates `pairAdjust16` twice at a cut (:511, :513). Each evaluation is 3 `measure16` calls.
- (c) Every `measure16` (shape.ts:289-332) builds a `CanvasString` before the memo lookup.
  - That means three arrays, an `Int32Array.from` and a `String.fromCharCode`.
  - For any string holding a space it also runs `scriptsPerUnit` (:307), which is used only when letter spacing is non-zero.
  - Segmented paragraphs scan for script edges and recurse (:295-301).
- (d) `offsetForPosition` (shape.ts:638-660) binary-searches the whole item, with two position evaluations per step and 4-7 lookups each.
  - That is about 14 steps for a 15k-unit item, on every line.
  - Cost: 592 Canvas calls and 8,472 hits.
- (e) `clustersOf` (blink/index.ts:593-611) makes one new prefix string per cluster boundary of every placed item, plus the pair adjustment.
  - Prefix strings inside a roughly 36-unit piece overlap, about L²/2 shaped units per piece.
  - Cost: 2,760 of the 3,740 line-time Canvas calls (74%) and 39,764 of 57,234 hits (69%).
- (f) Blink `lineEdgeGaps` (index.ts:284-355) measures pair adjustments with and without ligatures at each line edge.
  - Cost: 355 Canvas calls and about 6,100 hits per 119 lines.
- (g) WebKit `lineGaps` (webkit/lines.ts:2408) measures again every item on the line and the fixed-pitch comparisons, only to report gaps.
  - It accounts for all of WebKit's line-time lookups: 25 calls and 4,513 hits per 134 lines.
- (h) Gecko `characters()` (gecko/lines.ts:917-934) computes `W(unit) − W(suffix)` per source unit.
  - It makes 1,115 of 1,662 line-time calls (67%).
  - `breakAndMeasureText > rangeAdvance > glyphBefore` makes the other 547, for breaks inside shaping units.
- (i) The lab's WebKit observation port measures 2-3 prefixes per code point from the box start (observe/webkit.ts:207-239, 317-321).
  - It uses its own contexts, keyed by `JSON.stringify(settings)` on every call (page.ts:359-376).
  - On the development sample, observeMs is 10,361 against predictMs 2,008.
- (j) `measureTextBounds` (canvas.ts:69) is never memoized.

## 3. Repeated or wasted work and its complexity

**Public API**
- The public API can't lay a prepared paragraph out at another width, so a resize pays prepare plus lines again.
- Bench sweep/latin/corpus in Chrome:
  - 2.63 s for 20 widths through `layoutParagraph`;
  - 1.49 s with the internal prepare-once loop;
  - 7.66 ms for main.

**Blink**
- With every string already memoized, Blink still spends about 150 µs per line offline (53.6 ms for 358 lines) and about 205 µs per line in Chrome (73 ms per width in the bench).
- The cost is string building and Map lookups, not Canvas.

**Ablation on the scratch copy, 15,000 Latin units**

| Port | Ablation | Line filling before → after | Line-time Canvas calls before → after |
|---|---|---|---|
| Blink | without `clustersOf` | 57.7 ms → 18.7 ms | 10,736 → 2,763 |
| Blink | also without `lineEdgeGaps` | → 14.3 ms | → 2,161 (about 100 lookups per line remain) |
| Gecko | without `characters()` | 5.6 ms → 2.0 ms | 3,555 → 1,385 |
| WebKit | without `lineGaps` | 1.9 ms → 0.9 ms | measurer lookups (hits + misses) 13,277 → 0 |

- For comparison, main's line walk is about 0.12 µs per line.
- Without per-cluster geometry, Blink's second width needs about 940 new calls instead of 63, because the geometry had been pre-measuring break positions as a side effect.

**Gecko on space-less scripts is quadratic**
- A shaping unit is a word between spaces, so without spaces the unit is long and each in-unit position costs a suffix measure of unit length.
- A saved Firefox row of 9,428 Chinese units, c-a580f4ad18b9ea2c:
  - 27,059 calls;
  - predictMs 10,979.
- The 100k-unit Latin rows take about 50 ms each.
- Offline zh text runs at 170-330 µs per line against 13 for Latin. The break path itself pays, not only the geometry.

**Gaps and output assembly**
- `addGap` (blink/gaps.ts:9-24) scans all gaps and compares long `detail` sentences on every add: O(G²).
  - A saved paragraph reports 5,317 ranged gaps (noted in observe/blink.ts:50-53).
- `mappingOf.generated` scans all items per generated unit (blink/index.ts:1063-1071).
- `lineOutput` scans all groups on every line (:1119-1131).

**Lab only**
- observe/blink.ts `unitAt` (:196-200) and `quadsForRange` (:240-277) scan every mapping unit and item of the run for each code point: O(n × lines).
- `caret` sums all clusters on every call.
- The culled-span path is quadratic in elements (:406-427).

**Call log**
- One `{context, text, width}` object is pushed per measureText call (1.7 M objects for the Chrome sample).
- Only the three counts are read.

## 4. Engine, direction or mode differences woven through shared code

- index.ts has 5 switches over `engine`, each with three identical arms (:41-45, :50-54, :64-74, :79-83, :92-105).
- index.ts also has three mismatch throws and a generic `EngineImplementation` object per engine, which is a dispatch table in the guide's sense.
- It imports all three engines statically, and `breaks/tables.ts:5-7` imports all three generated tables (586 KB Blink, 644 KB WebKit, 41 KB Gecko).
  - `unicode/bidi.ts:53` and `grapheme.ts:17` switch on the engine name.
  - A bundle therefore can't ship one engine without per-engine entry points.
- model.ts holds all three engines' geometry (:279-490) and imports the engines' `LineStart` types (:5-7), a circular type dependency.
- `CanvasSettings.partition` exists for Blink only.
- paint.ts has three engine conditionals that a per-engine policy record would replace:
  - `hyphenSpan` (:93-108);
  - the soft-wrap rule (:309-313);
  - the hanging-spaces text node (:420).
- paint.ts also has direction and mode locals (`base`, `collapses`, `wraps`, `reorders`).
- There is no engine-neutral CSS-px line width in the output, so callers switch on the engine:
  - score.ts `engineWidth`, `rectUnits`, `spans`, `widthDifference` (:243-327);
  - `slotProtocol` units (:205-211);
  - the shrink-wrap formula, which lives only in DESIGN §2.6.
- `engineOf` and `givenFacts` are duplicated verbatim in lab/predictor.ts:21-41 and bench/page.ts:102-118.
- env.ts repeats 5 fields across three environment types and again in `GivenFacts`.

## 5. Guide violations worth fixing in this area

**Caches and memos**
- Measurer memo Maps and the string-keyed context Map (canvas.ts:34-46).
- Gecko `ligatureMemo`, a WeakMap per measurer (gecko/lines.ts:51).
- The per-line `shapeResults` Map (line-breaker.ts:133).
- page.ts `portContexts` and `fontResolves`.
- The memo is what makes the repeated string derivation affordable, so it hides it.

**Composite string keys**
- `measureContext` joins 8 fields (canvas.ts:44-46).
- `JSON.stringify(settings)` on every observation measure (page.ts:360).
- `BlinkStyle.fontKey` (blink/types.ts:43).
- `addGap` deduplicates by comparing `detail` sentences.

**Map or Set where an array fits**
- paint.ts:245-246 `startEdges` and `endEdges`.
- The per-line Sets and Maps listed in section 1.
- observe/blink.ts `includedHyphens`.
- `CJK_SYMBOLS` exists twice: webkit/expansion.ts:23 and observe/webkit.ts:112. The lab copy is deliberate under the independence rule.

**Denormalized copies and derived fields**
- `PreparedParagraph.paragraph/env` against `state.paragraph/env`.
- `LineOf.slot`.
- `ParagraphLayout.env`.
- Per-line `layoutZoom` and `appUnitsPerDevPixel`.
- `indented`.
- Three copies of the paragraph text.
- `Fragment.painted` copies text; a view into the engine content plus one slice at paint time would do.

**Defensive code**
- predictor.ts:33-39 has four `languages?.engine === …` optional chains after `environment()` already rejected a mismatch (:45).
- The index.ts start-mismatch throws.
- The optional `next?` on `below-floats` (model.ts:277).

**Generics serving only the lab**
- `ParagraphOf<Font>`, `InlineNodeOf`, `TextStyleOf`, `InlineElementOf`.
- The observation contract types (model.ts:553-600) live in the library because of the lab's import rule.

**Side effects during measurement**
- Blink gaps are pushed as side effects of measuring: `joinedAtEdge` (shape.ts:163-177), `makeView` (:748), `clustersOf` (index.ts:602), all through a mutable `Shaper.gaps` sink swapped between prepare and each line.
- `line.gaps` therefore depends on which measurements ran, including the unread geometry.
- Any design that makes geometry on demand must keep those gap conditions firing.

**Iterator chains** (none hot)
- page.ts:71-77, 106, 347.
- observe/blink.ts:357, 365 (a `map` per code point).
- gecko.ts:89, 169, 184.

**Exceptions as control flow**
- page.ts wraps predict, observe and paint in try/catch and turns errors into row data. That is a fair boundary.
- bench has none.

**Migration glue**
- The flat `runs` case format against the tree:
  - predictor.ts:55-104;
  - page.ts:229-301, with two build paths;
  - lab/types.ts:23-66.
- The `LayoutPrediction | LinesPrediction | {error}` union is narrowed with `'layout' in` checks; there are 31 such `in` checks across the lab.
- `recordedLayout` has three identical arms (page.ts:389-395).

**Dead or unread**
- `UnportedFeature`.
- The stepwise API (no callers).
- Log texts and widths.
- The scalar geometry fields listed in section 0.
- bench/page.ts, which does not compile.

## 6. Line counts and rewrite estimate

**Totals**
- `rebuild/src`: 17,939 lines excluding tests and generated files. 2,544 of those are comment lines, which carry the citations.
- Tests: 2,939 lines.
- Generated tables: 1.49 MB.

**API layer**

| File | Lines |
|---|---|
| index.ts | 138 |
| model.ts | 600 (285 comment) |
| env.ts | 153 |
| content.ts | 101 |
| paint.ts | 489 |
| measure/ | 110 |
| engine.ts | 35 |
| gecko and webkit index.ts | 60 |
| Total | 1,686 |

**Callers**

| File | Lines |
|---|---|
| lab/predictor.ts | 117 |
| lab/page.ts | 553 |
| lab/types.ts | 260 |
| lab/observe (3 ports, plus 511 of tests) | 1,138 |
| bench/page.ts | 484 |
| bench, other files | 1,212 |

**Estimate for a from-scratch API layer with the same behaviour and all citations: about 1,350 lines**
- Per-engine entry modules and one shared slot loop: about 90.
- Input and shared output types: about 330, with engine geometry moved into each engine (about 215, moved, not removed) and observation types moved to the lab.
- env: about 110.
- content: about 90.
- measure: about 70, with counters instead of a log and no memo.
- Painter: about 400, as pieces-as-data plus a DOM writer.

**Callers**
- predictor about 90; page about 500; observe about 1,000; bench/page.ts about 350, rewritten against the new API.

**Whole library**
- A rough guess is 12-14k lines, since ported rules dominate. It is low confidence, because I read the engines only where output and measurement are built.

## What an application-facing API has to serve (from main's demos)

- **Many paragraphs, resize.**
  - markdown-chat prepares 10,000-100,000 messages once and re-counts lines for all of them per width change in 8-13 ms (markdown-chat.md). That is about 1 µs per message.
  - Needs: a line count per prepared paragraph and width, with no allocation and ideally no Canvas call. Only visible rows ask for lines (markdown-chat.model.ts:867-881 against :912-977).
  - Today every `nextLine` allocates fragments, geometry, gaps, Sets and Maps, and measures.
- **Shrink-wrap.**
  - The widest line's alignment width in CSS px, found in the same walk (bubbles-shared.ts:62-79, markdown-chat.model.ts:930-934).
  - The output has no such field.
- **A width and insets per line.**
  - editorial-engine.ts:446-476 and dynamic-layout.ts:331 lay each line in its own slot, several per row.
  - Each slot is painted as its own block, so its true counterpart is a block of that width, not floats.
  - `LineSlot` expresses only float insets off a frozen `paragraph.width`, with float side effects:
    - below-floats refusals;
    - WebKit's switch to LineBuilder through `hasFloats`;
    - Gecko's `impactedByFloats`.
- **Rich inline runs.**
  - Items with font, letterSpacing, `break: 'never'` and `extraWidth` (markdown-chat.model.ts:524-530, rich-note.model.ts:155-171) map onto the inline tree: spans with box-edge padding, nowrap spans, atomic inlines.
  - The app paints its own elements (links, classes, the space placed per `gapItemIndex`; markdown-chat.ts:270-311).
  - So it needs a line's pieces as data (leaf index, source range, painted text, level, box edges) rather than `paintLines`' finished DOM, which is all or nothing.
- **Userland breakers and single measures.**
  - justification-comparison.model.ts:245-290 reads `prepared.segments` and `prepared.widths` to run its own line breaker.
  - variable-typographic-ascii.ts:91-92 reads `widths[0]`.
  - Both want break opportunities with the widths between them, and the width of one string.
- **Painting one line box per predicted line** with the paragraph's direction is the pattern the demos share (markdown-chat.md, "One line box per Pretext line"). `paintLines` already does that and handles bidi by override spans.
- **Cross-paragraph reuse.**
  - Main's many/latin is cheap because one context and its word widths carry across messages.
  - The rebuild's per-paragraph Measurer rules that out by construction. The shared-measurer experiment halved calls with the same lines in the smoke run.
