# Pretext rebuild: design

Status, 2026-09-19, branch `rebuild-20260916`, after the re-architecture (research/ARCHITECTURE-PLAN-2.md; §8.3 has the
order things landed in). This document describes the library as it is. Correctness is where the correctness line froze
it on 2026-09-18, with the fixes recorded since (REPORT.md "The correctness line"; lab/README.md "Test tiers"): the
re-architecture moved no prediction that it didn't account for row by row. What comes next is profiling
(research/PROFILING-START.md has where it starts), and the shape of the public API after that. `tsc` is clean over the
six projects under `rebuild`, and `bun test rebuild` passes.

The library takes a styled paragraph, a tree of inline content with facts about its fonts, and the environment it will
be drawn in. It computes the lines the installed browser's own layout produces, one line slot at a time, the way that
engine represents them: where each line breaks, the engine's items, boxes or frames with their advances and positions in
the engine's units, the line widths the engine computes, and which content was trimmed, collapsed or hangs. It measures
only with Canvas `measureText`. It reads nothing from the DOM for widths and loads no font files. A painter turns the
lines into DOM elements the browser draws without wrapping them again. The lab derives what the browser reports through
Range and element geometry from the same output, by porting each engine's geometry code (§9), and compares exactly.

**Correct** means equal to the installed browser, identified by its app bundle version:

- Chrome 153.0.8010.48 (Blink, ICU 78.2 from Chrome's `icudtl.dat`);
- Safari 27.0 on WebKit.framework 22625.1.29.11.27 (source tag WebKit-7625.1.29.11.27, macOS 27 `libicucore` 78.1),
  which webkit-host shares;
- Firefox 156.0 (Gecko, ICU4X `icu_segmenter` 2.1.2 with Firefox's baked data).

The rules come from each engine's source and data at those versions (`specs/*.md`), or from recorded probe verdicts,
never from UAX #14 defaults, float tolerances or lab counts. Where Canvas can't supply what the DOM uses, the design
handles it with a recipe, takes the missing fact as an input, or reports a named gap (§5). Correctness came first and
simplicity second; performance is the phase that starts now, from numbers (§4.7, research/PROFILING-START.md).

## How the library is built

Three engine ports that barely touch each other, and a small shared layer that names no engine. Every port gives the
same six functions over its own types (§2.9, §3), and `src/index.ts` is the one place that chooses a port:

```ts
prepare(paragraph, env, inspect): Prepared        // width-free: content, items, break data, the widths known before lines
firstLine(prepared): Start | null
fillLine(prepared, start, slot): FillResult       // decides one line in one slot, or refuses the slot (below floats)
linePieces(prepared, line): LinePieces<Facts>     // what a painter takes; a pure function
inspectLine(prepared, line): { geometry, gaps }   // what the lab reads; a pure function; inspected paragraphs only
paragraphGaps(prepared): Gap[]                    // inspected paragraphs only
```

**Data and lifetimes.** Values that share a lifetime sit in one object, and there are few lifetimes:

| Data | What it holds | Made by | Lives as long as | Depends on the width |
|---|---|---|---|---|
| Input | the `Paragraph` tree (§1.1), the `Environment` (§1.4), a `LineSlot { width, left, right }` per line (§2.9) | the caller | the caller's scope | the slot only |
| Prepared paragraph | the engine's content, items, styles and break data, the widths it knows before filling lines, its Canvas contexts (§4.6), the environment, and `inspect`: a record on a paragraph prepared for inspection, null on a plain one | `prepare` | the caller keeps it | no: one prepared paragraph serves any width |
| Line start | where the next line starts: small plain data that names positions in the prepared paragraph's lists and holds nothing of it (§2.7) | `firstLine`, a fill result's `next` | the caller's scope; it survives JSON | no |
| Decided line | the engine's own record of one filled line (Blink's `LineInfo` with its results, WebKit's closed `Line` with its rect, Gecko's last reflow pass), and on an inspected paragraph the gaps its filling raised, in order | `fillLine` | the caller's scope; counting lines drops it | yes |
| Pieces | fragments, `joinsNextLine`, `indented`, `align`, `overflows`, the engine's facts for its painting rules (§2.1, §2.2) | `linePieces` | the caller's scope | yes |
| Inspection | the engine's geometry of the line (§2.3-§2.5) and the gaps its breaks decide (§2.8) | `inspectLine` | the lab's row | yes |
| Row | the frozen `ParagraphLayout` JSON a lab prediction keeps (§2.1) | the lab's adapter, `lab/predictor-core.ts` | the lab | yes |

- A value derived from a line is computed in the scope that asks for it and is never stored on the line: nothing writes
  a decided line after `fillLine` returns it, and `linePieces` and `inspectLine` give the same result twice and in either
  order (`tests/function-set.ts pure`).
- Nothing writes a prepared paragraph after `prepare`, with four exceptions. All are facts of the text and its fonts,
  which no width and no line changes, filled on first read only because asking earlier would ask Canvas questions no
  line needs and would move the order of first asks; they go with the paragraph. The list of contexts grows where a
  recipe first asks in a context of its own (Blink's one-byte contexts in a segmented paragraph, §4.2; the contexts of
  Gecko's in-word recipes, §4.6, each kept from then on by the record its text runs share). A Blink style keeps two
  lazy answers (those one-byte contexts, and whether Canvas shapes its font word by word; §3). A Gecko shaping unit
  keeps what measuring found inside it (§4.6). Since correctness round 5 a Gecko prepared paragraph also keeps what
  Canvas told of each context's pair placement (on the same record since the fresh-eyes follow-up), an accepted
  exception written down in §4.6. The round's other exception, an offset's record that could hold a rough advance
  before the whole one, went with the lazy plain scan in the profiling phase (§4.6).
- Nothing handed to the caller aliases prepared data: a line start is plain data, and pieces are made for their line
  (research/INCREMENTAL-API-READING.md §4; its appendix lists every prepared fact that reads across a forced break or
  over the whole text, which is what a later incremental API has to know).

**One home per cross-cutting concern.** What used to cut across the ports has one place each:

- *Gaps.* A paragraph is prepared plain or inspected, decided once in `prepare` and held as `prepared.inspect`; nothing
  else says which. A plain paragraph, what an application runs, computes no gap, no limit and none of the lab's geometry,
  and asks Canvas nothing that only those read. In each port every gap condition with its test, prose, merge rule and
  order is in `engines/<engine>/gaps.ts`, behind functions that take a sink first and return at once when it is null
  (§2.8, §5).
- *Measured values.* `width(context, text)` and `bounds(context, text)` always ask Canvas. No structure stores a
  measured value by its string; what a port needs twice it keeps as a local, hands from the step that measured it to the
  step that uses it, or sets as a field where `prepare` already measures (§4.6). What that costs in repeated questions,
  and the stores that profiling may bring back, is §4.7.
- *What only the lab reads* is output on request: `inspectLine` and `paragraphGaps`. The row's format, the slot loop and
  the observation contract are the lab's own (`lab/types.ts`, `lab/predictor-core.ts`, `lab/observe/contract.ts`).
- *Engine names.* Outside comments, only `src/index.ts` (the dispatch) and `src/env.ts` (whose shape is per engine)
  name an engine, no engine imports another, and the lab imports library logic in its adapter alone
  (`tests/independence.test.ts`). Where engines differ by data, the shared module takes the data as a parameter (§3);
  the painter takes each engine's painting rules as a value (§7).

**What stays possible.** Two capabilities would reshape the core if they were added late, so the ports keep their seams
(research/DEMO-COVERAGE.md, research/CAPABILITY-CHECK.md): a line's break is found without building fragments or
geometry, and a layout at another width asks Canvas nothing new in the common case (§2.9; Blink asks its positions
again at every fill, which is cost, §4.7); and each port's "next break opportunity" and "close the line here" stay
callable outside the greedy line loop, with a line start that can be made from a source offset. No API is built for
either yet.

Terms used throughout:

- **Text leaf**: a DOM text node in the paragraph's tree. `run` indexes the leaves in document order.
- **Element**: a span, atomic inline, `<br>` or `<wbr>` in the tree. `element` indexes them in document order, the block
  excluded.
- **Source offset**: a UTF-16 offset into the concatenation of all text leaves in document order. Fragments and line
  ranges use these.
- **Box edge**: one inline side of a span's box: its margin, border width and padding.
- **Line slot**: what floats take off the paragraph's content box at one line box, as two insets (§2.9).
- **Engine**: `blink`, `webkit` or `gecko`.
- **Text content**: the string an engine lays out after white-space processing: Blink's `text_content`, WebKit's text
  box content, Gecko's transformed text. Engines map its offsets back to source offsets.
- **Break opportunity**: an offset in the text content where a line may end.
- **Engine units**: what a layout engine stores widths in. Blink: `LayoutUnit`, an int32 counting 1/64 of a zoomed px,
  built from 16.16 glyph advances and float32 shape widths. WebKit: float32 CSS px. Gecko: app units, integers counting
  1/60 CSS px.
- **Geometry**: what an engine places on a line: Blink's fragment items, WebKit's display boxes, Gecko's frames.
- **Font fact**: something about a realized font that an engine reads and no measured width of the paragraph's text
  shows, such as the monospace trait (§1.2).
- **Given fact**: something about the browser or the document that no page API shows, such as the build or Chrome's
  application locale (§1.4).
- **Gap**: a known case where Canvas or a missing fact can't give what the DOM uses, so a prediction may be wrong (§5).
- `specs/<engine>-<topic>.md §n` cites the engine specs. `H<n>` is a hypothesis listed at the end of a spec. `CRITIC.md`
  settles some spec contradictions from source. `research/observe-<engine>.md` are the observation models,
  `research/RULES.md` the rule catalogue, `research/TENTPOLES-CRITIC.md` their critique. Source citations name files
  under the pinned checkouts in `~/github/browser-engines`.

Installed-browser verdicts override spec claims. `specs/PROBES.md` collects the verdicts of 2026-09-16: installed Chrome
153, webkit-host, installed Firefox 156, and the later run in installed Safari 27.0. Every refuted claim has a note in
its spec. Where this design depends on a hypothesis still open, it names it, and a contradicting verdict means the
section here changes.

## 1. Input

### 1.1 Paragraph and inline content

The types are in `src/model.ts`.

```ts
type CssFont = { family: string; size: number; weight: number; style: 'normal' | 'italic' }
type FontDecl = CssFont & { facts: FontFacts }                    // §1.2
type TextStyleOf<Font> = {
  font: Font; letterSpacing: number; wordSpacing: number
  whiteSpace: 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
  wordBreak: 'normal' | 'break-all' | 'keep-all' | 'break-word'
  overflowWrap: 'normal' | 'break-word' | 'anywhere'
  lineBreak: 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
  tabSize: number
}
type BoxEdge = { margin: number; border: number; padding: number }
type InlineNodeOf<Font> =
  | { kind: 'text'; text: string }
  | TextStyleOf<Font> & {
      kind: 'span'; lang: string | null; inlineStart: BoxEdge; inlineEnd: BoxEdge
      verticalAlign: 'baseline' | '0px'; children: InlineNodeOf<Font>[]
    }
  | { kind: 'atomic'; width: number; height: number; marginInlineStart: number; marginInlineEnd: number }
  | { kind: 'br' }
  | { kind: 'wbr' }
type ParagraphOf<Font> = TextStyleOf<Font> & {
  content: InlineNodeOf<Font>[]; lang: string; direction: 'ltr' | 'rtl'
  lineHeight: number
  textIndent: number; textAlign: 'start' | 'end' | 'left' | 'right' | 'center' | 'justify'
}
type Paragraph = ParagraphOf<FontDecl>                            // what the library takes
```

The block's content-box width isn't the paragraph's: it belongs to the slot each line is filled in (§2.9). A lab case
keeps it on its own paragraph (`lab/types.ts`), and the lab's adapter gives it to every slot.

A paragraph stands for one block element and its inline content: `<div lang style="…">content</div>`. The block and
every span carry their computed inherited properties written out, the ones that decide lines: font, letter and word
spacing, `white-space`, `word-break`, `overflow-wrap`, `line-break` and `tab-size`. The library never computes
inheritance. A span whose author set nothing carries its parent's values, and the engines read the style their source
reads at each site: Blink an item's style (`SetCurrentStyleForce`, `line_breaker.cc:4557-4643`), WebKit the item's, the
parent's, the nearest common ancestor's or the root's (webkit-shortcut-audit F1), Gecko each frame's and each span's
(`nsLineLayout::BeginSpan`, `nsLineLayout.cpp:378-416`). Box edges, `vertical-align` and `lang` belong to the element
itself. `src/content.ts` indexes the tree in document order: the leaves with their source offsets and parents, the
elements, and the open, close and item events of a DOM walk. Engines build their items from that walk; the painter
replays it.

`CssFont.family` is a CSS font-family list, the string the page sets. One parser reads it, `src/font-family.ts`
`listedFamilies`, for the font checks and the three ports, because quotes, escapes and commas are CSS syntax and the
same in every engine (CSS Fonts 4 §4.2, CSS Syntax §4.3.5 and §4.3.7; probe `font-family-syntax`: the browsers' own
parsers read the probed lists the same way, 95 of 95 checks in each of the three). An entry is `{ name, quoted, css }`,
with `identifiers` for an unquoted name. What differs per engine is which unquoted names are its keywords and how it
compares names, and each port owns that (Blink's `styleOf`, WebKit's `familyNames`, Gecko's `parseFamilyList`).
`family` stays the string, which Canvas and the painter are given as it is, so the list is read where a name is
needed and kept nowhere. `css` is the family as the list writes it, for a list Canvas is given again; a family the
list leaves open at its end (an unclosed string, a last backslash) is handed on as a closed string, so what a caller
appends can't join the name. A list CSS rejects throws (an empty family, a comma at the end, anything but a comma
after a string). It throws where a port happens to read a name, not at the library's boundary: making the list the
model's field, read once, is left for the API phase.

A lab case describes the page, so the case's paragraph has CSS fonts (`lab/types.ts`). The fonts on the page are the
machine's, so their facts belong to the environment the case runs in, not to the case: `lab/predictor.ts` adds them,
and they don't enter case ids (`lab/cases/case.ts` hashes the page content).

Example 1, the lab smoke case `smoke/spans-mixed-fonts` (fonts abbreviated; the spans carry the block's wrapping styles
and no box edges):

```json
{ "content": [
    { "kind": "span", "font": { "family": "Georgia", "size": 16, "weight": 400, "style": "normal" }, "letterSpacing": 0, "wordSpacing": 0,
      "whiteSpace": "normal", "wordBreak": "normal", "overflowWrap": "normal", "lineBreak": "auto", "tabSize": 8, "lang": null,
      "inlineStart": { "margin": 0, "border": 0, "padding": 0 }, "inlineEnd": { "margin": 0, "border": 0, "padding": 0 },
      "verticalAlign": "baseline", "children": [{ "kind": "text", "text": "Hello " }] },
    { "kind": "span", "font": { "family": "Arial", "size": 16, "weight": 700, "style": "italic" }, …, "children": [{ "kind": "text", "text": "world" }] },
    { "kind": "text", "text": " and " },
    { "kind": "span", "font": { "family": "Verdana", "size": 14, "weight": 400, "style": "normal" }, …,
      "children": [{ "kind": "text", "text": "more text that has to wrap around" }] }
  ],
  "font": { "family": "Times New Roman", "size": 16, "weight": 400, "style": "normal" }, "letterSpacing": 0, "wordSpacing": 0,
  "whiteSpace": "normal", "wordBreak": "normal", "overflowWrap": "normal", "lineBreak": "auto", "tabSize": 8,
  "lang": "en", "direction": "ltr", "lineHeight": 22, "textIndent": 0, "textAlign": "start" }
```

The case lays it out at 150px. It stands for `<div lang="en" style="…">` holding `<span>Hello </span><span>world</span> and <span>more text…</span>`.
Source offsets: leaf 0 is [0, 6), leaf 1 [6, 11), leaf 2 [11, 16) and leaf 3 [16, 49). Elements 0, 1 and 2 are the spans.

Example 2, the start of the rich note demo (`pages/demos/rich-note.model.ts`): `Ship `, a mention chip, `'s `, a code span
with 7px side padding, ` card`. The chip is `{ "kind": "atomic", "width": 58.3, "height": 20, "marginInlineStart": 0,
"marginInlineEnd": 0 }`, where 58.3 is the app's own width for the label plus its padding. The code span is a span with
the code font, `"inlineStart": { "margin": 0, "border": 0, "padding": 7 }`, the same at `inlineEnd`, and one leaf
`rich-note`. The demo's `break: 'never'` becomes the atomic inline, and its `extraWidth` the box edges.

**Flat paragraphs.** Every case file written through 2026-09-17 describes a flat paragraph (`lab/types.ts` `Paragraph`):
runs that are spans or bare text nodes, the block's wrapping styles everywhere, no box edges, text-indent 0, text-align
start. It is the tree whose content holds only leaves and spans, where each span has one leaf, `NO_BOX_EDGE` on both
sides, `verticalAlign: 'baseline'` and the block's `whiteSpace`, `wordBreak`, `overflowWrap`, `lineBreak` and
`tabSize`. `lab/predictor.ts` converts a flat case: a bare run becomes a leaf, a span run that span with its text as its
one leaf. A span run with empty text keeps an empty leaf, and an empty leaf makes no DOM node, so leaf indices equal run
indices and recorded rows' `runRects` still index by `run`. Case ids hash the flat form, so ids and gate baselines keep
their keys. Stage 5 (§8.3) adds tree cases, whose ids hash the flat form whenever the tree is flat as above, and the tree
under a new `ID_VERSION` otherwise.

**Why text leaves and elements are different inputs.** The engines treat an element edge and a text node edge
differently, in three places that decide lines:

- Which white-space-only text nodes exist. Blink keeps `" "` after a span, because the previous in-flow object is the
  span's `LayoutInline` (specs/blink-text.md §2.A). WebKit drops such a node only when it's the first inline content of
  the block (specs/webkit-text.md §2). Gecko drops an 8-bit white-space-only node at a line boundary under `normal` or
  `nowrap` (specs/gecko-text.md §3).
- Whether a break is allowed at the edge. Blink asks one iterator over the whole paragraph (specs/blink-lines.md §7).
  WebKit builds an iterator over the next box with the next box's style, seeded with the previous box's last two code
  units (specs/webkit-text.md §7.4). Gecko's `nsLineBreaker` grows one word across frames (specs/gecko-text.md §8).
  In all three, bold `foo` followed by `bar` has no break between them.
- What is shaped together. Blink joins items with equal fonts, including locale and spacing (specs/blink-text.md
  §2.E). WebKit never measures across a text box (specs/webkit-text.md §7.5). Gecko shapes across frames with equal
  font, language and flags and plain box edges (specs/gecko-text.md §5.2).

A bare leaf takes its parent's styles, so it adds a text node edge without an element edge.

**What nesting decides.** Tag-edge rules read the tree, not a flat list:

- Blink: every span has an open and a close tag item. A tag whose span creates a box fragment adds its margin, border
  and padding on that side to the position and makes the line create a line box (`ComputeOpenTagResult`,
  `HandleOpenTag`, `HandleCloseTag`, `ComputeInlineEndSize`, `line_breaker.cc:3937-4025`, `:245-252`). `HandleOpenTag`
  takes the span's style, and a wrapping span opened inside a nowrap one recomputes the break after the text before it
  (`:3996-4005`). A shaping group ends at a tag with a nonzero margin, border or padding on that side or a
  `vertical-align` other than baseline (`ShouldBreakShapingBeforeBox`, `ShouldBreakShapingAfterBox`,
  `inline_node.cc:494-527`). An atomic inline inside a span makes the span create a box fragment
  (`inline_items_builder.cc:1269-1283`). So does a span that holds nothing but empty items and text items that are
  one collapsible space (`ExitInline`, `inline_items_builder.cc:1660-1691`; an empty item is an empty text item or a
  tag whose side has no border, padding or margin, `inline_item.cc:118-151`): such a span has a rect on its line even
  when the line end removes the space (`content.ts` `exitInline`, since the fresh-eyes follow-up).
- WebKit: a soft wrap opportunity between two text items follows the `white-space` of their nearest common ancestor
  (`nearestCommonAncestor`, `InlineFormattingUtils.cpp:357-383`, `:436`). Inline box start and end items are margin +
  border + padding wide (`inlineItemWidth`, `:321-325`). Spans that cross a line start are opened again on the next line
  (`createLineSpanningInlineBoxes`, `InlineLineBuilder.cpp:448`), and a decorated box counts as content
  (webkit-shortcut-audit F3).
- Gecko: a span opens per-span line data with its own available end (`nsLineLayout::BeginSpan`,
  `nsLineLayout.cpp:378-416`). Every continuation of a span takes its end border and padding off that end, on every
  line, and its start edge only when it has no previous continuation (`nsInlineFrame::ReflowFrames`,
  `nsInlineFrame.cpp:505-522`). The end margin applies to the last continuation only (`CanPlaceFrame`,
  `nsLineLayout.cpp:1199-1228`). Inside a nowrap span everything fits (`psd->mNoWrap`, `:1230-1234`). Text runs don't
  continue across margins, borders, padding, a non-baseline `vertical-align` or an isolate (`ContinueTextRunAcrossFrames`,
  `nsTextFrame.cpp:2054-2137`).

**Box edges.** CSS px as declared: margins may be negative, borders and padding may not. Each engine turns a declared
length into its units the way its style system does, border widths included, and the owners port that from source
(Blink `ComputeLineMarginsForSelf`, `ComputeLineBorders`, `ComputeLinePadding`; WebKit `BoxGeometry`; Gecko's computed
border, padding and margin). `box-decoration-break` is fixed at `slice`: the start edge goes on a span's first line and
the end edge on its last. `verticalAlign: '0px'` is a length that moves nothing but ends shaping at the box in Blink and
text runs in Gecko; no value that moves the baseline is offered, since vertical positions aren't modeled.

**Atomic inlines** stand for inline-blocks of declared size, such as chips, and images. The caller gives the border box
and the inline margins, and the library doesn't lay out the contents: a chip's width is the app's, for example the label
laid out as its own paragraph plus the chip's padding. All three engines place the margin box as one unbreakable item
with a soft wrap opportunity on both sides, whatever the text around it, under the parent's `white-space`: Blink appends
U+FFFC to `text_content` (`inline_items_builder.cc:1269-1283`; `HandleAtomicInline`, `line_breaker.cc:3043-3110`;
`MayBeAtomicInline`, `:1269-1300`), WebKit treats an atomic box like an ideograph (`isAtSoftWrapOpportunity`,
`InlineFormattingUtils.cpp:446-450`), Gecko records a break opportunity after a non-text frame (`nsLineLayout.cpp:1057-1080`).
The painter aligns atomic boxes to the line top, so a box no taller than the line height leaves line box heights alone
(CSS 2.1 §10.8). Taller boxes change line box heights, which the model doesn't carry.

**`<br>` and `<wbr>`.** `<br>` is a forced break: Blink's `LayoutBR` text `"\n"` becomes a forced-break control item
(`layout_br.cc:33-37`, `inline_items_builder.cc:1163-1198`), WebKit makes a hard line break item
(`InlineItemsBuilder.cpp:91`, `:1076`), Gecko always places a `BRFrame` (`nsLineLayout.cpp:1273-1278`). `<wbr>` is a
break opportunity without a character: Blink appends an opaque U+200B flow-control item (`inline_items_builder.cc:597-607`,
`:1211-1218`), WebKit a word break opportunity item (`InlineFormattingUtils.cpp:311`, `:469`), Gecko a `WBRFrame`.

**text-indent and text-align** are the block's. `textIndent` in CSS px applies to the first formatted line: Blink starts
the line position at it, so tab stops align whatever the indent (`ShouldApplyTextIndent`, `line_breaker.cc:45-56`,
`:846-857`, `:878-879`); WebKit applies it as a start margin of the line rect (`computedTextIndent`,
`InlineFormattingUtils.cpp:143-176`; `InlineLineBuilder.cpp:454-478`); Gecko adds it to the root span's position
(`nsLineLayout.cpp:178-201`). `textAlign` moves painted positions in all three, and changes line decisions in two:

- Blink's `NeedsAccurateEndPosition` is true for `end`, `center`, `justify`, `left` in RTL and `right` in LTR
  (`line_info.cc:127-175`). A line ending at a space is then reshaped at its end, where under `start` it isn't
  (`line_breaker.cc:255-268`, `:1658`, `:2387`).
- WebKit's simple line builder refuses `justify` (`TextOnlySimpleLineBuilder.cpp:488-528`, webkit-shortcut-audit F5), and
  justification expands boxes (`InlineContentAligner.cpp:230-302`).

Alignment itself is Blink `ApplyTextAlign` with justification (`inline_layout_algorithm.cc:943-970`,
`justification_utils.cc:314`), WebKit `horizontalAlignmentOffset` (`InlineFormattingUtils.cpp:198-260`), Gecko
`TextAlignLine` and `ApplyFrameJustification` (`nsLineLayout.cpp:3220-3670`). `text-align-last` is fixed at `auto`: the
last line and a line ending at a forced break take `start` under `justify`.

**Language.** A span's `lang` null inherits its parent's; `langUnder` in `src/content.ts` finds the nearest. The block's
`lang` `''` is `lang=""`: the language is unknown and does not inherit `<html lang>` (lab/VALIDATION.md, fix 1). `<html
lang>` is `env.pageLang`.

**Fixed styles.** The lab sets every other property to its initial value: `text-align-last: auto`, `text-transform:
none`, `hyphens: manual`, `unicode-bidi: normal` and `direction` inherited on every element, `font-kerning: auto`,
`text-rendering: auto`, `font-variant-ligatures: normal`, `font-optical-sizing: auto`, `box-decoration-break: slice`, and
no floats but the slot protocol's (§2.9). Engines treat these as values, not as features that don't exist. For example,
`text-align: start` makes Blink's `needsAccurateEndPosition` false, which decides that a line ending at a space isn't
reshaped (specs/blink-lines.md §5.2).

**Planned fields.** Each is a field whose initial value is what the lab fixes today: `textTransform` (Blink and WebKit
break the transformed text; Gecko computes break flags before the transform, specs/gecko-text.md §13, CRITIC.md C14),
`hyphens`, `textAlignLast`, text-indent percentages, `each-line` and `hanging`, `box-decoration-break: clone`,
`unicodeBidi` and a span's own `dir`, `fontKerning`, feature and variation settings, `fontOpticalSizing` (under `none`,
`opticalSizeAxis` decides nothing). The lab's generators and page must set a new field, so the architect adds it to
`model.ts` together with the lab owner. The shortcut audits list what each port must rework before these land (blink
F7, webkit F7-F8, gecko F2).

### 1.2 Font facts

```ts
type FontFacts = {
  primaryFamily: string | null
  mapsHyphen: boolean | null
  monospace: boolean | null
  opticalSizeAxis: boolean | null
  joining: 'opentype' | 'aat' | null
  pairKerning: 'first-advance' | 'split' | null
  fonts?: readonly ListedFontFacts[]          // optional: one entry per listed family, below
}
const UNKNOWN_FONT_FACTS: FontFacts   // every fact null, no `fonts`
```

Engines read facts about the fonts a declaration realizes: which family is primary, whether it maps U+2010, whether it
has the monospace trait or an opsz axis, whether the font drawing Arabic shapes through OpenType tables or `morx`.
No measured width of the paragraph's text shows these. A heuristic that guesses them from family names is a rule nobody
can cite, and a constant chosen by lab counts fits the lab's font mix. So each fact is an optional input on the font
declaration, and the headline configuration gives none (CHARTER.md, decisions of 2026-09-18).

Four of them a dedicated Canvas check can answer, and the library asks before the engines run (`measure/font-checks.ts`,
which cites each rule and says what it can't see; `prepare` in `index.ts` is the one call site, and the engines
read `FontFacts` as before): the primary family and U+2010 coverage by the two-fallback test (a string measured under
`F, monospace` and under `F, serif`), in Blink joining (U+0628 next to U+07FA, shaped in a call of its own with context)
and `opticalSizeAxis: false` (advances scale between the CSS and the zoomed size), in WebKit `monospace` as a registered
heuristic. A check runs only where the engine reads the fact and the paragraph's text can need it; a supplied fact is
never checked; these checks ask Gecko nothing, since nothing it loses without facts is learnable from a declaration
(since correctness round 5 the Gecko port asks Canvas where a kerned pair's adjustment sits, per offset, as it fills;
the `pairKerning` row below). The checks name no engine: each
port says which facts it reads, the layout zoom, whether its context takes `lang` and its contexts' text rendering
(`engines/<engine>/checks.ts` `FontChecks`), and `prepare` hands that to the checks. When a fact is still null, the
engine uses a default that plain Canvas measurement gives, and reports the named gap wherever the fact decides a result.
A given fact never produces a gap of its own.

| Fact | Read by | Rule | Asked of Canvas | Default when null | Gap when null |
|---|---|---|---|---|---|
| `primaryFamily`: the family the browser realizes first; a generic keyword stands for itself | Blink and Gecko for their system-font keywords; WebKit for Courier New | Blink's primary font is the first listed family that exists (`PrimaryFont` with `should_contain_glyph` false, `font_fallback_list.h:141-145`); WebKit's index-0 family (`FontCascadeFonts.cpp:200-218`); Courier New gets no width shortcut by family name (`FontCoreText.cpp:776-782`) | WebKit, and Blink where another check needs it: the first listed family that draws U+0020 | the first family in the list | none; the facts that depend on it report theirs |
| `mapsHyphen`: the primary font maps U+2010 | Blink, WebKit | a chosen soft hyphen is U+2010 when the primary font maps it, else U+002D (`computed_style.cc:1804-1820`; `StyleComputedStyle.cpp:419-435`) | Blink, WebKit, where the paragraph holds U+00AD: the two-fallback test on U+2010 | U+2010, measured in the run's context | `hyphen-glyph` at a chosen soft hyphen where Canvas gives `‐` and `-` different widths in that context |
| `monospace`: the primary font has `kCTFontMonoSpaceTrait` or `kCTFontFixedAdvanceAttribute` | WebKit | `Font::determinePitch` (`FontCoreText.cpp:753-785`); fixed pitch enables the width shortcut and the breakWord shortcut (specs/webkit-gaps.md §2.3) | WebKit: `i`, `M`, `.` and the space have one advance (a registered heuristic) | variable pitch: real advances | `fixed-pitch-path` where a text item of a box that allows simplified measuring doesn't measure `f32(length × W(' '))` (webkit-gaps §2.5, test T1) |
| `opticalSizeAxis`: the fonts drawing the declaration have an opsz axis | Blink at layout zoom ≠ 1; Gecko | Blink's DOM shapes at the zoomed size with opsz at the CSS size (`font_platform_data_mac.mm:170-176`); Gecko's OffscreenCanvas uses the axis default (specs/gecko-canvas.md §1.2 C1a) | Blink at zoom ≠ 1, only ever `false`; never for the system font keywords; Gecko's OffscreenCanvas shows nothing | true when `primaryFamily` is the engine's system-font keyword (Blink: `system-ui`, `BlinkMacSystemFont`; Gecko: `system-ui`, `-apple-system`), else false | `optical-size`: Blink wherever layout zoom ≠ 1; Gecko for every run |
| `joining`: how the font drawing joining-script text shapes | Blink | HarfBuzz's Arabic shaper reads the shaping call's context for OpenType fonts; `morx` fonts never read it (`hb-ot-shape.cc:60-66, 100-101`) | Blink, where the text holds a joining-script letter; null for fonts whose joined forms are as wide as isolated ones | each shaping call's text measured alone, which is what an AAT font gives | `joining-technology` at a shaping-call edge between joining letters |
| `pairKerning`: where HarfBuzz puts a pair adjustment between two glyphs of the primary font's Latin text | Blink; Gecko for in-word positions between kerned glyphs (`in-word-prefix` when null); WebKit for the space a text item is measured with (`simplified-measuring` when null) | GPOS PairPos with ValueFormat1 XAdvance and no ValueFormat2 adds it to the first glyph's advance (`PairSet.hh:126-127`); the kern and kerx pair machine adds `kern >> 1` to the first glyph and the rest to the second (`hb-kern.hh:102-106`); which one applies follows the font's GPOS, kern and kerx tables (`hb-ot-shape.cc:150-185`, harfbuzz dfdc088c) | Blink and WebKit: no, Canvas totals don't show which glyph carries it. Blink keeps 16.16 advances and rounds no glyph, so no total moves with the placement (tried again in correctness round 5, §5). Gecko: yes, where the fact is null, per offset between two kerned glyphs and never as a fact of the declaration (`engines/gecko/advance.ts`, §4.4): Gecko rounds each glyph's advance to app units, so the placements give totals one app unit apart, which widths at the size times 2^k tell; a pair that doesn't tell keeps the default and its gap | all of it on the first glyph | `unsafe-to-break` at a line edge taken from the paragraph's positions where the adjustment isn't 0 |

What a given fact does:

- `mapsHyphen` false: the hyphen is `-`, measured in the run's context. Gecko doesn't read the fact: its Canvas
  substitutes `-` for a missing U+2010 as the DOM does (`gfxHarfBuzzShaper.cpp:119-124`; specs/PROBES.md, Firefox
  corrections), so `au('‐')` is exact.
- `monospace` true: WebKit treats the box's primary font as fixed pitch and ports both shortcuts, the width shortcut
  only when `primaryFamily` isn't Courier New.
- `opticalSizeAxis` true: Blink measures at the CSS size and scales by the layout zoom, which equals the DOM in a clean
  renderer (probes-chrome correction 7), and reports `page-history`: a platform font that earlier text or another
  canvas created at the zoomed size changes the DOM widths. Gecko reports `optical-size`, because no Canvas setting
  gives the DOM's opsz.
- `joining` `'opentype'`: Blink measures joined forms at call edges through U+200D (probe blink-followups F1) and sets
  `joinsNextLine` where a line-edge reshape joined letters. `'aat'`: the call's text alone, and `joinsNextLine` false.
- `pairKerning` `'split'`: Blink's position at an offset between two kerned glyphs takes `d >> 1` of the Canvas pair
  adjustment `d`, which moves line edges taken from positions and caret edges inside items (Times New Roman, Helvetica
  Neue and Hoefler Text kern through the legacy table; features `rule/text-align`). `'first-advance'`: all of `d`.

#### Facts per listed family (optional)

```ts
type ListedFontFacts = {
  family: string                                       // as the list names it; a generic keyword stands for itself
  realizes: boolean | null                             // a loaded web font or an installed family
  coverage: readonly number[] | null                   // [first, last, first, last, ...], sorted, inclusive
  ligatures: LigatureFacts | null
  spacingInputs?: readonly number[] | null             // ranges like coverage
  scriptLookups: readonly (readonly string[])[] | null // ISO 15924 codes, grouped
}
type LigatureFacts = { patterns: readonly LigaturePattern[]; complete: boolean; languageSystems: readonly string[] }
type LigaturePattern = { positions: readonly (readonly string[])[]; exact: boolean; spaced: boolean; everyContext: boolean; acrossMark: boolean | null }
```

`fonts` has one entry per family of the `font-family` list, in list order, each about the font that family realizes as
this engine sees it. All of it is optional: `fonts` may be left out, and any field may be null. An engine that doesn't
get a fact keeps the gap condition it has today, and none of these facts produces a gap of its own. They are properties
of a font, never expected layout results. The engine's own fallback after the list isn't described: a character no
listed font covers is drawn by a font these facts don't name, and after an entry whose `realizes` is null nothing is
known about which later family draws a character.

| Fact | What it says | From | Can narrow or replace |
|---|---|---|---|
| `coverage` | the code points the engine finds in the font | Blink asks the cmap, and Core Text for U+2010 and U+2011 only (`harfbuzz_face.cc:210-231`); WebKit asks Core Text for every character, which synthesizes some glyphs (U+2010, U+2011, NBSP, LF, U+2028) and withholds some of the platform UI font's (`GlyphPageCoreText.cpp:51-73`); Gecko reads the cmap and clears a complex script range in an installed font that has neither `morx` nor a GSUB script for it (`CoreTextFontList.cpp:271-336`, `gfxPlatformFontList.cpp:79-155`) | Gecko `font-fallback` at an emergency break after a hyphen (whether the hyphen and the letters around it come from one listed font); WebKit `font-fallback` and `canvas-language` (what no named family draws); Blink `script-context` (which font draws a character, so whose `scriptLookups` apply) |
| `ligatures` | the character sequences the font's default features draw as one glyph across grapheme clusters: every string made of one alternative per `positions` entry. `spaced`: still a ligature under the features the engine sets for non-zero letter-spacing. `exact`: every such string was shaped. `everyContext`: alone and, for Arabic script, joined on either side. `acrossMark`: with a combining mark after the first character. `complete`: no other sequence of base characters ligates under the default language system; when false the list can confirm a ligature, never rule one out. Patterns list base characters only: marks between them aren't listed, and `acrossMark` is all that was shaped about them | the font's GSUB LigatureSubst entries and `morx` ligature subtables, mapped back to characters and shaped: HarfBuzz for Blink, Core Text for WebKit, and for Gecko Core Text where it shapes the font through it (`gfxMacFont.cpp:154-160`), else HarfBuzz. For an engine Core Text shapes for, null on a face whose `morx` table the offline Core Text run rejected (its verdicts there were wrong: the browsers ligate Thonburi's `fi`), and `complete` false where the two shapers disagree on any string | Blink `glyph-clusters` at line and item edges, and positions inside a ligature; Gecko `in-word-prefix`; WebKit `letter-spacing-ligatures` |
| `spacingInputs` | the characters that can become a glyph at which a lookup starts that belongs to a default-on feature the engine turns off for non-zero letter-spacing: `liga` and `clig` in all three, `calt` in Blink too (`font_features.cc:54-86`; `UnrealizedCoreTextFont.cpp:258-264`; `gfxFont.cpp:675-700`), or their `morx` feature settings. Text holding none of them shapes the same with those features on and off; an empty list says letter-spacing never changes the font's shaping | the coverage of those features' lookups (a lookup acts only where the glyph is in a subtable's coverage) and the glyph classes of those `morx` subtables, mapped back to characters | WebKit `letter-spacing-ligatures`, which fires today on any two adjacent characters under letter-spacing; the same condition in Blink and Gecko where Canvas and the DOM set different features |
| `scriptLookups` | Unicode scripts grouped by the GSUB and GPOS script records HarfBuzz selects for them; scripts in one group get the same features and lookups under every language system, and a script that isn't listed shares the font's fallback records (`DFLT`, else `dflt`, else `latn`). `[]`: the script never changes the lookups. The shaper, the direction and fallback positioning still follow the script | `hb_ot_layout_table_select_script` (`hb-ot-layout.cc:561-608`) over the script's tags (`hb-ot-tag.cc:36-181`); a table HarfBuzz doesn't apply counts as equal for all scripts (GSUB with `morx`, GPOS under `kerx`; `hb-ot-shape.cc:59-65, 150-185`). null where Core Text shapes | Blink `script-context`: a character Canvas shapes under another script than the paragraph differs only when the two scripts are in different groups of the font that draws it (Arial has no `DFLT`, so Common text falls to `latn` and equals Latin) |

Examples from the lab's table: Georgia and Verdana have no ligature, empty `spacingInputs` and one set of lookups for
every script. Arial's `liga` lookups start only at alef, reh and lam, and its lam-alef is `rlig`, which letter-spacing
keeps (`spaced: true`). Amiri and Noto Naskh Arabic draw lam-alef as two glyphs in two clusters. Helvetica Neue's `morx`
ligates `fi`, `fl`, `ff`, `ffi` and `ffl` under common ligatures (`spaced: false`), and HarfBuzz reads no script from it
(`scriptLookups: []`).

The keyword defaults of `opticalSizeAxis` aren't name keys. `system-ui` is CSS, each engine resolves it in source to the
platform UI font, and that font's axis is a recorded browser fact (probes-chrome correction 7, probe cross-cutting 5).

Blink compares its two names as its own code does (`engines/blink/content.ts` `isSystemFontKeyword`, probe
`blink-sysui-spellings`). Unquoted, `system-ui` is a CSS value keyword and matches in any ASCII case. Quoted, it matches
as written, because on macOS the font cache gives the system UI font to the name `system-ui` wherever it came from.
`BlinkMacSystemFont` matches exactly, quoted or not; `blinkmacsystemfont` names no font in Chrome. A quoted
`"System-UI"` names none in a clean renderer and gets the system UI font once `system-ui` exists at its size; the port
gives the clean renderer's answer. Known and not fixed, since system-ui accuracy is postponed (issue #336): a quoted
`"system-ui"` draws the system UI font in webkit-host too, where the WebKit port's system design families require the
name unquoted (`engines/webkit/gaps.ts`); Firefox resolves `-apple-system` quoted too, where the Gecko port requires
identifiers (`engines/gecko/fonts.ts` `opticalSizeAxisOf`); and the font checks answer `primaryFamily` null for a
quoted generic that draws, since the fact has no quoted flag, so for `Missing, "system-ui"` Blink falls back to the
list's first family and measures at the zoomed size, where Chrome draws the system UI font (read from the code, not
run).

Where the facts come from is the caller's business. The lab takes them from a pinned table per OS build, generated
offline from the installed fonts and checked by hash (§8.3, stage 3). The table's columns are the monospace trait, cmap
coverage of U+2010, fvar axes and `morx` against GSUB and GPOS, from the same tools as specs/webkit-gaps.md §2.4 and §3.2,
specs/blink-gaps.md §5.3 and specs/gecko-gaps.md §3.3, and since ceiling round 3 the whole cmap with Core Text's
additions, the scripts grouped by lookups, the ligature patterns and the letter-spacing inputs (lab/README.md, "Font
facts", names the programs). It is keyed by family, weight and style. `lab/predictor.ts`
attaches facts from `lab/font-facts.json`, the lab's objective table for the fonts its cases use, built by offline
font-table research (charter boundaries); apps declare their own facts. Atomic inlines carry no font.

### 1.3 What replaces the heuristics and the choices by score

`research/RULES.md` classifies 25 rules as heuristics and 11 as chosen by lab score. Each is replaced as follows; §8.3
says when.

| Rule | Kind | Replacement |
|---|---|---|
| blink/measure/system-ui-at-css-size | heuristic | fact `opticalSizeAxis` |
| blink/measure/joining-context-opentype | by score | fact `joining` |
| blink/output/joins-next-line-opentype | by score | fact `joining` |
| blink/hyphen/glyph-by-two-fallback-test | heuristic | fact `mapsHyphen` |
| webkit/content/fixed-pitch-by-family-name | heuristic | fact `monospace`, and `fixed-pitch-path` when null |
| webkit/content/courier-new-no-width-shortcut | heuristic | the source's own rule over fact `primaryFamily` |
| webkit/measure/hyphen-always-u2010 | heuristic | fact `mapsHyphen` |
| gecko/gap/optical-size-by-family-name | heuristic | fact `opticalSizeAxis` |
| gecko/lines/zwj-before-joined-suffix | by score | a DOM-geometry probe of the in-word advance per shaping technology (gecko audit D1). The recipe the probe shows exact is keyed on fact `joining`; where none is exact, `in-word-prefix` |
| gecko/measure/apple-color-emoji-family-literal | heuristic | a recorded browser fact: the macOS 27 color emoji font that Core Text draws emoji with (probe gecko-port F3), cited as such; `bitmap-emoji-size` where unverified |
| blink/output/width-copies-lab-visibility, other-space-separators-excluded | by score, heuristic | removed: lines carry Blink's own widths (§2.3) |
| webkit/output/width-copies-lab-visibility, default-ignorables-trailing-excluded | by score | removed: display boxes (§2.4); the default-ignorable data shipped for the lab goes too |
| webkit/output/pre-wrap-trailing-marked-hanging, fragment-levels-rederived | heuristic | removed: fragments come from the closed `Line::Run` list |
| gecko/output/width-copies-lab-extent, positive-advance-rect-rule | by score | removed: frames (§2.5); the rect rule belongs to the observation port (§9) |
| gecko/output/tab-marked-hanging | heuristic | removed: hanging content from Gecko's own `CharIsSpace` flags (`gfxTextRun.cpp:1152-1159`) |
| webkit/gap/canvas-language | by score | generic families are measured, not reported: WebKit asks Core Text for a per-language family (`CTFontDescriptorCreateForCSSFamily`, `SystemFontDatabaseCoreText.cpp:320-365`) and looks it up by name, so the port names that family in the Canvas list, from macOS 27.0's answers dumped per language (`data/webkit/coretext-macos27/css-families.tsv`, `engines/webkit/fonts.ts`; engine data, CHARTER.md decision 4), and `-webkit-standard` from the settings' standard family per script (`SettingsBaseCocoa.mm:44-50`); `FontFacts` is unchanged. A named family settles its own characters under every locale (probes webkit-round4 R7, R12). Still reported: system design families, an emoji-presentation character only a generic could draw, and system fallback by language, whose character table is a registered heuristic (`FontCacheCoreText.cpp:775-790` is closed in Core Text) |
| webkit/gap/simplified-measuring | by score | reported for every simplified-path box outside the width shortcut until a probe settles the float32 summing order (probes-safari correction 5) |
| shared/env/engine-from-user-agent | heuristic | the user agent gives the engine only; the build and the browser process's languages are given facts, and what the engine's recipes assume of Canvas is asked of the running browser (§1.4) |
| blink/measure/ignorables-left-out-if-8bit | heuristic | a probe of the unexplained RLM case before keeping a storage-based rule (blink audit D2); `soft-hyphen-shaping` meanwhile |
| blink/measure/v8-short-slice-storage, force-16bit-string | heuristic | V8's substring and concat rules cited at Chrome 153's V8 pin, or probed per length (blink audit E3) |
| blink/shape/wide-group-halved | heuristic | the cut keeps its source trigger, 256 zoomed px; the cut location reports `unsafe-to-break` where the safe test can't vouch for it (blink audit E4) |
| blink/lines/reshaped-part-measured-alone-when-cut | heuristic | keep a reshape's pieces and slice them, as `ShapeResultView::Create` does (blink audit F6) |
| webkit/measure/letter-spacing-after-tab, word-spacing-after-tab, canvas-word-spacing | heuristic | probes of Canvas word spacing at index 0, mid-string and after TAB, and tabs in Helvetica Neue and SF with letter spacing (webkit audit E2, E3); `tab-stops` where they differ |
| webkit/breaks/dictionary-engine-by-block | heuristic | the script from pinned ppucd, as `brkeng.cpp:163-199` uses `uscript_getScript` (webkit audit E5) |
| gecko/textrun/raw-family-string-compare | heuristic | compare parsed family lists (`nsTextFrame.cpp:2168` compares the parsed `mFont`; gecko audit E2) |
| gecko/linebreaker/cj-likely-script-approximation | heuristic | a generated likely-subtags module from ICU 78 data, checked by hash (gecko audit E4) |
| shared/painter/nowrap-hyphenated-or-joined, leading-ascii-space-slice-in-span | heuristic | painter probes per engine; the first-slice rule takes each engine's own white-space set (webkit audit E7, gecko audit E8) |
| shared/painter/zwj-at-joined-line-edges | by score | painter probe 5 per engine; the flag it reads now comes from fact `joining` in Blink (§7) |

### 1.4 Environment

`src/env.ts`. The environment is a union over engines, because each engine reads different browser-process facts.

```ts
type BlinkProcessLanguages = { uiLanguage: string | null }
type WebKitProcessLanguages = { preferredLanguages: readonly string[] | null; icuDefaultLocale: string | null }
type GeckoProcessLanguages = { regionalPrefsLocale: string | null }
type ProcessLanguages = ({ engine: 'blink' } & BlinkProcessLanguages) | ({ engine: 'webkit' } & WebKitProcessLanguages)
  | ({ engine: 'gecko' } & GeckoProcessLanguages)

type BlinkEnvironment = BlinkProcessLanguages & {
  engine: 'blink'; build: string | null
  devicePixelRatio: number; pageLang: string; contentLanguage: string | null
  dictionaryBreaks: { kind: 'v8-break-iterator' } | { kind: 'unavailable' }
}
type WebKitEnvironment = WebKitProcessLanguages & {
  engine: 'webkit'; build: string | null
  devicePixelRatio: number; pageZoom: number | null; pageLang: string; contentLanguage: string | null
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}
type GeckoEnvironment = GeckoProcessLanguages & {
  engine: 'gecko'; build: string | null
  devicePixelRatio: number; pageLang: string; contentLanguage: string | null
  dictionaryBreaks: { kind: 'intl-segmenter-word' } | { kind: 'unavailable' }
}
type Environment = BlinkEnvironment | WebKitEnvironment | GeckoEnvironment
const PINNED_BUILDS = { blink: '153.0.8010.48', webkit: '22625.1.29.11.27', gecko: '156.0' }
```

The library reads only page facts (CHARTER.md, "Boundaries"), in two steps by what can change while the page lives:

- `detectEngine()`, once per page: the engine from the user agent, and whether this browser's Canvas has what that
  engine's measuring recipes assume (below). A page calls it first anyway, to know which engine's facts to give.
- `detectEnvironment(given)`, again whenever zoom or `<html lang>` changes: it checks the user agent's engine against the
  given facts, then reads `devicePixelRatio`, `document.documentElement.lang` and which segmenters `Intl` has. It asks
  Canvas nothing. Everything else is `GivenFacts`, a union with the build, `contentLanguage` and that engine's process
  languages.

Both answer `supported`, or `unsupported` with the user agent and a reason. Tests, and predictions for another runtime,
build an Environment directly.

**Canvas checks** (`measure/canvas-checks.ts`). The build number can't tell whether a browser's Canvas is one the recipes
can read: builds near the pinned ones predict as well as the pinned ones under `engine-build`, while on Firefox 140 ESR,
whose native layout is 98.3% the same as 156's, line counts fell from 99.8% to 89.2% because its context has no `lang` and
keeps the Gecko port's 0.001px letter spacing as a fraction (research/VERSION-DRIFT.md). A missing context attribute
doesn't fail: assigning it makes an ordinary property, and the recipe reads a width measured some other way. So each
port's list is read from its recipes (`engines/<engine>/checks.ts` `CanvasNeeds`), naming only what a recipe sets to
something other than the attribute's default, and checked in the running browser with two contexts and two `measureText`
calls, with no browser or version names:

| Port | Context attributes | Ink box (`actualBoundingBoxLeft`, `Right`) | Ligature-free letter spacing |
|---|---|---|---|
| Blink | `lang`, `letterSpacing`, `textRendering`, `direction` | HanKerning's glyph types | `0.015625px` adds exactly 1/64 px to each character |
| WebKit | `letterSpacing`, `wordSpacing` (its context has no `lang`, `fontKerning` or `textRendering`, and the port assigns those their defaults only) | not read | none: WebKit's Canvas keeps optional ligatures under letter spacing |
| Gecko | `lang`, `letterSpacing`, `direction` | the ligature test and the emoji font test | `0.001px` adds nothing to a character's width and leaves the ink box where it was |

The letter spacing is measured over one letter 16 times in `16px serif`: a Canvas that adds the spacing as a fraction and
rounds the total shows nothing on a letter or two. A browser that lacks something is unsupported, and the reason names
each lack; no prediction is sound without them, so none becomes a gap. Probe `probes/canvas-checks.ts` runs the library's
own `detectEngine()` in a browser: the pinned Chrome 153.0.8010.50, Firefox 156.0 and webkit-host, and Chrome 152 and 155
and Firefox 153.3esr and 157.0b2, are supported; Firefox 140.16.0esr is refused for the missing `lang`, the spacing
(0.00104px a character) and the ink box it moves. The lab's predictor derives the engine from the browser it launched and
doesn't call `detectEngine()`, so neither the recorded Canvas answers nor the offline replay hold the checks' calls.

| Field | Source | What reads it |
|---|---|---|
| `engine` | `navigator.userAgent`, read for the engine and not the brand: `Firefox/` is Gecko; `Chrome/` is Blink, so Edge, Opera, Samsung Internet and an Android WebView are; `AppleWebKit/` without `Chrome/` is WebKit, so every iOS browser and a WKWebView are. Only Chrome, Firefox and Safari on one Mac are pinned and tested. `detectEngine()` also checks the running Canvas (above) | the one switch (§3) |
| `build` | given: the app bundle version (Chrome's and Firefox's `CFBundleShortVersionString`, WebKit.framework's `CFBundleVersion`). Chrome's reduced user agent shows only the major version | `paragraphGaps` reports `engine-build` first when it isn't `PINNED_BUILDS[engine]`, null included, and the lab's layout records the environment it ran under |
| `devicePixelRatio` | `window.devicePixelRatio` | Blink: the layout zoom, device scale factor times browser zoom (specs/blink-lines.md §2.1; an emulated DPR lays out at zoom 1). Gecko: app units per device pixel = max(1, round(60 / dpr)) (specs/gecko-lines.md §2.1). WebKit: nothing on the line-breaking path (specs/webkit-lines.md §1.6) |
| `pageZoom` (WebKit) | given | Safari's page zoom multiplies lengths and font sizes, and no page API shows it. null: laid out at 1 with `page-zoom`. Blink and Gecko include browser zoom in the DPR |
| `pageLang` | `document.documentElement.lang` | Blink's and Gecko's OffscreenCanvas language when `ctx.lang` isn't set; the lab checks it against `case.pageLang` |
| `contentLanguage` | given: the header or `<meta http-equiv>`, null when the document has none | the root locale when no element has `lang`, in all three engines |
| process languages | given | below |
| `dictionaryBreaks` | the running browser's `Intl` | §6.3; the union per engine allows only the segmenter that engine can use |

Engines derive their own units from these facts (Blink's layout zoom, Gecko's app units per device pixel) inside the
engine module. They aren't stored in the environment.

**The languages a browser process uses for unlabeled content.** The CHARTER forbids reading them from the OS in the
library, and `navigator.language` isn't what any engine reads. So each is a given fact of its engine, and a null fact
makes such content report `ui-language`:

- Blink, `uiLanguage`: `DefaultLanguage()`, the canonicalized `Platform::DefaultLocale()` taken once per renderer, which
  is Chrome's application locale (`InitializePlatformLanguage`, `DefaultLanguage`, `language.cc:62-99`). It opens the
  break table for content with no locale and drops the `line-break` keywords. A Chinese UI gives unlabeled text
  `line_normal_cj`, so `a”b` breaks after `”` (specs/blink-text.md §2.F.3). It also picks generic families and the
  HarfBuzz language, and it's the retry locale when `ko@lb=strict` fails to open. Probes blink-canvas H22 and H23 confirm
  both with a Chinese UI.
- WebKit, `preferredLanguages`: `WTF::userPreferredLanguages()` of the WebContent process. When the UI process sets
  override languages, the bootstrap message carries them and WebContent overrides its preferred languages with them
  (`XPCServiceMain.mm:62-78`, `:181-192`; `WebProcessPool.cpp:990`; `setOverrideLanguages`, `OverrideLanguages.cpp:38`);
  otherwise they are the system's preferred languages. A `lang` of Han script (`zh`, `zh-CN`, `zh-SG`) is replaced with
  the first entry starting with `zh-` (specs/webkit-canvas.md §1.3).
- WebKit, `icuDefaultLocale`: `uloc_getDefault()` of the WebContent process. It is `en_US_POSIX` unless launchd passes
  `LANG` or `LC_*` (specs/webkit-gaps.md §8.2). The quote overrides of a locale ICU has no data for, such as `und`,
  `mul` or `zxx`, fall back through it; a missing `lang` opens root and isn't affected (§8.3).
- Gecko, `regionalPrefsLocale`: the first `OSPreferences::GetRegionalPrefsLocales` entry, lowercased
  (`nsLanguageAtomService::GetLocaleLanguage`, `nsLanguageAtomService.cpp:107-138`). On macOS it reads the OS's system
  locales (`OSPreferences.cpp:445-458`, `mac/OSPreferences_mac.cpp:59-63`); `intl.locale.requested` sets the app locale,
  which this path doesn't read. It is the style language of a UTF-8 document's content without `lang`, which decides the
  ja/zh rule for removing segment breaks next to East Asian punctuation and the shaping language (specs/gecko-text.md
  §2.4; probe gecko-text H15). Firefox's `navigator.language` comes from the accept-languages list instead.

The lab sets or reads these when it launches a browser and records them per run (`lab/types.ts` `ProcessLanguages`,
§8.3 stage 0): the application locale Chrome is launched with; the override languages webkit-host's UI process can send,
or the system preferred languages installed Safari's WebContent takes, and launchd's `LANG` and `LC_*`; the OS system
locales Firefox reads. Gecko reads `regionalPrefsLocale` since ceiling round 2; `contentLanguage` is read by Blink alone
(research/CHARTER-CRITIC.md item 10).

**Predicting one engine from another runtime.** Canvas totals come from the running browser: Core Text advances in
Safari, Gecko's per-glyph app-unit rounding, Blink's HarfBuzz advances. An environment built for another engine gets
its break rules right and its widths from the wrong Canvas (DESIGN-REVIEW.md §3.4). Only tests do this, with stand-in
widths.

## 2. Output

### 2.1 The layout

Per slot the library returns a fill result (`FillResultOf`, `src/model.ts`): what filling the slot decided, and the
engine's own record of the decided line. Two functions read that record and nothing writes it: `linePieces` gives what a
painter takes (`LinePieces<Facts>`), and `inspectLine`, on a paragraph prepared for inspection, the engine's geometry and
the gaps the line's breaks decide (`LineInspectionOf`). Each port keeps a record of its own (§2.9): pieces and geometry
are made when they are read, not while the line is filled. Each engine's geometry (§2.3-§2.5) and the state its next
line starts from (§2.7) are types of its own, in `src/engines/<engine>/geometry.ts`: types only, and the one engine file
the lab imports, since a row keeps both whole.

The layout of a whole paragraph is the lab's: the row format its predictions keep (`lab/types.ts`), frozen with its key
order, which the lab's adapter makes from the function set, one slot at a time (`lab/predictor-core.ts`
`layoutParagraph`, §2.9). A row's line is the fill result, the pieces and the inspection together, with the two insets of
its slot.

```ts
// src/model.ts: what the function set returns (§2.9)
type FillResultOf<Start, Line, Refused> =
  | { kind: 'line'; line: Line; start: number; end: number; next: Start | null; hasLineBox: boolean }
  | { kind: 'below-floats'; line: Refused; next: Start }
type LinePieces<Facts> = { fragments: Fragment[]; joinsNextLine: boolean; indented: boolean; align: TextAlign; overflows: boolean; facts: Facts }
type LineInspectionOf<Geometry> = { geometry: Geometry | null; gaps: Gap[] }   // a refused slot has no geometry

// lab/types.ts: what a row keeps
type ParagraphLayout =
  | { engine: 'blink'; env: BlinkEnvironment; lines: LineOf<BlinkLineStart, BlinkLineGeometry>[]; belowFloats: BelowFloats[]; measure: CanvasWork; gaps: Gap[] }
  | { engine: 'webkit'; env: WebKitEnvironment; lines: LineOf<WebKitLineStart, WebKitLineGeometry>[]; belowFloats: BelowFloats[]; measure: CanvasWork; gaps: Gap[] }
  | { engine: 'gecko'; env: GeckoEnvironment; lines: LineOf<GeckoLineStart, GeckoLineGeometry>[]; belowFloats: BelowFloats[]; measure: CanvasWork; gaps: Gap[] }

type LineOf<Start, Geometry> = {
  start: number; end: number     // fill: source offsets; consecutive lines tile the text
  fragments: Fragment[]          // pieces: logical order, no widths (§2.2)
  hasLineBox: boolean            // fill
  joinsNextLine: boolean         // pieces
  slot: { left: number; right: number }   // the insets of the slot the line was filled in (§2.9)
  indented: boolean              // pieces: the engine applied text-indent to this line
  align: TextAlign               // pieces: the alignment the engine used for this line
  geometry: Geometry             // inspection: the engine's own line (§2.3-§2.5)
  gaps: Gap[]                    // inspection: gaps this line's breaks decide (§2.8)
  next: Start | null             // fill: null after the last line (§2.7)
}
type BelowFloats = { row: number; gaps: Gap[] }
type CanvasWork = { contexts: number; calls: number; memoHits: number }   // counted by the adapter (§2.8); memoHits is 0
```

A filled line says where it breaks without its pieces: `start`, `end`, `next` and `hasLineBox` are the fill result's own,
so counting lines or finding a height reads nothing else. `overflows` says the line's content reaches past its band by the
engine's own widths, hanging white space left out. `facts` is what the engine's painting rules read of its own line beside
the pieces: Blink's `needsAccurateEndPosition`, WebKit's width carried into the line's first text and whether the line
holds an RTL run shaped across inline boxes; Gecko's are empty. The painter takes them with the pieces (§7).

What is shared and what isn't follows from who reads it. The painter and the lab's line ranges need the engine's
classification of content per line, in source offsets: what it laid out, trimmed, collapsed or hung, and which line holds
each element. All three engines make those distinctions, so `fragments` is shared, and so are the slot, the indent and
the used alignment the painter reproduces. Positions, sizes and units differ in kind: Blink places items at LayoutUnit
offsets with caret positions from glyph clusters, WebKit places float32 display boxes over text ranges, Gecko places
frames in app units whose points come from per-character advances. The observation models need exactly those
(research/observe-blink.md §3, observe-webkit.md §4, observe-gecko.md §4), so `geometry` is per engine, in engine units.
Nothing in the output is shaped to what a Range can show; §9 derives that in the lab. No function returns a width in CSS
px yet: §2.6 has each engine's conversion, and a line's width in px is one of the first things the API phase adds
(research/CAPABILITY-CHECK.md).

- `[start, end)` of consecutive lines tile the source text: every unit belongs to exactly one line, collapsed white
  space and forced breaks included. Elements hold no source units, so fragments place them: every atomic inline, `<br>`
  and `<wbr>`, and every span's start edge and end edge, is in exactly one line's fragments.
- `hasLineBox` is false for a line the engine makes without a line box that holds content: Blink's empty lines
  (`LineInfo::ShouldCreateLineBox`, `line_breaker.cc:945-975`), WebKit's lines without contentful inline content
  (`LineLayoutResult.h:94-105`), Gecko's line boxes of block size 0 (`nsLineLayout.cpp:1690-1712`). A span's box edge,
  an atomic inline or a `<br>` makes content (Blink forces a line box at a tag with box edges, `line_breaker.cc:3983-3985`,
  `:4018-4019`). Such a line is still returned, where the ports used to fold it into a neighbour by looking ahead (blink
  audit F5, gecko audit F8). It paints nothing, takes no block size, and the lab and the painter skip it.
- `joinsNextLine`: the paragraph's shaping joined the letters on both sides of this line's end. In Blink a line-edge
  reshape keeps joined forms only for an OpenType joining font (fact `joining`); in Gecko the break is inside one shaped
  word. WebKit never shapes across a line edge, so it's always false there (specs/painter.md §3.2 c).
- `indented` and `align`: whether the engine applied `textIndent` to the line, and its used alignment, `start` for the
  last line and a line ending at a forced break under `justify` (§1.1).
- `env` records the environment the layout ran under, so a lab row keeps the build and the given facts with the
  prediction. `belowFloats` records the slots the engine refused (§2.9).

### 2.2 Fragments

```ts
type Fragment =
  | { kind: 'text'; run: number; start: number; end: number; painted: string; level: number }
  | { kind: 'trimmed'; run: number; start: number; end: number; painted: string; level: number }
  | { kind: 'collapsed'; run: number; start: number; end: number }
  | { kind: 'hanging'; run: number; start: number; end: number; painted: string; level: number }
  | { kind: 'hyphen'; run: number; at: number; painted: string; letterSpacing: number; level: number }
  | { kind: 'forced-break'; run: number; start: number; end: number }
  | { kind: 'box-start'; element: number }
  | { kind: 'box-end'; element: number }
  | { kind: 'atomic'; element: number; level: number }
  | { kind: 'br'; element: number }
  | { kind: 'wbr'; element: number }
```

`painted` is the text the engine lays out for that source range: a collapsed run of spaces is one space, a newline in
`normal` is a space, a removed segment break is nothing. Soft hyphens and control characters stay in `painted` when the
engine keeps them in its text. The kinds say what the engine did with the content, and so what the painter does (§7):

- `text` is laid out on the line. It includes controls the engine keeps in its content without placing them: Blink's CR
  and FF in preserve modes are control items that produce no fragment item (`line_breaker.cc:2988-2994`, CRITIC row 7),
  and painting them keeps their shaping-group split.
- `hanging` is preserved trailing white space placed in the geometry that doesn't count against the available width.
- `trimmed` is collapsible white space still in the engine's content that the line end removed from the geometry after
  the break was chosen. It is painted, so the browser trims it again and shapes the text before it as the paragraph did.
- `collapsed` is source text the engine never places on this line: white space collapsed into earlier white space, a
  removed segment break, collapsible white space skipped at a line start, a text node without a layout object.
  `forced-break` is the newline that ended the line. Neither is painted.
- `hyphen` is the hyphen of a chosen soft hyphen after source offset `at`, `‐` or `-` as the engine chose it (fact
  `mapsHyphen`), with the letter spacing the engine applies to it: 0 in Blink and Gecko, the run's in WebKit.
- `box-start` and `box-end` say which line holds a span's start edge and end edge. Engines emit them for every span, with
  box edges or without: Blink where the open or close tag's item result sits (a trailing open tag moves to the next line,
  `RewindTrailingOpenTags`), WebKit where the inline box start or end item was placed, Gecko on the first and the last
  `nsInlineFrame` continuation. A span with only descendants on a line has neither there.
- `atomic` places an atomic inline, at the level its object replacement item resolved to. `br` places a `<br>` that ended
  the line, `wbr` a `<wbr>` consumed on it. Neither is painted.

`level` is the bidi embedding level the engine reorders the piece with, after its own line-end rule for trailing white
space (specs/bidi.md §6: Blink compares levels, WebKit compares parity, Gecko has no such rule). Engines split fragments
where the level changes, as they split items and frames before filling lines, so one level per fragment is exact.

Example 1, Blink, `white-space: normal`, width 60px, where `Hello world` doesn't fit. Content: a span holding `"Hello  "`,
a bare leaf `" "`, a span holding `"world"`.

| Line | Fragments | start, end |
|---|---|---|
| 1 | `box-start` 0; `text` run 0 [0, 5) `"Hello"`; `trimmed` run 0 [5, 6) `" "` (removed at the line end, specs/blink-lines.md §8.3); `collapsed` run 0 [6, 7) (the second space collapses while text_content is built); `box-end` 0; `collapsed` run 1 [7, 8) (the bare space collapses into the previous one, specs/blink-text.md §2.C.4); all levels 0 | 0, 8 |
| 2 | `box-start` 1; `text` run 2 [8, 13) `"world"`; `box-end` 1 | 8, 13 |

Example 2, `white-space: pre-wrap`, `abc      def` (6 spaces) at the width of `abc` plus one space: line 1 is `text`
[0, 3) `"abc"` and `hanging` [3, 9); line 2 is `text` [9, 12) `"def"`. The six spaces' width is in line 1's geometry.

Example 3, Blink, `super&shy;cali` narrow enough to break at the soft hyphen: line 1 is `text` [0, 6) `"super­"` and
`hyphen` at 6, `"‐"`, letter spacing 0, because Blink shapes the hyphen alone without spacing (specs/blink-lines.md §11);
line 2 is `text` [6, 10) `"cali"`.

Example 4, Blink, LTR, `font: 24px Arial`, `שלום (עולם ab) cd` breaking after `(עולם `. The pair `(`…`)` holds R and L,
so N0 gives both brackets the embedding direction L (specs/painter.md §4.3). Line 1 is `text` [0, 4) `"שלום"` level 1,
`text` [4, 6) `" ("` level 0, `text` [6, 10) `"עולם"` level 1 and `trimmed` [10, 11) `" "` level 0.

Example 5, a span with 7px padding on both sides holding `rich-note card`, broken after the space. Line 1 is `box-start`
0, `text` [0, 9) `"rich-note"` and `trimmed` [9, 10) `" "`; line 2 is `text` [10, 14) `"card"` and `box-end` 0. Blink adds
the start padding to line 1's position and the end padding to line 2's (`line_breaker.cc:3937-4025`). Gecko also takes
the end padding off line 1's available end while the line fills, since every continuation reserves it
(`nsInlineFrame.cpp:514-521`), although the span doesn't end on line 1.

### 2.3 Blink geometry

Raw LayoutUnits count 1/64 of a zoomed px; raw / 64 / layoutZoom is CSS px.

```ts
type BlinkLineGeometry = {
  layoutZoom: number
  lineLeft: number            // LineLayoutOpportunity::line_left_offset from the content box's left edge
  lineRight: number           // line_right_offset
  availableWidth: number      // LineInfo::AvailableWidth: lineRight − lineLeft
  textIndent: number          // LineInfo::TextIndent(), 0 where it doesn't apply
  needsAccurateEndPosition: boolean
  width: number               // LineInfo::Width (line_breaker.cc:1149-1161), hanging spaces, indent and box edges included
  hangWidth: number           // the part of width that hangs (line_info.cc:289-400)
  alignOffset: number         // what ApplyTextAlign added to every item
  mapping: BlinkMappingUnit[] // OffsetMapping units over the line's source units
  items: BlinkItem[]          // visual order
}
type BlinkMappingUnit = { run: number; start: number; end: number; textStart: number; textEnd: number; collapsed: boolean }
type BlinkItem =
  | { kind: 'text'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[];
      runs: BlinkShapeRun[]; partsKnown: boolean; sizeLimit?: GapName }
  | { kind: 'tab'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  | { kind: 'forced-break'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number }
  | { kind: 'hyphen'; run: number; level: number; x: number; inlineSize: number }
  | { kind: 'inline-box'; element: number; x: number; inlineSize: number; hasStartEdge: boolean; hasEndEdge: boolean }
  | { kind: 'atomic'; element: number; level: number; x: number; inlineSize: number; marginStart: number; marginEnd: number }
  | { kind: 'br'; element: number; level: number; x: number; inlineSize: number }
type BlinkGlyphCluster = { textStart: number; textEnd: number; graphemeStarts: number[]; graphemesLimit?: GapName; advance: number; startLimit?: GapName }   // advance in 16.16
type BlinkShapeRun = { textStart: number; textEnd: number; reshaped: { textStart: number; textEnd: number } | null; fontsKnown: boolean }
```

- **Items** are the line's fragment items (`logical_line_builder.cc:200-464`): a text item per non-empty item result,
  a tab item with one space glyph per tab (`shape_result.cc:1898-1938`), a forced-break item (a preserved newline, or a
  `<br>`'s control item, which becomes a `br` item), and the generated hyphen after the text item it ends at an even
  level, before it at an odd level (`PlaceHyphen`, `:447-464`). A span that creates a box fragment has an `inline-box`
  item with its border box on the line (`ShouldCreateBoxFragment`, `line_breaker.cc:3944-3946`; the quads
  `LayoutInline::QuadsForSelfInternal` reports, `layout_inline.cc:428-470`); a culled span has none. An atomic inline is
  an `atomic` item with its border box and margins (`HandleAtomicInline`, `line_breaker.cc:3043-3110`). An emptied
  trailing space, CR and FF in preserve modes, a `<wbr>`'s flow control and open and close tags of culled spans make no
  item. Items are in visual order (`:688-760`).
- **Positions.** In a left-to-right paragraph items start at `lineLeft`, after the text-indent; in a right-to-left one
  they end at `lineRight`, even when the line overflows, and start at −hangWidth before alignment
  (`inline_layout_algorithm.cc:303-311, 361-389`; research/observe-blink.md §4.2). `alignOffset` is what `ApplyTextAlign`
  added (`:943-970`); justification spacing is inside the clusters' advances. Tab stops add `ComputeFloatOffset()`, how far
  floats moved the line start (`line_breaker.cc:674-693`, `:2970`).
- **Clusters** are HarfBuzz clusters, consecutive glyphs sharing one character index, at
  `HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES`: marks, ZWJ before an Extended_Pictographic character, emoji modifiers and
  regional indicator pairs continue a cluster (`hb-ot-shape.cc:466-522, 578-586`), and a font's ligatures merge them.
  `graphemeStarts` lets `CaretPositionForOffset` split a cluster's advance equally among its graphemes
  (`shape_result.cc:310-329`). Advances come from Canvas prefix widths at cluster boundaries, which is where the
  `in-word-prefix`, `unsafe-to-break` and `glyph-clusters` gaps apply.
- **Stand-ins are marked** (ceiling rounds 3 and 4; `engines/blink/geometry.ts` has each condition). A cluster's `startLimit` names the
  gap under which the advance sum before it is a Canvas stand-in (between letters HarfBuzz joins, inside a possible
  ligature, at a pair adjustment no fact places), and a text item's `sizeLimit` the same for its end, which moves the x of
  the items after it. The observation port reports a value as predicted only where the layout knows the item's x and
  the position inside it.
- **Runs** are the runs of the item's shape result, which `PositionForOffset` walks by their character counts and whose
  widths it adds as floats (`shape_result.cc:696-733`), so past 256 zoomed px a caret depends on where the runs are.
  `reshaped` is the text a run's glyphs were shaped from alone, where `ShapeLine` reshaped a line start or end
  (`shaping_line_breaker.cc:309-324`, `:497-553`) or `TruncateLineEndResult` the text before a removed space; null for
  glyphs of the paragraph's shape result. It is what a painter needs to know about a line laid out alone (§7).
  `fontsKnown` says whether the coverage facts name the font of every cluster; otherwise the run may be several.
  `partsKnown` is false where Blink's view may have other parts than the port's: the port's safe offsets pass its own
  width tests, which HarfBuzz's unsafe-to-break flags needn't, so it is false on most wrapped lines, and values within a
  float step of a LayoutUnit edge are then limited past 256 px unless the advances' granularity keeps sums exact. In an
  RTL item whose view may be numbered otherwise, a cluster of several code points carries `graphemesLimit`: Blink lists a
  run's graphemes by the view's part numbers (`shape_result.cc:186-214`).
- **The mapping** is Blink's `OffsetMapping` over the line's source units while it is one-to-one (no `text-transform`):
  a collapsed unit maps to an empty text_content range, and a unit Blink generated, such as U+200B after leading
  preserved spaces, the U+200B of a `<wbr>` or the U+FFFC of an atomic inline, has an empty source range. Trimmed spaces,
  spaces skipped at a line start, and CR and FF in preserve modes are not collapsed: they are in text_content and in no
  item, which is what makes a Range over them report boundary rects (observe-blink §5 items 5, 6, 10).
- **needsAccurateEndPosition** is `LineInfo::NeedsAccurateEndPosition` from `text-align` and direction
  (`line_info.cc:127-175`): where it is true, a line ending at a space is reshaped at its end (`line_breaker.cc:255-268`).

Example, `c-be7f6b754e4527ff` (`ب­ب` U+001E, `pre-wrap`, `break-word`, width 8, 16px Noto Naskh Arabic, LTR block, DPR
2): line 1 has the text item `ب` at x 0 with inlineSize 564; line 2 has the hyphen item at x 0 with inlineSize 660 and
then the soft hyphen's text item at x 660 with inlineSize 0, because the hyphen of an odd-level item comes first
visually.

### 2.4 WebKit geometry

float32 CSS px.

```ts
type WebKitLineGeometry = {
  lineLeft: number            // m_lineLogicalRect's left after floats, before text-indent
  contentEdgeOffset: number   // m_lineContentEdgeOffset: how far floats and text-indent moved the line start
  lineBoxWidth: number        // m_lineLogicalRect.width(): the available width after floats and text-indent
  contentWidth: number        // Line::contentLogicalWidth after close(): trimmed content removed, hanging content, box edges and the hyphen included
  hangingWidth: number        // HangingContent's trailing white-space width (InlineLine.h:370-376)
  contentLogicalRight: number // where an RTL line's content edge comes from (InlineDisplayLineBuilder.cpp:136-138)
  alignmentOffset: number     // horizontalAlignmentOffset
  boxes: WebKitDisplayBox[]   // box index order: visual order
}
type WebKitTextBox = {
  kind: 'text' | 'soft-line-break'; run: number
  start: number; end: number  // the box content, offsets into the run's text
  level: number; isWordSeparator: boolean
  x: number; width: number    // the visual rect
  hyphen: string | null       // needsHyphen: the rendered content ends with this string
  expansion: number           // justification expansion inside width
}
type WebKitDisplayBox =
  | WebKitTextBox
  | { kind: 'inline-box'; element: number; x: number; width: number; hasStartEdge: boolean; hasEndEdge: boolean }
  | { kind: 'atomic'; element: number; level: number; x: number; width: number }
  | { kind: 'line-break'; element: number; x: number; width: number }
```

- **Boxes** are `InlineDisplay::Box`es, one per text or soft-line-break `Line::Run` after trimming, the trailing bidi
  reset, `addTrailingHyphen` and `handleTrailingHangingContent` (`InlineLine.cpp:198-287, 609-619, 745-778`;
  `InlineDisplayContentBuilder.cpp:118-144, 196-325`), plus the non-root inline box of every span on the line with its
  border box, the atomic inline boxes and the line break boxes of `<br>`. They come from the closed run list, the list the
  display code reads; the port's hand-kept `pieces` go (webkit audit F4).
- **Where runs split** (`InlineLine.cpp:375-402`): another layout box, another bidi level, collapsed white space before
  the next text, word spacing at a word separator, a ZWSP separator item, an RTL change between preserved white space
  and other content. `foo   bar` in one node on one line is two boxes, [0, 4) `"foo "` and [6, 9) `"bar"`; units 4 and
  5 are in no box.
- **Trimmed** white space shrinks its run: `foo bar` broken after the space gives box [0, 3) on line 1 and [4, 7) on
  line 2. **Hanging** white space stays inside its box with its width. A preserved newline is its own zero-width box.
- **Positions** are float32 sums from the line's left edge, `lineLeft` plus `contentEdgeOffset` and `alignmentOffset`,
  or from `f32(lineBoxWidth − contentLogicalRight)` in an RTL line (observe-webkit §5), so an RTL line's last right edge
  can sit a float32 step from the content edge (336.0000305175781 for 336). Tab stops read `contentEdgeOffset`
  (`InlineLineBuilder.cpp:478`, `:1042`, `:1076`). Justification adds `expansion` to text boxes
  (`InlineContentAligner.cpp:230-302`).

### 2.5 Gecko geometry

Integer app units.

```ts
type GeckoLineGeometry = {
  appUnitsPerDevPixel: number
  lineLeft: number            // the band's physical left edge from the content box (BeginLineReflow's iStart)
  availableWidth: number      // the band's inline size (availISize); NSToIntRound(f32(width) × 60) without floats
  impactedByFloats: boolean   // the band has floats (aFloatAvailableSpace.HasFloats())
  textIndent: number          // mTextIndent, 0 where it doesn't apply
  width: number               // the line box psd->mICoord after TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985)
  hang: number                // GetHangFrom (nsLineLayout.cpp:3416-3450)
  alignOffset: number         // what TextAlignLine added
  frames: GeckoFrameGeometry[] // logical order; an inline frame before its children's frames
}
type GeckoTextFrame = {
  kind: 'text'; run: number
  contentStart: number; contentEnd: number   // GetContentOffset, GetContentEnd (source offsets)
  measuredStart: number                      // after the line-start skip of trimmable white space
  level: number
  x: number; width: number                   // mRect, after ReorderFrames
  hasHeight: boolean                         // BSize > 0
  usedHyphen: boolean                        // TEXT_HYPHEN_BREAK
  characters: GeckoCharacter[]               // [measuredStart, contentEnd)
}
type GeckoFrameGeometry =
  | GeckoTextFrame
  | { kind: 'inline'; element: number; x: number; width: number; hasStartEdge: boolean; hasEndEdge: boolean }
  | { kind: 'atomic'; element: number; level: number; x: number; width: number }
  | { kind: 'br'; element: number; x: number; width: number }
  | { kind: 'wbr'; element: number; level: number; x: number; width: number }   // 0 × 0 (ceiling round 2)
type GeckoCharacter = { skipped: boolean; clusterStart: boolean; unitStart: boolean; advance: number }
```

- **Frames** are the `nsTextFrame` continuations placed on the line by `ReflowText` (`nsTextFrame.cpp:10847-11532`),
  empty ones included, the `nsInlineFrame` continuation of every span on the line, atomic frames and `BRFrame`s. A text
  frame's box is `ceil(max(0, advance))` less the floored `TrimTrailingWhiteSpace` delta, which is subtracted unclamped
  (`:11268-11273, 11605`). A used soft hyphen adds the hyphen run's advance inside the box after the text
  (`AddHyphenToMetrics`, `:6829-6845`). An inline frame's box has its start edge without a previous continuation and its
  end edge as the last continuation (`nsInlineFrame.cpp:505-522`; `nsLineLayout.cpp:1199-1228`), while every
  continuation reserves the end border and padding while its line fills.
- **Positions.** Frames follow in visual order from `lineLeft` plus the text-indent when the document has bidi enabled
  (`nsBidiPresUtils.cpp:1494-1533`). In an RTL block they are placed from the band's right edge. A wrapped line whose
  trailing white space hangs against its direction moves by `hang` (`nsLineLayout.cpp:3503-3512`), and `alignOffset` is
  what `TextAlignLine` added (`:3482-3670`). Bidi is enabled for the whole document by any RTL text node
  (`CharacterData.cpp:298-302`), which is page history (gecko audit F3; §5 `page-history`).
- **Characters** hold, per source unit, whether TransformText skipped it, the text run's cluster-start flag, and the
  advance `GetAdvanceWidth` adds for it with the spacing after it, justification included (`gfxTextRun.cpp:1214-1256`,
  `nsTextFrame.cpp:4089-4295`). Their sums give `GetPointFromOffset` at every cluster start.
- **impactedByFloats** changes line filling, not only width: a first frame that doesn't fit breaks before instead of
  being placed (`notSafeToBreak`, `nsLineLayout.cpp:785`), and the line start is an optional break (§2.9).

Example: `aaaa bbbb` in 16px Courier New at 86.38px (5183 au) makes two lines (gecko-lines H1). Line 1 has one frame of
run 0 over [0, 5) with width 2304: four 576 au letters, the space trimmed at the break. Line 2's frame over [5, 9) has
width 2304. Each line's `width` is 2304. A space of −90 au trimmed by `TrimTrailingWhiteSpace` grows its frame by 90 au
(`c-79e5272a2644d9b8`).

### 2.6 Line widths

Each engine computes its line width in its own unit, and the output keeps it there. The whole-node Range rects of a
line cover the same extent, so the lab compares them directly (§9):

| Engine | Width | Equals |
|---|---|---|
| Blink | `width`, hanging spaces, text-indent and box edges included; `width − hangWidth` is what alignment uses (`line_info.h:151-166`) | the sum of the items' inlineSize plus the indent and the tag sizes, and the extent of the line's whole-node rects wherever every item is reported by some node range and neither indent nor box edges sit at the line's ends (observe-blink §8) |
| WebKit | `contentWidth` | the union of the line's box rects, hanging white space and a chosen hyphen included, trimmed spaces left out (observe-webkit E2); with box edges, the union of the inline box rects |
| Gecko | `width` | the union of the line's whole-node rects with positive area (observe-gecko E3); with box edges, the union of the inline frames' rects |

Examples: Blink raw 19239 at layout zoom 2 is 19239 / 64 / 2 = 150.3046875 CSS px; Gecko 4320 au is 72 px. The ports
used to return a CSS-px `width` copied from the lab scorer's visibility rules (the three shortcut audits, D1/D3/F9).
That width is gone.

**Shrink-wrap.** A demo that fits a bubble to its text (`pages/demos/bubbles-shared.ts:100-101`) needs a width at which
the paragraph lays out the same lines. Each line's alignment width in CSS px is one: Blink `(width − hangWidth) / 64 /
layoutZoom`, WebKit `contentWidth − hangingWidth`, Gecko `(width − hang) / 60`. At the largest of them every line's
content still passes the engine's fit test, because Blink fits content C (raw) while C ≤ trunc(w × zoom × 64) + 1, WebKit
while it is at most `trunc64(w) + 1/64`, Gecko while its app units are at most `round(w × 60)`, and each holds for w equal
to the content. The next piece of every line didn't fit at the wider width, so it doesn't at the narrower one. A line that
overflowed its available width is outside this rule, since the engines break overflowing lines differently at other
widths (Blink `HandleOverflow`, WebKit `breakWord`).

**Gecko's exception.** Gecko takes a span's end border and padding off the available width on every line of the span,
not only its last (`nsInlineFrame.cpp:514-521`; §2.2, example 5), so a line that ends inside such a span needs more room
than its content is wide, and shrinking to the widest line's content can move a break: on the spans sample of
research/CAPABILITY-CHECK.md, 2 of 55 widths (323px shrinks to 314.85px, and line 1 goes from [0, 45) to [0, 41)). The
width Gecko needs for a line is its content plus the end border and padding of the spans still open at its end. Until a
width helper returns that (an API-phase item, research/PROFILING-START.md), an application that shrink-wraps text with
padded or bordered spans in Firefox counts the lines again at the shrunk width. Blink and WebKit held at every width
tried there (55 of 55 on four samples, on a stand-in Canvas; no browser has run it), and plain text isn't affected in
any engine.

### 2.7 The state the next line starts from

`LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart`, defined in `src/engines/<engine>/geometry.ts`. Each holds
exactly what that engine carries from one line to the next. A start is the state after the previous line in the slot it
was laid out in, and it serves any slot for the next line: native layout carries the same state into a line beside other
floats (Blink hands the break token to the next opportunity, `inline_layout_algorithm.cc:1173`, :1471-1472; WebKit passes
`PreviousLine` with the carried width whatever the next line rect, `InlineFormattingContext.cpp:352-358`; Gecko continues
from the pushed frame).

- **Blink**: `{ engine: 'blink', itemIndex, textOffset, style, afterForcedBreak, isPastFirstFormattedLine, afterLeadingFloats }`, the break
  token (specs/blink-lines.md §4.1). `isPastFirstFormattedLine` is `InlineBreakToken::kIsPastFirstFormattedLine`, which
  decides text-indent (`line_breaker.cc:470-485`, `:4740`). `afterLeadingFloats` says the leading floats were placed: the
  first line handles the floats before any inline content, so later break tokens are past their items, and only the first
  line runs the leading-floats rule that rewinds text-indent (`line_breaker.cc:4225-4248`); the model's slot floats aren't
  items, so the token carries it (added by the Blink owner, 2026-09-17). No width carries over. The next line's start is reshaped
  when it falls inside a shape result at an offset HarfBuzz marked unsafe to break: `ShapeLine` shapes [start, first safe
  offset) alone and moves the available width by the difference between the old and new `ceil64` widths
  (specs/blink-lines.md §6, step 2). That measurement happens while the next line is filled, from the offset in the
  state. After a forced break the line start isn't a wrapped start, so nothing is reshaped.
- **WebKit**: `{ engine: 'webkit', itemIndex, offset, previousLine: { carriedWidth, endsWithLineBreak } | null,
  isFirstFormattedLine }`. `carriedWidth` is the float32 width the rest of a split word keeps without being measured
  again: when `breakWord` keeps a prefix of an item of width W, the rest gets `f32(W − prefix width)`
  (specs/webkit-lines.md §8.2). Remainders compound. `'AV'.repeat(17)` in 16px Arial with `overflow-wrap: anywhere` at
  113.5px starts lines at [0, 11, 22] with the carry, and would start them at [0, 11, 22, 33] if the rest were measured
  fresh. Spans that cross the start are opened again from the item range (`createLineSpanningInlineBoxes`,
  `InlineLineBuilder.cpp:448`), so no box state carries.
- **Gecko**: `{ engine: 'gecko', frame, contentOffset, isFirstLine }`: the frame the continuation starts in and its
  content offset, and whether it is the block's first line (`mLineNumber`, `nsLineLayout.cpp:180-190`). A content offset
  alone can't say whether a start at an atomic inline comes before it or after it. Gecko's redo lives inside one line:
  when a frame overflows after an earlier break position was recorded, the block lays the whole line out again, once,
  with that break forced (specs/gecko-lines.md §4.1, §4.7). `aa b<span style="color:red">bbbbb</span>` in 16px Courier
  New at 57.6px places `aa b` and overflows on `bbbbb`; the redo breaks before `b`, giving `aa` / `bbbbbb`. `fillLine`
  keeps only the final pass's frames; an inspected line keeps the gaps of both passes (§2.8).

### 2.8 Gaps, and the count of Canvas work

A gap is `{ gap, run, detail }` for a §5 condition the paragraph meets. The prediction is still returned; a gap says
where it may be wrong.

- The paragraph's gaps hold the conditions of its content, fonts and environment: `engine-build`, null font facts,
  control characters, sizes Gecko can't match. `prepare` computes them, and `paragraphGaps` adds `engine-build`. In a row
  they are `layout.gaps`.
- A line's gaps hold the conditions its breaks decide: an unsafe offset or an in-word prefix at the chosen edge, a
  shaping-call edge between joining letters. A refused slot's gaps hold what the refusal rests on. Both come from
  `inspectLine`; in a row they are `line.gaps` and `belowFloats[k].gaps`. Filling a line never changes the prepared
  paragraph's gaps, so a prepared paragraph serves lines in other slots, and at other widths, without mixing their gaps
  (DESIGN-REVIEW.md §3.5).
- Gaps are read from a paragraph prepared for inspection (`prepare(paragraph, env, true)`), which the lab always does.
  `inspectLine` and `paragraphGaps` throw on a paragraph prepared plain. A plain paragraph computes no gap and asks
  Canvas nothing that only a gap or an inspected value reads. It gives the inspected paragraph's fill results and pieces
  on every recorded case, from fewer Canvas questions, each one the lab's path asks too; where a later fill needs a
  question that inspection asked first, the plain path first asks it later (`tests/function-set.ts plain`; TESTS.md, "The
  function set's checks"). §4.7 has the questions a paragraph asks on each path.
- Each port keeps every gap condition in one file, `engines/<engine>/gaps.ts`. A function that raises a gap takes a sink
  first (`GapSink`: `Gap[]`, null on a plain paragraph) and returns at once on null, and the measuring only a gap needs is
  done inside it. What a line's filling raises stays on the decided line in raise order, across every pass of the fill, and
  `inspectLine` starts from a copy of it. Blink hands a list out in a canonical form, which doesn't follow how often a
  range was raised (§5). What else only gaps read is in `prepared.inspect`, null on a plain paragraph; nothing else says
  which of the two a paragraph is.
- WebKit reports every condition of the content and fonts on the lines whose filling measured the characters it concerns,
  the content that ended the line included, with `at` naming them; its paragraph keeps only `page-zoom`. The filling
  itself raises the four conditions a break decision shows (`hyphen-glyph`, the 8-bit emergency break's
  `string-storage`, `dictionary-breaks-stand-in` between boxes, `rtl-shaping-across-inline-boxes`); `lineGaps`
  (`engines/webkit/gaps.ts`) adds the conditions of every character the filling measured; `pageHistoryGaps`
  (`engines/webkit/history.ts`) then fills the line in each history world that changes what it read, and raises
  `page-history` through `gaps.ts` (`lineDiffersInHistoryWorld`, which keeps the prose and the merge rule) where the
  world's line differs. The box facts only gaps read, made with each box, and the history worlds are in
  `prepared.inspect`.
- Blink reports the conditions of the content in the paragraph's gaps with `at`, computed in `prepare` from the content
  alone (control characters Canvas replaces, U+FFFC, graphemes whose Canvas strings shape under another script, default
  ignorables left out of 8-bit strings, shaping-group edges inside graphemes, joining edges at group edges), and adds each
  one that concerns the content a line's break decision measured past its end, up to the next break opportunity, to that
  line's gaps. Edge conditions (reshapes, pair adjustments at a chosen edge, positions inside graphemes) stay line gaps
  with `at` naming the offset. A plain paragraph also computes no limit, glyph cluster or offset mapping:
  `engines/blink/limits.ts` holds the limits, and only `gaps.ts` and `inspect.ts` call it.
- Gecko's decided line keeps what its fill raised and the in-word stand-in offsets its break scans consulted, across both
  passes of a redo; `inspectLine` reports from them. What a plain paragraph doesn't ask: the characters of placed frames,
  the space-in-shaping windows, a letter-spaced unit's group count at 2px and the positions a stand-in tab rests on. A
  break candidate inside a word is read whole on both paths, with the questions that put a kerned pair's adjustment or
  a joined suffix's form on one side of it (§4.4); until the profiling phase a plain scan left those out where no fit
  test was near (§4.6).

**Nothing in the library counts or logs what it asks of Canvas.** A row's `measure` is the lab adapter's own count of
the contexts a layout made and its `measureText` calls, taken on the page's Canvas classes (`lab/predictor-core.ts`,
`CanvasWork`; `memoHits` keeps the row's shape and is 0). `run.ts --record-measurements` records every call with its
answer, so a row can be laid out again offline (lab/README.md, "Recorded measurements"), and the replay counts asked and
distinct questions and tallies them by call site from the stack (`tests/replay.ts check --sites`). The ports' tests count
what their stand-in Canvas is asked.

### 2.9 Line slots: an available width per line

Demos flow text beside obstacles and between columns, and give each line its own width (`pages/demos/dynamic-layout.ts:305-331`,
`editorial-engine.ts:446-471`). In a block, what gives line boxes different available widths is floats. A line slot is
where one line box goes: the block's content-box width, and what floats do to that line box, the CSS px they take off the
content box on each side. The width is the slot's and not the paragraph's, because every engine reads it only while it
fills a line: one prepared paragraph serves any width, and a layout at another width prepares nothing again
(`tests/function-set.ts sweep` fills one prepared paragraph at four widths and holds each against a paragraph prepared for
that width alone, plain and inspected, on a stand-in Canvas).

```ts
type LineSlot = { width: number; left: number; right: number }
// src/index.ts, the dispatch over the engines; each engines/<engine>/index.ts gives the same set with its own types
function prepare(paragraph: Paragraph, env: Environment, inspect: boolean): Prepared
function firstLine(prepared: Prepared): LineStart | null
function fillLine(prepared: Prepared, start: LineStart, slot: LineSlot): FillResult          // FillResultOf, §2.1
function linePieces(prepared: Prepared, line: FilledLine): Pieces                            // LinePieces<Facts>
function inspectLine(prepared: Prepared, line: FilledLine | RefusedSlot): LineInspection    // inspected paragraphs only
function paragraphGaps(prepared: Prepared): Gap[]                                            // inspected paragraphs only
// lab/predictor-core.ts, over the function set; `insets` are a case's lineSlots
function layoutParagraph(paragraph: Paragraph, env: Environment, width: number, insets?: readonly { left: number; right: number }[]): ParagraphLayout
```

`prepare` decides once whether the paragraph is inspected. A plain paragraph gives lines and pieces, which is what an
application runs; an inspected one also gives each line's geometry and gaps and the paragraph's gaps, which is what the lab
reads. `linePieces` and `inspectLine` are pure functions of their arguments: the same result twice and in either order
(`tests/function-set.ts pure`). A line start, `firstLine`'s or a fill result's `next`, is small plain data that names
positions in the prepared paragraph's lists and holds nothing of it (§2.7), and a line's pieces are made for that line:
two properties to keep, since a line start made from a source offset, and output an application may hold on to, rest on
them (research/INCREMENTAL-API-READING.md §4).

Each port's functions are its own, over its own decided line. `fillLine` decides where the line breaks and gives the
source range. It makes no fragment, no Blink item and no WebKit display box, and it doesn't trim or align Gecko's line.
`linePieces` and `inspectLine` read the decided line and write nothing:

- Blink's decided line is `LineBreaker::NextLine`'s `LineInfo` with the line start and, inspected, the gaps its filling
  raised; a refused slot keeps the same record, its gaps read from the line that overflowed. `fillLine` (`index.ts`) gives
  the source range from the two line starts. `linePieces` is `pieces.ts`; `inspectLine` is `gaps.ts` `lineGaps`, then
  `inspect.ts`, and it hands the list out canonical (`gaps.ts` `canonicalGaps`, §5). Justification's sizes are data handed
  from `justificationOf` to `itemsOf`, never written into the item results.
- WebKit's decided line is the closed `Line` with the start and the slot it was filled from and in, the builder, the line
  rect, the source range and, inspected, the gaps its filling raised. Its types are in `types.ts` (`WebKitFilledLine`,
  `Line`, and `LineRun`, a tagged union of text, soft line break, element and line-spanning runs). `fillLine` is in
  `lines.ts`, `linePieces` and `lineGeometry` in `output.ts`, and `inspectLine` (`index.ts`) is `gaps.ts` `lineGaps`, then
  `history.ts` `pageHistoryGaps`, then `lineGeometry`.
- Gecko's decided line is the start, the band, the last pass's spans as reflow left them, the next position and, inspected,
  the gaps the passes raised with the in-word stand-in offsets they consulted. `fillLine` (`lines.ts`) runs the passes
  alone. `placement.ts` makes its own placed records from the line's reflowed spans (`lines.ts` `Reflowed`,
  `placement.ts` `Placed`), and trims, aligns and justifies those; `pieces.ts` and `inspect.ts` read them, and
  `inspect.ts` alone measures the characters and then calls `gaps.ts` `lineGaps`.

What a layout at another width asks of Canvas differs by port (research/CAPABILITY-CHECK.md, on a stand-in Canvas;
research/BENCH-NIGHT.md has the browsers' counts): WebKit asks nothing in the common case, Gecko nothing at a width it
has filled before and little at a new one, since what measuring found inside a unit stays on the unit (§4.6), and Blink
asks its positions again at every fill (§4.7).

The insets are the margin-box widths of the floats beside the line, and each engine turns them into its own line offsets
with its own arithmetic, which is why a slot isn't one available width: Blink truncates the content width and each float's
edge to LayoutUnits separately, so `trunc(W) − trunc(w)` can differ from `trunc(W − w)` by a unit. `fillLine` returns the
line the engine places in the slot, or `below-floats` when a slot with an inset can't hold the line's first content and the
engine moves the line box down past the floats instead (CSS 2.1 §9.5). A slot without insets never gives `below-floats`.

Where each engine computes a line's available width with floats, and when it moves a line down:

| Engine | The line's band | What reads the float offset | The line moves below the floats |
|---|---|---|---|
| Blink | `InlineLayoutAlgorithm::Layout` takes every layout opportunity of the exclusion space up front (`AllLayoutOpportunities`, `inline_layout_algorithm.cc:1166-1170`) and makes each line's `LineLayoutOpportunity` from the current one (`ComputeLineLayoutOpportunity`, `:1222-1224`); the available width is `line_right_offset − line_left_offset` (`line_layout_opportunity.h`) | tab stops: `position_ + ComputeFloatOffset()` (`line_breaker.cc:674-693`, `:2970`); item positions | when `line_info.HasOverflow()`, the opportunity is narrower than the container (`IsEqualToAvailableFloatInlineSize` false) and the block wraps, the line is laid out again in the next opportunity (`:1336-1367`); also when the line box is taller than the opportunity (`:1462-1469`) |
| WebKit | `InlineFormattingContext::lineLayout` starts each line rect at the container's horizontal constraints (`InlineFormattingContext.cpp:315-322`); `LineBuilder::initialize` narrows it by the floats intersecting the line's initial height (`floatAvoidingRect`, `InlineLineBuilder.cpp:463-476`, `:1185-1216`; `floatConstraintsForLine`, `InlineFormattingUtils.cpp:185-195`; half-open intersection, `floatContainsLine`, `FloatingContext.cpp:352-359`), then applies text-indent as a start margin (`:454-478`). Candidate content taller than the line queries the floats again (`:1218-1239`) | tab stops: `m_lineContentEdgeOffset` (`:478`, `:1042`, `:1076`), which floats placed while building the line don't move (`:1394-1396`): the lab's slot floats come before the content, so the first build places them and counts from the indent alone; box positions | a candidate whose minimum width doesn't fit while the line is constrained by a float wraps with nothing placed (`:1452-1457`), and the next line's top is the intrusive float's bottom (`logicalTopForNextLine`, `InlineFormattingUtils.cpp:54-103`) |
| Gecko | `nsBlockFrame::ReflowInlineFrames` takes the band at the line's block position (`GetFloatAvailableSpace`, `nsBlockFrame.cpp:5137`; `BlockReflowState.cpp:348-365`; `nsFloatManager::GetFlowArea`, `nsFloatManager.cpp:113-182`) and begins the line at its start and inline size, impacted by floats when the band has them (`nsBlockFrame.cpp:5252-5273`); `PlaceLine` queries again with the line's final block size and redoes the line when more floats narrow it (`RedoMoreFloats`, `:5441`, `:5881-5917`) | tab stops: the frame's distance from the block's content edge (`nsTextFrame.cpp:11063-11067`); frame positions | with floats in the band the line start is a soft break (`nsBlockFrame.cpp:5289-5299`), a first frame that doesn't fit breaks before instead of being placed (`nsLineLayout.cpp:785`), and a break before the first frame redoes the line in the next band (`RedoNextBand`, `nsBlockFrame.cpp:5549-5555`, :5172-5196) |

**The lab's loop.** `layoutParagraph(paragraph, env, width, insets)` (`lab/predictor-core.ts`) prepares the paragraph for
inspection and fills the k-th line box in `{ width, ...insets[k] }` and later ones at the full width. Per line it calls
`fillLine`, then `inspectLine`, then `linePieces`, and a refused slot is inspected alone. A refused slot records
`{ row, gaps }` in `belowFloats`, and the next slot starts from the refusal's `next`: the same start, or another where building the refused line changed the engine's state (WebKit's first build places the slot floats).
A line without a line box takes no block size, so the next line uses the same slot. This equals native layout for floats
of one line height stacked at the block's start, because a line refused in one row is refused in every narrower row the
engine skips at once: the fit tests are monotone in the available width.

**The lab protocol.** A case that exercises slots carries `lineSlots: LineSlot[]` (stage 5, §8.3). The page builds the
paragraph with, before its content, for every row k a `float: left; clear: left` block of width `lineSlots[k].left` and
height `lineHeight`, and where the case has right insets a `float: right; clear: right` block of `lineSlots[k].right`.
Every row's float on a side has a positive width, since a row without a float would stack the next float into its place,
and a zero-width float narrows nothing in WebKit (`floatContainsLine` refuses an empty rect) while it still marks a band
impacted in Gecko. `lineHeight` is a whole px on the block and every element, so LayoutUnits, float32 px and app units all
hold row edges exactly, and atomic inlines are top-aligned and no taller than a line. The predictor calls
`layoutParagraph(paragraph, env, width, lineSlots)` with the case paragraph's width. The declared slots describe the page only when every float sits in its row on
its side, and the scorer checks that from the observed float rects (lab `score.ts` `slotProtocol`): a row whose floats
moved is a protocol row, every metric unobserved. Gecko and WebKit place row 0's second float on the first line only where
it fits beside the indented line (nsLineLayout.cpp:1485-1492, BlockReflowState.cpp:793-798; InlineLineBuilder.cpp:1317-1328,
:1368-1380), so derivation keeps widths at or above each engine's bound (tests `derive.ts` `minimumUnits`); Blink positions
leading floats before any line (inline_layout_algorithm.cc:1115, :1738). The rest of the **slot rows** assumption stays
unchecked: the native line of engine line k has its rect centres inside the row the loop gave it, rows refused by
`belowFloats` skipped. Mixed fonts can make a line box taller than the line height (lab/VALIDATION.md problem 8), which moves
every later row. The painter paints each line with floats of its slot (§7).

## 3. Pipeline per engine

| Stage | Blink | WebKit | Gecko |
|---|---|---|---|
| Text nodes with layout objects | `TextLayoutObjectIsNeeded` (blink-text §2.A) | `textRendererIsNeeded`; VT isn't ASCII white space (webkit-text §2) | 8-bit white-space-only nodes at a line boundary get no frame (gecko-text §3) |
| Inline elements and box edges | open and close tag items with inline sizes; box fragments for spans that aren't culled; shaping groups end at box edges (`line_breaker.cc:3937-4025`, `inline_node.cc:494-527`) | inline box start and end items margin + border + padding wide; the nearest common ancestor's white-space at a wrap opportunity (`InlineFormattingUtils.cpp:300-333, 357-436`) | per-span line data with its own end; end padding reserved on every continuation (`nsLineLayout.cpp:378-416`, `nsInlineFrame.cpp:505-522`) |
| Atomic inlines, `<br>`, `<wbr>` | U+FFFC atomic item; LayoutBR's LF control; opaque U+200B flow control (`inline_items_builder.cc:597-607, 1163-1283`) | atomic, hard line break and word break opportunity items (`InlineItemsBuilder.cpp:91, 1076`; `InlineFormattingUtils.cpp:446-450, 469`) | non-text frames; BRFrame always placed; WBRFrame (`nsLineLayout.cpp:1057-1080, 1273-1278`) |
| Content building | one `text_content` for the block; CR collapses as a space, FF and VT stay literal; a newline is removed only next to ZWSP; the paragraph's trailing space is removed (blink-text §2.C) | per text box: white-space items and word pieces; CR, FF and VT are word content; no segment-break removal; U+2028 and U+2029 force breaks (webkit-text §5) | `TransformText` per mapped flow with one carried in-white-space bit; CR is kept and stops collapsing; East Asian segment-break removal inside one text node; SHY and bidi controls are discarded (gecko-text §6) |
| Bidi | ICU `ubidi` over text_content; off when the result isn't mixed and is LTR; items split at level changes (blink-text §2.D, bidi.md §4) | ICU `ubidi` over paragraph text with LF and TAB as spaces; items split (webkit-text §6, bidi.md §3.2) | `unicode-bidi` over `ReplaceSeparators` text per paragraph; frames split (gecko-text §4) |
| Shaping units | shaping groups: equal `Font` (family, locale, letter and word spacing), direction and script run, no control item or box edge between (blink-text §2.E) | one item of one text box at a time, measured with its following space (webkit-lines §3.3) | text runs across frames with equal font, language and flags and plain box edges; shaping words between U+0020, U+00A0 and invalid characters (gecko-text §5.2, §7.2) |
| Break opportunities | `LazyLineBreakIterator`: the space rule, the Latin-1 pair table, break-all and keep-all, ICU restarted at every line start (blink-text §2.F) | `BreakablePositions`: fast classes, the pair table and a stale fast-forward state, then libicucore with prior context and Apple's quote overrides; edges decided with the next box's style (webkit-text §5.4-§7.4) | `nsLineBreaker` words across frames, ICU4X per word, the ASCII shortcut, cluster filtering, after-hyphen emergency flags (gecko-text §7.3-§10) |
| Widths known before filling | shaping group widths in 16.16 at the zoomed size | stored item widths | integer au per shaping unit |
| Per-line available width | the layout opportunity of the exclusion space (§2.9) | the float-avoiding line rect (§2.9) | the float manager's band (§2.9) |
| Line filling | item loop with `ShapeLine`; overflow walk-back re-breaking at `inline_size − 1px`; whole-line retries for break-anywhere and phrase (blink-lines §4-§10) | three builders; candidate content between wrap opportunities; `InlineContentBreaker`, `breakWord`, the carried remainder (webkit-lines §2-§8) | frame by frame `BreakAndMeasureText` with a line-wide break priority and at most one redo (gecko-lines §4, §6) |
| text-indent and text-align | indent as the start position; `NeedsAccurateEndPosition`; `ApplyTextAlign` (`line_breaker.cc:846-879`, `line_info.cc:127-175`, `inline_layout_algorithm.cc:943-970`) | indent as a start margin; builder eligibility; `horizontalAlignmentOffset`, `InlineContentAligner` (`InlineLineBuilder.cpp:454-478`, `InlineFormattingUtils.cpp:198-260`) | `mTextIndent` on the root span; `TextAlignLine`, `ApplyFrameJustification` (`nsLineLayout.cpp:178-201, 3220-3670`) |
| Measured while filling | line-start and line-end reshapes, tabs, the hyphen | `breakWord` prefixes, tabs, deferred widths | tab stops, the hyphen run |
| Line end | the trailing collapsible space is removed after the line is decided; preserved spaces hang (blink-lines §8) | trimmable content removed; `pre-wrap` hangs, conditionally on the last line (webkit-lines §9.1) | `TrimTrailingWhiteSpace`; `pre-wrap` hangs only the overflowing part (gecko-lines §4.4, §4.8) |
| Units and fit test | LU sums, `position <= available + 1 raw` | float32, `width <= lineWidth + 1/64 − contentRight` | integers, `width + advance − trimmable <= available` |
| Geometry returned | items from `LogicalLineBuilder`, positioned; clusters of placed text and tab items; the line's mapping units | display boxes from the closed `Line::Run` list, positioned | placed frames after `TrimTrailingWhiteSpaceIn` and `ReorderFrames`, with their characters |

Every row differs, so there is no shared content model and no shared line loop. Each engine module owns its whole
pipeline from `Paragraph` to lines. **The engine choice is one switch**, in `src/index.ts`, over `env.engine`. No other
shared file names an engine, outside comments: `src/env.ts`, whose shape is per engine, is the exception
(`tests/independence.test.ts`, whose list of shared files that still name an engine is empty). Where the engines differ
only in data, the shared module takes the data as a parameter and each engine gives its own: its `BidiData`, grapheme
rules, break rules and pair table (`engines/<engine>/data.ts`, parsed when the module loads); what it asks of the runtime
checks (`engines/<engine>/checks.ts`: the Canvas its recipes assume, §1.4, and the font facts it reads, §1.2); and its
painting rules (`engines/<engine>/paint-rules.ts`, a `PaintRules` value the painter takes, §7). Where their browsers
run different algorithms, each algorithm is its own shared module, and each engine imports the one its browser runs:
`breaks/rbbi.ts` or `breaks/icu4x.ts`, `unicode/ubidi.ts` or `unicode/unicode-bidi.ts`.

Each engine's `index.ts` exports the function set of §2.9 with its own types, which `src/index.ts` and the lab's adapter
call; no function takes a measurer, and a prepared paragraph holds its own contexts:

```ts
prepare(paragraph: Paragraph, env: Env, inspect: boolean): Prepared
firstLine(prepared: Prepared): Start | null
fillLine(prepared: Prepared, start: Start, slot: LineSlot): FillResultOf<Start, FilledLine, RefusedSlot>
linePieces(prepared: Prepared, line: FilledLine): LinePieces<PaintFacts>
inspectLine(prepared: Prepared, line: FilledLine | RefusedSlot): LineInspectionOf<Geometry>
paragraphGaps(prepared: Prepared): Gap[]
```

Before the engine runs, `src/index.ts` `prepare` asks Canvas for the font facts the caller left null and a check can
answer (§1.2, §4.6), with what the port says it reads; the engines read `FontFacts` as if the caller had given them.

**Each port's data** (`engines/<engine>/types.ts`; the re-architecture sections of specs/blink-RESULTS.md,
specs/webkit-RESULTS.md and specs/gecko-RESULTS.md have how each got here). The ports hold what they know as typed
records and tagged unions, with no sentinel for "doesn't have one", and Map and Set only where an algorithm needs them.

- Blink. A style is one record, `BlinkStyle`: the computed style with its iterator settings and the span's
  `shouldCreateBoxFragment`, its Canvas contexts, and what measuring keeps beside them (`oneByteContexts` and
  `canvasSplitsWords`, null until first needed, and `hanKerning`). Those two lazy answers, with the contexts the first
  adds to the paragraph's list, are the only prepared data of the port written after `prepare`: facts of the style's
  fonts that no layout changes, asked late because asking earlier would change question order and the context count.
  Items are a tagged union (`TextItem`; `ControlItem`, a text leaf's or an element's; `TagItem`; `AtomicItem`), so no
  item holds `-1` for a leaf or an element it doesn't have, and a text item's shaping group is `groupOfUnit` at its
  start. The port holds no Map and no Set: a line's item results are an array by
  item index from the line's first item (`LineBreaker.shapeResults`; a rewind comes back to the same result, so an item is
  asked once per fill), and tables are generated records searched by binary search, or switches. A line's output reads the
  paragraph around the line and never scans it whole (`pieces.ts` `fragmentsOf` walks the events from the line's first
  result, or the leaf holding its source start, to its last result, or the leaf holding its source end). The break
  iterator (`breaks.ts` `LineBreakIterator`) keeps the boundaries its rule iterator has given so far, pulls the next one
  when a question reaches past them, and answers by binary search. ICU still restarts at every line start, as in Blink,
  and the browser's dictionary segmentation is asked from the line start to the paragraph's end, once a dictionary segment
  is reached: the lab's recorder stores what `next()` returned, so a partial pull would record a partial segmentation.
  `contexts.ts` holds a style's contexts and a measured total (`styleContexts`, `raw16Of`). One cycle of function imports
  is left, between `shape.ts`, `limits.ts` and `gaps.ts`: a measurement raises its range's gaps, and a line's gap tests
  measure, so it stays while one `gaps.ts` owns every condition (§2.8).
- WebKit. A line's runs are a tagged union (`LineRun`: a text run, a soft line break, an element's run with its item's
  `sourceOffset`, a line-spanning inline box start), so no run holds `-1` for a box or an element it doesn't have, or text
  fields without text. A run's trailing white space and a line's trimmable content are a record or null, and the
  breaker's result is a union on its action. A box's inspection record is made in one step, with the box (`gaps.ts`
  `boxMade`, from a family list parsed once, `fonts.ts` `familyNames` over the shared list, `src/font-family.ts`). The
  item builder is `items.ts`; the history worlds and a decided line laid out in them are `history.ts`. No import cycle
  is left, type imports included: `gaps.ts` imports neither the fill nor the content stage, `history.ts` imports the
  fill, the output and `gaps.ts`, and `content.ts` (which collects the worlds when it prepares an inspected paragraph)
  and `index.ts` import `history.ts`.
- Gecko. A text leaf is one record (`GeckoLeaf`: its source range, parent, style, font, language, 8-bit storage, and
  letter and word spacing in au). A text run is cut into shaping units once, where the port of
  `gfxFont::SplitAndInitTextRun` sets the glyph flags (`prepare.ts` `splitAndInitTextRun`), and the measuring step reads
  those units. What measuring found inside a unit is on the unit (`GeckoUnit.inWord`, §4.6). Text runs that measure
  alike share one record of their Canvas contexts (`RunContexts`, held as `GeckoTextRun.contexts`), and what Canvas told
  of a context's pair placement is on that record (`RunContexts.pairPlacement`, §4.6). A frame's tabs are one
  ordered list with each tab's stand-in reason (`lines.ts` `Tab`), one shared empty list where a run has no tab. Reflow's
  frame records and placement's are separate types (§2.9). Of the Maps and Sets that held a paragraph's data one is
  left, in `inspect.ts`, which mirrors Gecko's own `nsContinuationStates` (constant lookup sets and the likely-subtags
  tables aside). Cycles of type imports remain between `gaps.ts`, `lines.ts`, `placement.ts` and `prepare.ts`, and no
  cycle of function imports.

**Size.** Non-test lines of `rebuild/src` without generated data, at the correctness line and at the re-architecture's
end: the shared layer 5,066 to 4,595, Blink 6,470 to 7,195, WebKit 5,699 to 6,033, Gecko 5,233 to 5,850; 22,508 to
23,779 in all, with 40 and 106 lines of test support. The ports grew while the shared layer shrank: what the re-architecture removed was state and reads that
cut across stages (the string memo as data flow, gap building threaded through measuring, lab-only output computed on
every line, engine names in shared code, parallel arrays, sentinels, per-line scans of the whole paragraph), and typed
records with their comments cost about what the removed structures saved. The ports are mostly ported logic with its
citations, and no owner found a larger cut that keeps every rule, citation and gap. Counted the same way after
correctness round 5 and the fresh-eyes follow-up (2026-09-19): the shared layer 4,672, Blink 7,229, WebKit 6,055, Gecko
6,134; 24,196 in all, with the same 106 lines of test support. Round 5 added 312 of the 417 lines (Gecko 281). The
follow-up added the other 105: the one font-family parser (99 lines, where the font checks lost 23 and Gecko's
`fonts.ts` 40), the record Gecko's text runs share (43) and Blink's two rules (25).

Shared, working and tested (§8.2):

- `src/content.ts`: the document-order index of the inline tree, `styleUnder` and `langUnder`.
- `src/breaks/rbbi.ts`: the ICU rule-based break iterator over `.brk` data, with Apple's category overrides and a
  dictionary-segment flag. Blink and WebKit use it for line and grapheme tables.
- `src/breaks/icu4x.ts`: ICU4X's small code point trie and the rule iterator for Firefox's baked data. Gecko's line
  iterator adds LB9, word options, strictness and SA handling on top; that port belongs to the Gecko owner.
- `src/breaks/pair-table.ts`: the lookup in the Latin-1 pair table, whose form Blink's and WebKit's generated tables share.
- `src/unicode/ubidi.ts`: ICU's `ubidi_setPara` with default options, ported from ICU 78.2's `ubidi.cpp`, for Blink and
  WebKit. It returns what they read: the direction (text that isn't mixed gets the paragraph level everywhere, and Blink
  then turns bidi off), the paragraphs, which end after every class-B character with CR LF counted once, and one level
  per code unit, from which `ubidi_getLogicalRun`'s runs follow. Removed characters take the next character's level,
  brackets pair under overrides with no 63-opening limit, and an NSM after a changed closing bracket stays neutral
  (specs/bidi.md §5.1, §5.3). Its test runs ICU itself, linked from Homebrew icu4c 78.3 and from the system libicucore
  (§8.2).
- `src/unicode/unicode-bidi.ts`: the groundwork's port of `unicode-bidi` 0.3.15, for Gecko: one paragraph with no split
  at class B, full levels for text with no RTL content, removed characters at the previous character's level, and the
  crate's quirk that `iter_backwards_from` walks earlier level runs forwards.
- `src/unicode/bidi.ts`: the Bidi_Class tables, named by where they come from (Unicode 17, libicucore), and the class
  lookup. An engine pairs a class table with a bracket table as its `BidiData`.
- `src/unicode/grapheme.ts`: extended grapheme clusters over an engine's rules: Chrome's `char.brk`, libicucore's
  `char.brk` or Firefox's ICU4X data.
- `src/measure/`: Canvas contexts with `width` and `bounds`, font strings, and the runtime checks (§4.6, §1.2, §1.4).
- `src/paint.ts` (§7): the painter's forms and limits over an engine's `PaintRules`; it names no engine.

The bidi data is almost the same for all three: the Unicode 17 bracket table and the crate's Unicode 15 table hold the
same 64 pairs, and Firefox's `icu_properties` Bidi_Class equals ICU 78.2's. macOS 27's libicucore gives the private-use
characters U+F7F0..U+F8FF Apple's own classes (ON, NSM, AL, R, ET, EN) where upstream gives L, so WebKit has its own
class table. The groundwork's Gecko bracket table missed 3 of the 64 pairs (U+0F3A, U+2045, U+2308): its generator's
pattern didn't match entries that wrap across lines in `tables.rs`.

What the resolver sees also differs per engine, and engines build that string themselves (specs/bidi.md §3). Blink adds
U+FFFC for floats and atomic inlines and isolate controls for `dir` (blink-text §2.C.8, §2.D), and keeps U+2029,
U+001C-U+001E and NEL literally in every mode and CR in preserve modes, which end ICU paragraphs. WebKit replaces LF and
TAB with spaces in collapsing boxes but keeps CR and U+001C-U+001E, inserts LF at forced breaks, and wraps a root
`plaintext` paragraph in FSI … PDI (webkit-text §6). Gecko replaces TAB, LF, VT, CR, U+001C-U+001F, U+0085 and U+2029
with spaces and starts a paragraph after each preserved newline (gecko-text §4.2).

## 4. Measurement

### 4.1 Which Canvas

Every engine measures with a main-thread `OffscreenCanvas`:

- Blink: a connected `<canvas>` keeps the element's CSS letter and word spacing, feature settings and optical sizing in
  its font description (specs/blink-canvas.md §1.2), and a worker canvas uses the UI language.
- WebKit: a connected `<canvas>` copies the element's font description (specs/webkit-canvas.md §1.3). It would supply a
  locale, but it needs style updates, and the rest of the description leaks in.
- Gecko: a `<canvas>` element at the DOM's device font size holds the DOM's own advances (probes gecko-port F13, F14),
  and was ceiling round 3's measuring path. It needs `document` and shares the DOM's font groups, and the maintainer
  decided on 2026-09-18 that Gecko measures on an OffscreenCanvas always (CHARTER.md, decision 2). That canvas shapes at
  the CSS size at 60 au per px with a font group of its own (CanvasRenderingContext2D.cpp:4423-4492, :7135-7140) and
  never applies optical sizing. What it leaves: `optical-size`, `bitmap-emoji-size`, `font-size-quantization` and two
  residual classes (specs/gecko-RESULTS.md "Ceiling round 4").

What the recipes below assume of the Canvas API is checked once per page (§1.4, "Canvas checks").

### 4.2 Context settings

A context is identified by its settings (`CanvasSettings` in `src/measure/canvas.ts`), and `contextFor()` makes one
OffscreenCanvas per distinct settings in a prepared paragraph's list (§4.6). Identity matters because Chrome caches shaped
words per canvas.

| Setting | Blink | WebKit | Gecko |
|---|---|---|---|
| `font` | size `f32(size × layoutZoom)`, or the CSS size for fonts with `opticalSizeAxis` (§4.3) | size × `pageZoom`; a generic keyword is named as the family the locale resolves it to (§1.3) | the CSS size behind the quantization gate; Apple Color Emoji also at size × DPR, and under a bold font at weight 400 (synthetic bold's steps, gecko-RESULTS round 4) |
| `lang` | the run's locale, explicit | `''`: OffscreenCanvas has no locale | the run's language, explicit, so Gecko's `explicitLang` is true |
| `letterSpacing` | the run's px: Canvas truncates to 16.16 and turns off liga, clig and calt like the DOM (blink-text H27) | the run's px: the same `WidthIterator` rule | `'0.001px'` when the resolved spacing isn't 0 au (ligatures off, no spacing added), else `'0px'`; spacing added in JS |
| `wordSpacing` | `'0px'`; JS adds `trunc(ws × 65536)` per space except text_content index 0 (blink-text §2.E) | the box's word spacing, which setWordSpacing gives the context's FontCascade (CanvasRenderingContext2DBase.cpp:3299-3324), so WidthIterator adds it in the DOM's float32 order within one item's TextRun; strings split at TABs add it in JS, and the offsets between items follow specs/webkit-lines.md §6.2 (ceiling round 2) | `'0px'`; JS adds au after U+0020 and NBSP (gecko-text §12.2) |
| `textRendering` | `'optimizeLegibility'`: Canvas then shapes whole items exactly for fonts whose GPOS or GSUB lookups contain the space glyph (blink-canvas §1.3, H6) | `'auto'` (no such attribute) | `'auto'` (no width effect) |
| `direction` | the item's direction | `'ltr'`: DOM items measure LTR unless `unicode-bidi` overrides | the bidi run's direction |
| `partition` | `'8bit'` or `'16bit'` | `''` | `''` |

Blink's partition: a string or Canvas word from an 8-bit string is shaped as Latin, and the same characters from a 16-bit
string go through `RunSegmenter`. Both share Chrome's per-canvas cache keys (string and direction, word and direction), so
whichever a canvas shaped first answers both (specs/blink-canvas.md §1.7; probe blink-storage S3). A segmented paragraph,
the only kind that asks both storages of the same characters, measures its one-byte strings on contexts of their own
(`8bit`), made when the first is asked, and its two-byte ones on `16bit`; an unsegmented paragraph keeps one set, since
its two-byte strings are two-byte by their characters alone and Canvas cuts no words from them (`shape.ts` `contextsOf`).
Nothing on the way to Canvas uses a measured string as a key, since V8 would hand Blink a one-byte string afterwards
(`measure/canvas.ts`). Setting word spacing in JS avoids the other order effect, where a cached `" "` keeps its first
offset-0 decision.

The port writes a space as U+2028, which keeps a Canvas string in one piece and makes it 16-bit. One kind of range keeps
U+0020 (`shape.ts` `spacesStay`): in a font Canvas shapes whole, a Latin-1-only range the paragraph shapes as Latin that
holds a space, a character other than white space, no soft hyphen and no character with a script of its own is measured
as an 8-bit string with U+0020 itself. That string is one item shaped as one Latin segment, which is the paragraph's own
shaping (plain_text_node.cc:381-385, harfbuzz_shaper.cc:1072-1077), where `RunSegmenter` resolves the 16-bit string as
Common. Fonts shaped word by word keep U+2028 and the `script-context` condition, since U+0020 would cut the string there.

### 4.3 Font strings and sizes

`canvasFont(font, size)` in `src/measure/font.ts` writes `style weight <size>px family`. `String(size)` is the shortest
decimal that parses back to the same double, so a float32 size reaches the CSS parser unchanged.

- **Blink**: the DOM shapes at the computed size `f32(f32(specified) × f32(layout zoom))`, and both the DOM and Canvas
  floor `f32(size × 100) / 100` (specs/blink-lines.md §2.3). `17.3px` at DPR 2 is `34.599998474121094px`, shaped at
  34.59px in both. Canvas widths are then zoomed px, which is what LayoutUnits count. A font with an opsz axis gets opsz
  and HarfBuzz's ptem at the CSS size in the DOM, so the zoomed Canvas size doesn't reproduce it. With
  `opticalSizeAxis` true Blink measures at the CSS size and scales, which equals the DOM in a clean renderer
  (probes-chrome correction 7); null reports `optical-size` at layout zoom ≠ 1 (§1.2).
- **WebKit**: the CSS size times page zoom. That zoom applies before truncation is unverified (CRITIC.md W5, C10).
- **Gecko**: the DOM size is `NSToIntRound(f32(q10(px)) × 60) / 60`, with Servo's 10-bit size quantization, and Canvas
  quantizes to 7 significant bits (specs/PROBES.md, gecko-canvas H3 correction). An engine measures only when the two
  agree: integers, halves and quarters below 32px agree; 13.33px becomes 13.375px in Canvas, so it reports
  `font-size-quantization`. For Apple Color Emoji at DPR d the DOM asks Core Text at the device size: measure at that
  size and scale, `au = round(W × 60) × apd / 60` (specs/gecko-canvas.md §2 A12). 12px at DPR 2: Canvas at 24px gives
  25px, so the DOM width is 12.5px. `measureText` returns `float(au) / 60` as a float
  (CanvasRenderingContext2D.cpp:5277), so `au = round(W × 60)` is exact only below 2^18 px; the space-in-shaping test runs
  in windows under that, and a wider unit reports `float32-precision`.

### 4.4 Recipes

Exact arithmetic, no epsilons. `W(s)` is `measureText(s).width` in the engine's context.

Blink (specs/blink-lines.md §1, §2; specs/blink-canvas.md §1.5):

```
raw16(word)  = Math.round(W(word) × 65536)                    exact while W < 256 zoomed px
run width    = f32(Σ raw16 over the run's words / 65536)      shape_result.cc:1576
item width   = f32 sum of run widths                          :1609
inline size  = Math.ceil(f32(f32(item width) × 64))           LayoutUnit::FromFloatCeil, raw LU
available    = Math.trunc(f32(f32(width × layoutZoom) × 64))  LayoutUnit(float), raw LU, for a slot without insets
fits         = position + inline size <= available + 1        line_breaker.h:307-317
CSS px       = raw / 64 / layoutZoom
```

Example, zoom 1: `width: 150.3px` gives 9619 raw and the fit bound 9620. A word whose float32 width is 150.3046875 has
ceil64 9620 and fits. At zoom 1.5 the bound is 14429 raw and the word needs 14430, so it doesn't
(specs/blink-lines.md §2.4).

WebKit (specs/webkit-lines.md §1.4, §3.3; specs/webkit-canvas.md §(e)):

```
w(item)   = text[end] === ' ' ? f32(max(0, f32(W(item + ' ') − f32(W(' ') + wordSpacing)))) : max(0, W(item))
a run     = { left: f32(previous right + word spacing if a separator), width }; merging adds f32(width + w)
available = f32(f32(lineWidthLU / 64 + 1/64) − content right)
```

Example: `width: 100.3px` truncates to 6419 LU = 100.296875px; an empty line's available width is 100.3125. Content of
float32 width 100.3125 fits; 100.31251 doesn't.

Gecko (specs/gecko-lines.md §2; specs/gecko-canvas.md §2, §3):

```
au(unit)     = Math.round(W(unit) × 60)        per shaping unit; exact below 2^23 au
space        = Math.round(W(' ') × 60)
letter space = NS_lroundf(f32(px) × 60) after each cluster end whose base isn't in a cursive script
fits         = width + advance − trimmable <= available   integers
frame width  = ceil(advance)
```

Example: in 16px Courier New every ASCII glyph is 576 au, so `aaaa bbbb` is 5184 au. At `width: 86.4px` (5184 au) it
is 1 line; at 86.38px (5183 au) it is 2 (gecko-lines H1).

**Recipes added in correctness round 5** (2026-09-19; research/CORRECTNESS-ROUND-5.md has the cases each one gained).
Each was chosen by what the fact depends on: engine or Unicode data is a ported rule, and a fact about the font is
asked of Canvas at runtime, never kept in a table per font. Each says what it costs and its unit of asking: what a
question is asked once per, which is the smallest thing its answer depends on. "Told" means Canvas decided the value,
so it carries no gap; a stand-in is a value returned under a gap.

Gecko, which glyph of a kerned pair carries the adjustment, where `pairKerning` is null (`advance.ts`
`pairKernedShare`, `placedTotals`, `toldBy`). Gecko rounds each glyph's advance to app units
(gfxHarfBuzzShaper.cpp:1699-1702), and HarfBuzz places a pair adjustment in one of three ways: GPOS puts all of it on
the first glyph (PairSet.hh:126-127), the kern and kerx pair machine half on each (hb-kern.hh:102-106), a kerx or kern
state machine all of it on the second (hb-aat-layout-kerx-table.hh:296-333). Where the fractions fall so, the three
give totals one app unit apart:

```
R            = what the unit's shaping moves across the offset: W(unit) less its two measured sides, in au
alone        = au(pair) − au(first) − au(second) at the run's size, which must be R, or within 2 au of it for halves
first, second, pair = au at the largest 2^k × size under 2000px, / 2^k         unrounded (gfxFont.cpp:4956-4960)
half         = (pair − first − second) / 2
halves       = r(first + half) − r(first) + r(second + next + half) − r(second + next)
on the first = r(first + 2 × half) − r(first)
on the second = r(second + 2 × half) − r(second)
r(x)         = floor(x + 0.5), and nothing where x is within its inputs' reach of a tie
told         = the one of halves and on the first that equals R, where the other two don't
```

`next` is the half of the following pair's adjustment that the second glyph holds in the suffix. Nothing is told near a
rounding tie, where the clusters alone at the larger size don't round to the run's advances (a font that isn't linear
in the size: Hoefler Text, `system-ui`), or where only the third placement gives R, for which the port has no value.
Both clusters and the one after them must be printable ASCII. The offset's own pair is tried first. Where it doesn't
tell, 16 probe pairs of printable ASCII (`PROBE_PAIRS`, in a fixed order, each sharing a letter with one before it; a
probe-string choice, not font data) are measured alone in the run's context and strike placements out together
(`askedPlacement`). What they tell is about the face that draws them, so it counts for the text's pair only where
Canvas shows that face draws one of its clusters: the cluster is a probe letter, or measures together with one of the
first four probe letters other than apart, in either order (`sameFace`; probe gecko-mainfacts M5 has two faces under
one declaration placing their pairs two ways). A told placement must also give the pair's own R where the fractions let
it be computed. A pair that isn't told keeps the default, all on the first glyph, and its `in-word-prefix` gap; a
stand-in beside a told offset takes the told placement. One inference stays that Canvas can't close: a face places all
its Latin pairs one way. HarfBuzz chooses between GPOS and the kern machine once per face, script and language
(hb-ot-shape.cc:131-187); nothing says so for a kerx table that holds both subtable kinds or for a GPOS second value
record. None of 1,008 installed faces does otherwise, and a held-out probe of the landed code has 1,781 of 1,782 told
lines equal to the DOM, the other in the registered 1 au class. Cost and unit: per offset whose whole advance is
needed, 3 questions at the run's size and up to 5 at the larger one; per Canvas context of a prepared paragraph, once,
the probe pairs (3 questions a pair that doesn't kern, 6 a pair that does, none for a pair that shares no letter with
those that counted; a median of 30 and of 24 over the two probes' fonts), which end at the first pair that kerns in a
font that isn't linear in the size; per distinct cluster of a context, once, up to 8 for the same-face test. The
answers depend on the font declaration and the language alone, so a home that outlives a paragraph would pay them once
per declaration; it is not built (§4.6).

Gecko, a joined suffix that a fallback font draws (`advance.ts` `sidesAdvance`). U+200D at the start of a Canvas string
takes the font group's first valid font (gfxTextRun.cpp:3609-3613, :3311-3318), and the letter after it takes that font
only where the font has the letter (:3320-3325). So such a suffix is a font range of its own, shaped without the U+200D
in its word-initial form, which the unit doesn't give it:

```
behind = au(letter U+200C U+200D suffix) − au(letter U+200C)       the suffix's own first letter in front
where au(prefix U+200D) + behind = au(unit), the prefix's side is the advance
```

It stays a stand-in under `in-word-prefix`: probe gecko-mainfacts M2 has the prefix's side equal to the DOM's advance
at 16 of 18 such offsets and 3 au off at 2. Unit: per offset between joined letters whose two U+200D sides don't add
up, 2 questions.

Gecko, a boundary U+00A0: `au(U+00A0)`, as the space is `au(' ')`. The DOM shapes it as a word of its own, the character
itself (gfxFont.cpp:3317-3330, :3834-3861), with the space glyph only where the font has no glyph for it
(gfxHarfBuzzShaper.cpp:113-118). Probe M4: 43 of 249 styles give it another advance than the space (16px Hoefler Text
754 au against 240). Unit: per text run that has one, 1 question, at its first one. Under a list whose first family is
"Apple Color Emoji" the DOM takes the glyph's device-size advance, which the port doesn't handle (no tier case has it).

WebKit, the font code path is the measured string's (`measure.ts` `isComplexCodePath`, a port of
FontCascade::characterRangeCodePath). `FontCascade::width` chooses the simple or the complex path from the TextRun it is
handed (FontCascade.cpp:304-309, :708-730), `TextUtil::width` hands it the measured range alone (TextUtil.cpp:84-89),
and Canvas measures through the same function. The box's path, over its whole text, decides simplified measuring,
`breakWord`, `firstUserPerceivedCharacterLength` and the runs shaped across inline boxes, and no width. It is a ported
rule with no new recipe: the letter-spaced ligature recipe (§5) and `control-character-width` now run where the
engine's own choice says they apply, `simplePath = box.simpleFontCodePath || !isComplexCodePath(string)`. Cost: nothing
without letter spacing or in a simple-path box; 2 questions (the separated string's two totals) per measured string
with a merged pair and no complex-path character, in a letter-spaced complex-path box. The unit is the measured string,
since the question is the string.

WebKit, a box's space: `WebKitBox.spaceWidth = W(' ')` in the box's context, a number measured once as the box is made
(`content.ts` `makeBox`). Until the round a box whose white space is deferred (a reordered paragraph, or preserved
white space with a TAB) asked it at every read, about three questions a word. Same string, same context, no width
changes. Unit: per box, which is per text run, 1 question; a deferred box that never reads its space asks one it
didn't (§4.7).

Blink, the pair window (`shape.ts` `pairAdjust16`, `windowAdjust16`, `holdsNoBase`):
`W16(a..b) − W16(a..k) − W16(k..b)` over the clusters on both sides of offset k. A side that holds only
default-ignorable characters already reached to the next cluster; now a side that holds only such characters and marks
does too. HarfBuzz's lookups skip default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571) and marks where the
lookup says IgnoreMarks (:561-562), which the kern machine always does (hb-kern.hh:58), so two letters adjust each other
across SHY and a kasra as they do across the kasra alone (probe blink-cr5 Z). Where a font's lookup doesn't skip marks,
Canvas measures 0 across the wider window, so the recipe can't guess. Which glyph carries the adjustment stays
`pairBefore16`'s. Cost: the same three strings, one of them longer; no count moved in the 66,328 tier cases without
such a cluster. Unit: per consulted offset beside such a cluster. It can't be asked once per font, because it is about
this text's clusters, and nothing is kept.

**Recipe added in the profiling phase** (2026-09-19; research/PROFILING-START.md, item 3).

Gecko, windows inside a long shaping unit (`advance.ts` `windowAt`, `windowsOf`). Every in-word recipe measures to its
unit's end, and Gecko shapes a word of any length in one call (gfxFont.cpp:3804-3808; ShapeFragmentWithoutWordCache
cuts only at 32,760 units, :3564-3617). Text without spaces is one unit, so the characters sent to Canvas grew with the
square of its length. No cut inside a unit is exact by the source, so Canvas decides each one:

```
cells        = every 16 clusters of a unit of more than 32 code units; the last cell keeps what is left under two cells
a cut holds  = no letters join across it and no mark starts its cluster,
               au(left cell) + au(right cell) = au(both cells),
               the pair of clusters around it has one ink box with and without ligatures (ligatureAcross),
               groups(left cell) + groups(right cell) = groups(both cells)      groups = (au at 2px − au at 0.001px) / 120
a window     = the cells between two cuts that hold; a cut that doesn't hold leaves its two cells in one window,
               which is measured whole
the windows' au must add up to au(unit), else the unit has no windows
```

A window is a unit to every recipe: the advance before it is the sum of the windows before it, and an offset inside it
is measured against the window's end. One kind of unit has no windows: a right-to-left script in a left-to-right run,
which a direction override makes. HarfBuzz shapes it reversed or not by what its whole buffer holds (a buffer of digits
without a letter stays left to right, hb-ot-shape.cc:588-645; `shapedReversed`), so Canvas can shape a window of digits
alone the other way round than the DOM shapes the unit. With windows there, Hebrew letters and sixty digits under U+202D
in 24px Arial broke a line one cluster late in pinned Firefox, where the long recipe gives the native break (the item's
review, lab set of `tools/windows-attack-cases.ts`; `windows-reversed.test.ts`).

The tests are the ones the recipes make before they call any in-word advance exact (the sides add up, no ligature
group spans the offset), made over 16 clusters on each side of the cut. Probe
gecko-windows W1 and W2 (pinned Firefox 156.0; 54 samples: Han, kana, Hangul, Arabic, Thai, Khmer, Burmese, Devanagari,
Latin, Latin inside Han across a font fallback edge and an emoji sequence, in the lab's named fonts, 11 of them with
letter spacing; every cluster boundary tried as a cut, in 16 grid phases): of 14,943 cuts tried the text rules keep
1,110 out, 377 fail the sum, 21 the ink box and none the group count. All 13,435 that hold give the long recipe's
W(unit) − W(suffix), and 13,135 of them the DOM's advance; the other 300 are where the long recipe misses the DOM by
the same amount (Noto Nastaliq Urdu, whose unit Canvas measures 108 au narrower than the DOM, and an emoji's
device-size advance, which the port corrects apart). Inside the windows of the port's own grid, 14,040 of 14,040
offsets whose sides add up give the long recipe's value, and in all 864 walks the windows add up to the unit. Between
joined Arabic letters the text rule decides: 3 such cuts would have passed Canvas's tests.

Cost and unit: per unit of more than 32 code units, once, at its first in-word ask: 2 questions a cell (the cell alone,
and with the cell before it), and where the sums hold 2 for the ink box and 4 for the group counts; a window of three
cells or more is measured once more. From then on no question of the unit's offsets is longer than two cells. In pinned
Firefox a Chinese chat message of the bench (mean 122 units) sends 2,944 units to Canvas where it sent 23,499, in 516.5
calls where it made 478.0, and one Chinese unit of 9,428 units sends 0.23 M units where it sent 41.7 M
(`tools/fill-counts-probe.ts`). A unit of at most 32 code units asks what it asked: tier 1 has 61,897 of 63,771 cases
the same. In the output one number moves: an `in-word-prefix` gap's detail prints W(unit), which is the width of what
the recipe measured in, inside a long unit the window's (39 tier cases).

Box edges, indents and slot insets are declared lengths, so they need no recipe: each engine converts them with its
style system's arithmetic, and no Canvas call reads them.

### 4.5 When measurement happens

Engines measure when the engine does, because Chrome's cache makes order visible and because measuring what the engine
never measures wastes calls. Engine-true output adds one kind of measurement: the advances inside placed content.

| | before filling (`prepare`) | while filling (`fillLine`) | for the geometry of a placed line |
|---|---|---|---|
| Blink | every shaping group's words | [start, first safe) at a wrapped line start; [last safe, break) at a line end that isn't at a space, or at any line end where `NeedsAccurateEndPosition` holds; tab widths at their position; the hyphen, once per result | prefix widths at the cluster boundaries of the line's text and tab items |
| WebKit | stored widths of word pieces and single spaces; per box its single space, measured once as the box is made (`WebKitBox.spaceWidth`) | `breakWord` prefixes from the item start (a bisection over O(log n) prefixes); widths deferred by bidi splits; preserved white space containing TAB; the hyphen string | nothing: boxes are sums of item widths |
| Gecko | every shaping unit's advance; the space and a boundary U+00A0, each once a text run | tab stops from the containing block's space width; the hyphen run; in-word advances at break candidates, on a plain paragraph without the pair-placement and joined-suffix questions unless a fit test or an edge needs the whole advance (§4.6) | per-character advances inside the line's frames, `W(unit) − W(suffix)` at cluster starts, and the justification spacing |

The third column is what the charter's tentpole 8 asks to record: it costs a Canvas call per cluster boundary of placed
text in Blink and Gecko, which the lab counts and records like every other call (§4.6). It belongs to the inspected
path: `inspectLine` alone asks it, on an inspected paragraph. `linePieces` asks little: in Blink the prefix before
hanging spaces inside an item, for `overflows`; in Gecko the trimmed white space's advance where it lies inside a
shaping unit (U+1680); in WebKit nothing.

An inspected paragraph also measures for gaps alone, in every column, and a plain one asks none of it (§2.8 has the
counts). Blink: the script work at letter spacing 0, the position bounds around a break candidate, the limit a wrapped
line start's clamp rests on with the line laid out the other way, a fit test's rounding slack, the hyphen's U+002D, the
float sum's per-cluster advances and every no-ligature window. WebKit: LastResort beside the coverage test, the item
widths of the history worlds, per line the conditions' own tests, and every line again in each history world that changes
an item it read. Gecko: the space-in-shaping windows, a letter-spaced unit's group count at 2px, the positions a stand-in
tab rests on and the in-word report's positions.

### 4.6 Contexts, and values kept instead of asked again

A port asks Canvas through three functions of `measure/canvas.ts`, which is all the file holds.
`contextFor(contexts, settings)` finds a context in a paragraph's few by comparing its settings, and makes it when none
has them. `width(context, text)` and `bounds(context, text)` always ask Canvas: what is measured twice is asked twice, so
a value needed twice is kept by the code that needs it. The string a port built reaches Canvas as the object it is, never
as a key (research/BLINK-STRING-STORAGE.md). Measuring the same text in the same context again returns the same bits in
all three engines (Blink returns its cached node for the whole string; WebKit and Gecko shape the same way), so asking
again can't change a result, only cost a call (§4.7).

No function takes a measurer. A prepared paragraph keeps the list of its contexts, which lives as long as it does and
serves every line filled from it, at any width. The records that measure hold their contexts by reference:

- Blink: a style holds its contexts (`types.ts` `StyleContexts`: shaping LTR and RTL, the same two without ligatures, and
  the hyphen's), on the style's one record, `BlinkStyle.contexts`, and `BlinkStyle.oneByteContexts` in a segmented
  paragraph (§4.2), made by `contexts.ts` `styleContexts`. An inspected paragraph makes the one-byte contexts for the
  hyphen only where `mapsHyphen` is null and it measures U+002D (`gaps.ts` `hyphenGlyph`). The list is
  `BlinkPrepared.canvases`, and styles with equal settings share a context. `Shaper` is `{ p, gaps }`: whatever reaches
  `measure16` takes it, because every measurement raises its range's gaps (§5), and a helper that measures without
  raising a gap takes the prepared paragraph alone.
- WebKit: a box holds the four contexts it measures in (`WebKitBox.context`, `plainContext`, `spacedContext`,
  `countContext`), an inspected paragraph's box facts hold theirs (`WebKitBoxInspect.localeChoosesFonts`), and the list
  is `WebKitPrepared.contexts`, all made while the paragraph is prepared, which a history world shares. Every read is
  `width`.
- Gecko: text runs that measure alike share one record of their contexts (`types.ts` `RunContexts`, held as
  `GeckoTextRun.contexts`): one per distinct own context of the paragraph, so per font declaration, language, direction
  and ligature state. It holds the run's own context, and the three a recipe makes from it: letter spacing 0.001px
  (ligatures off), letter spacing 2px (which counts ligature groups), and the size times a power of two. Each of the
  three is found in `GeckoPrepared.contexts` or made at its end where a recipe first asks, and read from the record from
  then on (until the fresh-eyes follow-up a recipe found its context by its settings at every ask). They aren't made in
  `prepare`, because most paragraphs never ask them and the replay counts every context made. The size a larger context
  is made at comes from the run's font declaration, not from the context's font string. The record also holds what
  Canvas told of the context's pair placement (`pairPlacement`, below), asked once per context. The contexts only
  `prepare`'s step 7 reads (the device size, "Apple Color Emoji" alone, weight 400) are made from the run's settings
  where a word or a cluster asks, and the block's context for tabs once per paragraph.

What a port needs twice it keeps as a value in a plain place: a local, a value handed from the step that measured it to
the step that uses it, a field set where `prepare` already measures, and in Gecko one record per offset, on the offset's
shaping unit, and one per Canvas context for pair placement. Nothing is asked earlier than the engine needs it, but for
the space of a WebKit box that never reads it (§4.7).

- Blink: a piece's measured total goes from the cut search to the group's prefixes, which are sums of those totals
  (`shape.ts` `addPieces`); `windowAdjust16` takes its window's total from its caller; `floatWidthOfParts` measures a
  view's part and run edges once each; `inspect.ts` `shapeOf` carries the advance sum before the cluster it is making, so
  a cluster edge is measured once; and `shape.ts` `offsetForPosition` keeps the positions at `low` and past `high` in
  two locals, the only indices its binary search comes back to. The last two need gap lists that don't follow how often
  a range is raised (§5).
- WebKit: `mergedGlyphs` totals a string once in the count context; `controlIsAdjusted` asks the letter before a control
  once; `lineHyphenWidth` measures the hyphen once and hands the total to the `hyphen-glyph` test
  (`gaps.ts` `hyphenWidthRead`); the coverage test of `makeBox` asks each code point once; and a box keeps its single
  space, measured once as the box is made, for boxes whose white space is deferred too (`WebKitBox.spaceWidth`, §4.5;
  correctness round 5).
- Gecko: what measuring found inside a shaping unit is kept by the unit (`GeckoUnit.inWord`, `types.ts` `InWord` and
  `InWordEntry`: the unit's ligature group count, a long unit's windows (§4.4), and per offset the advance with its
  reason, the optional-ligature and required-group facts, the row of ligature candidates and the suffix width), made
  when an offset inside the unit first asks. Until correctness round 5 it was the only part of Gecko's prepared paragraph, beside the context list, that is
  written after preparation: facts of the unit's text in its text run, which no width and no line changes, and which go
  with the paragraph. They are filled on first read only because filling them in `prepare` would ask Canvas questions no
  line needs and would move first asks (`lines.ts` `groupEndSpacing` reads the records on every call instead of keeping
  a memo of its own). A fill, a placement, an inspection and a layout at another width measure an offset once; the
  advance before the next cluster reads the suffix width its neighbour measured (`suffixAlone`); a text run asks for
  its space and for its boundary U+00A0 once each; an emoji cluster's width and ink box come from one `measureText` per
  context.

  Correctness round 5 added two more parts that are written after preparation. Its critic asked that they be written
  down here as exceptions, and the orchestrator accepted both (2026-09-19; research/CORRECTNESS-ROUND-5.md, the critic's
  section 6). One is left. The other, `InWordEntry.unrefined`, kept an offset's two measured sides while its advance
  lacked the questions of §4.4 that only a chosen edge asked, so a record's value followed who asked first; it went
  with the lazy plain scan (below). What the one that is left holds is a fact of the paragraph's fonts, which no width
  changes; it is made when first asked, and it goes with the paragraph.
  - `RunContexts.pairPlacement`: what Canvas told of a context's pair placement (`types.ts` `PairPlacement`), null
    until an offset at a kerned pair asks: the placement, the probe letters that told it with their widths alone
    (`tellers`, `tellerAu`), and the clusters Canvas showed to be drawn by the probe letters' face, or didn't
    (`sameFace`, `otherFace`). The answer depends on the context alone, so whichever offset asks first gets what any
    other would. It sits on the record the context's text runs share (above) since the fresh-eyes follow-up; round 5
    kept a list on the prepared paragraph, `GeckoPrepared.pairPlacements`, searched by the context's reference at
    every ask.

  The record's three recipe contexts are filled after preparation too. They are references to contexts the list got
  at the same points as before, so no new fact is written: the follow-up's critic compared what is written after
  `prepare` before and after the change, and found the context list, `pairPlacements` and the units' `inWord` before,
  and the context list, the record's four fields and `inWord` after.

  `PairPlacement.sameFace` and `otherFace` are found by a cluster's string, which is the second accepted exception.
  They are two lists of cluster strings per Canvas context of a prepared paragraph, searched with `includes`
  (`advance.ts` `sameFace`; a probe letter is found in `tellers` the same way, and `tellerAu` is read by index beside
  it). What is kept under the string is a verdict about a face, asked of Canvas once with up to 8 questions, and not a
  measured width. A list holds at most the paragraph's distinct printable ASCII clusters, and it lives as long as the
  prepared paragraph. It is not a store of measured widths and answers no `width` call; it is the one exception to the
  sentence below this list.

No measured value is found by its string, so a string that recurs in a paragraph is measured at each occurrence (§4.7).
The one thing found by a string is a verdict and not a width: Gecko's same-face lists above.

**Gecko's lazy plain scan, taken out in the profiling phase** (research/PROFILING-START.md, item 8). Correctness
round 5 made a plain paragraph's break scan read a candidate inside a word without the two recipes' questions that
only move what crosses the offset to one side of it (§4.4), within a bound, and ask for the whole advance where the
bound reached a fit test; the scan's start, the frame's end and the chosen break always took whole advances. It
existed for cost: `overflow-wrap: break-word` makes every cluster of each line's first word a break candidate. It was
the most intricate part of the Gecko port, a structure of the port's own and not a browser rule; it made a record's
value depend on who asked first, and the round's critic found a real hole in it (fixed with a local and a unit test).
Measured in the profiling phase, it bought about 40 ms per 10,000 chat messages in Firefox (6 to 7% of plain ASCII at
0.59 s; 8 to 9 questions a message, not the 31 of the round's first build), in the engine that is furthest under the
bar. So it went: a plain paragraph's scan reads every candidate whole, as an inspected one does, the plain path asks a
subset of the inspected path's questions because it runs the same reads and leaves out only what gaps and inspection
ask, and its lines are the inspected path's because both read the same advances. `rebuild/src` is 46 lines shorter,
and `lazy-scan.test.ts` went with it.

The runtime font checks (§1.2) run once per `prepare`, before the engine, through `contextFor` and `width`. What a call
keeps is local to it: its contexts, which carry `partition: 'font-checks'`, so no engine measurement shares a Blink word
cache with them; the declarations it resolved, each once under its language, compared field by field; and the questions
it asked with Canvas's answers, because checks share questions (the two generics alone, a family's list at the probe
size, which the primary family check and the fixed-pitch check both read, and which declarations of several sizes
share). No engine needs that list of questions for correctness, since a question asked again gets the same answer; it
is kept because deleting it only adds Canvas calls (without it 4,692 Chrome and 27,014 webkit-host cases without facts
repeat a font-check question; Gecko's checks ask nothing). The Canvas checks of engine detection (§1.4) make their own
contexts. The checks run before the engine and don't know whether the paragraph is plain or inspected, so one of them
asks Canvas on a plain paragraph for what only a gap reads: Blink's linear-size check answers `false` or nothing, `false`
is also the default a named family gets (`engines/blink/content.ts` `measuresAtCssSize`), so its answer decides whether
`optical-size` is reported and never how the port measures. The primary family check beside it does decide measuring,
where a list's first family doesn't exist and the realized one is the system font (research/PROFILING-START.md, item 1).

**The measurer's lifetime is the first item of the profiling phase, not a thing of this design.** Contexts and
font-check answers are made per prepared paragraph today, which is what makes every paragraph's measuring independent of
every other's and tier 1 sound per case. It is also most of what a chat message costs from scratch (§4.7;
research/PROFILING-START.md, item 1): the font checks run per paragraph, 10.7 `measureText` calls and 6.4 contexts a chat
message in Chrome, 9.5 and 4.2 in WebKit, 0 in Firefox. An object the caller makes once per page, which holds the
contexts and the checks' answers per font declaration, pays them once; in Chrome it changes which canvas has shaped what
before a paragraph asks, so it needs browser proof in several orders before it lands.

### 4.7 What removing the memo cost

Until the re-architecture a memo per context answered every width a paragraph asked for twice, found by its string. The
re-architecture took it out on purpose (research/ARCHITECTURE-PLAN-2.md, decision 4): it was the ports' data flow, since
a value one step measured reached the next through a lookup by string, and the simple version keeps no structure that
stores measured values. Without it a question asked twice is asked of Canvas twice. Canvas questions a paragraph over each
browser's recorded cases (Chrome 67,065, webkit-host 63,987, Firefox 63,771), without supplied font facts and with the
lab's. The lab path is a paragraph prepared for inspection with every line inspected, as the lab's adapter runs it; the
plain path is what an application runs (§2.8).

| | Lab path, memo | Lab path, now | Distinct | Plain path, memo | Plain path, now | Distinct |
|---|---|---|---|---|---|---|
| Blink, no facts | 99.97 | 736.2 | 99.74 | 61.18 | 234.3 | 61.02 |
| Blink, lab facts | 91.91 | 775.6 | 91.68 | 48.49 | 224.3 | 48.33 |
| WebKit, no facts | 31.81 | 88.79 | 31.81 | 26.14 | 39.32 | 26.14 |
| WebKit, lab facts | 19.18 | 59.86 | 19.18 | 12.38 | 21.65 | 12.38 |
| Gecko, no facts | 74.2 | 114.5 | 69.04 | 40.7 | 54.5 | 38.60 |
| Gecko, lab facts | 74.5 | 115.7 | 69.20 | 40.8 | 55.1 | 38.66 |

"Memo" is the library with its memo, at the step where the plain path became real (X1, §8.3; ink-box reads never went
through the memo, which is why Blink's and Gecko's memo columns sit above their distinct ones). Before that step every
paragraph ran the lab path, and at the correctness line Chrome asked 100 questions a paragraph, Firefox 74 and
webkit-host 32. "Now" is the library as it is; the last steps of the re-architecture changed no question. With the memo
off and nothing else changed, the lab path without facts asked 1,055.8 in Blink, 98.90 in WebKit and 134.9 in Gecko; the
values kept in §4.6 bring it to the table's numbers. Blink's came in two steps: 1,016.8 and 1,055.7 on the lab path and
250.7 and 240.8 on the plain path when the memo went, and the table's once gap lists were canonical (§5). Blink's
distinct questions never moved, so everything added is a repeat. The ratio of asked to distinct questions is 7.38 and
8.46 on Blink's lab path and 3.84 and 4.64 on its plain path, 2.79 and 3.12 on WebKit's lab path and 1.50 and 1.75 on
its plain path, 1.66 and 1.67 on Gecko's lab path and 1.41 and 1.42 on its plain path. The plan expected the
application's path to barely move. It didn't hold: the plain path asks 1.4 to 1.75 times its distinct questions in Gecko
and WebKit, and about 4 times in Blink.

Where the repeats are (`tests/replay.ts check --sites`; the re-architecture sections of specs/blink-RESULTS.md,
specs/webkit-RESULTS.md and specs/gecko-RESULTS.md list every site):

- Blink, 42.7 M repeats without facts: the pair window is 69.1%, a position's prefix 10.7%, the wide window 9.2%, the
  script split 6.5% and `adjust16`'s totals 4.1%; `inspectLine` asks 51.7% of them and `fillLine` 43.5%. On the plain
  path 70% of the repeats fall inside one `fillLine` call: the start's position, the binary search, the safe tests and
  the view's edges ask about the same offsets.
- WebKit, 3.6 M on the lab path without facts: 1.5 M are `mergedGlyphs` under `itemGaps`, which `prepare` derived for an
  item and a line's inspection asks again; on the plain path 267 thousand of 844 thousand are words that recur.
- Gecko, 2.9 M: the ligature pair in its two contexts (`ligatureAcross`, 1.24 M) and the cluster before an offset alone
  (`inWordAdvance`, 0.81 M), 62% under `inspectLine`; every one is a string that recurs.

With two exceptions in WebKit, every remaining repeat is the same string met again: a letter, a ligature pair, a word,
or in Blink the same offsets asked by several steps of one fill. No value flows from one occurrence to the next except
by its string or its offset, so only a store found by string or by offset can answer it, and the plan's decision 4 keeps
such a store for after profiling. WebKit's two exceptions: what `prepare` derived for an item and a line's inspection
asks again, where `measure.ts` knows nothing of inspection, so handing it over needs either a record returned from every
measuring call or an inspected-only branch inside measuring, for a gain only the lab sees (it stays easy to add, since
stored widths are written at two sites, `items.ts` `handleTextContent` and `computeItemWidths`, and read at one,
`lines.ts` `measuredItemWidth`); and the space of a box whose white space is deferred, which asked Canvas at every
read. The second went in correctness round 5 (below). Two candidates for a store are written down with numbers
(research/ARCHITECTURE-PLAN-2.md §10; research/PROFILING-START.md has them in order with the rest):

- **Units of equal text in one prepared paragraph share one record of what measuring found** (specs/gecko-RESULTS.md,
  "Re-architecture X2"). The engine's own structure there is the shaped-word cache (gfxFont.cpp:3569-3577). The record
  has the prepared paragraph's lifetime, so it can't go stale or leak. It must not share where a recipe reads text
  outside the unit: a script context's character from elsewhere in the run (`measure.ts` `scriptContextFor`), or the
  font-matching prefix, which depends on the text before the unit.
- **Per-fill positions and safe flags kept on the item's shape result**, as Blink's own `ShapeResult` keeps character
  positions (specs/blink-RESULTS.md, "Re-architecture X2"). It is built unmerged on branch `ra-x2-blink-alt-positions`,
  read back on plain paragraphs only: the plain path's ratio of asked to distinct questions went from 4.11 to 2.95
  without facts there, and tier 1 and the plain and pure checks passed. The branch and its numbers are of the step before
  gap lists became canonical. The plain path now starts from 3.84, and a handed-out gap list no longer regroups when a
  measurement is left out (§5), so the reason for reading the positions back on plain paragraphs only is gone; nobody
  has tried it on an inspected one.

**Since correctness round 5** (2026-09-19; research/CORRECTNESS-ROUND-5.md has the cost of each fix beside the cases
it gained). Canvas questions a paragraph over each browser's recorded cases, counted in the browser: the plain path
from the plain predictor's rows, the lab path from tier 2's forward rows. The table above is the library before the
round.

| | Plain path, before | Plain path, after | Lab path, before | Lab path, after |
|---|---|---|---|---|
| Blink, no facts | 234.31 | 234.31 | | |
| WebKit, no facts | 39.32 | 36.51 | 88.79 | 85.90 |
| WebKit, lab facts | 21.65 | 18.83 | 59.86 | 56.98 |
| Gecko, no facts | 54.56 | 55.07 | 114.54 | 120.23 |
| Gecko, lab facts | | | 115.70 | 117.03 |

- WebKit: every box measures its space once as it is made (§4.4). That moved a first ask, so it took a browser run.
  Tier 2 in both orders and both configurations moved no status, and the plain predictor's line ranges equal the usual
  run's on all 63,987 cases. 47,510 cases ask what they asked, 9,174 ask fewer, and 7,303 ask more, 7,119 of them one
  question: a box's space that nothing reads. Each of the eight reordered giants asks about one question a word where
  it asked three: 707,622 calls become 295,170 over the nine. The bench's chat mix goes from 38.15 to 36.79 calls a
  message, and its Arabic messages from 45.75 to 23.08. The measured string's code path adds 2 questions a string in
  the two tier cases it touches (22 and 9 calls a paragraph). The facts row's plain path comes from a plain predictor
  with facts kept outside the repository, because the lab has none.
- Gecko: pair placement, the joined suffix and a boundary U+00A0 (§4.4). With the round's lazy plain scan (§4.6) the
  plain path paid 0.51 questions a paragraph on the tier corpus, which is built to break inside words: 2,822 of 63,771
  cases asked more, by 11.8 on average and by 1,032 at most (a word of 134 letters cut at every letter), and 121 asked
  fewer (the two states of one browser process). The bench's chat mix stayed at 110.67 questions a message and plain
  Latin at 82.15; the round's first build had them at 141.49 and 116.79. The plain predictor runs without facts only,
  so the facts row has no plain number; offline, over the 59,211 cases that replay at both commits, it is 55.53 before
  and 55.08 after. Since the profiling phase took the lazy scan out, the bench's first 1,000 messages ask 128.66
  questions a message on the mix where they asked 120.44, and 87.73 where they asked 78.35 on plain ASCII (pinned
  Firefox, `tools/fill-counts-probe.ts`; with item 3's windows the mix is at 132.85); the tier corpus's plain number
  wasn't counted again.
- Blink: the pair window asks other strings, not more. 486 questions more in all 67,065 cases; no count moved in the
  66,328 cases without a cluster of an ignorable character and a mark, and the 737 with one go from 784.69 to 785.35.
  No bench job was run: 0 of 49,275 strings of the bench's chat sets hold such a cluster.
- Distinct questions and the ratios above aren't counted again yet. The offline counts cover only the cases that
  replay, until the references are recorded again.

**What it costs in time.** In the lab, little in Chrome, because Chrome's per-canvas cache answers a repeat: when the
memo went the giants' prediction took 55.3 s against 49.5 s, and tier 2 forward 82.8 s against 79.3 s, back to back on a
quiet machine; in pinned Chrome 0 of 2.17 million questions asked again were answered differently. The plan's tripwire
(tier 2's wall time and the giants within 2× the correctness line's baselines) tripped once: Firefox's giants on the
inspected path, 15.3 s of prediction against 4.2 s (3.6×), because `inspectLine` reads every offset of 18,000 to 47,000
words and the memo answered a word's later occurrences. Their plain path is 1.28×, and the layouts are equal on all 9. It
was accepted, because the tripped path is the inspected one, which the lab and inspection use and an application doesn't
lay text out with.

For an application the first real numbers are the chat benchmark's (research/BENCH-NIGHT.md, "The real pass", 2026-09-19,
no supplied facts): 10,000 chat messages from scratch take 9.59 s in Chrome (4.16 s for plain ASCII messages), 2.63 s in
Firefox (0.61 s) and 11.7 s in webkit-host (8.83 s), against main's cold prepare at 0.72 s, 0.30 s and 1.53 s. The
repeats of this section are one part of that and not the largest: Chrome spends 43% of the time making Canvas contexts
(11 a message) and 31% in the runtime font checks; webkit-host spends 98% inside `measureText` at only 41 calls a message,
each about three times as dear as main's, because 5.4 new contexts a message each pay for resolving their font;
Firefox spends 88% in the fill, carried by CJK and Arabic messages. research/PROFILING-START.md starts from there.

## 5. Gaps

"Handled" means the recipe gives the DOM's value. A named gap is reported among the paragraph's gaps or a line's (§2.8)
under the stated condition. A given fact never reports a gap; its null default does.

In each port every condition with its test, its prose and its order, Blink's and WebKit's merge rules (Gecko merges
nothing), and the measuring only a gap needs are in `engines/<engine>/gaps.ts`, and nothing else in the port builds a gap
(§2.8). Gecko's stand-in reasons are tagged unions (`types.ts` `InWordReason`, `gaps.ts` `TabReason`) that carry the
numbers the prose prints, and `gaps.ts` prints them.

**Blink's gap lists are canonical where they are handed out.** Blink builds a list by merging a raised range into the
first entry of its gap, run and detail that it meets (`gaps.ts` `addGap`), which can be an earlier one that grew in
between. Every `measure16` raises its range's gaps, so while a list is built its grouping follows how often and in what
order ranges are raised again; what the entries cover together never changes. Without a canonical form, a value handed on
in place of a repeated measurement regroups ranges in a row: two data-flow fixes were once taken back because 3 and 1 of
67,065 rows regrouped (specs/blink-RESULTS.md, "Re-architecture X2").

- *Canonical* (`gaps.ts` `canonicalGaps`) means: per gap, run and detail, the ranges the entries cover together, as
  ranges that don't meet, each at the place of the first entry it took in, which is where that range was first raised.
  A canonical list says what was raised and in what order it first was, and not how often or in what order ranges were
  raised again. Its entries are copies.
- *Where.* A list is made canonical where it is handed out: `inspectLine`'s result, and the prepared paragraph's own
  list once `prepare` ends, which `paragraphGaps` copies. Because the prepared list is canonical, what a line takes from
  it doesn't follow raises either.
- *Why not where a list is built.* The line breaker's rewind cuts a list being built back by length (`gaps.ts`
  `dropGapsFrom`), so entries can't be merged away while it is built. A list still being built, the fill's `line.gaps`
  or a sink, keeps its raw grouping; the decided line is the engine's own record, and `inspectLine` is what hands a
  line's gaps out.
- *The proof* is a script of its own, outside the repository's gates
  (`.artifacts/tests/runs/ra-x3-blink/tools/canonical-proof.ts`; TESTS.md, "Tiers"). It defines canonical without
  importing the library, replays every case of both Chrome references frozen before the change, and compares the
  reference's prediction with the new one after making both sides' gap lists canonical. 473 rows without facts (465
  cases) and 303 with them (296 cases) differed byte for byte from those references, in gap lists alone: a line's list
  in 456 rows and the paragraph's in 22 without facts, a line's list in all 303 with them. After canonicalizing both,
  67,065 of 67,065 cases are equal in each configuration, every new list is already canonical, and the step changed no
  question. The orchestrator ran it again on the merged tree, where the comparison leaves the painter's limits out,
  since §7's script rule moved them in 460 cases: 67,065 of 67,065 again, in each configuration. Chrome's references were
  frozen again after it. What holds the form from then on is `engines/blink/gaps.test.ts` and tier 1.
- *What it allows.* A value handed on in place of a repeated measurement can't regroup a row, so the two flows are in
  (§4.6). On an input nobody recorded, a line can take a wider range of the paragraph's list than the library before
  the change would have given it; what the ranges cover together is the same.

WebKit and Gecko have no canonical form, by their owners' readings. Two of WebKit's six merge rules
(`rtl-shaping-across-inline-boxes`, and `lineGaps`' own) merge a new range into the first entry it overlaps and never two
entries with each other, so grouping could follow the order of raises while what is covered could not; WebKit's raises
come in one fixed order, and no step has moved one. Gecko merges nothing: its fill-time gaps come one per reflowed text
frame per pass, the consulted offsets are read as a set, and the in-word report is sorted and deduplicated by offset, so
neither the count nor the order of measuring calls shows in a row.

| Gap | Engines | What differs | Handling | Predictions can be wrong when |
|---|---|---|---|---|
| CR, FF, VT and other controls (`control-character-width`) | all | Every Canvas turns U+0009-U+000D into spaces; Gecko's also turns U+001C-U+001F, U+0085 and U+2029 into spaces (CRITIC.md C12). DOM: Blink collapses CR as a space in collapse modes and keeps FF and VT as characters of unknown width; in preserve modes CR and FF are zero-width control items that end a shaping group (blink-text §2.C.9, H5, H6). WebKit keeps U+000D's glyph advance on the simple path and 0 on the complex path; FF, VT and other Cc take the `.notdef` advance (webkit-text §5.3). Gecko: CR, FF, VT and hidden C0/C1 controls are zero width. | Never pass them to Canvas. Blink: CR in collapse modes is a space in text_content; CR and FF in preserve modes measure 0 and split the group. WebKit: measure FF, VT and other Cc as U+0001 in the same string, which also takes `.notdef` (webkit-canvas H10). Gecko: strip them. | Blink: VT in any mode, or FF in `normal`, `nowrap` or `pre-line`, which Canvas turns into a space where the port measures U+0001; other controls reach Canvas and the DOM as they are (plain_text_node.cc:47-58). WebKit, by the measured string's font code path, not the box's (§4.4; FontCascade.cpp:304-309, :708-730): on the simple path VT, FF or CR where Canvas shows a pair adjustment around the control, and a CR that more of the measured string follows; on the complex path VT and FF, whose kerning there wasn't probed, and never CR, which has no advance there; a control whose `.notdef` comes from another font. A string without a complex-path character is WidthIterator's in a complex-path box too, so since correctness round 5 it reports as on the simple path. |
| Soft hyphen shaping (`soft-hyphen-shaping`) | Blink | Blink's Canvas turns SHY into ZWSP, which splits a 16-bit Canvas word; the DOM shapes SHY inside the item as a hidden glyph. WebKit's Canvas and DOM both keep SHY during shaping. Gecko's DOM discards SHY before shaping. | Blink: measure the word without the SHY. WebKit: keep it. Gecko: strip it. | Blink: a kerning or ligature pair across a soft hyphen. |
| Hyphen glyph (`hyphen-glyph`) | Blink, WebKit | The hyphen is U+2010 if the primary font maps it, else `-`. Canvas can't show whether the primary font maps U+2010, because fallback supplies it. | Fact `mapsHyphen` (§1.2). Gecko's Canvas substitutes as its DOM does. | `mapsHyphen` null and `W('‐') ≠ W('-')` in the run's context at a chosen soft hyphen. |
| Letter spacing and ligatures (`letter-spacing-ligatures`) | WebKit | The DOM turns off liga, clig, dlig and hlig when letter spacing isn't 0; OffscreenCanvas keeps them (webkit-canvas §1.3, H3). Blink's Canvas and DOM agree (H27). Gecko's DOM decides on the rounded au value, Canvas on the float. | Blink: `ctx.letterSpacing`. Gecko: `'0.001px'` plus JS spacing. WebKit: `ctx.letterSpacing` gives the spacing and keeps the ligatures, so a glyph count (the total at 64px of spacing less the total at none) finds the adjacent clusters Canvas merges. Where the measured string takes the simple path they are measured with U+200C between them (`engines/webkit/measure.ts` `mergedGlyphs`). The path is the measured string's, as FontCascade::width chooses it (FontCascade.cpp:304-309, :708-730), not the box's (§4.4). | WebKit: a line measuring a string of a letter-spaced box in which Canvas shows merged glyphs. It reports on each separated pair, because the pair adjustment between the two letters with the features off isn't measured. It reports on the whole string where nothing is separated: the complex path, a string too long to count, or glyphs still merged after separating. The listed families' `spacingInputs`, where given for every character, say where nothing can change. |
| Canvas language (`canvas-language`) | WebKit | Blink's OffscreenCanvas resolves `<html lang>` when the font string is set and keeps it until the string changes (blink-canvas H13); Gecko's resolves per call; WebKit's has no locale. The DOM uses the element's language for generic families, CJK fallback and `locl`. | Blink and Gecko: an explicit `ctx.lang` per context. WebKit: a generic keyword is measured as the family the locale resolves it to, named in the Canvas list (§1.3); a named family settles its own characters under every locale. | WebKit: a line measuring text under the system design families (`system-ui`, `ui-*`); a character with default emoji presentation that only a named generic could draw; characters no list family draws whose system fallback a language moves (the registered table of §1.3: Han, kana, Hangul and their punctuation and symbol blocks under Han, kana and Hangul locales, Arabic under ur and ks). |
| Optical size (`optical-size`) | Blink at zoom ≠ 1, Gecko | Blink's DOM shapes at the zoomed Core Text size with opsz and ptem at the CSS size (blink-canvas §1.8). Gecko's OffscreenCanvas never sets auto optical sizing (gecko-canvas §1.2 C1a). WebKit shares the DOM path. | Fact `opticalSizeAxis` (§1.2): Blink measures at the CSS size and scales, and asks Canvas whether the primary family scales linearly where the fact isn't given. Gecko: none; every width of such a run is a stand-in. | Blink: `opticalSizeAxis` still null at layout zoom ≠ 1 (the system font keywords, a primary family without Latin letters, a font that doesn't scale linearly). Gecko: `opticalSizeAxis` true or null, which without supplied facts is nearly every run (CHARTER.md, decision 2). |
| Gecko size quantization (`font-size-quantization`) | Gecko | Canvas keeps 7 significant bits; the DOM uses Servo's 10-bit size on a 1/60 px grid. | The gate in §4.3. | Sizes such as 13.33px, 16.8px or odd eighths. |
| Bitmap emoji (`bitmap-emoji-size`) | Blink, Gecko at DPR ≠ 1 | The DOM asks Core Text for the sbix advance at the device size. | Measure at size × DPR and divide. Gecko under a bold font: the weight 400 advance at the page's apd plus synthetic bold's DOM steps (probe gecko-port F24). | Gecko: a device size off Canvas's 7-bit grid (one device pixel off at apd 27, probe cross-cutting 1). Blink: until H17 is verified. |
| Chrome's per-canvas shape cache | Blink | The first shaping of a word per canvas wins: script context, word spacing at offset 0 (blink-canvas §1.7). | Handled: partitions, JS word spacing, fresh contexts per prepared paragraph. | — |
| Unsafe-to-break offsets (`unsafe-to-break`) | Blink | Line-start and line-end reshapes happen at HarfBuzz's unsafe-to-break offsets, which Canvas doesn't expose (CRITIC.md §5 item 6). | An offset is safe when the pair total shows no adjustment, the grapheme boundary holds and nothing joins: necessary, not sufficient (blink audit B7). Which glyph carries a pair adjustment: fact `pairKerning` (§1.2). | At a chosen line edge where the test can't vouch for the offset: contextual forms across it, a line edge taken from positions where the pair adjustment isn't 0 and `pairKerning` is null, a shaping group of 256 px with no safe cut. |
| Joining technology (`joining-technology`) | Blink | Letters joined across a shaping call's edge keep joined forms in OpenType fonts, which read the call's context, and lose them in `morx` fonts (hb-ot-shape.cc:60-66, 100-101). | Fact `joining` (§1.2). | `joining` null at a group edge or chosen line edge between joining letters (Geeza Pro is AAT; Amiri and Noto Naskh Arabic are OpenType). |
| Script context (`script-context`) | Blink | The DOM shapes an 8-bit paragraph as one Latin segment and merges Common punctuation into the surrounding script in 16-bit paragraphs; Canvas segments each word alone (blink-canvas §1.4). | Measure a range the paragraph shapes as Latin as an 8-bit string, one Latin segment; slice other ranges into 16-bit strings. | A grapheme without a strong character that some Canvas string the port measures (the grapheme alone, or in the pair window with its neighbour) resolves to another script than the paragraph: the brackets and digits of Arabic or Hebrew text, a curly quote or emoji beside a space in a Latin paragraph; its width can differ in fonts whose lookups depend on the script (Amiri, Noto Naskh Arabic). Reported with the grapheme's range. Since correctness round 5 the pair window reaches past a cluster of only default-ignorable characters and marks (§4.4), so the port no longer measures such a cluster alone, a string without a strong character, and the condition no longer fires there: in the recorded no-facts cases 329 line entries and 3 paragraph entries went, every one on a case that passes line count, breaks and widths with exact values, so they covered nothing. |
| Spaces in shaping (`space-in-shaping`) | Blink, Gecko | The DOM kerns across spaces when the font's lookups involve the space glyph. Blink's word-by-word check ignores legacy `kern`, `kerx` and `morx`; Gecko shapes whole ranges when `SpaceMayParticipateInShaping` (gecko-text §7.2). | Blink: `optimizeLegibility` contexts. Gecko: measure the whole range when `au(a + ' ' + b) ≠ au(a) + au(' ') + au(b)`, a hypothesis to probe. | Blink: cross-space legacy kerning. Gecko: until the detection is verified. |
| In-word prefixes (`in-word-prefix`) | all | Gecko's DOM uses per-glyph advances from one shaping of the unit, with integer shares of ligatures; Blink uses `ceil64` of prefix positions; WebKit's selection shapes a box once (`ComplexTextController`). Canvas measures a prefix alone. | Gecko: both sides of an offset measured as the unit shapes them, joined letters with U+200D, kern splits by `pairKerning`, or where it is null by what Canvas tells from app-unit rounding (three placements; a pair is told where two are struck out, and by probe pairs only where one face draws it and the probe letters, §4.4), a joined suffix that a fallback font draws measured behind its own first letter (U+200D at a string's start takes the first font, gfxTextRun.cpp:3609-3613, :3320-3325), where the prefix's side stands in, ligature groups by shares; the position is predicted where the two sides add up to the unit (probe gecko-port F15). Blink: prefix sums and pair adjustments at cluster boundaries (the pair window reaches past a cluster that holds only default-ignorable characters and marks, as HarfBuzz's lookups do, §4.4), with the stand-ins marked (§2.3). | Breaks inside words (overflow-wrap, break-all, CJK, soft hyphens) in fonts with kerning, ligatures or contextual forms; and code point edges inside an item, box or frame in §9. Gecko's stand-ins: a position inside a cluster, before a mark that starts a cluster, a tab after a stand-in (`CalcTabWidths`), and ligature rows the facts don't settle; the reading also holds `ComputeLigatureData`'s unbounded frame between two marks of one cluster, a Firefox bug Canvas can't show. Blink, at a chosen line edge inside a word: a line-end fit test that another last safe offset would turn around (the ceiling of that offset's position, or an uncertain first safe offset of a wrapped line start, each under or at one LayoutUnit; shaping_line_breaker.cc:309-324, :543-553); a wrapped line start whose clamped correction rests on a stand-in position, where the other outcome gives another line; the cut of an RTL view after a start reshape whose extent rests on the port's width tests alone (shape_result_view.cc:215-308). |
| Glyph clusters (`glyph-clusters`) | all | Which code points one glyph covers: a font's ligatures merge HarfBuzz clusters, Core Text can give a code point no glyph of its own. Canvas shows totals only. | Clusters from Unicode data (marks, joiners, modifiers, regional indicators). | Ligatures across graphemes; zero-advance code points without their own glyph, in §9's code point rects. Blink: a position inside a grapheme at a unit HarfBuzz may start a cluster at; a chosen edge between joining letters; a chosen edge where the pair adjustment measured with liga, clig and calt off (a letter spacing, font_features.cc:54-86) differs from the one with them on. |
| WebKit measuring paths (`simplified-measuring`, `fixed-pitch-path`) | WebKit | The DOM's simplified path doesn't restore space advances and sums in another float32 order; the fixed-pitch path returns `length × spaceWidth` for eligible fonts. | The full-path recipe; fact `monospace` for the fixed-pitch path (§1.2). | `simplified-measuring`: a line measuring a string of a simplified-path box outside the width shortcut that holds U+0020 (WidthIterator restores a space's unshaped advance, the simplified path keeps the shaped one, WidthIterator.cpp:84-120 and :473-474 against FontCascade.cpp:381-412) or whose Canvas total isn't the float32 sum of its code points' advances in order (shaping moved advances, which the two paths sum in other orders). `fixed-pitch-path`: a line measuring an item of such a box that fails T1 while `monospace` is null, or while `primaryFamily` is null and the font is fixed pitch (whether the realized family is Courier New decides the shortcut). |
| RTL shaping across inline boxes (`rtl-shaping-across-inline-boxes`) | WebKit | `LineBuilder` reshapes complex RTL text joined across decoration-free boxes as one run (webkit-lines §9.3). | none | RTL complex-script text split over same-font spans without box edges. |
| Page zoom (`page-zoom`) | WebKit | No page API shows Safari's page zoom. | `env.pageZoom`, given. | `pageZoom` null. |
| Font fallback (`font-fallback`) | all | Which font draws a cluster; hexbox and `.notdef` widths; Gecko's synthesized widths for Unicode spaces no font covers, rounded to device pixels. | Canvas totals include fallback. | Text no listed family covers, where Canvas and DOM fall back differently (Blink falls back per cluster over the whole item; Gecko's fallback can arrive later). Blink: a line edge beside U+3000 with an adjustment, where no coverage fact names the neighbour's font (Blink sends a U+3000 the font lacks to a fallback font and the neighbour keeps its half of the kern, harfbuzz_shaper.cc:598-606). |
| Float32 precision (`float32-precision`) | Blink, Gecko | Blink: 16.16 values are exact in float32 only below 256 px. Gecko: `measureText` returns `float(au) / 60`, exact only below 2^18 px. | Blink: measure per Canvas word; a float32 holds 24 bits, so sums of multiples of 2^g units are exact below 2^(24 + g) units, a run that ends below 256 px can't round, and fonts of 2048 units per em at whole zoomed sizes are always exact. Gecko: the space-in-shaping test runs in windows under 2^18 px. | Blink: a Canvas item of 256 zoomed px or more whose advances' granularity doesn't keep the sums exact. Gecko: a shaping unit 2^18 px or wider; in the observation port, edges beyond 2^20 / apd device px. |
| String storage (`string-storage`) | all | Blink's single Latin segment, WebKit's keep-all punctuation breaks and 1-unit emergency breaks, and Gecko's white-space-only frames depend on whether a text node is stored 8-bit (CRITIC.md §5 item 14). The page can't see storage. | Treat text whose code units are all ≤ U+00FF as 8-bit, what JS-created nodes get. Blink: that is the HTML parser's rule, and V8's but for slices of 13 units or more out of a two-byte string and what is built from them. | Parser-created or edited nodes stored 16-bit. Blink: nodes made from such strings, with no condition. WebKit: a line measuring keep-all punctuation in Latin-1 text, or taking an emergency break in Latin-1 text whose second unit can't start a line. |
| Dictionary breaks (`dictionary-breaks-unavailable`, `dictionary-breaks-stand-in`) | all | Thai, Lao, Khmer and Myanmar need dictionary or LSTM data (§6.3). | The running browser's own segmenter. | `unavailable`: SA runs get no interior opportunities. WebKit stand-in: a dictionary range that starts with a combining mark (27 of 282,337 positions). |
| HanKerning (`han-kerning`) | Blink | Blink trims fullwidth punctuation with `halt` using characters outside the shaped range and at line ends (han_kerning.cc, shaping_line_breaker.cc:344-378). | The trims from Canvas facts (blink audit B6). | Fonts whose `halt` detection isn't probed; neighbours on another line. |
| Tab stops (`tab-stops`) | Blink | Blink counts stops from the platform space advance without `trak` (simple_font_data.cc:225-240). | Canvas space advance. | Fonts with `trak` tracking. The one probed example doesn't show it: 16px Helvetica Neue's stops, 35.5859375px apart, are 8 × Canvas's space advance of 4.447998px rounded up to 1/128px (rebuild/platform-bugs/LEDGER.md, "Looked at and not reported"), so the condition is due a re-reading. |
| UI language (`ui-language`) | all | §1.4 | The engine's given process languages. | The fact is null and content has no `lang`, `lang=""`, a Han `lang` (WebKit), or a locale ICU has no data for (WebKit quotes). |
| Page history (`page-history`) | all | Layout state earlier content leaves in the document or process: WebKit's `TextBreakingPositionCache`, Gecko's document-wide bidi flag and the process's font fallback state, Blink's platform font created at another size (TEST-ARCHITECTURE.md §6.5). | none: the library predicts a fresh document | A paragraph with the conditions of those effects. Gecko: every U+FFFD outside the listed fonts (the process's cached fallback family); an emoji that asks for a color glyph and measures as another font; U+FE0E on an emoji-default character, whose text glyph only the system-wide search finds among the families whose character maps are loaded by then (gfxPlatformFontList.cpp:1474-1486). WebKit: a line measuring an item that another box of the same text and wrapping styles could end elsewhere, where the parts would measure otherwise or the item is content whose fit ended the line (or the builder reverted): a level boundary the text gets under either paragraph direction or one or two characters of context (UAX #9 classes), or preserved white space of two units, which break-spaces and word spacing split and pre-wrap keeps whole (TextBreakingPositionContext.h:30-80). |
| Engine build (`engine-build`) | all | The ports follow one build each. | `env.build`, given. | `build` null or not `PINNED_BUILDS[engine]`. |

**What Canvas can't be asked, tried again in correctness round 5** (2026-09-19). The round looked for a sound Canvas
recipe for every group of main's true passes that the rebuild still fails (research/MAIN-FACTS-ANALYSIS.md has the
groups; research/CORRECTNESS-ROUND-5.md what landed and what it cost). Gecko got one for pair placement, because it
rounds each glyph to app units (§4.4). Chrome got none, and WebKit's largest group needs a kind of fact Canvas can't
give.

*Chrome: a negative result.* Two facts decide 299 of the 344 true passes of main that the headline configuration fails
in Chrome: which glyph of a kerned pair carries the adjustment (`pairKerning`, under `unsafe-to-break`) and which
letters one glyph cluster covers (the ligature facts, under `glyph-clusters`). Neither reaches anything Canvas returns.
Probe blink-cr5 K: in 26 kerning families, 14 that split the adjustment and 12 that put it on the first glyph by the
DOM, 264 pairs, the ink box, `direction`, a bidi override, letter spacing and the size times 2^k all give the same
values in both kinds. Blink keeps 16.16 advances and rounds no glyph, and the kern machine moves the second glyph's
offset by its share (hb-kern.hh:102-106), so every total and every drawn position equals GPOS's: Gecko's recipe has
nothing to read. Probe blink-cr5 L: of 31 Arabic family names 26 draw lam-alef as one cluster and 5 as two (Amiri, Noto
Naskh Arabic, Noto Nastaliq Urdu, Diwan Kufi, Diwan Thuluth). Lam U+200D alef differs from lam alef in both kinds and
doesn't in Geeza Pro, so that test is wrong for four of the five and blind for Geeza Pro. Letter spacing, the one
Canvas setting that adds something per cluster, shows neither: cursive scripts get none (shape_result.cc:977-990), and
any letter spacing turns liga, clig and calt off (font_features.cc:54-86). Both defaults stay under their gaps;
choosing the more common answer would be a choice by count. Two supplied facts pass 255 of the 299 (266 of the 344).
`getTextClusters` or `TextMetrics.advances` shipping would reopen this (specs/blink-RESULTS.md, "Correctness round 5").
A guard for joined-letter positions that run backwards was traced on all 10 of its cases and fixes none, so it isn't
built; the gap they report is the answer.

*WebKit: what is left of `letter-spacing-ligatures`.* The DOM turns off liga, clig, dlig and hlig under letter spacing
and keeps kerning, so its `f` and `i` are kerned against each other. No Canvas string puts the two letters side by
side, unligated, in one shaping call. U+200C ends the simple path's shaping call, and Core Text doesn't kern across it
on the complex path. U+034F doesn't stop the ligature. U+180B brings a fallback glyph. Probe M1 tried 1,596 strings in
15 fonts. 233 of main's true passes fail here. They are ProbeShantell and Shantell Sans threshold cases, 1/64px around
Safari's own break widths, and Arabic optional ligatures (lam-lam-heh in Arial and Times New Roman, lam-alef in
Courier New). Main passes them by a property of one font: Shantell's ligature glyphs are 1 font unit wider than their
kerned parts. Main's formula is 2 to 3px off in Amiri, Hoefler Text and Futura.

One supplied fact would make them exact: a family the application declares again with the four features off, in which
the port would measure letter-spaced WebKit boxes. In probes it equals the letter-spaced DOM bit for bit on 1,274 of
1,274 simple-path strings with a ligature pair and on 344 of 344 Arabic ranges. On complex-path strings it is within
0.0005px except in the two Shantell fonts (99 of 117). It would add no Canvas question and end the glyph counting for
such boxes. It is not built, for three reasons. It is a new kind of fact that changes measuring contexts. It was probed
through the FontFace API only. It stays out of the headline configuration.

The cause is a WebKit bug: Canvas `letterSpacing` keeps optional ligatures that CSS `letter-spacing` turns off
(rebuild/platform-bugs/LEDGER.md entry 6, with its page; StyleComputedStyleBase.cpp:318-331 against
CanvasRenderingContext2DBase.cpp:3271-3297). If WebKit fixes it, the port's context, which already sets the run's
letter spacing, is exact with no recipe and no fact. A second prototype, which separates Latin pairs inside strings the
complex path measures (7 more true passes), stays unmerged: what Core Text does around U+200C inside a run is closed
source, its pair test is not the engine's, and probe M3 has it up to 1.9px off.

*Gecko: contextual joined forms.* 72 true passes stay failures under `in-word-prefix`. Amiri, Noto Nastaliq Urdu and
Noto Naskh Arabic swap both glyphs when two letters meet, and Canvas gives totals only, so no string measures the
first glyph in the form the word gives it. Main's passes there were coincidences of width
(rebuild/tests/known-tail.json, `gecko/contextual-joined-forms`).

Inline structure adds no gap: box edges, atomic sizes, indents and slot insets are lengths the engine converts exactly,
and what Canvas can't show about the text around them falls under the names above. A span with box edges ends Blink's
shaping groups and Gecko's text runs at its edges, so `unsafe-to-break`, `joining-technology` and `in-word-prefix`
report at such an edge the way they do at a group edge.

## 6. Break data

### 6.1 Generated modules

Generators read pinned engine data, check every input's sha256 against a recorded value, and write one module each:

| Command | Source | Module | Size |
|---|---|---|---|
| `bun rebuild/tools/gen-blink-data.ts` | `data/blink`, checked against `manifest.json`: `line`, `line_normal`, `line_normal_cj`, `line_loose`, `line_loose_cj` and `char` from Chrome 153's `icudtl.dat`, and the generated `kFastLineBreakTable` | `src/engines/blink/generated/break-tables.ts` | 531 KB |
| `bun rebuild/tools/gen-webkit-data.ts` | `data/webkit`, checked against `FILES.tsv`: the six line tables and `char` libicucore loads, and `BreakablePositions.cpp`'s pair table | `src/engines/webkit/generated/break-tables.ts` | 629 KB |
| `bun rebuild/tools/gen-gecko-data.ts` | `firefox-156.0/intl/icu_segmenter_data/data`, checked against `data/gecko/segmenter-data-sha256.json`: line and grapheme rule data | `src/engines/gecko/generated/break-data.ts` | 41 KB |
| `bun rebuild/tools/gen-unicode-data.ts` | ICU 78.2 `ppucd.txt` (Chromium ICU pin, sha256 recorded in `tools/ppucd.ts`), libicucore's private-use classes (recorded in the generator, checked by `bidi.test.ts`) and `unicode-bidi` 0.3.15's `tables.rs` | `src/unicode/generated/bidi-data.ts` | 14 KB |

Data only one engine reads sits under that engine; the bidi data, which the engines share, stays shared and is named by
where it comes from (Unicode 17, libicucore 78.1, `unicode-bidi` 15). Tables are base64 in the module, and each engine
decodes and parses its own when its data module loads (`src/engines/<engine>/data.ts`): every table of the three engines
in about 3 ms under bun, kept for the life of the page. Not shipped:
the phrase tables and `jaml` model (the input model has no `word-break: auto-phrase`), ICU's dictionaries (`cjdict` is
2 MB) and Firefox's LSTM models (874 KB), because §6.3 takes SA breaks from the running browser. Compacting tables
(dropping the reverse table and rule source, which `rbbi.ts` never reads) is later performance work.

Each engine owner extends only their own generator. Unicode properties the scans need beyond bidi (Line_Break and
General_Category for Blink's break-all and keep-all, General_Category for WebKit's keep-all punctuation and
`canBreakBefore`, East_Asian_Width and scripts for Gecko) come from engine data: `tools/ppucd.ts` reads ICU 78.2's
`ppucd.txt` for Blink; WebKit uses the same plus Apple's private-use differences
(`data/webkit/icu-macos27-libicucore/unicode-properties-vs-upstream78.3.diff`); Gecko uses ppucd with an equality test
against the groundwork's `icu_properties` dump, like `src/unicode/bidi.test.ts` does for Bidi_Class. JavaScript's
`\p{…}` escapes use the JS engine's own Unicode tables, not layout's, so the library doesn't use them for engine
decisions.

### 6.2 What loads what

- Blink: the rule file per locale and `line-break` follows specs/blink-canvas.md §2.3's table, including `ja` and `ko`
  with `line-break: normal` opening `line_normal_cj`, `ko@lb=strict` failing to open and retrying the UI language, and
  no locale dropping the keywords.
- WebKit: `line` (strict) for "" and every non-CJK locale by default, `line_normal` for ja and ko, `line_cj` for zh,
  and `@lb` variants (specs/webkit-canvas.md §2.5), plus quote overrides per locale (§2.6).
- Gecko: one line segmenter; the `zh` content locale only under `normal` or `loose` (specs/gecko-canvas.md §4.3).

Where spans carry their own `line-break` and `lang`, each engine opens the table the source opens for that item's style
(Blink `SetCurrentStyle` over the item style; WebKit the box's computed locale and `line-break`; Gecko the per-flow
`nsLineBreaker` settings).

### 6.3 Dictionary breaks for Thai, Lao, Khmer and Myanmar

No engine gets these from rules: ICU hands such segments to dictionary engines, and Firefox runs LSTM models. Porting
those engines is large, so the first ports use the running browser's own segmenter where a spec shows it is backed by
the same data, and `env.dictionaryBreaks` says which is available.

- **Blink**: `Intl.v8BreakIterator({ type: 'line' })`. V8 runs the same in-process ICU 78.2 and `icudtl.dat` as layout
  (specs/blink-canvas.md §2.6). It drops locale keywords, which doesn't matter inside SA runs, since the dictionary
  engines don't depend on locale. Use it only for boundaries strictly inside SA runs, with `adoptText(text_content from
  the line start)` because Blink restarts ICU at every line start. To verify: H20 (V8's tables are Chrome 153's), and
  that DOM lines inside SA runs equal it after a line start (blink-text H34).
- **WebKit**: Safari exposes no line segmenter. JSC's `Intl.Segmenter` word granularity runs libicucore's word iterator
  with the same dictionaries. Against libicucore's own line iterator it differs on 27 of 282,337 SA positions, all in
  ranges that start with a combining mark (`dictionary-breaks-stand-in`).
- **Gecko**: Firefox's `Intl.Segmenter` word granularity uses ICU4X's word segmenter, and layout's per-word LSTM breaks
  equaled it on 54,589 of 54,589 SA positions (specs/gecko-text.md §10). Gecko feeds one space-delimited word at a time,
  split by language. Probe gecko-text H25 confirms it in installed Firefox 156.

Predicting an engine from another runtime (tests, another browser) leaves `unavailable`: SA runs get no interior break
opportunities and the paragraph reports `dictionary-breaks-unavailable`.

## 7. Painter

`paintLines(paragraph, lines, refusedRows, rules, document)` in `src/paint.ts` returns one `div` per line with a line
box, in form A-wrap (specs/painter.md §1, §6), and `painterLimits(paragraph, lines, rules)` returns, for the same lines,
the named limits of what painting that line alone can't reproduce (tentpole 7; "Limits" below). `lines` holds every line
of the paragraph, the ones without a line box too, as `PaintLine<Facts>`: `pieces`, which is what `linePieces` gives of
the line (§2.1: `fragments`, `joinsNextLine`, `indented`, `align`, `overflows`, which says that the line's content reaches
past its band by the engine's own widths, hanging white space left out, and the engine's own `facts`); the `slot` the line
was filled in, width included; and `hasLineBox`, as `fillLine` says. `refusedRows` are the rows of the slot list the
engine refused (`fillLine`'s below-floats). The painter reads no row and no engine geometry, so an application paints
what it filled; the lab's adapter keeps each line's pieces and slot as it fills them and pairs them with the engine's
rules where it dispatches (`lab/predictor-core.ts`, `LayoutPrediction.painter`). Both functions plan a line first
(`planLine`). The plan turns the line into tokens (`lineTokens`: text nodes, element opens and closes, the nodes the
painter makes), which need no document, and `paintLines` builds the DOM from them.

**The painter names no engine.** What one engine's painted line needs and another's doesn't is a `PaintRules<Facts>`
value, which each engine exports from `engines/<engine>/paint-rules.ts` with the source readings behind it: data where
the engines differ by a value, and a function where they differ by what they read of a line. `Facts` is the engine's own
(`LinePieces.facts`); the painter never looks inside and hands it back to the engine's rules. The bullets below say why
each rule exists.

| Rule | Blink | WebKit | Gecko |
|---|---|---|---|
| `Facts` | `needsAccurateEndPosition` | `carriedWidth`, `shapedAcrossBoxes` | none |
| `bidi`, `graphemes` | `blinkBidiData`, `blinkGraphemeRules` | `webkitBidiData`, `webkitGraphemeRules` | `geckoBidiData`, `geckoGraphemeRules` (each engine's `data.ts`, §6) |
| `hyphenSpan` | `ends-shaping-group` (`vertical-align: 0px`) | `plain` | `isolated` (`unicode-bidi: isolate`) |
| `textNodesKeepLeafStorage` | no | yes | no |
| `paintsSourceWhiteSpace` | no | yes | no |
| `resolvesTrailingSpaceDirection` | yes | no | no |
| `trimmedSpaceAtEnd` | by a rule of its own: the soft wrap box unless `needsAccurateEndPosition` | the box where the space would be reset | the box where the space would be reset |
| `noBreakBeforeBoxAfter` | U+200D, U+2060, U+FEFF | none | none |
| `lineEndWrapping` | the box holding the line's last character | the block | the block |
| `hangingForm` | one of three forms | the text's node | the text's node |
| `spacingAfterRunEnd` | no | no | yes |
| `lineStartScript` | `arabic-letter-mark`, with the port's `ScriptRunIterator` (`scriptsOf(text, sixteenBit, direction)`: a painted line is segmented by script when it is 16-bit or its block is RTL) and ICU levels | `none` | `limit-only` |
| `trimsAtLineEnd` | a character HanKerning may trim | none | none |
| `controlsBetweenPieces` | the limit `controls-between-pieces` | none | none |
| `limits` | `edge-inside-shaped-text`, `script-at-line-start`, `space-shaped-with-next-line`, `han-kerning-at-edge`, `hanging-space-kern-share` | `carried-width`, `edge-inside-shaped-text`, `word-measured-with-next-space` | `edge-inside-shaped-text`, `script-at-line-start`, `spacing-at-run-end`, `frame-ended-at-break` |

- **The line block** has its slot's width (the content-box width the line was filled at, §2.9), the paragraph's font, spacing, `lang`, `direction`, `white-space`, `word-break`,
  `overflow-wrap`, `line-break`, `tab-size`, `text-align` and fixed line height, the fixed styles of §1.1, the
  text-indent where the engine indented the line, and, when the paragraph isn't start-aligned, `text-align-last` set to
  the line's used alignment, since the painted line is its block's last line. Where the slot has insets, a
  `float: left` and a `float: right` block of those widths and one line height give the painted line its band with the
  paragraph's arithmetic. The paragraph's slot floats come before its content (§2.9), so only the paragraph's first line
  build places them, and every later build, a retry after a refused slot included, finds them in the formatting context.
  WebKit counts tab stops from the line rect's left after the floats it finds but before those the build places itself
  (`InlineLineBuilder.cpp:478`, `:1394-1396`). So the painted line of the first build (engine line 0 with no refused
  slot in row 0) holds its floats, and every other painted line is a holder block, the floats and then the line block,
  where they intrude on the line block's line as floats already placed do. Blink and Gecko place the band the same way
  in both forms (`LineLayoutOpportunity`; Gecko's float available space), and their tab stops read the same float
  offset. The browser then runs its own line-end rules on the painted line as it did in the paragraph. Blink trims CJK
  punctuation at a line end in `ShapeLine`, which only runs while wrapping (`あいうえお。` is 88px natively and 96px
  under `pre`), and Gecko counts only the non-overflowing part of hanging `pre-wrap` spaces (painter.md §3.1 e, §3.3 f).
  A line wider than predicted wraps, and the lab sees the painted line on two lines. Tab stops count from the line start
  in both.
- **Lines that don't wrap** get `text-wrap-mode: nowrap` on the line block.
  - A line that ends with a hyphen fragment, or starts with the U+200D of R7. The paragraph offered no break before the
    hyphen or after the joiner, but painted they begin a new item and a new grapheme cluster, and an overflowing line,
    as every line is at the narrowest widths, broke there again: Blink and WebKit at the chosen soft hyphen left in the
    slice (`InlineFormattingUtils.cpp:385-437`), Gecko after the joiner under `overflow-wrap`. A line that ends at a
    hyphen has no line-end punctuation or hanging white space for the wrapping rules to act on.
  - A line that reaches past its band by the engine's own widths, hanging white space left out. The paragraph kept it
    whole: nothing before its end could take the break, or the break was chosen with other widths than the line ended
    up with. Blink chooses a break with the positions of the paragraph's shape result and reshapes the line's end
    afterwards, and the reshaped end is wider where the last glyph had a pair adjustment with the next line's first
    (`ShapeLine`, `shaping_line_breaker.cc:500-600`; `rule/in-word-breaks` `c-0306e405706818cd`: `AVAVAVAV` under
    `break-all` is 123.59 px in a 121.80 px band). Painted alone the browser sees the final widths first and breaks the
    line again wherever its own rules let it. Three kinds of such lines keep wrapping: one that ends in white space,
    which hangs or trims as it did because the line wraps (`rule/br-elements` lost its hanging space under nowrap); one
    with a single grapheme cluster, which nothing can break; and in Blink one that ends with a character HanKerning may
    trim (`Character::MaybeHanKerningOpenOrCloseFast`'s ranges, `character.h:138-141`), because `ShapeLine` trims it
    only while it breaks lines (`shaping_line_breaker.cc:344-376`; `rule/hankerning` painted 8 px wider under nowrap).
- **Soft wraps.** A painted line is its block's last line and its bidi paragraph's end. Where an engine's rule for the
  line's end reads whether more content follows, a line that ended at a soft wrap (another engine line follows, no
  `<br>` or forced break ended it) ends with an empty inline-block of width `calc(100% + 1px)`, which fits no band, so
  the browser wraps before it and the painted line is a wrapped line again. The box goes inside the spans that continue
  on the next line, which carry their end edges there. It applies (the rules `trimmedSpaceAtEnd`,
  `noBreakBeforeBoxAfter` and `lineEndWrapping` hold what differs):
  - Every engine, a last character that a bidi paragraph's end resets and that the paragraph kept at another level than
    the base level: a boundary neutral such as U+200C or U+200D after a letter of another direction, Gecko's trailing
    white space, which has no line-end rule, and in WebKit and Gecko a trimmed space. ICU gives the run of white space,
    separators, boundary neutrals and explicit and isolate codes before a paragraph's end the paragraph level
    (`adjustWSLevels`, `ubidi.cpp:2289-2324`, `ubidiimp.h:94-102`; Blink and WebKit), and so does unicode-bidi's
    `reorder_levels`, which Gecko runs over its whole paragraph (`lib.rs:1146-1200`, `unicode-bidi-ffi/src/lib.rs:54`).
    Reset, the character becomes an item, box or frame of its own: shaped apart from the letter before it (`ب` before
    U+200D took its isolated form, 11.41 px for 3.91 px, `c-18f83148f2a14065`), open to an overflow break before it
    (WebKit and Gecko moved a U+200C to a second line, `c-0da61e56106f1f0b`, `c-027754d73c591d1d`), and in WebKit removed
    at the line's end as a run of its own with its plain width, where the paragraph took the space's width inside its
    run (in an RTL box the word with the space less the word, `Line::Run::removeTrailingWhitespace`,
    `InlineLine.cpp:963-987`; all 44 `rule/text-align` webkit-host failures of round 2, `c-27daf54faef90b34`). The box
    isn't such a character, so the run before it isn't at the paragraph's end. ICU gives a boundary neutral the level of
    the character after it (`ubidi.cpp:2309-2321`), so this box goes inside the override span that holds the character,
    where the override forces it to the character's level too; after the span it handed the block's level to the
    character (`c-ede93b4ce64f1921`). Blink breaks before the box by UAX #14, which allows no break after U+200D (LB8a)
    or a word joiner (LB11), so there a line ending in one of them gets no box: the box took the character to the second
    line with it (`c-abda075f770468f9`). WebKit breaks between any text and an atomic inline (`isAtSoftWrapOpportunity`,
    `InlineFormattingUtils.cpp:385-437`).
  - WebKit and Gecko, a line ending in `hanging` white space. A `pre-wrap` sequence hangs unconditionally at a soft wrap
    and conditionally at the end (WebKit `horizontalAlignmentOffset`, `InlineFormattingUtils.cpp:198-217`), which moves
    alignment and justification. Gecko's `TextAlignLine` hangs or trims trailing white space only on a wrapped line
    (`nsLineLayout.cpp:3505-3516`) and reserves a span's end border and padding on each line of it
    (`nsInlineFrame.cpp:512-513`).
  - Blink, a line ending in hanging spaces. They hang conditionally on a block's last line and unconditionally on a
    wrapped one (`ComputeTrailingSpaceWidth`, `line_info.cc:353-366`), which moves `center`, `end` and `justify` lines by
    the hanging width, and at the paragraph's end ICU gives them the base level, which splits them from the item of a
    text of another level, so the two are shaped apart and the text loses its pair adjustment with the space
    (`c-0985b4f121df8555`: `LYAY` 46.6953 px without the box, 46.328 px natively and with it). Round 2 left these lines
    without a box because one `rule/atomic-inlines` line had backed up to an earlier break with it; the forms probe
    (`.artifacts/lab/painter-r3/probes/forms-chrome-1.json`, variants `A-*`) paints that line (`c-049fe22e37c2b9cb`) at
    the native width with the box after the spaces, inside or after the override span, and in round 3's runs no pair
    is lost to it.
  - Blink, a line ending in a `trimmed` collapsible space whose end isn't reshaped (`needsAccurateEndPosition` false,
    `line_info.cc:127-175`). The paragraph shaped the text with the space after it and trimmed the space afterwards
    (`line_breaker.cc:255-268`); a block's end removes the space from the text before shaping (`ExitBlock`,
    `inline_items_builder.cc:1622-1629`), so `LYAY ` lost Arial's Y+space kerning. Where the end is reshaped, the
    paragraph shaped the text without the space, as a block's end does, and the line gets no box.
  The break before the box is the business of the box holding the line's last character: for a soft wrap opportunity
  made by a character that disappears at the break, the properties of the box directly containing it control the break
  (CSS Text 3 §5.1). In Blink the painter reads the wrapping of that leaf's style, so a wrapping span's trimmed space
  ends a line in a `nowrap` block with the box: after trailing spaces the line is in its trailing state, which ends at
  the first item that can't trail, whatever that item's own wrapping (`BreakLine`, `line_breaker.cc:1100-1107`; the two
  `rule/nowrap-spans` wraps of round 2, `c-1a3fdb57af71a97c`). In WebKit the same box moved the fit decision of a line
  at its threshold (`c-a98e884c6f665a5d`, not traced), so there and in Gecko the block's own `white-space` decides. A
  line whose innermost continuing span doesn't wrap and a line ending with R7's U+200D (UAX #14 LB8a, ICU
  `line.txt:151-153`) get no box. Nothing measures the box: it only ends the line where the paragraph's next content
  did.
- **Forced breaks.** A preserved newline, U+2028 or U+2029 that ended the line is painted as it was, after everything
  else on the line (Gecko's hyphen at a soft hyphen before a newline comes after the newline among the fragments,
  `c-6ed3f560105d1120`), and a `<br>` is painted as a `<br>`. The painted line then ends at a forced break as the
  paragraph's did and not at its block's end, which the engines don't treat alike: Blink ends a line at a forced break
  whatever hangs past the band, where at a block's end it handles the overflow and backs up to an earlier break
  (`BreakLine`'s `IsAtEnd`, `line_breaker.cc:1030-1040`; the two `rule/br-elements` wraps of round 2,
  `c-ac6b59190d0c4ac4`, where a tab after hanging spaces reached past the band). A forced break at a block's end makes
  no line of its own.
- **Elements and slices.** The painter paints the line's pieces in logical order inside the elements that hold them,
  and between two consecutive pieces it replays the paragraph's element structure from the content index: spans that
  close are closed, spans that open are opened, and a span that opens and closes between them is painted empty. A span
  gets its styles (font, spacing and `lang` always, the wrapping properties where they differ from its parent's, and
  `vertical-align: 0px`), its start edge on the line holding its `box-start` fragment and its end edge on the line holding
  its `box-end`. A span with a nonzero edge on a line where none of its content is painted is painted for that edge
  alone; a span without edges is painted only around painted content or between painted pieces. The painted pieces of
  one leaf on a line become one text node, split only where the level changes. Slices of different leaves are never
  merged, since WebKit never measures across a text box and Blink rounds up each item's width. Rules that keep the
  paragraph's layout objects and text:
  - A span with no painted text on the line between two painted pieces is painted empty: a text node of only white
    space is laid out after an inline box and dropped after white space (the Blink port's `layoutTextNeeded`,
    text.cc:319-364), and `c-0ca55250962649aa` lost a form feed's 5.33px when its empty span wasn't painted.
  - A bare slice of U+0020 and U+0009..U+000D that starts a line in `normal` or `nowrap` goes in a span, because as a
    block's first child it gets no layout object, where the paragraph's node had text on another line (a VT alone on a
    line, `c-18cb262b839dc1d5`). That white-space set is Blink's for every engine today; §1.3 lists the per-engine sets.
  - White space the engine collapsed between two painted pieces of one leaf is painted where it was, and the browser
    collapses it again. In WebKit a run whose trailing white space was collapsed takes no more text
    (`Line::appendTextContent`'s `needsNewRun`, `InlineLine.cpp:374-385`), so the pieces on the two sides are two boxes,
    whose float32 widths sum to another line width than one box's (a newline after a space in `normal`: 46.66 + 500 px
    against one box of 546.66003 px, `c-334d212830923ac4`). Other collapsed text stays out, since an unused soft hyphen
    would offer the painted line a break, with one exception: where the line's last piece ends in a collapsible space
    that the engine kept because text it didn't place follows it, that text is painted too. Gecko counts a frame's
    trimmable white space back from its last character, and an unused soft hyphen there stops the count
    (`GetTrimmedOffsets`, `nsTextFrame.cpp:3319-3328`; `c-c3098254ada63761`: 19.17 px natively, 14.5 px with the space
    at the block's end).
  - WebKit: a text node gets the string storage the paragraph's node had. WebKit keeps a text node's string in 8 bits
    when it's made from Latin-1 text and in 16 when the leaf held any character above U+00FF, and its layout reads the
    storage (the WebKit port's `is8Bit`): an emergency break of 8-bit text keeps one code unit at the line start, where
    16-bit text also keeps the characters after it that can't start a line
    (`firstCharacterBreakRespectingLineStartProhibitions`, `InlineContentBreaker.cpp:139-158`). A Latin-1 slice of a
    16-bit leaf made an 8-bit node: `a` and U+00A0 from `a`, U+00A0, U+3000, `b` broke after `a`
    (`c-c2d1c62d0c2618c7`, which passed in round 2's rows only through the page's history and fails alone with round
    2's painter too). `deleteData` builds its string from views of the old one, which keep its 16 bits
    (`CharacterData.cpp:148-156`, `WTFString.cpp:90-100`), so such a node is made with a wide character after the text
    and loses it again. Probe `.artifacts/lab/painter-r3/tools/storage-probe.ts` (webkit-host): every string a script
    builds from those characters gives the 8-bit break, and `deleteData`, `replaceData` and `splitText` give the
    paragraph's.
  - WebKit: a tab or newline that the engine's content shows as a space is painted as itself, and the browser collapses
    it to the same space. WebKit's text box holds the node's own characters, and a word is measured together with the
    character after it only where that is U+0020 (`TextUtil::width`'s `extendedMeasuring`, `TextUtil.cpp:76-81`): `A`
    before a tab in `normal` is 10.67 px natively and 9.79 px before a painted space (`c-656822d19d89c4e8`, found on the
    fresh set). Blink and Gecko build their own text from the node's, where the tab is a space already.
- **Atomic inlines** are painted as empty inline-blocks of their border box and margins, `vertical-align: top`, at their
  level, for the app to fill. A `<wbr>` fragment is painted as a `<wbr>` element between its leaves, as the paragraph
  had it: in a nowrap span, `aaaa` and ` bbbb` painted without it wrapped in Firefox where the paragraph with it didn't
  (`c-46b2a8b889e1361c`, all 12 Firefox `rule/wbr-elements` painter failures; Gecko gives `<wbr>` a U+200B for bidi,
  `nsBidiPresUtils.cpp:1389-1393`; the break side not traced). The probe in
  `.artifacts/lab/painter-r2/probe-box-edges.ts` agrees: in Firefox the line wraps without `<wbr>` and as one text node,
  and holds with it. Chrome breaks at that `<wbr>` in the paragraph too, and WebKit holds the line in every form.
- **White space.** `text` and `hanging` fragments are painted as laid out, Blink's CR and FF in preserve modes
  included, so the painted line splits its shaping group there as the paragraph did. A `trimmed` fragment stays in its
  slice, so the browser trims it again and shapes the text before it the same way. Blink keeps Arial's A+space
  adjustment on the last `A` of `AAAA `, because a line ending at a space isn't reshaped: 2676 raw units at 60px, where a
  painted `AAAA` measures 2732. WebKit measures a word together with its following space (painter.md §3.1 c, §3.2 a).
  In Blink `hanging` spaces after text of the same leaf are painted in one of three forms. They are an item result of
  their own, rounded up alone (`HandleTrailingSpaces`, `line_breaker.cc:2418-2534`), and the text before them either
  keeps its pair adjustment with the first space or lost it when the paragraph reshaped its end. `ShapeLine` reshapes the
  end of an item's part unless the break sits after a space and the line needs no accurate end position
  (`dont_reshape_end_if_at_space_`, `shaping_line_breaker.cc:481-488`, `line_breaker.cc:1655-1659`). The break before
  hanging spaces sits after them (`non_hangable_run_end` moves the part's end back to the text, `:492-497`), except
  where the text overflowed and `HandleOverflow`'s retry broke it at a character (`override_break_anywhere_`,
  `line_breaker.cc:4258-4265`, `:4612-4623`): that break sits at the text's end.
  - A text node of their own, where the text kept the adjustment: the node is an item of its own that `ShapeText` still
    shapes with the text before it (`inline_node.cc:1636-1673`), and the text's end is its item's end, which `ShapeLine`
    never reshapes (`:466-473`). As one node a line that fits is one item result, rounded once (`:283-299`): `b `
    rounded to one LayoutUnit less.
  - The same node, where the line reaches past its band under `overflow-wrap` other than `normal`, `word-break:
    break-word` or `line-break: anywhere`: the painted line overflows and breaks the same way, so the text is reshaped and
    the spaces keep their part of a split pair adjustment, as in the paragraph. This is round 2's regression: 58 Chrome
    pairs, 41 of them Arial `A` before hanging spaces at 16px, painted 113 units narrower by the A+space adjustment once
    the spaces had their own node (`c-03e033cbc5d87077`).
  - A span with `vertical-align: 0px` around them, which ends the shaping group (`inline_node.cc:494-527`), where the
    line needs an accurate end position and the text was reshaped whatever the break: the text is shaped without the
    spaces (`c-02082381a42bc70c`: `LYAY` 46.6953 px natively and in this form, 46.328 px as a node of their own). The
    spaces lose their part of a pair adjustment that HarfBuzz splits between the two glyphs (limit
    `hanging-space-kern-share`).
  The forms probe has all three (`D-*`, `E-*`).
- **The hyphen** is its own span with the letter spacing the engine gives it, styled by the rule `hyphenSpan`:
  `vertical-align: 0px` in Blink, which ends the shaping group, so `‐` doesn't kern with the `r` of `super`;
  `unicode-bidi: isolate` in Gecko, which ends the text run; nothing in WebKit, whose layout measures the hyphen alone
  while paint shapes it with the word (painter.md R6).
- **Joining at a line edge.** Where `joinsNextLine` is true, U+200D goes after line n's text and before the next painted
  line's, so joining scripts keep their joined forms (R7; painter.md probe 5 hasn't run). Engines set it only where their
  shaping joined letters across the break, so the painter needs no rule for it. In Firefox the joiner doesn't
  bring the paragraph's widths back in the lab rows, and under letter spacing it takes spacing itself (limit
  `edge-inside-shaped-text`).
- **Text run ends in Gecko.** Gecko adds letter spacing after a text run's last character whatever it is, and after any
  other character only when it isn't a tab or a formatting character (General_Category Cf, `gfxFont.cpp:3661-3667`) and
  a cluster starts after it (`CanAddSpacingAfter`, `nsTextFrame.cpp:3860-3873`). A painted line's text run ends with the
  line. The paragraph's went on where the next character it kept was in the same leaf at the same level (a text run ends
  between frames of different levels, `ContinueTextRunAcrossFrames`, `nsTextFrame.cpp:2022-2030`; a preserved newline
  resolves to the base level), and there a tab or a formatting character at the line's end took no spacing: a tab alone
  on a `pre-wrap` line under 1px letter spacing is 43.6 px natively and 44.6 px painted alone (`c-00c37ed0ef4a8064`), the
  largest Firefox class on the held-out suite sample. One character after it keeps it from being last: a collapsible
  space, which the line's end trims with its spacing, or where spaces are preserved a newline, which takes no spacing
  (`:3864-3866`) and ends the block's last line as the block's end does (probe
  `.artifacts/lab/painter-r3/probes/forms-firefox-1.json`, `T-*`, `Z-*`). A newline is a paragraph separator for the bidi
  algorithm and would reset the character before it, which the soft wrap box is there to prevent; a formatting character
  has no width, so its place among the line's pieces shows in no box while its spacing does, and the newline wins. The
  line's own painted forced break serves as that character where it has one.
- **Script at a line start in Blink.** The engines give a character of script Common or Inherited the script of the run
  it continues, so at a line's start that of the text before the line (Blink's `ScriptRunIterator` merges it into the
  current set, `script_run_iterator.cc:491-540`), and painted alone it takes the script of what follows. Blink reads a
  run's script where it applies letter spacing, which a cursive script's run doesn't take
  (`IsCursiveScript(run->script_)`, `shape_result.cc:977-1024`), and where it picks fonts and shapes. The painter runs
  the Blink port's `ScriptRunIterator` (`engines/blink/script.ts`) three times: over the text of all the lines' pieces,
  over the line's text alone (one Latin segment when the painted text is 8-bit in an LTR block,
  `harfbuzz_shaper.cc:1072-1077`; a line under override spans holds their controls and is 16-bit), and over the line's
  text after U+061C ARABIC LETTER MARK, which has no width and script Arabic. The rule's `scriptsOf(text, sixteenBit,
  direction)` takes the paragraph's direction, which the painter passes at its three calls, because a painted line in an
  RTL block is segmented by script whatever its storage: an RTL block enables bidi in Blink
  (`inline_items_builder.cc:1744-1746`), and `SegmentScriptRuns` then runs over 8-bit text too
  (`inline_node.cc:1256-1290`; the port's `segmented`). Where the line alone gets other scripts than it had in the
  paragraph and gets the paragraph's after the mark, the painted line starts with the mark, in the first piece's text
  node (probe `.artifacts/lab/painter-r3/probes/forms-l7.json`, Chrome 153: a guillemet after Arabic under −1px letter
  spacing is 17.797 px in the paragraph and with the mark, 16.797 px without; `<tai` under 1.5px is 30.742 px against
  32.242 px).
  The iterator also follows a closing bracket to its opening bracket's script (`CloseBracket`,
  `script_run_iterator.cc:443-470`): `)` after Arabic whose `(` stood after Latin is Latin and takes no mark
  (`c-ca3da1d5e7083f35`, found on the fresh set). The mark is a strong character of bidi class AL, which would turn the
  European numbers after it into Arabic numbers (UAX #9 W2): it changes nothing where override spans hold all the
  line's text, and elsewhere the line takes it only if every character after it still resolves to the base level
  (`resolveIcuBidi` over the mark and the line; digits at a paragraph's start that take script Arabic from the text
  after them get none, `c-bef92f5d154ec2f9`). The mark is a grapheme cluster of its own, which a line that reaches past
  its band and still wraps would keep alone on its first line, so such a line gets none, and a line of one cluster that
  reaches past its band doesn't wrap when it takes the mark. Unicode has no such character for the other scripts, and
  every line whose scripts the painted form doesn't reproduce has the limit `script-at-line-start`. In Firefox the mark
  changes no width: Gecko's cursive exemption reads each character's own script (`nsTextFrame.cpp:4209-4213`).
  - Until 2026-09-19 `scriptsOf` had no direction, and the painter took every 8-bit line for one Latin segment. A
    line of brackets that were Latin after Latin letters in the paragraph is Common when painted alone in an RTL block
    (`c-0aaf6ad5c7daf6da`: 13 brackets in Amiri wrap after 8). No zero-width character has script Latin, so no painted
    form gives the paragraph's scripts back, and the painter saw no difference and named no limit. The change moved no
    painted DOM: the painter differential of this change alone is byte-equal on all 67,065 Chrome cases of both
    configurations. It moved the limit `script-at-line-start` and no other, in 461 recorded rows of each configuration
    (460 cases): named on 470 more lines, 8-bit lines without a letter that continued a Latin run in an RTL block, and
    on 31 fewer, such lines that are Common in the paragraph too. In tier 2 it shows as 8 painter transitions per
    configuration, all this limit: the two open `twins` rows became `fail covered by limit:script-at-line-start`, and
    six rows that gaps already covered name the limit too. No row lost its cover.
- **Bidi.** A line with a piece at a level other than the base level gets `unicode-bidi: bidi-override` on the line
  block, and one nested `bidi-override` span per level step, alternating direction, so every code unit sits inside
  exactly as many overrides as its level is above the base, and the browser reorders the line with the paragraph's levels
  (R8, painter.md §4.4). Painted alone, `שלום (עולם` would resolve the unpaired `(` by N1 and reverse the whole line; with
  levels `1 1 1 1 0 0 1 1 1 1` it draws `שלום` at the left, as the paragraph does (painter.md §4.3, probe 7). Lines whose
  pieces all sit at the base level get no override. The base level is `paragraph.direction` while the model has no
  `unicode-bidi: plaintext`; that planned field adds a base level per line.
  - An override span holds the longest run of pieces above its level, whole elements included; an element whose pieces
    straddle the run holds its own override spans. Round 2 put the override spans inside the innermost element of each
    piece. Blink then split a span with an edge into two box fragments: the override's closing control inside the span
    sits at the painted paragraph's end, takes the base level, and after `BidiReorder`
    (`logical_line_builder.cc:688-760`) the box's items aren't contiguous, so its edges go on the outer fragments
    (`UpdateBoxDataFragmentRange`, `UpdateFragmentedBoxDataEdges`, `inline_box_state.cc:720-830`): all 90 Chrome
    `rule/box-edges` and `rule/nested-box-edges` painter failures (`c-00e368136546bdb1`: the 6px border natively between
    `b` and `bbb`, painted at the line's left end). With the override around the element the forms probe (`C-outer-dir`)
    gives the native rects. The controls between pieces also ended Blink's shaping groups (any item that isn't text or a
    tag does, `ShapeText`, `inline_node.cc:1636-1673`) and changed WebKit's break before a nowrap span: all 32 webkit-host
    `rule/atomic-inlines` failures pass in this form, the 21 wraps, the 8 extents a float32 step off and 3 more.
  - Elements and the spans that hold text keep the paragraph's direction, which an override span would hand down
    instead. The direction decides the side of a span's edges; Gecko ends a text run between two frames whose writing
    modes differ, direction included (`ContinueTextRunAcrossFrames`, `nsTextFrame.cpp:2033-2038`), which cost the joined
    `ل` of `السلام` across spans 3.67 px (`c-137d09bcc442f307`, forms probe `W-*`); and WebKit trims an RTL box's trailing
    space by its style's direction (`Line::Run::inlineDirection`, `InlineLine.h:395-398`).
  - Text never sits directly in an override element; a plain span goes between. WebKit measures a text box with its
    parent's `unicode-bidi` and `direction` (`TextUtil.cpp:89-90`), so an RTL box right under an override is measured as
    an RTL override run where the paragraph measures an LTR run without override, and its float32 width moves by a step
    (66 of 154 WebKit bidi lines in the lab passed once the span was added).
  - The line's trailing white space is painted at the level of the text before it in the same leaf; box edges, `<br>`
    and `<wbr>` don't end the trailing white space. At a paragraph's end it takes the base level in all three browsers
    (above), so the painted level only decides node division, and one text node keeps WebKit's measurement of a word
    with the space after it (`TextUtil.cpp:76-77`). In Blink the space joins the text only where the two had one
    direction in the paragraph: items split where the level changes, and a shaping group ends where the direction does
    (`ShouldBreakShapingBeforeText`, `inline_node.cc:470-490`). The fragments' levels come after Blink's line-end rule,
    which moves trailing spaces to the base level, so the painter resolves the space as the paragraph did (UAX #9 N1,
    N2): the direction of the text on both sides where they agree, a number counting as right-to-left, and the base
    direction otherwise. `A` before a space and Hebrew in an RTL paragraph was shaped without the space, 10.67 px, and
    painted with it in one override span 9.79 px (`c-1235f5a7105d6155`, found on the fresh set).
  - The start of a piece that continues the grapheme cluster of the piece before it in the same leaf takes that
    piece's level too: the code units up to the first cluster boundary inside the piece, and the rest keeps its own (a
    space after a U+200C stays a trailing space, `c-d0d9e12845327e52`, found on the fresh set).
    The engines split pieces where the level changes, inside a cluster as well: at the paragraph's end a U+200C after a
    letter of another direction has the base level. Painted at its own level it followed the override span's closing
    control, which ends the letter's cluster (UAX #29 GB4), and an overflowing line that breaks at clusters broke there
    (Blink's break-anywhere retry; 69 Chrome wraps in `suite/U+200C/end` and `suite/U+200D/end`,
    `c-4793c60cfde7b77d`). At the letter's level the browser splits the two by level itself, as the paragraph did, with
    no control between them.
- Nothing sets a text width, so the painted geometry is an independent check of the predicted geometry. The widths the
  painter sets are the declared ones (slot floats, atomic boxes) and the soft wrap box's `calc(100% + 1px)`, which only
  makes it fit no band and sits on the painted block's second line, where the lab reads no text. The painter throws for
  negative slot insets, which floats can't paint. The characters it adds to the paragraph's text are R7's U+200D,
  Blink's U+061C, Gecko's space or newline after a line's last character, and in WebKit a character that `deleteData`
  removes again.

### Limits

`painterLimits` names, per line, why the painted line can differ from the paragraph's although the prediction is
right. A limit is a condition on the layout read from the engine's source; it says the painted line can differ, not
that it does. `PainterLimitName` in `src/paint.ts` has each condition with its citations. The painter names
`edge-inside-cluster` and `overflowing-line-rebreaks` itself, for every engine; the others are the engine's own
(`PaintRules.limits` and `controlsBetweenPieces`), from what the painter's plan says about the line's two edges
(`LineEdges`), and a line's list keeps the order the lab has recorded since scorer 6. specs/PAINTER-RESULTS.md has,
per limit, the failing lines it sits on and the share of passing lines it fires on (counted by
`.artifacts/lab/painter-r3/tools/limits.ts` over round 3's rows). Since scorer 6 the lab records the limits per painted
line (`EnginePrediction.painterLimits`), and a limit explains a painter failure (lab/README.md, "Painter limits").

- `carried-width` (WebKit): the line starts inside an item (`next.offset` above 0) and its first text keeps the width
  the overflow breaker carried, the item's width less the part left on the line before
  (`overflowWidthAsLeadingForNextLine`, `AbstractLineBuilder.cpp:54-98`). Painted alone the rest is measured fresh:
  another float32 sum in Latin (`c-c62182c46f2a130d`, 71.16799926757812px against 71.16796875px), no pair adjustment
  or joining across the cut elsewhere (`c-16de89e4db9184ec`, 11.42px against 3.91px). A whole item that wrapped carries
  its width too, which is the width the painted line measures again. This is 95% of webkit-host's painter failures.
  Reproducing it needs the item's earlier part in the same text box, so more than one painted line in a block.
- `word-measured-with-next-space` (WebKit): the line's last word is followed in its leaf by a space that isn't on the
  line. The paragraph measured the word with that space and took the space's width off (`TextUtil::width`'s
  `extendedMeasuring`, `TextUtil.cpp:76-81`, `:103-104`; Times New Roman `A`, 10.67px natively, 11.55px painted,
  `c-0145610398f11164`).
- `edge-inside-shaped-text` (every engine): a line edge between two characters that aren't white space, in one leaf or
  in leaves the engine shapes as one (one font and spacing, no box edge with a size between them, which ends shaping:
  CSS Text 3 §7.3, Blink `ShouldBreakShapingBeforeBox`, Gecko `ContinueTextRunAcrossFrames`), or where the engine set
  `joinsNextLine`. Gecko keeps the glyphs of the word it shaped whole, so pair adjustments, ligature shares and
  contextual forms across the cut differ (L1; `11` in Arial across an edge is 71 au, `c-627dc43bf0b22611`), and R7's
  joiner doesn't bring the joined widths back and takes letter spacing itself. Blink reshapes an edge that isn't safe to
  break, which leaves each side as the painted line shapes it, so there the limit needs more: letters at the cut of a
  script whose HarfBuzz shaper joins or reorders them (not the default, Hangul, Hebrew and Thai shapers' scripts,
  `hb_ot_shaper_categorize`, `hb-ot-shaper.hh:176-220`; the painter lists the larger ones), or a font
  whose pair adjustments aren't known to sit on the first glyph (`FontFacts.pairKerning`), since the kern and kerx
  machine moves the second glyph too and an edge after a chosen soft hyphen isn't reshaped (`super` before `‐` in
  Helvetica Neue, 18 units). With an AAT joining font Blink reshapes each cut part without context, where the painted
  line shapes the parts of one shaping group together: 2 `rule/joining` pairs that passed while round 2's override
  controls happened to separate the two spans (`c-9fff38c828d7e27f`). WebKit measures a part of an item alone, as the
  painted box does, so there the limit needs an RTL run shaped across inline boxes (`applyShapingOnRunRange`,
  `InlineLineBuilder.cpp:920-967`; L5).
- `edge-inside-cluster` (every engine): a line edge inside a grapheme cluster, as after a soft hyphen or U+200B inside
  an emoji sequence. The paragraph gave the cluster's glyph to one side, and painted alone the other side draws glyphs
  of its own (`c-012cd24fb976dc63`; in Gecko also the letter spacing a base without its marks takes).
- `space-shaped-with-next-line` (Blink): the line ends with a preserved space that the next line's first character
  follows in the same leaf. A line's end at a space isn't reshaped, and trailing spaces are a view of the paragraph's
  shape result, so the space keeps its pair adjustment with that character (Arial space before `A`, 4.453 px for
  5.5625 px at 20px; all 156 remaining Chrome `rule/text-align` failures).
- `hanging-space-kern-share` (Blink): the third hanging-space form with a font whose pair adjustments aren't known to
  sit on the first glyph.
- `han-kerning-at-edge` (Blink): the line starts or ends with a character HanKerning may trim next to another line of
  the same leaf. The trim reads the neighbouring character's type, and a painted line's start isn't the start of a
  wrapped line, where `ShapeLine` trims an opening bracket (`FirstSafeOffset`, `shaping_line_breaker.cc:92-108`; `。` is
  8px natively and 16px painted, `c-b408d44e962b357e`).
- `script-at-line-start` (Blink, Gecko): characters of the line had another script in the paragraph than the line
  painted alone gives them. In Blink the port's `ScriptRunIterator` says so, over an 8-bit line too when its block is
  RTL, and the limit holds where U+061C doesn't give the paragraph's scripts back or can't be painted. In Gecko
  the line starts with characters of script Common or Inherited, other than white space, that continued a run of another
  script than the line's own first script; there the painter tells 30 scripts apart and counts every other script as one
  kind.
- `controls-between-pieces` (Blink): two consecutive text pieces of one direction sit in different override spans,
  whose bidi controls end the shaping group between them (L9): pieces of one level that an element with pieces of
  another level separates (`النعاج` and `جيد` across two spans, 54 units, `c-17554815da2915b5`), and pieces two levels
  apart.
- `spacing-at-run-end` (Gecko): letter spacing is set, the line ends with a tab or a formatting character that the
  paragraph's text run went on after, and the painter couldn't add a character after it.
- `frame-ended-at-break` (Gecko): the line ends in trimmed white space inside a leaf, where the paragraph's text frame
  broke inside itself (`brokeText`, `nsTextFrame.cpp:11201-11213`). Only such a frame trims a trailing U+3000, which the
  line's end doesn't trim (`IsTrimmableSpace`, `:904-919`; 24 px on a painted line in 24px Amiri), and under `justify` it
  keeps the trimmed space among its justification opportunities (`:11513-11521`; `xx ` spreads to 3765 au natively and
  paints 1200 au wide, `c-0755bd21e4fae9d3`, all 32 Firefox `rule/text-align` failures). The painted frame ends with its
  text, and no character after it can overflow without showing.
- `overflowing-line-rebreaks` (every engine): the line reaches past its band and still wraps when painted, because it
  ends in white space or, in Blink, with a character HanKerning may trim. Gecko's lines whose span end margin overflows
  the band are here: the paragraph ended the line inside the next text frame, which placed without a fit test on a later
  frame, and painted the margin overflow makes `CanPlaceFrame` back up to an earlier break
  (`nsLineLayout.cpp:1189-1342`, `c-54dcffce84a8fbdb`).

Painter failures on cases whose prediction passes that no limit names, on the final runs: Chrome 10 of 489, Firefox 15
of 1,337, webkit-host 33 of 3,693, and on the fresh round Chrome 6 of 106, Firefox 3 of 364, webkit-host 10 of 866
(PAINTER-RESULTS.md lists them). Known among them: WebKit lines a float32 step off
with dictionary-segmented text, where the line alone may segment into other items than the paragraph did (9 Thai
lines).

One Blink class has a limit only by accident (`overflowing-line-rebreaks`, because its lines are 1 px wide): 8
`rule/controls` and 16 `rule/in-word-breaks` pairs that round 2's trimmed-space box lost and that still fail. The text
before the trimmed space lost its pair adjustment with it in the paragraph although the line's end needs no accurate
position: `ShapeLine` reshapes a part whole when no offset before its end is safe to break (`first_safe.offset >=
break_opportunity.offset`, `shaping_line_breaker.cc:500-507`), as after a space that kerns with the line's first letter
(`A ` after `aaaa ` in Arial: 10.67 px natively, 9.79 px painted with the box, `c-0f0589498b1c5837`). The layout doesn't
say which parts a line's shape came from, so the painter can't choose the form; Blink's `hangingForm`
(`engines/blink/paint-rules.ts`) reads the same fact from `overflows`, `needsAccurateEndPosition` and styles instead. Since round 4 the geometry says it: a text item's `runs[].reshaped` (§2.3) is the
text each run was shaped from alone, which replaces `hangingForm`'s reading of widths and `needsAccurateEndPosition` for
"was the text before the space reshaped". The painter doesn't read it yet, and needs one more limit: a wrapped line whose
first run isn't reshaped and whose first cluster kept an adjustment with the previous line's last cluster (U+3000 in a
font without it, `c-0ee8c36920378f9f`) paints without it and fails without a covered explanation.

The lab appends the elements to a host of the paragraph's width (lab/README.md, "Page protocol" step 5). Under the
observation contract (§9) the painter metric compares each painted line's code point and node rects with the expected
rects of that line: the painted block has the paragraph's width, direction and the line's floats, so an LTR line's items
still start at the band's start and an RTL line's still end at its end. When the prediction metrics pass and the painter
fails, the painting form is wrong, not the prediction, and the limits above name why. Positioning line blocks absolutely
(form C) gives the same shaping and stays the fallback if a case class needs it.

`lab/predictor.ts` calls `lab/predictor-core.ts`'s `layoutParagraph()` in `predict()`, and `paint()` paints the lines `predict()` filled, from the pieces it read of them.

## 8. Modules, tests and order

### 8.1 Layout and owners

```
rebuild/
  CHARTER.md DESIGN.md REPORT.md TESTS.md TAKE-BACK.md SHARED-CHANGES.md
  tsconfig.json                   bunx tsc --noEmit -p rebuild/tsconfig.json (and lab/, lab/cases/, tests/, probes/, bench/)
  knip.config.ts                  bunx knip --config rebuild/knip.config.ts (from the repository root)
  specs/ research/ data/ probes/  other owners
  lab/                            lab owner; predictor-core.ts is the one file that imports library logic: it makes a
                                  row's layout from the function set, one slot at a time (types.ts ParagraphLayout),
                                  and counts a layout's Canvas work
    observe/                      the observation ports of §9, one per engine, and their contract (contract.ts)
  tests/                          rule registry, families, facts, coverage, gate; the tiers (sets, replay, browser-sets,
                                  ledger, known tail); the function set's checks (function-set.ts); the coverage map
  bench/                          costs against main, with the rebuild in count, pieces and inspect modes (bench/README.md)
  platform-bugs/                  browser bug candidates: LEDGER.md, standalone pages, results, verify.ts
  tools/
    gen-shared.ts lines.ts ppucd.ts          generator helpers                         architect
    gen-unicode-data.ts                      → src/unicode/generated/bidi-data.ts       architect
    icu-bidi-oracle.c icu-bidi-oracle.ts     ICU's own ubidi, for the bidi tests        architect
    gen-blink-data.ts                        → src/engines/blink/generated/break-tables.ts  Blink owner
    gen-webkit-data.ts                       → src/engines/webkit/generated/break-tables.ts WebKit owner
    gen-gecko-data.ts                        → src/engines/gecko/generated/{break-data,props,likely-subtags}.ts         Gecko owner
    gen-webkit-fonts.ts gen-webkit-joining.ts  → src/engines/webkit/generated/{fonts,joining}.ts                        WebKit owner
    citations.ts                             the citation and prose ledger: a rewrite loses no citation, rule or gap prose
    painter-diff.ts recording-document.ts    the painter differential: the working painter against a frozen bundle, offline
    stand-in-canvas.ts two-trees.ts          a deterministic Canvas, and two checkouts on the same cases under it
    twin-scan.ts                             counts the cases that ask one Blink context the same characters in both storages
    store-study.ts store-*-probe.ts          the store study (research/STORE-STUDY.md): what the chat messages ask of Canvas,
                                             offline, and four probes that time or check it in the browsers
    store-key-check.ts store-real-text.ts    checks on the store study: a key with two recorded answers, a store's hit rates
    store-space-identity.ts                  on long-form text used once, a run against its sides measured with their space,
    store-cluster-sums.ts                    a cluster's advance inside a run against the cluster alone,
    store-word-facts.ts                      the word facts new to a page on text used once,
    store-canvas-bound-probe.ts              how many measured strings one canvas keeps,
    store-stale-answer-probe.ts              and one key with two answers inside one page (Firefox's emoji state)
    webkit-host/                             the WKWebView host on the system WebKit (build.sh, main.swift)             lab owner
  src/
    index.ts        prepare, firstLine, fillLine, linePieces, inspectLine, paragraphGaps: the dispatch over the engines'
                    function sets (§2.9), the runtime font checks before the engine, the engine-build gap             architect
    model.ts        input tree, font facts, line slots, fragments, gaps, and what the function set returns
                    (FillResultOf, LinePieces, LineInspectionOf); names no engine                                     architect
    env.ts          Environment, process languages, GivenFacts, PINNED_BUILDS, detectEngine(), detectEnvironment()   architect
    content.ts      indexContent, styleUnder, langUnder, and its test                                               architect
    font-family.ts  listedFamilies: a CSS font-family list as the families it names, the one parser the font checks
                    and the three ports read (§1.1), and its test                                                   architect
    paint.ts        paintLines(), painterLimits(), PaintRules and PaintLine: the painter, which names no engine (§7)  architect
    measure/        canvas.ts (contexts, width and bounds, §4.6), font.ts (font strings), font-checks.ts (font facts
                    asked of Canvas, §1.2), canvas-checks.ts (what the recipes assume of Canvas, §1.4)                architect
    test-lines.ts   test support: every line of a paragraph through one engine's function set                        architect
    unicode/        bidi.ts, ubidi.ts, unicode-bidi.ts, grapheme.ts, tests, generated/                                architect
    breaks/         rbbi.ts, icu4x.ts, pair-table.ts, rbbi.test.ts                                                    architect
    engines/
      blink/        index.ts (prepare, the decided line and the function set), types.ts (the prepared paragraph: one
                    record per style with its Canvas contexts, items as a tagged union), content.ts (computed styles
                    and items), contexts.ts (a style's Canvas contexts and a measured total), line-breaker.ts (what
                    fills a line), breaks.ts (boundaries pulled as a line asks), shape.ts (widths from Canvas),
                    pieces.ts (linePieces), inspect.ts and limits.ts (what inspectLine computes), gaps.ts (every gap
                    condition; canonical lists), emoji.ts (RunSegmenter's priorities and segment edges); the port's
                    other files and tests                                                                             Blink owner
      webkit/       index.ts (the function set; composes inspectLine), types.ts (the prepared paragraph, boxes with
                    their Canvas contexts, and a decided line with its runs), content.ts (boxes and the builder
                    choice), items.ts (the item builder), breaks.ts, measure.ts, lines.ts (filling), output.ts (pieces
                    and geometry from a decided line), gaps.ts (every gap's condition, prose and merge rule; the box
                    facts of an inspected paragraph), history.ts (its history worlds, and a line laid out in them);
                    the port's other files and tests                                                                  WebKit owner
      gecko/        index.ts, types.ts (leaves, frames, items, elements, text runs with their Canvas contexts, shaping
                    units with what measuring found inside them), prepare.ts, measure.ts, advance.ts (the advance
                    before an offset inside a shaping unit), lines.ts (a fill and the decided line), placement.ts,
                    pieces.ts, inspect.ts, gaps.ts; the port's other files and tests                                  Gecko owner
                    and in each: index.ts exports the function set; geometry.ts (the line geometry and line start the
                    rows keep: types only, the one engine file the lab imports), data.ts (its break rules, grapheme
                    rules and BidiData), checks.ts (what it asks of measure/canvas-checks.ts and
                    measure/font-checks.ts), paint-rules.ts (what a painted line needs in this engine, and its limits),
                    generated/
```

Outside comments, no file of `src` but `index.ts`, `env.ts` and the engines' own names an engine
(`tests/independence.test.ts`).

An engine owner edits only their engine directory, their generator and its generated module. A change a port needs in
a shared file (a model field, a new gap name, a shared helper fix) goes in the owner's report, and the architect makes
it. `rebuild/lab/observe/` may import types from `src/model.ts` and an engine's `geometry.ts` only, never engine logic,
so no expected observation comes from the library (TEST-ARCHITECTURE.md §0 rule 1); the layout it reads and the contract it implements are the
lab's own types (`lab/types.ts`, `lab/observe/contract.ts`). The ports walk the tree themselves; they don't import
`src/content.ts`.

### 8.2 Tests

`bun test rebuild` runs 862 tests in 64 files (2026-09-19, after the fresh-eyes follow-up; TESTS.md has the tiers above unit tests). `src/content.test.ts` checks the document-order index:
leaf offsets and parents, preorder element numbering with their events, style and language lookup, and empty leaves.
The bidi tests build `tools/icu-bidi-oracle.c` with clang against Homebrew `icu4c@78` and the system libicucore:

- `src/breaks/rbbi.test.ts`: 1,658 libicucore probes from `data/webkit/icu-macos27-libicucore/probes.tsv` over the
  dumped tables with Apple's quote overrides derived from `delimiters.tsv`, 0 failures (592 samples skipped because ICU
  would run a dictionary engine, 900 rows for locales `delimiters.tsv` lacks); the ICU C probe results over Chrome 153's
  tables from specs/blink-text.md Appendix B and specs/blink-canvas.md §2.3; the generated modules decode to the pinned
  bytes.
- `src/unicode/grapheme.test.ts`: `GraphemeBreakTest-17.0.0.txt` with each engine's data, 0 failures.
- `src/unicode/bidi.test.ts`: for every code point, Blink's Bidi_Class equals Homebrew icu4c 78.3's (Chrome's ICU 78.2
  bidi data) and WebKit's equals the system libicucore's, with the same 64 bracket pairs; Firefox's Bidi_Class equals
  ICU 78.2's, and the crate's bracket pairs equal Unicode 17's.
- `src/unicode/ubidi.test.ts`: direction, paragraphs, every level and the logical runs from ICU equal the port's, with
  either ICU, over 770,241 BidiTest-17.0.0 runs, 183,379 BidiCharacterTest lines (ICU's 6.3.0 file and the crate's
  15.0.0 file), 405,000 fuzz strings (class-B and class-S characters, CR LF, supplementary characters, unpaired
  surrogates, Apple's private-use classes), 3,378 cases nested past the explicit-level and bracket limits, and 51
  directed cases: 0 differences.
- `src/unicode/unicode-bidi.test.ts`: the crate port with Gecko's data over BidiTest-17.0.0 (770,241 runs) and the crate's
  BidiCharacterTest-15.0.0 (91,709 cases), 0 failures, and the crate-side levels of specs/bidi.md §7.5.
- Engine tests: Blink's break scan against 13,108 oracle requests, Chrome's own `script_run_iterator_test.cc` cases,
  content and line examples; WebKit's `classify` dump, pair table, probe verdicts and libicucore SA positions; Gecko's
  probe verdicts over Courier New and `icu_properties` equality. The shortcut audits rate their strength (blink §6,
  webkit §4, gecko §7).

Engine ports add bun tests in their directory against recorded outputs, streamed line by line (`tools/lines.ts`):

- Blink scan: `runtime-parity/blink-webkit/work/blink-requests.jsonl` and `blink-answers.jsonl`, 13,108 requests
  answered by the C++ Blink oracle over Chrome 153's ICU data (line starts per line).
- WebKit scan: `webkit-requests.jsonl` and `webkit-answers.jsonl`, 19,393 requests from the oracle at Safari 7624.
  WebKit 7625 changed `BreakablePositions` (specs/webkit-text.md §15), so rows those changes touch need the patched
  rules or are excluded.
- Gecko scan: `runtime-parity/gecko/tools/unit.ts`'s cases, and the Rust oracle rebuilt against Firefox 156's data
  (specs/gecko-oracle-replay.md).
- SA sources: `runtime-parity/sa/results/raw/*.jsonl`.
- Blink's own `line_breaker_test.cc` has Ahem cases with inline boxes, floats and text-indent, which a stand-in Canvas
  reproduces (blink audit §6); they are the first tests for stage 5's Blink rules.

Lines are tested in the lab's pinned browsers under the shared lock's slots (lab/README.md, "Test tiers"): unit tests, the
offline replay of recorded Canvas answers, then the tiers' sets in a browser. TEST-ARCHITECTURE.md lays out the test layers the rebuild grows into: parity
with engine libraries, browser facts per build, offline replay, rule-targeted families at thresholds taken from
observations, sealed held-out sets, and the gate.

### 8.3 The order things landed in

Other documents and source comments name these stages; each ended with the unit tests green, the lab runnable in each
browser, and the gate either green or its losses attributed in a seed diff. REPORT.md and the engines'
`specs/*-RESULTS.md` have what each found.

0. **Recording** (lab). Rows and run records carry the app bundle build and the browser process's languages as the
   driver launched the browser with them or read them (`lab/types.ts` `ProcessLanguages`), the page passes them to
   `predict`, and `lab/predictor.ts` puts them in `GivenFacts`. `run.ts --record-measurements` records every Canvas
   answer and dictionary segmentation of a case, so the library lays a recorded case out again in bun and a question the
   record lacks says it needs a browser run. That is tier 1 (lab/README.md, "Test tiers"), and the recorder is the
   lab's: the library has no recorded source and no log.
1. **Engine-true output and explicit inputs** (2026-09-17, 7c3fcf9). Engines read their own environment fields and
   replace name keys and the joining constant with font facts (§1.3); lines carry per-engine geometry and gaps; lines
   without line boxes are returned.
2. **Observation ports** (with 1). `lab/observe/{blink,webkit,gecko}.ts` implement the contract of §9, and the scorer
   compares rects exactly.
3. **The font fact table and the probes behind the defaults.** The lab's table per OS build landed (§1.2), with rule
   families that have cases on both sides of each fact (TEST-ARCHITECTURE §2). The probes this stage listed behind the
   defaults were overtaken in part by the runtime font checks, which ask Canvas for the hyphen, the optical-size scaling
   and fixed pitch (§1.2), and by Gecko's in-word probe (gecko-port F15, §5); painter probe 5 hasn't run (§7).
4. **Retire G0.** Open: the lab's first baselines (`lab/baselines/gate-<browser>.json`, scorer 1, keyed on user agents)
   stay a report-only measurement corpus until their pairs are attributed (TESTS.md §10; REPORT.md §7).
5. **Inline structure, line slots and alignment** (2026-09-17). The input became the tree of §1.1 with box edges, atomic
   inlines, `<br>`, `<wbr>`, text-indent and text-align; lines are filled one slot at a time (§2.9); the ports walk
   `indexContent(paragraph)`, read each item's own style where the source does, and convert a slot's insets with their
   own float arithmetic; the observation ports walk the tree and report `elements`; the lab's cases, page and scorer
   carry structure, slot floats and element rects; and the feature families of TESTS.md §4 cover the new rules.

**The correctness line** (2026-09-18, tag `correctness-line`). Four ceiling rounds took each port to where the remaining
failures are named gaps, registered residual classes or the known tail, without supplied font facts as the headline
configuration, with the runtime font checks (§1.2) and Firefox on an OffscreenCanvas always (§4.1). The tiers, the
ledger and the frozen references hold it (TESTS.md, "Tiers"; REPORT.md, "The correctness line").

**The re-architecture** (2026-09-18 and 19; research/ARCHITECTURE-PLAN-2.md). It moved no prediction it didn't account
for row by row, and kept every ported rule, citation, gap condition, probe order and observation port
(`tools/citations.ts`). In the plan's names:

- *Step 0*: tier 1's classification of changed questions, the function set's checks, the coverage map, the citation
  ledger, the painter differential, the twin family.
- *S1 to S3, the shared layer*: the lab owns the row, the slot loop and the observation contract; shared code stops
  selecting engines, and each engine gives its data; the width moves from the paragraph to the slot, and every port
  gives the function set of §2.9.
- *X1*: gaps get one home per port, and a paragraph is prepared plain or inspected (§2.8).
- *X2*: the string memo goes, and the ports hold their contexts and keep what they need twice as values (§4.6, §4.7).
- *The painter*: `paint.ts` takes what `linePieces` gives and each engine's `PaintRules`, and names no engine (§7).
- *X3*: the ports' model clean-up (§3); with it Blink's gap lists became canonical (§5), a painted line in an RTL block
  is segmented by script (§7), and an inspected Blink paragraph makes no unused one-byte hyphen contexts.
- *The last step*: the index API with its memo and log, `measure/log.ts` and the dead line types are deleted, Knip's
  findings and one stale script go, and the documents describe the library as it is.

**Correctness round 5** (2026-09-19; research/CORRECTNESS-ROUND-5.md). The fixes that close the gap with main's true
passes where Canvas can settle them without supplied font facts, one owner per engine, then a critic. Gecko asks
Canvas which glyph of a kerned pair carries the adjustment, measures a joined suffix that a fallback font draws behind
its own first letter, and measures a boundary U+00A0 as itself; WebKit takes the font code path from the measured
string and measures a box's space once; Blink's pair window reaches past a cluster of only default-ignorable characters
and marks (§4.4). Main's true passes that still fail without facts went from 202 to 76 in Firefox and from 263 to 252
in webkit-host, and stayed 344 in Chrome, where no sound Canvas recipe exists (§5). Two exceptions to §4.6 were accepted
with it, and Gecko's lazy plain scan came with a note for the maintainer; the profiling phase measured the scan and
took it out, and one of the two exceptions with it (§4.6).

**The fresh-eyes follow-up** (2026-09-19; research/FRESH-EYES-REVIEW.md, SHARED-CHANGES.md). A reviewer who hadn't
worked on the code read the library against the engineering guide, and three owners and a critic took up what it
found. One parser reads a font-family list for the font checks and the three ports (§1.1). Gecko's text runs hold
their recipe contexts by reference, on a record that also holds the context's pair placement (§4.6). Blink compares its
two system font names as Chromium does (§1.2), and a span that holds nothing but empty items and a collapsible space
creates a box fragment (§1.1), which was the review's one open row and a known-tail class that had blamed the lab.
That rule changed the predictions of 494 Chrome cases per configuration by design, so Chrome's references were
recorded again at the merge (TESTS.md, "Tiers"). What the review found and nobody took up is in its §8 and in the
owners' entries of SHARED-CHANGES.md.

**Next**: profiling and optimization, which may add complexity back where numbers ask for it
(research/PROFILING-START.md: the measurer's lifetime first, then the two stores of §4.7, then the recipes that buy
nothing); then the shape of the public API, where both a stateless call over an invisible store and carried handles
stay possible (research/IDEMPOTENT-API.md, research/DEMO-COVERAGE.md, research/CAPABILITY-CHECK.md,
research/INCREMENTAL-API-READING.md).

## 9. Observation contract

`rebuild/lab/observe/contract.ts`, implemented by `rebuild/lab/observe/<engine>.ts`:

```ts
type Expected =
  | { state: 'predicted'; value: number }
  | { state: 'limited'; gap: GapName; value: number }
type ExpectedRect = { line: number; x: Expected; width: Expected }
type UnobservableFact = { line: number; fact: string; rule: string }
type ExpectedObservation = {
  codePoints: { offset: number; length: number; rects: ExpectedRect[] }[]
  nodes: ExpectedRect[][]      // per text leaf
  elements: ExpectedRect[][]   // per element
  unobservable: UnobservableFact[]
}
type CanvasMeasure = (settings: CanvasSettings, text: string) => number
type ObservationPort<Layout> = (paragraph: Paragraph, layout: Layout, measure: CanvasMeasure) => ExpectedObservation   // Layout: the engine's member of ParagraphLayout
```

The lab records, for every code point, the rects of a Range over it in its leaf's text node, for every leaf the rects of
a Range over the whole node (`lab/page.ts`), and from stage 5 for every element `Element.getClientRects()`. A port takes
the layout and returns what the browser will report for exactly those ranges and elements, by the engine's own geometry
code at the pinned version: Blink's `LayoutText::AbsoluteQuadsForRange` and `LayoutInline::QuadsForSelfInternal`,
WebKit's `RenderText::absoluteQuadsForRange` with `snappedSelectionRect`, `RenderInline::absoluteQuads` and
`RenderLineBreak::absoluteQuads`, Gecko's `GetPartialTextRect` with `GetPointFromOffset`, `nsLayoutUtils::GetAllInFlowRects`
and `DOMRect::SetLayoutRect`.

Every fact about a rect is in one of three states, and the last two are never mixed (TENTPOLES-CRITIC.md §4 item 4):

1. **Predicted.** The ported geometry rule gives the value exactly from engine output: an item or box edge, a frame
   box, a rect count. The lab compares it exactly.
2. **Limited by a named gap.** The value is observable, but the port computes it from a Canvas stand-in for data the
   engine had: glyph advances inside a word, which code points a glyph covers. The lab still compares it exactly, and a
   mismatch is attributed to the gap, never to an engine rule and never suppressed.
3. **Unobservable by an engine rule.** An engine output fact that no rect of any kind reflects, because the cited
   geometry code gives the same rects whatever its value. The port lists it; the lab never compares it and never counts
   a rule as covered by it.

`y` and `height` are outside the contract until vertical metrics are ported: they need rounded ascent and descent and
line box heights, which the model doesn't carry. That is a limit of the port, not an unobservable fact.

| | Predicted | Limited | Unobservable by rule |
|---|---|---|---|
| Blink (observe-blink.md §4-§9) | whole item rects; slice edges at item edges; boundary rects of uncovered units at the items they touch; the hyphen that a range includes after an included item end (`layout_text.cc:616-621`); collapsed units mapping to the next non-collapsed content; nodes without a layout object report nothing; line membership | caret positions inside an item, floored and ceiled to LayoutUnits, under `in-word-prefix` or `unsafe-to-break`; equal shares of clusters a font's ligatures merge, under `glyph-clusters` | positions finer than a LayoutUnit (U1); how one grapheme's advance divides among its code points (U2); the hyphen of an odd-level item on its node's first line with items (U3); whether a zero-advance code point is covered or only touches an item (U4); which rule dropped a node that reports nothing (U5); which glyph a character draws (U6) |
| WebKit (observe-webkit.md §5-§10) | whole-box rects, x and width bit-equal as `f32(f32(x + w) − x)`; which boxes report for a range and on which lines; caret rects at a box start, `floor(x)`; rects of white space outside boxes; nodes without a renderer | partial rects' interior edges and the right edge of a box's last code point (U2, U4), from in-context advances measured through `measure` under `in-word-prefix`; whether a zero-advance code point has a glyph of its own (U3), under `glyph-clusters`; page zoom ≠ 1, under `page-zoom` | whether trailing white space hangs under `text-align: start` (U5); which hyphen glyph was drawn when both advances are equal (U6); the line of a collapsed unit after the first of its run (U7) |
| Gecko (observe-gecko.md §2-§8) | every frame box edge, encoded `fround(R(au))` field by field; one rect per overlapping continuation; nodes without a frame report nothing; the chosen hyphen's width inside its box (E5); line membership where the frame has height | points inside a frame whose advance sum starts or ends inside a shaping unit (the layout's `unitStart`), under `in-word-prefix`; frame boxes, later frames' positions and element rects are engine output and predicted (ceiling round 2) | the advance of white space trimmed at a break or by `TrimTrailingWhiteSpace`, and the overflowing part of hanging spaces (U2, except the growth of a negative delta); how a cluster's advance splits among its code points (U3); glyph widths inside a ligature beyond shares (U4); which zero-advance characters exist (U5); letter spacing apart from the glyph advance (U6); where frames split between zero-width characters (U9); which hyphen glyph (U10) |

**Boxes.** What elements report, and what box edges do to text rects:

- **Spans.** Blink: `LayoutInline::QuadsForSelfInternal` walks the span's fragments including culled ones
  (`MoveToIncludingCulledInline`, `layout_inline.cc:428-470`): a span with a box fragment reports its border box per line,
  a culled span the rects of the items inside it. WebKit: `RenderInline::absoluteQuads` reports the span's inline box on
  each line (`RenderInline.cpp:237-241`). Gecko: `nsLayoutUtils::GetAllInFlowRects` reports each continuation's border
  box (`nsLayoutUtils.cpp:3477-3505, 3661-3667`). Every edge is predicted from the geometry: Blink's `inline-box` items or
  the covered items, WebKit's `inline-box` boxes, Gecko's `inline` frames.
- **Atomic inlines** report their border box: predicted from the `atomic` item, box or frame.
- **`<br>`.** Blink: the forced-break item of the `LayoutBR` text; WebKit: the line break box's visual rect
  (`RenderLineBreak.cpp:97-104`); Gecko: the `BRFrame`'s box. Predicted, including line membership.
- **Text rects** sit past the start edges of the spans before them on the line, in engine units: Blink's items after an
  open tag's inline size, WebKit's boxes after the inline box start width, Gecko's frames inside their inline frame after
  its start border and padding. The ports take positions from the geometry, which includes them, and from `lineLeft`,
  which includes slot insets and indents.
- **Unobservable by rule, added in stage 5:** a margin, which no rect includes and only neighbours' positions show; the
  end border and padding a Gecko continuation reserves on a line that doesn't hold the span's end edge
  (`nsInlineFrame.cpp:514-521`), which only breaks show; a refused slot (`belowFloats`), which shows only in vertical
  positions, outside the contract; `needsAccurateEndPosition` and `impactedByFloats` themselves, which only widths and
  breaks show.
- **`<wbr>`** to settle by probe. Blink's opaque flow-control item has an empty result, which produces no fragment item
  (`logical_line_builder.cc:419-433`), so Blink should report no rect; WebKit and Gecko aren't traced. The stage 5 family
  smoke runs of 2026-09-17 (5 `<wbr>` elements per browser) observed no rect in Chrome and webkit-host and one rect in
  Firefox, so Gecko's `WBRFrame` has a box. Ceiling round 2: Gecko's layout places the WBRFrame (§2.5 `wbr` frame, 0 × 0 at
  its place on the line), and the port reports that box, as round 1's feature rows show (`c-00370d538345f01b`: x 3558 au,
  width 0, height 0 after a 3558 au frame).

How the lab compares:

- Per code point, per node and per element, the observed rects equal the expected rects in count and order, each `x` and
  `width` exactly after the engine's rounding: raw LayoutUnits divided by `64 × zoom` in float32 for Blink, float32 bits
  for WebKit, the app-unit encoding for Gecko. Observed rects carry no line index. Where one node's or element's rects
  decide it, the lab checks line membership against the expected rects' lines; across nodes it groups by vertical centre,
  a named observer assumption, and slot cases add the slot-rows assumption (§2.9).
- A line's observed width is the union of its whole-node rects, and with box edges the union of its span rects, and it
  equals the engine width of §2.6.
- `measure` answers Canvas calls the port itself needs, such as WebKit's in-context prefix widths of a box, which
  layout never runs. In the page it measures live. Offline it answers from the row's recorded log and reports a call the
  log lacks as needing a browser run.
- The same port scores the painter: the painted line's rects against the expected rects of that line (§7).

This retires the scorer's visibility rules as the widths metric, the soft-hyphen box filter, the float32-step
allowance for Firefox, the Safari edge exclusions and the height tolerance. Each becomes a ported rule above or a named
observer assumption (TENTPOLES-CRITIC.md §4 items 3, 12).
