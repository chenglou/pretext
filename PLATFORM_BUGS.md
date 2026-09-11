# Platform Bugs

This is the current ledger of browser and operating-system behavior that affects Pretext. `Exact` means the linked report contains our repro or the same failure. `Related` means the report helps explain the browser behavior but does not prove our exact case. `Unfiled` means we have a local repro or compatibility requirement but no exact public issue.

Tracker statuses were last checked on June 22, 2026. The checked-in browser snapshots and the commands used to refresh them remain the source of truth for current accuracy; see [DEVELOPMENT.md](DEVELOPMENT.md).

## Open, exact platform bugs

| Platform | Bug | Tracker status | Effect on Pretext | Current handling |
|---|---|---|---|---|
| Chrome on macOS | Canvas `measureText()` reports Apple Color Emoji wider than DOM text at small font sizes. The discrepancy is size-dependent and disappears at larger sizes. | [Chromium #489494015](https://issues.chromium.org/issues/489494015), open | Raw canvas widths can force premature emoji line breaks. | `prepare()` capability-detects the canvas/DOM difference once per font and subtracts it per emoji grapheme. The correction is cached and stays out of `layout()`. |
| Firefox on macOS | The same Apple Color Emoji canvas/DOM width split, with a different size curve from Chrome. Mozilla's investigation points at the bitmap font being measured at different effective device-pixel ratios. | [Mozilla #2020894](https://bugzilla.mozilla.org/show_bug.cgi?id=2020894), `UNCONFIRMED` | Raw canvas widths can force premature emoji line breaks. | The same capability-detected correction handles Firefox without a Firefox version check. |
| Chrome on macOS | Canvas and DOM resolve `system-ui` to different SF Pro optical variants at some sizes. The affected size bands have moved between browser releases. | [Chromium #489579956](https://issues.chromium.org/issues/489579956), open | Canvas widths can be wrong by enough to invalidate line-count predictions. | `system-ui` remains unsupported for accuracy. Use a named font. |
| Firefox on macOS | Canvas and DOM resolve `system-ui` / `-apple-system` to different physical fonts. The magnitude and direction have moved between browser releases. | [Mozilla #2020917](https://bugzilla.mozilla.org/show_bug.cgi?id=2020917), `UNCONFIRMED` | Canvas widths are too far from DOM widths for reliable line-count prediction. | `system-ui` remains unsupported for accuracy. Use a named font. |

### Retina retest: June 22, 2026

We reran the exact attached repro inputs in headed browsers on a Retina display at `devicePixelRatio = 2`:

- Chrome `149.0.7827.156`: the emoji curve still matches the filed bug exactly (`+2px` to `+4px` below `24px`, then zero). The `system-ui` bug also remains, but this release's mismatches moved to `20px`, `22px`, `24px`, `26px`, `28px`, `30px`, and `32px` instead of the original size bands.
- Firefox `152.0.1`: the emoji curve still matches the corrected Mozilla report exactly (`+1.5px` to `+5px` below `28px`, then zero). Both `system-ui` and `-apple-system` mismatched at every tested size from `10px` through `32px`; the curve no longer matches the original report, but named-font controls still agree.
- Headless runs at `devicePixelRatio = 1` made both browsers look clean. That is not a valid regression check for these bugs because the Apple Color Emoji issue depends on the Retina DPR split and the font-resolution bug also disappeared in those runs.
- With the capability-detected emoji correction enabled, the headed Chrome and Firefox accuracy sweeps were both `7680/7680`. Temporarily disabling only that correction reduced Chrome to `7660/7680` and Firefox to `7652/7680`, so the workaround is still necessary.

Safari does not reproduce either filed canvas/DOM bug: its emoji canvas and DOM widths agree, and its `system-ui` canvas and DOM widths agreed across the project's `10-28px` scan. The public recommendation still says to avoid `system-ui` on macOS because the same application may run in Chrome or Firefox.

The Markdown chat overflow in [Pretext #202](https://github.com/chenglou/pretext/issues/202) reproduces this font-resolution problem in headed Firefox 152 at DPR 2. One ordinary fragment at `14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` measures 206.68px in OffscreenCanvas, 238.12px in DOM text, and 257.97px in an HTML canvas. The demo now uses `Helvetica, Arial, sans-serif` in both preparation and CSS. That change eliminates the overflowing text in the tested chat fixtures at three widths and three scroll positions; hanging trailing spaces can still extend beyond a row's fitted width.

## Safari/WebKit issues and compatibility behavior

| Behavior | Classification and issue links | Evidence in this project | Current handling |
|---|---|---|---|
| A `Range` crossing wrapped text can report an extra zero-width rectangle on the preceding line, inflating `getClientRects()` / `getBoundingClientRect()` geometry. | `Related`: [WebKit #296765](https://bugs.webkit.org/show_bug.cgi?id=296765), `NEW`, with Apple Radar `157274174`. It is the same wrapped-`Range` geometry family, but not an exact report for every URL-query or `pre-wrap` extraction failure we have seen. | Safari 26.4 still produces extractor-sensitive results around preserved whitespace, hard breaks, and some URL/query boundaries even when DOM height and span extraction are exact. | This affects diagnostics, not the runtime line breaker. Cross-check suspicious Safari `Range` results with the span extractor before changing Pretext. |
| Safari needs a `1/64px` line-fit allowance instead of the `0.005px` Chromium/Gecko allowance. | `Unfiled`; [WebKit #145393](https://bugs.webkit.org/show_bug.cgi?id=145393) is useful implementation background because it documents WebKit's `LayoutUnit` as `1/64px`, and [WebKit #144990](https://bugs.webkit.org/show_bug.cgi?id=144990) is a resolved historical float-precision wrapping bug. Neither is an exact report for our current case. | On Safari 26.4, replacing `1/64px` with `0.005px` reintroduced one `18px Verdana` Arabic/Latin mismatch in the 7,680-case sweep. | Keep the Safari line-fit epsilon in the engine profile. |
| Safari's `word-break: keep-all` punctuation boundary differs from Chromium and Gecko for no-space mixed CJK text. | `Exact, fixed upstream`: [WebKit #312099](https://bugs.webkit.org/show_bug.cgi?id=312099) landed as [311090@main](https://commits.webkit.org/311090@main). The broader break-all/keep-all punctuation report [WebKit #298022](https://bugs.webkit.org/show_bug.cgi?id=298022) remains open. | CSS Text says `word-break` does not affect punctuation opportunities, and [WPT `word-break-keep-all-006`](https://wpt.fyi/results/css/css-text/word-break/word-break-keep-all-006.html) tests exactly that. Safari 26.4 still fails; the recorded Safari 26.5 stable and preview runs also fail while Chrome and Firefox pass. | Keep `breakKeepAllAfterPunctuation` until the fixed WebKit build ships in Safari, then retest and remove it. Keep the policy in preprocessing, not `layout()`. |
| Safari fits overlong shaped runs more accurately from measured segment prefixes than from isolated grapheme widths. | `Unfiled`; no exact WebKit issue found. | A 2,564-case quarter-pixel kerning/ligature sweep had 307 raw-height misses with prefix fitting and 1,018 with isolated grapheme sums. | Keep `preferPrefixWidthsForBreakableRuns` for Safari, capped at 96 graphemes to avoid a superlinear `prepare()` path. |

The three Safari engine-profile decisions above—line-fit allowance, `keep-all` punctuation policy, and prefix fitting—were rechecked on shipping Safari 26.4. Safari Technology Preview was not installed, so they should not be described as verified against WebKit tip-of-tree.

## Investigated, but not platform bugs

- [Pretext #195](https://github.com/chenglou/pretext/issues/195): September 3 diagnostics reproduce the Shantell Sans bold wrap mismatch in Chrome 152 and Firefox 152, but whole-run Canvas and DOM measurements agree. Summing isolated grapheme widths loses contextual spacing. Near-threshold probes also distinguish reshaped prefixes from native in-paragraph advances; enabling the existing prefix model alone is insufficient. See [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md).
- Generic `serif` under `lang=ja` can differ from a default-language offscreen canvas. In the September 3 Chrome and Firefox probes, an HTML canvas with matching `lang` restores the DOM width; Safari still differs. The named Times New Roman control agrees in all three. See [FONT_DIAGNOSTICS.md](FONT_DIAGNOSTICS.md) for the measured context and remaining Safari difference.
- Chromium's Korean closing-quote behavior is still modeled by `carryCJKAfterClosingQuote`, but the minimal repro behaved the same in Chrome 149 and Firefox 148. It follows the browser's `overflow-wrap: break-word` handling of the normal unbreakable unit before emergency grapheme breaking, so we did not file it as a Chromium bug.
- The old Safari-only `preferEarlySoftHyphenBreak` branch was redundant with the later strict soft-hyphen boundary fix. It was removed after Safari 26.4 retesting; there is no remaining platform bug to track.
- Safari emoji widths are wider than `font-size` at some small sizes because of Apple Color Emoji's non-linear scaling, but canvas and DOM agree. Comparing either one to `font-size` is the bug in the measurement model, not a Safari bug.
- The long-form Chinese and Japanese corpus fields in [RESEARCH.md](RESEARCH.md) remain browser/model canaries, not isolated browser defects with defensible tracker repros.

## Historical, unfiled platform investigation

The repository briefly contained iOS Safari scrolling crash probes for very tall virtualized pages and rapid scrollbar/flick interaction. They were removed in commits `837f080` and `2fbae37` after the investigation, and no Apple/WebKit issue link was recorded. This is not part of Pretext's current text-layout surface; retain it here only so the old commits are not mistaken for a current workaround.
