# Take-back for current Pretext

What the overnight rebuild (2026-09-16) found that current Pretext (main 2e5e2bd) can use now, or that changes
`PLATFORM_BUGS.md`, `RESEARCH.md` or the README. Each item gives the finding, the evidence and one suggested action.
Section 5 lists the candidate platform bug reports.

Where the evidence comes from:

- Engine source at the shipping versions (specs under `rebuild/specs/`): Chrome 153.0.8010.48, WebKit 7625.1.29.11.27
  (Safari 27.0) and Firefox 156.0.
- Probes in installed Chrome 153 and installed Firefox 156 on this Retina Mac at DPR 2 (`specs/probes-chrome.md`,
  `specs/probes-firefox.md`).
- Probes in **webkit-host**: a background WKWebView app on the system WebKit 22625.1.29.11.27, the build installed
  Safari 27.0 runs (`specs/probes-safari.md`). Installed Safari wasn't probed, because it was the frontmost app all
  night. Host and Safari rows matched exactly on the 300-case lab smoke set (`lab/WEBKIT-HOST.md`), but host Canvas
  numbers were never compared with Safari's.
- Main's own wrapping suite, re-observed in installed Chrome 153, Safari 27.0 and Firefox 156 at 05:52-06:10
  (`.artifacts/rows-20260916/`).

Paths are relative to `~/github/pretext-rebuild`. Probe ids such as "blink-canvas H16" name hypothesis 16 at the end of
`rebuild/specs/blink-canvas.md`. Its verdict is in `specs/probes-chrome.md`, and the raw results are under
`.artifacts/probes/<engine>/`.

Terms:

- **Canvas** means `measureText(s).width` on an `OffscreenCanvas` 2D context unless stated otherwise.
- **8-bit and 16-bit strings.** WebKit and Blink store a string either one byte per character, which is possible only
  when every character is at most U+00FF, or two bytes per UTF-16 code unit. Page JavaScript can't tell which, but some
  layout rules check it.
- **LayoutUnit**: Blink's integer width unit, 1/64 of a zoomed px, which is 1/128 CSS px at DPR 2. WebKit keeps
  line widths as float32 CSS px. Gecko uses **app units**, integers counting 1/60 CSS px. **apd** is Gecko's app units
  per device pixel: 30 at DPR 2.

## 1. Main's suite fails 2 required checks in Safari 27

Installed Safari 27.0 on main's own suite gives 0 regressions, 0 execution errors and 2 failed required checks
(`.artifacts/rows-20260916/safari/safari-ltr-summary.json`). Chrome 153 and Firefox 156 fail none.

1. **`wrap-06c1e0111950efed`** (family `keep-all`, origin "safari ideographic punctuation keep-all boundary").
   - Input: `foo。bar日本語`, 18px serif, `lang=ja`, `word-break: keep-all`, width 40px.
   - Safari 27 lays it out in 5 lines, `foo | 。 | bar | 日本 | 語` (height 160px). Main predicts 4 lines (128px).
   - WebKit 7625 changed the rules for this shape (specs/webkit-text.md §15). Keep-all now breaks after opening,
     closing and other punctuation, but only in 16-bit strings (`R/BreakablePositions.h:268-271, 297-298`). That is
     311090@main, the fix PLATFORM_BUGS.md was waiting for. 7625 also adds line-start prohibitions for when nothing
     fits (`L/InlineContentBreaker.cpp:139-158`). Which of the two decides this case wasn't traced.
   - **Action:** re-check the `webkit-spaces` keep-all pair model on Safari 27, then update the PLATFORM_BUGS keep-all
     row: the fix shipped in Safari 27.0, for 16-bit strings only.
2. **`wrap-4faaad4b08f18c01`** (family `reported/#210-#211`).
   - Input: ZWSP `≤100nA` ZWSP, 12px Calibri, sans-serif, `pre-wrap`, width 25px, line height 20.96px.
   - All three browsers draw the same 3 lines. Safari 27's paragraph is 62.875px tall, a 1/64px value, where
     3 × 20.96 = 62.88. So the suite derives a line count of 3.0007. Chrome gives 62.8828125px and Firefox 62.9px.
   - This is an observation problem, not a prediction miss.
   - **Action:** in `tests/wrapping`, round height ÷ line height before comparing line counts, or take the count from
     rects.

## 2. Changes main can try

### 2.1 Give control characters their engine's width

This is the largest share of main's lab failures. On the development suite sample, the control-character families
`suite/U+*` give 2,774 of main's 4,593 Chrome line-count failures, 1,013 of 2,026 in Firefox and 2,381 of 4,235 in
webkit-host. On the held-out suite sample they give 2,509 of 3,629, 1,394 of 2,275 and 2,276 of 3,183. These are the
final rescoring, leaving out history-dependent cases (`.artifacts/lab/final-20260916/baseline-main/`); the 10:05
scoring in `lab/BASELINE-main.md` gives 1,015 of 2,065 for Firefox and 2,381 of 4,246 for webkit-host.

Every Canvas turns U+0009-U+000D into spaces: `a\fb`, `a\vb` and `a\rb` all measure like `a b` in all three browsers
(CRITIC C12). Firefox's Canvas also draws a hexbox for other C0 controls. The DOM does something else in each engine:

| Browser | DOM width of controls | How to get it from Canvas |
|---|---|---|
| Chrome 153 | `normal`: CR and TAB are a space; FF and VT add 5.328125px at 16px Arial and Helvetica Neue, from a Hiragino fallback glyph. `pre`/`pre-wrap`: CR and FF are zero-width and split shaping: span `A\fV` is `A` and `V` each rounded up to a LayoutUnit, without their kerning; VT +5.328125px. 1,185 of 1,429 controls in the Chrome lab rows have an advance (U+009D is 16px). | FF and VT in collapse modes: measure U+0001 in their place (blink-gaps §2.8; supported by probes-chrome X2, no dedicated probe). CR and FF in preserve modes: 0, with the text on each side measured apart. |
| Safari 27 (webkit-host) | CR takes its own glyph's advance (0 in Arial). FF, VT and other Cc take `.notdef` (12px in 16px Arial). | Measure U+0001 in place of FF, VT and other Cc, in the same string. Canvas and DOM differences are both 8 (webkit-canvas H10). |
| Firefox 156 | CR, FF, VT and hidden C0/C1 controls are 0 wide. 1,164 of 1,186 controls in the lab rows had zero-width rects; 4 had 1px. | Strip them before measuring. |

- Evidence: specs/PROBES.md "Cross-cutting checks" row 2; probes-chrome X2, blink-text H5, H6, blink-lines H12;
  probes-safari cross-cutting 2, webkit-lines H14, webkit-text H11, H12; probes-firefox gecko-lines H18, gecko-canvas
  H11, H12, gecko-text H9, H11; lab/README.md "Range geometry, per browser".
- **Action:** in preparation, give controls per-engine widths as in the table, then run the three gates.

### 2.2 Chrome: measure U+2060 in place of SHY, ZWSP, LRM, RLM, U+202A-U+202E and U+FEFF

Chrome's Canvas turns these characters into U+200B, which ends a word in fonts it shapes word by word
(`plain_text_node.cc:47-62, 85-91`). Leaving them out of the Canvas string is wrong too. Canvas then joins `👍` SHY `🏽`
into one emoji where the DOM keeps two segments, joins Geeza Pro letters across ZWSP, and moves Thai marks after ZWSP.

U+2060 WORD JOINER has the same HarfBuzz properties, Common script and bidi class BN, and Canvas doesn't normalize it.
Where the Canvas string would otherwise be 8-bit, the rebuild leaves the character out instead.

- Probe `rebuild/probes/blink-ignorables.ts` (`.artifacts/probes/blink/ignorables-2/`, `ignorables-3/`): the character
  itself, U+2060 and U+034F each equal the DOM on 27 of 29 strings. Leaving it out fails the emoji, Geeza Pro and
  Thai strings. The other 2, RLM before `((` in Amiri, aren't explained.
- In the rebuilt Blink engine, the change fixed 568 suite-sample line counts and broke 0 (specs/blink-RESULTS.md
  "Follow-up", suite-r6 against suite-r4).
- Emoji sequences with a soft hyphen or ZWSP (`woman-before-zwj/shy`, `skin-modifier/zwsp`) are most of main's
  failures outside the control families (lab/BASELINE-main.md).
- **Action:** try the substitution in the Chrome profile's segment measurement and run the Chrome gate.

### 2.3 Emoji: measure at the device size instead of detecting a correction

| Browser | DOM emoji width, Apple Color Emoji, 8-32px |
|---|---|
| Chrome 153 | `Math.ceil(64 × W(size × DPR)) / (64 × DPR)` at all 16 sizes at DPR 2; `W(size)` at DPR 1 (probes-chrome X1, blink-canvas H17) |
| Firefox 156 | `W(size × DPR) / DPR`, exact at apd 30, 60, 40 and 23. One device pixel off at apd 27 (110% zoom at DPR 2), because Canvas keeps 7 significant bits of the size (probes-firefox cross-cutting 1, gecko-canvas H5, H6) |
| Safari 27 (webkit-host) | `W(size)`, bit-exact (probes-safari cross-cutting 1), as PLATFORM_BUGS already says |

Firefox also keeps a document-wide state. Once any text shows U+1F600 U+FE0E, later U+1F600 in Arial draws the text
glyph, in DOM text and in new OffscreenCanvas contexts: 1020 app units at 16px instead of 960 (probes gecko F2, F3;
`.artifacts/probes/gecko/followups-f2/`, `.artifacts/probes/gecko/emoji-font/`; specs/gecko-AUDIT.md B1a). A
correction subtracted per emoji grapheme is then wrong. Comparing the run's font with a `"Apple Color Emoji"`
context, at the CSS size and at the device size, shows whether the color glyph is drawn (specs/gecko-RESULTS.md
"Port").

- **Action:** in the Chrome and Firefox profiles, measure emoji graphemes at size × DPR instead of subtracting a
  detected per-font difference, and check the Apple Color Emoji identity first in Firefox. Prepared widths then depend
  on the DPR at prepare time.

### 2.4 Fit tests: each engine's arithmetic replaces the epsilons

| Engine | Line fit, from source | Probe |
|---|---|---|
| Blink | An item's width is `ceil(64 × zoom × float32 width)` LayoutUnits. Available width is `trunc(64 × zoom × width)`. A line fits while position ≤ available + 1 LayoutUnit (`line_breaker.h:307-317`; blink-lines §1.5, §2.4). Zoom = DPR × browser zoom, so at DPR 2 thresholds sit on a 1/128px grid. | H1, H2, H9, X6: 17px Georgia threshold 153.5234375px, where a 1/64 grid predicts 153.515625px |
| WebKit | Float32 CSS px sums. Available width = `trunc64(width) + 1/64 −` content already on the line (`IL/TextOnlySimpleLineBuilder.cpp:481-486`, `IL/InlineLineBuilder.cpp:1172-1183`). DPR never enters. | webkit-lines H1, H2, cross-cutting 6 |
| Gecko | Integer app units: `round(W × 60)` per shaping unit, `width − trimmable ≤ available`, no device-pixel snapping at any apd (`gfxTextRun.cpp:1091-1092, 1175`). | gecko-lines H1-H3, CRITIC C8, cross-cutting 6 |

- The WebKit row is the source behind PLATFORM_BUGS' "Safari needs a 1/64px line-fit allowance".
- Main's float sums cost Chrome widths: 4,844 of main's 6,844 width-failing Chrome suite-sample cases miss by at most
  one 1/128px unit on every mismatched line (lab/BASELINE-main.md "Caveats").
- DevTools DPR emulation lays out at zoom 1 while reporting DPR 2 (probes-chrome blink-lines H3), and headless Chrome
  can too (lab/README.md "Browser sessions").
- **Action:** move the PLATFORM_BUGS 1/64px row to "Investigated, but not platform bugs", citing these lines. As an
  experiment, try the integer rule for Gecko. Blink's rule needs a ceil per shaping group, and main's per-segment
  sums don't have that grouping.

### 2.5 Firefox letter spacing: `ctx.letterSpacing = '0.001px'` plus spacing added per cluster

- Firefox's DOM turns optional ligatures off only when the spacing rounds to a non-zero app unit, and adds no spacing
  after cursive-script bases such as Arabic. Canvas drops ligatures at any non-zero value and spaces every cluster.
- Measuring at `'0.001px'` gives ligature-free shaping with no visible spacing. Adding the DOM's app units per cluster
  then equals the DOM:
  - 32px Times New Roman `office` at 1px: DOM 80.0167px = Canvas at 0.001px + 6px;
  - Geeza Pro `بببب` at 2px: DOM = Canvas at 0.001px.
- Evidence: probes-firefox gecko-canvas H14, H15, gecko-lines H21, gecko-text H30.
- **Action:** in the Gecko profile, measure letter-spaced text at 0.001px and add spacing per grapheme except after
  cursive bases. Check the letter-spacing snapshot.

### 2.6 Notes for RESEARCH.md

- **Arabic joining across rich-inline items (Chrome).** OpenType Arabic fonts (Noto Naskh Arabic, Amiri, Arial) join
  across span and `<b>` edges. Geeza Pro, which has AAT `morx` tables and no GSUB or GPOS, joins only inside one
  shaping group. Canvas can't tell the two apart. `W('ب' + ZWJ)` gives the isolated form in an LTR context; measure with
  `ctx.direction = 'rtl'`, or put the ZWJ between two Arabic letters.
  - Evidence: probes-chrome blink-text H3, H29; follow-up F1 (`.artifacts/probes/blink/followups/chrome-probes.json`);
    blink-RESULTS "Joining model", over 5,272 Arabic lab cases.
  - **Action:** add to "Rich Inline Boundaries".
- **Chrome restarts ICU at every line start with no prior context.**
  - So LB20a, "a hyphen at the start of a word doesn't break after", applies at every line start: `a‐b` with
    break-all and loose gives `a` / `‐b` with no break after `‐`.
  - U+2010 is class HH in Unicode 17, and Blink's break-all table has an empty HH row (probes-chrome blink-text H20,
    H34).
  - Main's generated data already has HH.
  - **Action:** add to "Breaks And Source Positions" if main ever breaks after a line-initial hyphen.
- **Chrome tab stops use the platform space advance without `trak` tracking.** 16px Helvetica Neue stops at multiples
  of 35.5859375px, not 8 × Canvas's 4.453125px (`simple_font_data.cc:225-240`; blink follow-up F4). This affects fonts
  with `trak` (Helvetica Neue, SF). **Action:** a RESEARCH note.
- **Kerning across spaces in Chrome without turning on features.** Blink maps U+2028 to the space glyph and doesn't
  end a Canvas word at it (`plain_text_node.cc:49-60, 89-90`; `harfbuzz_face.cc:110-113`). So a Canvas string with
  U+2028 in place of each U+0020 gives the one-call HarfBuzz total, legacy `kern` fonts included (blink-gaps §3.3).
  - One small probe run in installed Chrome 153 supports it (`rebuild/probes/blink-gaps-probes.ts`,
    `.artifacts/probes/blink/gaps/chrome-probes.json`, 11:18). No spec records the verdict.
  - For `A V` at DPR 2, the rounded-up U+2028 measurement equals the DOM span width in Arial (3188 LayoutUnits),
    Helvetica (3189), Times New Roman (3320) and Georgia (3233).
  - Helvetica, which kerns through the legacy `kern` table, still splits at the space under `optimizeLegibility`,
    while the U+2028 string doesn't.
  - Caveats: the string becomes 16-bit, and word spacing isn't applied to U+2028.
  - **Action:** add to "Kerning At Line Edges" as a candidate replacement for `optimizeLegibility`, after a wider
    probe (more strings and fonts, 1x and 2x DPR).
- **Bidi levels, if per-line runs come back.**
  - Blink and WebKit run ICU `ubidi_setPara` in default mode; Firefox runs the `unicode-bidi` crate 0.3.15.
  - The two disagree on 130,661 of 300,000 short fuzz strings: the unidirectional shortcut, the level of removed
    characters, paragraph splits at class B, and bracket pairs under overrides.
  - A line-by-line port of ICU 78.2's `ubidi.cpp` matched icu4c 78.3 and macOS libicucore on 405,000 fuzz strings and
    both conformance files.
  - macOS 27's libicucore gives the private-use characters U+F7F0-U+F8FF Apple's own bidi classes.
  - Evidence: rebuild/DESIGN-REVIEW.md B1; specs/bidi.md §7.4; `rebuild/src/unicode/ubidi.test.ts`.
  - **Action:** add to "Bidi Levels".
- **Safari 27 break-rule changes** (WebKit 7625 against 7624, which is Safari 26.5.2; specs/webkit-text.md §15):
  - U+2028 and U+2029 force a line break in every white-space mode (webkit-text H13: `a` U+2028 `b` gives 2 lines).
    Chrome treats U+2028 like a space (blink-text H13: 1 line at 1000px).
  - U+201C and U+201D get opening and closing quote classes with a local LB19a rule. `中文“abc”中文` under `ja` breaks at
    {1, 8} in 7624 and at {1, 2, 7, 8} in 7625. `中«abc»中` goes from {} to {1, 6} (webkit-text H4, H5).
  - Keep-all breaks after punctuation in 16-bit strings (section 1).
  - **Action:** rerun main's Safari gate on Safari 27 and recheck the Safari column of RESEARCH "Content Language".

## 3. Documentation corrections

| Document, row | Finding | Evidence | Action |
|---|---|---|---|
| PLATFORM_BUGS, Firefox canvas font size ("DOM text uses the requested size on a 1/64px grid … the cause is unknown") | DOM font sizes go through Servo's `quantize_font_size`, which keeps 10 significant bits (16.8px lays out at 16.8125px), then `NSToIntRound(px × 60)` app units. So 13.375px lays out at 803/60 = 13.3833px while Canvas stays at 13.375px. A connected canvas reads back the 10-bit size (13.33px → 13.3281px). | probes-firefox gecko-canvas H3, H3b, H4; specs/gecko-canvas.md §1.2 C2, §6 item 11; `servo/components/style/values/specified/font.rs:993-1022` | Rewrite the first sentence and replace "cause is unknown". |
| PLATFORM_BUGS, Chrome `system-ui` (Chromium #489579956) | In a clean renderer the DOM width equals Canvas at the CSS size scaled: `Math.ceil(64 × DPR × W(size)) / (64 × DPR)` at every size 10-28px. The DOM gives opsz the specified size, but `FontCacheKey` holds only the effective size, so whichever text creates the platform font first decides later widths: 13px DOM 67.875px clean, 60.5703125px after a Canvas measured 26px `system-ui`. `-apple-system` resolves like `sans-serif` in Chrome 153. | probes-chrome blink-canvas H16, CRITIC C7, cross X5; `font_cache_key.h:53-68`, `font_description.cc:308-331`, `font_platform_data_mac.mm:170-178`; `.artifacts/probes/blink/sysui-dpr2/`, `sysui-domfirst-dpr2/` | Add the mechanism to the row and comment on the issue. Keep the README caveat. |
| PLATFORM_BUGS, Firefox `system-ui` (Mozilla #2020917, "different physical fonts") | Same family, different optical size. An OffscreenCanvas never sets automatic optical sizing (`nsFont.cpp:276-279`, reached only through `nsFontMetrics.cpp:149`). DOM text with `font-optical-sizing: none` equals the Canvas at 13, 14, 16 and 20px. | probes-firefox gecko-canvas H8, cross-cutting 5; specs/gecko-canvas.md §1.2 C1a, §6 item 2 | Correct the row and comment on the bug. |
| PLATFORM_BUGS, Chrome emoji (Chromium #489494015) and Firefox emoji (Mozilla #2020894) | Exact device-size formulas as in 2.3. Gecko's formulas reproduce the Mozilla bug's table: DOM asks Core Text at `round(q10(s) × 60) / apd` device px, Canvas at `quantize7(s × DPR)`. | probes-chrome X1; probes-firefox cross-cutting 1; specs/gecko-canvas.md §6 item 7 | Add the formulas to both rows, comment on both issues. |
| PLATFORM_BUGS, keep-all punctuation (WebKit #312099) | Shipped in Safari 27.0 for 16-bit strings only; 8-bit strings keep the old rule (`R/BreakablePositions.h:292-299`). | section 1; probes-safari webkit-text H15, webkit-canvas H14 | Update the row; see 5.2. |
| PLATFORM_BUGS, 1/64px Safari line-fit allowance | Explained by source (2.4). | specs/webkit-lines.md §1.4 | Move to "Investigated, but not platform bugs". |
| PLATFORM_BUGS, "Investigated" bullet on Firefox OffscreenCanvas language | A page OffscreenCanvas follows `<html lang>` at its next measurement. A worker's OffscreenCanvas follows the macOS locale (zh-Hans here), not `navigator.languages` (en-US) or the page. | probes-firefox gecko-canvas H9, H10 | Refine the bullet. |
| PLATFORM_BUGS, new rows | WebKit page history and string storage (5.1, 5.2); Firefox's text-presentation emoji state (5.5). | section 5 | Add as `Unfiled` until reported. |
| RESEARCH | Section 2.6 items. | above | Add where named. |
| README | No change needed now. The `system-ui`, fractional-size and page-language caveats hold. If 2.1 lands, no control-character caveat is needed. | — | none |

## 4. Harness notes for `tests/wrapping`

- **WebKit page history.** Identical text and style can break differently depending on what the same WebContent
  process laid out and tore down before (5.1).
  - In the rebuild's final lab runs, 55 of 19,933 development suite-sample cases in webkit-host lay out differently in
    forward and reverse order, and 154 of 10,000 held-out ones. Chrome shows 0 in both.
  - Firefox shows 123 of 19,888 development cases, 116 of them with U+1F600, from the emoji state in 2.3. It shows 216 of
    10,000 held-out cases. 113 of those have U+1F600; the other 103 are the `suite/U+FFFD` families, a soft hyphen next
    to U+FFFD, whose cause wasn't traced (`.artifacts/lab/final-20260916/analysis.json`).
  - 13 of main's 2,986 old Safari rows differed from host rows only because of page order (lab/WEBKIT-HOST.md
    "Order within a page").
  - **Action:** before changing the WebKit profile over a flipped Safari row, rerun it alone in a fresh page and in the
    opposite order.
- **String storage from JSON.** In JavaScriptCore, `Response.json()` of a body with any raw non-Latin-1 character gives
  16-bit strings even for ASCII values (`JavaScriptCore/runtime/LiteralParser.cpp:896-899`).
  - Main's page parses only its config through JSON and generates case text from JavaScript, which the probes found
    stays 8-bit. Main is probably unaffected.
  - **Action:** keep case text out of JSON payloads, or serve JSON with everything above U+007E escaped (rebuild commit
    8df70c6; `.artifacts/lab/verify-8bit/`).
- **Chrome takes focus.** `open -g` doesn't stop Chrome activating itself when it shows its startup window.
  `--no-startup-window --remote-debugging-port=0`, then DevTools `Target.createTarget { newWindow: true, background:
  true }`, opens the window inactive (lab/VALIDATION.md problem 2). **Action:** check main's native Chrome driver.
- **Range geometry.** Quirks main's extractor may meet (lab/README.md "Range geometry, per browser"; lab/VALIDATION.md
  passes 3-4):
  - Firefox puts an emoji + VS16 cluster's advance on the VS16, and a letter + ZWNJ/ZWJ's on the joiner, with a
    zero-width base.
  - WebKit reports the collapsed space after `</span>` as a zero-width rect on the next line.
  - Chrome's rects at DPR 2 are exact 1/128px values.
  - Safari floors a code point's right edge at a box end to 1/64px, while whole-node rects keep float32 edges.
  - Firefox's `document.fonts.check` is true for a missing family.

## 5. Candidate platform bug reports

Search each tracker first; none of these was searched tonight.

| # | Browser | Behaviour | Minimal repro | Evidence |
|---|---|---|---|---|
| 5.1 | WebKit | `TextBreakingPositionCache` keys text by value plus a style context that maps `pre-wrap` and `break-spaces` to one value, and ignores storage width. The cache is filled when a block's line layout is destroyed. So `break-spaces` text laid out after the same text under `pre-wrap` keeps all six spaces on one overflowing line instead of wrapping per space. | Lay out and remove `abc      def` in 16px Arial under `pre-wrap`, then show it under `break-spaces` at 30.234375px. | probes-safari cross-check item 1 (`.artifacts/probes/webkit-crosscheck-cache/`); `L/text/TextBreakingPositionCache.h:41-48`, `L/text/TextBreakingPositionContext.h:43-56`, `L/InlineItemsBuilder.cpp:936, 972-978`, `W/layout/integration/inline/LayoutIntegrationLineLayout.cpp:210-221` |
| 5.2 | WebKit | Line breaking depends on whether a text node is stored 8-bit, which follows where the string came from. Keep-all breaks after punctuation, and the first-unit emergency break, happen only in 16-bit text. | `abcd,efghé`, keep-all, 16px Menlo, 50px: 1 line when the text comes from a JS literal, 2 lines when it comes from `fetch(…).json()` of a body that also holds `中`. | probes-safari cross-check item 2 (`.artifacts/probes/webkit-crosscheck-storage/`, `-payload/`); `.artifacts/lab/verify-8bit/`; `R/BreakablePositions.h:292-299`, `L/InlineContentBreaker.cpp:143` |
| 5.3 | Chrome | `system-ui` DOM widths depend on which text created the platform font first. Comment on Chromium #489579956. | Fresh browser: Canvas 20px `system-ui`, then DOM 10px (52.6796875px); fresh browser in the other order: 54.140625px. | probes-chrome cross X5 "cache order" |
| 5.4 | WebKit | OffscreenCanvas `letterSpacing` keeps optional ligatures that DOM text turns off at any non-zero spacing. | 32px Hoefler Text `ffi fl` at 0.001px: Canvas 54.403px, DOM 57.414px. | probes-safari webkit-canvas H3, H4, CRITIC C13, cross-cutting 3 |
| 5.5 | Firefox | After text shows U+1F600 U+FE0E, later U+1F600 in Arial draws the text glyph in DOM text and in new OffscreenCanvas contexts. An explicit `"Apple Color Emoji"` context isn't affected. The cause wasn't traced; asynchronous fallback was ruled out (F1). | Measure `😀︎` in an OffscreenCanvas, then measure `😀` in a new context at 32px Arial, and lay out `😀` in 16px Arial. | gecko probes F1-F3 (`.artifacts/probes/gecko/followups/`, `followups-f2/`, `emoji-font/`); `.artifacts/lab/gecko/audit/debug-fe0e/` |
| 5.6 | Firefox | OffscreenCanvas `wordSpacing` spaces U+3000 and not NBSP; DOM `word-spacing` spaces NBSP and not U+3000 (`gfxFont.cpp:749-750`). | 16px Georgia with 10px spacing: `a b` against `a　b`, in Canvas and DOM. | probes-firefox gecko-canvas H16, gecko-lines H7 |
| 5.7 | Firefox | OffscreenCanvas draws hexboxes for C0 controls that DOM text and a connected canvas hide, and splits a word at bidi controls that the DOM removes. An OffscreenCanvas has no pres context (`nsBidiPresUtils.cpp:2249-2252`). | 18px Arial: `A` LRM `V` measures A + V (24px) against DOM `AV` (22.6667px); `a` U+0001 `b` measures 30.03px against 17.03px. | probes-firefox gecko-canvas H12, H13 |
| 5.8 | Firefox | OffscreenCanvas never applies automatic optical sizing. Comment on Mozilla #2020917. | 14px `-apple-system` pangram: Canvas 251.7167px, DOM 289.15px, DOM with `font-optical-sizing: none` 251.7167px. | probes-firefox gecko-canvas H8 |
| 5.9 | Firefox | Canvas `letterSpacing` adds spacing after cursive-script bases, where the DOM adds none, and turns ligatures off at spacing the DOM rounds to 0 app units. Check the Canvas spec wording before filing. | 24px Geeza Pro `بيت`: Canvas at 2px is 6px wider than at 0.001px; DOM at 2px equals DOM at 0. | probes-firefox gecko-canvas H14, H15 |
| 5.10 | Chrome, Firefox | Comment with the device-size formulas of 2.3 on Chromium #489494015 and Mozilla #2020894. | as in 2.3 | probes-chrome X1; probes-firefox cross-cutting 1 |
| 5.11 | WebKit | OffscreenCanvas has no locale (existing WebKit #285993). Add the probe: under `ko`, 32px `sans-serif` `永骨` is 64px in Canvas and 55.36px in DOM text. A connected `<canvas>` without its own `lang` equals the DOM. | as stated | probes-safari cross-cutting 4, webkit-canvas H7 |
| 5.12 | Chrome | Tab stops use the untracked platform space advance. Possibly by design; weak candidate. | 16px Helvetica Neue `pre`: stops at 35.5859375px against 8 × Canvas's space advance of 4.453125px. | blink follow-up F4 |

Not bug reports:

- Servo's 10-bit font-size quantization is intentional.
- Canvas replacing U+0009-U+000D with spaces follows the HTML canvas text preparation steps, except that VT isn't ASCII
  white space.
- Safari 27's 1/64px paragraph heights.
- DevTools DPR emulation laying out at zoom 1.
- WebKit's one-float32-step difference between its shortcut and full measuring paths at fractional sizes
  (probes-safari correction 5) is too small to report.
