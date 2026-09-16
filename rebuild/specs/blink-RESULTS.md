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
  and on FF, by the Canvas string's own script runs; 8-bit or 16-bit Canvas strings as the paragraph segments;
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
3. **Soft hyphens between emoji sequence parts (named gap `soft-hyphen-shaping`).** suite-r3 woman-before-zwj 164,
   skin-modifier 148, woman-after-zwj 148 line counts. The port drops the SHY from measured text, which joins `👍` + `🏽`
   into one glyph in Canvas; in the DOM the hidden SHY glyph blocks the sequence. Example `c-018aabf9e8c15984`.
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

## Probes run

`rebuild/probes/blink-followups.ts` in installed Chrome 153 (`.artifacts/probes/blink/followups/chrome-probes.json`):

- F1: Amiri keeps joined forms on one-letter lines; Geeza Pro takes isolated forms (the joining model above).
- F2: PingFang SC `《书名》：标` at 1px: lines `《书`, `名》：` (》 10px wide), `标`.
- F3: a chosen soft hyphen in Noto Naskh Arabic is drawn left of the letter while its SHY rect is zero width (class 2).
- F4: tab stops follow the untracked space advance (class 8).

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
- blink-gaps §8's hypotheses beyond F1-F4 still have no probe verdict: U+2028 for spaces (H5-H8), U+0001 for FF and VT
  (H1-H3, which probes-chrome X2 supports for Arial and Helvetica Neue), and the pair-total safe test (H12).
- `bun test rebuild/src`: 128 pass, 0 fail. `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean.
