# Chrome 153 probe results for the Blink specs

Measured on 2026-09-16 in installed Chrome 153.0.8010.48 on macOS 27 (Retina display, `devicePixelRatio` 2, UI language
`navigator.language` = `zh-CN`). Every hypothesis in `blink-lines.md` §21, `blink-text.md` §6 and `blink-canvas.md` (f),
and the Blink items of `CRITIC.md` §6, was run as a probe. Six cross-cutting checks were added.

## How the probes ran

- Probes: `rebuild/probes/blink-probes.ts`. Each probe is one script observation. It measures in the page and returns raw
  values plus checks: the spec's expected outcome next to what was measured. Threshold widths are computed in the page
  from Canvas or DOM measurements.
- Driver: `rebuild/probes/runner.ts`, one background Chrome per run under the browser lock. The window is opened inactive
  over the DevTools protocol, and every run reported `hasFocus: false`.
- Summary: `bun rebuild/probes/blink-verdicts.ts` over `.artifacts/probes/blink/`.

| Run | Chrome switches | Probes | Output under `.artifacts/probes/blink/` |
|---|---|---|---|
| native DPR 2 | none | all 95 | `dpr2/chrome-probes.json` |
| forced DPR 1 | `--force-device-scale-factor=1` | all 95 | `dpr1/` |
| forced DPR 3.5 | `--force-device-scale-factor=3.5` | zoom subset (7) | `dsf3.5/` |
| emulated DPR 2 | `--force-device-scale-factor=1`, then `Emulation.setDeviceMetricsOverride { deviceScaleFactor: 2 }` | zoom subset (7) | `emulated/` |
| system-ui, Canvas first | none, and forced DPR 1 | 4 system-ui probes in a fresh browser | `sysui-dpr2/`, `sysui-dpr1/` |
| system-ui, DOM first | none | 1 probe in a fresh browser | `sysui-domfirst-dpr2/` |
| blink-text H29 extra | none | 1 probe | `supp-dpr2/` |

Every run finished with status ok, no probe errors and no observation errors. The DPR stayed the same within each run.

Environment (cross X6): `devicePixelRatio` 2, `visualViewport.scale` 1, `(resolution: 2dppx)` matches, screen 2560 × 1440
CSS px, window 1200 × 900.

Conventions:
- "DPR 1" results come from `--force-device-scale-factor=1` on the Retina display: layout zoom 1 and DPR 1 are reported,
  but the display is not a physical DPR 1 monitor.
- A layout unit (LU) is 1/64 of a zoomed px, so 1/128 CSS px at DPR 2. Widths are CSS px unless marked LU.
- Where a spec formula names 1/64 px or a 16px Canvas width, the probe used Canvas at font size × DPR and 1/(64 × DPR),
  which is the literal formula in the forced DPR 1 run.
- Verdicts: **confirmed** means every stated expectation matched. **refuted** means at least one didn't.

## Results

### blink-lines §21

| Id | Verdict | Measured | Expected |
|---|---|---|---|
| blink-lines H1 | confirmed | DPR 1, `nnnnn nnnnn` 16px Arial: W = 93.4296875, C64 = 5980. Width 93.421875 → 1 line, 93.40625 → 2 lines, 93.4296875 → 1 line. Scanned 1-line threshold 93.421875. | (C64 − 1)/64 → 1 line; (C64 − 2)/64 → 2; (C64 − 1)/64 + 1/128 → 1 |
| blink-lines H2 | refuted | DPR 2: C128 = 11959; 93.421875 → 1 line, 93.4140625 → 2 lines; every width in the scan follows the DPR 2 formula at DPR 2 and the DPR 1 formula at DPR 1. For this string 64 × W16 = 5979.5, so C128 = 2 × C64 − 1 and both formulas give the same threshold: the two runs agree at every width. Strings with C128 = 2 × C64 do differ, at exactly one width each, as predicted: `Hello world` 10128/128, `abc def ghi` 10018/128, `The quick brown` 15024/128 give 1 line at DPR 1 and 2 lines at DPR 2. | (C128 − 1)/128 → 1 line; (C128 − 2)/128 → 2; at least one width in [C64/64 − 1/32, C64/64] where DPR 1 and DPR 2 differ |
| blink-lines H3 | confirmed | Emulated run: `devicePixelRatio` 2 and `(resolution: 2dppx)` true, but line counts follow layout zoom 1. `Hello world` at 10128/128 px gives 1 line (native DPR 2: 2). 1-line thresholds of 4 strings sit on the 1/64 CSS grid, e.g. 17px Georgia 153.515625 (native DPR 2: 153.5234375). | DPR 2 reported, thresholds equal probe 1's (layout zoom 1) |
| blink-lines H4 | confirmed | DPR 1: DOM width of 20 × `m`: 17.29px = 17.3px = 288.0625, 17.31px = 288.390625. Canvas 17.3px = 17.29px = 288.0538940. At DPR 2 the DOM at 17.3px (288.140625) differs from 17.29px (288.0546875), because the floor applies to the zoomed size (34.59 vs 34.58), as §2.3 predicts. | DOM 17.3 = 17.29 ≠ 17.31; Canvas 17.3 = 17.29 |
| blink-lines H5 | confirmed | 1, 2, 2 and 1 lines | 1, 2, 2, 1 |
| blink-lines H6 | confirmed | Smallest width that keeps `AAAA AAAA` on line 1, DPR 2: Arial left 87.1640625, right 88.046875, underline 88.046875. Canvas (A, space) kerning −0.8828125 = left − right. Courier New 86.40625 in all three. | left < right by the (A, space) kerning; Courier New all equal |
| blink-lines H7 | confirmed | DPR 2, LU: A = 7173, H = 682 (Arial has U+2010). A + H − 1 → `cc aaaa‐` / `bbbb`. A + H − 2 → `cc` / `aaaa‐` / `bbbb`. Scanned threshold A + H − 1. Same at DPR 1. | A + H − 1/64 → 2 lines; A + H − 2/64 → 3 lines |
| blink-lines H8 | confirmed | letter-spacing 3px: A = 9861 (with spacing), H = 682 (without). Same line starts at A + H − 1 and A + H − 2; threshold A + H − 1. | thresholds from spaced text and unspaced hyphen predict exactly |
| blink-lines H9 | confirmed | C = 13137 LU. C − 1 → 1 line, C − 2 → 2 lines, C − 3px − 1 → 2 lines; scanned threshold C − 1. | (C64 − 1)/64 → 1 line; (C64 − 2)/64 → 2 |
| blink-lines H10 | confirmed | S = 9.6015625. `aaaaaaaa\tb`: b at 153.625 = 16S. `aaaaaaa\tb`: b at 76.8125 = 8S. letter-spacing 2px: b at 185.625 = 16 × (S + 2). | b at ceil64(8S)/64 + d (16S on the grid); 8S; stop 8 × (S + 2) |
| blink-lines H11 | confirmed | width 36.59375. pre-wrap: 2 lines, line 1 extends to 62.265625. break-spaces: 3 lines `nnnn ` / 5 spaces / `nnnn`. | pre-wrap 2 lines, hanging; break-spaces 3 lines |
| blink-lines H12 | confirmed | pre-wrap span `A\fV` 23.109375 = ceil64(A) + ceil64(V) (kerned `AV` 21.046875); `A\rV` the same. Canvas `A\fV` = `A V` = 27.109375. | span = ceil64(A)/64 + ceil64(V)/64; Canvas = `A V` |
| blink-lines H13 | confirmed | lines `aaaaaaaaaaaaaaaab` / `bbbbbb` / `b` | line 1 = prefix + one b, then grapheme fill |
| blink-lines H14 | confirmed | 1 line, width 71.1875 = ceil64(W(`aaaa­`)) + ceil64(W(`bbbb`)); max-content width with and without the soft hyphen both 71.1875 | 1 line, no hyphen, sum of item widths |
| blink-lines H15 | refuted | Hiragino Sans: F = 64. F − 4 → line 1 `あああ」`; F − 9 → `ああ`. Smallest width keeping `あああ」` = 55.9921875, so the bracket is trimmed by 8px. Courier New (Japanese from the fallback font) gives exactly the same: F − 4 → `あああ」`. | Hiragino: F − 4 → `あああ」`, F − 9 → not; Courier New with fallback keeps 」 off line 1 at F − 4 |
| blink-lines H16 | confirmed | Times New Roman `nnn nnnn nnnn nnnn`, widths ±3 LU around line 2's threshold. 16px has no fractional 1/64 parts, so no disagreement there; more sizes were scanned. The position and width models disagree at 16.1px (8757 LU), 16.3px (8863), 13.37px (7272) and 15.55px (8458) at DPR 2, and at 16.1px (4378) and 17.7px (4813) at DPR 1. At each of those widths Chrome gives lines starting at 0, 9, 14: line 2 ends one opportunity earlier. All 47 (DPR 2) and 45 (DPR 1) scanned widths follow ceil64(P(b) − P(start)). | where positions fit but the width is 1 LU too wide, line 2 ends one opportunity earlier |

### blink-text §6

| Id | Verdict | Measured | Expected |
|---|---|---|---|
| blink-text H1 | confirmed | 1, 2 and 1 lines | 1, 2, 1 |
| blink-text H2 | confirmed | 48px Helvetica Neue: A + red V = `<span>AV</span>` = 58.2265625. A + V with 0.01px spacing: 31.109375 + 29.34375 = 60.453125. padding-left 0.001px: 60.4375 = width(A) + width(V), no kern. | one group kerns; spacing or padding splits the group |
| blink-text H3 | refuted | Geeza Pro: `ب<b>ب</b>` 55.90625 = isolated 25.59375 + bold isolated 30.3125, not initial + bold final 55.6875. With the OpenType font Noto Naskh Arabic: 43.6875 = initial 11 + bold final 32.6875, not the isolated sum 61.765625. | width = initial + bold final ≠ isolated sum |
| blink-text H4 | confirmed | normal `a\rb`: 2 lines, span 22.53125 = `a b`. pre-line: 2 lines. pre-wrap: 1 line, 18.0859375 = `ab`. | 2, 2, 1 lines; widths `a b` and `ab` |
| blink-text H5 | confirmed | normal `a\fb`: 1 line, 23.4140625 (`a b` 22.53125, `ab` 18.0859375: the FF adds 5.328125px). pre-wrap: 1 line, 18.0859375. | 1 line, width ≠ `a b` and ≥ `ab`; pre-wrap = `ab` |
| blink-text H6 | confirmed | `a\vb` 1 line in normal and pre-wrap; pre-wrap 23.4140625 ≠ 18.0859375 | 1 line; pre-wrap width ≠ `ab` |
| blink-text H7 | confirmed | `append("a\f", "\n", <span>b</span>)` → 1 line; control → 2 lines | 1; 2 |
| blink-text H8 | confirmed | `append("a\v", "\n", span)` → 1 line; `append(<span>a\f</span>, "\n", span)` → 2 lines | 1; 2 |
| blink-text H9 | confirmed | `a&#x200B;\nb` 18.0859375 = `a​b` = `ab`; `a\nb` 22.53125 = `a b` | same |
| blink-text H10 | confirmed | 2 lines `a` / `)` | 2 |
| blink-text H11 | confirmed | `x!é` 2 lines, `x!a` 1, `x/é` 2, `x/a` 1 | 2, 1, 2, 1 |
| blink-text H12 | confirmed | `a` NEL `b`: 2 lines in #t, 1 line at 1000px | 2; 1 |
| blink-text H13 | confirmed | `a` U+2028 `b`: 1 line at 1000px, 2 in #t; span 22.53125 = `a b` | 1; 2; width `a b` |
| blink-text H14 | confirmed | `a”b`: en 1, zh 2, zh-TW 2, zh-HK 2, ja 1, ja + line-break:normal 2, cmn 1 | same |
| blink-text H15 | confirmed | no lang anywhere, UI language zh-CN: 2 lines | 2 with a Chinese UI |
| blink-text H16 | confirmed | `あぁ` line-break:strict: `<html lang=en>` 1 line; no lang anywhere 2 lines | 1; 2 |
| blink-text H17 | confirmed | lang=ko strict 2 lines; lang=ja strict 1 | 2; 1 |
| blink-text H18 | confirmed | `あ々` loose 2, auto 1; `一‥‥` loose 2 (`一‥` / `‥`), auto 1 | same |
| blink-text H19 | confirmed | keep-all: `一一` 1, U+20000 × 2 → 2, `한국어` 1, `ภาษาไทย` 2 (`ภาษา` / `ไทย`) | 1, 2, 1, 2 |
| blink-text H20 | refuted | `a‐b` break-all + loose: 2 lines, `a` / `‐b`. break-all alone: `a‐` / `b`. `‐b` with break-all, with or without loose: 1 line. `Intl.v8BreakIterator('en')` on `‐b` → [0, 2]. | 3 lines; 2 lines |
| blink-text H21 | confirmed | `$%` break-all 2 lines; normal 1 | 2; 1 |
| blink-text H22 | confirmed | nowrap `foo<wbr>bar`: 2 lines | 2 |
| blink-text H23 | confirmed | 2 lines; line 2 `bar` at left 0 | 2, bar at 0 |
| blink-text H24 | confirmed | `abc<img>def` 3 lines, `abc&nbsp;<img>` 2 lines, for an img without src, an img with a GIF and an inline-block | 3; 2 |
| blink-text H25 | confirmed | `super&shy;cali` 2 lines; hyphens:none 1 | 2; 1 |
| blink-text H26 | confirmed | `👩‍💻👩‍💻` 2 lines with normal, break-all and keep-all; `x🇯🇵🇺🇸` 3 | 2, 2, 2; 3 |
| blink-text H27 | confirmed | 48px Times: DOM `fi` with letter-spacing 0.001px 29.328125 vs f + i + 0.002 = 29.3223125 (ligature 26.6953125). Canvas with letterSpacing 0.001px 29.3222961. | both = f + i + 0.002 (±1/64), not the ligature |
| blink-text H28 | confirmed | Helvetica Neue and Arial: `a\fb` = `a\vb` = `a\rb` = `a b`; `a­b` = `ab` | same |
| blink-text H29 | refuted | Geeza Pro: W(`ب‍`) 25.5876923 vs DOM first ب 25.59375, but Geeza Pro's initial and isolated ب have the same advance, so equality shows nothing. Noto Naskh Arabic: DOM first ب = 11 (initial form), Canvas W(`ب‍`) = 30.8799896 = W(`ب`) (isolated). With `ctx.direction = 'rtl'`: 11. `ب‍ب` = `بب` = 43.6799927. | W(`ب‍`) = DOM width of the first ب in `<span>ب</span><b>ب</b>` |
| blink-text H30 | confirmed | pre-wrap block: a at 14.453125 = space 4.453125 + 10. normal block with a pre-wrap span: 4.453125. | width(" ") + 10; width(" ") |
| blink-text H31 | confirmed | uppercase `ß` 20.7421875 = `SS`; `ßß` 1 line | same |
| blink-text H32 | refuted | `CSS.supports('text-transform', 'full-width')` false, computed `none`. Span 22.53125 (plain `a b`), not 48. 2 lines in #t only because `a b` breaks at the space. | width of `ａ　ｂ`; 2 lines, break after U+3000 |
| blink-text H33 | confirmed | break-spaces `a  b` 3 lines `a ` / ` ` / `b`; `a　b` 2 lines | same |
| blink-text H34 | confirmed | width 30.390625 → `การ` / `ทดสอบ`. ICU (v8BreakIterator en): whole text [0, 3, 8]; `ทดสอบ` alone [0, 5]. | line 2 `ทดสอบ`, no internal break |
| blink-text H35 | confirmed | pre-wrap `a \rb`: 2 lines `a ` / `b`; `\rb` span 9.4921875 = `b` | 2 lines; CR zero width |
| blink-text H36 | confirmed | `foo ` / `bar` | 2 lines, `foo ` on line 1 |
| blink-text H37 | confirmed | en div with zh span: `a”` / `b`; zh div with en span: 1 line | 2 lines; 1 line |

### blink-canvas (f)

| Id | Verdict | Measured | Expected |
|---|---|---|---|
| blink-canvas H1 | confirmed | W(`Hello brave new world`) 157.40625 = float32 chain of the word widths; × 65536 = 10315776 | chain equality, integer 16.16 |
| blink-canvas H2 | confirmed | `a\rb`, `a\fb`, `a\vb`, `a\tb`, `a\nb` all 22.2421875 = `a b` | all = `a b` |
| blink-canvas H3 | confirmed | `ab­cd` and `ab`U+202A`cd` 34.6953125 = fround(W(ab) + W(cd)); W(ZWSP) 0 | same |
| blink-canvas H4 | confirmed | Shantell Sans: 44.9199677 − 3 = 41.9199677 = optimizeSpeed. Hoefler Text: 40.9999847 − 3 = 37.9999847 = optimizeSpeed (ligature width 34.5999908). | bit-for-bit equal |
| blink-canvas H5 | confirmed | 40px Arial `AV`: auto = optimizeSpeed = optimizeSpeed + fontKerning normal = 50.390625; fontKerning none 53.359375 | same |
| blink-canvas H6 | confirmed | Default = split sum: Arial 111.89453125, Times New Roman 115.234375. optimizeLegibility gives the DOM whole-run width for both fonts: Arial 109.6875, Times New Roman 112.3046875 (DOM span at DPR 2 equal). | split sum by default; optimizeLegibility split or whole-run (Times New Roman guessed split) |
| blink-canvas H7 | confirmed | A1 12.4453125 = W0(` x`); A2 20.4453125 = W0(`x y`); B1 30.4453125 = +10; B2 22.4453125 = +10 | same |
| blink-canvas H8 | confirmed | 16px Amiri: fresh W(`)`) 4.0799866; after W(`\t)`), W(`)`) 7.3279877; W(`\t)`) 11.9999847 = fround(W(` `) 4.6719971 + 7.3279877) | 4.080; 7.328; fround sum |
| blink-canvas H9 | confirmed | connected canvas: W(`)`) 7.3279877 after W(`(ب⁠ب)`) and 3 frames | 7.328 |
| blink-canvas H10 | confirmed | W(`Hello world`) 16px Helvetica Neue = 80.55989074707031 at DPR 2, forced DPR 1, forced DPR 3.5 and emulated DPR 2. Browser page zoom 110% and 175% were not set; forced device scale factors stand in for layout zoom. | identical W |
| blink-canvas H11 | confirmed | 13.337px = 13.33px = 65.9339142; 13.34px 65.9834290; `ctx.font` reads `13.337px Arial` | same |
| blink-canvas H12 | confirmed | `<canvas style="letter-spacing:5px">`, letterSpacing never set: +15 at DPR 1 (79.4921875 vs 64.4921875), +30 at DPR 2. After `'0px'`: unchanged. After `'0em'`: +0. Element `font-feature-settings:'liga' 0`: W(`ffi`) 37.9999847 vs OffscreenCanvas 34.5999908. | +15 at DPR 1, possibly +30 at DPR 2; unchanged; +0; differs |
| blink-canvas H13 | confirmed | W 161.3119507 unchanged after `<html lang=ja>` with the same font string. `32px  serif` (two spaces) → 187.0079346 = a fresh context under ja. `ctx.lang = 'ja'` → 187.0079346. | unchanged; Japanese width; changes |
| blink-canvas H14 | confirmed | connected canvas: 161.3119507 → 187.0079346 right after `<html lang=ja>` | changes right away |
| blink-canvas H15 | confirmed | `<canvas lang=ja>` transferred to a worker: 187.0079346 = the ja result. The worker's own OffscreenCanvas: 161.3119507 = the zh-CN result, which for this string also equals the en and zh-Hans results, so the UI language isn't told apart from en. | ja result; UI-language result |
| blink-canvas H16 | refuted | DPR 1: DOM 13px 67.875 = W(13px) within 1/64. DPR 2 in a clean process: DOM(S) = ceil64(2 × W(S))/128 at every size 10–28px (sizes 10–14, 16, 20 from the DOM-first run; 15, 17–19, 21–28 from the Canvas-first run), e.g. 13px: DOM 67.875, W(13px) 67.8691406, W(26px)/2 62.5902023. The DOM differs from both only at sizes where Canvas had measured size × 2 first: 13px 60.5703125. | at DPR 2 some size where DOM ≠ W(13px) and ≠ W(26px)/2; at DPR 1 DOM = W(13px) |
| blink-canvas H17 | confirmed | 12px Helvetica Neue 😀: DPR 2 DOM 12 = W(24px)/2, W(12px) = 15; DPR 1 DOM 15 = W(12px) | same |
| blink-canvas H18 | confirmed | W(`ab`) with letterSpacing −20px = −22.203125 | < 0 |
| blink-canvas H19 | confirmed | `'3'` and `'10%'` after `'2px'`: 21.796875 = 17.796875 + 4; letterSpacing reads `2px` | still +4 |
| blink-canvas H20 | confirmed | `中〜文`: zh [0,1,2,3], en [0,2,3], ja-u-lb-normal [0,2,3] with locale ja; `ゝゞ々ぁァ` en [0,3,4,5]. LineBreakTest 17.0 (19,338 cases) with en: 0 differences from `rbbi.ts` over `data:line_normal.brk`. | same, 0 differences |
| blink-canvas H21 | confirmed | `中〜文` 16px PingFang SC: zh 3, en 2, ja 2, ja normal 3, ja strict 2, ko loose 3, en loose 2, zh-TW 3 | same |
| blink-canvas H22 | confirmed | lang=ko strict: 3 lines (UI zh-CN) | 3 with a Chinese UI |
| blink-canvas H23 | confirmed | no lang, no Content-Language: 3 lines (host font and PingFang SC) | 3 with a Chinese UI |
| blink-canvas H24 | confirmed | 32px Arial small-caps: W(`HELLO`) 104.9375 = normal; W(`hello`) 72.1445313 < 104.9375 and ≠ normal 67.609375 | same |
| blink-canvas H25 | confirmed | direction rtl: W(`abc def`) 52.484375 = LTR | same |

### CRITIC §6 (Blink items)

| Id | Verdict | Measured | Expected |
|---|---|---|---|
| CRITIC C7 | refuted | 16px Arial: DOM `Hello world` 79.140625 = W(32px)/2. 13px system-ui in a clean process (DOM first): 67.875 = ceil64(2 × W(13px))/128, W(13px) = 67.8691406. The DOM differs from W(13px) and from W(26px)/2 (62.5902023) only after a Canvas measured 26px system-ui first: 60.5703125. | Arial = W(32px)/2 within 1/128; 13px system-ui differs from W(13px) and W(26px)/2 |
| CRITIC C12 | confirmed | fresh OffscreenCanvas 16px Arial: `a\fb` = `a\vb` = `a\rb` = `a b` = 22.2421875 | equal |
| CRITIC C13 | confirmed | 40px Hoefler Text, letterSpacing 1px: W(`fi`) 26.5999908 = W(f) 13.3999939 + W(i) 11.1999969 + 2 (ligature + 1 would be 24.3599854) | Chrome: f + i + 2 |
| CRITIC C14 | refuted | `<div style="width:1px;text-transform:full-width;font:16px 'Hiragino Sans'">ab</div>`: 1 line. `full-width` isn't parsed (CSS.supports false, computed `none`). | Chrome 2 lines |
| CRITIC W1 | confirmed | break-spaces, width 1px, `a`U+202F`b`: 1 line | 1 line |
| CRITIC W8 | confirmed | 16px Arial `nnnnn nnnnn`, DPR 2: (C128 − 1)/128 → 1 line, (C128 − 2)/128 → 2 lines. For this string a +1/64 CSS px bound also gives 2 lines at (C128 − 2)/128 (C128 = 2 × C64 − 1), so the difference shows with other strings: `Hello world` at 10128/128 px gives 2 lines at DPR 2 where the CSS-grid formula gives 1. | 1 line; 2 lines; a 1/64 CSS bound would keep 1 line |

### Cross-cutting

| Id | Verdict | Measured | Expected |
|---|---|---|---|
| cross X1 emoji at font size × DPR | confirmed | Apple Color Emoji, U+1F600 and the family ZWJ sequence, 8–32px. DPR 2: DOM = ceil64(W(size × 2))/128 at every size (16/16). Canvas at the CSS size is wider at small sizes: 10px 13 vs DOM 11, 12px 15 vs 12, 14px 18 vs 14, 16px 20 vs 16, 20px 22 vs 20; equal at 8, 24 and 32px. DPR 1: DOM = W(size) at every size. | Canvas at size × DPR ÷ DPR matches the DOM span |
| cross X2 control characters | confirmed | 16px Arial and Helvetica Neue, DPR 2. normal: CR and TAB = `a b` (22.2421875, 22.53125); FF and VT = `ab` + 5.328125 (23.125, 23.4140625). pre: CR and FF = ceil64(a) + ceil64(b) (17.796875, 18.0859375); VT 23.125, 23.4140625; TAB a tab stop (44.4609375, 45.078125). Canvas gives `a b` for all four. Same pattern at DPR 1. | specs: CR a space and FF/VT literal in normal; CR/FF zero width in pre; Canvas turns all into spaces |
| cross X3 ligatures | confirmed | Hoefler Text `ffi fl` 16px: DOM ls 0 → 27.203125 (ligatures); ls 0.001px → 28.7109375 and optimizeSpeed → 28.7109375 (no ligatures). Canvas: letterSpacing ≠ 0 or optimizeSpeed drop the ligatures (28.7098999, 28.7039490); optimizeLegibility and geometricPrecision keep them (27.1999817). Canvas at size × DPR rounds to the DOM widths (40px, 0.001px: DOM 71.7734375 = ceil64(2 × 71.7659683)/128). Helvetica Neue has no ligature, but auto (25.5234375) ≠ optimizeSpeed (25.4765625) in both DOM and Canvas. | letter spacing and optimizeSpeed turn optional ligatures off in both DOM and Canvas |
| cross X4 generic sans-serif by lang | confirmed | DOM = ceil64(OffscreenCanvas W at 32px)/128 for `永骨`, `Hello永骨` and `Hello` under `<html lang>` ja, zh-Hans, ko and en (12/12). The families differ by lang: `Hello` 39.28125 (ja), 37.296875 (zh-Hans and en), 34.5 (ko); `永骨` 27.6875 under ko, 32 otherwise. | OffscreenCanvas and DOM agree under each lang |
| cross X5 system-ui and -apple-system | refuted | system-ui in a clean process: DOM(S) = ceil64(W(S) × DPR)/(64 × DPR), Canvas at the CSS size, not at size × DPR (13px: DOM 67.875, W(26px)/2 62.5902023). `-apple-system` resolves like `sans-serif` (13px 67.4829254, equal to `sans-serif`), not like system-ui, scales linearly, and its DOM = ceil64(W(2S))/128. `BlinkMacSystemFont` = system-ui. | DOM = Canvas at size × DPR ÷ DPR for both |
| cross X5 system-ui cache order | confirmed | Fresh browser, Canvas first: Canvas W(20px) 97.8266907, then DOM 10px 52.6796875. Fresh browser, DOM first: DOM 10px 54.140625, then Canvas W(20px) 100.7617188. The same holds for DOM 11–14, 16 and 20px against Canvas 22–40px. At 20 device px the two effects add up: specified size 10 → 20 changes the advance sum by 7.52px (opsz 10) and 7.53px (opsz 20); opsz 10 → 20 by 2.92px (ptem 10) and 2.93px (ptem 20). | Canvas and DOM system-ui widths at the same effective size depend on which created the platform font first |
| cross X6 env and line-breaking grid | confirmed | DPR 2, `visualViewport.scale` 1, `(resolution: 2dppx)`. DOM text widths are whole multiples of 1/128 px, and 1-line thresholds = DOM width − 1/128 for 4 strings, e.g. 17px Georgia 153.5234375 where a 1/64 CSS grid predicts 153.515625. Forced DPR 3.5: thresholds within 1/512 px of the 1/224 grid prediction. Forced DPR 1: 1/64 grid. Emulated DPR 2: 1/64 CSS grid. | line breaking at DPR 2 follows 1/64 of a device px |

Counts: 84 spec and CRITIC rows (16 + 37 + 25 + 6) and 7 cross-cutting rows. Refuted: blink-lines H2, H15; blink-text H3, H20, H29, H32;
blink-canvas H16; CRITIC C7, C14; cross X5 system-ui and -apple-system. Nothing inconclusive or not run.

## Spec corrections

1. **blink-lines H2 (§21 probe 2; also CRITIC W8's "+1/64 CSS bound" remark).** The two DPRs give different thresholds
   only for some strings. At DPR 1 a line fits when trunc64(w) + 1 ≥ C64; at DPR 2 when trunc128(w) + 1 ≥ C128 (§1.5,
   §2.4). With linear advances (W32 = 2 × W16), C128 is 2 × C64 − 1 when the fractional part of 64 × W16 is in (0, 1/2],
   and then both thresholds are (C64 − 1)/64. `nnnnn nnnnn` has 64 × W16 = 5979.5 exactly. The DPRs differ, at the single
   width (2 × C64 − 2)/128, only when C128 = 2 × C64. Use such a string, e.g. 16px Arial `Hello world` (C64 5065, C128
   10130), for the DPR comparison and for W8.

2. **blink-lines H15 (§21 probe 15; §6 step 4).** The Courier New control is wrong. Courier New has no Japanese glyphs,
   so 」 is shaped with the CJK fallback font, which has `halt`. `TextSpacingTrimFallback` and
   `TextSpacingTrimFallbackChws` are stable (§18), so HanKerning trims the line-end bracket as it does with Hiragino Sans:
   the same 55.9921875 threshold. Line-end trimming follows the font that renders the bracket, including a fallback.
   A control needs a bracket from a font without `halt`/`chws`; no such font was identified here.

3. **blink-text H3 (§2.E "Arabic joining does cross them").** This holds for OpenType Arabic fonts and fails for Geeza
   Pro. All seven faces in `/System/Library/Fonts/GeezaPro.ttc` on macOS 27 carry `morx` (AAT) and `kern` but no `GSUB`
   or `GPOS` (read from the font file). [I] HarfBuzz then shapes Geeza Pro with the AAT `morx` state machine, which sees
   only the glyphs of the current shaping call, not the pre-/post-context the buffer keeps. The OpenType Arabic shaper that
   reads that context (`hb-ot-shaper-arabic.cc:305-360`) doesn't run. HarfBuzz isn't in the sparse checkout, so this is
   inferred. Measured: Noto Naskh Arabic joins across the `<b>` boundary (43.6875 = initial 11 + bold final 32.6875), and
   Geeza Pro joins only inside one shaping group (`ب<span style="color:red">ب</span>` 37.4921875 vs two isolated forms
   51.1875). Correction: cross-item joining needs an OpenType font; AAT fonts join only within an item.

4. **blink-text H20 (§2.F.5 break-all; the H20 expectation).** U+2010 HYPHEN is line-break class HH (Unambiguous Hyphen,
   new in Unicode 17 and ICU 78), not BA. In Chrome's `line_normal.brk` U+2010 is in RBBI category 25 with U+2013 EN DASH,
   which LineBreakTest 17.0 labels HH. The BA characters U+00AD and U+007C are in category 4. The consequences at 153:
   - The loose rule tests the character, not the class, so it still breaks before U+2010: `a` / `‐b`
     (`text_break_iterator.cc:315-327`).
   - The break-all table's HH row is empty (`text_break_iterator.cc` `kBreakAllLineBreakClassTable`, "HH" row, all
     zero), so break-all adds no opportunity after ‐.
   - The break after ‐ can only come from ICU. ICU is opened on the text from the line start with no prior context (§2.F.1),
     and `line_normal.txt:301` `^($HY | $HH) $CM* ($ALPlus | $HL);` (LB20a, word-initial hyphen) forbids a break after a
     hyphen at the start of that text. So line 2 `‐b` doesn't break, and `‐b` alone is 1 line. U+2013 behaves the same
     (`a` / `–b`).
   - `a‐b` with break-all alone breaks after ‐ through ICU, not the table.
   Correction: look up Unicode 17 classes (HH included) for the break-all table. Because ICU restarts at every line start,
   LB20a applies to every line that starts with a hyphen.

5. **blink-text H29 (§5 item 4, the ZWJ workaround).** Canvas doesn't give the joining form for `ب‍` in an LTR context.
   With Noto Naskh Arabic, W(`ب‍`) = W(`ب`) = 30.8799896 (isolated) while the DOM's first ب is 11 (initial).
   `ctx.direction = 'rtl'` gives 11, and `ب‍ب` gives the joined pair (43.6799927). `PlainTextNode` runs ICU bidi with the
   context direction as paragraph level and shapes each visual run alone (`plain_text_node.cc:285-318`); normalization
   leaves ZWJ alone (`character.h:167-175`). [I] With paragraph level LTR, the trailing ZWJ (bidi class BN) is reset to the
   paragraph level as trailing white space is under UAX #9 L1, so it forms its own LTR run and ب is shaped without
   context. The ICU `ubidi` code wasn't read. Geeza Pro passes the literal check only because its initial and isolated ب
   have the same advance. Correction: measure a joining form with `direction = 'rtl'`, or with the ZWJ between two Arabic
   letters.

6. **blink-text H32 and CRITIC C14 (§2.B text-transform).** `text-transform: full-width` doesn't exist in stable Chrome
   153. The keyword is gated by the runtime flag `CSSTextTransformFullWidth`, status "experimental"
   (`runtime_enabled_features.json5:2066-2070`; the gate is noted at `css_properties.json5:6549-6553`). So the
   declaration is invalid, the computed value is `none`, and `computed_style.cc:2000-2003` never runs. `full-size-kana` is
   gated the same way (`CSSTextTransformFullSizeKana`, experimental). Correction: remove `full-width` and `full-size-kana`
   from Chrome's supported transforms. CRITIC C14's Chrome row is 1 line.

7. **blink-canvas H16, CRITIC C7 and cross X5 (§1.8 system-ui; blink-lines §2.5 and §20 recipe).** Two corrections.
   - **Recipe.** The DOM gives opsz and HarfBuzz ptem the specified size (`font_platform_data_mac.mm:170-178`;
     `harfbuzz_face.cc:648`), and the Skia copy turns tracking off (§1.4). So system-ui advances at the zoomed size are the
     CSS-size advances scaled. In a clean process DOM(S) = ceil64(W_canvas(S) × DPR)/(64 × DPR) at every size 10–28px.
     Canvas at the CSS size reproduces the DOM for system-ui; Canvas at size × DPR doesn't. The spec's "no Canvas size
     reproduces the DOM's (CoreText size, opsz) pair [I]" is wrong for this range.
   - **Order dependence through the platform font cache.** `FontCacheKey` holds `EffectiveFontSize()` and option bits
     but not the specified size (`font_description.cc:308-331`; `font_cache_key.h:53-68`). opsz is fixed from the specified
     size when the platform font is created (`font_platform_data_mac.mm:170-178`). So a Canvas at S px and DOM text at
     S/DPR CSS px share one platform font, whose opsz is the specified size of whichever text created it first. ptem, and
     with it `trak`, still follows each text's own specified size. The measured effects add up (cross X5 cache order), so
     this accounts for the whole difference. Mismatched widths like blink-canvas H16's and C7's appear only in the
     contaminated state. This is a Canvas-only runtime's named loss for opsz fonts: the library can't see what the page
     laid out first. Measuring system-ui at the CSS size keeps the Canvas away from the effective sizes of page text at
     size/DPR, but page text at size × DPR can still come first.
   - `-apple-system` isn't an alias of system-ui in Chrome 153: it measures like the generic `sans-serif`.
     `BlinkMacSystemFont` is the system UI font.

Notes on confirmed rows that still change a spec detail:
- blink-canvas H6: Times New Roman under `optimizeLegibility` gives the DOM whole-run width (112.3046875), so on macOS 27
  its space glyph is covered by GPOS or GSUB and `CanShapeWordByWord` is false when kerning is requested. The spec guessed
  the split sum.
- blink-text H5 and H6: the DOM width of FF and VT is now known: 5.328125px at 16px in Arial and Helvetica Neue at
  DPR 2, the same for VT in pre-wrap. A Canvas-only runtime still can't supply it (Canvas turns both into spaces).
- blink-lines H4: at DPR 2 the float32 floor applies to the zoomed size, so 17.3px and 17.29px differ in the DOM, while
  Canvas (unzoomed) keeps them equal.
- blink-canvas H15: the worker half isn't separated from en by `Hello, world` in serif.
- Emoji (cross X1): Apple Color Emoji advances aren't linear in size. The DOM uses the advance at size × DPR; Canvas at
  the CSS size is up to 25% wider at 10–20px.

## Problems and caveats

- DPR 1 is `--force-device-scale-factor=1` on the Retina display, not a physical DPR 1 monitor. Browser page zoom (110%,
  175%) wasn't set; forced device scale factors 1 and 3.5 stand in for other layout zooms.
- System-ui widths depend on the process's font cache. In the main `dpr2` and `dpr1` runs the Canvas-first order probe
  runs first, so their DOM system-ui widths at 10–14, 16 and 20px (blink-canvas H16, C7, X5) are the contaminated ones.
  The clean DOM widths are in `sysui-domfirst-dpr2`.
- Two supplementary probes were added after the main runs: the DOM-first order probe and the ZWJ direction test in
  blink-text H29. Their data is in `sysui-domfirst-dpr2/` and `supp-dpr2/`.
- The automatic verdicts in `.artifacts/probes/blink/verdicts.txt` (from `blink-verdicts.ts`) differ from this table
  where the checks can't decide on their own:
  - blink-lines H3 and CRITIC W8: automatic refuted, because a check with `nnnnn nnnnn` can't separate the two formulas.
    The verdicts here use the supplementary strings.
  - blink-canvas H16 and CRITIC C7: automatic confirmed, from the contaminated DOM widths of the main run.
  - blink-text H29: automatic confirmed, from the Geeza Pro checks; refuted here from the Noto Naskh Arabic data.
  - cross X2 and X3: inconclusive, because they have no decisive checks; judged here from their values.
  - The two cache-order probes: automatic refuted, because their checks assumed the Canvas widths would change. The DOM
    widths change instead, so the ordering effect is confirmed.
- blink-lines H3's own discriminating check failed because `nnnnn nnnnn` gives identical formulas. The verdict rests on the
  supplementary H2 strings and cross X6 in the emulated run.
- blink-lines H16 at 16px Times New Roman has no fractional 1/64 parts, so no mismatch width exists there. Sizes 16.1,
  16.3, 17.7, 13.37 and 15.55px were added.
