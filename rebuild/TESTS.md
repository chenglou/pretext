# Tests for the rebuild

The current goal is a cheap stateless core and tests that reflect native browser behavior. [README.md](README.md)
is the entry point; [TAKEOVER.md](TAKEOVER.md) records decisions, evidence and unresolved failures. The previous
1,000-line phase plan is preserved in [the historical test endpoint](research/TESTS-ENDPOINT-20260920.md) and the
backed-up branch. Its report-only policy for main passes is superseded by the independent native obligations below.

## Iteration

Run affected behavioral tests first. Small suites usually finish in under a second. When a core change is ready,
run its browser's certified native workflow:

```sh
bun test rebuild/src/engines/blink/canvas-text.test.ts rebuild/src/measure/font-checks.test.ts
bun rebuild/tests/run-main-obligations.ts --browser=chrome --catalog=<current-audited-catalog> --out=<new-run>
```

Use `firefox` for Gecko and `webkit-host` for WebKit. The current sealed catalog paths are in `TAKEOVER.md`.
[Main obligations](tests/MAIN_OBLIGATIONS.md) describes discovery, full-population source auditing and deterministic
input-only fast selection. A certified requirement comes from main's actual passing visible source/count behavior
against its original native observation. Redo failures, diagnostic gaps, origin or known native variation cannot
withdraw it. Refuted and uncertain historical labels remain visible.

The portable driver holds the maintained browser lock across four sequential fresh inspected/plain jobs, in both
orders, then checks actual source cuts, complete native observations, compatible environments, native stability,
predictor order stability and mode parity. Main comparisons are optional predict-only diagnostics and are clearly
identified as borrowing native state. They do not establish a fresh main certificate. Actual child failures and
missing/invalid completion reports cannot become successful workflow exits.

The focused inspected adapter retains the complete core preparation, fill and inspection; it skips only lab expected-observation generation and painting. Full geometry suites retain their original adapter. The standalone checker rejects inspected captures supplied as plain evidence.

Known core misses and observed native variation make this strict workflow nonzero. Compare the report with the
specific open failures in `TAKEOVER.md`; no automatic history exemption or acceptance seed is applied here.
A 1,000-case marginal-feature sample is useful for iteration, not a proof of every combination or threshold.

## Offline closure

Before closing an engine change:

```sh
bun rebuild/tests/gates.ts --engine=blink --quick --fresh
```

`--engine=all` runs all engines. Quick gates check six strict TypeScript projects, behavioral unit tests, full recorded
predictions in both facts configurations, and the exported functions' plain/pure behavior across the full reference
populations. The all-engine check takes about three minutes in this takeover. It uses recorded Canvas answers and
protects prior output; it cannot establish native correctness or the cost of changed measurement questions.

A deliberate core change can produce nonzero replay gates. Retain the actual result, inspect complete differences,
and prove the intended behavior independently; do not rename it a pure refactor or silently replace reference output.
The first 2026-09-21 general-cost batch changes only diagnostics among complete replayable predictions. The second
batch retains exactly those replay classifications and ordered question behavior while repairing input-sized metadata
and diagnostic scans. Both preserve prior native fast
obligations and classifies targeted misses against the preserved core. [GENERAL_COST.md](GENERAL_COST.md) records its
skips and remaining native work.

A changed Canvas question or encoding needs targeted native protocol/output evidence. A changed acceptance rule
needs a planted defect demonstrating the old false green. Conservative replay rules may request browser evaluation
for storage or repetition changes; any skipped request needs its actual narrower evidence recorded, not a fabricated
completion. Larger non-quick evaluations remain available in `gates.ts` and the detailed [lab guide](lab/README.md)
when a concrete question needs them.

## Whole texts and maintained requirements

[Book survey](tests/BOOK_SURVEY.md) selects all 18 entire maintained texts at original endpoint widths, without reading
outcomes. It captures six fresh own-native main/inspected/plain jobs under one lock. Raw and maintained-normalized
paragraphs are separate source contracts. Strong requirements need stable main actual public count and complete visible
source cuts against its own native rendering in both orders. Original raw-prepared/normalized-painted height passes
are retained separately and cannot become cut certificates. The survey retains every miss and uncertain case; adopting
only its successful subset is prohibited by its explicit certificate flag.

The independent maintained-required inventory protects membership and stored line-count status. Original height
rules, preparation locale, Range/span extractor choice and the rich public API contract remain those of main's
maintained wrapping suite. Neither frozen replay nor the stronger cut sample alone proves every original contract.

## Scoring and acceptance

Scorer 8 compares the complete native scorer view: collection lengths, code-point/node/element horizontal geometry,
line assignments and slot floats. The actual lab geometry and its per-run/per-element population must be complete before scoring; empty lists retain
legitimate node placeholders. Negative positions and
zero dimensions are valid; nonnumeric/nonfinite coordinates and negative dimensions are unavailable evidence.
The scorer view is not a byte comparison of every raw DOM observation or a proof of vertical layout.

Ledger format 3 separates actual native variation from prediction order dependence. An unstable prediction against
one stable native target retains its per-order pass/exact/error-count obligations. Becoming consistently wrong is
not an improvement. New native variation blocks prior obligations instead of silently retiring them. Known inherited
native exclusions remain explicit. Complete selected runs must retain expected reference cases; focused subsets may
omit unselected cases. Migration stages changes from both saved orders for review and does not overwrite raw evidence.

The scorer's indexed range and node-box lookups remove full-book scans without changing their containment/first-match
semantics. Legacy malformed or overlapping diagnostic ranges retain their original scan; the independent source
certificate rejects invalid predicted ranges. The observation ports, diagnostic gap claims and painter results cannot
forgive a missing visible scalar in a source-cut obligation.

## Browser protocol

Run one checker per browser and use the canonical browser-automation lock. Named fonts and explicit nonempty page
language make accuracy cases interpretable. Keep timing work foreground and verify actual visible/focused endpoints;
record DPR, font, input population, context lifetime, source hashes and power conditions. Accuracy workflows are not
benchmarks. Headless results and installed-Safari comparisons need the caveats in `DEVELOPMENT.md` and
`PLATFORM_BUGS.md`; do not change tolerances or engine workarounds from an extractor hypothesis alone.

Browser build changes, new Canvas questions, full installed-Safari evaluation, exhaustive interactions and renewed
canary sweeps are larger checks with explicit provenance. Reuse is valid only for the inputs actually sealed by a tool.
