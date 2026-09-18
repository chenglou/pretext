# Critique of the target architecture and migration plan

Read-only review, 2026-09-17. Code paths are under `~/github/pretext-rebuild/rebuild/` at bc49b0e, where `src` is clean in the working tree. No browser ran and nothing under pretext-rebuild was touched. Four small offline runs used scratch copies (§6).

Sources:
- **read**: I read the code.
- **offline**: bun with a stand-in Canvas on a scratch copy.
- **bench**: `.artifacts/bench/smoke-20260917`, a stale background run.

## 1. Verdict

The base holds. The plan's two stages are the engines' own. Every port already has the seam between filling a line, checking gaps and building output. The per-offset tables mirror data the engines keep themselves (Blink's `CachedPositionForOffset`, Gecko's glyph advances). The tables are therefore the port, not an added cache.

As written the plan isn't executable:
- Three decided-line records are incomplete.
- Two gates contradict the plan's own routing of measurements.
- One promise is false in Chrome in a way no current gate can see.
- The cross-paragraph string store lands before the profiling that should justify it.
- The default path returns less than charter tentpole 1 asks for.

## 2. Load-bearing claims, checked by reading

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The line width is read at five sites, all at line time | True | `blink/line-breaker.ts:145`, `blink/index.ts:1228`, `webkit/lines.ts:2345`, `:2692`, `gecko/lines.ts:658`. The only other reads are `paint.ts:179`, `:212`. `text-indent` is px only (`model.ts:167-170`). |
| 2 | Every port fills a line, then checks gaps, then builds output | True, with three leaks (A1, A2, A5) | `blink/index.ts:1222-1232`, `webkit/lines.ts:2667-2725`, `gecko/lines.ts:898-912` |
| 3 | Inside a position computation only `joinedAtEdge` raises gaps | True, and those gaps don't depend on any measurement (B1) | The other `addGap` sites in `blink/shape.ts` are prepare (`:453`, `:459`, `:542`, `:555`) or not table-backed (`:748`, `:884-888`, `:922`, `:933`). |
| 4 | A memo hit builds its string first | True | `canvas.ts:75-86`. `measure16` builds `canvasString` at `shape.ts:304` before `raw16Of` at `:306`. |
| 5 | Blink rescans ICU to the end of the text from every line start | True | `blink/breaks.ts:134-168`. It also allocates `Uint8Array(text.length + 1)` per line at `:139` and `:205`. |
| 6 | `applyJustification` writes into the item results | True | `blink/index.ts:746-749`. `hangWidthOf` then reads `r.inlineSize` (`:512`, `:520`), so call order changes the hang. |
| 7 | `scriptsPerUnit` is discarded at letter spacing 0 | True | `shape.ts:307`. Its only read, `:318`, comes before `if (ls16 === 0) continue` at `:319`. |
| 8 | The second `pairAdjust16` at a cut can reuse the first | True | `shape.ts:511` and `:513` make the same call. The gaps it raises are idempotent through `addGap` (`gaps.ts:9-24`). |
| 9 | Gecko's stretch measure writes nothing but the gap | True | `gecko/prepare.ts:1158-1169` |
| 10 | The WebKit last-line flag only goes false, so a `break` is safe | True | `webkit/lines.ts:1785`. `isContentfulItem` (`:1705-1720`) is pure. |
| 11 | The measurer is per paragraph, and every bundle carries every engine | True | `src/index.ts:40`, `:3-9`, `breaks/tables.ts:5-7`, `unicode/grapheme.ts:17-22` |
| 12 | `UnportedFeature` is never thrown, and rbbi's rule status is unread | True | The only other mention is the re-export at `src/index.ts:29`. `ruleStatus()` has no caller. |

The plan contradicts itself on Chrome contexts for 200 messages:
- §1 says 400 canvases. That comes from the stale bench at c51065a, which logs 2 contexts per paragraph.
- Step 3 says 800. Today's code makes 4 distinct contexts per LTR style at letter spacing 0 (`shape.ts:81-89`; the hyphen context dedupes with `ltr`), so 800 is today's number.

## 3. Where correctness or a gate would move

**A1. WebKit's decided line is missing the gaps raised while filling.**
- The plan's record is the run list plus `{ measuredEnd, reverted, decisionStart, overflowStart, placedEnd }`, "exactly what `lineGaps` reads".
- `lineGaps` also reads `L.gaps`. Its `add` returns early when the list already holds the same gap name and run (`webkit/lines.ts:2412`).
- Three fill-time sites push first:
  - `hyphen-glyph` (`:91-92`);
  - `string-storage` at an emergency break (`:694-695`);
  - `rtl-shaping-across-inline-boxes` (`:1522-1523`).
- A fill-time `string-storage` on a run suppresses the keep-all one at `:2438`, which has another detail and range.
- *Corrected:* the record carries the fill's gap list in order, and `inspectLine` seeds `lineGaps` with it.

**A2. Gecko's `consulted` list can't rebuild the line's gaps.**
- `gecko/lines.ts:567` pushes `font-fallback` into the same list between frames' scans, with no dedupe.
- Both passes of a redo share the list (`:887-891`, `:900-901`), so a redo can push it twice.
- Its position relative to the in-word report depends on which frame reported first.
- *Corrected:* the decision keeps one ordered event list across both passes: the consulted in-word offsets and the emergency-hyphen offsets of `:566-567`. `inspectLine` walks it. It checks consulted offsets until the first report and emits the `:567` gaps where they sit.

**A3. "Identical Canvas call sequence" can't hold for WebKit.** The plan missed gap-only Canvas calls:
- In prepare: a LastResort canvas and one call per code point (`webkit/content.ts:266`, `:274`).
  - They feed only `unverifiedCoverage`, which is read only at `lines.ts:2474-2483`.
  - They are interleaved with the calls at `:272-273` that do decide `simplifiedMeasuring`.
- In fill: `hyphenGlyphsDiffer` measures `-` only to report a gap (`lines.ts:91`).

Moving them reorders calls. Keeping them leaves gap-only calls on the default path for fixed-pitch text, which means code blocks.
- *Corrected:* gate 3 compares the sequence for Blink only, the one engine with a first-wins cache. It compares the multiset of (context, text) for WebKit and Gecko, which replay already tolerates. Then move all three sites behind `paragraphGaps` and `inspectLine`.

**A4. "Space, plain-space and hyphen widths as fields" adds calls.**
- Today they are measured on demand (`webkit/measure.ts:29-41`), the hyphen only when a soft-hyphen break is tried.
- A field filled in prepare measures `‐` for every box, so replay (gate 4) throws on a miss.
- A nullable field filled lazily is what the guide's nullability section warns against.
- *Corrected:* leave them as `measureShared` reads at the use sites.

**A5. "A candidate's width travels to commit" is safe only off the TAB path.**
- `left` is read only by `tabbedWidth` (`webkit/measure.ts:123-126`). For every other item, `measuredItemWidth` already returns the stored width (`lines.ts:1023`).
- For a TAB-holding item, the candidate measures at `f32(lastRunLogicalRight + candidateWidth)` (`:1185`), and the commit measures at `lastRunLogicalRight` after the appends (`:1102`).
- These are different float32 expressions once the last run doesn't start at 0 (`:161-164`, `:341-346`).
- Offline, the development sets never exercise it: 0 of 1,528 lines in 411 TAB cases measured one range at two positions. No gate would notice a change.
- *Corrected:* carry the width only when the item isn't on the TAB path. Keep both measurements there, as WebKit does.

**A6. "A second pass at the same width makes no Canvas call" contradicts the measurement routing.**
- §5 sends WebKit's `breakWord` probes to `measure`, which always calls Canvas, and §6 gives WebKit no table.
- Blink reshapes with their own call edges are "not in a table" (`shape.ts:698`, `:862-894`).
- Once step 3 deletes the memo, every split word and every reshape calls Canvas again on every pass. That also puts Canvas calls into resize frames for URL-heavy chat.
- WebKit's fact belongs to a range, not an offset: each probe measures `[item start, end)`, and a partial leading item shifts the start (`lines.ts:2601`, `measure.ts:180`).
- *Corrected:* make the routing structural:
  - strings measured once per prepared paragraph go to `measure`;
  - every line-time string without a table goes to `measureShared`;
  - for WebKit, use a per-prepared memo keyed by integers `(box, from, to)`, so a hit builds no string.
- This also removes "short reshapes", which is the length test §8 rejects.

**A7. "Its value doesn't depend on who asked first" is false in Chrome, and no gate can see it.**
- A one-byte string and a forced two-byte string with the same characters share Chrome's cache key, and the first shaping wins (`specs/blink-canvas.md:358`).
- `canvasString` builds both kinds on one '16bit' canvas (`shape.ts:279-284`, `blink/index.ts:1191`).
- With tables filled on first read, "first" depends on which widths the app laid out earlier. With a shared measurer, it depends on which paragraphs came earlier.
- Offline over 25,505 development cases:
  - 60 cases measure a forced two-byte string;
  - 0 have the one-byte string of the same content in their own paragraph;
  - with one measurer across all cases, exactly one pair exists: `100000000000000000000000` in 32px Geeza Pro, lang `ar`.
- So the tables are safe against every row the gates hold, and step 3's three-order run decides nothing about the hazard.
- A failing case is constructible: `shape.ts:231-233` records Amiri's `((` at 2814 units under Arabic and 1567 as Latin.
- *Corrected:*
  1. Add a rule family: the same 13-unit bracket or digit string, once inside an Arabic run and once inside a Latin run of a segmented paragraph, in Amiri.
  2. Land §13 D (canvas by the string's own storage class) before step 3, not after the migration.
  3. Extend gate 11 for Chrome. Lay each case out at three widths on one prepared paragraph, in two width orders. Compare lines and `lineWidth` with fresh prepares.
- Known effects this does not touch:
  - Gecko's emoji fallback pinning (`gecko/prepare.ts:1196-1202`) is insensitive to the deferral, because every deferred string is a substring of a unit prepare already measured.
  - Blink's opsz platform font is process-wide (`specs/blink-canvas.md:372`).

**A8. Blink's lazy ICU scan has no offline coverage for dictionary text.**
- `env.ts:131` gives `unavailable` in bun, so `breaks.ts:147-159` never runs in the differential.
- Replay excludes Thai, Lao, Khmer and Myanmar cases.
- *Corrected:*
  - The differential installs a stand-in `Intl.v8BreakIterator` over bun's `Intl.Segmenter`. It compares old against new, so any deterministic answer serves.
  - The rewrite keeps `adoptText` on today's string (`breaks.ts:153`).

**A9. Rows persist fields the plan deletes.**
- `lab/page.ts:391` stores `layout.lines` whole. That includes `next.engine` (`blink/index.ts:1219`), `slot` (`model.ts:254`) and the per-line `layoutZoom` (`blink/index.ts:1104`).
- Byte equality in gate 8 would make `lab/predictor.ts` rebuild dead fields forever. That is glue.
- *Corrected:* `tools/layout-diff.ts` compares through one normalizing projection applied to both sides, and new rows carry the new shape under a row-format version.

**A10. Adding `engines/*/types.ts` to the contract set loosens the independence test.**
- Those files also hold internal types. Today the contract set is `{ model.ts, env.ts }` (`tests/independence.test.ts:11`).
- *Corrected:* one types-only file per engine, for example `engines/<engine>/geometry.ts`, joins the contract set.

**A11. A varying `slot.width` has no gate.** The lab's slots vary insets at one width.
- *Corrected:* an offline invariant. `breakLine(start, { width: w, left: 0, right: 0 })` equals the line a paragraph of width `w` gives from the same start.
- Also, `layoutLines(pretext, prepared, width, slots)` states the width twice. Pass the slot for rows past the list instead.

## 4. Against the engineering guide

**B1. Avoid derived state: Blink's `raised` arrays store something derivable.**
- `joinedAtEdge` (`shape.ts:163-177`) reads only `joinsAcross` and `style.joining`.
- The gaps of a table-backed read are a pure function of `(group, k)`:
  - whether the pair window reaches the group start or end (`:388-391`);
  - whether the prefix starts at the group start (`:513`).
- The five orders fall out of running those conditions in code order.
- *Corrected:*
  - Split `joinedAtEdge`'s condition from the measurement.
  - Keep two per-group facts from prepare: what the start edge and the end edge raise.
  - Let a hit run the conditions only when either fact is set, which means never for text without joining letters at a group edge.
- This removes the `raised` arrays, the order code and the list fallback. I did not prototype it; the offline differential checks it.

**B2. Fewer structures and lifetimes.**
- Groups are disjoint and ordered (`blink/index.ts:33-63`), and `continuations` is already per paragraph (`:1197`).
- *Corrected:* one set of tables per paragraph, indexed by text offset and allocated in prepare, with a `Uint8Array` filled mask so there is no NaN fill. Drop the three arrays per group allocated on first miss.

**B3. Avoid caching, cater to the worst case: the cross-paragraph string store lands before the profiling that should justify it.**
- It is a new text-keyed cache whose worst case is a full clear at the cap.
- Bench, 200 messages:

| Browser | Time, measurer per paragraph → shared | Canvas calls |
|---|---|---|
| Chrome | 217.4 → 207.1 ms (−4.8%) | 47,455 → 24,171 |
| Firefox | 37.3 → 28.4 ms | 22,010 → 8,807 |
| WebKit | 11.56 → 10.76 ms | 4,777 → 2,104 |

- An avoided call is worth about 0.45, 0.67 and 0.30 µs, fewer canvases included. In Chrome the cost today is JS, not calls.
- *Corrected:*
  - Step 3 shares contexts only.
  - Profile after step 2.
  - Add the store only if the numbers ask for it.
  - A7's fix D and A6's per-prepared memos come first.
  - Report time at each step's exit, not only calls.

**B4. Map and Set last, in the rewrite, not after profiling.**
- `gecko/lines.ts` has 12 `new Map`/`new Set` and `prepare.ts` has 7. The plan defers them to §12.5.
- *Corrected*, in Gecko step 2 item 4:
  - `Provider.tabs` becomes a sorted array, since `computeTabs` scans forward (`lines.ts:208-222`);
  - `scriptLimits` becomes a moving index over `run.scriptRuns` (`prepare.ts:1152-1153`, `:1188`).

**B5. Keep tooling out of the library.**
- The plan's replay needs no library code, so recording doesn't either. `lab/page.ts` can wrap `measureText` on the contexts it sees.
- *Corrected:* `calls`, `hits` and `onCall` leave `Measurer`.
- `layoutLines` with refusals is the lab's float-row protocol (`src/index.ts:116-138`, DESIGN §2.9 "The lab protocol"). Move it to `lab/`. The library keeps `countLines`.

**B6. `isDelimiterQuote`.** Derive the code point list once at module load from `webkitDelimiters`, not by hand (`webkit/data.ts:115-120`). After the facts move it runs on the lab path only.

**B7. Two small notes.**
- Step 1's engine wrappers are acceptable, because they are code that runs.
- The bivariant `Pretext` type plus dropped `engine` tags removes today's runtime check (`src/index.ts:57-59`, `:66`). Keep the tag on `Prepared` for processes that load two engines.

**Checked and dismissed.**
- I checked whether to move per-style resolution onto the measurer. Offline it costs 0.6 µs per style per prepare, 1–6% of a small Blink prepare. It isn't worth a lifetime change.
- Parsing every Blink table at import takes 2.3 ms offline, so "no lazy slots" is fine.

## 5. Against the charter

**C1. Tentpole 1.**
- The default path returns a CSS-px `lineWidth`, and fragments carry no widths (`model.ts:190-193`).
- Item, box and frame positions exist only behind `inspectLine`, together with clusters and gap checks.
- Main's rich inline API gives apps per-fragment widths (`~/github/pretext/src/rich-inline.ts:58-66`).
- *Corrected:* add `lineGeometry(prepared, line)`. It returns the engine's items, boxes or frames in its own units, without clusters, characters or gaps.
- `inspectLine` composes it in today's order, so the lab's Canvas sequence doesn't move. The per-item values come from the decision itself.

**C2. Tentpole 3.**
- §13 B's fallback, "a greedy forward cut near 200 px … if this loses rows", chooses by lab score.
- It also moved `joining-technology` gaps in 4 of 80 outputs.
- *Corrected:* state the acceptance rule from source before running:
  - cuts only beside a space that passes the safe test, the case `shape.ts:425-431` argues;
  - lost rows are triaged, not tuned.

**C3. Charter text.** Tentpoles 1 and 3 (gaps on request) and the `contentLanguage` line need the edits the plan already flags.

## 6. Offline runs made for this review

Scratch: `<scratch>/arch-plan/critique/`

| File | What it found |
|---|---|
| `twins.ts` | Storage-class pairs over the five development case files (A7). |
| `tabs.ts`, `tab-synth.ts` | TAB ranges measured at two positions: none (A5). |
| `parse-all.ts` | Six Blink tables parse in 2.3 ms. |
| `style-cost.ts` | Per-style prepare work takes 0.6 µs. |

## 7. Corrected order

0. Step 0 as planned, plus:
   - the stand-in `v8BreakIterator` (A8);
   - the normalizing layout diff (A9);
   - the bracket family (A7);
   - the `slot.width` invariant (A11);
   - gate 3 split by engine (A3).
   - Serialize the offline differential across owners, since it is a sweep.
1. Step 1 as planned, with:
   - geometry types in their own contract file (A10);
   - `lineGeometry` in the API (C1);
   - `layoutLines` and the counters in the lab (B5).
2. Step 2 per engine, with:
   - the complete decision records (A1, A2);
   - the structural measurement routing (A6);
   - derived Blink edge gaps and per-paragraph tables (B1, B2);
   - the TAB exception (A5);
   - no constant fields (A4);
   - Gecko's Maps and Sets replaced (B4).
3. §13 D in Chrome, then share contexts only.
4. Profile. Only then decide on the store, on §13 A to C, and on §14.
