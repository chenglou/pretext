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

function classifyChar(charCode: number): BidiType {
  if (charCode <= 0x00ff) return baseTypes[charCode]!
  if (0x0590 <= charCode && charCode <= 0x05f4) return 'R'
  if (0x0600 <= charCode && charCode <= 0x06ff) return arabicTypes[charCode & 0xff]!
  if (0x0700 <= charCode && charCode <= 0x08AC) return 'AL'
  // Astral RTL/AL ranges (supplementary plane)
  if (0x10800 <= charCode && charCode <= 0x10FFF) return 'R'
  if (0x1E800 <= charCode && charCode <= 0x1EDFF) return 'R'
  if (0x1EE00 <= charCode && charCode <= 0x1EEFF) return 'AL'
  return 'L'
}

function computeBidiLevels(str: string): Int8Array | null {
  const len = str.length
  if (len === 0) return null

  // eslint-disable-next-line unicorn/no-new-array
  const types: BidiType[] = new Array(len)
  let numBidi = 0

  for (let i = 0; i < len; i++) {
    const code = str.codePointAt(i)!
    const t = classifyChar(code)
    if (t === 'R' || t === 'AL' || t === 'AN') numBidi++
    types[i] = t
    // Surrogate pair: assign same bidi type to both code units
    if (code > 0xFFFF) {
      i++
      types[i] = t
    }
  }

  if (numBidi === 0) return null

  const startLevel = (len / numBidi) < 0.3 ? 0 : 1
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
