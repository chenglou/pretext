import { isCJK } from './analysis.js'

export type SegmentMetrics = {
  width: number
  containsCJK: boolean
  emojiCount?: number
  graphemeWidths?: number[] | null
  graphemePrefixWidths?: number[] | null
}

export type EngineProfile = {
  lineFitEpsilon: number
  carryCJKAfterClosingQuote: boolean
  preferPrefixWidthsForBreakableRuns: boolean
  preferEarlySoftHyphenBreak: boolean
}

let measureContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
const segmentMetricCaches = new Map<string, Map<string, SegmentMetrics>>()
let cachedEngineProfile: EngineProfile | null = null

const emojiPresentationRe = /\p{Emoji_Presentation}/u
const maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u
let sharedGraphemeSegmenter: Intl.Segmenter | null = null
const emojiCorrectionCache = new Map<string, number>()

export function getMeasureContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (measureContext !== null) return measureContext

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

export function getSegmentMetricCache(font: string): Map<string, SegmentMetrics> {
  let cache = segmentMetricCaches.get(font)
  if (!cache) {
    cache = new Map()
    segmentMetricCaches.set(font, cache)
  }
  return cache
}

export function getSegmentMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics {
  let metrics = cache.get(seg)
  if (metrics === undefined) {
    const ctx = getMeasureContext()
    metrics = {
      width: ctx.measureText(seg).width,
      containsCJK: isCJK(seg),
    }
    cache.set(seg, metrics)
  }
  return metrics
}

export function getEngineProfile(): EngineProfile {
  if (cachedEngineProfile !== null) return cachedEngineProfile

  if (typeof navigator === 'undefined') {
    cachedEngineProfile = {
      lineFitEpsilon: 0.005,
      carryCJKAfterClosingQuote: false,
      preferPrefixWidthsForBreakableRuns: false,
      preferEarlySoftHyphenBreak: false,
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

  cachedEngineProfile = {
    lineFitEpsilon: isSafari ? 1 / 64 : 0.005,
    carryCJKAfterClosingQuote: isChromium,
    preferPrefixWidthsForBreakableRuns: isSafari,
    preferEarlySoftHyphenBreak: isSafari,
  }
  return cachedEngineProfile
}

export function parseFontSize(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

function getSharedGraphemeSegmenter(): Intl.Segmenter {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  }
  return sharedGraphemeSegmenter
}

function isEmojiGrapheme(g: string): boolean {
  return emojiPresentationRe.test(g) || g.includes('\uFE0F')
}

export function textMayContainEmoji(text: string): boolean {
  return maybeEmojiRe.test(text)
}

function getEmojiCorrection(font: string, fontSize: number): number {
  let correction = emojiCorrectionCache.get(font)
  if (correction !== undefined) return correction

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

export function getSegmentGraphemeWidths(
  seg: string,
  metrics: SegmentMetrics,
  cache: Map<string, SegmentMetrics>,
  emojiCorrection: number,
): number[] | null {
  if (metrics.graphemeWidths !== undefined) return metrics.graphemeWidths

  const widths: number[] = []
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  for (const gs of graphemeSegmenter.segment(seg)) {
    const graphemeMetrics = getSegmentMetrics(gs.segment, cache)
    widths.push(getCorrectedSegmentWidth(gs.segment, graphemeMetrics, emojiCorrection))
  }

  metrics.graphemeWidths = widths.length > 1 ? widths : null
  return metrics.graphemeWidths
}

export function getSegmentGraphemePrefixWidths(
  seg: string,
  metrics: SegmentMetrics,
  cache: Map<string, SegmentMetrics>,
  emojiCorrection: number,
): number[] | null {
  if (metrics.graphemePrefixWidths !== undefined) return metrics.graphemePrefixWidths

  const prefixWidths: number[] = []
  const graphemeSegmenter = getSharedGraphemeSegmenter()
  let prefix = ''
  for (const gs of graphemeSegmenter.segment(seg)) {
    prefix += gs.segment
    const prefixMetrics = getSegmentMetrics(prefix, cache)
    prefixWidths.push(getCorrectedSegmentWidth(prefix, prefixMetrics, emojiCorrection))
  }

  metrics.graphemePrefixWidths = prefixWidths.length > 1 ? prefixWidths : null
  return metrics.graphemePrefixWidths
}

export function getFontMeasurementState(font: string, needsEmojiCorrection: boolean): {
  cache: Map<string, SegmentMetrics>
  fontSize: number
  emojiCorrection: number
} {
  const ctx = getMeasureContext()
  ctx.font = font
  const cache = getSegmentMetricCache(font)
  const fontSize = parseFontSize(font)
  const emojiCorrection = needsEmojiCorrection ? getEmojiCorrection(font, fontSize) : 0
  return { cache, fontSize, emojiCorrection }
}

// Canvas-to-DOM shaping correction.  Canvas measureText and the browser's DOM
// rendering engine use different text shaping pipelines.  The DOM applies full
// HarfBuzz shaping (contextual alternates, ligatures, GPOS kerning) while
// canvas often uses a simpler pipeline.  The divergence varies by script —
// Arabic joining, Thai shaping, and Latin kerning all produce different deltas.
//
// Rather than hardcoding script-specific samples, we derive the correction
// from a small sample of the actual segments being prepared.  This naturally
// adapts to whatever script the text contains.  The sample text is concatenated
// and measured once via a hidden DOM span (one reflow), then compared against
// canvas measureText on the same string.  The resulting ratio is cached by
// (font, sampleText) so repeated prepare() calls on similar content hit cache.
//
// Cost: 1 DOM read per unique (font, sample) pair, then cached.

const shapingRatioCache = new Map<string, number>()

// Maximum chars to include in the sample (keeps DOM measurement fast)
const SAMPLE_CHAR_LIMIT = 200
// Number of segments to sample (spread across the text)
const SAMPLE_SEG_COUNT = 8

export function getShapingRatio(
  font: string,
  segments: string[],
  kinds: string[],
): number {
  // Build a sample from actual segments: pick up to SAMPLE_SEG_COUNT non-space
  // segments spread evenly across the text.
  const candidates: string[] = []
  for (let i = 0; i < segments.length; i++) {
    if (kinds[i] === 'space' || kinds[i] === 'tab' || kinds[i] === 'hard-break' ||
        kinds[i] === 'soft-hyphen' || kinds[i] === 'zero-width-break') continue
    candidates.push(segments[i]!)
  }
  if (candidates.length === 0) return 1

  let sample = ''
  const step = Math.max(1, Math.floor(candidates.length / SAMPLE_SEG_COUNT))
  for (let i = 0; i < candidates.length && sample.length < SAMPLE_CHAR_LIMIT; i += step) {
    if (sample.length > 0) sample += ' '
    sample += candidates[i]!
  }

  const cacheKey = font + '\0' + sample
  const cached = shapingRatioCache.get(cacheKey)
  if (cached !== undefined) return cached

  const ctx = getMeasureContext()
  ctx.font = font
  const canvasW = ctx.measureText(sample).width
  let ratio = 1

  if (
    canvasW > 0 &&
    typeof document !== 'undefined' &&
    document.body !== null
  ) {
    const span = document.createElement('span')
    span.style.font = font
    span.style.display = 'inline-block'
    span.style.visibility = 'hidden'
    span.style.position = 'absolute'
    span.style.whiteSpace = 'pre'
    span.textContent = sample
    document.body.appendChild(span)
    const domW = span.getBoundingClientRect().width
    document.body.removeChild(span)
    if (domW > 0) ratio = domW / canvasW
  }

  shapingRatioCache.set(cacheKey, ratio)
  return ratio
}

export function clearMeasurementCaches(): void {
  segmentMetricCaches.clear()
  emojiCorrectionCache.clear()
  shapingRatioCache.clear()
  sharedGraphemeSegmenter = null
}
