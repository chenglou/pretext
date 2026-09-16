# Blink port audit (Chrome 153.0.8010.48)

An adversarial pass over `rebuild/src/engines/blink`, `tools/gen-blink-data.ts` and `specs/blink-RESULTS.md`, 2026-09-16.
No engine code was edited and no browser was launched. The owner's rows were scored again with the current
`rebuild/lab/score.ts` (outputs under `.artifacts/lab/blink/audit/`). Cases were traced from their rows: native derived
lines, predicted lines, native rects, and the pinned Chromium and HarfBuzz sources. The traces use three scratch tools,
which are outside the repo:

- `audit-dump.ts` prints a row's styles, native lines, predicted lines and metrics, using the scorer's own derivation.
- `audit-gaps.ts` runs the engine in bun with a stand-in Canvas and lists the gap names each case reports next to its
  metrics.
- `audit-arabic.ts` finds native line starts between joining letters, by font and metric.

Blocking findings come first. "Units" are 1/128 CSS px, one LayoutUnit at DPR 2.

## 1. Blocking findings

### B1. HanKerning's group-start trim sits at the first cut, not on the first character

`measureGroups` subtracts the start trim only from `prefixAtCut[1..]` (shape.ts:219-224). `groupPrefix16` computes an
offset inside the first piece as `prefixAtCut[0] + measure16(cuts[0], k)`, which has no trim (shape.ts:242). Blink halts
the group's first character (han_kerning.cc AppendFontFeatures start context, which shape.ts:258-259 itself cites), so
every position after that character includes the trim. In the port, positions inside the first piece miss it, and
positions after the first cut include it.

- `c-07f2657d11bf821f` (runs/lang-spans, owner's class 1 example). The span group `《书名》：标点；符号……` (zh-Hans, 16px)
  follows `」`, so `《` is halted. 12 glyphs at 32 zoomed px is 384 ≥ 256, so the group is halved at 15. Line 0 ends at 11,
  inside the first piece: predicted 168px, native 160px. Line 1 takes the trim instead: predicted 144px, native 152px.
  Both lines are off by exactly one halt (8px).
- `c-111dee8e6a53b668` (owner's example). The group `「四叔」是一個講理學的老監生。` (18px) follows `）`. 15 × 36 zoomed px
  is 540, so the cuts are [30, 37, 41, 45]. Line 3 [34, 43) takes P(43), which has the trim, and P(34), which doesn't:
  predicted 153px, native 162px (−1152 units, one halt at 18px).

Neither is a Canvas limit. The named gap `han-kerning` fires on every 16-bit paragraph with fullwidth punctuation: all
335 passing runs/lang-spans cases report it. So the gap hides this bug rather than marking where Canvas can't help.

### B2. `safeToBreak` ignores the unsafe offsets HanKerning adds

Blink adds HanKerning's unsafe-to-break offsets to the shape result (harfbuzz_shaper.cc:1044-1048). A wrapped line that
starts at a halted mark therefore reshapes its start with `is_line_start`, and the mark comes back at full width.
`safeToBreak` returns true at a group start and never consults HanKerning (shape.ts:308-318).

- `c-5325d5f65e230b90` (owner's example). Line 4 starts at 23, on `《` after `（종로구）`. The port keeps the paragraph's
  trim: predicted 100px, native 110px (−1280 units).

All three class-1 examples in blink-RESULTS.md are port bugs (B1, B2), not the causes RESULTS gives: which glyph a
`chws` adjustment sits on, segments narrower than groups, or the 「「 probe. Most of runs-r3 lang-spans' 18 width
failures probably follow the same two patterns. That is an inference; I traced 3.

### B3. Arabic joining is treated as safe to break, contradicting pinned HarfBuzz

- **HarfBuzz source.** `safe_to_insert_tatweel` falls back to `unsafe_to_break` unless the buffer asks for tatweel flags
  (hb-buffer.hh:517-527). The Arabic shaper calls it for every joining pair (hb-ot-shaper-arabic.cc:332, 366). This was
  read in chromium-152's HarfBuzz 28f4dc62; 153's pinned dfdc088c isn't in the sparse checkout. Blink sets no buffer
  flags: a grep of 153's platform/fonts/shaping/*.cc finds none.
- **Blink.** So every joining offset is unsafe to break, in every font, and Blink reshapes line edges between joining
  letters. OpenType fonts keep their joined forms because a reshape carries HarfBuzz context (blink-gaps §3.1). AAT
  fonts such as Geeza Pro lose them (probes-chrome correction 3). blink-gaps §3.2 is right here.
- **The port.** `safeToBreak` checks only the ZWJ pair total, which is 0 at a join, so joins count as safe. Line-start
  reshapes, the line-end reshape loop and their ceil64 differences at joins aren't ported. The comments at
  index.ts:119-120 and :399-403, and RESULTS class 2, explain this with painter.md §3.1 a. painter.md:131 cites only the
  `unsafe_to_concat` lines (:337-345, 370) and misses :332 and :366.
- **Inconsistency.** `measure16` adds a ZWJ only inside a group (shape.ts:132-133). Inside a group it models OpenType
  behaviour (joined), and at a group edge AAT behaviour (not joined). probes-chrome blink-text H3 shows OpenType Arabic
  does join across groups.
- **Rows.** Geeza Pro line starts between joining letters: runs-r3 has 92 such lines in width-failing cases and 17 in
  break-failing cases; policy-r4 has 15 and 12. `c-a6803706e450767e` line 20: native `ل` 8.734375px (isolated), predicted
  5.21875px. `c-0dd1d404ea812dbc` natively breaks at 7 and 13 where the port breaks at 9 and 17. The gap
  `unsafe-to-break` is reported for these, but the stated mechanism is wrong.

### B4. `script-context` is never reported, and its recipe isn't implemented

- **DESIGN.** §4.2 gives Blink contexts an '8bit' or '16bit' partition. §5 names the gap `script-context` with a recipe:
  measure a Common-only word in the context whose storage class matches the paragraph.
- **The port.** Every context has `partition: ''` (shape.ts:58), and index.ts never adds `script-context`.
- **Case.** `c-26a7a7b28da24b44` (smoke, suite/source-shaped-arabic): Amiri 24px `سلام((tail` at width 8. Line 4 `(`:
  native 10.9921875px, predicted 6.125px (−623 units). In the paragraph the `(` after Arabic takes the Arabic script;
  the port's line-start reshape measures `(` alone, which Canvas shapes as Latin or Common.
- **Reporting.** The case reports only `unsafe-to-break`, and RESULTS has no class for it.

### B5. The painted extent leaves out controls that natively have width; the C1 class is misattributed

`paintedExtent` treats C0 and C1 controls as having no ink and measures the extent between glyph edges when they have
width (index.ts:287-345).

- `c-7dcfed3b3b987d59` (smoke, suite/U+008D/middle), line 1 `b` + U+008D. Natively U+008D has a 16px positive rect, and
  the scorer's extent (node rects) is 24.8984375px. The painted line is also 24.8984375px. The port predicts 8.8984375px
  (−2048 units).
- The browser draws the control in both the paragraph and the painted line, so Canvas isn't the difference.
- RESULTS class 4 says C1 controls "still measure differently (c-5bb28a79f6310f0d: Canvas 16px for U+009D)". That case
  doesn't fail in smoke-r4: its widths are unobserved and its painter metric passes.
- The rule belongs to the extent, not to measurement. It is a hand-written copy of the lab's "visible code points"
  wording. That copy disagrees with what score.ts derives, and its invisible list differs from the scorer's
  `\p{Default_Ignorable_Code_Point}` (U+061C, U+180E, U+3164 and tag characters, for example). Settle which one is right
  in lab/ISSUES.md or in the engine.

### B6. Canvas-versus-DOM losses that hold but aren't reported (DESIGN §5)

index.ts reports `control-character-width`, `soft-hyphen-shaping`, `font-fallback`, `han-kerning`, `ui-language`,
`optical-size`, `unsafe-to-break` (joining only), `float32-precision` and `dictionary-breaks-unavailable`. Missing:

- **`unsafe-to-break` for kerning and ligatures at a chosen break.** Only joining letters report it. The port puts the
  whole pair adjustment on the glyph before a cut (shape.ts:216, 242). blink-gaps §3.6 L1 says legacy `kern` fonts put
  `d >> 1` there: Helvetica, Times, Times New Roman.
- **`in-word-prefix`.** Never reported, though breaks inside words (overflow-wrap, break-all, CJK) happen in fonts with
  kerning.
- **`script-context`.** Never reported (B4).
- **Tab stops.** They count from the untruncated float space advance: SimpleFontData::SpaceWidth, simple_font_data.cc:
  239-240. Canvas gives HarfBuzz's 16.16 advances (harfbuzz_face.cc SkiaScalarToHarfBuzzPosition). `c-87e013cf240ecbdc`
  is off by −1 unit, and no gap is reported. RESULTS says "no gap name fits"; that needs a shared gap name, not silence.
- **`optical-size`.** probes-chrome correction 7 (a verdict) says a system-ui DOM width equals Canvas at the CSS size,
  scaled. The port measures at size × zoom and reports the gap only when the family string matches
  `/system-ui|BlinkMacSystemFont/` (index.ts:115). It follows the refuted spec claim. Only a few lab cases use these
  families.
- **Failing cases with no gap at all**, from the stand-in census:
  - runs-r3: 20 of 85. 17 are letter-spacing-spans and 3 word-spacing-spans, all Geeza Pro, where spaces in cursive runs
    missed letter spacing. The owner fixed this after runs-r3; it stays unverified until runs-r4.
  - smoke-r4: `c-544518dd1f5540d5` (resumed-zero-tail, ProbeShantell bold with letter spacing 1px). The last line `d` is
    predicted 11.9453125px against native 12.046875px (−13 units). RESULTS doesn't mention it, and it isn't explained.
  - ws-r5: `c-87e013cf240ecbdc` (tabs, above).
  - policy-r4: the 3 Thai break-all cases, where the lab observation is at fault, not the port.

### B7. Uncited measurement cuts: `MAX_PIECE = 32` and cuts at space edges

shape.ts:23 and :194-199 cut every group at each space edge and every 32 code units, then halve pieces until each is
below 256 zoomed px. Blink shapes a group in one call. One Canvas call is exact below 256 px (blink-canvas §1.5), and
DESIGN §4.4 and blink-gaps §3.5 (L4) call for cuts only where totals stop being exact.

- Each extra cut replaces an exact total with a sum of pieces plus a pair adjustment. That sum is exact only for pair
  kerning; contextual lookups wider than one grapheme per side change it (blink-gaps §3.6 L2-L3).
- The cuts are also where B1 moves the HanKerning trim.
- The constant and the space-edge rule have no source.

## 2. Scores, scored again

Current score.ts, same rows and case files; pass/fail/unobserved.

| Run | lineCount | breaks | widths | painter | Matches RESULTS |
|---|---|---|---|---|---|
| smoke-r4 | 296/3/0 | 290/3/6 | 263/10/17 | 280/15/4 | yes |
| ws-r5 | 1019/0/0 | 1017/0/2 | 975/1/41 | 970/16/33 | yes |
| runs-r3 | 2563/8/9 | 2541/29/10 | 2401/56/84 | 2401/99/80 | yes |
| policy-r4 | 1605/1/0 | 1599/7/0 | 1596/3/0 | 1598/8/0 | yes |
| suite-r1 (8 chunks summed) | 19333/660/1 | 19064/706/224 | 14593/1665/2806 | 15182/4645/167 | yes |

- **measureText calls.** Recomputed from the rows: mean, median, max and calls per line match for smoke-r4, ws-r5,
  policy-r4 and runs-r3. The one difference is smoke-r4's p95, 113 against 114, which comes from the percentile method.
- **Tests.** `bun test rebuild/src/engines/blink` gives 13 pass, including 13,108 oracle requests with 0 differences.
  `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean. I didn't run all of `bun test rebuild/src`.
- **Queued reruns.** runs-r4 and suite-r2 never started. Both logs still read `[lock] waiting; owner: job=chat-100k
  levers` from 09:26:56. So suite-r1 describes an older build, from before the extent, `joinsNextLine`, HanKerning and
  cursive-spacing changes.
- **Suite chunks 02 and 03** are entirely `suite/maintained/accuracy` and pass every metric (5,000 of 5,000).
- **Single-line passes.** They test widths but no break policy: 189 of 1,596 policy-r4 passes, 225 of 975 ws-r5 passes
  and 120 of 2,401 runs-r3 passes. Examples: `c-f73441e37755d103` (line-break strict) and `c-24409bad22fb8462`
  (keep-all).

## 3. Search for rules that aren't ported

- **DOM reads.** None in the engine directory: no getBoundingClientRect, offsetWidth, getComputedStyle, or document,
  window or navigator reads.
- **Float epsilons and tolerances.** None. The fit bound is `position <= available + 1` (line-breaker.ts:139). The
  float compares in ShapeLine follow shaping_line_breaker.cc.
- **Clamps and rounding.** `Math.max(0, …)` on inline sizes matches Blink's ClampNegativeToZero. `luCeil`, `luTrunc`,
  `ceilFrom16` and the caret rounding cite layout_unit.h and fragment_item.cc:1153-1164, which I checked.
  `availableWidth` uses `f32(width × zoom)` (line-breaker.ts:92), where DESIGN §4.4 gives `f32(f32(width) × f32(zoom))`.
  The two agree at zoom 2 and can differ at other zooms.
- **Font-keyed code.**
  - The hyphen test's '"Courier New"' and 'Georgia' fallbacks are blink-gaps §5.5's recipe.
  - The `optical-size` regex (index.ts:115) keys on family names for reporting and ignores the verdict (B6).
- **Heuristics without a source.**
  - `MAX_PIECE` and the space-edge cuts (B7).
  - The group-start and edge ZWJ rule (B3).
  - `paintedExtent`'s code point lists (B5).
  - `restCreatesLineBox` (index.ts:138-161), a hand-written stand-in for ShouldCreateLineBox, while
    `LineInfo.shouldCreateLineBox` (line-breaker.ts:244-252) is computed and never read.
  - `hasHalt` from the Canvas 「「 trim (hankerning.ts:55). Blink tests the `halt` feature and gives up when the ten probe
    characters don't map to ten glyphs in order (han_kerning.cc:417-475). The port skips that test.
- **Checked and right.**
  - Tabs use the block's font: `TabSizeAncestor` is stable, line_breaker.cc:2963-2965 and inline_node.cc:2395-2403.
  - `lang=""` is a null locale: element.cc:12595-12599 in the 152 checkout sets `-webkit-locale: auto`. blink-text
    §2.F.3 is wrong there.
  - CharTypeFromBounds matches han_kerning.cc:48-73 and :88-115.
  - Letter spacing on spaces in cursive runs matches shape_result_spacing.cc:118-130.
- **Stale comment.** line-breaker.ts:435-437 says the HanKerning line-end reshape "isn't taken"; :474-483 takes it.

## 4. Case traces

### Failing

| Case | Family | What happens | Verdict |
|---|---|---|---|
| c-07f2657d11bf821f | runs/lang-spans | first-piece positions miss the start trim, +8 / −8px | port bug B1 |
| c-111dee8e6a53b668 | runs/lang-spans | trim applied after the halving cut at 37, −9px | port bug B1 |
| c-5325d5f65e230b90 | runs/lang-spans | halted `《` stays trimmed at a wrapped line start, −10px | port bug B2 |
| c-a6803706e450767e | runs/bidi-runs | Geeza Pro one letter per line, isolated forms natively | gap right, mechanism wrong (B3) |
| c-0dd1d404ea812dbc | policy/overflow-wrap | Geeza Pro reshaped line end doesn't fit natively | gap right, mechanism wrong (B3) |
| c-0f06b802391f39b9 | runs/bidi-runs | line 5 `وأعان`: native 45.7265625px, predicted 40.0390625px | gap right, mechanism wrong (B3) |
| c-26a7a7b28da24b44 | suite/source-shaped-arabic | `(` after Arabic in Amiri, −623 units | missing gap and class (B4) |
| c-7dcfed3b3b987d59 | suite/U+008D/middle | extent drops a 16px control the browser draws | port extent rule (B5) |
| c-87e013cf240ecbdc | ws/text-nodes | tab stop from the float space advance, −1 unit | source-consistent, no gap (B6) |
| c-544518dd1f5540d5 | suite/resumed-zero-tail | last glyph `d` −13 units | unexplained, no gap (B6) |
| c-2eb90aa2648b07b7 | runs/letter-spacing-spans | spaces in a Geeza Pro run missed 2px spacing, more fits | fixed after runs-r3, unverified |
| c-018aabf9e8c15984 | suite/skin-modifier/shy | Canvas joins 👍🏽 once the SHY is dropped: predicted 50.6953125px on one line | attribution holds |
| c-ff4745cb7e9bb2a1 | suite/U+FFFC/middle | native U+FFFC 16px, predicted 0 | attribution holds |
| c-213e2818602b7033 | policy/thai | native line 1 also starts at U+0E39 (its grapheme starts at 0) | lab observation holds |
| c-0ca55250962649aa | ws/text-nodes | painted 82.84375px against 88.171875px = one FF (5.328125px) | painter attribution holds |
| c-0167f0e244838f3b | suite/U+200B/start | predicted − native = the hyphen width | unverified observation (N3) |
| c-8862f0d3be757916 | runs/split-word | keycap sequence split across spans, −16px | condition holds, cause unverified |

### Passing

| Case | Family | Why it passes | Right reason? |
|---|---|---|---|
| c-faf5ba9af9ede412 | suite/policy/explicit-language | lang="" is a null locale, so the zh-CN UI table breaks after `”` | yes |
| c-3e4c81707a37c51f | runs/lang-spans | `》` alone is 10px from the end context with `：` in the reshape | yes |
| c-d98833205ee26c29 | ws/trailing-space-edge | break-spaces; the tab stop comes from the block's Arial space | yes |
| c-182f36fe3d303bb9 | policy/thai | SA boundaries from v8BreakIterator on text from the line start | yes (blink-text H34) |
| c-d8e15fcd94f91a95 | policy/word-break | fast table: `-` then a digit after a digit breaks | yes |
| c-6249365a67a619d8 | policy/zh-lang | the en span's strict table, break between 的 and 换 | yes |
| c-359f6f2010c68905 | ws/text-nodes | pre-wrap trailing spaces hang | yes |
| c-7dd524eba1a9f4da | runs/span-at-space | trailing space trimmed at a span edge, Menlo | yes |
| c-1afd26e8f437713b | runs/word-spacing-spans | break-anywhere retry over `-` runs with letter spacing −1 | yes |
| c-705bcf967e762f57 | policy/emoji | break-all after `👨🏽‍🔬` | yes |
| c-275ef1ee445c4de0 | policy/url-number | Arabic-Indic digits one per line under bidi | yes |
| c-f2923b8cd9f26a3f | runs/bidi-runs | LTR block with an Arabic span, break at a space | yes |
| c-242d919f16d9962f | runs/mixed-fonts-sizes | 13 runs, group edges at font changes | yes |
| c-af81537e2aa74f07 | runs/letter-spacing-spans | Verdana letter spacing −1 and 0.5 | yes |
| c-0af14333825280cc | runs/split-word | ZWJ sequences split across spans; `font-fallback` reported | yes |
| c-063f813aa30b2357 | runs/bidi-runs | Geeza Pro word split by a bold span at a line edge | wrong reason: group edges use the non-joining model, the opposite of the port's model inside groups (B3) |
| c-7e2d34d616d88252 | runs/split-word | Geeza Pro `بِسْ` / italic `م` at a line edge | wrong reason, as above |
| c-f73441e37755d103 | policy/line-break | a single line: strict never decides anything | vacuous |
| c-24409bad22fb8462 | policy/korean | a single line: keep-all never decides anything | vacuous |

## 5. Attribution sample

| Claim in RESULTS | Case | Checked against | Result |
|---|---|---|---|
| class 1 `han-kerning`: half-em residue Canvas can't give | c-07f2657d11bf821f | cut arithmetic above | wrong: B1 |
| class 1 | c-111dee8e6a53b668 | cuts [30, 37, 41, 45] | wrong: B1 |
| class 1 | c-5325d5f65e230b90 | harfbuzz_shaper.cc:1044-1048 | wrong: B2 |
| class 2 `unsafe-to-break`: OpenType keeps joins because joining is only unsafe_to_concat | c-0dd1d404ea812dbc, c-a6803706e450767e | hb-buffer.hh:517-527, hb-ot-shaper-arabic.cc:332, 366 | gap right; explanation wrong |
| class 3 `soft-hyphen-shaping`, about 460 suite-r1 lineCount failures | c-018aabf9e8c15984 | row widths; family counts 148 + 164 + 148 | holds |
| class 4 C1 controls measure differently | c-5bb28a79f6310f0d, c-7dcfed3b3b987d59 | row rects | wrong: the example doesn't fail, and the real failures are B5 |
| class 5 tab stops from the float space advance | c-87e013cf240ecbdc | simple_font_data.cc:239-240 | consistent with source; probe F4 not run; no gap |
| class 6 RTL soft hyphen rect | c-0167f0e244838f3b, c-f73e825e2a1758dd, c-1cb8b9aea80ececb | row rects, painted lines | unverified: predicted − native = the hyphen each time (5.15625, 5.90625, 5.328125px); F3 not run; no ISSUES.md entry yet |
| class 7 Thai break-all | c-213e2818602b7033 | native line starts | holds |
| class 8 U+FFFC | c-ff4745cb7e9bb2a1 | row widths | holds |
| class 9 painter form | c-0ca55250962649aa, c-05bbcacc0fe2f0e5 | arithmetic, row extents | holds |
| class 10 emoji split across spans | c-8862f0d3be757916 | row, grapheme edge | condition holds; cause not shown |

## 6. Gap census

The engine ran in bun with a stand-in Canvas over each case set, and its gaps were set against the re-scored metrics.
`ui-language` and `dictionary-breaks-unavailable` were set aside. Breaks under the stand-in differ, so counts of
line-edge `unsafe-to-break` are approximate.

| Run | Failing cases | Failing with no gap | Notes |
|---|---|---|---|
| smoke-r4 | 13 | 1 | c-544518dd1f5540d5; c-26a7a7b28da24b44 reports only `unsafe-to-break` |
| ws-r5 | 1 | 1 | tabs |
| policy-r4 | 10 | 3 | Thai lab observation |
| runs-r3 | 85 | 20 | Geeza Pro spacing in cursive runs, fixed after the run |

Gaps that fire everywhere don't locate losses: `han-kerning` covers all 335 lang-spans passes and all 25 lang-spans
failures, including B1 and B2.

## 7. Non-blocking notes

- **N1. blink-gaps §8's hypotheses were never probed** (0 mentions in probes-chrome.md or PROBES.md). Three recipes the
  port depends on have no verdict: U+2028 for spaces (§3.3), U+0001 for FF and VT (§2.8), and the pair-total safe test
  (§3.5). Lab rows are their only evidence.
- **N2. Spec corrections to route to the architect:**
  - blink-text §2.F.3: `lang=""` is a null locale (the port is right).
  - painter.md §3.1 a: joining is `unsafe_to_break` in Chrome (B3).
  - DESIGN §2.3: `styleRun`, where the port uses `style`.
- **N3. RTL soft hyphen observation (class 6).** File the lab/ISSUES.md entry once a probe shows whether the hyphen is
  drawn.
- **N4. The suite numbers need suite-r2 at the current build** before any claim about the 20k sample.

## 8. Resolution (Blink owner, 2026-09-16)

Runs: smoke-r6, ws-r6, runs-r6, policy-r5 and suite-r3, scored with the current score.ts against the rescored earlier rows
(specs/blink-RESULTS.md). Probes: `rebuild/probes/blink-followups.ts` F1-F4 in installed Chrome 153.

- **B1. Fixed.** Each group keeps its HanKerning edge trims (`startTrim16`, `endTrim16`), and `groupPrefix16` subtracts
  the start trim from every position after the group's first character, whatever the cuts (han_kerning.cc:235-262).
  `c-07f2657d11bf821f` and `c-111dee8e6a53b668` pass all four metrics in runs-r6; runs lang-spans widths gain 18 cases.
- **B2. Fixed.** `safeToBreak` at a group start is false when HanKerning halted the first character, the offset it adds to
  the unsafe ones (harfbuzz_shaper.cc:1044-1048). `c-5325d5f65e230b90` passes all four metrics.
- **B3. Agreed on the source; one model now, chosen by measurement.** HarfBuzz marks every join unsafe to break
  (`hb-shape --show-flags` flags the joins in Amiri, Noto Naskh Arabic, Arial and Geeza Pro), so `safeToBreak` rejects
  joining offsets and ShapeLine reshapes those line edges. What the reshape gives depends on the font, and probe F1
  settles it: Amiri keeps initial, medial and final forms on one-letter lines, Geeza Pro takes isolated forms, because
  `morx` fonts never read HarfBuzz's context (hb-ot-shape.cc:60-66, 100-101). Canvas can't tell the two apart. The
  inconsistency is gone: `JOINING_CONTEXT` decides group edges and reshape edges alike, and inside a group letters are
  always joined. Over 5,272 Arabic cases OpenType keeps 562 more line counts and 583 more breaks, AAT 111 more widths, all
  in Geeza Pro, so the port measures OpenType forms and reports `unsafe-to-break` with that mechanism at every such edge.
  `c-a6803706e450767e` and `c-0dd1d404ea812dbc` still fail, now for the declared reason, and the two wrong-reason passes
  (`c-063f813aa30b2357`, `c-7e2d34d616d88252`) fail widths under it. painter.md §3.1 a is routed to the architect.
- **B4. Reported, not handled.** `script.ts` ports ScriptRunIterator (47 of Blink's ICU-data unit tests pass). The
  paragraph's script per unit comes from it where RunSegmenter runs (inline_node.cc:1256-1290), and each Canvas string is
  resolved the same way: one Latin segment when 8-bit, ScriptRunIterator when 16-bit, with V8 storage chosen by
  construction (to_blink_string.cc:216-227). A word Canvas shapes under another script reports `script-context`;
  `c-26a7a7b28da24b44` does (debug-3). No Canvas string gets an LTR `(` the Arabic script, because an Arabic letter
  beside it starts another bidi run. RESULTS' old class 11 was wrong: EqualsRunSegment compares segment data that items
  only get in single-segment paragraphs (inline_item.cc:187-196), so groups span segments and each segment is its own
  HarfBuzz call inside the group, which Canvas repeats per string.
- **B5. Fixed in the engine.** `paintedExtent` follows score.ts's markVisible and lineExtent, which the lab updated at 10:30
  (controls other than TAB, LF and CR with a positive rect are visible), over generated ICU 78.2 classes (White_Space;
  gc Cc, Cf, Zl, Zp; Default_Ignorable_Code_Point) instead of a hand-written list. `c-7dcfed3b3b987d59` passes painter in
  smoke-r6 and its widths are unobserved (line 0 ends at a positive soft hyphen rect). The lab README already matches
  score.ts, so no lab entry was needed.
- **B6. Fixed where a rule exists, reported otherwise.**
  - `unsafe-to-break` is reported at line edges: between joining letters; where a wrapped line start or a line end
    before a space takes a paragraph position with a nonzero pair adjustment (L1); where a group of 256 zoomed px or more
    is cut at an adjusted offset.
  - `in-word-prefix` is reported where a line edge inside a word rests on the pair test alone (L2).
  - `tab-stops` is a new shared gap name. Probe F4 shows 16px Helvetica Neue's stops at 35.5859375px, 8 × the untracked
    space advance, not 8 × Canvas's 4.453125px; `c-87e013cf240ecbdc` reports it.
  - `optical-size`: system-ui and BlinkMacSystemFont are measured at the CSS size and scaled, as probes-chrome
    correction 7 says, and report the gap at zoom ≠ 1. No lab case uses them.
  - `c-544518dd1f5540d5` was a port bug. HarfBuzz's lookups skip default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571),
    so `c` and `d` kern across the U+200B: Canvas gives `abc​d` 88.70395px against `abc` 64.81596px + `d` 24.07999px. The pair
    window stopped at the U+200B and called the line start safe. Windows now reach past default-ignorable clusters; the
    case passes all four metrics in smoke-r6.
  - `han-kerning` fires only where the port adds a trim arithmetically (group edges, reshape edges, the line-end trim).
  - Census with a stand-in Canvas against the final metrics: failing cases without a gap are 0 of 12 (smoke), 0 of 1 (ws),
    0 of 7 (policy), 0 of 144 (runs) and 9 of 2,005 (suite). The 9 are Times New Roman `A` before a space on a
    paragraph's last line, where line-edge gaps weren't checked; fixed after suite-r3, predicted lines unchanged.
  - The Geeza Pro letter spacing fix (`c-2eb90aa2648b07b7`) passes; the Thai break-all cases were resolved by the lab.
- **B7. Fixed.** A group below 256 zoomed px is one Canvas call (blink-canvas §1.5). A wider group is halved at the offset
  nearest its middle that passes the safe test, else at the nearest cluster boundary with the pair adjustment added and
  `unsafe-to-break` reported (blink-gaps §3.6 L4). `MAX_PIECE` and the space-edge cuts are gone.
- **§3 heuristics.** `restCreatesLineBox` is gone: firstLine and nextLine lay the following line out and fold lines whose
  results create no line box (line_breaker.cc:945-975, inline_layout_algorithm.cc:1493-1498). `availableWidth` uses
  f32(f32(width) × f32(zoom)). The stale comment is fixed. `hasHalt` still comes from the 「「 trim: Blink's ten-glyph test
  (han_kerning.cc:465-470) needs glyph ids Canvas doesn't expose, and `han-kerning` covers it where a trim is added.
- **Also found.** A painted extent could go negative (`c-b097eff3c56ef9a0`, a lone combining mark at letter spacing
  −1px); it is at least 0 now, as the lab derives for content without a positive rect.
- **N1.** F1-F4 are run and recorded in RESULTS. blink-gaps §8 H5-H8 (U+2028) and H12 (pair totals) still have no verdict.
- **N2.** Routed in RESULTS' notes for the architect.
- **N3.** Filed in rebuild/lab/ISSUES.md with probe F3: the hyphen is drawn, its SHY rect is zero width in an RTL run,
  and about 575 suite-r3 lines differ by exactly the hyphen.
- **N4.** suite-r3 is at the current build.
