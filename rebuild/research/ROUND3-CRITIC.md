# Ceiling round 3: critique

Paths are relative to `~/github/pretext-rebuild`.

Where my work is:
- Tools and outputs are in the scratchpad folder `critic-r3/`.
- Fresh sets are under `.artifacts/lab/fresh/<browser>/critic-r3-1`.
- Isolation runs are in `isolate-*` folders beside them.

What I ran and changed:
- I ran 18 fresh-set jobs, 3 isolation runs and 3 probe runs.
- All finished on the first run, under the lock, with the evaluated bundle (sha256 80b6b4b8004c…).
- I edited no repository file and committed nothing.
- Another workflow's owners were active in the tree meanwhile. `git diff a5b4636 -- rebuild/src rebuild/lab` stayed empty at each job I started.

Units: a LayoutUnit is 1/64 px of zoomed px (Chrome at DPR 2), an au is 1/60 px (Firefox).

## Verdict

**"Ceiling not reached in Chrome" holds, and Chrome is further off than the report says.**
- One Chrome condition covers failures it doesn't cause.
- None of the three "new classes" is a Canvas limit. One has a complete source-level hypothesis, and two are the port contradicting its own numbers.

**Firefox and webkit-host: no new class on my fresh set.**
- Their zeros are real under scorer 5.
- Firefox's zero rests on the detached canvas element, and nobody has run its OffscreenCanvas fallback.
- WebKit's zero coexists with an observation port that reports wrong values as predicted under its own gaps.
- No browser is at the ceiling by the four metrics. Part of what is left under gaps is convertible to predictions and was not tried.

## My fresh set (seed `critic-r3-1`, every kind, `--repeat=3`, both orders)

| Browser | Cases | Prediction failures | Open | What the open rows are |
|---|---:|---:|---:|---|
| Chrome | 21,528 | 86 | 4 | exact fit in ProbeShantell ×1; marked waw in Geeza Pro ×2; scorer attribution at a soft hyphen ×1 |
| Firefox | 21,290 | 191 | 0 | — |
| webkit-host | 21,179 | 472 | 3 | all three are the float32 step at a moved x |

- **Chrome:** the evaluator's classes 1 and 3 came back. That is 1.9 open per 10,000, against the evaluator's 1.76. The fourth row is scorer attribution, not a fourth class.
- **Firefox:**
  - 220 history-dependent cases, and all of them pass in both orders.
  - `page-history` names 0 of 220 in forward order and 220 of 220 in reverse. It sees the unusual state, not the state that can change.
- **webkit-host:** 136 history-dependent cases, all named. One protocol row came out of `family-widths`.
- No row is open in reverse order only. No residual class has a member.
- These seeds are development sets now, because I read their failures.

## Prioritized list

### 1. Chrome's `page-history` covers system-ui failures that page history doesn't cause

**What the condition is.** It is a paragraph gap over every run measured at the CSS size (system-ui, BlinkMacSystemFont) whenever layout zoom isn't 1. So every such failure is covered by position.

**Isolation** (`sharded.ts --isolate`, each case alone in a fresh browser process):
- All 8 of my fresh rows and 20 of 20 sampled rule-family rows fail the same way alone.
- For the 8 fresh rows I compared native and predicted geometry with both in-set orders: they are equal.
- Every one of these rows is 16.8px: all 64 rule-family rows by their case records, the fresh rows I opened, and the fresh kind reuses the same paragraphs.
- Of the 20 family rows, 3 fail lineCount and 9 fail breaks, so this isn't only one-unit widths.

**Order probe** (`critic-r3/probes/blink-order.ts`, one fresh process per order):

| 16.8px system-ui | Whole-string width |
|---|---|
| DOM, measured first | 204.742188 px |
| DOM, measured after Canvas | 204.742188 px |
| Canvas | 204.680374 px |
| Port's recipe, `ceil64(2·W)/128` | 204.6875 px |

- No earlier text or canvas is involved, and measuring order doesn't change the DOM.
- Whatever differs is deterministic.
- The flooring of the font size to 1/100 px at the zoomed size (33.59) against the CSS size (16.79, so 33.58) fits the ratio at 16.8px and 17.3px, not at 13.33px. It is a hypothesis.

**Effect on counts.** These rows have no covered explanation.

| Set | As reported | With these rows |
|---|---|---|
| Evaluator's three fresh sets | 6 open of 34,115 | 30 open (8.8 per 10,000) |
| My fresh set | 4 open of 21,528 | 12 open |
| Rule families (r3) | 0 of 428 failures | 64 of 428 |

**Owner.** The condition predates round 3, and the round 2 critic missed it too. Any history condition should pass an isolation check before it counts as a cause.

### 2. Chrome's three fresh classes, traced further

**Exact fit in ProbeShantell.**
- Rows: `c-75d0317451d66b3d` (mine) and the evaluator's four.
- The cases sit at the derived threshold width.
- Natively the line is exactly the floored available width plus 1 LayoutUnit in all five: 6177/6176, 5375/5374, 2175/2174, 6177/6176 and 7335/7334.
- All five are under letter spacing.
- The port's positions are reported as predicted with no gap, and the prediction breaks one cluster early.
- `in-word-prefix` was narrowed to `margin < 2`, "derived from ShapeLine's two ceilings". That derivation assumes the glyphs are equal, so only rounding differs. These rows are outside it.
- The margin is a constant whose derivation doesn't cover letter-spaced text. Treat it as a heuristic until the rounding under letter spacing is read from source.

**Marked waw in Geeza Pro** (`c-e20991195fd80fb0`, `c-8111c151350d9546`, the evaluator's `c-2dce271cf373d098`).
- The cluster `وَ` has state predicted and no limit. It is 572 units against 704 natively.
- The predicted first line `وَا` is 1,097 units wide in a 1,024-unit box, with an emergency break available at offset 2.
- So the port contradicts its own fit rule. That is a defect, not a gap.

**U+3000 before T in Times New Roman** (`c-0ee8c36920378f9f`).
- The font has no U+3000 (checked with fontTools), and HarfBuzz has a space-fallback step.
- Its legacy kern pair (space, T) is −37 units, which is −37 LayoutUnits at 32 zoomed px.
- The kern machine splits that into −19 and −18.
- Natively T is exactly 18 units narrow across the wrap, and U+3000 is exactly 1 em.
- The port sees only −18 in the Canvas pair window, halves it again (U+3000 −9), and drops T's half at the line start.
- The arithmetic is exact. Which step resets the space's advance to 1 em is my hypothesis: in pinned HarfBuzz the space fallback runs in `hb_ot_position_default`, before the plan's kerning.

### 3. WebKit's observation port reports values as predicted under its own gaps

- On my set, 1,092 of 123,460 predicted node widths and 487 predicted x values differ from the browser.
- 1,254 of the wrong values sit on lines whose only gap is `canvas-language`. 95 sit under `letter-spacing-ligatures` and 32 under `rtl-shaping-across-inline-boxes`.
- Only 4 are in passing cases.
- The layout reports the gap with a range over exactly those nodes, and the port still says `predicted`. The x of nodes after a limited node stays `predicted` too.
- The definition says a predicted value must be exact. Blink fixed this fault in round 3; WebKit didn't.
- The evaluation's 99.73% agreement (99.50% on fresh sets) is this violation, not noise.

### 4. Scorer 5

**It implements the rule as stated.**
- I found no way in through unranged gaps: no failure on any set is covered only by one.
- Re-scoring three runs gave byte-identical per-case files.

**Its limits:**
- **Coverage is positional, so a whole-run range covers anything inside.**
  - Chrome `page-history`: the cause is refuted (item 1).
  - Gecko `font-size-quantization`: honest. The detail names both sizes, and every glyph is 1 to 2 au off.
  - WebKit `canvas-language`: plausible on the 7 rows I read. The differing text is quotes, brackets, digits and punctuation under a generic or fallback family.
- **Two missing rules produce open rows that aren't classes.**
  - WebKit's `f32(f32(x+w)−x)` at a moved x: all 3 of my open rows and the evaluator's 1.
  - The soft hyphen's copied rect that moves the attributed line: my `c-ccbcd11b754a7299`, where the true line has a touching `unsafe-to-break` range, and the evaluator's 3 `U+FFFC/start` rows.
  - Both can be computed exactly from engine-true values.
- **A one-node WebKit paragraph is covered by any ranged gap on the line.**
  - Example: `c-3f271dba4d636a5e`. The gap is on CR at [0,1), and the only code point that differs is `g` at 43.
  - Known and documented by the scorer owner.

### 5. New and widened conditions

**Citations.** Every citation I read says what the owner says:
- Blink: shaping_line_breaker.cc:497-506, shape_result_view.cc:215-273, font_fallback_list.cc:264-286.
- Gecko: gfxFont.cpp:741-753, gfxPlatformFontList.cpp:1244-1268 and :1328-1330, gfxTextRun.cpp:306-320, :3559-3569 and :4003-4086, nsTextFrame.cpp:4349-4357, CanvasRenderingContext2D.cpp:4256-4269.
- HarfBuzz: hb-aat-layout-kerx-table.hh.
- WebKit: WidthIterator.cpp:792-823 and UnrealizedCoreTextFont.cpp:258-264. That file is under `cocoa/`, not `coretext/`.

**Firing.** The evaluator's rates on passing development lines reproduce exactly with `fresh.ts report`:
- Blink: `script-context` 30.78%, `float32-precision` 5.77%.
- Gecko: `in-word-prefix` 4.24%, `page-history` 0.07%.
- WebKit: `canvas-language` 15.44%, `simplified-measuring` 7.75%.

**Blink.**

| New condition | Passing fresh lines it fires on |
|---|---:|
| untested line ends | 0.07% |
| truncated RTL line starts | 0.08% |
| break candidates | 0.13% |
| uncertain ligatures | 0.15% |
| item edges | 0.34% |

- The untested-end condition wasn't over-widened. The source branch needs an unsafe line start (`DCHECK_NE(first_safe.offset, start)`), so first lines are rightly outside it.
- `float32-precision` fires on 5.8% of passing development lines and covers no failure in any set I read. It is cover in advance. Show one row that needs it, or drop it.
- `c-328ba3307635942f`: `unsafe-to-break` covers a predicted line 0 units wide for `س`, against 8.98px natively. The reading allows a value between 8.98px and the letter's isolated advance. Zero is outside that range, so this is doubtful.
- `script-context`: 5 rows read and plausible (`(` and `)` after other-script text in Shantell Sans and Amiri). Its lift is still about 1.

**Gecko.**
- `in-word-prefix` is a catch-all that names real things. It sits on 100% of failing development lines.
- I read 12 rows under `in-word-prefix` and 4 under `font-fallback`. The first 12:
  - Odd kern splits 1 au off at the break. Probe F16's "settled" is too strong: 59 fresh failures are 1 au, and they sit at the break, so they aren't the old 1 au class hiding.
  - Joined letters whose two sides don't add up. The difference equals the mismatch the gap's detail prints.
  - Hoefler Text: natively the kern is split, and the port puts it all on the first glyph because the fact is unknown (item 7).
- The 4 cursive letter-spacing rows (3 covered, 1 open) are one class, each exactly one letter spacing (60 au) off. Whether a row is covered depends on where the stand-in rects land.
- The widened `page-history` covers no failure on any set.

**WebKit.**
- `page-history` is validated:
  - All 20 fresh failures it alone covers pass every metric alone in a fresh process.
  - Of the 38 others it shares, 37 pass lineCount alone.
- `simplified-measuring` fires on 7.75% of passing lines with a lift of 0.04.
  - `pairKerning: null` conflates "unknown" and "none" (Georgia, Courier New, Menlo).
  - A value for "none" would clear most of it.
- `canvas-language` on characters no named family draws fires on 0 passing lines and about 420 failing ones. It always fails, so it is a prediction waiting for the per-language cascade as a fact.

### 6. Gaps that could be predictions, not tried this round

- **Chrome, a grapheme cluster split across spans** (emoji ZWJ sequences, keycaps, flags).
  - It is 22 of the evaluator's 181 fresh failures and 28 of my 86.
  - The evaluation folds it into U+FFFC's 130, so it goes unnamed.
  - The port knows the shaping-group edge is inside the grapheme. It still predicts the merged cluster (the second regional indicator is 0 wide, against 20px natively) and reports `font-fallback`.
  - Each side shaped alone is measurable in Canvas.
- **Chrome, U+FFFC** (108 of 181). The Blink owner's stand-in idea was left at 3 probed fonts.
- **Firefox, `font-size-quantization` in fonts without an optical size axis.**
  - Georgia 74, Arial 33 and Courier New 31 of 767 fresh failures.
  - Advances at a size equal to the units per em are exact in font units. With the units per em as a fact, the DOM's per-glyph rounding can be computed. Untested.
- **Firefox, smaller items:**
  - The Amiri cross term (231) and Noto Nastaliq Urdu (156) are untried.
  - `CalcTabWidths` is read and unported.
  - Probe F18's unbounded frame is untraced.

### 7. Font facts

- Not used as tables of expected results:
  - Facts come from font files and engine source.
  - They were corrected by a browser probe where they were wrong.
  - In the facts-free study, no case passes only without facts.
- **One resolution fault.**
  - Gecko takes a fact only where tied faces agree.
  - Hoefler Text ties with its Ornaments face, whose `pairKerning` is null, so the fact is lost.
  - All 30 Hoefler Text fresh failures are this.
  - The table's `split` matches the native layout. In `AVAV`: A +79 au, then V +11, A −11, and so on.
  - Resolve the fact by which tied face draws the characters.

### 8. Gecko's detached canvas element

**Checked and fine.**
- Native observations are identical between round 2's library and round 3's on the same files and orders: `runs`, `ws` and `policy` in all three browsers (5,205 cases each), and Firefox's suite sample in both orders (19,888 cases, with its 123 history-dependent ones).
- So the element's lookups didn't move any native view there.
- My order probe (176 items in fresh iframes; DOM first, canvas first, DOM only twice) shows no order effect. No item was history-dependent, so it says nothing about that state.

**Still open.**
- The lab always lays out natively before predicting, and so does probe F13. An app measures first.
- `prepare.ts` says the font group is the DOM's and that "every lookup since the DOM's layout, this port's included, moved that state".
- An intermediate build did change a later native layout by measuring U+FE0E.
- The OffscreenCanvas fallback has no run. If the maintainer declines the element, Firefox has no round 3 numbers.
- A measure-first lab mode and one fallback run are the missing evidence.

### 9. Staged seeds

**Records.**
- All 10 reproduce exactly. Lost pairs per seed: lab Chrome 0, Firefox 5, webkit-host 4; rule families Chrome 2, Firefox 44, webkit-host 32; feature families 0.
- 175 webkit-host pairs leave through history dependence.
- No protocol id sits among the passes.
- The environment check ran, and the seeds went to staging only.
- Every lost prediction pair is covered and attributed.
- The 7 Firefox painter pairs have no covered explanation. They are attributed to a painter limit the lab doesn't record.

**Against the rule.**
- Pass pairs of cases dropped from the new case files leave the seeds without being lost.
- The records give only case counts for them. My count is 18 Firefox feature pairs of 9 cases, 6 webkit-host family pairs of 2 cases and 12 webkit-host feature pairs of 3 cases.
- List them by id.

**Recommendation.**
- Adopt Chrome's and webkit-host's seeds.
- Hold Firefox's until the canvas-element decision, since they encode it.
- Hold `coverage.json`, which exits 1.
- Keep the 7 painter pairs listed as known losses until `painterLimits` is recorded.

### 10. What the verdict leaves out

- **Chrome's composition is mis-stated.** It gives U+FFFC 130. The right figures are U+FFFC 108, clusters split across spans 22, and system-ui 24, which isn't history.
- **"Passes the criterion" is about open rows, not the ceiling.**

  | Browser | Widths pass rate (dev / held-out / sealed-3) | What the failures sit under |
  |---|---|---|
  | Firefox | 97.9 / 96.1 / 95.8% | all under one condition |
  | webkit-host | — | 69% under `canvas-language` |

- **The painter is 81% to 97%**, and its limits are unrecorded.
- **No measure-first check in any browser.** My Chrome probe found no order effect for system-ui. Firefox's history-dependent state is untested.
- Already flagged by the evaluator and still true:
  - The numbers use the lab's font facts.
  - Installed Safari ran only `dev-all` and `families-all`.
  - Sealed-3's 3 open rows are unopened.

### 11. Process

- **Sealed-3.**
  - No engine, painter, facts or lab-infra owner's tool call names it.
  - The fresh-tools owner generated it and checked ids and hashes.
  - The evaluator read its README and the SEAL metadata, and ran one counts-only scan of its rows.
- **Earlier rule breaks are already self-reported.**
  - The Gecko owner went past the 8-set cap.
  - Its `r3-18` bundle failure was rerun without a cause.
  - The Blink owner ran diagnosis jobs that were expected to stall.
- **`compress-rows.sh` now removes files with `/bin/rm`**, citing a maintainer permission I can't verify. I compressed my rows with zstd, checked them, and sent the originals to the Trash.

## Checked and fine

- Bundle 80b6b4b8004c… is in every one of my runs.
- The evaluator's open counts reproduce (Chrome 6, Firefox 1, webkit-host 1).
- No name-keyed code came in with the round 3 engine diff. Font names appear only in comments and tests.
- The constants I found are the registered ones: the 64px probe spacing, the 0.75 to 1.5 bound, the nearer-of-two-sums test, and the 2^k recipes.
- Emergency break after a hyphen per font run: the source says exactly that.
- Zero-width predicted lines that hold letters are nearly all passes. They are real, from negative letter spacing.

## Traces

**Open rows (10):**
- Chrome:
  - `c-75d0317451d66b3d`: exact fit under letter spacing.
  - `c-e20991195fd80fb0`, `c-8111c151350d9546`: marked waw in Geeza Pro.
  - `c-ccbcd11b754a7299`: scorer attribution at a soft hyphen.
  - `c-0ee8c36920378f9f`: U+3000 before T.
- webkit-host: `c-ed4b8a82de97e422`, `c-010a93ebbd123dc1`, `c-76757b96ec75655f`.
  - Each has a node under `rtl-shaping-across-inline-boxes`, and an untouched node one float32 step off at the moved x.
- Firefox: `c-f3e8314c35b33990`, one letter spacing (60 au) off.
- The evaluator's `c-2dce271cf373d098` is the waw class.

**Covered rows:**
- Not backed: Chrome `page-history`, 28 isolated rows (for example `c-131e2c0e95d82416`, `c-66461a50ce2699b5`).
- Doubtful: Chrome `c-328ba3307635942f`.
- Backed by isolation: 20 webkit-host `page-history` rows.
- Backed by reading:
  - Firefox: `c-1cdde4d508c76896`, `c-0a14e0120f50e4e3`, `c-0f2faf43fc19089f`, `c-37d6cef623a53363`.
  - webkit-host: `c-2d2e1eed11651de6`, `c-df34e6b96f68ae86`, `c-8e60c9388c90797e`.
  - Chrome: `c-d8a44323e86508aa`, `c-f1f9f0e14f9cab49`.
- Covered, native share unexplained by the owner: webkit-host `c-04e0e8a5bc4c4e2b` (two predicted lines 0 wide).

## For round 4

1. **Blink:**
   - Rename or replace `page-history` on system-ui and re-count.
   - Read the three classes from the traces above.
   - Predict clusters split across spans.
   - Justify `float32-precision` or drop it.
2. **WebKit:**
   - Limit observation values under ranged gaps, and the x after them.
   - Give `canvas-language` its cascade input.
3. **Gecko:**
   - One run of the OffscreenCanvas fallback.
   - A units-per-em recipe for `font-size-quantization`.
   - Port `CalcTabWidths`.
   - Resolve Hoefler Text's tied faces.
4. **Scorer and lab:**
   - The two observation-consequence rules.
   - A measure-first mode.
   - Isolation as the standing check of any history condition.
   - Record `painterLimits`.
   - A value for "no pair kerning".
   - Keep `rm` out of `compress-rows.sh` unless the maintainer confirms.
