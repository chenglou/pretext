# Lab

The lab observes how each installed browser lays out a styled paragraph and scores a prediction of those lines. It
doesn't depend on the old library in `src/`.

- `types.ts`: shared shapes. Cases (`Case`, `Paragraph`, `TextRun`, `FontDecl`) and lab rows (`LabRow` and its parts), the
  layout a row keeps among them (`ParagraphLayout`, `LineOf`, `BelowFloats`): the row's format is the lab's, not the library's.
- `page.ts`: the browser page. It builds the native paragraph, records Range geometry, runs the prediction hook and the
  observation port over its layout, and records the painted lines.
- `predictor.ts`: the prediction hook, the only library-facing import in the page. It and `baselines/no-facts-predictor.ts`
  (no supplied font facts) are made from `predictor-core.ts`, the one lab file that imports library logic
  (`rebuild/tests/independence.test.ts`). It holds the slot loop (`layoutParagraph`) that makes a row's layout from the
  library's function set, one slot at a time: per line `fillLine`, `inspectLine`, then `linePieces` on a paragraph prepared
  for inspection, every slot at the case paragraph's width (DESIGN.md §2.9). It writes what the library doesn't carry: a
  line's slot as its two insets, and `measure`, its own count of the contexts a layout makes and its `measureText` calls,
  taken on the page's Canvas classes with every argument passed through untouched. It also keeps, per line, what the
  library's painter takes (the pieces, the slot with its width, the line box flag), and pairs them with the engine's
  painting rules where it dispatches: the hook's `painter` (`types.ts` `LayoutPrediction`), which `paint()` and `limits()`
  call and no row holds. Three more predictors come from it
  (`baselines/`): `plain-predictor.ts` returns line ranges from a paragraph prepared plain, the path an application runs,
  `other-widths-first-predictor.ts` fills every prepared paragraph at half and at one and a half times the case's width
  before the case's own, and `plain-other-widths-first-predictor.ts` does the same on a paragraph prepared plain
  ("Prediction hook").
- `port-measure.ts`: how an observation port measures live, shared by the page and the offline replay.
- `rows.ts`: reading row files, plain or compressed (`<name>-rows.ndjson` or `.zst`); every tool that reads rows goes through
  it, and `rows.test.ts` checks that none reads them its own way.
- `font-facts.ts`: the font facts the predictor declares for a case's fonts, per engine, from `font-facts.json`, a table
  built offline from the font files (see "Font facts"); `font-facts.test.ts` known fonts' facts.
- `observe/`: the observation ports, one per engine, and the contract they implement, `contract.ts` (DESIGN.md §9). Each
  derives, from a layout, the Range rects its browser reports, by that engine's geometry code, and imports from the
  library only types of `src/model.ts` and of its engine's `src/engines/<engine>/geometry.ts`.
- `run.ts`: the driver. It reads the browser build from the app bundle, sets or reads the browser process's languages,
  serves the page, opens one background browser session and streams rows to NDJSON.
- `browser-build.ts`: the apps the lab and the probe runner launch, the pinned copies of Chrome and Firefox among them, and
  the build read from their bundles; `pin-browser.sh` makes and checks a pinned copy (see "Pinned browsers").
- `sharded.ts`: one case file as several `run.ts` jobs at the same time, and the isolation protocol (see "Sharded runs and
  isolation").
- `record.ts` and `measurements.ts`: `run.ts --record-measurements`, the page side and the offline side (see "Recorded
  measurements").
- `compare-rows.ts`: whether two runs of the same cases recorded the same native observations, predictions and painted
  lines, case by case (`bun rebuild/lab/compare-rows.ts <rows> <other rows> [--report=<file.json>]`). The checks of the lab
  itself use it: a pinned browser against the installed one, a recorded run against a plain one, installed Safari against
  webkit-host, the usual protocol against measure first. `--report` lists every differing case: for a native observation
  what the scorer compares (line count, every rect's x, width and native line) or that only values outside it differ, for a
  prediction and painted lines the first differing field. `--prediction=line-ranges` compares predictions as line ranges
  alone and `--prediction=without-measure` without their counts of Canvas work ("Prediction hook").
  `rebuild/tests/compare-sets.ts` runs it over two tier 2 folders.
- `languages.ts`: the browser-process languages each browser launches with, and the given facts the driver derives for
  the library (see "Browser-process languages"); `languages.test.ts` its rules.
- `score.ts`: the offline scorer.
- `score.test.ts`: the scorer's comparison rules on small hand-made rows (`bun test rebuild/lab/score.test.ts`), built with
  `row-fixtures.ts`.
- `triage.ts`: triage records for the cases where main passes and the rebuild fails (see "Triage records");
  `triage.test.ts` its rules.
- `gate.ts`: the no-regression gate over scored runs, and `gate.test.ts` its rules. It compares a run's environment with
  the baseline's part by part (browser build and device, process languages, scorer) and names what differs; seeding refuses
  runs that record no process languages, and runs scored by different scorers. Protocol rows are never passes: seeding
  lists them under `protocol`, and a check never fails on them. `--prune-protocol --baseline=<file>` applies `score.ts`
  `slotProtocol` to the rows of the baseline's seeding runs and removes the passes its protocol rows recorded, listing each
  pair (rebuild/TESTS.md §9). Since ceiling round 3 a seed is never written over the baseline it replaces (see "Seeds go
  to a staging folder").
- `cases/seal.ts`: seals a held-out case set (see "Sealed held-out sets").
- `fresh.ts`: a fresh round, from new cases to a report of failures by signature (see "Fresh rounds"). It counts residual
  classes apart from the per-case `residual` the scorer writes (`score.ts` `RESIDUAL_CLASSES`, the one registry).
- `cases/used-ids.ts`: every case id used so far and the generation lock, shared by `seal.ts` and `fresh.ts`. A run made in
  another worktree of the repository names its case files by that worktree's paths; one that is gone is looked up from
  `.artifacts` or `rebuild` on in this repository (`inThisRepository`), since every worktree shares one `.artifacts`, and a
  named file that is a symbolic link into such a worktree is followed to its target the same way (the charter evaluation
  linked its derived family files, and the links dangled once that worktree was removed, which made `seal.ts` refuse);
  `cases/parts.ts`: contiguous parts of a case file for parallel jobs and the giants rule, with a command line that splits a
  file and prints counts only; `cases/giants.ts`: the giants set (see "Giants"); `cases/family-widths.ts`: the rule and
  feature family paragraphs at seeded widths; `cases/parts.test.ts` their rules.
- `tsconfig.json`: the repo's strict settings over the lab and its case generators
  (`bunx tsc -p rebuild/lab/tsconfig.json --noEmit`).
- `VALIDATION.md`: what the end-to-end validation ran, found and fixed.
- `WEBKIT-HOST.md`: how the WKWebView host's rows compare with installed Safari's, and when they may stand in for it.
- `measure-first-cases.ndjson`: 20 hand-written cases per browser for the measure-first check ("Measure first"): the
  platform UI font at sizes one of which is another's zoomed size, controls without an optical size axis, and an emoji before
  and after a text presentation request.
- `smoke-cases.ndjson`: 25 hand-written cases covering spans, bare white-space text nodes, pre-wrap with trailing
  spaces and empty lines, `pre`, `pre-line`, `break-spaces`, `nowrap`, RTL Hebrew and Arabic, CJK, keep-all, emoji,
  soft hyphens, combining marks, ZWSP, mixed font sizes, tabs, a span with its own `lang`, a fixture web font and a
  fractional line height.

## Landed in ceiling round 3

- **Fresh rounds: landed 2026-09-17 20:10** (`fresh.ts`, "Fresh rounds" below). One command per browser and seed:
  `bun rebuild/lab/fresh.ts --browser=chrome --seed=<new name>` (add `--both-orders` in evaluation). Don't wrap it in the
  lock; it starts its browser jobs under the lock itself. Validated in Chrome, Firefox and webkit-host on seed
  `r3-tool-check-1`: 11,477 cases in both orders took 27 s in Chrome, and Firefox and webkit-host ran beside each other in
  about 40 s each. A round with both orders leaves about 0.9 GB of rows; when you are done with one, run
  `.artifacts/session/compress-rows.sh lab/fresh/<browser>/<seed>`. The report reads compressed rows, and since ceiling
  round 4 so does scoring (`rows.ts`). The two tool-check seeds are development sets now, not fresh ones.
- **Giants: landed 2026-09-17 20:10, validated 20:35** (`cases/giants.ts`, "Giants" below). 9 cases left
  `heldout-suite-sample.ndjson`, and the combined `final-20260916/cases/heldout-all.ndjson` and
  `heldout-suite-sample-part0.ndjson`, for `.artifacts/lab/cases/giants.ndjson`; `giants.moves.json` records every move.
  The set ran exclusively with `--chunk=1` in Chrome (84 s), Firefox (13 s) and webkit-host (328 s), and in all three every
  giant's native observation equals its row in round 2's held-out run (`.artifacts/lab/giants-20260917`, `score.ts
  --native-compare`). Installed Safari took about 5 minutes a giant in round 2, so there a giant is a job of its own.
- **sealed-3: generated 2026-09-17 20:12** (`.artifacts/lab/sealed-3`, `baselines/sealed-3-20260917.json`; "Sealed held-out
  sets" below). Not run and not opened: only the evaluator scores it, once. `bun rebuild/lab/cases/parts.ts --cases=<file>
  --parts=3 --out-dir=<dir> --browser=<browser>` splits a sealed file for parallel jobs and prints counts only.

- **Scorer 5 and the staging gate: landed 2026-09-17 20:50, the coverage rule final at 21:10** (`score.ts`, `gate.ts`;
  "Scoring" and "Seeds go to a staging folder" below). Re-score with it before counting anything, and again if you scored
  between 20:50 and 21:10 (the rule for gaps reported on neighbouring lines and the decision text changed in between; the
  metrics didn't). `SCORER_VERSION` is 5, so baselines seeded under scorer 4 refuse its runs by environment, as they
  should. What changed:
  - *Covered failures.* A gap covers a failing line only where its range touches what differs there ("Covered failures"
    below). The per-case `lineGaps[metric].covered` and the summary's `lineLocal.withoutLineGap` keep their names and their
    meaning, no covered explanation, so tools that read them need no change; `lines[].gaps` now lists only the gaps that
    cover, and `lines[].elsewhere` the ones scorer 4 counted. The round 2 critic's six rows (`c-906c6bc491c83c9d`,
    `c-a52d0bfda6f53a43`, `c-f1877e45ed22478e`, `c-522324a27e5bb6bd`, `c-430fa200ce40d3eb`, `c-4cafadcd4b3fb900`) come out
    uncovered, and `score.test.ts` holds the rule's cases.
  - *Residual classes.* `RESIDUAL_CLASSES` in `score.ts`; per-case `residual`, summary `lineLocal.predictionRows`
    (`failing`, `withoutCoveredExplanation`, `residualProbed`, `residualSignatureOnly`, `open`) and `lineLocal.residual`.
    Until ceiling round 4 `fresh.ts` matched on its own from `residual-classes.json` (same class id, a looser probed test:
    the run's whole text, no painter condition); it now reads the scorer's `residual` field, so one registry decides.
  - *Indented lines.* Chrome's and Firefox's widths and painter extents on indented lines are observed ("Metrics per
    case", widths).
  - *Gate.* `--seed` and `--prune-protocol` need `--staging=<dir>` and never write the baseline; the seed record lists lost
    pairs with their covering gaps and the pairs that leave through new history dependence.
  - *Round 2 re-counted.* `.artifacts/ceiling-20260917/rescore-s5/`: `uncovered.txt` (per browser, per set: rows failing a
    prediction metric, without a line-local gap under scorer 4, without a covered explanation under scorer 5, residual
    members, open; then the classes with example ids) and `uncovered-<browser>.json` (every such row with its failing
    lines, evidence and the gaps elsewhere); per-set summaries and per-case files under `<browser>/<set>-<order>/`.
    `tools/rescore.sh <browser> [set...]` re-scores round 2's rows (one scorer process at a time: a process peaks at 5.8 GB
    on the held-out suite sample, and three at once passed the watchdog's 10 GB), `tools/uncovered.ts` writes the listing.
    Sealed-2 is counts only.

- **Pinned Chrome and Firefox: landed 2026-09-17 20:45** ("Pinned browsers" below). `run.ts` and `probes/runner.ts` launch
  private byte-identical copies under `~/github/browser-engines/apps/`, never `/Applications`. Nothing changes in how you
  run them. `run.json` records `app` (path, `pinned`, the copy's tree hash) beside `build`, and `bundleSha256`, a content
  hash of the library bundle the pages ran, beside `bundleBytes`.
- **Parts, sharded runs, isolation: landed 2026-09-17 20:45** ("Parts" and "Sharded runs and isolation" below).
  `bun rebuild/lab/sharded.ts --browser=<b> --cases=<file> --out=<dir> [-- <run.ts arguments>]` runs a file as three jobs
  at once and joins the rows; don't wrap it in the lock. With `--isolate` and `--ids=` or `--ids-file=` it runs the given
  cases each in a fresh browser process, for page-history questions. Installed Safari runs in 5-minute parts by default, each
  in a fresh tab.
- **`--record-measurements`: landed 2026-09-17 20:45** ("Recorded measurements" below). Opt-in; it writes
  `<browser>-measurements.ndjson.zst` beside the rows, and `bun rebuild/lab/measurements.ts --rows=<rows> --measurements=<file>
  [--predictor=<file>]` replays a library build against it with no browser.
- **Font facts: landed 2026-09-17 21:35** (`font-facts.json`, `font-facts.ts`, `font-facts.test.ts`; "Font facts" below and
  DESIGN.md §1.2). `predictor.ts` already attaches them: nothing to run. Every fact is optional, and an engine that doesn't
  read one keeps the gap condition it has. What is there:
  - *The five missing families.* Hoefler Text, Kohinoor Bangla and Monaco are in the table. The platform UI font is too:
    `system-ui` in all three engines, `BlinkMacSystemFont` in Blink, `-apple-system` in WebKit and Gecko. `-apple-system`
    in Blink and `BlinkMacSystemFont` in WebKit and Gecko are family names that match nothing, so alone they still give
    unknown facts (the engine's standard family isn't resolved).
  - *Equally good faces.* Blink takes the first in AppKit's member order and WebKit the first in Core Text's matching order,
    both from source, so Osaka and Hoefler Text give them facts; Gecko keeps every tied face and gets a fact only where
    they agree.
  - *`FontFacts.fonts`*, one entry per listed family in list order: `realizes`, `coverage` (code point ranges as that
    engine asks the font), `ligatures` (patterns of character sequences, with `spaced`: still a ligature under the features
    the engine sets for letter-spacing, and `complete`: no other ligature exists between grapheme clusters),
    `spacingInputs` (the characters that liga, clig and, in Blink, calt lookups can act on at all) and `scriptLookups`
    (scripts whose GSUB and GPOS lookups differ from the font's fallback records, as HarfBuzz selects them).
  - *What the tables say about the lab's main fonts.* Georgia and Verdana have no ligature and nothing letter-spacing can
    change. Arial, Times New Roman and Courier New ligate no Latin (their `fi` glyph has no lookup); their `liga` lookups
    start only at alef, reh and lam (the Allah and rial ligatures and a few lam ones), and lam-alef is `rlig`, which
    letter-spacing keeps. Amiri and Noto Naskh Arabic draw lam-alef as two glyphs in two clusters; Noto Naskh's one
    ligature is U+FDF2 with its marks. Helvetica, Helvetica Neue, Times, Menlo, Geeza Pro, Thonburi and Hoefler Text shape
    through `morx`, where HarfBuzz reads no GSUB or GPOS script at all.
  - *Checked in the browsers, and corrected by them.* `tools/probe-letter-spacing.ts` measured 221 strings in 20 fonts at
    letter-spacing 0, 1px and 2px in Chrome, Firefox and webkit-host. No string the facts call untouched by letter-spacing
    (none of its characters in `spacingInputs`) changed its shaping: 0 of 128, 127 and 129. The probe also showed the
    offline Core Text run wrong about Thonburi: Core Text logged an invalid `morx` subtable there and ligated nothing, but
    Firefox and webkit-host ligate its `fi`. So `ligatures` is null for WebKit and Gecko on a face whose table Core Text
    rejected, and `complete` is false for them wherever the two shapers disagree on any string (Arial, Times New Roman and
    Courier New, on three presentation-form strings; Songti). It checked nothing about `coverage` or `scriptLookups`.

## Landed in ceiling round 4

- **Test tiers: landed 2026-09-18** ("Test tiers" below): unit tests, an offline replay of recorded Canvas answers against
  a frozen reference (`rebuild/tests/replay.ts`), the same sets in the pinned browsers (`rebuild/tests/browser-sets.ts`), and
  a known-status ledger with transitions (`rebuild/tests/ledger.ts`). One list of sets and one run protocol serve all of
  them (`rebuild/tests/sets.ts`).
- **Scorer 6** ("Scoring" below; `SCORER_VERSION` is 6, so seeds of scorer 5 refuse its runs). No metric's status changes
  between scorers 5 and 6: over round 3's evaluated rows of every defined set in the three browsers (about 190,000 rows,
  both orders) no status and no history-dependent mark moves, the three `suite/U+FFFC/start` rows go from open to covered,
  and nothing goes the other way. What changed:
  - *Report-only rects* don't decide which line a lineCount or breaks failure is attributed to ("Covered failures").
  - *WebKit*: a box whose engine width reports as the native width at a moved x isn't a differing unit, and a line where
    only the float32 sum differs takes its stand-in addends as units ("Covered failures").
  - *Painter limits* are recorded per painted line (`EnginePrediction.painterLimits`, from the library's `painterLimits`,
    which `rebuild/src/index.ts` now exports) and explain painter failures ("Painter limits").
  - *Gap firing* is recorded per case, and lift is counted over prediction failures alone ("Gap firing and lift").
- **Rows read plain or compressed** everywhere (`rows.ts`): `score.ts` takes `.zst` for `--rows`, `--native-compare` and
  `--native-rows`, a fresh round scores compressed parts, and `gate.ts --prune-protocol`, `compare-rows.ts`, `triage.ts`,
  `measurements.ts` and `rebuild/tests/derive.ts` read them too.
- **One residual registry.** `fresh.ts` reads the scorer's per-case `residual`; `residual-classes.json` is gone. The 1 au
  class's mechanism is verified (probe F13), and it stays a class because the library measures on OffscreenCanvas only.
- **`rebuild/tests/gate.ts seed` stages its seed** like `gate.ts --seed` ("Seeds go to a staging folder").
- **`rebuild/bench/run.ts` launches the pinned Chrome and Firefox**, the bundles whose build it records.

## Landed in ceiling round 4b

- **Measure first** ("Measure first" below): `run.ts --measure-first` and `browser-sets.ts --measure-first` predict every case
  of a document before its first native layout, as an application measures; `rebuild/tests/compare-sets.ts` compares such a
  run with a usual one case by case.
- **Scorer 7** ("Scoring" below; `SCORER_VERSION` is 7, so ledgers and seeds of scorer 6 refuse its runs; compare across them
  knowingly with `ledger.ts transitions --allow=scorer`). No metric's status, no covered flag and no residual membership
  changes between scorers 6 and 7 on the tier sets of 2026-09-18 (every set, the three browsers, both configurations, forward
  order: 380,882 scored rows); the line a lineCount or breaks failure is attributed to changes on 16 Chrome rows with the
  lab's facts and 18 without, all covered before and after. What changed: Blink's hyphen rect is found on whichever range of
  the node reports it and, on the expected side, from the layout's hyphen items; differing units inside one stand-in span
  are one run; Gecko's synthetic bold class is registered ("Covered failures", "Residual classes").
- **The known tail** ("The known tail" below): `rebuild/tests/known-tail.json` lists the classes left open on purpose, and the
  ledger's transitions name the items a moved case belongs to.
- **Seed records list the passes that leave with a dropped case** by id (`leftWithTheirCase`, "Seeds go to a staging folder").
- **Probe releases**: `rebuild/tests/rerun-probes.sh` runs Gecko's follow-up sets (F7 to F27, 83 facts) and WebKit's round 4
  set, whose probes return raw values alone: each gives one undecided fact that holds its record's hash (`rebuild/tests/facts.ts`),
  so a release reports when the browser's answers changed. The ten records of 2026-09-18 equal the WebKit owner's earlier runs.

## Landed in the round 4 evaluation

- **`fresh.ts` takes the rich pre-wrap kind and `--config`** ("Fresh rounds"): the evaluation's fresh sets ran in both
  configurations on the same cases and parts. Every suite case has been used, so the `suite` kind draws nothing until the
  suite gets a new source, and sealed-4 holds no suite sample ("Sealed held-out sets").
- **`cases/used-ids.ts` follows a dangling link into a removed worktree**, which had made `seal.ts` refuse.
- The evaluation's tools (aggregates by ledger status, both configurations crossed, seed record attributions, counts-only
  sealed scoring, the native hang set aside without opening a sealed case) are in
  `.artifacts/ceiling-20260917/evaluate-r4/tools`; REPORT.md "Round 4 evaluation" has the numbers.

## Landed at the correctness line (2026-09-18)

- **The runtime font checks measure in the engine's own kind of context** (`src/measure/font-checks.ts`
  `FontChecks.textRendering`, which each port gives in `src/engines/<engine>/checks.ts`; "Measure first" has the probes): in Blink text-rendering `optimizeLegibility`, which keeps them off
  the font cache key of the page's own text. Every no-facts Chrome and webkit-host record before it asks another question.
- **The ledger's format 2 carries an exact-value status per case** beside the four metrics, and `transitions` and tier 2
  exit 1 when a case stops being exact ("The ledger"). A format 1 ledger is built again from its runs. Known-tail rules can
  read the status (`not exact`, by family).
- **The seeds are adopted** ("Seeds go to a staging folder", "Adopted at the correctness line") and **six references are
  frozen** at 6b21b68 ("The correctness line"), from one set of recordings, `.artifacts/tests/runs/line-20260918`. Tools and
  logs: `.artifacts/ceiling-20260917/freeze-line` (`tools/tier2.sh`, `giants.sh`, `gates.sh`, `carry-attributions.py`,
  `adopt.py`, `check-adopted.sh`, `pack.sh`, `tier2-check.sh`, `headline.py`, `known-tail-additions.py`).

## Landed in the re-architecture's shared layer (S3, 2026-09-18)

- **The width is the slot's** (`src/model.ts` `LineSlot`), and the adapter makes a row from the library's function set
  (`predictor-core.ts`; "Prediction hook"). The row's format didn't move: a line keeps its slot's two insets, and tier 1 is
  the same on every case of the six references.
- **`measure` is the adapter's own count** of contexts and `measureText` calls, and `memoHits` is 0: the library's call
  log no longer holds every call (the runtime font checks ask Canvas without it), so the page doesn't read it and the
  recorder doesn't join it (`record.ts`: `declared` and `library` are gone from new records; nothing read them).
- **The observation ports take the width** the paragraph was laid out at (`observe/contract.ts`), which the library's
  paragraph no longer holds; a `LayoutPrediction` carries it.
- **`replay.ts pack` finds a run's parts under `--runs`**, wherever the run was recorded from, and reads them before it
  empties the folder it packs into: a run recorded from another checkout used to fail with "holds no measurement record"
  after `--force` had emptied `inputs/`.
- **`compare-rows.ts --prediction=without-measure`** and the two predictors it and `line-ranges` serve
  (`baselines/plain-predictor.ts`, `baselines/other-widths-first-predictor.ts`).

## Landed in the re-architecture's X2 and painter step (2026-09-19)

- **No port keeps a memo or a log** (DESIGN.md §4.6): a question a paragraph asks twice is asked of Canvas twice, and
  nothing in the library counts calls for the ports. Against the references frozen before it, tier 1 exits 3 with
  repeats only in all six: 0 predictions changed, 0 dropped only, 0 other questions, 0 new questions (on the owners'
  branches 65,900 Chrome cases without facts and 65,898 with them, 52,444 and 52,498 Firefox cases, 58,144 and 56,498
  webkit-host cases). Tier 2 in both orders and both configurations showed 0 transitions in each owner's browser
  (`.artifacts/tests/runs/ra-x2-blink`, `ra-x2-webkit`, `ra-x2-gecko`). The references were recorded again at the X2
  merge. "Asked and distinct" below has the counts, and DESIGN.md §4.7 what the memo's removal cost.
- **Who counts Canvas questions now.** The adapter, as before (`measure`). The ports' tests count what their stand-in
  Canvas is asked. Probe `blink-storage` S5 read the library's log; it now notes Canvas's answers on the page's
  `OffscreenCanvasRenderingContext2D`, with the string passed through untouched, finds a context's partition through
  the prepared paragraph's `canvases`, and checks that a context asked again answers the same. `tools/twin-scan.ts`
  names a context by its place in `p.canvases`.
- **The painter takes what `linePieces` gives.** `src/paint.ts` names no engine and reads no row: the adapter keeps each
  line's pieces, slot and line box flag, pairs them with the engine's `PaintRules`, and `LayoutPrediction.painter` is what
  the hook's `paint()` and `limits()` call. `paintable()` is gone, and the row is untouched. The painter differential is
  byte-equal on 389,646 of 389,646 cases, tier 2 forward showed 0 transitions in the three browsers and both
  configurations (`.artifacts/tests/runs/ra-x2-painter`), and check 8's list of exceptions is empty.
- **The tripwire tripped once**, on Firefox's giants along the inspected path ("Baselines for the tripwire" below).

## Landed in the re-architecture's X3 (2026-09-19)

- **The ports' model clean-up moves no row** (DESIGN.md §3, "Each port's data"). On each
  owner's branch tier 1 is the same on all six references with 0 questions changed, tier 2 in both orders and both
  configurations shows 0 transitions in the owner's browser, and the giants' predictions equal the frozen rows'
  (`.artifacts/tests/runs/ra-x3-blink`, `ra-x3-webkit`, `ra-x3-gecko`). The row's format didn't move.
- **Three Blink jobs change Chrome's recorded rows**, each in its own commit: gap lists are handed out canonical, with
  X2's two flows back (DESIGN.md §5); a painted line in an RTL block is segmented by script, which moves the limit
  `script-at-line-start` and no painted DOM (§7); an inspected paragraph makes no unused one-byte hyphen contexts
  (§4.6). At the merge tier 1 exits 1 for Chrome, as accounted (926 rows without facts and 756 with them differ byte
  for byte: 473 and 303 by gap lists, 461 by painter limits, 8 by both), and 0 for Firefox and webkit-host. Chrome's
  references were recorded again and frozen at the X3 merge (c7f3c3d; `.artifacts/tests/runs/x3-merge-20260919`; both orders, both configurations: exits 0; exactly 8 painter status transitions per configuration, all naming `limit:script-at-line-start`: 2 from `fail open` to `fail covered`, 6 already covered rows that name the limit too; 0 from a pass; exact values unchanged; gates lost 0 and no pass pair changed, so the seeds stay; the plain predictor's run equals the usual run on all 67,065 cases; every case of both recordings replays exactly, and tier 1 exits 0 for all six references again).
- **The proof behind the gap lists is a script under `.artifacts`, not a checked-in gate**:
  `.artifacts/tests/runs/ra-x3-blink/tools/canonical-proof.ts`, with its reports beside it (`canonical-proof-*.json`,
  `proof-after-b-*.json` with every case whose painter limits moved, `proof-after-c-*.json`). It defines canonical on
  its own, replays every case of both Chrome references frozen at X2 and compares after making both sides' gap lists
  canonical: 67,065 of 67,065 cases equal in each configuration, every new list already canonical. The orchestrator ran
  it again on the merged tree with the painter's limits left out. rebuild/TESTS.md, "Tiers", says what it proves and
  what it doesn't.
- **Tier 1's string storage rule watches `engines/blink/contexts.ts` too** (`replay.ts` `STORAGE_PATHS`), where
  `styleContexts` and `raw16Of` moved from `shape.ts`; `check --sites` names the site `raw16Of@engines/blink/contexts.ts`.
- **The known tail**: the painter item for the two open `twins` rows is closed, and the plain predictor's five Firefox
  cases went into `gecko/process-font-fallback-state` ("The known tail").

## Landed in the re-architecture's last step (2026-09-19)

- **The library has no index API, memo or log left** (`src/measure/canvas.ts` is `contextFor`, `width` and `bounds`;
  `src/measure/log.ts` is gone), and `src/model.ts` no longer holds `LineOf` and `LineResultOf`: a row's line type is the
  lab's alone (`types.ts` `LineOf`). Nothing in the lab read any of it since S3. `measure` stays the adapter's count and
  `memoHits` stays 0, since the row's format is frozen.
- **`replay.ts` reads reference format 2 alone.** Format 1 held the library's memo hits per case; all six frozen
  references are format 2, and a format 1 reference is refused by name.
- **Nothing moved**: tier 1 the same on all 389,646 cases with 0 questions changed; it exits 3 for Chrome by the string
  storage rule alone (files under `rebuild/src/measure` differ from the references' commit), and Chrome's tier 2 forward in
  both configurations shows 0 transitions, exact values unchanged and the gate lost 0
  (`.artifacts/tests/runs/ra-final-shared`); the plain and pure checks, the citation ledger and the painter differential
  (389,646 of 389,646 against the painter of bee0202) are clean. Tier 1 exits 0 for Chrome again once its two references
  are frozen at a commit that holds these files (`freeze --force --questions-only --reason=<why>`, the orchestrator's).
- **Chrome's lab gate seeds hold `twins`** in both configurations ("Seeds go to a staging folder", "Adopted at the
  correctness line").
- **Knip** (`bunx knip --config rebuild/knip.config.ts`): `cases/font.ts` `formatFontShorthand` and `font-facts.ts`
  `parseFamilyList`, which only their tests read, and `types.ts` `InlineElement` are gone (the tests hold the same
  behaviour through `parseFontShorthand` and `fontFactsFor`); the entry list names `compare-sets.ts`, `coverage-map.ts`
  with its shard, `function-set.ts` and `known-tail.ts`. What it still lists is the four test helpers its header names.
- **`rebuild/tests/seed-facts-20260916.sh` is removed**: a one-off that seeded `rebuild/facts` from the first day's probe
  outputs and would now write over facts files that later rounds merged into (Gecko's 83 follow-up facts). Per release
  the facts come from `rerun-probes.sh` (rebuild/TESTS.md §7).
- **The coverage maps are regenerated** at this tree ("Checks for the re-architecture", "Coverage map").

## Landed in correctness round 5 (2026-09-19)

One owner per engine landed the fixes that close the gap with main's true passes where Canvas can settle them without
supplied font facts, and a critic then read the three branches, merged them in a scratch clone and ran a held-out probe
(research/CORRECTNESS-ROUND-5.md has the outcome, the cost table and the four reports; DESIGN.md §4.4 the recipes).

- **Gecko** (`.artifacts/tests/runs/cr5-gecko`, `.artifacts/session/cr5-gecko-20260919`): where the `pairKerning` fact
  isn't given, Canvas tells which glyph of a kerned pair carries the adjustment, from the app-unit rounding of each
  glyph; a joined suffix that a fallback font draws is measured behind its own first letter; a boundary U+00A0 is
  measured as itself; `paragraphGaps` hands out copies. A plain paragraph's break scan leaves the first two recipes'
  questions out until a fit test or an edge needs them (DESIGN.md §4.6, "Gecko's lazy plain scan"). The critic found a
  hole in that scan and fixed it with 9 lines and `engines/gecko/lazy-scan.test.ts`, merged as its own commit. (The
  profiling phase measured the scan and took it out with its test: research/PROFILING-START.md item 8.)
- **WebKit** (`.artifacts/tests/runs/cr5-webkit`, `.artifacts/session/cr5-webkit`): the font code path of a width is
  the measured string's, for the letter-spaced ligature recipe and for `control-character-width`; a box's space is
  measured once as the box is made.
- **Blink** (`.artifacts/tests/runs/cr5-blink`, `.artifacts/session/cr5-blink`): the pair window reaches past a cluster
  of an ignorable character and a mark. A negative result stands for main's two big Chrome groups (probe
  `blink-cr5` K and L; DESIGN.md §5).
- **Tier 1 exits 1 or 4 at this merge, as accounted, until the references are recorded again.**
  - Chrome exits 1: 66,328 of 67,065 the same per configuration, 569 and 416 cases ask a new question, 39 and 56 other
    questions, 129 and 265 predictions changed in gap lists (329 `script-context` entries fewer and 2 `unsafe-to-break`
    more, without facts) and in 2 cases' cluster advances, 0 line ranges. Expected ledger after recording: lineCount
    fail covered 343 and 279, breaks fail covered 413 and 316 with 1 open.
  - webkit-host exits 1: 154 cases change in their gaps alone. 22,450 without facts and 22,426 with them ask in
    another order. 7,020 and 7,044 ask a space the record lacks. A questions-only freeze won't do, because 154 gap
    lists changed: it needs a full recording, pack and freeze with a reason, and the painter differential's frozen side
    bundled again.
  - Firefox exits 4: 9,344 new-question cases without facts, and 4,560 new plus 1,444 repeats only with facts. 0
    predictions changed.
  - `function-set plain` and `pure` skip the cases that can't replay, and the painter differential exits 3 with 0
    paintings differing. Tier 2 in both orders and both configurations, in each owner's browser, covers them: 0
    transitions from a pass, exact values not worse, gates lost 0 (rebuild/TESTS.md, "Tiers", has the transitions).
- **The plain predictor's browser runs**, `compare-sets --prediction=line-ranges` against the usual run. Chrome: 0 line
  ranges and 0 native observations differ. webkit-host: 0 line ranges, and the same 3 history cases differ natively
  (`c-1ca0bab9ded7a4c6`, `c-53283654e67b8035`, `c-7cc5e3e26ff7c30d`); a scratch plain predictor with facts gave the
  same. Firefox: 0 line ranges in 63,771 cases in the owner's run. The plain predictor's run in Firefox is not stable
  in `heldout-suite-sample` part 0: 7 native observations and 0 line ranges in one run, 74 and 7 in another, every one
  history-dependent in the ledger.
- **Counts since the round** ("Asked and distinct" and "The plain check since X1" below keep the numbers of before).
  webkit-host's plain path asks 36.51 and 18.83 questions a paragraph (2,336,048 and 1,205,040 asked), and its lab path
  85.90 and 56.98 (5,496,506 and 3,646,278). Firefox's plain path asks 55.07 without facts (54.56 before), and its lab
  path 120.23 and 117.03 (114.54 and 115.70). Chrome's plain path asks 234.31, as before. Distinct counts over the
  whole corpus wait for the new recording. The seeds don't change.
- **The known tail** took the round's findings ("The known tail" below).

All six references were recorded again at 3d0a5b3 and frozen at f072dc4 (tag `cr5-merged`). The recording, both orders
and both configurations: six exits 0, 0 transitions from a pass to a failure, exact values not worse, gates lost 0.
Chrome: 4 transitions a configuration, all on `c-bff5270008f33766`, to a pass. webkit-host: 3 painter rows lose
`control-character-width` from their cover. Firefox: 598 transitions without facts and 22 with them, none blocking: 241
and 19 go to a pass, 5 cases without facts go from a pass to history-dependent (named under
`gecko/process-font-fallback-state`), and no case leaves history-dependent; differing predicted values without facts 301
to 239. Every case replays exactly from the packed recordings. Seeds were staged for all six with 0 lost; Chrome's
gained 3 and 3 pass pairs, Firefox's 241 and 19 (20 pairs left through history), webkit-host's none, and Chrome's and
Firefox's were adopted. The plain predictor's run against the usual run: Chrome 0 of 67,065 cases differ, webkit-host
the 3 known, Firefox 120 in the known process (14 of them in line ranges), all history-dependent in the ledger. On the
frozen tree tier 1 exits 0 for all six, the plain and pure checks exit 0, the painter differential holds 6 of 6 and
citations lose 0.

## Landed in the fresh-eyes follow-up (2026-09-19)

A reviewer who hadn't worked on the code read the library against the engineering guide
(research/FRESH-EYES-REVIEW.md). Three owners and a critic took up what it found; rebuild/SHARED-CHANGES.md has their
entries and the orchestrator's decisions, and rebuild/TESTS.md, "Tiers", the tests and probes.

- **Shared** (`.artifacts/tests/runs/fu-shared`): one parser reads a font-family list for the font checks and the
  three ports (`src/font-family.ts`; DESIGN.md §1.1). The lab keeps its own three readers of a family string
  (`fresh.ts`, `score.ts`, `font-facts.ts` `parseFamilies`), since it may not import the library's. `tools/two-trees.ts`
  compares a plain predictor's line ranges with the layout's lines that have a line box, as `compare-rows.ts` does: on
  the reviewer's 6,362 fresh cases the false differences went from 9, 47 and 5 to 0. `gates.ts` names the cases for
  tier 2 in its last line and removes stale socket files ("Test tiers"). A worktree's probes project checks its own
  files.
- **Gecko** (`.artifacts/tests/runs/fu-gecko`): text runs hold their recipe contexts by reference, on a record that
  also holds the context's pair placement (DESIGN.md §4.6). No question moved. The owner's two later commits weren't
  merged; they stay on branch `fu-gecko`.
- **Blink** (`.artifacts/tests/runs/fu-blink`, `.artifacts/lab/fu-blink`, `.artifacts/probes/fu-blink`): `system-ui`
  is matched as the CSS keyword it is in any case and as a quoted name as written, and `BlinkMacSystemFont` stays
  exact (probe `blink-sysui-spellings`, 20 of 20 checks). A span that holds nothing but empty items and a collapsible
  space creates a box fragment, as `ExitInline` sets it: the review's open row `c-d600d9b01c0ae9d7`, and the
  known-tail class that had blamed the lab's observation port ("The known tail").
- **The critic** (`.artifacts/session/fu-critic`, `.artifacts/tests/runs/fu-critic`): a family the list leaves open
  at its end is handed on as a closed string, merged as its own commit; the one parser had let the font checks'
  appended generic land inside such a name.
- **Tier 1 at the merge, before the freeze.** The box fragment rule changes predictions by design: 494 Chrome cases per
  configuration (483 distinct ids) gain an `inline-box` geometry item, with 0 questions changed. The full `gates.ts`
  showed exactly four rows of 39 that aren't 0: tier 1 for Chrome exits 1 in both configurations, and the painter
  differential for Chrome exits 3 in both (494 not painted, 0 differ). Tier 1 exits 0 for Firefox and webkit-host with
  0 questions changed, so their references are unchanged.
- **The needs-browser list after such a merge** holds the cases whose questions changed and the storage rule's, not
  the cases whose prediction changed under the same questions ("Tier 1: offline replay", "By rule, to tier 2"). With
  facts it held 47 of the 483 changed ids; the critic ran tier 2 on the union.

Chrome's two references were recorded again and frozen at d7df936 (`.artifacts/tests/runs/fu-merge-20260919`). The
recording, Chrome only, both orders and both configurations: four exits 0 (no-facts, facts, the plain predictor's run,
its comparison). 67,065 cases each; 3 status transitions per configuration, all on `c-a37545c096e939be`
(`rich-prewrap/normal-in-pre-wrap`): breaks `fail open` to pass, widths `unobserved` to pass, `not exact` to exact; 0
from a pass; differing predicted values 266 to 265 without facts and 552 to 551 with them; gates lost 0, new 2. The
plain predictor's run equals the usual run on all 67,065 cases. Every case replays exactly from the packed recordings.
The references were frozen with `--force` and a reason, Chrome's tier 2 seeds were adopted (0 lost; breaks and widths
gain one pass pair in each configuration), and the painter differential's frozen side was bundled again.
After the freeze the full offline gates exit 0 on the frozen tree (39 gates, no case left for tier 2).

## The profiling phase's item 1: a page's list of contexts (2026-09-19)

`prepare(paragraph, env, inspect, contexts)` takes the list its Canvas contexts are found and made in (DESIGN.md §4.6,
"A page's list of contexts"; research/PROFILING-START.md, item 1; research/PERF-LIFETIME.md has the prototype that also
kept the font checks' answers, and its review). The lab's usual predictors hand `prepare` none, so every case makes its
own contexts and a case's record stays what one paragraph asks: the references, the seeds and tier 1 are untouched by
it. Since 2026-09-20 Gecko's `prepare` makes its contexts anew whatever list it is handed (DESIGN.md §4.6, "What
invalidates it"), so in Firefox a page predictor's run is a usual run, and the bench's one-list rows measure there what
a list a message measures. What holds a page's list (`.artifacts/tests/runs/contexts-20260919`,
`.artifacts/bench/contexts-20260919`):

- **Three predictors** under `baselines/`, `page-contexts-predictor.ts`, `page-contexts-facts-predictor.ts` and
  `page-contexts-plain-predictor.ts`: the usual three with one list for every case a document lays out
  (`predictor-core.ts` `makePredictor`'s and `makePlainPredictor`'s `pageContexts`). `browser-sets.ts --predictor=...`
  runs them in both orders, and `--shuffle=<seed>` in a third; `compare-sets.ts` compares their rows with a usual run's
  ("Prediction hook"). TESTS.md, "Tiers", has the results: Chrome and webkit-host equal the usual recordings on every
  row in every order and configuration, and Firefox's 7 differing cases are the process's two fallback-font states.
- **`tools/twin-scan.ts --page`** scans a case file as one page with one list, and names a context by the object it is,
  because `prepare` empties a list past its bound ("Checks for the re-architecture").
- **The bench** lays the chat messages out with a list a message and with one list a pass, taking turns in one
  document (bench README, "Chat", E), so one run holds the library before the list and after it.
- **Probes and a tool**: `probes/contexts-font-load.ts`, `contexts-page-lang.ts`, `contexts-device-scale.ts` and
  `contexts-canvas-churn.ts`; `tools/contexts-bound.ts`. The device scale probe needs `runner.ts
  --chrome-emulate-dsf=<factor>`: its script asks the runner for another factor mid-page (`/api/chrome-dsf`) and puts
  the run's factor back before it returns.

## Test tiers

Four tiers by time, one command each. The first three give a signal in seconds to minutes; the fourth is the round's
evaluation (fresh sets, sealed sets, giants, installed Safari), which stays as it was. Every tier runs the same sets under
the same protocol, in two configurations: `no-facts`, the headline (no supplied font facts; `baselines/no-facts-predictor.ts`),
and `facts` (the lab's font facts, the optional input; `predictor.ts`).

| Tier | Command | What a change shows as | Measured |
|---|---|---|---|
| 0 | `bun test rebuild` | a failing unit test | 11 to 12 s (727 tests then; 819 in 59 files on 2026-09-19, 862 in 64 since the fresh-eyes follow-up); 20 to 30 s at load average 25 |
| 1 | `bun rebuild/tests/replay.ts check --browser=all --config=all` | every case whose full prediction changed, with the first differing field; every case whose Canvas questions changed, by kind (repeats only, dropped only, other); cases that need the browser | 42 s for the six frozen references (388,886 cases then, 389,646 with `twins`) on a quiet machine with the library's memo, 4 to 9 s a reference; 77 s at load average 25; two to three minutes since the memo went, beside other owners' jobs |
| 2 | `bun rebuild/tests/browser-sets.ts --browser=<browser> --out=<dir>` | status transitions against the reference ledger, of the four metrics and of the exact-value status, and lost pairs against the build-keyed seed | forward order, one browser at a time: Chrome 88 s, Firefox 108 s, webkit-host 128 s; the three at once against the frozen line: 92 to 195 s a browser and configuration; both orders with recording, the three browsers at once: 3 to 5.5 minutes each |
| 3 | the round's evaluation (`fresh.ts`, sealed sets, giants, installed Safari) | new classes on cases nobody saw | see REPORT.md |

Times are from this Mac (18 cores, 36 GB) on 2026-09-18 while other owners' browser jobs ran beside them, so they are
upper bounds. `--config=facts` selects the other configuration in tier 2; tier 1 checks every frozen reference there is.
Run tier 2 in both: with no supplied facts most values are limited, so a change that makes values wrong blocks in the
facts configuration, where they are predicted ("The ledger", the exact-value status).

**One command for the offline gates**: `bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick]` runs
every check that needs no browser side by side, reads each exit code from the child process itself, and prints one
table: gate, exit code, whether a pure refactoring may go on with it, wall time, the report's key counts, and what the
code means in words and which kind of step accepts it. `--quick` is for after every small edit: tier 0 (the six `tsc`
projects, incremental, and the unit tests a process a file, ten minutes a test so a busy machine doesn't fail them),
tier 1, and the function set's plain and pure checks, for
that engine's browser in both configurations. Without it the sweep, the painter differential, the citation ledger and
(for Blink) the twin scan run too. It exits 0 only when every gate is fine for a step that means to change no prediction
and no Canvas question; otherwise the worst result, in the order 1, 2, 5, 4, 3 (the file's header). Tier 1's exit 3 is
fine there when no case dropped a question (repeats only, or Chrome's string storage rule alone), and the row still
sends the listed cases to tier 2; a function-set check that skipped cases isn't fine although it exits 0. Logs and the
rows as JSON are in `rebuild/tests/.check/gates`. Tier 2 stays its own command. Every gate starts at once, and they
share the cores one child process at a time (`rebuild/tests/cores.ts`): the table's order decides who gets a core, and a
quarter of the cores go to groups of long paragraphs first, which bound the run's end. A gate's process asks for all its
cores over one connection: macOS refuses a connection at once while 128 wait for the listener to accept them, a
connection a request was 496 of them at a full run's start, and at a load average of 60 that failed two gates of a run
(exit 2) on 2026-09-19; with the same start, 24 of 31 stand-in gates failed to connect before and none does since
(`rebuild/tests/cores.test.ts`). Measured on 2026-09-19 with the
X3 merge's library, other owners' jobs beside it (load averages of 10 to 40): `--quick` 27 s for WebKit, 49 s for Gecko
and 112 s for Blink (1,800 CPU-seconds on 16 cores: Chrome's cases ask the most questions); the full form for the three
engines 13 minutes (10,300 CPU-seconds, 12 GB at the peak; tier 1's six rows after 74 s), against 62 minutes and 18,000
CPU-seconds for the same gates one after another earlier that night, at load averages of 40 to 75. At load averages of
45 to 60 the same forms took 32 s, 103 s, about 3 minutes and 20 minutes. Since the fresh-eyes follow-up the run's last
line names how many cases tier 1 sends to tier 2, per gate, so "every gate is fine" never reads as done (the rows carry
the count as `tier2`; the exit codes are unchanged). A run first removes the `pretext-gates-<pid>.sock` files of
processes that are gone: listening fails on a path that exists, and a run killed from outside leaves its file. A full
run can take 30 minutes on a shared machine, and waits for its turn first, so start it detached from anything that has
a time limit.

**One run at a time, and a result kept by its inputs** (2026-09-19; the header of `gates.ts` has both in full). Several
full runs at once, each in its own worktree, took 19 to 33 minutes each instead of 12, at load averages of 80 to 160,
and an owner, its critic and the orchestrator ran the gates three times on one tree. So a run takes a machine-wide turn
before its first gate: a numbered ticket in `.artifacts/tests/gates/queue`, which every worktree shares, made in one
step, first come, first served. A full run waits for the full runs before it and a `--quick` run for the `--quick` runs
before it, and either for a run of its own worktree, whose reports and logs it would write over; while it waits it says
who holds the turn (pid, worktree, flags, since when) and how many wait before it. A ticket whose process is gone holds
nobody up, so a killed run needs no cleaning. A run whose turn came still starts no gate while under 30% of the
machine's memory is free, the browser lock's floor, and keeps its place meanwhile: on 2026-09-19 two full runs beside a
browser scoring job took the machine to its swap. `--no-wait` skips both waits. Measured with `--quick --engine=gecko`,
31 s alone on a quiet machine and 42 to 55 s beside other owners' jobs: two at once took 115 and 120 s (246 and 248 s
on a busier machine, where one took 113 s), one after the other through the queue 50 and 100 s. On 8 cores each they
took 74 and 76 s, which gives the second what it takes from the first, and a run alone on 8 cores took 52 s, so a run
never takes fewer cores instead of waiting. A `--quick` run and a full run don't wait for each other: beside a full run
the `--quick` run took 123 s (185 s on 8 cores) at load averages up to 58, where its wait would be six minutes on
average; the full run took 16 minutes with those two beside it and other owners' jobs. `replay.ts pack` and `freeze`
take a ticket in the same queue, as a job that writes: they replace the frozen references every worktree's gates read,
so they wait for every run before them and every run after them waits for them (on 2026-09-20 a pack removed input
shards under another worktree's sweep, which failed with ENOENT).

A run whose inputs equal an earlier finished run's prints that run's table and last line again, says that it is a
reused result with that run's time, worktree and commit, and exits with its code, in 0.2 to 0.4 s (the key takes up to
1.3 s at a load average of 60); `--fresh` runs anyway and replaces the result. The key is a sha256 over everything a
gate reads, and `gates.ts` says what that is once, beside what reads it. `inputsKey` hashes what every gate reads (the
working tree with its uncommitted edits, the installed packages, the flags that choose gates, bun's version and the OS
release) and says what it leaves out and why (`--cores`: no report depends on it). What a gate reads of `.artifacts`,
such as a frozen reference as `check` reads it, is the gate's `reads` list, set where the gate is made (`gatesOf`) with
the reason beside it, and the key walks those lists, so a new gate's input is in the key by being named there. A
result is kept only when every gate has one, no
gate's tool failed, no case goes to tier 2 and the key is the same after the run as before it, so a tree edited under a
run keeps nothing; the last 50 are in `.artifacts/tests/gates/results`. A reused result is the table and `gates.json`,
not the gates' reports: tier 2 takes its cases from tier 1's `<report>.needs-browser.ids` in the working tree, which
after a reused result is absent or an earlier tree's, so a run that sends cases to tier 2 runs again in the worktree
that goes on to tier 2. What unit tests read outside the repository (the pinned engine sources and the groundwork's
tools under `~/github/browser-engines`, Homebrew's ICU 78) isn't in the key: run with `--fresh` after changing one.

**A process replays a group of shards** since 2026-09-19 (`replay.ts` `shardGroups`; tier 1, the function set's plain
and pure checks, the painter differential): a set's shards eight to a process in order, and a shard of fewer than 50
cases, which holds long paragraphs, alone. A process a shard spent most of its CPU time warming up: Chrome's 482 no-facts
shards replay in 122 s in one warm process and took about 450 s in 482. The groups follow from the manifest alone, so
the reports don't depend on the number of cores or on the sets chosen, and they are the same bytes as before on all
389,646 cases (`.artifacts/session/iteration-speed-20260919`). Back to back, three times each, on the three no-facts
references: tier 1 682 to 451 CPU-seconds, plain 821 to 541, pure 1,105 to 789; the painter differential on Firefox's
and webkit-host's 151 to 96. The replay's context keeps the key of its assigned settings (tier 1 440 to 398), the
function set's stand-in Canvas reads a font from its shorthand once (the sweep 326 to 245 on webkit-host's no-facts
cases), and the twin scan scans its case files in parallel (nine minutes to two and a half).

**The sets** (`rebuild/tests/sets.ts`): `smoke-hand` (the 25 cases of `smoke-cases.ndjson`) and `smoke`; the development
sets `runs`, `ws`, `policy`, `rich-prewrap`, `twins` and `wide-group-cuts` (both Chrome alone) and `suite-sample`; the rule and feature families
derived in round 3 (`families`, `features`, and Chrome's `features-en-US` under its second locale;
`.artifacts/tests/derive-r3-20260917`); and the 09-16 held-out sets `heldout-runs`, `heldout-ws`, `heldout-policy` and
`heldout-suite-sample`. Chrome 66,685 cases (67,065 with `twins`, 69,224 with `wide-group-cuts` too), Firefox 63,771, webkit-host 63,987. A case id can sit
in two sets (the smoke set samples the others, and `features-en-US` observes `features` ids under another locale), so
everything keys on set and id. Giants are in no set: a giant's record is as large as its calls and one can take minutes,
so they stay an evaluation job.

`rich-prewrap` (1,334 cases; `bun rebuild/lab/cases/rich-prewrap.ts --out=.artifacts/lab/cases/rich-prewrap.ndjson`, sha256
61bdf919…; research/PREWRAP-RICH.md) joined in round 4c, after the first references of 2026-09-18 were recorded, so the
validation counts of that day in this section (65,351 Chrome cases, 380,882 in all) are without it; the frozen references
hold it ("The correctness line"). It is the only set that reaches tab-size on a span, and justify beside a
preserved newline or beside preserved spaces across a box end: round 4c's three fixes (Gecko's tab-size and preserved
newline, Blink's justify end offset) changed the prediction of 0 cases of the other sets in Chrome and 2 in Firefox, and
corrected observed values in 7 and 47 cases of this one. Both orders with recording take 4 to 6 s a browser.

`twins` (380 Chrome cases, `lab/cases/twins.ts`, sha256 b7716331…): one run of 13 or more brackets after Latin and after
Arabic in one Amiri style, the only set where the Blink port asks the same characters in both storages in one paragraph;
Chrome 67,065 cases with it. It joined the development sets with the Blink string storage fix, after the correctness
line (specs/blink-RESULTS.md "String storage", research/BLINK-STRING-STORAGE.md), so the counts of the line in this
section are without it.

`wide-group-cuts` (2,159 Chrome cases, `lab/cases/wide-group-cuts.ts`, sha256 4da479ef…): lines that end within half a px
of where the browser fits them, in texts whose cuts of a shaping group of 256 zoomed px or more fall where shaping
crosses them (ligatures and contextual forms inside unbroken words, kerning inside words and at spaces, joined Arabic
and Indic letters, letter and word spacing, soft hyphens, combining marks, emoji sequences, the edges of an inline
box), in 103 installed families: 56 under Latin texts, 22 under Arabic ones and 31 under texts of eleven other
scripts, some under more than one. The Blink port alone cuts a group, so the set is Chrome's. The widths are the browser's own, so the generator has two passes: `pass1` writes every variant on one line
(2,159 variants: a text in a font at a size, Latin ones with letters in front so the cuts land on other offsets), a
`run.ts` job in pinned Chrome reads the code point rects, and `pass2 --rows=<its rows>` writes, per variant, three
break candidates past the middle times eight container widths from half a px under the browser's width of the text
before the candidate to half a px over it: 51,816 cases, of which `--one-each` keeps one a variant, drawn with the seed
`wide-group-cuts-1` and the variant's key, so a variant that joins or leaves moves no other variant's case. That is the set; the whole 51,816 stay a tool (`pass2` without `--one-each`). The first 22,536 of
them are, id for id, the cases with which a critic showed on 2026-09-20 that a form of the port that picked its cuts
without asking Canvas moved lines in real Chrome (1,158 cases at a device pixel ratio of 2; the set holds 51 of them,
and 2 of the 61 a second form moved), where the other 67,065 tier cases held no such text
(research/PROFILING-START.md, item 6). The pass-1 rows behind the case file are in
`.artifacts/tests/runs/b1b-rework-20260920/extended/pass1` (Chrome 153.0.8010.50, a device pixel ratio of 2); another
browser build or another set of installed fonts needs pass 1 again. Chrome's references, ledgers and seeds hold the set
since the recording at its merge (2026-09-20). The twin scan finds 0 on it.

**A change to Blink's cuts also passes the fonts probe before it merges** (since 2026-09-20): a change to how
`shape.ts` cuts a shaping group, to the safe test or to the windows it measures. The sets hold a few dozen font
strings, and the first form of the cut found without asking Canvas passed every tier while it moved lines in 196 of the
318 font families installed here; only a probe across all of them showed it (research/PERF-B1B-REWORK.md).
`tools/cut-fonts-probe.ts` lays the same long paragraphs out with two checkouts of the library, the main line's and
the change's, in one page of the pinned Chrome, in every family of a list, at ordinary widths, at the decided lines'
own widths and one LayoutUnit to either side, and at widths that put a line's end beside a cut; it compares cuts,
positions and lines, and takes about an hour in a Chrome slot at device pixel ratios 2 and 1
(`--chrome-args=--force-device-scale-factor=1`). The list is the machine's installed families, a JSON array kept under
`.artifacts` (the first one is `.artifacts/tests/runs/b1b-fonts-20260920/families.json`, 321 names of which 318
resolve). A change that means to move nothing must show 0 cuts, positions and layouts differing. Where the two trees
differ, the probe can't say which is right: `tools/cut-fonts-cases.ts` writes the differing families' paragraphs as lab
cases, `lab/run.ts` and `lab/score.ts` hold both trees' lines against the browser's own, and no case may go from pass
to a failure.

**A change to Gecko's word scan also passes its attacks and the premise probe before it merges** (since 2026-09-23): a
change to `engines/gecko/lines.ts` `wordScan`, to what it leaves to the engine's loop, or to the in-word recipes whose
values it passes over (DESIGN.md §4.6). The recorded sets hold the lab's fonts alone and few words at the width where
the premise decides. `tools/word-scan-attack.ts` lays seeded paragraphs out on a constructed Canvas that shapes like a
font without negative advances, plain by the tree and by its edited copies (`tools/word-scan-variants.ts`: `loop`, the
engine's loop alone, and `proven`, the word scan without its premise) and inspected by the tree, at drawn widths and at
the widths where a break moves, each with the app units beside them: no layout may differ from the loop's, no inspected
layout may report `negative-word-tail`, and inspected lines must be the plain ones. `--break-premise` makes the font
break the premise, and then every layout that differs must report the gap. `--dictionary` gives the environment the
dictionary breaks of Thai, Lao, Khmer and Myanmar (Intl.Segmenter), so a run of those scripts holds natural breaks inside
one shaping unit, and `--scripts` draws such runs from main's corpora and words of scripts the lists leave out.
`tools/word-scan-spaces-attack.ts` does the same for every space-like character inside words under every spacing and white-space value. A seed of 20,000 paragraphs
takes 10 to 25 minutes on a core, `--focus` and `--all-lines` the longer. `tools/word-scan-premise-probe.ts` holds the
tree against the loop in pinned Firefox, each word at the width of its own advance, over the installed families (the
list of the cut probe above; `WORD_SCAN_PREMISE_CONTROL=1` first, which must find its two planted failures): no word may
differ. It takes a few minutes in a Firefox slot. `tools/word-scan-scripts-probe.ts` (P2) with
`WORD_SCAN_SCRIPTS_WEBFONTS=1` holds the same test on installed faces loaded at their variation corners through
`FontFace` and on the made-up kern font `tools/negative-tail-font.ts`, beside Firefox's own lines, in about 30 seconds:
every word that differs from the loop must report the gap.

**A change to what Gecko and WebKit leave unasked at break opportunities and for resolving font lists also holds the
drops' real-text sets before it merges** (since 2026-09-23): a change to `engines/gecko/advance.ts` `ordinaryBreakAt` or
the questions it gates, to `engines/webkit/fonts.ts` `RESOLVING_GENERICS`, or another question the plain path skips on a
premise (DESIGN.md §4.4, "Taken out for speed"). The requirements audit dropped those questions on sets where no real
line moved, and two reviews then moved lines with the same drops on text real pages hold under CSS the sets didn't use:
`word-break: break-all`, soft hyphens, long words and URLs under `overflow-wrap`, font lists written for Windows. Their
case files are kept in `.artifacts/tests/runs/drops-20260923/cases/` (`real/` the real-text review's 15 sets, 284,546
cases, the books' per browser; `adversarial/` the other review's 10 sets, 91,336; `tier-<browser>.ndjson` the tier
corpus as one file). `lab/run.ts --predict-only --predictor=rebuild/lab/baselines/plain-predictor.ts` runs a set with
each of the two checkouts, the main line's and the change's, in a few minutes a browser; no case's lines may differ, and
where they do, each differing case is observed natively and the browser must side with the change.

**The protocol is part of a result.** Native layout can depend on what a document and a browser process saw before a case,
which follows from how a set is cut into jobs: round 3's held-out history-dependent counts moved when the run method did
(25 cases a round trip against 1, and without the giants). So `sets.ts` fixes each set's parts (the suite samples keep
their 4 and 2 part files), every part is one `run.ts` job in a fresh browser process at 25 cases a round trip, in file order
or reversed, and no tier takes `--chunk`. A ledger records each set's protocol with its case files' hashes, and two ledgers
of different protocols don't compare. Under this protocol two both-orders runs of one library an hour apart gave the same
status on every case and metric in all three browsers (0 transitions over 190,441 cases).

### The correctness line

Frozen on 2026-09-18 after research/ROUND4-CRITIC.md's verdict and its two fixes (the font checks' contexts; the ledger's
exact-value status). A change to the library is held to it by three commands:

```sh
bun test rebuild                                                        # tier 0
bun rebuild/tests/replay.ts check --browser=all --config=all            # tier 1: exit 0, or every changed case by its first field
for b in chrome firefox webkit-host; do for c in no-facts facts; do     # tier 2, in pinned browsers; both configurations
  bun rebuild/tests/browser-sets.ts --browser=$b --config=$c --out=<dir>/$b-$c [--both-orders] [--ids-file=<tier 1's needs-browser.ids>]
done; done
```

Tier 2 reads the frozen reference's ledger and the adopted seed of its browser build and configuration by default, and
exits 1 on a lost pair, a pass that became a failure or unobserved, or a case that stopped being exact. A change that means
to move a prediction records again, packs and freezes with `--force --reason=<why>`; the manifest keeps what it replaced.

- **What is frozen.** Six references in `.artifacts/tests/reference/<browser>-<config>` (inputs, the browser's own
  predictions, the replay's reference, the ledger), pinned by hash in `rebuild/tests/reference/<browser>-<config>.json`, at
  commit 6b21b68. They are packed from `.artifacts/tests/runs/line-20260918/<browser>-<config>`: every tier set with
  `rich-prewrap`, both orders, recorded at feb3937 with nothing uncommitted under `rebuild/src` and `rebuild/lab`
  (the two commits hold the same library, predictors, font facts, ports, page, runner and scorer; one library bundle a
  configuration, `1545f944f502…` without facts and `2b23885ba492…` with). Pinned Chrome 153.0.8010.50 and Firefox 156.0,
  webkit-host on WebKit 22625.1.29.11.27, macOS 26A428, DPR 2, scorer 7, ledger format 2. Chrome 66,685 cases, Firefox 63,771,
  webkit-host 63,987; the three browsers at once took 3 to 4 minutes a configuration.
- **Fidelity.** `pack` replayed all 388,886 cases to the browser's own prediction, the question sequences included: 0
  unfaithful. Tier 1 against the frozen references: every case the same, exit 0. A fresh forward-only tier 2 from the
  commit after the freeze, with the defaults above, in the three browsers and both configurations: exit 0 six times, 0
  transitions of any status, no pair lost (`.artifacts/tests/runs/line-20260918-check`). Planted afterwards, the font checks' old
  context (text-rendering auto) makes all 66,685 no-facts Chrome cases ask a question the record lacks, exit 3.
- **Against the round 4 evaluation's recordings** (3c17016, before the font checks' fix), whose ledgers were built again in
  format 2 from their own per-case files (`.artifacts/ceiling-20260917/freeze-line/r4-ledgers`): 0 status transitions on the
  four metrics and on the exact-value status in all six, the same history-dependent cases (Firefox 313, 314 on widths;
  webkit-host 279, 283 on the painter), the same differing predicted values, rect counts and limited values; all 208
  per-case files and the giants' 12 are byte for byte the evaluation's; `compare-sets.ts` over both orders finds no native
  observation, prediction or painted line that differs (Chrome 133,370 rows a configuration, Firefox 127,542, webkit-host
  127,974). The fix moved nothing, as the critic's forward Chrome run had said.

| Frozen tier sets | lineCount / breaks / widths / painter, % | Prediction failures | Without a covered explanation | Exact-value status | History-dependent |
|---|---|---:|---|---|---:|
| Chrome, no facts | 99.48 / 99.38 / 99.04 / 98.07 | 1,022 | 1 (breaks, `c-a37545c096e939be`); painter 4 | 65,869 exact, 816 not; 266 of 586,352 predicted values differ, none in a case without a failing prediction metric | 0 |
| Chrome, facts | 99.58 / 99.52 / 99.51 / 98.28 | 628 | the same 1; painter 10 | 65,965 exact, 720 not; 549 of 3,577,258, none in such a case | 0 |
| Firefox, no facts | 99.77 / 99.47 / 97.54 / 93.68 | 1,863 | 0; painter 0 | 63,146 exact, 312 not; 301 of 378,400, none in such a case | 314 |
| Firefox, facts | 99.81 / 99.56 / 97.82 / 93.68 | 1,625 | 0 open, 19 residual (the 1 au class); painter 34 | 63,172 exact, 286 not; 744 of 5,015,298, 6 such cases (the registered Nastaliq positions) | 314 |
| webkit-host, no facts | 99.87 / 99.78 / 99.58 / 93.04 | 398 | 0; painter 24 | 63,583 exact, 125 not; 0 of 565,440 | 283 |
| webkit-host, facts | 99.87 / 99.78 / 99.58 / 93.04 | 398 | 0; painter 25 | 63,583 exact, 125 not; 0 of 772,758 | 283 |

Rates are pass ÷ (pass + fail) over every tier set; history-dependent, protocol and unobserved cases are left out. Rect
counts differ in 992 and 869 of Chrome's 2,522,844, in 404 cases of each configuration whose prediction metrics all pass
(`rule/wbr-elements` 392, `rich-prewrap/nested` 12), in 134 and 102 of Firefox's (none in such a case) and in 197 of
webkit-host's (30 such cases): they are in the known tail, and being `not exact` already, they block only when a count
rises. `.artifacts/ceiling-20260917/freeze-line/tools/headline.py` prints the table per group from the frozen ledgers. The
rates on unseen cases are the round 4 evaluation's (REPORT.md "The correctness line"), which these recordings don't
replace.

**What the line doesn't hold.** One Mac at DPR 2 (`shared/one-device-pixel-ratio-one-os`); the painter and `src/paint.ts`
only through tier 2 (`lab/replay-blind-spots`); giants in no tier (run with the lab gate's seeds: all 12 runs equal the
evaluation's); Firefox's history-dependent set was stable between the two recordings of this day and wasn't on the
critic's fresh set (`gecko/process-font-fallback-state`); with no supplied facts most values are limited, so exact-value
regressions block in the facts configuration and only show as differing limited values in the headline one; installed
Safari wasn't run again (webkit-host stands in; the evaluation's spot check equalled it on 46,914 cases).

### Tier 1: offline replay

`run.ts --record-measurements` stores every Canvas answer and dictionary segmentation of every case ("Recorded
measurements"). `replay.ts` runs the working tree's library in bun against them, a process per group of shards across
the cores, and compares each case's full prediction with a frozen reference: the layout (lines, engine geometry,
fragments, gaps, limits, the slots below floats, the environment), the observation port's expected rects with their
predicted and limited values (the WebKit port's live measurements replay from the record's observe phase), and the
painter's limits per line; beside it, which recorded calls answered the library's questions, in order. The report is
byte for byte the same with 3 jobs as with 16, on a changed tree too.

```sh
# a recording: tier 2 with --record, both orders (the ledger needs them), in its own folder
bun rebuild/tests/browser-sets.ts --browser=chrome --both-orders --record --out=.artifacts/tests/runs/<name>/chrome-no-facts
# the inputs, the browser's own predictions and the ledger, into .artifacts/tests/reference/chrome-no-facts, with the fidelity check
bun rebuild/tests/replay.ts pack --browser=chrome --runs=.artifacts/tests/runs/<name>/chrome-no-facts
# the reference of the current commit; pinned by hash in rebuild/tests/reference/chrome-no-facts.json
bun rebuild/tests/replay.ts freeze --browser=chrome
# while working
bun rebuild/tests/replay.ts check --browser=chrome            # or --browser=all --config=all
```

- `check` reports per case: the same; *prediction changed*, with the first differing field, grouped by field and family and
  by the case's statuses in the ledger; *questions changed* (the same prediction from other questions); *new question* (the
  library asked Canvas or a segmenter something the record doesn't hold: a changed measuring recipe). It writes the report
  and `<report>.needs-browser.ids`.
- *Questions changed, by kind* (research/ARCHITECTURE-PLAN-2.md §7; a question is a context and a string). *Repeats only*:
  the same questions, first asked in the reference's order, so only how often one is asked again moved. That is provable
  offline: measuring the same text again on a context returns the same bits in all three engines, and a repeat can't reorder
  two different strings. *Dropped only*: a subset of the reference's questions, first asked in the reference's order, and no
  more contexts; a step accepts it only where it names what it drops. *Other questions*: a question first asked after one
  the reference asked later, a recorded question the reference didn't ask, or another number of contexts; no step accepts
  it, as none accepts a new question. The order is the whole phase's, across contexts, which is stricter than the plan's
  "per context" and costs a pure repeat nothing: WebKit and Gecko keep measured words per font, not per canvas, so two
  contexts taking turns in another order is a reordering of two different strings.
- *Exits*: 0 when every case is the same; 1 when a prediction changed; 3 when none did and every changed case is repeats
  only or dropped only (or the string storage rule below sends cases to tier 2); 4 when none did but a case asks other
  questions or a new one. `--browser=all` exits with the worst, in the order 1, 4, 3, 0.
- *Asked and distinct.* Every report counts, over the cases that replayed, the Canvas questions asked and the distinct
  ones per phase; asked over distinct is the *ask ratio*, the number the re-architecture's X2 watches. At the correctness
  line the library's memo keeps it at 1.00 in Chrome and webkit-host and 1.07 in Firefox (ink-box questions aren't
  memoized): Chrome asks 6.67 M questions for its 66,685 headline cases (100 a paragraph; 6.13 M with the lab's facts),
  Firefox 4.73 M (74), webkit-host 2.04 M (32; 1.23 M with facts), and webkit-host's observation port another 4.77 M,
  2.15 M of them distinct. Planted 2026-09-18, the memo switched off: every changed case is repeats only, no prediction
  moves, exit 3, and the ratios are 10.61 in Chrome (70.5 M asked), 1.72 in Firefox and 3.14 in webkit-host.
  Since the re-architecture's X2 (2026-09-19) no port has a memo, and the values the ports keep instead bring the
  ratios to these (DESIGN.md §4.6, §4.7). Chrome's headline reference asks 68.2 M questions for 6.69 M distinct ones
  (10.19; 11.52 with the lab's facts), and the plain path 250.7 a paragraph for 61.0 distinct (4.11; 240.8 for 48.3,
  4.98). webkit-host asks 5.68 M for 2.04 M (2.79) without facts and 3.83 M for 1.23 M with them (3.12); the plain path
  2.52 M for 1.67 M (1.50) and 1.39 M for 0.79 M (1.75). Firefox asks 7.30 M without facts and 7.38 M with them (1.66
  and 1.67), and the plain path 3.48 M and 3.51 M (1.41 and 1.42).
  Since Blink's X3 (2026-09-19; the two flows X2 took back are in, DESIGN.md §4.7): Chrome's headline reference asks
  49.4 M questions for 6.69 M distinct ones (7.38; 8.46 with the lab's facts), and the plain path 234.3 a paragraph for
  61.0 distinct (3.84; 224.3 for 48.3, 4.64). webkit-host's and Firefox's counts didn't move at X3.
- `check --sites` adds asks and repeats by library call site: the innermost three library frames of the stack at every
  measureText call, read inside the replay's context (`lab/measurements.ts` `SiteTally`), so nothing in `rebuild/src` counts
  anything; `src/measure/canvas.ts` is left out of a site, since every call passes through it. The report's `sites.under`
  counts a call once for every library function on its stack ("how much sits under `lineGaps`"). JavaScriptCore drops the
  frame of a function that returns a call directly, so a site can lack such a caller. With the memo off the top sites are
  `raw16Of < measure16 < pairAdjust16` in Blink (42.3 M of 63.9 M repeats), `w < inWordAdvance` in Gecko and
  `spacedGlyphCount < mergedGlyphs < itemGaps` in WebKit. It takes about half as long again (Chrome's headline reference: 7.5 s, 11.5 s with `--sites`).
  Since X2, with no memo in the ports: Blink's top site is still `raw16Of < measure16 < pairAdjust16`, with 41.5 M of
  61.5 M repeats, and `inspectLine` holds 64.6% of the repeats and `fillLine` 32.1%; Gecko's are the ligature pair in
  its two contexts (`ligatureAcross`, 1.24 M of 2.90 M repeats) and the cluster before an offset alone
  (`inWordAdvance`, 0.81 M), 62% under `inspectLine`; WebKit's is `mergedGlyphs` under `itemGaps` (1.5 M of 3.6 M
  without facts). The X2 sections of specs/blink-RESULTS.md, specs/webkit-RESULTS.md and specs/gecko-RESULTS.md list
  every site. Since Blink's X3 its top site is `raw16Of < measure16 < pairAdjust16` still, with 29.5 M of 42.7 M
  repeats (`raw16Of` is in `engines/blink/contexts.ts` now); `inspectLine` holds 51.7% of the repeats and `fillLine`
  43.5%.
- *The contexts are the replay's own count* of the contexts the prediction made; the library has no log to read. A
  reference is format 2; format 1, which also held the library's memo hits per case, is refused since the
  re-architecture's last step (no frozen reference is format 1).
- *Nothing is written into the replay folder by `check`*: the shards' results and, by default, the report go to
  `rebuild/tests/.check/<browser>-<config>` in the working tree (untracked), so owners in several worktrees who share one
  `.artifacts` can check one reference at the same time.
- *Freezing the questions again.* After a step that changed only questions (exit 3) has passed its browser runs:
  `bun rebuild/tests/replay.ts freeze --browser=<b> --config=<c> --force --questions-only --reason=<why>`. It refuses unless
  every case's prediction is byte for byte the replaced reference's and no case asks a new question, so predictions are
  never frozen again; the manifest's `predictionsFrom` names the commit whose predictions the reference still holds.
- *By rule, to tier 2* (`browser-sets.ts --ids-file=<report>.needs-browser.ids`): cases with a new question (nothing offline
  can answer it); cases whose questions changed (Canvas answers can depend on what a context measured before: Blink caches
  shaped words per canvas); *unfaithful* cases, where `pack` found the replay of the recorded library giving another
  prediction than the browser's own run did (`inputs/unfaithful.json`); and, in Chrome, the *storage-sensitive* cases
  whenever a file that builds the strings Canvas measures (`rebuild/src/measure`, `engines/blink/shape.ts`, and since X3
  `engines/blink/contexts.ts`, which makes the contexts' partitions) differs from the reference's commit. Blink's Canvas shapes an 8-bit string as one Latin segment and segments a 16-bit one, and keys that on
  V8's storage, which follows how a string was built (`canvasString` makes a Latin-1-only string of 13 units or more 16-bit
  by slicing it out of a 16-bit string); no record shows storage and bun has none, so a replay can't differ there. `pack`
  lists the cases that ask a Latin-1-only string of 13 units or more (`inputs/storage-sensitive.ids`: 4,528 of Chrome's
  65,351 then; in the frozen references 4,695 of 66,685 with the lab's facts and 65,384 without, where font check 4 asks
  its 15-unit sample in nearly every case, so there a change to those files sends nearly everything to tier 2). Planted on 2026-09-18: without the slice, all 65,351 cases replay the same, `check` exits 3 with the 4,528 cases
  for tier 2 (where this change moved no status). On the six recordings of 2026-09-18 no case is unfaithful: all 380,882 replay
  exactly, the question sequences included, so nothing the library reads from its host outside Canvas and the segmenters
  (Unicode property escapes in `src/paint.ts`, case mapping, `Intl`) shows a difference between bun and the browsers on
  these sets. The list is for a step that means to change no prediction. A case whose prediction changed under the
  same questions isn't in it, so after a merge that changes predictions tier 2 runs the union of the list and the
  report's changed cases (at the fresh-eyes follow-up's merge the list held 47 of the 483 changed ids with facts).
- *Deterministic by construction*: a process replays one group of a set's shards, cut from the manifest alone ("Test
  tiers"), and runs its cases in recorded order, so nothing depends on the core count, on the sets chosen or on what ran
  before; the report lists cases in the sets' order and holds no time. The same tree gives the same report.
- *What it can't cover*: the painter and everything native (tier 2); questions the record lacks, answers that depend on
  the order of questions, and string storage (by the rules above); a library that kept Canvas answers across paragraphs would ask less in a
  browser document than in a replayed case, and would show as new questions (today no Canvas answer outlives a prepared paragraph);
  dictionary-segmenter scripts replay as long as the library segments the same strings; giants.
- *A reference is never overwritten silently.* `freeze` refuses an existing reference without `--force` and
  `--reason=<text>`, refuses files that differ from HEAD under `rebuild/src`, the predictors, the font facts and the
  observation ports without `--allow-dirty`, and the manifest keeps the record of every reference it replaced. It is a
  change detector, never an oracle: its expected values are the library's own at one commit, which is why it sits outside
  the independence rule's layers (rebuild/TESTS.md §11) and gates nothing on its own.
- Validated 2026-09-18 on Chrome's reference: a planted one-line engine change (`canFitOnLine` without Blink's one
  LayoutUnit, `line-breaker.ts`) gives 139 changed predictions (100 first differ at `layout.lines[].end`, 38 at a gap, 1 at a
  fragment), 149 cases with other questions and 1,440 with a new question, exit 1; routed to tier 2, the 1,692 cases show
  4,069 transitions from pass. The same test written another way (`position - 1 <= availableWidth`) gives 65,351 of 65,351
  the same, exit 0. `rebuild/tests/replay.test.ts` runs the whole loop in bun against a fake Canvas.

### Tier 2: the sets in a pinned browser

`browser-sets.ts` (its header has every option) reads the build of the app it will launch and refuses before any browser
time when the reference ledger was observed under another build; runs every part as a job under the lock, three at a time
(don't wrap it in the lock); scores each part with `score.ts`; builds the run's ledger; prints the transitions against the
reference ledger; and checks the runs against the build-keyed seed through `gate.ts`'s rules.

- *Forward order for iteration, both orders on request* (`--both-orders`). A forward-only ledger takes the reference's
  history-dependent cases (`historyCarried`), and the gate takes the seed's, so a known history-dependent case never shows as
  a regression. A case that is history-dependent and unknown to the reference can: run both orders, or the isolation
  protocol (`sharded.ts --isolate --ids=...`, "Sharded runs and isolation"), before calling it one.
- *A both-orders ledger takes them too* (since 2026-09-19, f072dc4). `browser-sets.ts` always hands the reference ledger
  to `ledger.ts --carry-history-from`, and a both-orders ledger adds the reference's history-dependent cases to its own
  finding. One Firefox process has two fallback-font states, and a single both-orders run can land in one state in both
  orders: the recording after correctness round 5 read 74 known history-dependent cases as passes with facts, and would
  have frozen them as passes. What is known to depend on history stays known until a ledger is built without the option;
  the run's own finding is kept beside it as `ledger-own-orders-only`.
- *Seeds*: `--both-orders --seed --staging=<dir>` stages `<browser>-<engine build>-<config>.json` with its seed record, never
  over the adopted file. The adopted seeds are in `rebuild/tests/baselines/sets/`, six files under scorer 7 with their seed
  records, seeded from the recordings the references are frozen from ("Seeds go to a staging folder", "Adopted at the
  correctness line"); without `--baseline` a run is checked against the one of its browser build and configuration. The
  gate keys on case ids alone, so an id two sets share counts as passing only where every set passes it; the ledger keeps
  them apart.
- A failed job is never run again: the command stops and names its log, and `--rerun-failed` runs the failed jobs once
  after the cause is fixed. Jobs that finished are kept, so the command resumes.
- `--measure-first` runs every job under `run.ts --measure-first` ("Measure first"). The protocol is part of the ledger, so
  the transitions against the reference are printed across protocols, knowingly, and the gate doesn't run.
- The rule families' facts and coverage layers stay in `rebuild/tests/gate.ts` (rebuild/TESTS.md §9); tier 2 is about the
  sets' statuses.

### The ledger

`ledger.ts` keeps, for every set and case and each of the four metrics, one status from a closed set: `pass`; `fail covered
by <conditions>` (the covering gaps, and for the painter the library's limits as `limit:<name>`); `fail open`; `residual
<class> (probed|signature)`; `history-dependent` (the scorer observed other native layouts);
`prediction-order-dependent` (equal native layouts gave different kinds of metric status); `protocol row`; `unobserved` (the scorer's unobserved and not-applicable). The header
records the browser and its build, the configuration, the scorer, the evidence runs' environments, the library bundles the
jobs ran (one, or the command says the library changed mid-run), whether both orders ran, and per set its protocol and the
runs that are its evidence (run ids, `run.json`, per-case files).

**The exact-value status** (format `pretext-ledger/3`) sits beside the four metrics and is part of none: whether every value
the observation port reports as predicted equals the browser's. The values are the scorer's per-case facts: the rect count
of every code point, node and element, predicted by definition, and the x and width of every rect in the predicted state;
limited values are stand-ins and never count. Its closed set is `exact`, `not exact (values <n>, rect counts <m>)` with the
two numbers in the entry's `differing`, `history-dependent` (other native layouts), `prediction-order-dependent`
(different exact-value results on equal native layouts, including two not-exact orders with different tallies),
`protocol row`, and `unobserved` where the scorer compared nothing. A metric can pass over a
wrong predicted value (a width inside a line whose sum holds, an x that moves no break), which is why the status exists:
research/ROUND4-CRITIC.md planted one regression per engine that tier 1 caught and tier 2 didn't, 0 lost passes in Chrome
and Firefox while passing cases with a wrong predicted value went from 0 to 57 and from 0 to 5 with the lab's facts. Read
through this status, the same runs give 61 and 5 blocking cases with facts, 10 and 0 without. Firefox's 0 is what the
other configuration is for: without facts `optical-size` limits nearly every Firefox line, and the change shows only as
limited values that stopped agreeing, which an entry keeps as `limitedDiffering` and `transitions` prints as a sum with the
cases where it rose (0 to 89 there), never blocking. No metric's meaning changed. The header counts the statuses, the
compared and differing rect counts and predicted values, and the not exact cases none of whose lineCount, breaks and widths
fails (REPORT.md's "passing cases with a wrong predicted value", and the same for rect counts).

```sh
bun rebuild/tests/ledger.ts transitions <before ledger dir> <after ledger dir>    # grouped by metric, transition and family
bun rebuild/tests/ledger.ts conditions <ledger dir> --groups=development           # firing, lift, weak coverage
```

`transitions` lists every change of status, so a failure that was never in scope is visible when it moves (`fail covered by
in-word-prefix -> fail open`, `fail open -> pass`), and exits 1 when a pass became anything but a protocol row. Newly
observed native history therefore cannot silently remove a passing obligation. Known native-history exclusions stay
visible and non-gating. The exact-value status moves the same way under `exact:` (`exact -> not exact (values 11, rect
counts 0)`), and exits 1 when an exact case became anything but a protocol row, or a case that wasn't exact holds more
differing values or rect counts. Newly acquiring `prediction-order-dependent` also blocks, even on an already failing
case. Missing reference cases in a selected complete set also exit 1; intentionally focused subsets and unselected
sets do not require those omitted cases. Its entry's `predictionOrderDependent` keeps the actual forward and reverse statuses; no invented combined tally
replaces either observation. The header's compared-value totals cover stable exact and not-exact cases; unstable cases
are counted separately. Tier 2 exits the same. A ledger of the older format is refused: build it again from its runs
(`ledger.ts build --runs=<dir>`), whose per-case files hold the facts. It refuses, by name, ledgers of another browser, build, process languages, scorer, configuration or protocol;
`--allow=<name>` accepts one knowingly. The reference ledgers sit beside the references (`.artifacts/tests/reference/
<browser>-<config>/ledger`), copied by `pack` from the recording and pinned by hash in the repository's manifest.

**Migrating the native comparison and order evidence, 2026-09-20.** Scorer 8 compares the complete native scorer
view, including collection lengths, element rects and slot floats. Re-score the stored forward and reverse rows with
`--native-compare`; no browser recording is needed to correct these classifications. Ledger format 3 refuses older
ledgers: rebuild them from those per-case files before carrying history or repinning ledger hashes. Review newly found
native-history exclusions rather than adopting expanded exclusions automatically. Existing browser observations and
Canvas answers remain evidence; this migration does not certify a previously failing prediction as correct.

The migration command stages new per-case scores, summaries and a ledger without altering observations, pins or seeds:

```sh
bun rebuild/tests/migrate-ledger.ts --from=.artifacts/tests/reference/chrome-no-facts/ledger \
  --source-root=/Users/chenglou/github/pretext-rebuild-wt/prof-merge \
  --out=.artifacts/tests/migrations/<name>/chrome-no-facts --native=full --plan
# Remove --plan to score. --sets=smoke-hand selects a small first step; omit it for the full reference.
```

`--source-root` is the checkout that wrote the old evidence paths, not today's checkout: the frozen ledgers contain
producer-relative paths such as `../../pretext-rebuild/.artifacts/tests/runs/...`. `--plan` validates every source part
and prints byte counts and scoring jobs without creating output. Each scored order compares the full native scorer view
with its recorded opposite order; neither an unchanged prediction nor a favorable isolated rerun establishes native
stability. Both orders must exist, every selected set keeps its case population, and the output must be a new folder.
`migration.json` records source ledger hashes, source run and row hashes, the scorer hash, selected sets and elapsed time.
It lists changed statuses, new native-history exclusions and prediction order dependence, and exits 1 when review is
required. It never adopts an expanded history set. The new per-case files keep each native difference's reason.

For legitimate native history demonstrated by an older recording, first migrate and review that recording, then supply
`--carry-native-from=<reviewed format-3 ledger>`. Legacy history cannot be carried: it mixed native and prediction
instability. A single two-orders recording can still miss a browser process state; the absence of a difference in that
recording does not refute prior demonstrated native dependence.

After reviewing the staged classifications, adopting this metadata affects only the reference's `ledger/ledger.json`
and `ledger/entries.ndjson`, `ledger.headerSha256` and `ledger.entriesSha256` in its `reference/manifest.json`, and the
same two hashes in `rebuild/tests/reference/<browser>-<config>.json`. Preserve the recording commit, input hashes,
Canvas answers, browser/replay prediction shards and their hashes; do not re-freeze predictions to accept a classification
change. Stage scorer-8 gate seeds from the reviewed scores, compare their lost and newly history-obscured obligations
against the existing seeds, and adopt only after review. Their environment keys change from scorer 7 to scorer 8.

### False regressions, by construction

| Source | What handles it | Test or check |
|---|---|---|
| Page-history dependence | both orders mark it; a forward-only ledger and the gate carry the known cases; the isolation protocol settles disputes | `rebuild/tests/ledger.test.ts` (carried history), `gate.test.ts` |
| A browser or OS build moves | pinned copies of Chrome and Firefox; tier 2 refuses before running, `transitions` and the gate refuse by environment | `rebuild/tests/browser-sets.test.ts`, `ledger.test.ts`, `gate.test.ts` |
| The run protocol moves (parts, cases per round trip, order) | fixed in `sets.ts`, recorded per set in the ledger, refused when it differs | `rebuild/tests/sets.test.ts`, `ledger.test.ts` |
| Protocol rows | a status of their own, never a pass or a fail; never passes of a seed | `score.test.ts`, `gate.test.ts`, `ledger.test.ts` |
| Another scorer | part of every environment key and of the ledger's header; refused | `gate.test.ts`, `ledger.test.ts` |
| The library changed during a run | `bundleSha256` per job; `sharded.ts` refuses mixed shards, tier 2 exits 2, `pack` refuses | `ledger.test.ts` |
| A fresh or sealed set drawing used ids | `cases/used-ids.ts`, which also finds case files named by a worktree that is gone; tier 2 names shared case files by their real paths | `cases/parts.test.ts` |
| Compressed rows looking like a missing run | `rows.ts` | `rows.test.ts` |
| Host differences between bun and a browser (tier 1) | `pack`'s fidelity check; unfaithful cases always go to tier 2 | the six recordings: none |
| The lab predicts after native layout, an application before | `--measure-first` with `compare-sets.ts` ("Measure first") | 2026-09-18: Chrome and webkit-host move nothing; Firefox moves 121 emoji cases, 116 of them known history-dependent |
| A class left open on purpose moves | the known tail names it on the transition ("The known tail") | `rebuild/tests/known-tail.test.ts` |
| A predicted value goes wrong where every metric still passes | the ledger's exact-value status, in both configurations | `rebuild/tests/ledger.test.ts`; the critic's planted runs read again: 61 and 5 blocking cases with facts |

### Checks for the re-architecture

Step 0 of research/ARCHITECTURE-PLAN-2.md (§7, §8) adds what the tiers can't say of a rewrite that must not move a
prediction. One command each; every one was run against a planted violation and against the clean tree on 2026-09-18
(what was planted is beside each). Reports and scratch go to `rebuild/tests/.check`, never into the shared replay folders.

| Check | Command | Fails when |
|---|---|---|
| Changed questions, by kind (the plan's exit 3 rule) | `bun rebuild/tests/replay.ts check --browser=all --config=all` | exit 4: a case asks a new question or other questions; exit 3 is read against what the step may accept ("Tier 1: offline replay") |
| 1. Plain equals inspected | `bun rebuild/tests/function-set.ts plain --browser=all --config=all` | a plain paragraph's fill results or pieces differ from the inspected one's, it asks a question the lab's path didn't, it makes more contexts, or `inspectLine` answers on it; a case whose first asks come in another order than the lab's passes and is counted |
| 2. Purity | `bun rebuild/tests/function-set.ts pure --browser=all --config=all` | `linePieces` or `inspectLine` gives another result the second time, or when the other ran first |
| 3. Width sweep on a stand-in Canvas | `bun rebuild/tests/function-set.ts sweep --browser=all --config=no-facts` | one prepared paragraph filled at other widths first differs from a paragraph prepared for that width alone |
| 4. Ask ratio and sites | `bun rebuild/tests/replay.ts check --browser=all --config=all --sites` | never by itself: it reports asked, distinct, the ask ratio, and asks and repeats by call site |
| 5. Coverage map | `bun rebuild/tests/coverage-map.ts` | never: it lists the lines of `rebuild/src` no replay runs, per engine |
| 8. Independence | `bun test rebuild/tests/independence.test.ts` (in tier 0) | a shared file names an engine outside the listed exceptions (none since step 3), an engine imports another, the lab imports library logic outside its adapter |
| Line ranges against layouts | `bun rebuild/tests/compare-sets.ts <plain predictor's run> <usual run> --prediction=line-ranges` | exit 1: a line range differs or a row is missing; exit 3: only native observations differ |

Checks 6, 7 and 9 (the citation ledger, the painter differential, the twin family) are the tools owner's, under
`rebuild/tools`. Check 9's scan (`bun rebuild/tools/twin-scan.ts --cases=<cases.ndjson>[,<more>]`, offline on the stand-in
Canvas) counts the cases where the Blink port asks one context the same characters as a one-byte and as a two-byte
string; since the string storage fix it is a tripwire: 0 on every set (at the merge 0 of the 67,072 case lines of Chrome's
set files, 377 of which ask a two-byte slice at all, 281 of them in `twins`; at the line 166 of the 380 `twins` cases held
such a pair). Since Blink's X2 the scan named a context by its place in the prepared paragraph's `canvases`, where it
used the measurer's index; since the profiling phase's item 1 it names it by the object it is, since a page's list can
be emptied between two cases (`--page` scans a case file as one page with one list). With `contextsOf` planted to give
one set of contexts it finds 166 of the 380 again. Check
7, the painter differential (`bun rebuild/tools/painter-diff.ts check --browser=all --config=all`), is the offline check
that reads `overflows` and the engines' paint facts, which tier 1 can't see: at the painter step it was byte-equal on
389,646 of 389,646 cases against the painter of 81fd07d, and a planted flip of `overflows` in the adapter exits 1 with
the differing cases. It paints a row offline only where the row's layout equals the frozen reference's byte for byte. So
with Blink's canonical gap lists (X3) and the references of X2 it exits 3 for Chrome: 0 paintings differ, and 473 rows
without facts and 303 with them aren't painted. Tier 2's painter observations cover those rows, and the differential's
frozen side is bundled again with Chrome's new references. Blink's painter change of X3 alone, on the clean-up commit,
is byte-equal on all 67,065 Chrome cases of both configurations.

- **Checks 1 to 3 wait for the function set** (`prepare(paragraph, env, inspect)`, `firstLine`, `fillLine(prepared, start,
  { width, left, right })`, `linePieces`, `inspectLine`; the plan's §5.6), which step 1's S3 exports from
  `rebuild/src/index.ts`. Until then each says which names are missing and exits 5, never 0; `--library=<module>` names
  another module that exports the set. They read the replay folders' inputs, shard by shard like tier 1. Each lays a case
  out once through the lab's predictor and takes the paragraph and the environment from that prediction, the width and
  the slots' insets from the case. Results are kept as JSON at the call, since a result can share its arrays with the
  decided line. *Plain* replays the record and reports the plain path's asked and distinct questions, their ratio, and
  the cases whose first asks come in another order than the lab's.
  *Pure* reads each line's pieces, inspection, pieces and inspection, then a second paragraph inspection first. *Sweep*
  can't replay (another width asks questions no record holds), so it runs on `rebuild/tests/stand-in-canvas.ts`, a
  deterministic Canvas: advances from the font string and the code point, kerned pairs (a string isn't the sum of its
  parts), U+200D changing its neighbours' widths, letter spacing per character (1/64 px exact; Gecko's 0.001px adds
  nothing, as its Canvas rounds to app units), word spacing, an ink box; it fills at half, three quarters and one and a half
  times the case's width and then at the case's own, plain and inspected. The three ports lay the hand-written smoke
  cases out on it in tier 0 (`stand-in-canvas.test.ts`). *Proved* with a toy function set recorded and replayed in tier 0
  (`function-set.test.ts`: 9 planted sets, each caught by name, the clean one silent), and end to end over the line's
  library through a scratch module that made the set from `prepareParagraph` and `layoutLine`: the three checks passed on
  the 80,403 headline cases of the smoke and development sets in the three browsers' inputs (the sweep asks the stand-in
  123 M questions), and five plants (other `align` on plain, `inspectLine` answering on plain, `linePieces` writing into a
  fragment, `inspectLine` flipping `indented`, a prepared paragraph kept from the first width) fail every case they touch.
  Since the re-architecture's S3 `rebuild/src/index.ts` exports the set, and the three checks pass on every case of the six
  references (389,646 cases in all; the sweep asks the stand-in 263 M questions).
- **The plain check since X1** (2026-09-18; the header of `rebuild/tests/function-set.ts`). All three ports compute their
  gaps on request, so the plain path asks less than the lab's: Chrome 61.18 questions a paragraph against 99.97 without
  facts and 48.49 against 91.91 with them, webkit-host 26.14 against 31.81 and 12.38 against 19.18, Firefox 40.7 against
  74.2 and 40.8 against 74.5. The check fails on results that differ, on a question the lab's path didn't ask and on more
  contexts. It no longer fails on order, as tier 1 does: a case whose first asks come in another order than the lab's
  passes and is counted (at the X1 merge Chrome 26,035 without facts and 21,826 with, Firefox 11,418 and 11,422,
  webkit-host 1,174 and 1,218). No path that asks less can keep the lab path's order: the lab's path asks inspection's
  questions between two fills, so a later fill's repeat of one is a repeat there (a memo hit until X2) and a first ask
  on the plain path, after questions the lab's path asked later. What a canvas makes of the plain path's order no
  offline check can say. The plain predictor's browser run covers it ("Line ranges against layouts" below), as part of
  every milestone that changes the plain path's questions. Since X2 the plain path asks 250.7 questions a paragraph
  without facts in Chrome and 240.8 with them, 39.32 and 21.65 in webkit-host, 54.5 and 55.1 in Firefox: what rose is
  repeats, questions asked again where the memo used to answer.
- **Changed questions.** Planted in a scratch clone: the memo off gives 66,079 Chrome, 54,659 Firefox and 61,068
  webkit-host headline cases repeats only, exit 3; WebKit's history worlds without their discarded gap work give 214
  dropped only and 18 other questions (a question the world asked first is now first asked later), exit 4; the font checks'
  old context gives new questions in every case, exit 4; `canFitOnLine` without its LayoutUnit gives 127 changed
  predictions, 69 other questions and 1,444 new questions, exit 1; the same test written another way, exit 0.
- **Coverage map.** Per browser it replays every shard of both configurations under `bun test --coverage`
  (`coverage-map.shard.ts`) and merges the lcov records: a line ran when any shard ran it. `rebuild/tests/coverage-map/
  <engine>.txt` holds the maps of the re-architecture's last step (a059ef2; the correctness line's are in the history):
  the port's own folder and the shared files, as ranges with the function each starts in. Blink: 47 of 4,088 measured
  lines of the port never ran; Gecko 123 of 3,399; WebKit 111 of 4,062 (at the line 39 of 3,873, 122 of 3,238 and 148 of
  3,623); of the shared files 36%, 55% and 46%, most of it the painter, which needs a DOM, the algorithms another
  engine's browser runs, and in Firefox the font checks, which learn nothing there. A tracked map goes stale with every
  change to a port; the command makes it again. About a minute for the
  three. Lines, not branches: a line ran when any part of it did. Lines that hold no code are left out, because bun lists
  them unevenly (`coverage-map.ts` `addLcov`). A planted branch and a planted function that nothing calls are listed.
- **Independence** is a tier 0 test. The shared layer's rule (no import of `engines/`, no `'blink'`, `'webkit'` or `'gecko'`
  string, no identifier holding such a name; comments never count, the TypeScript parser drops them) holds outside
  `SHARED_FILES_THAT_NAME_ENGINES`, which listed ten files with 175 mentions at the correctness line, listed `paint.ts`
  alone after step 1's S2 (74 mentions), and is empty since step 3, when the painter took each engine's rules as data; a
  count may only fall and an entry that no longer matches fails too, so a new exception has to be written down.
  `src/index.ts` and `src/env.ts` are the two shared files that may name engines, and test files are left out. Planted: a string and an identifier in
  `content.ts`, an import of Blink's shaper into WebKit's style, an import of `src/index.ts` into `lab/rows.ts`; each named.
- **Line ranges against layouts** is for X1's gate and for every later milestone that changes the plain path's questions,
  since it is what covers their order: `browser-sets.ts --predictor=rebuild/lab/baselines/plain-predictor.ts
  --groups=development --out=<dir>` runs the sets with another predictor (scored, with no ledger, transitions or gate), and
  `compare-sets.ts --prediction=line-ranges` compares its rows with a usual run's: a `LinesPrediction`'s lines against the
  layout's lines that have a line box, which are the lines `score.ts` counts a `LinesPrediction`'s against, so the plain
  predictor lists those; start and end must agree; widths and painted lines aren't compared; native observations are, and
  a difference there alone exits 3, to be read as a history effect of the smaller question set. Run end to end in
  webkit-host on `smoke-hand` and `ws` with a scratch predictor that returns today's layout as line ranges: 1,044 rows,
  nothing differs, exit 0; with the first break moved by one unit: 756 rows differ, exit 1. At X1, against each port's
  usual run (the runs are under `.artifacts/tests/runs/ra-x1-blink`, `ra-x1-gecko` and `ra-x1-webkit`):
  - Chrome, all 67,065 no-facts cases: line ranges equal and 0 native differences, exit 0.
  - Firefox, 63,771 cases: 63,657 equal in line ranges and native observations. The other 114 are in one browser process
    (`suite-sample` part 2) and all already history-dependent in the ledger (`gecko/process-font-fallback-state`); that set
    run again with both predictors gave 0 differences on 19,888 cases.
  - webkit-host, all 63,987 no-facts cases at the X1 merge (`.artifacts/tests/runs/verify-x1-20260918`, beside a tier 2
    run in both orders and both configurations with 0 transitions): 0 line ranges differ; 3 native observations differ,
    exit 3 (`c-1ca0bab9ded7a4c6` and `c-53283654e67b8035` in `rich-prewrap`, `c-7cc5e3e26ff7c30d` in
    `heldout-suite-sample`), all already history-dependent in the ledger. The owner's own run covered the development
    sets, 26,472 rows, with the same result.

  At X2, where the plain path's questions changed by repeats alone (the runs are under `.artifacts/tests/runs/ra-x2-blink`,
  `ra-x2-webkit` and `ra-x2-gecko`):
  - Chrome, all 67,065 no-facts cases: line ranges equal and 0 native differences, exit 0. The other-widths-first
    predictor's 67,065 rows equal the usual run's and the recording the references' predictions come from.
  - webkit-host, all 63,987 no-facts cases: 0 line ranges differ; the same 3 native observations differ, exit 3.
  - Firefox, 63,771 cases: 63,651 equal in line ranges and native observations. The other 120 are in one browser process
    (`suite-sample` part 2), with fallback-font widths in another state, and line ranges moved with the native lines in
    14 of them. 115, the 14 among them, are already history-dependent in the ledger
    (`gecko/process-font-fallback-state`). The other 5 differ in native widths alone and aren't marked there; the same
    known-tail item names them (it took the item `gecko/plain-predictor-fallback-state` in at X3). That set run again
    with the plain predictor gave 0 differences once and the same 120 once; across X1 and X2 the usual predictor's five
    runs were never in the odd state, and the plain predictor's were 3 times out of 5.

  At X3, a clean-up that changed no question in WebKit and Gecko and only repeats on Blink's plain path (the runs are
  under `.artifacts/tests/runs/ra-x3-blink`, `ra-x3-webkit` and `ra-x3-gecko`):
  - Chrome, all 67,065 no-facts cases: 0 line ranges differ and 0 native observations differ, exit 0.
  - webkit-host, all 63,987 no-facts cases: 0 line ranges differ; the same 3 native observations differ, exit 3.
  - Firefox, 63,771 cases: 63,651 equal. The other 120 are X2's 120 case for case, with the same 14 moved line ranges
    among the 115 marked history-dependent and the same 5 unmarked.
- **Baselines for the tripwire** (X2: tier 2's wall time and the giants stay within 2× these), in
  `rebuild/tests/baselines/times-correctness-line.json`, headline configuration, 2026-09-18, from `rebuild/src` as at the
  correctness line. The giants under the exclusive lock, forward, one case a round trip: Chrome 119 s (the library's
  predictions 49.8 s of it, the observation port 40.8 s), Firefox 15 s (4.2 s), webkit-host 325 s (2.7 s; the port 114 s and
  native layout with its observation 172 s). Tier 2 forward, one browser at a time: Chrome 77 s, Firefox 67 s, webkit-host
  102 s, each with 0 status transitions and the gate passing. Runs: `.artifacts/tests/runs/ra0-baselines`.
  At X2 (2026-09-19) the owners shared the machine, so only back-to-back and exclusive-lock readings count. Chrome,
  this step and its start commit back to back on a quiet machine: the giants' prediction 55.3 s against 49.5 s, tier 2
  forward 82.8 s against 79.3 s; Chrome's per-canvas cache answers a repeat. webkit-host, beside other jobs, so upper
  bounds: tier 2 about 131 s an order, the giants 472 s against 325 s with 4.29 s of prediction against 2.72 s. Firefox:
  tier 2 forward 98 s under load, the rows' prediction time 58.2 s against X1's 55.6 s. **Firefox's giants tripped it on
  the inspected path**: 15.3 s of prediction against 4.2 s (3.6×), because `inspectLine` reads every offset of 18,000 to
  47,000 words and the memo answered a word's later occurrences. Their plain path is 1.28× (4.0 s against 3.2 s), and
  the layouts are equal on all 9. The orchestrator accepted it: the tripped path is the inspected one, and what would
  answer it is a store found by string, which the plan keeps for after profiling (DESIGN.md §4.7).
  At X3 (2026-09-19) other owners' jobs held the load average at 40 to 68, so a single wall time says little; each
  owner ran its pairs back to back and read the rows' own prediction time. Nothing got slower. Chrome: the giants'
  prediction 78.4 s against the start commit's 113.6 s under equal load (77.5 s for the clean-up alone), and tier 2
  forward at a load average of 7, 88 s against 89 s with 73.8 s of prediction against 80.5 s. webkit-host: the giants'
  library prediction 2.22 s against 3.41 s and forward tier 2's 21.4 s against 32.2 s; native observation, which the
  step doesn't touch, carried the wall time the other way (giants 659 s against 487 s), so a wall-time comparison on a
  quiet machine is still owed. Firefox: a first pair of single runs differed 1.6 times, with the lab's own native step
  as much slower in the same run, so the owner ran alternating pairs under the exclusive lock: the giants' lab path
  13,129 and 12,678 ms against 13,074 and 12,838 ms, the plain path 3,392 against 3,473 ms. One timed run isn't enough
  on a shared machine; alternating pairs settled it.

### The known tail

`rebuild/tests/known-tail.json` lists the classes deliberately left open when the correctness line is frozen: convertible
classes under gaps, conditions that only diagnose, open rows with a traced cause Canvas can't settle, the residual classes,
history dependence, heuristics, painter exactness, browser bugs, rare scripts and the lab's own limits. Each item has an id
(`<engine or area>/<short-name>`), a kind, a title, the conditions its rows sit under today, the named cases that show it
with where each was found (a tier set, a fresh seed, `triage`), a source (documents, probes, source lines) and a note on what
would convert or reopen it. An item can also have a `match` rule over a tier 2 ledger: browsers, a status kind (`covered`,
`open`, `residual`, `history-dependent`, `unobserved`), the conditions a covered failure lists, family prefixes, metrics
(without them a rule reads lineCount, breaks and widths, never the painter) and configurations. A rule over `not exact`
reads the exact-value status instead of a metric and needs family prefixes (the rect counts of `rule/wbr-elements`). A rule
keeps a class of a thousand rows to one item.

```sh
bun rebuild/tests/known-tail.ts status <ledger dir> [--item=<id>] [--all]   # where every item's cases stand in a ledger
bun rebuild/tests/known-tail.ts add --from=<items.json>                     # validate and append an item or an array of items
bun rebuild/tests/known-tail.ts check                                       # validate the file (known-tail.test.ts runs it)
```

`ledger.ts transitions` and tier 2 print, after the transitions, the ones on known-tail items: per item, `metric: before ->
after` with the case ids, for every case that belongs to the item by its status before or after. So a change that moves a
class left open on purpose shows by the item's name, whether cases left it, entered it or moved inside it, and
`transitions.json` holds the same under `knownTail`. To append, write the item as JSON and run `add`, or edit the file and
run `check`; case ids from fresh sets are in no ledger and only document the class. Round 4c added 4 items for the
`rich-prewrap` set's open row, its lab limits and two WebKit rows `page-history` covers by position. The first 41 items came from
research/ROUND3-CRITIC.md's convertible classes and unneeded conditions, the round 4a reports' open items and this round's
measure-first check. At the freeze the file took what research/ROUND4-CRITIC.md found understated, from the frozen ledgers
and the critic's fresh set (62 items, 589 named cases, 24 rules): rect counts that differ in cases whose prediction metrics
pass (Chrome's 404 by a `not exact` rule over `rule/wbr-elements` and 12 named cases, webkit-host's 30 by name), the x after a
U+FFFC cluster reported as predicted (14 cases), Firefox's 209 history-dependent fresh cases against 0, the 82 fresh WebKit
cases that fail in both orders and pass alone, the wider signature of Chrome's hang, `src/paint.ts` outside tier 1, one Mac
at DPR 2, and the traces of the half-width ideographic full stop and of WebKit's inline box width a float32 step off.
After the line the Blink string storage fix added 3 named cases to the U+FFFC item (the x of U+FFFC itself, in the facts
configuration) and one painter item for the 2 open painter rows of `twins` (63 items, 594 named cases). At the X2 merge
that painter item's note took its root cause (an RTL block enables bidi in Blink, so the painted line's brackets take
script Common), and one history item was added for 5 Firefox `suite/measurement` cases whose native widths differ under
the plain predictor without being marked history-dependent (64 items, 599 named cases). At the X3 merge that painter
item is closed: Blink's painting rule segments a painted line by script when its block is RTL, and the two rows are
`fail covered by limit:script-at-line-start` in both configurations. A closed item stays in the file: its title says it
is closed and at what, its note starts with "Closed on" and the date and says what would reopen it, and its conditions
say what its rows sit under now. The 5 Firefox cases went into `gecko/process-font-fallback-state`, which already named
them as moved by measure first, so one item carries both findings (63 items, 594 named cases). Correctness round 5
added 4 Gecko items and 189 named cases (67 items, 783 named cases). `gecko/contextual-joined-forms` names the 72 true
passes of main that Canvas can't settle and the 14 cases lost since round 2 (78 cases), `gecko/pair-same-face-refused`
the 4 cases the same-face test refuses, `gecko/pair-placement-one-way-per-face` the one inference the pair recipe
keeps, and `gecko/nbsp-first-family-apple-color-emoji` a boundary U+00A0 under an emoji-first list.
`webkit/page-history` names 20 more of the 21 main-only list cases that fail in the list's long document and pass alone.
`gecko/process-font-fallback-state` names the 87 `heldout-suite-sample` cases that both-orders runs of the round read
as going from history-dependent to pass (74 without facts, all among the 87 with them): that browser process has two
states, a plain predictor run an hour later landed in the other one on exactly those 74, and a pass in one recording
isn't stable. They are named because a ledger that marks them as passes drops them from the item's rule; a named case
that later leaves a pass still shows as a transition on the item. At the fresh-eyes follow-up
`lab/blink-rect-of-a-span-holding-only-a-trimmed-space` is closed: the missing rect was the engine port's, not the
observation port's. Blink gives a box fragment to a span that holds nothing but empty items and a collapsible space
(`InlineItemsBuilder::ExitInline`), and the port culled it. With the rule ported, all 36 named cases pass line count,
breaks and widths in pinned Chrome in both configurations (`.artifacts/lab/fu-blink`), and the class's one tier case,
`c-a37545c096e939be`, went from `fail open` to pass in the recording at the merge. The painter still fails the
review's fresh case `c-d600d9b01c0ae9d7` without an explanation (a collapsible space of a `white-space: normal` span
hangs at a line end in a pre-wrap block, and the line painted as its own block loses it), so
`painter/without-explanation` names it (67 items, 784 named cases). The final evaluation's one hanging Chrome case, `c-a948c5abca7d9a92`, is named under `blink/range-rects-hang` (research/FINAL-EVALUATION.md), which makes 785.

## Running

Every command that drives a browser runs under the shared browser lock. `run.ts` doesn't take the lock itself:

```sh
python3 .artifacts/session/with-browser-lock.py lab-chrome -- \
  bun rebuild/lab/run.ts --browser=chrome --cases=rebuild/lab/smoke-cases.ndjson --out=.artifacts/lab/smoke
bun rebuild/lab/score.ts --rows=.artifacts/lab/smoke/chrome-rows.ndjson --cases=rebuild/lab/smoke-cases.ndjson \
  --out=.artifacts/lab/smoke/chrome-summary.json --examples=10 --per-case=.artifacts/lab/smoke/chrome-per-case.ndjson
```

`run.ts` options: `--browser=chrome|safari|firefox|webkit-host`, `--cases`, `--out`, `--limit=N`, `--family=substring`,
`--chunk=N` (cases per round trip, default 25), `--stall-ms=N` (fail after this long without page activity, default
120000), `--predictor=<file>`, which bundles another module in place of `predictor.ts` for experiments, and
`--order=file|reverse|shuffle:<seed>`, the order the selected cases run in (default `file`; see "Page-history
dependence"). `--allow-safari-frontmost` (Safari only, no value) skips the wait for Safari to leave the front
(approved by the maintainer on 2026-09-16); the lab window then opens over the user's windows. `--predict-only` (no
value) skips native observation: rows keep their format with `native: { skipped: 'predict-only' }`, the predictor and
painter still run, and `run.json` records `predictOnly` and `totals.skippedNativeRows`. Score such rows with `score.ts
--native-rows`. `--chrome-apple-languages=<tag>[,<tag>...]` with `--chrome-accept-languages=<list>` (Chrome only, both
together) launch Chrome under other languages than this Mac's (see "Browser-process languages"). `--part-cases=N`,
`--part-ms=N` and `--parts-from=<run.json>` cut the run into parts, each in a fresh browser process (see "Parts").
`--record-measurements` (no value) stores every Canvas call of every case beside the rows (see "Recorded measurements").
`--measure-first` (no value) predicts every case of a document before the document's first native layout (see "Measure
first").

Before launching, it reads the build from the app bundles, because user agents can't tell builds apart (Chrome's says
`153.0.0.0` for every 153 build): Chrome's and Firefox's `CFBundleShortVersionString`, which are also the engine builds;
Safari's, with WebKit.framework's `CFBundleVersion` as the engine build, for Safari and for webkit-host, whose user agent
copies installed Safari's version; and the OS build from `sw_vers -buildVersion`. Every row carries it as `build`, and the
page gives the engine build to the predictor. Every row also carries `languages` (see "Browser-process languages"). It
writes `<out>/<browser>-rows.ndjson`, one row per case, and `<out>/<browser>-run.json` with the app it launched (`app`: the
bundle path, whether it is a pinned copy, and the copy's tree hash), the build, the languages, `bundleSha256` (the sha256
of the library bundle the pages ran: two runs' rows come from the same library when these agree), totals, the case order,
the parts, page contexts, the environment, the languages pages report and errors. It exits nonzero when
anything goes wrong: invalid cases, a launch or page failure, a stall, a native observation error, a missing row, a user
agent that doesn't name the build read before launch, Chrome renderers without one agreed `--lang`, or a change of user
agent, DPR, visual-viewport scale or reported languages during the run. A prediction error is a result, not a lab
failure.

## Browser sessions

Sessions stay in the background and never activate a window.

- Chrome: the lab's pinned copy of Chrome ("Pinned browsers"), headed, in its own `--user-data-dir` under
  `.artifacts/profiles/`, started with `open -n -g -a` and `--no-startup-window --remote-debugging-port=0
  --disable-updater-scheduler`, plus `-AppleLanguages` and a
  `Default/Preferences` file with the accept languages (see "Browser-process languages"). Headless Chrome can lay out at
  zoom 1 while reporting DPR 2. Chrome activates itself whenever it shows a window the normal way, `open -g` or not (a
  startup window took focus for half a second), so the driver opens the lab window with the DevTools protocol's
  `Target.createTarget { newWindow: true, background: true }`, which Chrome shows inactive. It uses the protocol for
  nothing else.
- Firefox: the lab's pinned copy ("Pinned browsers"), headed, in its own profile under `.artifacts/profiles/`, started
  with `open -n -g -a <copy> --args --new-instance`, with its language prefs and `app.update.auto` false in `user.js`. macOS 27 blocks a shell-spawned Firefox from its data folders,
  and headless Firefox draws emoji at odd widths.
- Safari: a single-tab window in the user's Safari, created through AppleScript without activating it
  (safaridriver doesn't work on macOS 27). A new document in a frontmost Safari opens over the user's windows and
  takes keyboard focus there, so the driver first waits, for at most 10 minutes, until Safari isn't the frontmost
  app, then exits with an error. `--allow-safari-frontmost` skips that wait. If Safari takes focus anyway, the driver
  gives it back to the previously frontmost app. Closing removes only that uniquely identified tab. A window opened
  behind the frontmost app's windows is occluded, so WebKit hides the page and drops its foreground activity, and the
  WebContent process gets suspended once no activity is left (PageClientImplMac.mm `isViewVisible`, WebPageProxy.cpp:3733-3742,
  ProcessThrottler.cpp:240-249, :360-395). That stopped round 1's installed Safari run at 1,585 rows. A page that is still
  loading keeps a background activity (NavigationState.mm:1630-1656), and a frame keeps loading while a request it
  started before its load event is pending (DocumentLoader.cpp:1701-1723), and a page that changes its title more than 5 s
  after its committed load keeps one until the next commit (WebPageProxy.cpp:9250-9270). So Safari's lab markup holds a
  hidden image open (`/api/hold`, the server with `idleTimeout: 0`); the page asks `/api/hold-ready`, which answers 6 s after
  the document was served, changes its title, and releases the image (`/api/hold-release`). The load has to end before
  measuring, since `document.fonts.ready` waits for the load event (FontFaceSet.cpp:269-280). Nothing is activated or
  brought to the front. The first 4,000 `dev-all` cases ran to the end with every row hidden (WEBKIT-HOST.md). The hold
  covers jobs of a few minutes: in the ceiling round 2 evaluation the combined development and family files finished hidden
  (105 s to 304 s a job), and the held-out file, which runs one case per round trip and starts with corpus paragraphs that
  take about 5 minutes each in a hidden page, stopped three times and failed at 7,863 of 15,205 rows. Read from source, not
  from Safari's logs: a WebContent process without a visible page has its CPU use averaged over 8 minutes against the
  client's limit (WebProcessCocoa.mm:220, :1180-1205), and past it the UI process drops every activity and suspends it
  (`WebProcessProxy::didExceedCPULimit`, WebProcessProxy.cpp:2360-2395); the page keeps its invalid title activity until
  the next commit (WebPageProxy.cpp:9266-9268), so from then on it is suspended like any hidden page, about 20 s plus 4
  minutes after it is covered (ProcessThrottler.cpp:49-50). Since ceiling round 3 an installed Safari run goes through
  5-minute parts, each in a new single-tab window with a WebContent process of its own ("Parts"), so no process reaches that
  window. A single chunk that takes longer than 8 minutes still would: keep giants out of installed Safari jobs, or give
  each its own job.
- webkit-host: the system WebKit.framework, which installed Safari runs, in a small WKWebView app
  (`rebuild/tools/webkit-host/main.swift`, built by `build.sh` into `.artifacts/webkit-host/webkit-host`). The driver
  spawns it with the page URL; it doesn't touch the user's Safari. The host never activates (accessory app, no Dock
  icon or menu bar, a window that can't become key) and shows one borderless, transparent, click-through window at
  desktop level, below every normal window, on the menu-bar screen, so the page gets that screen's DPR. WebKit hides
  a page whose window is covered, so the window reports itself visible. The host uses a non-persistent data store,
  records Safari's linked SDK version so WebKit enables the same SDK-gated behaviours, and hides user-installed fonts
  as Safari does, with the one private API it calls (`-[WKPreferences _setShouldAllowUserInstalledFonts:]`). Its user
  agent ends with `Version/<installed Safari's version> Safari/605.1.15 webkit-host/<WebKit build>`. It exits when the
  page's title is `lab done` or when the driver exits, and it logs to the driver's stderr. It takes Safari's cases, but
  rows and files say `webkit-host`, so they never mix with Safari's, and the scorer treats it as Safari.

The page navigates itself. Apart from opening Chrome's window, no remote debugging protocol is used. The driver
closes the browser it opened (Chrome and Firefox get SIGTERM, then SIGKILL; webkit-host gets 2 s to exit by itself
first) and removes their profiles. It launches once and never retries.

## Pinned browsers

Chrome updated itself from 153.0.8010.48 to .50 in the middle of ceiling round 2. So the lab and the probe runner launch
private copies: `~/github/browser-engines/apps/Google Chrome 153.0.8010.50.app` and `Firefox 156.0.app`
(`browser-build.ts` `LAB_APPS`). `bash rebuild/lab/pin-browser.sh chrome|firefox` makes a copy with `ditto`, which clones
the files on APFS, so a copy costs no disk until the installed app changes. It hashes both trees (every file's path and
sha256, every link's target), refuses a copy that differs, and writes the hash beside the copy as `<copy>.tree-sha256`. The
installed apps aren't touched, the copies aren't edited but for Firefox's update policy (below), and both copies launch through `open -n -g -a` like the installed
apps did. `run.json` and the probe outputs record the app path and the tree hash (`app`), and rows keep `build` as before,
so rows of a pinned run and of the installed app at the same build still meet (`score.ts --native-rows` compares `build`).
In the pinned Chrome all 2,580 `runs` cases give the native observations the installed .50 gave in round 2, and the same
holds for Firefox.

- Chrome's updater keeps one path per app id. A Chrome started from another path registers that path 19 s after startup
  (`chrome_browser_main.cc` `PreCreateMainMessageLoop`, `browser_updater_client_util_mac.mm` `EnsureUpdater`,
  `browser_updater_client_mac.mm` `AppMatches`, read at Chromium 152), and the updater would then update the copy and leave
  the installed Chrome alone until it runs again. `--disable-updater-scheduler` skips that scheduling (the switch is in
  153.0.8010.50's framework binary), and both drivers always pass it (`CHROME_PIN_ARGS`). Never start the copy by hand
  without it. After the round's pinned jobs the updater's record still names `/Applications/Google Chrome.app`
  (`~/Library/Application Support/Google/GoogleUpdater/prefs.json`, `updateclientdata.apps`).
- Firefox updates the bundle it runs from. A release build ignores `app.update.disabledForTesting` outside automation and
  takes the `appUpdate` policy only from the bundle or the system (`UpdateServiceStub.sys.mjs` `updateDisabled`, Firefox
  156), so the lab's profiles set `app.update.auto` and `app.update.staging.enabled` to false (`FIREFOX_PIN_PREFS`); on
  macOS `app.update.auto` is an ordinary pref. The probe runner's sessions also run under Firefox's automation prefs.
  Those prefs don't cover a launch under another profile: after a crash on 2026-09-25 macOS reopened the 156.0 copy at
  login under the default profile, and Firefox updated the copy to 156.0.1. So `pin-browser.sh firefox` also writes
  `Contents/Resources/distribution/policies.json` with `DisableAppUpdate` into the copy, and the copy's tree hash includes
  it; the check against the installed bundle leaves it out. The file breaks the bundle's resource seal (`codesign
  --verify` fails), and the copy, which carries no quarantine, still launches through `open -n -g -a`.
- `LAB_CHROME_APP=<bundle>` and `LAB_FIREFOX_APP=<bundle>` name another bundle for one command, to try a new release
  before moving the pin. A new release gets a new copy and a new path in `LAB_APPS` (rebuild/TESTS.md §12). The bundle may
  be a Chrome for Testing build: the driver launches the bundle's `CFBundleExecutable`, and rows record that name as
  `build.app`. Firefox's user agent says `<major>.0` for every build of a major version (140.16.0esr says `Firefox/140.0`),
  so the user agent check compares the major version only. A beta's bundle version has no beta number (157.0b2 reports
  `157.0`); `run.json`'s `app.path` tells it apart. The neighbouring builds of the 2026-09-18 drift check are in
  `~/github/browser-engines/apps/drift/`, with their rows in `.artifacts/lab/drift/`.
- Installed Safari and the system WebKit.framework can't be pinned: they move with macOS.

## Parts

A part is a fresh browser process, and a run can go through several: `--part-cases=N` ends a part after exactly N cases,
`--part-ms=N` once the part has run for N ms less the run's longest chunk so far, and `--parts-from=<run.json>` where that
run of the same cases in the same order started its parts, so two browsers see every case after the same history. A part
ends only on an acknowledged chunk, with a `retire` reply to the page, and `run.json` lists the parts (`parts`: reason,
first row, rows, ms). Chrome and Firefox relaunch in a new profile and webkit-host is spawned again, after the part
before them closed, so a job never runs two instances; every part's first step checks the process languages again.

Installed Safari runs in 5-minute parts unless `--part-ms` says otherwise. Each part gets a new single-tab window, opened
the way the first one is, without activating anything, before the old tab closes. A new tab's first load is `about:blank`,
which has no site, so WebKit gives the tab a prewarmed or new WebContent process and never a cached one
(WebProcessPool.cpp `processForSite` :1271-1296), and the lab URL then stays in that process ("Navigation is treated as
same-site", `processForNavigationInternal`). `ps` can't confirm it: WebContent processes don't name their client, and
other jobs' webkit-host processes run beside Safari's. Cases whose layout depends on the process's history do
(`.artifacts/lab/round3-infra/fresh-process-probe`): of the development suite sample's first 2,048 cases in run order, 8
lay out differently than alone in a fresh process, and with a part boundary before the first three (`--part-cases=1463`)
those three lay out as in a fresh process, in installed Safari exactly as in webkit-host, while the five that come 500
cases later are affected again in both. Every row of both Safari jobs was hidden. Without `--allow-safari-frontmost` a
later part waits like the first one while Safari is the frontmost app, and the run fails once `--stall-ms` has passed.

Validated on `dev-all` (25,180 cases): installed Safari with `--part-ms=120000` ran two parts in 179 s, and webkit-host
with `--parts-from` that run gave equal native observations, predictions and painted lines on every case
(`.artifacts/lab/round3-infra/safari-parts`). The family file (21,734 cases) ran in two 40-second parts. The lab window
was visible during `dev-all` and partly hidden during the family file; the driver can't choose.

## Sharded runs and isolation

`bun rebuild/lab/sharded.ts --browser=<browser> --cases=<cases.ndjson> --out=<dir> [--shards=N] [--ids=<id>[,<id>...]]
[--ids-file=<file>] [--isolate] [--job=<lock job name>] [-- <more run.ts arguments>]` runs one case file as several
`run.ts` jobs at the same time. It starts each job under the browser lock itself, so don't wrap it in the lock.

- The selected cases are cut into N runs of neighbours in file order with about equal text length (N defaults to the
  browser's lock slots: 3, and 1 for installed Safari). Each shard writes `<out>/shards/<k>/` like any run.
- When every shard is ok, the rows are joined in shard order into `<out>/<browser>-rows.ndjson` (and measurement records
  into `<out>/<browser>-measurements.ndjson.zst`), the shards' own rows are removed, and `<out>/<browser>-run.json` sums
  the shards' records, in the shape `run.ts` writes, so `score.ts`, `derive.ts` and the gates read the folder like any run.
  It refuses shards that ran another build, other given languages or another library bundle. A failed shard fails the run;
  nothing is joined and nothing runs again.
- A shard's cases keep their neighbours, but every shard starts a fresh document, so history-dependent cases near a cut can
  differ from an unsharded run. Compare two orders of the same sharding. On `ws` (1,019 cases) a sharded run's rows equal an
  unsharded run's in native observation, prediction and painted lines in Chrome, Firefox and webkit-host
  (`.artifacts/lab/round3-infra/sharded-check`).
- **Isolation protocol** (research/TEST-ARCHITECTURE.md §6.5): `--isolate` with `--ids=` or `--ids-file=` runs every given
  case alone in a fresh browser process (`run.ts --part-cases=1 --chunk=1`), so its row shows the case with no document or
  process history. Score the joined rows alone, and against a run of the whole set with `score.ts --native-compare`. A case
  costs about a third of a second in webkit-host and two to three seconds in Chrome and Firefox. First use
  (`.artifacts/lab/round3-infra/isolate-host`): the 75 webkit-host development suite sample cases round 2 found
  history-dependent. Alone, every one equals exactly one of the two orders' native views (38 differ from the forward run, 37
  from the reverse run, none from both), and the round 3 library passes lineCount and breaks on all 75 and widths on 74.

## Recorded measurements

`run.ts --record-measurements` (opt-in) writes `<out>/<browser>-measurements.ndjson.zst`: one line per case, in row order,
streamed through `zstd` (read it with `zstd -dc`, or `measurements.ts` `readMeasurements`). `record.ts` has the format. Per
case:

- `calls`: every `measureText` call on an OffscreenCanvas or `<canvas>` 2D context, in call order: `[context, string, width,
  actualBoundingBoxLeft, Right, Ascent, Descent]`. `phases` gives the range of calls made while the case was observed
  natively (the lab's own font probe), predicted, run through the observation port (the WebKit port measures live) and
  painted.
- `contexts`: per context, the settings the caller assigned, as it spelled them (`assigned`), the settings the context
  reports (`settings`; null where the browser's context lacks the attribute, as WebKit's lacks `lang`, `fontKerning` and
  `textRendering`), its font box and its number in the document. Records from before the re-architecture's S3 also hold
  `declared`, the settings the library declared for the context with the `partition` no context attribute shows, and
  `library.agrees`, both joined through the library's own call log, which nothing read; the library's log no longer holds
  every call (DESIGN.md §4.6), so the recorder stopped joining it.
- `segmentations`: every dictionary segmentation asked of the browser (`Intl.Segmenter.segment`, `Intl.v8BreakIterator`),
  since a layout of Thai text can't be repeated without them. The other page facts a layout reads (user agent, DPR,
  `<html lang>`) are in the row's `env`.

The recorder wraps the prototypes' methods and setters and passes every argument through untouched. It can't see whether a
string is stored in 8 or 16 bits, which Blink's Canvas results depend on; the library's `partition` says what it meant.
Timings of a recorded run aren't comparable with other runs, and a giant's record is as large as its calls: keep giants out
of recorded runs.

`bun rebuild/lab/measurements.ts --rows=<rows.ndjson> --measurements=<file> [--predictor=<file>] [--limit=N]
[--out=<report.json>]` checks a library build against a record with no browser running. Per case it installs the row's page
facts and a replay of the record's predict phase as the globals a layout reads (`OffscreenCanvas`, `document.createElement(
'canvas')`, `Intl.Segmenter`, `Intl.v8BreakIterator`), runs the predictor's `predict()`, and reports whether the layout as a
row keeps it equals the row's, how many `measureText` calls it made against the record's, and every case that asked a
question the record lacks, which can't be answered offline. A question is a context and a string, and a context is found
by its assigned settings, spelled the same way. Exit 1 when any case differs or asks a new question. `installReplay` serves
the predict phase or the observe phase, and reports which recorded call answered each question (`answeredBy`);
`rebuild/tests/replay.ts` builds tier 1 on it ("Test tiers"): recorded sets kept as inputs, the full prediction against a
frozen reference, in parallel.

Validated on `runs` (2,580 cases) in Chrome, Firefox and webkit-host (`.artifacts/lab/round3-infra/record`): a recorded run's
rows equal an unrecorded run's of the same library in native observation, prediction and painted lines, the library's log
agrees with the recorder on every case, and the offline replay of the same library gives the same layout on all 2,580 cases
in each browser with exactly the recorded number of calls (Chrome 368,962, Firefox 213,552, webkit-host 80,012; webkit-host's
record holds 361,636 calls with its observation port's). A record is about 1 to 2 KB a case compressed.

## Browser-process languages

The languages an engine uses for content without a usable `lang` are given facts of the library (DESIGN.md §1.4). The
library never reads them from the OS; the driver is research tooling, so it may set them at launch or read the OS setting
a browser takes them from (CHARTER.md, "Boundaries"). `languages.ts` holds the rules with their citations. Each row's
`languages` records `launch` (arguments and prefs), `os` (`defaults read -g AppleLanguages` and `AppleLocale`, launchd's
`LC_ALL`, `LC_MESSAGES` and `LANG`), `given` (the facts the page passes to `predict`) and `derivation`.

- Chrome, `uiLanguage`: Blink's `DefaultLanguage()` is the renderer's `--lang` switch, which the browser appends from its
  application locale. On macOS that locale is the bundle's first preferred localization over the process's
  `AppleLanguages`, and a `--lang` launch switch is ignored. So Chrome launches with `-AppleLanguages ("zh-Hans-US",
  "en-US")`, this Mac's list on 2026-09-17, which keeps the zh-CN locale every earlier Chrome run had without drifting
  with the OS settings, and the accept languages `zh-CN,zh`. The driver reads the given fact back from the renderer
  processes' command lines at the page's first step. `--chrome-apple-languages` and `--chrome-accept-languages` replace
  both, so unlabeled content can be observed under a second controlled locale; the rule families' `process-languages`
  runs use `en-US` and `en-US,en`. Firefox and webkit-host have no such option: Firefox's Mac command line passes a Cocoa
  `-AppleLanguages` pair on as arguments to open (`nsCommandLineServiceMac.mm:107` skips only `-psn_` and
  `-foreground`), and webkit-host rejects arguments it doesn't know.
- Firefox, `regionalPrefsLocale`: layout takes the first OS regional-prefs locale, which on macOS is
  `CFLocaleCopyPreferredLanguages()` canonicalized; no pref reaches it. The driver derives it from `AppleLanguages`
  (`zh-hans-us` here) and sets `intl.locale.requested`, `intl.accept_languages` and `intl.regional_prefs.use_os_locales`
  explicitly, which decide only the app locale, `navigator.languages` and Intl formatters.
- Safari and webkit-host, `preferredLanguages` and `icuDefaultLocale`: Safari takes its languages from the OS and can't
  take others per launch, and webkit-host stands in for Safari, so neither is launched with languages. The UI process
  launches each WebContent process with `OverrideLanguages`, its own `[NSUserDefaults AppleLanguages]` when the app set
  none (`AuxiliaryProcessProxy.cpp:141-160, :203`, `AuxiliaryProcessProxyCocoa.mm:73-77`). The WebContent process puts them
  in its argument domain (`XPCServiceMain.mm:61-78, :181-190`, `LanguageCocoa.mm:83-91`), and its preferred languages are
  `CFLocaleCopyPreferredLanguages()` minimized by `+[NSLocale minimizedLanguagesFromLanguages:]` and canonicalized
  (`LanguageCF.cpp:47-110`, `LanguageCocoa.mm:68-81`). The minimization is platform API outside WebKit's source, so before
  launch the driver runs `webkit-host --print-languages` (`rebuild/tools/webkit-host/main.swift`), which evaluates those
  steps. The result is the given list, recorded with each step in `languages.webContent`. On this Mac on 2026-09-17:
  `["zh-Hans-US", "en-US"]` minimizes to `["zh-CN", "zh-Hans"]`. An app domain with its own `AppleLanguages`
  (`dev.pretext-rebuild.webkit-host`, `com.apple.Safari`) leaves the list unknown, and it reports `ui-language`. A page shows
  the list's first entry as `navigator.languages` (`NavigatorBase.cpp:148-152`). The driver only checks that the first page
  agrees, and fails the run when it doesn't; no page result enters the given facts. Round 1's rows carry `["zh-CN"]`,
  taken from the page, so their environment key differs from rows since. The ICU default locale comes from launchd's
  locale variables, else `en_US_POSIX` (specs/webkit-gaps.md §8.2 [I]).

Pages record `navigatorLanguages` and `intlLocale` in `env` as evidence next to the given facts. `environmentKey` names
the given facts, so rows with other process languages never meet in a baseline.

## Page protocol

The server serves `/lab?run=<id>&lang=<pageLang>&fonts=<families>`. `<html lang>` is set in the markup, so it holds
before any script measures. The page loads the listed fixture web fonts (`Case.fontFixtures`, from
`tests/wrapping/fonts`, hashes checked by the driver) as `FontFace` objects, then posts to `/api/step`. Replies carry
a chunk of cases with the build, the given languages and whether native observation is skipped, a navigation to another
page context, or done. A page context is a page language plus its fixture fonts. Cases are put in `--order`, then grouped
by context, stable in order of first appearance, and every context change reloads the page.
Canvas contexts therefore start fresh under the new language, and installed-font cases never share a document with
web fonts. Only fetch promises drive the loop, so background timer throttling can't stall it.

For each case the page:

1. Builds a `div` at (0, 0) with the paragraph's width, font, letter- and word-spacing, px line height, `white-space`,
   `word-break`, `overflow-wrap`, `line-break`, `tab-size`, `direction` and `lang`. Every run becomes a `span` with its
   own font, spacing and `lang`, or a bare text node, with its text inserted exactly as given. Keyword values the
   browser refuses are recorded in `rejectedStyles`. A case with inline structure (`Case.inline`, DESIGN.md §8.3 stage 5)
   instead gets the block's `text-indent` and `text-align`, then, per slot row, a `float: left; clear: left` block of the
   row's left inset and a `float: right; clear: right` block of its right inset, one line height tall, and then its tree:
   every span with its own font, spacing, wrapping keywords, `lang`, logical margin, border and padding on each side,
   `vertical-align` and the block's line height; every atomic inline as an empty top-aligned inline-block of its border
   box and inline margins; `<br>` and `<wbr>` elements. A text leaf with empty text makes no DOM node. The case's `runs`
   list the tree's leaves, so everything below indexes leaves.
2. Lays it out, records `document.fonts.status`, awaits `document.fonts.ready` and records the status again. It also
   records `missingFonts`: the named families in the paragraph's and runs' font lists that the page can't resolve.
   A family resolves when a probe string measures differently in Canvas from at least one of two generic fallbacks;
   each family is probed once per document. Uninstalled fonts fall back silently, and Safari hides user-installed
   fonts from web content.
3. For every code point, records its UTF-16 offset in the concatenated run text, its length, and every Range client
   rect over the owning run's text node, relative to the paragraph's content box. It also records `runRects`: the
   rects of a Range over each run's whole text node. For a case with inline structure it records `elements`, each
   element's `getClientRects()` in document order (spans, atomic inlines, `<br>`, `<wbr>`), and `floats`, the slot floats'
   border boxes. The scorer doesn't compare `elements` yet.
4. Records the paragraph height and the environment: user agent, DPR, visual-viewport scale, page language,
   fixture fonts, window sizes, visibility and focus, `navigator.languages` and the default Intl locale, plus the
   document's history: `documentCaseIndex`, how many cases the document observed before this one, and `previousCaseId`,
   the last of them (null for the first).
5. Calls `predict(c, { browser, build, languages })`. When it returns a layout, the page runs `observe/<engine>.ts` over
   it, measuring Canvas live where the port asks (only the WebKit port does), records the painter limits the predictor's
   `limits()` gives per painted line, and records the prediction. Then it calls
   `paint(c, prediction, host)`. If that returns elements, one per line with a line box, the page appends them to a host
   of the paragraph's width. For each element it records the height, the Range rects of every text node inside it and
   their horizontal extent, the text of those nodes in document order, and every Range rect of each of its code points.

Under `--predict-only` the page skips steps 1-3 and records `native: { skipped: 'predict-only' }`. Under `--measure-first`
the replies carry a document's cases twice: `predict` chunks, for which the page runs step 5's prediction, observation port
and painter limits and holds the result, touching no DOM, and then `observe` chunks, for which it runs steps 1 to 4 and
paints the held prediction ("Measure first").

## Prediction hook

`predictor.ts` exports `predict(c, { browser, build, languages }): LayoutPrediction | { error }`, `paint(c, prediction,
host): HTMLElement[] | null` and `limits(prediction): PainterLimits`, the library's painter limits per painted line. It is
`makePredictor(fontFactsFor)` from `predictor-core.ts`; `baselines/no-facts-predictor.ts` is the same with
`UNKNOWN_FONT_FACTS` for every font, without the font table in its bundle. A `LayoutPrediction` is the library's input, the case paragraph with the font facts the
predictor gives and the process languages the driver gave, and the `ParagraphLayout` it computed with `build` as
`GivenFacts.build`, beside the width every slot got. The page records an `EnginePrediction`: the layout, `measure` with
the adapter's counts of contexts and calls (`memoHits` was the library's count of the lookups its memo answered, which the
lab no longer sees: the field keeps the row's shape and is 0), and `observation`, the rects the observation port expects,
or the error it threw. A `LayoutPrediction` also carries `painter`, no part of a row: the library's painter over what
`linePieces` gave of each line, the slot with its width and the line box flag, with the engine's painting rules. `paint`
and `limits` call it, so they paint and name the limits of the same filled lines.

A predictor swapped in with `--predictor` may return line ranges alone, `{ lines: [{ start, end, width? }], measureLog? }`
(`baselines/main-predictor.ts` does, and `baselines/plain-predictor.ts`, whose lines have no width). The page records those
as they are and doesn't paint. Rows recorded before the observation ports, 2026-09-16 and earlier, carry that shape too.

Three predictors hold the library's other paths against the usual run in a browser (`browser-sets.ts --predictor=<file>`,
then `rebuild/tests/compare-sets.ts <its run> <the usual run>`):
- `baselines/plain-predictor.ts`, with `--prediction=line-ranges`: the line ranges of a paragraph prepared plain must be the
  inspected run's, and native observations that differ are read one by one, as history effects of a smaller set of Canvas
  questions.
- `baselines/other-widths-first-predictor.ts`, with `--prediction=without-measure`: one prepared paragraph serves any width,
  and Chrome keeps the first shaping of a word per canvas, so the layouts after two other widths must be the usual run's;
  only the counts of Canvas work differ.
- `baselines/page-contexts-predictor.ts` and `page-contexts-facts-predictor.ts` (`--config=facts`), with
  `--prediction=without-measure`, and `page-contexts-plain-predictor.ts`, with `--prediction=line-ranges`: one list of
  Canvas contexts for every case a document lays out (`makePredictor`'s `pageContexts`; `src/index.ts` `prepare`), where
  the usual predictors hand `prepare` none, so that every case makes its own contexts and a case's record stays what one
  paragraph asks. A document's cases share their Canvas contexts, and every case asks its font checks of Canvas again on
  them, so in Chrome what a canvas shaped before is the document's history: the layouts must be the usual run's in file
  order, reversed, and in a shuffled third order (`browser-sets.ts --shuffle=<seed>`). `tools/twin-scan.ts --page` is its
  offline tripwire: a case file scanned as one page, where no two cases may ask one context the same characters in both
  storages.
- `baselines/plain-other-widths-first-predictor.ts`, with `--prediction=line-ranges`: a plain Blink paragraph keeps by
  offset what its lines measured (DESIGN.md §4.6), so at the case's width it reads back what two other widths asked of
  Canvas, and its line ranges must still be the inspected run's. The inspected path's predictor above reads back in
  `linePieces` alone.

## Font facts

`font-facts.ts` resolves a CSS font declaration to the `FontFacts` each engine reads on this Mac (DESIGN.md §1.2), from
`font-facts.json`, a table of properties of the installed fonts and the web font fixtures. Facts are properties of a font,
never expected layout results. The library never reads the table or a font file; the lab declares the facts the way an app
that knows its fonts would. `font-facts.test.ts` holds known fonts' facts.

The table is built offline by the programs under `.artifacts/charter-20260916/font-facts/tools/`, which the table records
with their hashes, the font files' hashes and the engine source behind every column (`provenance`, `rules`):

- `collect-families.ts`: every font declaration the case files name (flat runs and the spans of tree cases).
- `ctprobe.swift`: Core Text. A family's faces in Core Text's and in AppKit's order, traits, the platform UI font, the
  substitute for U+0628, and every code point Core Text gives a glyph.
- `tables.py` (fontTools): the cmap as ranges, the tables present, kerning formats, GSUB and GPOS script tags, and the
  scripts grouped by the lookups HarfBuzz selects for them.
- `ligatures.py` (fontTools and HarfBuzz through uharfbuzz): the ligature patterns and the letter-spacing inputs. Its
  header says how candidates come from the font's GSUB LigatureSubst entries and `morx` ligature subtables, how they are
  shaped, and what makes a face's list incomplete.
- `ctligatures.swift`: Core Text's verdict on every string `ligatures.py` shaped, under its defaults and under the features
  WebKit and Gecko's Core Text shaper set for letter-spacing.
- `build-facts.ts`: joins them into `font-facts.json`. It refuses to write when Core Text and fontTools disagree on a table,
  when a cmap code point has no Core Text glyph (except in the platform UI font, where Core Text withholds some), or when a
  fixture's hash isn't `fonts.json`'s.

To rebuild after a case generator names a new family or an OS update changes a font, from that folder: add the family to
`query-r3.json`, then

```sh
bun tools/collect-families.ts declarations-r3.json <case files>
swiftc -O tools/ctprobe.swift -o /tmp/ctprobe && /tmp/ctprobe query-r3.json ctprobe-r3.json
python3 tools/font-files.py ctprobe-r3.json > installed-paths-r3.txt
venv/bin/python tools/tables.py tables-installed-r3.json @installed-paths-r3.txt
venv/bin/python tools/tables.py tables-fixtures-r3.json @fixture-paths-r3.txt
venv/bin/python tools/ligatures.py ligatures-r3.ndjson @installed-paths-r3.txt @fixture-paths-r3.txt
swiftc -O tools/ctligatures.swift -o /tmp/ctligatures && /tmp/ctligatures ligatures-r3.ndjson ctligatures-r3.ndjson
bun tools/build-facts.ts && bun test rebuild/lab/font-facts.test.ts
```

`ctligatures`' stderr goes to `ctligatures-r3.log` (`2> ctligatures-r3.log`): the builder reads Core Text's own "Invalid
'morx' Subtable" lines from it. To check the letter-spacing facts in the browsers, run `tools/probe-letter-spacing.ts`
with `rebuild/probes/runner.ts` (its header has the command) and then `bun tools/verdict-letter-spacing.ts <out dir>`.

The whole chain takes under two minutes and no browser.

What the facts don't say:
- The engine's fallback after the listed families, and the family a generic keyword realizes when the engine has more
  than one candidate (Blink and Gecko choose by the content's script and language). Those entries have null facts.
- Ligatures inside one grapheme cluster (emoji sequences, Indic conjuncts), and the ligatures of fonts whose forms need
  neighbours the program never tried: the Devanagari, Bangla, Khmer and Myanmar fonts, Noto Nastaliq Urdu, Apple Chancery,
  Hoefler Text's italics, Raanana and Apple Color Emoji have `complete: false`.
- Marks between a ligature's characters. Patterns list base characters; `acrossMark` says whether one combining mark after
  the first character leaves the first two in one glyph, and nothing else about marks was shaped. Arial's `liga` draws
  `اللّٰه` (with shadda and superscript alef before the heh) as its Allah ligature in all three browsers: a consumer has
  to take marks out before matching and treat a match across marks as unsettled. `complete` is about base characters.
- Anything under a language system other than the default. `languageSystems` names the ones that change lookups.
- Core Text's default features aren't in source. Of 16,212 strings from ligature entries outside HarfBuzz's default
  features, Core Text ligated 2 by default, both of which HarfBuzz ligates through an entry inside them
  (`provenance.coreTextDefaultFeatures`).

## Scoring

`score.ts` streams rows and compares each row's native rects exactly with the rects its observation port expects
(DESIGN.md §9). The case carried by each row supplies the text and styles. `--cases` restricts scoring to those ids and
fails when a row observed a different version of a case. `--native-compare=<other rows file>` compares two runs' native
observations (see "Page-history dependence"). `--native-rows=<rows file>` scores rows from `run.ts --predict-only`
against another run's native observations: each row takes the native observation, environment and native timing of the
other file's row for its case id (found by byte offset, not held in memory). The scorer refuses (exit 1) a row that has
its own native observation, a native row without one, a different case, or another environment (browser, app bundle
build, given process languages, user agent, DPR, visual-viewport scale, page language or fixture fonts). A row with no
native row stays unobserved ('native observation skipped'), the summary's `nativeRows` counts `used` and `missing`, and
any missing row makes the scorer exit 1. `--sealed` writes counts only, per browser, metric, reason category and gap, with
no case ids, texts, families or examples, and takes no `--per-case` or `--examples` (see "Sealed held-out sets").
Imported as a module, `score.ts` runs nothing and exports `scoreRow`, `nativeLines`, `nativeView`, `nativeDifference`,
`lineRangeDiagnostics`, `withNativeRow`, `indexRows`, `readRowAt`, `environmentKey`, `rowText` and `readLines` with their
types, so tools that compare rows use the scorer's rules. It also exports `slotProtocol`, `lineLocalGaps`,
`RESIDUAL_CLASSES` and `residualMembership`.
`SCORER_VERSION` is 8. Version 1 derived native lines and widths from visibility rules; version 2 grouped every rect into
native lines by vertical centre; version 3 placed code point rects by their own node's box; version 4 compared element
rects, marked slot protocol rows and counted every gap that concerned a failing line as covering it; version 5 counts a gap
as covering only where its range touches what differs, observes indented lines' widths and matches residual classes.
Version 6 changes no metric's status: it attributes three observation consequences by their engines' rules ("Covered
failures", the last three paragraphs), counts painter limits ("Painter limits") and records gap firing ("Gap firing and
lift"). Version 7 (ceiling round 4b) changes no metric's status either: it finds Blink's hyphen rect on whichever range
reports it, keeps differing units inside one stand-in span in one run ("Covered failures") and registers a second residual
class ("Residual classes"). Version 8 compares native collection lengths, element rects and slot floats symmetrically;
well-formed lab geometry is required before grouping/scoring. The complete-source evaluator independently rejects
omitted or split visible source scalars. Prediction order dependence against a stable native target is separate from
actual native history in ledger format 3. Their rules and evidence are in this file's git history. It also exports `gapFiring` and
`syntheticBoldStep`.

**Round 2 re-counted under scorer 5 (2026-09-17, ceiling round 3).** Round 2's evaluation rows
(`.artifacts/ceiling-20260917/evaluate-r2`, the round 2 library) re-scored into `.artifacts/ceiling-20260917/rescore-s5/`,
every set in both orders, sealed-2 counts only. Between scorer 4 and scorer 5 no metric status changes on any set in
either order except the feature families, where the widths and painter extents of indented lines go from unobserved to
pass: Chrome 1,922 cases, Firefox 1,885 (`rule/line-slots` and `rule/text-indent`; 10 Chrome `rule/text-indent` widths stay
unobserved, clamped to 0 by a negative indent). No newly observed width fails. History-dependent cases are the same.

Rows failing lineCount, breaks or widths without a covered explanation, forward order, history-dependent and protocol
rows left out: scorer 4's count → scorer 5's (residual probed / residual by signature alone / open), of the rows failing
a prediction metric:

| Browser | Rule families | Feature families | Development | Held-out 09-16 | Sealed-2 (counts) | Fresh runs 1-4 | Triage |
|---|---|---|---|---|---|---|---|
| Chrome | 0 → 0 of 457 | 0 → 0 of 0 | 0 → 2 (0 / 0 / 2) of 95 | 0 → 15 (0 / 0 / 15) of 205 | 0 → 8 (0 / 0 / 8) of 184 | 6 → 9 (0 / 0 / 9) of 48 | 1 → 8 (0 / 0 / 8) of 454 |
| Firefox | 0 → 52 (0 / 0 / 52) of 992 | 0 → 0 of 0 | 9 → 19 (4 / 6 / 9) of 1,013 | 6 → 19 (3 / 3 / 13) of 877 | 8 → 17 (0 / 5 / 12) of 938 | 7 → 28 (2 / 7 / 19) of 160 | 7 → 19 (4 / 3 / 12) of 653 |
| webkit-host | 0 → 0 of 493 | 0 → 0 of 32 | 0 → 3 (0 / 0 / 3) of 210 | 0 → 22 (0 / 0 / 22) of 261 | 0 → 40 (0 / 0 / 40) of 195 | 0 → 2 (0 / 0 / 2) of 475 | 1 → 11 (0 / 0 / 11) of 759 |

The held-out column includes the 9 giants that left `heldout-suite-sample.ndjson` for `giants.ndjson` this round, scored
from round 2's held-out rows as the set `heldout-giants` (Chrome: 6 of them fail widths, none covered; Firefox and
webkit-host: none fails a prediction metric). Over all sets but triage that is Chrome 6 → 34 of 989 failing rows, Firefox 30 → 135 (9 probed, 21 by signature alone, 105
open) of 3,980, and webkit-host 0 → 67 of 1,666. webkit-host's combined files: dev-all 5, families-all 0, heldout-all 25,
sealed2-all 40; installed Safari's dev-all 5 and families-all 0, the same cases as webkit-host's. The classes, with example ids, are in `rescore-s5/uncovered.txt`, and
every row with its failing lines, evidence and the gaps elsewhere in `rescore-s5/uncovered-<browser>.json`. In short:

- Chrome: Arabic corpus lines where a space and the letter after it differ with nothing on them (`suite/maintained/corpus`,
  6 giants and `c-d5c9e88814700c97`); the round 2 critic's two classes, now also where round 2 had them covered (U+3000 inside Arabic under letter
  spacing, `runs/word-spacing-spans`, held-out, fresh and sealed-2; the lam-alef and Allah ligatures across a span edge,
  `runs/bidi-runs` and `runs/letter-spacing-spans`), `suite/U+FFFC/start` break decisions with `script-context`,
  `font-fallback` and `soft-hyphen-shaping` elsewhere on the line, `suite/script-prefix-heldout`, and in triage
  `suite/joined` and `suite/mixed` break decisions with `glyph-clusters` and `unsafe-to-break` elsewhere, beside
  `c-8c84627af834611f`.
- Firefox: `in-word-prefix` reported at another offset than the text that differs. `rule/joining` (48 rows) and
  `rule/in-word-breaks`, `runs/bidi-runs`, `runs/split-word`, `policy/overflow-wrap`: a line reports one offset (often one
  it consulted, `c-1799ae7756792660`: line [0,7) reports offset 2 while the letters before the break at 7 differ), or the
  break's gap sits only on the line that starts there (`c-7754e1930fc6a95a`). The 1 au class: 9 probed and 21 by signature
  alone over all sets but triage; the keycap-heart rows (`c-a2661c5b12f20aec`, `c-29e69bcf2dd4945f`, `c-e69a2cc0039e247a`)
  stay open. The rows the round 2 critic traced as backed by source stay covered: the break between joined letters across
  a soft hyphen (`c-1815bd730254961c`), and `font-fallback` on the line of the emergency break (`c-65224845034de429`).
- webkit-host: `suite/U+000B`, `U+000C`, `U+001C` to `U+001F` `/middle` widths, where `control-character-width` names the
  control character on the line before and the letter after it differs (`c-c11c64d333d30506`, 0.03px); `suite/word` widths
  with `letter-spacing-ligatures` elsewhere; `suite/physical-window-terminal-seam` and `suite/raw-context` breaks with
  `page-history` on the line before; `c-66ae4ab7d56cb0ae`. `c-67cd9bd538cb3e95`, which the critic traced as backed, stays
  covered. In a one-node paragraph the node is the unit, so there the
  rule only drops gaps of other lines: webkit-host's weak coverage (REPORT §2.8) is as weak as before.

**Scorer 4 is in (2026-09-17, ceiling round 2).** Engine owners re-score with it. What changed from version 3: element
rects are compared ("Elements" below), slot protocol rows are marked ("Protocol rows"), and failing lines are attributed to
the gaps that concern them ("Line-local gaps"). Rows and cases don't change. Re-scoring round 1's feature-family rows
(`.artifacts/lab/round2-scorer4/rescore-r1/`, forward against reverse) turns the line counts left unobserved there into
passes, Chrome 719, Firefox 670 and webkit-host 701, with no new lineCount failure in Chrome or Firefox. webkit-host gains 4
lineCount and 4 breaks failures in `rule/br-elements`, whose layouts place text on lines native layout doesn't
(`c-178367f98108fb03`: 6 text rects on 4 lines where native layout has 4 on 2). Widths go from unobserved or not
applicable to pass on Chrome 2,550, Firefox 2,608 and webkit-host 2,395 cases. The 22 protocol rows (Firefox 15,
webkit-host 7) are unobserved, and 17 webkit-host `rule/box-edges` widths go from pass to unobserved: with a negative
margin the span's border box reaches past the engine width. Rule-family statuses don't change.

Failures without a line-local gap in round 1's rows under scorer 4 (lineCount / breaks / widths, forward order, history-
dependent cases excluded; `rescore-r1/<browser>-<set>-forward/<browser>-summary.json`, `lineLocal`):

| Browser | Suite sample | Held-out 09-16 suite sample | Rule families | Feature families |
|---|---|---|---|---|
| Chrome | 4 / 5 / 4 of 89 / 100 / 108 | 11 / 11 / 18 of 102 / 131 / 182 | 8 / 24 / 48 of 204 / 286 / 368 | 8 / 8 / 44 of 28 / 28 / 220 |
| Firefox | 0 / 0 / 7 of 63 / 78 / 901 | 0 / 0 / 1 of 49 / 72 / 758 | 79 / 210 / 374 of 162 / 418 / 685 | 0 / 0 / 0 of 0 / 0 / 0 |
| webkit-host | 15 / 17 / 26, every failure | 32 / 47 / 37, every failure | 58 / 113 / 194 of 120 / 202 / 291 | 20 / 32 / 0, every failure |

Round 1's WebKit engine reports its content conditions as paragraph gaps without a range, so no webkit-host failure there
is covered line-locally; Firefox's rule-family failures without one all have paragraph gaps. These count the round 1
library; owners re-score their own rows.

Native lines. A rect without positive height, as Firefox reports for a frame without height, is placed on no line.
The rest follow three rules:

1. A code point rect is on the line of the whole-node rect of its own node that reports the same box. Blink slices the
   fragment item's rect and Gecko cuts the continuation frame's rect, so y and height equal the box's; WebKit reports a
   whole box's rect, or a snapped selection rect whose y is the box's y truncated to a LayoutUnit (observe-webkit E3).
   A code point rect no node rect holds falls back to rule 3; the summary counts them as `native.pointRectsByCentre`.
2. Rects of one node with equal tops are on one line in Blink and WebKit, since a node's boxes share one style and so one
   ascent on the line's baseline. Gecko sizes each text frame by the fonts it uses, so each Firefox node rect stands alone.
3. Observer assumption, across nodes, until vertical metrics are ported: the node lines of rule 2 group by vertical
   centre. Centres on one line differ by less than half the paragraph's px line height, and centres on different lines
   by half a line height or more. Every inline box carries the line height and sits on its line's baseline, so only
   font metrics move centres within a line: Safari rounds half-leading per line (Amiri 18px at line height 30 gives
   lines 29.984375px apart), and Firefox sizes a text frame by the fonts it uses (an emoji line's rects are 21px tall,
   the next line's 19px). Native lines are numbered from the top. Painted lines still group all their rects by centre,
   because painted code points aren't mapped to nodes.

Re-scoring the evaluation rows of 2026-09-17 (smoke, runs, ws and policy, forward against reverse, in Chrome, Firefox and
webkit-host) with version 3 gives per-case files equal to version 2's on all 16,511 cases, with every positive code point
rect placed by rule 1.

Facts. Per code point and per node, the observed rects equal the expected rects in count and order, and each x and width
is bit-equal to the expected value, which the port computes after the engine's rounding. The summary and the per-case
file count them apart:

- `counts`: rect counts, predicted by definition;
- `predicted`: values the ported rule gives exactly;
- `limited`, per gap: values the port computes from a Canvas stand-in, such as prefix widths inside a word. They are
  compared exactly, and a difference is attributed to the gap, never to an engine rule;
- `lines`: whether each rect of a range whose counts agree sits on the native line its engine line maps to;
- `unobservable`, per rule: engine facts the port lists because no rect reflects them. They are never compared;
- `unplaced`: native rects without positive height.

Metrics per case. `unobserved` and `not-applicable` are never passes.

- `lineCount`: the number of native lines equals the number of engine lines with a line box; the k-th line box from the
  top is native line k. Unobserved when a line box has no expected rect, so nothing shows it.
- `breaks`: every code point and every node reports on the native lines the layout places it on: the native lines of
  its placed rects equal the lines its expected rects map to. An expected rect on a line without a line box maps to no
  native line, since that line has no block size (Firefox reports its rects with height 0). Where rect counts agree,
  rects pair by index, so a native rect without positive height drops its partner; otherwise the lines compare only when
  every native rect is placed. 'line count differs' when lineCount fails, unobserved when lineCount is.
- `widths`: scored only when breaks pass. Per line box, the engine width against the union of the line's positive
  whole-node rects, in the engine's units (DESIGN.md §2.6):
  - Chrome, raw LayoutUnits: an edge v is `round(v × 64 × zoom)` where `f32(f32(raw / 64) × f32(1 / zoom))` gives v back
    and the rect's width is the float difference of its edges; the extent is right minus left.
  - Safari and webkit-host, float32 CSS px: a box's right edge is `f32(x + width)`, and the line's right edge must be
    `f32(left + width)`, since box positions are float32 sums.
  - Firefox, app units: an edge is `round(v × 60)` where `DOMRect::SetLayoutRect`'s encoding gives the rect back.

  On a line Blink or Gecko indented, the engine width holds the text-indent and no rect does, so the rects are compared
  with the engine width less the indent (`observedWidth`): Blink's line position starts at the indent and
  `LineInfo::Width` is that position after the last item (line_breaker.cc:877-879, :1149-1156), and Gecko adds
  `mTextIndent` to the root span's `mICoord`, which becomes the line's inline size (nsLineLayout.cpp:197-199). WebKit moves
  the line's rect by the indent before it places content (InlineLineBuilder.cpp:453, :474-476), so nothing comes off its
  content width. A failure's detail then reads `width W less text-indent I`. Before scorer 5 these widths were unobserved
  in Chrome and Firefox: 96% of `rule/text-indent` and half of `rule/line-slots`, whose first lines are indented.

  A rect no engine value encodes as is a mismatch. The width is unobserved on a line whose expected node rects don't
  span the engine width: Blink's hyphen that no node range reports (observe-blink U3), WebKit's content width a float32
  step from its boxes after trimming, a Blink width that a negative indent clamped to 0 (`c-0afd262e43442524`). When an
  expected node rect on the line is limited, a mismatch says so in its reason.
- `painter`: each painted line's rects, zero-width ones included, form one native line under the same grouping, and the
  union of its positive whole-node rects spans the engine width of its line box by the same rule. Unobserved where the
  width is. It compares extents only: painted code point rects aren't mapped to source code points, because `paint`
  doesn't report the painted text's source offsets.

A prediction of line ranges alone (main's predictor, or a row from before the observation ports) is scored for lineCount
against its predicted lines and for painted lines that wrap. Its breaks are unobserved and its widths not applicable: no
port derives the rects such a prediction implies, and its widths are its own observer's extents. Two diagnostics go in
the per-case file (`diagnostics`) and the summary (`lineRangeDiagnostics`); they are not metrics and never gate:

- `visibleBreaks`: every code point whose positive-width rects all sit on one native line lies in the predicted line of
  that index;
- `zeroWidthPlacement`: every code point outside white space whose placed rects all have zero width and sit on one native
  line lies in the predicted line of that index.

Both are unobserved when the line counts differ or nothing qualifies. A code point that no predicted line covers is left
out of both: main's line ranges leave zero-width content at a line edge outside every line, which says nothing about where
its lines start (research/ROUND1-CRITIC.md item 3, `c-aad1cfdbd82a76b7`). An observation port error leaves every metric
unobserved.

Elements. A case with inline structure records `Element.getClientRects()` per element (spans, atomic inlines, `<br>`,
`<wbr>`), and its observation port expects them (DESIGN.md §9). They compare like node rects: counts, x and width per rect,
and line membership ('element on other lines'). Element rects group into native lines by centre with the rest, each rect
on its own, since a culled span in Blink reports other objects' items and an atomic inline is top-aligned. A line box that
only an element reports (a line holding atomics, a box edge or a `<br>`) is observed through it. Widths take the union of
the line's whole-node rects and element rects, so box edges and atomics count. Painted lines record text node rects alone,
so the painter's extents keep node rects. An element the port expects nothing for gets one empty rect on no line (Blink's
`found_quad` false). A flat case records no elements, and its spans aren't compared as elements.

Protocol rows. A row whose page doesn't describe the case's declared input is a protocol row (`slotProtocol`): every metric
is unobserved with the reason 'protocol row: the slot floats don't describe the declared slots', and the per-case file has
`protocol` with the float that moved. It is never a pass or a fail. For a case with line slots, every slot float must sit
in its row on its side: top r × lineHeight, height lineHeight, a left float at the content box's left edge, a right float
ending at its right edge in engine units. Gecko and WebKit move a later float of row 0 down when it doesn't fit beside the
indented first line (nsLineLayout.cpp:1485-1492, BlockReflowState.cpp:793-798; InlineLineBuilder.cpp:1317-1328, :1368-1380).
Re-scoring round 1's feature-family rows finds exactly the critic's 22: Firefox 15, webkit-host 7, all in
`rule/line-slots`. The float widths aren't checked, because each engine converts the declared inset with its own
arithmetic. Derivation's width floor follows each engine's float rule (`rebuild/tests/derive.ts` `minimumUnits`).
Re-deriving `line-slots` with it (seed `feature-families-20260917`, native-only final runs,
`.artifacts/lab/round2-scorer4/line-slots/`) gives 0 protocol rows in every round and final run: Firefox 26,061 round
rows and 1,790 final cases, webkit-host 41,296 and 1,908; round 1's Firefox rounds r03-r05 had 83. The 6 webkit-host RTL
final cases whose row 0 insets and indent exceed the width keep their floats in rows, as WebKit's start-positioned rule
says. Ceiling round 3 derived every family again with it (`.artifacts/tests/derive-r3-20260917`, rebuild/TESTS.md §6): no
final run has a protocol row, and round 2's 22 are gone from the case files. Line boxes taller than the line height (mixed fonts) would move rows too; the feature families' slot cases use
one font, and no rule checks that yet.

Covered failures (scorer 5). A gap covers a failing line only where its range touches what differs there
(research/ROUND2-CRITIC.md item 1): under scorer 4 a `script-context` range on a quote covered a ligature 15 characters
away. The rule has two steps, and `score.ts` "Covered failures" states it in full.

1. The gaps that concern the line, each with a source range: the failing engine line's own `gaps` (`line`), those of the
   line box before it and of lines without a line box between the two (`previous-line`), those of the line box after it
   (`next-line`, new in scorer 5: the decision text of a line the prediction ends early lies on the predicted next line),
   those of slots the engine refused between the two lines (`below-floats`), and paragraph gaps whose `at` range meets
   those lines' source range (`paragraph-range`). A line gap's range is its `at` (src/model.ts `Gap.at`), or its whole
   line without one; such a gap is marked `unranged`. A paragraph gap without `at` covers nothing and is listed under
   `paragraphGaps`. A gap reported on a neighbouring line covers only with a range that reaches the evidence; a point
   there is that line's own edge (Blink's `unsafe-to-break` at the next line's start says nothing about the U+3000 that
   ends the failing line, `c-45d738663a9704be`). So an engine reports a break's gap on every line whose width or break it
   can make wrong: round 2's Gecko rows report `in-word-prefix` between joined letters only on the line that starts at
   the break, and the line that ends there comes out without a covered explanation, with the gap under `elsewhere` as
   `next-line`.
2. The evidence those ranges must touch:
   - *Differing units*: the text on the failing engine line whose observed width differs from the expected one in engine
     units, whatever state the port gave the value. In Chrome and Firefox a unit is the grapheme cluster of a code point
     whose rect differs, with the code points next to it that report no width or are default ignorable (a gap at a break
     after a soft hyphen concerns the letter before it); where only a node rect shows the difference, the node's part of
     the line. In WebKit a unit is always a differing node's part of the line, because its code point rects snap to whole
     px. x alone never makes a unit, and element rects make none.
   - *Runs*: units that follow each other without a break, or with nothing between them but code points of one *stand-in
     span* (scorer 7, `standInSpans`): code points that follow each other inside one word and whose expected width the port
     marks limited under `in-word-prefix`. That state says the port divided a shaped word's width among its code points by
     Canvas prefix widths, so the division is a stand-in and the word's sum is what was measured; a code point that happens to
     equal its stand-in doesn't end a run. Round 3's open Firefox row `c-f3e8314c35b33990` is the case: three Phags-pa letters
     and U+0301 under 1px of letter spacing, natively +68 au on the first letter, nothing on the second and −8 au on the marked
     cluster, 60 au in all, the letter spacing the `font-fallback` range on the marked cluster says the DOM adds (probe
     gecko-port F25); it is covered now. Values limited under another gap make no span: without font facts Blink marks every
     value of a line under `glyph-clusters`, and one span per line would let any gap cover any difference on it (tried on
     2026-09-18: 8 open no-facts Chrome rows of kerned positions came out covered by a gap elsewhere on the line). A run
     whose widths add up to the same natively as expected
     (Gecko: the sum in app units; Blink: the extent of its rects, within the one-LayoutUnit rounding of floored and
     ceiled carets when its left edge moved) changes neither the line's width nor its break and needs no gap: Blink
     reports the letters of a joined word as exact where they aren't, and that is counted under exact observation
     agreement, not here.
   - *The decision text*, for lineCount and breaks: the text between the predicted and the native break of the first
     line that differs, from the first to the last code point one side places on that line and the other doesn't, and
     out to the predicted break where that lies before them, or after them past code points without width.

   A widths line is covered when every run that contributes is touched by some gap (every run when none contributes;
   never a line without units). One touched unit isn't enough: round 2's U+3000 rows end in a hanging U+3000 that
   `unsafe-to-break` at the line edge touches, while the U+3000 that makes the width sits mid-line. A lineCount or breaks
   line is a pure break decision when no contributing run lies before the run that runs back from the decision text
   (what ends a line is trimmed, hung, hyphenated or reshaped because of the break); then a gap at the decision text or
   on that run covers it, and so does the failing line's own gap without a range when the decision text starts where the
   line ends. Otherwise every other contributing run must be touched. In WebKit the node that reaches the
   decision text is a unit up to it, so in a one-node paragraph the rule only drops gaps of other lines and of text
   after the decision. Painter lines keep scorer 4's rule (every gap that concerns the line), because painted rects
   aren't mapped to source offsets.

The scorer checks where a range is, not what the condition's source reading says. A condition whose `at` names less than
the text it concerns (a first character, a consulted offset instead of the break taken) now covers less; widening `at` is
widening the condition, and needs the source reading and firing rates the round asks for.

Three observation consequences have rules of their own since scorer 6. Each comes from the engine's range geometry, the
metrics compare every rect as before, and `score.test.ts` ("attribution follows the engines' range geometry") holds a case
for each. Round 3 counted their rows as open although their cause was covered:

- *Report-only rects* (`reportOnlyRects`) place no text, so they don't decide which line a lineCount or breaks failure is
  attributed to, or its decision text. Blink reports a line's hyphen item to every range that reached the end of the text
  item before it in item order ("Hyphens. Include if the last end was included", `layout_text.cc:592-621`), and a line's
  items are in visual order. In a left-to-right line that item ends with the soft hyphen, so the code point after a chosen
  soft hyphen reports the hyphen's rect on the hyphen's line beside its own on the next. In a right-to-left line the hyphen
  item comes first, so the item before it is the last one of the line above, and the code point that ends that item reports
  the hyphen: the letter before the soft hyphen in the three `suite/space` rows (`c-909a7a77bad03225`, `c-4decc6eae7517325`,
  `c-e9e314847e481d69`), which scorer 6 attributed to line 0 and scorer 7 attributes to the line that starts at the soft
  hyphen, where the Blink owner's `in-word-prefix` condition sits. Since scorer 7 a rect of any other code point of the node
  equal to a positive-width rect a soft hyphen reports on that line is the hyphen's, and on the expected side a rect that is
  its line's hyphen item in the layout is too, whoever reports it (`c-ccbcd11b754a7299`, where the prediction's hyphen is
  reported by `(` from the line above and not by the soft hyphen). Left: natively, in a right-to-left line whose soft
  hyphen shares its item with the letter before it, no soft hyphen reports the hyphen, and geometry alone doesn't say which
  rect is its copy (`rebuild/tests/known-tail.json`, `lab/rtl-hyphen-rect-native-side`). Where only one side broke at the soft hyphen, that
  rect made the line after the hyphen's the first that differs, where the cause's gap doesn't reach (`suite/U+FFFC/start`:
  `c-23e11e5c3a96497d`, `c-a43249c733c43a9c`, `c-b0af41f52ed23824`, now covered by `font-fallback` on U+FFFC). WebKit
  reports a range that starts where a text box ends on that box's line when the next box in box order starts later
  ("trailing content on the current line", `selectionRectForTextBox`, RenderText.cpp:373-380): a caret without width, which
  a line's first character gets on the line before whenever bidi reordering puts another box of its line first. So a
  zero-width rect on a line above another rect of the same code point is that report (`c-4bb3746469073e4d`, whose failing
  line is now line 1, where `page-history` sits at the decision text).
- *A WebKit box at a moved x* (`webkitReportedWidth`). A box's rect goes through `FloatQuad::boundingBox`, the corners' min
  and max in float (`FloatQuad.cpp:90-99`), so a box of engine width w at x reports `f32(f32(x + w) − x)`. A node rect whose
  width differs isn't a differing unit where its text box's engine width, from the layout, reports as the native width at
  the native x: the box is as wide as predicted and only its x moved, which never makes a unit (`c-653ac96abf5487ff`:
  60.336002349853516px reports as 60.33599853515625px at the predicted x and 60.33601379394531px at the native one; the
  node that moved it is covered by `canvas-language`).
- *A WebKit line where only the sum differs* (`webkitStandInAddends`). When no box is shown to differ, what differs is
  `Line::contentLogicalWidth`, a float32 sum whose addends are the line's runs, and a reported width settles its box's
  engine width only to a float32 step of the box's right edge. The line's units are then the nodes' parts of the line whose
  expected width the port marks limited, the addends it computed from a Canvas stand-in; a line without one has no unit
  and is never covered (`c-9a66d090891a825d`: 224.06697px natively against 224.06696px, every box at its predicted width
  one step to the right; covered by `rtl-shaping-across-inline-boxes` on the runs shaped across inline boxes).

Painter limits. The library names, per line, what painting the line alone can't reproduce (`src/paint.ts` `painterLimits`,
DESIGN.md §7 "Limits"): conditions on the layout read from engine source, such as `carried-width` or
`edge-inside-shaped-text`. The page records them per painted line (`prediction.painterLimits`; an error where the call
threw; absent in rows from before 2026-09-18 and where the predictor exports no `limits()`), and a limit explains a painter
failure the way a gap explains a prediction failure: a failing painted line is covered when a gap concerns it (scorer 4's
rule, unchanged) or a limit names it. The per-case painter attribution lists `limits` per failing line, and the summary's
`lineLocal.painter` counts painter failures `coveredByGap`, `coveredWithLimits` and `withoutExplanation` (the latter is
`withoutLineGap.painter`), with `byLimit`. A painter error, or a painted line count that differs, has no line and is never
covered. On the round 4 recordings (no-facts, every set, both orders) painter failures without an explanation are Chrome 0
of 1,430, Firefox 15 of 3,543 and webkit-host 23 of 4,459.

Gap firing and lift. A gap fires on a line box when the line's own gaps hold it, or a paragraph gap with a range meets the
line's source range (`gapFiring`). The per-case file records `firing` (`lines`, and per gap the line boxes it fires on) and,
on every attributed failing line, `fires`: the gaps firing there, with the gaps that cover it from a neighbouring line. The
summary's `lineLocal.firing` and `rebuild/tests/ledger.ts conditions` count lift from them over prediction failures alone:
a gap's share of the failing lines of lineCount, breaks and widths failures against its share of the line boxes of cases
whose three prediction metrics pass. Painter-only failures are counted beside it (`painterOnlyFailingLines`) and never
enter it, so a browser whose painter fails often doesn't make every condition read weak (round 2's lift did:
research/ROUND3-EVALUATION.md, "Weak coverage"; the definition was fixed on 2026-09-18). A failure is weakly covered when
every condition that covers it has a lift below 2. `fresh.ts` reads the same per-case record for its firing table.

The per-case file's `lineGaps` has, per failing metric, `lines`, `covered` (every failing line is covered) and
`paragraphGaps`, as before. Each line has `nativeLine`, `engineLine`, `gaps` (the gaps that cover it, with `scope`, `touch`
`unit` or `decision`, and `unranged`), `elsewhere` (gaps that concern the line and cover nothing: what scorer 4 counted)
and `evidence`: `units`, `nodeUnits`, `runs`, `deciding` (runs a gap must touch), `touched`, `first` and `firstText` (the
first deciding run no gap touches), and for lineCount and breaks `decision`, `decisionText` and `pureDecision`. lineCount
and breaks attribute the first native line where native layout and the prediction disagree, or the line before it when the
decision text sits at that line's end (a space one side splits across two lines); widths and the painter attribute
every line whose extent differs. A prediction error, a painter error and a painted line count that differs have no line and
are never covered. The summary's `lineLocal` keeps `failures`, `withoutLineGap` (failing rows without a covered
explanation; the name is scorer 4's), `withoutLineGapButParagraphGap` and `byGap`, and adds
`withoutLineGapButGapElsewhere` (of those, rows every failing line of which has a gap that scorer 4 counted),
`coveredOnlyByUnrangedGap`, `coveredOnlyAtDecision`, `predictionRows` and `residual` (next paragraph). A limited expected
value names a gap in a width failure's reason, but it comes from the observation port, not the layout, and covers nothing.

Residual classes. A residual class is a failure class a probe showed to be a Canvas-versus-DOM difference that no Canvas
measurement detects (CHARTER.md). It is not a gap and covers nothing. `score.ts` holds the registry, `RESIDUAL_CLASSES`:
per class its name, engine, probe evidence, mechanism (`verified` or `inferred`), signature in words, the strings a probe
measured both ways, and the predicate. Every row that fails lineCount, breaks or widths is matched; the per-case file
gets `residual` (`name`, `membership`, `detail`), and the summary counts, in `lineLocal.predictionRows`, the rows `failing`,
those `withoutCoveredExplanation`, of those `residualProbed` and `residualSignatureOnly`, and the rest as `open`;
`lineLocal.residual` has the same per class, with the members a gap covers apart. A member is `probed` when a probe
measured the text that differs: the differing code points lie inside a probed string of the node's first family, size
and weight, on the failing line, and the difference has the probed sign and size. Otherwise it is `signature`: a port bug
that moves one node by one unit has the signature too, so such rows stay suspects until probed. The first entry is
`gecko/one-shaping-unit-one-app-unit`: lineCount and breaks pass, widths fail, every node has the expected number of rects,
exactly one node rect differs in width by exactly 1 app unit, and the painter drew every failing line at the native
width. Its difference is probed (F7, ROUND2-CRITIC item 4, F13), and its mechanism is verified: the DOM shapes at the device
font size and rounds each glyph at the page's app units per device pixel, an OffscreenCanvas at the CSS size at 60 (probe
F13: a `<canvas>` element that runs the DOM's arithmetic reproduces every member; `modern` was also simulated from the
font's units, the Geeza Pro and Thonburi members weren't). It stays a residual class because the library measures on
OffscreenCanvas only (the maintainer's decision of 2026-09-18), where no measurement shows the difference. To add a probed
string or a class, edit the registry with the probe record named, and add a test next to "residual classes" in
`score.test.ts`. `fresh.ts` and `rebuild/tests/ledger.ts` read the per-case `residual`; there is no other registry. F27's
probed strings joined the first entry in ceiling round 4b (`LT:` at weight 400, a Thonburi word at weight 700, `تروك`).
The second entry, since scorer 7, is `gecko/synthetic-bold-offset`: lineCount and breaks pass, widths fail, every node has
the expected number of rects, every node rect that differs belongs to a node of font weight 600 or more and differs by a
whole number of steps, from 1 to the grapheme clusters of the node's text on the line, and the painter drew every failing
line at the native width. A step is what one synthetic bold character is wider in the DOM than on an OffscreenCanvas:
`NS_round(offset(size × 60 / apd) × apd) − NS_round(offset(size) × 60)` app units with `offset(s) = 0.25 + 0.75 s / 48`
below 48px and `s / 48` from there (`syntheticBoldStep`; gfxFont.h:1899-1904, gfxFont.cpp:901-939 and :3551-3562), −7 au at
16px and DPR 2. Its mechanism is verified from source and by probe F24 on 24 of 24 rows; a member is probed where F24 or F14
measured the text in the node's first family, size and weight. The Gecko owner's nine fresh rows (`r4-gecko-2`, `r4-gecko-3`)
are probed members; the tier sets hold none. Of the owner's 11 rows of the 1 au class on `r4-gecko-1`, 10 match and
`c-4c685cf01d01f006` doesn't: the painter drew its line with the trimmed space, so the class's painter condition fails.

The summary (`--out`) has counts per browser and per family, reasons, facts, and per gap how many rows report it and how
many of those fail lineCount or breaks. It keeps a histogram of engine width minus native extent (LayoutUnits in Chrome,
app units in Firefox, 1/64 px in WebKit), timings, and failure and unobserved examples with the case text, the native
lines' code points, the engine lines with their widths and gaps, and the first predicted value that differs.
`environments` counts rows per `environmentKey`: browser, app and engine builds, OS build, DPR, visual-viewport scale, the
given process languages and scorer version, or the user agent for rows from before the driver recorded builds.
`missingFonts` counts rows whose page couldn't resolve a named family. `native` counts native line counts, unplaced rects
and code point rects placed by centre. `historyDependent` is described below. `--per-case` writes each case's four
metrics, its facts, its diagnostics, the gaps its layout reports, and `historyDependent` with the difference when a
comparison found one.

## Seeds go to a staging folder

`gate.ts --seed` never writes the baseline it names (ceiling round 3; the round's baseline rule: nobody but the evaluator
writes seeds, to a staging folder, and they are adopted only after the critic has checked them).

```sh
bun rebuild/lab/gate.ts --seed --staging=rebuild/lab/baselines/staged-<round>-<config> --engine=gecko --engine-version=<label> \
  --baseline=rebuild/lab/baselines/<config>/gate-firefox-<build>.json --runs=<forward per-case>,<reverse per-case> [--note=<text>]
```

- `--baseline` is the adopted seed, which stays as it is. The new seed goes to `<staging>/<the baseline's file name>` and
  its record to `<staging>/<name>.seed-record.json`. `--staging` is required and can't be the folder the baseline is in.
  `--prune-protocol` writes to the staging folder too. Adopting a seed is copying it over the baseline, by whoever is
  allowed to.
- The record compares the new seed with the adopted one: every lost pair with its status, reason and detail in the first
  seeding run that doesn't pass it, whether that run found a covered explanation and the gaps that cover it (`lineGaps`),
  its residual class if any, and an empty `attribution` for the source reading a person adds; `leftThroughHistory`, the
  adopted seed's passes whose case a seeding run now marks history-dependent, with the difference the two orders showed
  and whether the pair passes now (round 2's record left these out: Firefox 134 pairs, webkit-host 8).
  They require review before adoption and block checks against the existing passing obligations; `leftThroughProtocol`, the same for rows that are protocol rows now; the pairs gained; and the cases
  only one side observed. Protocol rows and history-dependent cases are never passes of a seed.
- `leftWithTheirCase` (since ceiling round 4b; research/ROUND3-CRITIC.md item 9): the adopted seed's passes of cases no
  seeding run observed, by id and metric. A case dropped from the new case files takes its passes out of the gate without
  losing them, so they are listed like every other pass that leaves. The staged round 3 records hold them too: 18 Firefox
  feature pairs of 9 cases, 6 webkit-host family pairs of 2 cases and 12 webkit-host feature pairs of 3 cases, the critic's
  count.
- A check reports `leftThroughHistoryPairs`: baseline passes newly obscured by native history. A nonzero count blocks
  acceptance against that seed; existing native-history exclusions are still reported separately.
- Seeding refuses runs without recorded process languages and runs scored by different scorers. It doesn't skip the
  environment check of a later `gate.ts` run: a seed's environments are the ones its runs recorded.
- `rebuild/tests/gate.ts seed` stages too since ceiling round 4: `--staging=<dir>` is required, the seed goes to
  `<staging>/<the baseline's file name>` with a seed record over its family pairs, and the baseline it names stays byte for
  byte (`rebuild/tests/gate.test.ts`). `rebuild/tests/browser-sets.ts --seed` stages the tier 2 seeds the same way.

**Adopted at the correctness line (2026-09-18).** After research/ROUND4-CRITIC.md's verdict the round 4 seeds were made
again with the same commands from the recordings the references are frozen from (`.artifacts/tests/runs/line-20260918`,
both orders, and the giants in `.artifacts/ceiling-20260917/freeze-line/giants`; library feb3937, which differs from the
evaluated one by the font checks' contexts alone), staged, checked and moved into place. The baseline names carry no
configuration, so the lab gate's and the tests gate's adopted seeds sit in a folder per configuration, and tier 2's names
carry it:

| Gate | Adopted seeds | Seeded from |
|---|---|---|
| lab gate (`lab/gate.ts`) | `rebuild/lab/baselines/{no-facts,facts}/gate-<browser>-<build>.json` | smoke, the development sets with `rich-prewrap`, the 09-16 held-out sets and the giants |
| tests gate (`rebuild/tests/gate.ts`) | `rebuild/tests/baselines/{no-facts,facts}/<browser>[-features]-<build>.json`, with each configuration's `coverage.json`; `rebuild/tests/coverage.json` is the headline configuration's | round 3's family derivations as tier 2 ran them |
| tier 2 (`browser-sets.ts`) | `rebuild/tests/baselines/sets/<browser>-<build>-<config>.json` | every tier set |

- Each seed's record is beside it (`<name>.seed-record.json`), with `adopted` added. Every seed equals the one the round 4
  evaluation staged in passes, history-dependent cases, unstable pairs, protocol rows and environments, so every record lists
  the pairs the evaluation's listed, 2,251 lost pairs in 26 records, and each carries the evaluation's attribution for the
  same case and metric (`attributionsFrom`; `.artifacts/ceiling-20260917/freeze-line/tools/carry-attributions.py` refuses a
  pair the evaluation's record doesn't hold with the same status). Tier 2's records compare with round 4a's staged seeds, as
  the evaluation's did; against the evaluation's own staged seeds the new ones lose and gain nothing
  (`freeze-line/seeds-vs-evaluation`).
- Every adopted seed passes a check against its own runs from where it sits, with the environment check on
  (`freeze-line/tools/check-adopted.sh`: 6 lab and 14 tests checks; tier 2 checks its own when it runs).
- What they replaced is in the history before this adoption: round 2's scorer 4 seeds (`rebuild/lab/baselines/gate-<browser>-
  <build>.json`, `rebuild/tests/baselines/<browser>[-features]-<build>.json`), which refused every run since scorer 5 and
  which the records' `against` names, and the staging folders of rounds 3 and 4 (`staged-round3`, `staged-round4-{no-facts,
  facts}`, `staged-round4-sets`, `staged-round4c-sets`). Chrome's .48 seeds and the G0 files stay: they describe other
  environments.
- **Chrome's lab gate seeds since the re-architecture's last step (2026-09-19)** hold the `twins` set, which joined the
  development sets after the line: `rebuild/lab/baselines/{no-facts,facts}/gate-chrome-153.0.8010.50.json`, staged by the
  same command from the X3 merge's recording (`.artifacts/tests/runs/x3-merge-20260919/chrome-<config>`, both orders: the
  adopted seed's ten sets and `twins`) and the line's giants. Against the seed of the line: 0 pairs lost, 0 left through
  history dependence, protocol rows or a missing case, 0 gained, 380 cases only now; 42,160 cases, and `twins` adds 380
  line counts, breaks and widths and 353 painter passes in each configuration. Each staged seed passed a check against
  its own runs with the environment check on, and again from where it sits. Its record keeps the record of the seed it
  replaced under `replaced`, so the line's attributions (79 lost pairs without facts, 0 with them) stay beside the seed.
  The tests gate's seeds didn't change: they are per derived family, and `twins` is a development set; tier 2's seeds
  have held it since the string storage fix.
- With no supplied facts the lab and tests records lose pairs against seeds that were recorded with the lab's facts (Chrome
  79, 208 and 276; Firefox 100 and 167); the like-for-like facts records lose what round 3's staged seeds lost (rebuild/
  TESTS.md §9).

## Page-history dependence

In WebKit a few cases lay out differently depending on the cases observed before them in the same page
(`WEBKIT-HOST.md`). To find them, run a case file in two orders and score one run against the other:

```sh
python3 .artifacts/session/with-browser-lock.py lab-host-forward -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=<cases> --out=<dir>/forward
python3 .artifacts/session/with-browser-lock.py lab-host-reverse -- \
  bun rebuild/lab/run.ts --browser=webkit-host --cases=<cases> --out=<dir>/reverse --order=reverse
bun rebuild/lab/score.ts --rows=<dir>/reverse/webkit-host-rows.ndjson --cases=<cases> \
  --out=<dir>/reverse/webkit-host-summary.json --per-case=<dir>/reverse/webkit-host-per-case.ndjson \
  --native-compare=<dir>/forward/webkit-host-rows.ndjson
```

- `--order=reverse` runs the selected cases backwards, and `--order=shuffle:<seed>` shuffles them with a seeded
  generator. `--limit` and `--family` select first, then the order applies, then cases are grouped by page context.
  So contexts run in another order too, and cases in a shared document get other predecessors. `run.json` records
  `order`.
- `--native-compare` reads the other run's row for each case. webkit-host and Safari rows compare with each other. A
  case is history-dependent when the two native observations differ in the native line count, code point/node/element
  collection lengths, any rect count, any rect's x, width or native line, or any slot float's x, y or width: the complete
  native scorer view. Float32 noise
  counts (12.28799819946289 against 12.288000106811523), since a predicted value can't equal both. Two native
  observation errors agree.
- History-dependent cases count in `rows` and in the native diagnostics, but not in the metric counts, reasons, facts,
  gaps, histograms, family counts or examples. Each browser's `historyDependent` block has `compared`, `rows` (the
  history-dependent count) and `cases`, which lists each one with the difference, its metrics and its native lines.
  `geometryOnly` counts cases whose raw geometry differs only in y or height, and names up to 20. `missing` and
  `caseDiffers` count cases the other run didn't observe, or observed in another version. Those are scored normally. The
  scorer exits nonzero when no case could be compared.
- A comparison only finds the dependence the two orders expose. Compare runs of the same case file on the same browser
  build and environment; a shuffled run widens the net.
- Each row's `env.documentCaseIndex` and `env.previousCaseId` say which cases the document observed before it. To test
  suspects, run them each alone in a fresh browser process with `sharded.ts --isolate` ("Sharded runs and isolation"), or
  put a part boundary right before them with `run.ts --part-cases` ("Parts"). Two orders of one set can't show history both
  orders share; an isolated row can.

## Measure first

The usual protocol lays a case out natively and then predicts it. An application does the opposite: it measures before any
DOM text exists. Under `run.ts --measure-first` every case of a document is predicted (the library's layout, the observation
port's expected rects, the painter limits) before the document's first native layout, and then the cases are laid out natively
and painted from the held predictions, in the same order. A document is what it is under the usual protocol: the cases of one
page context inside one part. The driver sends a document's cases twice, as `predict` chunks and then as `observe` chunks; the
page holds the predictions meanwhile, so a page that starts again inside a document fails the run, and a timed part
(`--part-ms`) ends only where a document does. Rows keep their format, with `env.measureFirst` (`predictionIndex`,
`documentPredictions`), and `run.json` lists the documents. It goes with neither `--record-measurements` nor `--predict-only`.

```sh
# tier 2 under the protocol; the transitions against the reference are printed across protocols, and the gate doesn't run
bun rebuild/tests/browser-sets.ts --browser=firefox --groups=smoke,development --measure-first --out=<dir>/mf
bun rebuild/tests/browser-sets.ts --browser=firefox --groups=smoke,development --out=<dir>/usual
# case by case: native observations, predictions, painted lines; a second usual run is the control
bun rebuild/tests/compare-sets.ts <dir>/usual <dir>/mf --out=<dir>/compare.json
bun rebuild/tests/ledger.ts transitions <dir>/usual/ledger <dir>/mf/ledger --allow=protocol
# the hand-written cases, one run.ts job per protocol, then compare-rows.ts
python3 .artifacts/session/with-browser-lock.py mf -- bun rebuild/lab/run.ts --browser=chrome --cases=rebuild/lab/measure-first-cases.ndjson --out=<dir> --measure-first
```

A ledger records the protocol in each set's `runArgs`, so a measure-first ledger meets a usual one only with
`--allow=protocol`. `sharded.ts` and `fresh.ts` pass the option through (`-- --measure-first`, `--run-args=--measure-first`);
every shard or part is then a document of its own, as under the usual protocol.

**What ran on 2026-09-18** (pinned Chrome 153.0.8010.50 and Firefox 156.0, webkit-host; forward order; both configurations;
`.artifacts/tests/runs/r4b-mf`, reports under `compare/`): smoke and the development sets, usual, measure first and usual
again as the control, and the family sets, usual and measure first. The control differs from the first usual run on no case
in any browser or configuration, and a second measure-first run in Firefox equals the first on every case.

| Browser | Cases (development / families) | Native observations that differ | Predictions | Painted lines |
|---|---|---|---|---|
| Chrome | 25,523 / 24,632 | 0 / 0 | 0 / 0 | 0 / 0 |
| Firefox | 25,415 / 21,826 | 120 / 0 | 121 without facts, 115 with / 0 | 121 / 0 |
| webkit-host | 25,463 / 21,994 | 0 / 0 | 0 / 0 | 0 / 0 |

- **Firefox: the process's font fallback state.** Every case that moves holds U+1F600, all in one suite sample part, from
  the first case that asks for its text presentation (`😀︎`, `suite/measurement`) on: a plain `😀` in 16px Arial is 17px wide
  under the usual protocol and 16px under measure first, where the Canvas pass has made every lookup of the document,
  the U+FE0E requests among them, before the first native layout. It is the Gecko owner's `page-history` class
  (`GlobalFontFallback` and the character maps loaded so far, gfxPlatformFontList.cpp:1474-1486; font matching's state,
  gfxTextRun.cpp:3559-3569): 116 of the 121 cases are history-dependent in the two-order reference, and the other 5 are the
  U+FE0E cases that change the state. The OffscreenCanvas follows the state: without supplied facts 119 of the 121 pass all
  four metrics under both protocols, and the ledger has no status transition; with the lab's facts 5 cases go from pass to
  `fail covered by page-history` on widths (the prediction is pinned where the native width moved). Two identical usual
  runs agree on every case, so on these sets it is order, not timing.
- **Firefox, the hand-written cases**: a paragraph with a plain emoji that comes before the U+FE0E paragraph
  (`measure-first/emoji-before-16px`) is predicted at 16px per emoji, exact when it was measured, and laid out at 17px after
  the later paragraph's prediction moved the state: widths and painter fail, with no gap when the facts are supplied (without
  them only `optical-size` covers it, which fires everywhere). Under the usual protocol it passes. A run whose predictor asks
  Canvas nothing observes what the usual protocol observes; under measure first it is the Canvas lookup for the later
  paragraph that moves the state before the earlier one is laid out.
- **Chrome: nothing moves**, the 960 platform UI font cases of `rule/system-fonts-and-sizes` and the hand-written ones (the
  system font at 8, 12, 16, 24 and 32px in one document) included, and a run whose predictor asks Canvas nothing observes
  the same native layouts. Chrome's font cache keys a platform font by the zoomed size and the font description's options,
  text-rendering among them, and not by the specified size (font_description.cc:308-331), while opsz and HarfBuzz's ptem come
  from the specified size of whichever text made the font (platform bug ledger item A). The probes of
  `rebuild/probes/measure-first.ts`, each alone in a fresh process at DPR 2, DOM `system-ui` text at 8px to 16px after a
  context measured at the zoomed size: a context with default settings changes the DOM's widths (16px: 71.24px for 81.125px);
  the library's measuring context, which sets text-rendering `optimizeLegibility`, doesn't; the same context does where the
  page's text sets `text-rendering: optimizeLegibility`; and a font check's context at text-rendering auto does (probes
  `font-check` and `font-check-word`), which is how the checks measured until the correctness line. For a named
  font with an opsz axis check 4's zoomed-size context then shared the DOM text's key: after the DOM it got the DOM's
  font, the advances looked linear and the fact came out false, with no gap; before the DOM the DOM text took the check's
  font. No lab font has the axis, so that was read from the probes and the source (research/ROUND4-CRITIC.md "Fix first" 1),
  not observed. The checks now measure as the engine's contexts do (`src/measure/font-checks.ts` `FontChecks.textRendering`, with
  the source reading in the header): probes `font-check-legibility` and `font-check-legibility-word` leave every DOM width on
  the clean rule, and
  the change moved no status, prediction or painted line on the tier sets (`rebuild/tests/known-tail.json`,
  `blink/font-check-contexts-share-the-dom-font`, closed). WebKit's key holds the size opsz is set from, and Gecko is asked
  nothing, so neither had the defect.
- **webkit-host: nothing moves.** The break cache is the DOM's alone, and both protocols lay the cases out and paint them in
  one order; Canvas has no part in it.

**What an application should be told.** In Chrome and WebKit, nothing: measuring first gives the lines that measuring after
gives, on every case here. One Chrome note belongs to platform bug A rather than to an order: a page whose text sets
`text-rendering: optimizeLegibility` shares platform fonts with the library's contexts, the font checks' among them, which
matters only for fonts with an optical size axis at a zoom other than 1. In Firefox, the width of
an emoji depends on whether the process has looked up an emoji's text presentation (U+FE0E) before: a prediction holds for
the state it was measured in, so text measured before such a lookup and laid out after it can be 1px per emoji off (at 16px),
and the library reports `page-history` on the text that makes the lookup, not on the emoji measured earlier.

## Comparing another predictor on the same observations

Main's predictor, or any predictor returning line ranges, runs with `--predict-only` and scores against a native run of
the same case file in the same environment:

```sh
python3 .artifacts/session/with-browser-lock.py lab-main -- bun rebuild/lab/run.ts --browser=chrome --cases=<cases> \
  --out=<dir>/main --predictor=rebuild/lab/baselines/main-predictor.ts --predict-only
bun rebuild/lab/score.ts --rows=<dir>/main/chrome-rows.ndjson --native-rows=<dir>/forward/chrome-rows.ndjson \
  --out=<dir>/main/chrome-summary.json --per-case=<dir>/main/chrome-per-case.ndjson
```

## Triage records

`triage.ts` writes research/TEST-ARCHITECTURE.md §7.1's records for the cases where main passes and the rebuild fails,
from rows only, with the scorer's rules:

```sh
bun rebuild/lab/triage.ts --rows=<rebuild rows, file order> --reverse-rows=<rebuild rows, reverse> \
  --main-rows=<main rows> [--main-reverse-rows=<main rows, reverse>] [--decisions=<decisions.ndjson>] \
  --out=rebuild/lab/triage/main-<browser>.ndjson --summary=<summary.json>
```

- Population: main's line count passes, and the rebuild fails lineCount, or fails breaks while main's visible breaks don't
  fail. Main's predict-only rows take the rebuild row's native observation.
- `class`: A, main's count right and visible breaks wrong; B, nothing shows where main's lines start; C, main passes
  everything observable. Class D (widths only) can't arise, since main's widths aren't compared.
- `isolation`: `moved` when the reverse run, or main's own session, derives other native lines; `unchecked` without
  reverse rows.
- `outcome`, by the first rule that applies: undecided when the isolation moved (a page-history case, TEST-ARCHITECTURE
  §6.5); accidental for class A; accidental when main's prediction changes and fails in reverse order; accidental,
  `provisional`, when main's zero-width placement fails; undecided for class B; a fact to learn for class C, with `fact`,
  `probe` and `family` null until they exist. An opinion dropped needs a decision record (`{ labCase, browser, outcome,
  fact?, probe?, family?, reason }`), which overrides the rule and sets `decidedBy: 'hand'`.
- Each record also names main's case ids from the lab case's origin, the metrics main's suite required, the rebuild's and
  main's statuses, the gaps the rebuild's layout reports, and the environment key.

## Fresh rounds

Fresh generated cases find classes that iterated and sealed sets don't (research/ROUND2-EVALUATION.md), so the ceiling is
measured on sets nobody iterated on. `fresh.ts` makes one, runs it and reports it:

```sh
bun rebuild/lab/fresh.ts --browser=chrome --seed=r3-blink-1                 # an owner's loop: file order only
bun rebuild/lab/fresh.ts --browser=firefox --seed=r3-eval-1 --both-orders   # evaluation: history dependence checked
bun rebuild/lab/fresh.ts --browser=chrome --seed=r3-blink-1 --report-only   # print the report again, re-scoring if score.ts changed
bun rebuild/lab/fresh.ts report --browser=firefox --runs=<scored run dir>[,<dir>...]   # the same report over any scored runs
```

Start it without the lock: it runs every browser job under `with-browser-lock.py` itself. A seed is a new name
(letters, digits, dots, dashes); everything lands in `.artifacts/lab/fresh/<browser>/<seed>/`. A second call with the same
browser and seed resumes: nothing that exists is generated, run or scored again.

1. **Generate**, without any case id used so far (`cases/used-ids.ts`: every case file a `run.json` under `.artifacts`
   names, `.artifacts/lab/cases`, `final-20260916/cases`, every sealed set, every earlier fresh set, the smoke cases), under
   a generation lock so two rounds started together can't draw the same case (a lock without an owner file is taken over
   once the LOCK has been without one for 10 s; until 2026-09-19 the 10 s were the waiter's own, so a waiter of more than
   10 s could take a live lock over during its release, and two of the final evaluation's sets were generated at once).
   Kinds (`--kinds=`, default all):
   - `runs`, `ws`, `policy`: the generators of `cases/` under the seed, about 5,200 cases; `--repeat=N` adds the seeds
     `<seed>#2` to `<seed>#N`.
   - `rich-prewrap` (since the round 4 evaluation): `cases/rich-prewrap.ts` under the seed, about 1,330 cases a seed, the
     only kind with `white-space: pre-wrap` in inline structure; `--repeat` applies to it too.
   - `suite`: `--suite-sample=N` (default 3,000) unused suite cases by one quota per family, as sealed sets draw them.
     144,156 of the suite's 238,524 cases were unused on 2026-09-17; each round uses what it draws, and on 2026-09-18 none
     was left (1,406,595 used ids from 2,561 files), so the kind draws 0 cases until the suite gets a new source. The round 4
     evaluation's sets made up for it with `--repeat=3 --widths-per-paragraph=2`: about 25,000 cases a set.
   - `family-widths`: the rule and feature family paragraphs at seeded widths (`cases/family-widths.ts`). The family
     builders in `rebuild/tests/families` never draw from their seeded stream, so every seed gives the same 3,276 paragraphs
     at the same derived widths and a new derivation would make no new case. This kind takes the browser's derived family
     cases (`--family-dirs=`, default the 09-16 rule and 09-17 feature derivations) and lays each paragraph out at
     `--widths-per-paragraph=N` (default 1) new widths: 70% within ±2 to ±128 units of 1/64 px of a derived bracket, 30%
     between the paragraph's narrowest and widest brackets. A paragraph with line slots stays at or above its narrowest
     derived width, so the slot protocol holds. A draw that meets a used id is drawn again, up to 8 times, and the kind's
     log line and manifest say how many draws met one and how many widths were given up (since 2026-09-19: before, the
     line read "0 used ids left out" whatever the loop had skipped; the kind had shrunk 8 to 12% between the correctness
     line and the final evaluation, research/FINAL-EVALUATION.md).
   A seed names one set of flat cases: a second browser asking for the same seed copies the first one's `runs`, `ws`,
   `policy` and `suite` files, so browsers compare on the same cases. `family-widths` is per browser. Giants (below) go to
   `cases/giants.ndjson` and run only with `--giants=run`, exclusively, after the parts.
2. **Split** this browser's cases into `--parts=N` contiguous parts in file order, balanced by text length (default 3, the
   browser's slots; installed Safari 1, where `--run-args=--allow-safari-frontmost` is needed and a part must stay under 8
   minutes).
3. **Run** every part at the same time, one job per part and order under the lock. `--config=no-facts|facts` runs the set
   under one of the tiers' two configurations ("Test tiers") and names its runs, report and round record after it
   (`runs-<config>/`, `report-<config>.json`, `round-<config>.json`), so one seed's cases and parts serve both; without it
   the predictor is `--predictor`'s or `run.ts`'s default and the names are `runs/`, `report.json` and `round.json`. A failed job is never run again: the
   round reports it with the log's tail and exits 2, and `--rerun-failed` runs it once more after the cause is fixed (the
   failed folder is renamed, not removed). A job that was interrupted counts as failed.
4. **Score** every finished part with `score.ts` (`--native-compare` between the orders under `--both-orders`). A part is
   scored again when `score.ts` is newer than its summary, or with `--rescore`.
5. **Report**, printed and written to `report.json`, over the forward parts, outside history-dependent cases and protocol
   rows:
   - *Open failures*: lineCount, breaks or widths failures whose per-case `lineGaps[metric].covered` isn't true. `score.ts`
     decides coverage; the report only reads it. Each gets a signature: family | metric | the fonts, scripts and named
     characters (spaces other than U+0020, format characters, controls) and styles involved | the size. For widths the
     involved text is the nodes on the failing lines whose native width differs from the port's, and the size is the
     largest such difference in engine units (LayoutUnits of zoomed px, app units, 1/64 px) times the number of differing
     node rects; `no-node-differs` says only the line's sum is off. For lineCount and breaks it is the text between the
     predicted and the native break on the first line that disagrees, and the size is the line count difference and how
     many UTF-16 units moved. A coarse table (metric | fonts | scripts | size) comes first, because one cause often spreads
     over many suite families.
   - *Painter-only*: painter failures without a covered explanation where the three prediction metrics pass, in the coarse
     form.
   - *Residual classes* (`score.ts` `RESIDUAL_CLASSES`, read from the per-case `residual`): failures without a covered
     explanation on rows the scorer matched to a class are counted apart, probed members apart from members matched by
     signature alone. A signature match is not a probe. Two classes are registered, both Gecko's on an OffscreenCanvas: one
     shaping unit 1 au off, and the synthetic bold offset.
   - *Gap firing*, from the per-case `firing` and `fires` ("Gap firing and lift"): per gap, the share of passing lines it
     fires on, the share of passing cases, the share of the failing lines of prediction failures and the lift between them;
     painter-only failures are in neither. An owner who adds or widens a condition quotes these before and after.
   - With both orders, the ids that are open in reverse order only.

On `r3-tool-check-1` (11,477 Chrome, 11,265 Firefox and 11,255 webkit-host cases, both orders, scorer 5) the report's
open counts equal the summaries' `lineLocal.withoutLineGap` less the residual members.

## Giants

A giant is a case whose paragraph exceeds 50,000 UTF-16 units (`cases/parts.ts` `GIANT_UNITS`). One can take minutes, so
at 25 cases a round trip they stalled round 2's jobs. They live in `.artifacts/lab/cases/giants.ndjson` and run on their own,
exclusively, one case per round trip:

```sh
python3 .artifacts/session/with-browser-lock.py giants-chrome --browser=all -- \
  bun rebuild/lab/run.ts --browser=chrome --cases=.artifacts/lab/cases/giants.ndjson --out=<dir> --chunk=1 --stall-ms=1800000
```

`bun rebuild/lab/cases/giants.ts --move` takes them out of the case files under `.artifacts/lab/cases` and
`.artifacts/lab/final-20260916/cases` and records the move in `giants.moves.json`: per case its id, the file and line it came
from and its length, and per file the sha256 and case count before and after. Before it replaces a file it checks that
putting the giants back at their recorded lines gives the original hash, and the original goes to the Trash. Ids don't
change, so a giant's row in an old run of `heldout-suite-sample.ndjson` compares with its row in a giants run by id:
`score.ts --rows=<giants rows> --cases=giants.ndjson --native-compare=<old rows>`, and a gate check that wants every
baseline case (`gate.ts --complete`) takes the giants run beside the held-out run. `--scan=<file>[,<file>...]` only lists
giants. Fresh rounds, and sealed sets from sealed-3 on, keep their giants in a `giants.ndjson` of their own; sealed and
sealed-2 keep theirs inside `suite-sample.ndjson`, so split those files with `cases/parts.ts`, which sets giants apart by
length without showing anything.

## Sealed held-out sets

`bun rebuild/lab/cases/seal.ts --out-dir=.artifacts/lab/sealed --label=sealed-<date>` generates runs, ws and policy from a
fresh random seed and a 10,000-case suite sample drawn by one quota per family, without any case id used so far: every
case file a `run.json` under `.artifacts` names, every file under `.artifacts/lab/cases` and
`.artifacts/lab/final-20260916/cases`, every case file of an earlier sealed set (a folder with a `SEAL.json`), every fresh
round's set, and `smoke-cases.ndjson` (`cases/used-ids.ts`, under the generation lock that fresh rounds also take). Since
sealed-3, giants leave the generated files for `<out-dir>/giants.ndjson` before hashing, by length alone. The suite import
reads the suite's row files through `zstd` now that `compress-rows.sh` compressed them. Four sets exist: `sealed-4-20260918`
in `.artifacts/lab/sealed-4`, generated in the round 4 evaluation without any of 1,406,595 used ids from 2,561 files: runs
2,579, ws 1,011 and policy 1,492 cases, no giant, and an empty suite sample, because no suite case was left unused ("Fresh
rounds"); run once there, counts only (in Chrome without the one policy case of the native hang's signature, set aside
without being opened: `.artifacts/ceiling-20260917/evaluate-r4/tools/sealed4-hang.py`); `sealed-3-20260917`
in `.artifacts/lab/sealed-3`, generated in ceiling round 3 without any of 714,404 used ids from 359 files, both earlier
sealed sets and the first fresh sets included: runs 2,580, ws 1,011, policy 1,594, suite sample 9,996 and 4 giants, with 0
ids shared with any other set (checked by id only), run once in the ceiling round 3 evaluation, counts only; and two
spent ones: `sealed-20260917` in
`.artifacts/lab/sealed` (run once in the ceiling round 1 evaluation) and `sealed-2-20260917` in `.artifacts/lab/sealed-2`,
generated in ceiling round 2 without any of 669,645 used ids from 270 files, the first sealed set's included: runs 2,579,
ws 1,014, policy 1,597 and suite sample 10,000 cases, with 0 ids shared with the first set (checked by id only). The census's full-suite chunks aren't excluded, since they
hold every suite case. The seed goes only into `<out-dir>/SEAL.json`, with the sha256 of every file; origins and
summaries name it by its label (`generate.ts --seed-label`). `rebuild/lab/baselines/<label>.json` holds the same record
without the seed, for the repository. Owners must not open, run or score the files before the evaluation stage; then
they run like any case file and score with `score.ts --sealed`. Any look at a case burns the set (TEST-ARCHITECTURE §3).

## Range geometry, per browser

These findings from the smoke runs shaped the previous scorer's visibility rules. The observation ports now explain them
from engine source (research/observe-blink.md, observe-webkit.md, observe-gecko.md):

- Chrome 153: at DPR 2, Range and element rects are LayoutUnits of zoomed px divided by 128 exactly (Arial `h` at
  16px is 8.8984375px). Every positive code point rect value and every observed line width in the smoke and 5,000-case
  runs sits on the 1/128px grid. A letter after a selected soft hyphen (in RTL
  the letter before it) has positive rects on both lines, and the one on the hyphen's line is an exact copy of the
  hyphen's own rect. A lone ZWSP, joiner or soft hyphen can make a line with only zero-width rects. Controls other than
  TAB, LF and CR mostly get an advance inside the text node's box: 1,185 of 1,429 in the owners' and validation Chrome
  rows, such as U+009D 16px and VT 5.328125px wide in 16px Arial.
- Safari 27: whole-node rects are float glyph positions like Chrome's (the same 190.3046875). A code point Range
  edge inside a text box is snapped outward to whole CSS px ('T' is [0, 10] for a 9.77px glyph), and the right edge
  of a code point that ends a box is floored, mostly to 1/64px (190.296875 for a box ending at 190.3046875), in some
  lines to whole px (80 for 80.22). Controls other than TAB, LF and CR get the font's `.notdef` advance (U+001C 12px in
  16px Arial), so a line can hold only a control. Safari also splits a cluster's advance between a letter and a
  following ZWSP ('c' [17, 22) and ZWSP [21, 25.797) where the line ends at 25.796875). So widths come from the
  whole-node rects wherever possible, and a box's right edge is the float32 sum of its x and width (30.469196319580078 +
  71.9345703125 is 102.40376281738281, where the float64 sum falls between float32 values). When hanging white space
  forces code point rects, an extent edge off the whole px ends a box, and the extent takes it from the one whole-node
  rect on the line whose right edge floors to it (448.59375 gives 448.5999755859375). A whole-px edge counts only where
  a box edge equals it. Otherwise the width is unobserved. Inline layout positions are float32 CSS px, not LayoutUnits, so observed widths
  mostly sit off the 1/64px grid (892 of 1,314 smoke lines; 10,838 of 14,703 in the host's 5,000-case run), and
  scoring snaps them. After an inline box end (`</span> foo`), the collapsed space's rect has zero width on the next
  line. With a `text-transform` that changes length, Range offsets address the transformed text. The lab sets
  `text-transform: none`.
- Firefox 156: rect values are app units (1/60px) read through float32. Some are float32 sums one step off the
  nearest float32 of the app unit value (285.83331298828125 for 17150 au), so the grid checks allow two steps. Every
  observed smoke line width sits on the grid. A precomposed base letter can have a zero-width rect and its combining
  mark the advance, and so can an emoji before VS16 and a letter before ZWNJ or ZWJ. VT and FF keep zero-width rects on the line they end, and the space before them keeps its width.
  Of 1,186 controls other than TAB, LF and CR in the owners' and validation Firefox rows, 1,164 have zero-width rects and 4 have 1px
  advances (U+0000 in 16px Times New Roman, VT, FF and U+0000 in 24px Amiri).
- webkit-host on WebKit 22625.1.29.11.27, Safari 27.0's build: the same Range geometry as installed Safari 27 wherever
  both observed a case after the same earlier cases in the document. In WebKit a few cases (web-font Arabic with
  brackets, soft hyphens next to controls, 12px URL seams) depend on the cases before them, in the host and in
  Safari alike. `WEBKIT-HOST.md` has the comparison and the rule for when host rows may stand in for Safari.
