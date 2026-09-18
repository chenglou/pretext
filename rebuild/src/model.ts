// The library's data: the styled paragraph it takes, a tree of inline content with the facts about its fonts that Canvas
// can't show, and the lines each engine computes, in that engine's own geometry and units. DESIGN.md §1 and §2 explain
// every field with examples.
import type { BlinkLineStart } from './engines/blink/types.js'
import type { GeckoLineStart } from './engines/gecko/types.js'
import type { WebKitLineStart } from './engines/webkit/types.js'

// ---- Input ----

// A font as CSS declares it: what the page sets and the painter writes.
export type CssFont = {
  // CSS font-family list, e.g. '"Helvetica Neue", Arial'.
  family: string
  // CSS px.
  size: number
  weight: number
  style: 'normal' | 'italic'
}

// Facts about the fonts a declaration realizes that engines read and no measured width of the text shows (DESIGN.md
// §1.2). Each is null when the caller doesn't know it. The library then asks Canvas itself where a check is sound for the
// engine (measure/font-checks.ts, which cites each check's rule and says what it can't see); a supplied fact is never
// checked. Where no check answers, the engine uses the default documented here and reports the named gap wherever the
// fact decides a result.
export type FontFacts = {
  // The family the browser realizes first: Blink's primary font, the first listed family that exists (PrimaryFont with should_contain_glyph false, font_fallback_list.h:141-145); WebKit's
  // index-0 family (FontCascadeFonts.cpp:200-218); Gecko's first font of the font group. A generic keyword stands for
  // itself ('system-ui'). Default: the first family in the list. Blink and Gecko compare it with their system-font
  // keywords; WebKit compares it with Courier New, which gets no width shortcut (FontCoreText.cpp:776-782). Asked of
  // Canvas in WebKit, and in Blink where another check needs it: the first listed family that draws the space.
  primaryFamily: string | null
  // The primary font maps U+2010, so a chosen soft hyphen is U+2010, else U+002D (Blink computed_style.cc:1804-1820,
  // WebKit StyleComputedStyle.cpp:419-435). Default: U+2010, measured in the run's context. Gap hyphen-glyph where
  // Canvas gives U+2010 and U+002D different widths there. Gecko doesn't read it: its Canvas substitutes U+002D the way
  // the DOM does (gfxHarfBuzzShaper.cpp:119-124; specs/PROBES.md, Firefox corrections). Asked of Canvas in Blink and
  // WebKit for a paragraph that holds a soft hyphen: whether the primary family draws U+2010.
  mapsHyphen: boolean | null
  // The primary font has kCTFontMonoSpaceTrait or kCTFontFixedAdvanceAttribute, so WebKit's Font::determinePitch treats
  // it as fixed pitch (FontCoreText.cpp:753-785) and its boxes take the width and breakWord shortcuts
  // (specs/webkit-gaps.md §2.3). Default: variable pitch. Gap fixed-pitch-path where a text item of a box that allows
  // simplified measuring doesn't measure f32(length × W(' ')) (webkit-gaps §2.5 test T1). Inferred from Canvas in WebKit,
  // a heuristic: whether sample characters and the space have one advance, which the trait needn't follow.
  monospace: boolean | null
  // The fonts drawing the declaration have an opsz axis. Blink's DOM shapes at the zoomed size with opsz at the CSS size,
  // which Canvas reproduces at the CSS size (probes-chrome correction 7). Gecko's OffscreenCanvas uses the axis default
  // (specs/gecko-canvas.md §1.2 C1a). Default: true when primaryFamily is the engine's system-font keyword (Blink:
  // system-ui, BlinkMacSystemFont; Gecko: system-ui, -apple-system; the macOS system font has the axis), else false.
  // Gap optical-size wherever the fact decides a width. Canvas can say false in Blink, where the primary family's advances
  // at the zoomed size are the CSS-size advances scaled, and never true; Gecko's Canvas shows nothing.
  opticalSizeAxis: boolean | null
  // How the font that draws joining-script text shapes: 'opentype' through GSUB and GPOS, where HarfBuzz reads the
  // shaping call's context, or 'aat' through morx, which doesn't (hb-ot-shape.cc:60-66, 100-101). Blink reads it at
  // shaping-call edges between joining letters (group edges and line-edge reshapes). Default: the call's text measured
  // alone, which is what an AAT font gives. Gap joining-technology at such an edge. Asked of Canvas in Blink for a
  // paragraph with letters of a joining script: whether U+0628 changes width next to a joining character of another
  // script, which Canvas shapes in a call of its own with the rest as context. It stays null for a font whose joined forms
  // are as wide as its isolated ones.
  joining: 'opentype' | 'aat' | null
  // Where HarfBuzz puts a pair adjustment between two glyphs of Latin text in the primary font: 'first-advance', the whole
  // adjustment on the first glyph's advance (GPOS PairPos with ValueFormat1 XAdvance and no ValueFormat2; PairSet.hh:126-127),
  // or 'split', kern >> 1 on the first glyph's advance and the rest on the second's (the kern and kerx pair machine,
  // hb-kern.hh:102-106), which one HarfBuzz applies following the font's GPOS, kern and kerx tables (hb-ot-shape.cc:150-185).
  // Canvas totals show the adjustment, not which glyph carries it. Blink reads it at a position between the two glyphs: a
  // line edge taken from the paragraph's positions, and caret edges inside an item. Default: the first glyph's advance. Gap
  // unsafe-to-break at such a line edge where the adjustment isn't 0. No Canvas check answers it.
  pairKerning: 'first-advance' | 'split' | null
  // Optional: facts about each family of the list, in list order, one entry per family. Left out when the caller doesn't
  // know them, and then every engine keeps the gap condition it has without them. DESIGN.md §1.2 says which gap conditions
  // each fact can narrow or turn into a prediction. The engine's own fallback after the list isn't described: a character
  // no listed font covers is drawn by a font these facts don't name. Never asked of Canvas: these are whole sets, and a
  // Canvas check answers one string.
  fonts?: readonly ListedFontFacts[]
}

// Facts about one family of a font-family list, as the engine sees the font it realizes (DESIGN.md §1.2).
export type ListedFontFacts = {
  // The family as the list names it; a generic keyword stands for itself.
  family: string
  // Whether the family gives the engine a font: a loaded web font or an installed family. null: not known, and then
  // nothing is known about which font draws a character the earlier families don't cover.
  realizes: boolean | null
  // The code points the font maps, as the engine asks it: sorted inclusive ranges, flat ([first, last, first, last, ...]).
  // Blink asks the cmap, plus Core Text for U+2010 and U+2011 (harfbuzz_face.cc:210-231); WebKit asks Core Text, which
  // synthesizes some glyphs and withholds others (GlyphPageCoreText.cpp:51-73); Gecko reads the cmap and clears complex
  // script ranges an installed font has no shaping tables for (CoreTextFontList.cpp:271-313). null: not known, or the
  // family doesn't realize.
  coverage: readonly number[] | null
  // The character sequences the font draws as one ligature glyph across grapheme clusters. null: not known.
  ligatures: LigatureFacts | null
  // The code points that can become a glyph at which a lookup starts that belongs to a default-on feature the engine
  // turns off for non-zero letter-spacing: liga and clig in all three, calt in Blink too (font_features.cc:54-86;
  // UnrealizedCoreTextFont.cpp:258-264; gfxFont.cpp:675-700), and their morx counterparts. Sorted inclusive ranges, flat.
  // Text holding none of them shapes the same with those features on and off, so an empty list says letter-spacing never
  // changes this font's shaping. Left out or null: not known.
  spacingInputs?: readonly number[] | null
  // Unicode scripts (ISO 15924 codes) grouped by the GSUB and GPOS lookups HarfBuzz selects for them in this font
  // (hb_ot_layout_table_select_script, hb-ot-layout.cc:561-608, with the script's tags from hb-ot-tag.cc:36-181). Scripts in
  // one group get the same features and lookups under every language system; every script not listed shares the font's
  // fallback records ('DFLT', else 'dflt', else 'latn'), so an empty list says the script never changes the lookups. What
  // else follows the script (the shaper, the direction, fallback positioning) isn't covered. null: not known, or the
  // engine doesn't shape this font with HarfBuzz.
  scriptLookups: readonly (readonly string[])[] | null
}

export type LigatureFacts = {
  patterns: readonly LigaturePattern[]
  // true: every sequence of base characters the font's default features ligate across grapheme clusters, under the
  // default language system, is in `patterns`. false: there may be others, so the list can only confirm a ligature, never
  // rule one out. Either way it says nothing about combining marks between the characters beyond `acrossMark`: take marks
  // out before matching, and treat a match across marks as unsettled.
  complete: boolean
  // OpenType 'table/script/language' tags of the language systems whose lookups differ from their script's default.
  // Nothing in `patterns` was tried under them.
  languageSystems: readonly string[]
}

// Every string made of one alternative per position, in order, is drawn as a ligature. Alternatives are character
// sequences, usually one character. Combining marks and format characters between the components aren't listed.
export type LigaturePattern = {
  positions: readonly (readonly string[])[]
  // true: every such string was shaped and ligates. false: alternatives were shaped one at a time, so some combinations may
  // not ligate.
  exact: boolean
  // Whether it is still a ligature under the features the engine sets for non-zero letter-spacing (Blink liga, clig and
  // calt off, font_features.cc:54-86; WebKit liga, clig, dlig and hlig off, UnrealizedCoreTextFont.cpp:258-264; Gecko
  // liga, clig, dlig and hlig off, gfxFont.cpp:675-700, or common ligatures off in its Core Text shaper,
  // gfxCoreTextShaper.cpp:620-622).
  spaced: boolean
  // Whether it forms in every context tried: alone and, for Arabic-script text, joined to a letter before, after and on
  // both sides. false: in some of them only.
  everyContext: boolean
  // Whether the first two characters still share a glyph with a combining mark after the first. null: not tried.
  acrossMark: boolean | null
}

export const UNKNOWN_FONT_FACTS: FontFacts = { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null, pairKerning: null }

// A font declaration the library lays out with.
export type FontDecl = CssFont & { facts: FontFacts }

export type WhiteSpace = 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
export type WordBreak = 'normal' | 'break-all' | 'keep-all' | 'break-word'
export type OverflowWrap = 'normal' | 'break-word' | 'anywhere'
export type LineBreak = 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
export type Direction = 'ltr' | 'rtl'
// text-align of the block. text-align-last is fixed at auto: the last line and a line ending at a forced break take
// start where text-align is justify, and text-align otherwise (Blink LineInfo::GetTextAlign, line_info.cc:109-125;
// WebKit horizontalAlignmentOffset, InlineFormattingUtils.cpp:198-260; Gecko nsLineLayout::TextAlignLine,
// nsLineLayout.cpp:3482-3670).
export type TextAlign = 'start' | 'end' | 'left' | 'right' | 'center' | 'justify'
// vertical-align of an inline element as far as it decides shaping edges. '0px' is a length that moves nothing, but a
// value other than baseline ends shaping at the element's edges in Blink (ShouldBreakShapingBeforeBox and AfterBox,
// inline_node.cc:494-527) and ends a text run in Gecko (ContinueTextRunAcrossFrames, nsTextFrame.cpp:2054-2137). Vertical
// positions aren't modeled, so no value that moves the baseline is offered.
export type VerticalAlign = 'baseline' | '0px'

// The inherited properties that decide lines, as computed for one element: the block's own, or an inline element's.
// Every element carries all of them written out, so the library never computes inheritance: an element whose author
// set nothing carries its parent's values. Engines read the style the source reads: Blink the item's style
// (SetCurrentStyleForce, line_breaker.cc:4557-4643), WebKit the item's, parent's, nearest common ancestor's or root's
// depending on the site (specs/webkit-lines.md; webkit-shortcut-audit F1), Gecko the frame's and each span's
// (nsLineLayout::BeginSpan, nsLineLayout.cpp:378-416).
export type TextStyleOf<Font> = {
  font: Font
  // CSS px.
  letterSpacing: number
  wordSpacing: number
  whiteSpace: WhiteSpace
  wordBreak: WordBreak
  overflowWrap: OverflowWrap
  lineBreak: LineBreak
  tabSize: number
}

// One inline side of an inline element's box, CSS px as declared: margin (may be negative), border width and padding.
// Engines turn each into their units as their style systems do: Blink ComputeLineMarginsForSelf, ComputeLineBorders
// and ComputeLinePadding (line_breaker.cc:3937-3955, :245-252), WebKit's BoxGeometry (InlineFormattingUtils.cpp:321-325),
// Gecko's computed border and padding and the frame's margin (nsInlineFrame.cpp:501-521, nsLineLayout.cpp:1199-1228).
export type BoxEdge = { margin: number; border: number; padding: number }

export const NO_BOX_EDGE: BoxEdge = { margin: 0, border: 0, padding: 0 }

// A DOM text node, styled by its parent element. A leaf with empty text makes no DOM node; it keeps the run indices of
// a flat paragraph whose span holds no text (DESIGN.md §1.1).
export type TextLeaf = { kind: 'text'; text: string }

// An inline element (<span>, display: inline): its computed style, its lang attribute, the edges of its box at its
// inline start and end, and its children. With box-decoration-break: slice, the start edge goes on the element's first
// line and the end edge on its last (Blink HandleOpenTag and HandleCloseTag, line_breaker.cc:3957-4025; WebKit
// inlineItemWidth, InlineFormattingUtils.cpp:300-333; Gecko nsInlineFrame::ReflowFrames, nsInlineFrame.cpp:505-522).
export type InlineElementOf<Font> = TextStyleOf<Font> & {
  kind: 'span'
  // The element's lang attribute; null when it has none, so the nearest ancestor's applies. '' is lang="".
  lang: string | null
  inlineStart: BoxEdge
  inlineEnd: BoxEdge
  verticalAlign: VerticalAlign
  children: InlineNodeOf<Font>[]
}

// An atomic inline of declared size: an inline-block such as a chip, or an image. Its contents aren't modeled. The
// engines place its margin box as one unbreakable item, with a soft wrap opportunity on both sides whatever the text
// around it (Blink U+FFFC in text_content, inline_items_builder.cc:1269-1283, and HandleAtomicInline, line_breaker.cc:3043;
// WebKit isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:446-450, and its margin box width, :321-333; Gecko's non-text
// frame path, nsLineLayout.cpp:1057-1080). Wrapping around it follows its parent's white-space.
export type AtomicInline = {
  kind: 'atomic'
  // The border box in CSS px (box-sizing: border-box). The painter aligns the box to the line top, so while height is at
  // most the paragraph's line height the line box height stays the line height (CSS 2.1 §10.8).
  width: number
  height: number
  marginInlineStart: number
  marginInlineEnd: number
}

// <br>: a forced line break (Blink LayoutBR's LF control item, inline_items_builder.cc:1163-1198, layout_br.cc:33-37;
// WebKit's line break box, InlineItemsBuilder.cpp:1076; Gecko BRFrame, always placed, nsLineLayout.cpp:1273-1278).
export type LineBreakElement = { kind: 'br' }

// <wbr>: a soft wrap opportunity that holds no character (Blink LayoutWordBreak, an empty LayoutText,
// layout_word_break.cc:35, appends an opaque U+200B flow-control item, inline_items_builder.cc:597-607, 1211-1218; WebKit's
// word break opportunity item, InlineFormattingUtils.cpp:311, 469; Gecko WBRFrame).
export type WordBreakElement = { kind: 'wbr' }

export type InlineNodeOf<Font> = TextLeaf | InlineElementOf<Font> | AtomicInline | LineBreakElement | WordBreakElement

// The paragraph with fonts of one kind: CSS fonts as a page declares them (the lab's cases), or declarations with
// facts (the library's input). It stands for one block element: <div lang style="…">content</div>.
export type ParagraphOf<Font> = TextStyleOf<Font> & {
  // The block's children in document order.
  content: InlineNodeOf<Font>[]
  // The block's lang attribute. '' is lang="": the language is unknown and doesn't inherit <html lang>.
  lang: string
  direction: Direction
  // Content-box width in CSS px. Line slots narrow it per line (LineSlot).
  width: number
  // Fixed line height in CSS px, on the block and every inline element.
  lineHeight: number
  // text-indent in CSS px (no percentages, each-line or hanging): applied to the first formatted line (Blink
  // ShouldApplyTextIndent, line_breaker.cc:45-56, :846-857, :878-879; WebKit computedTextIndent,
  // InlineFormattingUtils.cpp:143-176; Gecko nsLineLayout::BeginLineReflow, nsLineLayout.cpp:178-201).
  textIndent: number
  textAlign: TextAlign
}

export type TextStyle = TextStyleOf<FontDecl>
export type InlineElement = InlineElementOf<FontDecl>
export type InlineNode = InlineNodeOf<FontDecl>
export type Paragraph = ParagraphOf<FontDecl>

// ---- Output: shared by every engine ----

// Where a line box sits between floats: the CSS px its band takes off the paragraph's content box at the left and right
// edges, the widths of the float margin boxes there (DESIGN.md §2.9). A zero inset is no float on that side. Each engine
// turns the insets into its own line offsets with its own arithmetic: Blink's LineLayoutOpportunity (line_left_offset,
// line_right_offset, line_layout_opportunity.h), WebKit's float-avoiding line rect (InlineLineBuilder.cpp:1185-1216),
// Gecko's float available space (nsBlockFrame.cpp:5252-5273).
export type LineSlot = { left: number; right: number }

export const FULL_WIDTH: LineSlot = { left: 0, right: 0 }

// A piece of a line in logical order, as the engine classifies its content. `run` indexes the paragraph's text leaves in
// document order; `element` indexes its elements (span, atomic, br, wbr) in document order, the block excluded. Offsets
// are UTF-16 offsets into the concatenation of all text leaves. Fragments carry no widths: widths and positions are in the
// line's geometry, in the engine's units.
//
// `level` is the bidi embedding level the engine reorders the piece with, after its own line-end rule for trailing white
// space (Blink compares levels, WebKit parity, Gecko has none; specs/bidi.md §6). Engines split pieces where the level
// changes, as they split items and frames, so the painter can rebuild the paragraph's levels (specs/painter.md §4.4).
//
// Every source unit belongs to exactly one line's fragments, and so does every atomic, br and wbr element and every
// span's start edge and end edge.
export type Fragment =
  // Content the engine lays out on this line: the source range as it is in the engine's content (collapsed white space
  // is one space, a newline in normal is a space). It includes controls the engine keeps in its content without placing
  // them, such as Blink's CR and FF in preserve modes (line_breaker.cc:2988-2994).
  | { kind: 'text'; run: number; start: number; end: number; painted: string; level: number }
  // Collapsible white space that stays in the engine's content but that the line end removed from the geometry after
  // the break was chosen (Blink RemoveTrailingCollapsibleSpace, WebKit trimmable trailing content, Gecko trimmed
  // trailing white space). It is painted, so the browser trims it again and shapes the text before it the same way
  // (specs/painter.md §3.1 c, §3.2 a, R3).
  | { kind: 'trimmed'; run: number; start: number; end: number; painted: string; level: number }
  // Source text the engine never places on this line: white space collapsed while its content was built, a removed
  // segment break, collapsible white space skipped at a line start, a text node without a layout object. Not painted.
  | { kind: 'collapsed'; run: number; start: number; end: number }
  // Preserved trailing white space that stays in the geometry but doesn't count against the available width.
  | { kind: 'hanging'; run: number; start: number; end: number; painted: string; level: number }
  // The hyphen drawn at a soft-hyphen break, after source offset `at`: U+2010 or U+002D as the engine chose it, with the
  // letter spacing the engine applies to it.
  | { kind: 'hyphen'; run: number; at: number; painted: string; letterSpacing: number; level: number }
  // A preserved newline, U+2028 or U+2029 that ended the line. Not painted.
  | { kind: 'forced-break'; run: number; start: number; end: number }
  // The line holds this span's start edge or end edge: Blink's open or close tag result (line_breaker.cc:3957-4025),
  // WebKit's inline box start or end item on the line, Gecko's first or last continuation of the nsInlineFrame. A span
  // with nothing on a line but its descendants has neither on that line.
  | { kind: 'box-start'; element: number }
  | { kind: 'box-end'; element: number }
  // An atomic inline placed on this line.
  | { kind: 'atomic'; element: number; level: number }
  // A <br> that ended this line. Not painted.
  | { kind: 'br'; element: number }
  // A <wbr> consumed on this line. Not painted.
  | { kind: 'wbr'; element: number }

// The state the next line starts from, per engine (DESIGN.md §2.7).
export type LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart

// ---- Output: Blink geometry (Chrome 153). Raw LayoutUnits count 1/64 of a zoomed px (specs/blink-lines.md §1.1) ----

// One unit of Blink's OffsetMapping over the line's source units (offset_mapping.cc:278-299, 405-459): source [start,
// end) maps to text_content [textStart, textEnd). A collapsed unit maps to an empty range; a unit Blink generated, such
// as U+200B after leading preserved spaces or U+FFFC for an atomic inline, has an empty source range.
export type BlinkMappingUnit = { run: number; start: number; end: number; textStart: number; textEnd: number; collapsed: boolean }

// A HarfBuzz cluster of a shape result: consecutive glyphs sharing one character index, at
// HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES (hb-ot-shape.cc:466-522, 578-586).
export type BlinkGlyphCluster = {
  // [textStart, textEnd) in text_content: the item's characters the caret code counts as the cluster's
  // (ShapeResult::PositionForOffset walks the runs by their character counts, shape_result.cc:696-733). They are the
  // characters the glyphs were shaped from except in an RTL view cut again after its parts were numbered in visual order,
  // where a trimmed space's glyph stands for the item's last character (specs/blink-RESULTS.md, round 1 class 3).
  textStart: number
  textEnd: number
  // Where graphemes start inside the cluster, textStart included (CharacterBreakIterator: ICU char.brk for 16-bit text,
  // one grapheme per code unit except CR LF for 8-bit, character_break_iterator.cc:76-87, 180-198). ShapeResult splits a
  // cluster's advance equally among its graphemes (shape_result.cc:310-329). ShapeResult::EnsureGraphemes lists a run's
  // graphemes over the item text at the run's start_index_ (shape_result.cc:186-214), which in an RTL view of several
  // parts is another stretch of the item than the run's own, so these are the starts Blink counts, not always Unicode's.
  graphemeStarts: number[]
  // Set on a cluster of several code points where those starts rest on which parts Blink's view has, which the port
  // doesn't know: an RTL item whose line edge inside a shaping call is safe to break, or reshaped from a safe offset, by
  // the port's width tests alone (HarfBuzz may flag it, and another reshape numbers the parts otherwise).
  graphemesLimit?: GapName
  // The cluster's advance in 16.16 fixed point of zoomed px (TextRunLayoutUnit), justification spacing included.
  advance: number
  // Set where the cluster's start, the advance sum before it in its item, is a Canvas stand-in Blink's own value can
  // differ from, with the condition's name: a position between letters HarfBuzz joins, measured as a prefix
  // (in-word-prefix); a position a font's lookups may cover with one glyph cluster where the declaration gives no
  // ligature fact (glyph-clusters); a pair adjustment no fact places (unsafe-to-break). Absent at a shaping call's edge
  // and wherever the port's model gives the position. The sum of an item's advances keeps the item's measured width, so
  // such a position moves advance between the clusters around it.
  startLimit?: GapName
}

// A run of the ShapeResult that FragmentItem::LineLeftAndRightForOffsets copies from a text item's ShapeResultView
// (CreateShapeResult, shape_result_view.cc:182-212), in logical order: a part of the view, cut further wherever another
// HarfBuzz run starts inside it (a script segment, a stretch another font draws). PositionForOffset adds the widths of the
// runs before a caret as floats (shape_result.cc:696-733), so past 256 zoomed px a caret depends on where the runs are.
export type BlinkShapeRun = {
  // [textStart, textEnd) in text_content, as the clusters count characters.
  textStart: number
  textEnd: number
  // The text shaped alone that the run's glyphs came from, where ShapeLine reshaped a line start or end
  // (shaping_line_breaker.cc:309-324, :497-553) or TruncateLineEndResult the text before a removed space
  // (line_breaker.cc:2371-2405); null for glyphs of the paragraph's shape result, which were shaped with the text around
  // them. A painter that lays the line out alone shapes every run with its painted neighbours.
  reshaped: { textStart: number; textEnd: number } | null
  // Whether the declaration's coverage facts name the font of every cluster: otherwise the run may be several.
  fontsKnown: boolean
}

// A FragmentItem of a line (logical_line_builder.cc:200-464), positioned by ComputeInlinePositions and ApplyTextAlign
// (inline_box_state.cc:845-856, inline_layout_algorithm.cc:303-311, 361-389, 943-970). x and inlineSize are raw
// LayoutUnits from the content box's left edge; level is the item's bidi level, whose parity is its direction.
export type BlinkItem =
  // Text with a ShapeResultView over [textStart, textEnd).
  // sizeLimit is set where the item's end position is such a stand-in too (BlinkGlyphCluster.startLimit): an item edge
  // inside a shaping call, where a glyph cluster over the edge goes to the item holding its first character
  // (glyph_data_range.cc:56-90). The item's size, and with it the x of the items after it on the line, can then differ.
  // runs are the shape's runs (BlinkShapeRun); partsKnown is false where Blink's view may have other parts than the
  // port's (BlinkGlyphCluster.graphemesLimit has the condition), which moves float sums past 256 zoomed px.
  | { kind: 'text'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[]; runs: BlinkShapeRun[]; partsKnown: boolean; sizeLimit?: GapName }
  // A tab run: flow control with a shape result of one space glyph per tab carrying its tab-stop advance
  // (shape_result.cc:1898-1938).
  | { kind: 'tab'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  // A preserved newline: flow control without a shape result (logical_line_builder.cc:404-445).
  | { kind: 'forced-break'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number }
  // The generated hyphen of a chosen soft hyphen, after the text item it ends at an even level and before it at an odd
  // level (PlaceHyphen, logical_line_builder.cc:447-464).
  | { kind: 'hyphen'; run: number; level: number; x: number; inlineSize: number }
  // The box fragment of a span that creates one (InlineItem::ShouldCreateBoxFragment: box edges, among other reasons,
  // line_breaker.cc:3944-3946); a culled span has no item. x and inlineSize are its border box on this line; the start
  // edge is on its first line and the end edge on its last (LayoutInline::QuadsForSelfInternal, layout_inline.cc:428-470).
  | { kind: 'inline-box'; element: number; x: number; inlineSize: number; hasStartEdge: boolean; hasEndEdge: boolean }
  // An atomic inline: its border box, and its inline margins as raw LayoutUnits (HandleAtomicInline, line_breaker.cc:3043-3110).
  | { kind: 'atomic'; element: number; level: number; x: number; inlineSize: number; marginStart: number; marginEnd: number }
  // A <br>: LayoutBR's forced-break control item (inline_items_builder.cc:1163-1198).
  | { kind: 'br'; element: number; level: number; x: number; inlineSize: number }

export type BlinkLineGeometry = {
  // Device scale factor times browser zoom. raw / 64 / layoutZoom is CSS px.
  layoutZoom: number
  // LineLayoutOpportunity::line_left_offset and line_right_offset from the content box's left edge, raw: the band between
  // the slot's floats (line_layout_opportunity.h; inline_layout_algorithm.cc:1222-1224).
  lineLeft: number
  lineRight: number
  // LineInfo::AvailableWidth: lineRight − lineLeft; for a slot without insets trunc(f32(f32(width × layoutZoom) × 64)).
  availableWidth: number
  // LineInfo::TextIndent(), the text-indent applied to this line and the position line filling starts from
  // (line_breaker.cc:846-857, :878-879), raw; 0 on lines it doesn't apply to.
  textIndent: number
  // LineInfo::NeedsAccurateEndPosition from text-align and direction (line_info.cc:127-175): whether a line ending at a
  // space is reshaped at its end (line_breaker.cc:255-268).
  needsAccurateEndPosition: boolean
  // LineInfo::Width (line_breaker.cc:1149-1161): the sum of the line's item results, hanging spaces, text-indent and box
  // edges included.
  width: number
  // The part of width that hangs: preserved trailing spaces that don't count against availableWidth
  // (LineInfo::ComputeTrailingSpaceWidth, line_info.cc:289-400).
  hangWidth: number
  // The offset ApplyTextAlign added to every item, raw (inline_layout_algorithm.cc:943-970); 0 under start in LTR.
  alignOffset: number
  mapping: BlinkMappingUnit[]
  // In visual order (logical_line_builder.cc:688-760).
  items: BlinkItem[]
}

// ---- Output: WebKit geometry (Safari 27.0). float32 CSS px (specs/webkit-lines.md §1.1) ----

// An InlineDisplay::Box of type Text, WordSeparator or SoftLineBreak, one per text or soft-line-break Line::Run after
// close() (InlineDisplayContentBuilder.cpp:118-144, 196-325).
export type WebKitTextBox = {
  kind: 'text' | 'soft-line-break'
  run: number
  // [start, end): the box's content as offsets into the run's text (InlineDisplay::Box::Text start and length).
  start: number
  end: number
  // After resetBidiLevelForTrailingWhitespace (InlineLine.cpp:243-287).
  level: number
  isWordSeparator: boolean
  // The visual rect's left edge from the content box and its width (processNonBidiContent, processBidiContent,
  // InlineDisplayContentBuilder.cpp:505-600, 862-940). A soft line break has width 0.
  x: number
  width: number
  // needsHyphen: the rendered content is the box text followed by this string (InlineDisplayContentBuilder.cpp:279-281).
  hyphen: string | null
  // The justification expansion included in width (InlineContentAligner::applyExpansionOnRange,
  // InlineContentAligner.cpp:230-266); 0 unless the line is justified.
  expansion: number
  // The expansion behavior the aligner gave the run (InlineContentAligner.cpp:150-228), which the complex text controller
  // reads to place the expansion among the box's glyphs (ComplexTextController.cpp:107-118, :800-845).
  expansionBehavior: { left: 'allow' | 'forbid'; right: 'allow' | 'forbid' }
  // The run's text was shaped with its neighbours across inline box edges as one RTL run (LineBuilder::applyShapingOnRunRange,
  // InlineLineBuilder.cpp:920-967), so its width is its characters' share of that shaping.
  shapedAcrossBoxes: boolean
  // The font-family list the box's text was measured with in Canvas: the declared list with the generic keywords the
  // box's locale resolves named (engines/webkit/fonts.ts). The observation port measures its in-box stand-ins with it.
  canvasFamily: string
}

export type WebKitDisplayBox =
  | WebKitTextBox
  // A NonRootInlineBox: a span's border box on this line, with its start edge on its first line and its end edge on its
  // last (RenderInline::absoluteQuads reports these, RenderInline.cpp:237-241).
  | { kind: 'inline-box'; element: number; x: number; width: number; hasStartEdge: boolean; hasEndEdge: boolean }
  // An AtomicInlineBox: the border box of an atomic inline.
  | { kind: 'atomic'; element: number; level: number; x: number; width: number }
  // A LineBreakBox for <br> (RenderLineBreak::absoluteQuads, RenderLineBreak.cpp:97-104).
  | { kind: 'line-break'; element: number; x: number; width: number }

export type WebKitLineGeometry = {
  // m_lineLogicalRect's left edge after floats, before text-indent, from the content box (LineBuilder::initialize,
  // InlineLineBuilder.cpp:463-476, floatAvoidingRect :1185-1216), float32 px.
  lineLeft: number
  // m_lineContentEdgeOffset: how far floats and text-indent moved the line start, which tab stops read
  // (InlineLineBuilder.cpp:478). Floats the line places itself, the slot floats on the paragraph's first build, don't move
  // it (:1394-1396).
  contentEdgeOffset: number
  // The line's available width after floats and text-indent: m_lineLogicalRect.width(), from LayoutUnit-truncated
  // lengths (StylePrimitiveData.h:341-360).
  lineBoxWidth: number
  // Line::contentLogicalWidth after close(): trimmed content removed, hanging content, box edges and the hyphen included
  // (InlineLine.cpp:745-778).
  contentWidth: number
  // HangingContent's trailing white-space width, which doesn't count against the available width (InlineLine.h:370-376).
  hangingWidth: number
  // contentGeometry.logicalRightIncludingNegativeMargin, where an RTL line's content edge is computed from
  // (InlineDisplayLineBuilder.cpp:136-138).
  contentLogicalRight: number
  // horizontalAlignmentOffset (InlineFormattingUtils.cpp:198-260, InlineLineBuilder.cpp:363): where content starts
  // inside the line rect; 0 under start in LTR.
  alignmentOffset: number
  // In box index order: visual order (InlineIteratorTextBox.cpp:71-102).
  boxes: WebKitDisplayBox[]
}

// ---- Output: Gecko geometry (Firefox 156). Integer app units, 60 per CSS px (specs/gecko-lines.md §2) ----

// One source unit of a frame, from measuredStart on.
export type GeckoCharacter = {
  // TransformText removed it: collapsed white space, an unused soft hyphen, a bidi control (gfxSkipChars).
  skipped: boolean
  // The text run's IsClusterStart flag at the unit's transformed index (gfxFont.cpp:708-769); false when skipped.
  clusterStart: boolean
  // The unit begins a shaping unit: gfxFont::SplitAndInitTextRun shapes words between boundary spaces and invalid
  // characters on their own (gfxFont.cpp:3708-3900), and the text run's script runs apart (gfxTextRun.cpp:2779-2809), so
  // the glyph records before it don't depend on it. false when skipped.
  unitStart: boolean
  // What GetAdvanceWidth adds for the unit: its glyph advance or ligature share and the letter spacing, word spacing,
  // justification spacing and tab width after it (gfxTextRun.cpp:1214-1256, nsTextFrame.cpp:4089-4295).
  advance: number
  // The position before the unit is a stand-in: it lies inside a shaping unit, whose glyph records come from one shaping
  // of the whole unit, and Canvas couldn't confirm it (`in-word-prefix`; engines/gecko/lines.ts advanceBefore). The
  // advances on both sides of such a position are stand-ins; their sum isn't. false when skipped.
  standInBefore: boolean
}

// An nsTextFrame continuation placed on the line (nsTextFrame::ReflowText, nsTextFrame.cpp:10847-11532).
export type GeckoTextFrame = {
  kind: 'text'
  run: number
  // GetContentOffset and GetContentEnd, as source offsets.
  contentStart: number
  contentEnd: number
  // Where measurement starts after the line-start skip of trimmable white space (nsTextFrame.cpp:10935-10951).
  measuredStart: number
  level: number
  // mRect: the left edge from the content box after ReorderFrames (nsBidiPresUtils.cpp:1494-1533, 1769-1866), and
  // ceil(max(0, advance)) less the floored TrimTrailingWhiteSpace delta (nsTextFrame.cpp:11268-11273, 11605).
  x: number
  width: number
  // BSize > 0: characters fit or the hyphen was used (nsTextFrame.cpp:11279-11307).
  hasHeight: boolean
  // TEXT_HYPHEN_BREAK: the hyphen run's advance is inside the box after the text (AddHyphenToMetrics, :6829-6845).
  usedHyphen: boolean
  // [measuredStart, contentEnd), one per source unit.
  characters: GeckoCharacter[]
  // The position after the last unit is a stand-in (GeckoCharacter.standInBefore): the frame ends inside a shaping unit.
  standInAtEnd: boolean
  // Every advance of the frame is a Canvas stand-in under this condition, or null: no Canvas font size gives the DOM's
  // (`font-size-quantization`), or an OffscreenCanvas can't take the DOM's optical size (`optical-size`).
  advancesStandIn: GapName | null
}

export type GeckoFrameGeometry =
  | GeckoTextFrame
  // An nsInlineFrame continuation: a span's border box on this line, x from the content box. It has its start edge only
  // without a previous continuation, and its end margin, border and padding only as the last one
  // (nsInlineFrame.cpp:505-522, nsLineLayout.cpp:1199-1228); its children follow it in the list.
  | { kind: 'inline'; element: number; x: number; width: number; hasStartEdge: boolean; hasEndEdge: boolean }
  // The frame of an atomic inline: its border box.
  | { kind: 'atomic'; element: number; level: number; x: number; width: number }
  // A BRFrame.
  | { kind: 'br'; element: number; x: number; width: number }
  // A WBRFrame: 0 × 0 at its place on the line (WBRFrame.cpp; nsIFrame::IsEmpty is false, nsIFrame.cpp:9380-9382).
  | { kind: 'wbr'; element: number; level: number; x: number; width: number }

export type GeckoLineGeometry = {
  // max(1, round(60 / devicePixelRatio)) (nsDeviceContext.cpp:52-63).
  appUnitsPerDevPixel: number
  // The float available space of the line's band: its physical left edge from the content box and its inline size,
  // BeginLineReflow's iStart and availISize (nsBlockFrame.cpp:5252-5273).
  lineLeft: number
  availableWidth: number
  // aFloatAvailableSpace.HasFloats(), nsLineLayout's mImpactedByFloats: the band is narrowed by floats, so a first frame
  // that doesn't fit breaks before and the line moves down (nsLineLayout.cpp:785, nsBlockFrame.cpp:5289-5299).
  impactedByFloats: boolean
  // mTextIndent added to the root span's position (nsLineLayout.cpp:178-201); 0 on lines it doesn't apply to.
  textIndent: number
  // The line box inline size psd->mICoord after TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985).
  width: number
  // GetHangFrom (nsLineLayout.cpp:3416-3450): trailing white space hanging past the available width; TextAlignLine moves
  // a wrapped line by it when it hangs against the line's direction (:3503-3512, 3594-3602).
  hang: number
  // The inline offset TextAlignLine added to the line's frames, au (nsLineLayout.cpp:3482-3670); 0 under start in LTR.
  alignOffset: number
  // In logical order; an inline frame comes before the frames of its children.
  frames: GeckoFrameGeometry[]
}

// A Canvas-versus-DOM gap a paragraph or line runs into: the prediction can be wrong where it applies (DESIGN.md §5).
export type GapName =
  | 'control-character-width'
  | 'soft-hyphen-shaping'
  | 'hyphen-glyph'
  | 'letter-spacing-ligatures'
  | 'canvas-language'
  | 'optical-size'
  | 'font-size-quantization'
  | 'bitmap-emoji-size'
  | 'unsafe-to-break'
  | 'script-context'
  | 'space-in-shaping'
  | 'in-word-prefix'
  | 'glyph-clusters'
  | 'joining-technology'
  | 'fixed-pitch-path'
  | 'simplified-measuring'
  | 'rtl-shaping-across-inline-boxes'
  | 'page-zoom'
  | 'dictionary-breaks-unavailable'
  | 'dictionary-breaks-stand-in'
  | 'font-fallback'
  | 'float32-precision'
  | 'string-storage'
  | 'ui-language'
  | 'han-kerning'
  | 'tab-stops'
  | 'page-history'
  | 'engine-build'

// `at`, when given, is the source range the condition concerns, in UTF-16 offsets into the concatenated text leaves: the
// characters whose widths or breaks the prediction can get wrong, or a break offset (start === end). A gap in `line.gaps`
// or `belowFloats[k].gaps` concerns its line or refused slot, and needs no range; a paragraph gap concerns a line only
// through `at`. The lab attributes a failing line to the gaps that concern it (lab/README.md, "Line-local gaps").
export type Gap = { gap: GapName; run: number | null; detail: string; at?: { start: number; end: number } }
