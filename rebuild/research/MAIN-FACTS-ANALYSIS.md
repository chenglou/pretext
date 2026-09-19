# Main's true passes that the rebuild fails: what it would take (2026-09-19)

The maintainer asked whether the rebuild can pass what main passes (`MAIN-PASSES-REFRESH.md`): "main tackles these although its heuristics might be able to do that and maybe we can't? Hopefully we can." One agent per engine traced every group to the pinned browser source, asked why main passes, and built small prototypes on unmerged branches (`x-mainfacts-blink`, `x-mainfacts-webkit`, `x-mainfacts-gecko`, off 66f621a). A critic then opened the sources, reran the numbers and ran its own probes. The critic's report comes first. Nothing here is merged; the fixes it approves go into a correctness round after the re-architecture's X3.

## The critic: Critic: can the rebuild pass main's true passes? (2026-09-19)

No worktree or branch of mine. Output folder: `~/github/pretext-rebuild/.artifacts/session/main-facts-20260919/critic/`. Three browser jobs, none failed. Nothing tracked was touched; all four trees are clean.

Terms:
- A **case** is one styled paragraph at one width.
- **True pass** is a non-accidental pass of main (the triage's "fact to learn").
- **Told** means Canvas decided a fact. A **stand-in** is a value the library returns but reports a gap on.
- **Cut** is an offset inside a word where a line may break.

### Verdict

With no supplied facts the rebuild fails 809 of main's true passes: Chrome 344, Firefox 202, webkit-host 263.

**What the rebuild can pass with no facts: 160.**
- Firefox 130 of 202. About 107 by learning which glyph of a kerned pair carries the adjustment, from Gecko's rounding of each glyph to app units. About 23 by porting the rule that U+200D at the start of a Canvas string takes the first font. 0 passes lost on the list and in 940 control cases.
- webkit-host 18 of 263. 11 by a rule that was never ported (the code path is chosen per measured string). 7 more by a measuring heuristic.
- webkit-host 12 more are not failures. They are page history. Move them out.
- Chrome 0.

**What it can pass only with supplied facts: about 500.**
- Chrome 266 of 344, with two facts: the ligature facts and `pairKerning`. The ligature fact can't be written by hand. It needs a build-time tool that reads font files.
- webkit-host 233, only with a new kind of fact: a family the application declares with liga, clig, dlig and hlig off. It is exact in probes. It is not built.

**What it should not try to match.**
- Chrome's ligature clusters and U+2060 cases without facts. Any Canvas recipe is a guess: Arial and Noto Naskh Arabic give the same width signature and break differently.
- Firefox's 72 contextual joined forms, mostly Amiri.
- WebKit's Shantell thresholds in the headline. The missing number is a kerning value hidden under a ligature.
- Chrome's U+FFFC (14) and text drawn by the system fallback (48).
- Main's formulas. Main lands on these cases by coincidence of width or of one font. That is now demonstrated in all three browsers, not asserted.

**Order for the correctness round.**
1. Reclassify WebKit's 21 history cases. No code.
2. WebKit prototype 1. About 6 lines.
3. Gecko U+200D font range. About 15 lines, stays a stand-in.
4. Gecko pair placement. The biggest win. First run the plain path's Canvas questions on tier sets in the browser, because tier 1 can't replay new questions. Write the two assumptions into the gap prose.
5. Docs: Blink's negative result into DESIGN §5 and CHARTER; FACTS-FREE's "pairKerning: No" becomes "yes in Gecko"; file the WebKit Canvas `letterSpacing` bug.
6. Optional: WebKit prototype 2 as a registered heuristic; trace Blink's SHY plus mark miss (20 cases, the rebuild's own); the features-off family; a facts generator.

### Evidence I added

**Sources opened. Every citation I checked is what the source says.**
- gfxHarfBuzzShaper.cpp:1699-1702 rounds each glyph with floor(x + 0.5) when pixel rounding is off.
- hb-kern.hh:102-106 splits a pair adjustment in halves.
- hb-ot-shape.cc:131-187 chooses GPOS, kerx or kern once per plan.
- gfxTextRun.cpp:3609-3613 and :3311-3325: the first valid font for a string-initial join control.
- FontCascade.cpp:304-309, :708-730 and TextUtil.cpp:84-89: WebKit picks the code path from the measured run.
- TextBreakingPositionCache.h: the key has no direction and no font.
- StyleComputedStyleBase.cpp:318-333, font_features.cc:54-86, shape_result.cc:975-990, plain_text_node.cc:47-59, shaping_line_breaker.cc:326-329 and :397-409.

**One thing the Gecko owner did not check.** Eight of M1's families (Helvetica, Helvetica Neue, Times, Palatino, Optima, Baskerville, Didot, Hoefler Text) are AAT fonts that Firefox marks for Core Text shaping (CoreTextFontList.cpp:285-291). gfxCoreTextShaper truncates advances (gfxCoreTextShaper.cpp:488), which would break the rounding model. It doesn't apply: `gfx.font_rendering.coretext.enabled` is false by default (StaticPrefList.yaml:7849-7851), so HarfBuzz shapes them.

**Probe G1, pinned Firefox: the pair recipe on held-out fonts.** 45 families outside M1, plus italic, bold, 11px and 13.5px styles of M1's families, 46 words. 112 styles resolved, 105 kern.
- 95 styles were told a placement. All 95 equal the DOM's placement. None was told the wrong one.
- 4,528 of 5,114 kerned cuts were told. 4,509 equal the DOM's advance.
- The 19 others: 18 are 1 au off and sit in words whose DOM total itself differs from Canvas's by 1 au, the registered `gecko/one-shaping-unit-one-app-unit` class. 1 is `st` in Zapfino, a DOM ligature (577 + 577 au), which the port's ligature test takes before this recipe.
- Today's stand-in equals the DOM at 2,511 of the 5,114.
- system-ui and Apple Chancery are never told. The linearity guard works.
So the recipe is not a fit to the list. M1's "30 faces" are 19 families at several sizes.

**Offline, hb-shape over 1,008 installed faces.** 320 kern Latin letter pairs: 215 put everything on the first glyph, 103 split in halves. 2 look mixed only because a kern of −1 unit splits into −1 and 0. No face puts a Latin pair adjustment anywhere else.

**Probe 2, pinned Firefox, main's predictor on width sweeps.** Main's line count fails:
- `A` SHY `V`, 18px Times New Roman: 4 of 33 widths (24 to 25.5px), as the owner read from main's code.
- Mongolian a e i in 16px Arial: 15 of 25 (every width from 13 to 20px).
- `aabb((بب` in 24px Amiri: 24 of 43 (12.1, 12.2 and most of 18 to 40px).

**Probe 3, webkit-host, main's predictor, letter spacing 1, `office waffles affinity`, 20 to 70px.** Shantell Sans 51 of 51 pass, Georgia 51 of 51. Hoefler Text 46, Futura 47, Helvetica Neue 50. Offline the font data agrees: Shantell bold's `fi` ligature is 728 units against 727 for its kerned parts; Hoefler Text's is 1,168 against 1,230; Futura's 1,087 against 1,161.

**Reproduced from the owners' files.**
- Blink's filtered-facts table: 201 / 0 / 201, 2 / 52 / 54, 4 / 7 / 11, 0 lost.
- Blink's 20 constructed cases rescored: main passes 7 line counts, the rebuild without facts 18, and 12 on both metrics.
- hb-shape: Noto Naskh Arabic draws lam-alef as two glyphs in two clusters, Arial as one glyph.
- WebKit's isolated run: 21 of 21 pass, and no cache key among the 21 holds both directions.
- Gecko's list: Canvas calls 28.8 to 34.2 per case on the lab path, largest increase 108. Of the 202 true passes, 130 pass at HEAD and 72 remain. 0 passes lost.

### Per report

#### Gecko
Holds: the mechanism, the source reading, the counts, the three-cause regrouping, "don't revert 186d45e".

Weak points:
- **Two placements are not exhaustive in source.** kerx and kern format 1 put the whole value on one pushed glyph (hb-aat-layout-kerx-table.hh:329-333). A GPOS second value record can too. A font that does this could be told wrongly, since "exactly one of two explains the total" then proves nothing. No installed face does it for Latin pairs. The `pairKerning` fact has the same two values, so the model is at least consistent. A three-way test costs a fifth of the told cuts and fixes nothing observed.
- **The probe pairs assume one face draws all printable ASCII.** A list whose first font covers part of ASCII (a digits-only font, a `unicode-range` subset) can have the text's pair in one face and the probe pairs in another. I could not build that case from installed fonts. It is reasoned, not run.
- **Told values report no gap** (`standIn: null`). A wrong verdict would be silent. The facts path has the same property.
- **Cost on ordinary text is unmeasured.** The owner's figure is the lab path on the list. 8,294 of 63,771 recorded no-facts cases ask new questions. Text that breaks at spaces pays nothing. Text with hyphens or slashes inside words, soft hyphens, break-all or emergency breaks pays 11 questions per consulted kerned cut. The probe step cost a median of 12 questions per text run on my set, and 96 where nothing tells, which includes system-ui. An idea, untested: stop the probe step at the first pair that fails the linearity guard, since that is the face's property.
- The answer lives on the text run. That avoids stale answers when a web font loads. A per-declaration cache would need invalidation.
- The check sits in `advance.ts`, not in `src/measure/font-checks.ts`, and runs lazily. That keeps ordinary text free. It is a design choice to confirm.
- The facts configuration was not run at HEAD. The commit that lost the 14 cases was found by reading, not by bisecting.

#### WebKit
Holds: the history finding, prototype 1 as a port, the "not knowable in the headline" verdict, the coincidence in Shantell.

Weak points:
- **"0 lost" says little.** Tier 1 shows prototype 1 changes the questions of 2 of 63,987 recorded cases, prototype 2 of 3. The controls barely touch the changed path. The real evidence is the 33 gained and the source. The same fact makes them safe.
- **Prototype 2 is a heuristic, not a port.** Its condition was tightened after tier 1 showed a Tamil conjunct. Probe M3 has it up to 1.9px off in Shantell. It is a better stand-in under the gap. Register it as a heuristic with M3's verdict.
- **The features-off family is unbuilt.** It was probed through the FontFace API only: no CSS `@font-face` rule, no synthesized faces, no installed Safari. On the complex path it is inexact in Shantell (99 of 117). It is a new kind of fact that changes measuring contexts, so it needs a design pass. If WebKit fixes its Canvas bug the fact is not needed.
- The refresh's counts change: 306 becomes 285, and 263 becomes 251.

#### Blink
Holds: no sound recipe for the two big groups; the two facts recover 266; main's passes are coincidence.

Weak points:
- The 52 U+2060 cases are one paragraph shape at one width. They are one fact, not 52.
- The 20 constructed cases were chosen, not sampled. The owner says so.
- "List Geeza Pro yourself and give its facts" for the 44 fallback cases is untested.
- The guard (up to 5 cases) and the SHY plus mark miss (20 cases) are readings, not tests.
- No lever exists without facts except flipping the lam-alef default to "one cluster". That fixes Arial and Times New Roman and breaks Noto Naskh Arabic and Amiri. It is a choice by count, which the charter forbids. Both defaults stay under `glyph-clusters`.
- Gecko's rounding trick does not carry over. Blink keeps 16.16 positions and rounds no glyph, so a total never moves.

### Charter check
- No per-font rule, no name key and no tolerance is proposed anywhere.
- Gecko's guards come from arithmetic. The `> 2 au` test was already in the facts path. The list of 16 probe pairs is a probe-string choice and should be registered.
- WebKit prototype 2 must be registered as a heuristic.
- CHARTER's "Facts no check answers" and FACTS-FREE need the Gecko exception once it lands.

### Still unproven
- The plain path's cost for the Gecko recipe on ordinary text.
- The Gecko recipe at another device pixel ratio, on another OS (pixel-rounded advances are rejected by the guard in principle), and with a web font that covers part of ASCII.
- The features-off family in a lab run and in installed Safari.
- Everything the owners listed as untraced.

### Files
- `critic/gecko-heldout-probe.ts`, `g1/firefox-probes.json`, `g1-analyze.py`, `g1-analysis.txt`.
- `critic/ff-main-cases.ndjson`, `ff-main/`; `wk-main-cases.ndjson`, `wk-main/` (rows compressed).
- `critic/offline/`: `placement.py`, `placement.ndjson`, `tables.py`, `tables.ndjson`, `fonts.txt`.

### What this report couldn't settle (The critic)

- The plain path's Canvas cost of the Gecko pair recipe on ordinary text is still unmeasured. Tier 1 can't replay cases that ask new questions, the owner measured the lab path on the list only (28.8 to 34.2 calls, which I recomputed), and I had no browser job left for a tier-set run. This is the number the maintainer watches, so it should be measured before the recipe lands.
- Two soundness holes in the Gecko pair recipe are reasoned from source and not run. (1) HarfBuzz has a third placement (kerx and kern format 1, hb-aat-layout-kerx-table.hh:329-333; a GPOS second value record), so 'exactly one of two placements explains the total' is not a proof; offline no installed face uses it for Latin pairs (1,008 faces, 320 kerning). (2) The probe pairs assume the face that draws them also draws the text's pair; a font list whose first font covers only part of ASCII breaks that. I could not build such a case from installed fonts. In both cases the wrong value would carry no gap.
- My held-out probe G1 ran once, on one Mac at a device pixel ratio of 2, in pinned Firefox 156.0. It checks placements and advances by my own arithmetic copied from the owner's m1c.py, not by running the prototype's code; the port's ligature tests, which run before the recipe, are not modelled (the one 13 au miss, Zapfino 'st', is a DOM ligature they would take first).
- I attribute 18 one-au misses in G1 to the registered DOM-against-Canvas 1 au class because each sits in a word whose DOM total differs from the Canvas total by 1 au. I did not trace the mechanism per case.
- Main's side in probes 2 and 3 is the main checkout's copy of main's library through rebuild/lab/baselines/main-predictor.ts, line count only (main returns no comparable breaks). The sweeps are widths I chose, not a sample, and the rebuild was not run on the same sweeps (no job left).
- The Gecko owner's report does not mention that eight of its M1 families are AAT fonts Firefox marks for Core Text shaping, where advances are truncated, not rounded. The recipe holds only because gfx.font_rendering.coretext.enabled is false by default. A profile with that pref on would break the model silently.
- WebKit's controls (302 and 152 cases, 0 lost) barely exercise the changed path: tier 1 shows the prototypes change the questions of 2 and 3 of 63,987 recorded cases. '0 lost' is nearly guaranteed by construction and should not be read as strong evidence. Prototype 2 is a measuring heuristic and must be registered as one.
- WebKit's features-off family and Blink's 'list the fallback family yourself' are both unbuilt and untested as library inputs. The first was probed through the FontFace API only. Chrome's ligature fact is not something an application can write by hand; the 266 'with facts' figure assumes a build-time generator that does not exist outside the lab's tooling.
- Blink's guard (up to 5 cases) and the SHY plus mark miss (20 cases, the rebuild's own) remain untraced ideas. I did not trace them either.
- My first offline font study run produced no output because a zsh glob with no match aborted the command; I rebuilt the file list with find and ran it once more. No browser job failed. Three browser jobs used, the cap for the critic.
- The reference ledgers' rows hold no Canvas call counts, so I could not compute before and after calls on the Gecko control cases; only the list has both.

## Gecko (Firefox): Gecko: main's passing cases the rebuild fails, by cause, with prototypes (2026-09-19)

Worktree `~/github/pretext-rebuild-wt/mainfacts-gecko`, branch `x-mainfacts-gecko`. Pinned Firefox 156.0 at DPR 2. Nothing is merged. Output is in `.artifacts/session/main-facts-20260919/gecko/`.

Words used:
- **au**: app unit, 1/60 CSS px.
- **Cut**: an offset inside a word where a line can break (an emergency break or a soft hyphen).
- **Sides**: the text before and after a cut, measured apart in Canvas.
- **Stand-in**: a value the library returns but doesn't claim. The line reports `in-word-prefix` there.
- **Told**: Canvas decided the fact.
- **The list**: the 768 Firefox cases of `main-check-20260919`.

### 1. Answer

Status of the list, by "passes both": the scorer passes both line count and breaks.

| Configuration | Fails in the check (f474123) | Fails after the prototypes | Measured at |
|---|---:|---:|---|
| No facts | 254 | 115 | HEAD |
| The lab's facts | 147 | 115 | c4eef54, the second prototype |

0 passes were lost on any of the four metrics, in the list and in the control runs.

The triage's groups are shape labels. In Firefox they hide three causes:

1. **Which glyph of a kerned pair carries the adjustment** (the `pairKerning` fact).
   - 107 cases, all failing without facts only.
   - Canvas can tell this, from the way Gecko rounds each glyph to app units. FACTS-FREE.md said it couldn't.
   - Prototype: 107 of 107 pass with no supplied facts.
2. **U+200D at the start of a Canvas string takes the first font.** A letter drawn by a fallback font then shapes without it.
   - 26 cases of the U+202F group, plus Arabic under Latin-only font lists.
   - This is a font-matching rule the port hadn't ported.
   - Prototype: 22 of 26 pass, and 10 more cases pass as well.
3. **Contextual joined forms**, mostly Amiri.
   - All 115 that remain are this class.
   - Not knowable from Canvas.

### 2. Table

Counts are no facts / facts. "Way" is a, b, c or d as in the task.

| Group | Cases | What the browser does | Why main passes | What the rebuild lacks | Way; Canvas questions added | Prototype: group passes / control lost | Confidence |
|---|---|---|---|---|---|---|---|
| Zero-width content at an overflowing line, extra line made by the rebuild. Real cause: `A` SHY `V` plus ZWSP in 18px Times New Roman | 56 + 30 that today's rule adds / 0 | A line's advances are the glyph records of the word's one shaping (gfxTextRun.cpp:1214-1256, :1292-1301). Times New Roman kerns through the kern table, which gives each glyph half (hb-kern.hh:102-106; chosen once per face, script and language, hb-ot-shape.cc:131-187). So `V` is 710 au and fits 720 au with the zero-width content after it. | Coincidence. Main measures `V` alone: 780 au overflows but is first on its line, and main's segment rule keeps a ZWSP with the grapheme before it. | Which glyph carries the adjustment. The default puts all of it on `A`, so `V` is 780 au, and the first cluster start after it becomes the break (:1073-1074, :1091). | b. 0 for text that breaks at spaces. Per consulted kerned cut, 3 at the run's size and 8 at size × 2^k (5 distinct). Once per text run, 6 per probe pair until one tells (1 to 16 pairs; half the faces within 3). | 86 of 86 / 0 | High for the mechanism, medium for fonts outside the 30 probed |
| Latin kerning at an overflow break | 21 / 0 | The same. | Coincidence of widths. With letter spacing main uses prefix differences, which put the whole kern on the second glyph. | The same. | b, the same. | 21 of 21 / 0 | The same |
| Punctuation after another script. Real cause: Amiri beh-beh | 33 / 33, plus 8 accidental | In `بب` the first beh is 356 au and the second 1112 au at 24px. With U+200D they measure 274 and 1272 au. `(` plus beh is 723 au against 720 au. | Coincidence. An isolated beh is 1333 au, so nothing ever fits beside it. | The advance of a glyph whose form depends on its neighbour. | d | none | High |
| U+202F after joining-script letters. Real cause: fallback-font letters after a leading U+200D | 22 / 22, plus 4 accidental | The word is one shaping in the fallback font. Native Mongolian a, e, i are 755, 273 and 481 au. | Coincidence. The isolated forms are all wide, so there is one letter a line at 10px. | A font-matching rule: a string-initial U+200D takes the group's first font (gfxTextRun.cpp:3609-3613, :3311-3318), and the next letter follows only if that font has it (:3320-3325). | a + b. 2 per joined cut whose sides don't add up, else 0. | 18 of 22 and 4 of 4 accidental; 10 other cases / 0 | High for the rule, medium for the stand-in value |
| A leading invisible character gets its own native line (11 / 11); CR or FF after `ب` SHY `ب` (9 / 9) | 20 / 20 | Amiri's beh before a final beh is 237 au at 16px, plus a 354 au hyphen: 591 au against 588 au. | Coincidence. Isolated beh is 889 au. | The same as the Amiri row. | d | none | High |
| Joined letters at an overflow break | 8 / 8 | In-word advances. | Coincidence. | 4 are Arabic under Shantell Sans, the fallback-font cause. 4 are contextual forms. | a + b for 4; d for 4 | 4 of 8 / 0 | High |
| The 14 lost since round 2 (in the 17 "outside the triage") | 17 / 17 | Amiri lam-alef is two glyphs of 290 and 326 au. | Coincidence. | Contextual forms. | d | none | High |
| Smaller groups | | | | | | | |
| Joined letters at a line edge, Courier New | 3 / 3 | Not traced. | | Sides don't add up. | d until traced | | Low |
| Ligature clusters | 1 / 1 | | | The fallback-font cause. | a + b | 1 of 1 | |
| Right count, wrong breaks, other than the above | 31 / 31 | | | 19 joined Arabic, 6 ligature clusters, 6 others, all under joined sides that don't add up. | d | 5 joined-Arabic cases passed | |

### 3. Details

#### 3.1 Pair kerning (107 cases, no facts only)

**What the browser does.** Cases:
- `c-0287698f4cb03727`: `😀 A` SHY `V` ZWSP two spaces `B`, 18px Times New Roman, 12px.
- `c-05ceddee48685b0a`: `AV` ZWSP ZWSP ` tail`.
- `c-020bbf41eaa7c78a`: `AVATAR`, 16px, letter spacing 1.
- `c-ed263bd4b6656704`: `Superlongword…`, Helvetica Neue.

How the engine gets there:
- Firefox strips the soft hyphen and shapes `AV` once.
- `BreakAndMeasureText` (gfxTextRun.cpp:922) reads the glyph records and never reshapes a line.
- HarfBuzz's kern machine sets `kern1 = kern >> 1` on the first glyph and gives the rest to the second (hb-kern.hh:102-106). GPOS puts the pair value on the first glyph (PairSet.hh:126-127).
- Which one runs is decided once per face, script and language (hb-ot-shape.cc:131-187).
- Natively `AV` is 710 + 710 au where each letter alone is 780 au (probe M1).
- So `V` starts a line at 710 au, fits 720 au, and the ZWSP and spaces stay with it.

**Why main passes.** Main's `sum-graphemes` mode (`src/measurement.ts` `getSegmentBreakableFitAdvances`) measures `V` alone at 13px.
- `V` overflows but is first on its line.
- Main keeps a zero-width break with the grapheme before it.
- The count comes out the same for another reason, so this is a formula that coincides, not the engine's rule.

Where it would not pass:
- Natively, `A` SHY `V` in 18px Times New Roman is one line from 23.7px up (probe M3: 23.7, 25 and 26.1px).
- Main measures the pieces around a soft hyphen apart. `unfitHyphenRetreat` is `'none'` for Gecko, so the joined check doesn't run.
- So main gives 13 + 13 = 26px, and between 23.7 and 26px it breaks at the hyphen.
- This is read from main's code, not run.

**Why the rebuild fails.**
- `pairKerning` is null without facts. `inWordAdvance` then stands in with W(unit) − W(suffix), which is all of the adjustment on the first glyph.
- `V` comes out at 780 au, more than 720 au.
- The ZWSP after it is the first cluster start and takes the forced break (:1073-1074, :1091). That is one line more than native.
- The rebuild reports `in-word-prefix` and, without facts, `optical-size`.

**Can it pass within the charter?** Yes, by way (b).

The reasoning:
- Gecko rounds each glyph's advance to au (gfxHarfBuzzShaper.cpp:1699-1702).
- With y and z the two advances as real numbers:
  - All on the first glyph gives R = round(y + kern) − round(y).
  - Halves give (round(y + kern/2) − round(y)) + (round(z + kern/2) − round(z)).
- Canvas at the size × 2^k, the largest under 2000px, gives y, z and kern to within 2 / 2^k au.
- So both candidates can be computed and compared with the measured R.

Guards in the recipe:
- A rounding nearer to a tie than its inputs' reach doesn't count.
- The large size must predict the run-size advances. Hoefler Text fails this, because its advances aren't linear in the size.
- The pair alone must show R to within 2 au.
- The clusters must be printable ASCII. The existing font-matching guard already requires this.

The recipe, in order:
1. The cut's own pair tells in about one case in five: probe M1 decides 171 of 873 cuts, and all 171 are right.
2. Otherwise, a fixed list of 16 probe pairs is measured in the run's own context: `AV`, `To`, `LT`, `Wa`, `Yo`, `Ty`, `AT`, `P,`, `T.`, `r,`, `y,`, `Vo`, `VA`, `TA`, `AW`, `WA`.
   - The first pair that tells decides the run. This is sound because the choice is per face, script and language in the source.
3. A cut left a stand-in uses the asked placement too, as it does with the supplied fact. See "A defect found on the way" below.

**Evidence, probe M1.** 30 faces, 26 words, DOM Range widths.
- The probe list tells 26 of the 28 faces that kern, and each is told as the DOM places its pairs.
  - Didot rounds alike both ways on all 16 pairs.
  - Hoefler Text is rejected by the linearity guard.
- With the whole recipe, 742 of 849 kerned cuts outside `ff` pairs are told, and all 742 equal the DOM's advance.
- 4 more told cuts differ from the DOM. They are `fl` ligature cuts, which the port's ligature test takes first, so they never reach the recipe.
- Today's stand-in equals the DOM at 235 of the 849.
- The 103 cuts left as stand-ins are within 1 au at 45.

**Cost on the lab path, the list without facts.**
- 28.8 → 34.2 Canvas calls per case.
- The 107 pair cases alone: 18.1 → 38.1.

**Cost on the plain path.**
- Nothing unless a break scan consults a kerned cut in a Latin-described run with no fact.
- The probe step depends only on the font declaration and the language, not even on the size. It could be asked once per declaration if something outlived a paragraph. Nothing does today (DESIGN §4.6).
- The prototype keeps its answer on the text run, so two runs of one font ask twice.

**A defect found on the way.**
- The probe-pair step first told one cut and left its neighbour a stand-in with the old default.
- The cluster between them lost one pair's share.
- 2 `AVATAR` cases went from a lucky right count to a wrong one. Neither passed breaks before.
- Commit 26cc698 makes the stand-in read the asked placement, and both cases pass now.
- The rule for the correctness round: a stand-in beside a told cut must use the same placement.

#### 3.2 U+200D at the start of a Canvas string (the U+202F group)

**What the browser does.** Example: `c-0eff2962a1de9496`, `ᠠᠡᠢ(x)` U+202F, 16px Arial, 10px.
- Arial has no Mongolian, so a fallback font shapes the word once.
- Native advances are 755, 273 and 481 au, one letter a line.
- The U+202F at the end is incidental. The lines differ at the letters.

**Why main passes.** Isolated forms are wide, so there is one letter a line under any measure at 10px.

Where it would not pass:
- Natively, `ᠡᠢ` share a line from 12.6px up (probe M3: 12.57px is 754 au).
- Main's isolated `ᠢ` alone is 953 au, which is 15.9px.
- Read from main's code, not run.

**Why the rebuild fails.**
- The suffix side is measured as U+200D plus the suffix.
- The engine's rule:
  - `ComputeRanges` starts with the group's first valid font as the previous font (gfxTextRun.cpp:3609-3613).
  - A join control keeps the previous font (:3311-3318).
  - The character after a join causer takes that font only where it has the character (:3320-3325).
- So Arial holds the U+200D and the fallback font holds the letter. These are two font ranges and two shapings, and the letter takes its word-initial form.
- Probe M2 confirms it for Mongolian, Syriac and Phags-pa under nine listed fonts:
  - W(U+200D suffix) = W(suffix) at all 26 cut measurements.
  - Today's stand-in equals the DOM at none of the 24 cuts whose sides don't add up.
  - W(prefix U+200D) equals the DOM at 16 of them.
- Arabic under Georgia behaves the same way. Any Latin-only font list with Arabic text hits this.

**Can it pass?** Yes, by porting the rule (a) plus a measuring recipe (b).
- Where joined sides don't add up, measure the suffix once more behind its own first letter, U+200C and U+200D, and subtract W(letter U+200C).
  - That string is one font range. The letter is unjoined and the suffix is joined.
- Where the sides add up now, the stand-in becomes the prefix's side.
- It stays a stand-in, because M2 has 2 cut measurements where the sides add up this way and the prefix is 3 au off.
- A first version keyed on "U+200D changed nothing". A unit test modelled on Amiri's meem before reh showed that to be wrong: forms of equal width look the same. It was replaced before any browser run.
- Cost: 2 questions per joined cut whose sides don't add up.
  - The list's 26 cases: 25.2 → 28.9 calls, lab path.

**Result.**
- 18 of 22, and 4 of 4 accidental.
- 10 more list cases pass: Arabic under Georgia, Shantell Sans and ProbeShantell.
- 4 Syriac cases remain, where the sides don't add up either way.

#### 3.3 Contextual joined forms (everything that remains)

**What the browser does.** In Amiri `بب` the glyphs are 237 and 741 au at 16px, against 182 and 848 au with U+200D.
- Canvas measures W(ب U+200D ب) = 1030 au where W(بب) = 978 au.
- So Amiri swaps both glyphs when the two letters are adjacent. No Canvas string has the first glyph in that form without the second beside it, and Canvas gives totals only.
- The same holds for:
  - lam-alef: 290 and 326 au;
  - `سلام`;
  - Noto Nastaliq Urdu.

**Why main passes.** Coincidence of width.

Where it would not pass:
- Probe M3: `aabb((بب` in 24px Amiri keeps `(ب` on one line from 12.06px up (723 au).
- The suite's 12px sits 0.05px under that.
- Main's isolated beh is 1333 au, so at 12.06 to 12.2px main gives 8 lines where native gives 7.
- The leading-invisible cases are the same near miss: 591 au against 588 au.

**The rebuild.**
- It reports `in-word-prefix` with both sums in the detail.
- Way (d).
- A supplied fact would have to be the font's contextual advances, which no application can declare.

### 4. The 14 lost cases

**The commit.** 186d45e (round 3, second snapshot, 2026-09-17 23:14).
- In a3af9f2, U+200D sides were added as a confirmation only. The stand-in was still W(unit) − W(suffix).
- In 186d45e, `suffixAu` became W(U+200D suffix), and the stand-in moved with it.
- Found by reading the four round 3 commits and comparing round 2's rows with today's.
- Not bisected in a browser: the Canvas answers of these 14 aren't recorded, and each bisect step would have been a browser job.

**Checked with probe M2 on `لألا` in 16px Amiri.**
- Round 2's recipe gives 391, 225, 408 and 208 au. These are exactly the old rows' values.
- Today's gives 339 and 396 for the lams and 220 for the second alef.
- The DOM gives 290, 326, 290 and 326 au.

**Was the old pass right for the right reason?** No.
- Round 2's per-letter advances were wrong by about 100 au.
- Each lam-alef pair summed to 616 au, which is the DOM's period, so lines of one letter came out right at 613, 582 and 576 au.
- The 4 Noto Nastaliq Urdu cases are the same kind.
- Neither recipe is right. The class is 3.3's.

### 5. Ranked for the correctness round

**1. Pair placement from rounding, with probe pairs.**
- 107 list cases. This is the only fact separating Firefox's headline configuration from its facts configuration on this list.
- FACTS-FREE attributes 304 of Firefox's 327 no-facts losses on the pooled sets to this fact.
- Control, 300 rule-family cases: line count +5, breaks +11, widths +24, 0 lost. Differing stand-in values fell from 7,213 to 5,727.
- About 70 lines in `advance.ts` and one lazily written field.
- Decide where the answer lives: on the run as now, or per declaration.

**2. U+200D font range.**
- 32 list cases in both configurations.
- 15 lines, 2 questions per failing joined cut.
- It serves Arabic under Latin-only font lists.

**3. Nothing else.** All the rest is one class that Canvas can't settle.

### 6. What stays out

115 cases, by font: 91 Amiri, 7 Noto Nastaliq Urdu, 4 Noto Naskh Arabic, 9 Arial (4 Syriac and 5 Arabic), 4 Courier New.
- All are under `in-word-prefix` with joined sides that don't add up, plus the 3 Courier New line-edge cases, which aren't traced.
- They matter only where a line breaks inside a joined word at an overflow width.

### 7. Evidence

Commits on `x-mainfacts-gecko`, listed under "branch".

**Tier 0.** `bun test rebuild`: 813 pass, 0 fail.

**Tier 1.** Exit 4 every time, with 0 predictions changed and 0 cases asking other questions. Cases asking a new question:

| State | No facts | Facts |
|---|---:|---:|
| First prototype | 5,490 | 186 |
| With the second | 7,861 | 3,010 (2,824 hold U+200C) |
| With the probe-pair step | 7,861 | 3,010 |
| With the stand-in fix | 8,294 | 3,011 |

**Browser jobs.** 12 of the 12 allowed. None failed and none was rerun.

| Jobs | What ran | Result |
|---:|---|---|
| 1 | The probe | M1 to M3 above |
| 2 | The list, both configurations, at c4eef54 | No facts +117, facts +32, 0 lost |
| 3 | No-facts control, 340 tier cases asking new questions (families, heldout-suite-sample) | 17 transitions, 0 from pass |
| 3 | Facts control, 300 cases | 6 transitions, 0 from pass; exact values 0 worse |
| 1 | The list with the probe-pair step | +17; the 2 `AVATAR` line counts found |
| 1 | Control for the probe-pair step, 300 families cases | 117 transitions, 0 from pass |
| 1 | After the fix, one file of those 300 control cases plus the list | List 653 pass, 0 lost against every earlier run; control 0 lost against the reference ledger |

### 8. Limits

- The facts configuration wasn't run in the browser at HEAD. Tier 1 shows one more facts case asking than at c4eef54.
- The last control ran as one `run.ts` job, not under the tier protocol.
- Main's failures at the constructed widths are read from its code. Only the native side was measured (M3).
- The function-set purity and sweep checks can't replay cases that ask new questions. The probe step is a function of the run's context alone by construction, with no test beyond the unit tests.
- Docs aren't synced on the branch: specs/gecko-RESULTS.md, DESIGN §5 `in-word-prefix`, FACTS-FREE's "pairKerning: No", and the comment in `font-checks.ts` that says pairKerning isn't asked.
- The rounding recipe rests on Gecko's per-glyph au rounding. It doesn't transfer to Blink or WebKit as is, and that wasn't checked.
- A GPOS font that splits a pair value over both glyphs would fit neither candidate and stay a stand-in. A supplied `first-advance` fact has the same blind spot.

### What this report couldn't settle (Gecko (Firefox))

- All 12 allowed browser jobs were used; none failed and none was rerun. No job is left for a facts-configuration run at HEAD or for running main at the constructed widths.
- The facts configuration was run in the browser at c4eef54 (the first two prototypes) and not at HEAD. Tier 1 shows the probe-pair step changes which questions one more facts case asks (3,011 against 3,010), with 0 predictions changed.
- The last control (300 rule-family cases after the stand-in fix) ran as one run.ts job together with the list, not under the tier protocol. It shows 0 lost against the reference ledger and against the tier-protocol run made before the fix.
- The probe-pair step first produced a defect. A cut that was told beside a cut left a stand-in gave the cluster between them only one pair's share, and 2 AVATAR cases went from a lucky right line count to a wrong one (their breaks already failed). Fixed in 26cc698 and both pass now. For the real fix, a stand-in must use the same placement as the told cuts beside it.
- The first version of the U+200D prototype keyed on 'U+200D changed nothing before the suffix'. A unit test modelled on Amiri's contextual meem showed that forms of equal width look the same. It was replaced before any browser run by the re-measure behind the suffix's own first letter. It stays a stand-in because probe M2 has 2 cut measurements that add up and are 3 au off.
- Where main fails at the constructed widths is read from its code (sum-graphemes; pieces around a soft hyphen measured apart for Gecko), not run. Only the native side was measured (probe M3). The probe's line-count field is wrong because the font shorthand reset the line height; the per-character line tops are the data used.
- The commit that lost the 14 cases (186d45e) was found by reading the four round 3 commits and comparing round 2's rows with today's, not by a browser bisect. Their Canvas answers aren't recorded, so an offline replay wasn't possible.
- The 742-of-849 figure for cuts that are told and correct comes from m1c.py in the scratch folder. It was not copied to the output folder's tools/ with the other scripts.
- Docs on the branch aren't synced with the prototypes: specs/gecko-RESULTS.md, the DESIGN §5 in-word-prefix row, FACTS-FREE.md's 'pairKerning: No', and the comment in src/measure/font-checks.ts that says pairKerning isn't asked. This was deliberate, since the engine folders are being restructured and nothing merges.
- The function-set purity and sweep checks weren't run on the new paths, because cases that ask new questions can't replay offline. The probe-pair answer is kept per text run, so two runs of one font ask twice.
- The triage's Firefox group names mislead. 'Zero-width content at an overflowing line' is 86 pair-kerning cases plus 20 Amiri cases. 'Punctuation after another script' is all Amiri beh-beh. 'U+202F' is about fallback-font letters after a leading U+200D. The correctness round should plan by cause.

## WebKit: WebKit: main's passing cases the rebuild fails, group by group (2026-09-19)

Browser: webkit-host, WebKit 22625.1.29.11.27, DPR 2. Worktree `~/github/pretext-rebuild-wt/mainfacts-webkit`, branch `x-mainfacts-webkit`. Output folder: `~/github/pretext-rebuild/.artifacts/session/main-facts-20260919/webkit/`. Nothing merges. No frozen reference, ledger, baseline or seed was touched.

Terms:
- A **case** is one styled paragraph at one width.
- **Pass** means the lab scorer passes both line count and breaks.
- **The list** is the 2,056-case main-only file of the refresh. 306 of its cases fail today, the same with and without font facts.
- **Pair kerning** is the adjustment a font makes between two letters, here between the two letters of a ligature once the ligature is turned off.
- **Simple path / complex path** are WebKit's two text measuring paths. A string goes to the complex path when it holds a combining mark, an Arabic letter or another character of `characterRangeCodePath`'s ranges.
- **The features-off family** is the same font declared again with `font-feature-settings: "liga" 0, "clig" 0, "dlig" 0, "hlig" 0`.

### The table

| Group | Cases (no facts / facts) | What the browser does | Why main passes | What the rebuild lacks | Way to pass, Canvas questions added | Prototype result | Confidence |
|---|---|---|---|---|---|---|---|
| 1a. Ligatures under letter spacing, simple path, Shantell thresholds | 232 / 232 (221 non-accidental) | Letter spacing turns off liga, clig, dlig, hlig and keeps kerning (StyleComputedStyleBase.cpp:318-333, UnrealizedCoreTextFont.cpp:258-264). Canvas keeps the ligatures. | Coincidence. Shantell's ligature glyphs are 1 font unit wider than their kerned parts. | The pair kerning between the separated letters. No Canvas string shows it. | (d) in the headline. (c) with a supplied features-off family: exact, 0 questions added, the counting questions go away. | none (needs the lab to declare the family) | high |
| 1b. The same in complex-path boxes | 37 / 37 (19 non-accidental) | The code path is chosen per measured string (FontCascade.cpp:304-309, :708-730; TextUtil.cpp:84-89). | Same coincidence as 1a. | A rule never ported: the port used the box's path, so it separated nothing in such boxes. | (a). 2 count questions per measured string that has such a pair, none elsewhere. | P1: 21 pass, P1+P2: 33 pass. 0 lost in 2,056 list cases and in 302 and 152 control cases. | high |
| 1c. Arabic optional ligatures | 16 / 16 (8 non-accidental) | The DOM turns off lam-lam-heh in Arial and Times New Roman and lam-alef in Courier New. It keeps Geeza Pro's (morx). | Line count by luck of isolated letter widths. 8 of 16 have wrong breaks. | Which Arabic merges are optional. U+200C there would change joining forms. | (c) the features-off family (344 of 344 ranges exact). Else (d). | none | high |
| 2. Punctuation and Latin after another script | 18 / 18 (12 non-accidental) | The process-wide break position cache hands a box the item ends of an earlier same-text box of the other direction (TextBreakingPositionCache.h:37-52, TextBreakingPositionContext.h:61-80). | History of the long document. Main breaks anywhere, which resembles the polluted layout. | Nothing. It predicts a fresh document. | none needed | Run alone: 18 of 18 pass. Main's line count matches 2 of the 21. | high |
| 3. Zero-width lines (2 native only, 1 rebuild only) | 3 / 3 (0 non-accidental) | Same cache effect, same texts as group 2. | same | nothing | none needed | Run alone: 3 of 3 pass. | high |

Counts after both prototypes: 306 becomes 273 on the list run, of which 21 are history. 252 ligature cases remain, 233 of them non-accidental. Line count failures go from 135 to 104.

### Group 2 and 3 first: they are page history

**Cases.** `c-ea243dabb9a70fe7`: `a` NUL `אבב((tail`, 24px Noto Nastaliq Urdu, rtl, 12px. Native in the list run gives `ב / ( / (`. The rebuild gives `ב((`. Main gives one character per line. `c-49feb03a06bd4b90`: `بِبِ` CR `aabb((بب`, 24px Amiri, ltr, normal, 8px. Native `b / ( / (`, rebuild `b((`. Its pre-wrap twin `c-916b09956077fc71` has native `b((`. There the rebuild passes and main fails with 10 lines against 8.

**What the browser does.** When not even the first character fits, WebKit keeps the first character and then every following character a line may not start with, and `(` is one (InlineContentBreaker.cpp:124-158, :213-229). The port follows this exactly. The different native lines come from the break position cache. It is one table per process. Its key is the text, white-space collapse kind, overflow-wrap, line-break, word-break, nbsp mode and locale. Direction and font are not in the key. An ltr paragraph splits `אבב` from `((tail`, because `((` takes level 0 there. An rtl paragraph of the same text that comes later gets those item ends. Two items of one box at the same bidi level count as a wrap opportunity, so `ב` and `((` separate.

**The order explains every case.** The lab runs the list in six page loads by font fixture: ProbeShantell, installed fonts, Shantell Sans, Amiri, Nastaliq, Naskh. For every failing case, a case with the same cache key and the other direction runs earlier in that order. Example: Amiri ltr `c-bc61ffa9de57ea00` runs before the Nastaliq and Naskh rtl cases of `a` NUL `אבב((tail`.

**Evidence.** I ran the 21 cases alone in a fresh webkit-host process (`group2-alone/`). None of them has a same-key case of the other direction among the 21. Result: 21 of 21 pass both metrics. Native line counts changed on 19 of 21, for example 11 to 9 and 10 to 8. Main's recorded line count equals the fresh native count on 2 of 21.

**Verdict.** These are history cases, like the 1,320. The rebuild already reports `page-history` there with this explanation. The triage's "punctuation after another script: a trace in `breakWord`" is settled: there is no port bug. Main's pass is an effect of the long document.

### Group 1: ligatures under letter spacing

#### What the browser does
`synchronizeLetterSpacingWithFontCascade` sets `shouldDisableLigaturesForSpacing` whenever letter spacing is not 0. Font creation then sets liga, clig, dlig and hlig to 0 and leaves calt and kerning on. The Canvas context has `letterSpacing` and `wordSpacing` only (CanvasTextDrawingStyles.idl). Setting `letterSpacing` changes the spacing, not the font description, so Canvas keeps the ligatures. This asymmetry is worth a WebKit bug report. CSS says optional ligatures should go when spacing is not zero, and Blink's Canvas does it. If WebKit fixes it, the port's context, which already sets the run's letter spacing, becomes exact with no recipe.

#### What the port does today
`measure.ts` `mergedGlyphs` counts glyphs from a total at 64px of spacing less the total at 0px. It finds the pairs that merge and measures the string with U+200C between them. On the simple path U+200C ends the shaping call (WidthIterator.cpp:318-323), so the ligature does not form. The kerning between the two letters is lost too.

#### 1a. Why the 232 threshold cases fail, and why main passes
Cases: `waffles`, `affinity`, `efficient`, `difficult`, `fleeting`, `office`, `ffiffl` in bold 16px ProbeShantell at letter spacing 1 and −4, and a few in Shantell Sans. The widths sit 1/64px around Safari's own thresholds (tests/wrapping/fixtures/ordinary.ts, "partial-advance-threshold").

The font (HarfBuzz on the fixture file, liga off): f-f +4 units, f-i +18, f-l +9. At 16px that is 0.064, 0.288 and 0.144px. Probe R1's numbers agree: `office` is 22 units narrow in the port's recipe (4+18), `ffiffl` 35, `waffles` 13.

Main (`src/layout.ts:511-519` with `src/measurement.ts` mode `segment-prefixes`) measures prefixes at spacing 0, ligatures included, and adds one spacing per grapheme. In Shantell every ligature glyph is 1 unit wider than its kerned parts: fi 728 against 403+18+306, ff 811 against 810, ffl 1167 against 1166. So main lands within 0.016 to 0.032px of the DOM. This is a property of this one font family. On R1's recorded data the same formula is off by up to 2.2 to 3.3px in Amiri, 2.7px in Hoefler Text and 2.1px in Futura. The port's recipe is exact in Amiri and Hoefler Text. Look-alike letters do not help either: f-í is −5 units and f-ı is −24, against f-i +18.

#### Can Canvas learn the pair kerning? No (probe M1, `probe-m1/`)
1,596 strings, 15 fonts, spacings 1, −1, −4, 0.5. Every prefix of `waffles`, `affinity`, `officeoffice` and `ffiffl` is in it.
- The U+200C string followed by U+034F, which forces the complex path: the same errors as without it (up to 0.704px in ProbeShantell). Core Text does not kern across U+200C there either.
- Forcing the complex path also moves strings with no ligature at all: 4 of 36 equal in ProbeShantell, up to 0.32px off. The two paths do not agree.
- U+180B before or after the string picks up a fallback glyph 13 to 19px wide.
- U+034F between the letters does not stop the ligature.

So no string puts `f` and `i` side by side, unligated, in one shaping call. In the headline this is (d). The gap `letter-spacing-ligatures` on the pair is the right report.

#### The way with one supplied fact: a features-off family (c)
A FontFace of the same font with the four features off gives Canvas the DOM's own shaping. `@font-face` features reach font creation (UnrealizedCoreTextFont.cpp, `fontFaceFeatures`). In the probe, from the fixture's bytes or from `local()` for installed fonts, Canvas in that family at the run's letter spacing equals the letter-spaced DOM bit for bit:
- on 1,274 of 1,274 strings with a ligature pair, in 15 fonts, Zapfino included;
- on every string without one that Canvas already matched;
- on 344 of 344 Arabic ranges in Times New Roman, Arial, Courier New and Geeza Pro (probe M4). Plain Canvas matches 308 of them.
- On strings the complex path measures (probe M3) it is within 0.0005px on all 117 per font in Helvetica Neue, Hoefler Text and Futura, and on 99 of 117 in the two Shantell fonts. The rest are off by up to 0.08 and 0.19px. Those misses also appear without any ligature, so they have another cause that I did not look at.

As a fact it would read: for a listed family, the name of a family the application declared with those four features off. The library measures letter-spaced WebKit boxes in it and loads nothing itself, which keeps the charter's "no font loading". It costs the application one `@font-face` rule per face, with the same source. It adds no Canvas question, and the glyph counting is no longer asked for such boxes. It stays out of the headline.

Rejected up front:
- The library creating that FontFace itself with `local()`. That is font loading, it is asynchronous, and it changes `document.fonts`.
- A connected `<canvas>` styled with letter spacing. That needs the DOM.

#### 1b. A rule that was never ported (a), two prototypes
`FontCascade::width` chooses the path from the characters of the TextRun it gets, and `TextUtil::width` hands it the measured range alone. The port asked the box: a box with a combining mark or Arabic anywhere separated nothing. So `{off` after Arabic, or `ffi` after U+2060 U+0301, was measured with its ligature. Under −4px spacing that is about 8px too wide per `ffi`. Example: `c-19d718b564ee2744`, native 4 lines, rebuild 9.

**Prototype 1** (`f976594`): separate by the measured string's path. `isComplexCodePath` moved from `content.ts` to `measure.ts`.
- `bun test rebuild` passes (812 tests).
- Tier 1: exit 4. 2 of 63,987 cases ask something new in each configuration. 0 predictions changed.
- The list in webkit-host: 21 more cases pass (17 `mixed`, 4 `cluster-v2-new`; 11 of them non-accidental). 0 lost among 2,056. Line count failures 135 to 118.
- Control: 302 tier-set cases, 200 of them letter-spaced. 0 passes lost. One unrelated page-history case moved, because a subset run has another history.

**Prototype 2** (`027969e`): inside a string the complex path measures, put U+200C between a merged pair only when the two clusters alone are simple-path text with no letter of a cursive script. The string is measured that way even when other merges stay. The gap is then also reported on the whole range.
- Probe M3: this is within the pair kerning of the DOM in 8 fonts. Equal or within 0.0005px on all 117 strings in Hoefler Text. At most 1.9px off in Shantell, where the unseparated string is up to 32px off.
- A first version used joining type alone. Tier 1's list of new questions showed that it separated a Tamil conjunct, which the DOM keeps. I tightened the rule before reading any result.
- `bun test rebuild` passes (813 tests). Tier 1: exit 4, 3 cases ask something new, 0 predictions changed.
- The list: 33 pass in total (17 `mixed`, 15 `cluster-v2-new`, 1 `long-tail-edge-falsifier`; 18 non-accidental). 0 lost. Line count failures 135 to 104.
- Control: 152 cases, 0 passes lost. `c-1d3594196ff8bfae` went from fail to pass.

**Cost.** Both prototypes ask only in letter-spaced boxes whose measured string has a merged pair: the separated string's glyph count, which is 2 questions. The separated string's width replaces the unseparated one. Paragraphs without letter spacing, or without such a pair, ask nothing new. None of this can be asked once per font declaration, because the questions are per measured string, as the existing recipe's are.

#### 1c. Arabic, 16 cases
Probe M2 (Arial 16px, spacing 1): `لله` is 15.625px in the DOM, three glyphs, and 10.859px in Canvas, one glyph. `الله` is 19.94 against 13.69. Courier New turns off lam-alef too: `لِا` is 21.2 against 10.6. Geeza Pro keeps everything, 43 of 43 equal. The rebuild's lines follow: the carried remainder `ىالله` is 11.6px for the port and 16.4px natively, so at 12px the port does not break. Canvas shows that glyphs merged, not which feature merged them. lam-alef in Arial is kept by the DOM. U+200C would change joining forms. Only the features-off family passes these. Main's pass here is luck: 8 of the 16 have the right count with wrong breaks.

### Smaller items, one line each
- 4 `cluster-v2-new` cases (`ffiffl` U+2060 U+0301 `ffiffl`, spacing −4) still fail after prototype 2. All are accidental passes of main. Not chased.
- In probe M1, Hoefler Text (1 of 16) and Avenir Next (2 of 30) strings without any ligature differ from the DOM in Canvas and in the features-off family alike. Another cause, not looked at.

### Ranked list for the correctness round
1. **Move the 21 group 2 and 3 cases to the history-dependent set.** No library change. It takes 12 cases off the non-accidental count: 263 becomes 251.
2. **Prototype 1**: about 6 changed lines plus a moved function. 21 cases. Questions only where the old code measured the wrong string.
3. **Prototype 2**: about 25 lines. 12 more cases. Same cost shape. It needs M3's verdict recorded as a probe fact.
4. **The features-off family as an optional font fact**: passes the remaining 252 (233 non-accidental), exactly, with fewer Canvas questions. It needs a fact field, the lab page declaring the families, and a facts run. It stays out of the headline.
5. **File the WebKit bug**: Canvas `letterSpacing` keeps optional ligatures, CSS `letter-spacing` does not.

### What stays out, and why
- **The 232 Shantell threshold cases in the headline.** The missing number is a kerning value hidden under a ligature. Four Canvas routes were probed and none shows it. Main's formula is not admitted. It is right only because this font's ligature glyphs equal their kerned parts, and it is 2 to 3px wrong in Amiri, Hoefler Text and Futura. The gap on the pair tells the application.
- **Arabic optional ligatures in the headline.** Same reason, plus the joining forms.
- **Group 2 and 3.** They are not failures.

### Files
- Probes: `rebuild/probes/webkit-mainfacts.ts` (M1 to M4). Results in `probe-m1/` and `probe-m3/`.
- The isolated run: `group2-alone/`, with `group2-cases.ndjson` and `group2.ids`.
- Prototype runs:
  - `p1/`: `list/`, `control/`, `tier0.log`, `tier1.log`.
  - `p2/`: `list-b/` is the final rule and `list/` the first version. Also `control/`, `tier0b.log`, `tier1b.log`.
- Tools: `compare-list.py`, `show-run.py`, `failing-by-cause.json`, `show-lsl-other.txt`, `show-other-groups.txt`.
- Row files over 1 MB are compressed.

### What this report couldn't settle (WebKit)

- All 12 browser jobs of the cap were used, counting each internal job of browser-sets.ts as one: 2 probes, the isolated run of 21 cases, 3 list runs, and 3 plus 2 control jobs. No job failed and none was run twice for a failure.
- Prototype 2's first version keyed on joining type alone and separated a Tamil conjunct, which the DOM keeps. Tier 1's list of new questions showed it before any result was read. The rule was tightened to pairs whose clusters are simple-path text. The run in p2/list/ is of the first version; p2/list-b/ is the final rule. Both gave the same 33 gained and 0 lost.
- The two new unit tests were not checked to fail without the change.
- The features-off family (the only way to pass the remaining 252 ligature cases) was probed but not prototyped. It needs the lab page to declare the families and a facts run, and the job cap was reached. It was probed through the FontFace API (bytes and local()); an @font-face CSS rule, synthesized bold or italic faces and installed Safari were not probed.
- In probe M3 the features-off family is not bit-exact on strings the complex path measures in the two Shantell fonts: 99 of 117 within 0.0005px, the rest up to 0.08 and 0.19px off. Strings without any ligature show the same misses, so the cause is elsewhere. Not investigated. On the simple path it is exact on 1,274 of 1,274.
- Shared documents were not updated, because the tree is being restructured. They are stale about the existing recipe: DESIGN.md section 5 says WebKit has no handling for letter-spacing-ligatures, and engines/webkit/checks.ts says the port has no recipe that turns ligatures off. The prototypes' rules are documented only in measure.ts comments.
- The refresh's counts change with the group 2 finding. The 21 cases pass when run without their same-text siblings, so webkit-host's decided list is 285 failures, not 306, and the non-accidental count is 251, not 263. The check's statement that today's native lines equal main's session's is true and does not contradict this, since both sessions ran the siblings first.
- Each control run shows one transition on a page-history case (c-e751685e03cb902d, fail to pass). A subset run has another history. It is unrelated to the prototypes.
- Only the 09-19 list and 302 tier-set control cases were run in the browser. Tier 1 bounds the rest offline: 0 predictions changed and 3 cases with new questions among 63,987. No both-orders run, no installed Safari, one Mac at DPR 2.
- Wall clock was close to the 3 hour cap.

## Blink (Chrome): Blink (Chrome): can the rebuild pass main's non-accidental cases, and what does it need?

Worktree `~/github/pretext-rebuild-wt/mainfacts-blink`, branch `x-mainfacts-blink` (one commit on top of 66f621a, a probe). Output folder `~/github/pretext-rebuild/.artifacts/session/main-facts-20260919/blink/`. Pinned Chrome 153.0.8010.50, DPR 2. Nothing merges. No frozen reference, ledger, baseline or seed was touched.

### Answer

- **The two large Chrome groups cannot be passed without supplied font facts inside the charter.**
  - They are ligature clusters (245) and U+2060 before spaces (54).
  - The deciding information never reaches a Canvas total. For the first it is which letters one glyph cluster covers. For the second it is which glyph of a kerned pair carries the adjustment.
  - I looked for a rule to port and for a Canvas recipe in both. I found a font in the lab's own fixtures that breaks each candidate recipe.
- **With facts, two facts do all the work.**
  - `fonts[].ligatures` (with `coverage` and `realizes`) and `pairKerning` recover 266 of the 344. That is every case the full fact table recovers.
  - No case that passes without facts is lost.
- **Main does not tackle these cases. It lands on them.**
  - Main sums isolated letter widths, which are larger than joined or kerned ones, so its lines end early at the suite's widths.
  - At other widths the same arithmetic gives lines Chrome never makes. I showed that in the browser.
  - It is fair the other way too: on three of my constructed cases main is right and the rebuild without facts is wrong.
- I built no engine prototype, because nothing sound and small exists for these groups. I committed one probe file.

Terms:
- A **case** is one styled paragraph at one width.
- **No facts** is the headline configuration. **Facts** uses the lab's font table.
- A **glyph cluster** is the set of characters HarfBuzz ties to one glyph or glyph group. Blink never puts a break candidate inside one.
- **Way to pass:**
  - (a) port a missing rule;
  - (b) learn a fact from Canvas at runtime;
  - (c) only with supplied font facts;
  - (d) not knowable.

### Table

| Group | Cases (no facts / facts) | What the browser does | Why main passes | What the rebuild lacks | Way, and Canvas questions added | Prototype | Confidence |
|---|---|---|---|---|---|---|---|
| Ligature clusters at an overflow break | 245 / 44 | The break candidate never lands inside a glyph cluster (`CachedOffsetForPosition`, shaping_line_breaker.cc:326-329; shape_result.cc:684-694). A ligature merges clusters (hb-ot-layout-gsubgpos.hh:1500-1510). | Coincidence: the grapheme sum of isolated forms | Which sequences a font ligates. Reports `glyph-clusters`. | (c) `fonts[].ligatures` + `coverage` + `realizes`: 201. (d) for the 44 drawn by the system fallback. 0 questions. | None. A recipe would guess (evidence below). | High |
| U+2060 before spaces | 54 / 0 | Times New Roman's legacy kern table splits the A-space adjustment: kern >> 1 on the first glyph (hb-kern.hh:102-106). `A` is 12.498px in the paragraph, which is wider than 12. | Coincidence: `A` alone (12.999) also overflows 12 | Which glyph carries a pair adjustment. Reports `unsafe-to-break`. | (c) `pairKerning`: 52. The other 2 need the ligature fact. 0 questions. | None. A partial Canvas check exists but answers for Helvetica, Times and Hoefler Text only, not for Times New Roman. | High |
| U+FFFC measured by Canvas as U+200B | 14 / 14 | The DOM draws a glyph (16px in Arial, 9.63px in Amiri and Noto Naskh at 16px). Canvas replaces U+FFFC with U+200B before shaping (plain_text_node.cc:54-59). | Coincidence: main measures 0 too and gives a leading zero-width segment its own line | The advance, which no Canvas string can hold. Reports `font-fallback`. | (d) | None | High |
| Latin kerning and ligatures at an overflow break | 12 / 1 | Same two mechanisms in Latin text (`VAWAVAV`, `1111{{tail`, `ffiffl`) | Coincidence: isolated sums | The same two facts | (c): `pairKerning` 7, ligatures 4. 1 open (`1111({tail`, Shantell Sans, letter spacing −1), not traced. | None | Medium |
| Joined letters at an overflow break | 10 / 10 | Offsets inside a ligature share its advance, so the candidate stays at the line start and the line overflows by one grapheme | Trivially: every letter overflows | Cluster knowledge. The port's stand-in positions run backwards at an unknown ligature. | (c) needs a sharper fact. A port-side guard, way (a), might fix 5. 0 questions. | None (no time to prove it safe) | Medium |
| Punctuation and Latin after another script | 5 / 5 | Common punctuation is shaped under the surrounding script (harfbuzz_shaper.cc:1072-1101) | Not checked | `script-context` | Not traced | None | Low |
| Emoji before `))` in Amiri | 2 / 2 | — | — | `script-context` | Not traced | — | — |
| Joined letters at a line edge (`صلىالله`, Shantell Sans, letter spacing 1) | 2 / 2 | Drawn by the Geeza Pro fallback | — | Fallback font's clusters | (d) | — | — |

### Details per group

#### 1. Ligature clusters at an overflow break (245 / 44)

Fonts:
- Arial 126, Times New Roman 57, Courier New 5.
- Shantell Sans 46 and Georgia 4. Their Arabic is drawn by a system fallback.
- ProbeShantell 7 (Latin).

Texts are mostly lam-alef words: `بِلا`, `بلاب`, `لألالإلآ`, `سلامسلام`. 191 fail on breaks only and 54 on line count.

**What the browser does.**
- Blink finds the last offset that fits from the paragraph's glyph positions, then takes the break opportunity at or before it (shaping_line_breaker.cc:326-329, :397-400). A position inside a cluster maps to the cluster's start, so where a prefix fits, the line ends before the ligature.
- Only when the line's first cluster doesn't fit does Blink take the next grapheme boundary, even inside a ligature (`is_overflow`, :402-409), and reshape.
- Probe M1 shows that: `لالا` at 1px is 4 lines in all nine families, Arial included.
- Cases:
  - `c-00520dd17f45f4f9`: `بِلا`, 32px Arial, letter spacing 1, 24.07px. Native `بِ / لا`, rebuild `بِل / ا`, main as native.
  - `c-462205995540ef8c`: `لألالإلآ`, 16px Arial, 34.75px. Native `لألالإ / لآ`, rebuild `لألالإل / آ`.
  - `c-da9b68831cca13b8`: `صلاةالسلام`, Times New Roman. Native `ص / لاةا / لس / لام`, rebuild `صل / اةال / سلا / م`.
  - `c-a15cb752c3e240e5`: `سلامسلام`, Shantell Sans. It fails with facts too.

**Why main passes: coincidence.**
- At letter spacing 0 main sums graphemes measured alone (`src/layout.ts:510-518`, `src/measurement.ts:418-426`). Under letter spacing it takes prefix differences. It has no notion of a cluster.
- Isolated Arabic forms are wide, so the line ends before lam at the suite's widths.
- Counter-examples, run in the browser with main's predictor (`constructed/`):
  - `لالا`, 32px Arial, at 18, 20 and 22px: native `لا / لا`, main 4 lines.
  - `بلاب`, 32px Arial, at 20 and 22px: native `ب / لا / ب`, main 4 lines.
  - `بِلا`, 32px Arial, letter spacing 1, at 28 and 30px: native 1 line, main 2. Blink gives cursive scripts no letter spacing (shape_result.cc:977-990, shape_result_spacing.cc:118-130), and main adds it.
- Fair the other way: main is right on `بلاب` in Arial at 24 and 26px and on `بِلا` at 26px, where the rebuild without facts is wrong.
- Over my 20 constructed cases, which I chose and which are not a sample, main matches native on 7 and the rebuild without facts on 12.

**Why the rebuild fails.**
- Without facts every grapheme start is a cluster boundary (`shape.ts` `isClusterBoundary`, `ligatures.ts` `LIGATURE_UNKNOWN`).
- It reports `glyph-clusters`: "a chosen line edge between joining letters: a font's ligature may cover letters on both sides".
- What is missing is a fact about the font.

**Does it need facts? Yes.**
- I ran filtered-facts predictors over all 1,194 cases, predict-only, scored against one recorded run (`ablation/`).
  - Ligature facts alone recover 201 of 245.
  - `pairKerning` alone recovers 0.
  - Both together recover 201.
  - 0 of the 728 cases that pass without facts are lost.
- The 44 left are Shantell Sans 40 and Georgia 4. Their Arabic has Geeza Pro's Canvas totals to the unit (probe M1), and the facts model doesn't describe the engine's fallback.
- An application could list `"Geeza Pro"` itself and give its facts. I didn't test that.

**Why no Canvas recipe (b).**
- Blink adds letter spacing once per glyph cluster (shape_result.cc:1006-1024), which would count clusters exactly.
  - It skips cursive-script runs (`IgnoreLetterSpacingInCursiveScripts` is stable, runtime_enabled_features.json5:3593).
  - Any non-zero spacing turns liga, clig and calt off (font_features.cc:54-86), so it can't count Latin `liga` ligatures at spacing 0 either.
  - `getTextClusters` is still off by default (json5:2745-2749).
- The best width test is lam, alef against lam, U+200D, alef. Arabic's ligating features run with manual ZWJ (hb-ot-shaper-arabic.cc:209-231), so U+200D keeps the joined forms and stops a ligature.
- Offline with HarfBuzz, over every joining pair of 50 to 55 letters, alone and between beh (`tools/zwj-study.py`, `zwj-study.ndjson`):
  - Arial, Times New Roman, Courier New: exact. 10 merged pairs found, 0 wrong of 3,224.
  - SF Arabic: 23 of 24.
  - Geeza Pro: blind on isolated lam-alef. The ligature is as wide as its parts.
  - Noto Naskh Arabic: **wrong**. It fires on exactly the 10 lam-alef pairs, which that font draws as two glyphs in two clusters (`uni0644.init.rlig` and `uni0627.fina.rlig`).
  - Wrong elsewhere too: Amiri 1,105 of 4,104 pairs, Noto Nastaliq Urdu 1,699, Al Nile 2,526, Al Bayan 2,701.
- Chrome's Canvas gives the same signatures (probe M1, 32px, 1/65536 px):
  - Arial: 1,140,736 against 915,456.
  - Noto Naskh Arabic: 1,086,324 against 975,175.
  - Geeza Pro: 1,101,668 against 1,101,667.
- Natively the two kinds differ. `بلاب` at 32px and 20 to 26px is `ب / لا / ب` in Arial and `بل / ا / ب` in Noto Naskh Arabic (`constructed/`, native rows).
- So a recipe would break Noto Naskh Arabic and Amiri to fix Arial. That is a guess.

**Cost.**
- 0 added questions.
- With facts the port asks fewer questions. Example: 194 against 117 calls on `c-002c9461ceb042e1`.

#### 2. U+2060 before spaces (54 / 0)

Shape:
- 52 of the 54 are one shape: `A` U+2060 space(s) or TAB, then more, in 18px Times New Roman at 12px.
- The other 2 are `a` NUL `لا((tail` in Arial, which need the ligature fact.

**What the browser does.**
- Times New Roman's GPOS has only `mark` and `mkmk`, so HarfBuzz applies the legacy `kern` table (hb-ot-shape.cc:150-185).
- The pair machine skips U+2060 and splits the A-space kern of −113 units: −57 on `A` and −56 on the space (hb-kern.hh:102-106). Offline hb-shape gives `A` 1422 units.
- So `A` is 12.498px in the paragraph, 12.999 alone, and 12.006 if the whole adjustment sat on it.
- Probe M2: `A` U+2060 space `B` is 3 lines up to 12.49px and 2 lines from 12.5px.
- At 12px `A` overflows, the break goes to the next grapheme boundary, and U+2060 with the space makes a zero-width line.

**Why main passes: coincidence.**
- Main measures `A` alone, which also exceeds 12.
- In the browser main gives 3 lines at 12.7 and 12.9px, where native gives 2.

**Why the rebuild fails.**
- `pairKerning` is unknown, and its documented default puts the whole adjustment on the first glyph.
- `A` is then 1537 LayoutUnits against 1536 + 1, so it fits. The rebuild reports `unsafe-to-break`.
- On my constructed cases the rebuild is wrong at 12 and 12.3px and right from 12.7px.

**Does it need facts? Yes.**
- `pairKerning` alone recovers 52, the ligature facts 2, and both together 54.

**Why no Canvas recipe.**
- The kern machine adds the second share to the second glyph's advance and to its offset. Every pen position after the pair and every ink position then equals GPOS's. No total or ink box can differ.
- I tried one indirect check (probe M3).
  - Rule: Blink's Canvas shapes word by word exactly when the space glyph is in no GPOS and no GSUB lookup (font_fallback_list.cc:264-276, harfbuzz_face.cc:322-390).
  - So if a letter kerns with U+2028 but not with U+0020, the kern is the legacy table's.
  - It answers "split" for Helvetica, Times and Hoefler Text, 3 of 22 families. The table agrees.
  - It can't answer for Times New Roman. Its GSUB `ccmp` lookup 5 holds the space glyph, so Canvas shapes it whole.
- The check's other limits:
  - It needs strong letters only, because `.` with U+2028 changes script in Amiri and Noto Naskh Arabic.
  - It can't see state-machine kern formats: on this Mac, 6 faces with kern format 1, 9 with kerx 1 and 4, and 4 with kerx 4.
  - It costs about 12 questions per declaration.
- It passes 0 of this group, so I didn't build it.

#### 3. U+FFFC (14 / 14)

- Canvas can never measure it: `TreatAsZeroWidthSpaceInComplexScriptLegacy` turns it into U+200B (plain_text_node.cc:54-59, text/character.h:167-175). The DOM draws a fallback glyph.
- Main believes the width is 0 as well. 44 sibling cases are already filed as accidental.
- Way (d). `font-fallback` already says "U+FFFC in text: Canvas measures it as U+200B".
- A stand-in such as U+FFFD is another glyph and would be a guess.

#### 4. Latin kerning and ligatures (12 / 1)

- The same two facts recover 11.
- What is left is `c-8c84627af834611f` (`1111({tail`, Shantell Sans, letter spacing −1). I didn't trace it.

#### 5. Joined letters at an overflow break (10 / 10)

- **`صلىالله`, 16px Courier New, at 8, 9.55 and 1px (3 cases).**
  - Offline the word is 5 glyphs. The last covers lam-lam-heh, 48.0px in total.
  - The port's prefix positions are 5, 6, then 5 cells, so the binary search (`offsetForPosition`) lands at the end and keeps `له`.
  - Natively the shared advance keeps the candidate at the start.
  - The facts list `لله` as forming in some contexts only, so facts don't settle it.
- **`للله` in the Geeza Pro fallback (2 cases).** The same mechanism.
- **A port-side guard, way (a).**
  - A guard exists already for positions that run backwards in the reshape loop (`line-breaker.ts:745-760`).
  - There is none before the early return at `candidate >= rangeEnd` (`:690`).
  - It adds 0 questions and may be worth up to 5 cases.
  - I didn't build it: it touches a function every wrapped line uses, and I had no time for tier 1 and a browser run.
- **CR or FF before `ب` SHY `ب` in Amiri at 3px (4 cases), and one Nastaliq case.** Not traced.

#### 6. Punctuation after another script (5 / 5), and the two pairs

- Not traced. They fail with the `scriptLookups` fact too.

### The accidental classes: is any mis-filed?

- **Right count, wrong breaks (98 / 76).**
  - Correctly filed. I opened four, and main's visible breaks differ from native in each.
  - By cause they are the groups above: U+FFFC 44, ligature 24, joined 19, script 9.
  - They move with the same facts: 22 of the 24 ligature cases pass with facts.
- **Zero-width characters elsewhere (24 / 20).**
  - Correctly filed for main.
  - 20 of them are `ب` SHY kasra `ب` in Noto Nastaliq Urdu at 1px or less. Natively SHY and the kasra share a line. The rebuild splits them, in both configurations.
  - That miss is the rebuild's own and doesn't depend on main. It looks like a port issue, not a fact. Untraced. My guess is that the lone mark measures wide in Canvas.
- **Main's history (9) and opinions (2).** All pass now.

### Ranked list for the correctness round

1. **Build nothing for the two big groups.**
   - Write the evidence into DESIGN §5 and CHARTER "Facts no check answers", so nobody tries the U+200D test again. Lam-alef is one cluster in Arial and two in Noto Naskh Arabic, with the same Canvas signature.
   - Say that the headline can't pass these 299 cases, and that two facts pass 255 of them.
2. **Trace SHY plus mark kept on one line.** 20 cases, both configurations, no questions added, a likely port fix.
3. **Try a guard for positions that run backwards before the `candidate >= rangeEnd` return.** Up to 5 cases, 0 questions. It needs tier 1 and a control run.
4. **Optional, only if a font resolver that outlives a paragraph lands.** The word-by-word check for `pairKerning`. It answers for Helvetica, Times and Hoefler Text, costs about 12 questions per declaration, and yields 0 of these cases.

### What stays out, and why

- **Ligature clusters and `pairKerning` without facts.** Not visible in any Canvas total. Gaps: `glyph-clusters`, `unsafe-to-break`.
- **Text drawn by the system fallback (44 + 2 + 2 cases).** The facts model doesn't name the fallback font.
- **U+FFFC (14).** Canvas replaces the character.
- **Script-context and the small pairs (9).** Untraced.

### Runs and files

- **Browser jobs.** 10 lock acquisitions:
  - 1 recorded run;
  - 3 filtered-facts runs;
  - 2 probe runs;
  - 2 constructed-case runs;
  - 2 that failed at bundling before any browser launched. My zsh loop passed an empty predictor path. I fixed it and ran each once.
- `bun test rebuild`: 811 pass. Tier 1 was not needed: no library file changed.
- **Commit.** 8bf789e, `rebuild/probes/blink-mainfacts.ts`.
- **Output folder:**
  - `rec-nofacts/`: rows and Canvas record of all 1,194 cases;
  - `ablation/`;
  - `probe2/chrome-probes.json`. `probe1`'s DOM lines are wrong: my font shorthand reset the line height. Its Canvas numbers are fine;
  - `constructed/`;
  - `zwj-study.ndjson`;
  - `tools/`. `tools/show.py <id>` prints a case side by side.
- Row files are compressed.

### What this report couldn't settle (Blink (Chrome))

- No engine prototype was built. For the two large groups I found no rule to port and no sound Canvas recipe. Noto Naskh Arabic and Amiri break the U+200D ligature test. Times New Roman defeats the word-by-word kerning check, because its GSUB ccmp lookup holds the space glyph. The job's prototype evidence (tier 1, a group plus control browser run) therefore does not exist. The evidence is the filtered-facts runs, the offline HarfBuzz study, two probes and the constructed cases.
- Two browser-lock jobs failed at bundling before any browser launched. A zsh loop of mine did not split its words, so the predictor path was empty. I read the log, removed the two misnamed empty output folders (my own, under my output folder), and ran the two corrected jobs once each. Both passed. In total 10 lock acquisitions ran, 8 of them with a browser, under the cap of 12.
- The first probe run (probe1) has wrong DOM line data. My helper wrote the font shorthand after line-height, which reset it. Its Canvas numbers are valid. probe2 is the corrected run and is the one to read.
- A scratch script (tools/zwj-study.py) first came out with a literal U+200D where I wrote an escape, which is the known tool caveat. I replaced it with chr(0x200D) and ran the study again. The tracked probe file builds its characters with String.fromCodePoint. I checked it for NUL and for literal U+200D, U+2060, U+2028 and U+FEFF: none.
- The port-side guard for positions that run backwards (up to 5 cases: `صلىالله` in Courier New, `للله` in the Geeza Pro fallback) is a reading of the code and of offline HarfBuzz output. It is not a tested change.
- The SHY plus kasra miss is untraced. It covers 20 cases filed under main's accidental zero-width class, and the rebuild splits SHY from the mark in both configurations. My guess that Canvas gives the lone mark a width is unverified.
- Main's side on the constructed cases ran this worktree's copy of main's library (rebuild/lab/baselines/main-predictor.ts), not main's recorded rows. The 20 constructed cases were chosen to find where each side's reasoning breaks, so they are not a sample.
- An application that lists the fallback family itself (for example "Shantell Sans", "Geeza Pro") and supplies its facts should reach the 44 ligature cases still failing with facts. I reasoned that from probe M1 (Shantell Sans's Arabic has Geeza Pro's Canvas totals exactly) and did not test it.
- Not traced: punctuation after another script (5), emoji before `))` in Amiri (2), CR or FF before `ب` SHY `ب` in Amiri at 3px (4), and the one Latin case left with facts (c-8c84627af834611f).
- Wall clock was about 2 hours 50 minutes of the 3 hour cap.

