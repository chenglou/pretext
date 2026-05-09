# Changelog

## 0.0.6 - 2026-04-22

### Added

- Numeric CSS-pixel `letterSpacing` support on `prepare()`, `prepareWithSegments()`, and each existing rich-inline item (#108, #156).

### Fixed

- CJK text followed by opening bracket annotations now wraps like browsers instead of leaving the opening bracket on the previous line (#148).
- `{ wordBreak: 'keep-all' }` now handles no-space mixed Latin, numeric, and CJK text more like browsers.
- Numeric prefix/postfix symbols like `$`, `%`, `€`, `+`, `−`, and `°` now stay attached to adjacent text the way browser line breaking does (#105).
- Soft-hyphen breaks now stay at the soft-hyphen insertion point instead of pulling post-hyphen graphemes onto the broken line (#162).
- Line geometry now preserves browser-style terminal letter spacing, including rich-inline item boundaries and visible soft-hyphen breaks (#171).

## 0.0.5 - 2026-04-09

### Added

- Geometry-first rich line helpers for manual layout work: `measureLineStats()`, `measureNaturalWidth()`, `layoutNextLineRange()`, and `materializeLineRange()`.
- `@chenglou/pretext/rich-inline`, a narrow helper for inline-only rich text, mentions/chips, and browser-like boundary whitespace collapse.
- `{ wordBreak: 'keep-all' }` support on `prepare()` / `prepareWithSegments()` for CJK and Hangul text.
- A virtualized markdown chat demo for rich inline text and `pre-wrap` layout.

### Changed

- Prepare-time analysis is more resilient on long mixed-script, CJK, Arabic, repeated-punctuation, and other degenerate inputs.

### Fixed

- Mixed CJK-plus-numeric runs, keep-all mixed-script boundaries, and long breakable runs now stay closer to browser behavior.
- Rich-path bidi metadata and CJK detection now handle the relevant astral Unicode ranges correctly.

## 0.0.4 - 2026-04-02

### Added

- A justification comparison demo that shows native CSS justification, greedy hyphenation, and a Knuth-Plass-style paragraph layout side by side.

### Changed

- Rich layout is faster on chunk-heavy and long-breakable text.

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

- Safari line breaking is more accurate for narrow soft-hyphen and breakable-run cases.

## 0.0.0 - 2026-03-26

Initial public npm release of `@chenglou/pretext`.

### Added

- `prepare()` and `layout()` as the core fast path for DOM-free multiline text height prediction.
- Rich layout APIs including `prepareWithSegments()`, `layoutWithLines()`, `layoutNextLine()`, and `walkLineRanges()` for custom rendering and manual layout.
