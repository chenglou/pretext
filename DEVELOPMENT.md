## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:windows` — Windows-friendly fallback without automatic port cleanup
- `bun run check` — typecheck, lint, and dead-code scan (`knip`)
- `bun test` — small durable invariant suite, including browser-harness ownership/environment checks, approximate bidi paragraph independence and normal/pre-wrap normalization boundaries
- `bun run test:wrapping --browser=all` — complete maintained checks and selected regressions against a fresh pinned-main comparison
- `bun run test:wrapping --suite=full --browser=all` — also run the broad exploratory wrapping matrices

The report-server tests use temporary loopback ports; sandboxed runs need local
listener access. They do not launch browsers.

See [the wrapping suite](tests/wrapping/README.md) for worktree comparisons,
known-failure reporting, native observation limits and reproducible case IDs.
Its default gate requires the maintained absolute checks and rejects lost baseline
successes elsewhere; it does not claim zero total incompatibilities. The ordinary
and full schedules use the same assertions. Public API comparisons retain every
serialized line field, including any selected-break metadata, while comparing
widths with their existing numeric tolerance.

### Packaging And Release

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:bidi-data` — refresh the checked-in simplified Unicode bidi ranges

`prepack` also rebuilds `dist/` through plain `tsc`, so source imports need `.js` specifiers that remain valid in the emitted files.

### Browser Accuracy And Benchmarking

- `bun run test:wrapping --browser=all` — maintained accuracy, mode, spacing, discretionary and corpus checks, plus wrapping regressions
- `bun run test:wrapping:snapshot` — refresh accuracy/corpus snapshots and both dashboards from that same run
- `bun run test:wrapping --family=pre-wrap --browser=safari` — select one family for diagnosis
- `bun run benchmark-check --output=benchmarks/chrome.json` — refresh the Chrome benchmark snapshot; default is the median of 3 full page runs, use `--runs=1` for a quick local check
- `bun run benchmark-check:safari --output=benchmarks/safari.json` — refresh the Safari benchmark snapshot
- `bun run justification-check` — demo line geometry and source continuity at reported widths; use `--browser=safari` or `--full` for all slider widths
- `bun run probe-check` — smaller browser diagnostic
- `bun run probe-check:safari`
- `bun run font-probe --browser=chrome --output=/tmp/font-probe.json` — optional Shantell Sans and font-language diagnostic; also accepts `safari` and `firefox`. Requires access to Google Fonts. A completed diagnostic records differences; it is not an accuracy pass. See [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).

The wrapping suite owns these maintained checks. Case records preserve each
oracle's content width, whitespace/word-break modes, locale, browser scope,
Range/span method, and tolerance. Required checks fail on unobserved results as
well as mismatches. A matching pinned-main failure does not waive them.
The rich-inline checks cover original item coordinates, callback ownership and
signed boundary spaces. Fourteen native ZWSP/WJ item witnesses require matching rich
height; the unresolved flat ZWSP reproduction remains observed separately.
The benchmark runner requires every measurement section before writing a
snapshot; a successful report from an unrelated page is not a benchmark result.
Failed benchmark reports retain their evidence in `<output>.failed.json`, or under
`.artifacts/benchmarks/` when no output path was requested.

Browser measurements record the test page's starting and ending DPR, screen and
window dimensions, viewport scale, document language/direction, visibility and
focus. There is no configured target display: each run reads the screen currently
hosting its browser window. The shared guard retains observed changes, even if
the page returns to its starting state. A scale or document-context change
invalidates correctness measurements; rerun rather than clearing caches halfway through. Fixed-width
correctness checks may stay in the background or move between same-scale screens.
Benchmarks require a visible, focused page throughout and reject observed window,
viewport or screen changes. The three runs must have matching environments before
we take their median; snapshots retain each run's request and environment.
Foreground Firefox sessions request activation of the owned tab and process by
PID; a headed window alone does not establish focus.

DPR includes page zoom; visual viewport scale is a separate measurement. Screen
sizes are browser-reported CSS dimensions, not a physical monitor ID or a reliable
refresh-rate reading. Keep the browser on one display for benchmark comparisons.
These checks cannot detect every hardware/load change or reconstruct an old run's
missing environment. End-only DPR in an older report does not establish stability.

Each wrapping page owns one request, including configuration and sequential row
batches. Completion must come from the requested URL and the owned browser tab.
Stale traffic cannot contribute to another context, and failed or diagnostic-only
runs cannot replace checked-in snapshots. Safari uses a dedicated window and
stops if additional tabs make ownership ambiguous. Local diagnostic servers are
owned by the checker; an occupied explicit port fails instead of reusing another
checkout. Browser teardown finishes before releasing the browser lock.

For portable Chrome correctness checks, use `bun run test:wrapping --transport=playwright --browser=chrome`. This launches installed Chrome in an isolated headed browser with its native viewport; it does not require AppleScript or a Unix shell. Install Chrome normally first; the adapter uses `playwright-core` without downloading another browser. Automation locks use the platform's temporary directory. The page server runs the current Bun executable directly, and includes demo pages as well as diagnostics. Safari continues to use the native macOS path; Playwright WebKit is not treated as Safari. This transport is for correctness checks only; Playwright can emulate focus, so its visible/focused fields do not prove native tab attention. Benchmark scripts retain foreground native automation. Check the recorded DPR and real target fonts when validating platform-specific font issues.

When a probe finds a first-break mismatch, the report includes a short trace. `sN:gM` identifies a segment and grapheme; `[ours]` and `[browser]` identify the competing break positions. Safari `Range` extraction can be wrong around preserved whitespace and URL queries even when the rendered height is correct, so compare `--method=span` before changing the engine.

The shared suite records the original paragraph and the selected extraction as
separate observations. Normalizing the source or inserting spans can change
wrapping. Each extraction therefore retains its exact source, method, height,
resolved line height and all rectangles. Its line count comes from its own height,
not from grouping source rectangles. Exact boundary checks use only established
source ownership; ambiguous control or whitespace rectangles stay unobserved.
Observer v1 captures lack this stage geometry and cannot be retroactively used
as v2 extraction evidence. Fresh comparisons run both library versions against
the same observer; changing an observer is not a library accuracy improvement.

### Corpus Tooling

- `bun run corpus-check` — diagnose one corpus at one or a few widths
- `bun run corpus-check:safari`
- `bun run corpus-font-matrix` — same corpus under alternate fonts
- `bun run corpus-font-matrix:safari`
- `bun run corpus-taxonomy` — group corpus mismatches by likely cause
- `bun run corpus-status` — rebuild `corpora/dashboard.json`

The corpus, probe, font-matrix and taxonomy tools remain detailed investigation
tools, including source slices and alternate extractors. They do not run as a
second maintained acceptance suite.

### Status Dashboards

- `bun run status-dashboard` — rebuild `status/dashboard.json`

## Useful Pages

- `/demos/index` — index of the public demos
- `/accuracy` — checked-in accuracy snapshots produced by the shared suite
- `/benchmark` — performance comparisons
- `/corpus` — long-form corpus diagnostics
- `/font-probe` — whole-run, isolated-grapheme, in-context and language-bound font measurements; see [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md)

## Current Dashboards And Snapshots

Use these for the current checked-in results:

- [status/dashboard.json](status/dashboard.json) — machine-readable main dashboard
- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — accuracy totals, environment/source fingerprints and mismatching cases; complete rows are in the run artifacts
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json) — results from the small Chrome + Safari `{ letterSpacing }` check
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — raw benchmark snapshots
- [corpora/dashboard.json](corpora/dashboard.json) — machine-readable corpus dashboard
- [corpora/chrome-step10.json](corpora/chrome-step10.json), [corpora/safari-step10.json](corpora/safari-step10.json), [corpora/firefox-step10.json](corpora/firefox-step10.json) — checked-in browser `step=10` corpus sweep snapshots

[PLATFORM_BUGS.md](PLATFORM_BUGS.md) lists current browser and OS issues and their workarounds. [RESEARCH.md](RESEARCH.md) keeps durable findings and rejected approaches; it is not a source for current counts or issue status.

## Deep Profiling

For one-off performance and memory work, start with `bun start` and an isolated, foreground Chrome using a throwaway profile. Reproduce the issue on [pages/benchmark.ts](pages/benchmark.ts), or on a smaller dedicated page when the benchmark is too broad.

- Use the benchmark for throughput regressions.
- Use a CPU profile or performance trace for hotspots.
- Use heap sampling for allocation churn.
- Diff forced-GC heap snapshots for retained memory.

Bun/Node microbenchmarks are useful for quick experiments, but browser behavior needs browser measurements.

For algorithmic changes, scale both source length and the number of segments,
preferred breaks, forced lines and rich items. Include repeated punctuation,
Arabic joins, CJK keep-all, long hyphenated URLs and internal whitespace runs.
Count visited boundaries and submitted Canvas text, with cold caches, before
relying on timings; doubling an input should not quadruple repeated work.
Compare complete public outputs and copied/variable-width continuations as well
as line counts. Keep narrow diagnostic probes outside the maintained browser
corpus; retain small semantic regressions when a mechanism changes. The history
and current bounds are recorded in [RESEARCH.md](RESEARCH.md).
