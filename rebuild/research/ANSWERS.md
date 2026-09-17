# Answers: the rebuild against the brief and against main

> **Since then (2026-09-17).** This document describes the library before the charter. Branch `rebuild-charter` has
> since been merged (7c3fcf9): engines return their own geometry, the lab compares exact Range rects through ported
> observation rules (scorer 2), score choices and name keys became font facts or source conditions, and the rebuild has
> its own tests and gate. Current numbers: rebuild/REPORT.md §2-§7. Main's regressions re-observed with the charter
> library and triaged into facts to learn, accidental passes and dropped opinions: research/MAIN-TRIAGE.md. Remaining
> deviations: rebuild/CHARTER.md "Known deviations" and research/CHARTER-CRITIC.md.


Branch `rebuild-20260916` at 84b4f19. `rebuild/src` is tree ecdef04b, the same tree at cb9cadb and c72550a, and every run cited here used it. Paths are relative to `~/github/pretext-rebuild`.

This describes that library only. Branch `rebuild-charter` (49ab636, plus uncommitted edits to CHARTER.md and REPORT.md in `~/github/pretext-rebuild-charter`) has since replaced S1-S4 and H1-H3 (§1.4) with engine geometry, observation ports and font facts. None of its numbers are used here.

Terms:
- **Main-only:** main passes a metric and the rebuild doesn't. **Rebuild-only** is the reverse.
- **Page history:** the browser, or main's own Canvas, gives a different answer depending on what the page laid out or measured earlier.

## Verdict

The rebuild took the brief seriously where engine code can be ported.
- **Checked against the engines.** Break data and bidi match engine libraries or oracles built on the engines' data:
  - Gecko's break scan agrees with an ICU4X oracle rebuilt on Firefox 156's data on 5,060,059 positions and differs on 401.
  - WebKit's break classifier matches data dumped from the engine on all 131,072 lookups.
  - ubidi shows 0 differences from icu4c and libicucore over 770,241 BidiTest runs.
- **The line loops follow the source function by function.** That covers their control flow. The widths they consume come from Canvas recipes, and some of those recipes were chosen by score or contain bugs found later (§1.2).
- **No cheap shortcuts.** No code is keyed on case ids, there are no DOM width reads, and the only fit epsilons are the engines' own.

The shortcuts sit in three places, and they flatter the MVP numbers:
1. **The public `width` copies the lab scorer's visibility rules, in each engine.** So part of the widths metric checks the library against itself.
2. **Rules picked by score or by name.** 11 rules were chosen by lab score, and 25 are name keys or uncited heuristics (rebuild/research/RULES.md).
3. **Gap reports are too broad to find failures.** At least one gap fires on 83% of Chrome census cases, and real bugs hid under them.

It will slip structurally on what the lab never exercises: per-span styles, inline box sizes, text-indent, text-align, `<br>`, and prepare once at many widths.

**Against main on main's full suite** (238,524 cases), line counts pass on:

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| Rebuild | 98.68% | 99.63% | 98.61% |
| Main | 73.86% | 80.16% | 76.07% |

- **Main's real wins.** After removing page history and one observation problem, main still wins 1,446 Chrome cases (0.61%), 815 Firefox cases (0.34%) and 735 webkit-host cases (0.31%). In webkit-host, 44 more cases are main-only in one of the two fresh documents.
- **Required cases.** One case main's suite requires regresses in Chrome and one in Firefox. Both have a known cause and a fix that has been run.
- **Superset.** A strict correctness superset isn't reachable with measureText alone, and shouldn't be the goal.
  - With the source fixes and explicit font-fact inputs, main's remaining wins would be about 387 in Chrome and 199 in Firefox.
  - In webkit-host they'd be 721 to 725 without a styled canvas, and 0 to 4 with one.
  - Most of main's remaining wins come from measuring graphemes in isolation, which loses many times more cases in the same families.

## 1. Shortcuts

### 1.1 The cheap-shortcut checks

| Check | Result | Evidence |
|---|---|---|
| Code keyed on lab case ids | 0 | 3 ids in non-test `rebuild/src`, all comments citing evidence rows: `engines/blink/content.ts:40`, `engines/gecko/lines.ts:608`, `:612`. The two Gecko ids sit inside the width code copied from the lab. |
| DOM geometry reads | 0 | grep for `getBoundingClientRect`, `getClientRects`, `offsetWidth`, `clientWidth`, `getComputedStyle` over `rebuild/src` |
| Tolerances not in engine source | 0 | grep of non-test `rebuild/src` for `epsilon`, `1e-N` and `Math.abs`: one hit, the comment "no 1/64 epsilon here" (`webkit/lines.ts:1209`). Blink `LayoutUnit::AddEpsilon` (line_breaker.h:309); WebKit `+1/64` only where source adds it (`webkit/lines.ts:802`, `:1269`); Gecko integer app units |

Rule catalogue: 399 rules, instrumented over every lab set (rebuild/research/RULES.md "Counts").

| | Blink | WebKit | Gecko | shared | all |
|---|---:|---:|---:|---:|---:|
| ported from source | 100 | 99 | 77 | 9 | 285 |
| Canvas recipe (a stand-in for something the DOM computes) | 17 | 3 | 11 | 14 | 45 |
| gap condition | 16 | 10 | 7 | 0 | 33 |
| chosen by lab score | 3 | 4 | 3 | 1 | 11 |
| heuristic or name key | 8 | 9 | 5 | 3 | 25 |
| with a probe | 65 | 57 | 57 | 6 | 185 |
| with a bun test that states the rule | 35 | 20 | 53 | 9 | 117 |
| no probe, no test, no lab case | 3 | 7 | 4 | 0 | 14 |

150 rules have only lab rows as evidence. No bun test even reaches WebKit's `lines`, `breaker`, `tos`, `ilb` and `output` rule areas (RULES.md "Main findings" item 4).

### 1.2 Ported faithfully, and what "faithful" covers

- **Blink** (rebuild/research/blink-shortcut-audit.md §2):
  - 18 table rows, about 26 functions, compared with Chromium 153. They include `HandleText`, `BreakText`, `HandleOverflow`, `ShapeLine`, `LazyLineBreakIterator`, all 49 break-all table rows, the fit test, HanKerning context and tab widths.
  - What looked like omissions are the 153 defaults: `IsOtherSpaceSeparator` is U+3000 only, `text-autospace` is off, and `text-spacing-trim: normal` never trims line starts.
  - **What the label doesn't cover.** Two of the faithful rows, `ShapeLine` and `offsetForPosition`, take positions from `shape.ts`. The superset run later found the continuation-cluster bug in exactly those inputs (`shape.ts:322`, `:390`, `:527`; 226 Chrome main-only cases). They also shape joining letters under the score-chosen constant S2. Their control flow is faithful; their inputs aren't.
- **WebKit** (webkit-shortcut-audit.md §1, §3):
  - `BreakablePositions` against dumped data: 131,072 lookups and 1,547 pairs.
  - libicucore tables with Apple's overrides.
  - All three line builders, `InlineContentBreaker` and the carried width, checked at the pinned lines.
  - 95 of 144 top-level functions cite source.
  - **What the label doesn't cover.** The carried width is applied as the source applies it, but to Canvas widths that keep ligatures under letter spacing (721 webkit-host cases, SUPERSET-webkit §3.3). `lines.ts` also holds S1.
- **Gecko** (gecko-shortcut-audit.md §0, §1):
  - TransformText, nsLineBreaker and ICU4X. The oracle replay agrees on 5,060,059 positions and differs on 401: 400 from one likely-subtags bug and 1 from bun's segmenter.
  - For text-only paragraphs, the control flow of BreakAndMeasureText, ReflowText, CanPlaceFrame and TrimTrailingWhiteSpaceIn shows no deviation.
  - **What the label doesn't cover.**
    - The advances that scan sums come from `glyphBefore` (`lines.ts:20-57`). Its branch for joined letters is the score-chosen recipe S3.
    - The catalogue marks "InitTextRun script runs" (P9/P11, `prepare.ts:444-460`, `:507-526`) as faithful. But the unit loop measures across script runs (`prepare.ts:846-850`), which Gecko never does (gfxTextRun.cpp:2779-2809; bug C, 22 Firefox cases).
    - Bugs B (`prepare.ts:762-766`) and D (`lines.ts:56`) sit in the same measurement layer.
- **Shared:**
  - ubidi is checked against icu4c and libicucore.
  - The crate bidi port (`unicode/unicode-bidi.ts`, used for Gecko) is checked against BidiTest 17.0.0, not against Firefox. The crate itself disagrees with ICU on 130,661 of 300,000 fuzz strings (REPORT.md:57).
  - Graphemes are checked against GraphemeBreakTest.
  - Gecko's property test checks icu_properties 2.1.2 but not Emoji_Presentation, Emoji_Modifier or Joining_Type, and Joining_Type drives S3 (gecko audit §7).
- **HarfBuzz isn't pinned.** The `chromium-153.0.8010.48` checkout has no `third_party/harfbuzz`, and `firefox-156.0` has no `gfx/harfbuzz`. So the cluster and kerning mechanisms both superset analyses rely on (hb-ot-shape.cc, hb-kern.hh:102-106) are cited from Chromium 152's copy.

### 1.3 Principled recipes, and how thin each is

| Recipe | Backing | Weak point |
|---|---|---|
| Blink: U+2028 in place of spaces in Canvas strings (`shape.ts:216`) | harfbuzz_face.cc:110-113, plain_text_node.cc:84-91 | one probe string in 4 fonts; no spec records the verdict |
| Blink: U+2060 in place of ignorables (`shape.ts:214-215`) | character.h:167-175 | 27 of 29 probe strings equal |
| Blink: glyph positions from pair adjustments `R(xy) − R(x) − R(y)` (`shape.ts:304-323`) | blink-gaps §3.4-3.6 | the safe-to-break test is necessary, not sufficient, and it uses grapheme starts where Blink uses HarfBuzz clusters (226 cases, §2.3) |
| WebKit: CR measured as U+0000, VT and FF as U+0001 (`measure.ts:15-25`) | probes webkit-canvas H8, H10 | CR is assumed zero width; 3 Times New Roman kerning losses (§2.3) |
| WebKit: dictionary breaks through JSC `Intl.Segmenter` (`breaks.ts:87-139`) | libicucore comparison | 27 of 282,337 positions differ |
| Gecko: in-word advance `W(unit) − W(suffix)` (`lines.ts:20-57`) | GPOS pair adjustments land on the left glyph | wrong for legacy `kern` tables, ligatures, joining and reversed runs (§2.3) |
| Gecko: 7-bit Canvas and 10-bit Servo size quantization; sbix emoji at device size (`prepare.ts:38-50`, `:853-919`) | source + probes gecko-canvas H3b, gecko-port F3 | the emoji detection is keyed on a family literal |

### 1.4 Choices by score, name keys and heuristics

| # | Where | What it does | Evidence against it |
|---|---|---|---|
| S1 | Blink `engines/blink/index.ts:289-396`; WebKit `engines/webkit/lines.ts:1489-1565`; Gecko `engines/gecko/lines.ts:605-744`, `:485-507`, `:751-761` | `width` is "the extent the lab observes" (DESIGN.md:184), with the scorer's visibility rules copied in. WebKit ships a Default_Ignorable table only for this (`tools/gen-webkit-data.ts:85`). | Blink drops U+2000..U+200A from width although Blink counts them in the line (character.h:156-158): 1,182 cases, 738 of them widths unobserved, because the scorer refuses the same lines. Gecko: width isn't the line box on 732 of 67,586 development suite-sample lines, and TAB is marked hanging 142 times though Gecko hangs only U+0020 and U+3000. It causes 41 main-only losses: Chrome 16, Firefox 15, webkit-host 10. |
| S2 | Blink `engines/blink/shape.ts:108` `JOINING_CONTEXT = 'opentype'` | one global joining model; the comment gives the lab counts it was picked by | 317 of 328 Geeza Pro group-edge cases fail; 261 Chrome main-only cases (superset cause G) |
| S3 | Gecko `engines/gecko/lines.ts:42-46` | U+200D before the suffix at in-word breaks, kept after rounds r7 (+326/−16) and r8 (+20/−7) with no source reason | probe A2: predicted 590 au, native 504 au. Gecko's largest failure class: development widths in `suite/U+200C`, `U+2060` and `U+FEFF` 64 cases each, `U+200D` 26 |
| S4 | WebKit `engines/webkit/content.ts:437-501` | gap conditions reshaped to lab counts (`canvas-language` narrowed from 12,329 to 3,623 reports; `simplified-measuring` grid rule) | still weak; of 510 WebKit prediction failures, 417 report only weak gaps |
| S5 | Gecko `engines/gecko/lines.ts:632-662` | Range-rect rules fit from rows `c-3b2e9519e5b651d4`, `c-4aafc349e1c161fd`, `c-79e5272a2644d9b8` | scorer edits flipped engine results (gecko audit §4 D2) |
| S6 | Blink `engines/blink/shape.ts:223-235` | leave ignorables out where the Canvas string would stay 8-bit. RULES.md classes this as a heuristic; the Blink audit files it as D2. | fit to 29 probe strings; RLM before `((` in Amiri is unexplained |
| S7 | Blink `output/joins-next-line-opentype` (RULES.md:418) | `joinsNextLine` under the same OpenType joining assumption | 57% of the lab cases it reaches fail a prediction metric |
| S8 | painter R7 `zwj-at-joined-line-edges` (`paint.ts:204-206`) | U+200D on both sides of a joined line edge, in every engine | painter probe 5 hasn't run; Firefox rows contradict R7 at narrow widths (PAINTER-RESULTS.md:125) |
| H1 | WebKit `engines/webkit/content.ts:176` `FIXED_PITCH_FAMILIES` | fixed pitch by 10 family names; only 2 appear in any lab case | `font-family: monospace` resolves to Courier (SettingsBaseCocoa.mm:62) and silently gets neither the shortcut nor a gap |
| H2 | WebKit `measure.ts:33-36`; Blink `shape.ts:620-631` | hyphen glyph: WebKit always measures U+2010; Blink compares `family, "Courier New"` with `family, Georgia` | webkit-gaps §3.3 already gives a Canvas test (12,145 gap reports). Blink's test is wrong for lists of several families and never reports a gap. |
| H3 | Blink `shape.ts:63` `measuresAtCssSize`; Gecko `prepare.ts:544` `OPTICAL_SIZE_FAMILIES` | optical sizing keyed on system-ui names | the engines apply `opsz` to any font with that axis; 0 lab cases use these names |
| H4 | Gecko `prepare.ts:853-919` (literal at `:863`) | an `"Apple Color Emoji"` literal | the detection is always true when the run's own family is Apple Color Emoji: 24 main-only cases (superset cause E) |
| H5 | Gecko `linebreak.ts:346-358`; `prepare.ts:539-540` | likely-subtags approximation; raw family-string comparison | 400 fuzz positions (yue, wuu, und-TW); `Arial` against `"Arial"` ends a text run that Gecko continues |
| H6 | Blink `shape.ts:223`, `:238-239` | V8 string storage rules | no V8 citation; V8 isn't in the 153 checkout |

The charter lists S1-S4 and H1-H3 as deviations to remove (CHARTER.md "Known deviations to remove"). REPORT §7 item 2 still recommends keeping S2, which contradicts tentpole 3.

### 1.5 Why the MVP numbers look better than the structure

1. **Widths partly pass by definition** (S1). Where the prediction and the scorer drop the same characters, the lab reports unobserved instead of failed. Example: 738 of the 1,182 Chrome lab cases holding U+2000..U+200A, U+1680 or U+205F have widths unobserved (blink audit D3).
2. **The lab doesn't exercise the simplified model.** No case uses:
   - per-span `white-space` or `word-break`;
   - span padding, text-indent or text-align;
   - `<br>`;
   - system-ui, generic `monospace` or fractional sizes.

   So the block-level style reads never show: Blink reads the block's settings at 12 sites, and WebKit reads `p.style` 50 times.
3. **Gap reports don't find failures.**
   - Census rows report at least one gap on:
     - 198,074 of 238,518 Chrome cases (83%);
     - 73,020 of 238,412 Firefox cases (31%);
     - 185,749 of 238,457 webkit-host cases (78%).
   - Blink's `in-word-prefix` fires on 22,718 of 40,703 lab cases. Its lift is 1.1: its share of failing cases divided by its share of all-pass cases, so 1 means it doesn't pick out failures.
   - The superset runs found real bugs hidden this way. In Firefox, 36 bugs report a gap at the right offset for the wrong reason, 48 report an unrelated gap, and 55 report none. Chrome's largest bug, 226 cases of continuation clusters, sat under broad gaps.
4. **History-dependent cases are left out of REPORT's tables** (REPORT.md:29) and never fail the gate.
   - The census observed every case once and reran only main-only cases.
   - In webkit-host, 1,340 of 2,056 census main-only cases lay out differently in a fresh document.
   - Nobody rechecked the rebuild-only counts for the same effect.

### 1.6 Where it will slip structurally

| Feature | Blink | WebKit | Gecko |
|---|---|---|---|
| Per-span wrap styles | block settings at 12 sites (`index.ts:18-51`, `line-breaker.ts:114-123`) | 50 reads of the block style (`style.ts:5-28`); the source reads item, parent, ancestor or root style | style subset not per run (`prepare.ts:688-691`, `:727-728`) |
| Span padding, border, margin | tags add no size (`line-breaker.ts:672-702`); shaping groups ignore box edges | inline boxes have zero width (`lines.ts:244-249`) | one scalar available width, no per-span line state (`lines.ts:394-428`); probe H12b shows padding changes lines. **Rework, not a patch.** |
| Nesting | flat item list | one span level (`model.ts:26-37`) | flat frame list |
| text-indent, floats | position starts at 0 (`line-breaker.ts:72`) | no line-rect offset (`lines.ts:1569-1572`) | tab x from `ll.x` (`lines.ts:106-121`) |
| text-align | `NeedsAccurateEndPosition` hard-coded off (`line-breaker.ts:526-528`) | fragments from a second list kept in step by hand at 7 sites (`lines.ts:44-65`) | hang amount not returned; painter forces `start` (`paint.ts:76-104`) |
| `<br>`, atomic inlines | item types missing (`types.ts:7-9`) | missing (`types.ts:70-75`) | text frames only |
| text-transform | offsets map one to one (`content.ts:89-93`) | box content is the source text | measured string not separated from indices |
| Prepare once, many widths | look-ahead folding at the current width (`index.ts:444-471`); gaps written while lines fill | sound: `LineStart` carries the carried width (audit F12) | gaps written into the prepared paragraph (`lines.ts:33-64`) |
| New fonts and scripts | positions come from Canvas totals with a pair test that is only necessary | fixed pitch by name (H1) | word units hard-wired; Gecko shapes whole runs when the space glyph is in lookups (`prepare.ts:829-928`) |

### 1.7 Ranked fix list

1. **Record every Canvas call in lab rows and add a recorded-width measurer.**
   - Every later fix needs offline replay.
   - Proven workable: `.artifacts/research-20260916/superset-blink/replay.ts` reproduced 1,710 of 1,710 Chrome predictions from recordings.
2. **Make engine-true geometry the only output, and move observation into the lab.**
   - Engines already return `engineWidth` (`model.ts:102`; Blink `index.ts:284`, WebKit `lines.ts:1644`, Gecko `lines.ts:746`).
   - Add fragments and hang amounts, and put the ported observation rules in the lab (`lab/observe/{blink,webkit,gecko}.ts`, rebuild/research/observe-*.md).
   - Then delete S1 in a second commit, gated against a re-scored seed.
   - This removes 41 main-only losses and makes Chrome's 118 zero-width soft-hyphen rows observable by rule.
3. **Fix the source bugs the superset runs found.**
   - **Blink, HarfBuzz continuation clusters** (`shape.ts:322`, `:390`, `:527`): 226 cases. The prototype gains 437 line counts and loses 0 over 23,396 cases.
   - **Gecko, five switches**, each with 0 control regressions over 5,000 cases: font matching after an invisible character (40), letter-spacing base after a removed soft hyphen (24), units split at script runs (22), the copied width rules (15), RTL pair kerning (14).
   - **Blink, traced only:** lone U+202F letter spacing (159) and Canvas strings crossing script edges (98).
   - **Blink, suspected:** zero-width characters at joined Arabic edges (25), traced to the candidate offset only.
   - **Gecko emoji detection** (24): needs a probe first, because the first fix broke 27 controls.
4. **Replace S2-S8 and H1-H4 with source- or probe-backed rules, or explicit font-declaration inputs with Canvas-observable defaults** (charter tentpole 3). Add the two facts the superset found:
   - does the font ligate lam-alef?
   - does its kerning come from a legacy `kern`/`kerx` table?
5. **Report gaps per line at the offset that decided the line.**
   - Never store them in prepared state (Blink F5, WebKit F11, Gecko F4).
   - Add a `page-history` gap.
6. **Decide the box tree and per-box computed style before adding any feature.** Then:
   - carry item styles and box sizes in Blink;
   - derive WebKit fragments from `Line::Run`;
   - port Gecko's per-span line state.
7. **Small items:**
   - Gecko likely subtags from ICU data;
   - normalize Gecko's family comparison;
   - model Blink CR and FF as items with no fragment (TENTPOLES-CRITIC §3 item 3; REPORT §7 item 8 is wrong);
   - make the tests that skip silently fail instead (`engines/webkit/breaks.test.ts:215`, `:254`; `engines/blink/breaks.test.ts:87`);
   - stop Blink's ICU rescan to the paragraph end at every line (`breaks.ts:121-157`);
   - sparse-add Chromium 153's HarfBuzz and re-cite the cluster and kerning rules at the pinned version.

## 2. Regression against main on main's full suite

Source: rebuild/research/CENSUS.md, with data in `.artifacts/research-20260916/census/`.
- **What ran.** Every imported case ran in Chrome 153.0.8010.48, Firefox 156.0 and webkit-host, at DPR 2.
- **Observations.** Native layout was observed once per case, together with the rebuild's prediction.
- **Main.** Main 2e5e2bd predicted over the same chunks, and was scored against the same native rows.
- **Errors.** There were no native, prediction, adapter or painter errors.
- **Re-score check (critic).** `rebuild/lab/score.ts` at HEAD re-scored Chrome chunk05, Firefox chunk09 and webkit-host chunk03 for both predictors, main's with `--native-rows`. All six per-case files are byte-identical to the census's, and the summaries are equal apart from `generatedAt` (`.artifacts/research-20260916/critic/rescore/`). A full recount of `census-transitions.ndjson` gives every total below.

### 2.1 Totals

Cells are rebuild-only / main-only.

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| cases | 238,518 | 238,412 | 238,457 |
| lineCount pass rate, rebuild | 98.68% (235,335 of 238,478) | 99.63% (236,995 of 237,874) | 98.61% (234,112 of 237,405) |
| lineCount pass rate, main | 73.86% | 80.16% | 76.07% |
| lineCount | 60,034 / 838 | 46,727 / 422 | 54,970 / 1,460 |
| breaks | 66,641 / 670 | 55,113 / 620 | 57,600 / 1,751 |
| widths | 87,876 / 592 | 73,264 / 103 | 50,983 / 1,123 |

On the suite samples this matches REPORT §2.3, whose main-only line counts are 25 / 24 in Chrome, 14 / 6 in Firefox and 5 / 20 in webkit-host (development / held-out). The gate cross-check in research/TESTS.md reproduced them.

### 2.2 Main-only cases after history and observation checks

| | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| main-only on any metric | 1,710 | 816 | 2,442 |
| of which on line count or breaks / widths only | 1,191 / 519 | 731 / 85 | 2,056 / 386 |
| main's own prediction depends on page history | 146 | 0 | 0 |
| native lines or float32 line edges differ in a fresh document | 0 | 1 | 1,707 |
| observation problem: Chrome draws a hyphen whose soft-hyphen rect is empty | 118 | 0 | 0 |
| **real main-only** | **1,446 (0.61%)** | **815 (0.34%)** | **735 (0.31%)** |

- **Chrome, main's own history.** Chrome caches shaped text per canvas, and main shares one canvas across prepares. 185 of main's predictions changed in fresh sessions (`census/history/chrome/history.json`). All 16 `original-vs-reshaped-admission` rows from REPORT §2.3 are among these 146, and triage shows main's breaks were wrong on every one.
- **Chrome, observation.** Rects confirm 28 of the 118 rows, the LTR-paragraph cases, where the letters start one hyphen width from the edge. The other 90 match by signature only.
- **webkit-host, native history: what the 1,707 are.**
  - 1,340 line-count and breaks cases, from the census reruns;
  - 270 widths-only cases whose native lines differ;
  - 97 widths-only cases whose derived lines and scored widths are equal and only raw float32 line edges moved.
  - 44 of the 1,707 stay main-only in one of the two fresh documents: 41, 1 and 2 respectively. So webkit-host's real main-only count is 735 to 779.
- **webkit-host, line counts and breaks.** In both fresh documents, the rebuild passes line count on 1,300 of the 1,340 cases, and main fails on 951.
- **webkit-host, widths.** The superset analysis reran the 386 widths-only cases the census skipped: 269 (reverse) and 270 (file order) derive other native lines.
  - 249 of them are kerning before a space after an invisible character. Main's rule at `src/layout.ts:342-379` passes all 249 in census documents and fails all 249 in fresh ones.
  - Main's rules there describe one long document's caches (TextMeasurementCache.h:57, 135-175 [I]).
  - Data: `.artifacts/research-20260916/superset-webkit/rerun-widths/summary.json`, `causes.json`.
- **Main's accidental line counts.**
  - In Chrome, main passes line count while its breaks fail or can't be observed on 521 of the 1,710 cases. The triage classifier splits them 321 failing and 200 unobservable (`.artifacts/research-20260916/tentpoles/tests/triage/census-main-only-classes.json`); SUPERSET-blink's classifier splits the same 521 as 256 and 265.
  - In webkit-host, 53 stable cases have main's breaks failing, and 347 more among the history cases.

### 2.3 What main's real wins are

Every case got one cause. Evidence: `.artifacts/research-20260916/superset-blink/attribution.json`, `superset-gecko/attribution-summary.json`, `superset-webkit/causes.json`, and rebuild/research/SUPERSET-{blink,gecko,webkit}.md.

| Cause | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| rebuild bug, fixable from source | 524 (25 suspected) | 139 | 10 |
| named gap, reachable with a font fact as input | 535 | 477 | 0 |
| named gap, no known better Canvas default | 323 | 199 | 721 (a styled `<canvas>` would reach it) |
| Canvas can't see it (U+FFFC) | 62 | 0 | 0 |
| probe or trace needed | 2 | 0 | 4 |
| **total** | **1,446** | **815** | **735** |

- **Chrome bugs:**
  - HarfBuzz continuation clusters: 226. This includes all 55 Myanmar corpus cases, and a Chrome rerun of the fix resolves them.
  - Lone U+202F loses letter spacing in Canvas: 159.
  - Canvas string crosses a script segment edge: 98.
  - `width` copied from the lab: 16.
  - Zero-width characters at joined Arabic edges: 25, suspected.
- **Chrome named gaps:**
  - lam-alef is one glyph only in some fonts: 274;
  - OpenType joining applied to Geeza Pro fallback: 261;
  - which glyph carries a pair adjustment: 196;
  - the script Common punctuation takes: 101;
  - joining edges in OpenType fonts: 26.
- **Firefox bugs:** font matching after an invisible character 40, letter-spacing base 24, emoji detection 24, units across script runs 22, the copied `width` 15, RTL pair kerning 14.
- **Firefox named gaps:**
  - legacy `kern` tables split each kerning value between both glyphs: 105 (hb-kern.hh:102-106, from Chromium 152's HarfBuzz; Firefox 156's HarfBuzz version wasn't checked);
  - the lam-alef ligature's width sits on lam during the break scan: 372;
  - joining forms and ligatures inside words: 199.
- **webkit-host:**
  - letter spacing turns ligatures off in the DOM but not in OffscreenCanvas: 721 (UnrealizedCoreTextFont.cpp:258-264);
  - leftover width on lines with no visible text, a bug from S1: 10;
  - CR and FF kerning in Times New Roman: 3;
  - unexplained: 1.
- **How main wins.** It measures graphemes alone or as growing prefixes, counts U+0000 as 13px, and reads the DOM for emoji. Its 0.005px tolerance decides at most 1 Firefox case. In the same families these measurements lose far more than they win: Firefox `joined` line counts are 1,711 rebuild-only against 94 main-only.

### 2.4 Main's required cases

| Browser | Required cases | lineCount both / rebuild-only / main-only | breaks main-only | widths main-only |
|---|---:|---|---:|---:|
| Chrome | 7,799 | 7,794 / 4 / 1 | 0 | 0 |
| Firefox | 7,755 | 7,750 / 5 / 0 | 1 | 0 |
| webkit-host | 7,802 | 7,794 / 8 / 0 | 0 | 0 |

- **Chrome `c-9c5a66597ebf5aef`.**
  - Input: `a` U+2060 U+0301 `b`, 16px Courier New, letter spacing −4, width 1, pre-wrap.
  - Native 3 lines, rebuild 4, main 3.
  - Main requires it for its entry-geometry heuristic (INVENTORY.md:19).
  - Cause: continuation clusters. The prototype `superset-blink/src-exp1a` fixes it.
- **Firefox `c-ed263bd4b6656704`.**
  - Input: a long word in 24px Helvetica Neue at 150px. Main requires height only, and the rebuild's line count passes.
  - Native `Superlongwo|`, rebuild `Superlongwor|`.
  - Cause: Helvetica Neue has only `kern`/`kerx` tables, so HarfBuzz splits the kerning between both glyphs. The `legacyKern` switch fixes it.
- **Widths.** Main fails widths on 4,150 required Chrome cases where the rebuild passes, a one-LayoutUnit difference.
- **Obligations.** The lab's `obligations` family keeps main's own pins as ordinary cases: entry geometry, the standalone ZWSP, space kerning and the space after overflow (`rebuild/lab/cases/obligations.ts:13`). So `c-9c5a66597ebf5aef` isn't an obligation. Scored in the final runs (`.artifacts/research-20260916/test-strategy/obligation-status.json`), the rebuild passes these required pairs:

  | Engine | Required pairs passed |
  |---|---|
  | Chrome | 7,835 of 7,836 |
  | Firefox | 7,776 of 7,777 |
  | WebKit | 7,833 of 7,841 |

  All 10 misses are required width pairs, labelled "observed, not passing". 9 are discretionary soft-hyphen cases where main's oracle says no hyphen and the browser gives the trailing soft hyphen a positive rect; 1 is the Safari paint witness `c-9f44d66e0a52e3bc`. The lab doesn't observe hyphen paint (research/TESTS.md §5).

### 2.5 Limits of the regression numbers

- Only main-only cases were rerun for history. In webkit-host, the rebuild-only and both-fail counts weren't checked for the same effect.
- The census observed each case once, in file order, deep inside documents of about 19,784 cases.
- Firefox's 85 widths-only cases were rerun in one experiment session with 5,000 controls mixed in, not in both orders.
- Chrome causes B, C, E and the named-gap buckets rest on traces and signature rules. Only cause A has a Chrome rerun with a collateral check.
- The HarfBuzz mechanisms behind causes A, F, G and H in Chrome and G, H in Firefox are cited from Chromium 152's HarfBuzz, not the pinned browsers'.
- The API surface is a separate regression: see §3.4.

## 3. How far the rebuild can become a superset of main

### 3.1 Per engine

| Step | Chrome | Firefox | webkit-host |
|---|---:|---:|---:|
| census main-only (any metric) | 1,710 | 816 | 2,442 |
| not real losses: history, observation | −264 | −1 | −1,707 (44 of them main-only in one fresh document) |
| source bug fixes | −524 (226 proven by rerun; 16 offline; 257 traced plus rules; 25 suspected) | −139 (five switches clean over 5,000 controls; the emoji switch regresses 27 control widths) | −10 |
| font facts as declaration inputs | −535 | −477 | 0 |
| probe or trace | 0 | 0 | up to −4 (3 CR/FF, 1 emergency break) |
| decision on measuring with ligatures off | 0 | 0 | −721 if a styled `<canvas>` is allowed |
| **left** | **~387** | **199** | **721 to 725, or 0 to 4 with a styled canvas** |

- **Firefox after the source fixes:** metric losses to main are 374 line counts, 579 breaks and 1 width.
- **Firefox after both font facts:** 181, 132 and 1 (`superset-gecko/variants-summary.json`).
- **Controls those switch sets make worse:** the combined source set worsens 27 control widths (the emoji switch). The set with facts also worsens 9 line counts and 17 breaks (the letter-keyed lam-alef switch).

### 3.2 What it takes

1. **The §1.7 source fixes.** Each needs a lab run over its families. Only Blink continuation clusters and the Gecko switches have been run with controls.
2. **Font facts as inputs on the font declaration.**
   - The charter's tentpole 3 route: no font files and no name tables. Default to the Canvas-observable behaviour and report the named gap.
   - The superset experiments show these facts can't come from letters alone:
     - Treating lam-alef as one cluster in Blink fixes 274 cases and loses 347 in Amiri, the Noto fonts and 1 Times New Roman case.
     - The letter-keyed Gecko rule fixes 372 cases and worsens 26 control metric results (line count 9, breaks 17).
     - The legacy-kerning table fixes 105 cases, including the required one, with 0 control results worse.
   - **Cross-engine link [I], untested.** Blink's 196 "which glyph carries a pair adjustment" cases include Times New Roman letter-space pairs, and Times New Roman kerns from a legacy `kern` table. The same fact may explain some of them.
3. **webkit-host ligatures.**
   - A DOM-attached `<canvas>` styled with `font-variant-ligatures: no-common-ligatures` measures the same as the DOM on one probe (webkit-canvas H4, 16px Hoefler Text).
   - It is still measureText with no layout read, but it needs a styled element, doesn't run in workers, and contradicts `measure/canvas.ts:1-3`.
   - Without it, the named gap stays.
4. **Lab changes.**
   - Port the observation rules, so Chrome's 118 hyphen rows become observable by rule.
   - Rerun candidate losses in fresh documents in both orders. That turned 2,442 apparent webkit-host losses into 735 stable ones.

### 3.3 What can never be a superset, and why that is right

- **Main's page-history wins** (Chrome 146, webkit-host 1,707 less the 44 that are main-only in one fresh document). A predictor sees the paragraph, not the page's caches. Predicting the fresh-document layout is what a caller can rely on.
- **Main's accidental line counts** (Chrome 521; webkit-host 53, plus 347 among history cases). Chasing them rewards wrong breaks.
- **Isolated-grapheme wins** (Chrome ~387, Firefox 199). Main's approach wins 94 Firefox `joined` line counts and loses 1,711. No Canvas default gets both without glyph data, which only font files hold.
- **U+FFFC** (Chrome 62). Canvas normalizes it to U+200B (character.h:167-175), unless a stand-in character is found.
- **Layout with no Canvas calls on resize.**
  - Blink reshapes line edges at offsets that depend on the width (`line-breaker.ts:452-567`).
  - WebKit's `nextLine` measures at 6 sites (hyphen, trailing white space, emergency breaks, `breakWord`).
  - Gecko measures in-word suffixes only when a line reaches them (`lines.ts:20-57`).
  - Precomputing is possible, at a cost in calls proportional to text length.
- **Unpinned browsers.**
  - Main approximates every version by user agent.
  - The rebuild pins exact versions in its data and source (`env.ts:8-14`).
  - Detection is looser than that: it accepts any Chrome 153 build, any `Version/27.0` Safari and any `Firefox/156.0` user agent, 156.0.x included (`env.ts:57-63`).
  - A fallback would need an explicit policy and a version gap, not a silent guess.
- **Main's emoji DOM read.** The brief forbids it.

### 3.4 Main's API features

Charter tentpoles 5 and 8: main's API contracts aren't inherited, and API shape comes later. Recorded here for the feature question.

| Main | Rebuild today | Fit |
|---|---|---|
| `prepare` once, `layout` at any width | internal `prepare` / `firstLine` / `nextLine` (`engines/engine.ts`); public `layoutParagraph` only | the split is additive; "no Canvas calls" isn't (§3.3) |
| `layoutNextLine` at a different width per line | internal `nextLine(width)` | Gecko and WebKit fit; Blink needs look-ahead folding removed and gaps moved per line |
| `walkLineRanges`, `measureLineStats`, `materializeLineRange` | none | thin loops over `nextLine` |
| `measureNaturalWidth` | none | port each engine's intrinsic sizing |
| rich inline `break: 'never'`, `extraWidth` | no per-span style, no box sizes, no atomic items | **structural** in all three (§1.6) |
| shared caches, `clearCache`, `setLocale` | a memo per layout | additive; a shared canvas brings back Chrome's per-canvas history (146 cases) |
| inputs: `whiteSpace` normal/pre-wrap, `wordBreak` normal/keep-all, `letterSpacing` | every `white-space`, `word-break`, `overflow-wrap`, `line-break` value, `tab-size`, word spacing, per-run `lang`, direction, bidi levels | rebuild is the superset; main's adapter rejects 196 of the 299-300 smoke cases and 2,559 of 2,580 runs cases (lab/BASELINE-main.md) |
| any browser version | refuses other major versions | policy decision |

Size: 11,818 library lines against main's 6,862; 1.35 MB of generated tables against 29.5 KB (REPORT §3).

## 4. Tests

### 4.1 How main's tests enter

- **Main is a corpus, not a spec.** Main's tests are a measurement corpus. They enter as browser facts only through triage records, `rebuild/lab/triage/main-<browser>.ndjson` (CHARTER tentpole 5; TEST-ARCHITECTURE §7).
- **Triage outcomes:**
  - a fact to learn, which becomes a rule family with main's case as origin;
  - an accidental pass;
  - an opinion dropped;
  - undecided.
- **What this replaces.** This overrides the first-class verdicts in rebuild/research/TESTS.md (TENTPOLES-CRITIC §3 item 6). Until triage records exist, the `obligations` family (8,889 cases) and today's gate baselines are measurement inputs.
- **Triage status.**
  - No triage record exists for any browser: `rebuild/lab/triage/` doesn't exist.
  - What exists is step 2 of the protocol, the A-D classification from observations. It covers Chrome completely (1,710 rows: A 321, B 200, C 670, D 519) and 9 of Firefox's 12 small chunks. webkit-host hasn't been classified.

### 4.2 First-class in the rebuild workspace

No expected value, threshold width or verdict may come from `rebuild/src` (TEST-ARCHITECTURE §0 rule 1).

| Layer | Exists | To add |
|---|---|---|
| **Engine data parity** | `rbbi.test.ts` 4, `ubidi.test.ts` 9, `unicode-bidi.test.ts` 8, `grapheme.test.ts` 1, `bidi.test.ts` 3, Gecko `props.test.ts` 1; Blink `script.test.ts` 47 (Chrome's own script_run_iterator_test.cc, the 47 of its 63 TESTs that use ICU data); WebKit dumped `classify` and pair table; Gecko ICU4X replay | make `webkit/breaks.test.ts:215`, `:254` and `blink/breaks.test.ts:87` fail instead of skipping; move oracle answers under `rebuild/data` with hashes; widen Blink's break oracle (today a C++ re-port of Chromium 152, first line only, no break-all, anywhere, break-spaces or strictness); likely-subtags against ICU; Emoji_Presentation, Emoji_Modifier and Joining_Type in Gecko's property test |
| **Upstream engine tests** | none | Blink `line_breaker_test.cc` 44 (25 use Ahem, reproducible with a stand-in Canvas), `inline_items_builder_test.cc` 31, `text_break_iterator_test.cc` 25, `shaping_line_breaker_test.cc` 9, `han_kerning_test.cc` 6 |
| **Browser facts per release** | Chrome `blink-probes` (95 results at DPR 2), `ignorables` 30, `sysui`, `zoom`; Firefox `gecko-probes` (98 results in `gecko/main`; probes-firefox.md says 99), `emoji-font`, `followups`; WebKit `webkit-probes` 89, cross-check (118 results in webkit-host's output, 140 in installed Safari's), `followups` 7 | a facts extractor and differ (prototype `tentpoles/tests/facts-extract.ts`); a fact flip blocks that engine's gate; WebKit line probes H1, H2, H4, H5, H7-H10, H12, H15, H18-H21 as fixtures |
| **Offline replay** | none in the lab; proven by `superset-blink/replay.ts` | full call logs in rows, then every recorded case replays line filling in bun. This covers WebKit `lines.ts` (1,653 lines), `measure.ts`, Blink `shape.ts` (660) and `hankerning.ts`, which no bun test reaches. |
| **Rule families at thresholds derived from native observations** | runs, ws, policy (natural families) | first the rules with no coverage: 14 uncovered and 12 reached only by probes or bun tests (RULES.md). Then the traced shapes below, and the facts from main's 36 engine-fact unit tests (33 use texts no lab case holds, e.g. layout.test.ts:706 Gecko slash breaks, :966 WebKit NEL, :1883 keep-all pairs, :3621 Safari following-space kerning) |
| **Sealed held-out sets** | `heldout-20260916` | seal a new set with a committed seed hash; the current one counts as burned (inspected) |
| **Gate** | §4.5 | |

Traced shapes to make rule families, with seed cases:
- **A mark after SHY, ZWSP or U+2060 at width 1**, LTR and RTL; Myanmar signs after ZWSP. Seeds: `c-08ead50c71a1abcf`, `c-9c5a66597ebf5aef`.
  - This is a Blink cluster fact. Name the family after the engine rule, not main's `emergency-graphemes` API family (TENTPOLES-CRITIC §2.E item 3).
- **U+202F with letter spacing ±.** Seed: `c-54aeaed1b5f03e4a`.
- **Arabic, soft hyphen, space, then a Latin letter.** Seed: `c-02266b030454af2c`.
- **lam-alef per font**, Arial against Amiri. Seeds: `c-00520dd17f45f4f9`, `c-01c71a79b98763bb`, `c-c63261da4be7e909`.
- **Legacy kerning split.** Seeds: `c-0320b489824a990f`, `c-ed263bd4b6656704`.
- **An invisible character before a mark or U+202F.** Seeds: `c-924c3bf3d268e1fc`, `c-00559b464fe0094e`.
- **A mark after a removed soft hyphen with letter spacing.** Seed: `c-082d325a50f8ca53`.
- **Script runs inside a word:** `a(α­β)b`. Seed: `c-069841252e31724f`.
- **RTL pair kerning.** Seed: `c-7b805b52de2b9986`.
- **Ligatures under letter spacing.** Seed: `c-0033f34a9d6b3f85`, plus Hoefler Text.
- **CR and FF kerning in Times New Roman.** Seed: `c-0774ff114d939edf`.
- **A bidi-reordered trailing space, and U+0600 at a line start.** Seeds: `c-25eb7c4c018d02e2`, `c-163596965939fbe6`.
- **Emoji text presentation, with its counterexample.** Seeds: `c-0a1e684e77a9d8bb`, `c-015aa7d0bec6fdf5`.

### 4.3 Ordinary: measured, protected by the gate once passing, never required

- **Main's suite import:** 238,524 cases in 387 families. That includes policy recipes, `content-language` (297), `kinsoku-units` (10,847), `closing-punctuation` (9,732), the historical #210-#214 variants (112) and the 20 ordinary-selection behaviours.
- **Corpora:** 1,098 canaries. Only 56 have been observed.
- **Main's required groups, until triaged:**
  - accuracy grid 7,680;
  - oracles: pre-wrap 15, keep-all 11, symbols 3, letter-spacing 14;
  - discretionary 8;
  - filed reports #208, #210 (plus 12 rich witnesses), #212, #214, #225, #274, #177/#194;
  - Safari paint witnesses 2;
  - emergency graphemes 8.

  Their browser facts should become rule families. Their tolerances don't carry over.
- **The rebuild's own natural families:** runs 2,580, ws 1,019, policy 1,606, smoke 299-300.

### 4.4 Special status dropped: it held main's heuristics or observer in place

| Main's test | Why it existed | Now |
|---|---|---|
| entry geometry, 3 cases (cases.ts:118-128) | holds `src/entry-geometry.ts` | ordinary; `c-9c5a66597ebf5aef`'s line count becomes a Blink cluster fact |
| standalone-zwsp (1), space-after-overflow (1) | pin main's own fixes | ordinary |
| space-kerning (1, Safari) | a width between main's two measurements | ordinary; WebKit's following-space rule becomes a family |
| native rich admission exact fit (2) | thresholds from main's Canvas (10.671875, 9.651875) | ordinary |
| source-view curation (23) | main's source-ownership model | ordinary |
| observer controls (7), direction-conflict status | main's observer; main's API has no direction | ordinary |
| accuracy grid's sub-1px height tolerance, corpus rounded-height tolerance, span/range extraction and height protocols, `normalizeSource` | tolerances and observer protocols | dropped; the lab counts lines from rects |
| #210 in Safari 27 (`wrap-4faaad4b08f18c01`) | line count from a 1/64px height divided by 20.96 | dropped (observer artifact) |
| `api` metric, the UA-profile checks in `numeric.ts` | main's API and user-agent sniffing | dropped |
| `accuracy/*.json`, `corpora/*-step10.json`, `baseline.json`, `--preserve` | main's snapshots | replaced by gate baselines |
| `report.test.ts` 17, `observe.test.ts` 21, `cases.test.ts` 7, `snapshots.test.ts` 2, `entry-geometry.test.ts` 3 | main's harness | dropped; the principles live in `rebuild/lab/gate.test.ts` |
| `src/layout.test.ts`: 57 segment-model, 52 fake-canvas layout and 14 internal-module tests (123 of 191) | main's segment arrays and internals | dropped |
| `src/layout.test.ts`: 36 engine-fact tests | real browser facts main found | triage into rule families (§4.2) |
| `src/layout.test.ts`: 32 API contracts, plus ~30 contracts in `contracts.ts` | main's public surface | not inherited; revisit when API shape is decided |

Buckets: `.artifacts/research-20260916/test-strategy/layout-test-buckets.json`.

### 4.5 The gate

- **What exists.** `rebuild/lab/gate.ts`, with 14 tests.
  - A (case, metric) pair is a baseline pass only if every seeding run passed it.
  - Any lost pass fails the gate; gains never offset a loss.
  - It refuses runs from another environment or engine, and runs scored without `--native-compare`.
- **Baselines** from 18 to 22 final runs per browser:

  | Baseline | Cases | Pass pairs | History-dependent cases | Unstable pairs |
  |---|---:|---:|---:|---:|
  | `gate-chrome.json` | 40,446 | 147,776 | 0 | 0 |
  | `gate-firefox.json` | 40,340 | 146,474 | 339 | 0 |
  | `gate-webkit.json` | 40,385 | 142,309 | 241 | 17, on 16 cases |

  Each checks against its own runs with 0 lost passes.
- **Changes it needs** (TEST-ARCHITECTURE §6, TENTPOLES-CRITIC §4):
  1. **Environment key from app bundle builds.** User agents read `Chrome/153.0.0.0`, `rv:156.0` and `Version/27.0`, so today's key can't tell a later 153 build apart.
  2. **Fresh-document reruns before counting a loss**, in both orders. Then either gate history-dependent cases on fresh-process observations with explicit preludes, or skip them and report the `page-history` gap.
  3. **Fact flips, missing facts and lost rule coverage** fail the gate.
  4. **`obligations` rebuilt from triage records** instead of main's `required` lists (`cases/obligations.ts`). Obligation pairs and today's baselines stay report-only until triaged.
  5. **Seed per scorer version** when the observation port lands.
  6. **Replace the scorer's height tolerance** (`rebuild/lab/score.ts:518`) with a ported rule or a named observer assumption.
- **Per release:**
  1. Keep `rebuild/src` unchanged.
  2. Observe every layer in both orders and seed a new baseline.
  3. Attribute every lost pair: browser change, observation problem, new history dependence, or scorer change.
  4. Only then port from the new source.
- **Which baselines move.** Chrome and Firefox updates move only their own baseline. A Safari update also voids the rule that lets webkit-host stand in for Safari. A macOS update moves all three.

### 4.6 Rebuild tests to rework

- **Blink `lines.test.ts`** pins the port's own output with fake widths, for example `engineWidth.raw 3200` (`lines.test.ts:50`). Move it to replay, or re-base it on Chrome's Ahem tests.
- **Gecko:** 6 of 31 tests pin the port's own arithmetic, and no test covers `W(unit) − W(suffix)` or the U+200D recipe against native geometry.
- **WebKit:** 12 verdict tests go through a test-local restatement of the port's rule (`breaks.test.ts:57-86`). Assert them through `layoutParagraph` at 1px instead.
- **Not tested at all:** `paint.ts`, `measure/`, `env.ts`, the gap reports, and the rule that a `LineStart` is valid only at its own width.

## Decisions for you

1. **Which facts join the font declaration.** CHARTER tentpole 3 already makes AAT against OpenType joining an explicit input with a Canvas-observable default. Open: whether lam-alef ligation and legacy `kern` splitting join that list. The superset runs show they behave the same way: letter-keyed rules fix many cases and break others, while a per-font legacy-kern table breaks nothing.
2. **webkit-host ligatures under letter spacing:** allow a DOM-attached `<canvas>` styled with `font-variant-ligatures: no-common-ligatures` (721 cases), or keep the named gap.
3. **History-dependent cases:** gate them on fresh-process observations with explicit preludes, or keep skipping them.
4. **Stale recommendations.** Retire REPORT §7 item 2 (keep OpenType joining), which contradicts tentpole 3. Demote research/TESTS.md's first-class verdicts: tentpole 5 already admits main's tests only through triage.
5. **Version policy** for browser builds the rebuild hasn't pinned, including whether detection should key on build numbers.

## Critic corrections

Checks run for this pass:
- **Re-scoring.** `score.ts` re-scored Chrome chunk05, Firefox chunk09 and webkit-host chunk03 for both predictors. All six per-case files are byte-identical, and the summaries are equal apart from `generatedAt`.
- **Recount.** A full recount of `census-transitions.ndjson` reproduces every total in §2.1, §2.2 and §2.4.
- **Code locations opened**, about 40: shape.ts:63, :108, :214-239, :304-323, :390, :527, :629; content.ts:40 (Blink); index.ts:18-51, :284, :289-396, :444-471; line-breaker.ts:72, :114-123, :526-528, :672-702; types.ts:7-9; breaks.ts:121-157; webkit content.ts:176, :437-501; measure.ts:15-25, :33-36; lines.ts:44-65, :244-249, :802, :1209, :1269, :1489-1565, :1644; style.ts:5-28; types.ts:70-75; model.ts:26-37, :101-102; gecko lines.ts:20-57, :106-121, :394-428, :605-761; prepare.ts:530-544, :684-730, :840-925; linebreak.ts:346-358; paint.ts:76-104; env.ts:57-63; measure/canvas.ts:1-12; score.ts:518; gen-webkit-data.ts:85; webkit breaks.test.ts:57-86, :215, :254; blink lines.test.ts:50; main src/layout.ts:342-379; tests/wrapping/cases.ts:118-128; line_breaker.h:309. The quotes in §1 are accurate.

Changed from the draft:

1. **Header.** The branch is at 84b4f19, not 3d97740. The superset analyses are committed as rebuild/research/SUPERSET-{blink,gecko,webkit}.md. Added that branch `rebuild-charter` (49ab636, uncommitted edits) has since replaced S1-S4 and H1-H3, so this document describes tree ecdef04b only.
2. **Verdict and §1.2.** "The three line loops are line-by-line ports" now says this covers control flow.
   - Blink: the audit's faithful rows `ShapeLine` and `offsetForPosition` take positions from the grapheme-based safe test, where bug A later turned up, and they use S2.
   - Gecko: "no deviation" covers the scan, not the advances it sums (S3, bugs B, C, D). The faithful entry P9/P11 "InitTextRun script runs" sits beside a unit loop that measures across script runs (bug C).
   - WebKit: the carried width is applied to ligated Canvas widths.
3. **§1.2, Blink table size.** "20 functions" had no source. The audit's §2 table has 18 rows, about 26 functions.
4. **§1.2, shared checks.** The crate bidi port is checked against BidiTest, not Firefox. Gecko's property test leaves Emoji_Presentation, Emoji_Modifier and Joining_Type unchecked, and Joining_Type drives S3.
5. **§1.2, HarfBuzz.** Added that HarfBuzz isn't in either pinned checkout. The cluster and kerning mechanisms come from Chromium 152's copy, which departs from "each engine's pinned source".
6. **§1.1.** Added the epsilon grep result: one hit, the comment at webkit/lines.ts:1209.
7. **§1.1, RULES areas.** "WebKit's whole line-filling code: lines, breaker and output" left out `tos` and `ilb`; RULES.md names all five.
8. **§1.4, missing score choices.** RULES.md's 11 score choices include Blink `joins-next-line-opentype` and painter R7 `zwj-at-joined-line-edges`, which the draft left out. Added S7 and S8.
9. **§1.4, S6.** RULES.md classes S6 as a heuristic, not a score choice.
10. **§1.4, REPORT.** Noted that REPORT §7 item 2 still recommends keeping S2.
11. **§1.5 item 1.** The draft's example (4,858 unobserved against 4,669 observed webkit-host widths) is a Range-rect observation limit, not S1. Replaced with Blink D3's measured blind spot: 738 of 1,182 thin-space cases.
12. **§1.5 item 3.** Split Firefox's "84" into 36 right-offset-wrong-reason and 48 unrelated gaps, as SUPERSET-gecko §2.5 does.
13. **§1.5 item 4.** "History-dependent cases are excluded from every table" was wrong for the census, which observed every case once. They're left out of REPORT's tables and never fail the gate.
14. **§1.7 item 2.** Engines already return `engineWidth`. The fix is removing the lab-copied `width` and adding fragments and hang amounts, not starting engine geometry from nothing.
15. **§1.7 items 3 and 7.** Separated Blink cause E (25, suspected). Counted the Gecko width-rules switch among the clean switches. Added Blink `breaks.test.ts:87` to the silent skips, and pinning HarfBuzz at 153.
16. **§2.2, the 249 kerning cases.** The draft put them among the 1,340 line-count and breaks cases. They are widths-only cases from the superset analysis's rerun of 386.
17. **§2.2, the 1,707.** Renamed the row and broke down the 1,707: 1,340 + 270 + 97, where 97 only moved float32 edges. 44 cases stay main-only in one fresh document (41 + 1 + 2), so webkit-host's real main-only count is 735 to 779.
18. **§2.2, Chrome observation.** Rects confirm only 28 of the 118 soft-hyphen rows.
19. **§2.2, A/B split.** Recorded that SUPERSET-blink splits the 521 accidental Chrome line counts as 256 and 265, against the triage classifier's 321 and 200.
20. **§2.3 and §3.1.** Chrome's 524 source bugs include 25 suspected; the draft's "282 trace-backed" became 257 traced plus 25 suspected. The Firefox legacy-kern mechanism is marked as cited from Chromium 152's HarfBuzz.
21. **§2.4, obligations.** They exclude main's own pins (obligations.ts:13), so "passes every required pair" doesn't cover `c-9c5a66597ebf5aef`. The 10 misses are labelled "observed, not passing": 9 discretionary soft-hyphen widths and 1 Safari paint witness. The draft said "all at a soft-hyphen line end".
22. **§2.5.** Added three limits: Firefox's widths-only cases were rerun in one mixed session; the HarfBuzz citations aren't pinned; and history reruns cover only main-only cases.
23. **§3.1, Firefox.** Added the control regressions of the combined switch sets behind 374 / 579 / 1 and 181 / 132 / 1: 27 widths, and 9 line counts plus 17 breaks.
24. **§3.1, webkit-host "left" cell.** Changed from "721, or 0" to "721 to 725, or 0 to 4", matching the verdict: the 4 CR/FF and emergency-break cases need probes first.
25. **§3.2.** "Worsens 26 controls" became "26 control metric results (line count 9, breaks 17)". lam-alef losses in Blink include 1 Times New Roman case.
26. **§3.3.** "Pins exact versions (env.ts:8-14)" overstated detection. `engineFromUserAgent` accepts any Chrome 153 build, any `Version/27.0` and `Firefox/156.0` with 156.0.x (env.ts:57-63).
27. **§4.1.** "Chrome is complete: 1,710 rows" described classification, not triage. No triage record exists; `rebuild/lab/triage/` is absent.
28. **§4.2 and §4.3.**
    - `kinsoku-units` has 10,847 cases, not 10,858 (census.json, suite-all.summary.json).
    - Probe outputs hold 95 Blink results, not 96, and 98 Gecko results, where probes-firefox.md says 99.
    - The WebKit cross-check has 118 results in webkit-host's output and 140 in installed Safari's. The draft gave only 140.
    - The emergency-graphemes citation is TENTPOLES-CRITIC §2.E item 3, not §0 E.
29. **Decisions.** Tentpole 3 already settles joining as a font input, and tentpole 5 already settles admission through triage. Decision 1 is narrowed to the two new facts. Decision 4 is now about retiring the documents that contradict the charter.

Checked and unchanged:
- **Census:** the §2.1 totals, pass rates and required-case cells.
- **Superset analyses:** the attribution totals per engine (Chrome 14 causes summing to 1,710; Firefox 816; webkit-host 2,442 by 10 cause keys) and the history counts (185 main predictions changed in Chrome; 1,340 history-dependent in webkit-host).
- **Gate:** baseline counts (147,776 = 40,191 + 39,535 + 30,078 + 37,972; 339 and 241 history-dependent cases; 17 unstable pairs on 16 cases) and seeding runs (18, 18, 22).
- **Rule catalogue:** every cell of the counts table.
- **Tests:** layout.test.ts buckets 57 / 52 / 36 / 32 / 14; upstream Chromium test counts (44 with 25 Ahem, 31, 25, 9, 6); main's harness test counts (17, 21, 7, 2, 3); WebKit breaks.test.ts 18 tests, 12 through the restatement.
- **Code counts:** 50 `p.style` reads in WebKit, 12 block-style sites in Blink, 10 fixed-pitch names.
- **Other:** lab/BASELINE-main.md's 196 and 2,559 unsupported cases, and REPORT §2.3's 25 / 24, 14 / 6 and 5 / 20.
