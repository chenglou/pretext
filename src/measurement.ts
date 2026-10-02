import { findGraphemeEnds, type GraphemeTable } from './graphemes.js'
import { canWebKitLineStartWith, DEFAULT_IGNORABLE, getBlinkDefaultLocale, hasProperty, MARK } from './line-breaks.js'
import { webkitGenericFamilies, webkitGenericFamilyNames, webkitScriptLanguages, webkitScriptSubtags } from './generated/webkit-generic-families.js'
import type { SegmentEntryGeometry } from './entry-geometry.js'
import type { HanKerningFontData } from './han-kerning.js'

// What preparation knows of a segment in a font. Each is created with all its fields,
// so their reads see one shape.
export type SegmentMetrics = {
  width: number
  emojiCount: number // Glyphs the emoji font draws (countEmojiGlyphs), or -1 until counted
  fit: SegmentFit | null // Where it breaks under overflow, for the last fit mode asked
  spaceKerning: SpaceKerning | null // Its kerning beside a space, once asked (getSpaceKerning)
}

// A text segment's kerning with a U+0020 beside it, in the Chromium profile (getSpaceKerning).
export type SpaceKerning = {
  after: number // With a space after it
  before: number // With a space before it
}

// Where a segment breaks under overflow-wrap: break-word in one fit mode (getSegmentFit),
// replaced whole when another mode is asked for.
export type SegmentFit = {
  mode: BreakableFitMode
  advances: number[] | null // Per grapheme, or null for one grapheme
  // With advances in the WebKit profile, per grapheme, 1 for one after the first that
  // WebKit doesn't start a line with when a line holds only an overflowing first
  // character, by its first code unit. Null without any.
  lineStartProhibitions: Uint8Array | null
  entryGeometry: {
    letterSpacing: number
    emojiCorrection: number
    geometry: SegmentEntryGeometry | null
  } | null
}

export type EngineProfile = {
  // How a line that starts inside a segment holding a default-ignorable code point
  // admits the segment's tail (src/entry-geometry.ts): by the tail's own measured start
  // ('fresh', desktop Blink), by the whole segment's width minus the consumed prefixes
  // ('original', desktop Gecko), or not at all ('disabled').
  entryFitBasis: 'fresh' | 'original' | 'disabled'
  // Where preparation finds break opportunities: each engine's own scan. Blink and WebKit
  // scan the text with their pair tables and ICU line rules (src/line-breaks.ts), Gecko
  // with nsLineBreaker over ICU4X's rules (src/gecko-line-breaks.ts), and engines Pretext
  // doesn't recognize take Blink's scan.
  lineBreakScan: 'blink' | 'webkit' | 'gecko'
  // Where grapheme clusters end: the engine's ICU character rules (src/graphemes.ts).
  // libicucore's add Apple's transcoding hints to Extend. Firefox's ICU4X data gives the
  // clusters Chrome's rules give, over its text run, which leaves out bidi controls.
  graphemeTable: GraphemeTable
  // What a line may overflow its width by and still fit: WebKit's own 1/64 px, which availableWidth()
  // adds (InlineLineBuilder.cpp:1172-1183). Blink and Gecko fit exactly in their own units, so their
  // 0.005 px is a named gap (ENGINE_FOLLOWUPS.md, Fitting arithmetic).
  lineFitEpsilon: number
  // Where an emergency break falls inside a segment. WebKit measures the word's grapheme
  // prefixes (TextUtil::breakWord), and Gecko adds the advances of the word shaped whole
  // (gfxTextRun::BreakAndMeasureText), which prefixes follow in joined scripts where
  // standalone graphemes don't. Blink sums standalone graphemes. Segments at least this
  // wide fit from prefixes, narrower ones from standalone graphemes. A segment breaks
  // only on a line narrower than itself, so every line at least this wide gets prefixes.
  // Gecko's 80px is a premise, not a browser rule: prefixes cost a Canvas call per
  // grapheme of every new word, most of the calls a lower floor adds are in words 24-80px
  // wide, and taking them from 24px or everywhere fixed adversarial lines at 24-80px but
  // made Firefox prepare new text much slower (RESEARCH.md, Break Opportunities From
  // Engine Data; Decisions Log).
  prefixFitMinWidth: number
  // WebKit measures a text item together with a directly following U+0020 and
  // subtracts one unshaped space, so the item keeps its kerning with that space
  // wherever the line ends. Gecko shapes words without their spaces.
  measureTextWithFollowingSpace: boolean
  // Blink's layout shapes each run of one script and direction in one call, its spaces
  // included (HarfBuzzShaper::Shape, harfbuzz_shaper.cc:1063-1104), so in a font whose kerning
  // names the space glyph a word kerns with the space after it and a space with the word after
  // it, and in one that pairs kana a kana kerns with the kana after it. Its Canvas cuts a
  // string at each U+0020 and before each kana and reports none of it (PlainTextNode::SegmentWord
  // and NextWordEndIndex, plain_text_node.cc:92-153, 365-399), so preparation asks Canvas for it
  // another way (getSpaceKerning, getKanaKerning).
  kernsAcrossCanvasWords: boolean
  // WebKit and Gecko letter-space the visible discretionary hyphen itself.
  // Blink shapes it separately, without spacing.
  letterSpaceDiscretionaryHyphen: boolean
  // Gecko resolves letter spacing to whole app units, 1/60 px (ResolveLetterSpacing,
  // nsTextFrame.cpp:1949-1962): at -0.08px each character takes -5/60 px, and a spacing
  // under half a unit is none. Blink keeps 1/65536 px and WebKit a float, which
  // preparation takes as given (readLetterSpacing).
  letterSpacingInAppUnits: boolean
  // Under any letter spacing but 0 the engines shape text without its optional ligatures:
  // Blink turns off liga, clig and calt (font_features.cc:52-86), Gecko and WebKit liga,
  // clig, dlig and hlig (gfxFont.cpp:672-685 under nsLayoutUtils.cpp:6896-6904;
  // UnrealizedCoreTextFont.cpp:258-264 under StyleComputedStyleBase.cpp:318-333), so `fi`,
  // `fl` and `ffi` take their letters' own advances: 16px Roboto `difficult` is 52.87px
  // wide, and 54.20px plus the spacing under any. Blink's and Gecko's Canvas letterSpacing
  // turns them off as their pages do (canvas_rendering_context_2d_state.cc:871-907;
  // CanvasRenderingContext2D.cpp:5233-5241). WebKit's keeps them (FontCascade.cpp:81;
  // PLATFORM_BUGS.md), so the WebKit profile measures letter-spaced text with its ligatures
  // and comes out that much narrower than Safari (ENGINE_FOLLOWUPS.md, Letter spacing).
  canvasLetterSpacingDropsLigatures: boolean
  // Which text of the scripts whose letters join takes no letter spacing
  // (getUnspacedGraphemes in src/prepare.ts): in Blink a script run of one of them, but
  // for its spaces ('run'); in Gecko a cluster whose first character is of one of them
  // ('cluster'); in WebKit none, which spaces every glyph that has an advance
  // (ComplexTextController.cpp:793-796, WidthIterator.cpp:511-516).
  unspacedCursive: 'run' | 'cluster' | 'none'
  // Blink's page shapes a soft hyphen inside its text, so nonspacing marks after
  // one shape with the text before it and take no advance. Its Canvas turns the soft
  // hyphen into a ZWSP and shapes each word alone, where such a mark can take a
  // dotted circle. WebKit's page gives the marks the advance its Canvas measures.
  shapesMarksAcrossSoftHyphen: boolean
  // When a selected discretionary hyphen does not fit, Blink retries the text
  // item against the width minus the hyphen, so the line ends at the latest
  // earlier opportunity that leaves room for it. Pretext has no Blink item
  // boundaries and applies the reduced width to every earlier opportunity.
  // Gecko records a soft-hyphen break only where its hyphen fits, and any other
  // break where its line fits (gfxTextRun.cpp:1086-1101), so the line returns to
  // the latest opportunity that fits at the full width. WebKit wraps the content
  // after the soft hyphen, finds that the hyphen overflows (processInlineContent,
  // InlineContentBreaker.cpp:104-122) and builds the line again up to each of its
  // wrap opportunities, the latest first, until one ends without a soft hyphen or
  // fits its hyphen; the line's first opportunity stays whatever its hyphen
  // overflows (revertToLastNonOverflowingItem, TextOnlySimpleLineBuilder.cpp:459-480,
  // and rebuildLineForTrailingSoftHyphen, InlineLineBuilder.cpp:1860-1887, for lines
  // with inline boxes): 'full-width-or-first', the latest opportunity that fits at
  // the full width, else the line's first, which is the soft hyphen the walker
  // reaches before any opportunity on the line has fit. That return fits each text
  // item as WebKit measures it, on its own (TextUtil::width, TextUtil.cpp:62-100),
  // and an item ends at its soft hyphen, so under it no text counts as narrower
  // joined across one, as it does for Blink and Gecko (getJoinedNarrowing in
  // prepare.ts). In 16px Arial at 76-80px Safari 27 lays out
  // `the interna\u00ADtion\u00ADal` as `the` / `interna-` / `tional`, and at 40px
  // `trans\u00ADi\u00ADt\u00ADlantic` starts with `trans-`, 40.9px wide.
  unfitHyphenRetreat: 'reduced-width' | 'full-width' | 'full-width-or-first'
  // A chosen soft hyphen paints U+2010 where a font has a glyph for it, else `-`.
  // WebKit and Blink ask the primary font alone (hyphenString,
  // StyleComputedStyle.cpp:419-431, measured by TextUtil::hyphenWidth,
  // TextUtil.cpp:621-624; ComputedStyle::HyphenString, shaped in
  // hyphen_result.cc:12-16), where Canvas draws U+2010 in a later family or a
  // system font, so the profile asks which family draws it (getHyphenText). Gecko
  // asks the first listed font that has it, else its default font, and shapes
  // U+2010 as any other text (MakeHyphenTextRun over GetFirstValidFont(U+2010),
  // gfxTextRun.cpp:2458-2473 and 2277-2360), which is what Canvas measures. The
  // premise there is that the default font has one, as macOS's, Helvetica, does.
  hyphenFromPrimaryFont: boolean
  // Pre-wrap tab stops count from the line's start, eight spaces apart, and a tab under a
  // minimum from the next stop takes the stop after it (CSS Text 3 §4.1.2). Blink and Gecko
  // count each of those spaces with its letter spacing (TabSize::GetPixelSize,
  // tab_size.h:24-33, since Chromium 140 under the runtime flag TabSizeWithSpacing, which
  // an older Chromium lacks and so counts plain spaces; Font::TabWidthInternal,
  // font.cc:303-317; ComputeTabWidthAppUnits, nsTextFrame.cpp:3875-3906). WebKit counts
  // plain spaces (FontCascade::tabWidth, FontCascadeInlines.h:76-93).
  letterSpaceTabStops: boolean
  // WebKit letter-spaces a tab as any glyph with an advance (WidthIterator.cpp:491-517).
  // Blink shapes a run of tabs apart from text, with no spacing (shape_result.cc:1898-1944),
  // and Gecko adds none after a tab (CanAddSpacingAfter, nsTextFrame.cpp:3860-3873).
  letterSpaceTabs: boolean
  // The character whose advance, halved, is the least a tab advances: a space in Blink and
  // WebKit (Font::TabWidth, font.cc:319-340; FontCascade::tabWidth), `0` in Gecko
  // (GetMinTabAdvanceAppUnits, nsTextFrame.cpp:1931-1937). Gecko reads the first available
  // font's `0`, or its average character width where it has none (ZeroOrAveCharWidth,
  // gfxFont.h:1698-1700). The profile takes Canvas's width of `0`, which a later font of
  // the list draws where the first has none, so under such a list, one led by an icon or a
  // single-script font, a tab near a stop can land a stop from Firefox's.
  tabMinimumCharacter: ' ' | '0'
  // Gecko counts a tab's position, its stops and its minimum in whole app units, sixtieths
  // of a pixel, so a tab exactly the minimum from its stop takes it (AdvanceToNextTab,
  // nsTextFrame.cpp:4298-4304). Blink and WebKit count in floats (fmodf).
  tabsInAppUnits: boolean
  // A run of preserved spaces and tabs at the end of a pre-wrap line hangs in Blink
  // and WebKit (CSS Text 3 §4.1.2). Gecko doesn't hang a tab, so a tab counts in the
  // line's fit and width there, as spaces do not, and one that doesn't fit goes to the
  // next line with the word before it (segmentAtLineBreaks() in src/analysis.ts).
  hangTabs: boolean
  // Blink's break-anywhere retry and WebKit's grapheme search can end a line after
  // zero-width glue when the grapheme after it doesn't fit, so the glue takes a line of
  // its own. Gecko drops soft hyphens from its text run and clusters a ZWSP with the marks
  // after it, so glue at a line start can't hold the line: the segment after it starts it.
  zeroWidthGlueTakesLine: boolean
  // When not even the first character of an overflowing word fits an empty line, WebKit
  // keeps the punctuation, NBSP, U+2010 and U+2013 after that character on the line, in
  // text holding a code unit above U+00FF (InlineContentBreaker.cpp:124-158, 222-233;
  // canWebKitLineStartWith in src/line-breaks.ts). Blink and Gecko end the line after the
  // first grapheme.
  keepsLineStartPunctuation: boolean
  // Blink's HanKerning under text-spacing-trim: normal halts CJK opening and closing marks
  // next to other punctuation and at line ends (src/han-kerning.ts). WebKit and Gecko
  // don't trim them by default.
  hanKerning: boolean
  // Blink and Gecko hang U+3000 at a line end as they hang spaces (addIdeographicSpaceHangs
  // in src/prepare.ts). WebKit counts it: Safari 27 lays out 中文, U+3000, 中文 at 33px
  // in 16px PingFang SC in 3 lines.
  hangsIdeographicSpace: boolean
  // Blink lays out content without a language under its default locale, Chrome's UI
  // language, which Intl shows (getBlinkLineBreaks in src/line-breaks.ts): its line table,
  // font fallback and HanKerning's punctuation types follow it. Canvas under an empty page
  // language doesn't, so the Chromium profile prepares such a page under that locale, its
  // scan and its context alike (getPreparationLanguage). WebKit and Gecko take process
  // languages a page can't read and keep the page's.
  laysOutUnderDefaultLocale: boolean
  // WebKit's page resolves serif, sans-serif, cursive, fantasy and monospace to the
  // family Core Text names for the page language wherever WebKit's script for it
  // isn't Common (FontDescriptionCocoa.cpp:77-118, asked first by CSSFontSelector.cpp:
  // 334-353). Its Canvas fonts carry no language: OffscreenCanvas starts from a bare
  // font description (OffscreenCanvasRenderingContext2D.cpp:93-130) and WebKit has no
  // canvas `lang` (WebKit #285993). The WebKit profile names the page's families in
  // the Canvas font (getWebKitGenericFamilies), from a table rather than a `<canvas>`
  // element, whose contexts force style updates (RESEARCH.md, Decisions Log).
  namesGenericFamiliesByLanguage: boolean
  // Release Gecko draws C0 and C1 controls, U+2028 and U+2029 with no advance plus letter
  // spacing (gfxFont.cpp:3877-3892), where its Canvas measures VT, FS-US, NEL and U+2029 as a
  // space (CanvasRenderingContext2D.cpp:4634-4637) and other controls as a hexbox. Chrome and
  // Safari give most controls an advance on the page, as their Canvas does.
  hidesControlCharacters: boolean
  // Where collapsible white space before soft hyphens that end a rich-inline line hangs, as
  // white space that ends a line does, where the line doesn't end at a soft hyphen with its
  // hyphen. Gecko discards soft hyphens from a text frame's text (IsDiscardable,
  // nsTextFrameUtils.cpp:32-49), so the white space ends the line wherever it ends
  // ('line-end'): rich items `see`, ` \u00AD` in 16px Arial take one 25.8px line in Firefox
  // at 26px. Blink hangs it where the line breaks before more content ('break') and lays a
  // soft hyphen that ends the paragraph out after it, where it takes room: Chrome gives
  // that soft hyphen a line of its own at 26px. WebKit does too, and also keeps a soft
  // hyphen on a line that ends at white space after it, so it hangs the white space
  // before a soft hyphen only where the line breaks there ('own-break'): items `see`,
  // ` \u00AD `, `this word` end their first line at 30.24px in Safari at 45px, and at
  // 25.80px in Chrome and Firefox.
  spaceBeforeSoftHyphenHangs: 'line-end' | 'break' | 'own-break'
  // Gecko drops soft hyphens and bidi controls before it collapses white space, so white
  // space after one collapses with the white space before it, in a run that goes on from one
  // text frame to the next (nsTextFrameUtils::TransformText): Firefox lays out items `ab`,
  // ` \u00AD \u00AD`, `cd` in 16px Arial in one 39.15px line at 40px, where Chrome and Safari
  // give 2 lines, as they do for one text node. Rich-inline takes it across items and after an
  // item's leading white space (whitespaceRunOpen in src/rich-inline.ts); the Gecko profile's
  // analysis takes it inside a text, where its scan's white-space run reads through both
  // (transformText in src/gecko-line-breaks.ts).
  collapsesSpaceAcrossSoftHyphens: boolean
  // Where rich-inline finds break opportunities next to an item boundary. Blink runs one
  // line-break iterator over the text of the whole inline formatting context, and Gecko
  // collects a word across text frames until a space and breaks it in one pass, so every
  // break fact near a boundary comes from the text the items join. WebKit finds breaks
  // inside each inline box from that box's own text, and decides a boundary between boxes
  // from the previous box's last two characters (TextUtil.cpp:374-396). Its soft wrap index
  // loop ends the content it places after a line break item, so no break comes before one
  // at any boundary, after an atomic item too (nextWrapOpportunity, InlineFormattingUtils.cpp:469-475).
  breaksFromItemText: boolean
  // Where a rich line that has no break to return to ends when an item that starts with a
  // hard break, with none before it, doesn't fit its padding. Blink's retry of an overflowing
  // line breaks between any two graphemes (kBreakCharacter, line_breaker.cc:4258-4264,
  // 4620-4622), so the line ends before the item ('item'). Gecko's wrap opportunities come
  // before each cluster inside a text frame, none at its end (gfxTextRun.cpp:1046-1101), so the
  // line ends before the last grapheme of the text before the item, a preserved space too,
  // before that grapheme's item where it is all of that item, and keeps the item where that
  // grapheme starts the line ('last-grapheme'). WebKit breaks the last run of the content that
  // doesn't fit where that run fits, TextUtil::breakWord in an overflowing run, else before the
  // last character of one that no text run follows (InlineContentBreaker.cpp:611-651), so it
  // ends the line there too, but after the preserved spaces that fit where the spaces that end
  // the text overflow the line, as spaces that hang can ('fit'). `Unbreakable`, then a span with
  // 20px of padding that starts with a line feed, in 15px Helvetica Neue at 93px; `Unbreakabl`,
  // a bold `e` and that span at 86-106px, which moves the `e`; and `Unbreakable   ` and that span
  // at 86-103px, which moves the last space in Firefox and in Safari the spaces that don't fit,
  // all three at 86px.
  hardBreakItemRetreat: 'item' | 'last-grapheme' | 'fit'
  // Which edges of a padded item a line fits where the line takes the item's opening and no
  // more of it: a hard break that starts the item, or white space that starts it after an
  // atomic item, and in Blink anywhere (openingEdge, prepareRichInline). Blink adds a span's
  // start edge to the line when it opens (HandleOpenTag, line_breaker.cc:3957-3976), and only a
  // test-only flag narrows the line for its cloned end edge (BoxDecorationBreakCloneLineBreaking,
  // :454-461); the text or forced break after it finds the line overflowing and returns to the
  // line's latest break (HandleText, HandleForcedLineBreak, :1355-1372, 2856-2860), and the close
  // tags after a forced break trail it (:2912-2929): 'start'. The items a line takes after the
  // break it returns to stay on it where they are all trailable, white space with the tags of
  // spans that open and close among it (RewindOverflow, :4332-4424), so after any content Blink
  // fits no edge of a span of only white space. Where the line ends with preserved spaces
  // that overflow it, or that follow text in one item, which Blink's return breaks before them
  // (HandleOverflow, :4163-4185, at the run's start that ShapingLineBreaker::ShapeLine breaks at,
  // shaping_line_breaker.cc:490-495), the line trails them, taking the open tag and white space or
  // a forced break after them with no fit (HandleTrailingSpaces, :2426-2534), so Blink fits no
  // edge where the content before the spaces fits; after spaces that start an item, before which
  // no break comes (UAX #14 LB7), it fits the start edge with them. WebKit fits a box that opens
  // in the content it places without its cloned end edge (placedClonedDecorationWidth,
  // InlineLineBuilder.cpp:1501-1523), but that content runs on past the inline box ends after a
  // line break or white space (nextWrapOpportunity, InlineFormattingUtils.cpp:470-475, 530-538),
  // so it fits the end edge too of an item of white space that ends there, and leaves white space
  // that hangs before the box out of the fit (hangingContentWidth, InlineContentBreaker.cpp:
  // 183-186, 956-958): 'placed'. Gecko fits a frame's whole width, its cloned end edge too, and
  // lets only an empty frame past the line's end (CanPlaceFrame, nsLineLayout.cpp:1217-1270):
  // 'both'. In 15px Helvetica Neue, `Unbreakable` and a span with 20px padding that starts with a
  // line feed keep the line feed from 107px in Chrome and Safari, from 127px in Firefox, and
  // `Unbreakable   ` and that span from 86px in Chrome, 105px in Safari and 138px in Firefox;
  // `Ping `, the chip `@alice` and a span with 12px padding that starts with two spaces keep them
  // on the chip's line from 71px in Chrome and Safari and from 83px in Firefox, and one of only
  // two spaces at every width in Chrome and from 117px in Safari and Firefox.
  paddedOpeningFit: 'start' | 'placed' | 'both'
  // Gecko places a frame whose margin box is empty wherever it falls, on a line that already
  // overflows too ("Empty frames always fit right where they are", CanPlaceFrame,
  // nsLineLayout.cpp:1264-1269), so an atomic item of width 0 stays on the line it falls on,
  // unless the line ends before it: it breaks after white space that follows text already past
  // its end (getFrameEndSpace, src/rich-inline.ts), which only a frame that always fits is left
  // to show, and it goes back to a break before the item where a frame with a width that
  // continues the text comes next (getKeptEmptyEnd). Blink and WebKit fit it as any other atomic
  // inline and move it to the next line.
  emptyAtomicAlwaysFits: boolean
  // Where the preserved spaces that end a pre-wrap line's text and overflow the line still hang
  // once an item that takes no room follows them on the line, an atomic item of width 0 or an
  // item of soft hyphens alone. Gecko takes the hang out of each text frame's own width, the
  // trailing spaces past the line's end and no more, whatever follows the frame (hang =
  // min(max(0, advance - available), trimmable), nsTextFrame::ReflowText, nsTextFrame.cpp:
  // 11216-11229), so such an item is inside the line, at its end, and white space after it hangs
  // too. Blink reads the line's trailing spaces by walking back from its last item and stops at
  // an atomic inline or at text that doesn't end in a space (ComputeTrailingSpaceWidth,
  // line_info.cc:289-415), and in WebKit an atomic inline box ends the content that can hang
  // (ContinuousContent::append, InlineContentBreaker.cpp:943-947), so there the run of spaces
  // that hang ends at such an item.
  hangsSpacesPerTextFrame: boolean
  // Blink transforms segment breaks in the text of the whole inline formatting context
  // (ShouldRemoveNewline and RemoveTrailingCollapsibleNewlineIfNeeded, inline_items_builder.cc).
  // Gecko transforms each text frame's own text (nsTextFrameUtils::TransformText), as
  // rich-inline transforms an item's, and WebKit turns segment breaks into spaces.
  transformsSegmentBreaksAcrossItems: boolean
}

export type BreakableFitMode = 'sum-graphemes' | 'segment-prefixes' | 'pair-context'

// The measurement context and what preparation measured through it. Canvas resolves
// fonts under the context's language, the page's unless the context has a `lang` to
// give it preparation's. Chrome keeps a resolved font while its font string is
// unchanged, so the context, and every width measured through it, belong to the
// language it was created under: all of it is replaced when that language changes.
type MeasureState = {
  language: string | null
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  // A second context, under text-rendering: optimizeLegibility, where Canvas shapes a string
  // whole, and the Canvas font it is set to: made for the first font asked about its kana
  // (getFontKanaKerning).
  wholeRunContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  wholeRunFont: string
  genericFamilies: string[] | null // The families the language gives the generic keywords, or null
  takesLetterSpacing: boolean // As Chrome's and Firefox's contexts do, as a string of CSS px
  // Whether the context shapes text under LETTER_SPACED_SHAPING as the page shapes text
  // under letter spacing, without its optional ligatures: it takes a letterSpacing and
  // the engine's Canvas turns them off under one (canvasLetterSpacingDropsLigatures).
  shapesLetterSpaced: boolean
  letterSpaced: boolean // Whether the context is set to LETTER_SPACED_SHAPING, by getFontMeasurement()
  fonts: Map<string, FontMeasurement>
  // What letter-spaced text measures in each font where shapesLetterSpaced: the same text
  // shaped without its optional ligatures.
  letterSpacedFonts: Map<string, FontMeasurement>
}
let measureState: MeasureState | null = null
// What preparation keeps per font. It all goes together, when the caches clear or the
// language changes.
export type FontMeasurement = {
  state: MeasureState // Its context, which getFontMeasurement() sets to the font and its shaping
  // The font Canvas is given: the declared font, with the generic keywords the context's
  // language names replaced by their families.
  canvasFont: string
  metrics: Map<string, SegmentMetrics>
  // Metrics of a text item measured together with one following U+0020, keyed by
  // the item alone. The width includes that space.
  followingSpaceMetrics: Map<string, SegmentMetrics>
  // In the Chromium profile, the font's kerning with the space glyph, or null where it has
  // none, asked for the first text with a space (getFontSpaceKerning).
  spaceKerning: FontSpaceKerning | null | undefined
  // In the Chromium profile, the font's kerning between kana, or null where it has none,
  // asked for the first text with two kana in a row (getFontKanaKerning).
  kanaKerning: FontKanaKerning | null | undefined
  emojiCorrection: number | null // Probed for the first text that may hold emoji
  emojiWidth: number // Canvas's width of one glyph of the emoji font, measured with the correction
  hyphenText: string | null // Asked for the first text with a soft hyphen (getHyphenText)
  hanKerning: HanKerningFontData | null | undefined // Read for the first text that may kern
}
// What preparation keeps of a font that kerns with the space glyph.
export type FontSpaceKerning = {
  // A character's kerning with a space glyph after it, and with one before it, by code unit,
  // once a segment has the character at that edge (getSpaceKerning).
  after: Map<number, number>
  before: Map<number, number>
}
// What preparation keeps of a font that kerns kana.
export type FontKanaKerning = {
  // The kerning of two kana in a row, by the first's code unit times 0x10000 plus the
  // second's, once a text has the pair (getKanaKerning).
  pairs: Map<number, number>
  // Whether a pair asked about has kerned the two apart, as some of Klee's do.
  widens: boolean
}
let cachedEngineProfile: EngineProfile | null = null

// Prefix fits, which preparation picks by engine, width and letter spacing
// (measureAnalysis in src/prepare.ts), measure every growing prefix of a
// segment. That suits word-sized runs, but a giant segment would prepare in time
// that grows with the square of its length. Past this size, the cheaper
// pair-context model keeps preparation linear.
const MAX_PREFIX_FIT_GRAPHEMES = 96

// The Canvas letterSpacing a context measures letter-spaced text under: not 0, so the
// engine shapes the text as its page does under letter spacing, and too small to add any
// width, so one measurement serves every spacing and preparation adds the spacing itself.
// Blink adds spacing in units of 1/65536 px (ShapeResultSpacing::SetSpacing,
// shape_result_spacing.cc:14-33) and Gecko's Canvas in whole app units, 1/60 px
// (CanvasRenderingContext2D.cpp:4771-4774), and both read 0 here: 16px Roboto `difficult`
// measures 54.2031px in Chrome 154 and 54.2px in Firefox 156, their pages' widths with
// `font-variant-ligatures: none` (2026-09-30).
const LETTER_SPACED_SHAPING = '0.000001px'

// Graphemes the emoji font may draw a glyph in, which Canvas widths then tell
// (countEmojiGlyphs): those holding an emoji-presentation character or a pictograph,
// or an emoji character followed by U+FE0F, such as a keycap base like `1`. U+FE0F
// after a letter or a space changes nothing.
const emojiGraphemeRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji}\uFE0F/u
const maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u

const genericKeywords = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace']
// A quoted family name, or an unquoted generic keyword with what precedes it.
const familyListItemRe = /("[^"]*"|'[^']*')|(^|,)(\s*)(serif|sans-serif|cursive|fantasy|monospace)(?=\s*(?:,|$))/gi
// A font string's size, with its line height, after which its family list starts.
const fontSizeRe = /\dpx(?:\s*\/\s*\S+)?\s+/
// One family of a family list, with the white space around it.
const familyRe = /(?:"[^"]*"|'[^']*'|[^,])+/g

// The families WebKit's page gives the generic keywords under a language, or null
// where they resolve as in Canvas. The page asks Core Text wherever WebKit's script
// for the language isn't Common: localeToScriptCode tries the language, then its last
// subtag as a script, then the language less that subtag (LocaleToScriptMapping.cpp:
// 360-377). A plain Han language becomes the first preferred language starting with
// zh-, else zh-hans (FontDescription.cpp:74-113); a page can't read those languages,
// so Pretext takes zh-hans. Core Text's answers are OS data, generated with macOS's
// and iOS's families (scripts/generate-webkit-generic-families.ts): where they differ,
// the context takes macOS's if it has it. Listing both instead would send characters
// macOS's family lacks to iOS's, where the page falls back by language.
function getWebKitGenericFamilies(language: string, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): string[] | null {
  let tag = language.toLowerCase().replaceAll('_', '-')
  let han: boolean | null = null
  for (let at = tag; han === null;) {
    if (webkitScriptLanguages.includes(` ${at} `)) han = at === 'zh'
    else {
      const cut = at.lastIndexOf('-')
      if (cut < 0 || at.endsWith('-zyyy')) return null
      if (webkitScriptSubtags.includes(` ${at.slice(cut + 1)} `)) han = at.endsWith('-hani')
      at = at.slice(0, cut)
    }
  }
  if (han) tag = 'zh-hans'
  let row = webkitGenericFamilies[tag]
  while (row === undefined) {
    tag = tag.slice(0, Math.max(0, tag.lastIndexOf('-')))
    row = webkitGenericFamilies[tag]
  }
  const families: string[] = []
  for (let i = 0; i < row.length; i++) {
    // Keywords with the same entry share its family, and the context is asked once.
    const first = row.indexOf(row[i]!)
    if (first < i) {
      families.push(families[first]!)
      continue
    }
    const name = webkitGenericFamilyNames[row[i]!]!
    const pair = name.indexOf('|')
    const family = pair < 0 ? name : hasFamily(ctx, name.slice(0, pair)) ? name.slice(0, pair) : name.slice(pair + 1)
    families.push(family === '' ? '' : `"${family}"`)
  }
  return families
}

// Text each of macOS's families in the table draws some of: Latin, Hangul, Han,
// Devanagari, Khmer, Kannada, Lao, Malayalam, Myanmar, Oriya, Sinhala and Tibetan.
const familyProbeText = 'Hamburg 한中 नम សួ ನಮ ສະ നമ မင ନମ ආය བཀ'

// Whether the context has a family: the probe text measures differently with it first.
function hasFamily(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, family: string): boolean {
  for (const fallback of ['monospace', 'serif']) {
    ctx.font = `16px ${fallback}`
    const width = ctx.measureText(familyProbeText).width
    ctx.font = `16px "${family}", ${fallback}`
    if (ctx.measureText(familyProbeText).width !== width) return true
  }
  return false
}

// The Canvas font that measures what the page draws: each unquoted generic keyword
// in the family list, after the size, becomes the page's families for it.
function getCanvasFont(font: string, families: readonly string[]): string {
  const size = fontSizeRe.exec(font)
  if (size === null) return font
  const start = size.index + size[0].length
  return font.slice(0, start) + font.slice(start).replace(familyListItemRe, (item: string, quoted: string | undefined, separator: string, space: string, keyword: string) => {
    const named = quoted === undefined ? families[genericKeywords.indexOf(keyword.toLowerCase())]! : ''
    return named === '' ? item : separator + space + named
  })
}

// The string a chosen soft hyphen paints in the font where the engine takes it from the
// primary font (hyphenFromPrimaryFont): U+2010 where that font has a glyph for it, else `-`.
// Where both measure the same in the font, either does. Else Canvas tells which family draws
// a character from two lists: the engines draw each character with the first listed font
// that has its glyph (WebKit's glyphDataForVariant, FontCascadeFonts.cpp:426-439), so a family
// draws it where `family, monospace` and `family, serif` measure it alike and the two generic
// families alone don't. The primary font is the first listed family's that gives a font,
// whether or not it has a glyph for a space (WebKit's primaryFont, FontCascadeFonts.h:225-254;
// Blink's DeterminePrimarySimpleFontDataCore, font_fallback_list.cc:88-143). Canvas can't tell
// a family that gives no font from one that lacks the character, so the premise is that the
// primary font draws a space, and it is taken as the first family's that does. `-` where the
// generic families measure alike, which tells nothing, or the font string has no size in px.
// What the premise gets wrong (ENGINE_FOLLOWUPS.md, Line edges): a first family whose font
// has no space, an icon font, is skipped where the engines take it; a family split into faces
// by unicode-range is asked whole, where the engines ask only the face that holds the space;
// and where no listed family gives a font the answer is `-`, where the engines ask their
// last-resort font.
export function getHyphenText(measurement: FontMeasurement): string {
  if (measurement.hyphenText !== null) return measurement.hyphenText
  const font = measurement.canvasFont
  const size = fontSizeRe.exec(font)
  let hyphenText = '-'
  if (size !== null && getSegmentMetrics('\u2010', measurement).width !== getSegmentMetrics('-', measurement).width) {
    const context = measurement.state.context
    const start = size.index + size[0].length
    const prefix = font.slice(0, start)
    const families = font.slice(start).match(familyRe) ?? []
    const monospace = prefix + 'monospace'
    const serif = prefix + 'serif'
    if (measureIn(context, monospace, ' ') !== measureIn(context, serif, ' ') && measureIn(context, monospace, '\u2010') !== measureIn(context, serif, '\u2010')) {
      for (let i = 0; i < families.length; i++) {
        const beforeMonospace = `${prefix}${families[i]}, monospace`
        const beforeSerif = `${prefix}${families[i]}, serif`
        if (measureIn(context, beforeMonospace, ' ') !== measureIn(context, beforeSerif, ' ')) continue
        if (measureIn(context, beforeMonospace, '\u2010') === measureIn(context, beforeSerif, '\u2010')) hyphenText = '\u2010'
        break
      }
    }
    context.font = font
  }
  measurement.hyphenText = hyphenText
  return hyphenText
}

function measureIn(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, font: string, text: string): number {
  context.font = font
  return context.measureText(text).width
}

// The language setLocale() gave, which preparation reads in place of the page's,
// or undefined.
let localeLanguage: string | undefined

export function setLocaleLanguage(locale: string | undefined): void {
  localeLanguage = locale
}

// The language one preparation breaks and measures under, read once: setLocale()'s, or
// else the page's, or null without a document. The Chromium profile lays out a page
// without one under Blink's default locale (laysOutUnderDefaultLocale).
export function getPreparationLanguage(profile: EngineProfile): string | null {
  let language = localeLanguage ?? null
  if (localeLanguage === undefined && typeof document !== 'undefined') {
    const lang = (document.documentElement as HTMLElement | null | undefined)?.lang
    if (typeof lang === 'string') language = lang
  }
  return language === '' && profile.laysOutUnderDefaultLocale ? getBlinkDefaultLocale() : language
}

// The most app units a Gecko length holds (nscoord_MAX, nsCoord.h:28).
const MAX_APP_UNITS = (1 << 30) - 1

// A text's letter spacing in CSS px as the engine lays it out, 0 by default. CSS and
// Canvas ignore a non-finite one, which Pretext refuses rather than guess at. Gecko's
// whole app units are the float32 times 60, rounded half away from zero and clamped
// (DefaultLengthToAppUnits, ServoStyleConstsInlines.h:584-595), and a spacing that
// rounds to none keeps the text's ligatures (nsLayoutUtils.cpp:6896-6904).
export function readLetterSpacing(letterSpacing: number | undefined, profile: EngineProfile): number {
  const value = letterSpacing ?? 0
  if (!Number.isFinite(value)) throw new RangeError(`letterSpacing must be a finite number of CSS px, not ${value}`)
  if (!profile.letterSpacingInAppUnits) return value
  const units = Math.fround(Math.fround(value) * 60)
  return Math.min(Math.round(Math.abs(units)), MAX_APP_UNITS) * Math.sign(units) / 60
}

// A zero per segment, where per-segment widths start, pushed in a loop: Array.from over
// `{ length }` reads every index off the object and calls its map function for each.
export function zeros(count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(0)
  return out
}

// A direct measurement under letter spacing, borrowing the font's context for the
// synchronous call. It never enters a segment cache, and letterSpacing is restored
// even when assignment or measurement fails. Null where the context can't take the
// spacing.
export function measureWithLetterSpacing(text: string, letterSpacing: number, emojiCorrection: number, measurement: FontMeasurement): number | null {
  const { context, takesLetterSpacing } = measurement.state
  if (!takesLetterSpacing) return null
  // Counted before the spacing is set: the count measures stretches into the font's segment cache.
  const corrected = emojiCorrection === 0 ? 0 : countEmojiGlyphs(text, measurement) * emojiCorrection
  const previous = context.letterSpacing
  try {
    context.letterSpacing = `${letterSpacing}px`
    if (Number.parseFloat(context.letterSpacing) !== letterSpacing) return null
    const width = context.measureText(text).width - corrected
    return Number.isFinite(width) ? width : null
  } finally {
    context.letterSpacing = previous
  }
}

// The lookup is the first to hash seg and internalizes it, so V8 hands Canvas a Latin-1
// segment one-byte, which Chrome measures as Latin (RESEARCH.md, Keeping Work Bounded,
// String Storage).
export function getSegmentMetrics(seg: string, measurement: FontMeasurement): SegmentMetrics {
  return measurement.metrics.get(seg) ?? addMetrics(measurement.metrics, seg, seg, measurement)
}

// Metrics of seg measured together with one following U+0020.
export function getFollowingSpaceMetrics(seg: string, measurement: FontMeasurement): SegmentMetrics {
  return measurement.followingSpaceMetrics.get(seg) ?? addMetrics(measurement.followingSpaceMetrics, seg, seg + ' ', measurement)
}

function addMetrics(cache: Map<string, SegmentMetrics>, seg: string, text: string, measurement: FontMeasurement): SegmentMetrics {
  const metrics: SegmentMetrics = { width: measurement.state.context.measureText(text).width, emojiCount: -1, fit: null, spaceKerning: null }
  cache.set(seg, metrics)
  return metrics
}

// The kerning of every segment that takes none.
export const noSpaceKerning: SpaceKerning = { after: 0, before: 0 }

function isKanaLetter(code: number): boolean {
  return (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa)
}

// Whether a character is a kana or an ideograph, which Canvas shapes as a word of its own: it
// cuts a string before one that follows another, and keeps with a letter the marks and CJK
// punctuation after it (NextWordEndIndex, plain_text_node.cc:92-153, over
// kIsCjkIdeographOrSymbolRanges, character_property_data.h:40-80, of which these are the
// letters).
export function isCanvasWordLetter(code: number): boolean {
  return isKanaLetter(code) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
}

// Whether a character takes no kerning with a space, and Canvas isn't asked.
function takesNoSpaceKerning(code: number): boolean {
  // A combining mark or half of a surrogate pair is part of a longer cluster. Canvas shows no
  // kerning beside a letter it shapes as a word of its own.
  return hasProperty(code, MARK) || (code & 0xf800) === 0xd800 || isCanvasWordLetter(code) ||
    // Premise: no font kerns a Hangul syllable with the space (RESEARCH.md, Kerning At Line Edges).
    (code >= 0xac00 && code <= 0xd7a3)
}

// What is kept of the font's kerning with the space glyph, or null for a font that has none:
// one in which U+2028 before, between and after the printable ASCII characters is as wide with
// kerning off. `fontKerning = 'none'` turns the `kern` feature off
// (FontFeatureRange::FromFontDescription, font_features.cc:39-47), and with it HarfBuzz's
// kerning from GPOS, `kern` and `kerx` (hb-ot-shape.cc:127-131, hb-ot-kern-table.hh:67). Asked
// once per font. Premise: a font that kerns no printable ASCII character with the space kerns
// nothing with it (RESEARCH.md, Kerning At Line Edges, has the fonts that do).
export function getFontSpaceKerning(measurement: FontMeasurement): FontSpaceKerning | null {
  if (measurement.spaceKerning === undefined) {
    const context = measurement.state.context
    let probe = '\u2028'
    for (let code = 0x21; code <= 0x7e; code++) probe += String.fromCharCode(code) + '\u2028'
    const kerned = context.measureText(probe).width
    context.fontKerning = 'none'
    const unkerned = context.measureText(probe).width
    context.fontKerning = 'auto'
    // Where U+2028 alone doesn't measure as the space, it doesn't stand for it.
    measurement.spaceKerning = kerned !== unkerned && context.measureText('\u2028').width === getSegmentMetrics(' ', measurement).width ? { after: new Map(), before: new Map() } : null
  }
  return measurement.spaceKerning
}

// A character's kerning with a space glyph after it, or before it: the two in one string, with
// U+2028 for the space, less each alone. Asked of Canvas once per font and side.
function getCharacterSpaceKerning(code: number, spaceFirst: boolean, measurement: FontMeasurement, font: FontSpaceKerning): number {
  const kernings = spaceFirst ? font.before : font.after
  let kerning = kernings.get(code)
  if (kerning === undefined) {
    kerning = 0
    if (!takesNoSpaceKerning(code)) {
      const character = String.fromCharCode(code)
      const pairWidth = measurement.state.context.measureText(spaceFirst ? '\u2028' + character : character + '\u2028').width
      kerning = pairWidth - getSegmentMetrics(character, measurement).width - getSegmentMetrics(' ', measurement).width
      // Blink keeps a run's width as a float32 (shape_result.cc:1539-1576), so up to the pair's
      // width / 2^22 is rounding, not kerning (RESEARCH.md, Kerning At Line Edges).
      if (Math.abs(kerning) <= pairWidth / 0x400000) kerning = 0
    }
    kernings.set(code, kerning)
  }
  return kerning
}

// The kerning Blink's layout gives a text segment's edges with a U+0020 beside them
// (EngineProfile.kernsAcrossCanvasWords), read from Canvas with U+2028 for the space: Blink
// draws U+2028 with the space glyph (HarfBuzzGetGlyph, harfbuzz_face.cc:103-113) and its Canvas
// doesn't cut there. Premise: the segment's last and first character stand for the word, past
// default ignorables, which HarfBuzz's lookups pass over, and a first character with a combining
// mark after it takes none (RESEARCH.md, Kerning At Line Edges, has the gaps).
export function getSpaceKerning(seg: string, metrics: SegmentMetrics, measurement: FontMeasurement, font: FontSpaceKerning): SpaceKerning {
  let first = 0
  let last = seg.length - 1
  while (first < last && hasProperty(seg.charCodeAt(first), DEFAULT_IGNORABLE)) first++
  while (last > first && hasProperty(seg.charCodeAt(last), DEFAULT_IGNORABLE)) last--
  const before = first < last && hasProperty(seg.charCodeAt(first + 1), MARK) ? 0 : getCharacterSpaceKerning(seg.charCodeAt(first), true, measurement, font)
  const after = getCharacterSpaceKerning(seg.charCodeAt(last), false, measurement, font)
  return metrics.spaceKerning = after === 0 && before === 0 ? noSpaceKerning : { after, before }
}

// Twelve kana in a row, nine or more of whose eleven pairs kern in each Japanese face measured
// that kerns kana at all (getFontKanaKerning).
const KANA_PROBE = 'プダグタノムブイメえずぺ'

// The font's context for kana: Canvas shapes a string whole, as Blink's layout shapes a run,
// under text-rendering: optimizeLegibility where the lookups of the first font with a space
// cover the space glyph (FontFallbackList::ComputeCanShapeWordByWord, font_fallback_list.cc:264-277),
// as those of the Japanese fonts of macOS do. It is a context of its own: the first measures
// everything else as it did, and a kana alone measures the same on both.
function getWholeRunContext(measurement: FontMeasurement): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const state = measurement.state
  if (state.wholeRunContext === null) {
    state.wholeRunContext = createContext(state.language)
    state.wholeRunContext.textRendering = 'optimizeLegibility'
  }
  if (state.wholeRunFont !== measurement.canvasFont) state.wholeRunContext.font = state.wholeRunFont = measurement.canvasFont
  return state.wholeRunContext
}

// What is kept of the font's kerning between kana, or null for a font that shows none: one in
// which KANA_PROBE, shaped whole, is as wide with kerning off (getFontSpaceKerning has what
// `fontKerning` turns off). That is also a font Canvas doesn't shape whole, whose kana stay as
// wide as Canvas measures them apart. Asked once per font. Premise: a font that kerns kana
// kerns one of the probe's pairs (RESEARCH.md, Kerning At Line Edges, has the fonts measured).
export function getFontKanaKerning(measurement: FontMeasurement): FontKanaKerning | null {
  if (measurement.kanaKerning === undefined) {
    const context = getWholeRunContext(measurement)
    const kerned = context.measureText(KANA_PROBE).width
    context.fontKerning = 'none'
    const unkerned = context.measureText(KANA_PROBE).width
    context.fontKerning = 'auto'
    measurement.kanaKerning = kerned === unkerned ? null : { pairs: new Map(), widens: false }
  }
  return measurement.kanaKerning
}

// The most pairs asked about in one string (getKanaKerning).
const KANA_STRETCH_PAIRS = 6

// What kana in a row kern by in all: the string on the context that shapes it whole, less each
// kana alone. As for a character and a space, up to the string's width / 2^22 is rounding.
function measureKanaKerning(text: string, measurement: FontMeasurement): number {
  const width = getWholeRunContext(measurement).measureText(text).width
  let kerning = width
  for (let i = 0; i < text.length; i++) kerning -= getSegmentMetrics(text[i]!, measurement).width
  return Math.abs(kerning) <= width / 0x400000 ? 0 : kerning
}

// The kerning Blink's layout gives text[at - 1] and text[at], two kana in a row, which its
// Canvas, shaping each apart, doesn't report. Each pair is asked about once per font, and most
// kern nothing (about one in ten of a text's pairs does in Hiragino Sans), so a new pair of
// letters is asked together with the pairs after it in the text that are new too, up to
// KANA_STRETCH_PAIRS: a stretch as wide as its kana alone has no kerning. In one that has, the
// pairs are asked one at a time, until they add up to the stretch's. That holds while every
// kerning tightens its pair. Once a pair has widened, the font's pairs are asked again, each
// alone (RESEARCH.md, Kerning At Line Edges, has what that leaves).
export function getKanaKerning(text: string, at: number, measurement: FontMeasurement, font: FontKanaKerning): number {
  const pairs = font.pairs
  let kerning = pairs.get(text.charCodeAt(at - 1) * 0x10000 + text.charCodeAt(at))
  if (kerning !== undefined) return kerning
  let end = at + 1
  if (!font.widens && isKanaLetter(text.charCodeAt(at - 1)) && isKanaLetter(text.charCodeAt(at))) {
    while (end - at < KANA_STRETCH_PAIRS && isKanaLetter(text.charCodeAt(end)) && !pairs.has(text.charCodeAt(end - 1) * 0x10000 + text.charCodeAt(end))) end++
  }
  // What the stretch's pairs not yet asked alone kern by, where it holds more than one.
  let rest = end - at > 1 ? measureKanaKerning(text.slice(at - 1, end), measurement) : NaN
  kerning = 0
  for (let i = at; i < end; i++) {
    const key = text.charCodeAt(i - 1) * 0x10000 + text.charCodeAt(i)
    // A pair the stretch holds twice is asked once.
    let pair = pairs.get(key)
    if (pair === undefined) {
      pair = rest === 0 && !font.widens ? 0 : measureKanaKerning(text.slice(i - 1, i + 1), measurement)
      if (pair > 0 && !font.widens) {
        font.widens = true
        pairs.clear()
      }
      pairs.set(key, pair)
    }
    if (i === at) kerning = pair
    rest -= pair
  }
  return kerning
}

// A text's width in the font, less the emoji correction.
export function getTextWidth(text: string, measurement: FontMeasurement, emojiCorrection: number): number {
  return getCorrectedSegmentWidth(text, getSegmentMetrics(text, measurement), measurement, emojiCorrection)
}

export type LayoutEngine = 'blink' | 'webkit' | 'gecko'

// Engine profiles describe the layout engine, not the browser brand. Chrome,
// Firefox and Edge on iOS lay out with WebKit whatever their brand token (CriOS/,
// FxiOS/, EdgiOS/) or desktop-mode user agent, and an app's web view may name no
// browser at all. The user agent decides alone, so a page and its workers agree.
// navigator.vendor is not read: workers don't have it, and jsdom reports WebKit's
// beside Chromium's frozen AppleWebKit/537.36 token. WebKit froze 605.1.15, so
// 537.36 names Blink only beside Chrome/ or Chromium/, which Samsung's TV web
// views omit, and any other AppleWebKit/ version names WebKit.
export function getLayoutEngine(userAgent: string): LayoutEngine | null {
  if (userAgent.includes('Firefox/')) return 'gecko'
  if (userAgent.includes('AppleWebKit/537.36')) {
    return userAgent.includes('Chrome/') || userAgent.includes('Chromium/') ? 'blink' : null
  }
  return userAgent.includes('AppleWebKit/') ? 'webkit' : null
}

// Apart from buildEngineProfile(), so that what the line walkers call for every line stays a read
// of the cached profile, however much the profile holds. V8 inlines a function only while its
// bytecode takes at most 460 bytes (max_inlined_bytecode_size), minified or not. With the builder
// inside, this took 454 bytes with 23 fields and 463 with a 24th, which Chrome 154's V8 no longer
// inlined into the line counter and the simple and rich steppers, and its plain line APIs ran
// 11-18% slower. Apart, it takes 21 (Node 23, V8 12.9). Check with node --print-bytecode and
// --trace-turbo-inlining (RESEARCH.md, JavaScript Engines).
export function getEngineProfile(): EngineProfile {
  return cachedEngineProfile ??= buildEngineProfile()
}

function buildEngineProfile(): EngineProfile {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  // Engines Pretext doesn't recognize take Blink's profile (RESEARCH.md, Decisions Log).
  const engine = getLayoutEngine(ua) ?? 'blink'
  // Fresh-entry observations are verified only for desktop Blink and Gecko.
  const isDesktop = /Windows NT|Macintosh|X11/.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/.test(ua)

  return {
    entryFitBasis: isDesktop && engine === 'blink' ? 'fresh' : isDesktop && engine === 'gecko' ? 'original' : 'disabled',
    lineBreakScan: engine,
    graphemeTable: engine === 'webkit' ? 'apple/char' : engine === 'gecko' ? 'gecko/char' : 'chromium/char',
    lineFitEpsilon: engine === 'webkit' ? 1 / 64 : 0.005,
    prefixFitMinWidth: engine === 'webkit' ? 0 : engine === 'gecko' ? 80 : Infinity,
    measureTextWithFollowingSpace: engine === 'webkit',
    kernsAcrossCanvasWords: engine === 'blink',
    letterSpaceDiscretionaryHyphen: engine !== 'blink',
    letterSpacingInAppUnits: engine === 'gecko',
    canvasLetterSpacingDropsLigatures: engine !== 'webkit',
    unspacedCursive: engine === 'blink' ? 'run' : engine === 'gecko' ? 'cluster' : 'none',
    shapesMarksAcrossSoftHyphen: engine === 'blink',
    unfitHyphenRetreat: engine === 'blink' ? 'reduced-width' : engine === 'gecko' ? 'full-width' : 'full-width-or-first',
    hyphenFromPrimaryFont: engine !== 'gecko',
    letterSpaceTabStops: engine !== 'webkit',
    letterSpaceTabs: engine === 'webkit',
    tabMinimumCharacter: engine === 'gecko' ? '0' : ' ',
    tabsInAppUnits: engine === 'gecko',
    hangTabs: engine !== 'gecko',
    zeroWidthGlueTakesLine: engine !== 'gecko',
    keepsLineStartPunctuation: engine === 'webkit',
    hidesControlCharacters: engine === 'gecko',
    hanKerning: engine === 'blink',
    hangsIdeographicSpace: engine !== 'webkit',
    laysOutUnderDefaultLocale: engine === 'blink',
    namesGenericFamiliesByLanguage: engine === 'webkit',
    spaceBeforeSoftHyphenHangs: engine === 'gecko' ? 'line-end' : engine === 'webkit' ? 'own-break' : 'break',
    collapsesSpaceAcrossSoftHyphens: engine === 'gecko',
    breaksFromItemText: engine === 'webkit',
    hardBreakItemRetreat: engine === 'blink' ? 'item' : engine === 'webkit' ? 'fit' : 'last-grapheme',
    paddedOpeningFit: engine === 'blink' ? 'start' : engine === 'webkit' ? 'placed' : 'both',
    emptyAtomicAlwaysFits: engine === 'gecko',
    hangsSpacesPerTextFrame: engine === 'gecko',
    transformsSegmentBreaksAcrossItems: engine === 'blink',
  }
}

export function parseFontSize(font: string): number {
  // A failed size can restart at the next digit run, not at every digit in it.
  const m = font.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

export function textMayContainEmoji(text: string): boolean {
  return maybeEmojiRe.test(text)
}

export function getEmojiCorrection(font: string, measurement: FontMeasurement): number {
  let correction = measurement.emojiCorrection
  if (correction !== null) return correction

  const fontSize = parseFontSize(font)
  const canvasW = measurement.emojiWidth = measurement.state.context.measureText('\u{1F600}').width
  correction = 0
  // document.body is null until the parser reaches <body>, which lib.dom's type leaves out.
  if (
    canvasW > fontSize + 0.5 &&
    typeof document !== 'undefined' &&
    (document.body as HTMLElement | null) !== null
  ) {
    const span = document.createElement('span')
    span.style.font = font
    span.style.display = 'inline-block'
    span.style.visibility = 'hidden'
    span.style.position = 'absolute'
    span.textContent = '\u{1F600}'
    document.body.appendChild(span)
    const domW = span.getBoundingClientRect().width
    document.body.removeChild(span)
    if (canvasW - domW > 0.5) {
      correction = canvasW - domW
    }
  }
  measurement.emojiCorrection = correction
  return correction
}

// Canvas reports a width as a 32-bit float (CanvasRenderingContext2D.cpp:5277 in Firefox,
// text_metrics.cc:179 in Chrome), so a few equal advances measure that many times one
// only within that float's rounding, 2^-24 of the width each time one is rounded: 2e-6 px
// over three emoji of a bold font in Firefox 156. Sixteen roundings are allowed for, a
// window far finer than the steps a font's advances come in (RESEARCH.md, Content
// Language And Fonts).
const CANVAS_WIDTH_ROUNDING = 2 ** -20

// How many glyphs of the emoji font draw a text: the emoji font gives every glyph one
// advance, the probe's, so text it draws measures a whole number of them, and none
// where it measures anything else.
function getEmojiGlyphs(text: string, measurement: FontMeasurement): number {
  const width = getSegmentMetrics(text, measurement).width
  const glyphs = Math.round(width / measurement.emojiWidth)
  return Math.abs(width - glyphs * measurement.emojiWidth) <= width * CANVAS_WIDTH_ROUNDING ? glyphs : 0
}

// The characters the emoji font shapes together inside a grapheme: emoji and pictographs,
// the characters that join or modify them (ZWJ, skin tones, tags, U+20E3) and the
// variation selectors. Every emoji character has one of the two properties. A grapheme
// of emojiGraphemeRe holds one.
const emojiStretchRe = /[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0E]+/gu

// The glyphs of the emoji font in a text: what the correction is subtracted for, once
// each. Font fallback decides which font draws an emoji character, and Canvas shows what
// it decided, at one cached Canvas call per distinct stretch of a font. For a character
// with no selector, the named font's own glyph comes before the emoji font's
// (CheckCandidate, gfxTextRun.cpp:3350-3359; FontFallbackIterator::Next,
// font_fallback_iterator.cc:166-178), and U+FE0E asks for a text font
// (gfxTextRun.cpp:3270-3273; SymbolsIterator::Consume, symbols_iterator.cc:67-71). So a
// stretch with a glyph of another font measures as the page draws it: Menlo's own
// U+26A1, Inter's U+2B1C, Hiragino Sans's U+26AA, or U+231A before U+FE0E. A pictograph
// whose presentation is text by default takes the correction with no U+FE0F where only
// the emoji font has it, as U+1F336 in Arial. Two or more glyphs are a sequence the
// emoji font has no glyph for, drawn as its parts.
//
// Each stretch of emoji characters is asked whole, and apart from the rest of its
// grapheme, since each font shapes its own characters together: Firefox matches a font
// character by character (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3194), and
// Chrome ends a run where emoji give way to text before it shapes
// (RunSegmenter::Consume, run_segmenter.cc:44-73, over SymbolsIterator::Consume,
// symbols_iterator.cc:34-79). So an emoji, a sequence or a flag before a combining mark
// of another script is still one glyph. A stretch that two fonts draw takes no
// correction, as a text font's pictograph joined by a ZWJ to an emoji in Firefox, and a
// stretch asked apart can be another font's than inside its grapheme, as a skin tone
// after a letter in Chrome.
//
// Those and the other gaps are in ENGINE_FOLLOWUPS.md, Emoji correction: another font's
// glyph exactly as wide as an emoji takes the correction, as does Firefox's box for a
// missing glyph at 13px, and an emoji font whose advances vary would take none.
function countEmojiGlyphs(text: string, measurement: FontMeasurement): number {
  const ends = new Int32Array(text.length)
  const graphemeCount = findGraphemeEnds(getEngineProfile().graphemeTable, text, 0, text.length, ends)
  let count = 0
  for (let i = 0, start = 0; i < graphemeCount; start = ends[i++]!) {
    const grapheme = text.slice(start, ends[i])
    if (!emojiGraphemeRe.test(grapheme)) continue
    const stretches = grapheme.match(emojiStretchRe)!
    for (let s = 0; s < stretches.length; s++) count += getEmojiGlyphs(stretches[s]!, measurement)
  }
  return count
}

export function getCorrectedSegmentWidth(seg: string, metrics: SegmentMetrics, measurement: FontMeasurement, emojiCorrection: number): number {
  if (emojiCorrection === 0) return metrics.width
  if (metrics.emojiCount < 0) metrics.emojiCount = countEmojiGlyphs(seg, measurement)
  return metrics.width - metrics.emojiCount * emojiCorrection
}

export function getSegmentFit(
  seg: string,
  metrics: SegmentMetrics,
  measurement: FontMeasurement,
  emojiCorrection: number,
  mode: BreakableFitMode,
  // When metrics measured seg together with one following U+0020, the width of
  // that space alone. The last grapheme then keeps its kerning with the space.
  followingSpaceWidth: number | null = null,
  // Whether to find the segment's WebKit line-start prohibitions.
  withLineStartProhibitions = false,
): SegmentFit {
  if (metrics.fit !== null && metrics.fit.mode === mode) return metrics.fit
  const ends = new Int32Array(seg.length)
  const count = findGraphemeEnds(getEngineProfile().graphemeTable, seg, 0, seg.length, ends)
  if (count <= 1) return metrics.fit = { mode, advances: null, lineStartProhibitions: null, entryGeometry: null }
  let prohibitions: Uint8Array | null = null
  if (withLineStartProhibitions) {
    for (let i = 1; i < count; i++) if (!canWebKitLineStartWith(seg.charCodeAt(ends[i - 1]!))) (prohibitions ??= new Uint8Array(count))[i] = 1
  }
  // Prefix widths, or each grapheme alone or after the one before it. Past
  // MAX_PREFIX_FIT_GRAPHEMES, prefixes give way to pairs.
  const prefixes = mode === 'segment-prefixes' && count <= MAX_PREFIX_FIT_GRAPHEMES
  const pairs = mode !== 'sum-graphemes' && !prefixes
  const advances: number[] = []
  let previousStart = 0
  let previousWidth = 0
  for (let i = 0, start = 0; i < count; start = ends[i++]!) {
    const end = ends[i]!
    if (prefixes) {
      // The whole segment is the last prefix; with a following space it was
      // measured together with that space.
      const width = followingSpaceWidth !== null && i === count - 1
        ? getCorrectedSegmentWidth(seg, metrics, measurement, emojiCorrection) - followingSpaceWidth
        : getTextWidth(seg.slice(0, end), measurement, emojiCorrection)
      advances.push(width - previousWidth)
      previousWidth = width
      continue
    }
    const width = getTextWidth(seg.slice(start, end), measurement, emojiCorrection)
    advances.push(pairs && i > 0 ? getTextWidth(seg.slice(previousStart, end), measurement, emojiCorrection) - previousWidth : width)
    previousStart = start
    previousWidth = width
  }
  // Advances that do not end in the whole segment's width take the kerning as a
  // difference, which needs the segment measured alone too.
  if (followingSpaceWidth !== null && !prefixes) {
    advances[count - 1] = advances[count - 1]! + metrics.width - getSegmentMetrics(seg, measurement).width - followingSpaceWidth
  }
  return metrics.fit = { mode, advances, lineStartProhibitions: prohibitions, entryGeometry: null }
}

// What preparation measures a font's text through, with the context set to measure it.
// Text under letter spacing has a measurement of its own where the context shapes it as
// the page does: its widths, prefixes and line-edge facts all come from that shaping.
export function getFontMeasurement(font: string, language: string | null, letterSpaced: boolean): FontMeasurement {
  // Preparation starts here, with the language it resolved. After that language
  // changes, start again with a new context and empty caches; clearing the caches
  // alone would re-measure with fonts resolved under the old language.
  if (measureState === null || measureState.language !== language) measureState = createMeasureState(language)
  const state = measureState
  const shaped = letterSpaced && state.shapesLetterSpaced
  const fonts = shaped ? state.letterSpacedFonts : state.fonts
  let measurement = fonts.get(font)
  if (measurement === undefined) {
    const canvasFont = state.genericFamilies === null ? font : getCanvasFont(font, state.genericFamilies)
    measurement = { state, canvasFont, metrics: new Map(), followingSpaceMetrics: new Map(), spaceKerning: undefined, kanaKerning: undefined, emojiCorrection: null, emojiWidth: 0, hyphenText: null, hanKerning: undefined }
    fonts.set(font, measurement)
  }
  state.context.font = measurement.canvasFont
  if (state.letterSpaced !== shaped) {
    state.context.letterSpacing = shaped ? LETTER_SPACED_SHAPING : '0px'
    state.letterSpaced = shaped
  }
  return measurement
}

// A context's `lang` follows the page's, and preparation's can be setLocale()'s or Blink's
// default locale instead.
function createContext(language: string | null): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (typeof OffscreenCanvas !== 'undefined') {
    context = new OffscreenCanvas(1, 1).getContext('2d')!
  } else if (typeof document !== 'undefined') {
    context = document.createElement('canvas').getContext('2d')!
  } else {
    throw new Error('Text measurement requires OffscreenCanvas or a DOM canvas context.')
  }
  if (language !== null && 'lang' in context) context.lang = language
  return context
}

function createMeasureState(language: string | null): MeasureState {
  const context = createContext(language)
  const profile = getEngineProfile()
  const takesLetterSpacing = typeof context.letterSpacing === 'string'
  return {
    language,
    context,
    wholeRunContext: null,
    wholeRunFont: '',
    genericFamilies: language !== null && profile.namesGenericFamiliesByLanguage ? getWebKitGenericFamilies(language, context) : null,
    takesLetterSpacing,
    shapesLetterSpaced: takesLetterSpacing && profile.canvasLetterSpacingDropsLigatures,
    letterSpaced: false,
    fonts: new Map(),
    letterSpacedFonts: new Map(),
  }
}

export function clearMeasurementCaches(): void {
  measureState?.fonts.clear()
  measureState?.letterSpacedFonts.clear()
}
