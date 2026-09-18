# An idempotent layout call with an invisible store (exploration, 2026-09-18)

**The adaptive two-generation rule as written fails two ways.** It drops entries the page still needs whenever the working set more than doubles inside one pass, first sight included. Under churn its size estimate S doubles at every turnover, so it leaks. The pass-scoped variant rebuilds everything whenever a view lays out only its visible messages between resizes. The idempotent call itself works and is fast.

All numbers are Chrome 153.0.8010.50 (pinned copy), DPR 2, busy machine. Timing jobs were interleaved and I report medians with [min–max]. Messages average 126 chars and 2.75 lines. At 100,000 messages, 99,987 are distinct.

**Line counts.** Over 630,000 layouts against main, 65 line counts differ. The unhacked rebuild agrees with the idempotent call on all 40 I looked at. On 4,002 of 4,002 sampled layouts the line starts and widths match the unhacked rebuild. About 1 call in 8,000 needs the general path; it re-measures from the content in hand, so entries keep nothing for it.

**Per call** (ns per message; two runs agreed within 5%):

| | ns | over the loop |
|---|---|---|
| fast line loop over an array of handles | 136 [115–181] | 0 |
| `layout(text, style, w)`, one Map per style, same string objects | 143–149 | +7–13 |
| equal strings rebuilt each pass (JSON.parse / `a + b` / slices) | 181 / 202 / 197 | +45–70 |
| composite key string built per call | 232 | +97 |
| two generations steady / pass after a turnover / pass-scoped | 180 / 205 / 187 | +45–70 |
| rich, trie of Maps (2.9 runs), same run objects / re-sliced each pass | 258 / 384 | +123 / +248 |
| rich, one joined key string built per call | 415 | +280 |
| rich, Map on the longest run then compare runs, same objects / re-sliced | 256 / 328 | +121 / +193 |
| main `layout()` over stored handles | 228 | |

- **First sight:** hashing is noise next to the 40 µs build.
- **Memory-bound:** at 10,000 entries the pass is limited by memory access. Stores that didn't share warm entries with the baseline run about 40 ns slower for the same code.

**Passes and memory**

| | 10k | 100k |
|---|---|---|
| idempotent call, first sight (the worst pass) | 400 ms [390–440] | 4.1–4.9 s |
| idempotent call, later pass | 1.2 ms back to back, 1.5–2 with other work between | 25–28 ms |
| main `prepare()` for all / `layout()` pass | 174 ms / 2.3 ms | 2.0 s / 27 ms |
| stateless main, `layout(prepare())` per call | 168 ms per pass | 1.9 s |
| stateless prototype (word widths kept / dropped per call) | 337 / 503 ms per pass | 3.8 / 5.5 s |
| unhacked rebuild library, per call (timed on the first 500 / 200 messages, scaled) | 6.9 s | 70 s |

- **Bytes per message:** main handle 1,566 (1,838 with segments). Idempotent store 3,683 (3,174 in typed arrays, 72 B per known offset, unoptimized). Round3 handles as they were: 21,444.
- **100k:** 319 MB in typed arrays.
- **Growing vocabulary:** one never-seen token per message adds 15% to first sight.

**Stores on the scripted sessions** (10k unless said; store behaviour was the same in every repeat)

| | adaptive, as written | pass-scoped | two generations turning over at `endPass()` |
|---|---|---|---|
| drag, 60 steps | pass 2 rebuilds 3,856 (154 ms) | clean | clean |
| 100k | pass 2 rebuilds 63,479 (2.7 s) | clean | clean |
| churn, 100 in and out per pass × 300 | holds 39,196 for 10,000 live (unbounded: 39,896); 3,656 rebuilt in pass 2 | holds exactly 10,000 | holds ≤ 30,098, none rebuilt |
| 50 visible for 300 frames, then all on a resize | first resize rebuilds 3,856 (155 ms) | every resize rebuilds all (400 ms) | clean |
| same, with 5 arriving per frame | first resize rebuilds 6,144 (249 ms) | 12,950 then 15,950 rebuilt (536, 627 ms) | clean |
| fonts 16→14→16px | pass 2 rebuilds 3,856 (155 ms); flip back is free | flip back rebuilds all (416 ms) | flip back is free; holds both (63 MB) |
| 10,000 messages, then 100 others | keeps 10,100 | keeps 100 | keeps 10,100 |

- **Two font resolutions in every pass:** the adaptive rule rebuilds 9,760 entries in pass 2 (383 ms). The other two stores are clean.
- **Inferring the pass end:** I also tried reading it off the end of the JS task with `queueMicrotask`. It matches the last column until a pass spans several tasks, then thrashes for good: 1.09 M rebuilds over 300 passes, about 390 ms per pass.

**What breaks the idempotent shape**
- **First sight:** 40 µs per message, which is 0.4 s at 10k and 4+ s at 100k. No store fixes that.
- **Stateless:** at 34 µs per message it fits about 300 messages per frame.
- **Rich keys:** they cost 1–2× the line loop. Round3's tables cover one plain run, so I timed the rich keys with the joined text laid out as one plain run.
- **Memory:** 2.3× main per message, times up to 3 under churn.
- **Word widths:** the word-width Map is a second unbounded store. It held 5,388 words.
- **Shrink:** no store but the exact one ever shrinks below its high-water mark.

**What I'd prototype properly after the re-architecture**
- **Keys:** `layout(content, style, width)` on the long-lived object with a per-style `Map<string, entry>`. For rich content, a trie or a Map on the longest run.
- **Entries:** one or two buffers each, slimmed well below 72 B per offset. The pass is memory-bound, so smaller entries are also faster.
- **Eviction:** two generations with one `endPass()` anywhere. S is the largest number of distinct entries in one pass, or the number promoted, and never less than half the previous S. This is the last column above, the only variant clean in every session but shrink; it needs a shrink rule.
- **Open:** a time-sliced first sight.

Everything is in `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/api-explore/`; nothing under `pretext-rebuild` was touched. Open `results/report.txt` first (`python3 summarize.py` regenerates it). Raw runs are `results/*.json` and `logs/`. `idem.ts` holds the call and the stores, `src/engines/blink/packed.ts` the packed tables and loop, and `modes2.ts` the check, per-call, sessions, compare and memory modes. `run.ts` launches the pinned Chrome.
