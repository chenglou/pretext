## Text Metrics

DOM-free text measurement using canvas `measureText()` + `Intl.Segmenter`. Two-phase: `prepare()` once, `layout()` is pure arithmetic on resize. ~0.1ms for 500 comments. Full i18n.

### Commands

- `bun start` — serve pages at http://localhost:3000
- `bun run check` — typecheck + lint
- `bun test` — headless tests (HarfBuzz, 100% accuracy)

### Files

- `src/layout.ts` — the library
- `src/measure-harfbuzz.ts` — HarfBuzz backend for headless tests
- `src/test-data.ts` — shared test texts/params
- `src/layout.test.ts` — bun tests: consistency + word-sum vs full-line accuracy
- `pages/` — browser pages: demo, accuracy sweep, benchmark, interleaving, emoji test

### Key decisions

- Canvas over DOM: no read/write interleaving
- Intl.Segmenter over split(' '): CJK, Thai, all scripts
- Punctuation merged into preceding word: reduces accumulation error
- Trailing whitespace hangs (CSS behavior): no false line breaks
- HarfBuzz with explicit LTR for headless tests: guessSegmentProperties misbehaves on isolated Arabic

### Known limitations

- Emoji: canvas 4px wider than DOM at <24px on macOS
- system-ui: use named fonts instead
- Server-side: needs canvas or @napi-rs/canvas with registered fonts

See [RESEARCH.md](RESEARCH.md) for full exploration log with measurements.

Based on Sebastian Markbage's [text-layout](https://github.com/reactjs/text-layout).
