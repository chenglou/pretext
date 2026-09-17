# Lab

The lab observes how each installed browser lays out a styled paragraph and scores a prediction of those lines. It
doesn't depend on the old library in `src/`.

- `types.ts`: shared shapes. Cases (`Case`, `Paragraph`, `TextRun`, `FontDecl`) and lab rows (`LabRow` and its parts).
- `page.ts`: the browser page. It builds the native paragraph, records Range geometry, runs the prediction hook and the
  observation port over its layout, and records the painted lines.
- `predictor.ts`: the prediction hook, the only library-facing import in the page.
- `observe/`: the observation ports, one per engine (DESIGN.md §9). Each derives, from a layout, the Range rects its
  browser reports, by that engine's geometry code, and imports only types from `src/model.ts`.
- `run.ts`: the driver. It reads the browser build from the app bundle, serves the page, opens one background browser
  session and streams rows to NDJSON.
- `score.ts`: the offline scorer.
- `score.test.ts`: the scorer's comparison rules on small hand-made rows (`bun test rebuild/lab/score.test.ts`).
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
(approved by the maintainer on 2026-09-16); the lab window then opens over the user's windows.

Before launching, it reads the build from the app bundles, because user agents can't tell builds apart (Chrome's says
`153.0.0.0` for every 153 build): Chrome's and Firefox's `CFBundleShortVersionString`, which are also the engine builds;
Safari's, with WebKit.framework's `CFBundleVersion` as the engine build, for Safari and for webkit-host, whose user agent
copies installed Safari's version; and the OS build from `sw_vers -buildVersion`. Every row carries it as `build`, and the
page gives the engine build to the predictor. It writes `<out>/<browser>-rows.ndjson`, one row per case, and
`<out>/<browser>-run.json` with the build, totals, the case order, page contexts, the environment and errors. It exits
nonzero when anything goes wrong: invalid cases, a launch or page failure, a stall, a native observation error, a missing
row, a user agent that doesn't name the build read before launch, or a change of user agent, DPR or visual-viewport scale
during the run. A prediction error is a result, not a lab failure.

## Browser sessions

Sessions stay in the background and never activate a window.

- Chrome: installed Chrome, headed, in its own `--user-data-dir` under `.artifacts/profiles/`, started with
  `open -n -g -a` and `--no-startup-window --remote-debugging-port=0`. Headless Chrome can lay out at zoom 1 while
  reporting DPR 2. Chrome activates itself whenever it shows a window the normal way, `open -g` or not (a startup
  window took focus for half a second), so the driver opens the lab window with the DevTools protocol's
  `Target.createTarget { newWindow: true, background: true }`, which Chrome shows inactive. It uses the protocol for
  nothing else.
- Firefox: headed, in its own profile under `.artifacts/profiles/`, started with `open -n -g -a Firefox --args
  --new-instance`. macOS 27 blocks a shell-spawned Firefox from its data folders, and headless Firefox draws emoji at
  odd widths.
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

## Page protocol

The server serves `/lab?run=<id>&lang=<pageLang>&fonts=<families>`. `<html lang>` is set in the markup, so it holds
before any script measures. The page loads the listed fixture web fonts (`Case.fontFixtures`, from
`tests/wrapping/fonts`, hashes checked by the driver) as `FontFace` objects, then posts to `/api/step`. Replies carry
a chunk of cases, a navigation to another page context, or done. A page context is a page language plus its fixture
fonts. Cases are put in `--order`, then grouped by context, stable in order of first appearance, and every context
change reloads the page.
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
   fixture fonts, window sizes, visibility and focus, plus the document's history: `documentCaseIndex`, how many
   cases the document observed before this one, and `previousCaseId`, the last of them (null for the first).
5. Calls `predict(c, { browser, build })`. When it returns a layout, the page runs `observe/<engine>.ts` over it,
   measuring Canvas live where the port asks (only the WebKit port does), and records the prediction. Then it calls
   `paint(c, prediction, host)`. If that returns elements, one per line with a line box, the page appends them to a host
   of the paragraph's width. For each element it records the height, the Range rects of every text node inside it and
   their horizontal extent, the text of those nodes in document order, and every Range rect of each of its code points.

## Prediction hook

`predictor.ts` exports `predict(c, { browser, build }): LayoutPrediction | { error }` and `paint(c, prediction, host):
HTMLElement[] | null`. A `LayoutPrediction` is the library's input, the case paragraph with the font facts the predictor
gives (all unknown today), and the `ParagraphLayout` it computed with `build` as `GivenFacts.build`. The page records an
`EnginePrediction`: the layout without its Canvas call log, `measure` with the counts of contexts, calls and memo hits,
and `observation`, the rects the observation port expects, or the error it threw. `paint` paints the same layout.

A predictor swapped in with `--predictor` may return line ranges alone, `{ lines: [{ start, end, width }], measureLog? }`
(`baselines/main-predictor.ts` does). The page records those as they are and doesn't paint. Rows recorded before the
observation ports, 2026-09-16 and earlier, carry that shape too.

## Scoring

`score.ts` streams rows and compares each row's native rects exactly with the rects its observation port expects
(DESIGN.md §9). The case carried by each row supplies the text and styles. `--cases` restricts scoring to those ids and
fails when a row observed a different version of a case. `--native-compare=<other rows file>` compares two runs' native
observations (see "Page-history dependence"). Imported as a module, `score.ts` runs nothing and exports `scoreRow`,
`nativeLines`, `nativeView`, `nativeDifference`, `environmentKey`, `rowText` and `readLines` with their types, so tools
that compare rows use the scorer's rules. `SCORER_VERSION` is 2; version 1 derived native lines and widths from visibility
rules, and its rules and their evidence are in this file's git history.

Native lines. One observer assumption stays until vertical metrics are ported: rect centres on one line differ by less
than half the paragraph's px line height, and centres on different lines by half a line height or more. Every inline box
carries the line height and sits on its line's baseline, so only font metrics move centres within a line: Safari rounds
half-leading per line (Amiri 18px at line height 30 gives lines 29.984375px apart), and Firefox sizes a text frame by the
fonts it uses (an emoji line's rects are 21px tall, the next line's 19px). Every code point rect and whole-node rect with
positive height is grouped, zero-width ones included, and native lines are numbered from the top. A rect without positive
height, as Firefox reports for a frame without height, is placed on no line. Re-scoring every final-20260916 row set,
no line count version 1 observed moved from pass to fail. 5 WebKit cases moved from fail to pass: version 1 dropped a
line whose code points report only zero-width rects while a whole-node rect has the width. Every case version 1 left
unobserved because the paragraph height disagreed with its lines now has an observed count.

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

A prediction without an engine layout (an external predictor, or a row from before the observation ports) is scored for
lineCount against its predicted lines and for painted lines that wrap. Its breaks are unobserved, widths not applicable,
and the painter otherwise unobserved. An observation port error leaves every metric unobserved.

The summary (`--out`) has counts per browser and per family, reasons, facts, and per gap how many rows report it and how
many of those fail lineCount or breaks. It keeps a histogram of engine width minus native extent (LayoutUnits in Chrome,
app units in Firefox, 1/64 px in WebKit), timings, and failure and unobserved examples with the case text, the native
lines' code points, the engine lines with their widths and gaps, and the first predicted value that differs.
`environments` counts rows per `environmentKey`: browser, app and engine builds, OS build, DPR, visual-viewport scale and
scorer version, or the user agent for rows from before the driver recorded builds. `missingFonts` counts rows whose page
couldn't resolve a named family. `native` counts native line counts and unplaced rects. `historyDependent` is described
below. `--per-case` writes each case's four metrics, its facts, the gaps its layout reports, and `historyDependent` with
the difference when a comparison found one.

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
