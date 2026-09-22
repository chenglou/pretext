# Plaintext stateless round

These helpers compare the frozen redo source before the round with a candidate. Owned rendering stays paused. They
check data-flow changes under the existing deterministic `rebuild/tools/stand-in-canvas.ts`; they establish neither
browser accuracy nor browser speed. Real Canvas history, Chrome string storage and host Unicode differences still
need the affected recorded replay and native checks.

`compare.ts` compares complete observable source ranges, continuation states, line-box flags, pieces, inspections and
paragraph gaps, and every Canvas context creation, assigned setting and measured string/answer in order. It compares
arrays themselves, then keeps hashes and the first difference in the report. Raw decided-line records can be included
with `--raw` as diagnostic output: a primary representation can change legitimately. `--strict-raw` includes them and
also fails on those changes. The normal run avoids copying internal records. Range mode has no raw line record.

The fixed documented Environment is supplied directly (Retina DPR 2, explicit page language, known engine/build and
process language). Repeating Canvas-support detection would measure environment setup outside this round's prepare/fill
boundary. Both ordinary and inspected preparations are checked. Each width is prepared fresh, then retained
preparations see
ascending, descending and interleaved widths, twice. Retained output must equal the baseline fresh output. The three
full-output passes also vary pieces/inspection read order. Cases cover whitespace modes, tabs, hard breaks, emergency
word splits, soft hyphens, keep-all, signed spacing, scripts, combining/emoji and bidi. A float case includes refusal
and retry. Six growing input families include ordinary controls, unbroken words, Arabic joining, signed tracking,
alternating scripts and preserved tabs/newlines.

Run from the redo root after freezing runtime edits:

```sh
bunx tsc -p rebuild/experiments/plaintext-round/tsconfig.json
bun rebuild/experiments/plaintext-round/compare.ts --base=/private/tmp/pretext-stateless-baseline-20260921 --read=full --out=.artifacts/plaintext-round/proof-full.json
bun rebuild/experiments/plaintext-round/compare.ts --base=/private/tmp/pretext-stateless-baseline-20260921 --read=count --out=.artifacts/plaintext-round/proof-count.json
bun rebuild/experiments/plaintext-round/compare.ts --base=/private/tmp/pretext-stateless-baseline-20260921 --read=range --out=.artifacts/plaintext-round/proof-range.json
```

`--read=count` fills every line without reading pieces or inspection; inspected preparation remains a separate check.
`--read=range` uses the candidate's `fillLineRange`, comparing its observable result and Canvas questions with the
baseline's ordinary full fill. A candidate without this API is rejected. For candidate full-versus-range equivalence,
set `--base` and `--head` to the same candidate checkout. Paragraph gaps are checked when preparation was inspected;
line inspections cannot be requested from a range result. Neither count mode treats omitted diagnostics as equivalent
to full diagnostic output: the full run checks those independently.

Options: `--head=<repo>`, `--engines=blink,gecko,webkit`, `--cases=<regex>`, `--growth=64,128,256` (the default; empty
disables growth; larger sizes are explicit), `--raw`, `--strict-raw`, `--progress`. Growth uses 37, 320 and 100,000px;
the smaller fixed cases also cover 0 and 1px. Both source roots and the helper/backend files are hashed before and
after; changing source while a run is in progress invalidates its result. Timings are deliberately absent.

For a bounded actual-main browser comparison, the canonical bench already has pure plaintext `cold`, `sweep` and
`many` scenarios. Verify its ten imported main runtime files against actual main HEAD before running. On a foreground
Retina display, after all source is frozen, run one browser at a time under the maintained exclusive browser lock:

```sh
python3 .artifacts/session/with-browser-lock.py plaintext-round-chrome --browser=all --exclusive -- bun rebuild/bench/run.ts --browser=chrome --foreground --scripts=latin,cjk,arabic,mixed --sizes=sentence,paragraph --scenarios=cold,sweep,many --messages=200 --samples=8 --min-samples=6 --warmup=2 --min-sample-ms=10 --budget-ms=4000 --out=.artifacts/plaintext-round/bench-canonical
```

Repeat sequentially with `--browser=firefox`, then `--browser=safari` and distinct lock names. `--allow-battery` is
available when battery operation is intended; record the condition. Samples are calibrated and variant order is
interleaved. `cold` includes preparation plus count and a separate main materialized-line comparison. `many` clears
main's cache once per batch, permitting answers to be shared between messages. `sweep` supplies twenty widths but its
retained fill variant meets them during calibration, so its timing describes repeated widths. The sweep also times
redo preparation alone. It does not isolate main preparation alone or unfamiliar-width fills. Those questions require
the round's separate foreground paired probe; don't describe the canonical sweep as a first-width measurement.

Compare original redo, candidate full fill, candidate range fill and actual main at the same work boundary. Preserve
source hashes, counts, Canvas call counts, visibility/focus endpoints, power/display conditions, samples and commands.
Equal aggregate counts alone do not prove equal cuts or geometry; the full proof and native checks remain separate.

## Foreground paired probe

`perf.ts` imports actual main directly, plus an immutable pre-round redo and the current redo full/range paths.
Every ordinary cohort (Latin, CJK, Arabic, mixed; 120 messages each) runs preparation, preparation plus count at
320px, new 260/380/440px widths and repeated widths in separate documents. Eight saved samples follow two discarded
warmups, with rotating library order and calibrated repetitions of at least 20ms. Growth controls (Hebrew
64/128/256/512 units and alternating scripts 64/128) recapture preparation plus count and repeated widths. The first
all-phase capture is retained separately; it does not become a phase-separated growth capture.

```sh
python3 .artifacts/session/with-browser-lock.py plaintext-round-chrome --browser=chrome --exclusive -- bun rebuild/probes/runner.ts --browser=chrome --foreground --isolated --require-clean --probes=rebuild/experiments/plaintext-round/perf.ts --out=.artifacts/plaintext-round-20260921/perf-final/chrome --probe-timeout-ms=180000 --stall-ms=240000
```

Repeat sequentially for Firefox and installed Safari, with distinct output directories. The page refuses non-isolated,
unfocused or hidden timing and records timer resolution, every sample/repetition and focus/DPR endpoints. Main clears
its JS cache outside each preparation batch and shares segment answers among messages; its browser shaping context
survives. Redo uses its normal per-paragraph contexts. New-width handles are prepared and initially filled outside the
clock for every repetition, in bounded chunks. These are new paragraph-level widths, not cold browser shaping.
Repeated fills keep already-warmed handles. New documents still share browser and native-resource history; stalls
remain in the recorded results. Compare the two current preparation controls before attributing a difference.

Canvas calls/characters and complete redo source/continuation/line-box checks run after timing. They compare redo
against its frozen baseline; main aggregate counts are recorded independently and do not certify equal cuts or
geometry. The independent proof and certified native workflow remain necessary accuracy evidence.

Overrides: `PLAINTEXT_BASE`, `PLAINTEXT_CURRENT`, `PLAINTEXT_MAIN`, `PLAINTEXT_SAMPLES`, `PLAINTEXT_MESSAGES`,
`PLAINTEXT_SAMPLE_MS` (at least 20), `PLAINTEXT_PHASES` (comma-separated phase names). A frozen
`PLAINTEXT_WITHOUT_CURSOR` adds full/range negative controls; its 18-sample, 50ms repeated-only run ruled out cursor
flattening as the five-column prototype's regression. One earlier control failed timer calibration and remains an
error, not a timing result. The refined driver permits more repetitions for retained widths while keeping fresh-width
setup bounded. Available sources and raw reports for those superseded attempts are archived with the final round. The reproducibility
index distinguishes extant copies from exact recorded hashes: some earlier helper versions are unavailable. The final
frozen source/helpers and accepted campaign are preserved completely; old attempts do not gain that completeness by
being archived.
