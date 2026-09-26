# Miss Taxonomy

Compact taxonomy for interpreting canary mismatches.

Use this when a corpus or probe disagrees with the engine and the question is
"what class of problem is this?" rather than "what width missed?"

The `corpora/*-step10.json` snapshots are the current scorecard.
This file is the shared vocabulary for deciding what kind of work should happen next.

Useful command:

```sh
bun run corpus-taxonomy --id=ja-rashomon 330 450
```

## Categories

### `corpus-dirty`

The source text itself is not a trustworthy `white-space: normal` canary.

Typical signs:
- wrapped print lines
- header/footer/navigation scaffolding
- editorial bracket notes
- obvious `space + punctuation` typos
- quote-before-punctuation artifacts introduced by scraping

Typical response:
- clean the corpus
- or reject it entirely

Examples:
- the rejected Lao raw-law source
- Arabic quote-before-punctuation Wikisource artifacts

### `normalization`

The engine and browser disagree because the text model is wrong before line fitting even begins.

Typical signs:
- whitespace collapse differences
- NBSP / NNBSP / WJ / ZWSP / SHY mishandling
- wrong hard/soft break preservation

Typical response:
- fix preprocessing / break-kind modeling

Examples:
- early Gatsby paragraph-newline drift
- remaining hard-space edge cases if they surface

### `boundary-discovery`

The candidate break opportunities are wrong. They come from each engine's own
line-break data and scans (`src/line-breaks.ts`, `src/gecko-line-breaks.ts`), so a
wrong one is a gap in the port, not a missing glue rule.

Typical signs:
- punctuation, quotes or marks stay with different text than in the browser
- a canary is fixed by moving a break rather than by changing widths

Typical response:
- compare the scan with the engine's own source for that text
- fix the port rather than adding a rule of Pretext's own

### `edge-fit`

The browser keeps or drops one more short phrase at the line edge, usually by less than a pixel.

Typical signs:
- candidate line width differs from `maxWidth` by only a tiny amount
- all remaining misses are one-line positive/negative drift
- line text differs only at the final kept/dropped phrase

Typical response:
- inspect browser-specific tolerance first
- avoid broad heuristics unless the class repeats across corpora

Examples:
- small Japanese and Thai one-line misses

### `shaping-context`

The chosen line break changes shaping or glyph metrics enough that a width-independent segment sum stops being exact.

Typical signs:
- isolated-segment sums diverge from browser behavior even after good preprocessing
- pair/local corrections do not help
- a miss is stable across clean corpora and fonts for the same script class

Typical response:
- do not keep adding glue rules blindly
- either accept an approximate envelope or move toward a richer shaping-aware model

Examples:
- the rejected larger Arabic shaping experiments
- any future stable cursive-script wall that survives corpus cleanup

### `font-mismatch`

The engine and browser are effectively measuring different fonts or different font-resolution behavior.

Typical signs:
- only one font stack misses
- named fonts and `system-ui` disagree
- cross-font matrix shows one family regressing while others stay exact

Typical response:
- verify the exact font stack first
- avoid script heuristics until the font story is clean

Examples:
- `system-ui` mismatch ([PLATFORM_BUGS.md](../PLATFORM_BUGS.md))
- sampled Myanmar miss on `Myanmar Sangam MN`

### `diagnostic-sensitivity`

The mismatch may be partly in the probe, extractor, or environment rather than the engine.

Typical signs:
- `span` vs `range` extractors disagree
- a short isolated probe does not reproduce the corpus mismatch

Typical response:
- re-run with explicit extractor/method/environment
- do not change the engine until the probe is trustworthy

## Steering Rules

When a new mismatch shows up:

1. Rule out `corpus-dirty` and `diagnostic-sensitivity`.
2. If widths are obviously tiny-edge cases, classify as `edge-fit`.
3. If moving a break fixes multiple widths cleanly, classify as `boundary-discovery`.
4. If repeated clean corpora still miss after good preprocessing, escalate to `shaping-context`.
5. If only one font family or fallback stack misses, classify as `font-mismatch`.
