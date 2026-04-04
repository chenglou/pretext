## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:lan` — same server, but reachable from other devices on your LAN
- `bun run start:watch` — same server, but with Bun watch/reload enabled
- `bun run check` — typecheck plus lint
- `bun test` — small durable invariant suite

### Packaging And Release Confidence

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:bidi-data` — refresh the checked-in simplified Unicode bidi ranges

`prepack` also rebuilds `dist/` through plain `tsc`, so keep runtime `.js` specifiers honest in source imports.

### Browser Accuracy And Benchmarking

- `bun run accuracy-check` — Chrome browser sweep
- `bun run accuracy-check:safari`
- `bun run accuracy-check:firefox`
- `bun run accuracy-snapshot` — refresh `accuracy/chrome.json`
- `bun run accuracy-snapshot:safari`
- `bun run accuracy-snapshot:firefox`
- `bun run benchmark-check` — Chrome benchmark snapshot
- `bun run benchmark-check:safari`
- `bun run pre-wrap-check` — compact browser oracle for `{ whiteSpace: 'pre-wrap' }`
- `bun run keep-all-check` — compact browser oracle for `{ wordBreak: 'keep-all' }`
- `bun run probe-check` — smaller browser probe/diagnostic entrypoint
- `bun run probe-check:safari`

### Corpus Tooling

- `bun run corpus-check` — diagnose one corpus at one or a few widths
- `bun run corpus-check:safari`
- `bun run corpus-sweep` — coarse corpus width sweep
- `bun run corpus-sweep:safari`
- `bun run corpus-font-matrix` — same corpus under alternate fonts
- `bun run corpus-font-matrix:safari`
- `bun run corpus-taxonomy` — classify a mismatch field into steering buckets
- `bun run corpus-representative` — rebuild `corpora/representative.json`
- `bun run corpus-status` — rebuild `corpora/dashboard.json`
- `bun run corpus-status:refresh` — refresh representative rows, sampled sweep, coarse sweep, then the corpus dashboard
- `bun run gatsby-check` — compatibility alias for `corpus-check --id=en-gatsby-opening --diagnose`
- `bun run gatsby-check:safari`
- `bun run gatsby-sweep` — compatibility alias for `corpus-sweep --id=en-gatsby-opening`
- `bun run gatsby-sweep:safari`

### Status Dashboards

- `bun run status-dashboard` — rebuild `status/dashboard.json`

## Useful Pages

The ones worth keeping in your muscle memory:

- `/demos/index`
- `/demos/bubbles`
- `/demos/dynamic-layout`
- `/demos/editorial-engine`
- `/demos/justification-comparison`
- `/demos/markdown-chat`
- `/demos/rich-note`
- `/accuracy`
- `/benchmark`
- `/corpus`

## Current Sources Of Truth

Use these for the current checked-in picture:

- [STATUS.md](STATUS.md) — short pointer doc for the main browser accuracy + benchmark snapshots
- [status/dashboard.json](status/dashboard.json) — machine-readable main dashboard
- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — raw browser accuracy rows
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — raw benchmark snapshots
- [corpora/STATUS.md](corpora/STATUS.md) — short pointer doc for long-form corpora
- [corpora/dashboard.json](corpora/dashboard.json) — machine-readable corpus dashboard
- [corpora/representative.json](corpora/representative.json) — anchor subset
- [corpora/chrome-sampled.json](corpora/chrome-sampled.json), [corpora/chrome-step10.json](corpora/chrome-step10.json) — checked-in Chrome corpus sweep snapshots
- [RESEARCH.md](RESEARCH.md) — the exploration log and the durable conclusions behind the current model

## Deep Profiling

For one-off performance and memory work, start in a real browser.

Preferred loop:

1. Start the normal page server with `bun start`.
2. Launch an isolated Chrome with:
   - `--remote-debugging-port=9222`
   - a throwaway `--user-data-dir`
   - background throttling disabled if the run is interactive
3. Connect over Chrome DevTools or CDP.
4. Use a tiny dedicated repro page before profiling the full benchmark page.
5. Ask the questions in this order:
   - Is this a benchmark regression?
   - Where is the CPU time going?
   - Is this allocation churn?
   - Is anything still retained after GC?

Use the right tool for each question:

- Throughput / regression:
  - [pages/benchmark.ts](pages/benchmark.ts)
  - or a tiny dedicated stress page when the issue is narrower than the whole benchmark harness
- CPU hotspots:
  - Chrome CPU profiler or performance trace
- Allocation churn:
  - Chrome heap sampling during the workload
- Retained memory:
  - force GC, take a before heapsnapshot, run the workload, force GC again, take an after heapsnapshot, and diff what survives

A pure Bun/Node microbenchmark is still useful for cheap hypothesis checks, but it is not the final answer when the question is browser behavior.
