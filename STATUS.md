# Current Status

Machine-readable current snapshot data for the main browser sweep and benchmark numbers lives in JSON.

Use this file for "where do I look right now?".
Use [RESEARCH.md](/Users/chenglou/github/pretext/RESEARCH.md) for why the numbers changed and what was tried.
Use [corpora/STATUS.md](/Users/chenglou/github/pretext/corpora/STATUS.md) for the long-form corpus canaries.

## Browser Accuracy

Machine-readable dashboard:
- [status/dashboard.json](/Users/chenglou/github/pretext/status/dashboard.json)

Raw snapshots:
- [accuracy/chrome.json](/Users/chenglou/github/pretext/accuracy/chrome.json)
- [accuracy/safari.json](/Users/chenglou/github/pretext/accuracy/safari.json)
- [accuracy/firefox.json](/Users/chenglou/github/pretext/accuracy/firefox.json)

Notes:
- This is the 4-font × 8-size × 8-width × 30-text browser corpus.
- The public accuracy page is effectively a regression gate now, not the main steering metric.

## Benchmark Snapshot

Machine-readable dashboard:
- [status/dashboard.json](/Users/chenglou/github/pretext/status/dashboard.json)

Raw snapshots:
- [benchmarks/chrome.json](/Users/chenglou/github/pretext/benchmarks/chrome.json)
- [benchmarks/safari.json](/Users/chenglou/github/pretext/benchmarks/safari.json)

Notes:
- Chrome remains the main maintained performance baseline. Safari snapshots are still useful, but they are noisier and warm up less predictably.
- The checked-in JSON snapshots are cold checker runs. Ad hoc page-driven numbers, especially in Safari, can differ after warmup.
- Refresh the benchmark JSON snapshots when a diff changes benchmark methodology or the text engine's hot path (`src/analysis.ts`, `src/measurement.ts`, `src/line-break.ts`, `src/layout.ts`, `src/bidi.ts`, or `pages/benchmark.ts`).
- `layout()` remains the resize hot path; `prepare()` is where script-specific cost still lives.
- Long-form corpus benchmark rows split `prepare()` into analysis and measurement phases, which helps separate segmentation/glue cost from raw width-measurement cost.

## Pointers

- Main dashboard summary: [status/dashboard.json](/Users/chenglou/github/pretext/status/dashboard.json)
- Accuracy snapshots: [accuracy/chrome.json](/Users/chenglou/github/pretext/accuracy/chrome.json), [accuracy/safari.json](/Users/chenglou/github/pretext/accuracy/safari.json), [accuracy/firefox.json](/Users/chenglou/github/pretext/accuracy/firefox.json)
- Benchmark snapshots: [benchmarks/chrome.json](/Users/chenglou/github/pretext/benchmarks/chrome.json), [benchmarks/safari.json](/Users/chenglou/github/pretext/benchmarks/safari.json)
- Corpus dashboard: [corpora/dashboard.json](/Users/chenglou/github/pretext/corpora/dashboard.json)
- Corpus anchor rows: [corpora/representative.json](/Users/chenglou/github/pretext/corpora/representative.json)
- Full exploration log: [RESEARCH.md](/Users/chenglou/github/pretext/RESEARCH.md)
