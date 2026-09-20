# Tests for the rebuild

Status, 2026-09-19, branch `rebuild-20260916` after the re-architecture (the sections below keep the date of what they describe; "Tiers" has the state now). This replaces the 2026-09-16 test strategy (research/TESTS.md). That strategy made main's accuracy grid, oracles and filed reports first-class obligations. Here main's suite and obligations are a measurement corpus (CHARTER.md tentpole 5). The blocking layers are the rebuild's own:

- rule-targeted families, at widths derived from the browsers' observations;
- versioned probe facts;
- coverage of library rules.

The design is research/TEST-ARCHITECTURE.md. This document says what exists, how to run it and what the first runs found.

## Tiers

What to run after a change, by time (rebuild/lab/README.md, "Test tiers", has the sets, the protocol and what each tier
can't see). Every tier runs two configurations: `no-facts`, the headline, and `facts`.

| Tier | Command | Shows | Measured on 2026-09-18, other jobs running beside |
|---|---|---|---|
| 0 | `bun test rebuild` | a failing unit test | 11 to 15 s then (727 tests); 819 tests in 59 files and 21 to 30 s beside other owners' jobs on 2026-09-19; 862 tests in 64 files since the fresh-eyes follow-up |
| 1 | `bun rebuild/tests/replay.ts check --browser=all --config=all` | every case whose full prediction changed against a frozen reference, from recorded Canvas answers with no browser; the cases that need one | 77 s for six references, 380,882 cases then; 389,646 cases and two to three minutes since the memo went, beside other owners' jobs |
| 2 | `bun rebuild/tests/browser-sets.ts --browser=<browser> --out=<dir>` | status transitions against the reference ledger, of the four metrics and of the exact-value status (a case whose predicted values stop equalling the browser's while every metric passes), lost pairs against the build-keyed seed | forward order, one browser: Chrome 88 s, Firefox 108 s, webkit-host 128 s |
| 3 | the round's evaluation (fresh sets, sealed sets, giants, installed Safari) | new classes on cases nobody saw | REPORT.md |

**The offline gates in one command** (2026-09-19): `bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all]
[--quick]` runs tier 0, tier 1 and the function set's plain and pure checks for an engine's browser (`--quick`, after
every small edit), and without `--quick` also the sweep, the painter differential, the citation ledger and the twin
scan. It reads every exit code from the child process, prints one table (exit code, what it means and which kind of
step accepts it, the report's counts, wall time), and exits 0 only when every gate is fine for a pure refactoring (lab
README "Test tiers"; the file's header has the exit codes). Since the same day tier 1, the plain and pure checks and the
painter differential replay a group of shards a process, which took a third off their CPU time with the same reports
byte for byte; the lab README has the numbers. Since the fresh-eyes follow-up the run's last line names how many cases
tier 1 sends to tier 2, per gate, so "every gate is fine" never reads as done, and a run first removes the
`pretext-gates-<pid>.sock` files of processes that are gone. A full run can take 30 minutes on a shared machine, so
start it detached from anything that has a time limit. Since the same day a run takes a machine-wide turn before its
first gate (one full run and one `--quick` run at a time, first come, first served; it says who holds the turn while it
waits, a killed run holds nobody up, a run whose turn came still waits while under 30% of the machine's memory is free,
and `--no-wait` skips both waits), and a run whose inputs equal an earlier finished
run's prints that run's table and last line again as a reused result, with that run's time, worktree and commit, and
exits with its code in under a second (`--fresh` runs anyway; a run that sends cases to tier 2 is never kept, since a
reused result doesn't write the list tier 2 reads). The key is a hash over everything a gate reads, and `gates.ts`
says what that is once, beside what reads it: what every gate reads (the working tree, the installed packages, the
flags that choose gates) at `inputsKey`, with what it leaves out and why, and what a gate reads of `.artifacts` in the
gate's `reads` list where the gate is made (`gatesOf`), which the key walks; the lab README has the measurements.

**State at the correctness line, 2026-09-18.** The six references under `.artifacts/tests/reference` are frozen at 6b21b68
and pinned in `rebuild/tests/reference/`, packed from `.artifacts/tests/runs/line-20260918/<browser>-<config>` (every tier
set with `rich-prewrap`, both orders, both configurations; Chrome 66,685 cases, Firefox 63,771, webkit-host 63,987; recorded
at feb3937, the same library). All 388,886 cases replay the browser's own prediction exactly, the question sequences
included, and tier 1 exits 0 in 42 s. The recordings equal the round 4 evaluation's (3c17016, before the font checks measured
at text-rendering `optimizeLegibility` in Blink) on every status, per-case file, native observation, prediction and painted
line. The ledger is format 2: beside the four metrics every case has an exact-value status, and tier 2 exits 1 when a case
stops being exact (lab README "The ledger"). The seeds are adopted (§9). The lab README's "The correctness line" has the
commands, the numbers and what the line doesn't hold; the references they replaced described the round 3 library.

**Since the re-architecture's X2 and its painter step, 2026-09-19.** No port keeps a memo any more (DESIGN.md §4.6,
§4.7), so a question a paragraph asks twice is asked of Canvas twice. Against the references frozen before it, tier 1
exits 3 with repeats only in all six: 0 predictions changed, 0 dropped only, 0 other questions, 0 new questions. On the
owners' branches the cases with repeats only were 65,900 without facts and 65,898 with them in Chrome, 52,444 and 52,498
in Firefox, 58,144 and 56,498 in webkit-host. Each engine owner ran tier 2 in both orders and both configurations in its
browser, and the painter step ran it forward in the three browsers: 0 transitions every time. The references were
recorded again at the X2 merge (0163d4c; `.artifacts/tests/runs/x2-merge-20260919`): the three browsers, both
configurations, both orders: six exits 0, 0 status transitions and 0 exact-value changes against the previous ledgers,
every gate lost 0. The plain predictor's run at the same commit differs from the usual run in 0 of Chrome's 67,065
cases; in 3 native observations and 0 line ranges of webkit-host's 63,987; and in 200 native observations of Firefox's
63,771, in two browser processes (`suite-sample` part 2 and `heldout-suite-sample` part 0), with 21 line ranges moving
with them: all 203 are history-dependent in the reference ledgers. Every case of the six recordings replays exactly
(0 unfaithful); the six references are frozen at that commit, and tier 1 exits 0 again.

**Since the re-architecture's X3, 2026-09-19.** X3 is the ports' model clean-up (DESIGN.md §3, "Each port's
data"). It merged with three Blink jobs that change recorded rows: gap lists are handed out
canonical, which let X2's two flows back in (DESIGN.md §5); a painted line in an RTL block is segmented by script (§7);
and an inspected paragraph no longer makes one-byte hyphen contexts it doesn't use (§4.6).

- *The clean-ups move nothing.* On each owner's branch tier 1 is the same on all six references, 0 questions changed
  (Blink's exits 3 by the string storage rule alone, because `shape.ts` changed); the function set's plain, pure and
  sweep checks exit 0; citations lose nothing that isn't accepted by name (2 in WebKit, 3 in Blink, 0 in Gecko); the
  painter differential is byte-equal. Tier 2 in both orders and both configurations shows 0 transitions in each owner's
  browser, and the giants' predictions equal the frozen rows' and are no slower (`.artifacts/tests/runs/ra-x3-blink`,
  `ra-x3-webkit`, `ra-x3-gecko`; lab README, "Baselines for the tripwire"). Two owners added a differential of their
  own against the start commit: WebKit's whole function set, question sequences included, differs in 0 of 63,987 cases
  in either configuration, and Gecko's layouts at four other widths on a stand-in Canvas are equal on 270,960 layouts,
  with the same number of questions.
- *Blink's three jobs change rows, as accounted.* At the merge tier 1 exits 1 for Chrome and 0 for Firefox and
  webkit-host. Against the references frozen at X2, 926 Chrome rows without facts and 756 with them differ byte for
  byte: 473 and 303 by gap lists, 461 by painter limits, 8 by both. The context count falls in 3,745 cases of each
  configuration, which tier 1 classes as other questions, and every other changed case is repeats only. Tier 2 in
  Chrome shows 8 painter transitions per configuration, all the limit `script-at-line-start`, 0 from pass to a failure,
  and the gate lost 0. Chrome's references were recorded again and frozen at the X3 merge (c7f3c3d; `.artifacts/tests/runs/x3-merge-20260919`; both orders, both configurations: exits 0; exactly 8 painter status transitions per configuration, all naming `limit:script-at-line-start`: 2 from `fail open` to `fail covered`, 6 already covered rows that name the limit too; 0 from a pass; exact values unchanged; gates lost 0 and no pass pair changed, so the seeds stay; the plain predictor's run equals the usual run on all 67,065 cases; every case of both recordings replays exactly, and tier 1 exits 0 for all six references again).
- *The proof that canonical lists change grouping alone is not a checked-in gate.* It is a script under `.artifacts`:
  `.artifacts/tests/runs/ra-x3-blink/tools/canonical-proof.ts` (`check --tree=<worktree> --browser=chrome
  --config=no-facts|facts`, with `--without-limits=true` to leave the painter's limits out of the comparison). It
  defines canonical on its own, without importing the library, replays every case of a frozen Chrome reference with
  the tree's library, and reports the rows that differ byte for byte, the cases that are equal once both sides' gap
  lists are canonical, whether every new list is already canonical, and the question changes by kind. It proves that
  the 473 and 303 rows differ in how ranges are grouped and in nothing else: 67,065 of 67,065 cases are equal after
  canonicalizing both, in each configuration. The orchestrator ran it again on the merged tree, the painter's limits
  left out, with the same result. It compares with the references frozen at X2, so it is the record behind the X3
  freeze and says nothing about a later tree. What holds the form from now on is `engines/blink/gaps.test.ts` and tier 1.
- *New unit tests* (`bun test rebuild`: 822 tests in 59 files at the merge). `engines/blink/gaps.test.ts`: ranges that
  meet become one where the first was, touching counts as meeting, another run or detail stays apart, the same ranges
  raised again in any order give the same list, the entries are copies; and the painter's rule takes an 8-bit line
  for one Latin segment in an LTR block and segments it by script in an RTL one. Two in `engines/gecko/gecko.test.ts`:
  text nodes without frames are collapsed fragments of their own leaves, and a unit holds nothing of its inside until
  a line asks while a line start survives a round trip through JSON.
- *Tier 1's string storage rule* also watches `rebuild/src/engines/blink/contexts.ts` (`replay.ts` `STORAGE_PATHS`),
  where `styleContexts` and `raw16Of` moved; `check --sites` names the site `raw16Of@engines/blink/contexts.ts`.
- *The plain predictor's browser runs at X3* are X2's: Chrome 0 differences on 67,065 cases; webkit-host 0 line ranges
  and the same 3 native observations; Firefox the same 120 cases of `suite-sample` part 2, case for case, with the
  same five unmarked (known-tail item `gecko/process-font-fallback-state`, which took the item
  `gecko/plain-predictor-fallback-state` in).

**Since the re-architecture's last step, 2026-09-19.** What nothing used any more is deleted: the index API of
`src/measure/canvas.ts` with its memo and call log, `src/measure/log.ts`, the line types `LineOf` and `LineResultOf` of
`src/model.ts` (the ports' test helper `src/test-lines.ts` has its own `TestLine`), the replay's reading of reference
format 1 (which held the library's memo hits; all six references are format 2), two exports only their tests read and
an unused lab type that Knip found, and `tests/seed-facts-20260916.sh`, a one-off that would now write over facts files
later rounds merged into. Knip is clean but for the four test helpers its config names.

- *Nothing moved.* Tier 1 is the same on all 389,646 cases with 0 questions changed. It exits 3 for Chrome by the string
  storage rule alone, since files under `rebuild/src/measure` differ from the references' commit (65,764 and 5,105
  storage-sensitive cases); Chrome's tier 2 forward in both configurations then showed 0 status transitions, exact values
  unchanged (266 and 992 differing without facts, 552 and 869 with them) and the gate lost 0
  (`.artifacts/tests/runs/ra-final-shared`). The function set's plain and pure checks exit 0 on every case, with the
  plain path's questions where they were (Chrome 234.3 and 224.3 a paragraph, webkit-host 39.32 and 21.65, Firefox 54.5
  and 55.1). The painter differential is byte-equal on 389,646 of 389,646 cases against the painter of bee0202. The
  citation ledger loses nothing (3,612 tokens at the line, 3,772 now). The twin scan finds 0 on `twins`.
- *The rule registry* (through `rule-changes.json`): `shared/measure/fresh-measurer-per-layout` and
  `shared/measure/memo-per-layout` described the measurer and the memo that are gone and are removed, replaced by
  `shared/measure/contexts-per-prepared-paragraph` and `shared/measure/asking-again-answers-the-same`, which carry their
  probes; `blink/measure/string-reaches-canvas-as-built` is restated over `width` and `bounds` and points at the test that
  holds it now (§3 has the counts).
- *The lab gate's Chrome seeds hold the `twins` set* (both configurations): staged from the X3 merge's recording, both
  orders, and the line's giants, 0 pairs lost, 0 left, 0 gained, 380 cases only now, each checked against its own runs
  from where it sits; each record keeps the record of the seed it replaced under `replaced`, with its attributions. The
  tests gate's seeds are per derived family (§9), and `twins` is a development set, not a family, so they don't change;
  the layer of the tests gate that reads development sets, the report-only corpus, reads a lab gate seed.
- *The coverage maps* (`rebuild/tests/coverage-map/<engine>.txt`) are regenerated at this tree; the correctness line's
  named files that have moved. Blink: 47 of 4,088 measured lines of the port never ran; Gecko 123 of 3,399; WebKit 111 of
  4,062. They go stale with every change to a port: `bun rebuild/tests/coverage-map.ts` makes them again in about a minute.

**Since correctness round 5, 2026-09-19.** One owner per engine landed the fixes that close the gap with main's true
passes where Canvas can settle them without supplied font facts, and a critic read the three branches, merged them in
a scratch clone and ran a held-out probe of its own (research/CORRECTNESS-ROUND-5.md; DESIGN.md §4.4, §4.6, §4.7, §5).
The fixes ask Canvas new questions and change gap lists, so tier 1 couldn't pass at the merge before a new recording.

- *Tier 1 exits 1 or 4 at this merge, as accounted, until the references are recorded again.* On the three branches
  merged together it reproduces every owner's numbers exactly (the critic's run, before its fix to Gecko's lazy scan,
  which leaves the inspected path that tier 1 replays untouched). No line range changed in any case that replays.
  - Chrome exits 1. 66,328 of 67,065 cases are the same per configuration. 569 cases without facts and 416 with them
    ask a new question, 39 and 56 ask other questions, and 129 and 265 predictions changed: in gap lists (without
    facts 329 `script-context` line entries and 3 paragraph entries fewer, 2 `unsafe-to-break` entries more) and in 2
    `suite/cross-item` cases' cluster advances. Every touched case holds a cluster without a base, and every changed
    case passes line count, breaks and widths with exact values in the ledger.
  - webkit-host exits 1. 154 cases change in their gaps alone, in both configurations, by the
    `control-character-width` condition (94 lines lose the gap, 58 keep it only through the whole item a carried width
    comes from, 1 gains it, 1 line's first gap becomes the `page-history` that followed). 22,450 cases without facts
    and 22,426 with them ask the same or fewer questions in another order, and 7,020 and 7,044 ask a box's space that
    the record lacks. A questions-only freeze won't do, because gap lists changed: it needs a full recording, pack and
    freeze with a reason, and the painter differential's frozen side bundled again.
  - Firefox exits 4 with 0 predictions changed. Without facts 54,427 cases are the same and 9,344 ask a question the
    record lacks (by the first missing question: 5,099 pair placement, 2,672 the suffix behind its letter, 1,573
    U+00A0). With facts 57,767 are the same, 1,444 are repeats only and 4,560 ask a new question.
  - The function set's plain and pure checks skip the cases that can't replay and pass on the rest, 0 fail (Chrome
    66,496 and 66,649, Firefox 54,427 and 59,211, webkit-host 56,967 and 56,943). The painter differential exits 3 with
    0 paintings differing. The sweep on the stand-in Canvas passes on every case (Chrome 67,065, Firefox 63,771,
    webkit-host 63,987, no facts). The citation ledger loses nothing.
- *What covers the cases that can't replay is the browser.* Each owner ran tier 2 in both orders and both
  configurations in its browser: 0 transitions from a pass, exact values not worse, every gate lost 0
  (`.artifacts/tests/runs/cr5-blink`, `cr5-webkit`, `cr5-gecko`; the critic ran Firefox without facts again on the
  merged tree, `cr5-critic`). Chrome: 4 transitions per configuration, all on `c-bff5270008f33766`, from a failure to a
  pass. webkit-host: 3 painter rows lose `control-character-width` from their cover, and nothing else moves. Firefox
  without facts: 943 transitions; line count 14, breaks 42 and widths 142 go from a covered failure to pass, 41 widths
  from unobserved to pass, differing predicted values 301 to 239, the gate lost 0 and gained 241. Firefox with facts:
  453 transitions; line count 2, breaks 2 and widths 13 go to pass, the gate lost 0 and gained 19.
- *The plain predictor's browser runs.* Chrome: 0 line ranges and 0 native observations differ on 67,065 cases.
  webkit-host: 0 line ranges on 63,987 cases, and the same 3 history cases differ natively as at X1, X2 and X3.
  Firefox: 0 line ranges on 63,771 cases in the owner's run. The plain predictor's run in Firefox is not stable in
  `heldout-suite-sample` part 0: 7 native observations and 0 line ranges in one run, 74 and 7 in another, every one
  history-dependent in the ledger. That browser process has two fallback-font states, and the critic's run landed in
  the other one; all 7 cases whose line ranges moved replay offline, where the plain path equals the inspected path.
- *Questions a paragraph since the round*, counted in the browser (DESIGN.md §4.7): webkit-host's plain path 36.51
  without facts and 18.83 with them (39.32 and 21.65 before), its lab path 85.90 and 56.98; Firefox's plain path 55.07
  without facts (54.56), its lab path 120.23 and 117.03 (114.54 and 115.70); Chrome's plain path 234.31, unchanged.
  The numbers elsewhere in this section are of before the round.
- *74 Firefox cases without facts, and 87 with them, read as going from history-dependent to pass in the both-orders
  runs.* They belong to that same process (`heldout-suite-sample`), and the 74 are exactly the cases whose native
  observations differ in the critic's plain run. A pass in one recording isn't stable, so the known tail names them
  under `gecko/process-font-fallback-state` and they stay that class whatever a recording shows.
- *What guards a plain paragraph's lines.* The function set's plain check, the sweep and the plain predictor's browser
  run. None of them holds Gecko's lazy plain scan (DESIGN.md §4.6) on the shape the critic found, because no set case
  has it: a ligature group that reaches past the frame's end and starts at a kerned or joined offset. That shape has a
  unit test built from a constructed paragraph on a stand-in Canvas, `engines/gecko/lazy-scan.test.ts`: plain and
  inspected lines over a sweep of 901 widths, which differed at 22 of them before the fix. (The profiling phase took
  the lazy scan out, and that file with it: a plain scan reads every candidate whole, research/PROFILING-START.md
  item 8.)
- *New unit tests* (`bun test rebuild`: 831 tests in 61 files at the merge). Gecko, six in `engines/gecko/gecko.test.ts`
  and the lazy scan's file: sides that add up only with the suffix behind its own first letter; a pair whose total only
  one placement explains, the third placement (`Je`) among them; a probe pair tells for the pairs of its own face and
  for no other; a plain scan asks where a pair's adjustment goes only where a fit test or an edge needs it, at widths
  on both sides of a pair's share; a boundary U+00A0 measured as itself, once a text run; `paragraphGaps` hands out
  copies. WebKit, three in `engines/webkit/lines.test.ts`: a pair after a combining mark of the same box is still
  measured apart, a pair in a string with a complex-path character is left as Canvas shapes it, and a control in a
  string without one reports as on the simple path. Blink, `engines/blink/pair-window.test.ts`: the window reaches past
  a cluster of a default-ignorable character and a mark, as it does past the character alone.
- *New probes* (measurement only): `rebuild/probes/gecko-mainfacts.ts` M1 to M5 (a kerned pair's placement from
  app-unit rounding, U+200D at the start of a Canvas string, native lines beside the suite's widths, a boundary U+00A0
  in 249 styles, a first font that draws only the digits) and `rebuild/probes/blink-cr5.ts` K, L and Z (pair placement
  in 26 kerning families, lam-alef cluster membership in 31 Arabic family names, a cluster of an ignorable character
  and a mark at overflow widths). WebKit added none: its bug already has a page (rebuild/platform-bugs/LEDGER.md,
  entry 6).
- *The rule registry* took the round's rules through `rule-changes.json` (§3), and `coverage.ts` lists no unknown
  annotation. *The known tail* has 67 items and 783 named cases (lab README, "The known tail").

All six references were recorded again at 3d0a5b3 and frozen at f072dc4 (tag `cr5-merged`). The recording, both orders
and both configurations: six exits 0, 0 transitions from a pass to a failure, exact values not worse, gates lost 0.
Chrome: 4 transitions a configuration, all on `c-bff5270008f33766`, to a pass. webkit-host: 3 painter rows lose
`control-character-width` from their cover. Firefox: 598 transitions without facts and 22 with them, none blocking: 241
and 19 go to a pass, 5 cases without facts go from a pass to history-dependent (named under
`gecko/process-font-fallback-state`), and no case leaves history-dependent; differing predicted values without facts 301
to 239. Every case replays exactly from the packed recordings. Seeds were staged for all six with 0 lost; Chrome's
gained 3 and 3 pass pairs, Firefox's 241 and 19 (20 pairs left through history), webkit-host's none, and Chrome's and
Firefox's were adopted. The plain predictor's run against the usual run: Chrome 0 of 67,065 cases differ, webkit-host
the 3 known, Firefox 120 in the known process (14 of them in line ranges), all history-dependent in the ledger. On the
frozen tree tier 1 exits 0 for all six, the plain and pure checks exit 0, the painter differential holds 6 of 6 and
citations lose 0.

**Since the fresh-eyes follow-up, 2026-09-19.** A reviewer who hadn't worked on the code read the library against the
engineering guide (research/FRESH-EYES-REVIEW.md), and three owners and a critic took up what it found
(SHARED-CHANGES.md has their entries): one parser for a font-family list, `tools/two-trees.ts` without false
differences, the gates' last line and stale sockets, Gecko's recipe contexts held by reference, Blink's two system font
names compared as Chromium compares them, and Blink's box fragment for a span that holds nothing but empty items and a
collapsible space (DESIGN.md §1.1, §1.2, §4.6).

- *All but one change move nothing.* On the owners' branches tier 1 shows 0 predictions and 0 questions changed. The
  one parser edits `src/measure/font-checks.ts`, so tier 1 exits 3 for Chrome by the string storage rule alone (65,764
  cases without facts and 5,105 with them go to tier 2), and Chrome's tier 2 forward on those cases shows 0 transitions
  in both configurations (`.artifacts/tests/runs/fu-shared`). The Gecko owner's browser runs were at the branch's end,
  which holds two commits that weren't merged: Firefox tier 2 forward with 0 transitions in both configurations, and
  the plain predictor's run equal to the usual run on all 63,771 rows (`.artifacts/tests/runs/fu-gecko`). On the merged
  tree tier 1 exits 0 for Firefox and webkit-host with 0 questions changed, so their references are unchanged.
- *Blink's box fragment rule changes predictions by design.* 494 Chrome cases per configuration (483 distinct ids) gain
  an `inline-box` geometry item, and no Canvas question changes. On the merged tree before the freeze the full
  `gates.ts` showed exactly four rows of 39 that aren't 0: tier 1 for Chrome exits 1 in both configurations, and the
  painter differential for Chrome exits 3 in both (494 cases not painted, 0 paintings differ). The owner's tier 2 on
  the 494 cases and the critic's on the three branches merged agree: 3 transitions per configuration, 0 from a pass,
  all on `c-a37545c096e939be`, from a failure to a pass (`.artifacts/tests/runs/fu-blink`, `fu-critic`).
- *After a merge that changes predictions, tier 1's needs-browser list is not the whole list for tier 2.* It holds the
  cases whose questions changed, the unfaithful ones and the storage rule's; a case whose prediction changed under the
  same questions isn't in it. With facts it held 47 of the 483 changed ids, so the critic ran tier 2 on the union of
  the list and the changed ids. A ledger keys on set and id, and an id can sit in two sets, which is why 65,764 listed
  ids give 66,585 ledger entries (and 5,105 give 5,147).
- *New unit tests* (`bun test rebuild`: 862 tests in 64 files at the merge). `src/font-family.test.ts`, 11: the lists
  of the recorded cases read as every old parser read them, and above each other case what each old parser did with it
  (a comma in a string, escapes, runs of white space, U+00A0, case, an unclosed string, the lists CSS rejects, WebKit's
  and Gecko's own readings over the list). Five in `engines/blink/lines.test.ts`: `system-ui` in any case and a family
  name as written, read from the sizes of the font strings a stand-in Canvas is asked at DPR 2, the same through a
  `primaryFamily` fact, and three for spans that hold no text. `tools/two-trees.test.ts`, 2: a line without a line
  box is no difference, and another break is found. Two in `tests/gates.test.ts`: the cases for tier 2 are counted
  whatever the exit code and named in the last line, and a run removes the socket files of processes that are gone
  while a live process's stays.
- *New probes* (measurement only): `rebuild/probes/font-family-syntax.ts` (the browsers' own CSS parsers read the
  probed lists as the one parser does: 95 of 95 checks in Chrome 153, Firefox 156 and webkit-host) and
  `rebuild/probes/blink-sysui-spellings.ts` (Chrome only, alone in a fresh browser at DPR 2: 20 of 20 checks). The
  critic's probe of lists left open at their end isn't tracked (34 of 34 checks in Chrome and in Firefox, webkit-host
  not probed; `.artifacts/probes/critic-family-edges`). Since later that day its six lists and a seventh are in
  `font-family-syntax.ts`: 123 of 123 checks in each of the three, webkit-host included.
- *The rule registry* took one new Blink rule and one restatement through `rule-changes.json` (§3). *The known tail*
  has 67 items and 784 named cases: `lab/blink-rect-of-a-span-holding-only-a-trimmed-space` is closed, since it was the
  engine port and not the observation port, and `painter/without-explanation` names the review's fresh case, which the
  painter still fails (lab README, "The known tail"); with the final evaluation's one hanging Chrome case under
  `blink/range-rects-hang` it names 785. *The coverage maps* weren't regenerated; they go stale with every
  change to a port (`gecko.txt` names lines of `familiesOf` and `escape` that have moved).

Chrome's two references were recorded again and frozen at d7df936 (`.artifacts/tests/runs/fu-merge-20260919`). The
recording, Chrome only, both orders and both configurations: four exits 0 (no-facts, facts, the plain predictor's run,
its comparison). 67,065 cases each; 3 status transitions per configuration, all on `c-a37545c096e939be`
(`rich-prewrap/normal-in-pre-wrap`): breaks `fail open` to pass, widths `unobserved` to pass, `not exact` to exact; 0
from a pass; differing predicted values 266 to 265 without facts and 552 to 551 with them; gates lost 0, new 2. The
plain predictor's run equals the usual run on all 67,065 cases. Every case replays exactly from the packed recordings.
The references were frozen with `--force` and a reason, Chrome's tier 2 seeds were adopted (0 lost; breaks and widths
gain one pass pair in each configuration), and the painter differential's frozen side was bundled again.
After the freeze the full offline gates exit 0 on the frozen tree (39 gates, no case left for tier 2).

**Since the profiling phase's item 1, 2026-09-19.** `prepare` takes the list its Canvas contexts are found and made
in, a page's or one call's, and keeps nothing else across calls (DESIGN.md §4.6, "A page's list of contexts";
research/PROFILING-START.md, item 1). The lab's usual predictors hand `prepare` no list, so a recorded case stays what
one paragraph asks, and the tiers hold the change as a refactoring. A page's list is held by predictors of their own,
compared with the usual runs case by case (`.artifacts/tests/runs/contexts-20260919`):

- *Offline.* The full `gates.ts` exits 0 (39 gates). Tier 1 shows 0 predictions and 0 questions changed on the six
  references; for Chrome it exits 3 by the string storage rule alone, because files under `src/measure` changed (65,764
  cases without facts and 5,105 with them go to tier 2). Chrome's usual tier 2, forward, then shows 0 transitions, exact
  values unchanged and the gate passing, on all 67,065 cases of each configuration.
- *The page predictors* (`lab/baselines/page-contexts-predictor.ts`, `page-contexts-facts-predictor.ts`,
  `page-contexts-plain-predictor.ts`; `predictor-core.ts` `makePredictor`'s `pageContexts`) keep one list for every
  case a document lays out, so a document's cases share their Canvas contexts and every case asks its font checks of
  Canvas again on them. `browser-sets.ts --predictor=<one of them>` runs them, with `--both-orders` or with
  `--shuffle=<seed>`, a third order (`run.ts --order=shuffle:<seed>`), and `compare-sets.ts <its run> <a usual run>
  --prediction=without-measure` (or `line-ranges` for the plain one) compares. Run `compare-sets.ts` from a checkout
  beside the one the usual run was made from: a run's `sets-run.json` names its folders relative to its checkout.
- *Chrome* keeps shaped words per canvas, so there a shared context is a new history. Every layout, observation port
  value, painter limit and painted line equals the usual recording's: 0 of 134,130 rows in file order and reversed, in
  each configuration; 0 of 67,065 in a shuffled order (seed 20260919, in which none of the largest document's 13,010
  cases keeps its place), in each configuration; and 0 of 67,065 line ranges on the plain path. `prepare` emptied a
  document's list 213 times in the run without facts (counted from the rows' contexts).
- *webkit-host*: 0 of 127,974 rows differ in file order and reversed, in each configuration.
- *Firefox*: 0 of 127,542 rows differ with facts. Without facts 7 predictions and 6 native observations differ, all in
  one reversed part (`suite-sample` part 2) and all history-dependent on all four metrics in the frozen ledger: they are
  the process's two fallback-font states (lab README, "Tier 2"). Each of the 7 predicts what the usual recording predicts
  for the same case in its other order (`firefox-states-no-facts.log` in the run folder).
- *The page-wide twin scan* (`tools/twin-scan.ts --page`) scans a case file as one page with one list: 67,072 cases,
  377 ask a two-byte slice, 0 ask one context the same characters in both storages. The scan names a context by the
  object it is, since `prepare` empties a list that has grown past its bound and a place in the list then names another
  context: by place the whole-page scan listed one case falsely. With `contextsOf` planted to give one set of contexts
  it finds 166 of the 380 `twins` cases, as before.
- *New unit tests* in `src/measure/font-checks.test.ts`: a list that outlives a call saves the next call its contexts
  and none of its questions, so a font that loads between two calls shows in the second; and a list whose settings
  never repeat is emptied at `prepare`'s bound.
- *New probes* (measurement only): `probes/contexts-font-load.ts` (a font that loads after a context was made),
  `contexts-page-lang.ts` (`<html lang>` changing under kept contexts), `contexts-device-scale.ts` (Chrome's device
  scale factor changing under them, through a DevTools override the probe's script asks the runner for,
  `runner.ts` `/api/chrome-dsf`) and `contexts-canvas-churn.ts` (a tested guess that didn't hold).
  `tools/contexts-bound.ts` prices the list's search and shows the bound's cliff. The bench runs the library with a
  list a message and with one list a pass in one document (bench README, "Chat", E).

Tier 1 is a change detector, not an oracle: its expected values are the library's own at a commit. Its inputs are recorded
per library, so a library that asks Canvas new questions needs a new recording (`browser-sets.ts --record`, `replay.ts
pack`, `freeze --force --reason`). `replay.ts check` only reads the reference folder and keeps its scratch files and report
under `rebuild/tests/.check` in the working tree, so owners in several worktrees check one reference at once. `pack` finds
a run's parts under `--runs`, whichever checkout recorded it, and reads them before it empties the folder it packs into.

**The function set's checks** (since the re-architecture's S3, when `rebuild/src/index.ts` began to export the set of
DESIGN.md §2.9; lab README "Test tiers"): `bun rebuild/tests/function-set.ts plain|pure|sweep --browser=all --config=all`
holds the library to itself over every recorded case. *Plain*: a paragraph prepared plain gives the inspected one's fill
results and pieces, asks no question the lab's path didn't and makes no more contexts. *Pure*: `linePieces` and
`inspectLine` give the same result twice and in either order. *Sweep*: one prepared paragraph filled at four widths on a
stand-in Canvas equals a paragraph prepared for each width alone. All three pass on the six references (389,646 cases in
all), in about 1.5, 2 and 10 minutes.

Since the re-architecture's X1 the plain path is real in all three ports. Questions a paragraph, plain against the lab's
path: Chrome 61.18 against 99.97 without facts and 48.49 against 91.91 with them; webkit-host 26.14 against 31.81 and
12.38 against 19.18; Firefox 40.7 against 74.2 and 40.8 against 74.5. The plain check changed with it (2026-09-18; the
header of `rebuild/tests/function-set.ts`). It fails on results that differ, on a question the lab's path didn't ask and
on more contexts. It no longer fails on order: a case whose first asks come in another order than the lab's passes and is
counted (at the X1 merge Chrome 26,035 without facts and 21,826 with, Firefox 11,418 and 11,422, webkit-host 1,174 and
1,218). No path that asks less can keep the lab path's order. The lab's path asks inspection's questions between two
fills, so a later fill's repeat of one is a repeat there (a memo hit until X2) and a first ask on the plain path, after
questions the lab's path asked later.

What covers question order is the plain predictor's browser run (`browser-sets.ts
--predictor=rebuild/lab/baselines/plain-predictor.ts`, compared with `compare-sets.ts --prediction=line-ranges`). It is
part of every milestone that changes the plain path's questions. At X1:

- Chrome, all 67,065 no-facts cases: line ranges equal, 0 native differences.
- Firefox, 63,771 cases: 63,657 equal. The other 114 are in one browser process and all already history-dependent in the
  ledger; a rerun of that set gave 0 differences on 19,888 cases.
- webkit-host, all 63,987 no-facts cases at the X1 merge: 0 line ranges differ; 3 native observations differ, all already
  history-dependent in the ledger. (The owner's own run covered the development sets, 26,472 rows, with the same result.)

Since X2 (2026-09-19) the plain path asks more, and nothing new. Questions a paragraph, without facts and with them:
Chrome 250.7 and 240.8 (61.02 and 48.33 distinct, as before), webkit-host 39.32 and 21.65, Firefox 54.5 and 55.1; the
lab's path 1,016.8 and 1,055.7, 88.79 and 59.86, 114.5 and 115.7 (DESIGN.md §4.7 has the table and what it cost). The
counts of cases whose first asks come in another order are the X1 merge's. Every repeated question recorded in pinned
Chrome was answered as the first time: 2.17 M questions asked again in 26,913 cases, 0 with another width or ink box.
Since Blink's X3 Chrome's plain path asks 234.3 questions a paragraph without facts (61.0 distinct, ratio 3.84) and 224.3
with them (48.3, 4.64), and the lab's path 736.2 and 775.6; webkit-host's and Firefox's counts didn't move at X3.
The plain predictor's browser runs at X2:

- Chrome, all 67,065 no-facts cases: line ranges equal, 0 native differences. The other-widths-first predictor's 67,065
  rows equal the usual run's and the references' recording.
- webkit-host, all 63,987 no-facts cases: 0 line ranges differ; the same 3 native observations differ as at X1.
- Firefox, 63,771 cases: 63,651 equal. The other 120 are in one browser process (`suite-sample` part 2), with
  fallback-font widths in another state; line ranges move with the native lines in 14. 115 of them, the 14 among them,
  are history-dependent in the ledger already. The other 5 differ in native widths alone and aren't marked there; they
  are in the known tail (`gecko/process-font-fallback-state`, which took the item
  `gecko/plain-predictor-fallback-state` in at X3).

The ports' tests count what their stand-in Canvas is asked, and probe `blink-storage` S5 what the page's Canvas is
asked: no port keeps a log they could read. The painter differential (`rebuild/tools/painter-diff.ts`, check 7) is
byte-equal on 389,646 of 389,646 cases against the painter of 81fd07d, and it caught a planted flip of `overflows` in
the adapter (exit 1). It is the offline check that reads `overflows` and the engines' paint facts, which tier 1 can't see.

Terms:

- **Rule**: one library behaviour with a registry id such as `blink/lines/fit-bound-plus-one-lu`, a kind, a citation, probe labels and asserting tests.
- **Family**: paragraphs built to exercise named rules, with focus offsets where a rule should act at a line edge.
- **Target**: a question about one paragraph in one browser: at which width does the native line starting at offset s first reach offset k.
- **Bracket**: two adjacent grid widths; at one the line reaches k, at the other it doesn't.
- **Grid**: the unit available widths live on: 1/128 CSS px in Chrome at DPR 2, 1/64 in Safari, 1/60 (app units) in Firefox.
- **Environment key**: what `lab/score.ts environmentKey` names for a row: the browser, the app bundle build, the engine build, the OS build, DPR, visual-viewport scale and the scorer version.

## 1. Where things are

| Path | What |
|---|---|
| `rebuild/tests/rules.json`, `registry.ts`, `import-rules.ts`, `import-rules.test.ts`, `rule-changes.json` | The rule registry and how it's generated |
| `rebuild/tests/families/` | Family declarations (`lines.ts`, `breaks.ts`, `fonts.ts`, and `inline.ts` for inline structure, line slots, alignment and process languages), `catalogue.ts`, the family types and pairwise covering rows (`covering.ts`) |
| `rebuild/tests/fit.ts` | Each browser's fit arithmetic, from recorded probe verdicts |
| `rebuild/tests/derive.ts`, `noop-predictor.ts`, `observe-families.sh` | Width derivation and the observation loop |
| `rebuild/tests/facts.ts`, `rerun-probes.sh`; `rebuild/facts/<engine>/<engine build>.ndjson` | Versioned probe facts (the first files were seeded on 2026-09-16 from probe outputs recorded before the runner noted builds; that one-off script is in the history) |
| `rebuild/tests/coverage.ts` → `rebuild/tests/coverage.json` | The coverage matrix (the headline configuration's; each configuration's is beside its seeds) |
| `rebuild/tests/gate.ts` → `rebuild/tests/baselines/{no-facts,facts}/<browser>[-features]-<engine build>.json` | The layered gate, a seed per configuration with its seed record (§9) |
| `rebuild/tests/independence.test.ts` | No expected value from `rebuild/src` |
| `rebuild/tests/sets.ts` | The tiers' sets and run protocol |
| `rebuild/tests/replay.ts`, `rebuild/tests/reference/` | Tier 1: offline replay against a frozen reference, pinned by hash in the manifests |
| `rebuild/tests/browser-sets.ts`, `rebuild/tests/baselines/sets/` | Tier 2 and its adopted seeds, `<browser>-<engine build>-<config>.json` with seed records |
| `rebuild/tests/known-tail.json`, `known-tail.ts`, `known-tail.test.ts` | The known tail: the classes left open at the frozen line, with case ids and rules over a tier 2 ledger, its exact-value status included (67 items since correctness round 5, three of them closed) |
| `rebuild/tests/compare-sets.ts`, `rebuild/lab/compare-rows.ts` | Two tier 2 runs, or two row files, case by case (measure first, installed Safari against webkit-host) |
| `rebuild/tests/function-set.ts`, `stand-in-canvas.ts`; `rebuild/tests/coverage-map.ts`, `coverage-map.shard.ts`, `coverage-map/` | The function set's checks (plain, pure, sweep), and the lines of `rebuild/src` no replay runs, per engine |
| `rebuild/tools/citations.ts`, `painter-diff.ts`, `twin-scan.ts`, `two-trees.ts` with `stand-in-canvas.ts` | The citation and prose ledger, the painter differential, the twin scan, and two checkouts on the same cases under a stand-in Canvas (`two-trees.test.ts` covers a plain predictor's line ranges against a layout: only the layout's lines that have a line box count) |
| `rebuild/lab/baselines/page-contexts-*.ts`, `browser-sets.ts --shuffle=<seed>`, `rebuild/tools/twin-scan.ts --page`, `rebuild/tools/contexts-bound.ts`, `rebuild/probes/contexts-*.ts` | A page's list of Canvas contexts (DESIGN.md §4.6): predictors that keep one list a document, a third order for them, the twin scan over a case file as one page, what searching the list costs and where its bound is a cliff, and the probes of what could make a kept context stale (a font that loads later, `<html lang>`, the device scale factor) |
| `rebuild/tests/ledger.ts` | The known-status ledger: the four metrics' statuses and the exact-value status per case, transitions and conditions |
| `rebuild/lab/rows.ts`, `predictor-core.ts`, `port-measure.ts` | Rows read plain or `.zst`; the one prediction adapter; the observation ports' live measuring |
| `rebuild/src/measure/font-checks.test.ts`, `rebuild/probes/font-checks.ts` | The runtime font checks against a stand-in Canvas (20 tests; one ties the joining-script test to the Blink port's joining types, two hold the checks' contexts to the engine's own text rendering), and in the browsers over the lab's font declarations, beside the font table and the DOM (`.artifacts/lab/font-checks/tools/verdict.ts`): a check per release |
| `rebuild/src/font-family.test.ts`, `rebuild/probes/font-family-syntax.ts` | The one parser of a font-family list against CSS syntax, with what each of the four old parsers did above each case, and the browsers' own CSS parsers on the same kinds of list, for an element's style and for a Canvas font (123 checks, which held in Chrome 153, Firefox 156 and webkit-host on 2026-09-19) |
| `rebuild/src/measure/canvas-checks.test.ts`, `rebuild/probes/canvas-checks.ts` | `detectEngine()`'s Canvas checks against stand-in contexts, and the library's own `detectEngine()` in a browser: a pinned browser must answer supported (`LAB_CHROME_APP`, `LAB_FIREFOX_APP` for another build) |
| `rebuild/src/measure/canvas.test.ts`, `rebuild/probes/blink-storage.ts` | The string an engine hands to `measureText` reaches Canvas as built: `contextFor`, `width` and `bounds` use no `Map` or `Set` key at all while they run (V8 would hand Blink a one-byte string after a keyed use of the measured string), and in pinned Chrome the library's own bundled module answers a run of brackets on its `8bit` and `16bit` contexts as each storage shapes (S5, which since X2 notes Canvas's answers on the page's `OffscreenCanvasRenderingContext2D` itself, the string passed through untouched, and finds a context's partition through the prepared paragraph's `canvases`; `rerun-probes.sh` reruns the probe per Chrome release) |
| `rebuild/knip.config.ts` | `bunx knip --config rebuild/knip.config.ts`: unused files and exports under `rebuild/`, tests ignored |
| `rebuild/lab/browser-build.ts`, `rebuild/lab/pin-browser.sh` | The apps `lab/run.ts` and `probes/runner.ts` launch (pinned copies of Chrome and Firefox), and the build read from their bundles |
| `rebuild/lab/sharded.ts` | One case file as several jobs at once; derivation observes through it |

- `bunx tsc --noEmit -p rebuild/tests/tsconfig.json`
- `bun test rebuild/tests`: 132 tests in 18 files (2026-09-19, after the fresh-eyes follow-up).

Derived case files, rows and derivation records live under `.artifacts/charter-20260916/tests/families-20260916/<browser>/`. A baseline names its case file with a sha256.

## 2. Layers

| Layer | Proves | Expected values from | Code | In the gate |
|---|---|---|---|---|
| L0 observer | The scorer compares rects by its stated rules | Hand-built rows | `lab/score.test.ts` (scorer owner) | bun |
| L1 engine data parity | Tables and shared algorithms equal the engines' libraries | ICU, BidiTest, recorded answers | `rebuild/src` bun tests (owners) | bun; counted as coverage through registry tests |
| L2 browser facts | A claim about one browser build holds | Probe observations with in-probe verdicts | `rebuild/facts`, `facts.ts` | blocking: flips and missing facts |
| L4 rule families | Named rules match the browser at the widths where its decision changes | Native observations at derived widths | `families/`, `derive.ts` | blocking: lost pairs |
| L5 natural families and main's corpus | Realistic paragraphs and main's suite, measured | Native observations | `lab/cases` | report only |
| L3 replay | The library's full prediction is unchanged against a frozen reference, from recorded Canvas answers, with no browser | the library's own output at a commit (a change detector, not an oracle) | `tests/replay.ts` | report only: tier 1 (lab README "Test tiers") |
| L6 held-out | | | sealed sets run once per evaluation, counts only; not a gate layer (§13) | |

## 3. Rule registry

- `bun rebuild/tests/import-rules.ts` writes `rules.json` from the 2026-09-16 catalogue (399 rules) and `rule-changes.json`:
  - 31 rules removed, each with its replacement: the lab-visibility widths, the choices by score and the name keys the owners replaced, and at the re-architecture's last step the two rules of the measurer and its memo;
  - 45 reclassified entries, 14 of them round 4's new names for tests renamed since the catalogue, 1 round 4c's restatement of Gecko's tab width (tab-size is the text frame's own), 3 correctness round 5's restatements (WebKit's merged glyphs and `control-character-width`, which read the measured string's code path, and Blink's pair window, which reaches past marks too), and 1 the fresh-eyes follow-up's (`blink/measure/optical-size-from-fact`: how Blink's two system font names are compared, with its probe and tests);
  - 182 added, 3 of them with the Blink string storage fix, 2 at the re-architecture's last step, 1 in the fresh-eyes follow-up (`blink/content/box-fragment-of-an-inline-box-without-text`) and 7 in correctness round 5 (WebKit's `webkit/measure/code-path-per-measured-string`, annotated in source, and Gecko's `gecko/measure/joined-suffix-behind-its-letter`, `pair-placement-from-rounding`, `probe-pairs-per-context`, `same-face-by-kerning` and `boundary-nbsp-as-itself` with `gecko/lines/plain-scan-rough-candidates`, the port's own structure with no engine source); of the first 169: 44 from the owners' stage 1 reports, 55 for stage 5 (2026-09-17), 6 in ceiling round 2, 9 in ceiling round 3, 51 in round 4 (the runtime font checks 6, the Canvas checks 1, Blink 12, Gecko's round 3 rules 11 and round 4 rules 16, WebKit 2, scorer 6's observer assumptions 3) and 4 in round 4c (the port rules research/PREWRAP-RICH.md found: Blink 2, Gecko 1, WebKit 1);
  - 550 rules are current: Blink 199, WebKit 157, Gecko 158, shared 36.
- **Change rules in `rule-changes.json`, never in `rules.json`.** A `reclassified` entry replaces the fields it names (kind, statement, source, probes, tests, area, declaredBy) on any rule, from the catalogue or added; entries for one rule apply in order. Until ceiling round 3 the importer threw on a reclassified id that wasn't in the catalogue, so round 2's owners edited `rules.json` by hand, and a regeneration would have lost those edits.
- **Hand edits aren't lost.** `rules.json` keeps a hash of every rule as generated (`generated`). On the next import a rule whose file version moved while `rule-changes.json` didn't is written into `rule-changes.json` (a reclassified entry with the fields that differ, or an added entry for a rule added by hand), and the importer says so. When both moved and disagree, a rule was deleted by hand, or a hand edit touches id, engine, status, replacedBy or audit, it stops, names the rule and writes nothing. `--check` writes nothing and exits 1 when either file would change. The first run moved round 2's hand edits over: 5 Gecko rules' statements, sources, probes and tests, and the 2 Gecko rules added by hand. A registry without hashes counts as hand-edited wherever it differs from the generation, so on that first run a fresh change to `rule-changes.json` looks like a hand edit of the old text; it happened with two entries, which were put right by hand.
- `declaredBy` says where an id comes from:
  - the catalogue;
  - the Blink owner, who declared ids;
  - `provisional`, for 19 WebKit and Gecko replacements that the owner reports gave only as table rows;
  - `provisional (stage 5, feature families 2026-09-17)`, for the 55 stage 5 rules. They come from DESIGN.md §1.1, §2.9 and §8.3 stage 5 with the architect's citations; the engine owners confirm or rename them when they annotate the source.
- The stage 5 rules are 17 Blink, 17 WebKit and 16 Gecko rules for box edges, per-element styles, atomic inlines, `<br>`, `<wbr>`, text-indent, text-align and line slots; 3 observation rules for `Element.getClientRects()`; and 2 observer assumptions (kind `observer assumption`): `shared/lab/vertical-centre-grouping` and `shared/lab/slot-rows`.
- A rule's source annotation is `// rule <id>` in `rebuild/src`. `coverage.ts` lists rules without one (all but 21 of 550 on 2026-09-19) and annotations the registry doesn't know (none since correctness round 5 registered `webkit/measure/code-path-per-measured-string`). Once owners annotate, the registry is regenerated from the annotations.

## 4. Rule-targeted families

A family declares:

- its name;
- rule ids per engine, which decide the browsers it runs in;
- `why`: the cited source or verdict behind its axes;
- relevant axes, covered exhaustively;
- neighbour axes, covered by pairwise covering rows, where every pair of values of two axes appears at least once (deterministic, greedy);
- a builder: from one combination and a seeded random stream, a paragraph with focus offsets. Background values that no rule reads are drawn from that stream.

Axis values that only move the focus give the same paragraph; they fold into one with the union of their focus offsets. Characters and fonts are written into the builders with their class noted, and nothing imports `rebuild/src`.

| Family | Engines | Relevant axes | Paragraphs |
|---|---|---|---:|
| fit-bound | all | words × size 16, 13, 17.3 | 90 |
| following-space | all | kerning word end × one, three or NBSP spaces × Arial, Times New Roman | 72 |
| controls | all | CR, FF, VT × normal, pre-wrap, pre-line, break-spaces | 48 |
| tabs | all | tab-size 0, 1, 4, 8 × pen position × Arial, Helvetica Neue, Menlo | 144 |
| hanging-white-space | all | trailing white space × pre-wrap, break-spaces, normal | 60 |
| forced-breaks | all | U+2028, U+2029, LF × normal, nowrap, pre-line, pre-wrap | 48 |
| rewind | all | prefix × word length × span placement | 72 |
| in-word-breaks | all | AV, Wa, ffi and n words × break-all, anywhere, break-word | 72 |
| languages | all | lang "", en, ja, zh, ko × line-break × text the tables disagree on | 120 |
| hyphen-classes | all | word-break × loose × `-`, U+2010, U+2013 × preceding letter, digit or ideograph | 108 |
| quotes | all | lang da, de, sv, en, fr, ja, "" × quote pair × ideograph or letter | 112 |
| keep-all-storage | all | punctuation, spaces, ZWSP × 8-bit or 16-bit node × keep-all or normal | 48 |
| segment-breaks | all | newline between wide characters, punctuation, ZWSP × lang × node edge | 80 |
| clusters | all | Bengali ya-phala and conjuncts, marks, Thai × break-all, anywhere, line-break anywhere | 48 |
| urls | all | slash, hyphen and query words × overflow-wrap | 32 |
| zwnj | all | white-space × ZWNJ placement × ZWNJ at a span start | 36 |
| hankerning | Blink | close, open, dot and comma marks × line end, start, middle × Hiragino Sans, PingFang SC, Songti SC | 90 |
| hyphen-glyph | all | fonts on both sides of mapsHyphen × one or two soft hyphens × letter spacing | 96 |
| joining | all | Geeza Pro (AAT), Arial, Noto Naskh Arabic, Amiri × soft hyphen, break-all, anywhere × span edge | 96 |
| monospace | all | Menlo, Courier New, Monaco, Arial × break-word, anywhere × word | 64 |
| system-fonts-and-sizes | all | system-ui, BlinkMacSystemFont, -apple-system, Georgia × 13, 17, 20.5, 13.33, 16.8px | 80 |
| object-replacement | Blink | U+FFFC placement × font | 36 |

Totals:

- Chrome: 1,652 paragraphs in 22 families.
- webkit-host and Firefox: 1,526 paragraphs in 20 families each.

**Stage 5 families** (`families/inline.ts`, 2026-09-17). Their paragraphs are trees (lab/types.ts `InlineStructure`, built with `lab/cases/build.ts` `treeParagraph`); a tree that is flat becomes an ordinary flat case with its flat id.

| Family | Engines | Relevant axes | Paragraphs per engine |
|---|---|---|---:|
| box-edges | all | padding, border, margin or negative margin × start, end or both sides × a span holding a word, crossing a break, or inside a word | 288 |
| nested-box-edges | all | end edges on the inner, outer or both spans × padding, border and padding, or margin × start edges or none | 72 |
| nowrap-spans | all | nowrap in normal, normal in nowrap, pre-wrap in nowrap, nowrap in pre-wrap, pre in normal × where the spaces sit against the span edges | 80 |
| atomic-inlines | all | letter, space, NBSP or ideograph before × the same after × normal block, nowrap span or pre-wrap block | 288 |
| br-elements | all | word, space, spaces and tab, or nothing before × word, space and word, or a second br after × normal, pre-wrap, pre-line, break-spaces | 192 |
| wbr-elements | all | Latin, Hangul, before a space, ideographs × normal, keep-all, break-all × normal, pre-wrap, inside a nowrap span | 144 |
| text-indent | all | 16, 40.3, −12, −40px × words, a tab, a br, a long word × LTR, RTL | 128 |
| text-align | all | start, end, center, justify, left, right × LTR, RTL × a last word that kerns with the space | 144 |
| line-slots | all | equal rows, a wide first row, a wide second row × left, right, both × 40 or 37.3px × words, a long first word, tabs | 216 |
| process-languages | Blink | `a”b`, small kana, iteration marks, a middle dot × lang="" on the block, a span, a span inside `lang=ja` × auto, strict, loose; derived under two application locales | 72 |

Totals: Chrome 1,624 paragraphs in 10 families (and the 72 process-languages paragraphs again under en-US); webkit-host and Firefox 1,552 in 9 each.

## 5. Deriving widths from observations

`bun rebuild/tests/derive.ts --browser=<browser> --dir=<dir>` runs one offline step. It exits 10 and prints the case files to observe, or exits 0 once `<dir>/final` holds the family cases. It reads native rows only; derivation runs use `noop-predictor.ts`, so no library code runs in the page.

- **Pass A.** Width 1 with overflow-wrap normal, plus width 1 with the paragraph's own styles when its overflow-wrap isn't normal. Line starts after the first line are break opportunities.
- **Pass B.** Width 100000px. The extent of [s, k) is the right edge of its code points' positive rects minus their left edge, without trailing SPACE, TAB or LF in the modes where they hang.
- **Targets.**
  - Wave 1 starts at 0 and after every forced break.
  - At each focus offset the candidate there is chosen, or the nearest candidates on each side, excluding the opportunity the line at s reaches at width 1.
  - Wave 2 starts at the native line starts that follow wave-1 lines at the derived and bracket widths. Among them are the line after a first word, where overflow-wrap breaks, and the line after a HanKerning trim.
- **Pass C.** Each target is observed at the derived threshold T, at T minus one grid unit, and at T ± 1, 4 and 16px. T comes from recorded facts (`fit.ts`):

  | Browser | Fits when | Recorded by |
  |---|---|---|
  | Chrome | C ≤ trunc(width × 64 × DPR) + 1 LayoutUnit, so T = C − 1 | blink-lines H2: 11959/128 content, 1 line at 93.421875, 2 at 93.4140625 |
  | Safari, webkit-host | first one-line width ceil(64 × E) − 1 LayoutUnits | probes-safari "Item widths"; webkit-lines H3: 2985/64 |
  | Firefox | content au ≤ round(width × 60) | gecko-lines H1: 5184 au fits at 86.4px, not at 86.38px |

- **Pass D.** While the nearest widths where the line reaches k and where it doesn't are more than one grid unit apart, 16 widths between them are observed, for at most 6 rounds.
- **Limits.** 4 targets per segment in wave 1; 2 per line start and 4 per paragraph in wave 2; at most 12,000 cases per file.
- **Outcomes.**
  - resolved: a bracket, with its offset from T in grid units;
  - no reach: no observed width has a native line at s that reaches k. Most are wave-2 line starts that exist only while the paragraph wraps;
  - unresolved, with a reason:
    - `no-line-inside`: every width inside the window was observed without a line starting at s;
    - `no-short-width`: no width below the window where the line doesn't reach k;
    - `rounds-exhausted`: bisection ran out of rounds.
- **Line keys.** A native line's key is its lowest code point offset with a positive rect, under `score.ts nativeLines` grouping (an observer assumption). Keys only decide where to look. An atomic inline, `<br>` or `<wbr>` holds no offset, so a break just before an atomic inline and one just after it have the same key; the bracket at that key still includes the box when the line can't break before it.
- **Consistency.** Derivation refuses rounds observed under another build, DPR or set of given process languages.
- **Structured paragraphs** (stage 5):
  - Pass A cases leave out the line slots and the text-indent: break opportunities are properties of the content, floats wider than width 1 stack past their rows, and a negative indent lets the first line hold more than one piece. Pass A sets `overflow-wrap: normal` on every span as well as the block.
  - No sized pass is narrower than the widest row's left plus right insets. Below that the row's floats don't fit side by side and one drops into the next row, which breaks the slot protocol (DESIGN.md §2.9).
  - T adds the first row's insets, and for targets starting at 0 the text-indent, to the extent. Box edges and atomic inlines aren't added; where they decide a bracket, pass D finds it.
- **Outputs** in `final/`:
  - `family-cases.ndjson`: per paragraph the A and B cases, and per resolved target the reach and short widths;
  - `derivation.ndjson`: each case's family, rules, role, target, offset and the case ids it was derived from;
  - `summary.json`: per family targets, resolved, at the derived width, the offset histogram and unresolved reasons.

`bash rebuild/tests/observe-families.sh <chrome|webkit-host|firefox> <dir>` loops:

1. Derive.
2. Observe each case file as one job under `with-browser-lock.py`. `run.ts` reads the app bundle build into every row, checks it against the user agent and records it in `run.json`.
3. Repeat until `final/` exists.
4. Run the family file in file order and reversed with `lab/predictor.ts`, and score both with `--native-compare`.

Every observation goes through `lab/sharded.ts`: the case file is cut into shards that run at the same time, each under the browser lock in its own browser instance, and the joined folder reads like one run. It stops after one failed job, runs nothing twice and doesn't pause; a full derivation of the rule families takes two to three minutes a browser. Environment:

- `FAMILIES=a,b`: derive only these families, read when the directory is first planned.
- `SHARDS=N`: shards per case file (default: the browser's lock slots, 3).
- `LAB_RUN_ARGS`: more `run.ts` arguments for every job, such as `--chrome-apple-languages=en-US --chrome-accept-languages=en-US,en`.
- `FINAL_RUNS=native`: the final runs use `noop-predictor.ts`, into `final/native-file` and `final/native-reverse`, and compare only native observations. This is for families whose inputs the engine ports don't implement yet, and for derivations made while the library is being changed. Coverage doesn't read these runs.

## 6. First runs, 2026-09-16/17

macOS 27.0 (26A428), DPR 2. Chrome 153.0.8010.48; webkit-host on WebKit.framework 22625.1.29.11.27 (Safari 27.0); Firefox 156.0. All jobs ran under the lock, between census chunks. The final runs predicted with font facts attached (`lab/font-facts.ts`, landed 23:55).

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome | 22 | 1,652 | 15 | 5,335 | 4,053 | 2,864 | 444 | 838 | 16 | 10,976 |
| webkit-host | 20 | 1,526 | 17 | 4,406 | 3,438 | 149 | 229 | 739 | 8 | 9,584 |
| Firefox | 20 | 1,526 | 13 | 4,428 | 3,447 | 2,846 | 261 | 720 | 0 | 9,584 |

Unresolved reasons: all 444 in Chrome and all 261 in Firefox are `no-line-inside`; webkit-host has 227 `no-line-inside` and 2 `rounds-exhausted`.

What the offsets say:

- **Chrome.**
  - The next most common offset after 0 is −1 LayoutUnit: code point rects are rounded outward, so extents overshoot (TENTPOLES-CRITIC §2.E item 1).
  - hankerning has 36 brackets at −1,024 and −1,025: the 8px line-end trim of blink-lines H15.
  - hyphen-glyph brackets sit at 682, 766 and 930: the hyphen's width, which pass B's extent leaves out.
- **webkit-host.** 149 of 3,438 brackets at the derived width; most offsets are −3 to −105 units of 1/64px, because Safari snaps partial Range edges outward to whole px. Bisection is the protocol there, as TEST-ARCHITECTURE §2.3 expected.
- **Firefox.** 2,846 of 3,447 at the derived width. hyphen-glyph at 320 and 359 au is the hyphen. hyphen-classes at 1,068-1,074 au, urls at 1,760-2,349 au and in-word-breaks at 1,458-1,778 au aren't traced.

Scores of the forward runs, compared with the reverse runs:

| Browser | Cases | lineCount pass / fail | breaks pass / fail | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome | 10,976 | 10,740 / 236 | 10,640 / 336 | 10,160 / 416 / 64 / 336 | 9,985 / 927 / 64 | 0 |
| webkit-host | 9,584 | 9,447 / 131 | 9,365 / 213 | 8,764 / 290 / 311 / 213 | 8,330 / 1,051 / 197 | 6 |
| Firefox | 9,584 | 9,422 / 162 | 9,166 / 418 | 8,481 / 685 / 0 / 418 | 8,048 / 1,536 / 0 | 0 |

Families with the most line count or break losses. These are measurements of the library today, not yet attributed; counts include each paragraph's A and B cases.

- **Chrome:**
  - object-replacement: lineCount 216 of 348, no width passes (U+FFFC, blink-shortcut-audit C-u4);
  - languages 828 of 848; quotes 504 of 516; joining 702 of 718; tabs 784 of 796; following-space 272 of 288.
- **webkit-host:**
  - joining: lineCount 681 of 752, breaks 654, widths 444;
  - controls: lineCount 312 of 336, breaks 288, widths 174;
  - hanging-white-space 226 of 238; keep-all-storage 371 of 376.
- **Firefox:**
  - system-fonts-and-sizes: lineCount 620 of 680, breaks 500, widths 216;
  - joining: lineCount 680 of 736, breaks 606;
  - fit-bound: lineCount 341 of 360, breaks 330, widths 240;
  - hyphen-classes 744 of 756; hyphen-glyph 536 of 544.

### Stage 5 families, 2026-09-17

Native derivation only, seed `feature-families-20260917`, into `.artifacts/tests/features-20260917/<browser>/` (`chain.sh` there). The same builds, macOS 26A428, DPR 2. The given process languages were Chrome `uiLanguage` zh-CN (and en-US for `chrome-en-US`), webkit-host `preferredLanguages` zh-CN with ICU default `en_US_POSIX`, Firefox `regionalPrefsLocale` zh-hans-us. The final runs used `noop-predictor.ts` (`FINAL_RUNS=native`), because the ports don't implement structured inputs yet. The last column compares the native observations of the forward and reverse runs.

| Browser | Families | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases | History-dependent |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome, zh-CN | 10 | 1,624 | 12 | 7,168 | 5,011 | 3,804 | 484 | 1,673 | 180 | 12,882 | 0 |
| Chrome, en-US | 1 | 72 | 6 | 270 | 180 | 165 | 18 | 72 | 0 | 468 | 0 |
| webkit-host | 9 | 1,552 | 12 | 6,792 | 4,699 | 131 | 489 | 1,604 | 184 | 12,150 | 0 |
| Firefox | 9 | 1,552 | 12 | 6,727 | 4,627 | 3,520 | 477 | 1,623 | 186 | 11,946 | 0 |

Every unresolved target is `no-line-inside`, most of them in line-slots (336 Chrome, 332 webkit-host, 339 Firefox), where the line before it moves between rows. No native observation errors, rejected styles or missing fonts; every code point rect found its node rect (`pointRectsByCentre` 0). The smoke runs before the chain saw one rect per `<wbr>` in Firefox and none in Chrome and webkit-host.

What the offsets say. They are lengths the derivation leaves to pass D, so they show the rules at work:

- **Box edges.**
  - Chrome: 6px (134 brackets); 0.3984375px (86), the declared 0.4px in LayoutUnits; 0.5px (41), a 0.4px border snapped to one device pixel; −6px (30), negative margins.
  - Firefox: 6px (146), 0.4px (93), 0.5px (48).
  - Nested end edges: Chrome 8px (120) and 16px (18); Firefox 8px (136) and 16px (24).
- **Atomic inlines and nowrap spans.** 24px, 13.296875px (13.3px in LayoutUnits) and 26px (24 + 4 − 2) in Chrome, 24, 13.3 and 26px in Firefox: brackets where the line can't break before the box. Nowrap spans: 4px padding.
- **text-align, Chrome.** 32 brackets at 0.3671875px, 16 at 0.546875px and 16 at 1.109375px, where the line ends after a word that kerns with the space. They occur under `center`, `end`, `justify` and `right` in both directions (8 of 36 targets each), and never under `start` or `left`. `line_info.cc:127-175` gives NeedsAccurateEndPosition for `left` in RTL and `right` in LTR, and an RTL block has bidi (`inline_items_builder.cc:1486-1488`), so `right` in RTL and `left` in RTL aren't explained yet: a fact for the Blink owner to attribute. Firefox has every text-align and wbr bracket at the derived width, as Gecko doesn't reshape line ends.
- **Line slots.**
  - −80, −74.6 and −48.2px in Chrome, −80 and −74.6px in Firefox: the line reaching k sits below a wide first row, in a narrower row or at full width.
  - +16.95 and +28.9px in Firefox's tab paragraphs: a tab beside floats takes more room than in the unwrapped pass.
- **text-indent and br, Chrome.** −40.04, −80.08, −116.52 and −144.49px only in RTL `pre-wrap` paragraphs with a tab after the indent, and −40 to −76.5px in RTL `pre-wrap` and `break-spaces` lines that start with a preserved space after `<br>`. There the unwrapped extent overshoots, and pass D resolved every target.
- **webkit-host.** Only 131 of 4,699 brackets are at the derived width; most offsets lie between −1.3 and 0px, from partial Range edges snapped to whole px (§6 above). 144 `<wbr>` brackets sit one LayoutUnit above it.
- **Process languages, Chrome zh-CN against en-US.** 18 of the 72 paragraphs have other break opportunities at width 1: all of them `aa”bb`, whether lang="" is on the block, a span or a span inside `lang=ja`, under `auto`, `strict` and `loose` alike. zh-CN breaks after `”` and en-US doesn't, and the line-break keyword changes nothing. The 162 targets resolved under both locales have the same brackets.

### Stage 5 families with predictions, 2026-09-17

The ceiling round 1 evaluation ran the stage 5 family cases forward and in reverse with `lab/predictor.ts`, scorer 3 and the given process languages (`.artifacts/ceiling-20260917/evaluate/<browser>/features-{forward,reverse}`, REPORT.md §2.3). No row had a prediction error or `UnportedFeature`.

| Browser | Cases | lineCount pass / fail / unobserved | breaks pass / fail / unobserved | widths pass / fail / unobserved / not applicable | painter pass / fail / unobserved | History-dependent |
|---|---:|---|---|---|---|---:|
| Chrome, zh-CN | 12,882 | 12,135 / 28 / 719 | 12,135 / 28 / 719 | 6,943 / 220 / 4,972 / 747 | 6,992 / 430 / 5,460 | 0 |
| Chrome, en-US | 468 | 468 / 0 / 0 | 468 / 0 / 0 | 468 / 0 / 0 / 0 | 468 / 0 / 0 | 0 |
| webkit-host | 12,150 | 11,426 / 19 / 705 | 11,416 / 29 / 705 | 8,547 / 0 / 2,869 / 734 | 8,449 / 315 / 3,386 | 0 |
| Firefox | 11,946 | 11,270 / 6 / 670 | 11,267 / 9 / 670 | 6,254 / 0 / 5,013 / 679 | 6,245 / 233 / 5,468 | 0 |

- The unobserved line counts are `atomic-inlines` and `br-elements` lines that hold no Range rect; element rects aren't compared yet.
- Chrome's 28 line count failures are all `text-align`, under `glyph-clusters` and `unsafe-to-break`.
- webkit-host's 16 `br-elements` line count failures report `page-history` and pass alone in a fresh document (WebKit owner).
- Firefox's 6 line count and 9 breaks failures, and 2 of webkit-host's `line-slots` failures, report no gap. They are rows where row 0's two insets and the text-indent exceed the width, so the page puts row 0's right float one row lower: the slot-rows assumption doesn't hold there, and the scorer doesn't check it yet (§13).

### Round 3 derivations, 2026-09-17

Every family derived again, natively, into `.artifacts/tests/derive-r3-20260917/<browser>/{families,features}` (`chain.sh` there; Chrome's process-languages family under en-US in `chrome-en-US/features`): the pinned Chrome 153.0.8010.50, Firefox 156.0 and webkit-host on WebKit 22625.1.29.11.27, macOS 26A428, DPR 2, the same seeds and given process languages as before. The three browsers ran beside each other with every observation sharded (§5), and the whole chain took 8.5 minutes. Final runs are native (`final/native-file`, `final/native-reverse`), since the library was being changed; the evaluation runs the predictions. The rounds' rows are compressed (`zstd`), so a directory can't be stepped again without restoring them.

| Browser | Set | Paragraphs | Rounds | Targets | Resolved | At derived width | Unresolved | No reach | Non-monotone | Family cases | Protocol rows | History-dependent |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Chrome .50 | rule families (22) | 1,684 | 12 | 5,399 | 4,110 | 2,902 | 444 | 845 | 16 | 11,154 | 0 | 0 |
| Chrome .50 | feature families (10) | 1,640 | 12 | 7,232 | 5,059 | 3,848 | 500 | 1,673 | 180 | 13,010 | 0 | 0 |
| Chrome .50, en-US | process-languages | 72 | 6 | 270 | 180 | 165 | 18 | 72 | 0 | 468 | 0 | 0 |
| Firefox | rule families (20) | 1,558 | 11 | 4,492 | 3,511 | 2,876 | 261 | 720 | 0 | 9,776 | 0 | 0 |
| Firefox | feature families (9) | 1,568 | 12 | 6,760 | 4,656 | 3,568 | 482 | 1,622 | 169 | 12,050 | 0 | 0 |
| webkit-host | rule families (20) | 1,558 | 13 | 4,454 | 3,477 | 149 | 230 | 747 | 7 | 9,726 | 0 | 6 |
| webkit-host | feature families (9) | 1,568 | 12 | 6,853 | 4,742 | 131 | 507 | 1,604 | 180 | 12,268 | 0 | 0 |

Every unresolved target is `no-line-inside`, apart from 2 `rounds-exhausted` in Firefox's feature families.

The ceiling round 3 evaluation ran the predictions over these case files in both orders (`.artifacts/ceiling-20260917/evaluate-r3/<browser>/{families-r3,features-r3,features-en-US-r3}-{forward,reverse}`, scorer 5, no protocol row) and staged the tests seeds from them (§9); it also ran round 2's case files again, for the comparison with round 2 (REPORT.md §2.4).

- **Chrome .50 against .48.** The derivation under .50 gives every family case derived under .48 again, all 10,976 rule family cases, all 12,882 feature family cases and all 468 en-US cases, so every bracket sits where it sat. What is new comes from round 3's family changes: 178 `rule/joining` cases (the `shy-mark` word) and 128 `rule/text-align` cases (the ideograph word).
- **The width floor.** With `derive.ts` `minimumUnits` no final run has a protocol row. Against round 1's feature case files, 24 `rule/line-slots` cases left Firefox's file and 10 webkit-host's, among them all 15 and all 7 protocol rows of the round 2 seeds; both files gain the 128 `rule/text-align` cases.
- **Firefox and webkit-host rule families.** Firefox's file holds all 9,584 earlier cases and 192 new `rule/joining` ones. webkit-host's holds all but 2 and 144 new ones: one wave-2 target of `rule/in-word-breaks` (`p-32090e410e46ef61:7:14`, a `WaWa…` word) resolved on 09-16 and stays a window now, because no native line starts at offset 7 at the widths observed inside it. In-word breaks in WebKit depend on the process's history, and a sharded run gives every shard a fresh one; not traced further.

## 7. Versioned facts

A facts file holds one engine build's facts, one record per fact and scope:

```json
{"format":"pretext-fact/1","fact":"blink-lines H2 :: …","spec":"blink-lines H2",
 "scope":{"browser":"chrome","dpr":2,"probeSet":"blink-probes"},
 "verdict":"holds","decisive":{"expected":…,"measured":…},"supplementary":false,"probeSha256":"…",
 "env":{"engine":"blink","build":"153.0.8010.48","buildSource":"given","os":null,"userAgent":"…"},
 "observedAt":"…","run":"…","holdsIn":["153.0.8010.48"]}
```

- **Verdicts.**
  - `holds` and `fails` come from a check's `ok`; `undecided` from an `ok` of null.
  - `precondition-failed` marks every check of a probe whose Gecko `pre` check failed.
  - `errored` marks a probe or observation error.
- **Scope.** A Blink check at another DPR than the run's is outside the run's scope and isn't evaluated.
- **Supplementary.** Checks named `supplementary: …` are kept and never count for a rule.
- **Ids are provisional:** some check names still carry measured values, so a fact can change id between DPRs.
- **Build.** `probes/runner.ts` now records `build` in its output. Outputs recorded before that take the build as given, and the record says so.

| File | Facts | From |
|---|---:|---|
| `rebuild/facts/blink/153.0.8010.48.ndjson` | 756 | blink-probes at DPR 2 (340) and forced DPR 1 (336); zoom probes at forced DPR 3.5 (15) and emulated DPR 2 (22); system-ui in fresh browsers (19, 17, 7) |
| `rebuild/facts/blink/153.0.8010.50.ndjson` | 772 | the same seven sets, rerun in the pinned Chrome 153.0.8010.50 in ceiling round 3 (`rerun-probes.sh`, `.artifacts/tests/release-chrome-153.0.8010.50/probes`): all 756 facts of .48 compared, 756 unchanged, no decisive value changed, no flip, none missing; 16 new facts from probes added to `blink-probes.ts` since the seed (cross X5 with the DOM laid out first, a supplementary blink-text H29 check) |
| `rebuild/facts/webkit/22625.1.29.11.27.ndjson` | 176 | webkit-probes in webkit-host (88) and installed Safari (88) |
| `rebuild/facts/gecko/156.0.ndjson` | 404 | gecko-probes at apd 30 (269), 60 (13), 40 (12), 27 (12), 23 (12); follow-up (3); the round 2, 2b, 3 and 4 follow-up sets at apd 30 (83, all holding; round 4) |

- **No facts yet from:**
  - outputs that return raw values without checks: blink followups and gaps, webkit followups, gecko followups, followups-f2 and emoji-font;
  - the WebKit cross-check probes, whose verdicts a separate script decides.
- **Cross-setup diffs** (`facts.ts diff --match-scope=probeSet`):
  - webkit-host against installed Safari: 88 compared, 0 flips, 2 changed decisive values;
  - Chrome at DPR 2 against forced DPR 1: 279 compared, 12 flips. 11 are the system-ui cache-order and size claims (cross X5); 1 is blink-lines H3's DPR report. 41 decisive values changed, 61 facts missing and 57 new, mostly from check names carrying DPR values;
  - Firefox apd 30 against apd 60: 12 compared, 0 flips, 5 changed decisive values.

Per release, `bash rebuild/tests/rerun-probes.sh <browser> <previous facts file> <out dir>`:

- reruns every probe set the previous build's facts file holds, each in its setup (Chrome: DPR 2, forced DPR 1, the zoom probes at forced DPR 3.5 and emulated DPR 2, the three fresh-browser system-ui sets; Firefox: apd 30 and the apd 60, 40, 27 and 23 subsets and the H3b follow-up; webkit-host, and installed Safari with `ALLOW_SAFARI=1`), as short jobs under the lock at the same time. Until ceiling round 3 it reran only the main set, so a release would have reported every other scope missing;
- extracts facts under the build the runner records, and refuses sets that ran different builds;
- `facts.ts release` writes `rebuild/facts/<engine>/<new build>.ndjson` with `holdsIn` carried forward.

A fact's `spec` is the probe's label up to a colon, as a rule's probe entry is read, so probes labelled `gecko-port F12: how pair kerning divides` join rules citing `gecko-port F12`. The Gecko follow-ups F7 to F27 (`gecko-round2.ts`, `gecko-round2b.ts`, `gecko-round3.ts`, `gecko-round4.ts`) return `checks` and `pre` over their raw values since round 4 (F19's rows are under `rows`), and give 83 facts; `rerun-probes.sh` doesn't list those four sets yet, so a release rerun would report their facts missing until it does.

A flip or a missing fact exits 1. Either the browser changed (read the new source, update specs and port), or the claim depends on process history (narrow its scope to fresh processes).

## 8. Coverage matrix

`bun rebuild/tests/coverage.ts --facts=<facts files> --derived=<derivation dirs> [--previous=<coverage.json>]`.

A current rule is covered by any of:

- a listed asserting test that is present in the tree;
- a holding fact joined through its probe labels;
- an observed family: a family naming the rule, scored in that engine's browser, with at least one resolved bracket.

Reach from generic or main-derived case families is measurement and doesn't count. Also listed:

- rules with probe labels but no holding fact;
- current heuristics and choices by score;
- stale test references;
- removed rules with their replacements.

With `--previous`, a rule that loses its last observed family exits 1.

Also listed: rules with a derived family, whose family has resolved brackets in the engine's browser but no scored prediction run yet (`derivedFamilies`, counted as `derivedOnly`). They don't count as covered.

Regenerated 2026-09-17 by the ceiling round 2 evaluation, from `rebuild/facts/*` and derivation directories whose `file` and `reverse` runs are that evaluation's predicted runs under scorer 4: `.artifacts/ceiling-20260917/evaluate-r2/<browser>/{families-derived,features-derived}` (plus `chrome/features-en-US-derived`), against the round 1 matrix: no rule lost its last observed family. The family cases are round 1's, and Chrome's runs are 153.0.8010.50's over cases derived under .48 (REPORT.md §2.6).

| Engine | Current rules | Covered | By tests | By facts | By families | Uncovered | Uncovered with a derived family | Probe labels without a holding fact |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Blink | 179 | 140 | 39 | 57 | 109 | 39 | 0 | 8 |
| WebKit | 144 | 103 | 23 | 47 | 91 | 41 | 0 | 10 |
| Gecko | 124 | 101 | 51 | 55 | 77 | 23 | 0 | 6 |
| Shared | 29 | 12 | 6 | 6 | 0 | 17 | 0 | 0 |

**Adopted at the correctness line, 2026-09-18:** `rebuild/tests/coverage.json` is the headline configuration's matrix, regenerated from the frozen line's runs (exit 0: Blink 155 of 195 rules covered, WebKit 114 of 156, Gecko 128 of 152, shared 22 of 36; the two configurations cover the same rules and differ in their families' pass counts), and each configuration's matrix is beside its seeds (§9).

**Staged by the ceiling round 3 evaluation, 2026-09-18** (`rebuild/tests/baselines/staged-round3/coverage.json`, in the history since the adoption; `rebuild/tests/coverage.json` was unchanged then): regenerated from the .50 facts file, the WebKit and Gecko facts files and round 3's derivation directories with the evaluation's scored runs (`evaluate-r3/<browser>/{families,features}-r3-derived`, plus `chrome/features-en-US-r3-derived`), against the round 2 matrix. It exits 1: `webkit/measure/word-spacing-in-js` lost its last observed family, because the WebKit owner retired that id for `webkit/measure/word-spacing-in-context` and the families `following-space` and `tabs` still name the old one (`tests/families/families.test.ts` fails on it too). The replacement rule has no family until those two name it.

| Engine | Current rules | Covered | By tests | By facts | By families | Uncovered | Probe labels without a holding fact |
|---|---:|---:|---:|---:|---:|---:|---:|
| Blink | 179 | 144 | 41 | 57 | 113 | 35 | 8 |
| WebKit | 152 | 109 | 30 | 47 | 90 | 43 | 14 |
| Gecko | 124 | 104 | 55 | 55 | 79 | 20 | 6 |
| Shared | 29 | 12 | 6 | 6 | 0 | 17 | 0 |

9 rules are annotated in source (`// rule <id>`, the WebKit owner's round 3 rules); the others aren't. Round 4 registered Gecko's round 3 and round 4 rules, Blink's round 4 rules, the font checks and scorer 6's assumptions (§3); round 3's Blink rules aren't in the registry yet. No matrix has been regenerated since, so the tables above don't count them.

The staged matrix's exit 1 is fixed since round 4: `coverage.ts` `lostObservedFamilies` doesn't count a removed rule whose replacements all have an observed family, and `following-space` and `tabs` name `webkit/measure/word-spacing-in-context`; regenerated over round 3's derived runs it exits 0 (WebKit 110 covered, 91 by families).

Ceiling round 3 gave each of round 2's six rules what it lacked (below the list); the staged matrix above shows them. A trial regeneration over round 2's runs with the .50 facts file covers all six: four by test and family, `blink/shape/pair-window-whole-clusters` and `blink/shape/cluster-unit-grapheme` by family.

Round 2 added six rules, and none had a test, fact or family in that matrix: `blink/justify/cjk-ideograph-or-symbol`, `blink/measure/pair-kerning-from-fact`, `blink/shape/cluster-unit-grapheme`, `blink/shape/pair-window-whole-clusters`, `gecko/lines/in-word-advance-split-kerning` and `gecko/measure/lang-empty-locale-language`. Four more Gecko rules carry probe labels without a holding fact, since the round 2 probes (F7 to F12) aren't in the facts files: `gecko/gap/in-word-prefix`, `gecko/lines/in-word-advance-split-kerning`, `gecko/measure/range-in-script-context` and `gecko/script/latin-fast-path`.

- Four of the six had a test all along. The registry names it as bun prints it, `describe block > test name`, and `coverage.ts` looked for that whole string in the file; it now finds each part (`testPresent`). 14 other test references were stale until round 4, which gave them the names the files hold now (`blink/lines/forced-break`, `blink/script/script-run-iterator`, four Gecko B2 and B4 entries, six shared entries): every test the registry lists is present. A name with an apostrophe is listed up to the apostrophe, because `testPresent` looks for the name in the source, where it is escaped; where two names share that beginning, the part after the apostrophe's clause is listed instead (correctness round 5's WebKit tests, "the code path is the measured string's: ...").
- Families now name the rules they exercise: `in-word-breaks` (`AV` and `Wa` words in Arial, Hoefler Text and Times New Roman, fonts on both sides of the `pairKerning` fact) names `blink/measure/pair-kerning-from-fact` and `gecko/lines/in-word-advance-split-kerning`; `clusters` (Bengali conjuncts in Kohinoor Bangla) names `blink/shape/cluster-unit-grapheme`; `languages` (`lang=""`) names `gecko/measure/lang-empty-locale-language`.
- Two families grew: `joining` has a `shy-mark` word, a kasra right after the soft hyphen, for `blink/shape/pair-window-whole-clusters` (96 to 128 paragraphs an engine), and `text-align` has an ideograph word in PingFang SC under `justify` and `start`, for `blink/justify/cjk-ideograph-or-symbol` (144 to 160).

What stays uncovered:

- of the stage 5 rules, the three `Element.getClientRects()` observation rules and the two observer assumptions (`shared/lab/vertical-centre-grouping`, `shared/lab/slot-rows`). Scorer 4 compares element rects on every feature row and checks slot rows by rule, but the registry lists no test or family for them. All 50 stage 5 engine rules have an observed family;
- by kind: Blink 28 ported rules, 5 named gaps, 2 recipes, 2 heuristics and 1 fact; WebKit 36 ported rules, 3 named gaps and 1 recipe; Gecko 18 ported rules and 4 named gaps; shared 9 recipes, 3 ported rules, 2 heuristics and 1 choice by score;
- the new output geometry rules. Their evidence is the observation ports' tests and scorer v2's comparisons, which the registry doesn't list yet;
- builder scaffolding: `webkit/builder/*`, `webkit/ilb/*`, `gecko/script/*`;
- gaps no family triggers: dictionary breaks unavailable, page zoom, page history, float32 precision, bitmap emoji size;
- the painter's 12 rules, since painter probes haven't run.

Twelve current rules are heuristics or choices by score: `blink/shape/wide-group-halved`, `blink/shape/cluster-unit-grapheme` (registered in round 2), `blink/shape/position-adjust-window`, `shared/env/engine-from-user-agent`, three painter rules, and since round 4 `webkit/lines/shaped-run-in-joining-context`, `webkit/gap/language-dependent-fallback-table`, `webkit/measure/font-check-fixed-pitch`, `gecko/measure/sides-add-up-is-exact` and `gecko/measure/suffix-side-recipe` (CHARTER.md, "Standing"). `blink/measure/ignorables-left-out-if-8bit` became a ported rule in round 2.

## 9. The gate

`bun rebuild/tests/gate.ts seed|check --derived=<derivation dir> --baseline=<file> [--facts=<file>] [--coverage=<file>] [--corpus-baseline=<lab gate file> --corpus-runs=<per-case files>] [--out=<report>]`

- **Seeds go to a staging folder.** `gate.ts seed` needs `--staging=<dir>`, writes `<staging>/<baseline name>` with `<name>.seed-record.json`, and never the baseline it names (round 4).
- **Rule families, blocking.** The (case id, metric) pairs that passed in both seeding runs, forward and reverse. The seed and check rules are `lab/gate.ts`'s, with `--complete`. History-dependent cases, protocol rows and unstable pairs never fail.
- **Facts, blocking.** The build's facts file against the one the baseline recorded; a verdict flip or a missing fact fails.
- **Coverage, blocking.** A rule of the engine that had an observed family at seeding and has none now fails.
- **Measurement corpus, report only.** Main-derived runs (`suite/`, `obligations/`) checked against a lab G0 baseline. Losses are counted per family group and never fail.
- **Exit 2** when runs come from another environment than the baseline, when the derived cases changed, or when a run wasn't scored against the other order. `lab/gate.ts` compares an environment key part by part and names what differs: another browser build or device (derive the families again for the new build and seed a new baseline); process languages that don't match the baseline's recorded languages, or a baseline that recorded none (another environment: seed a baseline for it); another scorer version (re-score the seeding runs and seed a new baseline). Seeding refuses runs whose environment records no process languages.
- **Protocol rows.** A row whose page doesn't describe its declared input (lab `score.ts` `slotProtocol`: slot floats outside their rows) is never a pass. Seeding lists it under `protocol`, and a check never fails on it. `lab/gate.ts --prune-protocol --baseline=<file>` applies the rule to the rows of every seeding run a baseline names and moves such rows out of its passes, listing each removed pair.

| Baseline | Environment | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Unstable pairs |
|---|---|---:|---|---:|---:|---:|
| `chrome-153.0.8010.50.json` | Google Chrome 153.0.8010.50, macOS 26A428, DPR 2, `uiLanguage` zh-CN, scorer 4 | 10,976 | 42,233 (10,810 / 10,749 / 10,455 / 10,219) | 0 | 0 | 0 |
| `chrome-features-153.0.8010.50.json` | the same | 12,882 | 42,595 (12,882 / 12,882 / 9,733 / 7,098) | 0 | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | the same with `uiLanguage` en-US | 468 | 1,872 (468 / 468 / 468 / 468) | 0 | 0 | 0 |
| `webkit-host-22625.1.29.11.27.json` | webkit-host 27.0 on WebKit 22625.1.29.11.27, `preferredLanguages` zh-CN,zh-Hans, `icuDefaultLocale` en_US_POSIX, scorer 4 | 9,584 | 36,038 (9,458 / 9,376 / 8,822 / 8,382) | 6 | 0 | 0 |
| `webkit-host-features-22625.1.29.11.27.json` | the same | 12,150 | 43,800 (12,123 / 12,111 / 10,923 / 8,643) | 0 | 7 | 0 |
| `firefox-156.0.json` | Firefox 156.0, `regionalPrefsLocale` zh-hans-us, scorer 4 | 9,584 | 35,272 (9,432 / 9,200 / 8,592 / 8,048) | 0 | 0 | 0 |
| `firefox-features-156.0.json` | the same | 11,946 | 39,149 (11,931 / 11,931 / 8,862 / 6,425) | 0 | 15 | 0 |

Seeded by the ceiling round 2 evaluation (REPORT.md §2.6; `.artifacts/ceiling-20260917/evaluate-r2/tools/reseed.sh`) with `gate.ts seed`, the facts files and the regenerated coverage matrix, through derivation directories that link the evaluation's forward and reverse runs (`evaluate-r2/tools/derived-dirs.sh`). Each baseline checked against its own runs with the environment check on: 0 lost pairs, pass. The round 1 seeds refuse the round 2 runs by environment (scorer 4; Chrome's new build; webkit-host's `preferredLanguages`), and nothing was checked without that check. What each new seed loses against the round 1 seed and against the pre-round-1 seed is listed pair by pair, with its category, line-local gaps and attribution, in `rebuild/lab/baselines/reseed-round2-lost-pairs.json`: Chrome's rule families 24 painter pairs and feature families 33, webkit-host's feature families 17 widths that scorer 4 alone leaves unobserved and 8 painter pairs, Firefox none.

**Staged by the ceiling round 3 evaluation, 2026-09-18** (`rebuild/tests/baselines/staged-round3/`, not adopted; REPORT.md §2.6). `gate.ts check` refuses round 3's runs against every baseline above by environment (scorer 5 against scorer 4), as it should. `gate.ts seed` still writes the file it names, so the evaluation named files in the staging folder (`evaluate-r3/tools/gates.sh`), seeded from round 3's derivations with the .50 facts file for Chrome, and wrote each seed's record with `lab/gate.ts` `seedRecord` (`evaluate-r3/tools/tests-seed-record.ts`): lost pairs with covering gaps and attributions, pairs that leave through history dependence or protocol rows, gained pairs. The orchestrator adopts them after the critic.

| Staged baseline | Family cases | Pass pairs (lineCount / breaks / widths / painter) | History-dependent | Protocol rows | Lost against the adopted seed | Cases only in the adopted seed |
|---|---:|---|---:|---:|---|---:|
| `chrome-153.0.8010.50.json` | 11,154 | 10,998 / 10,952 / 10,662 / 10,508 | 0 | 0 | 2 painter pairs | 0 |
| `chrome-features-153.0.8010.50.json` | 13,010 | 13,010 / 13,010 / 11,743 / 9,251 | 0 | 0 | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | 468 | 468 / 468 / 468 / 468 | 0 | 0 | 0 | 0 |
| `firefox-156.0.json` | 9,776 | 9,721 / 9,616 / 9,224 / 8,667 | 0 | 0 | 8 lineCount, 24 breaks (`font-size-quantization`), 12 painter | 0 |
| `firefox-features-156.0.json` | 12,050 | 12,050 / 12,050 / 10,866 / 8,421 | 0 | 0 | 0 | 24 |
| `webkit-host-22625.1.29.11.27.json` | 9,726 | 9,685 / 9,662 / 9,115 / 8,606 | 6 | 0 | 8 lineCount, 8 breaks, 16 painter (`rule/joining`, `rtl-shaping-across-inline-boxes`) | 2 |
| `webkit-host-features-22625.1.29.11.27.json` | 12,268 | 12,248 / 12,236 / 11,021 / 8,817 | 0 | 0 | 0 | 10 |

The cases only the adopted feature seeds hold are the `rule/line-slots` cases under the new width floor, the 22 protocol rows among them. With these seeds Chrome's tests baselines hold one build throughout (cases derived under .50, .50's facts, .50's runs).

**Staged by the round 4 evaluation, 2026-09-18** (scorer 7, round 4's library at 3c17016, not adopted; tools in
`.artifacts/ceiling-20260917/evaluate-r4/tools`: `gates.sh`, `attribute-records.py`, `seed-records.py`). One staging folder
per configuration, because the baseline names carry none: `rebuild/tests/baselines/staged-round4-no-facts/` (the headline)
and `staged-round4-facts/`, seeded from round 3's derivations as tier 2 ran them, each with a regenerated `coverage.json`
(exit 0: Blink 155 of 195 rules covered, WebKit 114 of 156, Gecko 128 of 152, shared 22 of 36); the lab gate's seeds are in
`rebuild/lab/baselines/staged-round4-{no-facts,facts}/` (smoke, the development sets with `rich-prewrap`, the held-out sets
and the giants); tier 2's are in `rebuild/tests/baselines/staged-round4c-sets/`, compared with round 4a's staged seeds.
Every staged seed passes a check against its own runs with the environment check on, and every lost pair carries an
attribution in its seed record: round 3's where the pair was already lost then, else by rule from the pair's status in the
other configuration and in the round 4a reference ledger.

| Staged seed | Pass pairs (lineCount / breaks / widths / painter), no facts | Lost against the adopted seed, no facts | With facts | Left with a case the runs don't hold |
|---|---|---|---|---:|
| `chrome-153.0.8010.50.json` | 10,970 / 10,910 / 10,596 / 10,520 | 208 (26 lineCount, 41 breaks, 101 widths, 40 painter) | 2 painter | 0 |
| `chrome-features-153.0.8010.50.json` | 12,994 / 12,994 / 11,564 / 9,225 | 276 (16 / 16 / 180 / 64) | 0 | 0 |
| `chrome-en-US-features-153.0.8010.50.json` | 468 / 468 / 468 / 468 | 0 | 0 | 0 |
| `firefox-156.0.json` | 9,674 / 9,488 / 8,892 / 8,475 | 167 (10 / 34 / 111 / 12) | 12 painter | 0 |
| `firefox-features-156.0.json` | 12,050 / 12,050 / 10,866 / 8,421 | 0 | 0 | 18 pairs |
| `webkit-host-22625.1.29.11.27.json` | 9,697 / 9,674 / 9,126 / 8,617 (6 history-dependent) | 16 painter | 16 painter | 6 pairs |
| `webkit-host-features-22625.1.29.11.27.json` | 12,248 / 12,236 / 11,063 / 8,817 | 0 | 0 | 12 pairs |
| lab gate, Chrome | | 79 (1 / 1 / 59 / 18) | 0 | 0 |
| lab gate, Firefox | | 100 (4 / 7 / 84 / 5); 28 pairs left through history dependence, all passing now | 5 | 0 |
| lab gate, webkit-host | | 4 (1 width, 3 painter); 175 pairs left through history dependence, 81 passing now | 4 | 0 |
| tier 2, Chrome (against round 4a's staged seed) | 65,520 / 65,449 / 61,990 / 59,299 | 270 (14 / 6 / 0 / 250) | 0 | 0 |
| tier 2, Firefox | 63,060 / 62,864 / 60,066 / 55,604 (313 history-dependent) | 546 (32 / 96 / 209 / 209) | 546 | 0 |
| tier 2, webkit-host | 63,368 / 63,311 / 60,956 / 55,059 (279 history-dependent) | 0 | 0 | 0 |

- With the lab's facts the lab and tests seeds lose exactly what round 3's staged seeds lost, under round 3's attributions
  (Chrome's 2 `rule/joining` painter pairs, Firefox's 12 painter pairs and 5 lab pairs, webkit-host's 16 `rule/joining`
  painter pairs and 4 lab pairs). The line counts and breaks round 3's seeds lost pass again: Firefox's 13.33px system font
  rows by accident, as under round 2's OffscreenCanvas (Gecko owner), and webkit-host's `rule/joining` rows since round 4a.
  The adopted seeds are round 2's, recorded on an OffscreenCanvas, so they don't show what Firefox lost against round 3's
  canvas element; tier 2's record does.
- With no supplied facts the adopted seeds, recorded with the lab's facts, are the wrong yardstick: every lost prediction
  pair passes in this evaluation's facts runs and fails under the gap of the fact that is missing (`pairKerning` under
  Blink's `unsafe-to-break` and Gecko's `in-word-prefix`, `ligatures` and `coverage` under `glyph-clusters`), its widths pair
  is not applicable where breaks fail, and its painter pair follows.
- Tier 2's losses are the ledger transitions of REPORT.md "What rounds 4a to 4c changed": Chrome's accidental passes of
  round 3's no-facts library, and Firefox's measured cost of the OffscreenCanvas decision.
- A sealed-4 record is in `rebuild/lab/baselines/sealed-4-20260918.json`.

**Adopted at the correctness line, 2026-09-18.** After the critic's verdict (research/ROUND4-CRITIC.md: adopt) the seeds of
the table above were made again by the same commands from the recordings the references are frozen from
(`.artifacts/tests/runs/line-20260918` and the giants beside them; library feb3937, the evaluated library with the font
checks' contexts changed; tools in `.artifacts/ceiling-20260917/freeze-line/tools`: `tier2.sh`, `giants.sh`, `gates.sh`,
`carry-attributions.py`, `adopt.py`, `check-adopted.sh`). Every new seed equals the evaluation's staged one in passes,
history-dependent cases, unstable pairs, protocol rows and environments, so the table's counts stand, every record lists the
same lost pairs, and each pair carries the evaluation's attribution (2,251 pairs in 26 records, none without one). Where they
sit: `rebuild/tests/baselines/{no-facts,facts}/` with each configuration's `coverage.json` (`rebuild/tests/coverage.json` is
the headline configuration's), `rebuild/lab/baselines/{no-facts,facts}/`, and `rebuild/tests/baselines/sets/` for tier 2,
each with its seed record. All 20 lab and tests checks of an adopted seed against its own runs pass with the environment
check on. The round 2 seeds in the first table, the round 3 staging folders and the round 4 ones are in the history before
the adoption; Chrome's .48 seeds stay.

**Scorer 6 (2026-09-18)** made every scorer 5 staged seed above refuse. Tier 2's seeds for the same sets are staged in `rebuild/tests/baselines/staged-round4-sets/` (six files, both configurations); forward-only runs of each browser lose nothing against them. They describe the round 3 library, and are made again after round 4's merges.

- Chrome's three files are new, for build 153.0.8010.50, which replaced .48 on 2026-09-17; the .48 seeds stay in their own files. Their family cases were derived under .48 (the `build` field), the runs are .50's, whose native views equal .48's on every family case in both orders (`evaluate-r2/native-rounds-chrome.json`), and their facts file is .48's. §12's procedure (probes, derivation) hasn't run for .50.
- The feature seeds still hold round 1's cases, with their protocol rows listed apart (Firefox 15, webkit-host 7). Round 1's seeds were pruned of those rows by rule in ceiling round 2 (`lab/gate.ts --prune-protocol`, reports in `.artifacts/lab/round2-scorer4/prune/`). Ceiling round 3 derived the families again with `derive.ts` `minimumUnits` (§6, "Round 3 derivations"); the next seeds take `.artifacts/tests/derive-r3-20260917/<browser>/{families,features}`, whose Chrome cases were derived under .50 with .50's facts file beside them.

Round 1 history: the pre-round-1 rule-family baselines were keyed on scorer 2 without process languages, so `gate.ts check` refused round 1's runs by design (exit 2). Round 1's evaluation compared them by the same rules without the environment check, which its critic rejected (research/ROUND1-CRITIC.md item 2) and round 2 doesn't do: Chrome's rule families lost 44 painter pairs (`rule/joining`, the Blink owner's fix-r12), webkit-host's 22 line counts, 22 breaks and 6 painter pairs (`rule/joining` under `rtl-shaping-across-inline-boxes`), and Firefox's none.

## 10. Main's tests

Main-derived families are a measurement corpus. In this gate they are the report-only layer. They are admitted only through triage records (TEST-ARCHITECTURE §7): an objective fact to learn, a pass main got by accident, or an opinion we drop. research/TESTS.md §1a's first-class verdicts are withdrawn. The G0 baselines in `lab/gate.ts` stay the lab's regression check until they're retired (DESIGN §8.3 stage 4); their obligations pairs should be report-only there too (TENTPOLES-CRITIC §2.E item 7).

## 11. Independence

`rebuild/tests/independence.test.ts` checks every file under `rebuild/tests`, `rebuild/lab` and `rebuild/probes` except `lab/predictor-core.ts`, the prediction adapter; `lab/predictor.ts` and `lab/baselines/no-facts-predictor.ts` are made from it and import only contract constants from `rebuild/src`. They may import from `rebuild/src` only:

- types from `src/model.ts` and `src/env.ts`;
- constants from those two files that aren't functions, such as `UNKNOWN_FONT_FACTS` and `PINNED_BUILDS`;
- types from an engine's `src/engines/<engine>/geometry.ts`: its line geometry and the state its next line starts from, which a row keeps whole.

Engine or library logic fails the test. It passes since round 4. The layout a row keeps and the observation contract are the lab's own types (`lab/types.ts`, `lab/observe/contract.ts`) since the re-architecture's S1, so the lab takes from `src/model.ts` the input tree, fragments and gaps, from the three `geometry.ts` the engines' geometry and line starts (S2), and nothing about rows. Two probes bundle library modules into their page to run them in a browser (`probes/font-checks.ts`, which also bundles each port's `checks.ts`, and `probes/canvas-checks.ts`); they import nothing from them, and their expected values aren't the library's.

The same test holds the library's own rule (research/ARCHITECTURE-PLAN-2.md §5.4): outside comments, a file of `rebuild/src` that isn't under `engines/` and isn't `index.ts` (the one dispatch) or `env.ts` (whose shape is per engine) imports nothing from `engines/` and holds no engine's name as a string or in an identifier. Since step 3 every shared file holds: `paint.ts` takes each engine's painting rules as a `PaintRules` value (`engines/<engine>/paint-rules.ts`), and the list of exceptions is empty; and an engine imports no other engine. What differs by engine reaches shared code as data the engine gives: its `BidiData`, grapheme rules and break rules (`engines/<engine>/data.ts`), what it asks of the Canvas checks and the font checks (`engines/<engine>/checks.ts`), and its painting rules (`engines/<engine>/paint-rules.ts`).

## 12. Per browser release

0. Pin the new build: `bash rebuild/lab/pin-browser.sh chrome|firefox` copies the installed bundle and checks the copy byte for byte; try it with `LAB_CHROME_APP=<copy>` or `LAB_FIREFOX_APP=<copy>` on a smoke run, then point `lab/browser-build.ts` `LAB_APPS` at it (lab README, "Pinned browsers"). The lab never launches the installed Chrome or Firefox, so a release arrives when the pin moves, not when the updater runs. Check the engine source between the two tags first.
1. `run.ts` and `probes/runner.ts` read the new build from the pinned bundle; rows and outputs carry it, with the app path and the copy's tree hash in the run record.
2. `rerun-probes.sh` per browser: a new facts file, and flips block that engine.
3. `observe-families.sh` into a new derivation directory, deriving the families under the new key.
4. `coverage.ts` over the new facts and derivation directories, with `--previous`.
5. `gate.ts check` against the previous key exits 2 by design. Attribute the old key's pairs against the new runs (browser change, observation problem, history dependence, scorer change), then seed the new key.

A macOS update moves all three keys.

**Chrome 153.0.8010.50, ceiling round 3.** Between the tags 153.0.8010.48 and .50 only `chrome/VERSION` differs and `DEPS` is unchanged, so every file the port reads is identical. Steps 0 to 3 ran: the pinned copy (tree sha256 `712aa9f5…`), whose native observations equal the installed .50's on all 2,580 `runs` cases; the facts file, with all 756 of .48's facts unchanged (§7); and the derivation, which gives every one of the 10,976 family cases derived under .48 again, and the feature families' cases likewise apart from the ones round 3 changed on purpose (§6, "Round 3 derivations"). Steps 4 and 5 belong to the evaluation, which scores the new case files and stages the seeds; the library's own pin (`src/env.ts` `PINNED_BUILDS`) is the Blink owner's to move.

## 13. Not built yet

- Tier 1 (L3) gates nothing by itself, and its inputs are recorded per library: a library that asks Canvas new questions needs a new recording (`browser-sets.ts --record`, `replay.ts pack`, `freeze --force --reason`).
- Triage records for the census's main-only rows (§7).
- Lock files and oracle answers under `rebuild/data`, with skipped oracle tests turned into failures (§5).
- Environment reruns for rules that read DPR or app units: forced DPR 1 in Chrome, other apd in Firefox. `run.ts` takes no browser switches.
- Family baselines for installed Safari; webkit-host stands in. The ceiling round 2 evaluation ran the combined rule and feature families file (21,734 cases) in installed Safari in both orders: every native view, prediction and score equals webkit-host's (REPORT.md §2.7). Its held-out and sealed-2 combined files didn't finish there, because a hidden Safari page stops in a job longer than about 8 minutes. Since ceiling round 3 an installed Safari run goes through 5-minute parts, each in a fresh tab (lab README, "Parts"), and `run.ts --parts-from` repeats its parts in webkit-host so both see every case after the same history. The round 3 evaluation ran both combined files that way in both orders, in 2-minute parts, every row hidden: no job failed, and every native view, prediction and score equals webkit-host's (REPORT.md §2.7).
- In-probe fact declarations with value-free check names (§4.1); painter probes.
- Page-history preludes (§6.5). The per-case isolation protocol exists since ceiling round 3: `lab/sharded.ts --isolate` runs given cases each in a fresh browser process (lab README, "Sharded runs and isolation").
- For structured cases: line keys that place atomic inlines, and a check that no line box is taller than the line height in slot cases. Scorer 4 compares `elements` and marks slot protocol rows (lab README "Elements", "Protocol rows"); round 1's feature families had 22 such rows (Firefox 15, webkit-host 7), and `derive.ts` `minimumUnits` now keeps derived widths at or above each engine's bound. A re-derivation of `line-slots` with it produced no protocol row in Firefox or webkit-host (lab README "Protocol rows"), and ceiling round 3 derived every family again with it (§6, "Round 3 derivations": no protocol row in any browser). The feature-family baselines still hold round 1's cases until the evaluation seeds from the new case files.
- A second controlled locale for Firefox and webkit-host: Firefox's Mac command line passes a Cocoa `-AppleLanguages` pair on as arguments to open, and webkit-host rejects arguments it doesn't know (lab README, "Browser-process languages").
