# Blink port results (Chrome 153.0.8010.48)

Lab runs of `rebuild/src/engines/blink` in installed Chrome 153 on this Mac (Retina, `devicePixelRatio` 2, UI language
zh-CN), 2026-09-16. Rows and summaries are under `.artifacts/lab/blink/<run>/`. The scorer snaps Chrome widths to
1/128 px at DPR 2 (`grid 128`), so a 1-unit error is 1 raw LayoutUnit.

## Scores

pass / fail / unobserved (not-applicable left out).

| Case set | Run | lineCount | breaks | widths | painter |
|---|---|---|---|---|---|
| smoke (299) | smoke-r1 | 295/4/0 | 287/6/6 | 239/36/12 | 252/43/4 |
| smoke (299) | smoke-r3 | 296/3/0 | 290/3/6 | 260/13/17 | 277/18/4 |
| smoke (299) | smoke-r4 | 296/3/0 | 290/3/6 | 263/10/17 | 280/15/4 |
| ws (1,019) | ws-r1 | 1019/0/0 | 1014/3/2 | 913/60/41 | 907/79/33 |
| ws (1,019) | ws-r3 | 1019/0/0 | 1017/0/2 | 946/30/41 | 941/45/33 |
| ws (1,019) | ws-r4 | 1019/0/0 | 1017/0/2 | 963/13/41 | 958/28/33 |
| ws (1,019) | ws-r5 | 1019/0/0 | 1017/0/2 | 975/1/41 | 970/16/33 |
| runs (2,580) | runs-r1 | 2517/54/9 | 2426/144/10 | 2273/71/82 | 2342/160/78 |
| runs (2,580) | runs-r2 | 2559/12/9 | 2524/46/10 | 2353/87/84 | 2358/144/78 |
| runs (2,580) | runs-r3 | 2563/8/9 | 2541/29/10 | 2401/56/84 | 2401/99/80 |
| policy (1,606) | policy-r1 | 1600/6/0 | 1589/17/0 | 1581/8/0 | 1598/8/0 |
| policy (1,606) | policy-r3 | 1600/6/0 | 1589/17/0 | 1581/8/0 | 1603/3/0 |
| policy (1,606) | policy-r4 | 1605/1/0 | 1599/7/0 | 1596/3/0 | 1598/8/0 |
| suite-sample (19,994) | suite-r1 | 19333/660/1 | 19064/706/224 | 14593/1665/2806 | 15182/4645/167 |

The suite sample ran in eight chunks of 2,500 cases (`.artifacts/lab/blink/cases/suite-0N.ndjson`, `suite-r1/0N/`),
each under its own lock. suite-r1 predates the painted-extent and `joinsNextLine` changes below.

## measureText calls per paragraph

From `prediction.measureLog` (calls that reached Canvas; the per-layout memo answers repeats).

| Run | mean | median | p95 | max | per line |
|---|---|---|---|---|---|
| smoke-r3 | 36.9 | 29 | 88 | 145 | 8.2 |
| ws-r3 | 32.1 | 30 | 65 | 138 | 8.9 |
| runs-r2 | 52.1 | 47 | 104 | 253 | 11.8 |
| policy-r3 | 40.6 | 34 | 88 | 191 | 8.3 |
| suite-r1 | 32.7 | 12 | 94 | 8,698 | 10.2 |
| smoke-r4 | 49.2 | 42 | 114 | 217 | 11.0 |
| ws-r5 | 40.7 | 38 | 82 | 162 | 11.2 |
| runs-r3 | 73.7 | 65 | 151 | 337 | 16.7 |
| policy-r4 | 47.8 | 42 | 99 | 203 | 9.8 |

The r4/r3/r5 runs measure more because HanKerning probes each CJK style's font (the 「「 trim and ten glyph bounds) and
the extent measures prefixes at line edges.

## What the port does

- `content.ts`: TextLayoutObjectIsNeeded, AppendCollapseWhitespace / PreserveNewline / PreserveWhitespace with the
  removed and restored trailing spaces, ExitBlock, source offsets per text_content unit; bidi through `unicode/ubidi.ts`
  and SetBidiLevel splitting; lang to locale (lang="" is a null locale, element.cc MapLanguageAttributeToLocale).
- `breaks.ts`: LazyLineBreakIterator: the space rule, `kFastLineBreakTable`, break-all (Unicode 17 classes, HH row
  empty), keep-all per code unit, soft hyphens, ICU restarted at every line start with the rule file per locale and
  strictness, `Intl.v8BreakIterator` inside dictionary segments, grapheme boundaries for kBreakCharacter.
  `breaks.test.ts` equals the groundwork's C++ oracle on all 13,108 requests outside SA runs.
- `shape.ts`: shaping groups measured in pieces below 256 zoomed px with U+2028 for U+0020 and `optimizeLegibility`
  contexts, the pair total at each cut on the glyph before it (after it for a halted open mark), safe-to-break from the
  pair total, ZWJ on sides where Arabic joining crosses a measured range, HanKerning context at group and reshape edges,
  letter spacing on spaces in cursive runs, positions and offsets per ShapeResult (LTR and RTL), views, reshapes, the
  hyphen with the two-fallback U+2010 test, tab runs from the block's space advance.
- `hankerning.ts`: HanKerning character types (generated from ICU 78.2 blk, ea and gc), font data from Canvas (`halt`
  through the 「「 pair trim, glyph ink bounds for dots, colons and quotes), ShouldKern and ShouldKernLast, trims per
  character.
- `line-breaker.ts`: NextLine, BreakLine, HandleText, BreakText with the hyphen retry, ShapeLine (with the HanKerning
  line-end trim; no auto-space, which is off by default), HandleTrailingSpaces, HandleEmptyText, HandleControlItem, HandleForcedLineBreak, open and close tags,
  HandleOverflow with the 1px re-break and the break-anywhere retry, RewindOverflow, Rewind, ComputeCurrentStyle,
  RemoveTrailingCollapsibleSpace with RewindTrailingOpenTags, SplitTrailingBidiPreservedSpace.
- `index.ts`: settings, groups, fragments tiling the source, the painted extent (hanging white space and ink-less code
  points left out), `joinsNextLine`, gaps.

## Failure classes

Counts are failing cases in the named runs; ids are examples in `.artifacts/lab/cases/`.

1. **HanKerning (named gap `han-kerning`), CJK.** runs-r3 lang-spans 18 widths (runs-r2: 39), policy-r4 line-break
   breaks down to 7 (from 17). The port now applies Blink's context trims and the line-end trim, with font facts from
   Canvas. What remains is off by half an em in both directions: which glyph a chws adjustment sits on inside a group
   (the pair total can't say), segments narrower than groups (AppendFontFeatures runs per script segment), and fonts
   where the 「「 probe and `halt` disagree. Examples `c-07f2657d11bf821f`, `c-111dee8e6a53b668`, `c-5325d5f65e230b90`.
2. **Arabic joining at line edges and group edges (named gap `unsafe-to-break`).** Geeza Pro, an AAT font, reshapes a
   line edge without joining; the port measures OpenType behaviour (joining is unsafe_to_concat, not unsafe_to_break,
   painter.md §3.1 a), which Amiri and Noto Naskh Arabic follow. policy-r3 overflow-wrap 4 breaks (`c-0dd1d404ea812dbc`,
   `c-4862558a05c81dd3`), runs-r2 split-word/letter-spacing-spans widths (`c-a6803706e450767e`). Canvas can't tell AAT
   from OpenType.
3. **Soft hyphens between emoji sequence parts (named gap `soft-hyphen-shaping`).** suite-r1 woman-before-zwj,
   woman-after-zwj, skin-modifier: about 460 lineCount failures. The port drops SHY from measured text, which joins
   `👍` + `🏽` into one glyph in Canvas; in the DOM the hidden SHY glyph blocks the emoji sequence. Example
   `c-018aabf9e8c15984`.
4. **VT, FF and C0/C1 controls (named gap `control-character-width`).** ws-r5 has 1 width failure left; suite U+00xx
   families. VT and FF measured as U+0001 (specs/blink-gaps.md §2.8) take the fallback advance the DOM uses: before the
   substitution Canvas gave VT the space advance (`c-0c1f51b39facaa62`), after it the ws controls widths pass. C1 controls
   still measure differently (`c-5bb28a79f6310f0d`: Canvas 16px for U+009D).
5. **Tab stops from the float space advance (spec observation).** `c-87e013cf240ecbdc`, 1 unit. Font::TabWidth uses
   SimpleFontData::SpaceWidth, the untruncated float advance; Canvas returns it truncated to 16.16, so a tab stop can land
   1 LayoutUnit early. No gap name fits; recorded here.
6. **Invisible characters next to Arabic soft hyphens in RTL (observation).** suite-r1 chunk 07 U+200B, U+200C, U+2060,
   U+FEFF families: native line `ب` 4.40625 vs predicted 9.5625 (the hyphen). Chrome reports the SHY rect with zero
   width in RTL, so the scorer doesn't mark the width unobserved while the prediction includes the hyphen. Example
   `c-0167f0e244838f3b`. To be written to rebuild/lab/ISSUES.md once the native hyphen is confirmed.
7. **Thai break-all inside grapheme clusters (observation, rebuild/lab/ISSUES.md).** `c-213e2818602b7033`,
   `c-8234a339ec2266c1`, `c-8299efa6cdb80808`: native and predicted lines start at the same offsets; the scorer's
   grapheme check fails the prediction.
8. **U+FFFC in text (named gap `font-fallback`).** `c-ff4745cb7e9bb2a1`: Canvas measures U+FFFC as U+200B, the DOM
   draws a fallback glyph.
9. **Painter form.** runs-r3 has 48 painter-only failures: bidi lines painted under override spans come out 1 LayoutUnit
   wider, since the inserted bidi controls divide items differently (painter.md L9; `c-05bbcacc0fe2f0e5`), CJK line-end
   trims don't happen again on a painted line (`c-3e4c81707a37c51f`), and emoji sequences split across spans
   (`c-24cbaf244be355e6`). Lines holding only a soft hyphen and its hyphen span wrap at narrow widths
   (`c-45a96fe1087eb491`), and an empty span run isn't painted, so a following bare FF text node loses its LayoutText in
   the painted DOM (`c-0ca55250962649aa`). All of these live in the shared painter.
10. **Emoji sequences split across spans (named gap `font-fallback`, not reported per paragraph yet).** `1️` in one span and
    `⃣❤️` in the next: native 16px wider (`c-8862f0d3be757916`, `c-23e3483b3b25122f`).
11. **Unported: shaping segments.** Groups don't break at script-run segments (`EqualsRunSegment`), and HanKerning context
    uses group edges where Blink uses segment edges.

## Changes by run

- smoke-r1: first port.
- smoke-r2: lang="" is a null locale; `optimizeLegibility` contexts (whole-run Canvas shaping for fonts whose GPOS or
  GSUB cover the space glyph, which fixed Hiragino kana and CJK kerning); `width` leaves out hanging spaces.
- ws-r1: white-space set first run.
- runs-r1, runs-r2: VT measured as U+0001; pieces halved until below 256 px; ZWJ joining context (runs-r1 had a broken
  ZWJ literal that measured `"""+bs+"""u200d` text, fixed in runs-r2).
- policy-r1, suite-r1: first runs.
- smoke-r3, ws-r3, policy-r3: the painted extent includes the hyphen and leaves out trailing ink-less code points;
  `joinsNextLine` at joined edges; gap names `han-kerning` (shared, logged in SHARED-CHANGES.md) and the joining gaps.
- ws-r4: TAB counts as white space in the painted extent (ws-r3 had dropped trailing tabs under `pre` and
  `break-spaces`).
- smoke-r4, runs-r3, policy-r4, ws-r5: HanKerning (`hankerning.ts`): character types from ICU 78.2 (blk, ea, gc), font
  data from Canvas (the 「「 pair trim for `halt`, ink bounds for dots, colons and quotes), context trims at shaping-group
  and reshape edges, the open-mark attribution after the pair, and ShapeLine's line-end trim; Range-rect edges rounded
  to LayoutUnits; leading ink-less controls left out of the extent, and a control with width ends the hanging run.
- runs-r4, suite-r2: letter spacing added back for spaces in cursive-script runs, which U+2028 had hidden from Canvas
  (`c-a797931f634f8091`). suite-r2's chunks were bundled while this change landed, so early chunks may predate it.

## Notes for the architect

- `BlinkLineStart` holds `style`, an index into the prepared styles (the block's style is 0, a span's style follows its
  run), where DESIGN.md §2.3 names `styleRun`. The break token needs the current ComputedStyle, and every bare text node
  shares the block's, so an index is the one source of truth; DESIGN.md should follow.
- Shared-file changes, logged in SHARED-CHANGES.md: GapName `han-kerning` (model.ts) and `measureTextBounds`
  (measure/canvas.ts), both additive.
- `bun test rebuild/src`: 79 pass, 1 fail, and the failure is the WebKit owner's
  `engines/webkit/breaks.test.ts` (`linebreak-table-pairs.tsv`). `bunx tsc --noEmit -p rebuild/tsconfig.json` is clean.
- Blink tests: `breaks.test.ts` (13,108 oracle requests, 0 differences outside SA runs, plus the §2.F.5 worked examples
  and the rule-file table), `content.test.ts` (the §2.C.4 examples, DESIGN.md example 1's text_content and items,
  pre-wrap and pre-line, bidi D5) and `lines.test.ts` (DESIGN.md §2.2 examples 1 and 2, the +1 raw fit bound, forced
  breaks, an empty paragraph) with a stand-in Canvas.
- A shaping-group edge inside a grapheme cluster now reports `font-fallback` (class 10 above).
