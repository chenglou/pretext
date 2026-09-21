# Pretext rebuild

The current goal is to make the stateless core cheap, with simple data flow and predictable cost, and to make its tests
reflect native browser behavior. A new paragraph should do only the work its requested output needs. Optimize until the
remaining gains are small relative to the code, assumptions, and state they would add. There is no arbitrary time bar.
The engineering approach follows `~/github/vibescript/docs/engineering.md`.

This guide records the takeover on 2026-09-20. The prior research endpoint is preserved at
`codex/redo-handoff-backup-20260920` (`9369b7f`), with every committed study branch in a verified local Git bundle.
`HANDOFF.md`, `CHARTER.md`, and the dated research reports preserve how that endpoint was built. Their previous phase
ordering, freezes, and requests for maintainer decisions do not constrain this work; the maintainer authorized changes
to the foundations, harness, scope, and intermediate behavior.

## Core

The public dispatch is `src/index.ts`; each engine owns its preparation and line-filling rules under
`src/engines/{blink,gecko,webkit}`. Canvas supplies measurements. DOM reads and font-file loading are outside the core.
Plain preparation computes lines and pieces; inspection additionally computes diagnostic geometry and uncertainty.
Keep those costs distinct, and retain information needed by actual line decisions when removing diagnostic work.

Prefer fewer representations, local derived values, and ordinary loops. Preserve shaping context at measurement
boundaries. A smaller number of Canvas calls is not itself a speed result or a correctness argument. Sampled font
behavior is evidence; it must not silently become a guarantee about arbitrary fonts.

Measure stateless preparation plus filling from scratch, separately from repeated widths on retained prepared data.
Report fresh contexts and a caller-owned context list separately. Keep browser, DPR, font, input population, power
conditions, and base/head commit beside a timing. Use alternating pairs for small gains and inspect latency tails.

## Tests and iteration

Start with the tests for the affected code, then the relevant engine's replay and function checks:

```sh
bun test rebuild/src/measure/font-checks.test.ts
bun rebuild/tests/gates.ts --engine=blink --quick
```

The quick gates still traverse the selected engine's full recorded references; they are not a tiny smoke suite.
`TESTS.md` and the lab README's **Test tiers** explain the existing commands and artifact inputs.

A replay answers what the recorded Canvas calls answered and protects prior output. Native observations answer whether
that output is correct. Keep both. Changes to measuring questions or string storage require targeted native checks;
changes to observation or acceptance rules require planted defects that the old rule missed. A browser-history change
and a predictor-order change are different facts. Newly unstable predictions must not acquire a browser exemption.
Failures remain visible even when a diagnostic gap explains them.

Main's passing cases are external browser obligations when their visible breaks agree with native layout, rather than
only their line count agreeing. Do not discard a real passing result because its implementation is heuristic. Keep
ambiguous or history-sensitive observations separately, with their provenance; do not select exclusions by rebuild
failure. The full imported main corpus is useful for broad checks; a smaller representative browser set should make
routine iteration quick without replacing that corpus.

Browser jobs are scheduled by the root agent, one checker per browser. The local wrapper is
`.artifacts/session/with-browser-lock.py`. Laptop/battery runs are authorized; record that condition. Do not alter or
stop unrelated processes. Run large evaluations only for an unresolved question that a focused check cannot answer.

## Current work

- Repair acceptance and native-history comparison, with explicit migration of old ledger semantics.
- Omit Blink's diagnostic scaling probe on plain preparation while retaining primary-font resolution.
- Avoid building unused per-character measuring maps on plain zero-spacing text.
- Remove repeated dictionary machinery and boundary-array copies in Gecko; discard the scan-carry micro-optimization.
- Establish a fast browser set protecting main's sound passes, and measure the resulting current implementation.

Update this short list and the relevant design/test documentation as work lands. The dated studies are reference
material; they are not an additional task queue.
