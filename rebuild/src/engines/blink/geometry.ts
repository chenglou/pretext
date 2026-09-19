// Blink's line geometry (Chrome 153) and the state its next line starts from: what the lab's rows keep of a Blink line, so
// these types are as frozen as the row (DESIGN.md §2.3, §2.7). Types only. Raw LayoutUnits count 1/64 of a zoomed px
// (specs/blink-lines.md §1.1).
import type { GapName } from '../../model.js'

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

// The break token (line_breaker.cc:4696-4774): nothing else carries to the next line (specs/blink-lines.md §4.1).
export type BlinkLineStart = {
  engine: 'blink'
  // InlineItemTextIndex.
  itemIndex: number
  textOffset: number
  // The style current at the break (index into BlinkPrepared.styles).
  style: number
  // The previous line ended in a forced break, so this line is not a wrapped line start and ShapeLine doesn't reshape
  // its start (shaping_line_breaker.cc IsStartOfWrappedLine).
  afterForcedBreak: boolean
  // InlineBreakToken::kIsPastFirstFormattedLine: the previous lines include one that isn't empty
  // (line_breaker.cc:4723-4724), so text-indent no longer applies (:45-56, :470-472).
  isPastFirstFormattedLine: boolean
  // The leading floats were placed: the first line handles the floats before any inline content (HandleFloat, their item
  // results in that line; PositionLeadingFloats, inline_layout_algorithm.cc), so every later break token is past them and
  // no later line has leading floats (line_breaker.cc:4225-4248 reads them). The model's slot floats aren't items, so the
  // token carries this.
  afterLeadingFloats: boolean
}
