# Markdown chat patterns

The [Markdown chat demo](https://chenglou.me/pretext/markdown-chat/) renders 10,000 distinct markdown messages with Pretext: exact heights before paint, only the messages on screen in the DOM, and the message you're reading held in place while the window resizes. Each pattern says what a naive app does and what goes wrong, what the chat does, and when you can skip it; pick the ones your app needs.

The model, `markdown-chat.model.ts`, parses, prepares and lays out without touching the DOM; `markdown-chat.ts` runs the frame loop and paints. The scroller's top and bottom edges sit under two banners of page chrome, and its scroll content, as tall as the whole history plus both banners, is the "canvas" in the code. "Show virtualization mask" makes the banners see-through, so you can watch rows come and go.

## What it costs

The chat prepares every message at startup and keeps them all:

| Messages | First message on screen | JS heap | Worst frame, a resize |
|---|---|---|---|
| 10,000 | 0.65-0.74 s | 48 MB | 7.9-13.1 ms |
| 100,000 | 4.9-5.4 s | 402 MB | 54.9-55.2 ms |

Chrome 153, Apple M5 Max, device pixel ratio 2, a 1280×900 frame with an 860 px chat, 2026-09-15; a frame is its main-thread task in Chrome's trace, and ranges span runs. On an iPhone, 100,000 messages crashed iOS Safari (2026-09-16); the approach under Tried and dropped, A window over loaded chunks, didn't. None of this was measured again after [#325](https://github.com/chenglou/pretext/pull/325) simplified painting and [#338](https://github.com/chenglou/pretext/pull/338), [#340](https://github.com/chenglou/pretext/pull/340) and [#344](https://github.com/chenglou/pretext/pull/344) sped up Pretext.

## Measure what you paint

**The model owns every value Pretext measures.** Typography written twice, as canvas font strings and as CSS, drifts: the chat once measured links at weight 500 and painted them at 400 ([#264](https://github.com/chenglou/pretext/pull/264)). Each run of text carries a `TextStyle` from `resolveTextStyle()`: Pretext prepares with its `font` and `letterSpacing`, and `applyTextStyle()` writes the font to a `--font` custom property and the letter spacing inline; the chat's CSS applies `font: var(--font)` and then `line-height`, since the `font` shorthand resets it. Values CSS still needs, such as the code font and pill padding, go into root custom properties from the model's constants. Use named fonts, a page `lang` and whole-pixel sizes (README's [caveats](../../README.md#caveats)).

**Padding counts as width; outlines take no room.** Padding around an inline piece such as a code span is width Pretext must count, and a CSS `border` inside a width the model computed pushes the content in ([#279](https://github.com/chenglou/pretext/pull/279)). The chat passes padding as `extraWidth` (`createCodePiece()`, `createImagePiece()`), gives image chips `break: 'never'` so they stay whole, and draws outlines as inset `box-shadow`s. Skip it when nothing inside a measured width has padding or a border.

## Prepare once, lay out per width

**Prepare each block once.** Preparing measures text with canvas; layout is arithmetic over the widths it cached, so never prepare again for a new width. `createPreparedChatMessages()` runs once, at startup: it lexes each message with `marked.lexer()` and prepares one text per block, since one paragraph's lines never depend on another's:

- paragraphs, headings and list items with `prepareRichInline()`, one item per run of same-styled text;
- code fences, tables and block HTML with `prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' })`;
- a hard break starts a new block, since rich inline text in `white-space: normal` has no line break item.

**Heights from line counts; lines only for rows on screen.** `layoutConversation()` asks each block only for a line count, through `measureRichInlineStats()` or `layout()`; `layoutMessage()` walks a message's lines only when its row is built or the chat width changes. Both wrap at `getBlockLineWidth()` and size blocks with `getBlockHeight()`, so painted lines match counted heights. Before [#286](https://github.com/chenglou/pretext/pull/286) the chat built every message's lines on each width change, allocating 11-14 MB, and its layout work per resize took 14-17 ms, measured in Node. Skip it when building every message's lines per width fits your frame.

**Heights and tops in typed arrays, without the page chrome.** `ConversationLayout` keeps every message's height and top in two `Float64Array`s, filled by one loop per chat width (`needsRelayout` in `render()`). Tops leave out the banners, so nothing is laid out again when the banners change height on short viewports. Skip it when histories are small and nothing above the list changes height.

## The frame loop

**Events only schedule a frame.** Work inside scroll and resize handlers reads and writes the DOM several times a frame, and handlers for different events race. The chat's listeners only record a fact and call `scheduleRender()`, which requests at most one animation frame, where `render()` handles every input together; when nothing happens, no frame runs.

**Read, compute, write, then scroll.** Interleaved reads and writes make the browser lay out again at each read. `render()` reads the scroller's `clientWidth`, `clientHeight` and `scrollTop` once each; computes the chat width, layout, anchor, target position and visible range without the DOM; writes the root custom properties, the scroll content's height and the rows; and only then, if the position must change, calls `scrollTo()` and reads `scrollTop` back. The height goes first, or the browser clamps the scroll to the old height. The model's functions (`findVisibleRange()`, `findScrollAnchor()`) take numbers, so the scroll logic is testable in Node. Don't skip this one.

**Size from the scroller, with scrollbar room reserved.** A classic scrollbar (macOS set to always show them, or Chrome on Windows and Linux) takes about 15 px once content first overflows, with no `resize` event; before [#283](https://github.com/chenglou/pretext/pull/283) the chat stayed 15 px too wide until the first scroll. `.chat-viewport` has `scrollbar-gutter: stable`, and `render()` reads its own `clientWidth`; a page that scrolls as a whole needs `html { scrollbar-gutter: stable }` and `document.body.clientWidth` instead. Overlay scrollbars take no room, but you can't count on them.

## Virtualize the rows

**Find the visible messages by binary search.** Looping over every message, reading row rectangles from the DOM, or `IntersectionObserver`, which only reports on mounted elements, doesn't scale. `findVisibleRange()` runs two binary searches over `tops`, 17 steps each at 100,000 messages; since tops leave out the banners, the visible area's top is just `scrollTop`.

**Mount only the rows between the banners, and keep them.** `projectVisibleRows()` removes rows that left the range, writes each row's top, and inserts new rows before the first kept one, so DOM order stays message order. A row is its message's bubble, whose contents `renderMessageContents()` builds on creation and again only when the chat width changes; every line, marker and box inside is absolutely positioned from model values, and CSS only paints. The chat mounts no rows beyond the visible area, so a scroll the browser paints before `render()` responds can show a blank edge; mount a margin of extra rows if blank edges matter.

## Paint rich and mixed-direction text

**One line box per Pretext line.** A line's styled pieces laid out as a flex row put a right-to-left paragraph's words in the wrong order ([#273](https://github.com/chenglou/pretext/pull/273)). `renderInlineBlock()` paints each Pretext line as one absolutely positioned `div` with `white-space: nowrap` and the paragraph's `dir`, and the browser orders the mixed-direction runs inside it. Pretext doesn't order mixed-direction text itself, so numbers or punctuation next to a line break can still come out differently than in a paragraph the browser wraps. Skip it when you paint each paragraph natively as one element; heights then depend on the browser's breaks matching Pretext's.

**Paint each space in the element whose font measured it.** Where differently styled runs meet at a space, Pretext measures it in one of their fonts, and a code-font space is wider than a body-font one. Each rich inline fragment reports `gapItemIndex`, the item whose space comes before it, and `renderInlineBlock()` paints the space inside that item's element. Before [#310](https://github.com/chenglou/pretext/pull/310) words sat up to 3.53 px off native layout; now within 0.01 px. Skip it when every run on a line shares one font and letter spacing.

**Decide a paragraph's direction once.** `dir=auto` on separately painted lines flips any line of an Arabic paragraph that starts with an English word. `resolveDirection()` decides it at preparation, from the first strong character, and code blocks and horizontal rules (`---`) inherit it (`inheritDirection()`). A right-to-left block starts indents, markers, code boxes, horizontal rules and blockquote bars from the right, as the Arabic answer near the end of the thread shows ([#328](https://github.com/chenglou/pretext/pull/328)). In a chat, users choose the language, so don't skip it.

**Shrinkwrap bubbles in the same walk.** `layoutMessage()` finds a user bubble's width, its widest block plus padding up to a maximum, in the walk that builds the lines, with no search over widths. A horizontal rule counts only its indent, since it stretches across the final bubble ([#261](https://github.com/chenglou/pretext/pull/261)). Pretext's line widths leave out spaces that hang at a wrap, so code boxes don't stick out of the column ([#308](https://github.com/chenglou/pretext/pull/308)).

**Paint text, never HTML.** `marked.parse()` plus `innerHTML` runs any markup inside a message, since marked doesn't sanitize its output. The chat only lexes: every paint is `textContent` or a text node, raw HTML becomes text, and `parseMarkdownHref()` keeps a link only if it's an `http:` or `https:` URL. Skip it when the content is trusted.

## Keep the reading position

**Anchor a message when heights above it change.** On a width change every message above the viewport rewraps; before [#302](https://github.com/chenglou/pretext/pull/302), resizing slid the chat by up to 590 px in Chrome. The anchor is a message index plus how far its top sits below the top banner. A `scrollTop` other than what the last frame read back means the user scrolled, and `findScrollAnchor()` picks the first message whose top shows, or else the one covering the top edge (a message taller than the screen). The chat scrolls only when laying out again moves the anchored message's top, to `tops[anchor.index] - anchor.offset`, which the browser keeps in range; otherwise it leaves the scroll position alone. Only the anchored message is held in place, so a message at mid-screen still moves (measured through resizes on 2026-09-15: the anchored message moved 0 px in Chrome 153 and Safari 26.5.2, 0.07 px in Firefox 155). Skip it when nothing above the viewport changes height while someone reads.

**Store the scroll position the browser reports back.** Browsers round `scrollTop`, so the value read after `scrollTo()` can differ from the one asked for. Comparing against the requested value, or setting a "programmatic scroll" flag, mistakes rounding or your own scroll event for a user scroll, and adding each frame's height change to `scrollTop`, instead of starting from the anchor, lets the rounding add up. RESEARCH.md's [Scrolling And Scrollbars](../../RESEARCH.md#scrolling-and-scrollbars) has how each browser rounds, bounces and shows classic scrollbars, and the largest scroll height each browser allows.

**Open on the latest message.** The chat's anchor state (`st.scrollAnchor` in `markdown-chat.ts`) starts as `'end'`, so until the user scrolls, a resize keeps the last message showing; after that the anchor is always a message, even at the bottom. The first frame writes the scroll content's height and the last rows before its `scrollTo()`, so the first paint already shows the end. That needs exact heights: with estimates, the end keeps moving as real heights arrive.

## Not covered

- **Streaming a message.** Markdown isn't stable while it grows (a closing `**` or a later `===` line changes what came before), so re-lex the whole message on each token and reuse the prepared blocks that didn't change. [Issue #313](https://github.com/chenglou/pretext/issues/313) has numbers.
- **Selection, find, keyboard and screen readers across rows that scroll out.** Unmounted rows don't exist, a wrapped link paints one `<a>` per fragment, and the chat hasn't been tested with a screen reader.
- **Web fonts that load late.** The chat uses installed fonts; a prepared handle keeps the widths it was measured with, so after a web font loads, call `clearCache()` and prepare again.
- **Layout in workers.** The chat lays out on the main thread. `setLocale()` gives a worker the page's language ([#356](https://github.com/chenglou/pretext/pull/356)) and `setDevicePixelRatio()` its device pixel ratio, which emoji widths in Chrome and Firefox on macOS depend on ([issue #292](https://github.com/chenglou/pretext/issues/292)).
- **Content Pretext can't size.** Images without known sizes, embeds and math need measuring after mount, plus anchoring.

## Tried and dropped

- **Estimated heights.** An estimate that's too large skips messages really on screen, sizes the scrollbar thumb wrong, makes content jump when real heights arrive, and lands a jump to a message off. Pretext gives exact heights before paint.
- **Correcting heights with `ResizeObserver`.** The heights arrive after the frame has painted, and Pretext already knows them.
- **Pooling DOM nodes.** At most 20 messages were on screen in 800 and 1,600 px tall viewports (computed from the model's heights in Node), so there's little to save, and reusing a node ties a selection or focus to whichever message gets it next.
- **Scrolling to the anchor every frame.** iOS Safari reports positions past either end while it rubber-bands, and a scroll every frame to a target clamped to the valid range pulled the chat back, so it jittered instead of bouncing.
- **A window over loaded chunks.** Draft [#312](https://github.com/chenglou/pretext/pull/312) prepared and laid out only chunks around the screen, leaving the rest out of the scroll area. Every painted frame stayed exact and a 100,000-message resize took under 2 ms against about 55 ms, but the scrollbar covered only the loaded chunks and its thumb jumped on each load, so its position and size didn't match the history. An exact scrollbar over the whole history needs every message's height at the current width, which is what the chat computes. In Safari, its `scrollTo()` after loading a chunk above also raced wheel scrolling and skipped up to 28 messages ([PLATFORM_BUGS.md](../../PLATFORM_BUGS.md#safari-wheel-scrolling-after-a-pages-scrollto)). At 100,000 messages it didn't crash iOS Safari, where the chat did (2026-09-16).
- **Spreading a resize over several frames** showed 5-8 frames of a wrong scrollbar, and **layout in web workers** took 10-12 ms a resize but the most code, 1-2 GB of memory and inexact emoji. RESEARCH.md's [The Markdown Chat At Scale](../../RESEARCH.md#the-markdown-chat-at-scale) has these and the other ideas tried at 100,000 messages, with their numbers.
