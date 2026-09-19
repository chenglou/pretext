# Recipe costs, the browser part: what the unjudged cases lose with each recipe off

2026-09-18, 19:43 to 20:35 PDT. Worktree `~/github/pretext-rebuild-wt/recipes2` (branch `x-recipe-costs-browser`, 385d4d4). The tree is clean again, nothing is committed, and the clean tree replays the same as the references (tier 1 exit 0 in all three browsers). Output is in `~/github/pretext-rebuild/.artifacts/session/recipe-costs-20260918/browser/`. This report gives numbers and the completed ranking only. It decides nothing, and nothing was removed from the library.

## 1. What ran

- **30 of the allowed 30 `browser-sets.ts` runs** were used. There were at most 3 at once, one per browser, in forward order and in background windows. Pinned Chrome 153.0.8010.50, Firefox 156.0, webkit-host 22625.1.29.11.27. Installed Safari was never used.
- The browser jobs ran from 19:47 to 20:19, about 32 minutes of the 2.5 hours allowed. Free memory stayed near 70%.
- No job failed and nothing was run twice. Nothing was recorded, seeded, frozen, packed or adopted.
- **No both-orders run was needed.** In every run that has a control, the browser's own layout of every case is identical between the control row and the ablated row. The count of cases where native layout differs from the control is 0 in all of them.
- **Patches.**
  - Every engine patch (`B*`, `G*`, `W*`, `W-T1`) still applies with `git apply`.
  - The font-check patches (`S2`, `S4+S3`, `S5+S1`, `S-all`) and the Blink half of `H-hyphen-compare-off` no longer apply. `learnedFacts` now reads a per-engine `FontChecks` object, and `shapeHyphen` changed with the string storage fix.
  - I rebuilt them by hand with the same meaning:
    - S4 Blink off: `opticalSizeAxis: null` in `engines/blink/checks.ts`.
    - S5 Blink off: `joining: false` there.
    - S3 WebKit off: `monospace: false` in `engines/webkit/checks.ts`, plus `W-T1`.
    - S2 off: `mapsHyphen: false` in the engine's `checks.ts`, plus that engine's half of H. For Blink that is `raw16 < 0 &&` in front of the U+002D compare, so the one-byte `-` string is no longer asked. No string's storage is changed.
  - The rebased patches are in `browser/patches/`.
- **Each re-applied patch was checked offline first.** I ran the smoke set, then the whole reference (`replay.ts check`), and compared with the offline report. Summaries are in `browser/tier1/`.
  - The cases that ask a new question are **exactly the saved id files** in every state.
  - Examples: G2 397 cases and 2 changed; G3 1,769 and 84; B1b 972; B3 188; S5 3,325 plus 7 new `twins` cases; S3 3,481 and 329; W1b 12 and 19; W2 55 and 221; W3 148; B4 53 plus 1; B6 579; B11 89; S2 60 and 64; B3w 25,368 plus the `twins`.
- **A patch was in effect wherever no status moved.** Every run's library bundle differs from the control's. Row by row, the ablated rows ask fewer Canvas calls:
  - B1b: 969 of 972 rows ask fewer calls, 167,475 → 136,019 in total.
  - B6: 579 of 579.
  - S2 WebKit: 64 of 64.
- One Chrome, Firefox or webkit-host run in a state uses a tree where the other engines' patches are applied too. The ports share no file, so each browser sees only its own patch.

## 2. Words used

- **Case:** one set-and-id pair of the tier corpus, as the ledger counts them. An id can sit in two sets, which is why 395 ids are 397 cases.
- **Status change:** the case's status on line count, breaks or widths differs from the frozen reference ledger. Painter and exact-value changes are counted apart.
- **Also in control:** the same case and metric also changes in the control run, which is the same browser with no patch. The ablation didn't cause that change.
- **Lost:** pass → a failure. It is counted once per case at its first metric in the order line count, breaks, widths, as the offline table does.
- **Gained:** a failure → pass.
- **Moved:** wrong before and after, and the predicted lines differ between the control row and the ablated row.
- **Renamed:** only the names of the covering gaps changed, and the predicted lines are the same.
- **Width error:** the largest difference between a predicted line width and the native extent the scorer compares it with, in CSS px.
- **Exact-value status:** whether every value the library claims as predicted equals the browser's.
- **Stand-in (limited) values:** values the library reports but doesn't claim. They never block.

## 3. Controls (no patch)

| Control | Cases | Status transitions against the frozen ledger |
|---|---|---|
| Chrome, union of its no-facts id files without B3w's (5,089 ids) | 5,107 | 0 |
| Firefox, union (2,027 ids) | 2,035 | 0 |
| webkit-host, union (3,740 ids) | 3,769 | 1 case |
| Firefox, the 49,662 ids G1b changes (Gecko unpatched) | 49,910 | 0 |
| Chrome with facts, union of B3's and B6's facts ids | 189 | 0 |
| webkit-host with facts, W2's ids | 55 | 0 |

- The one webkit-host case is `rich-prewrap/c-a56567ebdd83c21a`. A `page-history` failure passes because the subset has another history.
- The S3 run is the only ablation run in which that case shows up. It is set aside there.

## 4. Per candidate, in the order asked

Every width loss below is 0.1 px or more unless said otherwise. No lost width was under 1/64 px or under 0.1 px in any run. "In control" is 0 everywhere except the one S3 case above.

### (1) Gecko's ligature tests (Firefox)

| | G2 ink box off | G3 group count off | G2+G3+G1b+G5+G6 off (state 18) |
|---|---|---|---|
| Patch | `G2-ligature-ink-box-off` | `G3-ligature-group-count-off` | the four patches |
| Cases run (all that couldn't replay) | 397 | 1,769 | 2,020 |
| Status changed / also in control | 28 / 0 | 39 / 0 | 76 / 0 |
| Lost (line count / breaks / widths) | **28** (5 / 8 / 15) | **39** (5 / 11 / 23) | **66** (10 / 19 / 37) |
| Width error of lost widths, min / median / max | 0.18 / 0.53 / 1.27 px | 0.68 / 1.62 / 4.80 px | 0.18 / 1.15 / 4.80 px |
| Gained / moved / renamed | 0 / 2 / 0 | 0 / 6 / 0 | 0 / 8 / 2 |
| Stopped being exact | 12, all in lost cases | 11, all in lost cases | 23, all in lost cases |
| Painter pass → failure | 10, all in lost cases | 1 | 11 |
| Differing stand-in values (never blocking) | 3,665 → 6,031; more in 379 of the 397 cases | 15,731 → 23,097; more in 1,455 cases | 18,116 → 27,767; more in 1,752 cases |
| Canvas calls on these cases | 91,306 → 51,177 | 408,705 → 320,329 | 463,082 → 128,567 |

**Lost families**
- G2: rule/in-word-breaks 11, suite/word 6, suite/latin 6, suite/physical-text-geometry 2, policy/emoji 1, suite/measurement 1, policy/overflow-wrap 1.
- G3: suite/joined 11, suite/source-shaped-arabic 7, runs/bidi-runs 5, runs/split-word 5, policy/word-break 3, runs/word-spacing-spans 3, suite/joined-plain 3, runs/mixed-fonts-sizes 1, suite/space 1.

**Examples, G2**
- Line count: `families/c-089d984f7a0da40e`, "x ffiffiffiffiffiffi y", 24px Hoefler Text, 40.78 px wide, overflow-wrap break-word. Native and control 7 lines; ablated 5.
- Line count: `suite-sample/c-8b93d57e539164e4`, "officially", 16px Amiri, 12.7 px wide. Native 6; ablated 5.
- Breaks: `suite-sample/c-95435365991378b6`, "officially", 16px Shantell Sans, 23.23 px wide. Line ends 1,4,7,10 become 3,6,9,10.
- Breaks: `heldout-suite-sample/c-a631c04c0ba2f5f2`, "ffifflffi", 16px Amiri. Ends 3,6,9 become 4,8,9.
- Widths: `suite-sample/c-16d36abbd59581eb`, "ffiffl", 700 16px ProbeShantell, 7 px wide. Line 0 predicted 6.52 px, native 6.00 px.
- Widths: `heldout-policy/c-a9848b39b9a187fd`, keycaps and flags, 12px Hiragino Sans. 4.62 px against 3.70 px.

**Examples, G3**
- Line count: `heldout-suite-sample/c-4b9d2c300c79c39d`, "aسلام((tail", 16px Arial, 24 px wide, pre-wrap. Native 4; ablated 3.
- Line count: `heldout-runs/c-5fc088c2c42b6fa3`, Arabic across three fonts, 8 px wide, rtl. 18 lines become 17.
- Breaks: `heldout-policy/c-05425a4a68b089c3`, the basmala, 14px Geeza Pro, break-all, rtl, 32 px wide. First line end 8 becomes 9.
- Widths: `heldout-runs/c-e4e8e68e1f988509`, Devanagari, Kohinoor, 1 px wide. 3.6 px against 6.5 px on line 22.

**What the no-facts run hides**
- With G2 off, nearly every one of these cases holds more differing stand-in values.
- With no facts they sit under `optical-size` and never block.
- With font facts, Firefox claims 95% of its values, so they would be exact-value losses there.
- No facts id file exists for G2 or G3, and I had no run left for one.

### (2) Blink's safe test for 256 px cuts (Chrome)

- **B1b** (`B1b-cuts-no-safe-test`): 972 cases ran.
  - **0 status transitions, 0 exact-value changes and 0 painter changes.**
  - No predicted line start, end or width differs from the control in any case.
  - Row by row, the layouts differ in 422 cases, all in gap lists. 4 rows differ inside a line record: a cluster advance by 1/65536 px, a run count, a limit flag.
  - No value a page can read differs.
  - Canvas calls on these cases: 167,475 → 136,019.
- **B1a** (`B1a-cuts-space-candidates-first`) has no unreplayable case.
  - I ran the 20,165 cases whose prediction or questions it changes. That is the order-of-questions check tier 1 asks for in Chrome.
  - **0 transitions of any kind**, and 0 exact-value changes.
  - No control exists for those ids. None was needed, because nothing moved.

### (3) Blink's position adjustment B3 (Chrome), the unreplayable part

| | no facts | with the lab's facts |
|---|---|---|
| Patch | `B3-no-position-adjustment` | the same |
| Cases run | 188 | 81 |
| Status changed / in control | 170 / 0 | 64 / 0 |
| Lost (line count / breaks / widths) | **92** (83 / 9 / 0) | **34** (18 / 16 / 0) |
| Gained | **78** (77 line count, 1 breaks) | **30** (29 / 1) |
| Moved | 10 | 9 |
| Stopped being exact | 92, all in lost cases | 34, all in lost cases |
| Differing predicted values | 6 → 68 | 7 → 350 |
| Painter pass → failure | 24 | 8 |
| Canvas calls on these cases | 11,847 → 12,355 (more) | 3,973 → 4,126 (more) |

- **Lost families, no facts:** rule/text-align 32, rule/following-space 32, rule/in-word-breaks 16, rule/hyphen-glyph 4, and 8 others with 1 or 2 each.
- **Gained families, no facts:** rule/following-space 16, rule/text-align 16, rule/in-word-breaks 8, rule/hyphen-glyph 4.
- The unreplayable part is close to a wash. The adjustment is right for one twin of a pair and wrong for the other.
  - Lost: `features/c-07edc35c22f24f4d`, "xx AAAA bbbb cc dddd", 20px Times New Roman, 81.117 px wide, pre-wrap, rtl. Native and control 3 lines; ablated 4 (ends 3,8,16,20).
  - Gained: `features/c-0e13f2d461e229f5`, the same text left-to-right, 81.109 px wide. Native 4 lines; the frozen library says 3; ablated 4.
  - Lost: `features/c-0884ded439a1566d`, "xx LYAY   bbbb cc dddd", 20px Arial, rtl. 3 lines become 4.
- **Moved:** `suite-sample/c-66fc2d8021550c7c`, "ب" soft hyphen "ب" U+200B "ب", 16px Amiri, 3 px wide. Native 5 lines, predicted 3 before and after, with other breaks.
- **Offline plus browser, no facts:** 329 + 92 = **421 lost**, 18 + 78 = **96 gained**, 259 moved.
- **Offline plus browser, with facts:** 694 + 34 = **728 lost**, 14 + 30 = 44 gained.

### (4) Blink's optical-size check and joining check (Chrome)

**S4, optical-size check off** (`opticalSizeAxis: null`)
- It has no unreplayable case, but it changes the questions of nearly every case. I ran all **67,065** cases.
- **0 passes lost, 0 cases stop being exact.**
- 1,017 cases change status, all renames. `optical-size` joins the covering names of failures that already existed (344 line count, 413 breaks, 603 widths, 1,166 painter).
- The line's one open breaks failure (`c-a37545c096e939be`) and 6 open painter failures now count as covered by `optical-size`.
- **What S4 buys in claimed values** (the offline report couldn't say):
  - Predicted values fall from **589,411 to 483,286**. That is 106,125 or 18.0%, which turn into stand-ins.
  - Differing predicted values go 266 → 258, because 8 wrong ones became stand-ins too.
  - 3 cases go from not exact to exact for that reason.

**S5, joining check off** (`joining: false`): 3,325 cases ran.
- 2,945 changed status, 0 in control.
- **Lost 2,225** (890 line count, 207 breaks, 1,128 widths). Width error min / median / max: 0.17 / 7.95 / 23.4 px, with 29 under 1 px.
- 711 moved, 14 gained (8 rule/joining, 4 suite/U+FFFC/start, 2 suite/source-shaped-arabic), 330 changed while still passing.
- 1,049 stopped being exact, all in cases with a failing or unobserved metric.
- Differing predicted values 28 → 562; differing rect counts 198 → 2,557.
- 160 painter passes lost, 17 of them in cases that aren't lost.
- Canvas calls on these cases: 129,240 → 121,085.
- **Lost families:**
  - rule/joining 356.
  - suite/U+XXXX/start, /middle, /end 1,581. These put a control or format character beside joined letters.
  - Other suites 276: original-vs-reshaped-admission 42, barrier 27, joined 24, raw-context 24, joined-plain 23, source-shaped-arabic 19, joined-mark 18, glue 13.
  - runs/split-word 11, runs/span-at-space 1.
- This agrees with the earlier browser figure in FACTS-FREE.md of 2,183 lost without the joining fact.
- **Examples:**
  - Line count: `smoke/c-1cb8b9aea80ececb`, "ب" soft hyphen "ب" U+001C, 16px Arial, 15.35 px, pre-wrap, rtl. Native 3 lines; ablated 2.
  - Line count: `smoke/c-be7f6b754e4527ff`, the same with U+001E, 16px Noto Naskh Arabic, 8 px wide. 4 lines become 3.
  - Breaks: `heldout-runs/c-2476b8d53b98cc88`, the basmala across Geeza Pro sizes, 32 px wide, rtl. Line end 36 becomes 35.
  - Widths: `smoke/c-26a7a7b28da24b44`, "سلام((tail", 24px Amiri, 8 px wide. Line 0 predicted 23.8 px, native 13.6 px.
  - Gained: `suite-sample/c-953cd163ccdd57d3`, U+FFFC "ب" soft hyphen "ب", Amiri. Native 3 lines; the frozen library says 2; ablated 3.

### (5) WebKit's fixed-pitch check, W1a and W1b (webkit-host)

**S3 with W-T1** (`monospace: false` plus `W-T1-fixed-pitch-test-off`): 3,481 cases ran.
- 22 changed status, 1 of them in control (the page-history case, which shows as the 1 gained).
- **Lost 21** (2 line count, 2 breaks, 17 widths). Width errors 8.4 to 19.3 px, median 10.8. Each is one fixed-pitch advance given to a CR or missing from it.
- 10 stopped being exact, all in lost cases. 21 painter passes lost, all in lost cases.
- Families: ws/controls 12, ws/text-nodes 9. Every one has a CR in Menlo or Courier New.
- Canvas calls on these cases: 186,921 → 81,149.
- The earlier figure in FACTS-FREE.md was 30 lost without the monospace fact.
- Examples:
  - `ws/c-8a673dda2d5fbcc0`, "alpha beta gamma delta epsilon zeta\r\n", 18px Menlo, 136 px wide. Native 4 lines; ablated 3.
  - `heldout-ws/c-a973ae589968a8e3`, "her\r\rVisit", Arial, Menlo and Verdana, 40 px wide. Ends 4,7,10 become 5,8,10.
  - `heldout-ws/c-4cd447ec7bac5c22`, "\ralpha beta …", 14px Menlo, pre-line. Line 0 predicted 185.43 px, native 193.86 px.

**W1a** (`W1a-assume-a-listed-family-resolves`): no unreplayable case. I ran the 4,718 cases whose questions it drops. **0 transitions, 0 exact-value changes.**

**W1b** (`W1b-assume-primary-font-covers`): 12 cases ran.
- **Lost 5** (2 line count, 3 breaks). 5 stopped being exact and 5 painter passes lost, all in those cases.
- Families: runs/word-spacing-spans 4, ws/trailing-space-edge 1.
- Every one is Menlo with a character Menlo lacks (U+3000, "…").
- Examples:
  - `runs/c-c6f39833670ff5d9`, "I wanted　to be alone. But Jordan lingered", 18px Menlo, 456 px wide. Native 2 lines; ablated 1.
  - `runs/c-d985d3d16e347584`, "naïve café … façade　jalapeño Zürich", 20px Menlo, 184 px wide. Line end 35 becomes 44.

### (6) Gecko's mid-word crossing measure G1b (Firefox)

- Patch `G1b-across-only-where-it-decides`. It has no unreplayable case.
- I ran the 49,910 cases whose prediction or questions it changes, plus a control of the same ids with Gecko unpatched.
- **0 passes lost, 0 exact-value changes, 0 predicted lines differ from the control.**
- 1,199 cases are renamed. `in-word-prefix` leaves the covering names of failures that stay covered by `optical-size` (49 line count, 97 breaks, 1,102 widths, 1,655 painter). Nothing becomes open.
- 9,228 rows differ in the layout record, none in a value a page can read.
- Canvas calls on these cases: 4,296,282 → 3,771,509.
- This is the no-facts configuration only. Offline, with facts, G1b named 2,897 real differences.

### The remaining states with an id file

| Recipe (patch), browser | Cases run | Status changed (in control) | Lost (line count / breaks / widths) | Gained / moved | Stopped being exact | Notes |
|---|---|---|---|---|---|---|
| W2 merged glyphs (`W2-merged-glyphs-off`), webkit-host | 55 | 55 (0) | **43** (20 / 9 / 14); widths 0.5 to 20.2 px, median 1.0 | 0 / 12 | 46 | families: rule/in-word-breaks 23, runs/letter-spacing-spans 10, suite/ligature-thresholds-v3 4; calls 3,867 → 1,022 |
| W2, webkit-host with facts | 55 | 55 (0) | **43** (20 / 9 / 14) | 0 / 12 | 51 | the same cases as with no facts |
| W3 VT, FF, CR (`W3-controls-never-pieced`), webkit-host | 148 | 131 (0) | **105** (24 / 24 / 57); widths 0.30 to 0.89 px | 0 / 40 | 65 | rule/controls 104 |
| B4+B5 safe-to-break (`B4-no-canvas-safe-to-break`), Chrome | 53 | 44 (0) | **43** (5 / 23 / 15); widths 0.29 to 2.19 px | 0 / 1 | 28 | 16 families; policy/line-break 7 and rule/in-word-breaks 7 lead |
| B6 no-ligature window (`B6-no-ligature-window-off`), Chrome | 579 | 0 | 0 | 0 / 0 | 0 | rows differ in gap lists only |
| B6, Chrome with facts | 108 | 0 | 0 | 0 / 0 | 0 | the same |
| W6 shaping across boxes (`W6-no-shaping-across-boxes`), webkit-host | 19 | 17 (0) | **13** (6 / 6 / 1) | 1 / 3 | 19, 3 of them in cases whose metrics all pass | rule/joining 11, runs/bidi-runs 2 |
| B11 HanKerning (`B11-hankerning-off`), Chrome | 89 | 89 (0) | **89** (32 / 57 / 0) | 0 / 0 | 88 | runs/lang-spans 47, rule/hankerning 16, policy/line-break 10 |
| S2 hyphen check, Chrome (`mapsHyphen: false` plus H) | 60 | 16 (0) | **16** (12 / 0 / 4); widths 4.4 to 6.5 px | 0 / 0 | 20 | all rule/joining in Geeza Pro, which doesn't map U+2010; 16 more cases change widths and still pass |
| S2 hyphen check, webkit-host | 64 | 0 | 0 | 0 / 0 | 0 | see below |
| B3w wide window before spaces (`B3w-no-wide-window-in-positions`), Chrome | 25,368 | 1 (0) | **1** (widths, 3.7 px on line 188 of 206) | 0 / 0 | 0 | see below |

**S2, webkit-host:** in 24 of the 64 cases the painted hyphen string turns from "-" into U+2010. No metric or value moves.

**B3w, Chrome**
- The lost case is `suite-sample/c-d5c9e88814700c97`, the 13,391-unit Urdu Nastaliq corpus.
- The Chrome union control covers it.
- 6 cases hold more differing stand-in values.

**More examples**
- W2: `suite-sample/c-24900e4171b853f4`, "office", 700 16px ProbeShantell, letter-spacing −4px, 12.53 px wide. Native 2 lines; ablated 3.
- W2: `families/c-0aebcceaca66e77e`, "x ffiffiffiffiffiffi y", 16px Hoefler Text, letter-spacing 1px, break-all. Ends 7,15,22 become 9,18,22.
- W3: `families/c-191547c6459d1ee3`, "aaaa A\rV bbbb cc", 16px Helvetica Neue, break-spaces, 63.39 px wide. Native 3 lines; ablated 2.
- W3: `families/c-078e66d08ed922ef`, the same with FF, Arial. 112.23 px against 112.54 px.
- B4: `suite-sample/c-8b93d57e539164e4`, "officially", 16px Amiri, 12.7 px wide. 6 lines become 5.
- B4: `smoke/c-1c1ba484eff464b1`, small kana, 20px Hiragino Sans, 219.5 px wide. Line end 10 becomes 11.
- W6: `families/c-1ee9545c66a800c2`, "بب بببببب بب", 16px Arial, letter-spacing 1px on spans, 30.94 px wide. 3 lines become 4.
- B11: `heldout-policy/c-f0cb4a3c35565f55`, "「日本語」。、！？……——（中文）", 20px Hiragino Sans, 132 px wide. 3 lines become 4.
- S2 Chrome: `families/c-1b3c3754e73b8304`, "بب ببب" soft hyphen "ببب بب", 16px Geeza Pro, 50.41 px wide. Native 3 lines; ablated 2.

## 5. The completed ranking

**How to read it**
- Canvas calls saved per 10,000 cases come from the offline table, with its denominators: Chrome 66,685 cases, Firefox 63,771, webkit-host 63,987.
- Cases lost = the offline table's lost cases plus the browser's lost cases among those that couldn't replay.
- Price = calls saved per 10,000 ÷ cases lost per 10,000.
- The corpus is adversarial. It is built from rule families and suites aimed at these very recipes. These are rates over that corpus and say nothing about how often ordinary text would lose a line.

**Cheapest to keep first**

| Rank | Recipe | Calls saved /10k (share of the engine's calls) | Lost offline | Lost in the browser | Lost in all | Lost /10k | Gained in all | Calls per case bought |
|---|---|---|---|---|---|---|---|---|
| 1 | B4+B5 safe-to-break tests and reshapes (Blink) | 831 (0.1%) | 1,213 | 43 of 53 | 1,256 | 188.3 | 0 | 4 |
| 2 | W6 shaping across inline boxes (WebKit) | 209 (0.1%) | 201 | 13 of 19 | 214 | 33.4 | 1 | 6 |
| 3 | W3 VT, FF and CR (WebKit) | 205 (0.1%) | 6 | 105 of 148 | 111 | 17.3 | 0 | 12 |
| 4 | S5 joining check (Blink) | 8,107 (0.8%) | 1 | 2,225 of 3,325 | 2,226 | 333.8 | 14 | 24 |
| 5 | B3 position adjustment (Blink), with facts | 33,699 (3.7%) | 694 | 34 of 81 | 728 | 109.2 | 44 | 309 |
| 6 | B11 HanKerning (Blink) | 26,123 (2.6%) | 133 | 89 of 89 | 222 | 33.3 | 0 | 785 |
| 7 | B3 position adjustment (Blink), no facts | 144,617 (14.4%) | 329 | 92 of 188 | 421 | 63.1 | 96 | 2,291 |
| 8 | S2 hyphen check (Blink) | 7,874 (0.8%) | 0 | 16 of 60 | 16 | 2.4 | 0 | 3,282 |
| 9 | W2 merged glyphs (WebKit) | 29,146 (9.2%) | 0 (6 names) | 43 of 55 | 43 | 6.7 | 0 | 4,337 |
| 10 | W1b coverage probe (WebKit) | 27,442 (8.6%) | 19 | 5 of 12 | 24 | 3.8 | 0 | 7,316 |
| 11 | G3 ligature groups by letter spacing (Gecko) | 89,609 (12.8%) | 11 | 39 of 1,769 | 50 | 7.8 | 0 | 11,429 |
| 12 | B3w wide window before spaces (Blink) | 1,872 (0.3%), a floor | 0 | 1 of 25,368 | 1 | 0.1 | 0 | 12,483, a floor |
| 13 | S3 fixed-pitch check with W-T1 (WebKit) | 75,483 (24.7%) | 0 | 21 of 3,481 | 21 | 3.3 | 0 | 23,000 |
| 14 | G2+G3+G1b+G5+G6 together (Gecko) | 427,551 (61.9%) | 12 | 66 of 2,020 | 78 | 12.2 | 0 | 34,956 |
| 15 | G2 ligature ink box (Gecko) | 265,753 (36.3%) | 0 | 28 of 397 | 28 | 4.4 | 0 | 60,526 |

- B3 no facts: the net is 325 cases lost, which is 2,968 calls per net case.
- B3w's saving is a floor because offline it was measured over the 41,317 cases that replayed.

**Nothing lost, offline or in the browser**

| Recipe | Calls saved /10k | Browser cases run | What did change |
|---|---|---|---|
| S4 optical-size check (Blink) | 106,119 (10.6%) | 67,065, all of them | 106,125 predicted values (18.0%) become stand-ins; `optical-size` joins 1,017 failing cases' names; 7 open failures become covered |
| B1b cut safe test (Blink) | 119,620 (12.1%) | 972 | gap lists in 422 cases |
| B6 no-ligature window (Blink) | 97,455 (10.1%) | 579, and 108 with facts | gap lists; offline it covered 9 items |
| G1b mid-word crossing (Gecko), no facts | 82,291 (11.1%) | 49,910 | 1,199 failing cases lose the name `in-word-prefix`; with facts it named 2,897 real differences offline |
| B1a safe tests beside spaces first (Blink) | 50,875 (5.1%) | 20,165 | nothing |
| S2 hyphen check (WebKit) | 8,156 (2.6%) | 64 | the painted hyphen string in 24 cases |
| W1a a listed family resolves (WebKit) | 1,895 (0.6%) | 4,718 | nothing |

**Against the offline ranking's "at best" prices**
- S5 moves to 24 calls per case. The offline table had 15 at best, if every unreplayable case were lost.
- S3 moves to 23,000 (131 at best).
- B1b has no price at all (809 at best).
- G2 moves to 60,526 (4,242 at best).
- G3 moves to 11,429 (312 at best).
- W3 moves to 12 (8.5 at best).
- W2 moves to 4,337 (3,055 at best).
- S2 Blink moves to 3,282 (870 at best).

## 6. What I couldn't run, and why

1. **S-all (state 13, Chrome 3,383 ids and webkit-host 3,516).**
   - No runs were left.
   - Its id files are the unions of S5's and S2's (Chrome) and of S3's and S2's (WebKit), which ran one by one.
   - An interaction between the checks is the only thing it could add.
2. **A Firefox facts run of G2, G3 and the combined state.**
   - No facts id file exists, because the offline job never replayed them with facts. I had no run left to make one.
   - It matters. With no facts, the loss of G2 and G3 shows mostly as stand-in values that stopped agreeing: 379 of 397 cases, and 1,455 of 1,769.
   - With facts those values are claimed, so the exact-value status would count them.
3. **Controls for B1a's and W1a's changed-question sets, for S4's whole-corpus run and for B3w's 25,368 cases.**
   - They weren't needed for attribution. B1a and W1a moved nothing, S4's changes are renames by `optical-size`, and the union control covers B3w's one changed case.
   - Without them, "predicted lines differ while the status stays" couldn't be counted for cases outside the union control. For B3w that is 973 of 25,368 cases compared, with none differing.
4. **How many Canvas calls B3w saves.**
   - 38% of Chrome's cases couldn't replay with it off, and I ran no control of those cases to count calls against.
5. **The 7 `twins` cases that now ask a new question under S5, the 1 under B4, the 2 under B3 with facts and the 169 under B3w.**
   - The set joined after the id files were saved.
   - I ran the saved files so that the control covers every case.
6. **Reverse order.**
   - It wasn't run, because no result looked order-dependent: native layouts equal the control's in every compared row.
   - Chrome's question-order check for B1a, B1b, B6 and S4 is the forward run itself, with 0 moved.
7. **Still outside any ablation.**
   - Recipes with no drop-only fallback: B2, the 256 px cut itself, per-script-segment measuring, U+200D edges, per-language contexts, G1a, G9 and W7. They need a recording run, which this job may not make.
   - Wall time per call.
   - The Canvas checks.

## 7. Files (all under `~/github/pretext-rebuild/.artifacts/session/recipe-costs-20260918/browser/`)

- `logs/runs.tsv`: the 30 runs with the time and the working-tree diff each ran under.
- `logs/<state>-<browser>.log`: each run's full transitions print. `logs/*tier1*.log`: the offline checks.
- `<state>-<browser>/` and `control*-<browser>/`: the runs (ledger, `transitions.json`, per-case files). All 184 row files over 1 MB are compressed (`zstd -3 -T3`), the round trip was compared byte for byte, and the originals went to the Trash. The folder is 927 MB.
- `patches/*.rebased.patch`: the working-tree diff of every state as run.
- `tier1/`: per state and browser, the offline check's counts, changed predictions and new-question ids, each compared with the saved id file.
- `ids/`: the control unions and the changed-case id lists for B1a, G1b, W1a and S4.
- `analysis/<run>.json` and `.txt`: per-run classes, families, width errors, exact-value and painter counts, lost ids and examples. `analysis/row-diff.txt`: Canvas calls before and after, and what differs row by row.
- `tools/`: `run.sh`, `analyze.ts` (it defines every class in its header), `row-diff.py`, `keep-tier1.py`, `changed-ids.py`, `show.py`, `examples.py`, `compress-rows.sh`.
- The worktree's untracked `rebuild/tests/.check` folder went to the Trash.
- Nothing under `rebuild/tests/baselines`, `rebuild/tests/reference` or `.artifacts/tests/reference` was written.
