# Current Priorities

One line per item, with where its detail lives. Work depth-first; a punted item stays here or in ENGINE_FOLLOWUPS.md with what would reopen it. An item leaves once the maintainer has decided it; they rarely read these lists, so raise an item that needs their decision with them directly.

## Now

- Check the README as an app developer's only guide: build a long chat list from it and `pages/demos/markdown-chat.md` alone, then compare the app's heights, resizing and scroll anchoring with the browser's.

## End of project

Held until the current work is done, and all before the first release.

- The API discussion, a review of the public API: today's API stays, and alternatives are additions (RESEARCH.md, Caching And API Design; the studies are in RESEARCH.md, Dead Ends, Caching, State And API Designs). On its list:
  - layout that takes the text itself, with no handle for the app to keep, and gives the same answer every call, perhaps with an optional warm-up like `prepare()`;
  - who owns and bounds the per-font width cache, which grows with each new segment until `clearCache()`;
  - parked speed-ups: the width memo, where a handle remembers which widths gave its last lines (drag-resize frames 2.9-4.2× faster, new widths up to 26% slower in Chrome, 2026-09-26); the font given at `layout()` instead of `prepare()`; a Firefox cache of Thai word boundaries;
  - an element's own language and `Content-Language` as inputs (ENGINE_FOLLOWUPS.md, Language and generic families);
  - the emoji-width correction in a worker, where the DOM span it reads doesn't exist (#292, PR #346; PLATFORM_BUGS.md);
  - a paragraph direction, and the device pixel ratio for Chrome's fit grid, the 1/64 device px Chrome fits lines on (RESEARCH.md, Measurement Model; decisions 3 and 4 of issue #321, a study of offline engine emulators);
  - `getTextClusters()` once Chrome ships it, no help for Firefox;
  - `extraWidth` on a rich item split across lines: today every piece is charged all of it, as CSS `box-decoration-break: clone` pads, where browsers default to `slice`, which pads only the outer ends; perhaps CSS's names at the release, `paddingInline: [start, end]` with `boxDecorationBreak`, so neither meaning is silent (#382; #454 asks for a way to pad only the outer ends). With it, whether a non-finite `extraWidth` throws, as a non-finite `letterSpacing` (#356) and box width (#387) do: today `NaN` or `Infinity` is taken as given and lays out wrongly without an error;
  - whether `SegmentBreakKind`, which types the `kinds` of a `prepareWithSegments()` handle, is exported: it isn't, so README writes the kind names out and an app can't name the type (`src/layout.ts`). What the handle's type shows is decided: `segments`, `kinds` and `widths` (RESEARCH.md, Decisions Log, 2026-10-06);
  - whether a `maxWidth` of `NaN` throws, as a `letterSpacing` (#356) and a box's width (#387) that aren't finite do when preparing. `NaN` is a value the type allows, so the rule that no argument's type is checked doesn't answer it (RESEARCH.md, Decisions Log, 2026-10-02 and 2026-10-06, and ENGINE_FOLLOWUPS.md, Small ones, have what the line APIs do with one today and what a check costs the streams);
  - rich-inline cursors, since rich inline lays its items out as one paragraph: a fragment range's `start` and `end` count segments of the item's part of the paragraph, for passing back, and only a materialized fragment says where its text sits in the item's `text` (`sourceStart`, `sourceEnd`); whether a fragment range should say it too (RESEARCH.md, Rich Inline As One Paragraph). Where `start` and `end` are public is decided: on a fragment range, not on a materialized fragment's type (RESEARCH.md, Decisions Log, 2026-10-10);
  - which hyphen ends the text of a line that breaks at a soft hyphen: `line.text` ends with `-`, as README promises, where the line's width counts the hyphen the browser paints (ENGINE_FOLLOWUPS.md, Deferred engine decisions, has the numbers and the three choices);
  - cutting a line anywhere, for an ellipsis (#42, #59): the line stream ends a line only where the browser wraps, so the ellipsis demo (#410) fills the room before an ellipsis with repeated `layoutNextLine()` calls, adds the space each call ended at from a width it measures apart, tells a first grapheme that didn't fit by comparing widths within 1/64px, and finds the end of a label cut in its middle by laying out the line from each grapheme in turn. One call would do all four: the longest run of whole graphemes from a cursor, or back from the text's end, that fits a width, and its width. Inside a word that width should be the shaped word's, where a handle keeps those of a word broken across lines, so Chrome and Firefox show one to three more Arabic letters than the demo on two thirds of the Arabic lines it cuts; and browsers cut a line that mixes directions at its painted end, which needs the visual order Pretext doesn't keep (RESEARCH.md, Line Clamp And Ellipsis);
  - for a word cut between letters (#421): a cursor that carries the width left of a cut word from line to line, which Safari's rule needs and `layoutNextLine()`'s two integers can't hold; and an option that tells `prepare()` a text is never cut inside a word, or the least width it is laid out at, so that labels that never wrap that way skip the Blink profile's questions about letter pairs and the Gecko profile's prefix fit (RESEARCH.md, Break Opportunities From Engine Data; Decisions Log, 2026-10-05; ENGINE_FOLLOWUPS.md, Emergency breaks inside a word);
  - how a browser whose Canvas lacks what its profile needs degrades, still laying text out rather than showing nothing.
- Then a release, not before.
- License notices: those of the BSD- and Unicode-licensed sources are in `LICENSE`; at the release, check their copyright lines against the engine builds its tables come from.
- File the collected browser bugs (ENGINE_FOLLOWUPS.md, External actions).
- The open demo and showcase issues (#94, #99, #150, #151, #152, #167).

## Open design questions

- Server-side measurement and other backends, such as React Native's: punted, not closed. Without `OffscreenCanvas`, Node and Bun need a Canvas supplied.
- Source offsets and carets for editing (#90, #198). Rich inline gives a materialized fragment's place in its item's `text` as passed, `\r\n` counting two (`sourceStart`, `sourceEnd`), which is what the editor on #90 asked for. Open: offsets for a plain text's lines, whose cursors count segments and graphemes of the prepared text; the way back, from an offset to a cursor or an x, for carets, hit testing and selection on Canvas (#198); whether bidi selection and copy stay outside Pretext; and whether a rich fragment range says its offsets too (End of project, the API discussion's list).
- A `word-break` and `white-space` per rich item: `prepareRichInline()` takes one of each for the paragraph, as a chat message or an editor sets them, where browsers take each item boundary's rule from the styles of the spans beside it, WebKit from the next span's (RESEARCH.md, Rich Inline Boundaries, Joined Text); and the paragraph's font, in which Chrome and Firefox count a pre-wrap span's tab stops (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
- Changing text (#313): a handle per paragraph, as README advises (#362); incremental preparation isn't worth building yet (RESEARCH.md, Dead Ends, Caching, State And API Designs).
- `system-ui` (#336): why the browsers differ, and what support would take.
- Automatic hyphenation (`hyphens: auto`): out of scope today, a possible feature.
- Intrinsic or logical-width APIs beyond `measureNaturalWidth()`.
- A slower diagnostic mode that leaves `layout()` alone (March 2026's attempt: RESEARCH.md, Dead Ends, The Measurement Model).
