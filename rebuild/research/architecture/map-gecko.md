# Gecko port map (rebuild/src/engines/gecko/** and rebuild/lab/observe/gecko.ts)

Paths below are under `/Users/chenglou/github/pretext-rebuild/rebuild/`. Short names `prepare.ts`, `lines.ts`, `linebreak.ts`, `likely.ts`, `props.ts`, `fonts.ts` and `types.ts` are in `src/engines/gecko/`.

Specs read against the code:
- `specs/gecko-canvas.md` §2-3
- `specs/gecko-lines.md` §4 and §9
- `specs/gecko-RESULTS.md` port and cost sections
- `DESIGN.md` §2.5-2.8 and §4.4-4.6

The port matches the spec pseudo-code closely. `breakAndMeasureText` and `reflowText` are near line-for-line.

## 0. Headline numbers

**Sources**
- Saved Firefox bench: `.artifacts/bench/smoke-20260917/firefox-bench.md`.
- Saved lab rows: `.artifacts/lab/gecko/r2-3/suite-sample-forward/firefox-rows.ndjson`, 19,888 rows.
- Offline bun prototypes with a stand-in Canvas, in the scratchpad `arch-plan/gecko/`: `count.ts`, `time.ts`, `rich.ts`, `likely-count.ts`, `rows.py`.
- The stub with synthetic kerning reproduces the real Firefox call count within 3%: 5,463 against the bench's 5,293.

**Latin** (Gatsby, 15,000 units, 320px, `overflow-wrap: break-word`, DPR 2, about 400 lines)

| Phase | Canvas calls | Notes |
|---|---:|---|
| prepare | 1,200 | main makes 1,247 in total |
| line filling | 4,263 | |

Line filling splits into:
- `characters()`, per-character geometry: 2,341 calls (55%).
- In-word suffixes in the break scan: 907.
- Gap-check prefixes: 523.
- Ligature ink boxes: 492.

Other Latin facts:
- The memo answered 17,015 further requests.
- With `overflow-wrap: normal`, `characters()` makes 3,252 of 3,412 line-phase calls (95%).
- Firefox bench: 11.4 ms against main's 3.94 ms cold.
- A 20-width sweep with one prepare took 97.9 ms against main's 7.16 ms.
  - That is about 4.6 ms of line filling per width, against main's 0.05 ms.

**CJK**
- Row `c-a580f4ad18b9ea2c`:
  - Input: 9,428 Chinese units in Songti SC 20px at 580px, 319 lines.
  - Result: 27,059 Canvas calls; `predictMs` 11,268 against `nativeMs` 5.
- Offline reproduction, 9,000 units of `zh-zhufu` with newlines kept:
  - 26,065 calls carrying 73.7 million characters to Canvas, 8,185 times the text.
  - 4.8 s of JS alone per pass.
  - 4.45 s even when every Canvas answer comes from the memo.

**Suite rows**
- 1.53 Canvas calls per source unit overall; median 1.74, p95 3.75.
- Requests including memo hits: median 4.0 per unit.
- Contexts per paragraph: median 3, max 8.
- `predictMs` sums to 15,058 ms, of which 11,268 ms is the one CJK row.

## 1. Data structures by stage

### Stage A: `prepareGecko` (prepare.ts:613-1342)

Runs once per paragraph. Everything here is independent of width and slot.

**Temporaries, dropped at return**
- `ContentIndex` from `indexContent`. Its facts are copied into the fields below.
- `Piece[]`, built before bidi and rebuilt after the bidi split (:690-818).
- `leafPieces`, `builds: RunBuild[]` with `flows`, and `breakerOps` (:871-886).
- `tr: TransformOut`, `g: Glyphs`, `runOfT`, `correction`.
- A `LineBreakerState` instance.
- Seven Map/Set helpers: `boundaryLeaves`, `elementPara`, `pieceOfRun`, `splitBeforeEvent`, `splitBeforePiece`, the `up` Set in `continuesAcross`, and one `scriptLimits` Set per run.

**Result: `GeckoPrepared` (types.ts:129-177)**

It lives as long as the `PreparedParagraph`.

- Per leaf, five parallel arrays: `runStarts`, `runStyles`, `runParents`, `runLangs`, `letterSpacingAu`.
  - They have the same lifetime and the same index, so one leaf record fits.
- Per frame: `frames: GeckoFrame[]` with `run`, source `[start, end)`, `level`, `textRun`, `[tStart, tEnd)`, `is8bit` and `item`.
  - `is8bit` is a copy of the leaf's.
  - `item` is a back-reference that is never read.
- `items: GeckoItem[]`: text, open, close, atomic, br and wbr in document order.
  - Bidi `split` opens and closes are included.
- `elements: GeckoElement[]` mixes spans with atomic, br and wbr.
  - A span holds `open`, `close`, `closes[]`, style, edges and three derived booleans.
  - `open` is never read after prepare.
  - An atomic, br or wbr element holds `item` and `level`.
  - `level` is mutated after construction, from the bidi pass (:758).
- `textRuns: GeckoTextRun[]` with context index, `scriptRuns`, `hasShy`, `trailingBreak`, `minTabAdvance`, `hyphenAu`, `hasTab`, `totalAdvance`, `pairKerning`, `is8bit` and `level`.
  - `is8bit` is unread after prepare.
  - `totalAdvance` is the last unit's `startAdvance + au`.
- Per transformed code unit:
  - `tUnits` (Uint16Array), `tSource`, `breakFlags`, `clusterStart`, `isSpace`, `kind`.
  - `spacingPrefix` and `correctionPrefix` (T+1 each), `unitOf`.
- Per source unit: `sourceT` and `nextT`, the inverse maps.
- `units: GeckoUnit[]`, the shaping units, with `kind`, `[tStart, tEnd)`, `canvasAu`, `au` and `startAdvance`.
  - `au` equals `canvasAu + correctionPrefix[tEnd] − correctionPrefix[tStart]`.
  - `startAdvance` is a prefix sum.
  - `kind` is read once, as `=== 'word'` at lines.ts:1468.
- Scalars:
  - `appUnitsPerDevPixel`, `blockStyle`, `tabWidth` and `textIndentAu` are derived from `paragraph` or `env`.
  - `bidi`, `gaps`.
  - `paragraph`, `text`.
  - `env`, which nothing after prepare reads.

**`GeckoStyle` (types.ts:7-18)** stores `collapse` and `wrap`, plus five booleans derived from them:
- `whiteSpaceIsSignificant`
- `newlineIsSignificant`
- `whitespaceCanHang`
- `isBreakSpaces`
- `wordCanWrap`, which also stands in for `overflow-wrap`

### Stage B: one line, `nextGeckoLine` (lines.ts:898-912)

Depends on the slot and the line start. All of it is created per call and dropped after `lineOutput`.

**Per line**
- `Band` (:655).
- `LineGaps`.

**Per pass**
- `LineLayout` plus a root `SpanData`.
- One `SpanData` per open span.
- A `Placed` union node per placed frame (:345-387).

**Per text-frame reflow**
- `FrameResult`, 22 fields (:398-427). Several are derivable: `tEnd`, `width`, `incomplete`, `endsInNewline`.
- `Provider`, which always allocates `tabs: new Map()` (:552).
- A `Measured`.
- `Status` objects, re-spread at :736, :811 and :838.
- Under justify: a `computeJustification` result with one `{start, end}` object per transformed character (:472).
  - Only `.info` is kept.
  - `justificationSpacing` (:1166) builds it again for the placed frame.

**Redo**
- The redo (:887-891) rebuilds the whole tree.
- It is rare in practice. A 898-leaf alternating regular/bold paragraph produced 0 redos in 401 lines, because a frame can break at its own offset 0.
- Only a span boundary in the middle of a word triggers it.

**`lineOutput` (:1187-1479), per line**
- Four Maps keyed by object or id: `geometryOf`, `spansOf`, `relative`, `remaining`.
- Two Sets keyed by source offset: `trimmed`, `hanging`.
- `placedByItem`.
- A `GeckoFrameGeometry` per frame.
- One `GeckoCharacter` object per source unit.
- `Fragment[]` with `painted` strings built one character at a time (:1452-1453).
- It mutates the pass result in place: trimming, justification, positions.

**`GeckoLineStart` (types.ts:184-189)**
- Holds `{frame (an item index), contentOffset, isFirstLine}`.
- It is tiny and independent of width.
- Any line can be laid out from a saved start at any width.

### Stage C: Measurer (`src/measure/canvas.ts`)

Created per `prepareParagraph`; lives with the prepared paragraph.
- `keys`: a Map from eight settings joined into one string to a context index.
- `contexts`: one OffscreenCanvas each.
- `memo`: a Map from text to width per context, never evicted.
- `log.calls`: every call's text and width, kept for the prepared paragraph's whole life.
- For the 9,000-unit CJK case the memo keys alone are on the order of 100 MB.
- There is also a module-level `ligatureMemo: WeakMap<Measurer, Map<"ctx pair", boolean>>` (lines.ts:61).

### Width-independent facts that stage B recomputes

- In-word advance before `t`, with its gap check and ligature test.
- `isJustifiableCharacter` and cluster assignments.
- `isTrimmableChar` runs.
- `hasSoftHyphenBefore`.
- Whether a text node is white space only (:1057).
- Newline positions (:524).
- The span chain at a start (`openSpansAt`).
- Painted text.

**Truly dependent on width or slot**
- The available width, `band.iSize`.
- Text-indent on the first line.
- `impactedByFloats`.
- Tab stops, which read the x distance from the block edge and so the slot's left inset.
- All positions.

**Do not feed back into break decisions**
- Justification, trimming deltas, bidi reorder, fragments, characters.
- Only `ll.lineIsEmpty` reaches the next start.

## 2. Canvas measurement flow

### Context settings (prepare.ts:1140-1145)

- `font = canvasFont(font, size)`.
- `lang` is the run's canonical tag, or `regionalPrefsLocale` for `lang=""`.
- `letterSpacing` is `'0.001px'` when the run has letter spacing, which turns ligatures off; else `'0px'`.
- `wordSpacing` is `0`; kerning and rendering are `auto`.
- `direction` comes from the run's level.
- `partition` is `''`.

Other contexts:
- The same settings at the device size, `domAu/apd` (:1204).
  - Created for every word of a 16-bit run when DPR ≠ 1.
  - Created whether or not the run holds an emoji or a synthesized space.
- `"Apple Color Emoji"` at the CSS and device sizes (:1205).
- The block's font, for tab width (:1298).
- The run's settings with `letterSpacing: '0.001px'`, for `ligatureAcross` (lines.ts:56).
- The alternating regular/bold paragraph made 6 contexts.
- The 200-message bench made 318 contexts. A shared measurer made 3.

### Strings measured in prepare (:1113-1291)

- Each word unit through `rangeAu` (:500-522).
  - Either the piece alone, or a two-call script-context recipe `w(ctx + ' ' + piece) − w(ctx + ' ')`.
  - Or a prefix recipe after an invalid character.
- `' '` or NBSP per boundary space. The memo cuts this to one call.
- The `space-in-shaping` check (`endStretch`, :1158-1169) measures the whole stretch between invalid characters as one string.
  - For Gatsby that is a single 15,000-character call.
  - Prepare sends 22,570 characters to Canvas for 7,570 characters of units.
  - So every character is shaped twice.
- `'0'` for tab runs; U+2010 for soft-hyphen runs.
- The emoji path (:1195-1273), per grapheme cluster with Emoji presentation:
  - Digits, `#`, `*`, ©, ® count too, since they are `text-default`.
  - Up to four width calls and two `measureTextBounds`.
  - `measureTextBounds` is not memoized.

### Strings measured while filling lines

All go through `glyphBefore(t)` (lines.ts:68-122), which returns the advance before an offset inside a unit.

- The suffix `unit[t..end)`.
- The prefix `unit[start..t)`. Where it is measured:
  - While the line's `inWordReported` is false: for the gap check (:97).
  - On the reversed path (:108), where it is the advance itself.
  - For `pairKerning: 'split'`, where it is asked a second time (:117).
- `ligatureAcross`: two ink-box calls for a cluster pair, in two contexts.
- Offsets at unit starts are free.

### Where the same text is measured more than once

1. **Every in-word offset re-shapes the whole unit.**
   - A prefix plus a suffix add up to U characters.
   - Offsets consulted over a unit's life are O(U).
   - Characters shaped are therefore O(U²).

2. **Breaks inside words.** Each of these measures suffix, prefix and two ink boxes:
   - Every character of each line's first word, until a normal break is seen.
     - This applies under `overflow-wrap: break-word` or `anywhere`, because `wordWrapping` holds while `breakPriority <= WORD_WRAP_BREAK` (:274-275).
   - Every break in CJK or `break-all` text.
   - Every hyphen break.

3. **`scanAdvance(pending, i)` (:279)** asks for each opportunity's offset twice:
   - Once as `b`, then again as the next range's `a`.
   - The trimmable range (:280) can ask again.
   - `advanceWidth` (:334) asks once more for the fitted range.

4. **`characters()` (:917-934).**
   - It calls `glyphBefore(t + 1)` for every source unit of every placed frame.
   - That is one suffix string per in-word character.
   - It made 9,975 requests for the 15,000-unit corpus.
   - It is the largest single consumer.

5. **The redo pass** repeats a line's requests. It is rare.

6. **Memo hits are not free.**
   - `rangeAu` builds the string with `+=` per character.
   - It runs `scriptContextFor`, which itemizes the piece again (:474).
   - All of that happens before the lookup, so a hit still costs O(length).
   - Observed: 17,015 hits against 5,463 misses.

## 3. Repeated or wasted work

Here n is the paragraph length, L the line count, and U the longest shaping unit. U is about word length for spaced scripts. For CJK it is about n, because segment breaks between wide characters are removed (prepare.ts:180-181) and spaceless scripts have no boundary spaces.

**The dominant problem: in-word advances**
- O(U) work per consult.
- O(U²) characters to Canvas and into string keys per unit.
- The same again in JS on every later pass.

**Line filling**
- `characters()` is O(Σ word length²) in string building per layout, on every line. Only the lab reads it.
- Under justify:
  - `computeJustification` runs twice per frame per line, allocating an object per character (:472).
  - `participatesInJustification` scans the text node (:1057).
- `p.text.indexOf('\n', offset)` (:524) scans past the frame to the end of the whole text.
  - With newline-significant white space and no newline, that is O(n) per reflow, so O(L·n).
- `computeTabs` (:208-223) runs up to the end of the frame's remaining content, not the line's end.
  - `rangeAdvance` loops over every tab per range (:192).
  - For a long preformatted source line wrapped onto k lines that is O(k²) tabs.
- `runOf` (:1396) scans the leaves from 0 on each call.
  - It is called per collapsed stretch through `pushCollapsed`.
  - Cost is O(leaves) per call, which matters for rich text with hundreds of leaves.
  - prepare.ts:1332 does the same per U+2007 or U+2008.
- `reflowSpan` scans `el.closes` linearly (:795).
- Per-line allocation: about 10 Maps and Sets, plus objects per frame, per character and per fragment.
  - JS-only cost in bun is 11 µs per line for Latin.
  - It drops to 7.3 µs without characters.
  - It drops to 4.2 µs without characters and gap checks.

**Prepare duplicates**
- The script itemizer runs twice per non-Latin run: `initTextRun` (:535) and `textRunScripts` (:1149).
  - It runs again per measured piece (:474).
- The shaping-unit split is derived twice with the same predicates: `splitAndInitTextRun` (:311-343) and the measure loop (:1170-1192).
- `graphemeBoundaries(word)` runs twice for 16-bit words at DPR ≠ 1 (:271, :1208).
- `fastLatin` is written twice (:364-366, :433-434), and so is the all-common-or-Latin scan (:445-446, :530-531).
- The device-size context key is built per word (:1204).

**nsLineBreaker**
- `scriptIsChineseOrJapanese(lang)` parses the tag and walks the trie per word (linebreak.ts:414). It costs 0.18 µs, so not hot, but the fact is per leaf.
- `String.fromCharCode(...this.word)` (linebreak.ts:386) spreads a whole word. A spaceless run of several hundred thousand units would overflow the argument limit.
- `new Intl.Segmenter` is created per complex slice (linebreak.ts:50).

**Prototype: a per-paragraph table of in-word advances**
- Patched into the scratch copy of lines.ts as a lazily filled `Float64Array(T+1)` plus the gap detail per index.
- Line output was byte-identical, by SHA-1 of every line's JSON.

| Measure | Latin | CJK, 9,000 units |
|---|---|---|
| Warm pass before | 3.9 ms | 4,453 ms |
| Warm pass after | 1.1 ms (0.7 ms without characters) | 1.3 ms |
| Cold pass after | not measured | 1.8 s of JS, plus the quadratic Canvas strings |

- The table does not fix the cold pass; the measuring recipe itself needs a design decision.
- Any recipe change is a correctness change and needs a replay against saved rows.
- The port's assumption today: the suffix shapes alone as it does in context.
- Its gap check is the identity W(prefix) + W(suffix) = W(unit) at the offset.

## 4. Behaviour differences woven through conditionals

**Direction**
- In prepare.ts:
  - `rtlBlock` at :653.
  - The `swap` test at :927.
  - The run's context direction at :1143.
- In lines.ts:
  - `bandOf` :661-662.
  - `shapedReversed` :139.
  - `trimFrom` :1022 and `hangFrom` :1038.
  - The align switch :1231-1232.
  - `place()` :1336 and :1347; the visual order walk :1354.
- In lab/observe/gecko.ts: :86, :117 and :151-157.
- Bidi positions against logical positions is one explicit fork (lines.ts:1300). That mirrors Gecko and is fine.

**White-space mode**
- It is modeled once, in `geckoStyle()`.
- Its predicates are then read at about 20 sites across both files, as Gecko does.
- `breakAndMeasureText` takes six positional mode parameters (:246-248) instead of the style.

**8-bit against 16-bit storage**
- It threads through:
  - `transformFlow`
  - `isTrimmableChar`
  - `splitAndInitTextRun`
  - `textRunScripts`
  - the measure loop
  - `isJustifiableCharacter`
  - `appendText`
- It is stored on the leaf, the frame, the build and the text run.

**Justify**
- `paragraph.textAlign === 'justify'` is tested in `reflowText` (:596, :623), `justificationSpacing` (:1160) and `lineOutput` (:1201-1217).
- None of it affects breaks, so it belongs wholly to the geometry stage.

**"Is Chinese or Japanese"**
- There are three distinct tests, each a different Gecko rule:
  - A tag-prefix test in `transformFlow` (:148).
  - Likely-subtags in the line breaker.
  - A prefix test per justification call (lines.ts:467-468).
- Each parses the string again.

**Shared code that knows the engine**
- `src/index.ts`: five switches and static imports of all three engines.
- `src/model.ts`: holds the Gecko geometry types and imports `GeckoLineStart`.
- `src/breaks/tables.ts`, `src/unicode/grapheme.ts`, `src/unicode/bidi.ts`:
  - They switch on the engine name.
  - They statically import every engine's generated data.
  - A Firefox bundle therefore carries Blink's 586 KB and WebKit's 644 KB tables.
  - Gecko's own data is about 260 KB.
- `src/paint.ts`: :103 and :312.
- `measure/canvas.ts`: `partition` exists for Blink.
- Gecko's lines.ts ports HarfBuzz direction and joining rules (:104-174).
  - It cites Chromium 152's copy.
  - Blink has its own version in `engines/blink/shape.ts`.

## 5. Guide violations worth fixing

**Caches and memo maps**
- `Measurer.memo`, string-keyed and unbounded.
- `Measurer.keys`, an eight-part joined string key.
- `ligatureMemo`: a WeakMap of Maps keyed by `` `${context} ${pair}` ``.
- The lab's `MeasureLog` is retained inside every prepared paragraph.
- Both memos should become width-independent per-index tables owned by the prepared paragraph.

**Map/Set where an array or field fits**

prepare.ts:
- `boundaryLeaves` (:692), at most two entries.
- `elementPara` (:738).
- `pieceOfRun` (:777).
- `splitBeforeEvent` and `splitBeforePiece` (:825-826); the latter is a Set of objects.
- `up` (:921).
- `scriptLimits` (:1152).

lines.ts:
- `RTL_SCRIPTS` and `BIDIRECTIONAL_SCRIPTS`, string Sets (:126-129).
- `tabs` (:552).
- The justification Map (:1176).
- `geometryOf`, `spansOf`, `relative`, `remaining`, `trimmed`, `hanging`, `placedByItem` (:1243-1375).

likely.ts: four alias Maps (:316-319).

Follow-ons:
- Default-value reads follow from the Maps: `?? 0` at lines.ts:929 and `?? -2` at prepare.ts:855.
- Scripts and general categories are strings compared by value; the generated table already has indices.

**Mixed collection**
- `elements` is heterogeneous and indexed by items that already know the kind.
- That needs 17 `as Extract<…>` casts, 7 in prepare.ts and 10 in lines.ts.
- It also needs a throw at lines.ts:728.
- Splitting it into spans, plus leaf data carried on the item, removes them.

**Derived data stored as fields**
- `GeckoStyle`'s five booleans.
- `GeckoUnit.au` and `startAdvance`; `GeckoTextRun.totalAdvance`.
- The derivable `FrameResult` fields.
- `PlacedText.justification` as a spread copy (:773).
- `appUnitsPerDevPixel`, `textIndentAu`, `blockStyle`.

**Denormalized copies**
- `is8bit` in four places.
- `frame.item` and `item.frame`.
- The five per-leaf parallel arrays.
- `paragraph`, `text` and `env` on `GeckoPrepared`.

**Unions encoded as flags or sentinels**
- `Status` is three booleans, read through if-chains at lines.ts:731-751.
- `FrameResult.status` is a string plus `incomplete`, converted to `Status` at :778. That is two representations of one fact.
- `Measured.lastBreak` uses -1 and -2.
- `forceBreak` uses -1.
- `AFTER_CONTENT` is 0x7fffffff.
- `Status | 'redo-next-band'`.

**Strings re-parsed or rebuilt**
- The language tag (see §4).
- `parseFamilyList` runs per frame pair, with a regex per character (fonts.ts:119-122).
- `hasScript` does a `split(' ')` per call (props.ts:115-117).
- `openingMirror` is a linear scan (props.ts:119-122).
- 14 `String.fromCharCode` rebuilds from `tUnits`. One transformed string, sliced, would replace `tUnits`.

**Iterator chains and for-of**
- lines.ts:192 and :1318.
- linebreak.ts:51.
- likely.ts:320 (`split` then `map` then `split`).
- In lab/observe/gecko.ts: `map`, `sort` and `for…of`.

**Exceptions**
- All four throws in lines.ts are invariant panics, which is fine.
- `UnportedFeature` is unused by Gecko.

**Glue and dead code**
- `scanAdvance` and `advanceWidth` are aliases of `rangeAdvance` (lines.ts:198-205).
- `export { BREAK_NORMAL }` has no importer (prepare.ts:1355, import at :15).
- `primaryFamilyOf` has no reader (fonts.ts:125-129).
- `isEmojiModifier` has no reader (props.ts:51).
- Generated ExtPict (bit 13) and EMod (bit 16) are unread.
- Unread fields:
  - `GeckoPrepared.env`
  - `GeckoFrame.item`
  - `GeckoTextRun.is8bit`
  - the span's `open`

**likely.ts**
- 478 lines plus a 143 KB table answer one boolean per tag.
- 41 of 7,527 likely-subtag entries carry Hans, Hant, Jpan or Hrkt.
- A generated answer set could replace the trie port.
  - The generator would have to fold in the alias tables too.
  - The rule and citation are unchanged.

## 6. Line counts and rewrite estimate

| File | Total | Code | Comment |
|---|---:|---:|---:|
| prepare.ts | 1,355 | 1,148 | 160 |
| lines.ts | 1,489 | 1,235 | 192 |
| linebreak.ts | 506 | 439 | 40 |
| likely.ts | 478 | 414 | 31 |
| types.ts | 189 | 110 | 68 |
| props.ts | 141 | 108 | 12 |
| fonts.ts | 141 | 112 | 20 |
| index.ts | 32 | 21 | 7 |
| Source total | 4,331 | 3,587 | 530 |
| generated/props.ts | 12 lines, 62 KB | | |
| generated/likely-subtags.ts | 11 lines, 143 KB | | |
| Tests: gecko, likely, props | 645 + 112 + 57 | | |
| lab/observe/gecko.ts | 224 | 178 | 32 |

**Estimate for the same behaviour written fresh, with every rule, citation and gap kept**

- prepare: about 1,000 code lines.
  - One transformed string.
  - One shaping-unit pass that also sets glyph flags.
  - Leaf records; arrays instead of Maps.
- lines: about 1,050-1,100 code lines.
  - A break pass separate from on-demand geometry.
  - One status union.
  - No aliases, Maps or casts.
- linebreak: about 400, already a tight port.
- likely: about 150 with a generated answer table, else about 400.
- props, fonts, types and index: about 310.
- Total: about 2,950-3,250 code lines plus about 530 comment lines.
  - That is 3,600-3,900 in all, against 4,331 today: 10-17% smaller.
- The Gecko port is mostly rule text, so the gain is in work done rather than lines:
  - Per-character geometry, fragments and justification spacing move to on-demand functions over a placed line.
  - In-word advances and their checks become per-index tables.
  - The per-paragraph memo and log leave the library's core.
- lab/observe/gecko.ts stays about 200 lines.
  - It needs only an accessor for a frame's characters if they become on-demand.

## 7. Stage facts for designers

**Break decisions**
- They read, per opportunity: a prefix advance, a trailing-space advance, a hyphen width and a priority.
- All of those are width-independent.
- The fit test is `width + hyphenated − trimmable <= avail`, in integers.
- Negative spacing or kerning makes prefix sums non-monotonic. A linear scan over a line's opportunities is safe; a binary search is not.

**What to keep lazy**
- In-word opportunities should stay lazy.
- Under `break-word` they are consulted only until a line's first normal break.
- Default CSS (`overflow-wrap: normal`) needs almost none: 160 calls for the corpus.

**Cost without the geometry pass**
- With `characters()` out of the default path:
  - Rebuild Canvas calls for Latin text under default CSS come to about 1,360, against main's 1,247.
  - The remaining cost is JS per line.
