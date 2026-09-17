# Pretext rebuild: report

Branch `rebuild-20260916`, forked from main 2e5e2bd, on this Retina Mac under macOS 27, 2026-09-16. Paths are relative to `~/github/pretext-rebuild`.

The brief:

- from a font declaration and styled runs, predict the lines each installed browser draws: where lines break, how many there are, and how wide each is;
- paint those lines with the DOM;
- measure only with Canvas `measureText`: no DOM reads for widths, no font files;
- pin engine code and data to Chrome 153.0.8010.48, Safari 27.0 (WebKit 7625.1.29.11.27, macOS 27 libicucore) and Firefox 156.0 (ICU4X 2.1.2 baked data);
- no epsilons, and every Canvas-versus-DOM gap handled on purpose or named.

Headlines:

- **Line counts match the browser** on 98.98% to 99.92% of suite-sample cases, development, the burned held-out set of 2026-09-16 and the sealed held-out set run for the first time: installed Chrome 153, installed Firefox 156 and webkit-host, with installed Safari 27.0 in §2.7. Main's library gets 63.7% to 89.7% on the development and 2026-09-16 samples (§2.3, §2.5). The rates are pass ÷ (pass + fail); unobserved cases are left out.
- **Failures without a gap** (§2.8): none in Chrome; 20 in Firefox, 11 of them from rows that break the slot protocol or unnamed 1 au widths; 8 in webkit-host, 2 of them the slot protocol and 6 in the sealed set.
- **Installed Safari 27.0 lays out text exactly like webkit-host**, the background WKWebView app on the system WebKit 22625.1.29.11.27 that Safari 27.0 runs. Once the maintainer approved Safari runs (about 14:15), installed Safari ran every development and held-out case in both orders, from 16:22 to 16:34 (§2.2). With the same document history on every row, the two derive the same lines on every development case and on all but 28 of 30,410 held-out observations, each of those history-dependent in one of the two browsers. The rebuilt library's predictions are equal on every case, and so are all 89 WebKit probe observations (§5). The per-set WebKit tables still come from webkit-host. That comparison is the charter evaluation's; in the ceiling round installed Safari stopped after 1,585 rows, all equal to webkit-host's (§2.7).
- **Cost:** in Chrome, about 2× main's Canvas calls on the development suite sample and 3.5× on the held-out one (mean), and prediction about 6× slower (§3).
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
- A **gap** is a known place where Canvas can't supply what the DOM uses. The library still predicts, and reports the gap's name with the paragraph.

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
Gap = { gap: GapName; run: number | null; detail: string }
```

Internally each engine implements `prepare`, `firstLine`, `nextLine(prepared, start, width, measurer)` and `gaps`, but that split isn't public. A `LineStart` is valid only at the width that produced it. There is no prepare-once, lay-out-at-many-widths API, and nothing is cached across paragraphs.

## 2. Numbers

### 2.1 Method

The numbers in §2-§7 are the ceiling round 1 evaluation of 2026-09-17 (`rebuild-20260916` at a4f23b8). They replace the
charter evaluation's numbers of the same day, which stay in git history (REPORT.md at a4f23b8); §2.4 compares the two case
by case.

- Library: `rebuild/src` at a4f23b8, the stage 5 inline tree model with the three engine owners' fixes. The working tree
  was clean when the runs began. The one change during the evaluation is in the lab: `lab/run.ts` now gives Bun.serve a
  1 GiB request body limit (§2.3, Firefox).
- Predictions go through `rebuild/lab/predictor.ts` with the lab's font fact table, the build read from the app bundle and
  the browser-process languages the driver records (lab/README.md, "Browser-process languages"): Chrome `uiLanguage`
  zh-CN, Firefox `regionalPrefsLocale` zh-hans-us, webkit-host `preferredLanguages` zh-CN with ICU default locale
  `en_US_POSIX`.
- Scorer: `rebuild/lab/score.ts` version 3. It compares rects exactly as version 2 did. A code point rect now takes its
  line from its own node's box, and only rects of different nodes group by vertical centre (lab/README.md, "Scoring").
  Re-scoring the charter's rows with version 3 changed no per-case result.
- Browsers, all at DPR 2 on macOS 27.0 (26A428): installed Chrome 153.0.8010.48 (09:29 to 10:02), installed Firefox 156.0
  (10:05 to 10:28) and webkit-host on WebKit 22625.1.29.11.27 (10:30 to 11:11). Installed Safari 27.0 ran the combined
  files after that, and webkit-host ran the same files first (§2.7).
- Sets:
  - rule families: the tests owner's derived cases of 2026-09-16 (Chrome 10,976, Firefox and webkit-host 9,584);
  - feature families: the stage 5 derived cases (Chrome 12,882, plus the 468 `process-languages` cases under a Chrome
    launched in en-US; Firefox 11,946; webkit-host 12,150);
  - development: smoke, runs, ws, policy and the 20,000-case suite sample in 4 parts;
  - held-out 09-16: runs, ws, policy and the 10,000-case suite sample in 2 parts, of 2026-09-16. They are burned and count
    as development cases now; they run again because the charter numbers compare with them;
  - sealed: `sealed-20260917`, runs 2,579, ws 1,039, policy 1,600 and a 10,000-case suite sample (216 families), run for
    the first time. All 10 file hashes equal `SEAL.json`. Two generator sources, `lab/cases/case.ts` and `build.ts`,
    gained tree cases after sealing; flat cases keep their ids, and every sealed case validated. Sealed runs are scored
    with `score.ts --sealed`, and counts of failures without a gap come from `evaluate/tools/sealed-counts.ts`, which uses
    the scorer's functions and writes no case id, text or family. No sealed case, family or example was opened.
- Every case file ran in file order and in reverse, one job per file under the browser lock with a 20 s pause after each
  hold. The suite samples ran one case per round trip. Each run was scored against the other order with
  `--native-compare`; history-dependent cases are left out of the counts.
- Tools and outputs: `.artifacts/ceiling-20260917/evaluate/` (`tools/run-eval.sh`, `score-eval.sh`, `chain-browsers.sh`,
  `chain-combined.sh`, `aggregate.ts`, `gaps.ts`, `sealed-counts.ts`, `gate-cross.ts`, `compare-safari-host.ts`;
  `aggregate-<browser>.md` and `.json`, `gaps/`, `numbers.txt`, and per set `<browser>/<set>-{forward,reverse}/`).

Metrics and facts are defined as in lab/README.md "Scoring": lineCount, breaks, widths (where breaks pass) and painter;
predicted, limited and unobservable facts.

### 2.2 Observation agreement

Equal ÷ compared, forward runs, every case outside history dependence. Rect counts and line membership are counted per
range.

| Browser | Group | Rect counts | Predicted values | Limited values | Line membership | Unobservable facts |
|---|---|---|---|---|---|---:|
| Chrome | rule families | 194,324 of 194,680 (99.817%) | 171,391 of 172,971 (99.087%) | 282,841 of 296,991 (95.236%) | 231,012 of 231,230 (99.906%) | 3,840 |
| Chrome | feature families | 320,970 of 321,012 (99.987%) | 215,377 of 216,330 (99.559%) | 499,907 of 502,314 (99.521%) | 342,071 of 342,071 (100%) | 5,117 |
| Chrome | development | 1,106,040 of 1,106,208 (99.985%) | 412,602 of 413,216 (99.851%) | 1,927,522 of 1,990,530 (96.835%) | 1,200,829 of 1,200,845 (99.999%) | 45,113 |
| Chrome | held-out 09-16 | 2,259,537 of 2,259,673 (99.994%) | 428,320 of 429,391 (99.751%) | 4,185,844 of 4,325,301 (96.776%) | 2,376,494 of 2,376,546 (99.998%) | 92,097 |
| Chrome | sealed | 2,339,009 of 2,339,133 (99.995%) | 411,955 of 412,883 (99.775%) | 4,458,289 of 4,486,767 (99.365%) | 2,449,258 of 2,449,283 (99.999%) | 123,772 |
| Firefox | rule families | 177,012 of 177,218 (99.884%) | 133,163 of 139,588 (95.397%) | 219,974 of 260,934 (84.303%) | 195,841 of 196,881 (99.472%) | 13,073 |
| Firefox | feature families | 295,132 of 295,138 (99.998%) | 215,659 of 216,072 (99.809%) | 414,442 of 417,290 (99.318%) | 301,743 of 301,793 (99.983%) | 19,057 |
| Firefox | development | 1,103,973 of 1,104,005 (99.997%) | 536,678 of 536,872 (99.964%) | 1,690,192 of 1,797,170 (94.047%) | 1,165,985 of 1,166,036 (99.996%) | 43,404 |
| Firefox | held-out 09-16 | 2,258,385 of 2,258,429 (99.998%) | 1,233,053 of 1,233,236 (99.985%) | 2,858,546 of 3,428,724 (83.371%) | 2,329,644 of 2,329,693 (99.998%) | 73,821 |
| Firefox | sealed | 2,335,739 of 2,335,759 (99.999%) | 1,260,748 of 1,260,833 (99.993%) | 3,523,415 of 3,550,685 (99.232%) | 2,404,779 of 2,404,801 (99.999%) | 63,562 |
| webkit-host | rule families | 176,282 of 176,456 (99.901%) | 126,198 of 127,550 (98.940%) | 242,968 of 274,800 (88.416%) | 198,824 of 199,085 (99.869%) | 32,983 |
| webkit-host | feature families | 299,723 of 299,786 (99.979%) | 185,846 of 186,023 (99.905%) | 470,881 of 476,075 (98.909%) | 314,453 of 314,517 (99.980%) | 33,384 |
| webkit-host | development | 1,104,385 of 1,104,437 (99.995%) | 363,201 of 364,261 (99.709%) | 1,772,155 of 1,982,235 (89.402%) | 1,172,439 of 1,172,603 (99.986%) | 76,353 |
| webkit-host | held-out 09-16 | 2,258,116 of 2,258,194 (99.997%) | 414,552 of 415,658 (99.734%) | 2,949,458 of 4,258,632 (69.258%) | 2,336,404 of 2,336,561 (99.993%) | 61,831 |
| webkit-host | sealed | 2,337,180 of 2,337,229 (99.998%) | 366,163 of 367,215 (99.714%) | 4,116,536 of 4,473,047 (92.030%) | 2,419,692 of 2,419,783 (99.996%) | 77,885 |

- Limited values in Chrome and Firefox are all `in-word-prefix`. In webkit-host they split into `in-word-prefix` and
  `glyph-clusters`. The held-out 09-16 suite's corpus paragraphs hold most of its limited values.
- Against the charter evaluation, predicted values agree more often in Chrome (development 99.798% to 99.851%, held-out
  99.682% to 99.751%) and webkit-host (development 99.558% to 99.709%), and as often in Firefox.

### 2.3 Scores, forward runs

Cells are pass / fail / unobserved, and widths add not-applicable. The reverse runs give the same lineCount and breaks cells
on every set. No row had a native, prediction or observation error, and no prediction raised `UnportedFeature`.

Chrome 153 (no history-dependent cases):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (10,976) | 10772/204/0 | 10690/286/0 | 10258/368/64/286 | 9975/937/64 |
| feature families | features (12,882) | 12135/28/719 | 12135/28/719 | 6943/220/4972/747 | 6992/430/5460 |
| feature families | process-languages under en-US (468) | 468/0/0 | 468/0/0 | 468/0/0/0 | 468/0/0 |
| dev | smoke (299) | 298/1/0 | 298/1/0 | 295/1/2/1 | 294/3/2 |
| dev | runs (2,580) | 2578/2/0 | 2577/3/0 | 2564/9/4/3 | 2507/69/4 |
| dev | ws (1,019) | 1019/0/0 | 1019/0/0 | 1018/1/0/0 | 995/24/0 |
| dev | policy (1,606) | 1606/0/0 | 1606/0/0 | 1606/0/0/0 | 1595/11/0 |
| dev | suite (19,994) | 19905/89/0 | 19894/100/0 | 19146/108/640/100 | 19066/265/663 |
| held-out 09-16 | runs (2,579) | 2577/2/0 | 2577/2/0 | 2562/13/2/2 | 2516/61/2 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1021/1/0/0 | 1000/22/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1604/0/0 | 1604/0/0/0 | 1587/17/0 |
| held-out 09-16 | suite (10,000) | 9898/102/0 | 9869/131/0 | 8917/182/770/131 | 8830/392/778 |
| sealed | runs (2,579) | 2579/0/0 | 2578/1/0 | 2562/12/4/1 | 2523/52/4 |
| sealed | ws (1,039) | 1039/0/0 | 1039/0/0 | 1036/3/0/0 | 985/54/0 |
| sealed | policy (1,600) | 1600/0/0 | 1600/0/0 | 1600/0/0/0 | 1586/14/0 |
| sealed | suite (10,000) | 9912/88/0 | 9899/101/0 | 8937/190/772/101 | 8831/392/777 |

Firefox 156 (history-dependent: development suite 123, held-out 09-16 suite 190, sealed runs 66, sealed suite 128,
others 0):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (9,584) | 9422/162/0 | 9166/418/0 | 8481/685/0/418 | 8048/1536/0 |
| feature families | features (11,946) | 11270/6/670 | 11267/9/670 | 6254/0/5013/679 | 6245/233/5468 |
| dev | smoke (297) | 297/0/0 | 297/0/0 | 291/6/0/0 | 283/14/0 |
| dev | runs (2,580) | 2580/0/0 | 2575/5/0 | 2533/42/0/5 | 2483/97/0 |
| dev | ws (1,019) | 1018/1/0 | 1017/2/0 | 1006/11/0/2 | 1001/18/0 |
| dev | policy (1,606) | 1606/0/0 | 1605/1/0 | 1592/13/0/1 | 1583/23/0 |
| dev | suite (19,888) | 19702/63/0 | 19687/78/0 | 18786/901/0/78 | 18118/1647/0 |
| held-out 09-16 | runs (2,579) | 2571/8/0 | 2567/12/0 | 2516/51/0/12 | 2476/103/0 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1018/4/0/0 | 1008/14/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1602/2/0 | 1583/19/0/2 | 1573/31/0 |
| held-out 09-16 | suite (10,000) | 9761/49/0 | 9738/72/0 | 8980/758/0/72 | 8523/1287/0 |
| sealed | runs (2,579) | 2511/2/0 | 2510/3/0 | 2483/27/0/3 | 2442/71/0 |
| sealed | ws (1,039) | 1039/0/0 | 1039/0/0 | 1033/6/0/0 | 1029/10/0 |
| sealed | policy (1,600) | 1600/0/0 | 1599/1/0 | 1580/19/0/1 | 1564/36/0 |
| sealed | suite (10,000) | 9846/26/0 | 9833/39/0 | 8975/858/0/39 | 8486/1386/0 |

The first held-out 09-16 suite job failed at row 2,632 of 5,000 with a page NetworkError. The next case's Firefox row is
about 134 MB, and Bun.serve refuses request bodies over 128 MiB by default: in Bun, a 135 MiB POST gets 413 with the
default and 200 with a 1 GiB limit. `lab/run.ts` now sets that limit, and the job then ran to the end. The Gecko owner's
NetworkError on this set has the same cause. The failed part is kept under
`firefox/heldout-suite-sample-forward/part0-failed-body-limit`.

webkit-host (history-dependent: rule families 6, development runs 6, ws 1, suite 75, held-out 09-16 runs 1, suite 133,
sealed runs 6, suite 115):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families (9,584) | 9458/120/0 | 9376/202/0 | 8822/291/263/202 | 8382/995/201 |
| feature families | features (12,150) | 11426/19/705 | 11416/29/705 | 8547/0/2869/734 | 8449/315/3386 |
| dev | smoke (300) | 299/1/0 | 297/3/0 | 287/5/5/3 | 263/32/5 |
| dev | runs (2,580) | 2565/9/0 | 2526/48/0 | 2313/83/130/48 | 2235/220/119 |
| dev | ws (1,019) | 1018/0/0 | 1018/0/0 | 1016/2/0/0 | 992/26/0 |
| dev | policy (1,606) | 1605/1/0 | 1599/7/0 | 1558/21/20/7 | 1451/139/16 |
| dev | suite (19,933) | 19843/15/0 | 19841/17/0 | 19726/26/89/17 | 18766/1014/78 |
| held-out 09-16 | runs (2,579) | 2569/9/0 | 2538/40/0 | 2292/107/139/40 | 2217/236/125 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1020/1/1/0 | 996/25/1 |
| held-out 09-16 | policy (1,604) | 1603/1/0 | 1602/2/0 | 1553/31/18/2 | 1421/172/11 |
| held-out 09-16 | suite (10,000) | 9835/32/0 | 9820/47/0 | 9682/37/101/47 | 7946/1867/54 |
| sealed | runs (2,579) | 2566/7/0 | 2540/33/0 | 2308/92/140/33 | 2231/214/128 |
| sealed | ws (1,039) | 1039/0/0 | 1039/0/0 | 1034/2/3/0 | 1011/25/3 |
| sealed | policy (1,600) | 1600/0/0 | 1598/2/0 | 1565/22/11/2 | 1429/162/9 |
| sealed | suite (10,000) | 9869/16/0 | 9855/30/0 | 9703/63/89/30 | 8000/1835/50 |

Reading these:

- Suite-sample line counts, pass ÷ (pass + fail), development / held-out 09-16 / sealed: Chrome 99.55% / 98.98% / 99.12%,
  Firefox 99.68% / 99.50% / 99.74%, webkit-host 99.92% / 99.68% / 99.84%.
- Observed suite widths passing, same order: Chrome 99.44% / 98.00% / 97.92%, Firefox 95.42% / 92.22% / 91.27%,
  webkit-host 99.87% / 99.62% / 99.35%.
- The sealed set scores like the development sets, so by these counts the library generalizes. Its suite sample takes one
  quota per family, so its rates don't compare exactly with the other samples.
- Feature families leave many cases unobserved. A line holding only atomic inlines or a `<br>` has no Range rect, and
  element rects aren't compared yet (line counts: Chrome 719, Firefox 670, webkit-host 705). Box edges, slots and indents
  leave widths unobserved where the port's node rects don't span the engine width.
- WebKit's unobserved widths (development 244, held-out 09-16 259, sealed 243) are still lines where `contentWidth` sits a
  float32 step from the union of the display boxes (§7 item 4).

### 2.4 Against the charter evaluation

Transitions over cases neither run marks history-dependent, forward per-case files (`aggregate-<browser>.md`). Cells are
pass→fail / fail→pass; sets not listed have none.

| Browser | Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| Chrome | rule families | 0/32 | 0/50 | 0/48 | 44/34 |
| Chrome | smoke / runs / policy | 0/0, 0/0, 0/0 | 0/1, 0/0, 0/2 | 0/0, 0/1, 0/0 | 0/0, 1/0, 0/0 |
| Chrome | dev suite | 0/14 | 1/45 | 0/28 | 8/25 |
| Chrome | held-out 09-16 runs | 0/0 | 0/1 | 0/6 | 2/5 |
| Chrome | held-out 09-16 suite | 1/15 | 2/47 | 0/53 | 44/15 |
| Firefox | dev suite | 0/0 | 0/0 | 0/3 | 0/0 |
| Firefox | held-out 09-16 suite | 0/0 | 0/1 | 0/1 | 0/1 |
| webkit-host | rule families | 22/33 | 22/33 | 0/38 | 6/56 |
| webkit-host | runs | 0/0 | 0/1 | 1/2 | 1/2 |

Sums, lost / gained: Chrome lineCount 1 / 61, breaks 3 / 146, widths 0 / 136, painter 99 / 79; Firefox 0 / 0, 0 / 1,
0 / 4, 0 / 1; webkit-host 22 / 33, 22 / 34, 1 / 40, 7 / 58.

Every loss, attributed from the per-case files and rows:

- **Chrome, 1 line count and 3 breaks**, all under gaps.
  - `c-9f72ec9d12c60092` (development suite, `partial-source-context`, RLM `((tail` in Amiri) and `c-047dfc8f2694b27c`
    (held-out suite, `joined-mark`, `بِبِ[[tail` in Amiri, `i` on the second native line): the brackets take Latin script
    from the text after them, which their Canvas string lacks (`script-context`). The Blink owner traced the first to
    removing the fitted ignorables rule (fix-r8); the second is the same class.
  - `c-01763358db8471a3` (held-out suite, `suite/space`, `a\tب\xadِب` in Shantell Sans, `pre-wrap`, 9.9px): 4 native lines,
    3 predicted. It now reports `glyph-clusters` at the chosen edge after the kasra, the gap fix-r11 added where a view
    edge cuts a grapheme. The gap sits on the failing edge, but no probe settles that edge: for the Blink owner.
- **Chrome painter, 99.** 93 of them are on cases whose widths or breaks now pass: `rule/joining` 44, held-out `joined-mark`
  22, and smaller groups. They are fix-r12's view numbering, which applies in the paragraph and not in a line painted alone
  (Blink owner). Of the other 6, 2 are the bracket cases above and 4 fail widths or breaks before and now.
- **webkit-host, 22 line counts and breaks**, all `rule/joining` under `rtl-shaping-across-inline-boxes`: passes whose
  charter widths failed, lost when the WebKit owner ported text shaping across inline boxes, which gained 33. The one width,
  `c-d03f94e8fb53e7e2` (`runs/bidi-runs`), is under the same gap: the Canvas total of the joined text is 0.51px wider than
  WebKit's per-character advances.
- **Firefox:** nothing lost. Rule families, smoke, runs, ws and policy equal the charter on every metric.
- **Gains:** in Chrome from the HarfBuzz cluster and cursive letter-spacing fixes (`in-word-breaks`, `joining`, `tabs`,
  U+200B and U+2060 families, held-out `U+FFFC`); in webkit-host from shaping across inline boxes in `rule/joining`.

### 2.5 Against main

`rebuild/lab/baselines/main-predictor.ts` rows of 2026-09-16, scored with scorer 2, against this evaluation's forward
per-case files. Line count is the one shared metric. Cases either side marks history-dependent are left out. Main never ran
the held-out small sets, the families, installed Safari or the sealed set.

| Browser | Set | Cases | Main lineCount | Rebuild lineCount | Main-only passes | Rebuild-only passes |
|---|---|---:|---|---|---:|---:|
| Chrome | smoke / ws / policy / runs | 103 / 103 / 408 / 21 | 79/24, 89/14, 397/11, 21/0 | 102/1, 103/0, 408/0, 21/0 | 0 | 23 / 14 / 11 / 0 |
| Chrome | dev suite | 19,994 | 15400/4594 | 19905/89 | 20 | 4,525 |
| Chrome | held-out 09-16 suite | 10,000 | 6369/3631 | 9898/102 | 19 | 3,548 |
| Firefox | smoke / ws / policy / runs | 101 / 103 / 408 / 21 | 85/16, 95/8, 396/12, 21/0 | 101/0, 103/0, 408/0, 21/0 | 0 | 16 / 8 / 12 / 0 |
| Firefox | dev suite | 19,760 | 17734/2026 | 19697/63 | 29 | 1,992 |
| Firefox | held-out 09-16 suite | 9,776 | 7499/2277 | 9727/49 | 27 | 2,255 |
| webkit-host | smoke / ws / policy / runs | 104 / 103 / 408 / 21 | 81/23, 88/15, 383/25, 20/1 | 104/0, 103/0, 408/0, 21/0 | 0 | 23 / 15 / 25 / 1 |
| webkit-host | dev suite | 19,858 | 15625/4233 | 19843/15 | 5 | 4,223 |
| webkit-host | held-out 09-16 suite | 9,820 | 6636/3184 | 9788/32 | 20 | 3,172 |

Where main passes a line count and the rebuild fails, every case reports a gap:

- Chrome: development `original-vs-reshaped-admission` 16 of 20 (`unsafe-to-break`, `glyph-clusters`), `U+FFFC/middle` 2;
  held-out `U+FFFC/*` 11 (`font-fallback`) and `source-shaped-arabic` 5.
- Firefox: invisible characters at a paragraph start before joined Arabic, 27 of 29 in development; held-out C0 controls,
  U+2029 and `source-shaped-arabic`. All `in-word-prefix`.
- webkit-host: development 5 under `letter-spacing-ligatures`; held-out C0 controls in the middle of a word 15
  (`control-character-width`) and 5 under `letter-spacing-ligatures`.

research/MAIN-TRIAGE.md and `rebuild/lab/triage/` sort these classes into facts to learn, accidental passes and opinions we
no longer hold.

### 2.6 Gates

**Lab gate.** This evaluation's development and held-out 09-16 runs, forward and reverse, against the scorer 3 baselines
seeded before stage 5. `lab/gate.ts` refuses the runs (exit 2), because their environment key names the given process
languages. `evaluate/tools/gate-cross.ts` applies the same `checkRuns` rules without the environment check:

| Baseline | Lost pairs | New pairs | History-dependent | Re-seeded: cases, pass pairs (lineCount / breaks / widths / painter), history-dependent, without passes, unstable |
|---|---|---:|---:|---|
| `gate-chrome-153.0.8010.48.json` | 61: lineCount 1, breaks 3, widths 2, painter 55, all under gaps (§2.4) | 347 | 0 | 40,446, 157,070 (40,250 / 40,209 / 38,476 / 38,135), 0, 143, 0 |
| `gate-firefox-156.0.json` | 0 | 7 | 347 | 40,340, 154,614 (39,906 / 39,855 / 38,052 / 36,801), 313, 121, 1 |
| `gate-webkit-22625.1.29.11.27.json` (webkit-host) | 4: widths 1, painter 3, all under gaps | 5 | 219 | 40,385, 155,365 (40,102 / 40,008 / 39,202 / 36,053), 216, 51, 3 |

The previous baselines are kept as `evaluate/gate-<browser>-<build>.before.json`.

**Tests gate** (`rebuild/tests/gate.ts`). Rule families against the baselines seeded earlier on 2026-09-17, by the same
cross-check:

| Browser | Lost pairs | New pairs |
|---|---|---:|
| Chrome | 44 painter, `rule/joining` under `glyph-clusters` (fix-r12 painter form, §2.4) | 214 |
| Firefox | 0 | 0 |
| webkit-host | 50: lineCount 22, breaks 22, painter 6, `rule/joining` under `rtl-shaping-across-inline-boxes` (§2.4) | 182 |

Then every tests baseline was seeded from this evaluation's runs, with the current facts files and the regenerated coverage
matrix, and checked against its own runs: 0 lost pairs, 0 flips, 0 rules losing their last observed family.

| Baseline | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent |
|---|---:|---|---:|
| `chrome-153.0.8010.48.json` | 10,976 | 41,695 (10,772 / 10,690 / 10,258 / 9,975) | 0 |
| `chrome-features-153.0.8010.48.json` | 12,882 | 38,205 (12,135 / 12,135 / 6,943 / 6,992) | 0 |
| `chrome-en-US-features-153.0.8010.48.json` | 468 | 1,872 (468 / 468 / 468 / 468) | 0 |
| `firefox-156.0.json` | 9,584 | 35,117 (9,422 / 9,166 / 8,481 / 8,048) | 0 |
| `firefox-features-156.0.json` | 11,946 | 35,036 (11,270 / 11,267 / 6,254 / 6,245) | 0 |
| `webkit-host-22625.1.29.11.27.json` | 9,584 | 36,038 (9,458 / 9,376 / 8,822 / 8,382) | 6 |
| `webkit-host-features-22625.1.29.11.27.json` | 12,150 | 39,838 (11,426 / 11,416 / 8,547 / 8,449) | 0 |

G0 is unchanged.

### 2.7 Installed Safari

- Plan (`evaluate/tools/chain-combined.sh`): the combined files in both orders, first in webkit-host and then in installed
  Safari 27.0 with `--allow-safari-frontmost`, so both see the same document history: `dev-all` (25,180 cases after
  Safari's case filter), `families-all` (the webkit-host rule and feature families, 21,734), `heldout-all` (15,205) and
  `sealed-all` (15,218).
- webkit-host ran all four files in both orders from 11:14 to 11:44. Forward against reverse:

  | File (cases) | lineCount | breaks | widths | painter | History-dependent |
  |---|---|---|---|---|---:|
  | dev-all (25,180) | 25059/25/0 | 25009/75/0 | 24636/134/239/75 | 23463/1408/213 | 96 |
  | families-all (21,734) | 20884/139/705 | 20792/231/705 | 17369/291/3132/936 | 16831/1310/3587 | 6 |
  | heldout-all (15,205) | 15029/43/0 | 14984/88/0 | 14549/176/259/88 | 12580/2301/191 | 133 |
  | sealed-all (15,218), counts only | 15074/23/0 | 15032/65/0 | 14610/179/243/65 | 12671/2236/190 | 121 |

- Installed Safari's first job, `dev-all` in file order, launched at 11:44 with Sublime Text frontmost. It wrote 1,585 rows
  and then stopped with "No page activity for 120000ms"; every row recorded the page as hidden. By the brief, one failed
  run stops the Safari work, so nothing was retried, and the families, held-out and sealed files never ran in installed
  Safari. The driver closed its tab; the Safari windows left are the user's own.
- The 1,585 rows compare case by case with webkit-host's forward rows of the same file, with the same document history on
  every row: all 1,585 native views are equal (every rect's x, width and native line), and so are all 1,585 predictions
  (layout, Canvas call counts and expected observation) (`evaluate/safari-vs-host-dev-all-forward-partial.json`).
- So this round's installed Safari evidence is partial. The charter evaluation's full comparison (development and held-out
  files in both orders: native views equal apart from 8 held-out cases that were history-dependent in Safari, predictions
  equal everywhere) is in REPORT.md at a4f23b8, §2.7.
- Not traced: why the page stopped. The charter's installed Safari runs of `dev-all` finished. A heavy browser job from
  another session, outside this worktree and the browser lock, was running at the time.

### 2.8 Failures without a gap

By the brief of 2026-09-17, an open model bug is a failure whose layout reports no named gap, or a gap whose condition the
source contradicts. Prediction failures (lineCount, breaks or widths) with no gap, forward runs outside history dependence;
painter-only failures without a gap in parentheses:

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed |
|---|---:|---:|---:|---:|---:|
| Chrome | 0 (42) | 0 (108) | 0 (14) | 0 (12) | 0 (22) |
| Firefox | 0 (0) | 9 (233) | 6 in 5 cases (179) | 5 (111) | 0 (125) |
| webkit-host | 0 (39) | 2 (0) | 0 (376) | 0 (375) | 6 (343) |

What they are:

- **Slot protocol, Firefox 9 and webkit-host 2** (`rule/line-slots`): `c-2c6803d9cbcda5b2`, `c-58a71c38160c6bcc`,
  `c-f168de2a9b06fbe6` and 6 more in Firefox; `c-303d850e42b725dd` and `c-32a0d43aea9861a7` in webkit-host. In every one,
  row 0's two insets and the 10px text-indent are wider than the block (120 + 120 + 10 > 249.98px, 111.9 + 111.9 + 10 >
  233.77px), and the page puts row 0's right float one row lower, so the declared slots don't describe the page (Gecko probe
  F5; WebKit `haveEnoughSpaceForFloatWithClear`). The observer assumption `shared/lab/slot-rows` fails there, and the
  scorer doesn't check it. The fix belongs in derivation or the scorer, not in an engine.
- **Gecko, 1 au on one line, no gap name:** development `c-13c64a6ce641374d`, `c-8f9cd18c645671da`, `c-fcbb3bc755b5a5e8`
  (`maintained/accuracy`) and `c-268ee59b15a407a8` (`runs/mixed-fonts-sizes`, in smoke and runs); held-out
  `c-02e7d131f09e05b9`, `c-d575ffd182517ddc` and `c-e05daec9b21bfc36` (`runs/mixed-fonts-sizes`). Corrected by the round 1
  critic and the Gecko owner's round 2 probe F7: the differing line holds a shaping unit whose DOM width is 1 au off its
  Canvas width. `c-268ee59b15a407a8`, `c-02e7d131f09e05b9`, `c-d575ffd182517ddc` and `c-e05daec9b21bfc36` have `ووفقك` in
  10px Geeza Pro (DOM 1173 au, OffscreenCanvas 1172); the `maintained/accuracy` lines are Latin in 15px Helvetica Neue
  (`modern`: DOM 3118, Canvas 3119). The same class explains `c-79f342df6e23e13a` and `c-f52cf560ae801fed` below. The DOM
  shapes at the device size and rounds each glyph's advance to app units at 30 per device pixel from 16.16 values
  (gfxHarfBuzzShaper.cpp:354-379, :1262-1263, :1699-1702); neither an OffscreenCanvas nor a `<canvas>` element gives those
  values (F7: the element measures on whole device pixels), so no Canvas-observable condition exists.
- **Gecko, other widths:** `c-daf9c7047097f77b` (`policy/overflow-wrap`) is not a ligature equal to its parts but `f` at an
  emergency break inside `firstname`, which the DOM gives half of the `fi` ligature's 435 au (217, `i` 218;
  ComputeLigatureData, gfxTextRun.cpp:238-322) where the port measured `f` alone at 249. Held-out `c-9d23fb8693d45e81` and
  `c-f716dcbf1c7bbf6f` (`runs/span-at-space`) are digit widths inside the span ` 7:00-9:00` (18px bold Apple SD Gothic Neo,
  `lang="ko"`): the DOM kerns `7:` by −40 au and `-9` by −29 because an 8-bit text run counts as Latin whatever its
  letters (gfxTextRun.cpp:2744-2747), and the port resolved it from the language to Hangul, where kerning is off. In these
  and three of the 1 au cases, the observation port marked the differing value limited by `in-word-prefix` itself, where
  the layout reported no gap; round 2 takes that state from the layout's shaping units instead.
- **Gecko, gaps only on other lines** (round 1 critic): `c-79f342df6e23e13a` and `c-f52cf560ae801fed`
  (`runs/mixed-fonts-sizes`), widths wrong on line 0 by 1 au on `รมชาติทำให้ผู้คนมีคว` in 32px Thonburi (DOM 16899 au,
  Canvas 16898; probe F7), with `in-word-prefix` only on later lines.
- **webkit-host sealed, 6:** 4 line counts and 2 breaks in the sealed suite sample, with the reasons "line count differs"
  and "code point on other lines". Counts only; naming them would burn the set.
- **webkit-host, "0 without a gap" rested on paragraph gaps** (corrected in ceiling round 2). Round 1's WebKit engine reported
  every condition on the paragraph, so under the round 2 definition, where a gap must concern the failing line or the break
  decision it starts from (lab/README.md, "Line-local gaps"), no webkit-host prediction failure had one. Re-scored with
  scorer 4 (`.artifacts/lab/webkit-round2/rescore-r1/`), cases outside history dependence and protocol rows, lineCount /
  breaks / widths without a line-local gap: development combined file 25 / 75 / 131, held-out 09-16 combined file 43 / 88 /
  176, rule and feature families 78 / 145 / 194. The two slot rows above are protocol rows under scorer 4, as is the
  accidental pass `c-9863334967bab8a9`. The round 2 WebKit engine reports its conditions on lines (specs/webkit-RESULTS.md,
  "ceiling round 2"), and tracing the failures that still lacked a line gap found a wrong source reading: CSS generic
  families resolve by locale through CoreText on macOS (FontDescriptionCocoa.cpp:77-118), where the port had read only
  -webkit-standard as per script, so `canvas-language` missed Latin in `serif` under `ja` or `zh-Hans`.
- **webkit-host, weak gaps** (round 1 critic item 4): `page-history` fired for any box with strong RTL content or an RTL
  block, not where the break position cache's key can change a line, and missed Latin text laid out after an RTL box of
  the same text; round 2 takes the condition from TextBreakingPositionContext and the item ends another direction gives.
- **Chrome, "0 without a gap" rested on paragraph gaps and gaps of other lines** (corrected in ceiling round 2). Re-scored
  with scorer 4 (`scratchpad/blink-r2/uncovered-all.ts` over `.artifacts/ceiling-20260917/evaluate/chrome/`), 170 of round
  1's Chrome prediction failures outside history dependence had no line-local gap: runs 3, held-out runs 4, held-out ws 1,
  rule families 72, feature families 52, suite sample 9, held-out suite sample 29. `rule/system-fonts-and-sizes` (64),
  `U+FFFC/*` (38), `runs/bidi-runs` and three `runs/split-word` cases had only paragraph gaps without a range;
  `rule/text-align` (52), `rule/following-space` (8) and three more had their gaps on the next line. The round 2 Blink
  engine reports the content's conditions with ranges and copies them onto the line whose decision measured them, and the
  traced classes turned out to be port bugs fixed from source, not gap cases: tab-size 0 stops at multiples of the letter
  spacing (font.cc:303-340; the 97 `rule/tabs` failures round 1 covered only by `tab-stops`); `NeedsAccurateEndPosition` is
  computed before the base direction is set (line_breaker.cc:811-871), which explains round 1's "reshape offsets under
  right but not left"; Times New Roman, Helvetica Neue and Hoefler Text kern through HarfBuzz's pair machine, which puts
  `kern >> 1` on the first glyph (hb-kern.hh:102-106), now the font fact `pairKerning`; the pair window measured a mark
  after a soft hyphen as a broken cluster (`c-01763358db8471a3`, the critic's unsettled `glyph-clusters` edge); and a view
  or an item takes whole glyph clusters by their first character (glyph_data_range.cc:56-90). specs/blink-RESULTS.md,
  "Ceiling round 2", has the transitions.
- **Chrome, weak gaps** (round 1 critic item 4). On the development set (smoke, runs, ws, policy, suite sample; 223
  prediction-failing cases in round 1, 95 in round 2), `in-word-prefix` went from 13,638 reports and lift 1.10 to 732 and
  2.16, where the source says a width-neutral unsafe offset can only move a decision within about 2 LayoutUnits or a
  wrapped start's reshape can drop an interaction two clusters wide; `glyph-clusters` from 3,165 to 2,724 (lift 7.6) where a
  pair window with liga, clig and calt off (letter spacing, font_features.cc:54-86) shows a ligature, then 3,953 (lift 4.7)
  once it also fires where the word the break decision measured past the line end holds such a window, which covers the
  triage population's 10 ligature cases (`ffiffl`, `office`); `control-character-width`
  from 970 to 127, only VT and FF, which Canvas turns into spaces. `script-context` still fires on 19,394 cases with lift
  1.20: Canvas does shape those characters under another script, and whether the font's lookups differ by script isn't in
  Canvas or in the font facts. `tab-stops` fires on every tab (lift 1.06) and covers no rule-family failure since the tab
  fix.
- **Painter-only failures without a gap** are painting form, not prediction: the prediction metrics pass. Most are "painted
  extent differs". DESIGN §7 names classes of them, but no painter limit is reported per case, so they aren't attributed
  case by case. The largest groups: Chrome `box-edges` 72 and `nested-box-edges` 18; Firefox `text-align` 100 and
  `box-edges` 73; webkit-host development `U+200D/middle` 60, `U+2060/middle` and `U+FEFF/middle` 48 each, held-out `marks`
  23 and `policy/thai` 20.

By this rule:

- Chrome has no prediction failure without a gap by the paragraph rule. By the round 2 line-local rule, 170 of round 1's
  Chrome prediction failures are open (above). The round 2 Blink build (r2-e) leaves none open on smoke, runs, ws, policy,
  the held-out runs, ws and policy, rule families, feature families in both languages, the suite sample and the held-out
  suite sample (193 failing cases, all under line-local gaps), and 1 of the triage population's 422
  (`c-8c84627af834611f`, an emergency break-word line in Shantell Sans that no source reading explains yet;
  specs/blink-RESULTS.md).
- Firefox has 20: 9 are the slot protocol, 8 (7 cases) the unnamed 1 au class and 3 other unnamed widths.
- webkit-host has 8 by the paragraph rule: 2 are the slot protocol and 6 are in the sealed set. By the round 2 line-local
  rule, every webkit-host prediction failure of round 1 is open, since its gaps concerned no line (above).
- Every input of the stage 5 model predicts in all three engines, but element rects and slot rows aren't scored, so part of
  what the feature families exercise is unobserved.

## 3. Costs

measureText calls per paragraph, mean, from the forward runs, with the charter evaluation's in parentheses. WebKit's counts
are webkit-host's.

| Engine | rule families | feature families | smoke | runs | ws | policy | dev suite: mean / median / p95 / max | held-out 09-16 suite | sealed suite |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Blink | 32.1 (33.5) | 34.9 | 79.1 (81.0) | 123.2 (125.7) | 72.4 (74.3) | 79.8 (82.0) | 73.5 / 21 / 224 / 20,846 (75.0 / 23 / 224 / 20,846) | 160.7 / 11 / 34 / 188,721 (161.8 / 11 / 35 / 188,721) | 151.6 / 11 / 33 / 171,197 |
| Gecko | 17.3 (17.5) | 21.2 | 49.8 (50.5) | 66.7 (67.6) | 38.1 (39.0) | 51.1 (52.0) | 41.6 / 17 / 120 / 26,613 (42.7 / 17 / 120 / 26,613) | 67.1 / 4 / 24 / 41,128 (68.8 / 4 / 25 / 41,128) | 70.7 / 4 / 23 / 40,817 |
| WebKit | 7.3 (6.8) | 9.1 | 18.6 (16.4) | 25.1 (22.8) | 18.0 (15.4) | 17.5 (16.0) | 13.4 / 6 / 38 / 2,059 (12.5 / 6 / 38 / 2,059) | 20.6 / 5 / 9 / 20,279 (unchanged) | 14.8 / 5 / 9 / 9,869 |

- Blink's and Gecko's calls fell by 1% to 3%. WebKit's rose by 8% to 17% on the small sets; the WebKit owner attributes it
  most likely to `font-fallback`'s LastResort context, not isolated.
- The sealed runs, ws and policy sets: Blink 124.5, 72.4 and 80.4 calls; Gecko 65.5, 36.9 and 52.0; WebKit 24.5, 19.2 and
  16.6.

Prediction time summed over the forward runs, with the charter's in parentheses, and the observation port's time:

| Browser | dev suite predict | held-out 09-16 suite predict | sealed suite predict | dev / held-out / sealed suite observe |
|---|---|---|---|---|
| Chrome | 10.7 s (9.8 s) | 295.9 s (287.6 s) | 38.7 s | 0.4 / 36.7 / 38.3 s |
| Firefox | 14.1 s (24.1 s) | 48.3 s (59.9 s) | 53.1 s | 0.2 / 0.5 / 0.5 s |
| webkit-host | 1.6 s (1.5 s) | 3.7 s (3.1 s) | 1.6 s | 10.2 / 133.3 / 95.2 s |

- In Chrome, ten corpus paragraphs still take most of the held-out suite's prediction time.
- Firefox's and WebKit's timers report whole milliseconds.

Lab time for every per-browser set in both orders, both family groups included: Chrome 1,170 s (held-out suite 778 s, sealed
suite 235 s), Firefox 454 s (held-out suite 144 s, sealed suite 145 s), webkit-host 1,654 s (held-out suite 806 s, sealed
suite 652 s).

The largest rows are 131 MB in Chrome and about 134 MB in Firefox, for the 269,747-unit held-out paragraph (§2.3).

Library lines, without tests and generated data:

| Module | Lines | Test lines |
|---|---:|---:|
| `model` / `env` / `index` / `engine` | 908 | |
| `content.ts` | 101 | |
| `paint.ts` | 388 | |
| `measure/` | 110 | |
| `unicode/` | 1,468 | 491 |
| `breaks/` | 506 | 172 |
| shared total | 3,481 | |
| `engines/blink` | 4,771 | 585 |
| `engines/webkit` | 4,662 | 664 |
| `engines/gecko` | 4,259 | 759 |
| **total** | **17,173** | **2,730** |

Around the library: the observation ports, 1,136 lines (486 test lines); every other non-test file under `rebuild/lab`,
case generators included, 7,315 lines; `rebuild/tests`, 2,720 lines.

Generated data is unchanged: `blink-break-tables.ts` 584 KB, `webkit-break-tables.ts` 644 KB, `gecko-break-data.ts` 41 KB,
Gecko props 62 KB and likely subtags 143 KB, `bidi-data.ts` 14 KB.

Tests at a4f23b8: `bun test rebuild/src` 222 tests in 15 files (9.7 s); `bun test rebuild/lab` 202 in 12;
`bun test rebuild/tests` 35 in 8; `bunx tsc` over the three projects clean, the lab project again after the `run.ts`
change.

## 4. Canvas-versus-DOM gaps, how often they fired

Forward runs, cases outside history dependence (`gaps/<browser>-{families,features,dev,heldout}.md`; the sealed set from
its counts-only files). For each gap: reports, all-pass, fail (any metric), prediction fail (lineCount, breaks or widths)
and lift, its share of failing cases divided by its share of all-pass cases. **Weak** means a lift below 2 in all three
groups. Cells are development / held-out 09-16 / sealed.

Blink (development 25,498 cases, held-out 09-16 15,205, sealed 15,218):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift |
|---|---|---|---|---|---|
| `script-context` | 18,298 / 8,761 / 8,754 | 17,294 / 7,529 / 7,532 | 363 / 471 / 457 | 173 / 302 / 290 | 1.16 / 1.59 / 1.52, **weak** |
| `in-word-prefix` | 13,638 / 9,087 / 9,012 | 13,185 / 8,219 / 8,158 | 272 / 360 / 360 | 133 / 201 / 190 | 1.14 / 1.11 / 1.10, **weak** |
| `glyph-clusters` | 3,165 / 2,621 / 2,777 | 2,279 / 1,661 / 1,844 | 247 / 205 / 175 | 155 / 127 / 109 | 5.97 / 3.13 / 2.38 |
| `unsafe-to-break` | 2,223 / 1,930 / 1,962 | 1,448 / 1,104 / 1,146 | 192 / 195 / 178 | 156 / 131 / 122 | 7.31 / 4.48 / 3.89 |
| `control-character-width` | 970 / 3,409 / 3,468 | 826 / 2,839 / 2,905 | 1 / 10 / 12 | 0 / 9 / 8 | 0.07 / 0.09 / 0.10, **weak** |
| `font-fallback` | 697 / 330 / 341 | 507 / 178 / 180 | 120 / 152 / 161 | 52 / 150 / 159 | 13.04 / 21.68 / 22.39 |
| `soft-hyphen-shaping` | 390 / 1,134 / 1,092 | 378 / 1,090 / 1,048 | 12 / 44 / 44 | 10 / 42 / 43 | 1.75 / 1.02 / 1.05, **weak** |
| `tab-stops` | 250 / 561 / 558 | 240 / 541 / 538 | 5 / 8 / 12 | 4 / 2 / 7 | 1.15 / 0.38 / 0.56, **weak** |
| `han-kerning` | 229 / 274 / 267 | 215 / 248 / 247 | 14 / 26 / 20 | 0 / 0 / 0 | 3.59 / 2.66 / 2.03 |

- `ui-language` no longer fires on these sets (charter: 68 development reports).
- `glyph-clusters` is new on these sets since fix-r7 and fix-r11. It also fires on 576 feature-family and 1,367 rule-family
  cases; the Blink owner notes it fires at kerned Latin edges too.
- Rule families add `optical-size` (968 reports, lift 1.18) and `page-history` (320, lift 2.6).

Gecko (development 25,267 cases, held-out 09-16 15,015, sealed 15,024):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift |
|---|---|---|---|---|---|
| `in-word-prefix` | 6,093 / 4,147 / 4,191 | 4,641 / 3,025 / 3,006 | 1,452 / 1,122 / 1,185 | 1,040 / 894 / 947 | 4.08 / 3.51 / 3.55 |
| `glyph-clusters` | 2,764 / 2,219 / 2,188 | 2,575 / 1,898 / 1,854 | 189 / 321 / 334 | 18 / 62 / 49 | 0.96 / 1.60 / 1.62, **weak** |
| `font-fallback` | 42 / 111 / 121 | 39 / 109 / 118 | 3 / 2 / 3 | 0 / 1 / 0 | 1.00 / 0.17 / 0.23, **weak** |
| `bitmap-emoji-size` | 35 / 49 / 23 | 20 / 26 / 17 | 15 / 23 / 6 | 15 / 18 / 6 | 9.77 / 8.37 / 3.18 |
| `ui-language` | 10 / 14 / 14 | 7 / 8 / 11 | 3 / 6 / 3 | 0 / 0 / 0 | 5.58 / 7.09 / 2.45 |
| `page-history` | 4 / 9 / 17 | 2 / 8 / 15 | 2 / 1 / 2 | 0 / 0 / 0 | 13.03 / 1.18 / 1.20 |
| `space-in-shaping` | 0 / 14 / 10 | 0 / 14 / 10 | 0 / 0 / 0 | 0 / 0 / 0 | |

- Rule families add `optical-size` (954 reports, lift 4.73) and `font-size-quantization` (392 reports, every one failing).
- Feature families report no gap at all: 242 of their 11,946 cases fail with none (§2.8).

WebKit, webkit-host (development 25,356 cases, held-out 09-16 15,071, sealed 15,097):

| Gap | Reports | All-pass | Fail | Prediction fail | Lift |
|---|---|---|---|---|---|
| `simplified-measuring` | 6,927 / 3,660 / 3,754 | 6,494 / 3,266 / 3,352 | 321 / 312 / 311 | 46 / 37 / 42 | 0.82 / 0.51 / 0.52, **weak** |
| `canvas-language` | 5,743 / 2,742 / 2,770 | 5,449 / 2,388 / 2,424 | 264 / 324 / 320 | 174 / 169 / 145 | 0.80 / 0.73 / 0.74, **weak** |
| `page-history` | 5,367 / 2,317 / 2,306 | 5,020 / 1,906 / 1,932 | 208 / 296 / 253 | 15 / 15 / 23 | 0.68 / 0.84 / 0.73, **weak** |
| `letter-spacing-ligatures` | 2,792 / 2,250 / 2,230 | 2,621 / 1,933 / 1,940 | 149 / 275 / 259 | 21 / 32 / 20 | 0.94 / 0.77 / 0.75, **weak** |
| `control-character-width` | 1,192 / 3,793 / 3,869 | 931 / 2,785 / 2,865 | 257 / 995 / 988 | 4 / 51 / 47 | 4.55 / 1.93 / 1.93 |
| `string-storage` | 736 / 470 / 435 | 694 / 432 / 404 | 18 / 29 / 19 | 0 / 0 / 1 | 0.43 / 0.36 / 0.26, **weak** |
| `tab-stops` | 245 / 550 / 553 | 230 / 498 / 512 | 11 / 40 / 32 | 3 / 11 / 8 | 0.79 / 0.43 / 0.35, **weak** |
| `dictionary-breaks-stand-in` | 18 / 13 / 8 | 13 / 10 / 6 | 5 / 3 / 2 | 2 / 0 / 1 | 6.34 / 1.62 / 1.87 |
| `rtl-shaping-across-inline-boxes` | 6 / 3 / 6 | 2 / 2 / 2 | 3 / 0 / 2 | 3 / 0 / 2 | 24.74 / 0 / 5.60 |

- `page-history` now fires on 5,367 development cases where the charter reported 75, with a lift below 1.
- `ui-language` no longer fires (charter: 182 development reports).
- `rtl-shaping-across-inline-boxes` fires on 292 rule-family cases with lift 16 and holds all 22 lost rule-family line
  counts (§2.4).

Failing cases with no gap, any metric / prediction metrics: Blink development 14 / 0, held-out 12 / 0, sealed 22 / 0; Gecko
185 / 6, 116 / 5, 125 / 0; WebKit 376 / 0, 375 / 0, 349 / 6.

Not reported on the development, held-out and sealed sets: `page-zoom`, `float32-precision`, `font-size-quantization`,
`dictionary-breaks-unavailable`, `engine-build`, `joining-technology`, `hyphen-glyph`, `fixed-pitch-path`, `optical-size`,
and `ui-language` in Blink and WebKit.

## 5. Verified in installed browsers, and only from source

Verified on 2026-09-17:

- **Installed Chrome 153.0.8010.48**: every rule family, feature family (with the `process-languages` family again under
  en-US), development, held-out 09-16 and sealed case in both orders, predicted with the ceiling round 1 library and scored
  against Blink's observation port.
- **Installed Firefox 156.0**: the same without the en-US round, against Gecko's port.
- **webkit-host on WebKit 22625.1.29.11.27**: the same, against WebKit's port.
- **Installed Safari 27.0**: 1,585 development cases in file order before its page stopped, equal to webkit-host's native
  views and predictions case by case (§2.7).
- The probe facts in `rebuild/facts/` come from the 2026-09-16 probe runs; the owners' stage 5 probes (Blink
  blink-followups-20260917, Gecko F4 to F6) are in their RESULTS files. No probe set was rerun here, and the facts files are
  unchanged.

From source or inference only:

- vertical metrics: `y` and `height` are outside the observation contract, and native lines across nodes come from
  vertical-centre grouping;
- element rects: `Element.getClientRects()` is recorded but not compared, and `<wbr>` rects are untraced in WebKit and
  Gecko;
- the slot protocol: whether native floats sit where `lineSlots` declares them isn't checked per row;
- WebKit's full preferred-language list and ICU default locale, and Chrome's accept languages for text without `lang`; only
  Chrome was observed under a second locale;
- page zoom in all browsers, a physical DPR 1 display, and forced DPR 1 or other app-unit families;
- the observation ports' rules, checked only through native rects: the rows reproduce 98.9% to 99.99% of predicted values;
- Gecko's 1 au class (specs/gecko-canvas.md §3 N7);
- Chrome 153's pinned HarfBuzz and V8, since 152's were read.

## 6. Known remaining failure classes

Family counts come from `gaps/<browser>-{families,features,dev,heldout}.md`, cases failing each metric. Sealed failures are
counts only.

Blink:

- **U+FFFC**, drawn with a fallback glyph (`font-fallback`, lift 13 to 22). Held-out `U+FFFC/{start,middle,end}` fail 16 to
  22 of 46 line counts each and nearly every painter case; the rule family `object-replacement` fails 132 of 348 line
  counts (charter 216).
- **Arabic at shaping edges** (`unsafe-to-break`, `glyph-clusters`): development `original-vs-reshaped-admission` 23 of 42
  line counts, held-out `source-shaped-arabic` 7 of 46.
- **Line-end reshapes under alignment** (`glyph-clusters`, `unsafe-to-break`): feature `text-align` fails 28 of 1,104 line
  counts, 220 widths and 301 painter cases.
- **Brackets that take the following script** (`script-context`): the two lost breaks of §2.4.
- **Painter:** 93 painter losses on cases whose prediction now passes (fix-r12's view numbering holds in the paragraph
  only); `box-edges` 72 and `nested-box-edges` 18 painter failures without a gap.

Gecko:

- **Joined forms at breaks inside a word** (`in-word-prefix`, lift 3.5 to 4.1): development invisible-character families
  fail 4 line counts and 40 widths of 196 each; `original-vs-reshaped-admission` 11 of 42; held-out C0 controls and U+2029
  before joined Arabic.
- **System fonts and sizes** (`optical-size`, `font-size-quantization`): rule family `system-fonts-and-sizes` fails 60 of
  680 line counts and 284 widths; `joining` 56 of 736 and `fit-bound` 19 of 360.
- **Device-size emoji** (`bitmap-emoji-size`).
- **Without a gap name:** the 1 au class, `f` taking half of an `fi` ligature at an emergency break, and digits kerned in an
  8-bit run under `lang="ko"` (§2.8, as corrected in ceiling round 2; specs/gecko-RESULTS.md has the round 2 status).
- **Slot protocol:** 9 `line-slots` cases (§2.8).
- **Painter:** `text-align` 100 painted lines (a painted line is its block's last line, which moves `center`, `end` and
  `justify` lines, DESIGN §7), `box-edges` 73 and `nested-box-edges` 27 extents; development suite 1,647 painter failures.
- **History dependence:** development 123, held-out 09-16 190, sealed 194 cases.

WebKit:

- **Fonts chosen by language** (`canvas-language`): `runs/lang-spans` fails 9 line counts, 50 breaks and 76 widths of 373 in
  development, and 8, 39 and 96 of 359 held-out; `policy/zh-lang`.
- **C0 controls inside a word** (`control-character-width`): held-out `U+000B` and `U+001C` to `U+001F/middle` fail 2 to 5
  line counts each.
- **RTL shaping across inline boxes**: the rule family `joining` fails 62 of 752 line counts.
- **`<br>` after preserved white space** (`page-history`): feature `br-elements` fails 16 line counts and 24 breaks, which
  pass alone in a fresh document (WebKit owner).
- **Widths unobserved** in 244 development, 259 held-out and 243 sealed cases (§7 item 4).
- **Without a gap:** 2 slot-protocol cases and 6 sealed prediction failures (§2.8).
- **Painter:** development suite 1,014, held-out suite 1,867 and sealed suite 1,835 failures, mostly "painted extent
  differs"; feature `line-slots` 173 and `text-align` 80.
- **History dependence:** development 82, held-out 09-16 134, sealed 121 cases.

## 7. Open decisions

1. **Host rows in reported numbers.** This round's installed Safari run stopped after 1,585 rows, all equal to webkit-host's;
   the charter's full comparison stands (§2.7). **Recommendation:** let webkit-host rows stand in for WebKit geometry and
   predictions under lab/WEBKIT-HOST.md's conditions, named as webkit-host, and rerun the combined files in installed
   Safari, including the families and the sealed set, once the stall is understood and after any Safari or macOS update.
2. **Gecko in-word recipe** (gecko-shortcut-audit D1). Unchanged: removed, 77 line counts against final-20260916, under
   `in-word-prefix`. **Recommendation:** keep it removed with the gap named.
3. **Browser-process languages.** Recorded and given in all three browsers. Left: Gecko reports `ui-language` for every
   `lang=""` run even when `regionalPrefsLocale` is given; Chrome's accept languages have no input; WebKit's full list isn't
   settled. **Recommendation:** decide Gecko's `lang=""` font matching from the given locale before reporting the gap.
4. **WebKit line width.** The scorer marks a line unobserved where `contentWidth` isn't the float32 union of its boxes: 746
   cases over development, held-out 09-16 and sealed. **Recommendation:** unchanged; the architect decides.
5. **Retire G0.** Unchanged. **Recommendation:** attribute the widths and painter pairs, then retire G0 (DESIGN §8.3 stage
   4).
6. **Painter metric.** It compares extents and wraps only. Chrome's painter losses are fix-r12's view numbering, which a
   line painted alone doesn't reproduce. **Recommendation:** have `paint` report painted source offsets and painter limits
   per line, so painter failures without a named limit can be counted.
7. **History-dependent layouts.** WebKit's `page-history` now fires on 5,367 development cases with a lift below 1, and
   Firefox's sealed runs set has 66 history-dependent cases. **Recommendation:** narrow `page-history` to the conditions of
   its effects, and add the isolation protocols of TEST-ARCHITECTURE §6.5.
8. **Weak gaps.** Blink `script-context`, `in-word-prefix`, `control-character-width`, `soft-hyphen-shaping`, `tab-stops`;
   Gecko `glyph-clusters`, `font-fallback`; WebKit `simplified-measuring`, `canvas-language`, `page-history`,
   `letter-spacing-ligatures`, `string-storage`, `tab-stops`. **Recommendation:** report them only where the chosen line
   edges read them, before gaps become public API.
9. **Sealed held-out.** `sealed-20260917` ran once and stays sealed: only counts left the scorer. **Recommendation:** use it
   only to answer whether a round generalizes, never to choose between recipes, and rotate it per browser release
   (TEST-ARCHITECTURE §3).
10. **Slot protocol and element rects.** 11 prediction failures without a gap come from rows whose floats don't sit where
    `lineSlots` says, and about 2,100 feature line counts are unobserved. **Recommendation:** check native floats against
    `lineSlots` per row (unobserved where they differ), have derivation avoid rows whose insets and indent exceed the
    width, and compare `elements`.
11. **Gap names for Gecko.** The 1 au class and the ligature class fail without a gap. **Recommendation:** the architect
    names them after a probe; until then they count as open.
12. **Costs.** Record only, as tentpole 8 says. Blink's and Gecko's calls fell slightly; WebKit's rose by up to 17%.
13. **API.** Open (tentpole 8).
14. **UI and system language facts** can't be read from page APIs. **Recommendation:** keep them explicit inputs that report
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

