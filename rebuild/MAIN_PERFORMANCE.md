# Performance against main

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
