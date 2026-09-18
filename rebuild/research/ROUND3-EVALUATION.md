# Ceiling round 3 evaluation: verdict and open items

Paths are relative to `~/github/pretext-rebuild`. Tables are in REPORT.md §2 to §7, rewritten for round 3. Outputs are under `.artifacts/ceiling-20260917/evaluate-r3/`; the fresh sets are under `.artifacts/lab/fresh/<browser>/eval-r3-<n>/`.

## Plain verdict

**The correctness ceiling isn't reached in Chrome.** Firefox and webkit-host meet the round's criterion of two unseen fresh sets in a row with no new class. Known classes stay open in both.

Failures without a covered explanation on three fresh sets per browser that nobody had seen (seeds `eval-r3-1` to `-3`, every generator kind, both orders, scorer 5):

| Browser | Fresh cases | Prediction failures | Open rows, sets 1 / 2 / 3 | Open per 10,000 | Classes |
|---|---:|---:|---|---:|---|
| Chrome | 34,115 | 181 | 2 / 3 / 1 | 1.76 | three, all new |
| Firefox | 33,432 | 576 | 0 / 1 / 0 | 0.30 | one, which the owner had found |
| webkit-host | 33,202 | 686 | 0 / 0 / 1 | 0.30 | one, an observation consequence the owner had named |

- Read more strictly, as two sets in a row without any open row, only webkit-host passes (sets 1 and 2).
- No row is open in reverse order only.
- No residual class has a member on any set.
- Firefox's result rests on measuring on a detached `<canvas>` element, which is a decision for the maintainer.

## What ran

- **Library.** `rebuild/src` and `rebuild/lab` at the tag `round3-work-done`. All 216 run records hold one bundle, sha256 `80b6b4b8004c…`, which is the Gecko owner's last bundle.
- **Checks.** `tsc` is clean. `bun test rebuild` has 603 passing and 2 failing tests, neither in engine code:
  - the independence test fails on `lab/baselines/no-facts-predictor.ts`;
  - the families test fails on a retired WebKit rule id.
- **Browsers.** Pinned Chrome 153.0.8010.50, pinned Firefox 156.0 and webkit-host, each forward and reverse.
- **Sets:**
  - smoke and the development sets;
  - rule and feature families twice: round 2's case files (for the comparison and the gates) and round 3's derivations (for the staged seeds; no protocol row);
  - held-out 09-16, with its 9 giants run apart and exclusively;
  - sealed-3: all 11 hashes and the repository record verified, generator sources unchanged, never run before; scored once with `--sealed` plus a counts-only tool;
  - three fresh sets per browser.
- **Timing.**
  - 142 per-set jobs ran in under 7 minutes.
  - 54 fresh-set jobs ran in 3 minutes.
  - The 12 giants jobs ran exclusively with `--chunk=1`; jobs took 132 to 168 s in Chrome, 10 to 15 s in Firefox and 236 to 327 s in webkit-host.
- **No browser job failed**, so none ran twice.
- **Not run.** No main comparison and no triage refresh.
- **Tools.** Round 2's tools were adapted under `evaluate-r3/tools`: no pauses, per-browser worker pools under the lock's slots, and sealed counts, gaps, firing, extras, gates and seed-record tools.

## Failures without a covered explanation, every set

Round 2's rows under the same scorer are in parentheses.

| Browser | Rule families | Feature families | Development | Held-out 09-16 with giants | Sealed-3 (counts) | Fresh sets 1 / 2 / 3 |
|---|---|---|---|---|---|---|
| Chrome | 0 of 428 (0 of 457) | 0 of 0 | 1 of 89 (2 of 95) | 2 of 174 (15 of 205) | 2 of 178 | 2 of 61 / 3 of 65 / 1 of 55 |
| Firefox | 0 of 528 (52 of 992) | 0 of 0 | 0 of 456 (19 of 1,013) | 0 of 409 (19 of 877) | 0 of 430 | 0 of 197 / 1 of 196 / 0 of 183 |
| webkit-host | 0 of 231 (0 of 493) | 0 of 32 | 0 of 205 (3 of 210) | 0 of 243 (22 of 261) | 1 of 243 | 0 of 236 / 0 of 214 / 1 of 236 |

- The re-derived family files and the combined files (webkit-host and installed Safari) have none either.
- No failure anywhere is covered only by a gap without a range.

### Chrome: three new classes on the fresh sets, none with a gap that touches it

- **An exact-fit break in ProbeShantell under letter spacing** (`suite/ligature-thresholds-v3`): `c-0342c2bb3e2138fd`, `c-c3eeb836fa28c562`, `c-7e131b748aca6cb5`, `c-a4bdefa792ae621e`.
  - `office` (−4px letter spacing) and `difficult` (1px), bold 16px, `break-word`.
  - Natively `offic` stays on the first line: its right edge is 16.992px in a 16.992px box. The prediction breaks before `c`.
  - The layout reports no gap at all.
  - It is the font of `c-8c84627af834611f`, whose `in-word-prefix` condition fires at wrapped line starts. These rows are first lines.
  - Not traced.
- **U+3000 kerned with the next line's first letter**: `c-0ee8c36920378f9f`, `runs/word-spacing-spans`, 16px Times New Roman.
  - Natively U+3000 is 16px and `T` is 9.633px. Predicted 15.930px and 9.773px.
  - So natively the 18-unit pair adjustment sits on the `T` across the wrap.
  - The layout reports nothing on that line.
- **An emergency break after a marked waw**: `c-2dce271cf373d098`, `policy/overflow-wrap`, 14px Geeza Pro, RTL, 8px wide.
  - Natively `وَ` and the alef sit on two lines. The prediction keeps `وَا` on one line (30 native lines, 29 predicted).
  - The line's gaps start after the decision text.

**Defined sets.** Three `suite/U+FFFC/start` rows are open: `c-23e11e5c3a96497d`, `c-a43249c733c43a9c`, `c-b0af41f52ed23824`. The cause has a `font-fallback` gap, but a soft hyphen's copied rect makes the scorer attribute the line after it. This is a scorer attribution, per the Blink owner. Sealed-3's 2 open Chrome rows are line-count failures in its suite sample, unopened.

**The round 2 critic's items are fixed or covered.** Its three U+3000 held-out rows and three lam-alef rows pass all four metrics here. The 6 giants that were one unit off pass.

### Firefox

- **Open (known class, reading wrong here):** `c-f3e8314c35b33990`, `suite/chromium-script-spacing`: three Phags-pa letters and U+0301 in 16px Courier New under 1px letter spacing.
  - Natively the first letter takes the spacing: 11.650px against 10.517px, and the line is 2,060 au against 2,000.
  - The owner's probe F19 rule puts the `font-fallback` range on the marked cluster at [2,4).
- **Still open from the owner's sets, not hit here:** a tab after a frame that starts inside a cluster (`CalcTabWidths`, read and not ported).
- **Covered by position only:** held-out `c-4bbfaaafb6f3d47f`, `c-710f180e5314942f`, `c-9c05c70ce585fb82`.
  - This is probe F18's native frame 2^30 + 56 au wide.
  - `in-word-prefix` sits at the frame edge, and that condition's source reading doesn't say a frame becomes unbounded.
  - By the definition's second half these rows are open. It is a Firefox bug candidate.
  - No fresh or sealed-3 row has the signature.
- **Residual 1 au class:** 0 members everywhere. The OffscreenCanvas fallback (pages without `document`) wasn't run by anyone.

### webkit-host

- **Open:** `c-9a66d090891a825d` (fresh set 3, `runs/bidi-runs`).
  - The line's float32 sum of runs shaped across inline boxes is one step off: 224.06697px against 224.06696px. That is the owner's stand-in class under `rtl-shaping-across-inline-boxes`.
  - Every x on the RTL line then moves by a step.
  - A Hebrew node the gap doesn't touch reports `f32(f32(x+w)−x)` one step wider.
  - Scorer 5 has no rule for that consequence. It is the same kind as the owner's `c-653ac96abf5487ff`.
- **Sealed-3:** 1 open line-count row, unopened.

## Four metrics against round 2 re-scored with scorer 5

Suite samples, pass ÷ (pass + fail), development / held-out 09-16 / sealed-3. Round 2's development / held-out rates under scorer 5 are in parentheses.

| Browser | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| Chrome | 99.74 / 99.23 / 99.39 (99.72 / 99.16) | 99.73 / 99.18 / 99.36 (99.71 / 99.08) | 99.87 / 99.05 / 98.85 (99.87 / 98.96) | 99.54 / 97.58 / 97.49 (98.57 / 96.20) |
| Firefox | 99.88 / 99.88 / 99.93 (99.68 / 99.51) | 99.87 / 99.84 / 99.87 (99.61 / 99.27) | 97.86 / 96.09 / 95.81 (95.51 / 92.36) | 93.99 / 90.25 / 90.14 (91.67 / 86.84) |
| webkit-host | 99.94 / 99.71 / 99.93 (99.92 / 99.68) | 99.93 / 99.59 / 99.89 (99.91 / 99.54) | 99.86 / 99.68 / 99.66 (99.87 / 99.62) | 95.54 / 81.29 / 82.17 (94.87 / 81.03) |

Rule families, lineCount / breaks / widths / painter:

| Browser | Round 2 | Round 3 |
|---|---|---|
| Chrome | 98.49 / 97.93 / 97.85 / 93.65 | 98.58 / 98.16 / 97.89 / 94.67 |
| Firefox | 98.41 / 95.99 / 93.39 / 83.97 | 99.43 / 98.41 / 96.01 / 89.10 |
| webkit-host | 98.75 / 97.89 / 96.81 / 89.39 | 99.68 / 99.44 / 98.07 / 90.69 |

- **Feature families:** Chrome and Firefox pass every lineCount, breaks and observed width. webkit-host fails 20 line counts and 32 breaks, all `rule/br-elements` under `page-history`.
- **Giants:** all 9 held-out giants and sealed-3's 4 pass lineCount, breaks and every observed width in all three browsers.

**Transitions, pass→fail / fail→pass** (cases neither round marks history-dependent or protocol):

| Browser | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| Chrome | 0 / 23 | 0 / 42 | 0 / 26 | 2 / 595 |
| Firefox | 10 / 187 | 25 / 378 | 0 / 1,242 | 14 / 1,349 |
| webkit-host | 8 / 106 | 8 / 166 | 1 / 98 | 19 / 392 |

**Every lost prediction pair is covered and attributed:**
- **Firefox:**
  - 32 pairs: `rule/system-fonts-and-sizes` at 13.33px under `font-size-quantization`. Round 2 passed them by accident, with a first line 482 au short.
  - 3 pairs: `c-2ad5b0126a288f11` and `c-fc9b382c418b3022` under `in-word-prefix`. The two sides measured with U+200D don't add up: 582 against 925 au, and 1,804 against 1,746 au.
- **webkit-host:**
  - 16 pairs: `rule/joining`, accidental passes in round 2.
  - 1 width: `c-0ad060cd384930bf`.
- **Painter losses:** Firefox's and webkit-host's all sit on cases whose prediction changed. Chrome's 2 are the painter owner's known `rule/joining` class.

**Held-out suite history dependence moved with the run method.** The held-out suite sample ran 25 cases per round trip this round, with no giants at its start.
- Firefox went from 217 to 104 history-dependent cases: the emoji cases left, and the 104 `suite/U+FFFD` cases stay.
- webkit-host went from 135 to 179: 44 bracket and quote cases are new.
- The development suite sample, run as before, keeps exactly its 123 (Firefox) and 75 (webkit-host).

## Exact observation agreement against round 2

| Browser | Predicted-value agreement, development | Held-out | Passing development cases with a wrong predicted value | Predicted share |
|---|---|---|---|---|
| Chrome | 98.312% → 99.992% | 97.184% → 99.993% | 2,022 → 18 (held-out 722 → 33; fresh 11, 11 and 10) | fell to 62% development, 38% held-out; 73% fresh |
| Firefox | 98.949% → 99.910% | 99.534% → 99.992% | 6 → 23, Myanmar corpus paragraphs (held-out 17 → 7; fresh 0, 0 and 1) | 29–46% → 90–99.6% |
| webkit-host | 99.724% → 99.730% | 99.742% → 99.755% | 5 → 3 | 15.5% |

- Chrome's predicted share fell by design: the layout now marks stand-ins.
- The Gecko owner's count of about 100 passing fresh cases with a wrong predicted value isn't reproduced. The emoji cases here hold exact predicted values in both orders.
- webkit-host's fresh agreement is 99.497%; the differing values sit in failing `runs/lang-spans` lines.

## History dependence, first both-orders check with Gecko's canvas element

- **Firefox.** Of 542 history-dependent suite cases (development 123, held-out 104, fresh 104, 116 and 95):
  - 527 pass lineCount, breaks and widths in both orders. That includes all 315 fresh ones.
  - Predicted values are exact in both orders in all but 2.
  - An emoji in 18px Times New Roman is 18px in one order and 17px in the other, and the prediction follows each time.
  - So the canvas element tracks the DOM's font state.
  - `page-history` reports all 227 development and held-out ones (round 2: none).
  - On the fresh sets it reports only 8 of 104, 14 of 116 and 95 of 95.
  - It fires on 56 of 25,012 other development cases.
  - The condition names less than the effect.
- **webkit-host.**
  - `page-history` reports every history-dependent case.
  - No history-dependent case fails without a covered explanation in both orders.
  - It still fires on 2,148 of 25,098 other development cases (round 2: 3,703).
- **Chrome.** No case is history-dependent anywhere.

## Weak coverage

Failures covered only by conditions with a lift below 2. The first number uses round 2's lift (over cases failing any metric); the second uses a lift over prediction failures alone. Round 2's rows → round 3:

| Browser | Rule families | Development | Held-out | Sealed-3 |
|---|---|---|---|---|
| Chrome | 0 / 0 of 457 → 0 / 16 of 428 | 4 / 4 of 93 → 2 / 2 of 88 | 6 / 6 of 190 → 0 / 0 of 172 | 1 / 1 of 176 |
| Firefox | 20 / 0 of 940 → 0 / 0 of 528 | 1 / 1 of 994 → 0 / 0 of 456 | 2 / 2 of 858 → 0 / 0 of 409 | 0 / 1 of 430 |
| webkit-host | 153 / 153 of 493 → 142 / 0 of 231 | 200 / 188 of 207 → 187 / 2 of 205 | 239 / 32 of 239 → 228 / 5 of 243 | 222 / 1 of 242 |

- Round 2's lift counts painter-only failures as failing cases. In webkit-host those are 1,080 of 1,285 failing development cases, so every condition reads weak there.
- Under the prediction lift only `tab-stops` stays weak in webkit-host.
- The WebKit owner's "2 of 202" uses that second definition.
- One definition should be fixed.

## Gap firing on passing lines, conditions that changed (development; round 2 rows → round 3)

| Engine | Condition | Passing lines | Note |
|---|---|---|---|
| Blink | `script-context` | 50.7% → 30.8% | lift 1.73 → 1.48 |
| Blink | `glyph-clusters` | 9.0% → 7.4% | |
| Blink | `float32-precision` | new: 5.8% | 0.6% held-out; on no failing line anywhere |
| Blink | `unsafe-to-break` | 3.1% → 3.6% | |
| Blink | `in-word-prefix` | 1.58% → 1.62% | lift 4.6 → 1.4 |
| Blink | `optical-size` (rule families) | 9.1% → 1.3% | |
| Gecko | `in-word-prefix` | 12.0% → 4.2% | on 100% of failing lines; lift 8 → 24 |
| Gecko | `glyph-clusters` | 9.9% → 0.01% | |
| Gecko | `font-fallback` | 0.06% → 0.01% | |
| Gecko | `page-history` | 0.01% → 0.07% | outside history-dependent cases |
| Gecko | `bitmap-emoji-size`, `optical-size` | gone | |
| Gecko | `font-size-quantization` | on no passing line | 29% → 55% of failing rule-family lines |
| WebKit | `canvas-language` | 44.1% → 15.4% | line lift 2.0 → 5.7 |
| WebKit | `simplified-measuring` | 18.3% → 7.8% | |
| WebKit | `letter-spacing-ligatures` | 7.7% → 0.02% | |
| WebKit | `control-character-width` | 2.7% → 0.1% | |
| WebKit | `page-history` | 5.8% → 3.4% | |
| WebKit | `rtl-shaping-across-inline-boxes` | 0.5% → 1.05% | widened; rule-family lines |
| WebKit | `dictionary-breaks-stand-in` | 0.06% → 0.08% | widened |

Full tables are in REPORT §4 and `evaluate-r3/firing/table.md`.

## What the remaining failures are made of (fresh sets)

- **Chrome** (53 prediction failures per 10,000):
  - 130 of 181 are U+FFFC drawn by a fallback font (`font-fallback`);
  - 24 are `system-ui` platform font cache history (`page-history`);
  - 16 are Arabic at shaping edges;
  - 6 are open.
- **Firefox** (172 per 10,000):
  - 397 of 576 are breaks between joined letters whose two sides don't add up (`in-word-prefix`; Amiri beh around a soft hyphen dominates);
  - 175 are font sizes Canvas can't set (`font-size-quantization`).
- **webkit-host** (207 per 10,000):
  - 474 of 686 are fonts chosen by language (`canvas-language`; an OffscreenCanvas has no locale);
  - 84 are ligature pairs under letter spacing;
  - 54 are `page-history` alone;
  - 38 are VT, FF and CR float32 steps;
  - 23 are runs shaped across inline boxes.
- **Painter-only failures without a covered explanation** per fresh set: about 60 (Chrome), 440 (Firefox) and 750 (webkit-host).
  - `painterLimits` names nearly all of them, but it isn't exported or recorded.
  - Development counts moved: Chrome 72 → 14, Firefox 189 → 451, webkit-host 622 → 960.
  - Counts rose where more widths now pass.

## Installed Safari

- `dev-all` (25,180 cases) and `families-all` (21,734) ran in both orders in 2-minute parts, each part a fresh tab.
  - The `dev-all` jobs took 307 and 313 s; the `families-all` jobs took 105 and 102 s.
  - Every row was hidden.
- webkit-host ran the same files with `--parts-from` each Safari job.
- Every native view, prediction and score is equal case by case. Both mark the same cases history-dependent (80 and 6).
- No job failed.

## Gates and staged seeds

- `lab/gate.ts` and `tests/gate.ts check` refuse every run against the adopted seeds by environment (scorer 5 against scorer 4), as designed. Nothing was checked without the environment check.
- **Staged only:**
  - `rebuild/lab/baselines/staged-round3/`: 3 lab seeds with seed records.
  - `rebuild/tests/baselines/staged-round3/`: 7 tests seeds with seed records, and `coverage.json`.
  - Each staged seed self-checks.
  - No adopted baseline was touched.
- **Lost against the adopted seeds:**

| Seed | Lost pairs |
|---|---|
| lab gate, Chrome | 0 |
| lab gate, Firefox | 5 (2 lineCount, 1 breaks, 2 painter) |
| lab gate, webkit-host | 4 (1 width, 3 painter) |
| rule families, Chrome | 2 painter |
| rule families, Firefox | 44 (8 lineCount, 24 breaks, 12 painter) |
| rule families, webkit-host | 32 (8 lineCount, 8 breaks, 16 painter) |
| feature families | 0 |

  - Every lost pair has an `attribution` (`attribute-records.py`).
  - Every prediction pair is covered.
  - 7 Firefox painter pairs have no covered explanation. The prediction passes for the first time, and the lab doesn't record the painter limit `edge-inside-shaped-text`.
- **Left through new history dependence:** webkit-host lab, 175 pairs of 44 cases (81 pass now), listed in the record.
- **Protocol rows:** 0.
- **Cases only the adopted feature seeds hold:** Firefox 24, webkit-host 10 (`rule/line-slots` under the new width floor, the 22 protocol rows among them).
- **Staged coverage** exits 1: `webkit/measure/word-spacing-in-js` lost its last family. The id was retired, and the families `following-space` and `tabs` still name it.

## Docs and rows

- **Docs edited:**
  - REPORT.md: headlines, §2.1 to §2.4 and §2.6 to §2.8 rewritten; §2.5 marked as round 2's; round 3 blocks in §3 and §4; §5 to §7 updated.
  - CHARTER.md known deviations: status lines, and a "Found in the ceiling round 3 evaluation" block that also registers the WebKit owner's constants and scorer 5's heuristics.
  - TESTS.md: §6, §8, §9, §11 and §13.
- **Rows:** the evaluation folder went from 31 GB to 12 GB.
  - Compressed: part folders, sealed-3, giants, the combined files and the fresh sets.
  - Left plain: the joined development, held-out and family rows, for predict-only runs and the critic.

## Still open

1. **Blink:**
   - the three fresh classes (6 rows);
   - the `suite/U+FFFC/start` attribution rows;
   - 18, 33 and about 11 passing cases with a wrong predicted value;
   - `float32-precision` on 5.8% of passing lines and on no failing line.
2. **Gecko:**
   - the cursive letter spacing reading;
   - the tab after a frame inside a cluster;
   - probe F18's unbounded frame (needs a trace or a bug report, and a scorer rule);
   - the OffscreenCanvas fallback, never run;
   - the Amiri cross term under `in-word-prefix`, which is most of what fails.
3. **WebKit:**
   - `canvas-language` needs an input, either the per-language cascade as a fact or a connected `<canvas>` with `lang`;
   - the float32 order of shaped run sums, and its observation consequence.
4. **Scorer and lab:**
   - rules for the two observation consequences;
   - record `painterLimits`;
   - fix one lift definition;
   - `lab/residual-classes.json` still registers the 1 au class as it was;
   - generate sealed-4.
5. **Tests:** the two failing tests, and families naming the retired WebKit rule id.
6. **Decisions for the maintainer:**
   - Gecko's canvas element;
   - whether to adopt the staged seeds, after the critic;
   - the facts-free headline (these numbers use the lab's font facts).
