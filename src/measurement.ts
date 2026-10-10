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
  // With advances, per grapheme, what a line that starts with it adds to its advance, where
  // the engine shapes such a line again (the 'reshaped-lines' mode). Null where nothing.
  lineStartExtras: number[] | null
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
  // doesn't recognize take Blink's scan. A rich-inline paragraph's text is scanned as the
  // engine scans its inline items (analyzeText in src/analysis.ts). Blink runs one line-break
  // iterator over the text of the whole inline formatting context, and Gecko collects a word
  // across text frames until a space and breaks it in one pass, so every break near an item
  // boundary comes from the text the items join. WebKit finds breaks inside each inline box
  // from that box's own text, and decides a boundary between boxes from the previous box's
  // last two characters (TextUtil.cpp:374-396); it also finds a break next to every
  // white-space item, so before preserved white space that starts an item
  // (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:406-418), and its soft wrap index loop
  // ends the content it places after a line break item, so no break comes before one at any
  // boundary, after an atomic item too (nextWrapOpportunity, InlineFormattingUtils.cpp:469-475).
  lineBreakScan: 'blink' | 'webkit' | 'gecko'
  // Where grapheme clusters end: the engine's ICU character rules (src/graphemes.ts).
  // libicucore's add Apple's transcoding hints to Extend. Firefox's ICU4X data gives the
  // clusters Chrome's rules give, over its text run, which leaves out bidi controls.
  graphemeTable: GraphemeTable
  // What a line may overflow its width by and still fit: WebKit's own 1/64 px, which availableWidth()
  // adds (InlineLineBuilder.cpp:1172-1183). Blink and Gecko fit exactly in their own units, so their
  // 0.005 px is a named gap (ENGINE_FOLLOWUPS.md, Fitting arithmetic).
  lineFitEpsilon: number
  // How a segment is fit where a line narrower than it cuts it between letters, from Canvas
  // questions about the word (getSegmentFit). WebKit measures the word's grapheme prefixes
  // (TextUtil::breakWord), and Gecko adds the advances of the word shaped whole
  // (gfxTextRun::BreakAndMeasureText), which prefixes follow in joined scripts where
  // standalone graphemes don't: 'segment-prefixes' for both, which is WebKit's rule for a word
  // cut once and neither engine's rule otherwise (ENGINE_FOLLOWUPS.md, Emergency breaks inside
  // a word).
  // Blink reads positions from the word shaped whole and shapes a line's start and end again
  // wherever HarfBuzz calls the cut unsafe, as between two kerned or two joined letters
  // (ShapingLineBreaker::ShapeLine, shaping_line_breaker.cc:304-324, 511-584), so kerning
  // across a cut is on neither side and a line is as wide as its text shaped alone:
  // 'reshaped-lines'.
  cutWordFit: 'segment-prefixes' | 'reshaped-lines'
  // The least width from which a segment takes that fit; a narrower one adds up its graphemes
  // measured alone. A segment breaks only on a line narrower than itself, so every line at
  // least this wide gets the engine's fit, and WebKit's is every segment's. Gecko's and
  // Blink's 80px is a premise, not a browser rule: the fit costs Canvas calls for each new
  // word, most of the calls a lower floor adds are in words 24-80px wide, and taking them
  // from 24px or everywhere fixed adversarial lines at 24-80px but made Firefox prepare new
  // text much slower (RESEARCH.md, Break Opportunities From Engine Data; Decisions Log,
  // 2026-09-27 and 2026-10-05).
  prefixFitMinWidth: number
  // Gecko shapes a word once, whole, and never again (gfxTextRun::SetLineBreaks does nothing,
  // gfxTextRun.cpp:1292-1301), so a line adds up the advances its letters have in that one
  // shaping wherever it starts. A ligature's whole advance is on its first letter and none on
  // the rest (GetAdvanceForGlyph, gfxTextRun.cpp:1139-1151), so a line ends inside a ligature
  // only where the ligature starts the line and doesn't fit. Blink and WebKit shape or measure
  // a line from its own start, where the letters of a ligature cut in two each have a glyph.
  // The Gecko profile follows it in the words it fits from prefixes
  // (countLigaturesOnFirstLetter). The kerning those advances keep at a cut isn't ported
  // (ENGINE_FOLLOWUPS.md, Emergency breaks inside a word).
  cutWordKeepsLigatures: boolean
  // WebKit measures a text item together with a directly following U+0020 and
  // subtracts one unshaped space, so the item keeps its kerning with that space
  // wherever the line ends. Gecko shapes words without their spaces.
  measureTextWithFollowingSpace: boolean
  // Blink's layout shapes each run of one script and direction in one call, its spaces
  // included (HarfBuzzShaper::Shape, harfbuzz_shaper.cc:1063-1104), so in a font whose kerning
  // names the space glyph a word kerns with the space after it and a space with the word after
  // it. Its Canvas cuts a string at each U+0020 and reports neither (PlainTextNode::SegmentWord,
  // plain_text_node.cc:365-399), so preparation asks Canvas for it (getSpaceKerning).
  kernsSpacesInScriptRun: boolean
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
  // item against the width minus the hyphen (BreakText, line_breaker.cc:1705-1718,
  // Chromium 153), so the line ends at the latest earlier opportunity that leaves
  // room for it, whatever gives it: a space, a ZWSP, a soft hyphen, or a break
  // between two text segments, as after `-` or between ideographs. For a text
  // Pretext has no Blink item boundaries and applies the reduced width to every
  // earlier opportunity. A rich-inline paragraph takes each of its items for a
  // Blink item, so the break before an item's first segment leaves no such room
  // (getHyphenRooms in src/rich-inline.ts).
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
  // element, whose contexts force style updates (RESEARCH.md, Decisions Log, 2026-09-24).
  namesGenericFamiliesByLanguage: boolean
  // Release Gecko draws C0 and C1 controls, U+2028 and U+2029 with no advance plus letter
  // spacing (gfxFont.cpp:3877-3892), where its Canvas measures VT, FS-US, NEL and U+2029 as a
  // space (CanvasRenderingContext2D.cpp:4634-4637) and other controls as a hexbox. Chrome and
  // Safari give most controls an advance on the page, as their Canvas does.
  hidesControlCharacters: boolean
  // Where a rich-inline line that has no break to return to ends when a padded item that starts
  // with a hard break, with none before it, doesn't fit its padding as the engine fits it there
  // (paddedOpeningFit; walkPreparedComplexLines in src/line-break.ts). Blink's retry of an overflowing
  // line breaks between any two graphemes (kBreakCharacter, line_breaker.cc:4258-4264,
  // 4620-4622), so the line ends before the item ('item'). Gecko's wrap opportunities come
  // before each cluster inside a text frame, none at its end (gfxTextRun.cpp:1046-1101), so the
  // line ends before the last grapheme of the text before the item, a preserved space too,
  // and keeps the item where that grapheme starts the line ('last-grapheme'). WebKit breaks the last run of the content that
  // doesn't fit where that run fits, TextUtil::breakWord in an overflowing run, else before the
  // last character of one that no text run follows (InlineContentBreaker.cpp:611-651), so it
  // ends the line there too, but after the preserved spaces that fit where the spaces that end
  // the text overflow the line, as spaces that hang can ('fit'). `Unbreakable`, then a span with
  // 20px of padding that starts with a line feed, in 15px Helvetica Neue at 93px; `Unbreakabl`,
  // a bold `e` and that span at 86-106px, which moves the `e`; and `Unbreakable   ` and that span
  // at 86-103px, which moves the last space in Firefox and in Safari the spaces that don't fit,
  // all three at 86px.
  hardBreakItemRetreat: 'item' | 'last-grapheme' | 'fit'
  // Which edges of a padded rich-inline item a line fits where the line takes the item's
  // opening and no more of it: a hard break or a zero-width space that starts the item, or
  // white space that starts it after an atomic item, and in Blink anywhere (getOpeningFit in
  // src/rich-inline.ts); the line paints both edges whatever it fitted. Blink adds a span's
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
  // its end, which only a frame that always fits is left to show, and it goes back to a break
  // before the item where a frame with a width that continues the text comes next
  // (setEmptyObjectFacts in src/rich-inline.ts). Blink and WebKit fit it as any other atomic
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
  // Whether a soft hyphen that ends a rich-inline item right before an atomic item or a box needs
  // room for its hyphen to end the line. Blink tests the hyphen where it places the text item
  // that ends at the soft hyphen (SetBreakOffset, shaping_line_breaker.cc:211-216;
  // line_breaker.cc:1705-1718), and Gecko's soft-hyphen break fits only with its hyphen
  // (gfxTextRun.cpp:1086-1089; nsTextFrame.cpp:11432-11440). WebKit adds a soft hyphen's width
  // to the content it places only where nothing but text follows the soft hyphen inside that
  // content (setTrailingSoftHyphenWidth, InlineLineBuilder.cpp:1154-1165), which the closing
  // tag of a span that ends with one does, and tests the hyphen again only once content that
  // starts with text wraps after it (hasLeadingTextContent, InlineContentBreaker.cpp:41-50,
  // 113-121), which a box isn't: the hyphen is never tested there, and the line that ends at
  // it paints it past its width.
  testsHyphenBeforeAtomic: boolean
  // Blink transforms segment breaks in the text of the whole inline formatting context
  // (ShouldRemoveNewline and RemoveTrailingCollapsibleNewlineIfNeeded, inline_items_builder.cc).
  // Gecko transforms each text frame's own text (nsTextFrameUtils::TransformText), as
  // rich-inline transforms an item's, and WebKit turns segment breaks into spaces.
  transformsSegmentBreaksAcrossItems: boolean
}

export type BreakableFitMode = 'sum-graphemes' | 'segment-prefixes' | 'pair-context' | 'reshaped-lines'

// The measurement context and what preparation measured through it. Canvas resolves
// fonts under the context's language, the page's unless the context has a `lang` to
// give it preparation's. Chrome keeps a resolved font while its font string is
// unchanged, so the context, and every width measured through it, belong to the
// language it was created under: all of it is replaced when that language changes.
type MeasureState = {
  language: string | null
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D // Once made, read through getContext() alone
  font: string // The font getContext() set the context to since a font was last looked up, or ''
  letterSpacing: string // The letterSpacing getContext() last set the context to
  genericFamilies: string[] | null // The families the language gives the generic keywords, or null
  takesLetterSpacing: boolean // As Chrome's and Firefox's contexts do, as a string of CSS px
  // Whether the context shapes text under LETTER_SPACED_SHAPING as the page shapes text
  // under letter spacing, without its optional ligatures: it takes a letterSpacing and
  // the engine's Canvas turns them off under one (canvasLetterSpacingDropsLigatures).
  shapesLetterSpaced: boolean
  fonts: Map<string, FontMeasurement>
  // What letter-spaced text measures in each font where shapesLetterSpaced: the same text
  // shaped without its optional ligatures.
  letterSpacedFonts: Map<string, FontMeasurement>
}
let measureState: MeasureState | null = null
// What preparation keeps per font. It all goes together, when the caches clear or the
// language changes.
export type FontMeasurement = {
  state: MeasureState // Its context, which getContext() sets to the font and its shaping
  // The font Canvas is given: the declared font, with the generic keywords the context's
  // language names replaced by their families.
  canvasFont: string
  letterSpacing: string // The Canvas letterSpacing its text is shaped under: LETTER_SPACED_SHAPING or none
  metrics: Map<string, SegmentMetrics>
  // Metrics of a text item measured together with one following U+0020, keyed by
  // the item alone. The width includes that space.
  followingSpaceMetrics: Map<string, SegmentMetrics>
  // In the Chromium profile, null for a font that kerns nothing with the space glyph, asked for
  // the first text with a space (getFontSpaceKerning). Otherwise each character's kerning with a
  // space glyph after it, keyed by its code unit << 1, and with one before it, by that | 1, once
  // a segment has the character at that edge (getSpaceKerning).
  spaceKerning: Map<number, number> | null | undefined
  emojiCorrection: number | null // Probed for the first text that may hold emoji
  emojiWidth: number // Canvas's width of one glyph of the emoji font, measured with the correction
  hyphenText: string | null // Asked for the first text with a soft hyphen (getHyphenText)
  spaceWidth: number | null // The space's width, which every text asks for, kept from the first (getSpaceWidth)
  hanKerning: HanKerningFontData | null | undefined // Read for the first text that may kern
  ligaturePairs: Map<string, boolean> // Whether two neighbouring graphemes are a ligature, once asked (isLigature)
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
    const context = getContext(measurement)
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

// `count` zeros, where a list of numbers per segment starts: a copy of one list of zeros, which
// grows to the longest asked for, up to 1024. A copy is one allocation, where zeros pushed one at
// a time regrow the list as it fills: a list of 127 costs 18 ns copied and 141 pushed in V8's
// shell, 44 and 293 in SpiderMonkey's, 59 and 204 in JavaScriptCore's (RESEARCH.md, Keeping Work
// Bounded, JavaScript Engines, under A paragraph's sparse lists made whole). A longer list is
// pushed in a loop: Array.from over `{ length }` reads every index off the object and calls its
// map function for each.
const ZEROS: number[] = []
export function zeros(count: number): number[] {
  if (count > 1024) {
    const out: number[] = []
    for (let i = 0; i < count; i++) out.push(0)
    return out
  }
  while (ZEROS.length < count) ZEROS.push(0)
  return ZEROS.slice(0, count)
}

// A text's width as Canvas spaces it under a letter spacing, or null where the context
// can't take the spacing. Under none, that is the text's width in the font, which the
// font's segment cache asks once. Under a spacing it is asked each time, borrowing the
// font's context for the synchronous call, never enters a segment cache, and
// letterSpacing is restored even when assignment or measurement fails.
export function measureWithLetterSpacing(text: string, letterSpacing: number, emojiCorrection: number, measurement: FontMeasurement): number | null {
  if (!measurement.state.takesLetterSpacing) return null
  if (letterSpacing === 0) return getTextWidth(text, measurement, emojiCorrection)
  // Counted before the spacing is set: the count measures stretches into the font's segment cache.
  const corrected = emojiCorrection === 0 ? 0 : countEmojiGlyphs(text, measurement) * emojiCorrection
  const context = getContext(measurement)
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

// The lookup internalizes seg, and a string V8 hashes for the first time there gets a one-byte
// copy where its units fit, so Canvas is handed a Latin-1 segment one-byte, which Chrome measures
// as Latin (RESEARCH.md, Keeping Work Bounded, String Storage). A segment cut from a longer text
// is a new string, so the lookup is its first hash. A text that is one segment is the caller's
// own string, since a slice of a whole string is that string, and so is a rich item that is one
// segment (prepareRichInline() in src/rich-inline.ts): a two-byte one that something hashed
// before without internalizing it, as a RegExp made from it does, stays two-byte.
export function getSegmentMetrics(seg: string, measurement: FontMeasurement): SegmentMetrics {
  return measurement.metrics.get(seg) ?? addMetrics(measurement.metrics, seg, seg, measurement)
}

// Metrics of seg measured together with one following U+0020.
export function getFollowingSpaceMetrics(seg: string, measurement: FontMeasurement): SegmentMetrics {
  return measurement.followingSpaceMetrics.get(seg) ?? addMetrics(measurement.followingSpaceMetrics, seg, seg + ' ', measurement)
}

function addMetrics(cache: Map<string, SegmentMetrics>, seg: string, text: string, measurement: FontMeasurement): SegmentMetrics {
  const metrics: SegmentMetrics = { width: getContext(measurement).measureText(text).width, emojiCount: -1, fit: null, spaceKerning: null }
  cache.set(seg, metrics)
  return metrics
}

// The kerning of every segment that takes none.
export const noSpaceKerning: SpaceKerning = { after: 0, before: 0 }

// Whether a character takes no kerning with a space, and Canvas isn't asked.
function takesNoSpaceKerning(code: number): boolean {
  // A combining mark or half of a surrogate pair is part of a longer cluster.
  return hasProperty(code, MARK) || (code & 0xf800) === 0xd800 ||
    // Canvas shapes each ideograph and kana as a word of its own, so it shows no kerning beside
    // one (NextWordEndIndex, plain_text_node.cc:92-153, over kIsCjkIdeographOrSymbolRanges,
    // character_property_data.h:40-80, of which these are the letters).
    (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa) ||
    (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) ||
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
export function getFontSpaceKerning(measurement: FontMeasurement): Map<number, number> | null {
  if (measurement.spaceKerning === undefined) {
    const context = getContext(measurement)
    let probe = '\u2028'
    for (let code = 0x21; code <= 0x7e; code++) probe += String.fromCharCode(code) + '\u2028'
    const kerned = context.measureText(probe).width
    context.fontKerning = 'none'
    const unkerned = context.measureText(probe).width
    context.fontKerning = 'auto'
    // Where U+2028 alone doesn't measure as the space, it doesn't stand for it.
    measurement.spaceKerning = kerned !== unkerned && context.measureText('\u2028').width === getSegmentMetrics(' ', measurement).width ? new Map() : null
  }
  return measurement.spaceKerning
}

// A character's kerning with a space glyph after it, or before it: the two in one string, with
// U+2028 for the space, less each alone. Asked of Canvas once per font and side.
function getCharacterSpaceKerning(code: number, spaceFirst: boolean, measurement: FontMeasurement, kernings: Map<number, number>): number {
  const key = code << 1 | (spaceFirst ? 1 : 0)
  let kerning = kernings.get(key)
  if (kerning === undefined) {
    kerning = 0
    if (!takesNoSpaceKerning(code)) {
      const character = String.fromCharCode(code)
      const pairWidth = getContext(measurement).measureText(spaceFirst ? '\u2028' + character : character + '\u2028').width
      kerning = pairWidth - getSegmentMetrics(character, measurement).width - getSegmentMetrics(' ', measurement).width
      // Blink keeps a run's width as a float32 (shape_result.cc:1539-1576), so up to the pair's
      // width / 2^22 is rounding, not kerning (RESEARCH.md, Kerning At Line Edges).
      if (Math.abs(kerning) <= pairWidth / 0x400000) kerning = 0
    }
    kernings.set(key, kerning)
  }
  return kerning
}

// The kerning Blink's layout gives a text segment's edges with a U+0020 beside them
// (EngineProfile.kernsSpacesInScriptRun), read from Canvas with U+2028 for the space: Blink
// draws U+2028 with the space glyph (HarfBuzzGetGlyph, harfbuzz_face.cc:103-113) and its Canvas
// doesn't cut there. Premise: the segment's last and first character stand for the word, past
// default ignorables, which HarfBuzz's lookups pass over, and a first character with a combining
// mark after it takes none (RESEARCH.md, Kerning At Line Edges, has the gaps).
export function getSpaceKerning(seg: string, metrics: SegmentMetrics, measurement: FontMeasurement, kernings: Map<number, number>): SpaceKerning {
  let first = 0
  let last = seg.length - 1
  while (first < last && hasProperty(seg.charCodeAt(first), DEFAULT_IGNORABLE)) first++
  while (last > first && hasProperty(seg.charCodeAt(last), DEFAULT_IGNORABLE)) last--
  const before = first < last && hasProperty(seg.charCodeAt(first + 1), MARK) ? 0 : getCharacterSpaceKerning(seg.charCodeAt(first), true, measurement, kernings)
  const after = getCharacterSpaceKerning(seg.charCodeAt(last), false, measurement, kernings)
  return metrics.spaceKerning = after === 0 && before === 0 ? noSpaceKerning : { after, before }
}

// The font's space, which holds no emoji. Every text asks for it, so it is kept beside the font's
// Map, which still answers the first one.
export function getSpaceWidth(measurement: FontMeasurement): number {
  return measurement.spaceWidth ??= getSegmentMetrics(' ', measurement).width
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
// inlined into the line counter and the simple stepper, and its plain line APIs ran
// 11-18% slower. Apart, it takes 21 (Node 23, V8 12.9). Check with node --print-bytecode and
// --trace-turbo-inlining (RESEARCH.md, JavaScript Engines).
export function getEngineProfile(): EngineProfile {
  return cachedEngineProfile ??= buildEngineProfile()
}

function buildEngineProfile(): EngineProfile {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  // Engines Pretext doesn't recognize take Blink's profile (RESEARCH.md, Decisions Log,
  // 2026-09-26).
  const engine = getLayoutEngine(ua) ?? 'blink'
  // Fresh-entry observations are verified only for desktop Blink and Gecko.
  const isDesktop = /Windows NT|Macintosh|X11/.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/.test(ua)

  return {
    entryFitBasis: isDesktop && engine === 'blink' ? 'fresh' : isDesktop && engine === 'gecko' ? 'original' : 'disabled',
    lineBreakScan: engine,
    graphemeTable: engine === 'webkit' ? 'apple/char' : engine === 'gecko' ? 'gecko/char' : 'chromium/char',
    lineFitEpsilon: engine === 'webkit' ? 1 / 64 : 0.005,
    cutWordFit: engine === 'blink' ? 'reshaped-lines' : 'segment-prefixes',
    prefixFitMinWidth: engine === 'webkit' ? 0 : 80,
    cutWordKeepsLigatures: engine === 'gecko',
    measureTextWithFollowingSpace: engine === 'webkit',
    kernsSpacesInScriptRun: engine === 'blink',
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
    hardBreakItemRetreat: engine === 'blink' ? 'item' : engine === 'webkit' ? 'fit' : 'last-grapheme',
    paddedOpeningFit: engine === 'blink' ? 'start' : engine === 'webkit' ? 'placed' : 'both',
    emptyAtomicAlwaysFits: engine === 'gecko',
    hangsSpacesPerTextFrame: engine === 'gecko',
    testsHyphenBeforeAtomic: engine !== 'webkit',
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
  const canvasW = measurement.emojiWidth = getContext(measurement).measureText('\u{1F600}').width
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

// What a word's width may differ by from its graphemes' widths added up and still be their sum:
// 2^-17 of the width, which covers the float32 roundings of a word of 96 graphemes, each 2^-24
// of the width at most, and is a tenth of the least kerning of a 2,048-unit font in a 100px word
// at 16px (RESEARCH.md, Break Opportunities From Engine Data).
const WORD_SUM_ROUNDING = 2 ** -17

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
  const profile = getEngineProfile()
  const ends = new Int32Array(seg.length)
  const count = findGraphemeEnds(profile.graphemeTable, seg, 0, seg.length, ends)
  if (count <= 1) return metrics.fit = { mode, advances: null, lineStartExtras: null, lineStartProhibitions: null, entryGeometry: null }
  let prohibitions: Uint8Array | null = null
  if (withLineStartProhibitions) {
    for (let i = 1; i < count; i++) if (!canWebKitLineStartWith(seg.charCodeAt(ends[i - 1]!))) (prohibitions ??= new Uint8Array(count))[i] = 1
  }
  let advances: number[]
  let lineStartExtras: number[] | null = null
  if (mode === 'reshaped-lines') {
    // Blink shapes a line of a cut word again where the cut falls between letters shaped
    // together (EngineProfile's cutWordFit). Premise: a line holds the letters whose width,
    // shaped alone, fits, so the letters after the line's first take the advances they have
    // in the word, and the first its width alone. Premise, taken for speed: a word as wide as
    // its graphemes measured alone has nothing shaped across them, and they are its advances,
    // with nothing more measured. Else each grapheme is measured after the one before it,
    // which every word of the font shares, and where those don't add up to the word either,
    // as in a ligature of three letters or the joined forms of Arabic, the word's prefixes
    // are, up to MAX_PREFIX_FIT_GRAPHEMES (RESEARCH.md, Break Opportunities From Engine Data).
    const width = getCorrectedSegmentWidth(seg, metrics, measurement, emojiCorrection) - (followingSpaceWidth ?? 0)
    const alone = measureFitAdvances(seg, ends, count, 'sum-graphemes', metrics, measurement, emojiCorrection, followingSpaceWidth)
    advances = alone
    if (!addUpTo(alone, width)) {
      advances = measureFitAdvances(seg, ends, count, 'pair-context', metrics, measurement, emojiCorrection, followingSpaceWidth)
      if (count <= MAX_PREFIX_FIT_GRAPHEMES && !addUpTo(advances, width)) {
        advances = measureFitAdvances(seg, ends, count, 'segment-prefixes', metrics, measurement, emojiCorrection, followingSpaceWidth)
      }
      lineStartExtras = [0]
      for (let i = 1; i < count; i++) lineStartExtras.push(alone[i]! - advances[i]!)
    }
  } else {
    // Past MAX_PREFIX_FIT_GRAPHEMES, prefixes give way to pairs.
    const prefixes = mode === 'segment-prefixes' && count <= MAX_PREFIX_FIT_GRAPHEMES
    advances = measureFitAdvances(seg, ends, count, mode === 'segment-prefixes' && !prefixes ? 'pair-context' : mode, metrics, measurement, emojiCorrection, followingSpaceWidth)
    if (prefixes && profile.cutWordKeepsLigatures) countLigaturesOnFirstLetter(seg, ends, advances, measurement, emojiCorrection)
  }
  return metrics.fit = { mode, advances, lineStartExtras, lineStartProhibitions: prohibitions, entryGeometry: null }
}

// Moves the advance of each later letter of a ligature onto the ligature's first letter, in a
// segment's prefix advances, as Gecko counts it where it cuts a word (EngineProfile's
// cutWordKeepsLigatures). A prefix that ends inside a ligature has the first letter's glyph
// alone, so the next letter's advance after that prefix isn't its advance alone, in app units,
// 1/60 px, which Gecko's Canvas reports whole, and there Canvas is asked whether the two are a
// ligature (isLigature). Where a line is narrower than the ligature it starts with, Gecko cuts
// inside it and gives each of its letters an equal share (ComputeLigatureData,
// gfxTextRun.cpp:238-322); here the first letter keeps the whole advance (ENGINE_FOLLOWUPS.md,
// Emergency breaks inside a word).
function countLigaturesOnFirstLetter(seg: string, ends: Int32Array, advances: number[], measurement: FontMeasurement, emojiCorrection: number): void {
  // Text measured under letter spacing has no optional ligature, and a context that can't
  // turn them off can't be asked.
  if (!measurement.state.shapesLetterSpaced || measurement.letterSpacing !== '0px') return
  // The grapheme the ligature that holds the grapheme before this one starts with, or that grapheme.
  let first = 0
  for (let i = 1; i < advances.length; i++) {
    const start = ends[i - 1]!
    const alone = getTextWidth(seg.slice(start, ends[i]), measurement, emojiCorrection)
    if (Math.round((advances[i]! - alone) * 60) !== 0 && isLigature(seg.slice(i === 1 ? 0 : ends[i - 2]!, ends[i]), measurement)) {
      advances[first] = advances[first]! + advances[i]!
      advances[i] = 0
    } else {
      first = i
    }
  }
}

// Whether two neighbouring graphemes are one of the font's optional ligatures: the pair measures
// otherwise without them, as the context shapes text under a letter spacing
// (LETTER_SPACED_SHAPING). Asked of Canvas once per pair and font. A kerned pair, letters that
// join, a mark on its base and a ligature the font requires measure the same, and aren't one.
function isLigature(pair: string, measurement: FontMeasurement): boolean {
  let ligature = measurement.ligaturePairs.get(pair)
  if (ligature === undefined) {
    const context = getContext(measurement)
    const width = getSegmentMetrics(pair, measurement).width
    context.letterSpacing = LETTER_SPACED_SHAPING
    ligature = context.measureText(pair).width !== width
    context.letterSpacing = '0px'
    measurement.ligaturePairs.set(pair, ligature)
  }
  return ligature
}

// Whether a segment's advances add up to its width, within the rounding of Canvas's widths.
function addUpTo(advances: readonly number[], width: number): boolean {
  let sum = 0
  for (let i = 0; i < advances.length; i++) sum += advances[i]!
  return Math.abs(sum - width) <= width * WORD_SUM_ROUNDING
}

// A segment's advances per grapheme: the differences of its prefixes' widths, or each
// grapheme's width alone or, as a pair, after the one before it.
function measureFitAdvances(
  seg: string,
  ends: Int32Array,
  count: number,
  from: 'sum-graphemes' | 'segment-prefixes' | 'pair-context',
  metrics: SegmentMetrics,
  measurement: FontMeasurement,
  emojiCorrection: number,
  followingSpaceWidth: number | null,
): number[] {
  const prefixes = from === 'segment-prefixes'
  const pairs = from === 'pair-context'
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
  return advances
}

// What preparation measures a font's text through. Text under letter spacing has a
// measurement of its own where the context shapes it as the page does: its widths,
// prefixes and line-edge facts all come from that shaping. The context isn't touched
// here: text that is all in the font's caches measures nothing (getContext).
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
    measurement = { state, canvasFont, letterSpacing: shaped ? LETTER_SPACED_SHAPING : '0px', metrics: new Map(), followingSpaceMetrics: new Map(), spaceKerning: undefined, emojiCorrection: null, emojiWidth: 0, hyphenText: null, spaceWidth: null, hanKerning: undefined, ligaturePairs: new Map() }
    fonts.set(font, measurement)
  }
  // The first measurement after a lookup sets the font again, the same string too: Firefox's
  // context takes a face added to document.fonts only when its font is assigned.
  state.font = ''
  return measurement
}

// The font's context, set to the font and its shaping. Every measurement in a font takes
// its context from here as it measures, so none reads a width under another font's
// setting, whatever was looked up or prepared in between, and text that is all cached,
// which measures nothing, sets nothing. What changes the context after that puts it back
// before it returns (getHyphenText, measureWithLetterSpacing, getFontSpaceKerning,
// isLigature).
export function getContext(measurement: FontMeasurement): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const state = measurement.state
  if (state.font !== measurement.canvasFont) state.context.font = state.font = measurement.canvasFont
  if (state.letterSpacing !== measurement.letterSpacing) state.context.letterSpacing = state.letterSpacing = measurement.letterSpacing
  return state.context
}

function createMeasureState(language: string | null): MeasureState {
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (typeof OffscreenCanvas !== 'undefined') {
    context = new OffscreenCanvas(1, 1).getContext('2d')!
  } else if (typeof document !== 'undefined') {
    context = document.createElement('canvas').getContext('2d')!
  } else {
    throw new Error('Text measurement requires OffscreenCanvas or a DOM canvas context.')
  }
  // A context's `lang` follows the page's, and preparation's can be setLocale()'s or
  // Blink's default locale instead.
  if (language !== null && 'lang' in context) context.lang = language
  const profile = getEngineProfile()
  const takesLetterSpacing = typeof context.letterSpacing === 'string'
  return {
    language,
    context,
    font: '',
    letterSpacing: '0px',
    genericFamilies: language !== null && profile.namesGenericFamiliesByLanguage ? getWebKitGenericFamilies(language, context) : null,
    takesLetterSpacing,
    shapesLetterSpaced: takesLetterSpacing && profile.canvasLetterSpacingDropsLigatures,
    fonts: new Map(),
    letterSpacedFonts: new Map(),
  }
}

export function clearMeasurementCaches(): void {
  measureState?.fonts.clear()
  measureState?.letterSpacedFonts.clear()
}
