# Final evaluation of the re-architecture (2026-09-19)

The question: after the re-architecture and correctness round 5, is the library at least as correct on unseen cases as
it was at the correctness line (research/CORRECTNESS-LINE.md, research/ROUND4-EVALUATION.md)? Two agents answered it: an
evaluator, and an independent checker who recounted every number from the per-case files and ran the line's own library
on the cases that read worse. The checker's report comes first, because its numbers are the confirmed ones; the
evaluator's report follows unchanged except for one redaction (platform-bugs entry 13's trigger is withheld).

**The answer: yes.** On 215,954 unseen cases in three browsers the library at b518747 is at least as correct as the
line in every browser and metric. Chrome and webkit-host are level with the line; Firefox is better without supplied
font facts (prediction failures 138 to 98 per 10,000 as drawn, 138 to 103 when the new sets are re-weighted to the
line's mix of case kinds) and level with them. The nine giants pass exactly as at the line, the plain path's line
ranges equal the usual run's on all 71,984 cases of one seed, and installed Safari 27.0 equals webkit-host on 63,987
of 63,987 cases.

What a reader should not conclude (the checker's list): a Firefox gain with facts; "138 to 98" as the size of the
gain; anything from open-row counts alone (Chrome's 8 open rows against 2 are the draw: the line's own library leaves
the same 8 open); a speed verdict from the giants. "Unseen" means new draws from the same generators.

Since the evaluated commit the branch took the fresh-eyes follow-up (research/FRESH-EYES-REVIEW.md's cheap findings):
one font-family parser, Blink's `system-ui` keyword match and its box fragment for a span of empty items and a
collapsible space, Gecko's recipe contexts by reference. It was held by the tiers, not by this evaluation: Chrome was
recorded again (3 status transitions, all one case, to a pass), Firefox's and webkit-host's recorded cases replay the
same, and the full offline gates exit 0 on the frozen tree.

Found on the way and not fixed here: the lab's generation lock can be taken over between an owner's two clean-up
steps, so two seeds started together can share case ids (767 ids are in both Chrome's and webkit-host's set b;
harmless across browsers); the family-widths kind logs "0 used ids left out" while it skips used ids in its loop, and
the kind has shrunk 8 to 12% since the line; most of webkit-host's lineCount and breaks failures on the new sets lay
out differently natively in a short page than in the lab's long pages, now and at the line, so that rate mostly
measures page history.

## Independent check of the final evaluation (2026-09-19)

All paths are under `~/github/pretext-rebuild`. My scripts and outputs are in `.artifacts/final-eval-20260919/check/`. I edited no tracked file and committed nothing. I ran nothing with `--record`, `--seed`, freeze, pack or adopt.

### My verdict

The report's numbers and setup are right, and the library at b518747 is at least as correct on unseen cases as the correctness line was. Chrome and webkit-host are level with the line. Firefox is better in the headline configuration only, by about 35 prediction failures per 10,000 like for like (138 → 103), not the 40 the two tables suggest.

Words used here:
- A **case** is one styled paragraph at one width.
- **No facts** is the headline configuration: the library gets no supplied font facts. **Facts** is the same cases with the lab's font facts.
- A **prediction failure** is a case that fails lineCount, breaks or widths.
- An **open row** is a failure without a covered explanation. A **residual** row matches one of Gecko's two registered tiny differences.
- A **history-dependent** case is scored differently in forward and reverse order. It is left out of the rates.
- **Spread** is the largest minus the smallest value among the three sets of one evaluation.
- A **kind** is the generator a case came from: runs, ws (white space), policy, rich pre-wrap, or rule (the family paragraphs at new widths).

### 1. Numbers, recomputed

`check/recount.py` reads only the per-case files. It imports no lab code. It applies the status rules of `rebuild/tests/ledger.ts`, which I restated. Output is in `check/recount.json`. Line → now. The report's value and mine are the same in every cell unless a note says otherwise.

| No facts | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| Cases | 75,132 → 73,234 | 74,200 → 72,038 | 72,542 → 70,682 |
| Cases by set, now | 24,531 / 24,423 / 24,280 | 24,175 / 23,991 / 23,872 | 23,644 / 23,570 / 23,468 |
| lineCount % | 99.771 → 99.798 | 99.859 → 99.883 | 99.927 → 99.896 |
| breaks % | 99.653 → 99.687 | 99.682 → 99.713 | 99.795 → 99.758 |
| widths % | 99.436 → 99.403 | 98.909 → 99.294 | 99.589 → 99.657 |
| painter % | 98.733 → 98.729 | 97.075 → 97.133 | 95.741 → 95.783 |
| Prediction failures (per 10,000) | 672 (89.4) → 654 (89.3) | 1,026 (138.3) → 704 (97.7) | 431 (59.4) → 400 (56.6) |
| Open rows, by set | 2 → 8 (3 / 3 / 2) | 0 → 0 | 2 → 0 |
| Residual rows | 0 | 0 | 0 |
| Wrong value in a passing case, cases | 0 → 0 | 0 → 0 | 1 → 0 |
| History-dependent, left out | 0 → 0 | 0 → 0 | 383 → 425 (149 / 169 / 107) |
| Open in reverse order only | 0 | 0 | 0 |
| Painter-only failures without an explanation | 28 → 36 | 0 → 0 | 31 → 32 |
| Values predicted | 11.8% | 8.3% | 9.0% |

| With facts | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| lineCount / breaks / widths / painter % | 99.84 / 99.74 / 99.75 / 98.86 | 99.88 / 99.73 / 99.42 / 97.13 | 99.90 / 99.76 / 99.66 / 95.78 |
| Prediction failures (per 10,000) | 363 (48.3) → 362 (49.4) | 671 (90.4) → 605 (84.0) | 431 → 400 |
| Open rows, by set | 31 → 14 (4 / 6 / 4) | 6 → 0 | 2 → 0 |
| Residual rows | 0 | 42 → 54 (18 / 24 / 12) | 0 |
| Wrong value in a passing case, cases | 0 → 0 | 0 → 0 | 12 → 4 |
| History-dependent, left out | 0 → 0 | 0 → 0 | 383 → 417 |
| Painter-only failures without an explanation | 54 → 67 | 40 → 39 | 36 → 41 |
| Values predicted | 73.7% | 98.3% | 14.0% |

- **Firefox's residual rows, with facts.** 42 one-app-unit rows (5 probed, 37 by signature) and 12 synthetic bold rows, all probed.

Notes on the counts:
- **Open rows.** My id lists equal the report's exactly: 8 without facts and 14 with.
- **Wrong value in a passing case.** The report counts cases, as the line's document did. The aggregate tool counts a case once per order. Counted that way it is 2 → 0 without facts and 24 → 8 with facts. Both sides are counted the same way, so the comparison is like for like.
- **Protocol rows.** The report does not mention them: Firefox 6 → 4, webkit-host 3 → 0. A protocol row is a row whose page does not describe the declared line slots. They are left out of the rates on both sides.
- **The line's numbers.** I recomputed them from the line's own per-case files too. They equal ROUND4-EVALUATION.md section 1.

#### The same totals under the line's mix of kinds (mine, `check/by-kind.py`)

The new sets hold fewer family-width cases, and that is the hardest kind. Chrome has 16,130 of them against 17,573. Its rule kind has about 300 failures per 10,000 there, against 3 to 55 for the other kinds. I re-weighted the new per-kind rates to the line's mix.

| Failures per 10,000 | Line | Now | Now, line's mix |
|---|---:|---:|---:|
| Chrome, no facts | 89.4 | 89.3 | 93.0 |
| Chrome, facts | 48.3 | 49.4 | 51.0 |
| Firefox, no facts | 138.3 | 97.7 | 103.0 |
| Firefox, facts | 90.4 | 84.0 | 89.4 |
| webkit-host | 59.4 | 56.6 | 58.2 |

- Firefox's re-weighted 103.0 equals what the paired check finds on the line's own cases (103.1). So the like-for-like gain is 138 → 103.
- Chrome's 93 against 89 is inside the spread (4.6 at the line, 9.8 now). The paired check moves nothing in Chrome.
- Per kind, Firefox's gain without facts is in policy (125 → 37 failures), runs (181 → 121), ws (44 → 21) and rule (676 → 525).
- With facts Firefox is level in every kind.

### 2. Setup checks

| Check | Result |
|---|---|
| The seeds were new | The generation logs name what the used-ids record left out (for Chrome a: ws 40, policy 410, rich pre-wrap 106). My own scan finds none of the 100,978 new ids in 10,660 earlier per-case files or 1,945 earlier case files. A positive control finds 8,038 in one new file. No id repeats within a browser across sets. |
| Same cases in both configurations | Both used the same part files. The forward and reverse id lists are equal in all 54 run pairs. The scorer reports 0 mismatched cases in all 108 summaries. |
| Headline predictor | All 54 no-facts runs name `baselines/no-facts-predictor.ts`. It passes `UNKNOWN_FONT_FACTS` for every font. |
| Bundle is b518747's | From `git archive b518747` in scratch I rebuilt all three bundles: no facts `5d4bfc2c6204…`, facts `e06efe58a5bc…`, plain `a1d6664b4da4…`. They are byte-equal to the run records. All 266 run records hold one of the three. The worktree is clean at b518747. |
| Both orders, scored against each other | 108 runs: 54 in file order and 54 in reverse. Each summary's compare file is the other order of the same part. Scorer 7 in all 108. 0 skipped and 0 missing rows. |
| No job dropped | I streamed all 108 compressed row files. Each holds exactly one row per case of its part. That is 863,816 rows, which is 215,954 × 4. |
| The hang exclusion | `part-02.before-exclusion` holds 8,211 cases and `part-02` holds 8,210. The only difference is `c-a948c5abca7d9a92` (the known `blink/range-rects-hang` signature; details withheld: platform-bugs entry 13). One Chrome case is unobserved. |
| Like for like with the line | Same 5 kinds with the same family counts (32, 29 and 29 rule families). Repeat 3. 25 cases a round trip. 3 parts. Same pinned builds, OS build, DPR and process languages. 240 missing-font rows on both sides. The generators are byte-equal, except one unused export removed from `cases/font.ts` and a new `twins.ts` that nothing imports. |
| Paired check | Confirmed by `check/paired-moves.py`. Chrome and webkit-host: 0 status moves on 75,132 and 72,542 cases in both configurations. Firefox without facts: 285 moves, all toward pass (243 widths, 18 breaks, 4 lineCount, 2 painter, 18 widths from unobserved), and failures go 1,026 → 765. Firefox with facts: 1 move. Every number of its table reproduces, including 28 and 54 painter-only, 31 open and 12 wrong values. All 108 paired runs ran HEAD's bundles. |
| Giants | 108 giant rows against the freeze's giants run: 0 status moves. The times and Canvas call counts reproduce exactly. No facts, in seconds: Chrome 50.7 → 37.8, Firefox 4.6 → 6.0, webkit-host 2.9 → 1.6. Chrome's calls: 1.93 M plus 36.8 M memo answers → 22.8 M. |
| Plain path | My own comparison (`check/plain-check.py`) finds 0 of 71,984 cases where the plain lines differ from the usual run's lines that have a line box. |
| Installed Safari | 17 runs ok. Safari 27.0 on WebKit 22625.1.29.11.27, the no-facts bundle, 63,987 rows, every row visible. The comparison report shows 0 differences. The host recording ran the same bundle. I did not redo the row-by-row comparison. |
| Covering conditions | No condition name is new in any browser. Firefox `in-word-prefix` covers 506 → 247 failing cases. |
| Housekeeping | No lock of the evaluation is left. The one lock I saw belongs to the other workflow. |

### 3. My three browser runs: the line's own library on the rows in doubt

I exported `rebuild` and `tests/wrapping/fonts` of the tag `correctness-line` under my folder. Its bundles hash to `1545f944f502` and `2b23885ba492`. Those are the bundles of the freeze's giants runs. I ran its own `run.ts` under the lock and scored with its own `score.ts`. Afterwards the tree went to the Trash, and I removed the two links I had made.

**Chrome, 138 cases: the 18 open cases and 120 controls, both configurations** (`check/line-lib/`, `check/line-lib-compare.py`).
- Without facts the line's library leaves the same 8 rows open. With facts it leaves the same 14 open.
- All 138 cases have the same status on every metric as at HEAD, in both configurations. No control is open.
- So Chrome's open rows (2 → 8 without facts, 31 → 14 with) are the draw. This is shown directly, not inferred.

**webkit-host, the 170 new cases that fail lineCount or breaks at HEAD** (`check/line-lib-webkit/`, `check/line-lib-webkit-compare.py`).
- The line's library predicts the same lines as HEAD on 170 of 170.
- In 60 cases the native layout equals the full part's, and the line's library fails exactly as HEAD does.
- In 110 cases WebKit itself laid the paragraph out differently in this 170-case page than in the 8,000-case parts, where both orders agreed with each other. The same prediction then passes.
  - 57 of the 110 are `rich-prewrap/trailing-spaces`.
  - This is page history, not the library.
- So webkit-host's −0.03 on lineCount and −0.04 on breaks is not a loss of the library.

### 4. Every open row and named example, one line each

**Chrome, soft hyphen** (`blink/soft-hyphen-line-one-unit-off-without-facts`). All four are the item's own two paragraphs at new widths: Helvetica Neue 16px, RTL, "cc super­cali­fragi dd".
- `c-8eada0788a0c5732` (a): agree. Width 93.16px. Line 0 is 11,797 predicted and 11,798 native. 2 differing runs, 1 touched. With facts it is 11,798 and everything passes.
- `c-b5cb43749872060c` (a): agree. The 3px letter-spacing paragraph, width 128.66px. 16,405 against 16,406. Passes with facts.
- `c-23a920dc53399f44` (b): agree. Width 92.20px. 11,797 against 11,798. Passes with facts.
- `c-998b70a69f236ade` (c): agree. Width 128.19px. 16,405 against 16,406. Passes with facts.

**Chrome, a span holding only a trimmed space** (`lab/blink-rect-of-a-span-holding-only-a-trimmed-space`). In all 13, the predicted and native line counts agree. 0 code points sit on another line than expected. The only difference is a zero-width element rect at a line end where the port expects none.

Open in both configurations, because no line carries a gap:
- `c-9a8335fb7f4de8ea` (a): agree. Courier New 16px, 144px. Two bold `pre-line` spans of 2 and 4 spaces. Element 0 reports on line 0 at x 96.02.
- `c-57433381c0529756` (b): agree. Arial 16px, 63px. Georgia 12px spans with 0.3px letter spacing, `white-space: normal`, 3 and 6 spaces. 5 lines. Element 0 reports at x 56.93.
- `c-b2d5853cd6f6e043` (b): agree. Arial 16px, 95px. Arial 11px spans. Element 0 reports on line 0 at x 88.04.
- `c-91e649ad8b4a17d4` (c): agree. Menlo 16px, 251px. Menlo 30px spans of 2 and 4 spaces. Element 1 reports on line 0 at x 201.09.

Open with facts only. I agree on all nine. Without facts a `glyph-clusters` gap on the failing or the next line covers them by position.
- `c-598ce5f4c53a4dd0` (a): Times New Roman, 69px, element 0 on line 1.
- `c-a4e6f6cdf366087b` (a): Arial, 158px, element 1 on line 0.
- `c-c2d080bef8dda98e` (a): Georgia, 140px, element 1 on line 0.
- `c-3fdc61c00860717b` (b): Times New Roman, 93px, element 0 on line 0.
- `c-5652f960e981e2c8` (b): Menlo, 103px, element 1 on line 2.
- `c-815237ec80c4b0f1` (b): Courier New, 109px, element 0 on line 0.
- `c-8649a5a21efb69be` (b): Menlo, 162px, element 0 on line 0.
- `c-25422cb1a6609e6f` (c): Times New Roman, 104px, `pre-line` spans, element 0 on line 0.
- `c-c75f11c7797cb91d` (c): Menlo, 80px, `pre-line` spans, element 0 on line 1.

**Chrome, Arabic at a shaping edge** (`blink/arabic-at-shaping-edges`).
- `c-47cedad153dfedc2` (c): agree. Geeza Pro 20px, 156px, break-word. 4 lines agree. Line 2 is 15,656 predicted and 15,810 native (1.2px). The first untouched differing unit is a lam. It is open with facts. Without facts `optical-size` and others cover it by position. The painter passes.

**webkit-host, wrong value in a passing case, with facts** (`lab/webkit-element-rect-width-float-step`). Each holds exactly one differing predicted value, the width of one element rect.
- `c-19a3eb1382ee373c` (b): agree. 43.56800079 native against 43.56800461 expected, 1 float32 step.
- `c-fc34da2189abbaa4` (b): agree. 47.22967529 against 47.22968292, 2 steps.
- `c-18230d813b0e7b2e` (c): agree. 36.15999603 against 36.15999985, 1 step.
- `c-24f1a02aedfb45e5` (c): agree. 36.15999603 against 36.15999222, 1 step the other way.

**New classes: none.** I agree. The four examples the report opened are read above. The line's own library leaves exactly the same rows open.

### 5. The verdict's wording against the spread

No-facts differences, now − line, beside the larger of the two spreads:

| | lineCount | breaks | widths | painter | Failures per 10,000 |
|---|---|---|---|---|---|
| Chrome | +0.03 (0.02) | +0.04 (0.06) | −0.03 (0.10) | 0.00 (0.13) | −0.1 (9.8) |
| Firefox | +0.03 (0.05) | +0.03 (0.05) | **+0.38 (0.18)** | +0.06 (0.29) | **−40.5 (20.2)** |
| webkit-host | −0.03 (0.05) | −0.04 (0.12) | +0.07 (0.07) | +0.04 (0.43) | −2.8 (10.3) |

- Every minus sign is inside the spread. The paired check and my line-library runs say none of them is the library. "At least as correct" stands.
- Only Firefox's widths and failure count stand outside the spread.
- The report's phrase "every pass rate within 0.04 points" is not true for webkit-host: widths are +0.07. "Inside the line's own spread" is not strictly true either: Chrome lineCount is +0.027 against a spread of 0.02, and webkit-host widths are +0.07 against the line's 0.04. All are plus signs and none is a gain. The paired check shows 0 moves.
- "Firefox is better" holds for the headline configuration only. With facts it is level. The paired check gives 671 → 670. The new sets' 90 → 84 is the mix and the draw: it is 89.4 under the line's mix.

### 6. What the maintainer should not conclude

- **Not "Firefox gained 40 per 10,000".** Like for like it is about 35 (138 → 103), by two routes: the paired check and the re-weighting by kind. About 5 points come from the new sets holding fewer family-width cases.
- **Not a Firefox gain with facts.** There is none. Round 5 brought the no-facts behaviour up.
- **Not "Chrome is identical" from 89 → 89.** Under the line's mix it reads 93. "Level within the draw" is right. The proof of no change is the paired check, with 0 moves on 75,132 cases.
- **Nothing from open-row counts alone.** Neither a regression (2 → 8) nor a gain (31 → 14, 6 → 0, 2 → 0). The line's own library gives the same 8 and 14 on these cases. The counts depend on whether a wide gap happens to sit on the failing line.
- **Not a 0.03 loss in webkit-host lineCount.**
  - The line's library predicts the same lines on all 170 failing cases.
  - webkit-host's lineCount and breaks failures mostly measure the lab's long pages: 110 of the 170 lay out differently natively in a short page and then match the prediction.
- **"Unseen" is narrow.**
  - It means new ids drawn from the same generators.
  - The family-width kind reuses the 3,264 paragraphs the library was built beside, at new widths.
  - That pool is running out: a Chrome set fell from 5,997 to 5,280 cases. The log still says "0 used ids left out", because the generator skips used ids inside.
  - Later evaluations will get fewer and different family-width cases.
- **37 of Firefox's 54 residual rows match by signature only.** They are suspects, not probed members. The line had 33.
- **No speed verdict from the giants.**
  - The times move more with machine load than with the library.
  - Chrome's Canvas calls rose 12-fold.
  - webkit-host's giant widths are unobserved on 8 of 9.
- **The plain path returns only lines that have a line box.** It matches the usual run on those, 0 of 71,984 differ. In the first two parts I compared without that rule, 5 Chrome and 27 Firefox cases also hold a layout line without a line box, which the plain list leaves out. That is by design in `compare-rows.ts`.
- **Installed Safari was checked forward, without facts, on the tier 2 sets only.**
- One Mac, one OS build, DPR 2, these pinned builds. Firefox's two process states did not occur (0 history-dependent cases).

### 7. Tool bugs and slips (I edited nothing)

- **Generation lock takeover race** (`rebuild/lab/cases/used-ids.ts`, `generationLock`).
  - A lock without an owner file counts as stale once the waiter itself has waited 10 s. The rule does not ask how long the lock has been without an owner file.
  - A waiter that polls in the moment between an owner's `trash` of its owner file and its `rmdir` takes over. The old owner's `rmdir` then frees the folder for yet another generator.
  - It happened twice. The Chrome b and Chrome c logs say "taking over from an owner that never wrote its file".
  - In set b, Chrome and webkit-host then generated at the same time. Both logs read 1,621,235 used ids from 3,321 files. 767 family-width ids are in both browsers' set b.
  - It is harmless here: the engines are separate, each id is unseen for each browser, and no id repeats within a browser. But the lock does not give what its comment promises. Two seeds of one browser started together could share cases.
- **Family-width log.** `family-widths` prints "0 used ids left out" while it skips used ids inside its loop. The manifest's `removedUsed: 0` misleads in the same way.
- **The report's count of run records.** There are 266: 263 ok, the 2 stalled Chrome jobs, and 1 stalled hang-diagnosis run. The report says 244. Its 244 leaves out the giants (12), the timing pass (6) and the hang diagnosis (4).
- **My own setup slip.** My first start of browser run 1 failed before any browser launched. My export lacked `tests/wrapping/fonts`. I added it and ran once: `check/line-lib/no-facts.first-start.log`.

### 8. Not rechecked

- The Safari row-by-row comparison. I read its report and the run records only.
- The paired check's native-equality claim on `eval-r4-1`.
- The load explanation for the giants' times.
- The hang diagnosis beyond the excluded file and `find-hang.json`.
- The painter-only readings.
- The 37 signature-only residual rows.

### 9. To repeat

```sh
C=~/github/pretext-rebuild/.artifacts/final-eval-20260919/check
python3 $C/recount.py $C/recount.json now=final-20260919-a,final-20260919-b,final-20260919-c line=eval-r4-1,eval-r4-2,eval-r4-3
python3 $C/by-kind.py                      # per kind, and totals under the line's mix
python3 $C/run-records.py final-20260919-a,final-20260919-b,final-20260919-c
python3 $C/paired-moves.py                 # the paired check, recounted
python3 $C/giants-check.py --times
python3 $C/plain-check.py <browser> part-0N
bun $C/bundle-hash.ts <clean checkout of b518747> rebuild/lab/baselines/no-facts-predictor.ts
python3 $C/line-lib-compare.py             # the line's library on the 18 open Chrome cases
python3 $C/line-lib-webkit-compare.py      # the line's library on 170 webkit-host cases
python3 $C/trimmed-space.py <folder of extracted rows> <id>...   # rows come from extract-rows.py
```

My row files are compressed. `check/` is 10 MB.

## Final evaluation (2026-09-19): the library at HEAD against the correctness line, on unseen cases

All paths are under `~/github/pretext-rebuild`. My work is in `.artifacts/final-eval-20260919/`: `tools/`, `logs/`, `aggregate/`, `safari/`, `plain/`, `paired/`, `giants/`, `giants-timing/` and three `hang*/` folders. Fresh sets are in `.artifacts/lab/fresh/<browser>/final-20260919-{a,b,c}/` (`runs-no-facts/`, `runs-facts/`, and `runs/` for the plain path on seed b).

- **Library:** b518747 (tag `cr5-merged` plus tooling), run from the worktree `~/github/pretext-rebuild-wt/final-eval`. `rebuild/src` is the same as at the newest recording (3d0a5b3).
- **Bundles:** one per configuration in all 244 run records: `5d4bfc2c6204…` without facts (the bundle of the `cr5-merge-20260919` recording), `e06efe58a5bc…` with facts, `a1d6664b4da4…` for the plain predictor.
- **Browsers:** pinned Chrome 153.0.8010.50, pinned Firefox 156.0, webkit-host on WebKit 22625.1.29.11.27, installed Safari 27.0. macOS build 26A428, DPR 2, scorer 7.
- **Time:** 11:47 to about 14:00 PDT, of the 6 hours allowed. Nothing is committed. The worktree is clean. No lock is left.

Words used here:
- A **case** is one styled paragraph at one width. A **fresh set** is a set of generated cases whose ids nobody used before.
- **No facts** is the headline configuration: the library gets no supplied font facts. **Facts** is the same cases with the lab's font facts.
- A **prediction failure** is a case that fails lineCount, breaks or widths.
- A failure is **covered** when the library reported a gap (a named "don't know") that touches what differs. An **open row** is a failure without a covered explanation.
- A **residual class** is a registered tiny difference (two exist, both Gecko's). Its rows are counted apart. **Probed** means a probe confirmed the member. **By signature** means it only matches the pattern.
- A **history-dependent** case lays out differently in forward and reverse order. It is left out of the rates.
- The **lab path** prepares a paragraph for inspection and inspects every line. The **plain path** is what an application runs.

### Verdict

**Yes: on 215,954 unseen cases the library at HEAD is at least as correct as the correctness line in every browser and metric.** Chrome and webkit-host are level with the line (every pass rate within 0.04 points, inside the line's own spread between sets, and on the line's own 147,674 Chrome and webkit-host cases HEAD gives every case the status it had at the line), and Firefox is better (prediction failures 138 → 98 per 10,000, widths 98.91 → 99.29%). No prediction got worse; two counts read worse and both come from the draw of cases: Chrome's open rows without facts are 8 (1.09 per 10,000) against 2 (0.27), all in two classes the known tail names, and webkit-host's lineCount and breaks are 0.03 points lower; the giants pass exactly as at the line, and their prediction costs about 1.3 times the line's time in Firefox, no more than the line's in Chrome without facts, and about half in webkit-host.

### 1. The table

Headline configuration (no supplied font facts) unless a row says otherwise. Three unseen fresh sets a browser, both orders, `--repeat=3 --widths-per-paragraph=2`, scored and aggregated with the line's own `aggregate.ts`. "Line" is ROUND4-EVALUATION.md section 1, recomputed from the line's aggregate files (they match the document).

| | Chrome, line | Chrome, now | Firefox, line | Firefox, now | webkit-host, line | webkit-host, now |
|---|---:|---:|---:|---:|---:|---:|
| Fresh cases | 75,132 | 73,234 | 74,200 | 72,038 | 72,542 | 70,682 |
| lineCount, % pass | 99.77 | 99.80 | 99.86 | 99.88 | 99.93 | 99.90 |
| breaks, % pass | 99.65 | 99.69 | 99.68 | 99.71 | 99.79 | 99.76 |
| widths, % pass | 99.44 | 99.40 | 98.91 | 99.29 | 99.59 | 99.66 |
| painter, % pass | 98.73 | 98.73 | 97.08 | 97.13 | 95.74 | 95.78 |
| Prediction failures per 10,000 (cases) | 89 (672) | 89 (654) | 138 (1,026) | 98 (704) | 59 (431) | 57 (400) |
| Open rows per 10,000, by the scorer (rows) | 0.27 (2) | 1.09 (8) | 0 | 0 | 0.28 (2) | 0 |
| Open rows on the same cases with the lab's facts | 4.13 (31) | 1.91 (14) | 0.81 (6); residual 5.7 (42: 9 probed, 33 by signature) | 0; residual 7.5 (54: 17 probed, 37 by signature) | 0.28 (2) | 0 |
| Open in either configuration | 4.39 (33) | 2.46 (18) | 0.81 (6) | 0 | 0.28 (2) | 0 |
| Passing cases with a wrong predicted value (no facts; facts) | 0; 0 | 0; 0 | 0; 0 | 0; 0 | 1; 12 | 0; 4 |
| History-dependent cases, left out (no facts; facts) | 0; 0 | 0; 0 | 0; 0 | 0; 0 | 383; 383 | 425; 417 |
| Open rows by set, no facts | 0 / 1 / 1 | 3 / 3 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 1 / 1 | 0 / 0 / 0 |
| Open rows by set, with facts | 7 / 14 / 10 | 4 / 6 / 4 | 0 / 3 / 3 (residual 18 / 12 / 12) | 0 / 0 / 0 (residual 18 / 24 / 12) | 0 / 1 / 1 | 0 / 0 / 0 |
| Open in reverse order only (no facts; facts) | 0; 0 | 0; 0 | 0; 0 | 0; 0 | 0; 0 | 0; 0 |
| With facts: lineCount / breaks / widths / painter, % | 99.84 / 99.74 / 99.77 / 98.89 | 99.84 / 99.74 / 99.75 / 98.86 | 99.87 / 99.72 / 99.36 / 97.08 | 99.88 / 99.73 / 99.42 / 97.13 | 99.93 / 99.79 / 99.59 / 95.74 | 99.90 / 99.76 / 99.66 / 95.78 |
| With facts: prediction failures per 10,000 (cases) | 48 (363) | 49 (362) | 90 (671) | 84 (605) | 59 (431) | 57 (400) |
| Painter-only failures without an explanation (no facts; facts) | 28; 54 | 36; 67 | 0; 40 | 0; 39 | 31; 36 | 32; 41 |
| Values predicted (no facts; facts) | 12%; 74% | 12%; 74% | 8%; 98% | 8%; 98% | 9%; 14% | 9%; 14% |

- Open rows are the same ids in forward and reverse order in every set. None is open in reverse order only.
- The new sets are about 2.6% smaller than the line's. More generated ids were already used: 1.56 to 1.66 million used ids against 1.41 million, and family-width cases fell from 5,997 to 5,280 a Chrome set. The generators are unchanged since the line (only an unused export left `cases/font.ts`).
- Firefox had 0 history-dependent cases in all three sets, as at the line. The two-state process of `gecko/process-font-fallback-state` didn't show.
- What covers the failures is the same list of conditions as at the line, at the same firing rates on passing lines. No new condition name appears. The one that moved is Firefox's `in-word-prefix`: 506 covered failures at the line, 247 now. That is round 5's kerned-pair placement.
- webkit-host's history-dependent count differs by configuration in seed a (149 and 141). Six rich pre-wrap cases are history-dependent in one configuration's pair of runs only. The predictor's Canvas questions are part of a page's history.

### 2. Open rows, with ids

Every open row belongs to a known-tail item.

**Chrome, no facts (8).**
- `blink/soft-hyphen-line-one-unit-off-without-facts`, 4 rows, widths: `c-8eada0788a0c5732`, `c-b5cb43749872060c` (set a), `c-23a920dc53399f44` (b), `c-998b70a69f236ade` (c).
  - They are the item's own two `rule/hyphen-glyph` paragraphs at new widths. Engine line 0 is 11,797 or 16,405 LayoutUnits and the native line is one unit wider. Two runs differ and the `glyph-clusters` range touches one.
  - All 4 pass every metric with facts. The line drew 2 such widths, this evaluation 4.
- `lab/blink-rect-of-a-span-holding-only-a-trimmed-space`, 4 rows, breaks: `c-9a8335fb7f4de8ea` (a), `c-57433381c0529756`, `c-b2d5853cd6f6e043` (b), `c-91e649ad8b4a17d4` (c). They are open with facts too.

**Chrome, with facts (14).**
- The same 4 trimmed-space rows, plus 9 more of that class that read covered without facts: `c-598ce5f4c53a4dd0`, `c-a4e6f6cdf366087b`, `c-c2d080bef8dda98e` (a), `c-3fdc61c00860717b`, `c-5652f960e981e2c8`, `c-815237ec80c4b0f1`, `c-8649a5a21efb69be` (b), `c-25422cb1a6609e6f`, `c-c75f11c7797cb91d` (c).
  - All 13 have the same reading: breaks fails with "element N: native lines K; expected none", and lineCount and the painter pass.
  - The line had 26 of this class, all covered without facts by `glyph-clusters` by position. Here the cover falls on 9 of 13.
  - The cover itself did not change: on the line's own 26 cases HEAD gives the same status as the line did (section 4).
- `blink/arabic-at-shaping-edges`, 1 row, widths: `c-47cedad153dfedc2` (c). Covered without facts.

**Firefox.** 0 open rows in both configurations. Residual rows with facts: 54.
- `gecko/one-shaping-unit-one-app-unit`: 42 rows, all `runs/mixed-fonts-sizes`. 5 probed: `c-15dda5499d79ba3a`, `c-4cdd44851faebeb0`, `c-c8720f3eec0a6d34`, `c-67e8353d2788efc4`, `c-db7fb3ba022cf34f`. 37 by signature.
- `gecko/synthetic-bold-offset`: 12 rows, all probed, all `runs/split-word`: `c-6663c9b32a13ba7f`, `c-875951c824bd30f8`, `c-efa5e3ff08af3c1a`, `c-2dc059b225d50a5b`, `c-3393b6ec57ba2645`, `c-3def4ec2ec85e8df`, `c-a22332e058c7f70d`, `c-a3431f03444f37f2`, `c-afb6d582f62604f0`, `c-9b0a23a3ed195d79`, `c-a658ea5e9379cb4f`, `c-cc582c32ed74f913`.
- The line had 39 and 3. Its 6 rows with two 1 au units on one line, which counted as open, have no counterpart in these sets. All ids are in `aggregate/tables.json`.

**webkit-host.** 0 open rows. The line's 2 (`lab/webkit-code-point-rects-on-two-lines`) have no counterpart here.
- Passing cases with a wrong predicted value, with facts: `c-19a3eb1382ee373c`, `c-fc34da2189abbaa4` (b), `c-18230d813b0e7b2e`, `c-24f1a02aedfb45e5` (c).
- Each holds one differing value, an element rect width one or two float32 steps off. That is `lab/webkit-element-rect-width-float-step`.
- I read two: 47.22967529296875 natively against 47.22968292236328 expected, and 36.159996032714844 against 36.15999984741211.

**Painter-only rows without an explanation.** Chrome 36 and 67, against 28 and 54 at the line; the pass rate is the same to 0.03 points.
- The kinds are the line's: a painted extent one LayoutUnit off, and a painted line that wraps in rich pre-wrap.
- Two families are new in Chrome's list: `rich-prewrap/newlines` (7 and 8 rows) and `runs/span-at-space` (2 and 3). I read six of them. They are a width of 9,115 against a painted 9,116, and "engine line 2 painted on 2 lines".
- The painter did not change on the line's own cases: the paired check reproduces 28 and 54 exactly.

### 3. New classes: none

Of the 15 exact open signatures (18 cases, all Chrome), the line's reports hold 7 exactly. The other 8 are new by a font name, a style word or a sign, one case each. I opened four of them.

- **Seven rich pre-wrap variants** (Arial, Arial+Georgia with letter spacing, Courier New bold, Courier New, Times New Roman): the trimmed-space class.
  - `c-57433381c0529756` (new signature). Arial 16px, width 63px, `pre-wrap` with `overflow-wrap: break-word`. Two Georgia 12px spans with 0.3px letter spacing and `white-space: normal` hold 3 and 6 spaces. Predicted and native lines agree (5 lines). The first span's spaces are trimmed at the end of line 0. Natively the span reports a rect on line 0 at x 56.93. The port expects none.
  - `c-9a8335fb7f4de8ea` (new signature). Courier New 16px, width 144px. Two bold spans hold 2 and 4 spaces. 3 lines agree. Element 0 reports a rect at x 96.02. The port expects none.
  - `c-91e649ad8b4a17d4` (a signature the line's reports hold). Menlo 16px, width 251px. Two Menlo 30px spans hold 2 and 4 spaces. 2 lines agree. Element 1 reports a rect at x 201.09. The port expects none.
  - In all three the predicted lines carry no gap, which is why these read open without facts. It is the observation port's rule for a span without laid-out text, as the known-tail item says. Every code point is on the right line.
- **`runs/bidi-runs | widths | Geeza Pro | Latin+Arabic | +129-256u`**, `c-47cedad153dfedc2`, the only case.
  - Geeza Pro 20px, width 156px, `overflow-wrap: break-word`, lang ar. A 20px Arabic span, the text `0x7fffffffffffffff `, then a 16px Arabic span.
  - 4 lines agree. Line 2, `ffff عليكم ورحمة الله `, is 15,656 LayoutUnits predicted and 15,810 native (1.2px). The first differing unit is a lam of `الله` at the line's end.
  - The gaps on the line (`glyph-clusters`, `unsafe-to-break`, `script-context`) sit elsewhere.
  - It belongs to `blink/arabic-at-shaping-edges` (Geeza Pro ligatures that form in some contexts only). The line's two members were narrower natively. This one is wider.

Two shifts inside covered failures, both the draw (the paired check shows no move):
- Chrome's white-space kind has 18 failures against 5: 8 `ws/trailing-space-edge` widths under `unsafe-to-break`, and 7 against 4 under `tab-stops`.
- webkit-host's line count failures are 73 against 53: `page-history` in rich pre-wrap 45 against 34, `canvas-language` in rule families 17 against 8.

### 4. A supplementary paired check (beyond the brief)

Two triples of different cases differ by chance, so I also ran the line's own three sets (`eval-r4-1..3`, the line's part files) with the library at HEAD. The protocol is the same: one job per part and order, 25 cases a round trip, both orders, both configurations. Outputs are in `paired/`; nothing of the line's folders was written. These sets are not unseen any more, so this is a control, not the measurement.

| The line's own sets | Chrome | Firefox | webkit-host |
|---|---|---|---|
| Cases compared | 75,132 | 74,200 | 72,542 |
| No facts, line | 99.77 / 99.65 / 99.44 / 98.73; 672 failures; 2 open | 99.86 / 99.68 / 98.91 / 97.08; 1,026 failures | 99.93 / 99.79 / 99.59 / 95.74; 431 failures; 2 open; 383 history-dependent; 1 wrong value |
| No facts, HEAD | the same in every number | 99.86 / 99.71 / 99.24 / 97.08; 765 failures (103 per 10,000) | the same in every number |
| Status moves, no facts | 0 on a metric (one case's covering names changed) | widths 243 fail → pass and 18 unobserved → pass; breaks 18 fail → pass; lineCount 4; painter 2; **0 from pass** | 0 |
| Status moves, facts | 0 | 1 (widths fail → pass, `c-6ea5309ae737e069`) | 0 |
| With facts, HEAD | 363 failures, 31 open, 54 painter-only: the line's | 670 failures, 6 open, 42 residual | 431 failures, 2 open, 12 wrong values: the line's |

- On `eval-r4-1` (no facts, forward) the native observations equal the line's on all 74,389 rows, so the browsers and the lab did not drift.
- Predicted line ranges there equal the line's on 25,196 of 25,196 Chrome cases and 24,326 of 24,326 webkit-host cases. They differ on 8 of 24,867 Firefox cases (round 5's fixes).
- So Chrome's and webkit-host's differences in the table of section 1 are what two triples differ by with the same library.
- Firefox's gain is real: it shows on the line's own cases (138 → 103 per 10,000) and on the new ones (98).

### 5. The giants

9 held-out giants (106,857 to 269,747 UTF-16 units), the line's own command: three browsers side by side, both configurations, both orders, one case a round trip. The lock gives such a job its browser's slot, not the machine, as at the line.

**Metrics: all 108 giant rows have the line's status on every metric.**
- Chrome without facts: lineCount and breaks pass on 9. Widths and painter fail on the same 6, covered, one LayoutUnit on a line (for example engine line 833 of `c-66bc1953a23b79d3`: 96,776 against 96,775). The 6 are `c-66bc1953a23b79d3`, `c-98ab54a5eeff7b16`, `c-c8110fb16910a3a7`, `c-def592b648d927eb`, `c-ed7fc24c9ab52c94`, `c-f4d60d8ee5be0ec0`.
- Chrome with facts: all 9 pass everything.
- Firefox: all 9 pass everything in both configurations.
- webkit-host: lineCount and breaks pass on 9. Widths and painter are unobserved on 8 and pass on 1, as at the line.

**Prediction time on the lab path.** This is `timings.predictMs` of each row, in ms, file order. "Line" is the freeze's giants run (`freeze-line/giants`).

The first pass ran while another workflow's offline gates held the machine at load averages of 60 to 160, so I timed the giants once more (file order only) when the load fell to 4.
- Firefox's jobs and Chrome's no-facts job ran at load 4 to 7.
- Chrome's facts job ran while the load rose to 37.
- webkit-host's jobs ran at 7 to 62.

The numbers are information, not a gate.

No facts, line → now:

| Giant | UTF-16 units | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|---:|
| `c-13df3b081fe1aee6` | 106,857 | 3,731 → 2,980 | 578 → 669 | 244 → 126 |
| `c-4a74f05dd2b4662b` | 106,857 | 4,218 → 3,128 | 424 → 524 | 265 → 53 |
| `c-66bc1953a23b79d3` | 106,857 | 3,528 → 3,096 | 354 → 447 | 139 → 33 |
| `c-98ab54a5eeff7b16` | 106,857 | 3,658 → 3,045 | 348 → 416 | 155 → 32 |
| `c-c8110fb16910a3a7` | 256,837 | 10,096 → 7,133 | 866 → 1,121 | 666 → 216 |
| `c-def592b648d927eb` | 106,857 | 3,816 → 2,864 | 359 → 459 | 188 → 141 |
| `c-ed7fc24c9ab52c94` | 256,837 | 11,226 → 6,887 | 783 → 1,316 | 853 → 479 |
| `c-f4d60d8ee5be0ec0` | 106,857 | 3,447 → 2,877 | 354 → 509 | 171 → 249 |
| `c-d7f1b045c2bb4afb` | 269,747 | 6,951 → 5,812 | 507 → 585 | 232 → 236 |
| All nine, s | | 50.7 → 37.8 (×0.75) | 4.6 → 6.0 (×1.32) | 2.9 → 1.6 (×0.54) |
| All nine in the first pass under load, s | | 79.6 | 13.2 | 2.1 |
| Canvas calls, all nine: line's calls + memo answers → calls now | | 1.93 M + 36.8 M → 22.8 M | 0.75 M + 2.79 M → 4.68 M | 0.11 M + 0.67 M → 0.32 M |

With facts, all nine (s):
- Chrome 81.3 → 102.3 (×1.26, the load rising; the last giant alone 21.4 → 43.0).
- Firefox 4.5 → 6.1 (×1.33).
- webkit-host 2.7 → 1.2 (×0.43).
- The per-giant rows are in `giants/giants-compact.md`.

Reading:
- The memo is gone, so every question is now a Canvas call.
- Firefox is about 1.3× slower on a quiet machine. DESIGN.md §4.7 measured 3.6× when the memo went.
- webkit-host is about twice as fast (round 5 measures a box's space once).
- Chrome without facts was faster than the line's run in the quiet window. The line's own times were taken beside other owners' jobs, so I would not claim a speed-up.
- Under load the same library read ×1.6 in Chrome and ×2.9 in Firefox. Machine load moves these numbers more than the library does.

### 6. The plain path

Seed b, forward order, `baselines/plain-predictor.ts` on the same cases and parts (the fresh tool takes a second predictor on a seed: `runs/`). Line ranges compared with the usual no-facts run by `compare-rows.ts --prediction=line-ranges`.

| | Cases | Line ranges differ | Native observations differ |
|---|---:|---:|---:|
| Chrome | 24,423 | 0 | 0 |
| Firefox | 23,991 | 0 | 0 |
| webkit-host | 23,570 | 0 | 22 |

- webkit-host's 22 are 21 `rich-prewrap/trailing-spaces` cases and 1 `rich-prewrap/nested` case.
  - 21 of the 22 are history-dependent in the usual both-orders run. The plain path asks Canvas less, so the page has another history (`webkit/page-history`).
  - Their line ranges are equal, and the plain run's line count passes on all 22.
- The plain run's line count pass rate equals the usual run's (Chrome 49 failures of 24,423).
- A plain row holds line ranges alone, so widths and the painter aren't compared on this path.

### 7. Installed Safari

One forward pass of webkit-host's 17 tier 2 case files in installed Safari 27.0 with `--allow-safari-frontmost`, 11:52 to 12:06, run with SAFARI-CHECK.md's tools pointed at this worktree.
- Safari's automation (AppleScript) started without complaint.
- All 17 jobs exited 0, each as one part (the two long files with `--part-ms=420000`). Every row was visible.
- All 17 case file hashes equal the recorded protocol's. The bundle equals the host recording's.

Against webkit-host's forward rows of `.artifacts/tests/runs/cr5-merge-20260919/webkit-host-no-facts`, observation against observation:

| | Cases | Native observation differs | Prediction differs | Painted lines differ | Missing |
|---|---:|---:|---:|---:|---:|
| All 13 sets | 63,987 | 0 | 0 | 0 | 0 |

- No environment field differs on any row.
- Observed: 233,965 native lines, 2,359,985 code point rects, 293,614 text node rects, 13,151 element rects, 7,452 slot floats, 234,039 painted lines.
- Scored against the host's recorded reverse rows, Safari gives what the host's recording gives: 99.87 / 99.78 / 99.58 / 93.04, 398 prediction failures, 0 open, 283 history-dependent, 24 painter-only.
- So Safari still equals webkit-host on every tier 2 case, and the library's predictions hold there exactly as in the host.
- Not run: reverse order, the facts configuration, fresh sets, giants.

### 8. What went wrong during the run

- **Chrome's native hang.**
  - `final-20260919-a` part 2 stalled in both orders ("No page activity for 120000ms").
  - A one-case-a-round-trip run of the cases neither order had reached found one hanging case, `c-a948c5abca7d9a92`. It has the known `blink/range-rects-hang` signature (details withheld: platform-bugs entry 13).
  - Every other case of the part ran somewhere without hanging.
  - I set it aside the lab's way (`parts/excluded-native-hang.ndjson`, `part-02.before-exclusion.ndjson`, counts corrected in `parts.json`). The one `--rerun-failed` passed.
  - Chrome's set a has 24,531 cases for it. The case belongs in the known-tail item's list.
- **A trap, not a bug.** `run.ts --order=reverse` groups cases by page context, so it is not the mirror of file order, and `run.json`'s `order` is the word, not a list.
  - Find a stalled round trip from the last id in the rows file. My first reading by mirrored index pointed at the wrong 25 cases.
  - The line's `sealed4-hang.py` has the same assumption.
- **Load.** Another workflow's `gates.ts` runs took the machine to load 60 to 160 while the giants ran. Metrics are unaffected. The times needed the second pass.
- **The lock.** `--browser=all` over a one-browser command takes that browser's slot only, so the giants never ran alone, now or at the line.

### 9. What this evaluation can't say

- **One Mac** (18 cores, 36 GB), one OS build, DPR 2, `zh-CN` process languages, these pinned builds. A Safari or macOS update voids section 7.
- **Generated kinds only:** runs, white space, policy, rich pre-wrap, and the family paragraphs at new widths. The suite pool is used up, so no old-suite case is unseen any more. "Unseen" means new draws from generators the library was built beside, not new kinds of text.
- **Noise between two triples.** The spread between the three sets of a triple (max − min), beside the difference now − line:

| No facts | lineCount | breaks | widths | painter | Failures per 10,000 |
|---|---:|---:|---:|---:|---:|
| Chrome: line's spread / ours | 0.02 / 0.02 | 0.06 / 0.04 | 0.10 / 0.09 | 0.12 / 0.13 | 4.6 / 9.8 |
| Chrome: now − line | +0.03 | +0.04 | −0.03 | 0.00 | −0.1 |
| Firefox: line's spread / ours | 0.04 / 0.05 | 0.05 / 0.05 | 0.18 / 0.07 | 0.19 / 0.29 | 20.2 / 12.5 |
| Firefox: now − line | +0.02 | +0.03 | **+0.38** | +0.06 | **−40.5** |
| webkit-host: line's spread / ours | 0.04 / 0.05 | 0.12 / 0.08 | 0.04 / 0.07 | 0.43 / 0.20 | 10.3 / 1.5 |
| webkit-host: now − line | −0.03 | −0.04 | +0.07 | +0.04 | −2.8 |

  - The binomial standard error of a difference between two triples is 0.02 to 0.04 points on lineCount, breaks and widths, and 0.06 to 0.11 on the painter. Cases share paragraphs, so the true error is larger.
  - Only Firefox's widths and failure count stand clear of noise.
  - webkit-host's −0.03 on lineCount is 1.9 standard errors. The paired check, not this table, is why I call it the draw.
- **Open-row counts are small numbers and depend on where a wide gap happens to fire.** The trimmed-space class read 0 open without facts at the line and 4 now, with no change in the library. Read the no-facts count beside the facts count, as the line said.
- **Without facts, 8 to 12% of values are predicted,** so "wrong value in a passing case" is nearly vacuous there. The facts column carries it.
- **The painter** is scored by extents and wraps only.
- **One Chrome case was not observed** (the hang).
- **Firefox's two process states** did not occur. A run where they do would read lower, as the round 4 critic's set did.
- **The plain path:** one seed a browser, forward, line ranges only.
- **Giants' times** move more with machine load than with the library.

### 10. Commands to repeat it

New seeds need new names; the tool refuses used ids by itself.

```sh
cd ~/github/pretext-rebuild-wt/final-eval                      # worktree at the commit under test; .artifacts links to the shared folder
E=~/github/pretext-rebuild/.artifacts/final-eval-20260919      # tools/ holds every script named here
# 1. Fresh sets: headline configuration first (it generates the set), then the lab's facts on the same cases and parts
bash $E/tools/fresh.sh no-facts a b c && bash $E/tools/fresh.sh facts a b c
#    each job: bun rebuild/lab/fresh.ts --browser=<b> --seed=final-20260919-<n> --both-orders --config=<c> --repeat=3 --widths-per-paragraph=2
#    a stalled Chrome part: python3 $E/tools/find-hang.py <part file> <first> <last> <out>, set the case aside in parts/, then the same fresh.ts call with --rerun-failed
# 2. Aggregate as the line did (the line's aggregate.ts and cross-config.ts, imports pointed at this worktree)
bash $E/tools/aggregate-fresh.sh && python3 $E/tools/tables.py && python3 $E/tools/one-table.py
bun $E/tools/cross-config.ts <browser> final-20260919-a final-20260919-b final-20260919-c
# 3. Giants, last; then the times (giants-compact.py also needs the timing pass's times, below)
bash $E/tools/giants.sh
python3 $E/tools/giants-times.py final=$E/giants > $E/giants/final-times.json
python3 $E/tools/giants-times.py line-freeze=.artifacts/ceiling-20260917/freeze-line/giants > $E/giants/line-times.json
bash $E/tools/giants-timing.sh                                 # a timing pass, started when the load average is low
python3 $E/tools/giants-times-forward.py timing=$E/giants-timing > $E/giants-timing/timing-times.json
python3 $E/tools/giants-table.py && python3 $E/tools/giants-compact.py
# 4. Plain path on one seed, then line ranges against the usual run, per part
bun rebuild/lab/fresh.ts --browser=<b> --seed=final-20260919-b --predictor=$PWD/rebuild/lab/baselines/plain-predictor.ts
bun rebuild/lab/compare-rows.ts <seed>/runs/part-NN-forward/<b>-rows.ndjson.zst <seed>/runs-no-facts/part-NN-forward/<b>-rows.ndjson.zst --prediction=line-ranges
# 5. Installed Safari (takes focus), then case by case against the host's newest recording, then scored
bash $E/tools/run-safari.sh smoke-hand:0 smoke:0 ws:0 heldout-ws:0 rich-prewrap:0 policy:0 heldout-policy:0 runs:0 heldout-runs:0 \
  features:0 families:0 suite-sample:0 suite-sample:1 suite-sample:2 heldout-suite-sample:0 suite-sample:3 heldout-suite-sample:1
bun $E/tools/compare-runs.ts --a=safari,safari,$E/safari/runs \
  --b=host-cr5,webkit-host,.artifacts/tests/runs/cr5-merge-20260919/webkit-host-no-facts/runs --orders=forward --out=$E/safari/reports/safari-vs-host-cr5-forward.json
bash $E/tools/safari-score.sh
# 6. The paired check on the line's own sets
bash $E/tools/paired.sh && bun $E/tools/paired-transitions.ts
# Rows: ~/github/pretext-rebuild/.artifacts/session/compress-rows.sh <absolute folder>
```

**Housekeeping.**
- 244 run records: 242 ok, and the 2 stalled Chrome jobs, kept as `.failed-*` folders.
- All row files over 1 MB are compressed (264 `.zst` files). The fresh sets take 2.2 GB and my folder 2.9 GB.
- No tracked file was edited and nothing ran with `--record`, `--seed`, freeze, pack or adopt.
