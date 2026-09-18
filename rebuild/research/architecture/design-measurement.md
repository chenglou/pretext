# Target architecture, measurement first

Paths are under `~/github/pretext-rebuild/rebuild/` unless absolute. "Unit" means a UTF-16 code unit.

Offline numbers come from bun prototypes with a stand-in Canvas. The prototypes are in `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/arch-plan/measure-first/`. The stand-in reproduces Chrome's real call count on the Latin corpus within 1.5%: 12,869 offline against 12,677 in the saved bench. Nothing under the repo was touched and no browser ran.

## 0. The design in one page

**What the design rests on, checked in code and numbers.** Every Canvas number the three ports use depends only on the paragraph and one or two text offsets. The line width never enters a measured string. It only selects which offsets a line asks about.

- **Blink.** A position is `prefixAtCut + W([cut,k)) + pair adjustment` (`src/engines/blink/shape.ts:497-518`). It takes no width argument.
- **Gecko.** `glyphBefore(p, m, run, t)` is pure in `(paragraph, t)` (`src/engines/gecko/lines.ts:68-122`).
- **WebKit.** `boxWidth(box, from, to)` is pure except tab-stop arithmetic (`src/engines/webkit/measure.ts:117-134`).
- **Width.** `paragraph.width` is read at five sites, all at line time:
  - `blink/line-breaker.ts:145`
  - `blink/index.ts:1228`
  - `webkit/lines.ts:2345` and `:2692`
  - `gecko/lines.ts:658`
- **Saved Chrome bench.** One width and 20 widths make the same 12,677 calls.

So the architecture is:

1. **Facts.**
   - A fact is one measured number: a recipe, a Canvas context, an integer key, and the gap conditions its measurement rests on.
   - Each engine has one `facts.ts`. It is the only file that calls Canvas, through one `measure(context, string)` function.
   - A fact is measured once per paragraph. A later read is an array read and builds no string.
2. **When facts are measured.**
   - Prepare measures the facts every width needs: piece, item and unit totals.
   - A fact inside a word or piece is measured the first time a line asks for it. It is stored by offset on the prepared paragraph.
3. **Three depths of a line,** as three functions over one shared decision step:
   - `breakLine`: where the line ends, its width in CSS px, and the next start.
   - `layoutLine`: `breakLine`'s answer plus fragments for painting.
   - `inspectLine`: today's engine-true output, with per-cluster and per-character advances, mapping and gaps.
   - Measurements that exist only for geometry or gaps run only under `inspectLine`.
4. **Width is a line argument** next to the float insets: `{ width, left, right }`. `Paragraph` has no width.
5. **A session** owns the Canvas contexts and the one capped width store.
   - It has page lifetime, and the caller owns it.
   - Nothing mutable lives at module level.
6. **One entry module per engine.**
   - Shared code never takes an engine name.
   - A bundle holds one engine and its data.

**What this buys, offline**

| | Today | Break decision alone | Plus session store | Plus Blink word pieces (gated) | Words measured once each |
|---|---:|---:|---:|---:|---:|
| Blink, 200 chat messages (26,072 units), Canvas calls | 46,198 | 15,196 | 7,000 | 990 | 516 |
| Blink, Latin corpus 15,000 units, calls | 12,869 | 5,112 | | 2,520 | main 1,247 (real) |
| Blink, 20 widths on the corpus, calls | 12,869 | 11,107 | | 4,361 | |
| Gecko, 200 chat messages, calls | 16,287 | 5,317 | 716 | | 516 |
| Blink relayout JS per line | 116 µs | 3.6 µs with fact tables | | | |
| Blink contexts for 200 messages | 800 | | 4 | | |

The last column is what main's shape costs on the same text. "Words measured once each" counts each distinct word once and shares the result across messages.

The structural part (items 1 to 6) moves no output. §9 gives the evidence and the gates. Four changes alter what is measured, so each needs a browser gate (§9.2):
- Gecko windows for long units;
- Blink word pieces;
- a bound for WebKit's gap check;
- Blink contexts split by each string's storage class.

## 1. What must be measured, under which context

"Today's site" is where the code is now.

### 1.1 Blink

Contexts, per style (`shape.ts:81-88`):
- `ltr` or `rtl`, by the group's direction;
- the hyphen context, with letter spacing 0;
- `ltrNoLigatures` and `rtlNoLigatures`.

Today all five are created for every style of every paragraph. In the target a context is created on first use, in the session:
- `rtl` is never created for LTR text.
- The no-ligature contexts are created only under `inspectLine`.

| Fact | Today's site | Key | Strings per key | Measured | Conditions it carries |
|---|---|---|---|---|---|
| Piece width | `addCuts`, `measureGroups`, `shape.ts:432-484` | (group, piece) | 1 | prepare | `unsafe-to-break` where no safe cut exists; `float32-precision`; joining at group edges |
| Pair adjustment d(k) | `pairAdjust16`, `shape.ts:385-393` | (group, k) | 3 windows: xy, x, y | first read (prepare reads it at cut candidates) | joining at a group edge, when a window touches it |
| Position before k | `groupPrefix16`, `shape.ts:497-518` | (group, k) | 1: `[piece start, k)` | first read | inherits the pair's conditions |
| Item shape result | `itemShapeResult`, `shape.ts:566-575`, behind a per-line Map (`line-breaker.ts:133`) | item | none of its own: two positions | prepare | |
| Reshape `[a,b)` | `reshape`, `reshape­HanKerningEnd`, `shape.ts:862-894` | (group, a, b, edge kind) | 1 | at the line, at most 2 per line | `joining-technology`, `unsafe-to-break`, `han-kerning` |
| Hyphen; space for tabs; HanKerning font data | `shape.ts:916-938`, `hankerning.ts:58-82` | context | 1 to 12 | first use per session | `hyphen-glyph`, `tab-stops`, `han-kerning` |
| No-ligature pair; wide window | `shape.ts:396-416`, used by `index.ts:241-348` | (group, k) | 3 each | inspect only | none |
| Per-cluster advances | `clustersOf`, `index.ts:593-611` | none of its own | reads a position at every cluster boundary | inspect only | `glyph-clusters` (`:602`) |

Reshapes are not stored by offset. At 1 or 2 per line they don't justify another structure, and they still go through `measure()`.

### 1.2 WebKit

Contexts, per box (`content.ts:250-266`):
- `context`, `plainContext`, and `spacedContext` only when word spacing isn't 0;
- two coverage contexts for fixed-pitch boxes.

| Fact | Today's site | Key | Measured |
|---|---|---|---|
| Item width: the word with its following space, and `' '` | `content.ts:321-347`, `measure.ts:117-134` | item | prepare |
| Space, plain space, hyphen | looked up again on each use: `measure.ts:75`, `:92`; `lines.ts:90-95` | box | prepare, as box fields |
| A width with no stored value: a bidi-split item, or a rest without a carry | measured twice per placement, `lines.ts:1185` then `:1102` or `:1115`, and again at `:1383` and `:1624` | (item, from, to) | first read, then stored |
| Text between TABs | `tabbedWidth`, `measure.ts:73-88` | (box, from, to) | first read; only the tab-stop arithmetic is per line |
| `breakWord` probe | `measure.ts:174-245` | (box, from, to) | at the line, with the exact probe order kept |
| An RTL trimmed word without its space | `lines.ts:449` | item | first read |
| Coverage probes | `content.ts:267-275` | distinct code point (today 3 lookups per occurrence) | prepare |
| T1 fixed-pitch comparison; simplified-measuring sums; page-history parts | `lineGaps`, `lines.ts:2408-2580` | | inspect only |

### 1.3 Gecko

Contexts:
- One per text run (`prepare.ts:1140-1145`).
- The device-size and emoji contexts are created only for a run that holds a cluster with Emoji presentation or a candidate for a synthesized space. Today the device context's key is built for every word of every 16-bit run at DPR ≠ 1 (`prepare.ts:1204`).

| Fact | Today's site | Key | Strings | Measured |
|---|---|---|---|---|
| Unit au | `prepare.ts:1170-1282`, `rangeAu` `:500-522` | unit | 1, or 2 with the script-context recipe | prepare |
| Window au, for units over 64 units (gated, §9.2) | new | (unit, window) | 1 | prepare |
| Advance before t | `glyphBefore`, `lines.ts:68-122` | t | 1 suffix to the unit's or window's end; 1 more prefix when the unit is shaped reversed or kerning is split | first read |
| In-word condition at t | `lines.ts:92-103`, `:39-60` | t | a prefix, and 2 ink-box calls in each of 2 contexts | inspect only |
| Space-in-shaping stretch | `prepare.ts:1158-1169` (a 15,000-character call on the corpus) | stretch | 1 | paragraph gaps only |
| Emoji and synthesized-space corrections | `prepare.ts:1195-1273` | cluster | up to 4 widths and 2 ink boxes | prepare |
| Hyphen, `'0'`, space | `prepare.ts:1286-1303` | run | 1 each | prepare |
| Per-character advances | `characters`, `lines.ts:917-934` | none of its own | reads "advance before t" for every t | inspect only |

The in-word condition is checked in the order the line consulted its offsets, and checking stops at the first report, as today.

### 1.4 Two rules that keep gaps exact

1. **A fact carries the conditions its measurement reported, and every reader inherits them.**
   - Today `measure16` reports `joining-technology` or `unsafe-to-break` each time it is called, before the memo is consulted (`shape.ts:163-177`, `:304`).
   - So a gap lands on every line whose decision reads that number. A stored fact must therefore keep its conditions and hand them to each reader.
   - **Prototype** (`blink-table.ts`): positions and pair adjustments stored by offset, with the gaps captured when the fact is measured and handed to each reader.
     - Cases: 40, with 853 lines. They cover Latin, justify, `overflow-wrap: anywhere`, CJK, Arabic RTL, break-all, mixed bidi, spans with box edges, a span edge in the middle of an Arabic word, and pre-wrap with tabs and soft hyphens.
     - Result: 80 of 80 outputs byte-identical. That covers lines, geometry, line gaps and paragraph gaps, with full output and with the break decision alone.
     - The Canvas calls were the same set (20,506).
     - Gaps those cases raised on lines: `joining-technology` 42, `in-word-prefix` 58, `glyph-clusters` 37, `unsafe-to-break` 5.
2. **Gap checks that need extra measurement run only when gaps are asked for.**
   - They run in today's order: the decision's conditions, then the edge checks, then the geometry's.
   - The decision always records the cheap raw facts those checks need:
     - Blink `decisionEnd`;
     - WebKit `measuredEnd`, `reverted`, `decisionStart`, `overflowStart`;
     - Gecko's consulted in-word offsets, in order.
   - Recording costs a few integer writes. The checks and the prose `detail` strings are built on demand.

## 2. What each later question reuses

| Question | Reuses | Measures again |
|---|---|---|
| New width on resize | Everything prepared, and every fact an earlier line read. | Only facts at offsets no earlier width asked about. |
| A width or float insets per line | The same as a new width. A slot changes arithmetic and tab stops only. | The same as a new width. |
| Colour or another paint-only style | Everything. | Nothing. |
| Font, spacing or lang change on one span | The analysis is redone, which costs microseconds per 100 units. Every other span's strings come from the session store. | That span's strings, in its new context. |
| Appended text (streaming) | Prepare again. The store answers every string that didn't change. | WebKit and Gecko: only the last words. Blink today: every piece on every append. |
| Many paragraphs | The session's contexts, and the store for words, clusters, pairs, space and hyphen. | The rest. |
| DPR, zoom or a loaded font | Nothing. The caller makes a new session. | Everything. |

- **New widths, measured.**
  - Blink on the corpus: 5,112 calls at the first width and 11,107 over 20 widths. That is about 0.02 calls per unit per new width.
  - Blink on 200 chat messages: 7,000 calls at one width and 13,089 over 8 widths. That is about 4 calls per message per width.
  - With word pieces (gated): 990 at one width and 1,009 over 8.
  - WebKit: none, beyond `breakWord` probes and RTL trims.
  - Gecko chat: 716 calls at one width and 716 over 8.
- **Why Blink re-measures every piece on append.**
  - Halving cuts move with the text's length.
  - Today: 12,115 calls over 133 appends to 2,279 units, 810,728 characters shaped, and the last append alone costs 143.
  - With word pieces (gated): 1,320 calls in all, and 9 on the last append.

### 2.1 Which reuse the guide's caching rules allow

**Allowed**

- **The prepared paragraph.**
  - It is parsed and normalized input, not a cache.
  - Doing the analysis again per resize would cost about 1.8 µs per unit in Blink.
- **Fact tables, stored by offset.**
  - They are Blink's and Gecko's own data structures: Blink's ShapeResult position data and Gecko's glyph records. The ports can fill them only by asking Canvas.
  - Stable identity: the prepared paragraph is immutable input, and the key is an integer.
  - Real reuse: 5 to 9 reads per fact per layout today, and every relayout. Relayout falls from 116 to 18 µs per line with full output, and from 30.6 to 3.6 µs with the break decision alone.
  - Bounded: at most 16 bytes per unit, freed with the paragraph. A group allocates its table on first read, so a paragraph that fits on one line allocates none.
- **Session contexts.** An OffscreenCanvas with a parsed font is a resource, not a result. For 200 messages the count falls from 800 to 4.
- **The session width store,** `(context, string) → width`. It is the only cache in the library.
  - Stable identity: the settings and the string are values, and Canvas is deterministic per context (DESIGN.md §4.6).
  - Real reuse: the chat and streaming numbers above.
  - Bounded: capped by total key characters and cleared whole at the cap.
    - Strings over 64 units bypass it. Those are ranges tied to one position, such as Gecko's suffixes and Blink's whole groups, and they are never reused.
  - One boolean in `measure()` switches it off, so its worth can be profiled in browsers before it is kept.

**Filling on first read.**
- Filling every position in prepare would make resize free of Canvas calls.
- It would also raise the cold cost 2.5 times: 12,869 against 5,112 calls on the corpus.
- The cold layout of many paragraphs is this library's worst case.
- The cold cost of a line is bounded either way:
  - Blink makes at most 2·log2(item length) position probes per line, each with at most two short strings.
  - Measured on the corpus: 5.8 calls per line, or 3.0 with word pieces.
- An app that wants resizes free of Canvas calls can call an optional `measureAhead(prepared)` in idle time. It is a loop over the fact functions.

**Not allowed, so removed**

- The text-keyed memo as the read path. Today that is 8 to 25 lookups per unit in Blink, each building a string first (`canvasString`, `shape.ts:241-285`).
- Per-line Maps and flag caches:

| Structure | Site | Replacement |
|---|---|---|
| `shapeResults` | `blink/line-breaker.ts:133` | prepare-time item facts |
| `icu` and `graphemes` flags: a `Uint8Array(n+1)` per line start, scanned to the end of the text | `blink/breaks.ts:110-111`, `:134-168` | a lazy `next()` from the line start; same boundaries, O(line) |
| `ligatureMemo` | `gecko/lines.ts:61` | part of the condition stored by offset |
| `BreakFactory.following`, rebuilt per query | `webkit/lines.ts:1255`, `webkit/breaks.ts:394` | per-box opportunity flags computed in prepare |
| Provider `tabs` Map | `gecko/lines.ts:552` | recomputed |
| Lazily parsed table slots | `breaks/tables.ts:12-17`, `unicode/bidi.ts:50-51` | per-engine data modules decoded at import |

- Any store of lines per width. Lines are recomputed, at microseconds per line.
- Derived fields and copies (§7).

## 3. Data model per stage, with lifetimes

1. **Session.** Page lifetime, owned by the caller.
   - `{ env, contexts: Context[], store, counters, log: MeasureCall[] | null }`.
   - A `Context` is `{ ctx, settings }`, and styles hold `Context` references. No key is joined per call, and nothing reads the log as state (today `gecko/lines.ts:40` does).
   - `log` is non-null only in the lab.
   - A new session is made after fonts load, or after a DPR or zoom change.
2. **Input.** Owned by the caller.
   - `Paragraph` without `width`. `lineHeight` leaves too; no engine reads it, only the painter.
   - `whiteSpace` is parsed once into its two longhands at the boundary. Today paint.ts and each engine interpret it again.
   - `LineBox = { width, left, right }` in CSS px.
3. **Prepared.** Lifetime of the paragraph on screen. It is immutable except for its facts.
   - It holds the content index, built once; today `paintLines` builds it again (`paint.ts:162`).
   - It holds the engine's items, styles and per-unit typed arrays, the text once, prepare-time widths with their conditions, and the fact tables.
   - It stores no `paragraph`, `env` or `engine` copies, and no gaps list.
4. **Decision.** One call.
   - It is the engine's own record of a filled line:
     - Blink `LineInfo`;
     - WebKit `Line` plus the builder result;
     - Gecko `LineLayout`.
   - It also holds the raw facts for gap checks.
   - `breakLine`, `layoutLine` and `inspectLine` each fill one and read it.
   - There is no "is it still valid" state.
5. **LineBreak.** Owned by the caller.
   - `{ kind: 'line', start, end, width, hasLineBox, next }` or `{ kind: 'below-floats', next }`.
   - `width` is the engine's alignment width in CSS px (DESIGN.md §2.6), which shrink-wrap needs.
6. **Line.** Owned by the caller.
   - `LineBreak` plus `fragments`, `joinsNextLine`, `indented` and `align`. It is engine-neutral.
   - `painted` stays on fragments, as one slice of the engine's content string made at describe time. It is not built by per-character concatenation.
7. **Inspected line and layout.** Lab, carets, selection.
   - These are today's `LineOf` and `ParagraphLayout` per engine.
   - The geometry types move out of `model.ts:279-490` into each engine's types, about 215 lines moved.
   - The observation contract types (`model.ts:553-600`) move to the lab.
8. **Painted DOM.** One element per line box, from `Line`, with a per-engine policy record in place of `paint.ts:93-108`, `:309-313` and `:420`.

## 4. Control flow

```
createSession(given)                       contexts on first use, store, env
prepare(session, paragraph)                index → styles → content → bidi → shaping units or items → break flags → prepare-time facts
firstLine(prepared)
fill(prepared, start, box) → Decision      the ported line breaker, unchanged rules; reads facts; records raw facts for gaps
  breakLine   = summarize(fill(...))       end, width, next
  layoutLine  = describe(fill(...))        + fragments, flags, align
  inspectLine = fill → edge gap checks → full geometry (clusters, characters, mapping) → materialize gaps, in today's order
paintLine(prepared, line, document)
```

Each engine directory:
- `index.ts`: the public functions;
- `types.ts`;
- `prepare/`;
- `facts.ts`;
- `fill.ts`;
- `describe.ts`: fragments, geometry, justification, alignment;
- `diagnose.ts`: gap checks that measure, and materializing condition codes into `Gap`;
- `data/`: this engine's generated tables only.

Shared code is imported by engines and never switches on one:
- content index;
- the session and `measure()`;
- the painter;
- rbbi, icu4x, ubidi, unicode-bidi, grapheme.

`bidiDataFor(engine)`, `graphemeRulesFor(engine)` and `breaks/tables.ts` become constants that each engine passes in.

Apple's category-override loop leaves the shared hot loop (`rbbi.ts:215-219`). WebKit applies it through its own category function.

## 5. API and engine interface

```ts
// pretext: engine-free, about 60 lines
detectEngine(): 'blink' | 'webkit' | 'gecko' | null
loadEngine(name): Promise<Pretext>          // the one switch: three dynamic imports, one bundle each

// every engine module exports the same names
createSession(given: GivenFacts): Session
prepare(session, paragraph): Prepared       // no width
firstLine(prepared): LineStart | null
breakLine(prepared, start, box: LineBox): LineBreak
countLines(prepared, width): { lines: number; widest: number }   // a loop over breakLine
layoutLine(prepared, start, box): Line
paintLine(prepared, line, document): HTMLElement
measureAhead(prepared): void                // optional: fills every fact now
// engine-true, with per-engine types
inspectLine(prepared, start, box, paragraphGaps): BlinkLine | WebKitLine | GeckoLine
inspectParagraph(prepared, boxes: LineBox[]): today's ParagraphLayout
paragraphGaps(prepared): Gap[]
```

**Why there is still a prepare step.** It is where width independence ends. That comes from the measurements above, not from main.

**How this differs from main**
- A session with an explicit lifetime.
- The line is the unit of layout, and the width is per line.
- There are three depths of answer.
- A prepared paragraph that keeps measuring after prepare, and says so.

**What goes away**
- `Prepared` and `LineStart` are opaque to apps. Only one engine is loaded, so the `engine` tags and the three `startMismatch` throws go (`index.ts:57-72`).
- The generic `EngineImplementation` object and the five switches in `index.ts` go.
- `UnportedFeature` is never thrown and goes.

**`inspectParagraph`.** It computes paragraph gaps once and passes them down, because Blink's `lineEdgeGaps` copies the overlapping ones into lines (`index.ts:289-296`).

**The lab.**
- It plugs in through `lab/predictor.ts` only, calling `inspectParagraph`.
- `recordedLayout()` (`lab/page.ts:389-395`) stays the adapter to the persisted row format. It adds the tags and the slot echo the library no longer stores.
- So the 153 GB of saved rows stay comparable byte for byte.

## 6. How the main uses are served

- **Virtual lists and chat.**
  - `prepare` once per message, `countLines` on a width change, and `layoutLine` for visible rows only.
  - `widest` gives shrink-wrap from the same walk.
  - No fragments, geometry or gaps are built for rows that aren't visible.
- **A width per line (editorial layouts).**
  - Pass `box.width` per line with zero insets. There are no float side effects then:
    - no below-floats refusals;
    - no switch of WebKit to LineBuilder through `hasFloats`;
    - no `impactedByFloats` in Gecko.
  - Insets stay for real floats, with each engine's own truncation (DESIGN.md §2.9).
- **Rich inline runs.**
  - The inline tree stays the input.
  - Apps that paint their own DOM read `line.fragments`: leaf index, source range, painted text, bidi level and box edges.
  - `paintLine` is optional.
- **Resize.** See §2.
- **Streaming.** Prepare again per append, with the store answering what didn't change. This needs Blink's pieces to be stable as the text grows (§9.2 B).

## 7. What is deleted

- **Shared:**
  - the memo as the read path;
  - the measure log as state, with its per-call objects;
  - the `measureContext` key join (`canvas.ts:44-46`);
  - the five switches in `index.ts`, with their three identical blocks;
  - `EngineImplementation`, `UnportedFeature`, `startMismatch`;
  - the `engine`, `env` and `paragraph` copies on `PreparedParagraph` and `ParagraphLayout`;
  - `LineOf.slot`;
  - `ProcessLanguages`, `env.pageLang` with its DOM read, and `env.contentLanguage`;
  - rbbi's rule-status diagnostics and header validation;
  - the unread `.brk` sections and the duplicated forward tables: about 90 KB for Blink and 150 KB for WebKit;
  - the second `indexContent` in `paintLines`.
- **Blink:**
  - eager creation of 5 contexts per style;
  - the `shapeResults` Map;
  - the ICU and grapheme flag arrays per line;
  - `scriptsPerUnit` run on every two-byte string and discarded when letter spacing is 0 (`shape.ts:307`, `:319`), which is 25 to 35% of JS time;
  - the second `pairAdjust16` at a cut (`shape.ts:513`);
  - `groupAround` and the `joinsNextLine` linear scans;
  - the O(G²) `addGap` that compares prose strings (`gaps.ts:9-24`);
  - the four arrays parallel to `styles`, merged into the style record;
  - dead `BlinkStyle` and `BlinkPrepared` fields;
  - `fontKey`, built with no separator (`content.ts:140`);
  - the `softHyphen` branches, which are always true;
  - the two hand-written default-ignorable lists, merged into one.
- **WebKit:**
  - `Object.values` per code point in `isDelimiterQuote` (`data.ts:115-120`), which is 55 to 62% of prepare JS;
  - the missing `break` in the last-line test (`lines.ts:1785`), which costs 39 of 42 ms on 6,000 words;
  - fresh break factories per boundary;
  - 12 gap-only fields on `WebKitBox`, which become locals of the diagnose step;
  - `LineRun` sentinels, replaced by a tagged union;
  - about 80 dead lines.
- **Gecko:**
  - `characters()` on the default path;
  - the second itemizer run, the second unit split and the second grapheme pass in prepare;
  - the 14 string rebuilds from `tUnits`, replaced by one transformed string that is sliced;
  - the mixed `elements` array and its 17 casts;
  - `GeckoStyle`'s five derived booleans;
  - `p.text.indexOf('\n')` scanning to the end of the text per reflow (`lines.ts:524`);
  - the likely-subtags trie, where 41 of 7,527 entries matter.
- **Bench.** `bench/page.ts` is rewritten against the new API. Today it doesn't compile: tsc errors at `page.ts:130-133` and `:181`.

## 8. Expected size and Canvas calls

**Lines.** The per-area estimates are the five readers' judgments. I added the fact tables, the three-depth split and the session, which net out close to zero.

| | Today | Target |
|---|---:|---:|
| Shared | 3,600 | about 3,050 |
| Blink | 5,055 | about 4,200 |
| WebKit | 4,913 | about 3,200 |
| Gecko | 4,331 | about 3,700 |
| Repo total | 17,899 | about 14,000 |
| Shipped per engine | everything, plus 1.5 MB of tables | 5,700 to 6,700, plus that engine's tables |

Tables shipped per engine:
- Blink: about 500 KB, from 586.
- WebKit: about 500 KB, from 644.
- Gecko: about 110 KB, from 246.

**Canvas calls, by engine**

- **Chrome.**
  - Latin corpus: 12,677 real today and 1,247 on main. The target is 0.34 calls per unit, or 0.17 with word pieces.
  - 200 chat messages: see the table in §0.
  - Per-line JS: about 205 µs memoized in the saved bench. The target is single-digit microseconds.
- **Firefox.**
  - Latin corpus: 5,190 today, with about 1,360 to 2,100 expected once `characters()` and the gap checks run on demand.
  - Chat: 16,287 today, falling to 716 with the break decision alone and the session store.
  - The 9,428-unit Chinese case takes 10,979 ms today and needs §9.2 A.
- **WebKit.**
  - Already below main: 1,200 against 4,374 on the corpus.
  - Chat in the saved bench: 4,777 today, 2,104 with a shared measurer, and 6,968 on main.
  - Line-time lookups go to zero outside `breakWord` and RTL trims.
  - Prepare JS falls from 219 to about 22 µs per 100 words once the quote lookup is fixed and the gap-only facts move to diagnose.

## 9. Risks to correctness and the gates

### 9.1 Structural rewrite: output must be identical

**Gates, from cheapest to most real**

1. **Offline differential.**
   - Run the old and new library on a deterministic stand-in Canvas over the lab's case files.
   - Compare the full `RecordedLayout` JSON, and the set of `(context settings, string)` each side measured.
   - It takes minutes in bun and needs no browser. `blink-table.ts` is the small version of it.
2. **Canvas record and replay.**
   - Rows drop the call log today (`lab/page.ts:389-395`; the charter lists this as still open).
   - Keep it in one run per browser.
   - Then replay the new code offline against each case's recorded `(context, string) → width`.
   - A string that isn't in the recording means the new code measured something the old code didn't.
   - The output must equal the saved row.
   - This gives real-font branch coverage without a browser in the loop.
3. **Citation check.**
   - Every one of the 768 distinct `file:line` citations in `src`, plus 74 WebKit shorthand ones, must appear in the new `src`, except those on a reviewed deleted list.
   - The source has no rule-id annotations. So the citations, and the 504 ids in `tests/rules.json` through the coverage test, are the checklist.
4. **Browser, predict-only.** `run.ts --predict-only --predictor=<new>`, with the layouts diffed byte for byte against saved rows.
5. **`lab/gate.ts`** with `--order=reverse` and `shuffle`, with zero lost passes. This is what catches order effects from contexts shared across paragraphs.

**Specific risks**

- **Shared contexts in Chrome.**
  - Chrome caches shaped words per canvas, and the first shaping wins.
  - The bench's shared-measurer run kept the same lines on four scripts. Gate 5 decides.
  - The lab keeps one session per case, or per page context.
- **A storage-class collision.**
  - The contexts are partitioned by the paragraph's storage class (`blink/index.ts:1191`).
  - But `canvasString` can build a one-byte string and a forced two-byte string with equal content inside one segmented paragraph (`shape.ts:279-284`).
  - A Map key, like Chrome's own cache key, cannot tell them apart.
  - The memo has this hazard today within one paragraph. A session store widens it across paragraphs.
  - Partitioning by the string's own `twoByte` flag removes it by construction, but it changes which canvas measures what, so it is gated (§9.2 D).
- **Gap order and placement.** Gate 1 compares the gap lists exactly. `inspectLine` keeps today's order.
- **Lazy ICU scan.**
  - The lazy scan keeps the restart at every line start with no prior context.
  - The dictionary segmenter must still see the text it sees today.
  - The existing oracle parity tests cover this.
- **Probe orders.** These stay exactly as they are:
  - `offsetForPosition`'s probe order (`shape.ts:647-658`);
  - WebKit `breakWord`'s probe sequence;
  - Gecko's linear scan, because advances need not be monotone;
  - Blink's View, Part and Segment bookkeeping (`shape.ts:780-825`).

### 9.2 Changes to what is measured

Each is its own branch and browser run, never folded into the rewrite.

**A. Gecko: windows inside long units.**
- *Why.* `W(unit) − W(suffix)` costs O(unit) characters per offset, and text without spaces is one unit.
- *Change.*
  - Cut a unit longer than 64 units at cluster starts where the clusters on both sides add up. That test is the recipe's own identity.
  - Verify that the windows add up to the unit in integer au.
  - Run the suffix recipe inside the window.
  - Units of 64 units or fewer are untouched by construction.
  - A unit whose windows don't add up keeps today's recipe.
- *Prototype* (`gecko-window-diff.ts`), on 9,000 units of Chinese:
  - 44.6M characters to Canvas fell to 0.34M, which is 131 times fewer;
  - calls rose 1%;
  - cold line filling for 3,000 units fell from 503 ms to 23 ms;
  - with the advance table, a warm pass takes 0.8 ms.
- *Result.* Lines, geometry and gap positions were identical at three widths under a stand-in that kerns a fifth of all pairs. The same held for Latin text with spaces removed under `overflow-wrap: anywhere`. Only the au numbers quoted inside gap details differ.
- *Risk.*
  - Gecko's Canvas returns integer au, so every decomposition at a cut where nothing interacts is exactly equal.
  - Real fonts with contextual shaping beyond pairs are the risk.
- *Gate.* All Firefox rows that hold a unit over 64 units.

**B. Blink: pieces that start and end beside every space that passes the safe test.**
- *Why.*
  - Halving shapes the text 12 to 16 times over. Its first call measures the whole group: the longest string on the corpus is 15,000 characters.
  - Its cuts move as the text grows, so nothing is reused across paragraphs or appends.
- *Change.*
  - Pieces become words and runs of spaces. The pair test at every cut is the one used today.
  - Pieces still 256 px or wider are halved as before.
  - Offline, the longest string on the corpus becomes 72 characters.
- *Result.* Geometry was identical on all 40 cases. 4 of 80 outputs differed, only in which lines report `joining-technology` at a span edge inside an Arabic word, because the first piece no longer starts at the group edge.
- *Risk.*
  - The "pair test passes, so the sides are independent" assumption is made at every space instead of once per 256 px.
  - The registry already lists cut placement as a heuristic (`blink/shape/wide-group-halved`).
  - A greedy forward cut at about 200 px is the smaller step if this one loses rows. It is stable under appends, but it gives no reuse across paragraphs.

**C. WebKit: the simplified-measuring check.**
- *Why.* It measures the whole rest of a split word on every line. For one 30,000-character word, that is 28.5M characters.
- *Change.* Moving it to inspect removes it from apps. Bounding it inside the lab needs a decision on the exact condition.

**D. Blink: partition contexts by the string's storage class.** See §9.1.

**One probe worth running later (unverified).**
- If the installed Chrome's `TextMetrics` exposes per-cluster positions, one call per piece would give Blink's position data directly.
- That would be a new recipe, so it is outside this plan.

## 10. Order of work

1. **Gates first.**
   - Keep the call log in rows.
   - Build the offline differential harness.
   - Write the citation check.
   - Rewrite the bench page against the new API.
2. **Shared layer.**
   - The session and `measure()`.
   - Per-engine entry modules and data.
   - Width as a line argument.
   - Geometry types moved into the engines; lab types moved to the lab.
   - Dead code out.
3. **One holistic rewrite per engine** along prepare, facts, fill, describe and diagnose.
   - WebKit goes first, because its measurement changes least.
   - Then Gecko, then Blink.
   - Each passes gates 1 to 5 before the next starts.
4. **Profile in browsers against main.** Decide the store's scope and cap from real Canvas-call and Map costs.
5. **The gated changes A to D,** each as its own branch and browser run.

## 11. Decisions for the maintainer

1. Fill in-word facts on first read, with an optional `measureAhead`, or fill everything in prepare. I recommend first read: filling everything costs 2.5 times the cold Canvas calls in Blink.
2. Whether the session width store is in the base design or added after profiling. It is one boolean either way. Without it, chat stays at 15,196 calls against 7,000.
3. Run experiment B early. It decides whether Chrome can reach main's call counts: 990 against 516 for words measured once each, from 46,198 today.
4. Adopt A after a Firefox run. Without it, the Chinese case stays quadratic and cannot be made even.
5. How to bound C inside the lab.
6. Whether app-level `Line` should expose any engine geometry. I left it out: apps want CSS px, and the painter reads none of it.
