# Performance against main

## Prepared plaintext round, 2026-09-22

The only runtime change is a smaller public simple counter; the redo core matches `0bdea4d`. The fair comparison
uses public `prepare()` and `layout()` on otherwise identical source, including the same object result and height
multiplication. Sixty foreground documents retain all 2,700 rows. Ordinary repeated-layout paired ratios are:

| Browser | Latin | CJK | Arabic | Mixed |
| --- | ---: | ---: | ---: | ---: |
| Chrome | 0.440 | 0.341 | 0.411 | 0.616 |
| Firefox | 0.455 | 0.471 | 0.490 | 0.692 |
| Safari | 0.322 | 0.303 | 0.307 | 0.557 |

These are about 31–70% faster, with similar unfamiliar-width gains. Preparation, measurements, retained data and
counts are unchanged. Timed endpoints and script states are visible, focused and DPR 2; three unfocused Chrome
boot/bookend records remain. The separate bare-counter matrix includes a wrapper difference and is not the public
speed claim.

The bounded Chrome single-word experiment retains one numeric position column and no text/context/tree in its
returned value. Its final growth capture has 574 layouts; each of five numeric controls supports 202 layouts with
native visible cuts/counts and zero layout Canvas calls. This empirical ASCII subset does not cover the general
main-pass population. Signed spacing, contextual shaping and Unicode hard negatives remain explicit.

At N512, the bracket search is about 59% faster than global binary search at narrow widths and 17% slower at wide
widths. It adds no retained search structure. Direct preparation costs about 9.5–13.5× main across the captured
identical preparation aliases; paragraph-local versus shared ownership is part of that comparison. These costs are
open, not proved necessary. The [round report](PREPARED_LAYOUT_EXPERIMENT.md) retains complete populations, all slow
samples, source/protocol distinctions and completed validation. Earlier dated matrices below are unchanged.

## Plaintext stateless round 3, 2026-09-22

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

## Plaintext stateless follow-up, 2026-09-22

The complete foreground campaign has exactly 36 unique documents per browser: 108 documents and 5,400 saved timed
rows. Ten samples balance five order slots after two discarded warmups, with a 20ms floor. Each phase owns a document.
Prior `a6ae4c6`, current checkpoint `ed4f3eb` and actual main `2e5e2bd` are imported directly. All 711 sealed
source/helper/input hashes stay unchanged after each browser.

All saved timing endpoints and final states are visible, focused, isolated and DPR 2. Chrome's first Latin preparation
snapshot is unfocused before timing; two untimed aggregate harness environment records are also unfocused. Startup was not continuously focused.
The unchanged production guards check before calibration and after sampling, including discarded warmups. Acceptance
separates clock endpoints from untimed startup, retaining startup visibility/isolation/DPR checks. It does not prove
uninterrupted focus between endpoints. Firefox and Safari have no recorded startup focus deviation.

Ordinary Chrome repeats improve in every cohort: full/full ratios 0.895/0.887/0.850/0.876 and range/range
0.886/0.891/0.852/0.879 (Latin/CJK/Arabic/mixed). Paired median savings are 0.162/0.359/0.303/0.251ms full and
0.178/0.346/0.296/0.245ms range per 120-message three-width batch. Narrow ASCII range repeats at N64/128/256/512
have ratios 0.795/0.775/0.653/0.503. N512 range takes 1.669ms versus prior 3.319ms per four-message narrow-width
batch: about twice as fast. Firefox/WebKit runtime paths are unchanged controls, not gains from this Blink change.

Preparation has no general gain. The separate frozen three-document Chrome follow-up keeps all 150 samples:
Latin preparation costs 4.9% more full and 8.1% more range than A6 (paired deltas +2.433/+3.950ms in that capture).
Identical-preparation full/range controls also differ, and large pauses recur across prior/current variants.
Absolute costs vary substantially across captures. These runs do not isolate code cost from pause/order effects;
retain the measured Latin cost rather than calling preparation neutral.

New widths remain mixed. Broad CJK range ratio 1.114 (+2.384ms paired) becomes 1.011 (+0.208ms) in the follow-up.
Latin new-width full cost recurs: 1.059 broadly and 1.047 in follow-up; range improves 0.943 and 0.905 respectively.
No general fresh-width win is claimed. All samples and pause tails remain; the two campaigns are not pooled or trimmed.
This bounded exploratory matrix provides no formal significance claim.

Main remains substantially cheaper at resize. Ordinary Chrome range costs 13.31–19.53× main for repeats and
101.42–224.11× for new widths. The N512 narrow repeat still costs 80.43× main in Chrome and 48.72× in Firefox,
despite equal 2,120 lines and zero Canvas calls in both variants. WebKit costs 74.87× main there and still asks 4,216
unchanged Canvas questions. Main counts differ slightly elsewhere; ratios are cost references rather than identical
geometry/contract certificates or universal bounds.

Methods: 120 ordinary plaintext messages; initial count at 320px; new/repeated batches at 260/380/440px.
New-width handles are prepared and initially filled outside the timer; repeats keep warmed handles. Main clears JS
caches once per preparation batch outside the timer, shares segment answers across messages and retains Canvas.
Redo keeps normal paragraph-local ownership. Foreground Retina DPR 2, AC power, Apple M5 Max; pinned Chrome
153.0.8010.50, Firefox 156.0 and Safari 27.0. Native resources/browser history are shared. Preparation plus count
is measured directly, not summed from separate phases.

Matched current-range / A6-range median pair ratios (above 1 is slower):

| Browser / cohort | Preparation | Preparation + count | New widths | Repeated widths |
|---|---:|---:|---:|---:|
| Chrome / latin | 1.048× | 0.948× | 0.943× | 0.886× |
| Chrome / cjk | 0.999× | 1.043× | 1.114× | 0.891× |
| Chrome / arabic | 0.989× | 1.016× | 0.958× | 0.852× |
| Chrome / mixed | 1.005× | 0.941× | 0.933× | 0.879× |
| Firefox / latin | 1.018× | 1.000× | 0.990× | 1.005× |
| Firefox / cjk | 0.990× | 0.971× | 1.028× | 1.004× |
| Firefox / arabic | 0.986× | 0.965× | 1.011× | 0.997× |
| Firefox / mixed | 0.996× | 1.031× | 1.011× | 0.979× |
| Safari / latin | 0.987× | 0.999× | 0.971× | 0.986× |
| Safari / cjk | 1.015× | 1.010× | 1.005× | 0.994× |
| Safari / arabic | 0.986× | 1.003× | 1.038× | 1.007× |
| Safari / mixed | 1.001× | 1.066× | 1.004× | 0.998× |

Current-range / actual-main absolute median ratios (above 1 is slower):

| Browser / cohort | Preparation | Preparation + count | New widths | Repeated widths |
|---|---:|---:|---:|---:|
| Chrome / latin | 10.69× | 10.96× | 115.94× | 14.96× |
| Chrome / cjk | 2.29× | 3.38× | 101.42× | 13.31× |
| Chrome / arabic | 10.31× | 12.16× | 224.11× | 19.53× |
| Chrome / mixed | 6.40× | 6.67× | 149.96× | 15.62× |
| Firefox / latin | 1.04× | 2.29× | 52.25× | 15.34× |
| Firefox / cjk | 0.37× | 2.87× | 25.47× | 20.72× |
| Firefox / arabic | 1.53× | 2.78× | 108.49× | 14.80× |
| Firefox / mixed | 1.09× | 3.09× | 48.90× | 12.96× |
| Safari / latin | 0.39× | 0.41× | 3.43× | 3.64× |
| Safari / cjk | 0.23× | 0.25× | 3.34× | 3.59× |
| Safari / arabic | 0.46× | 0.60× | 19.03× | 18.95× |
| Safari / mixed | 0.44× | 0.53× | 13.10× | 13.55× |

Raw captures and exact commands are in `.artifacts/plaintext-round2-20260922/perf/` and `perf-targeted/`.
`final-audit/foreground-final.json` and `targeted-final.json` independently require their exact document matrices,
all samples, matched pairs, absolute deltas, order slots, source/focus checks, counts and complete redo cuts.
Failed whole runs, interrupted Firefox and provisional preflight remain distinct and contribute no broad acceptance.
The timing projection omits only repeated generated source strings for analysis; full raw reports and their digests
remain preserved.

The tables below remain dated historical populations, rather than fresh timing for this source.

## Plaintext stateless round, 2026-09-21

The bounded [stateless round](STATELESS_ROUND.md) simplifies exact source data and unused range output. Native timing
is mostly close to the original redo, with no broad preparation gain and small measured costs documented there.
Main remains substantially cheaper for new and repeated widths. This is a separate capture from the historical
three-cohort results below; the populations, output path and phase driver differ.

Original redo is `1b3cf7b`; actual main is `2e5e2bdaee398784b9cf27b24ca96df2e85396b8`, imported directly from its
checkout. The final redo runtime archive reproduces proof seal
`9b54b14a2bfc93199507ec5bbb7f50a337fdfb64c4a3c1807aa5af80712f0de7`. All 491 sealed source/helper/input files stay
unchanged after each browser. Each ordinary cohort has 120 pure plaintext messages. Eight saved samples follow two
warmups, with rotating four-library order and a 20ms floor. Each cohort/phase has a fresh document; paragraph handles
for new-width fills are reconstructed and initially filled outside the clock. Repeats retain already-warmed handles.
Main clears its JS caches once per preparation batch outside the clock, sharing segment answers across messages;
its Canvas context survives. Redo retains its normal paragraph-local ownership.

Foreground Retina DPR 2, AC power, Apple M5 Max: Chrome 153.0.8010.50, Firefox 156.0, Safari 27.0
(WebKit 22625.1.29.11.27). The 2,688 timed rows stay visible, focused and isolated; all samples and desktop activity
remain recorded. Chrome's initial untimed page handshake includes one unfocused endpoint, before the successful
timed guard. New documents do not isolate native resources or browser-process history.

Ratios are current range time / actual main time, using each variant's absolute median. Preparation is 120 messages;
initial count fills 320px. New/repeated widths are 360 message-width layouts at 260/380/440px, with preparation and
initial fill outside their timers. Above 1 means redo is slower. Preparation plus count has its own document and is
not the sum of separately timed phases.

| Browser / cohort | Preparation | Preparation + count | New widths | Repeated widths |
|---|---:|---:|---:|---:|
| Chrome / Latin | 7.67× | 11.12× | 127.07× | 16.93× |
| Chrome / CJK | 2.42× | 2.81× | 88.34× | 15.09× |
| Chrome / Arabic | 10.70× | 13.09× | 221.13× | 23.26× |
| Chrome / mixed | 6.33× | 9.00× | 158.23× | 17.60× |
| Firefox / Latin | 1.05× | 2.42× | 56.47× | 16.00× |
| Firefox / CJK | 0.40× | 2.85× | 21.90× | 19.07× |
| Firefox / Arabic | 1.62× | 2.75× | 104.39× | 14.98× |
| Firefox / mixed | 1.13× | 2.74× | 47.23× | 13.23× |
| Safari / Latin | 0.38× | 0.42× | 3.41× | 3.84× |
| Safari / CJK | 0.22× | 0.26× | 3.33× | 3.58× |
| Safari / Arabic | 0.49× | 0.59× | 17.84× | 18.97× |
| Safari / mixed | 0.43× | 0.51× | 12.59× | 13.43× |

All redo source cuts, continuations, line counts and Canvas call/character totals agree with original in every final
probe. Ordered questions and complete pieces/inspection are checked separately by deterministic proofs. Actual
main's counts differ slightly in some cohorts, most clearly Firefox CJK (885 redo / 893 main initially and 2,583 /
2,604 across new widths). These ratios do not prove identical main/redo geometry or contract, or browser correctness.
They also do not establish a universal worst-case bound.

Main resize makes zero Canvas calls. Plain ranges omit terminal full output in every redo engine, and Gecko omits
placed-frame output/unused justification metadata. Blink/WebKit still build scratch records for rewind and trimming.
The retained Latin gap, including zero-Canvas repeated fills, leaves material own-code work to simplify. The new-width
gap additionally includes existing width-dependent measurement. Neither cost has been proved necessary.

Raw reports, absolute medians, every paired redo difference, counts/cuts, focus/power/source seals and exact commands
are under `.artifacts/plaintext-round-20260921/perf-final/`. `summary.json` and the independent audit are entry points;
[the probe guide](experiments/plaintext-round/README.md) gives reproduction and cache/phase details. Earlier all-phase
captures and failed calibration/focus attempts are preserved separately and do not contribute to this table.

## Earlier three-cohort capture

2026-09-21. Main is substantially cheaper for retained count/layout and unfamiliar widths. Safari preparation is faster
in redo. The general input-growth audit reached a practical stopping point; application performance is not finished.

The unchanged canonical `bench/run.ts` compared redo `03857203ab6d2df39f4a5606b69102843ba9a752` with actual main
`2e5e2bdaee398784b9cf27b24ca96df2e85396b8`. All ten imported main runtime files byte-match actual main. Sources, harness,
corpora and the driver were sealed before and after the sequential jobs under all three maintained browser locks.

Foreground, Retina DPR 2, AC power, Apple M5 Max: Chrome 153.0.8010.50, Firefox 156.0, Safari 27.0
(WebKit 22625.1.29.11.27). Each of three deterministic cohorts (mixed, Latin, realistic chat) contains 200 messages;
6–8 samples use calibrated repetitions and interleaved variant order. All row endpoints were visible and focused,
with no viewport/DPR changes or other browser automation. Ordinary desktop activity remained; load was 3–5 on 18 cores.

Ratios below are median redo/main time. Each range spans the three cohorts; above 1 means redo is slower.

| Browser | Preparation + count | First fill at new widths | Repeated widths | Preparation + count, shared contexts |
|---|---:|---:|---:|---:|
| Chrome | 6.8–9.5× | 114–141× | 12.4–16.4× | 3.9–5.4× |
| Firefox | 2.3–2.7× | 54–65× | 15.6–18.1× | 2.3–2.8× |
| Safari | 0.43–0.57× | 3.6–5.5× | 3.3–5.1× | 0.25–0.27× |

Preparation/count covers 200 messages at 320px. Resize covers 600 message-width layouts at 260/380/440px; preparation
and the initial 320px fill are outside the resize timer. First fills reconstruct preparations before each repetition;
repeated fills retain data already filled at every width. Main clears its JavaScript caches once per preparation batch,
then shares segment measurement answers across messages. Its Canvas context and browser shaping cache survive the clear.
Redo pays its current font checks, contexts and preparation; the separate shared-context column uses its existing pool.
These are application workloads with each implementation's current ownership, not an answer-free JS microbenchmark
or a general worst-case timing guarantee.

Both timed count paths omit inspection and piece/text materialization. Redo still constructs full engine decided-line
state; main uses its scalar numeric walker and scalar rich-inline statistics. Counter wrappers run after timing only.
Main resize makes zero Canvas calls. First new-width redo fills ask 21,450–22,896 times in Chrome and 18,465–20,897
in Firefox. Removing line-result allocations alone cannot plausibly close that unfamiliar-width gap. The current
measurement recipes have not been proved necessary; a different prepared representation remains an architectural
research question rather than a measured improvement.

Latin repeated-width filling makes zero Canvas calls in both implementations, with exactly equal total line counts,
yet redo is 12.4×/15.6×/3.3× slower in Chrome/Firefox/Safari. There is material own-core work left to remove. A scalar
consumer of the same break logic or a better primary prepared model is a concrete frontier; these timings do not
attribute all of the gap to allocations or establish the replacement's benefit.

All nine initial total counts agree. Latin resized totals also agree; mixed/real resizing differs by 1–2 lines in some
browsers. Code-span contracts differ: main's scalar extra width applies to touched lines, while redo models inline
start/end edges. These timings do not certify identical cuts or geometry. A prior 1,000-message attempt timed out
with zero completed rows and contributes no performance evidence.

Raw evidence, absolute medians, exact counts/calls, commands and the source/lock manifest are preserved under
`.artifacts/bench/current-main-foreground-20260921-r2/`; start with `summary.md` and `workflow.json`. The failed attempt
is retained separately at `.artifacts/bench/current-main-foreground-20260921/`.
