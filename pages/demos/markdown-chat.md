# Markdown chat patterns

The [Markdown chat demo](https://chenglou.me/pretext/markdown-chat/) renders 10,000 distinct markdown messages with Pretext: exact heights before paint, only the messages on screen in the DOM, and the message you're reading held in place while the window resizes. Each pattern below says what a naive app does and what goes wrong, what the chat does, and when you can skip it. Pick the ones your app needs.

`markdown-chat.model.ts` parses, prepares and lays out without touching the DOM; `markdown-chat.ts` runs the frame loop and paints. "Show virtualization mask" makes the banners see-through, so you can watch rows come and go.

## What it costs

The chat prepares every message at startup and keeps them all:

| Messages | First message on screen | JS heap | Worst frame, a resize |
|---|---|---|---|
| 10,000 | 0.65-0.74 s | 48 MB | 7.9-13.1 ms |
| 100,000 | 4.9-5.4 s | 402 MB | 54.9-55.2 ms |

Installed Chrome 153 on an Apple M5 Max at a device pixel ratio of 2, in a 1280×900 frame with an 860 px chat. A frame is its main-thread task in Chrome's trace, and ranges span runs. Measured before [#325](https://github.com/chenglou/pretext/pull/325) simplified painting, which didn't change preparation or the height pass.

## Measure what you paint

**The model owns every value Pretext measures.** Writing typography twice, as canvas font strings for Pretext and as CSS for the page, drifts: the chat once measured links at weight 500 and painted them at 400 ([#264](https://github.com/chenglou/pretext/pull/264)). Each run of text carries a `TextStyle` from `resolveTextStyle()`. Pretext prepares with its `font` and `letterSpacing`, and `applyTextStyle()` paints the same values inline. Values CSS still needs, such as the code font and pill padding, go into root custom properties from the model's constants. Use named fonts, a page `lang` and whole-pixel sizes, for the reasons in README's [caveats](../../README.md#caveats).

**Padding counts as width; outlines take no room.** Padding around an inline piece such as a code span is width Pretext has to count, and a CSS `border` inside a width the model computed pushes the content in ([#279](https://github.com/chenglou/pretext/pull/279)). The chat passes padding as `extraWidth` (`createCodePiece()`, `createImagePiece()`), gives image chips `break: 'never'` so they stay whole, and draws outlines as inset `box-shadow`s. Skip it when nothing inside a measured width has padding or a border.

## Prepare once, lay out per width

**Prepare each block once.** Preparing measures text with canvas; layout is arithmetic over the widths it cached. `createPreparedChatMessages()` runs once, at startup. It lexes each message with `marked.lexer()` and prepares one text per block, since one paragraph's lines never depend on another's:

- paragraphs, headings and list items with `prepareRichInline()`, one item per run of same-styled text;
- code fences, tables and block HTML with `prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' })`;
- a hard break starts a new block, since rich inline text supports only `white-space: normal`.

Never prepare again for a new width.

**Heights from line counts; lines only for rows on screen.** `layoutConversation()` asks each block only for a line count, through `measureRichInlineStats()` or `layout()`. `layoutMessage()` walks one message's lines, only when its row is built or the chat width changes. Both wrap at `getBlockLineWidth()` and size blocks with `getBlockHeight()`, so painted lines match counted heights. Before [#286](https://github.com/chenglou/pretext/pull/286) the chat built every message's lines on each width change and allocated 11-14 MB, which pushed its slowest resize frames to 14-17 ms (in Node). Skip it when building every message's lines per width fits your frame.

**Heights and tops in typed arrays, without the page chrome.** `ConversationLayout` keeps every message's height and top in two `Float64Array`s, filled by one loop per chat width (`needsRelayout` in `render()`). Tops leave out the banners, so when the banners change height on short viewports, nothing is laid out again. Skip it when histories are small and nothing above the list changes height.

## The frame loop

**Events only schedule a frame.** Doing the work inside scroll and resize handlers reads and writes the DOM several times a frame, and handlers for different events race. The chat's listeners only record a fact and call `scheduleRender()`, which requests at most one animation frame. `render()` handles every input together. When nothing happens, no frame runs.

**Read, compute, write, then scroll.** `render()` reads the scroller's `clientWidth`, `clientHeight` and `scrollTop` once each. It computes the chat width, layout, anchor, target scroll position and visible range without touching the DOM. It writes the root custom properties, the canvas height and the rows. Last, and only if the position has to change, it calls `scrollTo()` and reads `scrollTop` back. The canvas height goes first, or the browser clamps the scroll to the old height. Interleaving reads and writes makes the browser lay out again at each read. Because the model's functions, such as `findVisibleRange()` and `findScrollAnchor()`, take numbers, the scroll logic can be tested in Node. Don't skip this one.

**Size from the scroller, with scrollbar room reserved.** A classic scrollbar, when macOS is set to always show scrollbars or in Chrome on Windows and Linux, takes about 15 px once content first overflows, and no `resize` event fires. Before [#283](https://github.com/chenglou/pretext/pull/283) the chat stayed 15 px too wide until the first scroll. `.chat-viewport` has `scrollbar-gutter: stable`, and `render()` reads that element's own `clientWidth`. A page that scrolls as a whole needs `html { scrollbar-gutter: stable }` and `document.body.clientWidth` instead. Overlay scrollbars take no room, but you can't count on them.

## Virtualize the rows

**Find the visible messages by binary search.** Looping over every message, reading row rectangles from the DOM, or `IntersectionObserver`, which only reports on mounted elements, doesn't scale. `findVisibleRange()` runs two binary searches over `tops`. Because tops leave out the banner, the top of the visible area is just `scrollTop`. At 100,000 messages a search takes 17 steps.

**Mount only the rows between the banners, and keep them.** `projectVisibleRows()` removes rows that left the range, writes each row's top, and inserts new rows before the first kept row, so DOM order stays message order. A row is its message's bubble: `renderMessageContents()` builds its contents when the row is created, and again only when the chat width changes. Every line, marker and box inside it is absolutely positioned from model values; CSS only paints. With no rows beyond the visible area, a scroll the browser paints before `render()` responds can show a blank edge; a margin of extra rows would cover small scrolls.

## Paint rich and mixed-direction text

**One line box per Pretext line.** Laying a line's styled pieces out as a flex row put a right-to-left paragraph's words in the wrong order ([#273](https://github.com/chenglou/pretext/pull/273)). `renderInlineBlock()` paints each Pretext line as one absolutely positioned `div` with `white-space: nowrap` and the paragraph's `dir`, and the browser orders the mixed-direction runs inside it. Pretext doesn't order mixed-direction text itself, so numbers or punctuation next to a line break can still come out differently than in a paragraph the browser wraps. Skip it when you paint each paragraph natively as one element; heights then depend on the browser's line breaks matching Pretext's.

**Paint each space in the element whose font measured it.** Where differently styled runs meet at a space, Pretext measures that space in one of their fonts, and a space in the code font is wider than one in the body font. Each rich inline fragment reports `gapItemIndex`, the item whose space comes before it, and `renderInlineBlock()` paints the space inside that item's element. Before [#310](https://github.com/chenglou/pretext/pull/310) words sat up to 3.53 px off native layout; now within 0.01 px. Skip it when every run on a line shares one font and letter spacing.

**Decide a paragraph's direction once.** `dir=auto` on separately painted lines flips any line of an Arabic paragraph that starts with an English word. `resolveDirection()` decides a paragraph's direction at preparation, from its first strong character, and code blocks and rules inherit it (`inheritDirection()`). A right-to-left block starts indents, markers, code boxes, rules and quote rails from the right, as the Arabic answer near the end of the thread shows ([#328](https://github.com/chenglou/pretext/pull/328)). In a chat, users choose the language, so don't skip it.

**Shrinkwrap bubbles in the same walk.** `layoutMessage()` finds a user bubble's width, its widest block plus padding up to a maximum, in the walk that builds the lines, with no search over widths. A rule counts only its indent, since it stretches across the final bubble ([#261](https://github.com/chenglou/pretext/pull/261)). Pretext's line widths leave out spaces that hang at a wrap, so code boxes don't stick out of the column ([#308](https://github.com/chenglou/pretext/pull/308)).

**Paint text, never HTML.** `marked.parse()` plus `innerHTML` runs any markup inside a message, since marked doesn't sanitize its output. The chat only lexes: every paint is `textContent` or a text node, raw HTML becomes text, and `parseMarkdownHref()` keeps a link only if it's an `http:` or `https:` URL. Skip it when the content is trusted.

## Keep the reading position

**Anchor a message when heights above it change.** On a width change, every message above the viewport rewraps. Before [#302](https://github.com/chenglou/pretext/pull/302), resizing slid the chat by up to 590 px in Chrome. The chat keeps an anchor: a message index, plus how far that message's top sits below the top banner. A `scrollTop` other than the value the last frame read back means the user scrolled, and `findScrollAnchor()` picks the first message whose top shows. Only when laying out again moves the anchored message's top does the chat scroll, to `tops[anchor.index] - anchor.offset`, and the browser keeps that inside the scroll range. Otherwise the position stays whatever it reads. Scrolling on every frame to a target clamped to the range pulled the chat back while iOS Safari bounced past either end, so it jittered instead of bouncing. Through resizes, the anchored message moved 0 px in Chrome 153 and Safari 26.5.2, and 0.07 px in Firefox 155. Only the anchor holds still: a message at mid-screen still moves. Skip it when nothing above the viewport changes height while someone reads.

**Store the scroll position the browser reports back.** Browsers round `scrollTop`, so the value read after `scrollTo()` can differ from the value asked for. Comparing against the requested value, or setting a "programmatic scroll" flag, mistakes rounding or your own scroll event for a user scroll. Adding each frame's height change to `scrollTop`, instead of starting from the anchor, lets that rounding add up.

**Open on the latest message.** `st.scrollAnchor` starts as `'end'`, so until the user scrolls, a width change keeps the last message showing. The first frame writes the canvas height and the last rows before its `scrollTo()`, so the first paint already shows the end. That needs exact heights: with estimates, the end keeps moving as real heights arrive.

## Not covered

- **Streaming a message.** Markdown isn't stable while it grows: a closing `**` or a later `===` line changes what came before. So re-lex the whole message on each token, and reuse the prepared blocks that didn't change. [Issue #313](https://github.com/chenglou/pretext/issues/313) has numbers.
- **Selection, find, keyboard and screen readers across rows that scroll out.** Unmounted rows don't exist, a wrapped link paints one `<a>` per fragment, and nothing was checked with a screen reader.
- **Web fonts that load late.** The chat uses installed fonts. A prepared handle keeps the widths it was measured with, so after a web font loads, call `clearCache()` and prepare again.
- **Layout in workers.** It isn't exact today: Pretext's emoji width correction measures a DOM span, and a worker has no DOM ([issue #292](https://github.com/chenglou/pretext/issues/292)).
- **Content Pretext can't size.** Images without known sizes, embeds and math need measuring after mount, plus anchoring.

## Tried and dropped

- **Estimated heights.** An estimate that's too large skips messages that are really on screen, the scrollbar thumb gets the wrong size, content jumps when real heights arrive, and a jump to a message lands off. Pretext gives exact heights before paint.
- **Correcting heights with `ResizeObserver`.** The heights arrive after the frame has painted, and Pretext already knows them.
- **Pooling DOM nodes.** At most 20 messages were on screen in 800 and 1,600 px tall viewports (in Node), so there's little to save, and reusing a node ties a selection or focus to whichever message gets it next.
- **A window over loaded chunks.** Draft [#312](https://github.com/chenglou/pretext/pull/312) prepared and laid out only chunks of messages around the screen, and left the rest out of the scroll area. Every painted frame stayed exact, and at 100,000 messages a resize took under 2 ms against about 55 ms. But the scrollbar covered only the loaded chunks and its thumb jumped on each load, which feels bad. A scrollbar that covers the whole history exactly needs every message's height at the current width, which is the chat's model.
