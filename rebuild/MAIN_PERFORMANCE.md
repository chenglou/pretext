# Performance against main

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
