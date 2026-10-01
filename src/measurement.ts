import { findGraphemeEnds, type GraphemeTable } from './graphemes.js'
import { canWebKitLineStartWith, getBlinkDefaultLocale } from './line-breaks.js'
import { webkitGenericFamilies, webkitGenericFamilyNames, webkitScriptLanguages, webkitScriptSubtags } from './generated/webkit-generic-families.js'
import type { SegmentEntryGeometry } from './entry-geometry.js'
import type { HanKerningFontData } from './han-kerning.js'

// What preparation knows of a segment in a font. Each is created with all its fields,
// so their reads see one shape.
export type SegmentMetrics = {
  width: number
  emojiCount: number // Emoji graphemes, or -1 until counted
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
  // Where a rich-inline line ends when a padded item that starts with a hard break, with no break before it, doesn't
  // fit its padding as the engine fits it there (paddedOpeningFit) and the line has no break to return to. Blink's
  // retry of an overflowing line breaks between any two graphemes (kBreakCharacter, line_breaker.cc:4258-4264,
  // 4620-4622), so the line ends before the item ('item'). Gecko's wrap opportunities come before each cluster inside
  // a text frame, none at its end (gfxTextRun.cpp:1046-1101), and WebKit breaks the last run of the content that
  // doesn't fit where that run fits, TextUtil::breakWord in an overflowing run, else before the last character of one
  // that no text run follows (InlineContentBreaker.cpp:611-651), so there the line ends before the last grapheme of the
  // text before the item, and keeps the item where that grapheme starts the line ('last-grapheme'). `Unbreakable`,
  // then a span with 20px of padding that starts with a line feed, in 15px Helvetica Neue at 93px, and `Unbreakabl`,
  // a bold `e` and that span at 86-106px, which moves the `e`. Where that text ends with preserved spaces, Firefox moves
  // the last space and Safari the spaces that don't fit, which the profiles don't model: the line ends before the item
  // (ENGINE_FOLLOWUPS.md, Rich-inline item edges).
  hardBreakItemRetreat: 'item' | 'last-grapheme'
  // Which edges of a padded rich-inline item a line fits where the line takes the item's opening and no more of it:
  // the white space or hard break that starts it (getOpeningFit in src/rich-inline.ts has each engine's rule and
  // source). Blink fits its start edge, and no edge of an item of only white space, or after preserved spaces that
  // follow text: 'start'. WebKit fits its start edge where a hard break starts it, or white space does after an atomic
  // item, and its end edge too where the item is all opening: 'placed'. Gecko fits a frame's whole width, its cloned
  // end edge too, and lets only an empty frame past the line's end (CanPlaceFrame, nsLineLayout.cpp:1217-1270),
  // wherever it falls, so an object of width 0 stays on a line that already overflows: 'both'. In 15px Helvetica
  // Neue, `Unbreakable` and a span with 20px padding that starts with a line feed keep the line feed from 107px in
  // Chrome and Safari, from 127px in Firefox; `Ping `, the chip `@alice` and a span with 12px padding that starts
  // with two spaces keep them on the chip's line from 71px in Chrome and Safari and from 83px in Firefox, and one of
  // only two spaces at every width in Chrome and from 117px in Safari and Firefox.
  paddedOpeningFit: 'start' | 'placed' | 'both'
  // Blink transforms segment breaks in the text of the whole inline formatting context
  // (ShouldRemoveNewline and RemoveTrailingCollapsibleNewlineIfNeeded, inline_items_builder.cc).
  // Gecko transforms each text frame's own text (nsTextFrameUtils::TransformText), as a rich-inline
  // paragraph's analysis transforms each item's, and WebKit turns segment breaks into spaces.
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
  emojiCorrection: number | null // Probed for the first text that may hold emoji
  hanKerning: HanKerningFontData | null | undefined // Read for the first text that may kern
}
let cachedEngineProfile: EngineProfile | null = null

// Prefix fits, which preparation picks by engine, width and letter spacing
// (measureAnalysis in src/prepare.ts), measure every growing prefix of a
// segment. That suits word-sized runs, but a giant segment would prepare in time
// that grows with the square of its length. Past this size, the cheaper
// pair-context model keeps preparation linear.
const MAX_PREFIX_FIT_GRAPHEMES = 96

// Graphemes drawn from the emoji font: those holding an emoji-presentation
// character, or an emoji character followed by U+FE0F, such as U+2764 or a
// keycap base like `1`. U+FE0F after a letter or a space changes nothing.
const emojiGraphemeRe = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u
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
  const previous = context.letterSpacing
  try {
    context.letterSpacing = `${letterSpacing}px`
    if (Number.parseFloat(context.letterSpacing) !== letterSpacing) return null
    const width = context.measureText(text).width - (emojiCorrection === 0 ? 0 : countEmojiGraphemes(text) * emojiCorrection)
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
  return getCorrectedSegmentWidth(text, getSegmentMetrics(text, measurement), emojiCorrection)
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
    hardBreakItemRetreat: engine === 'blink' ? 'item' : 'last-grapheme',
    paddedOpeningFit: engine === 'blink' ? 'start' : engine === 'webkit' ? 'placed' : 'both',
    transformsSegmentBreaksAcrossItems: engine === 'blink',
  }
  cachedEngineProfile = profile
  return profile
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
  const canvasW = measurement.state.context.measureText('\u{1F600}').width
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

function countEmojiGraphemes(text: string): number {
  const ends = new Int32Array(text.length)
  const graphemeCount = findGraphemeEnds(getEngineProfile().graphemeTable, text, 0, text.length, ends)
  let count = 0
  for (let i = 0, start = 0; i < graphemeCount; start = ends[i++]!) {
    if (emojiGraphemeRe.test(text.slice(start, ends[i]))) count++
  }
  return count
}

function getEmojiCount(seg: string, metrics: SegmentMetrics): number {
  if (metrics.emojiCount < 0) metrics.emojiCount = countEmojiGraphemes(seg)
  return metrics.emojiCount
}

export function getCorrectedSegmentWidth(seg: string, metrics: SegmentMetrics, emojiCorrection: number): number {
  if (emojiCorrection === 0) return metrics.width
  return metrics.width - getEmojiCount(seg, metrics) * emojiCorrection
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
        ? getCorrectedSegmentWidth(seg, metrics, emojiCorrection) - followingSpaceWidth
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
    measurement = { state, canvasFont, metrics: new Map(), followingSpaceMetrics: new Map(), emojiCorrection: null, hanKerning: undefined }
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
