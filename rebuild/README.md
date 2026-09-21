# Pretext rebuild

The goal is a cheap stateless core with simple data flow and predictable cost, and tests that reflect native browser
behavior. Optimize until the remaining gains are small relative to the code, assumptions and state they add. The
engineering approach follows `~/github/vibescript/docs/engineering.md`.

Start here. [TAKEOVER.md](TAKEOVER.md) records the current decisions, evidence and open failures. [DESIGN.md](DESIGN.md)
is the implementation reference; [TESTS.md](TESTS.md) documents broader checks. `HANDOFF.md`, `CHARTER.md` and dated
research reports preserve the prior endpoint, not another task queue. Its branch is backed up at
`codex/redo-handoff-backup-20260920` (`9369b7f`), with all committed studies in a verified Git bundle.

## Core

`src/index.ts` dispatches to `src/engines/{blink,gecko,webkit}`. Canvas supplies measurements; DOM reads and font-file
loading are outside the core. Plain preparation computes lines and pieces. Inspection additionally computes diagnostic
geometry and uncertainty. A paragraph should do only the work its requested output needs.

Prefer fewer representations, local derived values and ordinary loops. Preserve shaping context and numeric units at
measurement boundaries. A smaller number of Canvas calls is neither a speed result nor a correctness argument.
Sampled font behavior must not silently become a guarantee about arbitrary fonts. Keep engine-specific behavior explicit.

Measure fresh preparation plus all filling separately from repeated widths on retained prepared data. Record browser,
DPR, font, input population, context ownership, power conditions and source hashes. Alternate pairs for small gains.
The core changes and the measured reasons for stopping are in `TAKEOVER.md`.

## Iteration

Run the affected function tests first. They usually finish in under a second. For engine changes, follow with the
certified fast native workflow for its browser:

```sh
bun test rebuild/src/engines/blink/canvas-text.test.ts rebuild/src/measure/font-checks.test.ts
bun rebuild/tests/run-main-obligations.ts --browser=chrome \
  --catalog=.artifacts/tests/main-native/takeover-certified-compact-final-20260920/chrome \
  --out=.artifacts/tests/main-native-runs/<new>/chrome
```

The inspected-range adapter runs the complete inspected core and omits lab diagnostic observation and painting.
The workflow runs fresh inspected/plain preparations in both orders with no supplied font facts, then checks visible
cuts, complete source coverage, native stability and mode parity. It preserves actual child failures. Optional
`--main-comparison` adds two diagnostic main processes. [Main obligations](tests/MAIN_OBLIGATIONS.md) explains
certification, scope and provenance. A small feature-covering set speeds iteration; it does not replace the full corpus.
Known foundation failures and native variation still return a nonzero strict result; examine the report against the
open failures in `TAKEOVER.md`. There is no automatic waiver or acceptance seed in this workflow.

[Book survey](tests/BOOK_SURVEY.md) adds all 18 complete maintained texts at original endpoint widths, using separate
raw and maintained-normalized source contracts. Its portable driver records main, inspected and plain own-native
observations in both orders. Requirements come from main's actual visible/count passes; unresolved evidence stays
visible and blocks acceptance.

Before closing an engine change, run its recorded-output and function checks:

```sh
bun rebuild/tests/gates.ts --engine=blink --quick --fresh
```

Quick gates traverse the engine's full references. All-engine quick gates took about three minutes in this takeover;
they are a broader check, not the loop for every small edit. Replay protects prior output; native observations establish
correctness. Changed measurement questions or string storage need targeted native evidence. Changed acceptance rules
need planted defects that the old rule missed. Native history and predictor order dependence are separate facts.

The native driver holds the maintained browser lock across its sequential jobs. Run one checker per
browser. Keep timing work foreground and verify actual page focus. Laptop/battery runs are authorized; record their
conditions. Do not alter unrelated processes. Use large evaluations for unresolved questions that focused evidence
cannot answer. The current work left main's public source and package surface unchanged.
