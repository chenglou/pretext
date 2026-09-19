# What each exactness recipe costs in Canvas calls and buys in cases

Frozen line (tag `correctness-line`), offline replay only, 2026-09-18. Worktree `~/github/pretext-rebuild-wt/recipes` (branch `x-recipe-costs`), clean, nothing committed. Output: `.artifacts/session/recipe-costs-20260918/`.

This report gives numbers and a ranking. It does not say where the line should be.

## 1. The short answer

- **Most Canvas calls do not decide lines.** One state turned off the per-cluster and per-character output and every gap detector that asks Canvas.
  - Chrome asks 44.2% fewer calls, Firefox 50.3% fewer, WebKit 14.6% fewer.
  - No case changes its line count, its breaks or a line width, on 194,443 no-facts cases.
- **One plain example:** "The quick brown fox…", 71 characters, Arial 16 px, 200 px wide, 3 lines.
  - Chrome asks 208 calls, of which 8 are plain widths. Firefox asks 174, of which 14 are plain. WebKit asks 30, of which 14 are plain.
  - With output and gap detectors off: 71, 14 and 24.
- **The three cheapest recipes to keep:**
  - Blink's safe-to-break tests with their reshapes: 0.1% of Chrome's calls; 182 cases per 10,000 lost when off.
  - Gecko's emoji recipe: 1.3% of Firefox's calls; 618 per 10,000 lost.
  - WebKit's shaping across inline boxes: 0.1% of WebKit's calls; 31 per 10,000 lost.
- **The most expensive recipe per case bought** is Gecko's ligature test by ink box.
  - It is 36.3% of Firefox's calls.
  - It changes 2 cases of 63,771.
  - 397 cases (62 per 10,000) can't be replayed without it.
- **The runtime font checks** are 12.5% of Chrome's calls and 41.7% of WebKit's in the headline configuration. They also add about 8 Canvas contexts per case in Chrome and 6 in WebKit.

## 2. How to read the numbers

- **Ask:** one `measureText` call that reaches Canvas. The per-layout memo answers the rest and is not counted. **First ask:** an ask whose context and string nobody asked before in the case.
- **Charged to a site:** the call site that first asks a string pays for it. A later site that needs the same string pays nothing. So "asks at its sites" and "calls saved when off" can differ a lot.
  - Example: Blink's float32 scan carries 16.8% of Chrome's asks and saves 0 when turned off alone, because the per-cluster output asks the same prefixes later.
- **Saved when off:** the baseline's asks minus the asks with the recipe off, over the cases that replayed.
- **Changed:** the full prediction differs from the frozen one.
- **Lost:** the lab's scorer (`lab/score.ts` `scoreRow`, painter left out) passes the frozen prediction on a metric against the recorded browser row (forward order) and fails the ablated one.
  - Line count counts first, then breaks, then widths.
  - **Gained** and **moved between two wrong answers** are read the same way.
  - Every changed case was scored, not a sample.
  - I cross-checked four lost cases by hand against the rows with `zstd -dc`: native 5, 2, 2 and 14 lines, frozen the same, ablated 4, 3, 3 and 19.
- **Cannot replay:** with the recipe off, the port asks a question the record doesn't hold. The replay can't answer it, and the case isn't compared.
  - These are cases where the recipe's answer mattered.
  - Their count is an upper bound on what the recipe buys. What they would lose needs a browser.
- **No longer named:** a failing line was covered by a gap the recipe named and is now an open failure. **More differing values:** a value that was marked a stand-in is now claimed, and it differs from the browser.
- **Fallbacks:** each ablation drops questions or reuses answers the port asks anyway. A gap detector that is off names nothing ("don't ask, don't name").
- **Rates** are per 10,000 cases of the engine's headline reference (no supplied font facts) unless "facts" is said: Chrome 66,685 cases, Firefox 63,771, webkit-host 63,987.
- **The tier 1 corpus is not ordinary text.** It is built from rule families, feature families and adversarial suites, many of them aimed at these recipes. Rates here are rates over that corpus.
- **Predicted values are a small share with no facts.** Only about 10% of per-rect values are claimed as predicted: Chrome 10.4%, Firefox 7.1%, WebKit 10.6%.
  - With the lab's facts the shares are Chrome 64.3%, Firefox 95.1%, WebKit 14.2%.
  - So a gap detector's worth shows mostly in the facts configuration. I ran that configuration for the large gap detectors.
- **Everything here is an offline hypothesis.**
  - Blink caches shaped words per canvas, so a Chrome case whose questions change needs tier 2 before anyone relies on it.
  - History-dependent cases were not set aside in my scoring.

## 3. Totals (predict phase, the library's own calls)

| Browser and configuration | Cases | Asks | Asks per 10,000 cases | Per case: median / 90th percentile / worst | Canvas contexts per case (median) |
|---|---|---|---|---|---|
| Chrome, no facts | 66,685 | 6,665,734 | 999,585 | 52 / 202 / 50,139 | 12 |
| Chrome, lab facts | 66,685 | 6,125,171 | 918,523 | 42 / 198 / 58,649 | 4 |
| Firefox, no facts | 63,771 | 4,731,161 (4,402,470 distinct) | 741,899 | 37 / 188 / 29,392 | 4 |
| Firefox, lab facts | 63,771 | 4,748,373 | 744,598 | 37 / 190 / 29,392 | 4 |
| webkit-host, no facts | 63,987 | 2,035,679 | 318,139 | 20 / 56 / 3,829 | 7 |
| webkit-host, lab facts | 63,987 | 1,227,012 | 191,760 | 11 / 41 / 3,820 | 1 |

- **Repeats:** Chrome's and WebKit's ask ratio is 1.00. Firefox's is 1.07. Its ink-box reads bypass the width memo, which costs 179,104 repeats.
- **Left out:** the WebKit observation port under `lab/observe` asks another 4,769,409 calls in its own phase. It is lab code, not the library.

## 4. The table

**Columns**
- Asks at the recipe's sites per 10,000 cases, with no facts, then with the lab's facts.
- Share of the engine's no-facts asks.
- Share of cases that trigger the recipe.
- Asks per triggering case, median and worst.
- When off: calls saved per 10,000 cases with the share of all calls, cases changed, cases lost (line count / breaks / widths), and cases that can't replay, all per 10,000.
- Role: decides lines or widths, names a gap, or fills an inspected value.
- Reach: local (one function) or structural.

**What the Notes column covers**
- Where the asks come from, the width-error sizes of lost widths, and the most affected families.
- The facts-configuration results where I ran them.
- What the ablation's fallback was, where that needs saying.

### 4.1 Blink (`rebuild/src/engines/blink/`)

| Id | What it asks Canvas | Where | Asks /10k | With facts | Share | Triggers | Median / worst | Off: saved /10k | Changed | Lost (count/breaks/widths) | Can't replay | Role | Reach |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B0 | Plain totals of a shaping group and its pieces | `shape.ts` `addCuts:737`, `measureGroups` | 60,551 | 60,550 | 6.1% | 99.0% | 3 / 5,716 | not a recipe | | | | decides | structural |
| B1 | Safe test for a cut of a group of 256 zoomed px or more: a wide window (3 or more long strings) and a pair window (3 strings) per candidate offset | `shape.ts` `passesSafeTest` in `addCuts` | 225,142 | 225,080 | 22.5% | 42.6% | 21 / 30,081 | a: 50,875 (5.1%); b: 119,620 (12.1%) | a: 121; b: 561 | a: 0; b: 0 | a: 0; b: 146 | decides where the cut goes | test local, cut structural |
| B2 | Position inside a group: the prefix from the last cut, measured alone | `shape.ts` `groupPrefix16:851` under `prefix16` | 22,677 | 38,143 | 2.3% | 56.0% | 3 / 61 | no fallback that only drops questions | | | | decides lines | structural |
| B3 | Adjustment on a position: pair window (3 strings), or the wide window before a space | `shape.ts` `positionAdjust16` | 68,368 | 97,196 | 6.8% | 76.5% | 7 / 1,124 | 144,617 (14.4%); facts 33,699 (3.7%) | 3,473; facts 2,541 | 49.3 (1.5 / 3.4 / 44.4); facts 104.1 (11.7 / 6.3 / 86.1) | 28; facts 12 | decides lines and widths | local |
| B4+B5 | Safe-to-break test in the line breaker and the line start and line end reshapes that follow | `shape.ts` `safeToBreak`, `reshape`, `reshapeHanKerningEnd`; `line-breaker.ts` `shapeLineWith` | 12,814 + 1,074 | 7,288 + 1,076 | 1.4% | 51.7% | 1 / 464 | 831 (0.1%) | 342 | 181.9 (13.2 / 2.7 / 166.0) | 7.9 | decides widths and lines | local |
| B6 | Pair window again under a letter spacing of 1/64 px (no liga, clig, calt) | `shape.ts` `pairAdjustNoLigatures16`; callers `index.ts` `lineEdgeGaps:370`, `edgeGap:280`, `positionLimit` | 98,059 | 19,725 | 9.8% | 74.3% | 8 / 2,075 | 97,455 (10.1%); facts 24,913 (2.8%) | 458; facts 255 | 0 | 87; facts 16 | names a gap | local |
| B7 | Line edge gap detectors: windows at the line's start and end, the margin's two prefixes, item edges | `index.ts` `lineEdgeGaps`, `edgeGap`, `itemEdgeGaps` | 34,289 | 21,337 | 3.4% | 60.5% | 4 / 120 | with B6's edge part 106,742 (10.7%); facts 20,987 (2.3%) | 3,012; facts 1,522 | 0 | 0 | names a gap | local |
| B8 | Bounds of a stand-in position next to the break candidate | `line-breaker.ts` `reportUncertainCandidate`, `shape.ts` `positionBounds` | 6,196 | 40,000 | 0.6% | 28.4% | 2 / 16 | 73 (0.0%); facts 278 | 349; facts 230 | 0 | 0 | names a gap | local |
| B9 | Prefix at every cluster of a run of unknown font, to decide whether to name `float32-precision` | `shape.ts` `floatWidthOfParts`, the `unknownRuns` loop | 167,796 | 10,393 | 16.8% | 23.0% | 35 / 11,525 | 0 alone; goes with B10 | 530; facts 184 | 0 | 0 | names a gap | local |
| B10 | Per-cluster advances of every item on every line | `index.ts` `shapeOf` from `lineOutput` | 137,634 | 364,281 | 13.8% (facts 39.7%) | 56.8% | 8 / 194 | 135,719 (13.6%); facts 358,731 (39.1%) | every case's cluster values | no line count, break or line width moves | 0 | fills inspected values | one call; structural to the model |
| B11 | HanKerning font data: the halt pair trim and 10 ink boxes per style | `hankerning.ts` `measureHanKerningFontData`, `trim16` | 26,605 | 26,605 | 2.7% | 20.6% | 12 / 60 | 26,123 (2.6%) | 216 | 19.9 (4.0 / 2.8 / 13.0) | 13.3 | decides widths and lines | local |
| B12 | Probe: does Canvas shape this style word by word (2 strings per style) | `shape.ts` `canvasSplitsWords` | 4,290 | 4,290 | 0.4% | 19.2% | 2 / 8 | 4,290 (0.4%) | 885 | 0 | 0 | names a gap; could decide letter spacing | local |
| B13 | Position limit at a clamped line start | `positionLimit` from `shapeLineWith` | 0 | 49 | 0% | 0.2% (facts) | 2 / 3 (facts) | not ablated | | | | names a gap | local |
| B14 | U+002D beside the hyphen, where `mapsHyphen` isn't known | `shape.ts` `shapeHyphen` | 1,428 | 1,428 | 0.1% | 14.3% | 1 / 2 | about 0 | 0 | 0 | 0 | names a gap | local |

**Notes on Blink**
- **B1:**
  - Ablation a runs the test at offsets beside a space first and elsewhere only when no space cut passed. The cuts are the same.
  - Ablation b asks Canvas nothing. Its cannot-replay cases are those where the cut moved.
  - Every changed case in a and b differs only in `script-context` gap entries, which are a side effect of measuring.
- **B3, no facts:**
  - Lost widths: 276 cases at 0.1 px or more, 20 under 1/64 px.
  - Also: 18 gained, 249 moved, 80 no longer named.
  - Families: rule/text-align 12.7% of its cases, suite/negative-space 17.3%, rule/controls 12.2%.
- **B3, facts:** 5,656 cases stop being exact.
- **B3, wide window only:** a separate ablation (pair window instead of wide window before spaces) can't be replayed in 3,804 per 10,000 cases, so it is not measured.
- **B4+B5:**
  - Lost widths: 1,004 cases at 0.1 px or more, 103 under 0.1 px. 172 cases moved.
  - Families: rule/in-word-breaks 29.3%, rule/text-align 22.7%.
- **B6:** `glyph-clusters` is named in 3,052 cases. It covered a failure in 6 (facts 1) and a differing value in 3 (facts 3).
- **B7:** it names in about 20,000 cases. It covered a failure in 10 (facts 3) and a differing value in 7 (facts 9).
- **B8:** others ask its strings anyway. It named in 1,234 cases and covered nothing.
- **B9:** `float32-precision` is no longer named in 363 cases (facts 38), none covering a failure.
- **B11:** any curly quote triggers it. Family runs/lang-spans 8.7%. Lost widths are all 0.1 px or more.
- **B12:**
  - The ablation assumed that Canvas shapes word by word.
  - No case moves. The wrong assumption adds a `script-context` gap to 855 per 10,000 cases.
- **B14:** the hyphen width itself is plain. The compare named 0 cases.

**Blink: not replayable offline (turning them off asks new strings)**
- B2 itself.
- The 256 px cut itself.
- Per-script-segment measuring (`measure16:414`): 28,785 asks per 10,000 cases, 2.9%.
- U+200D at joined edges.
- The per-style `lang` on contexts.

**Blink: contexts.** Every style makes 4 contexts: ltr, rtl, and the two no-ligature ones. Those are created even in a left-to-right paragraph that names no gap.

### 4.2 Gecko (`rebuild/src/engines/gecko/`)

| Id | What it asks Canvas | Where | Asks /10k | With facts | Share | Triggers | Median / worst | Off: saved /10k | Changed | Lost (count/breaks/widths) | Can't replay | Role | Reach |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G0 | Plain unit and space widths, the tab digit, the hyphen | `prepare.ts:1320,1347,1502-1520` | 66,092 | same | 9.0% | 98.9% | 5 / 1,838 | not a recipe | | | | decides | structural |
| G1a | Mid-word position: the suffix from the offset to the unit's end | `lines.ts` `inWordAdvance:188` | deciding 83,967; output 89,870 | same | 11.3% + 12.1% | 66.2%; 55.9% | 5 / 7,890; 9 / 7,021 | no drop-only fallback for the deciding half; the output half goes with G11 | | | | decides lines where a line breaks inside a unit (CJK, break-all, hyphens, span edges) | structural |
| G1b | What crosses the offset: cluster plus suffix and the cluster alone, or the prefix with U+200D | `lines.ts` `inWordAdvance:203,213-214` | deciding 59,758; output 46,714 | 59,487; 46,401 | 8.1% + 6.3% | 68.0%; 54.9% | 4 / 5,773; 5 / 1,247 | 82,291 (11.1%); facts 57,987 (7.8%) | 1,447; facts 643 | 0 | 0 | names a stand-in with no facts; decides with a pair-kerning fact | local |
| G2 | Ligature across an offset: the pair's ink box in the run's context and at 0.001 px | `lines.ts` `ligatureAcross` | deciding 135,031; output 135,480 | same | 18.2% + 18.3% | 61.5%; 52.2% | 8 / 10,704; 10 / 3,588 | 265,753 (36.3%) | 0.3 | 0 | 62.3 | decides advance shares inside a ligature | local; `groupSpans` and `rowAround` hang on it |
| G3 | Ligature groups by letter spacing: the unit and both sides at 2 px and 0.001 px | `lines.ts` `groupAcross` | deciding 38,833; output 63,036 | same | 5.2% + 8.5% | 62.5%; 47.1% | 2 / 3,396; 10 / 3,286 | 89,609 (12.8%) | 13.2 | 1.7 (0 / 0.8 / 0.9) | 277.4 | decides advance shares | local |
| G4 | Which glyph carries a pair adjustment, with a context at size × 2^k for odd kerns | `lines.ts` `pairKernedShare` | 0 | 3,386 | 0% (facts 0.5%) | 5.1% (facts) | 3 / 33 | facts 2,695 (0.4%) | facts 816 | facts 1.3 (0 / 0 / 1.3) | 0 | decides positions inside words | local |
| G5 | Does a space take part in shaping: a window of words whole against its units | `prepare.ts` `testStretch` | 9,156 | same | 1.2% | 59.4% | 1 / 725 | 9,870 with G6 (1.3%) | 0 | 0 | 0 | names a gap | local |
| G6 | Ligature groups of a letter-spaced unit at 2 px | `prepare.ts:1361` | 3,272 | same | 0.4% | 11.2% | 3 / 28 | with G5 | 3.4 | 0 | 0 | names a gap | local |
| G7 | Emoji: the cluster at the device size, in Apple Color Emoji at both sizes, two ink boxes, weight 400 for synthetic bold | `prepare.ts:1396-1470` | 10,245 | same | 1.4% | 10.1% | 6 / 77 | 9,953 (1.3%) | 652 | 618.0 (106.8 / 46.4 / 464.8) | 0 | decides widths and lines | local |
| G8 | A Unicode space no font covers, at the device size | `prepare.ts:1394-1395` | 445 | same | 0.1% | 2.1% | 2 / 8 | 438 (0.1%) | 2.8 | 2.8 (0 / 0 / 2.8) | 0 | decides widths | local |
| G9 | Script context: `context + ' ' + piece` less `context + ' '`, two asks for one | `prepare.ts` `rangeAu:546` | 28,661 (cuts across the rows above) | same | 3.9% | | | not replayable | | | | decides widths | local |
| G11 | Per-character advances of every frame on every line (the output halves of G1 to G3) | `lines.ts` `characters` from `lineOutput` | 335,100 | same | 45.2% | 56% | | 303,778 (40.9%) | every case's character values | no line count, break or line width moves | 0 | fills inspected values | one call; structural to the model |

**Notes on Gecko**
- **G1b, no facts:** `in-word-prefix` is no longer named in 2,500 cases, none covering a difference, because every value already sits under `optical-size`.
- **G1b, facts:** 988 failures are no longer named and 1,909 cases stop being exact.
- **G2:** the 2 changed cases keep their verdict. The cannot-replay cases are those where a ligature was found, and then the fallback asks a suffix nobody recorded.
- **G3:** lost widths are 0.1 px or more, in suite/joined and runs/letter-spacing-spans. 3 cases moved.
- **G4:**
  - Lost widths are under 0.1 px.
  - 4,565 cases change only in flags.
  - The scorer excuses positions that turn into stand-ins, so this undercounts what G4 buys in claimed positions.
- **G5:** it named 0 cases of 63,771.
- **G6:** 22 cases lose a `glyph-clusters` name that covers nothing, in both configurations.
- **G7:**
  - Lost widths are all 0.1 px or more.
  - Families: policy/emoji 98% of its cases; the emoji suites 100%.
- **G8:** lost widths are 0.1 px or more, in runs/word-spacing-spans.

**Gecko: combined state.** G1b, G2, G3, G5 and G6 off together, output kept:
- 427,551 calls per 10,000 saved (61.9%).
- 12 cases lost (5 breaks, 7 widths).
- 2,020 cases can't replay (317 per 10,000).

### 4.3 WebKit (`rebuild/src/engines/webkit/`)

| Id | What it asks Canvas | Where | Asks /10k | With facts | Share | Triggers | Median / worst | Off: saved /10k | Changed | Lost (count/breaks/widths) | Can't replay | Role | Reach |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W0 | Item, space, range and hyphen widths, as `TextUtil::width` measures | `measure.ts` `boxWidth`, `content.ts` `handleTextContent` | 85,590 | 85,656 | 26.9% | 95.4% | 5 / 2,074 | not a recipe | | | | decides | structural |
| W7 | Mid-word break: the engine's own probe sequence over prefixes | `measure.ts` `breakWord` | 7,701 | 7,538 | 2.4% | 24.0% | 2 / 90 | no fallback; the engine asks the same | | | | decides lines | structural |
| W1a | Does any listed family resolve: a space under `list, LastResort` and under `LastResort` | `content.ts` `makeBox:268-270` | 1,895 | 1,895 | 0.6% | 7.4% | 2 / 10 | 1,895 (0.6%) | 0 | 0 | 0 | decides the font list | local |
| W1b | Primary font coverage per code point of a fixed-pitch box (3 contexts) | `content.ts` `makeBox:291-300` | 31,012 | 31,012 | 9.7% (facts 16.2%) | 9.4% | 21 / 141 | 27,442 (8.6%) | 3.0 | 3.0 (0 / 0 / 3.0) | 1.9 | decides simplified measuring; names `font-fallback` | local |
| W2 | Merged glyphs under letter spacing: counts at 64 px per cluster, pair and string | `measure.ts` `mergedGlyphs` | 26,818 | 6,626 | 8.4% | 11.7% | 20 / 178 | 29,146 (9.2%); facts 6,431 (3.4%) | 34.5; facts 6.9 | 0 | 8.6 | decides widths under letter spacing; names a gap | local |
| W3 | VT, FF and CR: pair tests around the control, then pieces | `measure.ts` `controlIsAdjusted`, `measureDomString` | 422 | 422 | 0.1% | 1.4% | 3 / 9 | 205 | 1.4 | 0.9 (0 / 0 / 0.9) | 23.1 | decides widths | local |
| W4a | Which family draws a character: list against `LastResort`, per code point | `lines.ts` `itemGaps`, `content.ts` `familyDraws` | 23,047 | 23,047 | 7.2% | 7.1% | 18 / 2,238 | W4 and W5 together: 46,419 (14.6%); facts 57,634 (30.1%) | W4 and W5 together: 3,851; facts 1,950 | 0 | 0 | names a gap | local |
| W4b | Simplified measuring: every code point alone against the total | `lines.ts` `itemGaps:2612-2615` | 15,000 | 28,980 | 4.7% (facts 15.1%) | 29.8% | 3 / 93 | see W4a | see W4a | 0 | 0 | names a gap | local |
| W4c, W4d | Merged glyphs, controls and the fixed-pitch shortcut test, asked again for gaps | `lines.ts` `itemGaps` | 2,370 | 261 | 0.7% | 4% | 2 / 262 | see W4a | see W4a | 0 | 0 | names a gap | local |
| W5 | Page-history worlds: item widths of the other item lists the break cache could hand a box | `content.ts` `collectHistoryWorlds`, `lines.ts` `pageHistoryGaps` | 6,628 | 6,047 | 2.1% | 22.7% | 2 / 20 | see W4a | see W4a | 0 | 0 | names a gap | local; it also lays lines out again per world (CPU, not counted here) |
| W6 | RTL text shaped across inline boxes: totals of the joined text from each run on | `lines.ts` `applyShapingOnRunRange` | 218 | 218 | 0.1% | 0.6% | 3 / 7 | 209 (0.1%) | 54.1 | 31.4 (12.7 / 3.4 / 15.3) | 3.0 | decides widths and lines | local |

**Notes on WebKit**
- **W1b:** the 19 lost widths are 0.1 px or more.
- **W2:** 6 failures are no longer named. The cannot-replay cases are those where merged pairs were separated.
- **W3:** lost widths are under 0.1 px. 3 cases moved.
- **W6:** family rule/joining 22% of its cases. 81 cases stop being exact.
- **W4 and W5 together** name gaps in about 24,600 cases with no facts and about 12,500 with facts. 443 failures are no longer named and 22 cases hold more differing values, the same in both configurations. Split by gap name:

| Gap | Cases named (no facts; facts) | Failures it covered | Differing values it covered |
|---|---|---|---|
| `canvas-language` | 1,552 | 151 | 0 |
| `simplified-measuring` | 18,917; 5,790 | 78; 21 | 13; 11 |
| `letter-spacing-ligatures` | 276; 99 | 27 | 0 |
| `control-character-width` | 509 | 79 | 1 |
| `fixed-pitch-path` | 319; 90 | 0 | 0 |
| `page-history` | 5,820 | 234 | 22 |

### 4.4 Shared: the runtime font checks and the Canvas checks (`rebuild/src/measure/`)

These run only for a fact the caller left null. With the lab's facts they are 48 asks per 10,000 cases in Chrome and 56 in WebKit. Gecko is asked nothing.

| Id | What it asks | Where | Chrome asks /10k (share; triggers) | WebKit asks /10k (share; triggers) | Off: saved /10k | Changed | Lost | Can't replay | Role | Reach |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | Primary family: a space under `F, monospace` and `F, serif`, and under the two generics | `font-checks.ts` `primaryFamily`, `draws` | 45,451 (4.5%; 100%) | 44,321 (13.9%; 100%) | WebKit, answer not given to the engine: 4 | 0 | 0 | 0 | Blink: feeds S2 and S4 only. WebKit: primary font paths | local |
| S2 | Does the primary font map U+2010 | `draws(…, HYPHEN)` | 7,885 (0.8%; 19.7%) | 8,168 (2.6%; 20.4%) | 7,874; 8,156 | 0; 0 | 0 | 9.0; 10.0 | decides the hyphen string | local |
| S3 | Fixed pitch: `i`, `M`, `.` and the space (WebKit) | `fixedPitch` | not asked | 64,949 (20.4%; 99.7%) | 75,483 (24.7%), with W1b that then doesn't run | 51 | 0 | 544 | decides the fixed-pitch width and `breakWord` shortcuts | local |
| S4 | Do advances scale between the CSS size and the zoomed size (Blink, zoom other than 1) | `scalesLinearly` | 68,579 (6.9%; 99.3%) | not asked | 106,119 (10.6%), with S1 that then isn't asked | 9,722 | 0 | 0 | removes a gap; never changes what is measured | local |
| S5 | Joining technology: beh and U+07FA alone and together (Blink) | `joining` | 9,713 (1.0%; 15.2%) | not asked | 8,107 (0.8%) | 219 | 0.1 | 498.6 | decides edge forms between joining letters | local |
| all | The five together | `learnedFacts` | 131,628 (13.2%) | 117,438 (36.9%) | Chrome 129,365 (12.5%); WebKit 127,486 (41.7%) | 9,261; 51 | 0.1; 0 | 508; 554 | | |
| C | Canvas checks: 2 asks and 2 contexts, once per page | `canvas-checks.ts` `missingCanvasSupport` from `env.ts` `detectEngine` | | | | | | | guards the recipes against a Canvas that differs | local |

**Notes on the shared checks**
- **Ablation helpers:**
  - Without a fact, each port's own fallback detector asks strings the record doesn't hold. These are the U+002D compare (S2) and the fixed-pitch width test (S3).
  - So those detectors were off too in the font-check ablations.
- **S1:** S2 and S3 still need its answer, so not giving it to the engine saves nothing.
- **S2:** the cannot-replay cases are fonts that don't map U+2010.
- **S3:**
  - The changed cases differ in flags only.
  - Cannot-replay cases are those with fixed-pitch fonts.
  - Earlier browser measure (research/FACTS-FREE.md): 30 webkit-host cases lost without the monospace fact.
- **S4:**
  - With it off, the `optical-size` gap comes back on every style.
  - No width, break or value moves.
  - On the frozen line the gap sits on 3.3% of Chrome cases.
- **S5:**
  - With it off, `joining-technology` is named in 1,459 cases.
  - Cannot-replay cases are those with joined edges.
  - Earlier browser measure (FACTS-FREE.md): 2,183 Chrome cases lost without the joining fact.
- **Contexts:**
  - Chrome: about 8.3 more Canvas contexts per case (13.4 against 5.2 with facts).
  - WebKit: about 5.8 more (7.8 against 2.0).
  - Each probe list such as `F, monospace` is a context of its own.
- **C:** not in the replay, because the lab predictor never calls `detectEngine`.

## 5. Ranking, from cheapest to keep to most expensive per case bought

Price = Canvas calls saved when the recipe is off alone, divided by the cases lost, on the no-facts reference. "+n" = cases that can't replay and may be lost too.

**Recipes that decide lines or widths**

| Rank | Recipe | Calls saved | Cases lost | Calls per case bought |
|---|---|---|---|---|
| 1 | B4+B5 safe-to-break tests and reshapes | 5,539 | 1,213 (+53) | 4.6 |
| 2 | W6 shaping across inline boxes | 1,340 | 201 (+19) | 6.7 |
| 3 | G7 emoji | 63,473 | 3,941 | 16 |
| 4 | S5 joining check | 51,369 | 1 (+3,325) | 15 if every unreplayable case is a loss |
| 5 | S3 fixed-pitch check | 456,718 | 0 (+3,481) | 131 at best |
| 6 | G8 synthesized space | 2,795 | 18 | 155 |
| 7 | W3 VT, FF and CR | 1,310 | 6 (+148) | 218; 8.5 at best |
| 8 | G3 ligature groups by letter spacing | 555,593 | 11 (+1,769) | 50,508; 312 at best |
| 9 | B1b safe test for cuts | 786,062 | 0 (+972) | 809 at best |
| 10 | S2 hyphen check | 52,458 (Chrome); 52,134 (WebKit) | 0 (+60; +64) | 870 at best |
| 11 | B11 HanKerning | 173,968 | 133 (+89) | 1,308 |
| 12 | B3 position adjustment | 961,657 | 329 (+188) | 2,923 |
| 13 | W2 merged glyphs | 186,339 | 0 lost, 6 names (+55) | 3,055 at best |
| 14 | G2 ligature ink box | 1,684,180 | 0 (+397) | 4,242 at best |
| 15 | W1b coverage probe | 175,557 | 19 (+12) | 9,240 |

- For rank 4, earlier browser data says 2,183 cases were lost without the joining fact.
- For rank 5, earlier browser data says 30 cases were lost without the monospace fact.
- For rank 12, with facts the price is 323 calls per case (224,452 calls, 694 lost).

**Recipes that only name a gap**

Price = calls per failure or differing value the name covered.

| Recipe | Calls | Covered | Calls per covered item |
|---|---|---|---|
| W4d controls and fixed-pitch gaps | 625 | 80 | 8 |
| G1b with facts | 369,794 | 2,897 | 128 |
| W5 page-history worlds | 42,413 | 256 | 166 |
| W4c merged glyphs | 14,538 | 27 | 538 |
| W4a family draws | 147,473 | 151 | 977 |
| W4b simplified measuring | 95,982 | 91 | 1,055 |
| B7 with facts | 139,950 | 12 | 11,663 |
| B7 no facts | 711,810 | 17 | 41,871 |
| B6 no facts | 644,233 | 9 | 71,581 |
| G1b no facts | 524,775 | 0 | — |
| G5 | 58,389 | 0 | — |
| B12 | 28,608 | 0 | — |
| G6 | 20,869 | 0 | — |
| B8 | 486 net | 0 | — |
| B9 | 2 net (1,118,950 at its sites) | 0 | — |
| S4 | 707,655 | 0 | — |

- B12 keeps a wrong `script-context` gap off 5,700 cases.
- S4 keeps `optical-size` off 96.7% of Chrome cases.

## 6. Recipes whose removal loses nothing on the recorded cases

Nothing lost, nothing unnamed, nothing unreplayable:
- **B1a**, safe tests beside spaces first: −5.1% of Chrome's calls, same cuts.
- **B8** uncertain candidate, **B14** hyphen compare, **B9** float scan: 0 calls saved alone; 349, 0 and 530 cases per 10,000 lose a name that covers nothing. B9's 16.8% goes only together with the output path.
- **B12**, assume Canvas shapes word by word: −0.4%. It adds a `script-context` gap to 855 cases per 10,000.
- **S4** optical-size check with the primary family check it needs: −10.6% of Chrome's calls and about 4 contexts per case. The `optical-size` gap returns on every style; no value moves.
- **G1b** with no facts: −11.1% of Firefox's calls. With facts it names 2,897 real differences, so it isn't free there.
- **G5** space-in-shaping: −1.2%; named 0 cases of 63,771.
- **G6**: −0.4%; 22 names that cover nothing.
- **W1a**: −0.6% of WebKit's calls.
- **S1** not given to the WebKit engine: no case changes. It saves nothing, because S2 and S3 still need the answer.

Candidates to move to the inspected path (they fill values, not lines):
- **B10**, Blink per-cluster output: −13.6% no facts, −39.1% with facts.
- **G11**, Gecko per-character output: −40.9%.

All of those together ("lines only"): Chrome −44.2%, Firefox −50.3%, WebKit −14.6%. There are 0 line count, break or line width changes on 194,443 cases.

Near zero:
- **B6**: 9 covered items; 87 cases per 10,000 unreplayable.
- **B7**: 17 covered items.
- **W2**: 6 names; 8.6 cases per 10,000 unreplayable.
- **G2**: 0 lost; 62 cases per 10,000 unreplayable.

## 7. What I couldn't measure offline, and the browser run that would

1. **Cases that ask new questions with a recipe off.**
   - Counts are in the tables above.
   - Their ids are in `needs-browser/<state>.<browser>-<config>.cannot-replay.ids`.
   - Run per file: apply the state's patch in a scratch worktree, then `bun rebuild/tests/browser-sets.ts --browser=<b> --config=<c> --ids-file=<file> --out=<dir>` through the browser lock.
   - Largest files: S3 webkit-host 3,452 ids; S5 Chrome 3,323; G2+G3 Firefox 2,012; B1b Chrome 961; B6 573; B3 188.
2. **Recipes with no drop-only fallback:**
   - Blink's mid-group prefix (B2), the 256 px cut itself, per-script-segment measuring, U+200D at joined edges, per-language contexts.
   - Gecko's suffix (G1a) and script context (G9).
   - WebKit's `breakWord` probes (W7).
   - Blink's wide window alone (38% of Chrome cases unreplayable).
   - Each needs a recording run with the change in a scratch folder (`browser-sets.ts --record`, which I may not run), then a replay of that record.
3. **What S4, G4 and B12 buy in values the port may claim as exact.**
   - My replays didn't record predicted-value counts.
   - One more offline replay each with those counts would answer it. I had no replay left.
4. **Wall time.**
   - Calls aren't equal: long strings against single characters, ink-box reads, context creation.
   - Font checks add 6 to 8 contexts per case.
   - Blink makes 4 contexts per style up front.
   - That is for the profiling phase.
5. **The Canvas checks:** once per page, outside the replay. `rebuild/research/VERSION-DRIFT.md` has the one build where they mattered.
6. **Order effects in Chrome** for every dropped question: tier 2 on the changed cases.
7. **Whether a named gap matters to a caller:** not a number.

## 8. Method and files

- **Cost.**
  - `tools/cost.ts` replays every case and reads the whole library stack of each ask.
  - It works through `replay.ts` `replayCase` and its site tally, with a stack map that always answers. Nothing in `rebuild/src` counts anything.
  - `tools/classify.py` groups chains into recipes and writes `reports/cost-*.json`.
- **Benefit.**
  - `tools/make-patches.py` writes one patch per ablation (32 files in `patches/`).
  - `tools/run-state.sh` applies the patches, replays, and runs `git checkout`.
  - `tools/ablate.ts` compares with the frozen reference and scores both predictions against the recorded native rows. `tools/native-store.ts` cut those rows like the input shards.
  - `tools/analyze.py`, `tools/families.py` and `tools/summarize.py` read the results into `reports/ablations/`.
  - `tools/value-states.py` counts predicted against limited values in the frozen references. It reads files only.
- **Replays used: 60 browser-and-configuration passes.**
  - 6 for the `--sites` baseline (every case the same as the frozen reference).
  - 6 for the cost pass.
  - 48 ablation passes in 18 working-tree states, with one patch per engine per state, because the ports don't share files.
  - Small self-tests of every patch on the 300-case smoke set are not counted.
- **Nothing was recorded, packed, frozen, adopted or seeded.**
  - No tracked file is changed.
  - The `.check` folder the baseline left in the worktree went to the Trash.

## Limits of this table

- Replay budget is fully used: 60 browser-and-configuration passes (6 sites baseline, 6 cost pass, 48 ablation passes in 18 working-tree states with one patch per engine per state). Small self-tests of each patch on the 300-case smoke set are not counted as tier 1 replays. No replay is left for follow-ups.
- Recipes whose fallback asks new questions could only be bounded: the cases that can't replay are counted and their ids saved under needs-browser/, but what they lose needs a tier 2 browser run. Largest: WebKit fixed-pitch check 3,481 cases, Blink joining check 3,325, Gecko ligature tests 2,020 together, Blink cut safe test 972.
- Blink's wide-window ablation (B3w) could not be measured: 38% of Chrome cases (25,368) ask unrecorded questions with it off.
- Several recipes have no drop-only fallback and were costed but not ablated: Blink's mid-group prefixes, the 256 px cut itself, per-script-segment measuring, U+200D edges and per-language contexts; Gecko's mid-word suffix and script-context strings; WebKit's breakWord probes. They need a recording run, which this job was not allowed to make.
- The benefit of recipes that remove a gap or place an adjustment (Blink's optical-size check S4, Gecko's pair share G4, Blink's word-split probe B12) is undercounted: the scorer excuses values that turn from claimed to stand-in, and my replays didn't record predicted-value counts.
- With no supplied facts only about 10% of per-rect values are claimed as predicted, so gap detectors show almost no worth in the headline configuration. I ran the facts configuration for the large detectors (B6, B7, B8, B9, G1b, G5+G6, W4+W5) but not for every recipe.
- Rates are over the tier 1 corpus, which is built from rule and feature families and adversarial suites aimed at these recipes. They are not rates of ordinary text.
- Scoring used the forward-order recorded rows and the lab's scoreRow directly, painter left out. History-dependent cases were not set aside as the ledger does.
- All results are offline hypotheses. In Chrome a case whose questions change needs tier 2 because Canvas answers can depend on the order of questions.
- Calls are counted, not time. Context creation is not counted as a call: the font checks add about 8 contexts per case in Chrome and 6 in WebKit, and Blink creates 4 contexts per style up front.
- Combined states were attributed to their two detectors by gap name (B8 and B14, G5 and G6, W4 and W5). Calls saved for those pairs are per state, not per detector.
- The baseline `replay.ts check --sites` run left a gitignored rebuild/tests/.check folder in the worktree; I sent it to the Trash. The worktree is clean and nothing was committed, recorded, frozen, adopted or seeded.
