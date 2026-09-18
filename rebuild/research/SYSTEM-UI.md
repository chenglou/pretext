# system-ui in the three browsers: a focused sweep (2026-09-18)

No. A canvas element removes Firefox's system-ui blocker, but it is not the last structural one across the three browsers. WebKit has a blocker of the same kind, Chrome has two small ones, and Firefox keeps a font-size limit that no canvas lifts.

**The restored path reproduces round 3.** The detached canvas element path is back in the Gecko port, selected for the whole engine (commit 872c0da). On round 3's 680 `rule/system-fonts-and-sizes` cases it gives the same statuses, line geometry and gaps as round 3's rows. With the path switched off, tier 1 replays all 63,771 Firefox cases of the frozen line unchanged in both configurations.

**The set and the runs.** The set has 3,471 new cases (seed `sysui-1`, none of 1,553,182 used ids), run in both orders. Facts and no-facts gave the same status on every case in every browser. No case was history-dependent.

| Cases, pass ÷ (pass + fail), % | line count | breaks | widths |
|---|---|---|---|
| Chrome | 99.48 | 99.11 | 94.49 |
| webkit-host | 99.39 | 97.90 | 89.91 |
| Firefox, canvas element | 99.94 | 99.77 | 92.95 |
| Firefox, OffscreenCanvas only | 88.27 | 75.54 | 50.96 |

| Lines, % (about 13,600 a browser; the line-count column is the share of lines in cases whose line count passes) | line count | breaks | widths |
|---|---|---|---|
| Chrome | 98.89 | 99.56 | 96.90 |
| webkit-host | 99.55 | 98.90 | 95.40 |
| Firefox, canvas element | 99.96 | 99.87 | 93.68 |
| Firefox, OffscreenCanvas only | 84.76 | 84.14 | 51.22 |

| Engine | Failing cases (wrong count / breaks) | Cause | Kind | Example ids |
|---|---|---|---|---|
| Firefox, element | 221 (2 / 6) | The font size is off Canvas's grid of 7 significant bits: all cases at 13.33, 16.8 and 17.3px (CanvasRenderingContext2D.cpp:4206-4217, :4262-4269) | Structural; a named Canvas limit for every font on both canvas kinds | c-00c115826282e683 |
| | 29 | `BlinkMacSystemFont` alone names nothing in Gecko; break inside a kerned word | Named Canvas limit, not the system font | c-007a259fc365d562 |
| | 3 passing cases hold a wrong value | The `7` in `7:41` is 7px natively and 7.117px predicted | Local | c-2f7c246b699d0353, c-ac97e0d2e1721c9d, c-b6b57e70c4602ee1 |
| Firefox, offscreen | 2,131 | No optical sizing on OffscreenCanvas | Structural on that canvas | c-0771b4bd8d746951 |
| webkit-host | 231 (8 / 30) | `canvas-language`: quotes, middle dot, ellipsis and dashes | Structural on OffscreenCanvas | c-0296951817fc96fa |
| | 174 (13 / 43) | `canvas-language`: CJK text | Structural on OffscreenCanvas | c-0771b4bd8d746951 |
| | 3 | A ligature under letter spacing in a Helvetica Neue span | Named Canvas limit, not the system font | c-3ace5da36c82c1a6 |
| Chrome | 90 (9 / 18) | The list puts a font without Latin letters before the system font, and the measuring size follows the primary family | Local | c-1cc5de69d1069a7e |
| | 18 | Emoji inside a system-ui run is scaled from the CSS size | Local | c-decd39e2eeb3678e |
| | 48 (2 / 3) | Tab stops use the font's raw space advance; Canvas only gives it with the font's size-dependent tracking (`trak`) added (simple_font_data.cc:225-240) | Named Canvas limit; a font fact would make it local | c-03eb1d57a29418c6 |
| | 39 (1 / 2) | Under ja and ko below 20px, the fallback font is asked from the platform font at the zoomed size (font_cache_mac.mm:127-149, :199-208) | Structural at a device pixel ratio other than 1 | c-71811f2ed92d39f7 |
| | 19 | The scaled stand-in is one LayoutUnit off | Structural at a device pixel ratio other than 1 | c-152f6d61017c96c8 |
| | 5 (5 / 5) | `-apple-system` alone falls to the standard font; emergency break in a ligature | Named Canvas limit, not the system font | c-199d28154cf732ae |

- **Firefox, element path.** All 2,509 cases that reach the system font at a size on the grid pass: every weight, italic, spacing, five page languages, emoji, Arabic, Thai, lists and rich mixes. At the three off-grid sizes every case fails widths, by a median of 0.24px a line. 13.33px is the default button size in Chrome and Firefox.
- **Firefox, OffscreenCanvas only.** 2,051 of the 2,679 cases that reach the system font fail. With the lab's facts, 90 of them carry no gap at all: the system font is a fallback in the list, and the primary family has no optical size axis.
- **WebKit.** On OffscreenCanvas, system-ui ignores the content language, and its fallback follows it (see the probe below). This Mac's languages are zh-Hans-US then en-US, so even English quotes come from PingFang in Canvas. A Mac with English first would shift the failures to CJK pages. No failure came from fractional sizes.
- **Chrome, the local tail.** With the lab's facts, 59 of the 90 list cases have no gap. Declaring the optical size axis for the whole list fixes 67 of the 90 on widths but breaks 16 cases on breaks and 10 on line count, so the measuring size has to be decided per font that draws the text.
- **Chrome, the ja and ko class.** The zoomed-size reading comes from source and the size pattern, not a probe: 36 of 90 such cases fail at 14 and 16px, and 1 of 54 at 20 and 24px.

**Canvas kind probe** (500 rows a browser: 10 texts × 5 languages × 5 sizes, two page languages):
- **WebKit:** a connected `<canvas lang>` gives the DOM width on 500 of 500 rows (CanvasRenderingContext2D.cpp:237-238). A detached one equals the OffscreenCanvas.
- **Firefox:** a detached element at the device size matches on 410; the 90 misses are all the 17.3px rows.
- **Chrome:** the canvas kind changes nothing.

**What the element costs or risks in Firefox, beyond needing `document`:**
- **Hidden documents.** In a document without a pres shell, such as a `display: none` iframe, the element silently takes the disconnected path: 153.97px where the DOM is 171.47px. The library would have to detect that.
- **Order of measuring.** Measuring before the document lays anything out is safe: three of three widths were equal before and after layout.
- **Shared font state.** The element's fonts are the page's own font cache. No history dependence showed in both orders, but the set holds no U+FE0E text.
- **Time.** No difference in time or Canvas calls could be measured: 354,012 calls against 358,355, and 8 to 49 ms against 16 to 57 ms for 16,200 first measurements. Firefox's timer has 1 ms steps.

**Other operating systems, from source alone.** On Windows, Blink resolves system-ui to the menu font (font_cache_skia_win.cc:130-131). That is normally Segoe UI, which has no optical size axis, so none of this applies there. Firefox's two limits are not about macOS: OffscreenCanvas never applies optical sizing, and Canvas font sizes are quantized. They should apply to any font with an optical size axis on every OS, web fonts included. iOS is WebKit with the same font, so `canvas-language` applies there too.

**Files.** The worktree is `~/github/pretext-rebuild-wt/sysui`, branch `x-sysui` (commits 872c0da, 2ce775e), holding `rebuild/lab/cases/system-ui.ts`, `rebuild/probes/sysui-*.ts` and `rebuild/lab/baselines/{offscreen-*,sysui-opsz-anywhere}-predictor.ts`. Everything else is under `~/github/pretext-rebuild/.artifacts/sysui/`:
- `cases/`
- `runs/<browser>/<variant>-<order>/`
- `analysis/`
- `classification.json` and `classification.txt`, with every id
- `probes/`
- `experiments/`
- `step1/`
- `tier1/`
- `tools/`

All 19 row files are compressed with zstd, and the originals are in the Trash.
