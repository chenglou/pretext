# Lab

The lab observes how each installed browser lays out a styled paragraph and scores a prediction of those lines. It
doesn't depend on the old library in `src/`.

- `types.ts`: shared shapes. Cases (`Case`, `Paragraph`, `TextRun`, `FontDecl`) and lab rows (`LabRow` and its parts).
- `page.ts`: the browser page. It builds the native paragraph, records Range geometry, runs the prediction hook and the
  observation port over its layout, and records the painted lines.
- `predictor.ts`: the prediction hook, the only library-facing import in the page.
- `observe/`: the observation ports, one per engine (DESIGN.md §9). Each derives, from a layout, the Range rects its
  browser reports, by that engine's geometry code, and imports only types from `src/model.ts`.
- `run.ts`: the driver. It reads the browser build from the app bundle, sets or reads the browser process's languages,
  serves the page, opens one background browser session and streams rows to NDJSON.
- `languages.ts`: the browser-process languages each browser launches with, and the given facts the driver derives for
  the library (see "Browser-process languages"); `languages.test.ts` its rules.
- `score.ts`: the offline scorer.
- `score.test.ts`: the scorer's comparison rules on small hand-made rows (`bun test rebuild/lab/score.test.ts`), built with
  `row-fixtures.ts`.
- `triage.ts`: triage records for the cases where main passes and the rebuild fails (see "Triage records");
  `triage.test.ts` its rules.
- `gate.ts`: the no-regression gate over scored runs, and `gate.test.ts` its rules.
- `cases/seal.ts`: seals a held-out case set (see "Sealed held-out sets").
- `tsconfig.json`: the repo's strict settings over the lab and its case generators
  (`bunx tsc -p rebuild/lab/tsconfig.json --noEmit`).
- `VALIDATION.md`: what the end-to-end validation ran, found and fixed.
- `WEBKIT-HOST.md`: how the WKWebView host's rows compare with installed Safari's, and when they may stand in for it.
- `smoke-cases.ndjson`: 25 hand-written cases covering spans, bare white-space text nodes, pre-wrap with trailing
  spaces and empty lines, `pre`, `pre-line`, `break-spaces`, `nowrap`, RTL Hebrew and Arabic, CJK, keep-all, emoji,
  soft hyphens, combining marks, ZWSP, mixed font sizes, tabs, a span with its own `lang`, a fixture web font and a
  fractional line height.

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
--native-rows`.

Before launching, it reads the build from the app bundles, because user agents can't tell builds apart (Chrome's says
`153.0.0.0` for every 153 build): Chrome's and Firefox's `CFBundleShortVersionString`, which are also the engine builds;
Safari's, with WebKit.framework's `CFBundleVersion` as the engine build, for Safari and for webkit-host, whose user agent
copies installed Safari's version; and the OS build from `sw_vers -buildVersion`. Every row carries it as `build`, and the
page gives the engine build to the predictor. Every row also carries `languages` (see "Browser-process languages"). It
writes `<out>/<browser>-rows.ndjson`, one row per case, and `<out>/<browser>-run.json` with the build, the languages,
totals, the case order, page contexts, the environment, the languages pages report and errors. It exits nonzero when
anything goes wrong: invalid cases, a launch or page failure, a stall, a native observation error, a missing row, a user
agent that doesn't name the build read before launch, Chrome renderers without one agreed `--lang`, or a change of user
agent, DPR, visual-viewport scale or reported languages during the run. A prediction error is a result, not a lab
failure.

## Browser sessions

Sessions stay in the background and never activate a window.

- Chrome: installed Chrome, headed, in its own `--user-data-dir` under `.artifacts/profiles/`, started with
  `open -n -g -a` and `--no-startup-window --remote-debugging-port=0`, plus `-AppleLanguages` and a
  `Default/Preferences` file with the accept languages (see "Browser-process languages"). Headless Chrome can lay out at
  zoom 1 while reporting DPR 2. Chrome activates itself whenever it shows a window the normal way, `open -g` or not (a
  startup window took focus for half a second), so the driver opens the lab window with the DevTools protocol's
  `Target.createTarget { newWindow: true, background: true }`, which Chrome shows inactive. It uses the protocol for
  nothing else.
- Firefox: headed, in its own profile under `.artifacts/profiles/`, started with `open -n -g -a Firefox --args
  --new-instance`, with its language prefs in `user.js`. macOS 27 blocks a shell-spawned Firefox from its data folders,
  and headless Firefox draws emoji at odd widths.
- Safari: a single-tab window in the user's Safari, created through AppleScript without activating it
  (safaridriver doesn't work on macOS 27). A new document in a frontmost Safari opens over the user's windows and
  takes keyboard focus there, so the driver first waits, for at most 10 minutes, until Safari isn't the frontmost
  app, then exits with an error. `--allow-safari-frontmost` skips that wait. If Safari takes focus anyway, the driver
  gives it back to the previously frontmost app. Closing removes only that uniquely identified tab.
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
first) and moves their profiles to the Trash. It launches once and never retries.

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
  processes' command lines at the page's first step.
- Firefox, `regionalPrefsLocale`: layout takes the first OS regional-prefs locale, which on macOS is
  `CFLocaleCopyPreferredLanguages()` canonicalized; no pref reaches it. The driver derives it from `AppleLanguages`
  (`zh-hans-us` here) and sets `intl.locale.requested`, `intl.accept_languages` and `intl.regional_prefs.use_os_locales`
  explicitly, which decide only the app locale, `navigator.languages` and Intl formatters.
- Safari and webkit-host, `preferredLanguages` and `icuDefaultLocale`: Safari takes its languages from the OS and can't
  take others per launch, and webkit-host stands in for Safari, so neither is launched with languages. The page sends
  `navigator.languages` with its first step, which WebKit fills with the first entry of the WebContent process's
  preferred languages, the list `FontDescription` reads for a Han `lang`. When that entry starts with `zh-` it decides the
  rule, and the given list is that entry; otherwise the list stays unknown and reports `ui-language`. webkit-host on this
  Mac shows `zh-CN` where the global `AppleLanguages` start with `zh-Hans-US`, so the list isn't the UI process's raw
  `AppleLanguages`, whatever WebKit does in between. The ICU default locale comes from launchd's locale variables, else
  `en_US_POSIX` (specs/webkit-gaps.md §8.2 [I]).

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
   browser refuses are recorded in `rejectedStyles`.
2. Lays it out, records `document.fonts.status`, awaits `document.fonts.ready` and records the status again. It also
   records `missingFonts`: the named families in the paragraph's and runs' font lists that the page can't resolve.
   A family resolves when a probe string measures differently in Canvas from at least one of two generic fallbacks;
   each family is probed once per document. Uninstalled fonts fall back silently, and Safari hides user-installed
   fonts from web content.
3. For every code point, records its UTF-16 offset in the concatenated run text, its length, and every Range client
   rect over the owning run's text node, relative to the paragraph's content box. It also records `runRects`: the
   rects of a Range over each run's whole text node.
4. Records the paragraph height and the environment: user agent, DPR, visual-viewport scale, page language,
   fixture fonts, window sizes, visibility and focus, `navigator.languages` and the default Intl locale, plus the
   document's history: `documentCaseIndex`, how many cases the document observed before this one, and `previousCaseId`,
   the last of them (null for the first).
5. Calls `predict(c, { browser, build, languages })`. When it returns a layout, the page runs `observe/<engine>.ts` over
   it, measuring Canvas live where the port asks (only the WebKit port does), and records the prediction. Then it calls
   `paint(c, prediction, host)`. If that returns elements, one per line with a line box, the page appends them to a host
   of the paragraph's width. For each element it records the height, the Range rects of every text node inside it and
   their horizontal extent, the text of those nodes in document order, and every Range rect of each of its code points.

Under `--predict-only` the page skips steps 1-3 and records `native: { skipped: 'predict-only' }`.

## Prediction hook

`predictor.ts` exports `predict(c, { browser, build, languages }): LayoutPrediction | { error }` and `paint(c, prediction,
host): HTMLElement[] | null`. A `LayoutPrediction` is the library's input, the case paragraph with the font facts the
predictor gives and the process languages the driver gave, and the `ParagraphLayout` it computed with `build` as
`GivenFacts.build`. The page records an `EnginePrediction`: the layout without its Canvas call log, `measure` with the
counts of contexts, calls and memo hits, and `observation`, the rects the observation port expects, or the error it
threw. `paint` paints the same layout.

A predictor swapped in with `--predictor` may return line ranges alone, `{ lines: [{ start, end, width }], measureLog? }`
(`baselines/main-predictor.ts` does). The page records those as they are and doesn't paint. Rows recorded before the
observation ports, 2026-09-16 and earlier, carry that shape too.

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
types, so tools that compare rows use the scorer's rules. `SCORER_VERSION` is 3. Version 1 derived native lines and
widths from visibility rules; version 2 grouped every rect into native lines by vertical centre. Their rules and evidence
are in this file's git history.

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

  A rect no engine value encodes as is a mismatch. The width is unobserved on a line whose expected node rects don't
  span the engine width: Blink's hyphen that no node range reports (observe-blink U3), WebKit's content width a float32
  step from its boxes after trimming. When an expected node rect on the line is limited, a mismatch says so in its reason.
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

Both are unobserved when the line counts differ or nothing qualifies. An observation port error leaves every metric
unobserved.

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
  case is history-dependent when the two native observations differ in the native line count, or in any code point's or
  node's rect count, or in any rect's x, width or native line: exactly the values the scorer compares. Float32 noise
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
  one suspect, run a case file holding the case alone and one holding the suspect then the case: a single-case run
  gets a fresh document in a fresh browser process.

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

## Sealed held-out sets

`bun rebuild/lab/cases/seal.ts --out-dir=.artifacts/lab/sealed --label=sealed-<date>` generates runs, ws and policy from a
fresh random seed and a 10,000-case suite sample drawn by one quota per family, without any case id used so far: every
case file a `run.json` under `.artifacts` names, every file under `.artifacts/lab/cases` and
`.artifacts/lab/final-20260916/cases`, and `smoke-cases.ndjson`. The census's full-suite chunks aren't excluded, since they
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
