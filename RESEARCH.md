# Research Log

Everything we tried, measured, and learned while building this library.

For the current compact browser-accuracy / benchmark snapshot, see `STATUS.md`.
For the current compact corpus / sweep snapshot, see `corpora/STATUS.md`.
For the shared mismatch vocabulary, see `corpora/TAXONOMY.md`.

## Current steering summary

This log is historical. The current practical steering picture is:

- Japanese has two real canaries (`羅生門`, `蜘蛛の糸`), both clean at anchor widths and both still exposing a small positive one-line field on broader Chrome sweeps.
- Chinese has two long-form canaries (`祝福`, `故鄉`) showing the same broad Chrome-positive / Safari-clean split, with real font sensitivity between `Songti SC` and `PingFang SC`.
- Myanmar still has two real canaries with residual Chrome/Safari disagreement around quote/follower-style classes, so it remains the main unresolved Southeast Asian frontier.
- Urdu has a real Nastaliq/Naskh canary (`چغد`) with the same narrow-width negative field in Chrome and Safari, so it is clearly a shaping/context class rather than dirty data or a browser-only quirk. It remains parked rather than actively tuned.
- Arabic coarse corpora are clean; the remaining work there is mostly a fine-width edge-fit class, not the old preprocessing/corpus-hygiene problems.
- Mixed app text still matters because it catches product-shaped classes that books miss, especially soft-hyphen and extractor-sensitive cases.

## The problem: DOM measurement interleaving

When UI components independently measure text heights with DOM reads like `getBoundingClientRect()`, each read can force synchronous layout. If those reads interleave with writes, the browser can end up relaying out the whole document repeatedly.

The goal here was always the same:
- do the expensive text work once in `prepare()`
- keep `layout()` arithmetic-only
- make resize-driven relayout cheap and coordination-free

## Approach 1: Canvas measureText + word-width caching

Canvas `measureText()` avoids DOM layout. It goes straight to the browser's font engine.

That led to the basic two-phase model:
- `prepare(text, font)` — segment text, measure segments, cache widths
- `layout(prepared, maxWidth, lineHeight)` — walk cached widths with pure arithmetic

That architecture held up. The broad browser sweeps are now clean in Chrome, Safari, and Firefox, and the hot `layout()` path is still the core product win.

## Rejected: DOM-based or string-reconstruction measurement in the hot path

Several alternatives were tried and rejected:

- measuring full candidate lines as strings during `layout()`
- moving measurement into hidden DOM elements during `prepare()`
- using SVG `getComputedTextLength()`

The pattern was consistent:
- they either reintroduced DOM reads
- or they were slower than the current two-phase model
- or they looked cleaner locally but regressed the actual benchmark path

The important keep was architectural, not algorithmic:
- `layout()` stayed arithmetic-only on cached widths

## Discovery: system-ui font resolution mismatch

Canvas and DOM resolve `system-ui` to different font variants on macOS at certain sizes:

Machine-readable scan:
- [research-data/system-ui-size-scan.json](/Users/chenglou/github/pretext/research-data/system-ui-size-scan.json)

In the recorded scan, mismatches clustered at `10-12px`, `14px`, and `26px`.
`13px`, `15-25px`, and `27-28px` were exact.

macOS uses SF Pro Text at smaller sizes and SF Pro Display at larger sizes. Canvas and DOM switch between them at different thresholds.

Practical conclusion:
- use a named font if accuracy matters
- keep `system-ui` documented as unsafe
- if we ever support it properly, the believable path is a narrow prepare-time DOM fallback for detected bad tuples

What did **not** look trustworthy enough:
- lookup tables
- naive scaling
- guessed resolved-font substitution

## Discovery: word-by-word sum accuracy

Canvas is internally consistent enough that summing measured segments works very well, but not perfectly. Over a full paragraph, tiny adjacency differences can accumulate into a line-edge error.

The keeps were small and semantic:
- merge punctuation into the preceding word before measuring
- let trailing collapsible spaces hang instead of forcing a break

What did **not** survive:
- full-string verification in `layout()`
- uniform rescaling
- generic pair-level correction models

The broad lesson was that local semantic preprocessing paid off more than clever runtime correction.

## Discovery: text-shaper is a useful reference, not a runtime replacement

`text-shaper` was useful reference material, especially for Unicode coverage and bidi ideas, but not a replacement for the current browser-facing model.

What was worth taking:
- broader Unicode coverage, e.g. missing CJK extension blocks

What was not worth taking:
- its segmentation as a runtime replacement for `Intl.Segmenter`
- its paragraph breaker as a substitute for browser-parity layout

Bottom line:
- good reference material
- wrong runtime center of gravity for this repo

## Discovery: preserving ordinary spaces, hard breaks, and numeric tab stops is viable

The smallest honest second whitespace mode turned out to be:
- preserve ordinary spaces
- preserve `\n` hard breaks
- preserve tabs with default browser-style tab stops
- leave the other wrapping defaults alone

That became:
- `{ whiteSpace: 'pre-wrap' }`

What mattered:
- preserved spaces still hang at line end
- consecutive hard breaks keep empty lines
- a trailing final hard break does **not** invent an extra empty line
- tabs advance to the next default browser tab stop from the current line start

The mode now covers the textarea-like cases we cared about, and the broad browser sweeps plus the dedicated `pre-wrap` oracle are green.

One important tooling lesson also came out of this:
- keep a small permanent oracle suite
- justify it once with a broader brute-force validation pass
- do not keep the brute-force pass forever once it has done its job

## Discovery: emoji canvas/DOM width discrepancy

Chrome and Firefox on macOS can measure emoji wider in canvas than in DOM at small sizes. Safari does not share the same discrepancy.

What held up:
- detect the discrepancy by comparing canvas emoji width against actual DOM emoji width per font
- cache that correction
- keep it outside the hot layout path

This is now one of the small browser-profile shims that is actually justified.

## Retired HarfBuzz probe path

We briefly kept a headless HarfBuzz backend in the repo for server-side measurement probes.

What it taught us:
- it was useful for research and algorithm probes
- it was not close enough to our active browser-grounded path to justify keeping it in the main repo
- isolated Arabic words in that probe path needed explicit LTR direction to avoid misleading widths

So if HarfBuzz comes up again later, treat it as explored territory:
- useful as a research reference
- not the runtime direction for Pretext
- not a substitute for browser-oracle or browser-canvas validation

## Final browser sweep closure

The last browser mismatches were not fixed by moving more work into `layout()`. That regressed the hot path and was reverted.

What actually held up:
- better preprocessing in `prepare()`
- better browser diagnostics pages and scripts
- a tiny browser-specific line-fit tolerance

What did **not** change:
- `layout()` stayed arithmetic-only

That remains the right center of gravity for the project.

## Arabic frontier

Arabic took several passes, but the pattern is clearer now.

What survived:
- merge no-space Arabic punctuation clusters during `prepare()`
  - e.g. `فيقول:وعليك`, `همزةٌ،ما`
- treat Arabic punctuation-plus-mark clusters like `،ٍ` as left-sticky too
- split `" " + combining marks` into plain space plus marks attached to the following word
- use normalized slices and the exact corpus font during probe work
- trust the better RTL diagnostics path instead of reconstructing offsets from rendered line text
- clean obvious corpus/source artifacts instead of inventing new engine rules for them
- allow a tiny non-Safari line-fit tolerance bump for the remaining positive fine-width field

What did **not** survive:
- pair correction models at segment boundaries
- larger Arabic run-slice width models
- broad phrase-level heuristics derived from one good-looking probe

Those failed for the same reason in different sizes:
- pair corrections were too local to move the real misses
- run-slice widths were much heavier and still did not move the hard widths enough
- both made `prepare()` or `layout()` materially worse without buying a clean Arabic field

So the useful guardrail is:
- if an Arabic idea starts by adding more shaping-aware width caches inside the current segment-sum architecture, be skeptical early
- the Arabic keeps so far have been preprocessing, corpus cleanup, diagnostics, and tiny tolerance shims, not richer width-cache models

Current read:
- Arabic coarse corpora are healthy
- the remaining work is much narrower now
- the unresolved class looks like a mix of fine-width edge-fit and shaping/context, not another obvious preprocessing hole

## Long-form corpus canaries

Once the main browser sweep became a regression gate, the long-form corpora became the real steering canaries.

### Mixed app text

This is the most product-shaped canary.

What it has been good for:
- URL/query-string handling
- escaped quote clusters
- numeric expressions like `२४×७`
- time ranges like `7:00-9:00`
- emoji ZWJ runs
- manual soft hyphens

Important keep:
- model URL/query strings as narrow structured units, not one giant breakable blob

Current status:
- almost entirely clean
- one remaining extractor-sensitive soft-hyphen miss around `710px` still looks paragraph-scale or accumulation-sensitive rather than like a neat local bug

### Thai

Thai exposed a product-shaped ASCII quote issue more than a dictionary-segmentation failure.

The keep:
- contextual ASCII quote glue during preprocessing

Result:
- two Thai prose corpora are healthy at anchor widths
- sampled sweeps stayed clean enough that Thai now looks broader than one lucky story

### Khmer

Khmer broadened the Southeast Asian class without immediately demanding new engine work.

The keep:
- preserve explicit zero-width separators from the source text

Result:
- anchors and sampled sweeps were clean enough to keep Khmer as a real canary

### Lao (rejected)

The Lao corpus attempt was a source problem, not an engine problem.

The raw text was wrapped print/legal text, which made it a dirty `white-space: normal` canary. We rejected it instead of normalizing nonsense into the repo.

### Myanmar

Myanmar is still the main unresolved Southeast Asian frontier.

What survived:
- treat `၊` / `။` / `၍` / `၌` / `၏` as left-sticky during preprocessing
- treat `၏` as medial glue in clusters like `ကျွန်ုပ်၏လက်မ`

What did **not** survive:
- broad Myanmar grapheme breaking in ordinary wrapping
- quote-follower glue like closing-quote + `ဟု`

Current read:
- there are real recurring classes here
- but the obvious tempting heuristics improved one browser and hurt another
- that makes Myanmar a canary, not a license for more instinctive glue rules

### Japanese

Japanese gave us one real semantic keep:
- kana iteration marks like `ゝ` / `ゞ` / `ヽ` / `ヾ` should be treated as CJK line-start-prohibited

What remains:
- a small context-width class around punctuation/quote compression
- good evidence for the exactness ceiling of a width-independent grapheme-sum model in proportional Japanese fonts

So Japanese stays as a canary, not as a place to keep stacking narrow punctuation rules.

### Chinese

Chinese is now the clearest active CJK canary.

What we learned:
- Safari is clean at the anchor widths
- Chrome keeps a broader narrow-width positive field
- the field changes with font choice (`Songti SC` vs `PingFang SC`)

What did **not** survive:
- carrying closing punctuation forward
- coalescing repeated punctuation runs like `——` or `……`

Current read:
- the remaining Chinese field is real
- it is not another obvious punctuation bug
- it is best treated as a canary for the model’s current exactness ceiling

### Sampled cross-font corpus matrix

The first cross-font pass was reassuring:
- Korean, Thai, Khmer, Hindi, Arabic, and Hebrew all stayed exact across the sampled Chrome matrix on this machine

That does **not** mean font fragility is gone. It just means the next likely surprises are:
- new scripts
- finer width sweeps
- or product-shaped mixed text

## Segment metrics cache

The cache used to store just widths. It now stores richer per-segment metrics and computes the more expensive derived facts lazily.

Current useful cached facts include:
- width
- `containsCJK`
- lazily computed emoji count
- lazily computed grapheme widths

That improved repeated `prepare()` work without moving any live measurement back into `layout()`.

## Soft hyphen support

Soft hyphen became a real internal break kind instead of ordinary text.

What that bought us:
- unbroken lines keep it invisible
- broken lines can expose a visible trailing `-`
- rich APIs stay aligned with the actual break choice

This was a genuine model improvement, not just a cosmetic API change.

## What Sebastian already knew

Sebastian’s original prototype already had the right overall instinct:
- words/runs as the unit of caching
- browser-grounded measurement
- streamed greedy line breaking

What changed here was mostly engineering discipline:
- caching
- a clean `prepare()` / `layout()` split
- preprocessing
- browser diagnostics
- and a willingness to keep the hot path simple
