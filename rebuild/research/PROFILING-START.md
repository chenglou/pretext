# Where the profiling phase starts (2026-09-19)

The re-architecture is done: the library is simple on purpose, and it is not fast. This is the one place that says what
the profiling and optimization phase starts from, in the order I would take the items, each with what it is expected to
buy from the numbers we have and what could make it unsafe. It collects research/BENCH-NIGHT.md ("The real pass"),
DESIGN.md §4.7, research/RECIPE-COSTS.md and RECIPE-COSTS-BROWSER.md, research/ARCHITECTURE-PLAN-2.md §10 and
research/CAPABILITY-CHECK.md. Nothing here is built, but for item 4's main part, which landed in correctness round 5
(2026-09-19); that round also added item 8. Expected gains are arithmetic over one benchmark run, not results.

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

### 1. The measurer's lifetime: contexts and font-check answers once per font declaration per page

*What.* Today `prepare` makes a paragraph's contexts and runs the font checks for it, and both die with the prepared
paragraph. The change: one object the caller makes once per page (it is also where an invisible store would live later)
holds the contexts by their settings and the checks' answers by declaration and language. `prepare` takes it. Three
engine sites and the checks' resolution take a list from outside (CAPABILITY-CHECK: Blink `index.ts`, WebKit
`content.ts`, Gecko `prepare.ts`, `measure/font-checks.ts`); the records that hold contexts by reference don't change.
The orchestrator kept it out of the re-architecture's last step so that it is measured against the baseline above.
Since the fresh-eyes follow-up (2026-09-19) Gecko's recipes hold their contexts by reference too, which the review
named as the precondition: `RunContexts` is the record per font declaration, language, direction and ligature state,
and `prepareGecko`'s two lists, the contexts and those records, are what would come from outside. Each lazy fill would
then search the page's list once per record and not at every ask. With a page's lifetime the recipe contexts could be
made eagerly and the record's nullable fields could go, which changes the context count and so needs a new recording.
The language parse in `advance.ts` `pairFactDescribes`, which runs at each ask for a script run of Common characters
alone, belongs on the record once the record is the page's.

*Why first.* By measured share, not opinion: Chrome's 43% making contexts plus 31% font checks (the two overlap: 6.4 of
the 11.1 contexts are the checks'), webkit-host's 26% font checks plus most of its per-call cost. It also ends the
45,000 live canvases of kept paragraphs.

*Expected.*
- Chrome: with the checks lifted the benchmark's own variant runs at 0.69 of from-scratch on the mix (838 µs against
  1.21 ms a message). The engine's own 4.7 contexts a message are about 220 µs more at 47 µs each. Together about half
  of from-scratch time on the mix and about a fifth on plain ASCII, where contexts weighed 12% in the same run: roughly
  9.6 s to 5 s, and 4.2 s to 3.3 s. Not under the bar by itself; what remains is 310 calls a message (items 2 and 6).
- webkit-host: the checks' 26% goes. If a call in a context that has already resolved its font costs what main's does
  (about 9 µs against 28 µs), the engine's 32 calls a message come to about 0.3 ms against 1.17 ms: roughly 11.7 s to
  3 or 4 s. This is the least certain estimate here, and the cheapest to check: CAPABILITY-CHECK's three one-line sites
  in a benchmark variant.
- Firefox: at most 5%. Gecko's checks ask nothing, and it makes 3.6 contexts a message at 5% of its time.

*What could make it unsafe.*
- Chrome caches shaped words per canvas, and the first shaping of a word on a canvas wins. Per-paragraph contexts made
  every paragraph's measurement history start from nothing; shared contexts make it the page's. The known hazards are
  handled inside one paragraph by partitions (one-byte against two-byte strings of the same characters, research/
  BLINK-STRING-STORAGE.md) and by adding word spacing in JS. Across paragraphs the same hazards need the same answer:
  a segmented and an unsegmented paragraph must not meet on one canvas with the same characters in both storages, so
  the partition has to say the storage for every paragraph, not only segmented ones. Proof: tier 2 with a sharing
  predictor in both orders and a shuffled third order, both configurations, `twins` included, compared case by case with
  the usual run; and the twin scan (`tools/twin-scan.ts`) over a whole set in one page, not per case.
- WebKit and Gecko keep measured words per font, not per canvas, so sharing contexts changes no measurement history
  there. Tier 2 in both orders is enough.
- Staleness: a font-check answer and a context's resolved font are facts of the fonts a page has. A web font that
  loads later changes both. The object needs a stated contract (make it after the fonts the text uses have loaded; make
  a new one when they change), and whether a Chrome context made before a font loaded keeps measuring the fallback
  needs a probe. The library reads nothing from the DOM, so it can't watch `document.fonts` itself.
- Leak: contexts are bounded by the distinct settings a page uses (declaration, language, direction, letter spacing,
  partition). Letter spacing is a continuous value: an application that animates it would grow the list, so unusual
  settings need a bound or a per-call life.

*If sharing proves unsafe in Chrome*, two parts need no sharing and no history argument, only a new recording:
- Contexts made on first use. Blink makes five per style per paragraph (LTR, RTL, the two without ligatures, the
  hyphen's); a plain left-to-right paragraph without a soft hyphen asks one. The two without ligatures serve gap tests
  and limits, which a plain paragraph never runs. About 4 of the engine's 4.7 contexts a message.
- The linear-size check on plain paragraphs. It answers `false` or nothing, and `false` is what a named family gets by
  default, so it decides whether `optical-size` is reported and never how Blink measures (DESIGN.md §4.6); the primary
  family check beside it does decide measuring and stays. It is why Blink's checks run at all for text with no soft
  hyphen and no joining letters at a device pixel ratio other than 1. RECIPE-COSTS-BROWSER found nothing lost with it
  off on all 67,065 Chrome cases; offline it was 10.6% of Chrome's calls and about 4 contexts a case. Once answers live
  per declaration per page it costs nothing worth removing.

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
- *The proof.* Tier 1: 0 predictions changed, repeats only on 3 cases a configuration, 0 other or new questions. The
  function set's plain, pure and sweep checks pass on all 67,065 cases in both configurations. Chrome's tier 2 in both
  orders and both configurations: 0 status transitions, exact values where they were. The plain predictor's line
  ranges equal the usual run's on all 67,065 cases, and so do the layouts after two other widths. That predictor runs
  the inspected path, which reads the kept numbers in `linePieces` alone; the plain path has one of its own now
  (`lab/baselines/plain-other-widths-first-predictor.ts`).
- *What is left.* 44 and 48 calls a message are still repeats by range from scratch (25 and 28 on B1b's tree): a
  cluster alone that two neighbouring pair windows share, the wide window's left side, which is the offset's prefix
  too, a piece's total that every wide window inside it asks again, and the cut's safe test. A layout at a new width
  still asks 34 to 37 questions, 20 to 24 of them new to the paragraph, where Firefox asks 28.

### 3. Gecko: the fill on CJK and Arabic

*What.* Inside a shaping unit Gecko's port finds the advance before an offset as `W(unit) − W(suffix)`, one Canvas
question per offset the break scan consults, each over the rest of the unit. Text without spaces is one long unit, so
the characters sent to Canvas grow with the square of its length. The plan's §10 has the candidate: windows inside long
units (44.6 M characters sent became 0.34 M on 9,000 Chinese units). It changes the recipe, so it asks new questions.

*Expected.* Firefox's mix is 2.63 s against 0.61 s for plain ASCII, and 12% of messages are CJK or Arabic: most of
the 2 s between them. It is what puts Firefox under the bar on the mix, and it bounds the accepted worst case (a
9,428-unit Chinese paragraph took about 11 s on its first layout).

*What could make it unsafe.* A window must start where shaping can't reach across: cluster starts alone aren't enough
where a font kerns or substitutes across them, which is the reason the recipe measures to the unit's end. It needs the
in-word probe's method again (gecko-port F15) on windowed strings, a new recording, and tier 2 in both configurations
(with facts Gecko's positions are predicted values, so the exact-value status blocks a wrong one).

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

### 8. Gecko's lazy plain scan: complexity against about 31 questions a chat message

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
predictor's browser runs. The simpler form reads every candidate whole and costs about 31 questions a chat message in
Firefox, which already meets the bar on plain ASCII and whose cost on the mix is the CJK and Arabic fill (item 3). The
maintainer may prefer the simpler form.

*What would settle it.* Time, not counts: the benchmark with and without the lazy scan on a quiet machine. And item 1:
the probe pairs and the same-face answers depend on the font declaration and the language alone, so a home that
outlives a paragraph pays them once per declaration, not once per paragraph (24 to 30 questions a context today, by
the two probes' medians). With that home the simple form's cost is the 3 to 8 questions of each kerned candidate, and
the comparison should be run again. Note that the cost depends on the width: a paragraph that asks nothing at one
width can ask the probe pairs at another, and the chat smoke measures one width a message.

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
3. **A contexts list handed to `prepare`**, with font checks that outlive one prepare: four sites. This is item 1 above
   seen from the API side; the profiling phase measures it and proves it in the browsers, and the API phase decides how
   an application holds the object.

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
