# Calibration: main's whole suite on today's library, and what a pass rate means (2026-09-19 and 20)

The maintainer's point: a pass rate only means something against the distribution of cases ("we could drown out the bad
cases by excessively making the usual cases that are almost impossible to get wrong"). They also asked whether main's
full suite had ever been run on the rebuild: once, on 2026-09-17, against that day's library (research/CENSUS.md). One
agent ran it again on today's library (b2d9050, no supplied font facts) in the three pinned browsers, with native layout
observed again and main's predictor rerun on the same pages, and built the table below; a second agent recounted every
number with its own code and looked for the ways such a table misleads. The checker's review comes first. "Main" is the
published library: a sum of word widths with corrections.

## What came back, and the orchestrator's reading

- **Line-count pass rates, main then the rebuild:** Chrome 73.85% and 99.45% (238,518 cases), Firefox 80.15% and 99.89%
  (238,412), webkit-host 76.15% and 99.89% (238,369, with 5,555 page-history cases set aside).
- **The two honest numbers.** Of the cases main gets wrong, the rebuild gets right 98.33% (Chrome), 99.71% (Firefox) and
  99.76% (webkit-host). Of the cases main gets right, the rebuild gets wrong 0.16% (280 cases), 0.06% (116) and 0.07%
  (122), and the scorer finds a covering gap on all but 3 Chrome cases. With main's visible breaks required to pass as
  research/MAIN-TRIAGE.md defines it, the second number is 0.28%, 0.09% and 0.17% (the checker's correction of the
  census's 0.38, 0.12, 0.20). webkit-host's pair is the favourable end of a range: a set-aside rule blind to the rebuild's
  outcome gives 99.56% and 0.32% on a random 6,000-case sample, because page history in the lab's long documents touches
  passes too; only isolating the listed cases settles it.
- **The distribution the table hides most** (the checker): 67% of the suite is under 40px wide and 88% under 80px. At 80px
  and over the rebuild has 2 wrong-lines cases in Chrome and 0 in Firefox, and passes all 746 and 1,025 of main's
  failures there.
- **Real paragraphs** (4,686 a browser, cut from 18 of main's corpora at 6 widths): the rebuild has 0 wrong lines
  everywhere, and MAIN'S LINE COUNT PASSES 99.96%, 99.96% and 100%. So the suite's 20 to 26% main failure rate comes from
  its adversarial families and its narrow widths. On ordinary text at ordinary widths both libraries count lines right;
  what the rebuild adds there is exact breaks and widths, and what it adds on hard text is the line count itself.
- **Counting each family once** changes little for the rebuild (99.45%, 99.86%, 99.86%; with 120 near-copy
  control-character families counted as three, 99.82%, 99.87%, 99.79%) and much for main (69.68% becomes 80.35% in Chrome).
- **Since 2026-09-17**, on the same cases, the rebuild's line count went from 98.68% to 99.45% (Chrome), 99.63% to 99.89%
  (Firefox) and 99.73% to 99.89% (webkit-host), although that day's library was handed font facts and today's is not.
- **Found on the way.** webkit-host's page history is about four times what was known (5,527 of its 6,043 wrong-lines
  cases lay out differently in short fresh documents; 516 are stable failures). 63 Chrome and 53 webkit-host cases passed
  on 09-17 and fail today even with facts: widths of 0 to 57px, Amiri `raw-context`, beh-kasra soft hyphens, ligature
  thresholds (ids under `.artifacts/census-20260919/rerun/`). 3 Firefox `chromium-script-spacing` cases (a combining mark
  after TAB or LF) fail today and name no gap with facts. 88 webkit-host giants weren't scored (two stalls at a
  269,747-unit paragraph).
- **What this table can't say:** anything about widths and breaks for main (it returns line ranges only); anything about
  text the suite and the corpora don't hold; Firefox's page history among passes (not sampled).
- The census's tools are on the local branch `x-census` (about 700 lines, tools and checks only) and are not merged, to
  keep the tree small; outputs are under `.artifacts/census-20260919/`.

## Check of the calibration census (2026-09-20)

What was checked: the census of 2026-09-19 (branch `x-census`, output folder `~/github/pretext-rebuild/.artifacts/census-20260919/`, called "the census folder" below) and its calibration table. The checks are new files under `rebuild/tools/census/check/` on the same branch. Their outputs are under `~/github/pretext-rebuild/.artifacts/tests/runs/census-check-20260919/` ("my folder" below).

Labels used here:

- **H1**: of the cases main gets wrong, the share the rebuild gets right. **H2**: of the cases main gets right, the share the rebuild gets wrong. Both by line count, as the census counts them.
- **Record**: one line of `<browser>/<chunk>/cases.ndjson` in the census folder: one case in one browser, with the rebuild's statuses, main's line-count status and a hash of the native view.
- **Native view**: what the scorer compares between two runs of a case: every code point's and node's rect x, width and native line (`score.ts nativeView`).
- **Long document**: a census run as it was made: up to 19,784 cases in one browser process, in file order.
- **Set-aside**: the 5,555 webkit-host cases the census leaves out of its headline column as page history.
- **Main-only**: a case where main's line count is right and the rebuild's is wrong (H2's numerator). **Wrong lines**: the rebuild fails lineCount or breaks.

### 1. Verdicts

| # | Claim | Verdict |
|---|---|---|
| 1 | Cases scored: 238,518 Chrome, 238,412 Firefox, 238,369 of 238,457 webkit-host; 88 long paragraphs missing | **Stands.** Every id of the 23 chunk files is there once per browser; none twice; none dropped but the 88 (corpus04 16, corpus06 18, corpus07 54). |
| 2 | Line-count pass rates, main then rebuild: 73.85 / 99.45, 80.15 / 99.89, 76.15 / 99.89 | **Stands.** My count equals `calibration.json` on every count of every family. |
| 3 | H1: 98.33% (Chrome), 99.71% (Firefox). H2: 0.16% (280), 0.06% (116) | **Stands.** No way of misleading that I measured moves H1 by more than half a point or H2 by more than 0.1 point in these two browsers (section 3). |
| 4 | webkit-host H1 99.76%, H2 0.07% (122), with 5,555 set aside | **Stands with a correction.** It is the favourable end of a range. The set-aside takes the rebuild's failures alone. On a random sample, a rule that takes passes and failures alike gives H1 99.56% and H2 0.32% (section 4). The headline's 122 also leaves out 26 main-only cases that only the 09-17 list names and that today's reruns found stable: with them H2 is 0.08% (148), which the census's own section 5 shows. |
| 5 | With wrong breaks counted too: 0.38%, 0.12%, 0.20% (671, 227, 347) | **Stands as the census defines it, with a correction.** MAIN-TRIAGE counts a main pass on breaks only when main's visible breaks pass. By that definition the numbers are 0.28% (490), 0.09% (173) and 0.17% (300). The census's figures count against the rebuild 181, 54 and 47 cases where main's visible breaks don't pass either. |
| 6 | A covering gap on every one of these failures except 3 Chrome cases | **Stands** (668 of 671, 227 of 227, 347 of 347). The records' covered flags equal the scorer's on every row I re-derived. The owner's caveat holds: in Firefox `optical-size` takes part in all 564. |
| 7 | By difficulty: 98.3 to 99.8% of main's failing half, 99.8 to 99.9% of its passing half | **Stands.** |
| 8 | "Counting each family once changes little: 99.45%, 99.86%, 99.86%" | **Stands for the rebuild, with a correction.** 120 of the 386 families are one template with another control character (`U+XXXX/start`, `/middle`, `/end`). Counted as three families, the means are: rebuild 99.82% / 99.87% / 99.79%; main 80.35% / 84.73% / 81.13%, not 69.68% / 80.78% / 71.67%. The row's main figure is the one the copies move. |
| 9 | webkit-host: 5,527 of 6,043 wrong-lines cases lay out differently in short fresh documents; all right in at least one order; 516 stable; Chrome and Firefox none | **Counts stand. The reading needs two corrections** (section 4): page history touches passes too (2.2% of the sample's long-document passes), and a rerun document made of failures alone is not what a random fresh process gives. |
| 10 | Real paragraphs: rebuild 0 wrong lines; main 99.96%, 99.96%, 100% | **Stands.** |
| 11 | Since 2026-09-17: 98.68 to 99.45, 99.63 to 99.89, 99.73 to 99.89; still failing with facts 63 of 69, 7 of 67, 53 of 53 | **Stands**, with the owner's own caveats (other configuration, other scorer). |
| 12 | "Main passes" is MAIN-TRIAGE's definition; the rebuild's statuses are the lab scorer's; both predictors are scored against one native observation | **Stands.** Re-derived from the rows on 745,063 rows with 0 differences (section 2). |
| 13 | Branch: six commits, tools only | **Stands.** `git diff b2d9050 f08455d` touches `rebuild/tools/census/` alone. |

### 2. What I re-derived, and how

- **Every count** (`check/recount.py`, a second implementation in another language, reading the records alone).
  - It equals `calibration.json` on all 28 counts of all 386, 381 and 384 suite families, the 18 real-text families, the three totals a browser, the rerun counts and the 09-17 moves: 0 counts differ.
  - Nine family rows of the document were also compared by eye with a third count: Chrome `joined`, `U+FFFC/middle`, `raw-context`; Firefox `raw-context`, `original-vs-reshaped-admission`, `chromium-script-spacing`; webkit-host `ligature-thresholds-v3`, `following-space-scope`, `raw-context`. All equal.
- **The records against the rows** (`check/raw-check.ts`), without the census's code path for main (`withNativeRow` + `scoreRow`). For every row of a native run:
  - the case equals the case file's line and main's row for that id (sha1 of the JSON);
  - main's row has no native observation of its own (`--predict-only`), and the same browser build, devicePixelRatio, viewport scale, page language and user agent;
  - main passes exactly when the number of main's line ranges equals the scorer's native line count of THAT row;
  - the rebuild's four statuses, the covered flags and the native hash are the scorer's.
  - Result: 58 run folders, 745,063 rows, 0 differences of any kind, 0 main adapter errors. Logs: `raw-check-all.log`, `raw-check-rest.log`, `raw-check-rest3.log` in my folder.
  - Covered: every small chunk of every browser, corpus09 and corpus10 a browser, Chrome corpus00 to 02, both reruns, real-text and facts-pass-to-fail a browser, corpus04a. Not re-derived: the chunks with the giant paragraphs (496 Chrome cases, 576 Firefox, 479 webkit-host; their rows are 1.8 to 5.8 GB compressed).
- **The case set.**
  - The chunk files hold 238,524 cases. The 09-17 importer made them from all 707,431 rows of main's suite as recorded on 2026-09-16, and skipped none (`cases/gen-suite.log`, `suite-all.summary.json`).
  - Main's `src/` is byte-equal to `~/github/pretext/src`, and main has no commit to `src/` or `tests/wrapping/` since those rows.
  - A case's `browsers` field filters 6, 112 and 67 cases out per browser. That is the suite's own browser scope.
  - One thing the document doesn't say: each browser ran the union of the three browsers' suites. 5,040 Chrome cases, 4,570 Firefox and 4,215 webkit-host cases exist only in another browser's suite. Most are widths measured in that browser: 4,415 of Chrome's have a fractional width, and `maintained/closing-punctuation` holds 3,604 of them. Main passes 93 to 99% of them and the rebuild all of them by line count. Left out, H1 and H2 move by 0.01 point or less (`sensitivity.txt`).
- **The runs.** Every scored run is `ok` at DPR 2 with one bundle a predictor, but for webkit-host `corpus04a`, whose native run is the one the owner stopped (status `error`, 9 rows scored with `--partial`). My two sample runs built the same two bundles (262b202ce19e, e174da63c3a8), so the census's bundles are what the tree builds.
- **The 88 missing webkit-host cases.** On 2026-09-17 the rebuild passed line count on all 88 in webkit-host and main failed 18. Today the rebuild passes line count and breaks on all 88 in Chrome and in Firefox. With those outcomes H1 and H2 don't move in the second decimal. Worst case (all 88 main-only) H2 would be 0.12%.

### 3. Ways the table misleads, and how far each moves H1 / H2

All from `check/sensitivity.py` (output `sensitivity.txt`), over the census's kept cases.

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| as the census counts it | 98.33% / 0.16% | 99.71% / 0.06% | 99.76% / 0.07% |
| near copies: the 120 `U+XXXX` families left out (30,908 cases) | 98.46% / 0.13% | 99.72% / 0.06% | 99.67% / 0.08% |
| near copies: each styled text once, whatever its widths and directions (about 27,000 texts) | 98.54% / 0.09% | 99.78% / 0.04% | 99.76% / 0.03% |
| near copies: each template once (control and format characters made one placeholder; about 20,200) | 98.06% / 0.09% | 99.66% / 0.04% | 99.64% / 0.04% |
| definition: main right also needs its visible breaks; the rebuild right needs lineCount and breaks | 97.99% / 0.24% | 99.27% / 0.07% | 99.67% / 0.16% |
| main's `supported` rows only (the suite marks 20,906 cases `research`) | 98.27% / 0.18% | 99.70% / 0.07% | 99.75% / 0.08% |
| the browser's own suite only | 98.32% / 0.16% | 99.70% / 0.06% | 99.76% / 0.07% |
| without the long paragraphs | 98.33% / 0.16% | 99.70% / 0.06% | 99.76% / 0.07% |
| main's own history (Chrome's shared Canvas) | moves neither (below) | none seen | none seen |
| page history | none (0 of 6,000 sampled) | 0 of 564 failures; not sampled | section 4 |

- **Near copies.** The suite is about 27,000 styled texts at 8.8 widths and directions each. H2's numerator is smaller than it looks: Chrome's 280 cases are 87 distinct texts, Firefox's 116 are 50, webkit-host's 122 are 20. Counting each text once lowers H2 and leaves H1 where it is. The family mean is where copies matter (verdict 8).
- **Cases main fails by an accident of its own history.** Sample B ran 6,000 random cases again in Chrome, in a fresh process, in file order and reversed (section 5).
  - Main's line-count status differs between the three documents on 14 cases (0.23%, 95% interval 0.14 to 0.39%). 5 of main's 1,592 failures pass in another order, and 9 of its 4,408 passes fail in another.
  - The rebuild passes all 14, so H1 is 97.99% and H2 0.11% in all three documents. Scaled to the suite this is about 550 cases whose main status depends on main's history; they can't move H1 by 0.01 point.
  - In the census's own reruns 2 of Chrome's 280 main-only cases are main's history (280 to 278), as the document says.
- **Width is the distribution fact the table hides most** (`check/by-width.py`, output `by-width.txt`; records as observed):

| width, px | share of the suite | Chrome: main / rebuild lineCount / main-only | Firefox | webkit-host (as observed) |
|---|---:|---|---|---|
| under 20 | 41.8% | 54.72% / 98.91% / 220 | 71.69% / 99.80% / 88 | 53.36% / 98.49% / 602 |
| 20 to 40 | 25.2% | 80.07% / 99.64% / 55 | 78.03% / 99.93% / 23 | 86.37% / 98.56% / 385 |
| 40 to 80 | 21.2% | 91.00% / 99.97% / 5 | 90.30% / 99.99% / 5 | 95.15% / 99.00% / 125 |
| 80 to 160 | 4.9% | 94.66% / 100.00% / 0 | 93.92% / 100.00% / 0 | 97.34% / 99.47% / 8 |
| 160 to 320 | 2.7% | 98.94% / 100.00% / 0 | 98.61% / 100.00% / 0 | 99.73% / 100.00% / 0 |
| 320 and over | 4.2% | 99.52% / 100.00% / 0 | 97.81% / 100.00% / 0 | 99.61% / 100.00% / 0 |

  - 67% of the suite is narrower than 40px and 88% narrower than 80px. Every H2 case of Chrome and Firefox is under 80px.
  - At 80px and over (about 28,300 cases a browser) the rebuild has 2 wrong-lines cases in Chrome and 0 in Firefox. Main fails 746 and 1,025 line counts there, and the rebuild passes every one of them.
- **Not an accident of the adapter:** main predicts 0 lines on 1,300 cases; on 452 of them Chrome and webkit-host show one line (60 in Firefox). They are texts of soft hyphens alone (`U+00AD`, with CR or a space). The browser makes a line and main doesn't, so they are real failures of main. Scratch tool `main-diff.py` in my folder.
- **Firefox run to run:** 1,860 native views differ between 09-17 and today (1,723 in `measurement`). None is a rebuild failure or an H2 case today.

### 4. webkit-host page history: what a random sample shows

**Why a sample.** The census ran again only the cases where the rebuild has wrong lines, so its set-aside can only remove failures. Sample A: 6,000 of webkit-host's 237,339 scored small cases, every case equally likely (seed 20260920), run the way the census ran its reruns: a fresh process, file order and reversed, the rebuild with native observation and main alone (`check/sample.py`, `check/sample-run.sh`; rows in `sample/webkit-host/{file,reverse}/`; comparison `sample/compare-webkit-host.txt`). All four runs `ok`, DPR 2.

| the same 6,000 cases | main | rebuild lineCount | wrong lines | H1 | H2 |
|---|---:|---:|---:|---|---|
| the long documents, as observed | 75.77% | 98.55% | 166 | 96.84% (1,408 of 1,454) | 0.90% (41 of 4,546) |
| fresh process, file order | 75.75% | 99.18% | 73 | 98.21% (1,429 of 1,455) | 0.51% (23 of 4,545) |
| fresh process, reversed | 75.77% | 99.25% | 76 | 98.42% (1,431 of 1,454) | 0.48% (22 of 4,546) |
| long documents, the census's set-aside left out (154 cases) | 75.92% | 99.88% | 12 | 99.86% (1,406 of 1,408) | 0.11% (5 of 4,438) |
| long documents, every case whose native view differs among the three documents left out (262 cases) | 76.14% | 99.65% | 30 | 99.56% (1,363 of 1,369) | 0.32% (14 of 4,369) |

- **The sample reproduces the census's column** under the census's rule: 99.86% and 0.11% against 99.76% and 0.07% (95% intervals 99.48 to 99.96% and 0.05 to 0.26%).
- **Page history touches passes too.** Of the 5,834 cases with right lines in the long document, 126 (2.2%) have another native view in a fresh order. The rebuild has wrong lines in one fresh order on 32 of them and in both on 6. The census could not see these.
- **A rule that doesn't look at the rebuild's outcome** (set aside any case whose native view differs among the three documents: 262 cases, 136 failures and 126 passes) gives H1 99.56% (interval 99.05 to 99.80%) and H2 0.32% (0.19 to 0.54%).
  - The sample runs high on H2: its long-document H2 is 0.90% where the whole suite's is 0.62% (41 cases where 28 were expected). Read 0.32% with that in mind.
- **Why the two rules differ: 20 failures** (9 of them main-only). They keep one native view in the long document and in both random fresh orders, and the rebuild is wrong in all three. The census set them aside: its reruns laid 19 of them out differently, with the rebuild right in both orders on 18 and in one on 1, and the 09-17 list names the other.
- **A random fresh process is not history-free either.** Every one of those 20, and every one of the 6 long-document passes that fail in both fresh orders, has 2 to 9 cases with the same text in the sample, some before it and some after it in file order. The suite holds each of these texts 80 to 453 times under other fonts, widths and directions, and the known tail says WebKit's break cache is keyed by text without font or direction. So both of my orders can be polluted the same way, and so can the census's rerun documents (8 to 197 copies of each of the 20 failures' texts there).
- **What this means.** No document made of many suite cases shows webkit-host without history. The lab's isolation evidence (known tail `webkit/page-history`: 82 of 90 such failures pass alone in a fresh process) favours the census's reading for failures. But the census's column is the favourable end: H1 lies between 99.56% and 99.76%, H2 between 0.07% and 0.32%. Both ends are far from main.
- **What would settle it:** the 26 ids in `sample/webkit-host-unsettled.ids`, each alone in a fresh process (about 2 minutes of webkit-host time). I did not run it: the brief allowed two samples.
  - `bun rebuild/lab/sharded.ts --browser=webkit-host --cases=.artifacts/tests/runs/census-check-20260919/sample/webkit-host-cases.ndjson --ids-file=.artifacts/tests/runs/census-check-20260919/sample/webkit-host-unsettled.ids --isolate --out=<folder> -- --predictor=rebuild/lab/baselines/no-facts-predictor.ts`
- **Two smaller points on the set-aside.**
  - 28 of the 5,555 are set aside by the 09-17 list or the known tail alone. Today's reruns found 27 of them failing with the same native view in both orders, and 26 are main-only. With them kept, H2 is 148 of 177,319: 0.08%.
  - The set-aside is concentrated: `raw-context` loses 1,420 of 8,252 cases (17%), `physical-window-terminal-seam` 542 of 2,358 (23%), `signed-spacing/ascii-matrix` 315 of 1,536 (21%). Those family rows describe what is left.

### 5. Chrome: no page history, and main's own

Sample B: the same 6,000 case file in Chrome, fresh process, both orders (`sample/chrome/`, `sample/compare-chrome.txt`).

- 0 native views differ from the long documents', and 0 between the two orders. The rebuild's four statuses are the same in all three documents on all 6,000.
- Main's status differs on 14 cases, all between the reversed order and the other two (section 3).
- In the webkit-host sample, on the 5,738 cases with one native view, main's and the rebuild's statuses never differ between documents.

### 6. Smaller findings

- The census says "every scored run is ok". webkit-host `corpus04a` is scored from a run with status `error` (the stopped one), as its problems list says elsewhere.
- "About 62 control-character families fail exactly 2 cases each, 124 of 126": I count 61 `U+XXXX` families with exactly 2 wrong lines (122 cases) in `calibration.json`. Not material.
- The gap sets the document quotes for Chrome's 1,927 and Firefox's 564 wrong-lines cases come out the same from the owner's `tools/cover.ts` run again on the rerun rows.
- My check tools are 634 lines in six files. Nothing imports them. If the tree's size matters, they can stay on the branch as evidence and not merge; the orchestrator's call.

### 7. Not checked

- Firefox page history among passes (no sample; 0 of 564 failures in the census, and 0 in MAIN-TRIAGE's two orders).
- The rows of the giant-paragraph chunks (section 2).
- How main's own suite judged the same cases with its own observer. "Main passes" here is the lab scorer's line count, as MAIN-TRIAGE defines it.
- The owner's descriptions of the pass-to-fail shapes (section 6 of the census document), beyond their counts.
- The offline gates at the branch tip (9ca00b7). My `gates.ts --quick` never got a turn: exclusive timed jobs of other agents were queued back to back from 02:24 on, and the orchestrator's `quiet-window.py` holds the gates while they wait. I killed my queued run at 03:07. What I have instead: `bunx tsc --noEmit` exits 0 on each of the six gate projects at 9ca00b7. My commits add six files that nothing imports.

### 8. Files

- Tracked, `rebuild/tools/census/check/`: `recount.py` (every count again, the case set, 09-17 moves), `raw-check.ts` (records against rows), `sensitivity.py` (section 3), `by-width.py`, `sample.py` and `sample-run.sh` (section 4 and 5).
- My folder: `sensitivity.txt`, `by-width.txt`, `raw-check-*.log`, `suite-browsers.json` (which browsers' own suite rows hold each case; made by the scratch tool `suite-browsers.ts` beside it), `main-diff.py`, `sample/` (case file, rows, `compare-*.txt`, `webkit-host-unsettled.ids`).
- Progress log: `~/github/pretext-rebuild-wt/census/.progress-census-check.txt`.
- To run again, from the worktree's top folder: `python3 rebuild/tools/census/check/recount.py`; `python3 rebuild/tools/census/check/sensitivity.py`; `python3 rebuild/tools/census/check/by-width.py`; `bun rebuild/tools/census/check/raw-check.ts <browser> <chunk> [<case file>]`; `python3 rebuild/tools/census/check/sample.py compare <browser> .artifacts/tests/runs/census-check-20260919/sample`.

### 9. About this check's own runs

- Browser runs: the two samples only, each under one slot of the browser lock (not exclusive; nothing was timed). Logs `sample/webkit-host.log` and `sample/chrome.log`, both exit 0. Rows compressed.
- My offline work ran beside other agents' exclusive timed runs three times: 01:54 to 02:00 (the raw check, one process at nice 10, before I made it wait for the lock), 02:24:43 to 02:24:50 (`compress-rows.sh` on my 376 MB of rows, zstd with 3 threads), and about 02:56 to 03:00 (the raw check at background priority, `taskpolicy -b`). If a timed pair from those minutes looks odd, that is a candidate cause.
- At about 02:32 both of my background wrappers died with exit 144 at the same moment, and the waiting gates runs of other agents (pids 88249, 90438, 38316, 51567, and the turn's holder 47676) were gone from `ps` a minute later. I had just run one `pkill` for my own queued gates run, scoped to my user and to the children of my own wrapper shell (`-u`, `-P`), which should have matched that one process. I could not find the cause of the wider event.


## Calibration: main's whole suite and a real-text set on today's library (2026-09-19)

The maintainer's point: a pass rate only means something against the distribution of cases. This document runs main's whole wrapping suite through today's rebuild, beside main itself, and breaks the result down by suite family and by whether main passes. It adds a small set of real paragraphs.

- **Library:** `rebuild/src` at b2d9050, the headline configuration: no supplied font facts (`rebuild/lab/baselines/no-facts-predictor.ts`). One bundle for every suite run (sha256 262b202ce19e…).
- **Main:** the published library, `src/` of this branch. It is byte-equal to `~/github/pretext/src` today. It ran through `rebuild/lab/baselines/main-predictor.ts` (bundle e174da63c3a8…).
- **Browsers:** pinned Chrome 153.0.8010.50, pinned Firefox 156.0, webkit-host on WebKit 22625.1.29.11.27. All at DPR 2, in background windows, scorer 7.
- **Cases:** the census's 238,524 cases of 2026-09-17 in its own 23 chunks, in file order with its round-trip sizes, so every case meets the document history it met then.

Everything is under `~/github/pretext-rebuild/.artifacts/census-20260919/`. The tools are in `rebuild/tools/census/` on branch `x-census`.

### 1. The answer first

| | Chrome | Firefox | webkit-host (page-history cases set aside) | webkit-host (as observed in the long documents) |
|---|---:|---:|---:|---:|
| cases scored | 238,518 | 238,412 | 232,814 | 238,369 |
| main, line count | 73.85% | 80.15% | 76.15% | 75.91% |
| rebuild, line count | 99.45% | 99.89% | 99.89% | 98.77% |
| rebuild, breaks | 99.19% | 99.76% | 99.79% | 97.46% |
| rebuild, widths | 98.28% | 96.28% | 98.34% | 96.01% |
| **of the cases main gets wrong, the rebuild gets right** | **98.33%** (61,337 of 62,377) | **99.71%** (47,180 of 47,319) | **99.76%** (55,386 of 55,521) | 96.83% (55,614 of 57,434) |
| **of the cases main gets right, the rebuild gets wrong** | **0.16%** (280 of 176,141) | **0.06%** (116 of 191,093) | **0.07%** (122 of 177,293) | 0.62% (1,120 of 180,935) |
| the same, counting wrong breaks too | 0.38% (671) | 0.12% (227) | 0.20% (347) | — |
| of those, under a covering gap | 668 of 671 | 227 of 227 | 347 of 347 | — |
| every family counting once: main / rebuild line count | 69.68% / 99.45% | 80.78% / 99.86% | 71.67% / 99.86% | — |

- **By difficulty.** The rebuild's line-count pass rate in the half main passes and in the half main fails:
  - Chrome: 99.84% and 98.33%.
  - Firefox: 99.94% and 99.71%.
  - webkit-host: 99.93% and 99.76%.
  - The rebuild is nearly as good on the cases main gets wrong as on the ones it gets right. Easy cases don't carry its pass rate. Section 4 has breaks and widths per half.
- **Real paragraphs** (4,686 cases a browser, section 7):
  - The rebuild has 0 wrong lines in all three browsers. It fails 1 width in Chrome.
  - Main's line count passes 4,684, 4,684 and 4,686 of 4,686.
  - Where main's count is right, its visible breaks are wrong on 5 (Chrome), 56 (Firefox) and 7 (webkit-host) cases.
  - On real prose main is already at 99.96% by line count. The suite's 20–26% main failure rate is what its adversarial families produce, not what an application's text sees.
- **webkit-host page history is much larger than known.**
  - 5,527 of the rebuild's 6,043 wrong-lines cases lay out differently in a short fresh document than in the census's 19,784-case documents.
  - In fresh documents the rebuild has the right lines in both orders on 4,368 of them, in one order on 1,159 and in neither on 0.
  - 516 failures are stable. Chrome and Firefox have no such case: 0 of 1,927 and 0 of 564.
- **Since 2026-09-17** (section 6), rebuild line count on the same cases:
  - Chrome 98.68% → 99.45%. Firefox 99.63% → 99.89%. webkit-host 99.73% → 99.89%.
  - That day's library carried font facts and today's run supplies none.

### 2. How it was run

- **Per chunk, under one hold of a browser lock slot** (`rebuild/tools/census/run-chunk.sh`), three lanes a browser (`lanes.sh`):
  1. `run.ts` with the no-facts predictor. This gives native observation and the rebuild's prediction in one page.
  2. `run.ts --predict-only` with main's predictor over the same case file.
  3. `census.ts chunk`, then the rows are compressed.
- **One record per case** (`<browser>/<chunk>/cases.ndjson`), written by `census.ts`:
  - the lab scorer's statuses for the rebuild (`scoreRow`);
  - the scorer's `lineGaps[metric].covered` for each failing metric;
  - main's line-count status, scored against the same native observation (`withNativeRow`), and its visible-breaks diagnostic;
  - the native line count and a hash of the native view (every code point and node rect's x, width and native line).
  - Every table is counted from these records by `tables.ts`.
- **Reruns** (`census.ts rerun-cases`; chunks `rerun-file` and `rerun-reverse`):
  - Every suite case of at most 1,000 units where the rebuild fails lineCount or breaks ran again in one short fresh document per page context, in file order and reversed. The rebuild and main both ran.
  - Chrome 1,927 cases, Firefox 564, webkit-host 6,043.
  - A case whose native view in either rerun differs from the long document's is page history. It is set aside and counted apart.
  - webkit-host's set-aside also holds the 1,340 cases the 09-17 census found (`history/webkit-host/history.json`) and the known tail's `webkit/page-history` cases. The total is 5,555.
- **2026-09-17:**
  - That day's statuses come from its `census-transitions.ndjson`.
  - That day's native views were computed from its rows with today's scorer (`census.ts then`), and work on the old rows.
- **Cases that passed then and fail now** ran once more with `rebuild/lab/predictor.ts`, which has the lab's font facts. This is chunk `facts-pass-to-fail`.
- **Checks** (`tools/verify.py`):
  - Every scored run is `ok`, under one environment at DPR 2, one build a browser, one bundle a predictor.
  - No native, prediction, painter or adapter errors.
  - Main's adapter expresses every case.
- **Run times.** They were taken under a load average of 45 to 115 from other agents' gates, so they say nothing about speed.

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| lanes, wall clock | 21:28–22:47 | 21:28–21:59 | 21:28–00:46 |
| summed native + rebuild run time | 116 min | 23 min | 416 min |
| summed main run time | 3.4 min | 3.3 min | 5.9 min |

  - webkit-host's time is native Range geometry on the long paragraphs. In corpus05, native observation took 835 s and the rebuild's prediction 4 s.

### 3. How every column is computed

All counts are over one browser's records.

- **cases:** records of the family.
  - Today no case has an unobserved line count in any browser. So every case is compared for both predictors, and the tables below leave out the "observed" column. `tables-full.txt` keeps it.
- **main:** main's line count equals the native count. This is `research/MAIN-TRIAGE.md`'s definition.
  - The number in brackets is the cases not passing.
- **rebuild lineCount / breaks / widths:** the scorer's `pass`, over the cases where that metric isn't `unobserved`.
  - `fail` and `not-applicable` both count as not passing. Widths are not-applicable after failed breaks.
  - So Chrome's 4,000 non-passing widths are 2,073 failed widths plus 1,927 cases whose breaks failed.
  - Widths are unobserved on 6,507 Chrome and 4,212 webkit-host cases, and on none in Firefox.
- **main fails, rebuild passes** and **main passes, rebuild fails:** by line count.
  - **covered:** the scorer says every failing line of the rebuild's failure has a gap that covers it (`score.ts` "Covered failures").
- **wrong lines:** the rebuild fails lineCount or breaks.
  - Families sort by this, then by failed widths.
  - Covered means every failing metric of the two is covered.
- **right count, wrong breaks:** main's line count passes and its visible-breaks diagnostic fails.
  - Main's breaks can't be a metric: it returns line ranges only.
- **every family counting once:** the mean of the families' pass rates, whatever their sizes.

### 4. The tables

Each table shows the 25 worst families. `tables-full.txt` in the output folder holds every family of every browser as ready Markdown: 386, 381 and 384 rows. `calibration.json` holds every count.

#### Chrome: 238,518 cases

| half | cases | rebuild lineCount | rebuild breaks | rebuild widths |
|---|---:|---:|---:|---:|
| main passes | 176,141 | 99.84% (280) | 99.62% (671) | 98.71% (2,210) |
| main fails | 62,377 | 98.33% (1,040) | 97.99% (1,256) | 97.02% (1,790) |

| family | cases | main | rebuild lineCount | rebuild breaks | rebuild widths | main fails, rebuild passes | main passes, rebuild fails (covered) | wrong lines (covered) | right count, wrong breaks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `joined` | 4594 | 49.91% (2301) | 95.43% (210) | 88.18% (543) | 87.57% (543) | 2166 | 75 (72) | 543 (540) | 597 |
| `following-space-scope` | 21602 | 72.51% (5938) | 99.26% (160) | 99.26% (160) | 95.36% (990) | 5818 | 40 (40) | 160 (160) | 468 |
| `U+FFFC/middle` | 256 | 33.59% (170) | 56.25% (112) | 51.56% (124) | 0.00% (256) | 86 | 28 (28) | 124 (124) | 40 |
| `mixed` | 7794 | 75.43% (1915) | 99.23% (60) | 98.52% (115) | 98.21% (137) | 1867 | 12 (12) | 115 (115) | 731 |
| `ligature-thresholds-v3` | 5611 | 95.53% (251) | 99.14% (48) | 98.22% (100) | 98.22% (100) | 211 | 8 (8) | 100 (100) | 491 |
| `space` | 5126 | 49.22% (2603) | 98.95% (54) | 98.11% (97) | 97.85% (108) | 2568 | 19 (19) | 97 (97) | 554 |
| `unicode-space` | 1142 | 75.66% (278) | 92.12% (90) | 92.12% (90) | 83.19% (192) | 188 | 0 (0) | 90 (90) | 8 |
| `U+FFFC/end` | 228 | 30.70% (158) | 63.16% (84) | 63.16% (84) | 0.00% (228) | 88 | 14 (14) | 84 (84) | 12 |
| `U+FFFC/start` | 228 | 29.82% (160) | 64.91% (80) | 64.91% (80) | 0.00% (228) | 96 | 16 (16) | 80 (80) | 6 |
| `joined-plain` | 1080 | 59.44% (438) | 99.17% (9) | 93.06% (75) | 93.06% (75) | 429 | 0 (0) | 75 (75) | 211 |
| `latin` | 576 | 36.81% (364) | 90.63% (54) | 90.63% (54) | 90.63% (54) | 314 | 4 (4) | 54 (54) | 8 |
| `following-space-context` | 8746 | 79.83% (1764) | 99.45% (48) | 99.45% (48) | 96.76% (282) | 1728 | 12 (12) | 48 (48) | 30 |
| `accepted-r` | 2256 | 58.95% (926) | 97.96% (46) | 97.96% (46) | 97.80% (46) | 886 | 6 (6) | 46 (46) | 96 |
| `word` | 3840 | 96.09% (150) | 99.30% (27) | 99.04% (37) | 99.04% (37) | 124 | 1 (1) | 37 (37) | 62 |
| `raw-context` | 8252 | 68.89% (2567) | 99.73% (22) | 99.71% (24) | 99.71% (24) | 2563 | 18 (18) | 24 (24) | 1282 |
| `cluster-v2-new` | 3126 | 78.69% (666) | 99.62% (12) | 99.42% (18) | 99.42% (18) | 654 | 0 (0) | 18 (18) | 34 |
| `barrier` | 1016 | 37.01% (640) | 98.82% (12) | 98.43% (16) | 98.18% (16) | 628 | 0 (0) | 16 (16) | 65 |
| `cross-item` | 1242 | 77.13% (284) | 99.60% (5) | 98.71% (16) | 98.71% (16) | 282 | 3 (3) | 16 (16) | 92 |
| `measurement` | 4740 | 81.62% (871) | 99.66% (16) | 99.66% (16) | 99.66% (16) | 855 | 0 (0) | 16 (16) | 74 |
| `cluster-v1` | 4569 | 82.21% (813) | 99.82% (8) | 99.69% (14) | 99.69% (14) | 805 | 0 (0) | 14 (14) | 70 |
| `source-shaped-arabic` | 348 | 57.47% (148) | 96.55% (12) | 95.98% (14) | 95.98% (14) | 146 | 10 (10) | 14 (14) | 122 |
| `ideographic-source-edge` | 496 | 56.45% (216) | 98.39% (8) | 98.39% (8) | 98.39% (8) | 210 | 2 (2) | 8 (8) | 88 |
| `script-prefix-heldout` | 2274 | 89.18% (246) | 99.78% (5) | 99.69% (7) | 99.43% (13) | 241 | 0 (0) | 7 (7) | 118 |
| `resumed-zero-tail` | 952 | 62.61% (356) | 99.58% (4) | 99.37% (6) | 99.37% (6) | 354 | 2 (2) | 6 (6) | 8 |
| `U+200D/middle` | 196 | 36.73% (124) | 97.96% (4) | 97.96% (4) | 97.53% (4) | 120 | 0 (0) | 4 (4) | 2 |
| the other 361 families (at most 2 wrong lines each) | 148228 | 74.34% (38030) | 99.91% (130) | 99.91% (131) | 99.60% (575) | 37910 | 10 (10) | 131 (131) | 8957 |
| **all** | 238518 | 73.85% (62377) | 99.45% (1320) | 99.19% (1927) | 98.28% (4000) | 61337 | 280 (277) | 1927 (1924) | 14226 |

- **The "other 361 families" are mostly one paragraph.**
  - About 62 control-character families fail exactly 2 cases each.
  - All are beh, soft hyphen, beh plus the control, in Amiri 16px at width 3px, `pre-wrap`, ltr and rtl. That is 124 of the 126 such failures.
  - They failed on 09-17 too. Gaps named: glyph-clusters and unsafe-to-break.
- **Gaps that cover Chrome's 1,927 wrong-lines cases** (from the rerun rows, `tools/cover.ts`):
  - glyph-clusters + unsafe-to-break 1,112; font-fallback + script-context 330; unsafe-to-break 163; glyph-clusters 161; in-word-prefix + unsafe-to-break 38.
  - 3 cases are uncovered, all in `joined`.
- **The 671 cases main passes and the rebuild gets wrong** are listed in `main-only/chrome.ndjson`.

#### Firefox: 238,412 cases

| half | cases | rebuild lineCount | rebuild breaks | rebuild widths |
|---|---:|---:|---:|---:|
| main passes | 191,093 | 99.94% (116) | 99.88% (227) | 97.37% (5,033) |
| main fails | 47,319 | 99.71% (139) | 99.29% (337) | 91.87% (3,846) |

| family | cases | main | rebuild lineCount | rebuild breaks | rebuild widths | main fails, rebuild passes | main passes, rebuild fails (covered) | wrong lines (covered) | right count, wrong breaks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `joined` | 4594 | 60.12% (1832) | 98.59% (65) | 96.87% (144) | 78.32% (996) | 1796 | 29 (29) | 144 (144) | 586 |
| `raw-context` | 8252 | 56.13% (3620) | 99.68% (26) | 98.89% (92) | 76.45% (1943) | 3616 | 22 (22) | 92 (92) | 1091 |
| `mixed` | 7794 | 76.94% (1797) | 99.64% (28) | 99.23% (60) | 90.09% (772) | 1785 | 16 (16) | 60 (60) | 648 |
| `space` | 5126 | 72.75% (1397) | 99.41% (30) | 99.06% (48) | 92.37% (391) | 1374 | 7 (7) | 48 (48) | 305 |
| `following-space-scope` | 21602 | 75.59% (5272) | 100.00% (0) | 99.78% (48) | 99.56% (96) | 5272 | 0 (0) | 48 (48) | 108 |
| `joined-plain` | 1080 | 60.56% (426) | 98.89% (12) | 97.50% (27) | 84.72% (165) | 420 | 6 (6) | 27 (27) | 232 |
| `hidden-control-spacing` | 4595 | 65.55% (1583) | 100.00% (0) | 99.56% (20) | 92.62% (339) | 1583 | 0 (0) | 20 (20) | 198 |
| `chromium-script-spacing` | 8233 | 93.49% (536) | 99.87% (11) | 99.82% (15) | 98.54% (120) | 532 | 7 (7) | 15 (15) | 148 |
| `following-space-context` | 8746 | 70.84% (2550) | 100.00% (0) | 99.86% (12) | 97.94% (180) | 2550 | 0 (0) | 12 (12) | 24 |
| `original-vs-reshaped-admission` | 42 | 35.71% (27) | 73.81% (11) | 73.81% (11) | 47.62% (22) | 17 | 1 (1) | 11 (11) | 12 |
| `source-shaped-arabic` | 348 | 51.15% (170) | 98.28% (6) | 97.41% (9) | 89.66% (36) | 166 | 2 (2) | 9 (9) | 109 |
| `cluster-v2-new` | 3126 | 84.13% (496) | 99.87% (4) | 99.74% (8) | 98.59% (44) | 492 | 0 (0) | 8 (8) | 84 |
| `ligature-thresholds-v3` | 5611 | 93.55% (362) | 99.93% (4) | 99.93% (4) | 95.47% (254) | 361 | 3 (3) | 4 (4) | 819 |
| `joined-mark` | 648 | 35.65% (417) | 100.00% (0) | 99.38% (4) | 89.81% (66) | 417 | 0 (0) | 4 (4) | 163 |
| `word` | 3840 | 95.73% (164) | 99.97% (1) | 99.95% (2) | 96.48% (135) | 163 | 0 (0) | 2 (2) | 105 |
| `glue` | 256 | 92.19% (20) | 100.00% (0) | 99.22% (2) | 77.34% (58) | 20 | 0 (0) | 2 (2) | 2 |
| `control` | 2684 | 83.46% (444) | 99.93% (2) | 99.93% (2) | 98.06% (52) | 442 | 0 (0) | 2 (2) | 61 |
| `U+001C/middle` | 448 | 62.50% (168) | 99.55% (2) | 99.55% (2) | 91.52% (38) | 166 | 0 (0) | 2 (2) | 62 |
| `U+001D/middle` | 448 | 62.50% (168) | 99.55% (2) | 99.55% (2) | 91.52% (38) | 166 | 0 (0) | 2 (2) | 62 |
| `U+001E/middle` | 448 | 62.50% (168) | 99.55% (2) | 99.55% (2) | 91.52% (38) | 166 | 0 (0) | 2 (2) | 62 |
| `U+001F/middle` | 448 | 62.50% (168) | 99.55% (2) | 99.55% (2) | 91.52% (38) | 166 | 0 (0) | 2 (2) | 62 |
| `U+000B/middle` | 448 | 58.93% (184) | 99.55% (2) | 99.55% (2) | 94.20% (26) | 182 | 0 (0) | 2 (2) | 0 |
| `U+000C/middle` | 448 | 43.75% (252) | 99.55% (2) | 99.55% (2) | 94.20% (26) | 252 | 2 (2) | 2 (2) | 0 |
| `U+000D/middle` | 448 | 43.75% (252) | 99.55% (2) | 99.55% (2) | 94.20% (26) | 252 | 2 (2) | 2 (2) | 0 |
| `U+0085/middle` | 448 | 58.93% (184) | 99.55% (2) | 99.55% (2) | 94.20% (26) | 182 | 0 (0) | 2 (2) | 0 |
| the other 356 families (at most 2 wrong lines each) | 148251 | 83.36% (24662) | 99.97% (39) | 99.97% (40) | 98.01% (2954) | 24642 | 19 (19) | 40 (40) | 7339 |
| **all** | 238412 | 80.15% (47319) | 99.89% (255) | 99.76% (564) | 96.28% (8879) | 47180 | 116 (116) | 564 (564) | 12282 |

- **"Covered" says little in Firefox without facts.**
  - `optical-size` takes part in covering all 564 wrong-lines cases: in-word-prefix + optical-size 538, with font-fallback 23, optical-size alone 3.
  - The 3 that rest on it alone are a combining mark after a TAB or an LF. Examples: `a`, TAB, U+0301, `b` in Georgia 16px at letter-spacing −2, width 25, `pre-wrap`; and `a`, LF, U+0301, `b` at width 10. These are `c-00a9956671bc2a85` and `c-cd4572b2d1058228`.
  - With the lab's facts those 3 name no gap at all. They passed on 09-17.
- **Firefox's widths are its weak metric here.** 8,315 widths fail, led by `raw-context` and `joined`.

#### webkit-host: 238,369 cases scored, 5,555 set aside as page history

| half | cases | rebuild lineCount | rebuild breaks | rebuild widths |
|---|---:|---:|---:|---:|
| main passes | 177,293 | 99.93% (122) | 99.80% (347) | 98.35% (2,887) |
| main fails | 55,521 | 99.76% (135) | 99.74% (142) | 98.29% (911) |

| family | cases | main | rebuild lineCount | rebuild breaks | rebuild widths | main fails, rebuild passes | main passes, rebuild fails (covered) | wrong lines (covered) | right count, wrong breaks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ligature-thresholds-v3` | 5611 | 95.13% (273) | 98.63% (77) | 95.78% (237) | 82.53% (980) | 273 | 77 (77) | 237 (237) | 315 |
| `raw-context` | 6832 | 70.04% (2047) | 99.17% (57) | 98.76% (85) | 87.47% (827) | 1990 | 0 (0) | 85 (85) | 560 |
| `mixed` | 7462 | 82.95% (1272) | 99.52% (36) | 99.21% (59) | 96.63% (245) | 1243 | 7 (7) | 59 (59) | 356 |
| `joined` | 4594 | 75.71% (1116) | 98.78% (56) | 98.78% (56) | 96.82% (133) | 1076 | 16 (16) | 56 (56) | 238 |
| `cluster-v2-new` | 3126 | 71.43% (893) | 99.52% (15) | 99.30% (22) | 98.51% (46) | 893 | 15 (15) | 22 (22) | 115 |
| `word` | 3840 | 96.93% (118) | 99.90% (4) | 99.69% (12) | 97.50% (96) | 118 | 4 (4) | 12 (12) | 56 |
| `hidden-control-spacing` | 4423 | 72.58% (1213) | 99.86% (6) | 99.86% (6) | 97.40% (113) | 1207 | 0 (0) | 6 (6) | 201 |
| `space` | 5048 | 60.76% (1981) | 99.96% (2) | 99.92% (4) | 97.99% (100) | 1981 | 2 (2) | 4 (4) | 224 |
| `spacing-hanging-IDEOGRAPHIC` | 849 | 89.75% (87) | 99.88% (1) | 99.65% (3) | 98.11% (16) | 86 | 0 (0) | 3 (3) | 16 |
| `spacing-hanging-EN` | 852 | 84.98% (128) | 99.88% (1) | 99.65% (3) | 99.17% (7) | 127 | 0 (0) | 3 (3) | 20 |
| `resumed-zero-tail` | 952 | 59.14% (389) | 99.89% (1) | 99.89% (1) | 98.30% (16) | 388 | 0 (0) | 1 (1) | 4 |
| `source-views/long-tail-edge-falsifier` | 2 | 100.00% (0) | 50.00% (1) | 50.00% (1) | 50.00% (1) | 0 | 1 (1) | 1 (1) | 0 |
| `following-space-scope` | 21213 | 66.21% (7168) | 100.00% (0) | 100.00% (0) | 97.78% (452) | 7168 | 0 (0) | 0 (0) | 272 |
| `maintained/kinsoku-units` | 10435 | 85.21% (1543) | 100.00% (0) | 100.00% (0) | 99.27% (76) | 1543 | 0 (0) | 0 (0) | 95 |
| `U+001C/middle` | 359 | 45.13% (197) | 100.00% (0) | 100.00% (0) | 80.11% (71) | 197 | 0 (0) | 0 (0) | 36 |
| `U+001E/middle` | 365 | 45.75% (198) | 100.00% (0) | 100.00% (0) | 80.72% (70) | 198 | 0 (0) | 0 (0) | 41 |
| `U+001F/middle` | 360 | 45.00% (198) | 100.00% (0) | 100.00% (0) | 81.01% (68) | 198 | 0 (0) | 0 (0) | 36 |
| `U+001D/middle` | 358 | 45.53% (195) | 100.00% (0) | 100.00% (0) | 81.18% (67) | 195 | 0 (0) | 0 (0) | 37 |
| `maintained/closing-punctuation` | 9702 | 95.65% (422) | 100.00% (0) | 100.00% (0) | 99.46% (52) | 422 | 0 (0) | 0 (0) | 370 |
| `physical-window-terminal-seam` | 1816 | 90.20% (178) | 100.00% (0) | 100.00% (0) | 97.43% (45) | 178 | 0 (0) | 0 (0) | 80 |
| `cluster-v1` | 4569 | 82.67% (792) | 100.00% (0) | 100.00% (0) | 99.02% (44) | 792 | 0 (0) | 0 (0) | 70 |
| `following-space-context` | 8736 | 71.36% (2502) | 100.00% (0) | 100.00% (0) | 99.49% (41) | 2502 | 0 (0) | 0 (0) | 6 |
| `U+000B/middle` | 388 | 35.31% (251) | 100.00% (0) | 100.00% (0) | 90.41% (37) | 251 | 0 (0) | 0 (0) | 15 |
| `U+0085/middle` | 420 | 67.62% (136) | 100.00% (0) | 100.00% (0) | 92.82% (30) | 136 | 0 (0) | 0 (0) | 0 |
| `rejected-control` | 340 | 90.00% (34) | 100.00% (0) | 100.00% (0) | 92.65% (25) | 34 | 0 (0) | 0 (0) | 32 |
| the other 359 families (no wrong lines) | 130162 | 75.27% (32190) | 100.00% (0) | 100.00% (0) | 99.89% (140) | 32190 | 0 (0) | 0 (0) | 4804 |
| **all** | 232814 | 76.15% (55521) | 99.89% (257) | 99.79% (489) | 98.34% (3798) | 55386 | 122 (122) | 489 (489) | 7999 |
| set aside (page history) | 5555 | 65.56% (1913) | 51.70% (2683) | 0.02% (5554) | 0.00% (5555) | 228 | 998 (998) | 5554 (5554) | 2344 |
| suite with them | 238369 | 75.91% (57434) | 98.77% (2940) | 97.46% (6043) | 96.01% (9353) | 55614 | 1120 (1120) | 6043 (6043) | 10343 |

- **Only 12 families have a stable wrong line. `ligature-thresholds-v3` holds half of them.**
  - Gaps named on the 347 cases main passes and the rebuild gets wrong: letter-spacing-ligatures 303, page-history 47, control-character-width 5, string-storage 2, simplified-measuring 1.
  - This is the known letter-spacing ligature class of `MAIN-PASSES-REFRESH.md`.
- **Long paragraphs (`maintained/corpus`, over 1,000 units):**
  - The rebuild passes lineCount and breaks on all 1,098 in Chrome, all 1,098 in Firefox and all 1,030 scored in webkit-host.
  - Main's line count passes 98.0%, 80.0% and 99.4% there.

### 5. Page history (the reruns)

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| rebuild wrong-lines cases run again, both orders | 1,927 | 564 | 6,043 |
| native view differs in a fresh document (page history) | 0 | 0 | 5,527 |
| … rebuild right in both orders / in one / in neither | — | — | 4,368 / 1,159 / 0 |
| … main's line count passes in both / in one / in neither | — | — | 3,587 / 489 / 1,451 |
| same native view: rebuild wrong in both reruns | 1,927 | 564 | 516 |
| … of them main passes and the rebuild fails line count, in the long document / in both reruns | 280 / 278 | 116 / 116 | 148 / 148 |

- **webkit-host.**
  - 972 of the 1,120 "main passes, rebuild fails" cases of the long documents are page history. Not one of them is main-only in both fresh orders.
  - The mechanism is the known process-wide break cache: `webkit/page-history` in the known tail, and `MAIN-PASSES-REFRESH.md`.
  - The 1,159 cases that are right in one order only share the rerun document with their twin (the same text, other direction). That is the same collision, inside the rerun.
  - The isolation protocol (`sharded.ts --isolate`) would settle each one alone. It wasn't run; about 6 minutes of webkit-host time.

### 6. 2026-09-17 against today, on the same cases

The rebuild's pass rates over the cases observed on both days. webkit-host is without the set-aside.

| | Chrome then → now | Firefox then → now | webkit-host then → now |
|---|---|---|---|
| lineCount | 98.68% → 99.45% (1,889 fail→pass, 66 pass→fail) | 99.63% → 99.89% (629, 5) | 99.73% → 99.89% (416, 39) |
| breaks | 97.89% → 99.16% (2,858, 43) | 99.14% → 99.75% (1,441, 67) | 99.56% → 99.79% (548, 37) |
| widths | 82.47% → 97.97% (30,247, 253) | 86.29% → 95.51% (18,246, 30) | 88.26% → 97.78% (15,860, 32) |
| main lineCount | 73.86% → 73.86% (0, 0) | 80.16% → 80.18% (43, 0) | 76.32% → 76.32% (0, 0) |
| native views that differ / compared | 0 / 238,518 | 1,860 / 238,412 (54 in line count; 1,723 in `measurement`) | 3 / 232,284 |

- **Not the same configuration.**
  - The 09-17 library carried the lab's font facts (`research/FACTS-FREE.md`). Today's run supplies none, which costs Chrome 1.3 points of line count on the tier sets.
  - So "now" is the harder configuration and still ahead.
  - The scorer also moved from the census's to version 7. Line count is comparable. Breaks and widths moves mix scorer changes with library changes.
- **Pass → fail, line count or breaks, run again today with the lab's facts:**
  - **Chrome:** 6 of 69 pass, so 63 are real moves since 09-17. All are covered by a gap, and all are at widths of 0 to 57px. By shape:
    - 24 are `a  aabb((بب` and its CR LF twin, in Amiri 24px at width 12, rtl (`raw-context`).
    - 16 are beh-kasra, soft hyphen, kasra-beh at widths 0 to 3, in Amiri and Noto Nastaliq Urdu (`accepted-r`).
    - About 14 are `ب` SHY kasra `ب((word` and neighbours (`mixed`).
    - 8 are `a` U+0600 U+3000 `b` (`ideographic-source-edge`).
    - The rest are `script-prefix-heldout` and one `partial-source-context`.
    - The ids are in `rerun/chrome-pass-to-fail.ids`; `tools/detail.ts` prints them.
  - **Firefox:** 60 of 67 pass with facts. They are `following-space-scope` and `following-space-context` breaks under in-word-prefix, so they belong to the configuration. 7 don't pass: the 3 combining-mark cases above, and 4 Amiri soft-hyphen cases under in-word-prefix.
  - **webkit-host:** 0 of 53 pass with facts. 30 line-count moves are `ligature-thresholds-v3`, 3 `mixed`, 3 `word`. Not looked at further.
- **Line-count moves by family:** in `tables.txt`, per browser.

### 7. Real paragraphs

`rebuild/tools/census/real-text.ts` cuts main's 18 long-form corpora (`corpora/*.txt`) at their own line ends.

- It keeps paragraphs of at least 40 UTF-16 units and takes up to 60 a corpus, evenly through the text: 781 paragraphs.
- Each runs at 240, 320, 400, 480, 600 and 720px, styled the way main's canaries style that corpus (`corpora/sources.json`: font stack, size, line height, language, direction).
- `white-space: normal`, no letter spacing, one text node. 4,686 cases a browser, run and scored like a chunk (`<browser>/real-text/`).
- `mixed-app-text` is main's synthetic stress text, not prose.

Each cell: main's failed line counts / main's right counts with wrong visible breaks / the rebuild's wrong lines / the rebuild's failed widths.

| corpus | cases | chrome | firefox | webkit-host |
|---|---:|---|---|---|
| `ar-al-bukhala` | 360 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ar-risalat-al-ghufran-part-1` | 360 | 0 / 0 / 0 / 1 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `en-gatsby-opening` | 360 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `he-masaot-binyamin-metudela` | 360 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `hi-eidgah` | 360 | 0 / 0 / 0 / 0 | 0 / 5 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ja-kumo-no-ito` | 84 | 0 / 1 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ja-rashomon` | 168 | 2 / 1 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `km-prachum-reuang-preng-khmer-volume-7-stories-1-10` | 216 | 0 / 0 / 0 / 0 | 0 / 4 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ko-sonagi` | 360 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ko-unsu-joh-eun-nal` | 360 | 0 / 1 / 0 / 0 | 0 / 7 / 0 / 0 | 0 / 0 / 0 / 0 |
| `mixed-app-text` | 30 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `my-bad-deeds-return-to-you-teacher` | 30 | 0 / 0 / 0 / 0 | 0 / 5 / 0 / 0 | 0 / 1 / 0 / 0 |
| `my-cunning-heron-teacher` | 42 | 0 / 0 / 0 / 0 | 2 / 19 / 0 / 0 | 0 / 4 / 0 / 0 |
| `th-nithan-vetal-story-1` | 360 | 0 / 0 / 0 / 0 | 0 / 6 / 0 / 0 | 0 / 0 / 0 / 0 |
| `th-nithan-vetal-story-7` | 360 | 0 / 0 / 0 / 0 | 0 / 7 / 0 / 0 | 0 / 0 / 0 / 0 |
| `ur-chughd` | 186 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `zh-guxiang` | 330 | 0 / 1 / 0 / 0 | 0 / 2 / 0 / 0 | 0 / 1 / 0 / 0 |
| `zh-zhufu` | 360 | 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 | 0 / 1 / 0 / 0 |
| **all** | 4686 | 2 / 5 / 0 / 1 | 2 / 56 / 0 / 0 | 0 / 7 / 0 / 0 |

- **Same columns as the suite, totals:**
  - Chrome: main 99.96%; the rebuild lineCount 100%, breaks 100%, widths 99.98% (1). Main fails and the rebuild passes 2. Main passes and the rebuild fails 0.
  - Firefox: main 99.96%; the rebuild 100% / 100% / 100%. 2 and 0.
  - webkit-host: main 100%; the rebuild 100% / 100% / 100% (widths observed on 4,528). 0 and 0.
- **Where they differ on real text is breaks, not counts.**
  - In Firefox main puts a visible character on another line than the browser in 56 of 4,684 right counts (1.2%). Most are Burmese, Thai, Khmer, Hindi and Korean.
  - The rebuild's breaks pass on all 4,686.

### 8. What the table can't say

- **How often an application's text goes wrong.**
  - The suite is generated to be hard: widths of 0 to 60px, Amiri with soft hyphens, controls, signed letter spacing. Family sizes come from generators, not from how often such text occurs.
  - The real-text set is the better proxy, and it is small: 781 paragraphs, one font stack a corpus, macOS system fonts, no rich inline content, no letter spacing, no `pre-wrap`.
  - At 4,686 cases a failure rate under about 0.06% shows as 0 to 3 cases.
- **That a covered failure is fine.**
  - "Covered" means the library said it might be wrong at that place.
  - In Firefox without facts `optical-size` covers every failure, so there the column says nothing.
- **Main's breaks and widths.**
  - Main returns line ranges only, so the scorer gives it a line count and a visible-breaks diagnostic.
  - The rebuild's breaks metric is stricter than that diagnostic. The two "breaks" columns aren't the same test.
- **Passes that depend on history.**
  - Only the rebuild's wrong lines were run again. A pass of the rebuild's, or a pass or failure of main's, that depends on the long document's history isn't found.
  - In webkit-host that is likely not small, given 5,527 of 6,043 failures.
  - The set-aside therefore removes known bad luck from the rebuild's side only. Both webkit-host columns are given in section 1 for that reason.
- **Other machines.**
  - One Mac (macOS build 26A428), its fonts, DPR 2, browser process languages zh-Hans-US and en-US, background windows.
  - The headline configuration only. With the lab's facts Chrome would read higher.
- **88 webkit-host cases.**
  - They are 88 of the 1,118 long paragraphs: corpus04's last 16, all 18 of corpus06 and all 54 of corpus07.
  - For 32 of them native rows exist and wait unscored in `corpus06a` and `corpus07a`.
  - See the problems list.
- **Speed.** Every run shared the machine with other agents' gates.

### 9. Files

Under `~/github/pretext-rebuild/.artifacts/census-20260919/`:

- `tables.txt` (top 25 a browser), `tables-full.txt` (every family, every corpus), `calibration.json` (every count; `fields` names them).
  - To regenerate: `bun rebuild/tools/census/tables.ts --top=25`.
- `<browser>/<chunk>/`:
  - `rebuild/` and `main/` hold the rows (`.zst`), `run.json` and `run.log`.
  - `cases.ndjson` holds the per-case records; `then.ndjson` holds the 09-17 native views.
  - Chunks: `chunk00`–`11`, `corpus00`–`10`, `real-text`, `rerun-file`, `rerun-reverse`, `facts-pass-to-fail`.
  - webkit-host also has `corpus04a`, `corpus06a` and `corpus07a`: the rows that stalled or stopped runs wrote.
  - `chrome/chunk07/main-dpr-flip-2240` keeps a failed attempt.
- `main-only/<browser>.ndjson`: the cases main passes and the rebuild gets wrong (671, 227, 347 records).
- `rerun/`: case files and `<browser>-pass-to-fail.ids`.
- `real-text/cases.ndjson`. `cases/`: the partial case files.
- `tools/`: `verify.py`, `cover.ts`, `detail.ts`, `timings.ts`, `after-lanes.sh`, `salvage.sh`. Untracked.
- Logs: `lanes*.log`, `gates/`.
- Tracked tools, in `rebuild/tools/census/` (686 lines): `run-chunk.sh`, `lanes.sh`, `census.ts`, `tables.ts`, `real-text.ts`, `then.sh`, `score-missing.sh`.
- The progress log is `~/github/pretext-rebuild-wt/census/.progress-census.txt`.
