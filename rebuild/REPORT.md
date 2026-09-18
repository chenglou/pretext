# Pretext rebuild: report

Branch `rebuild-20260916`, forked from main 2e5e2bd, on this Retina Mac under macOS 27, 2026-09-16. Paths are relative to `~/github/pretext-rebuild`.

The brief:

- from a font declaration and styled runs, predict the lines each installed browser draws: where lines break, how many there are, and how wide each is;
- paint those lines with the DOM;
- measure only with Canvas `measureText`: no DOM reads for widths, no font files;
- pin engine code and data to Chrome 153.0.8010.48, Safari 27.0 (WebKit 7625.1.29.11.27, macOS 27 libicucore) and Firefox 156.0 (ICU4X 2.1.2 baked data);
- no epsilons, and every Canvas-versus-DOM gap handled on purpose or named.

Headlines:

- **Line counts match the browser** on 99.16% to 99.93% of suite-sample cases, development, the burned held-out set of 2026-09-16 and the sealed-2 held-out set run for the first time: installed Chrome 153, installed Firefox 156 and webkit-host, with installed Safari 27.0 in §2.7. Main's library gets 63.7% to 89.7% on the development and 2026-09-16 samples (§2.3, §2.5). The rates are pass ÷ (pass + fail); unobserved cases are left out. Against ceiling round 1, no line count, break or width was lost in any browser (§2.4).
- **Open model bugs by the round 2 definition** (a failing line needs a gap on it or on the break decision before it, §2.8): none on the rule families, feature families, development, held-out or sealed-2 sets in Chrome and webkit-host. Firefox's failures without a line-local gap there are the verified 1 au residual class, plus 3 sealed-2 rows outside it. Four fresh styled-run sets the evaluation generated (10,319 cases) found 6 Chrome rows in two new classes and 2 Firefox rows in one; the main-triage population holds 1 Chrome and 1 webkit-host row. So the ceiling isn't reached.
- **Installed Safari 27.0 lays out text exactly like webkit-host**, the background WKWebView app on the system WebKit 22625.1.29.11.27 that Safari 27.0 runs. In ceiling round 2 it ran the combined development file and, for the first time, the combined rule and feature families file, in both orders: every native view, prediction and score equals webkit-host's case by case. Its held-out file stopped at 7,863 of 15,205 rows, all equal too, when the hidden page was suspended, and its sealed-2 file never ran (§2.7). The charter evaluation's full development and held-out comparison is in REPORT.md at a4f23b8.
- **Cost:** in Chrome, about 2× main's Canvas calls on the development suite sample and 3.5× on the held-out one (mean), and prediction about 6× slower (final runs of 2026-09-16). Calls rose again in ceiling round 2, by 11% to 65% on the small sets (§3).
- **Findings for main** are in rebuild/TAKE-BACK.md, including 2 required checks main now fails in Safari 27.

Terms:

- A **case** is one styled paragraph at one width.
- The lab scores four **metrics** per case:
  - **lineCount**: the number of lines;
  - **breaks**: every line starts at the same visible character;
  - **widths**: every line's width is equal on the browser's own grid (1/128 px in Chrome at DPR 2, float32 edges in WebKit, 1/60 px in Firefox), with no tolerance, scored only where breaks pass;
  - **painter**: the painted lines draw at the predicted widths.
- Cells are pass / fail / unobserved, and widths add not-applicable. Unobserved means the rects can't settle it, for example a line ending at a chosen soft hyphen. Unobserved is never a pass.
- A **history-dependent** case is one the browser lays out differently when the same case file runs in reverse order. Those cases are left out of the counts.
- A **gap** is a known place where Canvas can't supply what the DOM uses. The library still predicts, and reports the gap's name on the line whose content or break decision it concerns, with a source range where it has one.
- A **protocol row** is a row whose page doesn't describe its declared input, such as slot floats outside their rows. It is left out of pass and fail alike.

## 1. What was built

### 1.1 Architecture

The library takes a paragraph and an environment. The paragraph is a list of styled runs, spans or bare text nodes, each with its own font, letter and word spacing and `lang`, plus the block's width, `white-space`, `word-break`, `overflow-wrap`, `line-break`, `tab-size`, direction and `lang`. The environment is the engine, the DPR, the page language and the UI languages.

It returns:

- lines as source offsets, with widths in CSS px and in the engine's own unit;
- each line's pieces: text, trimmed, collapsed, hanging, hyphen or forced break, each with its bidi level;
- the Canvas call log;
- the named gaps.

`paintLines()` turns the lines into one div per line, which the browser draws without re-wrapping.

The three engines differ at every stage (DESIGN.md §3), so there is no shared content model and no shared line loop. `layoutParagraph()` holds the only switch over engines. Each engine owns its whole pipeline, ported from its own source:

- **Blink**: builds text_content and resolves bidi with ICU `ubidi`. It groups text for shaping and breaks with Chrome 153's own tables, restarting ICU at every line start. Widths are LayoutUnits, the ceiling of float32 sums at the zoomed size. Line filling ports ShapeLine's reshapes at unsafe-to-break offsets, Han kerning, the re-break at width − 1px, and whole-line retries.
- **WebKit**: builds items per text box. It runs `BreakablePositions` verbatim, then libicucore 78.1's tables with Apple's quote overrides. Widths are float32 CSS px. It ports three line builders, InlineContentBreaker and `breakWord`, including the width a split word carries to the next line without measuring it again.
- **Gecko**: runs TransformText and `nsLineBreaker` over ICU4X rules. Widths are integer app units per shaping unit. It ports `BreakAndMeasureText` with one break priority per line, and at most one redo of the line.

What's shared:

- `breaks/rbbi.ts`: ICU's rule-based break iterator, for Blink and WebKit;
- `breaks/icu4x.ts`: ICU4X's break data and iterator, for Gecko;
- `unicode/ubidi.ts`: an exact port of ICU 78.2 `ubidi`, for Blink and WebKit. It differs from icu4c 78.3 and libicucore on 0 of 770,241 BidiTest runs, 183,379 BidiCharacterTest lines and 405,000 fuzz strings. The crate resolver disagreed with ICU on 130,661 of 300,000 fuzz strings;
- `unicode/unicode-bidi.ts`: the crate port, for Gecko;
- grapheme clusters with each engine's data;
- `measure/`: OffscreenCanvas contexts identified by their settings, a memo per layout, and the call log;
- `paint.ts`, with one engine switch, for the hyphen span;
- the generators, which check sha256 hashes of pinned engine data.

Thai, Lao, Khmer and Myanmar breaks come from the running browser's own segmenter.

The painter draws each line as a block at the paragraph's width, with the paragraph's wrapping styles and one node per run slice. It keeps trimmed and hanging white space, draws the hyphen as its own span, puts U+200D at joined line edges, and uses nested bidi-override spans.

The lab (`rebuild/lab/`) drives the browsers in background windows under the lock. It derives native lines from Range rects alone and scores the four metrics.

### 1.2 API shape

```ts
layoutParagraph(paragraph: Paragraph, env: Environment): { engine; lines: Line[]; measure: MeasureLog; gaps: Gap[] }
detectEnvironment(): Environment
paintLines(paragraph, layout, document): HTMLElement[]
Line = { start; end; width; engineWidth: {blink LayoutUnit raw + zoom | webkit float32 px | gecko app units}; fragments; joinsNextLine; next: LineStart | null }
Gap = { gap: GapName; run: number | null; detail: string; at?: { start; end } }   // on the paragraph, and since ceiling round 2 on each line
```

Internally each engine implements `prepare`, `firstLine`, `nextLine(prepared, start, width, measurer)` and `gaps`, but that split isn't public. A `LineStart` is valid only at the width that produced it. There is no prepare-once, lay-out-at-many-widths API, and nothing is cached across paragraphs.

## 2. Numbers

### 2.1 Method

The numbers in §2-§7 are the ceiling round 2 evaluation of 2026-09-17 (`rebuild-20260916` at bc49b0e). They replace the
ceiling round 1 evaluation's numbers of the same day, which stay in git history (REPORT.md at e51e831); §2.4 compares the
two case by case, and research/ROUND1-EVALUATION.md and ROUND1-CRITIC.md hold round 1's verdict and its corrections.

- Library: `rebuild/src` and `rebuild/lab` at bc49b0e, the round 2 fix phase (lab, painter, Blink, WebKit and Gecko owners).
  The last source change was at 14:49 and the first evaluation row at 15:23; `git diff bc49b0e -- rebuild/src rebuild/lab`
  shows only gate baselines. The evaluation was paused at 16:55 and resumed at 17:05 with every finished job's rows reused.
- Predictions go through `rebuild/lab/predictor.ts` with the lab's font fact table, the build read from the app bundle and
  the browser-process languages the driver records: Chrome `uiLanguage` zh-CN, Firefox `regionalPrefsLocale` zh-hans-us,
  webkit-host and Safari `preferredLanguages` zh-CN,zh-Hans (from `webkit-host --print-languages`) with ICU default locale
  `en_US_POSIX`.
- Scorer: `rebuild/lab/score.ts` version 4. It compares rects exactly as version 3 did, and adds three rules (lab/README.md,
  "Line-local gaps", "Protocol rows", "Elements"):
  - a failing line is covered only by a gap on its own engine line, on the line before it (the break decision it starts
    from), on a refused slot between the two, or by a paragraph gap whose range meets those lines;
  - a row whose slot floats sit outside their declared rows is a protocol row: every metric unobserved, never a pass or a
    fail;
  - `Element.getClientRects()` is compared, places lines and counts toward widths.

  Round 1's rows were re-scored with scorer 4 (`evaluate-r2/rescore-r1/`), so §2.4 separates the library change from the
  scorer change.
- Browsers, all at DPR 2 on macOS 27.0 (26A428): installed Chrome 153.0.8010.50 (15:23 to 15:50), installed Firefox 156.0
  (15:50 to 16:13) and webkit-host on WebKit 22625.1.29.11.27 (16:13 to 16:49). Chrome updated itself from 153.0.8010.48
  during the day. The library pins .48, so every Chrome row reports `engine-build` on the paragraph, which covers no line.
  Round 1's Chrome rows (.48) and round 2's (.50) hold equal native views on every case of every set in both orders
  (76,029 cases, `evaluate-r2/native-rounds-chrome.json`). webkit-host and installed Safari 27.0 ran the combined files
  after that (§2.7).
- Sets:
  - rule families and feature families: the same derived case files round 1 ran (Chrome 10,976 and 12,882 plus the 468
    `process-languages` cases under a Chrome launched in en-US; Firefox 9,584 and 11,946; webkit-host 9,584 and 12,150).
    The feature files still hold round 1's 22 slot protocol rows (Firefox 15, webkit-host 7), which scorer 4 leaves out;
  - development: smoke, runs, ws, policy and the 20,000-case suite sample in 4 parts;
  - held-out 09-16: runs, ws, policy and the 10,000-case suite sample in 2 parts. Burned; development cases now;
  - sealed-2: `sealed-2-20260917`, runs 2,579, ws 1,014, policy 1,597 and a 10,000-case suite sample, generated in round 2
    without any of 669,645 used ids and run here for the first time. All 10 file hashes equal `SEAL.json` and the
    repository record, and the combined file is the four files concatenated. Sealed runs are scored with
    `score.ts --sealed`; failures without a line-local gap, covering gap sets and the 1 au signature are counted by
    `evaluate-r2/tools/sealed-counts.ts`, `sealed-weak.ts` and `sealed-residual.ts`, which use the scorer's functions and
    write no case id, text, font or family. No sealed case, family or example was opened. The first sealed set
    (`sealed-20260917`) wasn't run again;
  - triage: the main-triage population (research/MAIN-TRIAGE.md §2.1: Chrome 9,507 cases, Firefox 8,603, webkit-host
    10,240), with main's predictor again in Chrome because of the new build;
  - fresh runs: four new `runs` sets (seeds `r2-eval-fresh-1` to `-4`, 10,319 cases, no id of the development, held-out or
    sealed runs sets), generated by this evaluation after the sealed-2 counts showed a Firefox class the development sets
    lack. They are development cases, opened freely (§2.8).
- Every case file ran in file order and in reverse, one job per file under the browser lock with a 20 s pause after each
  hold. The held-out and sealed-2 suite samples and combined files ran one case per round trip. Each run was scored
  against the other order with `--native-compare`; history-dependent cases are left out of the counts. One browser job
  failed, installed Safari's held-out file in file order (§2.7); it wasn't run again.
- Tools and outputs: `.artifacts/ceiling-20260917/evaluate-r2/` (`tools/`: `run-eval.sh`, `chain-browsers.sh`,
  `chain-combined.sh`, `score-eval.sh`, `rescore-r1.sh`, `aggregate.ts`, `gaps.ts`, `gates.sh`, `seed-diff.ts`, `reseed.sh`,
  `lost-pairs-record.py`, `triage.sh`, `sealed-counts.ts`, `sealed-weak.ts`, `sealed-residual.ts`, `trace-open.py`,
  `sample-weak.py`, `fresh-runs.sh`, `fresh-open.py`, `compare-native-rounds.ts`, `report-tables.py`;
  `aggregate-<browser>.md` and `.json`, `gaps/`, `gates/`, `triage/`, `fresh/`, `isolate/`, `facts-r1s4-vs-r2.md`, and per
  set `<browser>/<set>-{forward,reverse}/`).

Metrics and facts are defined as in lab/README.md "Scoring": lineCount, breaks, widths (where breaks pass) and painter;
predicted, limited and unobservable facts.

### 2.2 Observation agreement

Equal ÷ compared, forward runs, every case outside history dependence and protocol rows. Rect counts and line membership are
counted per range.

| Browser | Group | Rect counts | Predicted values | Limited values | Line membership | Unobservable facts |
|---|---|---|---|---|---|---:|
| Chrome | rule families | 194,392 of 194,680 (99.852%) | 409,752 of 412,898 (99.238%) | 50,068 of 57,492 (87.087%) | 232,062 of 232,211 (99.936%) | 3,850 |
| Chrome | feature families | 332,090 of 332,482 (99.882%) | 742,191 of 742,548 (99.952%) | 2,136 of 2,136 (100%) | 372,342 of 372,342 (100%) | 5,121 |
| Chrome | development | 1,106,070 of 1,106,208 (99.988%) | 2,233,483 of 2,271,834 (98.312%) | 122,290 of 132,352 (92.398%) | 1,201,830 of 1,201,833 (100.000%) | 45,116 |
| Chrome | held-out 09-16 | 2,259,548 of 2,259,673 (99.994%) | 4,433,880 of 4,562,338 (97.184%) | 180,312 of 192,500 (93.669%) | 2,376,882 of 2,376,898 (99.999%) | 92,108 |
| Chrome | sealed-2 | 1,133,443 of 1,133,567 (99.989%) | 2,175,655 of 2,180,903 (99.759%) | 206,285 of 241,563 (85.396%) | 1,210,717 of 1,210,748 (99.997%) | 90,293 |
| Firefox | rule families | 177,030 of 177,218 (99.894%) | 172,087 of 184,207 (93.420%) | 186,132 of 216,399 (86.013%) | 196,219 of 197,163 (99.521%) | 13,081 |
| Firefox | feature families | 304,999 of 304,999 (100%) | 281,650 of 281,999 (99.876%) | 373,976 of 375,225 (99.667%) | 327,264 of 327,264 (100%) | 19,017 |
| Firefox | development | 1,103,973 of 1,104,005 (99.997%) | 716,284 of 723,892 (98.949%) | 1,527,240 of 1,610,150 (94.851%) | 1,166,017 of 1,166,061 (99.996%) | 43,405 |
| Firefox | held-out 09-16 | 2,258,167 of 2,258,210 (99.998%) | 1,372,561 of 1,378,983 (99.534%) | 2,722,144 of 3,282,415 (82.931%) | 2,329,376 of 2,329,424 (99.998%) | 73,751 |
| Firefox | sealed-2 | 1,132,612 of 1,132,642 (99.997%) | 748,514 of 755,251 (99.108%) | 1,595,973 of 1,613,663 (98.904%) | 1,183,346 of 1,183,374 (99.998%) | 37,994 |
| webkit-host | rule families | 176,282 of 176,456 (99.901%) | 126,198 of 127,550 (98.940%) | 242,968 of 274,800 (88.416%) | 198,824 of 199,085 (99.869%) | 32,983 |
| webkit-host | feature families | 309,929 of 309,999 (99.977%) | 208,394 of 208,641 (99.882%) | 470,630 of 475,689 (98.936%) | 341,465 of 341,531 (99.981%) | 33,357 |
| webkit-host | development | 1,104,385 of 1,104,437 (99.995%) | 363,257 of 364,261 (99.724%) | 1,772,155 of 1,982,235 (89.402%) | 1,172,439 of 1,172,603 (99.986%) | 76,353 |
| webkit-host | held-out 09-16 | 2,258,094 of 2,258,172 (99.997%) | 414,566 of 415,639 (99.742%) | 2,949,444 of 4,258,597 (69.259%) | 2,336,380 of 2,336,534 (99.993%) | 61,828 |
| webkit-host | sealed-2 | 1,132,104 of 1,132,138 (99.997%) | 295,462 of 296,305 (99.715%) | 1,796,406 of 2,088,461 (86.016%) | 1,192,098 of 1,192,207 (99.991%) | 58,193 |

Predicted values against round 1's rows re-scored with scorer 4 (`evaluate-r2/facts-r1s4-vs-r2.md`):

| Browser | Group | Round 1 re-scored | Round 2 | Cases with a differing predicted value, round 1 → round 2 | Of round 2's, passing lineCount, breaks and widths |
|---|---|---|---|---|---:|
| Chrome | rule families | 171,391 of 172,971 (99.087%) | 409,752 of 412,898 (99.238%) | 562 → 548 | 128 |
| Chrome | feature families | 240,738 of 242,038 (99.463%) | 742,191 of 742,548 (99.952%) | 595 → 347 | 179 |
| Chrome | development | 412,602 of 413,216 (99.851%) | 2,233,483 of 2,271,834 (98.312%) | 187 → 2,108 | 2,030 |
| Chrome | held-out 09-16 | 428,320 of 429,391 (99.751%) | 4,433,880 of 4,562,338 (97.184%) | 299 → 898 | 722 |
| Firefox | rule families | 133,163 of 139,588 (95.397%) | 172,087 of 184,207 (93.420%) | 753 → 1,099 | 108 |
| Firefox | feature families | 233,332 of 233,623 (99.875%) | 281,650 of 281,999 (99.876%) | 180 → 222 | 199 |
| Firefox | development | 536,678 of 536,872 (99.964%) | 716,284 of 723,892 (98.949%) | 39 → 1,018 | 6 |
| Firefox | held-out 09-16 | 1,233,053 of 1,233,236 (99.985%) | 1,372,561 of 1,378,983 (99.534%) | 55 → 894 | 17 |
| webkit-host | rule families | 126,198 of 127,550 (98.940%) | unchanged | 546 → 546 | 70 |
| webkit-host | feature families | 208,394 of 208,641 (99.882%) | unchanged | 86 → 86 | 12 |
| webkit-host | development | 363,201 of 364,261 (99.709%) | 363,257 of 364,261 (99.724%) | 219 → 213 | 5 |
| webkit-host | held-out 09-16 | 414,552 of 415,658 (99.734%) | 414,566 of 415,639 (99.742%) | 271 → 264 | 7 |

- **Chrome's predicted values agree less often than in round 1, on 5.5 times as many values.** Round 2 narrowed
  `in-word-prefix` to the offsets a break decision read (13,638 development reports to 724), and the observation port
  takes its limited state from that gap, so positions inside a shaped word that round 1 marked limited now count as
  predicted. On the development sets 2,108 cases hold a predicted value that differs from the browser, and 2,030 of them
  pass lineCount, breaks and widths. In the 375 such cases of smoke, runs, ws and policy, the differing values are 2,507
  Arabic letters inside joined words and 377 Latin letters, such as the `f` of a ligature in Helvetica Neue (7.26px
  natively, 8.29px predicted); 1,182 of the 2,895 differ by more than half a CSS px. The corpus paragraphs hold most of the suite samples' (22,200 of
  35,263 development values). No metric reads these values, but the layout reports no gap for them: an open item for the
  Blink owner (§2.8).
- **Firefox's new differing predicted values sit in cases that already fail.** Round 2's observation port takes the limited
  state from the layout's shaping units instead of naming `in-word-prefix` itself (round 1 critic item 5), so values of
  failing lines that were limited now count as predicted: 1,018 development cases, 6 of them passing the three prediction
  metrics.
- webkit-host's agreement is round 1's apart from the word-spacing recipe's gains.

### 2.3 Scores, forward runs

Cells are pass / fail / unobserved, and widths add not-applicable. The reverse runs give the same lineCount and breaks cells
on every set. No row had a native, prediction or observation error, and no prediction raised `UnportedFeature`.

Chrome 153.0.8010.50 (no history-dependent case and no protocol row):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (10,976) | 10810/166/0 | 10749/227/0 | 10455/230/64/227 | 10219/693/64 |
| feature families | features (12,882) | 12882/0/0 | 12882/0/0 | 9733/0/3149/0 | 7098/312/5472 |
| feature families | process-languages under en-US (468) | 468/0/0 | 468/0/0 | 468/0/0/0 | 468/0/0 |
| dev | smoke (299) | 298/1/0 | 298/1/0 | 296/0/2/1 | 295/2/2 |
| dev | runs (2,580) | 2578/2/0 | 2577/3/0 | 2566/7/4/3 | 2556/20/4 |
| dev | ws (1,019) | 1019/0/0 | 1019/0/0 | 1018/1/0/0 | 1013/6/0 |
| dev | policy (1,606) | 1606/0/0 | 1606/0/0 | 1606/0/0/0 | 1598/8/0 |
| dev | suite (19,994) | 19938/56/0 | 19936/58/0 | 19271/25/640/58 | 19054/277/663 |
| held-out 09-16 | runs (2,579) | 2577/2/0 | 2577/2/0 | 2565/10/2/2 | 2556/22/1 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1022/0/0/0 | 1017/5/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1604/0/0 | 1604/0/0/0 | 1590/14/0 |
| held-out 09-16 | suite (10,000) | 9916/84/0 | 9908/92/0 | 9037/101/770/92 | 8866/356/778 |
| sealed-2 | runs (2,579) | 2577/2/0 | 2572/7/0 | 2561/10/1/7 | 2555/23/1 |
| sealed-2 | ws (1,014) | 1014/0/0 | 1014/0/0 | 1013/1/0/0 | 1012/2/0 |
| sealed-2 | policy (1,597) | 1597/0/0 | 1596/1/0 | 1595/1/0/1 | 1586/11/0 |
| sealed-2 | suite (10,000) | 9930/70/0 | 9928/72/0 | 9032/92/804/72 | 8853/339/808 |
| triage | small (8,933) | 8715/218/0 | 8513/420/0 | 8508/2/3/420 | 8549/373/11 |
| triage | long (55) | 55/0/0 | 55/0/0 | 55/0/0/0 | 55/0/0 |
| triage | widths (519) | 519/0/0 | 519/0/0 | 369/32/118/0 | 294/107/118 |

Firefox 156 (history-dependent: development suite 123, held-out 09-16 suite 217, sealed-2 suite 122, others 0; protocol
rows: feature families 15):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (9,584) | 9432/152/0 | 9200/384/0 | 8592/608/0/384 | 8048/1536/0 |
| feature families | features (11,946) | 11931/0/15 | 11931/0/15 | 8862/0/3084/0 | 6425/41/5480 |
| dev | smoke (297) | 297/0/0 | 297/0/0 | 292/5/0/0 | 283/14/0 |
| dev | runs (2,580) | 2580/0/0 | 2576/4/0 | 2541/35/0/4 | 2486/94/0 |
| dev | ws (1,019) | 1019/0/0 | 1019/0/0 | 1019/0/0/0 | 1002/17/0 |
| dev | policy (1,606) | 1606/0/0 | 1605/1/0 | 1598/7/0/1 | 1583/23/0 |
| dev | suite (19,888) | 19702/63/0 | 19688/77/0 | 18804/884/0/77 | 18119/1646/0 |
| held-out 09-16 | runs (2,579) | 2571/8/0 | 2568/11/0 | 2525/43/0/11 | 2479/100/0 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1021/1/0/0 | 1008/14/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1602/2/0 | 1594/8/0/2 | 1573/31/0 |
| held-out 09-16 | suite (10,000) | 9735/48/0 | 9712/71/0 | 8971/741/0/71 | 8497/1286/0 |
| sealed-2 | runs (2,579) | 2576/3/0 | 2574/5/0 | 2537/37/0/5 | 2495/84/0 |
| sealed-2 | ws (1,014) | 1014/0/0 | 1014/0/0 | 1013/1/0/0 | 1005/9/0 |
| sealed-2 | policy (1,597) | 1596/1/0 | 1593/4/0 | 1586/7/0/4 | 1569/28/0 |
| sealed-2 | suite (10,000) | 9845/33/0 | 9829/49/0 | 8994/835/0/49 | 8515/1363/0 |
| triage | small (8,518) | 8226/292/0 | 7926/592/0 | 7890/36/0/592 | 7757/761/0 |
| triage | widths (85) | 85/0/0 | 85/0/0 | 60/25/0/0 | 45/40/0 |

webkit-host (history-dependent: rule families 6, development runs 6, ws 1, suite 75, held-out 09-16 runs 1, suite 135,
sealed-2 runs 1, suite 122, triage small 5; protocol rows: feature families 7):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (9,584) | 9458/120/0 | 9376/202/0 | 8822/291/263/202 | 8382/995/201 |
| feature families | features (12,150) | 12123/20/7 | 12111/32/7 | 10923/0/1195/32 | 8643/114/3393 |
| dev | smoke (300) | 299/1/0 | 297/3/0 | 287/5/5/3 | 263/32/5 |
| dev | runs (2,580) | 2565/9/0 | 2526/48/0 | 2316/81/129/48 | 2238/218/118 |
| dev | ws (1,019) | 1018/0/0 | 1018/0/0 | 1016/2/0/0 | 992/26/0 |
| dev | policy (1,606) | 1605/1/0 | 1599/7/0 | 1558/21/20/7 | 1451/139/16 |
| dev | suite (19,933) | 19843/15/0 | 19841/17/0 | 19726/26/89/17 | 18765/1015/78 |
| held-out 09-16 | runs (2,579) | 2569/9/0 | 2538/40/0 | 2292/105/141/40 | 2217/235/126 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1020/1/1/0 | 996/25/1 |
| held-out 09-16 | policy (1,604) | 1603/1/0 | 1602/2/0 | 1553/31/18/2 | 1421/172/11 |
| held-out 09-16 | suite (10,000) | 9833/32/0 | 9820/45/0 | 9682/37/101/45 | 7944/1867/54 |
| sealed-2 | runs (2,579) | 2575/3/0 | 2551/27/0 | 2342/63/146/27 | 2276/173/129 |
| sealed-2 | ws (1,014) | 1014/0/0 | 1014/0/0 | 1013/1/0/0 | 996/18/0 |
| sealed-2 | policy (1,597) | 1597/0/0 | 1592/5/0 | 1552/25/15/5 | 1429/157/11 |
| sealed-2 | suite (10,000) | 9871/7/0 | 9862/16/0 | 9721/58/83/16 | 7989/1843/46 |
| triage | small (9,854) | 9366/483/0 | 9117/732/0 | 9002/17/98/732 | 8363/1406/80 |
| triage | widths (386) | 386/0/0 | 386/0/0 | 360/10/16/0 | 259/115/12 |

Reading these:

- Suite-sample line counts, pass ÷ (pass + fail), development / held-out 09-16 / sealed-2: Chrome 99.72% / 99.16% / 99.30%,
  Firefox 99.68% / 99.51% / 99.67%, webkit-host 99.92% / 99.68% / 99.93%. Round 1: Chrome 99.55% / 98.98%, Firefox 99.68% /
  99.50%, webkit-host 99.92% / 99.68%, and 99.12%, 99.74% and 99.84% on the first sealed set.
- Observed suite widths passing, same order: Chrome 99.87% / 98.89% / 98.99%, Firefox 95.51% / 92.37% / 91.50%,
  webkit-host 99.87% / 99.62% / 99.41%.
- The sealed-2 set scores like the development sets in all three browsers, so by these counts the library generalizes. Its
  suite sample takes one quota per family, so its rates don't compare exactly with the other samples.
- Feature families: with element rects compared, no line count or break is unobserved any more apart from the protocol
  rows (round 1: Chrome 719, Firefox 670, webkit-host 705), and every Chrome and Firefox feature case passes lineCount and
  breaks. webkit-host fails 20 line counts and 32 breaks, all `rule/br-elements` under `page-history` or `tab-stops` on the
  line (4 of the line counts and 8 of the breaks newly observed by scorer 4). Widths stay unobserved where the port's node
  and element rects don't span the engine width (box edges, slots, indents): Chrome 3,149, Firefox 3,084, webkit-host
  1,195.
- WebKit's unobserved widths (development 243, held-out 09-16 261, sealed-2 244) are still lines where `contentWidth` sits a
  float32 step from the union of the display boxes (§7 item 4).

### 2.4 Against round 1

Transitions over cases neither round marks history-dependent, forward per-case files (`aggregate-<browser>.md`), against
round 1's rows re-scored with scorer 4, which is the library change alone. Cells are pass→fail / fail→pass; sets not
listed have none. Against round 1 as scored then (scorer 3), the pass→fail and fail→pass cells are the same on every set:
the scorer change moved no cell between pass and fail (below).

| Browser | Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| Chrome | rule families | 0/38 | 0/59 | 0/138 | 24/268 |
| Chrome | feature families | 0/28 | 0/28 | 0/212 | 33/139 |
| Chrome | smoke / runs / ws / policy | 0/0 each | 0/0 each | 0/1, 0/2, 0/0, 0/0 | 1/2, 0/49, 0/18, 0/3 |
| Chrome | dev suite | 0/33 | 0/42 | 0/83 | 55/43 |
| Chrome | held-out 09-16 runs / ws / policy | 0/0 each | 0/0 each | 0/3, 0/1, 0/0 | 0/40, 0/17, 0/3 |
| Chrome | held-out 09-16 suite | 0/18 | 0/39 | 0/81 | 25/61 |
| Firefox | rule families | 0/10 | 0/34 | 0/78 | 0/0 |
| Firefox | feature families | 0/0 | 0/0 | 0/0 | 0/180 |
| Firefox | smoke / runs / ws / policy | 0/0, 0/0, 0/1, 0/0 | 0/0, 0/1, 0/2, 0/0 | 0/1, 0/8, 0/11, 0/6 | 0/0, 0/3, 0/1, 0/0 |
| Firefox | dev suite | 0/0 | 0/1 | 0/17 | 0/1 |
| Firefox | held-out 09-16 runs / ws / policy | 0/0 each | 0/1, 0/0, 0/0 | 0/8, 0/3, 0/11 | 0/3, 0/0, 0/0 |
| Firefox | held-out 09-16 suite | 0/1 | 0/1 | 0/16 | 0/0 |
| webkit-host | feature families | 0/0 | 0/0 | 0/0 | 8/206 |
| webkit-host | runs / held-out 09-16 runs | 0/0 | 0/0 | 0/2, 0/1 | 0/2, 0/1 |
| webkit-host | dev suite | 0/0 | 0/0 | 0/0 | 1/0 |

Sums, lost / gained: Chrome lineCount 0 / 117, breaks 0 / 168, widths 0 / 521, painter 138 / 643; Firefox 0 / 12, 0 / 40,
0 / 159, 0 / 188; webkit-host 0 / 0, 0 / 0, 0 / 3, 9 / 209. **No line count, break or width was lost in any browser.**

The scorer change alone, round 1's rows under scorer 3 against scorer 4: feature families move from unobserved to pass on
lineCount and breaks (Chrome 719, Firefox 670, webkit-host 701 and 697) and on widths (Chrome 1,938 plus 612 that were
not-applicable, Firefox 2,028 plus 580, webkit-host 1,805 plus 590); webkit-host gains 4 line-count and 8 break failures
that were unobserved (`rule/br-elements`); the protocol rows move to unobserved (Firefox 9 passes and 6 failures of
lineCount, webkit-host 4 and 3); 19 webkit-host width passes become unobserved where element rects join the span test.
No other set changes under the new scorer.

Every painter loss, attributed from the per-case files and rows (pair by pair in
`rebuild/lab/baselines/reseed-round2-lost-pairs.json`, §2.6):

- **Chrome, 138** (lab 81, rule families 24, feature families 33).
  - **80 on cases whose lineCount, breaks or widths passed for the first time.** Lab 47, 46 of them under a line-local gap:
    the painter draws the predicted line alone, and the lone line doesn't reshape as the paragraph did
    (`original-vs-reshaped-admission` 14, `source-shaped-arabic` 8, hanging and missing space families). Features 33, all
    `rule/text-align`: 31 extents and 2 wraps on lines whose predicted width was wrong in round 1 and agreed with the painted
    width (`c-0894a84a9478e104`: 11382 predicted and painted, 11336 natively). `NeedsAccurateEndPosition` now predicts the
    native width, and a painted line can't reproduce a line end reshaped without its hanging space (DESIGN §7,
    line_info.cc:127-175).
  - **58 with the prediction unchanged: a painter regression** (lab 34, rule families 24; 22 of them happen to have a
    line-local gap). Round 2 paints Blink's hanging spaces in their own text node, and the letter before them then paints
    with another pair adjustment: `A` before two hanging spaces in 16px Arial under letter spacing is 113 units narrower
    than in round 1's one-node form, which equalled the native width (`c-03e033cbc5d87077`). 41 pairs are 113 units
    narrower (`suite/negative-space` 28, `spacing-tail` 4, `rule/controls` 8, `following-space-scope` 1), 16
    `rule/in-word-breaks` extents 18 to 77 units narrower, and one corpus paragraph 469 units wider. DESIGN §7 names the
    class with 10 `rule/text-align` cases; the painter owner ran no suite or rule-family set. Not traced to source: open
    for the painter owner.
- **webkit-host, 9.** 8 feature `rule/atomic-inlines` extents are the painter owner's RTL `pre-wrap` lines, one float32 step
  off once the soft wrap box follows (DESIGN §7, `c-56ae197b4b7b2e5d`). `c-77a026e622496098`
  (`suite/source-views/unselected-shy-source-end`) now paints on two lines with the prediction unchanged: the same round of
  painter changes, not traced.
- **Firefox:** nothing lost.
- **Gains:** in Chrome from tab-size 0, `NeedsAccurateEndPosition` before the base direction, the `pairKerning` fact, whole
  HarfBuzz clusters in the pair window and glyph clusters by their first character; in Firefox from 8-bit runs counting as
  Latin and the legacy kern split; in webkit-host from `ctx.wordSpacing`; painter gains from slot float holders, the soft
  wrap box and painted `<wbr>` (specs/*-RESULTS.md, "ceiling round 2").

### 2.5 Against main

`rebuild/lab/baselines/main-predictor.ts` rows of 2026-09-16, scored with scorer 2, against this evaluation's forward
per-case files. Line count is the one shared metric. Cases either side marks history-dependent and protocol rows are left
out. Main never ran the held-out small sets, the families, installed Safari or the sealed sets.

| Browser | Set | Cases | Main lineCount | Rebuild lineCount | Main-only passes | Rebuild-only passes |
|---|---|---:|---|---|---:|---:|
| Chrome | smoke / ws / policy / runs | 103 / 103 / 408 / 21 | 79/24, 89/14, 397/11, 21/0 | 102/1, 103/0, 408/0, 21/0 | 0 | 23 / 14 / 11 / 0 |
| Chrome | dev suite | 19,994 | 15400/4594 | 19938/56 | 2 | 4,540 |
| Chrome | held-out 09-16 suite | 10,000 | 6369/3631 | 9916/84 | 16 | 3,563 |
| Firefox | smoke / ws / policy / runs | 101 / 103 / 408 / 21 | 85/16, 95/8, 396/12, 21/0 | 101/0, 103/0, 408/0, 21/0 | 0 | 16 / 8 / 12 / 0 |
| Firefox | dev suite | 19,760 | 17734/2026 | 19697/63 | 29 | 1,992 |
| Firefox | held-out 09-16 suite | 9,783 | 7505/2278 | 9735/48 | 26 | 2,256 |
| webkit-host | smoke / ws / policy / runs | 104 / 103 / 408 / 21 | 81/23, 88/15, 383/25, 20/1 | 104/0, 103/0, 408/0, 21/0 | 0 | 23 / 15 / 25 / 1 |
| webkit-host | dev suite | 19,858 | 15625/4233 | 19843/15 | 5 | 4,223 |
| webkit-host | held-out 09-16 suite | 9,821 | 6637/3184 | 9789/32 | 20 | 3,172 |

Chrome's main-only passes fell from 20 and 19 to 2 and 16. Where main passes a line count and the rebuild fails, the
failing line has a line-local gap in every case (§2.8).

**Main triage, refreshed.** `rebuild/lab/triage/main-<browser>.ndjson` was rewritten from the triage population's round 2
rows in both orders (`evaluate-r2/tools/triage.sh`; main's rows are this evaluation's in Chrome and the charter triage
runs' in Firefox and webkit-host; the previous records are `evaluate-r2/triage/main-<browser>.before.ndjson`):

| Browser | Rows | Records (main passes, the rebuild fails) | Facts to learn | Accidental: right count, wrong breaks | Accidental (provisional): zero-width characters | Undecided: page history |
|---|---:|---:|---:|---:|---:|---:|
| Chrome | 9,507 | 420 (charter library: 1,069) | 290 | 102 | 28 | 0 |
| Firefox | 8,603 | 587 (745) | 500 | 87 | 0 | 0 |
| webkit-host | 10,240 | 736 (736) | 657 | 68 | 7 | 4 |

- Firefox's 36 provisional accidental passes are gone: the legacy kern split passes all of them, `c-aad1cfdbd82a76b7`
  included (round 1 critic item 3).
- webkit-host's count didn't move, because round 2's WebKit work changed gap reports and one recipe, not breaks. 722 of its
  759 failing triage rows sit under `letter-spacing-ligatures` on the failing line, the class SUPERSET-webkit §3.3 leaves to
  a maintainer decision (a connected `<canvas>` with ligatures off).
- Of the triage population's prediction failures, all have a line-local gap but Chrome's one, webkit-host's one and
  Firefox's seven of the 1 au class (§2.8).

### 2.6 Gates

**Checks.** `lab/gate.ts` and `tests/gate.ts check` refuse every round 2 run against every older seed, by the environment
check (exit 2), and nothing was checked without it:

| Browser | Against the committed seeds (round 1's evaluation, pruned of protocol rows) | Against the pre-round-1 seeds (a4f23b8, `evaluate-r2/baselines-pre-r1/`) |
|---|---|---|
| Chrome | another browser build (153.0.8010.50 for .48), and scorer 4 for 3 | the same |
| Firefox | scorer 4 for 3 | the baseline recorded no process languages, and scorer 4 |
| webkit-host | `preferredLanguages` zh-CN,zh-Hans for the zh-CN round 1 took from the page, and scorer 4 | the baseline recorded no process languages, and scorer 4 |

**Seed diffs.** `evaluate-r2/tools/seed-diff.ts` seeds from the round 2 runs with the gate's own `seedBaseline`, records the
refusal, and diffs against each older seed with `diffBaselines` (history-dependent cases and protocol rows of either side
left out). Lost pairs / gained pairs:

| Seed | Against the committed seed | Against the pre-round-1 seed |
|---|---|---|
| lab gate, Chrome | 81 (painter) / 618 | 137 (painter 135, breaks 1, widths 1) / 960 |
| lab gate, Firefox | 0 / 102 | 0 / 109 |
| lab gate, webkit-host | 5 (widths 2, painter 3) / 11 | 8 (widths 3, painter 5) / 15 |
| rule families, Chrome | 24 (painter) / 562 | 68 (painter) / 776 |
| rule families, Firefox | 0 / 155 | 0 / 155 |
| rule families, webkit-host | 0 / 0 | 50 (lineCount 22, breaks 22, painter 6) / 182 |
| feature families, Chrome | 33 (painter) / 4,423 | no seed then |
| feature families, Chrome under en-US | 0 / 0 | no seed then |
| feature families, Firefox | 0 / 4,128 | no seed then |
| feature families, webkit-host | 25 (widths 17, painter 8) / 3,999 | no seed then |

No prediction pair is lost against the committed seeds except webkit-host's 19 widths, which are unobserved now: 2
`runs/word-spacing-spans` lines whose `contentWidth` sits a float32 step from the union of their boxes since the
`ctx.wordSpacing` recipe (§7 item 4), and 17 feature lines that scorer 4 alone leaves unobserved (round 1's rows re-scored
are unobserved on the same pairs). Against the pre-round-1 seeds, Chrome's break and width are round 1's bracket case
`c-9f72ec9d12c60092` with `script-context` on the failing line, webkit-host's third width is round 1's `c-d03f94e8fb53e7e2`,
and its 44 rule-family line counts and breaks are round 1's `rule/joining` losses, all with
`rtl-shaping-across-inline-boxes` on the failing line. The painter pairs are §2.4's. Every lost pair is
listed with its category, line-local gaps and attribution in `rebuild/lab/baselines/reseed-round2-lost-pairs.json`. 68
painter pairs against the committed seeds (Chrome 59, webkit-host 9) are attributed to round 2's painter changes, or in
one case to a changed prediction, and named in DESIGN §7 where a class exists, but not traced to source.

**New seeds** (`evaluate-r2/tools/reseed.sh`: `lab/gate.ts --seed` and `tests/gate.ts seed`, which refuse runs without
recorded languages or without the other order's comparison and list protocol rows apart; each new seed then checked
against its own runs with the environment check on: pass). The evaluator that was paused at 16:55 had left re-seeds of
Firefox's three baselines and webkit-host's two tests baselines in the working tree; regenerated here, they are equal
apart from their notes, and the regenerated files replace them.

| Baseline | Environment | Cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Unstable pairs |
|---|---|---:|---|---:|---:|---:|
| `lab/baselines/gate-chrome-153.0.8010.50.json` (new file; the .48 seed stays) | Chrome 153.0.8010.50, `uiLanguage` zh-CN, scorer 4 | 40,446 | 40,301 / 40,290 / 38,728 / 38,288 | 0 | 0 | 0 |
| `lab/baselines/gate-firefox-156.0.json` | Firefox 156.0, `regionalPrefsLocale` zh-hans-us, scorer 4 | 40,340 | 39,881 / 39,834 / 38,112 / 36,783 | 340 | 0 | 0 |
| `lab/baselines/gate-webkit-22625.1.29.11.27.json` | webkit-host, `preferredLanguages` zh-CN,zh-Hans, scorer 4 | 40,385 | 40,100 / 40,008 / 39,205 / 36,054 | 218 | 0 | 2 |
| `tests/baselines/chrome-153.0.8010.50.json` (new file) | as the Chrome lab gate | 10,976 | 10,810 / 10,749 / 10,455 / 10,219 | 0 | 0 | 0 |
| `tests/baselines/chrome-features-153.0.8010.50.json` (new file) | the same | 12,882 | 12,882 / 12,882 / 9,733 / 7,098 | 0 | 0 | 0 |
| `tests/baselines/chrome-en-US-features-153.0.8010.50.json` (new file) | the same with `uiLanguage` en-US | 468 | 468 / 468 / 468 / 468 | 0 | 0 | 0 |
| `tests/baselines/firefox-156.0.json` | as the Firefox lab gate | 9,584 | 9,432 / 9,200 / 8,592 / 8,048 | 0 | 0 | 0 |
| `tests/baselines/firefox-features-156.0.json` | the same | 11,946 | 11,931 / 11,931 / 8,862 / 6,425 | 0 | 15 | 0 |
| `tests/baselines/webkit-host-22625.1.29.11.27.json` | as the webkit-host lab gate | 9,584 | 9,458 / 9,376 / 8,822 / 8,382 | 6 | 0 | 0 |
| `tests/baselines/webkit-host-features-22625.1.29.11.27.json` | the same | 12,150 | 12,123 / 12,111 / 10,923 / 8,643 | 0 | 7 | 0 |

- Chrome's tests seeds say so in their notes: the family cases were derived under 153.0.8010.48 (the `build` field) and the
  runs are .50's, whose native views equal .48's on every family case in both orders; the facts file is .48's, since no
  probe set ran under .50. The per-release procedure of TESTS.md §12 (probes, derivation) hasn't run for .50.
- Firefox's lab seed holds 27 more history-dependent cases than round 1's (340 for 313), left out by rule.
- The feature seeds still hold round 1's cases with their protocol rows listed apart; deriving the features again with
  `derive.ts` `minimumUnits` is still to do (lab owner, TESTS.md §13).
- `rebuild/tests/coverage.json` was regenerated from the round 2 derivation directories against the previous matrix: no rule
  lost its last observed family (TESTS.md §8).

G0 is unchanged.

### 2.7 Installed Safari

- Plan (`evaluate-r2/tools/chain-combined.sh`): the combined files in both orders, first in webkit-host and then in installed
  Safari 27.0 with `--allow-safari-frontmost`, so both see the same document history: `dev-all` (25,180 cases after
  Safari's case filter), `families-all` (the webkit-host rule and feature families, 21,734), `heldout-all` (15,205) and
  `sealed2-all` (15,190).
- webkit-host ran all four files in both orders (16:49 to 16:54, and 17:09 to 17:30 after the pause). Forward against
  reverse, scorer 4; none has a prediction failure without a line-local gap:

  | File (cases) | lineCount | breaks | widths | painter | History-dependent | Protocol rows |
  |---|---|---|---|---|---:|---:|
  | dev-all (25,180) | 25059/25/0 | 25009/75/0 | 24639/132/238/75 | 23465/1407/212 | 96 | 0 |
  | families-all (21,734) | 21581/140/7 | 21487/234/7 | 19745/291/1458/234 | 17025/1109/3594 | 6 | 7 |
  | heldout-all (15,205) | 14999/44/0 | 14952/91/0 | 14517/177/258/91 | 12567/2285/191 | 162 | 0 |
  | sealed2-all (15,190), counts only | 15057/10/0 | 15019/48/0 | 14628/147/244/48 | 12690/2191/186 | 123 | 0 |

- **Installed Safari ran `dev-all` and `families-all` in both orders** (17:29 to 17:44; 304 s, 259 s, 105 s and 106 s; every
  row recorded the page as hidden; Google Chrome was frontmost). Round 1 stopped after 1,585 rows. Its scores equal
  webkit-host's in every cell of both files and both orders, painter included, and it has no prediction failure without a
  line-local gap. Case by case with the same document history on every row (`evaluate-r2/safari-vs-host-*.json`): all 25,180
  and all 21,734 native views are equal in both orders (every rect's x, width and native line), all predictions are equal
  (layout, Canvas call counts and expected observation), and the two mark the same cases history-dependent (96 and 6).
  This is the first time the rule and feature families ran in installed Safari.
- **`heldout-all` in file order failed**, so by the brief the Safari work stopped there: its reverse order and both orders
  of `sealed2-all` never ran in installed Safari. The job wrote 7,863 of 15,205 rows and ended with "No page activity for
  600000ms". Those 7,863 rows equal webkit-host's native views and predictions case by case
  (`safari-vs-host-heldout-all-forward-partial.json`).
- Diagnosed, not fixed. The WebContent process stopped three times at 0% CPU: about 18:01 (it went on at 18:03 when the
  window became visible: rows 3,063 to 3,709 record `visible`), about 18:09 and at 18:14:45 for good. The lab's hold, a
  title change that gives the page a background activity until the next commit, covers a hidden page only until WebKit
  drops every activity. Two source paths do that for a busy hidden page:
  - a WebContent process without a visible page has its CPU use averaged over 8 minutes against the client's limit
    (`cpuMonitoringInterval`, WebProcessCocoa.mm:220, :1180-1205), and past it the UI process suspends it on the Mac with
    `invalidateAllActivitiesAndDropAssertion` (`WebProcessProxy::didExceedCPULimit`, WebProcessProxy.cpp:2360-2395).
    Visibility changes restart the window. The page then keeps its invalid activity until the next commit
    (`didReceiveTitleForFrame` makes a new one only when none is held, WebPageProxy.cpp:9266-9268), so a later title change
    wouldn't bring it back;
  - after that, a hidden page is an ordinary one: about 20 s to prepare and 4 minutes of near-suspended assertion
    (`processSuspensionTimeout`, `removeAllAssertionsTimeout`, ProcessThrottler.cpp:49-50), which matches the second stop
    about 5 minutes after the window was covered again.

  The four jobs that finished each took under 8 minutes. `heldout-all` runs one case per round trip and starts with corpus
  paragraphs that take about 5 minutes each in a hidden Safari page (73 s in webkit-host, which sets no CPU limit). Safari's
  own log lines weren't available afterwards, so the first path is a source reading that fits the timing, not a verified
  cause. A fix belongs to the lab owner: keep each installed Safari job, or each WebContent process, under the 8-minute
  window (parts in fresh tabs), or keep the lab window visible.
- So this round's installed Safari evidence covers the development and family files in full and half of the held-out file
  in one order. The charter evaluation's full development and held-out comparison is in REPORT.md at a4f23b8, §2.7.

### 2.8 Open model bugs, residual classes and weak coverage

The round 2 definition: a failing row is covered only when a gap condition fires on the failing line itself or on the break
decision that ended the line before it, and the condition's source reading says the prediction can be wrong there. A
paragraph-level gap elsewhere doesn't cover a line. A protocol row is excluded from pass and fail alike. A failure class
that a probe verified as a Canvas-versus-DOM difference no Canvas measurement can detect is a residual class, reported
with its evidence: not an open model bug, and not hidden under an unconditional gap.

Prediction failures (lineCount, breaks or widths) with a failing line no gap concerns, forward runs outside history
dependence and protocol rows; painter-only failures without a line-local gap in parentheses. Sealed-2 is counts only.

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed-2 | Triage | Fresh runs (10,319 cases) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Chrome | 0 (75) | 0 (310) | 0 (72) | 0 (41) | 0 (30) | 1 (56) | 6 of 48 failing |
| Firefox | 0 (0) | 0 (41) | 8 cases (191) | 6 (121) | 8 (131) | 7, the development suite's (8) | 7 of 160 failing |
| webkit-host | 0 (137) | 0 (0) | 0 (629) | 0 (646) | 0 (617) | 1 (252) | 0 of 475 failing |

webkit-host's four combined files (§2.7) have none either, and neither have installed Safari's two.

**Residual class, Gecko: one shaping unit 1 app unit off** (probe F7, specs/gecko-RESULTS.md). All 14 development and
held-out cases, traced node by node against the observation port's predicted node rects
(`evaluate-r2/tools/trace-open.py`, `gaps/firefox-open-traces.json`):

- each passes lineCount and breaks and has exactly one node rect whose width differs, by exactly 1 au; rects after it on
  the line shift by that unit;
- that rect holds one of F7's three probed strings: `ووفقك` in 10px Geeza Pro (DOM +1 au: `c-268ee59b15a407a8` in smoke and
  runs, `c-02e7d131f09e05b9`, `c-d575ffd182517ddc`, `c-e05daec9b21bfc36`), the Thai run in 32px Thonburi at weight 500 (+1:
  `c-78c9f151226956de`, `c-79f342df6e23e13a`, `c-f52cf560ae801fed`), and `modern` in the 15px Helvetica Neue
  `maintained/accuracy` paragraph, where the failing line is the one holding that word in all seven widths (−1:
  `c-13c64a6ce641374d`, `c-4ef8468b2da9da78`, `c-63eacc35cdaf8190`, `c-6db6b7fcb792a90b`, `c-8f9cd18c645671da`,
  `c-b7937baf8304f3fd`, `c-fcbb3bc755b5a5e8`, which are also the triage population's 7);
- the painter, which draws the predicted line with the DOM, paints the failing line at the native width in all 15 rows, so
  the same content measures 1 au apart in the DOM and in Canvas;
- F7 measured those strings in their own node: DOM 1173 au, OffscreenCanvas 1172, `<canvas>` element 1174; 16899, 16898,
  16900; 3118, 3119, 3118. The DOM rounds each glyph's 16.16 advance at the device size to app units
  (gfxHarfBuzzShaper.cpp:354-379, :1262-1263, :1699-1702), and no Canvas shows a glyph's sub-unit fraction. A condition
  would have to fire on every shaping unit at DPR 2, so the layout reports none.
- Sealed-2, counts only (`sealed-residual.ts`): 5 of the 8 rows have this signature (widths only, one node rect, exactly
  1 au, painted at the native width). The fresh runs sets add 5 rows with it, in two strings F7 didn't probe
  (`LT: kerning pairs` in bold 10px Helvetica Neue, −1; an Arabic run in 10px Geeza Pro at weight 500, +1).
- Status in ceiling round 3's fix phase (specs/gecko-RESULTS.md "Ceiling round 3", the owner's forward runs, not evaluated
  yet): the class is reproduced. A detached `<canvas>` element whose font size is the DOM's device size has the page's app
  units per device pixel and the DOM's font cache (CanvasRenderingContext2D.cpp:4256-4269, :7132-7155), and its width
  × apd equals the DOM's node width on 243 of 243 probed units, among them all 14 where the OffscreenCanvas is 1 au off,
  the `LT:` and weight 500 strings included (probe F13). F7's `<canvas>` element was at the CSS size. The Gecko port
  measures there now, and the class has 0 members on the development, held-out and family sets and on 15 fresh sets
  (245,231 cases). The mechanism is verified by simulation for `modern` (the `n` after the kern split is 508.4999 au at
  the DOM's scale and 508.5004 au at Canvas's); the Geeza Pro and Thonburi members are reproduced by measurement only.

**Open, Gecko: a heart after a keycap mark, split across spans, 7 au narrower natively.** The other 3 sealed-2 rows fail
widths only, with two node rects each 8 au narrower natively than predicted and the line painted at the native width: not
the 1 au signature, and no development or held-out row has it. The set stays sealed, so the evaluation generated four
fresh development runs sets and looked there: `c-a2661c5b12f20aec` and `c-e69a2cc0039e247a` (`runs/split-word`,
`fresh-runs-1`) hold the node `⃣❤` (U+20E3 U+2764, the middle of `1️⃣❤️` split across spans, its U+FE0F in the next span)
in bold 14px Helvetica Neue: 786 au natively, 793 predicted, no gap on the line, and `bitmap-emoji-size` doesn't fire.
7 au at 14px and 8 au at 16px are the same share of the font size, so the sealed rows are probably this class, which
can't be confirmed without opening them. Not probed: whether Canvas can see the difference decides between a port bug and
a gap condition that is too narrow. Open for the Gecko owner. On the four fresh sets Firefox has 160
prediction-failing cases of 10,319 and 7 without a line-local gap: these 2 and the 5 with the 1 au signature.
Status in ceiling round 3's fix phase: it is synthetic bold. The heart comes from a fallback font without a bold face, and
`GetSyntheticBoldOffset` is 0.25 + 0.75 × size / 48 device px below 48px (gfxFont.h:1899-1904), rounded per glyph at the
apd: 21 au at the DOM's 28 device px, 28 au at Canvas's 14px. Probe F14: DOM 786 au, OffscreenCanvas 793, the canvas
element at the device size 786, and equal on 126 of 126 rows. Predicted since the port measures on that element; whether
the sealed-2 rows are this class stays unknown.

**Open, Blink: six fresh runs rows, two classes.** Chrome has no failure without a line-local gap on the development,
held-out and sealed-2 runs sets (7,738 cases), and 6 of 48 failing on the fresh ones (10,319 cases;
`evaluate-r2/fresh/chrome-open.json`), all in Geeza Pro with only `engine-build` or gaps of other lines reported:

- an ideographic space inside an Arabic run under letter and word spacing (`runs/word-spacing-spans`: `c-45d738663a9704be`,
  `c-5ad7c3e3754f4363`, `c-e2fe65814d7d218e` with letter spacing −1px and word spacing 2px, `c-aa48ec15a2622076`,
  `c-b685f6ae4e4793e1` with 1px and 4px): the native nodes are off by whole letter spacings around the U+3000s (1px wider
  under −1px with one of them; 2px and 1px narrower under 1px on a line holding two, one of them at its end), and one case
  breaks elsewhere for it. It looks like the ideographic space taking no letter spacing inside a cursive run natively while
  its Canvas string takes it; `script-context` covers the same texts on a held-out row
  (`c-522324a27e5bb6bd`) and doesn't fire here. Not traced;
- `c-4a04b13ad0ab4062` (`runs/letter-spacing-spans`, a join across a span edge under −2px letter spacing): 296 units move
  between the two nodes and the line is 1 unit off.

**Open, Blink: `c-8c84627af834611f`** (triage, `suite/mixed`, Shantell Sans with −1px letter spacing, `break-word`): `{`
stays on line 1 natively and the prediction moves it to line 2. Only `engine-build` is reported, on the paragraph. The
Blink owner found a −45-unit kern and a same-advance glyph swap in hb-shape and no source reading that explains the line.

**Open, WebKit: `c-66ae4ab7d56cb0ae`** (triage, `suite/physical-window-terminal-seam`, `aאבaabb((بببب` then two tabs and
`word` in 24px Amiri, RTL, 24px wide): 10 native lines in both orders of the triage run, 11 predicted; `page-history` sits
on line 4 and the failing line is 6. Alone in a fresh webkit-host process (`evaluate-r2/isolate/webkit-host-c66`) it has 11
native lines and passes lineCount, breaks and widths. So the native lines depend on page history that both orders share,
which the two-order protocol can't see, and the `page-history` condition doesn't reach the line it moves. Open for the
WebKit owner as a condition that is too narrow, and for the lab as an isolation protocol (TEST-ARCHITECTURE §6.5).

**Open, Blink, outside the four metrics: positions inside shaped words reported as exact** (§2.2). 2,030 development cases
that pass lineCount, breaks and widths hold a predicted code point x or width that differs from the browser, inside joined
Arabic words and Latin ligatures, where round 1 marked the value limited by `in-word-prefix`. The narrowed gap is right for
break decisions; the engine-true geometry of those clusters still comes from Canvas prefix widths, which can't give it, and
nothing reports that (tentpoles 1 to 3). It needs its own range on the layout, or a port of the cluster positions.

**Protocol rows:** Firefox 15 and webkit-host 7 feature rows (`rule/line-slots`, the round 1 critic's 22), unobserved on
every metric and listed apart in the seeds. Derivation's new width floor produces none (lab owner); the evaluation ran
round 1's case files.

**Weak coverage.** Prediction failures whose failing lines are covered only by gaps with a lift below 2 in their group
(`gaps/*.json` `weakOnly`; sealed-2 from `sealed-weak.ts` with the development group's weak set):

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed-2 | Triage |
|---|---|---|---|---|---|---|
| Chrome | 0 of 457 | 0 of 0 | 2 of 95 | 9 of 205 | 4 of 184 | 34 of 454 |
| Firefox | 20 of 992 | 0 of 0 | 0 of 1,013 | 0 of 877 | 0 of 938 | 0 of 653 |
| webkit-host | 153 of 493 | 0 of 32 | 201 of 210 | 261 of 261 | 152 of 195 | 25 of 759 |

- The definition's second half is a source reading, not a lift, so the evaluation read samples
  (`evaluate-r2/tools/sample-weak.py`): webkit-host `canvas-language` alone (116 development and 105 held-out cases, 156
  of them `runs/lang-spans`): every sampled failing line holds text whose font the box's locale chooses, a CSS generic
  family or a Han, kana or Hangul fallback, which an OffscreenCanvas without a locale can't follow (WebKit probe,
  FontDescriptionCocoa.cpp:77-118); `page-history` alone: level boundaries in RTL paragraphs (`بِبِ((` in Amiri, the kind of
  text the round 1 critic ran alone in a fresh process and saw pass); `letter-spacing-ligatures` alone: `di` and `of`
  pairs in Shantell Sans under letter spacing (probed); `tab-stops` alone: widths one float32 step off on a line with a
  tab, a condition that says it is unprobed; Chrome `script-context` alone: Common or Inherited characters next to
  Arabic, or a mark after a space in Arial; Firefox `font-fallback` alone: `中-` before an emergency break in Arial and
  Georgia (gfxFont.cpp:741-753, probe F10 found no Canvas signal). Each condition cites source, and its range meets the
  failing line. None was contradicted.
- What the samples can't show is that the named difference is the cause. `script-context` fires on 76% of Chrome's
  development cases and `canvas-language` on 45% of webkit-host's, so their presence on a failing line says little. For
  webkit-host almost every prediction failure rests on such a condition. Narrowing them needs inputs Canvas doesn't give
  (a font fact for script-specific lookups, the family a locale realizes, a ligature table or a connected `<canvas>`,
  SUPERSET-webkit §3.3), which is a decision, not a port bug.

**Painter-only failures without a line-local gap** are painting form, not prediction: the prediction metrics pass. The
largest groups: Chrome feature `rule/text-align` 218 and `box-edges` 72, development `suite/negative-space` 58 (28 of
them the hanging-space regression of §2.4); Firefox `suite/skin-modifier/zwsp` and `woman-after-zwj/zwsp` 42 each, feature
`rule/text-align` 32; webkit-host `suite/U+200D/middle` 60, `U+2060/middle` and `U+FEFF/middle` 48 each, rule `joining` 87,
triage `raw-context` 159. `paint` still reports no painter limit per line, so they aren't attributed case by case.

By this definition:

- **Chrome:** no open model bug on the rule families, feature families in both languages, development, held-out 09-16 or
  sealed-2 sets; 1 in the triage population and 6 on the fresh runs sets, in two classes nobody had seen. Open beside the
  definition: in-word positions reported as exact, and the painter's hanging-space regression.
- **Firefox:** no open model bug on the rule and feature families. Every development, held-out and triage failure without a
  line-local gap (8, 6 and the same 7) is the 1 au residual class, verified node by node. Open: the heart after a keycap
  mark (2 fresh runs rows, and probably the 3 sealed-2 rows outside the 1 au signature).
- **webkit-host and installed Safari:** no open model bug on any scored set, the fresh runs included, but 1 in the triage
  population, where `page-history` is too narrow. Its coverage is the weakest of the three: almost every failure rests on a condition that
  also fires on a large share of passing cases.
- **The fresh sets matter for the verdict:** zero on sets the owners iterated on, and on one sealed set, didn't mean zero.
  10,319 new styled-run cases found two Blink classes and one Gecko class without a gap.

## 3. Costs

measureText calls per paragraph, mean, from the forward runs, with round 1's in parentheses. WebKit's counts are
webkit-host's.

| Engine | rule families | feature families | smoke | runs | ws | policy | dev suite: mean / median / p95 / max | held-out 09-16 suite | sealed-2 suite |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Blink | 39.4 (32.1) | 42.5 (34.9) | 94.5 (79.1) | 141.6 (123.2) | 87.2 (72.4) | 98.7 (79.8) | 85.0 / 29 / 260 / 21,837 (73.5 / 21 / 224 / 20,846) | 168.4 / 16 / 46 / 188,831 (160.7 / 11 / 34 / 188,721) | 83.2 / 16 / 45 / 172,204 |
| Gecko | 20.0 (17.3) | 21.8 (21.2) | 72.9 (49.8) | 97.7 (66.7) | 57.9 (38.1) | 84.5 (51.1) | 63.4 / 20 / 195 / 30,781 (41.6 / 17 / 120 / 26,613) | 82.2 / 6 / 35 / 42,738 (67.1 / 4 / 24 / 41,128) | 64.5 / 6 / 34 / 42,326 |
| WebKit | 8.1 (7.3) | 10.2 (9.1) | 22.3 (18.6) | 33.1 (25.1) | 22.9 (18.0) | 20.7 (17.5) | 15.2 / 6 / 40 / 2,069 (13.4 / 6 / 38 / 2,059) | 21.4 / 5 / 13 / 20,279 (20.6 / 5 / 9 / 20,279) | 11.4 / 5 / 12 / 9,935 |

- Every engine's calls rose in round 2: Blink by 15% to 24% on the small sets (pair windows over whole clusters, the
  no-ligature pair test and its look-ahead), Gecko by 46% to 65% on runs, ws and policy (the ligature test at consulted
  in-word offsets and the kern split's prefix measurement), WebKit by 11% to 32% (the line-local conditions and
  `ctx.wordSpacing` contexts). Recorded only (tentpole 8).
- The sealed-2 runs, ws and policy sets: Blink 137.4, 87.4 and 100.4 calls; Gecko 91.5, 55.7 and 84.5; WebKit 31.8, 23.8 and
  20.2.

Prediction time summed over the forward runs, with round 1's in parentheses, and the observation port's time:

| Browser | dev suite predict | held-out 09-16 suite predict | sealed-2 suite predict | dev / held-out / sealed-2 suite observe |
|---|---|---|---|---|
| Chrome | 10.0 s (10.7 s) | 37.5 s (295.9 s) | 15.2 s | 0.5 / 36.9 / 15.4 s |
| Firefox | 14.7 s (14.1 s) | 48.5 s (48.3 s) | 62.3 s | 0.2 / 0.4 / 0.2 s |
| webkit-host | 2.0 s (1.6 s) | 4.0 s (3.7 s) | 1.5 s | 10.4 / 132.5 / 34.3 s |

- Chrome's held-out prediction fell from 296 s to 37 s: `HanKerning::MayApply` counts once per paragraph instead of scanning
  the group at every position (Blink owner, outputs byte-equal). The corpus paragraphs still take most of it.
- Firefox's and WebKit's timers report whole milliseconds.

Lab time for every per-browser set in both orders, both family groups included, without the triage and combined files:
Chrome 513 s (held-out suite 235 s, sealed-2 suite 101 s), Firefox 505 s (146 s, 153 s), webkit-host 1,257 s (804 s, 256 s).
A hidden installed Safari page runs the long rows about four times slower than webkit-host (§2.7).

The largest rows are 131 MB in Chrome and about 134 MB in Firefox, for the 269,747-unit held-out paragraph.

Library lines at bc49b0e, without tests and generated data (counted as in round 1):

| Module | Lines | Test lines |
|---|---:|---:|
| `model` / `env` / `index` / `engine` | 926 | |
| `content.ts` | 101 | 59 |
| `paint.ts` | 489 | |
| `measure/` | 110 | |
| `unicode/` | 1,468 | 491 |
| `breaks/` | 506 | 172 |
| shared total | 3,600 | |
| `engines/blink` | 5,055 | 673 |
| `engines/webkit` | 4,953 | 730 |
| `engines/gecko` | 4,331 | 814 |
| **total** | **17,939** | **2,939** |

Round 1's total was 17,173 (2,730 test lines). Around the library: the observation ports, 1,138 lines (511 test lines).

Generated data: `blink-break-tables.ts` gained the `IsCjkIdeographOrSymbol` ranges in round 2 (`tools/gen-blink-data.ts`,
from character_property_data.h and ICU 78.2's emoji data); the rest is unchanged.

Tests at bc49b0e with the round 2 seeds: `bun test rebuild/src` 241 tests in 15 files (10.0 s); `bun test rebuild/lab` 219
in 12; `bun test rebuild/tests` 36 in 8; `bunx tsc` over the three projects clean.

## 4. Canvas-versus-DOM gaps, how often they fired

Forward runs, cases outside history dependence and protocol rows (`gaps/<browser>-{families,features,dev,heldout,triage}.md`
and `gaps/section4-tables.md`; the sealed-2 set from its counts-only files). For each gap: reports, all-pass, fail (any
metric), prediction fail (lineCount, breaks or widths), lift (its share of failing cases divided by its share of all-pass
cases) and the prediction-failing cases where it sits on a failing line or the line before. **Weak** means a lift below 2
in all three groups. Cells are development / held-out 09-16 / sealed-2.

Blink (development 25,498 cases, held-out 09-16 15,205, sealed-2 15,190; prediction-failing 95 / 205 / 184):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift | Covers a failing prediction line |
|---|---|---|---|---|---|---|
| `engine-build` | 25,498 / 15,205 / 15,190 | 24,494 / 14,007 / 13,993 | 358 / 430 / 397 | 95 / 205 / 184 | 1 / 1 / 1, **weak** | 0 / 0 / 0 |
| `script-context` | 19,394 / 10,439 / 10,366 | 18,476 / 9,294 / 9,220 | 275 / 380 / 350 | 86 / 196 / 176 | 1.02 / 1.33 / 1.34, **weak** | 86 / 196 / 175 |
| `glyph-clusters` | 3,953 / 2,686 / 2,777 | 3,158 / 1,810 / 1,871 | 156 / 122 / 117 | 58 / 72 / 64 | 3.38 / 2.2 / 2.2 | 55 / 69 / 58 |
| `unsafe-to-break` | 1,523 / 1,534 / 1,528 | 847 / 805 / 793 | 96 / 101 / 85 | 48 / 58 / 48 | 7.75 / 4.09 / 3.78 | 46 / 52 / 43 |
| `in-word-prefix` | 724 / 342 / 311 | 717 / 311 / 286 | 7 / 30 / 25 | 6 / 26 / 21 | 0.67 / 3.14 / 3.08 | 5 / 17 / 14 |
| `font-fallback` | 697 / 330 / 345 | 507 / 178 / 189 | 120 / 152 / 156 | 52 / 150 / 156 | 16.19 / 27.82 / 29.09 | 52 / 150 / 155 |
| `soft-hyphen-shaping` | 434 / 1,235 / 1,265 | 424 / 1,192 / 1,227 | 10 / 43 / 38 | 10 / 42 / 38 | 1.61 / 1.18 / 1.09, **weak** | 7 / 31 / 27 |
| `tab-stops` | 250 / 561 / 574 | 243 / 547 / 564 | 2 / 2 / 4 | 1 / 0 / 1 | 0.56 / 0.12 / 0.25, **weak** | 1 / 0 / 1 |
| `han-kerning` | 228 / 274 / 286 | 215 / 250 / 269 | 13 / 24 / 17 | 0 / 0 / 0 | 4.14 / 3.13 / 2.23 | 0 / 0 / 0 |
| `control-character-width` | 127 / 244 / 254 | 120 / 217 / 219 | 1 / 1 / 2 | 0 / 1 / 1 | 0.57 / 0.15 / 0.32, **weak** | 0 / 1 / 1 |

- `engine-build` is new: installed Chrome is 153.0.8010.50 and the library pins .48. It sits on the paragraph without a
  range, so it covers no line.
- `in-word-prefix` fell from 13,638 development reports to 724 and `control-character-width` from 970 to 127 (VT and FF
  only). `script-context` still fires on 76% of the development cases and sits on the failing line of 86 of the 95
  prediction failures; it alone covers 1 development, 9 held-out and 32 triage failures.
- Rule families add `optical-size` (968 reports, lift 1.78) and `page-history` (320, lift 3.58).

Gecko (development 25,267 cases, held-out 09-16 14,988, sealed-2 15,068; prediction-failing 1,013 / 877 / 938):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift | Covers a failing prediction line |
|---|---|---|---|---|---|---|
| `in-word-prefix` | 6,105 / 4,143 / 4,062 | 4,657 / 3,023 / 2,920 | 1,448 / 1,120 / 1,142 | 995 / 856 / 920 | 4.06 / 3.51 / 3.57 | 989 / 853 / 919 |
| `glyph-clusters` | 2,764 / 2,220 / 2,185 | 2,575 / 1,899 / 1,856 | 189 / 321 / 329 | 16 / 57 / 43 | 0.96 / 1.6 / 1.62, **weak** | 15 / 55 / 42 |
| `font-fallback` | 42 / 114 / 128 | 39 / 113 / 124 | 3 / 1 / 4 | 0 / 0 / 0 | 1.01 / 0.08 / 0.29, **weak** | 0 / 0 / 0 |
| `bitmap-emoji-size` | 35 / 49 / 35 | 20 / 26 / 25 | 15 / 23 / 10 | 15 / 18 / 10 | 9.8 / 8.38 / 3.66 | 15 / 18 / 10 |
| `page-history` | 4 / 9 / 9 | 2 / 8 / 7 | 2 / 1 / 2 | 0 / 0 / 0 | 13.07 / 1.18 / 2.61 | 0 / 0 / 0 |
| `space-in-shaping` | 0 / 14 / 6 | 0 / 14 / 5 | 0 / 0 / 1 | 0 / 0 / 1 | – / 0 / 1.83, **weak** | 0 / 0 / 1 |

- `ui-language` no longer fires: `regionalPrefsLocale` is used for `lang=""` runs (round 1: 10 / 14 reports).
- Rule families add `optical-size` (954 reports, lift 4.73) and `font-size-quantization` (392, every one failing);
  `font-fallback` alone covers 20 `rule/hyphen-classes` failures there (lift 1.7).
- `in-word-prefix` covers 989 of the 1,013 development prediction failures, 974 of them alone: nearly every Firefox width
  failure is a break inside a joined or kerned word.
- Status in ceiling round 3's fix phase (the owner's forward runs under scorer 5, specs/gecko-RESULTS.md; this table is
  round 2's): firing on passing development lines went from 12.00% to 4.24% for `in-word-prefix` (failing lines 98.79% →
  99.78%), 9.90% to 0.01% for `glyph-clusters` and 0.06% to 0.01% for `font-fallback`; `bitmap-emoji-size` and
  `optical-size` aren't reported on the canvas element; `page-history` was widened to every U+FFFD and to the emoji
  font-matching state and went from 0.01% to 0.26%, with a lift of 0.85 on the development sets. Development prediction
  failures fell from 1,013 to 457, all covered; 394 of the 450 failing suite-sample cases are the invisible-character
  families' joined beh letters in 16px Amiri around a soft hyphen, whose two sides measured with U+200D don't add up to the
  unit.

WebKit, webkit-host (development 25,356 cases, held-out 09-16 15,069, sealed-2 15,067; prediction-failing 210 / 261 / 195):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift | Covers a failing prediction line |
|---|---|---|---|---|---|---|
| `canvas-language` | 11,462 / 2,774 / 2,799 | 11,053 / 2,406 / 2,507 | 339 / 338 / 264 | 175 / 169 / 117 | 0.51 / 0.76 / 0.61, **weak** | 175 / 169 / 117 |
| `simplified-measuring` | 5,033 / 2,103 / 2,180 | 4,719 / 1,854 / 1,977 | 236 / 190 / 149 | 20 / 28 / 19 | 0.83 / 0.55 / 0.43, **weak** | 16 / 24 / 12 |
| `page-history` | 3,756 / 2,492 / 2,486 | 3,438 / 2,067 / 2,131 | 250 / 389 / 317 | 89 / 129 / 90 | 1.2 / 1.02 / 0.86, **weak** | 65 / 106 / 78 |
| `letter-spacing-ligatures` | 2,523 / 1,939 / 1,895 | 2,392 / 1,647 / 1,659 | 112 / 254 / 211 | 18 / 24 / 17 | 0.77 / 0.83 / 0.73, **weak** | 18 / 24 / 17 |
| `control-character-width` | 1,192 / 3,793 / 3,873 | 931 / 2,785 / 2,802 | 257 / 995 / 1,061 | 4 / 51 / 42 | 4.56 / 1.93 / 2.18 | 4 / 51 / 42 |
| `tab-stops` | 245 / 550 / 563 | 230 / 498 / 515 | 11 / 40 / 39 | 3 / 10 / 6 | 0.79 / 0.43 / 0.44, **weak** | 3 / 10 / 6 |
| `string-storage` | 115 / 131 / 130 | 89 / 103 / 103 | 26 / 26 / 26 | 0 / 0 / 0 | 4.82 / 1.36 / 1.45 | 0 / 0 / 0 |
| `dictionary-breaks-stand-in` | 18 / 13 / 12 | 13 / 10 / 9 | 5 / 3 / 3 | 2 / 0 / 1 | 6.35 / 1.62 / 1.92 | 2 / 0 / 1 |
| `rtl-shaping-across-inline-boxes` | 6 / 3 / 6 | 2 / 2 / 4 | 3 / 0 / 0 | 3 / 0 / 0 | 24.76 / 0 / 0 | 3 / 0 / 0 |

- `page-history` fell from 5,367 development reports to 3,756 and now follows the break position cache's key; its lift is
  1.2 on development, 3.57 on rule families and 31 on feature families. `canvas-language` doubled (5,743 to 11,462) with
  the corrected reading that CSS generic families resolve by locale (FontDescriptionCocoa.cpp:77-118): it fires on 45% of
  the development cases.
- Every webkit-host gap that covers many failures is weak: 201 of the 210 development prediction failures, all 261 held-out
  ones and 152 of the 195 sealed-2 ones are covered only by weak gaps (§2.8).
- Rule families add `fixed-pitch-path` (348 reports, lift 1.84) and `rtl-shaping-across-inline-boxes` (292, lift 15.98).

Not reported on the development, held-out and sealed-2 sets: `page-zoom`, `float32-precision`, `font-size-quantization`,
`dictionary-breaks-unavailable`, `joining-technology`, `hyphen-glyph`, `fixed-pitch-path`, `optical-size` and `ui-language`.

## 5. Verified in installed browsers, and only from source

Verified on 2026-09-17:

- **Installed Chrome 153.0.8010.50**: every rule family, feature family (with the `process-languages` family again under
  en-US), development, held-out 09-16, sealed-2, triage and fresh runs case in both orders, predicted with the ceiling
  round 2 library and scored against Blink's observation port. Its native views equal 153.0.8010.48's of round 1 on every
  case both rounds ran.
- **Installed Firefox 156.0**: the same without the en-US round, against Gecko's port.
- **webkit-host on WebKit 22625.1.29.11.27**: the same, and the four combined files, against WebKit's port.
- **Installed Safari 27.0**: the combined development file (25,180 cases) and the combined rule and feature families file (21,734)
  in both orders, and 7,863 of the held-out file's 15,205 cases in file order before its page stopped, all equal to
  webkit-host's native views and predictions case by case (§2.7).
- The probe facts in `rebuild/facts/` still come from the 2026-09-16 probe runs. Round 2's owner probes (Blink r2, Gecko F7
  to F12, the painter's three-browser probes) are in the RESULTS files and not in the facts files, and no probe set ran
  under Chrome 153.0.8010.50.

From source or inference only:

- vertical metrics: `y` and `height` are outside the observation contract, and native lines across nodes come from
  vertical-centre grouping;
- slot cases: floats are checked against their rows by rule, but not line boxes taller than the line height;
- `<wbr>` rects in WebKit;
- why a hidden installed Safari page stops: read from WebProcessProxy.cpp and WebProcessCocoa.mm, not from Safari's logs
  (§2.7);
- WebKit's full preferred-language list and ICU default locale beyond the first entry, and Chrome's accept languages for
  text without `lang`; only Chrome was observed under a second locale;
- page zoom in all browsers, a physical DPR 1 display, and forced DPR 1 or other app-unit families;
- the observation ports' rules, checked only through native rects: the rows reproduce 93.4% to 99.95% of predicted values
  (§2.2);
- whether Canvas can see Gecko's heart-after-keycap difference (§2.8; answered in ceiling round 3: a canvas element at the
  device size does, probe F14), and the Blink triage case `c-8c84627af834611f`;
- Chrome 153's element.cc and locale_settings_mac.grd citations, still read at 152.

## 6. Known remaining failure classes

Family counts come from `gaps/<browser>-{families,features,dev,heldout,triage}.md`, cases failing each metric. Sealed-2
failures are counts only.

Blink:

- **U+FFFC**, drawn with a fallback glyph (`font-fallback`, lift 16 to 29). Held-out `U+FFFC/{start,middle,end}` fail 16 to
  22 of 46 line counts each and nearly every painter case; the rule family `object-replacement` fails 132 of 348 line
  counts.
- **Arabic at shaping edges** (`unsafe-to-break`, `glyph-clusters`): held-out `source-shaped-arabic` 3 of 46 line counts;
  the triage population's `unsafe-to-break` covers 294 failing rows.
- **Characters that take a neighbour's script** (`script-context`): alone on 1 development, 9 held-out and 32 triage
  failures (`chromium-script-spacing`: a mark after a space).
- **System fonts and sizes** (`optical-size`): rule family `system-fonts-and-sizes` fails 8 of 660 line counts and 40 widths.
- **In-word positions in joined and ligated words**, reported as exact and wrong in 2,030 development cases that pass the
  metrics (§2.2).
- **Painter:** the hanging-space regression (58 lost pairs, §2.4); `rule/text-align` 218, `box-edges` 72 and
  `nested-box-edges` 18 painter failures without a line-local gap; a line painted alone doesn't reshape as the paragraph did.
- **Triage:** `c-8c84627af834611f` without a gap (§2.8).

Gecko:

- **Breaks inside joined or kerned words** (`in-word-prefix`, lift 3.5 to 4.1): 989 of the 1,013 development prediction
  failures. The invisible-character families fail up to 4 line counts and 31 to 44 widths of 196 each;
  `original-vs-reshaped-admission` 11 of 42 line counts; held-out `joined`, `joined-plain` and C0 controls before joined
  Arabic.
- **System fonts and sizes** (`optical-size`, `font-size-quantization`): rule family `system-fonts-and-sizes` fails 60 of
  680 line counts and 284 widths; `joining` 56 of 736 and `fit-bound` 19 of 360.
- **Device-size emoji** (`bitmap-emoji-size`), and the heart after a keycap mark that it doesn't reach (§2.8, open).
- **Residual: one shaping unit 1 au off** (§2.8).
- Status in ceiling round 3's fix phase, not evaluated yet (specs/gecko-RESULTS.md "Ceiling round 3"): the two classes
  above and `optical-size` are predicted through the canvas element at the device size; `font-size-quantization` stays
  (the element keeps 7 significant bits too) and costs 24 `system-fonts-and-sizes` cases that passed by accident. Left
  under `in-word-prefix`: joined letters whose sides don't add up (Amiri, Noto Nastaliq Urdu), odd kern ties, marked
  ligature groups in fonts that aren't OpenType-shaped. New: a cluster split between its marks across spans in Geeza Pro
  gives an unbounded frame natively (probe F18, untraced; 3 held-out and 6 fresh rows, counted covered by
  `in-word-prefix`); fresh set 15's open class, a tab after a frame that starts inside a cluster; 30 passing suite cases
  with a wrong predicted value (Myanmar U+1038, a Noto Nastaliq in-word position), and on some fresh sets about 100 more
  under the emoji `page-history` range, which the port doesn't limit.
- **Painter:** development suite 1,646 painter failures, most on lines that fail widths; `text-align` justify with a trimmed
  space 32 (DESIGN §7).
- **History dependence:** development 123, held-out 09-16 217, sealed-2 122 cases, all in the suite samples.

WebKit:

- **Fonts chosen by language** (`canvas-language`): `runs/lang-spans` fails 9 line counts, 50 breaks and 76 widths of 373 in
  development, and 8, 39 and 96 of 359 held-out; `policy/zh-lang`.
- **Ligatures under letter spacing** (`letter-spacing-ligatures`): 722 of the triage population's 759 failing rows
  (`ligature-thresholds-v3` and its kind), and `runs/letter-spacing-spans`.
- **C0 controls inside a word** (`control-character-width`): held-out `U+000B` and `U+001C` to `U+001F/middle` fail 2 to 5
  line counts each; rule family `controls` 24 of 336.
- **RTL shaping across inline boxes**: the rule family `joining` fails 62 of 752 line counts.
- **`<br>` after preserved white space** (`page-history`, `tab-stops`): feature `br-elements` fails 20 line counts and 32
  breaks, which pass alone in a fresh document (WebKit owner).
- **Page history the two-order protocol can't see:** `c-66ae4ab7d56cb0ae` (§2.8, open).
- **Widths unobserved** in 243 development, 261 held-out and 244 sealed-2 cases (§7 item 4).
- **Painter:** development suite 1,015, held-out suite 1,867 and sealed-2 suite 1,843 failures, mostly "painted extent
  differs"; 629, 646 and 617 painter-only failures without a line-local gap.
- **History dependence:** development 82, held-out 09-16 136, sealed-2 123 cases.

## 7. Open decisions

1. **Host rows in reported numbers.** Installed Safari equals webkit-host on every case it ran this round: all of the development and
   family files in both orders, scores included, and the first 7,863 held-out cases in file order (§2.7). Its held-out and
   sealed-2 files didn't finish. **Recommendation:** let webkit-host rows stand in for WebKit geometry and predictions
   under lab/WEBKIT-HOST.md's conditions, named as webkit-host; give the lab owner the hidden-page diagnosis (jobs under 8
   minutes per WebContent process, or a visible window) and rerun the two unfinished files after that and after any Safari
   or macOS update.
2. **Gecko in-word recipe** (gecko-shortcut-audit D1). Unchanged: removed, under `in-word-prefix`. **Recommendation:** keep it
   removed with the gap named. Ceiling round 3's fix phase brought U+200D back from source, not from scores: U+200D is
   Join_Causing, both sides of an offset between joined letters are measured with it, and the position is exact only where
   the two sides add up to the unit (probe F15: 1,013 of 1,015 such cuts, the other two a ligature the ink test sees);
   elsewhere it stays a stand-in under `in-word-prefix`.
3. **Browser-process languages.** Recorded and given in all three browsers; Gecko now measures `lang=""` runs under the
   given `regionalPrefsLocale`, and webkit-host's list comes from WebKit's own steps. Left: Chrome's accept languages have
   no input, and only Chrome ran under a second locale. **Recommendation:** unchanged.
4. **WebKit line width.** The scorer marks a line unobserved where `contentWidth` isn't the float32 union of its boxes: 748
   cases over development, held-out 09-16 and sealed-2, 2 more since the `ctx.wordSpacing` recipe. **Recommendation:**
   unchanged; the architect decides.
5. **Retire G0.** Unchanged. **Recommendation:** attribute the widths and painter pairs, then retire G0 (DESIGN §8.3 stage
   4).
6. **Painter metric.** It compares extents and wraps only, and round 2's painter changes regressed 58 Chrome pairs on sets
   the painter owner didn't run. **Recommendation:** run the suite sample and rule families in every painter round; have
   `paint` report painted source offsets and painter limits per line, so painter failures without a named limit can be
   counted.
7. **History-dependent layouts.** `page-history` is narrower and still weak on the development sets, and one triage case
   shows history that both orders share (§2.8). **Recommendation:** add the isolation protocols of TEST-ARCHITECTURE §6.5
   (a fresh document per suspect case), and widen the condition from the cache key where isolation shows it missing.
8. **Weak gaps.** Blink `script-context`, `soft-hyphen-shaping`, `tab-stops`, `control-character-width`; Gecko
   `glyph-clusters`, `font-fallback`; WebKit `canvas-language`, `simplified-measuring`, `page-history`,
   `letter-spacing-ligatures`, `tab-stops`. They are line-local and read from source, and almost every webkit-host failure
   rests on one (§2.8). **Recommendation:** decide the inputs that would narrow them (a font fact for script-specific
   lookups, the family a locale realizes, a connected `<canvas>` for ligatures under letter spacing) before gaps become
   public API.
9. **Sealed held-out.** `sealed-2-20260917` ran once and stays sealed: only counts left the scorer. The 3 Firefox rows it
   shows outside the 1 au class were pursued through fresh development sets, not by opening it. **Recommendation:** keep
   that practice; rotate the set per browser release (TEST-ARCHITECTURE §3).
10. **Chrome 153.0.8010.50.** Chrome updated itself during the day; the library pins .48 and reports `engine-build` on
    every paragraph. Native views are equal on every case both rounds ran. **Recommendation:** run TESTS.md §12 for .50
    (probes into a facts file, the families derived again, which also applies the new width floor), then move the pin.
11. **Blink in-word geometry.** Positions inside joined and ligated words are reported as exact and aren't (§2.2).
    **Recommendation:** the architect decides between a gap range for cluster geometry, separate from the break-decision
    gap, and leaving those positions out of the engine-true output.
12. **Gecko's 1 au class.** Verified as a residual class (§2.8). **Recommendation:** keep it without a gap, reported as a
    class with its signature, and let the scorer count the signature apart so it never hides another width bug. Ceiling
    round 3's fix phase reproduces it on a detached `<canvas>` element at the device font size (§2.8). **Open decision:**
    whether the library may measure there. It needs `document`, so a worker falls back to the OffscreenCanvas and the
    class; it shares the DOM's font groups, and no round 3 run checked history dependence in both orders.
13. **Costs.** Record only, as tentpole 8 says. Calls rose in all three engines in round 2 (§3).
14. **API.** Open (tentpole 8).
15. **UI and system language facts** can't be read from page APIs. **Recommendation:** keep them explicit inputs that report
    `ui-language` when absent, and tell developers to set `lang`.

## Critic corrections (charter evaluation, 2026-09-17)

Checked against `.artifacts/lab/final-20260916/`. `score.ts` re-scored five runs into a scratch directory: Chrome held-out policy and held-out suite sample, Firefox held-out runs, webkit-host dev ws and held-out suite sample. Every summary and per-case file came out byte-identical. Main's small-set rows were also rescored with the current scorer: same line counts. The §2.2 and §2.3 tables, §3 measure, timing and line counts, and §4 gap counts all match the files. Changed from the draft:

- Headline: "match the installed browser" became "match the browser", naming webkit-host for WebKit and saying that unobserved cases are left out of the rates. "Installed Safari 27.0 wasn't run" became "the rebuilt library never ran in installed Safari", because Safari did observe lab rows.
- Cost headline: added Chrome's held-out call ratio, 3.5×. The draft gave only development's 2×.
- §2.1: added the per-browser suite-sample counts, and installed Safari's 25-case smoke runs at 06:20 and 06:28 and its failed 300-case attempt at 06:51. The draft said Safari observed only two things.
- §2.2: Firefox history-dependent cases. U+1F600 explains 116 of 123 in development but only 113 of 216 held-out; the other 103 are `suite/U+FFFD`. Also, the claim that the Chrome held-out width drop is "mostly the family mix" had no evidence behind it. It is replaced by the pass rates without the soft-hyphen class (89% against 96%), and the reference to it now points to §6, not §5.
- §2.3: the draft said both sides used the current scorer. Main's small-set rows were the 10:00 scoring; rescored, their line counts don't change. Control-family shares now come from the final rescoring.
- §3: the held-out maximum paragraph is 269,747 UTF-16 units, not 257,000. webkit-host case time is 792 s, not about 420 s. The test time is about 8 s; the critic's run took 8.5 s.
- §4: the draft's "3 / 21 / 16 prediction failures have no gap that locates failures" is really the count with no gap at all. The counts with only weak gaps are 225, 21 and 417. Added the missing weak flags and WebKit's `ui-language` lift. Added the DESIGN.md §5 gaps that engines don't report, and the reported gaps DESIGN.md has no row for.
- §5: probe counts are now split into spec rows and cross-cutting rows, as in specs/PROBES.md.
- §6: the Blink C0/C1 range was "35 to 51" and is 18 to 51. The soft-hyphen class is defined by Arabic or Hebrew text, not by paragraph direction. The Gecko "U+200C…U+FEFF 64 each" leaves out U+200D, which has 26. The emoji painter families have 84 or 85. The WebKit control range was "26 to 34" and is 21 to 31; 34 is U+FFFF, a noncharacter.
- TAKE-BACK.md: §2.1 now uses the final rescoring's control-family counts, for development and held-out. §4's Firefox count of 130, from an earlier run, is now the final 123 and 216, with the U+FFFD share.

## Orchestrator notes (charter evaluation, after the critic)

- The Gecko break scan was replayed offline against the groundwork Rust oracle rebuilt on Firefox 156's data
  (specs/gecko-oracle-replay.md). Every lab paragraph agrees position for position. Fuzzing found one port bug:
  `scriptIsChineseOrJapanese` (engines/gecko/linebreak.ts) lacks ICU likely subtags, so `yue`, `wuu`, `cmn`, `hak`,
  `nan`, `gan`, `lzh` and `und-TW` lose the Chinese/Japanese rules under `line-break: normal` and `loose` (400 fuzz
  positions). Not fixed: no lab case uses those tags, and the final numbers describe the committed library.
- Installed Safari: the orchestrator's own checks at 10:30 (user idle 283 min), 12:45 (idle 409 min) and 13:50 found
  Safari frontmost (PLAN.md log). At 13:50 the maintainer was back and using Safari, so no installed-Safari run was started.
- `rebuild/lab/FINAL-RESULTS.md` was never written; the full tables are `.artifacts/lab/final-20260916/analysis.md`, and §2
  above holds the summary tables.
- Installed Safari after all. At about 14:15 the maintainer said "go ahead and use safari!". `run.ts` and
  `probes/runner.ts` gained `--allow-safari-frontmost`, which skips the wait for Safari to leave the front (uncommitted).
  Installed Safari ran the combined lab files from 16:22 to 16:34 and both probe files from 16:44 to 16:45, and
  webkit-host ran the same combined files in between. Terminal was the frontmost app at every check, so no run opened a
  window over a frontmost Safari. With that flag the probe runner never calls `activate`. The lab driver still gives
  focus back with `activate` if Safari takes focus while it makes its window; whether that ever happened wasn't
  recorded. `rebuild/src` was unchanged.
- What that changed here: the headline, §2.1's method and observed list, §2.2's installed Safari tables and comparison,
  §2.3's installed Safari rows, the notes in §3 and §4, §5's lists, §6's page-history line and §7 item 1. The numbers
  come from `.artifacts/lab/final-20260916/combined-results.json`, `split-counts.json`, `safari-vs-host/` and the probe
  comparisons. Installed Safari against main (`safari-vs-main/`) and the prediction comparison
  (`safari-vs-host/predictions-*.json`) were computed offline afterwards, from the same rows.

