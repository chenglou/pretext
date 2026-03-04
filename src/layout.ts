// DOM-free text measurement for browser environments.
//
// Problem: DOM-based text measurement (getBoundingClientRect, offsetHeight)
// forces synchronous layout reflow. When components independently measure text,
// each measurement triggers a reflow of the entire document. This creates
// read/write interleaving that can cost 30ms+ per frame for 500 text blocks.
//
// Solution: two-phase measurement using canvas measureText (no DOM reads).
//   prepare(text, font) — segments text via Intl.Segmenter, measures each word
//     via canvas, caches widths. Call once when text first appears.
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
//   grapheme at a given size, font-independent. Auto-detected by measuring a
//   reference emoji and comparing to fontSize. Safari is unaffected (correction = 0).
//
// Limitations:
//   - system-ui font: canvas resolves to different optical variants than DOM on macOS.
//     Use named fonts (Helvetica, Inter, etc.) for guaranteed accuracy.
//
// Based on Sebastian Markbage's text-layout research (github.com/reactjs/text-layout).

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
// families. Auto-detected by measuring a reference emoji vs fontSize.

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

function countEmojiGraphemes(text: string, segmenter: Intl.Segmenter): number {
  let count = 0
  for (const g of segmenter.segment(text)) {
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

// Line-end prohibition: these characters cannot end a line.
// To prevent this, they are merged with the following grapheme.
const kinsokuEnd = new Set([
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

// L2 rule: reorder segments within a completed line for visual display.
// Reverses contiguous sequences of RTL segments at each embedding level.
// Returns reordered index array, or null if the line is pure LTR.
function reorderLine(segLevels: Int8Array, start: number, end: number): number[] | null {
  let low = 127, high = 0
  for (let i = start; i < end; i++) {
    const lv = segLevels[i]!
    if (lv < low) low = lv
    if (lv > high) high = lv
  }
  if (high <= 0) return null
  if (low % 2 === 0) low++

  const indices = new Array<number>(end - start)
  for (let i = 0; i < indices.length; i++) indices[i] = start + i

  while (high >= low) {
    let i = 0
    while (i < indices.length) {
      while (i < indices.length && segLevels[indices[i]!]! < high) i++
      let j = i
      while (j < indices.length && segLevels[indices[j]!]! >= high) j++
      let a = i, b = j - 1
      while (a < b) { const tmp = indices[a]!; indices[a] = indices[b]!; indices[b] = tmp; a++; b-- }
      i = j
    }
    high--
  }
  return indices
}

// --- Public types ---

type ParaData = {
  widths: number[]
  isWordLike: boolean[]
  isSpace: boolean[]
  segLevels: Int8Array | null
  breakableWidths: (number[] | null)[]
}

export type PreparedText = {
  paraData: ParaData[]
  lineHeight: number
}

export type LayoutResult = {
  lineCount: number
  height: number
}

// --- Public API ---

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
  ctx.font = font
  const cache = getWordCache(font)
  const fontSize = parseFontSize(font)

  if (lineHeight === undefined) {
    lineHeight = Math.round(fontSize * 1.2)
  }

  // Auto-detect emoji canvas inflation. On Chrome/Firefox macOS, canvas measures
  // emoji wider than DOM at small sizes. Correction is 0 on Safari or ≥24px.
  const emojiCanvasW = ctx.measureText('\u{1F600}').width
  const emojiCorrection = emojiCanvasW > fontSize + 0.5 ? emojiCanvasW - fontSize : 0

  // CSS white-space: normal collapses newlines to spaces. For pre-wrap behavior,
  // callers should split on \n and prepare each paragraph separately.
  const normalized = text.replace(/\n/g, ' ')

  if (normalized.length === 0 || normalized.trim().length === 0) {
    return { paraData: [], lineHeight }
  }

  const segments = sharedWordSegmenter.segment(normalized)
  const widths: number[] = []
  const isWordLike: boolean[] = []
  const isSpace: boolean[] = []
  const segStarts: number[] = []
  const breakableWidths: (number[] | null)[] = []

  // Merge punctuation into preceding word-like segments. Without this,
  // measureText("better") + measureText(".") can differ from measureText("better.")
  // by enough to cause off-by-one line breaks at borderline widths (up to 2.6px
  // accumulation error at 28px font). Merging also matches CSS behavior where
  // punctuation is visually attached to its word and not broken separately.
  // Only merge into word-like segments — merging into spaces would make
  // content (emoji, parens) invisible to line-breaking.
  const rawSegs = [...segments]
  const merged: { text: string, isWordLike: boolean, isSpace: boolean, start: number }[] = []

  for (let i = 0; i < rawSegs.length; i++) {
    const s = rawSegs[i]!
    const ws = !s.isWordLike && /^\s+$/.test(s.segment)

    if (!s.isWordLike && !ws && merged.length > 0 && merged[merged.length - 1]!.isWordLike) {
      merged[merged.length - 1]!.text += s.segment
    } else {
      merged.push({ text: s.segment, isWordLike: s.isWordLike ?? false, isSpace: ws, start: s.index })
    }
  }

  for (let mi = 0; mi < merged.length; mi++) {
    const seg = merged[mi]!
    if (seg.isWordLike && isCJK(seg.text)) {
      // Split CJK words into individual graphemes for per-character line breaks,
      // but apply kinsoku shori: merge line-start prohibited chars (，。etc.)
      // with the preceding grapheme, and line-end prohibited chars (（「etc.)
      // with the following grapheme. This prevents them from being separated.
      const graphemes = [...sharedGraphemeSegmenter.segment(seg.text)]
      const units: { text: string, start: number }[] = []
      for (let gi = 0; gi < graphemes.length; gi++) {
        const g = graphemes[gi]!.segment
        if (kinsokuStart.has(g) && units.length > 0) {
          // Merge with preceding unit (can't start a line)
          units[units.length - 1]!.text += g
        } else if (kinsokuEnd.has(g) && gi + 1 < graphemes.length) {
          // Merge with following grapheme (can't end a line)
          units.push({ text: g + graphemes[gi + 1]!.segment, start: graphemes[gi]!.index })
          gi++ // skip the next grapheme, already consumed
        } else {
          units.push({ text: g, start: graphemes[gi]!.index })
        }
      }
      for (let ui = 0; ui < units.length; ui++) {
        const u = units[ui]!
        let w = measureSegment(u.text, cache)
        if (emojiCorrection > 0 && isEmojiGrapheme(u.text)) {
          w -= emojiCorrection
        }
        widths.push(w)
        isWordLike.push(true)
        isSpace.push(false)
        segStarts.push(seg.start + u.start)
        breakableWidths.push(null)
      }
    } else {
      let w = measureSegment(seg.text, cache)
      if (emojiCorrection > 0 && emojiPresentationRe.test(seg.text)) {
        const ec = countEmojiGraphemes(seg.text, sharedGraphemeSegmenter)
        w -= ec * emojiCorrection
      }
      widths.push(w)
      isWordLike.push(seg.isWordLike)
      isSpace.push(seg.isSpace)
      segStarts.push(seg.start)
      if (seg.isWordLike && seg.text.length > 1) {
        const graphemes = [...sharedGraphemeSegmenter.segment(seg.text)]
        if (graphemes.length > 1) {
          const gWidths = new Array<number>(graphemes.length)
          for (let gi = 0; gi < graphemes.length; gi++) {
            let gw = measureSegment(graphemes[gi]!.segment, cache)
            if (emojiCorrection > 0 && isEmojiGrapheme(graphemes[gi]!.segment)) {
              gw -= emojiCorrection
            }
            gWidths[gi] = gw
          }
          breakableWidths.push(gWidths)
        } else {
          breakableWidths.push(null)
        }
      } else {
        breakableWidths.push(null)
      }
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

  return { paraData: [{ widths, isWordLike, isSpace, segLevels, breakableWidths }], lineHeight }
}

// Layout prepared text at a given max width. Pure arithmetic on cached widths —
// no canvas calls, no DOM reads, no string operations, no allocations.
// ~0.0002ms per text block. Call on every resize.
//
// Line breaking rules (matching CSS white-space: normal + overflow-wrap: break-word):
//   - Break before word-like segments that would overflow the line
//   - Trailing whitespace hangs past the line edge (doesn't trigger breaks)
//   - Non-whitespace punctuation overflows trigger break before the last word
//   - Segments wider than maxWidth are broken at grapheme boundaries
//   - Bidi reordering applied per completed line
export function layout(prepared: PreparedText, maxWidth: number, lineHeight?: number): LayoutResult {
  const { paraData } = prepared
  if (lineHeight === undefined) lineHeight = prepared.lineHeight

  let lineCount = 0

  for (let p = 0; p < paraData.length; p++) {
    const data = paraData[p]!

    const { widths, isWordLike: isWord, isSpace: isSp, segLevels, breakableWidths } = data
    let lineW = 0
    let hasContent = false
    let lineStart = 0

    for (let i = 0; i < widths.length; i++) {
      const w = widths[i]!

      if (!hasContent) {
        if (w > maxWidth && breakableWidths[i] !== null) {
          const gWidths = breakableWidths[i]!
          lineW = 0
          for (let g = 0; g < gWidths.length; g++) {
            if (lineW > 0 && lineW + gWidths[g]! > maxWidth) {
              lineCount++
              lineW = gWidths[g]!
            } else {
              if (lineW === 0) lineCount++
              lineW += gWidths[g]!
            }
          }
          hasContent = true
          lineStart = i
        } else {
          lineW = w
          hasContent = true
          lineCount++
          lineStart = i
        }
        continue
      }

      const newW = lineW + w

      if (newW > maxWidth) {
        let breakIdx: number
        if (isWord[i]) {
          breakIdx = i
        } else if (isSp[i]) {
          // Trailing whitespace hangs past the line edge (CSS behavior)
          continue
        } else {
          // Non-word, non-space (emoji, punctuation, parens, etc.)
          // CSS breaks at the preceding space, putting this on the next line.
          breakIdx = i
        }

        if (segLevels !== null) {
          reorderLine(segLevels, lineStart, breakIdx)
        }

        lineStart = breakIdx
        lineCount++
        lineW = 0
        for (let j = breakIdx; j <= i; j++) {
          lineW += widths[j]!
        }

        if (breakIdx === i && w > maxWidth && breakableWidths[i] !== null) {
          const gWidths = breakableWidths[i]!
          lineW = 0
          lineCount--
          for (let g = 0; g < gWidths.length; g++) {
            if (lineW > 0 && lineW + gWidths[g]! > maxWidth) {
              lineCount++
              lineW = gWidths[g]!
            } else {
              if (lineW === 0) lineCount++
              lineW += gWidths[g]!
            }
          }
        }
      } else {
        lineW = newW
      }
    }

    if (hasContent && segLevels !== null) {
      reorderLine(segLevels, lineStart, widths.length)
    }

    if (!hasContent) {
      lineCount++
    }
  }

  return { lineCount, height: lineCount * lineHeight }
}

export function clearCache(): void {
  wordCaches.clear()
}
