// Text measurement for browser environments using canvas measureText.
//
// Problem: DOM-based text measurement (getBoundingClientRect, offsetHeight)
// forces synchronous layout reflow. When components independently measure text,
// each measurement triggers a reflow of the entire document. This creates
// read/write interleaving that can cost 30ms+ per frame for 500 text blocks.
//
// Solution: two-phase measurement centered around canvas measureText.
//   prepare(text, font) — segments text via Intl.Segmenter, measures each word
//     via canvas, caches widths, and does one cached DOM calibration read per
//     font when emoji correction is needed. Call once when text first appears.
//   layout(prepared, maxWidth) — walks cached word widths with pure arithmetic
//     to count lines and compute height. Call on every resize. ~0.0002ms per text.
//
// i18n: Intl.Segmenter handles CJK (per-character breaking), Thai, Arabic, etc.
//   Bidi: Unicode Bidirectional Algorithm for mixed LTR/RTL text.
//   Punctuation merging: "better." measured as one unit (matches CSS behavior).
//   Trailing whitespace: hangs past line edge without triggering breaks (CSS behavior).
//   overflow-wrap: pre-measured grapheme widths enable character-level word breaking.
//
// Emoji correction: Chrome/Firefox canvas measures emoji wider than DOM at font
//   sizes <24px on macOS (Apple Color Emoji). The inflation is constant per emoji
//   grapheme at a given size, font-independent. Auto-detected by comparing canvas
//   vs actual DOM emoji width (one cached DOM read per font). Safari canvas and
//   DOM agree (both wider than fontSize), so correction = 0 there.
//
// Limitations:
//   - system-ui font: canvas resolves to different optical variants than DOM on macOS.
//     Use named fonts (Helvetica, Inter, etc.) for guaranteed accuracy.
//
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).

const canvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(1, 1)
  : document.createElement('canvas')
const ctx = canvas.getContext('2d')!

// Word width cache: font → Map<segment, width>.
// Persists across prepare() calls. Common words ("the", "a", etc.) are measured
// once and shared across all text blocks. Survives resize since font doesn't change.
// No eviction: grows monotonically per font. Typical single-font feed ≈ few KB.
// Call clearCache() to reclaim if needed (e.g. font change, long session).

const wordCaches = new Map<string, Map<string, number>>()

function getWordCache(font: string): Map<string, number> {
  let cache = wordCaches.get(font)
  if (!cache) {
    cache = new Map()
    wordCaches.set(font, cache)
  }
  return cache
}

function measureSegment(seg: string, cache: Map<string, number>): number {
  let w = cache.get(seg)
  if (w === undefined) {
    w = ctx.measureText(seg).width
    cache.set(seg, w)
  }
  return w
}

function parseFontSize(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/)
  return m ? parseFloat(m[1]!) : 16
}

// Emoji correction: canvas measureText inflates emoji widths on Chrome/Firefox
// at font sizes <24px on macOS. The inflation is per-emoji-grapheme, constant
// across all emoji types (simple, ZWJ, flags, skin tones, keycaps) and all font
// families. Auto-detected by comparing canvas vs DOM emoji width (one cached
// DOM read per font). Safari canvas and DOM agree, so correction = 0.

const emojiPresentationRe = /\p{Emoji_Presentation}/u
// Shared segmenters: hoisted to module level to avoid per-prepare() construction.
// Intl.Segmenter construction loads ICU data internally — expensive to repeat.
// Captures the default locale at module load time. If locale support is needed
// in the future, expose a function to reinitialize these with a new locale.
const sharedWordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const sharedGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function isEmojiGrapheme(g: string): boolean {
  return emojiPresentationRe.test(g) || g.includes('\uFE0F')
}

const emojiCorrectionCache = new Map<string, number>()

function getEmojiCorrection(font: string, fontSize: number): number {
  let correction = emojiCorrectionCache.get(font)
  if (correction !== undefined) return correction

  ctx.font = font
  const canvasW = ctx.measureText('\u{1F600}').width
  correction = 0
  if (canvasW > fontSize + 0.5) {
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
  for (const g of sharedGraphemeSegmenter.segment(text)) {
    if (isEmojiGrapheme(g.segment)) count++
  }
  return count
}

// CJK characters don't use spaces between words. Intl.Segmenter with
// granularity 'word' groups them into multi-character words, but CSS allows
// line breaks between any CJK characters. We detect CJK segments and split
// them into individual graphemes so each character is a valid break point.

function isCJK(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if ((c >= 0x4E00 && c <= 0x9FFF) ||   // CJK Unified
        (c >= 0x3400 && c <= 0x4DBF) ||   // CJK Extension A
        (c >= 0x3000 && c <= 0x303F) ||   // CJK Punctuation
        (c >= 0x3040 && c <= 0x309F) ||   // Hiragana
        (c >= 0x30A0 && c <= 0x30FF) ||   // Katakana
        (c >= 0xAC00 && c <= 0xD7AF) ||   // Hangul
        (c >= 0xFF00 && c <= 0xFFEF)) {   // Fullwidth
      return true
    }
  }
  return false
}

function isWhitespace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D && c !== 0x0C && c !== 0xA0) {
      return false
    }
  }
  return true
}

// Kinsoku shori (禁則処理): CJK line-breaking rules.
// Line-start prohibition: these characters cannot start a new line.
// To prevent this, they are merged with the preceding grapheme during
// CJK splitting, keeping them together as one unit.
const kinsokuStart = new Set([
  // Fullwidth punctuation
  '\uFF0C', // ，
  '\uFF0E', // ．
  '\uFF01', // ！
  '\uFF1A', // ：
  '\uFF1B', // ；
  '\uFF1F', // ？
  // CJK punctuation
  '\u3001', // 、
  '\u3002', // 。
  '\u30FB', // ・
  // Closing brackets
  '\uFF09', // ）
  '\u3015', // 〕
  '\u3009', // 〉
  '\u300B', // 》
  '\u300D', // 」
  '\u300F', // 』
  '\u3011', // 】
  '\u3017', // 〗
  '\u3019', // 〙
  '\u301B', // 〛
  // Prolonged sound mark, iteration marks
  '\u30FC', // ー
  '\u3005', // 々
  '\u303B', // 〻
])

// Line-end prohibition: these characters cannot end a line (UAX #14 class OP +
// CJK opening brackets). To prevent this, they are merged with the following
// grapheme in CJK splitting, and with the following word in general merging.
const kinsokuEnd = new Set([
  // ASCII/Latin
  '(', '[', '{',
  // CJK fullwidth
  '\uFF08', // （
  '\u3014', // 〔
  '\u3008', // 〈
  '\u300A', // 《
  '\u300C', // 「
  '\u300E', // 『
  '\u3010', // 【
  '\u3016', // 〖
  '\u3018', // 〘
  '\u301A', // 〚
])

// Unicode Bidirectional Algorithm (UAX #9), forked from pdf.js via Sebastian's
// text-layout. Classifies characters into bidi types, computes embedding levels,
// and reorders segments within each line for correct visual display of mixed
// LTR/RTL text. Only needed for paragraphs containing RTL characters; pure LTR
// text fast-paths with null levels (zero overhead).

type BidiType = 'L' | 'R' | 'AL' | 'AN' | 'EN' | 'ES' | 'ET' | 'CS' |
                'ON' | 'BN' | 'B' | 'S' | 'WS' | 'NSM'

const baseTypes: BidiType[] = [
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','S','B','S','WS',
  'B','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','BN','B','B','B','S','WS','ON','ON','ET','ET','ET','ON',
  'ON','ON','ON','ON','ON','CS','ON','CS','ON','EN','EN','EN',
  'EN','EN','EN','EN','EN','EN','EN','ON','ON','ON','ON','ON',
  'ON','ON','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','ON','ON',
  'ON','ON','ON','ON','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','ON','ON','ON','ON','BN','BN','BN','BN','BN','BN','B','BN',
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN','BN',
  'BN','CS','ON','ET','ET','ET','ET','ON','ON','ON','ON','L','ON',
  'ON','ON','ON','ON','ET','ET','EN','EN','ON','L','ON','ON','ON',
  'EN','L','ON','ON','ON','ON','ON','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','ON','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','L','L','L','L','L','L','L','L','L','L','L','L',
  'L','L','L','ON','L','L','L','L','L','L','L','L'
]

const arabicTypes: BidiType[] = [
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'CS','AL','ON','ON','NSM','NSM','NSM','NSM','NSM','NSM','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','NSM','NSM','NSM','NSM','NSM','NSM','NSM',
  'NSM','NSM','NSM','NSM','NSM','NSM','NSM','AL','AL','AL','AL',
  'AL','AL','AL','AN','AN','AN','AN','AN','AN','AN','AN','AN',
  'AN','ET','AN','AN','AL','AL','AL','NSM','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM',
  'NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','NSM','ON','NSM',
  'NSM','NSM','NSM','AL','AL','AL','AL','AL','AL','AL','AL','AL',
  'AL','AL','AL','AL','AL','AL','AL','AL','AL'
]

function classifyChar(charCode: number): BidiType {
  if (charCode <= 0x00ff) return baseTypes[charCode]!
  if (0x0590 <= charCode && charCode <= 0x05f4) return 'R'
  if (0x0600 <= charCode && charCode <= 0x06ff) return arabicTypes[charCode & 0xff]!
  if (0x0700 <= charCode && charCode <= 0x08AC) return 'AL'
  return 'L'
}

function computeBidiLevels(str: string): Int8Array | null {
  const len = str.length
  if (len === 0) return null

  // eslint-disable-next-line unicorn/no-new-array
  const types: BidiType[] = new Array(len)
  let numBidi = 0

  for (let i = 0; i < len; i++) {
    const t = classifyChar(str.charCodeAt(i))
    if (t === 'R' || t === 'AL' || t === 'AN') numBidi++
    types[i] = t
  }

  if (numBidi === 0) return null

  const startLevel = (len / numBidi) < 0.3 ? 0 : 1
  const levels = new Int8Array(len)
  for (let i = 0; i < len; i++) levels[i] = startLevel

  const e: BidiType = (startLevel & 1) ? 'R' : 'L'
  const sor = e

  // W1-W7
  let lastType: BidiType = sor
  for (let i = 0; i < len; i++) { if (types[i] === 'NSM') types[i] = lastType; else lastType = types[i]! }
  lastType = sor
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'EN') types[i] = lastType === 'AL' ? 'AN' : 'EN'; else if (t === 'R' || t === 'L' || t === 'AL') lastType = t }
  for (let i = 0; i < len; i++) { if (types[i] === 'AL') types[i] = 'R' }
  for (let i = 1; i < len - 1; i++) { if (types[i] === 'ES' && types[i-1] === 'EN' && types[i+1] === 'EN') types[i] = 'EN'; if (types[i] === 'CS' && (types[i-1] === 'EN' || types[i-1] === 'AN') && types[i+1] === types[i-1]) types[i] = types[i-1]! }
  for (let i = 0; i < len; i++) { if (types[i] === 'EN') { let j; for (j = i-1; j >= 0 && types[j] === 'ET'; j--) types[j] = 'EN'; for (j = i+1; j < len && types[j] === 'ET'; j++) types[j] = 'EN' } }
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'WS' || t === 'ES' || t === 'ET' || t === 'CS') types[i] = 'ON' }
  lastType = sor
  for (let i = 0; i < len; i++) { const t = types[i]!; if (t === 'EN') types[i] = lastType === 'L' ? 'L' : 'EN'; else if (t === 'R' || t === 'L') lastType = t }

  // N1-N2
  for (let i = 0; i < len; i++) {
    if (types[i] === 'ON') {
      let end = i + 1
      while (end < len && types[end] === 'ON') end++
      const before: BidiType = i > 0 ? types[i-1]! : sor
      const after: BidiType = end < len ? types[end]! : sor
      const bDir: BidiType = before !== 'L' ? 'R' : 'L'
      const aDir: BidiType = after !== 'L' ? 'R' : 'L'
      if (bDir === aDir) { for (let j = i; j < end; j++) types[j] = bDir }
      i = end - 1
    }
  }
  for (let i = 0; i < len; i++) { if (types[i] === 'ON') types[i] = e }

  // I1-I2
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if ((levels[i]! & 1) === 0) {
      if (t === 'R') levels[i]!++
      else if (t === 'AN' || t === 'EN') levels[i]! += 2
    } else {
      if (t === 'L' || t === 'AN' || t === 'EN') levels[i]!++
    }
  }

  return levels
}

// --- Public types ---

export type PreparedText = {
  widths: number[]
  isSpace: boolean[]
  segLevels: Int8Array | null
  breakableWidths: (number[] | null)[]
  lineHeight: number
}

export type PreparedTextWithSegments = PreparedText & {
  segments: string[]
}

export type LayoutResult = {
  lineCount: number
  height: number
}

export type LayoutLine = {
  text: string
  width: number
}

export type LayoutLinesResult = LayoutResult & {
  lineHeight: number
  lines: LayoutLine[]
}

// --- Public API ---

function prepareInternal(text: string, font: string, lineHeight: number | undefined, includeSegments: boolean): PreparedText | PreparedTextWithSegments {
  ctx.font = font
  const cache = getWordCache(font)
  const fontSize = parseFontSize(font)

  if (lineHeight === undefined) {
    lineHeight = Math.round(fontSize * 1.2)
  }

  const emojiCorrection = getEmojiCorrection(font, fontSize)

  // CSS white-space: normal collapses newlines to spaces.
  const normalized = text.replace(/\n/g, ' ')

  if (normalized.length === 0 || normalized.trim().length === 0) {
    if (includeSegments) {
      return { widths: [], isSpace: [], segLevels: null, breakableWidths: [], lineHeight, segments: [] }
    }
    return { widths: [], isSpace: [], segLevels: null, breakableWidths: [], lineHeight }
  }

  // Output arrays — segments get pushed here after merging/splitting.
  const widths: number[] = []
  const isSpace: boolean[] = []
  const segStarts: number[] = []
  const breakableWidths: (number[] | null)[] = []
  const segments = includeSegments ? [] as string[] : null

  // Phase 1: merge punctuation into preceding word-like segments.
  // Iterate the segmenter directly — no intermediate array allocation.
  // Parallel arrays instead of object allocations.
  let mergedLen = 0
  const mergedTexts: string[] = []
  const mergedWordLike: boolean[] = []
  const mergedSpace: boolean[] = []
  const mergedStarts: number[] = []

  for (const s of sharedWordSegmenter.segment(normalized)) {
    const ws = !s.isWordLike && isWhitespace(s.segment)

    if (!s.isWordLike && !ws && mergedLen > 0 && mergedWordLike[mergedLen - 1]!) {
      mergedTexts[mergedLen - 1] += s.segment
    } else {
      mergedTexts[mergedLen] = s.segment
      mergedWordLike[mergedLen] = s.isWordLike ?? false
      mergedSpace[mergedLen] = ws
      mergedStarts[mergedLen] = s.index
      mergedLen++
    }
  }

  // Forward-merge opening brackets with the following segment (UAX #14: opening
  // punctuation can't end a line). E.g. "(" + "approximately" → "(approximately".
  // Mark deleted entries with empty string instead of shifting (O(1) vs O(n)).
  for (let i = mergedLen - 2; i >= 0; i--) {
    if (!mergedSpace[i]! && !mergedWordLike[i]! && mergedTexts[i]!.length === 1 && kinsokuEnd.has(mergedTexts[i]!)) {
      mergedTexts[i + 1] = mergedTexts[i]! + mergedTexts[i + 1]!
      mergedStarts[i + 1] = mergedStarts[i]!
      mergedTexts[i] = '' // mark deleted
    }
  }

  // Phase 2: expand CJK into graphemes, measure everything.
  for (let mi = 0; mi < mergedLen; mi++) {
    const segText = mergedTexts[mi]!
    if (segText.length === 0) continue // skip deleted entries

    const segWordLike = mergedWordLike[mi]!
    const segIsSpace = mergedSpace[mi]!
    const segStart = mergedStarts[mi]!

    if (isCJK(segText)) {
      // Split CJK into individual graphemes for per-character line breaks.
      // Apply kinsoku shori in a single pass: collect graphemes into a temporary
      // array (needed for lookahead on kinsokuEnd), then merge and push to output.
      let gLen = 0
      const gTexts: string[] = []
      const gStarts: number[] = []
      for (const gs of sharedGraphemeSegmenter.segment(segText)) {
        gTexts[gLen] = gs.segment
        gStarts[gLen] = gs.index
        gLen++
      }

      // Kinsoku merge + push to output in one pass
      for (let gi = 0; gi < gLen; gi++) {
        let unitText = gTexts[gi]!
        const unitStart = gStarts[gi]!

        if (kinsokuEnd.has(unitText) && gi + 1 < gLen) {
          unitText += gTexts[gi + 1]!
          gi++
        }
        // Check if the NEXT grapheme is a kinsoku-start char — absorb it
        while (gi + 1 < gLen && kinsokuStart.has(gTexts[gi + 1]!)) {
          unitText += gTexts[gi + 1]!
          gi++
        }

        let w = measureSegment(unitText, cache)
        if (emojiCorrection > 0 && isEmojiGrapheme(unitText)) {
          w -= emojiCorrection
        }
        widths.push(w)
        isSpace.push(false)
        segStarts.push(segStart + unitStart)
        breakableWidths.push(null)
        if (segments !== null) segments.push(unitText)
      }
    } else {
      let w = measureSegment(segText, cache)
      if (emojiCorrection > 0 && emojiPresentationRe.test(segText)) {
        w -= countEmojiGraphemes(segText) * emojiCorrection
      }
      widths.push(w)
      isSpace.push(segIsSpace)
      segStarts.push(segStart)
      if (segWordLike && segText.length > 1) {
        // Pre-measure graphemes for overflow-wrap: break-word.
        let gCount = 0
        let gWidths: number[] | null = null
        for (const gs of sharedGraphemeSegmenter.segment(segText)) {
          if (gCount === 0) gWidths = []
          let gw = measureSegment(gs.segment, cache)
          if (emojiCorrection > 0 && isEmojiGrapheme(gs.segment)) {
            gw -= emojiCorrection
          }
          gWidths![gCount] = gw
          gCount++
        }
        breakableWidths.push(gCount > 1 ? gWidths : null)
      } else {
        breakableWidths.push(null)
      }
      if (segments !== null) segments.push(segText)
    }
  }

  const bidiLevels = computeBidiLevels(normalized)
  let segLevels: Int8Array | null = null

  if (bidiLevels !== null) {
    segLevels = new Int8Array(widths.length)
    for (let i = 0; i < widths.length; i++) {
      segLevels[i] = bidiLevels[segStarts[i]!]!
    }
  }

  if (segments !== null) {
    return { widths, isSpace, segLevels, breakableWidths, lineHeight, segments }
  }
  return { widths, isSpace, segLevels, breakableWidths, lineHeight }
}

// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth via layout().
//
// Steps:
//   1. Normalize newlines to spaces (CSS white-space: normal behavior)
//   2. Segment via Intl.Segmenter (handles CJK, Thai, etc.)
//   3. Merge punctuation into preceding word ("better." as one unit)
//   4. Split CJK words into individual graphemes (per-character line breaks)
//   5. Measure each segment via canvas measureText, cache by (segment, font)
//   6. Pre-measure graphemes of long words (for overflow-wrap: break-word)
//   7. Correct emoji canvas inflation (auto-detected per font size)
//   8. Compute bidi embedding levels for mixed-direction text
export function prepare(text: string, font: string, lineHeight?: number): PreparedText {
  return prepareInternal(text, font, lineHeight, false) as PreparedText
}

// Rich variant used by callers that need enough information to render the
// laid-out lines themselves.
export function prepareWithSegments(text: string, font: string, lineHeight?: number): PreparedTextWithSegments {
  return prepareInternal(text, font, lineHeight, true) as PreparedTextWithSegments
}

// Layout prepared text at a given max width. Pure arithmetic on cached widths —
// no canvas calls, no DOM reads, no string operations, no allocations.
// ~0.0002ms per text block. Call on every resize.
//
// Line breaking rules (matching CSS white-space: normal + overflow-wrap: break-word):
//   - Break before any non-space segment that would overflow the line
//   - Trailing whitespace hangs past the line edge (doesn't trigger breaks)
//   - Segments wider than maxWidth are broken at grapheme boundaries
export function layout(prepared: PreparedText, maxWidth: number, lineHeight?: number): LayoutResult {
  if (lineHeight === undefined) lineHeight = prepared.lineHeight
  const { widths, isSpace: isSp, breakableWidths } = prepared
  if (widths.length === 0) return { lineCount: 0, height: 0 }

  let lineCount = 0
  let lineW = 0
  let hasContent = false

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        const gWidths = breakableWidths[i]!
        lineW = 0
        for (let g = 0; g < gWidths.length; g++) {
          const gw = gWidths[g]!
          if (lineW > 0 && lineW + gw > maxWidth) {
            lineCount++
            lineW = gw
          } else {
            if (lineW === 0) lineCount++
            lineW += gw
          }
        }
      } else {
        lineW = w
        lineCount++
      }
      hasContent = true
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth) {
      if (isSp[i]) continue // trailing whitespace hangs (CSS behavior)

      if (w > maxWidth && breakableWidths[i] !== null) {
        // Segment wider than line — break at grapheme boundaries
        const gWidths = breakableWidths[i]!
        lineW = 0
        for (let g = 0; g < gWidths.length; g++) {
          const gw = gWidths[g]!
          if (lineW > 0 && lineW + gw > maxWidth) {
            lineCount++
            lineW = gw
          } else {
            if (lineW === 0) lineCount++
            lineW += gw
          }
        }
      } else {
        lineCount++
        lineW = w
      }
    } else {
      lineW = newW
    }
  }

  if (!hasContent) {
    lineCount++
  }

  return { lineCount, height: lineCount * lineHeight }
}

// Rich layout API for callers that want the actual line contents and widths.
// Mirrors layout()'s break decisions, but keeps extra per-line bookkeeping so it
// should stay off the resize hot path.
export function layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight?: number): LayoutLinesResult {
  if (lineHeight === undefined) lineHeight = prepared.lineHeight
  const { widths, isSpace: isSp, breakableWidths, segments } = prepared
  const lines: LayoutLine[] = []
  if (widths.length === 0) return { lineCount: 0, height: 0, lineHeight, lines }

  let lineCount = 0
  let lineW = 0
  let hasContent = false
  let currentLine = ''

  function pushCurrentLine(): void {
    lines.push({ text: currentLine, width: lineW })
    currentLine = ''
  }

  function layoutBreakableSegment(segIndex: number, closeExistingLine: boolean): void {
    const gWidths = breakableWidths[segIndex]!
    const gTexts: string[] = []
    let gTextCount = 0
    for (const gs of sharedGraphemeSegmenter.segment(segments[segIndex]!)) {
      gTexts[gTextCount] = gs.segment
      gTextCount++
    }

    if (closeExistingLine) pushCurrentLine()

    lineW = 0
    currentLine = ''

    for (let g = 0; g < gWidths.length; g++) {
      const gw = gWidths[g]!
      const gText = gTexts[g]!

      if (lineW > 0 && lineW + gw > maxWidth) {
        pushCurrentLine()
        lineCount++
        lineW = gw
        currentLine = gText
      } else {
        if (lineW === 0) {
          lineCount++
          lineW = gw
          currentLine = gText
        } else {
          lineW += gw
          currentLine += gText
        }
      }
    }
  }

  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]!
    const segText = segments[i]!

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        layoutBreakableSegment(i, false)
      } else {
        lineW = w
        lineCount++
        currentLine = segText
      }
      hasContent = true
      continue
    }

    const newW = lineW + w

    if (newW > maxWidth) {
      if (isSp[i]) continue

      if (w > maxWidth && breakableWidths[i] !== null) {
        layoutBreakableSegment(i, true)
      } else {
        pushCurrentLine()
        lineCount++
        lineW = w
        currentLine = segText
      }
    } else {
      lineW = newW
      currentLine += segText
    }
  }

  if (!hasContent) {
    lineCount++
  } else {
    pushCurrentLine()
  }

  return { lineCount, height: lineCount * lineHeight, lineHeight, lines }
}

export function clearCache(): void {
  wordCaches.clear()
  emojiCorrectionCache.clear()
}
