// Where the port's positions are stand-ins (DESIGN.md §5): the condition a position inside a shaping call rests on when
// Canvas totals can't place it, and how far off it can be. Inspection reads them, for the limits of the geometry
// (inspect.ts) and for gaps (gaps.ts); filling a line never does.
import type { GapName } from '../../model.js'
import { isSegmentEdge } from './emoji.js'
import { LIGATURE_NONE } from './ligatures.js'
import {
  adjust16, adjustBefore16, adjustmentSide, ceilFrom16, clusterStartAtOrBefore, isClusterBoundary, joinsAcross, pairAdjust16,
  positionAdjust16, prefix16, requeuedSpaceAt, sliceEdge, startsClusterInsideGrapheme, viewPartAt, viewPartCount, type ShapeResult, type Shaper, type View,
} from './shape.js'

// Whether the port knows where offset k sits inside a shaping call over [lo, hi) of group g, and the condition it rests on
// when it doesn't. The port takes a position from the prefix [lo, k) measured alone plus the pair adjustment, which is
// Blink's value exactly where shaping the two sides apart gives the glyphs the call has: HarfBuzz's own meaning of
// safe-to-break (hb-buffer.hh:517-527). So:
// - a call edge and a script segment edge are exact: HarfBuzzShaper shapes every segment in its own call
//   (harfbuzz_shaper.cc:1080-1101), and measure16 measures them apart;
// - an offset inside a glyph cluster takes its cluster start's position (ComputePositionData, shape_result.cc:2113-2200);
// - between letters the Arabic shaper joins, HarfBuzz marks the offset unsafe in every font (hb-ot-shaper-arabic.cc:332,
//   366): the prefix ends in a form measured through U+200D, and the letters' advances in the call can read the rest of
//   the word (Noto Nastaliq Urdu's contextual forms): in-word-prefix;
// - elsewhere a font's lookups may still merge the characters around k into one glyph, whose position Blink gives to all
//   of them (ligate_input, hb-ot-layout-gsubgpos.hh:1500-1510; LigatureSubtable, hb-aat-layout-morx-table.hh), and Canvas
//   totals show no glyph clusters, not even through the pair adjustment: Geeza Pro's lam-lam-heh ligature has the advance
//   of its parts (c-4a04b13ad0ab4062). Which sequences a font ligates is a font fact (ligatures.ts); where the facts are
//   missing or don't settle the offset: glyph-clusters;
// - with the ligatures known, an adjustment the pair window shows is a kern, which the pairKerning fact places, or a
//   contextual form where liga, clig and calt change it, which nothing places: unsafe-to-break.
export function positionLimit(sh: Shaper, g: number, k: number, lo: number, hi: number): GapName | null {
  const p = sh.p
  if (k <= lo || k >= hi) return null
  // Inside a grapheme at a character HarfBuzz doesn't mark a continuation, one cluster or two by the font's lookups.
  if (startsClusterInsideGrapheme(p, k)) return 'glyph-clusters'
  k = clusterStartAtOrBefore(p, k, lo)
  if (k <= lo) return null
  if (isSegmentEdge(p, k)) return null
  // Beside U+3000 the adjustment sits on the other cluster where its font lacks U+3000 (requeuedSpaceAt); where the facts
  // don't say which font draws that cluster, an adjustment there rests on a font the port doesn't know.
  switch (requeuedSpaceAt(p, k, lo, hi)) {
    case 'start': case 'end': return null
    case 'unknown': if (pairAdjust16(sh, g, k, lo, hi) !== 0) return 'font-fallback'; break
    case null: break
  }
  if (p.ligature[k] !== LIGATURE_NONE) return 'glyph-clusters'
  if (joinsAcross(p, k, lo, hi)) return 'in-word-prefix'
  const style = p.styles[p.groups[g]!.style]!
  const wide = adjust16(sh, g, k, lo, hi)
  const pair = pairAdjust16(sh, g, k, lo, hi)
  if (wide === 0 && pair === 0) return null
  // A kern between the two clusters next to k, the same with liga, clig and calt off, sits where the pairKerning fact says;
  // any other adjustment (a longer context, a contextual form) sits on glyphs no fact names (positionAdjust16).
  if (style.font.facts.pairKerning === null || pair !== wide) return 'unsafe-to-break'
  if (style.letterSpacing === 0 && pairAdjust16(sh, g, k, lo, hi, true) !== pair) return 'unsafe-to-break'
  return null
}

// Whether the advances of the glyph clusters on both sides of offset k inside a shaping call over [lo, hi) rest on a pair
// kerning fact the declaration doesn't give: GPOS pair values sit on the first glyph's advance, the kern and kerx machine
// gives the first glyph kern >> 1 and the second the rest (hb-kern.hh:102-106), and Canvas totals show the sum. The port
// then puts the adjustment the position takes (positionAdjust16) on the first glyph (pairBefore16), so inside a line both
// clusters are stand-ins, half the kern off in a font of the other kind, and the line reports it over them (inspect.ts
// shapeOf). Joined letters are in-word-prefix's.
export function pairPlacementUnknown(sh: Shaper, g: number, k: number, lo: number, hi: number): boolean {
  const p = sh.p
  if (p.styles[p.groups[g]!.style]!.font.facts.pairKerning !== null) return false
  if (k <= lo || k >= hi || !isClusterBoundary(p, k) || isSegmentEdge(p, k) || joinsAcross(p, k, lo, hi)) return false
  return adjustmentSide(sh, g, k, lo, hi) === 'pair' && positionAdjust16(sh, g, k, lo, hi) !== 0
}

// positionLimit for the advance sum of a view's glyphs before offset k (viewPrefix16): the widths of the parts before k
// rest on their own edges' positions in their calls, and the part holding k on its start and on k.
export function viewPositionLimit(sh: Shaper, view: View, k: number): GapName | null {
  const first = view.startIndex + view.charIndexOffset
  const last = first + view.numCharacters
  for (let i = 0, count = viewPartCount(view); i < count; i++) {
    const part = viewPartAt(view, i)
    const start = Math.min(Math.max(part.start, first), last)
    const end = Math.min(Math.max(part.end, first), last)
    if (k <= start) break
    let g: number
    let lo: number
    let hi: number
    if (part.kind === 'reshape') {
      g = part.call.group
      lo = part.call.start
      hi = part.call.end
    } else {
      if (part.sr.kind !== 'group') continue
      g = part.sr.group
      lo = sh.p.groups[g]!.start
      hi = sh.p.groups[g]!.end
    }
    const limit = positionLimit(sh, g, sliceEdge(sh.p, part.start, lo, hi), lo, hi) ?? positionLimit(sh, g, k >= end ? sliceEdge(sh.p, part.end, lo, hi) : k, lo, hi)
    if (limit !== null) return limit
    if (k <= end) break
  }
  return null
}

// The positions offset k of an item's result could have where the port's is a stand-in with an adjustment it can't place
// (positionLimit): from the adjustment sitting wholly on the glyphs after k to wholly on those before it. Null where the
// port knows the position or no adjustment shows. ShapeLine finds its candidate by comparing positions with the space
// left (CachedOffsetForPosition, shaping_line_breaker.cc:326-329), so a candidate inside such a range can be another one
// natively: in Amiri `ب` SHY `ب` measure 111 units less together than their joined forms apart, and natively the first
// keeps more of its width than the port gives it (c-57f4be10e9b75f4e).
export function positionBounds(sh: Shaper, sr: ShapeResult, k: number): [number, number] | null {
  if (sr.kind !== 'group' || k <= sr.start || k >= sr.end) return null
  const group = sh.p.groups[sr.group]!
  if (positionLimit(sh, sr.group, k, group.start, group.end) === null) return null
  const d = positionAdjust16(sh, sr.group, clusterStartAtOrBefore(sh.p, k, group.start), group.start, group.end)
  if (d === 0) return null
  const before = prefix16(sh, sr, k) - adjustBefore16(sh, sr.group, d, clusterStartAtOrBefore(sh.p, k, group.start), group.start, group.end)
  const a = !sr.rtl ? ceilFrom16(before) : ceilFrom16(sr.width16 - before)
  const b = !sr.rtl ? ceilFrom16(before + d) : ceilFrom16(sr.width16 - before - d)
  return [Math.min(a, b), Math.max(a, b)]
}
