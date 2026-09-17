# Pretext rebuild: design

Status, 2026-09-17, branch `rebuild-20260916`: the data model follows rebuild/CHARTER.md. Layout returns each engine's
own line geometry in that engine's units (§2). Font facts, the browser build and the browser process's languages are
explicit inputs (§1.2, §1.4). The contract the lab's observation ports implement is defined (§9). The input is a tree of
inline content: spans with their own wrapping styles and box edges, atomic inlines, `<br>` and `<wbr>`, with the block's
text-indent and text-align (§1.1). Lines are laid out one slot at a time, so each line can have its own available width,
and the lab verifies that natively with floats (§2.9). The input and environment types, the content index, the
measurement layer, the painter and the shared Unicode and break-data pieces exist and are tested. The three engine ports
and the observation ports still read the flat model of runs; they convert in stage 5 of §8.3, which says what each owner
changes. Until then `tsc` fails under `src/engines` and `lab/observe`.

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
handles it with a recipe, takes the missing fact as an input, or reports a named gap (§5). Correctness comes first;
performance is recovered later, and every layout records what it measured (§4.6).

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
- **Font fact**: something about a realized font that an engine reads and Canvas can't show, such as the monospace
  trait (§1.2).
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
  width: number; lineHeight: number
  textIndent: number; textAlign: 'start' | 'end' | 'left' | 'right' | 'center' | 'justify'
}
type Paragraph = ParagraphOf<FontDecl>                            // what the library takes
```

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
  "lang": "en", "direction": "ltr", "width": 150, "lineHeight": 22, "textIndent": 0, "textAlign": "start" }
```

It stands for `<div lang="en" style="…">` holding `<span>Hello </span><span>world</span> and <span>more text…</span>`.
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
  (`inline_items_builder.cc:1269-1283`).
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
}
const UNKNOWN_FONT_FACTS: FontFacts   // every fact null
```

Engines read facts about the fonts a declaration realizes: which family is primary, whether it maps U+2010, whether it
has the monospace trait or an opsz axis, whether the font drawing Arabic shapes through OpenType tables or `morx`.
Canvas shows none of these. A heuristic that guesses them from family names is a rule nobody can cite, and a constant
chosen by lab counts fits the lab's font mix. So each fact is an input on the font declaration. When a fact is null,
the engine uses a default that plain Canvas measurement gives, and reports the named gap wherever the fact decides a
result. A given fact never produces a gap of its own.

| Fact | Read by | Rule | Default when null | Gap when null |
|---|---|---|---|---|
| `primaryFamily`: the family the browser realizes first; a generic keyword stands for itself | Blink and Gecko for their system-font keywords; WebKit for Courier New | Blink's primary font is the first listed family that exists (`PrimaryFont` with `should_contain_glyph` false, `font_fallback_list.h:141-145`); WebKit's index-0 family (`FontCascadeFonts.cpp:200-218`); Courier New gets no width shortcut by family name (`FontCoreText.cpp:776-782`) | the first family in the list | none; the facts that depend on it report theirs |
| `mapsHyphen`: the primary font maps U+2010 | Blink, WebKit | a chosen soft hyphen is U+2010 when the primary font maps it, else U+002D (`computed_style.cc:1804-1820`; `StyleComputedStyle.cpp:419-435`) | U+2010, measured in the run's context | `hyphen-glyph` at a chosen soft hyphen where Canvas gives `‐` and `-` different widths in that context |
| `monospace`: the primary font has `kCTFontMonoSpaceTrait` or `kCTFontFixedAdvanceAttribute` | WebKit | `Font::determinePitch` (`FontCoreText.cpp:753-785`); fixed pitch enables the width shortcut and the breakWord shortcut (specs/webkit-gaps.md §2.3) | variable pitch: real advances | `fixed-pitch-path` where a text item of a box that allows simplified measuring doesn't measure `f32(length × W(' '))` (webkit-gaps §2.5, test T1) |
| `opticalSizeAxis`: the fonts drawing the declaration have an opsz axis | Blink at layout zoom ≠ 1; Gecko | Blink's DOM shapes at the zoomed size with opsz at the CSS size (`font_platform_data_mac.mm:170-176`); Gecko's OffscreenCanvas uses the axis default (specs/gecko-canvas.md §1.2 C1a) | true when `primaryFamily` is the engine's system-font keyword (Blink: `system-ui`, `BlinkMacSystemFont`; Gecko: `system-ui`, `-apple-system`), else false | `optical-size`: Blink wherever layout zoom ≠ 1; Gecko for every run |
| `joining`: how the font drawing joining-script text shapes | Blink | HarfBuzz's Arabic shaper reads the shaping call's context for OpenType fonts; `morx` fonts never read it (`hb-ot-shape.cc:60-66, 100-101`) | each shaping call's text measured alone, which is what an AAT font gives | `joining-technology` at a shaping-call edge between joining letters |

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

The keyword defaults of `opticalSizeAxis` aren't name keys. `system-ui` is CSS, each engine resolves it in source to the
platform UI font, and that font's axis is a recorded browser fact (probes-chrome correction 7, probe cross-cutting 5).

Where the facts come from is the caller's business. The lab takes them from a pinned table per OS build, generated
offline from the installed fonts and checked by hash (§8.3, stage 3). The table's columns are the monospace trait, cmap
coverage of U+2010, fvar axes and `morx` against GSUB and GPOS, from the same tools as specs/webkit-gaps.md §2.4 and §3.2,
specs/blink-gaps.md §5.3 and specs/gecko-gaps.md §3.3. It is keyed by family, weight and style. `lab/predictor.ts`
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
| webkit/gap/canvas-language | by score | the condition from source without narrowing by counts: generic families resolved per locale, `system-ui` and `ui-*`, and Han, kana or Hangul fallback (`FontGenericFamilies.cpp:50-66`, `FontCacheCoreText.cpp:585-598, 822`); later from Core Text cascades dumped per language |
| webkit/gap/simplified-measuring | by score | reported for every simplified-path box outside the width shortcut until a probe settles the float32 summing order (probes-safari correction 5) |
| shared/env/engine-from-user-agent | heuristic | the user agent gives the engine only; the build and the browser process's languages are given facts (§1.4) |
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

The library reads only page facts (CHARTER.md, "Boundaries"). `detectEngine()` reads the engine from the user agent.
`detectEnvironment(given)` checks that engine against the given facts, then reads `devicePixelRatio`,
`document.documentElement.lang` and which segmenters `Intl` has. Everything else is `GivenFacts`, a union with the
build, `contentLanguage` and that engine's process languages. Tests, and predictions for another runtime, build an
Environment directly.

| Field | Source | What reads it |
|---|---|---|
| `engine` | `navigator.userAgent`: `Firefox/`, `Chrome/` (not `Edg/` or `OPR/`), `Version/… Safari/` | the one switch (§3) |
| `build` | given: the app bundle version (Chrome's and Firefox's `CFBundleShortVersionString`, WebKit.framework's `CFBundleVersion`). Chrome's reduced user agent shows only the major version | `layoutParagraph` reports `engine-build` when it isn't `PINNED_BUILDS[engine]`, null included, and the layout records the environment it ran under |
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
locales Firefox reads. `contentLanguage` and `regionalPrefsLocale` were given facts no engine read (research/CHARTER-CRITIC.md
items 10 and 11); stage 5 has the owners read them where the source does.

**Predicting one engine from another runtime.** Canvas totals come from the running browser: Core Text advances in
Safari, Gecko's per-glyph app-unit rounding, Blink's HarfBuzz advances. An environment built for another engine gets
its break rules right and its widths from the wrong Canvas (DESIGN-REVIEW.md §3.4). Only tests do this, with stand-in
widths.

## 2. Output

### 2.1 The layout

```ts
type ParagraphLayout =
  | { engine: 'blink'; env: BlinkEnvironment; lines: LineOf<BlinkLineStart, BlinkLineGeometry>[]; belowFloats: BelowFloats[]; measure: MeasureLog; gaps: Gap[] }
  | { engine: 'webkit'; env: WebKitEnvironment; lines: LineOf<WebKitLineStart, WebKitLineGeometry>[]; belowFloats: BelowFloats[]; measure: MeasureLog; gaps: Gap[] }
  | { engine: 'gecko'; env: GeckoEnvironment; lines: LineOf<GeckoLineStart, GeckoLineGeometry>[]; belowFloats: BelowFloats[]; measure: MeasureLog; gaps: Gap[] }

type LineOf<Start, Geometry> = {
  start: number; end: number     // source offsets; consecutive lines tile the text
  fragments: Fragment[]          // logical order, no widths (§2.2)
  hasLineBox: boolean
  joinsNextLine: boolean
  slot: LineSlot                 // the slot the line was laid out in (§2.9)
  indented: boolean              // the engine applied text-indent to this line
  align: TextAlign               // the alignment the engine used for this line
  geometry: Geometry             // the engine's own line (§2.3-§2.5)
  gaps: Gap[]                    // gaps this line's breaks decide (§2.8)
  next: Start | null             // null after the last line (§2.7)
}
type LineResultOf<Start, Geometry> = { kind: 'line'; line: LineOf<Start, Geometry> } | { kind: 'below-floats'; gaps: Gap[] }
type BelowFloats = { row: number; gaps: Gap[] }
```

What is shared and what isn't follows from who reads it. The painter and the lab's line ranges need the engine's
classification of content per line, in source offsets: what it laid out, trimmed, collapsed or hung, and which line holds
each element. All three engines make those distinctions, so `fragments` is shared, and so are the slot, the indent and
the used alignment the painter reproduces. Positions, sizes and units differ in kind: Blink places items at LayoutUnit
offsets with caret positions from glyph clusters, WebKit places float32 display boxes over text ranges, Gecko places
frames in app units whose points come from per-character advances. The observation models need exactly those
(research/observe-blink.md §3, observe-webkit.md §4, observe-gecko.md §4), so `geometry` is per engine, in engine units.
Nothing in the output is shaped to what a Range can show; §9 derives that in the lab.

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
  | { kind: 'text'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  | { kind: 'tab'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  | { kind: 'forced-break'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number }
  | { kind: 'hyphen'; run: number; level: number; x: number; inlineSize: number }
  | { kind: 'inline-box'; element: number; x: number; inlineSize: number; hasStartEdge: boolean; hasEndEdge: boolean }
  | { kind: 'atomic'; element: number; level: number; x: number; inlineSize: number; marginStart: number; marginEnd: number }
  | { kind: 'br'; element: number; level: number; x: number; inlineSize: number }
type BlinkGlyphCluster = { textStart: number; textEnd: number; graphemeStarts: number[]; advance: number }   // advance in 16.16
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
type GeckoCharacter = { skipped: boolean; clusterStart: boolean; advance: number }
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

### 2.7 The state the next line starts from

`LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart`, defined in `src/engines/<engine>/types.ts`. Each holds
exactly what that engine carries from one line to the next. A start is the state after the previous line in the slot it
was laid out in, and it serves any slot for the next line: native layout carries the same state into a line beside other
floats (Blink hands the break token to the next opportunity, `inline_layout_algorithm.cc:1173`, :1471-1472; WebKit passes
`PreviousLine` with the carried width whatever the next line rect, `InlineFormattingContext.cpp:352-358`; Gecko continues
from the pushed frame).

- **Blink**: `{ engine: 'blink', itemIndex, textOffset, style, afterForcedBreak, isPastFirstFormattedLine }`, the break
  token (specs/blink-lines.md §4.1). `isPastFirstFormattedLine` is `InlineBreakToken::kIsPastFirstFormattedLine`, which
  decides text-indent (`line_breaker.cc:470-485`, `:4740`). No width carries over. The next line's start is reshaped
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
  New at 57.6px places `aa b` and overflows on `bbbbb`; the redo breaks before `b`, giving `aa` / `bbbbbb`. `nextLine`
  returns only the final pass.

### 2.8 Gaps and the measure log

A gap is `{ gap, run, detail }` for a §5 condition the paragraph meets. The prediction is still returned; a gap says
where it may be wrong.

- `layout.gaps` holds the conditions of the paragraph's content, fonts and environment: `engine-build`, null font facts,
  control characters, sizes Gecko can't match. `prepare` computes them, and `paragraphGaps` adds `engine-build`.
- `line.gaps` holds the conditions its breaks decide: an unsafe offset or an in-word prefix at the chosen edge, a
  shaping-call edge between joining letters. `belowFloats[k].gaps` holds what a refused slot rests on. `nextLine` never
  changes the prepared paragraph, so a prepared paragraph can serve lines in other slots without mixing their gaps
  (DESIGN-REVIEW.md §3.5).

`measure` is the call log (§4.6).

### 2.9 Line slots: an available width per line

Demos flow text beside obstacles and between columns, and give each line its own width (`pages/demos/dynamic-layout.ts:305-331`,
`editorial-engine.ts:446-471`). In a block, what gives line boxes different available widths is floats. A line slot is
what floats do to one line box: the CSS px they take off the content box on each side.

```ts
type LineSlot = { left: number; right: number }       // FULL_WIDTH = { left: 0, right: 0 }
function prepareParagraph(paragraph: Paragraph, env: Environment): PreparedParagraph
function firstLineStart(prepared: PreparedParagraph): LineStart | null
function layoutLine(prepared: PreparedParagraph, start: LineStart, slot: LineSlot): LineResult
function paragraphGaps(prepared: PreparedParagraph): Gap[]
function layoutParagraph(paragraph: Paragraph, env: Environment, slots?: readonly LineSlot[]): ParagraphLayout
class UnportedFeature extends Error { engine: EngineName; feature: string }
```

The insets are the margin-box widths of the floats beside the line, and each engine turns them into its own line offsets
with its own arithmetic, which is why a slot isn't a width: Blink truncates the content width and each float's edge to
LayoutUnits separately, so `trunc(W) − trunc(w)` can differ from `trunc(W − w)` by a unit. `layoutLine` returns the line
the engine places in the slot, or `below-floats` when a slot with an inset can't hold the line's first content and the
engine moves the line box down past the floats instead (CSS 2.1 §9.5). A slot without insets never gives `below-floats`.

Where each engine computes a line's available width with floats, and when it moves a line down:

| Engine | The line's band | What reads the float offset | The line moves below the floats |
|---|---|---|---|
| Blink | `InlineLayoutAlgorithm::Layout` takes every layout opportunity of the exclusion space up front (`AllLayoutOpportunities`, `inline_layout_algorithm.cc:1166-1170`) and makes each line's `LineLayoutOpportunity` from the current one (`ComputeLineLayoutOpportunity`, `:1222-1224`); the available width is `line_right_offset − line_left_offset` (`line_layout_opportunity.h`) | tab stops: `position_ + ComputeFloatOffset()` (`line_breaker.cc:674-693`, `:2970`); item positions | when `line_info.HasOverflow()`, the opportunity is narrower than the container (`IsEqualToAvailableFloatInlineSize` false) and the block wraps, the line is laid out again in the next opportunity (`:1336-1367`); also when the line box is taller than the opportunity (`:1462-1469`) |
| WebKit | `InlineFormattingContext::lineLayout` starts each line rect at the container's horizontal constraints (`InlineFormattingContext.cpp:315-322`); `LineBuilder::initialize` narrows it by the floats intersecting the line's initial height (`floatAvoidingRect`, `InlineLineBuilder.cpp:463-476`, `:1185-1216`; `floatConstraintsForLine`, `InlineFormattingUtils.cpp:185-195`; half-open intersection, `floatContainsLine`, `FloatingContext.cpp:352-359`), then applies text-indent as a start margin (`:454-478`). Candidate content taller than the line queries the floats again (`:1218-1239`) | tab stops: `m_lineContentEdgeOffset` (`:478`, `:1042`, `:1076`); box positions | a candidate whose minimum width doesn't fit while the line is constrained by a float wraps with nothing placed (`:1452-1457`), and the next line's top is the intrusive float's bottom (`logicalTopForNextLine`, `InlineFormattingUtils.cpp:54-103`) |
| Gecko | `nsBlockFrame::ReflowInlineFrames` takes the band at the line's block position (`GetFloatAvailableSpace`, `nsBlockFrame.cpp:5137`; `BlockReflowState.cpp:348-365`; `nsFloatManager::GetFlowArea`, `nsFloatManager.cpp:113-182`) and begins the line at its start and inline size, impacted by floats when the band has them (`nsBlockFrame.cpp:5252-5273`); `PlaceLine` queries again with the line's final block size and redoes the line when more floats narrow it (`RedoMoreFloats`, `:5441`, `:5881-5917`) | tab stops: the frame's distance from the block's content edge (`nsTextFrame.cpp:11063-11067`); frame positions | with floats in the band the line start is a soft break (`nsBlockFrame.cpp:5289-5299`), a first frame that doesn't fit breaks before instead of being placed (`nsLineLayout.cpp:785`), and a break before the first frame redoes the line in the next band (`RedoNextBand`, `nsBlockFrame.cpp:5549-5555`, :5172-5196) |

**The shared loop.** `layoutParagraph(paragraph, env, slots)` lays the k-th line box out in `slots[k]` and later ones at
the full width. A refused slot records `{ row, gaps }` in `belowFloats`, and the same start is laid out in the next slot.
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
`layoutParagraph(paragraph, env, lineSlots)`. The scorer adds one named observer assumption, **slot rows**: the native
line of engine line k has its rect centres inside the row the loop gave it, rows refused by `belowFloats` skipped. Mixed
fonts can make a line box taller than the line height (lab/VALIDATION.md problem 8), which moves every later row, and such
a case's metrics are unobserved rather than failed. The painter paints each line with floats of its slot (§7).

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
pipeline from `Paragraph` to lines. **The engine choice is one switch**, in `src/index.ts`, over `env.engine`. Where the
engines differ only in data, the shared module has one switch that picks the data:
`bidiDataFor(engine)` and `graphemeRulesFor(engine)`. Where their browsers run different algorithms, each algorithm is
its own shared module, and each engine imports the one its browser runs: `breaks/rbbi.ts` or `breaks/icu4x.ts`,
`unicode/ubidi.ts` or `unicode/unicode-bidi.ts`.

`src/engines/engine.ts`:

```ts
type EngineImplementation<Env, Prepared, Start, Geometry> = {
  prepare(paragraph: Paragraph, env: Env, measurer: Measurer): Prepared
  firstLine(prepared: Prepared): Start | null
  nextLine(prepared: Prepared, start: Start, slot: LineSlot, measurer: Measurer): LineResultOf<Start, Geometry>
  gaps(prepared: Prepared): Gap[]
}
class UnportedFeature extends Error   // an input the port doesn't implement yet: a prediction error, never a silent guess
```

Shared, working and tested (§8.2):

- `src/content.ts`: the document-order index of the inline tree, `styleUnder` and `langUnder`.
- `src/breaks/rbbi.ts`: the ICU rule-based break iterator over `.brk` data, with Apple's category overrides and a
  dictionary-segment flag. Blink and WebKit use it for line and grapheme tables.
- `src/breaks/icu4x.ts`: ICU4X's small code point trie and the rule iterator for Firefox's baked data. Gecko's line
  iterator adds LB9, word options, strictness and SA handling on top; that port belongs to the Gecko owner.
- `src/breaks/tables.ts`: loads each generated table once.
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
- `src/unicode/bidi.ts`: the Bidi_Class tables and bracket pairs per engine, `bidiDataFor(engine)`.
- `src/unicode/grapheme.ts`: extended grapheme clusters with Chrome's `char.brk`, libicucore's `char.brk` or Firefox's
  ICU4X data.
- `src/measure/`: contexts, font strings, the call log (§4).
- `src/paint.ts` (§7).

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

All three engines measure with a main-thread `OffscreenCanvas`:

- Blink: a connected `<canvas>` keeps the element's CSS letter and word spacing, feature settings and optical sizing in
  its font description (specs/blink-canvas.md §1.2), and a worker canvas uses the UI language.
- WebKit: a connected `<canvas>` copies the element's font description (specs/webkit-canvas.md §1.3). It would supply a
  locale, but it needs style updates, and the rest of the description leaks in.
- Gecko: a connected `<canvas>` quantizes `size / DPR`, measures on a 1/apd grid and sets opsz and `trak` at `size / DPR`
  (specs/gecko-canvas.md §1.10).

### 4.2 Context settings

A context is identified by its settings (`CanvasSettings` in `src/measure/canvas.ts`), and `measureContext()` creates
one OffscreenCanvas per distinct settings. Identity matters because Chrome caches shaped words per canvas.

| Setting | Blink | WebKit | Gecko |
|---|---|---|---|
| `font` | size `f32(size × layoutZoom)`, or the CSS size for fonts with `opticalSizeAxis` (§4.3) | size × `pageZoom` | size behind the quantization gate; Apple Color Emoji at size × DPR |
| `lang` | the run's locale, explicit | `''`: OffscreenCanvas has no locale | the run's language, explicit, so Gecko's `explicitLang` is true |
| `letterSpacing` | the run's px: Canvas truncates to 16.16 and turns off liga, clig and calt like the DOM (blink-text H27) | the run's px: the same `WidthIterator` rule | `'0.001px'` when the resolved spacing isn't 0 au (ligatures off, no spacing added), else `'0px'`; spacing added in JS |
| `wordSpacing` | `'0px'`; JS adds `trunc(ws × 65536)` per space except text_content index 0 (blink-text §2.E) | `'0px'`; JS adds the offsets of specs/webkit-lines.md §6.2 | `'0px'`; JS adds au after U+0020 and NBSP (gecko-text §12.2) |
| `textRendering` | `'optimizeLegibility'`: Canvas then shapes whole items exactly for fonts whose GPOS or GSUB lookups contain the space glyph (blink-canvas §1.3, H6) | `'auto'` (no such attribute) | `'auto'` (no width effect) |
| `direction` | the item's direction | `'ltr'`: DOM items measure LTR unless `unicode-bidi` overrides | the bidi run's direction |
| `partition` | `'8bit'` or `'16bit'` | `''` | `''` |

Blink's partition: a word cut from an 8-bit string is shaped as Latin, and the same word from a 16-bit string goes
through `RunSegmenter`. Both share Chrome's per-canvas cache key (word, direction), so whichever is measured first wins
(specs/blink-canvas.md §1.7). Separate canvases keep each storage class's own result. Setting word spacing in JS avoids
the other order effect, where a cached `" "` keeps its first offset-0 decision.

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
  25px, so the DOM width is 12.5px.

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

Box edges, indents and slot insets are declared lengths, so they need no recipe: each engine converts them with its
style system's arithmetic, and no Canvas call reads them.

### 4.5 When measurement happens

Engines measure when the engine does, because Chrome's cache makes order visible and because measuring what the engine
never measures wastes calls. Engine-true output adds one kind of measurement: the advances inside placed content.

| | before filling (`prepare`) | while filling (`nextLine`) | for the geometry of a placed line |
|---|---|---|---|
| Blink | every shaping group's words | [start, first safe) at a wrapped line start; [last safe, break) at a line end that isn't at a space, or at any line end where `NeedsAccurateEndPosition` holds; tab widths at their position; the hyphen, once per result | prefix widths at the cluster boundaries of the line's text and tab items |
| WebKit | stored widths of word pieces and single spaces | `breakWord` prefixes from the item start (a bisection over O(log n) prefixes); widths deferred by bidi splits; preserved white space containing TAB; the hyphen string | nothing: boxes are sums of item widths |
| Gecko | every shaping unit's advance; the space | tab stops from the containing block's space width; the hyphen run | per-character advances inside the line's frames, `W(unit) − W(suffix)` at cluster starts |

The third column is what the charter's tentpole 8 asks to record: its calls are in the log and cost a Canvas call per
cluster boundary of placed text in Blink and Gecko.

### 4.6 Call log and memo

`MeasureLog = { contexts, calls, memoHits }`: every context's settings, every `measureText` call (context, text,
width) in order, and how many lookups the memo answered. The lab records `calls.length` as `measureLog`, and the full
log from stage 0 of §8.3, so a row can be laid out again offline.

The memo is an acceleration structure for one prepared paragraph. Key: (context index, text); value: the width.
Measuring the same text in the same context again returns the same bits in all three engines (Blink returns its cached
node for the whole string; WebKit and Gecko shape the same way), so the memo can't change a result. It lives as long as
the `Measurer`, which `prepareParagraph()` creates per paragraph and every `layoutLine` from it shares.

## 5. Gaps

"Handled" means the recipe gives the DOM's value. A named gap is reported in `layout.gaps` or `line.gaps` (§2.8) under
the stated condition. A given fact never reports a gap; its null default does.

| Gap | Engines | What differs | Handling | Predictions can be wrong when |
|---|---|---|---|---|
| CR, FF, VT and other controls (`control-character-width`) | all | Every Canvas turns U+0009-U+000D into spaces; Gecko's also turns U+001C-U+001F, U+0085 and U+2029 into spaces (CRITIC.md C12). DOM: Blink collapses CR as a space in collapse modes and keeps FF and VT as characters of unknown width; in preserve modes CR and FF are zero-width control items that end a shaping group (blink-text §2.C.9, H5, H6). WebKit keeps U+000D's glyph advance on the simple path and 0 on the complex path; FF, VT and other Cc take the `.notdef` advance (webkit-text §5.3). Gecko: CR, FF, VT and hidden C0/C1 controls are zero width. | Never pass them to Canvas. Blink: CR in collapse modes is a space in text_content; CR and FF in preserve modes measure 0 and split the group. WebKit: measure FF, VT and other Cc as U+0001 in the same string, which also takes `.notdef` (webkit-canvas H10). Gecko: strip them. | Blink: FF, VT or other C0 in `normal`, `nowrap` or `pre-line`, or VT in any mode. WebKit: CR on the simple path; a control whose `.notdef` comes from another font. |
| Soft hyphen shaping (`soft-hyphen-shaping`) | Blink | Blink's Canvas turns SHY into ZWSP, which splits a 16-bit Canvas word; the DOM shapes SHY inside the item as a hidden glyph. WebKit's Canvas and DOM both keep SHY during shaping. Gecko's DOM discards SHY before shaping. | Blink: measure the word without the SHY. WebKit: keep it. Gecko: strip it. | Blink: a kerning or ligature pair across a soft hyphen. |
| Hyphen glyph (`hyphen-glyph`) | Blink, WebKit | The hyphen is U+2010 if the primary font maps it, else `-`. Canvas can't show whether the primary font maps U+2010, because fallback supplies it. | Fact `mapsHyphen` (§1.2). Gecko's Canvas substitutes as its DOM does. | `mapsHyphen` null and `W('‐') ≠ W('-')` in the run's context at a chosen soft hyphen. |
| Letter spacing and ligatures (`letter-spacing-ligatures`) | WebKit | The DOM turns off liga, clig, dlig and hlig when letter spacing isn't 0; OffscreenCanvas keeps them (webkit-canvas §1.3, H3). Blink's Canvas and DOM agree (H27). Gecko's DOM decides on the rounded au value, Canvas on the float. | Blink: `ctx.letterSpacing`. Gecko: `'0.001px'` plus JS spacing. WebKit: none. | WebKit: letter spacing with a font that forms those ligatures in the text. |
| Canvas language (`canvas-language`) | WebKit | Blink's OffscreenCanvas resolves `<html lang>` when the font string is set and keeps it until the string changes (blink-canvas H13); Gecko's resolves per call; WebKit's has no locale. The DOM uses the element's language for generic families, CJK fallback and `locl`. | Blink and Gecko: an explicit `ctx.lang` per context. WebKit: none. | WebKit: a box with a locale whose fonts depend on it: generic families resolved per script, `system-ui` and `ui-*`, Han, kana or Hangul fallback (§1.3). |
| Optical size (`optical-size`) | Blink at zoom ≠ 1, Gecko | Blink's DOM shapes at the zoomed Core Text size with opsz and ptem at the CSS size (blink-canvas §1.8). Gecko's OffscreenCanvas never sets auto optical sizing (gecko-canvas §1.2 C1a). WebKit shares the DOM path. | Fact `opticalSizeAxis` (§1.2): Blink measures at the CSS size and scales. | Blink: `opticalSizeAxis` null at layout zoom ≠ 1. Gecko: `opticalSizeAxis` true or null. |
| Gecko size quantization (`font-size-quantization`) | Gecko | Canvas keeps 7 significant bits; the DOM uses Servo's 10-bit size on a 1/60 px grid. | The gate in §4.3. | Sizes such as 13.33px, 16.8px or odd eighths. |
| Bitmap emoji (`bitmap-emoji-size`) | Blink, Gecko at DPR ≠ 1 | The DOM asks Core Text for the sbix advance at the device size. | Measure at size × DPR and divide. | Gecko: fractional apd (one device pixel off at apd 27, probe cross-cutting 1). Blink: until H17 is verified. |
| Chrome's per-canvas shape cache | Blink | The first shaping of a word per canvas wins: script context, word spacing at offset 0 (blink-canvas §1.7). | Handled: partitions, JS word spacing, a fresh measurer per prepared paragraph. | — |
| Unsafe-to-break offsets (`unsafe-to-break`) | Blink | Line-start and line-end reshapes happen at HarfBuzz's unsafe-to-break offsets, which Canvas doesn't expose (CRITIC.md §5 item 6). | An offset is safe when the pair total shows no adjustment, the grapheme boundary holds and nothing joins: necessary, not sufficient (blink audit B7). | At a chosen line edge where the test can't vouch for the offset: kerning, ligatures or contextual forms across it. |
| Joining technology (`joining-technology`) | Blink | Letters joined across a shaping call's edge keep joined forms in OpenType fonts, which read the call's context, and lose them in `morx` fonts (hb-ot-shape.cc:60-66, 100-101). | Fact `joining` (§1.2). | `joining` null at a group edge or chosen line edge between joining letters (Geeza Pro is AAT; Amiri and Noto Naskh Arabic are OpenType). |
| Script context (`script-context`) | Blink | The DOM shapes an 8-bit paragraph as one Latin segment and merges Common punctuation into the surrounding script in 16-bit paragraphs; Canvas segments each word alone (blink-canvas §1.4). | Measure a Common-only word in the context whose storage class matches the paragraph. | Common-only words in fonts whose Latin and DFLT lookups differ (Amiri, Noto Naskh Arabic). |
| Spaces in shaping (`space-in-shaping`) | Blink, Gecko | The DOM kerns across spaces when the font's lookups involve the space glyph. Blink's word-by-word check ignores legacy `kern`, `kerx` and `morx`; Gecko shapes whole ranges when `SpaceMayParticipateInShaping` (gecko-text §7.2). | Blink: `optimizeLegibility` contexts. Gecko: measure the whole range when `au(a + ' ' + b) ≠ au(a) + au(' ') + au(b)`, a hypothesis to probe. | Blink: cross-space legacy kerning. Gecko: until the detection is verified. |
| In-word prefixes (`in-word-prefix`) | all | Gecko's DOM uses per-glyph advances from one shaping of the unit, with integer shares of ligatures; Blink uses `ceil64` of prefix positions; WebKit's selection shapes a box once (`ComplexTextController`). Canvas measures a prefix alone. | Gecko: `W(unit) − W(suffix)` where the suffix doesn't depend on what precedes it (gecko-lines §9). Blink: prefix sums and pair adjustments at cluster boundaries. | Breaks inside words (overflow-wrap, break-all, CJK, soft hyphens) in fonts with kerning, ligatures or contextual forms; and code point edges inside an item, box or frame in §9. |
| Glyph clusters (`glyph-clusters`) | all | Which code points one glyph covers: a font's ligatures merge HarfBuzz clusters, Core Text can give a code point no glyph of its own. Canvas shows totals only. | Clusters from Unicode data (marks, joiners, modifiers, regional indicators). | Ligatures across graphemes; zero-advance code points without their own glyph, in §9's code point rects. |
| WebKit measuring paths (`simplified-measuring`, `fixed-pitch-path`) | WebKit | The DOM's simplified path doesn't restore space advances and sums in another float32 order; the fixed-pitch path returns `length × spaceWidth` for eligible fonts. | The full-path recipe; fact `monospace` for the fixed-pitch path (§1.2). | `simplified-measuring`: a simplified-path box outside the width shortcut. `fixed-pitch-path`: `monospace` null and an item of such a box fails T1. |
| RTL shaping across inline boxes (`rtl-shaping-across-inline-boxes`) | WebKit | `LineBuilder` reshapes complex RTL text joined across decoration-free boxes as one run (webkit-lines §9.3). | none | RTL complex-script text split over same-font spans without box edges. |
| Page zoom (`page-zoom`) | WebKit | No page API shows Safari's page zoom. | `env.pageZoom`, given. | `pageZoom` null. |
| Font fallback (`font-fallback`) | all | Which font draws a cluster; hexbox and `.notdef` widths; Gecko's synthesized widths for Unicode spaces no font covers, rounded to device pixels. | Canvas totals include fallback. | Text no listed family covers, where Canvas and DOM fall back differently (Blink falls back per cluster over the whole item; Gecko's fallback can arrive later). |
| Float32 precision (`float32-precision`) | Blink | 16.16 values are exact in float32 only below 256 px. | Measure per Canvas word. | One Canvas item of 256 zoomed px or more. |
| String storage (`string-storage`) | all | Blink's single Latin segment, WebKit's keep-all punctuation breaks and 1-unit emergency breaks, and Gecko's white-space-only frames depend on whether a text node is stored 8-bit (CRITIC.md §5 item 14). The page can't see storage. | Treat text whose code units are all ≤ U+00FF as 8-bit, what JS-created nodes get. | Parser-created or edited nodes stored 16-bit. |
| Dictionary breaks (`dictionary-breaks-unavailable`, `dictionary-breaks-stand-in`) | all | Thai, Lao, Khmer and Myanmar need dictionary or LSTM data (§6.3). | The running browser's own segmenter. | `unavailable`: SA runs get no interior opportunities. WebKit stand-in: a dictionary range that starts with a combining mark (27 of 282,337 positions). |
| HanKerning (`han-kerning`) | Blink | Blink trims fullwidth punctuation with `halt` using characters outside the shaped range and at line ends (han_kerning.cc, shaping_line_breaker.cc:344-378). | The trims from Canvas facts (blink audit B6). | Fonts whose `halt` detection isn't probed; neighbours on another line. |
| Tab stops (`tab-stops`) | Blink | Blink counts stops from the platform space advance without `trak` (simple_font_data.cc:225-240). | Canvas space advance. | Fonts with `trak` tracking, such as Helvetica Neue (probe blink-followups F4). |
| UI language (`ui-language`) | all | §1.4 | The engine's given process languages. | The fact is null and content has no `lang`, `lang=""`, a Han `lang` (WebKit), or a locale ICU has no data for (WebKit quotes). |
| Page history (`page-history`) | all | Layout state earlier content leaves in the document or process: WebKit's `TextBreakingPositionCache`, Gecko's document-wide bidi flag and pinned emoji fallback, Blink's platform font created at another size (TEST-ARCHITECTURE.md §6.5). | none: the library predicts a fresh document | A paragraph with the conditions of those effects. |
| Engine build (`engine-build`) | all | The ports follow one build each. | `env.build`, given. | `build` null or not `PINNED_BUILDS[engine]`. |

Inline structure adds no gap: box edges, atomic sizes, indents and slot insets are lengths the engine converts exactly,
and what Canvas can't show about the text around them falls under the names above. A span with box edges ends Blink's
shaping groups and Gecko's text runs at its edges, so `unsafe-to-break`, `joining-technology` and `in-word-prefix`
report at such an edge the way they do at a group edge.

## 6. Break data

### 6.1 Generated modules

Generators read pinned engine data, check every input's sha256 against a recorded value, and write one module each:

| Command | Source | Module | Size |
|---|---|---|---|
| `bun rebuild/tools/gen-blink-data.ts` | `data/blink`, checked against `manifest.json`: `line`, `line_normal`, `line_normal_cj`, `line_loose`, `line_loose_cj` and `char` from Chrome 153's `icudtl.dat`, and the generated `kFastLineBreakTable` | `src/breaks/generated/blink-break-tables.ts` | 531 KB |
| `bun rebuild/tools/gen-webkit-data.ts` | `data/webkit`, checked against `FILES.tsv`: the six line tables and `char` libicucore loads, and `BreakablePositions.cpp`'s pair table | `src/breaks/generated/webkit-break-tables.ts` | 629 KB |
| `bun rebuild/tools/gen-gecko-data.ts` | `firefox-156.0/intl/icu_segmenter_data/data`, checked against `data/gecko/segmenter-data-sha256.json`: line and grapheme rule data | `src/breaks/generated/gecko-break-data.ts` | 41 KB |
| `bun rebuild/tools/gen-unicode-data.ts` | ICU 78.2 `ppucd.txt` (Chromium ICU pin, sha256 recorded in `tools/ppucd.ts`), libicucore's private-use classes (recorded in the generator, checked by `bidi.test.ts`) and `unicode-bidi` 0.3.15's `tables.rs` | `src/unicode/generated/bidi-data.ts` | 14 KB |

Tables are base64 in the module, decoded and parsed once per table on first use (`src/breaks/tables.ts`). Not shipped:
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

`paintLines(paragraph, layout, document)` in `src/paint.ts` returns one `div` per line with a line box, in form A-wrap
(specs/painter.md §1, §6). It reads the shared fields only: `fragments`, `hasLineBox`, `joinsNextLine`, `slot`,
`indented`, `align`, and `layout.engine` for the hyphen span.

- **The line block** has the paragraph's content width, font, spacing, `lang`, `direction`, `white-space`, `word-break`,
  `overflow-wrap`, `line-break`, `tab-size`, `text-align` and fixed line height, the fixed styles of §1.1, the
  text-indent where the engine indented the line, and, when the paragraph isn't start-aligned, `text-align-last` set to
  the line's used alignment, since the painted line is its block's last line. Where the slot has insets, the block starts
  with a `float: left` and a `float: right` block of those widths and one line height, so the engine computes the
  painted line's band with the paragraph's arithmetic. The browser then runs its own line-end rules on the painted line
  as it did in the paragraph. Blink trims CJK punctuation at a line end in `ShapeLine`, which only runs while wrapping
  (`あいうえお。` is 88px natively and 96px under `pre`), and Gecko counts only the non-overflowing part of hanging
  `pre-wrap` spaces (painter.md §3.1 e, §3.3 f). A line wider than predicted wraps, and the lab sees the painted line on
  two lines. Tab stops count from the line start in both. A line that ends with a hyphen fragment, or starts with the
  U+200D of R7, gets `text-wrap-mode: nowrap`. The paragraph offered no break before the hyphen or after the joiner, but
  painted they begin a new item and a new grapheme cluster, and an overflowing line, as every line is at the narrowest
  widths, broke there again: Blink and WebKit at the chosen soft hyphen left in the slice
  (`InlineFormattingUtils.cpp:385-437`), Gecko after the joiner under `overflow-wrap`. A line that ends at a hyphen has
  no line-end punctuation or hanging white space for the wrapping rules to act on.
- **Elements and slices.** The painter paints the line's pieces in logical order inside the elements that hold them,
  and between two consecutive pieces it replays the paragraph's element structure from the content index: spans that
  close are closed, spans that open are opened, and a span that opens and closes between them is painted empty. A span
  gets its styles (font, spacing and `lang` always, the wrapping properties where they differ from its parent's, and
  `vertical-align: 0px`), its start edge on the line holding its `box-start` fragment and its end edge on the line holding
  its `box-end`. A span with a nonzero edge on a line where none of its content is painted is painted for that edge
  alone; a span without edges is painted only around painted content or between painted pieces. The painted pieces of
  one leaf on a line become one text node, split only where the level changes. Slices of different leaves are never
  merged, since WebKit never measures across a text box and Blink rounds up each item's width. Two rules keep the
  paragraph's layout objects. A span with no painted text on the line between two painted pieces is painted empty: a
  text node of only white space is laid out after an inline box and dropped after white space (the Blink port's
  `layoutTextNeeded`, text.cc:319-364), and `c-0ca55250962649aa` lost a form feed's 5.33px when its empty span wasn't
  painted. A bare slice of U+0020 and U+0009..U+000D that starts a line in `normal` or `nowrap` goes in a span, because
  as a block's first child it gets no layout object, where the paragraph's node had text on another line (a VT alone on
  a line, `c-18cb262b839dc1d5`). That white-space set is Blink's for every engine today; §1.3 lists the per-engine sets.
- **Atomic inlines** are painted as empty inline-blocks of their border box and margins, `vertical-align: top`, at their
  level, for the app to fill. `<br>` and `<wbr>` aren't painted.
- **White space.** `text` and `hanging` fragments are painted as laid out, Blink's CR and FF in preserve modes
  included, so the painted line splits its shaping group there as the paragraph did. A `trimmed` fragment stays in its
  slice, so the browser trims it again and shapes the text before it the same way. Blink keeps Arial's A+space
  adjustment on the last `A` of `AAAA `, because a line ending at a space isn't reshaped: 2676 raw units at 60px, where a
  painted `AAAA` measures 2732. WebKit measures a word together with its following space (painter.md §3.1 c, §3.2 a).
  `collapsed` and `forced-break` fragments aren't painted.
- **The hyphen** is its own span with the letter spacing the engine gives it, styled in the painter's one engine switch:
  `vertical-align: 0px` in Blink, which ends the shaping group, so `‐` doesn't kern with the `r` of `super`;
  `unicode-bidi: isolate` in Gecko, which ends the text run; nothing in WebKit, whose layout measures the hyphen alone
  while paint shapes it with the word (painter.md R6).
- **Joining at a line edge.** Where `joinsNextLine` is true, U+200D goes after line n's text and before the next painted
  line's, so joining scripts keep their joined forms (R7; painter.md probe 5 hasn't run). Engines set it only where their
  shaping joined letters across the break, so the painter needs no engine switch for it. In Firefox the joiner doesn't
  bring the paragraph's widths back in the lab rows (below).
- **Bidi.** A line with a piece at a level other than the base level gets `unicode-bidi: bidi-override` on the line
  block, and inside each piece's innermost element one nested `bidi-override` span per level step, alternating direction.
  Override spans never enclose elements, and a plain span doesn't change the embedding, so every code unit sits inside
  exactly as many overrides as its level is above the base, and the browser reorders the line with the paragraph's levels
  (R8, painter.md §4.4). Painted alone, `שלום (עולם` would resolve the unpaired `(` by N1 and reverse the whole line; with
  levels `1 1 1 1 0 0 1 1 1 1` it draws `שלום` at the left, as the paragraph does (painter.md §4.3, probe 7). Lines whose
  pieces all sit at the base level get no override. The base level is `paragraph.direction` while the model has no
  `unicode-bidi: plaintext`; that planned field adds a base level per line. Text never sits directly in an override
  element; a plain span goes between. WebKit measures a text box with its parent's `unicode-bidi` and `direction`
  (`TextUtil.cpp:89-90`), so an RTL box right under an override is measured as an RTL override run where the paragraph
  measures an LTR run without override, and its float32 width moves by a step (66 of 154 WebKit bidi lines in the lab
  passed once the span was added). The line's trailing white space is painted at the level of the text before it in the
  same leaf; box edges, `<br>` and `<wbr>` don't end the trailing white space. A painted line is a bidi paragraph of its
  own, and white space at a paragraph's end takes the base level in all three browsers (UAX #9 L1: ICU's `ubidi_setPara`
  in Blink and WebKit, unicode-bidi's `visual_runs` over the whole paragraph in Gecko,
  `intl/bidi/rust/unicode-bidi-ffi/src/lib.rs:54`), so the painted level only decides node division, and one text node
  keeps WebKit's measurement of a word with the space after it (`TextUtil.cpp:76-77`).
- Nothing sets a text width, so the painted geometry is an independent check of the predicted geometry. The painter
  throws for negative slot insets, which floats can't paint.

What painting a line alone still changes (specs/painter.md §7):

- Gecko: at a break inside a word, kerning across the edge, integer ligature shares and contextual forms (L1); fonts
  whose default lookups involve the space glyph, at line edges (L4).
- Blink and Gecko: contextual lookups other than joining across a mid-word edge (L2), and the script that Common
  characters inherit at a line start (L7).
- Blink: override spans insert bidi control items, which end shaping groups at same-parity level changes (0 to 2) that
  the paragraph shaped together (L9).
- WebKit: when the font kerns a letter with the hyphen, the painted line matches the layout width or the ink, not both
  (L3); RTL shaping across inline boxes on candidates cut by a line edge (L5).
- All engines, alignment: a painted line is its block's last line, so a wrapped line's `pre-wrap` spaces hang
  conditionally when painted where the paragraph hung them unconditionally (WebKit `horizontalAlignmentOffset`,
  `InlineFormattingUtils.cpp:198-217`; Blink `ComputeTrailingSpaceWidth`, `line_info.cc:289-400`), which moves `center`,
  `end` and `justify` lines by the hanging width.
- Gecko: every continuation of a span reserves the span's end border and padding (`nsInlineFrame.cpp:514-521`); a painted
  line without the span's end edge reserves nothing, which can only keep more on an overflowing painted line.

The lab names more (specs/PAINTER-RESULTS.md has the counts):

- All engines: a soft hyphen inside an emoji sequence or ligated cluster. The paragraph gives the cluster to the line
  before the break, and painted alone the rest draws as a glyph of its own.
- Gecko: the U+200D of R7 doesn't reproduce the paragraph's joined widths. A join control at the start of a text run has
  no previous font to match (`gfxTextRun.cpp:3276-3334`), and with joiners on both sides `ب` still takes its isolated
  advance at the lab's narrow widths (`c-18f83148f2a14065`, `c-1f5bdb4aa7cd37d2`: 12.35px painted, 13.07px natively).
  Cursive attachment and kerning with the letter on the other line are lost as well (L1).
- Gecko: letter spacing after the last character of a text run is always added (`CanAddSpacingAfter`,
  `nsTextFrame.cpp:3860-3873`), and a painted line ends its text run. A line that ends with a format character, a tab,
  or a base letter whose marks sit on the next line gets spacing the paragraph didn't give it (`c-2ccbff7837117855`,
  1px narrower at `letter-spacing: -1px`; `c-a1cc790386f04a1a`).
- Gecko: trailing white space above the base level. At a soft wrap the paragraph keeps its level, and the painted line,
  a paragraph of its own, moves it to the base level at the line end (`c-01cfe05b2ffd874b`).
- Blink: `HanKerning` trims fullwidth punctuation by its neighbour. Where the neighbour is on the next line, the painted
  mark keeps its full width (`。` is 8px natively and 16px painted, `c-b408d44e962b357e`), and a line that fit wraps
  (`c-342b6a8c28ff1dab`).
- Blink: a line that ends at a space isn't reshaped (`dont_reshape_end_if_at_space`, `line_breaker.cc:255-268`), so the
  space keeps its kerning with the next line's first glyph (Arial space and `Y`, `c-0fe656a162eb2508`, 37 units).
- Blink: some bidi lines painted with override spans are one LayoutUnit wider, at opposite-parity level changes too
  (`c-05bbcacc0fe2f0e5`). Not traced beyond L9.
- Blink: Common characters at a line start also lose the cursive script's letter-spacing exemption (L7): `<` after
  Arabic takes `letter-spacing` painted alone (`c-7715aaeaa4fa426b`, 1.5px).
- WebKit: some RTL lines under overrides still differ from the paragraph by a float32 step: 88 of the 154 bidi lines
  of the plain-span probe, and two suite lines (`c-354eed076f010028`, `c-6704d9a31cfdc2f0`) that matched while their
  trailing space was a node of its own at the base level and don't once it shares the Arabic slice's node.
- WebKit: the rest of an item split by the overflow breaker keeps `f32(W − prefix width)` without being measured again
  (§2.7). Painted alone it's measured fresh: a float32 step in Latin (`c-c62182c46f2a130d`, 71.16799926757812px against
  71.16796875px), other forms in joined Arabic (`c-16de89e4db9184ec`, 11.42px against 3.91px).
- WebKit: a word whose following space starts the next line is measured with that space in the paragraph
  (`TextUtil.cpp:76-77`) and without it painted (Times New Roman `A`, 10.67px natively, 11.55px painted,
  `c-0145610398f11164`).

The lab appends the elements to a host of the paragraph's width (lab/README.md, "Page protocol" step 5). Under the
observation contract (§9) the painter metric compares each painted line's code point and node rects with the expected
rects of that line: the painted block has the paragraph's width, direction and the line's floats, so an LTR line's items
still start at the band's start and an RTL line's still end at its end. When the prediction metrics pass and the painter
fails, the painting form is wrong, not the prediction, and the rows above name why. Positioning line blocks absolutely
(form C) gives the same shaping and stays the fallback if a case class needs it.

`lab/predictor.ts` calls `layoutParagraph()` in `predict()`, and `paint()` paints the layout `predict()` returned.

## 8. Modules, tests and order

### 8.1 Layout and owners

```
rebuild/
  CHARTER.md DESIGN.md
  tsconfig.json                   bunx tsc --noEmit -p rebuild/tsconfig.json
  specs/ research/ data/ probes/  other owners
  lab/                            lab owner; types.ts re-exports and predictor.ts are wired by the architect
    observe/                      the observation ports of §9, one per engine
  tools/
    gen-shared.ts lines.ts ppucd.ts          generator helpers                         architect
    gen-unicode-data.ts                      → src/unicode/generated/bidi-data.ts       architect
    icu-bidi-oracle.c icu-bidi-oracle.ts     ICU's own ubidi, for the bidi tests        architect
    gen-blink-data.ts                        → src/breaks/generated/blink-break-tables.ts   Blink owner
    gen-webkit-data.ts                       → src/breaks/generated/webkit-break-tables.ts  WebKit owner
    gen-gecko-data.ts                        → src/breaks/generated/gecko-break-data.ts     Gecko owner
  src/
    index.ts        prepareParagraph, layoutLine, layoutParagraph: the one switch over engines, the engine-build gap   architect
    model.ts        input tree, font facts, line slots, output with per-engine geometry, the observation contract     architect
    env.ts          Environment, process languages, GivenFacts, PINNED_BUILDS, detectEngine(), detectEnvironment()   architect
    content.ts      indexContent, styleUnder, langUnder, and its test                                               architect
    paint.ts        paintLines()                                                                                      architect
    measure/        canvas.ts (contexts, memo), font.ts (font strings), log.ts                                       architect
    unicode/        bidi.ts, ubidi.ts, unicode-bidi.ts, grapheme.ts, tests, generated/                                architect
    breaks/         rbbi.ts, icu4x.ts, tables.ts, rbbi.test.ts, generated/                                            architect
    engines/
      engine.ts     EngineImplementation<Env, Prepared, Start, Geometry>, UnportedFeature                             architect
      blink/        index.ts, types.ts; the port's files and tests                                                   Blink owner
      webkit/       index.ts, types.ts                                                                                WebKit owner
      gecko/        index.ts, types.ts                                                                                Gecko owner
```

An engine owner edits only their engine directory, their generator and its generated module. A change a port needs in
a shared file (a model field, a new gap name, a shared helper fix) goes in the owner's report, and the architect makes
it. `rebuild/lab/observe/` may import types from `src/model.ts` only, never engine logic, so no expected observation
comes from the library (TEST-ARCHITECTURE.md §0 rule 1). The ports walk the tree themselves; they don't import
`src/content.ts`.

### 8.2 Tests

`bun test rebuild/src` ran 170 tests in 14 files before stage 5. `src/content.test.ts` checks the document-order index:
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

Until stage 5 lands, the engine test files that build paragraphs from `runs` or call `nextLine` with a width fail to
typecheck, and the ones that run them fail.

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

Lines are tested in the installed browsers with the lab, one browser at a time under the shared lock (lab/README.md):
smoke cases first, then the suite sample. TEST-ARCHITECTURE.md lays out the test layers the rebuild grows into: parity
with engine libraries, browser facts per build, offline replay, rule-targeted families at thresholds taken from
observations, sealed held-out sets, and the gate.

### 8.3 Migration order

Each stage ends with `bun test rebuild/src` green and the lab runnable in each browser, and the gate either green or
its losses attributed in a seed diff.

0. **Recording** (lab owner; library output unchanged).
   - Rows keep the full Canvas call log: context settings, text and width for every call.
   - `run.json` and every row record the app bundle build and the browser process's languages as the driver launched
     the browser with them or read them (`lab/types.ts` `ProcessLanguages`, in progress on 2026-09-17): Chrome's
     application locale, Safari's preferred languages and the WebContent ICU default locale, Firefox's regional-prefs
     locale. The page passes them to `predict`, and `lab/predictor.ts` puts them in `GivenFacts`.
   - `measure/canvas.ts` gains a recorded source, `{ kind: 'canvas' } | { kind: 'recorded'; log }` (architect), so
     `layoutParagraph` replays a row in bun, and a replay asking for a string the log lacks says it needs a browser run.
   - Exit: G0 unchanged; a replay test reproduces a recorded smoke row's lines per engine.
1. **Engine-true output and explicit inputs** (landed 2026-09-17, 7c3fcf9).
   - Engines implement `EngineImplementation`, read their own environment fields, and replace name keys and the joining
     constant with font facts; lines carry per-engine geometry and gaps; lines without line boxes are returned.
2. **Observation ports** (landed with 1). `lab/observe/{blink,webkit,gecko}.ts` implement `ObservationPort`; scorer v2
   compares rects exactly; v2 baselines are seeded per build.
3. **Font fact table and the probes behind the defaults** (table landed; probes open).
   - Probes for the defaults and recipes: T1 (WebKit fixed pitch), `W('‐')` against `W('-')` (Blink, WebKit), opsz at
     the CSS size across sizes (Blink), the in-word recipe per shaping technology (Gecko, gecko audit D1), painter probe
     5 per engine.
   - Rule families for each fact, with cases on both sides of it (TEST-ARCHITECTURE §2).
4. **Retire G0** once every G0 pair is in a v2 baseline or attributed (TEST-ARCHITECTURE §8 step 10).
5. **Inline structure, line slots and alignment** (architect: this change; each owner: their part; landed together, gated
   against the v2 seeds, where flat paragraphs lose 0 pairs).
   - Architect, done: `model.ts` (the inline tree, `LineSlot`, `LineResultOf`, `BelowFloats`, the new fragment kinds, the
     geometry fields, `ExpectedObservation.elements`); `env.ts` (process languages as shared types); `content.ts` with its
     test; `engines/engine.ts` (`nextLine` takes a slot and returns a result; `UnportedFeature`); `index.ts`
     (`prepareParagraph`, `firstLineStart`, `layoutLine`, `paragraphGaps`, `layoutParagraph` with slots); `paint.ts` over
     the tree; `lab/types.ts` (the flat case types stay the lab's, the tree types are re-exported); `lab/predictor.ts`
     (flat cases become trees).
   - Every engine owner:
     1. `prepare` walks `indexContent(paragraph)`: leaves are the old runs, and `run` is the leaf index. A leaf's style is
        `styleUnder(paragraph, index, leaf.parent)` and its language `langUnder(...)`; nothing reads the block's style
        where the source reads an item's.
     2. `nextLine(prepared, start, slot, measurer)` returns `LineResultOf`, converts the slot's insets with the engine's
        own float arithmetic (§2.9), and sets `slot`, `indented` and `align` on every line. Every span gets `box-start`
        and `box-end` fragments, and atomic inlines, `<br>` and `<wbr>` theirs.
     3. `contentLanguage` and the process languages are the root locale where the source reads it (research/CHARTER-CRITIC.md
        items 10 and 11).
     4. An input the port doesn't implement yet throws `UnportedFeature`; nothing lays it out silently.
   - Blink owner:
     - wrap properties on `BlinkStyle` per span, `styles[item.style]` at the 12 block-style sites (blink audit F1), and the
       nowrap-to-wrap rules (`line_breaker.cc:3996-4005`; `inline_items_builder.cc:851-866`);
     - open and close tag items with `ComputeOpenTagResult` and `ComputeInlineEndSize` (`line_breaker.cc:3937-4025`),
       shaping group edges from `ShouldBreakShapingBeforeBox` and `AfterBox` (`inline_node.cc:494-527`), `inline-box`
       items for spans that create box fragments (F2);
     - atomic items with U+FFFC (`inline_items_builder.cc:1269-1283`), `HandleAtomicInline` and `MayBeAtomicInline`
       (`line_breaker.cc:1269-1300`, `:3043-3110`), `<br>` forced breaks (`inline_items_builder.cc:1163-1198`), `<wbr>`
       flow control (`:597-607`, `:1211-1218`) (F8);
     - the `LineLayoutOpportunity` from the slot, `ComputeFloatOffset` for tabs (`line_breaker.cc:674-693`, `:2970`),
       below-floats by `inline_layout_algorithm.cc:1336-1367`;
     - `isPastFirstFormattedLine` in the break token and the indented start position (`line_breaker.cc:45-56`,
       `:846-879`) (F3);
     - `needsAccurateEndPosition` from `text-align` at the reshape sites (`line_info.cc:127-175`; `line_breaker.cc:255-268`,
       `:1658`, `:2387`), `ApplyTextAlign` and justification (`inline_layout_algorithm.cc:943-970`,
       `justification_utils.cc:314`) (F4), slicing reshaped pieces instead of measuring them again (F6);
     - geometry: `lineLeft`, `lineRight`, `textIndent`, `needsAccurateEndPosition`, `alignOffset`, the new items.
   - WebKit owner:
     - a computed style record per box, each of the 50 block-style reads choosing the root, item, parent or nearest
       common ancestor as the source does (webkit audit F1), and a box tree with `createLineSpanningInlineBoxes` and
       `nearestCommonAncestor` (F2);
     - inline box start and end widths, decorated boxes as content, builder eligibility over the style record
       (`InlineFormattingUtils.cpp:300-333`; `TextOnlySimpleLineBuilder.cpp:488-528`; `RangeBasedLineBuilder.cpp:131-184`)
       (F3, F5);
     - atomic, hard line break and word break opportunity items (`InlineItemsBuilder.cpp:91, 596-616, 1073-1076`;
       `InlineFormattingUtils.cpp:446-450, 456-544`) (F9);
     - the line rect from the slot through `floatAvoidingRect`, `m_lineContentEdgeOffset` for tabs, text-indent as a start
       margin (`InlineLineBuilder.cpp:432-478, 1185-1239`; `InlineFormattingUtils.cpp:143-176`) (F6), below-floats by
       `InlineLineBuilder.cpp:1452-1457`;
     - `alignmentOffset` and justification expansion from the closed run list (`InlineFormattingUtils.cpp:198-260`;
       `InlineContentAligner.cpp:230-302`) (F4, F10); geometry: `lineLeft`, `contentEdgeOffset`, `alignmentOffset`, the
       box union with `expansion`.
   - Gecko owner:
     - per-span line data (`nsLineLayout::BeginSpan` and `EndSpan`, `nsLineLayout.cpp:378-416`), each continuation's
       reserved end border and padding (`nsInlineFrame.cpp:505-522`), end margins (`nsLineLayout.cpp:1199-1228`), trimming
       that recurses into spans (`:2851-2985`), and tab distances from the span stack (gecko audit F5, F6);
     - `ContinueTextRunAcrossFrames` over per-frame styles and box edges (`nsTextFrame.cpp:2015-2174`) (F1);
     - `BRFrame`, `WBRFrame` and atomic frames: always placing a BR, the push path and break-before, the optional break
       after a non-text frame (`nsLineLayout.cpp:1057-1080, 1266-1290, 1340-1341`);
     - the band from the slot: `lineLeft`, `availableWidth` and `impactedByFloats`, which changes `notSafeToBreak` and adds
       the line-start optional break (`nsLineLayout.cpp:785`; `nsBlockFrame.cpp:5289-5299`); below-floats where the block
       would `RedoNextBand`;
     - `GeckoLineStart` naming the frame and whether it's the first line (`nsLineLayout.cpp:180-190`); `mTextIndent`
       (`:178-201`); `TextAlignLine` and `ApplyFrameJustification` (`:3220-3670`); empty lines returned (F8);
     - geometry: `lineLeft`, `availableWidth`, `impactedByFloats`, `textIndent`, `alignOffset`, the frame union.
   - Observation port authors (`lab/observe`): walk the tree instead of `paragraph.runs`; produce `elements` per element
     (§9); take positions from each engine's line offsets (`lineLeft`), which already include box edges and indents; list
     the new unobservable facts.
   - Lab owner:
     - `Case` gains the tree form and `lineSlots`; ids hash the flat form where the tree is flat and the tree under a new
       `ID_VERSION` otherwise (§1.1);
     - the page builds nested spans with box edges and `vertical-align`, top-aligned atomic inline-blocks, `<br>`, `<wbr>`,
       the block's `text-indent` and `text-align`, and the slot floats (§2.9), and records `Element.getClientRects()` per
       element next to `runRects`;
     - `page.ts`'s `recordedLayout` copies `belowFloats`; the scorer compares `elements` where rows have them and adds the
       slot-rows observer assumption;
     - rule families per new rule (TEST-ARCHITECTURE §2): box edges at wrap points and at exact fits (Gecko's reserved end
       padding), nowrap spans inside wrapping blocks and the reverse, atomic inlines next to NBSP, CJK and collapsible
       spaces, `<br>` after collapsible white space, `<wbr>` under keep-all and nowrap, negative and positive text-indent
       with tabs, `text-align` end, center and justify with trailing spaces at unsafe offsets (Blink's reshape), and slot
       rows too narrow for a word (below-floats).
   - Painter owner: run `paint.ts` over the flat sets first, losing no painter pair against the v2 seeds, then over the new
     families; painter probes for slot floats, box edges and `text-align-last`.
   - Tests owner: registry rules and coverage for the new rules and the observer assumption.
   - Exit: `tsc` clean for `rebuild/tsconfig.json`, `rebuild/lab/tsconfig.json` and `rebuild/tests/tsconfig.json`; bun
     green; the v2 gates hold on the flat sets with 0 lost pairs; the new families are seeded.

Performance comes after all of these (CHARTER tentpole 8), starting from the measure log: calls per paragraph, the
cost of cluster and character tables, memo hits, table compaction, and a split between preparing a paragraph once and
filling lines in many slots, which `prepareParagraph` and `layoutLine` already allow.

## 9. Observation contract

`src/model.ts`, implemented by `rebuild/lab/observe/<engine>.ts`:

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
type ObservationPort<Layout extends ParagraphLayout> = (paragraph: Paragraph, layout: Layout, measure: CanvasMeasure) => ExpectedObservation
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
| Gecko (observe-gecko.md §2-§8) | every frame box edge, encoded `fround(R(au))` field by field; one rect per overlapping continuation; nodes without a frame report nothing; the chosen hyphen's width inside its box (E5); line membership where the frame has height | points inside a frame from characters' advances, under `in-word-prefix`; ligature shares, under `glyph-clusters` | the advance of white space trimmed at a break or by `TrimTrailingWhiteSpace`, and the overflowing part of hanging spaces (U2, except the growth of a negative delta); how a cluster's advance splits among its code points (U3); glyph widths inside a ligature beyond shares (U4); which zero-advance characters exist (U5); letter spacing apart from the glyph advance (U6); where frames split between zero-width characters (U9); which hyphen glyph (U10) |

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
  (`logical_line_builder.cc:419-433`), so Blink should report no rect; WebKit and Gecko aren't traced.

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
