# The ports' own JavaScript, profiled: where the time of 10,000 chat messages goes, what was free, what is left (2026-09-20)

Every performance item before this one removed Canvas questions. Nobody had looked at the ports' own JavaScript; the
maintainer asked "did you ever check whether we have slow parts in our iteration we could have freely sped up?" and the
honest answer was no. One owner per engine profiled the chat benchmark in the real browser (10,000 messages from
scratch with a page's list of contexts, and the same messages kept and laid out again at three widths), split the time
between Canvas and the port's own code by two or three methods, ranked the own code's hot spots, and built the fixes
that are FREE: the same Canvas questions in the same order, the same lines, no state beyond a call. A critic per engine
then reran the timings in fresh pages, attacked exactness with texts the recorded cases don't hold, and gave a verdict
per commit. The critics' reviews come first, then the owners' reports. The branches (`x-prof-blink`, `x-prof-gecko`,
`x-prof-webkit`, on f74643e) are local; what merges is what a critic confirmed.

## What came back, and the orchestrator's reading

- **The split, own code against Canvas** (10,000 messages from scratch, a page's list of contexts; each by two or three
  methods that agree within what is explained): Chrome: Canvas 76 to 78%, own code about 0.7 s of 3.45 s on the mix.
  Firefox: Canvas 43 to 44%, own code 0.43 to 0.50 s of 0.92 s on the mix. webkit-host: Canvas 33 to 43%, own code most
  of 0.14 s. A relayout of a kept message is own code in WebKit (all of it), most of it in Firefox (58%), and in Chrome
  53% of a relayout at a new width is the break search's Canvas questions. The unchecked guess of "0.5 s of own code"
  in Chrome was low: it is 0.7 to 1.07 s per 10,000, and still only a quarter of Chrome's time.
- **Yes, there were slow parts that were free to fix, one big one per engine.** Blink: building each Canvas question
  cost more than the rest of the port together, and a third of that was a copy of the text offsets into a typed array
  that nothing reads on a plain paragraph (−24 µs a message with 0 lines added; two more commits −6 and −4 µs; together
  3.45 to 3.10 s on the mix, relayout 1.11 to 0.99 s; the critic confirms 34 µs on the owner's base and 26 µs on
  today's). Gecko: a script check ran at every Canvas question (−3.5 and −9.1 µs a message; with two more commits the
  mix −13.9 µs a message and a relayout −10%, the critic's numbers). WebKit: the simple line builder spent 50 ns of
  bookkeeping an item where a sum takes 6 ns; filling a line's leading plain items by sums is MAIN'S FLAT LAYOUT LOOP
  TAKEN BACK (+54 lines): a kept message's layout −1.0 µs on the mix and −1.1 on plain ASCII by the critic (the owner's
  −34% and −52%), from scratch −19% on ASCII and −6 to −8% on the mix (the owner claimed −13.9%; the critic's fresh
  pages say half); one kept word segmenter takes Thai messages from 46 to 20 µs.
- **What the critics caught.** Gecko: the biggest commit CHANGED A CANVAS QUESTION where a text run ends with a lone
  high surrogate and the next starts with the low one (4 of 3,358 paragraphs of the critic's differential; no recorded
  case holds it, so tier 1 stayed 0 and 0): fixed by the critic with a unit test, +7 −5 lines. Blink: the third commit
  moves the code that builds every Canvas string into a file tier 1's string storage rule doesn't watch. WebKit: a
  comment that is false under `break-spaces` (no output differs; a one-line guard). DESIGN's "0.41 s no removal of
  questions can beat" is wrong as worded.
- **On data layout, the maintainer's steer of the same day** (typed arrays and structure-of-arrays as the engineering
  optimizations to reach for before algorithms): the profiles say where it pays and where it doesn't. In WebKit it is
  the whole game, and the flat stretch is that; after it nine tenths of a kept layout is per-line cost (0.3 µs a line
  against main's whole layout at 0.3 to 0.5 µs), which is the next thing to flatten. In Firefox typed arrays and
  `subarray` were hot under bun and measured at 14 and 6 ns in SpiderMonkey: disproved there; one trap found (spreading
  a typed array into `String.fromCharCode` costs 8.7 µs a message). In Chrome the largest free win was REMOVING a
  typed-array copy. The own-code floors after the fixes (every Canvas answer free): Chrome 0.41 s (mix) and 0.36 s
  (ASCII) per 10,000 from scratch and 7 µs a relayout; Firefox 0.31 and 0.19 s; webkit-host 7.4 and 5.2 µs a message.
  Main's whole cold prepare is 20 µs a Latin message and its layout 0.3 µs: the ports' relayout own code is 3 to 25
  times that, so a flat, allocation-free fill for a kept plain paragraph is worth building in Blink and Gecko too, on the
  table the word cuts want anyway.
- **What is left is questions.** Chrome asks 7 times WebKit's questions at 8 times the price a call (about 1.15 µs
  against 0.13 to 0.17 µs): the cut search of wide groups holds 73% of Chrome's from-scratch time. 76% (ASCII) and 84%
  (mix) of Firefox's questions are break candidates inside each line's first word, which decide nothing when the word
  fits and which main never asks (the word scan of research/SPEC-WORD-SUM.md removes them, on a premise). 69% of the
  bench's Chrome questions repeat a string a canvas was already asked.
- **What merges:** Blink's first two commits as they are and the third after the critic's change; Gecko's three kept
  commits with the critic's fix, not the optional fourth; WebKit's two font commits as a pair, the segmenter after its
  comment moves, the flat stretch after its guard. None changes a question, so tier 1 is 0 and 0 in every engine;
  Chrome's string storage rule sends its cases to a browser, so Chrome is recorded again at the merge.
- **A slip of an agent's:** the Gecko owner sent profiler signals to another agent's Firefox by mistake during one of
  the cut rework critic's timed stretches (11:42); that critic's verdict rested on counts and row comparisons, not on
  that stretch.

## Second pair of eyes on the Blink port's JS profile and its three commits (prof-blink-critic, 2026-09-20)

Worktree `~/github/pretext-rebuild-wt/prof-blink`, branch `x-prof-blink`. The owner's head is 594b120. My three commits on top are tools only. Nothing is merged or pushed. The running log is `.progress-prof-blink-critic.txt` in the worktree.

Paths below:
- B = `~/github/pretext-rebuild/.artifacts/bench/prof-blink-20260920/critic`
- T = `~/github/pretext-rebuild/.artifacts/tests/runs/prof-blink-20260920/critic`
- S = the session scratchpad's folder `prof-blink-critic` (new when I made it: exported trees, node bundles, two scratch clones)

### 0. Words

- **pass**: 10,000 chat messages, each prepared plain and filled at 320 px from scratch, one list of Canvas contexts a pass (the owner's word).
- **relayout**: the same messages prepared, filled at 320 px and kept, then filled at 260, 380 and 440 px. That is 30,000 layouts.
- **mix | ASCII**: the bench's two sets. Every pair of numbers below is mix | ASCII.
- **old base**: f74643e, where the owner's branch starts.
- **merged base**: bcf3f1b, today's rebuild-20260916 head, which holds the cut rework (c64faed).
- **C1, C2, C3**: the owner's library commits 2d79393, aa814a0, 18ff97e.
- **fresh page**: a new window that loads one checkout alone. It runs the first 1,000 messages of each set once, takes one timed pass per set, posts its result and is closed. A round opens one fresh page per checkout, and the next round starts one checkout later.
- **step**: the median over the rounds of a checkout's time minus the time of the checkout before it, in the same round. "q" gives the two quartiles of those differences. "n of 12" counts rounds under 0.
- **free answers**: the owner's method. A pass's Canvas answers are recorded once and handed back in order.
- **questions alone**: my method. The pass's strings (the objects the port built) are asked again in order, without the port, on new contexts with the same settings, made in the pass's order. Every replay gave the same sum of widths as the pass.
- **stopwatch**: my other method. A timer is read before and after every measureText call in a real pass and the differences are summed. The same two reads around a free answer are then subtracted.
- **storage tag**: whether V8 stores a string one byte or two bytes a unit, read from the tag `v8.serialize` writes. Chrome's Canvas shapes the two kinds differently, and the stand-in Canvas doesn't.

### 1. Outcome

**Verdict per commit**

| commit | verdict | why |
|---|---|---|
| 2d79393 C1 (offsets list handed out) | merge | Confirmed on both bases in every round. 0 lines net, no state, simpler. |
| aa814a0 C2 (properties below U+3000 by index) | merge | Confirmed, quartiles under 0 in every series but one kept ASCII series. +20 lines. Two fixed tables, 72 KB. |
| 18ff97e C3 (one `String.fromCharCode` call) | merge after a change | The gain is real but small. As written it moves the code that builds every Canvas string out of the files tier 1's string storage rule watches (§5). |
| c42837d DESIGN | merge after a change | Its numbers are of the old base, and one sentence is wrong (§7). |
| a000acd, 5c4adfd, 7aa3a44, 594b120 (tools, +766 lines) | your call | They work and their numbers reproduce. They are study tools like the 49 already in `rebuild/tools`. |

**The three sentences for the maintainer**

1. All three speed-ups are real and exact: in fresh pages I measure −24, −6 and −4 µs a message on the owner's base, and −21, −4 to −5 and −2.5 to −3.5 µs on today's rebuild head, with the same strings, contexts, order, V8 storage and lines on 538 edge texts.
2. Merge C1 and C2 as they are, and merge C3 only with its string building kept under tier 1's storage rule: a 4-line patch that keeps it in `shape.ts`, or `content.ts` added to the rule's paths.
3. The branch is behind: Chrome's references were frozen again at 13:00 for the cut rework, so tier 1 and the gates fail on the branch as it stands; all eight commits cherry-pick clean onto bcf3f1b, where tier 1 shows 0 and 0, the full gates exit 0 and tier 2 shows 0 transitions, and DESIGN's numbers need restating there.

### 2. The timings, taken again

**Tool.** `rebuild/tools/js-profile-fresh.ts` (mine). One pinned Chrome 153.0.8010.50 in a background window at device pixel ratio 2, a fresh page per measurement. It reuses the owner's page-side entry and its bundling. Every timed run held the exclusive lock.

**Run fresh-1: old base.**
- Trees: f74643e, C1, C2, C3.
- 12 pass rounds and 6 relayout rounds; load 53 falling to 26.
- File: B/fresh-1/fresh-summary.txt.
- Line totals in every page: 35,076 | 32,549, the owner's.

| | pass, ms per 10,000 messages (median) | step, ms (q; rounds under 0) | µs a message | owner's claim |
|---|---|---|---|---|
| base | 3400.3 \| 3213.6 | | | 3451 \| 3231 |
| C1 | 3156.3 \| 2956.1 | −239.9 (−269.7..−217.4; 12 of 12) \| −268.3 (−280.8..−230.3; 12 of 12) | −24.0 \| −26.8 | −23.9 \| −24.0 |
| C2 | 3091.9 \| 2895.4 | −63.0 (−78.1..−39.0; 10 of 12) \| −72.8 (−81.1..−43.1; 12 of 12) | −6.3 \| −7.3 | −6.3 \| −5.4 |
| C3 | 3054.7 \| 2859.0 | −38.0 (−55.7..−22.7; 12 of 12) \| −35.9 (−45.0..−8.6; 10 of 12) | −3.8 \| −3.6 | −3.9 \| −3.7 |

Relayout (30,000 layouts), old base:
- 1126.8 → 1015.5 | 1018.2 → 872.0 ms.
- C1: −85.2 | −88.4 ms, 6 of 6. That is −2.8 | −2.9 µs a layout.
- C2: −20.7 (q −30.2..−4.0) | −20.8 (q −36.0..−7.6). That is −0.7 | −0.7 µs a layout.
- C3: −13.1 (q −23.5..+3.0; 4 of 6) | −16.3 (q −28.7..−10.8; 6 of 6).
- The owner's C3 relayout claim of −1.0 µs a layout on the mix is inside my spread there.

**Run fresh-merged-1: merged base.** This is what would really merge.
- Trees: bcf3f1b, then the three commits cherry-picked.
- 1,957,075 | 1,824,332 questions a pass, against 2,382,121 | 2,303,273 before the cut rework.
- Load 28 to 44. File: B/fresh-merged-1/fresh-summary.txt.

| | pass, ms (median) | step, ms (q; rounds under 0) | µs a message |
|---|---|---|---|
| base | 2680.8 \| 2432.1 | | |
| C1 | 2467.1 \| 2249.7 | −208.8 (−257.0..−175.9; 12 of 12) \| −183.8 (−194.1..−160.8; 12 of 12) | −20.9 \| −18.4 |
| C2 | 2429.6 \| 2195.7 | −37.5 (−57.3..−3.1; 10 of 12) \| −50.8 (−60.7..−26.9; 10 of 12) | −3.8 \| −5.1 |
| C3 | 2414.3 \| 2166.1 | −25.1 (−35.8..+0.5; 9 of 12) \| −35.1 (−44.3..−9.8; 11 of 12) | −2.5 \| −3.5 |

- Relayout 1089.3 → 936.9 | 971.1 → 843.8 ms: C1 −92.0 | −73.8, C2 −35.8 | −34.5, C3 −35.2 | −25.6, all 6 of 6.
- Passes that keep what they prepare (6 rounds): C1 −199.0 | −219.2, C2 −30.2 | −32.8, C3 −30.0 | −42.3.
- Together: 34 µs a message on the old base, which is the owner's number, and 26 µs on the merged base.
- The gain goes with the number of questions, and the cut rework removed 18% of them.

**C3 across all twelve series.**
- Its median is under 0 in all twelve: pass, kept pass and relayout, on two sets and two bases.
- Rounds under 0: 42 of 48 pass rounds, 23 of 24 kept rounds, 22 of 24 relayout rounds.
- Two series touch 0 with a quartile. So it is real, and small.

**Free answers, one pass per page (the owner's "floor").** These are single passes, which run about 1.5% above the owner's 12-round medians.
- Old base: 683.5 → 415.1 | 623.8 → 352.8 ms. The owner's: 677.5 → 409.2 | 622.5 → 356.2. Confirmed.
- Merged base: 549.5 → 349.3 | 486.6 → 288.9 ms.

**Module load, C2.**
- In node, cold process, `props.ts` alone, best 8 of 15: 0.78 to 0.96 ms at C1 and 1.76 to 2.01 ms at C2. So the tables cost about 1.0 ms. The owner said 0.7 ms, and the code comment says "in under a millisecond".
- In Chrome, script load from cold over 30 alternating fresh pages at load 45: median 21.1 ms, C2 minus C1 −0.21 ms (q −5.6..+3.0). It can't be seen there. File: B/load-1.
- `src/index.ts` imports the three engines, so Safari's and Firefox's pages pay it too, as they already pay for the engines' other tables.

### 3. Exactness

**The branch as it stands fails tier 1 and the gates, and not because of its commits.**
- Full gates on 594b120: exit 1 (T/gates-full-head.log).
  - Tier 1 no-facts: 14 predictions changed, 632 other and 19,519 new questions.
  - Tier 1 facts: 4 predictions changed, 896 other and 19,265 new questions.
  - Painter: 19,533 and 19,269 cases where the frozen predictor differs.
- Cause: the shared Chrome references were frozen again at 12:57 to 13:02 for the merge of the cut rework (5e19e08 and c64faed; the reference's library commit is 7f077ac).
  - The branch starts before that merge, so its old cut code is held against the new reference.
  - The owner's tier 1 and tier 2 logs were against the reference of 6d71b371b3f4 and were valid then. They can't be reproduced any more.
- The other gates pass on that run:
  - tsc over the six projects.
  - Unit tests: 69 files, 892 pass, 0 fail. This is the fully green unit run the owner couldn't get at its load.
  - Citations, the twin scan, and both sweeps (67,065 pass).

**On the merged head everything holds.**
- A `--shared` scratch clone (S/merged) at bcf3f1b takes all eight commits by cherry-pick without a conflict. `shape.ts` auto-merges.
- Tier 1 on bcf3f1b plus C1 to C3, 69,224 cases in 16 sets against the reference of 7f077ac (T/merged-no-facts.log, T/merged-facts.log):
  - no-facts: 0 predictions changed, 0 questions changed.
  - facts: 0 and 0.
  - Exit 3 by the string storage rule alone (67,923 and 6,624 cases go to tier 2).
- Full gates on the clone at all eight commits: EXIT 0. It took 955 s after an 8,996 s wait for a turn (T/gates-full-merged.log).
  - tsc ×6: 0 errors.
  - Unit tests: 72 files, 900 pass, 0 fail.
  - Citations: 0 lost.
  - Twin scan: 69,231 cases, 0 ask one context both storages.
  - Tier 1: exit 3, storage rule alone.
  - Plain and pure checks: 69,224 pass in both configurations.
  - Painter: 69,224 painted, 0 differ.
  - Sweeps: 69,224 pass.
- Tier 2, pinned Chrome, forward, from the clone, over tier 1's id files:
  - facts: exit 0; 6,665 cases compared, 0 status transitions, differing values 38 → 38 and 14 → 14 (T/tier2-merged-facts.log).
  - no-facts: three of 20 jobs failed by machine overload while my gates ran at a load of 150. One was `sw_vers` ETIMEDOUT; two were "No page activity for 120000ms".
  - One `--rerun-failed` at a load of 30 ran the three in about 10 s each.
  - Then exit 0: 68,744 cases compared, 0 status transitions, 316 → 316 and 1,051 → 1,051 (T/tier2-merged-no-facts-rerun.log).

**The attack the recorded cases don't hold** (tools mine: `question-strings-cases.ts`, `question-strings-dump.ts`).
- 520 edge cases and 18 giants. They cover:
  - strings of 0, 1, 12, 13 and 14 units;
  - texts of 4,095 to 8,193 and of 100,000 units;
  - empty runs;
  - only spaces, in all six white-space modes;
  - every character Canvas replaces, alone, in 8-bit text and in segmented text;
  - Latin-1-only brackets and digits shaped under Arabic, Hebrew and Han;
  - joining across range edges, with marks and ZWJ;
  - lone surrogates and a pair split across nodes;
  - every code point from U+2FE0 to U+3020;
  - mixed direction in both paragraph directions;
  - letter and word spacing;
  - all 360 combinations of white-space, word-break, overflow-wrap and line-break.
- The dump is bundled per tree and run by node, which is V8. It notes, for every question, its context settings and string in order, its storage tag, and the fill results, pieces and inspections at six widths. Two trees are compared with `cmp`.
  - Old base against the owner's head: byte-equal on the 520 cases, plain and inspected, in both configurations. Equal on the giants, up to 40.5 million questions a case. Files: T/dump-*.txt.
  - Merged base against merged head, and against the C3 variant: byte-equal as well.
- The cases do reach the edges. A seeded bug (the −1 of a prefixed string's offsets dropped) shows in 8 lines, and another (the table read at `cp <= 0x3000`) shows in 16.
- `props.ts`:
  - All 21 exported lookups are equal on every code point from 0 to 0x10FFFF, and on 0x110000, NaN, undefined, 2^31 and 2^32.
  - `lineBreakClass` differs at −1 and at 0.5.
  - A throwing check found no such argument over the 520 cases and Blink's 147 unit tests.
- `positions-attack.ts`, old base against head, 520 cases, 49,920 layouts a run, 0 differ in all four runs:
  - no mutation (30,228.6 calls a case in both trees);
  - letter spacing 1.5 px, the run that reads C1's list (31,166.1);
  - fonts three times their size with the long-context Canvas (68,152.2);
  - facts with letter spacing and the long-context Canvas (52,579.4).
  - Files: T/positions-attack.log, T/positions-attack-2.log and their JSON reports.

### 4. The split, by two methods the owner didn't use

One split page per checkout in the exclusive runs. ms per 10,000 messages. Where a page's own wall pass ran slow, the share is of the 12-round median.

| | wall | free answers | questions alone | stopwatch in place |
|---|---|---|---|---|
| old base, mix | 3448.4 | 683.5 (19.8%) | 2672.7 (77.5%) | 2616.0 (75.9%) |
| old base, ASCII | 3327.6 (median 3213.6) | 623.8 | 2420.4 (75.3% of the median) | 2442.7 (76.0%) |
| C3 on it, mix | 3066.8 | 415.1 (13.5%) | 2646.9 (86.3%) | 2664.7 (86.9%) |
| merged base, mix | 2664.7 | 549.5 (20.6%) | 2070.5 (77.7%) | 2042.7 (76.7%) |
| merged + C1..C3, mix | 2428.4 | 349.3 (14.4%) | 2050.4 (84.4%) | 2038.0 (83.9%) |
| merged + C1..C3, ASCII | 2331.5 (median 2166.1) | 288.9 (13.3%) | 1783.3 (82.3%) | 1812.2 (83.7%) |

- **Canvas is 76 to 78% of a pass at the base by both methods.** The owner's two readings bracket it: 72% (measureText self time) and 80% (wall less the free-answers pass).
- **Wall less free less alone is 92 ms at the old base on the mix.** That is the owner's 93 ms of `width` self time: the cost of the two kinds of work being interleaved. It is nobody's alone, and it leaves when a question leaves. The owner's explanation of its two methods' gap holds.
- After the three commits Canvas is 82 to 87% of a pass, so the summary's "four fifths" is right for the head.
- A question costs 1.12 µs of Canvas at the old base (2672.7 ms over 2,382,121). The owner said 1.15. It costs 1.06 µs on the merged base.
- **A caveat on what the bench shows** (B/count-merged):
  - Of the merged head's 1,957,075 questions on the mix, 605,982 (31%) are a canvas's first of that string.
  - On ASCII it is 547,147 of 1,824,332 (30%).
  - The other 69% repeat a string the same canvas was already asked, in the same message or from an earlier one of the synthetic set. Chrome answers a repeat from what the canvas has shaped.
  - Text with fewer repeats pays more per question, so there the Canvas share is higher and the same µs saved are a smaller share.

### 5. The engineering guide on each diff

| | lines | state | simpler? | a reader follows it? |
|---|---|---|---|---|
| C1 | +3 −3 | none | Yes. Two conversions go, and the type says what the value is. | Yes. |
| C2 | +29 −9 | Two typed arrays, 72 KB. Made at module load, page lifetime, never invalidated (fixed Unicode data), bounded by construction. | No: it is a second form of the same data. It fits the guide's exception: stable input, real reuse (several reads a question), bounded size. | Yes. The comment should say "about a millisecond". |
| C3 | +11 −5 over two files, a new export | none | About the same. | Yes, but see below. |

**C3's problem.**
- `replay.ts` sends Chrome's storage-sensitive cases to tier 2 when a file that builds Canvas strings differs from the reference's commit.
- It knows those files by `STORAGE_PATHS`: `rebuild/src/measure`, `engines/blink/shape.ts` and `engines/blink/contexts.ts`.
- C3 puts the one function that now builds every Canvas string, `stringOfUnits`, into `engines/blink/content.ts`.
- After the next freeze, an edit to it (say, a join instead of `fromCharCode`) would change V8's storage and tier 1 would exit 0.
- The rule's comment, which names `shape.ts` `canvasString`, would no longer be true.

**Two ways to close it. The orchestrator picks.**

(a) Keep the one-call path inside `shape.ts` and leave `content.ts` as it was. The gain is per question, and `buildContent` calls once a paragraph. It is +2 lines instead of +6 and no export. Replace 18ff97e by this (B/c3b.patch; it applies after C2 on both bases):

```diff
--- a/rebuild/src/engines/blink/shape.ts
+++ b/rebuild/src/engines/blink/shape.ts
@@ -247,8 +247,10 @@
     codes = keptCodes
     units = keptUnits
   }
+  // One String.fromCharCode call where the units fit its arguments, which is every string but a long text's: no copy.
   let s = ''
-  for (let i = 0; i < codes.length; i += 4096) s += String.fromCharCode(...codes.slice(i, i + 4096))
+  if (codes.length <= 4096) s = String.fromCharCode(...codes)
+  else for (let i = 0; i < codes.length; i += 4096) s += String.fromCharCode(...codes.slice(i, i + 4096))
```

- Checked:
  - The dumps equal the merged base's on the 520 cases in both configurations, and on the giants.
  - Blink's unit tests on the merged tree: 130 pass.
  - Tier 1 in both configurations: 0 predictions and 0 questions changed (T/c3b-no-facts.log, T/c3b-facts.log).
- NOT proven: its timing. Three exclusive runs of C2, C3 and the variant (B/fresh-c3b, B/fresh-c3b-2, B/fresh-c3b-3):
  - Variant minus C3: −5.5, −15.9 and +25.5 ms on the mix; +1.0, −33.9 and +18.2 ms on ASCII.
  - That is inside the spread every time. In two of the three runs C3's own step over C2 was inside it too.
  - The first ran at a load of 93 and the second at 72.
  - The third ran at a load of 13, and single passes of one tree still ranged from 2419 to 2859 ms.

(b) Keep C3 exactly as measured and add `'rebuild/src/engines/blink/content.ts'` to `STORAGE_PATHS`. Every later edit of `content.ts` then sends about 68,000 cases to tier 2.

**Tools.**
- The owner's add 766 lines. Mine add about 700.
- Mine repeat about 110 lines of the owner's Chrome launch and DevTools plumbing, because I was told not to edit the owner's files.
- If both are kept, fold `js-profile-fresh.ts` into `js-profile.ts` as modes.
- knip lists every file of `rebuild/tools` as unused, mine and the owner's like the other 49, so "knip flags nothing of mine" says nothing either way.

### 6. What the owner missed

1. **The base moved under it** (§3). Its absolute numbers (3.45 s, 238 questions a message, the cut search at 73% of the wall) describe a tree that the merge replaced at 13:00. On the merged head a pass is 2.68 | 2.43 s before its commits and 2.41 | 2.17 s after.
2. **The storage rule hole in C3** (§5).
3. **It stopped by the pass ranking only.**
   - By its own head profile of a relayout, `floatWidthOfParts` is 3.0% of the wall time and `groupPrefix16` is 2.2%, tied with `canvasString` (3.1%) and over its own 1% line. Relayout is the second use that matters.
   - The FREE fix it names for `floatWidthOfParts`, 0 lines, reads as exact: on a plain paragraph `floatSum` gets a null list, so the slack, the unknown-cluster scan and the run list are computed for nothing. Guarding that block by `sh.gaps !== null` was not built or timed.
4. **The bench's repeats** (§4): 69% of the questions repeat a string already asked of that canvas.
5. **One thing seen under the stand-in Canvas, not checked in a browser, and not the owner's doing** (the same in base and head; the cut search's territory). Merged head, plain path, 320 px:
   - A word of random letters asks 1.7 questions a unit (8,000 units: 13,710).
   - A word of one letter that the stand-in ligates with itself (`f`) asks 3,549 questions at 125 units, 64,867 at 1,000 and 403,721 at 4,000. That is 100 a unit, and it grows faster than the text.
   - Its lines also get shorter as the word grows: 162 lines at 2,000 units, 2,091 at 4,000.
   - A run where no offset passes the safe test is the worst case of the cut search, and the chat sets hold none.
6. Beyond these I found no own-JS suspect the owner's table lacks.
   - On the head `canvasString` is 63 ns a question and `measure16` 38 ns.
   - `measuredRange` returns at once on a plain paragraph.
   - Analysis already skips scripts, emoji and graphemes for 8-bit text.
   - I agree that an early plain path isn't worth its lines.

### 7. Corrections to the owner's text

- **DESIGN §4.7** says a free-answers pass takes 0.68 s and 0.62 s, "which no removal of questions can beat". Wrong.
  - Own JS goes with the number of questions: about 0.15 µs each between the two heads.
  - The cut rework alone took the head's free-answers pass from 0.42 s to 0.35 s on the mix.
  - Suggested wording: "the port's own JavaScript at that number of questions".
- **DESIGN's numbers** are of f74643e.
  - It should say so, or restate them on the merged head.
  - Pass: 2.68 → 2.41 s and 2.43 → 2.17 s.
  - Relayout: 1.09 → 0.94 s and 0.97 → 0.84 s.
  - Free answers: 0.55 → 0.35 s and 0.49 → 0.29 s.
- **The summary's "three commits took about 34 µs"** holds on the old base. On the merged base it is 26 µs.
- **"Tier 1 exits 3 by the storage rule alone"**: true then, and true of the merged tree now. It can't be reproduced on the branch as it stands.
- **The props.ts comment's "in under a millisecond"**: it is about one millisecond, cold.

### 8. Runs

| run | what | lock, load | folder | exit |
|---|---|---|---|---|
| smoke1 | tool check, 400 messages | chrome slot, 61 | B/smoke1 | 0 |
| fresh-1 | old base: base, C1, C2, C3; 12 + 6 rounds; split pages | exclusive, 53 to 26 | B/fresh-1 | 0 |
| fresh-merged-1 | merged base, the same | exclusive, 28 to 44 | B/fresh-merged-1 | 0 |
| count-merged | first-asks count | chrome slot | B/count-merged | 0 |
| load-1 | script load, C1 against C2, 30 rounds | chrome slot, 45 | B/load-1 | 0 |
| fresh-c3b, -2, -3 | C2, C3 and the variant | exclusive; 93, 72 and 13 | B/fresh-c3b* | 0, 0, 0 (too noisy to decide) |
| gates-full-head | full gates on 594b120 | gates turn | T/gates-full-head.log | 1 (the reference moved) |
| merged-*, c3b-* | tier 1 in the scratch clones | none | T/merged-*.log, T/c3b-*.log | 3, 3, 3, 3 (storage rule alone) |
| gates-full-merged | full gates, merged plus 8 commits | gates turn after 8,996 s | T/gates-full-merged.log | 0 |
| tier2-merged-facts | tier 2, Chrome, forward | chrome slots | T/tier2-merged-facts.log | 0 |
| tier2-merged-no-facts | the same, no-facts | chrome slots | T/tier2-merged-no-facts.log, then -rerun.log | 2, then 0 after one `--rerun-failed` |
| dumps | 520 + 18 cases, node | none | T/dump-*.txt | equal |
| positions-attack ×4 | 49,920 layouts each | none | T/positions-attack*.log | 0, 0, 0, 0 |

### 9. Problems

See the `problems` field.

## Review of the Gecko profile and its commits (prof-gecko-critic, 2026-09-20)

Worktree `~/github/pretext-rebuild-wt/prof-gecko`, branch `x-prof-gecko`, base f74643e. Nothing is merged or pushed.

- Test runs: `~/github/pretext-rebuild/.artifacts/tests/runs/prof-gecko-20260920/critic/` ("runs/" below).
- Bench output: `~/github/pretext-rebuild/.artifacts/bench/prof-gecko-20260920/critic/` ("bench/" below).
- Log: `~/github/pretext-rebuild-wt/prof-gecko/.progress-prof-gecko-critic.txt`.

### 0. Words used

- **ASCII, mix, scratch, resize**: as in the owner's report. They are the bench's `chat/latin` and `chat/mix` sets of 10,000 messages. Scratch is prepare plus fill at 320 px with one list of contexts a pass. Resize is kept messages filled at 260, 380 and 440 px, which is 30,000 layouts.
- **Fresh page**: a document of its own per checkout per round. The probe runner reloads between documents. So no checkout runs beside another's compiled code, garbage or kept contexts. All reloads share one Firefox content process.
- **Pair difference**: within one round, a later checkout's page minus an earlier one's, in µs a message. For resize it is µs per message of 3 layouts. A page's number is the faster of its 2 passes. I give the median, then [smallest..largest], then how many of 12 rounds the later checkout was faster.
- **c1, c2, c3**: the owner's 4f584bf, 615e86c and 35434cf, cumulative, each with my fix (section 2).
- **tip**: af52d1c plus the fix.
- **m1**: my scan change on c3 (section 7).
- **P1, P2**: my two exclusive stretches in pinned Firefox 156, background window, device pixel ratio 2.
  - P1 ran 13:23 to 13:32. The 1-minute load went from 46 to 28. It was quiet.
  - P2 ran 14:10 to 14:16. The load went from 69 to 104, from other agents' offline work. Its spreads are ten times P1's, so it can only show large effects.
  - A third stretch waited 90 minutes for a load under 45. None came, so I did not run it.

### 1. Verdict per commit

| commit | verdict | why |
|---|---|---|
| 4f584bf, the piece's own script from its first character | MERGE AFTER A CHANGE. The change is fa0d018 on the branch. Its twin b4f56e2 is for a line without af52d1c. | The gain is confirmed. But it changed a Canvas question (section 2). |
| 615e86c, properties of U+0000 to U+00FF by index | MERGE | The gain is confirmed. Every exported function of `props.ts` is equal over U+0000 to U+10FFFF and on NaN. An assertion run showed no caller hands in a negative or fractional code point. That is the one input where the table and the search differ. |
| 35434cf, the spacing step walks the frames | MERGE, with my rename 1a50610 (twin e8ac1da) | It gives no time, inside the spread, as the owner said. It removes 8 lines, two arrays and a binary search. The reasoning: frames tile the transformed text in order, and `f.textRun` is the build's index. The attack compared the three spacing arrays field by field. The only flaw: its outer loop index `k` is shadowed by the inner loop over a cluster's marks 40 lines below. |
| ed112a4, the owner's tools | MERGE | Tools only. They hold no temporary path. tsc is clean and the import rules pass. |
| af52d1c, optional slices | LEAVE OUT | It gives no time in my pairs either. It keeps `tText` as a second form of `tUnits`. The engineering guide asks for one source of truth and no derived fields. |

Library lines for what I would merge (the three kept commits, the fix and the rename): +28 -28. The only state is the owner's 256-number table.

### 2. What was wrong: 4f584bf asks another question at a cut surrogate pair

The owner's loop reads the piece's script "in place" through `scriptAt`. `scriptAt` joins a high surrogate with `units[i + 1]` whatever the piece's end is. Base ran the itemizer on a view of the piece. The itemizer stops a pair at the end (`scriptLimit < end - 1`).

The transformed text of every text run is one array. So this happens when a text run ends with a lone high surrogate and the next run starts with the low one. That is a node boundary with another font or another `word-break` inside a pair. It could be an app that splits rich text by UTF-16 index inside a rare Han character. The head then sees a Han character and asks the piece alone. Base sees a lone surrogate with no script and puts a character of the run's script in front.

My tool printed this: `questions(fill 1)[20] after 2 measure "漢\ud840": 0 measure "漢 \ud840" -> 0 measure "\ud840"`.

- It differed on 4 of 3,358 attack paragraphs, plain and inspected (runs/attack-base-vs-35434cf.log).
- Tier 1 can't see it. No recorded case holds a pair cut by a text-run boundary. The owner's per-commit tier 1 logs are truly 0/0.
- Nobody has asked Firefox what is right there. The fix restores base's question, which is the rule.

The fix, in the form without af52d1c (b4f56e2; fa0d018 is the same over `text: string`):

```diff
-function scriptAt(units: Uint16Array, i: number): string {
+// The script of the character at `i` of units read up to `end`: a surrogate pair that `end` cuts is a lone surrogate, as
+// it is to the itemizer (scriptRunLimits).
+function scriptAt(units: Uint16Array, i: number, end: number): string {
   const u = units[i]!
   if (u < 0x02ea) return fastLatin(u) ? 'Latn' : 'Zyyy'
-  return scriptOf(isSurrogatePair(u, units[i + 1] ?? 0) ? combine(u, units[i + 1]!) : u)
+  return scriptOf(i + 1 < end && isSurrogatePair(u, units[i + 1]!) ? combine(u, units[i + 1]!) : u)
 }
@@
-  for (let i = tStart; i < tEnd && isCommonScript(alone); i++) alone = scriptAt(units, i)
+  for (let i = tStart; i < tEnd && isCommonScript(alone); i++) alone = scriptAt(units, i, tEnd)
@@ (the two context searches keep base's reads)
-    if (scriptAt(units, i) !== domScript) continue
+    if (scriptAt(units, i, units.length) !== domScript) continue
```

It is +7 -5 lines, 2 of them comment. Its unit test is `rebuild/src/engines/gecko/split-pair.test.ts`. I checked the test in scratch copies: it passes on base f74643e, fails on the owner's 35434cf, and passes with the fix.

A smaller point on the same commit. The clause `alone === 'Hira' && domScript === 'Kana'` states the itemizer's Hiragana-as-Katakana rule a second time. I would name that rule in the comment. It is exact as written.

### 3. Timings, my method (P1; bench/P1/firefox-probes.json, P1-summary.txt, P1-rounds.txt)

The tool is `rebuild/tools/prof-critic-probe.ts`, 12 rounds, 10,000 messages. Pair differences in µs a message; resize is per message of 3 layouts.

| | scratch ASCII | scratch mix | resize ASCII | resize mix | the owner's wall numbers |
|---|---|---|---|---|---|
| c1 | -1.80 [-3.90..0.10] 11/12 | -12.20 [-17.00..-7.70] 12/12 | -7.15 12/12 | -7.20 12/12 | -3.55, -11.94, -3.70, -4.59 |
| c2 | -1.75 [-3.60..3.30] 11/12 | -2.00 [-5.90..5.00] 10/12 | -3.10 11/12 | -2.45 12/12 | -1.60, -2.62, -2.73, -2.25 |
| c3 | -0.25 7/12 | -0.60 9/12 | +0.25 6/12 | +0.45 3/12 | inside the spread |
| tip against c3 | +0.50, 3/12 faster | -0.90 10/12 | 0.00 | -0.45 | the same finding |
| base to c3 | -3.55 [-8.40..0.10] 11/12 | -13.90 [-21.50..-6.00] 12/12 | -10.50 12/12 | -9.45 12/12 | -5.5, -11.7, -6.1, -7.35 |

- Confirmed: c1 and c2 in all four columns.
- Inside the spread: c3 and the optional tip.
- The two methods agree on the mix and on c2. They differ on c1's ASCII and on resize.
  - The likely reason is this. In the owner's one page every checkout shares one heap, and base's per-question garbage costs more there. Its base ASCII is 500.7 ms. Mine is 462 ms in a fresh page. After the commits both methods give about 445 ms.
  - Both methods say gain. Quote a range.
- P1's first five rounds ran under a higher load. In its quiet half a page costs:

| ms per 10,000 messages | base | c3 |
|---|---:|---:|
| scratch ASCII | 455 | 418 |
| scratch mix | 880 | 740 |
| resize ASCII | 645 | 550 |
| resize mix | 670 | 580 |

- P2 (bench/P2-summary.txt) still shows base slower than c3 on resize ASCII in 12 of 12 rounds. Base is also slower on scratch and on resize mix in 10 to 11 rounds. Every smaller pair is inside P2's spread of ±20.

### 4. The split, by a method the owner didn't use

P1's `repeat` section ran on base. A Canvas wrapper asks the real one every question k = 1, 2, 3 times and reads each width. The slope over k is what the pass's calls cost in the browser. Nothing is recorded or replayed.

| base, per 10,000 messages | real pass | k = 1, 2, 3 | slope | share of the real pass | per call |
|---|---:|---|---:|---:|---:|
| scratch ASCII | 468.5 ms | 473.0, 677.5, 887.5 | 206.5 ms [193..228] | 44.1% | 218 ns over 945,389 calls |
| scratch mix | 880.5 | 888.5, 1257.0, 1643.5 | 377.5 | 42.9% | 286 ns over 1,319,033 |
| resize ASCII | 647.5 | 628.0, 878.0, 1112.5 | 234.5 | 36.2% | 220 ns over 1,066,639 |
| resize mix | 699.0 | 657.5, 890.5, 1147.0 | 237.0 | 33.9% | 238 ns over 996,621 |

- The steps are linear: 204.5 and 210.0, 368.5 and 386.5.
- The call counts equal the owner's recordings to the last call.
- My slope agrees with two of the owner's three methods: the profiler (measureText self 42.1%) and the recorded calls alone (203 ms and 414 ms per 10,000).
- The owner's headline of 52% and 54% is the stand-in difference. That is a different quantity: everything that vanishes when calls are free. It also counts the TextMetrics objects, the flattening of built strings, the reads of the answer and the call overhead.
- So report two numbers:
  - **Inside Canvas, from scratch:** 42 to 44%.
  - **Inside Canvas, on a resize:** 34 to 36%.
  - **Gone with a free Canvas:** 52 to 54%.
- For ranking: removing one question saves 0.22 µs (ASCII) to 0.29 µs (mix) in the browser. It saves up to 0.26 to 0.37 µs where the JS that builds and asks the string goes too.

**The floor.**
- The stand-in's time is a lower bound on own JS. Its trivial measureText is inlined away.
- The real pass minus my slope is an upper bound. A first ask costs at least a repeat.
- Base own JS therefore lies between 235 and 262 ms (ASCII) and between 428 and 503 ms (mix).
- After the kept commits it lies between about 190 and 227 ms, and between about 310 and 364 ms.
- The owner's floor stands as the number no removal of questions can beat.
- P2's `floor` section held three stand-ins against each other: one ignores the string, one reads its length, one reads its last unit and so flattens it. They differed by -8 to +17 ms with spreads of ±100. So there is no sign that the stand-in hides string building. That stretch was loaded.

### 5. Exactness

- **Full gates, `--engine=gecko`, on the worktree at f6c9ae4.** This is the owner's five commits plus everything of mine. 593.5 s. Log: runs/gates-full-tip-ba4b068.log, named for the commit it was queued at.
  - 16 of 18 gates exit 0.
  - tsc ×6 has 0 errors. Unit tests: 70 files, 893 pass, 0 fail. Citations: 0 lost.
  - Tier 1, no-facts and facts: 63,771 cases, 0 predictions changed, 0 questions changed, 0 for tier 2.
  - Plain ×2, pure ×2 and sweep ×2: 63,771 pass each.
  - The 2 painter gates exit 2. That is a tool failure, not a finding. The shared `.artifacts/tests/painter-frozen/*.js` were bundled again at 13:07 by the main line (its e308f89). This branch's `rebuild/tools/painter-frozen.json` pins the bundle of 24cede2. Frozen references aren't mine to touch. Rerun the painter gates after the merge.
- **The line without af52d1c**, from scratch copies at low priority.
  - d1280be: tsc 0, `bun test rebuild/src` 418 pass, tier 1 in both configurations exit 0 with 0/0 (runs/check-d1280be.log).
  - 260f0ed, which adds m1: tier 1 0/0 (runs/check-260f0ed.log). Its one unit failure is the 5 s timeout of the props test under load, the one the owner reported. Alone it passes.
  - The tags now point at 587170c and 9e2c70c. Their `rebuild/src` is identical to these two trees; they add only a tool file.
  - Plain, pure and sweep were not run separately for this line.
- **The attack**, `rebuild/tools/prof-critic-attack.ts`. It runs two checkouts in lockstep over the stand-in Canvas. It compares four things:
  - every context made, every attribute set and every string measured, in order;
  - the prepared paragraph field by field, after prepare and after every fill;
  - every fill result, its pieces and its inspection;
  - error messages.
  - It also compares every exported function of `props.ts` over all of Unicode.
  - The paragraphs: 99 edge texts × 5 styles, surrogate pairs cut by node boundaries, per-span spacing, bidi, tabs, only spaces, every break mode, a 100,000-unit paragraph, a 4,000-unit unit, and seeded random trees.
  - Results:
    - Base against 35434cf + fix: 0 differ over 3,633 paragraphs, 22,772 layouts and 2,824,838 questions. A second seed gave 0 differ over 6,633 paragraphs and 5,191,376 questions.
    - Base against tip + fix, ignoring `tText`: 0 differ.
  - Mutation test: three one-token mutants were each caught, with 828, 6 and 4 differences.
  - Limit: the stand-in's answers aren't Firefox's. Equality means the same computation and the same questions. That is what "free" means here.

### 6. The engineering guide on each diff

- **4f584bf** does less work: no view, no itemizer run, no arrays. A reader can follow it. It restates two itemizer rules outside the itemizer, and the comment names only one. It read past its piece; that is fixed.
- **615e86c** is one table of fixed data with the page's lifetime. The phase's rule allows that. It is plain.
- **35434cf** is simpler than before. Derived data is computed and gone. It needs the index rename.
- **af52d1c** adds a second representation and gives no time. Leave it out.
- **ed112a4** has no hidden state. It is configured by environment variables, as the other probes are.

### 7. What it missed

1. **The break scan reads each candidate's advance twice.** `breakAndMeasureText` asks `scanAdvance(pending, i)` at every candidate, and every word boundary is one. The start of each step is the end of the step before. So the whole chain runs twice per offset: `scanOffset`, `groupAround`, `glyphBefore`, `advanceBefore`, `windowAt`, `entryAt`.
   - The owner's suspect list has nothing from this chain but the two-field objects.
   - Under bun, the chain is the top of the resize profile: glyphBefore 29.8% inclusive, advanceBefore 8.1% self (bench/bun-k3fix-latin-resize).
   - d87ed53 carries the value in a local of the one call. It is FREE in kind: +16 -3 lines, no state beyond the call.
   - The same questions are asked in the same order. With `consulted` ignored, the attack shows 0 differences.
   - Without ignoring anything, the inspected line's `consulted` list loses duplicates only: 452 paragraphs differ, all at `consulted.length`. `gaps.ts` reads that list's minimum past the line's end. Tier 1 is 0/0.
   - Gain in P1: resize -3.05 [-6.60..5.20] 11/12 and -3.75 [-9.30..-2.60] 12/12. That is about 7% of a resize in the quiet half. Scratch ASCII -0.90, 10/12. Scratch mix is inside the spread.
   - P2, loaded, says nothing either way. So this rests on one quiet stretch.
2. **Property reads past U+00FF.** The owner profiled ASCII only.
   - I counted under bun over 2,000 messages. ASCII does 115 reads a message, all by the new table. The mix does 126 reads by table and 147 by binary search. A CJK message does 1,769 searches, an Arabic one 213.
   - Going by the owner's own measured saving per read, that is about 2 µs a message on the mix and about 24 µs on a CJK message.
   - A candidate grows the table to the whole BMP. It is 256 KB of fixed data filled run by run, +3 -2 lines. It is exact over all of Unicode, and the attack shows 0 differences.
   - It is NOT timed. It needs state, 256 KB for the page's life. The patch is bench/scratch-bmp-props-table.patch.
3. **Holes in the owner's profile.** It has no function table for the resize and none for the mix in SpiderMonkey. Its top 25 is scratch ASCII only. Its headline share is the stand-in's (section 4).

### 8. Three sentences for the maintainer

1. The three kept commits are real and cheap: in my own fresh-page pairs they take about 3.5 µs a message off plain ASCII, 14 off the mix and 10 off a message of three relayouts, nearly all from the script check, with the property table worth 2 to 3 and the spacing commit worth nothing but its 8 lines.
2. One was not exact: reading the piece's script in place read one unit past the piece, so a surrogate pair cut by a text-run boundary asked Canvas another string than before; my differential found it, tier 1 can't, and with a 3-line fix and a unit test 5 million questions and every prepared field and line equal the base's and the gates pass, all but the painter differential, which could not run in this worktree.
3. Firefox spends 42 to 44% of a pass inside Canvas, measured three ways, and not the 52% headline, which is what vanishes with a free Canvas; the fill's scan read each break candidate twice, and reading it once takes another 3 to 4 µs off a message of three relayouts (one quiet confirmation, offered as the last commit); the big item is still the owner's R1, which changes questions.

### 9. For the merge

- **`prof-gecko-critic-kept`** is a ready line without af52d1c: a local tag, 587170c. It holds the owner's 4f584bf, 615e86c, 35434cf and ed112a4, then b4f56e2 (fix and test), e8ac1da (rename), and my tools 73bb63e, d1280be and 587170c.
- **`prof-gecko-critic-kept-and-scan`** (9e2c70c) adds m1.
- I made both by git plumbing; the working tree was never touched.
- `git diff prof-gecko-critic-kept-and-scan x-prof-gecko` is exactly af52d1c's five files.
- If you cherry-pick from `x-prof-gecko` and skip af52d1c, then fa0d018 and 1a50610 conflict. Use their twins b4f56e2 and e8ac1da.
- Rerun the painter differential on the merged tree.
- DESIGN.md wants two things, given here as text:
  - The owner's sentence on the 256-entry table.
  - If m1 is taken, one sentence in §4.6's Gecko bullet: a break scan carries the advance before its pending text in a local (`lines.ts` `pendingBefore`), so an inspected line's `consulted` list holds a stand-in offset once per scan where it held it twice.
- I edited no .md file.
- The owner's local tags prof-gecko-backup-1 to -4 can go. So can mine after the merge.

## A second look at the WebKit profile and its four changes (key: prof-webkit-critic, 2026-09-20)

Same worktree and branch as the owner: `~/github/pretext-rebuild-wt/prof-webkit`, branch `x-prof-webkit`. The owner's head is 0cb23db (base f74643e). I added five tool commits on top and changed nothing of the owner's. Nothing is merged or pushed. Bench files are under `~/github/pretext-rebuild/.artifacts/bench/prof-webkit-20260920/critic/` ("bench/" below). Test runs are under `~/github/pretext-rebuild/.artifacts/tests/runs/prof-webkit-20260920/critic/` ("runs/" below). The running log is `.progress-prof-webkit-critic.txt` in the worktree.

Names used below:
- "checks" is 3639e00: the font checks find a declaration's contexts once.
- "family list" is b7a870c: names cut out in stretches.
- "segmenter" is 26e7a2e: one kept word segmenter.
- "plain stretch" is 1553c42 with its test 0cb23db: a line's leading plain items committed by sums.
- "latin" is the bench's plain ASCII set, "the mix" its mixed set.

### 0. Verdicts

| commit | lines in `rebuild/src` | what the owner claimed | what I measured in fresh pages | verdict |
|---|---|---|---|---|
| 3639e00 checks | +12 -3 | mix -0.62 µs a message, latin -0.32 | mix -0.35 µs (14 of 16 rounds) and -0.17 (9 of 14); latin -0.27 (13 of 16) and -0.10 (10 of 14). Real in direction (23 of 30 rounds pooled, both sets), half the claimed size on the mix, at the edge of the spread taken alone | merge with the next one; it sends Chrome's storage-sensitive cases to tier 2 at the merge |
| b7a870c family list | +19 -9 | mix -0.53, latin -0.18 | mix -0.30 (13 of 16) and -0.11 (8 of 14); latin -0.37 (14 of 16) and -0.20 (10 of 14). The two together: mix -0.61 µs (-4.1%, 15 of 16), latin -0.62 µs (-5.4%, 16 of 16) | merge; as a pair they are outside the spread |
| 26e7a2e segmenter | +7 -1 | Thai 48.2 to 19.6 µs a message | 46.2 to 20.1 µs (-26.7 µs, -57.9%, 14 of 14 rounds, middle half -27.0 to -25.9); nothing on the mix or latin | merge after a change: its comment and `let` sit inside another function's comment (diff in section 6) |
| 1553c42, 0cb23db plain stretch | +58 -4, test +17 | from scratch mix -1.27 µs, latin -1.41; a kept message's layout mix -0.99 µs, latin -1.10 | latin from scratch -1.47, -1.44, -1.69 µs (53 of 54 rounds). Layout of a kept message: mix -0.99 and -1.01 µs (39 of 40), latin -1.12 and -1.11 (40 of 40). Mix from scratch, warm passes: -0.45, -0.45, -0.14 µs (36 of 54 rounds): NOT confirmed at the claimed size, inside the spread. Mix, a fresh page's first pass: -1.38, -0.79, -1.18 µs (52 of 54) | merge after a change: a one-line guard (section 6). Whether a second path is wanted is the maintainer's call; the numbers and the proof are sound |

Head against base in fresh pages:
- Latin goes from 113.8 to 91.7 ms per 10,000 (-19.1%, 16 of 16 rounds), and -15.5% (14 of 14) in a second run. The owner had -20.3%.
- The mix goes from 149.2 to 138.3 ms (-8.1%, 15 of 16), and -5.9% (13 of 14) in a second run. The owner had -13.9%.
- So the latin headline stands and the mix headline is about half of what was claimed.

The three sentences for the maintainer:

1. The plain stretch is exact: full gates green in the real worktree, 63,987 paintings the same, 61 million compared steps and 750,000 boundary widths without a difference. It is worth what was said on plain ASCII and on every relayout (a kept message's layout goes from 2.06 to 0.95 µs), but on the mix from scratch it gave a third of the claim in warm fresh pages, so quote -8% for the mix, not -14%.
2. The segmenter is a clear win for Thai (46 to 20 µs a message); the two font changes are worth 0.6 µs a message only as a pair, and the first of them costs Chrome a tier 2 run at the merge.
3. Merge the segmenter after moving its comment, and the stretch after a one-line guard for a block of `break-spaces` (its comment's claim is false there, though no output differs). After it, nine tenths of a kept message's layout is what a line costs (0.3 µs a line), not what an item costs. That, with the font checks (a quarter of from scratch), is what is left.

### 1. The timings again, in fresh pages

**Method** (`rebuild/tools/own-js-fresh-pages.ts`, `own-js-fresh-summary.ts`, mine). The owner's page holds every library at once, and it found two copies of one tree 2% apart there. My pages hold ONE library each.

- A page is a fresh document in webkit-host. It fetches one tree's bundle and the messages.
- It runs the mix and latin from scratch in turn: 10,000 messages, 320 px, one list of contexts a pass. The first pass of the mix compiles the library and is reported apart as "first pass". Then come 5 timed passes each.
- It then lays 3,000 kept messages out again at 260, 380 and 440 px, 5 times.
- A page's time is the median of its 5 passes.
- A round is one page of every tree in turn (base, checks, family list, segmenter, plain stretch). The start moves one tree a round. So a round's difference between two trees is an alternating pair in fresh pages.
- "Spread" is how far two pages of ONE tree in neighbouring rounds lie apart (the median of those distances).
- All runs held the exclusive lock.

| run | what | rounds | load (1 min) | spread, mix and latin | file |
|---|---|---:|---|---|---|
| timed-1 | five trees; Thai, segmenter against the tree before it | 14; 14 | 43 to 48 | 3.5 to 7.3 ms; 1.7 to 5.2 ms | `bench/timed-1/a/summary.txt`, `timed-1/th/summary.txt` |
| timed-2 | five trees | 16 | 39 to 47 | 1.8 to 3.8 ms; 1.3 to 2.9 ms | `bench/timed-2/a/summary.txt` |
| timed-5 | plain stretch against the tree before it | 24 | 64 to 80 | 5.5 to 5.9 ms; 2.5 to 4.5 ms | `bench/timed-5/summary.txt` |
| timed-4 | the same, 24 passes a page | 8 | 86 to 90 | too loaded: passes in one page swing by 40 ms | `bench/timed-4/summary.txt`, `trend.txt` |

Differences per 10,000 messages from scratch, median of the rounds (rounds that went the change's way; the middle half):

| change against the tree before it | timed-2, mix | timed-2, latin | timed-1, mix | timed-1, latin |
|---|---|---|---|---|
| checks | -3.48 ms (14 of 16; -6.00 to -0.40) | -2.68 ms (13 of 16; -4.58 to -0.66) | -1.71 ms (9 of 14) | -1.02 ms (10 of 14) |
| family list | -2.97 ms (13 of 16; -4.52 to -0.59) | -3.71 ms (14 of 16; -5.63 to -3.04) | -1.11 ms (8 of 14) | -2.01 ms (10 of 14) |
| the two together, against base | -6.12 ms (15 of 16; -7.76 to -2.64) | -6.19 ms (16 of 16; -8.02 to -4.85) | -3.40 ms (10 of 14) | -3.75 ms (11 of 14) |
| segmenter | -0.03 ms (8 of 16) | +0.45 ms | -1.78 ms (9 of 14) | -0.22 ms (7 of 14) |
| plain stretch | -4.47 ms (12 of 16; -8.55 to -0.74) | -14.68 ms (16 of 16; -16.37 to -12.72) | -4.46 ms (10 of 14) | -14.37 ms (14 of 14) |
| head against base | -12.09 ms (15 of 16), -8.1% | -21.76 ms (16 of 16), -19.1% | -8.58 ms (13 of 14), -5.9% | -17.14 ms (14 of 14), -15.5% |

timed-5, plain stretch alone, 24 rounds:
- mix -1.43 ms (14 of 24; middle half -5.93 to +2.21)
- latin -16.86 ms (23 of 24)
- the mix's first pass in a fresh page -11.82 ms (23 of 24). timed-2 had -7.91 ms (15 of 16) and timed-1 had -13.84 ms (14 of 14).

9,000 layouts of kept messages (timed-2; timed-1's are void, see section 7):
- The plain stretch takes the mix from 24.58 to 15.00 ms (-0.99 µs a layout, -36.4%, 16 of 16).
- It takes latin from 18.57 to 8.57 ms (-1.12 µs, -54.1%, 16 of 16).
- timed-5 has -1.01 µs (23 of 24) and -1.11 µs (24 of 24).
- The three other changes move a layout by under 0.04 µs, which is nothing.

**Thai** (timed-1's second part, 1,000 messages, pages of about 0.3 s): 46.15 to 20.10 ms (-26.7 µs a message, -57.9%, 14 of 14 rounds, range -28.0 to -24.3). A layout of a kept message doesn't move.

**What I can't explain.**
- The mix from scratch gains 4.5 ms per 10,000 from the plain stretch in warm fresh pages, twice, and 1.4 ms in a third run.
- Latin gains 14 to 17 ms every time. The same warm pages' mix relayout gains 10 ms per 10,000 layouts.
- About 83% of the mix's messages take the stretch, so 10 ms was to be expected.
- The owner's one-page rounds have 12.7 ms in 20 of 20 rounds with no fade (I read its rounds one by one).
- A fresh page's first mix pass, which compiles, has the full gain (8 to 14 ms, 52 of 54 rounds).
- So what an app gets on the mix from scratch is between 0.14 and 1.3 µs a message, depending on how warm and how crowded its page is.
- It is not the fill: the relayout gain is there in the same pages. I didn't find what takes the rest back.

### 2. Exactness

- **Full gates for the engine, in the real worktree at the owner's head** (`runs/gates-full-head-0cb23db.log`, `bun rebuild/tests/gates.ts --engine=webkit`, 420 s):
  - Tier 1 webkit-host exits 0 in both configurations: 63,987 cases, 0 predictions changed, 0 questions changed (0 repeats, 0 dropped, 0 other, 0 new), 0 for tier 2.
  - The function set's plain, pure and sweep exit 0 in both configurations (63,987 pass, 0 fail, 0 skipped).
  - tsc over the six projects exits 0. Citations exit 0 (0 lost).
  - The run's exit is 1 for two reasons that aren't the commits'. First, 4 unit tests timed out at 5 s under load (`lab/rows` twice, a hook of `lab/compare-rows`, `tests/families`). They pass alone with the WebKit, font-family and measure tests (159 pass, 0 fail, `runs/unit-tests-rerun.log`). Second, the painter differential's tool refused to run (next point).
- **Painter differential.**
  - The shared `.artifacts/tests/painter-frozen/*.js` were bundled again at 13:07 today for the main line. This branch still pins the earlier bundle, so the tool exits 2 here.
  - I ran it from the main tree (bcf3f1b, whose pin matches) with `--tree=<this worktree>` as the working side.
  - webkit-host no-facts and facts exit 0: 63,987 painted on both sides, 63,987 the same (`runs/painter-diff-head.log`).
- **All engines, quick** (`runs/gates-quick-all-head-12fc749.log`, at the head with my tool commits, 44 minutes under a load of 100):
  - webkit-host and Firefox tier 1, plain and pure exit 0 in both configurations (63,987 and 63,771 cases the same, 0 questions changed).
  - Its unit-test row has 7 timeouts at 5 s, the owner's new test among them (7.6 s there, 0.2 s alone). That test prepares and inspects 1,736 paragraphs where 4 prepares would do, since only the width changes. It runs inspected paragraphs only; the plain path is held by the function set's plain check and by my attack.
  - **Chrome's tier 1 exits 1, and it is not these commits.** The shared Chrome reference was frozen again at 7f077ac, which is not in this branch's history. It is 36 commits past the base, among them Blink's wide-group-cut change. So an older Blink port is held to a newer recording.
  - The differences: 14 predictions changed (`layout.gaps[].at.start` in `ws/trailing-space-edge`, `layout.gaps[].run`), 9,222 cases with other questions, 19,519 with new ones.
  - `git diff f74643e..HEAD` touches no file under `engines/blink` or `engines/gecko`. The owner's run at 11:37 against the earlier reference had 0 and 0.
  - Chrome's tier 1 for the two shared-file commits has to be run again after the branch sits on the new main.
  - To be sure, I ran Chrome's tier 1 on a copy of the BASE against the same new reference. It gives the same counts. The two reports are identical but for the library's commit and the storage rule's file list (`runs/tier1-chrome-no-facts-BASE-f74643e.json`, `tier1-chrome-no-facts-HEAD-915ba7b.json`, 10.7 MB each). So against their base the four commits change no Chrome prediction and no Chrome question.
- **The attack the recorded cases don't hold** (`rebuild/tools/own-js-attack.ts`, mine). Two checkouts run in one process under the stand-in Canvas, base against the owner's head. Everything is compared as text, with -0, NaN and the infinities kept apart.
  - *Family lists.* Hand-made edges (unclosed strings, a last backslash, escaped newlines, six-digit and surrogate escapes, every CSS white space, NUL, a lone surrogate) and 300,000 seeded random lists. 300,051 lists, 54,991 rejected by both trees with the same error, 0 differences (`runs/attack-families.log`).
  - *Fill: 25,592 paragraphs.*
    - 31 texts: empty, one space, only spaces, a newline, lone surrogates, NUL and controls, soft hyphens, U+200B, emoji sequences, CJK, mixed direction, Thai with a range that starts with a mark, Lao, Khmer and Burmese, URLs, hard and doubled spaces.
    - Eight structures: one text node, two, a span without edges, a padded span, a code span, `<br>`, `<wbr>`, an atomic inline.
    - Every `white-space` x `overflow-wrap` x `word-break` x `line-break` value (360) over every text, in the two structures the simple builder takes.
    - A span whose `white-space` isn't its block's (30 pairs).
    - Letter and word spacing of both signs, rtl, indent, justify, four languages, tab size 0, given facts, 13 family lists.
    - Four giants of 100,000 units.
    - Each ran plain and inspected, with a list of contexts a paragraph and with one list for all. Widths: 12 (0, 1, 7, 33.3 ... 1e9, -10, Infinity, NaN) and a slot with insets.
    - Each ran under the stand-in as it is and with `--grain` (every width times 1.0371, rounded to float32, so sums round at every step).
    - Compared: every context made and every question in order, every `fillLine` result whole, `linePieces`, `inspectLine`, `paragraphGaps`.
    - Result: 61.3 million steps, 0 differences, 0 throws (`runs/attack-fill/*.log`).
    - Two of the sixteen shards ran their inspected half with giants of 3,000 units. Inspecting the lines of one unbroken word grows faster than its square in both trees (2 s at 2,000 units, 67 s at 8,000). That is the lab's path and not these commits'.
  - *Boundaries.* For every line start a layout reaches and every item after it, I built the line widths at which the item, and the item with the next one, fit exactly, plus six float32 steps on both sides. This ran in 38 shapes: one text node, and every block and span `white-space` pair. 363,714 widths, and with `--grain` 386,550: 0 differences (`runs/attack-boundaries.log`, `attack-boundaries-grain.log`). NaN and infinite widths agree too (both trees keep everything on one line).
- **One finding, by reading, that no output shows.**
  - `commitPlainStretch`'s comment and DESIGN.md §2.9 say each plain item "is a candidate of its own".
  - That is false under a block with `white-space: break-spaces` around one span that collapses spaces. There the range based builder runs the simple builder under the BLOCK's style.
  - `isAtSoftWrapOpportunityOrContentEnd` answers `hasWrapOpportunityBeforeWhitespace`, which is false there, for a word before a space. So the builder takes the word and its space as one candidate, tests their sum, and puts only the space on its wrap opportunity list. The stretch tests the two apart and lists both.
  - No line differs on 386,550 boundary widths, for two reasons nobody wrote down. A trailing collapsible space never decides a fit (the breaker keeps it as trimmable). And a word's kept width is W(word + space) - W(space), so adding the space back gives the measured total exactly.
  - It holds by luck of those two facts.
  - The guard in section 6 makes the comment true. With it the boundary attack still has 0 differences on 386,550 widths (`runs/attack-boundaries-grain-c7g.log`) and the 74 tests of `lines.test.ts` pass.

### 3. The split, by a method it didn't use

The owner timed every `measureText` from inside a wrapper, and answered from a Map. My method:
- Record one pass's questions: the context object and the string, in order.
- Call the real `measureText` with them again, on the same contexts in the same order, with nothing of the library between two calls.
- Take off the same loop run with a call that asks nothing.

It has no timer and no wrapper inside the library's pass. It is a LOWER bound of Canvas in place, because calls back to back keep Canvas's code and data in the processor's caches.

timed-2, medians of 5 passes, 10,000 messages (`bench/timed-2/a/summary.txt`):

| | pass | questions | asked again | Canvas at least | own JS at most | the owner's two methods |
|---|---:|---:|---:|---|---|---|
| base, latin | 118.3 ms | 316,552 | 42.6 ms (loop 2.4) | 40.3 ms, 127 ns a call, 34% | 66% | 127 ns a call; own JS 61 to 65% |
| base, mix | 152.7 ms | 402,147 | 53.9 ms (loop 3.4) | 50.5 ms, 126 ns a call, 33% | 67% | 171 ns a call; own JS 57 to 59% |
| head, latin | 95.4 ms | 316,552 | 44.3 ms | 42.1 ms, 133 ns a call, 44% | 56% | |
| head, mix | 133.8 ms | 402,147 | 55.6 ms | 53.1 ms, 132 ns a call, 40% | 60% | |

- **Latin: confirmed to the nanosecond.** 127 ns a call by its timed method and by mine; 34 to 35% Canvas.
- **The mix: bracketed.**
  - Asked back to back the mix's calls cost 126 ns. In place they cost 171 ns by both of the owner's methods.
  - I tested whether a pass's 11 NEW contexts explain it (their glyph lookups start empty). They don't. The recorded questions cost the same of contexts made anew: 144 against 139 ns a call, and both ways in three more pages (`bench/timed-3`, load 85 to 92).
  - So the difference is calls in place against calls back to back, which the mix's Core Text calls feel and latin's don't.
  - The owner's split stands: Canvas is 33 to 43% of the mix and own JS 57 to 67%.
- After the four commits own JS is at most 56 to 60% of a pass. The owner's headline share (57 to 66%) is the base's.
- A small error in its method note. The Map method leaves the hashing of each fresh slice in OWN JS, not in the Map's share, because the Map alone is asked again with strings whose hash is kept. So its own-JS floor is an upper bound by about 0.2 µs a message. It doesn't change a conclusion.
- The floor (section 8 of its report) agrees with my upper bounds. Mine: own JS at most 7.8 µs (base) and 5.3 µs (head) a latin message, 10.2 and 8.1 on the mix. Its: 6.72, 5.24, 9.16 and 7.42.

### 4. The engineering guide on each diff

- **checks (+12 -3).**
  - It is a list on the call's own `Probe`, gone with the call: data flow, not a cache. It is a second small memo beside `resolution.asked`.
  - I looked for the form the guide prefers (compute the shared part before its users). It is worse here. The two generic lists are shared by two checks, so without the memo a declaration still looks up 9 contexts, and with it 4.
  - A reader follows it.
  - Its cost is outside the code: `font-checks.ts` is under `rebuild/src/measure`, so Chrome's storage rule sends its cases to tier 2 at the merge.
  - It buys nothing once a caller gives `primaryFamily` and `monospace`, or the checks' answers are kept.
- **family list (+19 -9).**
  - The same scan, with slices in place of a string grown letter by letter. One path, no state; as simple as before, ten lines longer.
  - 300,051 lists agree.
  - What it speeds up is a list parsed twice per `prepare` for every message. PROFILING-START.md already gives that to the API phase ("read once, at the library's boundary"). Then this gain is per declaration, not per message. Harmless to keep.
- **segmenter (+7 -1).**
  - One module-level `Intl.Segmenter`, made at first use. Its lifetime is the page. Nothing invalidates it (the default locale doesn't change under a page). It is bounded at one and holds no text.
  - The port already keeps decoded tables the same way (`joining.ts` `ranges`).
  - The flaw is layout. The new comment and the `let` were put between `addDictionaryBoundaries`'s comment and the function. So that comment now reads as the variable's and runs into the new one without a break.
- **plain stretch (+58 -4).**
  - No state. It is a second path through one stretch of the fill, which the guide warns about ("branches lower the cost of best-case scenarios").
  - Here the best case is the common one (every one-box paragraph, about 83% of the mix). The other case pays one length test a line.
  - What it costs later: it mirrors `appendTextFast`, `expandRun` and `updateTrailingContent`, so an edit to any of the three has to be made twice.
  - Its unit test holds line ranges and content widths only, not the run, the trimmable content or the wrap opportunity list. `own-js-attack.ts` holds all of those between any two trees and is the check to run after such an edit.
  - A reader can follow it. The `f32(0 + x)` forms look like noise and are right. They are the builder's `run.left + run.width` with a left of 0, kept so a width that isn't a float32 rounds where the builder rounds it.
  - Its comment's claim needs the guard.
- The three tool commits hold no temporary path and no name they shouldn't.

### 5. What it missed

1. **After the stretch a kept message's layout is what its LINES cost.** Measured under bun, one tree a process, 3,000 kept latin messages (`bench/per-line-bun.txt`).
   - Base: 1.8 µs a layout at 1 line, 2.3 at 3.1 lines, 3.6 at 8.1 lines. That is 0.25 µs a line and 38 ns an item.
   - Head: 0.41, 1.0 and 2.6 µs. That is 0.30 µs a line, and 0.11 µs for all 41 items.
   - At 320 px nine tenths of a layout is per-line cost. Main's whole layout is 0.24 µs.
   - Its report names `lineRect` (a tenth) and stops at "1% of the from-scratch wall". But relayout is the other headline.
   - Where a line's 0.3 µs goes, from its own head profile (`cpuprof/latin-relayout-head.cpuprofile`, shares of the fill):
     - The item that ENDS a line goes through the general breaker: a 12-field `Content`, a `LineStatus`, three result objects. `process` is 27%.
     - `lineRect` is 11%.
     - `newLine`, the `Builder`, `Layout`, `Placed`, the filled line and the next start with its `previousLine` are about 25%.
   - A fix of the first would be a third path, which I don't recommend.
   - The rest is the shape of `fillLine`'s result, so it is the API phase's. A walk that returns ranges and allocates nothing per line is main's reason for 0.24 µs. Only its per-item half was taken back.
2. **The mix's from-scratch gain isn't what the one-page rounds say** (section 1), and with it the headline -13.9%.
3. **Its own share figure is the base's.** At the head Canvas is 40 to 44% by the lower bound, so the font checks' 9 questions of 31.7 weigh more than before. The checks are now the largest single item from scratch, as it says. I agree with its ranking of what is left: kept answers or given facts first, the box's constants second.
4. **The text of a message is read about six times in `prepare`.**
   - The readers: `addTextNeeds`, the 8-bit test, `isComplexCodePath`, the simplified-measuring scan, the break scan, `whitespaceRun`. Every word is read two or three times more (`measureDomString`, `canvasString`).
   - Each is 0.1 µs or less. Fusing them is clever code for under 0.5 µs: not worth it, and it was right not to try.
   - The profile at the head is flat (`bench/cpuprof-latin-head`, `cpuprof-mix-head`): `boxWidth` with what is inlined into it 14%, `listedFamilies` 6.6%, `measureDomString` 5.2%, `nextBreakablePosition` 5.1%, `sameSettings` 4.2%.
5. **For Chrome, "rules, the largest share" isn't quite it.** 7 times the questions at 8 times the price multiply, and the price is the slightly larger factor. For Firefox (2.9 and 1.9) the rules are. Its Chrome and Firefox numbers are one short run each, as it says.

### 6. The two changes I would make before merging

Both are verified on a scratch tree (the boundary attack and `lines.test.ts`). I committed neither.

```diff
--- a/rebuild/src/engines/webkit/breaks.ts
+++ b/rebuild/src/engines/webkit/breaks.ts
@@ -100,6 +100,11 @@
     current = rangeEnd
   }
 }
+
+// The word segmenter of every dictionary range, made at the first one and kept for the page's life, as the decoded tables
+// are: making one costs about four times what segmenting a short range does (JavaScriptCore, 2026-09-20). It is fixed
+// data: it holds the process's default locale, which a page doesn't see change, and nothing of any text.
+let wordSegmenter: Intl.Segmenter | null = null
 
 // The engines' boundaries inside an engine range, from JSC's Intl.Segmenter word granularity over that range, which runs
 // the same libicucore dictionaries (DESIGN.md §6.3, specs/webkit-gaps.md §4.2). The engines never stop before a
@@ -107,11 +112,6 @@
 // boundary ("Don't return a break for the end of the dictionary range"). Against libicucore's line iterator over the
 // groundwork's 1,556 SA texts this differs only where a range starts with a mark (breaks.test.ts), which the paragraph
 // reports as dictionary-breaks-stand-in.
-// The word segmenter of every dictionary range, made at the first one and kept for the page's life, as the decoded tables
-// are: making one costs about four times what segmenting a short range does (JavaScriptCore, 2026-09-20). It is fixed
-// data: it holds the process's default locale, which a page doesn't see change, and nothing of any text.
-let wordSegmenter: Intl.Segmenter | null = null
-
 function addDictionaryBoundaries(source: DictionaryBreaks, rules: BreakRules, text: string, start: number, end: number, isBoundary: Uint8Array): void {
```

```diff
--- a/rebuild/src/engines/webkit/lines.ts
+++ b/rebuild/src/engines/webkit/lines.ts
@@ -1154,7 +1154,8 @@
   const items = L.p.items
   const style = L.p.style
   const hasWrapOpportunityBeforeWhitespace = style.collapse !== 'break-spaces'
-  let placed = b.partialLeadingTextItem === null ? commitPlainStretch(b) : 0
+  // Under a block of break-spaces a word before white space is no candidate of its own (below), so the stretch isn't taken.
+  let placed = b.partialLeadingTextItem === null && hasWrapOpportunityBeforeWhitespace ? commitPlainStretch(b) : 0
   let r = simpleResult(true)
```

DESIGN.md §2.9's sentence on the stretch then needs "in a block that isn't `break-spaces`" after "fits". Its numbers (104 to 90 ms, 146 to 134 ms) are the loaded one-page runs'. The fresh pages have 106 to 92 ms and 142 to 138 ms.

### 7. Problems and deviations

- **I held the exclusive lock for 19 minutes once** (timed-1, 13:41 to 14:00).
  - My pages waited on `setTimeout(0)` between passes. A page that was never visible has its timers held to one a second, so a page took 15 s where 2 s were needed.
  - From its fourth round on, every page also ran 20 to 60 times slower from about 13 s after it loaded. So timed-1's relayout numbers and its split on latin are void. Its from-scratch passes ran before that point and are used.
  - I changed the pages to yield through a MessageChannel. timed-2 took 2 min 41 s.
  - The owner's page waits on the same timers, which is why its stretches took 2 to 8 minutes. Its numbers don't show the slowdown.
- **The machine was never quiet.**
  - Load was 39 to 48 during timed-1 and timed-2, and 64 to 92 during timed-3, 4 and 5. timed-4 is too noisy to use.
  - bun timings were unusable most of the day: a pass took 5 to 80 times its quiet time even with the lock free.
  - The per-line numbers are one clean run at 13:35. A rerun at load 89 is kept beside it as spoiled.
  - I dropped a per-process run of the own-JS floors for the same reason.
- Chrome's tier 1 can't be held in this worktree any more (section 2). The painter differential ran from the main tree.
- The gates' unit-test row is red from 5 s timeouts under load (4 in the full run, 7 in the quick one, the owner's new test once). Every one of them passes alone.
- The inspected halves of two attack shards ran with 3,000-unit giants.
- I killed only my own processes: two unsharded attack runs (pids 33591, 33592), four stuck shards (75432, 75434, 75442, 75443) and my floors script (38655). Nothing of mine still runs (checked with ps at the end).
- Not done: installed Safari; any number from a quiet machine; why the mix from scratch gains less in fresh pages.

### 8. Files

- Tools (committed): `rebuild/tools/own-js-fresh-pages.ts`, `own-js-fresh-summary.ts`, `own-js-attack.ts`; rows in `rebuild/TESTS.md`.
- Bench: `bench/timed-1/{a,th}/`, `timed-2/a/`, `timed-3/`, `timed-4/`, `timed-5/` (each `webkit-host-probes.json` and `summary.txt`), `per-line-bun.txt`, `cpuprof-latin-head/`, `cpuprof-mix-head/`, `timed-N.log`.
- Runs: `runs/gates-full-head-0cb23db.log`, `gates-quick-all-head-12fc749.log`, `unit-tests-rerun.log`, `painter-diff-head.log` and `painter-diff-head-<config>.json`, `attack-families.log`, `attack-boundaries*.log`, `attack-fill/`, `tier1-chrome-no-facts-BASE-f74643e.log` and `.json`, `tier1-chrome-no-facts-HEAD-915ba7b.json`.
- A copy of this report: scratchpad `critic/report-prof-webkit-critic.txt`.

## The Blink port's own JavaScript: profile, free fixes, floor (prof-blink, 2026-09-20)

Worktree `~/github/pretext-rebuild-wt/prof-blink`, branch `x-prof-blink`, base f74643e, head 594b120. Nothing is merged or pushed. The running log is `.progress-prof-blink.txt` in the worktree.

Paths below:
- B = `~/github/pretext-rebuild/.artifacts/bench/prof-blink-20260920`
- T = `~/github/pretext-rebuild/.artifacts/tests/runs/prof-blink-20260920`

### 0. Words

- **pass**: 10,000 chat messages, each prepared plain and filled at 320 px from scratch. One list of Canvas contexts is started inside the pass (bench README, "Chat", E). This is how an app calls the library now.
- **relayout**: the same 10,000 messages prepared, filled at 320 px and kept, then filled at 260, 380 and 440 px. That is 30,000 layouts, every width new.
- **mix** and **ASCII**: the bench's two sets, `buildChat('mix')` and `buildChat('latin')`.
- **own JS**: everything that is not inside a native Canvas call.
- **free answers**: a pass is recorded once (what measureText answered, in order). Timed passes then get those answers back from an array. The port runs the path it runs on the real Canvas, and Canvas costs an array read.
- **base**: f74643e. **head**: the library at 18ff97e, which holds C1, C2 and C3. The later commits are documents and tools.
- All runs: pinned Chrome 153.0.8010.50, background window, device pixel ratio 2, AC power.
- Other owners' work kept the 1-minute load at 27 to 42 all day, even under the exclusive lock. Every timing is therefore alternating rounds in one page, given with its spread.

### 1. Outcome

- **The answer to "did we have slow parts we could have sped up for free": yes, one.** Building each Canvas question cost more than the rest of the port together. A third of that was a typed-array copy that nothing reads on a plain paragraph.
- **The split, base, from scratch.**
  - By profile: 72% inside measureText, 25% own JS, 2% garbage collection.
  - With free answers, own JS is a fifth of the wall time: 0.68 s of 3.45 s on the mix, 0.62 s of 3.23 s on ASCII.
- **Three free commits took 34 µs a message.**
  - From scratch: 3.45 → 3.10 s (mix), 3.23 → 2.89 s (ASCII).
  - Relayout: 1.11 → 0.99 s (mix), 0.98 → 0.86 s (ASCII).
- **The floor (free answers), before → after:**
  - A pass: 0.68 → 0.41 s (mix), 0.62 → 0.36 s (ASCII).
  - A relayout: 0.31 → 0.21 s (mix), 0.28 → 0.18 s (ASCII).
- **What is left is Canvas.**
  - A message asks about 235 questions at about 1.15 µs each.
  - The cut search of groups of 256 zoomed px or more holds 73% of the wall time from scratch. That is another owner's code.
  - The break search's position probes hold 53% of a relayout at a new width.
- **Main's speed is not its JavaScript.**
  - Main's whole cold prepare is 20 µs a Latin message.
  - The port's own JS is 36 µs after the fixes.
  - The other 250 µs is Canvas questions that main never asks.

### 2. The tool and the runs

New tools in `rebuild/tools`:
- `js-profile.ts` is the driver. It launches pinned Chrome as `bench/realism-run.ts` does and keeps a DevTools session attached.
- `js-profile-entry.ts` is the page side. It is bundled once per checkout, with `../src/` pointed at that checkout.
- `js-profile-report.ts` reads one profile.

Modes:
- `--mode=profile`: `Profiler.enable` and `setSamplingInterval` 100 µs. The page brackets the timed stretch with `console.profile` and `profileEnd`. The driver writes `<name>.cpuprofile`.
- `--mode=pairs`: checkouts take turns in one page, and the next round starts one checkout later. It prints the median, the quartiles and the range of the per-round differences.
- `--replay=yes`: free answers. Every checkout's pass is recorded with a hash of every string asked and of the context it was asked on.
- `--mode=classes`: messages filed by the line boxes they make.

| run | what | lock | folder | exit |
|---|---|---|---|---|
| smoke1 | profile, 500 messages | chrome slot, waited 71 min | B/smoke1 | 0 |
| profile-base | profile of base, real Canvas, then with free answers | chrome slot | B/profile-base | 0, 0 |
| pairs-1 | base, C1, C2, C3 in turns, 12 rounds and 6 relayout rounds | exclusive, load 34 to 38 | B/pairs-1 | 0 |
| floor-1 | base against head with free answers, 12 and 6 rounds, phase timers | exclusive, load 27 to 31 | B/floor-1 | 0 |
| profile-head | profile of head, real Canvas | chrome slot | B/profile-head | 0 |
| pairs-2 | C3 against C4, 14 and 6 rounds | exclusive, load 41 | B/pairs-2 | 0 |
| classes-head | head by line boxes | chrome slot, load 35 to 42 | B/classes-head | 0 |

Every run gave the same line totals (35,076 on the mix and 32,549 on ASCII) and the same hash of every line's range. Those are the bench's own totals.

### 3. The split, by two methods

Method A is the JS CPU profile: self time per node. `measureText` is a native node of its own. Files: B/profile-base/*.report.txt.

Method B is free answers: Canvas time is the real pass minus the pass with free answers, with the same rounds and the same lock. Files: B/pairs-1 and B/floor-1.

| base | wall (median, 12 or 6 rounds) | A: measureText / own JS / GC | B: free-answers pass, share of wall |
|---|---|---|---|
| pass, mix | 3451 ms | 72.1% / 25.4% / 2.3% | 677.5 ms, 19.6% |
| pass, ASCII | 3231 ms | 72.7% / 25.0% / 2.2% | 622.5 ms, 19.3% |
| relayout, mix | 1107 ms | 60.9% / 36.4% / 2.3% | 309.3 ms, 27.9% |
| relayout, ASCII | 983 ms | 60.1% / 36.8% / 2.8% | 275.1 ms, 28.0% |

- Making contexts and their setters is 0.0%. With one list a pass, about 24 contexts are made.
- **Why A says 25% and B says 20%:**
  - `width` in `measure/canvas.ts` has 9.3 µs a message of self time on the real Canvas. It has 0.4 µs with free answers (B/profile-base/replay-scratch-mix-base.report.txt). That is the JavaScript side of a native call and of the `.width` getter. The profile books it as own JS; free answers don't pay it.
  - The profiler makes a pass 6% slower (3670 against 3465 ms).
  - Real Canvas calls also evict the port's data from the CPU caches between questions.
  - So the free-answers number is the floor, and the profile's number is an upper reading.
- **A question** (derived from the two tables' totals, not timed per call):
  - The 10,000 messages ask 238 (mix) and 230 (ASCII) questions a message. The bench's 227 and 211 are of the first 1,000 messages.
  - A relayout asks 38.0 (mix) and 36.7 (ASCII) questions a layout.
  - A question costs about 1.15 µs of Canvas from scratch and about 0.70 µs in a relayout.
  - Its own JS was 0.28 µs and is now 0.17 µs.

### 4. Own JS by phase and by function (base, mix, real Canvas)

By phase, µs a message. A sample goes to the first phase a frame of its stack names. Phases are named by source file, because V8 drops a function it inlined into a frame that isn't the top one; `fillLine` and `nextLine` went missing that way.

| phase | own JS | Canvas under it |
|---|---:|---:|
| the questions (`measure16` and under: the joining test at both edges, `spacesStay`, the string, the context, the call) | 66.2 | 264.5 |
| paragraph analysis (content, bidi, scripts, graphemes, items, shaping groups, typed arrays) | 10.9 | 0.3 |
| the fill but its questions (line loop, candidates, fit tests, views) | 8.2 | 0 |
| the cut search but its questions | 3.8 | 0 |
| the font checks but their questions | 2.5 | 1.4 |
| the page's loop (self time in my page's script, cause not found) | 2.1 | 0 |

By who asks, with Canvas:
- Under `measureGroups`: 2840 of 3690 ms (77%). `addPieces` is 73% and `windowAdjust16` is 57%.
- Under the fill: 513 ms (14%).
- Under `withLearnedFontFacts`: 39 ms (1.1%).

The same three phases by timers with free answers (B/floor-1), µs a message:
- Base: checks 1.9, engine prepare 49.7, fill 16.1.
- Head: checks 1.9, engine prepare 29.3, fill 10.0.

By function, the top 25 of B/profile-base/scratch-mix-base.report.txt. Self time counts non-Canvas natives with their caller, so GC and measureText are excluded. µs a message (% of wall):
- `canvasString` 39.6 (10.7%)
- `width` 9.3 (2.5%)
- `measure16` 8.9 (2.4%)
- `joinedAtEdge` 6.2 (1.7%)
- `prepare` 2.1
- the page's `stretch` 2.0
- `windowAdjust16` 1.7
- `floatWidthOfParts` 1.5
- `scriptPropsOf` 1.5
- `shapingGroups` 1.3
- `groupPrefix16` 1.3
- `addPieces` 1.2
- `pairAdjust16` 1.1
- `buildContent` 1.1
- `sameSettings` 0.8
- `spacesStay` 0.8
- rbbi `next` 0.7
- `emojiPriorities` 0.7
- `fetchNextCharacter` 0.6
- `withLearnedFontFacts` 0.6
- script `consume` 0.5
- `offsetForPosition` 0.5
- `styleContexts` 0.5
- `learnedFacts` 0.5
- `nextBreakablePosition` 0.4

Bidi, scripts, graphemes and break classes together are under 3 µs a message.

In a relayout (µs a layout):
- `canvasString` 3.8
- `width` 1.5
- `floatWidthOfParts` 1.2
- `measure16` 1.0
- `joinedAtEdge` 1.0

### 5. The suspects, ranked by measured share

1. **`canvasString`, 10.7% of wall.**
   - Per question it grew three arrays by push (`codes`, `units`, `substituted`), copied `codes` with `slice`, spread the copy into `String.fromCharCode`, copied `units` into an Int32Array, and made the result record.
   - `units` is read only under letter spacing or on an inspected paragraph.
   - FREE: C1, C3 and C4.
2. **`width`, 2.5%.** The JavaScript side of the native call. It goes only when a question goes.
3. **`measure16` self, 2.4%.** Per-question bookkeeping with its inlined helpers. Nothing found that is worth a line.
4. **`joinedAtEdge`, `scriptPropsOf` and `spacesStay`, 2.3%.** These are binary searches over the Unicode runs, several per question, for text that holds no joining letter. FREE: C2.
5. **`prepare` self and `shapingGroups`, 0.9%.** Eleven typed arrays a paragraph and three `Float64Array(length).fill(NaN)` a group. An early path for an unsegmented single-style paragraph could save 2 to 3 µs (under 1%). Not worth the lines.
6. **`floatWidthOfParts`, 0.4% of a pass and 3.0% of a relayout.**
   - On a plain paragraph it still computes what only the float-sum gap reads: the unknown-cluster scan, the slack, the run list with a closure per part.
   - FREE, 0 lines: guard that block by `sh.gaps !== null`.
   - Not built. It is under 1% from scratch and wasn't timed.
7. Everything else is 0.4% or less each.

**Tried and dropped: `text.slice` plus `replaceAll` for plain 8-bit ranges.** It was slower by 4 to 7 µs a message offline. It would also rest on V8's string storage, which is the hazard BLINK-STRING-STORAGE describes.

### 6. The cheapest common case, and main

Head, real Chrome (B/classes-head/classes-summary.txt). The load was 35 to 42 and there are two timer reads a message, so read the classes beside each other.

| ASCII, line boxes | messages | units | calls a message | real µs / free µs | share of the set's time |
|---|---:|---:|---:|---:|---:|
| 1 | 4195 (42%) | 18 | 21.1 | 46 / 12.6 | 3% |
| 2 | 2642 (26%) | 66 | 112 | 272 / 40 | 12% |
| 3 | 828 | 98 | 192 | 433 / 63 | 6% |
| 4 to 5 | 637 | 173 | 349 | 828 / 110 | 8% |
| 6 and more | 1698 (17%) | 422 | 905 | 2612 / 296 | 71% |

- Cost follows text length: about 2 questions a UTF-16 unit on long messages. The 17% longest messages are 71% of the time.
- **A one-line message asks 21 questions.**
  - Ten are the font checks: `" "` four times and `"Hamburgefonstiv"` six times. On a plain paragraph none of them decides a line (DESIGN §4.6).
  - One is the whole text.
  - The rest is the cut search, when the text is 256 zoomed px or more. The single line never reads it: the whole item fits, and the inexact total is within 2^-15 px of the true one.
  - Offline trace: "He had slept through the heat" asks 36 questions: 10 checks, 1 total, 25 for cuts, and none in the fill.
- **Is the plain path taken as early as it could be? No, in one place.**
  - `withLearnedFontFacts` runs before the engine knows whether the paragraph is plain or inspected.
  - Skipping the primary-family and linear-size checks on a plain paragraph is about 3 lines and changes questions. PROFILING-START item 1's "what is left" already names it.
- **Main, from the bench of this morning** (.artifacts/bench/merged-20260920/chrome-bench.md):
  - Cold prepare is 19.8 µs an ASCII message and 34.7 µs on the mix, with 4.6 and 6.7 questions a message.
  - Its layout does no Canvas work.
  - The port's analysis (5.9 µs an ASCII message) is already cheaper than main's segmenter pass.
- **What main skips that this port could skip and stay exact:**
  - The font checks on plain paragraphs.
  - Position probes at character offsets in the break search (§8, item 2).
- **What main skips that can't be skipped exactly:**
  - Adjustments across clusters and spaces.
  - Safe-to-break tests and reshapes.
  - The 256 px cuts.
- **Main's reason for being fast:** a word's width found by its string in a page-wide store, and no shaping across words. That reason doesn't fit this architecture, by DESIGN §4.6's rules.

### 7. What was built

Each change is one commit, with its own tier 1 check in both configurations and Blink's 123 unit tests passing.

Timings are pairs-1 (B/pairs-1/steps.txt): the step from the commit before it, in µs a message, mix | ASCII.

| | commit | lines | state | pass | relayout, µs a layout |
|---|---|---|---|---|---|
| C1: a Canvas string hands out the list of offsets it built, no copy into a typed array | 2d79393 | 0 (3 changed) | none | −23.9 \| −24.0, 12 of 12 rounds, quartiles −243 to −232 ms | −2.7 \| −2.6, 6 of 6 |
| C2: properties below U+3000 read by index | aa814a0 | +20 | two tables, 72 KB | −6.3 \| −5.4, 11 of 12, quartiles −87 to −49 and −70 to −33 ms | −0.5 \| −0.9 |
| C3: a string built in one `String.fromCharCode` call where the units fit one, without a copy (`content.ts` `stringOfUnits`, shared with the paragraph's text) | 18ff97e | +6 | none | −3.9 \| −3.7, 10 and 11 of 12, quartiles −48 to −6 and −51 to −20 ms; the range crosses 0 on the mix | −1.0 \| −0.6, 6 of 6 |

**C2's state.**
- Made when the module loads: 0.7 ms in node's V8.
- Lifetime: the page's.
- Never invalidated: fixed Unicode data.
- Bounded by construction.
- Every exported lookup equals the old search on all 0x110000 code points (scratch script).

**C3 is small.** It is 1.2% of a pass and 2 to 3% of a relayout. It is the last library commit, so a merge can leave it out.

**Proof for C1 to C3.**
- Tier 1 per commit: 67,065 cases the same, 0 predictions changed, 0 questions changed. Files: T/c1-*.log, T/c2-*.log, T/c3-*.log.
- Tier 1 exits 3, not 0, by the string storage rule alone. `shape.ts` differs from the reference's commit, so 65,764 and 5,105 cases go to tier 2.
- Tier 2 in pinned Chrome, forward, on the head:
  - no-facts: exit 0, 0 status transitions, differing values 265 → 265 and 991 → 991, gate lost 0.
  - facts: exit 0, 0 transitions, 551 → 551 and 868 → 868, gate lost 0.
  - Files: T/tier2-no-facts.log and T/tier2-facts.log.
- In Chrome, base and head hash the same over every string asked and its context, in order:
  - Pass, mix: 2,382,121 questions, hash 839628139.
  - Pass, ASCII: 2,303,273 questions, hash 262420315.
  - Prepare-and-keep: the same hashes.
  - Relayout: 1,138,659 and 1,101,149 questions.
  - File: B/floor-1/pairs-replay-summary.txt.
- String storage is the same by construction. C1 doesn't touch the string. C3 makes the same `String.fromCharCode` call with the same arguments.
- Gates `--quick` on the head (T/gates-head.log):
  - tsc over the six projects: 0 errors.
  - Tier 1 as above.
  - Plain and pure checks: 67,065 pass in both configurations.
  - The unit gate exited 1: four tests hit the 5 s timeout. Those files spawn subprocesses, and I ran the gates under `taskpolicy -b` at load 35.
  - A full `bun test rebuild` without it (T/unit-tests-head.log): 889 pass, 3 timeouts, no assertion failure. One of the three is Gecko's all-code-points test, which my change can't reach.
  - The four files with `--timeout 120000`: 13 pass, 0 fail.
- Also clean: citations 0 lost; knip and oxlint flag nothing of mine.
- DESIGN.md §3 and §4.7 carry the change (c42837d).

**C4, built and dropped.**
- The idea: no list of offsets unless a reader asks (`canvasUnits`, +29 −28 lines).
- Tier 1 in both configurations: 0 changed.
- Two-trees: 5,230 cases the same, 510 of them letter-spaced.
- Pairs-2 against C3:
  - Mix: −1.7 µs a message, quartiles −32 to −2 ms.
  - ASCII: −2.5 µs a message, quartiles −36 to +9 ms.
  - Relayout: the quartiles touch 0.
- The gain is inside the spread and the change adds a line, so it is not committed. The patch is at B/c4-candidate.patch.

**After the three commits (head, mix, B/profile-head):**
- measureText is 79.2%. It is 266.7 µs a message against the base's 266.2 µs, as it must be with the same questions.
- Own JS is 18.4%: 62.1 µs from 93.8 µs.
- GC is 2.4%.
- `canvasString` is 14.9 µs, `width` 9.1, `measure16` 8.9, `joinedAtEdge` 2.5.
- The next own-JS suspect is under 1% of the wall time, so I stopped.

### 8. The rest, not built

Shares are of the base profile's wall time on the mix.

1. **The cut search** (`x-perf-b1b-2`'s code; read and profiled, nothing built).
   - CHANGES QUESTIONS.
   - Under `addPieces`: 72.6% of a pass. `windowAdjust16` alone is 57%, and 47 points of that are Canvas.
   - `passesSafeTest` asks the wide window before the pair window. The wide window is three long strings plus one per shrink step; the pair window is three short strings. Either test failing ends the test.
   - A candidate near the middle of a piece that is too wide always shrinks first, and every shrink step is a new long string.
   - Neighbouring candidates measure nearly the same two long sides again.
   - Its own JS was 50 µs a message, mostly `measure16`, which C1 to C3 already cut.
2. **The break search probes positions at character offsets** (`offsetForPosition`'s binary search).
   - Each probe is a prefix plus a pair or wide window.
   - Only the last break opportunity that fits is used.
   - CHANGES QUESTIONS: probe break opportunities instead. It is exact while positions are monotone. It needs a recording.
   - Under `offsetForPosition` with Canvas: 11.4% of a pass and 53% of a relayout at a new width. `nextSafeToBreak` is another 19% of a relayout.
   - This is the part of main's resize speed that fits this architecture, since kept positions by offset already exist.
3. **The font checks on a plain paragraph.**
   - CHANGES QUESTIONS, about 3 lines. Or NEEDS STATE with a page's lifetime, which the lifetime review rejected.
   - 1.1% of a pass on the mix: 10 of about 235 questions. But it is 10 of a one-line message's 21.
4. **Ranges still asked twice** (PERF-POSITIONS "what is left": a cluster alone, the wide window's left side, a piece's total; 44 to 48 questions a message).
   - NEEDS STATE with the prepared paragraph's lifetime, by offset.
   - Estimate from counts, not from the profile: 45 × (0.17 µs own JS + 0.3 to 0.5 µs for a repeat) is about 6 to 9% of a pass.
5. **Lazy cuts**: the cut search runs only when a fill needs a position inside the group.
   - CHANGES QUESTIONS.
   - It helps one-line messages of 256 zoomed px or more. That is under 2% of a set's questions, though it halves such a message.
6. **Any item that removes N questions a message** also removes N × 0.17 µs of own JS now, where it was 0.28 µs.
7. **GC is 2.3% of the wall time.** I did not separate Chrome's TextMetrics garbage from the port's.
8. **FREE and not built:** the `floatWidthOfParts` guard (§5, item 6) and C4.

### 9. The floor

This is own JS with every Canvas answer free, in real Chrome's V8, on the same code path. Runs: 12 and 6 alternating rounds under the exclusive lock (B/floor-1).

| | base | head | difference per round |
|---|---:|---:|---|
| pass, mix | 677.5 ms (67.8 µs a message) | 409.2 ms (40.9 µs) | −269.2 ms, quartiles −270.7 to −266.8, 12 of 12 |
| pass, ASCII | 622.5 ms | 356.2 ms (35.6 µs) | −265.3 ms, 12 of 12 |
| relayout, mix | 309.3 ms (10.3 µs a layout) | 208.7 ms (7.0 µs) | −100.4 ms, 6 of 6 |
| relayout, ASCII | 275.1 ms | 175.1 ms (5.8 µs) | −100.3 ms, 6 of 6 |

- **The earlier guess of 0.5 s per 10,000 messages was low.**
  - Own JS was 0.68 s on the mix and 0.62 s on ASCII. It is 0.41 s and 0.36 s now.
  - No removal of Canvas questions can beat those numbers while the recipe stays.
- **On the real Canvas the fixes save more than on the floor:** 34 against 27 µs a message.
- Offline (node 23 with stand-in answers replayed) the ranking was the same. The absolute times are lower there: 77 → 48 µs on the mix.

### 10. Problems

See the `problems` field for the full list.

### 11. Files

- Tools: `rebuild/tools/js-profile.ts`, `js-profile-entry.ts`, `js-profile-report.ts`.
- Library: `rebuild/src/engines/blink/shape.ts`, `props.ts`, `content.ts`.
- Document: `rebuild/DESIGN.md` §3 and §4.7.
- B/profile-base/*.report.txt and B/profile-head/*.report.txt
- B/pairs-1/pairs-summary.txt and B/pairs-1/steps.txt
- B/floor-1/pairs-replay-summary.txt
- B/pairs-2/pairs-summary.txt
- B/classes-head/classes-summary.txt
- B/c4-candidate.patch
- T/c1-*.log, T/c2-*.log, T/c3-*.log, T/c4-*.log
- T/gates-head.log and T/unit-tests-head.log
- T/tier2-no-facts.log and T/tier2-facts.log

## Gecko port: where the time goes, what was free, what is left (prof-gecko, 2026-09-20)

Worktree `~/github/pretext-rebuild-wt/prof-gecko`, branch `x-prof-gecko`, base f74643e. Nothing merged or pushed.
Paths below are under `~/github/pretext-rebuild/.artifacts` unless they start with `rebuild/`.
Bench output: `bench/prof-gecko-20260920/` (`A`, `B`, `C`, `D` with `*-summary.txt`; `gp2-n5-latin`, `gp3-base-latin`; `bun-*`; `tools/`). Test runs: `tests/runs/prof-gecko-20260920/`. Log: `.progress-prof-gecko.txt` in the worktree.

### 0. Words used

- **ASCII** and **mix**: the bench's `chat/latin` and `chat/mix` sets, 10,000 messages (`bench/cases.ts buildChat`).
- **Scratch**: every message prepared plain and filled at 320 px, one list of Canvas contexts a pass (how an app calls it now).
- **Resize**: the same messages prepared and filled at 320 px untimed, then filled at 260, 380 and 440 px, timed: 30,000 layouts.
- **Real**: a pass on the browser's Canvas. **Stand-in**: the same pass on a Canvas that answers the n-th call with the n-th recorded answer and does nothing else. Its time is the port's own JavaScript. **Browser share**: real minus stand-in.
- **Pair**: one round's base and change. "12/12" means the change was faster in 12 of 12 rounds. Ranges in brackets are the smallest and largest pair difference.
- All timing: pinned Firefox 156, background window, device pixel ratio 2, exclusive lock, every checkout and mode taking turns inside ONE page, 12 rounds, medians. Tool: `rebuild/tools/prof-probe.ts` with `prof-entry.ts` (commit ed112a4). The stand-in is checked: a checked pass throws if a call's string length differs from the recording, and each checkout's questions are hashed (context and string, in order).

### 1. The split

#### 1.1 Browser against own JS (base f74643e; runs A and D)

| per 10,000 messages | real | own JS (stand-in) | browser share |
|---|---:|---:|---:|
| scratch, ASCII | 496 to 501 ms | 235 to 237 ms | 260 ms, 52% (49 to 54 over the rounds) |
| scratch, mix | 916 to 922 ms | 425 to 428 ms | 490 ms, 54% |
| resize ×3, ASCII | 616 ms | 358 to 370 ms | 252 ms, 41% |
| resize ×3, mix | 667 to 671 ms | 375 to 377 ms | 290 ms, 44% |

So the "0.5 s of own JS" guess is wrong for Gecko: it was 0.235 s (ASCII) and 0.43 s (mix), about half the wall. On a resize own JS is the larger half.

Second method (run A, first 2,000 messages, head tree): the recorded calls alone on the real Canvas, contexts made and set as recorded, ink box read where the library read it. ASCII scratch: real minus stand-in 44.6 ms, calls alone 40.7 ms. Mix: 90.5 and 82.8. Resize: 52.2 and 43.8, 55.4 and 44.6. The two agree within 4 to 8% of the wall. The residue is always positive: the replay has flat strings ready and a tight loop. Making contexts costs 0.1 ms a pass (14 contexts on the mix, 4 on ASCII): nothing.

Third method, a real Gecko profile (`gp3-base-latin/summary.txt`, base, ASCII, real Canvas, 20,776 samples at 1 ms, the content process's main thread): `measureText` itself 42.1%, the page's JS 51.6%, GC 4.2%, engine helpers 1.1%, idle 0.4%. The 10 points between 42% and 52% are explained: 1.8% is `IncrementalFinalizeRunnable`, the browser freeing one TextMetrics object a question; `width`, `bounds` and `w` hold 2.2% self as call overhead into the DOM, which inlines away under the stand-in; the rest is other GC. Read it as: inside measureText 42%, everything that vanishes when Canvas is free 52%.

A Canvas call costs about 0.26 µs on ASCII (260 ms over 945,389 calls) and 0.37 µs on the mix (longer strings).

#### 1.2 Calls (run A's recordings; they don't depend on load)

| a message | total | asked by prepare | asked by the fill |
|---|---:|---:|---:|
| ASCII | 94.5 | 22.7 | 71.8 (76%) |
| mix | 131.9 | 21.5 | 110.4 (84%) |

A layout at a new width asks 35.6 (ASCII) and 33.2 (mix). Lines at 320 px: 3.26 and 3.50 a message.

#### 1.3 Own JS by phase

Firefox phase timers (two timer reads a message, none a Canvas call; stand-in; runs A and B agree): base ASCII prepare 100 ms and fill 143 ms per 10,000; mix 159 and 274. Real: ASCII 169 and 333; mix 255 and 673. The timer step was 20 µs even with the clamp prefs off, so only the sums mean anything; they match the untimed passes within 3%.

Gecko profile, base, by phase and kind (% of wall): fill JS 31.4, fill Canvas 31.3, prepare JS 18.5, prepare Canvas 11.3, GC 4.3, engine 2.5. Inclusive: `fillLine` 63.5, `scanAdvance` 60.1, `rangeAu` 40.0, `advanceBefore` 32.6, `inWordAdvance` 30.0, `groupAround` 25.2, `ligatureAcross` 13.1, `prepareGecko` 31.0.

Finer phases only from bun (JavaScriptCore, a list of suspects). Base, ASCII, over Firefox's own recorded answers (`bun-base-latin`): question strings and contexts 32% of the library, in-word advance recipes 21%, prepare's analysis helpers (index, transform, glyph flags, line breaker, scripts) 20%, the fill's line loop 15%, `prepareGecko` self 11%. The mix can't replay Firefox's answers under bun: the port asks another string at call 64,475 (JavaScriptCore's Intl.Segmenter is not Firefox's), so the mix profile uses the hashed stand-in's answers (`bun-hashed-mix`): strings and contexts 44%, analysis 18%, in-word 17%, line loop 12.5%, prepare self 9%. Pieces and inspection: the headline runs count mode, so they aren't in any number here.

#### 1.4 Own JS by function (self time)

SpiderMonkey, base, ASCII, % of wall (own JS is 52% of it): prepareGecko 5.8, scriptContextFor 4.4, rangeAu 3.2, lookup 2.7, breakAndMeasureText 2.6, advanceBefore 2.0, scanAdvance 1.7, textRunScripts 1.5, appendText 1.4, transformFlow 1.3, splitAndInitTextRun 1.2, inWordAdvance 1.2, bounds 1.1, groupSpans 1.1, width 1.1, scanOffset 1.1, entryAt 1.1, joinsAcross 1.0, CopyDataProperties 0.7, groupAround 0.7, windowAt 0.6, groupAcrossAt 0.6, ligatureAcross 0.6, addTextNeeds 0.6, rowAround 0.5. After the fixes (`gp2-n5-latin`): scriptContextFor 0.8, lookup gone, prepareGecko 6.2, the rest as before.

JavaScriptCore, base, ASCII: rangeAu 12.0, prepareGecko 10.9, subarray 7.3, textRunScripts 5.5, joinsAcross 4.8, breakAndMeasureText 4.3, advanceBefore 4.0, setupWord 3.8, appendText 3.1, transformFlow 3.0, glyphBefore 2.9, spacingIn 2.4, addTextNeeds 2.1. Mix: rangeAu 20.5, scriptRunLimits 10.3, prepareGecko 8.7, joinsAcross 3.8, subarray 3.6.

### 2. The suspects, ranked by what Firefox measured

1. **The script check at every question** (`measure.ts scriptContextFor`). To learn which script a piece gets when measured alone, it made a view of the units and ran `textRunScripts`, which for non-Latin text runs the whole script itemizer over the piece (two arrays of 32 made per call, an array and an object returned). Only the first run's script is read, and that is the script of the piece's first character that has one. FREE. Built: -3.5 µs a message ASCII, -9.1 mix.
2. **Character properties by binary search** (`props.ts lookup`, 4,985 runs, 13 steps), about ten reads per offset inside a word (`joinsAcross` runs twice per offset and reads each side twice). FREE with a fixed table for U+0000 to U+00FF. Built: -1.6 and -2.1 µs a message, -2.5 to -2.8 on a resize.
3. **Question strings built a character at a time** (`rangeAu`, `ligatureAcross`, `textOf`). Hot under bun (9 to 17%). In SpiderMonkey: no gain. A six-unit string costs 26 ns by concatenation and 7 ns by slice, and the transformed string has to be made once (234 ns). Built, measured, offered as optional.
4. **The font-checks pass for Gecko** (`withLearnedFontFacts` with checks that ask nothing): copies the paragraph and reads its text at every prepare. SpiderMonkey: addTextNeeds 0.6% plus part of CopyDataProperties 0.7%. Built: 0.29 µs ASCII (inside the spread), 1.0 µs mix (10/12). Dropped: net 0 lines, under 0.3% of wall.
5. **Two per-character arrays in the spacing step**: typed arrays cost 14 ns in SpiderMonkey, so no time. Built and kept because it removes 8 lines.
6. **The itemizer's bracket stack arrays**: after 1 they are made once per non-Latin text run. No gain. Dropped.
7. Not built, under 1% of wall each: `tUnits.slice(0, T)` and `tSource.slice(0, T)` (187 ns each in SpiderMonkey, 0.5% of samples; a reuse when nothing was dropped would take it); `advanceBefore`'s two-field objects at unit starts (5.6 ns each, about 0.5 µs a message); closures in `transformFlow` (isWS 0.5%, keep 0.3%).
8. Disproved: `subarray` (6 ns in SpiderMonkey, 7% under bun), typed array allocation (14 ns), `canonicalLanguageTag` per leaf (under 0.2%).
9. A trap found on the way: `String.fromCharCode(...typedArrayView)` inside `prepareGecko` costs +8.7 µs a message in SpiderMonkey (run B, 0/12 rounds). Never spread a typed array in hot code.

**The short single-style Latin message.** What it pays that it may not need:
- Break candidates inside each line's first word. `overflow-wrap: break-word` makes every cluster a candidate until the first space, and each candidate costs about four Canvas calls (ligature test with and without ligatures, the suffix, the cluster alone) plus the recipes' JS. When the word fits, every one of those fit tests passes whatever the advance is. That is 76% of the calls. This is section 4's R1. It changes questions.
- Steps that compute nothing for it: the font-checks pass (0.3 µs), the spacing loop over zeros, the correction arrays of an 8-bit run. Together about a third of `prepareGecko`'s self time, so at most 2% of wall. An early path for "one 8-bit leaf, no spacing" would be about 40 lines that must stay equal to the general path, for about 1 µs a message. Not worth it.
- The plain path is taken as early as it can be: `inspect` is decided on prepare's first lines, every gap function returns at once on a null sink, the fill passes no consulted list. Nothing to take there.

**What main skips** (`src/analysis.ts`, `measurement.ts`), and whether the reason fits here:
- It measures inside a word only when the word is wider than the line. Fits: the engine's scan shows only through its fit tests. This is R1.
- It keeps word widths per font across texts, so it asks 7 calls a message where this port's prepare asks 22. Needs a store that outlives paragraphs: the API phase's decision.
- Its layout is arithmetic over arrays. Here the line loop alone costs about 4.5 µs a message (1.4 µs a line) in objects and scans. A flat relayout loop is PROFILING-START item 9, not a small fix.

### 3. Built

Every library commit: `bun test rebuild/src` 417 pass, `tsc` clean, tier 1 in both configurations exit 0 with 63,771 the same, 0 predictions changed, 0 questions changed, run per commit from a scratch copy of its tree (`tests/runs/prof-gecko-20260920/tier1-commit-<sha>.log`, `check-*.log`). Citation ledger on the tip: 0 lost. In the browser every checkout's question hash equals the base's on 10,000 scratch messages and 40,000 resize layouts of each set.

Per-commit timing is run C (commits measured in the order first-script, spacing, slices, props; they touch separate code). Run D confirms the total of the three kept ones.

| commit | own JS, µs a message saved | wall, µs a message saved | lines | state |
|---|---|---|---|---|
| 4f584bf the piece's own script from its first character that has one | ASCII 3.51 [1.9..7.1] 12/12; mix 9.13 [4.5..10.9] 12/12; resize 3.58 and 3.33 | ASCII 3.55 (9/12); mix 11.94 (12/12); resize 3.70 (11/12) and 4.59 (12/12) | +6 -3 | none |
| 615e86c properties of U+0000 to U+00FF by index | ASCII 1.56 [1.3..4.5] 12/12; mix 2.08 [1.3..5.9] 12/12; resize 2.53 and 2.84 | ASCII 1.60 (10/12); mix 2.62 (11/12); resize 2.73 and 2.25 | +4 -1 | 256 numbers made when the module loads; page lifetime; nothing invalidates it; 1 KB |
| 35434cf the spacing step walks the frames | ASCII -0.11, mix +0.25: inside the spread | inside the spread | +9 -17 | removes two arrays |
| ed112a4 tools (`prof-entry.ts`, `prof-probe.ts`, `prof-bun.ts`) | | | 3 files | |
| af52d1c OPTIONAL, last: questions as slices of a kept transformed string | ASCII 0.3 to 0.6 SLOWER (1/12 in C and in D); mix 0.4 to 0.8 faster (9/12, 10/12) | inside the spread | +54 -66 | +1 field `tText`, the prepared paragraph's lifetime |

Total of the three kept commits (run D, base against 35434cf): own JS ASCII 234.8 -> 190.6 ms (pairs -43.7 [35.4..71.8], 12/12), mix 427.5 -> 310.2 (-118.2 [101.4..133.1], 12/12). Wall: ASCII 500.7 -> 446.6 ms (-55.1 [19.4..68.6], 12/12, -11%), mix 916.0 -> 798.4 (-116.8 [97.5..139.0], 12/12, -13%). Resize wall 616.5 -> 554.3 and 666.7 -> 588.5 (11/12 each, -10 and -11%). Library lines: +19 -21.

My recommendation on af52d1c: leave it out. It buys no time in SpiderMonkey and keeps a second form of `tUnits`; its only merit is -12 lines.

Dropped after measuring, kept under local tag `prof-gecko-backup-3`: b84e899 (prepare hands Gecko the paragraph as it is) and 7c5f1c2 (bracket stack). Local tags `prof-gecko-backup-1` to `-4` hold the earlier orders and can be deleted.

I stopped building here: every suspect left that is free is under 1% of the wall.

### 4. The rest, not built

- **R1. Skip a plain paragraph's break candidates inside a unit whose end fits. CHANGES QUESTIONS (drops them).** What it touches: `scanAdvance` holds 60% of the wall inclusive on ASCII; 76% and 84% of the calls. Measured with a scratch patch that is NOT on the branch (`bench/prof-gecko-20260920/scratch-r1-skip-in-word-candidates.patch`, 10 lines in `lines.ts`), run B: wall ASCII 441 -> 189 ms per 10,000 (-25.2 µs a message, 12/12), mix 783 -> 500 (-27.1, 12/12); own JS -6.5 and -6.65 µs a message; the fill on ASCII goes from 286 to 50 ms. That puts Firefox's ASCII scratch under main's cold prepare (0.30 s). Resize not measured; a layout at a new width asks almost only these questions. Correctness of the scratch rule: identical line ranges on 2,000 + 2,000 chat messages at six widths (320, 260, 380, 440, 120, 60 px) on the hashed stand-in, with 118 calls where the head asks 427 (ASCII) and 164 for 435 (mix); `function-set sweep` 63,771 pass; `function-set plain` FAILS 12 of 63,771 (word spacing in spans, hanging U+3000, script spacing: `tests/runs/prof-gecko-20260920/plain-scratch-r1-no-facts.log`). So it needs a careful rule (no trimmable character inside the unit, no negative spacing over it, and an argument that an in-word advance never exceeds the unit's end), a recording and tier 2. It is simpler than the lazy scan that was taken out: it never keeps a partial value, it asks the whole advance or nothing.
- **R2. A store by unit string that outlives paragraphs. NEEDS STATE** (a page's; goes stale when fonts load, which the library can't see: the API phase's decision). Touches prepare's Canvas share: 22.7 calls a message, about 11% of the ASCII wall today, a third of it after R1 (61 of 189 ms). Hit rates weren't counted.
- **R3. Equal units in one paragraph share a record** (PROFILING-START item 5, the paragraph's lifetime): small for chat; not measured.
- **R4. TextMetrics garbage**: 1.8% of wall, one object a question; it goes with the questions.
- **R5. A relayout loop over flat arrays**: the line loop proper is about 4.5 µs a message (the fill's own JS under R1). Structural.

### 5. The floor

Own JS with every Canvas call free, per 10,000 messages from scratch: **before 0.235 s (ASCII) and 0.43 s (mix); after the three kept commits 0.19 s and 0.31 s.** Resize at 3 widths: 0.36 and 0.375 s before, 0.30 and 0.33 s after. With R1's scratch patch: 0.124 s and 0.228 s. No removal of questions alone goes under these; the stand-in also leaves out the TextMetrics garbage (about 2% of wall).

### 6. For the merge

- DESIGN.md wants one sentence where Gecko's fixed data is listed (§4.6 or §6.2): `engines/gecko/props.ts` keeps the packed properties of U+0000 to U+00FF by index, 256 numbers made when the module loads. I edited no .md file.
- `prof-probe.ts` needs checkouts that hold `rebuild/src` and `rebuild/tools/prof-entry.ts`; `tools/mktree.sh` beside the run outputs makes them from a commit.

## The WebKit port's own JavaScript: a profile, what was free, and what is left (key: prof-webkit, 2026-09-20)

Branch `x-prof-webkit` in `~/github/pretext-rebuild-wt/prof-webkit`, base f74643e. Nothing is merged or pushed. Every
file named below without a folder is under `~/github/pretext-rebuild/.artifacts/bench/prof-webkit-20260920/`; test runs
are under `~/github/pretext-rebuild/.artifacts/tests/runs/prof-webkit-20260920/`.

### 0. Outcome

- **Own JavaScript is most of WebKit's time, not Canvas.** 10,000 chat messages from scratch with one list of contexts,
  in webkit-host: 57 to 66% of the wall time is the port's own code, 34 to 43% is inside `measureText` (120 to 170 ns a
  call, 30 to 40 calls a message), and making contexts is 0.1%. Two methods agree within 2 to 5 points, and the
  orchestrator's own bench run of this morning says the same (58 to 59% outside Canvas). A relayout of kept messages
  asks Canvas nothing on plain ASCII, so it is all own code.
- **Four changes are built, all with the same Canvas questions in the same order and the same lines.** Together, in
  webkit-host, 20 alternating rounds against two identical copies of the base: from scratch the mix goes from 141.4 to
  121.8 ms per 10,000 messages (−1.96 µs a message, −13.9%) and plain ASCII from 106.9 to 85.2 ms (−2.17 µs, −20.3%);
  a layout of a kept message goes from 2.69 to 1.76 µs on the mix (−34%) and from 2.06 to 0.99 µs on plain ASCII
  (−52%). Every one of the 20 rounds went that way in all four rows. Thai messages go from 48.2 to 19.6 µs a message
  (−59%, 20 of 20 rounds).
- **The floor** (every Canvas call free): in webkit-host 9.16 µs a message before and 7.42 after on the mix, 6.72 and
  5.24 on plain ASCII; under bun 11.3 and 9.3, 8.3 and 5.8. So with no Canvas at all, 10,000 messages cost this port
  52 to 74 ms after my commits.
- **One change does nearly all of it:** the simple line builder spent about 50 ns of bookkeeping on every item where
  a sum takes 6 ns. It is main's reason for being fast at layout (a flat loop over kept widths), taken back for the
  stretch of a line where nothing else can happen. It adds 54 lines to `lines.ts`, so it is the last commit and a
  merge can leave it out.
- **Why Safari is so much better, checked against profiles in the three browsers with one page:** rules first, then
  the browser, then code. Per plain ASCII message Chrome takes 304 µs, Firefox 46 and webkit-host 10.8. Chrome's port
  asks 7 times WebKit's questions (222 against 32) and each `measureText` costs Chrome 8 times what it costs WebKit
  (1,050 against 130 ns); Firefox asks 2.9 times as many at 1.9 times the price. Own code per question is 1.4 to 2
  times WebKit's in Blink's port and 1.2 to 1.4 times in Gecko's. **Blink's own code costs 70 to 107 µs a message in real
  Chrome (0.7 to 1.07 s per 10,000), and 117 to 131 µs under JavaScriptCore with every Canvas call free: the 0.5 s
  floor nobody had checked is low by 1.4 to 2.6 times.** It is still only 23 to 34% of Chrome's time; Canvas is the
  rest.

### 1. How it was measured

- **The page** (`rebuild/tools/own-js-probe.ts`, `own-js-probe-entry.ts`, `own-js-summary.ts`, run through
  `probes/runner.ts --isolated`, which I added: the page is cross-origin isolated, so its timer steps 20 µs). One page
  holds the library of several checkouts, each bundled from its own tree, and the bench's first 10,000 messages of each
  set. Part 1 is alternating rounds: every library lays every set out from scratch at 320 px with one list of contexts
  a pass, and the next round starts one library later; then the same for 3,000 kept messages at 260, 380 and 440 px.
  Part 2 is the split, by two methods. *Timed:* `measureText`, the `OffscreenCanvas` constructor, `getContext` and
  the text attributes' setters are wrapped with a timer each; two timer reads around nothing (21 ns) are subtracted
  per call. *Map:* `measureText` answers from a Map, per context settings, what Canvas answered the first time, so a
  pass is own code plus the Map, and the Map alone is timed by asking it one pass's questions again; Canvas is a pass
  with the real Canvas less that. The phase timers (font checks, the engine's prepare, the fill) run under both.
- **The profile** (`rebuild/tools/own-js-profile.ts`): the same messages under bun with the stand-in Canvas behind a
  Map, which is also the floor, and the input of `bun --cpu-prof` (JavaScriptCore, 100 µs sampling). It prints one
  number for a pass's contexts and questions in order (`questionsDigest`): two trees that print the same number made
  their contexts at the same points and asked the same strings of the same contexts in the same order. It is a quick
  look before tier 1, not the proof.
- **The machine was never quiet.** The 1-minute load was 23 to 52 during my six exclusive stretches (other agents'
  offline work, which the quiet-window tool keeps on the efficiency cores, and my own gates). My base numbers (mix 137
  to 154 ms, plain ASCII 103 to 108 ms) are 5 to 15% over the quiet 0.13 and 0.10 s. Gains are from alternating rounds
  in one page, which the load does to every library alike.
- **Two identical builds differ.** I put a second copy of the base in the page (A/A). In `timed-2/a` the copy was
  "faster" by 2.9 ms on the mix and 2.1 ms on ASCII in 23 of 30 rounds; in `timed-4` and `timed-5` the two copies were
  within 0.2 to 0.7%. And a change that can't touch the fill (the family list parser) "slowed" the mix's relayout by
  2.7% in 29 of 30 rounds. So this method can't attribute a difference under 2 to 3% to a change: JavaScriptCore
  compiles and places each copy a little differently. I compare every change with the mean of the two copies.
- **bun is not a fair A/B.** With shared harness functions the first-loaded library won every relayout round by 7 to
  15% though no fill code differed; with each tree's own entry module it still won by 7 to 10% (`timed-2/bun-ab2.txt`).
  I use bun for the profile, the floor and the questions' digest, and webkit-host for every gain.

### 2. The split (base f74643e, webkit-host, 10,000 messages from scratch, one list of contexts a pass)

Per message, µs. `timed-1/summary.txt` (medians of 7 passes; a side's passes lie within 3%); `timed-2/a` and `timed-5`
repeat it.

| | the mix | plain ASCII |
|---|---:|---:|
| wall | 16.2 | 11.4 |
| `measureText` calls a message | 40.2 | 31.7 |
| inside `measureText`, timed method | 6.9 (171 ns a call) | 4.0 (127 ns a call) |
| Canvas, Map method | 6.7 | 4.5 |
| making contexts (11 and 5 a pass) | 0.01 | 0.01 |
| own JS, timed method | 9.3 (57%) | 7.4 (65%) |
| own JS, Map method | 9.5 (59%) | 6.95 (61%) |
| own JS again: `timed-2/a`, `timed-5` (timed, Map) | 60%, 59%; 61%, 66% | 65%, 61%; 65%, 62% |

The two methods differ by 0.2 to 0.7 µs a message. The timed method leaves the wrapper's own call inside "own JS";
the Map method leaves the hashing of each sliced string inside the Map's share where the real `measureText` pays to
read the same string. The bench's phase pass of this morning (`.artifacts/bench/merged-20260920/webkit-host-bench.md`,
the bench's own wrappers) has 41% inside `measureText` and 58 to 59% outside.

By phase, per message, µs (own JS is the Map passes less the Map's own 23 ns a call; Canvas is the real passes less
the Map passes plus that share):

| | checks: own JS, Canvas | engine prepare: own JS, Canvas | fill: own JS, Canvas |
|---|---:|---:|---:|
| the mix | 1.5, 1.8 | 4.9, 5.2 | 2.8, 0.04 |
| plain ASCII | 1.34, 1.3 | 3.41, 2.9 | 2.20, 0.1 |

**Relayout** of kept messages at 3 widths asks 0 questions on plain ASCII and 0.11 a layout on the mix, so it is own
code: 2.06 to 2.13 µs a layout on ASCII and 2.7 to 2.9 on the mix with 3,000 kept messages, and the same with 10,000
kept (62.9 and 81.0 ms per 30,000 layouts, `timed-2/b`): no cache cliff. The "about 0.2 s" in my brief is older; this
morning's bench has 74.5 and 96.2 ms. Main's layout is 0.24 to 0.28 µs there.

### 3. Own JS by function (bun `--cpu-prof`, base, shares of the samples in `rebuild/src` and natives called from it)

`cpuprof/latin-scratch-base.cpuprofile`, `mix-scratch-base.cpuprofile`, `latin-relayout-base.cpuprofile`. Caveat:
JavaScriptCore inlines differently from run to run, so self time moves between a function and its caller (`boxWidth`
is 13.5% in one profile and folded into its callers in another). Read groups, not single rows.

Plain ASCII, top 25 (87% of own samples): `boxWidth` 13.5, `listedFamilies` 8.2, `appendTextFast` 7.3,
`sameSettings` 7.2, `simpleCommitCandidateContent` 6.0, `nextBreakablePosition` 4.8, `measureDomString` 4.3,
`process` (the closure in `placeInlineTextContent`) 3.9, `makeBox` 3.1, `moveToNextBreakablePosition` 3.0,
`familyNames` 2.9, `addTextNeeds` 2.7, `handleTextContent` 2.4, font-checks `width` 2.4, canvas `width` 2.1,
`cloneObject` (the object spread in font-checks `width`) 1.9, `fillLine` 1.5, `prepareWebKit` 1.5, `canvasFont` 1.3,
`genericFamilyUnder` 1.3, `simpleResult` 1.2, `placeInlineTextContent` 1.1, `advancesWidth` 1.0, `primaryFamily` 0.9,
`familyList` 0.9. The mix adds `next` and `ruleBoundaries` of `breaks/rbbi.ts` (2.9), `appendText` (1.0), bidi
(1.6) and `Intl.Segmenter` construction (0.7). Inclusive: font checks 19%, `prepareWebKit` 52% (`buildItems` 36%,
`makeBox` 13%), `fillLine` 23%. Relayout is 86% `lines.ts`: `appendTextFast` 21, `simpleCommitCandidateContent` 19,
`process` 16.

It is a flat profile. No Map or Set with built keys, no regular expression, no bidi and no `Intl.Segmenter` on Latin
text: break opportunities come from WebKit's own Latin-1 pair table, a scan per character.

### 4. The suspects, ranked by share of the plain ASCII wall time (11.4 µs a message)

1. **The simple builder's bookkeeping per item: 2.2 µs, 20% from scratch, all of a relayout.** A chat message is 42
   items (a word, a space, a word). Each went alone through two closures, `simpleCommitCandidateContent`, a 5-field
   result object, `appendTextFast`, `expandRun` (a new trailing-white-space record per space) and
   `updateTrailingContent` (a new trimmable record per space), with the last run's right edge computed three times:
   about 50 ns an item, where a flat loop over the same items' kept widths is 6 ns (0.24 µs a layout, measured under
   bun; main's layout is 0.24 to 0.28 µs in webkit-host). *Fix: commit the line's leading plain items by sums and hand
   the first other item to the builder.* FREE. **Built** (section 6, commit 4).
2. **The font checks at every `prepare`: 2.65 µs, 24% (own JS 1.34, Canvas 1.3).** Nine questions, and for each of
   12 lookups a spread of the declaration, a new font string and a search of the page's list that compares it; the
   family list parsed; the text scanned for a soft hyphen. All of it depends on the declaration and the page's fonts,
   not on the message. (a) *A declaration's contexts found once per call*: FREE, **built**, −0.3 µs. (b) *The caller
   gives `primaryFamily` and `monospace`*: no library change, 31.7 to 22.7 questions a plain message and 40.2 to 30.6
   on the mix, same lines (counted under the stand-in); the bench gives none on purpose. (c) *Answers kept with the
   list*: NEEDS STATE, the list's lifetime; section 7. (d) *The fixed-pitch check asks `i` against the space before
   it proves the family draws `iM.`*: CHANGES QUESTIONS, 9 to 5 for a proportional font; section 7.
3. **What `makeBox` works out per box from the declaration: about 1.0 µs of own JS and one question (the space),
   10%.** The family list parsed again and lowercased, the generic family looked up under the locale, the Canvas font
   string and settings built, the list searched twice, the locale's script read twice. *Cheaper parsing*: FREE,
   **built**, −0.2 to −0.5 µs. *The box's plain context is its own context when letter spacing is 0*: FREE, built and
   dropped, nothing measurable. *Done once per declaration per list*: NEEDS STATE; section 7.
4. **The glue around each word's question: about 1.3 µs, 12%** (`boxWidth`, `advancesWidth`, `measureDomString`:
   the slice, the trailing-space arithmetic, two scans of the word for VT, FF and CR). The slice has to exist to be
   asked. *One scan in place of two*: FREE, built and dropped, nothing measurable.
5. **The family list is parsed twice per `prepare`** (the checks, then `makeBox`; `listedFamilies` is 8% of own JS,
   0.57 µs, 5%). One parse needs the parsed list in the model, which PROFILING-START.md already files under the API
   phase ("a font-family list read once, at the library's boundary"): now with a number, about −0.25 µs a message here.
6. **Break opportunities: 0.55 µs, 5%.** One pass over the characters with the pair table. Nothing is repeated.
7. **`addTextNeeds`: 0.19 µs, 1.7%.** The scan for a soft hyphen and joining letters. *Skip the range tests for a
   character under U+00AD*: FREE, built and dropped, nothing measurable.
8. **An `Intl.Segmenter` made per dictionary range.** 0.7% of own JS on the mix, 60% of a Thai message. *One
   segmenter kept from the first range on*: fixed data with the page's lifetime. **Built** (commit 3).
9. **`measureText` itself: 34 to 43%.** Under the stand-in, 12,336 of a pass's 316,552 questions are distinct on
   plain ASCII and 18,848 of 401,819 on the mix, so a store by context and string would answer 95%. It was built,
   measured (×0.73 to ×0.82 in webkit-host) and left out by decision (research/PERF-CONTEXT-STORE.md). I don't reopen it.

After the four commits the relayout profile (`cpuprof/latin-relayout-head.cpuprofile`) is spread again: the sum loop
27%, `lineRect` 10.5% (two closures and four small objects per line for a slot without insets, about 0.1 µs a layout,
1% of the from-scratch wall), `fillLine` 7.6, `newLine` 7.2. The next suspect is at the 1% line, so I stopped.

### 5. The cheapest common case, and main

- **What a short message asks.** "Fine, thanks." asks 12 questions: `" "` under four lists and `"iM."` under the
  same four and `"i"` (the checks), the box's space, and its two words. Ten of twelve are about the declaration. An
  average plain message asks 10 of 31.7 that way. This, not the line loop, is what a short single-style Latin message
  pays for and doesn't need once a page has met its declaration; without state or the caller's facts the port can't
  skip it.
- **Is the plain path taken as early as it could be?** Yes. `prepare(…, false)` makes no inspection record, `boxMade`,
  `collectHistoryWorlds` and `unverifiedCoverage` return at once, a line has no gap list, and the profile shows 0.0%
  under them. An ASCII message runs no bidi, no ICU rules and no segmenter. What was left was inside the fill, and
  commit 4 is that early path: 54 lines.
- **Main on the same message.** Main's cold prepare is slower in Safari (0.31 s against 0.10 to 0.13 s) because it runs
  `Intl.Segmenter` over every text and then several passes over the segments. What it skips: (1) font checks per text:
  it takes a font string on trust; (2) family parsing: the font string is its cache key; (3) a word met before: a Map
  per font, which is the store left out by decision; (4) making segmenters: it keeps two; (5) line bookkeeping: its
  layout is a flat loop over kept widths. (4) and (5) fit this architecture and are taken back by commits 3 and 4.
  (1) and (2) are state or API; section 7.

### 6. Built

All eight commits; the first three are tools. Gains are webkit-host, alternating rounds in one page, against the
mean of two identical base (or head) builds; "rounds" is how many went the change's way.

| commit | what | lines in `rebuild/src` | state added | gain |
|---|---|---|---|---|
| 064fc33 | `probes/runner.ts --isolated` | tools | | |
| 2326d1b, d2aba30 | the own-JS tools; one language in place of the chat sets | tools, +722 | | |
| 3639e00 | the font checks find a declaration's contexts once per call | +12 −3 | a list local to one call | mix −6.2 ms per 10,000 (−0.62 µs, −4.1%, 28 of 30 rounds, middle half −9.5 to −1.6); ASCII −3.2 ms (−0.32 µs, −3.0%, 26 of 30, middle half −3.8 to −2.2). `timed-2/a/pairs-vs-both-bases.txt` |
| b7a870c | a family list's names are cut out in stretches, not added to letter by letter | +19 −9 | none | mix −5.3 ms (−3.5%, 25 of 30); ASCII −1.8 ms (−1.7%, 24 of 30, middle half −2.5 to −0.1). At the method's noise floor on ASCII. Same file |
| the two together | | | | mix −8.3 ms (−5.5%, 26 of 30); ASCII −4.5 ms (−4.3%, 28 of 30, middle half −5.8 to −3.9) |
| 26e7a2e | WebKit's port keeps its one word segmenter | +7 −1 | one `Intl.Segmenter`, module lifetime, holds the default locale and no text; nothing invalidates it; bounded at one | 1,000 Thai messages 48.2 to 19.6 ms (−28.5 µs a message, −59%, 20 of 20 rounds, −30.7 to −26.7). `timed-3/summary.txt`. A segmenter made costs 7.8 µs against 1.9 µs for segmenting a short range (bun) |
| 1553c42, 0cb23db | the simple builder commits a line's leading plain items in one step; its unit test | +58 −4 (49 of code), test +17 | none | against two identical heads: from scratch mix −12.7 ms (−1.27 µs, −8.7%, 20 of 20, −31.2 to −0.7), ASCII −14.1 ms (−1.41 µs, −13.5%, 20 of 20, −18.6 to −9.8); a kept message's layout mix −0.99 µs (−35.9%), ASCII −1.10 µs (−53.7%), 20 of 20 both. `timed-4/pairs-vs-both-heads.txt` |
| head against base | all four | +96 −17 | | mix 141.4 to 121.8 ms (−13.9%), ASCII 106.9 to 85.2 ms (−20.3%); layouts 2.69 to 1.76 and 2.06 to 0.99 µs; 20 of 20 everywhere. `timed-5/pairs-vs-both-bases.txt` |

- **Commit 4 in words.** While a line's next item is text of the paragraph's one box with its width kept, a word or
  one collapsible space, without a trailing soft hyphen, and fits, it is a candidate of its own, and what the builder
  would have left of it (the run, the content width, the trimmable content, the wrap opportunity list, `measuredEnd`)
  is written once at the end of the stretch, with the same float32 sums in the same order. The first item of another
  kind, or that doesn't fit, goes to the builder as before, so every break decision is still the builder's. It doesn't
  run in a paragraph with two boxes, negative letter spacing, preserved spaces, or on a line that starts inside a word.
  It is a second path through one stretch of the fill, which the engineering guide warns about; what it buys is above.
  DESIGN.md §2.9 has it.
- **The proof.**
  - Tier 1 on the first three changes together (`gates-quick-stack.log`, a copy of the tree, `--engine=all --quick`):
    webkit-host exit 0 in both configurations, 63,987 cases, 0 predictions changed, 0 questions changed (0 repeats, 0
    dropped, 0 other, 0 new); Firefox exit 0 in both, 63,771 cases; Chrome 0 predictions and 0 questions changed, exit
    3 by the string storage rule alone; plain and pure pass for all three browsers in both configurations, 0 fail, 0
    skipped.
  - Commits 3639e00 and b7a870c alone, the same gates on copies (`gates-quick-k-3639e00.log`,
    `gates-quick-k-b7a870c.log`): the same result, and b7a870c's run exits 0 with every gate fine, unit tests included.
  - The head with commit 4 (`tier1-head-webkit-host-<config>.log`, `function-set-head-<check>-<config>.log`, run
    directly on a copy): webkit-host tier 1 exit 0 in both configurations, 63,987 cases the same, 0 predictions and 0
    questions changed; the function set's sweep (one prepared paragraph at four widths against fresh prepares, plain
    and inspected), plain and pure checks pass on all 63,987 cases in both configurations, 0 fail, 0 skipped; the
    plain path still asks 36.51 questions a paragraph. Commit 4 touches `engines/webkit/lines.ts` and its test alone,
    so Blink and Gecko at the head are what the run on the first three changes proved.
  - Commit 4 beside that: every `fillLine` result and every `linePieces` as JSON, base against the change, 12,968
    paragraphs (the mix, plain ASCII, eleven languages, eight hand-made shapes; `white-space: normal` and a seventh of
    them under the four other values; plain and inspected) at 60, 150, 320 and 1,000 px under the stand-in: 0 differ.
    Its unit test lays one text node out beside the same text in two nodes, where the builder commits every item, at
    every width from 7 to 440 px and both `overflow-wrap` values; a wrong width sum fails it, and so does a fit test
    1 px too generous.
  - Unit tests at the head: 893 pass, 0 fail, 69 files (`unit-tests-head-0cb23db.log`; a 60 s timeout a test,
    because under this load the default 5 s timed out in `lab/rows.test.ts` and two more files that aren't mine).
    `tools/citations.ts check` exits 0 with 0 lost after every commit.
  - The questions' digest under the stand-in is the base's for every tree, both sets and Thai.

**Built and dropped** (`timed-1/summary.txt`, 15 rounds; patches were scratch files and are described in section 4):
the box's plain context reused (+0.14 and +0.03 µs, 6 and 7 of 15 rounds), one scan for VT, FF and CR (−0.17 and −0.07
µs, 10 of 15), the early `continue` in `addTextNeeds` (−0.05 and −0.10 µs, 9 and 10 of 15). All inside the spread, and
none removes a line.

### 7. Not built

Share of the plain ASCII wall after my commits: 9.6 µs a message in the phase passes of `timed-5` (checks 2.35,
prepare 6.2, fill 1.0; the rounds' median is 8.5).

| item | kind | touches | note |
|---|---|---:|---|
| The font checks' answers kept with the list of contexts | NEEDS STATE: the caller's list | 2.35 µs, 24% (the mix: 2.5 of 12.7, 19%) | In WebKit alone the list already has to be replaced after the page's fonts change, because a kept context doesn't heal there (DESIGN.md §4.6). So in this engine kept answers go stale exactly when their contexts do, and add no new contract. PERF-LIFETIME measured 0.7 to 0.8 µs a message for it; my split says the checks cost three times that, so its prototype was still paying most of the JS |
| What `makeBox` derives from a declaration (family list, names, generic family, font string, contexts, the space) kept per declaration on the list | NEEDS STATE: the list's | about 1.0 µs, 10% | the same lifetime and the same invalidation as above |
| The caller gives `primaryFamily` and `monospace` | API, no state | the checks' 2.35 µs | works today; 9 fewer questions a message |
| The fixed-pitch check asks `i` against the space first, and proves the family draws `iM.` only where they are equal | CHANGES QUESTIONS | 4 of 9 check questions: about 0.55 µs of Canvas and 0.3 of JS, 9% | a proportional font answers `false` where it answers `false` today; a family that doesn't draw the sample would answer `false` where it answers null, which the port reads the same (`facts.monospace === true`) and an inspected paragraph may report differently. Needs a recording |
| The family list parsed once per `prepare` | model change, API phase | 0.25 µs, 3% | already on PROFILING-START.md's API list |
| A store of widths by context and string | NEEDS STATE | most of Canvas's 4 µs | left out by decision (PERF-CONTEXT-STORE.md) |
| The same stretch in `LineBuilder` (paragraphs with a code span or reordered text, 12% of the mix) | FREE, a third path | fill of those messages | not tried; the mix's relayout gained 34% where ASCII gained 52% for this reason |

### 8. The floor

10,000 messages with every Canvas call free. webkit-host, Map method, medians of 7 passes (`timed-5/summary.txt`);
bun, `own-js-profile.ts`, medians of 7 passes, the Map's own 0.6 µs a message taken off (`timed-5/floors-base.txt`,
`floors-head.txt`).

| | before | after |
|---|---:|---:|
| webkit-host, the mix | 91.6 ms (9.16 µs a message) | 74.2 ms (7.42) |
| webkit-host, plain ASCII | 67.2 ms (6.72) | 52.4 ms (5.24) |
| bun, the mix | 112.9 ms (11.29) | 93.4 ms (9.34) |
| bun, plain ASCII | 82.9 ms (8.29) | 57.8 ms (5.78) |
| bun, 30,000 layouts of kept messages, the mix / ASCII | 94.1 / 68.9 ms | 53.9 / 31.6 ms |

### 9. Why Safari is so much better, and what the two slow ports could copy

**The same page in the three browsers** (`timed-6/firefox/summary.txt`, `timed-6/chrome/summary.txt`: my branch's
head, whose Blink and Gecko ports are the base's but for the two shared commits; 3,000 messages, medians of 3 passes,
1-minute load 38 to 40, so rough; webkit-host from section 2). Per message, the mix | plain ASCII:

| | webkit-host | Firefox 156 | Chrome 153 |
|---|---:|---:|---:|
| wall, µs | 16.2 \| 11.4 | 86 \| 46 | 331 \| 304 |
| `measureText` calls | 40.2 \| 31.7 | 132.7 \| 91.5 | 234.4 \| 221.6 |
| inside `measureText`, ns a call | 171 \| 127 | 318 \| 236 | 1,045 \| 1,051 |
| Canvas, µs | 6.9 \| 4.0 | 42 \| 22 | 245 \| 233 |
| own JS, µs: timed method, Map method | 9.3, 9.5 \| 7.4, 6.95 | 44.0, 44.6 \| 24.3, 24.7 | 86, 107 \| 70.5, 102 |
| own JS, share of wall | 57 to 66% | 51 to 54% | 23 to 34% |
| own JS a question, µs | 0.23 \| 0.23 | 0.33 \| 0.27 | 0.37 to 0.46 \| 0.32 to 0.46 |
| a kept message's layout at a width met before, µs | 2.7 \| 2.1 (1.8 \| 1.0 at my head) | 6.3 \| 4.9 | 3.1 \| 2.2 |

In Chrome the two methods disagree by 20 to 30 µs a message (6 to 11 points of the wall), because the Map perturbs
Chrome: a string used as a Map key is internalized, which changes its storage (research/BLINK-STRING-STORAGE.md), and
V8's lookups of long keys cost more (the Map alone is 11 to 15 µs a message there). Trust the timed method in Chrome
and read the Map method as an upper bound.

**The ports with every Canvas call free**, under the same stand-in Canvas behind a Map, in bun, base tree, my
exclusive stretch (`timed-2/floors.txt`; 10,000, 3,000 and 2,000 messages; JavaScriptCore, and the stand-in's answers,
so Blink's pieces aren't Chrome's): own JS 7.9 (WebKit), 19.3 (Gecko) and 116.8 (Blink) µs a plain ASCII message, 11.3,
45.2 and 131.3 on the mix, for 31.7, 120.5 and 266.8 questions (40.2, 158.4, 270.0).

- **Rules, the largest share.** WebKit measures an inline text item alone, with its following space, when it builds
  its items, keeps the width on the item, and fills lines by adding: the port asks one question a word in `prepare`
  and nothing at a new width. Its break opportunities on Latin-1 text are a pair table. Blink shapes a whole run and
  needs positions inside it, which Canvas gives only as differences of totals, at every candidate offset; Gecko
  measures words but has to place what crosses a break inside a word. That is 7 and 2.9 times WebKit's questions in
  the real browsers, and it sets the own JS too, because nearly all of a port's code runs per question.
- **The browser, nearly as large for Chrome.** A WebKit `measureText` is 120 to 170 ns, Firefox's 240 to 320 ns,
  Chrome's 1,050 ns. Chrome's Canvas time a plain message is 55 times WebKit's: 7 times the questions at 8 times the
  price. No port can change the price.
- **Code, the smallest share.** Per question Blink's port runs 1.4 to 2 times WebKit's code and Gecko's 1.2 to 1.4
  times. If Blink's port were as lean per question as this one it would save 20 to 50 µs of Chrome's 304.
- **What Blink's and Gecko's owners can take from this.** (1) The floor: Blink's own code is 0.7 to 1.07 s per 10,000
  messages in real Chrome and 1.17 to 1.31 s under JavaScriptCore with Canvas free, not 0.5 s; Gecko's is 0.24 to
  0.45 s, half of Firefox's time. (2) *A kept segmenter:* `engines/gecko/linebreak.ts:50` makes an `Intl.Segmenter`
  per slice of a dictionary script and `engines/blink/breaks.ts:168` a `v8BreakIterator` per line start that reaches
  one; both can keep one and hand it the text (7.8 µs against 1.9 µs a range in JavaScriptCore; Thai here went from
  48 to 20 µs a message). (3) *Fill by sums where every value a line needs is kept, and let the full breaker decide
  only the item that ends the line* (commit 4). It is worth what their layouts at a width met before cost, 2 to 6 µs:
  small beside their from-scratch time, the whole of a resize back to a known width. Their fills aren't item lists
  with widths, so it is the idea that carries, not the code. (4) Commits 1 and 2 are in shared files, so Blink's font
  checks and family parsing already have them. (5) Firefox's fill is 65 to 72% of its wall time and more than half of
  that is own code (the phases in `timed-6/firefox/summary.txt`): that, not `prepare`, is where Gecko's profile should
  look first.

### 10. Problems and deviations

- The machine was loaded throughout (section 1). I held the exclusive lock six times, 2 to 8 minutes each.
- Individual gains under 2 to 3% are at this method's floor (section 1). That covers commits 1 and 2 taken one by
  one, above all commit 2 on plain ASCII. Together they are outside it; I kept both and say so.
- My worktree couldn't hold still for a gates run, so the gates ran on copies of the tree with the change's
  `rebuild/src` (made a git repository each, because `gates.ts` keys its inputs by `git ls-files`). In a copy the
  reference's commit is unknown, so Chrome's string storage rule fires whatever changed. In the real tree it fires
  for commit 1, since `font-checks.ts` is under `rebuild/src/measure`: Chrome's tier 2 is the merge's browser step
  for it. Commit 1 builds no measured string (the strings are the same literals).
- The copies' unit-test gate exits 1 on 5 s timeouts under load (`lab/rows.test.ts` twice, the rule families, a
  hook), never in a file I touched. The full suite run by hand with a 60 s timeout passes. A first such run overlapped
  an edit of `lines.ts` and was run again at the clean head.
- The trees timed for commits 1 and 2 differ from the commits by the wording of a comment; the head's tree is the
  commit's byte for byte.
- I killed only my own processes (three gate scripts and their children, pids in the progress log).
- DESIGN.md holds numbers from these loaded runs (§2.9, §4.6, §6.3); they are ratios' worth, and a quiet run should
  replace them at the merge.
- The Chrome and Firefox numbers of section 9 are one short run each under load (3,000 messages, 3 passes), by a page
  that isn't theirs: their owners' profiles overrule mine where they differ.
- Not done: the changes' gain in installed Safari (webkit-host only), the same stretch for `LineBuilder`, and any
  NEEDS STATE or CHANGES QUESTIONS item.

### 11. Files

- Tools: `rebuild/tools/own-js-profile.ts`, `own-js-probe.ts`, `own-js-probe-entry.ts`, `own-js-summary.ts`;
  `rebuild/probes/runner.ts --isolated`.
- Runs: `timed-1` to `timed-6`, `smoke-1`, `cpuprof/` under the bench folder above; `gates-quick-*.log`,
  `gates-stack/`, `gates-k-*/`, `tier1-head-*`, `function-set-head-*`, `unit-tests-head-0cb23db.log` under the runs
  folder above.
- The running log: `~/github/pretext-rebuild-wt/prof-webkit/.progress-prof-webkit.txt`.
