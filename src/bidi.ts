// Simplified bidi metadata helper for the rich prepareWithSegments() path,
// forked from pdf.js via Sebastian's text-layout. It classifies characters
// into bidi types, computes embedding levels, and maps them onto prepared
// segments for custom rendering. The line-breaking engine does not consume
// these levels.

import {
  bidiPairedBrackets,
  latin1BidiTypes,
  nonLatin1BidiRanges,
  type GeneratedBidiType as BidiType,
} from './generated/bidi-data.js'

// Paired brackets resolve together (UAX #9 N0), so they can take the paragraph
// direction instead of the direction of the text around them.
export function isBidiPairedBracket(codePoint: number): boolean {
  let lo = 0
  let hi = bidiPairedBrackets.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const value = bidiPairedBrackets[mid]!
    if (codePoint === value) return true
    if (codePoint < value) hi = mid - 1
    else lo = mid + 1
  }
  return false
}

export function classifyCodePoint(codePoint: number): BidiType {
  if (codePoint <= 0x00FF) return latin1BidiTypes[codePoint]!

  let lo = 0
  let hi = nonLatin1BidiRanges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = nonLatin1BidiRanges[mid]!
    if (codePoint < range[0]) {
      hi = mid - 1
      continue
    }
    if (codePoint > range[1]) {
      lo = mid + 1
      continue
    }
    return range[2]
  }

  return 'L'
}

function computeBidiLevels(str: string): Int8Array | null {
  const len = str.length
  if (len === 0) return null

  // eslint-disable-next-line unicorn/no-new-array
  const types: BidiType[] = new Array(len)
  let paragraphHasBidi = false
  let paragraphStart = 0
  let levels: Int8Array | null = null

  // Keep the resolved bidi classes aligned to UTF-16 code-unit offsets,
  // because the rich prepared segments index back into the normalized string
  // with JavaScript string offsets.
  for (let i = 0; i < len;) {
    const first = str.charCodeAt(i)
    let codePoint = first
    let codeUnitLength = 1

    if (first >= 0xD800 && first <= 0xDBFF && i + 1 < len) {
      const second = str.charCodeAt(i + 1)
      if (second >= 0xDC00 && second <= 0xDFFF) {
        codePoint = ((first - 0xD800) << 10) + (second - 0xDC00) + 0x10000
        codeUnitLength = 2
      }
    }

    const t = classifyCodePoint(codePoint)
    if (t === 'R' || t === 'AL' || t === 'AN') paragraphHasBidi = true
    for (let j = 0; j < codeUnitLength; j++) {
      types[i + j] = t
    }
    // Classification has all of this paragraph's types when B arrives.
    // Resolve that range now; S (tabs) and U+2028 do not end a paragraph.
    if (t === 'B') {
      if (paragraphHasBidi) {
        levels ??= new Int8Array(len)
        // B belongs to the preceding paragraph and inherits its base level.
        levels[i] = resolveParagraphLevels(types, levels, paragraphStart, i)
      }
      paragraphStart = i + codeUnitLength
      paragraphHasBidi = false
    }
    i += codeUnitLength
  }

  if (paragraphHasBidi) {
    levels ??= new Int8Array(len)
    resolveParagraphLevels(types, levels, paragraphStart, len)
  }
  // Paragraphs without bidi classes have level zero. Leave their cells at
  // the typed array's initial value, or keep the all-LTR result null.
  return levels
}

function resolveParagraphLevels(types: BidiType[], levels: Int8Array, start: number, end: number): number {
  // Use the first strong character to pick the paragraph base direction.
  // Rich-path bidi metadata is only an approximation, but this keeps mixed
  // LTR/RTL text aligned with the common UBA paragraph rule.
  let startLevel = 0
  for (let i = start; i < end; i++) {
    const t = types[i]!
    if (t === 'L') {
      startLevel = 0
      break
    }
    if (t === 'R' || t === 'AL') {
      startLevel = 1
      break
    }
  }
  const e: BidiType = (startLevel & 1) ? 'R' : 'L'
  const sor = e

  // W1-W7
  let lastType: BidiType = sor
  for (let i = start; i < end; i++) {
    if (types[i] === 'NSM') types[i] = lastType
    else lastType = types[i]!
  }
  lastType = sor
  for (let i = start; i < end; i++) {
    const t = types[i]!
    if (t === 'EN') types[i] = lastType === 'AL' ? 'AN' : 'EN'
    else if (t === 'R' || t === 'L' || t === 'AL') lastType = t
  }
  for (let i = start; i < end; i++) {
    if (types[i] === 'AL') types[i] = 'R'
  }
  for (let i = start + 1; i < end - 1; i++) {
    if (types[i] === 'ES' && types[i - 1] === 'EN' && types[i + 1] === 'EN') {
      types[i] = 'EN'
    }
    if (
      types[i] === 'CS' &&
      (types[i - 1] === 'EN' || types[i - 1] === 'AN') &&
      types[i + 1] === types[i - 1]
    ) {
      types[i] = types[i - 1]!
    }
  }
  for (let i = start; i < end; i++) {
    if (types[i] !== 'EN') continue
    let j
    for (j = i - 1; j >= start && types[j] === 'ET'; j--) types[j] = 'EN'
    for (j = i + 1; j < end && types[j] === 'ET'; j++) types[j] = 'EN'
  }
  for (let i = start; i < end; i++) {
    const t = types[i]!
    if (t === 'WS' || t === 'ES' || t === 'ET' || t === 'CS') types[i] = 'ON'
  }
  lastType = sor
  for (let i = start; i < end; i++) {
    const t = types[i]!
    if (t === 'EN') types[i] = lastType === 'L' ? 'L' : 'EN'
    else if (t === 'R' || t === 'L') lastType = t
  }

  // N1-N2
  for (let i = start; i < end; i++) {
    if (types[i] !== 'ON') continue
    let runEnd = i + 1
    while (runEnd < end && types[runEnd] === 'ON') runEnd++
    const before: BidiType = i > start ? types[i - 1]! : sor
    const after: BidiType = runEnd < end ? types[runEnd]! : sor
    const bDir: BidiType = before !== 'L' ? 'R' : 'L'
    const aDir: BidiType = after !== 'L' ? 'R' : 'L'
    if (bDir === aDir) {
      for (let j = i; j < runEnd; j++) types[j] = bDir
    }
    i = runEnd - 1
  }
  for (let i = start; i < end; i++) {
    if (types[i] === 'ON') types[i] = e
  }

  // I1-I2
  for (let i = start; i < end; i++) {
    const t = types[i]!
    let level = startLevel
    if ((startLevel & 1) === 0) {
      if (t === 'R') level++
      else if (t === 'AN' || t === 'EN') level += 2
    } else if (t === 'L' || t === 'AN' || t === 'EN') {
      level++
    }
    levels[i] = level
  }

  return startLevel
}

export function computeSegmentLevels(normalized: string, segStarts: number[]): Int8Array | null {
  const bidiLevels = computeBidiLevels(normalized)
  if (bidiLevels === null) return null

  const segLevels = new Int8Array(segStarts.length)
  for (let i = 0; i < segStarts.length; i++) {
    segLevels[i] = bidiLevels[segStarts[i]!]!
  }
  return segLevels
}
