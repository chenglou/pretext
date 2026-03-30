// Simplified bidi metadata helper for the rich prepareWithSegments() path,
// forked from pdf.js via Sebastian's text-layout. It classifies characters
// into bidi types, computes embedding levels, and maps them onto prepared
// segments for custom rendering. The line-breaking engine does not consume
// these levels.

// Numeric bidi type constants — avoids string comparisons in hot loops
const L   = 0
const R   = 1
const AL  = 2
const AN  = 3
const EN  = 4
const ES  = 5
const ET  = 6
const CS  = 7
const ON  = 8
const BN  = 9
const B   = 10
const S   = 11
const WS  = 12
const NSM = 13

const baseTypes = new Uint8Array([
  BN,BN,BN,BN,BN,BN,BN,BN,BN,S,B,S,WS,
  B,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,
  BN,BN,B,B,B,S,WS,ON,ON,ET,ET,ET,ON,
  ON,ON,ON,ON,ON,CS,ON,CS,ON,EN,EN,EN,
  EN,EN,EN,EN,EN,EN,EN,ON,ON,ON,ON,ON,
  ON,ON,L,L,L,L,L,L,L,L,L,L,L,L,L,
  L,L,L,L,L,L,L,L,L,L,L,L,L,ON,ON,
  ON,ON,ON,ON,L,L,L,L,L,L,L,L,L,L,
  L,L,L,L,L,L,L,L,L,L,L,L,L,L,L,
  L,ON,ON,ON,ON,BN,BN,BN,BN,BN,BN,B,BN,
  BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,
  BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,BN,
  BN,CS,ON,ET,ET,ET,ET,ON,ON,ON,ON,L,ON,
  ON,ON,ON,ON,ET,ET,EN,EN,ON,L,ON,ON,ON,
  EN,L,ON,ON,ON,ON,ON,L,L,L,L,L,L,L,
  L,L,L,L,L,L,L,L,L,L,L,L,L,L,L,
  L,ON,L,L,L,L,L,L,L,L,L,L,L,L,L,
  L,L,L,L,L,L,L,L,L,L,L,L,L,L,L,
  L,L,L,ON,L,L,L,L,L,L,L,L
])

// Reusable buffer for bidi type classification. Grows as needed, avoiding
// repeated allocation + zero-init for every computeBidiTypes() call.
// Safe because computeBidiTypes() returns the buffer and its only caller
// (computeSegmentLevels) reads it synchronously before the next call.
let typeBuf = new Uint8Array(256)

// Module-scope flag set by computeBidiTypes() and read by computeSegmentLevels().
// When true, all segment levels are 1 (R) — the caller can skip N1 + level
// computation and just fill. Set when text is pure-R (Hebrew-only, no L, no
// weak types, no AL/NSM) so all neutrals resolve to R under sor=R embedding.
let allRLevels = false

const arabicTypes = new Uint8Array([
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  CS,AL,ON,ON,NSM,NSM,NSM,NSM,NSM,NSM,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,NSM,NSM,NSM,NSM,NSM,NSM,NSM,
  NSM,NSM,NSM,NSM,NSM,NSM,NSM,AL,AL,AL,AL,
  AL,AL,AL,AN,AN,AN,AN,AN,AN,AN,AN,AN,
  AN,ET,AN,AN,AL,AL,AL,NSM,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,NSM,NSM,NSM,NSM,NSM,NSM,NSM,NSM,NSM,NSM,
  NSM,NSM,NSM,NSM,NSM,NSM,NSM,NSM,NSM,ON,NSM,
  NSM,NSM,NSM,AL,AL,AL,AL,AL,AL,AL,AL,AL,
  AL,AL,AL,AL,AL,AL,AL,AL,AL
])

function computeBidiTypes(str: string): Uint8Array | null {
  const len = str.length
  allRLevels = false
  if (len === 0) return null

  // Fast pre-scan: check if any bidi characters exist before allocating.
  // Most text is LTR-only, so this avoids a Uint8Array allocation in the
  // common case. Only chars >= 0x0590 can be R/AL/AN.
  let hasBidi = false
  for (let i = 0; i < len; i++) {
    if (str.charCodeAt(i) >= 0x0590) {
      hasBidi = true
      break
    }
  }

  if (!hasBidi) return null

  // Full classification pass (only reached when bidi chars are present)
  // Reuse module-scope buffer to avoid allocation + zero-init per call.
  if (typeBuf.length < len) typeBuf = new Uint8Array(len)
  const types = typeBuf
  let anyBidi = false
  let hasWeak = false    // EN/ET/ES/CS exist → W4-W7 needed
  let hasALorNSM = false // AL or NSM exist → W1+W2+W3 needed
  for (let i = 0; i < len; i++) {
    const c = str.charCodeAt(i)
    let t: number
    if (c <= 0x00ff) {
      t = baseTypes[c]!
      if (!hasWeak && (t === EN || t === ET || t === ES || t === CS)) hasWeak = true
    }
    else if (0x0590 <= c && c <= 0x05f4) {
      t = R
      anyBidi = true
    }
    else if (0x0600 <= c && c <= 0x06ff) {
      t = arabicTypes[c & 0xff]!
      hasALorNSM = true
      if (!anyBidi && (t === AL || t === AN)) anyBidi = true
    }
    else if (0x0700 <= c && c <= 0x08AC) {
      t = AL
      anyBidi = true
      hasALorNSM = true
    }
    else t = L
    types[i] = t
  }

  if (!anyBidi) return null

  // Pure-R fast path: when text has no weak types and no AL/NSM,
  // check if any L exists. If not, only R and neutrals survive, and
  // since sor=R, N1 resolves every neutral run to R. All segment
  // levels are 1. This post-scan only runs for Hebrew-only candidates
  // (no Arabic, no mixed), so it doesn't add overhead to Arabic/mixed.
  if (!hasWeak && !hasALorNSM) {
    let pureR = true
    for (let i = 0; i < len; i++) {
      if (types[i] === L) { pureR = false; break }
    }
    if (pureR) {
      allRLevels = true
      return types  // return non-null so caller knows bidi exists
    }
  }

  // Paragraph direction heuristic: (len / numBidi) < 0.3 ? 0 : 1
  // Since numBidi <= len, len/numBidi >= 1 > 0.3 always → startLevel = 1.
  // Embedding direction is always R for an RTL paragraph.
  const e = R
  const sor = R

  // W1 + W2 + W3: resolve NSM, convert EN after AL, and AL→R.
  // Skip entirely for pure Hebrew (no AL, no NSM, no weak types).
  if (hasALorNSM || hasWeak) {
    let w1Last = sor
    let w2Last = sor
    for (let i = 0; i < len; i++) {
      let t = types[i]!
      if (t === NSM) {
        t = w1Last
        types[i] = t
      }
      w1Last = t
      if (t === EN) {
        if (w2Last === AL) {
          types[i] = AN
        }
      } else if (t === R || t === L || t === AL) {
        if (t === AL) {
          types[i] = R
        }
        w2Last = t
      }
    }
  }

  // W4-W7: weak type resolution. Skip when no EN/ET/ES/CS exist.
  if (hasWeak) {
    // W4-W5: ES between EN→EN, CS between EN/AN matching.
    // Use running prev to avoid repeated types[i-1] array reads.
    let prev = types[0]!
    for (let i = 1; i < len - 1; i++) {
      const cur = types[i]!
      const next = types[i + 1]!
      if (cur === ES && prev === EN && next === EN) {
        types[i] = EN
        prev = EN
      } else if (
        cur === CS &&
        (prev === EN || prev === AN) &&
        next === prev
      ) {
        types[i] = prev
        // prev stays unchanged (already the resolved value)
      } else {
        prev = cur
      }
    }

    // W5: ET adjacent to EN → EN
    for (let i = 0; i < len; i++) {
      if (types[i] !== EN) continue
      let j
      for (j = i - 1; j >= 0 && types[j] === ET; j--) types[j] = EN
      for (j = i + 1; j < len && types[j] === ET; j++) types[j] = EN
    }

    // W6 + W7 merged: neutralize weak types and resolve EN after L
    let w7Last = sor  // W7: tracks previous strong type (R/L only)
    for (let i = 0; i < len; i++) {
      let t = types[i]!
      // W6: remaining weak types → ON
      if (t === WS || t === ES || t === ET || t === CS) {
        types[i] = ON
      } else if (t === EN) {
        // W7: EN after L → L
        types[i] = w7Last === L ? L : EN
      } else if (t === R || t === L) {
        w7Last = t
      }
    }
  }

  // N1: resolve neutral (ON/WS) runs based on surrounding strong types.
  // WS is treated as neutral here so we can skip the separate WS→ON
  // conversion pass in the no-weak-types branch above.
  for (let i = 0; i < len; i++) {
    const ti = types[i]!
    if (ti !== ON && ti !== WS) continue
    let end = i + 1
    while (end < len && (types[end] === ON || types[end] === WS)) end++
    const before = i > 0 ? types[i - 1]! : sor
    const after = end < len ? types[end]! : sor
    const bDir = before !== L ? R : L
    const aDir = after !== L ? R : L
    // N1: if directions agree, use that direction; N2: otherwise use embedding
    const resolved = bDir === aDir ? bDir : e
    for (let j = i; j < end; j++) types[j] = resolved
    i = end - 1
  }

  return types
}

export function computeSegmentLevels(normalized: string, segStarts: number[]): Int8Array | null {
  const resolvedTypes = computeBidiTypes(normalized)
  if (resolvedTypes === null) return null

  // Pure-R fast path: all levels are 1 (no N1, no per-segment type lookup)
  if (allRLevels) {
    const segLevels = new Int8Array(segStarts.length)
    segLevels.fill(1)
    return segLevels
  }

  // I1-I2 levels at segment-start positions only.
  // startLevel is always 1 (odd/RTL). After all W+N rules resolve,
  // only L/R/AN/EN survive. R→1 (odd stays odd); L/AN/EN→2 (bump to even).
  const segLevels = new Int8Array(segStarts.length)
  for (let i = 0; i < segStarts.length; i++) {
    segLevels[i] = resolvedTypes[segStarts[i]!]! === R ? 1 : 2
  }
  return segLevels
}
