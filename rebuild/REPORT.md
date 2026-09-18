# Pretext rebuild: report

Branch `rebuild-20260916`, forked from main 2e5e2bd, on this Retina Mac under macOS 27, 2026-09-16. Paths are relative to `~/github/pretext-rebuild`.

The brief:

- from a font declaration and styled runs, predict the lines each installed browser draws: where lines break, how many there are, and how wide each is;
- paint those lines with the DOM;
- measure only with Canvas `measureText`: no DOM reads for widths, no font files;
- pin engine code and data to Chrome 153.0.8010.48, Safari 27.0 (WebKit 7625.1.29.11.27, macOS 27 libicucore) and Firefox 156.0 (ICU4X 2.1.2 baked data);
- no epsilons, and every Canvas-versus-DOM gap handled on purpose or named.

Headlines (the ceiling round 3 evaluation of 2026-09-18, with the lab's font facts; "Round 4a" below has what changed
since, and the headline configuration from here on is the one with no supplied font facts):

- **With no supplied font facts and the library asking Canvas itself** (round 4a, five sets pooled, about 75,000 cases a
  browser): line counts match on 99.50% in Chrome (99.60% with the lab's font table, 98.28% before the checks), 99.82% in
  Firefox and 99.77% in webkit-host; widths on 94.52%, 95.54% and 95.18%.
- **Line counts match the browser** on 99.23% to 99.94% of suite-sample cases: development, the burned held-out set of 2026-09-16 and the sealed-3 held-out set run for the first time, in Chrome 153, Firefox 156 and webkit-host, with installed Safari 27.0 in §2.7 (§2.3). Observed suite widths pass on 98.85% to 99.87% in Chrome, 95.81% to 97.86% in Firefox and 99.66% to 99.86% in webkit-host. The rates are pass ÷ (pass + fail); unobserved cases are left out. Main's library got 63.7% to 89.7% of line counts on the development and 2026-09-16 samples (§2.5, not refreshed this round).
- **Against ceiling round 2 under the same scorer**, Chrome lost no line count, break or width; Firefox lost 10 line counts and 25 breaks and webkit-host 8, 8 and 1 width, every one with a covered explanation and an attribution (32 of Firefox's passed by accident before). Gained, lineCount / breaks / widths: Chrome 23 / 42 / 26, Firefox 187 / 378 / 1,242, webkit-host 106 / 166 / 98 (§2.4).
- **The ceiling, measured on three fresh sets per browser that nobody had seen (100,749 cases, §2.8):** failures without a covered explanation are 1.76 per 10,000 cases in Chrome (6 rows in three new classes, one in every set), 0.30 in Firefox (1 row, in a class its owner had found) and 0.30 in webkit-host (1 row, a named observation consequence). Two unseen sets in a row without a new class: Firefox and webkit-host yes, Chrome no (without any open row at all: webkit-host only). **So the ceiling isn't reached in Chrome**, and known classes stay open in the other two. No residual class had a member on any set, because Firefox measured on a detached `<canvas>` element; the maintainer has since decided that Firefox measures on an OffscreenCanvas always, which brings the 1 au class and synthetic bold back as named residual classes (Round 4a; CHARTER.md, decision 2).
- **Installed Safari 27.0 lays out text exactly like webkit-host.** As a spot check in parts under 8 minutes it ran the combined development file and the combined rule and feature families file in both orders: every native view, prediction and score equals webkit-host's case by case, and no job failed (§2.7).
- **Cost:** Canvas calls per paragraph rose again in round 3, by 13% to 34% in Chrome, 29% to 89% in Firefox and 12% to 153% in webkit-host, and summed prediction time on the small sets is 1.6 to 2.4 times round 2's in Chrome, 2.5 to 4.7 times in Firefox and 1.4 to 2.2 times in webkit-host (§3). Recorded only.
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

## Round 4a, 2026-09-18, after the evaluation below

§2 to §7 hold the ceiling round 3 evaluation's numbers, measured with the lab's font facts and with Firefox on a detached
`<canvas>` element. Round 4a changed both under the decisions of 2026-09-18 (CHARTER.md): the headline is with no
supplied font facts, and Firefox measures on an OffscreenCanvas always. What follows are the owners' measurements
(`.artifacts/session/round4a-reports.json`; the engines' write-ups are specs/{blink,gecko,webkit}-RESULTS.md, each under
"round 4"), all in the pinned Chrome 153.0.8010.50 and Firefox 156.0 and in webkit-host, DPR 2, forward order, scorer 5
unless said. Round 4b is trimmed on purpose (decision 3), and the evaluation after it replaces §2 to §7.

**The headline with no supplied font facts** (font checks owner; FACTS-FREE.md's five sets: development, held-out 09-16,
rule families, feature families and one fresh set; "table" is the lab's font table, "none" round 3's library with
`UNKNOWN_FONT_FACTS`, "checks" the same no-facts predictor with `src/measure/font-checks.ts`):

| Browser | Cases | lineCount: table / none / checks | breaks | widths | painter |
|---|---:|---|---|---|---|
| Chrome | 75,951 | 99.60 / 98.28 / **99.50** | 99.52 / 97.79 / **99.36** | 95.13 / 91.63 / **94.52** | 90.90 / 90.34 / 90.67 |
| Firefox | 73,236 | 99.86 / 99.82 / **99.82** | 99.69 / 99.59 / **99.59** | 95.99 / 95.54 / **95.54** | 88.71 / 88.70 / 88.70 |
| webkit-host | 73,414 | 99.77 / 99.76 / **99.77** | 99.44 / 99.43 / **99.44** | 95.18 / 95.14 / **95.18** | 85.92 / 85.88 / 85.92 |

- Chrome recovers 925 of 1,001 lost line counts, 1,196 of 1,311 breaks and 2,197 of 2,658 widths, equal per set to
  FACTS-FREE.md's projection; webkit-host equals the table on every set and metric; Firefox doesn't move, because nothing
  it loses is learnable from its Canvas. Firefox's runs here still used the canvas element.
- On a new fresh set (`r4-font-checks-1`), table / none / checks: Chrome (11,314 cases) lineCount 99.81 / 99.28 / 99.74,
  breaks 99.75 / 98.66 / 99.65, widths 97.90 / 94.46 / 97.22; Firefox (11,066) 99.89 / 99.86 / 99.86, 99.78 / 99.73 /
  99.73, 97.15 / 96.38 / 96.38; webkit-host (10,966) 99.78 / 99.78 / 99.78, 99.35 / 99.33 / 99.35, 94.29 / 94.23 / 94.29.
- No case that passed lineCount, breaks and widths without facts fails with the checks, and no native observation differs
  on 256,381 compared cases, so the checks' Canvas fonts moved no DOM layout. With the lab's table supplied the library
  scores as round 3's did on the 8 big Chrome and webkit-host sets.
- Against the lab's font table over 146 declarations the checks never disagree; Chrome's joining answers match the DOM at
  a shaping edge on 143 of 143 and stay unknown for 10 fixed-pitch declarations.
- Gaps on passing lines, table / none / checks: Chrome `optical-size` 0.21 / 99.92 / 3.80%, `joining-technology` 0 / 2.03 /
  0.06, `hyphen-glyph` 0 / 1.05 / 0; webkit-host `fixed-pitch-path` 0.12 / 28.25 / 0.33, `hyphen-glyph` 0 / 2.71 / 0.
- Chrome's 47 rows without a covered explanation under no facts (of 1,352 failing) are 4 known rows plus one class that
  needs `pairKerning`: positions between kerned glyphs inside a line reported as predicted with no gap, which
  `optical-size` masked while it fired on every line (a round 4b Blink item).
- Cost: per declaration once per measurer, 9.5 calls in Chrome and 9.4 in webkit-host for Latin text, 0 in Firefox. While
  a measurer lives one paragraph that is +13.7 calls a paragraph in Chrome (+16%) and in webkit-host (+61%).
- Still needs a supplied fact: `pairKerning` (most of Chrome's 537 cases behind the table and 389 of Firefox's 412),
  `ligatures` and `coverage`, `scriptLookups`, `joining` for fixed-pitch Arabic, `opticalSizeAxis` for the system UI font,
  and everything in Firefox.

**Firefox on an OffscreenCanvas only** (Gecko owner; the round 3 library with only that change, against the evaluation's
element-path rows, both orders agreeing):

| Sets | lineCount lost / gained | breaks | widths | What |
|---|---|---|---|---|
| development (25,390) | 0 / 0 | 0 / 0 | 26 / 3 | 11 rows of the 1 au class; 15 bold bitmap emoji under `bitmap-emoji-size` |
| held-out 09-16 (15,196) | 0 / 0 | 0 / 0 | 25 / 0 | 6 rows of the 1 au class; 18 bold bitmap emoji; 1 U+1F600 U+FE0E history row |
| rule families, r3 derivation (9,776) | 32 / 8 | 96 / 24 | 192 / 0 | all `rule/system-fonts-and-sizes` under `optical-size` |
| feature families, r3 derivation (12,050) | 0 / 0 | 0 / 0 | 0 / 0 | |

- The 33 bold bitmap emoji rows are predicted by the final library (synthetic bold's steps, probe F24), so they cost
  nothing. The final library's failures without a covered explanation on the defined sets are the 17 rows of the 1 au
  class, in both orders; passing cases with a wrong predicted value went from 30 to 6 (Noto Nastaliq Urdu, 1 au).
- Three fresh sets (48,290 cases): prediction failures 236, 219 and 255; 1 au class 11, 0 and 12; open 0, 3 and 6, all
  synthetic bold (U+2764 alone in a bold span), which the scorer's registry doesn't hold yet; no new class.
- With no supplied facts: development lineCount 99.91% to 99.90%, breaks 99.90% to 99.88%, widths 98.26% to 98.06%;
  held-out widths 97.35% to 97.07%; rule families lineCount 99.19% to 98.96%, widths 94.64% to 93.72%. `optical-size` is
  then reported on 24,488 of 25,013 development cases, and values reported as predicted fall from 96.3% to 6.5%.
- `page-history` in both orders reports 123 of 123 and 190 of 190 history-dependent cases; the history-dependent set itself
  isn't stable between identical runs (190 and 104 on the held-out suite sample). The 9 giants pass. Canvas calls per
  paragraph are within 2% of the element path.

**Blink** (build b8 against round 3's w18): no line count, break or width lost on 73,260 cases, `suite/joined` gained 24
breaks; of the evaluation's three classes the marked waw passes every metric, U+3000 across a wrap passes lineCount,
breaks and widths with the coverage fact, and the ProbeShantell exact fit is traced and covered, still failing; passing
cases with a wrong predicted value are 0 on every defined set and on three fresh sets; fresh sets `r4-blink-1` to `-3`
(33,679 cases) have 0, 1 and 0 open rows, the one a new RTL view-cut class covered in b8; predicted values agree on
99.983% to 99.987% with 72.5% to 73.8% of values predicted; all 14 giants pass every metric with exact values;
`float32-precision` fires on 0.25% of passing development lines (5.69%).

**WebKit** (predict-only against the evaluation's native rows, both orders; nothing lost on any metric of any set):

| Set | Cases | lineCount fail | breaks fail | widths fail | painter fail | Prediction failures | Open |
|---|---:|---|---|---|---|---|---|
| development | 25,180 | 20 to 9 | 71 to 18 | 130 to 26 | 1,260 to 1,114 | 201 to 44 | 0 to 0 |
| held-out 09-16 | 15,196 | 40 to 31 | 84 to 43 | 162 to 46 | 2,231 to 2,078 | 246 to 89 | 0 to 0 |
| families | 21,734 | 51 to 43 | 86 to 78 | 177 to 177 | 910 to 910 | 263 to 255 | 0 to 0 |

- `canvas-language` fires on 1.1% of passing development lines (15.4%), lift 18.3 (5.6): a named family settles its own
  characters under every locale, and generic keywords are measured as the family Core Text resolves them to. With no
  supplied facts: development 10 / 19 / 34 failing, held-out 32 / 46 / 55, open 0.
- Fresh sets `r4-webkit-1` to `-3` (32,611 cases): 133, 155 and 86 prediction failures, 115 per 10,000 (evaluation: 207), 0
  open. 250 of the 374 are `page-history`, and all 250 pass lineCount and breaks alone in a fresh process, so a one-order
  fresh set overstates webkit-host's failures threefold; outside page history it is 38 per 10,000.
- Canvas calls per paragraph on the development file: 22.7 (37.2), about a third of them diagnostic
  (`simplified-measuring` singles 14.5%, `canvas-language` 10.1%, `font-fallback` 5.2%, `page-history` 3.9%).

**Tests and scorer.** Tiers 0 to 2 (lab README, "Test tiers"; TESTS.md "Tiers"): on the six recordings of 2026-09-18 all
380,882 cases replay the browser's own prediction exactly, and two independent both-orders runs of one library gave 0
status transitions over 190,441 cases. Scorer 6 against scorer 5 on round 3's rows: no metric status changes; the three
`suite/U+FFFC/start` rows go from open to covered, and the WebKit rows `c-653ac96abf5487ff`, `c-9a66d090891a825d` and
`c-4bb3746469073e4d` are covered. With painter limits recorded, painter-only failures without an explanation (facts
configuration, development) are Chrome 1 (14), Firefox 6 (451) and webkit-host 4 (960). The references, ledgers and staged
seeds under `.artifacts/tests` describe the round 3 library until they are recorded again after round 4's merges.

**Canvas checks at engine detection** (round 4b; DESIGN.md §1.4). `detectEngine()` answers unsupported, by name, where the
running Canvas lacks what the engine's recipes assume. Probe `probes/canvas-checks.ts`, the library's own module in the
page: supported in the pinned Chrome 153.0.8010.50, Firefox 156.0 and webkit-host and in Chrome 152.0.7977.82 and
155.0.8048.0 and Firefox 153.3.0esr and 157.0b2; Firefox 140.16.0esr, where VERSION-DRIFT.md measured line counts at
89.2%, is refused for the missing `lang`, the 0.001px letter spacing it keeps as a fraction (0.00104px a character over 16
letters; nothing on one or two) and the ink box that spacing moves. Nothing in the lab calls it, so tier 1 (all six
references) and tier 2 (Firefox, no facts, 62,437 cases) are unchanged case by case against the tree before it.

## 1. What was built

### 1.1 Architecture

The library takes a paragraph and an environment. The paragraph is a tree of inline content (DESIGN.md §1.1): text leaves, spans with their own font, letter and word spacing, `lang`, wrapping styles, box edges and `vertical-align`, atomic inlines, `<br>` and `<wbr>`, plus the block's width, `text-indent`, `text-align`, direction and `lang`, and optionally an available width per line (line slots). The environment is the engine, the DPR, the page language and the UI languages.

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
- `measure/`: OffscreenCanvas contexts identified by their settings, a memo per layout, and the call log; the runtime font checks, which answer a font fact the caller left null where a Canvas check is sound (`font-checks.ts`); and the Canvas checks of engine detection (`canvas-checks.ts`);
- `paint.ts`, with one engine switch, for the hyphen span;
- the generators, which check sha256 hashes of pinned engine data.

Thai, Lao, Khmer and Myanmar breaks come from the running browser's own segmenter.

The painter draws each line as a block at the paragraph's width, with the paragraph's wrapping styles and one node per run slice. It keeps trimmed and hanging white space, draws the hyphen as its own span, puts U+200D at joined line edges, and uses nested bidi-override spans.

The lab (`rebuild/lab/`) drives the browsers in background windows under the lock. It derives native lines from Range rects alone and scores the four metrics.

### 1.2 API shape

```ts
detectEngine(): { kind: 'supported'; engine } | { kind: 'unsupported'; userAgent; reason }   // once per page: user agent, and what the engine's recipes assume of Canvas
detectEnvironment(given: GivenFacts): { kind: 'supported'; env } | { kind: 'unsupported'; … }  // DPR, <html lang>, segmenters; again when they change
layoutParagraph(paragraph, env, slots?): { engine; env; lines; belowFloats; measure: MeasureLog; gaps: Gap[] }
prepareParagraph(paragraph, env) → firstLineStart(prepared) → layoutLine(prepared, start, slot)   // one line slot at a time
paintLines(paragraph, layout, document): HTMLElement[]        painterLimits(paragraph, layout): PainterLimit[][]
Line = { start; end; fragments; hasLineBox; joinsNextLine; slot; indented; align; gaps; next: LineStart | null;
         geometry: the engine's own (Blink items in LayoutUnits, WebKit display boxes in float32 px, Gecko frames in app units) }
Gap = { gap: GapName; run: number | null; detail: string; at?: { start; end } }   // on the paragraph and on each line
```

Each engine implements `prepare`, `firstLine`, `nextLine(prepared, start, slot, measurer)` and `gaps`. A `LineStart` is valid
only for the slot that produced it. There is no prepare-once, lay-out-at-many-widths API, and nothing is kept across
paragraphs: a measurer lives one paragraph. API shape is an open question for after the freeze (CHARTER.md, decision 3).

## 2. Numbers

### 2.1 Method

The numbers in §2-§7 are the ceiling round 3 evaluation of 2026-09-18 (`rebuild-20260916` at the tag `round3-work-done`,
4c17b90). They replace the ceiling round 2 evaluation's numbers, which stay in git history (REPORT.md at 1f85a82); §2.4
compares the two case by case, and research/ROUND2-EVALUATION.md and ROUND2-CRITIC.md hold round 2's verdict and its
corrections. §2.5 (main) wasn't refreshed: this round ran no main comparison and no triage refresh.

- Library: `rebuild/src` and `rebuild/lab` at `round3-work-done`, the round 3 fix phase (scorer, fresh tools, font facts,
  lab infrastructure, Blink, WebKit, Gecko and painter owners). Every one of the evaluation's 216 run records holds the same
  library bundle, sha256 `80b6b4b8004c…`, the bundle of the Gecko owner's last regression run. `bunx tsc` is clean over
  `rebuild` and `rebuild/lab`; `bun test rebuild` has 603 passing and 2 failing tests, neither in engine code (§2.6).
- Predictions go through `rebuild/lab/predictor.ts` with the lab's font fact table (round 3's `FontFacts.fonts` included),
  the build read from the app bundle and the browser-process languages the driver records: Chrome `uiLanguage` zh-CN,
  Firefox `regionalPrefsLocale` zh-hans-us, webkit-host and Safari `preferredLanguages` zh-CN,zh-Hans with ICU default
  locale `en_US_POSIX`. The headline numbers are with the lab's facts; research/FACTS-FREE.md measures the same library
  without them.
- Scorer: `rebuild/lab/score.ts` version 5 (lab/README.md, "Covered failures", "Residual classes"). A gap covers a failing
  line only where its range touches every contributing run of units that differ there, or, for a pure break decision, the
  text between the predicted and the native break; a gap elsewhere on the line covers nothing. Residual members are counted
  apart, probed ones apart from members matched by signature. Widths of indented lines are observed in Chrome and Firefox.
  Round 2's rows were re-scored with scorer 5 by the scorer owner (`.artifacts/ceiling-20260917/rescore-s5/`, every file
  written by the final scorer of 21:09), so §2.4 is the library change alone.
- Browsers, all at DPR 2 on macOS 27.0 (26A428), 01:54 to 02:49: the lab's pinned copies of Chrome 153.0.8010.50 and
  Firefox 156.0 (`~/github/browser-engines/apps`, tree hashes `712aa9f5…` and `30499e6f…`), webkit-host on WebKit
  22625.1.29.11.27, and installed Safari 27.0 as a spot check (§2.7). The library accepts .50 as source-identical to its
  .48 pin, so no row reports `engine-build`.
- Sets, every one in file order and in reverse, each run scored against the other order with `--native-compare`:
  - rule families and feature families twice: the case files round 2 ran (for §2.4 and the gates against the current
    seeds; Firefox's and webkit-host's feature files still hold round 1's 15 and 7 slot protocol rows), and the families
    derived again in round 3 (`.artifacts/tests/derive-r3-20260917`: Chrome 11,154 and 13,010 plus 468 `process-languages`
    cases under en-US, Firefox 9,776 and 12,050, webkit-host 9,726 and 12,268; no protocol row), which the staged seeds
    come from;
  - development: smoke, runs, ws, policy and the 20,000-case suite sample in 4 parts;
  - held-out 09-16: runs, ws, policy, the suite sample in 2 parts without its 9 giants, and the giants set
    (`.artifacts/lab/cases/giants.ndjson`, 106,857 to 269,747 units) on its own. Burned; development cases now;
  - sealed-3: `sealed-3-20260917`, runs 2,580, ws 1,011, policy 1,594, a 9,996-case suite sample cut into 3 parts by
    `cases/parts.ts`, and 4 giants, run here for the first time. All 11 file hashes equal `SEAL.json` and the repository
    record, the generator sources are unchanged since sealing, and none of the 2,720 run records written since sealing
    names a sealed-3 file. Scored once with `score.ts --sealed`; `evaluate-r3/tools/sealed-counts.ts` adds counts of
    covered, residual, open and weakly covered rows with the scorer's functions and writes no case id, text, font or
    family. No sealed case, family or example was opened;
  - fresh sets, the ceiling measurement: seeds `eval-r3-1` to `-3` (`lab/fresh.ts --both-orders`; owners used `r3-*`, the
    tools owner `r3-tool-check-*`, the facts-free measurement `facts-free-*`), every generator kind (runs, ws, policy, a
    3,000-case suite sample of unused suite cases, and the family paragraphs of round 3's derivations at seeded widths):
    11,343 to 11,403 Chrome cases a set, 11,105 to 11,170 Firefox, 11,030 to 11,102 webkit-host, 100,749 in all, on the same
    flat cases in the three browsers. Nobody had seen them; they held no giant.
- Jobs ran under the browser lock's slots without pauses: 142 per-set jobs in under 7 minutes (the suite samples' parts at
  the same time), 54 fresh-set jobs in 3 minutes, 8 combined-file jobs in installed Safari and webkit-host, and the 12 giants
  jobs exclusively, one case per round trip (Chrome 132 to 168 s a job, Firefox 10 to 15 s, webkit-host 236 to 327 s). No
  browser job failed, so none ran twice. No main comparison and no triage refresh.
- Tools and outputs: `.artifacts/ceiling-20260917/evaluate-r3/` (`tools/`: `make-jobs.py`, `run-jobs.py`, `fresh.sh`,
  `combined.sh`, `giants.sh`, `score-eval.sh`, `score-all.sh`, `sealed-counts.ts`, `sealed-extras.sh`, `aggregate.ts`,
  `gaps.ts`, `gaps-all.sh`, `firing.sh`, `firing-table.py`, `extras.py`, `gates.sh`, `tests-seed-record.ts`,
  `attribute-records.py`, `report-tables.py`, `report-sections.py`; `aggregate-<browser>.md` and `.json`, `gaps/` and
  `gaps-r2/`, `firing/`, `extras.md`, `gates/`, `safari-vs-host-*.json`, `report-tables.md`, and per set
  `<browser>/<set>-{forward,reverse}/`); the fresh sets are under `.artifacts/lab/fresh/<browser>/eval-r3-<n>/`.

Metrics and facts are defined as in lab/README.md "Scoring": lineCount, breaks, widths (where breaks pass) and painter;
predicted, limited and unobservable facts.

### 2.2 Observation agreement

Equal ÷ compared, forward runs, every case outside history dependence and protocol rows. Rect counts and line membership are
counted per range. The family rows are round 3's derivations. Predicted share is predicted ÷ (predicted + limited) values.

| Browser | Group | Rect counts | Predicted values | Predicted share | Limited values | Line membership | Unobservable facts |
|---|---|---|---|---:|---|---|---:|
| Chrome | rule families | 197,364 of 197,638 (99.861%) | 355,935 of 356,430 (99.861%) | 74.7% | 114,225 of 120,772 (94.579%) | 235,778 of 235,877 (99.958%) | 3,850 |
| Chrome | feature families | 334,906 of 335,298 (99.883%) | 703,549 of 703,560 (99.998%) | 93.6% | 47,844 of 47,844 (100.000%) | 375,702 of 375,702 (100.000%) | 5,149 |
| Chrome | development | 1,106,081 of 1,106,208 (99.989%) | 1,482,717 of 1,482,835 (99.992%) | 61.7% | 879,518 of 921,421 (95.452%) | 1,201,887 of 1,201,889 (100.000%) | 45,116 |
| Chrome | held-out 09-16 | 2,259,561 of 2,259,673 (99.995%) | 1,816,343 of 1,816,472 (99.993%) | 38.2% | 2,845,113 of 2,938,534 (96.821%) | 2,377,111 of 2,377,123 (99.999%) | 92,104 |
| Chrome | sealed-3 | 2,173,956 of 2,174,055 (99.995%) | 3,591,789 of 3,591,942 (99.996%) | 78.7% | 942,374 of 974,258 (96.727%) | 2,282,762 of 2,282,774 (99.999%) | 137,212 |
| Firefox | rule families | 180,331 of 180,386 (99.970%) | 367,329 of 367,550 (99.940%) | 90.0% | 17,209 of 41,004 (41.969%) | 202,282 of 202,819 (99.735%) | 13,909 |
| Firefox | feature families | 307,550 of 307,550 (100.000%) | 625,882 of 625,882 (100.000%) | 94.4% | 35,458 of 37,056 (95.688%) | 330,121 of 330,121 (100.000%) | 19,163 |
| Firefox | development | 1,103,997 of 1,104,005 (99.999%) | 2,248,341 of 2,250,368 (99.910%) | 96.4% | 21,772 of 83,856 (25.964%) | 1,166,387 of 1,166,397 (99.999%) | 43,405 |
| Firefox | held-out 09-16 | 2,259,107 of 2,259,122 (99.999%) | 4,381,219 of 4,381,570 (99.992%) | 93.9% | 230,145 of 282,474 (81.475%) | 2,331,335 of 2,331,344 (100.000%) | 73,978 |
| Firefox | sealed-3 | 2,173,273 of 2,173,282 (100.000%) | 4,466,083 of 4,466,614 (99.988%) | 99.6% | 10,284 of 18,490 (55.619%) | 2,241,953 of 2,241,962 (100.000%) | 63,002 |
| webkit-host | rule families | 178,695 of 178,762 (99.963%) | 128,723 of 129,283 (99.567%) | 31.7% | 244,959 of 278,497 (87.958%) | 203,249 of 203,318 (99.966%) | 33,160 |
| webkit-host | feature families | 312,650 of 312,720 (99.978%) | 210,635 of 210,882 (99.883%) | 30.5% | 474,957 of 480,040 (98.941%) | 344,761 of 344,827 (99.981%) | 33,648 |
| webkit-host | development | 1,104,391 of 1,104,437 (99.996%) | 363,306 of 364,291 (99.730%) | 15.5% | 1,772,205 of 1,982,243 (89.404%) | 1,172,546 of 1,172,710 (99.986%) | 76,350 |
| webkit-host | held-out 09-16 | 2,257,580 of 2,257,654 (99.997%) | 414,230 of 415,246 (99.755%) | 8.9% | 2,948,733 of 4,257,810 (69.255%) | 2,335,826 of 2,335,976 (99.994%) | 61,686 |
| webkit-host | sealed-3 | 2,172,158 of 2,172,209 (99.998%) | 361,882 of 363,006 (99.690%) | 8.1% | 3,705,858 of 4,143,192 (89.445%) | 2,252,412 of 2,252,610 (99.991%) | 76,210 |

Predicted values against round 2's rows under the same scorer (`report-tables.md`, `extras.md`); the last two columns count
cases that pass lineCount, breaks and widths and still hold a predicted value that differs from the browser:

| Browser | Group | Agreement, round 2 → round 3 | Predicted share | Passing cases with a wrong predicted value |
|---|---|---|---|---|
| Chrome | rule families | 99.238% → 99.860% | 87.8% → 75.4% | 128 → 0 |
| Chrome | feature families | 99.952% → 99.998% | 99.7% → 93.6% | 179 → 0 |
| Chrome | development | 98.312% → 99.992% | 94.5% → 61.7% | 2,022 → 18 |
| Chrome | held-out 09-16 | 97.184% → 99.993% | 96.0% → 38.2% | 722 → 33 |
| Chrome | fresh sets | 99.979% | 73.2% | 11, 11 and 10 |
| Firefox | rule families | 93.420% → 99.957% | 46.0% → 90.8% | 108 → 0 |
| Firefox | feature families | 99.876% → 100% | 42.9% → 94.4% | 222 → 0 |
| Firefox | development | 98.949% → 99.910% | 31.0% → 96.4% | 6 → 23 |
| Firefox | held-out 09-16 | 99.534% → 99.992% | 29.6% → 93.9% | 17 → 7 |
| Firefox | fresh sets | 99.994% | 98.0% | 0, 0 and 1 |
| webkit-host | rule families | 98.940% → 99.600% | 31.7% → 31.7% | 70 → 11 |
| webkit-host | feature families | 99.882% → 99.882% | 30.5% → 30.5% | 12 → 12 |
| webkit-host | development | 99.724% → 99.730% | 15.5% → 15.5% | 5 → 3 |
| webkit-host | held-out 09-16 | 99.742% → 99.755% | 8.9% → 8.9% | 7 → 5 |
| webkit-host | fresh sets | 99.497% | 26.5% | 4, 6 and 11 |

- **Chrome's in-word positions are no longer reported as exact.** The Blink layout marks positions it takes from Canvas
  stand-ins, and the port reports a value as predicted only where it knows the item's x and the position inside it. The
  predicted share fell (development 94.5% to 61.7%) and agreement rose to 99.99%; passing cases with a wrong predicted value
  went from 2,022 to 18 on development and from 722 to 33 held-out. What is left: `suite/signed-spacing` (curly quotes and
  the ASCII matrix under signed letter spacing) 11 development and 23 held-out cases, and on the fresh sets
  `suite/raw-context` 14, `suite/hidden-control-spacing` 7 and `policy/overflow-wrap` 6 of 32. Not traced.
- **Firefox predicts 90% to 99.6% of its values** (round 2: 29% to 46%), at 99.91% to 100%. Its 23 development passing cases
  with a wrong predicted value are Myanmar corpus paragraphs, where U+1038 has a rect of its own natively
  (`suite/my-cunning-heron-teacher` 12, `my-bad-deeds-return-to-you-teacher` 8, `maintained/corpus` 3), and the 7 held-out
  ones are `maintained/corpus` paragraphs too (the owner traced 6 Noto Nastaliq Urdu cases to one in-word position 1 au off). On the evaluation's fresh sets such
  cases are 0, 0 and 1, and the history-dependent emoji cases hold exact predicted values in both orders (§2.8): the owner's
  count of about 100 a set under the emoji `page-history` range isn't reproduced.
- **webkit-host is unchanged in kind:** its code point rects snap to whole px, so most values stay limited, and the
  differing predicted values sit in failing `runs/lang-spans` lines. Passing cases with a wrong value: `rule/br-elements` 12
  and `rule/hanging-white-space` 10 on the families.

### 2.3 Scores, forward runs

Cells are pass / fail / unobserved, and widths add not-applicable. The reverse runs give the same lineCount and breaks cells
on every set. No row had a native, prediction or observation error, and no prediction raised `UnportedFeature`.

Chrome 153.0.8010.50 (no history-dependent case and no protocol row):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families, round 2's case file (10,976) | 10820/156/0 | 10774/202/0 | 10484/226/64/202 | 10330/582/64 |
| rule families | families, derived in round 3 (11,154) | 10998/156/0 | 10952/202/0 | 10662/226/64/202 | 10508/582/64 |
| feature families | features, round 2's case file (12,882) | 12882/0/0 | 12882/0/0 | 11655/0/1227/0 | 9163/156/3563 |
| feature families | features, derived in round 3 (13,010) | 13010/0/0 | 13010/0/0 | 11743/0/1267/0 | 9251/156/3603 |
| feature families | process-languages under en-US, round 2's file (468) | 468/0/0 | 468/0/0 | 468/0/0/0 | 468/0/0 |
| feature families | process-languages under en-US, derived in round 3 (468) | 468/0/0 | 468/0/0 | 468/0/0/0 | 468/0/0 |
| dev | smoke (299) | 298/1/0 | 298/1/0 | 296/0/2/1 | 296/1/2 |
| dev | runs (2,580) | 2578/2/0 | 2578/2/0 | 2567/7/4/2 | 2561/15/4 |
| dev | ws (1,019) | 1019/0/0 | 1019/0/0 | 1018/1/0/0 | 1013/6/0 |
| dev | policy (1,606) | 1606/0/0 | 1606/0/0 | 1606/0/0/0 | 1600/6/0 |
| dev | suite (19,994) | 19943/51/0 | 19941/53/0 | 19276/25/640/53 | 19243/88/663 |
| held-out 09-16 | runs (2,579) | 2578/1/0 | 2578/1/0 | 2572/4/2/1 | 2565/12/2 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1022/0/0/0 | 1017/5/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1604/0/0 | 1604/0/0/0 | 1592/12/0 |
| held-out 09-16 | suite (9,991) | 9914/77/0 | 9909/82/0 | 9052/87/770/82 | 8988/223/780 |
| held-out 09-16 | giants (9) | 9/0/0 | 9/0/0 | 9/0/0/0 | 9/0/0 |
| sealed-3 | runs (2,580) | 2579/1/0 | 2578/2/0 | 2567/7/4/2 | 2562/14/4 |
| sealed-3 | ws (1,011) | 1011/0/0 | 1011/0/0 | 1011/0/0/0 | 1010/1/0 |
| sealed-3 | policy (1,594) | 1594/0/0 | 1594/0/0 | 1594/0/0/0 | 1583/11/0 |
| sealed-3 | suite (9,996) | 9935/61/0 | 9932/64/0 | 9029/105/798/64 | 8957/231/808 |
| sealed-3 | giants (4) | 4/0/0 | 4/0/0 | 4/0/0/0 | 4/0/0 |


Firefox 156.0 (history-dependent: development suite 123, held-out 09-16 suite 104, sealed-3 suite 136, others 0; protocol rows: round 2's feature file 15):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families, round 2's case file (9,584) | 9529/55/0 | 9432/152/0 | 9056/376/0/152 | 8539/1045/0 |
| rule families | families, derived in round 3 (9,776) | 9721/55/0 | 9616/160/0 | 9224/392/0/160 | 8667/1109/0 |
| feature families | features, round 2's case file (11,946) | 11931/0/15 | 11931/0/15 | 10747/0/1199/0 | 8310/41/3595 |
| feature families | features, derived in round 3 (12,050) | 12050/0/0 | 12050/0/0 | 10866/0/1184/0 | 8421/49/3580 |
| dev | smoke (297) | 297/0/0 | 297/0/0 | 296/1/0/0 | 286/11/0 |
| dev | runs (2,580) | 2580/0/0 | 2580/0/0 | 2577/3/0/0 | 2513/67/0 |
| dev | ws (1,019) | 1019/0/0 | 1019/0/0 | 1019/0/0/0 | 1002/17/0 |
| dev | policy (1,606) | 1606/0/0 | 1606/0/0 | 1603/3/0/0 | 1584/22/0 |
| dev | suite (19,888) | 19741/24/0 | 19739/26/0 | 19316/423/0/26 | 18578/1187/0 |
| held-out 09-16 | runs (2,579) | 2576/3/0 | 2576/3/0 | 2575/1/0/3 | 2506/73/0 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1022/0/0/0 | 1008/14/0 |
| held-out 09-16 | policy (1,604) | 1604/0/0 | 1604/0/0 | 1601/3/0/0 | 1577/27/0 |
| held-out 09-16 | suite (9,991) | 9875/12/0 | 9871/16/0 | 9485/386/0/16 | 8923/964/0 |
| held-out 09-16 | giants (9) | 9/0/0 | 9/0/0 | 9/0/0/0 | 9/0/0 |
| sealed-3 | runs (2,580) | 2580/0/0 | 2580/0/0 | 2578/2/0/0 | 2511/69/0 |
| sealed-3 | ws (1,011) | 1011/0/0 | 1011/0/0 | 1011/0/0/0 | 1006/5/0 |
| sealed-3 | policy (1,594) | 1594/0/0 | 1594/0/0 | 1592/2/0/0 | 1570/24/0 |
| sealed-3 | suite (9,996) | 9853/7/0 | 9847/13/0 | 9434/413/0/13 | 8888/972/0 |
| sealed-3 | giants (4) | 4/0/0 | 4/0/0 | 4/0/0/0 | 4/0/0 |


webkit-host (history-dependent: rule families 6 in either case file, development runs 6, ws 1, suite 75, held-out 09-16 runs 1, suite 179, sealed-3 runs 2, suite 166; protocol rows: round 2's feature file 7):

| Group | Set (cases) | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| rule families | families, round 2's case file (9,584) | 9547/31/0 | 9524/54/0 | 9005/177/342/54 | 8494/872/212 |
| rule families | families, derived in round 3 (9,726) | 9685/35/0 | 9662/58/0 | 9115/187/360/58 | 8606/884/230 |
| feature families | features, round 2's case file (12,150) | 12123/20/7 | 12111/32/7 | 10923/0/1195/32 | 8719/38/3393 |
| feature families | features, derived in round 3 (12,268) | 12248/20/0 | 12236/32/0 | 11021/0/1215/32 | 8817/38/3413 |
| dev | smoke (300) | 299/1/0 | 297/3/0 | 287/5/5/3 | 264/31/5 |
| dev | runs (2,580) | 2566/8/0 | 2527/47/0 | 2318/80/129/47 | 2242/211/121 |
| dev | ws (1,019) | 1018/0/0 | 1018/0/0 | 1017/1/0/0 | 994/24/0 |
| dev | policy (1,606) | 1605/1/0 | 1599/7/0 | 1558/21/20/7 | 1459/131/16 |
| dev | suite (19,933) | 19847/11/0 | 19845/13/0 | 19728/28/89/13 | 18894/883/81 |
| held-out 09-16 | runs (2,579) | 2569/9/0 | 2538/40/0 | 2298/99/141/40 | 2227/224/127 |
| held-out 09-16 | ws (1,022) | 1022/0/0 | 1022/0/0 | 1021/0/1/0 | 997/24/1 |
| held-out 09-16 | policy (1,604) | 1603/1/0 | 1602/2/0 | 1553/31/18/2 | 1428/165/11 |
| held-out 09-16 | suite (9,991) | 9784/28/0 | 9772/40/0 | 9644/31/97/40 | 7927/1824/61 |
| held-out 09-16 | giants (9) | 9/0/0 | 9/0/0 | 1/0/8/0 | 1/0/8 |
| sealed-3 | runs (2,580) | 2568/10/0 | 2524/54/0 | 2234/118/172/54 | 2165/254/159 |
| sealed-3 | ws (1,011) | 1011/0/0 | 1011/0/0 | 1009/0/2/0 | 996/13/2 |
| sealed-3 | policy (1,594) | 1593/1/0 | 1590/4/0 | 1555/23/12/4 | 1430/153/11 |
| sealed-3 | suite (9,996) | 9823/7/0 | 9819/11/0 | 9693/33/93/11 | 8039/1744/47 |
| sealed-3 | giants (4) | 4/0/0 | 4/0/0 | 4/0/0/0 | 4/0/0 |

Reading these:

- Suite-sample line counts, pass ÷ (pass + fail), development / held-out 09-16 / sealed-3: Chrome 99.74% / 99.23% / 99.39%,
  Firefox 99.88% / 99.88% / 99.93%, webkit-host 99.94% / 99.71% / 99.93%. Round 2 under the same scorer: Chrome 99.72% /
  99.16%, Firefox 99.68% / 99.51%, webkit-host 99.92% / 99.68%, and 99.30%, 99.67% and 99.93% on sealed-2.
- Observed suite widths passing, same order: Chrome 99.87% / 99.05% / 98.85%, Firefox 97.86% / 96.09% / 95.81%, webkit-host
  99.86% / 99.68% / 99.66%. Round 2: Chrome 99.87% / 98.96%, Firefox 95.51% / 92.36%, webkit-host 99.87% / 99.62%.
- Painter on the suite samples, same order: Chrome 99.54% / 97.58% / 97.49% (round 2: 98.57% / 96.20%), Firefox 93.99% /
  90.25% / 90.14% (91.67% / 86.84%), webkit-host 95.54% / 81.29% / 82.17% (94.87% / 81.03%). Where the prediction passes
  (lineCount and breaks pass, widths pass or unobserved), the painter passes on 99.72% of the development and 99.28% of the
  held-out cases in Chrome, 96.57% and 95.45% in Firefox (more widths pass, and a line painted alone can't always follow
  them), and 95.67% and 86.13% in webkit-host, whose failures are carried widths one float32 step off (§6).
- The sealed-3 set scores like the development and held-out sets in all three browsers. Its suite sample takes one quota per
  family, so its rates don't compare exactly with the other samples.
- Every giant passes lineCount and breaks in all three browsers, the 9 held-out ones and sealed-3's 4, and every observed
  width passes: Chrome's 6 held-out giants that were one unit off past 256 zoomed px pass now (per-run float sums).
  webkit-host leaves 8 of the 9 held-out giants' widths unobserved (§7 item 4).
- Feature families: every Chrome and Firefox case passes lineCount, breaks and every observed width; scorer 5 observes the
  widths of indented lines, so unobserved widths fell from 3,149 to 1,227 in Chrome and from 3,084 to 1,199 in Firefox.
  webkit-host fails 20 line counts and 32 breaks, all `rule/br-elements` under `page-history`, which pass alone in a fresh
  process (WebKit owner's isolation run). The re-derived files have no protocol row.

### 2.4 Against round 2

Transitions over cases neither round marks history-dependent or a protocol row, forward per-case files
(`aggregate-<browser>.md`), against round 2's rows re-scored with scorer 5 (`rescore-s5/`), which is the library change
alone. Cells are pass→fail / fail→pass; sets not listed have none.

| Browser | Set | Compared | lineCount | breaks | widths | painter |
|---|---|---:|---|---|---|---|
| Chrome | rule families | 10,976 | 0/10 | 0/25 | 0/4 | 2/113 |
| Chrome | feature families | 12,882 | 0/0 | 0/0 | 0/0 | 0/143 |
| Chrome | smoke / runs / policy | 299 / 2,580 / 1,606 | 0/0 each | 0/0, 0/1, 0/0 | 0/0 each | 0/1, 0/5, 0/2 |
| Chrome | dev suite | 19,994 | 0/5 | 0/5 | 0/1 | 0/189 |
| Chrome | held-out 09-16 runs / policy | 2,579 / 1,604 | 0/1, 0/0 | 0/1, 0/0 | 0/6, 0/0 | 0/9, 0/2 |
| Chrome | held-out 09-16 suite | 9,991 | 0/7 | 0/10 | 0/9 | 0/125 |
| Chrome | held-out 09-16 giants | 9 | 0/0 | 0/0 | 0/6 | 0/6 |
| Firefox | rule families | 9,584 | 8/105 | 24/256 | 0/290 | 12/503 |
| Firefox | smoke / runs / policy | 297 / 2,580 / 1,606 | 0/0 each | 0/0, 0/4, 0/1 | 0/4, 0/32, 0/4 | 0/3, 0/27, 1/2 |
| Firefox | dev suite | 19,765 | 1/40 | 0/51 | 0/489 | 1/460 |
| Firefox | held-out 09-16 runs / ws / policy | 2,579 / 1,022 / 1,604 | 0/5, 0/0, 0/0 | 0/8, 0/0, 0/2 | 0/42, 0/1, 0/5 | 0/27, 0/0, 0/4 |
| Firefox | held-out 09-16 suite | 9,774 | 1/37 | 1/56 | 0/375 | 0/323 |
| webkit-host | rule families | 9,578 | 8/97 | 8/156 | 0/79 | 16/124 |
| webkit-host | feature families | 12,143 | 0/0 | 0/0 | 0/0 | 0/76 |
| webkit-host | smoke / runs / ws / policy | 300 / 2,574 / 1,018 / 1,606 | 0/0, 0/1, 0/0, 0/0 | 0/0, 0/1, 0/0, 0/0 | 0/0, 1/3, 0/1, 0/0 | 0/1, 1/5, 0/2, 0/8 |
| webkit-host | dev suite | 19,858 | 0/4 | 0/4 | 0/2 | 1/130 |
| webkit-host | held-out 09-16 runs / ws / policy | 2,578 / 1,022 / 1,604 | 0/0 each | 0/0 each | 0/6, 0/1, 0/0 | 0/10, 1/2, 0/7 |
| webkit-host | held-out 09-16 suite | 9,812 | 0/4 | 0/5 | 0/6 | 0/27 |

Sums, lost / gained: Chrome lineCount 0 / 23, breaks 0 / 42, widths 0 / 26, painter 2 / 595; Firefox 10 / 187, 25 / 378,
0 / 1,242, 14 / 1,349; webkit-host 8 / 106, 8 / 166, 1 / 98, 19 / 392. Widths also go from not-applicable to pass where
breaks pass for the first time (Chrome 40, Firefox 247, webkit-host 101), and to fail on fewer (Chrome 2, Firefox 131,
webkit-host 45).

**Every lost prediction pair has a covered explanation under scorer 5**, and each is listed with its attribution in the
staged seed records (§2.6):

- **Chrome: none.**
- **Firefox, 35.** 8 line counts and 24 breaks are the 24 `rule/system-fonts-and-sizes` cases with `system-ui` and
  `-apple-system` at 13.33px, under `font-size-quantization`: the canvas element keeps 7 significant bits of the size over
  the device scale and measures at 13.3833px, where round 2's OffscreenCanvas measured at 13.375px and passed by accident
  with a first line 482 au short. The other three are `c-2ad5b0126a288f11` (development, lineCount; its breaks failed in
  round 2 already) and `c-fc9b382c418b3022` (held-out, lineCount and breaks; its widths failed in round 2), both under
  `in-word-prefix` at a break between joined letters whose two sides, measured with U+200D, don't add up to the unit (925 au
  against 582 in 24px Amiri; 1,746 against 1,804 in 16px Noto Nastaliq Urdu).
- **webkit-host, 17.** 8 line counts and 8 breaks in `rule/joining` (letter-spaced joined Arabic, `overflow-wrap:
  anywhere`, one letter per line) passed by accident in round 2 with failing widths; they sit under
  `rtl-shaping-across-inline-boxes`, and the native shaped share matches no Canvas total (WebKit probe R6). 1 width,
  `c-0ad060cd384930bf`: both boxes are exact now, and the line's float32 sum of the shaped runs is one step off.

Painter pairs lost: Chrome 2 (`rule/joining` in AAT Geeza Pro under `break-all`, the painter owner's known class with the
limit `edge-inside-shaped-text`, prediction unchanged); Firefox 14, webkit-host 19. All of Firefox's and webkit-host's sit on
cases whose prediction changed: round 2's painted extent agreed with a wrong predicted width, the prediction now equals the
native one, and the line painted alone still draws the old width (7 of Firefox's have no covered explanation, since the lab
doesn't record painter limits).

History dependence moved on the held-out suite sample, which ran 25 cases per round trip this round (one in round 2) and
without the 8 giants that opened its first part, so its document histories differ from round 2's. The development suite
sample ran as in round 2 and keeps exactly its history-dependent cases (Firefox 123, webkit-host 75). Firefox's held-out
sample has 104 where round 2 had 217: the 113 that left are emoji cases (`suite/signed-spacing` 35, `space-context-emoji`
18, `following-space-scope` 13), and the 104 that stay are `suite/U+FFFD`. webkit-host's has 179 where round 2 had 135: 44
cases in bracket and quote families are newly history-dependent, and their 175 pass pairs are listed in the staged lab
seed's record as leaving through history dependence (81 of them pass now). Not traced further.

Gains come from the fix phase's source work (specs/*-RESULTS.md, "Ceiling round 3"): in Chrome the Canvas word split with
per-word scripts, ligature clusters from the font facts and per-run float sums; in Firefox the canvas element at the device
size, in-word positions measured from both sides with U+200D, kern splits, ligature group shares and the letter spacing
rules around clusters; in webkit-host history worlds for `page-history`, ligature pairs under letter spacing measured with
U+200C, VT, FF and CR as Core Text shapes them, and shaped runs across inline boxes measured in joining context; in the
painter, the rewritten forms of DESIGN §7.

### 2.5 Against main

Not refreshed in ceiling round 3, which ran no main comparison and no triage refresh: the numbers below are the ceiling
round 2 evaluation's (the round 2 library under scorer 4).

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

**Checks against the current seeds.** `lab/gate.ts` and `tests/gate.ts check` refuse every round 3 run against every adopted
seed by the environment check (exit 2), as they should: the seeds were seeded under scorer 4 and the runs are scored with
scorer 5 ("scorer 5 against the baseline's scorer 4: re-score the seeding runs and seed a new baseline"). Build, device and
process languages match in all three browsers. Nothing was checked without that check (`evaluate-r3/gates/*-check-*.log`).
The pair-level comparison with the adopted seeds is therefore the staged seeds' records below.

**Staged seeds.** New seeds are written to staging folders only, `rebuild/lab/baselines/staged-round3/` and
`rebuild/tests/baselines/staged-round3/`, by the gates' own seed commands (`lab/gate.ts --seed --staging=…`; `tests/gate.ts
seed` with the staging path as its baseline), which refuse runs without recorded languages, without the other order's
comparison or scored by different scorers. No adopted baseline was touched; the orchestrator adopts them after the critic.
Each staged seed was checked against its own runs with the environment check on: pass, which says only that the file
round-trips.

| Staged seed | Environment | Cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Unstable pairs |
|---|---|---:|---|---:|---:|---:|
| `lab/…/gate-chrome-153.0.8010.50.json` | Chrome 153.0.8010.50, `uiLanguage` zh-CN, scorer 5 | 40,446 | 40,314 / 40,307 / 38,765 / 38,627 | 0 | 0 | 0 |
| `lab/…/gate-firefox-156.0.json` | Firefox 156.0, `regionalPrefsLocale` zh-hans-us, scorer 5 | 40,340 | 40,074 / 40,068 / 39,248 / 37,737 | 227 | 0 | 0 |
| `lab/…/gate-webkit-22625.1.29.11.27.json` | webkit-host, `preferredLanguages` zh-CN,zh-Hans, scorer 5 | 40,385 | 40,065 / 39,974 / 39,180 / 36,200 | 262 | 0 | 1 |
| `tests/…/chrome-153.0.8010.50.json` | as the Chrome lab seed; cases derived under .50, facts file .50's | 11,154 | 10,998 / 10,952 / 10,662 / 10,508 | 0 | 0 | 0 |
| `tests/…/chrome-features-153.0.8010.50.json` | the same | 13,010 | 13,010 / 13,010 / 11,743 / 9,251 | 0 | 0 | 0 |
| `tests/…/chrome-en-US-features-153.0.8010.50.json` | the same with `uiLanguage` en-US | 468 | 468 / 468 / 468 / 468 | 0 | 0 | 0 |
| `tests/…/firefox-156.0.json` | as the Firefox lab seed | 9,776 | 9,721 / 9,616 / 9,224 / 8,667 | 0 | 0 | 0 |
| `tests/…/firefox-features-156.0.json` | the same | 12,050 | 12,050 / 12,050 / 10,866 / 8,421 | 0 | 0 | 0 |
| `tests/…/webkit-host-22625.1.29.11.27.json` | as the webkit-host lab seed | 9,726 | 9,685 / 9,662 / 9,115 / 8,606 | 6 | 0 | 0 |
| `tests/…/webkit-host-features-22625.1.29.11.27.json` | the same | 12,268 | 12,248 / 12,236 / 11,021 / 8,817 | 0 | 0 | 0 |

The lab seeds come from the development and held-out 09-16 runs in both orders, the giants run beside the held-out run, so
they hold every case of the adopted seeds. The tests seeds come from round 3's derivations (`derive-r3-20260917`, no protocol
row), whose Chrome cases were derived under .50 with .50's facts file, so round 2's provisional Chrome tests seeds (cases
derived under .48, .48's facts) are replaced by seeds of one build.

**Records the baseline rule asks for** are beside each staged seed (`<name>.seed-record.json`; for the tests seeds written by
`evaluate-r3/tools/tests-seed-record.ts` with `lab/gate.ts` `seedRecord`). Against the adopted seeds:

| Staged seed | Lost pairs | Of them without a covered explanation | Left through new history dependence | Left as protocol rows | Gained | Cases only in the adopted seed / only in the staged one |
|---|---:|---:|---:|---:|---:|---|
| lab gate, Chrome | 0 | 0 | 0 | 0 | 406 | 0 / 0 |
| lab gate, Firefox | 5 (lineCount 2, breaks 1, painter 2) | 1 painter | 0 | 0 | 2,071 | 0 / 0 |
| lab gate, webkit-host | 4 (widths 1, painter 3) | 0 | 175 pairs of 44 cases (81 pass now) | 0 | 231 | 0 / 0 |
| rule families, Chrome | 2 (painter) | 0 | 0 | 0 | 177 | 0 / 178 |
| feature families, Chrome | 0 | 0 | 0 | 0 | 3,987 | 0 / 128 |
| feature families, Chrome under en-US | 0 | 0 | 0 | 0 | 0 | 0 / 0 |
| rule families, Firefox | 44 (lineCount 8, breaks 24, painter 12) | 6 painter | 0 | 0 | 1,328 | 0 / 192 |
| feature families, Firefox | 0 | 0 | 0 | 0 | 3,752 | 24 / 128 |
| rule families, webkit-host | 32 (lineCount 8, breaks 8, painter 16) | 0 | 0 | 0 | 564 | 2 / 144 |
| feature families, webkit-host | 0 | 0 | 0 | 0 | 76 | 10 / 128 |

- Every lost prediction pair is covered and carries its source attribution in the record (`attribute-records.py`; §2.4 has
  the classes): Firefox's 32 family pairs under `font-size-quantization` and 3 lab pairs under `in-word-prefix`, webkit-host's
  16 family pairs and 1 lab width under `rtl-shaping-across-inline-boxes`.
- The 7 painter pairs without a covered explanation are Firefox's (6 `rule/joining`, 1 `policy/overflow-wrap`): the case's
  breaks or widths pass for the first time, and the line painted alone shapes the cut word in a text node of its own
  (painter limit `edge-inside-shaped-text`, which the lab doesn't record). They are attributed, not covered. The critic
  decides whether they stay expected passes.
- The 34 feature cases only the adopted seeds hold (Firefox 24, webkit-host 10) are `rule/line-slots` cases under the new
  width floor, all 22 protocol rows among them; webkit-host's 2 rule-family cases are the `in-word-breaks` target that no
  longer resolves under sharded derivation (TESTS.md §6).
- The gained feature pairs are mostly widths and painter extents of indented lines, which scorer 5 observes.

**Coverage.** `tests/coverage.ts` over the .50 facts file and round 3's derivation folders with the evaluation's runs, staged
as `rebuild/tests/baselines/staged-round3/coverage.json`: Blink 144 of 179 current rules covered, WebKit 109 of 152, Gecko
104 of 124, shared 12 of 29. It exits 1: `webkit/measure/word-spacing-in-js` lost its last observed family. The WebKit owner
retired that id for `webkit/measure/word-spacing-in-context`, and the families `following-space` and `tabs` still name the old
one, so the new rule has no family (tests owner).

**Tests.** `bun test rebuild`: 603 pass, 2 fail. `tests/independence.test.ts` fails on `lab/baselines/no-facts-predictor.ts`,
which the facts-free measurement added after the fix phase and which imports `src/index.ts`, `src/paint.ts` and
`detectEnvironment`; `tests/families/families.test.ts` fails on the retired WebKit rule id above. Neither is engine code.

G0 is unchanged.

### 2.7 Installed Safari

Installed Safari 27.0 ran as a spot check (`evaluate-r3/tools/combined.sh`, `--allow-safari-frontmost`, approved): the
combined development file `dev-all` (25,180 cases after Safari's case filter) and the combined family file round 2 ran,
`families-all` (21,734), in file order and in reverse.

- **Parts.** Each job ran in 2-minute parts (`--part-ms=120000`), each part a fresh tab with a WebContent process of its own,
  so no process came near WebKit's 8-minute background CPU window: `dev-all` took 307 s and 313 s in three parts (120 s,
  114 s and 73 s; 113 s, 110 s and 90 s), `families-all` 105 s and 102 s in one part. Every row of the four jobs recorded the
  page as hidden. Nothing queried Safari while it ran, and no job failed.
- **webkit-host twins.** After each Safari job webkit-host ran the same file in the same order with `--parts-from` that job's
  run record, so both browsers saw every case after the same document and process history.
- **Result** (`evaluate-r3/safari-vs-host-*.json`, `compare-safari-host.ts`): in both files and both orders every native view
  is equal (every rect's x, width and native line: 25,180 and 21,734 cases), every prediction is equal (layout, Canvas call
  counts and expected observation), and the two mark the same cases history-dependent (80 and 6). The scores are equal in
  every cell, painter included:

  | File (cases) | lineCount | breaks | widths | painter | History-dependent | Protocol rows | Prediction rows failing / without a covered explanation |
  |---|---|---|---|---|---:|---:|---|
  | dev-all (25,180), installed Safari and webkit-host | 25080/20/0 | 25029/71/0 | 24661/130/238/71 | 23622/1260/218 | 80 | 0 | 201 / 0 |
  | families-all (21,734), installed Safari and webkit-host | 21670/51/7 | 21635/86/7 | 19928/177/1537/86 | 17213/910/3605 | 6 | 7 | 263 / 0 |

  Round 2 under the same scorer: `dev-all` 207 failing rows, 5 of them without a covered explanation; `families-all` 525
  and 0.
- Not run in installed Safari this round, by the brief: the held-out file, sealed-3, the fresh sets and the giants (a giant
  took about 5 minutes there in round 2, so each would be a job of its own). The WebKit owner's spot check ran 5,184 fresh
  cases there with statuses equal to webkit-host's. webkit-host rows stand in for WebKit everywhere else in this report.

### 2.8 Open model bugs, residual classes and weak coverage

The round 3 definition (scorer 5): a gap covers a failing line only if its range touches what differs there, every
contributing run of units whose native geometry differs from the predicted one (in WebKit the differing node), or, for a
pure break decision, the text between the predicted and the native break; and the condition's source reading must say the
prediction can be wrong there. A ranged gap elsewhere on the line doesn't cover. A protocol row is excluded from pass and fail
alike. A residual class is counted apart, probed members apart from members matched by signature. The scorer checks where a
range is, not what the source reading says; rows that are covered by position only are named below.

Rows failing lineCount, breaks or widths without a covered explanation, of the rows failing one, forward runs outside
history dependence and protocol rows. No row of any set matches a residual class, so every such row is open. Round 2's rows
under the same scorer are in parentheses (Firefox's counts there include its residual members, 10 development and 6
held-out). Sealed-3 is counts only.

| Browser | Rule families | Feature families | Development | Held-out 09-16 with its giants | Sealed-3 | Fresh sets 1 / 2 / 3 |
|---|---|---|---|---|---|---|
| Chrome | 0 of 428 (0 of 457) | 0 of 0 | 1 of 89 (2 of 95) | 2 of 174 (15 of 205) | 2 of 178 | 2 of 61 / 3 of 65 / 1 of 55 |
| Firefox | 0 of 528 (52 of 992) | 0 of 0 | 0 of 456 (19 of 1,013) | 0 of 409 (19 of 877) | 0 of 430 | 0 of 197 / 1 of 196 / 0 of 183 |
| webkit-host | 0 of 231 (0 of 493) | 0 of 32 (0 of 32) | 0 of 205 (3 of 210) | 0 of 243 (22 of 261) | 1 of 243 | 0 of 236 / 0 of 214 / 1 of 236 |

The re-derived family files give the same zeros (Chrome 0 of 428, Firefox 0 of 552, webkit-host 0 of 245 and 0 of 32), and so
do the combined files in webkit-host and installed Safari (0 of 201 and 0 of 263). No row is open in reverse order only. No
failure on any set is covered only by a gap without a range; break failures covered only at the decision text are 46 of
Chrome's 88 on the fresh sets and 69 of webkit-host's 220 (`lineLocal.coveredOnlyAtDecision`).

**The ceiling measurement: open rows per 10,000 fresh cases.** Chrome 6 of 34,115 cases, 1.76 per 10,000, in three classes,
with an open row in every set. Firefox 1 of 33,432, 0.30 per 10,000, in a class its owner had found. webkit-host 1 of 33,202,
0.30 per 10,000, in a class its owner had named as an observation consequence. Prediction failures of any kind per 10,000
fresh cases: Chrome 53, Firefox 172, webkit-host 207.

**Open, Blink, fresh sets: three classes, none with a gap that touches it.**

- *An exact-fit break in ProbeShantell under letter spacing* (4 rows, `suite/ligature-thresholds-v3`: `c-0342c2bb3e2138fd`,
  `c-c3eeb836fa28c562`, `c-7e131b748aca6cb5`, `c-a4bdefa792ae621e`). `office` at −4px and `difficult` at 1px letter spacing in
  bold 16px ProbeShantell, `overflow-wrap: break-word`, at a width where the fifth or sixth letter ends at the
  available width: natively `offic` stays on the first line (its right edge is 16.992px in a 16.992px box), and the
  prediction breaks before `c`. The layout reports no gap at all. It is the font of `c-8c84627af834611f`, which the Blink
  owner traced to HarfBuzz flagging every offset unsafe (Blink then reshapes the whole range and takes it without a fit
  test) and covered with `in-word-prefix` at wrapped line starts; these rows are first lines, where that condition doesn't
  fire. Not traced here.
- *U+3000 kerned with the next line's first letter* (`c-0ee8c36920378f9f`, `runs/word-spacing-spans`, 16px Times New Roman, a
  span under 8px word spacing). A line ends with U+3000 and the next starts with `The`: natively the U+3000 is 16px wide and
  `T` 9.633px, predicted 15.930px and 9.773px, so natively the pair's adjustment (18 units) sits on the `T` across the wrap
  and the prediction splits it and reshapes the `T` alone. The port marks the U+3000's width limited by `glyph-clusters`, but
  the layout reports nothing on that line and only `float32-precision` elsewhere on the next. A relative of round 2's U+3000
  class, which is fixed: the round 2 critic's three held-out rows pass all four metrics here, and so do its three lam-alef
  rows.
- *An emergency break after a marked waw* (`c-2dce271cf373d098`, `policy/overflow-wrap`, 14px Geeza Pro, RTL, 8px wide, one
  cluster a line): natively `وَ` and the alef after it sit on two lines, and the prediction keeps `وَا` on one overflowing line
  (30 native lines, 29 predicted). `glyph-clusters`, `in-word-prefix` and `unsafe-to-break` are on the line with ranges that
  start at the lam after the alef; none reaches the decision text.

**Open, Blink, defined sets: `suite/U+FFFC/start`** (`c-23e11e5c3a96497d` in development, `c-a43249c733c43a9c` and
`c-b0af41f52ed23824` held-out; 2 line counts, 1 predicted). The cause, U+FFFC drawn by a fallback font at another width, has
a `font-fallback` gap on the character, but a soft hyphen's copied rect puts the next letter on both native lines and the
scorer attributes the line after it (Blink owner; a scorer attribution, not a new class). Sealed-3's 2 open Chrome rows are
line-count failures in its suite sample; the set stays sealed, so whether they are this class is unknown.

**Open, Gecko: letter spacing in a cursive cluster, on the wrong cluster** (`c-f3e8314c35b33990`, fresh set 2,
`suite/chromium-script-spacing`: three Phags-pa letters and U+0301 in 16px Courier New under 1px letter spacing). Natively the
first letter takes the letter spacing (11.650px against 10.517px predicted, 60 au of it the spacing) and the line is 2,060 au
wide, 2,000 predicted. The owner's round 3 rule (a cursive cluster takes letter spacing where another font draws one of its
marks, probe F19, reported as `font-fallback` where the coverage facts don't say) puts the gap on the marked cluster at
[2,4), which doesn't touch the letter that differs. A known class whose reading names the wrong cluster here; not new, and
still open. Also still open from the owner's sets and not hit by these three: a tab after a frame that starts inside a
cluster (`CalcTabWidths`, read and not ported).

**Covered by position only, Gecko: the unbounded frame** (probe F18). Held-out `c-4bbfaaafb6f3d47f`, `c-710f180e5314942f` and
`c-9c05c70ce585fb82` (`runs/word-spacing-spans`): a grapheme cluster split between its two marks across spans in Geeza Pro
gives a native frame 2^30 + 56 au wide. `in-word-prefix` sits at the frame edge inside the cluster, so scorer 5 counts them
covered, but that condition's source reading doesn't say a frame becomes unbounded. They are open by the definition's second
half: a Firefox bug candidate without a source trace. No fresh or sealed-3 row of the evaluation has the signature.

**Open, WebKit: a float32 step at a moved x** (`c-9a66d090891a825d`, fresh set 3, `runs/bidi-runs`). The line's float32 sum
of Arabic runs shaped across inline boxes is one step off (224.06697px natively, 224.06696px predicted: the stand-in class
the WebKit owner left under `rtl-shaping-across-inline-boxes`, as on `c-0ad060cd384930bf`). On this RTL line every x then
moves by a step, and a Hebrew node the gap doesn't touch reports a width one step wider, because a box's observed rect
width is `f32(f32(x + w) − x)`: the same engine width, 74.5390625px at the native x and 74.53904724px at the predicted one.
The owner named this consequence on `c-653ac96abf5487ff`; scorer 5 has no rule for it (Blink has its caret-rounding one), so
the row counts as open. Sealed-3's 1 open webkit-host row is a line-count failure in its suite sample, unopened.

**Residual classes: none has a member.** Gecko's one shaping unit 1 au off has 0 members on every set, probed or by
signature: the port measures on a detached `<canvas>` element at the DOM's device font size, which reproduces the DOM on
every probed unit (specs/gecko-RESULTS.md, probes F13 and F14; mechanism verified by simulation for `modern` only). The
class stays a class of the OffscreenCanvas fallback (no `document`, a worker), a path neither the lab nor this evaluation
runs. `lab/residual-classes.json` still registers it as it was.

**History dependence, checked in both orders for the first time with the canvas element.**

- Firefox: of 542 history-dependent suite cases (development 123, held-out 104, fresh 104, 116 and 95), 527 pass lineCount,
  breaks and widths in both orders (all 315 fresh ones; 6 pass in one order, and 9 held-out `suite/U+FFFD` cases in neither),
  with exact predicted values in both orders in all but 2, although their native views differ: an emoji in
  18px Times New Roman is 18px wide in one order and 17px in the other, and the prediction follows each time, because the
  canvas element shares the DOM's font state. `page-history` reports all 227 development and held-out ones (round 2: none),
  and 8, 14 and 95 of the fresh sets' (the emoji condition compares the run's context with "Apple Color Emoji" alone at
  prediction time, and sees no difference in most `following-space` cases). It fires on 56 of 25,012 other development
  cases. So in Firefox a prediction is right for the page state it was measured in; what the condition names is narrower
  than the effect (tentpole 6).
- webkit-host: `page-history` reports every history-dependent case (development 82 of 82, held-out 180 of 180, fresh 46, 66
  and 54), and no history-dependent case fails without a covered explanation in both orders. In one order, 10 development
  and 1 held-out case do. It still fires on 2,148 of 25,098 other development cases (round 2: 3,703).
- Chrome: no case is history-dependent on any set; `page-history` covers the 24 `rule/system-fonts-and-sizes` failures of the
  fresh sets (the platform font cache's key).

**Protocol rows:** none in the re-derived family files or the fresh sets. Round 2's feature files still give Firefox 15 and
webkit-host 7.

**Weak coverage.** Prediction failures covered only by conditions with a lift below 2 in their group. Round 2's lift is a
gap's share of the cases failing any metric over its share of all-pass cases. Painter-only failures count as failing cases
there and no layout condition explains them, so where they dominate (webkit-host: 1,080 of 1,285 failing development cases)
every condition reads weak. The second number takes the lift over prediction failures alone. Round 2's rows → round 3:

| Browser | Rule families | Development | Held-out 09-16 | Sealed-3 |
|---|---|---|---|---|
| Chrome | 0 / 0 of 457 → 0 / 16 of 428 | 4 / 4 of 93 → 2 / 2 of 88 | 6 / 6 of 190 → 0 / 0 of 172 | 1 / 1 of 176 |
| Firefox | 20 / 0 of 940 → 0 / 0 of 528 | 1 / 1 of 994 → 0 / 0 of 456 | 2 / 2 of 858 → 0 / 0 of 409 | 0 / 1 of 430 |
| webkit-host | 153 / 153 of 493 → 142 / 0 of 231 | 200 / 188 of 207 → 187 / 2 of 205 | 239 / 32 of 239 → 228 / 5 of 243 | 222 / 1 of 242 |

- webkit-host under round 2's definition is as weak as before, and under the prediction lift it isn't: `canvas-language`
  fires on 15.4% of passing development lines (round 2: 44.1%) and 88% of failing ones, a line lift of 5.7 (2.0);
  `letter-spacing-ligatures` on 0.02% (7.7%); `simplified-measuring` on 7.8% (18.3%) and covers 1 failing row; what is left weak is
  `tab-stops` (2 development and 5 held-out rows, the round 2 critic's doubtful `c-7753213c5fde9edc` kind). What the lift
  can't show is unchanged: that the named difference is the cause.
- Chrome's 16 rule-family rows are `rule/joining` breaks under `glyph-clusters` with `unsafe-to-break`, conditions that fire
  on many passing family cases by construction. `script-context` alone covers 1 development row and none held-out (round 2: 1 and 9).

**Painter-only failures without a covered explanation** are painting form, not prediction: development Chrome 14 (round 2:
72), Firefox 451 (189), webkit-host 960 (622); about 60, 440 and 750 a fresh set. Firefox's and webkit-host's rose because
conditions narrowed and more widths pass, which a line painted alone can't always follow. `painterLimits` names a limit on
nearly all of them (painter owner: Chrome 479 of 489 failing cases, Firefox 1,322 of 1,337, webkit-host 3,660 of 3,693), but
it isn't exported or recorded by the lab, so the scorer can't count them as covered.

By this definition:

- **Chrome: not at the ceiling.** Every fresh set has an open row, 6 in three classes nobody had seen, beside the 3
  `suite/U+FFFC/start` attribution rows and 2 unopened sealed-3 rows. Everything the round 2 critic listed is fixed or
  covered: the U+3000 class, the span-edge ligatures, `c-8c84627af834611f`, in-word positions reported as exact, and the 6
  giants' widths.
- **Firefox: no new class in three fresh sets (33,432 cases), two of them without any open row**, and nothing open on the
  defined sets or sealed-3. Known classes are still open: the cursive letter spacing reading (1 fresh row), the tab after a
  frame inside a cluster (owner's set 15, not ported), and the unbounded frame (3 held-out rows covered by position only).
  The result rests on measuring on a detached `<canvas>` element, a maintainer decision (§7 item 12).
- **webkit-host and installed Safari: no new class in three fresh sets (33,202 cases), two in a row without any open row.**
  The third set's row and sealed-3's are the only open ones. Its failures are 2% of fresh cases, most of them fonts chosen
  by language, which Canvas can't follow (§6).
- **The criterion, two unseen fresh sets in a row with no new class: met by Firefox and webkit-host, not by Chrome.** Read
  more strictly, two sets in a row without any open row, only webkit-host meets it (sets 1 and 2); Firefox's sets went none,
  one, none.

## 3. Costs

**Ceiling round 3** (forward runs; round 2's numbers follow below). measureText calls per paragraph, mean / median / p95 /
max, and prediction time summed over the set:

| Browser | Set | Calls, round 2 | Calls, round 3 | Predict, round 2 | Round 3 |
|---|---|---|---|---:|---:|
| Chrome | runs | 141.6 / 130 / 281 / 803 | 161.0 / 147 / 313 / 800 | 1.9 s | 3.5 s |
| Chrome | ws | 87.2 / 87 / 152 / 293 | 98.8 / 105 / 167 / 341 | 0.4 s | 0.7 s |
| Chrome | policy | 98.7 / 82 / 217 / 401 | 112.8 / 92 / 250 / 368 | 0.8 s | 1.2 s |
| Chrome | dev suite | 85.0 / 29 / 260 / 21,837 | 114.1 / 28 / 398 / 51,867 | 10.0 s | 24.4 s |
| Chrome | rule / feature families | 39.4 and 42.5 mean | 44.4 and 50.8 mean | 1.9 s and 2.0 s | 4.4 s and 3.9 s |
| Chrome | held-out giants (9) | | 257,880 / 174,206 / 447,819 | | 75.3 s |
| Firefox | runs | 97.7 / 83 / 212 / 608 | 152.8 / 136 / 331 / 863 | 0.7 s | 2.3 s |
| Firefox | ws | 57.9 / 50 / 129 / 255 | 87.7 / 92 / 159 / 355 | 0.2 s | 0.7 s |
| Firefox | policy | 84.5 / 68 / 200 / 345 | 108.6 / 93 / 239 / 349 | 0.4 s | 1.1 s |
| Firefox | dev suite | 63.4 / 20 / 195 / 30,781 | 92.3 / 19 / 280 / 27,723 | 14.7 s | 18.2 s |
| Firefox | rule / feature families | 20.0 and 21.8 mean | 34.4 and 41.3 mean | 0.7 s and 0.6 s | 1.8 s and 1.8 s |
| Firefox | held-out giants (9) | | 83,709 / 75,853 / 121,570 | | 4.3 s |
| webkit-host | runs | 33.1 / 25 / 88 / 171 | 40.0 / 32 / 96 / 172 | 0.7 s | 0.9 s |
| webkit-host | ws | 22.9 / 18 / 54 / 124 | 26.0 / 24 / 57 / 129 | 0.1 s | 0.2 s |
| webkit-host | policy | 20.7 / 15 / 66 / 155 | 23.1 / 16 / 68 / 182 | 0.2 s | 0.4 s |
| webkit-host | dev suite | 15.2 / 6 / 40 / 2,069 | 38.5 / 7 / 126 / 2,273 | 2.0 s | 3.7 s |
| webkit-host | rule / feature families | 8.1 and 10.2 mean | 10.6 and 12.3 mean | 0.5 s and 0.7 s | 1.2 s and 1.1 s |
| webkit-host | held-out giants (9) | | 12,551 / 10,516 / 20,454 | | 2.8 s |

- Mean calls rose by 13% to 34% in Chrome (windows for adjustments, the Canvas word split test, per-run float sums), 29% to
  89% in Firefox (both sides of in-word offsets with U+200D, ligature group tests, the canvas element's contexts) and 12% to
  153% in webkit-host (the development suite's 15.2 to 38.5 is condition work: history worlds, letter spacing glyph counts).
  Recorded only (tentpole 8).
- The held-out suite sample isn't comparable: round 2's held its 9 giants (Chrome 168.4 mean calls then, 113.4 without them
  now). The giants alone: Chrome 132 to 145 s a job, Firefox 15 s, webkit-host 325 s, most of webkit-host's in native
  observation.
- Lab time: the 142 per-set jobs of the three browsers, both orders, ran in under 7 minutes side by side (round 2: 38
  minutes of job time one after the other, and a 20 s pause after each); three fresh sets in three browsers, both orders, in 3 minutes.
- Tests at `round3-work-done`: `bun test rebuild` 603 pass, 2 fail (§2.6), 10.6 s; `bunx tsc` over `rebuild` and
  `rebuild/lab` clean.

**Ceiling round 2** (the rest of this section, unchanged):

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

**Ceiling round 3: firing on passing and failing lines** (`evaluate-r3/firing/`, `lab/fresh.ts report` over the forward runs;
round 2's rows with their scorer 5 per-case files → round 3). A gap fires on a line when the line's own gaps hold it or a
ranged paragraph gap meets the line; passing lines are the line boxes of cases whose lineCount, breaks and widths pass;
failing lines are the engine lines the scorer attributes. Lift is the failing-line share over the passing-line share. These
are the numbers a changed or widened condition is judged by; round 2's case-level tables follow below, unchanged.

Chrome, development: passing lines 86,784 → 87,017, failing lines 96 → 88

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `script-context` | 50.72% → 30.78% | 75.39% → 38.48% | 87.50% → 45.45% | 1.73 → 1.48 |
| `glyph-clusters` | 8.96% → 7.35% | 13.15% → 10.53% | 41.67% → 34.09% | 4.65 → 4.64 |
| `float32-precision` | 0 → 5.77% | 0 → 11.33% | 0 → 0.00% | – → 0.00 |
| `unsafe-to-break` | 3.14% → 3.61% | 3.62% → 4.89% | 40.63% → 46.59% | 12.95 → 12.92 |
| `in-word-prefix` | 1.58% → 1.62% | 2.90% → 3.04% | 7.29% → 2.27% | 4.61 → 1.40 |
| `font-fallback` | 1.11% → 1.11% | 2.32% → 2.32% | 53.13% → 57.95% | 47.68 → 52.15 |
| `soft-hyphen-shaping` | 0.87% → 0.87% | 1.71% → 1.71% | 6.25% → 6.82% | 7.17 → 7.85 |
| `tab-stops` | 0.32% → 0.32% | 0.99% → 0.99% | 1.04% → 1.14% | 3.25 → 3.56 |
| `control-character-width` | 0.31% → 0.31% | 0.49% → 0.49% | 0.00% → 0.00% | 0.00 → 0.00 |
| `han-kerning` | 0.31% → 0.31% | 0.92% → 0.92% | 0.00% → 0.00% | 0.00 → 0.00 |


Chrome, held-out 09-16 without the giants: passing lines 63,209 → 63,340, failing lines 206 → 172

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `script-context` | 47.08% → 27.98% | 66.58% → 31.19% | 88.83% → 77.33% | 1.89 → 2.76 |
| `glyph-clusters` | 12.16% → 10.37% | 13.04% → 10.09% | 21.84% → 19.19% | 1.80 → 1.85 |
| `unsafe-to-break` | 4.22% → 4.77% | 5.95% → 7.65% | 15.05% → 19.77% | 3.57 → 4.15 |
| `soft-hyphen-shaping` | 2.92% → 2.91% | 8.39% → 8.38% | 12.62% → 15.12% | 4.33 → 5.19 |
| `in-word-prefix` | 2.52% → 2.63% | 2.21% → 2.55% | 12.14% → 2.33% | 4.81 → 0.88 |
| `tab-stops` | 0.90% → 0.90% | 3.86% → 3.85% | 0.00% → 0.00% | 0.00 → 0.00 |
| `float32-precision` | 0 → 0.63% | 0 → 1.88% | 0 → 0.00% | – → 0.00 |
| `control-character-width` | 0.61% → 0.61% | 1.53% → 1.52% | 0.49% → 0.58% | 0.80 → 0.96 |
| `han-kerning` | 0.51% → 0.51% | 1.93% → 1.92% | 0.00% → 0.00% | 0.00 → 0.00 |
| `font-fallback` | 0.41% → 0.41% | 1.27% → 1.26% | 71.36% → 85.47% | 175.51 → 210.64 |


Chrome, rule families: passing lines 37,275 → 37,473, failing lines 537 → 508

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `in-word-prefix` | 10.12% → 10.79% | 24.84% → 27.09% | 3.54% → 3.74% | 0.35 → 0.35 |
| `unsafe-to-break` | 6.87% → 6.67% | 4.70% → 4.71% | 7.82% → 3.15% | 1.14 → 0.47 |
| `glyph-clusters` | 9.08% → 4.46% | 8.15% → 8.95% | 3.54% → 3.15% | 0.39 → 0.71 |
| `script-context` | 15.48% → 3.95% | 32.20% → 5.86% | 64.80% → 0.00% | 4.19 → 0.00 |
| `tab-stops` | 2.39% → 2.38% | 8.26% → 8.24% | 0.00% → 0.00% | 0.00 → 0.00 |
| `page-history` | 2.15% → 2.13% | 2.45% → 2.44% | 26.82% → 28.35% | 12.49 → 13.28 |
| `soft-hyphen-shaping` | 1.46% → 1.45% | 2.68% → 2.67% | 0.00% → 0.00% | 0.00 → 0.00 |
| `optical-size` | 9.09% → 1.33% | 8.37% → 1.53% | 32.22% → 0.00% | 3.54 → 0.00 |
| `font-fallback` | 0.91% → 0.91% | 1.72% → 1.72% | 64.80% → 68.50% | 71.05 → 75.50 |
| `control-character-width` | 0.64% → 0.64% | 1.61% → 1.60% | 0.00% → 0.00% | 0.00 → 0.00 |
| `han-kerning` | 0.41% → 0.41% | 1.45% → 1.45% | 0.00% → 0.00% | 0.00 → 0.00 |
| `float32-precision` | 0 → 0.36% | 0 → 1.30% | 0 → 0.00% | – → 0.00 |


Firefox, development: passing lines 81,051 → 83,262, failing lines 2,069 → 899

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `in-word-prefix` | 12.00% → 4.24% | 21.07% → 5.23% | 98.79% → 100.00% | 8.24 → 23.58 |
| `page-history` | 0.01% → 0.07% | 0.02% → 0.21% | 0.00% → 0.00% | 0.00 → 0.00 |
| `glyph-clusters` | 9.90% → 0.01% | 11.33% → 0.02% | 2.95% → 0.00% | 0.30 → 0.00 |
| `font-fallback` | 0.06% → 0.01% | 0.17% → 0.01% | 0.00% → 0.00% | 0.00 → 0.00 |
| `bitmap-emoji-size` | 0.03% → 0 | 0.08% → 0 | 0.77% → 0 | 22.39 → – |


Firefox, held-out 09-16 without the giants: passing lines 58,847 → 61,416, failing lines 1,841 → 838

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `in-word-prefix` | 10.48% → 4.44% | 23.25% → 3.28% | 98.42% → 100.00% | 9.39 → 22.55 |
| `space-in-shaping` | 3.53% → 3.37% | 0.04% → 0.02% | 0.00% → 0.00% | 0.00 → 0.00 |
| `page-history` | 0.04% → 0.10% | 0.06% → 0.31% | 0.00% → 0.00% | 0.00 → 0.00 |
| `glyph-clusters` | 13.75% → 0.03% | 15.34% → 0.11% | 7.98% → 0.00% | 0.58 → 0.00 |
| `font-fallback` | 0.21% → 0.01% | 0.81% → 0.03% | 0.00% → 0.12% | 0.00 → 10.47 |
| `bitmap-emoji-size` | 0.06% → 0 | 0.22% → 0 | 1.25% → 0 | 20.42 → – |


Firefox, rule families: passing lines 29,734 → 32,133, failing lines 2,778 → 1,478

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `in-word-prefix` | 9.29% → 1.99% | 9.40% → 3.00% | 54.72% → 44.93% | 5.89 → 22.52 |
| `font-size-quantization` | 0.00% → 0.00% | 0.00% → 0.00% | 29.01% → 55.07% | – → – |
| `optical-size` | 6.65% → 0 | 5.76% → 0 | 47.59% → 0 | 7.15 → – |
| `font-fallback` | 0.30% → 0 | 0.88% → 0 | 0.72% → 0 | 2.43 → – |
| `glyph-clusters` | 23.02% → 0 | 21.35% → 0 | 48.78% → 0 | 2.12 → – |


webkit-host, development: passing lines 86,815 → 86,828, failing lines 331 → 332

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `canvas-language` | 44.14% → 15.44% | 45.01% → 17.15% | 88.82% → 88.25% | 2.01 → 5.72 |
| `simplified-measuring` | 18.31% → 7.75% | 19.80% → 8.29% | 3.32% → 0.30% | 0.18 → 0.04 |
| `page-history` | 5.77% → 3.43% | 14.41% → 8.35% | 19.03% → 12.35% | 3.30 → 3.60 |
| `string-storage` | 0.64% → 0.68% | 0.46% → 0.46% | 0.00% → 0.00% | 0.00 → 0.00 |
| `tab-stops` | 0.32% → 0.32% | 0.95% → 0.95% | 0.91% → 0.60% | 2.85 → 1.89 |
| `control-character-width` | 2.73% → 0.14% | 4.75% → 0.30% | 0.60% → 0.00% | 0.22 → 0.00 |
| `dictionary-breaks-stand-in` | 0.06% → 0.08% | 0.06% → 0.10% | 0.60% → 0.60% | 9.71 → 7.81 |
| `letter-spacing-ligatures` | 7.69% → 0.02% | 9.96% → 0.03% | 5.44% → 6.02% | 0.71 → 290.59 |
| `rtl-shaping-across-inline-boxes` | 0.00% → 0.00% | 0.01% → 0.00% | 0.91% → 1.20% | 393.42 → 1046.12 |


webkit-host, held-out 09-16 without the giants: passing lines 62,752 → 62,691, failing lines 354 → 336

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `canvas-language` | 30.63% → 13.88% | 17.60% → 8.20% | 72.03% → 75.89% | 2.35 → 5.47 |
| `page-history` | 6.05% → 4.31% | 15.87% → 12.08% | 22.88% → 21.73% | 3.78 → 5.04 |
| `simplified-measuring` | 8.98% → 2.37% | 13.78% → 4.69% | 5.37% → 0.00% | 0.60 → 0.00 |
| `tab-stops` | 0.86% → 0.87% | 3.57% → 3.59% | 3.11% → 1.49% | 3.61 → 1.71 |
| `string-storage` | 0.76% → 0.83% | 0.87% → 0.87% | 0.00% → 0.00% | 0.00 → 0.00 |
| `control-character-width` | 11.63% → 0.71% | 25.63% → 1.43% | 8.76% → 1.49% | 0.75 → 2.10 |
| `letter-spacing-ligatures` | 10.68% → 0.12% | 12.81% → 0.25% | 7.63% → 6.25% | 0.71 → 52.24 |
| `dictionary-breaks-stand-in` | 0.05% → 0.07% | 0.09% → 0.17% | 0.00% → 0.30% | 0.00 → 4.06 |
| `rtl-shaping-across-inline-boxes` | 0.00% → 0.00% | 0.01% → 0.01% | 0.00% → 0.00% | 0.00 → 0.00 |


webkit-host, rule families: passing lines 29,644 → 30,302, failing lines 536 → 274

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `canvas-language` | 18.80% → 11.99% | 21.55% → 12.76% | 32.28% → 63.14% | 1.72 → 5.27 |
| `simplified-measuring` | 24.44% → 7.73% | 32.04% → 11.28% | 11.57% → 1.46% | 0.47 → 0.19 |
| `tab-stops` | 2.54% → 2.49% | 7.39% → 7.24% | 0.75% → 1.46% | 0.29 → 0.59 |
| `page-history` | 1.15% → 1.07% | 2.87% → 3.14% | 19.78% → 16.06% | 17.19 → 15.02 |
| `rtl-shaping-across-inline-boxes` | 0.50% → 1.05% | 1.07% → 1.93% | 34.70% → 9.12% | 69.51 → 8.67 |
| `fixed-pitch-path` | 3.62% → 0.90% | 3.73% → 0.97% | 0.00% → 0.00% | 0.00 → 0.00 |
| `control-character-width` | 0.85% → 0.62% | 1.97% → 1.53% | 26.49% → 23.36% | 31.16 → 37.65 |
| `letter-spacing-ligatures` | 23.58% → 0.35% | 24.76% → 0.26% | 20.90% → 0.00% | 0.89 → 0.00 |
| `string-storage` | 0.24% → 0.24% | 0.36% → 0.36% | 0.00% → 0.00% | 0.00 → 0.00 |


webkit-host, feature families: passing lines 34,397 → 34,397, failing lines 32 → 32

| Gap | passing lines | passing cases | failing lines | lift |
|---|---|---|---|---|
| `simplified-measuring` | 48.18% → 5.96% | 69.53% → 11.29% | 0.00% → 0.00% | 0.00 → 0.00 |
| `tab-stops` | 3.77% → 3.77% | 8.85% → 8.85% | 56.25% → 56.25% | 14.93 → 14.93 |
| `canvas-language` | 8.44% → 2.44% | 13.51% → 2.86% | 0.00% → 0.00% | 0.00 → 0.00 |
| `page-history` | 1.01% → 1.47% | 2.68% → 4.28% | 100.00% → 100.00% | 99.13 → 68.11 |

Reading these:

- **Narrowed, with their source readings in specs/*-RESULTS.md:** Blink `script-context` (50.7% → 30.8% of passing development
  lines; the `scriptLookups` fact and default-ignorable characters), `glyph-clusters` and the rule families' `optical-size`;
  Gecko `in-word-prefix` (12.0% → 4.2%, while it still sits on every failing development line: lift 8 → 24),
  `glyph-clusters` (9.9% → 0.01%), `font-fallback`, and `bitmap-emoji-size` and `optical-size`, which the canvas element
  makes unnecessary; WebKit `canvas-language` (44.1% → 15.4%), `simplified-measuring` (18.3% → 7.8%),
  `letter-spacing-ligatures` (7.7% → 0.02%), `control-character-width` (2.7% → 0.1%) and `page-history` (5.8% → 3.4%).
- **New or widened:** Blink `float32-precision` (new: 5.8% of passing development lines, 0.6% held-out, and on no failing
  line anywhere, so nothing yet shows it is needed where it fires), `unsafe-to-break` (3.1% → 3.6%) and `in-word-prefix`
  (1.58% → 1.62%, its lift down from 4.6 to 1.4 as the failures it covered were fixed); Gecko `page-history` (0.01% → 0.07%
  of passing development lines outside history-dependent cases; it reports all 227 history-dependent development and
  held-out cases, §2.8) and `font-size-quantization` on the rule families (on no passing line; 29% → 55% of failing lines,
  the 24 `system-fonts-and-sizes` cases of §2.4); WebKit `rtl-shaping-across-inline-boxes` (0.5% → 1.05% of passing
  rule-family lines) and `dictionary-breaks-stand-in` (0.06% → 0.08%), both cited by their owner.
- On the fresh sets (`.artifacts/lab/fresh/<browser>/eval-r3-<n>/report.json`, `gapFiring`) the shares are within a few
  points of the development sets'.

**Ceiling round 2** (case-level tables, the round 2 library under scorer 4):

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

Verified on 2026-09-18, with the ceiling round 3 library (one bundle, sha256 `80b6b4b8004c…`):

- **Chrome 153.0.8010.50** (the lab's pinned byte-identical copy): every rule family and feature family case in round 2's
  files and in round 3's derivations (the `process-languages` family under en-US too), development, held-out 09-16 with its
  giants, sealed-3 with its giants, and three fresh sets, in both orders, scored against Blink's observation port.
- **Firefox 156.0** (pinned copy): the same without the en-US round, against Gecko's port. The Gecko port measured on a
  detached `<canvas>` element throughout; its OffscreenCanvas fallback wasn't run.
- **webkit-host on WebKit 22625.1.29.11.27**: the same, and the two combined files with installed Safari's parts, against
  WebKit's port.
- **Installed Safari 27.0**: the combined development file (25,180 cases) and the combined rule and feature families file
  (21,734) in both orders, in parts under 8 minutes, all equal to webkit-host's native views, predictions and scores case by
  case (§2.7).
- Probe facts: `rebuild/facts/blink/153.0.8010.50.ndjson` holds .50's probe run (all 756 facts of .48 unchanged, 16 new).
  Round 3's owner probes (blink-round3 R1 and R2, webkit-round3 R1 to R6, gecko-round3 F13 to F19, the font facts'
  letter-spacing probe) are in the RESULTS files; the Gecko probes F7 to F19 return values without checks, so they give no
  facts.

From source or inference only:

- vertical metrics: `y` and `height` are outside the observation contract, and native lines across nodes come from
  vertical-centre grouping;
- slot cases: floats are checked against their rows by rule, but not line boxes taller than the line height;
- `<wbr>` rects in WebKit;
- why a hidden installed Safari page stopped in round 2: read from WebProcessProxy.cpp and WebProcessCocoa.mm, not from
  Safari's logs. Round 3's jobs in parts under that window all finished hidden (§2.7);
- WebKit's full preferred-language list and ICU default locale beyond the first entry, and Chrome's accept languages for
  text without `lang`; only Chrome was observed under a second locale;
- page zoom in all browsers, a physical DPR 1 display, and forced DPR 1 or other app-unit families;
- the observation ports' rules, checked only through native rects: the rows reproduce 99.5% to 100% of predicted values
  (§2.2);
- the mechanism of Gecko's 1 au class beyond `modern` (the Geeza Pro and Thonburi members are reproduced on the canvas
  element by measurement, not simulated); Gecko's unbounded frame (probe F18, untraced); the HarfBuzz flags behind the Blink
  case `c-8c84627af834611f` (read with HarfBuzz 14.2.0, not Chrome's pin) and the three fresh Blink classes of §2.8;
- the Gecko port's OffscreenCanvas fallback, which the lab doesn't run;
- Chrome 153's element.cc and locale_settings_mac.grd citations, still read at 152.

## 6. Known remaining failure classes

What the remaining failures are made of, from the three fresh sets (prediction failures by the gaps that cover them, §2.8)
and the family counts of `gaps/<browser>-{dev,heldout,families-r3}.md`. Sealed-3 failures are counts only.

Blink (181 prediction failures in 34,115 fresh cases, 53 per 10,000):

- **U+FFFC drawn by a fallback font** (`font-fallback`, 130 of the 181, 16 of them with `script-context`): the rule family
  `object-replacement` fails 132 of 348 line counts and every painter case; held-out `U+FFFC/{start,middle,end}` fail 16 to
  21 of 46 line counts each. The coverage fact could turn it into a prediction for fonts a probe covers; the supporting
  probe covers 3 (Blink owner).
- **System fonts and sizes** (`page-history`, 24 fresh failures; the rule family fails 8 of 660 line counts and 40 widths):
  the platform font cache's key lacks the specified size, so `system-ui` widths depend on which of the DOM and Canvas made
  the font first.
- **Arabic at shaping edges** (`glyph-clusters`, `unsafe-to-break`, `in-word-prefix`, `script-context`, 16 fresh
  failures; `rule/joining` 16 line counts): ligatures that form in some contexts only (Geeza Pro lam-meem and lam-lam-heh,
  Courier New `لله` and `ريال`) stay stand-ins, and `positionAdjust16` is a registered heuristic.
- **Open:** the three fresh classes and the `suite/U+FFFC/start` attribution rows of §2.8.
- **Painter:** 99.5% of development suite cases and 97.6% held-out; about 125 failures a fresh set where the prediction
  passes, 60 of them without a covered explanation. 24 pairs from round 2's hanging-space regression still fail (the
  paragraph reshaped the whole part, which `BlinkLineGeometry` doesn't say).

Gecko (576 in 33,432, 172 per 10,000):

- **Breaks inside joined or kerned words whose two sides don't add up** (`in-word-prefix`, 397 of the 576): the
  invisible-character families' joined beh letters in 16px Amiri around a soft hyphen (20 to 22 widths of 196 each in
  development), `original-vs-reshaped-admission` 11 of 42 line counts, held-out `joined`, `glue` and `barrier`, the rule
  families `joining` (96 widths of 928) and `in-word-breaks` (42 of 602). No Canvas recipe for the Amiri cross term was
  tried.
- **Font sizes Canvas can't set** (`font-size-quantization`, 175 of the 576, all in the family paragraphs at new widths):
  `system-fonts-and-sizes` fails 36 of 680 line counts and 164 widths, `fit-bound` 19 of 360 and 90. The canvas element keeps
  7 significant bits of the size over the device scale.
- **Open:** letter spacing in a cursive cluster on the wrong cluster (1 fresh row), a tab after a frame that starts inside a
  cluster (owner's set 15, read and not ported), and the unbounded frame of probe F18 (3 held-out rows, covered by position
  only, untraced).
- **Passing cases with a wrong predicted value:** 23 development and 7 held-out corpus paragraphs (Myanmar U+1038, a Noto
  Nastaliq Urdu in-word position).
- **Painter:** 94.0% of development suite cases and 90.3% held-out; about 500 failures a fresh set where the prediction
  passes, 440 without a covered explanation: a line edge inside shaped text, which a line painted alone can't reproduce
  (`edge-inside-shaped-text`, `frame-ended-at-break`).
- **History dependence:** development 123, held-out 09-16 104, sealed-3 136, fresh 104, 116 and 95, all in suite cases; 527
  of the 542 opened ones pass in both orders (§2.8).
- **Not run:** the OffscreenCanvas fallback for pages without `document`, where round 2's gaps and the 1 au class return.

WebKit (686 in 33,202, 207 per 10,000):

- **Fonts chosen by language** (`canvas-language`, 474 of the 686, 38 of them with `page-history`): `runs/lang-spans` fails 9
  line counts, 50 breaks and 76 widths of 373 in development and 8, 39 and 96 of 359 held-out; `policy/zh-lang`; the rule
  families `keep-all-storage` and `languages`. Under ko a list with PingFang SC draws kana at Apple SD Gothic Neo's
  advance, which Core Text doesn't explain; an OffscreenCanvas has no locale. Needs the per-language cascade as a given
  fact, or a connected `<canvas>` with `lang` (a maintainer decision).
- **Ligature pairs under letter spacing** (`letter-spacing-ligatures`, 84): the pair adjustment inside a separated ligature
  pair (`suite/ligature-thresholds-v3` 60 fresh failures); measured with U+200C where that is exact (Amiri, Hoefler Text).
- **Page history** (`page-history`, 54 alone): level boundaries, preserved white-space structures and carried widths the
  break cache can hand a box from another paragraph; feature `br-elements` fails 20 line counts and 32 breaks that pass alone
  in a fresh process. History worlds vary one box at a time, a declared approximation.
- **VT, FF and CR inside a word** (`control-character-width`, 38): pieced widths one float32 step off in Helvetica Neue
  (`rule/controls` 64 widths of 336).
- **Runs shaped across inline boxes** (`rtl-shaping-across-inline-boxes`, 23): the float32 order of shaped run sums, and the 8
  `rule/joining` rows whose native shaped share matches no Canvas total.
- **Open:** the float32 step at a moved x (1 fresh row), and 1 unopened sealed-3 row.
- **Widths unobserved** where `contentWidth` sits a float32 step from the union of the boxes: 243 development, 257 held-out
  (and 8 of its 9 giants) and 279 sealed-3 cases (§7 item 4).
- **Painter:** 95.5% of development suite cases, 81.3% held-out and 82.2% sealed-3; about 900 failures a fresh set where the
  prediction passes. About 95% are carried widths one float32 step off (`carried-width`, painter owner's count), which need a painted form
  with the neighbouring line's text.
- **History dependence:** development 82, held-out 09-16 180, sealed-3 168, fresh 46, 66 and 54.

## 7. Open decisions

As the round 3 evaluation left them; an item round 4a settled says so at its end.

1. **Host rows in reported numbers.** Installed Safari equals webkit-host on every case it ran in round 3: the development
   and family files in both orders, scores included, in parts under 8 minutes with no failed job (§2.7). **Recommendation:**
   let webkit-host rows stand in for WebKit geometry and predictions under lab/WEBKIT-HOST.md's conditions, named as
   webkit-host; keep installed Safari as a spot check in parts, and rerun it after any Safari or macOS update.
2. **Gecko in-word recipe** (gecko-shortcut-audit D1). U+200D came back from source in round 3: both sides of an offset
   between joined letters are measured with it, and the position is exact only where the two sides add up to the unit (probe
   F15); elsewhere it stays a stand-in under `in-word-prefix`, which now covers 397 of Firefox's 576 fresh prediction
   failures. **Recommendation:** keep it; try a Canvas recipe for the Amiri cross term, the dominant class left.
3. **Browser-process languages.** Unchanged: recorded and given in all three browsers; Chrome's accept languages have no
   input, and only Chrome ran under a second locale.
4. **WebKit line width.** The scorer marks a line unobserved where `contentWidth` isn't the float32 union of its boxes: 779
   cases over development, held-out 09-16 and sealed-3, and 8 of the 9 held-out giants. **Recommendation:** unchanged; the
   architect decides.
5. **Retire G0.** Unchanged. **Recommendation:** attribute the widths and painter pairs, then retire G0 (DESIGN §8.3 stage
   4).
6. **Painter metric.** It compares extents and wraps only. `painterLimits` names a limit on nearly every painter failure,
   but it isn't exported or recorded, so painter failures without a covered explanation rose as the engines' conditions
   narrowed (§2.8). **Recommendation:** record the limits per painted line and let the scorer cover by them; decide whether a
   painted form may hold the neighbouring line's text (WebKit's carried width, Blink's space shaped with the next line,
   Gecko's frame that broke inside itself). **Round 4a:** the limits are recorded per painted line and cover (scorer 6);
   the painted form is open, and painter exactness is part of the known tail.
7. **History-dependent layouts.** WebKit's `page-history` is computed from history worlds and reports every
   history-dependent case; in Firefox the canvas element follows the DOM's font state, so predictions are right in both
   orders while `page-history` names only part of the effect (§2.8). **Recommendation:** decide what the library promises
   about time: a prediction holds for the page state it was measured in. Keep the isolation protocol for suspects.
8. **Weak gaps.** Under the lift over prediction failures only `tab-stops` stays weak in webkit-host; under round 2's lift,
   which counts painter-only failures, nearly everything there does (§2.8). `canvas-language` still fires on 15% of passing
   development lines and covers 474 of webkit-host's 686 fresh failures. **Recommendation:** fix one lift definition (the
   prediction one), and decide the inputs that would turn `canvas-language` into a prediction (the per-language cascade as a
   fact, or a connected `<canvas>` with `lang`). **Round 4a:** lift is over prediction failures alone, painter-only failures
   apart; generic families are measured through Core Text's per-language family table, kept as engine data (CHARTER.md,
   decision 4), and `canvas-language` fires on 1.1% of passing development lines.
9. **Sealed held-out.** `sealed-3-20260917` ran once and stays sealed: only counts left the scorer. It shows 2 open Chrome
   rows and 1 webkit-host row that weren't opened. **Recommendation:** pursue them through fresh sets, not by opening the
   set; generate sealed-4 before the next round, and rotate per browser release (TEST-ARCHITECTURE §3).
10. **Chrome 153.0.8010.50.** The lab launches a pinned copy, TESTS.md §12 ran for .50 (facts, derivations), the library
    accepts .50 as source-identical, and the staged tests seeds are .50's throughout. **Recommendation:** adopt the staged
    seeds after the critic and move the library's own pin. **Round 4a:** scorer 6 makes the staged scorer 5 seeds refuse;
    seeds are made again after round 4's merges. The pin hasn't moved.
11. **Blink in-word geometry.** Resolved in round 3 by limited states the layout marks: passing development cases with a
    wrong predicted value went from 2,022 to 18 (§2.2). Left: 18 development, 33 held-out and about 11 a fresh set, untraced.
12. **Gecko's canvas element.** The Gecko port measures on a detached `<canvas>` element at the DOM's device font size. It
    removes the 1 au residual class, the synthetic-bold class, `bitmap-emoji-size` and `optical-size`, and in both-orders
    runs it follows the DOM's font state: 527 of 542 history-dependent suite cases pass in both orders. It needs
    `document`, so a worker falls back to the OffscreenCanvas path with round 2's gaps and classes, which no lab run covers.
    **Open decision for the maintainer:** whether the library may measure there. If yes, the lab should run the fallback path
    too, so its classes stay counted. **Decided on 2026-09-18:** no; Firefox measures on an OffscreenCanvas always, with its
    measured cost and two unmerged alternatives in CHARTER.md, decision 2.
13. **Costs.** Record only, as tentpole 8 says. Calls rose again in all three engines in round 3 (§3).
14. **API.** Open (tentpole 8).
15. **UI and system language facts** can't be read from page APIs. **Recommendation:** keep them explicit inputs that report
    `ui-language` when absent, and tell developers to set `lang`.
16. **Firefox bug candidate.** A grapheme cluster split between its two marks across spans in Geeza Pro gives a frame
    2^30 + 56 au wide natively (probe F18). **Recommendation:** trace it in source or report it, and give the scorer a way
    to mark such rows instead of counting them covered by `in-word-prefix` (§2.8). **Round 4a:** traced
    (`ComputeLigatureData` divides a signed advance by an unsigned count, gfxTextRun.cpp:249-289, probe F20); the report
    page is rebuild/platform-bugs entry 14, and `in-word-prefix`'s reading now names the function. Nothing is filed.
17. **Scorer attribution rules.** Two known observation consequences count as open rows because scorer 5 has no rule for
    them: WebKit's `f32(f32(x + w) − x)` rect width at a moved x, and Blink's `suite/U+FFFC/start` rows where a soft hyphen's
    copied rect makes the scorer attribute the line after the cause. **Recommendation:** port them as observation rules with
    their source, or keep counting them open. **Round 4a:** both are scorer 6 rules. Blink's 3 `suite/space` rows need the
    same soft-hyphen attribution on the predicted line and still count as open (round 4b, tests owner).
18. **Facts-free headline.** The maintainer's line is a library without supplied font facts; this evaluation's numbers are
    with the lab's facts, and research/FACTS-FREE.md has the other side. **Recommendation:** run the next evaluation both
    ways on the same fresh sets. **Decided on 2026-09-18:** the headline is with no supplied font facts, the library asks
    Canvas itself where a check is sound, and every tier runs both configurations (Round 4a above).
19. **The correctness line** freezes after round 4 with a known tail (CHARTER.md, decision 3): what is left under gaps
    that could become predictions, conditions that only diagnose, the rare-script tail and painter exactness go to the
    ledger's backlog with case ids instead of being worked on.
20. **Browser bug reports.** rebuild/platform-bugs/LEDGER.md has 14 candidates with standalone pages checked in the three
    lab browsers, and 7 facets of tracked bugs. Nothing is filed; filing is the maintainer's.
