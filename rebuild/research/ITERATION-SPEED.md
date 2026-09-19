# Faster iteration on the offline gates (2026-09-19)

The maintainer asked for low-hanging fruit that makes iteration faster. One agent measured every offline gate, built one command that runs them side by side and reads every exit code from the child process (`bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick]`), and made speed-ups it could prove byte-identical on the whole corpus. An independent verifier reran the comparisons, planted four kinds of breakage to see the command name each, and said: merge all 11 commits as they are. The verifier's report comes first.

## The verifier: Independent check of `x-iteration-speed` before merging

Checked: `<worktrees>/speed` at bb75e33, 11 commits on 1e464d5. I only read that worktree. Everything ran in a scratch clone, which is removed. Evidence is in `<scratch>/speed-verify-out` (91 MB).

### Verdict

**Merge as is, all 11 commits, into the rebuild head as it is now.**

- The head moved to 98ab2f1 while I worked. It was 2228712 when I started.
- A merge of the branch into 98ab2f1 is clean, tried in scratch.
- On that merged tree the full `bun rebuild/tests/gates.ts` exits 0 with 39 gates fine. It used 8 cores and took 33.5 min at load 50 to 105, for 10,352 CPU-s and a 6.3 GB peak.
- Do not run the branch alone. It is older than the shared Chrome references and the frozen painter bundle, as its author said. Alone, tier 1 exits 1 and the painter differential exits 2. I saw both.

| Commit | Merge? | Reason |
|---|---|---|
| 4b7d2c8 `gates.ts` | yes | Exit codes are read from the child. Four plants and a planted tool failure were each named (section 3). |
| 0202bc1 groups of shards in tier 1, plain, pure | yes | Same reports on the whole corpus with two libraries, and on a planted tree. Every emitted shard has the frozen hash. −33%, −33%, −30% CPU. |
| 68b6121 painter differential in groups | yes | Same reports on the whole corpus and on the planted tree. −40% CPU. |
| ddea3bd twin scan in child processes | yes | Same report over all 67,072 case lines, twice. Wall 94 → 40 s on four files, for +17% CPU. |
| aba0b42 stand-in Canvas font memo | yes | The memoized object is never written to. The six sweep reports are the same. −27% and −26% CPU. |
| 3fff15d settings key kept | yes | The key is dropped in every setter, and nothing else writes `assigned`. Small gain: I measured −6%, the claim is −10%. |
| 6206d93 shared cores (`cores.ts`) | yes | The full form through the socket gives the same reports as each gate alone. A check that dies gives its cores back. |
| f0cf305, 7bc72ec, 2660986 (`gates.ts` refinements) | yes | Skipped cases count as 3. `tsc`'s two error exits (2 fresh, 1 kept) both showed and both counted as 1. |
| bb75e33 documents | yes | They match the code. Its numbers are the author's, under the author's load. My CPU numbers agree except the −10% above. |

### 1. Byte identity on the whole corpus, both sides run by me

The corpus is 389,646 cases in six references: Chrome 67,065, Firefox 63,771 and webkit-host 63,987, each in two configurations. Two fields name who ran and are set aside: `library.commit` in tier 1's check report and `tree` in the twin scan's report, which is the tree's folder path.

| Pair | How | Reports | Exit codes |
|---|---|---|---|
| Head 2228712 with its own tools, against 2228712 with the branch merged | old side each gate alone, 16 jobs; new side through `gates.ts`, full form, 16 shared cores | 38 of 38 the same (31 the same bytes, 6 but for `library.commit`, 1 but for `tree`) | all 0 on both sides |
| 1e464d5 against the branch bb75e33 | each gate alone, 8 jobs, both against Chrome's reference of 25fbdd6 | 32 of 32 the same (25, 6, 1) | the same on both: tier 1 exits 1, plain 0, pure 0, citations 0, painter 2, sweep 0, twin 0 |
| The same one-line Gecko change planted under the old and the new tools (head 2228712), Firefox, both configurations | each gate alone, 6 jobs | 11 of 11 the same (9 the same bytes, 2 but for `library.commit`) | the same: 1, 0, 0, painter 3, sweep 0 |
| Chrome no-facts, sets `smoke,ws,twins`, 3 jobs | tier 1 alone | the same but for `library.commit` | 3 on both |

- The second pair is the strong one. Both trees hold a library older than Chrome's reference, so the reports are not empty.
  - Chrome's no-facts check report is 15 MB: 919 predictions changed, 60,904 repeats only, 3,726 other questions, 257 new questions.
  - Plain and pure skip 257 cases.
  - The old and the new tools give the same bytes on it.
- The planted pair: 8,380 and 8,394 predictions changed. The tier 1 report is 3.6 MB and the painter report 1.5 MB.
- The pairs ran with 3, 6, 8 and 16 jobs, alone and through the shared cores. The reports never depended on that.

**Emitted shards.**
- I ran the hidden `work --group --emit-to=<scratch>` over every shard of the six references, in the tree's own groups.
- 1,169 of 1,169 emitted shards have the sha256 that the frozen reference's manifest names. Per reference: 382, 400, 89, 89, 111 and 98.
- So the path `freeze` and `pack` share writes the same bytes as before.
- I ran nothing with `--record`, `--seed`, freeze, pack, adopt or bundle, and no browser.

**The shared references moved during my runs.**
- Chrome's two references were frozen again at 09:25 (25fbdd6, inputs unchanged).
- Each pair above ran against one reference. I checked `against.commit` in the reports.
- The first pair ran wholly before 09:25. The second pair and the emit check ran after.

### 2. Does any gate check less?

No, not by default.
- The full form runs the same commands as before.
- Unit tests: the gate runs a process per file and reports 60 files, 833 pass. `bun test rebuild` on the same tree ran 833 tests across 60 files. No test file under `rebuild` has another name pattern, and none sits in a hidden folder.
- The one reduction is `--quick` with a single engine, which leaves out the other two engines' unit test folders.
  - It is explicit and off by default.
  - It is documented in `gates.ts`'s header and visible in the row's name ("unit tests without blink and webkit": 50 files).
  - The lab README's paragraph doesn't mention it.
- There is no sweep sample flag. The sweep runs whole in the full form and not at all in `--quick`.
- The gate runs the sweep in both configurations. The README's check table names `--config=no-facts` only, so the gate checks more there.

### 3. Exit codes and stale state

Plants, one at a time, in a scratch tree of head 2228712 with the branch merged. `gates.ts --quick --engine=gecko --cores=8`, except (d), which needs the full form.

| Plant | `gates.ts` exit | Named rows |
|---|---|---|
| none (builds the incremental state) | 0 | none |
| (a) `width - trimmableAdvance > aWidth` became `> aWidth - 60` in `engines/gecko/lines.ts` | 1 | tier 1 firefox no-facts and facts, exit 1, 8,380 and 8,394 predictions changed; the unit tests too (8 fail) |
| (b) `InWordAdvance.au: number` became `string` in `engines/gecko/types.ts`, so the errors show in other files | 1 | `tsc rebuild`, `rebuild/lab`, `rebuild/tests`, `rebuild/bench`, 11 errors each: exit 2 on the first run, exit 1 (kept errors) on the second, both counted as 1 |
| (c) a failing test added to `engines/gecko/props.test.ts` | 1 | unit tests: 627 pass, 1 fail |
| (d) the citation `(nsLineLayout.cpp:798)` removed from a comment | 1 | citations: 1 lost |
| (e) `check()` in `replay.ts` throws, with a stale report on disk that says 8,380 predictions changed | 1 | tier 1 rows: exit 2, "no report", counts as 2. The stale counts did not show. My plant was also a type error, which set the exit to 1. |
| all reverted | 0 | none |

- Plain `bunx tsc --noEmit -p` on plant (b) gave the same four projects and the same 11 errors.
  - `rebuild/probes` and `rebuild/lab/cases` stay at 0 errors there too. Their programs don't include that file: they hold 4 and 2 files per engine.
  - After the revert all six rows were clean again.
- A corrupt state file: `tsc` checked in full, reported the 11 errors and wrote the state again.
- A child killed by a signal resolves to 128 plus the signal number in bun 1.4.0. `gates.ts` would read that as a tool failure, not as 0.
- The other caches are in-process and sound:
  - the settings key, dropped in every setter, which are the only writers of `assigned`;
  - the font memo, keyed by the whole shorthand, never written to by its callers.

### 4. The "fine for a pure refactoring" table against the lab README and plan §7

It matches.
- Tier 1:
  - exit 0 is fine;
  - exit 1 counts as 1;
  - exit 4 counts as 4;
  - exit 3 with a dropped question counts as 3 (§7: only a step that names what it drops accepts it);
  - exit 3 with repeats only, or with Chrome's string storage rule alone, is fine (§7: repeats are provable offline; X3's gate reads "exit 0, or exit 3 with repeats only").
- Function set: exit 5 counts as 5, exit 1 as 1. Exit 0 with skipped cases counts as 3, which is stricter than the tool.
- Painter differential: exit 3 counts as 3, exit 1 as 1.
- Citations: exit 1 counts as 1.
- Twin scan: more than 0 twins counts as 1.
- The worst-first order 1, 2, 5, 4, 3 extends the README's 1, 4, 3, 0.
- These are the same exit codes the tools' own headers document.

One caveat. `gates.ts` exit 0 does not mean tier 2 has nothing to run.
- On tier 1's exit 3, the README sends the listed cases to tier 2 by rule.
- `gates.ts` says so only in the row's text. The closing line reads "every gate is fine".
- A reader of the exit code alone would skip tier 2.
- Suggested: the closing line names the number of cases for tier 2 when it isn't 0.

### 5. Timing, back to back, three rounds, CPU seconds

A is the commit before and B the commit itself, cherry-picked in order onto head 2228712, so Chrome runs clean. The tip of that chain is the same tree as the merge. A and B ran in turn, 07:40 to 08:11.

Load: other owners' jobs were at about 1 when I started. The load average at the start of each run was 2 to 55, mostly from my own previous run. Other owners' jobs joined now and then. After 08:20 the machine sat at load 50 to 150.

| Change | A | B | Mean | Claimed |
|---|---|---|---|---|
| Groups, tier 1, three no-facts references | 377, 421, 427 | 266, 275, 281 | 408 → 274, −33% | −34% |
| Groups, plain | 594, 712, 688 | 456, 447, 442 | 665 → 448, −33% (rounds: −23%, −37%, −36%) | −34% |
| Groups, pure | 880, 878, 906 | 604, 605, 649 | 888 → 619, −30% | −29% |
| Painter, Firefox and webkit-host no-facts | 143, 137, 138 | 83, 82, 84 | 139 → 83, −40% | −37% |
| Twin scan, four suite-sample files | 95, 90, 92 | 99, 96, 128 | +17% CPU (+4%, +6%, +39%); wall 94 → 40 s | +16% CPU |
| Sweep, Chrome no-facts, four sets | 192, 223, 247 | 141, 162, 178 | −27% | −26% |
| Sweep, webkit-host no-facts | 303, 314, 316 | 229, 234, 230 | −26% | −25% |
| Settings key, tier 1 | 369, 367, 370 | 347, 348, 344 | −6% | −10% |

All claims hold except the settings key, which is smaller than claimed. Every exit was 0.

CPU time drifts with the machine. The same tier 1 work cost 274 s at 07:42 and 369 s at 08:08. The ratios stayed stable within each pair.

Whole corpus, not back to back, under other owners' load:

| Tree | Tier 1 | Plain | Pure | Sweep | Total CPU |
|---|---|---|---|---|---|
| 1e464d5, 8 jobs | 1,369 | 1,551 | 2,166 | 8,966 | 14,812 s |
| The branch, 8 jobs | 808 | 1,013 | 1,481 | 6,302 | 10,431 s |
| Head 2228712, its own tools, 16 jobs | | | | | 15,281 s |
| Head 2228712 with the branch merged, `gates.ts` full form | | | | | 10,775 s |

`gates.ts` forms, head 2228712 with the branch merged, 16 cores:

| Form | Round 1 (load 19 to 33) | Rounds 2 and 3 (load 34 to 80) | Claimed |
|---|---|---|---|
| `--quick --engine=webkit` | 24.7 s, 404 CPU-s | 46 to 68 s, 445 to 469 CPU-s | 27 s, 423 CPU-s |
| `--quick --engine=gecko` | 44.4 s, 607 CPU-s, 13.6 GB peak | 80 to 107 s | 49 s, 630 CPU-s |
| `--quick --engine=blink` | 134 s, 1,940 CPU-s | 233 to 340 s | 112 s, 1,789 CPU-s |
| Full, all engines | one run at load 20 to 150: 24.7 min, 10,775 CPU-s, 10.1 GB peak | | 13.0 min, 10,340 CPU-s |

- The CPU matches the claims.
- I could not check the full form's 13 minutes on a quiet machine. The CPU gives a floor of 11.2 min on 16 cores, so the claim is plausible.
- Blink's `--quick` is not under a minute, as the author said.
- I stopped a second full run after 42 s to leave the machine to others. Its row shows exit −15.

### 6. Small findings, none blocking

1. **Stale socket file.** A killed `gates.ts` leaves `pretext-gates-<pid>.sock` in the temp folder. `Bun.listen` fails on an existing path (tested). A later run that gets the same pid would fail at start. It is loud and rare. I removed the one I left.
2. **Relative case paths in the twin scan.** `twin-scan.ts` hands each child its `--cases` path as given, with the repository as the working folder. A relative path from another folder fails in the parallel form, loudly. It worked in the one-process form. `gates.ts` passes absolute paths.
3. **README gap.** The lab README's paragraph doesn't say that `--quick` with one engine leaves out the other engines' unit tests.
4. **Header wording.** "Every project's program holds files of all three engines (through src/index.ts)" is loose. `rebuild/probes` and `rebuild/lab/cases` hold 4 and 2 files per engine, not through `index.ts`. An engine edit shows in four `tsc` rows, as it does with plain `tsc`.
5. **Log overwrite.** Logs are kept per gate name, so the next run overwrites a failed gate's log. The author noted this.
6. **Absolute import in probes, not from this branch.** `rebuild/probes/gecko-rtl-rects.ts:6` imports `rebuild/probes/types.ts` by absolute path, since a4f23b8. In every worktree the `rebuild/probes` `tsc` project therefore checks 17 files of the main checkout instead of the worktree's.

### Housekeeping

- Removed: the scratch clone, its worktrees and the emitted shards under scratch.
- Moved to the Trash: the painter report folders my trees made, `.artifacts/tests/painter-diff/{sv-a,sv-b,sv-head,sv-merged,sv-merged2,sv-plant}`.
- The speed worktree is untouched: clean, bb75e33.

### What the verifier couldn't settle

- The rebuild head moved to 98ab2f1 and Chrome's two shared references were frozen again at 09:25 (25fbdd6) during my runs. Each comparison pair ran against one reference (checked through `against.commit`). The branch still merges cleanly into 98ab2f1 and the full gates.ts exits 0 there. Merge into that head; don't run the branch alone: tier 1 exits 1 and the painter differential exits 2 there, as its author said.
- gates.ts exit 0 does not mean tier 2 has nothing to run. Tier 1's exit 3 with repeats only, or with Chrome's string storage rule alone, counts as fine, which matches plan §7 and X3's gate. But only the row's text says the listed cases go to tier 2; the closing line says every gate is fine. Suggested: the closing line names the number of cases for tier 2.
- The settings key commit (3fff15d) measured -6% CPU in my three back-to-back rounds, not the claimed -10%. It is sound and still worth merging. The lab README quotes the author's 440 to 398.
- I could not confirm the full form's 13 minutes on a quiet machine. Other owners' jobs held the load at 50 to 150 from 08:20 on. My full run took 24.7 min at 16 cores and 33.5 min at 8 cores. Its CPU (10,775 s and 10,352 s) matches the claimed 10,340 s, which gives a floor of about 11 minutes on 16 cores. Quick forms at load 19 to 33: 25 s, 44 s and 134 s, against the claimed 27, 49 and 112 s.
- A killed gates.ts leaves pretext-gates-<pid>.sock in the temp folder, and Bun.listen fails on an existing path (tested). A later run that gets the same pid would fail at start. It is loud and rare. I removed the one I left.
- twin-scan.ts hands each child its --cases path as given, with the repository as the working folder. A relative path from another folder fails in the parallel form, loudly; it worked in the one-process form. gates.ts passes absolute paths, so the gate is fine.
- The lab README's paragraph doesn't say that --quick with one engine leaves out the other two engines' unit test folders; gates.ts's header and the row's name do. The header's "every project's program holds files of all three engines (through src/index.ts)" is loose: rebuild/probes and rebuild/lab/cases hold 4 and 2 files per engine, so an engine edit shows in four tsc rows, as it does with plain tsc.
- Not from this branch (since a4f23b8): rebuild/probes/gecko-rtl-rects.ts line 6 imports rebuild/probes/types.ts by absolute path. In every worktree the rebuild/probes tsc project therefore checks 17 files of the main checkout instead of the worktree's.
- Housekeeping: I stopped my own chain script's parent once, to reorder its later steps, and stopped one repeat full gates run after 42 s to leave the machine to others. Its timing row shows exit -15. Neither affects a result above. I ran two heavy jobs at once for a while, each held to 8 jobs; memory stayed at 70 to 80% free.

## The work: Faster iteration on the offline gates (branch `x-iteration-speed`)

Worktree: `<worktrees>/speed`. Evidence, tools and logs: `.artifacts/session/iteration-speed-20260919/`.

Terms used below:
- A *shard* is one input file of a frozen reference, about 120,000 recorded Canvas calls. The six references hold 1,372 of them.
- A *group* is the set of shards one child process replays.
- *Load* is the 1-minute load average on the 18-core machine. It ranged from 4 to 77 during the night, because other agents worked beside me. Wall times are therefore weak evidence; CPU time measured back to back is the strong evidence.

### 1. Where the time went (base 1e464d5, each gate alone, one after another)

| Gate | Wall | CPU (user+sys) | Peak memory, whole process tree | Load |
|---|---|---|---|---|
| `tsc`, six projects | 83 s | 41 s | 0.4 GB | 49–55 |
| `bun test rebuild` | 46 s | 27 s | 0.8 GB | 48 |
| tier 1, six references | 156 s | 1,439 s | 9.1 GB | 45 |
| plain | 181 s | 1,770 s | 8.8 GB | 73 |
| pure | 267 s | 2,455 s | 9.7 GB | 54 |
| citations | 0.6 s | 1.5 s | 0.1 GB | 36 |
| painter differential | 399 s | 2,598 s | 9.3 GB | 36 |
| twin scan (Chrome's 19 set files, 67,072 cases, one process) | 701 s | 536 s | 1.1 GB | 76 |
| sweep | 1,914 s | 9,152 s | 9.3 GB | 12 |
| Total | 62 min | 18,020 s | | |

The largest single process peaked at 1.7 to 2.4 GB.

#### Findings from profiles and timers
- **Process start-up per shard was the main waste.**
  - Importing the library costs only about 50 ms per process, because bun caches the transpiled files.
  - A cold process then compiles the library's hot functions as it runs.
  - A light shard takes 0.1 to 0.4 s of CPU in a warm process, and 0.5 to 0.9 s more in a cold one.
  - Chrome's 482 no-facts shards replay in 122 s of CPU in one warm process. One process per shard took about 450 to 470 s.
- **Inside a warm tier 1 worker** (profile of Chrome's `runs` set):
  - the library is about 60%;
  - the replay's own `measureText` is 17.5%, including 3% for building a JSON key of eleven settings on every call;
  - reading shards is 16% (`JSON.parse` 10%, zstd 3.5%, decoding 2%);
  - `JSON.stringify` is 8%;
  - comparing is about 0%.
- **Heavy shards bound the wall time.**
  - Shards are cut by recorded calls, so a shard of long paragraphs holds few cases and takes long.
  - A webkit-host shard with 2 cases takes 8 s of replay. A typical shard holds 300 to 1,700 cases and takes 0.3 s.
  - Shards of fewer than 50 cases are the long ones in all three browsers.
- **Sweep.** In Chrome's cases the stand-in Canvas was 46% of the time. Of that, `fontOf` was 24.5%: it ran two regular expressions and a hash of the font shorthand on every `measureText` call.
- **Painter differential.** Every process loads and warms two predictors, the frozen bundle and the working tree's. `check` does not re-bundle; it only hashes the pinned 2.3 MB bundle.
- **`tsc`.** Every one of the six projects includes files of all three engines (137 to 143 files in the big three), so the projects mostly overlap. With `--incremental` and no change, `rebuild/tests` takes 2.8 s of CPU against 7.1 s.
- **`bun test`.** Two files take most of the time: `gecko/likely.test.ts`, which compiles a C oracle against ICU, and `unicode/ubidi.test.ts`. One `bun test` process runs the files one after another.

I also checked one false lead. The sweep with facts looked 2.5 times slower than without in Firefox. It was load alone: the same shards cost the same CPU either way.

### 2. One command: `rebuild/tests/gates.ts`

`bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick] [--cores=N]`

**What runs**
- `--quick` runs, for one engine's browser in both configurations:
  - the six `tsc` projects, incremental. `tsc` keeps its own state under `node_modules/.cache/pretext-gates`. The state is keyed by file text hashes, compiler options and compiler version, and `tsc` does the full check when it is missing or does not fit.
  - the unit tests, one process per test file. With one engine it leaves out the other two engines' folders.
  - tier 1, plain and pure.
- Every project's program holds all three engines' files, so all six projects run whatever the engine.
- The full form adds the sweep, the painter differential, the citation ledger and, for Blink, the twin scan.

**How exit codes are read**
- It reads every exit code from the child process itself.
- It reads a report only if that gate wrote it during this run, so a stale report never shows.
- It prints one table: gate, exit code, whether it is fine for a pure refactoring, time from the start of the run to the result, the report's key counts, and what the code means in words and which kind of step accepts it.
- It also writes the rows to `rebuild/tests/.check/gates/gates.json`, and one log per gate.

**Exit code**
- 0 only when every gate is fine for a pure refactoring, meaning a step that changes no prediction and no Canvas question.
- Otherwise the worst result, in the order 1, 2, 5, 4, 3.
- Tier 1's exit 3 counts as fine when no case dropped a question: repeats only, or Chrome's string storage rule alone. The row still sends the listed cases to tier 2. "Dropped only" counts as 3.
- The twin scan always exits 0, so its report decides: more than 0 twins counts as 1.
- A function-set check that skipped cases counts as 3 although it exits 0. The planted change showed this case.

**Cores**
- Every gate starts at once. A check asks gates.ts for a core before each child it starts (`rebuild/tests/cores.ts`).
- A core is a connection to a Unix socket until the connection closes, so a check that dies gives its cores back.
- The table's order decides who gets a core. A quarter of the cores go first to groups of long paragraphs, which bound the run's end.
- Run alone, every tool behaves as before.

**Measured at the rebuild head after the X3 merge, with this branch merged in (scratch clone), load 9 to 39**

| Form | Wall | CPU | Peak memory | Exit |
|---|---|---|---|---|
| `--quick --engine=webkit` | 27 s | 423 s | 5.9 GB | 0 |
| `--quick --engine=gecko` | 49 s | 630 s | 12.7 GB | 0 |
| `--quick --engine=blink` | 112 s | 1,789 s | 8.2 GB | 0 |
| full, all engines (39 gates) | 13.0 min | 10,340 s | 12.0 GB | 0 |

- In the full form tier 1's six rows were done after 74 s.
- Blink's `--quick` does not reach "well under a minute". It is 1,800 CPU-seconds on 16 cores, and about 65% of it is the library's own work on Chrome's cases.
- At load 45 to 60, on the branch alone, the forms took 32 s (webkit), 103 s (gecko), 176 s (blink, exit 2) and 19.8 min (full, exit 0). That blink run is the one the reference replacement hit (section 5). The full run used the earlier core-sharing, before the quarter rule.

**Planted changes, in a scratch clone**
- One line in `engines/webkit/lines.ts`: `c.logicalWidth > available` became `c.logicalWidth > available - 1`.
  - Quick exits 1 and names both tier 1 webkit-host rows: 1,502 predictions changed and 4,911 new questions.
  - The full form exits 1 too. It also marks plain and pure (376 and 372 skipped, counts as 3) and the painter (exit 3).
- A planted type error: exit 1, naming four `tsc` rows, in two runs in a row. `tsc` exits 2 on errors it found fresh and 1 on errors it kept from the last run; the header says so.
- After the revert the run exits 0.
- By accident, the orchestrator replaced Chrome's references during one of my runs. gates.ts reported exit 1 (919 predictions changed against the new reference) and exit 2 ("holds no inputs") on the right rows.

### 3. Speed-ups: one commit each, reports byte-identical, measured back to back three times

Evidence is in `ab.ndjson` and `ab-summary.txt`. A is the commit before, B the commit itself; the two ran in turn.

| Commit | What | Measured on | CPU before | CPU after | Change |
|---|---|---|---|---|---|
| 0202bc1 | Tier 1, plain and pure replay a group of shards per process | three no-facts references: tier 1 | 696, 663, 686 | 478, 419, 457 | −34% |
| | | plain | 834, 788, 842 | 550, 521, 551 | −34% |
| | | pure | 1,107, 1,112, 1,096 | 798, 786, 783 | −29% |
| 68b6121 | The painter differential does the same | Firefox and webkit-host, no-facts | 153, 150, 150 | 96, 96, 95 | −37% |
| ddea3bd | The twin scan scans its case files in child processes | the four suite-sample files | 116, 155, 90 | 144, 139, 136 | +16% CPU |
| aba0b42 | The stand-in Canvas reads a font from its shorthand once | sweep, Chrome no-facts, four sets | 282, 315, 330 | 219, 233, 234 | −26% |
| | | sweep, webkit-host no-facts | 324, 327, 327 | 245, 243, 246 | −25% |
| 3fff15d | The replay's context keeps its settings key between assignments | tier 1, three no-facts references | 445, 438, 438 | 399, 395, 401 | −10% |

- The twin scan trades CPU for wall time: 112, 156 and 86 s became 47, 40 and 45 s on the four files. On all 19 files, 701 s became 145 s.

**How the groups are cut**
- A set's shards go eight to a process, in order.
- A shard of fewer than 50 cases holds long paragraphs, so it runs alone, and the longest shard bounds the wall time as before.
- The sweep keeps one process per shard.
- Groups follow from the manifest alone. Results do not depend on the number of cores or on which sets are chosen, so "deterministic by construction" still holds. I updated that wording in `replay.ts` and the lab README.
- I rejected a dynamic worker pool for this reason.
- `freeze` and `pack` go through the same path. I never ran them. Instead I ran the hidden `work --emit-to` on 20 Firefox shards into scratch, and every emitted shard has the frozen reference's sha256.

**Byte identity on the whole corpus**
- Each gate ran alone on the branch (7bc72ec) and was compared with 1e464d5. All 38 reports are the same bytes. For each of the six references that is tier 1's check report and its needs-browser ids, plain, pure, sweep and the painter differential, plus citations and the twin scan once. In tier 1's check report only `library.commit` is set aside.
- The reports are in `baseline/reports` and `after/reports`. All exit codes were 0 on both sides.
- The same held at the rebuild head after the X3 merge (b3421fc): that commit's own tools against that commit with this branch merged in, 34 reports the same bytes (`x3-check/`).

**The same gates alone on the branch, all six references** (load 6 to 32, so the wall times are not comparable with section 1)

| Gate | Wall | CPU |
|---|---|---|
| tier 1 | 58 s | 742 s |
| plain | 83 s | 961 s |
| pure | 117 s | 1,396 s |
| painter differential | 103 s | 1,358 s |
| twin scan | 145 s | 579 s |
| sweep | 739 s | 6,090 s |
| Total | | 11,156 s (was 18,020 s) |

- Load inflates CPU time too. The unchanged `tsc` commands cost 41 s of CPU at load 50 and 15 s at load 26. So the back-to-back pairs above are the numbers to trust.

### 4. Tier 2: where its minutes go

From the X2 merge's logs (`x2-merge-20260919`). Tier 2 itself is not changed. Tools: `tools/tier2-breakdown.ts` and `tools/tier2-orders.ts`. Data: `tier2-breakdown.json` and `tier2-orders.json`. All times are seconds; the columns from "Jobs summed" on are summed over jobs.

| Run | Wall | Browser jobs | Scoring | Ledger, gate | Jobs summed | Lock wait | Launch | Native | Predict | Observation port | Paint, limits | Painter observation | Rest (round trips, serialising and posting rows and records, navigation) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Chrome no-facts, both orders, recorded | 369 | 353 | 14 | 1.2 | 897 | 130 | 40 | 37 | 364 | 11 | 12 | 27 | 258 |
| Chrome facts | 285 | 279 | 6 | 0.4 | 714 | 0 | 39 | 34 | 358 | 9 | 11 | 24 | 218 |
| Firefox no-facts | 253 | 241 | 11 | 0.7 | 698 | 180 | 78 | 31 | 176 | 4 | 14 | 22 | 178 |
| Firefox facts | 258 | 246 | 12 | 0.8 | 678 | 180 | 74 | 30 | 162 | 4 | 13 | 20 | 177 |
| webkit-host no-facts | 310 | 297 | 12 | 0.5 | 765 | 90 | 36 | 171 | 48 | 118 | 9 | 137 | 135 |
| webkit-host facts | 264 | 250 | 13 | 0.7 | 642 | 0 | 37 | 167 | 37 | 114 | 9 | 133 | 125 |
| Plain predictor, forward only, not recorded: Chrome / Firefox / webkit-host | 58 / 101 / 60 | 57 / 100 / 58 | 1 | 0 | 136 / 224 / 124 | 0 / 40 / 0 | 11 / 39 / 15 | 12 / 16 / 62 | 44 / 58 / 8 | 0 | 0 | 0 | 62 / 62 / 29 |

**Reading it**
- The browser jobs are 95% of the wall. Scoring is 2 to 5% and the ledger under 1%.
- Chrome: half of a job is the library's own inspected prediction in the page.
- Firefox: a third is prediction, a third is the rest column, and 16% is browser launch (2.3 s per job).
- webkit-host: native layout is 26%, the observation port 18% and painter observation 21%.
- `--record` nearly doubles Chrome's forward jobs. Forward jobs summed to 485 s against 264 s for reverse; prediction was 241 s against 124 s, and the rest column 179 s against 79 s. Recording costs 17% in Firefox and 8% in webkit-host.
- Lock waits of up to 180 s in one job were other owners' jobs holding the browser's slots.

**The two changes that would cut it most (orchestrator's call)**
1. **Start jobs longest first.**
   - Today jobs start in set order, three at a time, so the longest job (`heldout-suite-sample` part 1, 70 to 129 s) starts last.
   - Modelled on the recorded job times, the browser phase goes from 353 to 300 s for Chrome no-facts and from 279 to 239 s for Chrome facts.
   - For webkit-host it goes from 297 to 255 s and from 250 to 214 s. For Firefox it goes from 241 to 234 s.
   - For the forward-only runs it goes from 57 to 46 s, 100 to 78 s and 58 to 42 s.
   - That is 12 to 27% less. The protocol is untouched: a part is still one fresh browser process with its cases in file order.
2. **Allow more than three slots when one browser runs alone.**
   - With longest first the phase is already at the sum divided by three.
   - With six slots Chrome's 353 s would be about 150 s, bounded by the sum divided by six.
   - Apart from the three per-browser slots, the shared lock also stops at 7 jobs machine-wide. With three browsers at once that is what caused the waits above. It is a shared-machine policy.
- Already in place: forward-only runs without `--record` cost a quarter to a sixth, and `--ids-file` takes tier 1's needs-browser list.

### 5. What I decided not to do, and why

- **One process running tier 1, plain and pure on a group, sharing the lab path's prediction.**
  - Estimated gain: another 25 to 30% of the quick form.
  - Plain and pure would then prepare the same paragraph object a 4th and 5th time instead of a 2nd and 3rd, which changes what they can catch.
  - The three tools would stop being separate commands.
  - With a documented sample for plain and pure in `--quick`, it is the way to get Blink's quick under a minute, if the maintainer wants that.
- **A sampled sweep in `--quick`.** The brief's quick form has no sweep. A sample would be a new check with its own meaning.
- **Groups in the sweep.** Four light shards per process measured −24% (Firefox), −29% (webkit-host) and ±0 (Chrome) on a few shards. It risks the sweep's wall time when run alone, and a sweep A/B is expensive.
- **A width memo in the stand-in Canvas.** It measured −6 to −18% of the sweep. It would be a second memo in a test double for a small gain.
- **A fast path comparing raw reference lines without parsing.** About −6% of tier 1. Small.
- **`tsc --build` with project references.** Not needed: `--incremental` per project gives the reuse without touching any tsconfig. One merged project would change what is checked, because the projects have different libs and types.
- **The two slow unit test files.** I left them alone. gates.ts runs test files side by side instead.
- **A second baseline run at matching load.** I cancelled it. The back-to-back pairs already answer the question, and it would have cost 35 minutes of a shared machine.

### 6. State of the shared artifacts

- At 06:51 to 06:57 the orchestrator froze Chrome's references again and re-bundled the painter's frozen side, both at the X3 merge.
- This branch is based on 1e464d5 and keeps the library from before X3. Run alone now, Chrome's tier 1 exits 1 (919 predictions changed, X3's row-changing jobs). The painter differential exits 2, because the branch pins the X2 bundle.
- All my whole-corpus evidence was complete before that. The check in `x3-check/` covers the state after it.
- A trial merge of `rebuild-20260916` at b3421fc into this branch, in a scratch clone, was clean; `replay.ts` merged automatically.

**Housekeeping**
- I removed my scratch clones.
- I moved these report folders, which my scratch clones had made, to the Trash: `.artifacts/tests/painter-diff/{speed-new,c-68b6121,plant,speed-base}`.
- I ran nothing with `--record`, `--seed`, freeze, pack or adopt, and no browser.

### Limits the author named

- The shared Chrome references and the painter's frozen bundle were replaced at the X3 merge (06:51 to 06:57) while I worked. This branch is based on 1e464d5 and keeps the older library, so on the branch alone Chrome's tier 1 now exits 1 (919 predictions changed) and the painter differential exits 2 (the branch pins the X2 bundle). Merged with rebuild-20260916 at b3421fc (a clean merge, tried in a scratch clone only), the full form exits 0 and 34 reports equal that commit's own tools byte for byte. The orchestrator should merge the branch rather than run it alone.
- Blink's --quick does not reach 'well under a minute': 112 s at load 9 (1,789 CPU-seconds on 16 cores), about 3 minutes at load 45. WebKit's quick took 27 to 32 s and Gecko's 49 to 103 s. Getting Chrome under a minute needs either one process that shares the lab path's prediction between tier 1, plain and pure, or a documented sample for plain and pure in --quick. I did neither, because both change what the checks see.
- One gates.ts run (quick blink, 06:49) exited 2 because the orchestrator replaced Chrome's input shards under it. gates.ts reported it correctly as a tool failure. The failing gate's log was then overwritten by the next run, because logs are kept per gate name, not per run.
- The whole-corpus before and after tables ran at different loads (base at load 36 to 76, branch at 6 to 32). Load inflates CPU time too: the unchanged tsc commands cost 41 s of CPU and then 15 s. The back-to-back A/B pairs are the numbers to trust. I cancelled a second base run at matching load to save 35 minutes of a shared machine.
- The parallel twin scan costs about 16% more CPU for its shorter wall time (701 s to 145 s on all 19 files), because each child warms up on its own.
- The full form peaks at 12 to 15 GB with 39 tool processes alive plus 16 workers. The machine's swap was already at 7.9 of 9.2 GB around 06:00, so I ran heavy jobs one at a time.
- `--incremental` changes tsc's exit code on errors: 2 when it found them in this run, 1 when it kept them from the last run. gates.ts counts any non-zero exit with 'error TS' lines as type errors, and the header says so.
