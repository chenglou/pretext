# Current Status

This file is the compact "where do I look right now?" map.

Use [RESEARCH.md](RESEARCH.md) for why the numbers moved and what was tried.
Use [corpora/STATUS.md](corpora/STATUS.md) for the long-form corpus canaries.

## Main Dashboard

- [status/dashboard.json](status/dashboard.json) — machine-readable summary of the current browser accuracy, benchmark, and corpus inputs

## Browser Accuracy

- [accuracy/chrome.json](accuracy/chrome.json)
- [accuracy/safari.json](accuracy/safari.json)
- [accuracy/firefox.json](accuracy/firefox.json)
- [accuracy/letter-spacing.json](accuracy/letter-spacing.json)

Notes:
- This is the checked-in `4 fonts x 8 sizes x 8 widths x 30 texts` browser sweep.
- The public accuracy page is basically a regression gate now, not the main steering metric.
- The letter-spacing snapshot is a compact Chrome + Safari oracle, not part of the full sweep matrix.

## Benchmark Snapshots

- [benchmarks/chrome.json](benchmarks/chrome.json)
- [benchmarks/safari.json](benchmarks/safari.json)

Notes:
- Chrome is still the main maintained performance baseline.
- Safari numbers are useful, but noisier and warm up less predictably.
- The checked-in JSON snapshots are medians across 3 cold checker runs. Ad hoc page numbers can differ after warmup.
- Refresh these when benchmark methodology or the hot path changes: `src/analysis.ts`, `src/measurement.ts`, `src/line-break.ts`, `src/layout.ts`, `src/bidi.ts`, or `pages/benchmark.ts`.

## Long-Form Corpus Status

- [corpora/STATUS.md](corpora/STATUS.md)
- [corpora/dashboard.json](corpora/dashboard.json)
- [corpora/chrome-step10.json](corpora/chrome-step10.json)
- [corpora/safari-step10.json](corpora/safari-step10.json)

## Historical Log

- [RESEARCH.md](RESEARCH.md)
