# Gecko superset analysis: where main beats the rebuild in Firefox, and what main supports that the rebuild doesn't

Scope:
- **Cases:** Firefox 156 rows of the full-suite census (`.artifacts/research-20260916/census/`). "Main-only" means main passes a metric and the rebuild doesn't:
  - 731 cases on line count or breaks, all stable in the census's fresh-session reruns;
  - 85 more cases on widths only;
  - 816 cases in all: 422 main-only line counts, 620 breaks and 103 widths.
- **Source trees:** Library `rebuild/src` at tree ecdef04b; main 2e5e2bd.
- **Rules followed:** No edits to `rebuild/src`, no commits. One Firefox run under the shared lock, background only.

## 0. Answers

| Cause | Cases | line count | breaks | widths |
|---|---:|---:|---:|---:|
| **Rebuild bug, fixable from the pinned source** | **139** | 48 | 41 | 102 |
| · font matching reads the character before an invisible character | 40 | 11 | 10 | 39 |
| · letter spacing after a mark that follows a removed soft hyphen | 24 | 24 | 11 | 0 |
| · Apple Color Emoji size fix applied to a text-presentation `©︎` | 24 | 0 | 0 | 24 |
| · shaping units that cross script runs | 22 | 13 | 16 | 10 |
| · the library's copy of the lab's width rules | 15 | 0 | 0 | 15 |
| · pair kerning in reversed (RTL) runs | 14 | 0 | 4 | 14 |
| **Named gap where main happens to win, reachable only with pinned per-font data** | **477** | 193 | 447 | 0 |
| · legacy `kern`/`kerx` tables split each kerning value between both glyphs | 105 | 100 | 105 | 0 |
| · the lam-alef ligature's width sits on lam during the break scan | 372 | 93 | 342 | 0 |
| **Named gap, not reachable with Canvas measureText alone** | **199** | 181 | 132 | 0 |
| · Arabic joining and contextual forms (Amiri, Noto, Courier New) | 83 | 77 | 67 | 0 |
| · Latin ligatures at a break inside a word (Amiri `ffi`, ProbeShantell `difficult`) | 61 | 54 | 37 | 0 |
| · lam-alef in fonts where the whole-ligature rule fails | 27 | 26 | 4 | 0 |
| · Mongolian, Syriac and Phags-pa joining forms | 26 | 24 | 22 | 0 |
| · not traced (`AVATAR` in Times New Roman at letter spacing −4) | 2 | 0 | 2 | 0 |
| **Page history** | **1** | 0 | 0 | 1 |
| **Total** | **816** | **422** | **620** | **103** |

**How the causes were checked.** Every cause in the first two groups was tested in installed Firefox, not only argued from the source:
- **The experiment.** A copy of the library had each candidate fix behind its own switch (a flag that turns that one fix on). One run laid out the 816 cases and 5,000 control cases.
- **The baseline copy.** With every switch off, it reproduces the census on 815 of 816 cases. The 816th is the page-history case, which passes in the fresh session.
- **Source fixes.**
  - Five of the six pass every targeted case with no control regression.
  - The emoji switch passes its 24 cases but regresses 27 controls, so that bug is confirmed but its fix isn't (§2.1 E).
- **Font-data switches.**
  - Legacy kerning: 105 cases pass, 37 control metric results improve, 0 get worse.
  - Lam-alef, keyed on the letters alone: 372 pass, 33 control results improve, 26 get worse. So which fonts ligate is font data.

**Main's advantage is not a tolerance.** Main's line-fit tolerance (`src/measurement.ts:302`, 0.005px; used at `src/line-break.ts:323`, `:577` and `:986`) decides at most 1 of the 816 cases (`c-86e18c3be62a7e98`). Main wins in four ways:
- **Isolated widths.** It measures graphemes one by one or as growing prefixes. That overstates joined prefixes, on the same side of the threshold as Gecko's ligature and split-kerning rules.
- **Control characters.** It counts U+0000 as 13px.
- **Longer strings.** It measures a longer string, so Canvas applies the same font matching.
- **A DOM read** for emoji.

In the same families these measurements lose far more cases than they win (census, Firefox, rebuild-only against main-only):

| family | line count | breaks |
|---|---|---|
| `joined` | 1,711 / 94 | 1,832 / 236 |
| `mixed` | 1,751 / 25 | |
| `raw-context` | 3,616 / 26 | |
| `measurement` | 549 / 36 | |
| `chromium-script-spacing` | 439 / 28 | |

**Superset estimate for Gecko on this suite.**
- **Six source fixes:** metric losses to main fall to 374 / 579 / 1 (line count / breaks / widths). The remaining width is the page-history case.
- **Plus two font-data tables:** 181 / 132 / 1.
- **What stays:**
  - the 199 in-word glyph cases;
  - main's emoji DOM read;
  - browsers other than the pinned versions.

  Keeping those out is the right trade (§4).

## 1. Method

### 1.1 Data

- **Stable main-only rows.** 731 lineCount/breaks cases from `census/history/firefox/forward` (native + rebuild, fresh session) and `main-forward`.
- **Widths-only cases.** 85 cases from the census chunk rows. They are in `superset-gecko/widths-only-rows.ndjson` and `widths-only-main-rows.ndjson`, and `widths-only.ts` prints them. They weren't history-rerun by the census; the experiment session reran them.
- **Features.** `features.ts` computes structural facts for every case into `features.ndjson`:
  - it runs `prepareGecko` over a stand-in Canvas, where widths are irrelevant;
  - facts: the first line where native and rebuild disagree (parsed from the scorer's breaks detail); whether that offset is inside a shaping unit; letters joining across it; lam before alef; script-run limits inside the unit; the frame's bidi level; the gap detail.
- **Native geometry.** Per-code-point Range rects from the rows.
- **Source.** `~/github/browser-engines/firefox-156.0`. HarfBuzz isn't vendored in that tree copy, so the HarfBuzz citations come from Chromium 152's copy (`chromium-152/src/third_party/harfbuzz/src/src`). Firefox 156's HarfBuzz version wasn't checked.

### 1.2 Experiment

- **The copy.** `superset-gecko/src-variants/` is `rebuild/src` with switches in `engines/gecko/variant.ts`:
  - 13 lines added to `prepare.ts`, 38 to `lines.ts`;
  - the copied Gecko tests pass (31) with every switch off.
- **Predictor.** `variants-predictor.ts` lays each case out 12 times: every switch off, each switch alone, the six source switches together, and those plus both font-data switches.
- **Cases.**
  - the 816 main-only cases;
  - a control sample (seed `superset-gecko-20260917`): 4,000 random cases from the 34 families involved and 1,000 from other families, all at most 1,000 UTF-16 units, none main-only.
- **Run.** One Firefox job under the lock (`superset-gecko-variants-firefox`), 5,816 rows, no native, prediction or painter errors (`experiment/firefox-run.json`).
- **Scoring.** `score-variants.ts` scores each variant's lines against the same native row with `score.ts scoreRow`, into `variants-per-case.ndjson` and `variants-summary.json`.
- **Attribution rule.**
  - A case belongs to the first single source switch that passes every metric main passes. No case passed with two different single switches.
  - Otherwise it belongs to the first font-data switch that passes it.
  - Otherwise to a named-gap class by its features.
  - Files: `attribution-final.json`, `attribution-summary.json`.
- **Limits.** Zero regressions in 4,000 touched-family controls bounds the regression rate at about 0.075% (95%); it doesn't prove zero over the 111,745 touched cases. Switches were tested alone and in the two combinations only.

## 2. The causes

### 2.1 Rebuild bugs fixable from the source (139)

#### A. Font matching reads the previous character (40; no gap named on any of them)

- **Examples.**
  - `c-924c3bf3d268e1fc`, `a` ZWSP U+0301 `)ब` in 16px Georgia at 12px.
    - Native: `[a] | [U+0301] | [)] | [ब]`, and the accent's rect is 8px wide.
    - Rebuild: `[a ZWSP U+0301] | [)] | [ब]`. It gives U+0301 0px, so the accent fits on line 1.
  - `c-45b5cf6fc74abe79` and the 20 widths-only cases like `c-00559b464fe0094e`, `x U+2028 U+202F` in 16px Arial.
    - Native: U+202F is 0px wide (12.5px line at letter spacing 1.5 = 8 + 3 × 1.5).
    - Rebuild: U+202F is 3.2px, and at width 10 it gets its own line.
- **Source.**
  - Invalid characters (U+200B, U+2028) end a shaped word (`gfx/thebes/gfxTextRun.h:975-990`), but font matching still sees them.
  - `gfxFontGroup::FindFontForChar` gives a cluster extender the previous character's font, and has a special case for U+202F (`gfx/thebes/gfxTextRun.cpp:3181-3212`).
  - The rebuild measures the unit after the invalid character on its own (`rebuild/src/engines/gecko/prepare.ts:851` through `rangeAu`, `:497-505`). Canvas then picks another font for the accent or the NNBSP.
- **Fix.** When a unit starts with a cluster extender or U+202F right after an invalid character, measure `W(prev + unit) − W(prev)`.
  - Switch `prevCharContext`: 40/40 pass, 0 control changes.
  - These 40 include all 11 "no gap named" Firefox cases in the census report (4 `x U+2028 U+202F`, 7 ZWSP + accent).
- **What main does.** Main keeps `x U+2028 U+202F` in one segment and measures it as one Canvas string, so Canvas runs the same font matching. It is right here as a side effect of how main groups segments.

#### B. Letter spacing after a mark that follows a removed soft hyphen (24)

- **Example.** `c-082d325a50f8ca53`, `ب` SHY U+0650 `ب` in 16px Times New Roman, letter spacing 1, width 15.37.
  - Native: `[ب SHY] | [U+0650 ب]`. The kasra's rect is 1px wide, which is the letter spacing, so the unbroken word would be 16.32px.
  - Rebuild: one line at 15.317px, with no spacing.
- **Source.**
  - `FindClusterStart` stops at a skipped original character (`layout/generic/nsTextFrame.cpp:3549-3560`). The letter-spacing loop takes the cluster's base character from there (`:4203-4213`).
  - After a removed soft hyphen, the base is the kasra itself, whose script is Inherited, not cursive, so Gecko adds spacing.
  - The rebuild walks back over transformed indices to the beh, which is cursive, and adds none (`prepare.ts:762-766`).
- **Gap.** The gap named is `in-word-prefix` "letters join across it", which isn't the cause.
- **Fix.** Switch `spacingBase`: 24/24 pass. Controls: 8 metric results better (`a\tب­ِب` in Times New Roman, Shantell Sans and Arial), 0 worse.
- **What main does.** Main adds letter spacing between every grapheme of a segment (`src/layout.ts:174-196`), cursive or not. Here it lands where Gecko's does; for joined Arabic with letter spacing it is wrong.

#### C. Shaping units cross script runs (22; `in-word-prefix` at the right offset, wrong mechanism)

- **Examples.**
  - `c-069841252e31724f`, `a(α­β)b` in 16px Amiri at 10.75px.
    - Native: `[a] | [(] | [α­] | [β] | [)] | [b]`.
    - Rebuild: `[a(] | … | [β]` at 12.15px, where native β is 8.9px.
  - `c-359baa3f7432a0a9`, `a(\nα­)` pre-wrap. Native line 2 is 13.85px; the rebuild says 17.1px. `W("α)")` is 1026 au whole and 831 au in parts.
  - `c-3b260e35605e926b`, `αβγ(abc)` in Shantell Sans.
- **Source.**
  - `gfxFontGroup::InitTextRun` calls `InitScriptRun` once per script run (`gfxTextRun.cpp:2779-2809`), so a shaped word never spans two script runs.
  - The script itemizer's bracket stack gives `)` the script of its `(`.
  - The rebuild's unit loop ends units only at spaces and invalid characters (`prepare.ts:846-850`). It measures a unit across script runs as one Canvas string, where an unpaired `)` joins the Greek run.
- **Fix.** Switch `scriptSplit` (units also end at script-run limits): 22/22 pass, 0 control changes.
- **What main does.** A soft hyphen splits main's segments, and main measures the pieces separately, so it measures the runs apart by accident.

#### D. Pair kerning in reversed runs (14; widths-only 10)

- **Examples.**
  - `c-7b805b52de2b9986`, `||||’’tail` in 16px Arial, letter spacing 1.5, RTL, width 27.37.
    - Native: `[||||]` 22.6 | `[’’ta]` 26.167 | `[il]`.
    - Rebuild: `[||||’]` 27.367 | `[’tai]` | `[l]`.
  - `c-17d1e4e2bab01a47`: 17 au off on the first line.
- **Source.**
  - Gecko shapes Common and Inherited runs as Latin (`gfx/thebes/gfxHarfBuzzShaper.h:83-94`).
  - HarfBuzz reverses a run whose script is natively LTR when it's shaped RTL (`hb-ot-shape.cc:588-645`, `hb_ensure_native_direction`). A pair adjustment then lands on the logically later glyph.
  - The rebuild's recipe gives it to the earlier glyph (`lines.ts:56`). That's exact for LTR GPOS fonts (Arial and Amiri have a GPOS `kern` feature) and wrong for reversed runs.
- **Fix.** Switch `rtlKern`: 14/14 pass, 0 control changes.
- **What main does.** Under letter spacing main uses growing prefixes (`src/measurement.ts:455-468`), which put any kerning on the later grapheme. That's right for reversed runs and wrong for LTR GPOS fonts.

#### E. Apple Color Emoji size fix on a text-presentation cluster (24 widths; gap `bitmap-emoji-size` named, not the cause)

- **Example.** `c-0a1e684e77a9d8bb`, `©︎/©️` in 16px "Apple Color Emoji". Native `©︎` is 12.15px; the rebuild says 12.167px (1 au).
- **Source.**
  - A text-presentation request makes `FindFontForChar` look for a font without color glyphs (`gfxTextRun.cpp:3268-3308`), so `©︎` draws in a text font at its CSS-size advance.
  - The rebuild decides "drawn by Apple Color Emoji" when the cluster measures the same in the run's font list as in `"Apple Color Emoji"` alone (`prepare.ts:891`). When the run's family is Apple Color Emoji, both contexts fall back to the same text font, so the test always says yes.
- **A switch that isn't the fix.** Switch `sbixGate`, which applies the device-size advance only to clusters that ask for a color glyph:
  - It passes 24/24 but regresses 27 control widths, all `😀😀︎`, `😀︎😀` and `❤️😀︎` in `suite/measurement`, for example `c-015aa7d0bec6fdf5`.
  - No text font has U+1F600, so the DOM still draws `😀︎` with Apple Color Emoji: native 22.5px at 24px with letter spacing −1.5.
- **Next step.** The bug is real, but the fix needs a test that can actually fail.
  - Candidate: Apple Color Emoji's bitmap advances don't scale with the size, while a text font's do (probe F3: 1260 au at 16px, 1920 au at 32px). Canvas at the CSS and device sizes can show that.
  - That candidate needs a probe.
- **What main does.** Main reads a span's width once per font (`src/measurement.ts:341-370`), a DOM read the brief forbids. It applies the difference only to graphemes matching `\p{Emoji_Presentation}|\p{Emoji}️` (`:149`); `©︎` doesn't match, so main uses Canvas's value.

#### F. The library's copy of the lab's width rules (15 widths; no gap)

- **Examples.**
  - `c-30c8113664b9b734`, `a ␠ U+064B ␠ b` in 16px Courier New, pre-wrap, letter spacing −2. Native line 2 is 0px; the rebuild says 2px.
  - `c-0b26b4c299136040`, `a U+3000 U+FE0F b` in 24px Amiri. Native 34.083px; the rebuild says 10.083px.
- **Source.**
  - `lines.ts:638` gives every word piece a rect whatever its advance, so a mark with −2px spacing reads as a 2px extent.
  - `lines.ts:652` lets U+3000 hang even where U+FE0F is in its cluster.
  - Gecko's trailing white-space count resets at any character that isn't a space (`gfxTextRun.cpp:1152-1159`).
  - This is the lab's measurement living in the library (gecko audit F9), not Gecko layout.
- **Fix.** Switch `widthRules`: 15/15 pass. Controls: 1 better, 0 worse.
- **What main does.** Main hangs only preserved spaces (`src/line-break.ts:69-71`) and gives zero-advance marks no width.

### 2.2 Named gap where main happens to win, reachable only with pinned per-font data (477)

#### G. Legacy kerning tables split each kerning value (105)

- **Fonts.** Times New Roman 104; Helvetica Neue 1, which is the old suite's only required Firefox regression, `c-ed263bd4b6656704`.
- **Mechanism.**
  - HarfBuzz uses a `kerx` or legacy `kern` table when the font has no GPOS `kern` feature (`hb-ot-shape.cc:160-187`).
  - Its kerning machine gives `kern >> 1` to the first glyph and the rest to the second (`hb-kern.hh:102-106`). Both `kern` and `kerx` subtables use it (`hb-ot-kern-table.hh:73`; `hb-aat-layout-kerx-table.hh:116`, `:447`, `:741`).
  - Font tables read on macOS 27 (`sfnt` table directories):

    | font | kerning source |
    |---|---|
    | Times New Roman | `kern`, plus a GPOS with no `kern` feature |
    | Verdana | `kern`, plus a GPOS with no `kern` feature |
    | Helvetica Neue | `kern` and `kerx`, no GPOS |
    | Geeza Pro | `kern`, no GPOS |
    | Arial | GPOS `kern` |
    | Amiri | GPOS `kern` |
    | Shantell Sans | GPOS `kern` |
    | Georgia | none |
- **Native evidence.** `c-0320b489824a990f`, `😀 A­V ZWSP B` in 18px Times New Roman at 12px.
  - Natively A and V are 11.833px each: the −140 au `AV` kerning split −70/−70.
  - The rebuild gives V 13px, all the kerning on A. V overflows, and ZWSP + space get their own line (4 native lines, 5 predicted).
- **Gap.** `in-word-prefix` names the right offset.
- **Why Canvas can't see it.** A split kerning value and a GPOS one give the same total and the same ink.
- **Switch `legacyKern`.** This is a four-font table keyed by family name, an experiment, not a proposal:
  - it fixes 105/105, including `c-ed263bd4b6656704` and every `following-space-scope` (72) and `following-space-context` (12) case;
  - controls: 37 widths better, 0 worse.
- **What main does.**
  - At letter spacing 0, main's in-word widths are isolated graphemes (`src/measurement.ts:418-427`), so kerning is nowhere.
  - At nonzero spacing it uses growing prefixes, which put kerning on the later glyph.
  - Both are closer to a half split than "all on the earlier glyph", by accident.

#### H. The lam-alef ligature's width sits on lam in the break scan (372)

- **Mechanism.**
  - `BreakAndMeasureText` sums per-character glyph advances (`gfxTextRun.cpp:1139-1149`).
  - HarfBuzz attaches a ligature's glyph to its first character; the other characters are continuations with no glyph (`gfxHarfBuzzShaper.cpp:1780-1786`).
  - So the scan's advance before alef already holds the whole ligature, and a break between lam and alef never fits more text.
- **What the rebuild does.** Its recipe `W(unit) − W(U+200D + suffix)` (`lines.ts:42-46`, gecko audit D1, chosen by score) gives lam only part of the ligature.
- **Native check.** 387 main-only cases break at an offset between lam and alef:
  - 332 break natively before lam, and in all 332 the previous line's width plus the ligature's rects exceed the available width;
  - in 32, lam and alef sit on different lines natively;
  - the other 23: 4 have lam not at the start of a line; in 19, lam or alef has no positive rect.
- **Example.** `c-00520dd17f45f4f9`, `بِلا` in 32px Arial, letter spacing 1, width 24.067.
  - Native: `[بِ]` 7.817 | `[لا]` 19.217. 7.817 + 19.217 = 27.03 > 24.067.
  - Rebuild: `[بِل]` 19.683 | `[ا]`.
- **Switch `lamAlef`** (the ligature goes to lam wherever lam precedes an alef form).
  - Fixes 372: Arial 151, Times New Roman 70, Courier New 68, Shantell Sans 67, Amiri 16.
  - Controls: 33 metric results better, 26 worse. Worse cases include Noto Naskh Arabic `بلامـ…`, `لام` in Arial (`c-c63261da4be7e909`) and Times New Roman (`c-cecb0d43f33fd13d`), and `لاfiلا` in Arial (`c-9e236ba96b150761`).
  - 27 main-only lam-alef cases stay unfixed.
  - Whether a font ligates lam-alef, and how, is font data Canvas totals can't show.
- **What main does.** Isolated widths make the joined prefix look much wider than the DOM's joined forms, so main breaks before lam. Its widths still fail on these cases.

### 2.3 Named gap, not reachable with measureText alone (199)

Every one reports `in-word-prefix`: 191 "letters join across it", 8 on the Latin ligature class's prefix + suffix check. All are glyph facts inside a word that only the paragraph's own shaping records:
- **Arabic joining and contextual forms, 83.**
  - Example: `c-0157134b8bc06975`, `a­aabb((بب` in 24px Amiri at 12px.
  - Native: `[(] | [(] | [ب] | [ب]`, initial beh 5.93px.
  - Rebuild: `[(] | [(ب]` at 9.383px.
  - Main: isolated beh at 22.2px.
- **Latin ligatures at a break inside a word, 61.**
  - Example: `c-0f8013cce650a2f9`, `a U+0000 ffi((tail` in 24px Amiri.
  - Native `[a] | [ffi(]`; rebuild `[a U+0000 ff] | [i((t]`.
  - Gecko's scan gives the `ffi` ligature to the first `f`.
  - Main wins because it counts U+0000 as 13px (lab/BASELINE-main.md caveat), which fails elsewhere: 1,013 of main's 2,026 development Firefox line-count failures are control families.
- **lam-alef in fonts where §2.2 H's rule fails, 27.** Amiri 13, Noto Naskh Arabic 4, Shantell Sans 4, Georgia 2, Noto Nastaliq Urdu 2, Courier New 2.
- **Mongolian, Syriac and Phags-pa joining, 26.**
  - Example: `c-0eff2962a1de9496`, `ᠠᠡᠢ(x)` U+202F in 16px Arial at 10px.
  - Native: initial ᠠ is 12.583px; the rebuild gives `[ᠠᠡ]` 9.267px.
- **Not traced, 2:** `c-1822f1fd2ab0927c` and `c-4137b95d142acb9a`, `AVATAR` in Times New Roman at letter spacing −4. The legacy-kerning switch doesn't fix them.

Recipe tuning doesn't reach these. Round 7's recipe `W(prefix + U+200D)` (switch `zwjPrefix`):
- **On main-only cases:** it fixes 155. That covers all 26 Mongolian, Syriac and Phags-pa cases, 20 of the Arabic joining cases, 15 of the other-font lam-alef cases and 89 of §2.2 H's.
- **On the controls:** 43 metric results worse (line count 10, breaks 16, widths 17) against 35 better. Worse cases: Noto Nastaliq Urdu `raw-context` 8, Amiri `physical-window-terminal-seam` 5, Amiri `joined` 4.

D1 and round 7 each fit a different subset of the cases. Only a shaping model with each font's GSUB/GPOS data would reach them, and that is outside a Canvas-only brief.

### 2.4 Page history (1)

`c-00aaf74d2fa4cb89`, `😀😀︎` in 24px Georgia.
- **In the census:** native layout drew the color emoji (51px), while Canvas was already pinned to a text font (37px). The rebuild names `font-fallback` (probes F2, F3).
- **In the experiment's fresh session:** the rebuild's baseline passes widths.

### 2.5 What the gaps said

- **Right offset, and the cause is what the gap describes:** 676 cases (105 + 372 + 199).
- **Right offset, wrong mechanism:** 36 (script runs 22, reversed kerning 14).
- **A gap that isn't the cause:** 48 (letter spacing 24 under "letters join", emoji 24 under `bitmap-emoji-size`).
- **No gap:** 55 (font matching 40, width rules 15).
- **Page history:** 1 (`font-fallback`).

A gap reported once per paragraph hid 84 real bugs behind an unrelated or absent gap. This is the structural weakness REPORT §7 item 5 points at: gaps aren't tied to the offset that decided the line.

### 2.6 Cases to keep as tests

| cause | cases |
|---|---|
| font matching (A) | `c-924c3bf3d268e1fc`, `c-45b5cf6fc74abe79`, `c-00559b464fe0094e` |
| letter spacing (B) | `c-082d325a50f8ca53`, `c-058b07c4688b3ccd` |
| script runs (C) | `c-069841252e31724f`, `c-359baa3f7432a0a9`, `c-3b260e35605e926b` |
| reversed kerning (D) | `c-7b805b52de2b9986`, `c-17d1e4e2bab01a47` |
| emoji (E) | `c-0a1e684e77a9d8bb`, with its counterexample `c-015aa7d0bec6fdf5` |
| width rules (F) | `c-30c8113664b9b734`, `c-0b26b4c299136040` |
| legacy kerning (G) | `c-0320b489824a990f`, `c-ed263bd4b6656704`, `c-020bbf41eaa7c78a` |
| lam-alef (H) | `c-00520dd17f45f4f9`, with counterexamples `c-c63261da4be7e909` and `c-cecb0d43f33fd13d` |
| unreachable, pinned as named-gap cases | `c-0eff2962a1de9496`, `c-0f8013cce650a2f9`, `c-0157134b8bc06975` |

## 3. What main supports that the rebuild doesn't

| Main | Rebuild today | Fits without restructuring? |
|---|---|---|
| `prepare()` once, `layout()` at any width, with no Canvas calls in `layout()` | `layoutParagraph()` per width. Engines have internal `prepare`/`nextLine` (`rebuild/src/engines/engine.ts`), and a new Measurer and memo per call (`rebuild/src/index.ts`). | The split fits: keep the memo on the prepared paragraph, and move gaps out of it (`lines.ts:61-64`, audit F4). "No Canvas calls in layout" doesn't fit Gecko: `glyphBefore` measures suffixes only when a line reaches that offset (`lines.ts:20-57`). The worst development paragraph made 15,981 calls. Precomputing costs one call per in-word offset. |
| `walkLineRanges`, `measureLineStats`, no line strings | Every line builds fragments and painted strings (`lines.ts:546`) | Yes, with a stats-only mode |
| `measureNaturalWidth` (max-content) | none | Additive, but it has to port Gecko's intrinsic sizing (`nsTextFrame::AddInlinePrefISize`). A layout at infinite width counts trailing spaces before a newline differently; main's README notes the same. |
| `layoutNextLine` / `layoutNextLineRange` with a different width per line | internal `nextLine(prepared, start, width)` | Yes for Gecko: `GeckoLineStart` holds only `contentOffset` (`types.ts:124-127`), valid at any width. Only the gap state (F4) must move. |
| Line text and cursors for Canvas `fillText` | UTF-16 offsets; fragments in logical order with levels. The visual order is computed for the width (`lines.ts:676`) but not returned. | Additive: return per-fragment x positions |
| Rich inline: items with their own font and letter spacing | runs (`rebuild/src/model.ts:26-37`), plus word spacing, per-span `lang` and node kinds | Superset |
| Rich inline: `break: 'never'` chips, `extraWidth` padding/border, `gapBefore` accounting | no inline-box properties in the model | No. Gecko needs per-span line state (nsLineLayout's span tree, audit F5; probe H12b shows padding changes lines). Main's `extraWidth` isn't CSS either: it adds to each fragment's occupied width. |
| Options: `whiteSpace` normal/pre-wrap, `wordBreak` normal/keep-all, `letterSpacing`; fixed `overflow-wrap: break-word`, `line-break: auto`, `tab-size: 8` | All of main's options, plus pre, pre-line, nowrap, break-spaces, break-all, break-word, overflow-wrap normal/anywhere, all `line-break` values, any `tab-size`, word spacing | Superset |
| Any canvas font shorthand (`small-caps`, stretch keywords) | `FontDecl` family/size/weight/style only (`model.ts:11-18`) | Additive, but the new fields have to reach Gecko's text-run joining test (`prepare.ts:539-540`, audit E2, F1) |
| `setLocale`, `clearCache` | `lang` per paragraph and run, `env.pageLang`; no shared caches | Nothing to add |
| Any browser, desktop or mobile, a profile picked from the user agent (`src/measurement.ts:283-325`) | exactly Chrome 153, Safari 27.0, Firefox 156.0 (`rebuild/src/env.ts:57-63`), plus macOS facts in engine code (Apple Color Emoji, optical-size family list) | Not a code restructuring, but ongoing work: every browser version needs its break data and source re-pinned |
| Emoji width from a DOM span read | Canvas at the device size (`prepare.ts:853-919`) | Excluded on purpose |
| `height = lineCount × lineHeight` | `lineHeight` is in `Paragraph` | Trivial |
| Line `width` = advances without hanging spaces | `width` = the lab's observed extent (`lines.ts:605-744`, audit F9); `engineWidth` = Gecko's line box; no hang amount returned | Moderate: return the line box and the hang amount, and move the lab's extent into the lab |
| `text-transform`, `hyphens: auto` | none (main has neither); both handle soft hyphens | Moderate, and additive plus a gap (audit §8) |

## 4. Becoming a correctness superset of main, for Gecko

**What it takes, in order:**

1. **Six source fixes (139 cases, 17% of main's Firefox advantage).**
   - Font matching, letter-spacing base, script-run units, reversed kerning and the width rules each took a few lines in my copy. They passed every targeted case with no control regression.
   - The emoji detection needs a real test plus one probe.
   - After these, metric losses to main: line count 374, breaks 579, widths 1.
2. **Per-font data, if the maintainer allows it (477 cases).**
   - **Legacy kerning** is a table of the installed fonts whose kerning comes from `kern`/`kerx` without a GPOS `kern` feature: 4 of the lab's fonts. It can be generated offline from the fonts' table directories and pinned by hash, like the break data. 105 cases fixed; controls 37 better, 0 worse.
   - **lam-alef** needs which glyph sequences each font ligates: GSUB lookups per font, a much larger generator. The Unicode-level rule fixed 372 cases and broke 26 control results.
   - The brief says "no font files", so either table is a decision for the maintainer.
   - After both, metric losses to main: line count 181, breaks 132, widths 1.
3. **API work for main's surface.**
   - prepare-once with the memo and gaps held per layout;
   - a stats-only walker;
   - x positions per fragment;
   - a port of Gecko's intrinsic width;
   - per-span line state before any chip or padding feature;
   - a policy for browser versions that aren't pinned.

**What should never become a superset:**
- **The 199 in-word glyph cases.** Main passes them by measuring isolated or growing-prefix graphemes, and by counting U+0000 as 13px. The same measurements lose many times more cases in those families (§0). Copying them would mean choosing a heuristic keyed to accidents. The rebuild should keep naming `in-word-prefix`, tied to the decisive offset.
- **Main's emoji DOM read.** The brief forbids it. The rebuild gets the same widths from Canvas except where page history pins emoji fallback, which it names.
- **Unpinned browser versions and mobile engines.** Main's user-agent profiles make no guarantee there. The rebuild refuses rather than guessing; a documented fallback would itself be a guess.
- **Page-history layouts in either direction.**
