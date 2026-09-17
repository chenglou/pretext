# Full-suite census: the rebuild against main on all 238,524 imported cases

The census covers every case of the old wrapping suite, imported with `rebuild/lab/cases/generate.ts suite` and no sampling. Each case ran in Chrome 153.0.8010.48, Firefox 156.0 and webkit-host, the WKWebView host on WebKit 22625.1.29.11.27, which is Safari 27.0's build. All three ran at DPR 2.

Each browser observed native layout once per case, together with the rebuild's prediction. The same browser then ran main's prediction alone over the same chunks. Both predictors are scored against the same native observation with the scorer's own rules.

Every case where main passes line count or breaks and the rebuild doesn't was run again in fresh browser sessions, in reverse and in file order, to find cases whose native layout depends on page history.

## 1. Results

Each cell reads both pass / rebuild only / main only / both fail / unobserved:

| browser | cases | lineCount | breaks | widths |
|---|---:|---|---|---|
| Chrome | 238,518 | 175,301 / 60,034 / 838 / 2,305 / 40 | 149,430 / 66,641 / 670 / 3,996 / 17,781 | 71,972 / 87,876 / 592 / 17,966 / 60,112 |
| Firefox | 238,412 | 190,268 / 46,727 / 422 / 457 / 538 | 167,333 / 55,113 / 620 / 1,305 / 14,041 | 97,272 / 73,264 / 103 / 8,473 / 59,300 |
| webkit-host | 238,457 | 179,142 / 54,970 / 1,460 / 1,833 / 1,052 | 157,910 / 57,600 / 1,751 / 4,417 / 16,779 | 97,479 / 50,983 / 1,123 / 6,977 / 81,895 |

- **Line-count pass rate on observable cases.**
  - Rebuild: 235,335 of 238,478 in Chrome (98.68%), 236,995 of 237,874 in Firefox (99.63%), 234,112 of 237,405 in webkit-host (98.61%).
  - Main: 176,139 (73.86%), 190,690 (80.16%) and 180,602 (76.07%).
- **Regression against main after the history reruns** (§4). These are cases where main passes line count or breaks and the rebuild doesn't:
  - Chrome: 1,045 (0.44% of cases; 707 on line count, 643 on breaks).
  - Firefox: 731 (0.31%; 422 and 620).
  - webkit-host: 716 (0.30%; 469 and 641).
- **Old suite's required cases.** One regresses in Chrome, on line count, and one in Firefox, on breaks. None regresses in webkit-host.
- **Errors.** In all three browsers there are no native observation, rebuild prediction, painter or adapter errors. Main's adapter can express every case; no case is rejected as unsupported by main.
- **Gaps.** A rebuild row reports at least one gap on 198,074 cases in Chrome, 73,020 in Firefox and 185,749 in webkit-host. So a gap report alone doesn't separate failures from passes.

## 2. Method

### 2.1 Tooling added to `rebuild/lab`

- **`run.ts --predict-only`.** The flag is parsed at run.ts:34-41.
  - Chunk replies carry `predictOnly: true` only under that flag (run.ts:552).
  - The page then records `native: { skipped: 'predict-only' }` and still runs the predictor and painter (page.ts:282-288).
  - `run.json` adds `predictOnly` and `skippedNativeRows` only under the flag (run.ts:658).
  - The run fails when rows don't match the mode: an observed row under `--predict-only`, or a skipped row without it (run.ts:638).
  - The type gains `{ skipped: string }` (types.ts:122).
- **`score.ts --native-rows=<rows file>`.** It combines each predict-only row with the other file's row for the same case id.
  - `indexRows` (score.ts:884) records byte offsets without parsing the rows, and `readRowAt` (score.ts:917) reads one row.
  - `withNativeRow` (score.ts:932) takes the other row's native observation, environment and native timing.
  - It refuses (exit 1) a row that already has its own native observation, a native row without one, a different case, or another environment. Environment means browser, user agent, devicePixelRatio, visual-viewport scale, page language or fixture fonts.
  - A row with no native row stays unobserved, is counted in the summary's `nativeRows.missing`, and makes the scorer exit 1 (score.ts:1159).
  - Without the option, a skipped row scores unobserved ('native observation skipped', score.ts:577).
- **Tests.** Five new tests sit in score.test.ts, in the describe block 'rows from run.ts --predict-only take native observations from another run':
  - scoring without native rows;
  - combining with a native row;
  - refusals;
  - byte-offset indexing past multi-byte text, U+2028 and blank lines, including a duplicate id;
  - an end-to-end CLI run that scores, refuses another user agent and counts missing rows.
  - `bun test rebuild/lab`: 127 pass, which includes another agent's gate tests. `bunx tsc -p rebuild/lab/tsconfig.json --noEmit` is clean.
- **Same output as before.** HEAD's `score.ts` and the new one gave byte-identical per-case files, and summaries equal apart from `generatedAt`. The runs checked were webkit-host smoke-forward with `--cases` and policy-reverse with `--native-compare`.
- **Checked on real rows.** For Chrome chunk00, `score.ts --native-rows` used 19,784 rows with 0 missing. Its summary equals the census tool's tallies, and per-case statuses match on all 19,784 cases.
- **README.** `rebuild/lab/README.md` documents both options. Another agent also added gate and obligations sections to that file during this session.

### 2.2 Cases and chunks

- **Import.** `generate.ts suite` read 707,431 old row inputs into 238,524 cases in 387 families; 7,803 cases have required metrics.
  - After each case's browser filter: Chrome 238,518, Firefox 238,412, WebKit 238,457. RTL: 72,820.
- **Old suite scope.** It isn't in the case origin. `tools/suite-meta.ts` rebuilds it by converting every old input with the importer's own id functions: 217,489 cases have only supported inputs, 20,906 only research inputs, and 129 have both.
- **Split** (`tools/split.ts`). Text lengths have p50 6, p99 107 and max 269,747 UTF-16 units, with no case between 107 and 1,000.
  - 237,406 cases of at most 1,000 units went to `chunk00`–`chunk11`, 19,782–19,784 each, run with `--chunk=25`.
  - The 1,118 paragraphs over 1,000 units total 50.5M units. They went to `corpus00`–`corpus10`, each at most 5M units, run with `--chunk=1`: one paragraph per round trip, because rows cost about 200 bytes per unit against Bun.serve's 128 MB request limit.
  - File order is kept inside each group.

### 2.3 Runs

- **One lock hold per chunk.** For each browser and chunk, one hold of the shared browser lock (`tools/census-chunk.sh` under `tools/run-census3.sh`) runs, in order:
  1. native observation with the rebuild's predictions, using the final runs' gaps predictor on `rebuild/src` tree ecdef04b, the same tree as the final runs;
  2. main's predictions alone, with `--predict-only` and `rebuild/lab/baselines/main-predictor.ts`;
  3. scoring: `score.ts` for both predictors (main's with `--native-rows`), then `tools/census.ts chunk`.
  - Scoring ran inside the hold so it wouldn't load the machine beside another session's timing jobs.
- **Order.** Chrome, then Firefox, then webkit-host. From 20:21 the chain waits 12 s after each hold, so other waiters, which check the lock every 5 s, can take it.
- **Memory.** `tools/monitor.py` sampled the browser's process tree every 2 s and would stop the job above 6,000 MB; no sample breached it. Rows stream to `.artifacts/research-20260916/census/<browser>/<chunk>/{rebuild,main}/`.

### 2.4 Categories

- **One native observation per case.** `tools/census.ts` streams the native + rebuild rows. For each row it scores the rebuild with `scoreRow`, and scores main by combining main's predict-only row with the same native row (`withNativeRow`) and calling `scoreRow` again.
- **Five categories per metric:** both pass, rebuild only, main only, both fail, unobserved.
  - **Unobserved** comes from the native derivation alone: for line counts, a line count issue; for breaks, a breaks issue; for widths, breaks unobserved or any native line whose width is unobserved.
  - For every other case, each predictor passes or it doesn't. Not passing includes fail, not-applicable after failed breaks, and prediction errors.
- **Per-case transitions** are in `census-transitions.ndjson` (715,387 lines). All counts per browser, group and family are in `census.json`.

### 2.5 History reruns

- **Case lists.** For each browser, the main-only cases (line count or breaks) went to `main-only/<browser>-cases.ndjson`: 1,191 for Chrome, 731 for Firefox, 2,056 for webkit-host.
- **Four jobs** under the lock (`tools/run-history.sh`), in fresh sessions holding only those cases:
  - native + rebuild with `--order=reverse`, and again with `--order=file`;
  - main `--predict-only` in both orders.
- **Comparison.** `tools/history.ts` compares each rerun's native derivation with the census row using `score.ts nativeView` + `nativeDifference`, and rescores both predictors against each rerun.
  - **History-dependent:** either rerun derives other native lines.
  - **Stable main-only:** not history-dependent, and main-only against both reruns.

## 3. Subgroups

Cells read both pass / rebuild only / main only / both fail / unobserved. Widths per group, and every other group, are in `census.json`: pre-wrap, keep-all, letter-spacing, installed-font contexts, span per part, and the adapter-supported group, which is every case.

| group | browser | cases | lineCount | breaks |
|---|---|---:|---|---|
| old suite required some metric | Chrome | 7,799 | 7,794 / 4 / 1 / 0 / 0 | 7,787 / 9 / 0 / 0 / 3 |
| | Firefox | 7,755 | 7,750 / 5 / 0 / 0 / 0 | 7,740 / 12 / 1 / 0 / 2 |
| | webkit-host | 7,802 | 7,794 / 8 / 0 / 0 / 0 | 7,794 / 6 / 0 / 0 / 2 |
| required height or lineCount | Chrome | 7,771 | 7,770 / 0 / 1 / 0 / 0 | 7,763 / 5 / 0 / 0 / 3 |
| | Firefox | 7,727 | 7,726 / 1 / 0 / 0 / 0 | 7,716 / 8 / 1 / 0 / 2 |
| | webkit-host | 7,774 | 7,770 / 4 / 0 / 0 / 0 | 7,770 / 2 / 0 / 0 / 2 |
| scope supported (every input) | Chrome | 217,483 | 156,597 / 57,751 / 810 / 2,285 / 40 | 131,940 / 63,170 / 651 / 3,963 / 17,759 |
| | Firefox | 217,441 | 170,575 / 45,455 / 419 / 454 / 538 | 148,354 / 53,137 / 617 / 1,300 / 14,033 |
| | webkit-host | 217,486 | 160,367 / 52,984 / 1,366 / 1,717 / 1,052 | 139,830 / 55,166 / 1,659 / 4,060 / 16,771 |
| scope research (any input) | Chrome | 21,035 | 18,704 / 2,283 / 28 / 20 / 0 | 17,490 / 3,471 / 19 / 33 / 22 |
| | Firefox | 20,971 | 19,693 / 1,272 / 3 / 3 / 0 | 18,979 / 1,976 / 3 / 5 / 8 |
| | webkit-host | 20,971 | 18,775 / 1,986 / 94 / 116 / 0 | 18,080 / 2,434 / 92 / 357 / 8 |
| direction rtl | Chrome | 72,820 | 48,389 / 23,846 / 127 / 439 / 19 | 43,021 / 26,953 / 57 / 637 / 2,152 |
| | Firefox | 72,786 | 55,837 / 16,616 / 105 / 61 / 167 | 51,031 / 19,610 / 95 / 163 / 1,887 |
| | webkit-host | 72,788 | 48,537 / 22,483 / 609 / 900 / 259 | 43,971 / 24,820 / 527 / 1,622 / 1,848 |
| `suite/U+*` control families | Chrome | 30,908 | 14,123 / 16,365 / 72 / 348 / 0 | 11,540 / 18,863 / 15 / 404 / 86 |
| | Firefox | 30,908 | 21,899 / 8,958 / 19 / 32 / 0 | 19,917 / 10,940 / 19 / 32 / 0 |
| | webkit-host | 30,908 | 15,511 / 15,102 / 260 / 35 / 0 | 13,802 / 16,641 / 400 / 65 / 0 |
| corpus paragraphs (over 1,000 units) | Chrome | 1,118 | 1,084 / 26 / 7 / 1 / 0 | 794 / 242 / 55 / 3 / 24 |
| | Firefox | 1,118 | 895 / 223 / 0 / 0 / 0 | 425 / 610 / 0 / 0 / 83 |
| | webkit-host | 1,118 | 1,094 / 24 / 0 / 0 / 0 | 796 / 139 / 0 / 0 / 183 |
| fixture web fonts | Chrome | 69,744 | 41,482 / 26,376 / 468 / 1,414 / 4 | 32,580 / 29,114 / 261 / 2,558 / 5,231 |
| | Firefox | 69,704 | 50,519 / 18,540 / 198 / 275 / 172 | 42,989 / 21,958 / 186 / 713 / 3,858 |
| | webkit-host | 69,704 | 44,432 / 23,013 / 990 / 825 / 444 | 37,774 / 24,395 / 1,208 / 1,709 / 4,618 |

- **Required cases, widths.** Chrome 3,644 / 4,150 / 0 / 0 / 5; Firefox 7,595 / 136 / 0 / 21 / 3; webkit-host 6,360 / 1,405 / 0 / 10 / 27.
  - Main fails widths on 4,150 required Chrome cases where the rebuild passes: the one-unit LayoutUnit difference noted in BASELINE-main.md.
- **Families with any main-only line-count or breaks pass:** 45 of 386 in Chrome, 31 of 381 in Firefox, 64 of 386 in webkit-host. Per-family counts of all five categories are in `census.json` under `browsers.<browser>.families`.

## 4. Main-only passes after the history reruns

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| main passes lineCount or breaks and the rebuild doesn't (census) | 1,191 | 731 | 2,056 |
| lineCount / breaks main-only | 838 / 670 | 422 / 620 | 1,460 / 1,751 |
| native lines differ in a fresh session (history-dependent) | 0 | 0 | 1,340 |
| main's prediction changed in a rerun | 185 | 0 | 0 |
| rebuild's prediction changed in a rerun | 0 | 0 | 0 |
| stable main-only | 1,045 | 731 | 716 |
| stable lineCount / breaks main-only | 707 / 643 | 422 / 620 | 469 / 641 |
| stable, rebuild reports no gap | 0 | 11 | 0 |
| stable, old suite required | 1 | 1 | 0 |

- **Chrome: 146 cases are main-only only because of main's history.** All 146 lose main-only status in a rerun, and every one of them is a case where main's own prediction changed. Main's Canvas widths depend on what the page measured earlier. By family: `raw-context` 34, `physical-window-terminal-seam` 30, `hidden-control-spacing` 20, `source-shaped-arabic` 20, `original-vs-reshaped-admission` 16, `mixed` 12.
  - This includes the 16 `original-vs-reshaped-admission` cases REPORT.md §2.3 lists among main-only passes.
  - Example: `c-cfcec2434df69b75`, `suite/control`, text `ب` U+200D `ب((tail` in Amiri 16px at letter-spacing −1.
- **webkit-host: the census overstates main's advantage.** Of the 1,340 history-dependent cases, in both reruns the rebuild passes line count on 1,300 and main fails line count on 951. 349 pass for both in both reruns, 39 flip between reruns, 1 is unobserved, and 41 are main-only against at least one rerun.
  - The census observed these cases deep inside documents holding about 19,784 cases. Documents holding only these cases lay them out otherwise.
  - Families: `raw-context` 287, `U+001C`–`U+001F/middle` 350, `physical-window-terminal-seam` 85, `maintained/kinsoku-units` 80, `signed-spacing/ascii-matrix` 67, `following-space-scope` 48, `U+000B/middle` 44.
  - Example: `c-109a381d39bcdbe3` (`a` SHY `b` VT `b`). The census derives 2 lines and both reruns derive 3; in both reruns the rebuild passes line count and breaks and main fails.

### 4.1 Stable main-only families, with examples

Every case is in `history/<browser>/history.json`, field `rest`, with native, rebuild and main lines. Case files for reruns are `main-only/<browser>-cases.ndjson`.

**Chrome (1,045)**

- **Families:** `joined` 245, `mixed` 103, `chromium-script-spacing` 74, `following-space-scope` 58, `maintained/corpus` 51 (breaks on corpus paragraphs), `space` 47, `joined-plain` 43, `cluster-v2-new` 40, `prefix-cap-control` 40, `cluster-v1` 36, `cross-item` 35, `U+FFFC/middle` 32 (start 16, end 14), `maintained/kinsoku-units` 22, `accepted-r` 18, `restart-next-word` 18, `control` 17.
- **Gaps named** (a case can name several): unsafe-to-break 820, in-word-prefix 636, script-context 623, font-fallback 82, soft-hyphen-shaping 28, tab-stops 12, han-kerning 7, control-character-width 5.
- **Joined Arabic, one letter late.**
  - `c-00520dd17f45f4f9`: `بِلا` in Arial 32px at 24.07px, letter-spacing 1. Native `بِ|لا`, rebuild `بِل|ا`, main `بِ|لا`. Line count passes for both; breaks are main-only.
  - `c-027050a2987b2391` is the same text in Times New Roman 16px at 13.47px.
  - The rebuild names the gap (unsafe-to-break) but breaks inside lam-alef.
- **Required case `c-9c5a66597ebf5aef`** (`suite/cluster-v1`, required api, height and lineCount).
  - Text `a` U+2060 U+0301 `b` in Courier New 16px, letter-spacing −4, width 1px, pre-wrap.
  - Native 3 lines `[a][U+2060 U+0301][b]`; rebuild 4 lines, splitting U+2060 from U+0301; main 3 lines.
- **U+FFFC after Arabic.** `c-0034c46b8f3fa92d`: `ب` SHY `ب` U+FFFC in Arial 16px at 18.78px, pre-wrap.
  - Native 2 lines `[ب SHY ب][U+FFFC]`; rebuild 1 line; main 2 lines `[ب SHY][ب U+FFFC]`. Main passes line count; breaks fail for both.
  - The rebuild names the gap "U+FFFC in text: Canvas measures it as U+200B".

**Firefox (731)**

- **Families:** `joined` 271, `mixed` 86, `following-space-scope` 72, `joined-plain` 44, `measurement` 40, `space` 31, `chromium-script-spacing` 30, `raw-context` 26, `control` 22, `ligature-thresholds-v3` 14, `cross-item` 13, `following-space-context` 12, `source-shaped-arabic` 12, `accepted-l` 10, `word` 9, `cluster-v1` 8.
- **Gaps named:** in-word-prefix on 720; none on 11.
- **Joined Arabic.** Most frequent excerpts: `لألالإلآ` 54, `بِلا` 52, `بلاب` 44, `بلاملام` 41, `لاfiلا` 39.
- **Required case `c-ed263bd4b6656704`** (`suite/maintained/accuracy`, required height).
  - "Superlongwordwithoutanyspacesthatshouldjustoverflowthelineandkeepgoing" in 24px "Helvetica Neue" at 150px.
  - Native `Superlongwo|rdwithoutany|…`; rebuild `Superlongwor|dwithoutanys|…`, first line 149.817px.
  - The rebuild names the gap in-word-prefix, "offset 12: W(prefix) + W(suffix) = 49509 au, W(unit) = 49483 au".
  - Main's breaks pass; its widths fail by 26 units of 1/60px.
- **No gap named (11 cases).**
  - `chromium-script-spacing`, `x  ` in Arial 16px, normal and pre-wrap at widths 10 and 1 (4 cases). Firefox keeps the spaces on the line; the rebuild gives the trailing space its own line. Example: `c-9bf78f942cff2e33`, native `[x]`, rebuild `[x ][ ]`.
  - `cross-item`, `a` U+200B U+0301 `)ब` in Georgia 16px (7 cases). Firefox breaks between the ZWSP and the combining mark; the rebuild keeps them together. Example: `c-924c3bf3d268e1fc` at 12px, native `[a][U+0301][)][ब]`, rebuild `[a U+200B U+0301][)][ब]`.

**webkit-host (716)**

- **Families:** `ligature-thresholds-v3` 540, `mixed` 50, `word` 46, `cluster-v2-new` 19, `cluster-v1` 18, `joined` 16, `space` 10, `resumed-zero-tail` 10, `following-space-context` 3, `physical-text-geometry` 2, `raw-context` 1, `source-views/long-tail-edge-falsifier` 1.
- **Gaps named:** letter-spacing-ligatures 712, hyphen-glyph 9, fixed-pitch-path 8, control-character-width 4.
- **Ligature thresholds.** Example: `c-0033f34a9d6b3f85`, `affinity` in ProbeShantell 700 16px, letter-spacing −4, width 20.224px, pre-wrap.
  - Native `[affini][ty]`; rebuild `[aff][init][y]`; main `[affini][ty]`.
  - The rebuild names the gap "the DOM turns off liga, clig, dlig and hlig under letter-spacing; OffscreenCanvas keeps them".
  - Frequent excerpts: `efficient` 93, `difficult` 92, `affinity` 86, `ffiffl` 76.

## 5. Widths only main passes

- **Chrome: 592 cases.**
  - Families: `following-space-scope` 244, `following-space-context` 162, `chromium-script-spacing` 105, `prefix-cap-control` 18.
  - 519 fail widths outright. On the other 73 the rebuild's breaks fail, so its widths aren't scored.
  - The rebuild's first mismatched line is off, in units of 1/128px, by −127 (94 cases), −790 (84), +682 (66), −113 (60), −192 (40), +768 (32), −600 (32).
  - Example: `c-02266b030454af2c`, `آگ` SHY ` A` in Arial 16px at 48px. Native 31.421875px, rebuild 30.5390625px, main passes.
  - The examples are short lines with joined Arabic, and a soft hyphen or joiner, before a space and a following letter.
- **Firefox 103 and webkit-host 1,123.** Counted in `census.json` but not broken down. None of these widths cases was rerun for history dependence.

## 6. Runtime and memory

| | Chrome | Firefox | webkit-host |
|---|---|---|---|
| native + rebuild runs | 39.4 min | 45.6 min | 138.3 min (plus 16.2 min for corpus02's stalled first attempt) |
| main --predict-only runs | 1.2 min | 1.7 min | 1.1 min |
| history reruns (4 jobs) | 16 s | 11 s | 5 s |
| peak browser tree RSS, native + rebuild / main | 3,000 / 2,381 MB | 3,534 / 2,344 MB | 3,785 / 2,027 MB |
| rows on disk | 11 GB | 12 GB | 12 GB |

- **Wall clock.** The first census run started at 19:23 PDT and the last finished at 02:24 PDT: 7 h 01 min, including lock waits. Chunk00 waited 14 min for the lock, Firefox chunk10 33 min, and Firefox corpus09 about 38 min. The history comparisons also waited 33 min.
- **Where the time goes.**
  - Chrome: native observation of corpus paragraphs costs about 58 µs per UTF-16 unit (corpus00: 285 s for 4.88M units). Small chunks take 11–40 s.
  - Firefox: small chunks take 6–11 s. The rebuild's Gecko prediction on the Japanese 羅生門 corpus paragraphs, about 5,500 units at many widths, takes about 4.8 s per paragraph, and painting lays it out again for another 4.8 s. In corpus08, native observation totals 3 s, prediction 355 s and painting 356 s over 356 paragraphs; 122 predict for over 1 s. Corpus08 took 733 s and corpus10 1,633 s.
  - webkit-host: Range geometry on huge paragraphs takes 31–74 s of native observation plus about 28 s of painter observation per 257k–270k-unit paragraph. Corpus05 took 1,536 s.
- **Machine.** The memory monitor recorded no breach in 7,151 samples, and disk still had 481 GB free at the end.

## 7. Caveats

- **History checks cover only the main-only cases.** The census observed each case once, in file order. Given how many webkit-host cases changed native lines in fresh documents, webkit-host's rebuild-only and both-fail counts are unchecked for the same effect.
- **Main depends on history in Chrome.** 185 of Chrome's 1,191 main-only cases got other main predictions in reruns.
- **webkit-host corpus02 stalled once.** Its first native + rebuild run hit the 120 s stall limit at 28 of 29 rows, on a 256,837-unit Arabic paragraph.
  - I reran it with `--stall-ms=600000`, and gave the remaining webkit-host chunks and the history reruns the same limit.
  - The failed attempt is kept in `webkit-host/corpus02/rebuild-stalled-20260916T2353/`.
- **Memory monitor.** Until 22:57 it counted only WebKit services started after the host. WebKit had already launched some of them earlier, so webkit-host chunk00–07 peaks (212–402 MB) are under-counted. Short main runs of 2–5 s can finish between samples, which shows as peaks of 0 MB.
- **Lock turn-taking.** `run-census2.sh` retook the lock with no gap, and other sessions' jobs waited for about 45 min. I stopped it at a chunk boundary and replaced it with `run-census3.sh`, which pauses 12 s after each hold; no work was lost.
- **Unresolved fonts.** Some rows name fonts the page couldn't resolve: Noto Naskh Arabic on 29 webkit-host corpus02 rows, Noto Serif Hebrew on 17 webkit-host corpus07 rows. Native layout and Canvas both fall back there.
- **Definitions.** "Main-supported" here is the old suite's scope `supported`, rebuilt from row inputs. "Both fail" for widths includes cases where breaks failed for both predictors.

## 8. Files

Everything is under `~/github/pretext-rebuild/.artifacts/research-20260916/census/`:

- `census.json`: all counts. Per browser: groups, families, scorer statuses and reasons, errors, runs with durations and peaks. The `history` block has per-browser rerun counts, stable and history-dependent families, and gap names.
- `census-transitions.ndjson`: per case and browser, both predictors' statuses and the category for each metric.
- `main-only/<browser>.ndjson` and `-cases.ndjson`: the main-only records and case files. `history/<browser>/history.json`: the rerun comparison. `history/<browser>/{reverse,forward,main-reverse,main-forward}/`: the rerun rows.
- `<browser>/<chunk>/{rebuild,main}/`: rows, run.json, summaries and per-case files. `<browser>/<chunk>/census.json`: the chunk's counts.
- `cases/suite-all.ndjson`, `cases/suite-meta.json`, `cases/chunks/`: the cases, old-suite metadata, and the chunk files with their manifest.
- `monitor.jsonl`: memory samples.
- `run-census3.log`, `run-census4.log`, `run-history-*.log`: chain logs.
- `tools/`: `split.ts`, `suite-meta.ts`, `case-stats.ts`, `census.ts`, `history.ts`, `report.ts`, `monitor.py`, `census-chunk.sh`, `run-census3.sh`, `run-history.sh`. The earlier chains `run-census.sh` and `run-census2.sh` are kept for the record.
