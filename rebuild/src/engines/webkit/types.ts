// WebKit's prepared paragraph and line state (Safari 27.0, WebKit 7625.1.29.11.27). The WebKit port owns this file.
import type { WebKitEnvironment } from '../../env.js'
import type { AtomicInline, Gap, Paragraph, TextAlign } from '../../model.js'

// Which line builder InlineFormattingContext::layout picks (specs/webkit-lines.md §2, InlineFormattingContext.cpp:170-184).
export type WebKitLineBuilder = 'text-only-simple' | 'range-based' | 'line-builder'

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
  // FontFacts.monospace was null: laid out as variable pitch, with the fixed-pitch-path gap where test T1 fails.
  monospaceUnknown: boolean
  // The primary family as a lowercase name, from FontFacts.primaryFamily or the first family listed.
  primaryFamily: string
  // hyphenString() (StyleComputedStyle.cpp:419-435): U+2010 when the primary font maps it, else U+002D. FontFacts.mapsHyphen
  // null lays out U+2010 and reports hyphen-glyph where the two measure differently.
  hyphen: string
  hyphenUnknown: boolean
  // computedLocale after the Han swap; '' for a null locale (specs/webkit-text.md §4.1).
  locale: string
  // Canvas contexts: the run's font with its letter spacing and no word spacing (JS adds word spacing as WidthIterator
  // does), and the same font with no spacing (the primary font's space advance for tab stops and the fixed-pitch shortcut).
  context: number
  plainContext: number
  // float32 px after page zoom.
  letterSpacing: number
  wordSpacing: number
  // The CSS letter spacing as declared, which the hyphen fragment carries.
  cssLetterSpacing: number
  // InlineTextBox::hasStrongDirectionalityContent (TextUtil.cpp:486-576).
  hasStrongDirectionality: boolean
  // The primary-font coverage test found a code point as wide as LastResort's box, where it can't tell (gap font-fallback).
  coverageUnverified: boolean
}

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
  // (InlineItem.h:38-50; InlineItemsBuilder.cpp:1053-1078).
  | { kind: 'inline-box-start'; element: number; level: number }
  | { kind: 'inline-box-end'; element: number; level: number }
  | { kind: 'atomic'; element: number; level: number }
  | { kind: 'hard-line-break'; element: number; level: number }
  | { kind: 'word-break-opportunity'; element: number; level: number }

export type WebKitPrepared = {
  paragraph: Paragraph
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
  // The text of every leaf, by run.
  runTexts: string[]
  items: WebKitItem[]
  gaps: Gap[]
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
  } | null
  // IsFirstFormattedLine: no earlier line had contentful in-flow content (InlineFormattingContext.cpp:313, :331-333).
  isFirstFormattedLine: boolean
  // The formatting context holds floats: some earlier build, a line or a refused slot, was laid out in a slot with insets
  // and placed the slot floats. Floats make the content ineligible for the simple builders, so every line uses LineBuilder
  // (TextOnlySimpleLineBuilder.cpp:494), and a build that finds them narrows its rect in initialize (lines.ts lineRect).
  hasFloats: boolean
}
