# Tests for the rebuild

Status, 2026-09-18, branch `rebuild-20260916` after the round 4 evaluation (the sections below keep the date of what they describe). This replaces the 2026-09-16 test strategy (research/TESTS.md). That strategy made main's accuracy grid, oracles and filed reports first-class obligations. Here main's suite and obligations are a measurement corpus (CHARTER.md tentpole 5). The blocking layers are the rebuild's own:

- rule-targeted families, at widths derived from the browsers' observations;
- versioned probe facts;
- coverage of library rules.

The design is research/TEST-ARCHITECTURE.md. This document says what exists, how to run it and what the first runs found.

## Tiers

What to run after a change, by time (rebuild/lab/README.md, "Test tiers", has the sets, the protocol and what each tier
can't see). Every tier runs two configurations: `no-facts`, the headline, and `facts`.

| Tier | Command | Shows | Measured on 2026-09-18, other jobs running beside |
|---|---|---|---|
| 0 | `bun test rebuild` | a failing unit test | 11 to 15 s (727 tests) |
| 1 | `bun rebuild/tests/replay.ts check --browser=all --config=all` | every case whose full prediction changed against a frozen reference, from recorded Canvas answers with no browser; the cases that need one | 77 s for six references, 380,882 cases |
| 2 | `bun rebuild/tests/browser-sets.ts --browser=<browser> --out=<dir>` | status transitions against the reference ledger, of the four metrics and of the exact-value status (a case whose predicted values stop equalling the browser's while every metric passes), lost pairs against the build-keyed seed | forward order, one browser: Chrome 88 s, Firefox 108 s, webkit-host 128 s |
| 3 | the round's evaluation (fresh sets, sealed sets, giants, installed Safari) | new classes on cases nobody saw | REPORT.md |

**State at the correctness line, 2026-09-18.** The six references under `.artifacts/tests/reference` are frozen at 6b21b68
and pinned in `rebuild/tests/reference/`, packed from `.artifacts/tests/runs/line-20260918/<browser>-<config>` (every tier
set with `rich-prewrap`, both orders, both configurations; Chrome 66,685 cases, Firefox 63,771, webkit-host 63,987; recorded
at feb3937, the same library). All 388,886 cases replay the browser's own prediction exactly, the question sequences
included, and tier 1 exits 0 in 42 s. The recordings equal the round 4 evaluation's (3c17016, before the font checks measured
at text-rendering `optimizeLegibility` in Blink) on every status, per-case file, native observation, prediction and painted
line. The ledger is format 2: beside the four metrics every case has an exact-value status, and tier 2 exits 1 when a case
stops being exact (lab README "The ledger"). The seeds are adopted (§9). The lab README's "The correctness line" has the
commands, the numbers and what the line doesn't hold; the references they replaced described the round 3 library.

Tier 1 is a change detector, not an oracle: its expected values are the library's own at a commit. Its inputs are recorded
per library, so a library that asks Canvas new questions needs a new recording (`browser-sets.ts --record`, `replay.ts
pack`, `freeze --force --reason`). `replay.ts check` keeps its scratch folder inside the reference folder, so two checks of
one reference at the same time collide; give each its own `--dir` that links the shared `inputs`, `reference`, `ledger` and
`browser` folders.

Terms:

- **Rule**: one library behaviour with a registry id such as `blink/lines/fit-bound-plus-one-lu`, a kind, a citation, probe labels and asserting tests.
- **Family**: paragraphs built to exercise named rules, with focus offsets where a rule should act at a line edge.
- **Target**: a question about one paragraph in one browser: at which width does the native line starting at offset s first reach offset k.
- **Bracket**: two adjacent grid widths; at one the line reaches k, at the other it doesn't.
- **Grid**: the unit available widths live on: 1/128 CSS px in Chrome at DPR 2, 1/64 in Safari, 1/60 (app units) in Firefox.
- **Environment key**: what `lab/score.ts environmentKey` names for a row: the browser, the app bundle build, the engine build, the OS build, DPR, visual-viewport scale and the scorer version.

## 1. Where things are

| Path | What |
|---|---|
| `rebuild/tests/rules.json`, `registry.ts`, `import-rules.ts`, `import-rules.test.ts`, `rule-changes.json` | The rule registry and how it's generated |
| `rebuild/tests/families/` | Family declarations (`lines.ts`, `breaks.ts`, `fonts.ts`, and `inline.ts` for inline structure, line slots, alignment and process languages), `catalogue.ts`, the family types and pairwise covering rows (`covering.ts`) |
| `rebuild/tests/fit.ts` | Each browser's fit arithmetic, from recorded probe verdicts |
| `rebuild/tests/derive.ts`, `noop-predictor.ts`, `observe-families.sh` | Width derivation and the observation loop |
| `rebuild/tests/facts.ts`, `seed-facts-20260916.sh`, `rerun-probes.sh`; `rebuild/facts/<engine>/<engine build>.ndjson` | Versioned probe facts |
| `rebuild/tests/coverage.ts` → `rebuild/tests/coverage.json` | The coverage matrix (the headline configuration's; each configuration's is beside its seeds) |
| `rebuild/tests/gate.ts` → `rebuild/tests/baselines/{no-facts,facts}/<browser>[-features]-<engine build>.json` | The layered gate, a seed per configuration with its seed record (§9) |
| `rebuild/tests/independence.test.ts` | No expected value from `rebuild/src` |
| `rebuild/tests/sets.ts` | The tiers' sets and run protocol |
| `rebuild/tests/replay.ts`, `rebuild/tests/reference/` | Tier 1: offline replay against a frozen reference, pinned by hash in the manifests |
| `rebuild/tests/browser-sets.ts`, `rebuild/tests/baselines/sets/` | Tier 2 and its adopted seeds, `<browser>-<engine build>-<config>.json` with seed records |
| `rebuild/tests/known-tail.json`, `known-tail.ts`, `known-tail.test.ts` | The known tail: the classes left open at the frozen line, with case ids and rules over a tier 2 ledger, its exact-value status included (63 items) |
| `rebuild/tests/compare-sets.ts`, `rebuild/lab/compare-rows.ts` | Two tier 2 runs, or two row files, case by case (measure first, installed Safari against webkit-host) |
| `rebuild/tests/ledger.ts` | The known-status ledger: the four metrics' statuses and the exact-value status per case, transitions and conditions |
| `rebuild/lab/rows.ts`, `predictor-core.ts`, `port-measure.ts` | Rows read plain or `.zst`; the one prediction adapter; the observation ports' live measuring |
| `rebuild/src/measure/font-checks.test.ts`, `rebuild/probes/font-checks.ts` | The runtime font checks against a stand-in Canvas (20 tests; one ties the joining-script test to the Blink port's joining types, two hold the checks' contexts to the engine's own text rendering), and in the browsers over the lab's font declarations, beside the font table and the DOM (`.artifacts/lab/font-checks/tools/verdict.ts`): a check per release |
| `rebuild/src/measure/canvas-checks.test.ts`, `rebuild/probes/canvas-checks.ts` | `detectEngine()`'s Canvas checks against stand-in contexts, and the library's own `detectEngine()` in a browser: a pinned browser must answer supported (`LAB_CHROME_APP`, `LAB_FIREFOX_APP` for another build) |
| `rebuild/src/measure/canvas.test.ts`, `rebuild/probes/blink-storage.ts` | The string an engine hands to `measureText` reaches Canvas as built: no `Map` or `Set` key holds the measured string's characters alone while `measureText` runs (V8 would hand Blink a one-byte string afterwards), and in pinned Chrome the library's own bundled module answers a run of brackets on its `8bit` and `16bit` contexts as each storage shapes (S5; `rerun-probes.sh` reruns the probe per Chrome release) |
| `rebuild/knip.config.ts` | `bunx knip --config rebuild/knip.config.ts`: unused files and exports under `rebuild/`, tests ignored |
| `rebuild/lab/browser-build.ts`, `rebuild/lab/pin-browser.sh` | The apps `lab/run.ts` and `probes/runner.ts` launch (pinned copies of Chrome and Firefox), and the build read from their bundles |
| `rebuild/lab/sharded.ts` | One case file as several jobs at once; derivation observes through it |

- `bunx tsc --noEmit -p rebuild/tests/tsconfig.json`
- `bun test rebuild/tests`: 85 tests in 14 files.

Derived case files, rows and derivation records live under `.artifacts/charter-20260916/tests/families-20260916/<browser>/`. A baseline names its case file with a sha256.

## 2. Layers

| Layer | Proves | Expected values from | Code | In the gate |
|---|---|---|---|---|
| L0 observer | The scorer compares rects by its stated rules | Hand-built rows | `lab/score.test.ts` (scorer owner) | bun |
| L1 engine data parity | Tables and shared algorithms equal the engines' libraries | ICU, BidiTest, recorded answers | `rebuild/src` bun tests (owners) | bun; counted as coverage through registry tests |
| L2 browser facts | A claim about one browser build holds | Probe observations with in-probe verdicts | `rebuild/facts`, `facts.ts` | blocking: flips and missing facts |
| L4 rule families | Named rules match the browser at the widths where its decision changes | Native observations at derived widths | `families/`, `derive.ts` | blocking: lost pairs |
| L5 natural families and main's corpus | Realistic paragraphs and main's suite, measured | Native observations | `lab/cases` | report only |
| L3 replay | The library's full prediction is unchanged against a frozen reference, from recorded Canvas answers, with no browser | the library's own output at a commit (a change detector, not an oracle) | `tests/replay.ts` | report only: tier 1 (lab README "Test tiers") |
| L6 held-out | | | sealed sets run once per evaluation, counts only; not a gate layer (§13) | |

## 3. Rule registry

- `bun rebuild/tests/import-rules.ts` writes `rules.json` from the 2026-09-16 catalogue (399 rules) and `rule-changes.json`:
  - 29 rules removed, each with its replacement: the lab-visibility widths, the choices by score and the name keys the owners replaced;
  - 40 reclassified entries, 14 of them round 4's new names for tests renamed since the catalogue, and 1 round 4c's restatement of Gecko's tab width (tab-size is the text frame's own);
  - 169 added: 44 from the owners' stage 1 reports, 55 for stage 5 (2026-09-17), 6 in ceiling round 2, 9 in ceiling round 3, 51 in round 4 (the runtime font checks 6, the Canvas checks 1, Blink 12, Gecko's round 3 rules 11 and round 4 rules 16, WebKit 2, scorer 6's observer assumptions 3) and 4 in round 4c (the port rules research/PREWRAP-RICH.md found: Blink 2, Gecko 1, WebKit 1);
  - 539 rules are current: Blink 195, WebKit 156, Gecko 152, shared 36.
- **Change rules in `rule-changes.json`, never in `rules.json`.** A `reclassified` entry replaces the fields it names (kind, statement, source, probes, tests, area, declaredBy) on any rule, from the catalogue or added; entries for one rule apply in order. Until ceiling round 3 the importer threw on a reclassified id that wasn't in the catalogue, so round 2's owners edited `rules.json` by hand, and a regeneration would have lost those edits.
- **Hand edits aren't lost.** `rules.json` keeps a hash of every rule as generated (`generated`). On the next import a rule whose file version moved while `rule-changes.json` didn't is written into `rule-changes.json` (a reclassified entry with the fields that differ, or an added entry for a rule added by hand), and the importer says so. When both moved and disagree, a rule was deleted by hand, or a hand edit touches id, engine, status, replacedBy or audit, it stops, names the rule and writes nothing. `--check` writes nothing and exits 1 when either file would change. The first run moved round 2's hand edits over: 5 Gecko rules' statements, sources, probes and tests, and the 2 Gecko rules added by hand. A registry without hashes counts as hand-edited wherever it differs from the generation, so on that first run a fresh change to `rule-changes.json` looks like a hand edit of the old text; it happened with two entries, which were put right by hand.
- `declaredBy` says where an id comes from:
  - the catalogue;
  - the Blink owner, who declared ids;
  - `provisional`, for 19 WebKit and Gecko replacements that the owner reports gave only as table rows;
  - `provisional (stage 5, feature families 2026-09-17)`, for the 55 stage 5 rules. They come from DESIGN.md §1.1, §2.9 and §8.3 stage 5 with the architect's citations; the engine owners confirm or rename them when they annotate the source.
- The stage 5 rules are 17 Blink, 17 WebKit and 16 Gecko rules for box edges, per-element styles, atomic inlines, `<br>`, `<wbr>`, text-indent, text-align and line slots; 3 observation rules for `Element.getClientRects()`; and 2 observer assumptions (kind `observer assumption`): `shared/lab/vertical-centre-grouping` and `shared/lab/slot-rows`.
- A rule's source annotation is `// rule <id>` in `rebuild/src`. `coverage.ts` lists rules without one (all but the WebKit owner's 9 round 3 rules) and annotations the registry doesn't know. Once owners annotate, the registry is regenerated from the annotations.

## 4. Rule-targeted families

A family declares:

- its name;
- rule ids per engine, which decide the browsers it runs in;
- `why`: the cited source or verdict behind its axes;
- relevant axes, covered exhaustively;
- neighbour axes, covered by pairwise covering rows, where every pair of values of two axes appears at least once (deterministic, greedy);
- a builder: from one combination and a seeded random stream, a paragraph with focus offsets. Background values that no rule reads are drawn from that stream.

Axis values that only move the focus give the same paragraph; they fold into one with the union of their focus offsets. Characters and fonts are written into the builders with their class noted, and nothing imports `rebuild/src`.

| Family | Engines | Relevant axes | Paragraphs |
|---|---|---|---:|
| fit-bound | all | words × size 16, 13, 17.3 | 90 |
| following-space | all | kerning word end × one, three or NBSP spaces × Arial, Times New Roman | 72 |
| controls | all | CR, FF, VT × normal, pre-wrap, pre-line, break-spaces | 48 |
| tabs | all | tab-size 0, 1, 4, 8 × pen position × Arial, Helvetica Neue, Menlo | 144 |
| hanging-white-space | all | trailing white space × pre-wrap, break-spaces, normal | 60 |
| forced-breaks | all | U+2028, U+2029, LF × normal, nowrap, pre-line, pre-wrap | 48 |
| rewind | all | prefix × word length × span placement | 72 |
| in-word-breaks | all | AV, Wa, ffi and n words × break-all, anywhere, break-word | 72 |
| languages | all | lang "", en, ja, zh, ko × line-break × text the tables disagree on | 120 |
| hyphen-classes | all | word-break × loose × `-`, U+2010, U+2013 × preceding letter, digit or ideograph | 108 |
| quotes | all | lang da, de, sv, en, fr, ja, "" × quote pair × ideograph or letter | 112 |
| keep-all-storage | all | punctuation, spaces, ZWSP × 8-bit or 16-bit node × keep-all or normal | 48 |
| segment-breaks | all | newline between wide characters, punctuation, ZWSP × lang × node edge | 80 |
| clusters | all | Bengali ya-phala and conjuncts, marks, Thai × break-all, anywhere, line-break anywhere | 48 |
| urls | all | slash, hyphen and query words × overflow-wrap | 32 |
| zwnj | all | white-space × ZWNJ placement × ZWNJ at a span start | 36 |
| hankerning | Blink | close, open, dot and comma marks × line end, start, middle × Hiragino Sans, PingFang SC, Songti SC | 90 |
| hyphen-glyph | all | fonts on both sides of mapsHyphen × one or two soft hyphens × letter spacing | 96 |
| joining | all | Geeza Pro (AAT), Arial, Noto Naskh Arabic, Amiri × soft hyphen, break-all, anywhere × span edge | 96 |
| monospace | all | Menlo, Courier New, Monaco, Arial × break-word, anywhere × word | 64 |
| system-fonts-and-sizes | all | system-ui, BlinkMacSystemFont, -apple-system, Georgia × 13, 17, 20.5, 13.33, 16.8px | 80 |
| object-replacement | Blink | U+FFFC placement × font | 36 |

Totals:

- Chrome: 1,652 paragraphs in 22 families.
- webkit-host and Firefox: 1,526 paragraphs in 20 families each.

**Stage 5 families** (`families/inline.ts`, 2026-09-17). Their paragraphs are trees (lab/types.ts `InlineStructure`, built with `lab/cases/build.ts` `treeParagraph`); a tree that is flat becomes an ordinary flat case with its flat id.

| Family | Engines | Relevant axes | Paragraphs per engine |
|---|---|---|---:|
| box-edges | all | padding, border, margin or negative margin × start, end or both sides × a span holding a word, crossing a break, or inside a word | 288 |
| nested-box-edges | all | end edges on the inner, outer or both spans × padding, border and padding, or margin × start edges or none | 72 |
| nowrap-spans | all | nowrap in normal, normal in nowrap, pre-wrap in nowrap, nowrap in pre-wrap, pre in normal × where the spaces sit against the span edges | 80 |
| atomic-inlines | all | letter, space, NBSP or ideograph before × the same after × normal block, nowrap span or pre-wrap block | 288 |
| br-elements | all | word, space, spaces and tab, or nothing before × word, space and word, or a second br after × normal, pre-wrap, pre-line, break-spaces | 192 |
| wbr-elements | all | Latin, Hangul, before a space, ideographs × normal, keep-all, break-all × normal, pre-wrap, inside a nowrap span | 144 |
| text-indent | all | 16, 40.3, −12, −40px × words, a tab, a br, a long word × LTR, RTL | 128 |
| text-align | all | start, end, center, justify, left, right × LTR, RTL × a last word that kerns with the space | 144 |
| line-slots | all | equal rows, a wide first row, a wide second row × left, right, both × 40 or 37.3px × words, a long first word, tabs | 216 |
| process-languages | Blink | `a”b`, small kana, iteration marks, a middle dot × lang="" on the block, a span, a span inside `lang=ja` × auto, strict, loose; derived under two application locales | 72 |

Totals: Chrome 1,624 paragraphs in 10 families (and the 72 process-languages paragraphs again under en-US); webkit-host and Firefox 1,552 in 9 each.

## 5. Deriving widths from observations

`bun rebuild/tests/derive.ts --browser=<browser> --dir=<dir>` runs one offline step. It exits 10 and prints the case files to observe, or exits 0 once `<dir>/final` holds the family cases. It reads native rows only; derivation runs use `noop-predictor.ts`, so no library code runs in the page.

- **Pass A.** Width 1 with overflow-wrap normal, plus width 1 with the paragraph's own styles when its overflow-wrap isn't normal. Line starts after the first line are break opportunities.
- **Pass B.** Width 100000px. The extent of [s, k) is the right edge of its code points' positive rects minus their left edge, without trailing SPACE, TAB or LF in the modes where they hang.
- **Targets.**
  - Wave 1 starts at 0 and after every forced break.
  - At each focus offset the candidate there is chosen, or the nearest candidates on each side, excluding the opportunity the line at s reaches at width 1.
  - Wave 2 starts at the native line starts that follow wave-1 lines at the derived and bracket widths. Among them are the line after a first word, where overflow-wrap breaks, and the line after a HanKerning trim.
- **Pass C.** Each target is observed at the derived threshold T, at T minus one grid unit, and at T ± 1, 4 and 16px. T comes from recorded facts (`fit.ts`):

  | Browser | Fits when | Recorded by |
  |---|---|---|
  | Chrome | C ≤ trunc(width × 64 × DPR) + 1 LayoutUnit, so T = C − 1 | blink-lines H2: 11959/128 content, 1 line at 93.421875, 2 at 93.4140625 |
  | Safari, webkit-host | first one-line width ceil(64 × E) − 1 LayoutUnits | probes-safari "Item widths"; webkit-lines H3: 2985/64 |
  | Firefox | content au ≤ round(width × 60) | gecko-lines H1: 5184 au fits at 86.4px, not at 86.38px |

- **Pass D.** While the nearest widths where the line reaches k and where it doesn't are more than one grid unit apart, 16 widths between them are observed, for at most 6 rounds.
- **Limits.** 4 targets per segment in wave 1; 2 per line start and 4 per paragraph in wave 2; at most 12,000 cases per file.
- **Outcomes.**
  - resolved: a bracket, with its offset from T in grid units;
  - no reach: no observed width has a native line at s that reaches k. Most are wave-2 line starts that exist only while the paragraph wraps;
  - unresolved, with a reason:
    - `no-line-inside`: every width inside the window was observed without a line starting at s;
    - `no-short-width`: no width below the window where the line doesn't reach k;
    - `rounds-exhausted`: bisection ran out of rounds.
- **Line keys.** A native line's key is its lowest code point offset with a positive rect, under `score.ts nativeLines` grouping (an observer assumption). Keys only decide where to look. An atomic inline, `<br>` or `<wbr>` holds no offset, so a break just before an atomic inline and one just after it have the same key; the bracket at that key still includes the box when the line can't break before it.
- **Consistency.** Derivation refuses rounds observed under another build, DPR or set of given process languages.
- **Structured paragraphs** (stage 5):
  - Pass A cases leave out the line slots and the text-indent: break opportunities are properties of the content, floats wider than width 1 stack past their rows, and a negative indent lets the first line hold more than one piece. Pass A sets `overflow-wrap: normal` on every span as well as the block.
  - No sized pass is narrower than the widest row's left plus right insets. Below that the row's floats don't fit side by side and one drops into the next row, which breaks the slot protocol (DESIGN.md §2.9).
  - T adds the first row's insets, and for targets starting at 0 the text-indent, to the extent. Box edges and atomic inlines aren't added; where they decide a bracket, pass D finds it.
- **Outputs** in `final/`:
  - `family-cases.ndjson`: per paragraph the A and B cases, and per resolved target the reach and short widths;
  - `derivation.ndjson`: each case's family, rules, role, target, offset and the case ids it was derived from;
  - `summary.json`: per family targets, resolved, at the derived width, the offset histogram and unresolved reasons.

`bash rebuild/tests/observe-families.sh <chrome|webkit-host|firefox> <dir>` loops:

1. Derive.
2. Observe each case file as one job under `with-browser-lock.py`. `run.ts` reads the app bundle build into every row, checks it against the user agent and records it in `run.json`.
3. Repeat until `final/` exists.
4. Run the family file in file order and reversed with `lab/predictor.ts`, and score both with `--native-compare`.

Every observation goes through `lab/sharded.ts`: the case file is cut into shards that run at the same time, each under the browser lock in its own browser instance, and the joined folder reads like one run. It stops after one failed job, runs nothing twice and doesn't pause; a full derivation of the rule families takes two to three minutes a browser. Environment:

- `FAMILIES=a,b`: derive only these families, read when the directory is first planned.
- `SHARDS=N`: shards per case file (default: the browser's lock slots, 3).
- `LAB_RUN_ARGS`: more `run.ts` arguments for every job, such as `--chrome-apple-languages=en-US --chrome-accept-languages=en-US,en`.
- `FINAL_RUNS=native`: the final runs use `noop-predictor.ts`, into `final/native-file` and `final/native-reverse`, and compare only native observations. This is for families whose inputs the engine ports don't implement yet, and for derivations made while the library is being changed. Coverage doesn't read these runs.

## 6. First runs, 2026-09-16/17

macOS 27.0 (26A428), DPR 2. Chrome 153.0.8010.48; webkit-host on WebKit.framework 22625.1.29.11.27 (Safari 27.0); Firefox 156.0. All jobs ran under the lock, between census chunks. The final runs predicted with font facts attached (`lab/font-facts.ts`, landed 23:55).

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome | 22 | 1,652 | 15 | 5,335 | 4,053 | 2,864 | 444 | 838 | 16 | 10,976 |
| webkit-host | 20 | 1,526 | 17 | 4,406 | 3,438 | 149 | 229 | 739 | 8 | 9,584 |
| Firefox | 20 | 1,526 | 13 | 4,428 | 3,447 | 2,846 | 261 | 720 | 0 | 9,584 |

Unresolved reasons: all 444 in Chrome and all 261 in Firefox are `no-line-inside`; webkit-host has 227 `no-line-inside` and 2 `rounds-exhausted`.

What the offsets say:

- **Chrome.**
  - The next most common offset after 0 is −1 LayoutUnit: code point rects are rounded outward, so extents overshoot (TENTPOLES-CRITIC §2.E item 1).
  - hankerning has 36 brackets at −1,024 and −1,025: the 8px line-end trim of blink-lines H15.
  - hyphen-glyph brackets sit at 682, 766 and 930: the hyphen's width, which pass B's extent leaves out.
- **webkit-host.** 149 of 3,438 brackets at the derived width; most offsets are −3 to −105 units of 1/64px, because Safari snaps partial Range edges outward to whole px. Bisection is the protocol there, as TEST-ARCHITECTURE §2.3 expected.
- **Firefox.** 2,846 of 3,447 at the derived width. hyphen-glyph at 320 and 359 au is the hyphen. hyphen-classes at 1,068-1,074 au, urls at 1,760-2,349 au and in-word-breaks at 1,458-1,778 au aren't traced.

Scores of the forward runs, compared with the reverse runs:

| Browser | Cases | lineCount pass / fail | breaks pass / fail | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome | 10,976 | 10,740 / 236 | 10,640 / 336 | 10,160 / 416 / 64 / 336 | 9,985 / 927 / 64 | 0 |
| webkit-host | 9,584 | 9,447 / 131 | 9,365 / 213 | 8,764 / 290 / 311 / 213 | 8,330 / 1,051 / 197 | 6 |
| Firefox | 9,584 | 9,422 / 162 | 9,166 / 418 | 8,481 / 685 / 0 / 418 | 8,048 / 1,536 / 0 | 0 |

Families with the most line count or break losses. These are measurements of the library today, not yet attributed; counts include each paragraph's A and B cases.

- **Chrome:**
  - object-replacement: lineCount 216 of 348, no width passes (U+FFFC, blink-shortcut-audit C-u4);
  - languages 828 of 848; quotes 504 of 516; joining 702 of 718; tabs 784 of 796; following-space 272 of 288.
- **webkit-host:**
  - joining: lineCount 681 of 752, breaks 654, widths 444;
  - controls: lineCount 312 of 336, breaks 288, widths 174;
  - hanging-white-space 226 of 238; keep-all-storage 371 of 376.
- **Firefox:**
  - system-fonts-and-sizes: lineCount 620 of 680, breaks 500, widths 216;
  - joining: lineCount 680 of 736, breaks 606;
  - fit-bound: lineCount 341 of 360, breaks 330, widths 240;
  - hyphen-classes 744 of 756; hyphen-glyph 536 of 544.

### Stage 5 families, 2026-09-17

Native derivation only, seed `feature-families-20260917`, into `.artifacts/tests/features-20260917/<browser>/` (`chain.sh` there). The same builds, macOS 26A428, DPR 2. The given process languages were Chrome `uiLanguage` zh-CN (and en-US for `chrome-en-US`), webkit-host `preferredLanguages` zh-CN with ICU default `en_US_POSIX`, Firefox `regionalPrefsLocale` zh-hans-us. The final runs used `noop-predictor.ts` (`FINAL_RUNS=native`), because the ports don't implement structured inputs yet. The last column compares the native observations of the forward and reverse runs.

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases | History-dependent |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome, zh-CN | 10 | 1,624 | 12 | 7,168 | 5,011 | 3,804 | 484 | 1,673 | 180 | 12,882 | 0 |
| Chrome, en-US | 1 | 72 | 6 | 270 | 180 | 165 | 18 | 72 | 0 | 468 | 0 |
| webkit-host | 9 | 1,552 | 12 | 6,792 | 4,699 | 131 | 489 | 1,604 | 184 | 12,150 | 0 |
| Firefox | 9 | 1,552 | 12 | 6,727 | 4,627 | 3,520 | 477 | 1,623 | 186 | 11,946 | 0 |

Every unresolved target is `no-line-inside`, most of them in line-slots (336 Chrome, 332 webkit-host, 339 Firefox), where the line before it moves between rows. No native observation errors, rejected styles or missing fonts; every code point rect found its node rect (`pointRectsByCentre` 0). The smoke runs before the chain saw one rect per `<wbr>` in Firefox and none in Chrome and webkit-host.

What the offsets say. They are lengths the derivation leaves to pass D, so they show the rules at work:

- **Box edges.**
  - Chrome: 6px (134 brackets); 0.3984375px (86), the declared 0.4px in LayoutUnits; 0.5px (41), a 0.4px border snapped to one device pixel; −6px (30), negative margins.
  - Firefox: 6px (146), 0.4px (93), 0.5px (48).
  - Nested end edges: Chrome 8px (120) and 16px (18); Firefox 8px (136) and 16px (24).
- **Atomic inlines and nowrap spans.** 24px, 13.296875px (13.3px in LayoutUnits) and 26px (24 + 4 − 2) in Chrome, 24, 13.3 and 26px in Firefox: brackets where the line can't break before the box. Nowrap spans: 4px padding.
- **text-align, Chrome.** 32 brackets at 0.3671875px, 16 at 0.546875px and 16 at 1.109375px, where the line ends after a word that kerns with the space. They occur under `center`, `end`, `justify` and `right` in both directions (8 of 36 targets each), and never under `start` or `left`. `line_info.cc:127-175` gives NeedsAccurateEndPosition for `left` in RTL and `right` in LTR, and an RTL block has bidi (`inline_items_builder.cc:1486-1488`), so `right` in RTL and `left` in RTL aren't explained yet: a fact for the Blink owner to attribute. Firefox has every text-align and wbr bracket at the derived width, as Gecko doesn't reshape line ends.
- **Line slots.**
  - −80, −74.6 and −48.2px in Chrome, −80 and −74.6px in Firefox: the line reaching k sits below a wide first row, in a narrower row or at full width.
  - +16.95 and +28.9px in Firefox's tab paragraphs: a tab beside floats takes more room than in the unwrapped pass.
- **text-indent and br, Chrome.** −40.04, −80.08, −116.52 and −144.49px only in RTL `pre-wrap` paragraphs with a tab after the indent, and −40 to −76.5px in RTL `pre-wrap` and `break-spaces` lines that start with a preserved space after `<br>`. There the unwrapped extent overshoots, and pass D resolved every target.
- **webkit-host.** Only 131 of 4,699 brackets are at the derived width; most offsets lie between −1.3 and 0px, from partial Range edges snapped to whole px (§6 above). 144 `<wbr>` brackets sit one LayoutUnit above it.
- **Process languages, Chrome zh-CN against en-US.** 18 of the 72 paragraphs have other break opportunities at width 1: all of them `aa”bb`, whether lang="" is on the block, a span or a span inside `lang=ja`, under `auto`, `strict` and `loose` alike. zh-CN breaks after `”` and en-US doesn't, and the line-break keyword changes nothing. The 162 targets resolved under both locales have the same brackets.

### Stage 5 families with predictions, 2026-09-17

The ceiling round 1 evaluation ran the stage 5 family cases forward and in reverse with `lab/predictor.ts`, scorer 3 and the given process languages (`.artifacts/ceiling-20260917/evaluate/<browser>/features-{forward,reverse}`, REPORT.md §2.3). No row had a prediction error or `UnportedFeature`.

| Browser | Cases | lineCount pass / fail / unobserved | breaks pass / fail / unobserved | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome, zh-CN | 12,882 | 12,135 / 28 / 719 | 12,135 / 28 / 719 | 6,943 / 220 / 4,972 / 747 | 6,992 / 430 / 5,460 | 0 |
| Chrome, en-US | 468 | 468 / 0 / 0 | 468 / 0 / 0 | 468 / 0 / 0 / 0 | 468 / 0 / 0 | 0 |
| webkit-host | 12,150 | 11,426 / 19 / 705 | 11,416 / 29 / 705 | 8,547 / 0 / 2,869 / 734 | 8,449 / 315 / 3,386 | 0 |
| Firefox | 11,946 | 11,270 / 6 / 670 | 11,267 / 9 / 670 | 6,254 / 0 / 5,013 / 679 | 6,245 / 233 / 5,468 | 0 |

- The unobserved line counts are `atomic-inlines` and `br-elements` lines that hold no Range rect; element rects aren't compared yet.
- Chrome's 28 line count failures are all `text-align`, under `glyph-clusters` and `unsafe-to-break`.
- webkit-host's 16 `br-elements` line count failures report `page-history` and pass alone in a fresh document (WebKit owner).
- Firefox's 6 line count and 9 breaks failures, and 2 of webkit-host's `line-slots` failures, report no gap. They are rows where row 0's two insets and the text-indent exceed the width, so the page puts row 0's right float one row lower: the slot-rows assumption doesn't hold there, and the scorer doesn't check it yet (§13).

### Round 3 derivations, 2026-09-17

Every family derived again, natively, into `.artifacts/tests/derive-r3-20260917/<browser>/{families,features}` (`chain.sh` there; Chrome's process-languages family under en-US in `chrome-en-US/features`): the pinned Chrome 153.0.8010.50, Firefox 156.0 and webkit-host on WebKit 22625.1.29.11.27, macOS 26A428, DPR 2, the same seeds and given process languages as before. The three browsers ran beside each other with every observation sharded (§5), and the whole chain took 8.5 minutes. Final runs are native (`final/native-file`, `final/native-reverse`), since the library was being changed; the evaluation runs the predictions. The rounds' rows are compressed (`zstd`), so a directory can't be stepped again without restoring them.

| Browser | Set | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases | Protocol rows | History-dependent |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome .50 | rule families (22) | 1,684 | 12 | 5,399 | 4,110 | 2,902 | 444 | 845 | 16 | 11,154 | 0 | 0 |
| Chrome .50 | feature families (10) | 1,640 | 12 | 7,232 | 5,059 | 3,848 | 500 | 1,673 | 180 | 13,010 | 0 | 0 |
| Chrome .50, en-US | process-languages | 72 | 6 | 270 | 180 | 165 | 18 | 72 | 0 | 468 | 0 | 0 |
| Firefox | rule families (20) | 1,558 | 11 | 4,492 | 3,511 | 2,876 | 261 | 720 | 0 | 9,776 | 0 | 0 |
| Firefox | feature families (9) | 1,568 | 12 | 6,760 | 4,656 | 3,568 | 482 | 1,622 | 169 | 12,050 | 0 | 0 |
| webkit-host | rule families (20) | 1,558 | 13 | 4,454 | 3,477 | 149 | 230 | 747 | 7 | 9,726 | 0 | 6 |
| webkit-host | feature families (9) | 1,568 | 12 | 6,853 | 4,742 | 131 | 507 | 1,604 | 180 | 12,268 | 0 | 0 |

Every unresolved target is `no-line-inside`, apart from 2 `rounds-exhausted` in Firefox's feature families.

The ceiling round 3 evaluation ran the predictions over these case files in both orders (`.artifacts/ceiling-20260917/evaluate-r3/<browser>/{families-r3,features-r3,features-en-US-r3}-{forward,reverse}`, scorer 5, no protocol row) and staged the tests seeds from them (§9); it also ran round 2's case files again, for the comparison with round 2 (REPORT.md §2.4).

- **Chrome .50 against .48.** The derivation under .50 gives every family case derived under .48 again, all 10,976 rule family cases, all 12,882 feature family cases and all 468 en-US cases, so every bracket sits where it sat. What is new comes from round 3's family changes: 178 `rule/joining` cases (the `shy-mark` word) and 128 `rule/text-align` cases (the ideograph word).
- **The width floor.** With `derive.ts` `minimumUnits` no final run has a protocol row. Against round 1's feature case files, 24 `rule/line-slots` cases left Firefox's file and 10 webkit-host's, among them all 15 and all 7 protocol rows of the round 2 seeds; both files gain the 128 `rule/text-align` cases.
- **Firefox and webkit-host rule families.** Firefox's file holds all 9,584 earlier cases and 192 new `rule/joining` ones. webkit-host's holds all but 2 and 144 new ones: one wave-2 target of `rule/in-word-breaks` (`p-32090e410e46ef61:7:14`, a `WaWa…` word) resolved on 09-16 and stays a window now, because no native line starts at offset 7 at the widths observed inside it. In-word breaks in WebKit depend on the process's history, and a sharded run gives every shard a fresh one; not traced further.

## 7. Versioned facts

A facts file holds one engine build's facts, one record per fact and scope:

```json
{"format":"pretext-fact/1","fact":"blink-lines H2 :: …","spec":"blink-lines H2",
 "scope":{"browser":"chrome","dpr":2,"probeSet":"blink-probes"},
 "verdict":"holds","decisive":{"expected":…,"measured":…},"supplementary":false,"probeSha256":"…",
 "env":{"engine":"blink","build":"153.0.8010.48","buildSource":"given","os":null,"userAgent":"…"},
 "observedAt":"…","run":"…","holdsIn":["153.0.8010.48"]}
```

- **Verdicts.**
  - `holds` and `fails` come from a check's `ok`; `undecided` from an `ok` of null.
  - `precondition-failed` marks every check of a probe whose Gecko `pre` check failed.
  - `errored` marks a probe or observation error.
- **Scope.** A Blink check at another DPR than the run's is outside the run's scope and isn't evaluated.
- **Supplementary.** Checks named `supplementary: …` are kept and never count for a rule.
- **Ids are provisional:** some check names still carry measured values, so a fact can change id between DPRs.
- **Build.** `probes/runner.ts` now records `build` in its output. Outputs recorded before that take the build as given, and the record says so.

| File | Facts | From |
|---|---:|---|
| `rebuild/facts/blink/153.0.8010.48.ndjson` | 756 | blink-probes at DPR 2 (340) and forced DPR 1 (336); zoom probes at forced DPR 3.5 (15) and emulated DPR 2 (22); system-ui in fresh browsers (19, 17, 7) |
| `rebuild/facts/blink/153.0.8010.50.ndjson` | 772 | the same seven sets, rerun in the pinned Chrome 153.0.8010.50 in ceiling round 3 (`rerun-probes.sh`, `.artifacts/tests/release-chrome-153.0.8010.50/probes`): all 756 facts of .48 compared, 756 unchanged, no decisive value changed, no flip, none missing; 16 new facts from probes added to `blink-probes.ts` since the seed (cross X5 with the DOM laid out first, a supplementary blink-text H29 check) |
| `rebuild/facts/webkit/22625.1.29.11.27.ndjson` | 176 | webkit-probes in webkit-host (88) and installed Safari (88) |
| `rebuild/facts/gecko/156.0.ndjson` | 404 | gecko-probes at apd 30 (269), 60 (13), 40 (12), 27 (12), 23 (12); follow-up (3); the round 2, 2b, 3 and 4 follow-up sets at apd 30 (83, all holding; round 4) |

- **No facts yet from:**
  - outputs that return raw values without checks: blink followups and gaps, webkit followups, gecko followups, followups-f2 and emoji-font;
  - the WebKit cross-check probes, whose verdicts a separate script decides.
- **Cross-setup diffs** (`facts.ts diff --match-scope=probeSet`):
  - webkit-host against installed Safari: 88 compared, 0 flips, 2 changed decisive values;
  - Chrome at DPR 2 against forced DPR 1: 279 compared, 12 flips. 11 are the system-ui cache-order and size claims (cross X5); 1 is blink-lines H3's DPR report. 41 decisive values changed, 61 facts missing and 57 new, mostly from check names carrying DPR values;
  - Firefox apd 30 against apd 60: 12 compared, 0 flips, 5 changed decisive values.

Per release, `bash rebuild/tests/rerun-probes.sh <browser> <previous facts file> <out dir>`:

- reruns every probe set the previous build's facts file holds, each in its setup (Chrome: DPR 2, forced DPR 1, the zoom probes at forced DPR 3.5 and emulated DPR 2, the three fresh-browser system-ui sets; Firefox: apd 30 and the apd 60, 40, 27 and 23 subsets and the H3b follow-up; webkit-host, and installed Safari with `ALLOW_SAFARI=1`), as short jobs under the lock at the same time. Until ceiling round 3 it reran only the main set, so a release would have reported every other scope missing;
- extracts facts under the build the runner records, and refuses sets that ran different builds;
- `facts.ts release` writes `rebuild/facts/<engine>/<new build>.ndjson` with `holdsIn` carried forward.

A fact's `spec` is the probe's label up to a colon, as a rule's probe entry is read, so probes labelled `gecko-port F12: how pair kerning divides` join rules citing `gecko-port F12`. The Gecko follow-ups F7 to F27 (`gecko-round2.ts`, `gecko-round2b.ts`, `gecko-round3.ts`, `gecko-round4.ts`) return `checks` and `pre` over their raw values since round 4 (F19's rows are under `rows`), and give 83 facts; `rerun-probes.sh` doesn't list those four sets yet, so a release rerun would report their facts missing until it does.

A flip or a missing fact exits 1. Either the browser changed (read the new source, update specs and port), or the claim depends on process history (narrow its scope to fresh processes).

## 8. Coverage matrix

`bun rebuild/tests/coverage.ts --facts=<facts files> --derived=<derivation dirs> [--previous=<coverage.json>]`.

A current rule is covered by any of:

- a listed asserting test that is present in the tree;
- a holding fact joined through its probe labels;
- an observed family: a family naming the rule, scored in that engine's browser, with at least one resolved bracket.

Reach from generic or main-derived case families is measurement and doesn't count. Also listed:

- rules with probe labels but no holding fact;
- current heuristics and choices by score;
- stale test references;
- removed rules with their replacements.

With `--previous`, a rule that loses its last observed family exits 1.

Also listed: rules with a derived family, whose family has resolved brackets in the engine's browser but no scored prediction run yet (`derivedFamilies`, counted as `derivedOnly`). They don't count as covered.

Regenerated 2026-09-17 by the ceiling round 2 evaluation, from `rebuild/facts/*` and derivation directories whose `file` and `reverse` runs are that evaluation's predicted runs under scorer 4: `.artifacts/ceiling-20260917/evaluate-r2/<browser>/{families-derived,features-derived}` (plus `chrome/features-en-US-derived`), against the round 1 matrix: no rule lost its last observed family. The family cases are round 1's, and Chrome's runs are 153.0.8010.50's over cases derived under .48 (REPORT.md §2.6).

| Engine | Current rules | Covered | By tests | By facts | By families | Uncovered | Uncovered with a derived family | Probe labels without a holding fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Blink | 179 | 140 | 39 | 57 | 109 | 39 | 0 | 8 |
| WebKit | 144 | 103 | 23 | 47 | 91 | 41 | 0 | 10 |
| Gecko | 124 | 101 | 51 | 55 | 77 | 23 | 0 | 6 |
| Shared | 29 | 12 | 6 | 6 | 0 | 17 | 0 | 0 |

**Adopted at the correctness line, 2026-09-18:** `rebuild/tests/coverage.json` is the headline configuration's matrix, regenerated from the frozen line's runs (exit 0: Blink 155 of 195 rules covered, WebKit 114 of 156, Gecko 128 of 152, shared 22 of 36; the two configurations cover the same rules and differ in their families' pass counts), and each configuration's matrix is beside its seeds (§9).

**Staged by the ceiling round 3 evaluation, 2026-09-18** (`rebuild/tests/baselines/staged-round3/coverage.json`, in the history since the adoption; `rebuild/tests/coverage.json` was unchanged then): regenerated from the .50 facts file, the WebKit and Gecko facts files and round 3's derivation directories with the evaluation's scored runs (`evaluate-r3/<browser>/{families,features}-r3-derived`, plus `chrome/features-en-US-r3-derived`), against the round 2 matrix. It exits 1: `webkit/measure/word-spacing-in-js` lost its last observed family, because the WebKit owner retired that id for `webkit/measure/word-spacing-in-context` and the families `following-space` and `tabs` still name the old one (`tests/families/families.test.ts` fails on it too). The replacement rule has no family until those two name it.

| Engine | Current rules | Covered | By tests | By facts | By families | Uncovered | Probe labels without a holding fact |
|---|---:|---:|---:|---:|---:|---:|---:|
| Blink | 179 | 144 | 41 | 57 | 113 | 35 | 8 |
| WebKit | 152 | 109 | 30 | 47 | 90 | 43 | 14 |
| Gecko | 124 | 104 | 55 | 55 | 79 | 20 | 6 |
| Shared | 29 | 12 | 6 | 6 | 0 | 17 | 0 |

9 rules are annotated in source (`// rule <id>`, the WebKit owner's round 3 rules); the others aren't. Round 4 registered Gecko's round 3 and round 4 rules, Blink's round 4 rules, the font checks and scorer 6's assumptions (§3); round 3's Blink rules aren't in the registry yet. No matrix has been regenerated since, so the tables above don't count them.

The staged matrix's exit 1 is fixed since round 4: `coverage.ts` `lostObservedFamilies` doesn't count a removed rule whose replacements all have an observed family, and `following-space` and `tabs` name `webkit/measure/word-spacing-in-context`; regenerated over round 3's derived runs it exits 0 (WebKit 110 covered, 91 by families).

Ceiling round 3 gave each of round 2's six rules what it lacked (below the list); the staged matrix above shows them. A trial regeneration over round 2's runs with the .50 facts file covers all six: four by test and family, `blink/shape/pair-window-whole-clusters` and `blink/shape/cluster-unit-grapheme` by family.

Round 2 added six rules, and none had a test, fact or family in that matrix: `blink/justify/cjk-ideograph-or-symbol`, `blink/measure/pair-kerning-from-fact`, `blink/shape/cluster-unit-grapheme`, `blink/shape/pair-window-whole-clusters`, `gecko/lines/in-word-advance-split-kerning` and `gecko/measure/lang-empty-locale-language`. Four more Gecko rules carry probe labels without a holding fact, since the round 2 probes (F7 to F12) aren't in the facts files: `gecko/gap/in-word-prefix`, `gecko/lines/in-word-advance-split-kerning`, `gecko/measure/range-in-script-context` and `gecko/script/latin-fast-path`.

- Four of the six had a test all along. The registry names it as bun prints it, `describe block > test name`, and `coverage.ts` looked for that whole string in the file; it now finds each part (`testPresent`). 14 other test references were stale until round 4, which gave them the names the files hold now (`blink/lines/forced-break`, `blink/script/script-run-iterator`, four Gecko B2 and B4 entries, six shared entries): every test the registry lists is present. A name with an apostrophe is listed up to the apostrophe, because `testPresent` looks for the name in the source, where it is escaped.
- Families now name the rules they exercise: `in-word-breaks` (`AV` and `Wa` words in Arial, Hoefler Text and Times New Roman, fonts on both sides of the `pairKerning` fact) names `blink/measure/pair-kerning-from-fact` and `gecko/lines/in-word-advance-split-kerning`; `clusters` (Bengali conjuncts in Kohinoor Bangla) names `blink/shape/cluster-unit-grapheme`; `languages` (`lang=""`) names `gecko/measure/lang-empty-locale-language`.
- Two families grew: `joining` has a `shy-mark` word, a kasra right after the soft hyphen, for `blink/shape/pair-window-whole-clusters` (96 to 128 paragraphs an engine), and `text-align` has an ideograph word in PingFang SC under `justify` and `start`, for `blink/justify/cjk-ideograph-or-symbol` (144 to 160).

What stays uncovered:

- of the stage 5 rules, the three `Element.getClientRects()` observation rules and the two observer assumptions (`shared/lab/vertical-centre-grouping`, `shared/lab/slot-rows`). Scorer 4 compares element rects on every feature row and checks slot rows by rule, but the registry lists no test or family for them. All 50 stage 5 engine rules have an observed family;
- by kind: Blink 28 ported rules, 5 named gaps, 2 recipes, 2 heuristics and 1 fact; WebKit 36 ported rules, 3 named gaps and 1 recipe; Gecko 18 ported rules and 4 named gaps; shared 9 recipes, 3 ported rules, 2 heuristics and 1 choice by score;
- the new output geometry rules. Their evidence is the observation ports' tests and scorer v2's comparisons, which the registry doesn't list yet;
- builder scaffolding: `webkit/builder/*`, `webkit/ilb/*`, `gecko/script/*`;
- gaps no family triggers: dictionary breaks unavailable, page zoom, page history, float32 precision, bitmap emoji size;
- the painter's 12 rules, since painter probes haven't run.

Twelve current rules are heuristics or choices by score: `blink/shape/wide-group-halved`, `blink/shape/cluster-unit-grapheme` (registered in round 2), `blink/shape/position-adjust-window`, `shared/env/engine-from-user-agent`, three painter rules, and since round 4 `webkit/lines/shaped-run-in-joining-context`, `webkit/gap/language-dependent-fallback-table`, `webkit/measure/font-check-fixed-pitch`, `gecko/measure/sides-add-up-is-exact` and `gecko/measure/suffix-side-recipe` (CHARTER.md, "Standing"). `blink/measure/ignorables-left-out-if-8bit` became a ported rule in round 2.

## 9. The gate

`bun rebuild/tests/gate.ts seed|check --derived=<derivation dir> --baseline=<file> [--facts=<file>] [--coverage=<file>] [--corpus-baseline=<lab gate file> --corpus-runs=<per-case files>] [--out=<report>]`

- **Seeds go to a staging folder.** `gate.ts seed` needs `--staging=<dir>`, writes `<staging>/<baseline name>` with `<name>.seed-record.json`, and never the baseline it names (round 4).
- **Rule families, blocking.** The (case id, metric) pairs that passed in both seeding runs, forward and reverse. The seed and check rules are `lab/gate.ts`'s, with `--complete`. History-dependent cases, protocol rows and unstable pairs never fail.
- **Facts, blocking.** The build's facts file against the one the baseline recorded; a verdict flip or a missing fact fails.
- **Coverage, blocking.** A rule of the engine that had an observed family at seeding and has none now fails.
- **Measurement corpus, report only.** Main-derived runs (`suite/`, `obligations/`) checked against a lab G0 baseline. Losses are counted per family group and never fail.
- **Exit 2** when runs come from another environment than the baseline, when the derived cases changed, or when a run wasn't scored against the other order. `lab/gate.ts` compares an environment key part by part and names what differs: another browser build or device (derive the families again for the new build and seed a new baseline); process languages that don't match the baseline's recorded languages, or a baseline that recorded none (another environment: seed a baseline for it); another scorer version (re-score the seeding runs and seed a new baseline). Seeding refuses runs whose environment records no process languages.
- **Protocol rows.** A row whose page doesn't describe its declared input (lab `score.ts` `slotProtocol`: slot floats outside their rows) is never a pass. Seeding lists it under `protocol`, and a check never fails on it. `lab/gate.ts --prune-protocol --baseline=<file>` applies the rule to the rows of every seeding run a baseline names and moves such rows out of its passes, listing each removed pair.

| Baseline | Environment | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Unstable pairs |
|---|---|---:|---|---:|---:|---:|
| `chrome-153.0.8010.50.json` | Google Chrome 153.0.8010.50, macOS 26A428, DPR 2, `uiLanguage` zh-CN, scorer 4 | 10,976 | 42,233 (10,810 / 10,749 / 10,455 / 10,219) | 0 | 0 | 0 |
| `chrome-features-153.0.8010.50.json` | the same | 12,882 | 42,595 (12,882 / 12,882 / 9,733 / 7,098) | 0 | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | the same with `uiLanguage` en-US | 468 | 1,872 (468 / 468 / 468 / 468) | 0 | 0 | 0 |
| `webkit-host-22625.1.29.11.27.json` | webkit-host 27.0 on WebKit 22625.1.29.11.27, `preferredLanguages` zh-CN,zh-Hans, `icuDefaultLocale` en_US_POSIX, scorer 4 | 9,584 | 36,038 (9,458 / 9,376 / 8,822 / 8,382) | 6 | 0 | 0 |
| `webkit-host-features-22625.1.29.11.27.json` | the same | 12,150 | 43,800 (12,123 / 12,111 / 10,923 / 8,643) | 0 | 7 | 0 |
| `firefox-156.0.json` | Firefox 156.0, `regionalPrefsLocale` zh-hans-us, scorer 4 | 9,584 | 35,272 (9,432 / 9,200 / 8,592 / 8,048) | 0 | 0 | 0 |
| `firefox-features-156.0.json` | the same | 11,946 | 39,149 (11,931 / 11,931 / 8,862 / 6,425) | 0 | 15 | 0 |

Seeded by the ceiling round 2 evaluation (REPORT.md §2.6; `.artifacts/ceiling-20260917/evaluate-r2/tools/reseed.sh`) with `gate.ts seed`, the facts files and the regenerated coverage matrix, through derivation directories that link the evaluation's forward and reverse runs (`evaluate-r2/tools/derived-dirs.sh`). Each baseline checked against its own runs with the environment check on: 0 lost pairs, pass. The round 1 seeds refuse the round 2 runs by environment (scorer 4; Chrome's new build; webkit-host's `preferredLanguages`), and nothing was checked without that check. What each new seed loses against the round 1 seed and against the pre-round-1 seed is listed pair by pair, with its category, line-local gaps and attribution, in `rebuild/lab/baselines/reseed-round2-lost-pairs.json`: Chrome's rule families 24 painter pairs and feature families 33, webkit-host's feature families 17 widths that scorer 4 alone leaves unobserved and 8 painter pairs, Firefox none.

**Staged by the ceiling round 3 evaluation, 2026-09-18** (`rebuild/tests/baselines/staged-round3/`, not adopted; REPORT.md §2.6). `gate.ts check` refuses round 3's runs against every baseline above by environment (scorer 5 against scorer 4), as it should. `gate.ts seed` still writes the file it names, so the evaluation named files in the staging folder (`evaluate-r3/tools/gates.sh`), seeded from round 3's derivations with the .50 facts file for Chrome, and wrote each seed's record with `lab/gate.ts` `seedRecord` (`evaluate-r3/tools/tests-seed-record.ts`): lost pairs with covering gaps and attributions, pairs that leave through history dependence or protocol rows, gained pairs. The orchestrator adopts them after the critic.

| Staged baseline | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Lost against the adopted seed | Cases only in the adopted seed |
|---|---:|---|---:|---:|---|---:|
| `chrome-153.0.8010.50.json` | 11,154 | 10,998 / 10,952 / 10,662 / 10,508 | 0 | 0 | 2 painter pairs | 0 |
| `chrome-features-153.0.8010.50.json` | 13,010 | 13,010 / 13,010 / 11,743 / 9,251 | 0 | 0 | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | 468 | 468 / 468 / 468 / 468 | 0 | 0 | 0 | 0 |
| `firefox-156.0.json` | 9,776 | 9,721 / 9,616 / 9,224 / 8,667 | 0 | 0 | 8 lineCount, 24 breaks (`font-size-quantization`), 12 painter | 0 |
| `firefox-features-156.0.json` | 12,050 | 12,050 / 12,050 / 10,866 / 8,421 | 0 | 0 | 0 | 24 |
| `webkit-host-22625.1.29.11.27.json` | 9,726 | 9,685 / 9,662 / 9,115 / 8,606 | 6 | 0 | 8 lineCount, 8 breaks, 16 painter (`rule/joining`, `rtl-shaping-across-inline-boxes`) | 2 |
| `webkit-host-features-22625.1.29.11.27.json` | 12,268 | 12,248 / 12,236 / 11,021 / 8,817 | 0 | 0 | 0 | 10 |

The cases only the adopted feature seeds hold are the `rule/line-slots` cases under the new width floor, the 22 protocol rows among them. With these seeds Chrome's tests baselines hold one build throughout (cases derived under .50, .50's facts, .50's runs).

**Staged by the round 4 evaluation, 2026-09-18** (scorer 7, round 4's library at 3c17016, not adopted; tools in
`.artifacts/ceiling-20260917/evaluate-r4/tools`: `gates.sh`, `attribute-records.py`, `seed-records.py`). One staging folder
per configuration, because the baseline names carry none: `rebuild/tests/baselines/staged-round4-no-facts/` (the headline)
and `staged-round4-facts/`, seeded from round 3's derivations as tier 2 ran them, each with a regenerated `coverage.json`
(exit 0: Blink 155 of 195 rules covered, WebKit 114 of 156, Gecko 128 of 152, shared 22 of 36); the lab gate's seeds are in
`rebuild/lab/baselines/staged-round4-{no-facts,facts}/` (smoke, the development sets with `rich-prewrap`, the held-out sets
and the giants); tier 2's are in `rebuild/tests/baselines/staged-round4c-sets/`, compared with round 4a's staged seeds.
Every staged seed passes a check against its own runs with the environment check on, and every lost pair carries an
attribution in its seed record: round 3's where the pair was already lost then, else by rule from the pair's status in the
other configuration and in the round 4a reference ledger.

| Staged seed | Pass pairs (lineCount / breaks / widths / painter), no facts | Lost against the adopted seed, no facts | With facts | Left with a case the runs don't hold |
|---|---|---|---|---:|
| `chrome-153.0.8010.50.json` | 10,970 / 10,910 / 10,596 / 10,520 | 208 (26 lineCount, 41 breaks, 101 widths, 40 painter) | 2 painter | 0 |
| `chrome-features-153.0.8010.50.json` | 12,994 / 12,994 / 11,564 / 9,225 | 276 (16 / 16 / 180 / 64) | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | 468 / 468 / 468 / 468 | 0 | 0 | 0 |
| `firefox-156.0.json` | 9,674 / 9,488 / 8,892 / 8,475 | 167 (10 / 34 / 111 / 12) | 12 painter | 0 |
| `firefox-features-156.0.json` | 12,050 / 12,050 / 10,866 / 8,421 | 0 | 0 | 18 pairs |
| `webkit-host-22625.1.29.11.27.json` | 9,697 / 9,674 / 9,126 / 8,617 (6 history-dependent) | 16 painter | 16 painter | 6 pairs |
| `webkit-host-features-22625.1.29.11.27.json` | 12,248 / 12,236 / 11,063 / 8,817 | 0 | 0 | 12 pairs |
| lab gate, Chrome | | 79 (1 / 1 / 59 / 18) | 0 | 0 |
| lab gate, Firefox | | 100 (4 / 7 / 84 / 5); 28 pairs left through history dependence, all passing now | 5 | 0 |
| lab gate, webkit-host | | 4 (1 width, 3 painter); 175 pairs left through history dependence, 81 passing now | 4 | 0 |
| tier 2, Chrome (against round 4a's staged seed) | 65,520 / 65,449 / 61,990 / 59,299 | 270 (14 / 6 / 0 / 250) | 0 | 0 |
| tier 2, Firefox | 63,060 / 62,864 / 60,066 / 55,604 (313 history-dependent) | 546 (32 / 96 / 209 / 209) | 546 | 0 |
| tier 2, webkit-host | 63,368 / 63,311 / 60,956 / 55,059 (279 history-dependent) | 0 | 0 | 0 |

- With the lab's facts the lab and tests seeds lose exactly what round 3's staged seeds lost, under round 3's attributions
  (Chrome's 2 `rule/joining` painter pairs, Firefox's 12 painter pairs and 5 lab pairs, webkit-host's 16 `rule/joining`
  painter pairs and 4 lab pairs). The line counts and breaks round 3's seeds lost pass again: Firefox's 13.33px system font
  rows by accident, as under round 2's OffscreenCanvas (Gecko owner), and webkit-host's `rule/joining` rows since round 4a.
  The adopted seeds are round 2's, recorded on an OffscreenCanvas, so they don't show what Firefox lost against round 3's
  canvas element; tier 2's record does.
- With no supplied facts the adopted seeds, recorded with the lab's facts, are the wrong yardstick: every lost prediction
  pair passes in this evaluation's facts runs and fails under the gap of the fact that is missing (`pairKerning` under
  Blink's `unsafe-to-break` and Gecko's `in-word-prefix`, `ligatures` and `coverage` under `glyph-clusters`), its widths pair
  is not applicable where breaks fail, and its painter pair follows.
- Tier 2's losses are the ledger transitions of REPORT.md "What rounds 4a to 4c changed": Chrome's accidental passes of
  round 3's no-facts library, and Firefox's measured cost of the OffscreenCanvas decision.
- A sealed-4 record is in `rebuild/lab/baselines/sealed-4-20260918.json`.

**Adopted at the correctness line, 2026-09-18.** After the critic's verdict (research/ROUND4-CRITIC.md: adopt) the seeds of
the table above were made again by the same commands from the recordings the references are frozen from
(`.artifacts/tests/runs/line-20260918` and the giants beside them; library feb3937, the evaluated library with the font
checks' contexts changed; tools in `.artifacts/ceiling-20260917/freeze-line/tools`: `tier2.sh`, `giants.sh`, `gates.sh`,
`carry-attributions.py`, `adopt.py`, `check-adopted.sh`). Every new seed equals the evaluation's staged one in passes,
history-dependent cases, unstable pairs, protocol rows and environments, so the table's counts stand, every record lists the
same lost pairs, and each pair carries the evaluation's attribution (2,251 pairs in 26 records, none without one). Where they
sit: `rebuild/tests/baselines/{no-facts,facts}/` with each configuration's `coverage.json` (`rebuild/tests/coverage.json` is
the headline configuration's), `rebuild/lab/baselines/{no-facts,facts}/`, and `rebuild/tests/baselines/sets/` for tier 2,
each with its seed record. All 20 lab and tests checks of an adopted seed against its own runs pass with the environment
check on. The round 2 seeds in the first table, the round 3 staging folders and the round 4 ones are in the history before
the adoption; Chrome's .48 seeds stay.

**Scorer 6 (2026-09-18)** made every scorer 5 staged seed above refuse. Tier 2's seeds for the same sets are staged in `rebuild/tests/baselines/staged-round4-sets/` (six files, both configurations); forward-only runs of each browser lose nothing against them. They describe the round 3 library, and are made again after round 4's merges.

- Chrome's three files are new, for build 153.0.8010.50, which replaced .48 on 2026-09-17; the .48 seeds stay in their own files. Their family cases were derived under .48 (the `build` field), the runs are .50's, whose native views equal .48's on every family case in both orders (`evaluate-r2/native-rounds-chrome.json`), and their facts file is .48's. §12's procedure (probes, derivation) hasn't run for .50.
- The feature seeds still hold round 1's cases, with their protocol rows listed apart (Firefox 15, webkit-host 7). Round 1's seeds were pruned of those rows by rule in ceiling round 2 (`lab/gate.ts --prune-protocol`, reports in `.artifacts/lab/round2-scorer4/prune/`). Ceiling round 3 derived the families again with `derive.ts` `minimumUnits` (§6, "Round 3 derivations"); the next seeds take `.artifacts/tests/derive-r3-20260917/<browser>/{families,features}`, whose Chrome cases were derived under .50 with .50's facts file beside them.

Round 1 history: the pre-round-1 rule-family baselines were keyed on scorer 2 without process languages, so `gate.ts check` refused round 1's runs by design (exit 2). Round 1's evaluation compared them by the same rules without the environment check, which its critic rejected (research/ROUND1-CRITIC.md item 2) and round 2 doesn't do: Chrome's rule families lost 44 painter pairs (`rule/joining`, the Blink owner's fix-r12), webkit-host's 22 line counts, 22 breaks and 6 painter pairs (`rule/joining` under `rtl-shaping-across-inline-boxes`), and Firefox's none.

## 10. Main's tests

Main-derived families are a measurement corpus. In this gate they are the report-only layer. They are admitted only through triage records (TEST-ARCHITECTURE §7): an objective fact to learn, a pass main got by accident, or an opinion we drop. research/TESTS.md §1a's first-class verdicts are withdrawn. The G0 baselines in `lab/gate.ts` stay the lab's regression check until they're retired (DESIGN §8.3 stage 4); their obligations pairs should be report-only there too (TENTPOLES-CRITIC §2.E item 7).

## 11. Independence

`rebuild/tests/independence.test.ts` checks every file under `rebuild/tests`, `rebuild/lab` and `rebuild/probes` except `lab/predictor-core.ts`, the prediction adapter; `lab/predictor.ts` and `lab/baselines/no-facts-predictor.ts` are made from it and import only contract constants from `rebuild/src`. They may import from `rebuild/src` only:

- types from `src/model.ts` and `src/env.ts`;
- constants from those two files that aren't functions, such as `UNKNOWN_FONT_FACTS` and `PINNED_BUILDS`;
- types from an engine's `src/engines/<engine>/geometry.ts`: its line geometry and the state its next line starts from, which a row keeps whole.

Engine or library logic fails the test. It passes since round 4. The layout a row keeps and the observation contract are the lab's own types (`lab/types.ts`, `lab/observe/contract.ts`) since the re-architecture's S1, so the lab takes from `src/model.ts` the input tree, fragments and gaps, from the three `geometry.ts` the engines' geometry and line starts (S2), and nothing about rows. Two probes bundle library modules into their page to run them in a browser (`probes/font-checks.ts`, which also bundles each port's `checks.ts`, and `probes/canvas-checks.ts`); they import nothing from them, and their expected values aren't the library's.

The same test holds the library's own rule (research/ARCHITECTURE-PLAN-2.md §5.4): outside comments, a file of `rebuild/src` that isn't under `engines/` and isn't `index.ts` (the one dispatch) or `env.ts` (whose shape is per engine) imports nothing from `engines/` and holds no engine's name as a string or in an identifier. Since S2 every shared file holds but `paint.ts`, listed with its 74 mentions until the painter's split; and an engine imports no other engine. What differs by engine reaches shared code as data the engine gives: its `BidiData`, grapheme rules and break rules (`engines/<engine>/data.ts`), and what it asks of the Canvas checks and the font checks (`engines/<engine>/checks.ts`).

## 12. Per browser release

0. Pin the new build: `bash rebuild/lab/pin-browser.sh chrome|firefox` copies the installed bundle and checks the copy byte for byte; try it with `LAB_CHROME_APP=<copy>` or `LAB_FIREFOX_APP=<copy>` on a smoke run, then point `lab/browser-build.ts` `LAB_APPS` at it (lab README, "Pinned browsers"). The lab never launches the installed Chrome or Firefox, so a release arrives when the pin moves, not when the updater runs. Check the engine source between the two tags first.
1. `run.ts` and `probes/runner.ts` read the new build from the pinned bundle; rows and outputs carry it, with the app path and the copy's tree hash in the run record.
2. `rerun-probes.sh` per browser: a new facts file, and flips block that engine.
3. `observe-families.sh` into a new derivation directory, deriving the families under the new key.
4. `coverage.ts` over the new facts and derivation directories, with `--previous`.
5. `gate.ts check` against the previous key exits 2 by design. Attribute the old key's pairs against the new runs (browser change, observation problem, history dependence, scorer change), then seed the new key.

A macOS update moves all three keys.

**Chrome 153.0.8010.50, ceiling round 3.** Between the tags 153.0.8010.48 and .50 only `chrome/VERSION` differs and `DEPS` is unchanged, so every file the port reads is identical. Steps 0 to 3 ran: the pinned copy (tree sha256 `712aa9f5…`), whose native observations equal the installed .50's on all 2,580 `runs` cases; the facts file, with all 756 of .48's facts unchanged (§7); and the derivation, which gives every one of the 10,976 family cases derived under .48 again, and the feature families' cases likewise apart from the ones round 3 changed on purpose (§6, "Round 3 derivations"). Steps 4 and 5 belong to the evaluation, which scores the new case files and stages the seeds; the library's own pin (`src/env.ts` `PINNED_BUILDS`) is the Blink owner's to move.

## 13. Not built yet

- Tier 1 (L3) gates nothing by itself, and its inputs are recorded per library: a library that asks Canvas new questions needs a new recording (`browser-sets.ts --record`, `replay.ts pack`, `freeze --force --reason`).
- Triage records for the census's main-only rows (§7).
- Lock files and oracle answers under `rebuild/data`, with skipped oracle tests turned into failures (§5).
- Environment reruns for rules that read DPR or app units: forced DPR 1 in Chrome, other apd in Firefox. `run.ts` takes no browser switches.
- Family baselines for installed Safari; webkit-host stands in. The ceiling round 2 evaluation ran the combined rule and feature families file (21,734 cases) in installed Safari in both orders: every native view, prediction and score equals webkit-host's (REPORT.md §2.7). Its held-out and sealed-2 combined files didn't finish there, because a hidden Safari page stops in a job longer than about 8 minutes. Since ceiling round 3 an installed Safari run goes through 5-minute parts, each in a fresh tab (lab README, "Parts"), and `run.ts --parts-from` repeats its parts in webkit-host so both see every case after the same history. The round 3 evaluation ran both combined files that way in both orders, in 2-minute parts, every row hidden: no job failed, and every native view, prediction and score equals webkit-host's (REPORT.md §2.7).
- In-probe fact declarations with value-free check names (§4.1); painter probes.
- Page-history preludes (§6.5). The per-case isolation protocol exists since ceiling round 3: `lab/sharded.ts --isolate` runs given cases each in a fresh browser process (lab README, "Sharded runs and isolation").
- For structured cases: line keys that place atomic inlines, and a check that no line box is taller than the line height in slot cases. Scorer 4 compares `elements` and marks slot protocol rows (lab README "Elements", "Protocol rows"); round 1's feature families had 22 such rows (Firefox 15, webkit-host 7), and `derive.ts` `minimumUnits` now keeps derived widths at or above each engine's bound. A re-derivation of `line-slots` with it produced no protocol row in Firefox or webkit-host (lab README "Protocol rows"), and ceiling round 3 derived every family again with it (§6, "Round 3 derivations": no protocol row in any browser). The feature-family baselines still hold round 1's cases until the evaluation seeds from the new case files.
- A second controlled locale for Firefox and webkit-host: Firefox's Mac command line passes a Cocoa `-AppleLanguages` pair on as arguments to open, and webkit-host rejects arguments it doesn't know (lab README, "Browser-process languages").
