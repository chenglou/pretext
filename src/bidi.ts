// Simplified bidi metadata helper for the rich prepareWithSegments() path,
// forked from pdf.js via Sebastian's text-layout. It classifies characters
// into bidi types, computes embedding levels, and maps them onto prepared
// segments for custom rendering. The line-breaking engine does not consume
// these levels.

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

const approximateBidiRanges: Array<{ start: number, end: number, type: BidiType }> = [
  { start: 0x0590, end: 0x05F4, type: 'R' },
  { start: 0x0700, end: 0x08AC, type: 'AL' },
  { start: 0xFB1D, end: 0xFB4F, type: 'R' },
  { start: 0xFB50, end: 0xFDFF, type: 'AL' },
  { start: 0xFE70, end: 0xFEFF, type: 'AL' },
  { start: 0x1E900, end: 0x1E95F, type: 'R' },
  { start: 0x1EE00, end: 0x1EEFF, type: 'AL' },
]

function classifyCodePoint(codePoint: number): BidiType {
  if (codePoint <= 0x00ff) return baseTypes[codePoint]!
  if (0x0600 <= codePoint && codePoint <= 0x06ff) return arabicTypes[codePoint & 0xff]!

  for (let i = 0; i < approximateBidiRanges.length; i++) {
    const range = approximateBidiRanges[i]!
    if (codePoint >= range.start && codePoint <= range.end) return range.type
  }

  return 'L'
}

function computeBidiLevels(str: string): Int8Array | null {
  const len = str.length
  if (len === 0) return null

  // eslint-disable-next-line unicorn/no-new-array
  const types: BidiType[] = new Array(len)
  let sawBidi = false

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
    if (t === 'R' || t === 'AL' || t === 'AN') sawBidi = true
    for (let j = 0; j < codeUnitLength; j++) {
      types[i + j] = t
    }
    i += codeUnitLength
  }

  if (!sawBidi) return null

  // Use the first strong character to pick the paragraph base direction.
  // Rich-path bidi metadata is only an approximation, but this keeps mixed
  // LTR/RTL text aligned with the common UBA paragraph rule.
  let startLevel = 0
  for (let i = 0; i < len; i++) {
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
  const levels = new Int8Array(len)
  for (let i = 0; i < len; i++) levels[i] = startLevel

  const e: BidiType = (startLevel & 1) ? 'R' : 'L'
  const sor = e

  // W1-W7
  let lastType: BidiType = sor
  for (let i = 0; i < len; i++) {
    if (types[i] === 'NSM') types[i] = lastType
    else lastType = types[i]!
  }
  lastType = sor
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if (t === 'EN') types[i] = lastType === 'AL' ? 'AN' : 'EN'
    else if (t === 'R' || t === 'L' || t === 'AL') lastType = t
  }
  for (let i = 0; i < len; i++) {
    if (types[i] === 'AL') types[i] = 'R'
  }
  for (let i = 1; i < len - 1; i++) {
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
  for (let i = 0; i < len; i++) {
    if (types[i] !== 'EN') continue
    let j
    for (j = i - 1; j >= 0 && types[j] === 'ET'; j--) types[j] = 'EN'
    for (j = i + 1; j < len && types[j] === 'ET'; j++) types[j] = 'EN'
  }
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if (t === 'WS' || t === 'ES' || t === 'ET' || t === 'CS') types[i] = 'ON'
  }
  lastType = sor
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if (t === 'EN') types[i] = lastType === 'L' ? 'L' : 'EN'
    else if (t === 'R' || t === 'L') lastType = t
  }

  // N1-N2
  for (let i = 0; i < len; i++) {
    if (types[i] !== 'ON') continue
    let end = i + 1
    while (end < len && types[end] === 'ON') end++
    const before: BidiType = i > 0 ? types[i - 1]! : sor
    const after: BidiType = end < len ? types[end]! : sor
    const bDir: BidiType = before !== 'L' ? 'R' : 'L'
    const aDir: BidiType = after !== 'L' ? 'R' : 'L'
    if (bDir === aDir) {
      for (let j = i; j < end; j++) types[j] = bDir
    }
    i = end - 1
  }
  for (let i = 0; i < len; i++) {
    if (types[i] === 'ON') types[i] = e
  }

  // I1-I2
  for (let i = 0; i < len; i++) {
    const t = types[i]!
    if ((levels[i]! & 1) === 0) {
      if (t === 'R') levels[i]!++
      else if (t === 'AN' || t === 'EN') levels[i]! += 2
    } else if (t === 'L' || t === 'AN' || t === 'EN') {
      levels[i]!++
    }
  }

  return levels
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
