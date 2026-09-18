# Blink port map (rebuild/src/engines/blink, lab/observe/blink.ts), read against specs/blink*.md

Paths are relative to ~/github/pretext-rebuild/rebuild unless absolute.

Offline timings use a stand-in Canvas in bun, so they show JS overhead only. Real Canvas shaping cost comes on top. The scratch scripts are `blink-rows.ts`, `blink-attrib.ts`, `blink-ablate/blink-time.ts`, `blink-ablate/blink-count*.ts` and `blink-ablate/blink-prep.ts`, under `<scratch>/arch-plan/`.

## 0. Numbers first

### Saved lab rows

Source: `.artifacts/lab/blink/r2-e/*-forward/chrome-rows.ndjson`, Chrome 153, DPR 2. Each row carries `prediction.measure {contexts, calls, memoHits}` and `timings.predictMs`.

| Sample | Rows | Units | Lines | Canvas calls | per unit | per line | Memo hits | per unit | Lookups per line | predictMs per line | Contexts per row |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| suite-sample part0+1 | 10,000 | 510,199 | 30,760 | 1,184,545 | 2.32 | 38.5 | 4,983,114 | 9.77 | 200 | 0.169 | 4.0 |
| rule families | 23,858 | 464,228 | 80,799 | 979,879 | 2.11 | 12.1 | 6,390,080 | 13.76 | 91 | 0.054 | 4.2 |
| runs | 2,580 | 142,080 | 11,373 | 365,416 | 2.57 | 32.1 | 1,239,578 | 8.72 | 141 | 0.187 | 14.1 |
| policy | 1,606 | 59,226 | 7,823 | 158,567 | 2.68 | 20.3 | 1,104,969 | 18.66 | 161 | 0.100 | 4.1 |
| ws | 1,019 | 32,574 | 3,691 | 88,868 | 2.73 | 24.1 | 400,808 | 12.30 | 133 | 0.098 | 9.4 |

- Between 77% and 87% of all measurement requests repeat a string already measured in the same layout.
- Main makes about 0.2 Canvas calls per unit (118 calls for 592 units in the bench).

### Bench

Source: `.artifacts/bench/smoke-20260917/summary.md`. It is a background smoke run at commit c51065a, so treat it as indicative.

- Blink is the slow engine.
  - cold/latin/paragraph: ×13.6 against main.
  - cold/latin/corpus: ×21.
  - sweep/latin/paragraph, prepare once plus 20 widths: ×143.
  - sweep/arabic/corpus: ×1,420.
- On webkit-host the same rows are ×0.5 to ×2.
- `rebuild internal prepare` for the 592-unit Latin paragraph takes 1.51 ms. Prepare plus 20 widths takes 61.6 ms, so each extra width costs about 3 ms while the log records almost no new Canvas calls.
- `bench/page.ts:130` still passes a number as the slot. The file predates the slot API (e446bf6). It must be fixed before any re-run, because it would now lay out every width at `paragraph.width`.

### Offline counts

Input: 600-unit Latin paragraph, width 320, DPR 2, 16 lines, one shaping group, 56 pieces.

| What | Canvas calls | Memo hits | canvasString builds | Distinct prefix offsets | JS time |
|---|---:|---:|---:|---:|---:|
| prepare | 190 | 436 | – | – | 1.1 ms |
| lines, full output (cold / warm) | 594 | 6,357 | – | – | 2.77 / 2.60 ms |
| one whole layout | 784 (1.31 per unit; 7,158 chars shaped, 11.9× the text) | 6,793 | 9,375 | 601 of 600 | – |
| lines, without `clustersOf` | 259 | 1,608 | – | – | 0.73 ms |
| lines, without `clustersOf` and `lineEdgeGaps` | 141 | 896 | – | – | 0.48 ms |
| the two above plus skipping `scriptsPerUnit` when letterSpacing is 0 | 141 | 896 | – | – | 0.35 ms |
| break decision only, whole layout | 331 | 1,332 | 3,461 | 133 of 600 | – |
| 20-width sweep, one measurer, full output | 899 total | 147,041 | 183,900 | 601 | – |
| 20-width sweep, one measurer, break decision only | 638 | 31,444 | 68,042 | 523 of 600 | – |

Skipping `scriptsPerUnit` when letterSpacing is 0 removes 25–35% of JS time in every configuration.

Lookup share in the line phase, counted from stack attribution:

| Function | Lookups per pass | Share |
|---|---:|---:|
| `clustersOf` | about 4,950 | about 73% |
| `offsetForPosition` | about 780 | about 11% |
| `lineEdgeGaps` plus `edgeGap` | about 830 | about 12% |
| `makeView` | about 140 | – |
| `positionForOffset` | about 75 | – |
| safe-offset scans | about 45 | – |

- All 190 Canvas calls in prepare come from `addCuts` and its safe tests, which shape 4,177 chars, 7× the text.
- Prepare JS time splits as follows.
  - Content, bidi, scripts, graphemes and contexts: 5–10%.
  - `measureGroups`: about 60%.
  - `prepareGaps`/`contentGaps`: 30–35%. These make no Canvas calls; they only build strings and scan scripts.
- CJK, 600 units, 30 lines: the ICU state machine ran 29 whole-remainder scans per pass, over 9,280 units (15× the text).

## 1. Data structures by stage and lifetime

### Input

- `Paragraph` is an inline tree. It also holds `width`, `textIndent`, `textAlign`, `direction`, `lang` and `whiteSpace`.
- `BlinkEnvironment` holds `devicePixelRatio`, `uiLanguage` and `dictionaryBreaks`.
- `Measurer` (`src/measure/canvas.ts:32-41`) is created per `prepareParagraph`/`layoutParagraph` and shared by that paragraph's lines. It holds:
  - `contexts[]`, the OffscreenCanvas 2d contexts;
  - `keys`, a Map from a joined settings string to the context index;
  - `memo`, a `Map<string, number>` per context keyed by the full measured string;
  - `log`, which records every settings object and every `{context, text, width}` call for the life of the prepared paragraph. This is lab instrumentation on the product path (`canvas.ts:71`, `84`).
- Nothing is shared across paragraphs. The bench's shared-measurer run roughly halves Canvas calls for 200 messages (47,455 → 24,171) and kept the same lines for all four scripts.

### Prepare (`index.ts:1152-1213`)

Everything below lands in `BlinkPrepared` (`types.ts:120-170`). `nextLine` only reads it. All of it is independent of width, slot, `textIndent` and `textAlign`. It does depend on content, styles, fonts, lang, direction, white-space and the environment. DPR changes both the font size and the 256 px piece size.

1. **Index.** `indexContent` produces a `ContentIndex` with leaves, elements and events.
2. **Styles.** `stylesOf` (`content.ts:104-130`) produces four arrays.
   - `styles[]` is `BlinkStyle[]`, with the block at index 0.
   - `settings[]` is `IteratorSettings[]`, parallel to `styles`.
   - `styleOfLeaf[]` and `styleOfElement[]` are scratch for `buildContent` only.
3. **Content.** The `Builder` class (`content.ts:203-508`) produces `Content {text, sourceOffsets, items, hasNonOrc16Bit}`.
   - Its scratch `units: number[]`, `src: number[]` and `boxes` are dropped after use.
   - `InlineItem` is one flat record for five item kinds (`types.ts:65-90`). It uses the sentinels `run −1`, `element −1`, `group −1` and `control 'none'`.
   - The items keep builder scratch for the paragraph's whole life: `removedSpaceSource` and `isEndCollapsibleNewline`. They also keep tag-only fields on every item: `shouldCreateBoxFragment` and `isEmptyItem`.
4. **Bidi.** `segmentBidiRuns` (`content.ts:586-609`) splits items per level run using object spread. The level array is dropped.
5. **Per-unit arrays.** These cost about 23 bytes per unit and live as long as the prepared paragraph.
   - Over text_content: `scripts` (Uint8), `sourceOffsets` (Int32), `graphemeStarts` (Uint8), `continuations` (Uint8), `hanKerningCandidates` (Int32, a prefix count).
   - Over source: `contentOffsets` (Int32, the inverse of `sourceOffsets`), `collapsedAt` (Int32), `sourceRuns` (Int32).
   - The four source/text arrays are read only by the output (`fragmentsOf`, `mappingOf`) and by gap ranges.
6. **Contexts.** `contexts[]` is parallel to `styles`. Each entry has five context indices plus `scale` (`shape.ts:67-90`): `ltr`, `rtl`, `ltrNoLigatures`, `rtlNoLigatures`, `hyphen`.
   - The contexts are created eagerly, which gives 4 to 5 new OffscreenCanvas per style per paragraph.
   - `rtl` is unused in LTR text. The two `NoLigatures` contexts serve only gap diagnostics.
7. **Groups.** `groups[]` is `BlinkGroup {start, end, style, rtl, cuts[], prefixAtCut[], startTrim16, endTrim16}` (`types.ts:94-106`), and `item.group` points back to it.
   - `hanKerning[]` is parallel to `styles`, nullable, and filled only for styles whose groups have HanKerning candidates.
   - It is read through an accessor with a non-null assertion (`hankerning.ts:85-87`).
8. **Gaps.** `gaps[]` holds the paragraph gaps with their `at` source ranges.
9. **Derived or copied fields stored on `BlinkPrepared`:**
   - `layoutZoom`, equal to `env.devicePixelRatio`;
   - `baseLevel`, from direction;
   - `sourceLength`, equal to `index.text.length`;
   - `wordSpacingAnywhere`, from white-space;
   - `needsAccurateEndPosition`, from `textAlign`. It is copied again into `LineInfo` (`line-breaker.ts:351`) and into the geometry (`index.ts:1109`);
   - `textAlign`, written at `index.ts:1200` and never read. `index.ts:1096` reads `p.paragraph.textAlign` instead;
   - `is8Bit`, `segmented` and `bidiEnabled`.

### Line (`index.ts:1222-1232`, once per `nextLine`)

- **Carried state** is only `BlinkLineStart {itemIndex, textOffset, style, afterForcedBreak, isPastFirstFormattedLine, afterLeadingFloats}`. This matches the spec: nothing else carries over (blink-lines §4.1).
- **Built per line, then dropped:**
  - `Shaper {p, m, gaps: []}`.
  - A `LineBreaker` instance (`line-breaker.ts:102`).
  - A new `LineBreakIterator`. Its single-entry caches `icu` and `graphemes` each hold a `Uint8Array(text.length + 1)` (`breaks.ts:110-111`, `139`, `205`).
  - `shapeResults`, a `Map<itemIndex, ShapeResult>` (`line-breaker.ts:133`, `176-183`).
  - `results: ItemResult[]` holding the `View`, `Part` and `Segment` objects.
- **Width-independent work recomputed on every line:**
  - the `'group'` ShapeResults, `itemShapeResult` (`shape.ts:566-575`), which calls `groupPrefix16` twice;
  - every `groupPrefix16`, `pairAdjust16` and `safeToBreak` at a text offset;
  - the ICU flags, which depend on the line start offset, not on the width.
- **Slot- or line-dependent:**
  - `availableWidth`, `lineLeft`, `lineRight`, `floatOffset`, `hasLeadingFloats` (`line-breaker.ts:141-154`);
  - the applied text indent;
  - tab ShapeResults, which depend on the position on the line;
  - candidate offsets;
  - which ranges are reshaped, `[start, firstSafe)` and `[lastSafe, breakOffset)`;
  - hyphen results.
- **Flow.** `LineInfo` (`line-breaker.ts:44-71`) feeds `lineEdgeGaps` and then `lineOutput`.
  - `lineOutput` builds a `BlinkLine` holding fragments (with copied `painted` strings), geometry (mapping, items, and clusters per text or tab item), gaps and `next`. The caller owns that line.
  - `applyJustification` mutates `info.results` in place, setting `r.justification` and `r.inlineSize` (`index.ts:746-749`).
  - So the order of `hangWidthOf`, justification and `itemsOf` matters.

### Who reads the output

| Reader | Fields read |
|---|---|
| painter | `fragments`, `hasLineBox`, `joinsNextLine`, `slot`, `indented`, `align`, `geometry.needsAccurateEndPosition` (`src/paint.ts:49`, `310`) |
| lab scorer | `geometry.width`, `geometry.layoutZoom` |
| `lab/observe/blink.ts` | `geometry.items` (x, inlineSize, level, textStart/End, clusters), `geometry.mapping`, `hangWidth`, `align`, `hasLineBox`, line gaps, paragraph gaps |

Nothing outside tests reads `lineLeft`, `lineRight`, `availableWidth`, `textIndent` or `alignOffset`. The charter's tentpole 1 still lists them as engine-true output.

## 2. Canvas measurement flow

### Context settings (`shape.ts:67-90`)

- The font is at the zoomed size, or at the CSS size with `scale = zoom` when `measuresAtCssSize`.
- `lang` is the style's locale.
- `letterSpacing` is the style's value times zoom.
- `wordSpacing` is `'0px'`; the port adds word spacing arithmetically.
- `fontKerning` is `'auto'` and `textRendering` is `'optimizeLegibility'`.
- `partition` is `'8bit'` or `'16bit'` from `p.segmented`.
- The NoLigatures variants use a letter spacing of 1/64 px. The hyphen context uses 0.

### String building

The string comes from `canvasString` (`shape.ts:241-285`).

- Substitutions:
  - U+0020 becomes U+2028;
  - VT and FF become U+0001;
  - ignorables become U+2060, or are left out in an 8-bit paragraph.
- It adds U+200D at joined edges.
- It forces 16-bit storage with a slice trick when the range has 13 units or more, and with a U+2060 prefix otherwise.
- It allocates two `number[]` arrays, runs `String.fromCharCode(...slice)` and `Int32Array.from` on every call, before the memo is consulted.

### Prepare

1. **`measureHanKerningFontData`** (`hankerning.ts:58-82`), per style with candidates:
   - `「` and `「「` in the hyphen context;
   - when the font has `halt`, 10 unmemoized `measureTextBounds` calls, one per punctuation character.
2. **`measureGroups`** (`shape.ts:467-484`), per group:
   - the edge trims `c` and `cc`;
   - `addCuts` (`432-464`), which measures the whole group and, when that is 256 zoomed px or more, halves it and recurses;
     - at candidate cuts it runs `passesSafeTest`, which measures three pair-window strings: `xy`, `x` and `y`;
   - the prefix loop then re-asks for every piece and cut pair, all memo hits.
   - The registry lists the halving as a heuristic (`blink/shape/wide-group-halved`), not a Blink rule.
3. **`contentGaps`** (`index.ts:147-186`) makes no Canvas call. It builds 3 Canvas strings per grapheme and scans their scripts, to find script-context conditions.

### Lines

- **`shapeLine`** (`line-breaker.ts:546-677`):
  - `positionForOffset(start)`;
  - the `offsetForPosition` binary search (`shape.ts:638-660`), which makes 2 `xPosition` calls per step;
  - `groupPrefix16` (`497-518`) under both.
- **`groupPrefix16`** costs:
  - 1 prefix string `[nearest cut, k)`;
  - `pairAdjust16` with 3 strings;
  - `pairAdjust16` a second time in the same expression when k is a cut (`511-513`).
- **Safe-offset scans:** `nextSafeToBreak` and `previousSafeToBreak` (`611-621`) run `pairAdjust16` per step.
- **Reshapes:**
  - `reshape` for `[start, firstSafe)` and `[lastSafe, bo)`;
  - `reshapeHanKerningEnd`;
  - `truncateLineEndResult`.
- **`makeView`** (`740-754`) calls `partWidth16`, which is two `groupPrefix16` calls per part.
- **`shapeHyphen`** measures `‐`, and `-` when `mapsHyphen` is null.
- **`tabShapeResult`** measures `' '` in the block's hyphen context.

### After the break decision

- **`lineEdgeGaps`** (`index.ts:284-348`) runs, at the line start and at each line end:
  - `pairAdjust16`;
  - `pairAdjustNoLigatures16`, 3 more strings in the no-ligature context;
  - `wideAdjust16`, with two-cluster windows.
  - A loop over every cluster boundary of the next word, `[contentEnd, decisionEnd)`, asks for both pair adjustments until the first mismatch (`318-325`).
- **`hangWidthOf`** calls `viewPrefix16`.
- **`applyJustification`** calls `viewPrefix16` twice per result.
- **`clustersOf`** (`593-611`) calls `viewPrefix16` at every cluster boundary of every placed text or tab item. DESIGN §4.5 records this cost on purpose.

### Where the same or overlapping text is measured more than once

- **Same string asked again.** There are 5 to 7 lookups per Canvas call (§0).
  - Each lookup still pays for `joinsAcross`, `canvasString`, `scriptsPerUnit` and hashing of a fresh string.
- **Overlap in `addCuts`.** Each character is shaped about log2(pieces)+1 times: whole, halves, quarters and so on.
  - Measured: 7× the text.
  - A 15K-unit paragraph starts with a single 15K-character `measureText`.
- **Overlap in prefixes.** `[cut, k)` for successive k inside a piece is quadratic in piece length.
  - Piece length is bounded by 256 zoomed px, about 18 characters at DPR 2 and 16 px.
  - Whole-layout result: 11.9× the text shaped at DPR 2, 15.8× at DPR 1.
- **Pair windows.** They are deduplicated across the paragraph only by identical letters.
  - CJK and Arabic have many more distinct pairs than Latin.
- **Per-paragraph Measurer.** Every paragraph measures the same single letters, pairs, space and hyphen again and creates its contexts again.
- **Diagnostic-only contexts.** The no-ligature contexts duplicate pair windows; the result never moves a line.

## 3. Repeated or wasted work and its complexity

n is the number of text units, L the number of lines, m the number of clusters per piece.

1. **The position table Blink keeps and the port lacks.**
   - Blink keeps per-character position data and safe-to-break flags on each ShapeResult (`ComputePositionData`, `CachedPositionForOffset`; blink-lines §1.4).
   - The port recomputes a position on every query, as strings.
   - A relayout repeats about 9,200 string builds for 16 lines even with zero Canvas calls, about 0.2 ms per line.
   - Over a 20-width sweep the break decision alone ends up touching 523 of 600 offsets, so nearly all positions get computed anyway, again and again.
   - An offset-indexed table is Blink's own data structure, not an added cache. Int32 prefix sums and pair adjustments per cluster boundary, filled eagerly or lazily, would do.
   - Trade-off to weigh: eager filling costs about 784 Canvas calls per 600 units. A one-shot break decision needs 331.
2. **`clustersOf` and `viewPrefix16`** (`index.ts:593-611`, `shape.ts:834-859`).
   - Per cluster, `viewPrefix16` recomputes `partWidth16` of every earlier part.
   - It also recomputes `rangeSlicePrefix16(part.start)`, a loop invariant.
   - The cost is about 8 lookups per cluster, for every cluster on every line: 73% of line-phase lookups and 57% of line-phase Canvas calls.
   - Only the lab's `caret()` reads the result (`lab/observe/blink.ts:127-153`).
3. **`measure16` scans scripts and discards the result** (`shape.ts:307`, `313-330`).
   - `scriptsPerUnit(cs.s)` runs for every two-byte string.
   - Any string holding a space is two-byte, because space becomes U+2028.
   - The result is discarded at `if (ls16 === 0) continue`.
   - The ScriptRunIterator allocates per character (`script.ts:24-52`).
   - Measured: 3,500 to 7,000 scans over 20 to 40× the text per layout.
4. **Line-edge gap diagnostics** (`index.ts:241-348`).
   - They take about 45% of the Canvas calls left once clusters are removed (259 → 141).
   - Every line also scans every paragraph gap (`292-295`), which is O(G·L).
   - `groupAround` is a linear scan over groups, called 3 to 5 times per line (`223-226`). The `joinsNextLine` scan is the same (`1118-1131`).
5. **ICU rescans** (`breaks.ts:134-168`).
   - Every line start runs the RBBI state machine over `text.slice(start)` to the end of the paragraph and allocates a `Uint8Array(n+1)`. That is O(n·L) = O(n²/width).
   - Blink's ICU is lazy from the line start. The eager whole-remainder scan is the port's.
   - The cache holds one `(start, table)` entry, so spans that alternate locale or strictness inside a line rescan on each switch.
   - `Intl.v8BreakIterator.adoptText(remainder)` runs per line for dictionary scripts.
   - `graphemeFlags` is the same pattern for break-character (`202-216`).
   - The restart-at-line-start semantics must stay. Scanning only as far as the line needs would make it O(n) overall.
6. **Locale re-parsing.**
   - `following()` calls `icuFlags()`, then `table()`, then `lineTable()`, then `languageOf()`.
   - That is a regex split of the locale per unknown-pair character (`breaks.ts:22-24`, `127-136`, `194`).
   - The table depends only on the style and the UI language, so it can be resolved once per style.
7. **`addCuts` halving** shapes O(n·log(n/piece)) characters. A greedy forward cut beside spaces, with one verification measure per piece, shapes about 1×.
   - Cut placement is a heuristic, so it is open to change under the lab gate.
   - The "beside a space, passes safe test" preference has a stated reason: keep syllables whole (`shape.ts:425-431`).
8. **`contentGaps`** builds 3 `canvasString` values and runs `scriptsPerUnit` per grapheme. That is O(n) with a large constant, and 30–35% of prepare JS.
   - The condition depends on character scripts, so it could be decided from properties without building strings.
9. **`addGap` dedup** (`gaps.ts:9-24`) is linear in the gaps so far and compares the long `detail` strings.
   - It is O(G²) for paragraphs with thousands of ranged gaps. `lab/observe/blink.ts:50-53` mentions 5,317 ranges in one paragraph.
10. **Whole-paragraph scans per line in the output:**
    - `fragmentsOf` walks every content event (`index.ts:448-489`) and builds `painted` one character at a time (`465`);
    - `itemsOf`'s RebuildBoxStates walks items from 0 to the line start (`821-835`);
    - `mappingOf.generated` scans all items for each generated unit (`1063-1071`).
    - These are O(items·L) for rich text such as chat with many spans.
11. **Builder.** `units.splice` and `src.splice` on `number[]` arrays (`content.ts:259-260`, `275-276`) are O(n) per removed or restored trailing space.
    - `items.indexOf` runs in `shift` (`247`). `items.indexOf` and `results.indexOf` also run in the line breaker (`line-breaker.ts:430`, `476`, `510`).
12. **`offsetForPosition`.**
    - The binary search makes 2·log2(item length) probes, each 4 to 7 lookups.
    - It reruns on hyphen retries and overflow rewinds (`breakText` loop at `line-breaker.ts:465-492`; `handleOverflow` at `911`).
13. **Contexts.** 4 to 5 OffscreenCanvas are created, each with a font assignment, per style per paragraph: 4.0 to 14.1 per lab row.

## 4. Behaviour woven through local conditionals, and shared code that knows engines

### Direction

- One fact goes by three names:
  - `p.baseLevel === 1` — `index.ts:527`, `680`, `815`, `993`, `1028`, `1102`; `line-breaker.ts:148`, `153`, `1152`.
  - `paragraph.direction === 'rtl'` — `index.ts:1192`; `content.ts:587`.
  - `rtlStyle` — `index.ts:815`.
- Run direction is copied four times: `item.bidiLevel & 1`, `group.rtl`, `ShapeResult.rtl`, `View.rtl`.
- Local RTL branches sit in:
  - `positionForOffset` and `offsetForPosition` (`shape.ts:628-660`);
  - `viewFromSegments` (`789-822`);
  - `flip` (`line-breaker.ts:551`);
  - `applyJustification` (`index.ts:686`, `702-708`, `730`);
  - `itemsOf`, in its edge swaps (`847-851`, `862`, `1041`).
- Most of these mirror branches in Blink's own source.

### White-space mode

- The keyword is reinterpreted at each site through `collapsesWhiteSpace`, `wrapsLines`, `preservesBreaks`, `preservesSpaces`, and direct compares with `'break-spaces'`, `'pre'` and `'pre-line'`.
- Sites:
  - `content.ts:36-46`, `318`, `389`, `455-456`, `465`;
  - `line-breaker.ts:88-90`, `393`, `430`, `687`, `696`, `865`, `993`, `1002`, `1095`;
  - `index.ts:151`, `402-403`, `532-550`, `1198`, `1228`.
- Blink models these as longhands (white-space-collapse, text-wrap-mode). They could be parsed once per style.

### String storage

`is8Bit` and `segmented` branch in:

- `breaks.ts:206`, `296`;
- `index.ts:163`, `641`, `685`, `1184`;
- `shape.ts:260`, `295`, `522`;
- all through `canvasString`.

### Letter spacing of 0

Special cases sit at `index.ts:256`, `316` and `shape.ts:311-319`.

### Font facts

- The facts are proper unions handled with switches.
- `joining` is switched in two places: `shape.ts:167-176` and `index.ts:1124-1128`.

### Gap reporting is a side channel inside measurement

- `Shaper.gaps` is threaded everywhere.
- The same functions write to the paragraph's list in prepare and to the line's list in `nextLine`.
- Emit sites:
  - `joinedAtEdge` (`shape.ts:170`, `174`);
  - `addCuts` (`453`, `459`);
  - the HanKerning trims (`542`, `555`, `884`, `888`);
  - `makeView` (`748`);
  - `shapeHyphen` (`922`);
  - `tabShapeResult` (`933`);
  - `index.ts:524`, `602`.
- See §7 for why this constrains any position table.

### Shared code that knows engines

- `src/index.ts:39-105` has five functions, each repeating the 3-engine switch.
- `bidiDataFor(engine)` (`src/unicode/bidi.ts:53`), `graphemeRulesFor(engine)` (`grapheme.ts:17`) and `src/breaks/tables.ts` import every engine's generated tables.
  - A Blink-only bundle therefore still carries WebKit and Gecko data.
  - `bidiDataFor('blink')` allocates an object per call and is called per character in `isBidiWhiteSpace` (`line-breaker.ts:1171-1173`).
- `src/paint.ts:310`, `420` branch on the engine.
- `src/model.ts` holds the `Blink*` output types.
- `CanvasSettings.partition` exists for Blink.
- Inside the Blink directory nothing knows another engine.

## 5. Guide violations worth fixing

### Caches and memos

- The string-keyed memo (`canvas.ts:36`, `75-86`), plus the unbounded `log.calls` kept per prepared paragraph.
- The per-line `shapeResults` Map (`line-breaker.ts:133`).
- The per-line `icu` and `graphemes` flag caches (`breaks.ts:110-111`).
- Lazily initialized module singletons:
  - `runs` and `scriptRuns` (`props.ts:17`, `70`);
  - `hanKerningTypes` Map (`props.ts:56`);
  - `bracketPairs` Map (`script.ts:59`);
  - `blinkRules` and `blinkPairs` (`tables.ts`).
- `p.hanKerning[]`, filled lazily and nullable.

### Map or Set where an array or record fits

- `elementsOn` builds 4 Sets and 1 Map per line (`index.ts:354-372`).
- `clustersOf`'s `extra` Map is built from an already sorted array (`596-597`).
- The `lastOf` Map with re-keying (`973-990`).
- The `shapeResults` Map keyed by a dense item index.
- The `hanKerningTypes` Map, from a sorted pair array of about 100 entries.
- The `measureContext` key Map.

### Derived data stored as fields, and copies of one fact

- Four arrays parallel to `styles` with the same lifetime: `styles`, `settings`, `contexts`, `hanKerning`.
- On `BlinkPrepared`:
  - `layoutZoom`, `baseLevel`, `sourceLength`, `wordSpacingAnywhere`, `needsAccurateEndPosition`, `textAlign`;
  - `contentOffsets` and `collapsedAt`, derivable from `sourceOffsets`.
- On `BlinkStyle`:
  - `primaryFamily`, `element`, `wordBreak`, `overflowWrap` and `lineBreak`, written at `content.ts:138-141` and never read;
  - `measuresAtCssSize`, `joining` and `pairKerning`, copied from `font.facts`.
- The `text` and `items` copies on `LineBreaker`.
- `View.width` is stored, but the part widths it sums are recomputed elsewhere.
- `LineInfo.lineLeft`, `lineRight`, `textIndent` and `needsAccurateEndPosition` are re-copied into the geometry.

### Dead code

- `CanvasString.leftOut`, which is never read.
- `IteratorSettings.softHyphen` is always true, so the `disableSoftHyphen` branches at `breaks.ts:232`, `271` and `319` are dead.
- `nextBreakOpportunity` is an alias.
- `BlinkPrepared.textAlign`.
- The `BlinkStyle` fields listed above.
- `EngineImplementation.gaps()` only returns `p.gaps`.
- All generated Blink data is read. It totals 586 KB, of which 503 KB is five largely overlapping ICU line tables.

### Composite string keys and repeated string parsing

- `fontKey: [family, size, weight, style, locale, ls, ws].join('')` (`content.ts:140`) has no separator.
  - `'Arial 1'` with size 2 collides with `'Arial '` with size 12.
  - It is compared only at `index.ts:53`, where comparing the fields directly would do.
- The `measureContext` key is a string join (`canvas.ts:44-45`).
- The `languageOf` regex split runs per call and is duplicated (`breaks.ts:22`, `index.ts:106`).
- `firstFamily` parsing (`content.ts:150-155`).
- Gap `detail` prose strings serve as identity in the dedup.
- The `painted` strings are copied text instead of views (`index.ts:428-470`).

### Flat records with sentinels instead of tagged unions

- `InlineItem`: `type` plus `control: 'none'`, with `run`, `element` and `group` at −1. This forces `throw new Error('control item without a control kind')` (`line-breaker.ts:762`).
- The "no run" convention is mixed: `BlinkStyle.run: number | null` against `item.run` of −1, and `runAt` returns null.
- Optional `ItemResult.justification?` and `hyphen: … | null` are mutated across phases.

### if/else chains over unions

- `content.ts:54-71`, `455-457`.
- `breaks.ts:252-262`, in the hot loop.
- `index.ts:43-52`, `384`, `409-410`, `826-827`.
- `line-breaker.ts:777-778`, `1053-1058`.

### Iterator chains, spreads and hidden allocation

- `index.ts:940-941` (`map` twice), `978` (`[...lastOf]`), `686` and `730` (`reverse`).
- `shape.ts:274`, `283`, `747`, `819-822` (spread, `unshift`).
- Closures allocated per call: `ranges()` (`index.ts:194`), `countText` and `next` (`683-720`), `leaf`, `placeholder` and `endBox` in `itemsOf`.

### Near-duplicate code

- `pairAdjust16`, `pairAdjustNoLigatures16` and `wideAdjust16` are one function at three settings (`shape.ts:385-416`).
- `reshape` and `reshapeHanKerningEnd`.
- `previousBO` and `nextBO`.
- `isSpaceLB`, in `index.ts:234` and `line-breaker.ts:74`.
- Two hand-written ICU Default_Ignorable lists, `index.ts:651-655` and `shape.ts:140-144`.

### Defensive code and hidden modes

- `stack.pop()` followed by an undefined check (`index.ts:910-911`).
- Bounds guards at `index.ts:391-392`, `405-406`.
- `Math.max(0, …)` at `376`.
- `char(i)` returns 0 past the end.
- Default parameters act as hidden modes:
  - `measure16(…, noLigatures = false)`;
  - `reshape(…, isLineStart = false)`;
  - `viewOf(sh, sr, start = …, end = …)`;
  - `clustersOf(…, justification = [])`.

### Glue

- `stateNow()` works around TypeScript narrowing (`line-breaker.ts:207`).
- The `fontHeightsDiffer` closure is passed from `index.ts:1159-1164` into the `Builder` for a four-field compare.
- `stylesOf` returns two scratch arrays.
- `blinkEngine.prepare` assembles about 30 fields by hand.
- `hanKerningFontData()` is a one-line accessor.

### Exceptions

Only two throws exist (`line-breaker.ts:762`, `791`). Both are invariant panics, which the guide allows. The first disappears once items are a tagged union.

## 6. Line counts and rewrite estimate

| File | Total | Code | Comment | Rewrite estimate |
|---|---:|---:|---:|---:|
| types.ts | 191 | 104 | 76 | ~150 |
| content.ts | 609 | 498 | 60 | ~520 |
| breaks.ts | 323 | 266 | 31 | ~290 |
| script.ts | 264 | 223 | 22 | ~240 |
| props.ts | 134 | 93 | 20 | ~120 |
| hankerning.ts | 116 | 84 | 20 | ~130 |
| gaps.ts | 47 | 36 | 8 | ~40 |
| shape.ts | 961 | 669 | 217 | ~700 |
| line-breaker.ts | 1,173 | 1,019 | 91 | ~1,050 |
| index.ts | 1,237 | 1,048 | 149 | ~950 |
| **src total (non-test)** | **5,055** | **4,040** | **694** | **~4,100–4,300** |
| tests: breaks, content, lines, script | 673 | | | keep |
| lab/observe/blink.ts | 435 | 351 | 56 | ~420 |

Notes on the estimates:

- **types.ts.** Tagged-union items; styles absorb settings, contexts and hanKerning; dead fields go.
- **breaks.ts.** Table resolved per style; ICU scanned incrementally; dead soft-hyphen branches go.
- **hankerning.ts.** Absorbs the trims now in shape.ts.
- **shape.ts.** One pair-window function and an offset-indexed position table. The View, Part and Segment bookkeeping stays.
- **line-breaker.ts.** It is near the floor.
- **index.ts.** Split into a break-decision entry, an output file (fragments, items, mapping, justification, hang) and a line-gaps file.
- **lab/observe/blink.ts.** Already clean.

About 75% of the port is function-for-function Blink code with citations (content builder, ScriptRunIterator, break iterator, LineBreaker, ShapeLine, ShapeResultView bookkeeping, box and bidi reorder). That is why the line-count reduction is modest, about 15–20%.

The larger gain is in runtime (§0 and §3, points 1 to 5).

## 7. Constraints a rewrite must respect

- **Gap conditions are tied to where a measurement happens.**
  - `lab/observe/blink.ts:79-93` treats any line gap without `at` as limiting every inside edge on that line.
  - A gap that moves from a line's list to the paragraph's changes the scoring.
  - If positions move into a prepare-time table, the line-time gaps must be re-derived from the offsets the line's decision actually touched.
  - The affected gaps are `joining-technology`, `unsafe-to-break`, `han-kerning`, `glyph-clusters`, `hyphen-glyph` and `tab-stops`.
- **`offsetForPosition` must keep Blink's exact binary-search probe order** (`shape.ts:647-658`), because positions aren't guaranteed monotone.
  - A table changes what a probe costs, not which probes run.
- **The View, Part and Segment bookkeeping** (`index`, `offset`, `length`, `startIndex`, `charIndexOffset`) reproduces an RTL numbering quirk.
  - It is recorded as RESULTS class 3 and probe-zw3 (`shape.ts:780-825`).
  - It can't collapse into plain ranges.
- **ICU restarts at each line start with no prior context.** Only the eager whole-remainder scan is the port's.
- **Chrome's per-canvas shaping cache makes context identity observable.**
  - Text that could shape differently must stay apart: the 8-bit and 16-bit partitions, and the no-ligature contexts.
  - A Measurer shared across paragraphs is compatible with that. It gave the same lines in the bench for 200 messages per script.
- **The rule registry.**
  - `tests/rules.json` lists 183 Blink rule ids: 131 ported rules, 19 named gaps, 17 recipes, 8 heuristics, 8 observation rules, 5 facts and 3 choices by score. 12 of the 183 have status removed.
  - The source carries no `// rule <id>` annotations, so that list is the checklist.
- **Three consumers want three depths of output:**
  1. line count and width, which need the break decision only;
  2. painting, which needs fragments, `joinsNextLine`, `align` and `indented`;
  3. lab and caret geometry, which need items, clusters, mapping and gaps.
  - Today `nextLine` computes all three eagerly. The third alone is about three quarters of the cost.
- **The container width is an input to every line call, not to prepare.**
  - It sits inside `Paragraph`, which prepare captures.
  - Only `line-breaker.ts:145` and `index.ts:1228` read it.
