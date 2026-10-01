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
  - `extraWidth` on a rich item split across lines: today every piece is charged all of it, as CSS `box-decoration-break: clone` pads, where browsers default to `slice`, which pads only the outer ends; perhaps CSS's names at the release, `paddingInline: [start, end]` with `boxDecorationBreak`, so neither meaning is silent (#382). With it, whether a non-finite `extraWidth` throws, as a non-finite `letterSpacing` (#356) and box width (#387) do: today `NaN` or `Infinity` is taken as given and lays out wrongly without an error;
  - what `PreparedTextWithSegments` makes public: README documents `segments` and `kinds`, but the type also exposes the line walkers' own arrays, which two demos read (`widths`) (`src/layout.ts`);
  - rich inline as one analysis of the paragraph cut at item boundaries, in place of each item's own analysis patched toward the joined text, which needs fragment cursors that don't index each item's own prepared text (RESEARCH.md, Rich Inline Boundaries, Continuing The Line; not prototyped);
  - how a browser whose Canvas lacks what its profile needs degrades, still laying text out rather than showing nothing.
- Then a release, not before.
- License notices for the ported engine code and data.
- File the collected browser bugs (ENGINE_FOLLOWUPS.md, External actions).
- The open demo and showcase issues (#94, #99, #150, #151, #152, #167).
- The bubbles demo stacks its bubbles with CSS flow (`pages/demos/bubbles.html`: `.chat` is a flex column), Pretext giving only each bubble's width: place them from Pretext's heights, as the Markdown chat does, or say so in the demo. Asked by the maintainer in March 2026, never settled.
- Real chat text for the harness's sample, whose chat and AI-reply draws, 65% of its weight, are stand-ins: WildChat-1M (ODC-BY) and OpenAssistant oasst2 (Apache-2.0) allow redistribution with attribution, and downloading them waits for the maintainer's OK (`harness/sets/weights.json`, `notCheckedIn`).
- The Chrome hang report's page: check that no public branch or tag cut from the per-engine rebuild still holds it at its tip (`git ls-tree -r` over the refs `git ls-remote origin` lists), then move or remove one that does, or leave it as the history is left (RESEARCH.md, Merge Bars And Landing).

## Open design questions

- Server-side measurement and other backends, such as React Native's: punted, not closed. Without `OffscreenCanvas`, Node and Bun need a Canvas supplied.
- Source offsets and carets for editing rich text (#90, #198); whether bidi selection and copy stay outside Pretext. Rich `pre-wrap` (#381) didn't remove the need: the editor that asked for it still prepares each item again to turn a fragment's cursor into a text offset, and offsets shift where `\r\n` is one break (its comment on #90, 2026-09-30, not yet answered).
- A `word-break` and `white-space` per rich item: `prepareRichInline()` takes one of each for the paragraph, as a chat message or an editor sets them, where browsers take each item boundary's rule from the styles of the spans beside it, WebKit from the next span's (RESEARCH.md, Rich Inline Boundaries, Joined Text); and the paragraph's font, in which Chrome and Firefox count a pre-wrap span's tab stops (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
- Changing text (#313): a handle per paragraph, as README advises (#362); incremental preparation isn't worth building yet (RESEARCH.md, Dead Ends, Caching, State And API Designs).
- `system-ui` (#336): why the browsers differ, and what support would take.
- Automatic hyphenation (`hyphens: auto`): out of scope today, a possible feature.
- Intrinsic or logical-width APIs beyond `measureNaturalWidth()`.
- A slower diagnostic mode that leaves `layout()` alone (March 2026's attempt: RESEARCH.md, Dead Ends, The Measurement Model).
