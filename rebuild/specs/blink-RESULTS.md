# Blink port results (Chrome 153.0.8010.48)

Lab runs of `rebuild/src/engines/blink` in installed Chrome 153 on this Mac (Retina, `devicePixelRatio` 2, UI language
zh-CN), 2026-09-16. Rows and summaries are under `.artifacts/lab/blink/<run>/`. The scorer snaps Chrome widths to
1/128 px at DPR 2 (`grid 128`), so a 1-unit error is 1 raw LayoutUnit. specs/blink-AUDIT.md §8 says how each audit
finding was resolved.

## Scores

pass / fail / unobserved / not-applicable. The lab changed score.ts at 10:30 (controls other than TAB, LF and CR with a
positive rect are visible; line starts compare at native cluster starts), so the earlier runs are scored again from their
rows with the current score.ts (`.artifacts/lab/blink/rescore/`).

| Case set | Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke (299) | smoke-r4, rescored | 296/3/0/0 | 290/3/6/0 | 262/18/10/9 | 272/23/4/0 |
| smoke (299) | smoke-r6 | 296/3/0/0 | 290/3/6/0 | 262/9/19/9 | 283/12/4/0 |
| ws (1,019) | ws-r5, rescored | 1019/0/0/0 | 1017/0/2/0 | 946/30/41/2 | 943/43/33/0 |
| ws (1,019) | ws-r6 | 1019/0/0/0 | 1017/0/2/0 | 975/1/41/2 | 968/18/33/0 |
| runs (2,580) | runs-r3, rescored | 2563/8/9/0 | 2541/29/10/0 | 2401/56/84/39 | 2401/99/80/0 |
| runs (2,580) | runs-r6 | 2566/5/9/0 | 2551/19/10/0 | 2342/125/84/29 | 2342/158/80/0 |
| policy (1,606) | policy-r4, rescored | 1605/1/0/0 | 1602/4/0/0 | 1599/3/0/4 | 1598/8/0/0 |
| policy (1,606) | policy-r5 | 1605/1/0/0 | 1602/4/0/0 | 1599/3/0/4 | 1599/7/0/0 |
| suite-sample (19,994) | suite-r1, rescored | 19333/660/1/0 | 19068/702/224/0 | 14570/1938/2560/926 | 15150/4677/167/0 |
| suite-sample (19,994) | suite-r3 | 19318/675/1/0 | 19047/723/224/0 | 14666/1273/3108/947 | 17622/2205/167/0 |
| smoke (299) | smoke-r7 | 296/3/0/0 | 290/3/6/0 | 262/9/19/9 | 283/12/4/0 |
| smoke (299) | smoke-r8 | 295/4/0/0 | 287/6/6/0 | 258/10/19/12 | 280/15/4/0 |
| ws (1,019) | ws-r7, ws-r8 | 1019/0/0/0 | 1017/0/2/0 | 975/1/41/2 | 968/18/33/0 |
| runs (2,580) | runs-r7, runs-r8 | 2566/5/9/0 | 2551/19/10/0 | 2342/125/84/29 | 2342/158/80/0 |
| policy (1,606) | policy-r6 | 1605/1/0/0 | 1602/4/0/0 | 1599/3/0/4 | 1599/7/0/0 |
| policy (1,606) | policy-r7 | 1603/3/0/0 | 1593/13/0/0 | 1585/8/0/13 | 1586/20/0/0 |
| suite-sample (19,994) | suite-r4 | 19320/673/1/0 | 19063/707/224/0 | 14671/1284/3108/931 | 17628/2199/167/0 |
| suite-sample (19,994) | suite-r5 | 18996/997/1/0 | 18655/1115/224/0 | 14167/1380/3108/1339 | 17383/2444/167/0 |
| smoke (299) | smoke-r9 | 298/1/0/0 | 292/1/6/0 | 262/10/20/7 | 288/7/4/0 |
| ws (1,019) | ws-r9 | 1019/0/0/0 | 1017/0/2/0 | 975/1/41/2 | 973/13/33/0 |
| runs (2,580) | runs-r9 | 2566/5/9/0 | 2551/19/10/0 | 2342/125/84/29 | 2348/152/80/0 |
| policy (1,606) | policy-r8 | 1605/1/0/0 | 1602/4/0/0 | 1599/3/0/4 | 1600/6/0/0 |
| suite-sample (19,994) | suite-r6 | 19888/105/1/0 | 19654/116/224/0 | 15105/1181/3368/340 | 19349/473/172/0 |

The r9 runs and suite-r6 bundled the painter owner's paint.ts 3221c114, and every earlier run used 6bfbbc89 (hashes in
`.artifacts/lab/blink/<run>.build.txt`), so painter changes in those runs aren't the engine's alone.

suite-r3 ran in eight chunks of 2,500 cases (`.artifacts/lab/blink/cases/suite-0N.ndjson`, `suite-r3-0N/`), each under
its own lock. smoke-r5 and runs-r5 were an intermediate build, before the default-ignorable pair window.

Cases that changed against the rescored baseline (fixed / broke):

- smoke: widths 3 / 3, painter 14 / 3. The painter fixes are controls that Chrome draws with an advance; the breaks
  are Geeza Pro bidi-runs and split-word cases (class 1).
- ws: widths 29 / 0 (ws/controls 24), painter 27 / 2.
- runs: lineCount 5 / 2, breaks 18 / 8, widths 28 / 97, painter 45 / 104. Fixed: lang-spans (widths 18, the HanKerning
  audit findings B1 and B2) and letter-spacing-spans. Broke: Geeza Pro bidi-runs (widths 79) and split-word (16), where
  the port now joins letters at shaping-group edges that Geeza Pro doesn't join (class 1).
- policy: painter 1 / 0.
- suite: lineCount 29 / 44, breaks 37 / 58, widths 75 / 4, painter 2,536 / 64. Line counts and breaks move inside the
  invisible-character families (U+200D 21 / 9; U+200C, U+2060, U+FEFF, U+200B, U+2028), where soft-hyphen breaks inside
  joined Arabic are now reshaped. The painter fixes come from the extent rule (audit finding B5) and the hyphen span.

## Joining model

HarfBuzz marks every offset between joining letters unsafe to break, in OpenType and AAT fonts alike
(`hb-shape --show-flags` on Amiri, Noto Naskh Arabic, Arial and Geeza Pro), so Blink reshapes line edges there. Whether
the reshaped letters keep their joined forms depends on the font, and Canvas can't see it: probe blink-followups F1 puts
Amiri's `بببب` one letter per line in initial, medial, medial and final forms (4.5625, 5.859375, 5.859375, 21.1953125px)
and Geeza Pro's `لللل` in isolated forms (11.40625px each). One switch in shape.ts, `JOINING_CONTEXT`, decides both kinds
of call edge: shaping-group edges and line-edge reshapes. Both values were run over the 5,272 lab cases that hold
Arabic (`.artifacts/lab/blink/cases/arabic-{0,1}.ndjson`, runs `arabic-ot-{0,1}` and `arabic-aat-{0,1}`), passes:

| Primary font of the Arabic text | lineCount OpenType / AAT | breaks | widths | painter |
|---|---|---|---|---|
| "Geeza Pro" (AAT) | 578 / 582 | 560 / 580 | 437 / 570 | 444 / 563 |
| Arial (OpenType) | 783 / 607 | 775 / 592 | 256 / 227 | 737 / 486 |
| Amiri (OpenType) | 621 / 453 | 614 / 420 | 137 / 110 | 578 / 344 |
| "Noto Naskh Arabic" (OpenType) | 608 / 455 | 601 / 441 | 109 / 90 | 579 / 342 |
| "Shantell Sans" (falls back) | 595 / 531 | 591 / 530 | 21 / 73 | 201 / 327 |
| all 5,272 | 5079 / 4517 | 5029 / 4446 | 2820 / 2931 | 4427 / 3947 |

The port measures the OpenType forms: 562 more line counts, 583 more breaks and 480 more painter passes, against 111
more widths for AAT. Every line or group edge between joining letters reports `unsafe-to-break` with the mechanism.

## measureText calls per paragraph

From `prediction.measureLog` (calls that reached Canvas; the per-layout memo answers repeats).

| Run | mean | median | p95 | max | per line |
|---|---|---|---|---|---|
| smoke-r4 | 49.2 | 42 | 114 | 217 | 11.0 |
| smoke-r6 | 46.3 | 37 | 113 | 205 | 10.3 |
| ws-r5 | 40.7 | 38 | 82 | 162 | 11.2 |
| ws-r6 | 37.3 | 35 | 84 | 167 | 10.3 |
| runs-r3 | 73.7 | 65 | 151 | 337 | 16.7 |
| runs-r6 | 67.0 | 57 | 147 | 342 | 15.2 |
| policy-r4 | 47.8 | 42 | 99 | 203 | 9.8 |
| policy-r5 | 45.6 | 40 | 97 | 207 | 9.4 |
| suite-r1 | 32.7 | 12 | 94 | 8,698 | 10.2 |
| suite-r3 | 38.5 | 23 | 99 | 9,111 | 12.0 |
| smoke-r7 | 47.6 | 38 | 119 | 213 | 10.6 |
| smoke-r8 | 47.4 | 38 | 119 | 213 | 10.6 |
| ws-r7 | 38.8 | 37 | 86 | 167 | 10.7 |
| ws-r8 | 38.7 | 36 | 86 | 167 | 10.7 |
| runs-r7, runs-r8 | 68.6 | 59 | 150 | 342 | 15.6 |
| policy-r6 | 47.4 | 41 | 100 | 207 | 9.7 |
| policy-r7 | 47.3 | 41 | 100 | 207 | 9.7 |
| suite-r4 | 40.3 | 23 | 106 | 10,241 | 12.6 |
| suite-r5 | 40.0 | 23 | 106 | 10,241 | 12.6 |
| smoke-r9 | 47.6 | 38 | 119 | 213 | 10.6 |
| ws-r9 | 38.8 | 36 | 86 | 167 | 10.7 |
| runs-r9 | 68.6 | 59 | 150 | 342 | 15.6 |
| policy-r8 | 47.3 | 41 | 100 | 207 | 9.7 |
| suite-r6 | 40.7 | 24 | 106 | 10,241 | 12.6 |

A group narrower than 256 zoomed px is now one call instead of pieces cut every 32 code units and at space edges. The
nextLine lookahead for line boxes lays out the next line again, which the memo answers.

## What the port does

- `content.ts`: TextLayoutObjectIsNeeded, AppendCollapseWhitespace / PreserveNewline / PreserveWhitespace with the
  removed and restored trailing spaces, ExitBlock, source offsets per text_content unit; bidi through `unicode/ubidi.ts`
  and SetBidiLevel splitting; lang to locale (lang="" is a null locale, element.cc MapLanguageAttributeToLocale).
- `breaks.ts`: LazyLineBreakIterator: the space rule, `kFastLineBreakTable`, break-all (Unicode 17 classes, HH row
  empty), keep-all per code unit, soft hyphens, ICU restarted at every line start with the rule file per locale and
  strictness, `Intl.v8BreakIterator` inside dictionary segments, grapheme boundaries for kBreakCharacter.
- `script.ts`: ScriptRunIterator with ICU 78.2's Script and Script_Extensions, brackets and the East Asian width fix
  (47 of Blink's ICU-data unit tests in `script.test.ts`). It gives the script of every text_content unit where
  RunSegmenter runs, and of every 16-bit string Canvas measures.
- `shape.ts`: a shaping group measured in one Canvas call below 256 zoomed px, halved at an offset the safe test passes
  above that; U+2028 for U+0020; `optimizeLegibility` contexts; the paragraph position of an offset from the piece prefix
  plus the pair adjustment on the glyph before it, with pair windows that reach past default-ignorable characters;
  safe-to-break never inside a cluster, between joining letters, at a HanKerning-halted group start, or where the pair
  total shows an adjustment; U+200D where text joins across a range edge (inside a group always, at call edges per
  `JOINING_CONTEXT`); HanKerning start and end trims on every later position; letter spacing on spaces in cursive runs
  and on FF, by the Canvas string's own script runs; 8-bit or 16-bit Canvas strings as the paragraph segments; U+2060 in
  place of the default-ignorable characters Canvas turns into U+200B, left out where the string would otherwise be 8-bit;
  system-ui measured at the CSS size and scaled; views, reshapes, the hyphen, tab runs.
- `hankerning.ts`: HanKerning character types (ICU 78.2 blk, ea, gc), font data from Canvas (`halt` through the 「「
  pair trim, glyph ink bounds for dots, colons and quotes), ShouldKern and ShouldKernLast, trims per character.
- `line-breaker.ts`: NextLine, BreakLine, HandleText, BreakText with the hyphen retry, ShapeLine (with the HanKerning
  line-end trim), HandleTrailingSpaces, HandleEmptyText, HandleControlItem, HandleForcedLineBreak, open and close tags,
  HandleOverflow with the 1px re-break and the break-anywhere retry, RewindOverflow, Rewind, ComputeCurrentStyle,
  RemoveTrailingCollapsibleSpace with RewindTrailingOpenTags, SplitTrailingBidiPreservedSpace.
- `index.ts`: settings, groups, fragments tiling the source, lines without a line box folded into their neighbours
  (the breaker's own should_create_line_box), the painted extent by lab/score.ts's visibility rule over generated ICU
  classes, `joinsNextLine`, gaps at prepare time and at line edges.

## Failure classes

Counts are failing cases or lines in the named runs; ids are in `.artifacts/lab/cases/`. A stand-in Canvas census
(the engine in bun, gaps set against the real per-case metrics) finds no failing case without a gap in smoke-r6 (12),
ws-r6 (1), policy-r5 (7) or runs-r6 (144), and 9 of 2,005 in suite-r3, class 7 below.

1. **Arabic joining at call edges in AAT fonts (named gap `unsafe-to-break`; model decision).** runs-r6 bidi-runs 85
   and split-word 27 widths, 9 split-word breaks; policy-r5 overflow-wrap and word-break 4 breaks, 3 widths; about 509
   suite-r3 lines differing by −703 or −701 units in fonts that fall back to Geeza Pro (Shantell Sans, ProbeShantell).
   The port joins where Geeza Pro reshapes isolated forms. Example `c-0f06b802391f39b9`: line 5 ends at an unsafe join;
   native `وأعان` is 45.7265625px with an isolated `ن`, predicted 40.0390625px.
2. **A chosen soft hyphen in an RTL run is drawn but not observed (lab observation, rebuild/lab/ISSUES.md).** About 575
   suite-r3 lines differ by exactly the hyphen (+756 units Amiri, +660 Noto Naskh Arabic, +682 Arial); smoke
   `c-1cb8b9aea80ececb`, `c-f73e825e2a1758dd`. Probe blink-followups F3 shows the hyphen drawn left of the letter.
3. **Soft hyphens between emoji sequence parts (resolved after suite-r5).** suite-r3 woman-before-zwj 164, skin-modifier
   148, woman-after-zwj 148 line counts: the port left the SHY out, so Canvas joined `👍🏽`, which natively stays two
   segments. Canvas strings now carry U+2060 there (Follow-up). In suite-r6 these three families fail no line count and
   no break; skin-modifier/shy still fails 12 widths, not attributed yet (`c-07a3246bc666d379` line 2: native
   15.6796875px, predicted 18.6796875px). `c-018aabf9e8c15984` passes.
4. **Common punctuation that inherits another script (named gap `script-context`).** suite-r3 36 lines at −623 units:
   Amiri `(` after Arabic shapes with the Arabic script natively and as Latin in Canvas. Example `c-26a7a7b28da24b44`.
   No Canvas string gives an LTR `(` the Arabic script: an Arabic letter beside it starts another bidi run.
5. **U+FFFC in text (named gap `font-fallback`).** suite-r3 22 widths. Canvas measures U+FFFC as U+200B; the DOM draws a
   fallback glyph. Example `c-ff4745cb7e9bb2a1`.
6. **Emoji sequences split across spans (named gap `font-fallback`).** `c-8862f0d3be757916` (keycap, −2048 units),
   `c-24cbaf244be355e6` (🏳️ in one span, ‍🌈 with letter spacing 5px in the next: +640 units).
7. **Legacy `kern` attribution at a line end before a space (named gap `unsafe-to-break`).** suite/negative-space,
   spacing-tail and space-context (9 lines, −57 units), runs `c-73ac54b28cdfe776` (−76). Times New Roman kerns `A` with the
   space through the legacy `kern` table, which puts d >> 1 on `A`; the port puts all of d there (specs/blink-gaps.md
   §3.6 L1). These 9 reported no gap because line-edge gaps skipped a paragraph's last line; that is fixed after
   suite-r3 and doesn't change predicted lines.
8. **Tab stops from the untracked platform space advance (named gap `tab-stops`).** `c-87e013cf240ecbdc`, −1 unit.
   Probe blink-followups F4: 16px Helvetica Neue stops at multiples of 35.5859375px, not 8 × Canvas's 4.453125px.
9. **Painter form (shared painter).** CJK line-end trims don't happen again on a painted line (policy-r5 zh-lang 3 and
   line-break 2, runs `c-3e4c81707a37c51f`: painted 20px, predicted 10px); bidi lines under override spans 1 unit wider
   (runs-r6 20 lines, painter.md L9, `c-05bbcacc0fe2f0e5`); a bare FF text node loses its advance (`c-0ca55250962649aa`,
   +682 units); trailing-space edges (`c-0fe656a162eb2508`, −37 units). The painter also puts U+200D after the last
   letter of an RTL run in an LTR block, where the U+200D takes the paragraph level and doesn't join.

## Changes by run

- smoke-r1: first port.
- smoke-r2: lang="" is a null locale; `optimizeLegibility` contexts (whole-run Canvas shaping for fonts whose GPOS or
  GSUB cover the space glyph, which fixed Hiragino kana and CJK kerning); `width` leaves out hanging spaces.
- ws-r1: white-space set first run.
- runs-r1, runs-r2: VT measured as U+0001; pieces halved until below 256 px; ZWJ joining context.
- policy-r1, suite-r1: first runs.
- smoke-r3, ws-r3, policy-r3: the painted extent includes the hyphen and leaves out trailing ink-less code points;
  `joinsNextLine` at joined edges; gap names `han-kerning` and the joining gaps.
- ws-r4: TAB counts as white space in the painted extent.
- smoke-r4, runs-r3, policy-r4, ws-r5: HanKerning (`hankerning.ts`); Range-rect edges rounded to LayoutUnits.
- runs-r4, suite-r2: never ran (lock wait).
- smoke-r5, runs-r5: the audit's fixes (specs/blink-AUDIT.md §8): HanKerning trims on every position after a group's
  first character and at unsafe group starts; joining offsets unsafe to break, U+200D at every call edge under one
  model; ScriptRunIterator and `script-context`; the extent rule from score.ts with generated ICU classes; one Canvas call
  per group below 256 zoomed px; line boxes from should_create_line_box; line-edge gaps; `tab-stops`; system-ui at the CSS
  size; letter spacing on spaces in cursive runs.
- debug-3, debug-4: `--predictor` traces returning the measure log (resumed-zero-tail, source-shaped-arabic).
- arabic-ot-0/1, arabic-aat-0/1: the joining model comparison above.
- smoke-r6, ws-r6, runs-r6, policy-r5, suite-r3: pair windows reach past default-ignorable characters, which HarfBuzz's
  lookups skip (`c-544518dd1f5540d5` now passes); the painted extent is at least 0 (`c-b097eff3c56ef9a0`).
- smoke-r7, ws-r7, runs-r7, policy-r6, suite-r4: the build before the default-ignorable change. Every metric equals the
  r6 runs in smoke, ws, runs and policy; suite-r4 differs from suite-r3 in 23 cases (my-cunning-heron-teacher,
  spacing/curly-single-close, my-bad-deeds-return-to-you-teacher, maintained/corpus), not attributed here.
- smoke-r8, ws-r8, runs-r8, policy-r7, suite-r5: default-ignorable characters left out of Canvas strings (see Follow-up).
- smoke-r9, ws-r9, runs-r9, policy-r8, suite-r6: U+2060 in place of those characters, left out where the string would
  otherwise be 8-bit (see Follow-up); paint.ts 3221c114 from its owner.

## Follow-up

**Left out of Canvas strings (smoke-r8, ws-r8, runs-r8, policy-r7, suite-r5).** The previous build left SHY, ZWSP, LRM,
RLM, U+202A..U+202E and U+FEFF out of every Canvas string, because Blink's Canvas turns them into U+200B and ends a word
there. Against smoke-r7, ws-r7, runs-r7, policy-r6 and suite-r4 (fixed / broke):

- ws, runs: no case changed.
- smoke: lineCount 0 / 1, breaks 0 / 3, widths 0 / 4, painter 0 / 3, all policy/thai.
- policy: lineCount 0 / 2, breaks 0 / 9, widths 0 / 14, painter 0 / 13, all policy/thai: Thonburi cases with U+200B
  before a mark or vowel (`ค​์`), which the left-out ZWSP put on the consonant before it.
- suite: lineCount 1 / 325, breaks 1 / 409, widths 1 / 505, painter 8 / 253.
  - skin-modifier/zwsp, woman-after-zwj/zwsp and woman-before-zwj/zwsp: widths 168 / 168 / 168 broke. Canvas joined `👍🏽`
    and `👩‍🚀` across the left-out ZWSP; natively the sequence stays split.
  - U+FEFF/middle 10, U+200B/middle 1, control 1: `ب­ب﻿ب` in Shantell Sans (Geeza Pro fallback). Canvas joined the letters
    across the ZWSP or U+FEFF; natively Geeza Pro gives isolated forms there.
  - cluster-v1: broke `a​́b` (Arial, letter spacing −4px, `c-7f37991f6889a284`), where the mark moved onto `a`; fixed
    `a﻿﻿́b` (Courier New, −4px, `c-bf63924e328743c3`).
  - mark-context and source-views: painter fixed 7 (`a⁠́​̈b`, Courier New).
  - partial-source-context: `c-9f72ec9d12c60092` passes (`‏((tail` in Amiri); see the RLM strings below.

**Probe blink-ignorables.** 29 DOM strings in installed Chrome, against Canvas strings at the zoomed size (DOM units
against ceil64 of the Canvas width):

- Left out: wrong for every emoji sequence with SHY or ZWSP between its parts (`a👍­🏽b` natively 8793 units, left out
  6489), Geeza Pro joining across ZWSP or U+FEFF (3931 against 2527), and Thai marks after ZWSP (14160 against 12991).
- The character itself, U+2060 and U+034F: equal to the DOM in 27 of 29 strings, including those, kerning across ZWSP
  (Arial `A​V`, ProbeShantell bold `abc​d` with 1px spacing), Amiri joining, and marks after ZWSP or U+FEFF with letter
  spacing −4px and 1px.
- U+180E: wrong wherever script matters (Mongolian script splits the run): kerning, Amiri.
- Parts measured alone: wrong for kerning, joining, letter spacing on marks and `a👍­🏽b`.
- The other 2 strings hold RLM before `((` in Amiri. The RTL item `‏((` is 1567 units natively and left out, and 2814 with
  the character or any substitute. It isn't the storage class: in `ignorables-3`, `(((` is 36.719970703125px as an 8-bit
  and as a 16-bit string, while `⁠((` is 43.967987060546875px against `((` at 24.47998046875px. The cause isn't known.

**The recipe (smoke-r9, ws-r9, runs-r9, policy-r8, suite-r6).** From source: the DOM keeps the character in the shaping
call. RunSegmenter's emoji scanner sees a non-emoji character there, so `👍` SHY `🏽` stays two segments
(emoji_segmentation_category_inline_header.h:15-77); `morx` state machines see its glyph (hb-aat-layout-common.hh:1226-1241);
HarfBuzz hides it only after substitution (hb-ot-shape.cc:951-959). The character itself can't go into a Canvas string:
Canvas turns it into U+200B (plain_text_node.cc:47-62), which ends a word in fonts shaped word by word (:85-91). U+2060
WORD JOINER has the same HarfBuzz properties (gc Cf, neither joiner nor hidden, hb-ot-layout.hh:212-244), script Common,
emoji category kMaxCategory and bidi class BN, and Canvas doesn't normalize it. So `canvasString` measures U+2060 in
place of these characters. Where the string without them would be 8-bit (an 8-bit paragraph, or 1 or 2 code units),
they're left out and the string keeps that storage, as every probed Latin-1 string (and the RLM item above) needs, and
`soft-hyphen-shaping` is reported, since a `morx` substitution across a left-out character can still differ.

Prediction metrics against the build before any change (smoke-r7, ws-r7, runs-r7, policy-r6, suite-r4), fixed / broke:

- suite: lineCount 568 / 0, breaks 591 / 0, widths 434 / 0. skin-modifier/shy 148, woman-before-zwj/shy 164 and
  woman-after-zwj/shy 148 line counts (class 3); the U+200B..U+200D, U+2060, U+FEFF and U+2028 families, 6 each at
  start, 4 in the middle and 4 at end (U+2028/start 10, U+2028/end 12, U+200D/end 6); marks 3, unprovided-direction 2
  and single cases in control-character families. Against suite-r5: lineCount 893 / 1, breaks 999 / 0, widths 938 / 0.
  The one is `c-bf63924e328743c3` (`a﻿﻿́b`, Courier New, −4px), which suite-r5 fixed and which fails again as in suite-r4
  (native 3 lines, predicted 5), though the probe's `a﻿﻿́b` at −4px equals the DOM. Not attributed.
- smoke: lineCount 2 / 0, breaks 2 / 0 (woman-after-zwj/shy, U+2060/start); the policy/thai cases smoke-r8 broke pass
  again.
- policy: no prediction metric differs from policy-r6; the 14 Thai cases policy-r7 broke pass again.
- ws, runs: no prediction metric differs.
- Painter (confounded with paint.ts 3221c114): suite 1721 / 0, smoke 5 / 0, ws 5 / 0, runs 6 / 0, policy 1 / 0. Some
  suite fixes are `a­b` beside a C0 or C1 control in 8-bit paragraphs, whose Canvas strings didn't change, so they come
  from the painter: its change keeps lines that end at a chosen soft hyphen or start with U+200D from wrapping, and
  paints an empty span between two slices.
- Still failing in the families this touched: U+FEFF/middle 2 line counts and 46 widths (from 6 and 48), U+200B/middle 1,
  control 2 widths and partial-source-context 7 line counts, all as in suite-r4.
- measureText calls: suite-r6 mean 40.7, against 40.3 in suite-r4.

`bun test rebuild/src/engines/blink`: 60 pass, 0 fail. `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean.

## Probes run

`rebuild/probes/blink-followups.ts` in installed Chrome 153 (`.artifacts/probes/blink/followups/chrome-probes.json`):

- F1: Amiri keeps joined forms on one-letter lines; Geeza Pro takes isolated forms (the joining model above).
- F2: PingFang SC `《书名》：标` at 1px: lines `《书`, `名》：` (》 10px wide), `标`.
- F3: a chosen soft hyphen in Noto Naskh Arabic is drawn left of the letter while its SHY rect is zero width (class 2).
- F4: tab stops follow the untracked space advance (class 8).

`rebuild/probes/blink-ignorables.ts` in installed Chrome 153 (`.artifacts/probes/blink/ignorables-2/chrome-probes.json`,
and `ignorables-3` with the storage probe): 29 strings holding SHY, ZWSP, RLM or U+FEFF, each DOM width against Canvas
strings with the character left out, the character itself, U+2060, U+034F and U+180E, and Amiri brackets as 8-bit and
16-bit strings (Follow-up).

## Notes for the architect

- DESIGN.md §2.3 names `styleRun`; `BlinkLineStart` holds `style`, an index into the prepared styles (the block's style
  is 0, a span's style follows its run). The break token needs the current ComputedStyle, and every bare text node shares
  the block's.
- painter.md §3.1 a says joining marks glyphs `unsafe_to_concat`, not `unsafe_to_break`. HarfBuzz's safe_to_insert_tatweel
  falls back to unsafe_to_break without the tatweel buffer flag (hb-buffer.hh:517-527; hb-ot-shaper-arabic.cc:332, 366),
  and AAT transitions are marked too (hb-aat-layout-common.hh:1341-1370): Blink reshapes every line edge between joining
  letters. OpenType fonts keep the joined forms there through the context, AAT fonts don't (probe F1).
- blink-text §2.F.3 says `lang=""` inherits; element.cc:12595-12599 sets a null locale, and the rows agree.
- DESIGN.md §5 `unsafe-to-break`: the pair-total test is only necessary. It misses joining letters and adjustments across
  default-ignorable characters (hb-ot-layout-gsubgpos.hh:558-571), which the port now checks.
- Shared-file change: GapName `tab-stops` (SHARED-CHANGES.md, 10:50).
- DESIGN.md §5 `soft-hyphen-shaping`, Blink column: the handling is U+2060 in place of SHY, ZWSP, LRM, RLM, U+202A..U+202E
  and U+FEFF (Canvas turns all of them into U+200B, not only SHY), and the character left out where the Canvas string
  would otherwise be 8-bit. Predictions can be wrong where a `morx` substitution crosses a left-out character (Follow-up).
- blink-gaps §8's hypotheses beyond F1-F4 still have no probe verdict: U+2028 for spaces (H5-H8), U+0001 for FF and VT
  (H1-H3, which probes-chrome X2 supports for Arial and Helvetica Neue), and the pair-total safe test (H12).
- `bun test rebuild/src`: 128 pass, 0 fail. `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean.
