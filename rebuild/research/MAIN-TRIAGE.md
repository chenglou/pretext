# Main's regressions, triaged

Charter tentpole 5 says main's suite is a measurement corpus. Where main passes and this branch fails, each case is either an objective browser fact to learn, a pass main got by accident, or an opinion we no longer hold. This triages every such case.

The charter library (`rebuild/src`, the tree the evaluation of 2026-09-17 ran) was run again on 2026-09-17 over three kinds of case:
- the census's main-only cases;
- the evaluation's main-only cases;
- every case main requires.

Paths are relative to `~/github/pretext-rebuild-charter`.

Terms:

- A **case** is one styled paragraph at one width. **Native lines** are the lines the browser reports, grouped by the scorer's one named observer assumption (vertical centres).
- **Main passes** a case when its line count equals the native count, or when both line counts pass and its **visible breaks** pass: every code point with a positive-width rect on exactly one native line lies in main's line of that index.
- Scorer 2 can't compare main's breaks: main returns line ranges only, and no observation port exists for them. So visible breaks are a diagnostic in the old scorer's sense, not a metric.
- **Zero-width placement** is a second diagnostic. Every code point whose rects all have zero width and sit on one native line lies in main's line of that index. White space is left out, because where collapsed or hanging white space reports is engine geometry.
- **The charter fails** a case on scorer 2's lineCount or breaks. On every case where only breaks differ, the charter's visible breaks fail too.

## 1. Outcomes

| Browser | Main passes, charter fails | Facts to learn | Accidental: right count, wrong breaks | Accidental: zero-width characters elsewhere (provisional) | Accidental: main's own history | Opinions dropped |
|---|---:|---:|---:|---:|---:|---:|
| Chrome 153.0.8010.48 | 1,069 (773 line count, 296 breaks) | 622 | 316 | 120 | 9 | 2 |
| Firefox 156.0 | 745 (438, 307) | 620 | 89 | 36 | 0 | 0 |
| webkit-host 22625.1.29.11.27 | 736 (487, 249) | 659 | 70 | 7 | 0 | 0 |

Around those cases:

- **Required obligations.** The charter passes every lab obligation pair in all three browsers (§6). One case main's suite requires still fails: Chrome `c-9c5a66597ebf5aef`. Its line count is a fact to learn (§3.2), and its requiredness is dropped (§5).
- **Resolved since the census.** 125 of Chrome's 1,191 census main-only cases no longer regress, 23 of Firefox's 731, and 1,320 of webkit-host's 2,056.
- **Main's widths-only passes in the census.** Chrome 519, Firefox 85 and webkit-host 386 cases. Those passes were scored by the old scorer's visible extent, so they are dropped as evidence (§5).
- **Nothing of main's code is admitted.** In every fact group main has no model of the browser behaviour. Its answers come from isolated grapheme widths, a per-grapheme spacing formula, or its page's Canvas history.

## 2. Method

### 2.1 Cases

`tools/build-cases.py` builds one case file per browser:

- the census's main-only cases (`research-20260916/census/main-only/<browser>.ndjson`, before its history reruns): 1,191, 731 and 2,056;
- the evaluation's main-only line counts (REPORT §2.5): 48, 56 and 25;
- every case the old suite requires (`census/cases/suite-meta.json`): 7,803;
- the lab's non-canary obligations (`rebuild/lab/cases/generate.ts obligations`, regenerated offline): 7,791.

After each case's browser filter the files hold Chrome 8,988 cases, Firefox 8,518 and webkit-host 9,854. Chrome's 55 paragraphs over 1,000 UTF-16 units went to their own file, run one case per round trip.

### 2.2 Runs

- `tools/chain.sh` and `tools/chain-widths.sh` ran one short job per file under the shared browser lock, in the background, 03:09 to 03:18.
- Per browser the order was the charter library in file order, then in reverse, then main's library (`rebuild/lab/baselines/main-predictor.ts`) in both orders.
- Browsers: installed Chrome, installed Firefox and webkit-host, all at DPR 2 on macOS 26A428.
- 28 jobs finished ok with 113,400 rows. Rows report no native, prediction or painter errors.

### 2.3 History

- **The charter's two orders:** native lines differ on 0 Chrome, 0 Firefox and 5 webkit-host cases. 4 of those webkit-host cases are in the population, marked.
- **Main's sessions:** their native lines equal the charter sessions' on every case.
- **Main's own predictions:** they change in reverse order on 152 Chrome cases, 150 of them in the population, and on none in Firefox or webkit-host.

### 2.4 Outcome rules

Outcomes come from observations only (TEST-ARCHITECTURE §7.1):

1. **Accidental, right count, wrong breaks:** main's line count passes and its visible breaks fail.
2. **Accidental, main's own history:** main passes in file order, and its prediction changes and fails in reverse order.
3. **Accidental (provisional), zero-width characters elsewhere:** main's count and visible breaks pass, but its zero-width placement fails.
4. **Fact to learn:** main passes everything observable. The native lines show what the browser does, and the charter doesn't do it.
5. **Opinion dropped:** the pass or the requiredness rests on main's observer definitions, API contracts or an engine-keyed constant.

### 2.5 Causes

Causes come from shape checks in `tools/classify.py`, applied in order. The first match wins:

1. Myanmar text;
2. U+FFFC;
3. the `ui-language` gap;
4. the `letter-spacing-ligatures` gap;
5. U+202F;
6. the charter splits lam and alef, or f and f, i or l, where native keeps them on one line;
7. a native line without visible code points that the charter doesn't make, or the reverse;
8. the charter's first misplaced code point sits between joining letters;
9. punctuation or Latin after another script in Amiri, Noto Naskh Arabic, Noto Nastaliq Urdu, or under the `script-context` gap;
10. letter spacing with fullwidth and cursive text;
11. other joining scripts;
12. Arabic;
13. Latin only;
14. invisible characters or marks.

Two example cases per family and class were read by hand. Families mix shapes, so a cause count can be off by a few cases.

## 3. Facts to learn

Counts are facts to learn, with the accidental passes that share the shape in parentheses.

### 3.1 Ligature clusters at an overflow break

- **Counts.** Chrome 245 (24 accidental). Firefox 309 (42 accidental).
- **Families.**
  - Chrome: `joined` 162, `joined-plain` 31, `space` 17, `mixed` 13, `cross-item` 8, `ligature-thresholds-v3` 7.
  - Firefox: `joined` 182, `mixed` 57, `joined-plain` 37, `space` 17, `measurement` 8.
- **What the browser does.** An overflow break inside a word lands only between glyph clusters, and a ligature merges its components into one cluster. So the break never falls between lam and alef, or inside `ffi` in Amiri.
- **Source.**
  - HarfBuzz's `ligate_input` merges the components' clusters (`hb-ot-layout-gsubgpos.hh:1500-1510`, read in the Chromium 152 HarfBuzz checkout).
  - Blink's `ShapeResult::OffsetToFit` calls `OffsetForPosition` with `BreakGlyphsOption(false)` (`shape_result.cc:684-694`). The option would otherwise allow "a point inside a glyph when multiple graphemes share a glyph (for example, in a ligature)" (`shape_result.h:111-114`).
  - Gecko allows an emergency wrap only at a cluster start (`gfx/thebes/gfxTextRun.cpp:1060-1073`) and drops break candidates inside a cluster (`:210-225`).
  - Not traced: which call in Blink's overflow path decides these lines.
- **The charter today.** Clusters come from Unicode data (DESIGN §5 `glyph-clusters`). Chrome reports no gap at all on 113 of its 245 cases.
- **Main.** It sums graphemes measured alone (`src/measurement.ts` `getSegmentBreakableFitAdvances`, mode `sum-graphemes`). Isolated Arabic forms are wider than joined ones, so main's line ends before lam even where the joined prefix would still fit.
- **Example.** `c-00520dd17f45f4f9`, `بِلا`, 32px Arial, letter spacing 1, width 24.07px.
  - Native: `بِ` / `لا`.
  - Charter: `بِل` / `ا`.
  - Main: `بِ` / `لا`.
- **What settles it.** A probe per lab font of the pairs that merge clusters. Then either a font fact on the declaration, as `joining` is, or `glyph-clusters` reported at the chosen line edge.

### 3.2 Zero-width content at an overflowing line

- **Counts.**
  - Chrome 128: 74 where only the charter makes the line, 54 where only the browser does. 130 accidental: 20 right count, wrong breaks; 110 zero-width characters elsewhere.
  - Firefox 148: 82 and 66. 32 accidental.
  - webkit-host 1. 3 accidental.

**The charter gives zero-width content its own line.**

- **Chrome:** `prefix-cap-control` 32, `restart-next-word` 18, `space-context` 8, `cluster-v1` 8. The required case `c-9c5a66597ebf5aef` is in this group:
  - text: `a` U+2060 U+0301 `b`, 16px Courier New, letter spacing −4, width 1, `pre-wrap`;
  - native: 3 lines, `a` / U+2060 U+0301 / `b`;
  - charter: 4 lines, splitting U+2060 from U+0301;
  - main: 3 lines.
- **Firefox:**
  - `following-space-scope` 48, `control` 7, `following-space-context` 6;
  - trailing CR, FF, ZWSP, ZWNJ and ZWJ in `pre-wrap`.
  - Example: `c-0287698f4cb03727`, `😀 A` SHY `V` ZWSP `  B`, 18px Times New Roman, 12px. Native keeps the ZWSP and both spaces at the end of `V`'s line; the charter gives them a line.
- **webkit-host:** `c-0774ff114d939edf`, `A` CR TAB `B`, `normal`. Native gives 2 lines; the charter gives 3, with CR TAB alone.

**The browser makes a line of zero-width content.**

- **Chrome:** `following-space-scope` 40, `following-space-context` 12.
  - Example: `c-062736d14be7e4a3`, `אב A` U+2060 `  B`, 18px Times New Roman, 12px.
  - Native: `א` / `ב` / `A` / (U+2060 and spaces) / `B`.
  - Charter: `א` / `ב ` / `A` U+2060 `  ` / `B`.
- **Firefox:**
  - `measurement` 24.
  - An invisible character at the paragraph start before joined Arabic with a soft hyphen (U+200B, U+200C, U+200D, U+2028, U+2029, U+2060, U+FEFF, U+0000, U+001E, U+001F, U+0085). 29 of these are evaluation main-only cases: REPORT §2.4's Firefox losses.
  - VT, U+001C to U+001F, U+0085 or U+2029 after `ب` SHY `ب` in `pre-wrap`.
  - Example: `c-36ea31d4291b5fa8`, ZWSP `ب` SHY `ب`, Amiri, 8px, `pre-wrap`. The first native line holds only the ZWSP; the charter's first line is ZWSP `ب` SHY.

**Rule status.** No Canvas limit explains these shapes, and no gap names them. Candidates in code the charter already ports:

- Blink's overflow handling and break-anywhere retry at grapheme boundaries (`line_breaker.cc:4079-4305`, blink audit §2).
- Gecko's zero-width frame branch of `CanPlaceFrame` (`nsLineLayout.cpp:1189-1342`) and the end-of-line trimmable set (`nsTextFrame.cpp:921-942`: TAB, CR, FF and LF, not VT).
- Firefox's leading-invisible lines also depend on the in-word advance at a soft hyphen between joining letters (gecko audit D1). The invisible character is alone because `ب` SHY is wider natively than the Canvas stand-in says.

**Main.** Its segments keep a trailing zero-width character with the grapheme before it and give a leading one its own line. It has no line-filling model of these characters. Where its zero-width placement is wrong as well, the case is filed as accidental.

**What settles it.** Minimize each shape and trace the ported function. These look like port bugs to fix in place, not facts that need a probe.

### 3.3 Punctuation and Latin after another script

- **Counts.** Chrome 77 (185 right count, wrong breaks; 4 zero-width elsewhere; 9 main's own history). Firefox 40 (9 accidental). webkit-host 12 (6 accidental).
- **Chrome.** HarfBuzz shapes Common punctuation inside the surrounding script run, while Canvas shapes each word alone. Amiri's lookups differ by script (`harfbuzz_shaper.cc:1072-1101`, DESIGN §5 `script-context`).
  - Families: `mixed` 53, `raw-context` 10, `space` 8.
  - Example: `c-0ee9c6f260c7db47`, `αβγ([tail`, 16px Amiri, letter spacing −1, 26.5px. Native `αβγ` / `([tai` / `l`; charter `αβ` / `γ([t` / `ail`.
- **Firefox.** `gfxScriptItemizer` runs, with the gecko audit B2 caveat that the recipe assumes nothing shapes across U+0020.
  - Example: `c-0157134b8bc06975`, `a` SHY `aabb((بب`, Amiri, 12px, `pre-wrap`. Native puts `(` and `ب` on separate lines; the charter keeps `(ب`.
  - `accepted-l` 6: `a(α` SHY `β)b` in Amiri, where native breaks between `a` and `(`.
- **webkit-host.** 11 of the 12 report no gap.
  - Example: `c-49feb03a06bd4b90`, `بِبِ` CR `aabb((بب`, 24px Amiri, 8px. Native breaks between `b`, `(` and `(`; the charter keeps `b((`.
  - To trace in `breakWord` and the path where not even the first glyph fits.
- **Main.** In Chrome most of these shapes are accidental. Main keeps one OffscreenCanvas context for every prepare (`src/measurement.ts` `getFontMeasurementState`), and Chrome's Canvas keeps a word's first shaping per canvas, script context included (DESIGN §5, "Chrome's per-canvas shape cache"). Main's widths therefore depend on what the page measured earlier (§4).
- **What settles it.**
  - Chrome: a probe of DESIGN §5's context recipe per font. REPORT §4 gives `script-context` a weak lift of 1.22 and 1.64.
  - Firefox: a probe of itemization around U+0020 in Amiri.
  - WebKit: a trace.

### 3.4 WebKit turns ligatures off under letter spacing

- **Counts.** webkit-host 644 (61 right count, wrong breaks; 7 zero-width elsewhere). Families: `ligature-thresholds-v3` 505, `word` 45, `mixed` 43, `cluster-v1` 18.
- **Source.** `StyleComputedStyleBase.cpp:318-333` sets `shouldDisableLigaturesForSpacing` whenever letter spacing isn't 0 (`FontDescription.h:206`). OffscreenCanvas keeps optional ligatures at any spacing (probe webkit-canvas H3 and H4, verified in installed Safari; TAKE-BACK §5, row 5.4).
- **The charter today.** It names `letter-spacing-ligatures` and has no recipe (DESIGN §5).
- **Main.** It measures prefix widths at letter spacing 0 and adds (graphemes − 1) × spacing in JavaScript (`src/layout.ts` `addInternalLetterSpacing`). That equals the DOM only where a font's ligature is as wide as its parts, as the ProbeShantell fixture's ligatures appear to be.
- **Example.** `c-0033f34a9d6b3f85`, `affinity`, bold 16px ProbeShantell, letter spacing −4, 20.224px, `pre-wrap`.
  - Native: `affini` / `ty`.
  - Charter: `aff` / `init` / `y`.
  - Main: `affini` / `ty`.
- **What settles it.** A probe for a Canvas string that shapes without optional ligatures but keeps kerning, such as U+200C between graphemes. Otherwise the gap stays.

### 3.5 U+202F at a line end

- **Chrome: 49 (19 accidental).** Families: `chromium-script-spacing` 36, `maintained/kinsoku-units` 13.
  - `c-0ad8efa00cffe92f`: `x(ꡀꡁꡂ)` U+202F, 16px Arial, letter spacing 1.5, 10px, `pre-wrap`. Native gives U+202F its own line; the charter keeps it after `)`.
  - `c-08bceab4491a000c`: `中（ابب）` U+202F, 16px Arial, letter spacing −2, 49px. Native keeps U+202F after `）` in 2 lines; the charter gives 3.
  - Candidate rule: TEST-ARCHITECTURE §7.3's "no break before U+202F (class GL) after `）`", to settle by a probe and a parity test over Chrome 153's line tables. How letter spacing enters isn't isolated.
- **Firefox: 26 (4 accidental).** The texts end in U+202F, but the lines differ at the Mongolian, Syriac and N'Ko letters.
  - Example: `c-0eff2962a1de9496`, `ᠠᠡᠢ(x)` U+202F, 16px Arial, 10px. Native gives one letter per line; the charter keeps `ᠠᠡ`.
  - This is the in-word advance class (gecko audit D1, whose example is `c-ddb7b0c21bf3d492`).

### 3.6 U+FFFC in Chrome

- **Counts.** 18 (44 accidental).
- **What differs.** Chrome's Canvas measures U+FFFC as U+200B (the port's `font-fallback` detail), while the DOM draws a fallback glyph with an advance.
- **What settles it.** Blink audit C-u4 asks for the probe: which font draws U+FFFC, and a character Canvas doesn't normalize that measures the same.
- **Example.** `c-813555086b11aed1`, `ب` SHY `ب` U+FFFC `ب`, 16px Arial, 11.35px, `pre-wrap`. Native gives U+FFFC its own line; the charter gives U+FFFC `ب`.
- **Main.** It measures U+FFFC through Canvas too, and 44 of its 62 passes are right count, wrong breaks.

### 3.7 Myanmar paragraphs in Chrome

- **Counts.** 55: 51 corpus canaries and 4 `my-bad-deeds-return-to-you-teacher`.
- **What differs.** Line ends are a few units off native in 20px Myanmar MN. TEST-ARCHITECTURE §7.3 painted `c-95bbe646a6febe00`'s first line at 528.28125px against 539.09375px predicted.
- **Candidate.** A Canvas-versus-DOM width difference for Myanmar text, or its break opportunities. Probe before any recipe.
- **Main.** Its whole-segment Canvas widths happen to agree at these widths.

### 3.8 Joined letters at an overflow break, other shapes

- **Chrome: 24 (20 accidental).**
  - `c-06218d32a4b76797`: `صلىالله`, 16px Courier New, 8px. Native gives one letter per line; the charter keeps `له`.
  - `following-space-scope` 12: `آگ` ZWJ ` A`, 16px Arial, 24px (`c-8dcc052db7b0297f`). Native gives 2 lines, the charter 1.
  - CR or FF before `ب` SHY `ب` in Amiri at 3px.
- **Firefox: 62 (25 accidental).**
  - `joined` 46, `control` 13, `cluster-v1` 2.
  - Example: `c-082d325a50f8ca53`, `ب` SHY U+0650 `ب`, 16px Times New Roman, letter spacing 1, 15.37px. Native gives 2 lines, the charter 1.
- **Rules.** Both engines hit Canvas limits the charter names:
  - Blink reshapes line edges at HarfBuzz unsafe-to-break offsets (`unsafe-to-break`).
  - Gecko takes in-word advances from one shaping's glyph records (`in-word-prefix`, gecko audit D1).
- **What settles it.** The D1 probe for Gecko, and a trace of the reshaped edge for Blink.

### 3.9 Latin kerning and ligatures at an overflow break

- **Counts.** Chrome 12. Firefox 21 (2 accidental).
- **Examples.**
  - `c-16f06b3ef08ca7ce`: `VAWAVAV`, 16px Times New Roman, letter spacing −1, 20.98px. Native `VA` / `W` / `AV` / `AV`; charter `VA` / `WA` / `VA` / `V`.
  - `c-6e6203a7729561b4`: `1111{{tail`, 16px Times New Roman, 15.35px. Native puts one `1` per line; the charter keeps `11`.
  - Firefox's required `c-ed263bd4b6656704`: `Superlongword…`, 24px Helvetica Neue, 150px. Native line 2 starts at offset 11 and the charter's at 12. Its required line count now passes.
- **Rules.** Blink `unsafe-to-break`; Gecko's in-word advance (D1).
- **Main.** It sums graphemes measured alone, without kerning or ligatures, which here equals what the browser fits.

### 3.10 Smaller groups

None of these has a named Canvas limit, and each needs a trace before a rule.

- **Chrome, 14:**
  - `prefix-cap-control` 8: long runs with a control and a mark at width 1.
  - `ideographic-source-edge` 2: `a` U+0600 U+3000 `b` in Amiri, where native breaks between `a` and U+0600, a prepended concatenation mark.
  - `mixed` 2 and `script-prefix-heldout` 2: emoji or letters before `))` in Amiri.
- **Firefox, 14:**
  - `accepted-l` 4.
  - `cross-item` 3: `a` ZWSP U+0301 `)ब` in Georgia, where native breaks between the ZWSP and the mark. The census already noted this group reports no gap.
  - `signed-spacing` curly quotes 4: `||||‘‘tail`, 16px Arial, letter spacing 1.5, 27.37px.
- **webkit-host, 2:** `😀A` FF TAB `B` in `normal` at 48px. Native keeps FF with `A`; the charter's line 2 is `A` FF TAB `B`.

## 4. Accidental passes

Nothing of main's is admitted from these cases. Where the charter's miss is real, the same shape appears in §3 and is learned there.

### 4.1 Right count, wrong breaks

- **Counts.** Chrome 316, Firefox 89, webkit-host 70.
- **Chrome by cause.** Punctuation after another script 185, U+FFFC 44, ligature clusters 24, zero-width lines 20, joined letters 20, U+202F 19, others 4.
- **Chrome families of the punctuation group.** `raw-context` 38, `physical-window-terminal-seam` 34, `hidden-control-spacing` 22, `mixed` 21, `source-shaped-arabic` 20, `original-vs-reshaped-admission` 16.
- **Firefox by cause.** Ligature clusters 42, joined letters 25, punctuation after another script 9, others 13.
- **webkit-host by cause.** Letter-spacing ligatures 61, punctuation after another script 6, zero-width lines 3.
- **Examples.**
  - `c-1267fee582f30f2c`: `ب` SHY `ب` U+FFFC `ب`, 16px Arial, 15.35px, `pre-wrap`. Native starts lines at 0, 3 and 4; main at 0, 2 and 4.
  - `c-15392ecfc5a69b77`: `aبِبِ((tail`, 24px Amiri, 15.5px. Native starts lines at 0, 3, 5, 6, 7, 8 and 9; main at 0, 1, 3, 5, 7, 8 and 9.
  - All 16 `original-vs-reshaped-admission` cases in REPORT §2.5's main-only list are of this kind, as TEST-ARCHITECTURE §7.3 found under scorer 1.

### 4.2 Main's own page history

- **Counts.** Chrome 9 cases where main passes in file order and fails in reverse. 141 other Chrome cases in the population also get other main predictions in reverse; they are counted under §4.1 or §4.3.
- **Mechanism.** Main's widths depend on what its shared Canvas context measured earlier (§3.3).
- **In the census.** 146 Chrome main-only cases were main-only only because of main's history.

### 4.3 Right count and visible breaks, zero-width characters on other lines (provisional)

- **Counts.** Chrome 120, Firefox 36, webkit-host 7.
- **Example.** `c-08ead50c71a1abcf`, `a` SHY U+0301 `b`, 16px Courier New, letter spacing −4, width 1, `pre-wrap`.
  - Native: `a` / SHY U+0301 / `b`.
  - Main: `a` SHY / U+0301 / `b`.
  - Charter: `a` / SHY / U+0301 / `b`.
- **Why provisional.** The check reads native line membership of zero-width rects without an observation port for main. The shapes are §3.2's, where the browser behaviour is learned anyway.

## 5. Opinions dropped

1. **Requiredness of `c-9c5a66597ebf5aef`.** Main requires api, height and line count on its `maintained/entry-geometry` witnesses to hold its entry-geometry heuristic (tests/wrapping/INVENTORY.md, "Entry geometry"). The lab's obligations importer already leaves those witnesses out. The line count stays a fact (§3.2).
2. **Engine-keyed quote rules, 2 Chrome cases:** `curly-double-open` and `spacing/curly-double-open` with `lang=""`.
   - Chrome decides these from its application locale (DESIGN §1.4), and main keys its quote rules on the engine (`src/measurement.ts` engine profile), so main's pass follows this Mac's zh-CN application locale.
   - The fact is already in the charter as an explicit input that the lab doesn't record yet (DESIGN §8.3 stage 0, REPORT §7 item 3).
   - The third `ui-language` case, `ascii-matrix`, is right count, wrong breaks.
3. **Main's widths-only census passes:** Chrome 519, Firefox 85, webkit-host 386.
   - They were scored with the old scorer's visible extent, main's observer definition of width. Tentpole 2 replaced it with the engine width against the union of the boxes.
   - Under scorer 2 the charter passes 159, 15 and 360 of these cases, fails 242, 70 and 10, and leaves 118, 0 and 16 unobserved.
   - Its failures by family:
     - Chrome: `following-space-scope` 102, mostly `script-context`; `chromium-script-spacing` 86, U+202F under letter spacing; `following-space-context` 48.
     - Firefox: `measurement` 25, emoji sizes and U+FE0E; `chromium-script-spacing` 20, `x  ` with letter spacing; `cross-item` 11.
     - webkit-host: `word` 7 and `mixed` 2, letter-spacing ligatures.
   - Main's passes aren't evidence, and main can't be compared under scorer 2.
4. **Carried over unchanged** from TEST-ARCHITECTURE §7.3 and TAKE-BACK §1:
   - the accuracy grid's height tolerance below 1px;
   - `wrap-4faaad4b08f18c01`'s count taken from a 1/64px paragraph height;
   - main's `api` metric;
   - source-view curation and direction-conflict status.

## 6. Required obligations

- **Lab obligations** (7,791 non-canary cases). The charter passes every required pair, with no failures:

  | Browser | lineCount | breaks | widths |
  |---|---:|---:|---:|
  | Chrome | 7,776 | 52 | 8 |
  | Firefox | 7,732 | 37 | 8 |
  | webkit-host | 7,778 | 54 | 9 |

- **Suite-required cases the importer leaves out.** There are 20: 14 `richHeight` span-per-part rows and 6 entry-geometry pins. One fails: Chrome `c-9c5a66597ebf5aef` on line count (§3.2, §5).
- **The census's other required regression.** Firefox `c-ed263bd4b6656704` now passes its required line count. Its breaks, which main doesn't require, still fail (§3.9).

## 7. Against the census

- **Resolved.** Of the census's main-only cases (1,191, 731 and 2,056), 125, 23 and 1,320 no longer regress.
  - webkit-host's 1,320 include the cases the census reruns found laying out otherwise in fresh documents (1,340).
  - On this run's documents the charter passes them, and main fails 972 of their line counts.
- **Still regressing.** The census's stable main-only cases: Chrome 926 of 1,045, Firefox 708 of 731, webkit-host all 716.
- **New with the charter**, from the evaluation's main-only lists:
  - Chrome 3, all `ui-language`.
  - Firefox 37: 29 leading-invisible lines, 7 lines only the charter makes, 1 punctuation case. They come from the removed U+200D recipe (REPORT §2.4).
  - webkit-host 0. 16 of its 25 evaluation main-only cases pass for the charter and fail for main here.
- **Not covered.** The charter wasn't run over the full census. Cases where main and the old library both passed and the charter now fails are known only from the 30,000-case evaluation samples.

## 8. Decisions for the maintainer

1. **Observation-only outcomes.** Accept "right count, wrong breaks" (316, 89, 70) and "main's own history" (Chrome 9) as accidental without per-case probes.
2. **Zero-width placement.** Accept it as accidental (120, 36, 7), or keep those cases undecided until an observation port covers zero-width rects.
3. **Ligature clusters** (Chrome 245, Firefox 309). Choose a font fact on the declaration, a Canvas recipe after a probe, or `glyph-clusters` reported at the chosen line edge. Recommendation: report the gap now, since Chrome reports none on 113 of them.
4. **Zero-width content at an overflowing line** (Chrome 128, Firefox 148, plus the required case). Recommendation: trace these as port bugs before any probe; no gap names them.
5. **WebKit letter-spacing ligatures** (644). Probe a Canvas recipe, or keep the gap. Main's formula isn't admitted.
6. **Gecko's in-word advance** (D1). The leading-invisible lines, joined letters, joined-script letters and Latin kerning groups (Firefox 66, 62, 26 and 21) all wait on the same DOM-geometry probe. REPORT §7 item 2 recommends keeping the removed recipe out.
7. **Chrome punctuation after another script** (77 facts, 198 accidental). Probe DESIGN §5's context recipe per font, or keep the weak gap.
8. **U+FFFC** (Chrome 62) and **Myanmar** (Chrome 55). Both need probes.
9. **Triage records.** Drop the requiredness of `c-9c5a66597ebf5aef`, and have `obligations` read triage records (TEST-ARCHITECTURE §7.1). The records exist as `.artifacts/charter-20260916/triage/analysis/<browser>-triage.json` (id, family, outcome, cause), not yet as `rebuild/lab/triage/main-<browser>.ndjson`.
10. **Full census.** Rerun it with the charter library to close the population, or accept the evaluation samples. The census took about 7 hours of locked browser time with the old library, and rows are larger now.
11. **Widths-only passes.** Drop main's widths-only census passes as evidence (recommended).

## 9. Files

Everything is under `.artifacts/charter-20260916/triage/`:

- `cases/`: `<browser>.ndjson` with `-small`, `-long` and `-widths` splits, `<browser>-reasons.json`, and `obligations.ndjson` with its summary.
- `tools/`:
  - `build-cases.py`, `chain.sh`, `chain-widths.sh`;
  - `analyze.ts`, which imports `rebuild/lab/score.ts`;
  - `population.py`, `classify.py`, `explore.py`.
- `runs/<browser>/{charter,main}-{file,reverse}/{small,long,widths}/`: rows, `run.json` and logs. Chain logs are `chain.log` and `chain-widths.log`.
- `analysis/`:
  - `<browser>.ndjson` and `<browser>-widths.ndjson`: per-case records with native, charter and main lines, metrics, gaps and history;
  - `<browser>-population.json`, `-required.json`, `-triage.json`;
  - `-classify.txt` and `-explore.txt`: groups with examples.
