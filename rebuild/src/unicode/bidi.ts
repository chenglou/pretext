// Bidi_Class data, shared by the two bidi resolvers the engines run:
// - unicode/ubidi.ts, ICU's ubidi, for Blink (Chrome 153, ICU 78.2) and WebKit (Safari 27, macOS 27 libicucore 78.1);
// - unicode/unicode-bidi.ts, servo/unicode-bidi 0.3.15, for Gecko (Firefox 156).
// The two algorithms give different levels for the same text (specs/bidi.md §5.3), so each engine calls the resolver its
// browser runs, the way it calls breaks/rbbi.ts or breaks/icu4x.ts. The text each engine hands its resolver differs too,
// and each engine builds it (specs/bidi.md §3).
//
// The data differs per engine as well. The tables here are named by where they come from, and each engine pairs a class
// table with a bracket table as its own BidiData (engines/<engine>/data.ts, which says what its browser reads).
// src/unicode/bidi.test.ts checks every table for every code point against the engines' own data.
//
// Classes use ICU4C UCharDirection numbering.
import { libicucoreBidiClassRanges, unicode17BidiClassRanges } from './generated/bidi-data.js'

export const L = 0, R = 1, EN = 2, ES = 3, ET = 4, AN = 5, CS = 6, B = 7, S = 8, WS = 9, ON = 10, LRE = 11,
  LRO = 12, AL = 13, RLE = 14, RLO = 15, PDF = 16, NSM = 17, BN = 18, FSI = 19, LRI = 20, RLI = 21, PDI = 22

export type BidiClassTable = { starts: Uint32Array; ends: Uint32Array; classes: Uint8Array }

export type BidiData = {
  classes: BidiClassTable
  // [opening, closing, canonical opening or 0] triples.
  brackets: readonly number[]
}

// The paragraph level: explicit, or from the first strong character. ICU gets UBIDI_DEFAULT_LTR for 'auto', unicode-bidi
// a None level.
export type ParagraphDirection = 'ltr' | 'rtl' | 'auto'

function decodeClassRanges(flat: readonly number[]): BidiClassTable {
  const n = flat.length / 3
  const starts = new Uint32Array(n)
  const ends = new Uint32Array(n)
  const classes = new Uint8Array(n)
  let previousEnd = -1
  for (let i = 0; i < n; i++) {
    const start = previousEnd + 1 + flat[3 * i]!
    starts[i] = start
    ends[i] = previousEnd = start + flat[3 * i + 1]!
    classes[i] = flat[3 * i + 2]!
  }
  return { starts, ends, classes }
}

// ICU 78.2's Bidi_Class, Unicode 17.
export const unicode17BidiClasses: BidiClassTable = decodeClassRanges(unicode17BidiClassRanges)
// The same, with Apple's own classes for private-use U+F7F0..U+F8FF, which macOS 27's libicucore reports.
export const libicucoreBidiClasses: BidiClassTable = decodeClassRanges(libicucoreBidiClassRanges)

export function bidiClassOf(data: BidiData, cp: number): number {
  const t = data.classes
  let lo = 0
  let hi = t.starts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < t.starts[mid]!) hi = mid - 1
    else if (cp > t.ends[mid]!) lo = mid + 1
    else return t.classes[mid]!
  }
  return L
}
