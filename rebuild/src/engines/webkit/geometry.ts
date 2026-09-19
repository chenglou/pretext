// WebKit's line geometry (Safari 27.0) and the state its next line starts from: what the lab's rows keep of a WebKit line,
// so these types are as frozen as the row (DESIGN.md §2.4, §2.7). Types only. float32 CSS px (specs/webkit-lines.md §1.1).

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

// InlineItemPosition plus the PreviousLine facts the next line reads (specs/webkit-lines.md §5, §8.2).
export type WebKitLineStart = {
  engine: 'webkit'
  itemIndex: number
  offset: number
  // null on the first line, which has no PreviousLine.
  previousLine: {
    // trailingOverflowingContentWidth: the float32 width the rest of a split item keeps without being measured again
    // (AbstractLineBuilder.cpp:54-98), or null when the rest is measured fresh.
    carriedWidth: number | null
    endsWithLineBreak: boolean
    // The carried width comes from a run shaped across inline boxes (gap rtl-shaping-across-inline-boxes on this line too).
    carriedFromShaping: boolean
  } | null
  // IsFirstFormattedLine: no earlier line had contentful in-flow content (InlineFormattingContext.cpp:313, :331-333).
  isFirstFormattedLine: boolean
  // The formatting context holds floats: some earlier build, a line or a refused slot, was laid out in a slot with insets
  // and placed the slot floats. Floats make the content ineligible for the simple builders, so every line uses LineBuilder
  // (TextOnlySimpleLineBuilder.cpp:494), and a build that finds them narrows its rect in initialize (lines.ts lineRect).
  hasFloats: boolean
}
