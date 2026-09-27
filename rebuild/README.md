# Pretext rebuild

The redo is a per-engine, correctness-first reference for plain text. It ports how Blink, Gecko and WebKit break and
measure lines, one port per engine, each citing its browser's source, and predicts each browser's own lines (line
count, breaks and widths) from a font declaration, with Canvas `measureText` as its only measurement: no DOM reads and
no font files. An inspected paragraph also reports where the prediction can't be sure, as named gaps. It isn't
shipped: main's `src/` is the library, and the redo is the reference main can take findings from. The lab pins Chrome
154.0.8037.57, Firefox 156.0.1 and webkit-host (WebKit 22625.1.29.11.27). The branch is `rebuild-20260916`.

## End state (2026-09-26)

The redo is done but for upkeep. The maintainer scoped it to plain text and asked to close it once it is as correct
as it can be, with the lines drawn stated (TAKEOVER.md, 2026-09-26). Upkeep is:
- pinning newer browsers: record the tier sets again (a stratified sample where a whole configuration costs too much,
  as the 2026-09-25 re-pin did for Chrome with facts) and check that no status moves;
- syncing main (outside `rebuild/` the branch is main but for the few lines TAKEOVER.md lists);
- adopting new browser APIs that can replace a Canvas measurement or a premise taken for speed.

Scope: plain text. Main's manual layout API and rich inline are to be derived from it later; the plain path already
fills line ranges and counts lines. Rich inline, with its nuances such as kerning between sibling spans, is "a big quest
for another time" (the maintainer): main's chips (`break: 'never'`) and padding cloned on every line (`extraWidth`)
have no form in the redo's model, whose atomic inlines are boxes of a declared size and whose box edges slice. The
headline numbers are without supplied font facts; the lab's facts stay an optional exploration.

The stopping rule (the maintainer, 2026-09-25, read for plain text since 2026-09-26) has three parts. Where each stands:

1. **Every remaining difference from the browsers on every set is a named gap, a made-up or variation-extreme font, or a
   width under 24 px, and none is unexplained.** Met for the predictions without facts but for twelve cases off the
   tier sets. On the tier sets (69,224 Chrome, 63,771 Firefox and 63,987 webkit-host cases, the frozen references)
   without facts, every case that fails line count, breaks or widths in any engine is covered by a named gap or is page
   history. Off the tier sets, ten exact fits at DPR 1 in Chrome fail with no covering gap (the known tail's
   `blink/exact-fits-without-a-gap`). Their mechanisms are named at the breaks the fit decided between (`one-unit-fit`,
   `rtl-end-reach`), but the scorer also counts rects inside joined Arabic words that no line gap touches, so what
   converts them is a scorer or lab change, not a library change. Two of main's harness cases laid out again in the lab
   fail with no covering gap too, Hangul jamo U+118F after a syllable at 29.85 and 31 px (`catalog/classes/JV`):
   `glyph-clusters` and `unsafe-to-break` fire on the line but not at the syllable whose line is in dispute (the known
   tail's `blink/rare-characters-beside-hangul-and-hebrew`). With the lab's facts one Chrome tier case is open (Al
   Nile 40px, unbroken Arabic under `break-all`, `wide-group-cuts`) and 19 Firefox cases are in the residual class
   `gecko/one-shaping-unit-one-app-unit`. The lab's painter, which draws the predicted lines in the DOM and is scored
   apart from the predictions, keeps 4, 0 and 24 rows open without facts, a class the known tail names
   (`painter/without-explanation`). Main's harness case files are judged by main's scorer, which reads no gaps, so there
   only the cases main gets right were traced (part 2).
2. **It is a superset of main in all three engines.** Met but for named classes, none of them real text. Against main
   `48980bb` ([lab/BASELINE-main.md](lab/BASELINE-main.md)), each case main gets right and the redo doesn't was read
   line by line and put in one class: page history, narrower than 24 px, main right by luck (its width of the
   disputed line more than 0.05 px off the browser's), or a true redo loss.

   | | Chrome | Firefox | webkit-host |
   |---|---:|---:|---:|
   | tier sets: main right, the redo not | 16 | 36 | 8 |
   | of those, true redo losses | 7 | 1 | 1 |
   | main's harness case files: main right, the redo not | 25 | 26 | 8 |
   | of those, true redo losses | 6 | 11 | 1 |

   Each true loss is under a named gap or a known-tail class. On the tier sets: Chrome's six kerned words in Times New
   Roman and Hoefler Text (`unsafe-to-break`, which the lab's facts get right) and Amiri's `((tai`, Firefox's
   `ws/text-nodes` and webkit-host's `suite/ligature-thresholds-v3`. On main's harness files: in Chrome rare characters
   between Hangul or Hebrew letters (`blink/rare-characters-beside-hangul-and-hebrew`); in Firefox `b` after U+3000
   U+200D and U+261D after Hangul (`gecko/font-kept-from-the-character-before`) and a Sinhala mark after a space
   (`gecko/spacing-mark-after-a-space-at-a-break`); in webkit-host an Arabic `rule/joining` case
   (`rtl-shaping-across-inline-boxes`). The census and the books are right in the redo in every browser. The other
   way round, the redo is right where main isn't on 42,339, 32,184 and 35,651 tier cases (most of them cases main can't
   express) and 4,066, 2,920 and 3,245 harness cases. Main's 391 rich-inline cases with a chip or cloned padding
   weren't run; main is right on 232, 231 and 233 of the pinned ones.
3. **The speed recipes end with Blink's words first and the cut predictor.** Met: both landed on 2026-09-25. The redo
   is still slower than main in Chrome and Firefox (the rounds below and TAKEOVER.md).

## Lines drawn

How the redo decides what counts as done, as the maintainer set it over these sessions:
- **No right line is traded away silently.** The no-loss rule exists so that a change can't quietly lose a line that
  main or the base got right: every lost line is traced and classed before the change is accepted. The stopping rule
  then allows a remaining difference only where a named gap covers it, the font is made up or at a variation extreme,
  or the width is under 24 px. Some losses can't be seen from Canvas at all: Zapfino's morx state changes no advance, so
  no Canvas answer shows the offset HarfBuzz marks unsafe to break (`blink/zapfino-morx-unsafe-state`); that stays a
  named font-level limitation, with no code keyed on the font. And main gets some lines right only by luck, its own
  width of the disputed line more than 0.05 px off the browser's (part 2); those aren't losses to chase.
- **Correctness first, but not completionism.** What would need the DOM or a whole new feature is a named exception,
  not a goal. Main corrects Canvas's Apple Color Emoji width from a hidden DOM span; the redo reads no DOM, takes the
  page's advance from Canvas at the device size, and names what that can't show
  (`shared/apple-color-emoji-canvas-width`). Rich inline is a new feature, out of scope.
- **The relaxed stance (2026-09-23).** A premise about fonts that nobody has falsified may be taken for speed, as a
  documented default with a named gap that inspected paragraphs report, bounded where an installed face breaks it
  (Core, below). Where requirements have to give, ad hoc ones go first, then petty ones that no real text exercises.
  CJK stays well supported.
- **A gap has to stay quiet where the browser agrees.** This one is the redo's own line, not the maintainer's. The
  reports the last round added (2026-09-26) fire on 215 of 134,093 real-text lines (0.16%: the census, main's sample
  and the books). Their first form fired on 11% of the census's lines, all Chinese and Japanese, where Chrome agreed
  with the port, so `one-unit-fit` doesn't report at the breaks for a start between two CJK ideographs or symbols. That
  cut rests on those counts and on no traced failure starting so, not on a source reading that Blink's correction can't
  act there.
- **A soft line on performance.** Plain, predictable code (monomorphic calls, stable object shapes, locals, integer
  bounds, no per-call allocation, one clear path; `~/github/vibescript/docs/engineering.md`) over tuning to one JIT's
  heuristics, which can flip with the next browser release or machine. A small regression that traces only to a JIT
  quirk is accepted and documented rather than contorting the code. Cater to the worst case: prefer even, predictable
  cost to branches and caches that help only the average case, even at a slight cost to the average.
- **Timing and the machine.** Timing runs two sessions per browser with a control copy of the base by default, more only
  when two sessions disagree about a verdict that matters, in the foreground. Every job is bounded: loops stop at the
  source length plus one line or a time limit, every child has a timeout and dies with its parent, memory is checked
  before heavy jobs, concurrent jobs share no scratch checkout, and browser jobs go through
  `.artifacts/session/with-browser-lock.py`. Never `pkill` or `killall`; kill only pids you started, by exact pid.

## Start here

[TAKEOVER.md](TAKEOVER.md) records the current decisions, evidence and open failures. [DESIGN.md](DESIGN.md)
is the implementation reference; [TESTS.md](TESTS.md) documents broader checks. `HANDOFF.md`, `CHARTER.md` and dated
research reports preserve the prior endpoint, not another task queue. Its branch is backed up at
`codex/redo-handoff-backup-20260920` (`9369b7f`), with all committed studies in a verified Git bundle.

## Rounds

From 2026-09-21 the rounds aimed at a cheap stateless core with simple data flow and predictable cost, and tests that
reflect native browser behavior, optimizing until the remaining gains were small relative to the code, assumptions and
state they add. The first completed bounded plaintext round is recorded in [STATELESS_ROUND.md](STATELESS_ROUND.md).
The completed follow-up round removes unused unsegmented preparation data and simplifies Blink's line records; its evidence and stopping point
are in [STATELESS_ROUND2.md](STATELESS_ROUND2.md). The completed [round 3](STATELESS_ROUND3.md) removes repeated
Blink/Gecko lookups with preserved correctness outcomes and complete phase timings: useful repeat gains, no general
preparation gain and mixed new-width costs. Main's resize gap remains open.

The [prepared plaintext round](PREPARED_LAYOUT_EXPERIMENT.md) specializes count-only layout in the public
engine; the redo core matches `0bdea4d`. Main took a simpler form of that counter (#338), and since 2026-09-25 `src/` is
main `48980bb`, which also takes each engine's own break and grapheme tables (#340, #344; TAKEOVER.md). Fair public-API pairs show ordinary repeats about 31–70% faster across all three
browsers. A bounded numeric ASCII experiment supports Canvas-free layout on observed inputs, but leaves Unicode,
contextual shaping, broader main-pass coverage and a large preparation gap open. It left preparation ownership and the
next broader representation as the next questions, with [exact identity source maps](experiments/plaintext-round/preparation-cost-account.md)
deferred behind them; the redo closed without them. Owned rendering and rich painting remain paused.

Since 2026-09-23 Gecko decides a break scan from its shaping units' advances and passes over the candidates inside a
word whose end fits (the word scan, DESIGN.md §4.6), on a premise about fonts the maintainer accepted; the rest of the
redo core still matches `0bdea4d`. In Firefox it prepares new Latin and Arabic chat messages 1.6 to 1.7 times faster
(1.5 to 1.6 times main keeping its caches, where it was 2.5 to 2.8), fills them at new widths about 3 and 9 times faster
and lays kept Latin and Arabic paragraphs out again 1.7 to 1.8 times faster; CJK stays where it was.

Since 2026-09-25 (merged from `blink-words-first`) Blink cuts a shaping group into words first, measuring each word once with
its trailing space, and finds the break of a line that ends between two words from the positions at the cuts (words
first, DESIGN.md §4.4), and predicts the window a shrink of the wide window takes instead of measuring every window
before it (the cut predictor), on three premises about fonts documented as defaults with named gaps (§4.6). What it
leaves against the rebuild line in installed faces is named since 2026-09-25: gaps an inspected paragraph raises where
the port's measurements show the condition, and Zapfino's morx state as a font-level limitation in the known tail
(TAKEOVER.md). In Chrome it prepares new Latin and Arabic text in 0.58 to 0.76 of the rebuild line's time, fills it at
new widths in 0.46 to 0.71, and takes up to 1.1 times its time to lay kept paragraphs out again; CJK stays where it
was.

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
cannot answer. The prepared plaintext round changed public count-only layout without changing the API or package surface.
