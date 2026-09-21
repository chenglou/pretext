# Handoff, 2026-09-20 evening: where the rebuild stands and how to continue

Written for whoever picks this up with no memory of the sessions that built it. Read this file, then the four it points at
in section 1, before touching anything. Everything is on branch `rebuild-20260916` of the Pretext repository; the rebuild
lives under `rebuild/` and the published library it replaces is the repository's root (`src/`, "main" below).

## 1. Read first

- `rebuild/CHARTER.md`: the rules. No guesswork: every rule in a port is a ported rule with a source citation, a fact
  Canvas measured, or a named gap reported with the layout. No choices by lab score, no name-keyed heuristics, no
  tolerances, no per-font tables, no DOM reads. Every heuristic is registered and named in the charter's standing list.
- `rebuild/DESIGN.md`: the architecture. One exact port per engine (`src/engines/{blink,webkit,gecko}`), each predicting
  its browser's own lines from Canvas `measureText` alone; §4.6 and §4.7 say what state a prepared paragraph and a page's
  list of contexts hold, and why nothing else is kept.
- `rebuild/TESTS.md` and `rebuild/lab/README.md` ("Test tiers"): how a change is verified. Tier 0 (types, unit tests),
  tier 1 (offline replay of about 390,000 recorded cases against frozen references), the function set's checks, the
  painter differential, the twin scan, tier 2 (the sets in the pinned browsers), and the rules around them. Section 4
  below is the short form.
- `rebuild/research/PROFILING-START.md`: the current phase's guide, with dated corrections and a paragraph per item
  that landed. Every study of the rebuild is a file in `rebuild/research/`; each starts with the orchestrator's reading,
  then the reviewer's (attacker's, critic's) report, then the owner's.

## 2. The maintainer's stance and order of work

In their words, as said on 2026-09-18 to 2026-09-20:
- The order is correctness first (done: the correctness line is frozen, tag `correctness-line`), then simplify (done: the
  re-architecture, tag `rearchitecture-done`), then profile and optimize (now), then the API, last.
- On caching: "simple and performant without caching heuristics". An invisible acceleration is fine only if it can't go
  stale or leak; every kept thing names its lifetime, what invalidates it and what bounds it.
- There is no performance bar. A first bar of about 2 s per 10,000 chat messages was withdrawn as unsubstantiated: "a
  faster stateless api will contribute to a fast stateful api". The stop rule is a ranked list per engine of what each
  item buys in µs a message against the lines and state it adds; the maintainer decides from that list.
- Where main is fast for a reason that fits this architecture, take that reason back. Where it is fast by fitting
  (tolerances, corrections found by score), don't.
- The codebase stays small; line count matters more than bundle size. Prefer plain code a reader can follow. Indexed
  for loops in new code. Structure-of-arrays and typed arrays are the engineering optimizations to reach for before
  algorithmic ones (their steer of 2026-09-20), where a measurement says they pay: the profiling pass found they pay in
  WebKit's line builder and not in SpiderMonkey's hot loops.
- Cover Chrome, Safari and Firefox and their mobile variants; Edge counts as Chrome; never show nothing on a modeled
  engine; no special cases for fringe browsers.
- Public voice: plain language, no invented jargon; a comment on an issue reads like the maintainer talking.

## 3. Where it stands (2026-09-20 evening)

Correctness, no supplied font facts, unseen cases: line counts Chrome 99.45%, Firefox 99.89%, webkit-host 99.89% on
main's whole suite (`research/CALIBRATION.md`); on 4,686 real paragraphs a browser, 0 wrong lines. Against main: of the
cases main gets wrong the rebuild passes 98.3 / 99.7 / 99.8%, of main's passes it fails 0.16 / 0.06 / 0.07%.

Speed, 10,000 chat messages of the benchmark's mix (`rebuild/bench/README.md`, "Chat"), quiet machine, as the landing
reviews measured it today; a page's list of contexts where the engine keeps one (Chrome and WebKit; Firefox makes its
own, section 5):

| | from scratch | plain ASCII | 10,000 kept messages laid out at 3 new widths |
|---|---:|---:|---:|
| Chrome 153 | about 2.4 s | about 2.2 s | about 0.94 s |
| Firefox 156 | about 0.74 s | about 0.42 s | about 0.55 s |
| Safari 27 (webkit-host) | about 0.12 s | about 0.085 s | about 0.02 s |
| main, cold prepare / layout | 0.31 to 0.35 s | 0.20 s | 0.008 to 0.014 s |

These are the landing reviews' alternating-pair numbers on the branches, not one benchmark run of the final tree; the
first thing to do on a quiet machine is `rebuild/bench/chat-night.sh .artifacts/bench/<name> --chat-sets=mix,latin,real`
and to put its numbers here.

What landed today (all pushed): a page's list of Canvas contexts (`prepare(paragraph, env, inspect, contexts)`); Blink's
positions kept by offset on a prepared paragraph; Gecko's measuring in windows inside long shaping units; Blink's cut of
a wide group asked less (the search tries offsets beside a space first, a passed cut keeps its 0); Gecko's contexts made
per call (section 5); the JS profiling pass's free fixes in all three ports; the tools that remove their own scratch
directly; `replay.ts pack` and `freeze` taking the gates' turn; a rule that a change to Blink's cuts passes the fonts
probe (section 4).

Where the time goes now (`research/PERF-JS-PROFILE.md`): Chrome is about 80% inside Canvas, and its cut search of
groups wider than 256 zoomed px is the largest block of questions; Firefox is about half Canvas, and 76 to 84% of its
questions are break candidates inside a line's first word that decide nothing when the word fits; WebKit is mostly its
own code, now a flat loop for a line's leading plain items.

## 4. How a change is verified, the short form

- `bun rebuild/tests/gates.ts --engine=<blink|webkit|gecko|all> [--quick] [--fresh]` runs every offline check and
  prints one table. Exit 0 means every gate is fine for a change that moves no prediction and no Canvas question. Tier 1
  chrome may exit 3 by the string storage rule alone (a file that builds Chrome's strings changed): that sends Chrome's
  cases to a recording, it isn't a failure. A run takes a machine-wide turn (a ticket in `.artifacts/tests/gates/queue`)
  and reuses a finished result whose inputs are the same; `--fresh` runs anyway.
- A change that moves predictions or questions is recorded again in the browser, from a clean detached worktree at the
  commit: `bun rebuild/tests/browser-sets.ts --browser=<b> --config=<no-facts|facts> --both-orders --record --out=<dir>`
  for each configuration, the plain predictor's run and `compare-sets.ts --prediction=line-ranges` (expect 0 line
  ranges differing), then `replay.ts pack --force` (every case must replay exactly), `replay.ts freeze --force
  --reason="..."`, copy the pinned `rebuild/tests/reference/<b>-<c>.json` to the main checkout, stage the tier 2 seeds
  (`browser-sets.ts ... --seed --staging=<dir>`; adopt only with 0 pairs lost and something gained), commit,
  `painter-diff.ts bundle --at=HEAD --force`, commit, full gates `--fresh` exit 0, `bun rebuild/tools/citations.ts check`
  exit 0, then push as its own command. `pack` and `freeze` wait for the gates' turn by themselves; a running gates
  run elsewhere is never disturbed.
- A change to how `engines/blink/shape.ts` cuts a shaping group, to the safe test or to the windows it measures also
  passes `rebuild/tools/cut-fonts-probe.ts` across every installed font family before it merges (lab README, "Test
  tiers"): the sets hold a few dozen font strings, and a form that passed every tier once moved lines in 196 of 318
  families.
- Timed numbers come from alternating pairs (base, change, base, change, at least 8 pairs, median and spread) in the
  pinned browser under the browser lock's exclusive stretch, never from one run each. The machine's load moves numbers
  more than most changes do; every report says the load it ran under.
- The correctness backlog is `rebuild/tests/known-tail.json` (the classes left open on purpose) plus section 8.

## 5. Facts about the engines a newcomer would not guess

- Chrome positions are exact integers of 1/65536 px, snapped up to 1/64 px; Canvas returns a float32 total, exact only
  below 256 zoomed px. The port measures wider groups in pieces at cuts that pass a safe test, and adds integers. The
  test is what costs; the pieces are cheap (`research/PERF-B1B-REWORK.md`, and the cut-grain study on branch
  `x-cut-grain`: a font's grain can make a wider total exact, but nothing proves it from Canvas alone).
- Chrome's unshipped `TextMetrics.getTextClusters()` (flag `ExtendedTextMetrics`) hands over the positions the port
  otherwise asks for prefix by prefix: calls a message 199 to about 31, from scratch 2.0 s to 0.7 s
  (`research/SPEC-TEXT-CLUSTERS.md`). An Intent to Ship for Chrome 156 was posted to blink-dev on 2026-09-07 (Igalia's
  work; WebKit has reservations, Mozilla no signal). The maintainer's note and two bug reports went out on 2026-09-20
  (section 7). When it ships, feature-detect it in the Blink port and keep the cut code easy to delete.
- Firefox shapes word by word, so a sum of words is already the engine's answer; a kept Canvas context in a Firefox that
  has just started stays on the fallback font for a family named by its localized or legacy name, and nothing a page
  can assign heals it, so Gecko's port makes its contexts per call (`research/CONTEXTS-HEAL.md`; platform ledger entries
  15 and 16). WebKit's kept contexts miss only a loaded FontFace added to an empty `document.fonts`: a page that does
  that starts a new list.
- Safari is the fast port because WebKit's own rules let it measure a word once and add words up; that is why the
  maintainer's "break words like WebKit and compensate on top" idea was tried for the other two (section 6).
- Chrome stores a JS string in 8 or 16 bits by how it was built, and shapes a one-byte string differently from a
  two-byte one (`research/BLINK-STRING-STORAGE.md`); the replay can't see storage, which is what the string storage rule
  guards.

## 6. Open studies and where their code is (all local branches, none merged)

- The word-sum idea, two rounds (`research/SPEC-WORD-SUM.md`; round 2's owner reports are in
  `.artifacts/session/reports/` on the machine that ran them and on branches `x-words2-blink` and `x-words2-gecko`;
  their attackers didn't run). Blink: cutting at every space that passes the safe test buys the mix 252 to 125 µs a
  message with a list, but differs from today's tree in 72 of 782,286 layouts (Zapfino, system-ui) where the browser
  sides with the new form: it is another recipe and needs a recording and a decision, not a free fix. Gecko: the "word
  scan" (skip a line's first word's in-word candidates where the whole word fits) takes the mix 1.14 to 0.72 s and, with
  a windows walk for long units, 0.61 s, 0 lines differing everywhere; it is exact only on the premise that no word has a
  suffix with a negative advance (0 found in 1.2 million recorded advances and 1,008 faces; not promised by the engine):
  the maintainer's yes or no.
- Lam + alef without font facts (`x-lam-alef`, owner report only): variant B, lam + alef as one glyph cluster when no fact
  speaks, fixes 602 and breaks 361 of 8,234 cases holding the pair (line counts 145 / 95); right for the platform
  fallbacks of macOS and Windows, wrong for Amiri, Noto Naskh Arabic and Noto Nastaliq Urdu; at ordinary widths (200 to
  600 px) it changes nothing. Android's fallback build measured here draws two clusters. The owner recommends B as a
  registered heuristic after an Android check; the maintainer decides; the charter question (a prior from how the
  script's ligature is built, or a choice by count) is argued in its report.
- The 256 px cut's grain (`x-cut-grain`, owner report only): section 5.
- Upstream hot spots (`x-upstream-blink`, `x-upstream-gecko`): the owners were cut off early. A buildable Chromium 152
  checkout with a built Content Shell exists at `~/github/browser-engines/chromium-152` (its README says how to rebuild;
  build under `taskpolicy -b` with `-j8`); candidate patches were lazy ink bounds in `TextMetrics::Update`, per-call bidi
  and itemization, the font setter's fast path, and why a repeated string costs a first ask in Firefox. Drafts only; the
  maintainer decides what is sent anywhere.
- Tools worth keeping on their branches: the JS profiling tools (`x-prof-blink`, `x-prof-gecko`, `x-prof-webkit`, also
  on `land-prof-*`), the fonts probes of the cut (`x-b1b-fonts`: identity and window scan probes beyond the two merged
  tools), the calibration census (`x-census`), the store study's attack probes (`x-perf-store`), the first form of the
  cut (`x-perf-b1b`, the record of what moved lines).

## 7. Decisions waiting on the maintainer

- The API shape: kept handles (prepare, fill, pieces, inspect), one idempotent call over an invisible store, truly
  stateless, or both. The resize use decides stateful against stateless; the rich content cost is one `Map` lookup a run
  (`research/IDEMPOTENT-RICH-KEYS.md`: style handles made once, a batch call halves it).
- The Gecko word scan's premise (section 6). The lam + alef default (section 6). Whether a `unitsPerEm` font fact is
  worth its reach (section 5).
- Whether to report Firefox's late family names to Mozilla (`research/CONTEXTS-HEAL.md` has the minimal reproduction).
- License notices for the ports of engine code ("later").
- The Chrome hang page found by the lab, filed by the maintainer as a restricted Chromium issue; its page and trigger
  are withheld from the branch until Chromium answers.
- `system-ui` is postponed (issue #336).

Posted on 2026-09-20 under the maintainer's accounts, at their word: a comment on whatwg/html#10677 with the numbers
and a standalone page (a gist), and Chromium issues 564022255 and 564022256 for the two `getTextClusters()` bugs.

## 8. Backlog

- Correctness: name the set `wide-group-cuts`'s 7 open failures with facts in `known-tail.json` (1 Al Nile 40px unbroken
  Arabic, 6 soft-hyphen words at 40px); Zapfino's seven-letter ligature that the safe test's windows step over with no
  gap reported; three Arabic cases with no gap on the line (Arial 28px at ratio 2, Euphemia UCAS and Waseem 16px at
  ratio 1); 63 Chrome and 53 webkit-host cases that passed on 09-17 and fail at tiny widths; Gecko `lang=""` following
  the page's language where the DOM doesn't; `lab/score.ts` and Blink rects at a zoom that isn't a power of two.
- Performance, ranked: (1) a flat, allocation-free fill for a kept plain paragraph over typed arrays in Blink and Gecko,
  judged offline by the general fill (the relayout own-code floors are about 7 µs a layout in Blink and 12 in Gecko
  against main's 0.3; WebKit's flat stretch is the model); (2) the Gecko word scan, after the maintainer's answer; (3)
  the Blink word cuts as a recipe, after the flat fill, with a recording; (4) feature-detecting `getTextClusters()`;
  (5) the recipe costs list again for the chat use (`research/RECIPE-COSTS.md` counts calls on an adversarial corpus;
  redo it in µs a message on real text with a drop / make-conditional / keep proposal per recipe); (6) the font checks
  at every prepare (24% of WebKit's wall time; need state or the caller's facts).
- Tooling: the JS profiling tools are on branches only; `js-profile.ts` still sends a profile folder to the Trash; the
  gates' unit-test limit is ten minutes a test because of load, not because any test needs it.

## 9. Working on this machine

Local helpers under `.artifacts/session/` (untracked; recreate from the lab README's rules on another machine):
- `with-browser-lock.py <job> --browser=<chrome|firefox|webkit-host|all> [--exclusive] -- <command>`: every browser
  command goes through it. Three slots a browser; `--browser=all --exclusive` takes the whole machine for a timed run
  (hold it minutes, not hours); it waits under 30% free memory. Locks recover from dead owners.
- `quiet-window.py`: while an exclusive job holds the lock, puts every other `bun` process in the background class so
  the performance cores are the timed browser's; start with `nohup python3 .artifacts/session/quiet-window.py &`.
- `watchdog.py`: kills a job over 18 GB or the largest job under 10% free memory; its log is `watchdog.jsonl`.
- `compress-rows.sh <folder>`: zstd-compresses a finished run's row files. Runs go under `.artifacts/tests/runs/<name>/`,
  bench output under `.artifacts/bench/<name>/`, probes under `.artifacts/probes/`.
- Firefox launches through `open -n -g -a` (macOS 27 blocks shell-spawned apps from their data folders); installed
  Safari only with `--allow-safari-frontmost` and only while nobody uses the Mac; webkit-host stands in for it.
- Rules learned the hard way: never `pkill` or `killall` by pattern (kill recorded pids); read exit codes from logs, not
  through pipes; never chain a push after a check with `;`; never `git stash` (worktrees share the stash); every
  long-running agent keeps a `.progress-<key>.txt` in its worktree so a restart continues instead of redoing; a network
  change can restart in-flight agents; generated files the tools made may be removed directly, never a person's files.
- The session's log is `.artifacts/session/PLAN.md` (newest entries at the top of its log; the header says where things
  are); reports of every agent are `.artifacts/session/*-reports.json`.
