# Ceiling round 2 evaluation: verdict and open items

Paths are relative to `~/github/pretext-rebuild`. Tables are in REPORT.md §2 to §7 (rewritten for round 2); outputs are under `.artifacts/ceiling-20260917/evaluate-r2/`.

## Plain verdict

**The correctness ceiling isn't reached.** It is much closer than after round 1, and what is left is small and named.

What holds:
- **Nothing was lost.** Against round 1 (as scored then, and re-scored with scorer 4) no line count, break or width went from pass to fail in any browser. Gains, lineCount / breaks / widths: Chrome 117 / 168 / 521, Firefox 12 / 40 / 159, webkit-host 0 / 0 / 3.
- **On every defined set** (rule families, feature families, development, held-out 09-16, sealed-2) Chrome and webkit-host have no prediction failure without a line-local gap. Firefox's are the verified 1 au residual class, plus 3 sealed-2 rows outside it.
- **Sealed-2 generalizes.** Suite line counts, development / held-out / sealed-2: Chrome 99.72 / 99.16 / 99.30%, Firefox 99.68 / 99.51 / 99.67%, webkit-host 99.92 / 99.68 / 99.93%.
- **Round 1's lab items are closed:** element rects are compared (no feature line count is unobserved apart from protocol rows), the 22 slot protocol rows are excluded, gaps are line-local, triage records are refreshed.
- **Installed Safari equals webkit-host** on the whole development and family files in both orders: native views, predictions and scores.

Why it isn't reached:
- **Fresh cases find new classes.** The evaluation generated four fresh styled-run sets (10,319 cases). Zero on the iterated sets and on one sealed set didn't mean zero: Chrome has 6 rows without a line-local gap there in two classes nobody had seen, Firefox 2 in one.
- **Two triage rows are open** (Chrome 1, webkit-host 1).
- **Blink reports in-word positions as exact** where they aren't (outside the four metrics, inside tentpoles 1 to 3).
- **WebKit's zero rests on weak conditions:** 201 of 210 development and 261 of 261 held-out prediction failures are covered only by gaps with a lift below 2.

## State at the restart, and what ran

- Library unchanged since the rows were made: last source edit 14:49, first evaluation row 15:23; `git diff bc49b0e -- rebuild/src rebuild/lab` shows only gate baselines. Every finished job's rows were reused.
- The sealed-2 per-set jobs were already scored (score-chain.sh) in all three browsers. I added counts-only tools: `sealed-residual.ts` (the 1 au signature) and `sealed-weak.ts` (covering gap sets).
- Trashed the partial `webkit-host/heldout-all-forward`, verified all 10 SEAL.json hashes, the repository record and that `sealed2-all` is the four files concatenated, then resumed `chain-combined.sh`.
- Ran: webkit-host heldout-all and sealed2-all in both orders; installed Safari dev-all and families-all in both orders; one isolation job (webkit-host, 1 case); the fresh runs sets in Firefox, Chrome and webkit-host (24 short jobs). All under the lock with pauses.
- **One browser job failed and wasn't retried:** installed Safari heldout-all in file order (below). Its reverse order and both orders of sealed2-all therefore never ran in Safari.
- No watchdog kill; peak job memory 4.4 GB; lock free at the end.

## Open model bugs by engine (round 2 definition)

Prediction failures with a failing line no gap concerns, forward runs outside history dependence and protocol rows:

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed-2 (counts) | Triage | Fresh runs (10,319) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Chrome | 0 | 0 | 0 | 0 | 0 | 1 | 6 of 48 failing |
| Firefox | 0 | 0 | 8 cases | 6 | 8 | 7 (the dev suite's) | 7 of 160 failing |
| webkit-host | 0 | 0 | 0 | 0 | 0 | 1 | 0 of 475 failing |

webkit-host's four combined files and installed Safari's two have none.

### Blink (Chrome 153.0.8010.50)
- **Open, fresh runs, class 1:** an ideographic space inside an Arabic run under letter and word spacing (`runs/word-spacing-spans`, Geeza Pro): `c-45d738663a9704be`, `c-5ad7c3e3754f4363`, `c-e2fe65814d7d218e`, `c-aa48ec15a2622076`, `c-b685f6ae4e4793e1`. Native nodes are off by whole letter spacings around the U+3000s; `script-context` doesn't fire on the line. Not traced.
- **Open, fresh runs, class 2:** `c-4a04b13ad0ab4062` (`runs/letter-spacing-spans`): a join across a span edge under −2px letter spacing; 296 units move between two nodes, the line is 1 unit off.
- **Open, triage:** `c-8c84627af834611f` (Shantell Sans, −1px letter spacing, break-word), unexplained by the Blink owner.
- **Open beside the definition:** round 2 narrowed `in-word-prefix` to break decisions (13,638 to 724 development reports), and the observation port's limited state went with it. Predicted-value agreement on development fell from 99.851% (413,216 values) to 98.312% (2,271,834 values): 2,108 cases hold a differing predicted value, 2,030 of them pass lineCount, breaks and widths. They are Arabic letters inside joined words and Latin ligature parts; 1,182 of 2,895 sampled differ by more than half a px. No gap reports it.

### Gecko (Firefox 156)
- **Residual class, not an open bug: one shaping unit 1 au off (probe F7).** All 14 development and held-out cases (15 rows), traced node by node: exactly one node rect differs, by exactly 1 au; that rect holds one of F7's three probed strings (`ووفقك` 10px Geeza Pro, the Thai run in 32px Thonburi, `modern` in 15px Helvetica Neue, where the failing line is the one holding that word at all seven widths); the painter, which draws the predicted line with the DOM, paints all 15 at the native width. Ids are in REPORT §2.8 and `gaps/firefox-open-traces.json`. The triage 7 are the same cases. Sealed-2: 5 of 8 rows have the signature. Fresh runs: 5 more, in two strings F7 didn't probe.
- **Open: a heart after a keycap mark split across spans.** `c-a2661c5b12f20aec`, `c-e69a2cc0039e247a` (fresh runs, `runs/split-word`): node `⃣❤` in bold 14px Helvetica Neue, 786 au natively, 793 predicted, no gap, `bitmap-emoji-size` silent. The 3 sealed-2 rows outside the 1 au signature (two node rects each 8 au narrower natively, painted at native width) are probably this class at 16px; the set stays sealed. Not probed.

### WebKit (webkit-host, installed Safari)
- **Open, triage:** `c-66ae4ab7d56cb0ae`: 10 native lines in both orders of its set, 11 predicted; alone in a fresh webkit-host process it has 11 native lines and passes. `page-history` sits on line 4, the failing line is 6. The condition is too narrow there, and the two-order protocol can't see history both orders share.
- **Weak coverage:** prediction failures covered only by gaps with lift below 2: rule families 153 of 493, development 201 of 210, held-out 261 of 261, sealed-2 152 of 195. Samples (`sample-weak.py`) found each condition cited from source with its range on the failing line and none contradicted, but `canvas-language` fires on 45% of development cases (Chrome's `script-context` on 76%), so presence says little. Narrowing needs inputs Canvas doesn't give: a decision, not a port bug.

### Protocol rows
Firefox 15 and webkit-host 7 feature rows, excluded everywhere and listed apart in the seeds. The evaluation ran round 1's case files; the new width floor produces none (lab owner).

## Against round 1

- Scorer change alone (round 1's rows, scorer 3 to 4): feature line counts unobserved to pass: Chrome 719, Firefox 670, webkit-host 701; 4 line counts and 8 breaks newly observed as webkit-host failures (`rule/br-elements`); no pass/fail flip anywhere.
- Painter lost / gained: Chrome 138 / 643, Firefox 0 / 188, webkit-host 9 / 209.
  - Chrome's 138: 80 on cases whose prediction passed for the first time (the painted lone line doesn't reshape as the paragraph did; 33 `rule/text-align` lines whose round 1 painter pass agreed with a wrong predicted width). **58 with the prediction unchanged are a painter regression:** Blink's hanging spaces painted in their own text node move the letter before them by its pair adjustment (41 pairs exactly 113 units narrower, Arial `A` + space at 16px). The painter owner ran no suite or rule-family set. Not traced to source.
  - webkit-host's 9: 8 atomic-inline extents (DESIGN §7, float32 step) and 1 untraced wrap.
- Main triage records refreshed: Chrome 420 (charter library 1,069), Firefox 587 (745), webkit-host 736 (736). Main-only line counts on the Chrome suite samples fell from 20 and 19 to 2 and 16.
- Costs rose in all three engines (small sets: Blink 15 to 24%, Gecko 46 to 65%, WebKit 11 to 32%); Chrome's held-out prediction time fell from 296 s to 37 s.

## Installed Safari

- dev-all (25,180) and families-all (21,734, first time in Safari) ran in both orders, hidden on every row, 105 to 304 s a job. Case by case with the same document history: all native views equal, all predictions equal, the same history-dependent cases (96 and 6), and identical scores in every cell, painter included.
- heldout-all forward failed at 7,863 of 15,205 rows ("No page activity for 600000ms"). Those rows equal webkit-host's views and predictions.
- Diagnosis (source, not Safari logs, which weren't available afterwards): the WebContent process stopped three times at 0% CPU, and went on once when the window became visible. A process without a visible page has its CPU averaged over 8 minutes against the client's limit (WebProcessCocoa.mm:220, :1180-1205); past it the UI process calls `invalidateAllActivitiesAndDropAssertion` (`WebProcessProxy::didExceedCPULimit`, WebProcessProxy.cpp:2360-2395), which drops the lab's title-change hold; the page keeps the invalid activity until the next commit (WebPageProxy.cpp:9266-9268), so afterwards it is suspended like any hidden page, about 20 s plus 4 min after being covered (ProcessThrottler.cpp:49-50), which matches the second stop. The finished jobs all took under 8 minutes; the held-out file starts with corpus rows that take about 5 minutes each in a hidden Safari page (73 s in webkit-host, which sets no CPU limit).
- Fix for the lab owner: keep each Safari job or WebContent process under that window (parts in fresh tabs), or keep the window visible. Recorded in lab/README.md.

## Gates and baselines

- `gate.ts` refuses every round 2 run against the committed seeds and the pre-round-1 seeds by environment: scorer 4; Chrome 153.0.8010.50 (it updated itself from .48 during the day; native views are equal on all 76,029 cases in both orders); webkit-host `preferredLanguages`; no recorded languages in the pre-round-1 seeds. Nothing was checked without that check.
- Seed diffs against the committed seeds, lost pairs: lab Chrome 81 (painter), Firefox 0, webkit-host 5; rule families Chrome 24 (painter), Firefox 0, webkit-host 0; feature families Chrome 33 (painter), Firefox 0, webkit-host 25 (17 widths scorer 4 alone leaves unobserved, 8 painter). No prediction pair is lost except webkit-host's 19 widths that are unobserved now. Against the pre-round-1 seeds: Chrome lab 137 and families 68, webkit-host lab 8 and families 50 (round 1's known losses, all with a line-local gap), Firefox 0.
- **Partial re-seeds at the pause:** regenerated with the gates' own seed commands from the committed files; equal apart from notes; replaced by the regenerated files.
- **New seeds** (`tools/reseed.sh`), each checked against its own runs with the environment check on: lab gates for Chrome (new file for .50; the .48 file stays), Firefox and webkit-host; tests seeds for Chrome (three new .50 files whose notes say the cases were derived under .48 and the facts file is .48's), Firefox (2) and webkit-host (2). Protocol rows are listed apart.
- **Record the rule asks for:** `rebuild/lab/baselines/reseed-round2-lost-pairs.json` lists every lost pair against both older seed sets with category, line-local gaps and attribution. 68 painter pairs (Chrome 59, webkit-host 9) are attributed to round 2's painter changes but not traced to source.
- `rebuild/tests/coverage.json` regenerated: no rule lost its last observed family; 6 new round 2 rules have no test, fact or family.

## Still open

1. Blink: the two fresh-run classes (6 rows), triage `c-8c84627af834611f`, and in-word geometry reported as exact (architect: a gap range for cluster geometry, or leave those positions out).
2. Gecko: probe the heart-after-keycap class; decide whether `bitmap-emoji-size` should reach it. Keep the 1 au class as a residual class and let the scorer count its signature apart.
3. WebKit: widen `page-history` where isolation shows it missing; decide the inputs that would narrow `canvas-language`, `letter-spacing-ligatures` and `simplified-measuring` (722 of 759 failing triage rows sit under `letter-spacing-ligatures`).
4. Painter: the hanging-space regression (58 Chrome pairs), 8 webkit-host atomic-inline pairs, 1 wrap; run the suite sample and rule families in every painter round.
5. Lab: installed Safari jobs over 8 minutes; an isolation protocol (TEST-ARCHITECTURE §6.5); derive the feature families again with the new width floor; TESTS.md §12 for Chrome .50 (probes into a facts file, derivation), then move the pin.
6. Installed Safari never ran heldout-all reverse or sealed2-all; the sealed-2 Firefox rows outside the 1 au class stay unopened.
7. A recommendation for the next rounds: generate fresh styled-run sets each round. They were cheap (about 40 s a job) and found what 80,000 iterated and sealed cases didn't.
