import type { CharTable } from './generated/engine-break-data.js'
import { findGraphemeEnds } from './graphemes.js'
import { canWebKitLineStartWith, getBlinkDefaultLocale } from './line-breaks.js'
import { webkitGenericFamilies, webkitGenericFamilyNames, webkitScriptLanguages, webkitScriptSubtags } from './generated/webkit-generic-families.js'
import type { SegmentEntryGeometry } from './entry-geometry.js'
import type { HanKerningFontData } from './han-kerning.js'

export type SegmentMetrics = {
  width: number
  emojiCount?: number
  breakableFitMode?: BreakableFitMode
  breakableFitAdvances?: number[] | null
  // With breakable fit advances in the WebKit profile, the graphemes after the first that
  // WebKit doesn't start a line with when a line holds only an overflowing first character,
  // by their first code unit, as ascending grapheme indices. Null without any.
  lineStartProhibitions?: number[] | null
  entryGeometry?: {
    letterSpacing: number
    advances: readonly number[]
    emojiCorrection: number
    geometry: SegmentEntryGeometry
  }
}

export type EngineProfile = {
  entryFitBasis: 'fresh' | 'original' | 'disabled' // original whole minus consumed prefixes
  // Where preparation finds break opportunities: each engine's own scan. Blink and WebKit
  // scan the text with their pair tables and ICU line rules (src/line-breaks.ts), Gecko
  // with nsLineBreaker over ICU4X's rules (src/gecko-line-breaks.ts), and engines Pretext
  // doesn't recognize take Blink's scan.
  lineBreakScan: 'blink' | 'webkit' | 'gecko'
  // Where grapheme clusters end: the engine's ICU character rules (src/graphemes.ts).
  // libicucore's add Apple's transcoding hints to Extend. Firefox's ICU4X data gives the
  // clusters Chrome's rules give.
  graphemeTable: CharTable
  lineFitEpsilon: number
  // Where an emergency break falls inside a segment. WebKit measures the word's grapheme
  // prefixes (TextUtil::breakWord), and Gecko adds the advances of the word shaped whole
  // (gfxTextRun::BreakAndMeasureText), which prefixes follow in joined scripts where
  // standalone graphemes don't. Blink sums standalone graphemes. Segments at least this
  // wide fit from prefixes, narrower ones from standalone graphemes.
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
  // in src/layout.ts). WebKit counts it: Safari 27 lays out 中文, U+3000, 中文 at 33px
  // in 16px PingFang SC in 3 lines.
  hangsIdeographicSpace: boolean
  // Blink lays out content without a language under its default locale, Chrome's UI
  // language, which Intl shows (getBlinkLineBreaks in src/line-breaks.ts): its line table,
  // font fallback and HanKerning's punctuation types follow it. Canvas under an empty page
  // language doesn't, so the Chromium profile gives the context that locale. WebKit and
  // Gecko take process languages a page can't read and keep the page's.
  measureUnderDefaultLocale: boolean
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
}

export type BreakableFitMode = 'sum-graphemes' | 'segment-prefixes' | 'pair-context'

let measureContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
// Canvas resolves fonts under the document language. Chrome keeps a resolved
// font while its font string is unchanged, so the context, and every width
// measured through it, belong to the language it was created under.
let measureContextLanguage: string | null = null
// The families the context's language gives the generic keywords, or null.
let measureContextGenericFamilies: string[] | null = null
// What preparation keeps per font. It all goes together, when the caches clear or the
// page language changes.
export type FontMeasurement = {
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
const fontMeasurements = new Map<string, FontMeasurement>()
let cachedEngineProfile: EngineProfile | null = null

// Safari's prefix-fit policy is useful for ordinary word-sized runs, but letting
// it measure every growing prefix of a giant segment recreates a pathological
// superlinear prepare-time path. Past this size, switch to the cheaper
// pair-context model and keep the public behavior linear.
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

// Preparation reads the page language once and shares it between break rules
// and the measurement context.
export function getDocumentLanguage(): string | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement as HTMLElement | null | undefined
  if (root == null) return null
  const language = root.lang
  return typeof language === 'string' ? language : null
}

export function getMeasureContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  return measureContext ?? createMeasureContext(getDocumentLanguage())
}

function createMeasureContext(language: string | null): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  measureContextLanguage = language

  if (typeof OffscreenCanvas !== 'undefined') {
    measureContext = new OffscreenCanvas(1, 1).getContext('2d')!
  } else if (typeof document !== 'undefined') {
    measureContext = document.createElement('canvas').getContext('2d')!
  } else {
    throw new Error('Text measurement requires OffscreenCanvas or a DOM canvas context.')
  }
  if (language === '' && getEngineProfile().measureUnderDefaultLocale && 'lang' in measureContext) measureContext.lang = getBlinkDefaultLocale()
  measureContextGenericFamilies = language !== null && getEngineProfile().namesGenericFamiliesByLanguage ? getWebKitGenericFamilies(language, measureContext) : null
  return measureContext
}

// A direct measurement under letter spacing, borrowing the primary context for
// the synchronous call. It never enters the unspaced segment cache, and
// letterSpacing is restored even when assignment or measurement fails. Null
// where the context can't take the spacing.
export function measureWithLetterSpacing(text: string, letterSpacing: number, emojiCorrection: number): number | null {
  const primary = getMeasureContext()
  if (!('letterSpacing' in primary)) return null
  const previous = primary.letterSpacing
  if (typeof previous !== 'string') return null
  try {
    primary.letterSpacing = `${letterSpacing}px`
    if (Number.parseFloat(primary.letterSpacing) !== letterSpacing) return null
    const width = getCorrectedSegmentWidth(text, { width: primary.measureText(text).width }, emojiCorrection)
    return Number.isFinite(width) ? width : null
  } finally {
    primary.letterSpacing = previous
  }
}

// Metrics of seg measured together with one following U+0020.
export function getFollowingSpaceMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics {
  let metrics = cache.get(seg)
  if (metrics === undefined) {
    const ctx = getMeasureContext()
    metrics = {
      width: ctx.measureText(seg + ' ').width,
    }
    cache.set(seg, metrics)
  }
  return metrics
}

export function getSegmentMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics {
  let metrics = cache.get(seg)
  if (metrics === undefined) {
    const ctx = getMeasureContext()
    metrics = {
      width: ctx.measureText(seg).width,
    }
    cache.set(seg, metrics)
  }
  return metrics
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
  const engine = getLayoutEngine(ua)
  // Fresh-entry observations are verified only for desktop Blink and Gecko.
  const isDesktop = /Windows NT|Macintosh|X11/.test(ua) && !/Android|Mobile|iPhone|iPad|iPod/.test(ua)

  const profile: EngineProfile = {
    entryFitBasis: isDesktop && engine === 'blink' ? 'fresh' : isDesktop && engine === 'gecko' ? 'original' : 'disabled',
    lineBreakScan: engine === 'gecko' || engine === 'webkit' ? engine : 'blink',
    graphemeTable: engine === 'webkit' ? 'apple/char' : 'chromium/char',
    lineFitEpsilon: engine === 'webkit' ? 1 / 64 : 0.005,
    prefixFitMinWidth: engine === 'webkit' ? 0 : engine === 'gecko' ? 80 : Infinity,
    measureTextWithFollowingSpace: engine === 'webkit',
    letterSpaceDiscretionaryHyphen: engine !== 'blink',
    shapesMarksAcrossSoftHyphen: engine !== 'webkit' && engine !== 'gecko',
    unfitHyphenRetreat: engine === 'blink' ? 'reduced-width' : engine === 'gecko' ? 'full-width' : 'none',
    skipNarrowTabStops: engine === 'webkit',
    hangTabs: engine !== 'gecko',
    zeroWidthGlueTakesLine: engine !== 'gecko',
    hidesControlCharacters: engine === 'gecko',
    hanKerning: engine !== 'webkit' && engine !== 'gecko',
    hangsIdeographicSpace: engine !== 'webkit',
    measureUnderDefaultLocale: engine !== 'webkit' && engine !== 'gecko',
    namesGenericFamiliesByLanguage: engine === 'webkit',
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
  const ctx = getMeasureContext()
  ctx.font = measurement.canvasFont
  const canvasW = ctx.measureText('\u{1F600}').width
  correction = 0
  if (
    canvasW > fontSize + 0.5 &&
    typeof document !== 'undefined' &&
    document.body !== null
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
    if (emojiGraphemeRe.test(text.slice(start, ends[i]!))) count++
  }
  return count
}

function getEmojiCount(seg: string, metrics: SegmentMetrics): number {
  if (metrics.emojiCount === undefined) {
    metrics.emojiCount = countEmojiGraphemes(seg)
  }
  return metrics.emojiCount
}

export function getCorrectedSegmentWidth(seg: string, metrics: SegmentMetrics, emojiCorrection: number): number {
  if (emojiCorrection === 0) return metrics.width
  return metrics.width - getEmojiCount(seg, metrics) * emojiCorrection
}

export function getSegmentBreakableFitAdvances(
  seg: string,
  metrics: SegmentMetrics,
  cache: Map<string, SegmentMetrics>,
  emojiCorrection: number,
  mode: BreakableFitMode,
  // When metrics measured seg together with one following U+0020, the width of
  // that space alone. The last grapheme then keeps its kerning with the space.
  followingSpaceWidth: number | null = null,
  // Whether to record the segment's WebKit line-start prohibitions on metrics.
  withLineStartProhibitions = false,
): number[] | null {
  if (metrics.breakableFitAdvances !== undefined && metrics.breakableFitMode === mode) {
    return metrics.breakableFitAdvances
  }
  metrics.breakableFitMode = mode

  const ends = new Int32Array(seg.length)
  const graphemeCount = findGraphemeEnds(getEngineProfile().graphemeTable, seg, 0, seg.length, ends)
  if (graphemeCount <= 1) {
    metrics.breakableFitAdvances = null
    return metrics.breakableFitAdvances
  }
  const graphemes: string[] = []
  for (let i = 0, start = 0; i < graphemeCount; start = ends[i++]!) graphemes.push(seg.slice(start, ends[i]!))
  if (withLineStartProhibitions) {
    let prohibitions: number[] | null = null
    for (let i = 1; i < graphemes.length; i++) if (!canWebKitLineStartWith(graphemes[i]!.charCodeAt(0))) (prohibitions ??= []).push(i)
    metrics.lineStartProhibitions = prohibitions
  }

  if (mode === 'sum-graphemes') {
    const advances: number[] = []
    for (const grapheme of graphemes) {
      const graphemeMetrics = getSegmentMetrics(grapheme, cache)
      advances.push(getCorrectedSegmentWidth(grapheme, graphemeMetrics, emojiCorrection))
    }
    if (followingSpaceWidth !== null) addFollowingSpaceKerning(advances, seg, metrics, cache, followingSpaceWidth)
    metrics.breakableFitAdvances = advances
    return metrics.breakableFitAdvances
  }

  if (mode === 'pair-context' || graphemes.length > MAX_PREFIX_FIT_GRAPHEMES) {
    const advances: number[] = []
    let previousGrapheme: string | null = null
    let previousWidth = 0

    for (const grapheme of graphemes) {
      const graphemeMetrics = getSegmentMetrics(grapheme, cache)
      const currentWidth = getCorrectedSegmentWidth(grapheme, graphemeMetrics, emojiCorrection)

      if (previousGrapheme === null) {
        advances.push(currentWidth)
      } else {
        const pair = previousGrapheme + grapheme
        const pairMetrics = getSegmentMetrics(pair, cache)
        advances.push(getCorrectedSegmentWidth(pair, pairMetrics, emojiCorrection) - previousWidth)
      }

      previousGrapheme = grapheme
      previousWidth = currentWidth
    }

    if (followingSpaceWidth !== null) addFollowingSpaceKerning(advances, seg, metrics, cache, followingSpaceWidth)
    metrics.breakableFitAdvances = advances
    return metrics.breakableFitAdvances
  }

  const advances: number[] = []
  let prefix = ''
  let prefixWidth = 0

  for (let i = 0; i < graphemes.length; i++) {
    prefix += graphemes[i]!
    // The whole segment is the last prefix; with a following space it was
    // measured together with that space.
    const nextPrefixWidth = followingSpaceWidth !== null && i === graphemes.length - 1
      ? getCorrectedSegmentWidth(seg, metrics, emojiCorrection) - followingSpaceWidth
      : getCorrectedSegmentWidth(prefix, getSegmentMetrics(prefix, cache), emojiCorrection)
    advances.push(nextPrefixWidth - prefixWidth)
    prefixWidth = nextPrefixWidth
  }

  metrics.breakableFitAdvances = advances
  return metrics.breakableFitAdvances
}

// Advances that do not end in the whole segment's width take the kerning as a
// difference, which needs the segment measured alone too.
function addFollowingSpaceKerning(
  advances: number[],
  seg: string,
  followingSpaceMetrics: SegmentMetrics,
  cache: Map<string, SegmentMetrics>,
  followingSpaceWidth: number,
): void {
  const last = advances.length - 1
  advances[last] = advances[last]! + followingSpaceMetrics.width - getSegmentMetrics(seg, cache).width - followingSpaceWidth
}

export function getFontMeasurement(font: string, documentLanguage: string | null): FontMeasurement {
  // Preparation starts here, with the page language it read. After that language
  // changes, start again with a new context and empty caches; clearing the caches
  // alone would re-measure with fonts resolved under the old language.
  if (measureContext !== null && documentLanguage !== measureContextLanguage) {
    measureContext = null
    clearMeasurementCaches()
  }
  const ctx = measureContext ?? createMeasureContext(documentLanguage)
  let measurement = fontMeasurements.get(font)
  if (measurement === undefined) {
    const canvasFont = measureContextGenericFamilies === null ? font : getCanvasFont(font, measureContextGenericFamilies)
    measurement = { canvasFont, metrics: new Map(), followingSpaceMetrics: new Map(), emojiCorrection: null, hanKerning: undefined }
    fontMeasurements.set(font, measurement)
  }
  ctx.font = measurement.canvasFont
  return measurement
}

export function clearMeasurementCaches(): void {
  fontMeasurements.clear()
}
