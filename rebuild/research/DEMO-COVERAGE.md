# Demo and use-case coverage (2026-09-18)

No demo is fully served by the rebuild today. This was a read-only pass: no browser jobs were run, nothing was written outside my scratch folder, and no git command was run.

**The rebuild today** (`rebuild/src/index.ts:39-106`, `model.ts:252-331`) is:
- a prepared tree of inline content;
- `layoutLine(prepared, start, slot)`, which returns a line or below-floats (the engine moved the line past the slot's floats). A line carries its source range, fragments with painted text and run/element indices, engine-unit geometry and `next`;
- `paintLines`, which returns one div per line.

Box edges, atomic inlines, `br` and `wbr` work in all three ports.

Missing: a line count, any CSS-px width, a natural width (a text's unwrapped single-line width), and access to break opportunities.

**Per demo** (`~/github/pretext/pages/demos`)

1. accordion (`accordion.ts:71, 201`):
   - Asks: 4 texts prepared once; `layout()` ×4 per resize or click frame. It reads `height` and `lineCount`, and the browser paints.
   - Gap: a count at a new width. Width is a Paragraph field given at prepare (`model.ts:230`), though the ports read it only at line time (`blink/line-breaker.ts:163`, `webkit/lines.ts:2377`, `gecko/lines.ts:1095`).
2. masonry (`masonry/index.ts:80, 117-118`):
   - Asks: 1,904 cards, `layout()` on all of them every scroll and resize frame; native paint.
   - Gap: the same count gap, at volume.
3. bubbles (`bubbles-shared.ts:60-88`):
   - Asks: 7 texts; per frame, two walks for the widest line and a ~9-step binary search on `lineCount`. It sets the DOM width to `ceil(widest)` and the browser wraps.
   - Gaps: count; widest line in CSS px (a formula in `DESIGN.md:772-781`, no code).
4. dynamic-layout (`dynamic-layout.ts:249-255, 280-346, 483-501, 758`):
   - Asks: a ~10k-char body through two columns with a carried cursor, one slot per row, re-laid every frame while a logo spins.
   - Also: a headline font-size search asking "did a line end inside a word"; a natural width for the credit; title line widths as obstacles.
   - Paints absolute spans with `textContent`.
   - Gaps: how a line ended, CSS-px width, natural width.
5. editorial-engine (`editorial-engine.ts:404-483, 869`):
   - Asks: the same, ~11k chars at 60 fps all the time, several slots per row (`:452-477`; fine, one `layoutLine` per slot).
   - Gap: the body starts after the drop cap at grapheme 1. A `LineStart` only comes from `firstLineStart` or `line.next`, so the app would slice the text.
6. justification-comparison (`.model.ts:245-289, 293-351`; `.ui.ts:105-142, 303-345`):
   - Asks: reads `prepared.segments` and `prepared.widths` to build break candidates and prefix sums, and runs its own Knuth-Plass line breaker over them. It paints words with Canvas `fillText` at its own x. Its CSS column reads a DOM Range rect per space.
   - Gap, the largest: no break opportunities, no width of a candidate line, no way to end a line where the app says.
7. rich-note (`rich-note.model.ts:155-209`, `rich-note.ts:81-118`):
   - Asks: ~25 items, chips as `break:'never'` plus `extraWidth`, relayout per slider frame. It paints one div per line and a span or `<a>` per fragment, with the collapsed space placed by `gapItemIndex`.
   - The tree serves the layout.
   - Gap: `paintLines` gives its spans no identity (no class, data attribute or callback in `paint.ts`), so hrefs, chip colours and atomic contents can't be attached.
8. markdown-chat (`markdown-chat.model.ts:524-557, 798, 867-881, 929-945`; `markdown-chat.md:9-36`):
   - Asks: 10,000 messages, every block prepared at startup and kept (0.65-0.74 s, 48 MB). Per width change it needs a count for every block, 7.9-13.1 ms in all, and lines only for the ~20 rows on screen.
   - Also: bubble width from the widest line; marker natural widths; pre-wrap code.
   - Gaps: count; painter identity; one measurer for all paragraphs. `index.ts:40` makes a measurer per paragraph, with its own Canvas contexts and a call log that only grows (`measure/canvas.ts:46-93`).
   - The demo doesn't stream (`markdown-chat.md:74`).
9. variable-typographic-ascii (`:90-93`):
   - Asks: `prepared.widths[0]` of a few hundred single characters.
   - Gap: natural width.

`wrap-geometry.ts` calls no library function. No demo reads vertical metrics, per-fragment widths (`occupiedWidth`, `gapBefore`) or bidi levels. Every height is `lineCount × lineHeight`, which the rebuild's fixed `lineHeight` matches.

**Cost** (smoke run `.artifacts/bench/smoke-20260917`; background windows, so rough; 592-unit Latin paragraph, 20 widths):
- main takes 37.7 µs and makes 0 Canvas calls.
- The rebuild in Chrome takes 61.6 ms, and 575 of its 777 Canvas calls come after prepare.
- At 15,000 units, one width costs about 75 ms in Chrome, which is ×194 main. Firefox is ×13.7 and webkit-host ×1.96. Editorial has 16 ms per frame.
- Blink's line output measures a prefix per glyph cluster (`blink/index.ts:636-657`), which no demo reads.

**Smallest capability set**
- a. Prepare once; width per layout.
- b. Line count at a width, without line objects.
- c. Line width, widest line and natural width in CSS px.
- d. Line by line with a slot and a carried start, refusal included (exists).
- e. Painted text per piece, mapped to the app's runs and elements (exists as data).
- f. How a line ended: opportunity, inside a word, hyphen, forced, end of text.
- g. Break opportunities with kinds; the width of a line from A to B (trimmed spaces, hyphen, justifiable spaces); a start at a given offset.
- h. Painter: identity per element, atomic contents, update in place. For Canvas or SVG: visual runs with x, width and level in CSS px.
- i. One measurer across paragraphs, reset when fonts load.

**Shapes the core if added late** (these must be kept in mind during the re-architecture)
- b. Each port's line loop must find a break without building fragments and geometry, and a new width should need no new Canvas call in the common case. Today `nextLine` fuses them (`engines/engine.ts:12-17`).
- g. Each port's "next opportunity" and "close the line here" must stay callable outside the greedy loop, and a `LineStart` must be constructible from a source offset.
- Appending text to a prepared paragraph would shape it too; no demo needs it.

Thin layers on top: a (the ports read the width only at line time), c, f, h, i, and a line's text from its fragments.

**Simpler or better under the rebuild**
- dynamic-layout, editorial: slots are the engines' own float model. A sliver refuses the line instead of breaking inside a word, so the minimum-slot filters (`wrap-geometry.ts:154`, `editorial-engine.ts:19`) can go.
- rich-note, chat:
  - The tree replaces `extraWidth`, `break:'never'`, `gapItemIndex` and the split at hard breaks.
  - Bidi levels and the painter's override spans remove the caveat at `README.md:220`.
  - One visible change: box edges follow `box-decoration-break: slice`, whereas main charges `extraWidth` on every fragment (`src/rich-inline.ts:765`).
- justification: `'justify'` geometry holds the browser's own space widths, so the CSS column needs no Range reads.
- accordion, masonry, bubbles, chat: nothing gets simpler. The ports' exact fit tests make native wrapping at a computed width agree by construction.

**Table** (ok = needed and served today; gap = needed and missing; - = not needed)

| Demo | a width per layout | b count only | c px widths, natural | d slots + carried start | e text → source | f line-end kind | g breaks, A-B width, offset start | h painter identity / px runs | i shared measurer |
|---|---|---|---|---|---|---|---|---|---|
| accordion | gap | gap | - | - | - | - | - | - | - |
| masonry | gap | gap | - | - | - | - | - | - | gap |
| bubbles | gap | gap | gap | - | - | - | - | - | - |
| dynamic-layout | gap | - | gap | ok | ok | gap | - | - | - |
| editorial-engine | gap | - | gap | ok | ok | gap | gap (offset start) | - | - |
| justification-comparison | gap | - | gap | - | ok | - | gap | gap (px runs) | - |
| rich-note | gap | - | - | - | ok | - | - | gap | - |
| markdown-chat | gap | gap | gap | - | ok | - | - | gap | gap |
| variable-typographic-ascii | - | - | gap | - | - | - | - | - | - |

Scratch draft: `/private/tmp/claude-501/-Users-chenglou-github-pretext/7e07dee5-fc27-4046-b679-3f61a43f7436/scratchpad/demo-coverage/report.txt`
