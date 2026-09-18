# The rebuild with no supplied font facts (2026-09-18)

Without supplied font facts, Chrome loses real accuracy (1.3 to 3.5 points depending on the metric), Firefox loses a little on widths, and webkit-host loses almost nothing. Those figures pool all five sets: about 76k Chrome, 73k Firefox and 73k webkit-host cases, forward order, scorer 5. Sets are development, held-out 09-16, rule families, feature families and one fresh set (seed facts-free-1).

**Headline, with facts → without**

| Browser | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| Chrome | 99.60 → 98.28 (1,003 cases) | 99.51 → 97.79 (1,313) | 95.13 → 91.63 (2,661) | 90.90 → 90.34 |
| Firefox | 99.86 → 99.82 (28) | 99.69 → 99.59 (73) | 95.99 → 95.54 (327) | unchanged (3) |
| webkit-host | 99.77 → 99.76 (3) | 99.44 → 99.44 (6) | 95.18 → 95.14 (30) | 85.92 → 85.87 (30) |

No case in any browser passes all three prediction metrics only without facts.

**How it was run**
- `rebuild/lab/baselines/no-facts-predictor.ts` is a copy of `predictor.ts` that gives every font `UNKNOWN_FONT_FACTS`. `predictor.ts` exports only `predict` and `paint`, so `engineOf`, `givenFacts`, `environment`, the tree walk, `layoutInput`, `predict` and `paint` are copied. The only change is the facts call.
- Each pair used the same case files, the same sharding and the same pinned builds (Chrome 153.0.8010.50, Firefox 156.0, WebKit 22625.1.29.11.27).
- `bundleSha256` takes one value per predictor over all 90 runs (facts 80b6b4b8…, no facts 00b8c9f1…). A module-by-module rebuild of both bundles shows they differ only in the predictor, `font-facts.ts`, `font-facts.json` and one bundler rename in `page.ts`.
- The source tree hash is the same at the start and at the end. There were no native, prediction or painter errors.
- Each run is scored against its partner's native observation. One Firefox fresh case differed and is excluded from both sides.
- Not run: the 9 giants, the reverse order and installed Safari.

**Per set, with → without**

| Browser | Set | Cases | lineCount | breaks | widths | painter | failing rows | no covered explanation | predicted values agree | values predicted |
|---|---|---|---|---|---|---|---|---|---|---|
| chrome | development | 25241 | 99.79 → 97.73 | 99.78 → 97.50 | 97.09 → 93.60 | 96.89 → 96.79 | 89 → 1429 | 1 → 0 | 99.992 → 99.897 | 61.6 → 7.9 |
| chrome | held-out | 15196 | 99.49 → 97.68 | 99.45 → 97.23 | 93.77 → 88.65 | 93.20 → 91.95 | 174 → 1367 | 2 → 0 | 99.986 → 99.891 | 52.3 → 6.7 |
| chrome | rule families | 11154 | 98.60 → 97.33 | 98.19 → 95.77 | 95.59 → 91.20 | 94.21 → 92.96 | 428 → 954 | 0 → 0 | 99.861 → 99.524 | 74.7 → 18.9 |
| chrome | feature families | 13046 | 100 → 99.88 | 100 → 99.88 | 90.29 → 88.91 | 71.19 → 70.99 | 0 → 188 | 0 → 0 | 99.998 → 100 | 94.1 → 8.8 |
| chrome | fresh | 11356 | 99.85 → 99.40 | 99.75 → 98.75 | 97.70 → 94.78 | 93.90 → 93.53 | 62 → 413 | 0 → 0 | 99.968 → 99.876 | 72.9 → 11.1 |
| firefox | development | 25135 | 99.90 → 99.90 | 99.90 → 99.88 | 98.18 → 97.98 | 94.84 → 94.83 | 457 → 508 | 0 → 0 | 99.909 → 99.904 | 96.4 → 95.6 |
| firefox | held-out | 15196 | 99.90 → 99.89 | 99.87 → 99.86 | 97.22 → 96.93 | 92.74 → 92.73 | 423 → 467 | 0 → 0 | 99.979 → 99.979 | 95.7 → 95.3 |
| firefox | rule families | 9776 | 99.44 → 99.20 | 98.36 → 97.79 | 94.35 → 92.92 | 88.66 → 88.66 | 552 → 692 | 0 → 0 | 99.940 → 99.859 | 90.0 → 86.8 |
| firefox | feature families | 12050 | no change | no change | no change | no change | 0 → 0 | 0 → 0 | 100 → 100 | 94.4 → 93.7 |
| firefox | fresh | 11121 | 99.93 → 99.90 | 99.82 → 99.72 | 97.10 → 96.28 | 89.79 → 89.79 | 194 → 286 | 0 → 0 | 99.995 → 99.989 | 98.1 → 96.8 |
| webkit-host | development | 25180 | 99.90 → 99.89 | 99.63 → 99.63 | 98.10 → 98.07 | 94.01 → 93.98 | 240 → 249 | 1 → 1 | 99.707 → 99.703 | 15.5 → 15.5 |
| webkit-host | held-out | 15196 | 99.62 → 99.61 | 99.11 → 99.09 | 96.30 → 96.22 | 83.71 → 83.63 | 305 → 317 | 1 → 1 | 99.554 → 99.536 | 15.9 → 15.9 |
| webkit-host | both family sets | 21994 | no change | no change | no change | no change | 283 → 283 | 0 → 0 | same | same |
| webkit-host | fresh | 11086 | 99.77 → 99.76 | 99.24 → 99.22 | 94.23 → 94.15 | 83.79 → 83.71 | 263 → 272 | 0 → 0 | 99.439 → 99.424 | 26.7 → 26.7 |

Chrome's "0 without a covered explanation" means nothing without facts. With `opticalSizeAxis` unknown, the `optical-size` gap fires on 99.9% of passing lines and covers every failure. Ignoring that gap, 49 Chrome rows have no covered explanation, against 3 with facts. This count is approximate.

**Which fact each lost case depends on**

Each case that passes with facts and fails without was re-predicted with each fact alone and with each fact removed. These predict-only re-runs of the full and empty fact sets reproduce every status of the main runs.

| Browser | Lost cases | Deciding fact | Main families | Covered by the fact's own gap |
|---|---|---|---|---|
| Chrome | 2,661 | `joining` 2,183 | rule/joining 384, suite/raw-context 114, U+2028/start 59, U+200D/end 50 | `joining-technology` 2,130 |
| | | `pairKerning` 436 | rule/text-align 208, rule/following-space 69, rule/in-word-breaks 51, suite/negative-space 34 | `unsafe-to-break` 356 |
| | | `coverage` + `ligatures` 20, plus 5 that also need `joining` | suite/word, runs/bidi-runs | `glyph-clusters` 25 |
| | | `mapsHyphen` 17 | rule/joining, all in Geeza Pro | `hyphen-glyph` 13 |
| Firefox | 327 | `pairKerning` 304 | rule/in-word-breaks 80, rule/hyphen-glyph 56, suite/ligature-thresholds-v3 22 | `in-word-prefix` 304 |
| | | `coverage` 23 | rule/hyphen-classes | `font-fallback` 23 |
| webkit-host | 30 | `monospace` 30 | ws/controls 20, ws/text-nodes 10 | `fixed-pitch-path` 30 |

`primaryFamily`, `opticalSizeAxis`, `spacingInputs`, `scriptLookups` and `realizes` decide no transition in any browser. They only change which gaps fire. With prediction passing both ways, the painter changes on 12 Chrome cases (all `joining`) and nowhere else.

**Gaps that fire more without facts (share of passing lines, all sets pooled, with → without)**

| Browser | Gap |
|---|---|
| Chrome | `optical-size` 0.21 → 99.92; `script-context` 20.1 → 32.4; `float32-precision` 2.2 → 14.0; `glyph-clusters` 6.0 → 7.9; `joining-technology` 0 → 2.03; `hyphen-glyph` 0 → 1.05 |
| Firefox | `in-word-prefix` 2.99 → 4.13; `font-fallback` 0.01 → 0.17 |
| webkit-host | `fixed-pitch-path` 0.12 → 28.3; `simplified-measuring` 6.0 → 23.5; `hyphen-glyph` 0 → 2.7; `letter-spacing-ligatures` 0.10 → 0.52 |

**Can the library learn each fact from Canvas at runtime?**

I probed 51 family names from the lab's cases in all three browsers and compared each candidate Canvas check with the lab's font table.

| Fact | Learnable? | How, and how it checked out |
|---|---|---|
| `joining` | Yes, in Blink | Measure beh, U+07FA alone, and beh + U+07FA. The N'Ko letter is another script run, so Canvas shapes beh in its own HarfBuzz call with the rest of the string as context. A non-additive width means the font reads that context. All 7 OpenType families join and all 22 AAT-fallback families don't. Blind on 4 fixed-pitch fonts, whose joined forms are as wide as isolated ones. Verified by probe only; the source isn't read yet. Firefox and WebKit Canvas show no context, and neither browser loses anything to `joining`. |
| `mapsHyphen` | Yes | Measure `‐` under `F, monospace` and under `F, serif`. Different widths mean the font doesn't map it. Geeza Pro and Apple Color Emoji come out false and the other 34 true, as the table says. Chrome's DOM soft hyphen in Geeza Pro is 9.69px wide, the width of `-`, while Canvas gives `‐` 5.33px. |
| `primaryFamily`, `realizes` | Yes | The same two-fallback check on a probe string. It agrees on 34 of 37 realizing families. The 3 misses (Geeza Pro, Apple Color Emoji, Noto Sans Myanmar) don't cover the Latin probe string, so the check needs a probe string per script. |
| `monospace` | Yes, in practice | Equal advances over printable ASCII agree with the table on all families (4 true in Chrome and Firefox, 5 in webkit-host). It infers Core Text's trait and doesn't read it. |
| `opticalSizeAxis` | Blink and WebKit yes; Firefox Canvas no | Width per px at 8, 16, 32 and 64px is constant except for the system UI font: 34 of 34 agree. In Firefox's Canvas, 7 fonts without the axis look size-dependent. In Chrome this check removes the gap that fires on every line. |
| `pairKerning` | No | Canvas shows the pair's total adjustment. Which glyph carries it never reaches widths or bounding boxes, and no browser ships per-glyph metrics. Putting a combining mark between the pair doesn't separate the two kinds either. |
| `coverage` | Partly | The two-fallback check per code point. It is blind where both fallbacks give the code point the same width (Arabic, CJK). Firefox's 23 cases turn on whether U+2010 comes from the listed font, which the two-fallback check on U+2010 tests. |
| `ligatures`, `spacingInputs` | Partly, per string | Compare a string's width with and without U+200C between clusters. This misses ligatures as wide as their parts, such as Geeza Pro's lam-lam-heh. |
| `scriptLookups` | Not cleanly | It decides no transition. |

**Chrome projection (lineCount / widths)**

| Set | With facts | Without | Unknown `joining` treated as OpenType | Only the Canvas-learnable facts |
|---|---|---|---|---|
| development | 99.79 / 97.09 | 97.73 / 93.60 | 99.74 / 94.70 | 99.77 / 96.91 |
| held-out | 99.49 / 93.77 | 97.68 / 88.65 | 99.36 / 90.19 | 99.43 / 93.56 |
| rule families | 98.60 / 95.59 | 97.33 / 91.20 | 97.87 / 93.29 | 98.28 / 94.42 |
| fresh | 99.85 / 97.70 | 99.40 / 94.78 | 99.64 / 95.03 | 99.74 / 97.04 |

The last column is a projection, not a measurement: the table's values stand in for the checks' answers. What stays lost there is `pairKerning`: for example 180 feature-family widths (208 cases in rule/text-align over all sets). Treating an unknown `joining` as OpenType recovers line counts but costs 110 to 557 cases per set in fonts whose Arabic falls back to Geeza Pro.

**Files**
- Everything is under `/Users/chenglou/github/pretext-rebuild/.artifacts/lab/facts-free/`. Rows are compressed.
- Main runs: `<browser>/<set>/{facts,nofacts}/`.
- Tables and records: `analysis/` holds `tables.txt`, `summary.json`, `transitions-*.json`, `attribution*.json` and `.txt`, `gap-firing.*`, `variant-*.{json,txt}` and `reports/` (the `fresh.ts` reports per set group).
- Re-predictions by fact: `ablation/`. Chrome projections: `variants/`.
- Canvas check probe: `probes/learn-facts.ts` with `probes/out/verdicts.txt`.
- Scripts: `tools/`. Logs: `logs/`, including `bundle-check.log` and `tree-hash.log`.
- Fresh cases: `.artifacts/lab/fresh/<browser>/facts-free-1/`.
- The one new repository file is `/Users/chenglou/github/pretext-rebuild/rebuild/lab/baselines/no-facts-predictor.ts`. It is uncommitted.
