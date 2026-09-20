# A store of measured widths on each kept Canvas context: built, measured, and left out (speculative, 2026-09-20)

After the list of contexts (research/PERF-LIFETIME.md), the one step left that could keep answers across paragraphs was
a store of measured widths. The store study (research/PERF-STORE-STUDY.md) had estimated it; this experiment built it as
a Map on each kept context (its lifetime and invalidation are the context's) on a branch that never merges
(`x-perf-store`, base: the contexts list and the 256 px cut's first rework together), and a second agent attacked it.
The attacker's review comes first.

## What came back, and the orchestrator's reading

- **It buys Chrome 6 to 8% from scratch, and nothing once kept positions are in.** Quiet machine, 18 alternating pairs a
  set: with one list of contexts and the cut's rework Chrome takes 1.99 s on the mix, 1.75 s on plain ASCII and 2.21 s on
  real text per 10,000 messages; with the store 1.86, 1.66 and 2.07 s. Calls reaching Canvas fall from 220 to 43 a
  message, but about 139 of the 190 answered asks were repeats inside one message, which Chrome's own canvas already
  answers at 0.14 µs. With research/PERF-POSITIONS.md's kept positions in (1.74, 1.52 and 1.93 s alone), the store on top
  is ×0.996, ×1.019 and ×0.992: redundant. Firefox gains ×0.67 on ASCII and ×0.84 to ×0.88 elsewhere, webkit-host ×0.73
  to ×0.82 of a tenth of a second: engines that don't need it.
- **It is state with a contract, not invisible acceleration.** A stored answer doesn't heal: after a web font loads late
  the kept list stays wrong in Chrome and Firefox too (4 lines where the DOM has 2, still after 200 more prepares); in
  Firefox one kept context answers some characters differently about a second after a content process first asks
  (U+20BF: 13 px, then 9.92 px, in 5 of 5 newly started browsers; an emoji string 21, 17, 21 px), so a store filled in
  that second keeps the wrong value and the port can't know which characters; in Chrome the Map lookup itself turns a
  two-byte slice into a one-byte string (research/BLINK-STRING-STORAGE.md), which a separate key object fixes (without it
  275 of 380 twins predictions move; with it 0 of 760 rows).
- **The orchestrator's decision: leave it out, in every engine.** The next gain in Chrome has to come from fewer
  questions, not from remembering answers.
- **A finding about the merged list of contexts itself, not the store:** in a newly started Firefox, a context made in
  the browser's first second for a family named by its localized name (`"ヒラギノ角ゴシック"`, `"苹方-简"`) stays on
  the fallback font, while the DOM and a context made a second later resolve the name (4 of 4 runs; a new tab of a
  running browser doesn't show it). So "only webkit-host's kept contexts need a contract" does not hold there. It was
  studied (2026-09-20): Gecko keeps no list, and WebKit's contract is narrower than "the page's fonts change"
  (research/PERF-LIFETIME.md, "What landed"; research/CONTEXTS-HEAL.md).
- Also found: under `<html lang="ja">`, content with `lang=""` is 2 lines in Firefox's DOM and 3 by the library (Gecko's
  context with an empty `lang` follows the page's language where the DOM doesn't): a wrong line count, known before as a
  behaviour only.

## Second reading of the store on each kept Canvas context (x-perf-store), 2026-09-20

I reran the owner's central counts and its Chrome headline, this time on a quiet machine. I attacked soundness with the recorded answers of all 389,646 cases and with new probes in the three browsers. I timed one thing the owner didn't: the store on top of the positions branch. My checks are commits on the same branch. I edited none of the owner's files and no library code. Nothing merges.

Paths: `R` = `~/github/pretext-rebuild/.artifacts/tests/runs/perf-store-20260920` (the owner's folder). `R/attack` is mine, with my scripts in `R/attack/tools`. My log is `.progress-store-attack.txt` in the worktree. This text is also saved as `R/attack/REPORT-store-attack.txt`.

Words used:
- **The store**: the prototype, commit ff764ea. Each Canvas context record keeps a Map from the measured string to Canvas's answer, one Map for widths and one for ink boxes.
- **Base**: the same tree with that commit reverted (the owner's scratch commit ac3d2c7, checked out again). Its library is the contexts list and B1b together.
- **Positions**: branch `x-perf-positions` (Blink keeps positions and adjustments by offset on the prepared paragraph). "Positions with the store" and "positions without it" are the owner's scratch commits 6d2d92b and 5fc52b6, checked out again, so I made no merge. The positions library has not changed since that merge (`git diff f0efe00 x-perf-positions -- rebuild/src` adds one test file).
- **Kept context**: a context made once and never touched again, as a page's list holds it.
- **Spin**: the bench page's fixed arithmetic. 27 to 29 ms is a quiet machine.
- **One document, taking turns**: the owner's harness (`realism-run.ts --page=store --other-tree`). Two libraries run in one page and alternate inside every pass.
- **The mix, latin, real**: the bench's three sets of 10,000 chat messages. Latin is plain ASCII.

### 0. Outcome

- **The owner's numbers hold.** Its counts reproduce to the digit. Its Chrome ratios reproduce on a quiet machine: x0.930 on the mix, x0.948 on latin, x0.937 on real text (18 pairs a set, two exclusive stretches, spin 26.3 to 28.3 ms).
- **New: where Chrome lands, quiet.** The base takes 1.99 s on the mix, 1.75 s on latin and 2.21 s on real text. The store makes that 1.86, 1.66 and 2.07 s. So the store does not get Chrome clearly under 2 s, and real text stays over it.
- **New: the store is redundant once positions lands.** Positions with the store against positions without it, from scratch: x0.996 on the mix, x1.019 on latin (slower), x0.992 on real (18 pairs a set). Positions alone takes 1.74, 1.52 and 1.93 s.
- **Firefox is worse than the report says.**
  - One kept context changed its answer with no trigger at all. In 5 of 5 newly started browsers the bitcoin sign U+20BF went from 13 px to 9.92 px about a second in. So did a private-use character.
  - The owner's fence ("the port can know these strings from their characters: emoji, variation selectors, surrogates") does not hold, and neither does its price for leaving them out.
  - It is a content process's state, not only a new browser's: a new process in a browser that had been up 15 s showed the same 16 changes (2 of 2). Waiting does not avoid it: a new process that sat idle 15 s more before its first measurement showed them too (2 of 2). The window opens at the process's first such ask.
- **Chrome and webkit-host: I found no new way a kept context changes its answer.** The store's only new exposure there is the one the owner showed for Chrome: a web font that loads later.
- **Chrome's key rule holds on the corpus.** Under the prototype's own key the study's 27 storage twins are gone: 0 conflicts over 134,130 replayed Chrome cases.
- **One finding is about the contexts list itself, not the store.** In a newly started Firefox, a context made for a family named by its localized name stays on the fallback font for the whole ten seconds, while the DOM and a context made about a second later resolve the name (4 of 4 runs). A new tab of a running browser does not show it (2 of 2). The merged base says only WebKit's kept contexts need a contract.
- **Recommendation: leave it, in every engine.** Section 7.

### 1. Verdict per claim

| The owner's claim | Verdict | Correction or note |
|---|---|---|
| 24 library code lines added, 12 removed, three files; a Map of widths and one of ink boxes a context, 65,536 answers each | stands | Counted from the diff without comments: `canvas.ts` +18 -6, `shape.ts` +4 -4, `contexts.ts` +2 -2. The bound is per Map. The page's ceiling is 512 contexts x 2 Maps x 65,536 (section 6). |
| Calls reaching Canvas: Chrome 220.2 to 42.7 (mix), 197.0 to 42.0, 232.0 to 43.9; Firefox 119.7 to 17.2, 84.9 to 4.1, 113.5 to 17.9; per relayout and stored entries | stands | My rerun gives every one of these digits, equal line-range hashes in all six rows, and the same hit-rate table (section 2.1). webkit-host not rerun. |
| Chrome from scratch x0.92, x0.94, x0.94; "the seconds are upper bounds" | stands, now with quiet seconds | x0.930, x0.948, x0.937. Base 1.99, 1.75, 2.21 s; store 1.86, 1.66, 2.07 s (section 2.2). |
| About 139 of 190 answered asks were repeats inside one message, which Chrome's canvas already answers | stands | Its offline count, not rerun. My browser counts agree in kind: the store removes 81% of the calls and 46% of the units sent (1,552 to 839 a message on the mix). |
| Firefox x0.67, x0.84, x0.88; webkit-host x0.73 to x0.82 | not rerun | Read by pass from its files: Firefox's mix is x0.81, x0.90, x0.95 in passes 1 to 3, so x0.88 is the middle of a wide spread (9 pairs, loaded machine). Latin and real are steady. |
| Chrome kept then 3 widths x0.83; positions does better | stands | x0.829, x0.845, x0.817 at three new widths; x0.814, x0.850, x0.800 at the same three again. Positions alone: 1.10 s against the base's 2.83 s, and 0.11 s again. |
| Firefox: one kept context answers an emoji string 21, 17, 21 px (6 of 8 new processes) | stands, and it is wider | No trigger is needed, the strings are not only emoji, and a new tab shows it too (section 3.2). |
| "Can the port know them? Yes, from the characters alone"; leaving them out costs under 1% of asks | doesn't stand | U+20BF and U+E000 changed. The class is "characters Gecko finds a font for only by its global fallback", which depends on the machine's fonts. Nobody has counted that class. |
| A late web font: the new-list contract binds all three engines | stands | Read from its probe files (kept list 2, 2, 4 lines on the base and 4, 4, 4 with the store; the DOM has 2). Not rerun. |
| Chrome: the lookup itself turns a forced slice one-byte; the separate key fixes it; control fails | stands | S5 files read (6 of 6, and the control fails checks 2 and 6). Corpus: 0 conflicts under the prototype's key, 207 forced-slice keys among them. By the code, a `16bit` context is never asked a one-byte string (section 3.5). |
| A stored answer would not follow `<html lang>` on a Firefox context without a language (derived, not run) | stands, with a twist | Ran it with the library (A4). The kept list and a new list differ at 3 of 6 widths under `ja`. The DOM agrees with the kept list there (section 3.4). |
| Tier 1 repeats only; plain, pure, sweep pass 18 rows; twin scan 0 | stands | Logs read. My replay of all 389,646 cases on the store's tree hit 0 prediction errors and no question a record lacks beyond B1b's 8,675 and 2,526. |
| Line ranges equal on 30,000 messages at 4 widths in each browser | stands | Hashes equal in my Chrome and Firefox reruns. |
| Tier 2 with the page predictor: not done | partly done now | `twins` with the page predictor on the store's tree, both orders: 0 of 760 rows differ from the usual recording. Three small sets in the three browsers: 0 of 9,946 rows. The full sets are still open (section 3.8). |
| "The generator and real text are close in Chrome: 80% and 84%" | stands with a correction | The real set reads its two English texts twice in 10,000 messages (`bench/cases.ts` says so), so its last 1,000 are not text used once. The once-used figures are its offline 80 to 82%. The owner did time real text. |
| "Lifetime: the context's, which is its list's" | stands with a correction | A prepared paragraph holds its contexts by reference and keeps them when `prepare` empties a list (`index.ts`). So the answers live as long as any prepared paragraph made with them (section 6). |
| It is state with a contract, not invisible acceleration | stands, stronger | In Firefox the contract can't even be written: no page event says the process's font state has settled. |
| Recommendation: leave it | stands | Its fallback, a store with a prepared paragraph's lifetime for Gecko and WebKit, is the one form the Firefox findings leave sound (section 7). |

### 2. What I reran

#### 2.1 Counts (they don't depend on load)

- The owner's page and command, from the base tree and from the store's tree: `realism-run.ts --page=store --sets=mix,latin,real --messages=10000 --passes=0`, pinned Chrome and Firefox, background windows, device pixel ratio 2. Files: `R/attack/counts/{chrome,firefox}-{base,store}.json`. Summary: `R/attack/tools/counts-summary.py` (the owner's method).
- Every count equals the owner's:
  - Chrome, calls a message from scratch: 220.2 to 42.7 (mix), 197.0 to 42.0 (latin), 232.0 to 43.9 (real).
  - Chrome, a layout at a new width: 142.5 to 17.9, 126.2 to 18.7, 149.9 to 19.0. At a width met before: 142.4 to 17.3, 126.2 to 18.8, 149.9 to 17.9.
  - Firefox: 119.7 to 17.2, 84.9 to 4.1, 113.5 to 17.9 from scratch; 30.3 to 1.2, 32.3 to 0.3, 30.6 to 1.4 at a new width.
  - Stored at the end: Chrome's mix 106,459 widths and 10 ink boxes; Firefox's mix 54,932 and 21,598; Firefox's real set 121,927 and 32,968.
  - Hit rates by window and the played bounds come out as its tables have them (Chrome's mix 72.7%, 78.8%, 80.9%, 80.3%; without a bound 84.0% and 86.4%).
- The line-range hashes of the base and the store are equal in all six rows, from scratch and at the three other widths.
- One number the report doesn't draw out: on Chrome's mix the store removes 81% of the calls and 46% of the UTF-16 units sent (1,552 to 839 a message). What is left is 43 strings a message that the page has not met, and they are the long ones.

#### 2.2 The Chrome headline, under the timing rule

- Two exclusive stretches: 06:25:52 to 06:34:28 and 07:03:59 to 07:12:37. Each measured for under 400 s. Pinned Chrome, background window, AC power, 10,000 messages, 3 passes a run.
- **The machine was quiet for the page.** Spin was 26.3 to 28.3 ms in all twelve runs. The 1-minute load stayed at 29 to 39: that was other owners' offline work, which the session's quiet-window job demotes while the lock is held.
- Two comparisons took turns run after run, in the order A B A B A B in the first stretch and B A B A B A in the second. Each run is one document with both libraries taking turns inside every pass. So each comparison has 6 runs and 18 pairs a set.
  - **A**: the store against the base.
  - **B**: positions with the store against positions without it.
- Files: `R/attack/timed/stretch{1,2}-chrome-{A,B}-run{1,2,3}.json`, logs `stretch{1,2}.log`. `R/attack/tools/by-pass.py` computes the table. A smoke of 1,000 messages came first to size the stretch (`R/attack/timed-smoke`).

10,000 messages from scratch. Each cell is the median of 18 pairs, their range, and the two medians in seconds:

| Chrome | the mix | latin | real |
|---|---|---|---|
| A: store against base | x0.930 (0.91 to 0.97); 1.990 to 1.856 s | x0.948 (0.89 to 1.01); 1.747 to 1.658 s | x0.937 (0.91 to 0.98); 2.211 to 2.070 s |
| B: positions with the store against positions | x0.996 (0.97 to 1.02); 1.736 to 1.730 s | x1.019 (0.96 to 1.11); 1.515 to 1.588 s | x0.992 (0.96 to 1.02); 1.928 to 1.917 s |

- The two stretches agree: A was x0.933, x0.937, x0.939 and then x0.928, x0.950, x0.934. B was x0.991, x1.030, x0.993 and then x1.001, x1.003, x0.992.
- 10,000 kept paragraphs filled at three other widths (one measurement a run, medians of 6 runs):

| Chrome | 3 new widths | the same 3 again |
|---|---|---|
| A, mix / latin / real | x0.829 (2.83 to 2.34 s) / x0.845 (2.58 to 2.15 s) / x0.817 (3.17 to 2.58 s) | x0.814 / x0.850 / x0.800 |
| B, mix / latin / real | x0.972 (1.10 to 1.06 s) / x0.929 (1.01 to 0.94 s) / x0.961 (1.21 to 1.16 s) | x1.005 / x1.038 / x1.011, of 0.11, 0.08 and 0.11 s |

- **Where Chrome lands against 2 s, quiet, with one list for the page:**
  - The base (the contexts list and B1b): 1.99 s on the mix, 1.75 s on latin, 2.21 s on real text.
  - With the store: 1.86, 1.66 and 2.07 s.
  - With positions and no store: 1.74, 1.52 and 1.93 s. The A and B runs alternated in the same stretches at the same spin, but these two are not one document, so read "positions takes about 13% off" as close, not paired.
  - With both: 1.73, 1.59 and 1.92 s.
- A check of the owner's method. In its harness the base goes first on passes 1 and 3 and the store first on pass 2. In its loaded files the pass where the store went first has the highest ratio in all three sets (x0.945 against x0.881 and x0.926 on the mix). On the quiet machine that pass is again the highest (x0.946, x0.982, x0.944), by less. A number balanced over one pass of each order (x0.934, x0.948, x0.934) equals the median of all pairs, so I make no correction.
- What this still isn't: the bench's own headline row (`chat-night.sh`), a device pixel ratio of 3, or B1b's repaired form, which its critic says asks about 7 more calls a message.

### 3. The attacks on soundness

The test for every attack: is there ONE stored answer that a fresh measurement on the same context would not give.

#### 3.1 The recorded answers of all 389,646 cases, per context

- The study's tool checked a key of seven assigned settings and the string. The prototype's key is another: the context a question finds through all eight settings, the partition too, and the key the engine hands `width`, which for a forced slice is not the measured string. A record holds no partition.
- New tool `rebuild/tools/store-context-check.ts`. It replays every tier case from its record through the usual predictor on a scratch copy of the store's tree, with one line added after each of the two `measureText` calls of `measure/canvas.ts`. The line hands the tool the context record, the key and the answer of every question that reached Canvas. That is exactly what a case's store keeps. One key of one context's settings with two answers anywhere is a counterexample.
- Results, in `R/attack/context-check/<browser>-<config>.json`:

| | cases | questions that reached Canvas | keys | keys with two answers |
|---|---|---|---|---|
| Chrome, no facts | 67,065 | 4,217,715 | 493,723 | 2 |
| Chrome, facts | 67,065 | 5,090,404 | 737,025 | 0 |
| Firefox, no facts | 63,771 | 4,876,795 | 652,358 | 100 (63 widths, 37 ink boxes) |
| Firefox, facts | 63,771 | 4,757,071 | 646,456 | 162 (113 widths, 49 ink boxes) |
| webkit-host, no facts | 63,987 | 2,043,841 | 150,240 | 6 |
| webkit-host, facts | 63,987 | 1,235,204 | 135,967 | 4 |

- **Chrome.** The study's 27 storage twins are gone under the prototype's key. The 2 keys left are `Hamburgefonstiv` in the font checks' `16px serif`, 114.40 against 111.70 px, between cases given the process languages zh-CN and en-US: a process's fact, fixed for a page. 207 distinct Latin-1-only keys were asked of `16bit` contexts (forced slices) and 132,818 of `8bit` ones.
  - Limits: 8,675 and 2,526 cases stopped at a question their record lacks (B1b's), 26 of them among the 380 `twins` cases; what they asked before counts. The replay tells two recorded contexts with equal assigned settings apart by order.
- **Firefox.** Every one of the 262 keys holds U+1F600 or the lone surrogate U+D800, the only such characters in the corpus. Ink boxes are as exposed as widths.
- **webkit-host.** The lone surrogate U+D800 four times (16 px against 5.8 to 12 px under the same page facts) and the font checks' `iM.` twice between the page languages `en` and `ur`. The study found the same six.
- Letter spacing set through the context is part of what finds the context, and spacing added in JavaScript never reaches Canvas. The corpus holds both kinds and shows no conflict from either.

#### 3.2 Firefox: a system font that arrives late (new probes A1, A2, A5, A6, A7, A10)

New probe file `rebuild/tools/store-attack-probe.ts`. Every string has a context of its own, made before anything is measured and never touched again. It is read every 250 ms for ten seconds, with a new context beside it each time. Every run is a newly started browser. Results: `R/attack/probes/<browser>-<probe>-<k>`; `R/attack/tools/probe-summary.py` prints them.

- **A1: a sweep of 142 samples of Unicode blocks under two fonts (284 strings), and no string holds U+FE0E.** In 2 of 2 newly started Firefox:
  - the bitcoin sign U+20BF went from 13 px to 9.92 px at 1,652 and 937 ms, under `16px Arial` and under the bench's list;
  - the private-use character U+E000 went from 13 px to 2.67 px at 592 and 414 ms under the bench's list.
  - 13 px is the missing-glyph box. The first answer, which a store keeps, is the wrong one.
- **A5: the bitcoin sign alone.** Three strings in the page: U+20BF, `that is 5 ₿ a month`, and `Hamburgefonstiv`. In 3 of 3 newly started Firefox the sign went from 13 to 9.92 px at 1,093, 1,070 and 798 ms, and the sentence from 137.53 to 134.45 px. The plain word never moved. So nothing else in the page is the cause: a character is its own trigger.
- **A2: the sweep after ten strings that hold U+FE0E.** In 2 of 2, 16 and 17 kept contexts changed at 942 and 741 ms: U+1F600 and U+1F44D from 17 to 21 px, the star U+2B50 with U+2B1B from 34 to 42 px, thumbs up with a skin tone from 38 to 21 px, `ok 😀` from 38.35 to 42.35 px. Here too the first answer is the wrong one.
- **A6: is it only a browser that has just started? No.** The probe's page waits 15 s, then sends its tab to the same document under the host name `localhost`, which is another site than 127.0.0.1, so Firefox loads it in another content process (the runner sent the restarted page its probes again: `resends: 1` in both result files, and `host` reads `localhost`). The same 16 kept contexts changed, at 339 and 328 ms, in 2 of 2. The owner's own S3 run later in the SAME process moved nothing, which is the control. So this is a content process's state, and a new tab has it.
- **A7: does waiting avoid it? No.** A6 with the new process idle for 15 s more before it makes a context or measures anything (the page reads 15,037 and 15,032 ms after navigation start). 16 and 14 kept contexts changed, 393 and 436 ms after that first ask. So the window opens at a process's first such ask, not at its start. A page that lays 10,000 messages out from scratch takes longer than the window, so its first answers are taken inside it whenever it starts.
- **A10: what it does to lines, with the library, on both trees** (2 of 2 newly started Firefox on each). Four words of ten bitcoin signs at 250 px in the bench's list, one kept list, beside the DOM. As the page starts a word measures 130 px, the DOM has 3 lines and the library 3. Three seconds later a word measures 99.17 px and the DOM has 2 lines. On the base the kept list gives 2. With the store the kept list still gives 3, a new list gives 2, and the kept list gives 3 after 200 more prepares.
- Chrome and webkit-host: 0 of 284 and 0 of 304 kept contexts changed in A1 and A2. Chrome in a new process (A6): 0 of 304.
- What it means:
  - The class is not "emoji". By my reading it is any character Gecko finds a font for only by searching every family, in a process whose character maps are not loaded yet (TAKE-BACK 5.5's mechanism, widened; read from behaviour, not confirmed in a debugger). Which characters those are depends on the fonts installed and on Gecko's own fallback tables. The port can't read that from a string.
  - For emoji the trigger is still a text-presentation sequence met first (A2, A6, A7 read ten of them first; A1 has none and no emoji moved). For U+20BF the character is its own trigger.
  - The owner's fence (a surrogate, a variation selector, U+200D, U+20E3 or an emoji block) leaves U+20BF and U+E000 in the store. Its price for the fence, under 1% of asks, was counted for the wrong class.
  - A page can't see the state settle. I know of no event it gets; the DOM simply reflows. So "make a new list after the page's fonts change" does not cover it, and no other sentence a caller could act on does.
  - Without the store the same wrong width lives as long as one prepared paragraph and heals at the next `prepare`, because Firefox's kept context itself answers right once the process has settled.

#### 3.3 A web font that loads later

Not rerun. I read the owner's probe files: on the base Chrome's and Firefox's kept lists go from 4 lines to the DOM's 2 by themselves and webkit-host's stays at 4; with the store all three stay at 4, still after 200 more prepares, and a new list gives 2. The claim stands: with the store the new-list contract binds all three engines.

#### 3.4 `<html lang>` under a context whose language is '' (new probe A4)

The owner derived this and did not run it. A4 runs the library with one kept list while the page's language goes en, ja, zh-CN, en, for content whose own language is '' and for content in `en`, beside the DOM's line count for an element with that `lang` attribute. Text: `Hello, world` four times at `32px serif`, six widths.
- Firefox, content `lang=""` under `ja`: the kept context itself goes from 161.73 to 186.97 px. A new list gives 3 lines at 340, 360 and 380 px. The kept list with the store gives 2 lines. **The DOM has 2.** Back under `en` everything agrees again. Content in `en` never moves.
- So a stored answer does differ from a fresh one there. But the fresh one is the wrong one: the DOM does not read the page's language for `lang=""` content, and Firefox's Canvas does for a context whose language is ''. That is a defect of the port's '' context when it isn't told the process's languages, which the store happens to hide. I would not count it for or against the store.
- Chrome and webkit-host: kept list, new list and DOM agree at every step.

#### 3.5 Chrome: storage, a segmented paragraph then an unsegmented one, and Chrome's own cache

- By the code: a segmented paragraph's contexts are the `16bit` ones and its one-byte strings go to `8bit` contexts; an unsegmented paragraph has `8bit` contexts alone (`blink/index.ts:139`, `shape.ts` `contextsOf`). Every other site that measures in Blink (the hyphen, the tab's space, HanKerning, the word-splitting probe, the gap check) asks a string that is two-byte by a character, or a one-byte string of an `8bit` context. So on a `16bit` context a Latin-1-only key can only name a forced slice, and on an `8bit` one only the one-byte string. A string met first in a segmented paragraph and later in an unsegmented one finds another context, or is the same question.
- `prefixed` strings carry U+2060 and stay two-byte through a lookup. Nothing outside `measure/canvas.ts` touches a context's `ctx`, and no caller changes an ink box it was handed (the store hands every caller the same object).
- By the corpus: section 3.1, 0 conflicts.
- Chrome's own per-canvas cache dropping a string can't hurt a stored answer: the store never asks again. For the base the lifetime review already showed 0 of 120,000 strings come back with other bits past the bound.
- The owner's control (the store keyed by the measured string itself fails 2 of 6 Canvas checks and moves 275 of 380 twins predictions) is what shows the key rule is needed. It is one line, and nothing but tier 2 on `twins` or probe S5 would catch its loss: bun can't see storage.

#### 3.6 Device pixel ratio, zoom, hidden and shown

- Device pixel ratio in Chrome: already probed on the base (`probes/contexts-device-scale.ts`: 0 of 135 kept-against-new pairs differ through factors 2, 1, 3, 2, and no width asked again moved). A context that never moves can't make its stored answer stale. Not rerun.
- A real move between displays, the browser's own zoom, and any ratio change in Firefox or webkit-host: not probed by anyone.
- Hidden and shown: not probed. Every run's document was visible in a background window. Nothing in `measureText` reads visibility; what hiding could do is drop caches, and a reshaped string gives the same bits.

#### 3.7 Families named by another name (new probes A3, A8, A9): a finding about the contexts list itself

- 33 families, each before `monospace`: 22 by a localized name (`"ヒラギノ角ゴシック"`, `"苹方-简"`, `"Apple SD 산돌고딕 Neo"`), 6 by a face or PostScript name, 5 controls.
- Firefox, 2 of 2 newly started browsers: **no kept context changed, and 20 new ones did** (19 localized names and one face name). At the start a localized name resolves to the monospace fallback (385.33 px). A context made from 585 ms (811 ms) on resolves it (369.25 px for Hiragino Sans). The context kept from the start stays on the fallback for the whole ten seconds.
- **A8, the same beside the DOM** (2 of 2): a span in the Japanese name of Hiragino Sans goes from 385.33 to 369.25 px at 1,125 ms (792 ms), a new context does the same at the same reading, and the kept context stays at 385.33 px. The same for the Chinese name of PingFang SC (334.12 px) and the Korean name of Apple SD Gothic Neo (305.78 px). So the DOM follows the name and the kept context doesn't.
- So here Firefox's kept context does not heal, without any store. PROFILING-START and `index.ts` say the list needs a contract in WebKit alone. For a page that lists a CJK font by its localized name, which Japanese and Chinese pages do, a list made in a Firefox that has just started is wrong until it is remade, and nothing tells the page when.
- **A9, the same in a new content process of a browser that had been up 15 s** (2 of 2): the names resolve from the first reading, and kept, new and DOM agree. So this one is a newly started browser's, which is what a restored session is, and not a new tab's.
- Chrome and webkit-host resolve the names they know from the start; nothing moves.
- This belongs to the contexts list's owner. The store neither causes nor worsens it.

#### 3.8 Tier 2 with the page predictor

- Run: `twins` (380 cases, one document) with `lab/baselines/page-contexts-predictor.ts`, which keeps one list for the document, on the store's tree, in both orders, from a clean worktree of 3a07645 (`R/attack/tools/tier2.sh`, out `R/attack/tier2/chrome-twins-page`, exit 0 after 6,100 s of waiting for slots). This is the run where the key rule meets a shared list, and it is the one the owner's chain never got to.
- Compared case by case with the usual recording (`b1b-20260919/chrome-no-facts`) by `lab/compare-rows.ts --prediction=without-measure`: 380 rows in each order, 0 missing, **0 native observations, 0 predictions and 0 painted lines differ.** The document made 70 contexts. Reports: `R/attack/tier2/compare/chrome-twins-page-{forward,reverse}.json`.
- The small sets `smoke-hand`, `smoke` and `rich-prewrap` the same way, no facts, both orders, against the usual recordings (`R/attack/tools/compare-small.sh`): Chrome 0 of 3,316 rows differ, Firefox 0 of 3,312, webkit-host 0 of 3,318.
- Still open: the full sets in both orders in the three browsers, Chrome's shuffled order, and the facts configuration. By what the corpus check and these runs show I expect nothing from them in Chrome and webkit-host. In Firefox a document that starts in the window of section 3.2 could differ, and the lab's documents mostly start after it.

### 4. Is the hit rate on real text what decides the headline?

No, and the owner did time real text.
- It timed all three sets in one document (x0.937 on real, 18 pairs). Mine agrees: x0.937.
- The hit rate does not decide Chrome's gain. The three sets hit at 79 to 84% in their last 1,000 messages and gain the same 5 to 7%. What decides it is that most hits replace an answer Chrome's own canvas already gave at 0.14 µs, and that the 43 strings a message the store can't answer are the long ones (46% of the units stay).
- One correction to how the report reads the real set. `bench/cases.ts` says its Latin kinds read two English texts of about 510,000 units, "10,000 messages read them twice". So the 84% of its last 1,000 messages is on a second reading, with other slice edges. For text used once the owner's offline runs are the figures: 82% on `ascii-once`, 80% on the eleven languages, in Blink.
- In Firefox the hit rate matters more, because a repeat costs there what a first ask does. Real text hits less there (88% against 91%) and gains a little more (x0.84 against x0.88). Firefox is not the engine the 2 s question is about.

### 5. The store, the positions tables and the list's bound

- **The store is redundant once positions lands.** That is comparison B in section 2.2: from scratch x0.996, x1.019 and x0.992, which is nothing on the mix and on real text, and 2% slower on latin. At three new widths it buys 3 to 7% of about 1.1 s. At a width met before positions already asks Canvas nothing, and the store costs 0.5 to 4% there.
- Counts say why (the owner's, `R/counts/chrome-positions-*.json`): from scratch positions with the store reaches the same 42.7 calls as the store alone. Both remove repeats. Positions removes them by offset, without building the string. The store builds every string to look it up.
- **Positions does not make the store's bound unnecessary, and the store does not make positions' tables unnecessary.** The owner has this right. Positions is bounded by the paragraph and can't go stale while the paragraph is valid. The store needs a bound of its own, and past it Chrome asks 17 to 19 strings a layout again.
- **The list's bound and the store.** The list is emptied past 512 contexts. With the store that also drops every answer, so the list's cliff (about 60 font declarations used in turn in Chrome) becomes the store's cliff too. Neither bound replaces the other: the list's counts contexts, the store's counts answers in one context.

### 6. The engineering guide

- **It is a cache by the guide's meaning.** The guide: a derived value stored beside its inputs "becomes state. Its lifetime now follows the object rather than the evaluation that justified it, so you have created a second representation of the same fact, plus an invalidation problem." The store is that: Canvas's answer, kept past the call that asked for it, under a lifetime (the list's) that is not its inputs' (the page's fonts, the process's font state, the document's language).
- The guide allows a cache for "truly expensive computations after real measurements" and for "computations with stable input identity, real reuse, bounded cache size". Against each:
  - Expensive, after measurement: no. 5 to 7% in Chrome, and nothing once positions is in.
  - Stable input identity: no. Three inputs are not in the key and the library can't see them: the page's loaded fonts (all engines), Firefox's per-process font state, and the page's language for a Firefox context whose language is ''.
  - Real reuse: yes by count (80%), mostly of answers that were already cheap in Chrome.
  - Bounded: per Map, by a constant that is nobody's fact.
- The guide also says caches "lower the cost of best-case scenarios by raising the cost of worst-case scenarios". Latin with positions is that case: x1.019.
- **Does the report name the lifetime, what invalidates it and what bounds it truthfully?**
  - Lifetime, "the context's, which is its list's": not quite. A prepared paragraph holds its contexts by reference, and `prepare` empties a list past its bound with `contexts.length = 0` while "prepared paragraphs hold their contexts by reference and keep theirs" (`index.ts`). So a context's answers live as long as any prepared paragraph made with it. A page that starts a new list after a font load and keeps old prepared paragraphs keeps the old answers, and a fill of such a paragraph at a new width reads them.
  - What invalidates it, "the list, and nothing else": true of the code, and the report lists what should and can't. Add Firefox's process state as found here: wider than emoji, and with no event a contract could name.
  - What bounds it, "65,536 answers a Map": true per Map. The page's ceiling is 512 contexts x 2 Maps x 65,536 answers, about 67 million. A chat page with one font list sits at 0.1 to 0.15 million (11 to 18 MB by its measure, which I reran: 173 bytes an entry in node, 115 in bun). A page with ten font declarations has about ten busy contexts.

### 7. Recommendation, in five sentences

1. Leave the store out, in every engine.
2. In Chrome, the engine the question was about, it takes 5 to 7% off on a quiet machine (1.99 to 1.86 s on the mix, 2.21 to 2.07 s on real text), so it does not get Chrome clearly under 2 s; and with the positions branch in, it takes nothing (x0.996, x1.019, x0.992).
3. In Firefox it is unsound in a way no rule over characters can fence: in 5 of 5 newly started browsers a kept context first answered a plain currency sign with the missing-glyph box and gave the right width a second later, a new process of a running browser does the same whenever it first asks, and a store keeps the first answer until the list is remade, which no page event tells a caller to do.
4. It would turn "make a new list after the page's fonts change" from WebKit's contract into every engine's, shown with the library in the three browsers, for a gain webkit-host doesn't need (about 35 ms per 10,000 messages in the owner's warm passes) and Firefox gets mostly on plain ASCII, where it is already at half a second.
5. What the night does give the 2 s decision is a quiet baseline: Chrome with one list and B1b is at 1.99 s on the mix, 1.75 s on ASCII and 2.21 s on real text, positions alone brings that to 1.74, 1.52 and 1.93 s, and the next gain has to come from fewer questions, not from remembering answers.

On the owner's "if a store by string is ever wanted, build it for Gecko and WebKit only, with a prepared paragraph's lifetime": that form is sound by the evidence here, since a prepared paragraph already freezes its widths. It is PROFILING-START's item 5, and it is for long documents, not for chat.

### 8. Needs the maintainer, or another owner

1. **The contexts list in Firefox (the merged base, not the store).** Section 3.7: a context made in the first second of a newly started Firefox for a family named by a localized name stays on the fallback, and a new context resolves it. "Only WebKit needs the contract" (PROFILING-START item 1, `index.ts`'s comment) does not hold there. Probe A8 shows the DOM does follow the name, and A9 that a new tab of a running browser resolves the names at once. So it needs a browser that has just started, as a restored session is.
2. **Firefox's start-up font state is wider than TAKE-BACK 5.5 has it.** No text-presentation character is needed (U+20BF, U+E000), it is per content process, and it starts at the process's first such ask. It touches every prepared paragraph made in that window today. PLATFORM_BUGS and TAKE-BACK 5.5 should say so.
3. **Gecko's '' context follows the page's language where the DOM doesn't** (section 3.4): under `<html lang="ja">`, content with `lang=""` is 2 lines in the DOM and 3 by the library with a new list. Known as a behaviour since the lifetime review; here it is a wrong line count.
4. The quiet Chrome numbers of section 2.2 are with one list a page, at a device pixel ratio of 2, on B1b as built. B1b's critic wants a repaired form that asks about 7 more calls a message.

### 9. Files, commits, runs

- Branch `x-perf-store`, worktree `~/github/pretext-rebuild-wt/perf-store`, local only. My nine commits sit on the owner's head 586632f; none touches `rebuild/src` or a file of the owner's.
- Tools: `rebuild/tools/store-context-check.ts` (section 3.1), `rebuild/tools/store-attack-probe.ts` with `store-attack-probe-entry.ts` (probes A1 to A10).
- `R/attack/counts`: my counts. `R/attack/timed` and `timed-smoke`: the two stretches and the smoke. `R/attack/context-check`: the six corpus reports. `R/attack/probes`: 31 probe runs, each a newly started browser, with `.exit` files. `R/attack/tier2`: the four runs and `compare/`. `R/attack/tools`: every script.
- Browser jobs: 2 counts jobs, 1 smoke, 2 exclusive stretches (each under 9 minutes inside the lock, under 400 s measuring), 11 probe jobs, 4 tier 2 runs. No job failed.
- Scratch worktrees (the base, positions with and without the store, the clean run tree): made from existing commits, removed through `git worktree remove`. No merge, so no rerere entry.

## A store of measured widths on each kept Canvas context: built, counted, timed, and what it costs (2026-09-20)

Branch `x-perf-store` is unmerged and unpushed. Its base is afb5a63, the contexts list and B1b together. Everything I recorded is under `R` = `~/github/pretext-rebuild/.artifacts/tests/runs/perf-store-20260920`. My scripts are in `R/tools`.

Words used:
- **The store**: a Map on each Canvas context record, from the measured string to Canvas's answer. `width()` and `bounds()` in `rebuild/src/measure/canvas.ts` read it first and fill it on a miss.
- **Base**: the same tree with the store's one commit reverted. It was a scratch commit on no branch, so both trees run one harness.
- **An ask**: one call of `width()` or `bounds()`. On the base every ask reaches Canvas.
- **Reaches Canvas**: a real `measureText` call, counted by wrapping the prototype in the page after the timed part.
- **The mix, latin, real**: the bench's three sets of 10,000 chat messages. Latin is plain ASCII. Real is the realism owner's set of real text read once, merged from `x-realism`.
- **One list a pass**: every message of a pass is prepared with the same list of contexts, as a page does. Both trees run this way everywhere below.
- **Spin**: the bench's fixed arithmetic loop. 27 to 29 ms is a quiet machine.
- **Played store**: the counting page also plays a store of several bounds over the questions it sees, keyed per context object. On the base that is exact, because every ask reaches Canvas there.
- **Forced slice**: a Latin-1-only string of 13 units or more that the Blink port slices out of a two-byte string, so that Canvas shapes it as two-byte text.

### 0. Outcome

- **Built**, as the smallest change that works: 24 library code lines added and 12 removed in three files (commit ff764ea).
- **It does not get Chrome clearly under 2 s.**
  - From scratch the store is x0.92 on the mix, x0.94 on plain ASCII and x0.94 on real text in Chrome. That is 18 alternating pairs in two stretches that agree to the third digit.
  - Calls reaching Canvas fall from 220 to 43 a message. Most of what went away were repeats inside one message, which Chrome's own canvas already answered at 0.14 µs each.
- **The other engines gain more and don't need it.** Firefox is x0.67 on ASCII, x0.84 on real text and x0.88 on the mix. webkit-host is x0.73 to x0.82 of a tenth of a second.
- **It is sound where nothing changes under it.**
  - Every line range of 30,000 messages at 4 widths is equal with and without it in each browser.
  - Tier 1 shows repeats only.
  - Plain, pure and sweep pass all 18 rows.
  - The twin scan finds 0, per case and per page.
  - The 380 twins cases move nothing in tier 2.
- **It is unsound in three ways the list alone is not.**
  - (a) Firefox: one kept context answers an emoji string with 21, then 17, then 21 px within about a second. This happened in 6 of 8 newly started processes. A store filled in that second keeps 17.
  - (b) A web font that loads later: with the store the kept list stays wrong in Chrome and Firefox too. The library gives 4 lines where the DOM has 2, still after 200 more prepares. So the new-list contract binds all three engines, not WebKit alone.
  - (c) Chrome: the Map lookup itself turns a forced slice into a one-byte string before Canvas sees it. The prototype closes this with a key that is another string object. A control tree without that one line fails 2 of 6 checks in pinned Chrome and moves 275 of 380 twins predictions in tier 2.
- **Not done: tier 2 with the page predictor.**
  - Other owners' exclusive timed jobs followed each other without a gap from 02:54 to the end of my time, so ordinary slot jobs starved.
  - Of my chains only three runs finished: the twins run with the usual predictor, its naive-key control, and three 25-case parts of the Firefox and webkit-host page runs.
- **Recommendation: leave it.** Section 5 has the numbers that decide.

### 1. What was built

Library commit ff764ea:
- `measure/canvas.ts` (+18 -6 code lines):
  - `Context` gains `widths: Map<string, number>` and `inkBoxes: Map<string, InkBox>`.
  - `width(context, text, key = text)` and `bounds(context, text)` answer from the Map, else ask Canvas and keep the answer.
  - `MAX_ANSWERS` = 65,536 a Map. A Map that holds as many is cleared before the next answer goes in.
- `engines/blink/shape.ts` (+4 -4) and `engines/blink/contexts.ts` (+2 -2):
  - `canvasString` also returns `key`, and `raw16Of` passes it on.
  - For every string but one kind the key is the string. For a forced slice the key is the one-byte string it was cut from. Section 3.3 has why.
- Lifetime: the context's, which is its list's. Invalidated with the list and by nothing else. Bounded by `MAX_ANSWERS` a Map.
- Two unit tests pinned exactly what the store changes, so I rewrote them to say what is true now:
  - `canvas.test.ts` ("always ask Canvas and use no key").
  - `font-checks.test.ts` ("a font that loads between two calls shows in the second"). With the store it shows only in a new list.
- Unit tests: 879 pass at that commit. At the head 880 pass and 0 fail with a 60 s timeout. Under a load of 70 the default 5 s timeout failed 5 tests by time alone.
- A caller that hands `prepare` no list gets a store per prepared paragraph. That is the memo the re-architecture took out (DESIGN.md 4.7), back under another name.

### 2. What it buys

#### 2.1 Counts (they don't depend on load)

How it was measured:
- The page is `rebuild/bench/store-page.ts`, served by `realism-run.ts --page=store`. It ran in the pinned browsers, in background windows, at a device pixel ratio of 2, with one list a pass.
- After the timed part the page wraps `measureText`. It lays the 10,000 messages of each set out from scratch at 320 px and keeps them. Then it fills them at 260, 380 and 440 px twice. It hashes every line's source range.
- Files: `R/counts/<browser>-{base,store}.json`.

Equal lines: the line-range hashes of the base and the store are equal in all 9 rows (3 browsers x 3 sets), from scratch and at the three other widths.

`measureText` calls that reach Canvas, a message from scratch, base to store:

| | the mix | latin | real |
|---|---|---|---|
| Chrome | 220.2 to 42.7 | 197.0 to 42.0 | 232.0 to 43.9 |
| Firefox | 119.7 to 17.2 | 84.9 to 4.1 | 113.5 to 17.9 |
| webkit-host | 40.2 to 1.9 | 31.7 to 1.2 | 38.7 to 3.1 |

Per layout of a kept paragraph, base to store:

| | at a new width (mix / latin / real) | at a width met before |
|---|---|---|
| Chrome | 142.5 to 17.9 / 126.2 to 18.7 / 149.9 to 19.0 | 142.4 to 17.3 / 126.2 to 18.8 / 149.9 to 17.9 |
| Firefox | 30.3 to 1.2 / 32.3 to 0.3 / 30.6 to 1.4 | 0 to 0 (Gecko keeps what it measured on the paragraph) |
| webkit-host | 0.1 to 0 | 0.1 to 0 |

- Chrome's "width met before" row does not go to 0 with the store. 10,000 kept messages ask the busiest context more new strings between two layouts of one paragraph than the bound holds. So the Map has been cleared by then.
- A played store without a bound lets 0 through there. By then it holds about 480,000 strings on the mix: 35.9 new a message from scratch and 4.0 a layout at the three new widths.

With `x-perf-positions` merged into a scratch copy of each tree (Chrome only, `R/counts/chrome-positions-{base,store}.json`). The library merged by itself. The two lab files that conflicted were kept as they were. This is the mix:

| Chrome, the mix | from scratch | a new width | a width met before |
|---|---|---|---|
| base | 220.2 | 142.5 | 142.4 |
| store | 42.7 | 17.9 | 17.3 |
| positions | 146.2 | 39.0 | 0.0 |
| positions and store | 42.7 | 8.8 | 0.0 |

- Line-range hashes are equal in all four trees.
- From scratch the store reaches the same 42.7 with or without positions. Both remove repeats, and the distinct strings are the same.
- At a width met before, positions asks nothing, by offset, with no bound to outgrow. The store can't match that past its bound.

Hit rate as the page grows: the share of asks the store answered, in the browser. In brackets is a played store without a bound.

| | first 100 | 101 to 1,000 | 1,001 to 9,000 | last 1,000 |
|---|---|---|---|---|
| Chrome, mix | 73% (73%) | 79% (79%) | 81% (84%) | 80% (86%) |
| Chrome, latin | 74% (74%) | 78% (78%) | 79% (84%) | 79% (87%) |
| Chrome, real | 73% (73%) | 80% (80%) | 81% (83%) | 84% (87%) |
| Firefox, mix | 45% (46%) | 72% (73%) | 87% (89%) | 91% (92%) |
| Firefox, latin | 64% (65%) | 85% (86%) | 96% (96%) | 99% (99%) |
| Firefox, real | 50% (51%) | 74% (75%) | 85% (88%) | 88% (94%) |
| webkit-host, mix | 61% (61%) | 85% (85%) | 96% (96%) | 99% (99%) |
| webkit-host, latin | 68% (68%) | 85% (85%) | 97% (97%) | 99% (99%) |
| webkit-host, real | 61% (61%) | 80% (80%) | 93% (93%) | 98% (98%) |

- The generator and real text are close in Chrome: 80% and 84% in the last 1,000.
- In Firefox and webkit-host real text hits a little less: 88% and 98% against 91% and 99%.
- Offline, the study's method on my base agrees. The tool is `tools/store-real-text.ts` with its new `--page-list`, `--bound` and `--set=bench-real`, under the stand-in Canvas. Files: `R/offline/base-<engine>-<set>.json`.
  - In the last 1,000 of the mix, Blink is at 88% without a bound and 80% under it, Gecko at 92% and 84%, WebKit at 99%.
  - On text used once (`ascii-once`, 2,336 messages) Blink ends at 82%, Gecko at 92%, WebKit at 92%.
  - On the eleven languages used once Blink ends at 80%, Gecko at 86%, WebKit at 85%.
- The played bound on the base equals the prototype's own misses block by block. For Blink latin both give 50.9, 42.4, 40.9, 40.5, 51.7, 43.9, 45.1, 44.1, 51.0 a message. So the playing is a faithful model of the store.
- Strings over 16 units hit only 30 to 43% in Blink. Short strings carry the hit rate.
- Why Chrome's gain in time is small (2.2):
  - Under the stand-in a Blink message asks about 235 questions. 96 are distinct inside the message and 45 are new to the page (`R/offline/store-permessage-blink-*.json`).
  - So about 139 of the 190 asks the store answers are repeats inside one message.
  - Chrome's own canvas already answers those at 0.14 µs (the study's timing). A Map read of a string built again costs 0.08 to 0.2 µs.

What the bound costs: calls a message reaching Canvas from scratch under a played store (base tree, `R/counts/<browser>-base.json`).

| bound a context | none | 262,144 | 65,536 | 32,768 | 16,384 | 4,096 |
|---|---|---|---|---|---|---|
| Chrome, mix | 35.9 | 35.9 | 42.7 | 46.0 | 49.2 | 56.2 |
| Firefox, mix | 15.0 | 15.0 | 19.6 | 24.8 | 30.9 | 50.9 |
| webkit-host, mix | 1.9 | 1.9 | 1.9 | 1.9 | 2.9 | 9.2 |

Size at 10,000 messages.

What the prototype's lists held at the end of the counting pass (from scratch and two resizes, under the bound):
- Chrome's mix:
  - 106,459 widths and 10 ink boxes in 24 contexts.
  - 1.22 M UTF-16 units of keys. 1.18 M of them are in two-byte strings, because the port writes spaces as U+2028.
  - The busiest context holds 47,088 entries.
- Firefox's mix: 54,932 widths and 21,598 ink boxes, 0.60 M units.
- Firefox's real set: 121,927 widths and 32,968 ink boxes, 3.59 M units (long CJK suffixes).
- webkit-host's mix: 18,866 widths, 0.12 M units.

Without a bound (offline, from scratch only):
- Blink: 360,431 strings and 7.8 M units on the mix, 403,766 and 8.1 M on real.
- Gecko: 148,364 and 16.7 M on the mix, 144,316 and 5.1 M on real.
- WebKit: 18,787 and 0.12 M on the mix, 31,056 and 0.20 M on real.

Bytes:
- A Map of 65,536 two-byte keys of 6 to 18 units with a number each takes 10.8 MB in node (V8 without pointer compression, 173 bytes an entry). It takes 7.2 MB in bun (JavaScriptCore, 115 bytes an entry). Source: `R/tools/mapmem.js`, heap before and after a collection.
- So a full context is 7 to 11 MB, and Chrome's 106,459 entries are about 11 to 18 MB.
- Blink's store without a bound would be about 45 to 70 MB after 10,000 messages from scratch. It would keep growing by 30 to 36 strings a message.

#### 2.2 Time

How it was measured:
- Two exclusive stretches:
  - `R/timed/stretch1.log`, 02:46:08 to 02:54:05, the three browsers.
  - `stretch2.log`, 03:20:55 to 03:26:03, Chrome again.
- In every run ONE document holds both libraries (`realism-run.ts --page=store --other-tree=<base checkout>`). They take turns inside every pass: the base first on even passes, the store first on odd ones.
- There are 3 runs a browser a stretch and 3 passes a run, so 9 pairs a set a stretch.
- Whatever loads the machine loads both, so a pair's ratio holds.
- Files: `R/timed/stretch{1,2}-<browser>-inpage-run{1,2,3}.json`. `R/tools/paired.py` computes the table.

**The machine was never quiet.** Spin was 32 to 47 ms in Chrome's runs, against 27 to 29 when quiet. The 1-minute load was 5 to 11. My first stretch gave up unmeasured at a load of 70. So the ratios count and the seconds are upper bounds.

10,000 messages from scratch, store against base. Each cell is the median of the pairs and their range:

| | the mix | latin | real |
|---|---|---|---|
| Chrome (18 pairs) | x0.918 (0.86 to 1.12) | x0.942 (0.85 to 1.01) | x0.937 (0.85 to 1.20) |
| Firefox (9 pairs) | x0.876 (0.73 to 0.97) | x0.665 (0.63 to 0.70) | x0.838 (0.81 to 0.90) |
| webkit-host (9 pairs) | x0.798 (0.62 to 0.83) | x0.732 (0.67 to 0.76) | x0.820 (0.59 to 0.84) |

- The two Chrome stretches agree to the third digit: x0.918 and x0.918, x0.943 and x0.941, x0.932 and x0.939.
- Seconds in those runs, as medians, base then store:
  - Chrome: 2.57 and 2.43 s (mix), 2.23 and 2.10 s (latin), 2.53 and 2.55 s (real). The fastest passes were 1.95 and 1.81 s, 1.73 and 1.61 s, 2.20 and 2.04 s.
  - Firefox: 3.41 and 3.16 s, 0.63 and 0.43 s, 1.87 and 1.51 s.
  - webkit-host: 0.23 and 0.15 s, 0.14 and 0.10 s, 0.23 and 0.15 s.

Chrome's kept paragraphs, 10,000 of them filled at three other widths. There is one measurement a run, so 6 runs:

| Chrome | 3 new widths | the same 3 again |
|---|---|---|
| mix | x0.832 (base 3.30 s, store 2.77 s) | x0.825 |
| latin | x0.840 (3.38 s, 2.82 s) | x0.852 |
| real | x0.838 (4.27 s, 3.52 s) | x0.837 |

- Firefox's first fill at three new widths is x0.69 to 0.74: about 0.98 s to 0.68 s on the mix. Filling again is x0.99 to 1.02, since Gecko asks nothing there.
- webkit-host's relayout doesn't move: x0.96 to 1.04 of about 0.1 s.

**Where Chrome lands against 2 s.** I can't give a quiet number. What I can say:
- The store takes 6 to 8% off, on the generator and on real text alike. It does not decide which side of 2 s Chrome is on.
- In my runs the base itself sat at 1.95 to 2.7 s on the mix. The machine was a quarter to a half slower than quiet by the spin.
  - If the base is 2.3 s quiet, as the two owners' sum says, the store makes it about 2.1 s.
  - If it is nearer 1.7 s, as my passes scaled by the spin suggest (2.04 s at a spin of 36 ms), the store makes it about 1.6 s.
  - Scaling by spin is an estimate. Canvas work need not slow down as arithmetic does.
- One thing in my page differs from the bench's headline and may matter to that number. No variant in my document makes a list a message. So no pass inherits the collection of about 110,000 canvases from the pass before. The bench's row E does.
- What would settle it: `chat-night.sh` on the base, quiet. That is the base's open run, not the store's.

### 3. Is it sound

#### 3.1 Firefox: one kept context does give one string two answers

Probe `rebuild/tools/store-stale-answer-probe.ts`, extended with S2 and S3. Results are in `R/probes/stale-*`.
- There are 22 strings. Each sits on a context of its own, made before anything else and never touched again. It is read every 250 ms for ten seconds, beside a new context each time.
- The strings are:
  - emoji: plain, with U+FE0F, a ZWJ sequence, a flag, a keycap;
  - a text-default symbol and a lone surrogate;
  - Han, Hangul, Thai, Devanagari, Hebrew, arrows, math, private-use and unassigned characters, all by fallback;
  - Han and Arabic in a listed font;
  - `Hamburgefonstiv` in two named fonts.
- S2 does nothing else. S3 measures U+1F600 U+FE0E once after its first reading, which is the known trigger.

What the runs show:
- **Yes, inside one kept context.** Take the study's S1 alone in a newly started Firefox (`stale-firefox-s1-first`).
  - The KEPT context answers U+1F600 under `16px Arial` with 21 px at 0 ms.
  - It answers 17 px at 49, 555 and 1,059 ms, and 21 px again from 1,563 ms on.
  - A new context answers the same at every reading.
  - So the state is the process's, not the context's. A kept context is no protection.
- Five more newly started processes ran S3 first, with every change of an answer timed (`stale-firefox-changes-1` to `-5`).
  - In 4 of 5 the kept context's answer for the three strings that hold U+1F600 went from 21 to 17 px at 35 to 74 ms. It came back to 21 px at 817 to 1,351 ms. The new contexts did the same.
  - None of the other 19 strings moved in any run: not the other emoji, not the fallback scripts, not the named fonts.
  - In 1 of 5 nothing moved. The sequence itself measured 21 px that time.
- Counting every newly started process I ran with the trigger, 6 of 8 showed it.
- With nothing happening (S2, first page of a new process) no string moved in ten seconds in any browser. With the trigger more than ten seconds into a process's life nothing moved either.
- Chrome and webkit-host gave one answer throughout in every run.

What it means for the store:
- **Which strings.** By the recordings (the study's 91 keys) and these runs: strings that hold an emoji code point, and lone surrogates.
  - The mechanism TAKE-BACK 5.5 reads from source is per code point.
  - A failed search for a text-style font records the code point as having no font until the character-map loader finishes. That was about a second here.
- **Can the port know them?** Yes, from the characters alone.
  - The rule is a string that holds a surrogate, a variation selector, U+200D, U+20E3 or a code point of the emoji blocks.
  - Gecko's port already finds emoji clusters for its emoji recipe. No font fact is needed.
  - This is evidence and not proof. The mechanism could in principle catch any code point whose font search fails in a young process, and my 22 strings are a sample.
- **What leaving them out costs.**
  - On the mix 1.03 of Gecko's 117.7 asks a message hold such a character, and 0.36 of them are new to the page. On latin none do.
  - So it is under 1% of the asks: about 0.7 more calls a message on the mix.
  - This was counted under the stand-in over 3,000 messages by a scratch tally on the base tree. That script went with its scratch worktree; the numbers are in my progress log.
- **Who pays.**
  - Without the store a width taken in that second lives as long as one prepared paragraph. A page that lays out from scratch heals at the next layout.
  - With the store it answers every later message that holds the emoji, until the list is remade. The caller can't know it happened.
  - Main's store has the same exposure today.
- One more thing a stored answer doesn't follow in Firefox. I take this from the recorded probe `contexts-page-lang` and did not run it again.
  - A context whose `lang` is '' follows `<html lang>` on every call (161.73 then 186.97 px).
  - Gecko's port assigns '' for content with `lang=""` when the process languages are unknown.
  - A kept context follows the document there. A kept answer would not.

#### 3.2 A web font that loads after the list was made: the contract now binds all three engines

Probe `rebuild/tools/store-font-load-probe.ts` (new) runs the library itself with one kept list.
- `Hamburgefonstiv` four times at 48px in `"Late Amiri", monospace` at 700 px is four lines in monospace (433 px a word) and two in Amiri (328 px).
- It is laid out before the FontFace loads. After the load it is laid out with the same list and with a new one, beside the DOM's own line count.
- Both trees, three browsers: `R/probes/font-load-{base,store}-<browser>`.

| lines after the load (the DOM has 2) | kept list | new list | kept list after 200 more prepares |
|---|---|---|---|
| Chrome, base | 2 | 2 | 2 |
| Chrome, store | **4** | 2 | **4** |
| Firefox, base | 2 | 2 | 2 |
| Firefox, store | **4** | 2 | **4** |
| webkit-host, base | 4 | 2 | 4 |
| webkit-host, store | 4 | 2 | 4 |

- On the base Chrome's and Firefox's kept lists heal by themselves, as `contexts-font-load` said of the contexts. With the store they don't. The kept answers win over the healed contexts.
- The unit test says the same of the font checks. On one kept list the primary family stays the fallback after the load, and a new list names the loaded font.
- **What a page that forgets pays.**
  - It gets wrong widths and wrong font facts for every string the context had measured, for as long as the list lives.
  - In Chrome and Firefox it ends by accident when that context has taken 65,536 new strings and forgets everything. That is about 1,500 chat messages on Chrome's busiest context and about 3,800 on Firefox's. It never ends on a quiet context.
  - A string the context had not met is measured with the loaded font. So one paragraph can mix widths of both fonts.
  - In webkit-host nothing changes: the context itself was stale already.
- So "make a new list after the page's fonts change" is the contract in all three engines with the store. The list alone needs it in WebKit only.
- That was the review's reason for dropping the font checks' kept answers from item 1. This store keeps far more of the same kind.

#### 3.3 Chrome's storage partition: the contexts keep the twins apart, and the hole is the lookup itself

- **The key's equality is safe.**
  - A Map key is equal by characters, whatever the storage. Chrome's own per-canvas cache is keyed the same way.
  - That is why the port already sends a segmented paragraph's one-byte strings to `8bit` contexts and its two-byte ones to `16bit` contexts. A Map on the context inherits that separation.
  - The twin scan on the prototype's tree (`tools/twin-scan.ts`, its anchor moved to the changed call) covers 67,072 cases, of which 377 ask a forced slice.
  - **0 cases ask one context the same characters in both storages**, per case and with every case file as one page (`R/offline-proof/twin-scan.json`, `twin-scan-page.json`).
- **The hole.**
  - V8 internalizes a string used as a Map key and stores it in one byte when its units fit. It turns the looked-up string into a reference to that copy.
  - This is in the `measure/canvas.ts` header and in BLINK-STRING-STORAGE.md: "After `new Map().get(s)` the string measures as one-byte".
  - So a store that looks the measured string up hands Canvas a one-byte string where the port built a forced slice, even with a list a paragraph. It is the accident the old memo had.
  - The prototype never uses a forced slice as a key. `canvasString` gives the one-byte string it was cut from as `key`.
  - A `16bit` context is asked no one-byte string, so that key names the forced slice alone there.
- **Shown in pinned Chrome at the Canvas level, with a control.** `probes/blink-storage.ts` S5 runs the library's own module over 13 brackets under Arabic and under Latin, in both orders. It reads what each context answered.
  - On the prototype's tree all 6 checks pass. The `16bit` context answers 285.79 px (the two-byte shaping) and the `8bit` one 159.12 px.
  - The control tree's only change is that the store is keyed by the measured string itself (one line; `R/tools/CONTROL-naive-key.txt`). There 2 of 6 checks fail: the `16bit` context answers 159.12 px in both orders.
  - Files: `R/probes/storage-s5-store`, `storage-s5-naive-key`.
- **Shown on the 380 twins cases in tier 2, with the same control.** The usual predictor on the prototype's tree is a store a case (`R/tier2/chrome-twins-usual`, both orders).
  - Line count, breaks and widths pass 380 of 380.
  - Exact is 380 of 380: 0 of 2,272 predicted values and 0 of 16,090 rect counts differ.
  - There are 0 status transitions against the reference ledger, and the gate lost 0.
  - Case by case against the B1b owner's usual recording, 0 of 760 rows differ in native observation, prediction or painted lines. The recording is `b1b-20260919/chrome-no-facts`. The comparison is `lab/compare-rows.ts --prediction=without-measure`, because the store changes the counts of Canvas work by design.
- The control on the same cases (`R/tier2/chrome-twins-usual-naive-key`) exits 1.
  - Line count passes go from 380 to 315, breaks to 288, widths to 163.
  - There are 662 status transitions, 565 of them from a pass to a failure or unobserved. 88 cases go from exact to not exact.
  - 275 of 380 predictions differ from the usual recording in each order.
  - Reports: `R/tier2/compare/`.

#### 3.4 The tiers

Offline, on the prototype's tree (`R/offline-proof/`):
- Tier 1 (`replay.ts check`, all six references):
  - Firefox: 0 predictions changed. 49,856 cases are repeats only in both configurations, with 0 dropped only, 0 other and 0 new.
  - webkit-host: 0 changed, with 56,922 and 54,989 repeats only.
  - Chrome exits 1 by B1b alone:
    - 1,649 and 878 predictions changed, 18,223 and 25,143 other questions, 8,675 and 2,526 new questions.
    - All of these equal the B1b owner's own tier 1 (`b1b-20260919/tier1-a5f88a1.log`). The tables of changed predictions by field, family and ledger status are identical line for line.
    - What the store adds is 37,145 cases without facts and 37,143 with them that go from "the same" to "repeats only".
    - Asked questions of the cases that replayed go from 26.8 M to 3.74 M without facts. The distinct ones are 3,730,622 in both.
- `function-set.ts` plain, pure and sweep: 0 failures in all 18 rows (three checks, three browsers, two configurations). Chrome's plain and pure skip the 8,675 and 2,526 cases whose record lacks a question, which is B1b's.
- `tsc` is clean for the four projects.

In the browser:
- The bench page's line ranges, above, are equal on 30,000 messages at 4 widths in each browser, and with positions merged.
- The twins in tier 2 and their control are above.
- **Tier 2 with the page predictor did not run.**
  - What finished of those chains before I stopped them was three 25-case parts: Firefox smoke-hand forward and reverse, and webkit-host smoke-hand reverse.
  - 0 rows differ from the usual recordings (`cr5-merge-20260919`).
  - The full sets in both orders in the three browsers, and Chrome's shuffled order, are still to do.
  - To run them: `R/tools/chain.sh <browser>` from a clean worktree of d5730eb or later, then `R/tools/compare-parts.sh`.

### 4. What it costs the design

- **Memory.**
  - A full Map is 7 to 11 MB. A chat page in Chrome holds one or two busy ones: 11 to 18 MB at 10,000 messages of the mix.
  - Chrome's own canvas keeps its newest strings with their shaped results. DESIGN.md 4.6 puts that at tens of megabytes for a page's busiest canvas. So in Chrome the Map adds perhaps a third on top of what the kept canvas already costs, for strings Chrome mostly still has.
  - In Firefox and webkit-host nothing else grows, and the Map is the whole cost. It is about 10 MB on Firefox's mix, about 25 MB on its real set (long CJK suffixes as keys), and 2 to 4 MB in webkit-host.
- **The bound.**
  - It can't go without one: Blink's store grows by 30 to 36 strings a message for ever.
  - The hit rate falls slowly as the bound shrinks, because short strings come back within a few hundred messages. Chrome's mix still goes from 220 to 56 calls at 4,096 entries.
  - 16,384 to 65,536 a context is the flat part.
  - Past it the prototype forgets everything the context holds. That costs 7 calls a message against no bound in Chrome and nothing in webkit-host. It needs no bookkeeping per entry.
  - A least-recently-used order would buy those 7 calls at the price of a second structure per entry.
  - The bound is a tuning constant, not a fact of any engine.
- **Ink boxes.** They are worth storing in Gecko and nowhere else.
  - 45.4 of Gecko's 117.7 asks a message on the mix are ink-box questions: the ligature test's pairs in two contexts. On latin it is 26.2 of 80.2. They repeat.
  - With widths stored alone 63.4 calls a message would reach Canvas on the mix. Both Maps let 23.8 through (stand-in, 3,000 messages, the same scratch tally).
  - Chrome stored 10 ink boxes in 10,000 messages (HanKerning's single characters). WebKit asks none.
- **Chrome's relayout cost of kept ASCII paragraphs.** This is the x1.24 to x1.27 with a page's list.
  - The store gives back most of it: x0.85 on latin at a width met before, because 126 calls a layout become 19.
  - It doesn't remove it. Positions does, with 0 calls at a width met before.
- **Does it make positions' tables unnecessary?** No, the other way round.
  - Positions keeps by offset, on the prepared paragraph, what that paragraph measured.
  - That can't go stale while the paragraph is valid, it is bounded by the paragraph, and it skips building the string.
  - The store still builds every string to look it up, and past its bound it asks again.
  - From scratch they reach the same distinct questions.
- **The architecture.**
  - DESIGN.md 4.7 says the memo per context, found by string, was taken out on purpose because it was the ports' data flow. This is that memo with a longer life.
  - It sits under `measure16`, so Blink's gap raising is untouched and the plain and pure checks pass.
  - But it is again a lookup by string between the step that measured and the step that reads.
- **The classification.** It is not "invisible acceleration that can't go stale and doesn't leak". It is state with a contract.
  - It goes stale where the list alone doesn't: after a font load in Chrome and Firefox, in a Firefox process's first second for strings that hold an emoji, and in Firefox under a changed `<html lang>` for contexts without a language.
  - It doesn't leak only by a constant that is nobody's fact, at several megabytes a busy context.
  - Where none of that happens it is invisible. No line moved anywhere I could look.

### 5. Recommendation

**Leave it. If a store by string is ever wanted, build it for Gecko and WebKit only, with a prepared paragraph's lifetime (PROFILING-START item 5), and not before Firefox's fill work lands.**

The numbers that decide:
- **Chrome, the engine the question was about: x0.92 to x0.94 from scratch**, on the generator and on real text.
  - 178 of 220 calls a message go away and the time barely moves.
  - About 139 of them were repeats inside one message that Chrome's own canvas answered at 0.14 µs. The store pays a Map read of a rebuilt string for each.
  - It can't carry Chrome across 2 s.
  - For Chrome's relayout, positions does more: 0 calls at a width met before against 17 to 19. Its state can't go stale and needs no bound.
- **Firefox: x0.67 on plain ASCII, x0.84 on real text, x0.88 on the mix.** That is real, but:
  - Firefox's ASCII is already under the bar, at 0.46 s quiet by item 1's review.
  - What keeps its mix near 2.5 s is the CJK and Arabic fill, whose long suffixes never repeat. The store takes the mix's units sent only from 2,021 to 1,706 a message, and `x-perf-gecko-fill` is aimed at the rest.
  - Firefox is also the engine where a stored answer is unsound for a class of strings, shown by a run.
- **webkit-host: x0.73 to x0.82 of 0.10 to 0.18 s.** That is about 30 ms per 10,000 messages. Nothing asks for it.
- **The price:**
  - a contract that today binds WebKit alone and would bind all three engines, shown with the library in all three browsers;
  - a Firefox exposure the caller can't see;
  - a tuning constant for a bound, at 7 to 11 MB a busy context;
  - a key rule in Blink that one missed line breaks silently, shown twice with a control;
  - the return of the lookup by string that the re-architecture took out on purpose.
- The maintainer's rule is that each addition names its lifetime, what invalidates it and what bounds it.
  - This one can: the list's, the list's remaking and nothing else, 65,536 answers a Map.
  - What it can't say is that it is invisible. It is, where nothing changes under it.

What I would keep from the branch whatever is decided:
- `bench/store-page.ts` with `realism-run.ts --page=store --other-tree`: two checkouts' libraries in one document, taking turns inside every pass. On a night when no stretch was quiet it gave ratios that agreed to the third digit across two stretches 35 minutes apart.
- The two probes:
  - `tools/store-font-load-probe.ts`: the library with a kept list across a font load, beside the DOM.
  - The extension of `tools/store-stale-answer-probe.ts`: one kept context over ten seconds, every change timed.
- `tools/store-real-text.ts --page-list --bound` and `--set=bench-real`.

### 6. Files

- Branch `x-perf-store` in `~/github/pretext-rebuild-wt/perf-store`. The progress log is `.progress-store.txt` there (untracked).
- `R/counts`: browser counts of both trees, and with positions merged.
- `R/offline`: the study's method on both trees.
- `R/timed`: the two stretches.
- `R/probes`: the stale-answer runs, font-load on both trees, and storage S5 with its control.
- `R/offline-proof`: tier 1, plain, pure, sweep and both twin scans, with `exits.log`.
- `R/tier2`: the twins run, its control, the compare reports, and the folders of runs that never got slots, named `killed-*` and `never-ran-*`.
- `R/tools`: every script, the control's description, and how the base was made.
- The five scratch worktrees are removed through `git worktree remove`. They were the base, the clean run tree, the naive-key control, and positions with and without the store.
