import {
  getSharedGraphemeSegmenter,
  type SegmentBreakRemovalRun,
} from './analysis.js'
import type { SegmentEntryGeometry } from './entry-geometry.js'

type EntryMeasurement = {
  profile: readonly (string | null)[]
  measure: (text: string) => number | null
}

const entryContextProperties = ['font', 'direction', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'wordSpacing', 'lang'] as const

export type SegmentMetrics = {
  width: number
  emojiCount?: number
  breakableFitMode?: BreakableFitMode
  breakableFitAdvances?: number[] | null
  entryGeometry?: {
    letterSpacing: number
    advances: readonly number[]
    emojiCorrection: number
    profile: EntryMeasurement['profile']
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
  lineFitEpsilon: number
  // Where an emergency break falls inside a segment. WebKit measures the word's grapheme
  // prefixes (TextUtil::breakWord), and Gecko adds the advances of the word shaped whole
  // (gfxTextRun::BreakAndMeasureText), which prefixes follow in joined scripts where
  // standalone graphemes don't. Blink sums standalone graphemes.
  preferPrefixWidthsForBreakableRuns: boolean
  // WebKit measures a text item together with a directly following U+0020 and
  // subtracts one unshaped space, so the item keeps its kerning with that space
  // wherever the line ends. Blink also kerns there, but in its default state its
  // Canvas splits words at spaces and shows none of it; Gecko shapes words
  // without their spaces.
  measureTextWithFollowingSpace: boolean
  // Blink and Gecko remove a collapsible newline run next to a ZWSP, each
  // through its own run. WebKit turns it into a space.
  segmentBreakRemovalRun: SegmentBreakRemovalRun
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
  // WebKit and Gecko also return to an earlier opportunity, at the full width,
  // but that is not modeled: their installed losses come from letter spacing
  // on invisibles and from marks after a soft hyphen, which isolated widths do
  // not show. They keep the overflowing hyphen.
  unfitHyphenRetreat: 'reduced-width' | 'none'
  // NEL (U+0085, UAX #14 NL) offers a break after itself and no ordinary break
  // before it (LB5, LB6), as the scans find. The WebKit profile gives NEL its own
  // control segment for letter spacing: WebKit's simple text path gives NEL no
  // letter spacing, at either sign, and its complex path spaces it. A NEL control
  // segment takes spacing after text or glue in WebKit's complex ranges, or before
  // such text that starts with a combining mark. Preparation cannot see the page
  // direction, so after complex text whose direction differs from the page's it
  // keeps spacing Safari omits. Blink spaces NEL outside cursive runs, and release
  // Gecko draws NEL with no advance while its Canvas measures a space, so both keep
  // NEL as ordinary text.
  breakOnlyAfterNextLine: boolean
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
  // Release Gecko draws C0 and C1 controls, U+2028 and U+2029 with no advance plus letter
  // spacing (gfxFont.cpp:3877-3892), where its Canvas measures VT, FS-US, NEL and U+2029 as a
  // space (CanvasRenderingContext2D.cpp:4570-4573) and other controls as a hexbox. Chrome and
  // Safari give most controls an advance on the page, as their Canvas does.
  hidesControlCharacters: boolean
  // Where rich-inline items break near a boundary. Blink runs one line-break
  // iterator over the text of the whole inline formatting context, and Gecko
  // collects a word across text frames until a space and breaks it in one pass,
  // so every break fact near a boundary comes from the joined text. WebKit finds
  // breaks inside each inline box from that box's own text, and decides a
  // boundary between boxes from the previous box's last two characters. Engines
  // Pretext doesn't recognize use the joined text, as Blink and Gecko do.
  inlineItemBreaks: 'joined-text' | 'item-text'
}

export type BreakableFitMode = 'sum-graphemes' | 'segment-prefixes' | 'pair-context'

let measureContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
// Canvas resolves fonts under the document language. Chrome keeps a resolved
// font while its font string is unchanged, so the context, and every width
// measured through it, belong to the language it was created under.
let measureContextLanguage: string | null = null
const segmentMetricCaches = new Map<string, Map<string, SegmentMetrics>>()
// Per font, metrics of a text item measured together with one following
// U+0020, keyed by the item alone. The width includes that space.
const followingSpaceMetricCaches = new Map<string, Map<string, SegmentMetrics>>()
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
const emojiCorrectionCache = new Map<string, number>()

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
    return measureContext
  }

  if (typeof document !== 'undefined') {
    measureContext = document.createElement('canvas').getContext('2d')!
    return measureContext
  }

  throw new Error('Text measurement requires OffscreenCanvas or a DOM canvas context.')
}

export function getEntryMeasurementProfile(): EntryMeasurement['profile'] | null {
  const original = getMeasureContext()
  if (!('letterSpacing' in original)) return null
  const source = original as unknown as Record<string, unknown>
  const profile: (string | null)[] = []
  for (const property of entryContextProperties) {
    if (!(property in original)) { profile.push(null); continue }
    const value = source[property]
    if (typeof value !== 'string') return null
    profile.push(value)
  }
  return profile
}

// Borrow the primary context only for each synchronous direct measurement.
// These observations never enter the unspaced segment cache, and letterSpacing
// is restored even when assignment or measurement fails.
export function createEntryMeasurement(
  letterSpacing: number,
  emojiCorrection: number,
  profile: EntryMeasurement['profile'] | null = getEntryMeasurementProfile(),
): EntryMeasurement | null {
  if (profile === null || !Number.isFinite(letterSpacing)) return null
  const primary = getMeasureContext()
  if (!('letterSpacing' in primary)) return null
  return {
    profile,
    measure: text => {
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
    },
  }
}

export function entryMeasurementProfilesMatch(a: EntryMeasurement['profile'], b: EntryMeasurement['profile']): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function getSegmentMetricCache(font: string): Map<string, SegmentMetrics> {
  let cache = segmentMetricCaches.get(font)
  if (!cache) {
    cache = new Map()
    segmentMetricCaches.set(font, cache)
  }
  return cache
}

export function getFollowingSpaceMetricCache(font: string): Map<string, SegmentMetrics> {
  let cache = followingSpaceMetricCaches.get(font)
  if (!cache) {
    cache = new Map()
    followingSpaceMetricCaches.set(font, cache)
  }
  return cache
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
    lineFitEpsilon: engine === 'webkit' ? 1 / 64 : 0.005,
    preferPrefixWidthsForBreakableRuns: engine === 'webkit' || engine === 'gecko',
    measureTextWithFollowingSpace: engine === 'webkit',
    segmentBreakRemovalRun: engine === 'blink' ? 'blink' : engine === 'gecko' ? 'gecko' : 'none',
    letterSpaceDiscretionaryHyphen: engine !== 'blink',
    shapesMarksAcrossSoftHyphen: engine !== 'webkit' && engine !== 'gecko',
    unfitHyphenRetreat: engine === 'blink' ? 'reduced-width' : 'none',
    breakOnlyAfterNextLine: engine === 'webkit',
    skipNarrowTabStops: engine === 'webkit',
    hangTabs: engine !== 'gecko',
    zeroWidthGlueTakesLine: engine !== 'gecko',
    hidesControlCharacters: engine === 'gecko',
    inlineItemBreaks: engine === 'webkit' ? 'item-text' : 'joined-text',
  }
  cachedEngineProfile = profile
  return profile
}

export function parseFontSize(font: string): number {
  // A failed size can restart at the next digit run, not at every digit in it.
  const m = font.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

function isEmojiGrapheme(g: string): boolean {
  return emojiGraphemeRe.test(g)
}

export function textMayContainEmoji(text: string): boolean {
  return maybeEmojiRe.test(text)
}

function getEmojiCorrection(font: string): number {
  let correction = emojiCorrectionCache.get(font)
  if (correction !== undefined) return correction

  const fontSize = parseFontSize(font)
  const ctx = getMeasureContext()
  ctx.font = font
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
  emojiCorrectionCache.set(font, correction)
  return correction
}

function countEmojiGraphemes(text: string): number {
  let count = 0
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const g of graphemeSegmenter.segment(text)) {
    if (isEmojiGrapheme(g.segment)) count++
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
): number[] | null {
  if (metrics.breakableFitAdvances !== undefined && metrics.breakableFitMode === mode) {
    return metrics.breakableFitAdvances
  }
  metrics.breakableFitMode = mode

  const graphemeSegmenter = getSharedGraphemeSegmenter()
  const graphemes: string[] = []
  for (const gs of graphemeSegmenter.segment(seg)) {
    graphemes.push(gs.segment)
  }
  if (graphemes.length <= 1) {
    metrics.breakableFitAdvances = null
    return metrics.breakableFitAdvances
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

export function getFontMeasurementState(font: string, needsEmojiCorrection: boolean, documentLanguage: string | null): {
  cache: Map<string, SegmentMetrics>
  emojiCorrection: number
} {
  // Preparation starts here, with the page language it read. After that language
  // changes, start again with a new context and empty caches; clearing the caches
  // alone would re-measure with fonts resolved under the old language.
  if (measureContext !== null && documentLanguage !== measureContextLanguage) {
    measureContext = null
    clearMeasurementCaches()
  }
  const ctx = measureContext ?? createMeasureContext(documentLanguage)
  ctx.font = font
  const cache = getSegmentMetricCache(font)
  const emojiCorrection = needsEmojiCorrection ? getEmojiCorrection(font) : 0
  return { cache, emojiCorrection }
}

export function clearMeasurementCaches(): void {
  segmentMetricCaches.clear()
  followingSpaceMetricCaches.clear()
  emojiCorrectionCache.clear()
}
