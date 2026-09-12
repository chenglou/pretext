# Changelog

## Unreleased

### Fixed

- Narrow wrapping around invisible controls and combining marks now more closely matches desktop Chrome and Firefox.
- Paragraphs made only of zero-width spaces now occupy one line instead of disappearing (#223).
- A zero-width space at the start of a paragraph or after a hard line break no longer disappears when the following text wraps to the next line (#227).
- Lines can now break after `?`, and after `!` or other exclamation punctuation such as `؟` and `۔`, before a following word, as browsers do, including after a space or zero-width space. Chrome and Safari still keep `!` with a following ASCII letter or digit; Firefox breaks there too (#228).
- In Safari, a combining mark after a zero-width space at the start of the text, at the start of a rich-inline item, or after a line break now stays with that zero-width space (#228).
- In Chrome, text prepared after changing `<html lang>` now uses the fonts for the new language, even when the font string is unchanged.
- Figure spaces (U+2007) now keep adjacent text on the same line, like no-break spaces, as browsers do (#232).
- Lines can now break after `?` before `$`, `%`, `+`, `\`, `-` or `|`, after `!` or `?` before a symbol such as `©`, `¿` or `€`, and after the Arabic semicolon `؛` before a word, as browsers do. Firefox still keeps `?` with a following `-` or `|`. In Chrome, `ー` after `！` or `？` can now start a line (#233).
- A zero-width joiner now keeps the character after it on the same line, except right after a space and in CJK text (#233).
- In Chrome and Safari, a hyphen or dash such as U+2010 HYPHEN, U+2012 FIGURE DASH or U+2013 EN DASH at the start of a word now stays with a following letter of an alphabetic script, such as Latin, Cyrillic, Arabic, Hebrew or Thai. For `-`, only letters outside Latin-1 count (#233).
- In Chrome, lines can now break between a fullwidth closing bracket such as `」` or `）` and a following ideograph, kana or Hangul syllable, as Chrome does (#234).
- Lines no longer start with CJK closing punctuation or nonstarters such as `〟`, `］`, `｡`, `､`, `｣` or `゛` (#234).
- With `word-break: keep-all`, lines no longer break after `ー` in words such as `ラーメン`. In Chrome, they also no longer break after iteration marks such as `々`, `ゝ` or `ヽ` (#234).
- In Safari, a word followed by a space now keeps its kerning with that space, so letters such as `A` in Arial or Times New Roman fit narrow lines as they do natively (#236).
- Reported line widths are now clamped at 0 instead of going negative, for example with strongly negative `letterSpacing` (#236).

## 0.0.9 - 2026-09-07

### Fixed

- Streaming line layouts and line statistics now agree with batch layout when a later break follows a soft hyphen. Streaming also retains later text after consecutive lines containing only invisible break controls (#222).
- Terminal soft hyphens now stay invisible and preserve terminal letter spacing across the rich line APIs.
- Rich bidi metadata now resets independently at each paragraph boundary.
- Rich-inline preparation with long internal whitespace, streaming layout of long hyphenated runs, and long font-size strings now avoid excessive repeated work (#221).
- Rich-inline cursors now retain original item indices across empty items, zero-width items can occupy a line, and boundary spaces preserve their font and signed letter spacing. Mutating a visited line no longer changes the walker's continuation (#220).
- Overlong independent symbol runs can now wrap at grapheme boundaries, with browser-specific punctuation attachment (#208).
- Numeric minus signs no longer introduce a preferred break before their number, and ASCII hyphens after CJK text stay attached to the preceding character (#213, #215).
- The Markdown chat demo now keeps ordinary text inside its bubbles in Firefox on macOS ([#202](https://github.com/chenglou/pretext/issues/202)).

## 0.0.8 - 2026-06-11

### Added

- The published package now ships declaration maps, so editor go-to-definition and programmatic TypeScript source tracing land in the shipped `.ts` source instead of the `.d.ts` files.

### Fixed

- Word-internal keyboard and Unicode symbol runs in long words now stay with surrounding text the way browsers break them, while browser-break symbols stay breakable (#169).
- Overlong hyphenated runs now prefer browser-like dash breakpoints before falling back to emergency grapheme breaks (#89).

## 0.0.7 - 2026-05-10

### Changed

- The package now declares itself side-effect-free so bundlers can tree-shake unused entrypoints (#160).
- `layoutNextLine()` and `layoutNextLineRange()` now avoid redundant chunk lookup in chunk-heavy manual layout paths (#140).

### Fixed

- `{ wordBreak: 'keep-all' }` now handles no-space mixed Latin, numeric, and CJK text more like browsers.
- No-space punctuation chains now stay together for non-ASCII word-like text too, instead of only ASCII words.
- Opening punctuation such as `¡`, `¿`, German low quotes, and `⸘` now stays with the following word instead of dangling at line end (#165).
- Numeric prefix/postfix symbols like `$`, `%`, `€`, `+`, `−`, and `°` now stay attached to adjacent text the way browser line breaking does (#105).
- Soft-hyphen breaks now stay at the soft-hyphen insertion point instead of pulling post-hyphen graphemes onto the broken line (#162).
- Line geometry now preserves browser-style terminal letter spacing, including rich-inline item boundaries and visible soft-hyphen breaks (#171).
- Rich-inline item boundaries no longer overflow the requested width after a forced-progress break (#132).
- The markdown chat demo now drops parsed link URLs unless they resolve to HTTP(S) hrefs (#168).

## 0.0.6 - 2026-04-22

### Added

- Numeric CSS-pixel `letterSpacing` support on `prepare()`, `prepareWithSegments()`, and each existing rich-inline item (#108, #156).

### Fixed

- CJK text followed by opening bracket annotations now wraps like browsers instead of leaving the opening bracket on the previous line (#148).

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
