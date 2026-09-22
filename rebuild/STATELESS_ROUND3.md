# Plaintext stateless round 3 — 2026-09-22

This bounded round starts at `1981939` on `rebuild-20260916`, backed up at `codex/plaintext-round3-backup-20260922`.
Actual main stays at `2e5e2bd`. The order remains unused work and primary ownership first, then measured structural
optimizations, with preparation and unfamiliar-width measurement studied separately. It follows
`~/github/vibescript/docs/engineering.md`. Owned rendering and rich painting remain paused.

The two changes pass their source-preserving correctness checks and the complete foreground phase comparison. Earlier
focus interruptions contribute no accepted samples. Main remains substantially cheaper at resize, and preparation has
no general gain. This is a bounded completed round, not completion of general stateless work.

## Changes

Blink retains the numeric candidate search from a failed normal-break pass for its immediate character-break retry.
The next shape call consumes and clears it at entry. Reuse requires identical ShapeResult, start, corrected position
and candidate limit, plain group data, no line-start reshape (`firstSafe === start`) and no forced clamp. A
changed/intervening call searches normally. The per-fill breaker owns it; nothing survives to another line or width.
Han line-end tests, unsafe reshapes, hyphen fitting, trim and rollback keep their existing work. Inspection keeps its
measurement and observation sequence.

Gecko keeps an adjacent pending interval's resolved end as the next interval's start within one traversal. Provider
and scan bounds are fixed there. The first interval resolves end before start, and later intervals still report every
logical inspected consultation, including duplicates in the original order. End-minus-start, spacing and tab
arithmetic remain unchanged. Arbitrary trim and fitted ligature-share queries keep their original paths. New
frame/bounds/redo creates fresh locals. Neither change adds a shaping estimate, width answer cache or
monotonic-position assumption.

## Controlled work and checks

At ASCII 512 with the performance paragraph policy and widths 24/36/48, Blink prepared-prefix reads fall from 21,610
to 12,712 (41%). Gecko source-map/unit reads fall from 36,180 to 23,916 (34%), retained-window reads from 216,864 to
143,280 and offsets from 48,604 to 31,324. Both plain controls submit zero Canvas questions after warming. These are
owned reads, not heap allocation or native shaping counts. Deterministic Gecko yields 1,948 lines, while the native
control yields 2,120; those populations are not pooled. N64/128/256 and inspected full/range controls retain complete
cuts, continuation and ordered measurements.

The final full/count/range proofs each cover 86 cases, 5,454 workflows, 27,342 layouts and 190,806 fill records, with
zero output, ordered question or independence differences and stable source/helper seals. Ordered questions total
5,983,447 full and 3,552,048 each count/range. All original 80 cases and complete observation records remain exact;
six endpoint controls extend them. A direct inspection proof preserves 1,317 consultations, including 660 duplicate
offsets. Standalone maintained tests require no frozen checkout. The prior implementation passes their semantic
controls but fails the intended read budgets: Blink 40 > 30 (current 22), Gecko 2,247 > 1,600 (current 1,485).

All 25 quick/fresh gate exits stay unchanged. Six required and two supplemental explicit `--noEmit` projects pass;
1,223 tests in 112 files pass with zero failures (prior 1,215/110). All 18 complete replay reports match accepted
round 2 excluding only top-level library fingerprint; six browser-request lists are byte-identical. Plain and pure
each retain 393,720 passes, zero problems and 244 Chrome skips. Existing Chrome tier 1 exit 1 and Firefox exit 4
remain, with 99,396 tier 2 requests; aggregate gate is still 1. This is no new accuracy waiver or newly green
foundation.

An independent review additionally compares 180 seeded mixed paragraphs, both modes and engines, nine reordered widths
(720 observations): complete outputs and ordered Canvas events agree. Gecko strict-raw serialization still fails on
cyclic SpanData parents; normal observable proofs and direct consulted sequences cover this round. That
internal-record harness debt remains open before a broader representation rewrite.

## Fresh native validation

The certified fast workflow selects 1,000 cases per engine, inspected/plain in both orders: 12,000 observed case
views. All cuts, scoring outcome categories and combined obligation statuses/counts match accepted round 2. Counts
remain Chrome 999 pass/1 fail, Firefox 951 pass/1 fail/48 review and WebKit host 998 pass/2 fail. Twelve recorder
children exit 0, three strict workflows/checkers exit 1 and none is adoptable. Sources and catalogs verify
before/after; acceptance rules and known tails are unchanged. The workflow records per-case Canvas counts, not ordered
strings/settings/answers; its measurements field is null. Ordered recorded replays and the controlled proofs provide
different evidence.

Complete native objects do not all match. Four existing Firefox ProbeShantell/emoji review cases in plain-forward
change rect widths and reduce Canvas counts by 3 each, while cuts and outcome/status classifications stay exact. Their
scored issue lists also lose the plain-forward native-variation issue while remaining reviews. Those exceptions and
full scored records remain in the audit. Some renderer/process metadata also varies and is retained. A separate fresh
baseline/current native-first diagnostic gives exact complete ordered records: four cases, 30 contexts and 137 calls,
including settings/width/ink answers and phase ranges. Complete predictions/native objects also agree. A further
measure-first pair restores the original 27-case document history: all 27 predictions and native objects agree,
including fractional emoji widths and the original 10/13/55/55 counts. These limited paired results support retention;
they do not recover the original 1,000-case ordered streams or prove a font/native cause for the earlier variation.

This checks source cuts/counts, mode parity, width and stability, not arbitrary glyph placement or vertical painting.
Full historical native/book recapture and fresh native certification of all 500,797 historical main passes remain
outside this behavior-preserving round. Main source is unchanged; the fast selected population retains its certified
provenance.

## Completed foreground phase comparison

The accepted captures contain exactly 36 unique documents per browser: 108 documents and 5,400 saved rows. Ten samples
balance five labels/order slots after two discarded warmups, with a 20ms/50-timer-step floor. Every saved before/after
endpoint, all 108 final states and all 108 initial script snapshots are visible/focused/isolated at DPR 2.
Boot/bookend environment records are retained separately, including 11 unfocused Chrome records; they do not
substitute for clock guards or prove continuous focus between recorded endpoints. No samples or pause tails are
removed.

Frozen `1981939`, the integrated two-change engine and actual main `2e5e2bd` are imported directly. Each browser's
717-file before/after source seal is exact. The 716 other inputs are identical across browsers; only startup runner
versions differ. Chrome ran temporary owned-PID activation plus the delivery gate; Safari retained its session startup
with the gate; Firefox ran native startup with the gate. These operations occurred before clocks. The page
source/build inputs, captured measurement programs, library inputs, fonts, guards and timer protocol are unchanged.
The final branch restores the original runner; its separate untimed focus diagnostic passes eight samples in all three
browsers. Do not relabel the timing captures as original-runner executions.

Complete redo cuts/continuations and post-timing counts/Canvas statistics match across all four redo labels. Ordered
native Canvas streams and complete main cuts are not recorded by this matrix; the deterministic ordered proofs and
fresh native accuracy workflows supply separate evidence. Repeated Canvas work is not universally zero: its actual
volume remains in every report, including 4,216 WebKit questions on ASCII 512. Main output/ownership contracts differ,
and line counts differ in some ordinary cohorts. These ratios are cost references, not geometry or universal
guarantees.

Current-range / frozen-range medians of matched round ratios (lower is faster):

| Browser / cohort | Preparation | Preparation + count | New widths | Repeated widths |
| --- | ---: | ---: | ---: | ---: |
| Chrome / latin | 1.085× | 0.938× | 1.003× | 1.003× |
| Chrome / cjk | 0.988× | 1.002× | 1.018× | 0.998× |
| Chrome / arabic | 0.969× | 1.022× | 0.968× | 1.000× |
| Chrome / mixed | 1.022× | 1.028× | 0.968× | 1.007× |
| Firefox / latin | 1.003× | 0.944× | 1.035× | 0.861× |
| Firefox / cjk | 0.993× | 0.984× | 0.755× | 0.686× |
| Firefox / arabic | 1.003× | 0.985× | 0.974× | 0.896× |
| Firefox / mixed | 0.991× | 1.037× | 0.914× | 0.791× |
| Safari / latin | 0.994× | 0.995× | 0.935× | 1.000× |
| Safari / cjk | 0.993× | 0.966× | 1.005× | 1.138× |
| Safari / arabic | 1.049× | 1.000× | 0.985× | 1.002× |
| Safari / mixed | 0.984× | 1.053× | 0.995× | 1.006× |

Chrome ordinary repeats stay approximately unchanged. Its narrow ASCII repeat ratios at N64/128/256/512 are
0.855/0.844/0.823/0.816. At N512, range costs 1.341ms versus 1.645ms frozen (about 18% less). Firefox ordinary full
repeats save about 15% Latin, 31% CJK, 12% Arabic and 20% mixed; range ratios are 0.861/0.686/0.896/0.791. Its narrow
N512 range ratio is 0.814 (1.229ms versus 1.521ms). Growing Hebrew and alternating controls also improve. These are
retained constant-factor lookup reductions, not a new asymptotic or Canvas-work claim.

Preparation has no general gain and no intentional runtime change. Identical-preparation full/range aliases show
nontrivial variation. Chrome Latin range preparation costs 8.5% more in this capture, alongside 2.3% more full; all
samples remain. Chrome has 62 normalized samples above three times their own label/document median; the maximum is
1,020.795ms for current-range mixed preparation-plus-count. No cause is inferred. New widths are mixed: Firefox CJK
full/range ratios are 0.718/0.755, while Latin full 0.842 and range 1.035 disagree. Unchanged WebKit is a negative
control; its CJK repeat full/range ratios 1.109/1.138 are retained rather than presented as an engine improvement or
explained away. No formal significance or GC/JIT/native cause is claimed.

Current-range separate median / actual-main median:

| Browser / cohort | Preparation | Preparation + count | New widths | Repeated widths |
| --- | ---: | ---: | ---: | ---: |
| Chrome / latin | 11.64× | 10.16× | 121.48× | 15.00× |
| Chrome / cjk | 2.32× | 2.73× | 87.42× | 13.23× |
| Chrome / arabic | 10.59× | 11.74× | 218.40× | 19.49× |
| Chrome / mixed | 6.54× | 8.32× | 143.87× | 15.39× |
| Firefox / latin | 1.06× | 2.35× | 51.46× | 13.95× |
| Firefox / cjk | 0.39× | 2.73× | 17.79× | 12.66× |
| Firefox / arabic | 1.58× | 2.74× | 100.59× | 13.58× |
| Firefox / mixed | 1.13× | 3.09× | 42.36× | 10.32× |
| Safari / latin | 0.38× | 0.40× | 3.41× | 3.70× |
| Safari / cjk | 0.22× | 0.22× | 3.82× | 4.12× |
| Safari / arabic | 0.47× | 0.57× | 18.45× | 18.06× |
| Safari / mixed | 0.42× | 0.53× | 13.13× | 13.33× |

WebKit preparation defers more measurement into filling, so prepare-only ratios do not compare identical work
boundaries. Preparation-plus-count is measured directly. Main clears JS caches once per preparation batch outside
clocks, shares segment answers across messages and retains Canvas; redo keeps normal paragraph-local ownership.
New-width handles are prepared and filled at 320px outside clocks before 260/380/440px. Repeats keep warmed handles.
The narrow ASCII control has four repeated texts at 24/36/48px and equal 2,120 lines. It still costs 66.53× main in
Chrome, 39.91× in Firefox and 73.90× in WebKit; Chrome/Firefox submit zero warm Canvas questions there. Those gaps
remain open.

Foreground Retina DPR 2, AC power, Apple M5 Max; pinned Chrome 153.0.8010.50, Firefox 156.0 and Safari 27.0.
Browser/OS history and native resources remain shared. Per-browser complete independent reconstructions are
`final-audit/performance-{chrome,firefox,safari}.json`. The earlier pilots below remain separately named screening
evidence and are not pooled with this complete matrix.

## Earlier foreground screening

The accepted pilots contain 15 documents and 750 saved timing rows: one Chrome narrow-ASCII repeat control and 14
Firefox repeat controls. Each keeps all ten samples, balanced across five labels, a 20ms/50-timer-step floor, loaded
named fonts and visible/focused/isolated DPR 2 endpoints. The generated scripts and exact isolated source archives are
retained. Complete cuts/continuations, counts and post-timing Canvas statistics agree across the four redo labels;
repeated filling submits zero Canvas questions for every label. The pilot did not record complete main cuts or ordered
native Canvas streams. It has no contemporaneous global 717-file post-capture seal, so it remains screening evidence
rather than final campaign acceptance.

Ratios below are medians of matched round ratios; absolute times are separate medians. Lower ratios are faster.
Ordinary rows are 120-message batches at 260/380/440px; ASCII 512 is four repeated texts at 24/36/48px. Different line
populations and output/ownership contracts limit main comparisons. Main and redo have the same 2,120 lines on the
ASCII control.

| Browser / repeat cohort | Full / prior full | Range / prior range | Current range | Main | Range / main |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chrome / unbroken ASCII 512 | 0.815× | 0.811× | 1.373ms | 0.02045ms | 67.13× |
| Firefox / latin | 0.868× | 0.864× | 1.900ms | 0.13973ms | 13.60× |
| Firefox / cjk | 0.690× | 0.679× | 4.446ms | 0.30844ms | 14.42× |
| Firefox / arabic | 0.886× | 0.887× | 1.716ms | 0.12453ms | 13.78× |
| Firefox / mixed | 0.789× | 0.784× | 2.198ms | 0.20750ms | 10.59× |
| Firefox / unbroken ASCII 512 | 0.812× | 0.806× | 1.232ms | 0.03188ms | 38.67× |

The Firefox full gains also span Hebrew N64/128/256/512 (about 35–37%) and alternating-script N64/128 (about 16–17%).
All samples and pauses remain. There is no formal significance claim. The screening pilots themselves do not time
preparation or unfamiliar widths; the completed matrix above does. The dated round 2 phase costs in
[MAIN_PERFORMANCE.md](MAIN_PERFORMANCE.md) remain historical evidence, not measurements of this final runtime.

## Deferred alternatives

A count-only prototype removes final line/range wrappers while using the same breakers. Its controlled counts and
ordered questions match across all three engines, but native ASCII 512 savings are about 1% in Chrome and 5% in
Firefox. It would add an API without explaining the resize gap. It is preserved separately and not integrated. A
whole-paragraph scratch redesign remains open; this small experiment does not disprove it.

Gecko's active-walk prototype makes flat fills' root walk state local and allocates parent storage only for actual
spans. The controlled and independent deep/nested comparisons agree, but its added completion branch and mirrored
six-field save/restore produce mixed small timing deltas: full +2.65%, range −1.2% in the pilot. It is deferred, not
shipped. Those are source allocation sites removed, not a measured physical heap reduction.

The controlled Chrome preparation experiment isolates nullable metadata, current preparation and prior A6. It imports
no fill path; null-only/current normalized bundles are byte-identical. Its 144 saved rows balance six order slots with
fixed repetitions and include two labels calling each identical function. Null-only/A6 paired ratios change with page
order; same-function A6 label ratios change from 1.094 to 0.954. This does not establish a repeatable metadata
regression or a GC/JIT/native cause. The 120 paragraphs contain 46 unsegmented and 74 segmented inputs. Earlier
measured Latin cold costs remain in round 2; no preparation gain is claimed here. Captured generator/input provenance
stays distinct from the later helper-only manifest addition.

## Stopping boundary

This round removes two demonstrated repeated numeric lookup paths after the earlier unused-data and primary-view
simplifications. It retains one breaker per engine and preserves the existing measurement rules and diagnostics. The
next ownership targets are per-line scratch consumed by rollback/trim and prepare-time Builder/source copies. The
[preparation ownership account](experiments/plaintext-round/preparation-cost-account.md) identifies exact identity
source maps as the next bounded representation experiment, with transformed/generated fallback and both direction
lookups kept under one model. This is unexamined. Audit those consumers before replacing them; packing/SoA needs its
own access and cost evidence. Unfamiliar-width Canvas/string work and inspected suffix scans remain separate
frontiers. Failed prototypes establish only their bounded results. The remaining costs are not proved necessary, and
this round does not finish general stateless performance.

Main's published source/package, API and canonical snapshots are unchanged. No dev-facing changelog entry is needed.

## Setup and preservation

Earlier broad attempts fail existing focus guards and contribute no accepted full matrices. The user subsequently
confirmed computer use during those failures. Temporary PID/window activation and a delivery gate, launch delays and
the Firefox raised/native focus pair are preserved as diagnostics; they do not establish a startup fault or a causal
AXRaise/host explanation. The final branch restores the original runner after focus-only diagnostics pass all three
browsers. No timing guard, acceptance rule or core measurement rule is relaxed. Some partially completed captures
contain saved rows, but they remain rejected as full matrices and are not pooled into the completed comparison.

The original 24-second focus diagnostic exceeds its 20-second default timeout; it is not a successful check. The first
standalone TypeScript command needs the installed compiler's `--ignoreConfig`; the corrected strict no-emit runner
check passes. The case selector originally splits embedded U+2028 via Python splitlines; literal newline fixes
selection before any browser runs. Original tool transcript summaries are labelled where original PTY logs were not
saved.

Complete dated evidence is under `.artifacts/plaintext-round3-20260922/`; start with [the reproducibility
guide](../.artifacts/plaintext-round3-20260922/reproducibility/README.md). It links the final offline and native
audits, complete gates, isolated accepted/deferred studies, screening audit and rejected focus attempts. The
persistent preservation directory is
`/Users/chenglou/.codex/visualizations/2026/09/20/01a0c12e-d771-7763-acab-9b673ed39827/plaintext-stateless-round3-20260922/`.
Its manifest and bundle metadata record independent archive-member readback and all-ref restore verification after the
docs-synced commit. Browser binaries, OS fonts/runtimes, installed dependencies and historical full replay data remain
declared external inputs; the prior verified round 2 backup is linked rather than duplicated.
