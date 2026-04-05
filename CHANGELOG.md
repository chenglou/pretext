# Changelog

## Unreleased

### Changed

- Documentation now matches the current public API surface more closely, including the line-stats/range rich line APIs and the `@chenglou/pretext/rich-inline` helper for rich-text inline flow.

### Added

- `{ wordBreak: 'keep-all' }` support on `prepare()` / `prepareWithSegments()` for CJK and Hangul text, plus a small standing `keep-all` browser oracle.
- A checked-in generated Unicode bidi range table with a manual `bun run generate:bidi-data` refresh path.

### Fixed

- Mixed CJK-plus-numeric runs now use cumulative widths when breaking the numeric suffix, matching the browser more closely.
- Rich-path bidi metadata and CJK detection now handle the relevant astral Unicode ranges correctly.
- The probe page now reports line content end offsets correctly when a line range steps past a hard break omitted from rendered line text.

## 0.0.4 - 2026-04-02

### Added

- A justification comparison demo that shows native CSS justification, greedy hyphenation, and a Knuth-Plass-style paragraph layout side by side.
- Machine-readable status dashboards under `status/dashboard.json` and `corpora/dashboard.json` for tooling and release-time inspection.

### Changed

- Browser automation and reporting are more robust: batched sweep transport, phase-aware timeout diagnostics, background-safe correctness runs, and unified Firefox accuracy automation.
- Rich-line benchmark coverage now includes chunk-heavy and long-breakable stress cases, and chunk lookup in the rich path now uses binary search.

### Fixed

- `layout()`, `layoutWithLines()`, and `layoutNextLine()` stay aligned on narrow `ZWSP` / grapheme-breaking edge cases.
- The justification comparison demo no longer paints justified lines wider than their column.

## 0.0.3 - 2026-03-29

### Changed

- npm now publishes built ESM JavaScript from `dist/` instead of exposing raw TypeScript source as the package entrypoint.
- TypeScript consumers now pick up shipped declaration files automatically from the published package, while plain JavaScript consumers can install and import the package without relying on dependency-side TypeScript transpilation.

## 0.0.2 - 2026-03-28

### Added

- `{ whiteSpace: 'pre-wrap' }` mode for textarea-like text, preserving ordinary spaces, tabs, and hard breaks.

## 0.0.1 - 2026-03-27

### Changed

- Safari line breaking now has a clearer browser-specific policy path for narrow soft-hyphen and breakable-run cases.
- Browser tooling is more stable: fresh per-run page ports, diagnostics derived from the public rich layout API, and a non-watch `bun start` by default.

## 0.0.0 - 2026-03-26

Initial public npm release of `@chenglou/pretext`.

### Added

- `prepare()` and `layout()` as the core fast path for DOM-free multiline text height prediction.
- Rich layout APIs including `prepareWithSegments()`, `layoutWithLines()`, `layoutNextLine()`, and `walkLineRanges()` for custom rendering and manual layout.
- Browser accuracy, benchmark, and corpus tooling with checked-in snapshots and representative canaries.
