# Probe results across Chrome, WebKit and Firefox

Measured on 2026-09-16 on one macOS 27 Mac with a Retina display (`devicePixelRatio` 2). This file collects what the
probes changed in the specs. For each engine it lists the hypotheses that were refuted, inconclusive or not run, the
spec sections they correct, and the Canvas-versus-DOM gaps that were confirmed, with their recipes. The full tables are
in the three engine reports:

- `probes-chrome.md`: installed Chrome 153.0.8010.48. Probes in `rebuild/probes/blink-probes.ts`, results under
  `.artifacts/probes/blink/`.
- `probes-safari.md`: **webkit-host**, a background WKWebView app on the system WebKit 22625.1.29.11.27, which is the
  WebKit build installed Safari 27.0 uses. **Installed Safari was not run.** It stayed the frontmost app from 07:04 to
  at least 09:08, and the runner doesn't open a probe window over it. Two agents encoded the WebKit hypotheses
  independently (`webkit-probes.ts`, 89 probes; `webkit-probes-crosscheck.ts`, 118 probes). Where they disagreed, the
  verdicts here follow the follow-up probes in `probes-safari.md`.
- `probes-firefox.md`: installed Firefox 156.0. Probes in `rebuild/probes/gecko-probes.ts`, results under
  `.artifacts/probes/gecko/`.

Every refuted claim, and every spec statement a measurement contradicted, now has a note under it in its spec file.
The notes start with "Measured in installed Chrome 153 on 2026-09-16:", "Measured in installed Firefox 156 on
2026-09-16:" or "Measured in webkit-host (system WebKit 22625.1.29.11.27; installed Safari 27.0 not run) on
2026-09-16:". The original text is kept.

Terms:
- **W(s)**: `measureText(s).width` on an OffscreenCanvas at the stated font. **OC** is an OffscreenCanvas 2D context.
  **EC** is the 2D context of a `<canvas>` element in the document.
- **ceil64(x)** = `Math.ceil(x × 64) / 64`. A Blink layout unit is 1/64 of a zoomed px, which is 1/128 CSS px at DPR 2.
- **au**: Gecko's integer app unit, 1/60 CSS px. **apd**: app units per device pixel, 30 at DPR 2.
- Chrome "DPR 1" means `--force-device-scale-factor=1` on the Retina display. Firefox apd 60, 40, 27 and 23 come from
  the `layout.css.devPixelsPerPx` pref. No run used the page zoom UI or a physical DPR 1 display.

## Counts

| Engine | Spec and CRITIC rows | Confirmed | Refuted | Inconclusive | Not run | Cross-cutting rows |
|---|---|---|---|---|---|---|
| Chrome 153 | 84 | 75 | 9 | 0 | 0 | 7: 6 confirmed, 1 refuted |
| webkit-host | 79 | 71 | 1 | 2 | 5 | 6: 5 confirmed, 1 refuted |
| Firefox 156 | 91 | 87 | 3 | 0 | 1 | 9: 8 confirmed, 1 refuted |

webkit-host also confirmed two effects that no spec predicted: WebKit's break-position cache, and a text node's storage
width following where the string came from. Installed Safari 27.0: not run.

---

## Chrome 153 (Blink)

### Refuted

| Hypothesis | Measured | Spec sections corrected | Correction |
|---|---|---|---|
| blink-lines H2 | DPR 2, `nnnnn nnnnn` 16px Arial: C128 = 11959; 93.421875 → 1 line, 93.4140625 → 2. Forced DPR 1 agrees at every width, because 64 × W(16px) = 5979.5 exactly, so C128 = 2 × C64 − 1. `Hello world` at 10128/128, `abc def ghi` at 10018/128 and `The quick brown` at 15024/128 give 1 line at DPR 1 and 2 lines at DPR 2. | blink-lines §21 probe 2; CRITIC §6 item 12 (W8) | The fit formulas (§1.5, §2.4) hold. DPR 1 and DPR 2 differ only when C128 = 2 × C64, at the single width (2 × C64 − 2)/128. Use a string like `Hello world` for the comparison. |
| blink-lines H15 | Hiragino Sans: F − 4 → `あああ」`, F − 9 → `ああ`, smallest width keeping `あああ」` 55.9921875. The Courier New control gives the same: F − 4 → `あああ」`, threshold 55.9921875. | blink-lines §21 probe 15 (§6 step 4) | Courier New has no Japanese glyphs, so 」 comes from a CJK fallback font that has `halt`, and `TextSpacingTrimFallback`/`TextSpacingTrimFallbackChws` are stable. The line-end trim follows the font that renders the bracket, including a fallback. No control font without `halt`/`chws` was found. |
| blink-text H3 | Geeza Pro `ب<b>ب</b>` 55.90625 = isolated 25.59375 + bold isolated 30.3125, not initial + bold final 55.6875. Noto Naskh Arabic: 43.6875 = initial 11 + bold final 32.6875. | blink-text §2.E "Arabic joining does cross them"; §6 H3 | Joining across shaping groups needs an OpenType Arabic font. Geeza Pro's faces carry `morx` and `kern` but no `GSUB` or `GPOS`; [I] HarfBuzz's AAT shaper ignores the buffer context. Geeza Pro joins only inside one group (`ب<span style="color:red">ب</span>` 37.4921875). |
| blink-text H20 | `a‐b` with break-all + loose: 2 lines `a` / `‐b` (expected 3). break-all alone: `a‐` / `b`. `‐b` alone: 1 line. | blink-text §2.F.5; §6 H20 | U+2010 is class HH at ICU 78 (Unicode 17), not BA, and the break-all table's HH row is empty. A break after a hyphen can only come from ICU, which restarts at each line start where LB20a (`line_normal.txt:301`) forbids a break after a line-initial hyphen. Look up Unicode 17 classes, HH included. |
| blink-text H29 | Geeza Pro matched only because its initial and isolated ب have the same advance. Noto Naskh Arabic: DOM first ب 11 (initial); W(`ب` + ZWJ) 30.8799896 = W(`ب`) (isolated); with `ctx.direction = 'rtl'` 11; `ب` + ZWJ + `ب` = `بب` 43.6799927. | blink-text §5 item 4; §6 H29 | The ZWJ workaround fails in an LTR context. Measure a joining form with `direction = 'rtl'`, or with the ZWJ between two Arabic letters. [I] Under UAX #9 L1 the trailing ZWJ forms its own LTR run. |
| blink-text H32 | `CSS.supports('text-transform', 'full-width')` false, computed `none`; span 22.53125 (plain `a b`), not 48. | blink-text §2.B; §6 H32 | `full-width` and `full-size-kana` sit behind the experimental flags `CSSTextTransformFullWidth` and `CSSTextTransformFullSizeKana`, so they aren't parsed in stable Chrome. Remove both from Chrome's supported transforms. |
| blink-canvas H16 | Clean renderer, DPR 2: DOM(S) = ceil64(2 × W(S))/128 at every size 10–28px (13px `Hello world`: DOM 67.875, W(13px) 67.8691406, W(26px)/2 62.5902023). After a Canvas measured 26px system-ui first: DOM 60.5703125. DPR 1: DOM = W(13px). | blink-canvas §1.8 system-ui; (e) not-obtainable item 4; (f) H16; blink-lines §2.5, §20 | Canvas at the CSS size reproduces the DOM for system-ui. The DOM gives opsz and HarfBuzz ptem the specified size, so its advances at the zoomed size are the CSS-size advances scaled. `FontCacheKey` holds the effective size but not the specified size, so opsz comes from whichever text created the platform font first. That order is a named loss. |
| CRITIC C7 | 16px Arial `Hello world` 79.140625 = W(32px)/2 (holds). 13px system-ui in a clean renderer: 67.875 = ceil64(2 × W(13px))/128; 60.5703125 only after a Canvas at 26px came first. | CRITIC §4.2 C7; §6 item 1 | As blink-canvas H16. |
| CRITIC C14 | `text-transform: full-width`, width 1px, 16px Hiragino Sans, `ab`: 1 line. | CRITIC §4.2 C14; §6 item 8 | Chrome's row is 1 line, because the keyword isn't parsed (blink-text H32). |
| cross X5 system-ui and -apple-system | system-ui clean DOM = Canvas at the CSS size, not at size × DPR. `-apple-system` resolves like `sans-serif` (13px 67.4829254, equal to `sans-serif`) and its DOM = ceil64(W(2S))/128. `BlinkMacSystemFont` = system-ui. | blink-canvas §1.8; blink-lines §20 | As blink-canvas H16. `-apple-system` isn't a system-ui alias in Chrome 153. |

### Confirmed, but a spec detail changes

- blink-canvas H6: under `textRendering = 'optimizeLegibility'` Times New Roman gives the DOM whole-run width
  (112.3046875), not the split sum the spec guessed. On macOS 27 its space glyph is in GPOS or GSUB coverage.
- blink-text H5 and H6: the DOM width of FF and VT under `white-space: normal` is now measured. At 16px Arial and
  Helvetica Neue at DPR 2 each adds 5.328125px over `ab`; VT does the same in pre-wrap. Canvas can't supply it.
- blink-lines H4: at DPR 2 the float32 1/100 floor applies to the zoomed size, so the DOM widths at 17.3px (288.140625)
  and 17.29px (288.0546875) differ, while Canvas keeps them equal.
- blink-canvas (e) not-obtainable item 4 cites H19 for bitmap emoji; the emoji probe is H17.
- blink-canvas H15: the worker half isn't separated from `en` by `Hello, world` in serif.
- blink-lines H16: 16px Times New Roman has no fractional 1/64 parts, so no mismatch width exists there. The mismatch
  shows at 16.1, 16.3, 13.37 and 15.55px (DPR 2) and 16.1 and 17.7px (DPR 1).
- CRITIC §7 open question: installed Chrome on this display lays out at zoom 2. Line thresholds sit on the 1/128 px
  grid (17px Georgia 153.5234375, where a 1/64 CSS grid predicts 153.515625). Under DevTools emulation they stay on the
  1/64 CSS px grid.

### Canvas-versus-DOM gaps confirmed, with recipes

| Fact | DOM | Canvas | Recipe, or the loss |
|---|---|---|---|
| Apple Color Emoji | Advance at size × DPR: DOM = ceil64(W(size × 2))/128 at 16 of 16 sizes, 8–32px. DPR 1: W(size). | At the CSS size, wider at 10–20px: 10px 13 vs 11, 12px 15 vs 12, 14px 18 vs 14, 16px 20 vs 16, 20px 22 vs 20; equal at 8, 24, 32px. | Measure at size × DPR, then ceil to 1/(64 × DPR). Exact. |
| `system-ui` | Clean renderer: ceil64(W(size) × DPR)/(64 × DPR), at every size 10–28px. | W(size × DPR)/DPR is wrong (13px: 62.5902023 vs 67.875). | Measure at the CSS size. Loss: once page text or a Canvas at size × DPR has created the platform font, later widths change (13px DOM 60.5703125). The library can't see that history. |
| `-apple-system` | Resolves like `sans-serif`. | Same. | Measure at size × DPR, as for other named fonts. |
| Generic families by `<html lang>` | ja, zh-Hans, ko and en pick different families (`Hello` 39.28125 under ja, 34.5 under ko). | OC = DOM for all 12 cases (DOM = ceil64(W at 32px)/128). | OC keeps the language it resolved with until the font string changes, so set `ctx.lang` or re-set a different font string after a lang change (blink-canvas H13). An EC follows the lang right away (H14). A worker's own OC follows the UI language (H15). |
| CR and TAB, `white-space: normal` | A space. | A space. | Canvas totals. Exact. |
| FF and VT, `white-space: normal` | `ab` + 5.328125px (16px Arial, Helvetica Neue). | A space. | No recipe; a named loss. |
| CR and FF in pre and pre-wrap | Zero-width control items that split shaping: span `A\fV` 23.109375 = ceil64(A) + ceil64(V). | A space (`A\fV` = `A V` 27.109375). | Measure the pieces without them. |
| VT in pre | Literal, +5.328125px. | A space. | Named loss. |
| TAB in pre | A tab stop. | A space. | Compute the stop from W(' ') (blink-lines H10). |
| Optional ligatures under letter spacing or `optimizeSpeed` | Off. | Off. | They agree, and Canvas at size × DPR rounds to the DOM (40px Hoefler Text `ffi fl`, 0.001px: DOM 71.7734375 = ceil64(2 × 71.7659683)/128). |
| Kerning or ligatures across a space | Whole run. | Split per word by default (Arial `AV AV` 111.89453125). | `textRendering = 'optimizeLegibility'` gives the whole-run width for Arial (109.6875) and Times New Roman (112.3046875). |
| Arabic joining across a span with a different font | Initial and final forms, for OpenType fonts. | Isolated forms when a letter is measured alone, including `ب` + ZWJ in LTR. | `ctx.direction = 'rtl'`, or put the ZWJ between two Arabic letters. |
| Font size floor at DPR 2 | Float32 1/100 floor of the zoomed size. | Floor of the CSS size. | Measure at size × DPR. |
| EC inherits element styles | — | `<canvas style="letter-spacing:5px">` adds 15 (DPR 1) or 30 (DPR 2) to `abc` with `letterSpacing` never set. | Use OffscreenCanvas. |
| Measurement order in one context | — | Word spacing at offset 0 and the script of punctuation are cached per context (H7, H8, H9). | Control the order, or use fresh contexts. |
| Line-fit grid | 1/(64 × DPR) CSS px: 1/128 at DPR 2, 1/224 at forced DPR 3.5; 1/64 CSS px under DevTools emulation. | — | Use the real DPR in the fit arithmetic. |

---

## WebKit (webkit-host, system WebKit 22625.1.29.11.27; installed Safari 27.0 not run)

### Not confirmed

| Hypothesis | Verdict | Measured | Spec sections | Correction |
|---|---|---|---|---|
| webkit-lines H13 | refuted | `<div></div>` 0px tall. textContent `"\r"` 0px, `" \t\n\f"` 0px, `"\v"` 20px. The HTML parser turns a literal CR into LF. | webkit-lines §12 H13 | An empty block has no line box. CRITIC W7 is right. |
| cross 5 system-ui | refuted | DOM = OC in 14 of 16 cases (the other encoding: 15 of 16 per family). 20px `The quick brown fox 0123`: DOM 225.220261, OC 225.220245. `system-ui` = `-apple-system`. | webkit-canvas (e) simplified-measuring row | One float32 step on the DOM shortcut path; see the gaps table. |
| webkit-lines H6 | inconclusive | A and B give identical line starts at every 1/64px width from 16.78 to 70.39px; at 40.90625 both put `aabb‐` on line 1. The four conditions can't all hold in 16px Arial: w(cc) = 16 > H = 5.328125. One encoding reported it refuted. | webkit-lines §2 difference 2; §12 H6 | Source reading: LineBuilder already counts the hyphen, with the epsilon, in a candidate ending in U+00AD, so the no-epsilon revert loop (`IL/InlineLineBuilder.cpp:1860-1887`) looks reachable only when a non-text item follows the soft-hyphen item inside the candidate (`aa&shy;<span></span>bb`). Re-probe with such markup. |
| webkit-lines H22 | inconclusive | `::first-line { font-size: 16px }`: [0, 11, 22] at 112.75, 113.5 and 114.75px (carry kept). `::first-line { letter-spacing: 1px }`: [0, 10, 21, 32] at all three widths in one encoding; [0, 11, 22, 33], [0, 11, 22, 33] and [0, 11, 22] in the other. | webkit-lines §12 H22 | Neither the fresh nor the carry model predicts these. Settling `IL/AbstractLineBuilder.cpp:84-91` needs a `breakWord` port with the first-line style. |
| webkit-lines H16 | not run | DPR 1 isn't available. The border part is confirmed: `border-left: 0.7px` becomes 0.5px at DPR 2. | — | — |
| webkit-lines H17, webkit-canvas H9, CRITIC C10, CRITIC W5 | not run | webkit-host has no page zoom. CSS `zoom: 1.25` proxy for C10: `width: 93.425049px`, 16px Arial `nnnnn nnnnn` (float32 width at 20px 116.787109) → 1 line, so lengths are zoomed before the 1/64 truncation. | — | Page zoom still needs installed Safari. |

Rows that depend on the process, not only on WebKit: webkit-text H6 (no lang), H7 (`lang=""`), H8, H30; webkit-canvas
H7 and H11 (`xx`, no lang); CRITIC C11; cross 4. They are confirmed in webkit-host, whose process languages are `zh-CN`:
no lang, `und` and `xx` behave like `en`. Safari's own WebContent defaults weren't measured.

### Where the two encodings disagreed, settled

1. **webkit-lines H11, `white-space: break-spaces`.** One encoding kept all six spaces on line 1; the other gave
   `abc ` / 5 spaces / `def`, as the spec says. Cause: the break-position cache (next section). Confirmed in a fresh
   process. Correction 2 in the first part of `probes-safari.md` is withdrawn.
2. **webkit-lines H9, webkit-text H15, webkit-canvas H14.** The 8-bit rows gave 16-bit results in one encoding. Cause:
   storage width (next section). Confirmed for text stored 8-bit.
3. **webkit-lines H19.** The second box read 54px only because a Range over DOM offsets covers `STRAS` of the
   transformed text. The per-line rects of a wrapping span are [74.6875, 74.6875] = the Canvas recipe. Confirmed.
4. **webkit-lines H6.** Refuted in one encoding, inconclusive in the other, from the same measurements. Inconclusive
   here, because the hypothesis's conditions can't hold.

### Page history and storage width

- **Break-position cache.** WebKit keeps process-wide break positions in `TextBreakingPositionCache`, keyed by the
  string's value, a style context and the security origin (`L/text/TextBreakingPositionCache.h:48`).
  - The context maps `Preserve` and `BreakSpaces` to one value (`L/text/TextBreakingPositionContext.h:43-56`), and
    storage width isn't in the key.
  - `handleTextContent` reads the cache before building items (`L/InlineItemsBuilder.cpp:936`). Only its fresh path
    gives break-spaces one item per space (`:972-978`).
  - The cache is filled when a block's line layout is destroyed while the document lives
    (`W/layout/integration/inline/LayoutIntegrationLineLayout.cpp:210-221`). Only text boxes with at least 3 items
    and 5 code units are stored.
  - Measured: break-spaces `abc      xyz` laid out after the same text in pre-wrap keeps all six spaces on line 1; alone
    it wraps per space. Keep-all `pqr,stu(vwx` stored 8-bit gives 3 lines right after a 16-bit document with the same
    text, and 1 line alone in a fresh process.
  - So identical text and style can break differently depending on what the same WebContent process laid out and tore
    down before. It may explain the lab's history-dependent WebKit rows.
- **Storage width.** Whether a text node is stored 8-bit or 16-bit depends on where the string came from, and JS can't
  see it.
  - JSON string tokens parsed from a UTF-16 source are stored 16-bit (`JavaScriptCore/runtime/LiteralParser.cpp:896-899`),
    and the fast `innerHTML` parser keeps the source width (`W/html/parser/HTMLDocumentParserFastPath.cpp:1154-1156`).
  - Measured: when a document's fetched JSON contains any non-Latin-1 character, the same markup gives 16-bit results:
    keep-all `abcd,efghé` 2 lines instead of 1, and `W)))iiii` puts `W)))` on line 1 instead of `W`.
  - Not reproduced from plain JS: `(s + '一').slice(0, -1)`, `JSON.parse(JSON.stringify([s, '一']))[0]`,
    `createTextNode` and `innerHTML` of those all behaved 8-bit.
  - webkit-text §13's "every unit ≤ U+00FF" approximation fails in practice. The painter must control storage, which
    isn't yet shown possible, or this is a named loss.
- **Harness rules.** Keep a probe document's payload Latin-1-only or build text from JS literals, and record which.
  Compare cache-sensitive cases in a fresh webkit-host process, or with content unique to one case.

### Other corrections

- webkit-canvas §1.4, Simple path: "TAB/LF/CR/NUL/default-ignorable: delete glyph" is wrong for LF and CR. They take
  the space glyph and `continue` before the delete check (`G/WidthIterator.cpp:792-800`), so they keep their own glyph's
  advance, as webkit-lines §3.3 says. Only NUL and default-ignorables are deleted. That advance is 0 in Arial: DOM
  `a\rb` = `ab` = 17.796875 in normal and pre, which answers webkit-lines §14's open question for Arial.
- webkit-lines H3 needs a discriminating font. In 16px Georgia M(`AV `) − M(` `) = M(`AV`), so the probe can't tell the
  following-space rule from plain measurement.
- Observer caveats: a collapsed space right after `</span>` reports a zero-width Range rect on the next line, and
  length-changing `text-transform` shifts Range offsets. Both change reported line starts without changing layout.

### Canvas-versus-DOM gaps confirmed, with recipes

| Fact | DOM | Canvas | Recipe, or the loss |
|---|---|---|---|
| Apple Color Emoji | = OC at the CSS size, bit-exact at 8–32px (11, 13, 16, 19, 21, 23, 25, 32). | OC at size × 2 ÷ 2: 10.5, 11.5, 12.5, 14, 16, 20, 24, 32. | Measure at the CSS size. The size × DPR recipe is wrong below 32px, by 3.5px at 12px. |
| `system-ui`, `-apple-system` | Same family. | — | OC at the CSS size; bit-exact except the shortcut-path step below. |
| DOM shortcut measuring path (plain Latin text, primary font, no spacing) | Shapes once and sums advances in one loop (`G/FontCascade.cpp:381-412`). | WidthIterator order: pre-shaping sums, then `after − before` per range. | Differs by one float32 step: `Hello world` at 11.1111px 54.958710 vs 54.958717, at 17.49px 86.510597 vs 86.510605; equal at 16px and on the full path (NBSP text). A fit test at an exact threshold can flip. Port the shortcut summing order, which needs per-glyph advances, or name the loss. |
| CR | Its own glyph advance, normal and pre (0 in Arial). | A space. | Canvas can't give the CR glyph advance. Measure without CR where it's 0; otherwise a named loss. |
| FF and VT | `.notdef` advance (12px in 16px Arial). | A space. | OC measures `.notdef` through another C0 character such as U+0001: the Canvas difference 8 equals the DOM difference 8 in 16px Helvetica Neue (webkit-canvas H10). |
| TAB | normal: a space (22.242188 for `a\tb`); pre: a tab stop (44.460938). | A space. | Space from Canvas; compute stops statically. |
| Optional ligatures under letter spacing or `text-rendering: optimizeSpeed` | Off at any non-zero spacing (32px Hoefler Text `ffi fl` at 0.001px: 57.414 = per-glyph sum 57.408 + 6 × 0.001) and under optimizeSpeed (57.408). | OC keeps them (0.001px: 54.403). `ctx.textRendering` isn't a native property. | An EC with CSS `font-variant-ligatures: no-common-ligatures` equals the DOM (16px Hoefler Text `fifl` at 10px spacing: 59.344002, webkit-canvas H4). |
| Page language (generic families, Han locale) | Follows `lang`. | OC has no locale: identical pixels under ja, zh-Hans, ko and en. Under ko, `永骨` OC 64 vs DOM 55.36. | An EC inherits the page lang through its computed style, even without its own `lang` (53.328 = DOM, webkit-canvas H7). |
| Item widths | `W(item + ' ') − W(' ')` rule. | — | Exact: the first one-line width is ceil(64w) − 1 for 8 strings. |
| Font size | No quantization. | No quantization. | Fractional sizes are fine. |
| Line-fit grid | 1/64 CSS px at DPR 2; every 2 → 1 line transition in a 1/128px scan is at an even step. | — | DPR doesn't enter the fit arithmetic. |

---

## Firefox 156 (Gecko)

### Refuted and not run

| Hypothesis | Verdict | Measured | Spec sections | Correction |
|---|---|---|---|---|
| gecko-lines H12 | refuted | At 57.6px, with and without padding: `aaa` / `aaa b`, because `aaa aaa` (4032 au) can't fit 3456 au. At 67.2px (H12b): with padding `aaa` / `aaa b`, without `aaa aaa` / `b`. | gecko-lines §10 H12 | The padding claim holds; the control's width is wrong. Use 67.2px. |
| gecko-canvas H3 | refuted | OC reads back `13.375px Arial` as stated. EC reads back `13.3281px Arial` (13.3 → 13.2969, 12.1 → 12.0938, 16.8 → 16.8125, `1.2em` → 19.1875). H3b: DOM computed `font-size` equals the same 10-bit values; 60 × `m` in Georgia measures 53340 au at 16.8, 16.81 and 16.8166667px and 53220 au at 16.79px. | gecko-canvas §1.2 C1b, C2; §5 H3; gecko-lines §2.3; CRITIC §7 | Servo computes every font size through `quantize_font_size`, which keeps 10 significant bits (`servo/components/style/values/specified/font.rs:993-1022`). DOM text lays out at `round(q10(s) × 60)` au, with `q10(x) = d − (d − x)`, `d = fround(x × 16385)`: `16.8px` → 16.8125px = 1009 au. C2's equality condition becomes `quantize7(s) === round(q10(s) × 60) / 60`. |
| CRITIC W3 | refuted | `aaaa \vbbbbb`, 16px Courier New at 57.6px: starts [0, 6]; the VT's rect is on line 1 at x 48, width 0, and nothing on line 2. Right-aligned, line 1 starts at x 9.6. | CRITIC §6 item 10; gecko-lines §5 row "CR, FF, VT" | VT is class BK, so the break comes after it. VT isn't trimmable (`nsTextFrame.cpp:904-919`), so the space before it stays in the line width. |
| cross 1 emoji | refuted | OC at size × DPR ÷ DPR equals the DOM for U+1F600 and the ZWJ family at 8–32px at apd 30, 60, 40 and 23. At apd 27, for both: 20px DOM 19.8 vs recipe 20.25; 24px DOM 23.85 vs 24.3. | gecko-canvas §1.9; §3 E6; §2 A12 | The DOM asks Core Text at `round(q10(s) × 60)/apd` device px (44.44 and 53.33px, advances 44 and 53). OC quantizes s × DPR to 7 bits (44.5 and 53.5px, advances 45 and 54). The recipe is exact when both sizes get the same whole-pixel advance, which holds for integer sizes at DPR 1 and 2. At fractional apd it can miss by one device pixel. |
| gecko-canvas H24 part a | not run | — | — | Replay the groundwork oracle offline over the `tests/wrapping` rows; it isn't a browser probe. Part b is confirmed. |

### Other corrections

- **U+2010 hyphen** (gecko-lines §9 not-obtainable item 6; gecko-canvas A8, N5). When the font lacks U+2010 or U+2011,
  Gecko's HarfBuzz nominal-glyph callback substitutes `-` (`gfxHarfBuzzShaper.cpp:119-124`), and font matching falls
  back to `-` in the primary font (`gfxTextRun.cpp:3227-3229`). Georgia has no U+2010, and OC `'‐'` = `'-'` = 5.9833px
  (359 au). So `au('‐')` equals the hyphen run's advance whenever the first font has U+2010 or `-`. gecko-canvas H25 is
  confirmed but can't discriminate in Georgia.
- **CRITIC C8.** The proposed discriminator can't discriminate: 26.9px = 807/30 is itself a multiple of 1/30. Measured
  instead: 10 × `b` 5380 au (device-pixel snapping would give 5400), 10 × `a` 4840 au (4800). DOM glyph advances aren't
  snapped at DPR 2; gecko-lines §2.5 holds.
- **CRITIC C9.** `<span>日本` newline `<span>語</span></span>` keeps the space (53.3333px); `<span>日本` newline
  `語</span>` removes it (48px). Newline removal looks only inside one text node. gecko-text is right; gecko-lines §3.3
  "inside the same run" should say the same mapped flow.
- **gecko-canvas H9 and H10.** `直直直` and `直` measure the same under ja, zh-CN, zh-TW and en. H9 was decided with `abc直`
  (44.7833px under ja, 41.8px under zh-CN). H10 was decided with widths and glyph boxes of three strings: the worker
  follows the macOS locale (zh-Hans), not `navigator.languages` (en-US) and not the page (ja).
- **Ligatures in Helvetica Neue.** HarfBuzz gives it no `fi` ligature, yet `ctx.letterSpacing = '0.001px'` changes
  `ffi fl` by −2 au at 16px and −7 au at 32px. Which feature turns off is unidentified.
- **Harness notes.** Read Firefox line starts per grapheme cluster: Firefox gives a combining mark the cluster's
  whole rect. `document.fonts.check` is true for a nonexistent family.

### Canvas-versus-DOM gaps confirmed, with recipes

| Fact | DOM | Canvas | Recipe, or the loss |
|---|---|---|---|
| Glyph advances | Integer au per glyph, the same at every apd tested. | OC width × 60 is an integer. | `Math.round(W × 60)`. DOM au = OC au for all 9,565 distinct words of the Gatsby corpus (48,151 tokens) at 16px Georgia. Exact. |
| Font size | `round(q10(s) × 60)` au. | `quantize7(s)`, 7 significant bits. | Exact when `quantize7(s) === round(q10(s) × 60) / 60`: integers, halves and quarters below 32px. Odd eighths fail (13.375px: DOM − OC 0.3334px), and so does 16.8px. |
| Apple Color Emoji | Core Text at the device size. | Core Text at the CSS size (10px 13, 12px 16, 16px 21). | OC at s × DPR, divided by DPR: exact at apd 30, 60, 40 and 23; one device pixel off at apd 27 (110% zoom at DPR 2). |
| `system-ui`, `-apple-system` (opsz axis) | opsz = CSS size: 14px pangram 289.15. | OC default opsz: 251.7167. EC 310.7. | OC equals the DOM only under `font-optical-sizing: none` (13, 14, 16, 20px). Otherwise a named loss. |
| CR, FF, VT | Zero width in normal and pre (`a\rb` 19.2px in 16px Courier New). | A space (28.8px). | Measure without them. |
| TAB | normal: a space (28.8px); pre: a tab stop (86.4px). | A space. | Space from Canvas; compute stops. |
| Stray C0 controls (U+0001) | Hidden, 0 wide. | OC draws a hexbox (30.0333 vs `ab` 17.0333); EC 0 wide. | Remove them before measuring. |
| Bidi controls (LRM) | Removed: `A&lrm;V` = `AV`. | OC splits the word: `A` LRM `V` = A + V (24 vs 22.6667). | Remove them before measuring. |
| Letter spacing and optional ligatures | Ligatures stay while the spacing rounds to 0 au (24px Hoefler Text `fi` at 0.001px = at 0: 13.65); off once it's non-zero. | Any non-zero float turns them off (0.001px: 14.0167). | OC with `letterSpacing = '0.001px'`, plus the DOM's au per cluster in JS: 32px Times New Roman `office` at 1px, DOM 80.0167 = OC at 0.001px + 6. |
| Letter spacing in cursive scripts | None after Arabic bases (Geeza Pro `بببب` at 2px: 24.5). | Added after every cluster (+8px). | OC at 0.001px with no added spacing (24.5). |
| Word spacing | After U+0020 and NBSP (+10), not U+3000. | After U+0020 and U+3000, not NBSP. | Add word spacing in JS. |
| Language | The element's lang. | OC: `ctx.lang`, else the root `lang` at the next measure; a worker OC: the OS locale. | Set `ctx.lang`. OC = DOM for ja, zh-Hans, ko and en (cross 4). |
| Hyphen width | U+2010 if the first font has it, else `-`. | OC `'‐'` substitutes `-` when the font lacks U+2010. | `au('‐')`. |
| Line-fit grid | `round(width × 60)` au against the text's au, at apd 30, 60, 40, 27 and 23. | — | Integer au arithmetic; not 1/64 device px (Georgia `ab ab`: first one-line width 37.9258, where 1/64 device px predicts 37.9297). |

---

## CRITIC items, settled

| Item | Chrome 153 | webkit-host | Firefox 156 | Outcome |
|---|---|---|---|---|
| C7 Blink zoom recipe | Arial: DOM = W(32px)/2. system-ui: clean DOM = Canvas at the CSS size. | — | — | Refuted for system-ui. blink-canvas §1.8 was right that size × DPR fails, and wrong that no Canvas size works. |
| C8 Gecko DOM X rounding | — | — | No snapping: 10 × `b` 5380 au, 10 × `a` 4840 au. | gecko-lines §2.5 holds; the 26.9px test can't discriminate. |
| C9 Gecko newline removal context | — | — | Across a text node the space stays; inside one node it's removed. | gecko-text is right. |
| C10 WebKit page zoom | — | Not run. CSS zoom proxy: zoom before truncation. | — | Open for page zoom. |
| C11 WebKit ICU default locale | — | `lang="und"`: 2 lines, like en. | — | Safari's own process not measured. |
| C12 Canvas controls | `a\fb` = `a\vb` = `a\rb` = `a b` 22.2421875 | same, 22.242188 | same, 22.25 | Confirmed in all three. |
| C13 Canvas ligatures under letter spacing | f + i + 2 (26.5999908) | ligature + 1 (24.360001) | f + i + 2 (25.1333) | Confirmed in all three. |
| C14 break before or after `text-transform` | 1 line: `full-width` isn't parsed | 2 lines [0, 1] | 1 line | Refuted for Chrome. |
| W1 Blink break-spaces and other Zs | `a` U+202F `b`: 1 line | — | — | Confirmed. |
| W3 Gecko VT | — | — | VT at the end of line 1, zero width; the space before it kept | Refuted. |
| W7 WebKit empty nodes | — | Empty div 0px; `\r` 0px; `\v` 20px | — | Confirmed; webkit-lines H13 is wrong. |
| W8 Blink fit bound at DPR 2 | (C128 − 1)/128 → 1 line; (C128 − 2)/128 → 2 | — | — | Confirmed. The "+1/64 CSS bound keeps 1 line" remark is wrong for `nnnnn nnnnn`. |
| §7 Chrome layout zoom 2 on Retina | Yes: thresholds on the 1/128 grid | — | — | Answered. |
| §7 Font-size precision | DOM floors the zoomed size to 1/100, Canvas the CSS size | No quantization | DOM: 10 bits, then 1/60 px. OC: 7 bits. | Gecko's DOM part corrected. |

## Cross-cutting checks side by side

| Check | Chrome 153 | webkit-host | Firefox 156 |
|---|---|---|---|
| 1. Apple Color Emoji, 8–32px | DOM = ceil64(W(size × 2))/128. Canvas at the CSS size is wider at 10–20px. | DOM = OC at the CSS size, bit-exact. | DOM = OC(size × DPR)/DPR at apd 30, 60, 40, 23; misses at apd 27. |
| 2. CR, FF, VT, TAB in the DOM (Canvas turns all of them into spaces in every engine) | normal: CR and TAB a space, FF and VT +5.328125px. pre: CR and FF zero width, VT +5.328125px, TAB a stop. | CR its glyph advance (0 in Arial). FF and VT `.notdef` (12px in 16px Arial). TAB a space in normal, a stop in pre. | CR, FF and VT zero width. TAB a space in normal, a stop in pre. |
| 3. Optional ligatures under letter spacing | DOM and Canvas both drop them, also under optimizeSpeed. | DOM drops them at any spacing and under optimizeSpeed; OC keeps them. | DOM keeps them while spacing rounds to 0 au; OC drops them at any non-zero value. |
| 4. Generic `sans-serif` under `<html lang>` ja, zh-Hans, ko, en | OC = DOM in all 12 cases. | OC ignores lang; under ko `永骨` OC 64 vs DOM 55.36. | OC = DOM in all four. |
| 5. `system-ui` and `-apple-system` | Clean DOM = Canvas at the CSS size; results depend on font cache order. `-apple-system` = `sans-serif`. | Same family. DOM = OC except one float32 step (20px). | Same family. OC = DOM only under `font-optical-sizing: none`. |
| 6. Line-fit grid at DPR 2 | 1/128 CSS px (1/64 device px); 1/224 at forced DPR 3.5; 1/64 CSS px under emulation. | 1/64 CSS px. | Integer au: `round(width × 60)` against the text's au, at every apd. |

## Spec notes added

- `blink-lines.md`: §2.5 (Canvas zoom recipe), §20 (after the table), §21 probes 2 and 15.
- `blink-text.md`: §2.B (`full-width`), §2.E (Arabic joining), §2.F.5 (break-all table: U+2010 and LB20a), §5 item 4
  (ZWJ workaround), §6 H3, H20, H29 and H32.
- `blink-canvas.md`: §1.8 system-ui, (e) not-obtainable item 4, (f) H6 and H16.
- `webkit-lines.md`: §2 difference 2, §3.1 (break-position cache), §9.1 break-spaces, §12 H6, H11, H13 and H22.
- `webkit-text.md`: §5.2 (break-position cache), §13 (8-bit storage), §14 H15.
- `webkit-canvas.md`: §1.4 Simple path (LF and CR), (e) after the table, (f) H14.
- `gecko-lines.md`: §2.3 (font size), §3.3 (newline removal context), §5 (after the table: VT), §9 not-obtainable
  item 6 (U+2010), §10 H12.
- `gecko-canvas.md`: §1.2 C1b and C2, §1.9 (emoji recipe), §2 A8 (hyphen), §5 H3.
- `CRITIC.md`: §6 items 1 (C7), 2 (C8), 8 (C14), 10 (W3) and 12 (W8), §7 font-size precision.

## Still open

- **Installed Safari 27.0.** Every WebKit number here is from webkit-host, and host Canvas numbers haven't been checked
  against Safari. Run later, once Safari isn't the frontmost app (check before taking the lock, or the runner waits
  while holding it):
  `python3 .artifacts/session/with-browser-lock.py probes-webkit-safari -- bun rebuild/probes/runner.ts --browser=safari --probes=rebuild/probes/webkit-probes-crosscheck.ts --out=.artifacts/probes/webkit-crosscheck-safari`.
- Page zoom through the browser UI in all three browsers, and a physical DPR 1 display. Chrome's forced device scale
  factors and Firefox's `layout.css.devPixelsPerPx` stand in.
- gecko-canvas H24 part a (offline oracle replay).
- webkit-lines H6 with `aa&shy;<span></span>bb`; H22 with a `breakWord` port; H3 with a font that kerns against the space.
- blink-lines H15: a bracket font without `halt` or `chws` for the control.
- Which JavaScriptCore string operations keep 16-bit storage.
- The Helvetica Neue feature that Firefox's OC letter spacing turns off.
- Explanations marked [I] are inferred, not read at the pinned source: HarfBuzz's AAT shaper and context (blink-text
  H3), ICU `ubidi` and the trailing ZWJ (blink-text H29).

## Installed Safari 27.0, 2026-09-16 16:44

Statements above that installed Safari wasn't run predate this run. After the maintainer approved Safari runs, every WebKit probe ran in installed Safari 27.0 (22625.1.29.11.27): all 89 webkit-probes observations and `ok` values equal webkit-host's, the cross-check verdicts are identical row by row, and the 7 differing cross-check follow-ups come from process history (storage width, keep-all history, TextBreakingPositionCache). Details: specs/probes-safari.md, section 'Installed Safari 27.0'; outputs under .artifacts/probes/webkit/installed-safari/.
