# WebKit probe results

Every verdict below was measured in **webkit-host (system WebKit 22625.1.29.11.27)**: a background WKWebView app on the
system WebKit framework, the same WebKit build installed Safari 27.0 uses. DPR 2, `visualViewport.scale` 1, host process
languages `zh-CN`. Installed Safari 27.0 ran both probe files later. Every observation of this file's probes equals the
host's, so these verdicts hold in installed Safari, and it settles the rows that depend on Safari-app state ("Installed
Safari 27.0" at the end).

- Probes: `rebuild/probes/webkit-probes.ts` (89 probes, one fresh document each).
- Raw results: `.artifacts/probes/webkit/webkit-host-probes.json` (run 2026-09-16 14:43, status ok, 0 errors).
  The §7 font-size probe was re-run after a probe fix: `.artifacts/probes/webkit-followup/webkit-host-probes.json`.
- Command: `python3 .artifacts/session/with-browser-lock.py <job> -- bun rebuild/probes/runner.ts --browser=webkit-host --probes=rebuild/probes/webkit-probes.ts --out=.artifacts/probes/webkit`

Thresholds are computed in the page from OffscreenCanvas widths, exactly as each spec defines them. "Lines" lists line
start offsets from per-code-point Range rects. Verdicts:
- **confirmed**: the measurement matches the spec's expected outcome;
- **refuted**: it doesn't;
- **recorded**: no decisive expectation;
- **not-run**: the hypothesis needs something the host can't give, or depends on Safari-app state (preferences, default
  fonts, the Safari process's ICU default locale or preferred languages). For those, the webkit-host value is shown for
  reference only.

Two measurement caveats found while probing:
- A collapsed space right after an inline box end (`</span> foo`) reports a zero-width Range rect on the *next* line. The
  words are still placed where the spec says. H5 and H18 check words, not the space's offset.
- With `text-transform` that changes length (`ß` → `SS`), Range offsets address the transformed text, so a Range over DOM
  offsets covers the wrong characters. H19 reads a wrapping span's per-line rects instead.

## Results

| id | verdict | measured | expected |
|---|---|---|---|
| webkit-lines H1 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | w = 39.140625; 1 line at T(w), 2 at ceil64(w) − 2/64; 9-width scan (2501–2509)/64 matches the source fit test at every width (first one-line width 2504/64) | 1 line at T(w); 2 lines at ceil64(w) − 2/64 |
| webkit-lines H2 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 13 widths k = 2499…2511: lines at k/64 + 0.01 equal lines at k/64 | same lines for k/64 and k/64 + 0.01 |
| webkit-lines H3 | confirmed, not discriminating — webkit-host (system WebKit 22625.1.29.11.27) | 1 line at W = 46.65625; smallest one-line width 2985/64 = prediction; in Georgia M("AV ") − M(" ") = M("AV") = 21.398438, so both recipes agree; the code-point Range over "AV" snaps to 22px | 1 line; first box = M("AV ") − M(" ") |
| webkit-lines H4 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 11, 22] at 112.75, 113.5 and 114.75px | [0, 11, 22] (carry) |
| webkit-lines H5 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | W = 38.234375, H = 5.328125 (U+2010 and `-` equal); A: 1 line "x fooi"; B: 2 lines "x" / "fooi" | A 1 line; B 2 lines "x" / "fooi" |
| webkit-lines H6 | **refuted** — webkit-host (system WebKit 22625.1.29.11.27) | W = 40.90625; A line 1 "aa­bb‐" (next start 6); **B line 1 also "aa­bb‐"** (next start 6); line-1 box 40.921875 = w(aabb) + H in both | A "aabb‐"; B "aa‐" |
| webkit-lines H7 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | a = 37.796875; at T(a): 2 lines, first box 37.796875 exactly (includes the 4px after "c"); at 37.77125: 2 lines, "abc " box 37.796875 overflows | 2 lines, box a; then 3 lines or "abc" overflowing |
| webkit-lines H8 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | W = 57.828125; anywhere [0, 3, 9, 15, 21]; break-all [0, 7, 13, 19] ("aa bbbb", 4 b's as predicted) | anywhere: line 2 starts with b; break-all: "aa b…" with breakWord's count |
| webkit-lines H9 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | A starts [0,1,…,7] (line 1 "W"); B [0, 4, 5, 6, 7, 8] (line 1 "W)))") | A "W"; B "W)))" |
| webkit-lines H10 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | W = 35.59375; auto [0, 3, 7] ("aaa"); loose [0, 4, 8] ("aaaa") | auto splits earlier; loose splits right before U+2010 |
| webkit-lines H11 | **partly refuted** — webkit-host (system WebKit 22625.1.29.11.27) | W = 30.234375; pre-wrap [0, 9]; nowrap and pre 1 line; **break-spaces [0, 9]: all six spaces stay on line 1** (box 52.46875 > W), "def" on line 2 | pre-wrap "abc      " / "def"; break-spaces spaces spread over lines; nowrap/pre 1 line |
| webkit-lines H12 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 2 lines; line 1 offset 4.453125 = W − w(abc) exactly | 2 lines, offset W − w(abc) |
| webkit-lines H13 | **refuted** (empty div) — webkit-host (system WebKit 22625.1.29.11.27) | heights: textContent "\r" 0, " \t\n\f" 0, **empty div 0**, "\v" 20, "x" 20; parser turns `\r` into LF | "\r" and " \t\n\f" height 0; empty div one line |
| webkit-lines H14 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | DOM pre "a\vb" 29.796875 = Canvas "ab" (.notdef 12); M("a b") 22.242188; DOM "a\rb" 17.796875 (= "ab") | .notdef width, not a space; CR ≠ space |
| webkit-lines H15 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | tab-size 4 "a\tb": 26.679688 = prediction; tab-size 1 "ac\tb": remainder 3.5625 > half space, width 31.125 = with the jump (26.679688 without) | fmodf stop rule; jump when the tab is below half a space |
| webkit-lines H16 | not-run (DPR 1); border part confirmed — webkit-host (system WebKit 22625.1.29.11.27) | only a Retina display: breaks at DPR 1 not measured; `border-left: 0.7px` gives a 100.5px box (0.5px border) at DPR 2 | identical breaks at DPR 1 and 2; 0.7px border → 0.5px at DPR 2 |
| webkit-lines H17 | not-run | the host has no page zoom control | 125% zoom equals 20px font at T(1.25 × W) |
| webkit-lines H18 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | W = 22.25; normal: "foobar" / "baz"; anywhere: [0, 3, 5, 6, 9], split after "foo" at the run edge | no break between foo and bar; anywhere splits inside "foobar" |
| webkit-lines H19 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 2 lines; per-line widths of a wrapping span [74.6875, 74.6875] = [M("STRASSE ") − M(" "), M("STRASSE")] exactly | 2 lines; Canvas recipe on "STRASSE" |
| webkit-lines H20 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | height 20, box 15.101563 = M("W") with and without a span | 1 line, width M("W") |
| webkit-lines H21 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | content fits: offset 1.007813 = W − 39.132813; content wider than W: offset 0 | offset W − content, or 0 when clamped |
| webkit-lines H22 | confirmed (equal font); letter-spacing recorded — webkit-host (system WebKit 22625.1.29.11.27) | `::first-line{font-size:16px}` [0, 11, 22] at all three widths; `::first-line{letter-spacing:1px}` [0, 10, 21, 32] | carry kept for an equal first-line font; fresh measurement with first-line letter-spacing |
| webkit-text H1 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | `<b>foo</b>bar` 1 line; `<b>foo</b> bar` [0, 3] | 1 line; control 2 lines |
| webkit-text H2 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 3] | "ex-" / "ample" |
| webkit-text H3 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | `x<b>-</b>1` 1 line; `x-1` [0, 2] | 1 line; 2 lines |
| webkit-text H4 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | lang ja: [0, 1, 2, 7, 8] | 5 lines 中 \| 文 \| “abc” \| 中 \| 文 |
| webkit-text H5 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 1, 6] | 中 \| «abc» \| 中 |
| webkit-text H6 | confirmed (en, ja, fr, de, he, ar); no-lang not-run — webkit-host (system WebKit 22625.1.29.11.27) | en 5 lines; ja, fr, de, he, ar 4 lines. No lang: 5 lines in webkit-host, but that depends on the process ICU default locale | en and no lang 5 lines; ja/fr/de/he/ar 4 |
| webkit-text H7 | confirmed; `lang=""` part process-dependent — webkit-host (system WebKit 22625.1.29.11.27) | page ja + span en: 5 lines; page en + span ja: 4 lines; page ja + `p lang=""`: 5 lines (empty locale, process default) | 5; 4; 5 |
| webkit-text H8 | not-run (Safari process ICU default locale) | webkit-host: `und` and `xx` both 5 lines (en-like quote overrides) | 5 lines: en-like default; 4: no tailoring |
| webkit-text H9 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 中.abc(d [0, 5]; x.abc(d 1 line; 中,abc[d [0, 5]; 中.abc<d [0, 5] | 2; 1; 2; 2 lines |
| webkit-text H10 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | a\rb 1 line; strict [0, 2]; 中\r中, 中\f中, 中\v中 [0, 2] | 1; 2; 2 |
| webkit-text H11 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | DOM a\rb 17.796875 vs a b 22.242188; Canvas both 22.242188 | DOM differ; Canvas equal |
| webkit-text H12 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | FF node between spans: 12px rect; lone FF before a span: no rect; lone VT: 12px rect | .notdef; none; .notdef |
| webkit-text H13 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | a U+2028 b and a U+2029 b: [0, 2] | 2 lines each |
| webkit-text H14 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | manual [0, 3]; none 1 line | "co‐" / "op"; 1 line |
| webkit-text H15 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | abc,def(ghi中 [0, 4, 8]; abc,def(ghi 1 line | 3 lines; 1 line |
| webkit-text H16 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | span edge 1 line; single node [0, 3] | 1; 2 lines |
| webkit-text H17 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 1 line | 1 line, no hyphen |
| webkit-text H18 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | normal [0, 2], ZWSP rect on line 1; keep-all [0, 1], ZWSP rect on line 2 | a​ \| b; a \| ​b |
| webkit-text H19 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 3, 8] (Menlo a = 9.632813) | aaa \| a,,,, \| bbbb |
| webkit-text H20 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 3] | 中、、 \| 文 |
| webkit-text H21 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | lang en normal 4 lines; ja 4; ja strict [0, 1, 3]; no lang normal [0, 1, 3] | 4; 3; 4; 3 |
| webkit-text H22 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 4, 10, 13] | [0, 4, 10, 13] |
| webkit-text H23 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 3, 6, 10, 12, 16, 19]; [0, 2, 3, 5, 7, 10, 12] | 7 lines each, as listed |
| webkit-text H24 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 1 line | 1 line |
| webkit-text H25 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | pre-wrap first span 26.6875 = "a  b"; two normal spans 22.242188 = "a b" | two spaces; one space |
| webkit-text H26 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | spans 17.332031 + 17.332031 = 34.664063; single AV 31.570313 = M("AV"); difference = M(A) + M(V) − M(AV) | wider by the kern; equals the span sum |
| webkit-text H27 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 中\n文 46.66 = 中 文 46.66 | equal |
| webkit-text H28 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 1 line | 1 line |
| webkit-text H29 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 中a 30.9 = spans 30.9 | no autospace gap |
| webkit-text H30 | not-run (Safari preferred languages) | webkit-host: zh, zh-Hans, zh-Hant-TW and zh-CN give identical starts on 4 strings | no visible difference |
| webkit-canvas H1 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | O "a b" and a\vb, a\fb, a\rb, a\nb, a\tb all 22.528; DOM pre a\vb − ab = 8 | all equal; DOM diff ≈ 8 |
| webkit-canvas H2 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 36.431999 for both (readback drops `condensed`) | identical |
| webkit-canvas H3 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | O 38.703999; DOM 59.344002 | ≈ 38.704; ≈ 59.344 |
| webkit-canvas H4 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | E with `no-common-ligatures` 59.344002 = DOM exactly (`none` too) | equals DOM |
| webkit-canvas H5 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 48 widths over 6 fonts, all float32 | fround(w) === w |
| webkit-canvas H6 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | ltr = rtl = 71.18264 | equal |
| webkit-canvas H7 | not-run (default generic font) | webkit-host: E lang=ja 53.327999 = DOM; O 52.445313 | E equals DOM; O may differ |
| webkit-canvas H8 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | NUL, SHY and "ab" all 19.265625 | 19.265625 |
| webkit-canvas H9 | not-run | the host has no page zoom control | unchanged at 150% |
| webkit-canvas H10 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | Canvas difference 8 = DOM difference 8 exactly | equal |
| webkit-canvas H11 | confirmed (named langs); xx and no lang not-run — webkit-host (system WebKit 22625.1.29.11.27) | en, es, it, el, ko, zh, zh-Hant: [0, 5]; sv, fi, da, he, ar, ja, de, fr, ru, hu, nl, fa: 1 line. xx and no lang: [0, 5] in webkit-host (process default) | first set 2 lines at 5; second set 1 line |
| webkit-canvas H12 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | sv→en 2 lines; en→sv 1 line | 2; 1 |
| webkit-canvas H13 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 1, 4] | [0, 1, 4] |
| webkit-canvas H14 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | abcd,efgh中 [0, 5]; abcd,efghé 1 line | 2 lines at 5; 1 line |
| webkit-canvas H15 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | AV 21.046875 both; Hello world 76.875 both | equal |
| webkit-canvas H16 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 100 O results, one value 30.429688 | identical |
| webkit-canvas H17 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | no lang: auto [0, 2]; strict 1 line | a- \| 1234; 1 line |
| webkit-canvas H18 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 8, 9, 13] | [0, 8, 9, 13] |
| webkit-canvas H19 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 3] | 2 lines |
| CRITIC C10 | not-run | no page zoom control | zoom before or after truncation |
| CRITIC C11 | not-run (Safari process ICU default locale) | webkit-host: lang und 2 lines (en-like) | 2 lines en-like; 1 ja-like |
| CRITIC C12 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | a\fb, a\vb, a\rb = a b = 22.242188 | equal |
| CRITIC C13 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | 24.360001 = ligature + 1 exactly (separate glyphs + 2 = 26.6) | ligature width + 1 |
| CRITIC C14 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | [0, 1] | 2 lines |
| CRITIC W5 | not-run | no page zoom control | — |
| CRITIC W7 | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | empty 0; "\r" 0; "\v" 20 | 0; 0; one line |
| CRITIC §7 font size | confirmed (no size quantization), exact equality refuted — webkit-host (system WebKit 22625.1.29.11.27) | NBSP text (full measuring path) DOM = Canvas exactly at 13.33, 13.337, 11.1111 and 17.49px; single glyph equal. Plain "Hello world" differs by one float32 step at 11.1111px (54.958710 vs 54.958717) and 17.49px (86.510597 vs 86.510605) | WebKit quantizes neither; DOM = Canvas |
| cross-cutting 1 (emoji) | recorded — webkit-host (system WebKit 22625.1.29.11.27) | U+1F600 and the ZWJ family, 8–32px: DOM = Canvas at the CSS size exactly: 11, 13, 16, 19, 21, 23, 25, 32. Canvas at size × 2 ÷ 2: 10.5, 11.5, 12.5, 14, 16, 20, 24, 32 | which Canvas recipe equals DOM |
| cross-cutting 2 (controls) | recorded — webkit-host (system WebKit 22625.1.29.11.27) | 16px Arial, normal and pre alike: CR 17.796875 (= "ab", 0 advance); FF and VT 29.796875 (.notdef 12); TAB normal 22.242188 (a space), pre 44.460938 (tab stop). Canvas: all 22.242188 | DOM versus Canvas |
| cross-cutting 3 (ligatures) | recorded — webkit-host (system WebKit 22625.1.29.11.27) | Hoefler Text 32px "ffi fl". DOM: ls 0 54.40; 0.001px 57.414 (ligatures off: per-glyph sum 57.408 + 6 × 0.001); 1px 63.408; text-rendering optimizeSpeed 57.408 (ligatures off), optimizeLegibility 52.816, geometricPrecision 54.40. Canvas: letterSpacing 0.001px 54.403, 1px 57.40 (ligatures kept, 3 spacings); `ctx.textRendering` isn't a native property and changes nothing. Helvetica Neue: DOM 51.04 / 50.95 / 56.944, optimizeSpeed 51.52 (= per-glyph sum); Canvas 51.043 / 54.04 | DOM letter-spacing and text-rendering versus Canvas |
| cross-cutting 4 (永骨) | not-run (default generic font); recorded — webkit-host (system WebKit 22625.1.29.11.27) | 32px sans-serif. ja, zh-Hans, en: DOM = O = E = 64. ko: DOM = E = 55.36, O = 64. O draws the same pixels under all four langs (same as en); E's pixels differ per lang | OffscreenCanvas versus DOM per page lang |
| cross-cutting 5 (system-ui) | recorded — webkit-host (system WebKit 22625.1.29.11.27) | system-ui and -apple-system identical; DOM = Canvas in 15 of 16 cases per family; 20px "The quick brown fox 0123": 225.220261 vs 225.220245 (one float32 step) | Canvas versus DOM |
| cross-cutting 6 (environment) | confirmed — webkit-host (system WebKit 22625.1.29.11.27) | DPR 2, visualViewport.scale 1; "nnnnn nnnnn" scanned at 1/128px: smallest one-line width 11958/128 = the 1/64px prediction; every odd k/128 gives the same lines as the even width below | breaks follow the 1/64 CSS px grid at DPR 2 |

## Spec corrections

1. **webkit-lines H6 and §2 difference 2 (soft hyphen revert without the epsilon).** B gave "aabb‐", not "aa‐".
   - LineBuilder adds the hyphen width to any candidate ending in U+00AD before its fit test, with the same 1/64
     epsilon (`IL/InlineLineBuilder.cpp:1154-1165`, `:1172-1183`). So once such a candidate is committed, its hyphen
     already fits.
   - When the next content wraps, `processInlineContent` compares the line's hyphen with the same epsilon and picks
     WrapWithHyphen (`IL/InlineContentBreaker.cpp:114-120`).
   - So `rebuildLineForTrailingSoftHyphen` (`IL/InlineLineBuilder.cpp:1860-1887`, the no-epsilon loop) is never reached
     for text-only candidates. It is reachable only when the hyphen wasn't counted: `setTrailingSoftHyphenWidth` skips
     it when a non-text item follows the soft-hyphen item inside the candidate (`:1154-1161`), for example
     `aa&shy;<span></span>bb`.
   - The probe's conditions also can't all hold in 16px Arial: "cc" (16px) is wider than the hyphen (5.33px), so "cc"
     never fits where the hyphen doesn't (`ccFitsWithoutHyphen` false).
   - Rewrite difference 2 as "reachable only when the soft-hyphen item is followed by an inline box start or end in the
     same candidate", and re-probe with such markup.
2. **webkit-lines H11, `white-space: break-spaces`.** All six spaces stayed on line 1, overflowing it (box 52.47px in a
   30.23px line), and "def" moved to line 2. That is neither the spec's "spaces spread over lines" nor what the cited
   source gives.
   - Each space is its own item (`IL/InlineItemsBuilder.cpp:972-978`).
   - A preserved space doesn't hang under break-spaces, because `shouldTrailingWhitespaceHang` needs `Preserve`
     (`IL/text/TextUtil.cpp:444-448`).
   - For an overflowing whitespace candidate on a line with content, `processOverflowingContent` finds no break rule
     and returns Wrap (`IL/InlineContentBreaker.cpp:274-295`).
   - The branch that keeps the spaces isn't in anything read so far (`TextOnlySimpleLineBuilder.cpp:196-435`,
     `InlineContentBreaker.cpp:40-300, 813-875`, `InlineLine.cpp:483-556`). Mark §9.1's break-spaces paragraph
     unverified until it is found. Before the next reading, measure a longer case (for example 20 spaces) to see
     whether the spaces ever wrap.
3. **webkit-lines H13, empty block.** `<div></div>` is 0px tall: an empty block has no line box. CRITIC W7 is right.
4. **webkit-canvas §1.4 pseudo-code, LF and CR.** The line "TAB/LF/CR/NUL/default-ignorable: delete glyph, runWidth
   −= advance" is wrong for LF and CR.
   - In `applyCSSVisibilityRules`, LF and CR hit `case newlineCharacter / carriageReturn`. That swaps in the space
     glyph and `continue`s before the delete check at `:812` (`G/WidthIterator.cpp:792-800`). So they keep their own
     glyph's advance, as webkit-lines §3.3 says. TAB is made invisible (`:804-806`). Only NUL and default-ignorables
     reach `deleteGlyph`.
   - Measured, which also answers webkit-lines §14's open question: that advance is **0 in Arial**. DOM "a\rb" = "ab"
     = 17.796875 in both normal and pre (cross-cutting 2). The shortcut measuring path takes the advance of Arial's
     glyph for U+000D (`G/FontCascade.cpp:381-412`).
5. **webkit-canvas (e) "DOM simplified measuring usually equals Canvas", and CRITIC §7.** WebKit doesn't quantize font
   sizes: NBSP text, which forces the full measuring path, equals Canvas bit for bit at 11.1111px and 17.49px. But plain
   Latin text on the shortcut path differs from Canvas by one float32 step at those sizes, and for system-ui 20px.
   - That path shapes once and sums the advances in one loop (`G/FontCascade.cpp:381-412`, sum at `:405-407`). WidthIterator sums
     pre-shaping advances, then adds `after − before` per font range (`G/WidthIterator.cpp:92-123`).
   - So a Canvas total is not bit-exact for shortcut-path text. A fit test at an exact threshold can flip by one float32
     step. Either port the shortcut path's summing order (which needs per-glyph advances, not Canvas totals), or name
     this as an accepted gap.
6. **Emoji recipe for WebKit (cross-cutting 1).** DOM emoji widths equal OffscreenCanvas at the CSS font size,
   bit-exact at every size from 8 to 32px. The "measure at size × DPR, then divide by DPR" recipe (Gecko's, per PLAN
   log) is wrong for WebKit below 32px, by up to 3.5px at 12px. webkit-canvas (e) row "emoji: yes, same FontCascade
   path" holds.
7. **OffscreenCanvas locale (cross-cutting 4; webkit-canvas §1.3).** Confirmed: O draws identical pixels under ja,
   zh-Hans, ko and en, and under ko its width (64) differs from the DOM (55.36). Only a connected canvas picks up the
   page lang. The spec is right. The width difference under ko is a concrete case for "Not supplied by Canvas totals"
   item 5.
8. **webkit-lines H3 needs a discriminating font.** Georgia at 16px has no kerning between "V" and a space, so
   M("AV ") − M(" ") = M("AV"), and the probe can't tell the following-space rule from plain measurement. Re-probe
   with a pair whose kerning with the space is non-zero.
9. **Harness notes for the rebuild's observers.** They're listed under "Two measurement caveats" above. The
   collapsed-space rect sits on the next line after an inline box end, and length-changing `text-transform` shifts Range
   offsets. Both change `lineStarts` without changing layout.

## Not run, and why

- **Page zoom** (webkit-lines H17, webkit-canvas H9, CRITIC C10 and W5): the host exposes no page zoom.
- **DPR 1** (webkit-lines H16): this Mac has only a Retina display.
- **Depends on Safari-app state; webkit-host values shown for reference only.** Installed Safari has since measured
  them, with the same values ("Installed Safari 27.0"):
  - the process ICU default locale: webkit-text H6 no lang, H7 `lang=""`, H8; webkit-canvas H11 `xx` and no lang;
    CRITIC C11;
  - preferred languages: webkit-text H30;
  - default generic font preferences: webkit-canvas H7, cross-cutting 4.
- Page zoom and DPR 1 weren't run in installed Safari either.

## Independent cross-check, and WebKit's break-position cache

A second agent was given the same task while installed Safari stayed frontmost (07:04 to at least 09:06). It encoded
every hypothesis again, without reading the probes above, and ran them in the same webkit-host build (DPR 2, scale 1).
Where the two encodings disagree, follow-up probes settled the cause. Installed Safari 27.0 ran it later ("Installed
Safari 27.0").

- Probes: `rebuild/probes/webkit-probes-crosscheck.ts` (118 hypothesis probes plus the follow-ups below). Verdicts:
  `bun rebuild/probes/webkit-verdicts-crosscheck.ts <output file>`.
- Raw results: `.artifacts/probes/webkit-crosscheck/webkit-host-probes.json` (status ok, 0 errors; table in
  `verdicts.md` beside it). Follow-ups: `.artifacts/probes/webkit-crosscheck-{storage,history,payload,cache}/`.
- Command: `python3 .artifacts/session/with-browser-lock.py <job> -- bun rebuild/probes/runner.ts --browser=webkit-host
  --probes=rebuild/probes/webkit-probes-crosscheck.ts --out=.artifacts/probes/webkit-crosscheck`. Follow-ups use
  `--only=storage`, `history`, `payload`, `cache A`, then `cache B` in a second invocation. Installed Safari:
  `--browser=safari --allow-safari-frontmost`, every probe in one invocation.

The cross-check's own table gives 73 confirmed, 6 refuted, 2 inconclusive and 4 not-run. After attribution, H13 (the
empty div, correction 3 above) is the only spec error among its refuted rows. H9, webkit-text H15 and webkit-canvas
H14 are storage effects (item 2 below). H19's second box is the `text-transform` observer caveat above. cross-cutting 5
is the float32 step in correction 5.

### Agreements that add evidence

| id | cross-check measurement |
|---|---|
| webkit-lines H6 | Across every 1/64px width from 16.78 to 70.39px, A and B give identical starts at every width. The four constraints can't all hold in 16px Arial (`aabbccFits` false: w(cc­) = 16 > H = 5.328). This supports correction 1. |
| webkit-lines H1, cross-cutting 6 | The first one-line width equals ceil(64w) − 1 for 8 strings. In a 1/128px scan, every 2→1 transition is at an even step. |
| webkit-lines H7 | Right-aligned "abc abc" with `letter-spacing: 4px` at 100px: left 15.960938 = 100 − content with the trailing 4px (trimmed would be 19.960938). |
| webkit-lines H15 | tab-size 1 after "abc" (remainder above half a space): b at 31.117188 = with the jump (26.671875 without). |
| webkit-canvas H7 | An element canvas *without* a `lang` attribute also equals the DOM (53.328) under `<html lang="ja">`: the canvas inherits the page locale through its computed style. |
| CRITIC C10, CSS zoom proxy | `zoom: 1.25`, `width: 93.425049px`, 16px Arial `nnnnn nnnnn` (f32 width at 20px 116.787109): 1 line. That is the zoom-then-truncate bound (116.78125 + 1/64). Truncate-then-zoom would give 2 lines. CSS zoom only; page zoom is still not run. |

### Disagreements, settled

1. **webkit-lines H11, break-spaces: the process-wide `TextBreakingPositionCache`, not a missing source branch.** The
   cross-check gave "abc " | "     " | "def", which is the source walk. The run above gave all six spaces on line 1.
   - Probes, in one webkit-host process: break-spaces `abc      xyz` right after a document that laid out the same text
     in pre-wrap keeps all six spaces on line 1. Alone in a fresh process, or with content never laid out in pre-wrap,
     it wraps per space.
   - Source:
     - The cache key is `tuple<String, TextBreakingPositionContext, SecurityOriginData>`, with the string compared by
       value (`L/text/TextBreakingPositionCache.h:48`).
     - The context maps `Preserve` and `BreakSpaces` to the same value (`L/text/TextBreakingPositionContext.h:43-56`).
     - `handleTextContent` reads the cache before building items (`L/InlineItemsBuilder.cpp:936`). Only its fresh path
       splits a break-spaces run into one item per character (`:972-978`), so positions cached from pre-wrap give one
       six-space item, with no opportunity inside it.
     - The cache is filled when a block's line layout is destroyed while the document lives
       (`W/layout/integration/inline/LayoutIntegrationLineLayout.cpp:210-221`). The probe host is cleared after every
       probe, so that happens then. Only text boxes with at least 3 items and 5 code units are stored
       (`L/text/TextBreakingPositionCache.h:41-42`; `L/InlineItemsBuilder.cpp:1082-1148`).
   - Correction: withdraw correction 2 above. webkit-lines §9.1's break-spaces paragraph holds in a fresh process. Add
     the cache to both WebKit specs as a page-history input: identical text and style can break differently depending
     on what the same WebContent process laid out and tore down before, for any white-space or storage difference the
     key doesn't record. It is a candidate explanation for the history-dependent WebKit rows in the lab (PLAN 07:50
     suspected the width caches).
2. **webkit-lines H9, webkit-text H15, webkit-canvas H14 (the 8-bit rows): the text node's storage width comes from the
   string's provenance.** The cross-check gave 16-bit behaviour for Latin-1-only text ("W)))", 3 lines, 2 lines). The
   run above gave 8-bit behaviour.
   - Probes: the same markup in fresh documents. When the document's probe JSON contains a raw non-Latin-1 character
     anywhere, canvas H14 `abcd,efghé` gives 2 lines instead of 1, and H9 `W)))iiii` puts "W)))" on line 1 instead of
     "W". The cross-check's payloads carried CJK text for other probes. The probes above build markup from JS
     literals.
   - The keep-all `abc,def(ghi` pair gave 3 lines in both payload widths, because its 16-bit document ran first and
     filled the cache (item 1). With unique content `pqr,stu(vwx`, a Latin-1 payload gives 3 lines right after a
     16-bit document, and 1 line alone in a fresh process.
   - Source:
     - JSON string tokens parsed from a UTF-16 source are stored 16-bit (`JavaScriptCore/runtime/LiteralParser.cpp:896-899`).
     - The fast `innerHTML` parser keeps the source width (`W/html/parser/HTMLDocumentParserFastPath.cpp:1154-1156`).
     - The keep-all punctuation rule (`W/rendering/BreakablePositions.h:292-299`) and the first-unit shortcut
       (`L/InlineContentBreaker.cpp:143`) both test `is8Bit()`.
   - Not reproduced from plain JS: `(s + '一').slice(0, -1)`, `JSON.parse(JSON.stringify([s, '一']))[0]`,
     `createTextNode` and `innerHTML` of those all behaved 8-bit. Which JS string operations keep 16-bit storage wasn't
     traced in JSC.
   - Correction: webkit-text §13 "Whether a string is 8-bit: approximate with every unit ≤ U+00FF [I]" is wrong in
     practice. Storage follows provenance and the cache, and JS can't observe it. The keep-all punctuation breaks and
     the 16-bit first-unit rule are unpredictable for Latin-1-only text that comes from such strings, for example a
     `fetch` JSON response that contains any non-Latin-1 character. The painter must control storage (not yet shown
     possible), or this is a named gap.
3. **webkit-lines H22.** Inconclusive in both. `::first-line { letter-spacing: 1px }` gave [0, 11, 22, 33] at 112.75 and
   113.5px and [0, 11, 22] at 114.75px. The cross-check's fresh-measurement and carry models both predict
   [0, 11, 22, 33] at 114.75px, so settling `IL/AbstractLineBuilder.cpp:84-91` needs a `breakWord` port with the
   first-line style, not Canvas prefix sums.

### Harness notes

- Keep each document's probe payload Latin-1-only, or build probe text from JS literals, and record which. A lab or
  probe payload with CJK text elsewhere changes WebKit's breaks for ASCII cases.
- The break-position cache outlives documents: compare runs only in the same order, give each comparison a fresh
  webkit-host process, or use content unique to one case.
- Installed Safari: one waiter took the lock at 08:40 and found Safari frontmost again. It was stopped before opening
  a window. SIGTERM also stopped the lock helper before its cleanup ran; the dead-owner takeover recovered the lock.

## Installed Safari 27.0

The maintainer approved installed Safari runs on 2026-09-16 at about 14:15 ("go ahead and use safari!"). Installed
Safari 27.0 (WebKit 22625.1.29.11.27) ran each probe file once, under the lock, at DPR 2, `visualViewport.scale` 1, every
document visible, no focus. Terminal was the frontmost app at every check.

- Runs: `webkit-probes.ts` 16:44:28 to 16:44:41 (89 documents), `webkit-probes-crosscheck.ts` 16:44:41 to 16:44:51 (140
  probes in 61 documents). Status ok, 0 errors
  (`.artifacts/lab/final-20260916/tools/run-safari-probes.sh`).
- Raw results: `.artifacts/probes/webkit/installed-safari/webkit-probes/safari-probes.json` and
  `.artifacts/probes/webkit/installed-safari/webkit-probes-crosscheck/safari-probes.json`, with `verdicts.md` beside it.
- Command: `python3 .artifacts/session/with-browser-lock.py <job> -- bun rebuild/probes/runner.ts --browser=safari
  --probes=rebuild/probes/<file>.ts --out=<dir> --allow-safari-frontmost`. With that flag the runner makes and closes
  its window with AppleScript that never calls `activate`.
- Comparison with webkit-host: `.artifacts/lab/final-20260916/tools/compare-probes.ts` compares every observation,
  leaving out the user agent, window and screen sizes, focus and timings (`compare-host.json`). `probe-ok.ts` compares
  each probe's own `ok` (`probe-ok.json`). There is no verdict script for `webkit-probes.ts`.

### webkit-probes.ts

All 89 observations equal webkit-host's. 2 probes differ only in host values: the user agent and window sizes. Each
probe's own `ok` equals the host's too: 74 true, 4 false (webkit-lines H6, H11, H13, CRITIC §7 font-size), 10 null (the
recorded rows) and 1 without a value (cross-cutting 6 env). No verdict in the table above changes.

webkit-lines H11 kept all six spaces on line 1 under `break-spaces` in installed Safari too, after the same probe had
laid the text out under `pre-wrap`: the break-position cache result of cross-check item 1.

Rows that depend on Safari-app state, not run in webkit-host. Installed Safari gives the same values as the host:

| id | installed Safari 27.0 | verdict |
|---|---|---|
| cross-cutting 6 env | page `lang` en; `navigator.language` zh-CN, `navigator.languages` [zh-CN], Intl locale zh-CN | recorded |
| webkit-text H6, no lang | 5 lines | confirmed: like `en` |
| webkit-text H7, `p lang=""` on page ja | 5 lines | confirmed |
| webkit-text H8 | `und` and `xx`: 5 lines each | recorded: the process default has en-like quote overrides |
| webkit-text H30 | zh, zh-Hans, zh-Hant-TW and zh-CN give identical starts on 4 strings | confirmed |
| webkit-canvas H11, `xx` and no lang | [0, 5] | confirmed: like `en` |
| CRITIC C11 | `lang="und"`: 2 lines [0, 5] | recorded: en-like |
| webkit-canvas H7 | element canvas with `lang=ja` 53.327999 = DOM; OffscreenCanvas 52.445313 | confirmed |
| cross-cutting 4 (永骨, 32px sans-serif) | ja, zh-Hans, en: DOM = OffscreenCanvas = element canvas = 64. ko: DOM = element canvas = 55.36, OffscreenCanvas 64. OffscreenCanvas draws the same pixels under all four langs | recorded |

### Cross-check probes

All 140 probes ran with no errors. The verdict table equals webkit-host's row by row: 73 confirmed, 6 refuted, 2
inconclusive, 4 not run. 133 probes observe exactly what the host did. The other 7 are follow-ups whose host results
came from separate `--only` runs, `cache B` in a fresh process. In installed Safari they ran in one invocation, after
the documents before them:

| probe | installed Safari | webkit-host, separate run | why |
|---|---|---|---|
| storage 8-bit vs 16-bit | keep-all `abc,def(ghi` rows: 3 lines | 1 line | likely the break-position cache (item 1): an earlier document, webkit-text H15's 8-bit row with a CJK payload, laid out the same text as 16-bit |
| history keep-all: 16-bit then 8-bit; 8-bit then 16-bit; other prefix 16-bit then 8-bit; 16-bit then 8-bit, then 8-bit again | the 8-bit `abc,def(ghi` rows: 3 lines | 1 line | same |
| cache B1, keep-all 8-bit payload alone | `pqr,stu(vwx`: 3 lines | 1 line | ran after cache A's 16-bit document |
| cache B2, break-spaces `abc      xyz` alone | six spaces on line 1, 2 lines | per-space wrap, 3 lines | ran after cache A3's `pre-wrap` layout |

So in installed Safari the cached results reproduce: identical text breaks differently after the same process laid out
that text before. The fresh-process results come from webkit-host only, because the runner doesn't restart the user's
Safari. The payload probes equal the host's: a document payload with a raw non-Latin-1 character gives 16-bit
behaviour for Latin-1-only text in installed Safari too (item 2).
