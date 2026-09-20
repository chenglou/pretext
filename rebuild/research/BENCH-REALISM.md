# How representative is the bench? Device pixel ratio, real text, a slower machine (2026-09-19 and 20)

The maintainer's rule of thumb for the API decision was being read off one bench: generated chat messages on an 18-core
M-series Mac at device pixel ratio 2. One agent studied three doubts, a second checked it (and fixed four things on the
branch `x-realism`); the checker's review comes first.

## What came back, and the orchestrator's reading

- **Device pixel ratio moves Chrome a lot and the others not at all.** 10,000 messages from scratch, the tree as it was:
  3.06 s, 4.60 s and 5.37 s at ratios 1, 2 and 3, with 233, 336 and 427 Canvas calls a message. The cause is the port's
  own cut of a shaping group wider than 256 zoomed px (a Canvas width is a float32, exact only below 256 px): about 15
  questions a cut, and 5, 10 and 16 cuts a message. The engine has no such cut: the port asks more than the engine
  needs there. The optical-size check adds 10 calls and 6 contexts a message at any ratio but 1. Phones are at 2.6 to 3.
- **Real text costs what the generator's does where the script is the same.** Latin text read once costs the same.
  Language moves it: Korean, Thai, Khmer, Burmese and Hindi cost Chrome about 4 times English a message with the bench's
  three families, which is Chrome's system fallback: with a listed family that has the script it is 1.7 to 2.3 times.
- **A slower machine scales nearly linearly.** Chrome's DevTools CPU throttle at rate 4 gives 4.2 times (it slows the
  renderer's main thread only). Public single-core scores put a mid-range Android phone at about 3.7 to 5.9 times this
  Mac. So "2 s on the phone" means about 0.35 to 0.55 s here.
- **On a phone at ratio 3 with real text** the tree as it was would take Chrome about 21 to 34 s for 10,000 messages; a
  scratch merge of the four perf branches of that night took 2.02 s here, about 7.5 to 12 s there (that merge held the
  256 px cut's first rework, which was later found to move lines in ligature fonts, so read its time as close, not exact).
- **What this changes:** the 256 px cut is the largest single cost left in Chrome and it grows with the ratio, so the
  bench should state its ratio and be run at 1 and 3 too; the branch adds `--device-scale-factor`, `--chat-sets` with a
  `real` set, and a line in the report that states the ratio and flags a forced ratio that didn't take.
- Found on the way: `lab/score.ts` can't decode a Blink element rect at a zoom that isn't a power of two (72 false width
  failures at ratio 3 on messages with a padded code span); the bench's three families have no kana, Hangul or Hebrew.

## Check of the realism study (key: realism-check), 2026-09-20, 02:27 to 05:40

The study holds. Its counts reproduce exactly, and the ports' lines match the browsers' own at the other ratios. No timing was re-taken, because the machine was never quiet when I held the lock, and the full gates never got a turn. The study got four things wrong or left them out; my six commits on top of its branch fix those.

Branch `x-realism`, worktree `~/github/pretext-rebuild-wt/realism`. The owner's head was f00856d. My commits sit on top of it and the head is now 3d10120. Nothing is merged or pushed. My outputs are under `~/github/pretext-rebuild/.artifacts/bench/realism-20260919/check/`, called `<check>` below. The owner's folder one level up is `<out>`. My log is `.progress-realism-check.txt` in the worktree.

### 0. Words used

- **Owner's generator / fixed generator**: the chat message generator at f00856d, and the same after my commit d0130e2. The fix restores the mix to what it was at b2d9050.
- **Truth run**: the lab (`rebuild/lab/run.ts` and `score.ts`) lays each message out in the real browser and holds the port's line count, breaks and widths against the browser's own lines. I forced the ratio in a scratch copy of the lab driver through an environment variable (`<check>/truth/lab-run-forced-ratio.patch`). The cases are the first 1,500 messages of the `real` set and of the mix, made into lab cases with no font facts, as the bench runs them. That is 2,976 cases after removing shared ones (`<check>/truth/cases.ndjson`).
- **x en**: a language's ms a message over English's, inside one run's counting pass. It is a ratio taken on a loaded machine, not timing.
- **Scratch merge**: the owner's merge of the four perf branches. I rebuilt it from `<out>/combined/TREE.txt`. All four merges were clean, and the tree hash 2c4b3bc equals the owner's.

### 1. What I ran

| Check | Result | Where |
|---|---|---|
| `tsc` on the six projects, at f00856d and at 3d10120 | exit 0, all twelve | `<check>/gates/tsc-*.log`, `head-tsc-*.log` |
| `bun test rebuild/bench` | exit 0, 10 pass at my head | `<check>/gates/head-bun-test-bench.log` |
| `citations.ts check` | exit 0 | `<check>/gates/head-citations-check.log` |
| knip | exit 1: 4 files and 8 exports. None is under `rebuild/bench`, and the output is the same at f00856d and at my head | `<check>/gates/knip*.log` |
| `git diff b2d9050..f00856d` over `rebuild/src`, `tests`, `lab`, `probes` | empty | |
| Real Chrome counts at forced ratios 1, 2, 3 (10,000 messages × 3 sets each) | exit 0. Every count equals the owner's | `<check>/counts/chrome-r{1,2,3}.json` |
| Stand-in recount, Blink, ASCII, ratios 1 to 3 | `perMessage`, `byPurpose` and `bySite` are identical to the owner's | `<check>/standin/` |
| Scratch merge, Chrome ratio 3, a context list a pass and a list a message | exit 0. Calls, units, lines and hashes equal the owner's, and the hashes equal the as-is tree's | `<check>/combined/` |
| Truth runs: Chrome as-is at 3, 2, 1; merge at 3, 2; Firefox as-is at 3, 1 | all exit 0 (table in section 3) | `<check>/truth/` |
| Font coverage by CoreText character sets | | `<check>/coverage/coverage-bench-families.txt` |
| `languages` set under a list with a covering family, 7 languages; `real` under six families | all exit 0 | `<check>/fonts/`, `summarize.py`, `summarize-real.py` |
| Chrome counts at a forced ratio of 2.625, and at 2 and 3 on the fixed generator | exit 0 | `<check>/counts/chrome-r2.625.json`, `chrome-fixed-r{2,3}.json` |
| `run.ts --smoke --chat-sets=mix,real --device-scale-factor=3` on my head | exit 0, status ok | `<check>/bench-smoke/r3/` |

- **The full gates did not run.** The orchestrator's `quiet-window.py` paused my waiting run at 02:40. It never continued it, because other owners' exclusive timed jobs chained without a gap until I stopped at 05:33. The table above holds what I ran directly. The branch touches nothing the other gates read.
- **Timing was not taken.** `<check>/timed/timed.log` has the record.
  - Two 25-minute lock waits timed out behind other owners' chained timed jobs.
  - Two lock takes found a load of 18.5 and 45.6 and gave the lock back.
  - A last 30-minute wait saw a load of 56 to 100 throughout.
  - So stretches A, B, C and E stand as the owner measured them. `summarize.py` prints what the report says.

### 2. Reproduced

- **The forced ratio took.** `devicePixelRatio` in the page equals the forced value in every result file, the owner's and mine. The lab rows of the truth runs say 3, 2 and 1.
- **Chrome's counts.** Calls a message are 233.4 / 335.9 / 426.5 (mix), 211.3 / 310.5 / 400.4 (ASCII) and 256.7 / 356.4 / 447.6 (real). Units sent, contexts, lines, line-range hashes and the counts by kind are equal to the owner's at each ratio.
- **The cause by call site.** Rebuilt from my recount, the stand-in table for ASCII at ratios 1 / 2 / 3 reads:
  - safe test 64.8 / 144.1 / 225.5 (owner: 64.3 / 143.3 / 224.4; the grouping of one tiny site differs);
  - totals 9.8 / 20.0 / 30.7;
  - adjustment at cuts 15.5 / 33.7 / 52.2;
  - font checks 0 / 10 / 10;
  - fill 149.3 / 148.6 / 147.9;
  - sum 239.4 / 356.5 / 466.4.
  - `shape.ts`'s own header says the 256 px cut is a measuring recipe and that Blink shapes a group in one call.
- **The optical-size check.** `learnedFacts` asks it only when `scaling.zoom !== 1`, and it brings `primaryFamily` with it (font-checks.ts).
- **Gecko and WebKit.**
  - Gecko's stand-in asks are equal across ratios, and its contexts move (3.26 to 3.65), so the ratio reaches its environment.
  - In `engines/webkit` the ratio is read only for box edges, so WebKit's counts cannot move.
- **The scratch merge.** At ratio 3 it asks 170.8 / 160.7 / 178.8 calls a message. Its hashes equal the as-is tree's for the three sets.
- **Public numbers.** I fetched the sources: M5 Max 4,268, Galaxy A16 5G 975, Galaxy A15 732.

### 3. New evidence: the ports against the browsers' own lines at other ratios

FINAL-EVALUATION.md proves correctness at ratio 2 only. Each truth run has 2,976 cases and no font facts.

| Tree, browser | Ratio | Line count | Breaks | Widths |
|---|---|---|---|---|
| as it is, Chrome | 1 | 2,976 pass | 2,976 pass | 2,975 pass, 1 fail |
| as it is, Chrome | 2 | 2,976 | 2,976 | 2,975, 1 fail |
| as it is, Chrome | 3 | 2,976 | 2,976 | 2,901, 75 fail |
| scratch merge, Chrome | 2 and 3 | 2,976 | 2,976 | no case's verdict differs from the as-is tree's |
| as it is, Firefox | 3 and 1 | 2,976 | 2,976 | 2,976 |

- **Of the 75 width failures at ratio 3, 72 are the scorer's and not the port's.**
  - `lab/score.ts` `rectUnits` decodes a Blink rect's width as the float difference of the scaled edges.
  - For an element's rect, such as the padded code span, Chrome reports the width scaled by itself. At zoom 3 that is one float32 step apart. At zoom 2 the two are equal.
  - All 72 rects decode exactly when the width is scaled by itself. In 62 of them the rect's right edge is the engine's line width.
  - That is a lab limit at a ratio that isn't a power of two. I report it here and did not change the lab.
- **Real width failures:** 3 at ratio 3 (Arabic twice, off by 1/192 px, and one CJK) and 1 each at ratios 1 and 2. That one is the same CJK case under a named gap.
- **This settles part of the owner's caveat** that widths on the merge were never compared. They now are, at the verdict level against the browser, on these messages.

### 4. Findings

#### 4.1 edbf8c6 moved the mix (fixed in d0130e2)

- The commit drew the length before it picked the `app-mixed` source. It used to pick the source first.
- 407 of the mix's 10,000 messages differ from b2d9050's. The ASCII set does not move.
- The effect is small: 335.87 to 335.57 calls a message, and 35,101 to 35,076 lines at ratio 2. But every count in this project is compared to the digit, and the perf branches count on b2d9050's mix.
- The fix puts the pick back before the length. A new test holds the first 2,000 messages of the mix and of the ASCII set to b2d9050's sha256 digests. The owner's head gives another digest for the mix.
- The `real` set's `app-mixed` messages move with the fix: 356.39 to 356.45 calls.
- The owner's timed numbers were taken on the moved mix. The difference is far below their spread.

#### 4.2 The real set's fonts don't cover its scripts (9287b63, 07bf7a5, 3d10120)

The declaration is `"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif`. By CoreText's character sets, with spaces left out:

- The mix is fully covered.
- In `real`, 49.0% of the `cjk` kind's characters have no listed family. Those are kana and Hangul; PingFang TC has neither on this OS.
- In `real`, 26.1% of the `arabic` kind's characters have no listed family. Those are Hebrew.
- In `languages`, Hebrew, Hindi, Khmer, Korean, Burmese and Thai are 80 to 99.6% uncovered, and Japanese 61%.

`--family` lets a run name a list. With the second family swapped for one that has the script, calls a message and x en read:

| Language | Calls, bench list → covering list | x en, bench list → covering list |
|---|---|---|
| ko | 505 → 500 | 4.4 → 1.8 |
| hi | 256 → 256 | 3.4 → 1.7 |
| th | 261 → 261 | 3.9 → 2.3 |
| km | 226 → 226 | 3.7 → 2.1 |
| my | 313 → 284 | 4.5 → 1.8 |
| he | 314 → 275 | 2.8 → 1.8 |
| ja | 1,829 → 1,834 | 1.8 → 1.7 |

- So "about 4× English" is what Chrome's system fallback costs. With a listed family that has the script it is about 2×.
- In the `real` set under six families the `cjk` kind goes from 2.87 to 2.40 × the ASCII kind. The `arabic` kind does not move (2.49, 2.46).
- "Text read once changes nothing by itself" stands. The ASCII kind costs 4.29 µs a unit in the mix and 4.44 in `real`, inside one run at a load of 3.3.

#### 4.3 The report never said the ratio (b4f5594)

- The owner's one honest change was "give the headline at the ratio it is claimed for".
- `run.ts`'s report.md printed no ratio anywhere, and nothing checked that a forced ratio took.
- Now the report has a line: `- Device pixel ratio: 3 (forced with --device-scale-factor=3)`.
- A page whose ratio isn't the forced one is an environment violation.
- The smoke shows both.

#### 4.4 Corrections of detail

- **"Most of ratio 1's lower time is these contexts, not the cut": about half.**
  - From ratio 2 to 3 the owner measured +0.77 s for +90.6 calls, all from the cut. That is 8.5 µs a call.
  - From ratio 1 to 2 the cut adds 92.5 calls, about 0.79 s of the 1.54 s.
  - That leaves about 0.75 s for the checks. PERF-LIFETIME's independent figure of 78 µs a message for the checks' contexts agrees.
- **The named phones aren't at ratio 3.**
  - A Galaxy A55 reports 2.625: 1080 px over a viewport of 412.
  - Real Chrome at a forced 2.625, fixed generator, asks 387.8 / 364.8 / 409.7 calls (mix / ASCII / real). That is 58% of the way from ratio 2 to 3.
  - Interpolating the owner's quiet times gives about 5.45 s for `real`, not 5.76 s. The phone reading becomes about 20 to 32 s instead of 21 to 34 s. This is an interpolation, not a measurement.
  - Ratio 3 is an iPhone's, where WebKit's counts don't move.
- **The CPU throttle, from Chromium 152's source.**
  - `thread_cpu_throttler.cc` and `inspector_emulation_agent.cc:517` show it throttles only the thread that made it, which is the renderer's main thread.
  - It sends SIGUSR2 every 200 µs, and the handler busy-waits the run time times (rate − 1).
  - The bench measures on the main thread, and the owner's 4.2× at rate 4 shows no unthrottled share. So the claim that the time follows the throttle stands.
  - Correction: the "page's own arithmetic slows 4.5–6.9×" figures are single 28 ms samples a launch, two of them taken above a load of 10. Read the 20 s layout numbers instead.
  - The excess at rate 6 is the throttle's own overhead per slice.

### 5. Verdict per claim

| Claim | Verdict |
|---|---|
| Chrome's calls at ratios 1, 2, 3, and its 3.06 / 4.60 / 5.37 s | Counts stand, reproduced exactly. Times stand as the owner's measurement; I did not re-take them |
| Cause is the 256 px cut; the engine has no such cut | Stands |
| Optical-size check: 10 calls and 6 contexts at any ratio but 1 | Stands. "Most of ratio 1's lower time" reads about half |
| Gecko's and WebKit's counts don't move | Stands. The ports' lines also hold in Firefox at ratios 1 and 3 |
| Latin text read once costs the same | Stands |
| Language moves the cost: Chrome +7–9% on `real` | Stands with a correction: the rise is the `cjk` and `arabic` kinds, and part of it is font fallback |
| Korean, Thai, Khmer, Burmese and Hindi cost about 4× English | Stands with a correction: about 2× with a listed family |
| Throttle: 4.2× at rate 4, noisy at rate 6; read a phone as this Mac's time times the single-core gap | Stands; the spin samples don't support their sentence |
| Phone multipliers 3.7–5.9× | The sources check. The ratio for those phones is 2.625 |
| Scratch merge: fewer calls, same lines | Stands, reproduced. Its breaks also match Chrome's own at ratios 2 and 3. Its timings were not re-taken |
| The one honest change is the ratio flag | Stands, once the report states the ratio |
| The slow quiet webkit-host `languages` run | Not explained by me either. I had queued two quiet reruns, and they never ran |

### 6. Verdict per commit

| Commit | Verdict |
|---|---|
| edbf8c6 | Merge after a change: d0130e2 for the mix, 07bf7a5 and 3d10120 for the README's font sentences |
| 66a80c8 | Merge |
| 344d9d0, a3070be, db002df, cbf4c42 | Merge, with 9287b63 (`--family`) |
| 640f219 | Merge after a change: b4f5594 |
| a3d3159 | Merge |
| a3c2a10 | Merge |
| f00856d | Merge with 53d8238 and 07bf7a5 |

- On 344d9d0 to cbf4c42: `realism-run.ts` is a fourth copy of the browser launch code, beside `run.ts`, `lab/run.ts` and `probes/runner.ts`. That adds 544 lines for a study tool. Leaving it out is defensible, but the README cites it for the throttle and the languages.
- On a3c2a10: `report.ts` lists the sets a second time instead of using `CHAT_SETS`. It is a small thing.
- 53d8238 changes the mix at ratio 3 from 427 to 426. 07bf7a5 adds the 2.625 counts.

The changes I ask for are my six commits (`git diff f00856d..3d10120`: 6 files, +53 −13). Their core:

```ts
// cases.ts chatMessage: the source is picked before the length again
const source = kind === 'cjk' ? sources.cjk : kind === 'arabic' ? sources.arabic : kind === 'latin-smart' ? sources.latinSmart : kind === 'app-mixed' ? rng.pick(sources.app) : sources.latin
const max = lengths.min + rng.int(lengths.max - lengths.min + 1)
if (real === null || kind === 'app-mixed') text = chatSlice(rng, source, lengths.min, max)
// run.ts, at the first row
if (scaleFactor !== null && row.start.devicePixelRatio !== Number(scaleFactor)) violations.push(`--device-scale-factor=${scaleFactor} didn't take: the page's devicePixelRatio is ${row.start.devicePixelRatio}`)
// report.ts
devicePixelRatio?: { page: number | null; forced: string | null }
```

Against the engineering guide, the owner's diff is clean. It uses indexed loops and a switch over kinds, adds no defensive code, and touches nothing under `rebuild/src`. The launch-code copy is its one real cost.

### 7. Files

- `<check>/counts`, `fonts`, `coverage`, `truth`, `combined`, `standin`, `bench-smoke`, `timed`, `gates`.
- `<check>/TREES.txt` says how to rebuild my two scratch trees. I removed them.
- Summaries: `<check>/fonts/summarize.py`, `<check>/fonts/summarize-real.py`, `<check>/truth/summarize.py`.

Sources: [MacRumors on the M5 Max](https://www.macrumors.com/2026/03/05/m5-max-geekbench-benchmarks/), [GSMArena's Galaxy A16 5G charts](https://www.gsmarena.com/samsung_galaxy_a16_5g-review-2758p4.php), [YesViz on the Galaxy A55's viewport](https://yesviz.com/devices/samsung-a55/).

## How representative is the chat bench? (realism study, 2026-09-19/20)

Branch `x-realism` (worktree `~/github/pretext-rebuild-wt/realism`), from b2d9050. Nothing under `rebuild/src` changed. Every output is under `~/github/pretext-rebuild/.artifacts/bench/realism-20260919/`, called `<out>` below. `python3 <out>/timed/summarize.py` prints every timed pass, its median, its spread and the load at each launch.

### 0. Words used

- **The headline**: 10,000 chat messages laid out from scratch. For every message that is `prepare()` with its font checks and new Canvas contexts, then every line at 320 px in count mode, with nothing kept across messages (bench README, "Chat").
- **mix / latin / real**: the generator's mix, its plain-ASCII set, and my new set. `real` keeps the mix's kinds, shares and lengths over texts read once from start to end.
- **Calls a message**: `measureText` calls per message in the headline's path. **Units sent**: UTF-16 units of every string given to `measureText`, per message. **Contexts**: `getContext` calls per message.
- **Ratio**: `window.devicePixelRatio`, forced at launch. In Chrome that is `--force-device-scale-factor`, in Firefox `layout.css.devPixelsPerPx`.
- **Stand-in**: `rebuild/tools/stand-in-canvas.ts`, an offline Canvas whose widths are hashes. It counts questions by call site. Real Chrome asks about 0.87 of what it counts.
- **As it is**: the library at b2d9050. **Scratch merge**: a temporary detached worktree merging `x-perf-b1b` 5e29fb2, `x-perf-lifetime` ec0ba63, `x-perf-positions` 1104de2 and `x-perf-gecko-fill` 12b4fda onto my branch. All four merged cleanly. My page handed `prepare()` one list of contexts per pass. It was never committed to a branch, merged or pushed, and the worktree is removed. `<out>/combined/TREE.txt` and `overlay.patch` say how to make it again.
- **Quiet**: 1-minute load under 8, the exclusive browser lock, alternating launches. **Loaded contrast**: the same rounds at load 40–80 under a slot lock. Those are kept but are not timing.
- **Spin**: the bench's fixed loop of integer arithmetic, timed in the page. It is 27–28 ms on a quiet machine and 55–61 ms loaded, so a loaded background page ran at half speed.

### 1. What was run

`rebuild/bench/realism-run.ts` with `realism-page.ts` is the headline and nothing else. Every set is laid out from scratch once a pass, the sets taking turns, after an untimed warm-up of 500 messages per set. One counting pass follows: calls, units sent, contexts, lines, a hash of every line's source range, and the same by message kind or language. It launches what `run.ts` launches: background windows, the pinned copies and webkit-host.

It reproduces the bench. At ratio 2 on a quiet machine it gave:

| | lean runner | bench's quiet numbers |
|---|---|---|
| Chrome mix / ASCII | 4.60 / 3.92 s | 4.6 / 4.0 s |
| Firefox mix / ASCII | 2.70 / 0.615 s | 2.76 / 0.58 s |
| webkit-host mix / ASCII | 0.272 / 0.206 s | 0.235 / 0.195 s |

The four quiet stretches: E 00:36–00:38, B 01:54–02:01, C 02:01–02:03, A 02:03–02:08. The first three 40-minute waits found no quiet machine. The stretches ran once other owners' exclusive stretches had quieted it.

### 2. Doubt 1: the device pixel ratio

#### 2.1 Real Chrome 153 at forced ratios, as it is

Counts are over the 10,000 messages of each set (`<out>/counts/chrome-r{1,2,3}.json`, the same again in `<out>/hashes/`). Times are stretch A (`<out>/timed/A-r*-round*.json`): three launches per ratio in changing order, two passes a launch, load 4.2–6.0, spin 26.7–29.6 ms.

| ratio | calls a message, mix / ASCII / real | units sent | contexts (mix) | headline s, mix / ASCII / real (min–max, mix) |
|---|---|---|---|---|
| 1 | 233.4 / 211.3 / 256.7 | 2,992 / 3,116 / 3,016 | 4.8 | 3.06 / 2.69 / 3.44 (3.00–3.33) |
| 2 | 335.9 / 310.5 / 356.4 | 3,253 / 3,373 / 3,265 | 11.2 | 4.60 / 3.92 / 5.01 (4.46–5.17) |
| 3 | 426.5 / 400.4 / 447.6 | 3,462 / 3,585 / 3,476 | 11.2 | 5.37 / 4.67 / 5.76 (5.02–5.75) |

- A phone's ratio 3 costs Chrome 1.17× the bench's ratio 2. An office monitor's ratio 1 costs 0.66×.
- Calls grow faster than time, because the added questions are short.
- Line totals differ between ratios (35,113 lines at 1 and 35,101 at 2 and 3 on the mix). The engine really snaps widths to 1/64 of a zoomed px there.
- The stand-in is linear in the ratio: 260, 293, 323, 379, 442, 488, 550 and 607 asks a mix message at 1, 1.25, 1.5, 2, 2.625, 3, 3.5 and 4 (`<out>/standin/blink-mix-r*.json`).

#### 2.2 The cause, by call site

Stand-in, ASCII, 2,000 messages (`<out>/standin/blink-latin-r{1,2,3}.json`, `bySite` and `byPurpose`; made with `store-study.ts --part=sites --device-pixel-ratio=N`). Asks a message at ratios 1 / 2 / 3:

| What | Call site | as it is | scratch merge |
|---|---|---|---|
| The cut search's safe test | `addPieces` shape.ts:641 → `passesSafeTest` :610–611 → `windowAdjust16` :566, :568 and `pairAdjust16` :534 | 64.3 / 143.3 / 224.4 | 0 / 0 / 0 |
| Totals of a group and of every piece | `addPieces` shape.ts:624 | 9.8 / 20.0 / 30.7 | 9.8 / 20.0 / 30.5 |
| The adjustment at every cut | `measureGroups` shape.ts:678 → `positionAdjust16` | 15.6 / 33.7 / 52.3 | 15.9 / 34.4 / 53.2 |
| Font checks | font-checks.ts `learnedFacts` :257 (`primaryFamily`), :265 (`scalesLinearly`) | 0 / 10 / 10 | 0 / 10 / 10 |
| Everything the fill asks | positions, safe-to-break tests | 149.3 / 148.6 / 147.9 | 85.9 / 81.8 / 78.2 |
| Total | | 239.4 / 356.5 / 466.4 | 111.7 / 146.5 / 172.3 |

Per hypothesis:

- **The zoomed font size and the 256 px cut: yes, this is nearly all of it.**
  - Blink's DOM shapes at the zoomed size (contexts.ts:40–41; measure/font.ts; specs/blink-lines.md §2.3). The port therefore measures at 16, 32 and 48 px.
  - A Canvas total is a float32, so it is an exact 16.16 value only below 2^24 units, which is 256 px (`EXACT16`, shape.ts:42–43; blink-canvas §1.5).
  - The port halves a wider group at an offset its safe test accepts (shape.ts:614–659).
  - 256 zoomed px is about 45, 22 and 15 characters at ratios 1, 2 and 3. A 116-unit message has about 5, 10 and 16 pieces.
  - Each cut costs about 15 questions: several candidates, each with a wide window and a pair window.
- **Is that the engine? No.** Blink shapes a whole group in one HarfBuzz call per script segment and font, at any width (inline_node.cc:1636–1717, harfbuzz_shaper.cc:880–1101; shape.ts header). Where Blink itself depends on 256 zoomed px (float sums of runs, shape_result_view.cc:215–273; carets, shape_result.cc:696–733), the port reports gaps and asks nothing. The cut is a measuring recipe, and its search asks more than it needs.
- **The optical-size check: yes, as a step and not a slope.**
  - It asks only at a zoom other than 1, and it brings `primaryFamily` with it. That is 10 calls and about 6 contexts a message at every ratio but 1 (4.8 against 11.2 contexts).
  - The engine's behaviour really depends on the ratio here. The DOM sets opsz from the specified size and shapes at the zoomed size (font_platform_data_mac.mm:170–178, harfbuzz_face.cc:639–648; font-checks.ts:32–39).
  - The answer belongs to a declaration and a zoom, not to a message. It is asked per message only because nothing outlives a paragraph.
  - Most of ratio 1's lower time is these contexts, not the cut.
- **Positions at zoomed precision: no.** The fill's questions don't move (149.3 / 148.6 / 147.9). The zoom changes the available width's LayoutUnit (`lengthLU`, content.ts:84–87) and so a few breaks, but not the number of questions.
- **A float32 exactness condition:** that is the cut itself, named above.

Fixes and how far each goes:

- **Removing the search (`x-perf-b1b`)** takes 64 / 143 / 224 asks away. The ratio's growth from 1 to 3 falls from +227 to +61 asks (stand-in, ASCII).
- **Two classes still grow with the pieces.**
  - The totals. The halving measures every inner node, 2p−1 strings and the longest ones. Planning the pieces from the first total would measure about p+1.
  - The adjustment at each cut. A cut before a space takes the wide window, which is several calls. A cut after the space would take a pair window of three short, repeating strings.
- **The font checks' 10 calls remain in the merge** at a ratio other than 1. The lifetime branch asks again on kept contexts. Their contexts are made once a page.

#### 2.3 Gecko and WebKit

- Stand-in asks and units are identical at ratios 1, 2 and 3 for all three sets: Gecko 80.6 / 119.4 / 111.2 asks (ASCII / mix / real), WebKit 31.0 / 40.0 / 38.4.
- Real Firefox at forced ratios 1 and 3 over 2,000 messages gave the same calls and units sent: 121.0 / 82.1 / 113.5 calls (`<out>/counts/firefox-r{1,3}.json`).
- In Gecko a non-Latin message makes about one more context at a ratio other than 1 (cjk 3.0 → 4.0, emoji 3.9 → 5.9). That is the emoji recipe's device-size context (prepare.ts:1067; gfxMacFont.cpp:437–463). It is real engine behaviour, and it is a context, not a question.
- webkit-host has the screen's ratio, so it could not be forced.

#### 2.4 The scratch merge: fewer calls, same lines, and its quiet timing

Real browsers, 10,000 messages per set.

Calls a message in Chrome (mix / ASCII / real):

| ratio | as it is | scratch merge |
|---|---|---|
| 1 | 233 / 211 / 257 | 112 / 104 / 122 |
| 2 | 336 / 311 / 356 | 146 / 137 / 154 |
| 3 | 427 / 400 / 448 | 171 / 161 / 179 |

Units sent fall from about 3,250 to 1,270.

The hash of every line's source range is equal between the two trees for all three sets at each of the three ratios in Chrome, and in Firefox and webkit-host at ratio 2 (`<out>/hashes/*.json` against `<out>/combined/counts/*.json`). That is 30,000 messages a browser and ratio. Breaks only; widths were not compared.

Stretch E, quiet (load 3.6–4.8, spin 27–28 ms; `<out>/timed/E-*.json`). Chrome is medians of 6 passes. Firefox and webkit-host are medians of 3 passes in one launch each, with no alternation against the as-is tree.

| | mix | ASCII | real |
|---|---|---|---|
| Chrome, ratio 1 | 1.46 s | 1.33 s | 1.67 s |
| Chrome, ratio 2 | 1.67 s | 1.52 s | 1.86 s |
| Chrome, ratio 3 | 1.82 s | 1.64 s | 2.02 s |
| Firefox, ratio 2 | 1.13 s | 0.58 s | 1.09 s |
| webkit-host, ratio 2 | 0.139 s | 0.105 s | 0.146 s |

Chrome's spread is within ±2%. On the merge, ratio 3 costs 1.09× ratio 2 and ratio 1 costs 0.88×.

This is a scratch tree, not a reviewed one. Its merges were clean, `tsc -p rebuild/bench` exits 0 and the lines are equal, but no gates ran on it.

### 3. Doubt 2: real text

#### 3.1 The sets

- **`real`** (`cases.ts` `realTexts`, `buildChat('real', n)`) has the mix's kinds, shares and length classes.
  - The Latin kinds read The Great Gatsby and the masonry demo's 1,904 short posts in turn. That is about 510,000 units, so 10,000 messages read them about twice, with other slices the second time.
  - `cjk` reads Chinese, Japanese and Korean in turn. `arabic` reads al-Bukhala, Hebrew and Urdu in turn.
  - `app-mixed` has no long text and stays the mix's.
  - Its first 1,000 messages have a mean of 117 units and a median of 60. The mix has 111 and 60.
- **`languages`** (`buildLanguages`) is the corpora's eleven languages in turn with the chat lengths, filed by language.

#### 3.2 Counts and quiet times, as it is

Ratio 2; `<out>/hashes/*.json`. Times are stretch A for Chrome and stretch C for the others (two launches each, sets alternating inside the page, load 4.3–4.7).

| | calls a message, mix / ASCII / real | units sent | headline s |
|---|---|---|---|
| Chrome | 335.9 / 310.5 / 356.4 | 3,253 / 3,373 / 3,265 | 4.60 / 3.92 / 5.01 |
| Firefox | 119.7 / 84.9 / 113.5 | 2,021 / 252 / 809 | 2.70 / 0.615 / 1.54 |
| webkit-host | 40.2 / 31.7 / 38.7 | 141 / 134 / 141 | 0.272 / 0.206 / 0.258 |

- **Text read once changes nothing by itself.** The plain Latin kind has the same counts in both sets: Chrome 310.9 against 300.1, Firefox 85.0 against 87.2, WebKit 31.8 against 30.6. Nothing is kept across messages, so overlapping slices buy the headline nothing.
- **The language does.**
  - Chrome's cjk kind: 636 calls with Chinese alone, 936 with Chinese, Japanese and Korean.
  - Chrome's arabic kind: 167 against 289.
  - Firefox's cjk kind: 23,118 units sent a message with Chinese alone, 7,086 with the three.
  - Firefox's mix costs 2.70 s because 7% of it is Chinese. On `real` it is 1.54 s. On the scratch merge, with the gecko-fill branch, it is 1.13 against 1.09 s.
- **The picture:** Chrome stays worst in every reading.
  - `real` costs Chrome 1.09× the mix at ratio 2 and 1.07× at ratio 3.
  - It costs Firefox 0.57×.
  - It costs WebKit 0.95×.

#### 3.3 By language

Quiet, stretch C, 200 messages a language (`<out>/timed/C-languages-*.json`). Milliseconds a message are taken in the counting pass with its wrappers on, so read them only against each other.

| | en | ar | he | ur | hi | zh | ja | ko | th | km | my |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chrome calls | 294 | 228 | 314 | 299 | 256 | 611 | 1,829 | 505 | 261 | 226 | 313 |
| Chrome × en (0.43 ms) | 1.0 | 2.0 | 2.8 | 2.4 | 3.5 | 1.3 | 1.9 | 4.4 | 3.9 | 3.8 | 4.5 |
| Firefox calls | 88 | 77 | 77 | 73 | 57 | 427 | 300 | 293 | 164 | 40 | 144 |
| Firefox × en (0.084 ms) | 1.0 | 1.9 | 1.8 | 1.9 | 1.3 | 30 | 3.2 | 5.9 | 6.3 | 3.1 | 6.1 |

- A Korean, Thai, Khmer, Burmese or Hindi audience costs Chrome about four times the English message. The generator holds none of these languages.
- Chinese sends 23,704 units a message in Firefox as it is.
- webkit-host's quiet languages run is an outlier I can't explain. Its passes took 1.03, 1.94 and 1.93 s for 2,200 messages. Three loaded runs of the same set took 0.17–0.42 s and showed no growth (`<out>/languages/webkit-host*.json`). Its loaded ratios to English: Khmer 4.2, Burmese 4.5, Thai 2.7, the rest 1.1–1.9.

### 4. Doubt 3: a slower machine

Stretch B, Chrome as it is at ratio 2, `Emulation.setCPUThrottlingRate` over a session that stays attached. Three rounds in changing order, one pass a launch (`<out>/timed/B-rate*-round*.json`). Load was 3.8–7.7, but two launches of round 2 started at 10.5 and 10.1, above the rule's 8.

| rate | mix s (passes) | ASCII s | spin ms |
|---|---|---|---|
| 1 | 4.80 (4.80, 7.49, 4.78) | 4.08 | 28 |
| 4 | 20.3 (19.9–20.7) = 4.2× | 16.9 = 4.1× | 127–195 |
| 6 | 36.6 (29.6–40.8) = 6.2–8.5× | 35.5 (24.0–39.3) | 175–206 |

- The time follows the throttle's real factor. The page's own arithmetic slows by 4.5–6.9× at rate 4 and 6.2–7.3× at rate 6. The layout slows by about as much: near linear at 4, noisy and somewhat over at 6.
- The throttle stops the main thread for a share of every interval. It models no smaller cache or slower memory.
- So read a phone as this Mac's time times the single-core gap, and expect worse rather than better.

Rough multipliers from public Geekbench 6 single-core scores. They are a CPU benchmark, not a browser one, with no thermals and no Android font stack:

| Device | Score | Gap to this Mac |
|---|---|---|
| Apple M5 Max (this Mac) | about 4,300 | 1× |
| Galaxy A55 (Exynos 1480) | about 1,160 | 3.7× |
| Galaxy A16 5G (Exynos 1330) | 975 | 4.4× |
| Galaxy A15 (Helio G99) | 732 | 5.9× |
| iPhone 16e (A18) | about 3,300 | 1.3× |

### 5. Conclusion: what the 2 s rule reads as on a phone at ratio 3 with real text

Each line is the quiet number on this Mac, then ×3.7 to ×5.9 for a mid-range Android phone or ×1.3 for an iPhone.

- **Chrome as it is:** 5.76 s here, about 21–34 s on the phone.
- **Chrome on the scratch merge:** 2.02 s here, about 7.5–12 s on the phone. On this Mac the perf work so far puts Chrome at the bar: 1.67 s on the mix at ratio 2, and 1.82 s (mix) to 2.02 s (real) at ratio 3.
- **Firefox**, where the ratio doesn't matter: 1.54 s as it is and 1.09 s on the merge, about 4–9 s on an Android phone.
- **WebKit**, every browser on an iPhone: 0.26 s as it is and 0.15 s on the merge, about 0.2–0.35 s on an iPhone. That is under any reading of the rule. It was measured at ratio 2 with macOS fonts only.
- **Main's own cold batch** is 0.34 s in Chrome here (`<out>/../perf-lifetime-20260919/night-1`), about 1.3–2.0 s on that phone. "About 2 s on the phone" is main's cost today.
- **What the rule means.** The rule as written, 2 s on this Mac, is 7–12 s on a mid-range Android phone. A rule meant for the phone reads as about 0.35–0.55 s here at ratio 3.
- **For a Korean, Thai, Hindi, Khmer or Burmese audience,** multiply Chrome again by up to 4.

#### What I couldn't measure

- A real phone, Android's fonts, or iOS. The ports are pinned to this Mac's browsers.
- webkit-host at another ratio.
- Widths on the scratch merge (breaks only).
- The bench's own full rows at ratio 3. I ran only a 200-message smoke there: 389 (mix) and 391 (ASCII) calls a message (`<out>/bench-smoke-r3`).
- Per-language times without wrappers.
- Why one quiet webkit-host languages run was slow.

#### The one change that makes the headline honest

Give the headline at the ratio of the device it is claimed for, and name the device. `run.ts --device-scale-factor=3` does that now, and the README says why. The real-text set matters less than expected. It is there as `--chat-sets=mix,latin,real`, and the `languages` set shows what an audience's script costs.

### 6. Commits on `x-realism` (none merged or pushed)

- edbf8c6: the `real` chat set (cases.ts, protocol.ts, a test, README).
- 66a80c8: `store-study.ts --device-pixel-ratio`.
- 344d9d0, a3070be, db002df, cbf4c42: `realism-run.ts` and `realism-page.ts` (forced ratio, CPU throttle, warm-up, `--counts=no`, the languages set, line-range hashes).
- 640f219: `run.ts --device-scale-factor` for Chrome and Firefox, and the README's ratio paragraph.
- a3d3159: knip entries for the realism runner and its page.
- a3c2a10: `run.ts --chat-sets` (default `mix,latin`; `real` adds a row, headline and phases).
- f00856d: the README's quiet ratio timings.

`run.ts` is another owner's file. I touched it in three small places, and it merged cleanly with `x-perf-lifetime` in the scratch merge.

### 7. Checks

- `bun rebuild/tests/gates.ts --quick` on a3d3159: exit 0, every gate fine for a pure refactoring (`<out>/gates/gates-quick-a3d3159.log`).
- After it only `rebuild/bench` changed. `tsc -p rebuild/bench` exits 0 and `bun test rebuild/bench` exits 0 (9 pass).
- A last quick gates run on a3c2a10 (`gates-quick-a3c2a10-final.log`):
  - tsc passed on all six projects.
  - Tier 1 exits 0 in all three browsers, both configurations.
  - The plain checks had exited 0 for Chrome and webkit-host. Firefox's plain rows and all the pure rows had not reported when I returned, and the run was cut off there.
  - The unit tests exit 1: a hook in `rebuild/tests/gates.test.ts` timed out at 5,117 ms while the load was about 70. The file alone reruns with exit 0, 20 pass (`gates-test-rerun.log`). I didn't touch that file.
- Browser smokes:
  - `<out>/smoke/` (the lean runner and the throttle).
  - `<out>/bench-smoke-r3/` (`run.ts` at forced ratio 3, status ok).
  - `<out>/bench-smoke-real/` (`--chat-sets=real` in webkit-host, status ok).
- Every browser job exited 0. The one exception is the timed waits that gave the lock back on a loaded machine (exit 4) or timed out waiting for the lock (exit 75).

### 8. Files

- Tools:
  - `~/github/pretext-rebuild-wt/realism/rebuild/bench/realism-run.ts`, `realism-page.ts`, `cases.ts`, `run.ts`, `README.md` (the "Realism" section, the "Chat" ratio paragraph and the real set).
  - `~/github/pretext-rebuild-wt/realism/rebuild/tools/store-study.ts`.
- `<out>/standin/`: stand-in counts, 3 engines × 3 sets × 3 ratios, and the fractional ratios.
- `<out>/counts/`, `<out>/hashes/`: real-browser counts, as it is.
- `<out>/combined/`: the scratch merge's stand-in and browser counts, `TREE.txt` and `overlay.patch`.
- `<out>/languages/`: counts by language.
- `<out>/timed/`: stretches A, B, C and E, `timed.log` with the load before every launch, and `summarize.py`.
- `<out>/loaded/`: loaded contrasts, not timing. Ratio 1 / 2 / 3 at half speed gave 7.30 / 9.42 / 11.35 s on the mix, the same proportions as the quiet run.
- `<out>/gates/`: the gates logs.
- Progress log: `~/github/pretext-rebuild-wt/realism/.progress-realism.txt`.

Sources for the multipliers: [MacRumors on the M5 Max](https://www.macrumors.com/2026/03/05/m5-max-geekbench-benchmarks/), [GSMArena's Galaxy A16 5G review charts](https://www.gsmarena.com/samsung_galaxy_a16_5g-review-2758p4.php), [Sammy Fans on the Exynos 1480](https://www.sammyfans.com/2023/12/15/samsung-galaxy-a55s-exynos-1480-benchmarks-on-geekbench-6/), [Smartprix on the iPhone 16e](https://www.smartprix.com/bytes/iphone-16e-visits-geekbench-6-listing-reveals-cpu-and-gpu-performance-scores/).
