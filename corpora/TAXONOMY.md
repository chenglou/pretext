# Miss Taxonomy

Compact taxonomy for interpreting canary mismatches.

Use this when a corpus or probe disagrees with the engine and the question is
"what class of problem is this?" rather than "what width missed?"

`RESEARCH.md` stays the detailed exploration log.
`corpora/STATUS.md` stays the current scorecard.
This file is the shared vocabulary for deciding what kind of work should happen next.

Useful command:

```sh
bun run corpus-taxonomy --id=ja-rashomon 330 450
```

That runner is intentionally rough. It now batches widths inside one corpus page load
and is there to turn repeated browser diagnostics into a steering summary, not to
replace manual judgment on a new mismatch.

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
- do not patch `layout()`

Examples:
- early Gatsby paragraph-newline drift
- remaining hard-space edge cases if they surface

### `boundary-discovery`

The candidate break opportunities are wrong or too coarse.

Typical signs:
- `Intl.Segmenter` output is plausible, but our merged units are not
- a script needs additional glue / splitting rules around punctuation or marks
- a canary is fixed by changing segmentation/merge behavior rather than widths

Typical response:
- adjust preprocessing boundaries
- keep the rule semantic and narrow

Examples:
- Arabic punctuation-plus-mark clusters like `،ٍ`
- Japanese iteration marks `ゝ / ゞ / ヽ / ヾ`
- Thai ASCII quote glue

### `glue-policy`

The right raw boundaries exist, but we attach the wrong units together before layout.

Typical signs:
- punctuation should stay with the previous word
- opening quote clusters should stay with the following text
- non-breaking glue was modeled as ordinary breakable space

Typical response:
- change glue/attachment rules, not measurement

Examples:
- Arabic no-space punctuation clusters like `فيقول:وعليك`
- Myanmar medial glue with `၏`
- escaped quote clusters in mixed app text

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
- remaining Arabic fine-width field after the coarse corpus was cleaned
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
- historical `system-ui` mismatch
- sampled Myanmar miss on `Myanmar Sangam MN`

### `diagnostic-sensitivity`

The mismatch may be partly in the probe, extractor, or environment rather than the engine.

Typical signs:
- `span` vs `range` extractors disagree
- a short isolated probe does not reproduce the corpus mismatch
- mixed-display or mixed-zoom runs disagree

Typical response:
- re-run with explicit extractor/method/environment
- do not change the engine until the probe is trustworthy

Examples:
- mixed-app `710px` soft-hyphen case
- old Arabic span-probe drift before the RTL `Range` path

## Steering Rules

When a new mismatch shows up:

1. Rule out `corpus-dirty` and `diagnostic-sensitivity`.
2. If widths are obviously tiny-edge cases, classify as `edge-fit`.
3. If a semantic merge/split fixes multiple widths cleanly, classify as `boundary-discovery` or `glue-policy`.
4. If repeated clean corpora still miss after good preprocessing, escalate to `shaping-context`.
5. If only one font family or fallback stack misses, classify as `font-mismatch`.

## Current Frontier

The main current steering classes are:
- Japanese: mostly `edge-fit` plus some `shaping-context`
- Myanmar: mostly `boundary-discovery` / `glue-policy`, with some remaining local disagreement that is not yet a safe keep
- Mixed app text `710px`: `diagnostic-sensitivity`
- Arabic long-form: coarse field is clean; remaining fine field is mostly `edge-fit`
- Chinese: mostly `glue-policy` around punctuation/quote clusters, plus some Chromium-only edge behavior
- Urdu: currently behaving more like `boundary-discovery` / shaping-sensitive break policy than dirty data or simple edge-fit
