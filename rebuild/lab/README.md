# Lab

The lab observes how each installed browser lays out a styled paragraph and scores a prediction of those lines. It
doesn't depend on the old library in `src/`.

- `types.ts`: shared shapes. Cases (`Case`, `Paragraph`, `TextRun`, `FontDecl`) and lab rows (`LabRow` and its parts).
- `page.ts`: the browser page. It builds the native paragraph, records Range geometry, runs the prediction hook and
  records the painted lines.
- `predictor.ts`: the prediction hook, the only library-facing import in the page.
- `run.ts`: the driver. It serves the page, opens one background browser session and streams rows to NDJSON.
- `score.ts`: the offline scorer.
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
dependence").

It writes `<out>/<browser>-rows.ndjson`, one row per case, and `<out>/<browser>-run.json` with totals, the case
order, page contexts, the environment and errors. It exits nonzero when anything goes wrong: invalid cases, a launch or page
failure, a stall, a native observation error, a missing row, or a change of user agent, DPR or visual-viewport scale
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
  app, then exits with an error. If Safari takes focus anyway, the driver gives it back to the previously frontmost
  app. Closing removes only that uniquely identified tab.
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
   fixture fonts, window sizes, visibility and focus.
5. Calls `predict(c, { browser, dpr })`. When it returns lines, it calls `paint(c, prediction, host)`. If that returns
   elements, one per predicted line, the page appends them to a host of the paragraph's width. For each element it
   records the height, the Range rects of every text node inside it and their horizontal extent, the text of those
   nodes in document order, and every Range rect of each of its code points.

## Prediction hook

`predictor.ts` exports `predict(c, env): Prediction | { error }` and `paint(c, prediction, host): HTMLElement[] |
null`. A `Prediction` is `{ lines: [{ start, end, width }], measureLog? }`. `start` and `end` are UTF-16 offsets into
the concatenated run text, `width` is the predicted line width in CSS px, and `measureLog` is the number of
`measureText` calls. Until `rebuild/src` exists, the stand-in returns one line holding everything, with the sum of
each run's Canvas width, and `paint` returns null.

## Scoring

`score.ts` streams rows and derives native lines from the rects alone. The case carried by each row supplies the
text and styles. `--cases` restricts scoring to those ids and fails when a row observed a different version of a case.
`--native-compare=<other rows file>` compares the derivation with another run's (see "Page-history dependence").
Imported as a module, `score.ts` runs nothing and exports `deriveNative`, `scoreRow`, `layoutGrid`, `nativeView`,
`nativeDifference`, `rowText` and `readLines` with their types, so tools that compare rows use the scorer's rules.

Lines. Positive-area rects (code point rects and whole-node rects) are sorted by vertical centre. A new line starts
where consecutive centres are half a line height or more apart. Every inline box carries the paragraph's px line
height and sits on its line's baseline, so centres on different lines are about a line height apart. On one line
they differ only by font metrics. The spread is real: Safari rounds half-leading per line (Amiri 18px at line height
30 gives lines 29.984375px apart), and Firefox sizes a text frame by the fonts it uses (an emoji line's rects are
21px tall, the next line's 19px). A rect that exactly copies a positive soft hyphen rect places nothing but the
hyphen: Chrome reports a chosen hyphen's box a second time, as a rect of the letter after it (before it in RTL).

A line can hold only zero-width content, such as a ZWSP, a joiner or a soft hyphen alone at a narrow width. A
zero-area rect establishes such a line where it sits half a line height or more from every positive rect, but only for
a code point that no positive rect places and that isn't SPACE, TAB or LF. Positive rects place a code point that has
them, and collapsed white space can't make a line: WebKit reports the collapsed space after an inline box end
(`</span> foo`) as a zero-width rect on the next line. Nearer, zero-area rects place nothing: Safari's extra zero-width
rect on the previous line, collapsed spaces at a line edge. In a 5,000-case Chrome run, all 464 paragraphs whose height disagreed with the lines of positive rects had
such lines, and every height agreed once they counted. A line's source range covers every code point with a rect on
it, so a line still counts when its only code point also has rects on another line. With a preserved newline mode,
consecutive LFs add empty lines (a trailing LF adds none). When all runs share the paragraph's font family, size and
language, the paragraph height must equal the line count times the line height. A span with its own `lang` can
resolve a generic family to another primary font, and baseline alignment then makes the line box taller.

Visible code points. A visible code point has a positive rect on exactly one line. It isn't a default-ignorable,
control or line/paragraph separator (TAB counts as white space). It isn't hanging white space either: SPACE or TAB in
a line's trailing run under `normal`, `nowrap`, `pre-line` or `pre-wrap`. Trailing spaces count under `pre` and
`break-spaces`. The trailing run is the white space and invisible code points at the line's end, back to an inked code
point, a no-break space or a control other than TAB, LF and CR. The engines keep such a control as a character, so the
space before it isn't at the line's end: Firefox keeps the space of `aaaa ` + VT in the line's width. The other space separators at a line end (U+3000, U+2000–U+200A and so on) are excluded, and that
line's width is unobserved, because no engine's hanging rule for them is verified here. A line's first visible code
point is compared at its grapheme start. Firefox can give a precomposed base letter a zero-width rect and put the
advance on its combining mark.

Metrics per case. `unobserved` and `not-applicable` are never passes.

- `lineCount`: native line count equals predicted.
- `breaks`: every native line's first visible grapheme equals the predicted line's, and no predicted line starts
  inside a grapheme or misses a visible code point.
- `widths`: scored only when breaks pass. The observed width is the line's horizontal extent. When nothing on the
  line except visible code points has width, the extent comes from the whole-node rects. Otherwise it comes from
  the visible code points' own rects. The observed and predicted values are both snapped to the row's layout
  grid, rounding half up, and the metric passes only on equality. The grid follows each engine's layout unit and the
  row's `devicePixelRatio`. Chrome lays out in LayoutUnits of zoomed px, so its grid is 1/(64 × DPR) CSS px (1/128 at
  DPR 2). Safari and webkit-host use 1/64 CSS px at any DPR. Firefox uses app units, 1/60 CSS px without device-pixel
  snapping. The summary keeps a histogram of predicted minus observed, in grid units.
- `painter`: each painted line's text rects form one line, and its extent equals the predicted width under the same
  grid rule. The painter paints trimmed and hanging white space, so the extent follows the widths rule over the painted
  line's own code points: over its visible code points, from its whole-node rects when no excluded white space has
  width there, otherwise from the visible code points' rects. Rows from before the page recorded painted code points
  have only whole-node rects. There, a line whose predicted range ends in white space has its painter metric
  unobserved; rerun the lab to score it.

The native observation is marked unobserved with a reason when a visible code point has positive rects on two lines
or visible code points interleave between lines. The same happens when a grapheme with ink has no positive rect, when
the height disagrees with the derived lines, or when derived lines overlap in source order (white space or a control
with a rect on a line out of order, as when Chrome gives a U+2028 at a line start a copy of the next letter's rect).
Widths are also unobserved for a line that ends at a positive-width soft hyphen (a Range rect doesn't establish
whether a hyphen was drawn), and for the Safari case below.

The summary (`--out`) has counts per browser and per family, reasons, the width and painter histograms, timings and
failure and unobserved examples with the case text, native lines and predicted lines. Its `native` block counts the
derivation alone, whatever the predictor: native line counts, where line widths come from, and the reasons line
counts, breaks and line widths are unobserved. `missingFonts` counts rows whose page couldn't resolve a named family.
`grid` is the first row's layout grid in units per CSS px, and `grids` counts rows per grid. `rectGrid` counts
positive code point rect values off the grid, and `native.widthGrid` counts observed line widths off it, with examples.
Both allow two float32 steps for values and four for widths. `historyDependent` is described below. `--per-case`
writes each case's four metrics, plus `historyDependent` with the difference when a comparison found one.

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
- `--native-compare` derives native lines from the other run's row for each case. webkit-host and Safari rows compare
  with each other. A case is history-dependent when the two derivations differ in any of: the line count, a line's
  source range or first or last visible code point, where a width comes from or why it's unobserved, a width as scored
  (grid units), or the unobserved reason for line counts or breaks. Two native observation errors agree.
- History-dependent cases count in `rows` and in the native diagnostics, but not in the metric counts, reasons,
  histograms, family counts or examples. Each browser's `historyDependent` block has `compared`, `rows` (the
  history-dependent count) and `cases`, which lists each one with the difference, its metrics and both runs' derived
  lines. `geometryOnly` counts cases whose raw geometry differs without changing the derivation, such as float32 noise
  (12.28799819946289 against 12.288000106811523), and names up to 20. `missing` and `caseDiffers` count cases the other run
  didn't observe, or observed in another version. Those are scored normally. The scorer exits nonzero when no case
  could be compared.
- A comparison only finds the dependence the two orders expose. Compare runs of the same case file on the same browser
  build and environment; a shuffled run widens the net.

## Range geometry, per browser

These findings from the smoke runs shape the rules above:

- Chrome 153: at DPR 2, Range and element rects are LayoutUnits of zoomed px divided by 128 exactly (Arial `h` at
  16px is 8.8984375px). Every positive code point rect value and every observed line width in the smoke and 5,000-case
  runs sits on the 1/128px grid. A letter after a selected soft hyphen (in RTL
  the letter before it) has positive rects on both lines, and the one on the hyphen's line is an exact copy of the
  hyphen's own rect. A lone ZWSP, joiner or soft hyphen can make a line with only zero-width rects.
- Safari 27: whole-node rects are float glyph positions like Chrome's (the same 190.3046875). A code point Range
  edge inside a text box is snapped outward to whole CSS px ('T' is [0, 10] for a 9.77px glyph), and an edge at a
  line's end is floored to 1/64px (190.296875). Safari also splits a cluster's advance between a letter and a
  following ZWSP ('c' [17, 22) and ZWSP [21, 25.797) where the line ends at 25.796875). So widths come from the
  whole-node rects wherever possible. When hanging white space forces code point rects and an extent edge is a whole
  pixel, the width is unobserved. Inline layout positions are float32 CSS px, not LayoutUnits, so observed widths
  mostly sit off the 1/64px grid (892 of 1,314 smoke lines; 10,838 of 14,703 in the host's 5,000-case run), and
  scoring snaps them. After an inline box end (`</span> foo`), the collapsed space's rect has zero width on the next
  line. With a `text-transform` that changes length, Range offsets address the transformed text. The lab sets
  `text-transform: none`.
- Firefox 156: rect values are app units (1/60px) read through float32. Some are float32 sums one step off the
  nearest float32 of the app unit value (285.83331298828125 for 17150 au), so the grid checks allow two steps. Every
  observed smoke line width sits on the grid. A precomposed base letter can have a zero-width rect and its combining
  mark the advance. VT and FF keep zero-width rects on the line they end, and the space before them keeps its width.
- webkit-host on WebKit 22625.1.29.11.27, Safari 27.0's build: the same Range geometry as installed Safari 27 wherever
  both observed a case after the same earlier cases in the document. In WebKit a few cases (web-font Arabic with
  brackets, soft hyphens next to controls, 12px URL seams) depend on the cases before them, in the host and in
  Safari alike. `WEBKIT-HOST.md` has the comparison and the rule for when host rows may stand in for Safari.
