# WebKit port audit (Safari 27.0, WebKit 7625.1.29.11.27)

An adversarial pass over `rebuild/src/engines/webkit`, `tools/gen-webkit-data.ts` and `specs/webkit-RESULTS.md`, 2026-09-16.
No engine code was edited. One short lab job ran under the browser lock, in webkit-host only: the owner's debug predictor
over 52 sampled cases. Outputs are under `.artifacts/lab/webkit/audit/`:

- `<run>-summary.json` and `<run>-per-case.ndjson`: the owner's rows scored again with the current `rebuild/lab/score.ts`
  (changed at 10:10, after every owner scoring run);
- `debug-r1/`: 52 cases with the debug predictor (items, fragments, gaps, measure calls), scored normally and with
  `--native-compare` against the owner's rows of the same cases.

The traces used four scratch tools, which aren't in the repo: `wk-audit-dump.ts` prints a row's styles, native lines from
`score.ts`'s own derivation, predicted lines, metrics and debug items; `wk-audit-gaps.ts` runs `prepareWebKit` in bun with
a stand-in Canvas and lists each case's gap names next to its metrics; `wk-audit-widths.ts` classifies width failures by
source, direction and float32 distance; `wk-audit-breaks.ts` prints the port's items and ICU boundaries for a string.

Blocking findings come first. "Steps" are float32 steps at the value's magnitude.

## 1. Blocking findings

### B1. RESULTS describes the scorer from before 10:10, and its failure classes no longer match the rows

Every RESULTS number reproduces from the owner's per-case files, which were written with the older scorer (§2). With the
current `score.ts` the suite sample is widths 14344/91/5283 and painter 17478/2066/389, not 14205/658/4852 and
17090/2438/405. The largest RESULTS width classes are gone:

- "Controls with a .notdef advance left out of the observed extent" (suite 451): the scorer now counts controls other
  than TAB, LF and CR as visible (`markVisible`). Its example `c-0252d87aa4eec9f8` observes 12px for U+0001, equal to the
  prediction; the row fails only the soft hyphen painter class.
- "Line-end code point rect floored to 1/64px" (suite 171, runs 115): 6 code point width failures remain in all runs.
  `c-0608392e9e6aad81` passes.
- "Grapheme split across a text node edge" (runs breaks 9): all 9 pass.
- Widths at a positive soft hyphen rect at a line end moved from fail to unobserved (suite 438, smoke 9).

`lab/ISSUES.md` still lists the controls and node-edge entries without a resolution note. What fails now is mostly B2,
B3 and the named gaps, and RESULTS doesn't classify B2 or B3.

### B2. About 205 width failures sit one or two float32 steps from whole-node rects; RESULTS calls them floored Range edges

`wk-audit-widths.ts` over the current scores (first failing line per case):

| Run | Node rects, 1-2 steps | of which LTR lines at x = 0 | Code point rects |
|---|---|---|---|
| suite-r1 (4 parts) | 65 | 52 | 1 |
| runs-r2 | 112 | 46 | 5 |
| policy-r2 | 21 | 16 | 0 |
| smoke-r4 | 5 | 2 | 0 |
| ws-r4 | 2 | 2 | 0 |

- These lines take their observed width from whole-node rects, which Safari reports as float32 box geometry, not
  floored (lab README "Range geometry"). The paragraph and the painter host both sit at `left: 0; top: 0`
  (`lab/page.ts:128-131, 219-221`), and a DOMRect width comes straight from WebKit, so no JS arithmetic touches these
  widths.
- `c-4be96ac008e01ec7` (policy/korean, 16px Apple SD Gothic Neo, keep-all): one box at x = 0, width 223.67999267578125;
  predicted 223.6800079345703. Hangul is outside simplified measuring (`WidthIterator.cpp:738`), so this isn't the
  shortcut-path summing order of probes-safari correction 5.
- `c-4f0c9d3cd9d60735` (runs/split-word, Kohinoor Devanagari): line 3 is the carried rest of item [6, 11), f32(64.2239990234375
  − 33.503997802734375) = 30.720001220703125. Native box 30.719999313354492, two steps below.
- `c-4997dcd80482f3d4` (suite/maintained/accuracy, 20px Helvetica Neue): the Latin run after Arabic is 253.36001586914062
  natively, 253.3599853515625 in the port.
- No gap is reported for any of them. `simplified-measuring` fires only for non-integer sizes and system-ui (B4).

Nobody has shown whether WebKit's box width differs from `Line::close()`'s content width, or the port's sums differ from
WebKit's. H12's `text-align: right` offset reads the content width without a text rect, so a probe using it would
separate the two. Until then these are unattributed, not observation.

### B3. Failing cases with no attribution

`wk-audit-gaps.ts` lists 28 suite cases that fail lineCount, breaks or widths with no gap other than `ui-language`. RESULTS
attributes 7 of them, the Amiri lab-document split. The other 21:

- **Page history.** `c-9577ee04c2807ef2` (`####<<aabb`), `c-71bbfb47bfa44900` (`||||““tail`, `lang=""`), `c-f557d800bed7ce84`
  (`ب­ب x`), `c-58f1d68ec8f9c16f` (`£(100)`) and `c-cd9aa832387ef76f` (`!!!!““aabb`) fail in the owner's rows. In
  `audit/debug-r1`, after other cases, native layout equals the port on all five, and `score.ts --native-compare` marks
  all five history-dependent. The owner's rows predate `documentCaseIndex` and `previousCaseId`, so the rest of
  ascii-angle-policy, explicit-locale-quotes, opening-quote-ownership, numeric-prefix-grammar, partial-source-context and
  source-seam/numeric need the lab's two-order run to be attributed.
- **Negative content widths.** `c-ffb529e6cf621a00` (`VAWAVAV`, Times New Roman, letter spacing −1, 1px wide) predicts
  −0.75px for line 6: the compounded carry, and `Line::appendTextFast` has no `max` (`InlineLine.cpp:483-530`). The native
  box is at x −0.75, width 0.75. `c-ac3a23494bc89c36` predicts −0.048px for a ZWSP line. RESULTS lists only
  `c-67db90040d06ae76`, and says its engine width is −2.19px. In fact `engineWidth` is 0 there, from LineBuilder's
  `std::max(old, right)` (`InlineLine.cpp:440`); the −2.19px is the fragment width.
- **White space before a ZWSP, an observation problem that isn't filed.** In `c-74fd6647277e9b14`, `c-7dbc8245975679a2`
  (ws), and `c-4baaca8eaa21206a`, `c-baf655142fc3c024`, `c-bb834c4028ed6b3d` (suite/hanging-tab-control), a space followed by
  a ZWSP item isn't trimmed or hanging natively: the ZWSP's `appendText` resets both (`InlineLine.cpp:445-477`).
  - The node rects give the port's width: 79.15625 + 4.4453125 = 83.6015625.
  - The scorer's trailing run extends through invisible code points, so it drops the space.
  - `lab/ISSUES.md` has no entry for this.

### B4. Gap conditions that don't follow DESIGN §5

The census joined each case's gaps with its current metrics (§6).

- **`canvas-language`.**
  - Condition (`content.ts:451, 462`): a non-empty locale and either a generic family or any code point ≥ U+2E80. That
    range includes emoji, symbols, Hangul, private-use characters and specials. DESIGN names generic families, Han under
    zh, ja or ko fallback, and `locl` forms.
  - It fires on 12,329 of 17,832 suite cases that pass all four metrics, and on 876 of 1,445 in policy, so it doesn't
    locate losses. It does cover every canvas-language failure traced: `c-5bb44578b1e4f691`, `c-64bf20f7c2d249a1`,
    `c-a0ce2a2d1ff61ee3`, `c-00c22a2f83f30caa`.
- **`simplified-measuring`.** Condition (`content.ts:464`): the box is on the simplified path, and either the size isn't
  an integer or the family is system-ui. probes-safari correction 5 measured one-step differences at 11.1111px, 17.49px
  and system-ui 20px; the integer-size exemption has no probe or citation (B2).
- **`string-storage`.** Reported only for keep-all with punctuation in text the port treats as 8-bit (`content.ts:469`).
  DESIGN §5 also names 1-unit emergency breaks. The 8-bit rules in `firstCharacterBreakRespectingLineStartProhibitions`
  (`InlineContentBreaker.cpp:143`) and `breakWord`'s index alignment (`TextUtil.cpp:256-263`) get no gap. ISSUES.md's
  "Latin-1 text reaches layout as 16-bit" makes that condition live in the lab.
- **Intl.Segmenter losses.** The stand-in's losses listed in webkit-gaps §4.2 produce no gap, because DESIGN §5 reports
  dictionary breaks only when unavailable.
  - `c-26eedff255c8f6b5` (policy/thai): the rule boundaries give a dictionary segment [39, 42) that starts with U+0E34
    after a ZWSP. JSC's word segmenter puts a boundary at 40, which is a grapheme boundary; libicucore's Thai engine
    doesn't. The port breaks at 40, native layout at 39.
  - The same holds for `c-8e0ef1214d002403` and `c-2a1fef66065962b0`.
  - This is "SA runs that start with a combining mark" from webkit-gaps §4.2. The condition is detectable from the text,
    so it needs a gap name (architect).

### B5. An uncited heuristic decides simplified measuring for fixed-pitch families

`makeBox` (`content.ts:222-233`) turns simplified measuring off when any code point's Canvas advance differs from the
space's. The comment treats that as proof the glyph came from a fallback font.

- The source condition is "every glyph comes from the primary font" (`FontCascade.cpp:498-502`).
- webkit-gaps §2.4 lists trait fonts whose own glyphs are wider than the space: Courier U+03A9 is 12.2890625px, and
  BIZ UDGothic U+0416 is 16px.
- For `16px Courier` with `ΩΩΩΩ`, the source keeps simplified measuring and the fixed-pitch shortcut, giving 38.40625px
  (webkit-gaps §2.5, probe 8). The port measures 49.15625px.
- The spec's Canvas test for primary-font coverage is §3.3's fallback difference, which the port doesn't use.
- No lab case uses Courier, BIZ UD, PCMyungjo or Osaka-Mono (checked across all eight case files), so no row shows it.

## 2. Scores, scored again

Owner's scorer (the per-case files next to each run): every RESULTS row reproduces, including suite-r1 19575/355/3 |
19386/374/173 | 13978/720/4688 | 16734/2794/405 and the substituted 19903/27/3 | 19715/45/173 | 14205/658/4852 |
17090/2438/405 (491 ids replaced).

Current `score.ts`, same rows; pass/fail/unobserved (not-applicable left out):

| Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|
| smoke-r4 | 299/1/0 | 292/4/4 | 241/10/41 | 244/39/17 |
| ws-r4 | 1019/0/0 | 1019/0/0 | 843/9/167 | 823/36/160 |
| policy-r2 | 1603/1/2 | 1574/8/24 | 1524/42/8 | 1441/158/7 |
| runs-r2 | 2566/10/4 | 2520/50/10 | 2142/199/179 | 2078/332/170 |
| suite-r1 (4 parts) | 19575/355/3 | 19333/427/173 | 14117/97/5119 | 17122/2422/389 |
| suite-r1 + targeted-r2 | 19903/27/3 | 19718/42/173 | 14344/91/5283 | 17478/2066/389 |
| suite-targeted-r2 | 484/7/0 | 470/7/14 | 234/8/228 | 356/135/0 |
| measurement-r2 | 7/0/0 | 7/0/0 | 6/1/0 | 6/1/0 |

- In suite-r1 part 0, 56 breaks went from pass to fail ("predicted line splits a grapheme"). They are before-fix emoji
  rows in families targeted-r2 reran, so the substituted row is unaffected.
- **measureText calls, recomputed from the rows.** They match RESULTS. smoke-r4: mean 14.3, median 10, p90 30, p95 36,
  max 73. runs-r2: 20.7/17/39/49/98. ws-r4: 12.9/11/25/31/72. policy-r2: 14.5/12/28/35/99. Suite substituted:
  11.5/6/27/38/2,059 (`c-c8b0ddb41a784eda`).
- **Tests.** `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean, and `bun test rebuild/src` gives 81 pass, 0 fail. The
  WebKit oracle test compares 14,904 of 19,393 requests with 0 differences. Its 4,489 exclusions include every Thai, Lao,
  Khmer and Myanmar request, so the dictionary path has no oracle coverage.
- **Single-line passes.** They decide no break: 26 of 292 breaks passes in smoke-r4, 230 of 1,019 in ws-r4, 177 of 1,574
  in policy-r2, 125 of 2,520 in runs-r2 and 2,041 of 19,333 in suite-r1.
- **Installed Safari.** None of these numbers comes from installed Safari. WEBKIT-HOST.md's rule reserves reported
  numbers for Safari runs.

## 3. Search for rules that aren't ported

- **DOM reads.** None in the engine directory: no getBoundingClientRect, offsetWidth or getComputedStyle, and no
  document, window or navigator reads.
- **Float epsilons and tolerances.** None. The fit bounds add 1/64 as `TextOnlySimpleLineBuilder.cpp:481-486` and
  `InlineLineBuilder.cpp:1172-1183` do. `rebuildLineForTrailingSoftHyphen` has no epsilon, as in `:1860-1887`.
- **Clamps and rounding, checked against the pinned source.**
  - `Math.max(0, …)` in `boxWidth` and `itemWidth`: TextUtil.cpp:62-122.
  - `Math.max` on content widths: InlineLine.cpp:416-440.
  - The simple builder's unclamped `m_contentLogicalWidth`: :483-530.
  - `Math.max(0, available − nonOverflowing)`: InlineContentBreaker.cpp:643-662.
  - NaN available width becomes F32_MAX: InlineLineBuilder.cpp:1172-1183.
  - The line width `trunc(f32(width × zoom) × 64) / 64`: StylePrimitiveData.h:341-360.
- **Checked right at the pinned lines.**
  - `breakWord`: the fixed-pitch shortcut, the estimate, the bisection from `2 × avail / avg` and the grapheme scan over
    the item substring (TextUtil.cpp:242-365).
  - `firstUserPerceivedCharacterLength`, including `ubrk_following` over the whole box (:578-604).
  - `appendText` and `appendTextFast`, with `needsNewRun` and the negative letter spacing branches.
  - `addFullyTrimmableContent` and `remove`.
  - `appendTextContent`.
  - `firstCharacterBreakRespectingLineStartProhibitions` and `firstBreakablePosition`, with `U16_FWD_1` limited by the
    item length.
  - `lastValidBreakingPosition` and `midWordBreak`.
  - The RangeBasedLineBuilder first-line skip (RangeBasedLineBuilder.cpp:85-96).
  - `overflowWidthAsLeadingForNextLine` (AbstractLineBuilder.cpp:54-98).
  - The Danish exception in `quoteOverrides`: AppleICU76 rbbi.cpp:412, rdar://66836891.
- **Names and strings in code.**
  - `FIXED_PITCH_FAMILIES` is webkit-gaps §2.4's allowlist, and `courier new` loses only the width shortcut
    (FontCoreText.cpp:776-782). The family is the first one listed, not the first that realizes
    (FontCascadeFonts.cpp:200-218).
  - `GENERIC_FAMILIES` and `system-ui` are used only for gap reporting.
- **Heuristics without a source.** B5 (fixed-pitch coverage test), B4 (the canvas-language and simplified-measuring
  conditions).
- **Invisible literals.** `canvasString` maps CR to U+0000 and VT and FF to U+0001 through literal control characters
  (`measure.ts:21`, confirmed with a hex dump). The rule is right, but an editor shows `' '` and `''`.

## 4. Case traces

### Failing

| Case | Family | What happens | Verdict |
|---|---|---|---|
| c-17af0e41879fc51f | suite/original-vs-reshaped-admission | item [1,7) split by breakWord, rest 24.216 carried, "((" kept by the line-start prohibition | observation holds: probe F1 in a fresh document gives 6 lines, height 288 |
| c-5bb44578b1e4f691 | suite/keep-all | serif under ja: native "abc日" 48.096px, Canvas 42.979px | canvas-language holds |
| c-0ad060cd384930bf | runs/bidi-runs | native وأعانك 60.33px and على 23.92px against Canvas 52.84 + 7.49 and 32.80 | rtl-shaping-across-inline-boxes holds |
| c-046c8e49140717e2 | runs/letter-spacing-spans | span "files " Canvas 32.432 + 5.448 = 37.88, node 38.88 | letter-spacing-ligatures holds |
| c-e5a4b1cfe0ef6961 | suite/ligature-thresholds-v3 | "fl" with 1px spacing: Canvas 13.16px, native 14.144px | gap holds; not counted in RESULTS |
| c-26eedff255c8f6b5 | policy/thai | Intl.Segmenter boundary at 40 inside a segment starting with U+0E34 | stand-in loss holds; no gap (B4) |
| c-64bf20f7c2d249a1 | policy/line-break | Canvas "标" 20.38px, DOM 20px, so 11 characters overflow in the port | canvas-language holds |
| c-076e6fc979e1fea8 | ws/text-nodes | CR in a Menlo node takes the fixed-pitch space width 9.6328125, equal to its node rect | observation holds, but it's CR, not .notdef |
| c-74fd6647277e9b14 | ws/trailing-space-edge | space before ZWSP isn't trimmed natively; node rects equal the prediction | unfiled observation (B3) |
| c-4baaca8eaa21206a | suite/hanging-tab-control | pre-wrap space before ZWSP doesn't hang; native box 5.4453125 equals the prediction | unfiled observation (B3) |
| c-790a15d5d04b7c3a | suite/following-space-context | rest of "A\f" carried as W("A") − W("A") = 12px; native FF box 11.1171875px | gap reported; U+0001 differs from the DOM's FF after "A" |
| c-9577ee04c2807ef2 | suite/ascii-angle-policy | owner rows break after `<<`; debug-r1 breaks after `####`, as the port predicts | page history (B3) |
| c-f557d800bed7ce84 | suite/glue | NBSP glue: owner rows `ب­ب` \| ` x`; debug-r1 `ب­` \| `ب x`, as predicted | page history (B3) |
| c-4f0c9d3cd9d60735 | runs/split-word | carry 30.720001220703125 against box 30.719999313354492 | unattributed (B2) |
| c-ffb529e6cf621a00 | suite/word | negative carry −0.75px; native box normalized to 0.75 | unlisted extent rule (B3) |

### Passing

| Case | Family | Why it passes | Right reason? |
|---|---|---|---|
| c-3e37f77a9728e907 | runs/bidi-runs | RTL block; a 24-digit Arial run split by breakWord with the carried rest | yes |
| c-7c58565c8e8396dc | policy/korean | break-all + strict: mid-word split `지르고` \| `는` | yes |
| c-26d4750d58d0d10e | policy/overflow-wrap | keep-all breaks after 16-bit punctuation, then breakWord at arbitrary positions | yes |
| c-35f705e2ae904a65 | policy/thai | ZWSP opportunities and complex-path grapheme prefixes | yes |
| c-1ba5c0d09014f89e | policy/url-number | break-all in Courier New at 12px: the fixed-pitch breakWord shortcut | yes |
| c-09e5dce9e64f27f5 | runs/span-at-space | break-spaces across six spans | yes |
| c-087af7bdb7a6159e | runs/word-spacing-spans | word-spacing −8 in LineBuilder offsets | yes |
| c-1d7c0d40c2a87d6e | suite/emergency-graphemes | `a` \| `👍🏽` \| `b` on the complex path | yes |
| c-038174d71af4675a | suite/hanging-tab | URL with TAB and 1px spacing, breakWord per line, TAB trimmed | yes |
| c-281bc0e8f5cebf83 | ws/controls | break-spaces with LF LF, an empty line between | yes |
| c-0213ee6aeab85ae1 | ws/controls | pre-line with LF LF | yes |
| c-0b0ec490f07c77b2 | ws/text-nodes | a TAB-only first text node gets no renderer (RenderTreeUpdater.cpp:570-594) | yes |
| c-a560dabf8d17cd2c | runs/split-word | grapheme split at a span edge, as native | yes |
| c-5dd8465ea2737a6c | runs/split-word | soft hyphens in spans, but every line ends at a space | vacuous for soft hyphens |
| c-faf5ba9af9ede412 | suite/policy/explicit-language | `lang=""` quotes; lines come from breakWord at an arbitrary position | vacuous for quote overrides |

No pass was found where a wrong rule gave the right lines. `c-67db90040d06ae76`'s first four lines pass by the compounded
carry (43.006 − 13.956 − 10.494 − 11.652 − 9.095 = −2.19), which is the source rule.

## 5. Attribution sample

| Claim in RESULTS | Case | Checked against | Result |
|---|---|---|---|
| soft hyphen + hyphen span wraps in the painted box | c-3a9a7b6cde7063c9 | native line 0 is 16.742px in a 15.25px box (revert to index 0 adds the hyphen) | holds |
| controls with .notdef left out of the extent | c-0252d87aa4eec9f8 | current scorer | stale: U+0001 observes 12px = prediction (B1) |
| controls left out of the extent | c-076e6fc979e1fea8 | runRects, fixed-pitch width | holds for CR |
| painted extent one float32 step / floored edge | c-f561607b4cfc7606 | runRects | wrong mechanism: whole-node rect, RTL, one step (B2) |
| line-end code point rect floored | c-0608392e9e6aad81 | current scorer | resolved: passes |
| canvas-language | c-00c22a2f83f30caa | serif under ja, span ko | holds |
| letter-spacing-ligatures | c-046c8e49140717e2 | debug items | holds |
| rtl-shaping-across-inline-boxes | c-0ad060cd384930bf | runRects per word | holds |
| lab document splits the Amiri case | c-17af0e41879fc51f | probe F1 JSON, WEBKIT-HOST.md `c-f6c8d44a6fa0bab8` | holds |
| Thai after ZWSP: Intl.Segmenter stand-in | c-26eedff255c8f6b5 | debug items, `wk-audit-breaks.ts` | holds; the loss is the segment starting with a combining mark |
| painted text measures differently | c-0145610398f11164 | "A" painted alone 11.55px against W("A ") − W(" ") = 10.67px, its space on the next line | holds |
| negative line width, one case | c-67db90040d06ae76 | debug fragments | holds as unresolved; engineWidth is 0, and two more cases exist (B3) |

## 6. Gap census

`prepareWebKit` over every case file with a stand-in Canvas. Gap conditions are prepare-time and read no widths except
B5's test.

| Run | Failing (any metric) | lineCount/breaks/widths failing with no gap | Most frequent gaps on all-pass cases |
|---|---|---|---|
| smoke-r4 | 40 | 1 (policy/thai) | canvas-language 114, fixed-pitch-path 49, letter-spacing-ligatures 27 |
| ws-r4 | 36 | 1 (ZWSP after space) | fixed-pitch-path 360, control-character-width 227, canvas-language 193 |
| policy-r2 | 161 | 9 (Thai 4, Geeza Pro one-step RTL 5) | canvas-language 876, fixed-pitch-path 118, string-storage 69 |
| runs-r2 | 342 | 15 (one-step widths) | canvas-language 996, fixed-pitch-path 493, letter-spacing-ligatures 480, rtl-shaping 283 |
| suite (19,933) | 2,101 | 28 (B3) | canvas-language 12,329, hyphen-glyph 4,696, letter-spacing-ligatures 2,122 |

Gaps that should fire but don't: `simplified-measuring` on integer-sized shortcut-path text, `string-storage` for the
8-bit emergency-break rules, and a gap for the Intl.Segmenter losses (B4). `rtl-shaping-across-inline-boxes`,
`letter-spacing-ligatures`, `control-character-width` and `hyphen-glyph` fire wherever their conditions hold in the
traced cases.

## 7. Non-blocking notes

- **N1. Canvas word spacing.** `makeBox` sets `ctx.wordSpacing` to the run's spacing (`content.ts:219`). DESIGN §4.2
  gives '0px' with the offsets added in JS, and webkit-canvas.md says nothing about Canvas word spacing, so the recipe has
  no verdict.
- **N2. Spec correction.** webkit-lines §6.2's pseudo-code writes `fround(fround(right + w) + ws)`. The source is
  `currentLogicalRight += logicalWidth + wordSpacing` (InlineLineBuilder.cpp:1083), which is `right + (w + ws)`. The port
  follows the source.
- **N3. Tabs.** `tabbedWidth` measures the text between TABs as separate Canvas strings and adds letter spacing after
  every TAB. webkit-lines §11 marks the letter-spacing part font-dependent [I].
- **N4. `WebKitLineStart` shape.** It nests `carriedWidth` and `endsWithLineBreak` under `previousLine`; DESIGN §2.3 lists
  them flat. RESULTS records this.
- **N5. Thai with negative letter spacing.** `c-61ddb22b8b3d47cc` natively starts line 3 at 21, the port at 24. It reports
  `letter-spacing-ligatures`, but the mechanism isn't shown.
- **N6. ISSUES.md.** "Controls left out of the extent" and "grapheme across a text node edge" read as open, though the
  current scorer resolves both (B1).
