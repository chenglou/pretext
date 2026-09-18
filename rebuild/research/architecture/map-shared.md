# Shared layer map: rebuild/src outside engines/<engine>/

Files read in full: `model.ts`, `env.ts`, `content.ts`, `index.ts`, `paint.ts`, `measure/{canvas,font,log}.ts`, `unicode/{bidi,grapheme,ubidi,unicode-bidi}.ts`, `breaks/{rbbi,icu4x,tables}.ts`, `engines/engine.ts`. For the generated modules I read the headers and export lists and measured the payloads.

I also read the three `engines/*/types.ts` and the engine call sites of every shared function, to see how the shared layer is used.

Numbers come from three sources:
- Code.
- `.artifacts/bench/smoke-20260917/*`. This is a background smoke run, labelled "harness validation only", at HEAD c51065a, 2026-09-17 06:07.
- The lab rows of `.artifacts/ceiling-20260917/evaluate-r2/<browser>/*-forward/`, streamed; no sealed folders were opened.

Small bun prototypes are in the scratchpad `arch-plan/`. "Unit" means a UTF-16 code unit.

## 0. Headline findings

### 0.1 The shared algorithms are fast; their call shape is what costs

I timed whole-paragraph passes over 15,000 units in bun, which runs JavaScriptCore, not V8:

| Pass | Time |
|---|---:|
| rbbi line scan | 0.16 ms |
| graphemes | 0.29 ms |
| ubidi | 0.2 ms |
| bidiClassOf × 15k | 0.11 ms |
| table decode and parse | 0.08 ms per table |

The shared API only offers whole-text, start-to-end functions: `ruleBoundaries` (rbbi.ts:281) and `graphemeBoundaries` (grapheme.ts:26).

Engines call them from each line start to the end of the text. Reproducing Blink's `icuFlags` shape (engines/blink/breaks.ts:134-168) took 12.0 ms for 15k units and 356 lines. A scan stopped two lines ahead took 0.16 ms. Both give the same boundaries, because `RuleBreakIterator.next()` is already incremental.

### 0.2 Canvas measurement is almost independent of width in all three engines

Latin corpus, 14,996 units. The "20 widths" column is 20 widths sharing one measurer.

| Browser | One width | 20 widths | Calls made in prepare |
|---|---:|---:|---:|
| Chrome | 12,677 calls | 12,677 (identical) | 2,624 |
| WebKit | 1,200 | 1,200 | 1,200 (all of them) |
| Firefox | 5,190 | 7,027 (about 97 new strings per extra width) | 1,182 |

Chrome's other 10,053 calls are a width-independent set, evaluated lazily at line time through the memo. The same exact equality holds for Chrome's Arabic corpus (14,655 for one width and for 20). The CJK paragraph shows 1,287 against 1,288.

### 0.3 The memo is used as data flow

Share of lookups answered by the memo, from the lab rows:

| Browser | Memo hit share | Lookups per unit | Real calls per unit |
|---|---:|---:|---:|
| Chrome | 84–90% | 8–25 | 0.75–3.0 |
| Firefox | 31–54% | | |
| WebKit | 48–72% | | |

The key is the constructed Canvas string (canvas.ts:75-78), so every hit first pays to build it. In Blink that is `canvasString`, shape.ts:241-285, which per lookup builds:
- two `number[]` arrays;
- an `Int32Array.from`;
- a `String.fromCharCode` spread.

The saved bench agrees. In Chrome each extra width costs 74 ms for the Latin corpus with zero new Canvas calls, about 5 µs per unit of pure JS. Arabic costs 423 ms, about 28 µs per unit.

### 0.4 The output model forces per-cluster and per-character geometry on every line

- `BlinkItem.clusters` (model.ts:305, 308) and `GeckoTextFrame.characters` (model.ts:453) are part of `LineOf.geometry`.
- Their only readers are `lab/observe/blink.ts` and `lab/observe/gecko.ts`.
- The painter reads none of it except Blink's `needsAccurateEndPosition` (paint.ts:51, 310).
- Computing them is the line-time Canvas work:
  - Blink calls `clustersOf` for every placed item (engines/blink/index.ts:593, :874, :883).
  - Gecko's `characters()` calls `glyphBefore` for every character of every frame (engines/gecko/lines.ts:917-926).

Gecko's recipe `W(unit) − W(suffix)` re-shapes a suffix per character. For text without spaces the unit is huge. The suite corpus case `c-a580f4ad18b9ea2c` has 9,428 units of Chinese and 319 lines:

| Browser | Predict time | Calls |
|---|---:|---:|
| Firefox | 10,979 ms | 27,059 |
| Chrome | 149.5 ms | 14,437 (plus 130,958 memo hits) |
| webkit-host | 12 ms | 1,582 |

### 0.5 The shared layer is 20% of the lines

It is 3,600 of 17,899 non-test lines. The ports are blink 5,055, webkit 4,913 and gecko 4,331.

## 1. Data structures by stage, lifetimes, width dependence

### Stage P: page lifetime, independent of paragraph and width

- **Base64 constants.**
  - `breaks/generated/*-break-tables.ts`, `unicode/generated/bidi-data.ts` and `engines/gecko/generated/*`.
  - Created at module load.
  - Every bundle imports all of them statically, through tables.ts:5-7, grapheme.ts:9-11 and bidi.ts:18.
- **Parsed tables**, kept in module-level memo slots:
  - tables.ts:12-17: `blinkRules{}`, `webkitRules{}`, `blinkPairs`, `webkitPairs`, `geckoLine`, `geckoGrapheme`.
  - bidi.ts:50-51: `unicode17Classes`, `libicucoreClasses`.
  - Created on first use and never dropped.
  - `BreakRules` (rbbi.ts:30-42) has 11 fields; outside rbbi.ts only `dictCategoriesStart` is read.
  - `Icu4xRuleData` (icu4x.ts:25-35) copies the 6 scalars of `Icu4xRuleDataSource` (icu4x.ts:10-23) next to the decoded arrays.
- **`BidiData { classes, brackets }`** (bidi.ts:25-29).
  - `bidiDataFor()` returns a new object literal on every call (bidi.ts:55-64).
  - Blink calls it per character: `isBidiWhiteSpace`, engines/blink/line-breaker.ts:1171-1173.

### Stage I: caller-owned input

- **`Paragraph = ParagraphOf<FontDecl>`** (model.ts:157-177).
  - The style is `TextStyleOf` (:91-101).
  - The `content` tree is `InlineNodeOf` (:153).
  - Further fields: `lang`, `direction`, `width` (:164), `lineHeight` (:166), `textIndent`, `textAlign`.
- **`FontDecl = CssFont & { facts }`** (:15-67).
- **Width dependence is mixed inside this one record.**
  - `width` is read only at line time, at five sites: blink/line-breaker.ts:145, blink/index.ts:1228, webkit/lines.ts:2345 and :2692, gecko/lines.ts:658.
  - `lineHeight` and `AtomicInline.height` are read by no engine, only by paint.ts.
  - Everything else is read in prepare.
  - Because `width` sits inside what is prepared, a new width means a new `Paragraph` and a full prepare through the public API. `layoutLine` takes only slot insets (index.ts:63).
- **`Environment`** (env.ts:50-91).
  - Built once by `detectEnvironment` (env.ts:117-153), and independent of width.
  - Fields the engines read (grep over `engines/`):
    - `devicePixelRatio` (all three);
    - `dictionaryBreaks` (all three);
    - `uiLanguage` (Blink);
    - `pageZoom`, `preferredLanguages`, `icuDefaultLocale` (WebKit);
    - `regionalPrefsLocale` (Gecko).
  - Fields no engine reads:
    - `pageLang` (env.ts:58/74/85) is read from the DOM at :123.
    - `contentLanguage` (:61/75/86). engines/blink/content.ts:103 says it "never reaches a locale here".
    - `build` is read only by index.ts `buildGaps`.

### Stage R: prepare, created by `prepareParagraph` (index.ts:39-46), independent of width

- **`Measurer { log, keys, contexts, memo }`** (canvas.ts:32-37).
  - Created per paragraph (index.ts:40). It holds the OffscreenCanvas contexts.
  - It is mutable and grows on every `layoutLine`: memo entries, and one log object per real Canvas call that keeps the measured string.
  - It is dropped with the `PreparedParagraph`. In `layoutParagraph` the log escapes as `ParagraphLayout.measure` (index.ts:95/99/103).
  - engine.ts:15-16 says "the prepared paragraph never changes". That is true of `state` and false of the measurer beside it.
- **`ContentIndex { text, leaves, elements, events }`** (content.ts:33-39).
  - Built by each engine's prepare: blink/index.ts:1154, webkit/content.ts:679, gecko/prepare.ts:616. `paintLines` builds it again (paint.ts:162).
  - Only `BlinkPrepared.index` keeps it (blink/types.ts:123).
  - WebKit copies it into `runStarts` and `runTexts`. Gecko copies it into `text`, `runStarts`, `runParents`, `runLangs` and `runStyles`.
- **Engine `Prepared` state** (`engines/*/types.ts`): items, styles, boxes or text runs, and per-unit typed arrays.
  - Every one of them also stores `paragraph` and `env`.
  - `PreparedParagraph` stores the same two again, plus an `engine` tag that duplicates `env.engine` (index.ts:34-37).
- **Paragraph gaps**: `prepared.gaps`.
  - `paragraphGaps()` concatenates them with `buildGaps(env)` on each call (index.ts:78-84, 109-114).

### Stage L: per line, created by `nextLine`, depends on width and slot

- **`LineStart`** (model.ts:234; `engines/*/types.ts`).
  - A small record with an engine tag.
  - Blink has 6 fields.
  - WebKit carries the `previousLine.carriedWidth` remainder.
  - Gecko has 3 fields.
- **`LineSlot { left, right }`** (:186).
  - Given by the caller.
  - It is a pair of insets, not a width, because each engine truncates the content width and the insets separately (DESIGN §2.9).
- **`LineResultOf`** (:275-277): `line` or `below-floats`.
  - The optional `next?: Start` is supplied only by WebKit and consumed at index.ts:129.
- **`LineOf`** (:236-265). Everything in it is allocated for every line, whatever the caller wants.
  - `start`, `end`.
  - `fragments: Fragment[]`. The `text`, `trimmed`, `hanging` and `hyphen` kinds carry `painted: string` (:205, 210, 215, 218).
  - `hasLineBox`, `joinsNextLine`, `slot`, `indented`, `align`.
  - `geometry`: Blink `mapping`, `items` and `clusters`; WebKit `boxes`; Gecko `frames` and `characters`.
  - `gaps`, `next`.
- **Readers:**
  - paint.ts reads `fragments`, the five flags and Blink's `needsAccurateEndPosition`.
  - `lab/observe/*` reads `fragments` and `geometry`.
  - `lab/score.ts` reads `geometry`.
  - Nothing else reads `clusters`, `characters` or `mapping`.

### Stage A: the aggregate

- **`ParagraphLayout`** (:544-547).
  - A 3-way union with the same shape in each arm.
  - Its `engine` tag duplicates `env.engine`.
  - Built by three copies of the same block in index.ts:93-104.

### Stage D: paint

- **`paintLines`** (paint.ts:161-489).
  - Re-indexes the content.
  - Per line it builds 2 Sets (:245-246), about 9 closures (:324-405), regex tests on `painted`, and DOM nodes.
  - Nothing is retained.

### Lab-only types in model.ts

- **Lines 553-600**: `Expected`, `ExpectedRect`, `UnobservableFact`, `ExpectedObservation`, `CanvasMeasure`, `ObservationPort`.
  - No src module uses them; they are there because the lab may import only model.ts.

## 2. Canvas measurement flow, as the shared layer sees it

### Contexts

- A context is one `OffscreenCanvas(1,1)` per distinct `CanvasSettings` (canvas.ts:15-27, 43-65).
- The lookup key is the 8 settings joined with spaces (:44-45). `ctx.lang` is set before `ctx.font` (:50-52; Blink resolves the font under the lang).
- The measurer is per paragraph, so every paragraph builds its contexts again.
- Contexts created per paragraph:

| Browser | Contexts created |
|---|---|
| Chrome | 4: `styleContexts` makes ltr, rtl, ltrNoLigatures, rtlNoLigatures and hyphen eagerly for every style (blink/shape.ts:81-89); hyphen equals ltr when the spacing is 0. Rows: mean 4.1–4.3, p95 5, max 36 in the `runs` family. |
| Firefox | Rows: mean 1.3–3.2, max 25. |
| WebKit | `context`, `plainContext` and `spacedContext`, plus 2 coverage contexts for fixed-pitch boxes (webkit/content.ts:251-266). Rows: mean 1.1–1.5. |

- Bench `many/latin`, 200 messages:

| Browser | Contexts, a fresh measurer per paragraph | Contexts, one shared measurer |
|---|---:|---:|
| Chrome | 400 | 4 |
| Firefox | 318 | 3 |
| WebKit | 200 | 1 |

### Context settings per engine (DESIGN §4.2)

- **Blink:**
  - the font at the zoomed size, or the CSS size for fonts with an optical size axis, with a JS scale;
  - `lang` is the style locale;
  - `letterSpacing` is the run's, or 1/64 px for the no-ligature contexts;
  - `wordSpacing` is 0; JS adds it;
  - `textRendering` is `optimizeLegibility`;
  - direction per item;
  - `partition` is `'8bit'` or `'16bit'`.
- **WebKit:**
  - size × pageZoom;
  - `lang` is `''`;
  - letter spacing on the context;
  - word spacing on `spacedContext`;
  - always ltr.
- **Gecko:**
  - the CSS size behind a quantization gate;
  - `lang` is the run's;
  - `letterSpacing` is `'0.001px'` (ligatures off) or `'0px'`;
  - word spacing in JS;
  - direction per bidi run.

### Which strings, at which stage

From the call sites plus DESIGN §4.5:

- **Blink, in prepare:**
  - shaping-group words and pieces (`measure16`, shape.ts:289);
  - HanKerning glyph bounds per candidate character (hankerning.ts:66, `measureTextBounds`, not memoized).
- **Blink, in nextLine:**
  - line-start and line-end reshapes, the hyphen, tabs;
  - prefix widths at every cluster boundary of every placed item, and pair windows, for output geometry and gaps (index.ts:593-610).
- **WebKit, in prepare:**
  - word pieces with their following space;
  - `' '`;
  - coverage probes.
- **WebKit, in nextLine:**
  - `breakWord` prefix bisection (measure.ts:75-130);
  - widths deferred by bidi splits;
  - preserved white space with TAB;
  - the hyphen;
  - a per-unit sum check (lines.ts:2507-2510).
- **Gecko, in prepare:**
  - every shaping unit;
  - the space;
  - emoji and device-size contexts.
- **Gecko, in nextLine:**
  - the hyphen run and tab stops;
  - `W(unit) − W(suffix)` at each consulted offset;
  - the same `W(unit) − W(suffix)` for every character of every placed frame (lines.ts:917-926);
  - ligature probes in a second `0.001px` context (lines.ts:39-59).

### Where the same or overlapping text is measured more than once

The memo hit share counts identical repeats: the same context and the same string asked again.

| Row set | Chrome lookups and calls per unit | Hits | Firefox | webkit-host |
|---|---|---:|---|---|
| families (10,816 rows) | 20.5 / 2.40 | 88.3% | 2.56 / 1.18, 54% | 1.13 / 0.48, 57% |
| suite-sample (19,554 rows, 830k units) | 13.1 / 2.03 | 84.5% | 3.20 / 1.52, 53% | 0.92 / 0.36, 60% |
| runs (2,580 rows) | 11.3 / 2.57 | 77% | 3.65 / 1.77, 51% | 1.17 / 0.60, 49% |
| features (12,882 rows) | 13.1 / 1.93 | 85% | 1.42 / 0.97, 32% | 1.61 / 0.45, 72% |
| policy (1,606 rows) | 21.3 / 2.68 | 87.5% | 5.00 / 2.29, 54% | 1.36 / 0.56, 59% |

- In Blink the engine asks for each distinct string 5 to 9 times.
- **Overlapping strings** are distinct strings covering the same text.
  - Rows keep counts only, so string lengths can't be read back.
  - Real calls per unit (0.75–3 in Chrome, 0.66–2.3 in Firefox) say each character sits in two or more distinct measured strings for short texts.
  - In Gecko the suffix recipe makes the overlap quadratic inside one unit: about k²/2 units shaped for a unit of k clusters.

### Scaling, from rows bucketed by text length (suite-sample and triage-long, forward)

| Units | Chrome µs per unit | Chrome lookups per unit | Firefox µs per unit | webkit-host µs per unit |
|---|---:|---:|---:|---:|
| under 32 | 23.9 | 25.0 | 8.9 | 5.7 |
| 32–128 | 9.6 | 11.3 | 3.6 | 2.3 |
| 128–512 | 7.2 | 13.2 | 2.8 | 1.4 |
| 512–2,048 | 9.2 | 8.2 | 5.0 | 1.9 |
| 2,048–8,192 | 9.5 | 11.2 | 5.1 | 1.3 |
| 8,192 and up | 17.3 (max 663 ms) | 10.7 | 103.5 (max 10,979 ms) | 1.7 (max 43 ms) |

- The fixed cost per paragraph shows in the under-32 bucket. Chrome takes about 165 µs for a 7-unit paragraph.
- Bench `cold/latin/tiny`: 164 µs and 42 Canvas calls for 16 units and 1 line, against 39 µs and 17 calls on main.
  - Of that, prepare is 31 µs and 1 call.
  - The first line is the rest: geometry calls, plus 4 new canvases.

### Against main, bench `many` (200 chat messages, 28,438 units)

| Browser | Rebuild: calls, time | Main: calls, time | One shared measurer |
|---|---|---|---|
| Chrome | 47,455 calls, 217 ms | 2,043 calls, 12.9 ms | 24,171 calls, 207 ms |
| Firefox | 22,010 calls, 37.3 ms | 2,043 calls, 11.4 ms | 8,807 calls, 28.4 ms |
| WebKit | 4,777 calls, 11.6 ms | 6,968 calls, 9.5 ms | 2,104 calls, 10.8 ms |

- Main's advantage is its word cache shared across texts.
- Sharing one measurer halves Chrome's calls, and the time drops only 5%. Blink's cost is JS, not Canvas.
- Latin corpus:

| Browser | Rebuild | Main |
|---|---:|---:|
| Chrome | 12,677 calls | 1,247 |
| Firefox | 5,190 | 1,247 |
| WebKit | 1,200 | 4,374 |

### The log

- `m.log.calls.push({ context, text, width })` runs on every real call (canvas.ts:71, 84).
- Its readers:
  - `lab/page.ts:498` reads the three lengths.
  - bench reads the lengths.
  - Three Gecko test assertions read it.
- One engine function reads it as state. engines/gecko/lines.ts:40 does `m.log.contexts[run.context]` to recover a context's settings, because the measurer keeps settings nowhere else.

## 3. Repeated or wasted work in the shared layer, with complexity

n is units, L is lines, P is paragraphs, S is styles.

1. **Measurer per paragraph.**
   - O(P·S) canvas creations and font-string parses.
   - Nothing carries across paragraphs.
   - 400 canvases and 47k calls for 200 messages in Chrome.
2. **Text-keyed memo.**
   - O(lookups), each needing the string built and hashed.
   - 8–25 lookups per unit in Blink.
3. **Log.**
   - O(calls) objects.
   - Every measured string is retained twice, as a memo key and as a log entry, for the life of a kept `PreparedParagraph`.
   - It grows with each relayout.
4. **`ruleBoundaries` and `graphemeBoundaries` work over the whole text only.**
   - Callers slice from a start to the end.
   - blink/breaks.ts:138-142 also allocates `new Uint8Array(text.length + 1)` per line start (:139, :205), which is O(n·L).
   - webkit/measure.ts:254 computes the graphemes of a whole box per query.
   - `graphemeBoundaries` builds a new `RuleBreakIterator`, with two Int32Arrays, per call, and copies `{offset, dictionarySegment}` objects into a `number[]` (grapheme.ts:29-32).
5. **`bidiClassOf`** is a binary search over 763 ranges per code point (bidi.ts:67-78). `bidiDataFor` allocates per call.
6. **Bracket lookups** scan 64 triples linearly per ON character (ubidi.ts:326-330, unicode-bidi.ts:390-398). This matters only in mixed-direction text.
7. **icu4x.ts:119** calls `breakState` and `icu4xProperty` twice with the same arguments.
8. **`indexContent` runs twice per painted paragraph.** It re-concatenates all the text (content.ts:64). Each engine re-derives parent, start and lang arrays from it.
9. **`fillLines` always materializes fragments, painted strings, geometry and gaps.**
   - O(n) allocations, and the geometry Canvas calls.
   - The caller may want only a line count or a height: virtualized lists, chat.
   - There is no cheaper path.
10. **Generated data.**
    - A bundle for any engine carries all 1.27 MB: blink 586 KB, webkit 644 KB, gecko 41 KB.
    - Base64 adds 33%.
    - About 10% of every `.brk` is never read: the reverse table, the rule source and the DataHeader. That is 40.9 KB of Blink's 391 KB and 47.6 KB of WebKit's 465 KB.
    - Forward tables are duplicated byte for byte:
      - Blink `line` and `line_normal` are the same 49,664 B.
      - WebKit `line`, `line_normal` and `line_cj` are the same 49,664 B.
      - The `char` forward table is identical across the two engines.
11. **`paintLines`, per line:**
    - 2 Sets and about 9 closures.
    - `SPACES_AND_TABS.test(fragment.painted)` per trailing fragment (:230).
    - `ASCII_SPACE_ONLY.test(firstRunText)` on a string concatenated for that purpose (:259, :287).

## 4. Engine, direction and mode knowledge woven through shared code

### Engine knowledge

- **index.ts** header says "the engine difference is this one switch". There are five 3-way switches (:41, :50, :64, :79, :92), plus the `PINNED_BUILDS[env.engine]` lookup.
  - Static imports of all three engines (:3-9) mean nothing is ever left out of a bundle.
- **model.ts** imports each engine's `LineStart` (:5-7), and the engines' types import model.ts back. It defines all three engines' geometry (:279-490, about 215 lines).
  - `joinsNextLine` is "always false in WebKit".
  - `LineResultOf.next?` exists for WebKit.
  - Font facts are read by subsets:
    - `monospace`: WebKit;
    - `joining`: Blink;
    - `pairKerning`: Blink and Gecko;
    - `mapsHyphen`: Blink and WebKit;
    - `opticalSizeAxis`: Blink and Gecko.
- **paint.ts:**
  - `hyphenSpan` switches on the engine (:93-108).
  - The soft-wrap rule switches on the engine (:309-313).
  - `layout.engine === 'blink' && fragment.kind === 'hanging'` (:420).
  - `PaintableLayout` special-cases Blink's geometry (:50-53).
- **measure/canvas.ts:**
  - `partition` exists for Blink's 8-bit and 16-bit words.
  - `measureTextBounds` was added for Blink's HanKerning and is now also used by Gecko.
- **unicode/bidi.ts** has `bidiDataFor(engine)`.
- **unicode/grapheme.ts** has `graphemeRulesFor(engine)` and a `GraphemeRules` union over two algorithms.
- **breaks/tables.ts** has six memo slots, one per table. Each of these imports every engine's data.
- **breaks/rbbi.ts**: `CategoryOverrides` exists for Apple ICU. Blink always passes `NO_OVERRIDES`. The override loop sits in the per-character hot loop (:215-219).
- **`breaks/generated/`** holds engine-only data that is not break data.
  - Blink: `blinkCharProps`, `blinkScriptProps`, `blinkScriptExtensions`, `blinkHanKerningTypes`, `blinkCursiveScripts`, `blinkCjkIdeographOrSymbolRanges`.
    - Read only by engines/blink/props.ts.
  - WebKit: `webkitDelimiters`, `webkitLineTables`, `webkitScriptNames`, `webkitLocaleScripts`, the punctuation ranges and the dictionary ranges.
    - Read only by engines/webkit/data.ts.
  - Gecko's equivalents live under `engines/gecko/generated/`.
- **env.ts** has three near-identical environment records, with `build`, `devicePixelRatio`, `pageLang`, `contentLanguage` and `dictionaryBreaks` copied three times. `GivenFacts` repeats them again (:94-97).

### Mode

- `whiteSpace` is the legacy 6-value shorthand (model.ts:69). Every consumer interprets it again:
  - paint.ts `wraps()` (:157-159) and `collapses` (:164);
  - `WebKitStyle.collapse` and `wrap`;
  - `GeckoStyle.collapse` and `wrap`, plus five derived booleans stored as fields (gecko/types.ts:9-15);
  - Blink `IteratorSettings.autoWrap`.
- CSS itself models this as two longhands, and the input could too.
- `wordBreak: 'break-word'` is likewise re-read per engine as normal plus `overflow-wrap: anywhere`.

### Direction

- paint.ts: `base = direction === 'rtl' ? 1 : 0` (:163).
- The painter recovers "is white space" and bidi grouping from `painted` strings and levels instead of from fragment kinds.

## 5. Guide violations worth fixing, shared layer only

### Caches and memo maps

- `Measurer.memo: Map<string, number>[]` (canvas.ts:36, 76-83).
- `Measurer.keys: Map<string, number>`, with a composite key built by joining 8 strings per `measureContext` call (:44-46).
- Six module-level memo slots in tables.ts and two in bidi.ts. These have stable identity and bounded size, which the guide allows. They exist only because one module serves three engines.
- `measureTextBounds` is not memoized, so engines added their own: gecko/lines.ts:49-59 has `WeakMap<Measurer, Map<string, boolean>>` with `${run.context} ${pair}` keys.

### Map or Set where an array or record fits

- `startEdges` and `endEdges` are `Set<number>` per line (paint.ts:245-246). Elements are dense indices, so a Uint8Array per paragraph would do.
- `keys` should be a small array of records, since there are 5 or fewer contexts per style.

### Derived data stored as fields, and copies

- Tags repeat the same fact:
  - `PreparedParagraph.engine`, `env` and `paragraph` duplicate `state.env` and `state.paragraph` (index.ts:34-37).
  - `ParagraphLayout.engine` duplicates `env.engine`.
  - `LineStart.engine`.
- `Icu4xRuleData` copies `Icu4xRuleDataSource`.
- `IndexedElement.open` and `close` are "one event, twice" for atomic, br and wbr (content.ts:28-30).
- `Fragment.painted` holds a copied string per fragment per line, where a view into the engine's content would do. It is sliced only at paint time.
- `Gap.detail` holds prose strings on every gap.
- The log doubles as the store of context settings.

### Optional fields over well-typed data

- `LineResultOf['below-floats'].next?` (model.ts:277).
- `Gap.at?` (:536).
- `layoutParagraph(…, slots = [])`.
- There are no `?.` chains in the shared layer.
- The `??` uses are the lazy table slots, and `breakState`'s `?? KEEP` (icu4x.ts:93), which ports a cited fallback.

### Defensive checks

- `startMismatch` throws (index.ts:66-72). The `LineStart` union lets a caller pass another engine's start, because one module serves three engines.
- `styleUnder` throws on a parent that is not a span (content.ts:90). `elements` mixes spans with nodes that can never be parents.
- Painter throws at :345, :357 and :430 re-check the index.
- rbbi.ts:57-91 validates headers of data that the generator already checked by sha256.

### if/else chains over unions

- paint.ts:
  - :228-230 is a 9-way `||` over `fragment.kind`.
  - :303-306.
  - :370-371 handles `open` and `close` and silently skips the other event kinds.
- env.ts:110-114 is a UA regex chain. That is fine at a boundary.
- unicode-bidi.ts:105-117, :140-192 and :288-298, and ubidi.ts:378-409, are class chains in ported code. They follow the source's structure.

### Repeated string parsing

- Regex tests on `painted` (paint.ts:45-46, :230, :287). The engine knew the content was white space.
- The `whiteSpace` shorthand, above.
- Canvas font strings are rebuilt by `canvasFont` at each call site (font.ts:11-13), for example gecko/prepare.ts:1253, which compares `settings.font === canvasFont(…)`.

### Iterator chains

- None in the shared layer.
- The one `.some` is paint.ts:202.
- `String.fromCharCode(...spread)` is engine code.

### Exceptions as control flow

- None in the shared layer.
- `UnportedFeature` (engine.ts:22-35, exported at index.ts:29) is never thrown anywhere in `src` and never referenced in the lab. It is dead.

### Dead code and unread data

- `ProcessLanguages` union (env.ts:45-48). The lab has its own type of that name.
- `env.pageLang` and its DOM read; `env.contentLanguage`.
- In rbbi:
  - `ruleStatus()`, `ruleStatusIndex`, `statusTable`;
  - `staleLookAheadReads`, `lookAheadCall`, `call` (rbbi.ts:147-152, 169-173, 187, 235, 245);
  - `catCount`, `flags`, `lookAheadResultsSize` as public fields.
- In every `.brk`: the reverse table, the rule source and the DataHeader.
- In ubidi, `Ubidi.multiRuns` and the paragraphs are real. Nothing is dead there.

### Glue left from migrations and stale docs

- DESIGN.md:9-11 and :1445-1446 say the engines fail `tsc`. `bunx tsc --noEmit -p rebuild/tsconfig.json` passes.
- `bench/page.ts` still builds `runs:` paragraphs and calls `nextLine(prepared, start, width)`. It fails `tsc` at :130-133 and :181.
- The lab's flat-run cases are converted to trees per prediction (lab/predictor.ts:80-103).
- engine.ts:22-24 describes stage 5 as in the future.
- `ParagraphOf<Font>` is generic. The library instantiates one type, and the lab instantiates the other (lab/types.ts:18-20).

## 6. Line counts and a from-scratch estimate for the same behaviour

| File | Lines now | Code / comment | Estimate | Notes |
|---|---:|---:|---:|---|
| model.ts | 600 | 263 / 285 | 320 shared, plus about 215 moved into engine types and 48 moved to the lab | The citations stay. The geometry belongs to each engine. |
| env.ts | 153 | 97 / 41 | 100 | One environment record per engine entry. Drop the dead fields and the dead union. |
| content.ts | 101 | 80 / 14 | 70 | |
| index.ts | 138 | 115 / 13 | about 40 per engine entry | With an entry module per engine, the 5 switches and the 3× repeated block go. |
| engines/engine.ts | 35 | 19 / 13 | 12 | Drop `UnportedFeature`. |
| paint.ts | 489 | 365 / 109 | 400 | Dense rule code. Closures become one state record. Sets become flag arrays. Fragment kinds replace the regexes. |
| measure/* | 110 | 71 / 29 | 60 | Contexts as records owned by styles. The log as an optional hook. No text-keyed memo once engines store the widths they measure. |
| unicode/ubidi.ts | 844 | 727 / 80 | 800 | A cited port, tested against ICU over 1.3M cases. Leave it. |
| unicode/unicode-bidi.ts | 509 | 450 / 36 | 490 | The same. |
| unicode/bidi.ts + grapheme.ts | 115 | 77 / 27 | 60 | Per-engine constants. A BMP class table (Uint8Array) instead of binary search. |
| breaks/rbbi.ts | 288 | 223 / 37 | 200 | The generator emits only the sections that are read. A plain next-boundary function plus a state record. Drop the diagnostics. |
| breaks/icu4x.ts | 166 | 136 / 20 | 140 | |
| breaks/tables.ts | 52 | 35 / 8 | 0–15 | A per-engine data module. |
| **Total** | **3,600** | 2,658 / 750 | **about 3,050 in the repo**, of which a Blink or WebKit bundle takes about 2,450 and a Gecko bundle about 1,950 | |

- Generated data per shipped engine:

| Engine | Size today |
|---|---|
| Blink | 586 KB |
| WebKit | 644 KB |
| Gecko | 41 KB, plus 205 KB under `engines/gecko/generated` |

- Every engine's bundle also carries the 14 KB of bidi data, where one class table is needed.
- Dropping the unread sections saves about 10%.
- De-duplicating the identical forward tables saves about 50 KB for Blink and 99 KB for WebKit.
- The 722 lines of shared tests are parity tests against oracles and stay.
- The shared layer is 20% of the lines. The other 80%, 14,299 lines, is in the three ports.

## 7. Constraints a redesign must keep, as found in the shared layer

1. **String storage is an input to Blink's Canvas.**
   - An 8-bit V8 string is shaped as one Latin segment. A 16-bit string goes through RunSegmenter.
   - The Blink port builds every Canvas string from code arrays and forces two-byte storage with `('Ā' + s).slice(1)` or a U+2060 prefix (blink/shape.ts:207-285).
   - The guide's "store views, slice at measure time" would change storage class and therefore results.
   - Keys for stored widths can still be integer ranges into the text content: `(context, from, to, flags)`. A hit then builds no string.
2. **Context identity.**
   - Chrome caches shaped words per canvas, and the first shaping wins.
   - DESIGN §5 lists "partitions, JS word spacing, a fresh measurer per prepared paragraph" as the handling.
   - The bench's shared-measurer experiment matched `layoutParagraph`'s lines on its texts.
   - Sharing contexts across paragraphs needs a probe, or the gate, before it lands.
   - DESIGN §4.5 also says engines measure when the engine does "because Chrome's cache makes order visible". So moving Blink's lazy line-time calls into prepare is a change of order to validate, even though the set of strings is the same.
3. **`ctx.lang` is explicit and set before `ctx.font`** (canvas.ts:50-52).
4. **Break opportunities in Blink depend on the line start.**
   - ICU restarts at every line start with no prior context.
   - WebKit gives it up to 2 units of prior context, per item.
   - A lazy `next()` from the line start keeps this exactly.
5. **The gaps reported while computing clusters** (blink/index.ts:602, `glyph-clusters`) are part of `line.gaps`.
   - If per-cluster geometry becomes an on-demand function for the observation ports, those gap reports move with it.
   - Gecko's `characters()` passes `gaps: null`.
6. **`LineSlot` stays a pair of insets per engine,** because each engine truncates the content width and the insets separately.
   - A resize API needs the content width as a line-time argument next to the slot. It must not be a fake right inset.
   - A slot with insets marks Gecko's band as impacted by floats, and makes WebKit's content ineligible for the simple builders.
