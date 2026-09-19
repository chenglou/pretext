// WebKit's prepared paragraph and line state (Safari 27.0, WebKit 7625.1.29.11.27). The WebKit port owns this file.
import type { WebKitEnvironment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { AtomicInline, Gap, LineOf, LineResultOf, Paragraph, TextAlign } from '../../model.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'

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
  // The run's font with its letter spacing and word spacing: CanvasRenderingContext2DBase::setWordSpacing gives the context's
  // FontCascade the spacing (CanvasRenderingContext2DBase.cpp:3299-3324), so Canvas adds it per character inside the same
  // float32 loop as the DOM (WidthIterator::calculateAdditionalWidth, ComplexTextController.cpp:790-845). `context` when the
  // box has no word spacing.
  spacedContext: number
  // The run's font with 64px of letter spacing and no word spacing, which counts a string's spacing-bearing glyphs against
  // `plainContext` (measure.ts mergedGlyphs). `plainContext` when the box has no letter spacing.
  countContext: number
  // float32 px after page zoom.
  letterSpacing: number
  wordSpacing: number
  // The CSS letter spacing as declared, which the hyphen fragment carries.
  cssLetterSpacing: number
  // InlineTextBox::hasStrongDirectionalityContent (TextUtil.cpp:486-576).
  hasStrongDirectionality: boolean
  // The code points the primary-font coverage test found as wide as LastResort's box, where it can't tell (gap font-fallback).
  unverifiedCoverage: number[]
  // FontFacts.primaryFamily was null: the first listed family stands in for the realized one, which the Courier New test of the
  // width shortcut reads (gap fixed-pitch-path where the shortcut decides a width).
  primaryFamilyUnknown: boolean
  // The listed families that realize, in list order, each with the code points it draws and the ones its liga, clig, dlig
  // and hlig lookups can act on (ListedFontFacts.coverage and spacingInputs); null where the declaration's facts don't give
  // both for every family that may realize (measure.ts mergedGlyphs).
  spacingFacts: ReadonlyArray<{ coverage: readonly number[]; inputs: readonly number[] }> | null
  // FontFacts.pairKerning was null: whether the font's tables put a pair adjustment on the pair's second glyph isn't given,
  // which decides the shaped advance of the U+0020 a text item is measured with (gap simplified-measuring).
  pairKerningUnknown: boolean
  // The font-family list Canvas is given: the declared list with each generic keyword the locale resolves to a family of its
  // own named (fonts.ts), and the script's standard family appended where no listed family resolves. `firstNamedGeneric` is
  // the index of the first family named that way, or -1.
  canvasFamily: string
  firstNamedGeneric: number
  // How the box's locale, which OffscreenCanvas doesn't have, chooses fonts beyond that (gap canvas-language; content.ts
  // collectBoxFacts). A character is concerned unless a family of `namedContext` draws it (namedFamilyDraws: the families
  // before the first one below, followed by LastResort, against `lastResortContext`, LastResort alone):
  // - `unknownFamily`: the list holds a family the locale resolves in a way Canvas can't be given (a system design, or
  //   -webkit-standard under USCRIPT_HAN without the preferred languages);
  // - `namedGeneric`: the list holds a generic named for Canvas, which concerns a character with default emoji presentation,
  //   since the DOM skips a generic family's outline glyph for it.
  // `fallback`: the box holds a character whose system fallback font Core Text picks by the locale's language (content.ts
  // hasLanguageDependentFallback); such a character is concerned unless a family of the whole list draws it (`listContext`,
  // the Canvas list followed by LastResort). null: none of these.
  localeChoosesFonts: { unknownFamily: boolean; namedGeneric: boolean; fallback: boolean } | null
  namedContext: number
  listContext: number
  lastResortContext: number
  // The box's Han locale takes the preferred languages, which aren't given; or its quote overrides take the ICU default
  // locale, which isn't given (gap ui-language).
  hanLocaleUnknown: boolean
  quoteLocaleUnknown: boolean
  // The engine ranges of dictionary text that start with a combining mark, [start, end) in box offsets (gap
  // dictionary-breaks-stand-in).
  dictionaryRangesStartingWithMark: Array<[number, number]>
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
  // The paragraph as it lays out where the break position cache hands one of its boxes another item list (content.ts, "Page
  // history"). Empty in a world.
  historyWorlds: WebKitHistoryWorld[]
  // The paragraph's Canvas contexts, with the memo and the call log of preparation and of every line filled from it
  // (measure/canvas.ts). A world shares its paragraph's.
  measurer: Measurer
  // Whether inspectLine and paragraphGaps answer on this paragraph (index.ts prepare).
  inspect: boolean
}

// A history world: the prepared paragraph with `box` built from a cached list. `itemIndex` maps each of the paragraph's own
// item indices to the world's item that holds the own item's start, and `changed` marks the own items the world splits,
// merges or flags otherwise.
export type WebKitHistoryWorld = { prepared: WebKitPrepared; box: number; itemIndex: number[]; changed: boolean[] }

// The line nextLine fills, and what it returns for a slot.
export type WebKitLine = LineOf<WebKitLineStart, WebKitLineGeometry>
export type WebKitLineResult = LineResultOf<WebKitLineStart, WebKitLineGeometry>
