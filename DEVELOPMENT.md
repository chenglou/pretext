## Development Setup

```sh
bun install
bun start                    # http://localhost:3000 — stable demo pages
bun run start:lan            # same server, but reachable from other devices on your LAN
bun run start:watch          # same page server, but with Bun watch/reload enabled
bun run site:build           # static demo site -> site/
bun run check                # typecheck + lint
bun run build:package        # emit dist/ for the published ESM package
bun run package-smoke-test   # pack the tarball and verify temp JS + TS consumers
bun test                     # small invariant suite
bun run accuracy-check       # Chrome browser sweep
bun run accuracy-check:safari
bun run accuracy-check:firefox
bun run accuracy-snapshot    # refresh accuracy/chrome.json
bun run accuracy-snapshot:safari
bun run accuracy-snapshot:firefox
bun run benchmark-check      # Chrome benchmark snapshot
bun run benchmark-check:safari
bun run pre-wrap-check       # small browser-oracle sweep for { whiteSpace: 'pre-wrap' }
bun run corpus-check         # diagnose one corpus at one or a few widths
bun run corpus-sweep         # coarse corpus width sweep
bun run corpus-font-matrix   # same corpus under alternate fonts
bun run corpus-taxonomy      # classify a corpus mismatch field into steering buckets
bun run corpus-representative
bun run corpus-status        # rebuild corpora/STATUS.md from checked-in JSON snapshots
bun run corpus-status:refresh
bun run gatsby-check         # slow detailed Gatsby diagnosis
bun run gatsby-sweep         # coarse Gatsby width sweep
```

Packaging notes:
- The published package entrypoint is built into `dist/` and generated at package time; `dist/` stays gitignored.
- Keep library-internal imports using `.js` specifiers inside `.ts` source so plain `tsc -p tsconfig.build.json` emits correct runtime JS and declarations.
- `bun run package-smoke-test` is the quickest published-artifact confidence check before a release or packaging change.

Useful pages:
- `/demos/index`
- `/demos/accordion`
- `/demos/bubbles`
- `/demos/dynamic-layout`
- `/demos/justification-comparison`
- `/accuracy`
- `/benchmark`
- `/corpus`

## Current Sources Of Truth

Use these for the current picture:
- [STATUS.md](STATUS.md) — compact browser accuracy + benchmark dashboard
- [accuracy/chrome.json](accuracy/chrome.json), [accuracy/safari.json](accuracy/safari.json), [accuracy/firefox.json](accuracy/firefox.json) — checked-in raw browser accuracy rows
- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — checked-in benchmark snapshots
- [corpora/STATUS.md](corpora/STATUS.md) — compact long-form corpus snapshot
- [corpora/representative.json](corpora/representative.json) — machine-readable anchor subset
- [corpora/chrome-sampled.json](corpora/chrome-sampled.json), [corpora/chrome-step10.json](corpora/chrome-step10.json) — checked-in Chrome corpus sweep snapshots backing the top tables in `corpora/STATUS.md`
- [RESEARCH.md](RESEARCH.md) — the exploration log and the durable conclusions behind the current model

## Deep Profiling

For one-off performance and memory work, start in a real browser.

Preferred loop:

1. Start the normal page server with `bun start`.
2. Launch an isolated Chrome with:
   - `--remote-debugging-port=9222`
   - a throwaway `--user-data-dir`
   - background throttling disabled if the run is interactive
3. Connect over Chrome DevTools / CDP.
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
  - Chrome CPU profiler / performance trace
- Allocation churn:
  - Chrome heap sampling during the workload
- Retained memory:
  - force GC, take a before heapsnapshot, run the workload, force GC again, take an after heapsnapshot, and diff what survives

A pure Bun/Node microbenchmark is still useful for cheap hypothesis checks, but it is not the final answer when the question is browser behavior.
