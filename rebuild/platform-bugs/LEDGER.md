# Browser bug dossier

Candidates for browser bug reports found while rebuilding Pretext, reduced to standalone pages and checked on
2026-09-18. **Nothing here has been filed and nobody was contacted.** Already tracked bugs stay in
`~/github/pretext/PLATFORM_BUGS.md`; this file says where a candidate is the same bug or a new facet of one.

- Pages are in `pages/`. Each is one self-contained HTML file: installed macOS fonts only, an explicit `lang`, no
  network, and it prints expected and actual results and sets the tab title to `BUG …` or `NO BUG …`.
- Every page ran in all three lab browsers, each page in a fresh browser process, in background windows at
  `devicePixelRatio` 2. What each page printed is in `results/<browser>/<page>.json`.
  - **Chrome** 153.0.8010.50, the lab's pinned copy (`~/github/browser-engines/apps`).
  - **Firefox** 156.0, the lab's pinned copy.
  - **WebKit** 22625.1.29.11.27, the system WebKit that Safari 27.0 runs, in the lab's WKWebView host
    (`webkit-host`). Installed Safari wasn't run for this dossier. `rebuild/TAKE-BACK.md` records entries 3, 6 and 9
    as seen in installed Safari 27.0 on 2026-09-16, from the lab's own probes.
  - macOS 27.0 (26A428), Retina display.
- To run them again: `python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py bugs-chrome -- bun
  rebuild/platform-bugs/verify.ts --browser=chrome` (also `firefox`, `webkit-host`). `verify.ts` serves the pages,
  appends a small reporter script while serving, and launches browsers the way `rebuild/probes/runner.ts` does.
- Every page reproduces in its target browser, and none reproduces in the other two. The one exception is the Chrome
  `system-ui` page, where Firefox shows its own tracked `system-ui` bug.
- Source paths are under `~/github/browser-engines/`: `chromium-153.0.8010.48/third_party/blink/renderer/` (B/),
  `webkit-7625.1.29.11.27/Source/` (W/) and `firefox-156.0/` (F/). Chrome .50 differs from the .48 source only in
  `chrome/VERSION`.
- Tracker searches: WebKit and Mozilla Bugzilla were searched by summary keywords through their REST APIs (read only).
  issues.chromium.org wasn't searched, because it needs a signed-in browser. Search again before filing.

"Main" is current Pretext (`~/github/pretext`). "The rebuild" is `rebuild/src`.

## Ranking

Most likely to be accepted first. Every entry is behaviour against a spec or against the browser's own other path
(Canvas and DOM, or two kinds of canvas, disagreeing about the same text). The cause was read in source for all but
entries 10 and 12, where it is inferred.

| # | Browser | Bug | Page |
|---|---|---|---|
| 1 | WebKit | `word-break: keep-all` breaks after commas, full stops and colons inside numbers and abbreviations, and after an opening parenthesis (new in Safari 27.0) | `webkit-keep-all-breaks-after-punctuation.html` |
| 2 | Chrome | A 2D canvas takes `letter-spacing` and `word-spacing` from the canvas element's CSS, scaled by the device pixel ratio, and `'0px'` doesn't clear it | `chrome-canvas-inherits-css-letter-spacing.html` |
| 3 | WebKit | `white-space: break-spaces` text lays out like `pre-wrap` after the same text was laid out under `pre-wrap` | `webkit-break-spaces-after-pre-wrap.html` |
| 4 | Firefox | Canvas `wordSpacing` spaces U+3000 and skips U+00A0; CSS `word-spacing` does the opposite | `firefox-canvas-word-spacing-separators.html` |
| 5 | Chrome | `measureText()` under `wordSpacing` depends on what the context measured before | `chrome-canvas-word-spacing-order.html` |
| 6 | WebKit | Canvas `letterSpacing` keeps optional ligatures that CSS `letter-spacing` turns off | `webkit-canvas-letter-spacing-keeps-ligatures.html` |
| 7 | Firefox | Canvas `letterSpacing` pulls joined Arabic letters apart; CSS `letter-spacing` leaves them joined | `firefox-canvas-letter-spacing-cursive.html` |
| 8 | Firefox | An OffscreenCanvas and a canvas outside the document measure bidi controls and C0 controls that a canvas in the document and DOM text skip | `firefox-offscreencanvas-control-characters.html` |
| 9 | WebKit | Two equal strings wrap differently under `keep-all`, depending on how the engine stores them | `webkit-keep-all-depends-on-string-storage.html` |
| 10 | Firefox | After U+1F600 U+FE0E is shaped once in a new content process, plain U+1F600 is a missing-glyph box for a few seconds | `firefox-emoji-missing-after-text-presentation.html` |
| 11 | Firefox | A tab misses its tab stop when its span starts inside a grapheme cluster | `firefox-tab-after-split-cluster.html` |
| 12 | Firefox | `letter-spacing` opens a gap inside a joined Arabic word after a mark that a fallback font draws | `firefox-letter-spacing-cursive-fallback-mark.html` |

New facets of bugs that are already tracked, for a comment on the existing report instead of a new one:

| # | Browser | Facet | Existing report | Page |
|---|---|---|---|---|
| A | Chrome | `system-ui` DOM text changes width after a canvas measured `system-ui` at that size × DPR: the platform font cache key lacks the specified size | Chromium #489579956 | `chrome-system-ui-font-cache-order.html` |
| B | Firefox | An OffscreenCanvas never applies automatic optical sizing, and a canvas element applies it for the CSS size ÷ DPR | Mozilla #2020917 | `firefox-canvas-optical-size.html` |
| C | Firefox | Synthetic bold widens glyphs by a different amount in an OffscreenCanvas and in DOM text at DPR 2 | Mozilla #2020894 (same cause) | `firefox-canvas-synthetic-bold.html` |
| D | Chrome, Firefox | Exact device-size formulas for the emoji width difference | Chromium #489494015, Mozilla #2020894 | none needed |
| E | WebKit | OffscreenCanvas has no locale | WebKit #285993 | none needed; our comment there has a repro |
| F | WebKit | Tab stops use the font of the inline box that holds the tab | WebKit #230339, open since 2021; not in PLATFORM_BUGS | `webkit-tab-size-uses-inline-font.html` |
| G | WebKit | `keep-all` still never breaks after a hyphen or a slash | WebKit #298022, open | none |

---

## 1. WebKit: `keep-all` breaks inside numbers and abbreviations, and after an opening parenthesis

- **Browser:** WebKit 22625.1.29.11.27 (Safari 27.0). macOS 27.0. WebKit 7624 (Safari 26.5.2) had no break after
  punctuation under `keep-all` at all, by its source (`rebuild/specs/webkit-text.md` §15); it wasn't run here.
- **Steps:** open `pages/webkit-keep-all-breaks-after-punctuation.html`. Five 60px boxes with `word-break: keep-all`
  hold Korean text with `1,000,000`, `3.14159265`, `U.S.A.U.S.A.`, `12:30:45:00` and `(대한민국)`.
- **Expected:** each box breaks at its space only and the long word overflows: `가격 ` / `1,000,000원`. UAX #14 has no
  break there (LB25, LB29, LB14), and `keep-all` only removes break opportunities. Chrome 153 and Firefox 156 do this.
- **Actual:** `가격 1,` / `000,` / `000원`; `원주율 3.` / `14159265`; `미국 U.S.` / `A.U.S.A.`; `시간 12:` / `30:45:` / `00`;
  `서울 (` / `대한민국)`, a line that ends with an opening parenthesis.
- **Source:** `W/WebCore/rendering/BreakablePositions.h:257-274`. Under `keep-all`, `nextBreakableSpace` with
  `PunctuationBreaks::Yes` returns a break after every character whose general category is Ps, Pe, Pi, Pf or Po
  (`:268-270`). It doesn't ask ICU or look at the next character. `:292-298` takes that path only for 16-bit
  strings. This is the fix for WebKit #312099 (311090@main), which was written for CJK punctuation.
- **How sure:** high. Deterministic, five of five boxes, and the code reads the same way. It is a regression that
  Korean pages will show, since `keep-all` is mostly used there and Korean text is always 16-bit.
- **Tracker:** nothing found for it. Refer to #312099, and to #298022 (open), which asks for the general rule.
- **Pretext:** main still carries the older `webkit-spaces` keep-all pair model and fails one required check on
  Safari 27 (TAKE-BACK §1). The rebuild ports the new rule as it is (`engines/webkit/breaks.ts:376`).

## 2. Chrome: a 2D canvas takes CSS `letter-spacing` and `word-spacing` from its element

- **Browser:** Chrome 153.0.8010.50. macOS 27.0, DPR 2.
- **Steps:** open `pages/chrome-canvas-inherits-css-letter-spacing.html`. Two canvases set `ctx.font = '40px Arial'` and
  nothing else. The second sits in a `<div style="letter-spacing: 5px; word-spacing: 7px">`. Both measure and draw
  `ab cd`.
- **Expected:** the same width, 97.8515625px. `ctx.letterSpacing` and `ctx.wordSpacing` read `"0px"` on both, and the
  HTML text preparation algorithm takes both spacings from those attributes. Firefox 156 and WebKit give equal widths.
- **Actual:** the second canvas measures 161.8515625px: +64px, which is (5 × 5px + 7px) × 2. The CSS values arrive
  multiplied by the device pixel ratio, and the drawn text is spaced out the same way. Setting both attributes to
  `'0px'` changes nothing, and neither does setting the font again. Setting `'1px'` and then `'0px'` clears it.
- **Source:** `B/modules/canvas/canvas2d/canvas_rendering_context_2d.cc:685-706` starts from the canvas element's
  computed `FontDescription`, which in Blink holds letter and word spacing, and resets only the sizes.
  `B/core/css/resolver/style_resolver.cc:3284-3315` then applies six font properties on top.
  `canvas_rendering_context_2d_state.cc:390-404` overwrites the spacing only once the context has set it, and
  `:871-877` returns early when the new string equals the stored `"0px"`. The element's value is a zoomed length, which
  explains the factor of 2. The same path lets `font-feature-settings`, `font-variant-ligatures`,
  `font-variation-settings` and `font-optical-sizing` through (`rebuild/specs/blink-canvas.md` §1.2, probe H12).
- **How sure:** high.
- **Tracker:** not searched.
- **Pretext:** neither main nor the rebuild is affected. Both measure on an OffscreenCanvas, and main's fallback is a
  canvas outside the document, which has no computed style.

## 3. WebKit: `break-spaces` text lays out like `pre-wrap` after a `pre-wrap` layout of the same text

- **Browser:** WebKit 22625.1.29.11.27 (Safari 27.0). macOS 27.0.
- **Steps:** open `pages/webkit-break-spaces-after-pre-wrap.html`. Three 28px boxes in 16px Arial hold `abc`, six
  spaces, `def`. Box 1 is `break-spaces`. Box 2 is `pre-wrap` and is removed after one layout. Box 3 is
  `break-spaces`, made after box 2 is gone.
- **Expected:** boxes 1 and 3 have the same 3 lines (`abc` with one space, five spaces, `def`). Chrome and Firefox: 3
  and 3.
- **Actual:** box 1 has 3 lines and box 3 has 2: all six spaces stay on the first line, as under `pre-wrap`.
- **Source:** the process-wide `TextBreakingPositionCache` is keyed by the text, a style context and the security
  origin (`W/WebCore/layout/formattingContexts/inline/text/TextBreakingPositionCache.h:41-48`). The context maps
  `Preserve` and `BreakSpaces` to one value, with a comment saying they "have the same text breaking positions"
  (`TextBreakingPositionContext.h:43-56`). They don't: only the uncached path gives `break-spaces` one item per space
  (`InlineItemsBuilder.cpp:972-978`), and the cache is read first (`:936`). It is filled when a block's line layout is
  destroyed (`W/WebCore/layout/integration/inline/LayoutIntegrationLineLayout.cpp:210-221`), for text boxes with at
  least 3 items and 5 code units.
- **How sure:** high.
- **Tracker:** nothing found.
- **Pretext:** main doesn't model it. The rebuild computes which cached item lists a box could be handed and reports
  the line under its `page-history` gap. The same cache is why the lab observes WebKit cases in both orders. Its key
  also lacks the string storage of entry 9, so an 8-bit text laid out after an equal 16-bit text takes the 16-bit
  breaks (`rebuild/specs/PROBES.md`, "Page history and storage width").

## 4. Firefox: canvas `wordSpacing` spaces U+3000 and skips U+00A0

- **Browser:** Firefox 156.0. macOS 27.0.
- **Steps:** open `pages/firefox-canvas-word-spacing-separators.html`. `a b` with U+0020, U+00A0 and U+3000 between the
  letters, 16px Georgia, at 0 and at 10px of word spacing: DOM span, canvas element, OffscreenCanvas.
- **Expected:** +10px for U+0020 and U+00A0, nothing for U+3000. CSS Text 3 names the space and the no-break space as
  word separators and says fixed-width spaces such as U+3000 aren't, and the canvas text preparation algorithm applies
  `wordSpacing` as that property. Firefox's DOM, Chrome and WebKit all do this, in DOM and canvas.
- **Actual:** both Firefox canvases add 0 for U+00A0 and 10px for U+3000.
- **Source:** `F/dom/canvas/CanvasRenderingContext2D.cpp:4780-4786` adds word spacing where `CharIsSpace()` is set,
  and that flag is set for U+0020 and U+3000 only (`F/gfx/thebes/gfxFont.cpp:749-750`). DOM text uses
  `IsCSSWordSpacingSpace` (`F/layout/generic/nsTextFrame.cpp:880-892`, used at `:4215`).
- **How sure:** high.
- **Tracker:** nothing found.
- **Pretext:** main never sets `ctx.wordSpacing`. The rebuild keeps it at `0px` in every engine and adds word spacing
  itself.

## 5. Chrome: `measureText()` under `wordSpacing` depends on measurement order

- **Browser:** Chrome 153.0.8010.50. macOS 27.0.
- **Steps:** open `pages/chrome-canvas-word-spacing-order.html`. Two new OffscreenCanvas contexts with
  `font = '16px Arial'` and `wordSpacing = '10px'`. A measures `" x"` and then `"x y"`. B measures `"x y"` and then
  `" x"`.
- **Expected:** `"x y"` is 30.4453125px in both (20.4453125 + 10), and `" x"` is the same in both. Firefox and WebKit
  give that.
- **Actual:** `"x y"` is 20.4453125px in A, with no word spacing at all, and 30.4453125px in B. `" x"` is 12.4453125px
  in A and 22.4453125px in B.
- **Source:** Canvas shapes word by word and caches each word's `ShapeResult` by its text and direction only
  (`B/platform/fonts/shaping/frame_shape_cache.cc:46-50`), after spacing was applied with the word's offset in the
  string that came first (`B/platform/fonts/plain_text_node.cc:402-451`). Word spacing is skipped for a space at
  offset 0 (`B/platform/fonts/shaping/shape_result_spacing.cc:132-135`). So the space cached from `" x"` has no
  spacing and is reused inside `"x y"`.
- **How sure:** high.
- **Tracker:** not searched. It is the same cache as Chromium #560614560 (tracked: punctuation script by order), with
  another mechanism. File it on its own and link the two.
- **Pretext:** not affected, as in entry 4.

## 6. WebKit: canvas `letterSpacing` keeps optional ligatures

- **Browser:** WebKit 22625.1.29.11.27 (Safari 27.0). macOS 27.0.
- **Steps:** open `pages/webkit-canvas-letter-spacing-keeps-ligatures.html`. `ffi fl` in 32px Hoefler Text at 0 and at
  1px of letter spacing: DOM span, canvas element, OffscreenCanvas.
- **Expected:** the canvas at 1px measures what the DOM span does, 63.408px: six separate glyphs plus 6px. CSS Text says
  optional ligatures aren't applied when letter spacing isn't zero. Chrome and Firefox drop them in DOM and canvas.
- **Actual:** the DOM goes from 54.400 to 63.408px. Both canvases go from 54.400 to 57.400px: the `ffi` and `fl`
  ligatures stay and three glyphs are spaced.
- **Source:** the style system sets `shouldDisableLigaturesForSpacing` on the font description when letter spacing
  isn't zero (`W/WebCore/style/computed/StyleComputedStyleBase.cpp:318-331`). The canvas setter only calls
  `font.setLetterSpacing(pixels)` (`W/WebCore/html/canvas/CanvasRenderingContext2DBase.cpp:3271-3297`). WebKit #176215
  fixed this for CSS in 2017, and #283408 added canvas `letterSpacing` in 2024 without it.
- **How sure:** high on the behaviour. The spec says "should", which is why it ranks under the first five.
- **Tracker:** nothing found.
- **Pretext:** main measures letter-spaced text with `ctx.letterSpacing`, so ligature pairs under letter spacing come
  out too narrow in Safari. The rebuild adds spacing itself and reports such lines under its
  `letter-spacing-ligatures` gap: WebKit's Canvas has no way to measure the text without ligatures.

## 7. Firefox: canvas `letterSpacing` separates joined Arabic letters

- **Browser:** Firefox 156.0. macOS 27.0.
- **Steps:** open `pages/firefox-canvas-letter-spacing-cursive.html`. The word بيت in 40px Geeza Pro at 0 and at 8px of
  letter spacing: DOM span, canvas element, OffscreenCanvas.
- **Expected:** the canvas adds what the DOM adds. Firefox's DOM adds nothing (49.350px both times), following CSS Text
  on cursive scripts. Chrome adds nothing in both, WebKit adds 24px in both.
- **Actual:** both Firefox canvases add 24px (49.350 to 73.350px) and draw the letters apart.
- **Source:** DOM text skips spacing after a cluster whose base is in a cursive script
  (`F/layout/generic/nsTextFrame.cpp:4196-4213`). The canvas spacing provider has no such test
  (`F/dom/canvas/CanvasRenderingContext2D.cpp:4759-4790`).
- **How sure:** high on the behaviour; medium that Mozilla treats it as a bug and not as a missing feature.
- **Tracker:** nothing found. Mozilla #1342835 is the DOM rule.
- **Also seen, not worth its own report:** the DOM keeps optional ligatures while the spacing rounds to 0 app units
  (0.001px), and Canvas drops them at any value that isn't zero.
- **Pretext:** main measures letter-spaced text with `ctx.letterSpacing`, so it is exposed for Arabic (TAKE-BACK §2.5).
  The rebuild measures at `0.001px` and adds the DOM's spacing per cluster, except after cursive bases.

## 8. Firefox: three kinds of canvas disagree about invisible characters

- **Browser:** Firefox 156.0. macOS 27.0, DPR 2.
- **Steps:** open `pages/firefox-offscreencanvas-control-characters.html`. `A` U+200E `V` and `a` U+0001 `b` in 18px
  Arial, measured by a canvas in the document, a canvas element outside it and an OffscreenCanvas, next to DOM text.
- **Expected:** the three canvases agree. The one in the document measures 22.667 and 20.000px, like `AV` and `ab`, as
  DOM text does.
- **Actual:** the OffscreenCanvas measures 24.000px (A + V without their kerning) and 33.033px (a hexbox for U+0001).
  The canvas outside the document measures 22.667 and 46.000px (a hexbox at another size). Chrome and WebKit give one
  answer per string on all three.
- **Source:** without a pres context, `nsBidiPresUtils::ProcessText` skips `FormatUnicodeText`, which removes bidi
  controls (`F/layout/base/nsBidiPresUtils.cpp:2249-2252`, `:2076-2091`). Without a canvas style the text run flags are
  empty (`F/dom/canvas/CanvasRenderingContext2D.cpp:5191-5195`), so `TEXT_HIDE_CONTROL_CHARACTERS` isn't set and
  `F/gfx/thebes/gfxFont.cpp:3667-3676` records a missing glyph.
- **How sure:** high.
- **Tracker:** nothing found.
- **Pretext:** main measures the characters as they are. The rebuild's Gecko port leaves both kinds of character out
  of the strings it measures.

## 9. WebKit: equal strings wrap differently under `keep-all`

- **Browser:** WebKit 22625.1.29.11.27 (Safari 27.0). macOS 27.0.
- **Steps:** open `pages/webkit-keep-all-depends-on-string-storage.html`. Three 100px boxes, 16px Menlo, `keep-all`,
  each with the ASCII text `abcdefgh,ijklmnopqr`: a literal; `.slice(1)` of a literal that starts with U+4E2D; a
  `JSON.parse` result from a text that also holds U+4E2D. All three strings are `===`.
- **Expected:** the same layout, 1 overflowing line (no break after a comma before a letter, LB29). Chrome and Firefox: 1,
  1, 1.
- **Actual:** 1, 2 and 2 lines.
- **Source:** `W/WebCore/rendering/BreakablePositions.h:292-298` picks the `keep-all` rule by `stringView.is8Bit()`.
  The second and third strings are kept in 16-bit storage and take entry 1's punctuation rule.
  `W/JavaScriptCore/runtime/LiteralParser.cpp:896-899` and `JSONAtomStringCacheInlines.h` keep a JSON string from a
  16-bit source 16-bit once it is longer than 16 characters. The first-unit emergency break
  (`W/WebCore/layout/formattingContexts/inline/InlineContentBreaker.cpp:143`) has the same test.
- **How sure:** high on the behaviour. A correct fix for entry 1 probably removes it, so mention it there, or file it as
  the second half: the #312099 fix doesn't reach Latin-1 text.
- **Tracker:** nothing found.
- **Pretext:** main's own test page builds its text in JavaScript, which stays 8-bit. The rebuild takes a text as 8-bit
  when every code unit is at most U+00FF, which is what a page gets from literals, and its lab serves case files as
  ASCII-only JSON for this reason (commit 8df70c6).

## 10. Firefox: plain U+1F600 is a missing-glyph box after U+1F600 U+FE0E

- **Browser:** Firefox 156.0, in a new content process. macOS 27.0.
- **Steps:** open `pages/firefox-emoji-missing-after-text-presentation.html` in a newly started browser. It measures and
  draws U+1F600 in 32px Arial, then U+1F600 U+FE0E, then U+1F600 again, and once more 3 seconds later. `?via=dom` uses
  a DOM span for the U+FE0E text.
- **Expected:** plain U+1F600 is always the 32px colour emoji.
- **Actual:** the U+FE0E string is 17px with no coloured pixels, a missing-glyph box. After it, plain U+1F600 is also
  17px and colourless, in a new OffscreenCanvas context and in DOM text, in Arial and in Georgia. 3 seconds later both
  are 32px and coloured again, and the DOM span that was laid out at 17px has been reflowed to 32px. A canvas width
  taken in between stays wrong, and nothing tells the page. Another emoji (U+1F601) isn't affected, and neither is a
  font list that names "Apple Color Emoji".
- **Source, read but not confirmed with a debugger:** the failed search for a text-style font ends in
  `mCodepointsWithNoFonts[level].set(aCh)` (`F/gfx/thebes/gfxPlatformFontList.cpp:1321-1323`). The search skipped
  families whose character maps weren't loaded yet and started the asynchronous loader (`:1479-1486`).
  `gfxFontGroup::FindFontForChar` then returns early for that code point whatever presentation is asked for, before
  it tries the preferred emoji font (`F/gfx/thebes/gfxTextRun.cpp:3524-3531`, before step 2 at `:3533`). When the
  loader finishes, the set is cleared and everything reflows (`gfxPlatformFontList.cpp:1157-1169`).
- **How sure:** high on the behaviour (7 of 7 fresh browser processes, both variants). Medium on the cause. Medium on acceptance, because the DOM
  heals itself.
- **Tracker:** nothing found. Mozilla #1502718 (open) is about U+FE0E being ignored.
- **Pretext:** this is TAKE-BACK 5.5, now explained: the "text glyph" was a missing-glyph box, and the state ends
  when the loader finishes. It made 116 lab cases depend on order. Main can cache a wrong width from that window. The
  rebuild never adds U+FE0E to a string it measures and reports `page-history` on such emoji.

## 11. Firefox: a tab misses its tab stop when its span starts inside a cluster

- **Browser:** Firefox 156.0. macOS 27.0.
- **Steps:** open `pages/firefox-tab-after-split-cluster.html`. Two lines of U+0926 U+094B, a tab and `x`, in 20px
  Kohinoor Devanagari, `white-space: pre; tab-size: 8`. In the second line a `<span>` without style starts between the
  letter and its vowel sign.
- **Expected:** `x` starts at the first tab stop, 46.133px, in both lines. Chrome and WebKit: the same position in both.
- **Actual:** 46.133px in the first line and 51.600px in the second. The difference, 5.467px (328 app units), is the
  vowel sign's advance.
- **Source:** `CalcTabWidths` adds a character's advance to the running position only where the character starts a
  cluster (`F/layout/generic/nsTextFrame.cpp:4349-4357`). A frame that starts inside a cluster never counts the rest
  of that cluster, so the tab is measured from a position that is too far left.
- **How sure:** high on the behaviour, medium-high on the cause. It ranks low because the markup is rare.
- **Tracker:** nothing found.
- **Pretext:** main has no inline boxes inside a cluster. The rebuild doesn't port it: 2 open rows in round 3's Gecko
  fresh set 15.

## 12. Firefox: `letter-spacing` opens a gap after a mark from a fallback font in a joined Arabic word

- **Browser:** Firefox 156.0. macOS 27.0.
- **Steps:** open `pages/firefox-letter-spacing-cursive-fallback-mark.html`. Two joined words in 40px Geeza Pro at 0 and
  at 8px of letter spacing: beh, U+064E (in Geeza Pro), beh, beh; and beh, U+0301 (not in Geeza Pro), beh, beh.
- **Expected:** both rows add the same. Chrome adds 0 to both, WebKit 24px to both.
- **Actual:** the first word adds 0 and the second adds 8px, after the cluster with the fallback mark.
- **Source, inferred:** the rule looks up the base character of the cluster in the text run
  (`F/layout/generic/nsTextFrame.cpp:4203-4213`). A mark drawn by another font starts a glyph run and a cluster of its
  own, so the "base" found is U+0301, which isn't in a cursive script. The rebuild's probe F19 saw the same with
  Syriac, N'Ko, Mongolian and Hanifi Rohingya letters.
- **How sure:** high on the behaviour, medium on the cause.
- **Tracker:** nothing found.
- **Pretext:** main isn't concerned in a useful way (it has no cursive rule at all, entry 7). The rebuild predicts it
  where its font facts say which font draws the mark, and reports `font-fallback` otherwise.

---

## Facets of tracked bugs

### A. Chrome: `system-ui` DOM width depends on which text made the platform font first (Chromium #489579956)

- **Steps:** open `pages/chrome-system-ui-font-cache-order.html` in a fresh renderer at DPR 2. A 13px `system-ui` span is
  laid out before any canvas touched `system-ui`. A canvas then measures `system-ui` at 30px, and a 15px span is laid
  out.
- **Expected:** each span is as wide as a canvas measures the text at the span's CSS size. **Actual:** 13px: DOM 67.875,
  canvas 67.869. 15px: DOM 67.4375, canvas 76.699, so the DOM text is 9.26px narrower than it would have been.
- **Source:** the DOM sets the `opsz` axis from the specified size (`B/platform/fonts/mac/font_platform_data_mac.mm:170-178`),
  but `FontCacheKey` holds the effective size only (`B/platform/fonts/font_cache_key.h:53-68`,
  `font_description.cc:308-331`). At DPR 2 a 15px span and a 30px canvas font share a key, and whichever came first
  decides the optical size for both.
- **How sure:** high. It explains why the tracked bug's size bands move between releases and pages. Worth a comment
  with the page, not a new report.
- **Pretext:** `system-ui` stays unsupported in main. The rebuild reports `page-history` for it.

### B. Firefox: canvas text and automatic optical sizing (Mozilla #2020917)

- **Steps:** open `pages/firefox-canvas-optical-size.html`. A pangram in `system-ui` at 13, 14, 16 and 20px.
- **Actual at 14px:** DOM 289.150px; DOM with `font-optical-sizing: none` 251.717px; OffscreenCanvas 251.717px; canvas
  element 310.700px. The same pattern holds at every size. The OffscreenCanvas equals the DOM without optical sizing at
  all four sizes.
- **Source:** an OffscreenCanvas never sets automatic optical sizing (`F/gfx/src/nsFont.cpp:276-279`, reached only
  through `nsFontMetrics.cpp:149`). The canvas element takes its font at the canvas size over the CSS-to-device scale
  (`F/dom/canvas/CanvasRenderingContext2D.cpp:4256-4269`), so at DPR 2 it asks for the 7px optical size. That last
  step is inferred from the direction of the difference.
- The tracked row calls this "different physical fonts". It is one family at three optical sizes.

### C. Firefox: synthetic bold in OffscreenCanvas and DOM at DPR 2 (same cause as Mozilla #2020894)

- **Steps:** open `pages/firefox-canvas-synthetic-bold.html`. Ten U+2764 in bold Helvetica Neue, drawn by a fallback
  font with synthetic bold.
- **Actual:** bold 14px: DOM 131.000px, OffscreenCanvas 132.167px (7 app units a glyph). Bold 16px: 149.500 and
  150.667. Bold 24px: 223.500 and 224.833. The regular-weight rows are equal.
- **Source:** the offset is `0.25 + 0.75 × size / 48` device px below 48px (`F/gfx/thebes/gfxFont.h:1899-1904`), rounded
  per glyph at the text run's scale (`gfxFont.cpp:3551-3562`). The DOM computes it at the device size (28px) and an
  OffscreenCanvas at the CSS size (14px), so the two differ at any DPR other than 1. The emoji bug has the same cause:
  an OffscreenCanvas shapes at the CSS size.
- **Pretext:** in the rebuild this is a named residual class of the OffscreenCanvas path.

### D, E, F, G

- **D.** The device-size formulas of TAKE-BACK §2.3 belong as comments on Chromium #489494015 and Mozilla #2020894.
- **E.** TAKE-BACK 5.11 is WebKit #285993. One more data point for it: under `ko`, 32px `sans-serif` `永骨` is 64px in an
  OffscreenCanvas and 55.36px in DOM text.
- **F.** `pages/webkit-tab-size-uses-inline-font.html`: a tab inside a 16px Menlo span in a 16px Times New Roman block
  ends at 77.063px (8 Menlo spaces), not at 32px (8 Times New Roman spaces). CSS Text defines `tab-size` by the nearest
  block container's space advance, and Chrome and Firefox follow that. This is WebKit #230339, reported in 2021 and
  still NEW; the page can go there. The rebuild models WebKit's behaviour.
- **G.** While reducing entry 1: `a well-known` at 50px under `keep-all` doesn't break after the hyphen in WebKit,
  8-bit or 16-bit, where Chrome and Firefox break. That is WebKit #298022's subject. No page.

## Looked at and not reported

| Candidate | Why not |
|---|---|
| TAKE-BACK 5.12, Chrome tab stops and `trak` | Withdrawn. In Chrome 153, 16px Helvetica Neue tab stops are 35.5859375px apart, which is 8 × Canvas's space advance (4.447998px) rounded up to 1/128px. The 4.453125px in TAKE-BACK was the DOM's rounded space, not Canvas's. |
| Chrome's Canvas replaces LRM, RLM, SHY, ZWSP and bidi embedding controls with U+200B and ends a word there, so `A` U+200E `V` loses its kerning (24.012px against DOM 22.680px) | Deliberate: `B/platform/fonts/plain_text_node.cc:85-91` says Google Docs wraps text in bidi controls and the split improves the cache hit rate. Documented difference; TAKE-BACK §2.2 has the recipe (U+2060). |
| Firefox takes the fallback font for U+FFFD from the first U+FFFD the process saw | Deliberate shortcut, written up in the source (`F/gfx/thebes/gfxPlatformFontList.cpp:1244-1268`). The lab treats such cases as order-dependent. |
| Firefox's 1 app unit differences between OffscreenCanvas and DOM | Rounding at two scales, 0.017px. Not a bug. |
| Every Canvas turns U+000B into a space, though VT isn't ASCII white space in the HTML spec | All three engines agree. |
| Chrome draws FF and VT with a fallback glyph in DOM text, and Firefox gives them no width | Chrome follows CSS Text. Firefox hides them on purpose (`layout.css.control-characters.visible`). |
| Chrome treats U+2028 like a space where WebKit 7625 and Firefox break the line | Known difference between engines, no effect on Pretext beyond the model. |
| Servo's 10-bit font sizes, Gecko's 7-bit canvas font sizes, WebKit's one-float32-step shortcut path, Safari 27's 1/64px heights, DevTools DPR emulation laying out at zoom 1 | Intentional or too small, as TAKE-BACK §5 says. |
| A Firefox worker's OffscreenCanvas follows the macOS locale | Already under "Investigated" in PLATFORM_BUGS (Mozilla #1869001). |
| `document.fonts.check()` is true for a missing family in Firefox | The CSS Font Loading spec allows it. |
| Range rect oddities (WebKit's zero-width rect after `</span>`, Safari's per-character rects on whole pixels, Firefox putting a cluster's advance on the variation selector) | Observation only. WebKit #296765 is already tracked as related. |

Left out on purpose, because round 4's engine owners are reducing them: Chrome never returning from
`Range.getClientRects()` on a PingFang SC `keep-all` case, and Firefox's frame 2^30 + 56 app units wide.

Not reduced, because the source documents have no trace and the effect is tiny or needs a web font: Chrome's pair
adjustment between U+3000 and the next line's first letter in Times New Roman (0.07px), the exact-fit break in
ProbeShantell under letter spacing, and Chrome's emergency break after a marked waw in Geeza Pro.
