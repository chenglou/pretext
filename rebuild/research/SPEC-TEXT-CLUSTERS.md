# What Chromium's unshipped `TextMetrics.getTextClusters()` would buy the Blink port (speculative, 2026-09-20)

Chrome is the slow engine for this library not because its `measureText` is slow but because Canvas gives only totals,
and Blink breaks lines inside whole shaped runs, so the port asks prefix after prefix to learn where clusters sit. The
maintainer wondered whether the truth was to fix the browsers instead. Chromium has already written the API that would
do it: `TextMetrics.getTextClusters()` and its siblings behind the runtime flag `ExtendedTextMetrics` (experimental, an
origin trial, off by default in Chrome 153). One agent measured what it gives and what it would buy, in the pinned
Chrome started with `--enable-blink-features=ExtendedTextMetrics`, on a branch that never merges (a shipped library
can't depend on a flag); a second agent attacked the study. The attacker's review comes first. The study's base
(afb5a63) held the first form of the 256 px cut's rework, which was later found to move lines in ligature fonts; the
comparisons here are flag on against flag off on that same base, so the ratios stand.

## What came back, and the orchestrator's reading

- **What the API gives:** where every glyph cluster sits in a shaped string and which letters it covers, as the same
  16.16 advance sums Blink's own line breaker reads before it rounds them; per whole string, across font fallback edges,
  with letter and word spacing inside; on an OffscreenCanvas and in a worker. It says nothing about safe-to-break.
- **What it buys, reproduced by the attacker:** Canvas calls a chat message from scratch 199 to 29.5 `measureText` plus
  1.9 `getTextClusters`; per relayout 129 to 15; the same lines. 10,000 messages from scratch with one list of contexts:
  1.99 to 0.70 s (×0.35); with a list a message 3.58 to 2.06 s; kept messages at three new widths 2.28 to 0.57 s. The
  safe-to-break tests are every Canvas call left in the line loop; an experiment that skips them takes 30,000 relayouts
  from about 0.6 s to 0.1 s.
- **Correctness:** of the 344 Chrome cases that main passes and the rebuild fails, 325 pass with the flag and no font
  facts (the two facts Canvas can't give today, DESIGN.md §5, are exactly what the API gives). Tier 2, forward order:
  about 134 line counts and 461 widths gained without facts; 23 of main's true passes fail with the flag (U+FFFC, which
  Canvas measures as a zero width space), 13 painter rows newly fail open, and 3 passing cases hold 9 wrong values with
  no gap: a real port on this API would have to settle those.
- **The equality holds only for strings sent the port's way,** inside one shaping run: there 464 of 535 hard-case
  clusters agree and 26 more are within 1/64 px; a plain `measureText` of several words differs, because Canvas shapes
  word by word.
- **Two bugs in the unshipped API, found by the attacker:** past 65,535 units in one item the cluster starts wrap and x
  runs backwards; the same Latin-1 text gives 14 clusters as a one-byte string and 13 as a two-byte one.
- **Firefox and Safari** have nothing like it in the pinned sources.
- **For the maintainer:** a note to Chromium was drafted and reviewed (the reviewer would not post the first draft as it
  was and wrote a corrected one). Whether to send anything, where, and in what words is theirs; the drafts are kept out
  of this public branch.

## A second look at the `getTextClusters()` study (key: clusters-attack, 2026-09-20)

**My job.** Find what is wrong with the study before it is shown to the maintainer, and before anything is said to Chromium in the maintainer's name. Nothing here merges or was pushed. Nothing was posted anywhere.

**Terms.**
- *Flag on*: the pinned Chrome 153.0.8010.50 started with `--enable-blink-features=ExtendedTextMetrics`.
- *The owner*: the agent who wrote the study.
- *Plain form*: a string as an application holds it (U+0020, a Canvas context with default settings).
- *Port form*: the string as the Blink port sends it. U+2028 stands in place of U+0020, `textRendering = 'optimizeLegibility'`, and the font is at the zoomed size.
- *LayoutUnit*: 1/64 px of the zoomed page, so 1/128 CSS px at DPR 2.
- For a cluster position beside the DOM's Range rect:
  - *agrees* means Canvas's x floored to a LayoutUnit is the DOM's number;
  - *within* means less than one LayoutUnit apart;
  - *differs* is the rest.
- My runs:
  - `.artifacts/tests/runs/spec-clusters-20260920/attack/`
  - `.artifacts/probes/spec-clusters/attack-1` and `attack-2`
- My log is `.progress-clusters-attack.txt` in the worktree.

### The short version

- **The study's central numbers all reproduce:** the counts, one timed pair plus the true base, the 344 list and the ledgers.
- **The flag was on where the owner says, and off in the bases.**
- **The equality claim needs its scope stated.**
  - A cluster's x is Canvas's own shaping of the string it was handed.
  - It is the DOM's number inside one shaping run, when the string is sent the port's way.
  - For a plain string it is not: Canvas shapes word by word.
- **Two bugs in the unshipped API were found in the browser, and they belong in any post:**
  - cluster starts wrap past 65,535 units;
  - cluster lists differ by V8 string storage.
- **Would I let the maintainer post the draft as it is? No.**
  - Its title says "exact".
  - Its "right numbers" sentence is wrong for the first string a Chromium reviewer would try.
  - One number is mis-described.
  - The safe-to-break saving comes from an experiment that is knowingly wrong for kerned pairs.
  - With the corrections in section 6, yes.

### Verdict per claim

| The owner's claim | Verdict |
|---|---|
| Canvas calls per message 199 → 29.5 plus 1.9; units 1,440 → 269; per relayout 129 → 15; lines unchanged | **Stands.** Reproduced to the digit at 84ed9ec. The true base afb5a63 asks 199.25 and 128.69 too. |
| "Flag off is today's code" | **Stands.** Same counts as afb5a63. Time is within 6% of it (×0.95 to ×1.06). |
| Time: about 45% less from scratch (0.55); 0.33 with one list of contexts; kept at three widths 3.1–3.5 s → 0.6–0.8 s | **Stands with a correction.** The owner's third stretch gives 0.66, which the report doesn't quote. Mine is 0.57 (0.60 against afb5a63). So from scratch is 34 to 45% less. One list: 0.32 to 0.35. Three widths: ×0.15 to ×0.25. |
| "Positions are the same 16.16 advance sums Blink's own line breaker reads, before it rounds them" | **Stands with a correction.** True of the code path and of port-form strings inside one shaping run. Not true of a plain string, of emoji asked at the CSS size, or of U+FFFC and tabs. Across runs the DOM snaps each fragment (section 4). |
| 325 of the 344 pass with no font facts | **Stands.** Rerun by me with the same bundle: no case differs. |
| "Main's true passes still failing: 19 and 19" | **Stands with a correction.** It is 23 in both configurations: the 19, plus the 4 U+FFFC cases that went from pass to fail, which are also true passes of main. |
| Tier 2 table, gains, two U+FFFC losses | **Stands.** Recomputed from the ledgers. Both configurations ran one bundle each, and the no-facts one equals my clean build of 84ed9ec. |
| "Nothing fails without a reported gap" | **Stands for line count, breaks and widths only.** See the painter rows and the three cases under "What the prototype did drop" in section 5. |
| "8 are the `rule/in-word-breaks` rows the known tail already names" | **Doesn't stand as written.** `tests/known-tail.json` names none of the 8 ids. Its class matches them only while they are covered by `unsafe-to-break` without facts, and they are open now. The other 5 are the ones it names by id. |
| "569 differ, almost all negative letter spacing or U+FFFC" | **Stands with a correction.** 520 are U+FFFC paragraphs (471 `rule/object-replacement`, 49 `suite/U+FFFC`). 35 sit in two `runs/split-word` cases and 5 in one `suite/partial-source-context` case. Only 9 are negative letter spacing. |
| The API says nothing of safe-to-break, and those tests are every call left in the line loop | **Stands.** 14.84 of 14.86 questions per relayout. |
| Safe-to-break experiment: "another 12 to 17% off from scratch" | **Stands only as an upper bound, and loosely.** It rests on one comparison run. With reused contexts it is 9 to 19%. With a list per message it is −13% to +1%, which is noise. The experiment skips the questions and is wrong for kerned pairs. |
| Leaves out no-advance clusters; float32 x; about 0.2 µs a cluster | **Stands.** Mine at 16px on chat-sized strings: 0.10 to 0.11 µs a cluster a call. Two calls add 22 µs to a 4.2 µs `measureText`. |
| "10 to 47 times cheaper than prefix after prefix" | **Stands with a correction.** 2.6 times at 8 units, 10 at 64, 47 at 256 (the owner's own file). |
| Side effect: "38 jobs take about 36 minutes today, 4 minutes with the flag" | **Doesn't stand.** The 2,156 s is browser-sets' wall time with lock waits (one job waited 507 s for a lock). Summed job durations: base forward (recording) 406 + 582 s; base reverse 246 + 322 s; prototype forward 136 + 112 s. That is 2.3 to 4 times. |
| Source citations | **Stand**, but `text_metrics.idl:59-67` is wrong: the file has 65 lines and the methods are at :57-64. |
| Firefox and Safari have nothing like it | **Stands.** One sentence is empty: the sparse WebKit tree has no LayoutTests, and the Chromium tree has no WPT folder. Only Gecko's `dom/canvas/test` could have held a test. The Gecko tree has no `dom/webidl`, so `TextMetrics.h` is the evidence. |
| The 70,000-unit wrap, which the owner read from source | **Confirmed in the browser** (section 4). |

### 1. Was the flag on where it counts, and off in the bases?

- **Bench runs.**
  - Every report's counting pass holds `textClusterCalls`.
  - All the owner's flag runs show 1.93 a message (5.53 for the small change). All its base runs show 0.00, with 199.25 `measureText`.
  - The reports don't record the Chrome switches, so the count is the evidence.
- **Probe runs.**
  - The owner's port probe returns an error when `getTextClusters` isn't on the prototype. All 10 of its probes ran, with 0 errors, in `text-clusters-5-final3`.
  - Its presence probes saw the methods in `text-clusters-1` and `api-presence`.
- **Tier 2.**
  - The run files don't record the switch, and the stretch log doesn't hold the command lines.
  - The evidence is indirect but strong:
    - 4,500,693 predicted values against the reference's 589,470;
    - 126 s of case time against 386 s for the same 19 forward jobs;
    - one bundle per configuration;
    - the no-facts bundle is `778f3c68823e`, the same hash my clean worktree built at 84ed9ec.
- **Lists.**
  - The flag-off runs give round 5's rows exactly (743 and 1,035 pass; 344 and 78).
  - They couldn't give that with the tables on.
- **Every launch of mine** holds a presence check that passed (`attack-1`, `attack-2`), or a `textClusterCalls` count.
- **A request for the tools.** `lab/run.ts` and `bench/run.ts` should write `--chrome-args` into their run files, so the next study can show the switch directly.

### 2. The citations, and what the study didn't read

I opened every Chromium citation at 153.0.8010.48. All hold except the IDL line numbers.

**What the owner's report doesn't say and the source does:**
- **The ShapeResult is Canvas's, not layout's.**
  - `TextMetrics::MeasureRuns` shapes through `PlainTextPainter`. One item per bidi run, then one item per word.
  - Words end at U+0020, TAB and ZWSP. Every CJK character is its own word (`plain_text_node.cc:84-155, :377-400`).
  - The exception is `!Font::CanShapeWordByWord()`.
  - Chromium's own comment says so: selection rects "are unnecessarily split due to per-word ShapeResults" (`text_metrics.cc:313-315`).
  - Layout shapes a whole run.
  - `rebuild/specs/blink-canvas.md` §1.1 items 2, 4 and 6, and §1.7, already list this, the character replacements and the per-canvas word cache.
  - The port's strings exist to get around it. The study relies on them without saying so.
- **An item's start is a float.**
  - `x_position_` is the float sum of the item widths before it (`text_metrics.cc:179-191, :222`).
  - It is rounded into 16.16 by `FromFloatRound` (`shape_result.cc:881-882`).
  - Exact below 256 px. The right-less-left trick is exact at any distance, as the owner says.
- **The flag gates bindings only.**
  - `ExtendedTextMetrics` appears in IDL files and in the features file, and in no `.cc` file of the tree.
  - So `measureText` itself is the same code with and without it.
- **Status `experimental`.**
  - `chrome://flags/#enable-experimental-web-platform-features` turns it on too (`runtime_enabled_features.json5:19-22`).
  - `origin_trial_feature_name` means a trial token can enable it. The tree can't say whether a trial is running.

### 3. Reruns

Three bench runs were queued together at 07:04, from clean detached worktrees of 84ed9ec and afb5a63 (removed since).
- Each ran as an exclusive job, with `bench/run.ts` as the lock wrapper's direct child. The reports say `lock.ours: true`.
- They started at 07:36 (flag), 07:49 (true base) and 07:52 (flag off).
- Load average: 24 to 26. The page's fixed arithmetic row: 26.7 to 28.2 ms.
- Same line totals in all three: 35,076 and 32,549.

| 10,000 messages, median of 2 passes | afb5a63 | 84ed9ec, flag off | 84ed9ec, flag on | on / off |
|---|---:|---:|---:|---:|
| mix, from scratch, a list of contexts per message | 3,402 ms | 3,583 | 2,057 | 0.57 |
| mix, one list of contexts per pass | 2,093 | 1,994 | 699 | 0.35 |
| ASCII, from scratch (one flag-on pass was an outlier: 1.66 and 2.69 s) | 2,778 | 2,942 | 2,173 | 0.74 |
| ASCII, one list | 1,809 | 1,786 | 555 | 0.31 |
| kept then 3 widths, mix, own / shared contexts | 2,636 / 2,866 | 2,276 / 2,837 | 569 / 420 | 0.25 / 0.15 |

**Counts per message (mix, from scratch), and what asked them:**

| | flag off | flag on |
|---|---:|---:|
| positions | 103.62 | 0 |
| groups before lines | 48.41 | 0 |
| other | 19.52 | 1.39 |
| safe-to-break tests | 16.93 | 16.24 |
| font checks | 10.74 | 10.74 |
| cluster tables | 0 | 1.11 |
| reshape totals | 0.03 | 0.03 |
| total `measureText` | 199.25 | 29.50 |
| `getTextClusters` | 0 | 1.93 |

**Per relayout:**

| | flag off | flag on |
|---|---:|---:|
| positions | 96.37 | 0 |
| other | 16.59 | 0.01 |
| safe-to-break tests | 15.70 | 14.84 |

**The main-only list** (no facts, flag on, 1,194 cases, 4.8 s of cases):
- 1,120 pass.
- 325 of the 344 pass.
- No uncovered failure.
- No case's status differs from the owner's run.
- Files: `attack/list-nofacts-flag`.

**Against the 2 s bar.**
- With a list of contexts per message I get 2.01 and 2.11 s at load 25.
- The owner's "about 1.8 s quiet" is fair as 1.8 to 2.0 s: at the bar, not under it.
- With one list per pass, 0.65 to 0.75 s.

### 4. Attacking the equality claim

**Probe.**
- `rebuild/probes/text-clusters-attack.ts`. The reader is `text-clusters-attack-verdicts.ts`.
- 9 probes, run twice: `attack-1`, then `attack-2` after I fixed a mistake of mine.

**What was tested.**
- Per sample: the DOM's Range rect of every cluster Canvas reports, on one line.
- 55 samples over installed fonts, plus 8 over the lab's web font fixtures.

**Port form, inside one shaping run: it holds.**
- Installed fonts: 464 agree, 26 within, 45 differ, of 535 clusters.
- Fixtures: 92 agree, 6 within, 15 differ.
- Every sample in these families agrees or is within:
  - kerning across spaces in six fonts;
  - ligatures;
  - a ligature across a plain inline box edge;
  - Arabic in Geeza Pro, SF Arabic, Amiri, Noto Naskh Arabic and Noto Nastaliq Urdu;
  - Hebrew;
  - Latin with Hebrew;
  - brackets in RTL;
  - font fallback edges: CJK, a mark the font lacks, Arabic in a Latin font, symbols;
  - emoji ZWJ sequences, flags, skin tones, keycaps, text presentation and a broken ZWJ, at 32px;
  - marks on a space, on U+00A0, at the start of the string, and in Arabic;
  - CJK punctuation in three fonts;
  - Thai and Devanagari;
  - soft hyphen, ZWSP, U+2060, ZWNJ and ZWJ;
  - `system-ui`;
  - 9.5px text.
- **All 45 that differ are explained, and none is the API's fault:**
  - A box with padding, border or margin breaks the shaping run: 10.
  - Another font size inside the word: 2.
  - The DOM snaps every text fragment to a LayoutUnit, so positions after inline box edges and bidi runs drift by one or two steps: 2 + 6 (3 more in the fixtures).
  - My probe doesn't add the DOM's letter or word spacing on U+2028, as the port does: 11 + 5 (12 more in the fixtures).
  - Emoji asked at the CSS size: 3.
  - TAB and U+FFFC: 6.

**Plain form: it doesn't hold, and this is what a reviewer would try first.**
- The string is `AV To We. V, A Y o`.
- 16 of 18 positions differ from the DOM in Times New Roman (total 262.45 against 254.23 px), in Avenir Next and in Hoefler Text.
- Canvas shapes word by word, so kerning against the space is lost.
- The same string in port form agrees at 18 of 18.
- That is `measureText`'s long-standing behaviour, not this API's. But the draft's "the positions are the right numbers" has to say which strings.

**Emoji below the zoomed size.**
- At 13px Canvas gives an emoji cluster 16 px and the DOM gives 13 px. That is the known macOS emoji difference.
- Asked at the zoomed 26px, as the port asks, 5 of 5 agree.

**U+FFFC.**
- Canvas's cluster for `d` plus U+FFFC is 16 px. The DOM's is 48 px.
- Canvas turns U+FFFC into ZWSP before shaping (`plain_text_node.cc` Normalize).
- That is the 14 of the 19 cases left, and 520 of the 569 differing values. No cluster API can see it.

**String storage: `getTextClusters` answers by it too.**
- The shaping follows `measureText`.
  - `)`×15 in Amiri 48px is 183.60 px as a one-byte string and 329.76 px as a two-byte one.
  - The clusters sit accordingly.
  - A canvas's first shaping answers both storages.
- The walk also differs by storage.
  - `abcdef` U+0000 `ghijklm` gives 14 clusters as a one-byte string: U+0000 is reported with advance 0.
  - It gives 13 as a two-byte string: U+0000 is left out.
  - The same holds for U+007F in every font tried, and for U+0008 in most.
  - Source: `shape_result.cc:925-929` against `:943-944`.
- Script can't read a string's storage.
  - In practice only control characters are hit.
  - SHY, ZWSP and U+FFFC make the string 16-bit anyway.

**One-byte strings walked glyph by glyph.**
- I looked for clusters that share a start or are empty.
- Every Latin-1 character in 35 fonts: none found. Zapfino's one odd row is a ligature.

**A long item: confirmed bug.**
- One item of 70,000 units, one-byte or two-byte:
  - the largest start reported is 65,535;
  - 69,997 of 69,999 clusters are wrong;
  - 3,712 x values go backwards;
  - empty clusters like `[1,1)` appear.
- 60,000 units is fine.
- Cause: `uint16_t` indices in `ForEachGraphemeClusters` (`shape_result.cc:895-903`).
- A font Canvas shapes whole, or the port's U+2028 strings, reaches this on a long paragraph.
- The prototype's "one table per group at any length" has no guard for it.

**Float32.**
- Every x is a float32.
- Right less left is a multiple of 1/65536 at every cluster, up to 20,728 px.
- In Helvetica Neue 16px, x leaves the exact sum from cluster 34 on, at about 256 px. In Times New Roman 16px it never does up to 5,775 px, because its advances are coarser.
- The owner's two-call trick is right.
- A side finding: the DOM's Range rects themselves drift from the exact sums at long distances (1,512 of 2,760 agree past 16,000 px). So Range rects aren't an oracle to the last LayoutUnit out there.

**Cost at chat size** (16px, 110 units, distinct strings, load 25):

| | µs per string |
|---|---:|
| `measureText` alone | 4.2 |
| with one `getTextClusters`, read | 16.1 |
| with two calls, read | 26.1 |

- Most chat groups pass 256 px and pay for two calls.
- That is about 24 µs of the prototype's 44 to 51 µs of prepare per message. The owner's estimate was right.

### 5. Is the headline honest?

**Yes. The gain is the API's.**
- The 170 questions a message that went were:
  - position questions: 103.6;
  - the pieces measured before lines: 48.4;
  - questions the limits and gaps asked about positions: 18.1.
- Safe-to-break tests went from 16.93 to 16.24. None was skipped. The few questions fewer are position reads inside the tests.
- Lines are identical in every bench run.
- In tier 2, line-count passes go up by 132 without facts and by 69 with them.
- The share of wrong predicted values falls from 0.045% to 0.013%, while 7.6 times as many values are predicted.

**What the prototype did drop by accident, all small and all reported by the owner except the first:**
- **Painter rows that lost their cover.** 13 without facts, 8 with.
  - Their predictions pass and are exact.
  - The `unsafe-to-break` gap that used to cover the painter's own limit is no longer raised.
  - The painter reports nothing of its own.
- **3 passing cases with wrong values and no gap.**
  - `suite/terminal-spacing`: `a` U+0000 ` b` under −4px letter spacing.
  - They now hold 9 wrong values.
  - This is the no-advance rule of thumb meeting the storage difference above.
- **U+FFFC.**
  - 2 tier-2 cases and 4 list cases are lost.
  - 387 more values are wrong without facts. The facts configuration already had them wrong: it is in the known tail.

### 6. The draft, read as its hardest reviewer would

(The drafts of a note to Chromium are kept out of the public branch until the maintainer decides about them. The review's points on the draft that are about facts are in the verdicts above.)

### 7. What is in the branch, and what I ran

- **Branch.** `x-spec-text-clusters` in `/Users/chenglou/github/pretext-rebuild-wt/spec-clusters`. Two commits of mine on top of the owner's 15 (17 over afb5a63). Nothing pushed, nothing merged. The owner's files are untouched.
- **Files added:**
  - `/Users/chenglou/github/pretext-rebuild-wt/spec-clusters/rebuild/probes/text-clusters-attack.ts`
  - `/Users/chenglou/github/pretext-rebuild-wt/spec-clusters/rebuild/probes/text-clusters-attack-verdicts.ts`
- **Browser jobs.**
  - 3 bench runs, 2 probe runs and 1 list run.
  - All exited 0. None was rerun unchanged.
- **Offline.**
  - `tsc` is clean (rebuild and probes).
  - The 153 unit tests of `engines/blink` and `measure` pass at 84ed9ec.
- **Cleanup.**
  - Both temporary worktrees were removed with `git worktree remove`.
  - No process of mine runs.

## What Chrome's unshipped `getTextClusters()` would buy Pretext (2026-09-20)

This is a speculative study. Nothing here merges, because a shipped library can't depend on a flag.

**Terms.**
- A *question* is one `measureText` call.
- A *message* is one chat message of `rebuild/bench`. "Mix" is the bench's mix of message kinds; "ASCII" is its printable-ASCII set.
- A *shaping group* is the text Blink shapes in one HarfBuzz call.
- A *glyph cluster* is the smallest group of letters and glyphs that shaping doesn't split.
- A *LayoutUnit* is 1/64 px.
- *Flag on* means the pinned Chrome 153.0.8010.50 started with `--enable-blink-features=ExtendedTextMetrics`. *Flag off* is the same build without the switch.
- The *run folder* is `.artifacts/tests/runs/spec-clusters-20260920/`. Probe output is under `.artifacts/probes/spec-clusters/`.

**The short version.**
- The API gives the two facts Canvas can't give today: which letters a cluster covers, and which glyph of a kerned pair carries the adjustment. It gives them as the numbers Blink's own line breaker uses.
- Reading one table per shaping group in place of prefix after prefix takes a chat message from 199 questions to 29.5.
- With a page's list of Canvas contexts, 10,000 messages take about 0.75 s, against about 2 s for today's code the same way.
- 325 of the 344 cases that main passes and the rebuild fails now pass, with no font facts.
- The API says nothing about safe-to-break. That is every question left in the line loop.

### 1. What the API gives, exactly

Source: Chromium 153.0.8010.48, paths under `third_party/blink/renderer/`. Probe: `rebuild/probes/text-clusters.ts`, run with the flag on, at DPR 2. Output: `text-clusters-1/chrome-probes.json` for the API itself, `text-clusters-5-final3/` for the port comparison.

**Where it is.**
- `TextMetrics.getTextClusters(options?)` and `getTextClusters(start, end, options?)` return `TextCluster` objects with `x`, `y`, `start`, `end`, `align` and `baseline` (`core/html/canvas/text_metrics.idl:59-67`, `text_cluster.idl`).
- Beside them are `getSelectionRects`, `getActualBoundingBox`, `getIndexFromOffset`, and `fillTextCluster` / `strokeTextCluster` on the context (`modules/canvas/canvas2d/base_rendering_context_2d.idl:19-22`).
- All of them sit behind one runtime flag, `ExtendedTextMetrics`. Its status is experimental, and it is an origin trial of the same name that allows third parties (`platform/runtime_enabled_features.json5:2745-2749`).
- Both interfaces are `Exposed=(Window,Worker)`.
- The probe found the methods on the prototype. It got the same clusters from a main-thread OffscreenCanvas, a connected `<canvas>` and an OffscreenCanvas in a worker (5 of 5 checks).
- `rebuild/probes/textmetrics-api.ts` with the flag agrees (`api-presence/`). Without the flag none of these methods exist.

**The numbers are the line breaker's own, before it rounds them.**
- `measureText` shapes the string through `PlainTextPainter::SegmentAndShape`. It keeps one record per shaped item, and an item's x is the float sum of the items before it (`text_metrics.cc:172-225`).
- `getTextClusters` walks each item's `ShapeResult` with `ForEachGraphemeClusters`. It keeps each cluster's first character and the advance sum before it (`text_metrics.cc:496-512`).
- That sum is an `InlineLayoutUnit` adding up `glyph_data.advance` (`platform/fonts/shaping/shape_result.cc:881-882, :914, :929, :948`). Both are 16.16 fixed point (`platform/geometry/layout_unit.h:473-475`).
- The DOM's line breaker reads `ShapeResult::ComputePositionData`. That is the same sum of the same advances, followed by `ToCeil<LayoutUnit>()` (`shape_result.cc:2112-2175`).
- So a cluster's `x` is the DOM's position before that ceiling.
- The callback hands the sum over as a float32 (`shape_result.h:127-132`). So `x` is exact to 1/65536 px only below 256 px.
- `TextCluster.x` is a double, and the alignment offset is added in doubles (`text_cluster.h:59`, `text_cluster.cc:44-47`, `text_metrics.cc:534-539`).
- That means `x` asked with `{ align: 'right' }`, less `x` asked with `{ align: 'left' }`, is the cluster's own advance, exact at any distance.
- Two calls therefore give exact advances for a string of any length. That removes the port's 256 px limit.

**Per whole string, in one coordinate.**
- A `ShapeResult` holds one run per font and script, and the sum runs on across them (`shape_result.cc:883`). A font fallback edge restarts nothing.
- Probe `fallback-edge` confirms it: Latin, Chinese and Japanese glyphs come back on one axis.

**Letter spacing and word spacing are inside the positions.**
- Canvas applies `ShapeResultSpacing` to every item (`platform/fonts/plain_text_node.cc:403-425`).
- Probe: 3px of letter spacing moves every later x by 3px per cluster. 10px of word spacing sits on U+0020's advance.
- U+2028, which the port sends in place of U+0020, takes no word spacing (150 px against 130 px). The port already assumes this.

**RTL and bidi.**
- Items come in visual order. Clusters are sorted by `start` inside an item (`plain_text_node.cc:304-352, :393-397`; `text_metrics.cc:514-517`).
- `x` is the cluster's left edge, less the alignment point.
- In a context with `direction: rtl` and the default `textAlign`, the alignment point is the string's right end (`text_metrics.cc:113-126`). Every x is negative there.
- Only differences between x values mean anything to a caller.

**Ligatures, marks, emoji.**
- `office` in Hoefler Text gives one cluster, `start` 1 and `end` 4, for `ffi`, at the ligature's left edge.
- Nothing is said about positions inside the ligature. The DOM splits its advance in three for carets.
- Blink counts the graphemes inside a cluster at `shape_result.cc:939-942`, and TextMetrics drops the count at `text_metrics.cc:502-511`.
- Under letter spacing the ligature doesn't form.
- Combining marks, Thai marks, Devanagari conjuncts, an emoji ZWJ family, a flag, a skin-tone pair, and heart plus U+FE0F each come back as one cluster.

**Three things a caller has to know.**
1. A one-byte string (Latin-1 only) is walked glyph by glyph. A two-byte string is walked by HarfBuzz cluster (`shape_result.cc:925-929` against `:930-952`).
2. In a two-byte string, a cluster with no advance is left out (`shape_result.cc:943-944`).
   - The probe: soft hyphen, U+2060, U+200B and a leading U+200D are never reported.
   - Their offsets fall inside the cluster before them, while the DOM puts them at the next cluster's start.
   - A caller can't tell a dropped cluster from a character that went into a ligature.
   - The prototype decides by the character: default-ignorable, control or U+FFFC, and not a HarfBuzz continuation. That is a rule of thumb, which tier 2's exact values check against the DOM.
3. Character indices inside `ForEachGraphemeClusters` are `uint16_t` (`shape_result.cc:895-903`). An item past 65,535 units would wrap.

**Nothing about safe-to-break.**
- Blink keeps HarfBuzz's unsafe-to-break flag on every glyph (`glyph_data.h:50, :71`).
- Its line breaker reads that flag right next to the position (`shape_result.cc:2173-2174`).
- The cluster callback has no parameter for it, and `TextCluster` has no member for it.

**Does one call replace the pair, wide-window and no-ligature questions?**
- For positions, yes. Those questions exist to guess, from totals of cut strings, how shaping moved the advances before an offset.
- The table holds those advances themselves.
- For the safe-to-break tests, no. They still ask for totals.

**The port's positions against the API's.** 3,000 distinct paragraphs, drawn in turn from every family of the tier case files. The same library bundle was loaded once with the method hidden and once with it. Library 84ed9ec, `text-clusters-5-final3/summary.json`.

| | with font facts | without |
|---|---:|---:|
| cluster boundaries inside shaping groups | 34,819 | 34,863 |
| told by a table | 34,019 | 34,062 |
| port's position equal to the API's to the last bit | 33,543 (98.6%) | 33,408 (98.1%) |
| differ by less than 1/64 px | 0 | 0 |
| differ by 1/64 px or more | 476 | 654 |

- There is no middle class. The port is exact, or it is off by a whole kern or glyph.
- The differences are of three kinds:
  - kerned pairs whose placement the port guesses;
  - ligatures the port doesn't know, such as Geeza Pro's lam-lam-heh, 417 to 1,665 LayoutUnits off;
  - contextual Arabic forms.
- In the first build's run (`text-clusters-2`), the port and the API disagreed on whether a cluster starts at 79 of 40,332 units with facts, and at 123 without.
- Calls for the same positions, with facts: 169,545 `measureText` before. After: 15,801 `measureText` plus 5,314 `getTextClusters`.

**Against the DOM's Range rects.** 1,268 paragraphs of one text leaf in one LTR group, 13,035 boundaries. The DOM floors a range's start to a LayoutUnit.
- The API's position floors to the DOM's value at 12,987 boundaries. It is within 1/64 px at 4 more and differs at 44.
- Of the 44:
  - 29 are under a negative letter spacing, where a rect's left edge isn't the cluster's start.
  - 6 are U+FFFC, which Canvas measures as a zero width space.
  - The rest are small differences the port shares.
- The port with facts also differs at 44.
- Without facts the API differs at 58. About 16 of those are offsets inside a real ligature, where the DOM's rect is an interpolation. The port without facts differs at 110.

**What a call costs.** Probe `api/cost`: 4,000 distinct strings per loop, Helvetica Neue 32px. The load average was 41 from other jobs, so read the ratios.

| length, one Canvas word | `measureText` alone, first ask | with `getTextClusters` | repeat, alone | repeat, with clusters | a prefix per boundary, as today |
|---:|---:|---:|---:|---:|---:|
| 8 | 2.0 µs | 3.9 µs | 0.65 µs | 2.2 µs | 10 µs |
| 64 | 6.0 µs | 22.4 µs | 0.75 µs | 12.7 µs | 234 µs |
| 256 | 20 µs | 61 µs | 1.25 µs | 46 µs | 2,849 µs |

- A call costs about 0.2 µs per cluster, and nothing is kept between calls.
- Each call builds one garbage-collected `TextCluster` per cluster (`text_cluster.h:58-65`).
- That is two to three times a first `measureText`, and 10 to 47 times cheaper than prefix after prefix.

### 2. What it would buy

**The prototype.**
- Everything is behind one feature test, `hasTextClusters` in `rebuild/src/measure/canvas.ts`: `'getTextClusters' in TextMetrics.prototype`.
- The change is 261 lines added and 16 removed, in 7 library files. Most of it is `clusterTable` in `engines/blink/shape.ts`.
- With the flag off, the build reproduces round 5's main-only list numbers exactly (section 3). So flag off is today's library.

- *The small change* (81cb2ff, 788f5ae).
  - A measured piece of a group, and a reshaped line edge, each get one table of the advance sums before their clusters.
  - The table is made when a position inside is first asked.
  - `groupPrefix16` and `callPrefix16` read it.
  - The pieces, the adjustment at each cut, and the safe-to-break tests all stay as they are.
- *The full change* (d64951b, a815a99).
  - One table per shaping group, at any length, made in `prepare`.
  - A string of 256 px or more is asked a second time with the other alignment, which gives exact advances.
  - Nothing is measured in pieces.
  - Which units start a cluster is read from the table everywhere: `isClusterBoundary`, and the clusters a line lists.
  - The cuts remain only to bound the windows of the safe-to-break tests. They are found from the table without asking Canvas.
- *Fixes on top of the full change*, found by the probe, the list and tier 2: 274503d, aea03f6, 9386ada, 50e291f, 6fd1baf, 84ed9ec.
- *Gaps.*
  - A position the table told drops the gaps that were about the position alone: `positionLimit`, `pairPlacementUnknown`, and the attribution and ligature gaps of a line edge.
  - What a measured string can't vouch for is still raised where it is measured.
  - Every gap of the safe-to-break tests stays.
  - A table is dropped, and the port's old rules answer, in two cases:
    - the measured string leaves a character out;
    - a Canvas cluster runs on past a character the string replaced with U+2060.
  - Example: `f` SHY `fi` is one `ffi` cluster in Shantell Sans's Canvas string, and three clusters natively.
- *Lifetimes.*
  - A group's table is made in `prepare` and kept by the prepared paragraph.
  - A reshape's table lives on the reshape.
  - Nothing is found by a string.

**Canvas calls.** Counting pass over 200 messages, the same build with the flag off and on. Counts don't depend on load. Files in the run folder: `bench-counts-A-{noflag,flag}`, `timed-s1-{1-noflag,2-flag}`, `bench-counts-final-flag`.

| per message, from scratch | today | the small change | the full change |
|---|---:|---:|---:|
| `measureText` calls, mix | 199.3 | 103.4 | 29.5 |
| `getTextClusters` calls, mix | 0 | 5.5 | 1.9 |
| UTF-16 units sent, mix | 1,440 | 1,167 | 269 |
| `measureText` (+clusters), ASCII | 193.6 | 99.6 (+5.8) | 24.5 (+1.7) |
| font checks / groups before lines / filling lines, mix | 10.7 / 49.8 / 138.7 | 10.7 / 49.8 / 42.9 | 10.7 / 2.5 / 16.3 |
| the lab's inspected path, mix | 1,571 | 294 | 70.7 |

| per layout of a kept paragraph | today | small | full |
|---|---:|---:|---:|
| new width, mix / ASCII | 128.7 / 123.6 | 36.4 / 31.8 | 14.9 / 12.3 |
| width met before | 128.7 / 123.6 | 35.6 / 31.1 | 14.8 / 12.3 |
| units sent, mix | 519 | 216 | 56 |

- The lines are the same in every run, flag on and off:
  - 654 and 639 line boxes at 320 px;
  - 1,856 and 1,824 at the three other widths;
  - 35,076 and 32,549 over 10,000 messages.
- The bench's check that the plain, pieces and inspected modes give the same line ranges holds in every flag run.

What asks the 29.5 questions that are left (call stacks were read in the counting pass):
- 16.2 safe-to-break tests
- 10.7 runtime font checks
- 1.1 the tables' own `measureText`
- 1.4 other
- 0.03 reshape totals

At another width, all 14.9 are safe-to-break tests.

**Time.**
- Setup: exclusive lock; the flag off and on taking turns in one build; 2 headline passes per run; AC power; background window.
- Two things fell short of the timing rule:
  - Other agents' offline jobs kept the 1-minute load average at 33 to 102 through every stretch.
  - A run took about 3.4 minutes under that load, so a stretch under 12 minutes held three runs. The three pairs are spread over stretches run in opposite orders: `timed-s1` (off-on-off) and `timed-s2` (on-off-on). `timed-s4` holds small-off-full.
- The page's fixed arithmetic row stayed at 26.5 to 32.6 ms.
- Stretches s1 and s2 timed a815a99. Stretch s4 timed 788f5ae and 50e291f. The later fixes change nothing that chat text asks.

| 10,000 messages, median of a run's 2 passes, ms | flag off | flag on, full change | ratio by stretch |
|---|---|---|---|
| mix, from scratch, a list of contexts per message | 3,230 · 4,033 · 4,264 · 3,357 | 1,985 · 2,273 · 2,387 · 2,232 | 0.55, 0.55 |
| mix, one list of contexts per pass | 1,989 · 2,519 · 2,611 · 2,086 | 727 · 909 · 880 · 702 | 0.32, 0.34 |
| ASCII, a list per message | 2,650 · 3,375 · 3,038 | 1,689 · 1,794 · 2,087 · 1,619 | |
| ASCII, one list per pass | 1,768 · 2,106 · 1,935 · 1,773 | 587 · 643 · 629 · 552 | |
| kept, then 3 widths (30,000 layouts), mix, own / shared contexts | 3,114 · 3,523 · 3,227 / 2,880 · 3,424 · 2,889 | 586 · 784 · 749 / 445 · 469 · 505 | |
| main's cold batch, same pages, mix | 334 to 475 | 335 to 463 | |

- The small change, one run in s4:
  - mix: 2,868 ms from scratch, 1,629 with one list;
  - kept then 3 widths: 1,050 ms;
  - the flag-off run beside it: 3,357, 2,086 and 2,951.

**Where Chrome lands against 2 s.**
- With a list of contexts per message, which is the headline's setup:
  - 2.0 to 2.4 s here, against 3.2 to 4.3 s for today's code in the same stretches.
  - By the ratio and the quiet-machine 3.24 s (PROFILING-START item 6), that is about 1.8 s on a quiet machine: at the bar.
- With one list of contexts per pass, which `prepare` already takes:
  - 0.70 to 0.91 s on the mix and 0.55 to 0.64 s on ASCII, under load.
  - Today's code the same way takes about 2.0 to 2.6 s.
  - That is well under the bar, and about twice main's cold batch.

**What is left, in order.** From the instrumented pass with one list, per message on the mix: font checks 8 µs, prepare 44 to 51 µs, filling lines 19 to 20 µs.
1. *Prepare.*
   - 2.5 `measureText` calls and 1.9 `getTextClusters` calls.
   - At about 0.2 µs per cluster, the API's own object building is likely 20 to 25 µs of the ~50. That makes it the largest single item.
2. *The safe-to-break tests.*
   - Experiment, measuring time only: `safe-experiment.patch` in the run folder, never committed. The tests' Canvas questions are skipped where a table told the group. The bench's line totals came out the same.
   - One list per pass, mix: 671 and 618 ms, against 736 in the same stretch.
   - One list per pass, ASCII: 459 and 484 ms, against 566.
   - 30,000 relayouts, own contexts: 104 and 106 ms, against 631.
   - 30,000 relayouts, shared contexts: 93 and 94 ms, against 433.
   - Questions per relayout: 0.01.
   - Files: `timed-s3-*`.
3. *The font checks*, 10.7 questions per message. That is profiling item 1, not this study.
4. *Contexts.* A list per message costs about 1.2 to 1.4 s per 10,000 messages, flag on or off.

**A side effect.**
- With the flag on, the lab's 67,065 cases ran in both configurations, 38 browser jobs, in about 4 minutes inside one exclusive stretch.
- A run of 38 jobs over the same cases takes about 36 minutes today (2,156 s, b1b-20260919).
- The inspected path asks 22 times less.

### 3. Correctness

**Tier 2, both configurations, forward order only.**
- Forward order only is enough for a speculative study. Such a run carries the reference's history-dependent cases and can't find new ones.
- Library 84ed9ec, one bundle per configuration, flag on, against the frozen reference ledgers.
- How it ran:
  - Slot jobs starved all night behind back-to-back exclusive stretches. The first attempt started 0 of 19 jobs in 38 minutes.
  - So the 38 forward jobs ran inside one exclusive stretch of mine, three at a time. Each job used exactly the command line `browser-sets.ts` starts.
  - `browser-sets.ts` then found the jobs done. It did its own scoring, ledger, transitions and gate offline.
- Files: logs `chrome-{no-facts,facts}-final3.log`, ledgers `chrome-*-final3/ledger`.

| 67,065 cases | no facts: reference | no facts: prototype | facts: reference | facts: prototype |
|---|---:|---:|---:|---:|
| line count passes | 66,722 | 66,854 | 66,786 | 66,855 |
| breaks pass | 66,652 | 66,821 | 66,749 | 66,822 |
| widths pass | 63,193 | 63,654 | 63,579 | 63,655 |
| painter passes | 60,473 | 60,640 | 60,609 | 60,640 |
| exact cases | 66,251 | 66,412 | 66,347 | 66,413 |
| predicted values the scorer compared | 589,470 | 4,500,693 | 3,591,716 | 5,026,552 |
| of them differing from the browser | 265 | 569 | 551 | 570 |
| rect counts differing | 991 | 695 | 868 | 688 |
| stand-in values differing (never blocking) | 149,308 | 2,701 | 108,909 | 2,688 |
| status transitions / from a pass | | 2,197 / 60 | | 650 / 6 |

- *Gained.*
  - Without facts: 134 line counts, 171 breaks and 461 widths. Of the widths, 290 came from a covered failure and 171 from unobserved.
  - With facts: 71 line counts, 75 breaks and 76 widths.
- *The configurations meet.* 66,660 of 67,065 cases now have the same statuses with the lab's font facts and without them. In the references that number is 66,039.
- *Exact values.*
  - 7.6 times as many values are predicted instead of stand-ins without facts. With facts it is 1.4 times as many.
  - 171 cases became exact without facts, 75 with.
  - 10 stopped being exact without facts, 9 with:
    - 6 are U+FFFC;
    - 3 are `suite/terminal-spacing` under a negative letter spacing;
    - 1 more fails without facts only.
  - The ledger tool's stricter count is 150 cases without facts and 27 with. It counts "exact to not exact, or more differing values than before". Most of those cases weren't exact before and now have more of their values compared.
- *Lost.*
  - Only 2 cases, in both configurations: `ب` SHY `ب` U+FFFC `ب` at 11 to 12 px.
  - They fail under gaps the layout reports (`font-fallback`, `script-context`), because Canvas measures U+FFFC as a zero width space.
  - They make the gate exit 1.
  - Nothing fails without a reported gap.
- *The painter.*
  - Without facts, 56 painted lines go from pass to a covered failure.
    - 54 of them are `rule/text-align` cases, which fail under the same painter limits in the facts reference.
    - The prediction now puts the kern where the browser does, and the painter can't draw that line by line.
  - 13 go from covered to open:
    - 8 are the `rule/in-word-breaks` rows the known tail already names;
    - 5 are already open in the facts reference.

**What the earlier runs found.** The exact-value status exists to catch defects like these:
- a negative advance sum read as "untold";
- U+200C after a space, and U+200D at an emoji segment's edge, which start a HarfBuzz cluster of no advance (216 cases);
- two soft-hyphen ligature cases that failed with no gap over them.

All are fixed in the run above. The earlier logs are `chrome-*-B.log`, `-final.log` and `-final2.log`.

**The 344.** The main-only Chrome list has 1,194 cases. It ran as one forward job per configuration, scored by `lab/score.ts` and counted by MAIN-PASSES-REFRESH's rules. Folders: `list-*` in the run folder. The flag-off runs were taken at 274503d, the flag-on runs at 84ed9ec.

| | no facts | facts |
|---|---:|---:|
| flag off: cases passing | 743 | 1,035 |
| main's true passes it fails | 344 | 78 |
| flag on: cases passing | 1,120 | 1,124 |
| main's true passes still failing | 19 | 19 |

- With the flag off, the build gives round 5's rows exactly.
- With the flag on, 325 of the 344 pass without any font fact. Round 5 estimated the two facts, if supplied, would pass 266.
- By MAIN-PASSES-REFRESH's causes, these now pass:
  - all 245 ligature clusters;
  - all 54 U+2060 cases;
  - all 10 joined letters at overflow;
  - 11 of 12 Latin kerning cases;
  - 3 of 5 script-context cases.
- The 19 left:
  - 14 U+FFFC;
  - 2 Common characters in an RTL context;
  - 2 "other";
  - 1 Latin ligature.
- No failure is without a gap.
- 4 cases go from pass to fail in each configuration, all in the U+FFFC family.

**What was built for the two facts.**
- "Which letters one cluster covers" is `BlinkPrepared.clusterStarts`. It is written from the tables in `prepare` and read by `isClusterBoundary`.
- "Which glyph carries the adjustment" needs nothing built. A position read from the table has the adjustment where shaping put it.

### 4. The case for shipping it

(A draft note was written and reviewed; it is kept out of the public branch until the maintainer decides about it. Nothing has been posted anywhere.)

### 5. Firefox and Safari

- Neither has anything like it in the pinned sources.
- **Gecko.**
  - `TextMetrics` is twelve doubles and nothing else (`firefox-156.0/dom/canvas/TextMetrics.h:15-83`).
  - Four prefs gate groups of those doubles (`modules/libpref/init/StaticPrefList.yaml:5547-5562`).
  - `getTextClusters`, `TextCluster`, `getSelectionRects` and `getIndexFromOffset` appear nowhere under `dom/` or `gfx/`.
- **WebKit.**
  - The IDL is the same twelve doubles (`webkit-7625.1.29.11.27/Source/WebCore/html/TextMetrics.idl:27-45`).
  - There is no match for those names in `Source/WebCore`.
- Neither tree's canvas tests hold a tentative test for them.
- So "find those hot spots in Chromium and Firefox" splits in two:
  - Chromium has written the fix and not shipped it.
  - For Firefox there is nothing to ask to ship, only something to propose. Firefox's cost sits elsewhere anyway: the CJK and Arabic fill (profiling item 3).
- Safari is already far under the bar.

### 6. What is in the branch, and how to run it again

- Branch `x-spec-text-clusters` in `/Users/chenglou/github/pretext-rebuild-wt/spec-clusters`: 15 commits over afb5a63. Nothing pushed, nothing merged.
- No tracked document was changed, on purpose.
- To see it work: run any lab, bench or probe command with `--chrome-args=--enable-blink-features=ExtendedTextMetrics`.
  - The pass-through was added to `lab/run.ts`, `bench/run.ts` and `tests/browser-sets.ts`.
  - It is not part of a set's protocol.
- Runs:
  - the run folder holds the bench reports, the lists, tier 2, the stretch logs and `safe-experiment.patch`;
  - `.artifacts/probes/spec-clusters/` holds the probe output, and each port run has a `summary.json`.
- My running log is `.progress-clusters.txt` in the worktree, untracked, with `.notes-clusters.txt` beside it.
- Offline:
  - `tsc` is clean, and the 153 unit tests of `engines/blink` and `measure` pass.
  - Offline the feature test is false, so tier 1 and the function-set checks see today's code. I did not take a turn in the gates' queue.
  - A scratch stand-in Canvas with its own `getTextClusters` gave the same lines and geometry with and without the tables on 1,200 lab cases, before any browser time was spent.
- Every temporary worktree was removed with `git worktree remove`.
- Rows of superseded runs were removed. Rows of the reported runs are zstd-compressed.
