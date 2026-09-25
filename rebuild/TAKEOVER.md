# Takeover decisions and evidence

2026-09-25, Blink's words-first gap-naming round (branch `blink-words-first`, unmerged; [DESIGN.md §4.6, §5](DESIGN.md)):
the losses the loss round left against the rebuild line (`61c376d`), each now a named gap an inspected paragraph raises
where the port's measurements show its condition, or a named font-level limitation in the known tail. The maintainer's
stopping rule for the redo asks that every remaining difference be a named gap, a made-up or variation-extreme font or a
width under 24 px; the lead's decision is that words first lands once every loss class is named so. What changed
(`gaps.ts` `windowSides`, `lineEdgeGaps`, `startSpread`; rules `blink/gap/one-unit-fit`, `stand-in-start-reach`,
`white-space-window-side`, `common-window-side`; `remaining-gaps.test.ts`), each on the inspected path alone:
- A wrapped line start beside a space that the port's width tests call safe, on a line whose fit test is decided by
  under two LayoutUnits, reports `in-word-prefix` at the break the decision took, a point: HarfBuzz can flag such a
  start with no width signature, and Blink's reshape then corrects the space by 0 or −1 LayoutUnits
  (shaping_line_breaker.cc:309-324). The same condition inside a word already reported at the start alone. It names the
  fits a LayoutUnit decides after a space: Arabic in Hiragino Mincho ProN's fallback, Apple SD Gothic Neo's
  `neutral-words`, Mishafi at DPR 1.
- A wrapped line start taken from a stand-in position reports its reach under the name its position rests on, over the
  same break, where the line's fit lies within what the position can be off by plus one LayoutUnit: Helvetica Neue's
  line after the hyphen at SHY. Both reported over the whole line in the round's first form (`2f69a4f`), and its first
  recording showed why that is wrong: the observation port limits every position a gap's range meets, and with the
  lab's facts 39 wrong values left the exact-value count (807 to 768 differing) under a condition that moves no glyph;
  over the text the decision settles (from the break before the line's end through the next one) it was still 16
  (807 to 791). A point at the break limits no width and covers the same lost layouts.
- A window whose side is white space alone in a face whose space takes the script, and a window whose side Canvas shapes
  as Common alone where the paragraph shapes it under its run's script and that shows an adjustment or vetoes the
  offset, report `script-context` over the clusters around the offset: Euphemia UCAS's lone space, Skia's ` 2026`,
  italic Athelas's ` , `. The first can ask the style's two space questions (`spaceTakesScript`) of Canvas where nothing
  asked them yet, on an inspected paragraph alone.
- Named already, by the existing conditions: Hoefler Text's kern before a space (`unsafe-to-break` at the line end, no
  `pairKerning` fact), the soft hyphens at 809 to 1,422px in Kailasa, Baghdad, Noto Sans Siddham and DecoType Naskh
  (`float32-precision` over first lines of 256 zoomed px or more whose runs a font the facts don't name draws).
- Zapfino's morx state shows in no Canvas answer: the known tail's `blink/zapfino-morx-unsafe-state`, with its evidence,
  and no code keyed on the font. The known tail also holds the classes above (`blink/lone-space-in-a-space-script-face`,
  `blink/fit-within-a-layout-unit`, `blink/kern-before-a-space-without-pair-kerning`,
  `blink/common-stretch-measured-alone`), each with its lost layouts.
The evidence (runs under `.artifacts/tests/runs/bwf-gaps-20260925`; pinned Chrome 153 unless named):
- Every lost layout of the verifier's runs (`bwf-final-20260925`: the 49 layouts of `fonts-losses.txt`, the 46 rows of
  `lab-lost.ndjson` and the cut probe's 4; 44, 44 and 4 lab cases, of which 8 are in two lists), 84 lab cases at DPR 1,
  2 and 3 (`cases/`), recorded against fresh natives
  with the no-facts predictor and replayed offline on this tree (`replay-case.ts`, the lab's scorer): all 84 are covered
  by a named gap, 66 by one of the four conditions above; of the 18 others 10 are Zapfino's (41 of the 84 are Zapfino's;
  3 of the 10 under 24px), 4 the wide soft hyphens under `float32-precision`, and 4 Hoefler Text's kern before a space
  and Euphemia UCAS's lone space at 222px, where widths differ before the decision and `unsafe-to-break` (pair
  placement without a `pairKerning` fact) covers them. On the tree before (`3189fe1`) the scorer
  had called 82 covered, mostly by gaps that don't name the traced cause, and 2 open: the verifier's Euphemia UCAS attack
  at 32px under -6px of word spacing and Helvetica Neue's short paragraph at DPR 3. The replays ask no question the
  recordings lack, and their lines equal the recorded ones.
- Where the conditions fire, offline on the tier references frozen at `93c4a53` (`tierfire/final/`): without facts in
  3,396 of 69,224 cases (4.9%): `one-unit-fit` in 2,407 cases and 2,690 of 247,575 lines, `stand-in-start-reach` in 869
  and 1,075, `common-window-side` in 208 and 424, `white-space-window-side` in none, most of them in the rule families,
  whose widths are derived from the native lines so that lines fit exactly; with the lab's facts in 3,949 cases (5.7%;
  2,407, 663 and 923). On the real-text attack's 59 sets (751,327 layouts and 4,661,189 lines at DPR 1, 1.5, 2, 2.625
  and 3, in pinned Chrome without facts): in 10,171 layouts (1.4%), `one-unit-fit` in 1,270 layouts and 2,014 lines,
  `stand-in-start-reach` in 5,750 and 7,573, `common-window-side` in 6,337 and 14,227, `white-space-window-side` in none;
  the attack's hole and CJK suite sets (`holes2`, `holes3`, `cjk-suite`) hold most of the last two (3,510 and 4,452
  layouts).
- Plain lines don't move: the plain predictor's line ranges at `93c4a53` equal `3189fe1`'s on all 69,224 tier cases in
  both configurations in pinned Chrome (`gates/compare-plain-3189fe1-93c4a53-*`, natives the same too), and on every
  real-text layout (the tree the runs used, the round's first form `2f69a4f`, differs from `93c4a53` only in where an
  inspected gap reports); the inspected paragraph gives the plain one's lines in every real-text layout, and offline in
  all 157,374 layouts of the words attack on its nine stand-in Canvases (`offline/`).
- Tier 2, recorded at `93c4a53` in both orders in both configurations (`gates/rec-d`): 75 status transitions without
  facts and 51 with them against the references of `3189fe1`, every one a failing case covered before that takes one
  more gap (`in-word-prefix`, `glyph-clusters` or `script-context`); none blocking, and the exact-value and limited
  tallies are unchanged (302 and 807 differing predicted values, 240,604 and 164,353 limited); the gates' seeds lose 0.
  The plain predictor's line ranges equal the usual run's in every case without facts, and differ in the same 115 with
  them as before. Packed with all 69,224 cases replaying exactly (91,406,583 and 95,474,575 recorded calls) and frozen at
  `93c4a53` in the shared `.artifacts/tests/reference/chrome-{no-facts,facts}.blink-words-first`; the references they
  replace are kept beside them as `*.pre-gaps`. The painter's frozen side is bundled at `93c4a53`. The first recording
  (`2f69a4f`) was the one that showed the ranges over the line wrong; a run of the final form that a machine crash cut
  off is not used.
- The Blink gates (`tests/gates.ts --engine=blink --fresh`, 19 gates, on the frozen tree): every one exits 0 but the
  citation ledger, whose 16 lost citations are the ones it lost before these rounds; tier 1 shows every case the same
  with no question changed, 1,268 unit tests pass.

2026-09-24, Blink's words-first loss round (branch `blink-words-first`, unmerged; [DESIGN.md §4.4, §4.6](DESIGN.md)):
every loss the verifier's fonts and bidi attacks found against the rebuild line (`61c376d`) in installed fonts, and the
ones the round's own fonts runs found, traced against Chrome's own positions in the window probe and fixed at the cause
where Canvas shows it. The library is `3189fe1`'s. The case set is every lost layout of the fonts runs with neighbours
at nearby widths, sizes and spacing values, 3,727 lab cases, the fix round's 927 gains with their LayoutUnit neighbours,
5,880 cases, and the bidi attack's 5 losses with neighbours, 90 cases
(`.artifacts/tests/runs/bwf-loss-20260924/cases*`). What changed, a commit a cause:
- SHY is U+2060 in every Canvas string, alone or beside a space (`e0d827f`, `blink/measure/ignorables-as-word-joiner`):
  an 8-bit paragraph had left SHY out of a string without a space and written U+2060 in one with a space, so a window
  and its sides were written two ways, and 16px Helvetica Neue at DPR 2 under -3px of word spacing took the line start
  after `, cof`+SHY+`fee` as unsafe from a 6,291-unit adjustment only the writing made. Over 399 installed families, the
  2,356 words whose width SHY changes measure the DOM's width with U+2060 and none with SHY left out. Such paragraphs'
  groups are cut into words now.
- Canvas shapes a group's string in the group's direction, and letter spacing is corrected once a glyph cluster
  (`6705683`, `blink/measure/canvas-string-in-group-direction`, `blink/measure/letter-spacing-cursive-adjust`): Canvas
  cuts a string into ICU's level runs and shapes each in its own direction, where the DOM shapes a group in the
  group's; a 16-bit string that may hold a level of the other direction goes inside U+202D or U+202E and U+202C, which
  Canvas turns into U+200B. The five bidi repros (Baghdad, Al Nile, Farah and Noto Nastaliq Urdu under letter spacing)
  give Chrome's lines at DPR 1, 2 and 3.
- A stretch without a script of its own is measured with the letter after it (`4f56618`,
  `blink/measure/prefix-without-script-in-context`, the window rule of `blink/measure/words-first`): ` , ` and ` :`
  between Devanagari words measure 2.6 zoomed px off their run alone in Didot and 4.8 in italic Gill Sans, and the
  run's with a letter beside them.
- Near totals (`a7a68dd`): a total below 256 zoomed px whose Canvas answers were each below twice that is a piece;
  cutting every such range met the search's own stand-ins (163 of the verifier's lost breaks, at Euphemia UCAS's lone
  space).
- Canvas's rounding is bounded, and past it the range being cut holds context (`3fa1a19`, `6c167f6`, `3189fe1`,
  `blink/measure/exact-canvas-answers`, `blink/shape/wide-group-halved`): an answer of 256 zoomed px or more is off by at
  most half a float32 step for each run Canvas converts and each sum; an adjustment a window shows within that is none
  (a window side `4f56618` carried over eight family emoji to the letter after them had rounded its way into 237 lost
  layouts in 33 faces in the round's first fonts runs), and past it an adjustment is real however wide the window, so
  the range being cut is held against its two sides where the exact window shows none. Zapfino's `the` after a space and
  Helvetica Neue's `ffl` across a SHY reach past the exact windows; where the range shows context at every offset (a
  ligature over a whole word) the first offset the exact windows passed is the cut, as before. Not in a face whose space
  takes its script (Euphemia UCAS), where a side without a letter measures its spaces wide; and a position at a cut
  takes what the exact windows show, which a plain paragraph keeps there, so the inspected paragraph reads the same.
What is left against the base in the final fonts runs (32 breaks and 28 line counts of 10,532 and 2,780 gained), each
traced in the window probe, and why Canvas can't show it (DESIGN.md §4.6):
- Zapfino's `THE then` at 16px (classic DPR 2 and spacing DPR 2, 1 layout each; both trees lose it in turn at other
  widths): words first gives Chrome's positions, and Chrome reshapes the line's end because HarfBuzz takes the offset
  after `THE ` as unsafe to break from the state of Zapfino's `morx` machine, which changes no advance.
- Hoefler Text's kern between a letter and the space after it (`chat` under -1px of word spacing at DPR 2,
  `kern-across-space` under 1px of letter and -2px of word spacing at DPR 3): HarfBuzz's kern machine puts half of it on
  each glyph (hb-kern.hh:102-106) and the port all of it on the first where the declaration gives no `pairKerning`
  fact, so the position before the space is 77 LayoutUnits off in both trees, and the base's line matched at one width.
- Euphemia UCAS, 18 breaks and 10 line counts at DPR 3 (and 78 and 63 gained): the lone space again, where an exact
  window's side is white space alone; letting every side reach a letter moves the face's lines both ways (172 lost and
  319 gained at DPR 3).
- One width each where a LayoutUnit decides and both trees' positions agree with Chrome's within one: Arabic in
  Hiragino Mincho ProN's fallback under four spacing styles at DPR 3 (the line end the port takes fits by one LayoutUnit
  where Chrome's doesn't; the base retries the line with 63 LayoutUnits less), Apple SD Gothic Neo's `neutral-words`
  under -0.5px of word spacing at DPR 3 (the base takes the line start as unsafe to break and fills one LayoutUnit
  less), and Helvetica Neue's short `p. 12, baf`+SHY+`fled by` at DPR 3 (the line start after the hyphen is reshaped to
  another offset).
- Skia's `hindi-neutral` under 1px of letter and -2px of word spacing at 28px and DPR 3 (3 widths): the range's side
  ` 2026` alone is Common where the paragraph shapes it as Devanagari, and its veto moves the cut into `श्री`; leaving the
  range out where a side is Common gives Chrome's lines there and loses Skia's 2px of word spacing at DPR 2.
The evidence, in pinned Chrome 153 unless named (runs under `.artifacts/tests/runs/bwf-loss-20260924`):
- The fonts attack (`tools/bwf-fonts-probe.ts`) against the base, scored by Chrome where the two trees differ, on the
  final tree:

  | Run | Layouts | Differ | Breaks lost / gained | Counts lost / gained |
  |---|---:|---:|---:|---:|
  | classic, DPR 2 | 8,055,520 | 29,418 | 1 / 2,529 | 0 / 887 |
  | classic, DPR 3 | 8,056,513 | 38,342 | 1 / 3,820 | 4 / 849 |
  | spacing, DPR 2 | 3,520,508 | 14,867 | 2 / 1,696 | 3 / 333 |
  | spacing, DPR 3 | 3,521,756 | 21,415 | 28 / 2,487 | 21 / 711 |

  The verifier's runs of the fix round's tip had lost 399 breaks and 87 line counts in classic DPR 3 and spacing DPR 2
  and 3 and gained 697 and 135. The inspected paragraph and the plain one give the same lines in every layout.
- The round's lab sets against Chrome's own rows, the final tree against the base: the losses with their neighbours lose
  1 line count and 22 breaks at DPR 1 and gain 21 (the `THE then` widths and 1 of Mishafi's), and gain 7 and 111 against
  11 breaks lost at DPR 2 and 75 and 234 against 8 at DPR 3, where `a7a68dd` had lost 59 and 212 there; the fix round's
  gains keep every gain (DPR 1 +34 and +267, DPR 2 +88 and +647, DPR 3 +92 and +614; the 2 and 1 breaks lost at DPR 1
  and 2 are the fix round's); the bidi repros gain 16, 17 and 17 breaks at DPR 1, 2 and 3. The inspected predictor gives
  the plain one's lines in every case.
- The verifier's bidi attack (4,350 lab cases a ratio): no case lost; line counts +32, +28 and +29 and breaks +68, +70
  and +72 at DPR 1, 2 and 3.
- The cut probe over 318 families against the base: 7,846 of 785,626 layouts differ at DPR 1, 17,888 of 770,211 at DPR
  2 and 24,844 of 728,356 at DPR 3, nearly all in `shy-nbsp` (SHY as U+2060), a few in `accents`, `ligatures`,
  `unbroken` and `arabic`. Their lab cases (36,760, 87,120 and 59,598) gain 504, 1,122 and 1,315 line counts and 591,
  4,225 and 5,694 breaks, and lose no line count and 1, 2 and 1 breaks: at a soft hyphen where the line and its hyphen
  fit by one LayoutUnit, the port's positions are now Chrome's (the base's were 61 and 1,614 LayoutUnits short in the
  two traced) and the hyphen's width decides, the `hyphen-glyph` gap.
- The real-text attack's 58 sets against the verifier's fresh natives (746,527 layouts at DPR 1, 1.5, 2, 2.625 and 3):
  none lost against the base, 5 line counts and 21 breaks gained (Noto Nastaliq Urdu at DPR 3, the script sets); the
  inspected predictor gives the plain one's lines in every layout; the plain predictor asks Canvas 9.9% less than the
  base's (from 21% less in `body` to 10% more in `nastaliq-dpr1.5`).
- Offline, `tools/words-attack.ts` over the owner's 11,973 seeded paragraphs and the constructed cases (17,486 layouts a
  Canvas): the inspected paragraph gives the plain one's lines on every stand-in Canvas, and the walk and the search
  differ only where `positions-run-backwards` says so (145 on `backwards`, 6 on `script-space`); against the fix round's
  tip the lines differ in 133 layouts on `usual` at DPR 1, 2 and 3, the bidi runs under letter spacing.
- Tier 2, recorded at `3189fe1` in both orders in both configurations: 92 status transitions against the references of
  `fcc04a8` in each, none from a pass or an exact case: soft-hyphen cases that failed pass, 2 failing ones take one more
  gap, and the exact-value tallies fall (316 to 302 and 839 to 807 differing values); the gates' seeds lose 0. The
  plain predictor's line ranges equal the usual run's in every case without facts, and differ in the same 115 cases as
  before with them, where the lab's facts move them. Packed with all 69,224 cases replaying exactly (90,948,519 and
  94,270,675 recorded calls) and frozen at `3189fe1` in the shared
  `.artifacts/tests/reference/chrome-{no-facts,facts}.blink-words-first`; the references they replace are kept beside
  them as `*.pre-loss-round`. The painter's frozen side is bundled at `3189fe1`.
- The Blink gates (`tests/gates.ts --engine=blink --fresh`, 19 gates): every one exits 0 but the citation ledger, whose
  16 lost citations are the ones it lost before this round.

2026-09-24, Blink's words-first fix round (branch `blink-words-first`, unmerged; [DESIGN.md §4.4, §4.6](DESIGN.md)): the
constructed attack's three must-changes, the fonts and real-text attacks finished and scored against pinned Chrome, and
what they found fixed or traced. The library is `51df826`'s, recorded at `fcc04a8`. What changed:
- A total is exact where Canvas's own answers were below 256 zoomed px before the port adds spacing (`5853544`,
  `measureTotal16`, in the cut search and in words first alike): under -2px of word spacing the port had taken a rounded
  answer that the spacing brought below 256 for exact. The attack's repros, 16px STIX Two Text at 141.3203125px and 16px
  Kailasa at 44.8125px at DPR 2, now give Chrome's 3 and 4 lines, where words first gave 2 and 5 (the base passed them,
  and lost other cases to the same defect).
- The premises are bounded where installed faces break them, so the recipe they replace runs there (README "Core"):
  - words first runs only below a zoomed font size of 60 px, counting what the letter spacing of 7 characters and the
    word spacing of 2 spaces add at 4.07 em (`48527d8`, `c61e13e`), since Zapfino's two short words stop fitting the
    word test below 256 zoomed px from 64 on;
  - it is off in a face whose space takes another advance under Common than under Latin (`78cdd8b`, Euphemia UCAS, the
    one of 393 families);
  - it is off in a group of which one shaping call holds a mark and a letter HarfBuzz recomposes only in such a call
    (`51df826`, 283 code points generated from ICU's data): HarfBuzz runs its recompose round over a whole call once the
    call holds a mark, and italic Athelas, which lacks `ở` and has `ỏ`, drops a kern after a `café` spelled with U+0301
    that `phở` measured alone keeps;
  - the cut predictor takes a window only where the one before it is 256 zoomed px plus the zoomed font size or more,
    and is off under letter spacing, negative word spacing and in Euphemia UCAS (`78cdd8b`): in the calligraphic Arabic
    faces a window measures up to 117 zoomed px wider than the string around it, and Diwan Thuluth lost 11 line counts
    at 384 zoomed px.
- The window rule's side after the offset alone takes the next piece in, and only in a group cut into words (`e290875`,
  `48527d8`), since the side before cancels against the prefix (Gill Sans counted a pair twice).
- Canvas resolves the scripts of each bidi level run of a string apart, as plain_text_node.cc does (`afcd1b0`), so the
  space and `[2]` after Arabic-Indic digits take the letter spacing Canvas gives them, which every tree had missed.

Per premise, on the final tree: *no shaping context reaches more than one word past a space* is bounded three ways
(above), and the losses the attacks leave trace to other causes (below), though an inspected paragraph reports
`context-past-a-word` in each, where the words' reading and the cut search's part; *positions inside a word stay sorted*
holds in every face the attacks tried; *a string is narrower than a window inside it by less than the zoomed font size*
holds over 393 families at 16, 48 and 96px (0.71 of it at most, Noto Nastaliq Urdu at 96px), and the display sizes where
the calligraphic faces break it take the loop's window by construction.
What the attacks leave, each traced against Chrome's own positions (DESIGN.md §4.6): between Devanagari words in italic
Gill Sans and Athelas Chrome's ` , ` is 5.6 zoomed px wider than either tree measures it; in Zapfino's `THE then` and in
16px Mishafi at DPR 1 under -2px of word spacing the port takes an offset as safe to break where Chrome reshapes, and in
800 Chalkboard SE's pointed Hebrew it takes a line start as unsafe where Chrome doesn't, from a window between the
words' cuts that runs to the next word's space; in PT Sans Narrow's Hebrew under 1.5px of letter spacing at DPR 3 both
trees miss Chrome's ` . `; the same Devanagari text in Didot under spacing at DPR 3 and Arabic in Hiragino Mincho ProN
and Thonburi under -1px of letter spacing lose 9 breaks, not traced apart. Under negative word spacing the exactness fix
cuts groups finer than the base, whose totals the spacing made look exact, and the finer cuts meet the cut search's own
stand-ins: in Euphemia UCAS a cut the search falls back to beside a space takes the lone space's Common advance, and in
a paragraph without segments a window side without a space leaves its soft hyphens out where the whole window carries
U+2060 (`soft-hyphen-shaping`), which 16px Helvetica Neue at DPR 2 shapes otherwise: the side `cof`+SHY+`fee` measures
6,291 units off its window at the line start after `, `, so the start is taken as unsafe to break and the line no longer
fits. Three candidates for those are kept on local branches, not adopted (`bwf-fix-alt-vz2`, `-vz3`, `-vz5`, DESIGN.md
§4.6). The evidence, in pinned Chrome 153 at DPR 2 unless named (runs under `.artifacts/tests/runs/bwf-fix-20260923`,
the final tree's in `final2/`):
- Tier 2, recorded at `fcc04a8` in both orders in both configurations: 0 status transitions against the references of
  `c61e13e`, the exact-value tallies unchanged (316 and 839 differing values), the gates' seeds lost 0 and gained 0, so
  they stay. The plain predictor's line ranges equal the usual run's on every case without facts, and differ in the 115
  cases the lab's facts move with them. Tier 1 at `51df826` against `c61e13e`'s references had shown 0 predictions
  changed and 14 cases asking a question the record lacks (Myanmar groups the bound hands to the cut search). The
  recordings pack with all 69,224 cases replaying exactly, 90,226,558 and 93,565,521 recorded questions, and are frozen
  at `fcc04a8` in the shared `.artifacts/tests/reference/chrome-{no-facts,facts}.blink-words-first`, which this branch's
  `.artifacts` links as its Chrome references; the shared `chrome-*` folders stay the rebuild line's (`1e772c6`) until
  the branch merges, when they are renamed `*.pre-words-first` and these take their place. The painter's frozen side is
  bundled at `fcc04a8` in this worktree's `.artifacts/tests/painter-frozen`, and whoever merges bundles it again there.
- The constructed attack's 11,386 lab cases against Chrome's own rows (the bound engages in none of them, so `c61e13e`'s
  run stands): line counts 11,048 to 11,103 and breaks 10,611 to 10,749 at DPR 2, 11,028 to 11,089 and 10,711 to 10,841
  at DPR 1, 11,031 to 11,055 and 10,581 to 10,637 at DPR 3, no pass lost at any ratio; the gains are the letter spacing
  after Arabic-Indic digits and negative word spacing.
- The cut probe over 318 families against the base (`90e0266`): at DPR 2, 61 of 761,560 layouts differ, all Zapfino, as
  words first's did, and their lab cases gain 2 line counts and 13 breaks and lose none; at DPR 1 0 of 765,246 and at
  DPR 3 0 of 724,264. Against `c61e13e` and words first (`96da4af`) at DPR 2, 0 layouts and positions differ; the cuts
  differ in `accents`, whose group the bound hands to the cut search.
- The fonts attack (`tools/bwf-fonts-probe.ts`) against the base, scored by Chrome where the two trees differ: 175.4 M
  layouts over the 393 installed families (all of them at DPR 1, 2 and 3 in the classic runs, and in 18 weights and
  styles at DPR 2; the 64 curated ones in 18 variants at DPR 1 and 3 and under 16 spacing styles at DPR 2 and 3; the 34
  joining ones at display sizes). The runs made before the recompose bound count without `accents`, the only text it
  engages in, which ran again on the final tree (in italic Athelas at DPR 2 it had lost 18 breaks and gained 21; now it
  lays out as the base does). Breaks lost 419 and gained 1,455, line counts lost 89 and gained 257:

  | Run | Layouts | Differ | Breaks lost / gained | Counts lost / gained |
  |---|---:|---:|---:|---:|
  | classic, DPR 1 | 8,059,735 | 359 | 2 / 75 | 1 / 11 |
  | classic, DPR 2 | 8,055,521 | 869 | 1 / 133 | 0 / 19 |
  | classic, DPR 3 | 8,056,502 | 1,380 | 28 / 162 | 9 / 22 |
  | joining, DPR 2 and 3 | 936,866 | 0 | 0 / 0 | 0 / 0 |
  | spacing, DPR 2 | 3,520,503 | 3,488 | 101 / 290 | 7 / 41 |
  | spacing, DPR 3 | 3,521,748 | 3,803 | 270 / 245 | 71 / 73 |
  | 18 variants, DPR 2 (three thirds) | 104,210,230 | 3,773 | 11 / 322 | 1 / 87 |
  | 18 variants, curated, DPR 3 | 19,532,318 | 770 | 0 / 54 | 0 / 0 |
  | 18 variants, curated, DPR 1 | 19,538,093 | 1,074 | 6 / 174 | 0 / 4 |

  Of the lost breaks, 387 are under negative word spacing, where the exactness fix cuts finer: soft hyphens in
  `shy-nbsp` 178, Euphemia UCAS 163, Zapfino 38, others 8; so are 88 of the 89 lost line counts. The rest: Zapfino's
  `THE then` 12; Devanagari between words in italic Gill Sans and Athelas 7, and in Didot under spacing 7; PT Sans Narrow's
  Hebrew under letter spacing 3; Arabic in Hiragino Mincho ProN and Thonburi under -1px of letter spacing 2, not traced;
  the Chalkboard SE line start 1. The inspected paragraph and the plain one give the same lines in every layout.
- The attacks' 5,703 lab cases (the constructed attack's verdicts, the fonts attack's losses and the owner's Hebrew,
  sum and Zapfino sets) against the base's native rows: line counts lost 1 and gained 95, breaks lost 13 and gained 347;
  the bound took back 18 breaks italic Athelas had lost and gave up 9 that the cut search misses under
  `float32-precision` and `unsafe-to-break`. The scorer counts every loss left as covered: each fires
  `context-past-a-word` with `unsafe-to-break`, `script-context`, `in-word-prefix` or `glyph-clusters` at the first unit
  that differs.
- The real-text attack's 59 sets against Chrome's own rows, 751,327 layouts at DPR 1, 1.5, 2, 2.625 and 3: the 20 sets
  whose paragraphs can hold a mark and a recomposing letter (Myanmar `ဦ`, Vietnamese, books; 289,477 layouts) run again
  on the final tree, the others' at `c61e13e`. The base's line counts and visible breaks in every layout, none lost and
  none gained. The book survey on the final tree passes 72 of 72 texts (the main line 64).
- Offline, `tools/words-attack.ts` over the owner's 11,973 seeded paragraphs and the constructed cases (17,486 layouts a
  Canvas), where the bound engages in no case: the final tree against `c61e13e` gives the same lines on `usual` at DPR 1,
  2 and 3 and on `f32`, `backwards`, `far`, `across` and `script-space` at DPR 2; the walk and the search differ only
  where `positions-run-backwards` says so (148 on `backwards`, 6 on `script-space`). Against the base it differs in 121
  layouts on `usual`, all under letter spacing (the bidi runs, and the predictor's loop there), and 359 on `f32`, none
  with a premise's gap.
- Counted: under the stand-in Canvas, whose U+2028 takes the space's advance, a message of the bench's mix is prepared
  and filled at 320px with 150.8 questions and 636 UTF-16 units where words first asks 148.7 and 630 and the base 180.0
  and 1,981, a Latin one 127.3 and 527 (125.5 and 524; 159.5 and 1,870), a message of the bench's real text 161.6 and 658
  (159.6 and 653; 201.2 and 2,115), the eleven languages 215.0 and 823 (212.2 and 808; 268.9 and 1,927); the two more
  questions are the check of each style's space, and the bound adds a unit in the languages. In pinned Chrome
  (`tools/fill-counts-probe.ts`, 1,000 messages a set, from scratch at 320px) a mix message asks 148.2 calls and 608 units
  where words first asks 146.0 and 602 and the base 178.4 and 1,947, a Latin one 123.7 and 503 (121.8 and 501; 157.7 and
  1,869), and the bench's Chinese paragraph of 9,428 units 26,069 calls and 96,234 units (26,044 and 95,947; 29,397 and
  371,074).
- The full gates, all engines and fresh, at `caf1b91`: 38 of 39 exit 0, and the citation ledger exits 1 with 16 losses,
  all among the 17 `1e772c6` has (the new comment on HarfBuzz calls cites `harfbuzz_shaper.cc:1080-1101` again); 1,257
  unit tests pass, and the painter paints all 69,224 Chrome cases in both configurations.

2026-09-23, `rebuild-20260916` (`4512841`) merged into `blink-words-first`: the requirements audit's Gecko and WebKit
drops, main `b17a7ac` and Chrome's references recorded again at `1e772c6`. No Blink file and no shared file that builds
or measures Canvas strings changed since `90e0266`, so Chrome keeps words first's references, recorded at `2eb0edd`
(`96da4af`), and Firefox and webkit-host take `4f417c9`'s; the registry takes both sides' rules, and the painter's frozen
side is bundled again at the merge.

2026-09-23, Chrome's references recorded again at `1e772c6`. Since `ff0f584`, where they were frozen, Chrome's tier 1 had
shown 351 changed predictions without facts and 86 with them, 154 and 90 cases asking a Canvas question the record
lacked, and 30,397 and 30,726 asking their questions in another order. One change made all of it: since `8075758` Blink's
safe test asks the pair window before the wide window ([DESIGN.md](DESIGN.md), the cut of a group of 256 zoomed px or
more), so that a nonzero pair rules an offset out before the wide window is shaped. The test gives the same answer
either way, but a rejected offset now measures other strings, and an inspected paragraph raises the gaps of what it
measures. Every changed prediction is in a gap list, in a case that passes all four metrics and is exact: 259 and 37
hold the same `script-context` entries in another order, 92 and 49 hold them over other offsets (2 of them in a line's
list too), and nothing else in a prediction moved; the new questions are pair windows the old order never reached.
With the old order put back at `1e772c6`, tier 1 gives back every frozen prediction and question but repeats (25,865 and
25,864 cases repeats only), so nothing else moved since `ff0f584`. `8075758`'s own notes ([GENERAL_COST.md](GENERAL_COST.md))
call the gap changes intended; the references just weren't recorded again, and the painter differential couldn't paint
those 505 and 176 cases. Recorded now from a clean checkout of `1e772c6`, both orders and both configurations: 0 status
transitions and 0 exact-value changes against `ff0f584`'s ledgers (the ledgers' entries are byte for byte the same), the
tier 2 gates lose 0 pairs and gain 0, so the adopted seeds stay, and every one of the 69,224 cases replays exactly. The
plain predictor's line ranges equal the usual run's on every case without facts; it takes no facts, so beside the facts
run it differs in 115 cases whose lines the lab's facts move, as in the words-first recordings. The lab README's rule for
a change to the safe test hadn't been run for this one: the fonts probe, the old order against the new in pinned Chrome,
finds 0 cuts, positions and layouts differing in 318 installed families, at ratio 2 (170,102 cuts, 644,318 layouts) and
at ratio 1 (78,799 cuts, 507,040 layouts). What the order buys is small: over the tier's cases Chrome asks 50,859,752
questions where the old order asks 50,915,739 without facts, and 53,308,502 where it asks 53,363,379 with them (0.1%).
Chrome's tier 1 exits 0 again. The full gates (all engines, fresh) pass but for the citation ledger, and the painter
differential paints all 69,224 Chrome cases in both configurations. The ledger's 17 lost citations are `1e772c6`'s own:
the general-cost and plaintext rounds of 2026-09-21 and 09-22 dropped them from code comments (2 at `8075758`, 3 at `09dc717`, 8 at `0385720`, 4 at `a6ae4c6`), and
putting them back edits files under the string storage rule, which sends Chrome's cases to tier 2, so that is a step of
its own.

2026-09-23, main merged at `b17a7ac`: #337 (the Safari 27 harness) and #338 (a count-only `layout()` walker). `src/`
and every other file main owns take main's versions, so outside `rebuild/` the branch equals main but for two things:
`knip.config.ts` keeps its `project` line, without which `bun run check` reports 338 unused files under `rebuild/`, and
`TODO.md` and `ENGINE_FOLLOWUPS.md` keep a line pointing here. #338 is the simpler form of the counter `62e7ec9` put in
this branch's copy of `src/line-break.ts`; that copy, 62e7ec9's snapshot refreshes and its edits to main's harness and
docs gave way to main's, which carry main's own Safari 27 decisions (its keep-all case requires nothing). Under
`rebuild/` only these docs changed. `bun run check` and main's 273 tests pass. The quick gates (all engines, fresh) give
82ddc78's results gate for gate: the six projects type-check, 1,235 unit tests pass, tier 1 is unchanged in Firefox and
webkit-host and keeps Chrome's open 351 / 86 changed predictions (no facts / facts), and the plain and pure checks pass.
`lab/baselines/main-predictor.ts` reads `walkLineRanges()`, which #338 left as it was, and nothing freezes its output:
the lab's main baseline ([lab/BASELINE-main.md](lab/BASELINE-main.md)) is a dated record of 2e5e2bd, and the main
obligations come from sealed main runs. Only the book survey's main role reads `layout()`'s count. Under the stand-in
Canvas the counts and heights of 2e5e2bd, 62e7ec9 and #338 are the same on all 72 book cases at their two widths and 42
more, in each engine's profile (3,096 layouts an engine, 68 of the 72 cases on the new walker), and each equals the
lines its own `walkLineRanges()` walks. In #338's own validation the corpus sweeps, each book whole at every 10 px step,
moved in none of the three browsers, so the book survey was not run again in a browser.

2026-09-23, the Firefox and webkit-host references recorded again after the requirements audit's drops as narrowed, both
orders and both configurations, from 4f417c9 (kept on branch `audit-drops-narrowed-rec`), whose library equals this
branch's. Against 90e0266's references there is no status transition in either browser or configuration, widths
included, the exact values are the same, and tier 2's gates lose nothing. Every recorded case replays exactly, and the
plain predictor's line ranges equal the inspected ones in webkit-host on every case, and in Firefox on all but 21 cases
whose own native lines moved between the two runs too (history-dependent), as at the word scan's merge.

2026-09-23, WebKit doesn't ask whether a font list resolves where the list names `serif`, `sans-serif`, `monospace` or
`system-ui` ([DESIGN.md §4.4](DESIGN.md), "Taken out for speed";
`webkit/content/list-probe-skipped-for-a-resolving-generic`). Under a Han, kana or Hangul locale each box asked two
questions to learn whether any listed family resolves and, where none did, named the locale's standard family for
Canvas. The audit's W1a dropped the probe on the premise that every page's list ends in a generic family; lists written
for Windows (`Meiryo`, `"Malgun Gothic"`, `"Microsoft YaHei"` alone) don't, and moved lines without it. A list that
names one of those four always resolves on macOS 27 (probe land-w1a: 168 of 168 lists under 14 Han, kana and Hangul
locales), so only such a list skips the probe; an inspected paragraph asks it all the same and reports `canvas-language`
where it resolves nothing. In webkit-host a real paragraph asks 88.0 questions where it asked 88.7 (CJK 109.0 where
111.0); chat messages, set in English, ask what they asked. No line moved in any set, the tier corpus (63,729 cases)
included.

2026-09-23, Gecko doesn't look for a group that required shaping forms at a break opportunity a unit holds of itself
([DESIGN.md §4.4](DESIGN.md), "Taken out for speed"; `gecko/measure/no-group-at-ordinary-breaks`), on the premise of the
ligature test's entry below: no such group spans one. The audit's G3 took the premise at every break opportunity inside
a unit, and under `word-break: break-all` it breaks inside Geeza Pro's lam ligatures on real Arabic, Persian and Hindi
text; under `break-all` and `line-break: anywhere` the groups are looked for as before. An inspected paragraph asks the
count there and reports `in-word-prefix` where a group spans the offset. In pinned Firefox a chat message asks 36.3
questions where it asked 37.3 (222 characters where 231), a real paragraph 99.6 where 112.8 (858 where 960; CJK 114.5
where 144.5). No line moved in any set, the reviews' included, nor in the tier corpus, where the audit's form lost 3
(Geeza Pro under `break-all`).

2026-09-23, Gecko doesn't test for an optional ligature at a break opportunity a unit holds of itself ([DESIGN.md
§4.4](DESIGN.md), "Taken out for speed"; `gecko/measure/no-optional-ligature-at-ordinary-breaks`): between Han
characters, after a hyphen, at a dictionary break, but not where a line breaks a word inside itself, which includes
every boundary under `word-break: break-all` and `line-break: anywhere`. The audit's G2 dropped the ligature test
everywhere; two reviews found real text that moves without it, all lines broken inside a word between a ligature's
letters (Latin under `break-all`, a long German word at 100px, soft hyphens, URLs under `overflow-wrap`), so the test
stays there, and goes where most of its questions were, on the premise that no optional ligature spans such a break
opportunity. An inspected paragraph asks the test there and reports `in-word-prefix`, so its lines are the plain ones.
In pinned Firefox a chat message asks 37.3 questions where it asked 47.3 (231 characters where 251), a real paragraph
112.8 where 183.0 (960 where 1,118; CJK 144.5 where 285.1). No line moved in the chat messages, real paragraphs, width
sweep and books, nor in the reviews' sets, the ones where the audit's form moved lines included, nor in the tier corpus
(63,516 cases), where the audit's form lost 13.

2026-09-23, a plain Gecko paragraph measures what crosses an in-word offset only where the pair placement can use it
([DESIGN.md §4.4](DESIGN.md), "Taken out for speed"; `gecko/measure/crossing-measured-where-placed`), the first of the
requirements audit's drops (research/REQUIREMENTS-AUDIT.md on branch `audit-requirements`). The audit's candidate G1b +
G4 was to ask the crossing measure and the pair placement only for a word broken inside itself. After the word scan that
is nearly what the plain path did already; what it still asked was mostly between Han characters and in Thai, Khmer and
Burmese, where no placement can use the answer and the advance is the unit less its suffix. Those questions now go to
inspection alone, and both paths give the same advance, so no line can move and inspected output is unchanged. In pinned
Firefox 156 a chat message asks 47.3 questions where it asked 54.1 (251 characters where 265), a real paragraph 183.0
where 252.4 (1,118 where 1,338; CJK 285.1 where 376.3). No line moved anywhere, the adversarial corpus and both reviews'
sets included; the knockout's 39 losses, which dropped both everywhere, don't occur.

2026-09-23, Blink's cut predictor (branch `blink-words-first`, on words first; [DESIGN.md §4.4, §4.6](DESIGN.md)): the
shrink of the wide window no longer measures every window only to learn that it is still 256 zoomed px or more. A plain
paragraph predicts the window it takes from the widest window's total, measures the window before it and that one, and
hands down totals the cuts already give (a group's one piece, the pieces between two cuts, a half's share of the range
cut in two). It takes the loop's windows on a premise about fonts, that a string is never narrower than a window inside
it, documented as a default with the named gap `nested-window-wider`, which an inspected paragraph reports where its
loop and the prediction take other windows. An inspected paragraph hands on what the prediction measured and leaves the
same halves unmeasured, so it asks every question a plain one asks: a first recording in which it measured them found 31
cases without facts and 30 with them where the plain path asked a question the record lacked, all halves of emoji words
at 80px or of Myanmar text whose share by length was far above what they measure. Under the stand-in Canvas a message of
the bench's mix is prepared and filled at 320px with 154.4 questions and 659 UTF-16 units where words first asks 157.1
and 780, of its real set 167.4 and 694 where 175.1 and 747, of the eleven languages 218.1 and 834 where 273.2 and 1,210;
plain ASCII 132.4 and 560 where 132.2 and 560, and the later widths within 0.3 of a question. The evidence, in pinned
Chrome 153 at DPR 2 unless
named (runs under `.artifacts/tests/runs/blink-words-first-20260923/c3`; the cut probe and the counts in `c2`,
`counts` and `fill-counts` read the plain path, which the inspected path's fix left as it was):
- Tier 2, recorded in both orders in both configurations: 0 status transitions against the references it replaces on
  all 69,224 cases, the exact-value tallies unchanged (316 and 839 differing values), the gates' seeds lost 0 and gained
  0. The plain predictor's line ranges equal the usual run's on every case without facts. The recordings pack with every
  case replaying exactly and are frozen at 2eb0edd: an inspected paragraph asks 45,051 and 45,028 more recorded
  questions than words first's (90.1 M and 93.4 M), the windows its walk of the prediction measures where the shrink
  didn't.
- The certified fast workflow and the real-text supplement: 999 of 1,000 (the same failure) and 64 of 64.
- The cut probe against words first over 318 families: 0 cuts, positions and layouts differ, of 769,917 layouts at
  DPR 2 and 784,173 at DPR 1.
- Offline, `tools/words-attack.ts` against words first over the 11,973 seeded paragraphs: no layout differs on `usual`
  at DPR 1, 2 and 3, on `fine` at the lines' own widths, or on `across`, `far` and `backwards`; on `backwards` 4
  inspected layouts report `nested-window-wider`, with words first's lines. Plain and inspected lines are equal in all.
- Counted in pinned Chrome (`tools/fill-counts-probe.ts`, 1,000 messages a set, from scratch at 320px): a message of the
  bench's mix asks 146.0 calls and 602 UTF-16 units where words first asks 148.8 and 722 (its Chinese messages 313.8 and
  1,164 where 349.4 and 2,539), a Latin one 121.8 and 501 where 121.6 and 500, and the bench's Chinese paragraph without
  spaces, 9,428 units in one shaping group, 26,044 and 95,947 where 29,397 and 371,074.

2026-09-23, Blink's words first (branch `blink-words-first`, unmerged; [DESIGN.md §4.4, §4.6](DESIGN.md)): a shaping
group is cut into words first, each measured once with its trailing space, and the offset between two words is a cut
where the two words together measure their sum and the pair window shows 0; a line that ends between two words finds
its candidate from the positions at the cuts. It is round 2's "V3" of the word study, ported onto 90e0266 by hand, with
three changes: a word without a character of a script of its own is no piece of its own; V3's rule that a window side
without a script of its own takes the next piece in is kept for sides Canvas shapes as Common and bounded to windows
below 256 zoomed px (V3's losses in Euphemia UCAS came from the script Blink gives each Canvas call, through word pieces
and, most of them, through that rule); and a position after characters every lookup skips at a cut takes the cut's
adjustment once (round 1's hole). It rests on two premises
about fonts, taken as documented defaults with named gaps: no shaping context reaches more than one word past a space
(`context-past-a-word`) and positions inside a word stay sorted (`positions-run-backwards`). An inspected paragraph cuts
every group by the cut search alone first, which asks what it asked before words, holds every read that depends on the
cuts against it and the walk against the search, and takes the words' values, so plain and inspected lines are the
same. The evidence, all in pinned Chrome 153 at DPR 2 unless named (runs under
`.artifacts/tests/runs/blink-words-first-20260923/c1`):
- Tier 2, recorded in both orders in both configurations: 0 status transitions against the reference of ff0f584 on all
  69,224 cases, the exact-value tallies unchanged (316 and 839 differing values), the gates' seeds lost 0 and gained 0,
  so they stay. The plain predictor's line ranges equal the usual run's on every case without facts. The recordings
  pack with every case replaying exactly and are frozen at 48de7f7; an inspected paragraph now asks 90.0 M recorded
  questions where it asked 51.0 M, since it cuts by the cut search and by words and holds every read against both.
- The certified fast workflow and the real-text supplement give the base's outcomes case for case: 999 of 1,000 (the
  same stable failure, `c-d0c13fd8c7aca939`) and 64 of 64.
- The cut probe over 318 families: at DPR 2, 61 of 769,917 layouts differ, all Zapfino; at DPR 1, 0 of 784,173. The
  Zapfino layouts as 1,932 lab cases: 13 breaks and 2 line counts go from fail to pass and none the other way.
- The second check's sum probe: the words are off Canvas's exact total in 0 of 679,661 short groups (V3: 2, Euphemia
  UCAS), and 983 of 1,534,771 long layouts differ from the base. Its differing layouts as 1,060 lab cases: breaks 887
  to 987 passes (120 gained, 20 lost), line counts 1,042 to 1,054 (17 and 5), widths 87 to 755. Of the 25 passes lost,
  18 are under negative word spacing, where the base's windows hold totals of 256 zoomed px or more once JS adds the
  spacing, each with `context-past-a-word` on the inspected paragraph; 6 are two Euphemia UCAS paragraphs, each at
  three widths a LayoutUnit apart, whose spaces Canvas measures alone as Common (DESIGN.md §4.6); 1 is Zapfino.
- The second check's own 1,171 lab cases, scored against their recorded native layouts: breaks 954 to 1,017, line
  counts 1,117 to 1,129, with 8 passes lost in four places; V3 had lost 44 breaks there, 41 in Euphemia UCAS.
- Offline, `tools/words-attack.ts` over 11,973 seeded paragraphs at four widths (47,892 layouts a Canvas): on `usual`
  at DPR 2 no layout differs from the base, at DPR 3 one case at four widths does, where the window rule moves a window
  under letter spacing, and on `fine` at the lines' own widths 0 of 80,206; plain and inspected lines are equal in all.
  Where the Canvas breaks a premise, every layout that differs from the base without the window rule reports its gap
  (context across a space 25, two words back 9,940, negative advances 666), and the window rule moves 197, 6 and 3
  more there without one.
- Under the stand-in Canvas (`tools/words-count.ts`, 1,000 messages a set) a chat message is prepared and filled at
  320px with 132.2 questions and 560 UTF-16 units where the base asks 179.5 and 1,941 (the bench's ASCII set), 157.1
  and 780 where 198.1 and 2,049 (its mix), 175.1 and 747 where 221.5 and 2,188 (its real set) and 273.2 and 1,210 where
  282.3 and 1,973 (eleven languages); a kept one at a new width with 27.6 and 113 where 60.5 and 264 (ASCII) and 37.2
  and 135 where 64.5 and 272 (mix).
- Counted in pinned Chrome (`tools/fill-counts-probe.ts`, 1,000 messages a set, from scratch at 320px): a message of the
  bench's mix asks 148.8 calls and 722 UTF-16 units where the base asks 178.4 and 1,947, a Latin one 121.6 and 500
  where 157.7 and 1,869; its Arabic messages ask more calls and fewer units (82.4 and 304 where 65.6 and 780), and the
  bench's Chinese paragraph without spaces asks what it asked.

2026-09-23, Gecko's word scan ([DESIGN.md §4.6](DESIGN.md)): a break scan is decided from the shaping units' advances
and passes over the break candidates inside a word whose end fits. It rests on a premise about fonts that the maintainer
accepted as a documented default with a named gap: no tail of a shaped word has a negative advance. No source gives it.
On the port's measurements every installed face at every instance CSS can ask for keeps it (1,229,216 recorded in-word
advances, 381,027 words in 321 families in pinned Firefox, about 2.7M more word and paragraph layouts in the attack of
2026-09-23). Skia at a variation corner and a made-up font break it, with the gap; Firefox breaks it in Mishafi and Diwan
Thuluth where the port can't see it, which was wrong before the word scan too (§4.6). Plain and inspected paragraphs take its lines; an
inspected one also runs the engine's loop, so it asks exactly what it asked, and reports `negative-word-tail` where the
two differ. Both Firefox tier 1 reports equal the base's but for the library's fingerprint, the 192 existing
question-order cases and the citation ledger's 17 existing losses included; plain, pure, sweep and painter pass in both
configurations; the plain path asks 25% fewer recorded questions. In pinned Firefox the certified fast workflow and the
real-text supplement give the base's outcomes case for case (955/1/44 and 64/64), and the plain predictor's tier 2 has
no transition, its 21 moved line ranges all on history-dependent cases whose native lines moved too. The two attacks
find no layout that differs from the loop's on fonts that keep the premise, and a gap on every one that differs where
the font breaks it. Timed in pinned Firefox 156 against the base in alternating runs (per 1,000 units): new Latin text
0.63 ms where 1.04 (main keeping its caches 0.41), new Arabic text 0.81 where 1.41 (0.50), CJK unchanged (4.85 against
4.94); first fills of that text at three new widths 0.17 where 0.49 and 0.10 where 0.93; repeated widths 0.057 where
0.103 (Latin) and 0.054 where 0.093 (Arabic), main 0.007.

2026-09-22, current [prepared plaintext round](PREPARED_LAYOUT_EXPERIMENT.md): the only runtime change is the public
simple count specialization; the redo core matches `0bdea4d`. Fair public-API pairs show ordinary repeated layout
about 31–70% faster across Chrome, Firefox and Safari, without preparation or retained-data changes. The bounded
ASCII preparation experiment supports Canvas-free layout on observed inputs, but does not cover the general
main-pass population. Preparation ownership and broader numeric representations come next; exact identity source
maps are deferred. Rich painting stays paused. All required snapshots are refreshed; 1,496 tests and the fresh three-browser
gates pass, with Safari 27’s single native-height obligation explicitly deferred and its failures retained. The
[round report](PREPARED_LAYOUT_EXPERIMENT.md) records the corrected fractional observer and exact validation; the dated rounds below retain their original evidence and stopping decisions.

2026-09-22, completed bounded [plaintext round 3](STATELESS_ROUND3.md): Blink reuses its immediate retry search and Gecko
reuses adjacent range endpoints, preserving existing measurements and arithmetic. Full/count/range ordered proofs,
1,223 tests and strict projects pass; maintained gates and fresh native outcome categories retain existing failures,
reviews and the documented four Firefox geometry/count/issue-list variations. The complete 108-document / 5,400-row
foreground matrix shows useful narrow Chrome and general Firefox repeat gains, no general preparation gain and mixed
new-width costs. Main's resize gap remains large. Temporary startup experiments are dropped after the user confirms
external focus interruptions and original startup diagnostics pass. Rich painting stays paused. Exact identity source
maps are the next bounded ownership experiment; remaining costs are open, not proved necessary.

2026-09-20, `rebuild-20260916`, from Claude's final `9369b7f`. The goal and routine commands are in
[README.md](README.md). This record replaces the previous phase queue. Main's published API/source remain unchanged.

2026-09-22, earlier completed closure: [plaintext round2](STATELESS_ROUND2.md) removes unused unsegmented Blink metadata,
stores a single-part shape view in one record and removes two demonstrated scan factors without changing Canvas recipes.
Final verification passes 1,215 tests and six strict projects; complete replay reports and fast native outcomes stay
unchanged. The same strict native failures/reviews remain; no rules or references are relaxed.

The complete 108-document / 5,400-row foreground matrix shows ordinary Chrome repeats about 11–15% faster and the
long narrow ASCII control about 2× faster. Preparation has no general gain; a frozen follow-up retains Latin cold
costs and mixed new-width results. Main remains substantially cheaper at resize, including zero-Canvas controls.
Next, measure remaining per-line scratch production, preserving one breaker and required rollback/trim facts.
Width-dependent measurement is separate research. Rich painting remains paused. The dated report links exact inputs,
complete audits and the persistent evidence/all-ref backup.

2026-09-21, earlier closure: the bounded [plaintext stateless round](STATELESS_ROUND.md) consumes Blink script data
into one exact primary model, walks fixed source boundaries, flattens its line cursor and adds ranges through each
engine's existing break algorithm. Plain Gecko omits unused frame/justification output. Canonical plain checks and
benchmark counts use ranges. Final verification passes 1,211 tests and six strict projects, complete-output/ordered
question proofs, and unchanged replay outcomes. Native strict failures remain Chrome 1, Firefox 1 plus 48 reviews,
and WebKit host 2. No acceptance rules or references were relaxed.

Native gains are mostly small; this is a structural reduction of repeated source work, not a large preparation win.
Chrome Latin repeats cost an additional 0.062ms per 120 messages across three widths; alternating setup/memory costs
and uncertain Firefox Latin new-width cost are retained explicitly. Fresh [main comparisons](MAIN_PERFORMANCE.md)
still show large resize gaps. Owned rendering and rich painting remain paused. The round stops with committed useful
simplifications and a concrete next experiment: remove unused unsegmented metadata, then simplify per-line primary
decision data. Measurement recipes and the full historical main-pass population remain unresolved.

Earlier closure, 2026-09-21 (before the plaintext round): testing infrastructure is sufficient for the current
iteration. Five [general-cost checkpoints](GENERAL_COST.md)
repair input-driven ordered access, Builder relocation, font/source interpretation, diagnostic scans and deep formatting
and geometry. Blink numeric conversion, saturation and physical fragment producers now follow their source operation
boundaries. The final closure passes 1,182 tests and six strict projects, preserves all replay-report fields except the
source fingerprint, and retains the known strict Native failures. The detailed closure and practical stopping frontier
are in that shorter record. Arbitrary supplied ligature grammar and contextual/counterfactual shaping retain costly cases; this is not a universal linear-cost claim.
The earlier cohort stopping decisions below remain historical evidence, rather than general worst-case conclusions.
Fresh foreground [main comparisons](MAIN_PERFORMANCE.md) still show substantial preparation and scalar-fill gaps. The
general input-growth audit is a bounded stopping point, not a claim that application performance is finished.

## Owned-rendering decision

The [fixed-word prototype](experiments/owned-rendering/README.md) is rejected as a general replacement before timing.
Narrow ordinary Latin and Arabic words overflow, valid rich style boundaries are rejected, and ordinary item chrome
is not yet supported. Existing fixed-fragment/bidi tests do not establish those capabilities. Full-paragraph bidi and
independent painting remain reusable research; a shared algorithm is not disproved by the prototype omissions.
Any next probe must establish required behavior before comparing separate preparation and resize costs to main.
Small concrete differences may earn their cost; broad restrictions and routine word overflow do not.

## Preservation

`codex/redo-handoff-backup-20260920` preserves the handed-over branch. A verified all-ref bundle preserves every
committed study, including unfinished attackers that found counterexamples. Its SHA256 is
`eafaf9101ff5bbec070ea4d911630d41925de29a39bad3ce79023a4b67648993`.
Before acceptance migration, 48 reference/ledger/pin/seed files were backed up in a metadata ZIP, SHA256
`25cc4dc2fffbe02adc3cfc046440aca259a48a09ade1fd3d72eac99c9d168721`.
Both live under `/Users/chenglou/.codex/visualizations/2026/09/20/01a0c12e-d771-7763-acab-9b673ed39827/redo-takeover-backup/`.
An interim uncommitted-source archive preserves all 91 changed/new files before the compact checker adapter, verified file by file; SHA256 `446225e635858965581bcae10e5dc1902d0466f81c971286ba6f1c4cb850e3be`. Native rows and Canvas recordings were not replaced. Historical guides/reports remain references with one active entry
point. Completed temporary studies are archived under `.artifacts/takeover-20260920/prototypes/`, with SHA256SUMS.

## Core changes

- **Blink plain work:** omit six sampled linear-advance questions used only by diagnostic gaps. Retain primary-family
  discovery, optical-size decisions and supplied facts. Missing named families can resolve to system fonts, so deleting
  all font checks would change actual line decisions.
- **Blink measuring text:** omit per-character source maps when neither diagnostics nor effective letter spacing reads
  them. Compile equal-length Canvas spellings once on eligible plain Latin-1 paragraphs; slicing preserves emitted
  characters and one-byte/two-byte encoding. Normally two extra bytes per source unit, at most about three plus a small
  object. No compiled strings on inspected, segmented, SHY or all-nonzero-spacing paragraphs; general recipes remain.
- **Blink accepted cuts:** carry an already measured complete child width directly into its recursive call, within the
  same accepted unshrunk shaping window. Shrink/failure discards the carry. This removes duplicate questions without
  an answer table, new paragraph state or a changed cut.
- **Gecko dictionary work:** the existing preparation-local line-breaker owns four lazy locale machines, discarded after
  preparation; no text or returned-answer cache. Consume original-coordinate boundary arrays by cursor instead of
  copying/subtracting every remaining suffix. This removes quadratic boundary-copy growth.
- **Gecko language:** carry the raw inherited tag through the existing content events; canonicalize only at text
  leaves. Preparation no longer walks ancestors for each leaf. Empty tags still reset, closes restore the parent, and
  localized empty spans cause no new language or Canvas work. The unused ancestor-walk helper was removed.
  Long accumulated words use bounded UTF-16 conversion instead of an unbounded argument spread; ordinary words
  retain their path. Two million-unit multi-flow regressions and 126 full-flag comparisons protect this runtime fix.
- **WebKit growth:** append finished bidi splits once instead of repeatedly inserting into/moving the item and offset
  tails. Carry inherited language in the existing renderer traversal frame instead of walking ancestors for every leaf.
  Null inherits; an empty language remains an explicit reset. No cross-paragraph cache.

`DESIGN.md` describes the lifetimes and measuring contracts. Permanent regression tests protect the requested-output
boundary, Canvas encodings, dictionary answers/fresh preparations, bidi split metadata and inherited-language resets.

All-engine offline closure before the compact lab adapter: **25 gates in 212.7 s, exit 0**. Six strict
projects and **1,026 unit tests in 86 files** passed. All **393,964** recorded full predictions remained unchanged;
Gecko/WebKit Canvas questions were exact, and Blink changed repetition only. Plain and pure checks each covered all
393,964 browser/configuration observations with zero failures or skips. Plain mode deliberately omits diagnostic-only
questions; the full-prediction replay changed no first Canvas question. The two Blink replay children exit 3 for
accepted repetition/storage changes; the aggregate records their remaining tier-2 request rather than claiming it ran.
Evidence: `.artifacts/takeover-20260920/gates-takeover-complete.log` and the archived exact 25 selected logs in
`gates-takeover-complete.tar.gz`. Earlier closure/prototype reports remain archived historical evidence.

## Measured payoff and stopping

The focused headed Firefox 156 pair proved complete ordered Canvas questions/all numeric TextMetrics, segmentation
requests/answers and inspected/plain output equal before direct-native timing. All 192 cells recorded actual focused
and visible endpoints at screen DPR 2. Short Thai/Myanmar/Khmer preparations saved a modest, noisy
11.81/18.14/10.37 microseconds per message (2.58/3.81/4.37%). Native whole-boundary passes on long single SA ranges saved
11.63/3.985/3.795 ms (29.8/22.7/20.3%), all 36 pairs positive. Those boundary timings exclude Canvas and are not whole
message timings. Raw data: `.artifacts/bench/takeover-gecko-dictionary-native-v3-20260920/`.
[Portable reproduction](tools/GECKO-DICTIONARY-PAIR.md).

The headed Chrome 153 compiled-text pair used 2,000 mixed and 2,000 Latin chat messages, twelve alternating fresh
preparation pairs and six three-width resize pairs. Actual ordered question/settings/context/width-left-right triples
and complete plain materialized outputs at all four widths matched. Paired scratch ratios were 0.920/0.989;
resize ratios 0.977/1.016. Timing was noisy and power changed AC to battery, so these are scoped observations,
not a universal or maintained benchmark speedup. Own-JS/free-answer prototypes showed clearer savings; their numbers
exclude actual Canvas cost. Raw/native focus/power/source seals: `.artifacts/bench/takeover-blink-compiled-foreground-20260920/`.

WebKit public-preparation prototypes under Bun/JavaScriptCore removed large-input growth: repeated bidi split/tail
sizes 512/2,048/4,096 saved about 0.215/3.36/13.77 ms; deeply inherited language with 1,024 leaves and 64/256/1,024
ancestors saved 0.143/0.501/2.98 ms. Ordinary messages and a no-split control were within timing noise. These are
own-JS structural results, not Safari performance claims. Full metadata, break flags and output matched in 1,856
combined-prototype comparisons, with 105,136 ordered Canvas questions and 558 segmentation requests.

Gecko language preparation matched 261 inputs across five widths and both modes: 2,610 complete layouts, 65,886 lines
and 743,282 ordered Canvas questions/answers. Bun own-JS prototypes saved about 2.69 ms with 1,024 inherited ancestors
and leaves (ratio 0.176); shallow/mixed controls were neutral. Canonicalizing at span opens was rejected because it made
localized empty trees slower. These are structural measurements, not Firefox wall-time claims.

**Deferred coarse shaping:** doubling Blink's exact-leaf target to 512 zoomed px saved only about 12/17 microseconds
per mixed/Latin message in fresh preparation but added 44/51 across the tested three fresh widths. All twelve resize
pairs lost (47/60% slower): questions rose 11/16% and shaped units 76/104%, as fewer prefix anchors made cold queries
longer. Sampled complete outputs matched, but an odd raw16 rounding counterexample disproves unguarded exactness.
Intervals/refinement would add a precision contract and retained-line lifetime machinery without removing that query
length debt. Keep the 256 px exactness contract. Reopen with a representation addressing both precision and cold-prefix
cost; more coefficients or font-specific exceptions are not a foundation.
Native raw data: `.artifacts/bench/takeover-blink-coarse512-native-20260920/`; the full decision/counterexample is in
`prototypes/blink-candidates.tar.gz` under `.artifacts/takeover-20260920/`. Whole-group and other tiny scan prototypes were
also rejected or deferred with their evidence preserved.

Two further candidates stopped at prototype. Replacing only Blink diagnostic canonicalization with sorted interval union preserved 10,036 adversarial/randomized outputs, but canonicalization accounted for just 38.18 ms of a 4,693.62 ms giant inspected free-answer profile (0.81%); small and un-ranged inputs could slow down. Moving Gecko's original-unit-start return before eager windows preserved 300 targeted full-output comparisons and 6,000 ordinary message comparisons, but saved no questions or shaped units in the ordinary cohort and reordered some inspected questions. Neither warranted a core change on that cohort evidence. The 2026-09-21 general audit lands the original-start
guard after proving substantial unbreakable-word savings. The then-deferred canonical-only prototype was later
replaced by source-preserving raw accumulation and canonical union in the general-cost checkpoints. Exact proofs and stopping reports are archived as `prototypes/blink-canonical-deferred.tar.gz` and `prototypes/gecko-unit-start-deferred.tar.gz` under `.artifacts/takeover-20260920/`. These are scoped own-JS observations, not native wall-time claims.

## Acceptance and main requirements

Scorer 8 compares the complete native scorer view: collection lengths, point/node/element rects and slot floats.
Native geometry is validated before scoring: finite coordinates and nonnegative finite dimensions, with negative
positions and zero dimensions valid. A planted negative/JSON-null width previously hid an omitted glyph and passed;
it now makes certification inconclusive. The observer's source population is also required: one rect list per text
run, including empty runs, and one list per non-text inline node. Empty lists remain valid. Identical missing lists in all
six jobs formerly certified; real old/new CLI probes now reject them. Valid observations allocate no geometry-error descriptions.
Ledger format 3 separates actual native variation from prediction order dependence. Stable native targets with different
prediction metrics/exact values cannot acquire a browser-history exemption. Existing unstable entries retain per-order
pass/exact/error-count obligations; becoming consistently wrong cannot read as an improvement. New native variation
blocks prior obligations instead of silently retiring them. Planted asymmetry, omitted-letter, wrong-cut and process
failure tests demonstrate these checks.

Line-range diagnostics validate ordered disjoint integer ranges once and use indexed lookup instead of scanning every
predicted line for every native code point. Legacy overlapping, reordered or malformed ranges retain their original
first-match scan; failure descriptions are built only when stored. Complete diagnostics/errors matched in 24,000
randomized cases. Permanent regressions cover UTF-16 gaps/empty ranges, legacy lookup and 65,536-point coverage. In Bun
with synthetic geometry, a 269,000-point/4,484-line diagnostic fell from 441.8 to 11.8 ms. This is checker own CPU,
not browser or full-workflow speed. The independent complete-source evaluator uses the same indexed containment
lookup after its stricter validation; all 12,003 full-evaluation comparisons matched. Scorer 8 is unchanged; source
seals require renewed audits.

The native line grouper indexes each node's first matching box while building its existing centre IDs, removing another
O(points × lines) full-book scan. WebKit raw/truncated top aliases retain first-match order; NaN tops retain their
standalone fallback. Full output matched 20,000 randomized observations and 6,387 retained actual browser rows,
including a 106,857-point giant per browser. With synthetic geometry in Bun, grouping 269,000 points/4,484 boxes
fell from 699–859 ms to about 7.2 ms. These are checker CPU measurements, not browser or full-workflow timings.
The transient index lasts one grouping call. The original observer and all native rows remain unchanged.

Complete selected ledger runs now fail when expected reference cases disappear, including an empty run. Focused
subsets remain allowed. Actual old/new CLI comparisons reproduced the missing-case false green; one command-level
regression protects both boundaries.

Input content-box widths now match the browser's source-defined encoding, including fractional declarations and
Blink's final float32 client conversion. All 3,000 saved actual widths passed; all 3,000 planted one-unit defects were
blocked. Source-derived/emulated-unit tests are distinguished from actual installed-browser observations. No fitted
tolerance or predictor geometry determines the expected width. Glyph geometry and vertical positions remain outside
this source-cut tier.

Native workflows seal complete runtime trees, fonts, configuration, acceptance entries and inputs, including the
actual WebKit host executable. They verify after acquiring the lock and after all jobs/checking, including strict-red
and failed-child paths. Edits/additions/deletions and input drift block adoption; actual exits and diagnostics remain.
Twenty-five separate-process driver tests passed in 3.33 s before integration. Measure-first run documents and every raw row now require complete populations and exact document positions. Twenty-two actual old/new CLI probes reproduced metadata false greens; 40 focused checker/book/width tests and 397 assertions passed after the fix. Native-first controls and predict-only diagnostics remain distinct. Source snapshots detect persistent
concurrent edits, not transient edits reverted between snapshots.

Six existing ledgers were explicitly staged, reviewed and adopted from both saved orders. No predictions, Canvas rows,
input manifests or recording shards changed; **zero new native-history exclusions** were added. Firefox has one and
WebKit four previously misclassified prediction-order cases. Older Firefox seeds had already retired 3 no-facts/296
facts pairs through witnessed native history; the migration records that inherited debt explicitly. Adoption seals:
`.artifacts/tests/migrations/takeover-20260920/adoption.json`. Known native exclusions are not general predictor waivers.

The independent raw-source audit evaluated every historical main visible-pass label in the original twelve chunks:

| Browser | Historical labels | Verified original native passes | Refuted | Inconclusive |
|---|---:|---:|---:|---:|
| Chrome | 159,163 | 157,643 | 678 | 842 |
| Firefox | 175,488 | 175,480 | 8 | 0 |
| WebKit | 167,722 | 167,674 | 48 | 0 |

All 502,373 labels stay catalogued; **500,797** are certified requirements. Verification checks complete unambiguous
visible source coverage independently of redo outcomes/gaps. A native-only same-node SHY duplicate-report rule retains
the following glyph's actual placement; unmatched/report-only multi-line placement stays inconclusive. An original
single-order observation is not a current stability certificate. Scope is explicit; separate long-form coverage follows
below. The catalog/generator/audit seals are under `.artifacts/tests/main-native/takeover-certified-compact-final-20260920/` and
`.artifacts/takeover-20260920/main-audit-compact-final/`; preserve the original staging catalogs they reference.

The fast sample selects 1,000 certified requirements per browser by input features, seed and cost, never redo success.
It covers all eligible families/marginal tokens; Chrome's two historical-only start-control families have no certified
original passes and remain visible. Marginal coverage does not cover every combination or threshold. The native workflow
runs fresh inspected/plain preparations in both orders, with optional diagnostic main comparisons and honest child exits.
Active native workflows hold the maintained browser lock directly and do not depend on an untracked artifact scheduler.
With those two extra main jobs, measured workflow times were **17.8/21.8/9.0 seconds** for Chrome/Firefox/WebKit.
Without them it runs four native jobs. Ten driver tests took 0.70 s; the original all-engine quick check took 180.6 s.

The earlier fresh certified run, before the final protocol tightening: Chrome 999 passes/1 stable failure; Firefox 952 passes/1 stable failure/47 reviews
(44 native variations and 3 main-only prediction-order changes); WebKit 998 passes/2 failures with actual reverse-native
variation. All strict workflows correctly exit 1. Plain/inspected parity losses and unexpected rows were zero. These
results establish neither exact widths/positions/painter accuracy nor a fresh 500,797-case sweep.
Raw rows, completed run records, input/bundle/environment seals and reports:
`.artifacts/tests/main-native-runs/takeover-certified-20260920/`.

All six audits were actually renewed again after the compact-adapter and plain-role guard integration. The final scorer, evaluator and auditor give identical classifications and fast/full required-case bytes to the prior certificates. `.artifacts/takeover-20260920/compact-final-audits.json` records all six executions and comparisons; source hashes are in their sealed audit manifests.

## Maintained suites and additional texts

The no-facts frozen references contain all 7,680 maintained accuracy cases per browser, each passing line count, and
the applicable compact keep-all, symbol, pre-wrap, letter-spacing, discretionary and filed families. The certified chunk
set is stricter than the old height-only accuracy criterion: it does not certify 517/519/512 of those existing line-count
passes for Chrome/Firefox/WebKit as complete visible-cut passes. Their line-count requirement remains protected by
replay. Do not claim the certified native tier alone covers every existing main metric.

A separate application-text audit certifies 4,679/4,628/4,679 original passes, with zero refuted/inconclusive labels. Its
64-input supplements cover all 89 eligible marginal tokens, independent of redo outcomes. Catalogs and audits are
`.artifacts/tests/main-native/takeover-real-text-certified-compact-final-20260920/` and
`.artifacts/takeover-20260920/main-audit-real-text-compact-final/`; fresh opposing-order reports are in
`.artifacts/tests/main-native-runs/takeover-real-text-20260920/`. All three supplements passed 64/64 fresh requirements,
zero native variation/order/parity issues, strict exit 0; four native jobs plus check took 9.4/13.5/4.5 s. The final checker revalidated those unchanged own-native rows: all three remain 64/64, exit 0. These saved-row rechecks are `.artifacts/takeover-20260920/final-real-text-saved-*.json`, not new browser observations.

Original long-form corpus coverage is only 47 reference cases per browser and excludes the >50,000-unit giants. The
chunk audit does not include the 1,098 separate original corpus cases. Corpus00–04 contain two Arabic books,
05–07 a long English book, and 08–10 fourteen smaller texts. Existing WebKit corpus04 is incomplete; the apparent
04a/06a/07a replacements are failed partial runs with mismatched inputs, not evidence of completeness. They cannot
be silently reconstructed as successful original sources. Imported corpus sampling now validates exact raw paragraph
shape and mandates a representative for each eligible text SHA256, in addition to family/font coverage.

An independent required-membership inventory counts 7,803 merged identities representing 7,807 original aliases.
Every applicable identity is present and passing its frozen line-count requirement: 7,799 Chrome, 7,755 Firefox and
7,802 WebKit. Evidence is `.artifacts/takeover-20260920/required-roster/`. This proves membership/stored status,
not preservation of the original height tolerance, preparation locale, Range/span extractor or rich public API contract. Of these, 7,275/7,229/7,279 additionally have independent visible/count certificates. The remaining 524/526/523 retain count protection; 512 per browser are empty-text accuracy cases with no visible cuts.

The new [book survey](tests/BOOK_SURVEY.md) selects every entire maintained text at both original endpoint widths,
with raw and exact maintained-normalized paragraphs recorded separately. It validates all 1,098 original input cases
before selecting 72 predetermined paragraphs (about 3.3 million UTF-16 units). Requirements derive from main's own
native full-source visible/count passes in both orders, independently of redo outcomes. Actual default-locale public
count/height instrumentation and the original raw-prepared/normalized-painted height criterion stay separate. A
height-only main pass cannot silently become a source-cut certificate. Wrong observed widths, truncated scalar
observations, unavailable geometry and native variation block acceptance. All three completed workflows close with source verification and exit 0. The survey preserves installed-font contexts and the complete maintained CSS fallback stacks. Missing-family diagnostics check every named stack alternative; they do not identify the selected face or establish coverage of unavailable Noto/CJK alternatives. Loading fixture fonts here would change the original contract.

Firefox's completed endpoint survey passes all 72 redo/plain own-source count and visible-cut cases in both orders;
main supplies 37 strong requirements, with 35 main misses retained visibly. Main and redo each pass 29/36 of the
original mixed-source height comparisons, but only 22 passing pairs overlap. Seven main-only Japanese/Chinese
passes conceal actual raw-source public count errors: main matches the normalized native count while exceeding
the raw paragraph's stable native count by 1–7 lines. Gecko's documented East Asian LF transformation explains
this difference. The equal aggregate totals do not establish equivalent passing cases. Another seven main legacy
height passes have correct raw counts but wrong visible cuts. The [book survey](tests/BOOK_SURVEY.md) records the
exact pairs and keeps that original height diagnostic separate; this endpoint supplement does not certify every
inherited wrapping contract or the full 1,098-point canary sweep.

## Focused workflow and completed book results

The focused `inspected-ranges-predictor.ts` runs the unchanged complete facts-free inspected core and returns its
contentful source ranges and measurement-call count. It omits lab expected-observation generation, limits and painting.
Full geometry suites retain `no-facts-predictor.ts`. Sixty-four fresh stand-in comparisons preserve projected output
and every ordered prediction-phase configuration/question/all-numeric-metrics answer, including 5,903,334 questions on
the actual 256,837-unit Arabic text. These are dataflow proofs, not native timings. WebKit's omitted observation port
asks additional Canvas questions, so fresh own-native captures were required under this distinct focused protocol.

Those final four-job captures now exist for all three browsers. Every native child exits 0; all strict checks/workflows
exit 1 and remain non-adoptable as acceptance certificates. No new core miss, predictor-order change, mode-parity loss,
inconclusive case or unexpected row appeared. The standalone checker also rejects inspected rows relabelled as plain:
two old/new CLI probes reproduce and close that false claim, while genuine plain and diagnostic/control modes remain.

| Browser | Fast pass | Stable/core or reverse-native failures | Native-variation reviews | Workflow seconds |
|---|---:|---:|---:|---:|
| Chrome | 999 | 1 stable core miss | 0 | 16.2 |
| Firefox | 951 | 1 stable core miss | 48 | 15.7 |
| WebKit | 998 | 2 reverse-native cut changes | 0 (2 failures also vary) | 7.7 |

All 48 Firefox reviews pass their own count/cuts; full native geometry varies. The earlier four-job full-adapter run
also observed these 48, rather than only the 44 in the older main-diagnostic run. These are accuracy-workflow durations,
not core benchmarks. Main diagnostics were not supplied here; zero `mainBaselineFailed` is not a fresh main-pass result.
Final rows/reports/source-verified workflow records: `.artifacts/tests/main-native-runs/takeover-compact-final-20260920/`.
The old WebKit fast launcher did not run after its explicit 30-minute book wait bound; that orchestration failure is
preserved in `final-fast-wait-status.json`, not counted as a browser result. The new focused capture covers all three.

| Browser | Strong own-main book requirements retained | Stable main misses retained | Redo/plain own-source passes |
|---|---:|---:|---:|
| Chrome | 64 | 8 | 72/72, both orders |
| Firefox | 37 | 35 | 72/72, both orders |
| WebKit | 68 | 4 | 72/72, both orders |

All 216 whole-book inputs pass candidate/plain count and complete visible cuts in both orders, retaining all 169
independent main requirements. There are zero book native variations, reviews, inconclusive cases or mode/order losses.
The captures used the full NoFacts adapter before the lab simplification; they are not fresh compact book captures.
The final checker rechecks these unchanged rows with identical outcomes under `book-survey-saved-final/` in
`.artifacts/takeover-20260920/`. Application-text saved rechecks also remain 64/64 in every browser under
`compact-final-real-text-saved-*.json`. Neither saved recheck is a new native observation.

The old WebKit forward diagnostic sums were about 1.6 s core prediction, 355 s native extraction, 255 s expected
observation and 69 s painting/paint observation. The adapter removes those last lab phases and their retained payload;
it does not accelerate native extraction. An actual Chrome Arabic row projects from 66.6 MB to 11.1 MB while retaining
its 10.8 MB native observation. These are old phase totals and an artifact projection, not a measured new book speedup.
Do not blindly repeat the costly whole-book capture for a lab-only projection: unchanged core traces, fresh focused
native checks and retained full captures justify that scoped reuse. A future core or observer change needs its own proof.

The exact completed book reports, six WebKit phase sums and provenance are archived in
`prototypes/book-final-proof.tar.gz`; final compact reports, audits and saved checks are in
`prototypes/compact-final-proof.tar.gz`. Final all-engine offline closure is recorded in
`.artifacts/takeover-20260920/gates-takeover-final.log`; the selected gate logs are archived separately. The core remains
unchanged from the preceding 393,964-output closure, and acceptance tightening cannot make a genuine miss pass.

## Open foundation and environment issues

- Chrome `c-d0c13fd8c7aca939`: Arial 16, letter spacing 1, lam-alef text `لألالإلآ`. Stable native four lines, redo/plain
  three. Font glyph clusters cannot be inferred from default grapheme boundaries. Assuming all lam/alef pairs merge fixes
  Arial but breaks Amiri/Noto Arabic fonts; do not land that shortcut. The compact regression checks true visible cuts
  without relying on inspection or diagnostic gaps.
- Firefox `c-4e2eb3330e0edd98`: Amiri Arabic/SHY/form-feed, stable native three lines, redo/plain four. The joined-prefix
  advance differs; a form-feed special case would repair a symptom. Existing contextual-prefix/optical limitations
  remain visible. Main's visible pass is a requirement, not evidence that its widths are exact.
- WebKit `c-a952a6005f24147c` and `c-b680273a18a11dd9`: unchanged predictions match original and fresh forward native;
  reverse native moves a guillemet or Latin character onto another line. Both modes reproduce it. Keep the actual
  differing targets and strict failures visible; no automatic history waiver or port precision diagnosis.
- Firefox native variation and main-only prediction-order differences remain review items. The runtime protocol is part
  of the test evidence. Neither main diagnostics nor known gaps can withdraw a genuine requirement.

Large recorded replays, direct-native protocol/output proofs, targeted browser sets and native encoding checks justify
skipping an indiscriminate 94,571-case tier-2 rerun requested by the conservative storage/repeat file rule. The recorded full-prediction replay changed no first
question; plain preparation explicitly drops diagnostic-only work. That request is retained in the offline report; it was not silently marked completed. Full installed
Safari, exhaustive interactions and fresh all-main-obligation sweeps remain larger follow-ups when a concrete question
needs them. No new public feature, cache surface, font heuristic or compiler upgrade was introduced.
