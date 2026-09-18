# Gecko (Firefox 156) — ceiling round 3 report

Written after the owner was stopped, from its transcript, run folders and `git diff round3-start..round3-work-done`. Paths are relative to `~/github/pretext-rebuild`. I changed no engine code. The re-counts and the one re-observation marked "afterwards" are mine, run with the owner's final library bundle (sha256 `80b6b4b8004c…`), which is also the bundle of `r3-24` and fresh sets 14 and 15.

## 0. Needs you

1. **Is measuring on a detached `<canvas>` element acceptable?** The Gecko port now measures every width there, at the DOM's device font size.
   - It removes the 1 au class, the keycap-heart class, `bitmap-emoji-size` and `optical-size`.
   - It needs `document`, so a worker falls back to the OffscreenCanvas path with round 2's gaps. The lab never runs that path.
   - It shares the DOM's font groups, and no round 3 run checked history dependence in both orders.
2. **Probe F18 looks like a Firefox bug.** A grapheme cluster split between its two marks across spans in Geeza Pro gives a frame 2^30 + 56 au wide natively. It is untraced. It covers 9 rows that count as covered by `in-word-prefix` by the letter only. It needs a bug report or a source trace, and a scorer decision.
3. **The owner passed the 8-set cap** after a context compaction. Sets 9 to 15 and the library changes `r3-16` to `r3-24` came after the stop rule was met.

## 1. The brief's items

### 1.1 The 1 au class: reproduced, no longer residual
- **Source.**
  - The DOM shapes at the device font size and rounds each glyph at the page's apd (gfxHarfBuzzShaper.cpp:1559, :1699-1702).
  - An OffscreenCanvas shapes at the CSS size at apd 60 with its own font group (CanvasRenderingContext2D.cpp:4423-4492, :7135-7140).
  - A `<canvas>` element takes its font from the pres context's font cache at the canvas size over the CSS-to-device scale (:4256-4269, :4353), and its text run has the page's apd (:7132-7155).
  - `gfx.font_rendering.coretext.enabled` is false, so HarfBuzz shapes Geeza Pro, Thonburi and Helvetica Neue through morx, kerx and kern.
- **Probe F13.** The element at the device size, width × apd, equals the DOM on 243 of 243 units. That includes all 14 units where OffscreenCanvas is 1 au off:
  - `ووفقك`, `وأعانك` and `وما` in 10px Geeza Pro at weights 300, 400 and 500;
  - three Thai strings in 500 32px Thonburi;
  - `modern` in 15px Helvetica Neue and `LT:` in bold 10px Helvetica Neue.
- **Mechanism.** It is verified by simulation from the font's units for `modern`: the `n` after the kern split is 508.4999 au at the DOM's scale and 508.5004 au at Canvas's, giving 3118 and 3119. The Geeza Pro and Thonburi members weren't simulated; they are reproduced by measurement only.
- **Refuted before:** an OffscreenCanvas at the device size (the round 2 critic's probe), and canvases at the CSS size (F7).
- **Counts.** The residual class has 0 members on all 11 defined sets and all 15 fresh sets. `lab/residual-classes.json` still registers it as inferred; that is the lab owner's file.

### 1.2 Keycap heart: synthetic bold, predicted
- `GetSyntheticBoldOffset` is 0.25 + 0.75 × size / 48 device px below 48px (gfxFont.h:1899-1904), rounded per glyph at the apd. That is 21 au at the DOM's 28 device px and 28 au at Canvas's 14px.
- Probe F14: DOM 786 au, OffscreenCanvas 793, element at the device size 786. Equal on 126 of 126 rows.
- Whether sealed-2's three rows are this class stays unknown.

### 1.3 In-word-prefix sub-classes turned into predictions
The sub-classes are in §3. The effect:
- **Suite widths** (scorer 5, forward, pass ÷ (pass + fail)):
  - development 95.51% → 97.87%;
  - held-out 09-16 92.37% → 95.99%;
  - rule families 93.39% → 96.01%.
  - Sealed sets weren't run.
- **Firing on passing development lines** went from 12.00% to 4.24%. On failing lines it went from 98.79% to 99.78% (lift 8.24 → 23.54).
  - On the way it was 6.96% (`r3-6`), 3.07% (`r3-11`) and 2.65% (`r3-16`).
  - `r3-17` widened it to 4.23%: marked ligature groups in fonts that aren't OpenType-shaped, and units that start inside a cluster.
- **What is left on the development suite sample.** 449 of 450 failing cases sit under `in-word-prefix`. 394 of them are the invisible-character families' joined beh letters in 16px Amiri around a soft hyphen, where W(prefix U+200D) + W(U+200D suffix) doesn't equal W(unit). The critic backed that class from source.
- **The observation port** limits only what the layout marks as a stand-in (`standInBefore`, `standInAtEnd`, `advancesStandIn`).
  - Predicted values went from 29–46% of all values to 91–99.8%.
  - Agreement is 100% on 9 of the 11 sets, 99.881% on the suite sample, 99.970% on the held-out suite sample and 99.957% on the rule families.

### 1.4 History condition: named, not checked
- **`page-history` on every U+FFFD** (`mReplacementCharFallbackFamily`, gfxPlatformFontList.cpp:1244-1268, :1328-1330). It fires in 37 development cases, 33 of them passing.
- **`page-history` on an emoji-capable cluster** that measures differently in the run's context and in "Apple Color Emoji" alone (gfxTextRun.cpp:4003-4005, :4038-4040, :4083-4086, :3559-3569, :3385-3390).
  - It replaces the pinned-emoji `font-fallback` and, on the element canvas, `bitmap-emoji-size`.
  - It fires in 131 development cases, 130 of them passing.
- **Found on the way:** measuring a string with U+FE0E pins text fonts for the document's later text, so the port never adds U+FE0E.
- **Firing.** On the development sets it went from 0.01% to 0.26% of passing lines, with a lift of 0.85. On fresh set 15 it fires on 0.26% of passing and 3.76% of failing lines (lift 14.55).
- **Not done.** No both-orders run was made. Round 2's 123 development and 217 held-out history-dependent cases are scored as ordinary cases in the owner's tables.

### 1.5 Emergency-break font-fallback: settled by the coverage fact
- One listed family for the letter, the hyphen and the next letter keeps the break.
- Two families, or a listed one beside the engine's fallback, remove it.
- The gap is reported only where the facts don't say (gfxFont.cpp:741-753, gfxTextRun.cpp:2930-3000).
- `rule/hyphen-classes`: 12 line counts and 20 breaks converted; all 756 cases pass both. 68 cases reported the gap in round 2, 0 now.
- Other facts:
  - `ligatures` converts fresh set 11's two `fff` rows and nothing on the defined sets (`r3-23` equals `r3-21` on every metric);
  - `scriptLookups` only restricts;
  - `joining` only marks stand-ins.

### 1.6 Odd kern split: settled (probe F16, hb-kern.hh:102-106)
- Which glyph takes the odd unit follows the fractions of the two advances, read at size × 2^k.
- 92 of 92 even adjustments divide in halves. Of 37 odd ones, 36 are given and 1 is a tie.
- Round 2's odd case `c-3ae0e772055c21ec` still fails by 1 au under `in-word-prefix`.

## 2. Fresh sets

Each set was run as `bun rebuild/lab/fresh.ts --browser=firefox --seed=r3-gecko-<n> --repeat=2`, forward, in three parts. The residual class has 0 members in every set.

| Set | Cases | Prediction failures | Open | Open rows | Outcome |
|---|---:|---:|---:|---|---|
| 1 | 16,446 | 206 | 0 | | |
| 2 | 16,435 | 209 | 1 | `c-a2ed29d78da443cd`: emoji font-matching state | `page-history`: a gap, not a prediction |
| 3 | 16,402 | 172 | 4 | `c-7421ac03d17f9f11`, `c-a9317a4e713e9d26`, `c-fbeb37c26b215b04`: a mark starting a span takes letter spacing. `c-c408f28194762a1e`: Hanifi Rohingya with U+0301 under letter spacing | base search bounded by the frame (nsTextFrame.cpp:3549-3560, :4203-4213), predicted; the cursive letter spacing rule (F19), which is a `font-fallback` gap for fallback fonts |
| 4 | 16,376 | 198 | 0 | part 3 stalled once | fixed, run once more |
| 5 | 16,351 | 201 | 1 | `c-b44094d264947ac3`: the owner's own suffix-only recipe on a joining letter | two-sided recipe for joining types R, D, L, C |
| 6 | 16,351 | 187 | 3 | `c-df939d6130e41b1b`, `c-9d8986212ef18179`: the space after U+200D. `c-a76a521c12628bd7`: a lone `(` at level 1 | both predicted (gfxTextRun.cpp:3319-3325, :1590-1622; nsBidiPresUtils.cpp:2180-2190, :2395-2414) |
| 7 | 16,358 | 224 | 0 | | |
| 8 | 16,397 | 223 | 0 | | the stop rule was met here |
| 9 | 16,340 | 169 | 0 | after the font facts landed | |
| 10 | 16,299 | 181 | 2 | `c-453f35adc95f369c`: Syriac with U+0301, set 3's class again. `c-ca72eae85de1aead`: a span holding lam alone | the other-font rule replaces the wrong supplementary-plane hypothesis; the scan takes a group whole only inside its range (gfxTextRun.cpp:989-1000) |
| 11 | 16,314 | 227 | 3 | `c-545b8fb978408502`, `c-2c3f5990d6a9eddb`: `fff` in Helvetica Neue. `c-1cee0563b3bac8bd`: `11` in a Hebrew-language Common run in Arial | ligature rows by the `ligatures` fact (hb-ot-layout.cc:1917-1945), predicted; pair kerning bound to the script run (hb-ot-shape.cc:134, :173-184), a stand-in there |
| 12 | 16,332 | 184 | 0 | | |
| 13 | 16,294 | 178 | 3 | `c-66f10943bae83d88`, `c-b97c94c6e606a261`, `c-ec999da70a7ad78b`: a span starting inside a Geeza Pro ligature group under 5px letter spacing, 300 au | letter spacing at the group's end (gfxTextRun.cpp:306-320), predicted |
| 14 | 16,277 | 193 | 0 | final library | |
| 15 | 16,259 | 192 | 2 | `c-552fa9e3eb8a2096`, `c-e43b2d097cd7153b` | **open** (§4) |

- Totals: 245,231 cases, 19 open rows, 11 classes. That is about one new class per 22,000 cases.
- The final library has set 14 dry and set 15 with a new class. That is not two dry sets in a row.
- 26 giants (sets 1 to 6) were skipped and never run.
- **Re-observed afterwards**, once, in one small document (`.artifacts/lab/gecko/r3-report-open-rows`):
  - 12 of the 19 rows pass every prediction metric.
  - 5 fail under a covering gap:
    - `c-c408f28194762a1e` and `c-453f35adc95f369c` under `font-fallback`;
    - `c-b44094d264947ac3` and `c-1cee0563b3bac8bd` under `in-word-prefix`;
    - `c-a2ed29d78da443cd` under `in-word-prefix` and `page-history`.
  - Set 15's 2 rows stay open.
  - The owner had checked its fixes only by unit tests and regression runs, never on the rows that showed them.

## 3. What changed, with sources

**Measurement.**
- The element canvas is described in §1.1. `font-size-quantization` now follows the element's rule: 7 significant bits after the division by the device scale (:4263-4269).
- A lone mirrored neutral at an odd level gets U+200C after it, so Canvas takes its bidi path.
- The boundary space after U+200D is the word's last font's space.

**In-word advances.**
- Sides are measured with U+200D, since it is Join_Causing. The position is exact where the sides add up (probe F15: 1,013 of 1,015 cuts).
- The suffix-side recipe applies to clusters without joining forms. It came in for cost after the stall.
- Pair kerning:
  - only printable ASCII clusters;
  - only where the script run selects the lookups the fact describes (ResolveScriptForLang, gfxTextRun.cpp:2581-2640).
- Ligature groups:
  - equal shares per started cluster (ComputeLigatureData, gfxTextRun.cpp:238-322);
  - found by the ink test (probe F9) and by Canvas letter spacing group counts (probe F17; CanvasRenderingContext2D.cpp:4759-4790);
  - a marked group is confirmed only where `joining` is 'opentype' (hb-ot-shape.cc:189-191, :1051-1070);
  - a row of candidates is divided by the `ligatures` fact.
- Every position inside a grapheme cluster is a stand-in.
- The scan counts a whole group only when the group lies within the scanned range.

**Spacing.**
- The cluster base search stops at the frame's start.
- A cursive cluster takes letter spacing where another font draws one of its marks.
  - MeasureText asks for spacing per glyph run (gfxTextRun.cpp:809-829, :752-765, :372-392).
  - The scan uses its own buffer, so `scanSpacingPrefix` leaves this spacing out.
  - Where the coverage facts don't say, the line reports `font-fallback`.
  - This was traced to source in the last edit. No probe targets the scan half.
- A range starting inside a ligature group takes the letter spacing at the group's end.

**Firing on passing lines**, round 2's library under scorer 5 → `r3-24`. The held-out passing lines fell from 83,695 to 61,654 because the 9 giants left the held-out suite file.

| Gap | Development | Held-out 09-16 | Rule families |
|---|---|---|---|
| `in-word-prefix` | 12.00% → 4.24% | 28.60% → 4.42% | 9.29% → 1.99% |
| `glyph-clusters` | 9.90% → 0.01% | 9.67% → 0.03% | 23.02% → 0 |
| `font-fallback` | 0.06% → 0.01% | 0.15% → 0.01% | 0.30% → 0 |
| `page-history` | 0.01% → 0.26% (widened) | 0.03% → 0.30% | 0 → 0 |
| `bitmap-emoji-size` | 0.03% → gone | 0.04% → gone | none |
| `optical-size` | none | none | 6.65% → gone |
| `font-size-quantization` | 0 | 0 | passing 0; failing lines 806 → 814 |

`float32-precision` is new as a limited state in the observation port only. It applies to edges 2^16 device px or more from the origin (nsLayoutUtils.cpp:2517-2537; probe F6). The bound is derived for apd 30.

**Assumptions and constants without a source reading.** They are registered in CHARTER.
- The suffix-side recipe assumes a cluster without joining forms shapes alone as it does after its neighbour.
- U+200C is appended to mirrored characters only, after a held-out row showed a lone mark shaping otherwise with it.
- The odd-kern recipe needs k ≥ 3.
- The float32 bound is derived for apd 30 only.
- No rule was picked by which variant regressed less. The supplementary-plane fact of F19 was the one wrong hypothesis, and source replaced it.

## 4. Open items

1. **Fresh set 15 (2 rows).** A span starts at U+094B inside the cluster of U+0926 in 20px Kohinoor Devanagari, and a tab follows in that span.
   - Natively the tab is 1016 au; predicted 688. The 328 au difference is the mark's part of the cluster.
   - Source reading, found after the stop: `CalcTabWidths` adds a character's advance to the tab position only where it starts a cluster (nsTextFrame.cpp:4349-4357).
   - The row's numbers agree with that reading: the tab ends at 7456 au of tracked position, which is 2 × the 3728 au tab width.
   - It isn't ported. `computeTabs` counts every advance from the frame's start.
2. **F18's unbounded frame.** It covers held-out `c-4bbfaaafb6f3d47f`, `c-710f180e5314942f` and `c-9c05c70ce585fb82`, plus fresh `c-048560abd15275ba`, `c-a59db220a7967529`, `c-fd5c582fa80effa9`, `c-b0836d3779e2b6a5`, `c-c2fa4362daf68bd5` and `c-f083249a9892033f`. All 9 count as covered by `in-word-prefix` at the frame edge inside the cluster, whose source reading doesn't say a frame becomes unbounded.
3. **Wrong predicted values in passing cases.**
   - 24 Myanmar corpus cases: U+1038 has a rect of its own natively.
   - 6 Noto Nastaliq Urdu cases: one U+0635 is 1 au off where the sides add up.
   - On fresh sets 2, 11 and 15, 121, 94 and 132 passing cases hold one. Set 15's 132 all lie inside the emoji `page-history` range, which the port doesn't limit.
   - The port doesn't limit values under the cursive `font-fallback` gap either.
4. **History dependence** with the element canvas has never been run in both orders.
5. **The OffscreenCanvas fallback** isn't run by the lab. The unit tests run it on a stub, and only the lab runs the element path.
6. **Giants.** The 9 held-out giants and the 26 fresh ones never ran with this library. The two-sided recipe's cost on long units is what stalled set 4.
7. **Registry and docs.**
   - Round 3's Gecko rules aren't in `rebuild/tests/rules.json`.
   - DESIGN §5's gap table still describes round 2's Gecko conditions.
   - Probes F7 to F19 give no facts.
   - prepare.ts cites gfxTextRun.cpp:946-958 for the scan's spacing buffer; in the pinned file it is :935-942.
8. **Not tried:** a Canvas recipe for the Amiri joined-letter cross term, the dominant class left.

## 5. Scores (`r3-24`, forward; open is 0 on all 11 sets; all 75 open pairs of the scorer 5 baseline pass)

| Set | lineCount | breaks | widths |
|---|---|---|---|
| runs | 2580/0 | 2580/0 (was 2576/4) | 2577/3 (was 2541/35) |
| suite sample | 19864/24 (was 19702/63) | 19862/26 | 19438/424 (was 18804/884) |
| held-out runs | 2576/3 | 2576/3 | 2575/1 (was 2525/43) |
| held-out suite | 9979/12 (was 9735/48) | 9975/16 | 9575/400 (was 8971/741) |
| rule families | 9529/55 (was 9432/152) | 9432/152 (was 9200/384) | 9056/376 (was 8592/608) |

The feature families are unchanged: 11931/0 for lineCount and breaks, with 15 protocol rows.

- **Lost prediction pairs**, all under a covering gap:
  - `c-2ad5b0126a288f11` and held-out `c-fc9b382c418b3022`, under `in-word-prefix`;
  - 24 `rule/system-fonts-and-sizes` cases (8 line counts, 24 breaks) under `font-size-quantization`. They are `system-ui` and `-apple-system` at 13.33px. Round 2 passed them by accident, with a first line 482 au short. The element canvas has the optical size and measures at 13.3833px.
- The families ran round 1's derived case files, not round 3's derivations.
- **Costs**, calls per paragraph: runs 97.7 → 152.8, ws 57.9 → 87.7, policy 84.5 → 108.6, rule families 20.0 → 34.4. The rise is 29% to 89% across the sets.

## 6. Process

- **Fresh set 4, part 3** failed once ("No page activity for 120000ms"). It was diagnosed, fixed, timed and run once more with `--rerun-failed`. That follows the rule.
- **`r3-18`.** All 31 jobs ended at "Bundle failed" before a browser launched, and the owner's script ran on through all 11 sets. The bundle built 30 s later with no change by the owner; the cause was never established. The same library ran as `r3-19`, and the script now stops at the first failure.
- **The owner wrote no docs** and no SHARED-CHANGES entry before it was stopped. I edited:
  - gecko-RESULTS.md: a new "Ceiling round 3" section, and a status line on the old open-bugs table;
  - CHARTER known deviations: a Gecko round 3 block, and three stale Gecko statements, plus a stale `ui-language` line corrected;
  - REPORT.md: Gecko status notes in §2.8, §4, §5, §6 and §7 items 2 and 12, marked as fix phase, not evaluated;
  - SHARED-CHANGES.md: one entry for the owner's shared edits;
  - TESTS.md §7: the probe note.
- **Probes F13 to F19** have header comments in `rebuild/probes/gecko-round3.ts`. Their verdicts are in gecko-RESULTS and the note is in TESTS.md. They have no facts, because the probes carry no checks.
- **Rows.** I compressed `lab/gecko/r3-17` to `r3-23` and fresh sets 9 to 15, with no failures. `r3-24` stays raw.
- **One browser job of mine:** 19 cases in Firefox under the lock, finished on the first run.
