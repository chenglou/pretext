# Performance against main

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
