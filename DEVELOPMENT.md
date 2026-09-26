## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:windows` — Windows-friendly fallback without automatic port cleanup
- `bun run check` — typecheck, lint, dead-code scan (`knip`) and a check that the generated engine break data is current
- `bun test` — durable invariant suite
- `bun run test:wrapping --browser=all` — complete maintained checks and selected regressions against a fresh pinned-main comparison
- `bun run test:wrapping --suite=full --browser=all` — also run the broad exploratory wrapping matrices

The report-server tests use temporary loopback ports; sandboxed runs need local
listener access. They do not launch browsers.

See [the wrapping suite](tests/wrapping/README.md) for worktree comparisons,
known-failure reporting, native observation limits and reproducible case IDs.

### Harness

The new harness in `harness/` keeps each browser's layout of every case in git, recorded once per browser build, and
predicts every case in the browser the way an app does. See [harness/README.md](harness/README.md) for how a case is
judged, the case sets and the pinned browsers.

- `bun test harness` — the harness's offline tests, each planting a fault it exists to catch
- `bun harness check` — predict every pinned case in Chrome, Firefox and webkit-host and score it; a failure that
  `harness/accepted/<browser>.txt` doesn't list under a written reason blocks, and `--accept="<reason>"` lists the new ones
- `bun harness gate` — `check`, plus predictions in reverse order, a fresh recording of 1,000 cases and the attribution
  of new failures
- `bun harness record --only-new` — record new cases; after a browser or OS update, `bun harness record` records every
  case again
- `bun harness explain <id>` — one case's recorded lines against the predicted ones

### Packaging And Release

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:engine-break-data` — refresh Chrome's, Safari's and Firefox's checked-in break and grapheme tables from the engine files in `scripts/engine-data/`, checking each table against its source; `--check` compares the generated file instead of writing it. After refreshing a grapheme table, run the grapheme check in each browser (below).
- `bun run generate:webkit-generic-families` — refresh the families Safari draws `serif`, `sans-serif`, `cursive`, `fantasy` and `monospace` in under each page language, from WebKit's language-to-script map and Core Text's answers on macOS and iOS in `scripts/engine-data/safari-27.0/`; `--check` compares instead of writing

### Browser Accuracy And Benchmarking

- `bun run test:wrapping:snapshot` — run the suite and refresh accuracy/corpus snapshots from that run
- `bun run test:wrapping --family=pre-wrap --browser=safari` — select one family for diagnosis
- `bun run benchmark-check --output=benchmarks/chrome.json` — refresh the Chrome benchmark snapshot; default is the median of 3 full page runs, use `--runs=1` for a quick local check
- `bun run benchmark-check --browser=safari --output=benchmarks/safari.json` — refresh the Safari benchmark snapshot
- `bun run justification-check` — demo line geometry and source continuity at reported widths; use `--browser=safari` or `--full` for all slider widths
- `bun run probe-check --text='...' --width=320 --font='18px serif'` — one-paragraph browser diagnostic; also `--browser=safari`, `--method=span|range`, `--whiteSpace=pre-wrap`, `--wordBreak=keep-all`, `--lang`, `--dir=rtl`
- `bun run font-probe --browser=chrome --output=/tmp/font-probe.json` — optional Shantell Sans and font-language diagnostic; also accepts `safari` and `firefox`. See [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).
- `bun run probe:arabic-joining --output=/tmp/pretext-ff-arabic --font=arial-16 --limit=20` — Firefox-only joined-Arabic study; see [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).
- `bun scripts/grapheme-check/build.ts`, then `bun scripts/grapheme-check/run.ts --browser=chrome` — compare `src/graphemes.ts` with the browser's own `Intl.Segmenter` on every code point in contexts that tell the grapheme classes apart, the corpora and suite texts with their prepared segments, and random strings, under the table the engine profile takes and the other one; also `safari` and `firefox`, in the background. `ENGINE=webkit bun scripts/grapheme-check/offline.ts` runs it under Bun. Node can't load `src/` directly, so bundle it with `bun build --target=node scripts/grapheme-check/offline.ts --outfile=.artifacts/grapheme-check/offline.mjs` and run `ENGINE=blink node .artifacts/grapheme-check/offline.mjs`.

Failed benchmark reports retain their evidence in `<output>.failed.json`, or under
`.artifacts/benchmarks/` when no output path was requested.

The shape rows run after every other section. They prepare batches of
U+3000-indented and letter-spaced Chinese, VS16 and ZWJ emoji, long invisible
tails, soft hyphens, dashes, CJK brackets with and without keep-all, and
controls next to spaces. Each row reports ms per text for its first cold batch,
the median cold batch after `clearCache()`, a warm batch with filled caches and
a hot `layout()` pass. Apart from the first batch, each sample repeats its work
for at least 20ms so Safari's 1ms timer resolves it. `canvasCalls` counts
`measureText()` in one cold batch. The last row is shaped like virtualization:
1,000 distinct sentences in a font no other row measures, so its first batch is
the fresh-text prepare. WebKit's width cache can speed up repeated cold batches
of the same strings, so compare Canvas calls and first batches before trusting a
difference only the median cold batch shows.

Benchmarks require a visible, focused page throughout and reject observed window,
viewport or screen changes. The three runs must have matching environments before
we take their median; snapshots retain each run's request and environment.
Foreground Firefox sessions request activation of the owned tab and process by
PID; a headed window alone does not establish focus. Automation launches Firefox
through LaunchServices (`open -n -a`, with `-g` unless the session asks for
foreground) and stops the process that names its disposable profile, because
macOS 27 denies a shell's processes access to apps' folders under
`~/Library/Application Support` and a directly spawned Firefox exits with
"Could not find profile folder." for any `--profile`.

For portable Chrome correctness checks, use `bun run test:wrapping --transport=playwright --browser=chrome`. This launches installed Chrome in an isolated headed browser with its native viewport. Install Chrome normally first; the adapter uses `playwright-core` without downloading another browser. Safari continues to use the native macOS path; Playwright WebKit is not treated as Safari. This transport is for correctness checks only; Playwright can emulate focus, so its visible/focused fields do not prove native tab attention. Benchmark scripts retain foreground native automation.

When a probe finds a first-break mismatch, the report includes a short trace. `sN:gM` identifies a segment and grapheme; `[ours]` and `[browser]` identify the competing break positions. Safari `Range` extraction can be wrong around preserved whitespace and URL queries even when the rendered height is correct, so compare `--method=span` before changing the engine. Assign Range points to lines with the harness `pointLine()` rule, never `rects[0]`: Safari 26 gives a line-initial character a zero-width rect at the end of the previous line; Safari 27 doesn't.

### Corpus Tooling

- `bun run corpus-check --id=ko-unsu-joh-eun-nal 300 600 800` — diagnose one corpus at one or a few widths; add `--browser=safari`, `--diagnose`, `--method=span|range`, `--sliceStart=`/`--sliceEnd=`, `--font=`/`--lineHeight=`
- `bun run corpus-font-matrix --id=<corpus-id>` — same corpus under alternate fonts; also `--browser=safari`
- `bun run corpus-taxonomy --id=ja-rashomon 330 450` — group corpus mismatches by likely cause

The corpus, probe, font-matrix and taxonomy tools remain detailed investigation
tools, including source slices and alternate extractors. They do not run as a
second maintained acceptance suite.

Use existing corpus `font` / `lineHeight` overrides for font comparisons. Start
font matrices in Chrome; use Safari for follow-up smoke coverage. For
Arabic/Urdu, use normalized slices, the exact corpus font, and RTL `Range`
diagnostics. Use `Range` for Thai/Lao/Khmer/Myanmar too; span probing can change
their line breaks. Derive diagnostic lines from `layoutWithLines()` and source
offsets from prepared segments and grapheme cursors. Do not duplicate the line
walker or reconstruct offsets from `line.text.length`. Small automation reports
can use the hash; large batched reports need the local POST side channel. A
timeout in the `posting` phase points to report transport first. Scripted
checkers use temporary `--no-hmr` servers. Connection-refused tabs after
teardown are expected; use `bun start` for a persistent dev server.

## Useful Pages

- `/demos/index` — index of the public demos
- `/accuracy` — checked-in accuracy snapshots produced by the shared suite
- `/benchmark` — performance comparisons
- `/corpus` — long-form corpus diagnostics
- `/font-probe` — whole-run, isolated-grapheme, in-context and language-bound font measurements; see [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md)

## Current Snapshots

Use these for the current checked-in results:

- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — accuracy totals, environment/source fingerprints and mismatching cases; complete rows are in the run artifacts
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json) — results from the small Chrome + Safari `{ letterSpacing }` check
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — raw benchmark snapshots
- [corpora/chrome-step10.json](corpora/chrome-step10.json), [corpora/safari-step10.json](corpora/safari-step10.json), [corpora/firefox-step10.json](corpora/firefox-step10.json) — checked-in browser `step=10` corpus sweep snapshots

## Deep Profiling

For one-off performance and memory work, start with `bun start` and an isolated, foreground Chrome using a throwaway profile. Reproduce the issue on [pages/benchmark.ts](pages/benchmark.ts), or on a smaller dedicated page when the benchmark is too broad.

Bun/Node microbenchmarks are useful for quick experiments, but browser behavior needs browser measurements.

For algorithmic changes, scale both source length and the number of segments,
forced lines and rich items. Include repeated punctuation,
Arabic joins, CJK keep-all, long hyphenated URLs and internal whitespace runs.
Count visited boundaries and submitted Canvas text, with cold caches, before
relying on timings; doubling an input should not quadruple repeated work.
The history and current bounds are recorded in [RESEARCH.md](RESEARCH.md).
