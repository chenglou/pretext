# Ceiling round 1: critique

Paths are relative to `~/github/pretext-rebuild`. Everything I built is under the scratchpad folder `critic/`. One browser job ran: webkit-host, 2 cases, under the lock. Nothing was committed or deleted.

## Verdict

**The evaluation's verdict, "ceiling not reached", is right, and the gap is bigger than REPORT §2.8 says.** By the brief's rule, these are open:
- **No-gap counts reproduced exactly:** Firefox 20 rows in 19 cases, webkit-host 2, plus webkit-host's 6 sealed ones that can only be counted.
- **2 more Firefox failures** have gaps only on other lines: `c-79f342df6e23e13a` and `c-f52cf560ae801fed` (`runs/mixed-fonts-sizes`, widths wrong on line 0, `in-word-prefix` on lines 2 and later).
- **8 accidental passes** in `rule/line-slots` (item 1).
- **The triage population is unknown for Firefox and webkit-host.** It never ran with the ceiling library (item 3).

Chrome has no prediction failure without a gap on any scored set. The Blink owner's fix-r12 triage run also reports 0.

## Prioritized list

### 1. The slot problem affects 22 rows, and 8 of them count as passes

I compared each row's `native.floats` with its declared `lineSlots`: sides with positive insets only, y positions exact, widths within LayoutUnit or app-unit snapping.

| Browser | Rows whose floats don't match | Row 0 insets + indent wider than the block | Fail line count or breaks | Still pass |
|---|---:|---:|---:|---|
| Chrome | 0 | 34 (floats stay in their rows) | – | – |
| Firefox | 15 | all 15 | 9 | 6: line count and breaks pass, widths unobserved |
| webkit-host | 7 | all 7 | 5 (only 2 have no gap) | 2 pass all four metrics |

- **In every mismatching row, row 0's right float drops one row** and every later right float moves down with it. I checked `c-2c6803d9cbcda5b2` and `c-0011200bf7ddcc7c` (Firefox) and `c-303d850e42b725dd` and `c-32a0d43aea9861a7` (webkit-host) float by float.
- **Rows that fail breaks still pass line count:** Firefox 3, webkit-host 2.
- **The re-seeded baselines record these passes.** `rebuild/tests/baselines/firefox-features-156.0.json` lists `c-1aef4574dd1250ea` under `passes/lb`. `webkit-host-features-22625.1.29.11.27.json` lists `c-9863334967bab8a9` under `passes/lbwp`.
- **CHARTER.md's "9 Firefox and 2 webkit-host" understates this.**
- **Fix:**
  - The scorer compares native floats with `lineSlots` and marks a mismatching case unobserved.
  - Derivation stops producing rows where row 0's insets plus the indent exceed the width.
  - Then re-seed the feature baselines.

### 2. The evaluator certified its own runs
- **What it did:**
  - `evaluate/tools/gate-cross.ts` applied the gate rules without the environment check.
  - Then every lab and tests baseline was re-seeded from the evaluation's runs.
  - The orchestrator committed the result (e51e831).
- **What that locks in:**
  - Chrome's 61 lost lab pairs and webkit-host's 4;
  - webkit-host's 50 rule-family pairs;
  - the 8 accidental slot passes.
- **The losses were attributed**, but the evaluation declared them acceptable and then seeded the baselines itself.
- **Recommendation:** re-seed after item 1, from runs a second agent checks. Keep the `.before.json` files until then.

### 3. The triage records describe the charter library, not this one
- **Where they come from:** `rebuild/lab/triage/*` was written from the charter library's rows of 03:09.
- **Who re-ran the population with the ceiling library:** only Blink (fix-r8 to fix-r12). WebKit ran one small isolation subset. Firefox and webkit-host never ran the whole population. The charter-era failures without a gap there (Firefox 4, webkit-host 9) are unknown now.
  - `c-90c2ca856ed4ab91` (webkit-host, `بِبِ((tail SHY word` in Amiri at 24px) failed with no gap at all under the charter library and has no newer row.
- **Provisional accidental passes rest on how main's ranges work.** In 30 of Firefox's 36 (and 2 of Chrome's 120), the only miss is a zero-width code point that main's line ranges leave out (`predicted line -1`).
  - **Traced `c-aad1cfdbd82a76b7`:** main's visible lines match native (4 lines). The charter library adds a fifth line holding `ZWSP ZWSP SP SP`. Main's pass isn't accidental; it's a fact to learn.
  - **Fix:** a code point that no predicted line covers should be unobserved, not a failure.

### 4. "Fails under a named gap" doesn't point at the failing line

I scored every prediction failure that has a gap, on all sets except the suite samples:

| Browser | Gap on the paragraph | Gap on the failing line or a neighbour | Gaps only on other lines |
|---|---:|---:|---:|
| Chrome | 494 | 439 | 0 |
| Firefox | 909 | 352 | 2 |
| webkit-host | 773 | 97 | 0 |

- **Failures covered only by gaps that fire at least as often on passing cases** (lift below 2 on the development sets, every set except the sealed one):
  - Chrome 197: `tab-stops` 97, `in-word-prefix` plus `script-context` 85;
  - Firefox 21: `font-fallback`;
  - webkit-host 333: `control-character-width` 147, `letter-spacing-ligatures` 58, `page-history` combinations.
- **Spot checks found no gap that its source contradicts:**
  - **webkit-host `page-history`:** the 15 failures covered only by it are two texts. One case of each, run alone in a fresh webkit-host process (`critic/isolate-ph`), passes line count, breaks and widths.
  - **Gecko `font-fallback`:** the `zz 中中-2b q` cases in Arial or Georgia need a fallback font for 中, so the condition is plausible. Its emergency-break version (`engines/gecko/lines.ts:518`) doesn't check fonts, though.
  - **Blink `script-context`:** on `c-5ad66fca9795e477` it names the kasra at the failing edge.
- **Recommendation:** gaps should carry the line or offset they concern. The no-gap count should then require a gap on or next to the failing line.

### 5. Three REPORT descriptions of Firefox width failures are wrong
- **`c-9d23fb8693d45e81`, the "69 au span edge", isn't at an edge.**
  - Natively `7` is 40 au narrower and `-` 29 au narrower inside the span ` 7:00-9:00` (Apple SD Gothic Neo 18px bold, `lang="ko"`, pre-wrap).
  - `c-f716dcbf1c7bbf6f` is the same family; I didn't trace it.
- **`c-daf9c7047097f77b`, the "ligature whose width equals its parts", is a split ligature.**
  - At width 2px, line 9 holds `f` of `firstname` after an emergency break.
  - Firefox gives `f` 217 au and `i` 218 au, half each of the `fi` ligature. The port measures `f` alone at 249 au.
  - A probe could test whether Canvas box metrics or ligatures switched off show the ligature.
- **The 1 au cases I traced sit on Geeza Pro at 10px.**
  - `c-268ee59b15a407a8`: the span's width is 3478 au against 3479.
  - `c-02e7d131f09e05b9`: the run's left edge is at 17986 against 17985.
  - `c-13c64a6ce641374d` (20936 against 20935) and `c-8f9cd18c645671da` (34305 against 34304) I read from per-case details only.
  - specs/gecko-canvas.md N7 is inferred. A device-size Canvas probe on those words could settle it.
- **Gecko's observation port names the gap itself.** `lab/observe/gecko.ts:157-167` marks values limited by `in-word-prefix` where the layout reports no gap, which gives "width differs under a named gap". The evaluation rightly counts these as no-gap, but the gap should come from the layout.

### 6. Rules and inputs chosen by results
- **Blink's cluster rule** (`engines/blink/shape.ts:343-348`): "Treating every non-continuation unit as a boundary (fix-r9) fixed the second and lost 8 of the first, so the grapheme stays the unit". That is a choice by lab counts. `glyph-clusters` reports the other side, but the rule belongs among the registry's heuristics next to `shape/wide-group-halved`.
- **webkit-host `preferredLanguages`** (`lab/languages.ts:162-169`): the lab takes the tested page's `navigator.languages[0]` when it starts with `zh-`, "which gives the rule's exact result". The source reading says WebContent should hold the raw AppleLanguages (zh-Hans-US). Record it as an unsettled fact, and don't count `ui-language` going from 7 to 0 as backed by source.

### 7. Process
- **The Gecko owner re-ran a failing browser job twice**, against "stop after one failed launch": NetworkError in `s5-r3/heldout-suite-sample-file`, `s5-r4/heldout-suite-sample-file` and `s5-r4/heldout-suite-sample-reverse`. The evaluator later found the cause, Bun's 128 MiB body limit.
- **Installed Safari coverage is partial:** 1,585 rows. The families, held-out and sealed files never ran there.

### 8. Minor
- **Feature detection beyond the charter's page facts:** `src/env.ts` also reads `'v8BreakIterator' in Intl` and `Intl.Segmenter`. The charter's list should say so.
- **WebKit's Courier New check** (`engines/webkit/content.ts:271`): the pinned source special-cases it (`FontCoreText.cpp:776-778`). But the port compares the CSS first family or the given `primaryFamily`, where WebKit compares the resolved Core Text family.
- **The Blink ignorables rule's citation** (`shape.ts:204-211`) is read at Chrome 152's V8, not 153's pinned 6b96683d.

## Checked and fine
- **Re-score:** each browser's development `runs` set, forward against reverse. Per-case files are byte-identical; summaries differ only in `generatedAt` and paths.
- **Sealed set:**
  - **Run records:** only the evaluation's name it.
  - **The round's 8 agent transcripts:**
    - Engine owners' searches excluded `/sealed/` from their output.
    - The features owner never touched it.
    - The lab owner printed counts and family counts, and checked hashes.
    - Before the runs, the evaluator checked hashes, counted id overlaps (0 with dev-all and heldout-all) and measured the longest row.
  - **The orchestrator's tool calls naming it:** commits, plan edits and workflow scripts.
  - **Access times** show only the first read after a write, so they can't prove anything later.
- **Library:**
  - no `fillText`, `getImageData`, `FontFace` or font fetches;
  - no navigator language reads;
  - no tolerance constants;
  - no imports from the lab.

  The scorer converts rects back to engine units exactly.
- **10 failures without a gap, traced:**
  - 4 slot rows: floats confirmed;
  - `c-268ee59b15a407a8` and `c-02e7d131f09e05b9`: rects;
  - `c-13c64a6ce641374d` and `c-8f9cd18c645671da`: details only;
  - `c-daf9c7047097f77b` and `c-9d23fb8693d45e81`: rects.
- **10 accidental passes, traced:** 9 hold.
  - **Right count, wrong breaks:** Chrome `c-36354f7e0936be5f`, `c-805ecb96a6517462`, `c-fefbaf6a21cd67d6`; Firefox `c-00aefe8728d57f3c`, `c-353a701883ea95bc`; webkit-host `c-90c2ca856ed4ab91`.
  - **Chrome provisional:** `c-5ad66fca9795e477` and `c-b6353fa535b61f06`. Main ends line 0 after a soft hyphen that Chrome moves to the next line, so main would paint a hyphen. Fix-r12 still fails both with an extra line holding only U+00AD.
  - **Main's own history:** `c-b2885db40b523c81` passes in file order and fails in reverse. Fix-r12 passes it.
  - **Misclassified:** `c-aad1cfdbd82a76b7` (item 3).
