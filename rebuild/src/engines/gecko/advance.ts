// The glyph advance before a transformed offset, as the DOM's glyph records give it (Firefox 156.0): at a shaping unit's
// start it is the units' running sum, and inside a unit it is measured from the two sides of the offset, with the ligature
// groups, pair adjustments and joining forms Canvas can show, and the reason where Canvas can't confirm it
// (gfxTextRun::GetAdvanceWidth, gfxTextRun.cpp:1214-1256; ComputeLigatureData :238-322). specs/gecko-canvas.md §3.
import { bounds, contextFor, width, type Context } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import { firstFontScriptLookups, listedFontOf } from './fonts.js'
import { addLikelySubtags, tryParseLocale } from './likely.js'
import { CANVAS_AU_PER_PX, letterSpacedContext, noLigaturesContext, rangeAu } from './measure.js'
import { generalCategory, joiningType } from './props.js'
import type { GeckoPrepared, GeckoTextRun, GeckoUnit, InWord, InWordAdvance, InWordEntry, InWordReason, InWordSides, LigatureRow, PairPlacement } from './types.js'

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
  if (run.contexts.own.settings.letterSpacing !== '0px') return false
  let a = t - 1
  while (a > unit.tStart && p.clusterStart[a] === 0) a--
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let pair = ''
  for (let k = a; k < b; k++) pair += String.fromCharCode(p.tUnits[k]!)
  const on = bounds(run.contexts.own, pair)
  const off = bounds(noLigaturesContext(p.contexts, run.contexts), pair)
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
export function advanceBefore(p: GeckoPrepared, run: GeckoTextRun, t: number): InWordAdvance {
  if (t >= run.tEnd) return { au: run.totalAdvance, standIn: null }
  const unit = windowAt(p, run, p.units[p.unitOf[t]!]!, t)
  if (t === unit.tStart) return { au: unit.startAdvance, standIn: null }
  const entry = entryAt(unit, t)
  if (entry.advance === null) entry.advance = inWordAdvance(p, run, unit, t)
  return entry.advance
}

// What measuring found inside a unit (GeckoUnit.inWord), made when its first offset asks.
function inWordOf(unit: GeckoUnit): InWord {
  if (unit.inWord === null) unit.inWord = { groups: null, offsets: new Array<InWordEntry | null>(unit.tEnd - unit.tStart).fill(null), windows: null }
  return unit.inWord
}

function entryAt(unit: GeckoUnit, t: number): InWordEntry {
  const offsets = inWordOf(unit).offsets
  const known = offsets[t - unit.tStart] ?? null
  if (known !== null) return known
  const entry: InWordEntry = { ligature: null, group: null, row: null, advance: null, suffixAu: null }
  offsets[t - unit.tStart] = entry
  return entry
}

// A window's clusters. A string size the port chose, not engine data: every question inside a window is at most two
// windows long, and a cut costs eight questions.
const WINDOW_CLUSTERS = 16

// The unit the recipes below measure offset t in: the shaping unit, or in a long one its window around t. Gecko shapes a
// word of any length in one call (gfxFont.cpp:3804-3808; ShapeFragmentWithoutWordCache cuts only at 32,760 units,
// :3564-3617), so every recipe here measures to the unit's end, and the characters sent to Canvas grow with the square
// of a unit's length: text without spaces is one unit. Where Canvas shows that nothing in the shaping crosses a cut
// (windowsOf), the text between two cuts measures alone as it does in the unit, which is all a recipe needs of a unit.
function windowAt(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): GeckoUnit {
  if (unit.tEnd - unit.tStart <= 2 * WINDOW_CLUSTERS) return unit
  const inWord = inWordOf(unit)
  if (inWord.windows === null) inWord.windows = windowsOf(p, run, unit)
  const windows = inWord.windows
  if (windows.length === 0) return unit
  let low = 0
  let high = windows.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (windows[mid]!.tStart <= t) low = mid
    else high = mid - 1
  }
  return windows[low]!
}

// The windows of a long unit, made when its first offset asks; none where no cut holds. Cuts are tried at every 16th
// cluster start, the last cell keeping what is left under two cells. A cut holds where Canvas shows what the recipes
// below ask of any offset whose advance they call exact, over the cells on its two sides:
// - no letters join across it (joinsAcross), and no mark starts its cluster (inWordAdvance, 'mark-starts-cluster');
// - the two cells measured alone add up to the two measured together, so no kerning, contextual form or ligature that a
//   total shows crosses it;
// - no optional ligature as wide as its parts spans it (ligatureAcross), and the two cells hold as many ligature groups
//   apart as together (groupsIn), so no group that required forms made spans it.
// A cut that doesn't hold leaves its two cells in one window, measured whole. The windows must add up to the unit, which
// ties every cut to the unit's own shaping; a unit of 2^18 px or more never does (gaps.ts wideUnit) and keeps the long
// questions.
function windowsOf(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit): GeckoUnit[] {
  // Canvas can't count the groups of a unit that starts inside a cluster (inWordAdvance).
  if (p.clusterStart[unit.tStart] === 0) return []
  // A right-to-left script in a left-to-right run, which a direction override makes: HarfBuzz shapes it reversed or not
  // by what its whole buffer holds (shapedReversed: digits without a letter stay left to right), so Canvas can shape a
  // window of digits alone the other way round than the DOM shapes the unit, and place its pair adjustments on the other
  // glyph. Such a unit keeps the long questions.
  let k = 0
  while (run.scriptRuns[k]!.limit <= unit.tStart) k++
  if ((run.level & 1) === 0 && RTL_SCRIPTS.has(run.scriptRuns[k]!.script)) return []
  let clusters = 0
  for (let k = unit.tStart; k < unit.tEnd; k++) clusters += p.clusterStart[k]!
  const grid: number[] = []
  let c = 0
  for (let k = unit.tStart; k < unit.tEnd; k++) {
    if (p.clusterStart[k] === 0) continue
    if (c % WINDOW_CLUSTERS === 0 && clusters - c >= WINDOW_CLUSTERS) grid.push(k)
    c++
  }
  grid.push(unit.tEnd)
  if (grid.length < 3) return []
  const own = run.contexts.own
  const windows: GeckoUnit[] = []
  const close = (tStart: number, tEnd: number, canvasAu: number, before: number): void => {
    windows.push({
      kind: 'word', tStart, tEnd, canvasAu, au: canvasAu + p.correctionPrefix[tEnd]! - p.correctionPrefix[tStart]!,
      startAdvance: unit.startAdvance + before + p.correctionPrefix[tStart]! - p.correctionPrefix[unit.tStart]!,
      inWord: { groups: null, offsets: new Array<InWordEntry | null>(tEnd - tStart).fill(null), windows: [] },
    })
  }
  // The open window: its start, the unit's Canvas au before it, and its own.
  let start = unit.tStart
  let before = 0
  let au = rangeAu(own, run, p.tUnits, grid[0]!, grid[1]!)
  // The cell before the cut, alone: its au and its ligature groups.
  let left = au
  let leftGroups: number | null = null
  for (let i = 1; i + 1 < grid.length; i++) {
    const g = grid[i]!
    const right = rangeAu(own, run, p.tUnits, g, grid[i + 1]!)
    const both = rangeAu(own, run, p.tUnits, grid[i - 1]!, grid[i + 1]!)
    let rightGroups: number | null = null
    let holds = left + right === both && generalCategory(codePointAtT(p, g))[0] !== 'M' && !joinsAcross(p, unit, g) && !ligatureAcross(p, run, unit, g)
    if (holds) {
      leftGroups ??= groupsIn(p, run, grid[i - 1]!, g, '', '')
      rightGroups = groupsIn(p, run, g, grid[i + 1]!, '', '')
      holds = leftGroups + rightGroups === groupsIn(p, run, grid[i - 1]!, grid[i + 1]!, '', '')
    }
    if (holds) {
      close(start, g, au, before)
      before += au
      start = g
      au = right
    } else {
      au = start === grid[i - 1]! ? both : rangeAu(own, run, p.tUnits, start, grid[i + 1]!)
    }
    left = right
    leftGroups = rightGroups
  }
  if (windows.length === 0 || before + au !== unit.canvasAu) return []
  close(start, unit.tEnd, au, before)
  return windows
}

const ZWJ = '\u200d'
const ZWNJ = '\u200c'

// W(suffix) of the unit from cluster start t, with nothing put before it. Two advances measure it: the one before t, where no
// letters join across t, and the one before the next cluster, which measures it with its own cluster in front (inWordAdvance,
// `withCluster`). Whichever comes first asks Canvas, and the other reads it here.
function suffixAlone(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): number {
  const entry = entryAt(unit, t)
  if (entry.suffixAu === null) entry.suffixAu = rangeAu(run.contexts.own, run, p.tUnits, t, unit.tEnd)
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
    const betweenMarks = previous >= unit.tStart && p.clusterStart[previous] === 0 && run.font.facts.joining !== 'opentype'
    return { au: inner.au, standIn: { kind: 'inside-cluster', at: p.tSource[t]!, betweenMarks } }
  }
  // A mark that starts a cluster: Unicode leaves some spacing marks out of Grapheme_Cluster_Break=SpacingMark (U+102B, U+102C
  // and U+1038 in Myanmar among them), so Gecko starts a cluster there, but to HarfBuzz's syllabic shapers the mark belongs to
  // the syllable before it, and a string that starts with it is a broken syllable, which gets a dotted circle
  // (hb_syllabic_insert_dotted_circles, hb-ot-shaper-syllabic.cc:32-99): the suffix measured alone doesn't shape as it does
  // in the unit. 20px "Myanmar MN": U+1038 alone is 982 au, a 649 au dotted circle and the 333 au the DOM gives it after
  // U+1004 U+102B (probe gecko-port F23). The value is the prefix's width, which ends before the mark, and a stand-in.
  if (generalCategory(codePointAtT(p, t))[0] === 'M') {
    const prefixAu = rangeAu(run.contexts.own, run, p.tUnits, unit.tStart, t)
    return { au: unit.startAdvance + prefixAu + p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!, standIn: { kind: 'mark-starts-cluster', at: p.tSource[t]! } }
  }
  const joiner = joinsAcross(p, unit, t) ? ZWJ : ''
  // A unit that starts inside a cluster (a mark or an emoji modifier after an invalid character): Canvas counts its first
  // characters as a group of their own when it measures the unit alone and as part of the space before them when a script
  // context stands in front (rangeAu), so its ligature groups can't be counted, and its positions stay stand-ins.
  if (p.clusterStart[unit.tStart] === 0) {
    const inner = rangeAu(run.contexts.own, run, p.tUnits, t, unit.tEnd, joiner, '')
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
    const markAdvance = marks && run.font.facts.joining !== 'opentype'
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
  const reversed = shapedReversed(p, run, unit, t)
  const suffixAu = joiner === '' ? suffixAlone(p, run, unit, t) : rangeAu(run.contexts.own, run, p.tUnits, t, unit.tEnd, joiner, '')
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
    prefixAu = rangeAu(run.contexts.own, run, p.tUnits, unit.tStart, t, '', joiner)
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
    across = withCluster - suffixAu - rangeAu(run.contexts.own, run, p.tUnits, a, t)
    prefixAu = unit.canvasAu - suffixAu - across
    sides = 'cluster'
  }
  return sidesAdvance(p, run, unit, t, { a, across, prefixAu, suffixAu, sides, joined: joiner !== '', reversed, leftOver })
}

// The advance before t from its two measured sides. Two recipes ask more where the sides don't add up, each to put what
// crosses t on one side of it: a kerned pair's placement and a joined suffix's font range (below).
function sidesAdvance(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number, s: InWordSides): InWordAdvance {
  const { a, across, prefixAu, suffixAu, reversed, leftOver } = s
  const joiner = s.joined ? ZWJ : ''
  let sides = s.sides
  const corrections = p.correctionPrefix[t]! - p.correctionPrefix[unit.tStart]!
  // Which glyph of a pair carries its adjustment: the fact, or where it isn't given what Canvas told of the pair at t.
  let placement = pairKerningAt(run, t)
  if (across !== 0 && joiner === '' && !reversed && !leftOver) {
    // The sides don't add up, and the font's pair kerning says where an adjustment across t goes: the advance is exact where
    // Canvas shows the difference is that pair's adjustment and no ligature group spans t.
    const share = pairKernedShare(p, run, unit, a, t, across)
    if (share.after !== null) {
      return { au: unit.startAdvance + unit.canvasAu - suffixAu - share.after + corrections, standIn: null }
    }
    placement = share.placement
  }
  // U+200D at the start of a Canvas string takes the font group's first valid font: ComputeRanges starts from it as the
  // previous font, and a join control keeps the previous font (gfxTextRun.cpp:3609-3613, :3311-3318). The letter after a
  // join causer takes that font only where it has the letter (:3320-3325), so a letter another font draws is a font range
  // of its own, shaped without the U+200D, in the form it has at a word's start, which the unit doesn't give it. A join
  // control after a letter keeps the letter's font, whatever draws it, so the prefix's side is measured as the unit shapes
  // it. Where the sides don't add up, the suffix is measured once more behind its own first letter, U+200C and U+200D,
  // less that letter and U+200C: one font range, the letter unjoined, the suffix joined. Where the sides add up that way,
  // the prefix's side is the value. It stays a stand-in: probe gecko-mainfacts M2 (Mongolian, Syriac and Phags-pa words
  // under nine listed fonts that lack them, each cut under one or two languages) has W(U+200D suffix) = W(suffix) at all
  // 26 cuts; of the 24 whose sides don't add up 18 add up this way, the prefix's side is the DOM's advance at 16 of them
  // and 3 au off at 2, and W(unit) − W(U+200D suffix) is the DOM's at none; Arabic under Georgia, 7 of 7. Two questions
  // a joined offset whose sides don't add up.
  if (joiner !== '' && across !== 0 && !reversed && !leftOver) {
    const first = (p.tUnits[t]! & 0xfc00) === 0xd800 && t + 1 < unit.tEnd ? 2 : 1
    let letter = ''
    for (let k = t; k < t + first; k++) letter += String.fromCharCode(p.tUnits[k]!)
    const behindLetter = rangeAu(run.contexts.own, run, p.tUnits, t, unit.tEnd, letter + ZWNJ + ZWJ, '') - rangeAu(run.contexts.own, run, p.tUnits, t, t + first, '', ZWNJ)
    if (prefixAu + behindLetter === unit.canvasAu) sides = 'joined-prefix'
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
  // - GPOS puts all of it on the first glyph, W(unit) − W(suffix), and so does the default where neither the fact nor
  //   Canvas says. A stand-in takes what Canvas told of the font's placement too (pairKernedShare): beside an offset that
  //   was told, the default would give the cluster between them both pairs' adjustments or neither.
  let au: number
  if (reversed || sides === 'joined-prefix') au = prefixAu
  else if (placement === 'split' && joiner === '') au = prefixAu + (across >> 1)
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
function pairKernedShare(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, a: number, t: number, R: number): { after: number | null; placement: 'first-advance' | 'split' | null } {
  if (!pairFactDescribes(run, t)) return { after: null, placement: null }
  const fact = run.font.facts.pairKerning
  let b = t + 1
  while (b < unit.tEnd && p.clusterStart[b] === 0) b++
  let b1 = b
  if (b < unit.tEnd) { b1 = b + 1; while (b1 < unit.tEnd && p.clusterStart[b1] === 0) b1++ }
  for (let k = a; k < b1; k++) if (p.tUnits[k]! < 0x21 || p.tUnits[k]! > 0x7e) return { after: null, placement: fact }
  const pairAu = rangeAu(run.contexts.own, run, p.tUnits, a, b)
  const firstAu = rangeAu(run.contexts.own, run, p.tUnits, a, t)
  const secondAu = rangeAu(run.contexts.own, run, p.tUnits, t, b)
  const alone = pairAu - firstAu - secondAu
  if (fact === 'first-advance') return { after: alone === R ? 0 : null, placement: fact }
  if (Math.abs(alone - R) > 2) return { after: null, placement: fact }
  if (fact === 'split' && R % 2 === 0) return { after: R / 2, placement: fact }
  // The fractions, from the run's context at 2^k times its font size.
  const large = largeContext(p, run)
  if (large === null) return { after: null, placement: fact }
  const w = (from: number, to: number): number => rangeAu(large.context, run, p.tUnits, from, to) / large.scale
  const pair = w(a, b)
  const first = w(a, t)
  const second = w(t, b)
  // The glyph after t kerns with the one after it too, and measured in the suffix it holds its half of that adjustment.
  const next = b1 > b ? (w(t, b1) - second - w(b, b1)) / 2 : 0
  const placed = placedTotals(first, second, (pair - first - second) / 2, next, b1 > b ? 1 : 0, large.scale)
  if (fact === 'split') return { after: placed.halves !== null && placed.halves.total === R ? placed.halves.after : null, placement: fact }
  // No fact. Where exactly one placement gives the R Canvas measured, that one placed this pair (toldBy).
  const own = placed.firstAlone === firstAu && placed.secondAlone === secondAu ? toldBy(placed, R) : null
  if (own === 'split') return { after: placed.halves!.after, placement: own }
  if (own === 'first-advance' && alone === R) return { after: 0, placement: own }
  // This pair doesn't tell, and a probe pair measured in the run's context may (askedPlacement). What it tells is about
  // the face that draws it, so it counts for this pair only where Canvas shows that face draws this pair too (sameFace).
  if (own !== null || alone === 0) return { after: null, placement: null }
  const asked = askedPlacement(p, run)
  if (asked.placement === null || !(sameFace(run, asked, textOf(p, a, t), firstAu) || sameFace(run, asked, textOf(p, t, b), secondAu))) return { after: null, placement: null }
  // The told placement must give this pair's R where the fractions let it be computed.
  if (asked.placement === 'first-advance') return { after: alone === R && (placed.first === null || placed.first === R) ? 0 : null, placement: asked.placement }
  if (placed.halves !== null) return { after: placed.halves.total === R ? placed.halves.after : null, placement: asked.placement }
  return { after: R % 2 === 0 ? R / 2 : null, placement: asked.placement }
}

function textOf(p: GeckoPrepared, from: number, to: number): string {
  let s = ''
  for (let k = from; k < to; k++) s += String.fromCharCode(p.tUnits[k]!)
  return s
}

// floor(x + 0.5), or null where x is within `reach` au of a tie.
const rounded = (x: number, reach: number): number | null => Math.abs(x - Math.floor(x) - 0.5) <= reach ? null : Math.floor(x + 0.5)

// What a pair's adjustment comes to once Gecko has rounded each glyph's advance to app units (gfxHarfBuzzShaper.cpp:1699-1702),
// under each way HarfBuzz places it, from unrounded values: `first` and `second` the two clusters alone, `half` half the
// pair's adjustment, `next` the half of the following pair's adjustment that the second glyph holds in a suffix, all in au
// at the run's size, measured at `scale` times the size, so a cluster is known to within 0.5 / scale au and a half
// adjustment to within 1 / scale au (`nextReach` more half steps where `next` is measured). A rounding nearer to a tie
// than its inputs' reach gives null.
// - `halves`: the kern and kerx pair machine, half on each glyph (hb-kern.hh:102-106); `after` is the second glyph's term.
// - `first`: GPOS, all of it on the first glyph (PairSet.hh:126-127).
// - `onSecond`: a kerx or kern state machine, all of it on the glyph it pops, the second of a pair
//   (hb-aat-layout-kerx-table.hh:296-333). The port has no value for it; it is here so that it can't pass for another.
// `firstAlone` and `secondAlone` are the clusters alone, rounded: where they aren't the advances the run's size measures,
// the font's advances aren't linear in the size (Hoefler Text, probe gecko-mainfacts M1) and nothing here counts.
function placedTotals(first: number, second: number, half: number, next: number, nextReach: number, scale: number):
  { halves: { total: number; after: number } | null; first: number | null; onSecond: number | null; firstAlone: number | null; secondAlone: number | null } {
  const reach = 0.5 / scale
  const reachZ = (0.5 + nextReach) / scale
  const firstAlone = rounded(first, reach)
  const secondAlone = rounded(second, reach)
  const firstHalf = rounded(first + half, reach + 1 / scale)
  const zHalf = rounded(second + next + half, reachZ + 1 / scale)
  const zAlone = rounded(second + next, reachZ)
  const firstWhole = rounded(first + 2 * half, reach + 2 / scale)
  const secondWhole = rounded(second + 2 * half, reach + 2 / scale)
  return {
    halves: firstHalf === null || firstAlone === null || zHalf === null || zAlone === null ? null : { total: firstHalf - firstAlone + zHalf - zAlone, after: zHalf - zAlone },
    first: firstWhole === null || firstAlone === null ? null : firstWhole - firstAlone,
    onSecond: secondWhole === null || secondAlone === null ? null : secondWhole - secondAlone,
    firstAlone, secondAlone,
  }
}

// The placement that gave a pair the adjustment R Canvas measured, where the three can be computed and exactly one of them
// is R; null where several are, as they often are, or where only the third is. Over the rows of probes gecko-mainfacts M1
// and the critic's G1 (research/MAIN-FACTS-ANALYSIS.md) a pair's own total tells 100 of 881 kerned cuts in 30 faces and
// 543 of 5,114 in 106 held-out styles, each the DOM's advance but one that is 1 au off.
function toldBy(placed: ReturnType<typeof placedTotals>, R: number): 'first-advance' | 'split' | null {
  if (placed.halves === null || placed.first === null || placed.onSecond === null || placed.onSecond === R) return null
  if (placed.halves.total === R) return placed.first === R ? null : 'split'
  return placed.first === R ? 'first-advance' : null
}

// The run's context at 2^k times its font size, the largest under gfxFont's clamp of 2000px (gfxFont.cpp:4956-4960): found
// in the paragraph's list or made at its end where a recipe first asks, and read from the run's record from then on. null
// for a font of size 0, which no power of two makes larger.
function largeContext(p: GeckoPrepared, run: GeckoTextRun): { context: Context; scale: number } | null {
  const size = run.font.size
  if (!(size > 0)) return null
  if (run.contexts.large === null) {
    let k = 0
    while (size * 2 ** (k + 1) <= 2000) k++
    const scale = 2 ** k
    run.contexts.large = { context: contextFor(p.contexts, { ...run.contexts.own.settings, font: canvasFont(run.font, size * scale) }), scale }
  }
  return run.contexts.large
}

// Pairs of printable ASCII that many Latin fonts kern and none ligates, in a fixed order: each shares a letter with one
// before it, or with `AV`.
const PROBE_PAIRS = ['AV', 'VA', 'AT', 'TA', 'AW', 'WA', 'To', 'Ty', 'T.', 'LT', 'Vo', 'Yo', 'Wa', 'y,', 'r,', 'P,']

// Which placement the font of the run's context gives a pair adjustment, asked of Canvas where the fact isn't given, from
// probe pairs measured alone in the run's context. HarfBuzz chooses between GPOS and the kern or kerx machine once per
// face, script and language (hb-ot-shape.cc:131-187), so what one pair shows holds for the face's other Latin pairs. That
// rests on the font: a kerx table can hold a state machine subtable beside a pair subtable, and a GPOS pair can adjust
// its second glyph; none of 1,008 installed faces places a Latin pair another way than its others
// (research/MAIN-FACTS-ANALYSIS.md, the critic's offline study). A pair whose total a placement doesn't give strikes that
// placement out (placedTotals), and the probe ends when one is left, or none. One pair seldom does it alone, so the pairs
// work together, which they may only as one face's: a kerned pair is one face's (sameFace), so the first pair that kerns
// names the face, a later pair counts only where it shares a letter with those that counted, and their letters are the
// `tellers`. A pair whose letters alone don't measure as the larger size predicts ends the probe: the font's advances
// aren't linear in the size (system-ui's optical sizes, Hoefler Text), which is the face's property. The answer depends on
// the context alone, so it is asked once per context of a prepared paragraph, by whichever offset needs it first, and
// kept on the context's record (RunContexts.pairPlacement). Three questions a pair that doesn't kern, six a pair that does,
// none for a pair that shares no letter. Over the rows of probes gecko-mainfacts M1 and the critic's G1
// (research/MAIN-FACTS-ANALYSIS.md), this recipe run offline: 25 of 30 and 88 of 106 styles told, a median of 30 and 24
// questions; with it 759 of 764 told cuts of 881 are the DOM's advance in M1 and 4,231 of 4,245 of 5,114 in G1. The 19
// others: 13 are 1 au off in words whose DOM total is 1 au off Canvas's, and 6 sit in a ligature the rows' words hold
// (`ff`, `ffl`, Zapfino's `st`), which the ligature tests take before this recipe.
function askedPlacement(p: GeckoPrepared, run: GeckoTextRun): PairPlacement {
  if (run.contexts.pairPlacement !== null) return run.contexts.pairPlacement
  const asked: PairPlacement = { placement: null, tellers: [], tellerAu: [], sameFace: [], otherFace: [] }
  run.contexts.pairPlacement = asked
  const large = largeContext(p, run)
  if (large === null) return asked
  const au = (context: Context, text: string): number => Math.round(width(context, text) * CANVAS_AU_PER_PX)
  let halves = true
  let first = true
  let onSecond = true
  for (let i = 0; i < PROBE_PAIRS.length; i++) {
    const pair = PROBE_PAIRS[i]!
    if (asked.tellers.length > 0 && !asked.tellers.includes(pair[0]!) && !asked.tellers.includes(pair[1]!)) continue
    const firstAu = au(run.contexts.own, pair[0]!)
    const secondAu = au(run.contexts.own, pair[1]!)
    const R = au(run.contexts.own, pair) - firstAu - secondAu
    if (R === 0) continue
    const y = au(large.context, pair[0]!) / large.scale
    const z = au(large.context, pair[1]!) / large.scale
    const placed = placedTotals(y, z, (au(large.context, pair) / large.scale - y - z) / 2, 0, 0, large.scale)
    if ((placed.firstAlone !== null && placed.firstAlone !== firstAu) || (placed.secondAlone !== null && placed.secondAlone !== secondAu)) break
    for (let k = 0; k < 2; k++) if (!asked.tellers.includes(pair[k]!)) { asked.tellers.push(pair[k]!); asked.tellerAu.push(k === 0 ? firstAu : secondAu) }
    if (placed.firstAlone === null || placed.secondAlone === null) continue
    if (placed.halves !== null && placed.halves.total !== R) halves = false
    if (placed.first !== null && placed.first !== R) first = false
    if (placed.onSecond !== null && placed.onSecond !== R) onSecond = false
    const left = (halves ? 1 : 0) + (first ? 1 : 0) + (onSecond ? 1 : 0)
    if (left === 1 && !onSecond) asked.placement = halves ? 'split' : 'first-advance'
    if (left <= 1) break
  }
  return asked
}

// Whether the face that draws the probe pairs that told draws `cluster` too, `clusterAu` wide alone. Font matching gives
// each character its own font (gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3600), a font list's first font can lack
// some printable ASCII (a digits font, a unicode-range subset), and a text run is shaped one font range at a time
// (gfxTextRun.cpp:2930-3000), so nothing crosses two faces: probe gecko-mainfacts M5, a first font that draws only the
// digits before Arial, has Times New Roman's `11` in halves (462 + 462 au) and Arial's `AV` on the first glyph (569 + 640)
// under one declaration, and 0 au across each of 30 pairs of a digit and a letter, in Canvas and in the DOM. So a cluster
// is the tellers' face's where it is a teller, or where it and one of the first four tellers measure together other than
// apart, in either order. Up to eight questions a cluster, asked once: the answer depends on the context and the cluster
// alone.
function sameFace(run: GeckoTextRun, asked: PairPlacement, cluster: string, clusterAu: number): boolean {
  if (asked.tellers.includes(cluster) || asked.sameFace.includes(cluster)) return true
  if (asked.otherFace.includes(cluster)) return false
  const au = (text: string): number => Math.round(width(run.contexts.own, text) * CANVAS_AU_PER_PX)
  for (let i = 0; i < asked.tellers.length && i < 4; i++) {
    const apart = clusterAu + asked.tellerAu[i]!
    if (au(cluster + asked.tellers[i]!) !== apart || au(asked.tellers[i]! + cluster) !== apart) {
      asked.sameFace.push(cluster)
      return true
    }
  }
  asked.otherFace.push(cluster)
  return false
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
  return pairFactDescribes(run, t) ? run.font.facts.pairKerning : null
}

// Whether FontFacts.pairKerning, given or asked of Canvas, describes the script run at offset t (the comment above).
function pairFactDescribes(run: GeckoTextRun, t: number): boolean {
  let k = 0
  while (run.scriptRuns[k]!.limit <= t) k++
  let script = run.scriptRuns[k]!.script
  if (script === 'Zyyy' || script === 'Zinh') {
    const locale = tryParseLocale(run.contexts.own.settings.lang)
    const likely = locale === null ? '' : addLikelySubtags(locale.language, locale.script, locale.region).script
    script = likely === '' ? 'Latn' : likely
  }
  if (script === 'Latn') return true
  // The scripts that select other lookups than Latin text, which pairKerning describes.
  const scriptLookups = firstFontScriptLookups(run.font)
  if (scriptLookups === null || (script !== 'Grek' && script !== 'Cyrl')) return false
  let own = -1
  let latin = -1
  for (let g = 0; g < scriptLookups.length; g++) {
    if (scriptLookups[g]!.includes(script)) own = g
    if (scriptLookups[g]!.includes('Latn')) latin = g
  }
  return own === latin
}

// Whether Canvas shows a ligature group over cluster boundary t: an optional ligature (ligatureAcross) or a group required
// shaping forms (groupAcross).
function groupSpans(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  // Not in a unit that starts inside a cluster, whose groups Canvas can't count (inWordAdvance).
  if (p.clusterStart[unit.tStart] === 0) return false
  const entry = entryAt(unit, t)
  if (entry.ligature === null) entry.ligature = ligatureAcross(p, run, unit, t)
  return entry.ligature || groupAcrossAt(p, run, unit, t)
}

// groupAcross at cluster boundary t, with U+200D at the cut where letters join across it.
function groupAcrossAt(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): boolean {
  const entry = entryAt(unit, t)
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
function rowAround(p: GeckoPrepared, run: GeckoTextRun, unit: GeckoUnit, t: number): LigatureRow | null {
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
  const first = entryAt(unit, start)
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
export function groupAround(p: GeckoPrepared, run: GeckoTextRun, whole: GeckoUnit, t: number): { start: number; end: number; unconfirmed: boolean } | null {
  // No group spans a window's start (windowsOf).
  const unit = windowAt(p, run, whole, t)
  if (t === unit.tStart) return null
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
    const lang = run.contexts.own.settings.lang.toLowerCase()
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
  // The unit's own count is the same at every offset, so the unit keeps it.
  const inWord = inWordOf(unit)
  if (inWord.groups === null) {
    let clusters = 0
    for (let k = unit.tStart; k < unit.tEnd; k++) clusters += p.clusterStart[k]!
    inWord.groups = { counted: groupsIn(p, run, unit.tStart, unit.tEnd, '', ''), clusters }
  }
  const inUnit = inWord.groups.counted
  if (inUnit === inWord.groups.clusters) return false
  // U+200D before the suffix is a cluster of its own, which the joiner measured alone counts too.
  const spaced = letterSpacedContext(p.contexts, run.contexts)
  const off = noLigaturesContext(p.contexts, run.contexts)
  const joinerGroups = joiner === '' ? 0 : (Math.round(width(spaced, joiner) * CANVAS_AU_PER_PX) - Math.round(width(off, joiner) * CANVAS_AU_PER_PX)) / (2 * CANVAS_AU_PER_PX)
  return groupsIn(p, run, unit.tStart, t, '', joiner) + groupsIn(p, run, t, unit.tEnd, joiner, '') - joinerGroups !== inUnit
}

// The ligature groups Canvas counts in [tStart, tEnd) (groupAcross): its au at 2px of letter spacing less its au at
// 0.001px, over 2px.
function groupsIn(p: GeckoPrepared, run: GeckoTextRun, tStart: number, tEnd: number, before: string, after: string): number {
  const spaced = letterSpacedContext(p.contexts, run.contexts)
  const off = noLigaturesContext(p.contexts, run.contexts)
  return (rangeAu(spaced, run, p.tUnits, tStart, tEnd, before, after) - rangeAu(off, run, p.tUnits, tStart, tEnd, before, after)) / (2 * CANVAS_AU_PER_PX)
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
