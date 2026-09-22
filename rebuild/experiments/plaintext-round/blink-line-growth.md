# Blink line source-read growth

`blink-line-growth.ts` compares the immutable A6 source with the current source on long unbroken ASCII words and many
separate text leaves ending in SHY. This is a cheap owned-read experiment, not browser accuracy or native timing.

```sh
bun rebuild/experiments/plaintext-round/blink-line-growth.ts \
  --base=/private/tmp/pretext-stateless-round2-baseline-20260922 \
  --out=/private/tmp/pretext-blink-line-growth.json
```

The defaults are N64, 128, 256 and 512. ASCII paragraphs have one text leaf, with narrow widths of 8 and 32 CSS px.
SHY paragraphs have N separate leaves, each `a` SHY, with a wide slot that holds them on one line. The deterministic
Canvas and complete declared font facts describe a synthetic font; they make no assertion about an installed font.
The font keeps this experiment focused on the source scans rather than additional questions for missing font facts.

Each case checks plain and inspected preparation, full and range fills, complete source bounds, continuation states,
line-box counts, and the ordered context/settings/Canvas question stream. A baseline run without instrumentation must
match the instrumented baseline. The helper refuses emitted JS sidecars that could bypass the instrumented source,
and refuses a zero baseline observer on either the ASCII break path or the SHY identity-search path.

A frozen source facade delegates `charCodeAt` and `slice` on each iterator's own source. It does not replace a paragraph
string or modify `String.prototype`. Scoped wrappers around the two explicitly loaded modules' methods separate
`breakLine` reads from finalization reads. On these unbroken ASCII cases the finalization reads come from the
inspection look-ahead after the break was decided. Slices return the original primitive spelling to ICU; the report
counts their submitted units separately, and does not claim to count ICU's internal source reads.

An own `indexOf` method on each result array counts comparisons in the dense rows the helper produces. It does not
modify `Array.prototype`. This tests the known-row searches that a handler can replace by passing its row index.
All descriptors and retained instance sources are restored in `finally`. `blink-source-counter.test.ts` checks that
these scoped observers preserve source operations and leave global prototypes untouched.

The report preserves every resulting range and seals the inputs, runtime sources, helper and counter. It compares
complete measurement events in memory and records their hashes. Canvas calls and submitted UTF-16 are reported
separately: fewer owned suffix scans do not prove linear Canvas work, universal linear shaping, or a native speedup.

## Captured result

The 2026-09-22 prototype capture checked 12 cases and 48 full/range comparisons: all source bounds, continuation states,
line-box counts and ordered Canvas events matched A6. Runtime seals were unchanged within the run. The unit observer
checks passed (2 tests, 23 assertions); the focused strict configuration uses `noEmit`.

```sh
bun test rebuild/experiments/plaintext-round/blink-source-counter.test.ts
bunx tsc -p rebuild/experiments/plaintext-round/blink-growth-tsconfig.json --noEmit --pretty false
```

| N | ASCII width 8: A6 finalization reads | Current plain reads | SHY leaves: A6 identity comparisons | Current comparisons |
| --- | ---: | ---: | ---: | ---: |
| 64 | 4,032 | 0 | 2,080 | 0 |
| 128 | 16,256 | 0 | 8,256 | 0 |
| 256 | 65,280 | 0 | 32,896 | 0 |
| 512 | 261,632 | 0 | 131,328 | 0 |

For these controls the removed ASCII suffix reads equal N(N−1), and the removed SHY identity comparisons equal
N(N+1)/2. Inspected ASCII finalization reads remain exactly equal to A6; inspected SHY identity comparisons also fall
to zero. Direct reads while breaking and all ordered Canvas questions remain equal. Width 32 controls show the same
plain/inspected split. This establishes two removed owned scans on these inputs, not an overall linear-work claim.

The exact helper, report, commands and runtime seals are preserved in
`.artifacts/plaintext-round2-20260922/growth/`. An earlier pilot is marked invalid there: emitted JS sidecars bypassed
the instrumented classes and produced zero observers. The valid helper refuses that condition before measuring.

`blink-view-proof.ts` separately checks direct clipping and view-of-view bookkeeping against A6 with defined tab-result
arithmetic. It covers empty results, inside zero-length cuts, outside cuts, LTR/RTL numbering, one/multiple parts,
repeated trimming, prefixes, grapheme numbering, unchanged original views, and widths around/past float32's 256 px
threshold. The capture found no difference in 1,330 direct cuts, 13,448 trims and 36 two-result joins. It asks no Canvas
questions and does not substitute for the complete actual-group/query-order proof.

```sh
bun rebuild/experiments/plaintext-round/blink-view-proof.ts \
  --base=/private/tmp/pretext-stateless-round2-baseline-20260922 \
  --out=/private/tmp/pretext-blink-view-proof-final.json
```
