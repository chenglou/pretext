# Pretext rebuild: report

Branch `rebuild-20260916`, forked from main 2e5e2bd, on this Retina Mac under macOS 27, 2026-09-16. Paths are relative to `~/github/pretext-rebuild`.

The brief:

- from a font declaration and styled runs, predict the lines each installed browser draws: where lines break, how many there are, and how wide each is;
- paint those lines with the DOM;
- measure only with Canvas `measureText`: no DOM reads for widths, no font files;
- pin engine code and data to Chrome 153.0.8010.48, Safari 27.0 (WebKit 7625.1.29.11.27, macOS 27 libicucore) and Firefox 156.0 (ICU4X 2.1.2 baked data);
- no epsilons, and every Canvas-versus-DOM gap handled on purpose or named.

Headlines:

- **Line counts match the installed browser** on 98.8% to 99.9% of suite-sample cases, development and held-out. Main's library gets 63.7% to 89.7% on the same cases (§2.3).
- **Installed Safari 27.0 wasn't run.** It was the frontmost app at every check, from 07:04 to 13:25. Every WebKit number comes from **webkit-host**: a background WKWebView app on the system WebKit 22625.1.29.11.27, the build Safari 27.0 runs. Host and Safari geometry matched exactly on all 300 smoke cases observed in both (lab/WEBKIT-HOST.md).
- **Cost:** about 2× main's Canvas calls in Chrome, and prediction about 6× slower there (§3).
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

- Library `rebuild/src` at cb9cadb, unmodified, through the lab predictor plus gaps (`.artifacts/lab/final-20260916/tools/gaps-predictor.ts`).
- Installed Chrome 153 and installed Firefox 156, plus webkit-host, all at DPR 2.
- Every case file ran in file order and in reverse, one job per file under the browser lock. Each run was scored against the other with `--native-compare`.
- Development sets, which the engine owners iterated on:
  - smoke: 299 Chrome, 297 Firefox, 300 WebKit;
  - runs: 2,580;
  - ws: 1,019;
  - policy: 1,606;
  - suite-sample: 20,000 cases from main's wrapping suite, with small families whole and every required case.
- Held-out sets:
  - new seed `heldout-20260916`, and no development id;
  - runs 2,579, ws 1,022, policy 1,604;
  - suite-sample 10,000: 45 cases from each of the 219 largest families, none required by the old suite. Its family mix differs from development's, so compare it per family.
- Methods: `.artifacts/lab/final-20260916/draft-methods.md`. Rows and per-case scores: `.artifacts/lab/final-20260916/<browser>/<set>-<order>/`. Tables: `analysis.md`.

Installed Safari observed only two things:

- main's old suite, 05:52 to 06:10;
- one 300-case lab smoke run at about 07:07. It ran under an idle-time exception, since reverted, while Safari was frontmost and the user had been idle 78 minutes. Its rects equal webkit-host's.

### 2.2 Scores, forward runs

Chrome 153 (no history-dependent cases):

| Group | Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| dev | smoke | 298/1/0 | 292/1/6 | 262/10/20/7 | 288/7/4 |
| dev | runs | 2566/5/9 | 2551/19/10 | 2342/125/84/29 | 2348/152/80 |
| dev | ws | 1019/0/0 | 1017/0/2 | 975/1/41/2 | 973/13/33 |
| dev | policy | 1605/1/0 | 1602/4/0 | 1599/3/0/4 | 1600/6/0 |
| dev | suite | 19888/105/1 | 19654/116/224 | 15105/1181/3368/340 | 19349/473/172 |
| held-out | runs | 2568/8/3 | 2534/38/7 | 2285/175/74/45 | 2287/221/71 |
| held-out | ws | 1022/0/0 | 1021/0/1 | 997/1/23/1 | 991/13/18 |
| held-out | policy | 1604/0/0 | 1599/5/0 | 1591/8/0/5 | 1593/11/0 |
| held-out | suite | 9878/120/2 | 9519/163/318 | 5165/1274/3080/481 | 8792/552/656 |

Firefox 156 (history-dependent: dev suite 123, held-out suite 216, others 0):

| Group | Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| dev | smoke | 297/0/0 | 292/0/5 | 272/4/16/5 | 281/12/4 |
| dev | runs | 2576/0/4 | 2573/3/4 | 2481/35/57/7 | 2445/63/72 |
| dev | ws | 1018/1/0 | 1017/2/0 | 966/11/40/2 | 973/15/31 |
| dev | policy | 1605/1/0 | 1605/1/0 | 1594/11/0/1 | 1585/21/0 |
| dev | suite | 19737/25/3 | 18969/29/767 | 15137/455/3377/796 | 18409/1195/161 |
| held-out | runs | 2575/4/0 | 2569/6/4 | 2480/40/49/10 | 2440/73/66 |
| held-out | ws | 1022/0/0 | 1022/0/0 | 992/5/25/0 | 993/11/18 |
| held-out | policy | 1604/0/0 | 1602/2/0 | 1587/15/0/2 | 1576/28/0 |
| held-out | suite | 9750/23/11 | 9483/37/264 | 5728/424/3331/301 | 8219/932/633 |

webkit-host (history-dependent: dev runs 5, dev suite 55, held-out runs 1, held-out suite 154):

| Group | Set | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| dev | smoke | 299/1/0 | 293/3/4 | 247/5/41/7 | 253/30/17 |
| dev | runs | 2561/10/4 | 2517/48/10 | 2253/83/181/58 | 2169/233/173 |
| dev | ws | 1019/0/0 | 1019/0/0 | 847/5/167/0 | 830/29/160 |
| dev | policy | 1603/1/2 | 1575/7/24 | 1546/21/8/31 | 1460/139/7 |
| dev | suite | 19860/15/3 | 19697/16/165 | 14376/37/5284/181 | 18537/949/392 |
| held-out | runs | 2565/12/1 | 2527/40/11 | 2257/106/164/51 | 2180/246/152 |
| held-out | ws | 1019/3/0 | 1019/3/0 | 862/6/151/3 | 851/28/143 |
| held-out | policy | 1600/1/3 | 1577/2/25 | 1537/31/9/27 | 1424/172/8 |
| held-out | suite | 9793/32/21 | 9527/45/274 | 4623/46/4858/319 | 7050/1903/893 |

Reading these:

- Held-out line counts hold up.
- Held-out suite widths drop in Chrome: it passes 80% of the widths it observes, against 93% in development. That's mostly the family mix, plus the soft-hyphen observation problem in §5.
- Unobserved widths are common because many old-suite families put a soft hyphen at every width.
- History-dependent cases:
  - Firefox: U+1F600 after an earlier `😀︎` in the same document;
  - WebKit: Amiri brackets, soft hyphens next to controls, and quotes at line edges (TAKE-BACK 5.1);
  - Chrome: none.

### 2.3 Against main

`rebuild/lab/baselines/main-predictor.ts` drives main 2e5e2bd the way an app developer would (lab/BASELINE-main.md). For smoke, ws, policy and runs, only the cases main can express are compared; every suite case is supported. Main doesn't paint. Both sides were scored with the current scorer, leaving out cases history-dependent for either.

| Browser | Set | Cases | Main lineCount | Rebuild lineCount | Main-only passes | Rebuild-only passes |
|---|---|---:|---|---|---:|---:|
| Chrome | smoke / ws / policy / runs | 103 / 103 / 408 / 21 | 79/24, 89/14, 397/11, 21/0 | 102/1, 103/0, 408/0, 21/0 | 0 | 23 / 14 / 11 / 0 |
| Chrome | dev suite | 19,994 | 15400/4593/1 | 19888/105/1 | 25 | 4,513 |
| Chrome | held-out suite | 10,000 | 6369/3629/2 | 9878/120/2 | 24 | 3,533 |
| Firefox | smoke / ws / policy / runs | 101 / 103 / 408 / 21 | 85/16, 95/8, 396/12, 21/0 | 101/0, 103/0, 408/0, 21/0 | 0 | 16 / 8 / 12 / 0 |
| Firefox | dev suite | 19,760 | 17731/2026/3 | 19732/25/3 | 14 | 2,015 |
| Firefox | held-out suite | 9,784 | 7498/2275/11 | 9750/23/11 | 6 | 2,258 |
| webkit-host | smoke / ws / policy / runs | 104 / 103 / 408 / 21 | 81/23, 88/15, 383/25, 20/1 | 104/0, 103/0, 408/0, 21/0 | 0 | 23 / 15 / 25 / 1 |
| webkit-host | dev suite | 19,878 | 15640/4235/3 | 19860/15/3 | 5 | 4,225 |
| webkit-host | held-out suite | 9,846 | 6642/3183/21 | 9793/32/21 | 20 | 3,171 |

Suite widths, pass / fail / unobserved / not-applicable:

| Browser | Sample | Main | Rebuild |
|---|---|---|---|
| Chrome | dev | 7569/6841/272/5312 | 15105/1181/3368/340 |
| Chrome | held-out | 2420/2526/385/4669 | 5165/1274/3080/481 |
| Firefox | dev | 12406/2358/2009/2987 | 15132/455/3377/796 |
| Firefox | held-out | 2312/3130/1158/3184 | 5728/424/3331/301 |
| webkit-host | dev | 11009/2010/1876/4983 | 14376/37/5284/181 |
| webkit-host | held-out | 3222/1210/1548/3866 | 4623/46/4858/319 |

Where main passes a line count and the rebuild fails (development suite):

- Chrome: 16 of 25 are `suite/original-vs-reshaped-admission`, Amiri brackets after Arabic.
- Firefox: 10 of 14 are an invisible character at a paragraph start before joined Arabic.

Main's own failures are mostly control characters (2,774 of Chrome's 4,593) and emoji sequences with soft hyphens.

## 3. Costs

measureText calls per paragraph, mean, from the final runs (the rebuild counts calls that reach Canvas after its memo; main's are one cold prepare per case):

| Engine | smoke | runs | ws | policy | dev suite: mean / median / p95 / max | held-out suite: mean / median / p95 / max |
|---|---:|---:|---:|---:|---|---|
| Blink | 47.6 | 68.6 | 38.8 | 47.3 | 40.7 / 24 / 106 / 10,241 | 77.1 / 18 / 34 / 71,378 |
| Gecko | 39.0 | 47.6 | 27.8 | 41.6 | 30.1 / 15 / 83 / 15,981 | 47.5 / 4 / 24 / 26,912 |
| WebKit | 16.5 | 23.1 | 15.4 | 16.0 | 12.5 / 6 / 38 / 2,059 | 20.6 / 5 / 9 / 20,279 |

Main on the same suite cases:

| Browser | Dev suite | Held-out suite |
|---|---|---|
| Chrome | 20.5 / 10 / 50 / 1,832 | 21.8 / 6 / 15 / 17,937 |
| Firefox | 20.3 | 21.4 |
| webkit-host | 28.7 / 10 / 94 / 5,045 | 39.2 / 5 / 15 / 39,477 |

The held-out maxima are corpus paragraphs of up to 257,000 UTF-16 units.

Prediction time, summed over the development suite sample (about 20,000 cases, cold):

| Browser | Rebuild | Main |
|---|---|---|
| Chrome | 9.6 s (median 0.2 ms, p95 0.8 ms, max 884 ms) | 1.5 s |
| Firefox | 21.4 s | 1.4 s |
| webkit-host | 1.8 s or more | 2.2 s |

Firefox's and WebKit's timers report whole milliseconds, so most of their cases read 0.

Library lines, without tests and generated data:

| Module | Lines | Test lines |
|---|---:|---:|
| `index` / `model` / `env` / `engine` | 295 | |
| `paint.ts` | 227 | |
| `measure/` | 110 | |
| `unicode/` | 1,468 | 491 |
| `breaks/` | 506 | 172 |
| shared total | 2,606 | 663 |
| `engines/blink` | 3,461 | 332 |
| `engines/webkit` | 3,180 | 296 |
| `engines/gecko` | 2,571 | 406 |
| **total** | **11,818** | **1,697** |

For comparison, main's `src` is 6,862 lines without tests. Around the library: generators and oracles 1,191 lines, the lab 5,300, probes 7,822, and 7.7 MB of pinned input data that isn't shipped.

Generated data:

| Module | Size |
|---|---:|
| `blink-break-tables.ts` | 587 KB |
| `webkit-break-tables.ts` | 644 KB |
| `gecko-break-data.ts` | 41 KB |
| Gecko props | 62 KB |
| `bidi-data.ts` | 14 KB |
| **total** | **1.35 MB** |

The lab page bundle is 1.74 MB; main's generated table is 29.5 KB. The tables still hold reverse tables and rule source that nothing reads.

Tests:

- `bun test rebuild/src`: 137 tests in 7.7 s, including building the ICU bidi oracle with clang.
- `bunx tsc`: 0.85 s.
- `bun test rebuild/lab/score.test.ts`: 18 tests.
- Lab case time for all sets, both orders: Chrome 316 s, Firefox 449 s, webkit-host about 420 s.

## 4. Canvas-versus-DOM gaps, how often they fired

Counts cover all final runs, development and held-out, every scored case. For each gap:

- **reports**: cases reporting it;
- **all-pass**: reporting cases that pass every metric;
- **fail**: reporting cases that fail at least one metric;
- **lift**: its share of failing cases divided by its share of all-pass cases. High means it locates failures; near 1 or below means it fires everywhere.

Blink (40,703 cases):

| Gap | Reports | All-pass | Fail | Lift | Canvas can't give |
|---|---:|---:|---:|---:|---|
| `unsafe-to-break` | 5,392 | 997 | 2,831 | 24.95 | reshapes at HarfBuzz's unsafe offsets: joining in AAT fonts, which glyph carries kerning |
| `font-fallback` | 1,027 | 370 | 379 | 9.0 | the font that draws U+FFFC, emoji sequences split across spans |
| `control-character-width` | 4,379 | 1,563 | 933 | 5.24 | Chrome's glyph for FF, VT and C0 controls |
| `script-context` | 21,259 | 15,328 | 2,514 | 1.44 | the script Common punctuation inherits; **weak** |
| `in-word-prefix` | 22,718 | 14,618 | 1,829 | 1.1 | per-glyph positions at breaks inside words; **weak** |
| `soft-hyphen-shaping` | 4,741 | 1,329 | 141 | 0.93 | |
| `tab-stops` | 811 | 618 | 47 | 0.67 | |
| `han-kerning` | 503 | 457 | 42 | 0.81 | |
| `ui-language` | 24 | 24 | 0 | | |

33 failing cases report no gap. 3 prediction failures have no gap that locates failures.

Gecko (40,256 cases):

| Gap | Reports | All-pass | Fail | Lift |
|---|---:|---:|---:|---:|
| `in-word-prefix` | 10,234 | 5,752 | 2,136 | 4.83 |
| `bitmap-emoji-size` | 84 | 46 | 38 | 10.74 |
| `ui-language` | 24 | 15 | 9 | 7.8 |
| `space-in-shaping` | 15 | 11 | 1 | 1.18 |
| `font-fallback` | 8 | 8 | 0 | |

195 failing cases report no gap; most are painter losses and 1-app-unit rounding. 21 prediction failures have no gap that locates failures.

WebKit (40,428 cases):

| Gap | Reports | All-pass | Fail | Lift | Note |
|---|---:|---:|---:|---:|---|
| `hyphen-glyph` | 12,145 | 2,892 | 1,836 | 4.61 | mostly painter failures; 80 prediction failures |
| `control-character-width` | 5,336 | 1,883 | 1,358 | 5.24 | |
| `canvas-language` | 8,477 | 7,429 | 538 | 0.53 | **weak** |
| `letter-spacing-ligatures` | 5,040 | 3,992 | 407 | 0.74 | |
| `fixed-pitch-path` | 4,271 | 3,727 | 86 | 0.17 | |
| `simplified-measuring` | 3,139 | 2,538 | 385 | 1.1 | |
| `string-storage` | 1,194 | 1,099 | 56 | 0.37 | |
| `rtl-shaping-across-inline-boxes` | 862 | 748 | 78 | 0.76 | |
| `dictionary-breaks-stand-in` | 31 | 23 | 8 | 2.53 | |
| `ui-language` | 22 | 14 | 8 | | |

585 failing cases report no gap, mostly painter losses. 16 prediction failures have no gap that locates failures.

Never fired in these runs, because no lab case meets their conditions: `optical-size`, `font-size-quantization`, `page-zoom`, `float32-precision` and `dictionary-breaks-unavailable`. Every lab size is a whole px, and no case uses system-ui or page zoom.

## 5. Verified in installed browsers, and only from source

Verified:

- **Installed Chrome 153**:
  - 84 spec probes and 7 cross-cutting probes: 75 confirmed, 9 refuted;
  - follow-ups F1 to F4, the ignorables probes, and the blink-gaps H5-H8 and H12 run at 11:18, which no spec records;
  - every Chrome lab run.
- **Installed Firefox 156**:
  - 91 probes: 87 confirmed, 3 refuted, 1 not run;
  - F1 to F3 and the emoji-font probe;
  - every Firefox lab run.
- **webkit-host**:
  - 79 probes: 71 confirmed, 1 refuted, 2 inconclusive, 5 not run;
  - 118 cross-check probes;
  - F1 and B5;
  - every WebKit lab run.
- **Installed Safari 27.0**: only main's old suite rows and the one smoke run. No probe, no prediction from the rebuilt library, and Canvas numbers never compared.

From source or inference only:

- page zoom in all browsers; WebKit has no page API for it, and C10 was checked only through CSS zoom;
- a physical DPR 1 display;
- Safari app state: the WebContent ICU default locale, preferred languages, default generic fonts;
- painter.md probes, including probe 5 (R7), which Firefox rows contradict at narrow widths;
- bidi paragraph builders, beyond lab rows;
- WebKit H6, the soft-hyphen revert loop, and H22, the first line with letter spacing;
- which WebKit cache makes the Amiri cases history-dependent. `TextBreakingPositionCache` is confirmed for break-spaces; TextMeasurementCache is suspected, not confirmed;
- gecko-canvas H24a, and the Rust oracle replay for Gecko break scans;
- WebKit's dictionary path, which has no oracle beyond 282,337 positions against libicucore;
- Chrome 153's pinned HarfBuzz, which wasn't checked out (152's was read), and the AAT context claims [I].

## 6. Known remaining failure classes

Blink:

- **Soft hyphens in RTL runs, an observation problem.** Chrome draws the hyphen, but its rect has zero width, so predicted minus native equals the hyphen width (682, 660 or 756 units). That is 575 of the 1,181 development suite width failures and 630 of the 1,274 held-out ones (lab/ISSUES.md, still open).
- **Arabic joining at line or group edges in Geeza Pro** (AAT, `unsafe-to-break`): `runs/bidi-runs` widths, development 80 and held-out 88; `split-word`. This is the joining-model decision in §7.
- **U+FFFC**, drawn with a fallback glyph; Canvas measures it as U+200B. All 138 held-out cases fail (`font-fallback`).
- **C0 and C1 controls** in held-out families, 35 to 51 of about 137 each (`control-character-width`).
- Emoji sequences split across spans.
- Which glyph carries legacy `kern` at a line end.
- Untracked tab stops.
- Painter losses:
  - Han kerning trims that depend on the next line;
  - bidi lines one LayoutUnit wider under override spans (L9);
  - CR and FF control items marked `collapsed`.

Gecko:

- **Joined forms at a break inside a word** (`in-word-prefix`): a soft hyphen in joined Arabic and around invisible characters (`suite/U+200C`…`U+FEFF` widths, development 64 each; held-out `joined` 22, `joined-plain` painter 19).
- Kerning and ligature shares at in-word breaks, such as `AV­ATAR` and `of­fice` (held-out `latin` 14).
- A ligated emoji split by a soft hyphen, painter only (84 per family).
- Device-size emoji rounding.
- 1 app unit per glyph of rounding, a model limit.
- Painter losses L1, L2 and L7.

WebKit:

- **Fonts chosen by language** (`canvas-language`): `runs/lang-spans`, development 133 of 373 and held-out 136 of 359; `policy/zh-lang` 27.
- Ligatures under letter spacing.
- `.notdef` controls, 26 to 34 per held-out control family.
- Page history (TAKE-BACK 5.1).
- Painter losses:
  - the carried rest of a split word, measured fresh when painted;
  - a word whose following space starts the next line;
  - RTL lines under override spans, one float32 step off;
  - the soft-hyphen painter groups;
  - `suite/negative-space` (58).

## 7. Open decisions

1. **Installed Safari numbers.** Run the final sets in installed Safari during a window while Safari isn't frontmost, about 15 minutes. **Recommendation:** schedule it before any WebKit claim leaves this branch.
2. **Blink joining model** at shaping-group and line edges: OpenType, the current choice, against AAT. Over 5,272 Arabic cases the OpenType model gains 562 line counts and loses 111 widths. **Recommendation:** keep OpenType; Geeza Pro losses stay under `unsafe-to-break`.
3. **History-dependent layouts** (WebKit's break-position cache and string storage, Firefox's emoji state). **Recommendation:** keep excluding them through two-order runs, add a named `page-history` gap, and file the WebKit and Firefox reports in TAKE-BACK §5.
4. **String storage.** Text whose every character is at most U+00FF is assumed to be stored 8-bit. **Recommendation:** keep the assumption and document that text from `Response.json()` of a body with non-Latin-1 characters breaks under 16-bit rules in Safari.
5. **Gaps that don't locate failures**: Blink `script-context` and `in-word-prefix`, WebKit `canvas-language`, `fixed-pitch-path`, `letter-spacing-ligatures` and `string-storage`. **Recommendation:** report them only at the line edges actually chosen, as the Gecko owner did (gecko-AUDIT B2), before gaps become public API.
6. **API.** **Recommendation:** make prepare once, then `nextLine` at any width, public; keep the measure log and gaps experimental; document that a `LineStart` is valid only at its width.
7. **Performance.** **Recommendation:** leave it until after correctness, as briefed. Start with Gecko's in-word checks and huge paragraphs (up to 71,378 calls), Blink's reshapes, and table compaction.
8. **Painter.** **Recommendation:** keep it in the library. Mark Blink's CR and FF control items as zero-width `text` fragments, which is not an additive model change.
9. **How the work lands.** **Recommendation:** land TAKE-BACK's code items in main now: control widths, U+2060, emoji at device size, the Safari 27 keep-all change. Keep the rebuild on its branch until items 1 and 5 are settled.
10. **UI and system language facts** can't be read from page APIs. **Recommendation:** keep reporting `ui-language`, and tell developers to set `lang` explicitly.