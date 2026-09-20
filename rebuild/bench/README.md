# Bench

Compares the cost of the rebuild (`rebuild/src`, through the function set of `rebuild/src/index.ts`, DESIGN.md §2.9) and
main (`src/`, `prepare` / `layout`) in each installed browser, on inputs both can express. Performance comes after
correctness here (`rebuild/CHARTER.md`), so these are recorded costs, not targets.

**`page.ts` runs again.** The re-architecture's S3 rewrote its rebuild side over the function set, with the paragraph tree
and the width in the line slot; `bunx tsc -p rebuild/bench/tsconfig.json` is clean, and a background smoke in pinned
Chrome ran ten rows end to end on 2026-09-18, with the three modes below giving the same line ranges in every row
(`.artifacts/bench/ra1-s3-smoke`; harness validation only). No real run has been made with it: profiling comes after the
re-architecture, and the numbers depend on what each port still computes for every line (below). `run.ts` finds the lock
it runs under among the wrapper's slots; until S3 it looked for the single lock the wrapper had before, and refused.

**The chat rows** ("Chat" below) ask what the rebuild costs an app with many short rich messages: from scratch, at a
resize, beside main, and where the time goes. They were added on 2026-09-19, after X2, and ran as 200-message background
smokes in pinned Chrome, pinned Firefox and webkit-host on a busy machine (`.artifacts/bench/night-20260919/smoke`), and
once more through `chat-night.sh` with smoke settings under the exclusive lock (`smoke-night` beside it): every part
posted, the counts were the same in every run, main and the rebuild gave the same number of lines at the first width in
all three browsers, and the counts are in "Chat". No real run has been made with them either.

- `run.ts`: the driver. It reads the browser build from the app bundle, bundles `page.ts` with both libraries, serves it
  cross-origin isolated, opens one browser session, collects rows and writes `<out>/<browser>-bench.json` and
  `<out>/<browser>-bench.md`.
- `page.ts`: the browser page. It times every row with the variants of both libraries interleaved in one document, then
  counts measureText calls and the Canvas contexts made.
- `cases.ts`: the inputs and chat-like messages, built deterministically from `corpora/`.
- `protocol.ts`: shapes shared by the driver, the page and the report.
- `stats.ts`: median, p95, MAD.
- `report.ts`: the report's JSON shape and markdown, and a CLI that renders a saved report or a cross-browser summary.
- `chat-night.sh`: the chat rows in the three background browsers, one after the other, each alone on the machine, then
  the summary.

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
20-width sweep of a 15,000-unit paragraph is seconds per repetition). `--sizes` without `corpus` shortens it. Since
2026-09-19 the default scenarios also hold the chat rows, without their headline pass ("Chat"), a few minutes more.

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

The chat rows unattended, in background windows, each browser alone on the machine. One command runs the three browsers
one after the other and writes `<browser>-bench.json`, `<browser>-bench.md`, `<browser>.log` and `summary.md`:

```sh
rebuild/bench/chat-night.sh .artifacts/bench/night-YYYYMMDD
```

It is these four, and any of them runs alone. `--browser=all --exclusive` is what makes the lock exclusive (it waits for
every other browser job to end, then holds every slot): with `--exclusive` alone the wrapper reads `--browser=` from the
command and takes one of that browser's slots.

```sh
python3 .artifacts/session/with-browser-lock.py bench-chat-chrome --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=chrome --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-YYYYMMDD
python3 .artifacts/session/with-browser-lock.py bench-chat-firefox --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=firefox --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-YYYYMMDD
python3 .artifacts/session/with-browser-lock.py bench-chat-webkit-host --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=webkit-host --scenarios=chat --headline=10000 --quiet-load=8 --out=.artifacts/bench/night-YYYYMMDD
bun rebuild/bench/report.ts .artifacts/bench/night-YYYYMMDD/{chrome,firefox,webkit-host}-bench.json > .artifacts/bench/night-YYYYMMDD/summary.md
```

The exclusive lock keeps other browser jobs away, not other work: on 2026-09-19 the load average was over 80 while
another job held it. `--quiet-load=8` makes a run wait, with the lock held and before it launches its browser, until the
1-minute load average is under 8, for at most `--quiet-wait-min` minutes (15), and then run whatever the load is; the
report says how long it waited, whether the load got there, and the load average at both ends. From the smokes' times on
a busy machine, a run is about 8 minutes in Chrome, 3 in Firefox and 1 in webkit-host, most of it the inspect variant
and the 10,000-message passes. A background page was never visible or focused, so the OS may run it slower than a
foreground page: compare variants within a report, and hold the report's fixed arithmetic (`spinMs`, "Method") against a
foreground run's before comparing absolute times. The same commands with `--foreground` (and `--browser=safari` for
WebKit) give the foreground numbers, with someone at the Mac. A chat smoke in one browser's slot, which also runs a
short headline pass so every part of the page runs:

```sh
python3 .artifacts/session/with-browser-lock.py bench-smoke-chrome -- bun rebuild/bench/run.ts --browser=chrome --smoke --scenarios=chat --headline=400 --out=.artifacts/bench/smoke-YYYYMMDD
```

Options: `--scripts=latin,cjk,arabic,mixed`, `--sizes=tiny,sentence,paragraph,long,corpus`, `--scenarios=cold,sweep,many,chat`,
`--samples=N` (default 40), `--min-samples=N` (10), `--warmup=N` (3), `--min-sample-ms=N` (10), `--budget-ms=N` (20000 per
row), `--messages=N` (1000; the many rows' messages and the chat rows' timed messages), `--headline=N` (0: the chat
context's headline passes lay out this many messages, and 0 leaves them out), `--headline-passes=N` (3), `--phase-passes=N`
(3, smoke 1), `--quiet-load=N` and `--quiet-wait-min=N` (above; off unless given, 15), `--stall-ms=N` (fail after this
long without a page request, default 20 minutes), `--out=<dir>` (default `.artifacts/bench/<time>-<browser>`).

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

The rebuild runs in three modes, from the least a caller reads of a line to the most:

- `count`: a paragraph prepared plain, every line filled (`fillLine`), nothing more read. It is what a height takes.
- `pieces`: the same, and every line's pieces (`linePieces`), what a painter takes.
- `inspect`: a paragraph prepared for inspection, and per line `fillLine`, `inspectLine`, then `linePieces`, then the
  paragraph's gaps: the lab's path (`rebuild/lab/predictor-core.ts`).

Until the re-architecture's X1 a port computed its gaps and the geometry only the lab reads while it filled every line, so
the three modes cost about the same. Since X1 every port computes them on request (DESIGN.md §2.8), and the modes differ
by that work; no real run has been made since. The difference between them is what the re-architecture's later steps are
measured by. The counting pass checks that the three modes give the same line ranges for every paragraph and
width of a row, and the report flags a row where they don't.

**cold**, one paragraph at 320 px, fresh measurement state:

- `main prepare+layout`: `clearCache()`, `prepare()`, `layout()`.
- `main prepare+layout, segmenters kept`: `clearMeasurementCaches()` from `src/measurement.ts` instead, which keeps the two
  `Intl.Segmenter` objects `clearCache()` drops. The difference is main's segmenter creation.
- `main prepareWithSegments+layoutWithLines`: `clearCache()`, then the line-materializing API, closer to what the rebuild
  returns.
- `rebuild prepare+fill, <mode>`: `prepare()`, which makes new OffscreenCanvas contexts, then every line. `count` is
  compared with `main prepare+layout`, `pieces` with `main prepareWithSegments+layoutWithLines`.

**sweep**, the same paragraph at 20 widths (160 to 730 px by 30):

- `main prepare+layout×20`: `clearCache()`, `prepare()` once, `layout()` at each width.
- `main layout×20`: `layout()` at each width on a handle prepared outside the timing.
- `rebuild prepare+fill×20, <mode>`: `prepare()` once, then every line at each width: one prepared paragraph serves any
  width (the width is the slot's). What the paragraph measured for one width answers for the next where they ask the same.
  `count` is compared with `main prepare+layout×20`.
- `rebuild fill×20, count`: every line at each width of a plain paragraph prepared outside the timing, which has met every
  width by the first sample. Compared with `main layout×20`.
- `rebuild prepare`: `prepare()` of a plain paragraph alone, so the line loop's cost is the difference.

**many**, 1,000 messages at 320 px:

- `main prepare+layout×1000`: `clearCache()` once, then `prepare()` and `layout()` per message, so main's caches warm up
  across messages.
- `rebuild prepare+fill×1000, <mode>`: `prepare()` and every line per message. The library keeps nothing across
  paragraphs: every message makes its own Canvas contexts and runs the runtime font checks again. `count` is compared with
  `main prepare+layout×1000`. The earlier experiment with one measurer across all messages is gone with the measurer
  parameter; contexts shared across paragraphs wait for profiling (research/ARCHITECTURE-PLAN-2.md §10).

## Chat

The question behind these rows: an app lays out 10,000 to 100,000 short rich chat messages, and a resize changes every
bubble's width. Can it lay them out from scratch each time, or must it keep prepared paragraphs? `--scenarios=chat` adds one
context (`<html lang="en">`) with two rows, `chat/mix` and `chat/latin`, a headline pass and a phase pass. A layout is one
message at one width.

**The messages** come from a seeded generator (`cases.ts` `buildChat`), and a longer set starts with the shorter one, so
the 1,000 timed messages are the first 1,000 of the headline's 10,000. Every text is a slice of a corpus that starts and
ends at a boundary and holds no newline. Its length class is drawn first, a quarter short (5-19 UTF-16 units), half medium
(20-100), 22% long (101-400) and 3% very long (401-1,500), then a length anywhere in the class. The first 1,000 of the mix
have a mean of 111 units and a median of 59, and the longest has 1,464.

| Kind | Share of the mix | What it is |
|---|---:|---|
| `latin` | 55% | printable ASCII: The Great Gatsby with straight quotes and hyphens for its curly quotes and dashes |
| `latin-smart` | 8% | the same source as it is, so most hold a curly quote or a dash and are 16-bit text in Blink |
| `latin-emoji` | 8% | ASCII with one emoji at the end (four in five) or between two words; two of the five emoji are sequences |
| `latin-url` | 5% | ASCII with one of five URLs after it (seven in ten) or before it |
| `latin-code` | 7% | ASCII with one inline code span between two words, one of eight snippets |
| `cjk` | 7% | Chinese (祝福, 故鄉) |
| `arabic` | 5% | Arabic (رسالة الغفران), in the same left-to-right paragraph as every other message |
| `app-mixed` | 5% | a slice of `corpora/mixed-app-text.txt`: several scripts, emoji sequences, a URL, soft hyphens |

Of the first 1,000 of the mix, 73% are printable ASCII, 7% hold an emoji, 9% CJK, 7% Arabic or Hebrew, 6% a URL, 6% a code
span and 0.2% a soft hyphen. `chat/latin` is the `latin` kind alone from a stream of its own, with the same lengths: the
common case beside the mix. The report prints these shares for the messages it ran.

**A third set, `real`**, holds the mix's kinds, shares and lengths over text that isn't sliced at random (`cases.ts`
`realTexts`): every text is read once from its start, a message after the other, so no unit of text is in two messages of
one reading. The Latin kinds read The Great Gatsby and the masonry demo's 1,904 short posts in turn (about 510,000 units:
10,000 messages read them twice, with other slices the second time), `cjk` reads Chinese, Japanese and Korean in turn, and
`arabic` reads Arabic (كتاب البخلاء), Hebrew and Urdu in turn. `app-mixed` has no long text and stays the mix's. The
first 1,000 have a mean of 117 units and a median of 60. The set isn't a row of `run.ts`: `realism-run.ts` lays it out
beside the other two ("Realism").

**One declaration for every message**, as an app sets one font on its bubbles: 16px `"Helvetica Neue", "PingFang TC",
"Geeza Pro", sans-serif`, line height 20 px, `white-space: normal`, `overflow-wrap: break-word`, `lang="en"`, left to
right, 320 px wide; the resize case lays the same messages out at 260, 380 and 440 px. No font facts are supplied: every
declaration carries `UNKNOWN_FONT_FACTS`, so the rebuild's `prepare()` runs every font check its engine has. The other
rows take the lab's facts, and a supplied fact is never checked. A code span is 14px Menlo with 6 px of padding on each
inline side, the Markdown chat demo's shape.

**The inputs are the same text in both libraries, and they differ in three places.** A plain message is one text leaf in
the rebuild and one string for main's `prepare()`. A message with a code span is three nodes in the rebuild's paragraph
tree, the middle one a span with its own font and padding; main's `prepare()` has no inline boxes, so that message goes
through main's rich-inline helper (`prepareRichInline()`, `measureRichInlineStats()`), the span as an item with
`extraWidth`. The helper adds the whole `extraWidth` to every line a wrapped span is on, where the engines put the start
padding on its first line and the end padding on its last. Main has no input for the paragraph's direction or language.
And main is given no font facts because it has none to take. In the smokes main and the rebuild gave the same number of
lines at 320 px in all three browsers, and totals one or two lines apart over 600 layouts at the other widths in Chrome
and Firefox.

**What each variant answers.** The timed rows hold 1,000 messages (`--messages`); a repetition is the whole set.

| Question | Variant | One repetition |
|---|---|---|
| A. From scratch | `rebuild scratch, count` | for every message `prepare()` plain, with its font checks and new Canvas contexts, then `fillLine` over every line at 320 px; nothing kept across messages |
| | `rebuild scratch, pieces`, `rebuild scratch, inspect` | the same in the other two modes ("Scenarios and variants"); `inspect` is the lab's path |
| B. A resize | `rebuild first resize×3, count` | every line at 260, 380 and 440 px of paragraphs that were prepared and filled at 320 px before the repetition, outside its timing, so every width is new to them: 3,000 layouts |
| | `rebuild resize×3 again, count` | the same on paragraphs that have been filled at these widths before. Gecko keeps what it measured inside a word on the prepared paragraph (DESIGN.md §4.6), so there this asks Canvas nothing; Blink asks the same questions again, of a canvas whose own cache has met them |
| C. Main | `main cold` | `clearCache()` once, then `prepare()` and `layout()` for every message, as `pages/benchmark.ts` times a batch: main's caches fill across the messages |
| | `main resize×3` | `layout()` at the three widths on handles prepared outside the timing |
| D. The font checks | `rebuild scratch, count, checks lifted` | A on paragraphs whose font facts Canvas answered outside the timing: the engine's `prepare()` alone, then every line. Its distance from A is what the per-paragraph font checks cost, without any instrument in the timed code |

The report gives each variant's median for the whole set, the time per layout, measureText calls and contexts made per
layout, and the lines. The counting pass also holds the three modes' line ranges against each other at all four widths, and
against `prepare()` run as its two halves, and flags a row where they differ.

**The headline** (`--headline=10000`): the first 10,000 messages of each set from scratch, once a pass, `--headline-passes`
times, the rebuild in count mode and main's cold batch taking turns, with every pass's time in the report. It is the
number to hold against "10,000 messages laid out again from scratch in about 2 s". After everything else in the document,
the resize case runs once on the same 10,000: all of them prepared, filled at 320 px and kept, then filled at the three
other widths. It comes last because it holds 10,000 prepared paragraphs with their Canvas contexts at once (about 45,000
contexts in Chrome), which no smoke has tried: if the page ends there, the report has everything else, and the driver fails
after `--stall-ms`.

**The phases** (question D): one instrumented pass over the 1,000 messages, the median of `--phase-passes` passes field by
field. The page runs `prepare()` as the two halves `rebuild/src/index.ts` joins, with `performance.now()` around each and
around the line loop: the runtime font checks (`measure/font-checks.ts` `withLearnedFontFacts`), the engine's own
`prepare`, and `fillLine` over every line. Wrappers on the Canvas classes time what happens inside them: `measureText`,
and making contexts, which is the `OffscreenCanvas` constructor, `getContext` and every assignment to a context's text
attributes (the font string is parsed and resolved there). What is left of a phase is outside Canvas: in the engine's
`prepare` that is building the content, bidi, scripts, segmentation and break opportunities, and the code around each
measurement; in the fill it is the line breaking. The same numbers are summed by message kind. Two `performance.now()`
calls surround every Canvas call in this pass, so it runs slower than the timed rows, and a phase with many calls looks
larger than it is: read the shares here, the totals in the timed rows, and the font checks' cost from A against D. The
wrappers come off again before the headline's resize case.

Calls and contexts per message in the 200-message smokes of 2026-09-19 (they don't depend on the machine's load; times
aren't given, because the machine was busy):

| | Chrome 153 | Firefox 156 | webkit-host 22625 |
|---|---:|---:|---:|
| mix, rebuild from scratch, plain: measureText calls, contexts | 312.8, 10.9 | 110.7, 3.4 | 38.2, 5.4 |
| mix, rebuild from scratch, inspected | 2,614.1, 10.9 | 352.5, 3.5 | 52.4, 5.4 |
| mix, of the plain path: the font checks alone | 10.7, 6.4 | 0, 0 | 9.5, 4.2 |
| mix, rebuild, a layout at a new width / at a width met before: calls | 138.6 / 138.6 | 28.2 / 0 | 0.1 / 0.1 |
| mix, main cold: calls | 11.9 | 11.9 | 32.4 |
| latin, rebuild from scratch, plain | 317.7, 10 | 82.1, 2.9 | 31.4, 5 |
| latin, rebuild from scratch, inspected | 2,724.4, 10 | 354.6, 3 | 39.4, 5 |
| latin, main cold: calls | 8.4 | 8.4 | 27.9 |

Main makes no context in a batch: it keeps one for the page. Every page had a device pixel ratio of 2, which is why
Blink's font checks run at all for text without a soft hyphen or joining letters: check 4 asks whether the primary family
scales linearly to the zoomed size.

## Realism

`realism-run.ts` asks how far the headline carries: to another device pixel ratio, to text that isn't the generator's,
and to a slower processor. It serves `realism-page.ts`, which is the headline and nothing else: every set (`mix`, `latin`,
`real`) laid out from scratch in count mode once a pass, the sets taking turns, then one counting pass with wrappers on
`measureText` and `getContext`: calls, the UTF-16 units of the strings sent, contexts and lines, in all and by message
kind (by language in the `languages` set). A run is a launch and a few passes, so runs at several settings can take turns inside one exclusive stretch. It
launches what `run.ts` launches, in the background, and doesn't take the browser lock.

```sh
python3 .artifacts/session/with-browser-lock.py realism-chrome -- bun rebuild/bench/realism-run.ts --browser=chrome --device-scale-factor=3 --out=<file.json>
```

- `--device-scale-factor=N`: Chrome's `--force-device-scale-factor=N` at launch, which is a real ratio (Blink lays out at
  it; a DevTools-emulated one lays out at zoom 1, `rebuild/probes/blink-probes.ts`). In Firefox the profile's
  `layout.css.devPixelsPerPx`. webkit-host has the screen's ratio.
- `--cpu-throttle=N` (Chrome): `Emulation.setCPUThrottlingRate` over a DevTools session that stays attached for the run.
  The throttle stops the renderer's main thread for a share of every interval. It is not a slower processor: caches,
  memory and the font code's own waits aren't slowed, so a time under it is this Mac's time stretched.
- `--sets=mix,latin,real,languages`: the chat sets, and `languages`, the eleven languages of `corpora/` read once with the
  chat lengths and taking turns (`cases.ts` `buildLanguages`), which the counting pass files by language.
- `--messages=N` (10,000), `--passes=N` (3), `--counts=no` (a timed sitting whose counts are
  known leaves the counting pass out), `--out=<file.json>`.

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
- **measureText calls and contexts**: after every row of a document is timed, the page wraps `measureText` on the
  OffscreenCanvas and Canvas 2D prototypes and `getContext` on the two canvas classes, and runs each variant once more,
  recording calls, contexts made and the lines produced (main's line count, the rebuild's line boxes). Wrapping only after
  the timing keeps the wrappers out of every timed repetition. The wrappers also time what they wrap, for the chat
  context's phase pass, and come off before its last timed part ("Chat").
- **Fixed arithmetic**: the page times one fixed loop of integer arithmetic before a context's first row and after its
  last (`spinMs`). It measures neither library. It shows whether the page ran slower than the same build does elsewhere,
  as a background window or on a busy machine, and whether that changed during the context.
- **Environment**: the report records the build from the app bundle and the OS build, CPU and memory, `pmset -g batt` and
  power mode, the load average and top processes at start and end, the browser lock's owner, other browser automation
  running, the page's user agent, DPR, viewport, visibility and focus per row, `HEAD`, `git status` of the library
  directories, and content hashes of `src` and `rebuild/src`.
- **String storage**: the plan is served with every non-ASCII character escaped, as the lab does, so strings are 8-bit
  where their characters allow, what a typical page gets.

## What differs between the libraries

- Main keeps one measurement context for the page across `clearCache()`, so Chrome's per-canvas shaped-word cache stays
  warm. The rebuild creates new OffscreenCanvas contexts in every `prepare()` call.
- Main's `layout()` returns a line count. The rebuild's `count` mode returns as little, but each port still builds every
  line's fragments, engine geometry and gaps while it fills it, and logs the measureText calls of its own recipes with
  their text and width.
- Main's cold variants also re-create its segmenters. The rebuild creates `Intl.Segmenter` objects inside its WebKit and
  Gecko break code per call, and keeps its lazily decoded tables for the page's lifetime.
- Main reads an emoji correction from a DOM span when a text may hold emoji. It's in the mixed rows' timing, as it is for
  an app.
- The chat rows supply no font facts, so every runtime font check of the engine is in their timing; every other row takes
  the lab's facts, and a supplied fact is never checked. Main's `prepare()` has no inline boxes, so a chat message with a
  code span goes through its rich-inline helper ("Chat").
