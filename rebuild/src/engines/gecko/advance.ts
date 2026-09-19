// The glyph advance before a transformed offset, as the DOM's glyph records give it (Firefox 156.0): at a shaping unit's
// start it is the units' running sum, and inside a unit it is measured from the two sides of the offset, with the ligature
// groups, pair adjustments and joining forms Canvas can show, and the reason where Canvas can't confirm it
// (gfxTextRun::GetAdvanceWidth, gfxTextRun.cpp:1214-1256; ComputeLigatureData :238-322). specs/gecko-canvas.md §3.
import { bounds, contextFor, width } from '../../measure/canvas.js'
import { listedFontOf } from './fonts.js'
import { addLikelySubtags, tryParseLocale } from './likely.js'
import { CANVAS_AU_PER_PX, rangeAu } from './measure.js'
import { generalCategory, joiningType } from './props.js'
import type { GeckoPrepared, GeckoTextRun, GeckoUnit } from './types.js'

// A ligature across offset t inside a shaping unit: the grapheme clusters on both sides of t measure differently, in width or
// ink box, with ligatures off. letterSpacing 0.001px turns liga, clig, dlig and hlig off in Gecko's Canvas and adds no app
// unit (specs/gecko-canvas.md §1.10). The DOM gives a range edge inside a ligature the ligature's advance in shares by
// started clusters (ComputeLigatureData, gfxTextRun.cpp:238-322), which W(unit) − W(suffix) doesn't. Probe gecko-port F9
// (.artifacts/probes/gecko/round2): `fi` in 14px "Helvetica Neue" is 435 au either way, as wide as `f` and `i` apart, but its
// ink box ends at 438 au with ligatures and 438.36 without; the DOM gives `f` 217 au and `i` 218 inside `firstname`, where
// the recipe gives 249 and 186. Necessary, not sufficient: a ligature that moves neither the pair's width nor its box, or
// one that begins more than a cluster before t, doesn't show. A run with letter spacing has ligatures off in the DOM too
// (nsLayoutUtils.cpp:6901-6904).
function ligatureAcross(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  const settings = run.context.settings
  if (settings.letterSpacing !== '0px') return false
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let pair = ''
  for (let k = a; k < b; k++) pair += String.fromCharCode(p.tUnits[k]!)
  const on = bounds(run.context, pair)
  const off = bounds(contextFor(p.contexts, { ...settings, letterSpacing: '0.001px' }), pair)
  return on.width !== off.width || on.left !== off.left || on.right !== off.right
}

// The glyph advance of text run characters before t, the sum of the DOM's glyph records (gfxTextRun::GetAdvanceWidth,
// gfxTextRun.cpp:1214-1256), and why it is a stand-in where Canvas can't confirm it (null where it can). The records come
// from one shaping of the unit (gfxFont::SplitAndInitTextRun, gfxFont.cpp:3708-3900; SetLineBreaks never reshapes,
// gfxTextRun.cpp:1292-1301), which no Canvas string exposes, so inside a unit the advance is measured from the two sides of
// t, each shaped as the unit shapes it:
// - Letters that join across t keep their joined forms in the unit. HarfBuzz's Arabic shaper picks a letter's form from its
//   neighbours' joining types, and U+200D is Join_Causing (hb-ot-shaper-arabic.cc; ArabicShaping.txt), so the prefix is
//   measured with U+200D after it and the suffix with U+200D before it. U+200D itself has no advance.
// - Where the two sides add up to the unit, nothing in the unit's shaping moved an advance across t that a total shows
//   (kerning, a contextual form, a ligature narrower than its parts), and the advance before t is the prefix's. Probe
//   gecko-port F15 (.artifacts/probes/gecko/round3-f15): at 1,015 cuts of 300 words whose sides add up (Amiri, Noto Naskh
//   Arabic, Noto Nastaliq Urdu, Geeza Pro, Arial, Times New Roman, Courier New, Shantell Sans, Helvetica Neue, Verdana,
//   Georgia; 475 of them between joined letters) the prefix equals the DOM's advance at 1,013; the other two are the `fi`
//   ligature of "Helvetica Neue", as wide as its parts, which ligatureAcross sees (probe F9).
// - A ligature group shows in no total when it is as wide as its parts, and the DOM gives a range edge inside it the group's
//   width in shares by started clusters (ComputeLigatureData, gfxTextRun.cpp:238-322). ligatureAcross tests the optional
//   ligatures around t, and groupAcross the groups that required shaping forms (Geeza Pro's lam lam heh is lam and a lam-heh
//   ligature in one group of three shares, 223 au each, where U+200D after the first lam gives the same 136 au glyph).
// - Where the sides don't add up, the value is the stand-in the font's pair kerning asks for, and the reason names it.
export type InWordAdvance = { au: number; standIn: InWordReason | null }

// Why Canvas can't confirm the advance before an in-word offset, with the numbers the gap's prose prints (gaps.ts
// inWordDetail). `at` is the source offset.
export type InWordReason =
  | { kind: 'inside-cluster'; at: number; betweenMarks: boolean }
  | { kind: 'mark-starts-cluster'; at: number }
  | { kind: 'unit-starts-inside-cluster'; at: number }
  | { kind: 'group-mark-advances'; at: number }
  // Several ligature candidates in a row, which the facts don't settle (rowAround): the offset is inside the row, which
  // stands in as one group, or it ends a part of one.
  | { kind: 'inside-ligature-row'; at: number }
  | { kind: 'between-ligatures'; at: number }
  | { kind: 'group-ends'; at: number; end: InWordReason }
  // The two sides don't add up to the unit. `sides` is how they were measured (inWordAdvance), `au` their sum, or what the
  // cluster before the offset and the suffix gain from each other.
  | { kind: 'sides'; at: number; sides: 'joined' | 'apart' | 'cluster'; au: number; unitAu: number }

// What measuring found about one transformed offset of a shaping unit (GeckoPrepared.inWord), each part null until something
// asks for it. A line consults an offset several times (the scan, the measured edges, the redo, its placement and its
// inspection), and the next line and another width consult it again: it is measured once, and kept here.
export type InWordEntry = {
  // Whether Canvas shows an optional ligature over this cluster boundary (ligatureAcross), and whether it shows a group that
  // required shaping forms (groupAcross), which a boundary under an optional ligature is asked only by its row (rowAround).
  ligature: boolean | null
  group: boolean | null
  // The row of ligature candidates that starts here (rowAround).
  row: Row | null
  // The advance before the offset (advanceBefore).
  advance: InWordAdvance | null
  // W(suffix): the unit from this offset on, measured with nothing put before it (suffixAlone).
  suffixAu: number | null
}

function entryAt(p: GeckoPrepared, t: number): InWordEntry {
  const known = p.inWord[t] ?? null
  if (known !== null) return known
  const entry: InWordEntry = { ligature: null, group: null, row: null, advance: null, suffixAu: null }
  p.inWord[t] = entry
  return entry
}

const ZWJ = '\u200d'

export function advanceBefore(p: GeckoPrepared, run: GeckoTextRun, t: number): InWordAdvance {
  if (t >= run.tEnd) return { au: run.totalAdvance, standIn: null }
  const unit = p.units[p.unitOf[t]!]!
  if (t === unit.tStart) return { au: unit.startAdvance, standIn: null }
  const entry = entryAt(p, t)
  if (entry.advance === null) entry.advance = inWordAdvance(p, run, unit, t)
  return entry.advance
}

// W(suffix) of the unit from cluster start t, with nothing put before it. Two advances measure it: the one before t, where no
// letters join across t, and the one before the next cluster, which measures it with its own cluster in front (inWordAdvance,
// `withCluster`). Whichever comes first asks Canvas, and the other reads it here.
function suffixAlone(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): number {
  const entry = entryAt(p, t)
  if (entry.suffixAu === null) entry.suffixAu = rangeAu(run.context, run, p.tUnits, t, unit.tEnd)
  return entry.suffixAu
}

function inWordAdvance(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): InWordAdvance {
  if (p.clusterStart[t] === 0) {
    // Inside a grapheme cluster: a soft hyphen breaks there (GetHyphenationBreaks), and a text node can start there.
    // HarfBuzz keeps a mark in a cluster of its own unless the font merges it (HB_BUFFER_CLUSTER_LEVEL_MONOTONE_CHARACTERS,
    // gfxHarfBuzzShaper.cpp:1233-1234), Gecko attaches each clump's glyphs to the clump's first character and marks the rest
    // ligature continuations (:1705-1786), and a range edge inside a ligature group gets the group's width per started
    // cluster, so the part holding the cluster start takes the group (ComputeLigatureData, gfxTextRun.cpp:238-322). The
    // value follows that last rule: the advance before t is the advance before the cluster's end. Which clumps a cluster
    // has, and what each advances, no Canvas string shows: a mark measured at a string's start has no base (fresh
    // c-7421ac03d17f9f11: 14px Geeza Pro gives seen 448 au and the sukun after it, in the next span, 171 au, where the
    // cluster is 619 au and the sukun alone measures nothing).
    // That division is where a native frame becomes unbounded (probes gecko-port F18, F20). Two marks of one cluster share a
    // HarfBuzz cluster where the font ligates them, or where HarfBuzz reorders them by modified combining class, which merges
    // the clusters it moves across (hb-ot-shape-normalize.cc:394, hb_buffer_t::sort, hb-buffer.cc:2167-2185). Gecko gives
    // their glyphs to the first mark, a ligature group start that isn't a cluster start (gfxHarfBuzzShaper.cpp:1705-1786),
    // and a range edge between the marks cuts that group. Under kerx or a kern state machine marks keep their
    // advances, often negative ones (hb-ot-shape.cc:189-191), and ComputeLigatureData divides the group's signed advance by
    // an unsigned cluster count: `partClusterCount * (ligatureWidth / totalClusterCount)` with `int32_t ligatureWidth` and
    // `uint32_t totalClusterCount` (gfxTextRun.cpp:249-284). A negative advance W becomes 2^32 + W au for the part before the
    // cut and W − (2^32 + W) for the last part (:286-289), so the first frame takes nscoord_MAX and the second 0
    // (NSToCoordCeilClamped over max(0, advance), nsTextFrame.cpp:11272-11273). 20px "Geeza Pro", reh fatha | shadda: the
    // frame holding reh and fatha is 17,895,698px wide, nscoord_MAX through float32, and the word moves to a line of its own.
    // F20: of 30 ordered pairs of marks after reh, the 18 that are cut unbounded are the 15 HarfBuzz reorders and shadda
    // before fatha, damma or kasra, which "Geeza Pro" ligates; every pair's glyphs advance by −1 to −109 au, which the base
    // takes back, so Canvas totals show nothing; in Arial, positioned through GPOS, marks have no advance and the cut is
    // bounded. Canvas shows neither the shared cluster nor the advance's sign, so the port keeps the ordinary division and
    // says so here.
    let end = t + 1
    while (end < unit.tEnd && p.clusterStart[end] === 0) end++
    const inner = advanceBefore(p, run, end)
    const previous = (p.tUnits[t - 1]! & 0xfc00) === 0xdc00 && t - 2 >= unit.tStart ? t - 2 : t - 1
    const betweenMarks = previous >= unit.tStart && p.clusterStart[previous] === 0 && run.joining !== 'opentype'
    return { au: inner.au, standIn: { kind: 'inside-cluster', at: p.tSource[t]!, betweenMarks } }
  }
  // A mark that starts a cluster: Unicode leaves some spacing marks out of Grapheme_Cluster_Break=SpacingMark (U+102B, U+102C
  // and U+1038 in Myanmar among them), so Gecko starts a cluster there, but to HarfBuzz's syllabic shapers the mark belongs to
  // the syllable before it, and a string that starts with it is a broken syllable, which gets a dotted circle
  // (hb_syllabic_insert_dotted_circles, hb-ot-shaper-syllabic.cc:32-99): the suffix measured alone doesn't shape as it does
  // in the unit. 20px "Myanmar MN": U+1038 alone is 982 au, a 649 au dotted circle and the 333 au the DOM gives it after
  // U+1004 U+102B (probe gecko-port F23). The value is the prefix's width, which ends before the mark, and a stand-in.
  if (generalCategory(codePointAtT(p, t))[0] === 'M') {
    const prefixAu = rangeAu(run.context, run, p.tUnits, unit.tStart, t)
    return { au: unit.startAdvance + prefixAu + p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!, standIn: { kind: 'mark-starts-cluster', at: p.tSource[t]! } }
  }
  const joiner = joinsAcross(p, unit, t) ? ZWJ : ''
  // A unit that starts inside a cluster (a mark or an emoji modifier after an invalid character): Canvas counts its first
  // characters as a group of their own when it measures the unit alone and as part of the space before them when a script
  // context stands in front (rangeAu), so its ligature groups can't be counted, and its positions stay stand-ins.
  if (p.clusterStart[unit.tStart] === 0) {
    const inner = rangeAu(run.context, run, p.tUnits, t, unit.tEnd, joiner, '')
    return { au: unit.startAdvance + unit.canvasAu - inner + p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!, standIn: { kind: 'unit-starts-inside-cluster', at: p.tSource[t]! } }
  }
  // A ligature group over t: the DOM gives a range edge inside it the group's advance in equal shares per started cluster,
  // the rounding left to the last part (ComputeLigatureData, gfxTextRun.cpp:238-322). The group reaches as far as Canvas
  // shows one at each offset on the way (groupSpans), and its advance is what lies between its two ends, which are offsets
  // like any other. Probe gecko-port F17: lam and alef in 16px Geeza Pro are 280 and 281 au of a 561 au group, lam lam heh
  // 223 au each of 669, U+0E24 U+0E32 in 20px Thonburi 663 each; F9: `f` 217 and `i` 218 au of "Helvetica Neue"'s 435 au `fi`.
  const group = groupAround(p, run, unit, t)
  if (group !== null) {
    const from = advanceBefore(p, run, group.start)
    const to = advanceBefore(p, run, group.end)
    let clusters = 0
    let before = 0
    for (let k = group.start; k < group.end; k++) {
      if (p.clusterStart[k] === 0 && k !== group.start) continue
      clusters++
      if (k < t) before++
    }
    // The shares are of the group alone. A mark inside the range can hold glyphs of its own, a ligature group start that
    // isn't a cluster start (gfxFont.cpp:708-769, gfxHarfBuzzShaper.cpp:1705-1786), and an advance it has goes to the part
    // it is in. HarfBuzz zeroes mark advances unless the font positions through kerx or a kern state machine
    // (plan.zero_marks, hb-ot-shape.cc:189-191, :1051-1070), which the fonts the `joining` fact calls 'aat' do: 20px Geeza
    // Pro's lam sukun meem damma breaks into 245 and 203 au natively, halves of a 490 au group and −42 au on the damma,
    // where Canvas measures 448 au with the marks and without them. So a group holding a mark is confirmed only in a font
    // the fact calls 'opentype'.
    let marks = false
    for (let k = group.start; k < group.end && !marks; k++) marks = p.clusterStart[k] === 0 && (p.tUnits[k]! & 0xfc00) !== 0xdc00
    const markAdvance = marks && run.joining !== 'opentype'
    const edges = from.standIn ?? to.standIn
    return {
      au: from.au + before * Math.floor((to.au - from.au) / clusters),
      standIn: markAdvance ? { kind: 'group-mark-advances', at: p.tSource[t]! }
        : group.unconfirmed ? { kind: 'inside-ligature-row', at: p.tSource[t]! }
        : edges === null ? null : { kind: 'group-ends', at: p.tSource[t]!, end: edges },
    }
  }
  // A ligature candidate that ends a part of a row of them (rowAround), and the facts don't say so.
  const row = rowAround(p, run, unit, t)
  const leftOver = row !== null && row.unconfirmed
  const corrections = p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!
  const reversed = shapedReversed(p, run, unit, t)
  const suffixAu = joiner === '' ? suffixAlone(p, run, unit, t) : rangeAu(run.context, run, p.tUnits, t, unit.tEnd, joiner, '')
  // What the unit's shaping moves across t, and the prefix's advance if nothing does.
  let across: number
  let prefixAu: number
  let sides: Extract<InWordReason, { kind: 'sides' }>['sides']
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  const before = joiningType(codePointAtT(p, a))
  // The glyph before t is a ligature where a group ends at t, and it is the ligature that the suffix's first glyph kerns with.
  if (a > unit.tStart) {
    const ending = groupAround(p, run, unit, a)
    if (ending !== null && ending.end === t) a = ending.start
  }
  if (joiner !== '' || reversed || before === 'R' || before === 'D' || before === 'L' || before === 'C') {
    // The two sides as the unit shapes them: with U+200D at the cut between joined letters.
    prefixAu = rangeAu(run.context, run, p.tUnits, unit.tStart, t, '', joiner)
    across = unit.canvasAu - prefixAu - suffixAu
    sides = joiner !== '' ? 'joined' : 'apart'
  } else {
    // Where the cluster before t has no joining forms, it shapes alone as it does after its own neighbour, and put in front
    // of the suffix it shows the same thing: what the two gain from each other is W(cluster and suffix) − W(suffix) −
    // W(cluster). That asks Canvas for one long string per offset instead of two, and the offset before it has asked for
    // the other already (suffixAlone; a paragraph of 9,428 Han characters is one unit). A letter with joining forms takes the form its
    // own neighbour gives it, and what it gains from the suffix goes by that form (fresh c-b44094d264947ac3: a final alef
    // before lam in 16px Amiri is 220 au, where alef alone in front of the suffix adds its isolated 217 au).
    const withCluster = a === unit.tStart ? unit.canvasAu : suffixAlone(p, run, unit, a)
    across = withCluster - suffixAu - rangeAu(run.context, run, p.tUnits, a, t)
    prefixAu = unit.canvasAu - suffixAu - across
    sides = 'cluster'
  }
  if (across !== 0 && joiner === '' && !reversed && !leftOver) {
    // The sides don't add up, and the font's pair kerning says where an adjustment across t goes: the advance is exact where
    // Canvas shows the difference is that pair's adjustment and no ligature group spans t.
    const after = pairKernedShare(p, run, unit, a, t, across)
    if (after !== null) {
      return { au: unit.startAdvance + unit.canvasAu - suffixAu - after + corrections, standIn: null }
    }
  }
  const standIn: InWordReason | null = leftOver ? { kind: 'between-ligatures', at: p.tSource[t]! }
    : across !== 0 ? { kind: 'sides', at: p.tSource[t]!, sides, au: sides === 'cluster' ? across : prefixAu + suffixAu, unitAu: unit.canvasAu } : null
  // The value, exact where nothing crosses t and a stand-in otherwise, takes what crosses t as a pair adjustment:
  // - A shaping buffer against its script's native direction is shaped reversed (hb_ensure_native_direction,
  //   hb-ot-shape.cc:588-645, in Chromium 152's HarfBuzz copy), so the adjustment lands on the logically later glyph, and
  //   the advance before t is the prefix's own.
  // - A font whose pair adjustments HarfBuzz applies through the kern and kerx pair machine gives the glyph before t
  //   `kern >> 1` of it and the rest to the glyph after it (hb-kern.hh:102-106 in Firefox's HarfBuzz 14.3.1;
  //   hb-ot-shape.cc:130-187 chooses it where GPOS has no kern feature; probe gecko-port F12: Times New Roman `AV`
  //   710 + 710 against 780 + 780 and 1420).
  // - GPOS puts all of it on the first glyph, W(unit) − W(suffix), and so does the default where the fact isn't given.
  let au: number
  if (reversed) au = prefixAu
  else if (pairKerningAt(run, t) === 'split' && joiner === '') au = prefixAu + (across >> 1)
  else au = unit.canvasAu - suffixAu
  return { au: unit.startAdvance + au + corrections, standIn }
}

// Where a pair adjustment crosses t: the part of it that lands after t, on the suffix's first glyph, or null where Canvas
// can't confirm it. The advance before t is then W(unit) − W(suffix) less that part, since the suffix measured alone lacks
// exactly it. R = W(cluster before t and suffix) − W(suffix) − W(cluster) is what the pair moves, in app units rounded per
// glyph; the cluster starts at a, the start of its ligature where it ends one.
// - 'first-advance': GPOS adds the whole adjustment to the first glyph's advance (PairSet.hh:126-127), so nothing lands
//   after t. The pair measured alone must show the same adjustment as R: the same glyph rounds the same sum in both.
// - 'split': the kern and kerx pair machine adds kern1 = kern >> 1 to the first glyph's advance and the rest, kern2, to the
//   second's (hb-kern.hh:102-106), in 16.16 device px, and Gecko then rounds each glyph's advance to app units
//   (gfxHarfBuzzShaper.cpp:1699-1702). With y the advance of the cluster before t alone and z of the glyph after it in the
//   suffix, R is (round(y + kern1) − round(y)) + (round(z + kern2) − round(z)), each term floor(kern / 2) or that plus one
//   in app units, since kern1 and kern2 differ by one 16.16 unit at most. So an even R is twice the second term. An odd R
//   leaves the two terms one apart, and which one is larger depends on the fractions of y and z, which Canvas shows at a
//   larger font size: at size × 2^k every advance and adjustment is 2^k times as large before it is rounded, so a cluster
//   measured there gives its advance to within half a step, 0.5 / 2^k au, and a pair less its two clusters the pair's
//   adjustment to within four half steps, so half of it to within 1 / 2^k au. Both terms are then computed, and count only
//   where each rounding is further from a tie than its inputs' reach and the terms add up to R; at a small k the reach is
//   so wide that nothing counts, so k needs no floor of its own. Probe gecko-port F16
//   (.artifacts/probes/gecko/round3-f16): 92 of 92 even adjustments divide in halves in Verdana, Times New Roman, Helvetica
//   and Helvetica Neue; of 37 odd ones the recipe gives the DOM's first advance in 36 and meets a tie in one (Verdana 16px
//   `xe`: 562.5 au).
// The pair measured alone must show an adjustment within 2 au of R, which the three rounded terms allow.
// A total can't tell a pair adjustment from a second cluster that changes with its neighbour, and font matching gives one a
// neighbour's font: a character after U+200D takes the previous font where it can, and one that no listed or preferred font
// has takes the previous character's (gfxTextRun.cpp:3319-3325, :3559-3569; held-out `a U+3000 U+200D b` in 16px Arial:
// `b` is 563 au after the fallback font's U+3000 and 534 au alone). So both clusters, and the one after them, whose
// adjustment with the second enters z, must be printable ASCII, which the preferred fonts of every language group cover
// before the previous font is tried (:3533-3552).
function pairKernedShare(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, a: number, t: number, R: number): number | null {
  const pairKerning = pairKerningAt(run, t)
  if (pairKerning === null) return null
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let b1 = b
  if (b < unit.tEnd) { b1 = b + 1; while (b1 < unit.tEnd && p.clusterStart[b1] === 0) b1++ }
  for (let k = a; k < b1; k++) if (p.tUnits[k]! < 0x21 || p.tUnits[k]! > 0x7e) return null
  const alone = rangeAu(run.context, run, p.tUnits, a, b) - rangeAu(run.context, run, p.tUnits, a, t) - rangeAu(run.context, run, p.tUnits, t, b)
  if (pairKerning === 'first-advance') return alone === R ? 0 : null
  if (Math.abs(alone - R) > 2) return null
  if (R % 2 === 0) return R / 2
  // An odd adjustment: the fractions, from the run's context at 2^k times its font size. gfxFont clamps a font's size at
  // 2000px (gfxFont.cpp:4956-4960).
  const settings = run.context.settings
  const size = /(\d+(?:\.\d+)?)px/.exec(settings.font)
  if (size === null || !(Number(size[1]) > 0)) return null
  let k = 0
  while (Number(size[1]) * 2 ** (k + 1) <= 2000) k++
  const scale = 2 ** k
  const large = contextFor(p.contexts, { ...settings, font: settings.font.replace(size[0], `${String(Number(size[1]) * scale)}px`) })
  const w = (from: number, to: number): number => rangeAu(large, run, p.tUnits, from, to) / scale
  const kern = (from: number, mid: number, to: number): number => w(from, to) - w(from, mid) - w(mid, to)
  const half = kern(a, t, b) / 2
  const y = w(a, t)
  const z = w(t, b) + (b1 > b ? kern(t, b, b1) / 2 : 0)
  // floor(x + 0.5), or null where x is within `reach` au of a tie.
  const rounded = (x: number, reach: number): number | null => Math.abs(x - Math.floor(x) - 0.5) <= reach ? null : Math.floor(x + 0.5)
  const reachY = 0.5 / scale
  const reachZ = (0.5 + (b1 > b ? 1 : 0)) / scale
  const first = [rounded(y + half, reachY + 1 / scale), rounded(y, reachY)]
  const second = [rounded(z + half, reachZ + 1 / scale), rounded(z, reachZ)]
  if (first[0] === null || first[1] === null || second[0] === null || second[1] === null) return null
  if (first[0]! - first[1]! + second[0]! - second[1]! !== R) return null
  return second[0]! - second[1]!
}

// FontFacts.pairKerning at offset t, or null where it doesn't describe the script run there. The fact is about Latin text,
// and the script decides too: the plan looks the kern feature up under the script's own GPOS records and, where they lack
// it, positions pairs through kerx or the kern table (hb-ot-shape.cc:134, :173-184); the Hebrew shaper takes GPOS only under
// 'hebr' (:135-136, hb-ot-shaper-hebrew.cc:204), and only a shaper with fallback positioning reads the kern table
// (:181). Fresh c-1cee0563b3bac8bd: `11` between Hebrew words in 24px Arial is 747 and 747 au, the kern table's halves of
// −108 au, where Arial's Latin pairs go to the first glyph through GPOS: the digits are a text run of their own, Common
// characters alone, which take the language's likely script, Hebrew under lang="he", and Latin where the language gives none
// (ResolveScriptForLang, gfxTextRun.cpp:2581-2640, :2755-2756, :2799-2806; gfxHarfBuzzShaper.h:83-94). So the fact counts
// in a Latin run, and in a Greek or Cyrillic run, which the default shaper shapes as it does Latin (hb_ot_shaper_categorize,
// hb-ot-shaper.hh), where the scriptLookups fact says the script selects Latin's lookups.
function pairKerningAt(run: GeckoTextRun, t: number): 'first-advance' | 'split' | null {
  let k = 0
  while (run.scriptRuns[k]!.limit <= t) k++
  let script = run.scriptRuns[k]!.script
  if (script === 'Zyyy' || script === 'Zinh') {
    const locale = tryParseLocale(run.context.settings.lang)
    const likely = locale === null ? '' : addLikelySubtags(locale.language, locale.script, locale.region).script
    script = likely === '' ? 'Latn' : likely
  }
  if (script === 'Latn') return run.pairKerning
  if (run.scriptLookups === null || (script !== 'Grek' && script !== 'Cyrl')) return null
  let own = -1
  let latin = -1
  for (let g = 0; g < run.scriptLookups.length; g++) {
    if (run.scriptLookups[g]!.includes(script)) own = g
    if (run.scriptLookups[g]!.includes('Latn')) latin = g
  }
  return own === latin ? run.pairKerning : null
}

// Whether Canvas shows a ligature group over cluster boundary t: an optional ligature (ligatureAcross) or a group required
// shaping forms (groupAcross).
function groupSpans(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  // Not in a unit that starts inside a cluster, whose groups Canvas can't count (inWordAdvance).
  if (p.clusterStart[unit.tStart] === 0) return false
  const entry = entryAt(p, t)
  if (entry.ligature === null) entry.ligature = ligatureAcross(p, run, unit, t)
  return entry.ligature || groupAcrossAt(p, run, unit, t)
}

// groupAcross at cluster boundary t, with U+200D at the cut where letters join across it.
function groupAcrossAt(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  const entry = entryAt(p, t)
  if (entry.group === null) entry.group = groupAcross(p, run, unit, t, joinsAcross(p, unit, t) ? ZWJ : '')
  return entry.group
}

// The row of ligature candidates over cluster boundary t, or null: it runs from the nearest cluster boundary before t that
// Canvas shows no group over, or the unit's start, to the nearest such boundary after t, or the unit's end. `edges` are the
// ends of its ligature groups, the row's own two included.
// With one candidate the row is one group. With several, groupAcross counts groups in the unit's own shaping, but
// ligatureAcross tests a pair alone, and in the unit a ligature lookup walks the glyphs once from the start and goes on
// after the components a ligature took (apply_forward, hb-ot-layout.cc:1917-1945, and ligate_input; morx's ligature
// machine runs forward too, hb-aat-layout-morx-table.hh:447-600), so a candidate can have lost its first letter to the one
// before it: `fff` in 16px "Helvetica Neue" is an `ff` ligature of 277 au shares and an `f` of 284 au (fresh
// c-545b8fb978408502), where `ff` alone tests as a ligature at both boundaries, and its `ffi` is one ligature of three.
// The ligatures fact settles it (listedParts). Without it the row stands in as one group, unconfirmed.
type Row = { edges: number[]; unconfirmed: boolean }
function rowAround(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): Row | null {
  if (!groupSpans(p, run, unit, t)) return null
  let start = t
  do {
    start--
    while (start > unit.tStart && p.clusterStart[start] === 0) start--
  } while (start > unit.tStart && groupSpans(p, run, unit, start))
  let end = t
  do {
    end++
    while (end < unit.tEnd && p.clusterStart[end] === 0) end++
  } while (end < unit.tEnd && groupSpans(p, run, unit, end))
  const first = entryAt(p, start)
  if (first.row !== null) return first.row
  let boundaries = 0
  let optional = false
  const required: number[] = []
  for (let b = start + 1; b < end; b++) {
    if (p.clusterStart[b] === 0) continue
    boundaries++
    if (groupAcrossAt(p, run, unit, b)) required.push(b)
    else optional = true
  }
  if (boundaries < 2 || !optional) first.row = { edges: [start, end], unconfirmed: false }
  else {
    const edges = listedParts(p, run, start, end)
    // A group that required forms made, which the unit's own shaping showed, can't end inside the facts' parts.
    let agrees = edges !== null
    for (let k = 0; agrees && k < required.length; k++) agrees = !edges!.includes(required[k]!)
    first.row = agrees ? { edges: edges!, unconfirmed: false } : { edges: [start, end], unconfirmed: true }
  }
  return first.row
}

// The ligature group over cluster boundary t, or null where no group spans it.
export function groupAround(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): { start: number; end: number; unconfirmed: boolean } | null {
  const row = rowAround(p, run, unit, t)
  if (row === null) return null
  for (let k = 0; k + 1 < row.edges.length; k++) {
    if (row.edges[k]! < t && t < row.edges[k + 1]!) return { start: row.edges[k]!, end: row.edges[k + 1]!, unconfirmed: row.unconfirmed }
  }
  return null
}

// The ligature groups of a row of candidates [start, end) by the ligatures fact of the listed font that draws it
// (ListedFontFacts.ligatures), as ends of groups, or null where the fact doesn't settle them. From the row's start, the
// longest listed pattern that matches is a ligature, as the fact defines a pattern, and a letter no pattern starts at stands
// alone: the lookup tries a glyph's ligatures where it stands and goes on after the one it formed. Settled only where every
// cluster is one character that one listed font draws, the fact lists every ligature (`complete`), each pattern that
// matches was shaped in every combination and context (`exact`, `everyContext`), none reaches past the row, where Canvas
// showed no ligature, and the language selects no language system the fact left untried: a font without any, or English,
// whose tag 'ENG ' (hb-ot-tag-table.hh:54; Gecko gives HarfBuzz the style language, gfxHarfBuzzShaper.cpp:1470-1481) the
// fact doesn't list.
function listedParts(p: GeckoPrepared, run: GeckoTextRun, start: number, end: number): number[] | null {
  const fonts = run.font.facts.fonts
  if (fonts === undefined) return null
  const clusters: string[] = []
  const at: number[] = []
  let listed = -2
  for (let k = start; k < end;) {
    const cp = codePointAtT(p, k)
    const length = cp > 0xffff ? 2 : 1
    if (k + length < end && p.clusterStart[k + length] === 0) return null
    const index = listedFontOf(run.font, cp)
    if (index === null || index < 0 || (listed !== -2 && index !== listed)) return null
    listed = index
    clusters.push(String.fromCodePoint(cp))
    at.push(k)
    k += length
  }
  at.push(end)
  const facts = fonts[listed]!.ligatures
  if (facts === null || !facts.complete) return null
  if (facts.languageSystems.length > 0) {
    const lang = run.context.settings.lang.toLowerCase()
    if (lang !== 'en' && !lang.startsWith('en-')) return null
    for (let k = 0; k < facts.languageSystems.length; k++) if (facts.languageSystems[k]!.split('/')[2] === 'ENG ') return null
  }
  const edges = [start]
  for (let i = 0; i < clusters.length;) {
    let longest = 1
    for (let k = 0; k < facts.patterns.length; k++) {
      const pattern = facts.patterns[k]!
      const n = pattern.positions.length
      if (n <= longest || !pattern.positions[0]!.includes(clusters[i]!)) continue
      let matches = true
      for (let j = 0; j < n && matches; j++) {
        const alternatives = pattern.positions[j]!
        // An alternative of several characters could match across clusters, which this doesn't try.
        for (let a = 0; a < alternatives.length; a++) if ([...alternatives[a]!].length !== 1) return null
        matches = i + j < clusters.length ? alternatives.includes(clusters[i + j]!) : false
      }
      // A pattern that would match with the text after the row: Canvas showed no ligature there.
      if (!matches && i + n > clusters.length) {
        let prefix = true
        for (let j = 0; i + j < clusters.length && prefix; j++) prefix = pattern.positions[j]!.includes(clusters[i + j]!)
        if (prefix && rowContinues(p, pattern, clusters.length - i, end)) return null
      }
      if (!matches) continue
      if (!pattern.exact || !pattern.everyContext) return null
      longest = n
    }
    i += longest
    edges.push(at[i]!)
  }
  return edges
}

// Whether the text from `end` on completes a pattern whose first `matched` positions matched the row's last clusters.
function rowContinues(p: GeckoPrepared, pattern: { positions: readonly (readonly string[])[] }, matched: number, end: number): boolean {
  let k = end
  for (let j = matched; j < pattern.positions.length; j++) {
    if (k >= p.tUnits.length) return false
    const cp = codePointAtT(p, k)
    if (!pattern.positions[j]!.includes(String.fromCodePoint(cp))) return false
    k += cp > 0xffff ? 2 : 1
  }
  return true
}

// A ligature group across offset t that required shaping forms: a ligature glyph, or glyphs HarfBuzz returns as one cluster
// (gfxHarfBuzzShaper.cpp:1705-1786), which keeps its characters' cluster starts and clears their ligature group starts.
// Canvas counts the groups: CanvasBidiProcessor adds letter spacing after a character only where the next one starts a
// cluster and a ligature group (CanvasRenderingContext2D.cpp:4759-4790), so W at 2px of letter spacing less W at 0.001px,
// over 2px, is the number of groups; both turn optional ligatures off, which ligatureAcross tests. A unit with as many
// groups as clusters has none across any offset. Otherwise a group spans t where the two sides hold more groups together
// than the unit: cutting a group leaves a part of it, at least one group, on each side. Probe gecko-port F17
// (.artifacts/probes/gecko/round3-f17): fewer groups than clusters exactly in the 25 of 150 words whose DOM code point rects
// show equal shares under required shaping (lam-alef in Geeza Pro, Arial, Times New Roman and Courier New, Geeza Pro's
// lam-meem and lam lam heh, U+0E24 U+0E32 in Thonburi); Arial's optional Allah ligature measures 761 au with ligatures and
// 957 without.
function groupAcross(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number, joiner: string): boolean {
  const settings = run.context.settings
  const spaced = contextFor(p.contexts, { ...settings, letterSpacing: '2px' })
  const off = contextFor(p.contexts, { ...settings, letterSpacing: '0.001px' })
  const groups = (tStart: number, tEnd: number, before: string, after: string): number =>
    (rangeAu(spaced, run, p.tUnits, tStart, tEnd, before, after) - rangeAu(off, run, p.tUnits, tStart, tEnd, before, after)) / (2 * CANVAS_AU_PER_PX)
  // The unit's own count is the same at every offset, so the unit keeps it.
  if (unit.groups === null) {
    let clusters = 0
    for (let k = unit.tStart; k < unit.tEnd; k++) clusters += p.clusterStart[k]!
    unit.groups = { counted: groups(unit.tStart, unit.tEnd, '', ''), clusters }
  }
  const inUnit = unit.groups.counted
  if (inUnit === unit.groups.clusters) return false
  // U+200D before the suffix is a cluster of its own, which the joiner measured alone counts too.
  const joinerGroups = joiner === '' ? 0 : (Math.round(width(spaced, joiner) * CANVAS_AU_PER_PX) - Math.round(width(off, joiner) * CANVAS_AU_PER_PX)) / (2 * CANVAS_AU_PER_PX)
  return groups(unit.tStart, t, '', joiner) + groups(t, unit.tEnd, joiner, '') - joinerGroups !== inUnit
}

// hb_script_get_horizontal_direction's right-to-left scripts (hb-common.cc, Chromium 152's HarfBuzz copy), by ISO 15924 tag;
// Old Hungarian, Old Italic, Runic and Tifinagh are invalid there, which never reverses.
const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Cprt', 'Khar', 'Phnx', 'Nkoo', 'Lydi', 'Avst', 'Armi', 'Phli', 'Prti', 'Sarb',
  'Orkh', 'Samr', 'Mand', 'Merc', 'Mero', 'Mani', 'Mend', 'Nbat', 'Narb', 'Palm', 'Phlp', 'Hatr', 'Adlm', 'Rohg', 'Sogo', 'Sogd', 'Elym',
  'Chrs', 'Yezi', 'Ougr', 'Gara', 'Sidt'])
const BIDIRECTIONAL_SCRIPTS = new Set(['Hung', 'Ital', 'Runr', 'Tfng'])

// Whether HarfBuzz shapes the unit holding t reversed: the text run's direction differs from the native direction of the
// script run's HarfBuzz script. Gecko shapes an unresolved Common or Inherited run as Latin (gfxHarfBuzzShaper.h:83-94). A
// natively right-to-left run shaped left-to-right with a decimal digit or a regional indicator and no letter counts as
// left-to-right (hb-ot-shape.cc:588-645).
function shapedReversed(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  let k = 0
  while (run.scriptRuns[k]!.limit <= t) k++
  const script = run.scriptRuns[k]!.script
  const rtlRun = (run.level & 1) === 1
  if (BIDIRECTIONAL_SCRIPTS.has(script)) return false
  let nativeRtl = RTL_SCRIPTS.has(script)
  if (nativeRtl && !rtlRun) {
    let number = false
    let letter = false
    for (let i = unit.tStart; i < unit.tEnd; i++) {
      const cp = codePointAtT(p, i)
      if ((cp & 0xfc00) === 0xdc00 && i > unit.tStart) continue
      const gc = generalCategory(cp)
      if (gc[0] === 'L') { letter = true; break }
      if (gc === 'Nd' || (cp >= 0x1f1e6 && cp <= 0x1f1ff)) number = true
    }
    if (number && !letter) nativeRtl = false
  }
  return nativeRtl !== rtlRun
}

export function codePointAtT(p: GeckoPrepared, i: number): number {
  const u = p.tUnits[i]!
  if ((u & 0xfc00) === 0xdc00 && i > 0 && (p.tUnits[i - 1]! & 0xfc00) === 0xd800) return 0x10000 + ((p.tUnits[i - 1]! - 0xd800) << 10) + (u - 0xdc00)
  if ((u & 0xfc00) === 0xd800 && i + 1 < p.tUnits.length && (p.tUnits[i + 1]! & 0xfc00) === 0xdc00) return 0x10000 + ((u - 0xd800) << 10) + (p.tUnits[i + 1]! - 0xdc00)
  return u
}

// A cursive connection across offset t inside a unit: the last non-transparent letter before t joins to its following
// side and the first non-transparent letter from t joins to its preceding side (Joining_Type, ArabicShaping.txt).
export function joinsAcross(p: GeckoPrepared, unit: GeckoUnit, t: number): boolean {
  let a = t - 1
  while (a > unit.tStart && joiningType(codePointAtT(p, a)) === 'T') a--
  let b = t
  while (b + 1 < unit.tEnd && joiningType(codePointAtT(p, b)) === 'T') b++
  const left = joiningType(codePointAtT(p, a))
  const right = joiningType(codePointAtT(p, b))
  return (left === 'D' || left === 'L' || left === 'C') && (right === 'D' || right === 'R' || right === 'C')
}
