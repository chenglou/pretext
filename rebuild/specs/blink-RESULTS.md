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
| ws (1,019) | ws-r1 | 1019/0/0 | 1014/3/2 | 913/60/41 | 907/79/33 |
| ws (1,019) | ws-r3 | 1019/0/0 | 1017/0/2 | 946/30/41 | 941/45/33 |
| runs (2,580) | runs-r1 | 2517/54/9 | 2426/144/10 | 2273/71/82 | 2342/160/78 |
| runs (2,580) | runs-r2 | 2559/12/9 | 2524/46/10 | 2353/87/84 | 2358/144/78 |
| policy (1,606) | policy-r3 | 1600/6/0 | 1589/17/0 | 1581/8/0 | 1603/3/0 |
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

## What the port does

- `content.ts`: TextLayoutObjectIsNeeded, AppendCollapseWhitespace / PreserveNewline / PreserveWhitespace with the
  removed and restored trailing spaces, ExitBlock, source offsets per text_content unit; bidi through `unicode/ubidi.ts`
  and SetBidiLevel splitting; lang to locale (lang="" is a null locale, element.cc MapLanguageAttributeToLocale).
- `breaks.ts`: LazyLineBreakIterator: the space rule, `kFastLineBreakTable`, break-all (Unicode 17 classes, HH row
  empty), keep-all per code unit, soft hyphens, ICU restarted at every line start with the rule file per locale and
  strictness, `Intl.v8BreakIterator` inside dictionary segments, grapheme boundaries for kBreakCharacter.
  `breaks.test.ts` equals the groundwork's C++ oracle on all 13,108 requests outside SA runs.
- `shape.ts`: shaping groups measured in pieces below 256 zoomed px with U+2028 for U+0020 and `optimizeLegibility`
  contexts, the pair total at each cut on the glyph before it, safe-to-break from the pair total, ZWJ on sides where
  Arabic joining crosses a measured range, positions and offsets per ShapeResult (LTR and RTL), views, reshapes, the
  hyphen with the two-fallback U+2010 test, tab runs from the block's space advance.
- `line-breaker.ts`: NextLine, BreakLine, HandleText, BreakText with the hyphen retry, ShapeLine (without HanKerning and
  auto-space), HandleTrailingSpaces, HandleEmptyText, HandleControlItem, HandleForcedLineBreak, open and close tags,
  HandleOverflow with the 1px re-break and the break-anywhere retry, RewindOverflow, Rewind, ComputeCurrentStyle,
  RemoveTrailingCollapsibleSpace with RewindTrailingOpenTags, SplitTrailingBidiPreservedSpace.
- `index.ts`: settings, groups, fragments tiling the source, the painted extent (hanging white space and ink-less code
  points left out), `joinsNextLine`, gaps.

## Failure classes

Counts are failing cases in the named runs; ids are examples in `.artifacts/lab/cases/`.

1. **HanKerning (named gap `han-kerning`), CJK.** runs-r2 lang-spans 39 widths, policy-r3 line-break 6 breaks, smoke 3.
   Native lines are half an em narrower where Blink trims fullwidth punctuation with `halt` from context the Canvas
   measure doesn't see: at line ends (ShapingLineBreaker step 4, `han_kerning_end`), next to characters outside the
   shaped range (han_kerning.cc AppendFontFeatures reads text[start-1] and text[end]), and in reshapes that keep that
   context. Examples: `c-3e4c81707a37c51f` (》 alone on a line: native 10px, predicted 20px), `c-07f2657d11bf821f`,
   `c-22d2e56a8f6124cc`. Not ported: HanKerning char types need Character::GetHanKerningCharType data and font facts
   (halt, chws, glyph bounds).
2. **Arabic joining at line edges and group edges (named gap `unsafe-to-break`).** Geeza Pro, an AAT font, reshapes a
   line edge without joining; the port measures OpenType behaviour (joining is unsafe_to_concat, not unsafe_to_break,
   painter.md §3.1 a), which Amiri and Noto Naskh Arabic follow. policy-r3 overflow-wrap 4 breaks (`c-0dd1d404ea812dbc`,
   `c-4862558a05c81dd3`), runs-r2 split-word/letter-spacing-spans widths (`c-a6803706e450767e`). Canvas can't tell AAT
   from OpenType.
3. **Soft hyphens between emoji sequence parts (named gap `soft-hyphen-shaping`).** suite-r1 woman-before-zwj,
   woman-after-zwj, skin-modifier: about 460 lineCount failures. The port drops SHY from measured text, which joins
   `👍` + `🏽` into one glyph in Canvas; in the DOM the hidden SHY glyph blocks the emoji sequence. Example
   `c-018aabf9e8c15984`.
4. **VT, FF and C0/C1 controls in collapse modes (named gap `control-character-width`).** ws-r3 controls 15 widths,
   suite U+00xx families. The DOM draws them with CoreText's fallback (1/3 em in Hiragino at 16px, probe X2); Canvas
   turns U+0009..U+000D into spaces and measures U+0001 and C1 controls with other widths. Examples
   `c-18c903c4ae9640d6`, `c-5bb28a79f6310f0d`. specs/blink-gaps.md §2.8's U+0001 recipe does not reproduce the DOM
   width here: Canvas gave U+0001 the space advance.
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
9. **Painter form.** Lines holding only a soft hyphen and its hyphen span wrap at narrow widths (`c-45a96fe1087eb491`),
   and an empty span run isn't painted, so a following bare FF text node loses its LayoutText in the painted DOM
   (`c-0ca55250962649aa`). Both live in the shared painter.

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
