# Bench

Compares the cost of the rebuild (`rebuild/src`, `layoutParagraph`) and main (`src/`, `prepare` / `layout`) in each
installed browser, on inputs both can express. Performance comes after correctness here (`rebuild/CHARTER.md`), so these
are recorded costs, not targets.

**`page.ts` doesn't run today.** It builds flat paragraphs of `runs` and reads lines the way the library did before the
inline-tree model (DESIGN.md §1.1, §2.9): `bunx tsc -p rebuild/bench/tsconfig.json` reports it, and a run throws at its
first row. It is left as it is on purpose; the re-architecture ports it to the paragraph tree and line slots when it
settles the measurer's lifetime, which is what the bench's numbers depend on. The driver, the cases, the statistics and
the report (`run.ts`, `cases.ts`, `stats.ts`, `report.ts`, `bench.test.ts`) work, and `run.ts` launches the pinned browsers.

- `run.ts`: the driver. It reads the browser build from the app bundle, bundles `page.ts` with both libraries, serves it
  cross-origin isolated, opens one browser session, collects rows and writes `<out>/<browser>-bench.json` and
  `<out>/<browser>-bench.md`.
- `page.ts`: the browser page. It times every row with the variants of both libraries interleaved in one document, then
  counts measureText calls.
- `cases.ts`: the inputs and chat-like messages, built deterministically from `corpora/`.
- `protocol.ts`: shapes shared by the driver, the page and the report.
- `stats.ts`: median, p95, MAD.
- `report.ts`: the report's JSON shape and markdown, and a CLI that renders a saved report or a cross-browser summary.

The driver doesn't take the browser lock. Run it under `python3 .artifacts/session/with-browser-lock.py <job> -- ...`; it
refuses to start when the lock owner isn't its parent (`--allow-no-lock` overrides).

## Real runs and smoke runs

Real numbers need `--foreground`: a visible, focused page on an idle Mac on AC power, with no other job holding the browser
lock or running browsers. In foreground mode the driver refuses to start on battery (`--allow-battery` overrides), warns
about other browser jobs and the load average, and fails the run when any row's page wasn't visible and focused at its
start or end, or when DPR or the viewport changed. Don't touch the Mac until the report is written.

Without `--foreground`, sessions stay in the background like the lab's (`rebuild/lab/README.md`, "Browser sessions"), and
the report says the numbers are harness validation only. `--smoke` shrinks the settings (3 samples, 1 warm-up round, 2 ms
minimum sample, 1.5 s budget per row, 200 messages) and marks the report as a smoke run.

- `--browser=chrome`: the lab's pinned copy of Chrome (`rebuild/lab/browser-build.ts` `LAB_APPS`; lab README, "Pinned
  browsers") in a throwaway profile under `.artifacts/profiles`, with `--enable-precise-memory-info` and the lab's
  `--disable-updater-scheduler`. Foreground opens a normal window, which activates Chrome; background opens an inactive
  window through the DevTools protocol. Until 2026-09-18 the bench launched the installed Chrome while it read the build
  from the pinned copy, so a report could name another build than it ran; reports now record `app`, the bundle launched.
- `--browser=firefox`: the lab's pinned copy of Firefox in a throwaway profile, started with `open -n [-g] -a <copy> --args
  --new-instance`, with `dom.max_script_run_time` 0 so the slow-script warning can't interrupt long rounds, and the lab's
  prefs that keep the copy from updating itself.
- `--browser=safari`: foreground only. A new window in the user's Safari, activated through AppleScript.
- `--browser=webkit-host`: background only. The system WebKit.framework in `.artifacts/webkit-host/webkit-host`, which never
  takes focus.

Commands for the real runs, one at a time, from the repo root, on an idle Mac on power. From the 2026-09-17 Chrome smoke's
medians, a full Chrome run at the default settings takes about 15 minutes, most of it in the corpus rows (the rebuild's
20-width sweep of a 15,000-unit paragraph is seconds per repetition). `--sizes` without `corpus` shortens it.

```sh
python3 .artifacts/session/with-browser-lock.py bench-chrome -- bun rebuild/bench/run.ts --browser=chrome --foreground --out=.artifacts/bench/real-YYYYMMDD
python3 .artifacts/session/with-browser-lock.py bench-firefox -- bun rebuild/bench/run.ts --browser=firefox --foreground --out=.artifacts/bench/real-YYYYMMDD
python3 .artifacts/session/with-browser-lock.py bench-safari -- bun rebuild/bench/run.ts --browser=safari --foreground --out=.artifacts/bench/real-YYYYMMDD
bun rebuild/bench/report.ts .artifacts/bench/real-YYYYMMDD/{chrome,firefox,safari}-bench.json > .artifacts/bench/real-YYYYMMDD/summary.md
```

A background smoke:

```sh
python3 .artifacts/session/with-browser-lock.py bench-smoke-chrome -- bun rebuild/bench/run.ts --browser=chrome --smoke --sizes=tiny,paragraph,corpus
```

Options: `--scripts=latin,cjk,arabic,mixed`, `--sizes=tiny,sentence,paragraph,long,corpus`, `--scenarios=cold,sweep,many`,
`--samples=N` (default 40), `--min-samples=N` (10), `--warmup=N` (3), `--min-sample-ms=N` (10), `--budget-ms=N` (20000 per
row), `--messages=N` (1000), `--stall-ms=N` (fail after this long without a page request, default 20 minutes), `--out=<dir>`
(default `.artifacts/bench/<time>-<browser>`).

## Inputs

Every input is one paragraph that main expresses as a font string and a width, the way `rebuild/lab/baselines/main-predictor.ts`
uses main: one run in one font, `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word` (main's only
wrapping mode), `line-break: auto`, no letter or word spacing, line height 20 px. The rebuild also takes the paragraph's
direction, which main has no input for. The rebuild's font facts come from the lab's table (`rebuild/lab/font-facts.ts`),
resolved once per document outside the timing, the way an app that knows its fonts declares them. The environment is the
lab predictor's: the build read from the app bundle, no Content-Language, page zoom 1, browser-process languages unknown.

| Script | Font (16 px) | `<html lang>` and paragraph lang | Direction | Source |
|---|---|---|---|---|
| latin | `"Helvetica Neue"` | en | ltr | `en-gatsby-opening` |
| cjk | `"PingFang TC"` | zh-Hant | ltr | `zh-zhufu` and `zh-guxiang`, joined; neither alone is over 10,000 units |
| arabic | `"Geeza Pro"` | ar | rtl | `ar-risalat-al-ghufran-part-1` |
| mixed | `"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif` | en | ltr | `mixed-app-text` paragraphs round-robin with paragraphs of the other three |

Size classes, in UTF-16 units: tiny 1-19, sentence 20-100, paragraph 101-1,000, long 1,001-10,000, corpus over 10,000. Tiny
and sentence inputs are written in `cases.ts`. The larger ones are the source's opening, cut at a boundary at most 600,
5,000 and 15,000 units in. The driver fails when an input falls outside its class.

Messages: 1,000 per script, from a seeded generator: a quarter 5-19 units, half 20-100, a quarter 101-400, each a slice of
the script's source starting and ending at a boundary; a fifth of the mixed messages end with an emoji.

## Scenarios and variants

A repetition is one whole operation of a variant. Rows time variants of both libraries on the same inputs in the same
document.

**cold**, one paragraph at 320 px, fresh measurement state:

- `main prepare+layout`: `clearCache()`, `prepare()`, `layout()`.
- `main prepare+layout, segmenters kept`: `clearMeasurementCaches()` from `src/measurement.ts` instead, which keeps the two
  `Intl.Segmenter` objects `clearCache()` drops. The difference is main's segmenter creation.
- `main prepareWithSegments+layoutWithLines`: `clearCache()`, then the line-materializing API, closer to what the rebuild
  returns.
- `rebuild layoutParagraph`: `layoutParagraph()`, which creates a fresh measurer with new OffscreenCanvas contexts. Compared
  with `main prepare+layout`.

**sweep**, the same paragraph at 20 widths (160 to 730 px by 30):

- `main prepare+layout×20`: `clearCache()`, `prepare()` once, `layout()` at each width.
- `main layout×20`: `layout()` at each width on a handle prepared outside the timing.
- `rebuild layoutParagraph×20`: what the public API allows, a full `layoutParagraph()` per width.
- `rebuild internal prepare+nextLine×20`: the engine's own `prepare()` once with a fresh measurer, then the
  `firstLine` / `nextLine` loop of `rebuild/src/index.ts` at each width with the same measurer. Its memo carries across
  widths.
- `rebuild internal prepare`: the engine's `prepare()` alone, so the line loop's cost is the difference.

**many**, 1,000 messages at 320 px:

- `main prepare+layout×1000`: `clearCache()` once, then `prepare()` and `layout()` per message, so main's caches warm up
  across messages.
- `rebuild layoutParagraph×1000`: `layoutParagraph()` per message. The library keeps no measurement cache across calls.
- `rebuild internal shared measurer×1000`: an experiment, not the library's behavior: one measurer across all messages, so
  Canvas contexts and the memo carry across them. Chrome caches shaped words per canvas, so this can change results; the
  counting pass compares its line ranges with `layoutParagraph()`'s and the report flags a difference.

## Method

- **First repetition**: before anything else in a row, every variant runs once, timed alone, with one library's variants
  first, alternating by row. The row's input is then new to both libraries; the document, JIT state and module-level data
  (main's engine profiles, the rebuild's decoded break tables) aren't.
- **Calibration**: each variant's repetitions per sample grow until a sample spans `max(--min-sample-ms, 20 timer steps)`,
  so coarse timers still resolve small operations.
- **Warm-up**: `--warmup` calibrated rounds, discarded; after the first, they stop once a quarter of the budget is spent.
- **Sampling**: rounds of one sample per variant, in forward order on even rounds and reverse order on odd ones. Sampling
  stops at `--samples` rounds, or after `--min-samples` rounds once the row has spent `--budget-ms`. A MessageChannel task
  separates rounds, so the browser's own work runs between samples rather than inside them.
- **Statistics**: per variant, per-repetition median, nearest-rank p95, min, max, mean and MAD, with the raw samples in the
  JSON.
- **Timer**: the page measures the smallest `performance.now()` step and records `crossOriginIsolated`. The driver sends
  COOP and COEP headers, which lets browsers use their finest timer. On 2026-09-17, isolated pages stepped 5 µs in Chrome
  153 and 20 µs in Firefox 156 and webkit-host; the lab's unisolated pages see whole milliseconds in Firefox and WebKit
  (`rebuild/REPORT.md` §3).
- **Collections**: no browser reports GC pauses to pages. With `performance.memory` (Chrome, precise with
  `--enable-precise-memory-info`), a sample across which the heap shrank is counted as a heap drop. For every browser,
  samples above `median + max(5 × MAD, median / 2)` are counted as outliers. Interleaving spreads one variant's garbage
  across both libraries' samples.
- **measureText calls**: after every row of a document is timed, the page wraps `measureText` on the OffscreenCanvas and
  Canvas 2D prototypes and runs each variant once more, recording calls, the rebuild's measure log (contexts and calls) and
  the lines produced. Wrapping only after all timing keeps the wrappers out of every timed repetition.
- **Environment**: the report records the build from the app bundle and the OS build, CPU and memory, `pmset -g batt` and
  power mode, the load average and top processes at start and end, the browser lock's owner, other browser automation
  running, the page's user agent, DPR, viewport, visibility and focus per row, `HEAD`, `git status` of the library
  directories, and content hashes of `src` and `rebuild/src`.
- **String storage**: the plan is served with every non-ASCII character escaped, as the lab does, so strings are 8-bit
  where their characters allow, what a typical page gets.

## What differs between the libraries

- Main keeps one measurement context for the page across `clearCache()`, so Chrome's per-canvas shaped-word cache stays
  warm. The rebuild creates new OffscreenCanvas contexts in every `layoutParagraph()` call.
- Main's `layout()` returns a line count. The rebuild returns every line with fragments, engine geometry and gaps, and
  logs every measureText call with its text and width.
- Main's cold variants also re-create its segmenters. The rebuild creates `Intl.Segmenter` objects inside its WebKit and
  Gecko break code per call, and keeps its lazily decoded tables for the page's lifetime.
- Main reads an emoji correction from a DOM span when a text may hold emoji. It's in the mixed rows' timing, as it is for
  an app.
