# Main's passing cases against the rebuild, refreshed (2026-09-19)

The maintainer asked: "do we pass all or almost all of main's non-accidentally-passing cases?" The census's main-only lists were run through the library at the X2 merge (f474123) in the three pinned browsers, in both configurations, and counted by the triage's classes (`MAIN-TRIAGE.md`); a second agent then recomputed every number from the rows. The check comes first, because it corrects the run in two places.

## The independent check

Independent check of the main comparison (2026-09-19)

### Answer to the maintainer

Almost all, but not all. With no supplied font facts, today's rebuild still fails 344 Chrome, 164 to 202 Firefox and 263 webkit-host cases that main passes non-accidentally. That is 0.1% to 0.2% of main's passing line counts (176,139 / 190,690 / 180,602), or 78, 87 to 95 and 263 with the lab's font facts, and every one fails under a gap the rebuild reports.

Two things the numbers don't settle:
- 1,320 webkit-host cases whose native layout depends on the document. Main matched the census's long documents; the rebuild matches fresh ones.
- Regressions outside the old lists. Only a gated 30,000-case sample bounds them, and it shows none.

Terms:
- A **case** is one styled paragraph at one width.
- **Main passes** means its line count equals the native count. For a case where only breaks differ, its visible breaks must also not fail (MAIN-TRIAGE.md).
- **The rebuild passes now** means the lab scorer (scorer 7) gives both `lineCount` and `breaks` the status pass.
- **Non-accidental** is the triage's "fact to learn": main passes everything observable.
- **Accidental** is one of three things: right count with wrong breaks, zero-width characters on other lines (provisional), or main's own page history.
- **Covered** is the scorer's `lineGaps[metric].covered`: every failing line sits under a gap the rebuild's layout reports.
- **No facts** is the headline configuration, `rebuild/lab/baselines/no-facts-predictor.ts`.
- **Facts** supplies the lab's font facts through `rebuild/lab/predictor.ts`. The triage and round 2 ran this configuration.

### What I checked, and how

- **Library and predictor.**
  - I rebuilt the lab page bundle offline from the worktree at f474123, with nothing uncommitted, the same way `run.ts` does.
  - The hashes are `b68bf558c0a7…` with the no-facts predictor and `3a7d43cb9e2f…` with `predictor.ts`. They equal the six `run.json` records and the frozen ledgers' bundles.
  - `rebuild/src` and `rebuild/lab` have no diff between 0163d4c and f474123.
  - The headline runs record the no-facts predictor, which gives every font `UNKNOWN_FONT_FACTS`.
- **Runs.**
  - All six records have status ok and no errors. Row counts are 1,194 / 768 / 2,056, with no native, prediction or painter errors and no resends.
  - Browsers were pinned Chrome 153.0.8010.50, pinned Firefox 156.0 and webkit-host 22625.1.29.11.27, at DPR 2, in file order.
- **Case files.**
  - They equal the union of the census main-only list, the triage population and the round 2 records.
  - The census lists of 1,191 / 731 / 2,056 are fully inside them.
  - The extras are the triage's 3 Chrome and 37 Firefox cases from the evaluation's main-only lists.
  - Round 2's records all sit inside the triage population.
- **Scorer.** I ran `score.ts` again on all six row files (zstd streams, never decompressed in place). The per-case files are byte-identical to the first agent's.
- **Own derivation** (`verify/recount.py`).
  - Native lines come from the raw rects by vertical centre, and the rebuild's count is its number of line boxes.
  - I added a visible-breaks check and a zero-width check of my own.
  - The derivation agrees with the scorer on every line count in all six runs, and native count equals height / line height on every row.
  - Breaks agree on all but 5 Chrome cases. In 3 the scorer is stricter about a code point with rects on two lines; in 2 my simple rule misreads an LRM's rect. None changes a count.
- **Passes now.**
  - A case counted as passing passes both `lineCount` and `breaks`.
  - No row is unobserved or not-applicable on either metric.
- **Main's side.**
  - I read main's recorded rows from their original runs, not the first agent's copies. Chrome's are the round 2 evaluation's on .50; Firefox's and webkit-host's are the triage runs'.
  - I classified them against today's native lines with my own rule.
  - Main's forward and reverse predictions differ on 152 Chrome cases and on none elsewhere, as the triage said.

### Numbers, side by side

"First" is the first agent's number and "mine" is my recount. Every pair is equal unless noted.

### Chrome (1,194 cases)

| | No facts: first / mine | Facts: first / mine |
|---|---|---|
| Passes line count | 934 / 934 | 1,064 / 1,064 |
| Passes both | 728 / 728 | 1,020 / 1,020 |
| Still fails (line count, breaks only) | 466 (260, 206) / same | 174 (130, 44) / same |
| Facts to learn, triage class | 344 / 344 | 78 / 78 |
| Right count, wrong breaks | 98 / 98 | 76 / 76 |
| Zero-width elsewhere | 24 / 24 | 20 / 20 |
| History, opinion, outside the triage population | 0 / 0 | 0 / 0 |
| By today's rows: fact / accidental | 344 / 122, same | 78 / 96, same |
| Covered / not covered | 466 / 0, same | 174 / 0, same |

Passing now, by triage class (no facts / facts):
- Facts to learn: 278 / 544 of 622.
- Wrong breaks: 218 / 240.
- Zero-width: 96 / 100.
- History: 9 / 9.
- Opinion: 2 / 2.
- Outside the triage population: 125 / 125.

### Firefox (768 cases)

| | No facts: first / mine | Facts: first / mine |
|---|---|---|
| Passes line count | 530 / 530 | 630 / 630 |
| Passes both | 514 / 514 | 621 / 621 |
| Still fails | 254 (238, 16) / same | 147 (138, 9) / same |
| Facts to learn, triage class | 164 / 164 | 87 / 87 |
| Right count, wrong breaks | 43 / 43 | 43 / 43 |
| Zero-width elsewhere (provisional) | 30 / 30 | 0 / 0 |
| Outside the triage population | 17 / 17 | 17 / 17 |
| By today's rows: fact / accidental | 202 / 52, same | 95 / 52, same |
| Covered / not covered | 254 / 0, same | 147 / 0, same |

- The gap between 164 and 202 is as the first agent described:
  - The 30 old "zero-width elsewhere" cases pass main's zero-width placement against today's rows.
  - 8 of the 17 outside cases are facts to learn.
- All 37 evaluation-only cases pass today.

### webkit-host (2,056 cases, both configurations identical)

| | First | Mine |
|---|---|---|
| Passes line count | 1,921 | 601 of 736 decided, plus 1,320 set aside |
| Passes both | 1,750 | 430 of 736 decided, plus 1,320 set aside |
| Still fails | 306 (135, 171) | 306 (135, 171) |
| Facts to learn / wrong breaks / zero-width | 263 / 39 / 4 | 263 / 39 / 4 |
| By today's rows: fact / accidental | 263 / 43 | 263 / 43 |
| Covered / not covered | 306 / 0 | 306 / 0 |

### Shares of main's census line-count passes

| | Chrome (176,139) | Firefox (190,690) | webkit-host (180,602) |
|---|---|---|---|
| Still fails, no facts | 0.265% | 0.133% | 0.169% |
| Non-accidental, no facts | 0.195% | 0.086% to 0.106% | 0.146% |
| Non-accidental, facts | 0.044% | 0.046% to 0.050% | 0.146% |

- N checks against CENSUS.md as "both pass" plus "main only".
- All failing cases are in main's supported scope, with 3 Chrome and 3 Firefox cases in both scopes.
- The denominator includes main's accidental passes among cases both libraries pass. Nobody classified those, so the shares are slightly low. If a tenth of main's passes were accidental, 0.20% would become 0.22%.

### Other figures confirmed

- **Facts to learn by cause.**
  - My recount equals the first agent's table.
  - Chrome ligature clusters: 245, then 245 without facts and 44 with.
  - Chrome U+2060 before spaces: 54, then 54 and 0.
  - Firefox zero-width line: 82, then 65 and 9.
  - Firefox punctuation after another script: 40, then 33 and 33.
  - Firefox U+202F: 26, then 22 and 22.
  - Firefox ligature clusters: 309, then 1 and 1.
  - WebKit letter-spacing ligatures: 644, then 251.
- **Main passes and the rebuild fails, facts configuration, over time.**
  - At the triage: 1,069 / 745 / 736.
  - At round 2: 420 / 587 / 736.
  - Today: 174 / 147 / 306.
- **Since round 2's rows, facts configuration.**
  - Chrome gained 246 and lost 0.
  - Firefox gained 459 and lost 14.
  - webkit-host gained 430 and lost 0.
- **Required cases.**
  - Chrome `c-9c5a66597ebf5aef` passes in both configurations.
  - Firefox `c-ed263bd4b6656704` passes its line count in both. Its breaks fail without facts and pass with them.
- **Sample bound.**
  - I made my own join of the frozen ledgers at the X2 merge with main's sample runs of 09-16. The ledgers hold the same bundles as today's runs.
  - Sampled cases: 29,985 / 29,879 / 29,924. Main's line count passes on 21,760 / 25,491 / 22,432 of them.
  - Among those, the rebuild's line count fails on 17 / 16 / 18 without facts and 13 / 15 / 18 with. All are inside today's lists.
  - Breaks-only failures outside the lists number 5 / 4 / 4. None is a case where main's breaks pass: main's breaks fail on all but one Firefox case, where they are unobserved.
  - In the ledgers, 246 Firefox and 188 webkit-host sampled cases where main passes are history-dependent, so they are undecided there.

### Corrections to the first report

1. **webkit-host's 1,320 cases outside the triage population aren't passes of main's passing cases.**
   - Today's native lines differ from the census's on all 1,320. 973 have another line count, and 347 have the same count with a visible code point on another line.
   - On every other census case in the three browsers, today's native lines equal the census's.
   - Main's recorded lines fail all 1,320 against today's layout: 973 on count and 347 on breaks.
   - Example: `c-109a381d39bcdbe3`, `a` SHY `b` VT `b`, 16px Arial, 26.65px, pre-wrap.
     - The census's long document gave 2 native lines, and main predicts 2.
     - Today's fresh document gives 3, and the rebuild predicts 3.
   - The rebuild reports `page-history` on all 1,320.
   - The first report disclosed the document dependence under its caveats, but its table counted these cases in "passes line count 1,921" and "passes both 1,750".
   - 108 of the 1,320 are sampled in the frozen ledger's long documents.
     - 41 pass both, 43 are history-dependent and 24 fail under `page-history`.
     - 16 of the 24 fail on line count.
     - "16 of the 16 sampled ones fail" should read 16 line-count failures among 108 sampled.
2. **Firefox's 14 lost cases aren't all Amiri.**
   - 10 are in Amiri: `لألالإلآ` 6 times and `سلامسلام` 4 times.
   - 4 are in Noto Nastaliq Urdu: `الل` SHY `غة` twice and `بِلا` twice.
   - The `للله` cases belong to the other 3 of the 17 outside cases, which already failed breaks at the triage.
   - The count of 14 lost, 8 non-accidental, is confirmed. They passed both metrics at the triage and at round 2, and fail line count now in both configurations under `in-word-prefix`.
3. **Coverage says little by itself.**
   - Without facts, a gap that covers some failure also fires on 691 of 728 passing Chrome cases, all 514 passing Firefox cases and 1,747 of 1,750 passing webkit-host cases.
   - With facts that falls to 863 of 1,020 Chrome cases and 133 of 621 Firefox cases.

Everything else in the first report that I recomputed is equal.

### History dependence

- Today's native lines equal main's session's native lines on every case, in all three browsers and both runs.
- The no-facts run's and the facts run's native lines are equal on every case.
- The 9 Chrome cases classed "main's own history" all pass now, so none sits among the still-failing counts.
- Nothing history-dependent is counted as a failure. The 1,320 webkit-host cases are the ones that must not count as passes.

### Five still-failing facts to learn per browser (no-facts run)

**Chrome**
- `c-002c9461ceb042e1`: `ffiffl`, bold 16px ProbeShantell, 31.01px, pre-wrap.
  - Native `ffiff / l`; rebuild `ffif / fl`; main as native.
  - Breaks only. It passes with facts.
- `c-06218d32a4b76797`: `صلىالله`, 16px Courier New, 8px.
  - Native gives one letter per line, 7 lines.
  - The rebuild gives 6, keeping `له`. It fails with facts too.
- `c-062736d14be7e4a3`: `אב A` U+2060 two spaces `B`, 18px Times New Roman, 12px.
  - Native gives 5 lines, with U+2060 and the spaces on a line of their own.
  - The rebuild gives 4. It passes with facts.
- `c-16f06b3ef08ca7ce`: `VAWAVAV`, 16px Times New Roman, letter spacing −1, 20.98px.
  - Native `VA / W / AV / AV`; rebuild `VA / WA / VA / V`.
  - It passes with facts.
- `c-47d2134e8ab05500`: U+FFFC `ب` SHY `ب`, 16px Arial, 10.95px, pre-wrap.
  - Native gives 3 lines with U+FFFC alone.
  - The rebuild gives 2. It fails with facts too.

**Firefox**
- `c-020bbf41eaa7c78a`: `AVATAR`, 16px Times New Roman, letter spacing 1, 33.55px, pre-wrap.
  - Native `AVA / TAR`; rebuild `AVA / TA / R`.
  - It passes with facts.
- `c-0287698f4cb03727`: `😀 A` SHY `V` ZWSP two spaces `B`, 18px Times New Roman, 12px.
  - Native gives 4 lines, with the ZWSP and spaces at the end of `V`'s line.
  - The rebuild gives them their own line, 5 lines. It passes with facts.
- `c-0eff2962a1de9496`: `ᠠᠡᠢ(x)` U+202F, 16px Arial, 10px.
  - Native gives one letter per line, 6 lines.
  - The rebuild keeps `ᠠᠡ`, 5 lines.
- `c-0157134b8bc06975`: `a` SHY `aabb((بب`, 24px Amiri, 12px, pre-wrap.
  - Native gives 9 lines with `(` and `ب` apart.
  - The rebuild keeps `(ب`, 8 lines.
- `c-19ea0e31766a4fa3`: ZWNJ `ب` SHY `ب`, 16px Amiri, 9.8px, pre-wrap, rtl.
  - Native gives 3 lines with the ZWNJ alone first.
  - The rebuild gives 2.

**webkit-host**
- `c-00f3d9550c6273f2`: `waffles`, bold 16px ProbeShantell, letter spacing 1, 59.18px, pre-wrap. Native `waffl / es`; rebuild `waffle / s`.
- `c-01bcc719801c72b4`: `affinity`, same style, 58.94px. Native `affini / ty`; rebuild `affinit / y`.
- `c-17507d532690c2fa`: `officeoffice`, 16px Shantell Sans, letter spacing 1, 30.05px. Native `off / ice / off / ice`; rebuild `offi / ceo / ffic / e`.
- `c-25ecdf78c92f08c4`: `بِبِ{{office`, 16px Shantell Sans, letter spacing 1, 31.9px. Native `…{ / {of / fice`; rebuild `…{ / {off / ice`.
- `c-49feb03a06bd4b90`: `بِبِ` CR `aabb((بب`, 24px Amiri, 8px.
  - Native gives 10 lines with `b`, `(`, `(` apart.
  - The rebuild keeps `b((`, 8 lines.
  - Only `page-history` covers it, and that gap doesn't name this miss.

In all 15, main's recorded lines equal the native lines.

### What stays open

- **Regressions outside the old lists.**
  - Only cases the rebuild failed on 09-16/17 were run.
  - The sample join finds none outside, but those samples are gated development sets and no unseen suite case is left.
- **Main was not run again.**
  - Its lines are recorded rows of 09-17, and Chrome's depend on its page history.
  - Against today's native lines, main's recorded line count fails only on 2 Chrome cases outside the 1,320 webkit-host ones. Both pass for the rebuild.
- **Coverage of the runs.**
  - File order only, one run per configuration, one Mac at DPR 2.
  - Installed Safari was not run.
  - Widths and the painter were not compared.

I made no browser runs, because every number reproduced from the rows. Nothing was committed and the worktree is clean. No frozen reference, ledger, baseline or seed was touched. My scripts and outputs are under `verify/` in the output folder.

### What the check couldn't settle

- The first report's webkit-host table counts 1,320 history-dependent cases as passes (1,921 line count, 1,750 both). Today's native lines differ from the census's on all 1,320, and main's recorded lines fail all of them against today's layout. Decided webkit-host cases are 736: 430 pass both, 306 fail. The still-failing counts don't change.
- The first report's '16 of the 16 sampled ones fail line count under page-history' is misleading. 108 of the 1,320 are sampled in the frozen ledger's long documents: 41 pass both, 43 are history-dependent, and 24 fail under page-history, 16 of them on line count.
- Firefox's 14 cases lost since round 2 are not all in Amiri. 10 are Amiri (`لألالإلآ` 6 times, `سلامسلام` 4 times) and 4 are Noto Nastaliq Urdu (`الل` SHY `غة` twice, `بِلا` twice). `للله` belongs to 3 other cases that already failed breaks at the triage. The count of 14, with 8 non-accidental, is confirmed.
- Firefox's non-accidental count depends on the classification: 164 / 87 by the triage's classes of 09-17, 202 / 95 by the rule applied to today's rows. My own rule on main's recorded rows reproduces 202 / 95.
- The share denominators (176,139 / 190,690 / 180,602) are all of main's census line-count passes, including accidental passes among cases both libraries pass, which nobody classified. The shares are therefore slightly low, but they stay near 0.2% under any plausible accidental share.
- Coverage is weak evidence. Without facts, gaps that cover some failure also fire on 691 of 728 passing Chrome cases, all 514 passing Firefox cases and 1,747 of 1,750 passing webkit-host cases.
- Regressions outside the old main-only lists remain unobserved. My join of the frozen ledgers at the X2 merge (same bundles as today's runs) with main's sample runs finds none among about 30,000 sampled cases per browser. Those samples are gated development sets, and no unseen suite case is left.
- Main was not run again. Its lines are recorded rows of 2026-09-17, and Chrome's are the round 2 evaluation's rows on .50. Chrome main's predictions depend on page history: 152 differ between orders. Today's native lines equal main's session's on every case.
- My simple native-line derivation disagrees with the scorer's breaks on 5 Chrome cases. In 3 the scorer is stricter about a code point with rects on two lines; in 2 my rule misreads an LRM's rect. Line counts agree on every row of all six runs.
- No browser runs were made, because every number reproduced from the rows. Forward order only, one Mac at DPR 2, and installed Safari was not run.

## The run

**Answer.** Not all, and "almost all" only as a share of main's whole suite. Main's passing line counts in the census are Chrome 176,139, Firefox 190,690 and webkit-host 180,602. Against those, today's rebuild with no supplied font facts still fails 466, 254 and 306 known cases on line count or breaks (0.26%, 0.13%, 0.17%). 344, 202 and 263 of those are non-accidental passes of main (0.20%, 0.11%, 0.15%).

With the lab's font facts supplied, the failures are 174, 147 and 306, of which 78, 95 and 263 are non-accidental. Every still-failing case fails under a gap the rebuild reports, and none lacks a covered explanation.

Terms:
- A **case** is one styled paragraph at one width.
- **Main passes**, as in MAIN-TRIAGE.md: main's line count equals the native count. For a breaks-only comparison, main's visible breaks must also not fail. Main returns line ranges only, so its breaks are a diagnostic, not a metric.
- **The rebuild fails** when the lab scorer (scorer 7) gives `lineCount` or `breaks` the status fail. No case here came out unobserved on either metric.
- **Non-accidental** is the triage's "fact to learn": main passes everything observable.
- **Accidental** is one of three things: right count with wrong breaks; zero-width characters on other lines (provisional); or main's own page history.
- **Covered** means every failing line sits under a gap the rebuild's layout reports (the scorer's `lineGaps[metric].covered`). The application is told the prediction there may be off.
- **No facts** is the headline configuration (`rebuild/lab/baselines/no-facts-predictor.ts`).
- **Facts** supplies the lab's font facts (`rebuild/lab/predictor.ts`). The triage of 2026-09-17 and the round 2 refresh ran this configuration, so it is the like-for-like comparison with their numbers.

### What ran

- **Library.** The rebuild at `f474123` (worktree `maincheck`). The library bundle is `b68bf558c0a7…`, the same bundle as the no-facts ledger frozen at the X2 merge.
- **Cases per browser.**
  - Each file is the union of the census main-only list, the triage population (1,069 / 745 / 736) and the round 2 records (420 / 587 / 736).
  - The round 2 records all sit inside the triage population.
  - Totals are Chrome 1,194 (1,191 plus 3 from the evaluation's main-only list), Firefox 768 (731 plus 37) and webkit-host 2,056.
- **Browsers.** Pinned Chrome 153.0.8010.50, pinned Firefox 156.0 and webkit-host, all at DPR 2 on macOS 26A428.
- **Jobs.** Two per browser, forward order, under the lock: no facts, then facts. The second job was the other configuration, not a retry. No job failed. The six jobs took about 35 s in total (02:39:13 to 02:39:41 and 02:43:35 to 02:43:42).
- **Scoring.** `rebuild/lab/score.ts`.
- **Main's side.** Main was not run again.
  - `rebuild/lab/triage.ts` classified today's rows against main's recorded rows.
  - For Chrome those are the round 2 evaluation's main rows on .50; for Firefox and webkit-host they are the triage runs' main rows.
  - Round 2's refresh made the same choice. Main's rows are scored against their own session's native lines.
  - No failing case's native lines differ between main's session and today's.

### Per browser

Counts in parentheses after a class are the triage's counts of 2026-09-17.

### Chrome (1,194 cases)

| | No facts (headline) | Facts |
|---|---:|---:|
| Rebuild passes line count | 934 | 1,064 |
| Rebuild passes breaks (so both) | 728 | 1,020 |
| Still fails | 466 (260 line count, 206 breaks only) | 174 (130, 44) |
| Facts to learn (622) | 344 | 78 |
| Accidental: right count, wrong breaks (316) | 98 | 76 |
| Accidental: zero-width characters elsewhere (120) | 24 | 20 |
| Main's history (9), opinion dropped (2), resolved before the triage (125) | 0 | 0 |
| Same split by the lab's rule on today's rows: fact / accidental | 344 / 122 | 78 / 96 |
| Covered by a reported gap / no covered explanation | 466 / 0 | 174 / 0 |

### Firefox (768 cases)

| | No facts | Facts |
|---|---:|---:|
| Rebuild passes line count | 530 | 630 |
| Rebuild passes breaks (so both) | 514 | 621 |
| Still fails | 254 (238, 16) | 147 (138, 9) |
| Facts to learn (620) | 164 | 87 |
| Accidental: right count, wrong breaks (89) | 43 | 43 |
| Accidental: zero-width characters elsewhere (36, provisional) | 30 | 0 |
| Not in the triage population (23 census cases the library of 09-17 passed) | 17 | 17 |
| Same split by the lab's rule on today's rows: fact / accidental | 202 / 52 | 95 / 52 |
| Covered / no covered explanation | 254 / 0 | 147 / 0 |

The lab's rule on today's rows counts more facts to learn than the 09-17 classes, for two reasons:
- The 30 old "zero-width elsewhere" cases pass the scorer's current zero-width placement diagnostic for main, so the rule files them as facts to learn.
- 8 of the 17 cases outside the old population are facts to learn by the rule; the other 9 are right count, wrong breaks.

### webkit-host (2,056 cases)

Both configurations give identical results.

| | Both configurations |
|---|---:|
| Rebuild passes line count | 1,921 |
| Rebuild passes breaks (so both) | 1,750 |
| Still fails | 306 (135 line count, 171 breaks only) |
| Facts to learn (659) | 263 |
| Accidental: right count, wrong breaks (70) | 39 |
| Accidental: zero-width characters elsewhere (7) | 4 |
| Census cases resolved before the triage (1,320, page-history cases) | 0 |
| By the lab's rule on today's rows: fact / accidental | 263 / 43 |
| Covered / no covered explanation | 306 / 0 |

### In proportion

N is main's passing line counts in the census. In each pair the first number is without font facts and the second is with them.

| Browser | N | Rebuild fails now, known cases | Share of N | Of which non-accidental | Share of N |
|---|---:|---:|---:|---:|---:|
| Chrome | 176,139 | 466 / 174 | 0.265% / 0.099% | 344 / 78 | 0.195% / 0.044% |
| Firefox | 190,690 | 254 / 147 | 0.133% / 0.077% | 202 / 95 (164 / 87 by the 09-17 classes) | 0.106% / 0.050% |
| webkit-host | 180,602 | 306 / 306 | 0.169% | 263 / 263 | 0.146% |

- **Line count alone.** 260, 238 and 135 without facts (0.15%, 0.12%, 0.07%). 130 and 138 with facts in Chrome and Firefox.
- **Scope.** All failing cases are in main's supported scope. Against supported-scope N (157,407 / 170,994 / 161,733) the no-facts shares are 0.30%, 0.15% and 0.19%.
- **The other direction.** The census had the rebuild passing 60,034 / 46,727 / 54,970 line counts that main fails.
- **The triage's facts to learn now.** Of 622 / 620 / 659, the rebuild passes 278 / 456 / 396 without facts and 544 / 533 / 396 with.
- **Main passes and the rebuild fails, facts configuration, over time.**
  - At the triage: 1,069 / 745 / 736.
  - At round 2: 420 / 587 / 736.
  - Today: 174 / 147 / 306.
- **Since round 2's rows, facts configuration.**
  - Chrome gained 246 and lost 0.
  - webkit-host gained 430 and lost 0.
  - Firefox gained 459 and lost 14.
- **Firefox's 14 lost cases.** They are joined Arabic in Amiri at overflow widths: `لألالإلآ`, `سلامسلام` and `للله`.
  - Examples: `c-0821a95c98d092c4`, `c-3047f645916b0588`.
  - 8 are non-accidental.
  - All 14 are in the group of 17 Firefox cases that fail today and sat outside the old population.
- **Required cases.**
  - Chrome's `c-9c5a66597ebf5aef` passes now.
  - Firefox's `c-ed263bd4b6656704` passes its line count in both configurations.
  - Its breaks, which main never required, fail without facts and pass with them.

### Facts to learn still failing, by the triage's cause

Counts read "then, then still failing without facts / with facts".

**Chrome**

| Cause | Then | No facts | Facts | Examples |
|---|---:|---:|---:|---|
| Ligature clusters at an overflow break (break inside lam-alef or `ffi`) | 245 | 245 | 44 | `c-002c9461ceb042e1`, `c-00520dd17f45f4f9` |
| The browser makes a line of zero-width content (U+2060 before spaces) | 54 | 54 | 0 | `c-022d2557c2d81372`, `c-062736d14be7e4a3` |
| U+FFFC measured by Canvas as U+200B | 18 | 14 | 14 | `c-275716c3373d6f8e`, `c-2fbb3808b11769ec` |
| Latin kerning and ligatures at an overflow break | 12 | 12 | 1 | `c-035d6a5e7eaf723f`, `c-16f06b3ef08ca7ce` |
| Joined letters at an overflow break (`صلىالله` in Courier New) | 22 | 10 | 10 | `c-06218d32a4b76797`, `c-07cd5017f0eb6852` |
| Punctuation and Latin after another script | 77 | 5 | 5 | `c-22fce74d501ecfd4`, `c-4f0762db1d5ceede` |
| Emoji before `))` in Amiri | 4 | 2 | 2 | `c-ccd5ecf22f2ea3ec`, `c-f5df84b3967c1a14` |
| Joined letters at a line edge | 2 | 2 | 2 | `c-1c0b1895a5de8849`, `c-887e26af0d1f9570` |

- **Covering gaps.** `glyph-clusters`, `unsafe-to-break`, `script-context`, `font-fallback`.
- **Closed entirely.**
  - zero-width lines only the rebuild made (74);
  - Myanmar paragraphs (55);
  - U+202F (49);
  - invisible character or mark at an edge (10).

**Firefox**

| Cause | Then | No facts | Facts | Examples |
|---|---:|---:|---:|---|
| The rebuild gives zero-width content its own line (`following-space-scope`; CR and FF in pre-wrap) | 82 | 65 | 9 | `c-0287698f4cb03727`, `c-0320b489824a990f` |
| Punctuation and Latin after another script (Amiri `((بب`) | 40 | 33 | 33 | `c-0157134b8bc06975`, `c-088d9c97b85cf39f` |
| U+202F texts, off at the Mongolian, Syriac and N'Ko letters | 26 | 22 | 22 | `c-0eff2962a1de9496`, `c-22231f80546d959c` |
| Latin kerning and ligatures at an overflow break | 21 | 21 | 0 | `c-020bbf41eaa7c78a`, `c-16f06b3ef08ca7ce` |
| Leading invisible character gets its own native line | 66 | 11 | 11 | `c-19ea0e31766a4fa3`, `c-20390ef8578f703f` |
| Joined letters at an overflow break (Noto Nastaliq Urdu) | 59 | 8 | 8 | `c-1e9cfda60bb88001`, `c-5f5104a9e9f5827e` |
| Joined letters at a line edge | 3 | 3 | 3 | `c-43b9152e0e34a4b7`, `c-7b3f8537e0fea1e0` |
| Ligature clusters | 309 | 1 | 1 | `c-f63ad2fa026a333f` |

- **Covering gaps.** All are covered by `in-word-prefix`; without facts, `optical-size` fires as well.
- **Added by the lab's rule on today's rows.**
  - 30 `following-space-scope` and `following-space-context` cases, without facts only (`c-059687fc4caff40d`, `c-05ceddee48685b0a`).
  - The 8 lost joined-Arabic cases, in both configurations.

**webkit-host**

| Cause | Then | Now | Examples |
|---|---:|---:|---|
| WebKit turns ligatures off under letter spacing | 644 | 251 | `c-00f3d9550c6273f2`, `c-01bcc719801c72b4` |
| Punctuation and Latin after another script | 12 | 12 | `c-18d8eb5618d3e354`, `c-49feb03a06bd4b90` |

- **Letter-spacing ligatures.** They are covered by `letter-spacing-ligatures`. The cases are mostly `ligature-thresholds-v3` in ProbeShantell: 210 of the 251.
- **Punctuation after another script.** The examples (`c-18d8eb5618d3e354`, `c-49feb03a06bd4b90`) are covered by `page-history`.

### What this run can't say

- **Regressions outside the old lists.**
  - Only cases the rebuild failed on 2026-09-16/17 were run. A case it passed then and fails now is invisible here.
  - The bound is the 30,000 sampled suite cases of the tier sets (`suite-sample`, `heldout-suite-sample`). Their ledgers were frozen at the X2 merge from this same library bundle.
  - I joined those ledgers offline with main's sample runs of 09-16. Sampled cases where main's line count passes number 21,760 / 25,491 / 22,432.
  - Among them the rebuild fails line count on 17 / 16 / 18 without facts (13 / 15 / 18 with), and every one is inside this run's lists.
  - The same holds for breaks against main's old-scorer breaks: 5 / 15 / 23 cases, none outside the lists.
  - This is not an unbiased rate. Those samples are gated development sets: tier 2 blocks any pass that becomes a failure. They also hold the lists' families at about half their census share.
  - No unseen suite case is left: REPORT.md says every one of main's 238,524 has been used.
  - Beyond that, the correctness line's tier-set line-count rates stand (99.48 / 99.77 / 99.87% without facts), along with the census shares above.
- **Undecided sample cases.** Firefox 246 and webkit-host 188 sampled cases where main passes are history-dependent in the ledger, so they are undecided there.
- **webkit-host page history.**
  - The 1,320 census cases outside the triage population all pass here, in a 2,056-case document. They also passed in the census reruns and at the triage.
  - In the tier sets' long documents, 16 of the 16 sampled ones fail line count under `page-history`.
  - Whether the rebuild passes them depends on the document; it reports the gap either way.
- **Main was not rerun.**
  - Its passes are recorded rows of 09-17.
  - In Chrome, main's predictions depend on its page history: 152 moved in reverse order at the triage.
- **Isolation unchecked.** Forward order only and one run per configuration, so isolation is unchecked. One Mac at DPR 2. Installed Safari was not run.
- **Metrics not compared.** Widths and the painter were not compared, because main's widths aren't comparable.
- **"Covered" is weak in places.**
  - Without facts, Firefox reports `optical-size` on all 768 cases and `in-word-prefix` on 199 of the 514 that pass.
  - Chrome reports `script-context` on 581 of 728 passing cases.
  - webkit-host reports `letter-spacing-ligatures` on 427 of 1,750.
  - The application is told, but the report doesn't single out the failing cases.

### Files

Everything is under `.artifacts/session/main-check-20260919/`:
- `cases/<browser>.ndjson`, with `-sources.json` and `summary.json`.
- `<browser>/` and `facts-<browser>/`: rows (zstd), `run.json`, scorer summary and per-case files, and `<browser>-main-check.json` with per-case status, triage class, cause and coverage.
- `triage-today/` and `facts-triage-today/`: `triage.ts` records on today's rows.
- `main-rows/`: main's recorded rows for these ids (zstd). Decompress them before rerunning `triage.ts`.
- `counts.json`, `facts-counts.json`, `groups.json`.
- `sample-bound.json`, `sample-bound-by-set.json`, `since-round2-facts.json`.
- `tools/`.

Row files were compressed from 307 MB to 27 MB. Nothing was committed, no frozen reference, ledger, baseline or seed was touched, and the worktree is clean.
