# Installed Safari 27 against webkit-host on the tier 2 sets (2026-09-18)

## Answer

**Equal.** Installed Safari 27.0 laid out all 63,987 tier 2 cases exactly as webkit-host did.

- **Native observations that differ: 0 of 63,987.** The whole observation is compared as recorded:
  - paragraph height and width, and every Range rect of every code point (x, y, width, height);
  - every text node rect, every element rect (spans, atomic inlines, `<br>`, `<wbr>`), and every slot float;
  - `document.fonts.status` before and after, rejected styles, and missing fonts.
- **The scorer's own view is equal too.** That view is `score.ts` `nativeView` and `nativeDifference`: the line count, and every rect's x, width and line. Line counts, break offsets and line widths all follow from it.
- **Predictions that differ: 0.** The library asked Canvas the same questions and got the same answers in both browsers.
- **Painted lines that differ: 0. Rows missing: 0.**

How much that covers:

| Observed thing | Count |
|---|---:|
| Native lines | 233,965 |
| Code point rects | 2,359,985 |
| Text node rects | 293,614 |
| Element rects (in 9,196 cases) | 13,151 |
| Slot floats (in 1,971 cases) | 7,452 |
| Painted lines | 234,038 |

The cases include the 283 that the host's two-order ledger marks history-dependent. A history-dependent case is one whose layout depends on the cases that ran before it. In forward order Safari agrees with the host on all 283.

No Safari job failed. Safari's automation started without complaint. It is AppleScript here, not safaridriver.

## What ran

- **Safari side.**
  - One forward pass in installed Safari over the 17 case files behind webkit-host's 13 tier 2 sets (`rebuild/tests/sets.ts`).
  - It ran from 17:11 to 17:25 PDT, about 14 minutes.
  - Every job went through the browser lock under the job name `safari-check`, with `--allow-safari-frontmost`.
- **Host side.**
  - The rows are the recorded forward rows the six frozen references were packed from.
  - They sit at `.artifacts/tests/runs/line-20260918/webkit-host-no-facts/runs/<set>/forward/part<k>/webkit-host-rows.ndjson.zst`. The `smoke-hand` file is plain.
  - They were recorded on 2026-09-18 at about 12:45 PDT.
- **Same command as `browser-sets.ts`.** Each Safari job is the `run.ts` command `browser-sets.ts` starts for webkit-host:
  - the same case file, with its sha256 checked against the host run's recorded protocol (17 of 17 equal);
  - file order, and 25 cases a round trip;
  - the predictor with no supplied font facts.
- **Same library.** `bundleSha256` is `1545f944f502…` in all 17 Safari jobs. That is the bundle the host rows ran.
- **Same build and device.**
  - Safari 27.0, WebKit 22625.1.29.11.27, macOS 26A428.
  - Device pixel ratio 2 and viewport scale 1.
  - `navigator.languages` is `zh-CN` in both.
  - Page language and fixture fonts are equal on every row.
  - Every Safari row was `visible`.
- **Same history.**
  - Every Safari job ran as one part, which means one fresh WebContent process per file, like the host's jobs.
  - Installed Safari cuts a job into 5-minute parts by default. A cut would give the later cases another process history than the host's.
  - So the two longest files ran with `--part-ms=420000`: `suite-sample` part 3 took 143 s and `heldout-suite-sample` part 1 took 238 s. Neither was cut.
  - `documentCaseIndex` and `previousCaseId` are equal on every one of the 63,987 row pairs.
- **Caps used.**
  - One forward pass, no reverse pass and no follow-up runs.
  - 17 Safari jobs, each run once. No job was run a second time.

## Table per set and family

Every set: no row is missing, and nothing differs.

| Set | Cases run | Families | Native observation differs | Prediction differs | Painted lines differ |
|---|---:|---:|---:|---:|---:|
| smoke-hand | 25 | 25 | 0 | 0 | 0 |
| smoke | 300 | 93 | 0 | 0 | 0 |
| runs | 2,580 | 7 | 0 | 0 | 0 |
| ws | 1,019 | 3 | 0 | 0 | 0 |
| policy | 1,606 | 8 | 0 | 0 | 0 |
| rich-prewrap | 1,334 | 11 | 0 | 0 | 0 |
| suite-sample (4 parts) | 19,933 | 386 | 0 | 0 | 0 |
| families | 9,726 | 20 | 0 | 0 | 0 |
| features | 12,268 | 9 | 0 | 0 | 0 |
| heldout-runs | 2,579 | 7 | 0 | 0 | 0 |
| heldout-ws | 1,022 | 3 | 0 | 0 | 0 |
| heldout-policy | 1,604 | 8 | 0 | 0 | 0 |
| heldout-suite-sample (2 parts) | 9,991 | 219 | 0 | 0 | 0 |
| **All** | **63,987** | 469 distinct | **0** | **0** | **0** |

The families added since the 09-16 comparison, with cases run. Every one has 0 differences.

| Kind | Families (cases run) |
|---|---|
| Inline tree with spans | `rule/box-edges` 2,880; `rule/nested-box-edges` 720; `rule/nowrap-spans` 496; the `runs/*` families (below) |
| Atomic inlines | `rule/atomic-inlines` 2,028 |
| `<br>` and `<wbr>` | `rule/br-elements` 848; `rule/wbr-elements` 1,164 |
| text-indent and text-align | `rule/text-indent` 992; `rule/text-align` 1,232 |
| Float rows (line slots) | `rule/line-slots` 1,908; `rich-prewrap/slots` 75 |
| Rich pre-wrap (1,334) | tabs 183; trailing-spaces 160; fonts 144; box-edges 126; narrow 120; bidi 108; nested 108; normal-in-pre-wrap 105; span-in-normal 105; newlines 100; slots 75 |
| Letter and word spacing | `runs/letter-spacing-spans` 360 + 360 held-out; `runs/word-spacing-spans` 360 + 360 held-out; `suite/signed-spacing/*` and other suite spacing families about 2,850 |
| Fonts | `rule/system-fonts-and-sizes` 680; `rule/monospace` 544; `rule/hyphen-glyph` 544; `runs/mixed-fonts-sizes` 360 + 360; `rich-prewrap/fonts` 144 |
| Other rule families (set `families`) | joining 896; languages 800; tabs 786; hyphen-classes 680; segment-breaks 640; in-word-breaks 592; quotes 560; clusters 392; keep-all-storage 376; fit-bound 360; rewind 360; controls 336; following-space 288; urls 280; hanging-white-space 244; zwnj 192; forced-breaks 176 |
| `runs` (2,580 + 2,579 held-out) | bidi-runs 420 + 420; lang-spans 360 + 359; span-at-space 360 + 360; split-word 360 + 360 |
| `ws` (1,019 + 1,022 held-out) | controls 466 + 466; text-nodes 273 + 276; trailing-space-edge 280 + 280 |
| `policy` (1,606 + 1,604 held-out) | line-break 300 + 298; word-break 264 + 264; url-number 200 + 200; zh-lang 200 + 200; overflow-wrap 192 + 192; emoji 150 + 150; korean 150 + 150; thai 150 + 150 |
| Old wrapping suite samples | 386 `suite/*` families, 29,924 cases across the suite-sample and heldout-suite-sample sets |
| Giants | not run (see "Not covered") |

The count for every one of the 469 families is in `reports/safari-vs-host-line-forward.json`, under `families`.

## Classes of difference

There are none. No case differs, so nothing needs classifying.

Three offline controls show that the zero is real. None needed a browser.

1. **Two host runs of the same protocol are equal.**
   - The host's forward recording (`line-20260918`) and its later forward check (`line-20260918-check`) are equal on all 63,987 cases in native observation, prediction and painted lines.
   - So under this protocol the host does not vary from run to run, and a Safari difference would not have been host noise.
   - Report: `reports/control-host-check-vs-host-line-forward.json`.
2. **The comparison does see differences where they exist.** The check compares Safari forward with the host's reverse rows on the two suite sample parts that hold the most history-dependent cases. Both files give exactly the counts that host forward against host reverse gives, and the first ten differing ids `compare-rows.ts` lists for each are the same.

   | File | Differing native observations | Differing painted lines |
   |---|---:|---:|
   | `suite-sample` part 3 | 39 | 0 |
   | `heldout-suite-sample` part 1 | 60 | 1 |

   - **`c-012f58bab9cad28a`** (`suite/U+001C/middle`): 3 native lines in forward order, in Safari and in the host alike. 2 lines in the host's reverse order.
   - **`c-a997b222503e59ba`** (`suite/U+001D/middle`): code point 1 is `[x 3, width 9.609375, line 0]` in forward order in both browsers. It is `[3, 4, 0]` in the host's reverse order.
   - **`c-84fe207b3c969b82`** (`suite/U+000B/middle`): code point 4 is 7.775999546051025 wide in forward order in both browsers. It is 7.776000022888184 wide in the host's reverse order, one float32 step away.

   So order effects show up at full precision, and Safari forward behaves as host forward on them.
3. **The predictor configuration does not move native layout.**
   - The host's forward rows with the lab's font facts and without them have equal native observations and painted lines on all 63,987 cases.
   - Only the predictions differ, as expected.
   - So today's result stands for the observations of both configurations.
   - Report: `reports/control-host-facts-vs-host-no-facts-forward.json`. It is slimmed: the 63,807 "prediction differs" entries were dropped.

## What it means for webkit-host as Safari's stand-in

- **The stand-in rule still holds.**
  - WEBKIT-HOST.md's rule now holds on every tier 2 case family, not only the 09-16 sets.
  - The earlier evidence is the 09-16 comparison and the round 3 and 4 spot checks of 46,914 cases.
  - Today adds the rest of what the correctness line uses: `rich-prewrap`, `rule/atomic-inlines`, `rule/br-elements`, `rule/wbr-elements`, `rule/text-indent`, `rule/text-align`, `rule/line-slots`, the box-edge families, and the four held-out sets under the tier 2 protocol.
- **Conditions.** They are the file's own:
  - Safari 27.0 on WebKit 22625.1.29.11.27 and macOS 26A428, at device pixel ratio 2;
  - the same case file, order, round-trip size and parts in both browsers.
  - Any Safari or macOS update voids the result until this pass runs again. It took 14 minutes.
- **Correction for CORRECTNESS-LINE.md.** The line "Installed Safari was not re-run" can now say this:
  - installed Safari ran the tier 2 sets in forward order on 2026-09-18;
  - it equalled webkit-host's recorded rows on all 63,987 cases.

## Not covered

- **Reverse order.**
  - The brief allows it only when forward shows differences that look order-dependent. Forward showed none.
  - So whether Safari marks the same 283 cases history-dependent under this protocol was not observed today.
  - In rounds 3 and 4 Safari and the host marked the same ones on `dev-all` and `families-all`.
  - On 09-16, under another protocol, 28 held-out cases differed, each history-dependent in exactly one browser.
- **Giants.** They are in no tier 2 set. A giant takes minutes in Safari, and one round trip must stay under WebKit's 8-minute background CPU window.
- **Other sets and configurations.** The fresh and sealed sets, the measure-first protocol, and a Safari run with the lab's font facts. Control 3 says the observations do not depend on the font facts.
- **One Mac, one display scale.**

## Commands to repeat

```sh
O=.artifacts/tests/safari-check-20260918        # tools/, runs/, reports/, forward-chain.log
# 1. The forward pass in installed Safari. It takes the browser lock itself and runs one job after another.
#    It skips a job whose folder already holds a run.log, and it stops at the first failure.
#    For a new pass, point OUT in the script at a new folder.
bash $O/tools/run-safari.sh forward smoke-hand:0 smoke:0 ws:0 heldout-ws:0 rich-prewrap:0 policy:0 heldout-policy:0 \
  runs:0 heldout-runs:0 features:0 families:0 suite-sample:0 suite-sample:1 suite-sample:2 heldout-suite-sample:0
bash $O/tools/run-safari.sh forward suite-sample:3 heldout-suite-sample:1 -- --part-ms=420000
#    Each job is:
#    python3 .artifacts/session/with-browser-lock.py safari-check --max-wait-min=60 -- \
#      bun rebuild/lab/run.ts --browser=safari --allow-safari-frontmost --cases=<file> --out=$O/runs/<set>/forward/part<k> \
#      --order=file --predictor=<worktree>/rebuild/lab/baselines/no-facts-predictor.ts
#    Check afterwards that every safari-run.json says status ok, one part, and the host's bundleSha256.
# 2. Case by case against the host's recorded rows. It calls rebuild/lab/compare-rows.ts on every pair of row files
#    and reads .zst rows. Exit 0 when nothing differs.
bun $O/tools/compare-runs.ts --a=safari,safari,$O/runs \
  --b=host-line,webkit-host,.artifacts/tests/runs/line-20260918/webkit-host-no-facts/runs \
  --orders=forward --out=$O/reports/safari-vs-host-line-forward.json
# 3. Controls (offline).
bun $O/tools/compare-runs.ts --a=host-check,webkit-host,.artifacts/tests/runs/line-20260918-check/webkit-host-no-facts/runs \
  --b=host-line,webkit-host,.artifacts/tests/runs/line-20260918/webkit-host-no-facts/runs --orders=forward --out=<report.json>
bun rebuild/lab/compare-rows.ts $O/runs/suite-sample/forward/part3/safari-rows.ndjson.zst \
  .artifacts/tests/runs/line-20260918/webkit-host-no-facts/runs/suite-sample/reverse/part3/webkit-host-rows.ndjson.zst
bun $O/tools/count-observed.ts $O/runs safari forward      # how much was observed
# 4. The reverse order, if wanted: the same two run-safari.sh lines with "reverse", then compare-runs.ts with
#    --orders=forward,reverse. The host's reverse rows are already recorded beside the forward ones.
```

`rebuild/tests/compare-sets.ts` refuses two folders of different browsers, and it reads `<browser>-rows.ndjson` under one name. So `compare-runs.ts` walks the parts itself and hands each pair of row files to the lab's `compareRowFiles`. For any differing case it would also record which observed fields differ and both runs' lines. Today that list is empty.

Rows are compressed with `zstd -3`: 17 `safari-rows.ndjson.zst` files, 73 MB. Each copy was checked against its original by sha256. The 1.4 GB of originals are in the Trash. No tracked file was edited, and the worktree `x-safari-check` is clean.
