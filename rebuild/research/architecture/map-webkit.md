# WebKit port map (rebuild/src/engines/webkit/**, rebuild/lab/observe/webkit.ts)

## What I read and ran

- **Read in full:**
  - every file of `rebuild/src/engines/webkit/` and `lab/observe/webkit.ts`;
  - the shared files they call: `src/index.ts`, `engines/engine.ts`, `measure/canvas.ts`, `content.ts`, `breaks/rbbi.ts`, `breaks/tables.ts`;
  - `specs/webkit-lines.md`, `specs/webkit-text.md` §0-§13 and `specs/webkit-RESULTS.md`.
- **Skimmed:** `webkit-AUDIT.md` (header and §7-8) and `webkit-gaps.md` §2.5 and §9. For `webkit-canvas.md` I saw nothing: a heading listing came back empty and I did not open the file.
- **No browser job, no lock, no edits** under `pretext-rebuild`. Offline Bun prototypes and scratch copies of the port are in `<scratch>/arch-plan/webkit/` (`rowstats.ts`, `sites.ts`, `phases.ts`, `prof-prepare.ts`, `prof-bidi.ts`, `prepare-ablate.ts`, `port-copy/`, `prof/*.md`).
- Bun timings use a stand-in Canvas, so they show JS cost only.
- **Labels:** n = code units, I = items (about n/3), B = text boxes (rendered leaves), L = lines, r = length of the rest of a word split across lines.

## 1. Data structures by stage, lifetimes, and what depends on width

### Stage 0: caller input

`Paragraph` (tree of text, span, atomic, br, wbr) and `WebKitEnvironment`.

### Stage 1: prepare-scope temporaries (`content.ts:676-798`)

All are dropped at return.

- `index: ContentIndex` (`content.ts:679`, shared `src/content.ts`): leaves, elements, events, plus `text`, a full concatenation of all leaf text. WebKit reads only `index.text.length` (`content.ts:773`).
- `leaves: LeafInput[]`, `rendered: boolean[]`, `frames[]`, `boxOfRun[]`, `bidi: BidiData`.
- One `BreakFactory` per box (`breaks.ts:30-45`). On the first ICU query it lazily builds `following: Int32Array(n+1)`, plus a `Uint8Array(n+1)` and a `RuleBoundary` object per boundary (`breaks.ts:157-178`, `rbbi.ts:281-288`). It is dropped after `handleTextContent`.
- Bidi: the paragraph string, an `offsets[]` entry per item and `levels` (`content.ts:368-458`).
- History facts: two `Set<number>` per box (`content.ts:594`, `:633`).

### Stage 1 output: `WebKitPrepared` (`types.ts:148-169`)

- It lives as long as the caller keeps it and is never mutated after prepare. `computeBidiLevels` mutates items in place during prepare only (`content.ts:443-452`).
- It is fully independent of width.
- Fields:
  - `paragraph` (read only for `.width`);
  - `env`, `zoom`, `icuDefaultLocale`, `style`;
  - `elements[]`: span style, LayoutUnit edges and letterSpacing; atomic margins and widths;
  - `builder`;
  - `boxes[]`: `WebKitBox` with 28 fields;
  - `runStarts[]`, `runTexts[]` (the latter is read only for `.length`, `lines.ts:1880`);
  - `items[]`: `WebKitItem` objects;
  - `gaps[]` (only ever `page-zoom`).

### The `Measurer` (shared `measure/canvas.ts`)

- It has the same lifetime as the prepared paragraph. There is one per `prepareParagraph` call (`index.ts:40`), so every paragraph makes its own OffscreenCanvas(es) and its own memo.
- It holds a `memo: Map<string, number>[]` per context and `log.calls`, which keeps every measured string and width.
- Both grow during line layout: breakWord prefixes at each new width add entries that are never dropped.

### Stage 2: per line (`webkitNextLine`, `lines.ts:2583-2726`)

All of it is created and dropped per call.

- The line rect.
- `L: Layout` (`lines.ts:30`): 10 fields, 5 of them gap bookkeeping.
- `b: Builder` (`:994-1003`): `wrapOpportunityList` holds item objects, not indices.
- `Line` (`:128-144`) with `LineRun[]` (`:101-124`): 17 fields per run, including a nested `expansionBehavior` object.
- Per candidate, which in LineBuilder means per word:
  - `Candidate`, `Content` (14 fields, `:514-538`), `ContentRun[]`, `LineStatus`, `BreakResult`, `SimpleResult` or `LineBuilderResult`;
  - two closures per `commitCandidateContent` (`:1569`, `:1582`).
- Partial items made by object spread (`:980`, `:2601`).
- Justify: a copied `ExpandableRun[]` (`:1820-1837`).
- Output temporaries:
  - `pieces[]` wrappers (`:2207`);
  - a `Map` per line in `displayBoxes` (`:1968`);
  - three `Set`s plus `nodes[]` and `stack[]` per bidi line (`:2048-2062`).

### Result per line: `LineOf<WebKitLineStart, WebKitLineGeometry>`

- `fragments[]`, with `painted` strings built by per-character concatenation under collapsing white space (`:2193-2202`);
- `geometry.boxes[]`;
- `gaps[]` with template-string `detail`;
- `next`.

All of it is always built.

### State that crosses lines

Only `WebKitLineStart` (`types.ts:172-189`): `itemIndex`, `offset`, `previousLine {carriedWidth, endsWithLineBreak}`, `isFirstFormattedLine`, `hasFloats`.

- It is small and immutable, and a start serves any slot. This is a good shape.
- `previousLine === null` doubles as "first build" in three places (`:2592`, `:2598`, `:2676`).

### Stage 3: lab observation (`observeWebKit`)

It reads only model types:
- display box fields `kind`, `run`, `start`, `end`, `level`, `isWordSeparator`, `x`, `width`, `hyphen`, `expansion`, `expansionBehavior`, `shapedAcrossBoxes`;
- inline-box, atomic and line-break boxes;
- fragment kinds;
- `line.align`, `geometry.alignmentOffset` and `geometry.hangingWidth`;
- `env.pageZoom`, `paragraph.width` and `paragraph.direction`.

The painter reads `fragments`, `hasLineBox`, `joinsNextLine`, `slot`, `indented`, `align` (`paint.ts:49`).

### Independent of width but recomputed per line today

- Every break-opportunity decision between items:
  - `isAtSoftWrapOpportunity` (`:1271`);
  - `endsWithSoftWrapOpportunity` (`:1250`);
  - `mayBreakInBetween` (`breaks.ts:393`);
  - `nextWrapOpportunity` positions (`:1294`);
  - `hasTrailingSoftWrapOpportunity` (`:1326`);
  - the simple builder's `isAtSoftWrapOpportunityOrContentEnd` (`:1155`).
- Per-box constants, looked up through the memo on each use: space width in `context`, space width in `plainContext`, hyphen width, whether U+2010 and U+002D differ.
- Box-edge and atomic item widths (`boxItemWidth`, `:1351`).
- "Any contentful item at or after i" (`isContentfulItem`, `:1705`), which is a single suffix fact.
- Element source offsets (`elementOffsetOnLine`, `:2299`).
- Most `lineGaps` conditions, when evaluated for a whole item:
  - control characters, tabs, ligature pair, canvas-language, ui-language, font-fallback;
  - T1 (the fixed-pitch width test of `specs/webkit-gaps.md` §2.5), simplified-measuring;
  - dictionary conditions, history ends and `widthMoves`.
- The line enters gap conditions in three ways only: which items were measured, the offset of a partial leading item, and `decides` (`:2528`).

### Truly dependent on width or slot

- The line rect: slot insets, indent and zoom (`lineRect`, `:2344`).
- Preserved white space in a box with a TAB, measured with the pen position.
- The Line itself: run lefts and widths, trimming, hanging, hyphen.
- breakWord probe strings and the carried width.
- Justification.
- The outputs and the next start.

## 2. Canvas measurement flow

### Contexts per box (`content.ts:250-253`)

- `context`: font at size × zoom, the box's letterSpacing, wordSpacing 0.
- `plainContext`: the same with letterSpacing 0. It is used for tab stops, the fixed-pitch width and shaping across boxes.
- `spacedContext`: adds word spacing, only when it isn't 0.
- Fixed-pitch boxes on the simplified path add `"P, LastResort"` and `LastResort` contexts (`:265-266`).
- Always `fontKerning: auto`, `textRendering: auto`, `direction: ltr` (WebKit measures LTR TextRuns), `lang: ''`.
- The context key is a join of 8 strings per `measureContext` call, 3 to 5 calls per box.
- Saved rows: contexts per paragraph mean 1.57, median 1.

### At prepare

1. `' '` per box (`:321`).
2. Per non-whitespace item:
   - `boxWidth(start, end, 0, true)` (`:347`) measures the word with its following space when the next unit in the box is U+0020;
   - it then subtracts `singleSpaceWidth`, which is a second memo lookup of `' '` per word (`measure.ts:132`).
   - In `sites.ts`, 600 repetitive words gave 1,264 hits at that site against 10 real calls.
3. A preserved white-space run longer than 1 without a TAB: one call (`:338`).
4. When reordering is needed, everything is deferred to `computeItemWidths` (`:489`). That includes one `' '` lookup per white-space item (599 hits in the Hebrew test).
5. Fixed-pitch coverage: 3 lookups per code point of the text, not per distinct code point (`:267-275`).

### At line time

- **Items with no stored width** (preserved white space in a box with a TAB, a bidi-split item in an RTL block without reordering content, a rest without a carry):
  - The simple builder measures them twice per placement: in the candidate sum (`:1185`), then at commit (`:1102` or `:1115`).
  - It measures them again on revert (`:1033`).
  - LineBuilder measures at `:1383` and again on every rebuild (`:1624`).
  - In `sites.ts`, a pre-wrap text with tabs gave 525 + 525 hits at those two sites.
- **breakWord probes** (`measure.ts:180`): O(log r) prefixes from the item start, each a fresh string. Source requires this.
  - The complex path measures one growing prefix per grapheme (`:239-243`).
- **Hyphen** (`lines.ts:90-95`): a lookup each time an item ending in a soft hyphen is appended (`:272`), plus two more while `mapsHyphen` is unknown.
- **RTL trimming** (`:449`): `"word␠"` is a memo hit and `"word"` is a new real call per trimmed line. Source requires this.
  - In the Arabic bench sweep, prepare makes 1,723 calls and prepare plus 20 layouts makes 3,087, about 0.28 new calls per line.
- **Shaping across boxes** (`:1511-1519`): prefixes of the joined text in `plainContext`.
  - The separately measured prepare widths of those items are then overwritten (`:1517`).
- **`lineGaps`** (no effect on layout):
  - T1: two `boxWidth` calls per item per line while `monospace` or `primaryFamily` is unknown (`:2487-2493`). This is a real call when prepare took the shortcut.
  - simplified-measuring (`:2499-2513`): for a measured string without U+0020, one lookup per code point plus the total.
  - page-history: parts and whole (`:2536-2546`). Per-unit space lookups run in a loop (`:2572`).

### Saved counts

`.artifacts/lab/webkit-round2/dev-all-predict-p3`: 25,180 cases, 88,797 lines, 1.07M characters.

| Measure | Mean | Median | p95 | Max |
|---|---:|---:|---:|---:|
| Real calls per case | 17.7 | 8 | 56 | 2,069 |
| Memo hits per case | 24.3 | | | 10,211 |

- 58% of all lookups are memo hits (612,285 hits against 445,776 calls).
- 5.0 calls and 11.9 lookups per line.
- `predictMs`:
  - mean 0.10 ms;
  - the timer step is 1 ms in those rows;
  - corpus rows take 28 to 45 ms for 20-30k characters.
- `webkit-RESULTS.md` says the line-local gap conditions added about 17% to mean calls (15.1 to 17.7).

### Bench (`.artifacts/bench/smoke-20260917`, smoke quality)

| Row | Rebuild | Main | Ratio |
|---|---:|---:|---:|
| Latin corpus, cold | 6.90 ms, 1,200 calls | 5.54 ms, 4,374 calls | ×1.25 |
| Latin corpus, prepare alone | 5.42 ms | | |
| Latin relayout, one width (derived) | about 324 µs | 31 µs | about 10× |
| Arabic relayout, one width (derived) | about 2,040 µs | 31 µs | about 66× |
| 200 messages, calls | 4,777 per-paragraph measurer; 2,104 shared measurer | 6,968 | |

- The relayout figures are derived from the 20-width sweep as (prepare plus 20 layouts, minus prepare alone) / 20: 11.9 and 5.42 ms for Latin, 47.2 and 6.44 ms for Arabic.
- The public `layoutParagraph` prepares again on every call, so the 20-width sweep is ×18.5 against ×1.96 with the prepared paragraph reused.

## 3. Repeated or wasted work

### Prepare

- `isDelimiterQuote` (`data.ts:115-120`) runs `Object.values(webkitDelimiters)` (52 rows) per code point, called from `collectBoxFacts` (`content.ts:527`).
  - It is 55-62% of all JS time in a 3,000-paragraph profile (`prof/plain.md`, `prof/rich.md`).
  - Ablation: a flat list of the 10 distinct quote code points is the same predicate.
    - Prepare drops from 219 to 53 µs per 100-word paragraph.
    - At 6,000 words it drops from 12.4 to 2.7 ms.
- `collectHistoryFacts` (`content.ts:590-667`): per box of at least 5 units, O(I) over all items, so O(B·I) overall (`:600`), plus 2 whole-text bidi resolutions.
  - Without any strong character it is 2 × 41 resolutions, and a few tail resolutions more (`:637-659`).
  - Skipping it, as a probe only, takes prepare from 53 to 22 µs.
  - About 90% of prepare JS feeds gaps only.
- The locale is parsed 3 times per box (`content.ts:284`, `:550`, `:554`) and once per `lineRules` call (`data.ts:60-93`, `:126`).
- `familyNames` splits and regex-tests the family list per box, twice (`content.ts:247`, `:539`).
- Four linear scans of the text per box (`:237-245`, `:286`).
- `bidiBoxContent` concatenates per character even without LF or TAB (`:355`).
- Bidi splits use `items.splice` and `offsets.splice` (`:451-452`), which is O(I · splits).
- Every item is measured up front, even if the caller lays out two lines.

### Per line

- `placeInlineAndFloatContent`'s last-line test has no early exit (`lines.ts:1785`), so it is O(I − end) per line and O(I·L) overall.
  - Measured on 6,000 words with 1,025 lines in LineBuilder: fill 39.2 of 42.0 ms.
  - With a `break` (result-identical, since the flag only goes false) fill is 1.96 ms.
- `endsWithSoftWrapOpportunity` builds a fresh factory per call (`:1255`), and `mayBreakInBetween` does too (`breaks.ts:394`).
  - Any ICU query then runs `computeFollowing` over the whole box, including `lineRules` and `quoteOverrides`.
  - That is O(box) per bidi or box boundary per line attempt.
  - Measured on 6,000 words with Hebrew letters: fill is 21 ms after the fix above. `RuleBreakIterator.next` takes 38% of the profile.
- `lineGaps` works on the whole rest of a split item every line (`:2422-2423`, `:2427-2439`, `:2500-2511`, `:2488`).
  - Measured on one 30k-character word with overflow-wrap anywhere:
    - `lineGaps` is 158 of 162 ms;
    - 28.5M characters go to measureText and 28.7M lookups hit the memo;
    - at 3k characters it is 2.1 of 2.3 ms.
  - With a real Canvas this shapes O(n²/line length) characters, and a rest carried over from a break is a string the engine itself never measures.
  - The expensive check also runs before the per-(gap, run) dedupe in `add` (`:2412`).
- `lineGaps` calls `lineRules()` per text item per line when dictionary breaks are unavailable (`:2514`).
- `elementOffsetOnLine` scans all items per element run per line (`:2299-2309`).
- `runAt` is linear over runs per collapsed fragment (`:1878`).
- `boxOfRun` is linear over boxes (`:2177`).
- `firstUserPerceivedCharacterLength` runs grapheme rules over the whole box per call, and it is called twice for one item (`measure.ts:254`, `lines.ts:687`, `:915`).
- breakWord's complex path computes graphemes for the whole rest (`measure.ts:237`).
- A new `Intl.Segmenter` is built per dictionary range (`breaks.ts:116`).
- LineBuilder allocates about 8 objects and 2 closures per word.
  - The simple builder allocates a `SimpleResult` per candidate, and each word and each space is its own candidate.
  - Measured on 104 lines:

| | Simple | LineBuilder |
|---|---:|---:|
| Fill | 0.20 ms | 0.33 ms |
| `lineGaps` | 0.18 ms | |
| Fragments | 0.04 ms | |
| Display boxes | 0.01 ms | |

- Relayout at another width repeats everything, including gaps, fragments and boxes. It costs about the same as the first layout (0.39 against 0.46 ms).

## 4. Behaviour woven through conditionals

### Which builder runs

- It is chosen at prepare (`content.ts:791-795`) and overridden per line by `hasFloats` (`lines.ts:2588`).
- Range-based is index arithmetic inside `webkitNextLine` (`:2611-2648`).
- Parallel pairs mirror WebKit:
  - `appendText` and `appendTextFast`;
  - `simpleCommitCandidateContent` and `candidateContentForLine` with `handleInlineContent`;
  - `handleOverflowingTextContent` and `processLineBreakingResult`;
  - `revertToTrailingItem` and `rebuildLineWithInlineContent`;
  - the two hyphen revert loops;
  - `placedInlineItemEnd` and its inline copy (`:1767-1776`);
  - two line endings.
- The six result-changing differences are listed in `webkit-lines.md` §2 and must survive.

### Direction

- `p.style.rtl` is read at about 19 sites in `lines.ts`.
- `lineLeft` is computed twice with two formulas (`:2693`, `:2708`).
- `containerWidth` is computed twice (`:2345`, `:2692`).

### Bidi

- Sentinel levels 254 and 255 live in a numeric `level` and are normalized at output (`:2191`, `:1983`, `:1926`).
- RTL is decided as `level % 2 === 1 && level <= 125` (`:1469`, `:1828`).
- `bidiDisplayBoxes` flips `line.hasNonDefaultBidiLevelRun` to re-enter `displayBoxes` (`:2037-2040`).

### Gap reporting

- It lives in five places:
  - `collectBoxFacts`;
  - side effects inside rules (`:90-95`, `:694-696`, `:1522-1524`);
  - `lineGaps`;
  - `p.gaps`;
  - `buildGaps` in `index.ts`.
- Its bookkeeping (`measuredEnd`, `reverted`, `decisionStart`, `overflowStart`) is mutated from nine sites inside the builders.
- `boxWidth` has a boolean `fixedPitchShortcut` parameter used only by gaps (`measure.ts:117`).

### Other dimensions

- **Floats:** `hasFloats`, `placesSlotFloats`, `constrainedByFloat` (`:1698`, `:1989`), `below-floats`.
- **Word spacing:** spread over `needsNewRun`, run left, content offset, `spacedContext` against `addWordSpacing`, and `whitespaceRun`.
- **8-bit storage:** five sites.
- **Which outputs the caller wants** is not modeled at all.

### Shared code that knows engines

- `src/index.ts` has five three-way switches and static imports of all three engines (bundle 2,195 KB).
- `EngineImplementation` is an object used as a dispatch table (`webkit/index.ts:13`).
- `model.ts` imports each engine's `LineStart`. The `engine: 'webkit'` tag on every start feeds a defensive `startMismatch` check.
- `breaks/tables.ts` imports all three generated modules.
- `bidiDataFor(engine)` and `graphemeRulesFor(engine)` switch on the engine.
- Apple's category-override loop sits inside the shared `RuleBreakIterator.next` (`rbbi.ts:215-219`).
- The Canvas settings `partition` and `lang` exist for other engines.

## 5. Guide violations worth fixing

### Caches and memo maps

- The per-paragraph memo absorbs per-box constants that should be fields: space width, plain space width (`measure.ts:75`, `:92`), hyphen width.
- `log.calls` is unbounded.
- `BreakFactory.following` is a lazy cache that is thrown away and rebuilt per query at line time.

### Map or Set where an array or walk fits

- `content.ts:594`, `:633`;
- `lines.ts:1264` (a Set per `nearestCommonAncestor` call);
- `lines.ts:1968`, `:2048-2050`;
- `expansion.ts:23`.

### Derived data stored as fields, and copies

- 12 `WebKitBox` fields feed only gaps:
  - `monospaceUnknown`, `hyphenUnknown`, `primaryFamilyUnknown`, `primaryFamily`, `unverifiedCoverage`;
  - `localeChoosesFonts`, `hanLocaleUnknown`, `quoteLocaleUnknown`;
  - `dictionaryRangesStartingWithMark`, `historyEnds`, `historyWhitespace`.
  - `hasStrongDirectionality` is a prepare local stored as a field.
- `box.wordSpacing` always equals `box.style.wordSpacing`.
- `style.lineBreakMode` is derived from `lineBreak`.
- `fixedPitchFastMeasuring` is derived from `fixedPitch` and `primaryFamily`.
- The block's `rtl`, `textAlign` and `textIndent` are copied into every style.
- `runStarts` and `runTexts` copy the index.
- `ExpandableRun` is a stringly-typed (`kind: string`) copy of the runs, copied back afterwards.

### Homogeneous collections with special cases

- `LineRun` is one shape for 8 kinds, with −1 sentinels and defaults (`:157-159`).
- A single `items: WebKitItem[]` forces 206 `!` and 57 `as` in `lines.ts`.
- Seven "element isn't atomic" throws exist because an item points at an element of separate kind (`:45`, `:52`, `:394`, `:1357`, `:1981`, `:2106`, `:2133`).

### if/else over unions

- `:2053-2056`.
- `:2087-2088`: a nested ternary with identical branches.
- `:476`.

### Strings

- Repeated parsing of locale and font family.
- Per-character concatenation in `painted` and `bidiBoxContent`.
- Gap `detail` templates built per line.
- A composite numeric font key `context * 1000003 + wordSpacing` (`:1471`).

### Views

- Items are spread into new objects and then found again by object identity (`:1035`, `:1611`, `:1619`).

### Iterator use

- `Array.from(segmenter.segment())` (`breaks.ts:116`).
- `[...starts].reverse()` and a code point array with reverse (`expansion.ts:57-63`, `:157`).

### Exceptions and optional chains

- No exceptions are used as control flow.
- There are no optional chains.
- `UnportedFeature` is unused by this port.

### Glue and dead code

- Unused `_p` parameters (`measure.ts:73`, `:91`), and `p` threaded through `boxWidth` only to reach them.
- `void rootLevel` (`:2173`).
- `Builder.isFirstFormattedLine` is never read.
- `previousLine.endsWithLineBreak` is never read.
- `Content.isTextOnlyContent` and `Content.hasTrailingSoftHyphen` are never read.
- Three `hyphenWidth` fields are always null, with four dead branches (`:1080`, `:1084`, `:1600`, `:1603`).
- `expansionShares` (`expansion.ts:146-190`) has no library caller.
- `dictionaryRangeStartsWithMark` (`breaks.ts:131`) is dead.
- `codePointStart` is duplicated (`lines.ts:711`, `measure.ts:157`).
- The detach-trailing-whitespace block appears twice (`:488-498`, `:1806-1816`).
- `nbspBreaks` is a constant false threaded through four functions.

### Generated data

- 644 KB of generated tables: six near-duplicate line tables of about 98 KB of base64 each, plus `char`.
- The base64 strings stay resident after decoding.
- About 300 rows of `webkitScriptNames` and `webkitLocaleScripts` are read only through `localeScript`. Its result decides the Han locale swap and feeds two `canvas-language` tests.

### The lab port

- It duplicates `CJK_SYMBOLS`, `isCJKIdeographOrSymbol`, expansion counting, tab width and word spacing. This is by rule, since it may import only types.
- It is quadratic per box: `expansionShares` per code point, prefix strings per code point, and all of a leaf's boxes scanned per code point.

## 6. Line counts and rewrite estimate

| File | Lines now | Rewrite estimate |
|---|---:|---:|
| `index.ts` | 28 | 20 |
| `types.ts` | 189 | 130 |
| `style.ts` | 92 | 70 |
| `data.ts` | 198 | 140 |
| `measure.ts` | 259 | 200 |
| `breaks.ts` | 406 | 330 |
| `expansion.ts` | 190 | 110 |
| `content.ts` | 825 | 600 |
| `lines.ts` | 2,726 | 1,700 (see sections) |
| **Library total** | **4,913** | **about 3,300** |

Sections of `lines.ts` now:

| Section | Lines |
|---|---:|
| Line bookkeeping | 412 |
| Candidate content | 88 |
| Breaker | 392 |
| Simple builder | 241 |
| LineBuilder (incl. shaping, justify) | 617 |
| Output | 458 |
| Line rect and alignment | 85 |
| `lineGaps` | 183 |
| `webkitNextLine` | 146 |
| Header and helpers | about 100 |

- The rewrite estimate for `lines.ts` assumes `LineRun` as a tagged union, one shared commit and result path, one-pass fragments, and gaps evaluated per item.
- About 3,000 lines with a struct-of-arrays item model. About 60 lines for precomputed opportunity flags are included.
- Tests: `breaks.test.ts` 294, `lines.test.ts` 436, `test-paragraph.ts` 40.
- Lab: `webkit.ts` 479 (about 450 after a rewrite) and `webkit.test.ts` 174.
- Generated data: 457 lines, 644 KB.
- The floor is set by the verbatim ports:
  - `classify` (about 100 lines);
  - the scan (65);
  - `isComplexCodePath` (95);
  - `breakWord` (75);
  - the breaker (about 330);
  - `Line` append functions (about 250);
  - the bidi display tree (about 150);
  - gap conditions (about 150).
- The 151 WebKit rules in `tests/rules.json` cite browser source, not port function names, so restructuring is free.

## Observations for designers (not decisions)

1. WebKit's Canvas use is already lower than main's. The work to remove is JS, mostly gap reporting and outputs that are always built.
2. **An API question for the maintainer:** should gaps, fragments and display boxes be computed only on request? They must stay (charter tentpoles 1-3). The lab always asks for them.
3. The per-line state machine works over `(left, width)` of the current run with f32 sums. It can run over typed arrays: a Float32Array of stored widths and a flag per item for "opportunity after this item". It stays bit-exact and needs objects only for output.
4. A shared context and width store across paragraphs gives the same results in WebKit (`canvas.ts` header). It matters for chat lists: 2,104 calls against 4,777 for 200 messages in the smoke bench.
5. The simplified-measuring gap check is O(r) per line. Keeping the exact condition while bounding its cost needs a decision.
