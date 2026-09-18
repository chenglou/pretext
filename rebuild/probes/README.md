# Probes

The probe runner measures the numbered hypotheses at the end of each spec in `rebuild/specs/` in the installed
browsers. A probe is data: some markup, some Canvas measurements and a list of observations. The runner records raw
observations only. The agent who wrote the probes computes the verdicts afterwards from the output file. Probe pages
may read the DOM freely; this is research, not the library.

- `types.ts`: probe shapes and raw result shapes.
- `page.ts`: the browser page. It runs a document's probes in a fixed host and posts the results.
- `runner.ts`: the driver. It validates the probes, serves the page, opens one background browser session and writes
  `<out>/<browser>-probes.json`.
- `smoke.ts`: 16 trivial probes that exercise every runner path. They validate the runner, not a hypothesis.
- `blink-probes.ts`: the Chrome probes for the hypotheses in `blink-lines`, `blink-text`, `blink-canvas` and the Blink
  items of `CRITIC.md`, plus cross-cutting checks. Each probe is one script observation that returns raw values and
  `checks` (expected next to measured). `blink-probes-zoom.ts` and `blink-probes-sysui.ts` select the subsets that the
  forced-DPR, emulated-DPR and fresh-browser system-ui runs repeat. `blink-verdicts.ts` summarizes the output files
  under `.artifacts/probes/blink/` for `rebuild/specs/probes-chrome.md`; the commands are in the header of
  `blink-probes.ts`.

## Running

Every command that drives a browser runs under the shared browser lock, one browser per locked job. `runner.ts`
doesn't take the lock itself:

```sh
cd ~/github/pretext-rebuild
python3 .artifacts/session/with-browser-lock.py probes-chrome -- \
  bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/smoke.ts --out=.artifacts/probes/smoke
```

Options:

- `--browser=chrome|safari|firefox|webkit-host` (required). `webkit-host` is installed Safari's engine in the WKWebView
  host (see Browser sessions); it takes Safari's probes and writes `webkit-host-probes.json`.
- `--probes=<file>` (required): a `.json` file holding an array of probes or `{ "probes": [...] }`, or a `.ts` module
  whose default export (or `probes` export) is an array, or a function returning one.
- `--out=<dir>`: default `.artifacts/probes/<probes file basename>`.
- `--only=<substring>`: run only probes whose id contains it.
- `--probe-timeout-ms=N`: per probe, default 20000. A probe that runs out records an error and the run continues.
- `--stall-ms=N`: fail the run after this long without page activity, default 90000.
- `--firefox-prefs=<file.json>`: Firefox only. A JSON object of extra prefs appended to the profile's `user.js`, for
  example `{ "layout.css.devPixelsPerPx": "1.0" }` to lay out at 60 app units per device pixel on a Retina screen.
- `--chrome-args=<switches>`: Chrome only. Extra command-line switches separated by spaces, for example
  `--chrome-args=--force-device-scale-factor=1` to lay out at layout zoom 1 (DPR 1) on a Retina screen.
- `--chrome-emulate-dsf=N`: Chrome only. DevTools device emulation (`Emulation.setDeviceMetricsOverride` with
  `deviceScaleFactor: N`), applied before the first navigation and kept for the whole run. For probes about emulated
  DPR, not for accuracy runs.
- `--allow-safari-frontmost`: Safari only, no value. Skips the wait for Safari to leave the front (approved by the
  maintainer on 2026-09-16); the probe window then opens over the user's windows.
- `--dry-run`: validate the probes and print the document count without launching anything.

The runner exits nonzero when anything goes wrong at run level: invalid probes, a launch or page failure, a stall, a
missing result, or a change of user agent, DPR or visual-viewport scale during the run. Errors inside a probe (bad
markup, a throwing setup, a timeout) or inside one observation are results, not run failures. They are counted in
`totals` and kept in the result.

## Probe format

```ts
{
  id: 'blink-canvas/H7',
  spec: 'blink-canvas H7',
  pageLang: 'en',                  // null: no lang attribute (only for probes about a missing lang); '': lang=""
  html: '<div style="font:16px/20px Arial;width:1px">foo<b>bar</b></div>',
  setup: 'element.firstChild.data = "a\\rb"',   // optional
  canvas: [
    { kind: 'offscreen', context: 'A', font: '16px Arial', wordSpacing: '10px', text: ' x' },
    { kind: 'offscreen', context: 'A', text: 'x y' },
  ],
  observe: ['lines', 'canvasWidths', { kind: 'env', families: ['Arial'] }],
  // optional: hostWidth (default 1000), fontFixtures, browsers, document, note
}
```

Unknown keys are rejected, so a typo fails validation instead of silently observing nothing.

- `html` is the markup of exactly one test element, with no text around it. It goes into the host with `innerHTML`.
  The host is `position: fixed` at (0, 0) with no margin, padding or border, `hostWidth` px wide. The HTML parser turns
  CR and CRLF into LF and NUL into U+FFFD, so set such text from `setup`.
- `setup` is the body of an async function with parameters `host` and `element`. It runs after the markup is inserted
  and before anything is observed. Use it for text the parser can't carry, several adjacent text nodes
  (`element.append('a\f', '\n', span)`) or other DOM building.
- `canvas` entries run, in order, when the `canvasWidths` observation runs.
  - `kind`:
    - `offscreen`: `new OffscreenCanvas(1, 1)` on the main thread.
    - `element`: a `<canvas>` appended to the host, so it's connected to the document.
    - `worker`: an OffscreenCanvas inside a dedicated worker created for the probe.
    - `transferred`: a connected `<canvas>` whose `transferControlToOffscreen()` result is measured in that worker.
  - `font`, `letterSpacing`, `wordSpacing`, `textRendering`, `fontKerning`, `fontVariantCaps`, `fontStretch`,
    `direction` and `lang` are assigned to the context in the order the keys appear in the entry, and only when
    present. An absent key leaves the context's value alone, so "ctx.letterSpacing never set" is an entry without
    `letterSpacing`.
  - `context`: entries with the same key share one canvas and context, in order. That covers order dependence and
    "set the same font string again". Without it, every entry gets a fresh context. The first entry of a context must
    set `font`.
  - `elementLang` and `elementStyle`: the `<canvas>` element's `lang` attribute and inline style, on the first entry of
    an `element` or `transferred` context.
  - `pageLang`: set `<html lang>` before this entry's assignments (null removes it). It stays changed until the probe
    ends, then the page restores the document's own value.
  - `frames`: on `offscreen` and `element` contexts, wait for this many animation frames before the assignments,
    drawing `fillRect(0, 0, 1, 1)` in each frame callback. A frame that doesn't arrive within 3s is an entry error.
- `fontFixtures`: web fonts from `tests/wrapping/fonts/fonts.json`, by family. The page loads them as `FontFace`
  objects before running any probe of the document. A worker loads them into its own FontFaceSet when it starts. The
  driver checks their hashes.
- `browsers`: the browsers the probe applies to; absent means all.
- `document`: probes with the same key run one after another in a single document, and must share `pageLang` and
  `fontFixtures`. Otherwise every probe gets a fresh document, loaded by reloading the page. Use a shared document for
  long width scans, and a fresh one whenever document state (caches, lang changes, script globals) could leak.

## Observations

They run in the order listed. All rects are CSS px relative to the host, which sits at the viewport origin, so a test
element without a margin starts at (0, 0). Values are raw doubles as the browser reported them.

- `lines`, or `{ kind: 'lines', selector }` (default: the test element). For every code point of the target's text
  nodes in tree order: its UTF-16 offset into `textContent`, its length, its text node and every Range client rect,
  unfiltered. Also the rects of a Range over each whole text node, the target's box and its computed `line-height`.
  - Lines: a code point is visible when it has a rect with positive width and height. Its first positive rect joins
    the line whose centre is within `groupThreshold` of the rect's centre, or starts a new line. `groupThreshold` is
    half the computed line height when that's in px, otherwise half the first positive rect's height.
  - Each line has `start`, `end`, `text`, the extent of its visible code points' positive rects, and the number of
    visible code points. `lineStarts` lists the starts in line order.
  - `multiLine` lists code points with positive rects on more than one line. Chrome gives a letter after a selected
    soft hyphen rects on both lines, and then the first rect decides. `interleaved` is true when two lines' ranges
    overlap. Regroup from `points` when either happens.
- `boxWidth`, or `{ kind: 'boxWidth', selectors }`. `getBoundingClientRect()` and `getClientRects()` of the test
  element, or of every element matching each selector inside the host.
- `rangeWidth`, or `{ kind: 'rangeWidth', selector }`. A Range over the target's contents: its client rects, its
  bounding rect and `extent`, the horizontal extent of the rects with positive area.
- `canvasWidths`: per entry, the assignments made (with the error text when a setter threw), every property read back
  right before measuring (null when the context lacks it), `measureText(text)` width and actual bounding box left and
  right, the `<html lang>` attribute at that moment, frames completed, and an error when the entry failed.
- `env`, or `{ kind: 'env', families }`. User agent, DPR, visual-viewport scale, the `<html lang>` attribute,
  `navigator.language(s)`, the Intl default locale, window and screen sizes, visibility, focus, `document.fonts.status`,
  loaded fixtures and feature flags: OffscreenCanvas, `ctx.lang`, `ctx.letterSpacing`, `transferControlToOffscreen`
  and `Intl.v8BreakIterator`. For each family it records `document.fonts.check('16px "<family>"')`, which browsers
  answer true for installed fonts and sometimes for families that don't exist, and `resolves`: a probe string at 64px
  measured differently from at least one of two generic fallbacks.
- `{ kind: 'script', source }`: the body of an async function with parameters `host` and `element`. Its return value
  goes through JSON and is recorded. For what the schema doesn't cover, such as `Intl.v8BreakIterator` boundaries or a
  sequence of DOM edits.

A failing observation is recorded as `{ kind, error }`, and the remaining observations still run.

## Output

`<out>/<browser>-probes.json`:

- `status` and `errors`: run-level problems.
- `build` and `app`: the browser build read from the app bundle before launch, and the bundle the runner launched (path,
  whether it is a pinned copy, and the copy's tree hash).
- `totals`: selected probes, documents, results, probes with probe-level errors, observation errors, reloads and
  resends.
- `envs`: each distinct user agent, DPR, visual-viewport scale, visibility and focus the page reported, with the
  number of reports.
- `results`: one entry per selected probe, in run order (documents in order of first appearance): `id`, `spec`,
  `document` (index), `probe` as served, and `result`. `result` is null when the run stopped before the probe ran.
  Otherwise it holds `fontsStatusBefore` and `fontsStatusAfter` (`document.fonts.status` right after layout and after
  awaiting `document.fonts.ready`), `observations`, `errors` and `ms`.

## Browser sessions

Sessions stay in the background and never activate a window. The driver launches once and never retries.

- Chrome: the lab's pinned copy of Chrome (`rebuild/lab/browser-build.ts`, the lab README's "Pinned browsers"), headed,
  with its own `--user-data-dir` under `.artifacts/profiles/`, started with `open -n -g -a` plus `--no-startup-window
  --remote-debugging-port=0 --disable-updater-scheduler`. Headless Chrome can lay out at zoom 1 while
  reporting DPR 2. Chrome activates itself whenever it shows a window the normal way, `open -g` or not, so the driver
  opens its one window over the DevTools protocol with `Target.createTarget { newWindow: true, background: true }`,
  which Chrome shows inactive (the same technique as `rebuild/lab/run.ts`). The protocol is used for nothing else,
  except that `--chrome-emulate-dsf` attaches to that target, sets the device metrics override, navigates, and keeps
  the socket open until the run ends.
- Firefox: `open -n -g -a <the lab's pinned copy of Firefox> --args --new-instance --profile <.artifacts/profiles/...>
  --remote-debugging-port <port> about:blank`, headed, then navigated over WebDriver BiDi. The BiDi session applies
  Firefox's recommended automation prefs (`remote/shared/RecommendedPreferences.sys.mjs` at 156). At 156 none of them
  touch fonts, text or layout; they cover first-run pages, telemetry, updates, focus test mode and hang timeouts.
- Safari: the repo's AppleScript session, `createBrowserSession('safari', { foreground: false })` from
  `scripts/browser-automation.ts`. It opens one single-tab window in the user's Safari (safaridriver doesn't work on
  macOS 27). The driver first waits until Safari isn't the frontmost app, because a new document in a frontmost Safari
  opens over the user's windows. `--allow-safari-frontmost` skips that wait, and then the driver makes and closes its
  window with plain AppleScript that never calls `activate` (the repo session hands focus back by activating the
  previously frontmost app). On close, the session closes its tab only if it can still identify it by URL.
- webkit-host: the WKWebView host on the system WebKit.framework, which installed Safari runs
  (`rebuild/tools/webkit-host`, built into `.artifacts/webkit-host/webkit-host`; the lab README's Browser sessions
  section describes it). The driver spawns it with the probe URL and a 1200 x 900 window. It never touches the user's
  Safari, never activates, and exits when the page's title is `probes done` or when the driver exits.

The driver closes Chrome and Firefox (SIGTERM, then SIGKILL) and moves their profiles to the Trash. webkit-host gets 2 s
to exit by itself, then SIGTERM and SIGKILL. The page server takes the first free port from 3002.

## Page protocol

The server serves `/probe?run=<id>` and never changes that URL. Each load returns the current document: `<html lang>`
set in the markup (so it holds before any script measures), the host, and `#probe-doc` with the document index and its
fixture fonts. The page loads the fixtures and posts to `/api/step`. The reply carries the document's probes, `reload`
(the page calls `location.reload()` to get the next document) or `done`. The page runs the probes one by one, clearing
the host, terminating the probe's worker and restoring `<html lang>` after each, then posts the results. A page that
reloads before acknowledging gets its probes again, at most 3 sends. Only fetch promises drive the loop. Timers are
used only as guards (probe, frame and worker timeouts), so background timer throttling can't stall it.
