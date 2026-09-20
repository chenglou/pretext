# Where the profiling phase starts (2026-09-19)

The re-architecture is done: the library is simple on purpose, and it is not fast. This is the one place that says what
the profiling and optimization phase starts from, in the order I would take the items, each with what it is expected to
buy from the numbers we have and what could make it unsafe. It collects research/BENCH-NIGHT.md ("The real pass"),
DESIGN.md §4.7, research/RECIPE-COSTS.md and RECIPE-COSTS-BROWSER.md, research/ARCHITECTURE-PLAN-2.md §10 and
research/CAPABILITY-CHECK.md. Nothing here is built, but for item 4's main part, which landed in correctness round 5
(2026-09-19), and item 1, built in its smaller form the same day; that round also added item 8. Items 2 and 3 were
built and merged on 2026-09-20, and item 8's trade was measured and settled with item 3 (the plain scan in its simple
form). Expected gains are arithmetic over one benchmark run, not results.

## The bar, and the rule for what may come back

- **The bar** (the maintainer, 2026-09-18): if 10,000 rich chat messages laid out from scratch still cost about 2 s
  after the performance work, the stateless ideal is dropped. The ideal is one idempotent call, content and style and
  width in, lines out, with nothing for the application to carry per text.
- **What may come back** (the maintainer on caching): acceleration that is invisible, can't go stale and doesn't leak is
  fine. A structure local to one layout call is data flow, not a cache. What outlives a call waits for numbers, apart from
  fixed data with a page's lifetime: parsed engine tables, a Canvas context per font, the runtime font checks' answers
  per font. This phase may add complexity back where a number asks for it; each addition names its lifetime, what
  invalidates it and what bounds it.
- **Correctness does not move.** Every item below is held by the tiers (rebuild/TESTS.md, "Tiers"), and "How a change is
  held" says what each kind of change shows as.

## The numbers we start from

**Corrected on 2026-09-19, in the evening: the timed rows of the table below were taken on a loaded machine and are
wrong for Chrome and webkit-host.** Two agents measured again on a quiet machine, independently, in alternating passes
under the exclusive lock (research/PERF-LIFETIME.md). 10,000 chat messages from scratch, the library as it was at the
table's run: Chrome 4.6 s on the mix and 4.0 s on plain ASCII (not 9.59 and 4.16 s); Firefox 2.76 s and 0.58 s;
webkit-host 0.235 s and 0.195 s (not 11.7 and 8.83 s), with main's cold prepare at 0.31 s there (not 1.53 s). So
webkit-host is far under the bar already, and what the table's reading says of it (each call three times main's, every
new context paying for its font) was the load, not the engine. The counts in the second table don't depend on load and
stand. Item 1's "Expected" below is corrected by the same document: in Chrome the font checks' contexts were the cost,
not the engine's, and the item bought a fifth, not a half.

One run of `rebuild/bench/chat-night.sh`, 2026-09-19, the library at the X3 merge (the last step changed no question),
no supplied font facts, background windows. Chrome ran under load that fell during its run, so its timed rows are upper
bounds until a quiet rerun, which the phase should take first; counts don't depend on load.

| 10,000 chat messages | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| from scratch, the mix (27% hold emoji, CJK, Arabic, a URL or a code span) | 9.59 s | 2.63 s | 11.7 s |
| from scratch, plain ASCII only | 4.16 s | 0.61 s | 8.83 s |
| main, cold prepare, the mix | 0.72 s | 0.30 s | 1.53 s |
| kept, then laid out at 3 new widths | 4.04 s | 0.70 s | 0.21 s |
| main, layout at 3 new widths | 0.008 s | 0.014 s | 0.014 s |

| Per message, the mix, from scratch | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| `measureText` calls (main's) | 322 (7) | 120 (7) | 41 (17) |
| Canvas contexts made (main makes none in a batch) | 11.1 | 3.6 | 5.4 |
| of them the runtime font checks: calls, contexts | 10.8, 6.4 | 0, 0 | 9.5, 4.2 |
| time: font checks / engine prepare / fill | 31% / 56% / 13% | 0% / 11% / 88% | 26% / 74% / 1% |
| time: inside `measureText` / making contexts / outside Canvas | 39% / 43% / 18% | 58% / 5% / 37% | 98% / 1% / 1% |
| calls per layout at a new width / at a width met before | 137 / 137 | 28 / 0 | 0.1 / 0.1 |
| time per layout at a new width / met before | 211 µs / 116 µs | 21 µs / 6 µs | 7 µs / 7 µs |

Read from it:

- **Chrome** pays for contexts (about 47 µs each by these shares, 11 a message) and for the font checks, which are 10 of
  322 calls but 6 of 11 contexts. A relayout asks Canvas as much at a width it has met as at a new one.
- **webkit-host** is nearly all inside `measureText`, at few calls: each call costs about three times main's, which the
  benchmark's author reads as every new context paying to resolve its font on first use (5.4 new contexts a message).
  Relayout is already cheap.
- **Firefox** has nothing to lift from the checks. The fill is 88%, carried by CJK and Arabic messages: a CJK message
  cost about 14 times a Latin one in the smoke (312 calls for 80 units). Plain ASCII already meets the bar.
- Kept prepared paragraphs keep their canvases alive: about 45,000 live contexts for 10,000 kept chat messages in Chrome.

On the recorded tier sets (DESIGN.md §4.7): the plain path asks 234 questions a paragraph in Blink for 61 distinct ones
(ratio 3.84), 39 for 26 in WebKit (1.50), 55 for 39 in Gecko (1.41). Distinct questions never rose in the
re-architecture; what rose is the same question asked again.

**Moved by correctness round 5** (2026-09-19, after the benchmark run above; research/CORRECTNESS-ROUND-5.md has the
cost of each fix). Counts, not times; nobody has timed the benchmark since.

- WebKit's plain path asks 36.51 questions a paragraph on the tier sets, from 39.32 (18.83 from 21.65 with the lab's
  facts): every box measures its space once as it is made, which was item 4. The nine giants ask 295,170 calls on the
  plain path where they asked 707,622; each of the eight reordered ones asks about one question a word where it asked
  three. In the bench's chat smoke of 200 messages the mix goes from 38.15 to 36.79 calls a message and the Arabic
  messages from 45.75 to 23.08; the Latin set stays at 31.39.
- Gecko's plain path asks 55.07, from 54.56: pair placement asked of Canvas, a joined suffix measured behind its own
  first letter and a boundary U+00A0 measured as itself. The chat smoke's mix stays at 110.67 calls a message and plain
  Latin at 82.15, and a first layout at a new width at 28.2 and 31.86, because a plain paragraph's break scan leaves
  the new questions out until a fit test or an edge needs them (item 8).
- Blink's plain path asks 234.31, as before: its fix asks other strings, not more.
- Distinct questions weren't counted again, so the ratios above are of before the round.

## How a change is held

- **Tier 1** (`bun rebuild/tests/replay.ts check --browser=all --config=all`) classes every changed case. A change that
  keeps a value instead of asking again shows as *repeats only* or *dropped only* (exit 3): provable offline, and then
  one browser run, since a Chrome canvas answers by what it shaped before. A change that asks earlier, elsewhere or
  something new shows as *other* or *new questions* (exit 4): the replay can't answer it, so it needs a new recording
  (`browser-sets.ts --record`, `replay.ts pack`, `freeze`), and tier 2's ledger transitions carry the proof. Fewer
  contexts with the same questions is classed as other questions too.
- **`tests/function-set.ts plain`, `pure` and `sweep`** hold plain to inspected, purity and one prepared paragraph at
  many widths. A store read on both paths must keep them equal.
- **`tools/two-trees.ts`** compares two checkouts on any cases at any widths under a stand-in Canvas, where a change
  asks questions no record holds.
- **Tier 2** in both orders and both configurations at each item's end; the plain predictor's run for question order.
- **Records are per case.** Tier 1's records hold what one case asked in a page where nothing outlived a paragraph. An
  object that outlives paragraphs makes a later case ask less than its record holds, and the first case of a page ask
  what the others no longer do. So the lab's usual predictor should keep making what it needs per case, which keeps the
  records and the references valid, and sharing should be a predictor of its own (as `lab/baselines/plain-predictor.ts`
  and `other-widths-first-predictor.ts` are), compared with the usual run case by case (`tests/compare-sets.ts`).
- **The benchmark** is the phase's clock: `rebuild/bench/chat-night.sh <out>` under the exclusive lock on a quiet
  machine, before and after each item, alternating pairs where a difference is small (lab/README.md, "Baselines for the
  tripwire", has why one timed run isn't enough).

## The items, in order

### 1. A page's list of Canvas contexts (done, in its smaller form)

*Done on 2026-09-19* (`prepare(paragraph, env, inspect, contexts)`; DESIGN.md §4.6, "A page's list of contexts", has the
list's lifetime, what invalidates it and what bounds it). The item as planned was one object per page that holds the
Canvas contexts and the font checks' answers. A prototype built that, and its review measured the list of contexts alone
at nearly the same gain and found the kept answers to be the one part that goes stale silently after a web font loads
(research/PERF-LIFETIME.md). So `prepare` takes a plain `Context[]`, the caller's, a page's or one call's when nothing
is passed, and keeps nothing else: the font checks ask Canvas again at every `prepare`, on the kept contexts. Library
code: 15 lines added and 13 removed in five files (`index.ts`, `measure/font-checks.ts` and the three engines' prepare).

*Since 2026-09-20 Gecko keeps no list* (research/CONTEXTS-HEAL.md; DESIGN.md §4.6, "What invalidates it"). A kept
Firefox context stays on the fallback font for a family name Firefox learns after start-up, nothing a page can assign
makes it look again and no event tells a page, so Gecko's `prepare` makes its contexts anew whatever list it is handed.
Firefox's gain below is given back (2.51 s to 2.76 s on the mix and 0.46 s to 0.58 s on plain ASCII, so Firefox is at
2.76 s on the mix against the bar), and what below counts on a page's list in Gecko no longer has one.

*What it bought.* 10,000 chat messages from scratch, a list a message against one list a pass, taking turns in one
document on a quiet machine (measured by the prototype's review as a variant of the bench page,
research/PERF-LIFETIME.md, the review's §4; this form's own run, `.artifacts/bench/contexts-20260919/two`, was taken
while other work kept the machine about twice as slow, and gives the same ratios in five alternating pairs: Chrome ×0.75
on the mix and ×0.86 on plain ASCII, webkit-host ×0.59 and ×0.58): Chrome 4.60 s to 3.70 s on the mix and 4.01 s to 3.35
s on plain ASCII; webkit-host 235 ms to 138 ms and 195 ms to 104 ms; Firefox 2.76 s to 2.51 s and 0.58 s to 0.46 s.
Contexts made a message go from 11.07 to 0.024 in Chrome, 3.56 to 0.013 in Firefox (the prototype's count; Firefox's
bench wasn't run again) and 5.38 to 0.011 in webkit-host, and the `measureText` calls stay what they were (322, 120 and
40 a message on the mix), since the checks ask again. A kept paragraph no longer keeps about five canvases of its own
alive in Chrome. Against the bar of 2 s: Chrome is not there, Firefox is there on ASCII and at 2.5 s on the mix,
webkit-host is far under.

*What it costs.* In Chrome, kept plain ASCII paragraphs lay out again about 1.24 times slower at a width they have met
(×1.27 in this form's own timed rows, 54.7 µs to 69.7 µs a layout under load; ×1.24 in the prototype's review on a quiet
machine, 48 µs to 60 µs), because a page's canvas is asked more distinct strings than Chrome's per-canvas cache of
32,768 holds. It costs time only, and item 2 is what removes it. The list is bounded at 512 contexts, a cliff at about
60 font declarations used in turn in Chrome (DESIGN.md §4.6).

*How it is held* (TESTS.md, "Tiers"; `.artifacts/tests/runs/contexts-20260919`). The lab's usual predictors hand
`prepare` no list, so the records and the references stay valid: the full offline gates exit 0, tier 1 with 0
predictions and 0 questions changed (Chrome's exits 3 by the string storage rule alone, and its usual tier 2 shows 0
transitions in both configurations). A page's list is three predictors of its own
(`lab/baselines/page-contexts-*.ts`), compared with the usual recordings case by case. Chrome, where a shared canvas is
a new history: 0 of 134,130 rows differ in file order and reversed and 0 of 67,065 in a shuffled third order, in each
configuration, `twins` included; 0 of 67,065 line ranges on the plain path; and the twin scan over each case file as one
page finds no context asked the same characters in both storages. webkit-host: 0 of 127,974 rows in each
configuration. Firefox: 0 of 127,542 with facts, and without facts 7 cases of one reversed part, all history-dependent
in the reference ledger, each predicting what the usual recording predicts for it in the other order: the process's two
fallback-font states. Probes: a font that loads after a context was made (Chrome's and Firefox's kept contexts measure
with it, webkit-host's don't), `<html lang>` changing, and Chrome's device scale factor changing under kept contexts
(nothing moves).

*What is left of the item.*
- The font checks still ask at every `prepare`: 10.8 `measureText` calls a chat message in Chrome and 9.5 in
  webkit-host, on contexts that are already made (Gecko's checks ask nothing). The linear-size check on plain paragraphs
  is most of Blink's; it answers `false` or nothing, and `false` is what a named family gets by default, so it decides
  whether `optical-size` is reported and never how Blink measures (DESIGN.md §4.6). RECIPE-COSTS-BROWSER found nothing
  lost with it off on all 67,065 Chrome cases. Dropping it on plain paragraphs changes the questions, so it needs a new
  recording.
- Gecko's recipe contexts are still made on first use, behind nullable fields on `RunContexts`. With a page's list they
  could be made eagerly and the fields could lose their null, which changes the context count and needs a new
  recording. The language parse in `advance.ts` `pairFactDescribes`, which runs at each ask for a script run of Common
  characters alone, belongs on that record.
- Blink makes five contexts per style per paragraph and a plain left-to-right paragraph without a soft hyphen asks
  one. With a page's list the other four are made once per style per page, so making them on first use no longer buys
  anything worth a recording.
- A home for facts that depend on the declaration and the language alone (item 8's probe pairs) was not built:
  nothing derived is kept, because the library can't see the page's fonts change. It waits for the API phase's store,
  which needs an answer to the same question.

### 2. Blink: positions asked again, inside one fill and at every width

*What.* Two stores, both by offset and both with the prepared paragraph's or a fill's lifetime, so neither can go stale
or leak. (a) Per-fill positions and safe flags kept on the item's shape result, as Blink's own `ShapeResult` keeps
character positions: built unmerged on `ra-x2-blink-alt-positions` (d63c427), where the plain path's ask ratio went from
4.11 to 2.95 and fill asks fell 42% on a sample, tier 1 repeats only, plain and pure checks passing. It predates
canonical gap lists; since them a handed-out list doesn't regroup when a measurement is left out, so it can be read back
on inspected paragraphs too, which nobody has tried. (b) Per-offset tables on the prepared paragraph, filled on first
read: positions and the pair, wide and no-ligature adjustments. With the memo off 60.5% of Blink's repeated asks were
the pair adjustment at an offset already computed, and the earlier perf look got relayout 4 to 5 times faster.

*Expected.* From scratch, at most the fill's share: 13% on the mix, 20% on plain ASCII. For a resize it is the whole
cost: Chrome asks 137 questions per layout at a width it has met before, where Firefox asks 0 and takes 6 µs. (b) should
bring Chrome's relayout of kept paragraphs from 4.04 s toward Firefox's 0.7 s for 30,000 layouts.

*What could make it unsafe.* Blink's adjustments depend on the shaping call's range as well as the offset, so a table
entry is keyed by both or not shared. On an inspected paragraph every `measure16` raises its range's gaps: a table must
never short-circuit a raise that adds a new range (canonical lists make a repeated raise harmless, not a missing one).
Chrome answers a repeat from its per-canvas cache, so dropping repeats can't change an answer: tier 1 repeats only or
dropped only, then tier 2 both orders and the other-widths-first predictor.

*Built (2026-09-19, branch `x-perf-positions`; DESIGN.md §4.6 has the structure and §4.7 the counts).* First the
measurement, because the expectation above was about the fill alone. A repeat was counted by the range `measure16` is
asked for (`tools/positions-study.ts` offline, `tools/positions-probe.ts` in real Chrome over the bench's first 1,000
messages). Of a plain ASCII message's 282 calls, 116 ask a range again: 33 inside `prepare`, 36 inside one line, 36 in
a fill for what `prepare` asked, 11 for what an earlier line asked. The mix: 143 of 322, as 38, 48, 42 and 14. The tier
cases' plain path: 131 of 194, as 18, 81, 17 and 14. So tables with the paragraph's lifetime can take 41% and 44% of a
chat message's calls from scratch, not only a share of the fill's; tables with a fill's lifetime, (a), only 13% and
15%, and (a) as built on `ra-x2-blink-alt-positions`, adapted, took 4% and 6%. The repeats inside `prepare` are
item 6's B1b by another name: the cut's safe test, asked again as the position at the cut.
- *What was built.* (b) alone, in its smallest form: per offset of a shaping group, the position and the pair and wide
  adjustments of the group's own shaping call, 48 lines in `engines/blink` (`shape.ts` 29, `types.ts` 14, `index.ts`
  5), read and written only by reads that raise no gap. A reshape's adjustments aren't kept (another call's range),
  the no-ligature ones aren't asked on the plain path, and the safe-to-break flags are read from the two adjustments.
  An inspected paragraph measures as before, so every line's gaps hold what its reads raise.
- *Calls in real Chrome.* From scratch 281.9 to 210.5 a plain ASCII message and 322.1 to 227.3 on the mix; on B1b's
  tree 177.9 to 125.2 and 211.9 to 140.2. A layout of a kept message at a new width 112.9 to 33.7 and 136.8 to 36.2;
  at a width met before 112.9 and 136.8 to 0 and 0.04. The tier cases' plain path 234.31 to 114.37 a paragraph
  (asked to distinct 3.84 to 1.87).
- *Time* (one exclusive stretch of three alternating pairs of the bench's headline, 1-minute load 3 to 7 after the
  first run; `.artifacts/bench/perf-positions-20260919`). 10,000 messages from scratch: the mix 4.65 to 4.29 s, plain
  ASCII 4.00 to 3.74 s (medians of three runs of three passes a side; a side's runs lie within 0.12 s). So the
  expectation held in time, though not in calls: a quarter of the calls went and 7% of the time, because every call
  that went was a repeat, which Chrome answers from its canvas. Kept, then laid out at 3 widths, one pass a run: the
  mix 3.77 to 1.08 s (runs 2.39, 3.77 and 4.15 against 1.08, 1.07 and 1.12), plain ASCII 3.14 to 1.11 s (3.14, 2.72
  and 3.68 against 2.02, 1.04 and 1.11).
- *The proof.* Tier 1: 0 predictions changed, repeats only on 3 cases a configuration, 0 other or new questions. The
  function set's plain, pure and sweep checks pass on all 67,065 cases in both configurations. Chrome's tier 2 in both
  orders and both configurations: 0 status transitions, exact values where they were. The plain predictor's line
  ranges equal the usual run's on all 67,065 cases, and so do the layouts after two other widths. That predictor runs
  the inspected path, which reads the kept numbers in `linePieces` alone; the plain path has one of its own now
  (`lab/baselines/plain-other-widths-first-predictor.ts`), and its line ranges equal the usual run's on all 67,065
  cases.
- *What is left.* 44 and 48 calls a message are still repeats by range from scratch (25 and 28 on B1b's tree): a
  cluster alone that two neighbouring pair windows share, the wide window's left side, which is the offset's prefix
  too, a piece's total that every wide window inside it asks again, and the cut's safe test. A layout at a new width
  still asks 34 to 37 questions, 20 to 24 of them new to the paragraph, where Firefox asks 28.

### 3. Gecko: the fill on CJK and Arabic

*What.* Inside a shaping unit Gecko's port finds the advance before an offset as `W(unit) − W(suffix)`, one Canvas
question per offset the break scan consults, each over the rest of the unit. Text without spaces is one long unit, so
the characters sent to Canvas grow with the square of its length. The plan's §10 has the candidate: windows inside long
units (44.6 M characters sent became 0.34 M on 9,000 Chinese units). It changes the recipe, so it asks new questions.

**Built, unmerged, on branch `x-perf-gecko-fill` (2026-09-19).** The recipe, its cut rule and its probe are in DESIGN.md
§4.4 ("Recipe added in the profiling phase"); what follows is what was found, what it buys and how it is held.

*What was found first.*
- The cost is CJK, not Arabic. By the bench's own table by kind (Firefox, 1,000 messages of the mix, an earlier quiet
  run, `.artifacts/bench/perf-lifetime-20260919/night-1/firefox-bench.md`): a CJK message took 2.58 ms and 478 calls, a
  Latin one 66 µs and 81 calls, an Arabic one 123 µs and 47 calls. The 8% of messages that are CJK were 73% of the mix's
  time; Arabic messages were 2.5%. Arabic text has spaces, so its units are words.
- Gecko doesn't shape CJK in pieces. A word of more than 32 characters skips the word cache and goes whole to one
  shaping call (gfxFont.cpp:3804-3808), which is cut only at 32,760 units (:3564-3617). CJK scripts turn kerning off
  (gfxHarfBuzzShaper.cpp:1405-1438), not ligatures or contextual forms. So no cut inside a unit is exact by
  construction, for any script.
- So a cut is exact by Canvas or it isn't made. The rule is made of the tests the in-word recipes already make before
  they call an advance exact, over 16 clusters on each side of the cut: the two sides add up, the pair of clusters at the
  cut has one ink box with and without ligatures, the ligature group counts add up; text rules keep out a cut between
  joined letters and before a mark that starts a cluster; and the windows of a unit must add up to the unit. A cut
  that fails leaves its cells in one window, and a unit where nothing holds keeps the long questions. No script class
  is named anywhere: Thai, Khmer, Burmese and Devanagari get windows where Canvas agrees, and a long URL does too.
- Probe `gecko-windows` (the in-word probe's method; `.artifacts/probes/perf-gecko-fill-20260919/windows-2`): 54
  samples over eleven script and font-edge classes, every cluster boundary tried as a cut. All 13,435 cuts that hold
  give the long recipe's value, and so do all 14,040 offsets inside windows whose sides add up. Against the DOM the two
  recipes agree or miss together (13,135 of the 13,435; the rest are Noto Nastaliq Urdu and an emoji's device-size
  advance). 377 cuts fail the sum (kerned Latin pairs, Arabic), 21 the ink box (`fi` in Helvetica Neue), none the group
  count.

*Counts* (pinned Firefox, `tools/fill-counts-probe.ts`, the first 1,000 messages of each set from scratch at 320 px;
runs `counts-before-1` and `counts-after-1` beside the probe's; lines equal in both, 3,407 and 3,043):

| per message | calls before | calls after | units sent before | units sent after |
|---|---:|---:|---:|---:|
| CJK (81 messages, mean 122 units) | 478.01 | 516.53 | 23,499 | 2,944 |
| Arabic (58) | 47.29 | 47.29 | 161 | 161 |
| Latin with a URL (57) | 189.63 | 207.96 | 1,227 | 1,153 |
| plain Latin (551) | 80.97 | 80.97 | 239 | 239 |
| the mix | 120.44 | 124.63 | 2,188 | 519 |
| plain ASCII set | 78.35 | 78.35 | 232 | 232 |
| one Chinese unit of 9,428 units | 37,316 | 40,658 | 41.68 M | 0.23 M |

A window costs questions (8 a cut), so calls rise 8% on CJK while the units sent fall to an eighth. The other kinds
hold no unit of more than 32 code units but a URL.

*Time.* The bench's headline in pinned Firefox, a background window, 10,000 messages from scratch
(`bench/run.ts --smoke --messages=1000 --phase-passes=3 --scenarios=chat --headline=10000`): the base and the branch in
three alternating pairs inside one exclusive stretch of 5 minutes, the 1-minute load average 7.5 at the first run and
3.7 to 5.8 after it. A run's number is the median of its 3 passes; below, the median of the 3 runs and their range
(`.artifacts/bench/perf-gecko-fill-20260919/A`, `A-summary.txt`).

| Firefox, 10,000 messages from scratch | before | after |
|---|---:|---:|
| the mix | 2,559 ms (2,535 to 2,626) | 1,037 ms (1,033 to 1,042) |
| plain ASCII | 597 ms (583 to 607) | 582 ms (574 to 587) |

| per message, the instrumented pass over 1,000 messages, µs | before | after |
|---|---:|---:|
| CJK | 2,492 | 493 |
| plain Latin | 62 | 62 |
| Arabic | 112 | 115 |
| Latin with a URL | 145 | 137 |
| Latin with an emoji, with curly quotes, with a code span, app text | 88, 77, 104, 109 | 87, 76, 104, 108 |

One Chinese unit of 9,428 units, its first layout at 320 px, timed once in each tree in two sittings, both on a loaded
machine (1-minute load about 50; `counts-before-1` and `counts-after-1`, `counts-timed-base` and `counts-timed-head`):
12.0 s and 10.4 s before, 0.16 s and 0.11 s after, 475 lines both. At 3,000 units 1.19 and 1.09 s before, 0.04 s
after; at 1,000 units 0.14 and 0.12 s before, 0.03 and 0.01 s after: the cost grows with the length now, not with its
square. The nine giants' time can't move, since 8 of them ask the same calls: a timed stretch of two alternating pairs
was spoiled by other owners' load rising from 3.6 to 51 during it (the rows' prediction time over the nine, in run
order: base 8.27 s, branch 8.89 s, base 9.35 s, branch 10.94 s; `giants-timed-*`).

Firefox's mix is at 1.04 s against the 2 s bar, 0.41 of what it was, and plain ASCII doesn't move. What is left of the
mix by kind (time a message times messages, the instrumented pass): CJK 36% (it was 74%), plain Latin 31%, Latin with a
URL 7%, Arabic, curly quotes and code spans 6% each, emoji 5%, app text 3%.


*How it is held.* It asks new questions, so tier 1 exits 4: 1,872 cases ask a question the record lacks and 2 ask
others, 0 predictions change, and 61,897 of 63,771 cases are the same (units of at most 32 code units ask what they
asked). Recorded in pinned Firefox, both orders, both configurations
(`.artifacts/tests/runs/perf-gecko-fill-20260919/no-facts`, `facts`): 0 status transitions against the frozen ledgers,
exact values not worse (239 and 742 differing predicted values, 112 and 100 rect counts, as before), the gate passes
with lost 0. Case by case against the reference recording (`compare-sets.ts --prediction=without-measure`, both orders):
without facts 0 native observations differ and 39 cases differ in a prediction, each in one number of an
`in-word-prefix` gap's detail (W(unit) is now the window's width); with facts the same 39, and 74 cases that are
marked history-dependent in the frozen ledger and ask unchanged questions (the process's two font states; the same
count as between two usual runs, research/PERF-LIFETIME.md). The plain predictor's run differs from the usual run in
120 native observations and 14 line ranges, the reference's own numbers at the correctness round 5 merge, every one
marked history-dependent and none among the changed cases. The nine giants hold words and no long unit in Firefox:
their predictions equal the base's on the lab path and the plain path, 8 ask the same calls and the English one 1,050
more of 843,386. `windows.test.ts` pins the rule: a kerned pair across a cut and a ligature as wide as its parts across
a cut keep their cells in one window, and the lines are the glyph records' at every width of a sweep.

*Not done offline:* the function set's plain and pure checks skip the 1,872 cases until a recording with the new
questions is packed; the plain predictor's browser run covers plain against inspected on them.

*At the merge:* record Firefox's two references again on the merged tree (both orders, `--record`), pack and freeze
both, stage the seeds (lost 0 here). Nothing to accept in the citation ledger.

*What is left of the item.* A CJK message still asks 517 questions where a Latin one asks 81: per offset the ink box
test of the pair (2), the suffix and the cluster alone. They are short now; fewer of them is another recipe (cluster
sums where a window's clusters add up, research/PERF-STORE-STUDY.md section 8), not this one.

*Reviewed (2026-09-20), by a second pair of eyes on the same branch.* DESIGN.md §4.4 has what was found about the cut
rule; here is the rest.
- The source. Every citation above holds in the pinned source. Three paths the item hadn't read change nothing: a font
  whose space takes part in shaping has its whole run shaped in one call (gfxFont.cpp:3757-3761, the port's existing
  gap); the CoreText shaper is off by preference (`gfx.font_rendering.coretext.enabled`), so Apple's AAT fonts go
  through HarfBuzz as well; and in system fallback a character takes the previous character's font where that font has
  it (gfxTextRun.cpp:3559-3569), a reach no test beside a cut can see, which the rule's last line holds: the windows
  must add up to the unit. A unit also ends at a script run's limit (`prepare.ts` `initTextRun`), so Japanese text,
  which changes script every few characters, has short units and no windows; the item's CJK is Chinese, and Thai,
  Lao, Khmer, Burmese and Tibetan are the other writing without spaces.
- The cut rule, attacked with the port itself in pinned Firefox (`tools/windows-attack-probe.ts`, 531 paragraphs without
  spaces, 106,457 cluster starts; the same samples as 1,566 lab cases; two runs without windows equal everywhere): no
  line, no exact advance and no drift, in any class but one. A right-to-left script under a direction override is shaped
  reversed or not by what HarfBuzz's whole buffer holds, so Canvas shapes a window of digits alone the other way round
  than the DOM shapes the unit: 32 advances, a line's width and one native break (Hebrew letters and sixty digits under
  U+202D, 24px Arial, 384px: line 1 ends at 30 without windows, as natively, and at 31 with them). Such a unit now has
  no windows (`windowsOf`, `windows-reversed.test.ts`); with that, the lab set has no scorer transition against the
  port without windows. No tier case is of that kind: none of the 2,909 with a stretch of 33 units without white space
  holds a bidi control, so the recordings above stand. Stand-ins aren't always the long recipe's inside a window (4 of
  14,288 Arabic offsets, DESIGN.md §4.4).
- What it buys elsewhere, from the same probe's counts (units sent to Canvas, without windows and with them): Han
  1.48 M and 0.24 M over 36 samples of 33 to 400 units, Thai 1.04 M and 0.17 M, Devanagari 1.78 M and 0.25 M, Khmer
  0.34 M and 0.07 M, Burmese 0.53 M and 0.10 M, nine units of 1,200 to 2,400 units 25.3 M and 0.68 M; calls rise 4%
  over the whole probe (950,962 to 984,419). A rule for Han, kana and Hangul alone would need a script list the rule
  doesn't have now, and would leave Thai and its neighbours with the square.
- The counts above, run again from both trees (`.artifacts/probes/perf-gecko-fill-20260919/attack/counts-base`,
  `counts-item3`, `counts-simple`): every count the same, to the last unit sent (41,684,832 and 231,696 for the long
  unit), and item 8's 132.85 and 87.73.
- The window's size (the counts probe, a CJK message's calls and units sent): 4 clusters 641.00 and 2,209, 8 clusters
  558.14 and 2,460, 12 clusters 529.44 and 2,700, 16 clusters 516.53 and 2,944, 24 clusters 502.14 and 3,453,
  32 clusters 494.80 and 3,950 (`counts-k4` to `counts-k32`; scratch patches beside the review's tools). By the two
  trees' own numbers a call costs about 0.4 µs and a unit about 0.1 µs there (478 calls and 23,499 units in 2,492 µs,
  517 and 2,944 in 493 µs), which puts 8 to 16 clusters within 6% of each other on a CJK message and 32 clusters 18%
  over: 16 stays.
- Windows for Han, kana and Hangul alone (`counts-cjk`, 7 lines more): the same CJK message, a URL back at its 189.63
  calls and 1,227 units, the mix 123.56 calls and 523 units against 124.63 and 519. It buys nothing on the chat mix,
  needs a script list the rule doesn't have, and leaves Thai and its neighbours with the square.
- A smaller cost for the same windows, not built: one ligature group count of the whole unit, the precheck
  `groupAcross` makes of any unit. Where it equals the clusters, no cut needs its group test and every window's count
  is known (6 lines; `variant-seed-on-0edcd64.patch` beside the review's tools). A CJK message then asks 477.37 calls
  and sends 2,297 units (516.53 and 2,944 with the branch, 478.01 and 23,499 without windows), the mix 120.68 and 453,
  the long unit 37,150 and 175,484; about 16% of a CJK message's time by the prices above. The port itself gives the
  same advances, reasons, windows and lines with it on all 531 samples of the review's probe (`dump-seed-1`). It asks
  other questions, so it wants the merge's recording; taken before that recording it costs no second one.
- Time. The bench's driver runs only as the lock wrapper's own child unless its lock override is passed, which the
  review's session wasn't allowed to pass, so a stretch of alternating bench runs wasn't possible. The review timed
  another way: `tools/fill-ab-probe.ts` runs the headline for several checkouts inside one page, in alternating order,
  under one exclusive acquisition, so that whatever the machine does it does to every checkout. Ten rounds
  (`.artifacts/bench/perf-gecko-fill-20260919/attack/AB-2`; the 1-minute load was 37 to 48 from other owners' offline
  work, which the machine's cores absorbed: the numbers are within 4 to 8% of the quiet ones above): the mix 2,654 ms
  before and 1,125 ms after, −1,505 ms in the median round (−1,438 to −1,585 over the ten, −57%); plain ASCII 598 and
  608 ms, +8 ms in the median round with rounds on both sides of 0. Five rounds at a load of 8 to 11 (`AB-1`) gave
  −58% on the mix.

### 4. WebKit: the space of a box measured as the box is made (done), and box constants

*Done in correctness round 5* (2026-09-19, `WebKitBox.spaceWidth`; DESIGN.md §4.4, §4.7). A box whose white space is
deferred (a TAB anywhere in the node, or reordered text) asked its space at every read, about three questions a word;
every box now measures it once as it is made. It moved a first ask, so it took a browser run: tier 2 in both orders
and both configurations moved no status, and the plain predictor's line ranges equal the usual run's on all 63,987
cases. It bought what was expected: 9,174 tier cases ask fewer questions, 187,772 in all and up to 7,611 in one
paragraph; the plain path went from 39.32 to 36.51 questions a paragraph, the nine giants from 707,622 calls to
295,170, and the chat smoke's Arabic messages from 45.75 to 23.08 calls.

*What is left, small.*
- A deferred box that never reads its space now asks one question it didn't: 7,119 tier cases ask one more. A field
  filled on first read would avoid it.
- `tabbedWidth` and `fixedPitchWidth` ask `W(' ')` in the plain context per call, about 23 thousand asks on the tier
  corpus. Where a box has no letter spacing the plain context is the box's context, so the field answers it. Hyphen
  widths are the same kind of per-box constant.

*What could make them unsafe.* Each moves or drops a first ask, which the replay can't judge and WebKit's per-font
caches shouldn't mind: a new recording and tier 2 in both orders.

### 5. Units of equal text in one prepared paragraph share one record of what measuring found

*What.* A word that recurs in a paragraph is measured at each occurrence. One record per distinct unit text, with the
prepared paragraph's lifetime (Gecko's own structure there is the shaped-word cache, gfxFont.cpp:3569-3577); the same
idea covers WebKit's repeated words (267 thousand of its plain path's 844 thousand repeats).

*Expected.* Little for chat messages, which are short. It is the answer to long documents and to the lab: Firefox's
giants take 15.3 s of prediction on the inspected path against 4.2 s with the memo (the one trip of the tripwire), and
the English giant asks 843,386 questions for 54,673 distinct ones. Whether a store by string should outlive a paragraph
is the API phase's question (research/IDEMPOTENT-API.md), not this item's.

*What could make it unsafe.* It must not share where a recipe reads text outside the unit: a script context's character
from elsewhere in the run (`measure.ts` `scriptContextFor`), or the font-matching prefix, which depends on the text
before the unit. Found by string, so in Blink it would bring back the string storage hazard; it is for Gecko and WebKit.

### 6. Recipes that buy nothing, and the good-enough line

The re-architecture already took the largest part of RECIPE-COSTS' finding that most Canvas calls don't decide lines:
a plain paragraph computes no gap and no inspected value (its "lines only" state was −44% of Chrome's calls, −50% of
Firefox's, −15% of WebKit's at the line). What is left on the plain path, from RECIPE-COSTS-BROWSER's completed ranking:

- Nothing lost offline or in the browser: Blink's safe tests for a cut tried beside spaces first (B1a: −5.1% of Chrome's
  calls, the same cuts); the cut's safe test itself (B1b: −12.1%, nothing lost on the 972 cases that couldn't replay;
  it changed gap lists alone); WebKit's check that a listed family resolves (W1a: −0.6%).
- Dear per case bought, the maintainer's call with these prices: Gecko's ligature test by ink box (G2: 36% of Firefox's
  calls at the line, 28 cases lost of 63,771 in the browser, 60,526 calls a case) and its ligature groups by letter
  spacing (G3: 13%, 50 cases); WebKit's fixed-pitch check (S3: 25% of webkit-host's calls, 21 cases) and coverage probe
  (W1b: 9%, 24 cases); Blink's position adjustment without facts (B3: 14%, 421 cases).
- Cheap and worth every call: Blink's safe-to-break tests and reshapes (4 calls a case bought), WebKit's shaping across
  inline boxes (6), its VT, FF and CR recipe (12), Blink's joining check (24).

The corpus those prices come from is adversarial, built from rule families aimed at these recipes, so they say nothing
about how often ordinary text would lose a line. A recipe that goes takes its cases to the known tail by name.

### 7. Engine tables parsed when the module loads

Every table of the three engines is decoded and parsed when its data module loads: about 3 ms and 1 MB under bun, kept
for the page's life, and `src/index.ts` imports all three ports, so a page parses two engines' tables it never runs.
It is fixed data with a page's lifetime, which the rule above allows; what is open is parsing on first use per engine,
and a per-engine entry so a page loads one port (the plan's §9 left a loader out). Measure module load in each browser
first: 3 ms once may not be worth a branch. Dropping the reverse tables and rule source `rbbi.ts` never reads is bundle
size, not time.

### 8. Gecko's lazy plain scan: complexity against 8 to 9 questions a chat message (measured: about 40 ms per 10,000)

*What.* Not a speed-up to build: a trade correctness round 5 made, which this phase may take back. Gecko asks Canvas
which glyph of a kerned pair carries the adjustment (DESIGN.md §4.4). `overflow-wrap: break-word` makes every cluster
of each line's first word a break candidate, so the first build asked those questions on ordinary text: the chat mix
went from 110.67 to 141.49 questions a message (+30.8) and plain Latin from 82.15 to 116.79. The lazy plain scan brought
both back to where they were: a plain paragraph's break scan reads a candidate inside a word without the questions
that only place what crosses it, and asks them where the bound reaches a fit test or at an edge (DESIGN.md §4.6,
"Gecko's lazy plain scan").

*The trade.* It is the most intricate part of the Gecko port. It made a record's value depend on who asked first, and
the round's critic found a real hole in it (fixed, with a unit test built from a constructed paragraph). That a plain
paragraph's lines equal the inspected one's rests on a bound argument plus the plain check, the sweep and the plain
predictor's browser runs. The simpler form reads every candidate whole and costs 8 to 9 questions a chat message (measured below; about 31 in
the round's first build) in
Firefox, which already meets the bar on plain ASCII and whose cost on the mix is the CJK and Arabic fill (item 3). The
maintainer may prefer the simpler form.

*What would settle it.* Time, not counts: the benchmark with and without the lazy scan on a quiet machine. And a home
that outlives a paragraph: the probe pairs and the same-face answers depend on the font declaration and the language
alone, so such a home pays them once per declaration, not once per paragraph (24 to 30 questions a context today, by the
two probes' medians). Item 1 was built without one, because a kept answer goes stale when the page's fonts change and
the library can't see that. With that home the simple form's cost is the 3 to 8 questions of each kerned candidate, and
the comparison should be run again. Note that the cost depends on the width: a paragraph that asks nothing at one width
can ask the probe pairs at another, and the chat smoke measures one width a message.

*Measured (2026-09-20, branch `x-perf-gecko-fill`; nothing of it is in the library).* The simpler form was built as a
scratch patch: the lazy scan taken out of `advance.ts`, `lines.ts` and `types.ts`, 15 lines added and 61 removed, with
`lazy-scan.test.ts` (76 lines) and one case of `gecko.test.ts` to go with it. Four trees were held against each other:
the base and item 3's branch, each with the lazy scan and without.

- Counts (pinned Firefox, the first 1,000 messages of each set, `tools/fill-counts-probe.ts`; lines equal everywhere):
  the simple form asks 128.66 questions a message on the mix where the lazy one asks 120.44 (+8.2), and 87.73 against
  78.35 on plain ASCII (+9.4); with item 3, 132.85 against 124.63 on the mix. The +31 above was the cost of the round's
  first build in a 200-message smoke. Today's pair placement asks its probe pairs only where a pair's own total doesn't
  tell, so the simple form costs 8 to 9 questions a message.
- Time (the bench's headline in pinned Firefox, 10,000 messages from scratch, the four trees in 3 alternating rounds
  inside one exclusive stretch of 7 minutes, 1-minute load 4.4 to 7.7; a run's number is the median of its 3 passes;
  `.artifacts/bench/perf-gecko-fill-20260919/CD`, `CD-summary.txt`). Plain ASCII: 587 ms lazy against 630 ms simple
  before item 3 (+43 ms, +7%; the three rounds +44, +34 and +44), and 596 against 629 ms with item 3 (+33 ms, +6%; two
  rounds +33 and +38, the third held an outlier run). On the mix the difference is inside the runs' spread: 2,617
  against 2,669 ms before item 3 (+52 ms, +2%), and with item 3 1,098 against 1,196 ms with rounds of +98 and +20 ms.
  By the ASCII number and the instrumented pass (a plain Latin message 64 µs against 72 before item 3, 65 against 68
  with it) it is about 40 to 50 ms there too, 4 to 5% of the mix's 1.04 s.
- So the intricate form buys about 40 ms per 10,000 chat messages in Firefox: 6 to 7% of plain ASCII, 2% of the mix
  before item 3 and 4 to 5% with it. Firefox is 3.4 times under the 2 s bar on plain ASCII and 1.9 times on the mix
  with item 3, with either form.

*Recommendation: the simpler form.* The lazy scan buys 4 µs a message in an engine that is 1.9 to 3.4 times under the
bar with or without it, and it pays with the port's most intricate code, a record whose value depends on who asked first
and one of the two accepted exceptions to "nothing writes a prepared paragraph after `prepare`" (DESIGN.md §4.6).
Without it `rebuild/src` is 46 lines shorter, and a plain paragraph's lines equal the inspected one's because both read
the same advances, not by a bound argument.

*Taken on the branch, as its last commits* (the code with its tests and registry entry, then the documents), so that a
merge can leave them out. What holds it: the unit tests; the quick gates (tier 1 as for item 3, 0 predictions changed;
plain and pure 61,899 pass, 0 fail, item 3's 1,872 cases skipped); the sweep in both configurations, 63,771 pass; in
pinned Firefox, both orders and both configurations, 0 status transitions, exact values as before and the gate
passing; without facts, against item 3's own run, every row equal with its counts of Canvas work but 7 rows of one
reversed part, all marked history-dependent, so the inspected path didn't move; the plain predictor's run against that
usual run, 0 line ranges and 0 native observations differing over 63,771 cases
(`.artifacts/tests/runs/perf-gecko-fill-20260919/simple-*`, `compare-simple-*`).

*Reviewed (2026-09-20).* The same in-page alternating runs (item 3's review, `AB-2`, ten rounds) hold the trade: plain
ASCII 608 ms lazy and 663 ms simple with item 3, +26 ms in the median round and more in every one of the ten (+13 to
+87); 598 and 640 ms without item 3, +40 ms in the median round, more in nine of ten. On the mix +30 and +23 ms. So
25 to 45 ms per 10,000 messages, 4 to 7% of plain ASCII, as measured above, and Firefox's mix stays near 1.1 to 1.2 s
with both changes. The reviewer agrees with the simpler form: the port itself gives the same advances, reasons and
lines with it on all 531 samples of the windows' probe, plain and inspected, and the lab set run with it has no scorer
transition against the port at the phase's start.

### 9. Later, with numbers only

From the plan's §10, not started and not ranked here: a bounded store for strings that recur across paragraphs (the API
phase's invisible store), filling measured values in `prepare` or a "words" variant, a relayout loop over flat arrays
with the general path as fallback, the width-interval skip for resize drags, Blink canvases by each string's own storage
class, bounding WebKit's `simplified-measuring` check (inspected path only), dropping a history world's discarded gap
work (the lab only).

## For the API phase, not profiling

research/CAPABILITY-CHECK.md found no door closed and three cheap openers. They are API work and wait for that phase:

1. **A line's width in CSS px**, 3 to 5 lines per engine beside `linePieces` (the conversion exists only in DESIGN.md §2.6
   and the lab's scorer). It opens bubbles, dynamic-layout, editorial-engine, markdown-chat's bubble and marker widths
   and, with a walk at width 0 and the slot-width close, an application's own line breaker in all three engines. It
   should carry Gecko's needed-width rule: the content plus the end border and padding of the spans still open at the
   line's end (DESIGN.md §2.6, "Gecko's exception").
2. **Identity on the painter's DOM through a callback**, 6 lines in `paint.ts`: the application is handed each span and
   atomic box with its element index. It opens rich-note and markdown-chat on `paintLines`.
3. **A contexts list handed to `prepare`**: done as item 1 above, `prepare(paragraph, env, inspect, contexts)` with a
   plain array. The font checks don't outlive one prepare, by decision. The API phase decides how an application holds
   the list, and what it is told about starting a new one: in WebKit after the page adds a FontFace that has already
   loaded, and in Gecko nothing, since Gecko's `prepare` makes its own contexts whatever list it is handed (since
   2026-09-20; DESIGN.md §4.6, "What invalidates it"). It also decides where a page is told to name its families by
   their canonical English names, which is what keeps a Firefox paragraph prepared in the browser's first seconds
   right (research/CONTEXTS-HEAL.md).

Also for that phase, from the fresh-eyes follow-up (2026-09-19): **a font-family list read once, at the library's
boundary**. One parser reads the list today (`src/font-family.ts`), but where a port happens to need a name: Blink per
style, WebKit per text box, Gecko per comparison of two declarations, and the font checks. So a list CSS rejects
throws in one engine and not in another, and a plain Gecko paragraph with one declaration never reads its own.
`CssFont.family` has to stay the string while recorded Canvas font strings and the painter's `font-family` must stay
byte-equal; making the parsed list the model's field, validated once, is this phase's call. `FontFacts.primaryFamily`
has no quoted flag either, so the font checks answer null for a quoted generic that draws (DESIGN.md §1.2).

Next in line there: a line start made from a source offset (8 to 20 lines per engine), which no demo needs yet. Two
properties keep it and streaming text cheap, and hold today: a line start is small plain data that doesn't depend on the
prepared object, and nothing handed to the application aliases prepared data (research/INCREMENTAL-API-READING.md, whose
appendix lists every prepared fact that reads across a forced break or over the whole text).
