// The library's data: the styled paragraph it takes, a tree of inline content with the facts about its fonts that Canvas
// can't show, and what every engine's lines share. Each engine's own geometry and units, and the state its next line
// starts from, are in engines/<engine>/geometry.ts. DESIGN.md §1 and §2 explain every field with examples.

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
  // unsafe-to-break at such a line edge where the adjustment isn't 0. No Canvas check answers it for a declaration; where it
  // isn't given, Gecko's port asks Canvas per offset between two kerned glyphs (engines/gecko/advance.ts `pairKernedShare`).
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

// Where a line box goes: the block's content-box width in CSS px, and where the line box sits between floats, as the CSS
// px its band takes off the content box at the left and right edges, the widths of the float margin boxes there
// (DESIGN.md §2.9). A zero inset is no float on that side. The width is the slot's and not the paragraph's, because every
// engine reads it only while it fills a line, so one prepared paragraph serves any width. Each engine turns the insets
// into its own line offsets with its own arithmetic: Blink's LineLayoutOpportunity (line_left_offset, line_right_offset,
// line_layout_opportunity.h), WebKit's float-avoiding line rect (InlineLineBuilder.cpp:1185-1216), Gecko's float available
// space (nsBlockFrame.cpp:5252-5273).
export type LineSlot = { width: number; left: number; right: number }

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

// ---- Output: the function set (each engine's index.ts gives it, index.ts dispatches; DESIGN.md §2.9) ----

// What filling one slot decides: the line the engine places there, or its decision to move the line box down past the
// floats narrowing the slot, because the line's first content doesn't fit beside them (CSS 2.1 §9.5). `line` is the
// engine's own record of the decided line or of the refusal, which linePieces and inspectLine read and nothing writes.
//
// A refused slot takes no line. Blink continues with the next layout opportunity (inline_layout_algorithm.cc:1336-1367);
// WebKit wraps the candidate and moves the next line top below the float (InlineLineBuilder.cpp:1452-1457,
// InlineFormattingUtils.cpp:54-103); Gecko redoes the line in the next band (LineReflowStatus::RedoNextBand,
// nsBlockFrame.cpp:5289-5299, :5549-5555). A slot without insets never gives below-floats. The gaps the decision rests on
// come from inspectLine. `next` is the start the next slot lays out: the same one, unless building the refused line
// changed the engine's state, as WebKit's first build places the slot floats, which later builds find in the formatting
// context (InlineLineBuilder.cpp:478, :1394-1396).
export type FillResultOf<Start, Line, Refused> =
  | {
    kind: 'line'
    line: Line
    // [start, end) covers every source unit the line consumed; consecutive lines tile the text. Elements that hold no
    // text are placed by fragments. A filled line says where it breaks without its pieces.
    start: number
    end: number
    // The state the next line starts from (engines/<engine>/geometry.ts); null after the paragraph's last line.
    next: Start | null
    // Whether the engine gives the line a line box that holds content: false for Blink's empty lines
    // (LineInfo::ShouldCreateLineBox, line_breaker.cc:945-975), WebKit lines without contentful inline content
    // (LineLayoutResult.h:94-105) and Gecko line boxes of block size 0 (nsLineLayout.cpp:1690-1712). A span's box edge,
    // an atomic inline or a <br> makes content. Such a line is still a line of the engine and is returned; it paints
    // nothing, takes no block size and no slot, and the lab and the painter skip it.
    hasLineBox: boolean
  }
  | { kind: 'below-floats'; line: Refused; next: Start }

// A decided source range without a retained line record. The same start/slot decision serves counts and full output.
export type RangeFillResultOf<Start> =
  | { kind: 'line'; start: number; end: number; next: Start | null; hasLineBox: boolean }
  | { kind: 'below-floats'; next: Start }

// What a painter takes of a decided line, beside its slot and whether it has a line box.
export type LinePieces<Facts> = {
  fragments: Fragment[]
  // The paragraph's shaping joined the letters on both sides of this line's end: Blink reshaped the edge with HarfBuzz
  // context under an OpenType joining font (FontFacts.joining), Gecko broke inside one shaped word. The painter puts
  // U+200D on both sides of the edge (specs/painter.md R7). Always false in WebKit, which never shapes across a line
  // edge (specs/painter.md §3.2 c).
  joinsNextLine: boolean
  // The engine applied the paragraph's text-indent to this line.
  indented: boolean
  // The alignment the engine used for this line: text-align, or start for the last line and a line ending at a forced
  // break under justify (TextAlign).
  align: TextAlign
  // The line's content reaches past its band by the engine's own widths, hanging white space left out.
  overflows: boolean
  // What the engine's painting rules read of its own line beside the pieces.
  facts: Facts
}

// What the lab reads of a decided line on an inspected paragraph: the engine's geometry and the gaps that depend on the
// line's breaks (DESIGN.md §2.8). A refused slot has gaps and no geometry.
export type LineInspectionOf<Geometry> = { geometry: Geometry | null; gaps: Gap[] }

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
  | 'negative-word-tail'
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
