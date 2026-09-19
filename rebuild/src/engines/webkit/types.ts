// WebKit's prepared paragraph and line state (Safari 27.0, WebKit 7625.1.29.11.27). The WebKit port owns this file.
import type { WebKitEnvironment } from '../../env.js'
import type { Context } from '../../measure/canvas.js'
import type { AtomicInline, FillResultOf, Gap, LineSlot, Paragraph, TextAlign } from '../../model.js'
import type { WebKitLineStart } from './geometry.js'

// Which line builder InlineFormattingContext::layout picks (specs/webkit-lines.md §2, InlineFormattingContext.cpp:170-184).
// `inline-boxes-only` is RangeBasedLineBuilder over inline box starts and ends alone, which makes one line of their runs
// (hasInlineBoxesOnly, RangeBasedLineBuilder.cpp:51-78).
export type WebKitLineBuilder = 'text-only-simple' | 'range-based' | 'inline-boxes-only' | 'line-builder'

// white-space as WebKit stores it: WhiteSpaceCollapse plus TextWrapMode (specs/webkit-text.md §5.1).
export type WhiteSpaceCollapse = 'collapse' | 'preserve-breaks' | 'preserve' | 'break-spaces'

// TextBreakIterator::LineMode::Behavior from line-break (TextUtil.cpp:450-466).
export type LineBreakMode = 'Default' | 'Loose' | 'Normal' | 'Strict'

// The computed style of one box, as far as line breaking reads it: the block's, a span's, or the style a text box takes
// from its parent (text inherits every property here). `rtl` is the direction, inherited from the block in the model.
export type WebKitStyle = {
  collapse: WhiteSpaceCollapse
  wrap: boolean
  wordBreak: Paragraph['wordBreak']
  overflowWrap: Paragraph['overflowWrap']
  lineBreak: Paragraph['lineBreak']
  lineBreakMode: LineBreakMode
  tabSize: number
  rtl: boolean
  // float32 px after page zoom: FontCascade::wordSpacing, which the simple builder's eligibility reads.
  wordSpacing: number
  // text-align and text-indent are inherited, so every box carries the block's (RangeBasedLineBuilder.cpp:177,
  // TextOnlySimpleLineBuilder.cpp:508-510).
  textAlign: TextAlign
  textIndent: number
}

// The horizontal BoxGeometry of an inline box (LayoutIntegrationBoxGeometryUpdater.cpp:231-306, :714-735): margins and
// padding as LayoutUnits of the declared px (evaluateMinimum<LayoutUnit>, LayoutUnit(float) truncates, LayoutUnit.h:76-78),
// borders snapped as border widths to device pixels first (StyleLineWidth.cpp:46-61, :128-132). In px, exact 64ths.
export type WebKitBoxEdges = { marginStart: number; borderStart: number; paddingStart: number; marginEnd: number; borderEnd: number; paddingEnd: number }

// An element of the inline tree as a layout box.
export type WebKitElement =
  // letterSpacing: usedLetterSpacing, float32 px at page zoom, which decides whether negative spacing may pull content left
  // of the box (InlineLine.cpp:307-309, :331-336).
  | { kind: 'span'; parent: number; style: WebKitStyle; edges: WebKitBoxEdges; letterSpacing: number }
  // An inline-block of declared size: its margin box width (InlineFormattingUtils::inlineItemWidth, :317-333), border box
  // width and inline margins, LayoutUnits in px.
  | { kind: 'atomic'; parent: number; node: AtomicInline; marginStart: number; marginEnd: number; borderBoxWidth: number; marginBoxWidth: number }
  | { kind: 'br'; parent: number }
  | { kind: 'wbr'; parent: number }

// One rendered Text node, WebKit's InlineTextBox, and the facts WebKit derives from its content and font.
export type WebKitBox = {
  run: number
  // The span the text node is a child of, or -1 for the block: the layout box parent, whose style the text takes.
  parent: number
  style: WebKitStyle
  // Source offset of the box content's first code unit.
  sourceStart: number
  text: string
  // Stored as Latin-1: every code unit is at most U+00FF, what JS-created nodes get (gap string-storage).
  is8Bit: boolean
  // RenderText::canUseSimpleFontCodePath: FontCascade::characterRangeCodePath isn't Complex.
  simpleFontCodePath: boolean
  // InlineTextBox::canUseSimplifiedContentMeasuring (RenderText.cpp:480-524). The primary-font coverage condition is tested
  // only for fixed-pitch boxes, the only ones that read the result.
  simplifiedMeasuring: boolean
  // Font::determinePitch of the primary font (FontCoreText.cpp:753-785), from FontFacts.monospace: the breakWord shortcut
  // (TextUtil.cpp:265-280).
  fixedPitch: boolean
  // canTakeFixedPitchFastContentMeasuring: fixed pitch and a primary family other than Courier New (FontCoreText.cpp:776-784;
  // Safari hides user-installed fonts, so :784's attribute is never set for web content). The width shortcut.
  fixedPitchFastMeasuring: boolean
  // The primary family as a lowercase name, from FontFacts.primaryFamily or the first family listed.
  primaryFamily: string
  // hyphenString() (StyleComputedStyle.cpp:419-435): U+2010 when the primary font maps it, else U+002D. FontFacts.mapsHyphen
  // null lays out U+2010 and reports hyphen-glyph where the two measure differently.
  hyphen: string
  // computedLocale after the Han swap; '' for a null locale (specs/webkit-text.md §4.1).
  locale: string
  // Canvas contexts: the run's font with its letter spacing and no word spacing (JS adds word spacing as WidthIterator
  // does), and the same font with no spacing (the primary font's space advance for tab stops and the fixed-pitch shortcut).
  context: Context
  plainContext: Context
  // TextUtil::singleSpaceWidth, W(' ') in `context`, kept from where handleTextContent measures it for the box's white space
  // (content.ts). null where it defers the white space: measure.ts singleSpaceWidth then asks Canvas at every read. Measuring
  // the space for every box as the box is made would ask Canvas earlier than the recorded rows do, which takes a browser run
  // (research/ARCHITECTURE-PLAN-2.md §10).
  spaceWidth: number | null
  // The run's font with its letter spacing and word spacing: CanvasRenderingContext2DBase::setWordSpacing gives the context's
  // FontCascade the spacing (CanvasRenderingContext2DBase.cpp:3299-3324), so Canvas adds it per character inside the same
  // float32 loop as the DOM (WidthIterator::calculateAdditionalWidth, ComplexTextController.cpp:790-845). `context` when the
  // box has no word spacing.
  spacedContext: Context
  // The run's font with 64px of letter spacing and no word spacing, which counts a string's spacing-bearing glyphs against
  // `plainContext` (measure.ts mergedGlyphs). `plainContext` when the box has no letter spacing.
  countContext: Context
  // float32 px after page zoom. The box's word spacing is its style's.
  letterSpacing: number
  // The CSS letter spacing as declared, which the hyphen fragment carries.
  cssLetterSpacing: number
  // The listed families that realize, in list order, each with the code points it draws and the ones its liga, clig, dlig
  // and hlig lookups can act on (ListedFontFacts.coverage and spacingInputs); null where the declaration's facts don't give
  // both for every family that may realize (measure.ts mergedGlyphs).
  spacingFacts: ReadonlyArray<{ coverage: readonly number[]; inputs: readonly number[] }> | null
  // The font-family list Canvas is given: the declared list with each generic keyword the locale resolves to a family of its
  // own named (fonts.ts), and the script's standard family appended where no listed family resolves.
  canvasFamily: string
}

// UBIDI_DEFAULT_LTR, the level of items built without bidi (IIB:907, 977, 987, 1031).
export const DEFAULT_BIDI_LEVEL = 254
// InlineItem::opaqueBidiLevel (InlineItem.h:54).
export const OPAQUE_BIDI_LEVEL = 255

// InlineTextItem (InlineTextItem.h). `level` is UBIDI_DEFAULT_LTR (254) when bidi didn't run.
export type WebKitTextItem = {
  kind: 'text'
  box: number
  start: number
  end: number
  level: number
  isWhitespace: boolean
  isWordSeparator: boolean
  hasTrailingSoftHyphen: boolean
  // The float32 width stored when the item was built, the carried remainder of a split item, or null when the item is
  // measured when placed (specs/webkit-lines.md §3.2, §8.2).
  width: number | null
}

export type WebKitItem =
  | WebKitTextItem
  // A preserved LF, U+2028 or U+2029 (InlineSoftLineBreakItem).
  | { kind: 'soft-line-break'; box: number; start: number; level: number }
  // InlineItem types InlineBoxStart, InlineBoxEnd, AtomicInlineBox, HardLineBreak and WordBreakOpportunity
  // (InlineItem.h:38-50; InlineItemsBuilder.cpp:1053-1078). Elements hold no source units: `sourceOffset` is where the item
  // sits among them, the source offset of the next text box after it, or the text's length.
  | { kind: 'inline-box-start'; element: number; level: number; sourceOffset: number }
  | { kind: 'inline-box-end'; element: number; level: number; sourceOffset: number }
  | { kind: 'atomic'; element: number; level: number; sourceOffset: number }
  | { kind: 'hard-line-break'; element: number; level: number; sourceOffset: number }
  | { kind: 'word-break-opportunity'; element: number; level: number; sourceOffset: number }

export type WebKitPrepared = {
  env: WebKitEnvironment
  // env.pageZoom, or 1 when it isn't given (gap page-zoom).
  zoom: number
  // env.icuDefaultLocale, or en_US_POSIX, what Apple ICU computes without LANG or LC_* (specs/webkit-gaps.md §8.2), when it
  // isn't given (gap ui-language where it decides).
  icuDefaultLocale: string
  // The root box's style (the block).
  style: WebKitStyle
  elements: WebKitElement[]
  // The builder for the content without floats. A line slot with insets puts floats in the formatting context, which only
  // LineBuilder handles (TextOnlySimpleLineBuilder.cpp:494, RangeBasedLineBuilder.cpp:172).
  builder: WebKitLineBuilder
  boxes: WebKitBox[]
  // Source offset of each run's first code unit, and the total length at runs.length.
  runStarts: number[]
  items: WebKitItem[]
  // The paragraph's Canvas contexts, one per distinct settings (measure/canvas.ts), all made while it is prepared; the boxes
  // and the box facts hold the ones they measure in. A world shares its paragraph's.
  contexts: Context[]
  // What the paragraph keeps only for inspectLine and paragraphGaps; null on a paragraph prepared plain, which computes no
  // gap, asks Canvas nothing that only a gap reads, and answers neither (index.ts, gaps.ts, history.ts). Nothing else says
  // which of the two a paragraph is.
  inspect: WebKitInspect | null
}

export type WebKitInspect = {
  // The paragraph's gaps: conditions of the environment alone (gaps.ts newInspection).
  gaps: Gap[]
  // Per box, in box order, what only gaps read of it.
  boxes: WebKitBoxInspect[]
  // The paragraph as it lays out where the break position cache hands one of its boxes another item list (history.ts).
  // Empty in a world.
  worlds: WebKitHistoryWorld[]
}

// The facts of a box that decide no line and that the gaps of the lines measuring it read (gaps.ts).
export type WebKitBoxInspect = {
  // FontFacts.monospace was null: laid out as variable pitch, with the fixed-pitch-path gap where test T1 fails.
  monospaceUnknown: boolean
  // FontFacts.mapsHyphen was null (WebKitBox.hyphen).
  hyphenUnknown: boolean
  // The code points the primary-font coverage test found as wide as LastResort's box, where it can't tell (gap font-fallback).
  unverifiedCoverage: number[]
  // FontFacts.primaryFamily was null: the first listed family stands in for the realized one, which the Courier New test of the
  // width shortcut reads (gap fixed-pitch-path where the shortcut decides a width).
  primaryFamilyUnknown: boolean
  // FontFacts.pairKerning was null: whether the font's tables put a pair adjustment on the pair's second glyph isn't given,
  // which decides the shaped advance of the U+0020 a text item is measured with (gap simplified-measuring).
  pairKerningUnknown: boolean
  // How the box's locale, which OffscreenCanvas doesn't have, chooses fonts beyond that (gap canvas-language; gaps.ts
  // boxMade). A character is concerned unless a family of `namedContext` draws it (namedFamilyDraws: the families
  // before the first one below, followed by LastResort, against `lastResortContext`, LastResort alone):
  // - `unknownFamily`: the list holds a family the locale resolves in a way Canvas can't be given (a system design, or
  //   -webkit-standard under USCRIPT_HAN without the preferred languages);
  // - `namedGeneric`: the list holds a generic named for Canvas, which concerns a character with default emoji presentation,
  //   since the DOM skips a generic family's outline glyph for it.
  // `fallback`: the box holds a character whose system fallback font Core Text picks by the locale's language (gaps.ts
  // hasLanguageDependentFallback); such a character is concerned unless a family of the whole list draws it (`listContext`,
  // the Canvas list followed by LastResort). null: none of these.
  localeChoosesFonts: { unknownFamily: boolean; namedGeneric: boolean; fallback: boolean; namedContext: Context; listContext: Context; lastResortContext: Context } | null
  // The box's Han locale takes the preferred languages, which aren't given; or its quote overrides take the ICU default
  // locale, which isn't given (gap ui-language).
  hanLocaleUnknown: boolean
  quoteLocaleUnknown: boolean
  // The engine ranges of dictionary text that start with a combining mark, [start, end) in box offsets (gap
  // dictionary-breaks-stand-in).
  dictionaryRangesStartingWithMark: Array<[number, number]>
}

// A history world: the prepared paragraph with `box` built from a cached list. `itemIndex` maps each of the paragraph's own
// item indices to the world's item that holds the own item's start, and `changed` marks the own items the world splits,
// merges or flags otherwise. A world is an inspected paragraph without worlds of its own, so its lines are filled and
// inspected by the functions that fill and inspect the paragraph's.
export type WebKitHistoryWorld = { prepared: WebKitPrepared; box: number; itemIndex: number[]; changed: boolean[] }

// ---- A line (lines.ts fills it; output.ts and gaps.ts read it) ----

// Line::Run::TrailingWhitespace (InlineLine.h:191-201); a run without trailing white space has none (Type::NotApplicable).
export type TrailingWhitespace = { type: 'not-collapsible' | 'collapsible' | 'collapsed'; length: number; width: number }

// Line::ShapingBoundary (InlineLine.h:52, :165-168): the run's text was shaped with its neighbours across inline boxes.
export type ShapingBoundary = 'start' | 'inside' | 'end'

// The expansion behavior the aligner gives a run (InlineContentAligner.cpp:150-228; expansion.ts).
export type ExpansionSide = 'allow' | 'forbid'
export type ExpansionBehavior = { left: ExpansionSide; right: ExpansionSide }

// A Line::Run of text (InlineLine.h:93-226): [textStart, textStart + textLength) of its text box.
export type TextRun = {
  kind: 'text'
  box: number
  isWordSeparator: boolean
  left: number
  width: number
  level: number
  textStart: number
  textLength: number
  // Line::Run::Text::needsHyphen (InlineLine.h:388-393): the hyphen width is inside `width`.
  needsHyphen: boolean
  trailingWhitespace: TrailingWhitespace | null
  lastNonWhitespaceContentStart: number | null
  // Line::Run::setExpansion (InlineContentAligner.cpp:230-266): the justification expansion inside `width`, and its behavior.
  expansion: number
  expansionBehavior: ExpansionBehavior
  shapingBoundary: ShapingBoundary | null
}

export type LineRun =
  | TextRun
  // A soft line break run holds its one unit, { position, 1 } (IL:856-865).
  | { kind: 'soft-line-break'; box: number; textStart: number; left: number; width: number; level: number }
  // The runs of elements, each where its item sits among the source units (WebKitItem). A line starting inside a span begins
  // with its spanning inline box start, which no item stands for.
  | { kind: 'hard-line-break' | 'word-break-opportunity' | 'atomic' | 'inline-box-start' | 'inline-box-end'; element: number; sourceOffset: number; left: number; width: number; level: number }
  | { kind: 'spanning-inline-box-start'; element: number; left: number; width: number; level: number }

export type Line = {
  runs: LineRun[]
  contentLogicalWidth: number
  // TrimmableTrailingContent with fully trimmable content (InlineLine.h:264-286): the first trimmable run, the offset of the
  // trimmable content from it, and the trimmable width. Partially trimmable content comes from text-spacing trim, which the
  // model doesn't have.
  trimmable: { runIndex: number; offset: number; width: number } | null
  // The unit TrimmableTrailingContent::remove took out of its run (IL:963-987): still in the box's content, in no run.
  trimmedUnit: { box: number; offset: number; level: number } | null
  // HangingContent's trailing white space (IsConditional::WhenFollowedByForcedLineBreak).
  hanging: { length: number; width: number } | null
  trailingSoftHyphenWidth: number | null
  hasNonDefaultBidiLevelRun: boolean
  // m_inlineBoxLogicalLeftStack (IL:307-309, :331-336).
  inlineBoxLogicalLeftStack: number[]
}

// m_lineLogicalRect as LineBuilder::initialize and the slot floats leave it, with m_lineContentEdgeOffset and whether a float
// narrowed it (lines.ts lineRect).
export type LineLogicalRect = { left: number; width: number; contentEdgeOffset: number; constrainedByFloat: boolean }

// What filling one slot decides, which linePieces and lineGeometry (output.ts) and lineGaps (gaps.ts) read and nothing
// writes: the closed Line with the start and the slot it was filled from and in, the builder that filled it, its rect, and
// its source range. `isLastLineOrLineEndsWithForcedLineBreak` is what the alignment reads (IFU:198-276). `measuredEnd` and
// `gaps` are the filling's (lines.ts Fill): the gaps it raised, in order, or null on a paragraph prepared plain.
export type WebKitFilledLine = {
  engine: 'webkit'
  kind: 'line'
  from: WebKitLineStart
  slot: LineSlot
  builder: WebKitLineBuilder
  rect: LineLogicalRect
  line: Line
  start: number
  end: number
  isLastLineOrLineEndsWithForcedLineBreak: boolean
  measuredEnd: number
  gaps: Gap[] | null
}
// A slot the line moved below: what the refused build measured and raised.
export type WebKitRefusedSlot = { engine: 'webkit'; kind: 'below-floats'; from: WebKitLineStart; slot: LineSlot; measuredEnd: number; gaps: Gap[] | null }
export type WebKitFillResult = FillResultOf<WebKitLineStart, WebKitFilledLine, WebKitRefusedSlot>
