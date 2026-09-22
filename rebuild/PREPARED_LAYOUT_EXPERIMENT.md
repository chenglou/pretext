# Prepared plaintext experiment, 2026-09-22

The useful general result is a smaller counter in the existing public engine. `layout()` no longer maintains source endpoints, callback state and paint widths when it only needs a line count. Preparation, measurements, break policy and retained data are unchanged. Complex prepared data still uses the existing walker. Rich painting remains paused.

Main already demonstrates numeric layout at arbitrary widths with no Canvas calls. Its whole-unit admission widths and emergency advances are separate facts; tabs, soft hyphens, signed spacing and fresh entries need their existing rules. Main's observed accuracy is the baseline, not a guarantee of arbitrary contextual font behavior.

## Public count improvement

The source at main `2e5e2bdaee398784b9cf27b24ca96df2e85396b8` is byte-identical under `src/` to the suite's pinned `7c2ec519922e364ecc80dcb88596047fd3b54e3c`. The redo published source previously matched both. The new count function is the only runtime difference in the fair source pair.

Sixty foreground documents retain 2,700 timing rows: fifteen samples per document, two discarded warmups, rotating order, isolated timers and at least 20ms/50 timer steps per sample. Every saved timing endpoint and script start/end is visible, focused and DPR 2. Three public Chrome runner boot/bookend observations are unfocused; they are retained. Continuous focus between observations is not proven. No public sample exceeds three times its document/label median.

Paired new/old median ratios for repeated layout, thirty-two texts at three widths (lower is better):

| Browser | Latin | CJK | Arabic | Mixed |
| --- | ---: | ---: | ---: | ---: |
| Chrome | .440 | .341 | .411 | .616 |
| Firefox | .455 | .471 | .490 | .692 |
| Safari | .322 | .303 | .307 | .557 |

For four unbroken ASCII words growing from 64 to 2,048 characters, ratios are Chrome .090–.134, Firefox .220–.270 and Safari .395–.419. These are the public `prepare()`/`layout()` exports on otherwise identical source trees, not a bare integer helper compared to an object-returning API. Unfamiliar-width gains are similar. Counts and Canvas statistics agree at every control boundary. No new prepared array is retained.

The earlier bare-counter matrix is separate: eighty documents, 4,320 rows, fourteen slow Chrome samples retained. Its helper/public wrapper difference prevents using it alone as an API speed claim. Its v2 unfamiliar-width protocol reuses immutable numeric data while redo receives fresh prepared values per repetition; preparation/first fill occurs outside that clock. It measures unfamiliar-width work, not a cold CPU cache. The initial manifest predates this generator correction; recorded full scripts and reconstruction establish capture provenance instead.

Independent numeric differentials cover 409,455 + 830,622 comparisons with no count differences and prohibited Canvas during layout. Four permanent tests cover leading/resumed ZWSP, overwide progress, whole admission before emergency splitting, preferred cuts and complex spacing/SHY/TAB/hard-break fallback. A first test draft demanded bit-identical widths from two unchanged APIs whose floating sums differ by about 2e-15; the count test now compares source cuts exactly. Existing library tests and numeric tolerances are unchanged; the separate observer correction below applies to both main and current.

## Preparation experiment

A single-word Chrome control retains one numeric position column and no text/context/tree. Eager original-prefix preparation retains linear data but submits quadratic text on tiny-character controls; this approach is rejected for general preparation. Pair-local preparation avoids that submitted-text growth but still builds redo's full temporary engine record.

Direct preparation reuses the original font/language/style/scaling producers and measures distinct letters and pairs in temporary numeric tables, plus the whole word. It avoids the full temporary paragraph record. In fresh native growth controls, preparation makes thirteen Canvas calls and submits N+16 UTF-16 units; retained position bytes are exactly 4(N+1). This excludes object headers, transient peak memory and native browser caches.

This is an empirical research subset. Zero pair adjustments and equality of whole/local sums cannot certify every internal substring: a synthetic context can leave singles, pairs and the whole unchanged while changing a triple. Whole residuals can also reflect float arithmetic. Such rejections identify an omitted representation, not proof of necessary expense. Unicode, whitespace rules and general contextual shaping remain unresolved; no font-specific admission table or Canvas-calling numeric fallback is introduced.

Fresh Chrome checks retain native observations and canonical main assessments in both orders. The final growth run has 66 documents and 574 layouts; eager/local/direct/plain-scan/selected-bracket controls each support 202 layouts, matching visible native source cuts/counts with zero layout Canvas calls. Narrow, zero, unfamiliar wide and rounding-boundary widths cover word lengths 64 through 2,048. Unsupported hard-negative families remain recorded, including AV/ligatures, signed spacing, Arabic/Urdu, controls, emoji, combining marks and CJK. The candidate has not covered the general main-pass population and is not a public replacement.

The selected counter searches an exponentially growing bracket from the current line start, then bisects it. It preserves the exact Chrome conversion, saturated arithmetic, whole admission and mandatory cut progress. Independent proof covers 13,016 count/end comparisons and fifty-four growth controls through 16,384 positions, with at most 5N indexed reads per width. The total comparison work is O(N) on qualified monotone inputs, without another retained column; this is not a bound for every general walker.

Final narrow and wide captures retain eight documents and 1,536 rows, twenty-four balanced rounds after two warmups. All thirty-four samples above three times their document/label median stay in the statistics. Every sampled timing endpoint, script start/end and aggregate environment is focused, visible and DPR 2; continuous focus between observations is not inferred.

| Phase / geometry | Direct binary / main | Selected bracket / main | Bracket / binary | Bracket / plain scan |
| --- | ---: | ---: | ---: | ---: |
| Narrow prepare | 9.496 | 11.657 | 1.234 | 1.219 |
| Narrow prepare + first | 12.875 | 10.700 | 1.036 | 1.074 |
| Narrow unfamiliar | .678 | .281 | .416 | 1.303 |
| Narrow repeated | .721 | .295 | .409 | 1.294 |
| Wide prepare | 12.059 | 13.456 | 1.171 | 1.332 |
| Wide prepare + first | 8.094 | 11.948 | 1.287 | 1.241 |
| Wide unfamiliar | .025 | .029 | 1.170 | .269 |
| Wide repeated | .026 | .031 | 1.168 | .264 |

All three direct labels call the same preparation factory, but their measured preparation medians differ. Every result is retained; the final gap spans about 9.5–13.5× main, not just the earlier more favorable result. Four identical N512 words cost main seven Canvas calls/518 submitted UTF-16 units and direct fifty-two/2,112. Main shares font/segment answers; direct repeats paragraph-local context and learning. This ownership difference is an open cost, not proof of necessary work. Canvas statistics come from a separate fresh workflow after timing, not every timed repetition.

Narrow repeated medians are main .020942ms, binary .015050ms, scan .004771ms and bracket .006175ms. Wide medians are main .020674ms, binary .000541ms, scan .002393ms and bracket .000632ms. Bracketing improves binary by about 59% narrow but costs about 17% wide; it is about 29% slower than scan narrow and 74% faster wide. Keep one counter to avoid variant churn. These integer helpers include a wrapper difference against public main; the fair three-browser public API pair above is the general speed evidence.

Four words retain 8,208 position bytes. Zero strings/contexts describes their numeric results, not page-held source, physical heap, transient peak or browser caches. Seven numeric timing labels use no layout Canvas; redo-range's recorded first/unfamiliar measurement work remains. All eight counts agree in the selected controls. No huge substring table, font-specific admission table or new shared cache was added.

## Native observer and Safari 27

The first canonical refresh stopped on two pre-existing required Safari failures; main and current were identical at every observed metric. The fractional failure used 20.96px CSS, a rounded two-line height of 41.90625px and a three-line height of 62.875px. Dividing the first by two made the latter 3.0007457 lines. Identical spans on independently forced lines, in the same font/language element, measure 20.960000038px advance. A shared decoder admits a count only when exactly one integer fits the unchanged .02px pixel criterion. Invalid or ambiguous geometry stays unobserved. Captured 1/2/3/4/8/16/64-line blocks decode correctly; planted two/four predictions fail even with a correct height. The observer, not the library, was corrected for both versions. Two endpoint measurements have finite precision; much longer future fractional paragraphs may be unobserved and need an independent calibration, not a wider count tolerance.

Safari 27.0, engine 22625.1.29.11.27, now includes the deferred keep-all punctuation change. `foo。bar日本語` at 40px has five unmodified lines while diagnostic grapheme spans and the public engine give four; six named/generic font variants preserve that difference. This is a genuine unfixed compatibility gap, not a corrected plaintext pass. Earlier Safari 26.x success is not retroactively called accidental. The exact maintained row keeps required span count/breaks, explicitly defers absolute native height and retains failing height/source/width observations. Neither Blink nor ICU4X's pair model matches the new WebKit rule. A versioned preprocessing policy is deferred in the platform/follow-up ledgers; no blind profile substitution was made.

## Validation and stopping point

Final validation passes: 1,496 tests in 123 files, root type/lint/dead-code checks, the minimal experiment's strict `--noEmit` project and package smoke. The root dead-code project now matches the root TypeScript scope instead of scanning the independently configured rebuild lab; this fixes project ownership, not library code. The lab's new research entry is explicit; a whole-lab dead-code cleanup is not claimed.

The native ordinary run retains 33,720 inputs across all three installed browsers and both directions, plus ten numeric source/profile reports. Main/current metric totals and outcome categories agree exactly, with zero lost successes, new API/rich failures, observation losses or execution errors. Required checks pass after the explicit single Safari 27 native-height deferral above. Thousands of source/boundary/width metrics remain unobserved; a height pass is not promoted to source correctness. Accuracy, letter-spacing and all three corpus snapshots were refreshed from suite `703079cff81830edcd1f3feb18578507eb34887d172d4e46b4b7de4398cc84b9`.

Chrome/Safari benchmark snapshots each retain three full foreground runs, matching start/end/three-run geometry, no recorded environment changes, explicit `en` and DPR 2. Chrome uses screen 2560×1440/viewport 2504×1273; Safari reports portrait screen 1440×2560/viewport 1440×2440. All section medians reconstruct from the three raw runs. The historical snapshot comparison is Chrome hot `layout()` .0880→.0295ms, preparation 9.10→9.25ms; Safari .105→.035ms, preparation 13→10.5ms. Preparation code is unchanged, so the latter historical difference is not a preparation optimization. Use the otherwise-identical paired API matrix for causal speed claims.


The new two-module laboratory at [experiments/prepared-numeric](experiments/prepared-numeric/README.md) uses existing exported redo producers directly. Only import paths differ from the frozen constructor; the bracket body matches its independent proof. It is not public API, automatic font qualification or a general replacement. All broader prototypes, failed versions, initial expensive-setup interruption, complete generated programs, raw native/timing captures and independent auditors stay external.

This round found a useful structural public improvement and bounded preparation evidence. The redo core under `rebuild/src` remains byte-identical to `0bdea4d`; its general preparation and resize gap remains. Main already provides an existence proof for cheap numeric layout within observed coverage. Next, test a bounded main-shaped representation for broader plaintext and ownership of font/style facts within preparation. Preserve main's genuinely supported native source cuts/counts; keep Unicode, contextual shaping and signed spacing explicit. Exact identity source maps are deferred behind that architecture question. Rich painting remains paused. Neither rejected variants nor this narrow control prove all remaining costs necessary or finish stateless work.

## Evidence and provenance

The persistent archive is at `/Users/chenglou/.codex/visualizations/2026/09/20/01a0c12e-d771-7763-acab-9b673ed39827/prepared-plaintext-20260922/`. It includes a file/hash index, all Git refs, source closure ledgers and full readback verification. The previous round remains independently archived and protected by the backup ref at `0bdea4d`.

The independent performance audit reconstructs all 140 saved original/public programs byte-exact. At the independent timing audit, the early 426-file seal matched 423 inputs; three generator/native-entry changes were named rather than treated as a v2 before/after seal. Final closure matches 422/426 after the later growth-fixture extension, and 385/387 in the later seal after documented public-source comment/oracle changes. Every final canonical suite/runtime input matches its recorded capture; the integrated counter matches the fair timing source byte-exact. The closure ledger names every difference. Final bracket programs/bundles also reconstruct exactly; no unavailable continuous filesystem identity is claimed. Saved prototype rejection and test-draft failures remain separate from passing final evidence. Numeric payload, mocked differentials, native observation and foreground timing are separate claims throughout.
