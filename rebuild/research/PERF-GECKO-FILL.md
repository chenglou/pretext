# Profiling items 3 and 8: windows inside Gecko's long shaping units, and the plain scan in its simple form (2026-09-19 and 20)

Built on branch `x-perf-gecko-fill`, attacked by a second agent who found and fixed one class, and merged on
2026-09-20. The attacker's review comes first.

## What came back, and the orchestrator's reading

- **Firefox's chat mix: 2,559 to 1,037 ms per 10,000 messages from scratch** (quiet machine, three alternating pairs;
  the attacker's own in-page probe: 2,654 to 1,125 ms); plain ASCII unchanged (597 to 582 ms). A CJK message went from
  2,492 to 493 µs and from 23,499 to 2,944 UTF-16 units sent to Canvas. One Chinese unit of 9,428 units sends 0.23 M
  units where it sent 41.7 M (about 11 s to about 0.1 s). The cost was CJK, not Arabic: Arabic has spaces.
- **The cut rule is Canvas's own answer and names no script.** Gecko shapes a word of any length in one call, so no cut
  is exact by the source. A cut holds when no letters join across it, no mark starts its cluster, the two cells beside
  it measured alone add up to the two measured together, the pair of clusters around it has one ink box with and without
  ligatures, and the ligature group counts agree; windows must add up to the unit or the unit keeps the long recipe. In
  Firefox 13,435 of 14,943 tried cuts hold, and every one equals the long recipe, as do all 14,040 offsets inside
  windows.
- **The class the attacker found:** a right-to-left script's unit in a left-to-right run: Canvas shapes a digits-only
  window unreversed where the DOM's unit is reversed (32 advances and one native break differed). Such a unit gets no
  windows now. No tier case is of that kind.
- **Correctness did not move:** both orders and configurations, 0 status transitions; 39 cases differ from the reference
  recording in one number inside an `in-word-prefix` gap's detail text.
- **Item 8, settled by time:** the lazy plain scan bought about 40 ms per 10,000 messages (6 to 7% of plain ASCII; 26 ms
  with item 3 in) and the simple form costs 8 to 9 more questions a message, not the 31 the documents carried. The
  orchestrator took the simple form: the most intricate part of the Gecko port is gone.

## Review of Gecko's windows inside long units (profiling item 3) and the lazy plain scan's trade (item 8)

Branch `x-perf-gecko-fill`, worktree `/Users/chenglou/github/pretext-rebuild-wt/perf-gecko-fill`, head a6bb99a. There are 10 commits of mine on the owner's 65f2abd. Nothing is merged or pushed.

Paths below are under `/Users/chenglou/github/pretext-rebuild/.artifacts` unless they start with `rebuild/`. My run folders:
- `probes/perf-gecko-fill-20260919/attack`
- `tests/runs/perf-gecko-fill-20260919/attack`
- `bench/perf-gecko-fill-20260919/attack`

My running log is `.progress-gecko-fill-attack.txt` in the worktree.

Words used:
- **base** is b2d9050, the library without windows.
- **item3** is 0edcd64, windows with the lazy plain scan.
- **simple** is 65f2abd, windows with the lazy scan taken out.
- **fix** is simple plus my guard.
- A **stand-in** is an advance Canvas can't confirm, reported under the `in-word-prefix` gap.

### 1. What I confirm, and what I don't

| claim | verdict | how |
|---|---|---|
| counts per message and for the long unit | confirmed, every count equal | my runs `counts-base`, `counts-item3`, `counts-simple` (pinned Firefox, exit 0) |
| mix 2,559 → 1,037 ms, ASCII unchanged | confirmed in size by another method: −57% and +8 ms | `AB-2`, in-page alternating, 10 rounds |
| source citations | all hold | read in `~/github/browser-engines/firefox-156.0` |
| "correctness did not move" | true on the tier cases; false for one class outside them | lab set and port dump, §3 |
| every accepted cut equals the long recipe | true for exact values; a stand-in inside a window can differ | 4 of 14,288 Arabic offsets |
| the lazy scan buys about 40 ms | confirmed: +26 ms with item 3, +40 ms without | `AB-2` |
| recommendation: the simple form | I agree | §6 |

### 2. Counts and timing

**Counts.** `rebuild/tools/fill-counts-probe.ts` from my own clean trees; lines equal everywhere (3,407 / 3,043 / 475).
- Base: CJK message 478.01 calls and 23,499 units; mix 120.44 and 2,188; plain ASCII 78.35 and 232; long unit 37,316 calls and 41,684,832 units.
- item3: CJK message 516.53 and 2,944; mix 124.63 and 519; long unit 40,658 and 231,696.
- simple: mix 132.85; plain ASCII 87.73.
- All identical to the owner's numbers.

**Timing.**
- The bench driver runs only as the lock wrapper's direct child unless `--allow-no-lock` is passed. A one-stretch pairs script needs that flag, and the permission system refused it. I did not work around it.
- Four bench runs, each its own exclusive acquisition (`T/`), saw loads of 27, 45 and 10.7 after 3-minute waits. They are loaded numbers and not evidence. I stopped that chain.
- Instead I wrote `rebuild/tools/fill-ab-probe.ts`. It runs the headline (10,000 messages from scratch at 320px) for several checkouts inside one page, in alternating order, under one exclusive acquisition.
- `AB-2` ran 10 rounds at a load of 37 to 48 from other owners' offline work. The numbers still came out within 4 to 8% of the owner's quiet ones.

| medians, ms | base | item3 | simple | base + simple |
|---|---:|---:|---:|---:|
| mix | 2,654 | 1,125 | 1,162 | 2,616 |
| plain ASCII | 598 | 608 | 663 | 640 |

- Mix, item3 minus base: −1,505 ms in the median round, every round between −1,438 and −1,585. That is −57%.
- Plain ASCII, item3 minus base: +8 ms in the median round, with rounds on both sides of 0.
- `AB-1` (5 rounds, load 8 to 11) gave −58% on the mix.

### 3. The cut rule, attacked

**Source.** Every citation holds:
- gfxFont.cpp:3781-3808 and :3563-3617.
- gfxHarfBuzzShaper.cpp:1405-1438 and :1483-1487. HarfBuzz gets no context outside the item.

Paths the owner didn't read, none of which changes the rule:
- A font whose space takes part in shaping has its whole run shaped in one call (:3757). That is the port's existing gap.
- The CoreText shaper is off by preference, so AAT fonts also go through HarfBuzz.
- In system fallback a character takes the previous character's font (gfxTextRun.cpp:3559-3569). No test beside a cut can see that reach; the "windows must add up to the unit" check holds it.
- Units also end at script-run limits (`prepare.ts` `initTextRun`). Japanese text therefore has short units and no windows.
- Vertical forms aren't in the model.

**Method.** `rebuild/tools/windows-attack-probe.ts` runs the port itself, from two trees:
- 531 paragraphs without spaces, 106,457 cluster starts.
- Classes covered:
  - Han, kana, Hangul and jamo;
  - page languages;
  - Latin with kerning inside Han at every grid phase;
  - fallback edges and sticky fallback fonts;
  - variation selectors, emoji, U+200D and U+200C;
  - letter spacing (5 values), synthetic bold and italic, sizes off Canvas's grid;
  - 96 Latin samples in 16 fonts;
  - 115 Arabic samples in 14 fonts (laughter, lam-alef, tatweel, vocalized, ZWNJ, digits);
  - Hebrew, Thai, Lao, Khmer, Burmese, Tibetan and 8 Indic scripts;
  - direction overrides;
  - units of 2,400 units and one of 279,800 px.
- Per cluster start it records the advance and the kind of its stand-in reason. It also records the windows, the lines at widths beside window edges (plain and inspected), the DOM's advances, and what went to Canvas.
- `rebuild/tools/windows-attack-diff.ts` compares two runs.
- `rebuild/tools/windows-attack-cases.ts` makes the same samples into 1,566 lab cases for `lab/run.ts` and `compare-rows --prediction=without-measure`.

**Control.** Two base runs are equal in everything, in both the probe and the lab.

**Base against item3:**
- Lines: 0 differ, plain and inspected. Plain equals inspected everywhere.
- Exact advances: 0 differ.
  - One Latin offset (16px Helvetica Neue) is a stand-in 1 au off in base. With windows it is exact and equals the DOM.
- Drift: none. The `long` class has 15,214 offsets with 0 differences. The 279,800 px Han unit has 0 differences. This answers the rounding question.
- Every window start in a sample whose Canvas widths are the DOM's is the DOM's advance.
- 4 stand-in advances differ out of 14,288 Arabic offsets: DecoType Naskh 3, Diwan Thuluth 1. They are under the same gap, and neither value is the DOM's.
  - Inside a window a stand-in is W(window) − W(the window's suffix), not the long recipe's value.
  - No tier case shows it. I documented it; it is not blocking.
- **One class is refuted: a right-to-left script in a left-to-right run.**
  - Here HarfBuzz decides whether to shape reversed by what its whole buffer holds. A buffer of digits without a letter stays left to right (hb-ot-shape.cc:588-645).
  - Canvas therefore shapes a digits-only window the other way round from how the DOM shapes the unit that holds letters.
  - In Firefox: 32 advances differ, one line width differs (22,895 against 22,787), and one line break moves.
  - The break is in case `windows-attack/514-0`: Hebrew letters and sixty digits under U+202D, 24px Arial, 384px. Line 1 ends at 30 in base, as natively, and at 31 with windows. It is the scorer's only transition of the 1,566 (breaks pass → fail).
- Lab compare, base against item3: 0 native differences; 297 cases differ.
  - 286 differ only in the gap detail's W(unit) number.
  - 8 are override cases.
  - 3 are the Diwan Thuluth stand-in.

**Fix (c95dbe0, worded by 517dc25).** `windowsOf` returns no windows for such a unit. That is 7 lines in `advance.ts`, a new `windows-reversed.test.ts`, a registry entry and a DESIGN paragraph.
- I rejected scanning the whole unit only for the flag. The windows' Canvas measurements themselves are shaped unreversed, so that form wouldn't provably equal base.
- The guard also covers a long number in Arabic text, which costs nothing real.
- Fix against base in Firefox:
  - Lab: 0 scorer transitions; the override class has no advance, width, line or painter difference left.
  - Port dump: 5 of 106,457 offsets differ, namely the one Latin offset and the 4 Arabic stand-ins.
- None of the 2,909 tier cases with a stretch of 33+ units without white space holds a bidi control. Quick gates on c95dbe0 show the owner's tier-1 counts unchanged (1,872 new questions, 2 other). So the owner's recordings stand.

**Offline (`two-trees`, stand-in Canvas, the 2,909 tier cases):** 1,893 are the same and 1,012 differ only in detail text.
- 4 differ in an advance or a line end. All 4 trace to the stand-in kerning across U+0020. A window suffix made only of Common characters is measured behind a script context, where base's suffix ran on to letters.
- Real Gecko shapes nothing across a boundary space, and the Firefox runs show no such difference.

### 4. Is it the smallest recipe that pays

**Window size** (calls and units for a CJK message):

| clusters | calls | units |
|---:|---:|---:|
| 4 | 641.00 | 2,209 |
| 8 | 558.14 | 2,460 |
| 12 | 529.44 | 2,700 |
| 16 | 516.53 | 2,944 |
| 24 | 502.14 | 3,453 |
| 32 | 494.80 | 3,950 |

- The two trees' own numbers price a call at about 0.4 µs and a unit at about 0.1 µs.
- By those prices, sizes 8 to 16 are within 6% of each other and 32 is 18% over. 16 stays.

**Windows for Han, kana and Hangul alone** (`counts-cjk`, 7 more lines):
- The CJK message comes out the same. A URL goes back to its base counts. The mix is 123.56 calls and 523 units, against 124.63 and 519.
- It buys nothing on the mix, needs a script list, and leaves Thai and its neighbours quadratic.
- The same probe shows what the general rule buys those scripts, in units sent without and with windows: Thai 1.04 M → 0.17 M; Devanagari 1.78 M → 0.25 M; Khmer 0.34 M → 0.07 M; Burmese 0.53 M → 0.10 M.

**A cheaper form, not on the branch** (`bench/.../attack/tools/variant-seed-on-0edcd64.patch`, 6 lines):
- It takes one ligature group count of the whole unit, the precheck `groupAcross` already makes. Where that equals the cluster count, cuts skip the group test and the windows' own group counts are known.
- CJK message: 477.37 calls and 2,297 units (under base's 478.01 calls). Mix: 120.68 and 453. Long unit: 37,150 and 175,484. That is about 16% of a CJK message's time.
- The port gives the same advances, reasons, windows and lines on all 531 samples (`dump-seed-1`).
- It asks other questions. Taken before the merge's recording, it costs no second one.

### 5. Engineering guide and documents

- The code is sound: the structure is local to a unit, with no script list and no new state kinds.
- Nits I fixed in 63f8737:
  - The `types.ts` comment claimed `windows` is empty in a unit of at most 32 units. It stays null.
  - The `advance.ts` comment said a unit of 2^18 px "never" adds up. The 279,800 px Han unit got 87 windows.
- Nits left:
  - "Text without spaces is one unit" ignores script-run limits.
  - `windowsOf` measures a merged window again at every failing cut, which is quadratic in failing cells and wasted. Measuring once at close is simpler.
  - The threshold 32 is also `WORD_CACHE_CHAR_LIMIT`.
- PROFILING-START item 8 said "two accepted exceptions". The lazy scan owns one of the two. Fixed in 15a761e.
- The owner's compare reports check out when read directly:
  - Without facts, 39 cases differ, all in `gaps[].detail`.
  - With facts, the same 39 plus 74 in one part with native differences.
  - The plain predictor's 120 and 14 sit in one part with native differences.

### 6. Part B

| plain ASCII, `AB-2` | lazy | simple | difference |
|---|---:|---:|---|
| with item 3 | 608 ms | 663 ms | +26 ms median, 4.4%; all 10 rounds higher (+13 to +87) |
| without item 3 | 598 ms | 640 ms | +40 ms median, 6.8%; 9 of 10 rounds higher |

- On the mix the differences are +30 and +23 ms.
- Counts confirm the owner's +8.2 and +9.4 questions a message.
- **I agree with the simple form.**
  - It costs 4 to 7% of plain ASCII in the engine furthest under the bar.
  - It removes 46 source lines, 76 test lines and one accepted exception.
- Evidence it changes nothing:
  - simple equals item3 on all 106,457 offsets, reasons and lines, plain and inspected (`diff-item3-simple.txt`).
  - Its lab run has 0 differences from item3 on 1,566 cases.
- With both changes, Firefox's mix is about 1.1 to 1.2 s.

### 7. Verdict per commit

| commit(s) | verdict |
|---|---|
| 53b0837 (the windows) | merge after a change: my c95dbe0, with 94ed345, 517dc25 and 63f8737 |
| 1719d8f, 12b4fda, bd2490e | merge |
| 01dc475 (registry) | merge with my reclassified entry, which is in c95dbe0, 94ed345 and 517dc25 |
| 5e1be37 (DESIGN) | merge with 7e83710 and c95dbe0's paragraph |
| dc8a812, 938f783, 0edcd64 | merge with 15a761e and a6bb99a |
| 0af3461, 97d73e1, 0e1030c, 65f2abd (the simple form) | merge |
| my f9eb6bc, f7163ef, 4ae6787 (tools) | merge |

Two of my commits need a later one to pass a check. f9eb6bc alone fails `independence.test.ts`; 4ae6787 fixes it. c95dbe0 alone has a stale test pointer in the citation ledger; 94ed345 fixes it. Take them together or squash.

### 8. At the merge, in order

1. Take the branch to a6bb99a. For item 3 only, cherry-pick my 10 commits onto 0edcd64. In the partial run on a scratch tree, 8 of them applied: f9eb6bc, f7163ef, c95dbe0 (with one conflict) and 4ae6787, not 63f8737, 94ed345, 7e83710 or 517dc25. The 2 PROFILING-START commits (15a761e, a6bb99a) won't apply cleanly as they are and need an edit: 15a761e edits the simple form's PROFILING-START text, which isn't on 0edcd64. The one conflict I saw is the generated `rebuild/tests/rules.json` at c95dbe0. Take either side and run `bun rebuild/tests/import-rules.ts`, after which `--check` exits 0. x-perf-lifetime's line in `prepare.ts` doesn't touch this diff.
2. Decide on the 6-line cheaper group test (§4). If taken, take it now as its own commit.
3. Run `bun rebuild/tests/gates.ts --engine=gecko` in the full form on the merged tree. Nobody has run the full form. The painter differential ran on nothing, and my fix has had no sweep.
4. Record Firefox on the merged tree: both configurations, both orders, `--record`. Expect 0 transitions and the same 39 detail-only cases.
5. Pack and freeze both references. Stage seeds with lost 0. There is nothing to accept in the citation ledger (the check exits 0 on my head).
6. Delete the helper branch `x-perf-gecko-fill-simple-form-as-recorded`.
7. Optional: a quiet bench stretch with the bench driver, and the giants' timing.

## Gecko: the fill on CJK (profiling item 3) and the lazy plain scan's trade (item 8)

Branch `x-perf-gecko-fill`, worktree `/Users/chenglou/github/pretext-rebuild-wt/perf-gecko-fill`, from b2d9050. Nothing is merged or pushed. Paths below are under `/Users/chenglou/github/pretext-rebuild/.artifacts` unless they start with `rebuild/`. My run folders are:
- `tests/runs/perf-gecko-fill-20260919`
- `probes/perf-gecko-fill-20260919`
- `bench/perf-gecko-fill-20260919`

Words used:
- A **unit** is a shaping unit: a word between spaces. Text without spaces is one unit.
- A **window** is a stretch of a long unit between two cuts.
- A cut **holds** when Canvas shows that nothing in the shaping crosses it.
- The **long recipe** is today's `W(unit) − W(suffix)`.
- **Units sent** are UTF-16 units passed to `measureText`.

### 1. Outcomes

- **Firefox's chat mix went from 2,559 ms to 1,037 ms per 10,000 messages from scratch.**
  - Quiet machine, 3 alternating pairs.
  - Plain ASCII went from 597 to 582 ms, which is unchanged within the spread.
  - The mix is 1.9 times under the 2 s bar.
  - A CJK message went from 2,492 µs to 493 µs.
- **The cost was CJK, not Arabic.**
  - Arabic has spaces, so its units are words: 112 µs a message, 2.5% of the mix.
  - CJK messages were 8% of the messages and 74% of the time.
- **The source gives no free cut.**
  - Gecko shapes a word of any length in one call, so no cut inside a unit is exact by construction.
  - The cut rule is Canvas's own answer, made of tests the port already makes.
  - It names no script class. Thai, Khmer, Burmese, Devanagari and long URLs get windows where Canvas agrees.
- **Correctness did not move.**
  - Firefox was recorded in both orders and both configurations.
  - There are 0 status transitions, exact values are not worse, and the gate lost 0.
  - Case by case against the reference recording, 39 cases differ outside the known history-dependent cases, and only in one number inside an `in-word-prefix` gap's detail text.
- **The lazy plain scan buys about 40 ms per 10,000 messages.**
  - That is 6 to 7% of plain ASCII.
  - The simple form costs 8 to 9 more questions a message, not the 31 the documents carried.
  - I recommend the simpler form. It is on the branch with its proof.

### 2. Part A: windows inside long units

#### 2.1 What the Gecko source says (Firefox 156.0)

- `gfxFont::SplitAndInitTextRun` cuts a text run only at boundary spaces and invalid characters (gfxFont.cpp:3781-3798). A "word" of CJK text without spaces is the whole stretch.
- A word of more than 32 characters skips the shaped-word cache and goes whole to `ShapeFragmentWithoutWordCache` (:3804-3808).
  - That function cuts only at 32,760 units, backing up at most 16 units to a cluster start (:3564-3617).
  - HarfBuzz gets the whole word in one buffer (gfxHarfBuzzShaper.cpp:1483-1487).
- CJK scripts turn the `kern` feature off (gfxHarfBuzzShaper.cpp:1405-1438). Ligatures and contextual forms stay on.
- So the engine never shapes a unit in pieces, for any script.
  - Script-run and font-range edges are shaped apart.
  - The port can't know font ranges without facts, so the rule doesn't rest on them either.

#### 2.2 The probe

`rebuild/probes/gecko-windows.ts`, W1 and W2. Run: `probes/perf-gecko-fill-20260919/windows-2`, exit 0.

Method: the in-word probe's method (gecko-port F15). The DOM's per-code-point advances in au sit beside Canvas sums from an OffscreenCanvas at the CSS size.

Samples: 54, each one long string without spaces.
- Scripts: Han, kana, Hangul, Arabic, Thai, Khmer, Burmese, Devanagari, Latin.
- Also a URL, Latin with kerning inside Han across a font fallback edge, and Han mixed with Thai, Hangul and an emoji sequence.
- Fonts: the lab's named fonts. 11 samples have 2 px of letter spacing.
- Every cluster boundary is tried as a cut, in 16 grid phases.

| | count |
|---|---:|
| cuts tried | 14,943 |
| kept out by the text rules (918 between joined Arabic letters, 192 before a Burmese mark that starts a cluster) | 1,110 |
| fail the sum (kerned Latin pairs, Arabic) | 377 |
| fail the ink-box test (`fi` in Helvetica Neue) | 21 |
| fail the ligature group count | 0 |
| hold | 13,435 |
| of those, equal to the long recipe | 13,435 |
| of those, equal to the DOM's advance | 13,135 |
| offsets inside windows whose sides add up, equal to the long recipe | 14,040 of 14,040 |
| grid walks whose windows add up to the unit | 864 of 864 |

- The 300 accepted cuts that aren't the DOM's advance are places where the long recipe misses the DOM by the same amount.
  - Noto Nastaliq Urdu: Canvas measures the whole unit 108 au narrower than the DOM.
  - An emoji's device-size advance, which the port corrects separately.
- Every accepted cut is exact for Han, kana, Hangul, Thai, Khmer, Burmese, Devanagari, Latin and Latin inside Han, with and without letter spacing.
- 3 cuts between joined Arabic letters would have passed Canvas's tests. The text rule keeps them out anyway.

#### 2.3 The recipe

Code: `rebuild/src/engines/gecko/advance.ts`, functions `windowAt` and `windowsOf`. Documented in DESIGN.md §4.4.

- It applies only to units of more than 32 code units. Shorter units ask exactly what they asked before.
- Cuts are tried at every 16th cluster start. The last cell keeps whatever is left under two cells.
- A cut holds when all of these are true:
  - no letters join across it;
  - no mark starts its cluster;
  - the two cells beside it, measured alone, add up to the two measured together;
  - the pair of clusters around it has one ink box with and without ligatures;
  - the two cells hold as many ligature groups apart as together.
- These are the tests the recipes already make before they call any in-word advance exact. Here they are made over 16 clusters on each side.
- A cut that doesn't hold leaves its cells in one window, which is measured whole.
- The windows must add up to the unit. If they don't, the unit has no windows and keeps the long recipe.
- A window is a unit to every recipe (same type, stored in `InWord.windows`).
  - The recipe code is unchanged inside a window.
  - It is a structure local to one prepared paragraph's unit, made at the unit's first in-word ask, like the rest of `inWord`.
- No new named gap, because nothing new can differ. One number moves in an existing gap's text (see §2.4).
- Cost in lines: `advance.ts` and `types.ts` +119 −12, of which about 60 are code; `windows.test.ts` is 90 lines.
- `prepare.ts` is untouched.

#### 2.4 The proof

| check | result | where |
|---|---|---|
| tier 1 (offline replay) | exit 4, as expected. 0 predictions changed. 1,872 cases ask a new question, 2 ask others, 61,897 of 63,771 are the same | `gates-quick-gecko-938f783.log` |
| Firefox recorded, no facts, both orders | 0 transitions; differing predicted values 239 → 239, rect counts 112 → 112; gate lost 0; exit 0 | `tests/runs/perf-gecko-fill-20260919/no-facts` |
| Firefox recorded, facts, both orders | 0 transitions; 742 → 742, 100 → 100; gate lost 0; exit 0 | `.../facts` |
| case by case against the reference recording, no facts (`compare-sets.ts --prediction=without-measure`, both orders) | 127,542 rows: native 0, painter 0, prediction 39 cases. Each differs only in `W(unit) = N au` inside an `in-word-prefix` gap's detail | `.../compare-no-facts.json` |
| the same, facts | the same 39, plus 74 cases with native differences | `.../compare-facts.json` |
| plain predictor against the usual run (line ranges) | 120 native, 14 line ranges | `.../plain`, `compare-plain.json` |
| nine giants, lab path and plain path, head against base | predictions, native and painter: 0 differ. 8 giants ask the same calls; the English one asks 844,436 where it asked 843,386 | `.../giants-*`, `giants-*-vs-base.json` |
| function-set sweep (stand-in Canvas), both configurations | 63,771 pass, 0 fail, 0 skipped | `sweep-firefox-0edcd64.log` |
| plain and pure (replay) | 61,899 pass, 0 fail, 1,872 skipped | quick gates |
| unit test | a kerned pair across a cut, and a ligature as wide as its parts across a cut, each keep their cells in one window. Lines equal the glyph records at 200 widths, plain and inspected | `rebuild/src/engines/gecko/windows.test.ts` |
| citation ledger | exit 0, 0 lost | |

- The 74 extra facts cases: all 74 are marked history-dependent in the frozen ledger, and none is among the cases whose questions changed. This is the process's two font states. PERF-LIFETIME's review found the same count between two usual runs.
- The plain predictor's 120 and 14 are the reference's own totals at the correctness round 5 merge. All are marked history-dependent, and none is among the changed cases.
- Plain and pure skip the 1,872 changed cases until a recording with the new questions is packed. I may not pack. The plain predictor's browser run and the sweep cover those cases.
- The 39 cases: inside a window the gap detail prints the window's width as W(unit). This is documented in DESIGN.md §4.4 and in `types.ts`.

#### 2.5 The numbers

**Counts.** Pinned Firefox, `rebuild/tools/fill-counts-probe.ts`, the first 1,000 messages of each set at 320 px. Lines are equal before and after. Runs: `counts-before-1`, `counts-after-1`.

| per message | calls, before → after | units sent, before → after |
|---|---|---|
| CJK (81 messages, mean 122 units) | 478.01 → 516.53 | 23,499 → 2,944 |
| Arabic (58) | 47.29 → 47.29 | 161 → 161 |
| Latin with a URL (57) | 189.63 → 207.96 | 1,227 → 1,153 |
| plain Latin (551) | 80.97 → 80.97 | 239 → 239 |
| the mix | 120.44 → 124.63 | 2,188 → 519 |
| plain ASCII set | 78.35 → 78.35 | 232 → 232 |
| one Chinese unit of 9,428 units | 37,316 → 40,658 | 41.68 M → 0.23 M |

**Time.** Bench headline: `bench/run.ts --smoke --messages=1000 --phase-passes=3 --scenarios=chat --headline=10000`.
- Base and branch ran in 3 alternating pairs inside one exclusive stretch of 5 minutes.
- The 1-minute load was 7.5 at the first run and 3.7 to 5.8 after.
- Each run's number is the median of its 3 passes. The table gives the median of the 3 runs and their range.
- Files: `bench/perf-gecko-fill-20260919/A`, `A-summary.txt`.

| Firefox, 10,000 messages from scratch | before | after |
|---|---:|---:|
| the mix | 2,559 ms (2,535 to 2,626) | 1,037 ms (1,033 to 1,042) |
| plain ASCII | 597 ms (583 to 607) | 582 ms (574 to 587) |

| µs a message (instrumented pass, 1,000 messages) | before | after |
|---|---:|---:|
| CJK | 2,492 | 493 |
| plain Latin | 62 | 62 |
| Arabic | 112 | 115 |
| Latin with a URL | 145 | 137 |
| emoji / curly quotes / code span / app text | 88 / 77 / 104 / 109 | 87 / 76 / 104 / 108 |

- **One Chinese unit of 9,428 units, first layout.** Two sittings, both on a loaded machine: 12.0 s and 10.4 s before, 0.16 s and 0.11 s after. 475 lines both times.
- **Giants.** In Firefox they hold words, not long units, so the recipe can't move their time: 8 of 9 ask the same calls.
  - A timed stretch of two alternating pairs was spoiled by other owners' load rising from 3.6 to 51 during it.
  - Rows' prediction time over the nine, in run order: base 8.27 s, branch 8.89 s, base 9.35 s, branch 10.94 s.
- **Against the bar.** Firefox's mix is at 1.04 s. What is left, by kind: CJK 36% (was 74%), plain Latin 31%, URL 7%, Arabic 6%, curly quotes 6%, code spans 6%, emoji 5%, app text 3%.
- **What is left in CJK.** A CJK message asks 517 questions, against 81 for Latin.
  - Per offset that is 2 for the ink-box test, 1 for the window's suffix and 1 for the cluster alone.
  - They are short now. Asking fewer of them is another recipe (cluster sums), not this one.

#### 2.6 At the merge

1. Record Firefox again on the merged tree: both configurations, both orders, with `--record`.
2. Pack and freeze both references. Stage the seeds (lost 0 here in both configurations).
3. Nothing needs accepting in the citation ledger.
4. The 39 gap-detail cases become part of the new reference. The 1,872 cases become replayable again.

### 3. Part B: the lazy plain scan

Four trees were compared: the base and item 3, each with the lazy scan and with it taken out for real. The removal is `rebuild/src` 3 files, +15 −61; `lazy-scan.test.ts` (76 lines) goes too. The script and the patch are in `bench/perf-gecko-fill-20260919/tools`.

**Counts.** Pinned Firefox, 1,000 messages, lines equal.

| calls a message | lazy | simple |
|---|---:|---:|
| mix, base | 120.44 | 128.66 (+8.2) |
| plain ASCII | 78.35 | 87.73 (+9.4) |
| mix, with item 3 | 124.63 | 132.85 (+8.2) |

The documents' "+31" was the cost of round 5's first build, in a 200-message smoke.

**Time.** Four trees in 3 alternating rounds, inside one exclusive stretch of 7 minutes, load 4.4 to 7.7. Files: `bench/.../CD`, `CD-summary.txt`.

| 10,000 messages, Firefox | lazy | simple | what the lazy form buys |
|---|---:|---:|---|
| plain ASCII, before item 3 | 587 ms | 630 ms | 43 ms, 7% (rounds 44, 34, 44) |
| plain ASCII, with item 3 | 596 ms | 629 ms | 33 ms, 6% (rounds 33 and 38; the third round held an outlier) |
| mix, before item 3 | 2,617 ms | 2,669 ms | 52 ms, 2%, inside the runs' spread |
| mix, with item 3 | 1,098 ms | 1,196 ms | noisy (rounds of 98 and 20 ms). By the ASCII number, about 40 to 50 ms, 4 to 5% |

**Recommendation: the simpler form.**
- The lazy scan buys about 4 µs a message, in the engine that is 1.9 to 3.4 times under the bar with or without it.
- It pays for that with the port's most intricate code, a record whose value depends on who asked first, and an accepted exception to "nothing writes a prepared paragraph after prepare".
- Without it, a plain paragraph's lines equal the inspected one's because both read the same advances, not by a bound argument.

**The simple form is on the branch as its last four commits.** To leave it out, use 0edcd64, which is the item-3-only state. What holds it:
- Unit tests pass.
- Quick gates: tier 1 as for item 3; plain and pure 61,899 pass, 0 fail.
- The sweep passes in both configurations: 63,771 pass.
- Firefox, both orders, both configurations: 0 transitions, exact values as before, gate lost 0.
- Against item 3's own run, including counts of Canvas work: every row is equal except 7 rows of one reversed part, all marked history-dependent. The inspected path did not move.
- The plain predictor against the usual run: 0 line ranges and 0 native observations differ over 63,771 cases.
- Runs: `simple-*`, `compare-simple-*`.

### 4. Commits

Listed in section "branch" of this output. The DESIGN.md §4.4 block "Recipe added in the profiling phase" holds the cut rule and its evidence. PROFILING-START.md items 3 and 8 hold the results.
