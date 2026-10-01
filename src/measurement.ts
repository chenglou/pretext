import { findGraphemeEnds, type GraphemeTable } from './graphemes.js'
import { canWebKitLineStartWith, getBlinkDefaultLocale } from './line-breaks.js'
import { webkitGenericFamilies, webkitGenericFamilyNames, webkitScriptLanguages, webkitScriptSubtags } from './generated/webkit-generic-families.js'
import type { SegmentEntryGeometry } from './entry-geometry.js'
import type { HanKerningFontData } from './han-kerning.js'

// What preparation knows of a segment in a font. Each is created with all its fields,
// so their reads see one shape.
export type SegmentMetrics = {
  width: number
  emojiCount: number // Glyphs the emoji font draws (countEmojiGlyphs), or -1 until counted
  fit: SegmentFit | null // Where it breaks under overflow, for the last fit mode asked
}

// Where a segment breaks under overflow-wrap: break-word in one fit mode (getSegmentFit),
// replaced whole when another mode is asked for.
export type SegmentFit = {
  mode: BreakableFitMode
  advances: number[] | null // Per grapheme, or null for one grapheme
  // With advances in the WebKit profile, the graphemes after the first that WebKit
  // doesn't start a line with when a line holds only an overflowing first character,
  // by their first code unit, as ascending grapheme indices. Null without any.
  lineStartProhibitions: number[] | null
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
  // wherever the line ends. Blink also kerns there, but in its default state its
  // Canvas splits words at spaces and shows none of it; Gecko shapes words
  // without their spaces.
  measureTextWithFollowingSpace: boolean
  // WebKit and Gecko letter-space the visible discretionary hyphen itself.
  // Blink shapes it separately, without spacing.
  letterSpaceDiscretionaryHyphen: boolean
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
  // the latest opportunity that fits at the full width. WebKit also returns, but
  // that is not modeled: its installed losses come from letter spacing on
  // invisibles and from marks after a soft hyphen, which isolated widths do not
  // show. It keeps the overflowing hyphen.
  unfitHyphenRetreat: 'reduced-width' | 'full-width' | 'none'
  // WebKit moves a tab to the following stop when less than half a space would
  // remain before the next one (FontCascade::tabWidth).
  skipNarrowTabStops: boolean
  // A run of preserved spaces and tabs at the end of a pre-wrap line hangs in Blink
  // and WebKit (CSS Text 3 §4.1.2). Gecko doesn't hang a tab that doesn't fit, so a
  // tab counts in the line's fit and width there, as spaces do not.
  hangTabs: boolean
  // Blink's break-anywhere retry and WebKit's grapheme search can end a line after
  // zero-width glue when the grapheme after it doesn't fit, so the glue takes a line of
  // its own. Gecko drops soft hyphens from its text run and clusters a ZWSP with the marks
  // after it, so glue at a line start can't hold the line: the segment after it starts it.
  zeroWidthGlueTakesLine: boolean
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
  // analysis does only through bidi controls, inside a text past its first white space
  // (ENGINE_FOLLOWUPS.md).
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
  // lets only an empty frame past the line's end (CanPlaceFrame, nsLineLayout.cpp:1217-1270),
  // wherever it falls, so an atomic item of width 0 stays on a line that already overflows: 'both'. In 15px Helvetica Neue, `Unbreakable` and a span with 20px padding that starts with a
  // line feed keep the line feed from 107px in Chrome and Safari, from 127px in Firefox, and
  // `Unbreakable   ` and that span from 86px in Chrome, 105px in Safari and 138px in Firefox;
  // `Ping `, the chip `@alice` and a span with 12px padding that starts with two spaces keep them
  // on the chip's line from 71px in Chrome and Safari and from 83px in Firefox, and one of only
  // two spaces at every width in Chrome and from 117px in Safari and Firefox.
  paddedOpeningFit: 'start' | 'placed' | 'both'
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
  genericFamilies: string[] | null // The families the language gives the generic keywords, or null
  takesLetterSpacing: boolean // As Chrome's and Firefox's contexts do, as a string of CSS px
  fonts: Map<string, FontMeasurement>
}
let measureState: MeasureState | null = null
// What preparation keeps per font. It all goes together, when the caches clear or the
// language changes.
export type FontMeasurement = {
  state: MeasureState // Its context, which getFontMeasurement() sets to the font
  // The font Canvas is given: the declared font, with the generic keywords the context's
  // language names replaced by their families.
  canvasFont: string
  metrics: Map<string, SegmentMetrics>
  // Metrics of a text item measured together with one following U+0020, keyed by
  // the item alone. The width includes that space.
  followingSpaceMetrics: Map<string, SegmentMetrics>
  // What Canvas measures a glyph of the emoji font wider than the page draws it under
  // emojiRatio, the device pixel ratio it was measured for, 0 before the first text that
  // may hold emoji; and Canvas's width of one such glyph (getEmojiCorrection).
  emojiCorrection: number
  emojiRatio: number
  emojiWidth: number
  hanKerning: HanKerningFontData | null | undefined // Read for the first text that may kern
}
let cachedEngineProfile: EngineProfile | null = null

// Prefix fits, which preparation picks by engine, width and letter spacing
// (measureAnalysis in src/prepare.ts), measure every growing prefix of a
// segment. That suits word-sized runs, but a giant segment would prepare in time
// that grows with the square of its length. Past this size, the cheaper
// pair-context model keeps preparation linear.
const MAX_PREFIX_FIT_GRAPHEMES = 96

// Graphemes the emoji font may draw a glyph in, which Canvas widths then tell
// (countEmojiGlyphs): those holding an emoji-presentation character or a pictograph,
// or an emoji character followed by U+FE0F, such as a keycap base like `1`. U+FE0F
// after a letter or a space changes nothing.
const emojiGraphemeRe = /\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji}\uFE0F/u
const maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u

const genericKeywords = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace']
// A quoted family name, or an unquoted generic keyword with what precedes it.
const familyListItemRe = /("[^"]*"|'[^']*')|(^|,)(\s*)(serif|sans-serif|cursive|fantasy|monospace)(?=\s*(?:,|$))/gi

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
  const size = /\dpx(?:\s*\/\s*\S+)?\s+/.exec(font)
  if (size === null) return font
  const start = size.index + size[0].length
  return font.slice(0, start) + font.slice(start).replace(familyListItemRe, (item: string, quoted: string | undefined, separator: string, space: string, keyword: string) => {
    const named = quoted === undefined ? families[genericKeywords.indexOf(keyword.toLowerCase())]! : ''
    return named === '' ? item : separator + space + named
  })
}

// The language setLocale() gave, which preparation reads in place of the page's,
// or undefined.
let localeLanguage: string | undefined

export function setLocaleLanguage(locale: string | undefined): void {
  localeLanguage = locale
}

// The device pixel ratio setDevicePixelRatio() gave, which the emoji correction reads in
// place of the page's, or undefined.
let givenDevicePixelRatio: number | undefined

export function setGivenDevicePixelRatio(ratio: number | undefined): void {
  if (ratio !== undefined && !(Number.isFinite(ratio) && ratio > 0)) throw new RangeError(`The device pixel ratio must be a finite number above 0, not ${ratio}`)
  givenDevicePixelRatio = ratio
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

// A text's letter spacing in CSS px, 0 by default. CSS and Canvas ignore a
// non-finite one, which Pretext refuses rather than guess at.
export function readLetterSpacing(letterSpacing: number | undefined): number {
  const value = letterSpacing ?? 0
  if (!Number.isFinite(value)) throw new RangeError(`letterSpacing must be a finite number of CSS px, not ${value}`)
  return value
}

// A zero per segment, where per-segment widths start, pushed in a loop: Array.from over
// `{ length }` reads every index off the object and calls its map function for each.
export function zeros(count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(0)
  return out
}

// A direct measurement under letter spacing, borrowing the font's context for the
// synchronous call. It never enters the unspaced segment cache, and letterSpacing
// is restored even when assignment or measurement fails. Null where the context
// can't take the spacing.
export function measureWithLetterSpacing(text: string, letterSpacing: number, emojiCorrection: number, measurement: FontMeasurement): number | null {
  const { context, takesLetterSpacing } = measurement.state
  if (!takesLetterSpacing) return null
  // Counted before the spacing is set: the count measures graphemes into the unspaced cache.
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
  const metrics: SegmentMetrics = { width: measurement.state.context.measureText(text).width, emojiCount: -1, fit: null }
  cache.set(seg, metrics)
  return metrics
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

export function getEngineProfile(): EngineProfile {
  if (cachedEngineProfile !== null) return cachedEngineProfile

  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  // Engines Pretext doesn't recognize take Blink's profile (RESEARCH.md, Decisions Log).
  const engine = getLayoutEngine(ua) ?? 'blink'
  // Fresh-entry observations are verified only for desktop Blink and Gecko.
  const isDesktop = /Windows NT|Macintosh|X11/.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/.test(ua)

  const profile: EngineProfile = {
    entryFitBasis: isDesktop && engine === 'blink' ? 'fresh' : isDesktop && engine === 'gecko' ? 'original' : 'disabled',
    lineBreakScan: engine,
    graphemeTable: engine === 'webkit' ? 'apple/char' : engine === 'gecko' ? 'gecko/char' : 'chromium/char',
    lineFitEpsilon: engine === 'webkit' ? 1 / 64 : 0.005,
    prefixFitMinWidth: engine === 'webkit' ? 0 : engine === 'gecko' ? 80 : Infinity,
    measureTextWithFollowingSpace: engine === 'webkit',
    letterSpaceDiscretionaryHyphen: engine !== 'blink',
    shapesMarksAcrossSoftHyphen: engine === 'blink',
    unfitHyphenRetreat: engine === 'blink' ? 'reduced-width' : engine === 'gecko' ? 'full-width' : 'none',
    skipNarrowTabStops: engine === 'webkit',
    hangTabs: engine !== 'gecko',
    zeroWidthGlueTakesLine: engine !== 'gecko',
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
    transformsSegmentBreaksAcrossItems: engine === 'blink',
  }
  cachedEngineProfile = profile
  return profile
}

export function textMayContainEmoji(text: string): boolean {
  return maybeEmojiRe.test(text)
}

// A font's style and weight with the generic family `serif` in place of its families, at
// `ratio` times its size, the first px length of its shorthand, or null without one. A
// failed size can restart at the next digit run, not at every digit in it.
export function getGenericFont(font: string, ratio: number): string | null {
  const size = /(^|\D)(\d+(?:\.\d+)?)\s*px/.exec(font)
  return size === null ? null : `${font.slice(0, size.index)}${size[1]}${Number.parseFloat(size[2]!) * ratio}px serif`
}

// Canvas reports a width as a 32-bit float, so a few equal advances measure that many
// times one only within its rounding: 2e-6 px off in Firefox 156, whose emoji take a
// fractional advance in a bold font.
const CANVAS_WIDTH_ROUNDING = 1 / 1024

// What Canvas measures a glyph of the emoji font wider than the page draws it. Blink's and
// Gecko's pages size text at the device size, the font size times the device pixel ratio,
// where their Canvas sizes it at the CSS size (Blink's resets the computed size to skip
// zoom, canvas_rendering_context_2d.cc:690-726). An outline glyph scales with the size,
// so that changes no advance, but Apple Color Emoji holds bitmaps and gives a glyph 20px
// at 16px and 32px at 32px (Gecko asks Core Text at the font's size, gfxMacFont.cpp:
// 437-463). So the correction is Canvas's width of U+1F600 in the font, less its width at
// the device size over the ratio, which is the page's advance: 16px at 16px and ratio 2,
// where Canvas gives 20px in Chrome and 21px in Firefox. It can be negative at a
// fractional ratio: -0.2px at 12px and ratio 1.25 in Chrome. There is none where the
// font's own families draw the probe, which then measures otherwise than after a generic
// family. WebKit's page and Canvas both size the emoji at the CSS size and take none;
// that is read off the profile's scan, since a field of its own, the profile's 25th,
// made Chrome's line APIs 11-18% slower (RESEARCH.md, JavaScript Engines).
// The device size is asked after the generic family, never in the font's own list: in
// Chrome at ratio 2, measuring at 32px in a `system-ui` list before the page lays out its
// 16px text makes that text 11% narrower (PLATFORM_BUGS.md, `system-ui` in Canvas and DOM).
// The ratio is setDevicePixelRatio()'s, or else the page's devicePixelRatio, or 1 in a
// worker, which has none; it is read for each text that may hold emoji, and a font
// measured under another ratio starts over, since its segments' fits hold the old
// correction. No DOM is read.
export function getEmojiCorrection(measurement: FontMeasurement): number {
  const ratio = getEngineProfile().lineBreakScan === 'webkit' ? 1 : givenDevicePixelRatio ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
  if (measurement.emojiRatio === ratio) return measurement.emojiCorrection
  if (measurement.emojiRatio !== 0) {
    measurement.metrics.clear()
    measurement.followingSpaceMetrics.clear()
  }
  let correction = 0
  const genericFont = ratio === 1 ? null : getGenericFont(measurement.canvasFont, 1)
  if (genericFont !== null) {
    const context = measurement.state.context
    const width = measurement.emojiWidth = context.measureText('\u{1F600}').width
    context.font = genericFont
    if (context.measureText('\u{1F600}').width === width) {
      context.font = getGenericFont(measurement.canvasFont, ratio)!
      const deviceWidth = context.measureText('\u{1F600}').width
      // A glyph's advance changes with its size. Firefox's box for a missing glyph has one
      // width at any size (gfxFontMissingGlyphs.cpp:530-545), and for a moment it draws
      // U+1F600 itself as one, while the installed families' character maps load.
      if (deviceWidth !== width) correction = width - deviceWidth / ratio
      if (Math.abs(correction) < CANVAS_WIDTH_ROUNDING) correction = 0
    }
    context.font = measurement.canvasFont
  }
  measurement.emojiRatio = ratio
  return measurement.emojiCorrection = correction
}

// How many glyphs of the emoji font draw a text: the emoji font gives every glyph one
// advance, the probe's, so text it draws measures a whole number of them, and none
// where it measures anything else.
function getEmojiGlyphs(text: string, measurement: FontMeasurement): number {
  const width = getSegmentMetrics(text, measurement).width
  const glyphs = Math.round(width / measurement.emojiWidth)
  return Math.abs(width - glyphs * measurement.emojiWidth) < CANVAS_WIDTH_ROUNDING ? glyphs : 0
}

// The characters the emoji font shapes together inside a grapheme: emoji and pictographs,
// what joins or alters them (ZWJ, skin tones, tags, U+20E3) and the variation selectors.
// A grapheme of emojiGraphemeRe holds one.
const emojiStretchRe = /[\p{Emoji}\p{Extended_Pictographic}\p{Emoji_Component}\uFE0E]+/gu
// Each character with the variation selector after it, which picks its font.
const selectedCharacterRe = /.[\uFE0E\uFE0F]?/gsu

// The glyphs of the emoji font in a text: what the correction is subtracted for, once
// each. Font fallback decides which font draws an emoji character, and Canvas shows what
// it decided, at one cached Canvas call per distinct grapheme of a font. A grapheme with
// a glyph of another font measures as the page draws it: Menlo's own U+26A1, Inter's
// U+2B1C, Hiragino Sans's U+26AA, or U+231A before U+FE0E, which asks for a text font
// (gfxTextRun.cpp:3268-3273). A pictograph whose presentation is text by default takes
// the correction with no U+FE0F where only the emoji font has it, as U+1F336 in Arial.
// Two or more glyphs are a sequence the emoji font has no glyph for, drawn as its parts.
//
// A grapheme can mix fonts: a font is matched character by character, a character that
// extends a cluster taking the font before it only where that font has it
// (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3194), and each font shapes its own
// characters together. So each stretch of emoji characters is asked apart from the rest
// of its grapheme: a ZWJ sequence, a skin-toned emoji or a flag before a combining mark
// of another script is still one glyph. A stretch that isn't all emoji glyphs is asked
// character by character, each with its variation selector: a skin tone after a digit
// or after a glyph of the named font. What only joins or alters isn't asked: alone,
// Chrome draws U+20E3 from the emoji font in Zapfino, and after `©` as a missing glyph.
//
// Asked apart, a piece can take another font than it has inside its grapheme: Chrome
// sends a whole cluster to the next font when one of its glyphs is missing
// (HarfBuzzShaper::ExtractShapeResults, harfbuzz_shaper.cc:586-655), so a skin tone
// before a combining mark is the named font's missing glyph. The grapheme's own width
// bounds the count: no more emoji glyphs than emoji widths fit in it.
//
// The gaps are in ENGINE_FOLLOWUPS.md, Emoji correction: another font's glyph exactly
// as wide as an emoji takes the correction, as does Firefox's box for a missing glyph at
// 13px, and an emoji font whose advances vary would take none.
function countEmojiGlyphs(text: string, measurement: FontMeasurement): number {
  const ends = new Int32Array(text.length)
  const graphemeCount = findGraphemeEnds(getEngineProfile().graphemeTable, text, 0, text.length, ends)
  let count = 0
  for (let i = 0, start = 0; i < graphemeCount; start = ends[i++]!) {
    const grapheme = text.slice(start, ends[i])
    if (!emojiGraphemeRe.test(grapheme)) continue
    const stretches = grapheme.match(emojiStretchRe)!
    let glyphs = 0
    for (let s = 0; s < stretches.length; s++) {
      const together = getEmojiGlyphs(stretches[s]!, measurement)
      glyphs += together
      if (together > 0) continue
      const characters = stretches[s]!.match(selectedCharacterRe)!
      for (let c = 0; c < characters.length; c++) {
        if (emojiGraphemeRe.test(characters[c]!)) glyphs += getEmojiGlyphs(characters[c]!, measurement)
      }
    }
    if (glyphs === 0) continue
    const width = getSegmentMetrics(grapheme, measurement).width
    count += Math.min(glyphs, Math.floor((width + CANVAS_WIDTH_ROUNDING) / measurement.emojiWidth))
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
  let prohibitions: number[] | null = null
  if (withLineStartProhibitions) {
    for (let i = 1; i < count; i++) if (!canWebKitLineStartWith(seg.charCodeAt(ends[i - 1]!))) (prohibitions ??= []).push(i)
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

export function getFontMeasurement(font: string, language: string | null): FontMeasurement {
  // Preparation starts here, with the language it resolved. After that language
  // changes, start again with a new context and empty caches; clearing the caches
  // alone would re-measure with fonts resolved under the old language.
  if (measureState === null || measureState.language !== language) measureState = createMeasureState(language)
  const state = measureState
  let measurement = state.fonts.get(font)
  if (measurement === undefined) {
    const canvasFont = state.genericFamilies === null ? font : getCanvasFont(font, state.genericFamilies)
    measurement = { state, canvasFont, metrics: new Map(), followingSpaceMetrics: new Map(), emojiCorrection: 0, emojiRatio: 0, emojiWidth: 0, hanKerning: undefined }
    state.fonts.set(font, measurement)
  }
  state.context.font = measurement.canvasFont
  return measurement
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
  return {
    language,
    context,
    genericFamilies: language !== null && getEngineProfile().namesGenericFamiliesByLanguage ? getWebKitGenericFamilies(language, context) : null,
    takesLetterSpacing: typeof context.letterSpacing === 'string',
    fonts: new Map(),
  }
}

export function clearMeasurementCaches(): void {
  measureState?.fonts.clear()
}
