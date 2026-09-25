# Pretext rebuild

The goal is a cheap stateless core with simple data flow and predictable cost, and tests that reflect native browser
behavior. Optimize until the remaining gains are small relative to the code, assumptions and state they add. The
engineering approach follows `~/github/vibescript/docs/engineering.md`.

The redo stops (the maintainer's rule, 2026-09-25) when: every remaining difference from the browsers on every set is a
named gap, a made-up or variation-extreme font, or a width under 24 px, and none is unexplained; it is a superset of main
in all three engines, rich inline included; and the speed recipes end with Blink's words first and the cut predictor.
After that the work is upkeep: pinning newer browsers, syncing main and adopting new browser APIs. A premise about fonts
that nobody has falsified may be taken for speed, as a documented default with a named gap, and where requirements have
to give, ad hoc ones go first, then petty ones.

Start here. [TAKEOVER.md](TAKEOVER.md) records the current decisions, evidence and open failures. [DESIGN.md](DESIGN.md)
is the implementation reference; [TESTS.md](TESTS.md) documents broader checks. `HANDOFF.md`, `CHARTER.md` and dated
research reports preserve the prior endpoint, not another task queue. Its branch is backed up at
`codex/redo-handoff-backup-20260920` (`9369b7f`), with all committed studies in a verified Git bundle.

The first completed bounded plaintext round is recorded in [STATELESS_ROUND.md](STATELESS_ROUND.md). The completed follow-up
round removes unused unsegmented preparation data and simplifies Blink's line records; its evidence and stopping point
are in [STATELESS_ROUND2.md](STATELESS_ROUND2.md). The completed [round 3](STATELESS_ROUND3.md) removes repeated
Blink/Gecko lookups with preserved correctness outcomes and complete phase timings: useful repeat gains, no general
preparation gain and mixed new-width costs. Main's resize gap remains open.

The current [prepared plaintext round](PREPARED_LAYOUT_EXPERIMENT.md) specializes count-only layout in the public
engine; the redo core matches `0bdea4d`. Main took a simpler form of that counter (#338), and since 2026-09-23 `src/` is
main `b17a7ac` (TAKEOVER.md). Fair public-API pairs show ordinary repeats about 31–70% faster across all three
browsers. A bounded numeric ASCII experiment supports Canvas-free layout on observed inputs, but leaves Unicode,
contextual shaping, broader main-pass coverage and a large preparation gap open. Preparation ownership and the next
broader representation are the priority. [Exact identity source maps](experiments/plaintext-round/preparation-cost-account.md)
are deferred behind that work. Owned rendering and rich painting remain paused.

Since 2026-09-23 Gecko decides a break scan from its shaping units' advances and passes over the candidates inside a
word whose end fits (the word scan, DESIGN.md §4.6), on a premise about fonts the maintainer accepted; the rest of the
redo core still matches `0bdea4d`. In Firefox it prepares new Latin and Arabic chat messages 1.6 to 1.7 times faster
(1.5 to 1.6 times main keeping its caches, where it was 2.5 to 2.8), fills them at new widths about 3 and 9 times faster
and lays kept Latin and Arabic paragraphs out again 1.7 to 1.8 times faster; CJK stays where it was.

Since 2026-09-23 on branch `blink-words-first` Blink cuts a shaping group into words first, measuring each word once with
its trailing space, and finds the break of a line that ends between two words from the positions at the cuts (words
first, DESIGN.md §4.4), and predicts the window a shrink of the wide window takes instead of measuring every window
before it (the cut predictor), on three premises about fonts documented as defaults with named gaps (§4.6). What it
leaves against the rebuild line in installed faces is named since 2026-09-25: gaps an inspected paragraph raises where
the port's measurements show the condition, and Zapfino's morx state as a font-level limitation in the known tail
(TAKEOVER.md).

## Core

`src/index.ts` dispatches to `src/engines/{blink,gecko,webkit}`. Canvas supplies measurements; DOM reads and font-file
loading are outside the core. Plain preparation supports full lines/pieces or source ranges/counting. Inspection additionally computes diagnostic
geometry and uncertainty. A paragraph should do only the work its requested output needs.

Prefer fewer representations, local derived values and ordinary loops. Preserve shaping context and numeric units at
measurement boundaries. A smaller number of Canvas calls is neither a speed result nor a correctness argument.
Sampled font behavior must not silently become a guarantee about arbitrary fonts. Keep engine-specific behavior explicit.
A premise about fonts that no source gives is taken only as a documented default with a named gap that inspected
paragraphs report, and only where no installed face, at any setting CSS can ask for, breaks it in the pinned browser; where
one does, the premise is bounded, by the zoomed font size, by a property of the font Canvas can check or by the text
an engine source shows it failing on, so that the recipe it replaces runs there (the maintainer, 2026-09-23: "as long as correctness is still redo's goal"): Gecko's
word scan assumes no tail of a shaped word has a negative advance and reports `negative-word-tail`; Blink's words first
assumes no shaping context reaches more than one word past a space and that positions inside a word stay sorted, runs
only below a zoomed font size of 60 px, counting what letter and word spacing add to two words, where the word test can
be asked between two words of every installed face (Zapfino breaks it from 64), and not in a face whose space takes the
script (Euphemia UCAS), nor in a group whose shaping call holds a mark and a letter HarfBuzz recomposes only in such a
call (Athelas's `ở` after a `café` spelled with U+0301), and reports `context-past-a-word` and `positions-run-backwards`
(DESIGN.md §4.6). Blink's cut predictor assumes a string is narrower than a window inside it by less than the
zoomed font size, and runs only without letter spacing or negative word spacing and where the space takes the same
advance under Latin as under Common, since the calligraphic Arabic faces break the premise with no margin at display
sizes; it reports `nested-window-wider` (DESIGN.md §4.6).

Measure fresh preparation plus all filling separately from repeated widths on retained prepared data. Record browser,
DPR, font, input population, context ownership, power conditions and source hashes. Alternate pairs for small gains.
The earlier cohort results are in `TAKEOVER.md`. [GENERAL_COST.md](GENERAL_COST.md) tracks the general-cost
audit, the five-checkpoint stopping point and the current prepared-data frontier. [Performance against main](MAIN_PERFORMANCE.md)
records the remaining application gaps; the input-growth audit did not close that work. Testing infrastructure is
sufficient for this iteration; further work follows concrete core or native-evidence needs. The
[owned-rendering experiment](experiments/owned-rendering/README.md) is rejected as a general replacement: it overflows
ordinary words and drops supported rich-item behavior. Fixed-fragment checks are not a performance win.

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
The plain adapter now uses `fillLineRange` without materializing pieces. The workflow runs fresh inspected/plain preparations in both orders with no supplied font facts, then checks visible
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
cannot answer. The current round changes public count-only layout without changing the API or package surface.
