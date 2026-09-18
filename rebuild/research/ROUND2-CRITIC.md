# Ceiling round 2: critique

Paths are relative to `~/github/pretext-rebuild`. My tools and outputs are in the scratchpad folder `critic-r2/`.
- I ran two short probe jobs under the lock, one in Firefox and one in Chrome. Both finished on the first run.
- I edited no repository file and committed nothing.
- While I worked, the orchestrator committed the evaluation's outputs as 1f85a82, new seeds included. My baseline checks compare against bc49b0e.

Units: a LayoutUnit is 1/64 px (Chrome), an au is 1/60 px (Firefox).

## Verdict

**"Ceiling not reached" is right, and the gap is wider than REPORT §2.8 says.**
- **Chrome's zeros on the held-out set don't hold** under the second half of the round 2 definition. Both classes the fresh sets "found" already sit in the burned held-out `runs` set, covered by gaps that concern other characters on the line.
- **One of the two classes is a port bug.** It has a complete source reading, and a probe confirms it. It isn't an untraced class.
- **The residual class is real, but its "no Canvas measurement can detect it" claim isn't established.** F7 tried only canvases at the CSS font size. Rows are being added to the class by signature, not by probe.

## Prioritized list

### 1. Both "new" Chrome classes are in held-out 09-16, hidden under `script-context`

**How I tested it.** For every widths failure covered by a line-local gap, I checked whether any covering gap's range touches a code point whose native width differs from the predicted one. The tool is `critic-r2/elsewhere2.py`; it streams rows.

| Browser | Covered widths failures, development + held-out | No covering range touches a differing code point |
|---|---:|---:|
| Chrome | 144 | 10, all in held-out `runs`; 8 of them under `script-context` alone |
| Firefox | 1,709 | 26, all `in-word-prefix` at a break between joined letters across SHY, which is legitimate |
| webkit-host | 309 | 83 (not usable, see note) |

- **webkit-host note:** its code-point rects snap to whole px, so this test has no resolution there.
- **Other Chrome sets:** the rule families have 0 of 230. The fresh sets have 3 more of 33, all `runs/word-spacing-spans`.

**Chrome rows I read:**
- **`c-906c6bc491c83c9d`, `c-a52d0bfda6f53a43`, `c-f1877e45ed22478e`** (`runs/bidi-runs`): a lam-alef ligature across a span edge, `كلِّ` then `الدردا`, both Geeza Pro 14px.
  - Natively the lam is 262 LayoutUnits wider and the alef 263 narrower. The line ends 0.5 units off.
  - The only covering gaps are a `script-context` range on `»` at offset 7, 15 characters away, and on `c-a52d…` an unrelated `glyph-clusters` offset at 33.
  - `»` itself is predicted exactly.
  - This is the fresh class 2 (`c-4a04b13ad0ab4062`).
- **`c-522324a27e5bb6bd`, `c-430fa200ce40d3eb`, `c-4cafadcd4b3fb900`** (`runs/word-spacing-spans`): U+3000 inside Arabic under −1px letter spacing.
  - Each U+3000 is a net +64 units natively.
  - The covering `script-context` ranges sit on `«`, `:` and `»`.
  - This is the fresh class 1. REPORT §2.8 cites `c-522324…` as a row where `script-context` "covers the same texts", and still counts it as covered.

**Why the scorer lets this through** (`lab/score.ts:505-538`):
- Every gap of the previous line counts as covering, including gaps at that line's start edge.
- So does any paragraph gap whose range meets [previous line start, failing line end].
- Blink's `script-context` fires on 76% of development cases, so almost any failing line in mixed text is covered.

**Fix:**
- For widths failures, require a covering range to meet a rect that differs.
- For lineCount and breaks failures, require the gap at the decision: the previous line's last candidate or the content that overflowed.
- Then re-count every set.

### 2. The U+3000 class is a port bug, confirmed by probe

**Source:**
- `ShapeResultSpacing::ComputeSpacing` applies letter spacing in a cursive run only to characters `TreatAsSpace` accepts (shape_result_spacing.cc, `apply_letter_spacing`). U+3000 isn't one of them.
- U+3000 has no script extensions, so the paragraph's RunSegmenter keeps it in the Arabic run. The port's itemizer agrees: I ran `scriptsPerUnit` on these strings.
- Blink's Canvas splits a word before each `IsCjkIdeographOrSymbolBase` character and shapes words alone (plain_text_node.cc:115-127). U+3000 has that property in the port's generated data. So Canvas resolves U+3000 alone as Common, which isn't cursive, and spaces it.

**Probe** (`critic-r2/probes/blink-u3000.ts`, Chrome 153.0.8010.50, Geeza Pro 20px, `وأعانك　على`):

| Letter spacing | DOM | OffscreenCanvas |
|---|---|---|
| 0 | 91.3672 | 91.3652 |
| 10px | 91.3672 | 101.3652 |
| −1px | 91.3672 | 90.3652 |

With two U+3000 and two U+0020, 10px of letter spacing adds 20 in the DOM and 40 in Canvas. U+3001 and `中` do take spacing in the DOM, as the source reads.

**Port.** `measure16` compares `dom` and `canvas` spacing per unit, but takes the Canvas script from `scriptsPerUnit(cs.s)` over the whole string (`shape.ts:318-329`), ignoring Canvas word splits. `shapesUnderOtherScript` has the same blind spot, which is why `script-context` is silent on U+3000.

### 3. The span-edge ligature class is a gap condition that is too narrow
- **The condition fires only at line edges.** `glyph-clusters` with `JOINING_LIGATURE_DETAIL` (a font ligature may cover letters on both sides) comes from `edgeGap`.
- **The same reading holds at an item edge inside one shaping group.** The item holding the cluster's first character gets the ligature's glyph (the port's own r2-d change, `sliceEdge`).
- **On these rows the rects across the edge, and the lam-alef and Allah ligatures inside nodes, are reported as `predicted` with wrong values.** That is the evaluation's "in-word positions reported as exact" item, and here it costs a metric.
- **Related: r2-e's look-ahead covers the 10 triage ligature rows by reporting a gap.** The port already detects the ligature with its no-ligature contexts. It could give the ligature's characters the glyph's position, as `ComputePositionData` does, and predict those rows.

### 4. Gecko's residual class

**The signature holds.** From raw rows I recomputed the following (the ids are REPORT §2.8's):
- The Firefox prediction failures without a line-local gap, over development, held-out, rule families and feature families, are exactly the 14 listed cases (15 rows).
- Each has exactly one node rect that differs, by exactly ±1 au, in a node holding one of F7's strings.

**What is verified and what isn't:**
- F7 verifies that the DOM differs from OffscreenCanvas at the CSS font size.
- The mechanism is inferred (16.16 advances rounded per glyph at the device size, specs/gecko-canvas.md N7).
- F7 measured three canvas kinds, all at the CSS size. The round 1 critic had asked for a canvas at the device font size.

**My probe** (`critic-r2/probes/gecko-device-size.ts`, 94 units, Firefox 156 at DPR 2):
- OffscreenCanvas totals at size × DPR, halved, equal the DOM in only 22 units. They are further off than the CSS-size totals. That simple recipe is refuted, so the claim survives one more test.
- CSS-size Canvas differs from the DOM by exactly 1 au in 12 units.
  - All 12 are in Geeza Pro, Thonburi or Helvetica Neue.
  - None of the 32 units in Arial, Georgia, Times New Roman or Verdana differs.
- New members, confirmed:
  - `وأعانك` in 10px Geeza Pro (+1);
  - `LT:` in bold 10px Helvetica Neue (−1);
  - `ทำให้` in 32px Thonburi (+1).
- In the Arabic runs sentence at 10px, 2 of 5 words are in the class. So its size follows the case mix, not rarity.

**Membership by signature isn't probe verification:**
- A port bug that moves one node by 1 au would match the signature too.
- The 3 fresh `LT: kerning pairs` rows are probed now.
- The 2 fresh Geeza Pro weight 500 rows and the 5 sealed-2 rows aren't.
- Report them as "signature only".

**Sealed-2.** The keycap-heart search was steered by sealed-2's width-difference histogram (−8 au ×6). It is counts only, so the rule holds. But sealed-2 is spent for that class, and the next round needs a new sealed set.

### 5. WebKit's `page-history` misses rows the run itself proves history-dependent

**webkit-host, per-set runs, both orders:**
- 222 history-dependent rows fail a prediction metric.
- 206 have `page-history` on the failing line.
- 16 don't, and 13 of those have no line-local gap at all: 12 are in `suite/original-vs-reshaped-admission` (for example `c-38c6f39166bffa7e`).
- These rows are excluded as history-dependent, so they aren't open by the counts. They are direct evidence, beyond `c-66ae4ab7d56cb0ae`, that the declared one- and two-character context set is too narrow.

**Firefox:**
- 54 history-dependent rows fail a prediction metric, and none names `page-history`.
- 50 of them are the `suite/U+FFFD` families, untraced since 09-16 (tentpole 6).

**Loophole check, which passes:** no history-dependent case in any browser fails without a line-local gap in both orders.

### 6. Baselines

**Reproduced:** for all 10 seeds, my lost and gained pair counts against bc49b0e equal the record exactly, with nothing missing and nothing extra. No protocol id sits among the passes. The refusals in the gate logs are real.

**Against the baseline rule:**
- **Committed before checking.** The seeds went into 1f85a82 before this critique, the same order the round 1 critic objected to. Git keeps the old files, so it's reversible.
- **68 painter pairs** (Chrome 59, webkit-host 9) have neither a line-local gap nor a source attribution.
  - 58 are an admitted painter regression.
  - Seeding removes them from the gate.
  - Either fix the regression first, or keep them as expected passes.
- **Pairs that left the gate without being listed.**
  - Firefox: 34 cases, 134 pass pairs. webkit-host: 3 cases, 8 pairs.
  - They became history-dependent in round 2, and the record excludes them by design.
  - 32 of the 34 Firefox cases pass all four metrics in both orders.
  - List such pairs in the record.
- **Chrome's three tests seeds.**
  - The files are named for .50. Their `build` field says .48, the facts file is .48's, and the runs are .50's.
  - They were seeded from a symlink-assembled derivation folder (`tools/derived-dirs.sh`).
  - TESTS.md §12 hasn't run for .50.
  - Treat them as provisional, or drop them.
- **The "self-check: pass" lines carry no information.** Each new seed is checked against the runs it was seeded from.

### 7. Rules and conditions with constants or chosen by counts, not registered in CHARTER

**Blink `in-word-prefix` (`index.ts` `edgeGap`):**
- It rests on "within about 2 LayoutUnits" and a two-cluster wide window.
  - Neither number is read from source.
  - The narrowing took reports from 13,638 to 724.
- The condition is narrower than its own reading:
  - a line **end** reports only under the margin test;
  - a **start** also uses the wide window;
  - an interaction two clusters away changes an end reshape by more than rounding.
- Its cost is the 2,030 cases with wrong "exact" values.

**The painter's Blink hanging-space lines get no soft wrap box:**
- The owner's report says no source reading separates the 22 fixed cases from the regressions.
- It was decided by which family regressed.

**WebKit `page-history`:** its finite context set is a stand-in for the source condition. See item 5.

**Minor:** the registry entry `blink/measure/v8-slice-storage` still has V8 4323497a in its `source` field.

### 8. What the verdict leaves out
- **Firefox widths pass on 95.5%, 92.4% and 91.5%** of the development, held-out and sealed-2 suite samples.
  - On development, 989 of 1,013 prediction failures are covered by `in-word-prefix`, 974 of them by it alone.
  - Its lift is 4, so the "weak coverage" table shows Firefox at 0.
  - But Firefox's whole zero rests on that one condition.
  - I traced the break between joined letters across SHY in Amiri, 148 au (`c-1815bd730254961c`, `c-5954bc054c77782e`). Source backs the gap there.
  - The observation port still reports those rects as `predicted`.
- **Painter pass rates on the held-out and sealed-2 suites:** webkit-host 81.0% and 81.3%, Firefox 86.9% and 86.2%, Chrome 96%. `paint` still names no painter limit per line (tentpole 7).
- **Feature-family widths are unobserved for 96% of `rule/text-indent`** (952 of 992) and about half of `rule/line-slots`, in Chrome and Firefox.
  - Cause: the engine width includes the indent, and the rects don't.
  - CHARTER lists this scorer rule for WebKit only.

### 9. Process
- **The Blink owner re-ran a failed held-out job after a wrong diagnosis.** It is self-reported. It is the same rule the Gecko owner broke in round 1.
- **The evaluator queried Safari during the stall** (`osascript`, `log show`). It reported this itself.
- **Run records hold a bundle byte count, not a hash.** Record a hash.
- **Pin Chrome.** It moved from .48 to .50 mid-day.

## Checked and fine
- **Rows come from the committed library.**
  - All 182 rebuild-library run records carry bundle size 2,305,361. They run from 15:23 to 18:32: 60 Chrome, 54 Firefox, 63 webkit-host and 5 Safari. The fresh sets and the post-resume jobs are among them.
  - A bundle I built from the tree has the same size (sha256 c7e28602…).
  - `rebuild/src` and `rebuild/lab` equal bc49b0e apart from the lab README and baselines.
  - The last source mtime is 14:49.
- **Re-score.** Chrome `families` (10,976), Firefox `features` (11,946) and webkit-host `runs` (2,580), forward against reverse: the per-case files are byte-identical.
- **Against round 1** (`rescore-r1` against round 2 per-case files, recomputed):
  - no lineCount, breaks or widths pass became a fail in any browser;
  - Chrome painter: 138 lost;
  - webkit-host: 9 painter lost, 2 widths and 2 painter passes became unobserved;
  - gains match the report: Chrome lineCount 117 and breaks 168, Firefox 12 and 40.
- **Sealed-2.**
  - The lab owner generated it and checked id overlap only.
  - No engine owner or painter tool call or result touches the folder; they only read the plan and workflow text that name it.
  - No sealed-2 case id appears in any of the 8 round 2 transcripts, or in any evaluation output other than row files and the combined case file.
  - Sealed summaries hold no ids or families.
- **Triage refresh.**
  - Rewritten from round 2 rows in both orders: 420, 587 and 736 records, with categories as reported.
  - `c-aad1cfdbd82a76b7` is gone from Firefox's records.
  - Limit: the population is the charter census's list. No census ran with the round 2 library.
- **`c-66ae4ab7d56cb0ae`:**
  - 10 native lines in both orders of its set, with no gap on line 6;
  - alone in a fresh process, 11 lines and a pass.
- **Protocol rows:** 15 and 7, listed apart in the seeds.
- **Installed Safari:** the claims match the comparison files. I didn't re-verify the CPU-limit diagnosis.

## Traces

### Failures without a line-local gap
- **Chrome, U+3000 class:** `c-45d738663a9704be`, `c-5ad7c3e3754f4363`, `c-aa48ec15a2622076`, `c-b685f6ae4e4793e1`. Port bug, item 2. `c-e2fe65814d7d218e` is the same text; I read it from its details only.
- **Chrome `c-4a04b13ad0ab4062`:** the Allah ligature across the span edge `اللَّ` | `هِ`.
  - Natively run 2's first rect has width 0.
  - Predicted 19.41 and 4.625, both marked `predicted`.
  - Item 3.
- **Firefox 1 au class:** `c-268ee59b15a407a8`, `c-02e7d131f09e05b9`, `c-78c9f151226956de`, `c-13c64a6ce641374d`. One node, ±1 au.
- **Firefox `c-79be2d993c59de97`** (`LT: kerning pairs`): now probed; `LT:` is DOM 767 against Canvas 768.
- **Firefox `c-a2661c5b12f20aec`** (`⃣❤`): 786 au natively against 793 predicted, as reported. Not probed.
- **webkit-host `c-66ae4ab7d56cb0ae`:** as above.
- **Not traced:** Chrome `c-8c84627af834611f`.

### Gap-covered failures
- **Not backed:**
  - Chrome `c-906c6bc491c83c9d`, `c-a52d0bfda6f53a43` and `c-f1877e45ed22478e`: `script-context` on `»` (plus an unrelated `glyph-clusters` offset on `c-a52d…`), while the cause is the ligature across a span edge.
  - Chrome `c-522324a27e5bb6bd` and `c-430fa200ce40d3eb`: `script-context` on `« : »`, while the cause is U+3000.
- **Backed by source:**
  - Firefox `c-1815bd730254961c` and `c-5954bc054c77782e`: `in-word-prefix` at the break between joined letters across SHY.
  - Firefox `c-65224845034de429`: `font-fallback` on the line of the emergency break after a hyphen (gfxFont.cpp:741-753, probe F10).
  - webkit-host `c-67cd9bd538cb3e95`: `page-history` at the level boundary.
- **Plausible, cause not shown:** webkit-host `c-acea4ab8ab95d6d3`. The `canvas-language` range touches the quote that a generic family draws under `ko`; the difference is 0.745px.
- **Doubtful:** webkit-host `c-7753213c5fde9edc`.
  - `tab-stops` covers a width one float32 step off (31.1625004 against 31.1624985) on an RTL line under −4.4px letter spacing.
  - Float32 summation order fits that better than the space advance does.

## For round 3
1. **Scorer:** tighten coverage as in item 1, and re-count every set before any zero is claimed.
2. **Blink:**
   - per-word Canvas scripts (item 2);
   - `glyph-clusters`, or predicted cluster positions, at item edges and inside ligatures (item 3);
   - register or replace the two constants.
3. **Gecko:**
   - probe the keycap-heart node and the weight 500 string;
   - state N7 as inferred;
   - count rows matched by signature alone apart from probed ones.
4. **WebKit:**
   - widen `page-history` from the 13 rows of item 5 and `c-66…`;
   - try a Canvas pair test to narrow `letter-spacing-ligatures`: `W(a ZWNJ b)` against `W(ab)`. Untested.
5. **Lab:**
   - list pairs that leave a seed through new history dependence;
   - record a bundle hash;
   - generate a new sealed set;
   - observe indented lines' widths in Chrome and Firefox;
   - keep generating fresh sets each round.
6. **Baselines:** decide on the 68 painter pairs and on Chrome's .50 tests seeds.
