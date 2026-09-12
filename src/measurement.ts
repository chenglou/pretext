import { getSharedGraphemeSegmenter } from './analysis.js'
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
  geckoAsciiLineBreaks: boolean
  lineFitEpsilon: number
  carryCJKAfterClosingQuote: boolean
  breakKeepAllAfterPunctuation: boolean
  // Under keep-all, Gecko's ICU4X keeps letter pairs by line-break class and
  // breaks after NS letters such as U+3005. Blink keeps any pair of letters.
  breakKeepAllAfterNonstarterLetters: boolean
  // WebKit keeps a basic combining mark after a ZWSP that starts a text node or
  // follows a mandatory break. Gecko keeps ZWSP with any following cluster
  // extender in every position; that granularity is not modeled.
  keepZeroWidthSpaceMarkAtScanStart: boolean
  // Chromium's ICU root line rules are the normal rules, where small kana and
  // U+30FC (CJ) resolve to ID. WebKit's root rules and Gecko's auto are strict.
  breakBeforeConditionalJapaneseStarter: boolean
  // Letters that keep a word-initial hyphen (LB20a). 'alphabetic-and-hebrew'
  // models ICU 78, which Chromium and WebKit use: AL and HL letters after
  // U+002D or any Unicode 17 HH dash. It is also the default without a
  // navigator. 'none' models Gecko, whose ICU4X rules have no LB20a.
  // 'alphabetic' keeps only AL letters, as ICU 77 did, but ICU 77 also counted
  // only U+2010 as HH, so no engine profile selects it.
  wordInitialHyphenLetters: 'none' | 'alphabetic' | 'alphabetic-and-hebrew'
  // WebKit's line-break scan reads the source text, where a TAB that normal
  // white space collapses is still UAX #14 BA, not a LB20a context. Chromium
  // breaks the collapsed text, where it is a space.
  breakHyphenAfterCollapsedTab: boolean
  preferPrefixWidthsForBreakableRuns: boolean
  // WebKit measures a text item together with a directly following U+0020 and
  // subtracts one unshaped space, so the item keeps its kerning with that space
  // wherever the line ends. Blink also kerns there, but in its default state its
  // Canvas splits words at spaces and shows none of it; Gecko shapes words
  // without their spaces.
  measureTextWithFollowingSpace: boolean
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

const emojiPresentationRe = /\p{Emoji_Presentation}/u
const maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u
const emojiCorrectionCache = new Map<string, number>()

function getDocumentLanguage(): string | null {
  if (typeof document === 'undefined') return null
  const root = document.documentElement as HTMLElement | null | undefined
  return root == null || typeof root.lang !== 'string' ? null : root.lang
}

export function getMeasureContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (measureContext !== null) return measureContext
  measureContextLanguage = getDocumentLanguage()

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

export function getEngineProfile(): EngineProfile {
  if (cachedEngineProfile !== null) return cachedEngineProfile

  if (typeof navigator === 'undefined') {
    cachedEngineProfile = {
      entryFitBasis: 'disabled',
      geckoAsciiLineBreaks: false,
      lineFitEpsilon: 0.005,
      carryCJKAfterClosingQuote: false,
      breakKeepAllAfterPunctuation: true,
      breakKeepAllAfterNonstarterLetters: false,
      keepZeroWidthSpaceMarkAtScanStart: false,
      breakBeforeConditionalJapaneseStarter: false,
      wordInitialHyphenLetters: 'alphabetic-and-hebrew',
      breakHyphenAfterCollapsedTab: false,
      preferPrefixWidthsForBreakableRuns: false,
      measureTextWithFollowingSpace: false,
    }
    return cachedEngineProfile
  }

  const ua = navigator.userAgent
  const vendor = navigator.vendor
  const isSafari =
    vendor === 'Apple Computer, Inc.' &&
    ua.includes('Safari/') &&
    !ua.includes('Chrome/') &&
    !ua.includes('Chromium/') &&
    !ua.includes('CriOS/') &&
    !ua.includes('FxiOS/') &&
    !ua.includes('EdgiOS/')
  const isChromium =
    ua.includes('Chrome/') ||
    ua.includes('Chromium/') ||
    ua.includes('CriOS/') ||
    ua.includes('Edg/')
  const isGecko = ua.includes('Firefox/') && !ua.includes('FxiOS/')
  // iOS browsers lay out with WebKit and the system ICU, whatever their brand.
  const isIOSBrand = /CriOS\/|FxiOS\/|EdgiOS\//.test(ua)
  const isWebKitLayout = isSafari || isIOSBrand

  // Fresh-entry observations are verified only for desktop engines. Keep
  // mobile brands (including desktop-requesting iOS browsers) on the old path.
  const isDesktop = /Windows NT|Macintosh|X11/.test(ua) &&
    !/Android|Mobile|iPhone|iPad|iPod|CriOS\/|FxiOS\/|EdgiOS\//.test(ua)

  cachedEngineProfile = {
    entryFitBasis: isDesktop && isChromium ? 'fresh' : isDesktop && isGecko ? 'original' : 'disabled',
    geckoAsciiLineBreaks: isGecko,
    lineFitEpsilon: isSafari ? 1 / 64 : 0.005,
    carryCJKAfterClosingQuote: isChromium,
    breakKeepAllAfterPunctuation: !isSafari,
    breakKeepAllAfterNonstarterLetters: isGecko,
    keepZeroWidthSpaceMarkAtScanStart: isSafari,
    breakBeforeConditionalJapaneseStarter: isChromium && !isIOSBrand,
    wordInitialHyphenLetters: isGecko ? 'none' : 'alphabetic-and-hebrew',
    breakHyphenAfterCollapsedTab: isWebKitLayout,
    preferPrefixWidthsForBreakableRuns: isSafari,
    measureTextWithFollowingSpace: isSafari,
  }
  return cachedEngineProfile
}

export function parseFontSize(font: string): number {
  // A failed size can restart at the next digit run, not at every digit in it.
  const m = font.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

function isEmojiGrapheme(g: string): boolean {
  return emojiPresentationRe.test(g) || g.includes('\uFE0F')
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

export function getFontMeasurementState(font: string, needsEmojiCorrection: boolean): {
  cache: Map<string, SegmentMetrics>
  emojiCorrection: number
} {
  // Preparation starts here. After the page language changes, start again with
  // a new context and empty caches; clearing the caches alone would re-measure
  // with fonts resolved under the old language.
  if (measureContext !== null && getDocumentLanguage() !== measureContextLanguage) {
    measureContext = null
    clearMeasurementCaches()
  }
  const ctx = getMeasureContext()
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
